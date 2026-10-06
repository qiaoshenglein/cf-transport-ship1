// 服务端无头加载地图：复用客户端 build* 生成完全一致的碰撞体，跳过所有贴图 / 烘焙
import { World } from '../src/physics.js';
import { mapOf } from '../src/maps.js';
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
  // 新地图自带的贴图（sandStone / plaster / …）服务端一律取空贴图桩
  return new Proxy(T, { get: (t, k) => (k in t ? t[k] : texSet) });
}

const cache = new Map();

export function loadMap(mapId = 'ship') {
  const def = mapOf(mapId);
  if (cache.has(def.id)) return cache.get(def.id);
  const world = new World();
  const scene = { add() {} };
  const m = def.build(scene, stubTextures(), world, { headless: true });
  const rec = { world, spawns: m.spawns, id: def.id, def, map: m };
  cache.set(def.id, rec);
  return rec;
}
