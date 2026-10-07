// 炼狱小镇（参照 CS「de_inferno」/ CF 经典小镇）
// 坐标：X 为镇轴（-X 潜伏者基地，+X 保卫者基地与怪口），Z 为镇宽方向，Y 向上，街道 Y=0
// 图幅 92×52m，比运输船/沙漠灰/黑色城镇大一档：三横四纵镇街网格 + 两端基地大院
//
// 经典 Inferno 的三样味道，这里是这样落的：
//  ① 香蕉道：南横街（z∈[-18,-14]）被两道交错挡墙拧成 S 形，转角前看不见转角；
//     巷子一头压在教堂的侧门下，另一头开进教堂前庭，巷中立着一个能预瞄的射击窗
//  ② 中街市集：z∈[-3.6,3.6] 一条 60m 长街，柱廊 + 两处十字拱券把它掐成三段对视，
//     正中心的水井是全局争夺点（也是方位标），街侧带柱廊的房前有盖走道
//  ③ 前庭与钟楼：教堂前庭有个 3.3m 的高台（八级 0.41 台阶能上，跳下来不残），
//     站上去压住整个前庭与巷子出口；绕后走北/南边缘道，不进中街也能换位
//
// 公平性靠**构造**保证：本文件所有构件都走 duo 助手（wall/bx/sd/cr/br/sb/lp/st/rail/bld/gm/ft），
// 任何 (x,y,z) 一律自动补一份 (-x,y,-z) 镜像（yaw 与门位 side 同步取反），
// 所以两分支的出门/到位代价天然相等，而不是靠事后手调。
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

