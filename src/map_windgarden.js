// 风栖庭院：原创明亮幻想场景。对战结构保持中心对称，Tripo 装饰独立加载。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeKit } from './mapkit.js';
import { mulberry32, normalFromHeight } from './textures.js';

export function windgardenTextures(T, quality = 'high') {
  const S = quality === 'low' ? 128 : quality === 'medium' ? 256 : 512;
  if (T.windgardenGrass?.map?.image?.width === S) return;
  const cache = T['windgardenCache' + S];
  if (cache) { Object.assign(T, cache); return; }
  const textures = {}, rnd = mulberry32(85117);
  for (const [name, rgb] of [['Grass', [70, 121, 39]], ['Wall', [210, 199, 165]], ['Roof', [30, 101, 113]]]) {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d'), img = ctx.createImageData(S, S), heights = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const row = Math.floor(y / (S / 8));
      const seam = name !== 'Grass' && (y % (S / 8) < S / 128 || (x + (row % 2) * S / 8) % (S / 4) < S / 128);
      const n = rnd() * 10 + Math.sin(x * 0.12) * 2;
      const v = seam ? -30 : n;
      const i = y * S + x; img.data.set([...rgb.map(a => Math.max(0, Math.min(255, a + v))), 255], i * 4);
      heights[i] = seam ? 0.2 : 0.5 + n / 130;
    }
    ctx.putImageData(img, 0, 0);
    const map = new THREE.CanvasTexture(c), normalMap = new THREE.CanvasTexture(normalFromHeight(heights, S, S, 0.7));
    map.colorSpace = THREE.SRGBColorSpace;
    for (const t of [map, normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
    textures['windgarden' + name] = { map, normalMap };
  }
  T['windgardenCache' + S] = textures; Object.assign(T, textures);
}

// 共享克隆资源只释放一次；加载完成前切图也会回收迟到的 GLB。
function decorations(root) {
  let gone = false;
  const sources = [], mounts = [];
  const release = (object) => {
    const gs = new Set(), ms = new Set(), ts = new Set();
    object.traverse(o => { if (!o.isMesh) return; gs.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) { ms.add(m); for (const t of Object.values(m)) if (t?.isTexture) ts.add(t); }
    });
    gs.forEach(g => g.dispose()); ms.forEach(m => m.dispose()); ts.forEach(t => t.dispose());
  };
  const specs = [
    { id: 'windmill', height: 17, width: 14, places: [[-26, -0.1, -44, 0.35], [26, -0.1, 44, Math.PI + 0.35]] },
    { id: 'windtree', height: 15, width: 19, places: [[7, -0.1, -46, 0], [-7, -0.1, 46, Math.PI], [-58, -0.1, 16, 1.2], [58, -0.1, -16, -1.2]] },
    { id: 'windshrine', height: 6, width: 5.5, places: [[0, 5.9, 0, 0], [-20, 8, -14, 0], [20, 8, 14, Math.PI]] },
  ];
  const ready = Promise.all(specs.map(async spec => {
    try {
      const { scene } = await new GLTFLoader().loadAsync(`/assets/models/fantasy-${spec.id}.glb`);
      if (gone) { release(scene); return false; }
      const b = new THREE.Box3().setFromObject(scene), size = b.getSize(new THREE.Vector3()), center = b.getCenter(new THREE.Vector3());
      const s = Math.min(spec.height / Math.max(size.y, 0.01), spec.width / Math.max(size.x, size.z, 0.01));
      scene.scale.setScalar(s); scene.position.set(-center.x * s, -b.min.y * s, -center.z * s);
      scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      sources.push(scene);
      for (const [x, y, z, yaw] of spec.places) {
        const mount = new THREE.Group(); mount.name = 'tripo-' + spec.id; mount.position.set(x, y, z); mount.rotation.y = yaw;
        mount.add(scene.clone(true)); root.add(mount); mounts.push(mount);
      }
      return true;
    } catch (e) { if (!gone) console.warn('风栖庭院装饰加载失败：' + spec.id, e.message); return false; }
  })).then(results => results.every(Boolean));
  return { ready, dispose() { gone = true; mounts.forEach(o => o.removeFromParent()); sources.forEach(release); sources.length = mounts.length = 0; } };
}

