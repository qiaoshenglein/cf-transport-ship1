// 新地图共用的表面、建筑细节和环境；路线与掩体分别由各地图定义。
import * as THREE from 'three';
import { makeKit } from './mapkit.js';
import { mulberry32, normalFromHeight } from './textures.js';

export function arenaTextures(id, palette, label) {
  return (T, quality = 'high') => {
    if (T[id + 'Wall']) return;
    const S = quality === 'low' ? 128 : 256, rnd = mulberry32(8319);
    for (const [suffix, color, pattern] of [['Wall', palette.wall, 'brick'], ['Ground', palette.ground, 'pave'], ['Roof', palette.roof, 'rib']]) {
      const c = document.createElement('canvas'); c.width = c.height = S;
      const ctx = c.getContext('2d'), img = ctx.createImageData(S, S), heights = new Float32Array(S * S);
      const rgb = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const row = Math.floor(y / (S / 8));
        const seam = pattern === 'rib' ? x % (S / 8) < 2 : pattern === 'pave'
          ? x % (S / 2) < 1 || y % (S / 2) < 1
          : y % (S / 8) < 2 || (x + (row % 2) * S / 8) % (S / 4) < 2;
        const n = rnd() * 0.10 + (seam ? 0.58 : 0.92), i = y * S + x;
        img.data.set([...rgb.map((v) => Math.min(255, v * n)), 255], i * 4);
        heights[i] = seam ? 0.15 : 0.5 + rnd() * 0.08;
      }
      ctx.putImageData(img, 0, 0);
      const map = new THREE.CanvasTexture(c), normalMap = new THREE.CanvasTexture(normalFromHeight(heights, S, S, 1));
      map.colorSpace = THREE.SRGBColorSpace;
      for (const t of [map, normalMap]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      T[id + suffix] = { map, normalMap };
    }
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#' + palette.trim.toString(16).padStart(6, '0'); ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#e9c680'; ctx.lineWidth = 8; ctx.strokeRect(12, 12, 488, 232);
    ctx.fillStyle = '#fff3db'; ctx.font = 'bold 48px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label, 256, 108); ctx.font = '26px sans-serif'; ctx.fillText('A  ←   /   →  B', 256, 178);
    const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
    T[id + 'Sign'] = { map };
  };
}

export function defineArena({ id, name, desc, w, d, palette, label, build, pve, sea = false, huge = false }) {
  return {
    id, name, desc, build, pve, sea, sizeClass: huge ? 'large' : 'normal', navCell: huge ? 1 : 0.5,
    bounds: [-w / 2, -d / 2, w / 2, d / 2], shadow: [-w / 2 - 8, w / 2 + 8, -1, huge ? 48 : 28, -d / 2 - 8, d / 2 + 8],
    radar: { w, d, bg: '#4b5156' }, textures: arenaTextures(id, palette, label),
    env: {
      day: { elev: 46, azim: 125, turbidity: 3.5, rayleigh: 1.3, mie: 0.003, sunColor: 0xffebd2, sunInt: 3.5, hemiSky: 0xcadcea, hemiGround: palette.ground, hemiInt: 0.48, exposure: 0.62, fog: 0xb4c6cf, fogDensity: huge ? 0.0016 : 0.003, skyZen: 0x5488ad, skyHor: 0xd5e0e0, cloudLit: 0xfff4e6, cloudShade: 0x91a5b2, cloudCover: 0.32 },
      dusk: { elev: 8, azim: 150, turbidity: 7, rayleigh: 1.8, mie: 0.005, sunColor: 0xffb07a, sunInt: 2.6, hemiSky: 0x97a8c7, hemiGround: palette.ground, hemiInt: 0.5, exposure: 0.7, fog: 0x9b98a4, fogDensity: huge ? 0.002 : 0.004, skyZen: 0x34446d, skyHor: 0xe4b29a, cloudLit: 0xffc59b, cloudShade: 0x686986, cloudCover: 0.4 },
    },
  };
}

