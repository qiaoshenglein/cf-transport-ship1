// 权威对局房间：固定 30Hz 模拟、输入队列、延迟补偿命中判定、伤害 / 击杀 / 复活 / 比分 / 断线保留
import { WEAPONS, PRIMARIES } from '../src/weapons.js';
import { applyCmd, resetForSpawn, packSelf, shotDir, F } from '../src/netsim.js';
import { STAND_H, EYE_STAND, RUN } from '../src/movement.js';
import { boneMatrices, rayHitboxes, chestPoint } from '../src/hitbox.js';
import {
  TICK_RATE, MAX_REWIND, RECONNECT_GRACE, RESPAWN_TIME, PROTECT_TIME, MATCH_TIME,
  sanitizeCmd, otherTeam, round2, round3, B, encodeWorld,
} from '../src/protocol.js';
import { loadMap } from './mapdata.js';
import { NavGrid } from '../src/physics.js';
import { BotBrain, randomBotName, randomBotPrimary } from './botai.js';
import { MONSTERS, PVE_SPAWNS, PVE_DIFF, wavePlan, MonsterBrain } from './monsters.js';
import { BOSSES, BossBrain, randomBossKind, bossHpScale } from './bosses.js';
import { SUPPLY_CD, SUPPLY_R, SUPPLY_HEAL } from '../src/supplies.js';
import { suppliesForMap } from '../src/maps.js';
import { sizeOf } from '../src/bosssize.js';

const DT = 1 / TICK_RATE;
const HISTORY = Math.ceil(1.0 * TICK_RATE);
const MAX_QUEUE = 120;          // 每个玩家最多缓存的输入条数
const BUDGET_CAP = 0.25;        // 允许的输入时间提前量（秒），超出视为加速作弊直接丢弃
const END_PAUSE = 10;           // 结算界面停留时间
const AIM_SNAP = 0.25;          // 开火时相邻命令视角位移超过此弧度(~14°)记一次疑似瞬瞄
const AIM_WIN = 4;              // 疑似计数窗口（秒）
const AIM_LIMIT = 6;            // 窗口内达到该次数即触发处罚
const AIM_BAN = 4;              // 处罚：暂停其开火（秒），移动/视角不受影响
const randInt = (n) => (Math.random() * n) | 0;

export class Room {
  constructor(id, o = {}) {
    this.id = id;
    this.name = String(o.name || `房间 ${id}`).slice(0, 24);
    this.goal = [30, 50, 100].includes(o.goal) ? o.goal : 50;
    this.max = Math.max(2, Math.min(16, o.max | 0 || 16));
    this.onEmpty = o.onEmpty || (() => {});
    this.onCheat = o.onCheat || null;
    const m = loadMap(o.map);
    this.mapId = m.id; this.mapName = m.def.name;
    this.world = m.world; this.spawns = m.spawns;
    this.nav = new NavGrid(this.world, ...m.def.bounds, 0.5, 0.42);
    this.pveSpawns = m.def.pve.spawns;
    this.ownerId = null;                 // 房主（首个真人；离开后移交）
    this.maxBots = Math.max(0, (o.maxBots | 0) || 12); // 每房机器人上限
    this.mode = o.mode === 'pve' ? 'pve' : 'pvp';
    this.pveDiff = PVE_DIFF[o.diff] ? o.diff : 'normal';
    this.pveDmgK = (PVE_DIFF[this.pveDiff] || PVE_DIFF.normal).dmgK;
    this.monsters = new Map();           // PVE：id -> 怪物 / BOSS 实体（不占玩家席位）
    this.wave = 0; this.waveLeft = 0; this.nextWaveAt = 0; this.pending = [];
    this.bossAtWave = 4 + randInt(3);    // 随机波次随机 BOSS
    this.lastBossKind = null; this.possessId = null; this.bossPool = 0; this.bossKind = null;
    this.supplies = suppliesForMap(this.mapId).map((s, i) => ({ x: s.x, z: s.z, kind: s.kind, i, readyAt: 0 }));
    this.drops = []; this.dropSeq = 1; this.supDirty = true;
    this.players = new Map(); // id -> player
    this.spectators = new Map(); // 观战席位 id -> { id, sess, name }
    this.nextSp = 1;
    this.nextId = 1;
    this.time = 0; this.tick = 0;
    this.history = [];
    this.timers = [];
    this.nades = []; this.nadeId = 1;
    this.events = [];
    this.resetMatch();
    this.rosterDirty = true;
    this.timer = null;
  }

