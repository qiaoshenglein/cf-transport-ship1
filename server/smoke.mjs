// 冒烟测试：1) Room 逻辑直测（移动 / 命中伤害 / 击杀 / 复活 / 断线回收）  2) 网关端到端（ws 双客户端 + 票据重连）
// 运行：node server/smoke.mjs   （总时长 < 30s，超时自动失败）
import { Room } from './room.js';
import { packSelf, unpackSelf } from '../src/netsim.js';
import { BOSSES, BOSS_KINDS, bossHpScale } from './bosses.js';
import { WEAPONS, PRIMARIES } from '../src/weapons.js';
import { boneMatrices, rayHitboxes } from '../src/hitbox.js';
import { SIZE } from '../src/bosssize.js';
import { MAP_IDS, mapOf, suppliesForMap } from '../src/maps.js';
import { STAND_H } from '../src/movement.js';
import { B, RESPAWN_TIME, RECONNECT_GRACE, PROTO_VERSION, decodeWorld, encodeWorld, WTABLE } from '../src/protocol.js';

const DT = 1 / 30;
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};
const deadline = setTimeout(() => { console.log('FAIL: 超时'); process.exit(1); }, 28000);

// ---------------- 1. Room 逻辑 ----------------
console.log('[1] Room 逻辑直测');
{
  const mkSess = (name) => ({ name, conn: { readyState: 1 }, msgs: [], send(o) { this.msgs.push(o); }, sendBin() { } });
  const room = new Room('t1', { goal: 30, max: 8, onEmpty() {} });
  const sa = mkSess('A'), sb = mkSess('B');
  const a = room.addPlayer(sa, { team: 'BL', primary: 'ak47' });
  const b = room.addPlayer(sb, { team: 'GR', primary: 'm4a1' });
  room.stop(); // 手动步进

  ok(!!a && !!b && a.team === 'BL' && b.team === 'GR', '建房与双玩家加入');

  // 在甲板上找一个空地处 + 一条 >=10m 的直线通道
  const W = room.world;
  const dirs8 = [];
  for (let k = 0; k < 8; k++) dirs8.push([Math.sin((k * Math.PI) / 4), Math.cos((k * Math.PI) / 4)]);
  const origins = [];
  for (const t of ['BL', 'GR']) for (const sp of room.spawns[t]) origins.push([sp.x, sp.z]);
  for (const x of [-30, -20, -10, 0, 10, 20, 30]) for (const z of [0, -9, 9]) origins.push([x, z]);
  let lane = null;
  outer: for (const [ox, oz] of origins) {
    if (W.blocked(ox, 0.06, oz, 0.5, 1.8)) continue; // 站位必须空旷
    for (const [mx, mz] of dirs8) {
      let free = true;
      for (const h of [0.6, 1.62]) if (W.raycast(ox, h, oz, mx, 0, mz, 12, 'move')) { free = false; break; }
      if (free) { lane = { ox, oz, mx, mz }; break outer; }
    }
  }
  ok(!!lane, '找到甲板直线通道', JSON.stringify(lane));

  // 移动：A 传送到通道起点，沿通道前进 3 秒（forward = (-sin y, -cos y) = (mx, mz)）
  const yaw = Math.atan2(-lane.mx, -lane.mz);
  a.pos.x = lane.ox; a.pos.z = lane.oz; a.pos.y = 0.02; a.vel.x = a.vel.y = a.vel.z = 0;
  b.pos.x = lane.ox + lane.mx * 5.5; b.pos.z = lane.oz + lane.mz * 5.5; b.pos.y = 0.02; b.vel.x = b.vel.y = b.vel.z = 0;
  b.protectT = 0;
  const x0 = a.pos.x, z0 = a.pos.z;
  let s = 1;
  for (let i = 0; i < 90; i++) {
    a.queue.push({ s: s++, d: DT, y: yaw, p: 0, f: 1, r: 0, b: 0, w: -1, vt: 0 });
    room.step();
  }
  const moved = Math.hypot(a.pos.x - x0, a.pos.z - z0);
  ok(moved > 3, '移动同步：3 秒前进距离 > 3m', `实际 ${moved.toFixed(2)}`);
  ok(a.ack === s - 1, '输入确认推进', `ack=${a.ack}`);

  // 射击：B 在 A 前方通道上，A 瞄准连发
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  const horiz = Math.hypot(dx, dz) || 1;
  ok(horiz > 0.2 && horiz < 8, '目标在射程内', `距离 ${horiz.toFixed(2)}`);
  const yaw2 = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(b.pos.y + 1.4 - (a.pos.y + a.eyeH), horiz);
  let steps = 0;
  for (let i = 0; i < 30 * 4 && b.alive; i++) {
    const bit = i === 0 ? B.fire | B.fireP : B.fire;
    a.queue.push({ s: s++, d: DT, y: yaw2, p: pitch, f: 0, r: 0, b: bit, w: -1, vt: room.time });
    room.step(); steps++;
  }
  ok(!b.alive, '射击判定：B 被击杀', `${steps} 帧 · B hp=${b.hp.toFixed(1)}`);
  ok(room.score.BL >= 1 && a.stats.k >= 1, '击杀计入比分');
  const killEv = sa.msgs.flatMap((m) => m.ev || []).find((e) => e.e === 'kill' && e.v === b.id);
  ok(!!killEv && killEv.a === a.id, 'kill 事件下发', JSON.stringify(killEv));

  // 复活
  for (let i = 0; i < (RESPAWN_TIME + 0.5) * 30; i++) { a.queue.push({ s: s++, d: DT, y: yaw2, p: 0, f: 0, r: 0, b: 0, w: -1, vt: 0 }); room.step(); }
  ok(b.alive, '按时复活');
  ok(room.players.size === 2, '玩家仍在');

  // 断线 -> 站立 -> 超时回收
  const pid = b.id;
  room.disconnect(b);
  for (let i = 0; i < 30; i++) { a.queue.push({ s: s++, d: DT, y: a.yaw, p: 0, f: 0, r: 0, b: 0, w: -1, vt: 0 }); room.step(); }
  ok(!b.online && room.players.has(pid), '断线后席位保留');
  room.reconnect(b);
  ok(b.online, '宽限期内重连恢复');
  b.discAt = -RECONNECT_GRACE - 1; b.online = false;
  room.step();
  ok(!room.players.has(pid), '超时未重连自动回收');
  ok(room.players.size === 1, '房间剩余玩家正确');
  room.stop();
}

