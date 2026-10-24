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
import { initConsole, handle as consoleHandle, logLine, rxTick } from './console.js';
import { createMapPolicy } from './map-policy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DIST = path.join(HERE, '..', 'dist', 'index.html');
const ASSETS = path.join(HERE, '..', 'assets');   // 外部 3D 模型（/assets/models/*.glb），缺失时客户端自动退回程序化外观
const PORT = +(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_ROOMS = +(process.env.MAX_ROOMS || 32);
const STARTED_AT = Date.now();
const mapPolicy = createMapPolicy(process.env.MAP_SETTINGS_FILE || path.join(ROOT, 'data', 'maps.json'));

// 日志同时进两处：终端（原有习惯）与运维控制台的环形缓冲（实时滚动 + 事后回看）
const log = (s, lv = 'info') => { console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`); logLine(s, lv); };
const cleanName = (n) => String(n == null ? '' : n).replace(/[\u0000-\u001f<>"'\\]/g, '').trim().slice(0, 24);

const rooms = new Map();
const tickets = new Map(); // token -> { roomId, pid }
let roomSeq = 1;
let sessSeq = 1;

function createRoom(o) {
  if (rooms.size >= MAX_ROOMS) return null;
  const room = new Room(String(roomSeq++), {
    name: cleanName(o.name) || '房间',
    goal: o.goal, max: o.max, mode: o.mode, diff: o.diff, map: o.map,
    onEmpty: (r) => { rooms.delete(r.id); log(`房间 ${r.id} 已回收`); },
    onCheat: (p, kind) => { log(`房间 ${room.id} 疑似作弊 ${kind}：${p.name}(#${p.id})，已暂停其开火 4 秒`, 'warn'); },
  });
  rooms.set(room.id, room);
  log(`房间 ${room.id} 创建：${room.name}（${room.mapName} / 目标 ${room.goal} / 上限 ${room.max}）`);
  return room;
}
const roomList = () => [...rooms.values()].filter((r) => mapPolicy.enabled(r.mapId)).map((r) => r.info());
function setMapEnabled(id, enabled) {
  const out = mapPolicy.set(id, enabled);
  if (!out.err) {
    const msg = JSON.stringify({ t: 'maps', list: out.maps, rooms: roomList() });
    for (const ws of wss.clients) if (ws.readyState === 1 && ws.bufferedAmount < 4e6) ws.send(msg);
  }
  return out;
}

// ---------------- 运维台动作：请人离席 ----------------
// 关键：removePlayer 只动房间名册，被移除者自己的连接什么都收不到，会卡在"还在对局里"的假象中。
// 所以踢人必须显式走 Sess.dropSeat（清席位 + 删重连票据 + 广播 leave），再单独给这条连接发 kicked，
// 让客户端清掉 ticket、退回大厅并刷新房单。
function eject(sess, msg) {
  if (!sess) return false;
  sess.dropSeat('kicked');
  sess.send({ t: 'kicked', m: msg });
  sess.send({ t: 'hi', rooms: roomList() });
  return true;
}
function kick(rid, pid) {
  const room = rooms.get(String(rid));
  if (!room) return { err: '房间不存在或已回收' };
  const p = room.players.get(pid | 0);
  if (!p) return { err: '这个人不在该房间里（可能已经离开）' };
  if (p.isBot) {
    if (!room.removeBot(p.id)) return { err: '机器人移除失败' };
    log(`运维台移除机器人：房间 ${room.id} ${p.name}(#${p.id})`, 'warn');
    return { ok: '已移除机器人', note: p.name };
  }
  const nm = p.name;
  if (p.sess) eject(p.sess, '运维控制台已将你移出房间');
  else room.removePlayer(p, 'kicked');       // 连接已断且席位被回收后的兜底：只清名册
  log(`运维台踢人：房间 ${room.id} ${nm}(#${p.id})`, 'warn');
  return { ok: '已踢出 ' + nm, note: nm };
}
function closeRoom(rid) {
  const room = rooms.get(String(rid));
  if (!room) return { err: '房间不存在或已回收' };
  const nm = room.name, n = room.players.size, sp = room.spectators.size;
  for (const p of [...room.players.values()]) {
    if (p.isBot) { room.removePlayer(p, 'kicked'); continue; }
    if (p.sess) eject(p.sess, '运维控制台已关闭该房间');
    else room.removePlayer(p, 'kicked');
  }
  for (const s of [...room.spectators.values()]) {
    const sess = s.sess;
    if (!sess) continue;
    sess.dropSpect();
    sess.send({ t: 'kicked', m: '运维控制台已关闭该房间' });
    sess.send({ t: 'hi', rooms: roomList() });
  }
  room.stop();
  rooms.delete(room.id);
  log(`运维台关闭房间 ${room.id}「${nm}」（清退 ${n} 人 / ${sp} 观战）`, 'warn');
  return { ok: '房间已关闭', note: nm };
}

