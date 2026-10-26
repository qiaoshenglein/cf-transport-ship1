import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader', '--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  page.on('pageerror', console.error);
  await page.goto('http://127.0.0.1:8094/tools/plain.html');
  console.log(await page.evaluate(async () => {
    const T = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const g = await new GLTFLoader().loadAsync('/assets/models/soldier_bl.glb');
    const bones = {};
    g.scene.traverse(o => { if (o.isBone) bones[o.name.replace(/mixamorig:?/, '')] = o; });
    g.scene.updateMatrixWorld(true);
    const report = {};
    for (const n of ['Hips', 'Spine', 'Spine2', 'Head', 'LeftUpLeg', 'RightUpLeg', 'RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand']) report[n] = bones[n]?.getWorldPosition(new T.Vector3()).toArray();
    const renderer = new T.WebGLRenderer({ antialias: true }); renderer.setSize(1100, 850); document.body.appendChild(renderer.domElement);
    const scene = new T.Scene(); scene.background = new T.Color(0x242d38);
    const cam = new T.PerspectiveCamera(35, 1100 / 850, .01, 50); cam.position.set(2.5, 1.2, 1.5); cam.lookAt(0, .5, 0);
    scene.add(new T.HemisphereLight(0xffffff, 0x667788, 2)); const light = new T.DirectionalLight(0xffffff, 3); light.position.set(3, 4, 3); scene.add(light); scene.add(g.scene);
    renderer.render(scene, cam);
    return { bones: report, box: new T.Box3().setFromObject(g.scene), clips: g.animations.map(c => [c.name, c.duration, c.tracks[0].name]) };
  }));
  await page.screenshot({ path: 'test/_soldier_raw.png' });
  console.log('fall samples', await page.evaluate(async () => {
    const T = await import('three'); const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const g = await new GLTFLoader().loadAsync('/assets/models/soldier_bl.glb');
    const mixer = new T.AnimationMixer(g.scene), clip = g.animations.find(c => c.name === 'fall'), action = mixer.clipAction(clip);
    action.setLoop(T.LoopOnce, 1); action.clampWhenFinished = true; action.play();
    const rows = [];
    for (const t of [0, 2.8, 3, 3.03334, 3.2]) { mixer.setTime(t); g.scene.updateMatrixWorld(true); g.scene.traverse(o => { if (o.isSkinnedMesh) o.computeBoundingBox(); }); rows.push([t, new T.Box3().setFromObject(g.scene).min.y]); }
    return rows;
  }));
} finally { await browser.close(); }
