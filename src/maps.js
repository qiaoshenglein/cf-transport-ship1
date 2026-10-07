// 地图注册表：一张图 = 建造函数 + 可行走范围 + 光照/大气 + 小地图 + PVE 要点
// 服务端（headless）与客户端读同一份，坐标与 NavGrid 才不会漂
import { buildMap as buildShip } from './map.js';
import { buildDesert, desertTextures, desertPve } from './map_desert.js';
import { buildTown, townTextures, townPve } from './map_town.js';
import { buildInferno, infernoTextures, infernoPve } from './map_inferno.js';
import { buildAztec, aztecTextures, aztecPve } from './map_aztec.js';
import { buildNuke, nukeTextures, nukePve } from './map_nuke.js';
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
  inferno: {
    id: 'inferno', name: '炼狱小镇', desc: '香蕉道转角与中街水井，抢点先抢巷口',
    build: buildInferno, textures: infernoTextures, sea: false,
    // 大一档的图幅：三横四纵镇街网格，给香蕉道 + 中街 + 两个前庭留出经典节奏
    bounds: [-46, -26, 46, 26],
    shadow: [-54, 54, -1, 28, -32, 32],
    // 地中海暖色两套大气：白天是晒白的赭石镇，黄昏把整片瓦顶点亮
    env: {
      day: { elev: 45, azim: 124, turbidity: 6, rayleigh: 1.0, mie: 0.005, sunColor: 0xffe0b4, sunInt: 3.8, hemiSky: 0xe6cfae, hemiGround: 0x84654a, hemiInt: 0.22, exposure: 0.56, fog: 0xd9c19c, fogDensity: 0.0042, skyZen: 0x74a0d0, skyHor: 0xf0dcb4, cloudLit: 0xf8ead2, cloudShade: 0xb09a80, cloudCover: 0.2 },
      dusk: { elev: 5, azim: 148, turbidity: 9, rayleigh: 1.7, mie: 0.0085, sunColor: 0xff9a58, sunInt: 2.9, hemiSky: 0xd08f66, hemiGround: 0x4a3526, hemiInt: 0.22, exposure: 0.66, fog: 0xb0765a, fogDensity: 0.0062, skyZen: 0x2f3a66, skyHor: 0xf08a4a, cloudLit: 0xffb478, cloudShade: 0x5c4054, cloudCover: 0.36 },
    },
    radar: { w: 92, d: 52, bg: 'rgba(92,76,58,0.95)' },
    pve: infernoPve,
  },
  aztec: {
    id: 'aztec', name: '遗迹双桥', desc: '可涉水的运河与两座高桥，石门内贴身抢甲',
    build: buildAztec, textures: aztecTextures, sea: false,
    bounds: [-46, -26, 46, 26],
    shadow: [-54, 54, -1, 28, -32, 32],
    // 湿热两套大气：白天是雾气里的石灰白，黄昏把神庙金顶与河面反光点亮
    env: {
      day: { elev: 52, azim: 104, turbidity: 7.5, rayleigh: 1.3, mie: 0.009, sunColor: 0xfff0d0, sunInt: 3.4, hemiSky: 0xcfd8bd, hemiGround: 0x6a6048, hemiInt: 0.3, exposure: 0.54, fog: 0xa9b898, fogDensity: 0.0062, skyZen: 0x76a6d4, skyHor: 0xd9dfc4, cloudLit: 0xf4f2e4, cloudShade: 0x9aa490, cloudCover: 0.46 },
      dusk: { elev: 6, azim: 136, turbidity: 9.8, rayleigh: 1.8, mie: 0.011, sunColor: 0xff9d55, sunInt: 2.7, hemiSky: 0xc79468, hemiGround: 0x413526, hemiInt: 0.26, exposure: 0.66, fog: 0x9c7350, fogDensity: 0.0075, skyZen: 0x2d3a5e, skyHor: 0xf19a52, cloudLit: 0xffb678, cloudShade: 0x574054, cloudCover: 0.44 },
    },
    // 运河是一条 50m 长水槽，靠残柱与石门切开；两岸街巷窄，预算给到 0.2
    sightBudget: 0.2,
    radar: { w: 92, d: 52, bg: 'rgba(78,88,70,0.95)' },
    pve: aztecPve,
  },
  nuke: {
    id: 'nuke', name: '核港', desc: '龙门平台与栈桥成环，上下两层同时开火',
    build: buildNuke, textures: nukeTextures, sea: false,
    bounds: [-46, -26, 46, 26],
    shadow: [-54, 54, -1, 30, -32, 32],
    // 工业区的两套大气：白天是水泥与钢格的冷白，黄昏靠厂区探照灯把管廊切成剪影
    env: {
      day: { elev: 48, azim: 112, turbidity: 6.5, rayleigh: 1.1, mie: 0.006, sunColor: 0xf4eee2, sunInt: 3.3, hemiSky: 0xc4ccd6, hemiGround: 0x5c5a55, hemiInt: 0.34, exposure: 0.56, fog: 0xb4bcc2, fogDensity: 0.0044, skyZen: 0x6f9ac6, skyHor: 0xd2d8dc, cloudLit: 0xf0f2f4, cloudShade: 0x9aa2ac, cloudCover: 0.5 },
      dusk: { elev: 6, azim: 142, turbidity: 9, rayleigh: 1.6, mie: 0.009, sunColor: 0xffa860, sunInt: 2.5, hemiSky: 0x8f96a8, hemiGround: 0x33343a, hemiInt: 0.3, exposure: 0.68, fog: 0x6a6f7c, fogDensity: 0.0062, skyZen: 0x25324e, skyHor: 0xd98a5a, cloudLit: 0xe8a878, cloudShade: 0x424a5c, cloudCover: 0.52 },
    },
    // 中央浇筑区开阔，但反应堆坑矮圈、界墙与平台立柱把视线一段折开
    sightBudget: 0.2,
    // 声明"每张高架下面都留了地面通路"：probe 会逐个头顶平台检查地面可走格数，
    // 因为 NavGrid 只看 0.4~1.8m，AI 根本用不了楼梯——上层若断了下层的通路，bot 与怪物就永远上不去也绕不过来
    twoLevel: true,
    radar: { w: 92, d: 52, bg: 'rgba(86,92,98,0.95)' },
    pve: nukePve,
  },
};
export const MAP_IDS = Object.keys(MAPS);
export const mapOf = (id) => MAPS[id] || MAPS.ship;
export const mapName = (id) => mapOf(id).name;
// PVE：怪口与补给站以地图文件为唯一真相，supplies.js 只作运输船的默认值
export const pveSpawnsFor = (id) => mapOf(id).pve.spawns;
export const suppliesForMap = (id) => mapOf(id).pve.supplies || suppliesFor(id);
