// 核港（参照 CS「de_nuke」/ CF 经典双层图）
// 坐标：X 为厂区轴（-X 潜伏者侧，+X 保卫者侧与怪口），Z 为管廊方向，Y 向上，地面 Y=0
// 图幅 92×52m，与炼狱小镇/遗迹双桥同档
//
// 经典 Nuke 的味道是"上下两层同时开火"，这里这样落：
//  ① 上层龙门平台（A 层）：z=±17 两条 54×6.5m 的钢格平台，甲板面 3.2m，
//     北缘两道十级钢梯（级差 0.32）落地，两端开口接侧栈桥；平台栏只让出楼梯口与栈桥口
//  ② 下层机房院落（B 层）：平台**底下就是可行走的院子** —— 顶板底面 2.9m，
//     而 NavGrid 只测 0.4~1.8m 净空（>1.7 的实体一律忽略），所以 bot 与怪物照样从平台下面穿，
//     上层纯粹是玩家的侧翼，不会把 AI 关在楼下 —— 这是双层图能不能玩的关键
//  ③ 中央反应堆坑：z 轴两道门洞的矮圈（0.9m 高，能翻进翻出），原点留空可站，
//     是全图最短兵线，也是探照灯与管廊视线交汇的地方
//  ④ 侧向管廊栈桥：x=±26 一条从南平台连到北平台的高栈，绕后与转点用；地面另有两条平行管沟路
//
// 与上两张图同一套纪律：所有构件走 duo 助手，(x,z) 自动落 (-x,-z) 镜像，两分支到达时间靠构造相等。
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

// 混凝土 / 彩钢墙板 / 沥青地坪 —— 厂区的三张底（只在客户端生成，服务端走贴图桩）
export function nukeTextures(T) {
  if (T.deck) return;
  const S = 256;
  const canvasOf = (base) => {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = base; x.fillRect(0, 0, S, S);
    return { c, x };
  };
  // 现浇混凝土：伸缩缝 + 麻面 + 油渍
  const mkDeck = () => {
    const { c, x } = canvasOf('#9c9a92');
    const f = fbm(S, S, 8, 8, 4, 61);
    const h = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      h[i] = f[i] * 0.7;
      const t = 148 + ((f[i] * 40) | 0);
      x.fillStyle = `rgba(${t},${t - 4},${t - 12},0.24)`;
      x.fillRect(i % S, (i / S) | 0, 1, 1);
    }
    x.strokeStyle = 'rgba(70,68,62,0.55)'; x.lineWidth = 2;
    for (const p of [0, S / 2]) { x.beginPath(); x.moveTo(p, 0); x.lineTo(p, S); x.stroke(); x.beginPath(); x.moveTo(0, p); x.lineTo(S, p); x.stroke(); }
    for (let k = 0; k < 7; k++) {                                       // 油渍
      x.fillStyle = 'rgba(30,28,24,0.22)';
      x.beginPath(); x.ellipse(Math.random() * S, Math.random() * S, 10 + Math.random() * 26, 6 + Math.random() * 16, Math.random() * 3, 0, 6.283); x.fill();
    }
    return texSet(c, h, 1, 1.6);
  };
  // 彩钢墙板：竖向压型 + 铆钉列 + 锈水痕
  const mkPanel = () => {
    const { c, x } = canvasOf('#6e7a80');
    const h = new Float32Array(S * S);
    for (let i = 0; i < S; i++) {
      const rib = Math.sin((i / 12) * Math.PI * 2) * 0.5 + 0.5;
      x.fillStyle = `rgba(${96 + rib * 40 | 0},${106 + rib * 40 | 0},${112 + rib * 40 | 0},0.5)`;
      x.fillRect(i, 0, 1, S);
      for (let j = 0; j < S; j++) h[j * S + i] = rib * 0.6;
    }
    x.fillStyle = 'rgba(28,32,36,0.7)';
    for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) x.fillRect(col * 32 + 8, row * 64 + 10, 3, 3);
    const r = fbm(S, S, 4, 14, 4, 37);
    for (let i = 0; i < S * S; i++) {
      if (r[i] > 0.62) { x.fillStyle = `rgba(${128 + ((r[i] - 0.62) * 220) | 0},60,28,${((r[i] - 0.62) * 1.5).toFixed(3)})`; x.fillRect(i % S, (i / S) | 0, 1, 2); }
    }
    return texSet(c, h, 1, 1.8);
  };
  // 沥青地坪：骨料 + 裂缝 + 车道磨光带
  const mkAsphalt = () => {
    const { c, x } = canvasOf('#4c4d4c');
    const f = fbm(S, S, 16, 14, 3, 91);
    const h = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      h[i] = f[i] * 0.4;
      const t = 62 + ((f[i] * 46) | 0);
      x.fillStyle = `rgba(${t},${t},${t - 3},0.42)`;
      x.fillRect(i % S, (i / S) | 0, 1, 1);
    }
    x.strokeStyle = 'rgba(24,24,24,0.5)'; x.lineWidth = 1.4;
    for (let k = 0; k < 7; k++) {
      x.beginPath(); let px = Math.random() * S, py = Math.random() * S;
      x.moveTo(px, py);
      for (let s = 0; s < 4; s++) { px += (Math.random() - 0.5) * 40; py += (Math.random() - 0.5) * 40; x.lineTo(px, py); }
      x.stroke();
    }
    x.fillStyle = 'rgba(92,92,90,0.3)'; x.fillRect(0, S * 0.3, S, 26); x.fillRect(0, S * 0.72, S, 26);
    return texSet(c, h, 1, 1.2);
  };
  T.deck = mkDeck();
  T.panel = mkPanel();
  T.asphalt = mkAsphalt();
}