// ---------------- 1b. 反作弊：自瞄瞬移检测 ----------------
console.log('[1b] 反作弊：开火瞬瞄检测与静默');
{
  const mk = (name) => ({ name, conn: { readyState: 1 }, msgs: [], send(o) { this.msgs.push(o); }, sendBin() { } });
  const room = new Room('tc', { goal: 30, max: 8, onEmpty() { } });
  const sx = mk('X');
  const x = room.addPlayer(sx, { team: 'BL', primary: 'ak47' });
  room.stop();
  x.protectT = 0; x.readyAt = 0;
  // 6 条相邻 yaw 跳变 >0.25rad 的开火命令应触发瞬瞄判定
  let s = 1; let y = 0;
  for (let i = 0; i < 8; i++) { y += 0.6; x.queue.push({ s: s++, d: DT, y, p: 0, f: 0, r: 0, b: i === 0 ? (B.fire | B.fireP) : B.fire, w: -1, vt: room.time }); room.step(); }
  ok(x.aimBanUntil > room.time, '瞬瞄触发开火禁令', `ban=${x.aimBanUntil?.toFixed?.(2)}`);
  ok(sx.msgs.flatMap((m) => m.ev || []).some((e) => e.e === 'aim_suspect'), '下发 aim_suspect 事件');

  // 禁令窗口内：稳定开火不应产生任何新射击（fire 位被服务端清除）
  const shotsBefore = x.stats.shots;
  for (let i = 0; i < 45; i++) { x.queue.push({ s: s++, d: DT, y, p: 0, f: 0, r: 0, b: B.fire, w: -1, vt: room.time }); room.step(); } // 1.5s < AIM_BAN(4s)
  ok(x.stats.shots === shotsBefore, '禁令期间开火被静默（无新射击）', `+${x.stats.shots - shotsBefore}`);

  // 禁令到期后恢复开火能力
  x.aimBanUntil = 0; x.snapN = 0; x.inv[0].nextFire = 0; x.readyAt = 0;
  const shots2 = x.stats.shots;
  for (let i = 0; i < 6; i++) { x.queue.push({ s: s++, d: DT, y, p: 0, f: 0, r: 0, b: B.fire, w: -1, vt: room.time }); room.step(); }
  ok(x.stats.shots > shots2, '禁令到期后恢复开火', `+${x.stats.shots - shots2}`);
  room.stop();
}

