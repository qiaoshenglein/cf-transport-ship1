// 黑色城镇（参照 CS「cs_italy」/ CF「黑色城镇」）
// 坐标：X 为镇长轴（-X 潜伏者基地，+X 保卫者基地与怪口），Z 为街宽方向，Y 向上，街道 Y=0
// 设计意图：两条平行主街 + 中间一块可穿插的房地 + 中央喷泉广场；视距压在 8~18m，转角战为主
import * as THREE from 'three';
import { makeKit } from './mapkit.js';
import { fbm, normalFromHeight } from './textures.js';

const X0 = -38, X1 = 38, Z0 = -20, Z1 = 20;

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

// 城镇材质只在客户端生成（服务端走贴图桩，build 里绝不碰 canvas）
export function townTextures(T) {
  if (T.plaster) return;
  const S = 256;
  const canvasOf = (base) => {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = base; x.fillRect(0, 0, S, S);
    return { c, x };
  };
  // 灰泥墙：抹刀纹理 + 落雨污渍 + 细裂
  const mkPlaster = () => {
    const { c, x } = canvasOf('#b3aa9b');
    const f = fbm(S, S, 4, 3, 5, 21), g = fbm(S, S, 14, 5, 3, 77);
    const h = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      h[i] = f[i] * 0.8 + g[i] * 0.2;
      const px = i % S, py = (i / S) | 0;
      x.fillStyle = `rgba(${f[i] > 0.55 ? '214,206,190' : '96,88,78'},${(0.05 + g[i] * 0.16).toFixed(3)})`;
      x.fillRect(px, py, 1, 1);
    }
    // 雨渍：从墙顶垂下的深色条
    for (let k = 0; k < 22; k++) {
      const px = Math.random() * S, w = 1 + Math.random() * 5, len = 30 + Math.random() * 120;
      const gr = x.createLinearGradient(0, 0, 0, len);
      gr.addColorStop(0, 'rgba(48,44,40,0.34)'); gr.addColorStop(1, 'rgba(48,44,40,0)');
      x.fillStyle = gr; x.fillRect(px, 0, w, len);
    }
    x.strokeStyle = 'rgba(60,54,48,0.32)'; x.lineWidth = 1;
    for (let k = 0; k < 10; k++) {
      x.beginPath(); let px = Math.random() * S, py = Math.random() * S;
      x.moveTo(px, py);
      for (let s = 0; s < 5; s++) { px += (Math.random() - 0.5) * 26; py += Math.random() * 18; x.lineTo(px, py); }
      x.stroke();
    }
    return texSet(c, h, 1, 1.1);
  };
  // 石板路：逐块石头 + 凹陷接缝 + 湿斑
  const mkCobble = () => {
    const { c, x } = canvasOf('#6f6b68');
    const f = fbm(S, S, 8, 8, 4, 91);
    const h = new Float32Array(S * S);
    const cw = 64, ch = 42;
    for (let row = 0; row * ch < S; row++) {
      const off = (row % 2) * cw * 0.5;
      for (let col = -1; col * cw < S + cw; col++) {
        const px = col * cw + off, py = row * ch;
        const tone = 96 + ((Math.random() * 46) | 0);
        x.fillStyle = `rgb(${tone},${tone - 3},${tone - 8})`;
        x.fillRect(px + 2, py + 2, cw - 4, ch - 4);
        x.strokeStyle = 'rgba(30,28,26,0.55)'; x.lineWidth = 2;
        x.strokeRect(px + 2, py + 2, cw - 4, ch - 4);
      }
    }
    for (let i = 0; i < S * S; i++) {
      h[i] = f[i];
      x.fillStyle = `rgba(20,24,30,${(f[i] * 0.16).toFixed(3)})`;
      x.fillRect(i % S, (i / S) | 0, 1, 1);
    }
    // 中段水洼：把石头压暗并加一点镜面感
    x.fillStyle = 'rgba(30,44,52,0.28)';
    x.beginPath(); x.ellipse(S * 0.62, S * 0.4, 46, 26, 0.4, 0, 6.283); x.fill();
    return texSet(c, h, 1, 2.4);
  };
  // 陶瓦屋顶：一排排瓦拱 + 苔痕
  const mkTile = () => {
    const { c, x } = canvasOf('#8a4530');
    const h = new Float32Array(S * S);
    for (let i = 0; i < S; i++) {
      const k = Math.sin((i / S) * Math.PI * 8) * 0.5 + 0.5;
      for (let j = 0; j < S; j++) h[j * S + i] = k * 0.7 + Math.sin(j / 7) * 0.08;
    }
    for (let band = 0; band * 32 < S; band++) {
      x.fillStyle = band % 2 ? 'rgba(0,0,0,0.14)' : 'rgba(255,210,180,0.1)';
      x.fillRect(0, band * 32, S, 6);
    }
    const m = fbm(S, S, 5, 5, 4, 13);
    for (let i = 0; i < S * S; i++) {
      x.fillStyle = m[i] > 0.62 ? `rgba(60,84,48,${((m[i] - 0.62) * 0.9).toFixed(3)})` : `rgba(30,16,10,${(m[i] * 0.14).toFixed(3)})`;
      x.fillRect(i % S, (i / S) | 0, 1, 1);
    }
    return texSet(c, h, 1, 2.2);
  };
  // 广场大理石：浅底 + 石纹 + 拼缝
  const mkMarble = () => {
    const { c, x } = canvasOf('#c3bdb2');
    const f = fbm(S, S, 3, 9, 5, 55);
    const h = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      h[i] = 0.5;
      x.fillStyle = `rgba(${f[i] > 0.5 ? '150,146,140' : '236,232,224'},${(0.10 + f[i] * 0.22).toFixed(3)})`;
      x.fillRect(i % S, (i / S) | 0, 1, 1);
    }
    x.strokeStyle = 'rgba(90,86,80,0.5)'; x.lineWidth = 1.5;
    for (let k = 0; k <= 2; k++) { const p = k * S / 2; x.beginPath(); x.moveTo(p, 0); x.lineTo(p, S); x.moveTo(0, p); x.lineTo(S, p); x.stroke(); }
    return texSet(c, h, 1, 0.9);
  };
  // 木门 / 百叶：竖向板条 + 铁件
  const mkWood = () => {
    const { c, x } = canvasOf('#5a4227');
    const h = new Float32Array(S * S);
    const f = fbm(S, S, 2, 26, 4, 33);
    for (let i = 0; i < S; i++) {
      if (i % 32 === 0) { x.fillStyle = 'rgba(20,14,8,0.6)'; x.fillRect(i, 0, 2, S); }
      x.fillStyle = `rgba(${120 + ((f[i] * 60) | 0)},${88 + ((f[i] * 40) | 0)},50,0.22)`;
      x.fillRect(i, 0, 1, S);
    }
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) h[j * S + i] = (i % 32 === 0 ? -0.5 : 0.2) + f[i % S] * 0.2;
    x.fillStyle = 'rgba(30,30,34,0.85)'; x.fillRect(14, S * 0.44, S - 28, 7);
    return texSet(c, h, 1, 1.6);
  };
  T.plaster = mkPlaster();
  T.cobble = mkCobble();
  T.tile = mkTile();
  T.marble = mkMarble();
  T.doorWood = mkWood();
}

