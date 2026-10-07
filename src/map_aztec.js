// 遗迹双桥（参照 CS「de_aztec」/ CF 经典遗迹图）
// 坐标：X 为两岸轴（-X 潜伏者神庙侧，+X 保卫者侧与怪口），Z 为运河流向，Y 向上，岸街 Y=0
// 图幅 92×52m，与炼狱小镇同档
//
// 经典 Aztec 的三样味道，这里是这样落的：
//  ① 中央运河：x∈[-6,6] 一条贯穿南北的可涉水河道（河床 -0.4m，岸边石沿 0.36m —— 处处都能一步跨上岸，
//     不会把人关在水里）。河道里立着几段残柱当视线切割，否则 50m 水槽就是一眼到底的狙击巷
//  ② 双桥：z=-11 与 z=+11 两座石桥跨河，桥面 2.55m（顶板底面 2.25m，NavGrid 只测 0.4~1.8m 净空，
//     所以桥下地面照常可走可寻路）。桥上是从高处压河道的人肉侧翼，桥下是必须穿过去的石门
//  ③ 地下石门大厅：运河正中 z∈[-4.8,4.8] 一段被两堵石墙夹住的厅堂，南北各一道 3.6m 宽的石门，
//     门墩 + 雕花楣石。这是**地面通路**，bot 与怪物都走这里，也是全图最近距离的绞肉点（内含两箱护甲）
// 两岸各一座三级台座神庙 + 废墟墙 + 脚手架 + 棕榈，雾气与暖光把石头的层次拉开
//
// 与炼狱小镇同一套纪律：所有构件走 duo 助手，任何 (x,z) 自动落 (-x,-z) 镜像，两分支到达时间靠构造相等。
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

// 石灰岩 / 苔痕石 / 夯土 / 脚手架木 —— 遗迹的四张底（只在客户端生成，服务端走贴图桩）
export function aztecTextures(T) {
  if (T.lime) return;
  const S = 256;
  const canvasOf = (base) => {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = base; x.fillRect(0, 0, S, S);
    return { c, x };
  };
  // 石灰岩砌块：大方石 + 接缝崩口 + 风化斑
  const mkLime = () => {
    const { c, x } = canvasOf('#c9bda0');
    const f = fbm(S, S, 6, 6, 4, 71);
    const h = new Float32Array(S * S);
    const bw = 64, bh = 40;
    for (let row = 0; row * bh < S; row++) {
      const off = (row % 2) * bw * 0.5;
      for (let col = -1; col * bw < S + bw; col++) {
        const px = col * bw + off, py = row * bh;
        const tone = 196 + ((Math.random() * 26) | 0);
        x.fillStyle = `rgb(${tone},${tone - 8},${tone - 24})`;
        x.fillRect(px + 2, py + 2, bw - 4, bh - 4);
        x.strokeStyle = 'rgba(112,98,74,0.55)'; x.lineWidth = 2;
        x.strokeRect(px + 2, py + 2, bw - 4, bh - 4);
        x.fillStyle = 'rgba(150,134,106,0.35)';                       // 接缝崩口
        x.fillRect(px + 2 + Math.random() * (bw - 10), py + bh - 4, 6, 3);
      }
    }
    for (let i = 0; i < S * S; i++) {
      h[i] = f[i] * 0.8;
      x.fillStyle = `rgba(120,104,80,${(f[i] * 0.16).toFixed(3)})`;
      x.fillRect(i % S, (i / S) | 0, 1, 1);
    }
    return texSet(c, h, 1, 1.9);
  };
  // 苔痕石：石面 + 从缝里爬出来的深绿
  const mkMoss = () => {
    const { c, x } = canvasOf('#8f9078');
    const f = fbm(S, S, 5, 5, 5, 29), m = fbm(S, S, 9, 3, 4, 83);
    const h = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      h[i] = f[i];
      const g = m[i] > 0.52 ? (m[i] - 0.52) * 2.2 : 0;
      x.fillStyle = `rgba(${(52 - g * 20) | 0},${(96 + g * 40) | 0},${(46 + g * 16) | 0},${(0.14 + g * 0.55).toFixed(3)})`;
      x.fillRect(i % S, (i / S) | 0, 1, 1);
    }
    x.strokeStyle = 'rgba(44,52,38,0.5)'; x.lineWidth = 2;
    for (let k = 0; k <= 3; k++) { const p = k * S / 3; x.beginPath(); x.moveTo(p, 0); x.lineTo(p + 8, S); x.stroke(); }
    return texSet(c, h, 1, 1.7);
  };
  // 夯土路：细碎石 + 车辙 + 落叶影
  const mkDirt = () => {
    const { c, x } = canvasOf('#8a6f52');
    const f = fbm(S, S, 12, 10, 3, 13);
    const h = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      h[i] = f[i] * 0.5;
      const t = 118 + ((f[i] * 58) | 0);
      x.fillStyle = `rgba(${t},${(t * 0.8) | 0},${(t * 0.6) | 0},0.3)`;
      x.fillRect(i % S, (i / S) | 0, 1, 1);
    }
    x.fillStyle = 'rgba(72,56,40,0.22)';
    for (const rr of [0.34, 0.66]) x.fillRect(0, rr * S, S, 9);
    for (let k = 0; k < 40; k++) {                                        // 碎石
      x.fillStyle = `rgba(${170 + ((Math.random() * 50) | 0)},${150 + ((Math.random() * 40) | 0)},120,0.5)`;
      x.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 3, 2);
    }
    return texSet(c, h, 1, 1.4);
  };
  // 脚手架木板：竖纹 + 钉帽 + 泥渍
  const mkWood = () => {
    const { c, x } = canvasOf('#6b4c2c');
    const h = new Float32Array(S * S);
    const f = fbm(S, S, 3, 22, 4, 47);
    for (let i = 0; i < S; i++) {
      if (i % 42 === 0) { x.fillStyle = 'rgba(22,14,8,0.6)'; x.fillRect(i, 0, 2, S); }
      x.fillStyle = `rgba(${124 + ((f[i] * 52) | 0)},${86 + ((f[i] * 34) | 0)},50,0.22)`;
      x.fillRect(i, 0, 1, S);
    }
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) h[j * S + i] = (i % 42 === 0 ? -0.5 : 0.2) + f[i % S] * 0.2;
    x.fillStyle = 'rgba(30,28,26,0.75)';
    for (let k = 0; k < 6; k++) x.fillRect(12 + (k % 3) * 90, 14 + ((k / 3) | 0) * 190, 4, 4);
    return texSet(c, h, 1, 1.5);
  };
  T.lime = mkLime();
  T.moss = mkMoss();
  T.dirt = mkDirt();
  T.scaffold = mkWood();
}

