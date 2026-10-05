// 联机协议（客户端与服务端共用）
export const PROTO_VERSION = 1;
export const TICK_RATE = 30;          // 服务端模拟 / 快照频率
export const INTERP_DELAY = 0.1;      // 客户端远端角色插值延迟（秒）
export const MAX_REWIND = 0.35;       // 延迟补偿最大回溯（秒）
export const RECONNECT_GRACE = 30;    // 断线保留席位（秒）
export const RESPAWN_TIME = 4;
export const PROTECT_TIME = 3;
export const MATCH_TIME = 600;

// 按键位
export const B = { jump: 1, crouch: 2, walk: 4, fire: 8, fireP: 16, alt: 32, altP: 64, reload: 128 };

export const TEAMS = ['BL', 'GR'];
export const otherTeam = (t) => (t === 'BL' ? 'GR' : 'BL');

// 每发子弹的确定性随机数：客户端预测与服务端判定得到完全相同的散布与后坐
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const shotRng = (seed, n) => mulberry32((seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0);

// 输入命令：{s 序号, d dt(秒), y yaw, p pitch, f 前后, r 左右, b 按键位, w 切枪(-1 无), vt 客户端看到的服务端时间}
export function sanitizeCmd(c) {
  if (!c || typeof c !== 'object') return null;
  const num = (v, lo, hi, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def);
  const s = c.s | 0;
  if (s <= 0) return null;
  let f = num(c.f, -1, 1), r = num(c.r, -1, 1);
  const L = Math.hypot(f, r); if (L > 1) { f /= L; r /= L; }
  return {
    s, d: num(c.d, 0, 0.05), y: num(c.y, -1e4, 1e4), p: num(c.p, -1.5, 1.5), f, r,
    b: (c.b | 0) & 255, w: Number.isInteger(c.w) && c.w >= 0 && c.w <= 3 ? c.w : -1, vt: num(c.vt, 0, 1e9, 0),
  };
}

export const round2 = (v) => Math.round(v * 100) / 100;
export const round3 = (v) => Math.round(v * 1000) / 1000;
