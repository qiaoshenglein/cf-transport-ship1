import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
process.env.PORT = '0'; process.env.HOST = '127.0.0.1'; process.env.DEV_SRC = '1';
const server = await import('../server/index.js');
let browser;
try {
  for (let i = 0; !server.boundPort() && i < 100; i++) await new Promise(r => setTimeout(r, 30));
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const base = `http://127.0.0.1:${server.boundPort()}`;
  await page.goto(base + '/tools/plain.html');
  const loaded = await page.evaluate(async () => {
    const T = await import('three'), M = await import('/src/soldiermodels.js');
    const { Soldier } = await import('/src/character.js');
    const { Actor } = await import('/src/actor.js');
    const BL = await import('/src/bosslook.js'), BM = await import('/src/bossmodels.js');
    const loaded = await M.preloadSoldierModels();
    if (loaded.some(e => !e.ready)) throw new Error(JSON.stringify(loaded.map(e => e.error)));
    const renderer = new T.WebGLRenderer({ antialias: true }); renderer.setSize(1400, 900); renderer.setPixelRatio(1);
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
    document.body.appendChild(renderer.domElement);
    const scene = new T.Scene(); scene.background = new T.Color(0x17232f);
    const camera = new T.PerspectiveCamera(36, 1400 / 900, .02, 100); camera.position.set(3, 2.3, -6); camera.lookAt(0, .9, 0);
    scene.add(new T.HemisphereLight(0xdfefff, 0x728090, 2));
    const key = new T.DirectionalLight(0xffedda, 3); key.position.set(-3, 6, -4); scene.add(key);
    const floor = new T.Mesh(new T.PlaneGeometry(40, 40), new T.MeshStandardMaterial({ color: 0x253647, roughness: .85 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -.04; scene.add(floor);
    const grid = new T.GridHelper(20, 40, 0x39536b, 0x304356); grid.position.y = -.035; scene.add(grid);
    const a = new Soldier('BL'), b = new Soldier('GR'); a.root.position.x = -1; b.root.position.x = 1;
    scene.add(a.root, b.root); a.setWeapon('ak47'); b.setWeapon('m4a1');
    const standing = { speed: 0, fwd: 1, pitch: 0, onGround: true, crouch: false, reloading: false };
    const step = (s, pose = standing, count = 60) => { for (let i = 0; i < count; i++) s.update(1 / 60, pose); };
    step(a); step(b); renderer.render(scene, camera);
    window.S = { T, M, Soldier, Actor, BL, BM, renderer, scene, camera, a, b, standing, step };
    return loaded.map(e => ({ height: e.height, yaw: e.yaw, clips: e.clips.map(c => c.name) }));
  });
  console.log('Assets', loaded);
  await page.screenshot({ path: 'test/_soldiers_standing.png' });
  const report = await page.evaluate(async () => {
    const { T, a, b, standing, step, scene, camera, renderer, Soldier, Actor, BL, BM } = window.S;
    const checks = [], ok = (value, label, info) => checks.push({ pass: !!value, label, info });
    ok(a.human && b.human && a.human.bones.Head !== b.human.bones.Head, 'Separate cloned skeletons');
    ok(a.material.visible === false && a.mesh.visible && a.gun.visible && a.human.src.visible, 'Only new skin rendered, bone-attached weapon still visible');
    const local = new Actor({ renderer: { scene } }, { id: 999, team: 'GR', isPlayer: true });
    ok(!local.soldier.human && !local.soldier.humanEligible, 'Local first-person actor excluded');
    scene.remove(local.soldier.root); local.soldier.dispose();
    for (const s of [a, b]) {
      s.human.src.traverse(o => { if (o.isSkinnedMesh) o.computeBoundingBox(); });
      const box = new T.Box3().setFromObject(s.human.src);
      ok(box.max.y > 1.65 && box.max.y < 1.95 && box.min.y > -.15 && box.min.y < .15, s.team + ' standing scale / feet', { min: box.min.y, max: box.max.y });
      for (const [side, anchor] of [['Right', 'grip'], ['Left', 'fore']]) {
        const hand = s.human.bones[side + 'Hand'];
        const palm = hand.localToWorld(s.human.bones[side + 'HandMiddle1'].position.clone().multiplyScalar(.5));
        const gap = palm.distanceTo(s.gun.localToWorld(s.gun.userData.anchors[anchor].clone()));
        const palmLocal = s.gun.worldToLocal(palm.clone()), fore = s.gun.userData.anchors.fore;
        ok(side === 'Right' ? gap < .055 : Math.abs(palmLocal.x - fore.x) < .025 && Math.abs(palmLocal.y - fore.y) < .025 && palmLocal.z >= fore.z - .01 && palmLocal.z < fore.z + .23,
          s.team + ' ' + side + ' palm on grip / handguard', { gap, palm: palmLocal.toArray() });
      }
      s.setBodyVisible(false); ok(!s.human.src.visible && !s.mesh.visible, s.team + ' protection blink'); s.setBodyVisible(true);
    }
    // Logical pose and muzzle must be identical with/without external rendering.
    const reference = new Soldier('BL', { external: false }); reference.phase = a.phase; reference.crouchK = a.crouchK; reference.amp = a.amp;
    reference.root.position.copy(a.root.position); reference.setWeapon('ak47'); scene.add(reference.root);
    step(a, standing, 1); step(reference, standing, 1);
    ok(a.headWorld(new T.Vector3()).distanceTo(reference.headWorld(new T.Vector3())) < 1e-6 && a.muzzleWorld(new T.Vector3()).distanceTo(reference.muzzleWorld(new T.Vector3())) < 1e-6, 'Head hitbox / muzzle unchanged by visual model');
    reference.dispose(); scene.remove(reference.root);
    step(a, { ...standing, speed: 5 }, 30); const runPose = a.human.bones.LeftLeg.quaternion.clone(); step(a, { ...standing, speed: 5 }, 20);
    ok(a.human.current === 'run' && runPose.angleTo(a.human.bones.LeftLeg.quaternion) > .01, 'Official running animation advances');
    step(a, { ...standing, speed: 2 }, 30); ok(a.human.current === 'walk', 'Walking state');
    step(a, { ...standing, crouch: true }, 90);
    a.human.src.traverse(o => { if (o.isSkinnedMesh) o.computeBoundingBox(); });
    const crouch = new T.Box3().setFromObject(a.human.src);
    ok(crouch.max.y < 1.55 && crouch.max.y > 1.1, 'Crouch adapted to gameplay height', crouch.max.y);
    step(b, { ...standing, onGround: false }, 30);
    ok(b.human.procedural > .99, 'Airborne pose uses adapted procedural legs');
    renderer.render(scene, camera);
    return checks;
  });
  await page.screenshot({ path: 'test/_soldiers_crouch_jump.png' });
  const lifecycle = await page.evaluate(async () => {
    const { T, a, b, step, standing, BL, BM, renderer, scene, camera } = window.S;
    const checks = [], ok = (value, label, info) => checks.push({ pass: !!value, label, info });
    step(a, standing); step(b, standing);
    for (const weapon of ['deagle', 'awm', 'knife', 'he', 'ak47']) { a.setWeapon(weapon); step(a, { ...standing, reloading: true, pitch: .5 }, 20); }
    ok(a.human.bones.RightHand.matrixWorld.elements.every(Number.isFinite), 'Reload / pitch / weapon switching remain finite');
    step(a, standing, 60);
    await BM.preloadBossModels();
    BL.dressSoldier(a, 'tyran', false, { glow: 0 });
    ok(a.glb && !a.human.src.visible && !a.mesh.visible, 'BOSS replaces human visual');
    step(a, standing, 5); BL.undressSoldier(a); step(a, standing, 5);
    ok(!a.glb && a.human.src.visible && !a.material.visible && a.gun.visible, 'Human visual restored after BOSS');
    a.setTeam('GR'); step(a, standing, 5); ok(a.human.team === 'GR', 'Team changes replace the model'); a.setTeam('BL'); step(a, standing, 10);
    a.die(0, 1, false); step(a, {}, 180);
    a.human.src.traverse(o => { if (o.isSkinnedMesh) o.computeBoundingBox(); });
    const deathBox = new T.Box3().setFromObject(a.human.src);
    ok(a.human.current === 'fall' && deathBox.max.y < 1 && Math.abs(deathBox.min.y) < .055, 'Official death animation reaches ground', { min: deathBox.min.y, max: deathBox.max.y });
    step(a, {}, 60);
    a.human.src.traverse(o => { if (o.isSkinnedMesh) o.computeBoundingBox(); });
    ok(new T.Box3().setFromObject(a.human.src).max.y < .8, 'Completed death clip holds its final pose');
    renderer.render(scene, camera);
    return checks;
  });
  await page.screenshot({ path: 'test/_soldiers_death.png' });
  const cleanup = await page.evaluate(() => {
    const { a, b, step, standing, scene } = window.S;
    step(a, {}, 150); const faded = a.human.mats.every(m => m.opacity < .25);
    a.reset(); step(a, standing, 30); const restored = a.human.current === 'idle' && a.human.mats.every(m => m.opacity === 1);
    const mat = a.human.mats[0]; let disposed = 0; mat.addEventListener('dispose', () => disposed++);
    a.dispose(); a.dispose(); scene.remove(a.root); step(b, standing);
    return { faded, restored, disposed, detached: a.human === null, otherAlive: b.human.src.visible };
  });
  const failPage = await browser.newPage();
  await failPage.route('**/assets/models/soldier_*.glb', route => route.abort());
  await failPage.goto(base + '/tools/plain.html');
  const fallback = await failPage.evaluate(async () => {
    const { preloadSoldierModels } = await import('/src/soldiermodels.js'); const { Soldier } = await import('/src/character.js');
    await preloadSoldierModels(); const s = new Soldier('GR'); return !s.human && s.mesh.visible && s.material.visible;
  });
  const checks = [...report, ...lifecycle]; checks.forEach(c => console.log(c.pass ? 'PASS' : 'FAIL', c.label, c.info ?? ''));
  console.log('Cleanup', cleanup);
  assert.deepEqual(checks.filter(c => !c.pass), [], 'Visual/animation checks');
  assert.deepEqual(cleanup, { faded: true, restored: true, disposed: 1, detached: true, otherAlive: true });
  assert.ok(fallback, 'Network failure keeps original soldier fallback');
  assert.deepEqual(errors, []);
  console.log('PASS third-person models, animation, lifecycle, fallback and first-person actor exclusion');
} catch (e) { console.error(e); process.exitCode = 1; }
finally { await browser?.close(); server.stopAll(); }
process.exit(process.exitCode || 0);
