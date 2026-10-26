// 四张新地图：浏览器与服务端碰撞一致、真实渲染、换图释放、构建页单机开局。
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { loadMap } from '../server/mapdata.js';
const ids = ['bazaar', 'depot', 'turbine', 'harbor'];
process.env.PORT = '0'; process.env.HOST = '127.0.0.1'; process.env.DEV_SRC = '1';
const server = await import('../server/index.js');
let browser;
const deadline = setTimeout(() => { console.error('新地图浏览器测试超时'); process.exit(1); }, 240000);
const shape = (c) => [c.x, c.y, c.z, c.hx, c.hy, c.hz, c.yaw].map((v) => Math.round(v * 1e6) / 1e6);
try {
  while (!server.boundPort()) await new Promise((r) => setTimeout(r, 20));
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const base = `http://127.0.0.1:${server.boundPort()}`;
  await page.goto(base + '/tools/plain.html');
  await page.evaluate(async () => {
    const THREE = await import('three'), { World } = await import('/src/physics.js'), { MAPS } = await import('/src/maps.js');
    const { Renderer } = await import('/src/render.js'), { Environment } = await import('/src/env.js');
    const { buildTextures } = await import('/src/textures.js'), { disposeMap } = await import('/src/mapkit.js'), { userGfx } = await import('/src/graphics.js');
    const canvas = document.createElement('canvas'); document.body.appendChild(canvas);
    const gfx = userGfx({ quality: 'high', gfx: { shadow: 2048, msaa: 2 } });
    const R = new Renderer(canvas, gfx), env = new Environment(R.renderer, R.scene, gfx);
    R.renderer.info.autoReset = false;
    window.nm = { R, env, THREE, World, MAPS, disposeMap, T: buildTextures('low') };
  });
  for (const id of ids) {
    const result = await page.evaluate((id) => {
      const p = window.nm, def = p.MAPS[id];
      if (p.map) {
        let disposed = 0; for (const m of p.map.meshes) m.geometry.addEventListener('dispose', () => disposed++);
        p.disposeMap(p.map);
        if (p.map.root.parent || !disposed) throw new Error('换图未释放旧地图');
      }
      def.textures(p.T, 'low');
      const root = new p.THREE.Group(); p.R.scene.add(root);
      const world = new p.World(); p.map = def.build(root, p.T, world); p.map.root = root;
      p.env.setMap(def); p.env.apply('day');
      const s = def.radar.w / 88;
      p.R.camera.fov = 52; p.R.camera.updateProjectionMatrix();
      p.R.camera.position.set(55 * s, 63 * s, 62 * s); p.R.camera.lookAt(0, 0, 0);
      p.R.renderer.shadowMap.needsUpdate = true; p.env.update(0, 0, p.R.camera.position);
      p.R.render(); p.R.renderer.info.reset(); p.R.render();
      return { colliders: world.colliders.map((c) => [c.x, c.y, c.z, c.hx, c.hy, c.hz, c.yaw].map((v) => Math.round(v * 1e6) / 1e6)),
        textureSize: p.T[id + 'Wall'].map.image.width, triangles: p.R.renderer.info.render.triangles, draws: p.R.renderer.info.render.calls };
    }, id);
    assert.deepEqual(result.colliders, loadMap(id).world.colliders.map(shape));
    assert.equal(result.textureSize, 128); assert(result.triangles > 100);
    await page.screenshot({ path: `test/_${id}_overview.png` });
    await page.evaluate((id) => {
      const { R } = window.nm;
      const positions = { bazaar: [-29, 1.65, -21, 5, 3, -10], depot: [-28, 1.65, -4, 2, 3, -10], turbine: [-8, 1.65, 16, 0, 3, 0], harbor: [-35, 1.65, -43, 0, 6, -10] };
      const [x, y, z, tx, ty, tz] = positions[id];
      R.camera.fov = 78; R.camera.updateProjectionMatrix(); R.camera.position.set(x, y, z); R.camera.lookAt(tx, ty, tz); R.render();
    }, id);
    await page.screenshot({ path: `test/_${id}_lane.png` });
    await page.evaluate(() => { window.nm.env.apply('dusk'); window.nm.R.render(); });
    await page.screenshot({ path: `test/_${id}_dusk.png` });
    console.log('PASS', id, '真实渲染、碰撞一致、贴图档位、换图释放', { colliders: result.colliders.length, triangles: result.triangles, draws: result.draws });
  }
  await page.addInitScript(() => localStorage.setItem('cf_ship_opts', JSON.stringify({ quality: 'low', size: 2, map: 'bazaar', gfx: { auto: 'off' } })));
  await page.goto(base + '/?nolock=1');
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  assert.equal(await page.locator('#menu [data-k="map"] button').count(), 6);
  await page.screenshot({ path: 'test/_newmaps_menu.png' });
  for (const id of ids) {
    await page.locator(`#menu [data-k="map"] button[data-v="${id}"]`).click();
    await page.waitForFunction((id) => window.__game.mapId === id, id);
    await page.locator('#btnStart').click();
    await page.waitForFunction(() => window.__game.playing && window.__game.player?.alive);
    const state = await page.evaluate(() => {
      const g = window.__game;
      return { map: g.mapId, actors: g.actors.length, y: g.player.pos.y, radar: g.hud.radarImg.width };
    });
    assert.equal(state.map, id); assert.equal(state.actors, 4); assert(Math.abs(state.y) < 0.5);
    assert.equal(state.radar, loadMap(id).def.radar.w * 8);
    await page.screenshot({ path: `test/_${id}_play.png` });
    await page.evaluate(() => window.__game.quitToMenu());
    console.log('PASS', id, '最终构建菜单选图、单机开局、小地图、退出');
  }
  assert.deepEqual(errors, []);
} catch (e) { console.error(e); process.exitCode = 1; }
finally { clearTimeout(deadline); await browser?.close(); server.stopAll(); }
process.exit(process.exitCode || 0);
