// 联机服务入口：静态页面 + WebSocket 网关 + 房间管理 + 断线重连票据（Node >= 18，Windows / Linux 通用）
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { PROTO_VERSION, RECONNECT_GRACE } from '../src/protocol.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DIST = path.join(HERE, '..', 'dist', 'index.html');
const PORT = +(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_ROOMS = +(process.env.MAX_ROOMS || 32);

const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const cleanName = (n) => String(n == null ? '' : n).replace(/[\u0000-\u001f<>"'\\]/g, '').trim().slice(0, 24);

const rooms = new Map();
const tickets = new Map(); // token -> { roomId, pid }
let roomSeq = 1;
let sessSeq = 1;

function createRoom(o) {
  if (rooms.size >= MAX_ROOMS) return null;
  const room = new Room(String(roomSeq++), {
    name: cleanName(o.name) || '房间',
    goal: o.goal, max: o.max,
    onEmpty: (r) => { rooms.delete(r.id); log(`房间 ${r.id} 已回收`); },
  });
  rooms.set(room.id, room);
  log(`房间 ${room.id} 创建：${room.name}（目标 ${room.goal} / 上限 ${room.max}）`);
  return room;
}
const roomList = () => [...rooms.values()].map((r) => r.info());

class Sess {
  constructor(ws, ip) {
    this.id = sessSeq++;
    this.ws = ws; this.conn = ws; this.ip = ip;
    this.name = '士兵';
    this.room = null; this.player = null; this.ticket = null;
    this.msgs = 0; this.msgWin = Date.now();
  }
  send(o) {
    const ws = this.conn;
    if (!ws || ws.readyState !== 1) return;
    if (ws.bufferedAmount > 4e6) return; // 拥塞时丢快照，TCP 自行恢复
    ws.send(JSON.stringify(o));
  }
  err(m) { this.send({ t: 'err', m }); }
  attach(room, p) {
    this.room = room; this.player = p;
    p.sess = this;
    if (!this.ticket) this.ticket = crypto.randomBytes(10).toString('hex');
    tickets.set(this.ticket, { roomId: room.id, pid: p.id });
  }
  join(room, o = {}) {
    const p = room.addPlayer(this, o);
    if (!p) return false;
    this.attach(room, p);
    return true;
  }
  dropSeat(reason) {
    if (!this.player || !this.room) return;
    const { room, player, ticket } = this;
    this.room = null; this.player = null;
    if (ticket) tickets.delete(ticket);
    room.removePlayer(player, reason);
  }
}

// ---------------- 网络消息 ----------------
const handlers = {
  hello(s, m) {
    if (m.proto !== PROTO_VERSION) return s.err('客户端版本与服务端不一致，请强制刷新（Ctrl+F5）');
    const name = cleanName(m.name);
    if (name) s.name = name;
    const tk = m.ticket ? String(m.ticket) : null;
    const held = tk && tickets.get(tk);
    if (held) {
      const room = rooms.get(held.roomId);
      const p = room && room.players.get(held.pid);
      if (p && !p.online) {
        // 重连：接管保留席位
        const old = p.sess;
        if (old && old !== s) { old.conn = null; old.room = null; old.player = null; }
        s.attach(room, p);
        room.reconnect(p);
        s.send({ t: 'joined', ticket: s.ticket, ...room.welcome(p) });
        log(`${s.name} 重连回房间 ${room.id}`);
        return;
      }
      if (p && p.online) {
        // 同一票的重复连接：新连接接管席位，踢掉旧连接
        const old = p.sess;
        if (old && old !== s) {
          if (old.conn && old.conn !== s.conn) { try { old.conn.close(); } catch (e) { /* 忽略 */ } }
          old.conn = null; old.room = null; old.player = null;
        }
        s.attach(room, p);
        s.send({ t: 'joined', ticket: s.ticket, ...room.welcome(p) });
        log(`${s.name} 重新接管房间 ${room.id} 席位`);
        return;
      }
      tickets.delete(tk);
    }
    s.send({ t: 'hi', rooms: roomList() });
  },
  rooms(s) { s.send({ t: 'rooms', list: roomList() }); },
  create(s, m) {
    if (s.room) return s.err('已在房间中');
    const room = createRoom(m || {});
    if (!room) return s.err('服务器房间已满');
    if (!s.join(room, { primary: m && m.primary })) return s.err('房间已满');
    s.send({ t: 'joined', ticket: s.ticket, ...room.welcome(s.player) });
    log(`${s.name} 创建并加入房间 ${room.id}`);
  },
  join(s, m) {
    if (s.room) return s.err('已在房间中');
    const room = rooms.get(String(m && m.rid));
    if (!room) return s.err('房间不存在或已关闭');
    if (!s.join(room, { primary: m.primary, team: m.team })) return s.err('房间已满');
    s.send({ t: 'joined', ticket: s.ticket, ...room.welcome(s.player) });
    log(`${s.name} 加入房间 ${room.id}`);
  },
  quick(s, m) {
    if (s.room) return s.err('已在房间中');
    let best = null;
    for (const r of rooms.values()) {
      if (r.players.size >= r.max) continue;
      if (!best || r.players.size > best.players.size) best = r; // 优先凑人
    }
    if (!best) best = createRoom({ name: '快速匹配', goal: (m && m.goal) || 50, max: (m && m.max) || 16 });
    if (!best || !s.join(best, { primary: m && m.primary, team: m && m.team })) return s.err('无法加入房间');
    s.send({ t: 'joined', ticket: s.ticket, ...best.welcome(s.player) });
    log(`${s.name} 快速匹配进入房间 ${best.id}`);
  },
  cmd(s, m) { if (s.player && s.player.online && Array.isArray(m.list)) s.room.pushCmds(s.player, m.list); },
  loadout(s, m) { if (s.player) s.room.setLoadout(s.player, String(m.primary || '')); },
  ping(s, m) {
    if (s.player && typeof m.r === 'number' && Number.isFinite(m.r)) s.player.ping = Math.max(0, Math.min(999, Math.round(m.r)));
    s.send({ t: 'pong', c: m && m.c, st: s.room ? s.room.time : 0 });
  },
  leave(s) {
    if (s.room) log(`${s.name} 离开房间 ${s.room.id}`);
    s.dropSeat('leave'); s.send({ t: 'hi', rooms: roomList() });
  },
};

// ---------------- HTTP ----------------
let cachedPage = null, cachedMtime = 0;
function indexPage() {
  try {
    const st = fs.statSync(DIST);
    if (!cachedPage || st.mtimeMs !== cachedMtime) { cachedPage = fs.readFileSync(DIST); cachedMtime = st.mtimeMs; }
    return cachedPage;
  } catch (e) { return null; }
}
const server = http.createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  if (u === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  if (u === '/api/rooms') { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); return res.end(JSON.stringify(roomList())); }
  // 开发模式：直接以 ES 模块方式提供源码（测试 / 调试用，生产不启用）
  if (process.env.DEV_SRC === '1' && (u.startsWith('/src/') || u.startsWith('/server/') || u.startsWith('/test/') || /^\/vendor\/[\w.]+\.js$/.test(u) || /^\/addons\/[\w/.-]+\.js$/.test(u))) {
    const fp = u.startsWith('/vendor/')
      ? path.join(ROOT, 'node_modules', 'three', 'build', u.slice('/vendor/'.length))
      : u.startsWith('/addons/')
        ? path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm', u.slice('/addons/'.length))
        : path.normalize(path.join(ROOT, u));
    if (!fp.startsWith(ROOT) || !/\.(js|html|json)$/.test(fp)) { res.writeHead(403); return res.end('forbidden'); }
    fs.readFile(fp, (e, buf) => {
      if (e) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': (fp.endsWith('.html') ? 'text/html' : 'text/javascript') + '; charset=utf-8', 'cache-control': 'no-store' });
      res.end(buf);
    });
    return;
  }
  const page = indexPage();
  if (!page) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('尚未构建前端包：请先运行 npm run build（生成 dist/index.html）');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(page);
});

// ---------------- WebSocket ----------------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws, req) => {
  const ip = (req.socket.remoteAddress || '?').replace(/^::ffff:/, '');
  const s = new Sess(ws, ip);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (buf) => {
    s.msgs++;
    const now = Date.now();
    if (now - s.msgWin > 1000) { s.msgWin = now; s.msgs = 0; }
    if (s.msgs > 120) { try { ws.close(1008, 'rate'); } catch (e) { /* 忽略 */ } return; } // 限流
    let m;
    try { m = JSON.parse(buf.toString()); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    const h = handlers[m.t];
    if (h) { try { h(s, m); } catch (e) { console.error('消息处理失败', m.t, e); s.err('服务器内部错误'); } }
  });
  ws.on('close', () => {
    s.conn = null;
    if (s.player && s.player.sess === s && s.room) {
      const room = s.room;
      s.room.disconnect(s.player);
      log(`${s.name} 断线（房间 ${room.id}，席位保留 ${RECONNECT_GRACE} 秒）`);
    }
  });
  ws.on('error', () => { s.conn = null; });
});

