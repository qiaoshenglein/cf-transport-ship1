// 地图注册表：一张图 = 建造函数 + 可行走范围 + 光照/大气 + 小地图 + PVE 要点
// 服务端（headless）与客户端读同一份，坐标与 NavGrid 才不会漂
import { buildMap as buildShip } from './map.js';
import { buildPolar, polarTextures, polarPve } from './map_polar.js';
import { suppliesFor } from './supplies.js';
import { bazaarMap } from './map_bazaar.js';
import { depotMap } from './map_depot.js';
import { turbineMap } from './map_turbine.js';
import { harborMap } from './map_harbor.js';

export const MAPS = {
  ship: {
    id: 'ship', name: '运输船', desc: '集装箱与二楼管道的近距离拉锯',
    build: buildShip, sea: true,
    bounds: [-36.2, -12.1, 36.2, 12.1],
    collisionBounds: [-46, -30, 46, 30], // 船体边缘碰撞超出甲板导航区域。
    shadow: [-58, 40, -1, 26, -15, 15],
    // 船体是一条 24m 宽的直甲板，天然通透；视线预算放宽，只对新地图要求挡墙
    sightBudget: 0.27,
    radar: {
      w: 74, d: 26,
      overlay: [{ x: -11.2, z: 10.62, w: 36.6, d: 2.44 }, { x: 11.2, z: -10.62, w: 36.6, d: 2.44 }],
    },
    pve: {
      spawns: [{ x: 31.5, z: -6.2 }, { x: 33.5, z: 0.5 }, { x: 31.0, z: 6.0 }, { x: 36.0, z: -2.5 }, { x: 35.5, z: 3.5 }],
    },
  },
  polar: {
    id: 'polar', name: '极地中继站', desc: '雪原通信基地，三路推进与贯通机房争夺',
    build: buildPolar, textures: polarTextures, sea: false,
    bounds: [-42, -24, 42, 24], shadow: [-48, 48, -1, 32, -30, 30],
    env: {
      day: { elev: 28, azim: 130, turbidity: 2.5, rayleigh: 1.2, mie: 0.003, sunColor: 0xf4f4ef, sunInt: 3.2, hemiSky: 0xd8ecff, hemiGround: 0x9aabb9, hemiInt: 0.5, exposure: 0.58, fog: 0xc2d4e1, fogDensity: 0.0035, skyZen: 0x568cb5, skyHor: 0xd9e8ef, cloudLit: 0xf5f8fc, cloudShade: 0x9fb2c5, cloudCover: 0.4 },
      dusk: { elev: 5, azim: 148, turbidity: 4, rayleigh: 2.2, mie: 0.004, sunColor: 0xffbd91, sunInt: 2.4, hemiSky: 0x8ba7d0, hemiGround: 0x586c85, hemiInt: 0.48, exposure: 0.68, fog: 0x8eacc6, fogDensity: 0.0045, skyZen: 0x283f70, skyHor: 0xd4b6b2, cloudLit: 0xffd2bc, cloudShade: 0x687b9d, cloudCover: 0.35 },
    },
    radar: { w: 84, d: 48, bg: 'rgba(75,98,116,0.95)' }, pve: polarPve,
  },
};
Object.assign(MAPS, { bazaar: bazaarMap, depot: depotMap, turbine: turbineMap, harbor: harborMap });
export const MAP_IDS = Object.keys(MAPS);
export const mapOf = (id) => MAPS[id] || MAPS.ship;
export const mapName = (id) => mapOf(id).name;
// PVE：怪口与补给站以地图文件为唯一真相，supplies.js 只作运输船的默认值
export const pveSpawnsFor = (id) => mapOf(id).pve.spawns;
export const suppliesForMap = (id) => mapOf(id).pve.supplies || suppliesFor(id);
