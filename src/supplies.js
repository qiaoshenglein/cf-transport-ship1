// PVE 补给站（纯数据，服务端与客户端共用同一份坐标，杜绝双方漂移）
// 每张图一组：坐标均经该图 NavGrid 验证——从基地出生点可达，且不埋进掩体。
export const SUPPLY_R = 1.45;                    // 拾取半径（米）
export const SUPPLY_CD = { ammo: 24, med: 32, armor: 36 };  // 单人单次冷却（秒）
export const SUPPLY_HEAL = 60;                   // 医疗包回复量（溢出转护甲）
export const SUPPLY_NAME = { ammo: '弹药箱', med: '医疗包', armor: '护甲板' };

export const SUPPLY_POINTS = {
  ship: [
    { x: -26, z: -4, kind: 'med' },        // 己方基地内侧（离出生点 5m，不会一出生就踩空）
    { x: -6, z: -6.5, kind: 'ammo' },      // 左舷箱堆
    { x: -4, z: 7, kind: 'armor' },        // 右舷箱堆
    { x: -2, z: -0.5, kind: 'ammo' },      // 中路开阔地
    { x: 16, z: 1, kind: 'armor' },        // 前场
    { x: 30, z: -0.5, kind: 'med' },       // 怪口前哨（高危）
  ],
  // 其余地图的补给点与怪口一起写在各自地图文件里（保持同一份坐标真相）
};
export const suppliesFor = (mapId) => SUPPLY_POINTS[mapId] || SUPPLY_POINTS.ship;
