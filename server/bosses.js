// PVE 终极 BOSS：定义 + 大脑（纯 JS，无 THREE / DOM）
// 复用 MonsterBrain 的感知 / 寻路 / 转向 / 开火框架，只在三种"技能"上分岔：
//   铁皮暴君 charge —— 蓄力冲撞 + 近身撞击波；瘟疫母体 barrage —— 延时酸液齐射 + 定期分裂；
//   幽影猎手 blink —— 短距闪现拉近距离后用 AWM 点名。
// BOSS 也可以被真人附身（room.takeBoss），此时由玩家命令驱动，本文件不参与。
import { MonsterBrain } from './monsters.js';
import { B } from '../src/protocol.js';
import { STAND_H, RUN } from '../src/movement.js';
import { _aim } from './botai.js';
const { wrapPi } = _aim;

export const BOSSES = {
  tyran: {
    name: '铁皮暴君', boss: true, hp: 6500, armor: 650, speed: 3.9, radius: 0.55,
    weapon: 'm249', melee: 'bossclaw', auto: true, dmgScale: 0.62, fov: 2.4, see: 60, turn: 2.2, errScale: 0.03, pref: 8, maxR: 24,
    ability: 'charge', cd: 10, range: 24, slam: { r: 4.4, dmg: 58, knock: 6.5 },
  },
  mother: {
    name: '瘟疫母体', boss: true, hp: 8500, armor: 420, speed: 2.9, radius: 0.6,
    weapon: 'm3', melee: 'bossclaw', auto: false, dmgScale: 0.45, fov: 2.7, see: 42, turn: 1.8, errScale: 0.05, pref: 6, maxR: 12,
    ability: 'barrage', cd: 9, range: 30, blast: { r: 4.6, dmg: 40 }, summons: 2,
  },
  shade: {
    name: '幽影猎手', boss: true, hp: 4800, armor: 260, speed: 6.4, radius: 0.42,
    weapon: 'awm', melee: 'bossclaw', auto: false, dmgScale: 1.05, fov: 2.2, see: 78, turn: 4.6, errScale: 0.012, pref: 16, maxR: 48,
    ability: 'blink', cd: 6.5, range: 62, blink: 9,
  },
};
export const BOSS_KINDS = Object.keys(BOSSES);

// 随机波次随机 BOSS：避免与上一位重复
export function randomBossKind(last) {
  const pool = BOSS_KINDS.filter((k) => k !== last);
  return (pool.length ? pool : BOSS_KINDS)[(Math.random() * (pool.length || BOSS_KINDS.length)) | 0];
}
// 越到后期血量越厚
export const bossHpScale = (wave) => 1 + Math.max(0, wave - 5) * 0.06;

