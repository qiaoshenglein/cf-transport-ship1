// 怪物 / BOSS 的外观层：人类的骨骼与蒙皮完全复用，只在同一副骨架上换体型、换材质、挂轮廓件
// 目的：20~40m 外一眼能认出"这不是人"，并且本体就是光源——地面环预告范围、天光柱标示方位
import * as THREE from 'three';
import { SIZE } from './bosssize.js';

// 光效贴图按需生成并共享（客户端专用，服务端不会 import 这个文件）
let TEX_GLOW = null, TEX_BEAM = null;
function glowTex() {
  if (TEX_GLOW) return TEX_GLOW;
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  TEX_GLOW = t; return t;
}
function beamTex() {
  if (TEX_BEAM) return TEX_BEAM;
  const c = document.createElement('canvas'); c.width = 8; c.height = 128;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.45, 'rgba(255,255,255,.28)'); g.addColorStop(1, 'rgba(255,255,255,.9)');
  x.fillStyle = g; x.fillRect(0, 0, 8, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  TEX_BEAM = t; return t;
}

const bx = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const sp = (r, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
const cn = (r, h, seg = 8) => new THREE.ConeGeometry(r, h, seg);
const cy = (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cp = (r, l, cs = 4, rs = 8) => new THREE.CapsuleGeometry(r, l, cs, rs);

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _sc = new THREE.Vector3();

// items: [geo, x, y, z, rx, ry, rz, sx, sy, sz]（bone 本地坐标系；骨骼原点见 character.js 的 BONES）
function fuse(items) {
  const geos = [];
  let n = 0;
  for (const it of items) {
    const g = it[0].index ? it[0].toNonIndexed() : it[0];
    _m.compose(_p.set(it[1], it[2], it[3]), _q.setFromEuler(_e.set(it[4] || 0, it[5] || 0, it[6] || 0)), _sc.set(it[7] ?? 1, it[8] ?? 1, it[9] ?? 1));
    g.applyMatrix4(_m);
    geos.push(g); n += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of geos) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += c;
  }
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

const pose = (o) => Object.assign({ hunch: 0, lean: 0, swing: 1, rate: 1, bob: 1, lop: 1, armOut: 0, float: 0, hipY: 0, head: 0, roll: 0 }, o);

// 每类实体一套：体型(ws/ds/scale) + 材质(tint/emis) + 姿态 + 轮廓件 + 光环 + 受击材质
export const LOOKS = {
  // —— 小怪：不加网格，只换色与姿态（同屏可达 30+，靠剪影和步态区分）
  infected: {
    tint: 0x94b47a, emis: 0x27380f, glow: 0xff4a2a, ei: 0.5, rough: 0.96, metal: 0.02,
    scale: SIZE.infected.h, ws: SIZE.infected.w, ds: SIZE.infected.d, hit: 'flesh', style: pose({ hunch: 0.42, lean: 0.2, swing: 1.12, rate: 1.3, lop: 0.72, armOut: 0.3, bob: 1.3 }),
  },
  shooter: {
    tint: 0x8fa8c2, emis: 0x0d2033, glow: 0x64d8ff, ei: 0.45, rough: 0.92, metal: 0.05,
    scale: SIZE.shooter.h, ws: SIZE.shooter.w, ds: SIZE.shooter.d, hit: 'flesh', style: pose({ hunch: 0.12, lean: 0.3, swing: 0.72, rate: 0.82, armOut: 0.12, bob: 0.7 }),
  },
  heavy: {
    tint: 0xa08464, emis: 0x2b1606, glow: 0xffa02a, ei: 0.3, rough: 0.8, metal: 0.22,
    scale: SIZE.heavy.h, ws: SIZE.heavy.w, ds: SIZE.heavy.d, hit: 'metal', pulse: 0.5, style: pose({ hunch: 0.24, lean: 0.12, swing: 0.8, rate: 0.72, bob: 0.85, armOut: 0.34, hipY: -0.02 }),
    acc: (A, E) => [
      { b: 'shoulderR', m: 'A', g: [[bx(0.3, 0.15, 0.3), 0, 0.06, 0, 0, 0, -0.12], [cn(0.05, 0.16), 0.06, 0.17, -0.02, -0.2, 0, -0.5]] },
      { b: 'shoulderL', m: 'A', g: [[bx(0.3, 0.15, 0.3), 0, 0.06, 0, 0, 0, 0.12], [cn(0.05, 0.16), -0.06, 0.17, -0.02, -0.2, 0, 0.5]] },
      { b: 'head', m: 'E', g: [[sp(0.032), 0.045, 0.1, -0.095], [sp(0.032), -0.045, 0.1, -0.095]] },
    ],
  },

  // —— 铁皮暴君：宽甲方剪影 + 背部排气柱 + 胸口熔核，冲撞路径用橙红地面环预告
  tyran: {
    tint: 0x8e6a4a, emis: 0x351204, glow: 0xff5a1c, ei: 0.42, rough: 0.52, metal: 0.55,
    scale: SIZE.tyran.h, ws: SIZE.tyran.w, ds: SIZE.tyran.d, hit: 'metal', noGun: true, pulse: 1.1, beat: 3.4, bloom: 5.5,
    aura: { r: 4.4, c: 0xff4a1c },
    lamp: { b: 'chest', y: 0.14, z: -0.2, i: 52, dist: 19 },
    halo: { b: 'chest', y: 0.14, z: -0.22, s: 2.0 },
    beam: { h: 6, r1: 0.35, r2: 1.2 },
    emit: { bone: 'chest', rate: 0.1, kind: 'ember', at: [[0.17, 0.52, 0.16], [-0.17, 0.52, 0.16]] },
    style: pose({ hunch: 0.2, lean: 0.1, swing: 0.9, rate: 0.78, bob: 0.5, armOut: 0.5, hipY: 0.01, head: -0.08 }),
    acc: (A, E) => [
      { b: 'chest', m: 'A', g: [
        [bx(0.54, 0.44, 0.22), 0, 0.1, -0.12, 0, 0, 0, 1, 1, 1], [bx(0.6, 0.1, 0.3), 0, 0.3, 0, 0, 0, 0],
        [bx(0.44, 0.26, 0.14), 0, -0.14, -0.15], [bx(0.5, 0.34, 0.16), 0, 0.12, 0.2],
        [cy(0.11, 0.13, 0.36), 0.17, 0.34, 0.2, -0.22, 0, 0], [cy(0.11, 0.13, 0.36), -0.17, 0.34, 0.2, -0.22, 0, 0],
      ] },
      { b: 'chest', m: E, g: [[sp(0.1), 0, 0.13, -0.2], [cy(0.08, 0.08, 0.04), 0.17, 0.52, 0.16, -0.22, 0, 0], [cy(0.08, 0.08, 0.04), -0.17, 0.52, 0.16, -0.22, 0, 0]] },
      { b: 'shoulderR', m: 'A', g: [[bx(0.34, 0.2, 0.36), 0.02, 0.07, 0, 0, 0, -0.16], [cn(0.06, 0.26), 0.08, 0.2, -0.06, -0.3, 0, -0.55], [cn(0.05, 0.2), 0.1, 0.16, 0.12, 0.4, 0, -0.5]] },
      { b: 'shoulderL', m: 'A', g: [[bx(0.34, 0.2, 0.36), -0.02, 0.07, 0, 0, 0, 0.16], [cn(0.06, 0.26), -0.08, 0.2, -0.06, -0.3, 0, 0.55], [cn(0.05, 0.2), -0.1, 0.16, 0.12, 0.4, 0, 0.5]] },
      { b: 'head', m: 'A', g: [[sp(0.152, 14, 10), 0, 0.11, 0.005], [bx(0.24, 0.1, 0.09), 0, 0.1, -0.11], [cn(0.05, 0.34), 0.13, 0.18, -0.01, -0.1, 0, -1.15], [cn(0.05, 0.34), -0.13, 0.18, -0.01, -0.1, 0, 1.15]] },
      { b: 'head', m: E, g: [[bx(0.2, 0.035, 0.03), 0, 0.1, -0.155]] },
      { b: 'hips', m: 'A', g: [[bx(0.42, 0.12, 0.28), 0, 0.1, 0], [cn(0.045, 0.14), 0.2, 0.1, -0.06, 0, 0, -1.6], [cn(0.045, 0.14), -0.2, 0.1, -0.06, 0, 0, 1.6]] },
      { b: 'shinR', m: 'A', g: [[bx(0.17, 0.34, 0.2), 0, -0.16, -0.03]] },
      { b: 'shinL', m: 'A', g: [[bx(0.17, 0.34, 0.2), 0, -0.16, -0.03]] },
      { b: 'handR', m: 'A', g: [[cn(0.035, 0.17), 0.02, -0.06, -0.06, -1.5, 0, 0], [cn(0.035, 0.17), -0.02, -0.06, -0.05, -1.5, 0, 0]] },
    ],
  },

  // —— 瘟疫母体：巨腹 + 背部酸囊（呼吸式明暗）+ 垂须，齐射落点之外本体也是绿色光源
  mother: {
    tint: 0x7d9a52, emis: 0x2f4a10, glow: 0x9bf04a, ei: 0.62, rough: 0.98, metal: 0.02,
    scale: SIZE.mother.h, ws: SIZE.mother.w, ds: SIZE.mother.d, hit: 'acid', pulse: 1.4, beat: 1.5, bloom: 6,
    aura: { r: 4.6, c: 0x74d94a },
    lamp: { b: 'hips', y: -0.06, z: -0.1, i: 46, dist: 17 },
    halo: { b: 'hips', y: -0.06, z: -0.12, s: 2.6 },
    beam: { h: 6.5, r1: 0.5, r2: 1.4 },
    emit: { bone: 'chest', rate: 0.16, kind: 'acid', at: [[0.16, 0.24, 0.24], [-0.16, 0.2, 0.26], [0, -0.14, -0.3]] },
    style: pose({ hunch: 0.16, lean: -0.12, swing: 0.6, rate: 0.6, bob: 0.3, armOut: 0.44, hipY: 0.02, head: 0.12 }),
    acc: (A, E) => [
      { b: 'hips', m: 'A', g: [[sp(0.3, 16, 12), 0, -0.04, -0.02, 0, 0, 0, 1.5, 1.28, 1.5], [sp(0.12, 10, 8), 0.16, -0.2, -0.2], [sp(0.1, 10, 8), -0.14, -0.16, -0.24]] },
      { b: 'hips', m: E, g: [[sp(0.075, 10, 8), 0, -0.14, -0.3], [sp(0.06, 10, 8), 0.2, -0.06, -0.24], [sp(0.06, 10, 8), -0.2, -0.06, -0.24]] },
      { b: 'chest', m: 'A', g: [
        [bx(0.46, 0.055, 0.07), 0, 0.18, -0.17], [bx(0.42, 0.055, 0.07), 0, 0.05, -0.19], [bx(0.36, 0.055, 0.07), 0, -0.08, -0.19],
        [cp(0.035, 0.46), 0.16, -0.02, 0.2, 0.5, 0, 0.2], [cp(0.035, 0.46), -0.16, -0.02, 0.2, 0.5, 0, -0.2],
        [sp(0.13, 12, 10), 0.02, 0.3, 0.24],
      ] },
      { b: 'chest', m: E, g: [[sp(0.12, 12, 10), 0.16, 0.24, 0.24], [sp(0.1, 12, 10), -0.16, 0.2, 0.26], [sp(0.07, 10, 8), 0, 0.2, -0.2]] },
      { b: 'head', m: 'A', g: [[cn(0.05, 0.24), 0.06, -0.02, -0.1, -0.9, 0, -0.3], [cn(0.05, 0.24), -0.06, -0.02, -0.1, -0.9, 0, 0.3], [bx(0.2, 0.08, 0.06), 0, 0.02, -0.12]] },
      { b: 'head', m: E, g: [[sp(0.038, 10, 8), 0.055, 0.11, -0.1], [sp(0.038, 10, 8), -0.055, 0.11, -0.1]] },
    ],
  },

  // —— 幽影袭杀：瘦长 + 兜帽 + 背刃 + 长爪，紫色薄环预告它的闪现距离
  shade: {
    tint: 0x4c4a6a, emis: 0x170f2e, glow: 0xb48cff, ei: 0.55, rough: 0.42, metal: 0.3,
    scale: SIZE.shade.h, ws: SIZE.shade.w, ds: SIZE.shade.d, hit: 'flesh', noGun: true, pulse: 0.45, beat: 2.8, bloom: 5,
    aura: { r: 2.6, c: 0xa874ff },
    lamp: { b: 'chest', y: 0.12, z: -0.1, i: 34, dist: 14 },
    halo: { b: 'head', y: 0.1, z: -0.12, s: 1.2 },
    beam: { h: 5.5, r1: 0.25, r2: 0.85 },
    emit: { bone: 'chest', rate: 0.22, kind: 'wisp', at: [[0.16, 0.2, 0.12], [-0.14, 0.1, 0.16]] },
    style: pose({ hunch: 0.08, lean: 0.06, swing: 0.42, rate: 1.5, bob: 0.15, armOut: 0.2, float: 0.035, head: 0.06 }),
    acc: (A, E) => [
      { b: 'head', m: 'A', g: [[cy(0.03, 0.2, 0.42, 10), 0, 0.16, 0.05, 0.24, 0, 0], [bx(0.17, 0.13, 0.05), 0, 0.04, -0.11]] },
      { b: 'head', m: E, g: [[bx(0.055, 0.022, 0.02), 0.045, 0.075, -0.135], [bx(0.055, 0.022, 0.02), -0.045, 0.075, -0.135]] },
      { b: 'chest', m: 'A', g: [
        [bx(0.05, 0.52, 0.12), 0.14, 0.16, 0.2, -0.42, 0, 0.26], [bx(0.05, 0.52, 0.12), -0.14, 0.16, 0.2, -0.42, 0, -0.26],
        [bx(0.36, 0.06, 0.05), 0, 0.16, -0.17, 0.2, 0, 0], [bx(0.32, 0.06, 0.05), 0, 0.02, -0.18, -0.2, 0, 0],
        [cn(0.06, 0.18), 0.2, 0.24, 0, 0, 0, -1.2], [cn(0.06, 0.18), -0.2, 0.24, 0, 0, 0, 1.2],
      ] },
      { b: 'hips', m: 'A', g: [[cp(0.03, 0.3), 0.12, -0.16, 0.04, 0.1, 0, 0.12], [cp(0.03, 0.26), -0.1, -0.15, -0.04, -0.1, 0, -0.14], [cp(0.028, 0.22), 0.02, -0.18, 0.14, 0.3, 0, 0]] },
      { b: 'handR', m: 'A', g: [[cn(0.02, 0.2), 0.03, -0.08, -0.05, -1.4, 0, -0.2], [cn(0.02, 0.18), 0, -0.08, -0.06, -1.4, 0, 0], [cn(0.02, 0.16), -0.03, -0.08, -0.05, -1.4, 0, 0.2]] },
      { b: 'handL', m: 'A', g: [[cn(0.02, 0.2), -0.03, -0.08, -0.05, -1.4, 0, 0.2], [cn(0.02, 0.18), 0, -0.08, -0.06, -1.4, 0, 0], [cn(0.02, 0.16), 0.03, -0.08, -0.05, -1.4, 0, -0.2]] },
      { b: 'handR', m: E, g: [[sp(0.024, 8, 6), 0.02, -0.14, -0.13], [sp(0.022, 8, 6), -0.01, -0.14, -0.13]] },
    ],
  },
};

export const BOSS_TINT = { tyran: '#ff7a3c', mother: '#9be26a', shade: '#c4a2ff' };
export function lookOf(kind, boss) { return LOOKS[kind] || (boss ? LOOKS.tyran : null); }

const AArmor = (L) => new THREE.MeshStandardMaterial({ color: L.tint, roughness: Math.max(0.3, L.rough - 0.18), metalness: Math.min(1, L.metal + 0.35) });
const AGlow = (L) => new THREE.MeshStandardMaterial({ color: 0x14100c, emissive: L.glow, emissiveIntensity: L.bloom || 2.4, roughness: 0.4, metalness: 0, toneMapped: false });

// —— 换装产物缓存（这次卡死的真正解法）
// 每套 BOSS 外观要新建 4~6 个材质，浏览器会在它们第一次进画面时现编译着色器：
// 实测登场那一帧 ~500ms（软件渲染下更久），而且所有客户端同一时刻一起卡。
// 旧代码回收时把材质 dispose 掉 → 程序缓存被释放 → 下一只同类再编译一遍，于是每次登场都卡。
// 现在按 (种类, 是否附身) 做成免费池：材质与融合后的几何终身复用，第二次登场零编译零分配。
const POOL = new Map();
const GEO_CACHE = new Map();
function makeSet(L, possessed) {
  const s = { AM: AArmor(L), EM: AGlow(L) };
  if (L.aura) s.aura = new THREE.MeshBasicMaterial({ color: possessed ? 0x49d8ff : L.aura.c, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  if (L.halo) s.halo = new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(L.glow).multiplyScalar(2.4), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.7 });
  if (L.beam) s.beam = new THREE.MeshBasicMaterial({ map: beamTex(), color: new THREE.Color(L.glow).multiplyScalar(1.5), transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide, toneMapped: false });
  if (possessed) s.core = new THREE.MeshStandardMaterial({ color: 0x0b1a22, emissive: 0x49d8ff, emissiveIntensity: 2.6, roughness: 0.3, toneMapped: false });
  s.list = [s.AM, s.EM, s.aura, s.halo, s.beam, s.core].filter(Boolean);
  s.bloom = L.bloom || 2.4;
  return s;
}
// 归还前把动画量与淡出痕迹全部复位，免得上一只的脉冲/透明串到下一只
function resetSet(s) {
  for (const m of s.list) { m.userData = {}; if (m.opacity !== undefined) m.opacity = 1; if ('transparent' in m) m.transparent = false; }
  s.EM.emissiveIntensity = s.bloom;
  if (s.aura) { s.aura.opacity = 0.22; s.aura.transparent = true; }
  if (s.halo) s.halo.opacity = 0.7;
  if (s.beam) s.beam.opacity = 0.09;
}
function takeSet(key, possessed) {
  const ck = `${key}|${possessed ? 'p' : 'a'}`;
  let p = POOL.get(ck);
  if (!p) POOL.set(ck, (p = { free: [] }));
  return p.free.pop() || makeSet(LOOKS[key], possessed);
}
function giveSet(key, possessed, s) {
  if (!s) return;
  resetSet(s);
  const ck = `${key}|${possessed ? 'p' : 'a'}`;
  if (!POOL.has(ck)) POOL.set(ck, { free: [] });
  POOL.get(ck).free.push(s);
}
// 轮廓件：acc() 里的 A/E 参数只是形参（几何与材质无关），所以整套描述与融合结果都能按种类缓存
function accParts(key) {
  if (GEO_CACHE.has(key)) return GEO_CACHE.get(key);
  const L = LOOKS[key];
  const items = L && L.acc ? L.acc(null, null) : [];
  const geos = items.map((it) => (it.g.length ? fuse(it.g) : null));
  for (const it of items) for (const t of it.g) if (t[0] && t[0].dispose) t[0].dispose();   // t 是 [几何, x,y,z,…] 元组，dispose 里面的几何
  const out = { desc: items.map((it, i) => ({ b: it.b, m: it.m, has: !!geos[i] })), geos };
  GEO_CACHE.set(key, out);
  return out;
}
// 光环 / 天光柱 / 旋核的几何同样只跟种类有关
const PRIM_CACHE = new Map();
function primGeos(key, possessed) {
  const ck = `${key}|${possessed ? 'p' : 'a'}`;
  if (PRIM_CACHE.has(ck)) return PRIM_CACHE.get(ck);
  const L = LOOKS[key], o = {};
  if (L.aura) { const g = new THREE.RingGeometry(L.aura.r * 0.9, L.aura.r, 32); g.rotateX(-Math.PI / 2); o.ring = g; }
  if (L.beam) o.beam = new THREE.CylinderGeometry(L.beam.r1, L.beam.r2, L.beam.h, 14, 1, true);
  if (possessed) { o.core = new THREE.OctahedronGeometry(0.13); o.shard = new THREE.TetrahedronGeometry(0.07); }
  PRIM_CACHE.set(ck, o);
  return o;
}
// 加载期把每种外观的着色器与几何全部备好：登场那一帧只剩挂接与移动。
// 不只是三种 BOSS——感染体/射手/重装第一次上场同样要现融轮廓件、现建缓冲、现编译，
// 而那个时机恰好是开局第一波，所以遍历整个 LOOKS。附身版只有 BOSS 会走，不必预热。
export function prewarmBossFx(renderer, scene, camera) {
  if (!renderer || !scene || !camera) return 0;
  const box = new THREE.BoxGeometry(0.02, 0.02, 0.02);
  const grp = new THREE.Group();
  grp.visible = false;                      // compile 不看 visible，隐藏组照样能把程序编出来
  scene.add(grp);
  let n = 0;
  for (const key of Object.keys(LOOKS)) {
    for (const poss of (BOSS_TINT[key] ? [false, true] : [false])) {
      const set = takeSet(key, poss);
      set.prewarmed = true;                 // 标记"加载期就建好"，回归测试据此判断有没有漏掉某种外观
      const parts = accParts(key), pg = primGeos(key, poss);
      for (const m of set.list) {
        const o = m.isSpriteMaterial ? new THREE.Sprite(m) : new THREE.Mesh(box, m);
        o.position.set(0, -900, 0);
        grp.add(o); n++;
      }
      // 轮廓件与光环/光柱/旋核按真正上场时的"几何 + 材质"配对各走一遍，
      // 这样第一次刷怪连顶点缓冲都是现成的
      for (let i = 0; i < parts.desc.length; i++) {
        if (!parts.desc[i].has) continue;
        const o = new THREE.Mesh(parts.geos[i], parts.desc[i].m === 'E' ? set.EM : set.AM);
        o.position.set(0, -900, 0); grp.add(o); n++;
      }
      for (const [g, m] of [[pg.ring, set.aura], [pg.beam, set.beam], [pg.core, set.core], [pg.shard, set.core]]) {
        if (!g || !m) continue;
        const o = new THREE.Mesh(g, m);
        o.position.set(0, -900, 0); grp.add(o); n++;
      }
      giveSet(key, poss, set);
    }
  }
  try { renderer.compile(scene, camera); } catch (e) { /* 编译失败就照常留到登场时编 */ }
  scene.remove(grp);
  box.dispose();
  return n;
}

// 上装：把一副人类士兵骨架改扮成怪物 / BOSS。opts.lights=false 时跳过动态点光源（低画质）
export function dressSoldier(sol, key, possessed, optsIn) {
  const opts = optsIn || {};
  const L = LOOKS[key];
  undressSoldier(sol);
  if (!L || !sol || !sol.B) return;
  sol.lookKey = key; sol.possessed = !!possessed;
  const body = sol.material;
  body.color.setHex(L.tint);
  body.roughness = L.rough; body.metalness = L.metal;
  body.emissive.setHex(L.emis); body.emissiveIntensity = L.ei;
  const s = L.scale * (possessed ? 1.04 : 1), ws = L.ws * (possessed ? 1.05 : 1), ds = L.ds;
  sol.mesh.scale.set(s * ws, s, s * ds);
  // 骨骼链会带着配件一起缩放：这里只抵消横/纵/深的不比例，配件最终按"人体设计尺寸 × 体重 s"落地，
  // 既盖得住巨体，又不会被拉成薄片
  const ax = 1 / ws, ay = 1, az = 1 / ds;
  sol.style = L.style;
  sol.hitMat = L.hit || 'flesh';
  sol.hideGun = !!L.noGun;
  if (sol.gun) sol.gun.visible = !L.noGun;

  // 材质与几何全部走缓存：第二次登场只是把现成的东西挂到骨骼上
  const set = takeSet(key, possessed);
  const AM = set.AM, EM = set.EM;
  const mats = set.list, extras = [];
  const parts = accParts(key), pg = primGeos(key, possessed);
  sol.matSet = set; sol.matKey = key; sol.matPoss = !!possessed;
  for (let i = 0; i < parts.desc.length; i++) {
    const it = parts.desc[i];
    const bone = sol.B[it.b];
    if (!bone || !it.has) continue;
    const mesh = new THREE.Mesh(parts.geos[i], it.m === 'E' ? EM : AM);
    mesh.scale.set(ax, ay, az);
    mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false;
    bone.add(mesh); extras.push(mesh);
  }
  // 地面警示环 = 技能半径，隔着烟雾也能看出它是什么、有多大
  if (L.aura && pg.ring) {
    const ring = new THREE.Mesh(pg.ring, set.aura);
    ring.position.y = 0.06; ring.renderOrder = 3;
    sol.root.add(ring); extras.push(ring);
    sol.aura = ring;
  }
  // 玩家附身的 BOSS：头顶旋核 + 双翼碎片，明确"这里面装的是人"
  if (possessed && set.core) {
    const core = new THREE.Mesh(pg.core, set.core);
    core.position.set(0, 0.4, 0);
    const orbit = new THREE.Group();
    for (const sx of [1, -1]) {
      const sh = new THREE.Mesh(pg.shard, set.core);
      sh.position.set(sx * 0.3, 0, 0); orbit.add(sh);
    }
    orbit.position.set(0, 0.36, 0);
    sol.B.head.add(core); sol.B.head.add(orbit);
    core.scale.set(ax, ay, az); orbit.scale.set(ax, ay, az);
    extras.push(core, orbit);
    sol.crown = { core, orbit };
  }
  // 本体光源 + 光晕 + 天光柱：BOSS 站到那儿就是一个发光体，隔船舱也能看见它在挪
  // ⚠️ 这三样都是"整屏级"的加性面片：母体的地面环 9.2m 直径 + 天光柱 6.5m 高 + 光晕 2.6m，
  // 贴脸时三层叠加能把帧时吃到整场的 6 倍（实测 ×6.76），所以全部按"离镜头多远"做淡出
  const refs = { pulse: 0, lod: 0, mats: { AM, EM } };
  if (L.halo && set.halo) {
    const hb = sol.B[L.halo.b] || sol.B.chest;
    const halo = new THREE.Sprite(set.halo);
    halo.position.set(0, L.halo.y, L.halo.z);
    // Sprite 的屏幕尺寸按父骨骼的世界缩放放大（母体横向 3.3 倍），先折算回设计米数：
    // 否则一张加性光片就有十几米，登场瞬间整屏被高光糊住
    const hx = L.halo.s / (s * ws), hy = L.halo.s / s;
    halo.scale.set(hx, hy, 1); halo.renderOrder = 6;
    hb.add(halo); extras.push(halo);
    refs.halo = { o: halo, sx: hx, sy: hy };
  }
  if (L.beam && set.beam && pg.beam) {
    const beam = new THREE.Mesh(pg.beam, set.beam);
    beam.position.y = L.beam.h * 0.5 - 0.2;
    beam.renderOrder = 5;
    sol.root.add(beam); extras.push(beam);
    refs.beam = beam;
  }
  if (L.lamp && opts.lamp) {
    // 全场只有一盏"BOSS 灯"，由联机层持有并在 BOSS 之间转手：
    // 光源数量恒定，避免 BOSS 登场瞬间整场景重编译着色器（会卡一帧）
    const pl = opts.lamp;
    pl.color.setHex(L.glow); pl.distance = L.lamp.dist;
    pl.userData.baseI = L.lamp.i;
    pl.userData.holder = sol;                 // 谁拿着这盏灯：换手时旧持有者不能再把它抢回去
    pl.position.set(0, L.lamp.y, L.lamp.z);
    pl.intensity = L.lamp.i;
    (sol.B[L.lamp.b] || sol.B.chest).add(pl);
    refs.light = { o: pl, i: L.lamp.i, shared: true };
  }
  sol.fxRefs = refs;
  sol.extras = extras; sol.extraMats = mats;
  sol.onFade = (op) => {
    refs.fade = op;
    for (const m of mats) {
      if (!m.isMaterial) continue;   // 点光源在 mats 里只为了统一回收
      const base = m.userData.base === undefined ? (m.userData.base = m.opacity === undefined ? 1 : m.opacity) : m.userData.base;
      m.transparent = op < base - 0.001 || base < 0.999;
      m.opacity = base * op;
    }
  };
  const pulse = L.pulse === undefined ? 0.7 : L.pulse;
  const bloomBase = L.bloom || 2.4;
  sol.onFrame = (dt) => {
    const p = refs.pulse || 0, fd = refs.fade === undefined ? 1 : refs.fade;
    // 贴脸时把加性面片淡到两成：登场那一刻BOSS 就在脸上，这几层除了糊屏什么也表达不了
    const ld = 1 - 0.8 * (refs.lod || 0);
    refs.pulse = p > 0.001 ? p * Math.exp(-dt * 3.2) : 0;
    EM.emissiveIntensity = bloomBase + Math.sin(sol.breathT * (L.beat || 2.2)) * pulse + p * 4;
    if (refs.halo) {
      const k = (1 + p * 0.25) * fd * ld;
      refs.halo.o.material.opacity = Math.min(0.5, (0.5 + Math.sin(sol.breathT * 2.2) * 0.12 + p * 0.4) * fd * ld);
      refs.halo.o.scale.set(refs.halo.sx * k, refs.halo.sy * k, 1);
    }
    if (refs.beam) refs.beam.material.opacity = Math.min(0.1, (0.085 + Math.sin(sol.breathT * 1.4) * 0.02 + p * 0.16) * fd * ld);
    if (refs.light && refs.light.o.userData.holder === sol) refs.light.o.intensity = refs.light.i * (0.85 + Math.sin(sol.breathT * 2.4) * 0.15 + p * 1.3) * fd;
    if (sol.aura) sol.aura.material.opacity = Math.min(0.26, (0.16 + Math.sin(sol.breathT * 1.8) * 0.07 + p * 0.5) * fd * ld);
    if (sol.crown) { sol.crown.core.rotation.y += dt * 2.6; sol.crown.orbit.rotation.y -= dt * 1.5; }
  };
}

export function undressSoldier(sol) {
  if (!sol) return;
  // 配件只从骨骼上摘下来，几何与材质都是缓存池里的，绝不 dispose（否则下一只同类又要现编译）
  if (sol.extras) {
    for (const m of sol.extras) if (m.parent) m.parent.remove(m);
    sol.extras = null;
  }
  if (sol.fxRefs) {
    const lt = sol.fxRefs.light;
    // 共享灯只在"还归我管"时归还：附身换手时新 BOSS 可能已经先把它拿走了
    if (lt && lt.shared && lt.o.userData.holder === sol) {
      if (lt.o.parent) lt.o.parent.remove(lt.o);
      lt.o.intensity = 0;
      lt.o.userData.holder = null;
    }
    sol.fxRefs = null;
  }
  giveSet(sol.matKey, sol.matPoss, sol.matSet);   // 整套材质归还池子，动画量已在 giveSet 里复位
  sol.matSet = null; sol.matKey = null; sol.matPoss = null;
  sol.extraMats = null;
  if (sol.lookKey) {
    const body = sol.material;
    body.color.setHex(0xffffff); body.roughness = 0.82; body.metalness = 0.05;
    body.emissive.setHex(0x000000); body.emissiveIntensity = 1;
    sol.mesh.scale.set(1, 1, 1);
    sol.hideGun = false;
    if (sol.gun) sol.gun.visible = true;
  }
  sol.lookKey = null; sol.possessed = false; sol.style = null; sol.aura = null; sol.crown = null;
  sol.onFade = null; sol.onFrame = null; sol.hitMat = null;
}

// 命中盒不变，但受击特效按体质分家：铁皮的爆火星、母体溅酸液、其余见血
export function hitMatOf(a) { return (a && a.soldier && a.soldier.hitMat) || 'flesh'; }

// 登场 / 技能起手 / 受击：把光效顶一下，随后几秒自然衰减
export function bump(sol, k = 1) {
  if (sol && sol.fxRefs) sol.fxRefs.pulse = Math.min(1.1, (sol.fxRefs.pulse || 0) + k);
}

// 观者距离决定加性面片的淡出系数：3m 内淡到两成，8m 外全额显示
// 这一条是"BOSS 登场把整屏糊死"的闸门——面片本身没变，变的是它占多少像素
export function bossLod(sol, d) {
  const R = sol && sol.fxRefs;
  if (R) R.lod = d < 3 ? 1 : d > 8 ? 0 : 1 - (d - 3) / 5;
}

const _w = new THREE.Vector3();
// 本体持续冒出的火星 / 酸滴 / 影雾（由调用方按距离节流，fx 传 g.fx）
export function emitAmbient(sol, fx, dt) {
  const L = sol && sol.lookKey ? LOOKS[sol.lookKey] : null;
  if (!L || !L.emit || !fx) return;
  sol.emT = (sol.emT || 0) + dt;
  if (sol.emT < L.emit.rate) return;
  sol.emT = 0;
  const b = sol.B[L.emit.bone];
  if (!b) return;
  b.updateWorldMatrix(true, false);
  const g = L.glow, r = ((g >> 16) & 255) / 255, gg = ((g >> 8) & 255) / 255, bl = (g & 255) / 255;
  for (const at of L.emit.at) {
    _w.set(at[0], at[1], at[2]).applyMatrix4(b.matrixWorld);
    if (L.emit.kind === 'ember') {
      fx.add.emit({ x: _w.x, y: _w.y, z: _w.z, vx: (Math.random() - 0.5) * 0.5, vy: 0.9 + Math.random() * 0.9, vz: (Math.random() - 0.5) * 0.5, life: 0, max: 0.65 + Math.random() * 0.3, s0: 0.1, s1: 0.02, r: r * 2.6, g: gg * 1.6, b: bl, a0: 0.85, a1: 0, grav: -0.8, drag: 1.4 });
    } else if (L.emit.kind === 'acid') {
      fx.add.emit({ x: _w.x, y: _w.y, z: _w.z, vx: (Math.random() - 0.5) * 0.3, vy: -0.2, vz: (Math.random() - 0.5) * 0.3, life: 0, max: 0.55, s0: 0.07, s1: 0.03, r: r * 1.8, g: gg * 2.4, b: bl * 0.7, a0: 1, a1: 0.5, grav: 7, drag: 0.6, floor: 0.02 });
      fx.smoke.emit({ x: _w.x, y: _w.y, z: _w.z, vx: 0, vy: 0.25, vz: 0, life: 0, max: 0.9, s0: 0.12, s1: 0.5, r: 0.22, g: 0.6, b: 0.16, a0: 0.3, a1: 0, grav: -0.3, drag: 2 });
    } else {
      fx.add.emit({ x: _w.x, y: _w.y, z: _w.z, vx: (Math.random() - 0.5) * 0.4, vy: 0.35 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.4, life: 0, max: 0.8, s0: 0.13, s1: 0.28, r: r * 1.6, g: gg * 1.2, b: bl * 2.2, a0: 0.5, a1: 0, grav: -0.5, drag: 2.2 });
    }
  }
}
