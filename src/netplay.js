// 联机对战客户端：WebSocket 网关连接、房间大厅、本地预测 / 服务端和解、远端插值、事件表现、断线重连
import * as THREE from 'three';
import { Actor } from './actor.js';
import { Player } from './player.js';
import { applyCmd, unpackSelf, resetForSpawn, shotDir, F } from './netsim.js';
import { makeLoadout } from './weaponsim.js';
import { B, TICK_RATE, INTERP_DELAY, PROTO_VERSION, decodeWorld } from './protocol.js';
import { WEAPONS, PRIMARIES } from './weapons.js';
import { buildGunMerged } from './guns.js';
import { audio } from './audio.js';
import { SUPPLY_NAME } from './supplies.js';
import { MAPS, MAP_IDS, mapName, suppliesForMap } from './maps.js';
import { dressSoldier, undressSoldier, hitMatOf, bump, emitAmbient, bossLod, prewarmBossFx, BOSS_TINT } from './bosslook.js';

const DT = 1 / TICK_RATE;
const PVE_DIFF_CN = { easy: '轻松', normal: '普通', hard: '困难', hell: '炼狱' };
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
    this._worlds = new Map(); // 二进制世界快照按 tick 缓存，等待同名 JSON 控制帧合并
    this.nadeMeshes = new Map(); this.nadeTpl = null;
    this.lastSnap = null; this.killedBy = null; this._lastLife = undefined; this._endShown = false; this.boardShown = false;
    this.renderOff = new THREE.Vector3(); // 和解软修正的视觉偏移（渐消）
    this.spectate = false; this.specTarget = 0; this.specTab = false;
    this.props = null; this.supMask = 0; this.dp = []; this._supSent = -1;  // PVE 补给站 / 空投
    this.lamp = null;                                                        // 全场共用的 BOSS 灯
    this.boss = null;                                                        // 当前 BOSS 血条来源
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
      this.ws.binaryType = 'arraybuffer';
      const to = setTimeout(() => rej(new Error('连接超时')), 6000);
      this.ws.onopen = () => { clearTimeout(to); res(); };
      this.ws.onerror = () => { clearTimeout(to); rej(new Error('无法连接服务器')); };
      this.ws.onmessage = (ev) => this.onFrame(ev);
      this.ws.onclose = () => this.onClose();
    });
  }
  helloMsg() {
    let tk = this.ticket || null;
    if (!tk) { try { tk = sessionStorage.getItem('cf_ticket'); } catch (e) { /* 忽略 */ } }
    this.send({ t: 'hello', proto: PROTO_VERSION, name: this.playerName(), ticket: tk || undefined });
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }

  // 统一帧路由：二进制 = 世界快照（按 tick 缓存），文本 = JSON 控制帧（合并世界后处理）
  onFrame(ev) {
    const d = ev.data;
    if (typeof d === 'string') { let m; try { m = JSON.parse(d); } catch (e) { return; } this.onCtl(m); return; }
    const w = decodeWorld(d);
    if (!w) return;
    this._worlds.set(w.tick, w);
    if (this._worlds.size > 16) this._worlds.delete(this._worlds.keys().next().value); // 淘汰最旧
  }

  onCtl(m) {
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
      case 'spectating':
        this.reconnecting = false; this.banner('');
        this.startSpectate(m);
        break;
      case 'snap': {
        if (!this.inMatch) break;
        const w = this._worlds.get(m.tick);
        if (!w) break; // 对应世界帧被丢弃：跳过该 tick，下一帧追平
        this._worlds.delete(m.tick);
        this.onSnap({ st: w.st, tick: w.tick, ps: w.ps, nd: w.nd, sc: w.sc, tl: w.tl, gs: w.gs, me: m.me, ev: m.ev, roster: m.roster, spect: m.spect, sup: m.sup, dp: m.dp });
        break;
      }
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
    if (this.spectate) { this.g.hud.toast('观战连接已断开', 3); this.leaveMatch(); this.openLobby(); return; }
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
        ws.binaryType = 'arraybuffer';
        await new Promise((res, rej) => {
          const to = setTimeout(() => rej(new Error('t')), 4000);
          ws.onopen = () => { clearTimeout(to); res(); };
          ws.onerror = () => { clearTimeout(to); rej(new Error('e')); };
        });
        ws.onmessage = (ev) => this.onFrame(ev);
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
 <div class="title" style="margin-bottom:6px"><div class="logo">CROSSFIRE · 联机对战</div><h1 style="font-size:32px">房间大厅</h1></div>
 <div class="row2">
  <div class="opt"><div class="lab">昵称（主菜单已选主武器；联机阵营进入房间时自动平衡，PVE 全员同队）</div><div class="netinp"><input type="text" id="netName" maxlength="12" placeholder="输入昵称"></div></div>
  <div class="opt"><div class="lab">创建房间 · 目标击杀（可直接输入 1–999）</div><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><div class="seg" data-kg="goal"><button data-v="30">30杀</button><button data-v="50" class="on">50杀</button><button data-v="100">100杀</button></div><input type="number" id="netGoal" min="1" max="999" step="1" value="50" style="width:76px;padding:5px 6px;background:#141821;border:1px solid #38424f;border-radius:5px;color:#e8ecf3;text-align:center;font:inherit"></div><div class="seg" data-kg="max" style="margin-top:6px"><button data-v="8">8人</button><button data-v="16" class="on">16人</button></div></div>
 </div>
 <div class="row2">
  <div class="opt"><div class="lab">地图</div><div class="seg" data-kg="map">${MAP_IDS.map((id) => `<button data-v="${id}"${id === 'ship' ? ' class="on"' : ''}>${esc(MAPS[id].name)}</button>`).join('')}</div></div>
  <div class="opt"><div class="lab">模式（PVE 有终极 BOSS 与补给站，BOSS 登场后按 G 可附身）</div><div class="seg" data-kg="mode"><button data-v="pvp" class="on">团队对抗 PVP</button><button data-v="pve">僵尸挑战 PVE</button></div></div>
 </div>
 <div class="row2">
  <div class="opt" id="pveOpt" style="display:none"><div class="lab">PVE 难度</div><div class="seg" data-kg="diff"><button data-v="easy">轻松</button><button data-v="normal" class="on">普通</button><button data-v="hard">困难</button><button data-v="hell">炼狱</button></div></div>
  <div class="opt"><div class="lab">地图特点</div><div class="note" id="mapDesc">${esc(MAPS.ship.desc)}</div></div>
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
    const o = { goal: 50, max: 16, mode: 'pvp', diff: 'normal', map: 'ship' };
    const pveOpt = d.querySelector('#pveOpt');
    const mapDesc = d.querySelector('#mapDesc');
    const goalInp = d.querySelector('#netGoal');
    for (const seg of d.querySelectorAll('.seg[data-kg]')) for (const b of seg.querySelectorAll('button')) b.addEventListener('click', () => {
      for (const x of seg.querySelectorAll('button')) x.classList.remove('on');
      b.classList.add('on'); o[seg.dataset.kg] = b.dataset.v;
      if (seg.dataset.kg === 'goal' && goalInp) goalInp.value = b.dataset.v;   // 点预设同步到手输框
      if (seg.dataset.kg === 'mode') pveOpt.style.display = b.dataset.v === 'pve' ? '' : 'none';
      if (seg.dataset.kg === 'map') mapDesc.textContent = (MAPS[b.dataset.v] || MAPS.ship).desc;
      this.g.audio?.playUI?.('click');
    });
    // 手输目标击杀：夹在 1~999，与预设不冲突（输入自定义值就取消预设高亮）
    const clampGoal = (v) => { const n = Math.round(+v); return Math.max(1, Math.min(999, Number.isFinite(n) ? n : 50)); };
    if (goalInp) {
      goalInp.addEventListener('input', () => {
        o.goal = goalInp.value;
        for (const b of d.querySelectorAll('.seg[data-kg="goal"] button')) b.classList.toggle('on', goalInp.value !== '' && b.dataset.v === String(clampGoal(goalInp.value)));
      });
      goalInp.addEventListener('blur', () => { goalInp.value = String(clampGoal(goalInp.value)); o.goal = goalInp.value; });
    }
    const goalVal = () => clampGoal(goalInp && goalInp.value !== '' ? goalInp.value : o.goal);
    const nameInp = d.querySelector('#netName');
    nameInp.value = this.playerName();
    nameInp.addEventListener('change', () => this.saveName());
    d.querySelector('#netQuick').addEventListener('click', () => { this.saveName(); this.send({ t: 'quick', primary: this.g.opts.primary, mode: o.mode, diff: o.diff, goal: goalVal(), max: +o.max, map: o.map }); this.setStatus('正在匹配…'); });
    d.querySelector('#netCreate').addEventListener('click', () => {
      this.saveName();
      const pve = o.mode === 'pve';
      this.send({ t: 'create', name: pve ? `${this.playerName()}的挑战` : `${this.playerName()}的战场`, goal: goalVal(), max: +o.max, primary: this.g.opts.primary, mode: o.mode, diff: o.diff, map: o.map });
      this.setStatus(pve ? '正在开启僵尸挑战…' : '正在创建…');
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
      <div class="roomRow"><b>${esc(r.name)}</b><span class="rm">${r.mn ? `<em class="maptag">${esc(r.mn)}</em>` : ''}${r.mode === 'pve' ? `<em class="pvetag">PVE ${esc(PVE_DIFF_CN[r.diff] || '普通')} · 第 ${(r.wave || 0) + 1} 波</em>${r.boss ? `<em class="pvetag">⚠ ${esc(r.boss.nm)}${r.boss.by ? ' · 玩家附身' : ''}</em>` : ''} ` : ''}${r.n}/${r.max} 人${r.sp ? ` · 观战 ${r.sp}` : ''} · ${r.mode === 'pve' ? `已清除 <i>${r.score ? r.score.BL : 0}</i> 只 · 阵亡 <i>${r.score ? r.score.GR : 0}</i>` : `潜伏 <i>${r.bl}</i>:<i>${r.gr}</i> 保卫 · 目标 ${r.goal}`} · ${r.state === 'play' ? `剩 ${Math.round(r.timeLeft)}s` : '结算中'}</span><button class="jin" data-rid="${esc(r.id)}">加入</button><button class="jin spectbtn" data-rid="${esc(r.id)}">观战</button></div>`).join('');
    for (const b of this.roomList.querySelectorAll('button.jin')) b.addEventListener('click', () => {
      this.saveName();
      const spect = b.classList.contains('spectbtn');
      this.send({ t: spect ? 'spectate' : 'join', rid: b.dataset.rid, primary: this.g.opts.primary });
      this.setStatus(spect ? '正在进入观战…' : '正在加入…');
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
  // 进入房间前把场景换成该房间那张图（客户端与服务端用同一份建造代码，坐标不会漂）
  async enterMap(id) {
    const want = id || 'ship';
    const g = this.g;
    if (!g.setMap || g.mapId === want) return;
    this.banner(`正在搭建 ${mapName(want)}…`);
    try { await g.setMap(want); } catch (e) { console.warn('换图失败', e); }
    this.banner('');
    g.hud.toast(`地图 <b style="color:#f5b321">${esc(mapName(want))}</b> · ${esc((MAPS[want] || MAPS.ship).desc)}`, 3.5);
  }
  async startMatch(w) {
    const g = this.g;
    await this.enterMap(w.room && w.room.map);
    this.clearScene();
    if (this.lobby) this.lobby.classList.add('hidden');
    this.room = w.room; this.myId = w.you; this.ticket = w.ticket || this.ticket;
    this.ensureLamp();                                     // 先备好 BOSS 灯，换装时直接挂上
    if (w.room.mode === 'pve') prewarmBossFx(g.renderer.renderer, g.renderer.scene, g.renderer.camera);   // 加载期编好 BOSS 着色器，登场零编译
    this.isHost = w.room.owner === w.you;
    this.state = 'play'; this.inMatch = true; this.manualLeave = false;
    this.spectate = false; this.specTab = false; this.boardShown = false;
    audio.init(); audio.setVolumes({ master: g.opts.vol }); audio.startAmbient();

    g.score = { ...w.room.score }; g.goal = w.room.goal; g.timeLeft = w.room.timeLeft;
    this.stAt = w.st; this.stLocal = performance.now() / 1000;
    this.buf = []; this._worlds.clear(); this.seq = 1; this.pending = []; this.outbox = []; this.acc = 0;
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
    this.supMask = w.sup || 0; this.dp = w.dp || [];
    this.boss = null; for (const r of w.roster) if (r.boss) this.boss = { id: r.id, nm: r.boss === 2 ? (r.bnm || r.name) : r.name, hp: r.hp, hpMax: r.hpMax, by: r.boss === 2 ? 1 : 0, who: r.boss === 2 ? r.name : '' };
    this.ensureProps(); this.syncCrates(this.dp); this.refreshBossBar();
    g.vm.setTeam(w.team); g.vm.equip(me.weapon.id, 0.6); g.vm.setVisible(true);
    g.vm.setBossLook(me.isBoss ? me.bossKind : null); g.hud.bossVeil(me.isBoss ? (BOSS_TINT[me.bossKind] || '#ff7a3c') : null);
    g.hud.slots(me.inv, 0);
    g.hud.show(null);
    g.playing = true; g.paused = false; g.ended = false;
    g.net = this;
    g.lock();
    g.hud.toast(w.room.mode === 'pve'
      ? `<b style="color:#ff8f6e">僵尸挑战</b> · ${esc(w.room.name)} · ${PVE_DIFF_CN[w.room.diff] || '普通'} · 顶住船尾，留意发光补给箱，BOSS 登场后可按 <b>G</b> 附身`
      : `已加入 <b style="color:#f5b321">${esc(w.room.name)}</b> · ${w.team === 'BL' ? '潜伏者' : '保卫者'} · 目标 ${w.room.goal} 击杀`, 4);
    if (w.room.mode === 'pve') setTimeout(() => g.hud.toast('发光的箱子是补给点（弹药 / 医疗 / 护甲），BOSS 登场后按 <b>G</b> 可附身它', 6), 4200);
    setTimeout(() => audio.announce('Go go go!'), 500);

    if (this.isHost || w.room.mode === 'pve') this.bindMatchKeys();
    this.pingIv = setInterval(() => {
      this.pn++; this.pings.set(this.pn, performance.now() / 1000);
      this.send({ t: 'ping', c: this.pn, r: this.rtt });
    }, 600);
  }
  // 全场一盏 BOSS 灯：光源数量恒定，登场时只换颜色和位置，不触发着色器重编译；低画质直接不给
  ensureLamp() {
    if (this.lamp || !this.room || this.room.mode !== 'pve' || this.g.opts.quality === 'low') return;
    const l = new THREE.PointLight(0xffffff, 0, 18, 2);
    this.g.renderer.scene.add(l);
    this.lamp = l;
  }
  lookOpts() { return { lamp: this.lamp }; }
  dropLamp() {
    if (!this.lamp) return;
    this.g.renderer.scene.remove(this.lamp);
    this.lamp.dispose();
    this.lamp = null;
  }
  ensureRemote(r) {
    // 外观换装：roster.kind 对怪物是怪种、对被附身的玩家是 BOSS 种类；boss=2 表示车里坐的是人
    const dress = (a) => {
      const key = r.kind || null, poss = r.boss === 2;
      if (a._dressKey === key && a._dressPoss === poss) return;
      a._dressKey = key; a._dressPoss = poss;
      if (key) {
        dressSoldier(a.soldier, key, poss, this.lookOpts());
        if (r.boss && a.id === this._bossFresh) { bump(a.soldier, 2.2); this._bossFresh = 0; }   // 刚登场：光效先炸一下
      } else undressSoldier(a.soldier);
    };
    if (this.remotes.has(r.id)) {
      const a = this.remotes.get(r.id);
      a.name = r.name; a.team = r.team;
      if (r.bot != null) a.isBot = !!r.bot;
      a.kind = r.kind || null; a.isMonster = !!r.kind; a.isBoss = !!r.boss;
      a.bossHp = r.hp || 0; a.bossHpMax = r.hpMax || 0;
      dress(a);
      return a;
    }
    const a = new Actor(this.g, { id: r.id, name: r.name, team: r.team });
    a.alive = false; a.soldier.root.visible = false; a.ping = r.ping || 0; a.radarT = 0; a.deadT = 0; a.curW = null; a.isBot = !!r.bot;
    a.kind = r.kind || null; a.isMonster = !!r.kind; a.isBoss = !!r.boss; a.bossHp = r.hp || 0; a.bossHpMax = r.hpMax || 0;
    dress(a);
    this.remotes.set(r.id, a);
    this.g.actors.push(a);
    return a;
  }

  // 进房前清场：单机 bot、旧对局角色、队友名牌全部移出场景
  clearScene() {
    const g = this.g;
    for (const a of g.actors) if (a.soldier) { undressSoldier(a.soldier); g.renderer.scene.remove(a.soldier.root); }
    for (const a of this.remotes.values()) { undressSoldier(a.soldier); g.renderer.scene.remove(a.soldier.root); }
    for (const t of g.tags) g.renderer.scene.remove(t.sprite);
    for (const [, mesh] of this.nadeMeshes) g.renderer.scene.remove(mesh);
    this.nadeMeshes.clear();
    this.dropProps();
    this.dropLamp();
    this.boss = null;
    this.remotes.clear();
    g.actors = []; g.tags = [];
  }

  // ================= 观战 =================
  async startSpectate(m) {
    const g = this.g;
    await this.enterMap(m.room && m.room.map);
    this.clearScene();
    if (this.lobby) this.lobby.classList.add('hidden');
    this.state = 'play'; this.inMatch = true; this.manualLeave = false;
    this.spectate = true; this.me = null; this.myId = 0;
    audio.init(); audio.setVolumes({ master: g.opts.vol }); audio.startAmbient();
    g.score = { ...m.room.score }; g.goal = m.room.goal; g.timeLeft = m.room.timeLeft;
    this.stAt = m.st; this.stLocal = performance.now() / 1000;
    this.buf = []; this._worlds.clear(); this.lastSnap = null; this.specTarget = 0; this.specTab = false; this.boardShown = false; this._endShown = false;
    g.player = null; g.actors = [];
    g.net = this; g.playing = true; g.paused = false; g.ended = false;
    g.vm.setVisible(false);
    g.hud.show(null);
    this.room = m.room;                                   // 观战也要知道房间模式（补给站 / BOSS 血条）
    this.ensureLamp();
    if (m.room.mode === 'pve') prewarmBossFx(g.renderer.renderer, g.renderer.scene, g.renderer.camera);   // 观战同样会在场上看到 BOSS，先编好
    for (const r of m.roster) this.ensureRemote(r);
    this.supMask = m.sup || 0; this.dp = m.dp || [];
    for (const r of m.roster) if (r.boss) this.boss = { id: r.id, nm: r.boss === 2 ? (r.bnm || r.name) : r.name, hp: r.hp, hpMax: r.hpMax, by: r.boss === 2 ? 1 : 0, who: r.boss === 2 ? r.name : '' };
    this.ensureProps(); this.syncCrates(this.dp); this.refreshBossBar();
    g.hud.toast(`观战 <b style="color:#f5b321">${esc(m.room.name)}</b> · V 切换目标 · Tab 计分板 · Esc 菜单`, 5);
    this.pingIv = setInterval(() => {
      this.pn++; this.pings.set(this.pn, performance.now() / 1000);
      this.send({ t: 'ping', c: this.pn, r: this.rtt });
    }, 1500);
    if (!this._specKeys) {
      this._specKeys = (e) => {
        if (!this.spectate || this.g.paused) return;
        if (e.code === 'KeyV') this.specCycle();
        if (e.code === 'Tab') { e.preventDefault(); this.specTab = e.type === 'keydown'; }
        if (e.code === 'Escape') { this.g.paused = true; this.g.hud.show('pause'); }
      };
      window.addEventListener('keydown', this._specKeys);
      window.addEventListener('keyup', this._specKeys);
    }
  }
  specCycle() {
    const list = [...this.remotes.values()].filter((a) => a.alive && a.wasOnline);
    if (!list.length) return;
    const i = list.findIndex((a) => a.id === this.specTarget);
    const t = list[(i + 1) % list.length];
    if (t && t.id !== this.specTarget) { this.specTarget = t.id; this.g.hud.toast(`观战：${esc(t.name)}（${t.stats.k} 杀）`, 2); }
  }
  spectPick() {
    let t = this.remotes.get(this.specTarget);
    if (!t || !t.alive || !t.wasOnline || !t.vPos) {
      const list = [...this.remotes.values()].filter((a) => a.alive && a.wasOnline && a.vPos);
      list.sort((x, y) => y.stats.k - x.stats.k);
      t = list[0] || null;
      this.specTarget = t ? t.id : 0;
    }
    return t;
  }
  spectCam(dt) {
    const g = this.g, cam = g.renderer.camera;
    const t = this.spectPick();
    if (!t) { // 无人存活：俯视运输船巡航
      const ang = (g.realTime || 0) * 0.05;
      cam.position.set(Math.cos(ang) * 42 - 4, 14, Math.sin(ang) * 30);
      cam.lookAt(-4, 1.5, 0);
      cam.fov += (g.opts.fov - cam.fov) * Math.min(1, dt * 4); cam.updateProjectionMatrix();
      return;
    }
    const eyeY = t.vPos.y + (t.crouch ? 1.05 : 1.62);
    const k = Math.min(1, dt * 8);
    cam.position.x += (t.vPos.x - cam.position.x) * k;
    cam.position.y += (eyeY - cam.position.y) * k;
    cam.position.z += (t.vPos.z - cam.position.z) * k;
    cam.rotation.order = 'YXZ';
    cam.rotation.y = lerpAngle(cam.rotation.y, t.vYaw, Math.min(1, dt * 10));
    cam.rotation.x += (THREE.MathUtils.clamp(t.vPitch, -1.4, 1.4) - cam.rotation.x) * Math.min(1, dt * 10);
    cam.rotation.z = 0;
    cam.fov += (g.opts.fov - cam.fov) * Math.min(1, dt * 6);
    cam.updateProjectionMatrix();
  }
  spectHud(dt) {
    const g = this.g;
    g.frame++;
    this.pulseProps(g.time);
    this.refreshBossBar();
    const t = this.remotes.get(this.specTarget);
    const ghost = t && t.vPos ? { pos: t.vPos, yaw: t.vYaw, team: t.team } : { pos: g.renderer.camera.position, yaw: 0, team: 'BL' };
    g.hud.update(dt, {
      score: g.score, timeLeft: g.timeLeft, goal: g.goal, myTeam: ghost.team,
      hp: 100, armor: 100, alive: true, weapon: null, scoped: 0, spreadPx: 0,
      yaw: ghost.yaw, respawnIn: 0, killedBy: null, protect: 0, aimName: '', aimTeam: '',
    });
    g.hud.drawRadar(ghost, g.actors, g.time);
    const tab = this.specTab && g.playing && !g.paused;
    if (tab !== this.boardShown || (tab && g.frame % 20 === 0)) { this.boardShown = tab; g.hud.scoreboard(tab, g.actors, 0, g.score); }
  }

  // ================= 对局：每帧 =================
  update(dt) {
    const g = this.g, p = this.me;
    g.time += dt;
    g.dmgFlash = Math.max(0, (g.dmgFlash || 0) - dt * 1.6);

    if (p) {
      // 预测：固定 1/30 步
      this.tickFirst = true;
      this.acc = Math.min(this.acc + dt, 0.15);
      let n = 0;
      while (this.acc >= DT && n < 5) { this.acc -= DT; n++; this.tick(); this.tickFirst = false; }
      if (this.acc >= DT) this.acc = 0;
      p.walk = p.keys.has('ShiftLeft') || p.keys.has('ShiftRight');
      p.updateCamera(dt);
      if (!p.alive) p.deadT += dt; else p.deadT = 0;
      // 和解软修正：视觉偏移渐消，消除视角跳变
      if (this.renderOff.lengthSq() > 1e-8) {
        g.renderer.camera.position.add(this.renderOff);
        this.renderOff.multiplyScalar(Math.exp(-dt * 9));
        if (this.renderOff.lengthSq() <= 1e-8) this.renderOff.set(0, 0, 0);
      }
    }

    const rt = this.renderT();
    for (const [id, a] of this.remotes) this.applyRemote(id, a, rt, dt);
    this.updateNadeViz(rt);
    this.pulseProps(rt || g.time);

    for (const t of g.tags) {
      const a = t.actor;
      t.sprite.visible = a.alive && a.vPos && a.vPos.distanceTo(g.renderer.camera.position) < (t.big ? 120 : 45);
      if (t.sprite.visible) { a.soldier.headWorld(t.sprite.position); t.sprite.position.y += 0.42; }
    }
    if (this.lastSnap) { g.score = this.lastSnap.sc || g.score; g.timeLeft = this.lastSnap.tl; }

    if (this.spectate || !p) { this.spectCam(dt); this.spectHud(dt); return; }

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
    const at = g.aimTarget && g.aimTarget.alive ? g.aimTarget : null;
    const atTag = at ? (at.isBoss ? 'BOSS' : at.isMonster ? 'MON' : at.team) : '';
    const atName = at ? (at.isBoss ? '☠ ' + (this.boss && this.boss.id === at.id ? this.boss.nm : at.name) : at.name) : '';
    g.hud.update(dt, {
      score: g.score, timeLeft: g.timeLeft, goal: g.goal, myTeam: p.team,
      hp: p.hp, hpMax: p.hpMax || 100, armor: p.armor, alive: p.alive, weapon: p.weapon,
      scoped: p.scoped && p.weapon.def.type === 'sniper', spreadPx: this.spreadPx(),
      yaw: p.yaw, respawnIn: p.respawnT, killedBy: this.killedBy, protect: p.protectT,
      aimName: atName, aimTeam: atTag,
    });
    g.hud.drawRadar(p, g.actors, g.time);
    const tab = p.keys.has('Tab') && g.playing && !g.paused;
    if (tab !== this.boardShown || (tab && g.frame % 20 === 0)) { this.boardShown = tab; g.hud.scoreboard(tab, g.actors, p.id, g.score); }
    if (!this.reconnecting) this.flush();
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
    if (typeof m.sup === 'number') { this.supMask = m.sup; this.applySup(m.sup); }
    if (m.dp) { this.dp = m.dp; this.syncCrates(m.dp); }
    if (m.ev) for (const e of m.ev) this.onEvent(e);
    this.reconcile(m.me);
    this.refreshBossBar();
    if (m.gs === 'end' && !this._endShown) {
      this._endShown = true;
      const pve = this.room && this.room.mode === 'pve';
      this.g.hud.toast(pve
        ? `本轮结束 · 清除 <b>${m.sc.BL}</b> 只 · 阵亡 <b>${m.sc.GR}</b> 次 · 10 秒后开始新一轮`
        : `本局结束 · 潜伏者 <b>${m.sc.BL}</b> : <b>${m.sc.GR}</b> 保卫者 · 10 秒后开始新一局`, 6);
    }
    if (m.gs === 'play') this._endShown = false;
  }
  reconcile(sme) {
    const g = this.g, p = this.me;
    if (!p || !sme) return;
    while (this.pending.length && this.pending[0].s <= sme.ack) this.pending.shift();
    const rest = this.pending.slice();
    const keepYaw = p.yaw, keepPitch = p.pitch;
    const bx = p.pos.x, by = p.pos.y, bz = p.pos.z; // 回滚前的预测终点
    unpackSelf(p, sme);
    p.yaw = keepYaw; p.pitch = keepPitch;
    for (const c of rest) applyCmd(p, c, g.world, g.actors, this.nop);
    // 软修正：检测到新误差时注入视觉偏移（大误差=传送/卡墙则硬拉），小误差自然渐消
    const ex = bx - p.pos.x, ey = by - p.pos.y, ez = bz - p.pos.z;
    const err2 = ex * ex + ey * ey + ez * ez;
    if (err2 > 0.0009) {
      if (err2 < 1.44) this.renderOff.set(ex, ey, ez);
      else this.renderOff.set(0, 0, 0);
    }
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
        this.renderOff.set(0, 0, 0);
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
    a.pos.set(x, y, z); // 逻辑位置：服务端真值（小地图等用）
    const wasAlive = a.alive;
    a.alive = !!(f & F.alive);
    a.crouch = !!(f & F.crouch);
    a.onGround = !!(f & F.ground);
    a.protectT = (f & F.protect) ? 1 : 0;
    const online = !!(f & F.online);
    // 视觉平滑：位置/朝向低通跟随，传送（重生、大跳变、超时回收）硬切
    if (!a.vPos) { a.vPos = new THREE.Vector3(x, y, z); a.vYaw = yaw; a.vPitch = pitch; }
    const jump = Math.hypot(x - a.vPos.x, y - a.vPos.y, z - a.vPos.z);
    const reappear = !wasAlive && a.alive;
    if (jump > 3 || reappear || !a.wasOnline && online) { a.vPos.set(x, y, z); a.vYaw = yaw; a.vPitch = pitch; }
    else {
      const kp = Math.min(1, dt * 16), ky = Math.min(1, dt * 13);
      a.vPos.x += (x - a.vPos.x) * kp; a.vPos.y += (y - a.vPos.y) * kp; a.vPos.z += (z - a.vPos.z) * kp;
      a.vYaw = lerpAngle(a.vYaw, yaw, ky);
      a.vPitch += (pitch - a.vPitch) * Math.min(1, dt * 16);
    }
    a.wasOnline = online;
    a.yaw = a.vYaw; a.pitch = a.vPitch - a.punchP;
    if (a.curW !== wid) { a.curW = wid; a.soldier.setWeapon(wid || 'knife'); }
    // 离镜头越近，加性光斑越该退场：BOSS 贴脸时这几层面片就是全屏，帧时能吃掉整场的 6 倍
    if (a.soldier.fxRefs) {
      const dc = Math.sqrt(a.vPos.distanceToSquared(g.renderer.camera.position));
      bossLod(a.soldier, dc);
      if (a.alive && a.isBoss && a.soldier.lookKey && dc < 55) emitAmbient(a.soldier, g.fx, dt);
    }
    if (a.alive) {
      if (!wasAlive) { a.soldier.reset(); a.deadT = 0; }
      a.soldier.root.visible = true;
      a.soldier.root.position.copy(a.vPos);
      a.soldier.root.rotation.y = a.vYaw;
      const sp = Math.hypot(vx, vz); a.speed = sp;
      const fwd = sp > 0.01 ? (vx * -Math.sin(a.vYaw) + vz * -Math.cos(a.vYaw)) / sp : 0;
      a.soldier.update(dt, { speed: sp, fwd, crouch: a.crouch, pitch: a.vPitch, onGround: a.onGround, reloading: !!(f & F.reload) });
      // 出生保护闪烁；断线者半透明式忽隐忽现（幽灵）
      a.soldier.mesh.visible = online ? !(a.protectT > 0 && Math.sin(this.g.time * 30) > 0.3) : Math.sin(this.g.time * 5) > -0.2;
    } else {
      a.soldier.root.visible = true;
      a.soldier.root.position.copy(a.vPos);
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
      case 'wave': g.hud.toast(`<b style="color:#ff5a49">第 ${e.n} 波 · ${e.total} 只</b> 从船头冲过来了`, 3.5); audio.announce('Incoming!'); break;
      case 'shot': {
        if (e.id === this.myId) break; // 预测已表现
        const o = new THREE.Vector3(e.o[0], e.o[1], e.o[2]);
        const d = new THREE.Vector3(e.d[0], e.d[1], e.d[2]);
        const end = o.clone().addScaledVector(d, e.t);
        const a = act(e.id);
        let mz = o.clone().addScaledVector(d, 0.6);
        if (a && a.soldier && a.alive) { mz = a.soldier.muzzleWorld(new THREE.Vector3()); a.soldier.kick(); }
        g.fx.muzzle(mz, d, WEAPONS[e.w] && WEAPONS[e.w].type === 'sniper' ? 1.6 : 1);
        const pel = e.p > 1 ? e.p : 1;
        for (let k = 0; k < pel; k++) {
          const dd = k === 0 ? d.clone() : d.clone();
          if (k > 0) { dd.x += (Math.random() - 0.5) * 0.14; dd.y += (Math.random() - 0.5) * 0.14; dd.z += (Math.random() - 0.5) * 0.14; dd.normalize(); }
          g.fx.tracer(mz.clone(), o.clone().addScaledVector(dd, e.t));
        }
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
        if (this.boss && e.v === this.boss.id && typeof e.hp === 'number') { this.boss.hp = e.hp; this.refreshBossBar(); }
        if (e.a === this.myId && v && v !== this.me) {
          g.hud.hitmarker(e.part === 'head', !!e.k); audio.playHitmarker(e.part === 'head');
          if (v.soldier && v.alive) g.fx.impact(v.soldier.chestWorld(new THREE.Vector3()), new THREE.Vector3(0, 1, 0), hitMatOf(v));
          if (v.isBoss && v.soldier) bump(v.soldier, 0.28);   // 每中一枪本体闪一下，确认火力真的落在它身上
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
          if (v.isBoss) {
            // BOSS 倒下要有一场"塌掉"的动静：本体位置爆成一团酸液/火星 + 镜头震
            const c = v.soldier.chestWorld(new THREE.Vector3());
            g.fx.explosion(c); g.fx.impact(c, new THREE.Vector3(0, 1, 0), hitMatOf(v));
            g.fx.shake = Math.max(g.fx.shake || 0, Math.max(0, 1.1 - g.renderer.camera.position.distanceTo(c) / 26));
          }
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
      case 'bossin': {
        this.boss = { id: e.id, nm: e.nm, hp: e.hp, hpMax: e.hpMax, by: 0, who: '' };
        this._bossFresh = e.id;
        const ba = this.remotes.get(e.id);
        if (ba) { bump(ba.soldier, 2.2); this._bossFresh = 0; }
        g.hud.toast(`<b style="color:#ff4d3d">⚠ ${esc(e.nm)} 登场</b> · ${e.hpMax} 血量 · 按 <b>G</b> 可附身它`, 5);
        audio.announce('Boss incoming!');
        break;
      }
      case 'boss': this.bossFx(e); break;
      case 'blast': {
        const p = new THREE.Vector3(e.p[0], e.p[1], e.p[2]);
        g.fx.explosion(p);
        g.fx.light(p, 2.2, 0.45, e.k === 'acid' ? 0x74d94a : 0xffa850, 18);
        audio.playExplosion(p);
        const cd = g.renderer.camera.position.distanceTo(p);
        // 震动封顶到手雷同级：BOSS 技能半径大，线性放大能到 3.7 倍，镜头甩到人发晕
        g.fx.shake = Math.max(g.fx.shake || 0, Math.min(1.2, Math.max(0, (e.r || 4) * 0.8 - cd / 8)));
        break;
      }
      case 'bossdown':
        this.boss = null; g.hud.bossBar(null);
        g.hud.toast(`<b style="color:#8ce36a">${esc(e.nm)} 被击倒</b> · 空投已落下 · 补给站全部刷新`, 5);
        audio.announce('Target down');
        break;
      case 'sup': {
        const who = act(e.id);
        if (e.id === this.myId) { audio.playUI('buy'); g.hud.toast(`<b style="color:#f5b321">补给到手</b> · ${SUPPLY_NAME[e.k] || '补给'}`, 1.8); }
        else if (who && who.vPos && g.renderer.camera.position.distanceTo(who.vPos) < 20) g.hud.toast(`${esc(who.name)} 正在补给`, 1.5);
        break;
      }
      case 'picked':
        if (e.id === this.myId) { audio.playUI('buy'); g.hud.toast('<b style="color:#ffb03a">空投已开启</b> · 生命 / 护甲 / 弹药全满', 3); }
        break;
      case 'possess': {
        this.boss = { id: e.id, nm: e.nm, hp: e.hpMax, hpMax: e.hpMax, by: 1, who: e.name };
        if (e.id === this.myId) {
          this.swapSelfLoadout(e.prim);
          g.vm.setBossLook(e.k);                       // 第一人称：手臂变成骨爪，袖口染上本种颜色
          g.hud.bossVeil(BOSS_TINT[e.k] || '#ff7a3c');
        } else {
          const a = this.remotes.get(e.id);
          if (a && a.soldier) { a.kind = e.k; a.isBoss = true; a._dressKey = e.k; a._dressPoss = true; dressSoldier(a.soldier, e.k, true, this.lookOpts()); bump(a.soldier, 1.8); }
        }
        g.hud.toast(e.id === this.myId
          ? `<b style="color:#ff4d3d">你现在就是 ${esc(e.nm)}</b> · ${e.hpMax} 血量 · 重武器 · 按 <b>G</b> 交还 AI`
          : `<b style="color:#ff9b70">${esc(e.name)}</b> 附身了 ${esc(e.nm)}，转头对付自己人`, 4.5);
        audio.announce(e.id === this.myId ? 'You are the boss' : 'Boss possessed');
        break;
      }
      case 'unpossess': {
        if (e.id === this.myId) {
          this.swapSelfLoadout(e.prim);
          g.vm.setBossLook(null); g.hud.bossVeil(null);
          if (this.me) { this.me.isBoss = false; this.me.bossKind = null; }
        } else {
          const a = this.remotes.get(e.id);
          if (a && a.soldier) { a.isBoss = false; a.kind = null; a._dressKey = null; a._dressPoss = false; undressSoldier(a.soldier); }
        }
        g.hud.toast(e.id === this.myId
          ? (e.dead ? '你被击倒 · BOSS 本轮退场' : '已把 BOSS 交还 AI · 按 G 可再次附身')
          : `${esc(e.name)} ${e.dead ? '被击倒，BOSS 退场' : '交出了 BOSS 控制权'}`, 3.5);
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
    undressSoldier(a.soldier);
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

  // ================= PVE 补给站 / 空投箱（坐标与服务端共用 src/supplies.js） =================
  ensureProps() {
    if (this.props || !this.room || this.room.mode !== 'pve') return;
    const scene = this.g.renderer.scene;
    const geoBody = new THREE.BoxGeometry(0.86, 0.58, 0.6);
    const geoLid = new THREE.BoxGeometry(0.9, 0.12, 0.64);
    const lidMat = new THREE.MeshStandardMaterial({ color: 0x272d34, roughness: 0.85, metalness: 0.1 });
    const COL = { ammo: 0xf5b321, med: 0xff5a49, armor: 0x49a0ff };
    const stations = suppliesForMap(this.room.map).map((s, i) => {
      const mat = new THREE.MeshStandardMaterial({ color: COL[s.kind], roughness: 0.55, metalness: 0.2, emissive: COL[s.kind], emissiveIntensity: 0.5 });
      const grp = new THREE.Group();
      const body = new THREE.Mesh(geoBody, mat); body.position.y = 0.3;
      const lid = new THREE.Mesh(geoLid, lidMat); lid.position.y = 0.64;
      grp.add(body, lid);
      grp.position.set(s.x, 0.02, s.z);
      grp.rotation.y = (s.x + s.z) * 0.07;
      scene.add(grp);
      return { grp, mat, i, ready: true };
    });
    this.props = { geoBody, geoLid, lidMat, stations, crates: new Map() };
    this._supSent = -1;
    this.applySup(this.supMask);
  }
  applySup(mask) {
    if (!this.props || mask === this._supSent) return;
    this._supSent = mask;
    for (const st of this.props.stations) { st.ready = !!(mask & (1 << st.i)); st.mat.emissiveIntensity = st.ready ? 0.5 : 0.03; }
  }
  syncCrates(dp) {
    if (!this.props) return;
    const scene = this.g.renderer.scene, list = dp || [];
    const seen = new Set();
    for (const c of list) {
      seen.add(c[0]);
      let m = this.props.crates.get(c[0]);
      if (!m) {
        const mat = new THREE.MeshStandardMaterial({ color: 0xffb03a, roughness: 0.4, metalness: 0.35, emissive: 0xff7a20, emissiveIntensity: 0.75 });
        m = new THREE.Mesh(this.props.geoBody, mat);
        m.scale.set(1.3, 1.15, 1.3);
        scene.add(m); this.props.crates.set(c[0], m);
      }
      m.position.set(c[1], c[2], c[3]); m.userData.base = c[2];
    }
    for (const [id, m] of this.props.crates) if (!seen.has(id)) { scene.remove(m); m.material.dispose(); this.props.crates.delete(id); }
  }
  pulseProps(t) {
    if (!this.props) return;
    const k = 0.42 + Math.sin(t * 2.4) * 0.2;
    for (const st of this.props.stations) if (st.ready) st.mat.emissiveIntensity = k;
    for (const m of this.props.crates.values()) { m.rotation.y += 0.014; m.position.y = (m.userData.base || 0.55) + Math.sin(t * 2.2) * 0.07; }
  }
  dropProps() {
    if (!this.props) return;
    const scene = this.g.renderer.scene;
    for (const st of this.props.stations) scene.remove(st.grp);
    for (const m of this.props.crates.values()) { scene.remove(m); m.material.dispose(); }
    this.props.geoBody.dispose(); this.props.geoLid.dispose(); this.props.lidMat.dispose();
    for (const st of this.props.stations) st.mat.dispose();
    this.props = null; this._supSent = -1;
  }
  bossFx(e) {
    const g = this.g;
    if (e.a === 'blink' && e.o && e.p) {
      const o = new THREE.Vector3(e.o[0], e.o[1], e.o[2]), q = new THREE.Vector3(e.p[0], e.p[1], e.p[2]);
      g.fx.light(o, 1.5, 0.3, 0x9b5cff, 14); g.fx.light(q, 2.0, 0.35, 0x9b5cff, 14);
      g.fx.tracer(o, q); audio.playRicochet(q);
      return;
    }
    const a = this.remotes.get(e.id) || (e.id === this.myId ? this.me : null);
    if (a && a.soldier) bump(a.soldier, e.a === 'charge' ? 2 : 1.5);   // 起手瞬间本体亮一下，给对手反应窗口
    const p = a ? a.pos : g.renderer.camera.position;
    if (e.a === 'charge') { g.fx.light(p, 1.4, 0.4, 0xff6a2a, 12); g.hud.toast('<b style="color:#ff6a4a">铁皮暴君开始冲撞</b> · 闪开会被撞飞', 1.8); }
    else if (e.a === 'barrage') { g.hud.toast('<b style="color:#8ce36a">瘟疫母体召唤酸液齐射</b> · 快离开脚下这片地', 2.2); audio.announce('Watch your feet'); }
    else if (e.a === 'split') g.hud.toast('<b style="color:#8ce36a">瘟疫母体分裂出感染体</b>', 2);
  }

  // ================= 预测射击表现 =================
  predShot(a, w, spread, rnd) {
    const g = this.g, d = w.def;
    const cam = g.renderer.camera;
    const eye = new THREE.Vector3(a.pos.x, a.pos.y + a.eyeH, a.pos.z);
    const pellets = d.pellets || 1;
    for (let p = 0; p < pellets; p++) {
      // 与服务端 fire() 对称消耗 rnd()，保证预测的后坐/散布序列与权威端一致
      const dir = shotDir(a, spread, rnd);
      const dv = new THREE.Vector3(dir.x, dir.y, dir.z);
      if (p === 0) {
        g.vm.fire();
        g.fx.light(cam.position.clone().addScaledVector(dv, 1.2), d.type === 'sniper' ? 10 : 5, 0.06);
        audio.playShot(d.sound, null);
        if (Math.random() < 0.5) audio.playShellDrop(null);
      }
      const hit = g.world.raycast(eye.x, eye.y, eye.z, dv.x, dv.y, dv.z, d.range, 'bullet');
      const end = eye.clone().addScaledVector(dv, hit ? hit.t : d.range);
      if (Math.random() < 0.35 || d.type === 'sniper' || pellets > 1) g.fx.tracer(cam.position.clone().addScaledVector(dv, 0.9), end);
    }
  }

  // 附身 / 下甲时服务端会整体换装，本地预测的武器对象必须一起换掉（否则身份不同步、散布与后算全歪）
  swapSelfLoadout(prim) {
    const me = this.me;
    if (!me || !prim || !WEAPONS[prim] || me.primary === prim) return;
    me.primary = prim;
    me.inv = makeLoadout(prim, me.shotSeed || 1);
    me.slot = 0; me.lastSlot = 1;
    this.g.vm.equip(prim, me.inv[0].def.draw);
    this.g.hud.slots(me.inv, 0);
    audio.playWeaponSwitch(prim);
  }

  // ================= 记分板数据 =================
  syncRoster(list) {
    const ids = new Set();
    let br = null;
    for (const r of list) {
      ids.add(r.id);
      if (r.boss) br = r;
      if (r.id === this.myId) {
        this.me.stats.k = r.k; this.me.stats.d = r.d; this.me.stats.hs = r.hs; this.me.ping = r.ping;
        if (this.me.team !== r.team) { this.me.team = r.team; this.g.vm.setTeam(r.team); }
        continue;
      }
      const a = this.ensureRemote(r);
      a.stats.k = r.k; a.stats.d = r.d; a.stats.hs = r.hs; a.ping = r.ping;
      if (a.team !== r.team || a.name !== r.name) {
        const teamChanged = a.team !== r.team;
        a.team = r.team; a.name = r.name;
        if (teamChanged && a.tagged) { this.g.removeTag(a); a.tagged = false; }   // 附身 BOSS 后从队友变敌人
      }
      if (this.me && r.team === this.me.team && !a.tagged) { this.g.addTag(a); a.tagged = true; }
      // BOSS 全程顶着自己的名字：附身后面还要带上驾驶员，打的就是"谁在里面"
      if (r.boss) {
        const text = r.boss === 2 ? `☠ ${r.bnm || r.kind}｜${r.name}` : `☠ ${r.bnm || r.name}`;
        if (a.tagged && a._tagText !== text) { this.g.removeTag(a); a.tagged = false; }
        if (!a.tagged) {
          this.g.addTag(a, { big: true, color: BOSS_TINT[r.kind] || '#ff6a4a', text });
          a.tagged = true; a._tagText = text;
        }
      }
    }
    for (const id of [...this.remotes.keys()]) if (!ids.has(id)) this.dropRemote(id);
    // BOSS 血条数据源：名册行给出初值，之后由 hit 事件实时更新
    this.boss = br ? { id: br.id, nm: br.boss === 2 ? (br.bnm || br.name) : br.name, hp: br.hp, hpMax: br.hpMax, by: br.boss === 2 ? 1 : 0, who: br.boss === 2 ? br.name : '' } : null;
    if (this.botUI) this.renderBotList();
  }
  refreshBossBar() {
    const g = this.g;
    if (!this.room || this.room.mode !== 'pve') return;
    let b = this.boss;
    if (this.me && this.me.isBoss) b = { id: this.myId, nm: (b && b.nm) || 'BOSS', hp: Math.max(0, this.me.hp), hpMax: this.me.hpMax || 100, by: 1, who: this.playerName() };
    g.hud.bossBar(b);
  }

  // ================= 房主：机器人管理 =================
  bindMatchKeys() {
    if (this._hostKeys) return;
    this._hostKeys = (e) => {
      if (this.botUI) { if (e.code === 'Escape' || e.code === 'KeyM') { e.preventDefault(); this.closeBotPanel(); } return; }
      if (e.code === 'KeyM' && this.isHost && this.inMatch && !this.g.paused && !this.g.inLoadout) { e.preventDefault(); this.openBotPanel(); }
      // PVE：G 键附身 / 交还 BOSS（任何真人自愿，不需要房主权限）
      if (e.code === 'KeyG' && this.inMatch && !this.spectate && this.room && this.room.mode === 'pve' && !this.g.paused && !this.g.inLoadout) {
        e.preventDefault();
        this.send({ t: 'boss', a: this.me && this.me.isBoss ? 'release' : 'take' });
      }
    };
    window.addEventListener('keydown', this._hostKeys);
  }
  unbindMatchKeys() { if (this._hostKeys) { window.removeEventListener('keydown', this._hostKeys); this._hostKeys = null; } }
  ensureBotPanel() {
    if (this._botPanel) return this._botPanel;
    const d = document.createElement('div');
    d.id = 'botPanel';
    d.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:340px;max-height:74vh;overflow:auto;z-index:40;background:rgba(12,16,20,.94);border:1px solid #33414f;border-radius:10px;color:#dfe6ec;font:13px/1.5 system-ui,sans-serif;padding:14px 16px;box-shadow:0 12px 40px rgba(0,0,0,.6)';
    const opts = PRIMARIES.map((id) => `<option value="${id}">${WEAPONS[id].name}</option>`).join('');
    d.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center"><b style="color:#f5b321;font-size:15px">机器人管理（房主）</b><button id="botClose" style="background:none;border:none;color:#93a1af;font-size:18px;cursor:pointer">✕</button></div>
      <div style="display:flex;gap:8px;margin:10px 0 6px">
        <label style="flex:1">难度<select id="botDiff" style="width:100%;margin-top:3px;background:#1b232b;color:#dfe6ec;border:1px solid #33414f;border-radius:5px;padding:3px"><option value="easy">简单</option><option value="normal" selected>普通</option><option value="hard">困难</option><option value="hell">地狱</option></select></label>
        <label style="flex:1">主武器<select id="botPrim" style="width:100%;margin-top:3px;background:#1b232b;color:#dfe6ec;border:1px solid #33414f;border-radius:5px;padding:3px"><option value="">随机</option>${opts}</select></label>
      </div>
      <div style="display:flex;gap:8px">
        <button class="botAdd" data-team="BL" style="flex:1;cursor:pointer;background:#8a1a14;border:none;color:#fff;border-radius:5px;padding:7px 0">+ 潜伏者</button>
        <button class="botAdd" data-team="GR" style="flex:1;cursor:pointer;background:#1f62c8;border:none;color:#fff;border-radius:5px;padding:7px 0">+ 保卫者</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button class="botClear" data-team="BL" style="flex:1;cursor:pointer;background:#2a2f36;border:1px solid #3a424b;color:#c8d2da;border-radius:5px;padding:5px 0">清空潜伏 AI</button>
        <button class="botClear" data-team="GR" style="flex:1;cursor:pointer;background:#2a2f36;border:1px solid #3a424b;color:#c8d2da;border-radius:5px;padding:5px 0">清空保卫 AI</button>
      </div>
      <div style="margin:10px 0 4px;color:#8794a1;font-size:12px">当前机器人（点名字踢除）</div>
      <div id="botList" style="display:flex;flex-direction:column;gap:4px"></div>
      <div id="botHint" style="margin-top:10px;color:#5f6c78;font-size:11px">按 M / Esc 关闭。</div>`;
    d.addEventListener('click', (e) => {
      const kick = e.target.closest('.botKick');
      if (kick) { this.sendBot({ a: 'remove', id: +kick.dataset.id }); return; }
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'botClose') { this.closeBotPanel(); return; }
      if (b.classList.contains('botAdd')) { this.sendBot({ a: 'add', team: b.dataset.team, diff: d.querySelector('#botDiff').value, primary: d.querySelector('#botPrim').value || undefined }); return; }
      if (b.classList.contains('botClear')) { this.sendBot({ a: 'clear', team: b.dataset.team }); }
    });
    document.body.appendChild(d);
    d.classList.add('hidden');
    this._botPanel = d;
    return d;
  }
  renderBotList() {
    const list = this._botPanel && this._botPanel.querySelector('#botList'); if (!list) return;
    const bots = [...this.remotes.values()].filter((a) => a.isBot);
    list.innerHTML = bots.length
      ? bots.map((a) => `<div class="botKick" data-id="${a.id}" style="display:flex;justify-content:space-between;padding:5px 8px;background:#1b232b;border:1px solid #2c3540;border-radius:5px;cursor:pointer;color:${a.team === 'BL' ? '#ff9b70' : '#8cc8ff'}"><span>${esc(a.name)} · ${a.k || 0}/${a.d || 0}</span><span style="color:#93a1af">踢除 ✕</span></div>`).join('')
      : '<div style="color:#5f6c78;font-size:12px;padding:4px 2px">（暂无机器人）</div>';
  }
  openBotPanel() {
    const g = this.g; if (!this.isHost || !this.inMatch) return;
    this.botUI = true; g.inLoadout = true; // 借用 inLoadout 令“失去指针锁定”不触发暂停
    const d = this.ensureBotPanel();
    // PVE 的 GR 席位属于怪潮，机器人只能作为清怪队友加入
    const pve = this.room && this.room.mode === 'pve';
    for (const b of d.querySelectorAll('[data-team="GR"]')) b.style.display = pve ? 'none' : '';
    const hint = d.querySelector('#botHint');
    if (hint) hint.textContent = (pve ? 'PVE：机器人只作为清怪队友加入，BOSS 登场后按 G 可附身它。' : '按 M / Esc 关闭，机器人占用玩家槽位。') + ` 房间上限 ${this.room ? this.room.max : 16}。`;
    d.classList.remove('hidden');
    this.renderBotList();
    if (document.pointerLockElement) document.exitPointerLock();
  }
  closeBotPanel() {
    const g = this.g;
    this.botUI = false;
    if (this._botPanel) this._botPanel.classList.add('hidden');
    g.inLoadout = false;
    if (this.inMatch && !this.spectate) g.lock();
  }
  sendBot(o) { this.send({ t: 'bot', ...o }); }

  // ================= 换枪 / 退出 =================
  setLoadout(id) { this.send({ t: 'loadout', primary: id }); }
  leaveMatch() {
    const g = this.g;
    clearInterval(this.pingIv);
    this.unbindMatchKeys();
    if (this.botUI) { this.botUI = false; g.inLoadout = false; }
    if (this._botPanel) this._botPanel.classList.add('hidden');
    if (this._specKeys) {
      window.removeEventListener('keydown', this._specKeys);
      window.removeEventListener('keyup', this._specKeys);
      this._specKeys = null;
    }
    this.inMatch = false; this.reconnecting = false; this.spectate = false;
    this.state = this.state === 'play' ? 'idle' : this.state;
    for (const a of this.remotes.values()) { undressSoldier(a.soldier); g.renderer.scene.remove(a.soldier.root); }
    this.remotes.clear();
    if (this.me) undressSoldier(this.me.soldier);
    for (const [, mesh] of this.nadeMeshes) g.renderer.scene.remove(mesh);
    this.nadeMeshes.clear();
    this.dropProps(); this.dropLamp(); g.hud.bossBar(null);
    g.vm.setBossLook(null); g.hud.bossVeil(null);
    this.boss = null; this.room = null;
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
