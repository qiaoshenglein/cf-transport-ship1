// PVE 怪物：定义 + 波次表 + 怪物大脑（纯 JS，无 THREE / DOM）
// 与联机 bot 同构：每 tick 产出一条命令 {y,p,f,r,bits,w}，经 room → netsim.applyCmd 权威模拟。
// 武器复用现有 WEAPONS 做弹道载体，伤害倍率与血量缩放由 room 侧统一处理（不改共享表）。
import { wishDir } from '../src/movement.js';
import { B } from '../src/protocol.js';
import { _aim } from './botai.js';
const { wrapPi, clamp } = _aim;

// 刷怪口：保卫者基地（甲板 +X 端）
export const PVE_SPAWNS = [{ x: 31.5, z: -6.2 }, { x: 33.5, z: 0.5 }, { x: 31.0, z: 6.0 }, { x: 36.0, z: -2.5 }, { x: 35.5, z: 3.5 }];

// 三类怪。weapon 只作为"弹道载体"：dmgScale 与血量由 room 侧统一处理（不改共享武器表）
// see/fov 决定感知，pref/maxR 决定交战距离，errScale 越大越飘
export const MONSTERS = {
  infected: {
    name: '感染体', hp: 70, speed: 7.4, radius: 0.4, weapon: 'deagle', auto: false, dmgScale: 0.55,
    fov: 2.6, see: 45, turn: 3.6, errScale: 0.05, pref: 2.2, maxR: 3.4,
  },
  shooter: {
    name: '游荡射手', hp: 110, speed: 4.2, radius: 0.38, weapon: 'mp5', auto: true, dmgScale: 0.34,
    fov: 2.0, see: 55, turn: 3.0, errScale: 0.026, pref: 12, maxR: 18,
  },
  heavy: {
    name: '重装暴徒', hp: 260, speed: 4.8, radius: 0.5, weapon: 'm3', auto: false, dmgScale: 0.5,
    fov: 2.2, see: 40, turn: 2.4, errScale: 0.06, pref: 2.6, maxR: 3.6,
  },
};

// 难度 → 血量缩放 / 伤害缩放 / 同屏怪上限 / 每波基数
export const PVE_DIFF = {
  easy: { hpK: 0.8, dmgK: 0.7, cap: 16, waveBase: 8 },
  normal: { hpK: 1.0, dmgK: 1.0, cap: 20, waveBase: 11 },
  hard: { hpK: 1.25, dmgK: 1.2, cap: 26, waveBase: 14 },
  hell: { hpK: 1.6, dmgK: 1.45, cap: 32, waveBase: 18 },
};

// 第 n 波（n≥1）的构成：感染体为主，第 2 波起混入射手，第 4 波起出重装
export function wavePlan(n, base = 11) {
  return {
    infected: Math.min(24, ((base * 0.5) | 0) + n * 2),
    shooter: n >= 2 ? Math.min(8, n - 1) : 0,
    heavy: n >= 4 ? Math.min(4, ((n - 2) / 2) | 0) : 0,
  };
}

const MON_NAMES = ['丧尸A', '丧尸B', '猎食者', '腐化射手', '暴徒', '血爪', '夜行者', '撕裂者', '腐肉', '嚎血'];
const rnd = Math.random;