// 地中海暖色五张贴图（只在客户端生成；服务端走贴图桩，build 里绝不碰 canvas）
export function infernoTextures(T) {
  if (T.stucco) return;
  const S = 256;
  const canvasOf = (base) => {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = base; x.fillRect(0, 0, S, S);
    return { c, x };
  };
  // 赭石抹灰墙：抹刀痕 + 渗水垂痕 + 细裂 —— 本图的"暖橙"主要来自这张
  const mkStucco = () => {
    const { c, x } = canvasOf('#c39a63');
    const f = fbm(S, S, 4, 3, 5, 41), g = fbm(S, S, 12, 4, 3, 91);
    const h = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      h[i] = f[i] * 0.75 + g[i] * 0.25;
      x.fillStyle = `rgba(${f[i] > 0.56 ? '236,214,176' : '122,86,54'},${(0.04 + g[i] * 0.14).toFixed(3)})`;
      x.fillRect(i % S, (i / S) | 0, 1, 1);
    }
    for (let k = 0; k < 18; k++) {                       // 墙顶渗下来的水痕
      const px = Math.random() * S, w = 1 + Math.random() * 6, len = 40 + Math.random() * 130;
      const gr = x.createLinearGradient(0, 0, 0, len);
      gr.addColorStop(0, 'rgba(74,50,30,0.30)'); gr.addColorStop(1, 'rgba(74,50,30,0)');
      x.fillStyle = gr; x.fillRect(px, 0, w, len);
    }
    x.strokeStyle = 'rgba(84,58,36,0.30)'; x.lineWidth = 1;
    for (let k = 0; k < 8; k++) {
      x.beginPath(); let px = Math.random() * S, py = Math.random() * S;
      x.moveTo(px, py);
      for (let s = 0; s < 4; s++) { px += (Math.random() - 0.5) * 30; py += Math.random() * 20; x.lineTo(px, py); }
      x.stroke();
    }
    return texSet(c, h, 1, 1.1);
  };
  // 暖色条石路面：长条石错缝 + 接缝积垢 + 两道车辙
  const mkPave = () => {
    const { c, x } = canvasOf('#a89374');
    const f = fbm(S, S, 7, 7, 4, 13);
    const h = new Float32Array(S * S);
    const bw = 84, bh = 30;
    for (let row = 0; row * bh < S; row++) {
      const off = (row % 2) * bw * 0.5;
      for (let col = -1; col * bw < S + bw; col++) {
        const px = col * bw + off, py = row * bh;
        const tone = 150 + ((Math.random() * 34) | 0);
        x.fillStyle = `rgb(${tone},${tone - 12},${tone - 28})`;
        x.fillRect(px + 2, py + 2, bw - 4, bh - 4);
        x.strokeStyle = 'rgba(58,44,30,0.5)'; x.lineWidth = 2;
        x.strokeRect(px + 2, py + 2, bw - 4, bh - 4);
      }
    }
    for (let i = 0; i < S * S; i++) {
      h[i] = f[i];
      x.fillStyle = `rgba(46,34,22,${(f[i] * 0.18).toFixed(3)})`;
      x.fillRect(i % S, (i / S) | 0, 1, 1);
    }
    x.fillStyle = 'rgba(60,44,30,0.16)';
    for (const rr of [0.3, 0.68]) x.fillRect(0, rr * S, S, 7);
    return texSet(c, h, 1, 2.2);
  };
  // 陶瓦屋顶：瓦拱 + 压顶条 + 瓦缝苔痕
  const mkTile = () => {
    const { c, x } = canvasOf('#a44e33');
    const h = new Float32Array(S * S);
    for (let i = 0; i < S; i++) {
      const k = Math.sin((i / S) * Math.PI * 9) * 0.5 + 0.5;
      for (let j = 0; j < S; j++) h[j * S + i] = k * 0.75 + Math.sin(j / 6) * 0.07;
    }
    for (let band = 0; band * 28 < S; band++) {
      x.fillStyle = band % 2 ? 'rgba(0,0,0,0.15)' : 'rgba(255,206,170,0.12)';
      x.fillRect(0, band * 28, S, 5);
    }
    const m = fbm(S, S, 6, 5, 4, 27);
    for (let i = 0; i < S * S; i++) {
      x.fillStyle = m[i] > 0.64 ? `rgba(72,88,54,${((m[i] - 0.64) * 0.85).toFixed(3)})` : `rgba(34,14,8,${(m[i] * 0.15).toFixed(3)})`;
      x.fillRect(i % S, (i / S) | 0, 1, 1);
    }
    return texSet(c, h, 1, 2.0);
  };
  // 露砖：错缝砖皮 + 灰浆缝，用于教堂与塔身
  const mkBrick = () => {
    const { c, x } = canvasOf('#8f5a44');
    const h = new Float32Array(S * S);
    const bw = 42, bh = 15;
    for (let row = 0; row * bh < S; row++) {
      const off = (row % 2) * bw * 0.5;
      for (let col = -1; col * bw < S + bw; col++) {
        const t = 120 + ((Math.random() * 52) | 0);
        x.fillStyle = `rgb(${t},${(t * 0.62) | 0},${(t * 0.48) | 0})`;
        x.fillRect(col * bw + off + 2, row * bh + 2, bw - 4, bh - 4);
      }
    }
    x.fillStyle = 'rgba(206,198,184,0.5)';
    for (let row = 0; row * bh <= S; row++) x.fillRect(0, row * bh, S, 2);
    const f = fbm(S, S, 5, 9, 4, 63);
    for (let i = 0; i < S * S; i++) { h[i] = f[i] * 0.6; x.fillStyle = `rgba(30,20,14,${(f[i] * 0.2).toFixed(3)})`; x.fillRect(i % S, (i / S) | 0, 1, 1); }
    return texSet(c, h, 1, 1.8);
  };
  // 深色木门：竖板 + 铁箍 + 门环
  const mkDoor = () => {
    const { c, x } = canvasOf('#54371f');
    const h = new Float32Array(S * S);
    const f = fbm(S, S, 2, 24, 4, 17);
    for (let i = 0; i < S; i++) {
      if (i % 36 === 0) { x.fillStyle = 'rgba(18,12,6,0.62)'; x.fillRect(i, 0, 2, S); }
      x.fillStyle = `rgba(${112 + ((f[i] * 58) | 0)},${74 + ((f[i] * 38) | 0)},40,0.2)`;
      x.fillRect(i, 0, 1, S);
    }
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) h[j * S + i] = (i % 36 === 0 ? -0.5 : 0.2) + f[i % S] * 0.2;
    x.fillStyle = 'rgba(28,28,32,0.9)';
    x.fillRect(10, S * 0.2, S - 20, 9); x.fillRect(10, S * 0.72, S - 20, 9);
    x.fillStyle = 'rgba(150,130,96,0.85)';
    x.beginPath(); x.arc(S * 0.5, S * 0.5, 9, 0, 6.283); x.fill();
    return texSet(c, h, 1, 1.5);
  };
  T.stucco = mkStucco();
  T.pave = mkPave();
  T.tile = mkTile();
  T.brick = mkBrick();
  T.doorWood = mkDoor();
}

