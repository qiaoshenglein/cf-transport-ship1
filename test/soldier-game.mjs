import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
process.env.PORT = '0'; process.env.HOST = '127.0.0.1';
const server = await import('../server/index.js');
let browser;
try {
  for (let i = 0; !server.boundPort() && i < 100; i++) await new Promise(r => setTimeout(r, 30));
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader', '--no-sandbox'] });
  const base = `http://127.0.0.1:${server.boundPort()}`, errors = [];
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('cf_ship_opts', JSON.stringify({ quality: 'low', size: 2, team: 'BL' })));
    await page.goto(base + '/?nolock=1');
    await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
    return page;
  };
  const a = await open();
  await a.locator('#btnStart').click();
  await a.waitForFunction(() => window.__game.playing && window.__game.player?.alive);
  assert.equal(await a.evaluate(() => window.__game.actors.filter(a => !a.isPlayer).every(a => !!a.soldier.human)), true);
  // Stage a clear view of both teams through the real, unchanged first-person viewmodel.
  await a.evaluate(() => {
    const g = window.__game; g.paused = true; g.hud.show(null);
    g.player.pos.set(-34, .02, 0); g.player.yaw = -Math.PI / 2; g.player.pitch = 0; g.player.updateCamera(0);
    g.renderer.camera.position.set(-34, 1.65, 0); g.renderer.camera.rotation.set(0, -Math.PI / 2, 0, 'YXZ');
    const targets = g.actors.filter(a => !a.isPlayer);
    targets.forEach((a, i) => {
      a.soldier.root.visible = i < 2; a.soldier.root.position.set(-29, .02, i === 0 ? -1 : 1);
      a.soldier.root.rotation.y = Math.PI / 2; a.soldier.setTeam(i === 0 ? 'BL' : 'GR');
      a.soldier.setBodyVisible(true);
      for (let f = 0; f < 30; f++) a.soldier.update(1 / 60, { speed: 0, pitch: 0, onGround: true, fwd: 1 });
    });
    g.renderer.render();
  });
  await a.screenshot({ path: 'test/_soldiers_ingame.png' });
  await a.evaluate(() => { window.__game.quitToMenu(); window.__game.renderer.render = () => {}; });
  assert.equal(await a.evaluate(() => window.__game.actors.length), 0);
  console.log('PASS final build loads both teams, first-person scene renders, leaving offline match cleans actors');
  const b = await open();
  await b.evaluate(() => { window.__game.renderer.render = () => {}; });
  await a.evaluate(async () => { const n = window.__game.netGame; await n.connect(); n.helloMsg(); });
  await a.waitForTimeout(250);
  await a.evaluate(() => window.__game.netGame.send({ t: 'create', name: '角色模型回归', goal: 50, max: 4, primary: 'ak47' }));
  await a.waitForFunction(() => window.__game.netGame.inMatch);
  await b.evaluate(async () => { const n = window.__game.netGame; await n.connect(); n.helloMsg(); });
  await b.waitForTimeout(250);
  await b.evaluate(() => window.__game.netGame.send({ t: 'quick' }));
  for (const page of [a, b]) {
    await page.waitForFunction(() => { const n = window.__game.netGame; return n.inMatch && [...n.remotes.values()].some(a => a.soldier.human && a.alive); });
    assert.equal(await page.evaluate(() => { const n = window.__game.netGame; return !n.me.soldier.human && [...n.remotes.values()].every(a => a.soldier.human.team === a.team); }), true);
  }
  await b.evaluate(() => window.__game.quitToMenu());
  await a.waitForFunction(() => window.__game.netGame.remotes.size === 0);
  await a.evaluate(() => window.__game.quitToMenu());
  assert.deepEqual(errors, []);
  console.log('PASS two real game clients see new remote models, local bodies excluded, leaving removes models, no page errors');
} catch (e) { console.error(e); process.exitCode = 1; }
finally { await browser?.close(); server.stopAll(); }
process.exit(process.exitCode || 0);