export class MonsterBrain {
  constructor(m) {
    this.sp = MONSTERS[m.kind];           // BossBrain 覆写为 BOSS 表
    this.curYaw = m.yaw || 0; this.curPitch = 0;
    this.path = null; this.pi = 0; this.repathAt = 0; this.lastSeen = null;
    this.stuckT = 0; this.lastX = m.pos.x; this.lastZ = m.pos.z;
    this.errY = (rnd() - 0.5) * 0.1; this.fireHeld = false;
    this.tgt = null; this.tgtD = 0;
    this.name = MON_NAMES[(rnd() * MON_NAMES.length) | 0] + ((rnd() * 99) | 0);
  }
  los(room, m, t) {
    const ex = m.pos.x, ey = m.pos.y + m.eyeH, ez = m.pos.z;
    const dx = t.pos.x - ex, dz = t.pos.z - ez;
    const dist = Math.hypot(dx, dz);
    const sp = this.sp;
    if (dist > sp.see) return false;
    const d = Math.hypot(dx, (t.pos.y + 1.3) - ey, dz) || 1;
    return !room.world.raycast(ex, ey, ez, dx / d, ((t.pos.y + 1.3) - ey) / d, dz / d, d - 0.1, 'sight');
  }
  repath(room, m, tgt) {
    const p = PVE_SPAWNS[(rnd() * PVE_SPAWNS.length) | 0];
    const gx = tgt ? tgt.pos.x + (rnd() - 0.5) * 6 : p.x;
    const gz = tgt ? tgt.pos.z + (rnd() - 0.5) * 6 : p.z;
    this.path = room.nav.findPath(m.pos.x, m.pos.z, gx, gz);
    this.pi = 1;
    this.repathAt = room.time + 1.2 + rnd() * 0.6;
  }
  // list 中包含人类（p.isHuman / !p.isMonster）与全部怪物；怪只攻击人类
  step(room, m, list, dt) {
    const sp = this.sp;
    if (!m.alive) { this.tgt = null; this.tgtD = 0; return { y: this.curYaw, p: 0, f: 0, r: 0, bits: 0, w: -1 }; }
    // 感知：视野锥内最近的可见人类
    let tgt = null, bestD = 1e9;
    const hfx = -Math.sin(this.curYaw), hfz = -Math.cos(this.curYaw), cosFov = Math.cos(sp.fov * 0.5);
    for (const a of list) {
      if (a.isMonster || !a.alive) continue;
      const d = Math.hypot(a.pos.x - m.pos.x, a.pos.z - m.pos.z);
      if (d >= bestD || d > sp.see) continue;
      const hd = d || 1;
      if ((hfx * (a.pos.x - m.pos.x) + hfz * (a.pos.z - m.pos.z)) / hd < cosFov) continue;
      if (this.los(room, m, a)) { tgt = a; bestD = d; }
    }
    this.tgt = tgt; this.tgtD = tgt ? bestD : 0;   // 供 BossBrain 的技能和测试读取
    let bits = 0, wishX = 0, wishZ = 0;
    let dYaw = this.curYaw, dPitch = 0;
    if (tgt) {
      this.lastSeen = [tgt.pos.x, tgt.pos.z];
      const ey = m.pos.y + m.eyeH;
      const dx = tgt.pos.x - m.pos.x, dy = (tgt.pos.y + 1.32) - ey, dz = tgt.pos.z - m.pos.z;
      const hd = Math.hypot(dx, dz);
      const trueYaw = Math.atan2(-dx, -dz), truePitch = Math.atan2(dy, hd);
      const k = Math.exp(-3.2 * dt);
      this.errY *= k;
      const tol = Math.atan2(0.34, hd) * 1.5 + 0.012;
      dYaw = trueYaw + this.errY * sp.errScale * 20;
      dPitch = truePitch - m.punchP * 0.5;
      // 开火：进入射程 + 已对准
      const aimErr = Math.hypot(wrapPi(m.yaw - trueYaw), m.pitch - truePitch);
      if (hd <= sp.maxR && aimErr < tol && m.protectT <= 0) {
        bits |= B.fire;                       // 持续按住（射手/半程怪自然由 rpm 限速）
        if (!sp.auto) bits |= B.fireP;             // 半自动武器需要每发的按下沿
      } else if (hd > sp.pref) {
        // 扑向目标：朝向移动方向、以 curYaw 为基准分解前进输入
        wishX = -dx / (hd || 1); wishZ = -dz / (hd || 1);
        dYaw = Math.atan2(-wishX, -wishZ);
      }
      // 近战怪贴脸时小幅游走，避免完全叠人
      if (hd < sp.pref && rnd() < 0.06) { const s = rnd() < 0.5 ? 1 : -1; wishX = Math.cos(this.curYaw) * s * 0.5; wishZ = -Math.sin(this.curYaw) * s * 0.5; }
    } else {
      // 无可见目标：寻路扑向最近人类的大致方向 / 巡逻刷怪口
      if (!this.path || this.pi >= this.path.length || room.time >= this.repathAt) {
        let near = null, nd = 1e9;
        for (const a of list) if (!a.isMonster && a.alive) { const d = Math.hypot(a.pos.x - m.pos.x, a.pos.z - m.pos.z); if (d < nd) { nd = d; near = a; } }
        this.repath(room, m, near || (this.lastSeen ? { pos: { x: this.lastSeen[0], z: this.lastSeen[1], y: 0 } } : null));
      }
      if (this.path && this.pi < this.path.length) {
        const wp = this.path[this.pi];
        const dx = wp[0] - m.pos.x, dz = wp[1] - m.pos.z, dd = Math.hypot(dx, dz);
        if (dd < 0.6) this.pi++;
        else { wishX = dx / dd; wishZ = dz / dd; dYaw = Math.atan2(-dx, -dz); }
      }
      // 卡住跳跃
      const moved = Math.hypot(m.pos.x - this.lastX, m.pos.z - this.lastZ);
      this.stuckT += dt;
      if (this.stuckT > 1.2) { if (moved < 0.3) bits |= B.jump; this.lastX = m.pos.x; this.lastZ = m.pos.z; this.stuckT = 0; }
    }
    // 怪群彼此分离
    for (const a of list) {
      if (a === m || !a.alive) continue;
      const dx = m.pos.x - a.pos.x, dz = m.pos.z - a.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 1.0 && d2 > 1e-4) { const d = Math.sqrt(d2); wishX += (dx / d) * 0.7; wishZ += (dz / d) * 0.7; }
    }
    // 转向限速
    const turn = sp.turn * dt;
    this.curYaw = wrapPi(this.curYaw + clamp(wrapPi(dYaw - this.curYaw), -turn, turn));
    this.curPitch = clamp(this.curPitch + clamp(dPitch - this.curPitch, -turn * 0.8, turn * 0.8), -1.2, 1.2);
    // 世界期望方向 → (f, r)
    const [fx, fz] = wishDir(this.curYaw, 1, 0);
    const [rx, rz] = wishDir(this.curYaw, 0, 1);
    let f = wishX * fx + wishZ * fz, r = wishX * rx + wishZ * rz;
    const fl = Math.hypot(f, r); if (fl > 1) { f /= fl; r /= fl; }
    return { y: this.curYaw, p: this.curPitch, f, r, bits, w: -1 };
  }
}
