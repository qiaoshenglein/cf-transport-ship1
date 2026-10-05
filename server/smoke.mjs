// 冒烟测试：1) Room 逻辑直测（移动 / 命中伤害 / 击杀 / 复活 / 断线回收）  2) 网关端到端（ws 双客户端 + 票据重连）
// 运行：node server/smoke.mjs   （总时长 < 30s，超时自动失败）
import { Room } from './room.js';
import { B, RESPAWN_TIME, RECONNECT_GRACE } from '../src/protocol.js';

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
  const mkSess = (name) => ({ name, conn: { readyState: 1 }, msgs: [], send(o) { this.msgs.push(o); } });
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
      this.tag = tag; this.inbox = [];
      this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      this.ready = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
      this.ws.on('message', (d) => { try { this.inbox.push(JSON.parse(d)); } catch (e) { /* 忽略 */ } });
    }
    async send(o) { await this.ready; this.ws.send(JSON.stringify(o)); }
    async until(pred, ms = 5000, what = '') {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const m = this.inbox.find(pred); if (m) { this.inbox = this.inbox.filter((x) => x !== m); return m; } await new Promise((r) => setTimeout(r, 20)); }
      throw new Error(`${this.tag} 等待超时: ${what}`);
    }
  }
  const A = new Cli('A'), Bc = new Cli('B');
  await A.send({ t: 'hello', proto: 1, name: '玩家甲' });
  await A.until((m) => m.t === 'hi');
  await A.send({ t: 'create', name: '测试房', goal: 30, max: 8 });
  const jA = await A.until((m) => m.t === 'joined');
  ok(jA && jA.you && jA.room && jA.roster && jA.ticket, 'A 建房并收到 joined 欢迎包');
  const rid = jA.room.id;

  await Bc.send({ t: 'hello', proto: 1, name: '玩家乙' });
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

  // 断线 -> 票据重连
  A.ws.close();
  await new Promise((r) => setTimeout(r, 300));
  const A2 = new Cli('A2');
  await A2.send({ t: 'hello', proto: 1, name: '玩家甲', ticket: jA.ticket });
  const jr = await A2.until((m) => m.t === 'joined', 4000, 'rejoin');
  ok(jr && jr.you === jA.you, '票据重连取回席位');
  const onEv = await Bc.until((m) => m.t === 'snap' && (m.ev || []).some((e) => e.e === 'rejoin'), 3000, 'rejoin 事件');
  ok(!!onEv, 'B 收到 rejoin 事件');

  // 状态连续：重连后 me 位置与断线前同量级（未被传送回出生点）
  ok(Math.hypot(jr.me.x - jA.me.x, jr.me.z - jA.me.z) < 80, '重连后位置连续');

  await A2.send({ t: 'leave' });
  await Bc.send({ t: 'leave' });
  await new Promise((r) => setTimeout(r, 400));
  const rooms = await fetch(`http://127.0.0.1:${port}/api/rooms`).then((r) => r.json());
  ok(Array.isArray(rooms), '/api/rooms 可访问');
  const health = await fetch(`http://127.0.0.1:${port}/healthz`).then((r) => r.text());
  ok(health === 'ok', '/healthz 正常');
  const page = await fetch(`http://127.0.0.1:${port}/`);
  ok(page.status === 200 || page.status === 503, 'HTTP 首页应答', String(page.status));
  for (const c of [A, Bc, A2]) { try { c.ws.close(); } catch (e) { /* 忽略 */ } }
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
clearTimeout(deadline);
process.exit(fail ? 1 : 0);