// PVE：怪口全在保卫者一侧（东侧三条街与大院），怪物沿镇街向西压
// 补给三对镜像位：每边各一个"出门就有"、一个"街心抢"、一个"巷子深处"，两边总代价天然相等
export const infernoPve = {
  spawns: [{ x: 32, z: 16 }, { x: 32, z: -16 }, { x: 32, z: 0 }, { x: 41, z: 15 }, { x: 41, z: -15 }],
  supplies: [
    { x: -40.8, z: -8.6, kind: 'med' },     // 潜伏者大院：出基地就能补，rush 前最后一口血
    { x: 40.8, z: 8.6, kind: 'med' },       // 保卫者大院镜像位
    { x: -22.4, z: -15.6, kind: 'ammo' },    // 香蕉道 S 弯正中：换弹必须顶着转角拿
    { x: 22.4, z: 15.6, kind: 'ammo' },      // 北横街镜像位
    { x: -10, z: -8, kind: 'armor' },     // 内纵街：冲中井之前先穿上
    { x: 10, z: 8, kind: 'armor' },       // 东侧镜像位
  ],
};

// 主构建：所有构件按 (x,z) → (-x,-z) 成对落料
export function buildInferno(scene, T, world, opts = {}) {
  const kit = makeKit(T, world, 818);
  const { rnd, box, solid, geom, prims } = kit;

  // ---------- 材质 ----------
  kit.def('stucco', kit.std({ map: T.stucco.map, normalMap: T.stucco.normalMap, roughness: 0.95, metalness: 0.02 }), 2.6);
  kit.def('pave', kit.std({ map: T.pave.map, normalMap: T.pave.normalMap, roughness: 0.99, metalness: 0.03 }), 3);
  kit.def('tile', kit.std({ map: T.tile.map, normalMap: T.tile.normalMap, roughness: 0.9, metalness: 0.02 }), 2.2);
  kit.def('brick', kit.std({ map: T.brick.map, normalMap: T.brick.normalMap, roughness: 0.93, metalness: 0.02 }), 2.4);
  kit.def('doorWood', kit.std({ map: T.doorWood.map, normalMap: T.doorWood.normalMap, roughness: 0.86, metalness: 0.03 }), 1.4);
  kit.plain('stone', 0xa2937c, { rough: 0.92, metal: 0.03, tiling: 1.6 });
  kit.plain('trunk', 0x5c452c, { rough: 0.95, metal: 0.02 });
  kit.plain('leaf', 0x5b6c40, { rough: 0.95, metal: 0.02 });
  kit.plain('shutter', 0x3d4f43, { rough: 0.82, metal: 0.04, tiling: 1.2 });   // 镇绿百叶
  kit.plain('water', 0x2f4f55, { rough: 0.1, metal: 0.55 });
  kit.plain('canvasRed', 0xa8402f, { rough: 0.93, metal: 0.02 });
  kit.plain('canvasOchre', 0xc08a30, { rough: 0.93, metal: 0.02 });
  kit.plain('winDark', 0x1a150f, { rough: 0.7, metal: 0.05 });
  kit.def('winLit', kit.std({ color: 0xffd9a4, emissive: 0xffbe76, emissiveIntensity: 3.3, roughness: 0.6 }), 1, { shadow: false });

  // ---------- 中心对称助手 ----------
  const wall = (x0, z0, x1, z1, h, th, key, o) => {
    kit.wall(x0, z0, x1, z1, 0, h, th, key, o);
    kit.wall(-x0, -z0, -x1, -z1, 0, h, th, key, o);       // 端点整体取反：open 的 at 沿墙参数不变
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
  // 房屋：镜像后受影响的边转对面（side+2），沿边位置取反
  const bld = (cx, cz, w, d, h, key, o) => {
    kit.building(cx, cz, w, d, h, key, o);
    const doors = (o.doors || []).map((dr) => ({ ...dr, side: (dr.side + 2) % 4, at: -(dr.at || 0) }));
    kit.building(-cx, -cz, w, d, h, key, { ...o, doors, yaw: -(o.yaw || 0) });
  };
  // 橄榄树：树干挡身（有碰撞），树冠纯装饰不挡弹
  const tree = (x, z, hh = 3.4) => {
    gm('trunk', prims.cyl8, x, hh * 0.5, z, 0, 0, 0, 0.16, hh, 0.16);
    gm('leaf', prims.sph, x, hh * 0.98, z, 0, 0, 0, 1.25, 0.95, 1.25);
    gm('leaf', prims.sph, x + 0.7, hh * 0.82, z - 0.4, 0, 0, 0, 0.75, 0.6, 0.75);
    sd(x, hh * 0.5, z, 0.5, hh, 0.5, 0, { mat: 'wood', bullet: 'pen', surface: 'wood' });
  };

  // ---------- 地面 / 外围 ----------
  solid(0, -0.5, 0, 96, 1, 56, 0, { mat: 'concrete', surface: 'concrete', tag: 'deck' });
  box(0, 0.02, 0, 92, 0.04, 52, 0, 'pave');
  for (const [x0, z0, x1, z1] of [[-46, -26, 46, -26], [-46, 26, 46, 26], [-46, -26, -46, 26], [46, -26, 46, 26]]) {
    kit.wall(x0, z0, x1, z1, 0, 10, 0.7, 'stucco', { foot: false });   // 10m 高围墙：跳不出去也看不到外面
  }

  // ---------- 基地大院（x=±34 院墙，各两个院门）----------
  wall(-34, -25.3, -34, -10.4, 6.8, 0.45, 'stucco');
  wall(-34, -5.6, -34, 5.6, 6.8, 0.45, 'stucco');          // 中段封死：出生区不被巷道切成三块
  wall(-34, 10.4, -34, 25.3, 6.8, 0.45, 'stucco');
  wall(-34, -10.4, -34, -5.6, 6.8, 0.45, 'stucco', { open: [{ at: 2.4, w: 2.8 }] });   // 南门 → 外纵街
  wall(-34, 5.6, -34, 10.4, 6.8, 0.45, 'stucco', { open: [{ at: 2.4, w: 2.8 }] });      // 北门
  wall(-37.5, -12, -37.5, -6, 2.4, 0.4, 'brick');           // 院内隔墙：rush 撞进来时有得躲（避开出生列）
  wall(-37.5, 6, -37.5, 12, 2.4, 0.4, 'brick');
  kit.container(-41, 19, -90, 20, 1);                       // 集装箱各向异性，镜像位与朝向手写
  kit.container(41, -19, 90, 20, 1);
  kit.container(-43, -20, -90, 20, 3);
  kit.container(43, 20, 90, 20, 3);
  sb(-36.5, 0, 2.6, 1.0, 1.0);
  cr(-42, 10, 1.4, 1.4, 1.4, 0, 10);
  cr(-41, -11, 1.2, 1.2, 1.2, 2, -12);
  lp(-36, 4.6, -8, false);
  lp(-36, 4.6, 8, false);

  // ---------- 中街（z∈[-3.6,3.6]）：柱廊 + 井 + 两道十字拱券 ----------
  // 柱位用对称列表（±同一组 x），不要从 -28 顺步长推 —— 推出来的集合对 180° 不闭合，
  // 会让一边多一根柱子挡路，实测把中路到达差推到 16%
  for (const cx of [13.6, 17.2, 20.8, 24.4, 28]) for (const sx of [1, -1]) for (const sz of [1, -1]) {
    box(sx * cx, 1.7, sz * 4.4, 0.52, 3.4, 0.52, 0, 'stone');
    solid(sx * cx, 1.7, sz * 4.4, 0.52, 3.4, 0.52, 0, { mat: 'concrete', surface: 'concrete' });
    box(sx * cx, 3.55, sz * 4.4, 0.86, 0.3, 0.86, 0, 'stone');
  }
  // 镇心房前的带顶走道（3.9m 高，只挡视线不挡弹：枪线与手雷都过得去）
  // 柱列落在廊外沿（|z|=5.6），别压到街界 3.6 —— 否则 street 被掐出锯齿路径，两边到达时间会漂
  for (const sz of [-5.0, 5.0]) {
    box(0, 3.9, sz, 15, 0.24, 2.6, 0, 'tile');
    for (const px of [-6, 0, 6]) solid(px, 3.9, sz, 4.6, 0.24, 2.6, 0, { bullet: 'pass', sight: false, mat: 'concrete' });
    for (const px of [-7, -3.5, 0, 3.5, 7]) {
      const pz = sz + (sz < 0 ? -0.6 : 0.6);
      box(px, 1.75, pz, 0.4, 3.5, 0.4, 0, 'stone');
      solid(px, 1.75, pz, 0.4, 3.5, 0.4, 0, { mat: 'concrete', surface: 'concrete' });
    }
  }
  // 十字拱券：门洞 3.4m 宽，两侧柱墩是硬掩体，冲井的人必须过这道门
  const arch = (x) => {
    for (const dz of [-1, 1]) {
      bx(x, 2.0, dz * 4.0, 1.1, 4.0, 1.1, 0, 'brick');
      sd(x, 2.0, dz * 4.0, 1.1, 4.0, 1.1, 0, { mat: 'concrete', surface: 'concrete' });
      bx(x, 4.25, dz * 4.0, 1.7, 0.5, 1.7, 0, 'stone');
    }
    bx(x, 4.7, 0, 1.4, 0.9, 9.0, 0, 'brick');
    sd(x, 4.7, 0, 1.4, 0.9, 9.0, 0, { mat: 'concrete', surface: 'concrete' });
    gm('doorWood', prims.cyl, x, 2.4, 0, Math.PI / 2, 0, 0, 1.5, 0.22, 3.4);   // 券面轮廓（不挡人）
  };
  arch(-10);

  // ---------- 中街十字口：雨棚 + 两侧喷泉 ----------
  // 原点必须站得住：如果整张图的"中路参考点"落在实体碰撞体里，寻路会把它吸附到最近的空格，
  // 两边的吸附格不同 → 实测凭空多出 7m 的"假不对称"
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(sx * 2.4, 1.8, sz * 2.4, 0.46, 3.6, 0.46, 0, 'stone');
    solid(sx * 2.4, 1.8, sz * 2.4, 0.46, 3.6, 0.46, 0, { mat: 'concrete', surface: 'concrete' });
  }
  box(0, 3.86, 0, 6.2, 0.26, 6.2, 0, 'tile');                       // 雨棚：下面能过人，只当顶
  for (const sx of [-1.6, 1.6]) solid(sx, 3.86, 0, 2.8, 0.26, 6.2, 0, { bullet: 'pass', sight: false, mat: 'concrete' });
  geom('darkSteel', prims.cyl, 0, 4.3, 0, 0, 0, 0, 0.16, 0.9, 0.16);
  // 两侧喷泉：90cm 矮圈蹲得下，也把 60m 长街的对视切成三段
  for (const sx of [-6.8, 6.8]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      box(sx + Math.cos(a) * 1.15, 0.45, Math.sin(a) * 1.15, 0.9, 0.9, 0.4, a, 'stone');
    }
    solid(sx, 0.45, 0, 2.7, 0.9, 2.7, 0, { mat: 'concrete', surface: 'concrete' });
    geom('water', prims.cyl, sx, 0.52, 0, 0, 0, 0, 1.0, 0.14, 1.0);
    geom('stone', prims.cyl, sx, 1.0, 0, 0, 0, 0, 0.26, 1.9, 0.26);
    geom('tile', prims.cone, sx, 2.3, 0, 0, 0, 0, 0.5, 0.7, 0.5);
    kit.foot(sx, 0, 2.7, 2.7, 0, 0.5);
  }
  kit.foot(0, 0, 6.2, 6.2, 0, 0.4);

  // ---------- 香蕉道（南横街西段：两道交错挡墙拧成 S 弯）----------
  wall(-30, -14, -28, -14, 5.6, 0.4, 'stucco');            // 巷北立面：教堂山墙补上的两段
  wall(-14, -14, -12, -14, 5.6, 0.4, 'stucco');
  wall(-30, -18.4, -24, -18.4, 4.8, 0.4, 'stucco');
  wall(-20, -18.4, -12, -18.4, 4.8, 0.4, 'stucco');
  wall(-24, -18.4, -20, -18.4, 1.05, 0.4, 'stone');        // 这段只做矮墙：能跨过去换位，也能站着开枪
  wall(-27, -18.4, -27, -15.8, 4.4, 0.4, 'brick');         // 第一道交错挡墙（从南往北探 2.6m）
  wall(-17.5, -14, -17.5, -16.6, 4.4, 0.4, 'brick');       // 第二道（从北往南探 2.6m）—— 两个贴墙转角
  cr(-24.6, -16.6, 2.4, 1.5, 1.3, 0, 4);                    // 巷里的"垃圾斗"：唯一能蹲的硬掩体
  cr(-23.7, -16.9, 1.1, 1.0, 1.1, 1, -8);
  br(-20.6, -15.4, 'red');
  sb(-19.2, -17.6, 2.4, 0.9, 0.9);
  br(-14.6, -16.9, 'green');
  // 巷口射击窗：1.1m 高台 + 窗洞，守前庭的人能预瞄整条巷子（不是真二层，不需要替代路线）
  bx(-13.2, 1.55, -15.2, 1.6, 1.1, 0.5, 0, 'winLit');
  bx(-13.2, 2.4, -15.2, 2.2, 0.24, 0.7, 0, 'stone');
  sd(-13.2, 1.55, -15.2, 1.6, 1.1, 0.5, 0, { mat: 'concrete', surface: 'concrete' });

  // ---------- 教堂街区（西南 18×8.6：教堂 + 前庭 + 高台，镜像到东北）----------
  bld(-21, -12.2, 14, 3.6, 7.6, 'brick', {
    roofKey: 'tile', overhang: 0.5, th: 0.5, floor: 'tile',
    doors: [{ side: 2, at: -0.2, w: 3.2, h: 3.4 }, { side: 3, at: 0.32, w: 2.4 }, { side: 0, at: 0.1, w: 2.2 }],
  });
  // 前庭：铺地 + 矮栏 + 一只 3.3m 高台（八级 0.41 台阶真能上去，跳下来不残）
  box(-20.5, 0.038, -8.0, 15, 0.03, 5.0, 0, 'tile');
  bld(-26.2, -8.0, 3.6, 3.6, 3.3, 'brick', { roofKey: 'tile', th: 0.45, doors: [{ side: 0, at: 0, w: 2.0 }] });
  bx(-26.2, 3.46, -8.0, 4.6, 0.32, 4.6, 0, 'tile');
  sd(-26.2, 3.46, -8.0, 4.6, 0.32, 4.6, 0, { mat: 'concrete', surface: 'concrete' });
  for (const [x0, z0, x1, z1] of [[-28.4, -10.2, -24, -10.2], [-28.4, -5.8, -24, -5.8], [-28.5, -10.2, -28.5, -5.8], [-23.9, -10.2, -23.9, -5.8]]) {
    rail(x0, z0, x1, z1, 3.62, 'railWhite', 0.9);          // 高台四边护栏：站得住也掉不下来
  }
  st(-21.6, -8.0, -24.2, -8.0, 3.3, 8, 1.7, 'darkSteel', 'stone');
  wall(-22.5, -6.2, -16, -6.2, 1.0, 0.36, 'stone');        // 朝中街的矮栏：挡弹不挡光
  sb(-19, -8.6, 2.6, 0.9, 0.9);
  cr(-16.4, -9.6, 1.5, 1.5, 1.5, 3, 6);
  br(-15.2, -7.0, 'red'); br(-14.4, -7.6, 'green');
  tree(-29.4, -6.4, 3.6);
  // 前庭小喷泉：矮圈，蹲得下也看得见对面
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    bx(-17.6 + Math.cos(a) * 1.7, 0.42, -11.9 + Math.sin(a) * 1.7, 1.1, 0.84, 0.45, a, 'stone');
  }
  sd(-17.6, 0.42, -11.9, 4.2, 0.84, 4.2, 0, { mat: 'concrete', surface: 'concrete' });
  gm('stone', prims.cyl, -17.6, 1.0, -11.9, 0, 0, 0, 0.32, 2.0, 0.32);
  gm('water', prims.cyl, -17.6, 0.5, -11.9, 0, 0, 0, 1.35, 0.14, 1.35);
  ft(-17.6, -11.9, 4.2, 4.2, 0, 0.5);

  // ---------- 镇心街区（中街南 16×8.6：两栋市集房，镜像到北）----------
  bld(-4.0, -10.2, 8.0, 5.6, 6.4, 'stucco', {
    roofKey: 'tile', overhang: 0.4, th: 0.45, floor: 'tile',
    doors: [{ side: 2, at: 0.15, w: 2.6 }, { side: 1, at: -0.2, w: 2.2 }],
  });
  bld(4.2, -9.8, 6.6, 5.0, 5.0, 'stucco', {
    roofKey: 'tile', overhang: 0.4, th: 0.45,
    doors: [{ side: 2, at: -0.15, w: 2.4 }, { side: 0, at: 0.2, w: 2.2 }],
  });
  cr(-1.4, -13.0, 1.4, 1.3, 1.4, 2, 8);
  sb(1.6, -12.6, 2.4, 0.9, 0.9);
  tree(6.8, -13.2, 3.2);
  // 临街窗与百叶：夜里半数亮灯，是本图的身份
  for (const [cx, cz, w] of [[-4.0, -7.4, 8.0], [4.2, -7.3, 6.6]]) {
    for (const ox of [-w * 0.3, w * 0.3]) bx(cx + ox, 3.6, cz, 0.5, 1.3, 0.08, 0, 'shutter');
    bx(cx, 3.6, cz - 0.16, 0.95, 1.2, 0.06, 0, ((cx * 7 + cz * 13) | 0) % 3 < 2 ? 'winLit' : 'winDark');
    bx(cx, 2.86, cz - 0.2, 1.4, 0.14, 0.18, 0, 'stone');
  }

  // ---------- 市集角（东南 18×8.6：商摊 + 房山，镜像到西北）----------
  bld(20, -11.8, 12, 3.8, 6.0, 'stucco', {
    roofKey: 'tile', overhang: 0.4, th: 0.45, floor: 'tile',
    doors: [{ side: 2, at: -0.28, w: 2.8 }, { side: 3, at: 0.2, w: 2.2 }, { side: 1, at: 0.1, w: 2.2 }],
  });
  bld(16.6, -6.4, 5.2, 4.4, 4.6, 'brick', { roofKey: 'tile', th: 0.45, doors: [{ side: 0, at: 0.2, w: 2.2 }] });
  const stall = (x, z, key) => {
    bx(x, 2.75, z, 3.4, 0.1, 2.4, 0, key);
    for (const [ox, oz] of [[-1.5, -1.0], [1.5, -1.0], [-1.5, 1.0], [1.5, 1.0]]) gm('darkSteel', prims.cyl8, x + ox, 1.4, z + oz, 0, 0, 0, 0.05, 2.6, 0.05);
    bx(x, 0.45, z, 2.6, 0.9, 1.0, 0, 'doorWood');
    sd(x, 0.45, z, 2.6, 0.9, 1.0, 0, { mat: 'wood', bullet: 'pen', surface: 'wood' });
    ft(x, z, 3.4, 2.4, 0, 0.35);
  };
  stall(20.5, -8.2, 'canvasRed');
  stall(25.5, -8.2, 'canvasOchre');
  cr(22.8, -6.6, 1.3, 1.2, 1.3, 1, 12);
  br(28.2, -16.2, 'red');
  wall(28.4, -14, 28.4, -9.6, 4.8, 0.4, 'stucco');         // 东贴外纵街的房山：把角掐成 90°
  tree(14.4, -16.2, 3.4);

  // ---------- 内纵街（x∈[-12,-8]）：山墙留巷口，中段摆掩体 ----------
  wall(-12, -14, -12, -12.6, 5.6, 0.4, 'stucco');
  wall(-12, -10.4, -12, -6.4, 5.6, 0.4, 'stucco');
  wall(-8, -14, -8, -12.4, 5.6, 0.4, 'stucco');
  cr(-10.2, -11.4, 1.4, 1.4, 1.4, 4, 0);
  sb(-9.6, -6.6, 2.2, 0.9, 0.9);
  wall(-8, 6.4, -8, 10.4, 5.6, 0.4, 'stucco');             // 北侧内纵街山墙（与镜像错开，形成不对称巷口）

  // ---------- 横街（北 z∈[14,18] 与镜像）与边缘道 ----------
  wall(-12, 14, -8, 14, 5.0, 0.4, 'stucco');
  wall(-30, 18.4, -20, 18.4, 4.8, 0.4, 'stucco');
  wall(-14, 18.4, -8, 18.4, 4.8, 0.4, 'stucco');
  wall(-30, 14, -24, 14, 5.0, 0.4, 'stucco');
  cr(-26, 16.6, 1.6, 1.5, 1.4, 5, 6);
  sb(-18, 16.2, 2.4, 0.9, 0.9);
  // 边缘道与横街之间的隔墙，留出三个口子（只写南半边，wall() 自动落北半边的镜像；写两遍会重复生成碰撞体）
  wall(-30, -21.4, -22, -21.4, 4.6, 0.4, 'stucco');
  wall(-16, -21.4, -6, -21.4, 4.6, 0.4, 'stucco');
  wall(0, -21.4, 14, -21.4, 4.6, 0.4, 'stucco');
  wall(-30, -22.6, -30, -18.4, 4.2, 0.4, 'brick');         // 边缘道上的挡片段：直道被折成 12m 一段
  wall(-24, -25.3, -24, -22.6, 4.2, 0.4, 'brick');
  wall(-14, -22.6, -14, -25.3, 4.2, 0.4, 'brick');
  cr(-26.4, -23.6, 1.3, 1.2, 1.3, 0, 8);
  sb(-19, -23.4, 2.6, 0.9, 0.9);
  tree(-28.6, -23.8, 3.8);
  tree(-8, -23.4, 3.4);

  // ---------- 巷角密度的补充掩体：街区之间的小空地不能是纯白地 ----------
  for (const [x, z, k] of [[-24.5, -6.2, 0], [-8.6, -10.2, 1], [2.4, -6.0, 2], [-4.6, -13.2, 3], [26.6, -6.4, 4], [12.6, -8.6, 5]]) {
    if (k % 3 === 0) cr(x, z, 1.2, 1.2, 1.2, 1, 6);
    else if (k % 3 === 1) sb(x, z, 2.2, 0.9, 0.9);
    else { br(x, z, 'red'); cr(x + 0.7, z + 0.6, 1.0, 1.0, 1.0, 2, -8); }
  }

  // ---------- 街灯：黄昏时街上一圈圈暖光（真实点光源池限 4 盏，每处都落镜像 → 只点 2 处）----------
  for (const [x, z, lit] of [[-27, -19.6, 1], [-13, 19.6, 0], [7, -22.8, 1], [21, 21.2, 0], [-6, 19.6, 0], [16, -19.6, 0]]) {
    geom('darkSteel', prims.cyl8, x, 2.6, z, 0, 0, 0, 0.07, 5.2, 0.07);
    geom('darkSteel', prims.cyl8, -x, 2.6, -z, 0, 0, 0, 0.07, 5.2, 0.07);
    kit.lamp(x, 5.1, z, !!lit);
    kit.lamp(-x, 5.1, -z, !!lit);
  }
  // 晾衣绳：一点点生活气（纯装饰，不参与判定）
  for (const [x0, z0, x1, z1, key] of [[-24.5, -6.9, -17, -6.9, 'canvasRed'], [15.5, 6.9, 23, 6.9, 'canvasOchre'], [-7.5, -5.9, -1.5, -5.9, 'canvasOchre']]) {
    for (const t of [0, 0.3, 0.62, 0.9]) {
      const px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
      box(px, 2.62, pz, 0.7, 0.86, 0.06, Math.atan2(-(z1 - z0), x1 - x0), key);
      box(-px, 2.62, -pz, 0.7, 0.86, 0.06, Math.atan2(-(z1 - z0), x1 - x0), key);
    }
    for (const px of [x0, x1]) {
      geom('darkSteel', prims.cyl8, px, 1.9, z0, 0, 0, 0, 0.04, 3.8, 0.04);
      geom('darkSteel', prims.cyl8, -px, 1.9, -z0, 0, 0, 0, 0.04, 3.8, 0.04);
    }
  }

  // ---------- 远景：暖色山城剪影 + 穹顶方位标（纯视觉，不长碰撞体）----------
  {
    kit.def('farGround', kit.std({ color: 0x4a3c2e, roughness: 1, metalness: 0 }), 1, { shadow: false, noAO: true });
    kit.def('farCity', kit.std({ color: 0x6b5340, roughness: 1, metalness: 0, emissive: 0x2e2118, emissiveIntensity: 0.5 }), 1, { shadow: false, noAO: true });
    kit.def('farTile', kit.std({ color: 0x8a4f36, roughness: 1, metalness: 0 }), 1, { shadow: false, noAO: true });
    kit.def('farLit', kit.std({ color: 0xffca86, emissive: 0xffbe6a, emissiveIntensity: 2.8, roughness: 1 }), 1, { shadow: false, noAO: true });
    box(0, -0.12, 0, 440, 0.2, 440, 0, { py: 'farGround' });
    const farBlock = (x, z, w, d, h, tile) => {
      box(x, h / 2, z, w, h, d, 0, { py: tile ? 'farTile' : 'farCity', px: 'farCity', nx: 'farCity', pz: 'farCity', nz: 'farCity' });
      if (tile) box(x, h + 0.4, z, w * 0.86, 0.8, d * 0.86, 0, 'farTile');
    };
    for (const [rad, lit, n] of [[68, 0.5, 9], [108, 0.34, 12], [162, 0, 15]]) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rad * 0.011;
        const x = Math.cos(a) * rad * 1.24, z = Math.sin(a) * rad * 0.72;
        if (Math.abs(x) < 52 && Math.abs(z) < 30) continue;         // 只画图外，免得长出隐形碰撞体
        const w = 8 + rnd() * 11, d = 6 + rnd() * 9, h = 5 + rnd() * (rad > 130 ? 26 : 14);
        farBlock(x, z, w, d, h, rnd() > 0.4);
        if (lit > 0) {
          const fz = z + (z > 0 ? -d / 2 - 0.06 : d / 2 + 0.06);
          for (let k = 0; k < 3; k++) box(x - w * 0.28 + k * w * 0.3, 2.8 + rnd() * Math.max(0.6, h - 4), fz, 0.8, 1.2, 0.12, 0, 'farLit');
        }
      }
    }
    const dx = -122, dz = 66;                                       // 穹顶教堂：任何街口都能靠它认方向
    box(dx, 7, dz, 16, 14, 14, 0, { py: 'farCity', px: 'farCity', nx: 'farCity', pz: 'farCity', nz: 'farCity' });
    geom('farCity', prims.sph, dx, 15.4, dz, 0, 0, 0, 7.4, 5.6, 7.4);
    box(dx, 21.8, dz, 1.6, 4, 1.6, 0, 'farTile');
    box(dx + 17, 5, dz - 7, 9, 10, 9, 0, 'farCity');
    box(dx + 17, 10.6, dz - 7, 10.6, 1.2, 10.6, 0, 'farTile');
  }

  const meshes = kit.flush(scene, opts);

  // ---------- 出生点：院内两列，面朝镇内 ----------
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
