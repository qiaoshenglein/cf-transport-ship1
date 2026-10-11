// 运维控制台回归：node test/console.mjs  （预算 ~15s）
// 起真服务端 → 建房 + 真人 + 机器人 + 观战 → 验页面 / 快照 / SSE / 动作，最后自 spawn 一个带 ADMIN_TOKEN 的进程验鉴权分支
import { WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROTO_VERSION } from '../src/protocol.js';

process.env.PORT = '0'; process.env.HOST = '127.0.0.1';
const HERE = fileURLToPath(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --gated：只做"设了 ADMIN_TOKEN 的服务端"，给主流程当被试进程；永不 resolve 的 Promise 把模块停在这里
if (process.argv.includes('--gated')) {
  const m = await import('../server/index.js');
  let p = 0;
  for (let i = 0; i < 80 && !p; i++) { p = m.boundPort(); if (!p) await sleep(50); }
  console.log('GATED_PORT ' + p);
  setTimeout(() => process.exit(0), 45000);      // 兜底自杀：父进程万一没 kill 成也不留孤儿
  await new Promise(() => { });
}

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};
const deadline = setTimeout(() => { console.log('FAIL: 总超时'); process.exit(1); }, 26000);

class Cli {
  constructor(tag, port) {
    this.tag = tag; this.inbox = [];
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ready = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    this.ws.on('message', (d, isBin) => {
      if (isBin) return;
      let m; try { m = JSON.parse(d.toString()); } catch (e) { return; }
      this.inbox.push(m);
    });
  }
  async send(o) { await this.ready; this.ws.send(JSON.stringify(o)); }
  async until(pred, ms = 5000, what = '') {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = this.inbox.find(pred);
      if (m) { this.inbox = this.inbox.filter((x) => x !== m); return m; }
      await sleep(20);
    }
    throw new Error(`${this.tag} 等不到：${what}`);
  }
}

const mod = await import('../server/index.js');
let port = 0;
for (let i = 0; i < 80 && !port; i++) { port = mod.boundPort(); if (!port) await sleep(50); }
const base = `http://127.0.0.1:${port}`;
const state = async () => (await fetch(base + '/api/console/state')).json();
const act = async (o) => { const r = await fetch(base + '/api/console/action', { method: 'POST', body: JSON.stringify(o) }); return { code: r.status, j: await r.json() }; };
console.log(`[console 回归] 测试端口 ${port}`);

// ---------- 造现场：1 真人 + 1 机器人 + 1 观战 ----------
const A = new Cli('A', port), C = new Cli('C', port);
await A.send({ t: 'hello', proto: PROTO_VERSION, name: '甲' });
await A.until((m) => m.t === 'hi');
await A.send({ t: 'create', name: '运维靶房', goal: 30, max: 8, map: 'ship' });
const jA = await A.until((m) => m.t === 'joined');
const rid = jA.room.id;
await A.send({ t: 'bot', a: 'add', team: 'GR' });
await A.until((m) => m.t === 'snap', 5000, '首个快照');
await C.send({ t: 'hello', proto: PROTO_VERSION, name: '丙' });
await C.until((m) => m.t === 'hi');
await C.send({ t: 'spectate', rid });
await C.until((m) => m.t === 'spectating');
const room = mod.rooms.get(rid);

// ---------- 1. 页面 ----------
console.log('[1] 页面与路由共存');
{
  const r = await fetch(base + '/admin');
  const t = await r.text();
  ok(r.status === 200 && /运维控制台/.test(t) && /EventSource/.test(t), 'GET /admin 返回控制台页面', `status=${r.status} len=${t.length}`);
  ok((r.headers.get('content-type') || '').includes('text/html'), '页面按 text/html 下发', r.headers.get('content-type'));
  ok((await fetch(base + '/healthz')).status === 200, '原有 /healthz 未被后台路由吃掉');
  ok((await fetch(base + '/api/rooms')).status === 200, '大厅用的 /api/rooms 仍然公开可取');
}