// 心跳：20 秒无 pong 判定死亡并断开（触发席位保留流程）
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { try { ws.terminate(); } catch (e) { /* 忽略 */ } continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* 忽略 */ }
  }
}, 20000);

// 清理失效票据（席位被房间超时回收后同步删除）
setInterval(() => {
  for (const [tk, v] of tickets) {
    const room = rooms.get(v.roomId);
    if (!room || !room.players.has(v.pid)) tickets.delete(tk);
  }
}, 15000);

// ---------------- 启动 ----------------
server.listen(PORT, HOST, () => {
  const ips = [];
  for (const nic of Object.values(os.networkInterfaces())) for (const a of nic || {}) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
  log('穿越火线·运输船 联机服务端已启动');
  log(`  本机:   http://localhost:${server.address().port}`);
  for (const ip of ips) log(`  局域网: http://${ip}:${server.address().port}`);
  log(`  协议版本 ${PROTO_VERSION} · 房间上限 ${MAX_ROOMS} · WebSocket 路径 /ws`);
  if (!fs.existsSync(DIST)) log('  警告：dist/index.html 不存在，请先运行 npm run build');
});

export { server, wss, rooms };
export const boundPort = () => (server.address() || { port: PORT }).port;
export function stopAll() { for (const r of rooms.values()) r.stop(); wss.close(); server.close(); }

function shutdown() {
  log('收到退出信号，关闭服务');
  for (const r of rooms.values()) r.stop();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
