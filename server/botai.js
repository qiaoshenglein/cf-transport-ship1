// 服务端机器人 AI（纯 JS，无 THREE / DOM）：每 tick 产出一条与真人同构的输入命令，
// 经 netsim.applyCmd 走与人类玩家完全相同的移动 / 命中 / 伤害 / 复活管线。
// 决策逻辑移植自 src/bots.js（单机 Actor 版），改为面向 room 玩家对象 + 世界射线 + 寻路网格。
import { wishDir } from '../src/movement.js';
import { B } from '../src/protocol.js';
import { PRIMARIES } from '../src/weapons.js';

const wrapPi = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// 供 PVE 怪物 AI 复用的底层小工具
export const _aim = { wrapPi, clamp };

// 与各阵营难度（数值同单机）
export const DIFF = {
  easy: { react: [0.55, 0.9], aimErr: 0.075, turn: 3.2, track: 2.2, headP: 0.07, ctrl: 1.0, comp: 0.55, strafe: 0.35, see: 50, fov: 1.6, bunny: 0 },
  normal: { react: [0.38, 0.62], aimErr: 0.058, turn: 5.2, track: 3.2, headP: 0.12, ctrl: 0.85, comp: 0.8, strafe: 0.65, see: 62, fov: 1.85, bunny: 0.05 },
  hard: { react: [0.2, 0.34], aimErr: 0.032, turn: 8.5, track: 5.5, headP: 0.3, ctrl: 0.6, comp: 0.9, strafe: 0.85, see: 75, fov: 2.05, bunny: 0.12 },
  hell: { react: [0.12, 0.2], aimErr: 0.02, turn: 13, track: 8.5, headP: 0.5, ctrl: 0.42, comp: 0.95, strafe: 1, see: 95, fov: 2.3, bunny: 0.2 },
};

export const BOT_NAMES = [
  '丶夜猫子', 'CF灬战神', '狙神小白', '枪王之王', '火麒麟丶', '无敌小旋风', '天使の翼', '爆头专业户', '穿越者丨龙', '雷神M4',
  '灬冷血杀手', '沙鹰一哥', '老六本六', '我是菜鸟', '运输船之王', 'Sniper丶K', '二楼架枪', '管道守门员', '一枪一个', '闪电侠丶',
  '黑名单丶影', '保卫者老王', '夜袭者', '零度丶', '狂暴战神', '别打我头', '满血复活', '疾风步',
];

// 潜伏者(BL)阵营架点/侧翼点；保卫者(GR)取反。世界坐标 = 阵营局部 * side
const HOLDS = [[-20.5, -7.2, 0.2], [-24.6, 5.8, -0.15], [-16.4, 1.3, 0.1], [-9.8, -6.8, 0.25], [-26.2, -6.5, 0.05]];
const LANES = [-6.8, -0.4, 6.8];
const FLANK = [[-31.5, 10.5], [-8, 10.6], [8.0, 7.8]];

export function randomBotName(used) {
  const pool = BOT_NAMES.filter((n) => !used.has(n));
  const base = (pool.length ? pool : BOT_NAMES)[(Math.random() * (pool.length || BOT_NAMES.length)) | 0];
  return pool.length ? base : base + (1 + ((Math.random() * 99) | 0));
}
export function randomBotPrimary() {
  // 狙击枪占比低，避免大量 AWM 影响观感
  const nonSniper = PRIMARIES.filter((id) => id !== 'awm');
  return Math.random() < 0.1 ? 'awm' : nonSniper[(Math.random() * nonSniper.length) | 0];
}