class Sess {
  constructor(ws, ip) {
    this.id = sessSeq++;
    this.ws = ws; this.conn = ws; this.ip = ip;
    this.name = '士兵';
    this.room = null; this.player = null; this.ticket = null;
    this.spect = null; this.spectRoom = null;
    this.msgs = 0; this.msgWin = Date.now();
  }
  send(o) {
    const ws = this.conn;
    if (!ws || ws.readyState !== 1) return;
    if (ws.bufferedAmount > 4e6) return; // 拥塞时丢快照，TCP 自行恢复
    if (o.t === 'hi' || o.t === 'rooms') o = { ...o, maps: mapPolicy.list() };
    ws.send(JSON.stringify(o));
  }
  sendBin(buf) {
    const ws = this.conn;
    if (!ws || ws.readyState !== 1) return;
    if (ws.bufferedAmount > 4e6) return;
    ws.send(buf); // ws 原生支持 ArrayBuffer / TypedArray
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
  dropSpect() {
    if (!this.spect || !this.spectRoom) { this.spect = null; this.spectRoom = null; return; }
    const { room, sp } = { room: this.spectRoom, sp: this.spect };
    this.spect = null; this.spectRoom = null;
    room.removeSpectator(sp);
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
    const map = mapPolicy.pick(m.map);
    if (!map) return s.err('该地图已禁用或不存在，请选择其他地图');
    const room = createRoom({ ...m, map });
    if (!room) return s.err('服务器房间已满');
    if (!s.join(room, { primary: m && m.primary })) return s.err('房间已满');
    s.send({ t: 'joined', ticket: s.ticket, ...room.welcome(s.player) });
    log(`${s.name} 创建并加入房间 ${room.id}`);
  },
  join(s, m) {
    if (s.room) return s.err('已在房间中');
    const room = rooms.get(String(m && m.rid));
    if (!room) return s.err('房间不存在或已关闭');
    if (!mapPolicy.enabled(room.mapId)) return s.err('该地图已禁用，现有对局仅供原玩家继续');
    if (!s.join(room, { primary: m.primary, team: m.team })) return s.err('房间已满');
    s.send({ t: 'joined', ticket: s.ticket, ...room.welcome(s.player) });
    log(`${s.name} 加入房间 ${room.id}`);
  },
  quick(s, m) {
    if (s.room) return s.err('已在房间中');
    const want = m && m.mode === 'pve' ? 'pve' : 'pvp'; // 匹配不跨模式，避免 PVE 玩家被丢进对抗日
    const wantMap = mapPolicy.pick(m && m.map);
    if (!wantMap) return s.err('该地图已禁用或不存在，请选择其他地图');
    let best = null, alt = null;
    for (const r of rooms.values()) {
      if (r.mode !== want || r.players.size >= r.max || !mapPolicy.enabled(r.mapId)) continue;
      if (wantMap && r.mapId === wantMap && (!best || r.players.size > best.players.size)) { best = r; continue; }
      if (!alt || r.players.size > alt.players.size) alt = r; // 同图优先，其次凑人
    }
    best = best || alt;
    if (!best) best = createRoom({ name: want === 'pve' ? '僵尸挑战' : '快速匹配', goal: (m && m.goal) || 50, max: (m && m.max) || 16, mode: want, diff: m && m.diff, map: wantMap });
    if (!best || !s.join(best, { primary: m && m.primary, team: m && m.team })) return s.err('无法加入房间');
    s.send({ t: 'joined', ticket: s.ticket, ...best.welcome(s.player) });
    log(`${s.name} 快速匹配进入房间 ${best.id}`);
  },
  spectate(s, m) {
    if (s.room || s.spect) return s.err('已在房间中');
    const room = rooms.get(String(m && m.rid));
    if (!room) return s.err('房间不存在或已关闭');
    if (!mapPolicy.enabled(room.mapId)) return s.err('该地图已禁用，暂不接受新的观战');
    const sp = room.addSpectator(s);
    if (!sp) return s.err('观战席位已满');
    s.spect = sp; s.spectRoom = room;
    s.send({ t: 'spectating', ...room.spectWelcome() });
    log(`${s.name} 进入房间 ${room.id} 观战`);
  },
  cmd(s, m) { if (s.player && s.player.online && Array.isArray(m.list)) s.room.pushCmds(s.player, m.list); },
  loadout(s, m) { if (s.player) s.room.setLoadout(s.player, String(m.primary || '')); },
  // PVE 附身 BOSS：任何存活真人可接管当前 AI BOSS，也可随时下甲交还 AI
  boss(s, m) {
    if (!s.room || !s.player) return s.err('需先进入房间');
    if (s.room.mode !== 'pve') return s.err('只有 PVE 房间可以附身 BOSS');
    const a = String((m && m.a) || '');
    if (a === 'take') {
      if (!s.room.takeBoss(s.player)) return s.err('当前没有可附身的 BOSS（等它登场，或你已处于 BOSS 形态）');
      log(`${s.name} 附身 BOSS（房间 ${s.room.id}）`);
    } else if (a === 'release') {
      if (!s.room.releaseBoss(s.player, false)) return s.err('你当前不是 BOSS');
      log(`${s.name} 交出 BOSS 控制权（房间 ${s.room.id}）`);
    } else return s.err('未知的 BOSS 操作');
  },
  bot(s, m) {
    if (!s.room || !s.player) return s.err('需先进入房间');
    if (s.room.ownerId !== s.player.id) return s.err('只有房主可以管理机器人');
    const a = String((m && m.a) || '');
    if (a === 'add') {
      const b = s.room.addBot({ team: m.team, primary: m.primary ? String(m.primary) : undefined, diff: m.diff ? String(m.diff) : 'normal' });
      if (!b) return s.err('无法添加机器人（房间已满或已达机器人上限）');
      log(`房间 ${s.room.id} 房主 ${s.name} 添加机器人 ${b.name}（${b.team}）`);
    } else if (a === 'remove') {
      if (!s.room.removeBot(m.id)) return s.err('机器人不存在');
    } else if (a === 'clear') {
      const team = m.team === 'BL' || m.team === 'GR' ? m.team : null;
      const n = s.room.clearBots(team);
      log(`房间 ${s.room.id} 房主 ${s.name} 清空机器人 ${team || '全部'}（${n} 个）`);
    } else if (a === 'diff') {
      s.room.setBotDiff(m.id, String(m.diff || 'normal'));
    } else return s.err('未知的机器人操作');
  },
  ping(s, m) {
    if (s.player && typeof m.r === 'number' && Number.isFinite(m.r)) s.player.ping = Math.max(0, Math.min(999, Math.round(m.r)));
    s.send({ t: 'pong', c: m && m.c, st: s.room ? s.room.time : 0 });
  },
  leave(s) {
    s.dropSpect();
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
const MIME = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' };
const assetCache = new Map(); // 绝对路径 -> { buf, tag }
function assetFile(u) {
  const fp = path.normalize(path.join(ASSETS, u.slice('/assets/'.length)));
  if (!fp.startsWith(ASSETS + path.sep) && fp !== ASSETS) return null;      // 目录穿越防护
  const ext = path.extname(fp).toLowerCase();
  if (!MIME[ext]) return null;
  let st;
  try { st = fs.statSync(fp); } catch (e) { return null; }
  const tag = '"' + st.size.toString(36) + '-' + Math.round(st.mtimeMs).toString(36) + '"';
  let hit = assetCache.get(fp);
  if (!hit || hit.tag !== tag) hit = { buf: fs.readFileSync(fp), tag };
  assetCache.set(fp, hit);
  return hit;
}
const server = http.createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  if (consoleHandle(req, res, u)) return;              // /admin 与 /api/console/*（详见 server/console.js）
  if (u === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  if (u === '/api/maps') { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); return res.end(JSON.stringify({ maps: mapPolicy.list() })); }
  if (u === '/api/rooms') { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); return res.end(JSON.stringify(roomList())); }
  if (u.startsWith('/assets/')) {
    const a = assetFile(u);
    if (!a) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }   // 客户端拿不到就走程序化外观兜底
    const mime = MIME[path.extname(u.split('?')[0]).toLowerCase()];
    if ((req.headers['if-none-match'] || '') === a.tag) { res.writeHead(304, { etag: a.tag }); return res.end(); }
    res.writeHead(200, { 'content-type': mime, 'content-length': a.buf.length, etag: a.tag, 'cache-control': 'no-cache' });
    return res.end(a.buf);
  }
  // 开发模式：直接以 ES 模块方式提供源码（测试 / 调试 / tools 资产工作台用，生产不启用）
  if (process.env.DEV_SRC === '1' && (u.startsWith('/src/') || u.startsWith('/server/') || u.startsWith('/test/') || u.startsWith('/tools/') || /^\/vendor\/[\w.]+\.js$/.test(u) || /^\/addons\/[\w/.-]+\.js$/.test(u))) {
    const fp = u.startsWith('/vendor/')
      ? path.join(ROOT, 'node_modules', 'three', 'build', u.slice('/vendor/'.length))
      : u.startsWith('/addons/')
        ? path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm', u.slice('/addons/'.length))
        : path.normalize(path.join(ROOT, u));
    if (!fp.startsWith(ROOT) || !/\.(js|html|json|css)$/.test(fp)) { res.writeHead(403); return res.end('forbidden'); }
    fs.readFile(fp, (e, buf) => {
      if (e) { res.writeHead(404); return res.end('not found'); }
      const ct = fp.endsWith('.html') ? 'text/html' : fp.endsWith('.css') ? 'text/css' : 'text/javascript';
      res.writeHead(200, { 'content-type': ct + '; charset=utf-8', 'cache-control': 'no-store' });
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
const ipConns = new Map(); // ip -> 活跃连接数
const MAX_IP_CONNS = +(process.env.MAX_IP_CONNS || 8);
wss.on('connection', (ws, req) => {
  const ip = (req.socket.remoteAddress || '?').replace(/^::ffff:/, '');
  const c = (ipConns.get(ip) || 0) + 1;
  if (c > MAX_IP_CONNS) { log(`IP ${ip} 连接数超限(${c})，拒绝`); try { ws.close(1013, 'ip-limit'); } catch (e) { /* 忽略 */ } return; }
  ipConns.set(ip, c);
  let counted = true;
  const release = () => { if (!counted) return; counted = false; const n = (ipConns.get(ip) || 1) - 1; if (n <= 0) ipConns.delete(ip); else ipConns.set(ip, n); };
  const s = new Sess(ws, ip);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (buf) => {
    rxTick();
    s.msgs++;
    const now = Date.now();
    if (now - s.msgWin > 1000) { s.msgWin = now; s.msgs = 0; }
    if (s.msgs > 120) { log(`${s.name}(${ip}) 消息频率超限，已断开`, 'warn'); try { ws.close(1008, 'rate'); } catch (e) { /* 忽略 */ } return; } // 限流
    let m;
    try { m = JSON.parse(buf.toString()); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    const h = handlers[m.t];
    if (h) { try { h(s, m); } catch (e) { console.error('消息处理失败', m.t, e); s.err('服务器内部错误'); } }
  });
  ws.on('close', () => {
    release();
    s.conn = null;
    if (s.spect) { s.dropSpect(); return; }
    if (s.player && s.player.sess === s && s.room) {
      const room = s.room;
      s.room.disconnect(s.player);
      log(`${s.name} 断线（房间 ${room.id}，席位保留 ${RECONNECT_GRACE} 秒）`);
    }
  });
  ws.on('error', () => { release(); s.conn = null; });
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
initConsole({ rooms, tickets, ipConns, wss, proto: PROTO_VERSION, maxRooms: MAX_ROOMS, startedAt: STARTED_AT, kick, closeRoom, listMaps: mapPolicy.list, setMapEnabled });

server.listen(PORT, HOST, () => {
  const ips = [];
  for (const nic of Object.values(os.networkInterfaces())) for (const a of nic || {}) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
  const port = server.address().port;
  log('穿越火线·运输船 联机服务端已启动');
  log(`  本机:   http://localhost:${port}`);
  for (const ip of ips) log(`  局域网: http://${ip}:${port}`);
  log(`  运维台: http://localhost:${port}/admin` + (process.env.ADMIN_TOKEN ? '（已启用 ADMIN_TOKEN 口令校验）'
    : '（未设 ADMIN_TOKEN：后台无任何验证，请把端口收在内网或经反代加锁）'));
  log(`  协议版本 ${PROTO_VERSION} · 房间上限 ${MAX_ROOMS} · WebSocket 路径 /ws`);
  if (!fs.existsSync(DIST)) log('  警告：dist/index.html 不存在，请先运行 npm run build', 'warn');
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