// PVE：怪口在保卫者一侧的运河东岸与大院；补给三对镜像（各边一个"出门就有"、一个"桥头抢"、一个"石门内拼"）
export const aztecPve = {
  spawns: [{ x: 32, z: -12 }, { x: 32, z: 12 }, { x: 40, z: 0 }, { x: 30, z: 21 }, { x: 30, z: -21 }],
  supplies: [
    { x: -40.8, z: -8.6, kind: 'med' },     // 潜伏者大院
    { x: 40.8, z: 8.6, kind: 'med' },       // 保卫者大院镜像位
    { x: -17.5, z: -14.2, kind: 'ammo' },   // 南桥西桥头：上桥或下河都绕不开
    { x: 17.5, z: 14.2, kind: 'ammo' },     // 北桥东桥头镜像位
    { x: 0, z: -2.6, kind: 'armor' },       // 石门大厅内：最近也最凶（厅中立柱在 x=±3.4，这里留空）
    { x: 0, z: 2.6, kind: 'armor' },        // 厅内镜像位
  ],
};

export function buildAztec(scene, T, world, opts = {}) {
  const kit = makeKit(T, world, 1337);
  const { rnd, box, solid, geom, prims } = kit;

  // ---------- 材质 ----------
  kit.def('lime', kit.std({ map: T.lime.map, normalMap: T.lime.normalMap, roughness: 0.94, metalness: 0.02 }), 2.8);
  kit.def('moss', kit.std({ map: T.moss.map, normalMap: T.moss.normalMap, roughness: 0.96, metalness: 0.02 }), 2.4);
  kit.def('dirt', kit.std({ map: T.dirt.map, normalMap: T.dirt.normalMap, roughness: 0.99, metalness: 0.02 }), 3.2);
  kit.def('scaffold', kit.std({ map: T.scaffold.map, normalMap: T.scaffold.normalMap, roughness: 0.88, metalness: 0.02 }), 1.6);
  kit.plain('stone', 0xa89a80, { rough: 0.92, metal: 0.03, tiling: 1.8 });
  kit.plain('jungle', 0x35502c, { rough: 0.95, metal: 0.02 });
  kit.plain('frond', 0x4a6b38, { rough: 0.92, metal: 0.02 });
  kit.plain('water', 0x21443f, { rough: 0.08, metal: 0.62 });
  kit.plain('canvasOchre', 0xb08038, { rough: 0.93, metal: 0.02 });
  kit.plain('winDark', 0x141a16, { rough: 0.7, metal: 0.05 });
  kit.def('gold', kit.std({ color: 0xffc94a, emissive: 0xffb020, emissiveIntensity: 3.4, roughness: 0.35, metalness: 0.7 }), 1, { shadow: false });
  kit.def('winLit', kit.std({ color: 0xffd9a4, emissive: 0xffbe76, emissiveIntensity: 3.2, roughness: 0.6 }), 1, { shadow: false });

  // ---------- 中心对称助手（与炼狱小镇同一套）----------
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
  // 棕榈：树干挡身，叶簇纯装饰（不挡弹也不长碰撞）
  const palm = (x, z, hh = 4.2) => {
    gm('scaffold', prims.cyl8, x, hh * 0.5, z, 0, 0, 0.06, 0.17, hh, 0.17);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      geom('frond', prims.cone, x + Math.cos(a) * 0.9, hh + 0.1, z + Math.sin(a) * 0.9, Math.sin(a) * 0.9, -a, Math.cos(a) * 0.9, 0.28, 1.7, 0.28);
      geom('frond', prims.cone, x - Math.cos(a) * 0.9, hh + 0.1, z - Math.sin(a) * 0.9, -Math.sin(a) * 0.9, -a, -Math.cos(a) * 0.9, 0.28, 1.7, 0.28);
    }
    sd(x, hh * 0.5, z, 0.5, hh, 0.5, 0, { mat: 'wood', bullet: 'pen', surface: 'wood' });
  };
  // 三级台座神庙：每级都从地面实心起（0.4/0.8/1.2，级差 0.4 ≤stepHeight，人一层层跳得上去，
  // 而 nav 只看 0.4m 以上的实体 → 台座对 bot 就是块大掩体，不会骗它爬墙）
  const ziggurat = (x, z, w, d) => {
    for (let k = 0; k < 3; k++) {
      const hh = 0.4 * (k + 1), sw = w - k * 3.2, sd2 = d - k * 2.4;
      bx(x, hh / 2, z, sw, hh, sd2, 0, k === 0 ? 'lime' : 'moss');
      sd(x, hh / 2, z, sw, hh, sd2, 0, { mat: 'concrete', surface: 'concrete' });
    }
    bx(x, 1.9, z, 2.6, 1.4, 2.2, 0, 'lime');                 // 顶祠
    sd(x, 1.9, z, 2.6, 1.4, 2.2, 0, { mat: 'concrete', surface: 'concrete' });
    gm('gold', prims.cone, x, 3.1, z, 0, 0, 0, 0.7, 1.0, 0.7);
    st(x + w / 2 - 1.2, z, x + w / 2 + 2.6, z, 1.2, 4, 1.8, 'stone', 'lime');   // 正面踏道
    ft(x, z, w, d, 0, 0.55);
  };

  // ---------- 地面：两岸台地 + 中央运河河床 ----------
  solid(-26, -0.5, 0, 40, 1, 52, 0, { mat: 'concrete', surface: 'concrete', tag: 'deck' });
  solid(26, -0.5, 0, 40, 1, 52, 0, { mat: 'concrete', surface: 'concrete', tag: 'deck' });
  solid(0, -0.9, 0, 12, 1, 52, 0, { mat: 'concrete', surface: 'concrete' });   // 河床：顶面 -0.4
  box(-26, 0.02, 0, 40, 0.04, 52, 0, 'dirt');
  box(26, 0.02, 0, 40, 0.04, 52, 0, 'dirt');
  box(0, -0.09, 0, 11.6, 0.16, 51, 0, 'water');               // 水面（纯视觉，不挡人）
  for (const sx of [-1, 1]) {                                  // 岸边石沿只到 0.36m 且**不加碰撞**：
    box(sx * 6.2, 0.18, 0, 0.7, 0.36, 51, 0, 'lime');         // circleOBB 不看高度，加了就是 51m 的隐形 nav 墙，
  }                                                           // 会把整条河与两岸彻底切断（实测全图互不可达）
  // 外围石墙
  for (const [x0, z0, x1, z1] of [[-46, -26, 46, -26], [-46, 26, 46, 26], [-46, -26, -46, 26], [46, -26, 46, 26]]) {
    kit.wall(x0, z0, x1, z1, 0, 10, 0.7, 'lime', { foot: false });
  }

  // ---------- 河道残柱：把 50m 长水槽的对视切成段（柱子占河道，两岸仍绕得过去）----------
  for (const [x, z, hh] of [[0, -8.6, 1.7], [3.2, -17, 2.4], [-3.2, -20.5, 1.2], [1.4, -23.6, 2.0]]) {
    sd(x, hh * 0.5 - 0.4, z, 1.1, hh + 0.4, 1.1, rnd() * 0.2, { mat: 'concrete', surface: 'concrete' });
    gm('moss', prims.cyl, x, hh * 0.5 - 0.4, z, 0, 0, 0, 0.58, hh, 0.58);
  }

  // ---------- 地下石门大厅（运河正中，地面通路，bot 与怪物都走这里）----------
  for (const sz of [-4.8, 4.8]) {
    wall(-6, sz, -1.9, sz, 3.4, 0.6, 'lime');                 // 门两侧石墙
    wall(1.9, sz, 6, sz, 3.4, 0.6, 'lime');
    box(0, 3.6, sz, 4.6, 0.5, 1.0, 0, 'moss');                // 楣石（底面 3.35m，不挡 nav）
    solid(0, 3.6, sz, 4.6, 0.5, 1.0, 0, { bullet: 'pass', sight: false, mat: 'concrete' });
    for (const dx of [-1.5, 1.5]) {                           // 门墩：贴着门框的硬掩体
      box(dx, 1.7, sz, 0.9, 3.4, 1.3, 0, 'lime');
      solid(dx, 1.7, sz, 0.9, 3.4, 1.3, 0, { mat: 'concrete', surface: 'concrete' });
      box(dx, 3.6, sz, 1.3, 0.35, 1.7, 0, 'stone');
    }
    for (const dx of [-0.9, 0.9]) {                           // 两扇石门叶：半开，卡住门中线
      box(dx, 1.5, sz + (sz < 0 ? 0.45 : -0.45), 0.16, 3.0, 0.9, dx > 0 ? 0.5 : -0.5, 'moss');
      solid(dx, 1.5, sz + (sz < 0 ? 0.45 : -0.45), 0.16, 3.0, 0.9, dx > 0 ? 0.5 : -0.5, { mat: 'wood', bullet: 'block', surface: 'wood' });
    }
  }
  // 厅内：雕纹立柱与两只护甲箱位的落脚石
  for (const dx of [-3.4, 3.4]) {
    box(dx, 1.0, 0, 1.0, 2.0, 1.0, 0, 'lime');
    solid(dx, 1.0, 0, 1.0, 2.0, 1.0, 0, { mat: 'concrete', surface: 'concrete' });
    gm('gold', prims.sph, dx, 2.2, 0, 0, 0, 0, 0.34, 0.26, 0.34);
  }

  // ---------- 双桥（南桥 z=-11，北桥由镜像自动落位）----------
  {
    const bz = -11, deck = 2.55;
    bx(0, deck - 0.15, bz, 22, 0.3, 4.4, 0, 'lime');
    sd(0, deck - 0.15, bz, 22, 0.3, 4.4, 0, { mat: 'concrete', surface: 'concrete' });
    for (const px of [-3, 3]) {                               // 河中桥墩（顶面 2.25m 以下才挡 nav，这里挡住的是水面格）
      bx(px, 0.9, bz, 1.6, 2.7, 1.6, 0, 'moss');
      sd(px, 0.9, bz, 1.6, 2.7, 1.6, 0, { mat: 'concrete', surface: 'concrete' });
    }
    for (const dz of [-1, 1]) rail(-11, bz + dz * 2.05, 11, bz + dz * 2.05, deck, 'railWhite', 1.05);   // 桥栏：挡人也挡 nav
    for (const dz of [-1, 1]) for (const px of [-8, -5, 5, 8]) bx(px, deck - 0.34, bz + dz * 1.9, 0.5, 0.08, 0.5, 0, 'stone');
    st(-15.4, bz, -11.2, bz, deck, 8, 2.4, 'stone', 'lime');  // 西上桥道
    st(11.2, bz, 15.4, bz, deck, 8, 2.4, 'stone', 'lime');    // 东上桥道
    // 桥下的脚手架：给河面一条能蹲的路线（踏板高 2.2m 以下部分才影响 nav，这里全部高于 2.4m）
    for (const px of [-9, -6, 6, 9]) gm('scaffold', prims.cyl8, px, 1.35, bz - 2.6, 0, 0, 0, 0.09, 2.7, 0.09);
    bx(-7.5, 2.75, bz - 2.6, 3.6, 0.12, 0.9, 0, 'scaffold');
    bx(7.5, 2.75, bz - 2.6, 3.6, 0.12, 0.9, 0, 'scaffold');
  }

  // ---------- 两岸台地与神庙 ----------
  ziggurat(-24, -16, 12, 9);
  // 废墟围墙：神庙前庭与岸街之间留两个口子
  wall(-30, -9.6, -18, -9.6, 3.4, 0.5, 'moss');
  wall(-18, -9.6, -18, -4, 3.4, 0.5, 'lime');
  wall(-30, -19.6, -30, -12, 3.0, 0.5, 'lime');
  // 岸街挡墙：沿运河的东西两条街被折成 12m 一段，狙击线掐断
  wall(-13, -6.4, -13, -2.4, 3.6, 0.5, 'lime');
  wall(-9.5, 6.4, -9.5, 10.5, 3.6, 0.5, 'moss');
  wall(-16, 12, -16, 16.5, 3.6, 0.5, 'lime');
  sb(-11.5, -8.6, 2.6, 0.9, 0.9);
  cr(-14.8, -12.6, 1.5, 1.5, 1.5, 3, 8);
  cr(-13.9, -13.1, 1.1, 1.1, 1.1, 1, -6);
  br(-11.2, -18.6, 'red'); br(-10.6, -19.2, 'green');
  cr(-20.4, -5.4, 1.4, 1.3, 1.4, 0, 4);
  sb(-22.8, -3.6, 2.4, 0.9, 0.9);
  palm(-27.6, -11.8, 4.4); palm(-19.4, -21.8, 3.9); palm(-11.4, 14.6, 4.2);
  // 塌落石堆：河滩上的落脚石，能站人能挡弹
  for (const [x, z, s] of [[-8.4, -15.2, 1.6], [-7.6, -20.4, 1.2], [-8.8, -22.6, 1.9], [-7.2, -6.4, 1.1]]) {
    bx(x, s * 0.28, z, s, 0.56, s * 0.8, rnd(), 'moss');
    sd(x, s * 0.28, z, s, 0.56, s * 0.8, 0, { mat: 'concrete', surface: 'concrete' });
  }

  // ---------- 基地大院（x=±34 石墙，各两个院门）----------
  wall(-34, -25.3, -34, -10.4, 6.0, 0.5, 'lime');
  wall(-34, -5.6, -34, 5.6, 6.0, 0.5, 'lime');
  wall(-34, 10.4, -34, 25.3, 6.0, 0.5, 'lime');
  wall(-34, -10.4, -34, -5.6, 6.0, 0.5, 'lime', { open: [{ at: 2.4, w: 2.8 }] });
  wall(-34, 5.6, -34, 10.4, 6.0, 0.5, 'lime', { open: [{ at: 2.4, w: 2.8 }] });
  wall(-37.5, -12, -37.5, -6.4, 2.4, 0.45, 'moss');           // 院内隔墙（避开出生列 x=-42/-39.4）
  wall(-37.5, 6.4, -37.5, 12, 2.4, 0.45, 'moss');
  kit.container(-41, 19, -90, 20, 4);
  kit.container(41, -19, 90, 20, 4);
  kit.container(-43, -20, -90, 20, 2);
  kit.container(43, 20, 90, 20, 2);
  sb(-36.2, 0, 2.6, 1.0, 1.0);
  cr(-42.4, 10.6, 1.4, 1.4, 1.4, 5, 10);
  cr(-40.2, -11.4, 1.2, 1.2, 1.2, 1, -12);
  lp(-36, 4.4, -8.6, false);
  lp(-36, 4.4, 8.6, false);
  // 院内的塌墙与石棺：给守基地的人一个能蹲的角落（摆在出生列之外，x=-42/-39.4 那两排要留空）
  box(-43.6, 0.7, 5.4, 1.6, 1.4, 3.2, 0, 'lime');
  solid(-43.6, 0.7, 5.4, 1.6, 1.4, 3.2, 0, { mat: 'concrete', surface: 'concrete' });
  gm('gold', prims.sph, -43.6, 1.55, 5.4, 0, 0, 0, 0.5, 0.3, 0.5);

  // ---------- 边缘道与后巷：不进中街也能换位 ----------
  wall(-30, -24.4, -20, -24.4, 3.4, 0.5, 'lime');
  wall(-12, -24.4, -2, -24.4, 3.4, 0.5, 'moss');
  wall(-26, 24.4, -14, 24.4, 3.4, 0.5, 'moss');
  wall(-8, 24.4, 2, 24.4, 3.4, 0.5, 'lime');
  cr(-16.4, -22.6, 1.5, 1.4, 1.5, 2, 6);
  sb(-17.4, 22.4, 2.6, 0.9, 0.9);
  palm(-22.4, 22.8, 4.0);
  // 东岸的仓库与棚架（怪物从东侧涌入时的第一道房山）
  box(24.5, 2.0, -16.5, 10, 4.0, 7, 0, 'lime');
  solid(24.5, 2.0, -16.5, 10, 4.0, 7, 0, { mat: 'concrete', surface: 'concrete' });
  box(24.5, 4.2, -16.5, 10.8, 0.4, 7.8, 0, 'moss');
  solid(24.5, 4.2, -16.5, 10.8, 0.4, 7.8, 0, { mat: 'concrete', surface: 'concrete' });
  wall(19.4, -13.2, 19.4, -8, 3.2, 0.5, 'moss');
  cr(21.4, -11.4, 1.5, 1.5, 1.5, 0, 8);
  br(28.6, -12.4, 'red');
  palm(30.4, -9.6, 4.2);
  // 掩体密度补足：街区与岸街的空档不能是纯白地
  for (const [x, z, k] of [[-27.4, -6.6, 0], [-21.4, 6.4, 1], [-9.6, 8.4, 2], [-14.4, 18.6, 3], [-25.6, 18.4, 4], [-6.6, 18.6, 5]]) {
    if (k % 3 === 0) cr(x, z, 1.3, 1.3, 1.3, 4, 6);
    else if (k % 3 === 1) sb(x, z, 2.4, 0.9, 0.9);
    else { br(x, z, 'red'); cr(x + 0.8, z + 0.5, 1.1, 1.1, 1.1, 2, -8); }
  }

  // ---------- 灯：真实点光源池限 4 盏，每处落镜像 → 只点 2 处 ----------
  for (const [x, z, lit] of [[-24, -12.4, 1], [-12.6, 11.4, 0], [6.4, -22.4, 1], [16.4, 20.4, 0]]) {
    geom('scaffold', prims.cyl8, x, 2.4, z, 0, 0, 0, 0.08, 4.8, 0.08);
    geom('scaffold', prims.cyl8, -x, 2.4, -z, 0, 0, 0, 0.08, 4.8, 0.08);
    kit.lamp(x, 4.7, z, !!lit);
    kit.lamp(-x, 4.7, -z, !!lit);
  }

  // ---------- 远景：雨林丘陵 + 远处阶梯金字塔（纯视觉，不长碰撞体）----------
  {
    kit.def('farGround', kit.std({ color: 0x39442e, roughness: 1, metalness: 0 }), 1, { shadow: false, noAO: true });
    kit.def('farHill', kit.std({ color: 0x46523a, roughness: 1, metalness: 0, emissive: 0x1d2418, emissiveIntensity: 0.4 }), 1, { shadow: false, noAO: true });
    kit.def('farStone', kit.std({ color: 0x8f8a78, roughness: 1, metalness: 0 }), 1, { shadow: false, noAO: true });
    box(0, -0.12, 0, 440, 0.2, 440, 0, { py: 'farGround' });
    const hill = (x, z, w, d, h) => box(x, h / 2, z, w, h, d, 0, { py: 'farHill', px: 'farHill', nx: 'farHill', pz: 'farHill', nz: 'farHill' });
    for (const [rad, n] of [[70, 10], [112, 13], [168, 16]]) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rad * 0.017;
        const x = Math.cos(a) * rad * 1.2, z = Math.sin(a) * rad * 0.74;
        if (Math.abs(x) < 52 && Math.abs(z) < 30) continue;
        hill(x, z, 16 + rnd() * 26, 14 + rnd() * 20, 6 + rnd() * (rad > 140 ? 26 : 14));
      }
    }
    const px = -128, pz = 74;                                  // 远处阶梯金字塔：任何河岸都能拿它认方向
    for (let k = 0; k < 4; k++) box(px, 2.2 + k * 4.4, pz, 26 - k * 5.4, 4.4, 22 - k * 4.6, 0, 'farHill');
    box(px, 20.4, pz, 3.2, 4, 3.2, 0, 'farHill');
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