export class BotBrain {
  constructor(self) {
    this.diffKey = 'normal';
    this.D = DIFF.normal;
    this.side = self.team === 'BL' ? 1 : -1;
    this.reset();
  }
  setDiff(key) { this.diffKey = DIFF[key] ? key : 'normal'; this.D = DIFF[this.diffKey]; }
  // 出生/重生时重置决策状态
  reset(self) {
    const r = Math.random();
    this.role = self && self.primary === 'awm' ? 'hold' : r < 0.25 ? 'flank' : 'rush';
    this.lane = LANES[(Math.random() * 3) | 0];
    this.stage = 0;
    this.path = null; this.pi = 0; this.goal = null; this.holdYaw = undefined;
    this.target = null; this.visible = false; this.lastSeen = null; this.lastSeenT = -99; this.huntFor = -99;
    this.reactUntil = 0; this.errY = 0; this.errP = 0; this.aimHead = false;
    this.strafeDir = 1; this.strafeT = 0; this.burst = 0; this.burstPauseUntil = 0;
    this.thinkT = 0; this.stuckT = 0; this.stuckN = 0; this.lastX = 0; this.lastZ = 0;
    this.curYaw = self ? self.yaw : 0; this.curPitch = 0;
    this.wantJump = false; this.crouchUntil = -99; this.holdT = 0; this.lookSet = false;
  }
  L(x, z) { return [x * this.side, z * this.side]; }

  pickGoal(room, self) {
    const nav = room.nav, rnd = Math.random;
    let gx, gz;
    if (this.role === 'hold') {
      const h = HOLDS[(rnd() * HOLDS.length) | 0];
      [gx, gz] = this.L(h[0], h[1]);
      this.holdYaw = this.side > 0 ? -Math.PI / 2 + h[2] : Math.PI / 2 + h[2];
    } else if (this.role === 'flank' && this.stage < 3) {
      [gx, gz] = this.L(...FLANK[clamp(this.stage, 0, 2)]);
    } else if (this.stage < 1) {
      [gx, gz] = this.L(4 + rnd() * 18, this.lane + (rnd() - 0.5) * 2);
    } else {
      const p = nav.randomFree(rnd, -26, -8.8, 26, 8.8);
      [gx, gz] = p || this.L(10, 0);
    }
    this.goal = [gx, gz];
    this.path = nav.findPath(self.pos.x, self.pos.z, gx, gz);
    this.pi = 1;
  }

