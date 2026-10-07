// 炼狱小镇（参照 CS「de_inferno」/ CF 经典小镇）
// 坐标：X 为镇轴（-X 潜伏者基地，+X 保卫者基地与怪口），Z 为镇宽方向，Y 向上，街道 Y=0
// 图幅 92×52m，比运输船/沙漠灰/黑色城镇大一档：三横四纵的镇街网格 + 两侧基地大院
//
// 经典 Inferno 的三样东西，这里是这样落的：
//  ① 香蕉道：南横街（z∈[-18,-14]）被两道交错挡墙拧成 S 形，转角前看不见转角，
//     出口压在教堂前庭脸上 —— 那条"整条巷子被预瞄锁住"的味道
//  ② 拱廊市集：中街（z∈[-3,3]）两侧各一条柱廊，井在正中心（0,0）当争夺点，
//     两处十字口砌门洞拱券，把 60m 长直街掐成三段对视
//  ③ 前庭与侧院：四个街区里两个是教堂前庭（香蕉道的奖品）、两个是市集角，
//     每一块都有 2~3 个入口，绕后走北/南边缘道，不进中街也能换位
//
// 公平性靠**构造**保证：本文件所有构件都走 duo() 系列助手，任何 (x,z) 一律自动补一份
// (-x,-z) 镜像（yaw 取反、building 门位 side+2/at 取反），所以两分支的到达时间天然对称。
import * as THREE from 'three';
import { makeKit } from './mapkit.js';
import { fbm, normalFromHeight } from './textures.js';