export function createArena(scene, T, world, opts, { id, w, d, palette, seed = 8319, openSky = true, surroundGround = true }) {
  const k = makeKit(T, world, seed), { box, solid, geom, prims } = k;
  for (const suffix of ['Wall', 'Ground', 'Roof']) k.def(suffix.toLowerCase(), k.std({ ...T[id + suffix], roughness: suffix === 'Roof' ? 0.65 : 0.92 }), suffix === 'Wall' ? 4 : 6);
  k.def('sign', k.std({ ...T[id + 'Sign'], roughness: 0.8 }), 'unit');
  k.plain('trim', palette.trim); k.plain('accent', palette.accent);
  k.plain('glass', 0x284f62, { metal: 0.35, rough: 0.25 });
  k.plain('leaf', 0x517252); k.plain('paving', 0x7a7f80);
  const block = (x, z, sx, sz, h = 3, key = 'wall', y = 0) => {
    box(x, y + h / 2, z, sx, h, sz, 0, key);
    solid(x, y + h / 2, z, sx, h, sz, 0, { mat: key === 'wall' ? 'concrete' : 'metal', surface: key === 'wall' ? 'concrete' : 'metal' });
    if (!y) k.foot(x, z, sx, sz, 0);
  };
  const pair = (fn, x, z, ...args) => { fn(x, z, ...args); fn(-x, -z, ...args); };
  solid(0, -0.5, 0, w + 1, 1, d + 1, 0, { mat: 'concrete', surface: 'concrete', tag: 'deck' });
  box(0, -0.025, 0, w, 0.05, d, 0, 'ground');
  if (surroundGround) box(0, -0.4, 0, w * 4, 0.2, d * 5, 0, 'ground');
  for (const z of [-d / 2 + 0.25, d / 2 - 0.25]) block(0, z, w, 0.5, 5);
  for (const x of [-w / 2 + 0.25, w / 2 - 0.25]) block(x, 0, 0.5, d, 5);
  for (const z of [-d / 2 + 0.25, d / 2 - 0.25]) box(0, 5.08, z, w, 0.16, 0.75, 0, 'trim');

  // 遮住出生轴线，左右各有出口；十个出生点可容纳当前服务器队伍上限。
  for (const s of [-1, 1]) {
    block(s * (w / 2 - 13), 0, 2, 15, 3.8, 'trim');
    box(s * (w / 2 - 13), 3.88, 0, 2.2, 0.16, 15.2, 0, 'accent');
    for (const z of [-d / 2 + 4, d / 2 - 4]) {
      block(s * (w / 2 - 5), z, 0.35, 0.35, 6.2, 'trim');
      k.lamp(s * (w / 2 - 5), 6.1, z, true);
    }
  }
  const building = (x, z, sx, sz, h = 6, doors = [0, 1, 2, 3]) => {
    k.building(x, z, sx, sz, h, 'wall', { th: 0.5, roofKey: 'roof', roofY: 0.3, doors: doors.map((side) => ({ side, w: 4.8, h: 4.3 })) });
    for (const dz of [-sz / 2 - 0.27, sz / 2 + 0.27]) {
      box(x, h - 0.3, z + dz, sx, 0.3, 0.12, 0, 'accent');
      for (let dx = -sx / 2 + 2; dx < sx / 2; dx += 3.4) {
        box(x + dx, h - 1.2, z + dz, 1.8, 0.9, 0.08, 0, 'glass');
        box(x + dx, h - 1.7, z + dz, 2.1, 0.1, 0.3, 0, 'trim');
      }
    }
    for (const dx of [-sx / 2, sx / 2]) for (const dz of [-sz / 2, sz / 2]) box(x + dx, h / 2, z + dz, 0.32, h, 0.32, 0, 'trim');
    // 外机与通风栅格仅在不可进入的屋顶。
    for (const dx of [-sx / 4, sx / 4]) {
      box(x + dx, h + 0.7, z, 2.5, 0.8, 2.1, 0, 'trim');
      for (let dz = -0.8; dz < 1; dz += 0.3) box(x + dx, h + 1.12, z + dz, 2.1, 0.03, 0.08, 0, 'steel');
    }
  };
  const sign = (x, z, y = 4.8, yaw = 0) => box(x, y, z, 4, 1.6, 0.1, yaw, 'sign');
  const tank = (x, z, r = 1.5, h = 4, key = 'accent') => {
    geom(key, prims.cyl, x, h / 2, z, 0, 0, 0, r, h, r);
    // 分段环墙近似圆柱，保持视觉圆柱与碰撞轮廓一致。
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      solid(x + Math.cos(a) * r * 0.83, h / 2, z + Math.sin(a) * r * 0.83, r * 0.62, h, r * 0.62, 0, { mat: 'metal', surface: 'metal' });
    }
    solid(x, h / 2, z, r, h, r, 0, { mat: 'metal' });
    for (const y of [0.3, h - 0.3]) geom('trim', prims.cyl, x, y, z, 0, 0, 0, r * 1.02, 0.12, r * 1.02);
    geom('steel', prims.cyl, x, h + 0.13, z, 0, 0, 0, r * 0.55, 0.25, r * 0.55);
  };
  const finish = () => {
    if (openSky) {
      // 外围轮廓只参与画面，永不生成战斗区外碰撞。
      for (const s of [-1, 1]) for (let x = -w / 2; x <= w / 2; x += 13) {
        const h = 7 + k.rnd() * 12, z = s * (d / 2 + 15 + k.rnd() * 8);
        box(x, h / 2 - 1, z, 8 + k.rnd() * 4, h, 8, 0, 'wall');
        box(x, h - 0.7, z, 8, 0.4, 8.2, 0, 'trim');
      }
    }
    const meshes = k.flush(scene, opts), spawns = { BL: [], GR: [] };
    for (let i = 0; i < 10; i++) {
      const x = -w / 2 + 4 + Math.floor(i / 5) * 2.5, z = -6 + (i % 5) * 3;
      spawns.BL.push({ x, z, yaw: -Math.PI / 2 });
      spawns.GR.push({ x: -x, z: -z, yaw: Math.PI / 2 });
    }
    return { spawns, meshes, materials: k.matDefs, lampSpots: k.lampSpots, funnelTop: null, update: (dt, t) => k.update(dt, t) };
  };
  return { k, box, block, pair, building, sign, tank, finish };
}