// PVE：怪口在保卫者院落三处（怪物从 GR 一侧涌入全镇）；补给点全部经 NavGrid 验证可达
export const townPve = {
  spawns: [{ x: 33, z: -16.5 }, { x: 36, z: 2 }, { x: 33, z: 16.5 }],
  supplies: [
    { x: -33.5, z: -14, kind: 'med' },      // 潜伏者院角
    { x: -19.5, z: -13.6, kind: 'ammo' },   // 北街摊后（要贴着街打）
    { x: -8, z: -5.5, kind: 'armor' },      // 中央房地西巷
    { x: 6.5, z: 4.5, kind: 'ammo' },       // 广场东侧房前
    { x: 15.2, z: -12.4, kind: 'med' },     // 钟楼巷口（上屋顶的台阶就在旁边，抢补给必打）
    { x: 28.5, z: 8.6, kind: 'armor' },     // 保卫者院门内侧
  ],
};

// 屋顶可行走但 AI 只按地面 2D 寻路——所以任何路线在地面都必须另有一条通路
export function buildTown(scene, T, world, opts = {}) {
  const kit = makeKit(T, world, 515);
  const { rnd, box, solid, geom, prims } = kit;

  // ---------- 材质 ----------
  kit.def('cobble', kit.std({ map: T.cobble.map, normalMap: T.cobble.normalMap, roughness: 0.98, metalness: 0.03 }), 3);
  kit.def('plaster', kit.std({ map: T.plaster.map, normalMap: T.plaster.normalMap, roughness: 0.94, metalness: 0.02 }), 2.6);
  kit.def('tile', kit.std({ map: T.tile.map, normalMap: T.tile.normalMap, roughness: 0.88, metalness: 0.02 }), 2.2);
  kit.def('marble', kit.std({ map: T.marble.map, normalMap: T.marble.normalMap, roughness: 0.62, metalness: 0.06 }), 2);
  kit.def('doorWood', kit.std({ map: T.doorWood.map, normalMap: T.doorWood.normalMap, roughness: 0.85, metalness: 0.02 }), 1.4);
  kit.plain('shutter', 0x3f5a52, { rough: 0.8, metal: 0.04, tiling: 1.2 });   // 墨绿百叶，cs_italy 的门面色
  kit.plain('stone', 0x8d8578, { rough: 0.9, metal: 0.03, tiling: 1.6 });
  kit.plain('water', 0x2c4a56, { rough: 0.12, metal: 0.5 });
  kit.plain('canvasRed', 0x9c3b32, { rough: 0.92, metal: 0.02 });
  kit.plain('canvasGreen', 0x5c7a4a, { rough: 0.92, metal: 0.02 });
  kit.plain('winDark', 0x12141a, { rough: 0.7, metal: 0.05 });
  kit.def('winLit', kit.std({ color: 0xffd9a0, emissive: 0xffc070, emissiveIntensity: 3.4, roughness: 0.6 }), 1, { shadow: false });

  // ---------- 地面与外围 ----------
  solid(0, -0.5, 0, 84, 1, 48, 0, { mat: 'concrete', surface: 'concrete', tag: 'deck' });
  box(0, 0.02, 0, 80, 0.04, 44, 0, 'cobble');
  box(0, 0.035, 0, 15, 0.03, 15, 0, 'marble');            // 中央广场铺装，视觉上把地图分成两半
  // 外围：10m 高墙挡住任何跳出世界的路（含从钟楼跳下的落点）
  kit.wall(X0, Z0, X1, Z0, 0, 10, 0.7, 'plaster', { foot: false });
  kit.wall(X0, Z1, X1, Z1, 0, 10, 0.7, 'plaster', { foot: false });
  kit.wall(X0, Z0, X0, Z1, 0, 10, 0.7, 'plaster', { foot: false });
  kit.wall(X1, Z0, X1, Z1, 0, 10, 0.7, 'plaster', { foot: false });

  // 两条主街的沿街墙面（z=±11）只封镇内（|x|≤24），基地院门正对街廊，出去就是通路
  const street = (sz) => {
    const gaps = [[-17.2, -14.2], [-6.5, -3.5], [3.5, 6.5], [12.8, 15.8]];
    let cur = -24;
    for (const [a, b] of gaps) {
      if (a > cur) kit.wall(cur, sz, a, sz, 0, 6.6, 0.45, 'plaster');
      cur = b;
    }
    kit.wall(cur, sz, 24, sz, 0, 6.6, 0.45, 'plaster');
  };
  street(-11); street(11);

  // ---------- 出生点院落（两端各两个出口，避免 rotates 全挤一个门） ----------
  for (const s of [1, -1]) {
    const wx = s * 26.5;
    kit.wall(wx, Z0 + 1, wx, -14.5, 0, 6.6, 0.45, 'plaster');
    kit.wall(wx, -10.5, wx, 6.5, 0, 6.6, 0.45, 'plaster');
    kit.wall(wx, 10.5, wx, Z1 - 1, 0, 6.6, 0.45, 'plaster');
    // 两个院门：一个通主街，一个通边巷
    kit.wall(wx, -14.5, wx, -10.5, 0, 6.6, 0.45, 'plaster', { open: [{ at: 2, w: 2.6 }] });
    kit.wall(wx, 6.5, wx, 10.5, 0, 6.6, 0.45, 'plaster', { open: [{ at: 2, w: 2.6 }] });
    // 院内心跳掩体：一堵矮墙 + 边角杂物，被rush时不至于裸奔，也不挡通往院门的路
    box(s * 31, 0.55, 0, 0.4, 1.1, 7, 0, 'stone');
    solid(s * 31, 0.55, 0, 0.4, 1.1, 7, 0, { mat: 'concrete', surface: 'concrete' });
    kit.crate(s * 35.5, -15, 1.3, 1.3, 1.3, 0, 0, 6);
    kit.crate(s * 34, 15.5, 1.2, 1.2, 1.2, 1, 0, -8);
    kit.sandbags(s * 30, -9.5, 2.4, 1.0);
    kit.lamp(wx + s * 0.5, 4.2, -2, false);
    kit.lamp(wx + s * 0.5, 4.2, 12, false);
  }

  // 街廊挡墙：两条街原本是 50m 通直巷道，加几片只到廊腰的隔墙逼出转角，狙击线被掐成 12m 一段
  for (const [fx, fz] of [[-16, -1], [-4, -1], [8, -1], [-8, 1], [4, 1], [16, 1]]) {
    const zEdge = fz < 0 ? -15.5 : 15.5;
    kit.wall(fx, zEdge, fx, zEdge - fz * 2.3, 0, 4.2, 0.4, 'plaster');
    box(fx + 0.9, 0.45, zEdge - fz * 3.1, 1.4, 0.9, 0.5, 0, 'doorWood');   // 挡墙脚一只木箱：蹲位 + 视觉落脚
    solid(fx + 0.9, 0.45, zEdge - fz * 3.1, 1.4, 0.9, 0.5, 0, { mat: 'wood', bullet: 'pen', surface: 'wood' });
  }

  // ---------- 中央房地：可穿行的房间 + 二层阳台 ----------
  // 四栋房子沿 z 排开，每栋两侧开门 → 房间是通道而不是安全屋
  const house = (cx, cz, w, d, side, h) => {
    kit.building(cx, cz, w, d, h, 'plaster', {
      roofKey: 'tile', overhang: 0.35, th: 0.4, floor: 'marble',
      doors: [
        { side, at: -0.15, w: 2.4 },
        { side: (side + 2) % 4, at: 0.2, w: 2.0, h: 2.4 },
      ],
    });
    // 二层阳台：朝街一侧挑出 1.6m，站上去能把整条街收入视野
    const oz = side === 2 ? d / 2 + 0.8 : side === 3 ? -(d / 2 + 0.8) : 0;
    if (h > 5) {
      box(cx, 3.3, cz + oz, w * 0.8, 0.16, 1.6, 0, 'stone');
      solid(cx, 3.3, cz + oz, w * 0.8, 0.16, 1.6, 0, { mat: 'concrete', surface: 'concrete' });
      kit.railing(cx - w * 0.4, cz + oz * 1.95, cx + w * 0.4, cz + oz * 1.95, 3.38, 'railWhite', 1.0, true);
    }
    // 临街窗：两片墨绿百叶夹一扇窗，半数亮着灯 —— 夜街的暖光节奏是这张图的身份
    const fz = cz + (oz || d / 2 + 0.06), fo = oz < 0 ? -1 : 1;   // fo：阳台在哪侧，窗就朝哪侧凸出
    for (const ox of [-w * 0.3, w * 0.3]) box(cx + ox, h - 2.0, fz, 0.52, 1.4, 0.08, 0, 'shutter');
    box(cx, h - 2.0, fz + 0.18 * fo, 1.0, 1.3, 0.06, 0, (((cx * 7 + cz * 13) | 0) % 3) < 2 ? 'winLit' : 'winDark');
    box(cx, h - 2.86, fz + 0.2 * fo, 1.5, 0.14, 0.16, 0, 'stone');
  };
  house(-21, -5.5, 9, 8, 3, 6.6);
  house(-9, 5.5, 10, 8, 2, 6.6);
  house(9.5, -5.5, 9, 8, 3, 6.6);
  house(21, 5.5, 9, 8, 2, 6.6);
  // 东侧单层仓库：屋顶是全镇唯一稳定的高点 flank（4.2m，跳下去不残）
  house(12.5, 5.5, 7, 7, 2, 4.2);
  kit.stairs(7.2, 5.5, 10.4, 5.5, 4.2, 10, 1.8, 'darkSteel', 'stone');

  // 后巷（z=±15.5 一线）把房子背面串起来：绕后路线不经过主街，两端接基地院门
  for (const sz of [-15.5, 15.5]) {
    kit.wall(-24, sz, -6, sz, 0, 5.4, 0.4, 'plaster', { open: [{ at: 9, w: 2.6 }] });
    kit.wall(-6, sz, 6, sz, 0, 5.4, 0.4, 'plaster', { open: [{ at: 6, w: 2.6 }] });
    kit.wall(6, sz, 24, sz, 0, 5.4, 0.4, 'plaster', { open: [{ at: 15, w: 2.6 }] });
  }

  // ---------- 中央广场：喷泉（唯一开阔地，也是狙击靶） ----------
  const fountain = (cx, cz) => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      box(cx + Math.cos(a) * 2.6, 0.45, cz + Math.sin(a) * 2.6, 1.5, 0.9, 0.6, a, 'stone');
    }
    solid(cx, 0.45, cz, 6.2, 0.9, 6.2, 0, { mat: 'concrete', surface: 'concrete' });   // 人不能走进喷泉水池
    geom('marble', prims.cyl, cx, 1.1, cz, 0, 0, 0, 0.5, 2.2, 0.5);
    geom('water', prims.cyl, cx, 0.5, cz, 0, 0, 0, 2.1, 0.16, 2.1);
    geom('marble', prims.sph, cx, 2.5, cz, 0, 0, 0, 0.55, 0.5, 0.55);
    kit.foot(cx, cz, 6.2, 6.2, 0, 0.5);
  };
  fountain(0, 0);
  // 广场四周的矮围栏把开阔地带切成可用的对枪位，而不是无遮无掩的平地
  for (const [x0, z0, x1, z1] of [[-7.4, -7.4, -2.6, -7.4], [2.6, -7.4, 7.4, -7.4], [-7.4, 7.4, -2.6, 7.4], [2.6, 7.4, 7.4, 7.4]]) {
    box((x0 + x1) / 2, 0.5, (z0 + z1) / 2, x1 - x0, 1.0, 0.35, 0, 'stone');
    solid((x0 + x1) / 2, 0.5, (z0 + z1) / 2, x1 - x0, 1.0, 0.35, 0, { mat: 'concrete', surface: 'concrete' });
  }

  // ---------- 商摊与遮阳棚：街道的呼吸感 + 头顶不挡弹 ----------
  const stall = (cx, cz, key) => {
    box(cx, 2.75, cz, 3.4, 0.1, 2.4, 0, key);
    for (const [ox, oz] of [[-1.5, -1.0], [1.5, -1.0], [-1.5, 1.0], [1.5, 1.0]]) geom('darkSteel', prims.cyl8, cx + ox, 1.4, cz + oz, 0, 0, 0, 0.05, 2.6, 0.05);
    box(cx, 0.45, cz, 2.6, 0.9, 1.0, 0, 'doorWood');
    solid(cx, 0.45, cz, 2.6, 0.9, 1.0, 0, { mat: 'wood', bullet: 'pen', surface: 'wood' });
    kit.foot(cx, cz, 3.4, 2.4, 0, 0.35);
  };
  // 摊子贴着街墙摆，走廊中央永远留 3m 以上通路（否则 NavGrid 判定基地互不连通）
  stall(-19.5, -11.9, 'canvasRed'); stall(-10.5, -11.9, 'canvasGreen');
  stall(10.5, 11.9, 'canvasRed'); stall(19.5, 11.9, 'canvasGreen');

  // ---------- 钟楼：全图方位标。屋顶层高 4.2m（十级 0.42 台阶真的能爬上去跳下来），细塔尖只做轮廓 ----------
  const tkx = 21.5, tkz = -14.2;
  kit.building(tkx, tkz, 5.4, 5.4, 4.2, 'stone', { th: 0.55, roofKey: 'tile', doors: [{ side: 1, at: 0, w: 2.2 }], floor: 'marble' });
  box(tkx, 4.4, tkz, 6.2, 0.4, 6.2, 0, 'tile');
  solid(tkx, 4.4, tkz, 6.2, 0.4, 6.2, 0, { mat: 'concrete', surface: 'concrete' });
  for (const dz of [-1, 1]) for (const dx of [-1, 1]) kit.railing(tkx - 2.7 + dx * 0.05, tkz + dz * 2.75, tkx + 2.7 + dx * 0.05, tkz + dz * 2.75, 4.6, 'railWhite', 0.9, true);
  geom('darkSteel', prims.cyl, tkx, 8.4, tkz, 0, 0, 0, 0.16, 6.4, 0.16);        // 塔尖不挡人：NavGrid 只测 0.4~1.8m 的净空
  geom('redLamp', prims.sph, tkx, 11.8, tkz, 0, 0, 0, 0.3, 0.3, 0.3);
  geom('doorWood', prims.cyl, tkx - 2.9, 2.1, tkz, 0, 0, Math.PI / 2, 0.9, 0.25, 0.9);   // 钟面
  kit.stairs(tkx - 7.6, tkz, tkx - 3.4, tkz, 4.2, 10, 1.8, 'darkSteel', 'stone');

  // ---------- 掩体密度：街角必须能贴身体搏（全部摆在 |z|≤9.6 的房地带，走廊留给通路） ----------
  const spots = [
    [-24, -7.5], [-16, -8.8], [-6, -8.5], [4, -8.8], [12, -7.5], [16.5, -8.6],
    [-16, 8.6], [-6, 8.5], [4, 8.8], [12.5, 8.6], [-23, 8.6], [22, -8.6],
  ];
  spots.forEach(([px, pz], i) => {
    if (i % 3 === 0) { kit.crate(px, pz, 1.2, 1.2, 1.2, i % 4, 0, rnd() * 20 - 10); kit.crate(px + 1.3, pz + 0.2, 1.0, 0.9, 1.0, 1, 0, -rnd() * 14); }
    else if (i % 3 === 1) { kit.sandbags(px, pz, 2.6, 0.9); }
    else { kit.barrel(px, pz, 'red'); kit.barrel(px + 0.75, pz - 0.3, 'green'); kit.crate(px - 0.4, pz + 1.1, 1.1, 1.1, 1.1, 3, 0, 8); }
  });
  // 巷口的两只铁箱：掐掉穿过中间块的长视距，但留出 1.3m 身位过人
  for (const [gx, gz] of [[-18.6, -3.5], [17.6, 3.5], [5.6, -9.2], [-5.4, 9.2]]) {
    kit.crate(gx, gz, 1.5, 1.5, 1.5, 4, 0, 4);
    kit.crate(gx + 1.6, gz - 0.2, 1.2, 1.2, 1.2, 5, 0, -6);
  }

  // 街灯：4 盏进真实光源池（game.lampLights 限 4 盏、低画质自动关掉），黄昏模式下街上有一圈圈暖光
  for (const [lx, lz, lit] of [[-19, -12.4, 1], [7, -12.4, 1], [-7, 12.4, 1], [19, 12.4, 1], [-12, 12.4, 0], [12, -12.4, 0]]) {
    geom('darkSteel', prims.cyl8, lx, 2.6, lz, 0, 0, 0, 0.07, 5.2, 0.07);
    kit.lamp(lx, 5.1, lz, !!lit);
  }

  // 招牌与晾衣绳：一点点生活气（纯装饰，不参与判定）
  const sign = (sx, sy, sz, w, h, yaw, key) => box(sx, sy, sz, w, h, 0.06, yaw, key);
  sign(-21, 5.2, -1.4, 2.6, 0.9, 0, 'canvasRed');
  sign(9.5, 5.2, -1.4, 2.2, 0.8, 0, 'canvasGreen');
  sign(21, 5.2, 1.4, 2.6, 0.9, Math.PI, 'doorWood');

  // ---------- 远景天际线：只负责纵深与方位，无碰撞体、不投影、不进小地图 ----------
  // 图外的 400m 地台先把"脚下是虚空"的破口盖住，再压一层城影；黑色城镇的暗是靠层次不是靠糊
  {
    kit.def('farGround', kit.std({ color: 0x2b2f38, roughness: 1, metalness: 0 }), 1, { shadow: false, noAO: true });
    kit.def('farCity', kit.std({ color: 0x343b4a, roughness: 1, metalness: 0, emissive: 0x1d2331, emissiveIntensity: 0.5 }), 1, { shadow: false, noAO: true });
    kit.def('farLit', kit.std({ color: 0xffca7a, emissive: 0xffbe6a, emissiveIntensity: 2.6, roughness: 1 }), 1, { shadow: false, noAO: true });
    box(0, -0.12, 0, 400, 0.2, 400, 0, { py: 'farGround' });
    function farBlock(x, z, w, d, h, key = 'farCity') {
      box(x, h / 2, z, w, h, d, 0, { py: key, px: key, nx: key, pz: key, nz: key });
    }
    // 三道环形住区：近环还能看出屋面，远环只剩剪影，中间的空气厚度全靠雾拉开
    for (const [rad, lit, n] of [[58, 0.55, 8], [92, 0.4, 11], [148, 0, 14]]) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rad * 0.013;
        const x = Math.cos(a) * rad * 1.22, z = Math.sin(a) * rad * 0.7;
        if (Math.abs(x) < 44 && Math.abs(z) < 26) continue;
        const w = 7 + rnd() * 10, d = 6 + rnd() * 8, h = 5 + rnd() * (rad > 120 ? 30 : 15);
        farBlock(x, z, w, d, h);
        farBlock(x + 1.2, z - 0.8, 4 + rnd() * 4, 4, h * 0.22);   // 顶层退台：远看才有"房子"而不是立柱
        // 亮窗：贴着朝向场内的那面墙，夜里一整片城影里就会浮出几点暖光
        if (lit > 0) {
          const fz = z + (z > 0 ? -d / 2 - 0.06 : d / 2 + 0.06);
          for (let k = 0; k < 3; k++) box(x - w * 0.28 + k * w * 0.28, 2.6 + rnd() * Math.max(0.6, h - 3.6), fz, 0.7, 1.1, 0.12, 0, 'farLit');
        }
      }
    }
    // 方位标：远处一座宣礼塔 + 一座水塔，玩家在任何街口都能靠它认方向
    {
      const mx = -96, mz = 52;
      box(mx, 11, mz, 3.6, 22, 3.6, 0, { py: 'farCity', px: 'farCity', nx: 'farCity', pz: 'farCity', nz: 'farCity' });
      box(mx, 23.2, mz, 4.6, 0.7, 4.6, 0, 'farCity');
      geom('farCity', prims.cone, mx, 25.2, mz, 0, 0, 0, 2.1, 3.4, 2.1);
      box(mx + 7, 4.5, mz - 2, 8, 9, 7, 0, 'farCity');
      box(mx + 7, 9.6, mz - 2, 9, 1.2, 8, 0, 'farCity');
      geom('farCity', prims.sph, mx + 7, 11.4, mz - 2, 0, 0, 0, 3.4, 2.2, 3.4);
    }
  }

  const meshes = kit.flush(scene, opts);

  // ---------- 出生点 ----------
  const spawns = { BL: [], GR: [] };
  for (let i = 0; i < 10; i++) {
    const zz = -10 + (i % 5) * 5, xx = -36 + Math.floor(i / 5) * 2.2;
    spawns.BL.push({ x: xx, z: zz, yaw: -Math.PI / 2 });
    spawns.GR.push({ x: -xx, z: -zz, yaw: Math.PI / 2 });
  }
  return {
    spawns, lampSpots: kit.lampSpots, meshes, materials: kit.matDefs, funnelTop: null,
    update: (dt, t) => kit.update(dt, t),
  };
}
