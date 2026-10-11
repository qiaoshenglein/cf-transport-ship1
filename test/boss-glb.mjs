// BOSS 外部模型（GLB）接入回归：真 Chrome 里跑 src/bossmodels.js + src/bosslook.js
//
// 为什么必须有：命中盒是服务端按 19 骨 FK 算的，视觉换成 GLB 后**唯一**必须成立的不变量是
// "GLB 世界高度 == 程序化人体净高 × SIZE[kind].h"，否则玩家看得见打不着。这条只能量出来，不能靠读代码相信。
// 另外三件必须验的事：脚底贴地、mixer 真的在推骨骼、模型缺失时退回程序化外观（离线 file:// 也要能玩）。
//
// 用法：ELECTRON_RUN_AS_NODE=1 node test/boss-glb.mjs（约 12s，需本机 Chrome；缺模型文件会 SKIP 而不是判失败）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

if (!fs.existsSync('assets/models/boss_tyran.glb')) { console.log('SKIP：assets/models 下没有 GLB，接入层无法验证'); process.exit(0); }

const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DEV_SRC: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let port = 0;
await new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error('服务端 10s 没报端口')), 10000);
  srv.stdout.on('data', (b) => { const m = /localhost:(\d+)/.exec(b.toString()); if (m) { port = +m[1]; clearTimeout(to); res(); } });
  srv.stderr.on('data', (b) => process.stderr.write(b));
});
const base = 'http://127.0.0.1:' + port;

