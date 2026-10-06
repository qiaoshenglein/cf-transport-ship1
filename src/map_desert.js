// 沙漠灰（参照 CF「沙漠灰」/ CS Dust2）：黄沙院落 + 中路长巷 + A/B 两处据点
// 本文件由地图作者维护；desertTextures() 只在客户端调用（服务端 headless 走贴图桩）
// 分区（x 沿长轴 -38..38，z -20..20，-Z 为北）：
//   BL 院落 x<-28.4 / GR 院落 x>28.4（各两个门，Z 不同）
//   北沟(-18.3) 猫道A(-11) 中路(0) B道(+11) 南沟(+18.3) 五条横巷，A 点在东北、B 点在东南
import * as THREE from 'three';
import { makeKit } from './mapkit.js';
import { fbm, normalFromHeight } from './textures.js';

function texSet(canvas, hgt, rep, strength = 2) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
  const n = new THREE.CanvasTexture(normalFromHeight(hgt, canvas.width, canvas.height, strength));
  n.wrapS = n.wrapT = THREE.RepeatWrapping;
  n.repeat.set(rep, rep);
  n.colorSpace = THREE.NoColorSpace;
  return { map: t, normalMap: n };
}

const S = 256;
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
let rndSeed = 20260;
const rnd = () => ((rndSeed = (rndSeed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// 晒斑与盐析：沙漠墙面的旧化九成是这一层，纯色贴图一眼就看出是新的
function weather(ctx, seed, n, tint, aK, rmin, rmax) {
  let s = seed;
  const rr = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < n; i++) {
    const x = rr() * S, y = rr() * S, r = rmin + rr() * (rmax - rmin);
    const a = aK * (0.4 + rr() * 0.6);
    // 贴图要四方平铺，所以越界的斑一律按九宫补画，接缝处才不会露出断口
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const cx = x + dx * S, cy = y + dy * S;
      if (cx < -r || cx > S + r || cy < -r || cy > S + r) continue;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(${tint},${a.toFixed(3)})`);
      g.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
}

// 通用砌块：rows×cols 皮砖 + 错缝 + 砂色勾缝，高度场让砖面微凸、砖缝真凹
function blocks(base, jointCol, rows, cols, jw, seed, grain) {
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d', { willReadFrequently: true });
  const img = x.createImageData(S, S), d = img.data;
  const h = new Float32Array(S * S);
  const med = fbm(S, S, 4, 4, 4, seed);      // 大块变色
  const fine = fbm(S, S, 20, 20, 3, seed + 91); // 砂粒
  const BH = S / rows, BW = S / cols;
  for (let py = 0; py < S; py++) {
    const row = Math.floor(py / BH), yIn = py - row * BH;
    const shift = (row & 1) ? BW / 2 : 0;    // 错缝：真实砌体不会上下对齐
    for (let px = 0; px < S; px++) {
      const sx = px + shift;
      const cell = Math.floor(sx / BW);
      const blk = cell % cols;
      const xIn = sx - cell * BW;
      const i = py * S + px;
      const joint = yIn < jw || xIn < jw;
      // 每皮每块一个色相：用 hash 不用 random，重开引擎贴图不会变样
      const ht = ((row * 73 + blk * 151 + 11) % 29) / 29;
      const n = med[i], fg = fine[i];
      let r, g, b;
      if (joint) {
        const k = 0.9 + n * 0.18;             // 缝里积的砂比砖浅一点，勾缝才读得出来
        r = jointCol[0] * k; g = jointCol[1] * k; b = jointCol[2] * k;
        h[i] = -0.5 + fg * 0.2;
      } else {
        // 砖心亮、砖边暗：磨圆感靠这一条 bevel 撑起来
        const bev = Math.min(1, (Math.min(xIn, BW - xIn) + Math.min(yIn, BH - yIn)) / (jw * 2.4));
        const k = (0.86 + ht * 0.26 + (n - 0.5) * 0.18) * (0.9 + bev * 0.14);
        r = base[0] * k; g = base[1] * k; b = base[2] * k;
        h[i] = 0.28 + fg * 0.22 + ht * 0.05;
      }
      const gr = (fg - 0.5) * grain;
      d[i * 4] = clamp8(r + gr); d[i * 4 + 1] = clamp8(g + gr * 0.9);
      d[i * 4 + 2] = clamp8(b + gr * 0.8); d[i * 4 + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return { c, x, h };
}

// 客户端开局按需生成：沙岩砖墙 / 夯土墙 / 沙地 / 石板路 / 木梁
export function desertTextures(T) {
  if (T.sandStone) return;

  // 沙岩：800×400 的大皮石，缝宽 6px（贴图 2.2m 一循环）
  {
    const { c, x, h } = blocks([199, 172, 133], [182, 157, 119], 4, 2, 6, 31, 26);
    weather(x, 7001, 20, '120,96,58', 0.16, 12, 46);
    weather(x, 7777, 10, '240,228,200', 0.13, 18, 58);
    for (let k = 0; k < 7; k++) {            // 檐口流下的泥色竖纹：远距离最能读出"旧"
      const px = (k * 37 + 11) % S, w = 6 + (k % 3) * 7;
      const g = x.createLinearGradient(px, 0, px, S);
      g.addColorStop(0, 'rgba(122,98,64,0.22)'); g.addColorStop(1, 'rgba(122,98,64,0)');
      x.fillStyle = g; x.fillRect(px, 0, w, S);
    }
    x.strokeStyle = 'rgba(88,70,46,0.4)'; x.lineWidth = 1.2;
    for (let k = 0; k < 9; k++) {            // 崩角与裂缝
      const px = rnd() * S, py = rnd() * S;
      x.beginPath(); x.moveTo(px, py);
      x.lineTo(px + (rnd() - 0.5) * 30, py + (rnd() - 0.5) * 30);
      x.lineTo(px + (rnd() - 0.5) * 44, py + (rnd() - 0.5) * 44);
      x.stroke();
    }
    T.sandStone = texSet(c, h, 2.2, 2.6);
  }

  // 夯土：小皮泥砖，缝更细，整体偏粉白，抹痕是人工的弧线而不是噪声
  {
    const { c, x, h } = blocks([216, 194, 154], [192, 170, 133], 6, 3, 3, 57, 20);
    weather(x, 4321, 26, '150,122,80', 0.13, 10, 40);
    weather(x, 9111, 14, '248,238,216', 0.12, 14, 52);
    x.strokeStyle = 'rgba(158,134,96,0.2)'; x.lineWidth = 1.5;
    for (let k = 0; k < 18; k++) {
      const px = (k * 61 + 17) % S, py = (k * 43 + 7) % S;
      x.beginPath(); x.arc(px, py, 10 + (k % 5) * 6, k, k + 2.1); x.stroke();
    }
    T.adobe = texSet(c, h, 1.7, 2);
  }

  // 石板路：基地与 A 点铺石，沙地里给眼睛一个"这里有人住"的参照
  {
    const { c, x, h } = blocks([187, 175, 151], [153, 135, 105], 5, 5, 4, 205, 18);
    weather(x, 8123, 22, '96,86,70', 0.14, 8, 30);
    weather(x, 5521, 12, '226,216,192', 0.1, 10, 26);
    T.stonePave = texSet(c, h, 2.4, 2.3);
  }

  // 沙地：风成沙纹 + 卵石，法线全靠波纹撑，重复度给高一点免得看出格子
  {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d', { willReadFrequently: true });
    const img = x.createImageData(S, S), d = img.data;
    const h = new Float32Array(S * S);
    const dune = fbm(S, S, 3, 2, 5, 12);
    const rip = fbm(S, S, 1, 6, 2, 44);
    const grit = fbm(S, S, 32, 32, 2, 909);
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const i = py * S + px;
      // sin 叠噪声做波纹：噪声让纹距不均匀，纯 sin 会像瓦楞
      const wv = Math.sin(px * 0.16 + rip[i] * 5.5) * 0.5 + 0.5;
      const k = 0.86 + dune[i] * 0.3 + wv * 0.08 + (grit[i] - 0.5) * 0.2;
      d[i * 4] = clamp8(198 * k); d[i * 4 + 1] = clamp8(178 * k);
      d[i * 4 + 2] = clamp8(136 * k); d[i * 4 + 3] = 255;
      h[i] = wv * 0.4 + dune[i] * 0.5 + grit[i] * 0.28;
    }
    x.putImageData(img, 0, 0);
    for (let k = 0; k < 900; k++) {           // 卵石：暗底 + 亮顶，数量要够才压得住"平"
      const px = rnd() * S, py = rnd() * S, r = 0.6 + rnd() * 1.7;
      x.fillStyle = `rgba(126,106,76,${(0.18 + rnd() * 0.3).toFixed(2)})`;
      x.beginPath(); x.arc(px, py, r, 0, 6.284); x.fill();
      x.fillStyle = `rgba(240,228,200,${(0.1 + rnd() * 0.25).toFixed(2)})`;
      x.beginPath(); x.arc(px - r * 0.3, py - r * 0.35, r * 0.55, 0, 6.284); x.fill();
    }
    weather(x, 6666, 16, '138,116,80', 0.12, 14, 44);
    T.sandGround = texSet(c, h, 4.5, 1.15);
  }

  // 木梁：门扇、椽子、电线杆——沙漠图里唯一的深色重音
  {
    const { c, x, h } = blocks([122, 88, 54], [68, 48, 29], 1, 7, 3, 313, 14);
    x.strokeStyle = 'rgba(74,52,30,0.3)'; x.lineWidth = 1;
    for (let k = 0; k < 46; k++) {            // 顺纹长线，略弯
      const py = (k * 5 + 3) % S;
      x.beginPath(); x.moveTo(0, py);
      for (let px = 0; px <= S; px += 32) x.lineTo(px, py + Math.sin(px * 0.05 + k) * 3);
      x.stroke();
    }
    weather(x, 2468, 14, '48,34,22', 0.16, 10, 34);
    T.timber = texSet(c, h, 1.2, 2.1);
  }
}

// PVE 要点（服务端与客户端共用）：怪口全在 GR 院落远端，彼此分开且周围留出怪物体型
export const desertPve = {
  spawns: [{ x: 30.8, z: -12.2 }, { x: 30.2, z: 12.8 }, { x: 36.2, z: -2 }],
  supplies: [
    { x: -21, z: -11, kind: 'med' },      // 猫道西口：出基地左手第一条补给
    { x: -21, z: 11, kind: 'ammo' },      // B 道西口
    { x: -1, z: -11, kind: 'armor' },     // 猫道中段：绕后路上唯一的护甲
    { x: -1, z: 11, kind: 'ammo' },       // B 道集市旁
    { x: -23.5, z: 4.3, kind: 'med' },    // 中路西端死角：抢中路之前先补
    { x: 16.2, z: 12.9, kind: 'armor' },  // B 点券门内：守点续航
  ],
};

export function buildDesert(scene, T, world, opts = {}) {
  const kit = makeKit(T, world, 777);
  const { box, solid, foot, geom, rod, prims } = kit;
  const tx = (k) => T[k] || {};
  // 材质：headless 桩里 map/normalMap 全 null，只留粗糙度与色偏，服务端照样建得出碰撞体
  const tex = (key, uvTiling, rough, o = {}) => kit.def(key, kit.std({
    map: tx(key).map, normalMap: tx(key).normalMap,
    color: o.tint === undefined ? 0xffffff : o.tint,
    roughness: rough, metalness: o.metal ?? 0.02, envMapIntensity: o.env ?? 0.5,
    normalScale: new THREE.Vector2(o.ns ?? 1.2, o.ns ?? 1.2),
  }), uvTiling, o.flags || {});

  tex('sandStone', 2.2, 0.96, { ns: 1.45 });
  tex('adobe', 1.7, 0.93);
  tex('stonePave', 2.4, 0.92, { ns: 1.3 });
  tex('sandGround', 4.5, 1, { ns: 0.85, flags: { shadow: false } });
  tex('timber', 1.2, 0.82);
  kit.def('cloth', kit.std({ color: 0xcbb78e, roughness: 0.95, side: THREE.DoubleSide }), 1);
  kit.plain('grime', 0x3f3529, { rough: 0.95 });
  kit.plain('winDark', 0x191310, { rough: 0.7, metal: 0.04 });
  kit.def('winLit', kit.std({ color: 0xffd9a0, emissive: 0xffb866, emissiveIntensity: 3.4, roughness: 0.6 }), 1, { shadow: false });

  const ST = 'sandStone', AD = 'adobe', PV = 'stonePave', TM = 'timber';
  const HOLE = 2.4;   // 门洞净高：门楣、券脸、门套全部以此为准

  // 长墙切段：单条碰撞体超过 30m 会被小地图过滤掉，所以实墙按 11m 中分。
  // 注意门洞必须整段单独建——若只按固定步长切，落在段界上的门会被两段同时丢弃（= 院墙被封死）
  const SEG = 11;
  const holeSeg = (at, w, hh) => ({ a: at - w / 2, b: at + w / 2, at, w, h: hh ?? HOLE });
  function runWall(axis, fixed, from, to, h, key, holes, o) {
    const hs = holes.map((c) => holeSeg(c.at, c.w ?? 1.8, c.h)).filter((c) => c.b > from && c.a < to)
      .sort((p, q) => p.a - q.a);
    const seg = (a, b, open) => {
      if (b - a < 0.02) return;
      const kk = o.th ?? 0.5;
      if (open) {
        const p = Math.max(a, from), q = Math.min(b, to);
        if (axis === 'x') kit.wall(p, fixed, q, fixed, o.y0 ?? 0, h, kk, key, { open: [{ at: open.at - p, w: open.w, h: open.h }], ...o });
        else kit.wall(fixed, p, fixed, q, o.y0 ?? 0, h, kk, key, { open: [{ at: open.at - p, w: open.w, h: open.h }], ...o });
        return;
      }
      for (let p = a; p < b - 0.01; p += SEG) {
        const q = Math.min(b, p + SEG);
        if (axis === 'x') kit.wall(p, fixed, q, fixed, o.y0 ?? 0, h, kk, key, o);
        else kit.wall(fixed, p, fixed, q, o.y0 ?? 0, h, kk, key, o);
      }
    };
    let cur = from;
    for (const c of hs) {
      seg(cur, c.a, null);
      seg(c.a, c.b, c);
      cur = c.b;
    }
    seg(cur, to, null);
  }
  const wallX = (z, x0, x1, h, key, holes = [], o = {}) => runWall('x', z, x0, x1, h, key, holes, { surface: 'stone', mat: 'concrete', ...o });
  const wallZ = (x, z0, z1, h, key, holes = [], o = {}) => runWall('z', x, z0, z1, h, key, holes, { surface: 'stone', mat: 'concrete', ...o });
  // 只画顶面的薄板：地面铺装与棚布，不做碰撞，免得吃掉 NavGrid 格子
  const skin = (cx, cz, sx, sz, key, y = 0.05) => box(cx, y, cz, sx, 0.06, sz, 0, { py: key });
  // 石台：一层盒体 + 一层铺装顶面，比"纯沙 + 箱子"更像人搭出来的据点。顶面抬 4cm 是为了躲开与盒体共面的 z-fighting
  const deck = (cx, cz, sx, sz, h, y0 = 0, top = PV) => {
    box(cx, y0 + h / 2, cz, sx, h, sz, 0, { px: ST, nx: ST, pz: ST, nz: ST });
    skin(cx, cz, sx, sz, top, y0 + h + 0.01);
    solid(cx, y0 + h / 2, cz, sx, h, sz, 0, { mat: 'concrete', surface: 'stone' });
    foot(cx, cz, sx + 0.2, sz + 0.2, 0, 0.55);
  };
  // 半埋沙的残墙：只挡到胸口，站立能越过它看见人，是巷战里最值钱的软掩体
  const ruin = (x0, z0, x1, z1, h, key = ST) =>
    kit.wall(x0, z0, x1, z1, 0, h, 0.55, key, { surface: 'stone', mat: 'concrete', dark: 0.42 });
  // 台上台：h0 非零才能从 1.5m 台面接着往上爬到 2.76m 屋顶（每级 ≤0.32，人和 BOT 都走得上）
  function stepRun(x0, z0, x1, z1, h0, h1, n, w, key = ST, topKey = PV) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L, yaw = Math.atan2(-dz, dx), tread = L / n;
    for (let i = 0; i < n; i++) {
      const hh = h0 + (h1 - h0) * (i + 1) / n;
      const mx = x0 + ux * (i + 0.5) * tread, mz = z0 + uz * (i + 0.5) * tread;
      box(mx, hh / 2, mz, tread, hh, w, yaw, { py: i === n - 1 ? topKey : key, px: key, nx: key, pz: key, nz: key });
      solid(mx, hh / 2, mz, tread, hh, w, yaw, { mat: 'concrete', surface: 'stone' });
    }
    foot(x0 + ux * L / 2, z0 + uz * L / 2, L, w, yaw, 0.5);
  }

  // 门套：两根门墩 + 横档 + 花窗 + 叠涩起券。kit.wall 只会切方洞，沙漠的大门要靠这一层套出来
  function portal(cx, cz, w, yawDeg, o = {}) {
    const yaw = (yawDeg || 0) * Math.PI / 180;
    const hw = w / 2, pier = o.pier ?? 0.62, ph = o.h ?? 4.2, th = o.th ?? 1.0, top = o.top ?? ph;
    const key = o.key || ST;
    const P = (lx, lz) => [cx + Math.cos(yaw) * lx + Math.sin(yaw) * lz, cz - Math.sin(yaw) * lx + Math.cos(yaw) * lz];
    for (const s of [-1, 1]) {
      const [px, pz] = P(s * (hw + pier / 2), 0);
      box(px, ph / 2, pz, pier, ph, th, yaw, key);
      solid(px, ph / 2, pz, pier, ph, th, yaw, { mat: 'concrete', surface: 'stone' });
      foot(px, pz, pier + 0.18, th + 0.18, yaw, 0.5);
      box(px, ph + 0.1, pz, pier + 0.24, 0.2, th + 0.24, yaw, PV);   // 石帽：远看才有轮廓断口
      // 叠涩：三块石料逐级挑出洞口，做出"券"的过渡
      for (let k = 0; k < 3; k++) {
        const [bx, bz] = P(s * (hw - 0.1 - k * 0.34), 0);
        box(bx, 2.5 + k * 0.42, bz, 0.72, 0.3, th + 0.06, yaw, ST);
      }
    }
    const [mx, mz] = P(0, 0);
    const sh = top - HOLE;
    box(mx, HOLE + sh / 2, mz, w + pier * 2, sh, th - 0.12, yaw, key);
    solid(mx, HOLE + sh / 2, mz, w + pier * 2, sh, th - 0.12, yaw, { mat: 'concrete', surface: 'stone' });
    // 花窗：真圆洞做不了（几何做拱会把门洞堵住），所以用石环 + 暗盘假装；两面都贴，进出都看得见
    for (const off of [-(th / 2 - 0.02), th / 2 - 0.02]) {
      const [ax, az] = P(0, off);
      geom(key, prims.tor, ax, HOLE + sh / 2, az, 0, yaw, 0, 1.4, 1.4, 1.4);
      box(ax, HOLE + sh / 2, az, 0.86, 0.86, 0.1, yaw, { pz: 'grime', nz: 'grime' });
    }
    return { x: mx, z: mz, yaw };
  }

  // ================== 地面与世界边界 ==================
  solid(0, -0.5, 0, 80, 1, 44, 0, { mat: 'concrete', surface: 'sand', tag: 'deck' });
  box(0, 0.02, 0, 78, 0.04, 42, 0, { py: 'sandGround' });
  // 外围 9m 墙：跳不出去，BOT 也不会朝图外空寻路
  for (const [a, b] of [[-38, -27], [-27, -16], [-16, -5], [-5, 6], [6, 17], [17, 28], [28, 38]]) {
    wallX(-19.6, a, b, 9, ST, [], { th: 0.7 });
    wallX(19.6, a, b, 9, ST, [], { th: 0.7 });
  }
  for (const [a, b] of [[-20, -7], [-7, 7], [7, 20]]) {
    wallZ(-37.3, a, b, 9, ST, [], { th: 0.7 });
    wallZ(37.3, a, b, 9, ST, [], { th: 0.7 });
  }

  // ================== 五条横巷的隔墙 ==================
  // 巷墙只跨中场（x ±28.15）：一旦伸进院落就会把基地切成三段，NavGrid 直接断图
  // 3.6m 挡视线；两个开口就是中路↔侧翼的"猫道门"，谁控中路都要先过这两道拐角
  wallX(-6.0, -28.15, 28.15, 3.6, ST, [{ at: -18, w: 3.2 }, { at: 2, w: 2.6 }], { threshold: TM });
  wallX(6.0, -28.15, 28.15, 3.6, ST, [{ at: -14, w: 3.2 }, { at: 10, w: 2.6 }], { threshold: TM });
  // 环沟壁：1m 以上才会被 NavGrid 当阻隔，2.9m 又刚好能爬回横巷
  wallX(-15.4, -37.3, 37.3, 2.9, AD, [{ at: -24, w: 2.8 }, { at: -13, w: 2.6 }, { at: 12, w: 3.0 }]);
  wallX(15.4, -37.3, 37.3, 2.9, AD, [{ at: -22, w: 2.8 }, { at: 0, w: 2.6 }, { at: 16, w: 3.0 }, { at: 24, w: 2.8 }]);

  // ================== 两座基地院落 ==================
  const gate = (x) => {
    wallZ(x, -15.15, 15.15, 4.6, ST, [{ at: -7, w: 3.4 }, { at: 7, w: 3.4 }], { threshold: TM });
    portal(x, -7, 3.4, 90, { th: 0.9, top: 4.6 });
    portal(x, 7, 3.4, 90, { th: 0.9, top: 4.6 });
  };
  gate(-28.4); gate(28.4);

  // BL（潜伏者）院落：两间夯土屋 + 补给车 + 门包脚
  skin(-33, 0, 8, 26, PV);
  kit.building(-33.4, -11.5, 7, 5, 3.2, AD, { doors: [{ side: 2, at: 0.25, w: 2.4 }], roofKey: AD, floor: PV });
  kit.building(-32.6, 11.5, 6, 5, 3.0, AD, { doors: [{ side: 3, at: -0.2, w: 2.4 }], roofKey: AD });
  for (const [x, z, s, i] of [[-30.4, -5.4, 1.3, 0], [-29.6, 4.6, 1.2, 1], [-31.4, 6.4, 1.1, 3]]) kit.crate(x, z, s, 1.05, s, i, 0, 6);
  kit.crate(-31.4, 6.4, 1.0, 0.5, 1.0, 4, 1.05, -10);
  kit.barrel(-30.8, -4.1, 'red'); kit.barrel(-30.1, -3.5, 'green');
  kit.sandbags(-31.4, -1.2, 2.6, 0.85, 0.85);
  for (const s of [-1, 1]) box(-29.4, 0.06, s * 7, 2.2, 0.12, 0.55, 0, { py: PV, px: ST, nx: ST, pz: ST, nz: ST });
  kit.lamp(-28.9, 3.3, -7, true); kit.lamp(-28.9, 3.3, 7, false);

  // GR（保卫者）院落：远端，三个怪口都在这里
  skin(33, 0, 7.5, 26, PV);
  kit.building(34.6, 12.6, 4.5, 3.5, 3.2, AD, { doors: [{ side: 3, at: -0.25, w: 2.4 }], roofKey: AD });
  kit.crate(30.2, -4.6, 1.3, 1.05, 1.3, 4, 0, 0); kit.crate(29.8, 4.6, 1.2, 1.05, 1.2, 0, 0, -8);
  kit.barrel(31.6, 0.4, 'red'); kit.barrel(32.4, -0.2, 'red');
  kit.sandbags(35.6, -5.2, 2.4, 0.85, 0.9);
  for (const s of [-1, 1]) box(27.4, 0.06, s * 7, 2.2, 0.12, 0.55, 0, { py: PV, px: ST, nx: ST, pz: ST, nz: ST });
  kit.lamp(28.9, 3.3, -7, true); kit.lamp(28.9, 3.3, 7, false);
  // 水井：院里的路障，怪潮和守军都得绕
  deck(32.5, -9.5, 1.7, 1.7, 0.9, 0, PV);

  // ================== 中路：长巷 + 中央隔断（对狙线）==================
  // 隔断把 56m 直巷切两段，两侧留 2m 通道：保住对狙距离，又不至于是一条纯死亡沟
  kit.wall(-1.2, -3.6, -1.2, 3.6, 0, 2.7, 0.8, ST, { surface: 'stone', mat: 'concrete' });
  const midBox = (cx, cz, s, h, yaw) => {
    box(cx, h / 2, cz, s, h, s, yaw, { py: TM, px: TM, nx: TM, pz: TM, nz: TM });
    solid(cx, h / 2, cz, s, h, s, yaw, { mat: 'wood', bullet: 'pen', surface: 'wood' });
    foot(cx, cz, s, s, yaw, 0.4);
  };
  midBox(1.8, -2.6, 1.5, 1.05, 0.05);
  midBox(1.8, -1.0, 1.2, 0.32, -0.04);
  midBox(2.2, 3.2, 1.3, 0.32, 0.07);
  kit.barrel(7.2, -4.4, 'red'); kit.barrel(7.9, -3.7, 'green'); kit.barrel(-8.4, 4.2, 'red');
  kit.sandbags(-6.2, -4.4, 2.6, 0.85, 0.9);
  kit.sandbags(12.4, 4.2, 2.4, 0.85, 0.9);
  // 中路两端角台：控住中路的人有个能站住的射位（矮阶 0.35 走上去，台面 0.7/1.3 要跳）
  deck(-24.6, 0.6, 4, 3.4, 0.7);
  deck(-22.2, 0.6, 1, 1.6, 0.35);
  deck(24.6, -2.6, 3.2, 2, 1.3);
  deck(22.6, -2.6, 1, 1.6, 0.35);
  ruin(-26.6, -2.6, -26.6, 3.4, 1.35);
  ruin(20.4, 3.2, 25.6, 3.2, 1.4, AD);

  // ================== 猫道（A 侧横巷）==================
  ruin(-16.6, -12.6, -11.4, -12.6, 1.25, AD);
  ruin(-8.2, -9.2, -3.4, -9.2, 1.35);
  kit.sandbags(-25.4, -12.8, 2.4, 0.85, 0.9);
  kit.crate(-25.6, -10.4, 1.2, 1.05, 1.2, 0, 0, 4);
  kit.barrel(-25.2, -8.8, 'green'); kit.barrel(-24.5, -8.4, 'red');
  kit.crate(-6.4, -13.6, 1.4, 1.05, 1.4, 1, 0, -6);
  kit.crate(-6.6, -13.8, 1.1, 0.45, 1.1, 3, 1.05, 12);
  kit.sandbags(2.6, -8.6, 2.4, 0.85, 0.9);
  // 沙坑：坑壁 0.5m（跳得进爬得出，但 NavGrid 视为阻隔，怪只会绕行），做节奏打乱
  const sandPit = (cx, cz, sx, sz) => {
    skin(cx, cz, sx, sz, 'sandGround', 0.04);
    kit.wall(cx - sx / 2, cz - sz / 2, cx + sx / 2, cz - sz / 2, 0, 0.5, 0.4, ST, { surface: 'sand', foot: false });
    kit.wall(cx - sx / 2, cz + sz / 2, cx + sx / 2, cz + sz / 2, 0, 0.5, 0.4, ST, { surface: 'sand', foot: false });
    foot(cx, cz, sx, sz, 0, 0.3);
  };
  sandPit(-10.6, -10.8, 3.4, 2.6);
  sandPit(6.4, -12.4, 3.6, 2.4);

  // ================== B 道：集市 + 侧翼 ==================
  // 摊棚顶 2.8m：人在棚下蹲着打，棚顶的木箱能当预瞄参考点
  function stall(cx, cz, w, d, rot = 0) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (lx, lz) => [cx + c * lx + s * lz, cz - s * lx + c * lz];
    for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
      const [px, pz] = P(lx, lz);
      geom(TM, prims.cyl8, px, 1.4, pz, 0, 0, 0, 0.06, 2.8, 0.06);
      solid(px, 1.4, pz, 0.22, 2.8, 0.22, 0, { mat: 'wood', bullet: 'pen', surface: 'wood' });
    }
    const [tx2, tz2] = P(0, 0);
    box(tx2, 2.8, tz2, w, 0.1, d, rot, 'cloth');
    solid(tx2, 2.8, tz2, w, 0.1, d, rot, { mat: 'wood', bullet: 'pen', surface: 'wood' });
    const [bx, bz] = P(0, d / 2 - 0.4);
    box(bx, 0.4, bz, w * 0.8, 0.8, 0.7, rot, { py: 'canvas', px: TM, nx: TM, pz: TM, nz: TM });
    solid(bx, 0.4, bz, w * 0.8, 0.8, 0.7, rot, { mat: 'wood', bullet: 'pen', surface: 'wood' });
    foot(bx, bz, w, d, rot, 0.32);
  }
  ruin(-16.8, 9.4, -11.6, 9.4, 1.3, AD);
  stall(-8.8, 8.9, 2.8, 2, 0.06);
  stall(-5.6, 12.6, 3, 2, -0.05);
  stall(4.6, 9, 2.6, 1.9, 0.03);
  kit.sandbags(-17.6, 12.2, 2.4, 0.85, 0.9);
  kit.crate(-24.6, 9.6, 1.3, 1.05, 1.3, 0, 0, -5);
  kit.barrel(-24.4, 12.4, 'red'); kit.barrel(-23.6, 12.9, 'green');
  sandPit(12.4, 12.8, 3.2, 2.4);

  // ================== 环沟（基地背后的纵深路线）==================
  for (const s of [-1, 1]) {
    ruin(-11 * s, s * 18.7, -3 * s, s * 18.7, 1.25, AD);
    ruin(6 * s, s * 17.1, 14 * s, s * 17.1, 1.3);
    kit.crate(19 * s, s * 17.6, 1.2, 0.9, 1.2, s > 0 ? 4 : 0, 0, 8);
    kit.barrel(-30 * s, s * 17.9, s > 0 ? 'green' : 'red');
    // 沟底两道车辙：长沟不处理会读成一条纯色带
    skin(-20, s * 18.4, 30, 0.5, 'grime', 0.045);
    skin(-20, s * 17.6, 24, 0.4, 'grime', 0.045);
    for (const px of [-24, 4 * s, 24]) {   // 电线杆与电线：中东小镇的标志线
      geom(TM, prims.cyl8, px, 3.1, s * 16.9, 0, 0, 0, 0.11, 6.2, 0.11);
      solid(px, 3.1, s * 16.9, 0.3, 6.2, 0.3, 0, { mat: 'wood', bullet: 'pen' });
      rod(TM, px - 0.9, 5.6, s * 16.9, px + 0.9, 5.6, s * 16.9, 0.06);
    }
    rod('black', -24, 5.6, s * 16.9, 4 * s, 5.1, s * 16.9, 0.022);
    rod('black', 4 * s, 5.6, s * 16.9, 24, 5.1, s * 16.9, 0.022);
    kit.lamp(-24, 5.2, s * 16.6, false);
  }

  // ================== A 点：半高台 + 端楼（可达但不压制的制高点）==================
  skin(19.5, -8.2, 12, 3.4, PV);
  deck(19.5, -12, 9, 4, 1.5);
  kit.stairs(12.6, -12.2, 15, -12.2, 1.5, 5, 1.7, ST, PV);   // 0.3 一级：走上去不用跳，BOT 也能上台
  kit.crate(17.2, -12.6, 1.3, 0.9, 1.3, 0, 1.5, 5);          // 台顶货箱：站上去能越过南墙
  kit.crate(18.6, -11.4, 1.2, 0.9, 1.2, 1, 1.5, -8);
  kit.crate(20.2, -12.6, 1.4, 0.9, 1.4, 3, 1.5, 12);
  kit.crate(18.6, -11.4, 1.1, 0.45, 1.1, 2, 2.4, 14);
  kit.barrel(15.9, -10.7, 'red', 1.5); kit.barrel(15.9, -13.3, 'green', 1.5);
  // 北侧挡墙 + 断口：从环沟摸上来的人必须先过这道 1.4m 残墙
  kit.wall(15, -13.75, 20.2, -13.75, 1.5, 2.9, 0.6, ST, { surface: 'stone', mat: 'concrete', foot: false });
  kit.wall(22.6, -13.75, 23.6, -13.75, 1.5, 2.9, 0.6, ST, { surface: 'stone', mat: 'concrete', foot: false });
  // 端楼：一层夯土屋 + 可上屋顶。2.76m 看得住 A 点与环沟，却被 3.6m 巷墙挡住中路，不至于压制全场
  kit.building(25.6, -11.8, 4, 4, 2.6, AD, { doors: [{ side: 2, at: 0.15, w: 2.2 }], roofKey: ST, floor: PV });
  stepRun(22.6, -10.6, 22.6, -13.2, 1.5, 2.76, 4, 1.5);   // 台阶全落在台面内，不占 A 点的唯一巷口
  kit.railing(23.4, -9.55, 27.8, -9.55, 2.76, 'railWhite', 0.95, true);
  kit.railing(27.8, -14, 27.8, -9.6, 2.76, 'railWhite', 0.95, true);
  kit.lamp(25.6, 3.1, -9.4, false);

  // ================== B 点：券门 + 房内院 + 箱堆 ==================
  skin(19, 11, 14, 7, PV);
  portal(10.6, 10.2, 3, 90, { th: 1.2, top: 4.6 });
  kit.building(20.2, 12.4, 6, 4, 3, AD, { doors: [{ side: 1, at: -0.15, w: 2.4 }, { side: 3, at: 0.1, w: 2.2 }], roofKey: ST, floor: PV });
  kit.building(26.2, 12.2, 3.6, 3.6, 2.8, AD, { doors: [{ side: 3, at: 0, w: 2.2 }], roofKey: AD });
  // 券廊：三墩两梁的连拱，B 点正脸的身份构件，同时把院子切成两个预瞄角
  for (let i = 0; i < 3; i++) {
    const px = 12.4 + i * 1.6;
    box(px, 1.25, 13.8, 0.6, 2.5, 0.8, 0, { py: PV, px: ST, nx: ST, pz: ST, nz: ST });
    solid(px, 1.25, 13.8, 0.6, 2.5, 0.8, 0, { mat: 'concrete', surface: 'stone' });
    foot(px, 13.8, 0.8, 1, 0, 0.5);
  }
  for (let i = 0; i < 2; i++) {
    const px = 13.2 + i * 1.6;
    box(px, 2.72, 13.8, 1.6, 0.5, 0.7, 0, ST);
    geom(ST, prims.tor, px, 2.5, 13.8, 0, 0, 0, 1.5, 1.5, 1.5);   // 圆券肋：落在两墩之间的过梁下沿
  }
  // 阳台：从 1.4m 石台跳上 2.24m 阳台，再从侧门穿进房里，是 B 点第二条攻入线
  deck(21.2, 9, 2.6, 0.9, 1.4);
  box(20.5, 2.17, 9.9, 5, 0.14, 1.1, 0, { py: PV, px: ST, nx: ST, pz: ST, nz: ST });
  solid(20.5, 2.17, 9.9, 5, 0.14, 1.1, 0, { mat: 'concrete', surface: 'stone' });
  kit.railing(18.1, 9.4, 22.9, 9.4, 2.24, 'railWhite', 0.95, true);
  kit.railing(18.1, 9.4, 18.1, 10.4, 2.24, 'railWhite', 0.95, true);
  kit.railing(22.9, 9.4, 22.9, 10.4, 2.24, 'railWhite', 0.95, true);
  // 箱堆：0.9/1.05 木箱跳上 2.05m 顶层，可越北墙；下层木箱子弹能穿
  kit.crate(16.8, 8.4, 1.6, 0.9, 1.6, 0, 0, 3);
  kit.crate(18.4, 8.6, 1.4, 1.05, 1.4, 1, 0, -5);
  kit.crate(16.9, 8.4, 1.2, 1.05, 1.2, 3, 0.9, 8);
  kit.crate(18.3, 8.6, 1, 0.45, 1, 2, 2.1, -7);
  kit.sandbags(14.6, 11.6, 0.85, 2.6, 0.9);
  kit.barrel(23.2, 10.2, 'red'); kit.barrel(23.9, 9.7, 'green'); kit.barrel(23.6, 10.9, 'red');
  kit.crate(24.6, 7.8, 1.2, 1.05, 1.2, 4, 0, 6);
  kit.lamp(10.6, 3.4, 11.4, false);

  // 环沟腰墙：3.3m 宽的长沟若没人挡，就是一条 79m 的通透旋转线；每道留一个 2.2m 口，绕后变成"逐段抢沟"
  // 位置按中心对称取，保证两边绕后的难度一致
  for (const [x, z0, z1, hole] of [[-18.5, -18.95, -15.65, -17.3], [3, -18.95, -15.65, -17.3], [-3, 15.65, 18.95, 17.3], [18.5, 15.65, 18.95, 17.3]]) {
    wallZ(x, z0, z1, 2.4, AD, [{ at: hole, w: 2.2 }]);
    copingZ(x, z0, z1, 2.4);
  }

  // ================== 旧化与读图细节（只加信息，不改任何路线）==================
  // 墙顶断口：齐平墙顶一眼就是道具，撒一排错落石块才像塌了半边的废墟，顺带盖住分段墙的接缝
  function copingX(z, x0, x1, y, key = ST) {
    for (let x = x0; x < x1 - 0.4; x += 1.3) box(x + 0.6, y + (0.16 + kit.rnd() * 0.3) / 2, z, 1.2, 0.16 + kit.rnd() * 0.3, 0.6, 0, key);
  }
  function copingZ(x, z0, z1, y, key = ST) {
    for (let z = z0; z < z1 - 0.4; z += 1.3) box(x, y + (0.16 + kit.rnd() * 0.3) / 2, z + 0.6, 0.6, 0.16 + kit.rnd() * 0.3, 1.2, 0, key);
  }
  // 窗：暗盘假装"里面是空的"，石框与窗台凸出墙面才吃得住侧光。face 直接写朝哪边开，省得推 yaw 符号
  const FACE_YAW = { px: Math.PI / 2, nx: -Math.PI / 2, pz: 0, nz: Math.PI };
  const FACE_N = { px: [1, 0], nx: [-1, 0], pz: [0, 1], nz: [0, -1] };
  function win(x, y, z, face = 'pz', n = 1) {
    const yaw = FACE_YAW[face], [nx, nz] = FACE_N[face];
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * 1.5;
      const ox = nz * t, oz = nx * t * -1;        // 沿墙面方向排开
      box(x + ox + nx * 0.05, y, z + oz + nz * 0.05, 0.86, 1.06, 0.14, yaw, { px: 'grime', nx: 'grime', pz: 'grime', nz: 'grime' });
      // 窗芯：少数几扇亮着灯，黄沙城里黄昏那一格暖光比任何装饰都值钱
      box(x + ox + nx * 0.14, y, z + oz + nz * 0.14, 0.62, 0.82, 0.05, yaw, (((x * 11 + z * 7) | 0) % 4) === 0 ? 'winLit' : 'winDark');
      box(x + ox + nx * 0.12, y - 0.66, z + oz + nz * 0.12, 1.2, 0.16, 0.3, yaw, ST);
      box(x + ox + nx * 0.12, y + 0.66, z + oz + nz * 0.12, 1.2, 0.2, 0.3, yaw, ST);
    }
  }
  // 石块与乱石堆：沙漠图的"地面噪声"，没有它整张图的地面太干净
  const rock = (x, z, s, y = 0) => {
    geom('sandStone', prims.sph, x, y + s * 0.34, z, kit.rnd() * 2, kit.rnd() * 6, kit.rnd() * 2, s, s * 0.72, s * 0.9);
    if (s > 0.75) solid(x, y + s * 0.3, z, s * 1.15, s * 0.8, s * 1.05, 0, { mat: 'concrete', surface: 'stone' });
  };
  // 墙顶断口：环沟壁、巷墙、基地墙全上，顺带盖住分段墙的接缝
  for (const s of [-1, 1]) {
    copingX(s * 15.4, -37.3, 37.3, 2.9);
    copingX(s * 6, -28.15, 28.15, 3.6);
    copingZ(s * 28.4, -15.15, 15.15, 4.6);
  }
  // 房面开窗：朝向巷子的墙必须有洞，否则"院子"读不成住人的地方
  win(-30.4, 1.9, -9.0, 'pz'); win(-35.2, 1.9, -9.0, 'pz'); win(-33.4, 1.9, -14.0, 'nz', 2);
  win(-31.2, 1.9, 9.0, 'nz'); win(-34.2, 1.9, 9.0, 'nz');
  win(33.2, 1.9, 10.85, 'nz'); win(32.35, 1.9, 12.6, 'nx'); win(36.85, 1.9, 12.6, 'px');
  win(23.6, 1.9, -11.4, 'nx', 2); win(25.6, 1.9, -9.8, 'pz');
  win(17.2, 1.9, 11.8, 'nx'); win(20.4, 1.9, 14.4, 'pz', 2); win(23.2, 1.9, 12.8, 'px');
  win(24.4, 1.9, 12.4, 'nx'); win(28.0, 1.9, 12.4, 'px');
  for (const [x, z, s] of [
    [-34.6, -8.4, 0.9], [-13.4, -8.1, 0.66], [5.2, -14.6, 0.8], [12.8, -6.9, 0.6],
    [-19.4, 8.4, 0.8], [-6.2, 14.6, 0.68], [8.4, 6.9, 0.6], [18.6, 15, 0.78],
    [-33.4, 3.2, 0.7], [31.4, -3.4, 0.8], [-8.4, 18.4, 0.9], [10.4, -18.2, 0.8], [26.4, 18.4, 0.7],
  ]) rock(x, z, s);
  for (const [x, z] of [[-27.4, -16.4], [16.4, 17.1], [-14.4, 17.9]]) {
    rock(x, z, 0.55); rock(x + 0.7, z + 0.4, 0.4); rock(x - 0.5, z + 0.6, 0.45);
  }
  // 水塔：两座基地院角各一罐，给天际线一个非墙的非房的重音
  for (const s of [-1, 1]) {
    const tx = 32 * s, tz = 16.9 * s;
    geom('steel', prims.cyl, tx, 1.7, tz, 0, 0, 0, 0.8, 1.6, 0.8);
    geom('darkSteel', prims.sph, tx, 2.55, tz, 0, 0, 0, 0.8, 0.34, 0.8);
    solid(tx, 1.7, tz, 1.5, 1.7, 1.5, 0, { mat: 'metal' });
    for (const [lx, lz] of [[-0.66, -0.66], [0.66, -0.66], [-0.66, 0.66], [0.66, 0.66]]) {
      geom('darkSteel', prims.cyl8, tx + lx, 0.6, tz + lz, 0, 0, 0, 0.07, 1.2, 0.07);
      solid(tx + lx, 0.6, tz + lz, 0.2, 1.2, 0.2, 0, { mat: 'metal', bullet: 'pen' });
    }
    foot(tx, tz, 1.8, 1.8, 0, 0.45);
  }
  // 室内家具：空房子会被 BOT 当走廊穿，摆点箱子桌子才像"要清的房间"
  kit.crate(-34.8, -10.6, 1.2, 0.9, 1.2, 0, 0, 0);
  kit.crate(-31.2, -13, 1, 0.6, 1, 1, 0, 0);
  kit.crate(-31.4, 12.4, 1.2, 0.9, 1.2, 3, 0, 20);
  kit.crate(35.4, 12.2, 1.1, 0.75, 1.1, 0, 0, 0);
  kit.crate(26.6, -12.6, 1.1, 0.75, 1.1, 1, 0, 0);
  box(19.4, 0.4, 13.4, 1.8, 0.8, 0.9, 0, { py: TM, px: TM, nx: TM, pz: TM, nz: TM });
  solid(19.4, 0.4, 13.4, 1.8, 0.8, 0.9, 0, { mat: 'wood', bullet: 'pen', surface: 'wood' });
  // 房间隔墙：一进屋只有一条视线，清房才有节奏
  kit.wall(-34.9, -11.8, -31.6, -11.8, 0, 2.4, 0.3, AD, { surface: 'stone', mat: 'concrete', open: [{ at: 2.5, w: 1.3 }], foot: false });
  kit.wall(19.2, 12.9, 22.4, 12.9, 0, 2.4, 0.3, AD, { surface: 'stone', mat: 'concrete', open: [{ at: 2.2, w: 1.3 }], foot: false });

  // 宣礼塔：GR 院角的旧塔，是全图的方位标。不做可爬，免得多出第三个压制点
  {
    const tx = 35.4, tz = -13.4;
    geom(AD, prims.cyl, tx, 3, tz, 0, 0, 0, 0.95, 6, 0.95);
    geom(ST, prims.cyl, tx, 6.18, tz, 0, 0, 0, 1.18, 0.36, 1.18);
    geom(TM, prims.cyl, tx, 6.7, tz, 0, 0, 0, 0.1, 0.8, 0.1);
    geom('red', prims.cone, tx, 7.35, tz, 0, 0, 0, 0.34, 0.6, 0.34);
    // 廊台与窗带都做成同轴薄环：圆柱面上贴方窗会露出缝隙，环才贴得住
    geom(ST, prims.cyl, tx, 4.98, tz, 0, 0, 0, 1.3, 0.2, 1.3);
    geom('grime', prims.cyl, tx, 4.4, tz, 0, 0, 0, 0.97, 0.6, 0.97);
    geom('grime', prims.cyl, tx, 2.1, tz, 0, 0, 0, 0.97, 0.4, 0.97);
    solid(tx, 3, tz, 1.9, 6, 1.9, 0, { mat: 'concrete', surface: 'stone' });
    foot(tx, tz, 2.4, 2.4, 0, 0.6);
  }
  // 遮阳棚：门口一块布，成本极低但"有人做生意"的味道全靠它
  function awning(cx, cz, w, d, yawDeg, y = 2.6) {
    const yaw = (yawDeg || 0) * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw);
    box(cx, y, cz, w, 0.08, d, yaw, 'canvas');
    solid(cx, y, cz, w, 0.08, d, yaw, { mat: 'wood', bullet: 'pen', surface: 'wood' });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = cx + c * sx * (w / 2 - 0.2) + s * sz * (d / 2 - 0.15);
      const pz = cz - s * sx * (w / 2 - 0.2) + c * sz * (d / 2 - 0.15);
      rod(TM, px, y - 0.04, pz, px, 0.15, pz, 0.045);
    }
  }
  awning(-29.1, -7, 2.6, 1.5, 90, 2.9);
  awning(29.1, 7, 2.6, 1.5, 90, 2.9);
  awning(10.6, 12.9, 2.2, 1.4, 0, 2.8);

  // ================== 活物：晾布与半掩门（纯装饰，不碰玩法）==================
  for (const [x, y, z, w, h] of [[-13.6, 2.1, -11.1, 1.3, 1.5], [13.6, 2, 11.8, 1.1, 1.4]]) {
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 3, 4), kit.matDefs.cloth.mat);
    cloth.position.set(x, y, z); cloth.castShadow = true; cloth.name = 'cloth';
    scene.add(cloth);
    kit.anim.push((dt, t) => {
      cloth.rotation.y = Math.sin(t * 0.9 + x) * 0.22;
      cloth.rotation.z = Math.sin(t * 1.7 + z) * 0.06;
    });
    rod(TM, x - w, y + h / 2 + 0.06, z, x + w, y + h / 2 + 0.06, z, 0.03);
  }
  {
    // 半掩门板绕铰链轻摆：院落是静态的，一点风就够"活"
    const g = new THREE.BoxGeometry(1.5, 2.3, 0.08);
    g.translate(0.72, 0, 0);
    const door = new THREE.Mesh(g, kit.matDefs.timber.mat);
    door.position.set(-28.05, 1.18, -5.5);
    door.castShadow = true; door.receiveShadow = true; door.name = 'door';
    scene.add(door);
    kit.anim.push((dt, t) => { door.rotation.y = -0.55 + Math.sin(t * 0.7) * 0.16; });
  }

  // ================== 远景：沙丘、绿洲剪影与北方山脊 ==================
  // 只给纵深与方位：无碰撞体、不投影、不进小地图，玩家永远走不到，也打不坏
  {
    kit.def('farSand', kit.std({ color: 0xc4ab7e, roughness: 1, metalness: 0 }), 1, { shadow: false, noAO: true });
    kit.def('farRock', kit.std({ color: 0x9d8b6e, roughness: 1, metalness: 0, emissive: 0x3a3226, emissiveIntensity: 0.35 }), 1, { shadow: false, noAO: true });
    kit.def('farTown', kit.std({ color: 0xb3a07e, roughness: 1, metalness: 0, emissive: 0x4a4030, emissiveIntensity: 0.4 }), 1, { shadow: false, noAO: true });
    kit.def('farPalm', kit.std({ color: 0x4e5a34, roughness: 1, metalness: 0 }), 1, { shadow: false, noAO: true });
    // 地台：把图外"脚下是天空"的破口盖住，比 9m 围墙低一截，不会和院子抢明暗
    box(0, -0.14, 0, 460, 0.2, 460, 0, { py: 'farSand' });
    const far = (x, z, w, d, h, key = 'farTown') => box(x, h / 2, z, w, h, d, kit.rnd() * 0.2 - 0.1, { py: key, px: key, nx: key, pz: key, nz: key });
    // 沙丘脊线：南北两侧各一排长短错落的缓丘，读成"图外还是沙漠"
    for (const sgn of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const x = -150 + i * 34 + kit.rnd() * 10, z = sgn * (34 + kit.rnd() * 26);
        far(x, z, 26 + kit.rnd() * 22, 10 + kit.rnd() * 8, 2.5 + kit.rnd() * 6.5, 'farSand');
        far(x + 8, z + sgn * 3, 14, 7, 1.5 + kit.rnd() * 3, 'farSand');
      }
    }
    // 北方山脊：一整排压扁的岩块 + 三座尖峰，是全图最硬的方位线
    for (let i = 0; i < 13; i++) {
      const x = -210 + i * 34, h = 18 + kit.rnd() * 26;
      far(x, -96 - kit.rnd() * 22, 40, 24, h, 'farRock');
      if (i % 4 === 1) geom('farRock', prims.cone, x + 10, h + 7, -100, 0, 0, 0, 13, 15, 11);
    }
    // 东侧绿洲：一片棕榈剪影 + 一座带穹顶的远处村镇，GR 方向不再是纯空
    for (let i = 0; i < 12; i++) {
      const x = 74 + kit.rnd() * 44, z = -26 + kit.rnd() * 54, hh = 5 + kit.rnd() * 5;
      geom('farTown', prims.cyl8, x, hh / 2, z, 0, 0, 0, 0.16, hh, 0.16);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        box(x + Math.cos(a) * 1.5, hh + 0.1, z + Math.sin(a) * 1.5, 3.2, 0.12, 0.9, a, 'farPalm');
      }
    }
    far(96, 8, 20, 16, 7);
    far(96, 8, 12, 10, 11);
    geom('farTown', prims.sph, 96, 12.4, 8, 0, 0, 0, 6.4, 4.2, 6.4);
    box(104, 13, 6, 2.6, 26, 2.6, 0, { py: 'farTown', px: 'farTown', nx: 'farTown', pz: 'farTown', nz: 'farTown' });
    // 西侧 BL 院外再堆一层废墟丘与电线杆，两个基地的背后都不能是"空的"
    far(-104, -6, 22, 16, 6);
    far(-88, 12, 16, 12, 9);
    for (let i = 0; i < 7; i++) {
      const x = -70 - i * 13;
      geom('farTown', prims.cyl8, x, 4, 24 + kit.rnd() * 8, 0, 0, 0, 0.2, 8, 0.2);
    }
  }

  const meshes = kit.flush(scene, opts);

  // ================== 出生点：两列排在院内空地，面朝场内（yaw 指向 +X/-X）==================
  const spawns = { BL: [], GR: [] };
  const zs = [-7, -3.5, 0, 3.5, 7];
  for (const x of [-36.2, -33.8]) for (const z of zs) spawns.BL.push({ x, z, yaw: -Math.PI / 2 });
  for (const x of [36.2, 33.8]) for (const z of zs) spawns.GR.push({ x, z, yaw: Math.PI / 2 });

  return { spawns, lampSpots: kit.lampSpots, meshes, materials: kit.matDefs, funnelTop: null, update: (dt, t) => kit.update(dt, t) };
}
