// PVE 补给站（纯数据，服务端与客户端共用同一份坐标，杜绝双方漂移）
// 坐标均经 NavGrid 验证：从两个基地出生点都可达；30,-0.5 紧贴怪口，属于高风险高收益位。
export const SUPPLY_R = 1.45;                    // 拾取半径（米）
export const SUPPLY_CD = { ammo: 24, med: 32, armor: 36 };  // 单人单次冷却（秒）
export const SUPPLY_HEAL = 60;                   // 医疗包回复量（溢出转护甲）
export const SUPPLY_NAME = { ammo: '弹药箱', med: '医疗包', armor: '护甲板' };

export const SUPPLY_POINTS = [
  { x: -26, z: -4, kind: 'med' },        // 己方基地内侧（离出生点 5m，不会一出生就踩空）
  { x: -6, z: -6.5, kind: 'ammo' },      // 左舷箱堆
  { x: -4, z: 7, kind: 'armor' },        // 右舷箱堆
  { x: -2, z: -0.5, kind: 'ammo' },      // 中路开阔地
  { x: 16, z: 1, kind: 'armor' },        // 前场
  { x: 30, z: -0.5, kind: 'med' },       // 怪口前哨（高危）
];