// ---------------- 2. 网关端到端 ----------------
console.log('[2] 网关端到端（ws）');
{
  const { WebSocket } = await import('ws');
  process.env.PORT = '0'; process.env.HOST = '127.0.0.1';
  const mod = await import('./index.js');
  let port = 0;
  for (let i = 0; i < 50 && !port; i++) { port = mod.boundPort(); if (!port) await new Promise((r) => setTimeout(r, 50)); }
  console.log('  测试端口', port);

  class Cli {
    constructor(tag) {
      this.tag = tag; this.inbox = []; this.worlds = new Map();
      this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      this.ready = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
      this.ws.on('message', (d, isBinary) => {
        if (isBinary) { const w = decodeWorld(d); if (w) this.worlds.set(w.tick, w); return; }
        let m; try { m = JSON.parse(d.toString()); } catch (e) { return; }
        if (m.t === 'snap') { const w = this.worlds.get(m.tick); if (w) { this.worlds.delete(m.tick); m = Object.assign({}, w, m); } }
        this.inbox.push(m);
      });
    }
    async send(o) { await this.ready; this.ws.send(JSON.stringify(o)); }
    async until(pred, ms = 5000, what = '') {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const m = this.inbox.find(pred); if (m) { this.inbox = this.inbox.filter((x) => x !== m); return m; } await new Promise((r) => setTimeout(r, 20)); }
      throw new Error(`${this.tag} 等待超时: ${what}`);
    }
  }
  const A = new Cli('A'), Bc = new Cli('B');
  await A.send({ t: 'hello', proto: PROTO_VERSION, name: '玩家甲' });
  await A.until((m) => m.t === 'hi');
  await A.send({ t: 'create', name: '测试房', goal: 30, max: 8 });
  const jA = await A.until((m) => m.t === 'joined');
  ok(jA && jA.you && jA.room && jA.roster && jA.ticket, 'A 建房并收到 joined 欢迎包');
  const rid = jA.room.id;

  await Bc.send({ t: 'hello', proto: PROTO_VERSION, name: '玩家乙' });
  await Bc.send({ t: 'quick' });
  const jB = await Bc.until((m) => m.t === 'joined');
  ok(jB && jB.room.id === rid && jB.roster.length === 2, 'B 快速匹配进入同一房间');

  // A 向 B 发送输入：前进
  const seq0 = 1;
  for (let i = 0; i < 45; i++) {
    await A.send({ t: 'cmd', list: [{ s: seq0 + i, d: DT, y: 0, p: 0, f: 1, r: 0, b: 0, w: -1, vt: jA.st }] });
    await new Promise((r) => setTimeout(r, 20));
  }
  const snap1 = await A.until((m) => m.t === 'snap' && m.me && m.me.ack > 0, 4000, 'acked snap');
  ok(!!snap1.ps && snap1.ps.length === 2, '快照包含两名玩家');
  ok(snap1.me.ack > 0, '服务端确认输入', `ack=${snap1.me.ack}`);
  // 二进制世界帧独立解码校验：世界快照里“自己”的坐标应与控制帧 me 坐标在量化精度内吻合
  const self = snap1.ps.find((r) => r[0] === jA.you);
  ok(!!self && Math.abs(self[1] - snap1.me.x) < 0.02 && Math.abs(self[3] - snap1.me.z) < 0.02,
    '二进制解码坐标与控制帧一致', self ? `dx=${(self[1] - snap1.me.x).toFixed(3)} dz=${(self[3] - snap1.me.z).toFixed(3)}` : 'no self row');
  ok(typeof self?.[7] === 'string' && self[7].length > 0, '武器 ID 经索引表还原为字符串', String(self?.[7]));

  // 观战席位
  const C = new Cli('C');
  await C.send({ t: 'hello', proto: PROTO_VERSION, name: '观战者' });
  await C.send({ t: 'spectate', rid });
  const sp = await C.until((m) => m.t === 'spectating', 4000, 'spectating');
  ok(sp && sp.room && sp.room.n === 2 && Array.isArray(sp.roster) && sp.roster.length === 2, '观战者收到欢迎包');
  const spSnap = await C.until((m) => m.t === 'snap' && m.spect === 1 && m.ps.length === 2, 4000, 'spect snap');
  ok(!spSnap.me, '观战快照不含个人状态');

  // 断线 -> 票据重连
  A.ws.close();
  await new Promise((r) => setTimeout(r, 300));
  const A2 = new Cli('A2');
  await A2.send({ t: 'hello', proto: PROTO_VERSION, name: '玩家甲', ticket: jA.ticket });
  const jr = await A2.until((m) => m.t === 'joined', 4000, 'rejoin');
  ok(jr && jr.you === jA.you, '票据重连取回席位');
  const onEv = await Bc.until((m) => m.t === 'snap' && (m.ev || []).some((e) => e.e === 'rejoin'), 3000, 'rejoin 事件');
  ok(!!onEv, 'B 收到 rejoin 事件');

  // 状态连续：重连后 me 位置与断线前同量级（未被传送回出生点）
  ok(Math.hypot(jr.me.x - jA.me.x, jr.me.z - jA.me.z) < 80, '重连后位置连续');

  await A2.send({ t: 'bot', a: 'add', team: 'GR', diff: 'normal' });
  const botRoster = await A2.until((m) => m.t === 'snap' && m.roster && m.roster.some((r) => r.bot), 4000, 'bot roster');
  ok(!!botRoster, '房主添加机器人并进入名册');
  await Bc.send({ t: 'bot', a: 'add', team: 'BL' });
  const rj = await Bc.until((m) => m.t === 'err' && /房主/.test(m.m || ''), 3000, 'non-host err');
  ok(!!rj, '非房主管理机器人被拒');

  C.ws.close(); // 观战者断开：席位释放且不回收房间（仍有玩家）
  await new Promise((r) => setTimeout(r, 300));
  await A2.send({ t: 'leave' });
  await Bc.send({ t: 'leave' });
  await new Promise((r) => setTimeout(r, 400));
  const rooms = await fetch(`http://127.0.0.1:${port}/api/rooms`).then((r) => r.json());
  ok(Array.isArray(rooms) && rooms.length === 0, '全员离开后房间自动回收');
  const health = await fetch(`http://127.0.0.1:${port}/healthz`).then((r) => r.text());
  ok(health === 'ok', '/healthz 正常');
  const page = await fetch(`http://127.0.0.1:${port}/`);
  ok(page.status === 200 || page.status === 503, 'HTTP 首页应答', String(page.status));

  // PVE 端到端：建房 -> 真人归 BL -> 名册与世界帧含怪
  const P = new Cli('P');
  await P.send({ t: 'hello', proto: PROTO_VERSION, name: '挑战者' });
  await P.until((m) => m.t === 'hi');
  await P.send({ t: 'create', name: 'PVE 房', goal: 100, max: 8, mode: 'pve', diff: 'hell' });
  const jp = await P.until((m) => m.t === 'joined', 5000, 'pve joined');
  ok(jp.team === 'BL' && jp.room.mode === 'pve' && jp.room.diff === 'hell', 'PVE 建房：真人强制 BL 并回传模式/难度');
  const monSnap = await P.until((m) => m.t === 'snap' && m.roster && m.roster.some((r) => r.kind), 9000, 'pve monster roster');
  ok(!!monSnap, 'PVE 名册下发怪物行');
  ok(monSnap.ps.some((r) => r[0] === monSnap.roster.find((x) => x.kind).id), '二进制世界帧含怪物实体');
  const pRooms = await fetch(`http://127.0.0.1:${port}/api/rooms`).then((r) => r.json());
  ok(pRooms.some((r) => r.mode === 'pve' && r.wave >= 1), '/api/rooms 暴露 PVE 波次');
  await P.send({ t: 'boss', a: 'take' });
  const bossErr = await P.until((m) => m.t === 'err' && /BOSS/.test(m.m || ''), 3000, 'boss take err');
  ok(!!bossErr, '无 BOSS 时附身被拒（指令已路由）');
  await P.send({ t: 'leave' });
  await new Promise((r) => setTimeout(r, 200));
  for (const c of [A, Bc, A2, P]) { try { c.ws.close(); } catch (e) { /* 忽略 */ } }
}

// ---------------- 3. 新增武器：二进制表往返 + 霰弹枪多弹丸 ----------------
console.log('[3] 新增武器');
{
  ok(WTABLE.indexOf('ak47') === 0 && WTABLE.indexOf('knife') === 5, 'WTABLE 旧索引未变（向后兼容）');
  const world = { tick: 7, st: 1.0, tl: 0, gs: 'play', sc: { BL: 0, GR: 0 }, nd: [],
    ps: [[1, 5, 0.02, 7, 0.5, 0.1, 0, 'm249', 0, 0], [2, 6, 0.02, 8, -0.5, 0.2, 0, 'm3', 0, 0], [3, 7, 0.02, 9, 0, 0, 0, 'thompson', 0, 0]] };
  const ids = decodeWorld(encodeWorld(world)).ps.map((r) => r[7]);
  ok(ids.join(',') === 'm249,m3,thompson', '新武器 ID 经二进制表往返', JSON.stringify(ids));

  const mk = (name) => ({ name, conn: { readyState: 1 }, msgs: [], send(o) { this.msgs.push(o); }, sendBin() { } });
  const room = new Room('t3', { goal: 30, max: 8, onEmpty() { } });
  const sa = mk('A'), sb = mk('B');
  const a = room.addPlayer(sa, { team: 'BL', primary: 'm3' });
  const b = room.addPlayer(sb, { team: 'GR', primary: 'm4a1' });
  room.stop();
  a.pos.x = 0; a.pos.z = 0; a.pos.y = 0.02;
  b.pos.x = 0; b.pos.z = 2.5; b.pos.y = 0.02;
  a.protectT = b.protectT = 0; a.readyAt = 0; b.readyAt = 0;
  const yaw = Math.PI, pitch = Math.atan2(1.4 - (a.pos.y + a.eyeH), 2.5);
  for (let i = 0; i < 4; i++) { a.queue.push({ s: i + 1, d: DT, y: yaw, p: pitch, f: 0, r: 0, b: 0, w: -1, vt: room.time }); room.step(); }
  const hp0 = b.hp;
  // 连续按住开火约 3 秒（rpm 90 → 多轮霰弹齐射），近距离几乎必中
  let s = 10;
  for (let i = 0; i < 90 && b.alive; i++) {
    a.queue.push({ s: s++, d: DT, y: yaw, p: pitch, f: 0, r: 0, b: i === 0 ? (B.fire | B.fireP) : B.fire, w: -1, vt: room.time });
    room.step();
  }
  ok(b.hp < hp0, '霰弹枪近距离造成伤害', `hp ${hp0}->${b.hp.toFixed(1)}`);
  const shot = sa.msgs.flatMap((m) => m.ev || []).find((e) => e.e === 'shot' && e.id === a.id);
  ok(!!shot && shot.p === 8, '霰弹枪 shot 事件带 8 弹丸', JSON.stringify(shot));
  room.stop();
}

