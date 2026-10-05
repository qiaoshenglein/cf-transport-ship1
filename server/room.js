// 权威对局房间：固定 30Hz 模拟、输入队列、延迟补偿命中判定、伤害 / 击杀 / 复活 / 比分 / 断线保留
import { WEAPONS, PRIMARIES } from '../src/weapons.js';
import { applyCmd, resetForSpawn, packSelf, shotDir, F } from '../src/netsim.js';
import { STAND_H, EYE_STAND } from '../src/movement.js';
import { boneMatrices, rayHitboxes, chestPoint } from '../src/hitbox.js';
import {
  TICK_RATE, MAX_REWIND, RECONNECT_GRACE, RESPAWN_TIME, PROTECT_TIME, MATCH_TIME,
  sanitizeCmd, otherTeam, round2, round3,
} from '../src/protocol.js';
import { loadMap } from './mapdata.js';

const DT = 1 / TICK_RATE;
const HISTORY = Math.ceil(1.0 * TICK_RATE);
const MAX_QUEUE = 120;          // 每个玩家最多缓存的输入条数
const BUDGET_CAP = 0.25;        // 允许的输入时间提前量（秒），超出视为加速作弊直接丢弃
const END_PAUSE = 10;           // 结算界面停留时间
const randInt = (n) => (Math.random() * n) | 0;

