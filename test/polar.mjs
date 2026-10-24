// 极地地图集成：真实渲染、雷达资产、换图释放，以及下载晚于离图的竞态。
// node test/polar.mjs；CHROME_PATH 可覆盖本机浏览器路径。
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

process.env.PORT = '0'; process.env.HOST = '127.0.0.1'; process.env.DEV_SRC = '1';
const server = await import('../server/index.js');
let browser;
try {
  for (let i = 0; !server.boundPort() && i < 100; i++) await new Promise((r) => setTimeout(r, 30));
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, args: ['--use-angle=swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const base = `http://127.0.0.1:${server.boundPort()}`;
  await page.goto(base + '/tools/plain.html');
  const result = await page.evaluate(async () => {
    const THREE = await import('three');
    const { buildTextures } = await import('/src/textures.js');
    const { World } = await import('/src/physics.js');
    const { MAPS } = await import('/src/maps.js');
    const { disposeMap } = await import('/src/mapkit.js');
    const { Renderer } = await import('/src/render.js');
    const { Environment } = await import('/src/env.js');
    const { userGfx } = await import('/src/graphics.js');
    const canvas = document.createElement('canvas'); document.body.appendChild(canvas);
    const gfx = userGfx({ quality: 'high', gfx: { shadow: 2048, msaa: 2 } });
    const R = new Renderer(canvas, gfx), env = new Environment(R.renderer, R.scene, gfx);
    env.setMap(MAPS.polar);
    const T = buildTextures('low'); MAPS.polar.textures(T, 'low');
    const root = new THREE.Group(); R.scene.add(root);
    const world = new World(), map = MAPS.polar.build(root, T, world); map.root = root;
    const loaded = await map.assetReady;
    R.camera.fov = 52; R.camera.updateProjectionMatrix();
    R.camera.position.set(56, 47, 54); R.camera.lookAt(0, 1, 0); R.render();
    window.polarTest = { R, env, T, root, map, world, MAPS, THREE, World, disposeMap };
    return { loaded, landmarks: root.getObjectByName('polar-radar-landmarks')?.children.length,
      colliders: world.colliders.length, snowSize: T.polarSnow.map.image.width };
  });
  assert.equal(result.snowSize, 128, '低画质纹理尺寸');
  await page.screenshot({ path: 'test/_polar_overview.png' });
  await page.evaluate(() => {
    const { R } = window.polarTest;
    R.camera.fov = 78; R.camera.updateProjectionMatrix();
    R.camera.position.set(-24, 1.65, -20); R.camera.lookAt(0, 4, -9); R.render();
  });
  await page.screenshot({ path: 'test/_polar_lane.png' });
  await page.evaluate(() => {
    const { R, env } = window.polarTest; env.apply('dusk'); R.render();
  });
  await page.screenshot({ path: 'test/_polar_dusk.png' });
  assert.equal(result.loaded, true, '雷达 GLB 必须真正加载');
  assert.equal(result.landmarks, 2, '两个屋顶通信地标');
  console.log('PASS 雷达 GLB、低画质纹理与真实 WebGL 渲染', result);
  const cleanup = await page.evaluate(() => {
    const p = window.polarTest, asset = p.root.getObjectByName('polar-radar-landmarks');
    let materials = 0, textures = 0;
    const seen = new Set();
    asset.traverse((o) => {
      for (const m of o.material ? [].concat(o.material) : []) {
        if (seen.has(m)) continue; seen.add(m);
        m.addEventListener('dispose', () => materials++);
        if (m.map) m.map.addEventListener('dispose', () => textures++);
      }
    });
    p.disposeMap(p.map);
    return { detached: !p.root.parent, removed: !p.root.getObjectByName('polar-radar-landmarks'), materials, textures };
  });
  assert(cleanup.detached && cleanup.removed && cleanup.materials > 0 && cleanup.textures > 0);
  console.log('PASS 离图释放雷达与贴图', cleanup);
  // 挂起模型请求，离图之后再完成下载，验证不会把对象挂回旧地图。
  let requestSeen, resumeRequest;
  const seen = new Promise((r) => { requestSeen = r; });
  const resume = new Promise((r) => { resumeRequest = r; });
  await page.route('**/polar-relay-radar.glb', async (route) => { requestSeen(); await resume; await route.continue(); });
  await page.evaluate(() => {
    const p = window.polarTest;
    p.lateRoot = new p.THREE.Group(); p.R.scene.add(p.lateRoot);
    p.lateMap = p.MAPS.polar.build(p.lateRoot, p.T, new p.World()); p.lateMap.root = p.lateRoot;
  });
  await seen;
  await page.evaluate(() => window.polarTest.disposeMap(window.polarTest.lateMap));
  resumeRequest();
  const late = await page.evaluate(async () => {
    const p = window.polarTest;
    return { loaded: await p.lateMap.assetReady, attached: !!p.lateRoot.getObjectByName('polar-radar-landmarks') };
  });
  assert.equal(late.loaded, false); assert.equal(late.attached, false);
  console.log('PASS 迟到的模型下载不会污染已退出地图');
  await page.unroute('**/polar-relay-radar.glb');
  // 最终构建页：通过真实菜单选图并启动单机，覆盖菜单→换图→出生的完整路径。
  await page.addInitScript(() => localStorage.setItem('cf_ship_opts', JSON.stringify({ quality: 'low', size: 2 })));
  await page.goto(base + '/?nolock=1');
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  await page.locator('#menu [data-k="map"] button[data-v="polar"]').click();
  await page.waitForFunction(() => window.__game.mapId === 'polar');
  assert.equal(await page.evaluate(() => window.__game.map.assetReady), true);
  await page.locator('#btnStart').click();
  await page.waitForFunction(() => window.__game.playing && window.__game.player?.alive);
  const play = await page.evaluate(() => ({ map: window.__game.mapId, actors: window.__game.actors.length, y: window.__game.player.pos.y }));
  assert.equal(play.map, 'polar'); assert.equal(play.actors, 4); assert(Math.abs(play.y) < 1);
  await page.screenshot({ path: 'test/_polar_play.png' });
  console.log('PASS 最终构建页面选图与单机开局', play);
  assert.deepEqual(errors, []);
  console.log('PASS 浏览器无运行时异常；预览保存到 test/_polar_*.png');
} catch (e) {
  console.error(e); process.exitCode = 1;
} finally {
  await browser?.close(); server.stopAll();
}
process.exit(process.exitCode || 0);
