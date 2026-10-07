// 联机协议（客户端与服务端共用）
export const PROTO_VERSION = 2;
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

// ================= 二进制世界快照编解码（服务端编码、客户端解码共用同一份，杜绝实现漂移） =================
// 世界快照 ps 每项: [id, x, y, z, yaw, pitch, flags, weaponId, vx, vz]；nd 每项: [id, x, y, z]
// 布局(小端): [0]u8 magic 0xC5 [1]u8 ver [2]u32 tick [6]f32 st [10]u16 tl*10 [12]u8 gs(0play/1end)
//             [13]u16 scBL [15]u16 scGR [17]u8 pc [18]u8 nc [20..] 玩家记录(18B) [.. ] 手雷记录(8B)
const W_MAGIC = 0xC5, W_VER = 2, W_HEAD = 20, P_STRIDE = 18, N_STRIDE = 8;
const W_POS = 256, W_ANG = 10000, W_VEL = 24, W_TL = 10;   // 量化比例：位置~3.9mm，角度~0.006°，速度~4cm/s
export const WTABLE = ['ak47', 'm4a1', 'awm', 'mp5', 'deagle', 'knife', 'he', 'm249', 'm3', 'thompson', 'bossclaw'];
const clamp16 = (v) => v < -32768 ? -32768 : v > 32767 ? 32767 : v | 0;
const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const dvOf = (d) => (d instanceof ArrayBuffer ? new DataView(d) : ArrayBuffer.isView(d) ? new DataView(d.buffer, d.byteOffset, d.byteLength) : null);

export function encodeWorld(w) {
  const ps = w.ps || [], nd = w.nd || [];
  const buf = new ArrayBuffer(W_HEAD + ps.length * P_STRIDE + nd.length * N_STRIDE);
  const dv = new DataView(buf);
  const sc = w.sc || { BL: 0, GR: 0 };
  dv.setUint8(0, W_MAGIC); dv.setUint8(1, W_VER);
  dv.setUint32(2, w.tick >>> 0, true);
  dv.setFloat32(6, w.st, true);
  dv.setUint16(10, Math.max(0, Math.min(65535, Math.round((w.tl || 0) * W_TL))), true);
  dv.setUint8(12, w.gs === 'end' ? 1 : 0);
  dv.setUint16(13, Math.min(65535, sc.BL | 0), true);
  dv.setUint16(15, Math.min(65535, sc.GR | 0), true);
  dv.setUint8(17, ps.length); dv.setUint8(18, nd.length);
  let o = W_HEAD;
  for (const p of ps) {
    dv.setUint16(o, p[0] & 0xffff, true);
    dv.setInt16(o + 2, clamp16(p[1] * W_POS), true);
    dv.setInt16(o + 4, clamp16(p[2] * W_POS), true);
    dv.setInt16(o + 6, clamp16(p[3] * W_POS), true);
    dv.setInt16(o + 8, clamp16(wrapPi(p[4]) * W_ANG), true);
    dv.setInt16(o + 10, clamp16(p[5] * W_ANG), true);
    dv.setUint8(o + 12, p[6] & 0xff);
    const wi = WTABLE.indexOf(p[7]); dv.setUint8(o + 13, wi < 0 ? 5 : wi);
    dv.setInt16(o + 14, clamp16(p[8] * W_VEL), true);
    dv.setInt16(o + 16, clamp16(p[9] * W_VEL), true);
    o += P_STRIDE;
  }
  for (const n of nd) {
    dv.setUint16(o, n[0] & 0xffff, true);
    dv.setInt16(o + 2, clamp16(n[1] * W_POS), true);
    dv.setInt16(o + 4, clamp16(n[2] * W_POS), true);
    dv.setInt16(o + 6, clamp16(n[3] * W_POS), true);
    o += N_STRIDE;
  }
  return buf;
}

export function decodeWorld(data) {
  const dv = dvOf(data);
  if (!dv || dv.byteLength < W_HEAD) return null;
  if (dv.getUint8(0) !== W_MAGIC || dv.getUint8(1) !== W_VER) return null;
  const tick = dv.getUint32(2, true);
  const st = dv.getFloat32(6, true);
  const tl = dv.getUint16(10, true) / W_TL;
  const gs = dv.getUint8(12) ? 'end' : 'play';
  const sc = { BL: dv.getUint16(13, true), GR: dv.getUint16(15, true) };
  const pc = dv.getUint8(17), nc = dv.getUint8(18);
  if (dv.byteLength < W_HEAD + pc * P_STRIDE + nc * N_STRIDE) return null;
  const ps = [];
  let o = W_HEAD;
  for (let i = 0; i < pc; i++, o += P_STRIDE) {
    ps.push([
      dv.getUint16(o, true),
      dv.getInt16(o + 2, true) / W_POS, dv.getInt16(o + 4, true) / W_POS, dv.getInt16(o + 6, true) / W_POS,
      dv.getInt16(o + 8, true) / W_ANG, dv.getInt16(o + 10, true) / W_ANG,
      dv.getUint8(o + 12), WTABLE[dv.getUint8(o + 13)] || 'knife',
      dv.getInt16(o + 14, true) / W_VEL, dv.getInt16(o + 16, true) / W_VEL,
    ]);
  }
  const nd = [];
  for (let i = 0; i < nc; i++, o += N_STRIDE) {
    nd.push([dv.getUint16(o, true), dv.getInt16(o + 2, true) / W_POS, dv.getInt16(o + 4, true) / W_POS, dv.getInt16(o + 6, true) / W_POS]);
  }
  return { tick, st, tl, gs, sc, ps, nd };
}