export class Room {
  constructor(id, o = {}) {
    this.id = id;
    this.name = String(o.name || `房间 ${id}`).slice(0, 24);
    this.goal = [30, 50, 100].includes(o.goal) ? o.goal : 50;
    this.max = Math.max(2, Math.min(16, o.max | 0 || 16));
    this.onEmpty = o.onEmpty || (() => {});
    const m = loadMap();
    this.world = m.world; this.spawns = m.spawns;
    this.players = new Map(); // id -> player
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
      p.stats = { k: 0, d: 0, hs: 0, shots: 0, hits: 0 };
      p.streak = 0; p.multi = 0; p.lastKillT = -99;
      this.spawn(p);
    }
    this.nades = [];
    this.rosterDirty = true;
  }
  info() {
    const t = this.teamCount();
    return { id: this.id, name: this.name, goal: this.goal, max: this.max, n: this.players.size, bl: t.BL, gr: t.GR, score: this.score, state: this.state, timeLeft: Math.round(this.timeLeft) };
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
    let team = o.team === 'BL' || o.team === 'GR' ? o.team : null;
    // 自动平衡：请求的阵营人数更多时分到另一边
    if (!team || c[team] > c[otherTeam(team)]) team = c.BL <= c.GR ? 'BL' : 'GR';
    const p = {
      id: this.nextId++, sess, name: sess.name, team,
      primary: PRIMARIES.includes(o.primary) ? o.primary : 'ak47', nextPrimary: null,
      pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
      radius: 0.36, height: STAND_H, stepHeight: 0.42, onGround: true, crouch: false, eyeH: EYE_STAND, jumpCD: 0,
      yaw: 0, pitch: 0, punchP: 0, punchY: 0, aimPunch: 0,
      hp: 100, armor: 100, alive: false, respawnT: 0, protectT: 0, life: 0,
      inv: [], slot: 0, lastSlot: 1, readyAt: 0, scoped: 0, scopeReady: false, scopeT: 0, reScope: 0, pendingThrow: 0, autoSwitchAt: 0,
      stats: { k: 0, d: 0, hs: 0, shots: 0, hits: 0 }, streak: 0, multi: 0, lastKillT: -99,
      queue: [], ack: 0, pt: 0, budget: 0.1, lastCmd: null, isPlayer: true,
      online: true, discAt: 0, ping: 0,
    };
    this.players.set(p.id, p);
    this.spawn(p);
    this.rosterDirty = true;
    this.events.push({ e: 'join', id: p.id, name: p.name, team: p.team });
    this.start();
    return p;
  }
  removePlayer(p, reason = 'leave') {
    if (!this.players.has(p.id)) return;
    this.players.delete(p.id);
    this.events.push({ e: 'leave', id: p.id, name: p.name, reason });
    this.rosterDirty = true;
    if (this.players.size === 0) { this.stop(); this.onEmpty(this); }
  }
  disconnect(p) {
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
    for (const p of list) {
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
    applyCmd(p, c, this.world, list, this.hooks || (this.hooks = this.makeHooks()));
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
    for (const p of this.players.values()) if (p.alive) poses.set(p.id, this.poseOf(p));
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
    for (const p of this.players.values()) {
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
    const dir = shotDir(a, spread, rnd);
    const D = [dir.x, dir.y, dir.z];
    const poses = this.posesAt(a.curVt);
    const targets = [];
    for (const v of this.players.values()) {
      if (!v.alive || v === a || v.team === a.team) continue;
      const pose = poses.get(v.id); if (!pose) continue;
      targets.push({ v, pose, M: boneMatrices(pose) });
    }
    const hits = this.world.raycastAll(o[0], o[1], o[2], D[0], D[1], D[2], d.range);
    let power = d.pen, mul = 1, wall = false, from = 0, endT = d.range, hitId = 0;
    for (let i = 0; i <= hits.length; i++) {
      const h = hits[i];
      const lim = h ? h.t : d.range;
      let best = null, bestT = lim, part = null;
      for (const tg of targets) {
        const r = rayHitboxes(tg.M, tg.pose, o, D, bestT);
        if (r && r.t > from - 0.01 && r.t < bestT) { best = tg.v; bestT = r.t; part = r.part; }
      }
      if (best) {
        const partMul = part === 'head' ? d.headMul : part === 'arm' || part === 'leg' ? d.limbMul : 1;
        const dmg = d.dmg * mul * Math.pow(d.falloff, bestT / 10) * partMul;
        endT = bestT; hitId = best.id;
        this.damage(best, a, dmg, part, d.id, dir, wall);
        break;
      }
      if (!h) break;
      if (h.collider.bullet === 'pen') {
        const cost = (h.exit - h.t) * (h.collider.mat === 'wood' ? 1.0 : 1.9);
        if (power > cost) { power -= cost; mul *= 0.6; wall = true; from = h.exit; continue; }
      }
      endT = h.t; break;
    }
    this.events.push({ e: 'shot', id: a.id, w: d.id, o: o.map(round2), d: D.map(round3), t: round2(endT), h: hitId });
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
      for (const v of this.players.values()) {
        if (!v.alive || v === a || v.team === a.team) continue;
        const pose = poses.get(v.id); if (!pose) continue;
        const r = rayHitboxes(boneMatrices(pose), pose, o, dir, range);
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
    for (const a of this.players.values()) {
      if (!a.alive) continue;
      if (a.team === owner.team && a !== owner) continue;
      const c = chestPoint(boneMatrices(this.poseOf(a)));
      const dx = c[0] - p.x, dy = c[1] - p.y, dz = c[2] - p.z, L = Math.hypot(dx, dy, dz);
      if (L > d.radius) continue;
      const dir = { x: dx / (L || 1), y: dy / (L || 1), z: dz / (L || 1) };
      const blocked = this.world.raycast(p.x, p.y + 0.2, p.z, dir.x, dir.y, dir.z, Math.max(0, L - 0.3), 'bullet');
      let dmg = d.dmg * Math.pow(1 - L / d.radius, 1.1);
      if (blocked) dmg *= 0.2;
      if (dmg > 1) this.damage(a, owner, dmg, 'chest', 'he', dir, false);
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
    v.alive = false; v.hp = 0; v.respawnT = RESPAWN_TIME; v.stats.d++; v.scoped = 0;
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
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, k: p.stats.k, d: p.stats.d, hs: p.stats.hs, ping: p.ping, on: p.online ? 1 : 0, prim: p.primary }));
  }
  snapshotBase() {
    const ps = [];
    for (const p of this.players.values()) {
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
    const ev = this.events; this.events = [];
    const roster = this.rosterDirty || this.tick % (TICK_RATE * 2) === 0 ? this.roster() : null;
    this.rosterDirty = false;
    for (const p of this.players.values()) {
      if (!p.online || !p.sess.conn) continue;
      const msg = { ...base, me: packSelf(p), ev };
      if (roster) msg.roster = roster;
      p.sess.send(msg);
    }
  }
  welcome(p) {
    return { t: 'joined', room: this.info(), you: p.id, team: p.team, st: this.time, roster: this.roster(), me: packSelf(p), tickRate: TICK_RATE };
  }
}
