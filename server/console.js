// 网页版后台实时运维控制台：零依赖、零构建（页面是同目录 admin.html）
// 挂载见 server/index.js：GET /admin · /api/console/state · /api/console/stream(SSE) · /api/console/action
//
// 鉴权默认关闭（本项目要求开箱即用不做验证）。设置环境变量 ADMIN_TOKEN 后启用：口令不对的数据请求一律 404
// （连"这里有个后台"都不透露），登录成功发 12 小时 HttpOnly cookie。默认无验证 => 端口必须收在内网或反代加锁。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'admin.html');
const TOKEN = process.env.ADMIN_TOKEN || '';
const MAX_LOG = 400, MAX_HIST = 120, TICK_MS = 1500, PROBE_MS = 1000, MAX_SSE = 8;

let ctx = null;   // { rooms, tickets, ipConns, wss, proto, maxRooms, startedAt, kick, closeRoom }
const logs = [], hist = [], sseClients = new Set();
let logSeq = 0, pump = null, probe = null;
let rxTotal = 0, rxRate = 0, rxPrev = 0;
let cpuPrev = process.cpuUsage(), cpuPct = 0;
let lagNow = 0, lagMax = 0, lastBeat = 0;

// 事件循环延迟：200ms 心跳量"实际间隔 - 期望间隔"。它涨而 CPU 不满，通常是某个 tick 里同步建图或批量寻路。
function startProbes() {
  if (probe) return;
  const lagTimer = setInterval(() => {
    const now = Date.now();
    if (lastBeat) {
      const d = Math.max(0, now - lastBeat - 200);
      if (d > lagMax) lagMax = d;
      lagNow = lagNow * 0.6 + d * 0.4;
    }
    lastBeat = now;
  }, 200);
  lagTimer.unref();
  probe = setInterval(() => {
    const now = process.cpuUsage();
    cpuPct = Math.min(999, ((now.user - cpuPrev.user + now.system - cpuPrev.system) / 1000 / PROBE_MS) * 100);
    cpuPrev = now;
    rxRate = rxTotal - rxPrev; rxPrev = rxTotal;
    const m = process.memoryUsage();
    hist.push({ r: Math.round(m.rss / 1048576), c: +cpuPct.toFixed(1), l: Math.round(lagNow), m: rxRate, w: ctx ? ctx.wss.clients.size : 0 });
    while (hist.length > MAX_HIST) hist.shift();
  }, PROBE_MS);
  probe.unref();
}

export function logLine(msg, lv = 'info') {
  const e = { i: ++logSeq, ts: Date.now(), lv, m: String(msg).slice(0, 300) };
  logs.push(e);
  while (logs.length > MAX_LOG) logs.shift();
  for (const res of sseClients) if (!write(res, 'log', e)) drop(res);
  return e;
}
export const rxTick = () => { rxTotal++; };