export class BossBrain extends MonsterBrain {
  constructor(m) {
    super(m);
    this.sp = BOSSES[m.kind];
    this.cd = this.sp.cd * 0.55;   // 出场先让人类打一会儿
    this.charge = 0;
    this.chargeTo = null;
    this.summons = 0;
    this.meleeCd = 0;              // 近身巨爪冷却
  }
  step(room, m, list, dt) {
    const cmd = super.step(room, m, list, dt);
    const sp = this.sp;
    if (!m.alive) return cmd;
    const base = sp.speed / (RUN * ((m.inv[0] && m.inv[0].def && m.inv[0].def.speed) || 1));
    // 冷却独立推进：目标忽现忽隐时技能也照样蓄得满
    this.cd = Math.max(0, this.cd - dt);
    if (this.charge > 0) { this.chargeStep(room, m, list, cmd, sp, base, dt); return cmd; } // 冲撞起手就走完，不被晃掉
    const t = this.tgt;
    if (!t || !t.alive) { m.spdMul = base; return cmd; }
    // 近身巨爪：任何 BOSS 贴脸都能挥一爪（与技能并行——技能管远程/位移，爪管近身压制）
    this.meleeCd = Math.max(0, this.meleeCd - dt);
    if (this.meleeCd <= 0 && this.tgtD < 3.3 && this.los(room, m, t)) {
      const ty = Math.atan2(-(t.pos.x - m.pos.x), -(t.pos.z - m.pos.z));
      if (Math.abs(wrapPi(m.yaw - ty)) < 0.55) { room.bossMelee(m, Math.random() < 0.28); this.meleeCd = 1.15; }
    }
    if (sp.ability === 'charge') this.chargeStart(room, m, sp, t);
    else if (sp.ability === 'barrage') this.barrageStep(room, m, list, sp);
    else this.blinkStep(room, m, sp, t);
    return cmd;
  }
  // 铁皮暴君：锁定那一刻的坐标，然后闷头撞过去
  chargeStart(room, m, sp, t) {
    if (this.cd > 0 || this.tgtD < 5 || this.tgtD > sp.range) return;
    this.charge = 2.4; this.cd = sp.cd;
    this.chargeTo = [t.pos.x, t.pos.z];
    room.events.push({ e: 'boss', a: 'charge', id: m.id, nm: m.name });
  }
  chargeStep(room, m, list, cmd, sp, base, dt) {
    this.charge -= dt;
    m.spdMul = base * 2.3;
    const tx = this.chargeTo[0], tz = this.chargeTo[1];
    const dx = tx - m.pos.x, dz = tz - m.pos.z, d = Math.hypot(dx, dz) || 1;
    cmd.y = Math.atan2(-dx, -dz); cmd.p = 0; cmd.f = 1; cmd.r = 0;
    cmd.bits &= ~(B.fire | B.fireP);   // 冲撞期间不收枪
    let contact = false;
    for (const a of list) {
      if (a.isMonster || !a.alive) continue;
      if (Math.hypot(a.pos.x - m.pos.x, a.pos.z - m.pos.z) < 3.2) { contact = true; break; }
    }
    if (contact || d < 1.6 || this.charge <= 0) {
      if (contact) room.bossBlast(m, sp.slam, 'slam');
      this.charge = 0; this.chargeTo = null; m.spdMul = base;
    }
  }
  // 瘟疫母体：点名 3 处延时酸爆 + 每两次齐射分裂两只感染体
  barrageStep(room, m, list, sp) {
    if (this.cd > 0) return;
    this.cd = sp.cd;
    const aims = [];
    for (const a of list) {
      if (aims.length >= 3) break;
      if (a.isMonster || !a.alive) continue;
      if (Math.hypot(a.pos.x - m.pos.x, a.pos.z - m.pos.z) > sp.range) continue;
      aims.push([a.pos.x, a.pos.z]);
    }
    if (!aims.length) return;
    for (let i = 0; i < aims.length; i++) {
      const x = aims[i][0] + (Math.random() - 0.5) * 1.6, z = aims[i][1] + (Math.random() - 0.5) * 1.6;
      room.timers.push({ t: room.time + 1.0 + i * 0.4, fn: () => room.bossBlast(m, sp.blast, 'acid', x, z) });
    }
    room.events.push({ e: 'boss', a: 'barrage', id: m.id, nm: m.name });
    if (++this.summons % 2 === 0) {
      for (let i = 0; i < sp.summons; i++) room.spawnMonster('infected', true);
      room.events.push({ e: 'boss', a: 'split', id: m.id, nm: m.name });
    }
  }
  // 幽影猎手：目标太远就闪现贴近，落点必须是可走区域
  blinkStep(room, m, sp, t) {
    if (this.cd > 0 || this.tgtD < 12) return;
    this.cd = sp.cd;
    const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z, d = Math.hypot(dx, dz) || 1;
    const reach = Math.min(sp.blink, Math.max(0, d - 7));
    for (let k = 0; k < 6; k++) {
      const f = 1 - k / 6, nx = m.pos.x + (dx / d) * reach * f, nz = m.pos.z + (dz / d) * reach * f;
      if (room.world.blocked(nx, 0.06, nz, m.radius + 0.12, STAND_H)) continue;
      room.events.push({ e: 'boss', a: 'blink', id: m.id, o: [m.pos.x, m.pos.y, m.pos.z], p: [nx, 0.05, nz] });
      m.pos.x = nx; m.pos.z = nz; m.pos.y = 0.05; m.vel.x = m.vel.y = m.vel.z = 0;
      this.curYaw = Math.atan2(-dx, -dz); this.repathAt = room.time + 1; this.path = null;
      this.lastX = nx; this.lastZ = nz; this.stuckT = 0;
      return;
    }
    this.cd = 1.2;   // 无处可闪：稍后再试
  }
}
