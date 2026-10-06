// 无 DOM 的简化角色命中盒：按 character.js 的骨骼层级与程序化姿态（俯仰 / 下蹲 / 空中收腿）做前向运动学
// 服务端权威判定与延迟补偿都使用它；尺寸与 character.js 的 HITBOXES 一致
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 3x4 矩阵：[r00,r01,r02,tx, r10,r11,r12,ty, r20,r21,r22,tz]
function mul(A, B) {
  const o = new Array(12);
  for (let i = 0; i < 3; i++) {
    const a0 = A[i * 4], a1 = A[i * 4 + 1], a2 = A[i * 4 + 2];
    o[i * 4] = a0 * B[0] + a1 * B[4] + a2 * B[8];
    o[i * 4 + 1] = a0 * B[1] + a1 * B[5] + a2 * B[9];
    o[i * 4 + 2] = a0 * B[2] + a1 * B[6] + a2 * B[10];
    o[i * 4 + 3] = a0 * B[3] + a1 * B[7] + a2 * B[11] + A[i * 4 + 3];
  }
  return o;
}
// three.js Euler 'XYZ'：R = Rx * Ry * Rz，再平移
function local(x, y, z, rx = 0, ry = 0, rz = 0) {
  const a = Math.cos(rx), b = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry), e = Math.cos(rz), f = Math.sin(rz);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  return [
    c * e, -c * f, d, x,
    af + be * d, ae - bf * d, -b * c, y,
    bf - ae * d, be + af * d, a * c, z,
  ];
}

// [骨骼, cx, cy, cz, hx, hy, hz, 部位]
const BOXES = [
  ['head', 0, 0.1, 0, 0.1, 0.12, 0.11, 'head'],
  ['chest', 0, 0.1, 0, 0.21, 0.18, 0.145, 'chest'],
  ['spine', 0, 0.09, 0, 0.17, 0.12, 0.12, 'stomach'],
  ['hips', 0, -0.02, 0, 0.18, 0.11, 0.13, 'stomach'],
  ['upperArmR', 0, -0.14, 0, 0.065, 0.16, 0.065, 'arm'], ['upperArmL', 0, -0.14, 0, 0.065, 0.16, 0.065, 'arm'],
  ['forearmR', 0, -0.13, 0, 0.055, 0.15, 0.055, 'arm'], ['forearmL', 0, -0.13, 0, 0.055, 0.15, 0.055, 'arm'],
  ['thighR', 0, -0.21, 0, 0.09, 0.24, 0.09, 'leg'], ['thighL', 0, -0.21, 0, 0.09, 0.24, 0.09, 'leg'],
  ['shinR', 0, -0.22, 0, 0.07, 0.24, 0.075, 'leg'], ['shinL', 0, -0.22, 0, 0.07, 0.24, 0.075, 'leg'],
];

// pose: {x,y,z,yaw,pitch,ck(0..1 下蹲系数),air}
export function boneMatrices(pose) {
  const ck = pose.ck || 0, P = clamp(pose.pitch || 0, -1.2, 1.2);
  const M = {};
  const root = local(pose.x, pose.y, pose.z, 0, pose.yaw, 0);
  M.hips = mul(root, local(0, 0.98 - ck * 0.38 + (pose.air ? 0.02 : 0), ck * 0.08));
  M.spine = mul(M.hips, local(0, 0.12, 0, P * 0.3 + ck * 0.15, -0.25, 0));
  M.chest = mul(M.spine, local(0, 0.2, 0, P * 0.45, -0.12, 0));
  M.neck = mul(M.chest, local(0, 0.2, 0, P * 0.2, 0.3, 0));
  M.head = mul(M.neck, local(0, 0.08, 0, 0, 0.05, 0));
  // 手臂：近似持枪姿态（上臂前下、前臂水平向前）
  M.upperArmR = mul(mul(M.chest, local(0.17, 0.13, 0)), local(0.04, 0, 0, 0.9, 0, 0.15));
  M.forearmR = mul(M.upperArmR, local(0, -0.29, 0, 0.9, 0, 0));
  M.upperArmL = mul(mul(M.chest, local(-0.17, 0.13, 0)), local(-0.04, 0, 0, 1.0, 0, -0.35));
  M.forearmL = mul(M.upperArmL, local(0, -0.29, 0, 0.8, 0, 0));
  let thR = 1.25 * ck, thL = 0.55 * ck, shR = -1.9 * ck, shL = -1.2 * ck;
  if (pose.air) { thR = 0.7; thL = 0.25; shR = -1.1; shL = -0.6; }
  M.thighR = mul(M.hips, local(0.1, -0.05, 0, thR, 0, 0.02));
  M.shinR = mul(M.thighR, local(0, -0.44, 0, shR, 0, 0));
  M.thighL = mul(M.hips, local(-0.1, -0.05, 0, thL, 0, -0.02));
  M.shinL = mul(M.thighL, local(0, -0.44, 0, shL, 0, 0));
  return M;
}