// PVE：怪口在保卫者一侧的平台下方与大院；补给三对镜像（大院医疗 / 平台下弹药 / 反应堆坑护甲）
export const nukePve = {
  spawns: [{ x: 32, z: -12 }, { x: 32, z: 12 }, { x: 40, z: 0 }, { x: 21, z: 23.4 }, { x: 21, z: -23.4 }],
  supplies: [
    { x: -40.8, z: -8.6, kind: 'med' },     // 潜伏者大院
    { x: 40.8, z: 8.6, kind: 'med' },       // 保卫者大院镜像位
    { x: -14, z: 19.5, kind: 'ammo' },      // 北平台底下的院子：上楼前必须先补弹
    { x: 14, z: -19.5, kind: 'ammo' },      // 南平台下镜像位
    { x: 5.4, z: 0, kind: 'armor' },        // 反应堆坑口：全图最短兵线
    { x: -5.4, z: 0, kind: 'armor' },       // 坑口镜像位
  ],
};

export function buildNuke(scene, T, world, opts = {}) {
  const kit = makeKit(T, world, 508);
  const { rnd, box, solid, geom, prims } = kit;

  // ---------- 材质 ----------
  kit.def('deck', kit.std({ map: T.deck.map, normalMap: T.deck.normalMap, roughness: 0.92, metalness: 0.04 }), 3);
  kit.def('panel', kit.std({ map: T.panel.map, normalMap: T.panel.normalMap, roughness: 0.78, metalness: 0.28 }), 2.6);
  kit.def('asphalt', kit.std({ map: T.asphalt.map, normalMap: T.asphalt.normalMap, roughness: 0.97, metalness: 0.05 }), 3.4);
  kit.plain('concrete', 0xa8a49b, { rough: 0.94, metal: 0.03, tiling: 1.8 });
  kit.plain('warn', 0xd9a227, { rough: 0.6, metal: 0.2, tiling: 1.2 });       // 安全黄
  kit.plain('oxide', 0x8a4a2a, { rough: 0.85, metal: 0.25 });
  kit.plain('glass', 0x24323a, { rough: 0.15, metal: 0.5 });
  kit.def('litWarm', kit.std({ color: 0xffe2b4, emissive: 0xffd08a, emissiveIntensity: 3.2, roughness: 0.5 }), 1, { shadow: false });
  kit.def('redBeacon', kit.std({ color: 0xff3a24, emissive: 0xff2a14, emissiveIntensity: 4.2, roughness: 0.3 }), 1, { shadow: false });

  // ---------- 中心对称助手（与前两张新图同一套）----------
  const wall = (x0, z0, x1, z1, h, th, key, o) => {
    kit.wall(x0, z0, x1, z1, 0, h, th, key, o);
    kit.wall(-x0, -z0, -x1, -z1, 0, h, th, key, o);
  };
  const bx = (x, y, z, sx, sy, sz, yaw, key) => { box(x, y, z, sx, sy, sz, yaw, key); box(-x, y, -z, sx, sy, sz, -yaw, key); };
  const sd = (x, y, z, sx, sy, sz, yaw, o) => { solid(x, y, z, sx, sy, sz, yaw, o); solid(-x, y, -z, sx, sy, sz, -yaw, o); };
  const ft = (x, z, sx, sz, yaw, dark) => { kit.foot(x, z, sx, sz, yaw, dark); kit.foot(-x, -z, sx, sz, -yaw, dark); };
  const gm = (key, g, x, y, z, rx, ry, rz, sx, sy, sz) => {
    geom(key, g, x, y, z, rx, ry, rz, sx, sy, sz);
    geom(key, g, -x, y, -z, rx, -ry, -rz, sx, sy, sz);
  };
  const cr = (x, z, w, h, d, idx, yawDeg = 0) => { kit.crate(x, z, w, h, d, idx, 0, yawDeg); kit.crate(-x, -z, w, h, d, idx, 0, -yawDeg); };
  const ct = (x, z, yawDeg, len, colorIdx, level = 0) => { kit.container(x, z, yawDeg, len, colorIdx, level); kit.container(-x, -z, -yawDeg, len, colorIdx, level); };
  const br = (x, z, key) => { kit.barrel(x, z, key); kit.barrel(-x, -z, key); };
  const sb = (x, z, w, d, h) => { kit.sandbags(x, z, w, d, h); kit.sandbags(-x, -z, w, d, h); };
  const lp = (x, y, z, lit) => { kit.lamp(x, y, z, lit); kit.lamp(-x, y, -z, lit); };
  const st = (x0, z0, x1, z1, h, n, w, key, top) => {
    kit.stairs(x0, z0, x1, z1, h, n, w, key, top);
    kit.stairs(-x0, -z0, -x1, -z1, h, n, w, key, top);
  };
  const rail = (x0, z0, x1, z1, y, key, h) => {
    kit.railing(x0, z0, x1, z1, y, key, h, true);
    kit.railing(-x0, -z0, -x1, -z1, y, key, h, true);
  };
  const bld = (cx, cz, w, d, h, key, o) => {
    kit.building(cx, cz, w, d, h, key, o);
    const doors = (o.doors || []).map((dr) => ({ ...dr, side: (dr.side + 2) % 4, at: -(dr.at || 0) }));
    kit.building(-cx, -cz, w, d, h, key, { ...o, doors, yaw: -(o.yaw || 0) });
  };
  // 保温管道：一律架在 2.2m 以上或只作外观，绝不影响地面寻路
  const pipe = (x0, z0, x1, z1, y, r, key = 'darkSteel') => {
    kit.rod(key, x0, y, z0, x1, y, z1, r);
    kit.rod(key, -x0, y, -z0, -x1, y, -z1, r);
    for (const t of [0.25, 0.75]) for (const sx of [1, -1]) {
      const px = sx * (x0 + (x1 - x0) * t), pz = (z0 + (z1 - z0) * t);
      gm('concrete', prims.cyl8, px, y - r - 0.5, pz, 0, 0, 0, 0.22, 1.0, 0.22);
    }
  };

  // 卧式储罐：3.5m 高，是厂区里最有效的视线切割器（0.9m 的坑沿挡不住 1.6m 的视线）
  const tank = (x, z, L = 6, r = 1.7, key = 'steel') => {
    gm(key, prims.cyl, x, r + 0.05, z, Math.PI / 2, 0, 0, r, L, r);
    for (const dz of [-1, 1]) gm('oxide', prims.cyl, x, r + 0.05, z + dz * L / 2, Math.PI / 2, 0, 0, r * 1.04, 0.18, r * 1.04);
    for (const dz of [-1, 1]) bx(x, 0.42, z + dz * (L / 2 - 0.5), r * 2 + 0.2, 0.84, 0.7, 0, 'concrete');
    sd(x, r + 0.05, z, r * 2, r * 2, L, 0, { mat: 'metal', bullet: 'block', surface: 'metal' });
    ft(x, z, r * 2 + 0.4, L + 0.6, 0, 0.5);
  };

  // ---------- 地面：整体地坪 + 中央浇筑区 ----------

  solid(0, -0.5, 0, 96, 1, 56, 0, { mat: 'concrete', surface: 'concrete', tag: 'deck' });
  box(0, 0.02, 0, 92, 0.04, 52, 0, 'asphalt');
  box(0, 0.035, 0, 26, 0.03, 22, 0, 'deck');                 // 中央浇筑平台（反应堆坑所在）
  for (const [x0, z0, x1, z1] of [[-46, -26, 46, -26], [-46, 26, 46, 26], [-46, -26, -46, 26], [46, -26, 46, 26]]) {
    kit.wall(x0, z0, x1, z1, 0, 11, 0.7, 'panel', { foot: false });
  }

  // ---------- 中央反应堆坑：矮圈 + 南北两道门洞（原点必须可站可达）----------
  {
    const R = 3.2;
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const zAbs = Math.abs(Math.sin(a));
      if (zAbs > 0.92) continue;                              // 南北各留一道 2.6m 门洞
      box(Math.cos(a) * R, 0.45, Math.sin(a) * R, 1.25, 0.9, 0.5, a, 'concrete');
      solid(Math.cos(a) * R, 0.45, Math.sin(a) * R, 1.25, 0.9, 0.5, a, { mat: 'concrete', surface: 'concrete' });
    }
    box(0, 0.06, 0, 5.2, 0.06, 5.2, 0, 'warn');              // 坑底黄格警示铺装（纯视觉）
    for (const [dx, dz] of [[2.2, 2.2], [-2.2, 2.2], [2.2, -2.2], [-2.2, -2.2]]) {
      box(dx, 1.7, dz, 0.5, 3.4, 0.5, 0, 'steel');           // 四根控制柱：2.4m 以下不挡视线？会挡，正好当地面掩体
      solid(dx, 1.7, dz, 0.5, 3.4, 0.5, 0, { mat: 'metal', bullet: 'block', surface: 'metal' });
    }
    gm('redBeacon', prims.sph, 0, 2.0, 0, 0, 0, 0, 0.26, 0.22, 0.26);
    geom('darkSteel', prims.cyl, 0, 1.0, 0, 0, 0, 0, 0.3, 2.0, 0.3);
    ft(0, 0, 6.4, 6.4, 0, 0.45);
  }

  // ---------- 上层龙门平台（北 z=+17，南由镜像自动落位）----------
  // 甲板横跨到 x=±27，把两侧栈桥接进来：高架不是两块孤岛，而是一整圈能不落地绕行的高架环道
  {
    const dz = 17, top = 3.2;
    bx(0, top - 0.15, dz, 54, 0.3, 6.5, 0, 'grating');       // 甲板：底面 2.9m → NavGrid 忽略，底下照样能走
    sd(0, top - 0.15, dz, 54, 0.3, 6.5, 0, { mat: 'metal', bullet: 'block', surface: 'metal' });
    for (const px of [-18, -9, 9, 18]) {                      // 立柱：0~2.9m，会挡 nav，所以只摆 4 根且离主通道
      bx(px, 1.45, dz, 0.9, 2.9, 0.9, 0, 'concrete');
      sd(px, 1.45, dz, 0.9, 2.9, 0.9, 0, { mat: 'concrete', surface: 'concrete' });
      bx(px, 2.95, dz, 1.3, 0.2, 1.3, 0, 'concrete');
    }
    // 北沿栏分三段：两处楼梯口（x=-16 与 x=6）必须留缺口，否则上楼的人撞在栏杆上
    for (const [a, b] of [[-27, -17.4], [-14.6, 3.4], [8.6, 27]]) rail(a, dz + 3.3, b, dz + 3.3, top, 'railYellow', 1.1);
    // 南沿栏只铺 |x|≤24.4：这样本条与它的镜像各留一段缺口，两侧栈桥在南北两个平台上都进得去
    // （曾经写成 -24.4→27，镜像后南平台的西栈桥口被栏封死，高架环道就断了一头）
    rail(-24.4, dz - 3.3, 24.4, dz - 3.3, top, 'railYellow', 1.1);
    rail(-27.05, dz + 3.2, -27.05, 16.2, top, 'railYellow', 1.1);
    rail(27.05, dz + 3.2, 27.05, 16.2, top, 'railYellow', 1.1);
    st(-16, 25.0, -16, 20.0, top, 10, 2.2, 'darkSteel', 'grating');    // 北边缘道 → 甲板
    st(6, 25.0, 6, 20.0, top, 10, 2.2, 'darkSteel', 'grating');
    // 甲板上的控制室与料箱：站上去有得躲，不是空平台
    bx(-14, top + 1.3, dz, 5.0, 2.6, 4.0, 0, 'panel');
    sd(-14, top + 1.3, dz, 5.0, 2.6, 4.0, 0, { mat: 'metal', bullet: 'block', surface: 'metal' });
    bx(-14, top + 2.7, dz, 5.6, 0.3, 4.6, 0, 'concrete');
    bx(-16.4, top + 1.4, dz - 2.1, 0.2, 1.4, 2.6, 0, 'glass');          // 控制室侧窗
    bx(-14, top + 1.5, dz - 2.08, 3.8, 1.1, 0.06, 0, 'litWarm');        // 正面灯带：黄昏时整座厂区就这一片暖光
    bx(6, top + 0.75, dz + 1.6, 2.4, 1.5, 1.6, 0, 'canvas');
    sd(6, top + 0.75, dz + 1.6, 2.4, 1.5, 1.6, 0, { mat: 'wood', bullet: 'pen', surface: 'wood' });
    bx(11, top + 0.6, dz - 1.8, 3.2, 1.2, 1.2, 0, 'warn');
    sd(11, top + 0.6, dz - 1.8, 3.2, 1.2, 1.2, 0, { mat: 'metal', bullet: 'block', surface: 'metal' });
    lp(-4, top + 2.4, dz, false);
    // 平台下的院子：地坪铺装 + 两排管线 + 一组料堆（地面的主要掩体）
    // 料堆一律往院子深处摆（z≈17.4~18.4）：贴着平台沿摆会把入口堵在半路，绕行代价立刻失真
    box(0, 0.045, dz, 48, 0.03, 5.4, 0, 'deck');
    pipe(-24, dz + 1.4, 24, dz + 1.4, 2.35, 0.34);
    cr(-6, dz + 0.7, 1.6, 1.5, 1.5, 4, 6);
    cr(-4.2, dz + 1.2, 1.3, 1.2, 1.3, 1, -8);
    sb(2.5, dz + 0.4, 2.6, 0.9, 0.9);
    br(14.5, dz + 0.8, 'red'); br(15.2, dz + 1.4, 'green');
  }

  // ---------- 侧向高栈桥（x=-26 一条南北通联，东岸由镜像自动落位）----------
  // 与甲板同高（3.2）并在 z=13.7~16 一段插进南北平台，于是整条高架成环
  {
    const wx = -26;
    bx(wx, 3.05, 0, 3.2, 0.3, 32, 0, 'grating');
    sd(wx, 3.05, 0, 3.2, 0.3, 32, 0, { mat: 'metal', bullet: 'block', surface: 'metal' });
    for (const pz of [-13, -6.5, 6.5, 13]) {
      bx(wx, 1.5, pz, 0.9, 3.0, 0.9, 0, 'concrete');
      sd(wx, 1.5, pz, 0.9, 3.0, 0.9, 0, { mat: 'concrete', surface: 'concrete' });
    }
    rail(wx - 1.55, -16, wx - 1.55, -1.2, 3.2, 'railYellow', 1.1);      // 西沿：中段让口给楼梯
    rail(wx - 1.55, 1.2, wx - 1.55, 16, 3.2, 'railYellow', 1.1);
    rail(wx + 1.55, -16, wx + 1.55, 13.7, 3.2, 'railYellow', 1.1);      // 东沿一直留到进平台为止
    st(-31.6, 0, wx - 1.7, 0, 3.2, 8, 2.2, 'darkSteel', 'grating');     // 大院与厂区之间的地面 → 栈桥
  }

  // ---------- 厂房与料场：地面两条平行管沟路的界墙 ----------
  // 注意：duo 助手会自动落镜像，所以每条构件只写一次（写两遍就是两份几何 + 两份碰撞体）
  bld(-27, -23, 9, 5, 5.4, 'panel', { roofKey: 'concrete', th: 0.45, floor: 'deck', doors: [{ side: 2, at: -0.2, w: 3.0 }, { side: 0, at: 0.15, w: 2.4 }] });
  bld(-19, -8, 9, 7, 5.6, 'panel', { roofKey: 'concrete', th: 0.45, doors: [{ side: 0, at: 0.2, w: 2.6 }, { side: 3, at: -0.1, w: 2.4 }] });
  // 亮着的窗缝：夜班控制室的光，黄昏模式下整片厂区只有这几条暖色（纯贴片，不长碰撞体）
  bx(-23.78, 3.0, -8, 0.06, 1.1, 3.4, 0, 'litWarm');
  bx(-27, 3.2, -20.78, 3.0, 1.0, 0.06, 0, 'litWarm');
  // 管沟界墙：把厂区直视线切成 12m 一段（墙高 3.4，两端都留开口）
  wall(-13, -3.6, -13, -1.2, 3.4, 0.45, 'concrete');
  wall(-13, 1.2, -13, 3.6, 3.4, 0.45, 'concrete');
  pipe(-9.5, -6.5, -9.5, 6.5, 2.5, 0.3, 'oxide');

  // ---------- 料场与储罐：把 60m 长的中轴直视线折成 12m 一段 ----------
  // 反应堆坑的矮圈只有 0.9m，挡不住 1.6m 的视线，所以真正切割视线的是这些 3m 以上的大家伙
  tank(-21.5, 0);
  bld(0, -10.5, 6, 4.4, 3.6, 'concrete', { roofKey: 'deck', th: 0.4, doors: [{ side: 0, at: 0.1, w: 2.6 }, { side: 2, at: -0.15, w: 2.4 }] });
  ct(-7.5, 8.5, 90, 20, 3);
  ct(-7.5, -8.5, 90, 20, 1);
  tank(-14.6, 12.6, 5, 1.35, 'oxide');
  tank(-14.6, -12.6, 5, 1.35, 'oxide');

  // ---------- 基地大院（x=±34 墙板，各两个院门）----------
  wall(-34, -25.3, -34, -10.4, 6.4, 0.5, 'panel');
  wall(-34, -5.6, -34, 5.6, 6.4, 0.5, 'panel');
  wall(-34, 10.4, -34, 25.3, 6.4, 0.5, 'panel');
  wall(-34, -10.4, -34, -5.6, 6.4, 0.5, 'panel', { open: [{ at: 2.4, w: 2.8 }] });
  wall(-34, 5.6, -34, 10.4, 6.4, 0.5, 'panel', { open: [{ at: 2.4, w: 2.8 }] });
  wall(-37.5, -12, -37.5, -6.4, 2.2, 0.45, 'concrete');
  wall(-37.5, 6.4, -37.5, 12, 2.2, 0.45, 'concrete');
  ct(-41.5, 20, -90, 20, 2);
  ct(-43.5, -19, -90, 20, 5);
  sb(-36.2, 0, 2.6, 1.0, 1.0);
  cr(-42.6, 10.8, 1.4, 1.4, 1.4, 0, 10);
  cr(-40.4, -11.2, 1.2, 1.2, 1.2, 3, -12);
  lp(-36, 4.4, -8.6, false);
  lp(-36, 4.4, 8.6, false);

  // ---------- 掩体密度：厂区空档补料堆、油桶与沙袋 ----------
  for (const [x, z, k] of [[-22.6, -22.4, 0], [-15.4, 22.6, 1], [-8.6, -23.4, 2], [-29.4, -14.6, 3], [-29.4, 14.6, 4], [-6.2, 23.4, 5], [-19.6, 3.4, 0], [-24.6, -4.6, 1]]) {
    if (k % 3 === 0) cr(x, z, 1.5, 1.4, 1.5, 4, 6);
    else if (k % 3 === 1) sb(x, z, 2.4, 0.9, 0.9);
    else { br(x, z, 'red'); cr(x + 0.8, z + 0.5, 1.1, 1.1, 1.1, 2, -8); }
  }
  // 冷却塔只放在图外当方位标（见远景）：厂区内 8m 大的筒体必然压在基地大院与集装箱上，
  // 而且会把边缘道掐死，bot 的绕行代价立刻失真
  // 灯：真实点光源池限 4 盏，每处落镜像 → 只点 2 处
  for (const [x, z, lit] of [[-22, -13.5, 1], [-9, 12.5, 0], [-30, 3.5, 1], [-3.5, -22, 0]]) {
    geom('darkSteel', prims.cyl8, x, 2.8, z, 0, 0, 0, 0.09, 5.6, 0.09);
    geom('darkSteel', prims.cyl8, -x, 2.8, -z, 0, 0, 0, 0.09, 5.6, 0.09);
    kit.lamp(x, 5.5, z, !!lit);
    kit.lamp(-x, 5.5, -z, !!lit);
  }

  // ---------- 远景：工业山脊 + 远处烟囱与管廊（纯视觉，不长碰撞体）----------
  {
    kit.def('farGround', kit.std({ color: 0x3c4148, roughness: 1, metalness: 0 }), 1, { shadow: false, noAO: true });
    kit.def('farPlant', kit.std({ color: 0x565f68, roughness: 1, metalness: 0.2, emissive: 0x1c2126, emissiveIntensity: 0.45 }), 1, { shadow: false, noAO: true });
    box(0, -0.12, 0, 440, 0.2, 440, 0, { py: 'farGround' });
    const ridge = (x, z, w, d, h) => box(x, h / 2, z, w, h, d, 0, { py: 'farPlant', px: 'farPlant', nx: 'farPlant', pz: 'farPlant', nz: 'farPlant' });
    for (const [rad, n] of [[72, 10], [114, 13], [170, 16]]) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rad * 0.019;
        const x = Math.cos(a) * rad * 1.22, z = Math.sin(a) * rad * 0.74;
        if (Math.abs(x) < 52 && Math.abs(z) < 30) continue;
        const w = 10 + rnd() * 18, d = 8 + rnd() * 14;
        ridge(x, z, w, d, 6 + rnd() * (rad > 140 ? 22 : 12));
        if (rnd() > 0.55) geom('farPlant', prims.cyl, x + w * 0.3, 6 + rnd() * 8, z, 0, 0, 0, 0.7, 14, 0.7);   // 远处储罐与烟囱
      }
    }
    const cx = -124, cz = 70;                                  // 远处双曲线冷却塔群：厂区方位标
    for (const [ox, oz, s] of [[0, 0, 1], [22, -6, 0.8], [-18, 8, 0.7]]) {
      geom('farPlant', prims.cyl, cx + ox, 9 * s, cz + oz, 0, 0, 0, 6.2 * s, 18 * s, 6.2 * s);
      geom('farPlant', prims.cyl, cx + ox, 18.4 * s, cz + oz, 0, 0, 0, 7.4 * s, 1.2 * s, 7.4 * s);
    }
  }

  const meshes = kit.flush(scene, opts);

  const spawns = { BL: [], GR: [] };
  for (let i = 0; i < 10; i++) {
    const zz = -7 + (i % 5) * 3.5, xx = -42 + Math.floor(i / 5) * 2.6;
    spawns.BL.push({ x: xx, z: zz, yaw: -Math.PI / 2 });
    spawns.GR.push({ x: -xx, z: -zz, yaw: Math.PI / 2 });
  }
  return {
    spawns, lampSpots: kit.lampSpots, meshes, materials: kit.matDefs, funnelTop: null,
    update: (dt, t) => kit.update(dt, t),
  };
}