export const INFERNO_X0 = -46, INFERNO_Z0 = -26, INFERNO_X1 = 46, INFERNO_Z1 = 26;

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
  // 赭石抹灰墙：抹刀痕 + 渗水垂痕 + 细裂，Inferno 的"暖橙"主要来自这张
  const mkStucco = () => {
    const { c, x } = canvasOf('#c39a63');
    const f = fbm(S, S, 4, 3, 5, 41), g = fbm(S, S, 12, 4, 3, 91);
    const h = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      h[i] = f[i] * 0.75 + g[i] * 0.25;
      const px = i % S, py = (i / S) | 0;
      x.fillStyle = `rgba(${f[i] > 0.56 ? '236,214,176' : '122,86,54'},${(0.04 + g[i] * 0.14).toFixed(3)})`;
      x.fillRect(px, py, 1, 1);
    }
    for (let k = 0; k < 18; k++) {                       // 墙顶渗下来的深色水痕
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
  // 暖色条石路面：长条石错缝 + 接缝积垢 + 车辙
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
    for (const rr of [0.3, 0.68]) x.fillRect(0, rr * S, S, 7);      // 两道车辙
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
  // 露砖：三皮砖错缝 + 灰浆，用于教堂与塔身下部
  const mkBrick = () => {
    const { c, x } = canvasOf('#8f5a44');
    const h = new Float32Array(S * S);
    const bw = 42, bh = 15;
    for (let row = 0; row * bh < S; row++) {
      const off = (row % 2) * bw * 0.5;
      for (let col = -1; col * bw < S + bw; col++) {
        const t = 120 + ((Math.random() * 52) | 0);
        x.fillStyle = `rgb(${t},${t * 0.62 | 0},${t * 0.48 | 0})`;
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

// PVE：怪口全在保卫者一侧（东纵街与基地大院），怪物沿镇街向西压；补给点三对镜像，两边总代价对称
export const infernoPve = {
  spawns: [{ x: 32, z: 16 }, { x: 32, z: -16 }, { x: 32, z: 0 }, { x: 41, z: 14 }, { x: 41, z: -14 }],
  supplies: [
    { x: -38, z: -8, kind: 'med' },       // 潜伏者大院：出基地就能补，rush 前的最后一口血
    { x: 38, z: 8, kind: 'med' },         // 保卫者大院镜像位
    { x: -21, z: -16, kind: 'ammo' },     // 香蕉道 S 弯里：换弹必须顶着转角拿
    { x: 21, z: 16, kind: 'ammo' },       // 北横街镜像位
    { x: -10, z: -8, kind: 'armor' },     // 内纵街十字口：抢中井之前先穿上
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
  kit.plain('stone', 0xa2937c, { rough: 0.92, metal: 0.03, tiling: 1.6 });        // 石料压顶/柱础
  kit.plain('trunk', 0x5c452c, { rough: 0.95, metal: 0.02 });
  kit.plain('leaf', 0x5b6c40, { rough: 0.95, metal: 0.02 });                      // 橄榄树冠
  kit.plain('shutter', 0x3d4f43, { rough: 0.82, metal: 0.04, tiling: 1.2 });      // 镇绿的百叶
  kit.plain('water', 0x2f4f55, { rough: 0.1, metal: 0.55 });
  kit.plain('canvasRed', 0xa8402f, { rough: 0.93, metal: 0.02 });
  kit.plain('canvasOchre', 0xc08a30, { rough: 0.93, metal: 0.02 });
  kit.plain('winDark', 0x1a150f, { rough: 0.7, metal: 0.05 });
  kit.def('winLit', kit.std({ color: 0xffd9a4, emissive: 0xffbe76, emissiveIntensity: 3.3, roughness: 0.6 }), 1, { shadow: false });

  // ---------- 中心对称助手 ----------
  const wall = (x0, z0, x1, z1, h, th, key, o) => {
    kit.wall(x0, z0, x1, z1, 0, h, th, key, o);
    kit.wall(-x0, -z0, -x1, -z1, 0, h, th, key, o);            // 端点整体取反：at 沿墙参数不变
  };
  const bx = (x, y, z, sx, sy, sz, yaw, key) => {
    box(x, y, z, sx, sy, sz, yaw, key);
    box(-x, y, -z, sx, sy, sz, -yaw, key);
  };
  const sd = (x, y, z, sx, sy, sz, yaw, o) => {
    solid(x, y, z, sx, sy, sz, yaw, o);
    solid(-x, y, -z, sx, sy, sz, -yaw, o);
  };
  const bs = (x, y, z, sx, sy, sz, yaw, key, o) => { bx(x, y, z, sx, sy, sz, yaw, key); sd(x, y, z, sx, sy, sz, yaw, o); };
  const ft = (x, z, sx, sz, yaw, dark) => { kit.foot(x, z, sx, sz, yaw, dark); kit.foot(-x, -z, sx, sz, -yaw, dark); };
  const gm = (key, g, x, y, z, rx, ry, rz, sx, sy, sz) => {
    geom(key, g, x, y, z, rx, ry, rz, sx, sy, sz);
    geom(key, g, -x, y, -z, rx, -ry, -rz, sx, sy, sz);
  };
  const cr = (x, z, w, h, d, idx, y = 0, yawDeg = 0) => {
    kit.crate(x, z, w, h, d, idx, y, yawDeg);
    kit.crate(-x, -z, w, h, d, idx, y, -yawDeg);
  };
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
  // 房屋：镜像后门所在的边转对面（side+2），沿边位置取反
  const bld = (cx, cz, w, d, h, key, o) => {
    kit.building(cx, cz, w, d, h, key, o);
    const doors = (o.doors || []).map((dr) => ({ ...dr, side: (dr.side + 2) % 4, at: -(dr.at || 0) }));
    kit.building(-cx, -cz, w, d, h, key, { ...o, doors, yaw: -(o.yaw || 0) });
  };
  // 橄榄树：树干有碰撞（挡身），树冠纯装饰不挡弹
  const tree = (x, z, hh = 3.4) => {
    gm('trunk', prims.cyl8, x, hh * 0.5, z, 0, 0, 0, 0.16, hh, 0.16);
    gm('leaf', prims.sph, x, hh * 0.98, z, 0, 0, 0, 1.25, 0.95, 1.25);
    gm('leaf', prims.sph, x + 0.7, hh * 0.82, z - 0.4, 0, 0, 0, 0.75, 0.6, 0.75);
    sd(x, hh * 0.5, z, 0.5, hh, 0.5, 0, { mat: 'wood', bullet: 'pen', surface: 'wood' });
  };

  // ---------- 地面 / 外围 ----------
  solid(0, -0.5, 0, 96, 1, 56, 0, { mat: 'concrete', surface: 'concrete', tag: 'deck' });
  box(0, 0.02, 0, 92, 0.04, 52, 0, 'pave');
  const X0 = INFERNO_X0, X1 = INFERNO_X1, Z0 = INFERNO_Z0, Z1 = INFERNO_Z1;
  kit.wall(X0, Z0, X1, Z0, 0, 10, 0.7, 'stucco', { foot: false });
  kit.wall(X0, Z1, X1, Z1, 0, 10, 0.7, 'stucco', { foot: false });
  kit.wall(X0, Z0, X0, Z1, 0, 10, 0.7, 'stucco', { foot: false });
  kit.wall(X1, Z0, X1, Z1, 0, 10, 0.7, 'stucco', { foot: false });

  // ---------- 街网（三横四纵）----------
  // 横：中街 z∈[-3,3]（拱廊市集）｜南横街 z∈[-18,-14]（香蕉道）｜北横街 z∈[14,18]（旋转道）
  // 纵：外纵街 x∈[-34,-30] 与 [30,34]（贴基地）｜内纵街 x∈[-12,-8] 与 [8,12]（穿镇心）
  // 街区由房屋与矮墙填，房间之间的空档就是巷口 —— 只有墙会挡路，所以留档即通路
  for (const sz of [-3, 3]) {                       // 中街两侧的柱廊：掐断 60m 长直街的一眼到底
    for (let x = -28; x <= 28; x += 3.6) {
      if (Math.abs(x) < 8.6) continue;              // 井位（0,0）两侧留空，中心是个环场
      box(x, 1.7, sz + Math.sign(sz) * 0.6, 0.52, 3.4, 0.52, 0, 'stone');
      solid(x, 1.7, sz + Math.sign(sz) * 0.6, 0.52, 3.4, 0.52, 0, { mat: 'concrete', surface: 'concrete' });
      box(x, 3.55, sz + Math.sign(sz) * 0.6, 0.9, 0.3, 0.9, 0, 'stone');   // 柱头
    }
  }
  // 廊顶：压在柱列与街面之间（3.9m 高，头顶不挡弹：bullet pass 让枪线与手雷过去）
  for (const sz of [-4.5, 4.5]) {
    box(0, 3.9, sz, 54, 0.24, 2.4, 0, 'tile');
    for (const px of [-14, 14]) solid(px, 3.9, sz, 26, 0.24, 2.4, 0, { bullet: 'pass', sight: false, mat: 'concrete' });
  }

  // ---------- 基地大院（两端，各两个院门）----------
  // 一律走 duo 助手：西院每个构件都自动在东院落一份 (-x,-z) 镜像，出门代价严格相等
  wall(-34, -25.3, -34, -10.4, 6.8, 0.45, 'stucco');
  wall(-34, -5.6, -34, 5.6, 6.8, 0.45, 'stucco');             // 中段封死：出生区不被巷道切成三块
  wall(-34, 10.4, -34, 25.3, 6.8, 0.45, 'stucco');
  wall(-34, -10.4, -34, -5.6, 6.8, 0.45, 'stucco', { open: [{ at: 2.4, w: 2.8 }] });   // 南门 → 外纵街
  wall(-34, 5.6, -34, 10.4, 6.8, 0.45, 'stucco', { open: [{ at: 2.4, w: 2.8 }] });      // 北门
  wall(-39.5, -12, -39.5, -3, 2.4, 0.4, 'brick');             // 院内隔墙：rush 撞进来时有得躲
  wall(-39.5, 4, -39.5, 13, 2.4, 0.4, 'brick');
  kit.container(-41, 19, -90, 20, 1);                          // 集装箱是各向异性件，镜像位与朝向手写
  kit.container(41, -19, 90, 20, 1);
  kit.container(-43, -21, -90, 20, 3);
  kit.container(43, 21, 90, 20, 3);
  sb(-36.5, 0, 2.6, 1.0, 1.0);
  cr(-42, 6, 1.4, 1.4, 1.4, 0, 0, 10);
  cr(-41, -6, 1.2, 1.2, 1.2, 2, 0, 12);
  lp(-36, 4.6, -8, false);
  lp(-36, 4.6, 8, false);


  // ---------- 香蕉道（南横街西段：两道交错挡墙拧成 S 弯）----------
  // 巷北墙压 z=-14，巷南墙压 z=-18.2；两处挡墙从对侧探进来，逼出两个贴墙转角
  wall(-34, -14, -12, -14, 5.6, 0.4, 'stucco');               // 巷北立面（教堂前庭的背面）
  wall(-34, -18.4, -26, -18.4, 4.6, 0.4, 'stucco');
  wall(-18, -18.4, -12, -18.4, 4.6, 0.4, 'stucco');           // 巷南立面中段留一档口（下面用挡墙拧弯）
  wall(-26, -18.4, -18, -18.4, 1.05, 0.4, 'stone');           // 南立面这段只做矮墙：能跨过去换位，也能站着开枪
  wall(-27, -18.4, -27, -15.6, 4.2, 0.4, 'brick');            // 第一道交错挡墙（从南往北探 2.8m）
  wall(-17.5, -14, -17.5, -16.8, 4.2, 0.4, 'brick');          // 第二道（从北往南探 2.8m）
  cr(-24.5, -16.6, 2.4, 1.5, 1.3, 0, 0, 4);                   // 香蕉道的"垃圾斗"：唯一能蹲的硬掩体
  cr(-23.6, -16.9, 1.1, 1.0, 1.1, 1, 0, -8);
  br(-20.4, -15.2, 'red');
  sb(-19.4, -17.6, 2.4, 0.9, 0.9);
  br(-14.6, -16.9, 'green');
  // 巷口的窗台：一层朝巷面开一扇 1.1m 高的射击窗，守前庭的人能预瞄整条巷子
  box(-13.4, 1.55, -15.3, 1.6, 1.1, 0.5, 0, 'winLit');
  box(-13.4, 2.4, -15.3, 2.2, 0.22, 0.7, 0, 'stone');
  solid(-13.4, 1.55, -15.3, 1.6, 1.1, 0.5, 0, { mat: 'concrete', surface: 'concrete' });

  // ---------- 教堂前庭（西南街区 18×11，镜像到东北：香蕉道的奖品）----------
  bld(-21, -8.5, 13, 6.4, 7.6, 'brick', {
    roofKey: 'tile', overhang: 0.5, th: 0.5, floor: 'tile',
    doors: [{ side: 3, at: -0.28, w: 3.0, h: 3.2 }, { side: 1, at: 0.3, w: 2.4, h: 2.8 }],   // 朝巷 + 朝内纵街
  });
  // 钟楼：4.2m 平台可上（十级 0.42 台阶），跳下来不残；塔尖只做轮廓（NavGrid 只测 0.4~1.8m）
  bld(-14, -4.6, 4.6, 4.6, 4.4, 'brick', { roofKey: 'tile', th: 0.5, doors: [{ side: 3, at: 0, w: 2.2 }] });
  bx(-14, 4.62, -4.6, 5.6, 0.4, 5.6, 0, 'tile');
  sd(-14, 4.62, -4.6, 5.6, 0.4, 5.6, 0, { mat: 'concrete', surface: 'concrete' });
  for (const [x0, z0, x1, z1] of [[-16.8, -7.15, -11.2, -7.15], [-16.8, -2.05, -11.2, -2.05], [-16.55, -7.4, -16.55, -1.8], [-11.45, -7.4, -11.45, -1.8]]) {
    rail(x0, z0, x1, z1, 4.82, 'railWhite', 0.9);            // 平台四边护栏：站得稳也掉不下来
  }
  gm('darkSteel', prims.cyl, -14, 8.6, -4.6, 0, 0, 0, 0.15, 6.4, 0.15);
  gm('redLamp', prims.sph, -14, 12, -4.6, 0, 0, 0, 0.3, 0.3, 0.3);
  gm('doorWood', prims.cyl, -14, 6.6, -2.29, Math.PI / 2, 0, 0, 0.95, 0.22, 0.95);   // 钟面朝中街
  st(-18.6, -5.2, -16.2, -4.6, 4.4, 11, 1.7, 'darkSteel', 'stone');
  // 前庭铺地与矮墙：开阔地被切成可用的对枪位，而不是一片任人穿过的平地
  box(-19.5, 0.038, -6.2, 15, 0.03, 8.4, 0, 'tile');
  wall(-24.5, -3.4, -17, -3.4, 1.0, 0.36, 'stone');           // 朝中街的矮栏（挡弹不挡光）
  sb(-22.5, -11, 2.6, 0.9, 0.9);
  cr(-18, -12.4, 1.5, 1.5, 1.5, 3, 0, 6);
  br(-16.4, -12.6, 'red'); br(-15.8, -13.1, 'green');
  tree(-27.5, -6.2, 3.6);
  // 前庭小喷泉：一个矮圈，蹲得下、也看得到对面
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    bx(-25.5 + Math.cos(a) * 1.9, 0.42, -8.4 + Math.sin(a) * 1.9, 1.2, 0.84, 0.5, a, 'stone');
  }
  sd(-25.5, 0.42, -8.4, 4.6, 0.84, 4.6, 0, { mat: 'concrete', surface: 'concrete' });
  gm('stone', prims.cyl, -25.5, 1.0, -8.4, 0, 0, 0, 0.34, 2.0, 0.34);
  gm('water', prims.cyl, -25.5, 0.5, -8.4, 0, 0, 0, 1.5, 0.14, 1.5);
  ft(-25.5, -8.4, 4.6, 4.6, 0, 0.5);

  // ---------- 镇心街区（中街南侧 16×11：市集与拱廊房，镜像到北侧）----------
  bld(-4.4, -8.6, 8.4, 7.4, 6.6, 'stucco', {
    roofKey: 'tile', overhang: 0.4, th: 0.45, floor: 'tile',
    doors: [{ side: 3, at: 0.15, w: 2.6 }, { side: 0, at: -0.2, w: 2.2 }],
  });
  bld(3.6, -7.2, 7.0, 6.0, 5.2, 'stucco', {
    roofKey: 'tile', overhang: 0.4, th: 0.45,
    doors: [{ side: 2, at: -0.1, w: 2.4 }, { side: 1, at: 0.2, w: 2.2 }],
  });
  // 二层挑台：站在上面能压住中街东段，但上下只有一条楼梯，能被反向绕
  bx(3.6, 3.3, -3.4, 7.0, 0.16, 1.8, 0, 'stone');
  sd(3.6, 3.3, -3.4, 7.0, 0.16, 1.8, 0, { mat: 'concrete', surface: 'concrete' });
  rail(0.2, -2.55, 7.0, -2.55, 3.38, 'railWhite', 1.0);
  st(7.4, -6.6, 7.0, -4.2, 3.3, 8, 1.6, 'darkSteel', 'stone');
  cr(-1.6, -12.2, 1.4, 1.3, 1.4, 2, 0, 8);
  sb(1.4, -11.4, 2.4, 0.9, 0.9);
  tree(6.6, -11.6, 3.2);

  // ---------- 市集角（东南街区 18×11，镜像到西北）----------
  bld(20, -9.4, 10, 6.4, 6.0, 'stucco', {
    roofKey: 'tile', overhang: 0.4, th: 0.45, floor: 'tile',
    doors: [{ side: 3, at: -0.3, w: 2.8 }, { side: 0, at: 0.1, w: 2.4 }],
  });
  bld(15.4, -5.2, 5.4, 5.0, 4.6, 'brick', { roofKey: 'tile', th: 0.45, doors: [{ side: 2, at: 0.2, w: 2.2 }] });
  // 商摊：遮阳棚压 2.7m 高，摊台 0.9m 当掩体，摊位一律贴街墙摆、走廊留 3m 以上通路
  const stall = (x, z, key) => {
    bx(x, 2.75, z, 3.4, 0.1, 2.4, 0, key);
    for (const [ox, oz] of [[-1.5, -1.0], [1.5, -1.0], [-1.5, 1.0], [1.5, 1.0]]) gm('darkSteel', prims.cyl8, x + ox, 1.4, z + oz, 0, 0, 0, 0.05, 2.6, 0.05);
    bx(x, 0.45, z, 2.6, 0.9, 1.0, 0, 'doorWood');
    sd(x, 0.45, z, 2.6, 0.9, 1.0, 0, { mat: 'wood', bullet: 'pen', surface: 'wood' });
    ft(x, z, 3.4, 2.4, 0, 0.35);
  };
  stall(19.5, -15.6, 'canvasRed');
  stall(24.5, -15.6, 'canvasOchre');
  stall(16.6, -3.3, 'canvasRed');
  cr(21.6, -16.4, 1.3, 1.2, 1.3, 1, 0, 12);
  br(26.6, -16.2, 'red');
  wall(28.4, -14, 28.4, -8, 4.6, 0.4, 'stucco');              // 东贴外纵街的房山，把角掐成 90°
  tree(14.2, -16.4, 3.4);

  // ---------- 内纵街（x∈[-12,-8]）与十字口拱券 ----------
  wall(-12, -14, -12, -11.4, 5.6, 0.4, 'stucco');             // 前庭侧的山墙短段（留出巷口）
  wall(-12, -7.6, -12, -4.2, 5.6, 0.4, 'stucco');
  wall(-8, -14, -8, -12.2, 5.6, 0.4, 'stucco');
  cr(-10.2, -11.2, 1.4, 1.4, 1.4, 4, 0, 0);
  sb(-9.6, -5.6, 2.2, 0.9, 0.9);
  // 十字口拱券：门洞宽 3.4m，两侧柱墩是硬掩体，冲中井的人必须过这道门
  const arch = (x, z) => {
    for (const dz of [-1, 1]) {
      bx(x, 2.0, z + dz * 2.9, 1.1, 4.0, 1.1, 0, 'brick');
      sd(x, 2.0, z + dz * 2.9, 1.1, 4.0, 1.1, 0, { mat: 'concrete', surface: 'concrete' });
      box(x, 4.25, z + dz * 2.9, 1.7, 0.5, 1.7, 0, 'stone');
    }
    bx(x, 4.6, z, 1.4, 0.8, 6.4, 0, 'brick');
    sd(x, 4.6, z, 1.4, 0.8, 6.4, 0, { mat: 'concrete', surface: 'concrete' });
    box(x, 4.15, z, 1.0, 0.1, 5.6, 0, 'winDark');
    gm('doorWood', prims.cyl, x - 0.75, 2.3, z, 0, 0, Math.PI / 2, 0.75, 0.2, 1.5);   // 半圆券面（纯轮廓）
  };
  arch(-10, 0);
  arch(10, 0);

  // ---------- 中街的水井：整张图的争夺点，也是方位标 ----------
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    bx(Math.cos(a) * 2.5, 0.45, Math.sin(a) * 2.5, 1.4, 0.9, 0.55, a, 'stone');
  }
  sd(0, 0.45, 0, 5.6, 0.9, 5.6, 0, { mat: 'concrete', surface: 'concrete' });
  gm('stone', prims.cyl, 0, 1.2, 0, 0, 0, 0, 0.45, 2.4, 0.45);
  gm('water', prims.cyl, 0, 0.52, 0, 0, 0, 0, 2.0, 0.14, 2.0);
  for (const dx of [-1, 1]) gm('darkSteel', prims.cyl8, dx * 1.1, 2.9, 0, 0, 0, 0, 0.05, 2.6, 0.05);
  bx(0, 4.3, 0, 2.8, 0.18, 1.6, 0, 'tile');
  ft(0, 0, 5.6, 5.6, 0, 0.5);

  // ---------- 北横街（旋转道）与南边缘道：绕后不进中街也能换位 ----------
  for (const sz of [-20.5, 20.5]) {
    wall(-30, sz, -12, sz, 4.6, 0.4, 'stucco');
    wall(12, sz, 30, sz, 4.6, 0.4, 'stucco');
  }
  // 边缘道上的挡片段：把 60m 直道掐成 12m 一段，狙击线被折开
  for (const [fx, fz] of [[-24, -22.6], [-16, -22.6], [16, 22.6], [24, 22.6]]) {
    wall(fx, fz, fx, fz + (fz < 0 ? 2.0 : -2.0), 4.0, 0.4, 'brick');
    cr(fx + 0.9, fz + (fz < 0 ? 1.2 : -1.2), 1.3, 1.2, 1.3, 0, 0, 8);
  }
  sb(-19, 22.4, 2.6, 0.9, 0.9);
  sb(19, -22.4, 2.6, 0.9, 0.9);
  tree(-28, 22.8, 3.8); tree(28, -22.8, 3.8);
  cr(0, 22.6, 1.5, 1.4, 1.5, 5, 0, 0); cr(1.7, 22.2, 1.2, 1.1, 1.2, 1, 0, 10);
  cr(0, -22.6, 1.5, 1.4, 1.5, 4, 0, 0); cr(-1.7, -22.2, 1.2, 1.1, 1.2, 2, 0, -10);

  // ---------- 街灯与晾衣：黄昏时街上一圈圈暖光，是本图的身份 ----------
  for (const [x, z, lit] of [[-28, -19.4, 1], [-14, 19.4, 1], [14, -19.4, 1], [28, 19.4, 1], [-10, 19.4, 0], [10, -19.4, 0]]) {
    gm('darkSteel', prims.cyl8, x, 2.6, z, 0, 0, 0, 0.07, 5.2, 0.07);
    lp(x, 5.1, z, !!lit);
  }
  for (const [x0, z0, x1, z1, key] of [[-19.5, -3.6, -15.5, -3.6, 'canvasRed'], [15.5, 3.6, 19.5, 3.6, 'canvasOchre'], [-7, 4.2, -2, 4.2, 'canvasRed']]) {
    for (const t of [0, 0.28, 0.58, 0.86]) {
      const px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
      box(px, 2.9, pz, 0.7, 0.9, 0.06, Math.atan2(-(z1 - z0), x1 - x0), key);
    }
    for (const px of [x0, x1]) gm('darkSteel', prims.cyl8, px, 1.9, z0 + (z0 < 0 ? -0.5 : 0.5), 0, 0, 0, 0.04, 3.8, 0.04);
  }

  // ---------- 远景：暖色山城剪影 + 穹顶方位标（纯视觉，无碰撞体）----------
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
    for (const [rad, lit, n] of [[64, 0.5, 9], [102, 0.34, 12], [158, 0, 15]]) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rad * 0.011;
        const x = Math.cos(a) * rad * 1.24, z = Math.sin(a) * rad * 0.72;
        if (Math.abs(x) < 52 && Math.abs(z) < 30) continue;         // 图外才画，避免长出隐形碰撞
        const w = 8 + rnd() * 11, d = 6 + rnd() * 9, h = 5 + rnd() * (rad > 130 ? 26 : 14);
        farBlock(x, z, w, d, h, rnd() > 0.4);
        if (lit > 0) {
          const fz = z + (z > 0 ? -d / 2 - 0.06 : d / 2 + 0.06);
          for (let k = 0; k < 3; k++) box(x - w * 0.28 + k * w * 0.3, 2.8 + rnd() * Math.max(0.6, h - 4), fz, 0.8, 1.2, 0.12, 0, 'farLit');
        }
      }
    }
    // 穹顶教堂 + 远处山脊：任何街口都能靠它认方向
    const dx = -118, dz = 62;
    box(dx, 7, dz, 16, 14, 14, 0, { py: 'farCity', px: 'farCity', nx: 'farCity', pz: 'farCity', nz: 'farCity' });
    geom('farCity', prims.sph, dx, 15.4, dz, 0, 0, 0, 7.4, 5.6, 7.4);
    box(dx, 21.6, dz, 1.6, 4, 1.6, 0, 'farTile');
    box(dx + 16, 5, dz - 6, 9, 10, 9, 0, 'farCity');
    box(dx + 16, 10.6, dz - 6, 10.6, 1.2, 10.6, 0, 'farTile');
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