export function pointOn(M, bone, lx, ly, lz) {
  const m = M[bone];
  return [m[0] * lx + m[1] * ly + m[2] * lz + m[3], m[4] * lx + m[5] * ly + m[6] * lz + m[7], m[8] * lx + m[9] * ly + m[10] * lz + m[11]];
}
export const headPoint = (M) => pointOn(M, 'head', 0, 0.1, 0);
export const chestPoint = (M) => pointOn(M, 'chest', 0, 0.1, 0);

// 射线 vs 角色全部命中盒。o/d: [x,y,z]，d 已归一化。s: 以脚点为锚的整体放大倍率（巨型 BOSS）。返回 {t, part} | null
export function rayHitboxes(M, pose, o, d, maxT, s = 1) {
  // 放大身体 s 倍 = 把射线朝脚点收缩 1/s 再按人体测，命中参数乘回 s 得到真实距离
  const k = s && s !== 1 ? 1 / s : 0;
  const ox = k ? pose.x + (o[0] - pose.x) * k : o[0];
  const oy = k ? pose.y + (o[1] - pose.y) * k : o[1];
  const oz = k ? pose.z + (o[2] - pose.z) * k : o[2];
  const lim = k ? maxT * k : maxT;
  // 粗检：到身体中心的距离
  const wx = pose.x - ox, wy = pose.y + 1.0 - oy, wz = pose.z - oz;
  const tc = wx * d[0] + wy * d[1] + wz * d[2];
  if (tc < -1.5 || tc > lim + 1.5) return null;
  const px = wx - d[0] * tc, py = wy - d[1] * tc, pz = wz - d[2] * tc;
  if (px * px + py * py + pz * pz > 1.8) return null;
  let best = lim, part = null;
  for (const [bone, cx, cy, cz, hx, hy, hz, name] of BOXES) {
    const m = M[bone];
    // 世界 -> 骨骼局部（旋转部分正交，逆 = 转置）
    const rx = ox - m[3], ry = oy - m[7], rz = oz - m[11];
    const lox = m[0] * rx + m[4] * ry + m[8] * rz - cx, loy = m[1] * rx + m[5] * ry + m[9] * rz - cy, loz = m[2] * rx + m[6] * ry + m[10] * rz - cz;
    const ldx = m[0] * d[0] + m[4] * d[1] + m[8] * d[2], ldy = m[1] * d[0] + m[5] * d[1] + m[9] * d[2], ldz = m[2] * d[0] + m[6] * d[1] + m[10] * d[2];
    let tmin = 0, tmax = best, ok = true;
    for (const [oo, dd, h] of [[lox, ldx, hx], [loy, ldy, hy], [loz, ldz, hz]]) {
      if (Math.abs(dd) < 1e-9) { if (oo < -h || oo > h) { ok = false; break; } continue; }
      let t1 = (-h - oo) / dd, t2 = (h - oo) / dd;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
      if (tmin > tmax) { ok = false; break; }
    }
    if (ok && tmin < best) { best = tmin; part = name; }
  }
  return part ? { t: k ? best / k : best, part } : null;
}
