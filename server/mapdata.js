// 服务端无头加载运输船地图：复用客户端 buildMap 生成完全一致的碰撞体，跳过所有贴图 / 烘焙
import { World } from '../src/physics.js';
import { buildMap } from '../src/map.js';
import { CONTAINER_COLORS } from '../src/textures.js';

let cached = null;

function stubTextures() {
  const texSet = { map: null, normalMap: null, roughnessMap: null, emissiveMap: null };
  const T = {
    containers: CONTAINER_COLORS.map((color) => ({ color, side20: null, side40: null, n20: null, n40: null, door: null, doorN: null, roof: null, roofN: null })),
    // 与 textures.js 保持一致：0-3 木箱（可穿透），4-5 铁箱
    crates: [0, 1, 2, 3].map(() => ({ ...texSet, kind: 'wood' })).concat([0, 1].map(() => ({ ...texSet, kind: 'metal' }))),
    fence: null, grating: null, signs: null,
  };
  return new Proxy(T, { get: (t, k) => (k in t ? t[k] : texSet) });
}

export function loadMap() {
  if (cached) return cached;
  const world = new World();
  const scene = { add() {} };
  const m = buildMap(scene, stubTextures(), world, { headless: true });
  cached = { world, spawns: m.spawns };
  return cached;
}