const lastTick = new Map();   // roomId -> { t, tick }：算每房实际 tick 频率（权威 30Hz）
function pRow(p, owner) {
  const s = p.stats || {};
  return {
    id: p.id, name: p.name, team: p.team, bot: !!p.isBot, boss: !!p.isBoss, owner,
    online: p.online !== false, ping: p.ping | 0, hp: Math.round(p.hp || 0), armor: Math.round(p.armor || 0),
    k: s.k | 0, d: s.d | 0, hs: s.hs | 0, acc: s.shots ? Math.round((s.hits / s.shots) * 100) : 0,
    wp: p.inv && p.inv[p.slot] ? p.inv[p.slot].def.id : (p.primary || null),
  };
}
function roomRow(r) {
  const now = Date.now(), prev = lastTick.get(r.id);
  // 首帧没有上一个采样点：给 null（页面显示"—"），别报成 0Hz 让运维以为在掉帧
  const hz = prev && now > prev.t ? Math.round(((r.tick - prev.tick) / ((now - prev.t) / 1000)) * 10) / 10 : null;
  lastTick.set(r.id, { t: now, tick: r.tick });
  const t = r.teamCount();
  let on = 0, off = 0, bots = 0;
  const ps = [];
  for (const p of r.players.values()) {
    if (p.isBot) bots++; else if (p.online !== false) on++; else off++;
    ps.push(pRow(p, r.ownerId === p.id));
  }
  // PVE 现场最常问的是"怪还在不在刷"，所以名册之外再带怪物与 BOSS 存活数
  const boss = r.monsters ? r.aliveBoss() : null;
  return {
    id: r.id, name: r.name, map: r.mapName, mapId: r.mapId, mode: r.mode, diff: r.pveDiff,
    state: r.paused ? 'paused' : r.state, paused: !!r.paused, tick: r.tick, hz,
    goal: r.goal, max: r.max, n: r.players.size, bl: t.BL, gr: t.GR, sp: r.spectators.size,
    bots, on, off, mon: r.monsters ? r.aliveMonsters() : 0, monBoss: boss ? (boss.bossKind || 'BOSS') : null,
    wave: r.wave, score: r.score, timeLeft: Math.round(r.timeLeft), up: Math.round(r.time),
    owner: r.ownerId, players: ps,
  };
}
export function snapshot(withLogs) {
  const m = process.memoryUsage();
  const rooms = ctx ? [...ctx.rooms.values()].map(roomRow) : [];
  const ids = new Set(rooms.map((r) => r.id));
  for (const k of lastTick.keys()) if (!ids.has(k)) lastTick.delete(k);
  let humans = 0, bots = 0, mons = 0;
  for (const r of rooms) { humans += r.on; bots += r.bots; mons += r.mon; }
  const out = {
    ts: Date.now(),
    proc: {
      up: Math.round((Date.now() - ctx.startedAt) / 1000), pid: process.pid, node: process.version,
      rss: Math.round(m.rss / 1048576), heap: Math.round(m.heapUsed / 1048576), heapMax: Math.round(m.heapTotal / 1048576),
      cpu: +cpuPct.toFixed(1), lag: Math.round(lagNow), lagMax: Math.round(lagMax),
    },
    net: {
      ws: ctx.wss.clients.size, ips: ctx.ipConns.size, tickets: ctx.tickets.size,
      rooms: rooms.length, maxRooms: ctx.maxRooms, mpsec: rxRate, proto: ctx.proto,
      humans, bots, mons, open: rooms.reduce((a, r) => a + (r.n < r.max ? 1 : 0), 0),
    },
    hist, rooms, cfg: { token: !!TOKEN },
  };
  if (withLogs) out.logs = logs.slice(-120);
  return out;
}

// ---------------- 鉴权 ----------------
const eqBuf = (a, b) => crypto.timingSafeEqual(
  crypto.createHash('sha256').update(String(a)).digest(),
  crypto.createHash('sha256').update(String(b)).digest());   // 先哈希再比：长度与耗时都不泄露口令形状
function bearer(req) {
  for (const kv of String(req.headers.cookie || '').split(';')) {
    const s = kv.trim();
    if (s.startsWith('cf_admin=')) return decodeURIComponent(s.slice(9));
  }
  return String(req.headers['x-admin-token'] || '');
}
export function authOk(req) { return !TOKEN || eqBuf(bearer(req), TOKEN); }

// ---------------- SSE ----------------
function write(res, ev, data) {
  try { res.write('event: ' + ev + '\ndata: ' + JSON.stringify(data) + '\n\n'); return true; } catch (e) { return false; }
}
function drop(res) {
  sseClients.delete(res);
  if (!sseClients.size && pump) { clearInterval(pump); pump = null; }
}

// ---------------- 动作 ----------------
const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n || 60);
const ACT_CN = { pause: '暂停对局', resume: '恢复对局', reset: '重开一轮', notice: '发布公告', bots: '清空机器人', kick: '踢出玩家', close: '关闭房间' };

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req, cb) {
  let n = 0; const cs = [];
  req.on('data', (d) => { n += d.length; if (n > 65536) { req.destroy(); return; } cs.push(d); });
  req.on('end', () => { try { cb(JSON.parse(Buffer.concat(cs).toString() || '{}')); } catch (e) { cb(null); } });
}

// 只做"温和干预"：暂停 / 恢复 / 重开一轮 / 公告 / 清机器人 / 踢人 / 关房。
// 战斗数值与容量参数一律走 env + 重启，故意不留热调口子（运维台不该变成改外挂开关）。
function act(a, b) {
  const r = ctx.rooms.get(String(b.rid));
  if (!r) return { err: '房间不存在或已回收' };
  switch (a) {
    case 'pause':
      if (r.paused) return { err: '该房已处于运维暂停' };
      r.paused = true; r.stop();
      return { ok: '已暂停推进；场内玩家会看到画面静止，恢复后继续' };
    case 'resume':
      if (!r.paused) return { err: '该房本来就在推进' };
      r.paused = false; r.start();
      return { ok: '已恢复推进' };
    case 'reset':
      r.resetMatch(); r.events.push({ e: 'start' });
      if (r.paused) { r.paused = false; r.start(); }
      return { ok: '已重开一轮（比分 / 时限 / 波次归零）' };
    case 'notice': {
      const m = clip(b.m, 80);
      if (!m) return { err: '公告内容为空' };
      r.events.push({ e: 'notice', m });
      return { ok: '公告已排入下一帧广播' + (r.paused ? '（该房暂停中，恢复后才发得出）' : '') };
    }
    case 'bots': {
      const team = b.team === 'BL' || b.team === 'GR' ? b.team : null;
      return { ok: '已清出 ' + r.clearBots(team) + ' 个机器人' };
    }
    case 'kick': return ctx.kick(String(b.rid), b.pid | 0);
    case 'close': return ctx.closeRoom(String(b.rid));
    default: return { err: '未知动作 ' + clip(a, 20) };
  }
}