function build(scene, T, world, opts = {}) {
  const k = makeKit(T, world, 85117), { box, solid, geom, prims, rnd } = k;
  for (const [key, suffix, uv] of [['grass', 'Grass', 5], ['stone', 'Wall', 4], ['roof', 'Roof', 3]])
    k.def(key, k.std({ ...T['windgarden' + suffix], roughness: 0.94, metalness: 0, normalScale: new THREE.Vector2(0.25, 0.25) }), uv);
  for (const [key, color] of Object.entries({ ivory: 0xf0e3ba, gold: 0xc3a35c, timber: 0x705542, leaf: 0x3b7134, leafLight: 0x779d3a, hill: 0x547e60, distant: 0x88aaa1, flower: 0x9a72cb, petal: 0xffd998, teal: 0x377c88 })) k.plain(key, color, { metal: 0, rough: 0.9 });
  k.emissive('crystal', 0x67dfd6, 0.55); k.emissive('warm', 0xffdd8e, 0.7);
  const block = (x, z, w, d, h = 3, key = 'stone', y = 0) => {
    box(x, y + h / 2, z, w, h, d, 0, key); solid(x, y + h / 2, z, w, h, d, 0, { mat: 'concrete', surface: 'concrete' });
  };
  const pair = (fn, x, z, ...a) => { fn(x, z, ...a); fn(-x, -z, ...a); };
  solid(0, -0.5, 0, 97, 1, 65, 0, { mat: 'concrete', surface: 'concrete', tag: 'deck' });
  box(0, -0.03, 0, 96, 0.06, 64, 0, 'grass'); box(0, -0.4, 0, 450, 0.3, 450, 0, 'grass');
  // 平坦石路保证射击与导航一致，草地细节不产生隐形障碍。
  for (const z of [-25, 0, 25]) box(0, 0.013, z, 94, 0.025, z ? 6.5 : 8, 0, 'stone');
  for (const x of [-41, -9, 9, 41]) box(x, 0.016, 0, 5, 0.028, 62, 0, 'stone');
  for (const z of [-28.4, -21.6, -4.15, 4.15, 21.6, 28.4]) box(0, 0.035, z, 94, 0.045, 0.14, 0, 'ivory');
  // 花园外墙与柱廊，栏墙有实体碰撞。
  for (const z of [-31.7, 31.7]) { block(0, z, 96, 0.6, 3.3); box(0, 3.4, z, 96, 0.2, 0.9, 0, 'ivory'); }
  for (const x of [-47.7, 47.7]) block(x, 0, 0.6, 64, 4.4);
  for (const z of [-31.7, 31.7]) for (let x = -44; x <= 44; x += 8) {
    block(x, z, 1, 1, 4); box(x, 4.1, z, 1.35, 0.22, 1.35, 0, 'ivory');
    geom('gold', prims.sph, x, 4.45, z, 0, 0, 0, 0.24, 0.36, 0.24);
  }
  const screen = (x, z) => { block(x, z, 2, 16, 3.8); box(x, 3.9, z, 2.3, 0.2, 16.3, 0, 'ivory');
    for (const dx of [-1.02, 1.02]) for (const dz of [-6, 0, 6]) {
      box(x + dx, 2.5, z + dz, 0.06, 1.9, 1.4, 0, 'teal'); box(x + dx * 1.02, 1.6, z + dz, 0.07, 0.08, 1.5, 0, 'gold');
    }
  }; pair(screen, -35, 0);
  const archG = new THREE.TorusGeometry(1, 0.15, 6, 18, Math.PI);
  const arch = (x, z, yaw = 0) => {
    for (const s of [-1, 1]) {
      const dx = Math.cos(yaw) * s * 3, dz = -Math.sin(yaw) * s * 3;
      block(x + dx, z + dz, 0.65, 0.65, 3.5); box(x + dx, 0.18, z + dz, 1, 0.36, 1, 0, 'ivory');
      box(x + dx, 3.5, z + dz, 0.95, 0.24, 0.95, 0, 'gold');
    }
    geom('ivory', archG, x, 3.5, z, 0, yaw, 0, 3, 2.1, 1.4);
    // 上部拱带不侵入 3.3m 以下的通道。
    for (let i = 0; i < 11; i++) { const a = (i + 0.5) * Math.PI / 11, u = Math.cos(a) * 3;
      solid(x + Math.cos(yaw) * u, 3.5 + Math.sin(a) * 2.1, z - Math.sin(yaw) * u, 0.85, 0.55, 0.5, yaw, { mat: 'concrete' }); }
  };
  pair(arch, -11, -25, Math.PI / 2); pair(arch, -11, 25, Math.PI / 2);
  // 贯通的双庭馆。基座/门槛齐地，四面门洞 4.8m。
  const pavilion = (x, z) => {
    k.building(x, z, 14, 12, 5.8, 'stone', { th: 0.5, roofKey: 'roof', roofY: 0.3, doors: [0, 1, 2, 3].map(side => ({ side, w: 4.8, h: 4.5 })) });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(x + sx * 6.8, 3, z + sz * 5.8, 0.55, 6, 0.55, 0, 'ivory');
      box(x + sx * 6.8, 0.25, z + sz * 5.8, 0.8, 0.5, 0.8, 0, 'gold');
    }
    for (const s of [-1, 1]) {
      box(x, 5.7, z + s * 6.2, 14.8, 0.26, 0.35, 0, 'gold');
      for (const dx of [-5, 5]) {
        box(x + dx, 3.3, z + s * 6.27, 1.25, 2, 0.05, 0, 'teal');
        box(x + dx, 3.3, z + s * 6.32, 0.08, 2, 0.05, 0, 'gold');
        box(x + dx, 3.3, z + s * 6.32, 1.25, 0.08, 0.05, 0, 'gold');
      }
    }
    // 四坡屋面，收口平台承托祭坛。
    box(x, 5.95, z, 15.4, 0.2, 13.4, 0, 'ivory');
    const hip = new THREE.CylinderGeometry(0.4, 1, 1, 4);
    geom('roof', hip, x, 6.95, z, 0, Math.PI / 4, 0, 15 / Math.SQRT2, 1.9, 13 / Math.SQRT2); hip.dispose();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.rod('gold', x + sx * 7.5, 6, z + sz * 6.5, x + sx * 3, 7.9, z + sz * 2.6, 0.06);
    box(x, 7.95, z, 6.1, 0.1, 5.4, 0, 'ivory');
  }; pair(pavilion, -20, -14);
  // 中庭：六柱开放凉亭，祭坛位于屋顶，地面可从两侧绕行。
  for (const x of [-4.3, 4.3]) for (const z of [-4.3, 0, 4.3]) {
    block(x, z, 0.65, 0.65, 5.4); box(x, 0.23, z, 0.95, 0.46, 0.95, 0, 'ivory');
    box(x, 5.2, z, 1.1, 0.28, 1.1, 0, 'gold');
  }
  block(0, 0, 9.8, 9.8, 0.5, 'stone', 5.4); box(0, 5.93, 0, 10.3, 0.12, 10.3, 0, 'ivory');
  pair(block, -3.2, -2, 3.6, 2.2, 2.3); // 中路错位掩体
  const planter = (x, z, w, d) => {
    block(x, z, w, d, 1.25); box(x, 1.3, z, w + 0.25, 0.15, d + 0.25, 0, 'ivory');
    block(x, z, w - 0.3, d - 0.3, 1, 'leaf', 1.4);
    for (let i = 0; i < Math.floor(w * d * 2); i++) {
      const px = x + (rnd() - 0.5) * (w - 0.4), pz = z + (rnd() - 0.5) * (d - 0.4);
      geom(i % 3 ? 'flower' : 'petal', prims.sph, px, 2.45 + rnd() * 0.2, pz, 0, 0, 0, 0.13, 0.1, 0.13);
    }
  };
  pair(planter, -22, 13, 9, 3); pair(planter, -4, -16, 3, 6); pair(planter, -39, 23, 5, 2);
  pair(block, -25, 22, 6, 1, 2.5); pair(block, -14, 5, 4.5, 2, 2.8);
  pair(block, -29, -24, 1.4, 6, 2.8);
  // 路边六角庭灯，低成本合批，避开出生点和主要通路。
  for (const x of [-41, -8, 8, 41]) for (const z of [-29, 29]) {
    block(x, z, 0.32, 0.32, 3.7, 'gold');
    geom('warm', prims.cyl8, x, 3.8, z, 0, 0, 0, 0.28, 0.5, 0.28);
    geom('roof', prims.cone, x, 4.25, z, 0, 0, 0, 0.5, 0.4, 0.5);
    k.lampSpots.push(new THREE.Vector3(x, 3.8, z));
  }
  // 低矮草叶与花点仅用于草坪边缘，保持玩家轮廓与道路清晰。
  world.build();
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.11, 0, 0, 0.1, 0, 0, 0.05, 0.43, 0.04,
    0, 0, -0.1, 0, 0, 0.1, -0.04, 0.34, 0.02,
    -0.11, 0, 0, 0.05, 0.43, 0.04, 0.1, 0, 0,
    0, 0, -0.1, -0.04, 0.34, 0.02, 0, 0, 0.1,
  ], 3)); blade.computeVertexNormals();
  for (let i = 0; i < 700; i++) {
    const x = (rnd() - 0.5) * 90, z = (rnd() - 0.5) * 58;
    if (Math.abs(z) < 4.7 || Math.abs(Math.abs(z) - 25) < 4 || [-41, -9, 9, 41].some(p => Math.abs(x - p) < 3)) continue;
    if (world.blocked(x, 0.05, z, 0.3, 1)) continue;
    geom(i % 3 ? 'leaf' : 'leafLight', blade, x, 0.02, z, 0, rnd() * 6.28, 0, 1, 0.65 + rnd() * 0.5, 1);
    if (i % 5 === 0) geom(i % 2 ? 'flower' : 'petal', prims.sph, x, 0.29, z, 0, 0, 0, 0.11, 0.07, 0.11);
  }
  blade.dispose();
  // 场外丘陵、尖塔和树丛形成幻想大陆的天际线。
  const hill = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * Math.PI * 2, r = 110 + rnd() * 45;
    geom(i % 2 ? 'hill' : 'distant', hill, Math.cos(a) * r, -12, Math.sin(a) * r, 0, a, 0, 30 + rnd() * 24, 24 + rnd() * 25, 30 + rnd() * 18);
  }
  for (const x of [-62, 62]) for (const z of [-40, 40]) {
    geom('stone', prims.cyl8, x, 8, z, 0, 0, 0, 3.4, 16, 3.4);
    geom('roof', prims.cone, x, 19, z, 0, 0, 0, 4.3, 8, 4.3);
    geom('gold', prims.sph, x, 23.3, z, 0, 0, 0, 0.3, 0.7, 0.3);
    for (let y = 4; y < 14; y += 4) for (const s of [-1, 1]) box(x, y, z + s * 3.3, 0.9, 1.7, 0.13, 0, 'teal');
  }
  hill.dispose();
  for (let i = 0; i < 38; i++) {
    const a = i / 38 * Math.PI * 2, x = Math.cos(a) * (57 + rnd() * 7), z = Math.sin(a) * (40 + rnd() * 6);
    for (let j = 0; j < 3; j++) geom(j % 2 ? 'leafLight' : 'leaf', prims.sph, x + j * 1.3, 0.4 + rnd(), z + j * 0.7, 0, a, 0, 1.8 + rnd(), 1.4 + rnd() * 1.8, 2);
  }
  archG.dispose();
  const meshes = k.flush(scene, opts), spawns = { BL: [], GR: [] };
  for (let i = 0; i < 10; i++) { const x = -44 + Math.floor(i / 5) * 2.4, z = -6 + i % 5 * 3;
    spawns.BL.push({ x, z, yaw: -Math.PI / 2 }); spawns.GR.push({ x: -x, z: -z, yaw: Math.PI / 2 }); }
  const assets = opts.headless ? null : decorations(scene);
  return { meshes, spawns, materials: k.matDefs, lampSpots: k.lampSpots, funnelTop: null,
    assetReady: assets?.ready || Promise.resolve(false), extraDispose: () => assets?.dispose(), update: (dt, t) => k.update(dt, t) };
}

