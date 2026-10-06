// BOSS / 怪物体型倍率：服务端命中盒与客户端外观的唯一真相，放这里避免两端各写一套而飘移
// h = 以脚点为锚的整体等比倍率（服务端命中盒用它），w/d = 客户端额外做的横向/纵深压扁
export const SIZE = {
  infected: { h: 1.06, w: 0.94, d: 0.9 },
  shooter: { h: 1.02, w: 0.82, d: 0.82 },
  heavy: { h: 1.3, w: 1.26, d: 1.18 },
  tyran: { h: 1.95, w: 1.44, d: 1.32 },
  mother: { h: 2.2, w: 1.52, d: 1.46 },
  shade: { h: 1.78, w: 0.82, d: 0.8 },
};

export const sizeOf = (kind) => SIZE[kind] || null;