let browser = null;
for (const p of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']) {
  try { browser = await chromium.launch({ executablePath: p, args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'] }); break; } catch (e) { /* 试下一个 */ }
}
if (!browser) { try { browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'] }); } catch (e) { /* 无 Chrome */ } }
if (!browser) { console.log('SKIP：本机没有 Chrome'); srv.kill('SIGTERM'); process.exit(0); }

const errs = [];
const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
page.on('pageerror', (e) => errs.push('pageerror: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' <- ')));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
// 借资产工作台页面当宿主：它已经配好 three 的 importmap，游戏侧模块可以直接动态 import
await page.goto(base + '/tools/assetlab.html', { waitUntil: 'load' });

const R = await page.evaluate(async () => {
  const THREE = await import('three');
  const { Soldier } = await import('/src/character.js');
  const { SIZE } = await import('/src/bosssize.js');
  const BM = await import('/src/bossmodels.js');
  const BL = await import('/src/bosslook.js');
  const out = [];
  const ok = (c, t, extra) => out.push((c ? 'PASS ' : 'FAIL ') + t + (extra ? '：' + extra : ''));

  // 加载进度：进场前那根条要按真实字节走，不能三格乱跳或倒退。必须在冷缓存上做（先跑，后面各用例复用同一份）
  const prog = [];
  await BM.preloadBossModels((p) => prog.push(p));
  const mono = prog.every((p, i) => i === 0 || p.frac >= prog[i - 1].frac - 1e-6);
  ok(prog.length >= 4 && mono && prog[prog.length - 1].frac > 0.999, 'preload 进度单调且收口到 100%', prog.length + '次回调');
  ok(prog.every((p) => p.totMb > 10 && p.totMb < 13) && prog.every((p) => p.mb <= p.totMb + 1e-9), '进度带真实字节量（总 ' + (prog[0] ? prog[0].totMb.toFixed(1) : '?') + 'MB）');
  ok(prog.some((p) => p.done === 0) && prog.some((p) => p.done === 2), '按文件计数覆盖首尾', prog.map((p) => p.done).join(','));

  const info = {};
  for (const k of ['tyran', 'mother', 'shade']) { const e = await BM.loadBossModel(k); info[k] = BM.bossModelInfo(k); }
  ok(Object.values(info).every((i) => i && i.bones > 40), '三只 BOSS 模型都能载入并带骨架', Object.values(info).map((i) => i && i.bones + '骨').join('/'));
  ok(Object.values(info).every((i) => i && ['idle', 'run', 'attack', 'death'].every((s) => i.picked[s])), 'idle/run/attack/death 四个语义动作全部映射到 clip',
    info.tyran && JSON.stringify(info.tyran.picked));
  ok(Object.values(info).every((i) => i && i.rebased >= 2), '各 clip 的骨盆偏移已按 idle 归零', Object.values(info).map((i) => i.rebased + '段').join('/'));

  // 渲染宿主：一个最小场景，用来量世界包围盒 + 出图
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(880, 620);
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10161f);
  const camera = new THREE.PerspectiveCamera(45, 880 / 620, 0.05, 200);
  scene.add(new THREE.HemisphereLight(0xcfe0f5, 0x2a2620, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(4, 8, 5); scene.add(key);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x2b3340 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);

  const n = BM.prewarmBossModels(renderer, scene, camera);
  ok(n === 3, '预编译覆盖到三只模型（登场那一帧不该现编译）', 'n=' + n);

  const shots = {};
  for (const k of ['tyran', 'mother', 'shade']) {
    const sol = new Soldier('GR');
    scene.add(sol.root);
    BL.dressSoldier(sol, k, false, {});
    const attached = !!sol.glb;
    const wb = new THREE.Box3().setFromObject(sol.glb ? sol.glb.src : sol.mesh), sz = new THREE.Vector3();
    wb.getSize(sz);
    const humanH = (() => { const g = sol.mesh.geometry; g.computeBoundingBox(); return g.boundingBox.max.y - g.boundingBox.min.y; })();
    const want = humanH * SIZE[k].h;
    ok(attached && Math.abs(sz.y - want) < 0.05, k + '：GLB 世界高 ' + sz.y.toFixed(2) + 'm == 命中盒高 ' + want.toFixed(2) + 'm', '差 ' + Math.abs(sz.y - want).toFixed(3));
    ok(attached && Math.abs(wb.min.y) < 0.06, k + '：脚底贴地（min.y=' + wb.min.y.toFixed(3) + '）');
    ok(attached && sol.mesh.visible === false, k + '：程序化身体已让位给 GLB');
    // 假装甲是"补轮廓"用的，穿了真模型就不该再往骨骼上挂 Mesh（光环 Sprite 挂骨骼是 FX，保留）
    ok(attached && !sol.extras.some((e) => e.isMesh && e.parent && e.parent.isBone), k + '：穿真模型后不再挂假装甲（光环类 FX 保留）', 'extras=' + (sol.extras || []).length);

    // 朝向：本项目的约定是实体面朝 -Z，Tripo 的模型脚尖朝 +Z → attach 必须转 180°，否则 BOSS 倒着追人
    const bf = (re) => { let b = null; sol.glb.src.traverse((o) => { if (!b && o.isBone && re.test(o.name)) b = o; }); return b; };
    const tp = (b) => b.getWorldPosition(new THREE.Vector3());
    const toe = tp(bf(/LeftToeBase/i)).add(tp(bf(/RightToeBase/i))).multiplyScalar(0.5);
    const ank = tp(bf(/LeftFoot/i)).add(tp(bf(/RightFoot/i))).multiplyScalar(0.5);
    const fwdZ = ank.z - toe.z;
    ok(fwdZ > 0.02, k + '：脚尖朝向 -Z（踝-趾 z 差 ' + fwdZ.toFixed(3) + 'm）');
    const head = bf(/HeadTop_End/i) || bf(/:Head$|Head/i);
    const hy = head.getWorldPosition(new THREE.Vector3()).y;
    ok(hy > sz.y * 0.82 && hy < sz.y * 1.12, k + '：头顶高 ' + hy.toFixed(2) + 'm 与整体高 ' + sz.y.toFixed(2) + 'm 一致');

    // mixer 真的在推骨骼：连续 update 后头骨位置必须变化
    const headBone = () => { let b = null; sol.glb.src.traverse((o) => { if (!b && /head/i.test(o.name)) b = o; }); return b; };
    const hb = headBone();
    const p0 = hb.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < 24; i++) sol.update(1 / 30, { speed: 5.2, fwd: 1, side: 0, crouch: false, pitch: 0, onGround: true, dead: false, t: i / 30 });
    const p1 = hb.getWorldPosition(new THREE.Vector3());
    ok(p0.distanceTo(p1) > 0.02, k + '：跑动动画在推骨骼（头骨位移 ' + p0.distanceTo(p1).toFixed(3) + 'm）');
    ok(sol.glb.st.cur === 'run', k + '：高速时切到 run 片段', 'cur=' + sol.glb.st.cur);
    sol.kick();
    for (let i = 0; i < 6; i++) sol.update(1 / 30, { speed: 0, fwd: 0, side: 0, crouch: false, pitch: 0, onGround: true, dead: false, t: i / 30 });
    ok(sol.glb.st.cur === 'attack', k + '：开火/挥爪触发 attack 片段', 'cur=' + sol.glb.st.cur);
    BM.bossAnim(sol, 'skill');
    ok(sol.glb.st.cur === 'skill', k + '：技能事件触发 skill 片段');
    sol.die(1, 0, false);
    for (let i = 0; i < 20; i++) sol.update(1 / 30, { speed: 0, fwd: 0, side: 0, crouch: false, pitch: 0, onGround: true, dead: true, t: i / 30 });
    ok(sol.glb.st.cur === 'death', k + '：死亡切到 fall/death 片段');

    camera.position.set(SIZE[k].h * 2.6, SIZE[k].h * 1.5, SIZE[k].h * 3.4);
    camera.lookAt(0, SIZE[k].h * 0.75, 0);
    renderer.render(scene, camera);
    shots[k] = renderer.domElement.toDataURL('image/png');
    BL.undressSoldier(sol);
    ok(!sol.glb && sol.mesh.visible === true, k + '：卸装后 GLB 摘除、程序化身体复位');
    scene.remove(sol.root);
  }
  // 没有 GLB 的种类保持程序化外观
  const mon = new Soldier('GR');
  scene.add(mon.root);
  BL.dressSoldier(mon, 'infected', false, {});
  ok(!mon.glb && mon.mesh.visible === true, '没有 GLB 的种类保持程序化外观（file:// 离线也不会白屏）');
  // 性能观测（只报数不断言：CI 机器负载会飘，写死阈值只会制造假失败）
  const perf = await (async () => {
    const sol = new Soldier('GR');
    scene.add(sol.root);
    BL.dressSoldier(sol, 'tyran', false, {});
    const stt = { speed: 5, fwd: 1, side: 0, crouch: false, pitch: 0, onGround: true, dead: false, t: 0 };
    for (let i = 0; i < 60; i++) sol.update(1 / 30, stt);
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) { stt.t = i / 30; sol.update(1 / 30, stt); }
    const glbMs = (performance.now() - t0) / 600;
    BL.undressSoldier(sol);
    BL.dressSoldier(sol, 'tyran', false, {});
    const t1 = performance.now();
    for (let i = 0; i < 600; i++) { stt.t = i / 30; sol.update(1 / 30, stt); }
    return { glbMs: +glbMs.toFixed(3), procMs: +((performance.now() - t1) / 600).toFixed(3) };
  })();
  out.push('INFO 每帧骨骼开销：GLB(mixer ' + (perf.glbMs - perf.procMs).toFixed(3) + 'ms 净增) 合计 ' + perf.glbMs + 'ms，纯程序化 ' + perf.procMs + 'ms');
  renderer.dispose();
  return { out, shots };
});

let fail = 0;
for (const line of R.out) { if (line.startsWith('FAIL')) fail++; console.log(line); }
if (process.argv.includes('--shots')) for (const k in R.shots) {
  fs.writeFileSync('test/_boss_' + k + '.png', Buffer.from(R.shots[k].split(',')[1], 'base64'));
}
if (!errs.length) console.log('PASS 全程无页面报错'); else { fail++; errs.slice(0, 3).forEach((e) => console.log('FAIL ' + e)); }
console.log('BOSS GLB 接入回归：' + (R.out.length - fail) + ' 通过 / ' + fail + ' 失败' + (process.argv.includes('--shots') ? '（截图 test/_boss_*.png）' : ''));
await browser.close();
srv.kill('SIGTERM');
process.exit(fail ? 1 : 0);
