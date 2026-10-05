// 角色移动物理（纯函数，无 three / DOM 依赖）：单机、客户端预测与权威服务端共用同一份逻辑
export const STAND_H = 1.8, CROUCH_H = 1.15, EYE_STAND = 1.62, EYE_CROUCH = 1.05;
export const GRAV = 19, JUMP_V = 6.6, RUN = 5.7;

// 视角 yaw 下的前后 f / 左右 s 输入 -> 世界坐标期望方向
export function wishDir(yaw, f, s) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  return [-sy * f + cy * s, -cy * f - sy * s];
}

// a: {pos, vel, radius, height, stepHeight, onGround, crouch, eyeH, jumpCD, scoped}
// inp: {wx, wz, jump, crouch, walk, speedMul, scoped?}
// others: 可迭代的其他角色 {pos, radius, alive}
// 返回 {jumped, landed, landSpeed, speed}
export function moveStep(a, dt, inp, world, others) {
  const ev = { jumped: false, landed: false, landSpeed: 0, speed: 0 };
  // 下蹲 / 起身
  if (inp.crouch && !a.crouch) {
    a.crouch = true; a.height = CROUCH_H;
    if (!a.onGround) a.pos.y += STAND_H - CROUCH_H - 0.1; // 空中收腿（蹲跳）
  } else if (!inp.crouch && a.crouch) {
    if (a.onGround) {
      if (!world.blocked(a.pos.x, a.pos.y + 0.05, a.pos.z, a.radius * 0.95, STAND_H - 0.05)) { a.crouch = false; a.height = STAND_H; }
    } else {
      const drop = STAND_H - CROUCH_H - 0.1;
      if (!world.blocked(a.pos.x, a.pos.y - drop, a.pos.z, a.radius * 0.95, STAND_H)) { a.crouch = false; a.height = STAND_H; a.pos.y -= drop; }
    }
  }
  a.eyeH += ((a.crouch ? EYE_CROUCH : EYE_STAND) - a.eyeH) * Math.min(1, dt * 14);
  const scoped = inp.scoped !== undefined ? inp.scoped : a.scoped;
  const max = RUN * (inp.speedMul || 1) * (a.crouch ? 0.42 : inp.walk ? 0.5 : 1) * (scoped ? 0.55 : 1);
  const wl = Math.hypot(inp.wx, inp.wz);
  const wx = wl > 0 ? inp.wx / wl : 0, wz = wl > 0 ? inp.wz / wl : 0;
  const wishSpeed = max * Math.min(1, wl);
  const v = a.vel;
  if (a.onGround) {
    const sp = Math.hypot(v.x, v.z);
    if (sp > 0) {
      const drop = Math.max(sp, 1.5) * 9 * dt;
      const ns = Math.max(0, sp - drop) / sp;
      v.x *= ns; v.z *= ns;
    }
    const cur = v.x * wx + v.z * wz, add = wishSpeed - cur;
    if (add > 0) { const acc = Math.min(11 * dt * wishSpeed, add); v.x += acc * wx; v.z += acc * wz; }
    if (inp.jump && (a.jumpCD || 0) <= 0) {
      v.y = JUMP_V; a.onGround = false; a.jumpCD = 0.35;
      ev.jumped = true;
    }
  } else {
    const ws = Math.min(wishSpeed, 1.2);
    const cur = v.x * wx + v.z * wz, add = ws - cur;
    if (add > 0) { const acc = Math.min(12 * dt * ws, add); v.x += acc * wx; v.z += acc * wz; }
  }
  a.jumpCD = (a.jumpCD || 0) - dt;
  v.y -= GRAV * dt;
  world.move(a, dt);
  // 角色之间的实体碰撞（只推开自己）
  if (others) for (const o of others) {
    if (o === a || !o.alive) continue;
    const dx = a.pos.x - o.pos.x, dz = a.pos.z - o.pos.z, d2 = dx * dx + dz * dz, R = a.radius + o.radius - 0.05;
    if (d2 < R * R && d2 > 1e-6 && Math.abs(a.pos.y - o.pos.y) < 1.6) {
      const d = Math.sqrt(d2), push = (R - d) * 0.5;
      const nx = dx / d, nz = dz / d;
      if (!world.blocked(a.pos.x + nx * push, a.pos.y + 0.05, a.pos.z + nz * push, a.radius * 0.9, a.height - 0.1)) {
        a.pos.x += nx * push; a.pos.z += nz * push;
      }
    }
  }
  ev.landed = !!a.landed; ev.landSpeed = a.landSpeed || 0;
  ev.speed = a.speed = Math.hypot(v.x, v.z);
  // 防卡死：掉出世界
  if (a.pos.y < -3) { a.pos.y = 0.1; v.x = v.y = v.z = 0; }
  return ev;
}
