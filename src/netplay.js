// 联机对战客户端：WebSocket 网关连接、房间大厅、本地预测 / 服务端和解、远端插值、事件表现、断线重连
import * as THREE from 'three';
import { Actor } from './actor.js';
import { Player } from './player.js';
import { applyCmd, unpackSelf, resetForSpawn, shotDir, F } from './netsim.js';
import { B, TICK_RATE, INTERP_DELAY, PROTO_VERSION } from './protocol.js';
import { WEAPONS } from './weapons.js';
import { buildGunMerged } from './guns.js';
import { audio } from './audio.js';

const DT = 1 / TICK_RATE;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = new THREE.Vector3();
const lerpAngle = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * k; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class NetGame {
  constructor(game) {
    this.g = game;
    this.ws = null;
    this.state = 'idle'; // idle | lobby | play
    this.inMatch = false; this.manualLeave = false; this.reconnecting = false;
    this.room = null; this.myId = 0; this.ticket = null;
    this.me = null; this.remotes = new Map();
    this.buf = [];
    this.seq = 1; this.pending = []; this.outbox = [];
    this.stAt = 0; this.stLocal = 0;
    this.rtt = 120; this.pn = 0; this.pings = new Map();
    this.acc = 0; this.tickFirst = true;
    this.nadeMeshes = new Map(); this.nadeTpl = null;
    this.lastSnap = null; this.killedBy = null; this._lastLife = undefined; this._endShown = false; this.boardShown = false;
    this.nop = {};
    this.predHooks = {
      fire: (a, w, spread, rnd) => this.predShot(a, w, spread, rnd),
      melee: (a, heavy) => { this.g.vm.melee(heavy); audio.playKnife(heavy ? 'heavy' : 'light', 'miss'); },
      throwNade: () => { },
      nadeStart: () => { this.g.vm.throwNade(); audio.playGrenadePin(); },
      switched: (a, w) => { a.soldier.setWeapon(w.id); this.g.vm.equip(w.id, w.def.draw); audio.playWeaponSwitch(w.id); this.g.hud.slots(a.inv, a.slot); },
      reloadStart: (a, empty) => this.g.onReloadStart(a, empty),
      reloadDone: () => { }, scope: (a) => this.g.onScope(a), dryFire: (a) => this.g.onDryFire(a),
    };
  }

  // ================= 连接 =================
  wsUrl() {
    const s = this.g.qs.get('svr');
    if (s) return (s.startsWith('wss://') || s.startsWith('ws://') ? s : `ws://${s}/ws`);
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }
  connect() {
    return new Promise((res, rej) => {
      if (this.ws && this.ws.readyState === 1) return res();
      try { this.ws = new WebSocket(this.wsUrl()); } catch (e) { return rej(e); }
      const to = setTimeout(() => rej(new Error('连接超时')), 6000);
      this.ws.onopen = () => { clearTimeout(to); res(); };
      this.ws.onerror = () => { clearTimeout(to); rej(new Error('无法连接服务器')); };
      this.ws.onmessage = (ev) => this.onMsg(ev);
      this.ws.onclose = () => this.onClose();
    });
  }
  helloMsg() {
    let tk = this.ticket || null;
    if (!tk) { try { tk = sessionStorage.getItem('cf_ticket'); } catch (e) { /* 忽略 */ } }
    this.send({ t: 'hello', proto: PROTO_VERSION, name: this.playerName(), ticket: tk || undefined });
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }

  onMsg(ev) {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    switch (m.t) {
      case 'hi':
        if (this.state === 'lobby') this.renderRooms(m.rooms || []);
        this.setStatus('');
        break;
      case 'rooms': if (this.state === 'lobby') this.renderRooms(m.list || []); break;
      case 'joined':
        this.ticket = m.ticket || this.ticket;
        try { if (m.ticket) sessionStorage.setItem('cf_ticket', m.ticket); } catch (e) { /* 忽略 */ }
        this.reconnecting = false; this.banner('');
        this.startMatch(m);
        break;
      case 'snap': if (this.inMatch) this.onSnap(m); break;
      case 'pong': {
        const s = this.pings.get(m.c); this.pings.delete(m.c);
        if (s) this.rtt += (Math.max(1, (performance.now() / 1000 - s) * 1000) - this.rtt) * 0.25;
        break;
      }
      case 'err':
        if (this.inMatch) this.banner(m.m);
        else this.setStatus(m.m);
        this.g.hud.toast(m.m, 3);
        break;
    }
  }
  onClose() {
    if (this.manualLeave) return;
    if (!this.inMatch) { if (this.state === 'lobby') this.setStatus('与服务器的连接已断开，点击任意按钮重连'); return; }
    this.reconnecting = true;
    this.banner('连接断开，正在自动重连…');
    this.retryLoop();
  }
  retryLoop() {
    let n = 0;
    const tryOne = async () => {
      if (!this.reconnecting || !this.inMatch) return;
      n++;
      try {
        const ws = new WebSocket(this.wsUrl());
        await new Promise((res, rej) => {
          const to = setTimeout(() => rej(new Error('t')), 4000);
          ws.onopen = () => { clearTimeout(to); res(); };
          ws.onerror = () => { clearTimeout(to); rej(new Error('e')); };
        });
        ws.onmessage = (ev) => this.onMsg(ev);
        ws.onclose = () => { if (this.reconnecting) { this.ws = null; this.onClose(); } };
        this.ws = ws;
        this.helloMsg();
        await new Promise((res, rej) => {
          const t0 = performance.now();
          const iv = setInterval(() => {
            if (!this.reconnecting) { clearInterval(iv); res(); }
            else if (performance.now() - t0 > 5000) { clearInterval(iv); rej(new Error('x')); }
          }, 100);
        });
      } catch (e) {
        if (this.reconnecting && n < 12) setTimeout(tryOne, 1800);
        else if (this.reconnecting) this.failReconnect('无法重新连接服务器');
      }
    };
    setTimeout(tryOne, 800);
  }
  failReconnect(msg) {
    this.reconnecting = false; this.banner('');
    this.g.hud.toast(msg, 4);
    try { sessionStorage.removeItem('cf_ticket'); } catch (e) { /* 忽略 */ }
    this.leaveMatch();
    this.openLobby();
  }

  // ================= 大厅 =================
  playerName() { try { return localStorage.getItem('cf_net_name') || '士兵' + (100 + ((Math.random() * 900) | 0)); } catch (e) { return '士兵'; } }
  ensureLobby() {
    if (this.lobby) return this.lobby;
    const d = document.createElement('div');
    d.id = 'lobby'; d.className = 'screen hidden';
    d.innerHTML = `
<div class="menuBox" style="grid-template-columns:1fr;width:min(760px,94vw)">
 <div class="title" style="margin-bottom:6px"><div class="logo">CROSSFIRE · 联机对战</div><h1 style="font-size:32px">运输船 · 房间大厅</h1></div>
 <div class="row2">
  <div class="opt"><div class="lab">昵称（主菜单已选阵营 / 主武器）</div><div class="netinp"><input type="text" id="netName" maxlength="12" placeholder="输入昵称"></div></div>
  <div class="opt"><div class="lab">创建房间</div><div class="seg" data-kg="goal"><button data-v="30">30杀</button><button data-v="50" class="on">50杀</button><button data-v="100">100杀</button></div><div class="seg" data-kg="max" style="margin-top:6px"><button data-v="8">8人</button><button data-v="16" class="on">16人</button></div></div>
 </div>
 <div class="row3" style="margin:8px 0 12px">
  <button class="go" id="netQuick" style="margin:0">快 速 匹 配</button>
  <button class="go sec" id="netCreate" style="margin:0">创 建 房 间</button>
  <button class="go sec" id="netBack" style="margin:0">返 回 主 菜 单</button>
 </div>
 <div id="roomList" class="rooms"></div>
 <div class="note" id="netStatus">正在连接服务器…</div>
</div>`;
    document.getElementById('ui').appendChild(d);
    const o = { goal: 50, max: 16 };
    for (const seg of d.querySelectorAll('.seg[data-kg]')) for (const b of seg.querySelectorAll('button')) b.addEventListener('click', () => {
      for (const x of seg.querySelectorAll('button')) x.classList.remove('on');
      b.classList.add('on'); o[seg.dataset.kg] = +b.dataset.v;
      this.g.audio?.playUI?.('click');
    });
    const nameInp = d.querySelector('#netName');
    nameInp.value = this.playerName();
    nameInp.addEventListener('change', () => this.saveName());
    d.querySelector('#netQuick').addEventListener('click', () => { this.saveName(); this.send({ t: 'quick', primary: this.g.opts.primary }); this.setStatus('正在匹配…'); });
    d.querySelector('#netCreate').addEventListener('click', () => {
      this.saveName();
      this.send({ t: 'create', name: `${this.playerName()}的战场`, goal: o.goal, max: o.max, primary: this.g.opts.primary });
      this.setStatus('正在创建…');
    });
    d.querySelector('#netBack').addEventListener('click', () => this.closeLobby());
    this.roomList = d.querySelector('#roomList');
    return (this.lobby = d);
  }
  saveName() { const i = this.lobby && this.lobby.querySelector('#netName'); if (i) { try { localStorage.setItem('cf_net_name', i.value.trim().slice(0, 12) || '士兵'); } catch (e) { /* 忽略 */ } } }
  setStatus(s) { const el = this.lobby && this.lobby.querySelector('#netStatus'); if (el) el.textContent = s || ' '; }
  renderRooms(list) {
    if (!this.roomList) return;
    if (!list.length) { this.roomList.innerHTML = '<div class="note">暂无房间：点击「创建房间」或「快速匹配」开战。</div>'; return; }
    this.roomList.innerHTML = list.map((r) => `
      <div class="roomRow"><b>${esc(r.name)}</b><span class="rm">${r.n}/${r.max} 人 · 潜伏 <i>${r.bl}</i>:<i>${r.gr}</i> 保卫 · 目标 ${r.goal} · ${r.state === 'play' ? `剩 ${Math.round(r.timeLeft)}s` : '结算中'}</span><button class="jin" data-rid="${esc(r.id)}">加入</button></div>`).join('');
    for (const b of this.roomList.querySelectorAll('button.jin')) b.addEventListener('click', () => {
      this.saveName();
      this.send({ t: 'join', rid: b.dataset.rid, primary: this.g.opts.primary });
      this.setStatus('正在加入…');
    });
  }
  async openLobby() {
    if (this.inMatch) return;
    const L = this.ensureLobby();
    L.classList.remove('hidden');
    this.state = 'lobby';
    this.renderRooms([]);
    this.setStatus('正在连接服务器…');
    try { await this.connect(); this.helloMsg(); }
    catch (e) { this.setStatus('无法连接联机服务器（' + e.message + '）'); }
  }
  closeLobby() {
    if (this.lobby) this.lobby.classList.add('hidden');
    if (!this.inMatch) { this.state = 'idle'; this.g.hud.show('menu'); }
  }

  // ================= 对局：初始化 =================
  startMatch(w) {
    const g = this.g;
    if (this.lobby) this.lobby.classList.add('hidden');
    this.room = w.room; this.myId = w.you; this.ticket = w.ticket || this.ticket;
    this.state = 'play'; this.inMatch = true; this.manualLeave = false;
    audio.init(); audio.setVolumes({ master: g.opts.vol }); audio.startAmbient();

    g.score = { ...w.room.score }; g.goal = w.room.goal; g.timeLeft = w.room.timeLeft;
    this.stAt = w.st; this.stLocal = performance.now() / 1000;
    this.buf = []; this.seq = 1; this.pending = []; this.outbox = []; this.acc = 0;
    this.killedBy = null; this._lastLife = w.me.life; this._endShown = false;

    const me = new Player(g, { id: w.you, name: this.playerName(), team: w.team });
    me.bind(document.getElementById('c'));
    me.primary = w.me.prim;
    resetForSpawn(me, { x: w.me.x, z: w.me.z, yaw: 0 }, w.me.prim, w.me.ss, w.me.pt);
    unpackSelf(me, w.me);
    me.stats = { k: 0, d: 0, hs: 0, shots: 0, hits: 0 };
    this.me = me;
    g.player = me; g.actors = [me];

    for (const r of w.roster) if (r.id !== w.you) { const a = this.ensureRemote(r); if (r.team === w.team) { g.addTag(a); a.tagged = true; } }
    g.vm.setTeam(w.team); g.vm.equip(me.weapon.id, 0.6); g.vm.setVisible(true);
    g.hud.slots(me.inv, 0);
    g.hud.show(null);
    g.playing = true; g.paused = false; g.ended = false;
    g.net = this;
    g.lock();
    g.hud.toast(`已加入 <b style="color:#f5b321">${esc(w.room.name)}</b> · ${w.team === 'BL' ? '潜伏者' : '保卫者'} · 目标 ${w.room.goal} 击杀`, 4);
    setTimeout(() => audio.announce('Go go go!'), 500);

    this.pingIv = setInterval(() => {
      this.pn++; this.pings.set(this.pn, performance.now() / 1000);
      this.send({ t: 'ping', c: this.pn, r: this.rtt });
    }, 600);
  }
  ensureRemote(r) {
    if (this.remotes.has(r.id)) { const a = this.remotes.get(r.id); a.name = r.name; a.team = r.team; return a; }
    const a = new Actor(this.g, { id: r.id, name: r.name, team: r.team });
    a.alive = false; a.soldier.root.visible = false; a.ping = r.ping || 0; a.radarT = 0; a.deadT = 0; a.curW = null;
    this.remotes.set(r.id, a);
    this.g.actors.push(a);
    return a;
  }

  // ================= 对局：每帧 =================
  update(dt) {
    const g = this.g, p = this.me;
    if (!p) return;
    g.time += dt;
    this.tickFirst = true;
    this.acc = Math.min(this.acc + dt, 0.15);
    let n = 0;
    while (this.acc >= DT && n < 5) { this.acc -= DT; n++; this.tick(); this.tickFirst = false; }
    if (this.acc >= DT) this.acc = 0;
    p.walk = p.keys.has('ShiftLeft') || p.keys.has('ShiftRight');
    p.updateCamera(dt);
    if (!p.alive) p.deadT += dt; else p.deadT = 0;

    const rt = this.renderT();
    for (const [id, a] of this.remotes) this.applyRemote(id, a, rt, dt);
    this.updateNadeViz(rt);

    for (const t of g.tags) {
      const a = t.actor;
      t.sprite.visible = a.alive && a.pos.distanceTo(g.renderer.camera.position) < 45;
      if (t.sprite.visible) { a.soldier.headWorld(t.sprite.position); t.sprite.position.y += 0.42; }
    }
    // 准星下角色名
    g.frame++;
    if (p.alive && g.frame % 4 === 0) {
      const cam = g.renderer.camera, o = cam.position, d = _d.set(0, 0, -1).applyQuaternion(cam.quaternion);
      const wh = g.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 80, 'sight');
      const lim = wh ? wh.t : 80;
      let best = null, bt = lim;
      for (const a of g.actors) {
        if (a === p || !a.alive) continue;
        const r = a.soldier.hitTest(o, d, bt, g.frame);
        if (r) { best = a; bt = r.t; }
      }
      g.aimTarget = best;
    }
    if (this.lastSnap) { g.score = this.lastSnap.sc || g.score; g.timeLeft = this.lastSnap.tl; }
    g.hud.update(dt, {
      score: g.score, timeLeft: g.timeLeft, goal: g.goal, myTeam: p.team,
      hp: p.hp, armor: p.armor, alive: p.alive, weapon: p.weapon,
      scoped: p.scoped && p.weapon.def.type === 'sniper', spreadPx: this.spreadPx(),
      yaw: p.yaw, respawnIn: p.respawnT, killedBy: this.killedBy, protect: p.protectT,
      aimName: g.aimTarget && g.aimTarget.alive ? g.aimTarget.name : '', aimTeam: g.aimTarget && g.aimTarget.alive ? g.aimTarget.team : '',
    });
    g.hud.drawRadar(p, g.actors, g.time);
    const tab = p.keys.has('Tab') && g.playing && !g.paused;
    if (tab !== this.boardShown || (tab && g.frame % 20 === 0)) { this.boardShown = tab; g.hud.scoreboard(tab, g.actors, p.id, g.score); }
    if (!this.reconnecting) this.flush();
    g.dmgFlash = Math.max(0, (g.dmgFlash || 0) - dt * 1.6);
  }
  spreadPx() {
    const p = this.me, cam = this.g.renderer.camera, w = p.weapon;
    if (!w || !w.def.spread) return 0;
    const sp = Math.min(0.12, w.spreadAcc + w.def.spread.base * 2 + (p.speed > 0.6 ? w.def.spread.move * Math.min(1, (p.speed || 0) / 5.7) : 0) + (p.onGround ? 0 : w.def.spread.air * 0.5)) * (p.crouch ? 0.7 : 1);
    return Math.tan(sp) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * window.innerHeight / 2;
  }

  // 一个预测 tick：采集输入 -> 本地执行 -> 入队发送
  tick() {
    const g = this.g, p = this.me, first = this.tickFirst;
    const sens = g.opts.sens * 0.0022, fovK = p.scoped ? g.renderer.camera.fov / g.opts.fov : 1;
    let dx = 0, dy = 0;
    if (first) {
      dx = p.mouse.dx; dy = p.mouse.dy;
      p.mouse.dx = p.mouse.dy = 0;
      if (p.touchLook) { dx += p.touchLook.x; dy += p.touchLook.y; p.touchLook.x = p.touchLook.y = 0; }
    }
    if (p.alive) {
      p.yaw -= dx * sens * fovK;
      p.pitch = THREE.MathUtils.clamp(p.pitch - dy * sens * fovK, -1.5, 1.5);
    }
    p.lookDX = dx; p.lookDY = dy;
    const K = p.keys;
    let f = 0, s = 0;
    if (K.has('KeyW') || K.has('ArrowUp')) f += 1;
    if (K.has('KeyS') || K.has('ArrowDown')) f -= 1;
    if (K.has('KeyD') || K.has('ArrowRight')) s += 1;
    if (K.has('KeyA') || K.has('ArrowLeft')) s -= 1;
    f += p.touch.mz; s += p.touch.mx;
    let b = 0;
    if (K.has('Space') || p.touch.jump) b |= B.jump;
    if (K.has('KeyC') || p.touch.crouch) b |= B.crouch;
    if (K.has('ShiftLeft') || K.has('ShiftRight')) b |= B.walk;
    if (p.mouse.l || p.touch.fire) b |= B.fire;
    if (p.mouse.r) b |= B.alt;
    if (first) {
      if (p.mouse.lp || p.touch.firePressed) b |= B.fireP;
      if (p.mouse.rp) b |= B.altP;
      if (p.consumePressed('KeyR')) b |= B.reload;
      p.mouse.lp = p.mouse.rp = false; p.touch.firePressed = false; p.touch.jump = false;
    }
    let sw = -1;
    if (first) {
      for (let i = 1; i <= 4; i++) if (p.consumePressed('Digit' + i)) sw = i - 1;
      if (p.consumePressed('KeyQ')) sw = p.lastSlot;
      if (p.mouse.wheel) {
        const dir = p.mouse.wheel > 0 ? 1 : -1; p.mouse.wheel = 0;
        let nn = p.slot;
        for (let k = 0; k < 4; k++) { nn = (nn + dir + 4) % 4; if (p.inv[nn] && !(p.inv[nn].def.type === 'grenade' && p.inv[nn].mag <= 0)) break; }
        sw = nn;
      }
      if (sw >= 0 && p.inv[sw] && p.inv[sw].def.type === 'grenade' && p.inv[sw].mag <= 0) { g.hud.toast('没有手雷了', 1.2); sw = -1; }
      if (p.consumePressed('KeyF')) g.vm.inspect();
      if (p.consumePressed('KeyB') && g.playing && !g.inLoadout) g.toggleLoadout();
      p.pressed.delete('Tab');
      p.pressed.clear();
    }
    const c = { s: this.seq++, d: DT, y: p.yaw, p: p.pitch, f, r: s, b, w: sw, vt: this.serverNow() };
    const ev = applyCmd(p, c, g.world, g.actors, this.predHooks);
    if (ev) {
      if (ev.jumped) g.onJump(p);
      if (ev.landed && ev.landSpeed > 3) g.onLand(p, ev.landSpeed);
      const hs = ev.speed;
      if (p.onGround && hs > 2.6 && !(b & B.walk) && !p.crouch) {
        p.stepDist = (p.stepDist || 0) + hs * DT;
        if (p.stepDist > 2.3) { p.stepDist = 0; g.onFootstep(p); }
      }
    }
    p.protectT = Math.max(0, p.protectT - DT);
    if (!this.reconnecting) {
      this.pending.push(c);
      if (this.pending.length > 100) this.pending.shift();
      this.outbox.push(c);
    }
    if (this.outbox.length > 6) this.flush();
  }
  flush() {
    if (!this.outbox.length || !this.ws || this.ws.readyState !== 1) return;
    const list = this.outbox.splice(0, this.outbox.length);
    this.send({ t: 'cmd', list });
  }
  serverNow() { return this.stAt + (performance.now() / 1000 - this.stLocal) + this.rtt / 2000; }
  renderT() { return this.serverNow() - this.rtt / 2000 - INTERP_DELAY; }

  // ================= 快照 / 和解 =================
  onSnap(m) {
    this.stAt = m.st; this.stLocal = performance.now() / 1000;
    this.lastSnap = m;
    const ps = new Map(); for (const r of m.ps) ps.set(r[0], r);
    const nd = new Map(); for (const r of (m.nd || [])) nd.set(r[0], r);
    this.buf.push({ st: m.st, ps, nd });
    if (this.buf.length > 8) this.buf.shift();
    if (m.roster) this.syncRoster(m.roster);
    if (m.ev) for (const e of m.ev) this.onEvent(e);
    this.reconcile(m.me);
    if (m.gs === 'end' && !this._endShown) { this._endShown = true; this.g.hud.toast(`本局结束 · 潜伏者 <b>${m.sc.BL}</b> : <b>${m.sc.GR}</b> 保卫者 · 10 秒后开始新一局`, 6); }
    if (m.gs === 'play') this._endShown = false;
  }
  reconcile(sme) {
    const g = this.g, p = this.me;
    if (!p || !sme) return;
    while (this.pending.length && this.pending[0].s <= sme.ack) this.pending.shift();
    const rest = this.pending.slice();
    const keepYaw = p.yaw, keepPitch = p.pitch;
    unpackSelf(p, sme);
    p.yaw = keepYaw; p.pitch = keepPitch;
    for (const c of rest) applyCmd(p, c, g.world, g.actors, this.nop);
    p.ack = sme.ack;
    // 重生同步：life 增加说明服务器已把我们重新部署
    if (sme.life !== this._lastLife) {
      this._lastLife = sme.life;
      if (sme.al) {
        const self = this.buf.length ? this.buf[this.buf.length - 1].ps.get(p.id) : null;
        resetForSpawn(p, { x: sme.x, z: sme.z, yaw: self ? self[4] : p.yaw }, sme.prim, sme.ss, sme.pt);
        unpackSelf(p, sme);
        p.soldier.root.visible = false;
        g.vm.equip(p.weapon.id, p.weapon.def.draw); g.vm.setVisible(true);
        g.hud.slots(p.inv, p.slot);
        this.killedBy = null;
      }
    }
    p.life = sme.life;
  }

  // ================= 远端插值 =================
  sampleAt(id, t) {
    let a = null, b = null;
    for (const fr of this.buf) {
      const r = fr.ps.get(id);
      if (!r) continue;
      if (fr.st <= t) a = { st: fr.st, r };
      else { b = { st: fr.st, r }; break; }
    }
    if (!a) return null;
    if (!b) return { r: a.r, k: 0, next: null };
    const k = Math.max(0, Math.min(1, (t - a.st) / (b.st - a.st)));
    return { r: a.r, k, next: b.r };
  }
  applyRemote(id, a, t, dt) {
    const s = this.sampleAt(id, t);
    if (!s) return;
    let [, x, y, z, yaw, pitch, f, wid, vx, vz] = s.r;
    if (s.next && s.k > 0) {
      const n = s.next, k = s.k;
      x += (n[1] - x) * k; y += (n[2] - y) * k; z += (n[3] - z) * k;
      yaw = lerpAngle(yaw, n[4], k); pitch += (n[5] - pitch) * k;
      vx += (n[8] - vx) * k; vz += (n[9] - vz) * k;
      f = k < 0.5 ? f : n[6]; wid = k < 0.5 ? wid : n[7];
    }
    a.pos.set(x, y, z);
    a.yaw = yaw; a.pitch = pitch;
    const wasAlive = a.alive;
    a.alive = !!(f & F.alive);
    a.crouch = !!(f & F.crouch);
    a.onGround = !!(f & F.ground);
    a.protectT = (f & F.protect) ? 1 : 0;
    if (a.curW !== wid) { a.curW = wid; a.soldier.setWeapon(wid || 'knife'); }
    if (a.alive) {
      if (!wasAlive) { a.soldier.reset(); a.deadT = 0; }
      a.soldier.root.visible = true;
      a.soldier.root.position.copy(a.pos);
      a.soldier.root.rotation.y = a.yaw;
      const sp = Math.hypot(vx, vz); a.speed = sp;
      const fwd = sp > 0.01 ? (vx * -Math.sin(a.yaw) + vz * -Math.cos(a.yaw)) / sp : 0;
      a.soldier.update(dt, { speed: sp, fwd, crouch: a.crouch, pitch, onGround: a.onGround, reloading: !!(f & F.reload) });
      a.soldier.mesh.visible = !(a.protectT > 0 && Math.sin(this.g.time * 30) > 0.3);
    } else {
      a.soldier.root.visible = true;
      a.soldier.root.position.copy(a.pos);
      a.deadT += dt;
      a.soldier.update(dt, {});
    }
    a.radarT = Math.max(0, a.radarT - dt);
  }

  // ================= 事件表现 =================
  onEvent(e) {
    const g = this.g;
    const act = (id) => (id === this.myId ? this.me : this.remotes.get(id));
    switch (e.e) {
      case 'join': g.hud.toast(`${esc(e.name)} 加入了战斗`, 2.5); break;
      case 'leave': g.hud.toast(`${esc(e.name)} 离开了房间`, 2.5); if (e.id !== this.myId) this.dropRemote(e.id); break;
      case 'disc': g.hud.toast(`${esc(e.name)} 断线中…`, 2.5); break;
      case 'rejoin': g.hud.toast(`${esc(e.name)} 重新连接`, 2.5); break;
      case 'start': g.hud.toast('新一轮对局开始', 3); audio.announce('Go go go!'); break;
      case 'shot': {
        if (e.id === this.myId) break; // 预测已表现
        const o = new THREE.Vector3(e.o[0], e.o[1], e.o[2]);
        const d = new THREE.Vector3(e.d[0], e.d[1], e.d[2]);
        const end = o.clone().addScaledVector(d, e.t);
        const a = act(e.id);
        let mz = o.clone().addScaledVector(d, 0.6);
        if (a && a.soldier && a.alive) { mz = a.soldier.muzzleWorld(new THREE.Vector3()); a.soldier.kick(); }
        g.fx.muzzle(mz, d, WEAPONS[e.w] && WEAPONS[e.w].type === 'sniper' ? 1.6 : 1);
        g.fx.tracer(mz.clone(), end);
        if (o.distanceTo(g.renderer.camera.position) < 45) audio.playShot(WEAPONS[e.w] ? WEAPONS[e.w].sound : e.w, o);
        if (a) a.radarT = 1.6;
        const p = this.me;
        if (p && p.alive) {
          const hp = p.eye(_v);
          const t = _d.copy(hp).sub(o).dot(d);
          if (t > 2 && t < o.distanceTo(end)) { const c = o.clone().addScaledVector(d, t); if (c.distanceTo(hp) < 1.3) audio.playBulletWhiz(c); }
        }
        break;
      }
      case 'hit': {
        const v = act(e.v);
        if (e.a === this.myId && v && v !== this.me) {
          g.hud.hitmarker(e.part === 'head', !!e.k); audio.playHitmarker(e.part === 'head');
          if (v.soldier && v.alive) g.fx.impact(v.soldier.chestWorld(new THREE.Vector3()), new THREE.Vector3(0, 1, 0), 'flesh');
        }
        if (e.v === this.myId) {
          g.hud.damageFrom(Math.atan2(-(e.ax - this.me.pos.x), -(e.az - this.me.pos.z)));
          this.me.aimPunch += Math.min(0.05, e.dmg * 0.0012);
          audio.playHurt(Math.min(100, e.dmg));
          g.dmgFlash = Math.min(1.2, (g.dmgFlash || 0) + e.dmg / 45);
          if (e.hp <= 30 && !e.k) audio.setLowHealth(true);
        }
        break;
      }
      case 'melee': {
        if (e.id === this.myId) break;
        const a = act(e.id);
        audio.playKnife(e.heavy ? 'heavy' : 'light', e.hit ? 'flesh' : 'miss', a ? a.pos.clone() : null);
        break;
      }
      case 'kill': {
        const v = act(e.v), at = e.a ? act(e.a) : null;
        if (v && v.soldier) {
          v.soldier.die(e.dx, e.dz, !!e.hs);
          v.alive = false; v.deadT = 0;
          audio.playDeath(v.soldier.chestWorld(new THREE.Vector3()));
          g.fx.bloodSplat(v.pos.clone());
        }
        g.hud.killFeed(at && at !== v ? at : null, v || { name: '？', team: '' }, e.w, !!e.hs, !!e.wb, e.v === this.myId || e.a === this.myId);
        if (e.v === this.myId) {
          const p = this.me; p.alive = false;
          audio.setLowHealth(false);
          p.startDeathCam(at && at !== p ? at : null);
          g.vm.setVisible(false);
          const wn = WEAPONS[e.w] ? WEAPONS[e.w].name : e.w;
          this.killedBy = at ? `被 <span style="color:${at.team === 'BL' ? '#ff9b70' : '#8cc8ff'}">${esc(at.name)}</span> 用 ${wn}${e.hs ? ' <span style="color:#ff5040">爆头</span>' : ''}击杀` : '你阵亡了';
        } else if (e.a === this.myId) {
          const me = this.me; me.stats.k++; if (e.hs) me.stats.hs++;
          let text = 'KILL', sub = `击杀 ${v ? esc(v.name) : ''}`;
          if (e.m >= 2) { text = MULTI_CN[Math.min(e.m, 8)] || 'MULTI KILL'; sub = `${e.m} 连杀 · ` + sub; setTimeout(() => audio.announce('Multi kill!'), 150); }
          else if (e.hs) { text = 'HEADSHOT'; sub = '爆头 · ' + sub; setTimeout(() => audio.announce('Headshot!'), 150); }
          else if (e.w === 'knife') { text = 'KNIFE KILL'; sub = '刀杀 · ' + sub; }
          else if (e.w === 'he') { text = 'GRENADE KILL'; sub = '手雷击杀 · ' + sub; }
          else if (e.wb) { text = 'WALLBANG'; sub = '穿墙击杀 · ' + sub; }
          g.hud.badge(text, sub, e.hs);
          audio.playKillConfirm(e.hs);
        }
        break;
      }
      case 'sw': { const a = act(e.id); if (a && a !== this.me && a.soldier && a.curW !== e.w) { a.curW = e.w; a.soldier.setWeapon(e.w); } break; }
      case 'bounce': audio.playGrenadeBounce(new THREE.Vector3(e.p[0], e.p[1], e.p[2])); break;
      case 'boom': {
        const p = new THREE.Vector3(e.p[0], e.p[1], e.p[2]);
        g.fx.explosion(p); audio.playExplosion(p);
        const camD = g.renderer.camera.position.distanceTo(p);
        g.fx.shake = Math.max(g.fx.shake || 0, Math.max(0, 1.4 - camD / 18));
        break;
      }
      case 'reload': case 'nade': case 'spawn': case 'end': break;
    }
  }
  dropRemote(id) {
    const a = this.remotes.get(id);
    if (!a) return;
    this.remotes.delete(id);
    this.g.actors = this.g.actors.filter((x) => x !== a);
    this.g.tags = this.g.tags.filter((t) => { if (t.actor === a) { this.g.renderer.scene.remove(t.sprite); return false; } return true; });
    this.g.renderer.scene.remove(a.soldier.root);
  }

  // ================= 手雷视觉 =================
  updateNadeViz(t) {
    const g = this.g;
    if (!this.nadeTpl) this.nadeTpl = buildGunMerged('he');
    const latest = this.buf[this.buf.length - 1];
    const seen = new Set(latest ? latest.nd.keys() : []);
    for (const [id, mesh] of this.nadeMeshes) if (!seen.has(id)) { g.renderer.scene.remove(mesh); this.nadeMeshes.delete(id); }
    for (const id of seen) {
      const s = this.nadAt(id, t);
      if (!s) continue;
      let mesh = this.nadeMeshes.get(id);
      if (!mesh) { mesh = this.nadeTpl.clone(); mesh.scale.setScalar(1.3); g.renderer.scene.add(mesh); this.nadeMeshes.set(id, mesh); }
      mesh.position.set(s.x, s.y, s.z);
      mesh.rotation.x += 0.2; mesh.rotation.y += 0.13;
    }
  }
  nadAt(id, t) {
    let a = null, b = null;
    for (const fr of this.buf) {
      const r = fr.nd.get(id);
      if (!r) continue;
      if (fr.st <= t) a = { st: fr.st, r };
      else { b = { st: fr.st, r }; break; }
    }
    if (!a) return null;
    if (!b) return { x: a.r[1], y: a.r[2], z: a.r[3] };
    const k = Math.max(0, Math.min(1, (t - a.st) / (b.st - a.st)));
    return { x: a.r[1] + (b.r[1] - a.r[1]) * k, y: a.r[2] + (b.r[2] - a.r[2]) * k, z: a.r[3] + (b.r[3] - a.r[3]) * k };
  }

  // ================= 预测射击表现 =================
  predShot(a, w, spread, rnd) {
    const g = this.g, d = w.def;
    const dir = shotDir(a, spread, rnd);
    const dv = new THREE.Vector3(dir.x, dir.y, dir.z);
    const cam = g.renderer.camera;
    const eye = new THREE.Vector3(a.pos.x, a.pos.y + a.eyeH, a.pos.z);
    g.vm.fire();
    g.fx.light(cam.position.clone().addScaledVector(dv, 1.2), d.type === 'sniper' ? 10 : 5, 0.06);
    audio.playShot(d.sound, null);
    if (Math.random() < 0.5) audio.playShellDrop(null);
    const hit = g.world.raycast(eye.x, eye.y, eye.z, dv.x, dv.y, dv.z, d.range, 'bullet');
    const end = eye.clone().addScaledVector(dv, hit ? hit.t : d.range);
    if (Math.random() < 0.35 || d.type === 'sniper') g.fx.tracer(cam.position.clone().addScaledVector(dv, 0.9), end);
  }

  // ================= 记分板数据 =================
  syncRoster(list) {
    const ids = new Set();
    for (const r of list) {
      ids.add(r.id);
      if (r.id === this.myId) { this.me.stats.k = r.k; this.me.stats.d = r.d; this.me.stats.hs = r.hs; this.me.ping = r.ping; continue; }
      const a = this.ensureRemote(r);
      a.stats.k = r.k; a.stats.d = r.d; a.stats.hs = r.hs; a.ping = r.ping;
      if (a.team !== r.team || a.name !== r.name) { a.team = r.team; a.name = r.name; }
      if (r.team === this.me.team && !a.tagged) { this.g.addTag(a); a.tagged = true; }
    }
    for (const id of [...this.remotes.keys()]) if (!ids.has(id)) this.dropRemote(id);
  }

  // ================= 换枪 / 退出 =================
  setLoadout(id) { this.send({ t: 'loadout', primary: id }); }
  leaveMatch() {
    const g = this.g;
    clearInterval(this.pingIv);
    this.inMatch = false; this.reconnecting = false;
    this.state = this.state === 'play' ? 'idle' : this.state;
    for (const a of this.remotes.values()) g.renderer.scene.remove(a.soldier.root);
    this.remotes.clear();
    for (const [, mesh] of this.nadeMeshes) g.renderer.scene.remove(mesh);
    this.nadeMeshes.clear();
    this.buf = []; this.pending = []; this.outbox = []; this.lastSnap = null;
    g.net = null;
  }
  leave() {
    this.manualLeave = true;
    this.send({ t: 'leave' });
    try { sessionStorage.removeItem('cf_ticket'); } catch (e) { /* 忽略 */ }
    this.leaveMatch();
    if (this.ws) { const ws = this.ws; this.ws = null; try { ws.close(); } catch (e) { /* 忽略 */ } }
    this.manualLeave = false;
  }
  async quickStart() { // ?autonet 测试直连
    try {
      await this.connect();
      this.send({ t: 'hello', proto: PROTO_VERSION, name: '测试员' });
      await new Promise((r) => setTimeout(r, 250));
      this.send({ t: 'quick' });
    } catch (e) { this.g.hud.toast('联机失败：' + e.message, 4); }
  }
  banner(s) {
    let el = document.getElementById('netBanner');
    if (!el) { el = document.createElement('div'); el.id = 'netBanner'; document.getElementById('ui').appendChild(el); }
    el.textContent = s;
    el.classList.toggle('on', !!s);
  }
}
