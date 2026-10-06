// 地图注册表：一张图 = 建造函数 + 可行走范围 + 光照/大气 + 小地图 + PVE 要点
// 服务端（headless）与客户端读同一份，坐标与 NavGrid 才不会漂
import { buildMap as buildShip } from './map.js';
import { buildDesert, desertTextures, desertPve } from './map_desert.js';
import { buildTown, townTextures, townPve } from './map_town.js';
import { suppliesFor } from './supplies.js';

export const MAPS = {
  ship: {
    id: 'ship', name: '运输船', desc: '集装箱与二楼管道的近距离拉锯',
    build: buildShip, sea: true,
    bounds: [-36.2, -12.1, 36.2, 12.1],
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
  desert: {
    id: 'desert', name: '沙漠灰', desc: '黄沙院落与中路长巷，中远距离对枪',
    build: buildDesert, textures: desertTextures, sea: false,
    bounds: [-38, -20, 38, 20],
    shadow: [-44, 44, -1, 22, -26, 26],
    // 正午沙尘 / 落日两套大气：主菜单的"白天/黄昏"在每张图都仍然有意义
    env: {
      day: { elev: 42, azim: 118, turbidity: 7, rayleigh: 1.1, mie: 0.0055, sunColor: 0xffe3b0, sunInt: 4.0, hemiSky: 0xe8d2a8, hemiGround: 0x7a6242, hemiInt: 0.2, exposure: 0.55, fog: 0xd8bd8e, fogDensity: 0.0046, skyZen: 0x7fa3cc, skyHor: 0xe6cf9f, cloudLit: 0xf6e6c8, cloudShade: 0xb09a76, cloudCover: 0.24 },
      dusk: { elev: 7, azim: 140, turbidity: 9.5, rayleigh: 1.6, mie: 0.008, sunColor: 0xffb06a, sunInt: 3.0, hemiSky: 0xd8a878, hemiGround: 0x54402c, hemiInt: 0.2, exposure: 0.62, fog: 0xc79a72, fogDensity: 0.0058, skyZen: 0x3f5578, skyHor: 0xf0a870, cloudLit: 0xffc890, cloudShade: 0x6a5460, cloudCover: 0.32 },
    },
    radar: { w: 78, d: 42, bg: 'rgba(96,86,68,0.95)' },
    pve: desertPve,
  },
  town: {
    id: 'town', name: '黑色城镇', desc: '窄街转角与二层阳台，贴脸遭遇战',
    build: buildTown, textures: townTextures, sea: false,
    bounds: [-38, -20, 38, 20],
    shadow: [-44, 44, -1, 24, -26, 26],
    // 阴面石城：整体压暗一档，靠天光与墙面反光把轮廓拉开；"黑色"来自低照度而不是糊黑
    env: {
      day: { elev: 34, azim: 132, turbidity: 5.5, rayleigh: 1.6, mie: 0.0032, sunColor: 0xf2ead8, sunInt: 2.6, hemiSky: 0xa8b6cc, hemiGround: 0x44434a, hemiInt: 0.4, exposure: 0.6, fog: 0x77808f, fogDensity: 0.0048, skyZen: 0x4a648c, skyHor: 0xa8b0bc, cloudLit: 0xe4e6ea, cloudShade: 0x626876, cloudCover: 0.58 },
      dusk: { elev: 9, azim: 156, turbidity: 7, rayleigh: 1.9, mie: 0.005, sunColor: 0xd9b48a, sunInt: 1.9, hemiSky: 0x7f8ba6, hemiGround: 0x30313a, hemiInt: 0.42, exposure: 0.7, fog: 0x50586c, fogDensity: 0.0066, skyZen: 0x243350, skyHor: 0x8a7f8e, cloudLit: 0xc0a89a, cloudShade: 0x3d4250, cloudCover: 0.66 },
    },
    radar: { w: 78, d: 42, bg: 'rgba(74,74,82,0.95)' },
    pve: townPve,
  },
};
export const MAP_IDS = Object.keys(MAPS);
export const mapOf = (id) => MAPS[id] || MAPS.ship;
export const mapName = (id) => mapOf(id).name;
// PVE：怪口与补给站以地图文件为唯一真相，supplies.js 只作运输船的默认值
export const pveSpawnsFor = (id) => mapOf(id).pve.spawns;
export const suppliesForMap = (id) => mapOf(id).pve.supplies || suppliesFor(id);
