// 联机共享模拟：一条输入命令 -> 角色移动 + 武器状态机。客户端预测与权威服务端执行完全相同的代码
import { moveStep, wishDir, STAND_H, EYE_STAND } from './movement.js';
import { weaponStep, makeLoadout } from './weaponsim.js';
import { B } from './protocol.js';

export const F = { alive: 1, crouch: 2, ground: 4, reload: 8, scoped: 16, protect: 32, online: 64 };

// 子弹方向：视角 + 后坐偏移 + 散布（与 weapons.jitterDir 相同，返回普通对象）
export function shotDir(a, spread, rnd) {
  const p = a.pitch + a.punchP, y = a.yaw + a.punchY;
  let dx = -Math.sin(y) * Math.cos(p), dy = Math.sin(p), dz = -Math.cos(y) * Math.cos(p);
  if (spread > 0) {
    const ax = Math.abs(dx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let ux = dy * ax[2] - dz * ax[1], uy = dz * ax[0] - dx * ax[2], uz = dx * ax[1] - dy * ax[0];
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
    const ang = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * spread;
    const ca = Math.cos(ang) * r, sa = Math.sin(ang) * r;
    dx += ux * ca + vx * sa; dy += uy * ca + vy * sa; dz += uz * ca + vz * sa;
    const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;
  }
  return { x: dx, y: dy, z: dz };
}

// a 需要: pos, vel, radius, height, stepHeight, onGround, crouch, eyeH, jumpCD, yaw, pitch, punchP, punchY,
//         inv, slot, ..., alive, pt(角色自身的命令时钟), shotSeed, shotN, stats
export function applyCmd(a, c, world, others, H) {
  a.pt += c.d;
  if (!a.alive) return null;
  a.yaw = c.y; a.pitch = c.p;
  const [wx, wz] = wishDir(c.y, c.f, c.r);
  const w = a.inv[a.slot];
  const ev = moveStep(a, c.d, { wx, wz, jump: !!(c.b & B.jump), crouch: !!(c.b & B.crouch), walk: !!(c.b & B.walk), speedMul: w ? w.def.speed : 1 }, world, others);
  a.walk = !!(c.b & B.walk);
  weaponStep(a, c.d, {
    fire: !!(c.b & B.fire), firePressed: !!(c.b & B.fireP), alt: !!(c.b & B.alt), altPressed: !!(c.b & B.altP),
    reload: !!(c.b & B.reload), sw: c.w >= 0 ? c.w : null,
  }, a.pt, H, Math.random);
  return ev;
}

export function resetForSpawn(a, sp, primary, seed, now) {
  a.pos.x = sp.x; a.pos.y = 0.02; a.pos.z = sp.z;
  a.vel.x = a.vel.y = a.vel.z = 0;
  a.yaw = sp.yaw; a.pitch = 0; a.punchP = a.punchY = 0; a.aimPunch = 0;
  a.hp = 100; a.armor = 100; a.alive = true;
  a.crouch = false; a.height = STAND_H; a.eyeH = EYE_STAND; a.onGround = true; a.jumpCD = 0;
  a.primary = primary;
  a.shotSeed = seed; a.shotN = 0;
  a.inv = makeLoadout(primary, seed);
  a.slot = 0; a.lastSlot = 1; a.readyAt = now + 0.3;
  a.scoped = 0; a.scopeReady = false; a.scopeT = 0; a.reScope = 0; a.pendingThrow = 0; a.autoSwitchAt = 0;
}

// 完整的自身状态（用于客户端和解）
const WF = ['mag', 'reserve', 'nextFire', 'reloadUntil', 'shotsFired', 'spreadAcc', 'lastShot', 'boltUntil'];
export function packSelf(a) {
  return {
    ack: a.ack, pt: a.pt, life: a.life, prim: a.primary, ss: a.shotSeed, sn: a.shotN,
    x: a.pos.x, y: a.pos.y, z: a.pos.z, vx: a.vel.x, vy: a.vel.y, vz: a.vel.z,
    og: a.onGround ? 1 : 0, cr: a.crouch ? 1 : 0, h: a.height, eh: a.eyeH, jc: a.jumpCD || 0,
    sl: a.slot, ls: a.lastSlot, ra: a.readyAt, sc: a.scoped, sr: a.scopeReady ? 1 : 0, st: a.scopeT, rs: a.reScope || 0,
    pth: a.pendingThrow || 0, asw: a.autoSwitchAt || 0, pp: a.punchP, py: a.punchY,
    hp: a.hp, ar: a.armor, al: a.alive ? 1 : 0, pr: a.protectT, rt: a.respawnT,
    inv: a.inv.map((w) => WF.map((k) => w[k])),
  };
}
export function unpackSelf(a, s) {
  a.pt = s.pt; a.shotSeed = s.ss; a.shotN = s.sn;
  a.pos.x = s.x; a.pos.y = s.y; a.pos.z = s.z; a.vel.x = s.vx; a.vel.y = s.vy; a.vel.z = s.vz;
  a.onGround = !!s.og; a.crouch = !!s.cr; a.height = s.h; a.eyeH = s.eh; a.jumpCD = s.jc;
  a.slot = s.sl; a.lastSlot = s.ls; a.readyAt = s.ra; a.scoped = s.sc; a.scopeReady = !!s.sr; a.scopeT = s.st; a.reScope = s.rs;
  a.pendingThrow = s.pth; a.autoSwitchAt = s.asw; a.punchP = s.pp; a.punchY = s.py;
  a.hp = s.hp; a.armor = s.ar; a.alive = !!s.al; a.protectT = s.pr; a.respawnT = s.rt;
  s.inv.forEach((v, i) => { const w = a.inv[i]; if (w) WF.forEach((k, j) => { w[k] = v[j]; }); });
}