export const windgardenMap = {
  id: 'windgarden', name: '风栖庭院', desc: '幻想 · 风车古树、青瓦双庭与风之祭坛，三路交锋', menuLabel: 'WINDHAVEN GARDENS',
  build, textures: windgardenTextures, sea: false, sizeClass: 'normal', navCell: 0.5,
  bounds: [-48, -32, 48, 32], shadow: [-58, 58, -1, 30, -50, 50], radar: { w: 96, d: 64, bg: '#738e5e' },
  env: {
    day: { elev: 42, azim: 125, turbidity: 2, rayleigh: 1.1, mie: 0.002, sunColor: 0xffedc7, sunInt: 2.8, hemiSky: 0xc4e5f4, hemiGround: 0x546941, hemiInt: 0.45, exposure: 0.62, envInt: 0.28, fog: 0xc9e4dc, fogDensity: 0.0018, skyZen: 0x57a8db, skyHor: 0xd3eee6, cloudLit: 0xfffbeb, cloudShade: 0xa8ccdc, cloudCover: 0.18 },
    dusk: { elev: 9, azim: 145, turbidity: 4, rayleigh: 1.7, mie: 0.003, sunColor: 0xffd29f, sunInt: 2.4, hemiSky: 0xb6bddf, hemiGround: 0x6b876e, hemiInt: 0.65, exposure: 0.76, envInt: 0.3, fog: 0xc3cbdc, fogDensity: 0.002, skyZen: 0x7b86b7, skyHor: 0xf5d9c2, cloudLit: 0xffe0be, cloudShade: 0xa9acd0, cloudCover: 0.3 },
  },
  pve: { spawns: [{ x: 43, z: 0 }, { x: 39, z: -19 }, { x: 39, z: 19 }, { x: 17, z: 0 }, { x: 0, z: 25 }],
    supplies: [{ x: -43, z: -13, kind: 'med' }, { x: 43, z: 13, kind: 'med' }, { x: -18, z: -25, kind: 'ammo' }, { x: 18, z: 25, kind: 'ammo' }, { x: -8, z: 8, kind: 'armor' }, { x: 8, z: -8, kind: 'armor' }] },
};