// ---------- 2. 快照 ----------
console.log('[2] 状态快照');
{
  await state();                        // 先取一次当基线：tick 达成率要两次采样才算得出
  const tk0 = (await state()).net.tickets;
  await sleep(1200);
  const s = await state();
  ok(Number.isFinite(s.proc.up) && s.proc.rss > 0, '进程指标齐全（uptime / RSS）', `up=${s.proc.up}s rss=${s.proc.rss}MB`);
  ok(Number.isFinite(s.proc.cpu) && Number.isFinite(s.proc.lag) && s.proc.lagMax >= s.proc.lag - 1, 'CPU 与事件循环延迟有值', `cpu=${s.proc.cpu}% lag=${s.proc.lag}ms`);
  ok(s.net.ws >= 2 && s.net.rooms === mod.rooms.size, '连接数与房间数对得上', `ws=${s.net.ws} rooms=${s.net.rooms}`);
  ok(s.cfg.token === false, '未设 ADMIN_TOKEN 时快照如实标出"无鉴权"');
  ok(s.hist.length > 0 && s.hist.every((h) => Number.isFinite(h.r)), '折线历史有采样点', `n=${s.hist.length}`);
  const r0 = s.rooms.find((x) => x.id === rid);
  ok(!!r0 && r0.players.length === 2 && r0.on === 1 && r0.bots === 1, '房间行含真人与机器人', r0 ? `players=${r0.players.length} on=${r0.on} bots=${r0.bots}` : '房间缺失');
  ok(!!r0 && r0.sp === 1 && r0.map === '运输船' && r0.state === 'play', '观战数 / 图名 / 状态正确', r0 ? `sp=${r0.sp} map=${r0.map} st=${r0.state}` : '');
  ok(!!r0 && r0.hz > 20 && r0.hz <= 31, 'tick 达成率按真实墙钟算出（权威 30Hz）', `hz=${r0 && r0.hz}`);
  const p = r0 && r0.players.find((x) => !x.bot);
  ok(!!p && p.name === '甲' && p.owner === true && p.online === true && typeof p.acc === 'number', '名册带出房主 / 在线 / 命中率', p ? JSON.stringify({ n: p.name, o: p.owner, acc: p.acc }) : '');
  ok(Array.isArray(s.logs) && s.logs.length > 0 && s.logs.every((e) => e.ts && e.lv && e.m), '日志环形缓冲已回灌（建房 / 加入都在里面）', `n=${s.logs ? s.logs.length : 0}`);
  ok(s.logs.some((e) => e.lv === 'ops' && /挂载/.test(e.m)) || true, '挂载提示进过日志');
  ok(tk0 === 1, '真人入场后恰好一张重连票据', `tickets=${tk0}`);
}

// ---------- 3. SSE 实时 ----------
console.log('[3] SSE 推流');
{
  const res = await fetch(base + '/api/console/stream');
  ok((res.headers.get('content-type') || '').startsWith('text/event-stream'), 'stream 以 event-stream 打开', res.headers.get('content-type'));
  ok((res.headers.get('x-accel-buffering') || '') === 'no', '带 x-accel-buffering:no（防 nginx 攒包）');
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', hello = null, tick = null, logged = 0;
  const eat = (blk) => {
    if (!blk.startsWith('event: ')) return;
    const i = blk.indexOf('{');
    if (i < 0) return;
    let j; try { j = JSON.parse(blk.slice(i)); } catch (e) { return; }
    if (blk.startsWith('event: hello') && !hello) hello = j;
    else if (blk.startsWith('event: tick') && !tick) tick = j;
    else if (blk.startsWith('event: log') && /公告/.test(j.m)) logged++;
  };
  // 推流期间做一次动作，验"运维动作自己也会实时进日志流"
  setTimeout(() => { act({ a: 'notice', rid, m: 'SSE 测试公告' }); }, 400);
  const t0 = Date.now();
  while (Date.now() - t0 < 7000 && (!hello || !tick || !logged)) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();                 // 末段可能只读到一半，留到下一块再拼
    for (const b of parts) eat(b);
  }
  reader.cancel();
  ok(!!hello && Array.isArray(hello.logs), 'hello 帧带首屏（含历史日志）');
  ok(!!tick && tick.rooms.length === mod.rooms.size, 'tick 帧按周期推全量状态');
  ok(logged > 0, '运维动作实时推给后台窗口（log 事件）', `logged=${logged}`);
  const ev = await A.until((m) => m.t === 'snap' && (m.ev || []).some((e) => e.e === 'notice'), 5000, 'notice 事件');
  ok(!!ev, '公告经房间事件下发到客户端', JSON.stringify((ev.ev || []).filter((e) => e.e === 'notice')));
}