// ---------------- 4. 机器人 AI 与生命周期 ----------------
console.log('[4] 机器人 AI');
{
  const mk = (n) => ({ name: n, conn: { readyState: 1 }, msgs: [], send(o) { this.msgs.push(o); }, sendBin() { } });
  let emptied = false;
  const room = new Room('t4', { goal: 30, max: 8, onEmpty() { emptied = true; } });
  const sh = mk('H');
  const h = room.addPlayer(sh, { team: 'BL', primary: 'ak47' });
  const bot = room.addBot({ team: 'GR', primary: 'ak47', diff: 'hell' });
  room.stop();
  ok(!!bot && room.botCount() === 1 && room.players.size === 2, '机器人加入并计入人数');
  const rb = room.roster().find((r) => r.id === bot.id);
  ok(!!rb && rb.bot === 1 && rb.team === 'GR', '名册标注机器人 (bot=1)');

  // 导航：置于 GR 出生点，跑 2 秒应自主移动（寻路前往目标）
  h.alive = bot.alive = true; h.protectT = bot.protectT = 0;
  const gsp = room.spawns.GR[0];
  bot.pos.x = gsp.x; bot.pos.z = gsp.z; bot.pos.y = 0.02; bot.brain.reset(bot);
  const bx0 = bot.pos.x, bz0 = bot.pos.z;
  for (let i = 0; i < 60; i++) room.step();
  ok(Math.hypot(bot.pos.x - bx0, bot.pos.z - bz0) > 0.8, '机器人自主导航移动', `d=${Math.hypot(bot.pos.x - bx0, bot.pos.z - bz0).toFixed(2)}`);

  // 交战：找一条 ≥4.5m 开阔视线，对置 bot 与敌对玩家，bot 应转向开火并造成伤害
  const W = room.world;
  let site = null;
  outer: for (let x = -24; x <= 24; x += 3) for (let z = -8; z <= 8; z += 2) {
    if (W.blocked(x, 0.06, z, 0.5, 1.8)) continue;
    for (const [mx, mz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      if (W.blocked(x + mx * 4.5, 0.06, z + mz * 4.5, 0.5, 1.8)) continue;
      let clear = true;
      for (const hy of [1.4, 1.0]) if (W.raycast(x, hy, z, mx, 0, mz, 4.5, 'sight')) { clear = false; break; }
      if (clear) { site = { x, z, mx, mz }; break outer; }
    }
  }
  ok(!!site, '找到开阔交战视线', JSON.stringify(site));
  if (site) {
    bot.pos.x = site.x; bot.pos.z = site.z; bot.pos.y = 0.02;
    h.pos.x = site.x + site.mx * 4.5; h.pos.z = site.z + site.mz * 4.5; h.pos.y = 0.02;
    h.alive = true; h.hp = 100; h.armor = 100; h.protectT = 0; bot.protectT = 0; bot.brain.reset(bot);
    for (let i = 0; i < 150 && h.alive && bot.alive; i++) room.step();
    ok(bot.stats.shots > 0, '机器人发现敌人并开火', `shots=${bot.stats.shots}`);
    ok(h.hp < 100, '机器人对玩家造成伤害', `hp=${h.hp.toFixed(1)}`);
  }

  // 生命周期：击杀 bot 后应在 RESPAWN_TIME 复活
  if (bot.alive) room.damage(bot, h, 999, 'head', 'ak47', { x: 1, y: 0, z: 0 }, false);
  ok(!bot.alive, '机器人可被击杀');
  for (let i = 0; i < (RESPAWN_TIME + 0.6) * 30; i++) room.step();
  ok(bot.alive, '机器人按时复活');

  // 房间回收：最后一名真人离开即回收（机器人不阻止回收）
  room.removePlayer(h, 'leave');
  ok(emptied && room.humanPlayers().length === 0, '真人走光后房间回收（机器人不阻止）');
  room.stop();
}

// ---------------- 5. PVE：波次 / 怪物 AI / 计分 / 回收 ----------------
console.log('[5] PVE 波次与怪物');
{
  const mk = (n) => ({ name: n, conn: { readyState: 1 }, msgs: [], send(o) { this.msgs.push(o); }, sendBin() { } });
  let emptied = false;
  const room = new Room('t5', { goal: 100, max: 8, mode: 'pve', diff: 'normal', onEmpty() { emptied = true; } });
  const sh = mk('H');
  const h = room.addPlayer(sh, { team: 'GR', primary: 'ak47' }); // 请求 GR 也应被并入清怪小队
  room.stop();
  ok(room.mode === 'pve' && h.team === 'BL', 'PVE 真人强制同队 (BL)');

  for (let i = 0; i < 90; i++) room.step(); // 3s：首波（重置后 2s 起刷）
  ok(room.wave === 1 && room.monsters.size > 0, '第一波按时刷出', `wave=${room.wave} 怪=${room.monsters.size}`);
  const evs = sh.msgs.flatMap((m) => m.ev || []);
  const waveEv = evs.find((e) => e.e === 'wave');
  ok(!!waveEv && waveEv.n === 1 && waveEv.total >= 7, '下发 wave 事件', JSON.stringify(waveEv));

  const m0 = [...room.monsters.values()][0];
  const rr = room.roster().find((r) => r.id === m0.id);
  ok(!!rr && rr.kind === m0.kind && rr.team === 'GR' && rr.bot === 0, '名册标注怪物 kind');
  ok(room.snapshotBase().ps.some((p) => p[0] === m0.id), '世界快照含怪物实体');

  const mx0 = m0.pos.x, mz0 = m0.pos.z;
  for (let i = 0; i < 60; i++) room.step();
  ok(Math.hypot(m0.pos.x - mx0, m0.pos.z - mz0) > 0.5, '怪物自主扑向人类（导航移动）', `d=${Math.hypot(m0.pos.x - mx0, m0.pos.z - mz0).toFixed(2)}`);

  // 交战：在甲板上找一条 3m 开阔视线，直接走权威射击管线
  const W = room.world;
  let site = null;
  outer: for (let x = -24; x <= 24; x += 3) for (let z = -8; z <= 8; z += 2) {
    if (W.blocked(x, 0.06, z, 0.5, 1.8)) continue;
    for (const [mx, mz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      if (W.blocked(x + mx * 3, 0.06, z + mz * 3, 0.5, 1.8)) continue;
      let clear = true;
      for (const hy of [1.4, 1.0]) if (W.raycast(x, hy, z, mx, 0, mz, 3, 'sight')) { clear = false; break; }
      if (clear) { site = { x, z, mx, mz }; break outer; }
    }
  }
  ok(!!site, '找到开阔交战视线', JSON.stringify(site));
  if (site) {
    const aim = (sh2, tx, tz) => {
      sh2.pos.x = site.x; sh2.pos.z = site.z; sh2.pos.y = 0.02; sh2.vel.x = sh2.vel.y = sh2.vel.z = 0;
      sh2.curVt = room.time; sh2.punchP = sh2.punchY = 0; sh2.inv[0].nextFire = 0;
      const dx = tx - sh2.pos.x, dz = tz - sh2.pos.z;
      sh2.yaw = Math.atan2(-dx, -dz);
      sh2.pitch = Math.atan2(1.4 - (sh2.pos.y + sh2.eyeH), Math.hypot(dx, dz));
    };
    const place = (p, x, z) => { p.pos.x = x; p.pos.z = z; p.pos.y = 0.02; p.vel.x = p.vel.y = p.vel.z = 0; p.alive = true; p.protectT = 0; };
    // 只留 m0 参战：其余走正常死亡流程清场（波次配额随之同步）
    for (const mm of [...room.monsters.values()]) if (mm !== m0 && mm.alive) room.damage(mm, h, 9999, 'chest', 'ak47', { x: 1, y: 0, z: 0 }, false);

    // 怪物 → 真人：伤害生效且经过 dmgScale 缩放
    place(h, site.x + site.mx * 3, site.z + site.mz * 3);
    h.hp = 100; h.armor = 100;
    aim(m0, h.pos.x, h.pos.z);
    room.recordHistory();
    const hp0 = h.hp;
    room.fire(m0, m0.inv[0], 0, () => 0);
    ok(h.hp < hp0 && h.hp > 55, '怪物对真人造成伤害（已缩放）', `hp ${hp0}->${h.hp.toFixed(1)}`);

    // 怪物不会殃及同类（同阵营跳过命中）
    const m1 = room.spawnMonster('infected');
    place(h, room.spawns.BL[0].x, room.spawns.BL[0].z);
    place(m1, site.x + site.mx * 3, site.z + site.mz * 3);
    aim(m0, m1.pos.x, m1.pos.z);
    room.recordHistory();
    const mh0 = m1.hp;
    room.fire(m0, m0.inv[0], 0, () => 0);
    ok(m1.hp === mh0, '怪物友军伤害关闭', `hp ${mh0}->${m1.hp.toFixed(1)}`);

    // 真人击杀怪物 → BL 比分 + 波次配额递减 + 尸体按时移除
    const wl0 = room.waveLeft;
    room.damage(m1, h, 9999, 'chest', 'ak47', { x: 1, y: 0, z: 0 }, false);
    ok(!m1.alive && room.score.BL >= 1 && h.stats.k >= 1, '击杀怪物计入 BL 比分', `BL=${room.score.BL}`);
    ok(room.waveLeft === Math.max(0, wl0 - 1), '波次配额随击杀递减', `${wl0}->${room.waveLeft}`);
    for (let i = 0; i < 80; i++) room.step();
    ok(!room.monsters.has(m1.id), '怪物尸体按时移除');
  }

  // 清空本波 → 喘息后进入第二波
  for (const m of [...room.monsters.values()]) if (m.alive) room.damage(m, h, 9999, 'chest', 'ak47', { x: 1, y: 0, z: 0 }, false);
  for (let i = 0; i < 240 && room.wave < 2; i++) room.step();
  ok(room.wave === 2 && room.monsters.size > 0, '清场后进入第二波', `wave=${room.wave} 怪=${room.monsters.size}`);

  // 时间耗尽结束本轮；结算后自动开新一轮并清空怪物
  room.timeLeft = 0.01;
  room.step();
  ok(room.state === 'end', '时间耗尽结束本轮');
  for (let i = 0; i < 330 && room.state !== 'play'; i++) room.step();
  ok(room.state === 'play' && room.wave === 0 && room.monsters.size === 0 && room.score.BL === 0, '结算后重置新一轮并清空怪物');

  // 回收：怪物不阻止房间回收
  room.removePlayer(h, 'leave');
  ok(emptied && room.humanPlayers().length === 0, 'PVE 真人走光后房间回收');
  room.stop();
}

// ---------------- 6. PVE BOSS 与补给 ----------------
console.log('[6] PVE BOSS 与补给');
{
  const mk = (n) => ({ name: n, conn: { readyState: 1 }, msgs: [], send(o) { this.msgs.push(o); }, sendBin() { } });
  const room = new Room('t6', { goal: 100, max: 8, mode: 'pve', diff: 'normal', onEmpty() { } });
  const sh = mk('H');
  const h = room.addPlayer(sh, { primary: 'ak47' });
  room.stop();
  room.bossAtWave = 1;                       // 让 BOSS 在第一波就登场
  const S = room.supplies;
  const evAll = () => sh.msgs.flatMap((m) => m.ev || []);
  const clearEv = () => { sh.msgs.length = 0; };
  const put = (p, x, z) => { p.pos.x = x; p.pos.z = z; p.pos.y = 0.02; p.vel.x = p.vel.y = p.vel.z = 0; p.protectT = 0; p.alive = true; };
  const mask = () => { let b = 0; for (let i = 0; i < S.length; i++) if (room.time >= S[i].readyAt) b |= 1 << i; return b; };

  for (let i = 0; i < 90; i++) room.step();
  const boss = room.aliveBoss();
  ok(!!boss && boss.isBoss, '按排期刷出 BOSS', boss ? boss.kind : 'none');
  ok(evAll().some((e) => e.e === 'bossin' && e.hp > 0), '下发 bossin 事件带血量');
  const broRow = room.roster().find((r) => r.boss === 1);
  ok(!!broRow && broRow.hpMax === boss.hpMax && broRow.team === 'GR', '名册标出 BOSS 行与血量上限');
  ok(boss.hpMax === Math.round(BOSSES[boss.kind].hp * bossHpScale(room.wave)), 'BOSS 血量 = 基础值 × 波次缩放', `${boss.hpMax}`);

  // 三种 BOSS 各自的技能都要真的放出来：先在甲板上找一条 20m 开阔视线
  const W6 = room.world;
  const dirs6 = [];
  for (let k = 0; k < 8; k++) dirs6.push([Math.sin((k * Math.PI) / 4), Math.cos((k * Math.PI) / 4)]);
  let lane = null;
  outer6: for (const ox of [-24, -16, -8, 0, 8]) for (const oz of [0, -7, 7]) {
    if (W6.blocked(ox, 0.06, oz, 0.6, 1.8)) continue;
    for (const [mx, mz] of dirs6) {
      let clear = true;
      for (const t of [4, 10, 16, 20]) for (const hy of [1.0, 1.4]) if (W6.raycast(ox, hy, oz, mx, 0, mz, t, 'sight')) { clear = false; break; }
      if (clear) { lane = { ox, oz, mx, mz }; break outer6; }
    }
  }
  ok(!!lane, '找到 BOSS 技能测试走廊', JSON.stringify(lane));
  if (lane) for (const kind of BOSS_KINDS) {
    for (const m of [...room.monsters.values()]) room.monsters.delete(m.id);
    room.pending.length = 0;
    const b2 = room.spawnMonster(kind);
    const site = kind === 'shade' ? 20 : kind === 'tyran' ? 12 : 10;
    put(b2, lane.ox, lane.oz);
    b2.yaw = Math.atan2(-lane.mx, -lane.mz);      // 出生即朝向走廊正方向
    b2.brain.curYaw = b2.yaw;
    put(h, lane.ox + lane.mx * site, lane.oz + lane.mz * site);
    h.hp = 1e9; h.hpMax = 1e9; h.armor = 100;   // 技能窗口内不让"靶子"死掉
    clearEv();
    for (let i = 0; i < 320 && b2.alive; i++) room.step();
    const acts = new Set(evAll().filter((e) => e.e === 'boss').map((e) => e.a));
    const want = BOSSES[kind].ability;
    ok(acts.has(want), `${BOSSES[kind].name} 放出 ${want} 技能`, [...acts].join(','));
    if (want !== 'blink') ok(evAll().some((e) => e.e === 'blast'), `${BOSSES[kind].name} 的范围伤害落地`, [...acts].join(','));
  }
  h.hp = 100; h.hpMax = 100;

  // AI BOSS 近身巨爪：贴脸（2.2m）时会挥出专属近战（走 bossclaw 判定，不是枪）
  if (lane) {
    for (const m of [...room.monsters.values()]) room.monsters.delete(m.id);
    room.pending.length = 0;
    const bc = room.spawnMonster('tyran');
    put(bc, lane.ox, lane.oz);
    bc.yaw = Math.atan2(-lane.mx, -lane.mz); bc.brain.curYaw = bc.yaw;
    put(h, lane.ox + lane.mx * 2.2, lane.oz + lane.mz * 2.2);
    h.hp = 1e9; h.hpMax = 1e9; h.armor = 100;   // 别被一爪打死，多观察几 tick
    clearEv();
    for (let i = 0; i < 90 && bc.alive; i++) room.step();
    ok(evAll().some((e) => e.e === 'melee' && e.w === 'bossclaw'), 'AI BOSS 贴脸挥出专属巨爪（melee 事件带 bossclaw）',
      [...new Set(evAll().filter((e) => e.e === 'melee').map((e) => e.w))].join(',') || '无近战');
    h.hp = 100; h.hpMax = 100;
  }

  // 补给站：弹药 / 医疗（溢出转护甲）/ 冷却 / 无效不消耗
  const sAmmo = S.find((s) => s.kind === 'ammo'), sMed = S.find((s) => s.kind === 'med');
  for (const m of [...room.monsters.values()]) room.monsters.delete(m.id);
  put(h, sAmmo.x, sAmmo.z);
  h.inv[0].mag = 3; h.inv[0].reserve = 5; h.hp = 100; h.armor = 100;
  clearEv();
  room.step();
  ok(h.inv[0].mag === h.inv[0].def.mag && h.inv[0].reserve === h.inv[0].def.reserve, '弹药箱补满弹匣与备弹');
  ok(evAll().some((e) => e.e === 'sup' && e.k === 'ammo'), '下发 sup 事件');
  ok((mask() & (1 << sAmmo.i)) === 0, '补给站进入冷却');
  const m0 = mask();
  room.step();
  ok(mask() === m0, '满弹时不再重复消耗补给');
  put(h, sMed.x, sMed.z);
  h.hp = 30; h.armor = 0;
  room.step();
  ok(h.hp === 90 && h.armor === 0, '医疗包回复 60 点生命', `hp=${h.hp}`);
  h.hp = 100; h.armor = 0;
  S[sMed.i].readyAt = 0;
  room.step();
  ok(h.armor === 25, '满血时过量治疗转护甲', `ar=${h.armor}`);

  // 真人附身 BOSS
  for (const m of [...room.monsters.values()]) room.monsters.delete(m.id);
  put(h, h.pos.x, h.pos.z); h.hp = 100; h.armor = 100; h.hpMax = 100;
  const b3 = room.spawnMonster('tyran');
  const pool = b3.hp;
  clearEv();
  ok(room.takeBoss(h) === h, '真人成功附身 BOSS');
  room.step();   // 事件要靠一次 broadcast 才落到连接上
  ok(!room.aliveBoss() && room.possessId === h.id && h.isBoss && h.team === 'GR', 'BOSS 交棒：AI 实体消失、玩家转 GR 阵营');
  ok(h.hp === h.hpMax && h.hpMax === pool && h.inv[0].id === 'm249', '附身后继承 BOSS 血量与重武器', `hp=${h.hp}/${h.hpMax}`);
  ok(evAll().some((e) => e.e === 'possess' && e.id === h.id), '下发 possess 事件');
  const pe = evAll().find((e) => e.e === 'possess');
  ok(pe && pe.prim === 'm249', 'possess 事件带回 BOSS 武器（客户端要换装）');
  // BOSS 专属近战：附身后近战槽换成巨爪，且按巨爪结算伤害
  ok(h.inv[2].id === 'bossclaw', '附身 BOSS 的近战槽换成专属巨爪', h.inv[2].id);
  ok(pe && pe.mel === 'bossclaw', 'possess 事件带回专属近战（客户端要换装）');
  ok(WEAPONS.bossclaw.dmgHeavy > WEAPONS.knife.dmgHeavy * 2 && WEAPONS.bossclaw.dmgLight > WEAPONS.knife.dmgLight * 2, '专属巨爪伤害远高于军刀');
  ok(!PRIMARIES.includes('bossclaw'), '专属巨爪不进主武器池（玩家选不到）');
  h.slot = 2; clearEv(); room.melee(h, true); room.step();   // 事件要靠一次 broadcast 才落到连接上
  ok(evAll().some((e) => e.e === 'melee' && e.w === 'bossclaw'), 'BOSS 近战按专属巨爪结算（melee 事件带 bossclaw）');
  h.slot = 0;
  const pk = packSelf(h);
  ok(pk.hm === pool && pk.bs === 'tyran' && pk.sm > 0, '自身状态包同步血量上限 / BOSS 形态 / 速度倍率', `hm=${pk.hm} bs=${pk.bs} sm=${pk.sm}`);
  const cl = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, inv: h.inv.map(() => ({ mag: 0, reserve: 0, nextFire: 0, reloadUntil: 0, shotsFired: 0, spreadAcc: 0, lastShot: 0, boltUntil: 0 })) };
  unpackSelf(cl, pk);
  ok(cl.hpMax === h.hpMax && cl.isBoss === true && cl.spdMul === h.spdMul, '客户端解包拿到同样倍率（附身后预测不失配）', `sm=${cl.spdMul}`);
  const pRow = room.roster().find((r) => r.id === h.id);
  ok(pRow.boss === 2 && pRow.kind === 'tyran' && pRow.bnm === '铁皮暴君', '名册用 boss=2 区分真人附身并带 BOSS 名');
  const bi = room.info().boss;
  ok(!!bi && bi.by === 1 && bi.who === h.name && bi.hpMax === pool, '房间信息暴露"玩家附身中"的 BOSS 状态');
  ok(room.takeBoss(h) === null, '重复附身被拒');
  // 附身后归属怪潮：不能吃己方补给
  const sMed2 = S.find((s) => s.kind === 'med');
  sMed2.readyAt = 0; put(h, sMed2.x, sMed2.z); h.hp = 10;
  clearEv(); room.step();
  ok(h.hp === 10 && (mask() & (1 << sMed2.i)) !== 0, '附身 BOSS 后无法取用人类补给');
  clearEv();
  ok(room.releaseBoss(h, false) === true, '主动下甲交还 AI');
  ok(h.team === 'BL' && !h.isBoss && h.hpMax === 100 && h.primary === 'ak47', '下甲后回到清怪小队');
  const back = room.aliveBoss();
  ok(!!back && back.hp === pool, 'AI 按池化血量接管 BOSS（附身不能当回血）', back ? `${back.hp}/${pool}` : 'none');

  // BOSS 被击杀：掉落空投 + 全站刷新；空投一次补满
  const b4 = room.aliveBoss();
  ok(!!b4, '场上仍有 BOSS');
  S[0].readyAt = room.time + 999;
  clearEv();
  room.damage(b4, h, 999999, 'chest', 'ak47', { x: 1, y: 0, z: 0 }, false);
  room.step();
  ok(evAll().some((e) => e.e === 'bossdown'), '击杀 BOSS 下发 bossdown');
  ok(room.drops.length === 1, 'BOSS 掉落空投箱');
  ok(mask() === (1 << S.length) - 1, '击杀 BOSS 后补给站全部刷新');
  put(h, room.drops[0].x, room.drops[0].z);
  h.hp = 10; h.armor = 0; h.inv[0].mag = 1;
  clearEv();
  room.step();
  ok(h.hp === 100 && h.armor === 100 && h.inv[0].mag === h.inv[0].def.mag, '空投箱一次补满生命/护甲/弹药', `hp=${h.hp} ar=${h.armor}`);
  ok(room.drops.length === 0 && evAll().some((e) => e.e === 'picked'), '空投即取即销并下发 picked');

  // 附身中掉线：AI 立刻接管
  const b5 = room.spawnMonster('shade');
  room.takeBoss(h);
  ok(room.possessId === h.id && !room.aliveBoss(), '再次附身成功');
  room.disconnect(h);
  ok(!h.isBoss && h.team === 'BL' && !!room.aliveBoss(), '附身者掉线后 AI 接管 BOSS');
  room.reconnect(h); h.online = true;
  ok(b5.id > 0, 'BOSS 实体可反复生成');

  // 结算重置：BOSS / 补给 / 空投全部归零
  room.drops.push({ id: 99, x: 0, y: 0.5, z: 0, born: room.time });
  room.resetMatch();
  ok(!room.aliveBoss() && room.drops.length === 0 && mask() === (1 << S.length) - 1 && room.bossAtWave >= 4, '新一轮清空 BOSS/空投并重置补给与排期');
  room.stop();
}

// ---------------- 7. 巨型 BOSS 的体型与命中盒 ----------------
console.log('[7] BOSS 体型与命中盒');
{
  const mk = (n) => ({ name: n, conn: { readyState: 1 }, msgs: [], send(o) { this.msgs.push(o); }, sendBin() { } });
  const room = new Room('t7', { goal: 100, max: 8, mode: 'pve', diff: 'normal', onEmpty() { } });
  const sh = mk('H');
  const h = room.addPlayer(sh, { primary: 'ak47' });
  room.stop();

  const pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, ck: 0, air: 0 };
  const M = boneMatrices(pose);
  const D = [-1, 0, 0];
  ok(!rayHitboxes(M, pose, [8, 2.5, 0], D, 12), '2.5m 高处打不到常人体型');
  const sc = SIZE.mother.h;
  const big = rayHitboxes(M, pose, [8, 2.5, 0], D, 12, sc);
  ok(!!big, `放大到 ${sc} 倍后同一高度命中巨体`, big ? big.part : 'miss');
  const mid = rayHitboxes(M, pose, [8, 1.3, 0], D, 12);
  const midBig = rayHitboxes(M, pose, [8, 1.3, 0], D, 12, sc);
  ok(mid && midBig && midBig.t < mid.t && midBig.t > 6 && midBig.t < 8.1, '巨体更早被命中且命中距离仍是世界米数', `${mid && mid.t.toFixed(2)} -> ${midBig && midBig.t.toFixed(2)}`);

  const boss = room.spawnMonster('mother');
  ok(Math.abs(room.hitScaleOf(boss) - sc) < 1e-6, 'BOSS 命中盒倍率取自共享体型表', `${room.hitScaleOf(boss)}`);
  ok(room.hitScaleOf(h) === 1, '真人命中盒不受影响');

  // 甲板上找一条 8m 开阔线，真枪实弹打巨体抬起的胸腔
  let site = null;
  outer7: for (let x = -24; x <= 24; x += 4) for (let z = -8; z <= 8; z += 2) {
    if (room.world.blocked(x, 0.06, z, 0.6, 1.8)) continue;
    for (const [mx, mz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      let clear = true;
      for (const t of [4, 8, 12]) for (const hy of [1.2, 2.6]) if (room.world.raycast(x, hy, z, mx, 0, mz, t, 'sight')) { clear = false; break; }
      if (clear) { site = { x, z, mx, mz }; break outer7; }
    }
  }
  ok(!!site, '找到巨体高度也放得开的射击线', JSON.stringify(site));
  if (site) {
    const bx = site.x + site.mx * 8, bz = site.z + site.mz * 8;
    boss.pos.x = bx; boss.pos.z = bz; boss.pos.y = 0.02;
    boss.vel.x = boss.vel.y = boss.vel.z = 0; boss.alive = true; boss.protectT = 0;
    h.pos.x = site.x; h.pos.z = site.z; h.pos.y = 0.02;
    h.vel.x = h.vel.y = h.vel.z = 0; h.alive = true; h.protectT = 0;
    h.punchP = h.punchY = 0; h.inv[0].nextFire = 0; h.curVt = room.time;
    const dx = bx - h.pos.x, dz = bz - h.pos.z;
    h.yaw = Math.atan2(-dx, -dz);
    h.pitch = Math.atan2(2.4 - (h.pos.y + h.eyeH), Math.hypot(dx, dz));
    room.recordHistory();
    const hp0 = boss.hp;
    room.fire(h, h.inv[0], 0, () => 0);
    ok(boss.hp < hp0, '平射 2.4m 高的巨体胸腔确实掉血', `${hp0}->${boss.hp.toFixed(1)}`);

    // 附身之后同一名玩家按 BOSS 体型挨打
    h.hp = h.hpMax = 9999;
    room.takeBoss(h);
    ok(h.isBoss && Math.abs(room.hitScaleOf(h) - sc) < 1e-6, '附身玩家按 BOSS 体型参与命中判定');
  }
  room.releaseBoss(h, false);
  ok(room.hitScaleOf(h) === 1 && !!room.aliveBoss(), '交还 AI 后玩家回到人体型、BOSS 回场');
  room.stop();
}

// ---------------- 8. 多地图：每张图都能建房、寻路、放怪、发补给 ----------------
console.log('\n[8] 多地图（运输船 / 沙漠灰 / 黑色城镇）');
for (const mapId of MAP_IDS) {
  const mk = (n) => ({ name: n, conn: { readyState: 1 }, msgs: [], send(o) { this.msgs.push(o); }, sendBin() { } });
  const room = new Room('t8' + mapId, { goal: 100, max: 8, mode: 'pve', diff: 'normal', map: mapId, onEmpty() { } });
  const def = mapOf(mapId);
  ok(room.mapId === mapId && room.mapName === def.name, `${def.name}：房间按选定地图加载世界`, `${room.mapId}/${room.world.colliders.length}`);
  const a = room.addPlayer(mk('A'), { primary: 'ak47' });
  const b = room.addPlayer(mk('B'), { primary: 'm4a1' });
  const spB = room.spawns.BL[0], spG = room.spawns.GR[0];
  ok(!!spB && !!spG && !room.world.blocked(spB.x, 0.06, spB.z, 0.42, STAND_H), `${def.name}：出生点可站立`, JSON.stringify(spB));
  const cross = room.nav.findPath(spB.x, spB.z, spG.x, spG.z);
  ok(!!cross && cross.length > 1, `${def.name}：双方基地之间有路`, cross ? `${cross.length} 段` : '无');
  ok(suppliesForMap(mapId).length > 0 && room.supplies.length === suppliesForMap(mapId).length, `${def.name}：补给站按图配置`, `${room.supplies.length}`);
  // 跑 20 秒：怪要能出生、能挪动，人不能被地形吞掉
  room.wave = 1; room.pending = ['infected', 'infected', 'shooter']; room.waveLeft = 3; room.nextWaveAt = -1;
  const mon0 = room.aliveMonsters();
  for (const p of [a, b]) { p.hp = p.hpMax = 1e6; p.armor = 100; }
  let ref = null;
  for (let i = 0; i < 600; i++) {
    room.step();
    if (i === 60) ref = new Map([...room.monsters.values()].map((m) => [m.id, [m.pos.x, m.pos.z]]));
  }
  const mons = [...room.monsters.values()];
  ok(room.aliveMonsters() > mon0, `${def.name}：怪口能持续出怪`, `${mons.length} 只`);
  const moved = mons.filter((m) => { const r = ref && ref.get(m.id); return r && Math.hypot(m.pos.x - r[0], m.pos.z - r[1]) > 1.5; }).length;
  ok(moved >= 1, `${def.name}：怪物寻路真的在走`, `${moved}/${mons.length}`);
  ok(a.alive && b.alive && Math.abs(a.pos.y) < 1 && Math.abs(b.pos.y) < 1, `${def.name}：出生 20 秒后两名真人仍站在地形上`, `y=${a.pos.y.toFixed(2)}/${b.pos.y.toFixed(2)}`);
  // 附身 BOSS 在新图上也要成立
  const boss = room.spawnMonster('tyran');
  if (boss) {
    boss.hp = boss.hpMax = 900;
    a.pos.x = boss.pos.x + 3; a.pos.z = boss.pos.z; a.hp = a.hpMax = 900; a.alive = true;
    ok(room.takeBoss(a) === a && a.isBoss && room.hitScaleOf(a) === SIZE.tyran.h, `${def.name}：BOSS 附身与巨体判定可用`);
  }
  room.stop();
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
clearTimeout(deadline);
process.exit(fail ? 1 : 0);
