// 四张新地图：浏览器与服务端碰撞一致、真实渲染、换图释放、构建页单机开局。
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { loadMap } from '../server/mapdata.js';
const ids = process.env.MAP_TEST_IDS?.split(',') || ['bazaar', 'depot', 'turbine', 'harbor', 'windgarden'];
process.env.PORT = '0'; process.env.HOST = '127.0.0.1'; process.env.DEV_SRC = '1';
const server = await import('../server/index.js');
let browser;
const deadline = setTimeout(async () => { console.error('新地图浏览器测试超时'); await browser?.close(); server.stopAll(); process.exit(1); }, 600000);
const shape = (c) => [c.x, c.y, c.z, c.hx, c.hy, c.hz, c.yaw].map((v) => Math.round(v * 1e6) / 1e6);
try {
  while (!server.boundPort()) await new Promise((r) => setTimeout(r, 20));
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-accelerated-2d-canvas', '--enable-logging=stderr'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || /CONTEXT_LOST|context lost/i.test(m.text())) console.error('BROWSER:', m.text().slice(0, 600)); });
  const base = `http://127.0.0.1:${server.boundPort()}`;
  await page.goto(base + '/tools/plain.html');
  if (!process.env.MAP_TEST_PLAY_ONLY) await page.evaluate(async () => {
    const THREE = await import('three'), { World } = await import('/src/physics.js'), { MAPS } = await import('/src/maps.js');
    const { Renderer } = await import('/src/render.js'), { Environment } = await import('/src/env.js');
    const { buildTextures } = await import('/src/textures.js'), { disposeMap } = await import('/src/mapkit.js'), { userGfx } = await import('/src/graphics.js');
    const canvas = document.createElement('canvas'); document.body.appendChild(canvas);
    const gfx = userGfx({ quality: 'medium', gfx: { shadow: 1024, msaa: 0 } });
    const R = new Renderer(canvas, gfx), env = new Environment(R.renderer, R.scene, gfx);
    R.renderer.info.autoReset = false;
    window.nm = { R, env, THREE, World, MAPS, disposeMap, T: buildTextures('low') };
    // WebGL 默认不保留后缓冲；截屏前持续绘制，避免把已清空画布当成地图。
    const frame = () => { R.render(); window.nm.frame = requestAnimationFrame(frame); }; frame();
  });
  for (const id of process.env.MAP_TEST_PLAY_ONLY ? [] : ids) {
    const result = await page.evaluate(async (id) => {
      const p = window.nm, def = p.MAPS[id];
      if (p.map) {
        let disposed = 0; for (const m of p.map.meshes) m.geometry.addEventListener('dispose', () => disposed++);
        p.disposeMap(p.map);
        if (p.map.root.parent || !disposed) throw new Error('换图未释放旧地图');
      }
      def.textures(p.T, 'low');
      const root = new p.THREE.Group(); p.R.scene.add(root);
      const world = new p.World(); p.map = def.build(root, p.T, world); p.map.root = root;
      if (id === 'windgarden') {
        if (!await p.map.assetReady) throw new Error('Tripo 装饰模型加载失败');
        if (root.children.filter(o => o.name.startsWith('tripo-')).length !== 9) throw new Error('Tripo 实例数量错误');
      }
      p.env.setMap(def); p.env.apply('day');
      const s = def.radar.w / 88;
      p.R.camera.fov = 52; p.R.camera.updateProjectionMatrix();
      p.R.camera.position.set(55 * s, 63 * s, 62 * s); p.R.camera.lookAt(0, 0, 0);
      p.R.renderer.shadowMap.needsUpdate = true; p.env.update(0, 0, p.R.camera.position);
      p.R.render(); p.R.renderer.info.reset(); p.R.render();
      if (p.R.renderer.getContext().isContextLost()) throw new Error('WebGL context lost');
      return { colliders: world.colliders.map((c) => [c.x, c.y, c.z, c.hx, c.hy, c.hz, c.yaw].map((v) => Math.round(v * 1e6) / 1e6)),
        textureSize: p.T[id + 'Wall'].map.image.width, triangles: p.R.renderer.info.render.triangles, draws: p.R.renderer.info.render.calls };
    }, id);
    assert.deepEqual(result.colliders, loadMap(id).world.colliders.map(shape));
    assert.equal(result.textureSize, 128); assert(result.triangles > 100, JSON.stringify({ id, ...result, colliders: result.colliders.length }));
    await page.screenshot({ path: `test/_${id}_overview.png` });
    await page.evaluate((id) => {
      const { R } = window.nm;
      const positions = { bazaar: [-29, 1.65, -21, 5, 3, -10], depot: [-28, 1.65, -4, 2, 3, -10], turbine: [-8, 1.65, 16, 0, 3, 0], harbor: [-35, 1.65, -43, 0, 6, -10], windgarden: [-10, 1.65, 14, 1, 6, -5] };
      const [x, y, z, tx, ty, tz] = positions[id];
      R.camera.fov = 78; R.camera.updateProjectionMatrix(); R.camera.position.set(x, y, z); R.camera.lookAt(tx, ty, tz); R.render();
    }, id);
    await page.screenshot({ path: `test/_${id}_lane.png` });
    await page.evaluate(() => { window.nm.env.apply('dusk'); window.nm.R.render(); });
    await page.screenshot({ path: `test/_${id}_dusk.png` });
    console.log('PASS', id, '真实渲染、碰撞一致、贴图档位、换图释放', { colliders: result.colliders.length, triangles: result.triangles, draws: result.draws });
  }
  await page.addInitScript(() => localStorage.setItem('cf_ship_opts', JSON.stringify({ quality: 'low', size: 2, map: 'bazaar', gfx: { auto: 'off' } })));
  if (!process.env.MAP_TEST_PLAY_ONLY) await page.evaluate(() => {
    const p = window.nm; cancelAnimationFrame(p.frame); p.disposeMap(p.map);
    p.R.renderer.dispose(); p.R.renderer.forceContextLoss();
  });
  await page.goto(base + '/?nolock=1');
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  assert.equal(await page.locator('#menu [data-k="map"] button').count(), 7);
  await page.screenshot({ path: 'test/_newmaps_menu.png' });
  for (const id of ids) {
    await page.locator(`#menu [data-k="map"] button[data-v="${id}"]`).click();
    await page.waitForFunction((id) => window.__game.mapId === id, id);
    await page.locator('#btnStart').click();
    await page.waitForFunction(() => window.__game.playing && window.__game.player?.alive);
    if (id === 'windgarden') assert.equal(await page.evaluate(() => window.__game.map.assetReady), true);
    const state = await page.evaluate(() => {
      const g = window.__game;
      g.renderer.render();
      const gl = g.renderer.renderer.getContext();
      if (gl.isContextLost()) throw new Error('开局 WebGL 上下文丢失');
      const pixel = new Uint8Array(4);
      gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight * 0.8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (pixel[0] + pixel[1] + pixel[2] < 30) throw new Error('开局画布未输出场景像素');
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