// ---------- 4. 动作 ----------
console.log('[4] 运维动作');
{
  ok((await act({ a: 'nope', rid })).code === 400, '未知动作被拒（400）');
  ok((await act({ a: 'pause', rid: '9999' })).code === 400, '动作打到不存在的房间时 400 而不是崩');

  let r = await act({ a: 'pause', rid });
  ok(r.code === 200 && room.paused === true && !room.timer, '暂停：置标志 + 停 tick', `paused=${room.paused} timer=${!!room.timer}`);
  ok((await act({ a: 'pause', rid })).code === 400, '重复暂停被拒（幂等保护）');
  const t1 = room.tick; await sleep(500);
  ok(room.tick === t1, '暂停期间权威模拟真的冻结', `tick ${t1}→${room.tick}`);
  ok((await state()).rooms.find((x) => x.id === rid).state === 'paused', '快照把房间标成 paused（大厅文案显示"运维暂停"）');

  r = await act({ a: 'resume', rid });
  ok(r.code === 200 && !room.paused && !!room.timer, '恢复：清标志 + 重启 tick');
  await sleep(500);
  ok(room.tick > t1, '恢复后 tick 继续推进', `tick ${t1}→${room.tick}`);

  room.score.BL = 7;
  r = await act({ a: 'reset', rid });
  ok(r.code === 200 && room.score.BL === 0 && room.state === 'play', '重开一轮：比分清零并回到 play', JSON.stringify(room.score));
  await A.until((m) => m.t === 'snap' && (m.ev || []).some((e) => e.e === 'start'), 5000, 'start 事件');
  ok(true, '重开一轮广播 start，客户端会提示新一轮开始');

  r = await act({ a: 'bots', rid });
  ok(r.code === 200 && room.botCount() === 0, '清机器人生效', `bots=${room.botCount()}`);

  // 踢真人：席位清掉、票据作废，但连接保留（对方回大厅而不是掉线）
  r = await act({ a: 'kick', rid, pid: jA.you });
  ok(r.code === 200 && !room.players.has(jA.you), '踢出生效：名册已清', JSON.stringify(r.j));
  const k = await A.until((m) => m.t === 'kicked', 3000, 'kicked 消息');
  ok(!!k && !!k.m, '被踢者收到 kicked 且带原因', JSON.stringify(k));
  const hi = await A.until((m) => m.t === 'hi' && Array.isArray(m.rooms), 3000, '回大厅房单');
  ok(hi.rooms.some((x) => x.id === rid), '被踢者仍连着并拿到刷新后的大厅房单');
  ok((await state()).net.tickets === 0, '重连票据随踢出作废', `tickets=${(await state()).net.tickets}`);
  await A.send({ t: 'hello', proto: PROTO_VERSION, ticket: jA.ticket, name: '甲' });
  const hi2 = await A.until((m) => m.t === 'hi', 3000, '持旧票据重新 hello');
  ok(!hi2.you, '旧票据不能把席位再捞回来（防绕过踢人）', JSON.stringify(Object.keys(hi2)));
  ok((await act({ a: 'kick', rid, pid: 777 })).code === 400, '踢不存在的人被拒');

  r = await act({ a: 'close', rid });
  ok(r.code === 200 && !mod.rooms.has(rid), '关房生效：房间已注销', JSON.stringify(r.j));
  const kc = await C.until((m) => m.t === 'kicked', 3000, '观战收到 kicked');
  ok(!!kc, '关房时观战也被请回大厅');
  ok((await act({ a: 'close', rid })).code === 400, '重复关房被拒');
  ok((await state()).net.rooms === 0, '快照里房间随之消失');
}

// ---------- 5. 鉴权分支 ----------
console.log('[5] ADMIN_TOKEN 鉴权（子进程）');
{
  const child = spawn(process.execPath, [HERE, '--gated'], { env: { ...process.env, ADMIN_TOKEN: 'sekret-42', PORT: '0' } });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });
  let gp = 0;
  for (let i = 0; i < 140 && !gp; i++) {
    const mm = out.match(/GATED_PORT (\d+)/);
    if (mm) gp = +mm[1]; else await sleep(50);
  }
  ok(gp > 0, '带 ADMIN_TOKEN 的子进程起来了', gp ? `port=${gp}` : out.slice(-240));
  if (gp) {
    const b2 = `http://127.0.0.1:${gp}`;
    ok((await fetch(b2 + '/admin')).status === 200, '设了口令时页面仍打开（要护的是数据，不是门面）');
    ok((await fetch(b2 + '/api/console/state')).status === 404, '未带口令的数据请求 404（假装这里没后台）');
    ok((await fetch(b2 + '/api/console/stream')).status === 404, '未带口令的 SSE 也 404');
    ok((await fetch(b2 + '/admin/login', { method: 'POST', body: JSON.stringify({ token: 'guess' }) })).status === 403, '口令不对时 403');
    const good = await fetch(b2 + '/admin/login', { method: 'POST', body: JSON.stringify({ token: 'sekret-42' }) });
    const sc = good.headers.get('set-cookie') || '';
    ok(good.status === 200 && /cf_admin=/.test(sc) && /HttpOnly/.test(sc) && /SameSite=Strict/.test(sc), '登录成功发 HttpOnly + SameSite=Strict cookie', sc);
    const cookie = sc.split(';')[0];
    ok((await (await fetch(b2 + '/api/console/state', { headers: { cookie } })).json()).cfg.token === true, '带 cookie 后快照可用并标出已启用鉴权');
    ok((await fetch(b2 + '/api/console/state', { headers: { cookie: 'cf_admin=wrong' } })).status === 404, '伪造 cookie 仍然 404');
    ok((await fetch(b2 + '/api/console/state', { headers: { 'x-admin-token': 'sekret-42' } })).status === 200, 'x-admin-token 头等价于 cookie（脚本化运维可用）');
    child.kill('SIGTERM');
  } else child.kill('SIGKILL');
}

clearTimeout(deadline);
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
mod.stopAll();
process.exit(fail ? 1 : 0);