  canSee(room, self, t, D) {
    const ex = self.pos.x, ey = self.pos.y + self.eyeH, ez = self.pos.z;
    const dx = t.pos.x - ex, dy = (t.pos.y + 1.32) - ey, dz = t.pos.z - ez;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > D.see) return false;
    const hd = Math.hypot(t.pos.x - self.pos.x, t.pos.z - self.pos.z);
    const ang = Math.abs(wrapPi(Math.atan2(-(t.pos.x - self.pos.x), -(t.pos.z - self.pos.z)) - self.yaw));
    if (ang > D.fov / 2 && hd > 6) return false;
    const dxc = t.pos.x - ex, dzc = t.pos.z - ez; // 瞄准躯干
    const len = Math.hypot(dxc, dy, dzc) || 1;
    const hit = room.world.raycast(ex, ey, ez, dxc / len, dy / len, dzc / len, len - 0.1, 'sight');
    return !hit;
  }

  think(room, self, list, now) {
    const D = this.D;
    let best = null, bestD = 1e9;
    for (const a of list) {
      if (!a.alive || a.team === self.team || a === self) continue;
      const d = Math.hypot(a.pos.x - self.pos.x, a.pos.z - self.pos.z);
      if (d > bestD || d > D.see) continue;
      if (this.canSee(room, self, a, D)) { best = a; bestD = d; }
    }
    if (best) {
      if (!this.visible || this.target !== best) {
        const [r0, r1] = D.react;
        const surprise = this.target === best && now - this.lastSeenT < 1.5 ? 0.4 : 1;
        this.reactUntil = now + (r0 + Math.random() * (r1 - r0)) * surprise;
        const k = D.aimErr * (0.8 + bestD / 28);
        const a = Math.random() * Math.PI * 2;
        this.errY = Math.cos(a) * k * 1.3; this.errP = Math.sin(a) * k * 0.8 - k * 0.1;
        this.aimHead = Math.random() < D.headP;
        this.burst = 0;
      }
      this.target = best; this.visible = true;
      this.lastSeen = [best.pos.x, best.pos.y, best.pos.z]; this.lastSeenT = now;
      this.path = null;
    } else {
      this.visible = false;
      if (this.target && (!this.target.alive || now - this.lastSeenT > 5)) this.target = null;
      // 无目标时的移动规划
      const nav = room.nav;
      if (this.lastSeen && now - this.lastSeenT < 5 && this.role !== 'hold') {
        if (!this.path || this.huntFor !== this.lastSeenT) {
          this.path = nav.findPath(self.pos.x, self.pos.z, this.lastSeen[0], this.lastSeen[2]); this.pi = 1; this.huntFor = this.lastSeenT;
        }
      } else if (!this.path || this.pi >= this.path.length) {
        if (this.role === 'hold' && this.goal && Math.hypot(self.pos.x - this.goal[0], self.pos.z - this.goal[1]) < 1.2) {
          this.holdT += 0.15;
          if (this.holdT > 25 + Math.random() * 20) { this.holdT = 0; this.pickGoal(room, self); }
        } else { this.stage++; this.pickGoal(room, self); }
      }
      if (Math.random() < 0.12 * D.strafe) this.crouchUntil = now + 0.6 + Math.random() * 1.2;
    }
    // 卡住脱困
    this.stuckT += 0.15;
    if (this.stuckT > 1.0) {
      const moved = Math.hypot(self.pos.x - this.lastX, self.pos.z - this.lastZ);
      if (this.path && this.pi < this.path.length && moved < 0.35 && !this.visible) {
        this.stuckN++; this.wantJump = true;
        if (this.stuckN > 2) { this.stuckN = 0; this.stage++; this.pickGoal(room, self); }
      } else this.stuckN = 0;
      this.lastX = self.pos.x; this.lastZ = self.pos.z; this.stuckT = 0;
    }
  }

  // 返回命令对象 {y, p, f, r, bits, w}；w 为换枪槽或 -1
  step(room, self, list, dt) {
    const D = this.D, now = room.time;
    if (!self.alive) return { y: self.yaw, p: 0, f: 0, r: 0, bits: 0, w: -1 };
    if (self.life !== this._life) { this._life = self.life; this.reset(self); }
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.13 + Math.random() * 0.06; this.think(room, self, list, now); }

    const w = self.inv[self.slot], d = w ? w.def : null;
    let bits = 0, sw = -1;
    let wishX = 0, wishZ = 0;
    let crouch = now < this.crouchUntil, walk = false;
    let fire = false, firePressed = false, altPressed = false;
    let dYaw = this.curYaw, dPitch = this.curPitch;

    const tgt = this.target;
    if (tgt && tgt.alive && this.visible && d && d.type !== 'grenade' && d.type !== 'melee') {
      // 瞄准：躯干/头 + 提前量 + 误差 + 平滑转向
      const ex = self.pos.x, ey = self.pos.y + self.eyeH, ez = self.pos.z;
      const aimY = this.aimHead ? tgt.pos.y + 1.62 : tgt.pos.y + 1.32;
      const dx = (tgt.pos.x + tgt.vel.x * 0.08) - ex, dy = aimY - ey, dz = (tgt.pos.z + tgt.vel.z * 0.08) - ez;
      const hd = Math.hypot(dx, dz);
      const trueYaw = Math.atan2(-dx, -dz), truePitch = Math.atan2(dy, hd);
      const k = Math.exp(-D.track * dt);
      this.errY *= k; this.errP *= k;
      const wob = 0.004 * (1 + (tgt.speed || 0) / 4);
      dYaw = trueYaw + this.errY + Math.sin(now * 3.1 + self.id) * wob;
      dPitch = truePitch + this.errP + Math.cos(now * 2.7 + self.id) * wob * 0.6 - self.punchP * D.comp;
      // 开火判定
      const aimErr = Math.hypot(wrapPi(self.yaw - trueYaw), self.pitch - truePitch);
      const tol = Math.atan2(0.32, hd) * 1.4 + 0.01;
      const wantFire = now >= this.reactUntil && aimErr < tol && now >= self.readyAt && self.protectT <= 0;
      if (wantFire && d) {
        if (d.type === 'sniper') { if (self.scoped && self.scopeReady && aimErr < tol * 0.6) firePressed = true; }
        else if (d.type === 'pistol') { firePressed = Math.random() < dt * 5; }
        else if (now >= this.burstPauseUntil) {
          fire = true;
          if (hd > 14) { this.burst++; if (this.burst > 3 + Math.random() * 4) { this.burst = 0; this.burstPauseUntil = now + 0.18 + Math.random() * 0.3 * (hd / 30); } }
        }
      }
      // 狙击开镜
      if (d && d.type === 'sniper' && hd > 7 && !self.scoped && now >= w.boltUntil) altPressed = true;
      //  strafing（贴/中距游走，狙击站桩）
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = 0.25 + Math.random() * 0.7; this.strafeDir = Math.random() < 0.5 ? -1 : 1; if (Math.random() < 0.2) this.strafeDir = 0; }
      const moveK = d && d.type === 'sniper' ? 0 : D.strafe;
      const fy = this.curYaw;
      const rx = Math.cos(fy), rz = -Math.sin(fy);
      wishX = rx * this.strafeDir * moveK; wishZ = rz * this.strafeDir * moveK;
      if (hd > 22 && (!d || d.type !== 'sniper') && this.role !== 'hold') { wishX += -Math.sin(fy) * 0.5; wishZ += -Math.cos(fy) * 0.5; }
    } else {
      // 未接敌：沿路径前进
      if (self.scoped && now - this.lastSeenT > 2) altPressed = true; // 收镜
      if (this.path && this.pi < this.path.length) {
        const wp = this.path[this.pi];
        const dx = wp[0] - self.pos.x, dz = wp[1] - self.pos.z, dd = Math.hypot(dx, dz);
        if (dd < 0.55) this.pi++;
        else { wishX = dx / dd; wishZ = dz / dd; }
        if (!this.lookSet || now % 2 > 1.7) dYaw = Math.atan2(-dx, -dz);
        dPitch = 0;
        walk = this.role === 'flank' && this.stage === 1;
      } else if (this.role === 'hold' && this.holdYaw !== undefined) {
        dYaw = this.holdYaw + Math.sin(now * 0.4 + self.id) * 0.35; dPitch = -0.02;
        crouch = crouch || Math.sin(now * 0.3 + self.id) > 0.3;
      }
      // 弹药不足则换弹（room 玩家 isPlayer=true，需显式下命令）
      if (w && d && d.mag > 1 && w.mag < d.mag * 0.5 && w.canReload() && now - this.lastSeenT > 1.2) bits |= B.reload;
      if (w && d && w.mag === 0 && w.reserve === 0 && self.slot === 0) sw = 1; // 主武器打空 -> 掏手枪
    }
    // 队友分离
    for (const a of list) {
      if (a === self || !a.alive) continue;
      const dx = self.pos.x - a.pos.x, dz = self.pos.z - a.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 1.2 && d2 > 1e-4) { const dd = Math.sqrt(d2); wishX += (dx / dd) * 0.6; wishZ += (dz / dd) * 0.6; }
    }
    // 转向限速
    const turn = D.turn * dt * (this.visible ? 1 : 0.7);
    this.curYaw = wrapPi(this.curYaw + clamp(wrapPi(dYaw - this.curYaw), -turn, turn));
    this.curPitch += clamp(dPitch - this.curPitch, -turn * 0.6, turn * 0.6);
    this.curPitch = clamp(this.curPitch, -1.4, 1.4);
    this.lookSet = this.visible;

    // 世界期望方向 -> 以 curYaw 为基准分解为 f/r
    const [fx0, fz0] = wishDir(this.curYaw, 1, 0); // 前方
    const [rx2, rz2] = wishDir(this.curYaw, 0, 1); // 右方
    let f = wishX * fx0 + wishZ * fz0;
    let r = wishX * rx2 + wishZ * rz2;
    const flen = Math.hypot(f, r);
    if (flen > 1) { f /= flen; r /= flen; }

    if (this.wantJump) bits |= B.jump;
    if (crouch) bits |= B.crouch;
    if (walk) bits |= B.walk;
    if (fire) bits |= B.fire;
    if (firePressed) bits |= (B.fire | B.fireP);
    if (altPressed) bits |= (B.alt | B.altP);
    this.wantJump = false;

    if (Math.random() < D.bunny * dt && self.onGround && d && d.type !== 'sniper' && !this.visible) bits |= B.jump;

    return { y: this.curYaw, p: this.curPitch, f, r, bits, w: sw };
  }
}
