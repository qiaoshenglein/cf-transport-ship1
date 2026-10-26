// 真 HTTP/WS + 后台浏览器回归；使用隔离配置，绝不修改线上地图开放状态。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { chromium } from 'playwright-core';
import { MAP_IDS } from '../src/maps.js';
import { PROTO_VERSION } from '../src/protocol.js';
import { createMapPolicy } from '../server/map-policy.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-map-policy-'));
const file = path.join(dir, 'maps.json');
process.env.MAP_SETTINGS_FILE = file;
process.env.PORT = '0'; process.env.HOST = '127.0.0.1'; process.env.ADMIN_TOKEN = 'map-test-token';
const mod = await import('../server/index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clients = []; let browser;
const deadline = setTimeout(() => { console.error('地图开放测试超时'); process.exit(1); }, 120000);
async function client(base) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws'), inbox = [];
  clients.push(ws);
  ws.on('message', (d, binary) => { if (!binary) inbox.push(JSON.parse(d)); });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const c = { ws, send: (m) => ws.send(JSON.stringify(m)), async next(predicate) {
    for (let i = 0; i < 250; i++) {
      const n = inbox.findIndex(predicate);
      if (n >= 0) return inbox.splice(n, 1)[0];
      await sleep(20);
    }
    throw new Error('等待 WebSocket 消息超时');
  } };
  c.send({ t: 'hello', name: '地图测试', proto: PROTO_VERSION });
  await c.next((m) => m.t === 'hi');
  return c;
}
try {
  assert.deepEqual(MAP_IDS, ['ship', 'polar', 'bazaar', 'depot', 'turbine', 'harbor']);
  const legacyFile = path.join(dir, 'legacy.json');
  try {
    fs.writeFileSync(legacyFile, JSON.stringify({ version: 1, disabled: ['polar', 'desert'] }));
    assert.equal(createMapPolicy(legacyFile).enabled('polar'), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(legacyFile)), { version: 2, disabled: ['polar'] });
    fs.writeFileSync(legacyFile, JSON.stringify({ version: 2, disabled: ['ship', 'polar'] }));
    const expanded = createMapPolicy(legacyFile);
    assert.equal(expanded.enabled('ship'), false);
    assert.equal(expanded.enabled('polar'), false);
    for (const id of ['bazaar', 'depot', 'turbine', 'harbor']) assert.equal(expanded.enabled(id), true);
    fs.writeFileSync(legacyFile, JSON.stringify({ version: 1, disabled: MAP_IDS }));
    const migrated = createMapPolicy(legacyFile);
    assert.equal(migrated.enabled('ship'), true);
    assert.equal(migrated.enabled('polar'), false);
    assert.equal(createMapPolicy(legacyFile).enabled('ship'), true);
    fs.writeFileSync(legacyFile, JSON.stringify({ version: 2, disabled: MAP_IDS }));
    assert.throws(() => createMapPolicy(legacyFile), /至少启用/);
  } finally { fs.rmSync(legacyFile, { force: true }); }
  console.log('PASS 六张地图注册、旧禁用配置迁移并保证可用地图');
  for (let i = 0; !mod.boundPort() && i < 100; i++) await sleep(20);
  const base = `http://127.0.0.1:${mod.boundPort()}`;
  const headers = { 'content-type': 'application/json', 'x-admin-token': process.env.ADMIN_TOKEN };
  const action = async (body, auth = true) => {
    const r = await fetch(base + '/api/console/action', { method: 'POST', headers: auth ? headers : {}, body: JSON.stringify(body) });
    return { status: r.status, data: r.status === 404 ? null : await r.json() };
  };
  const toggle = (id, enabled) => action({ a: 'map', id, enabled });
  const maps = async () => (await (await fetch(base + '/api/maps')).json()).maps;
  assert.equal((await maps()).filter((m) => m.enabled).length, MAP_IDS.length);
  assert.equal((await action({ a: 'map', id: 'polar', enabled: false }, false)).status, 404);
  assert.equal((await toggle('not-a-map', false)).status, 400);
  assert.equal((await toggle('polar', 'false')).status, 400);
  console.log('PASS 默认全开、地图参数校验与后台鉴权');
  const A = await client(base), B = await client(base);
  for (const map of ['desert', 'town', 'inferno', 'aztec', 'nuke']) {
    assert.equal((await toggle(map, true)).status, 400);
    for (const t of ['create', 'quick']) {
      B.send({ t, map });
      assert.match((await B.next((m) => m.t === 'err')).m, /不存在/);
    }
  }
  assert.deepEqual((await maps()).map((m) => m.id), MAP_IDS);
  console.log('PASS 已移除地图不可重新启用、建房或匹配');
  for (const map of ['bazaar', 'depot', 'turbine', 'harbor']) {
    assert.equal((await toggle(map, false)).status, 200);
    B.send({ t: 'create', map });
    assert.match((await B.next((m) => m.t === 'err')).m, /禁用/);
    assert.equal((await toggle(map, true)).status, 200);
    B.send({ t: 'create', map });
    assert.equal((await B.next((m) => m.t === 'joined')).room.map, map);
    B.send({ t: 'leave' }); await B.next((m) => m.t === 'hi');
  }
  console.log('PASS 四张新地图分别禁用、启用与真实联机建房');
  A.send({ t: 'create', map: 'polar', mode: 'pvp' });
  const joined = await A.next((m) => m.t === 'joined');
  const room = mod.rooms.get(joined.room.id), tick = room.tick;
  assert.equal((await toggle('polar', false)).status, 200);
  const push = await B.next((m) => m.t === 'maps' && m.list.some((r) => r.id === 'polar' && !r.enabled));
  assert.equal(push.list.find((m) => m.id === 'polar').enabled, false);
  assert.equal(createMapPolicy(file).enabled('polar'), false);
  assert.equal((await maps()).find((m) => m.id === 'polar').enabled, false);
  assert.equal((await (await fetch(base + '/api/rooms')).json()).length, 0);
  await sleep(100); assert(room.tick > tick && room.players.has(joined.you));
  console.log('PASS 持久化、客户端广播与已有对局继续运行');
  for (const message of [{ t: 'create', map: 'polar' }, { t: 'quick', map: 'polar' }, { t: 'join', rid: room.id }, { t: 'spectate', rid: room.id }]) {
    B.send(message); assert.match((await B.next((m) => m.t === 'err')).m, /禁用/);
  }
  B.send({ t: 'quick' });
  const quick = await B.next((m) => m.t === 'joined'); assert.notEqual(quick.room.map, 'polar');
  B.send({ t: 'leave' }); await B.next((m) => m.t === 'hi');
  A.ws.close(); await sleep(80);
  const C = await client(base);
  C.send({ t: 'hello', proto: PROTO_VERSION, ticket: joined.ticket });
  assert.equal((await C.next((m) => m.t === 'joined')).you, joined.you);
  console.log('PASS 禁用地图拒绝建房/匹配/加入/观战，原玩家可重连');

  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { 'x-admin-token': process.env.ADMIN_TOKEN } });
  const admin = await context.newPage(), errors = [];
  admin.on('pageerror', (e) => errors.push(e.message));
  await admin.goto(base + '/admin');
  const button = admin.locator('button[data-map="polar"]');
  await button.waitFor(); assert.equal(await button.textContent(), '启用');
  assert.equal(await admin.locator('button[data-map]').count(), MAP_IDS.length);
  await button.click();
  await admin.waitForFunction(() => document.querySelector('[data-map="polar"]')?.textContent === '禁用');
  assert.equal((await maps()).find((m) => m.id === 'polar').enabled, true);
  await admin.screenshot({ path: 'test/_map_admin.png' });

  const game = await context.newPage(); game.on('pageerror', (e) => errors.push(e.message));
  await game.addInitScript(() => localStorage.setItem('cf_ship_opts', JSON.stringify({ quality: 'low', map: 'desert', size: 2 })));
  await game.goto(base + '/?nolock=1');
  await game.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  assert.equal(await game.evaluate(() => window.__game.opts.map), 'ship');
  assert.equal(await game.evaluate(() => JSON.parse(localStorage.getItem('cf_ship_opts')).map), 'ship');
  assert.deepEqual(await game.locator('#menu [data-k="map"] button').evaluateAll((buttons) => buttons.map((b) => b.dataset.v)), MAP_IDS);
  await game.locator('#menu [data-k="map"] [data-v="polar"]').click();
  await game.locator('#btnNet').click();
  await game.waitForFunction(() => window.__game.netGame.availableMaps?.has('polar'));
  assert.deepEqual(await game.locator('#lobby [data-kg="map"] button').evaluateAll((buttons) => buttons.map((b) => b.dataset.v)), MAP_IDS);
  await game.locator('#lobby [data-kg="map"] [data-v="polar"]').click();
  await button.click();
  await game.waitForFunction(() => document.querySelector('#lobby [data-kg="map"] [data-v="polar"]')?.disabled);
  await game.waitForFunction(() => document.querySelector('#menu [data-k="map"] [data-v="polar"]')?.disabled, null, { timeout: 10000 });
  assert.notEqual(await game.evaluate(() => window.__game.netGame.lobbyOpts.map), 'polar');
  assert.notEqual(await game.evaluate(() => window.__game.opts.map), 'polar');
  console.log('PASS 后台真实开关、单机菜单轮询与联机大厅即时同步');
  await game.locator('#netBack').click();
  await game.locator('#btnStart').click();
  await game.waitForFunction(() => window.__game.playing);
  assert.notEqual(await game.evaluate(() => window.__game.mapId), 'polar');
  console.log('PASS 禁用后单机开局自动使用可用地图');
  assert.deepEqual(errors, []);

  for (const id of MAP_IDS.filter((id) => id !== 'ship')) assert.equal((await toggle(id, false)).status, 200);
  assert.equal((await toggle('ship', false)).status, 400);
  assert.equal(createMapPolicy(file).enabled('ship'), true);
  assert.equal((await toggle('polar', true)).status, 200);
  B.send({ t: 'create', map: 'polar' });
  assert.equal((await B.next((m) => m.t === 'joined')).room.map, 'polar');
  // 保存失败不能先修改内存中的开放状态。
  const invalid = createMapPolicy(path.join(file, 'bad.json'));
  assert.throws(() => invalid.set('polar', false)); assert.equal(invalid.enabled('polar'), true);
  console.log('PASS 至少保留一图、重新启用可建房、磁盘保存失败不改变状态');
} catch (e) { console.error(e); process.exitCode = 1; }
finally {
  clearTimeout(deadline); await browser?.close();
  for (const ws of clients) ws.terminate(); mod.stopAll();
  for (const f of [file, file + '.tmp']) if (fs.existsSync(f)) fs.unlinkSync(f);
  fs.rmdirSync(dir);
}
process.exit(process.exitCode || 0);
