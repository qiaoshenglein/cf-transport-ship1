// 极地中继站：三条地面路线 + 四间贯通机房，所有战斗结构中心对称。
// 雷达只放在不可进入的屋顶；GLB 的加载与外形不参与权威碰撞/寻路。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeKit } from './mapkit.js';
import { mulberry32, normalFromHeight } from './textures.js';

export function polarTextures(T, quality = 'high') {
  if (T.polarSnow) return;
  const S = quality === 'low' ? 128 : 256;
  const rnd = mulberry32(7407);
  const surface = (panel) => {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, seam = panel && (x % (S / 4) < 2 || y < 2);
      const n = rnd(), v = panel ? (seam ? 112 : 189 + n * 15) : 205 + n * 26;
      img.data.set([v, v + (panel ? 6 : 10), Math.min(255, v + 18), 255], i * 4);
      h[i] = seam ? 0.1 : 0.5 + n * (panel ? 0.04 : 0.14);
    }
    ctx.putImageData(img, 0, 0);
    const map = new THREE.CanvasTexture(c), normalMap = new THREE.CanvasTexture(normalFromHeight(h, S, S, 1.2));
    map.colorSpace = THREE.SRGBColorSpace;
    for (const t of [map, normalMap]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return { map, normalMap };
  };
  T.polarSnow = surface(false); T.polarPanel = surface(true);
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#123345'; ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#ffac4b'; ctx.fillRect(20, 20, 9, 216);
  ctx.fillStyle = '#e3f2f4'; ctx.font = 'bold 56px sans-serif';
  ctx.fillText('POLAR', 52, 90); ctx.fillText('RELAY / 07', 52, 156);
  ctx.fillStyle = '#85b7c7'; ctx.font = '23px sans-serif'; ctx.fillText('COMMUNICATIONS STATION', 52, 210);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  T.polarSign = { map };
}

export const polarPve = {
  spawns: [{ x: 37, z: 0 }, { x: 34, z: -18 }, { x: 34, z: 18 }, { x: 27, z: -6 }, { x: 27, z: 6 }],
  supplies: [
    { x: -38, z: -11, kind: 'med' }, { x: 38, z: 11, kind: 'med' },
    { x: -16, z: -18, kind: 'ammo' }, { x: 16, z: 18, kind: 'ammo' },
    { x: -3, z: 9, kind: 'armor' }, { x: 3, z: -9, kind: 'armor' },
  ],
};

// 独占资产：离图时释放材质/贴图；若下载晚于换图完成，也不能挂回旧场景。
function radarAsset(scene) {
  let gone = false, object = null;
  const release = (root) => {
    const geos = new Set(), mats = new Set(), texs = new Set();
    root.traverse((o) => {
      if (o.geometry) geos.add(o.geometry);
      for (const m of o.material ? [].concat(o.material) : []) {
        mats.add(m);
        for (const t of Object.values(m)) if (t && t.isTexture) texs.add(t);
      }
    });
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    for (const t of texs) t.dispose();
  };
  const ready = new GLTFLoader().loadAsync('/assets/models/polar-relay-radar.glb').then((gltf) => {
    const src = gltf.scene;
    if (gone) { release(src); return false; }
    const bounds = new THREE.Box3().setFromObject(src), size = bounds.getSize(new THREE.Vector3());
    const scale = 7.5 / Math.max(size.x, size.y, size.z, 0.01), center = bounds.getCenter(new THREE.Vector3());
    src.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    src.scale.setScalar(scale);
    src.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    object = new THREE.Group(); object.name = 'polar-radar-landmarks';
    for (const s of [-1, 1]) {
      const mount = new THREE.Group(); mount.position.set(s * 15, 5.78, s * 9);
      mount.rotation.y = s < 0 ? 0 : Math.PI;
      mount.add(s < 0 ? src : src.clone(true)); object.add(mount);
    }
    scene.add(object);
    return true;
  }).catch((err) => {
    if (!gone) console.warn('极地雷达资产未载入，保留通信基座', err.message);
    return false;
  });
  return { ready, dispose() { gone = true; if (object) { scene.remove(object); release(object); object = null; } } };
}

