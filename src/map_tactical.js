// 新地图共用的表面、建筑细节和环境；路线与掩体分别由各地图定义。
import * as THREE from 'three';
import { makeKit } from './mapkit.js';
import { arenaTextures } from './map_surfaces.js';
import { createMapArt } from './map_art.js';

export function defineArena({ id, name, desc, w, d, palette, label, build, pve, sea = false, huge = false }) {
  const daylight = {
    bazaar: { elev: 32, sunColor: 0xffd39d, sunInt: 3.2, hemiSky: 0x9ebed2, hemiGround: 0x66523b, hemiInt: 0.35, exposure: 0.67, envInt: 0.26, fog: 0xc9b99b, fogDensity: 0.0011, cloudCover: 0.18 },
    depot: { elev: 28, sunColor: 0xffe1ba, sunInt: 3.1, hemiSky: 0xa4bccd, hemiGround: 0x343e3d, hemiInt: 0.45, exposure: 0.68, envInt: 0.28, fog: 0x9dabb0, fogDensity: 0.0014, cloudCover: 0.56 },
    turbine: { elev: 48, sunColor: 0xddeef5, sunInt: 2.3, hemiSky: 0xadcbd7, hemiGround: 0x263b45, hemiInt: 0.7, exposure: 0.74, envInt: 0.25, fog: 0x829aa6, fogDensity: 0.001, cloudCover: 0.4 },
    harbor: { elev: 34, sunColor: 0xffe5bc, sunInt: 3.2, hemiSky: 0x93bdcf, hemiGround: 0x344b50, hemiInt: 0.4, exposure: 0.66, envInt: 0.3, fog: 0x9fbcc7, fogDensity: 0.0009, cloudCover: 0.36 },
  }[id];
  return {
    id, name, desc, build, pve, sea, menuLabel: label, sizeClass: huge ? 'large' : 'normal', navCell: huge ? 1 : 0.5,
    bounds: [-w / 2, -d / 2, w / 2, d / 2], shadow: [-w / 2 - 8, w / 2 + 8, -1, huge ? 48 : 28, -d / 2 - 8, d / 2 + 8],
    radar: { w, d, bg: '#4b5156' }, textures: arenaTextures(id, palette, label),
    env: {
      day: { azim: 125, turbidity: 3.5, rayleigh: 1.3, mie: 0.003, skyZen: 0x5488ad, skyHor: 0xd5e0e0, cloudLit: 0xfff4e6, cloudShade: 0x91a5b2, ...daylight },
      dusk: { elev: 8, azim: 150, turbidity: 7, rayleigh: 1.8, mie: 0.005, sunColor: 0xffae72, sunInt: 2.5, hemiSky: 0x7e99bd, hemiGround: 0x2b3945, hemiInt: 0.55, exposure: 0.72, envInt: 0.28, fog: 0x8992a5, fogDensity: huge ? 0.0012 : 0.0016, skyZen: 0x34446d, skyHor: 0xe4b29a, cloudLit: 0xffc59b, cloudShade: 0x686986, cloudCover: 0.4 },
    },
  };
}

export function createArena(scene, T, world, opts, { id, w, d, palette, seed = 8319, openSky = true, surroundGround = true }) {
  const k = makeKit(T, world, seed), { box, solid, geom, prims } = k;
  for (const suffix of ['Wall', 'Ground', 'Roof']) k.def(suffix.toLowerCase(), k.std({ ...T[id + suffix], roughness: 1, normalScale: new THREE.Vector2(0.55, 0.55), metalness: suffix === 'Roof' && id !== 'bazaar' ? 0.3 : 0 }), suffix === 'Wall' ? 4 : 6);
  k.def('sign', k.std({ ...T[id + 'Sign'], roughness: 0.8 }), 'unit');
  k.plain('trim', palette.trim); k.plain('accent', palette.accent);
  k.plain('glass', 0x284f62, { metal: 0.35, rough: 0.25 });
  k.plain('leaf', 0x517252);
  k.def('paving', k.std({ ...T[id + 'Ground'], color: 0xb3b7b3, roughness: 1 }), 6);
  const art = createMapArt(k, scene, T, world, opts, { id, w, d });
  const block = (x, z, sx, sz, h = 3, key = 'wall', y = 0) => {
    box(x, y + h / 2, z, sx, h, sz, 0, key);
    solid(x, y + h / 2, z, sx, h, sz, 0, { mat: key === 'wall' ? 'concrete' : 'metal', surface: key === 'wall' ? 'concrete' : 'metal' });
    if (!y) { k.foot(x, z, sx, sz, 0); art.cover(x, z, sx, sz, h, key); }
  };
  const pair = (fn, x, z, ...args) => { fn(x, z, ...args); fn(-x, -z, ...args); };
  solid(0, -0.5, 0, w + 1, 1, d + 1, 0, { mat: 'concrete', surface: 'concrete', tag: 'deck' });
  box(0, -0.025, 0, w, 0.05, d, 0, 'ground');
  if (surroundGround) box(0, -0.4, 0, w * 4, 0.2, d * 5, 0, 'ground');
  for (const z of [-d / 2 + 0.25, d / 2 - 0.25]) {
    block(0, z, w, 0.5, id === 'harbor' ? 1.1 : 5);
    if (id === 'harbor') k.fence(-w / 2, z, w / 2, z, 1.1, 4.2, 'darkSteel');
  }
  for (const x of [-w / 2 + 0.25, w / 2 - 0.25]) block(x, 0, 0.5, d, 5);
  for (const z of [-d / 2 + 0.25, d / 2 - 0.25]) box(0, id === 'harbor' ? 1.15 : 5.08, z, w, 0.16, 0.75, 0, 'trim');

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
    art.building(x, z, sx, sz, h, doors);
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
    art.tank(x, z, r, h);
  };
  const finish = () => {
    if (openSky) art.skyline();
    const artResources = art.finish();
    const meshes = k.flush(scene, opts), spawns = { BL: [], GR: [] };
    for (let i = 0; i < 10; i++) {
      const x = -w / 2 + 4 + Math.floor(i / 5) * 2.5, z = -6 + (i % 5) * 3;
      spawns.BL.push({ x, z, yaw: -Math.PI / 2 });
      spawns.GR.push({ x: -x, z: -z, yaw: Math.PI / 2 });
    }
    return { ...artResources, spawns, meshes, materials: k.matDefs, lampSpots: k.lampSpots, funnelTop: null, update: (dt, t) => k.update(dt, t) };
  };
  return { k, box, block, pair, building, sign, tank, art, finish };
}