// ---------------- 路由 ----------------
let pageBuf = null, pageMtime = 0;
function page() {
  try {
    const st = fs.statSync(PAGE);
    if (!pageBuf || st.mtimeMs !== pageMtime) { pageBuf = fs.readFileSync(PAGE); pageMtime = st.mtimeMs; }
    return pageBuf;
  } catch (e) { return null; }
}

// 命中则返回 true（请求已处理完）。u 为去掉查询参数后的路径。
export function handle(req, res, u) {
  if (u === '/admin' || u === '/admin/') {
    const p = page();
    if (!p) { res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }); res.end('缺少 server/admin.html'); return true; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' });
    res.end(p);
    return true;
  }
  if (u === '/admin/login') {
    if (!TOKEN) { json(res, 400, { err: '服务端未设置 ADMIN_TOKEN，本来就不需要口令' }); return true; }
    readBody(req, (b) => {
      if (!b || !eqBuf(String(b.token || ''), TOKEN)) {
        logLine('后台口令校验失败：' + (req.socket.remoteAddress || '?'), 'warn');
        return json(res, 403, { err: '口令不正确' });
      }
      res.setHeader('set-cookie', 'cf_admin=' + encodeURIComponent(TOKEN) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200');
      logLine('后台登录成功：' + (req.socket.remoteAddress || '?'), 'ops');
      json(res, 200, { ok: '已登录（12 小时有效）' });
    });
    return true;
  }
  if (!u.startsWith('/api/console/')) return false;
  // 设了口令又没带对：直接 404，不告诉对方"这里其实有个后台"
  if (!authOk(req)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return true; }

  if (u === '/api/console/state') { json(res, 200, snapshot(true)); return true; }
  if (u === '/api/console/stream') {
    if (sseClients.size >= MAX_SSE) { json(res, 503, { err: '后台窗口已达上限 ' + MAX_SSE + ' 个，先关掉一个再开' }); return true; }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store',
      connection: 'keep-alive', 'x-accel-buffering': 'no',   // 关掉 nginx 缓冲，否则 SSE 会被攒着不发
    });
    sseClients.add(res);
    write(res, 'hello', snapshot(true));
    if (!pump) {
      pump = setInterval(() => {
        const s = snapshot(false);
        for (const c of sseClients) if (!write(c, 'tick', s)) drop(c);
      }, TICK_MS);
      pump.unref();
    }
    req.on('close', () => drop(res));
    return true;
  }
  if (u === '/api/console/action') {
    if (req.method !== 'POST') { json(res, 405, { err: '该接口只接受 POST' }); return true; }
    readBody(req, (b) => {
      if (!b || typeof b.a !== 'string') { json(res, 400, { err: '缺少动作参数' }); return; }
      let out;
      try { out = act(b.a, b); } catch (e) { out = { err: '动作执行失败：' + e.message }; }
      if (out.err) { logLine('后台动作「' + (ACT_CN[b.a] || b.a) + '」失败：' + out.err, 'warn'); json(res, 400, out); return; }
      logLine('后台' + (ACT_CN[b.a] || b.a) + '：房间 ' + b.rid + (out.note ? '（' + out.note + '）' : ''), 'ops');
      json(res, 200, out);
    });
    return true;
  }
  return false;
}

// ---------------- 挂载 ----------------
export function initConsole(c) {
  ctx = c;
  startProbes();
  logLine('运维控制台已挂载：/admin' + (TOKEN ? '（已启用 ADMIN_TOKEN 校验）'
    : '（未设 ADMIN_TOKEN —— 默认无验证，任何人摸到端口都能踢人停房，请收在内网或反代加锁）'), TOKEN ? 'info' : 'warn');
}