export function buildPolar(scene, T, world, opts = {}) {
  const kit = makeKit(T, world, 7407);
  const { box, solid, geom, prims } = kit;
  kit.def('snow', kit.std({ ...T.polarSnow, roughness: 0.98, color: 0xe3eef3 }), 3.5);
  kit.def('panel', kit.std({ ...T.polarPanel, roughness: 0.72, metalness: 0.18 }), 2.5);
  kit.def('sign', kit.std({ map: T.polarSign.map, roughness: 0.8 }), 'unit');
  kit.plain('navy', 0x233f50, { rough: 0.68, metal: 0.25 });
  kit.plain('ice', 0x9cbdce, { rough: 0.9 });
  kit.plain('paving', 0x617480, { rough: 0.94 });
  kit.plain('safety', 0xe48136, { rough: 0.75 });
  kit.plain('window', 0x274c62, { rough: 0.18, metal: 0.45 });
  kit.emissive('strip', 0x9bdeeb, 1.1);
  kit.def('mountain', kit.std({ color: 0x8ba4b4, roughness: 1 }), 1, { noAO: true });

  // 一个矩形同时产出视觉和碰撞，避免装饰挡路但没有判定。
  const block = (x, z, w, d, h, key = 'panel', y = 0) => {
    box(x, y + h / 2, z, w, h, d, 0, key);
    solid(x, y + h / 2, z, w, h, d, 0, { mat: 'metal', surface: 'metal' });
    if (!y) kit.foot(x, z, w, d, 0);
  };
  const pair = (fn, x, z, ...args) => { fn(x, z, ...args); fn(-x, -z, ...args); };
  solid(0, -0.5, 0, 86, 1, 50, 0, { mat: 'concrete', surface: 'concrete', tag: 'deck' });
  box(0, -0.02, 0, 84, 0.04, 48, 0, 'snow');
  // 运输清扫道与两条轮辙；只改表面，不制造台阶。
  for (const z of [-18, 0, 18]) {
    box(0, 0.006, z, 80, 0.012, 5.8, 0, 'paving');
    for (const dz of [-2.5, 2.5]) for (let x = -38; x <= 38; x += 4)
      box(x, 0.015, z + dz, 1.8, 0.01, 0.12, 0, 'safety');
  }
  for (const x of [-27, 0, 27]) box(x, 0.007, 0, 5.8, 0.014, 44, 0, 'paving');
  // 边界在雷达和导航范围内；冰川远景永远不产出碰撞体。
  for (const z of [-23.8, 23.8]) block(0, z, 84, 0.4, 5, 'ice');
  for (const x of [-41.8, 41.8]) block(x, 0, 0.4, 48, 5, 'ice');
  for (const z of [-23.8, 23.8]) box(0, 5.07, z, 84, 0.14, 0.65, 0, 'snow');

  // 四座贯通实验舱：入口净宽 4.2m、净高 4m，巨体 BOSS 也能通行。
  for (const x of [-15, 15]) for (const z of [-9, 9]) {
    kit.building(x, z, 14, 10, 4.8, 'panel', {
      th: 0.45, roofKey: 'navy', roofY: 0.3,
      doors: [{ side: 0, w: 4.2, h: 4 }, { side: 1, w: 4.2, h: 4 }],
    });
    box(x, 5.16, z, 14.3, 0.12, 10.3, 0, 'snow');
    box(x, 0.02, z, 13.5, 0.04, 9.5, 0, 'navy');
    for (const dz of [-5.24, 5.24]) {
      box(x, 0.45, z + dz, 14, 0.8, 0.05, 0, 'navy');
      box(x, 4.35, z + dz, 14, 0.22, 0.05, 0, 'safety');
      // 深色玻璃是实心墙上的装饰，不暗示可以穿越/射击的窗口。
      for (const dx of [-4.5, 0, 4.5]) box(x + dx, 2.8, z + dz, 2.3, 1.1, 0.06, 0, 'window');
      for (const dx of [-6.7, -2.3, 2.3, 6.7]) box(x + dx, 2.4, z + dz, 0.12, 4.5, 0.08, 0, 'navy');
      // 屋檐暖灯、排水线和入口标识在远距离仍然清晰。
      kit.rod('navy', x - 6.8, 4.6, z + dz, x + 6.8, 4.6, z + dz, 0.055);
      box(x, 4.6, z + dz, 2.8, 0.08, 0.1, 0, 'strip');
    }
    for (const dx of [-7.25, 7.25]) {
      box(x + dx, 4.15, z, 0.07, 0.18, 4.4, 0, 'strip');
      for (const dz of [-2.25, 2.25]) box(x + dx, 2, z + dz, 0.07, 4, 0.22, 0, 'safety');
    }
    // 沿墙服务器柜让室内有掩体，但不占用贯通轴线。
    for (const dx of [-3.5, 3.5]) for (const dz of [-3.9, 3.9]) {
      block(x + dx, z + dz, 2, 1.2, 2.4, 'navy');
      for (let k = 0; k < 4; k++) box(x + dx, 0.5 + k * 0.45, z + dz + (dz > 0 ? -0.62 : 0.62), 1.5, 0.045, 0.025, 0, 'strip');
    }
    if (x * z > 0) {
      // 即使模型缺失，橙色屋顶设备仍是完整的通信地标。
      box(x, 5.5, z, 4, 0.56, 3, 0, 'safety');
    } else {
      for (const dx of [-3, 3]) box(x + dx, 5.45, z, 2.4, 0.5, 2.6, 0, 'navy');
    }
  }
  // 两端出生院：三条出口，挡墙防止出生点与中线直接互狙。
  for (const s of [-1, 1]) {
    for (const z of [-9, 9]) block(s * 31, z, 0.6, 10, 4.2, 'navy');
    block(s * 33, 0, 2, 4, 2.8, 'safety');
    box(s * 33, 2.9, 0, 2.1, 0.2, 4.1, 0, 'snow');
    for (const z of [-19, 19]) {
      block(s * 37, z, 5, 3, 2.7, 'panel');
      box(s * 37, 2.8, z, 5.2, 0.2, 3.2, 0, 'snow');
    }
    box(s * 31, 3, s * 8.5, 0.65, 1.4, 2.8, 0, 'sign');
  }
  // 中路错位设备、外侧冷却站：短掩体负责换位，高掩体切开长枪线。
  pair(block, -5, -2.8, 4, 2.2, 2.5, 'safety');
  pair(block, -4, -20, 3.2, 7.2, 3.2, 'navy');
  pair(block, -24.8, 15.5, 3, 2, 1.1, 'panel');
  pair(block, -25.6, -16.5, 2, 3, 2.6, 'safety');
  pair(block, -2.5, 14, 2.4, 2, 1.1, 'panel');
  pair(block, -10, -19.8, 2.4, 2, 1.1, 'panel');
  for (const s of [-1, 1]) {
    for (const [x, z] of [[25.5, 10], [2.8, 6]]) {
      block(s * x, s * z, 0.3, 0.3, 5.5, 'navy');
      kit.lamp(s * x, 5.45, s * z, x > 20);
    }
  }
  // 积雪山脊与远端通信桅杆：可辨方向，不会影响碰撞或寻路。
  box(0, -0.18, 0, 420, 0.2, 420, 0, 'snow');
  // 不规则棱线 + 按三角面划分的雪线，避免远景像等比例圆锥。
  const ridge = new THREE.ConeGeometry(1, 1, 9, 4);
  const rp = ridge.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i);
    const k = 1 + Math.sin(x * 7 + z * 9) * 0.22 + Math.cos(z * 11 + y * 5) * 0.16;
    rp.setXYZ(i, x * k, y + Math.sin(x * 9) * Math.cos(z * 8) * 0.09 * (0.5 - y), z * k);
  }
  ridge.computeVertexNormals();
  const rockIndices = [], snowIndices = [];
  for (let i = 0; i < ridge.index.count; i += 3) {
    const ids = [ridge.index.getX(i), ridge.index.getX(i + 1), ridge.index.getX(i + 2)];
    const snow = ids.reduce((sum, v) => sum + rp.getY(v), 0) / 3 > 0.12;
    (snow ? snowIndices : rockIndices).push(...ids);
  }
  const rock = ridge.clone().setIndex(rockIndices), cap = ridge.clone().setIndex(snowIndices);
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * Math.PI * 2, radius = 80 + kit.rnd() * 28;
    const x = Math.cos(a) * radius * 1.15, z = Math.sin(a) * radius;
    const h = 18 + kit.rnd() * 35, r = 14 + kit.rnd() * 17;
    geom('mountain', rock, x, h / 2 - 2, z, 0, a, 0, r, h, r * 0.8);
    geom('snow', cap, x, h / 2 - 2, z, 0, a, 0, r, h, r * 0.8);
  }
  ridge.dispose(); rock.dispose(); cap.dispose();
  for (const s of [-1, 1]) {
    const x = s * 50, z = s * 31;
    for (const dx of [-1.6, 1.6]) kit.rod('navy', x + dx, 0, z, x + dx * 0.15, 19, z, 0.12);
    for (let y = 2; y < 19; y += 3) kit.rod('navy', x - 1.5, y, z, x + 1.5, y + 2, z, 0.08);
    geom('redLamp', prims.sph, x, 19.5, z, 0, 0, 0, 0.2, 0.2, 0.2);
  }
  const meshes = kit.flush(scene, opts);
  const spawns = { BL: [], GR: [] };
  for (let i = 0; i < 10; i++) {
    const x = -39 + Math.floor(i / 5) * 2.4, z = -6 + (i % 5) * 3;
    spawns.BL.push({ x, z, yaw: -Math.PI / 2 });
    spawns.GR.push({ x: -x, z: -z, yaw: Math.PI / 2 });
  }
  const asset = opts.headless ? null : radarAsset(scene);
  return { spawns, meshes, materials: kit.matDefs, lampSpots: kit.lampSpots, funnelTop: null,
    assetReady: asset ? asset.ready : Promise.resolve(false), extraDispose: () => asset?.dispose(),
    update: (dt, t) => kit.update(dt, t) };
}