  // ---------- 生命周期 ----------
  start() {
    if (this.timer) return;
    let last = performance.now(), acc = 0;
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += Math.min(0.25, (now - last) / 1000); last = now;
      while (acc >= DT) { acc -= DT; this.step(); }
    }, 1000 / TICK_RATE / 2);
  }
  stop() { clearInterval(this.timer); this.timer = null; }
  resetMatch() {
    this.score = { BL: 0, GR: 0 };
    this.timeLeft = MATCH_TIME;
    this.state = 'play';
    this.endAt = 0;
    for (const p of this.players.values()) {
      if (p.isBoss) { p.isBoss = false; p.bossKind = null; p.hpMax = 100; p.spdMul = 1; p.team = 'BL'; if (p.homePrimary) { p.primary = p.homePrimary; p.homePrimary = null; } }
      p.stats = { k: 0, d: 0, hs: 0, shots: 0, hits: 0 };
      p.streak = 0; p.multi = 0; p.lastKillT = -99;
      this.spawn(p);
    }
    if (this.mode === 'pve') { // 新一轮：清空残怪与掉落、重开波次与排期
      this.monsters.clear();
      this.drops.length = 0; this.dropSeq = 1;
      for (const s of this.supplies) s.readyAt = 0;
      this.supDirty = true;
      this.timers.length = 0;   // BOSS 酸爆的延时起爆随本轮作废
      this.wave = 0; this.waveLeft = 0; this.nextWaveAt = this.time + 2; this.pending = [];
      this.bossAtWave = 4 + randInt(3);
      this.lastBossKind = null; this.possessId = null; this.bossPool = 0; this.bossKind = null;
    }
    this.nades = [];
    this.rosterDirty = true;
  }
  info() {
    const t = this.teamCount();
    return { id: this.id, name: this.name, goal: this.goal, max: this.max, n: this.players.size, bl: t.BL, gr: t.GR, sp: this.spectators.size, score: this.score, state: this.state, timeLeft: Math.round(this.timeLeft), owner: this.ownerId, bots: this.botCount(), mode: this.mode, map: this.mapId, mn: this.mapName, wave: this.wave, diff: this.pveDiff, boss: this.mode === 'pve' ? this.bossState() : null };
  }
  // BOSS 现状（AI 血线或真人附身血线），供大厅列表与客户端血条初始值
  bossState() {
    const m = this.aliveBoss();
    if (m) return { k: m.kind, nm: m.name, hp: Math.max(0, Math.ceil(m.hp)), hpMax: m.hpMax, by: 0 };
    const p = this.possessId ? this.players.get(this.possessId) : null;
    if (p && p.isBoss) return { k: p.bossKind, nm: (BOSSES[p.bossKind] || {}).name || 'BOSS', hp: Math.max(0, Math.ceil(p.hp)), hpMax: p.hpMax, by: 1, who: p.name };
    return null;
  }
  teamCount() {
    const c = { BL: 0, GR: 0 };
    for (const p of this.players.values()) c[p.team]++;
    return c;
  }

  // ---------- 玩家 ----------
  addPlayer(sess, o = {}) {
    if (this.players.size >= this.max) return null;
    const c = this.teamCount();
    let team = this.mode === 'pve' ? 'BL' : (o.team === 'BL' || o.team === 'GR' ? o.team : null);
    // 自动平衡：请求的阵营人数更多时分到另一边
    if (this.mode !== 'pve' && (!team || c[team] > c[otherTeam(team)])) team = c.BL <= c.GR ? 'BL' : 'GR';
    const p = {
      id: this.nextId++, sess, name: sess.name, team,
      primary: PRIMARIES.includes(o.primary) ? o.primary : 'ak47', nextPrimary: null,
      pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
      radius: 0.36, height: STAND_H, stepHeight: 0.42, onGround: true, crouch: false, eyeH: EYE_STAND, jumpCD: 0,
      yaw: 0, pitch: 0, punchP: 0, punchY: 0, aimPunch: 0,
      hp: 100, hpMax: 100, armor: 100, alive: false, respawnT: 0, protectT: 0, life: 0,
      isBoss: false, bossKind: null, homePrimary: null,
      inv: [], slot: 0, lastSlot: 1, readyAt: 0, scoped: 0, scopeReady: false, scopeT: 0, reScope: 0, pendingThrow: 0, autoSwitchAt: 0,
      stats: { k: 0, d: 0, hs: 0, shots: 0, hits: 0 }, streak: 0, multi: 0, lastKillT: -99,
      queue: [], ack: 0, pt: 0, budget: 0.1, lastCmd: null, isPlayer: true,
      online: true, discAt: 0, ping: 0,
    };
    this.players.set(p.id, p);
    if (this.ownerId == null) this.ownerId = p.id; // 首个真人成为房主
    this.spawn(p);
    this.rosterDirty = true;
    this.events.push({ e: 'join', id: p.id, name: p.name, team: p.team });
    this.start();
    return p;
  }
  removePlayer(p, reason = 'leave') {
    if (!this.players.has(p.id)) return;
    if (p.isBoss) this.releaseBoss(p, false); // 附身者退出：BOSS 交还 AI
    this.players.delete(p.id);
    this.events.push({ e: 'leave', id: p.id, name: p.name, reason });
    if (!p.isBot && this.ownerId === p.id) { const h = this.humanPlayers()[0]; this.ownerId = h ? h.id : null; }
    this.rosterDirty = true;
    // 机器人不计入“是否可回收”：无在线真人且无观战即停房（顺带清 bot）
    if (this.humanPlayers().length === 0 && this.spectators.size === 0) { this.stop(); this.onEmpty(this); }
  }
  humanPlayers() { const out = []; for (const p of this.players.values()) if (!p.isBot) out.push(p); return out; }
  botCount() { let n = 0; for (const p of this.players.values()) if (p.isBot) n++; return n; }

  // 房主添加机器人：占一个玩家槽，走与真人相同的模拟管线
  addBot(o = {}) {
    if (this.players.size >= this.max) return null;
    if (this.botCount() >= this.maxBots) return null;
    const c = this.teamCount();
    // PVE 里机器人只能是并肩的清怪队友（GR 由怪物潮占据）
    let team = this.mode === 'pve' ? 'BL' : (o.team === 'BL' || o.team === 'GR' ? o.team : (c.BL <= c.GR ? 'BL' : 'GR'));
    const used = new Set([...this.players.values()].map((p) => p.name));
    const primary = PRIMARIES.includes(o.primary) ? o.primary : randomBotPrimary();
    const p = {
      id: this.nextId++, sess: null, name: randomBotName(used), team, isBot: true,
      primary, nextPrimary: null,
      pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
      radius: 0.36, height: STAND_H, stepHeight: 0.42, onGround: true, crouch: false, eyeH: EYE_STAND, jumpCD: 0,
      yaw: 0, pitch: 0, punchP: 0, punchY: 0, aimPunch: 0, speed: 0,
      hp: 100, armor: 100, alive: false, respawnT: 0, protectT: 0, life: 0,
      inv: [], slot: 0, lastSlot: 1, readyAt: 0, scoped: 0, scopeReady: false, scopeT: 0, reScope: 0, pendingThrow: 0, autoSwitchAt: 0,
      stats: { k: 0, d: 0, hs: 0, shots: 0, hits: 0 }, streak: 0, multi: 0, lastKillT: -99,
      queue: [], ack: 0, pt: 0, budget: 0, lastCmd: null, isPlayer: true, curVt: 0,
      online: true, discAt: -1e9, ping: 0,
    };
    p.brain = new BotBrain(p);
    p.brain.setDiff(o.diff);
    this.players.set(p.id, p);
    this.spawn(p);
    p.brain.reset(p);
    this.rosterDirty = true;
    this.start();
    return p;
  }
  removeBot(id) {
    const p = this.players.get(id | 0);
    if (!p || !p.isBot) return false;
    this.players.delete(p.id);
    this.rosterDirty = true;
    if (this.humanPlayers().length === 0 && this.spectators.size === 0) { this.stop(); this.onEmpty(this); }
    return true;
  }
  clearBots(team) {
    const ids = [...this.players.values()].filter((p) => p.isBot && (!team || p.team === team)).map((p) => p.id);
    for (const id of ids) { this.players.delete(id); }
    if (ids.length) this.rosterDirty = true;
    if (this.humanPlayers().length === 0 && this.spectators.size === 0) { this.stop(); this.onEmpty(this); }
    return ids.length;
  }
  setBotDiff(id, key) { const p = this.players.get(id | 0); if (p && p.isBot) { p.brain.setDiff(key); return true; } return false; }

  // ---------- PVE：波次刷怪、BOSS 与补给 ----------
  // 参与命中/寻路/快照的全部实体（PVP 时即玩家）
  entList() { return this.mode === 'pve' ? [...this.players.values(), ...this.monsters.values()] : [...this.players.values()]; }
  aliveMonsters() { let n = 0; for (const m of this.monsters.values()) if (m.alive) n++; return n; }
  aliveBoss() { for (const m of this.monsters.values()) if (m.isBoss && m.alive) return m; return null; }
  pveDef(kind) { return BOSSES[kind] || MONSTERS[kind]; }
  // 伤害缩放：怪物 / BOSS（含真人附身形态）都按各自倍率走，人类与机器人恒为 1
  dmgScaleOf(a) {
    const sp = a.isMonster ? this.pveDef(a.kind) : (a.isBoss ? BOSSES[a.bossKind] : null);
    return sp ? (sp.dmgScale || 1) * this.pveDmgK : 1;
  }
  // 巨型 BOSS 的权威命中盒要跟着视觉体型放大，否则客户端画得巨大、服务端按人体判 -> 看得见打不着
  hitScaleOf(a) {
    const s = sizeOf(a.isMonster ? a.kind : (a.isBoss ? a.bossKind : null));
    return s ? s.h : 1;
  }
  // quota=true：这只计入本波配额（BOSS 分裂出的感染体用），击杀时统一在 kill() 里递减
  spawnMonster(kind, quota) {
    const sp = this.pveDef(kind) || MONSTERS.infected;
    const boss = !!sp.boss;
    const D = PVE_DIFF[this.pveDiff] || PVE_DIFF.normal;
    const pool = this.pveSpawns && this.pveSpawns.length ? this.pveSpawns : PVE_SPAWNS;
    const pt = pool[randInt(pool.length)];
    // resetForSpawn 会把血量写成 100，所以这里先算定血量，出生后再覆盖
    const hp = Math.round(sp.hp * D.hpK * (boss ? bossHpScale(this.wave) : 1));
    const m = {
      id: this.nextId++, isMonster: true, isBoss: boss, kind, name: '', team: 'GR', sess: null, online: true,
      pos: { x: pt.x + (Math.random() - 0.5) * 2.4, y: 0.05, z: pt.z + (Math.random() - 0.5) * 2.4 },
      vel: { x: 0, y: 0, z: 0 },
      radius: sp.radius, height: STAND_H, stepHeight: 0.42, onGround: true, crouch: false, eyeH: EYE_STAND, jumpCD: 0,
      yaw: Math.PI / 2, pitch: 0, punchP: 0, punchY: 0, aimPunch: 0, speed: 0,
      hp, hpMax: hp, armor: 0, alive: true, respawnT: 0, protectT: 0, life: 1,
      inv: [], slot: 0, lastSlot: 0, readyAt: 0, scoped: 0, scopeReady: false, scopeT: 0, reScope: 0, pendingThrow: 0, autoSwitchAt: 0,
      stats: { k: 0, d: 0, hs: 0, shots: 0, hits: 0 }, queue: [], ack: 0, pt: this.time, budget: 0, isPlayer: false, curVt: this.time,
    };
    resetForSpawn(m, { x: m.pos.x, z: m.pos.z, yaw: m.yaw }, sp.weapon, (Math.random() * 2 ** 31) | 0, this.time);
    m.protectT = 0; m.inv[0].reserve = 100000;
    m.hp = hp; m.hpMax = hp; m.armor = boss ? Math.round(sp.armor * D.hpK) : 0;
    // 怪物移速走武器 speed 之外的独立倍率，使其与武器本身的速度加成交织解耦
    m.spdMul = sp.speed / (RUN * ((m.inv[0].def && m.inv[0].def.speed) || 1));
    m.brain = boss ? new BossBrain(m) : new MonsterBrain(m);
    m.name = boss ? sp.name : m.brain.name;
    this.monsters.set(m.id, m);
    if (quota) this.waveLeft++;
    this.rosterDirty = true;
    if (boss) { this.lastBossKind = kind; this.events.push({ e: 'bossin', id: m.id, k: kind, nm: sp.name, hp: m.hp, hpMax: m.hpMax }); }
    return m;
  }
  tickPVE() {
    if (this.state !== 'play') return;
    const D = PVE_DIFF[this.pveDiff] || PVE_DIFF.normal;
    // nextWaveAt < 0 表示"本波尚未清空"；清空后重新计时，留出喘息
    if (this.waveLeft <= 0 && this.aliveMonsters() === 0) {
      if (this.nextWaveAt < 0) this.nextWaveAt = this.time + (this.wave === 0 ? 2 : 4);
      if (this.time >= this.nextWaveAt) { this.nextWaveAt = -1; this.startWave(D); }
    }
    while (this.pending.length && this.aliveMonsters() < D.cap) this.spawnMonster(this.pending.pop());
    // BOSS：随机波次随机登场（真人正附身时不重复生成）
    if (!this.possessId && !this.aliveBoss() && this.wave >= this.bossAtWave) {
      this.spawnMonster(randomBossKind(this.lastBossKind));
      this.bossAtWave = this.wave + 4 + randInt(3);
    }
    this.tickSupplies();
  }
  startWave(D) {
    this.wave++;
    const comp = wavePlan(this.wave, D.waveBase);
    this.pending = [];
    for (const k in comp) for (let i = 0; i < comp[k]; i++) this.pending.push(k);
    this.waveLeft = this.pending.length;
    this.events.push({ e: 'wave', n: this.wave, total: this.waveLeft });
  }
  stepMonster(m, list) {
    const s = m.brain.step(this, m, list, DT);
    const c = { d: DT, y: s.y, p: s.p, f: s.f, r: s.r, b: s.bits, w: s.w, vt: this.time, s: 0 };
    m.lastCmd = c; m.curVt = this.time;
    applyCmd(m, c, this.world, list, this.hooks || (this.hooks = this.makeHooks()));
    if (!m.alive && this.state === 'play') { m.respawnT -= DT; if (m.respawnT <= 0) { this.monsters.delete(m.id); this.rosterDirty = true; } }
  }
  // BOSS 范围伤害：撞击（slam，带击退）与延时酸爆（acid，由定时器落到具体坐标）
  bossBlast(src, cfg, kind, bx, bz) {
    const x = bx === undefined ? src.pos.x : bx, z = bz === undefined ? src.pos.z : bz, y = 0.9;
    this.events.push({ e: 'blast', k: kind, p: [round2(x), y, round2(z)], r: cfg.r });
    for (const a of this.entList()) {
      if (!a.alive || a === src || a.team === src.team) continue;
      const c = chestPoint(boneMatrices(this.poseOf(a)));
      const dx = c[0] - x, dy = c[1] - y, dz = c[2] - z, L = Math.hypot(dx, dy, dz);
      if (L > cfg.r) continue;
      const nx = dx / (L || 1), ny = dy / (L || 1), nz = dz / (L || 1);
      if (this.world.raycast(x, y + 0.5, z, nx, ny, nz, Math.max(0, L - 0.4), 'bullet')) continue;
      const dmg = cfg.dmg * Math.pow(1 - L / cfg.r, 1.1) * this.pveDmgK;
      if (dmg > 1) this.damage(a, src, dmg, 'chest', 'he', { x: nx, y: 0.2, z: nz }, false);
      if (cfg.knock && a.alive) { a.vel.x += nx * cfg.knock; a.vel.z += nz * cfg.knock; a.vel.y = Math.max(a.vel.y, cfg.knock * 0.7); a.onGround = false; }
    }
  }
  // ---------- 补给站与 BOSS 空投 ----------
  supMask() { let b = 0; for (let i = 0; i < this.supplies.length; i++) if (this.time >= this.supplies[i].readyAt) b |= 1 << i; return b; }
  fillSupply(p, kind) {
    let got = false;
    if (kind === 'ammo' || kind === 'full') {
      for (const w of p.inv) {
        if (w.mag >= w.def.mag && w.reserve >= w.def.reserve) continue;
        w.mag = w.def.mag; w.reserve = Math.max(w.reserve, kind === 'full' ? Math.max(w.def.reserve, 999) : w.def.reserve);
        w.reloadUntil = 0; got = true;
      }
    }
    if (kind === 'med' || kind === 'full') {
      const max = p.hpMax || 100;
      if (p.hp < max) { p.hp = Math.min(max, p.hp + (kind === 'full' ? max : SUPPLY_HEAL)); got = true; }
      else if (kind === 'med' && p.armor < 100) { p.armor = Math.min(100, p.armor + 25); got = true; } // 满血时过量治疗转护甲
    }
    if (kind === 'armor' || kind === 'full') { if (p.armor < 100) { p.armor = 100; got = true; } }
    return got;
  }
  tickSupplies() {
    // 补给只服务清怪小队（BL）：真人附身 BOSS 后属于怪潮，不能反过来喝己方的血包
    const takers = (p) => p.alive && !p.isMonster && p.team === 'BL';
    for (let i = 0; i < this.supplies.length; i++) {
      const s = this.supplies[i];
      if (this.time < s.readyAt) continue;
      for (const p of this.players.values()) {
        if (!takers(p)) continue;
        if (Math.hypot(p.pos.x - s.x, p.pos.z - s.z) > SUPPLY_R) continue;
        if (!this.fillSupply(p, s.kind)) continue;
        s.readyAt = this.time + SUPPLY_CD[s.kind];
        this.supDirty = true;
        this.events.push({ e: 'sup', id: p.id, i, k: s.kind, hp: Math.round(p.hp), ar: Math.round(p.armor) });
        break;   // 一座补给点每 tick 只服务一个人
      }
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const c = this.drops[i];
      if (this.time - c.born > 60) { this.drops.splice(i, 1); this.supDirty = true; continue; }
      for (const p of this.players.values()) {
        if (!takers(p)) continue;
        if (Math.hypot(p.pos.x - c.x, p.pos.z - c.z) > 1.6) continue;
        this.fillSupply(p, 'full');
        this.events.push({ e: 'picked', id: p.id, d: c.id });
        this.drops.splice(i, 1); this.supDirty = true;
        break;
      }
    }
  }
  // ---------- 真人附身 BOSS ----------
  takeBoss(p) {
    const m = this.aliveBoss();
    if (!m || !p || p.isMonster || !p.alive) return null;
    const sp = BOSSES[m.kind];
    this.monsters.delete(m.id);
    this.possessId = p.id; this.bossPool = m.hp; this.bossKind = m.kind;
    p.isBoss = true; p.bossKind = m.kind; p.homePrimary = p.primary; p.primary = sp.weapon; p.team = 'GR';
    this.spawn(p);
    p.hpMax = Math.max(1, this.bossPool); p.hp = p.hpMax;
    p.armor = Math.round(sp.armor * (PVE_DIFF[this.pveDiff] || PVE_DIFF.normal).hpK);
    p.inv[0].reserve = 100000; p.protectT = 0;
    p.spdMul = sp.speed / (RUN * ((p.inv[0].def && p.inv[0].def.speed) || 1));
    this.rosterDirty = true;
    this.events.push({ e: 'possess', id: p.id, name: p.name, k: m.kind, nm: sp.name, hpMax: p.hpMax, prim: p.primary });
    return p;
  }
  // dead=true：BOSS 被击杀（本轮不再登场，掉落空投）；false：主动下甲，AI 接管剩余血量
  releaseBoss(p, dead) {
    if (!p || !p.isBoss) return false;
    const kind = this.bossKind || p.bossKind;
    p.isBoss = false; p.bossKind = null; p.hpMax = 100; p.spdMul = 1; p.team = 'BL';
    if (p.homePrimary) { p.primary = p.homePrimary; p.homePrimary = null; }
    this.possessId = null;
    if (dead) this.bossPool = 0;
    else {
      this.spawn(p);
      if (this.bossPool > 0 && this.state === 'play') {
        const m = this.spawnMonster(kind);
        if (m) { m.hp = m.hpMax = Math.max(1, this.bossPool); } // AI 接管的是"剩下的血"，附身不能当回血用
      }
      this.bossPool = 0;
    }
    this.rosterDirty = true;
    this.events.push({ e: 'unpossess', id: p.id, name: p.name, dead: dead ? 1 : 0, prim: p.primary });
    return true;
  }
  bossDown(v, att) {
    this.drops.push({ id: this.dropSeq++, x: round2(v.pos.x), y: 0.55, z: round2(v.pos.z), born: this.time });
    for (const s of this.supplies) s.readyAt = 0;   // 击杀 BOSS：全站刷新 + 掉空投
    this.supDirty = true;
    this.events.push({ e: 'bossdown', k: v.bossKind || v.kind, nm: v.name, a: att ? att.id : 0, p: [round2(v.pos.x), 0.55, round2(v.pos.z)] });
  }
  addSpectator(sess) {
    if (this.spectators.size >= 8) return null;
    const sp = { id: this.nextSp++, sess, name: sess.name };
    this.spectators.set(sp.id, sp);
    this.events.push({ e: 'spect', name: sp.name });
    this.start();
    return sp;
  }
  removeSpectator(sp) {
    if (!this.spectators.has(sp.id)) return;
    this.spectators.delete(sp.id);
    this.events.push({ e: 'unspect', name: sp.name });
    if (this.players.size === 0 && this.spectators.size === 0) { this.stop(); this.onEmpty(this); }
  }
  spectWelcome() { return { room: this.info(), st: this.time, roster: this.roster(), tickRate: TICK_RATE, sup: this.mode === 'pve' ? this.supMask() : 0, dp: this.mode === 'pve' ? this.dropList() : [] }; }
  disconnect(p) {
    if (p.isBoss) this.releaseBoss(p, false); // 附身者掉线：AI 立刻接管 BOSS
    p.online = false; p.discAt = this.time; p.queue.length = 0; p.lastCmd = null;
    this.rosterDirty = true;
    this.events.push({ e: 'disc', id: p.id, name: p.name });
  }
  reconnect(p) {
    p.online = true; p.budget = 0.1; p.queue.length = 0;
    this.rosterDirty = true;
    this.events.push({ e: 'rejoin', id: p.id, name: p.name });
  }
  setLoadout(p, primary) {
    if (!PRIMARIES.includes(primary)) return;
    p.nextPrimary = primary;
    // 在出生区内立即更换
    const inSpawn = p.alive && (p.team === 'BL' ? p.pos.x < -28.3 : p.pos.x > 28.3);
    if (inSpawn) { p.primary = primary; this.respawnInPlace(p); }
  }
  respawnInPlace(p) {
    const sp = { x: p.pos.x, z: p.pos.z, yaw: p.yaw };
    const prot = p.protectT;
    resetForSpawn(p, sp, p.primary, (Math.random() * 2 ** 31) | 0, p.pt);
    p.protectT = prot; p.life++;
  }
  spawn(p) {
    const pts = this.spawns[p.team];
    let best = pts[0], bestScore = -1e9;
    for (const s of pts) {
      let sc = Math.random() * 3;
      for (const o of this.players.values()) {
        if (!o.alive || o === p) continue;
        const d = Math.hypot(o.pos.x - s.x, o.pos.z - s.z);
        if (d < 1.2) sc -= 100;
        if (o.team !== p.team) sc += Math.min(d, 40) * 0.1;
      }
      if (sc > bestScore) { bestScore = sc; best = s; }
    }
    if (p.nextPrimary) { p.primary = p.nextPrimary; p.nextPrimary = null; }
    resetForSpawn(p, best, p.primary, (Math.random() * 2 ** 31) | 0, p.pt);
    p.protectT = PROTECT_TIME; p.respawnT = 0; p.life++;
    this.events.push({ e: 'spawn', id: p.id });
  }
  pushCmds(p, list) {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      const c = sanitizeCmd(raw);
      if (!c || c.s <= p.ack || (p.queue.length && c.s <= p.queue[p.queue.length - 1].s)) continue;
      if (p.queue.length >= MAX_QUEUE) p.queue.shift();
      p.queue.push(c);
    }
  }

  // ---------- 模拟 ----------
  step() {
    this.time += DT; this.tick++;
    const now = this.time;
    if (this.state === 'play') this.timeLeft -= DT;
    for (let i = this.timers.length - 1; i >= 0; i--) if (now >= this.timers[i].t) { const f = this.timers[i].fn; this.timers.splice(i, 1); f(); }
    const list = [...this.players.values()];
    if (this.mode === 'pve') { this.tickPVE(); for (const m of this.monsters.values()) list.push(m); }
    for (const p of list) {
      if (p.isMonster) { this.stepMonster(p, list); continue; }
      if (p.isBot) { this.stepBot(p, list); continue; }
      // 输入时间预算：最多比真实时间超前 BUDGET_CAP，防止加速
      p.budget = Math.min(BUDGET_CAP, p.budget + DT);
      let n = 0;
      while (p.queue.length && p.queue[0].d <= p.budget + 1e-6 && n < 12) {
        const c = p.queue.shift();
        p.budget -= c.d; n++;
        this.runCmd(p, c, list);
        p.ack = c.s;
      }
      // 断线 / 卡顿的玩家原地站立（重力仍然生效）
      if (!n && p.alive && (!p.online || p.queue.length === 0) && p.budget >= BUDGET_CAP - 1e-6) {
        const idle = { s: p.ack, d: DT, y: p.yaw, p: p.pitch, f: 0, r: 0, b: (p.lastCmd?.b || 0) & 2, w: -1, vt: 0 };
        this.runCmd(p, idle, list);
        p.budget -= DT;
      }
      if (p.alive) p.protectT = Math.max(0, p.protectT - DT);
      else if (this.state === 'play') {
        p.respawnT -= DT;
        if (p.respawnT <= 0) this.spawn(p);
      }
      if (!p.online && now - p.discAt > RECONNECT_GRACE) this.removePlayer(p, 'timeout');
    }
    this.updateNades();
    this.recordHistory();
    if (this.state === 'play' && (this.timeLeft <= 0 || this.score.BL >= this.goal || this.score.GR >= this.goal)) this.endMatch();
    if (this.state === 'end' && now >= this.endAt) { this.resetMatch(); this.events.push({ e: 'start' }); }
    this.broadcast();
  }
  runCmd(p, c, list) {
    p.lastCmd = c; p.curVt = c.vt;
    this.guardAim(p, c); // 疑似自瞄时，就地清除该命令的开火位
    applyCmd(p, c, this.world, list, this.hooks || (this.hooks = this.makeHooks()));
  }
  // 机器人：每 tick 由 AI 产出一条命令，走与真人完全相同的 applyCmd 管线（绕过网络/预算/防作弊）
  stepBot(b, list) {
    const s = b.brain.step(this, b, list, DT);
    const c = { d: DT, y: s.y, p: s.p, f: s.f, r: s.r, b: s.bits, w: s.w, vt: this.time, s: 0 };
    b.lastCmd = c; b.curVt = this.time;
    applyCmd(b, c, this.world, list, this.hooks || (this.hooks = this.makeHooks()));
    if (b.alive) b.protectT = Math.max(0, b.protectT - DT);
    else if (this.state === 'play') { b.respawnT -= DT; if (b.respawnT <= 0) this.spawn(b); }
  }
  // 反作弊：开火瞬间的准星瞬移检测（aimbot 常在开火命令里把准星直接甩到目标上）
  // 正常压枪时相邻命令视角位移很小，阈值取保守值，宁可漏报不误伤人类玩家。
  guardAim(p, c) {
    const firing = !!(c.b & (B.fire | B.fireP | B.alt | B.altP));
    if (this.time < (p.aimBanUntil || 0)) { c.b &= ~(B.fire | B.fireP | B.alt | B.altP); return; }
    if (p.prevAim) {
      let dy = c.y - p.prevAim.y, dp = c.p - p.prevAim.p;
      while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      const snap = Math.hypot(dy, dp); // 相邻命令间的视角位移（弧度）
      if (firing && snap > AIM_SNAP) {
        if (!p.snapWin || this.time - p.snapWin > AIM_WIN) { p.snapWin = this.time; p.snapN = 0; }
        if (++p.snapN >= AIM_LIMIT) {
          p.aimBanUntil = this.time + AIM_BAN; p.snapN = 0;
          this.events.push({ e: 'aim_suspect', id: p.id, name: p.name });
          if (this.onCheat) this.onCheat(p, 'aim_snap');
        }
      }
    }
    p.prevAim = { y: c.y, p: c.p };
  }
  makeHooks() {
    return {
      fire: (a, w, spread, rnd) => this.fire(a, w, spread, rnd),
      melee: (a, heavy) => this.melee(a, heavy),
      throwNade: (a) => this.throwNade(a),
      reloadStart: (a) => this.events.push({ e: 'reload', id: a.id }),
      switched: (a, w) => this.events.push({ e: 'sw', id: a.id, w: w.id }),
    };
  }
  recordHistory() {
    const poses = new Map();
    for (const p of this.entList()) if (p.alive) poses.set(p.id, this.poseOf(p));
    this.history.push({ t: this.time, poses });
    if (this.history.length > HISTORY) this.history.shift();
  }
  poseOf(p) { return { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch + p.punchP, ck: p.crouch ? 1 : 0, air: !p.onGround }; }
  // 延迟补偿：取 t 时刻（客户端开火时看到的画面）各角色的位置
  posesAt(t) {
    const now = this.time;
    if (!t || t > now) t = now;
    t = Math.max(t, now - MAX_REWIND);
    const H = this.history;
    let a = null, b = null;
    for (let i = H.length - 1; i >= 0; i--) { if (H[i].t <= t) { a = H[i]; b = H[i + 1] || H[i]; break; } }
    const out = new Map();
    for (const p of this.entList()) {
      if (!p.alive) continue;
      const pa = a && a.poses.get(p.id), pb = b && b.poses.get(p.id);
      if (pa && pb && b.t > a.t) {
        const k = (t - a.t) / (b.t - a.t);
        out.set(p.id, { ...pa, x: pa.x + (pb.x - pa.x) * k, y: pa.y + (pb.y - pa.y) * k, z: pa.z + (pb.z - pa.z) * k, yaw: pa.yaw + (pb.yaw - pa.yaw) * k, pitch: pa.pitch + (pb.pitch - pa.pitch) * k });
      } else out.set(p.id, pa || pb || this.poseOf(p));
    }
    return out;
  }

  // ---------- 战斗（与单机 game.js 的公式一致） ----------
  fire(a, ws, spread, rnd) {
    const d = ws.def;
    const o = [a.pos.x, a.pos.y + a.eyeH, a.pos.z];
    const poses = this.posesAt(a.curVt);
    const targets = [];
    for (const v of this.entList()) {
      if (!v.alive || v === a || v.team === a.team) continue;
      const pose = poses.get(v.id); if (!pose) continue;
      targets.push({ v, pose, M: boneMatrices(pose), s: this.hitScaleOf(v) });
    }
    const scale = this.dmgScaleOf(a);
    const pellets = d.pellets || 1;
    let lastD = null, endT = d.range, hitId = 0;
    for (let p = 0; p < pellets; p++) {
      const dir = shotDir(a, spread, rnd);
      const D = [dir.x, dir.y, dir.z];
      lastD = dir;
      const r = this.traceShot(o, D, d, targets);
      endT = r.endT;
      if (r.hit) { this.damage(r.hit, a, r.dmg * scale, r.part, d.id, dir, r.wall); hitId = r.hit.id; }
    }
    if (!lastD) lastD = shotDir(a, 0);
    this.events.push({ e: 'shot', id: a.id, w: d.id, o: o.map(round2), d: [lastD.x, lastD.y, lastD.z].map(round3), t: round2(endT), h: hitId, p: pellets > 1 ? pellets : 0 });
  }
  // 单条射线的权威命中判定（含掩体穿透）
  traceShot(o, D, d, targets) {
    const hits = this.world.raycastAll(o[0], o[1], o[2], D[0], D[1], D[2], d.range);
    let power = d.pen, mul = 1, wall = false, from = 0, endT = d.range, hit = null, dmg = 0, part = null;
    for (let i = 0; i <= hits.length; i++) {
      const h = hits[i];
      const lim = h ? h.t : d.range;
      let best = null, bestT = lim, bp = null;
      for (const tg of targets) {
        const r = rayHitboxes(tg.M, tg.pose, o, D, bestT, tg.s);
        if (r && r.t > from - 0.01 && r.t < bestT) { best = tg.v; bestT = r.t; bp = r.part; }
      }
      if (best) {
        const partMul = bp === 'head' ? d.headMul : bp === 'arm' || bp === 'leg' ? d.limbMul : 1;
        hit = best; part = bp; dmg = d.dmg * mul * Math.pow(d.falloff, bestT / 10) * partMul; endT = bestT;
        break;
      }
      if (!h) break;
      if (h.collider.bullet === 'pen') {
        const cost = (h.exit - h.t) * (h.collider.mat === 'wood' ? 1.0 : 1.9);
        if (power > cost) { power -= cost; mul *= 0.6; wall = true; from = h.exit; continue; }
      }
      endT = h.t; break;
    }
    return { endT, hit, dmg, part, wall };
  }
  melee(a, heavy) {
    const d = WEAPONS.knife;
    const range = heavy ? d.rangeHeavy : d.rangeLight;
    const o = [a.pos.x, a.pos.y + a.eyeH, a.pos.z];
    const base = shotDir(a, 0);
    const poses = this.posesAt(a.curVt);
    let hit = null;
    for (const off of [0, 0.12, -0.12, 0.24, -0.24]) {
      const c = Math.cos(off), s = Math.sin(off);
      const dir = [base.x * c + base.z * s, base.y, -base.x * s + base.z * c];
      for (const v of this.entList()) {
        if (!v.alive || v === a || v.team === a.team) continue;
        const pose = poses.get(v.id); if (!pose) continue;
        const r = rayHitboxes(boneMatrices(pose), pose, o, dir, range, this.hitScaleOf(v));
        if (r && (!hit || r.t < hit.t)) hit = { v, t: r.t, part: r.part, dir };
      }
      if (hit) break;
    }
    this.events.push({ e: 'melee', id: a.id, heavy: heavy ? 1 : 0, hit: hit ? hit.v.id : 0 });
    const life = a.life;
    this.timers.push({
      t: this.time + (heavy ? 0.33 : 0.1), fn: () => {
        if (!a.alive || a.life !== life || !hit || !hit.v.alive) return;
        const v = hit.v;
        const vf = [-Math.sin(v.yaw), -Math.cos(v.yaw)], hd = Math.hypot(hit.dir[0], hit.dir[2]) || 1;
        const back = (vf[0] * hit.dir[0] + vf[1] * hit.dir[2]) / hd > 0.5;
        let dmg = heavy ? d.dmgHeavy : d.dmgLight;
        if (back) dmg *= heavy ? 2 : 1.6;
        if (hit.part === 'head') dmg *= 1.3;
        this.damage(v, a, dmg, hit.part, 'knife', { x: hit.dir[0], y: hit.dir[1], z: hit.dir[2] }, false, true);
      },
    });
  }
  throwNade(a) {
    const f = shotDir(a, 0);
    const rx = Math.cos(a.yaw), rz = -Math.sin(a.yaw);
    const pos = { x: a.pos.x + f.x * 0.5 + rx * 0.12, y: a.pos.y + a.eyeH + f.y * 0.5, z: a.pos.z + f.z * 0.5 + rz * 0.12 };
    const vel = { x: f.x * 16 + a.vel.x * 0.6, y: f.y * 16 + 2.8 + a.vel.y * 0.6, z: f.z * 16 + a.vel.z * 0.6 };
    const n = { id: this.nadeId++, pos, vel, fuse: WEAPONS.he.fuse, owner: a };
    this.nades.push(n);
    this.events.push({ e: 'nade', id: a.id, n: n.id });
  }
  updateNades() {
    const W = this.world;
    this.nades = this.nades.filter((n) => {
      n.fuse -= DT;
      const steps = 3, h = DT / steps;
      for (let s = 0; s < steps; s++) {
        n.vel.y -= 14 * h;
        const sp = Math.hypot(n.vel.x, n.vel.y, n.vel.z);
        if (sp < 1e-4) continue;
        const dx = n.vel.x / sp, dy = n.vel.y / sp, dz = n.vel.z / sp;
        const hit = W.raycast(n.pos.x, n.pos.y, n.pos.z, dx, dy, dz, sp * h + 0.07, 'move');
        if (hit) {
          n.pos.x += dx * Math.max(0, hit.t - 0.07); n.pos.y += dy * Math.max(0, hit.t - 0.07); n.pos.z += dz * Math.max(0, hit.t - 0.07);
          const vn = n.vel.x * hit.nx + n.vel.y * hit.ny + n.vel.z * hit.nz;
          n.vel.x = (n.vel.x - 1.45 * vn * hit.nx) * 0.55; n.vel.y = (n.vel.y - 1.45 * vn * hit.ny) * 0.55; n.vel.z = (n.vel.z - 1.45 * vn * hit.nz) * 0.55;
          if (Math.abs(vn) > 2) this.events.push({ e: 'bounce', p: [n.pos.x, n.pos.y, n.pos.z].map(round2) });
          if (hit.ny > 0.7 && Math.abs(n.vel.y) < 1.2) { n.vel.y = 0; n.vel.x *= 0.8; n.vel.z *= 0.8; }
        } else { n.pos.x += n.vel.x * h; n.pos.y += n.vel.y * h; n.pos.z += n.vel.z * h; }
      }
      if (n.fuse <= 0) { this.explode(n); return false; }
      return true;
    });
  }
  explode(n) {
    const d = WEAPONS.he, p = n.pos, owner = n.owner;
    this.events.push({ e: 'boom', n: n.id, p: [p.x, p.y, p.z].map(round2) });
    const nScale = this.dmgScaleOf(owner);
    for (const a of this.entList()) {
      if (!a.alive) continue;
      if (a.team === owner.team && a !== owner) continue;
      const c = chestPoint(boneMatrices(this.poseOf(a)));
      const dx = c[0] - p.x, dy = c[1] - p.y, dz = c[2] - p.z, L = Math.hypot(dx, dy, dz);
      if (L > d.radius) continue;
      const dir = { x: dx / (L || 1), y: dy / (L || 1), z: dz / (L || 1) };
      const blocked = this.world.raycast(p.x, p.y + 0.2, p.z, dir.x, dir.y, dir.z, Math.max(0, L - 0.3), 'bullet');
      let dmg = d.dmg * Math.pow(1 - L / d.radius, 1.1);
      if (blocked) dmg *= 0.2;
      if (dmg > 1) this.damage(a, owner, dmg * nScale, 'chest', 'he', dir, false);
    }
  }
  damage(v, att, amt, part, wid, dir, wall, melee) {
    if (!v.alive || v.protectT > 0 || this.state !== 'play') return;
    if (att && att !== v && att.team === v.team) return;
    const def = WEAPONS[wid];
    let hpD = amt;
    if (v.armor > 0 && part !== 'leg') {
      const ap = def?.armorPen ?? 0.75;
      hpD = amt * ap;
      v.armor = Math.max(0, v.armor - amt * (1 - ap) * 1.4);
    }
    v.hp -= hpD;
    const killed = v.hp <= 0;
    if (att && att !== v) att.stats.hits++;
    this.events.push({ e: 'hit', a: att ? att.id : 0, v: v.id, dmg: round2(hpD), part, hp: Math.max(0, round2(v.hp)), ar: round2(v.armor), ax: att ? round2(att.pos.x) : 0, az: att ? round2(att.pos.z) : 0, k: killed ? 1 : 0 });
    if (killed) this.kill(v, att, wid, part === 'head' && !melee, wall, dir);
  }
  kill(v, att, wid, hs, wall, dir) {
    v.alive = false; v.hp = 0; v.stats.d++; v.scoped = 0;
    v.respawnT = v.isMonster ? 2.2 : RESPAWN_TIME; // 怪物尸体 2.2s 后从字段移除（stepMonster 负责删除）
    if (v.isMonster && !v.isBoss) this.waveLeft = Math.max(0, this.waveLeft - 1);
    if (v.isBoss) {
      this.bossDown(v, att);
      if (!v.isMonster) this.releaseBoss(v, true); // 真人附身的 BOSS 被击杀：下甲回到清怪小队
    }
    let multi = 0;
    if (att && att !== v) {
      att.stats.k++; if (hs) att.stats.hs++;
      this.score[att.team]++;
      att.multi = this.time - att.lastKillT < 5 ? att.multi + 1 : 1;
      att.lastKillT = this.time; att.streak++;
      multi = att.multi;
    }
    v.streak = 0;
    this.events.push({ e: 'kill', a: att && att !== v ? att.id : 0, v: v.id, w: wid, hs: hs ? 1 : 0, wb: wall ? 1 : 0, m: multi, dx: round3(dir.x), dz: round3(dir.z) });
    this.rosterDirty = true;
  }
  endMatch() {
    this.state = 'end'; this.endAt = this.time + END_PAUSE;
    const win = this.score.BL === this.score.GR ? null : this.score.BL > this.score.GR ? 'BL' : 'GR';
    this.events.push({ e: 'end', win, score: { ...this.score }, next: END_PAUSE });
    this.rosterDirty = true;
  }

  // ---------- 网络输出 ----------
  roster() {
    const rows = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, team: p.team, k: p.stats.k, d: p.stats.d, hs: p.stats.hs, ping: p.ping,
      on: p.online ? 1 : 0, bot: p.isBot ? 1 : 0, prim: p.primary,
      boss: p.isBoss ? 2 : 0, kind: p.bossKind || null, bnm: p.isBoss ? ((BOSSES[p.bossKind] || {}).name || 'BOSS') : null, hp: p.isBoss ? Math.max(0, Math.ceil(p.hp)) : 0, hpMax: p.isBoss ? p.hpMax : 0,
    }));
    if (this.mode === 'pve') for (const m of this.monsters.values()) {
      rows.push({
        id: m.id, name: m.name, team: 'GR', k: 0, d: 0, hs: 0, ping: 0, on: 1, bot: 0, kind: m.kind, prim: m.primary,
        boss: m.isBoss ? 1 : 0, hp: m.isBoss ? Math.max(0, Math.ceil(m.hp)) : 0, hpMax: m.isBoss ? m.hpMax : 0,
      });
    }
    return rows;
  }
  dropList() { return this.drops.map((d) => [d.id, d.x, d.y, d.z]); }
  snapshotBase() {
    const ps = [];
    for (const p of this.entList()) {
      let f = 0;
      if (p.alive) f |= F.alive; if (p.crouch) f |= F.crouch; if (p.onGround) f |= F.ground;
      if (p.inv[p.slot]?.reloading) f |= F.reload; if (p.scoped) f |= F.scoped; if (p.protectT > 0) f |= F.protect; if (p.online) f |= F.online;
      ps.push([p.id, round2(p.pos.x), round2(p.pos.y), round2(p.pos.z), round3(p.yaw), round3(p.pitch + p.punchP), f, p.inv[p.slot]?.id || 'knife', round2(p.vel.x), round2(p.vel.z)]);
    }
    return {
      t: 'snap', st: round3(this.time), tick: this.tick, ps,
      nd: this.nades.map((n) => [n.id, round2(n.pos.x), round2(n.pos.y), round2(n.pos.z)]),
      sc: this.score, tl: round2(this.timeLeft), gs: this.state,
    };
  }
  broadcast() {
    const base = this.snapshotBase();
    const worldBytes = encodeWorld(base); // 世界快照只编码一次，所有连接共享同一份字节
    const ev = this.events.length ? this.events : null; this.events = [];
    const roster = this.rosterDirty || this.tick % (TICK_RATE * 2) === 0 ? this.roster() : null;
    this.rosterDirty = false;
    // 补给站就绪位与空投清单：变化时或每 5s 兜底重发一次（观战 / 中途加入者靠它对齐）
    let sup = null, dp = null;
    if (this.mode === 'pve' && (this.supDirty || this.tick % (TICK_RATE * 5) === 0)) {
      sup = this.supMask(); dp = this.dropList(); this.supDirty = false;
    }
    for (const p of this.players.values()) {
      if (p.isBot || !p.online || !p.sess || !p.sess.conn) continue;
      p.sess.sendBin(worldBytes);
      const ctl = { t: 'snap', tick: base.tick, st: base.st, me: packSelf(p) };
      if (ev) ctl.ev = ev;
      if (roster) ctl.roster = roster;
      if (sup !== null) { ctl.sup = sup; ctl.dp = dp; }
      p.sess.send(ctl);
    }
    for (const sp of this.spectators.values()) {
      if (!sp.sess.conn) continue;
      sp.sess.sendBin(worldBytes);
      const ctl = { t: 'snap', tick: base.tick, st: base.st, spect: 1 };
      if (ev) ctl.ev = ev;
      if (roster) ctl.roster = roster;
      if (sup !== null) { ctl.sup = sup; ctl.dp = dp; }
      sp.sess.send(ctl);
    }
  }
  welcome(p) {
    return { t: 'joined', room: this.info(), you: p.id, team: p.team, st: this.time, roster: this.roster(), me: packSelf(p), tickRate: TICK_RATE, sup: this.mode === 'pve' ? this.supMask() : 0, dp: this.mode === 'pve' ? this.dropList() : [] };
  }
}
