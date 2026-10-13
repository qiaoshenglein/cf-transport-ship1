// 画质细节系统回归
//
// 为什么分两段：降载阶梯与自动调整的迟滞是纯算术，在 Node 里跑又快又准；
// 而"改一项到底落到 GPU 上没有"只能在真实 WebGL 上下文里量（applyQuality 写的是 three 的内部状态）。
// 面板部分用真 HUD 类 + 真 DOM，因为它的价值就在"每一项都渲染出来了、点了就存盘"。
//
// 用法：ELECTRON_RUN_AS_NODE=1 node test/gfx.mjs（约 12s，需本机 Chrome）
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import * as GR from '../src/graphics.js';

const out = [];
const ok = (c, t, extra) => out.push((c ? 'PASS ' : 'FAIL ') + t + (extra ? '：' + extra : ''));

// ================= 第一段：阶梯与自动调整（纯 Node） =================
{
  const keys = GR.GFX_ITEMS.map((i) => i.k);
  const tierKeys = keys.filter((k) => !['auto', 'autoTarget'].includes(k));   // 自动开关不分档位，由 gfxDefaults 统一给
  ok(keys.length >= 20, `schema 有 ${keys.length} 项画质细节`);
  ok(new Set(keys).size === keys.length, '没有重复的设置项');
  for (const tier of ['low', 'medium', 'high']) {
    const miss = tierKeys.filter((k) => GR.TIERS[tier][k] === undefined);
    ok(miss.length === 0, `${tier} 档预设为每一项都给了值`, miss.join(','));
  }
  // 越贵的档必须真的更贵：逐项比较太碎，用"高负载项取值更大"这条总体判据
  const cost = ['res', 'msaa', 'shadow', 'lamps', 'fxDensity', 'decals', 'tracers', 'bloom', 'bossGlow'];
  ok(cost.every((k) => GR.TIERS.high[k] >= GR.TIERS.medium[k] && GR.TIERS.medium[k] >= GR.TIERS.low[k]), '三档在关键负载项上单调递增');
  ok(Object.keys(GR.TIERS.high).every((k) => GR.GFX_BY_KEY[k] || ['auto', 'autoTarget'].includes(k)), '预设里没有 schema 之外的野键');

  const u = GR.userGfx({ quality: 'high', gfx: { res: 90 } });
  ok(u.res === 90 && u.shadow === 4096, '用户微调覆盖档位预设，缺的项从档位补齐');
  ok(GR.userGfx({ quality: 'high' })._level === undefined, '用户设定本身不带降载档标记');
  const l0 = GR.applyLevel(u, 0);
  ok(l0.res === u.res && l0.shadow === u.shadow && l0.bloom === u.bloom, 'applyLevel(0) 不改任何东西');

  // 降载只能往下压，绝不能替用户把画质调高（第 4 项例外：阴影刷新数值越大越省）
  let raised = [];
  for (let lv = 1; lv <= GR.LEVEL_MAX; lv++) {
    const e = GR.applyLevel(u, lv);
    for (const k of keys) {
      if (k === 'shadowEvery') { if (e[k] < u[k]) raised.push(`${k}@${lv}`); continue; }
      if (typeof u[k] === 'number' && e[k] > u[k]) raised.push(`${k}@${lv}=${e[k]}>${u[k]}`);
    }
  }
  ok(raised.length === 0, '每一档降载都不会把任何画质项调得比用户设定更高', raised.slice(0, 4).join(' '));
  // 阶梯是"上限"而不是"目标"：用户本来就更省时一律保持不动
  const deep = GR.applyLevel({ ...u, fxDensity: 0.35, decals: 20, tracers: 8, bloom: 0, msaa: 0, lamps: 1, bossGlow: 0, ambient: 0, vignette: 0, grain: 0, shadowEvery: 3 }, GR.LEVEL_MAX);
  ok(deep.decals === 20 && deep.tracers === 8 && deep.fxDensity === 0.35 && deep.msaa === 0 && deep.bloom === 0 && deep.grain === 0 && deep.shadowEvery === 3,
    '用户比阶梯更省时，阶梯一项也不动它', `decals=${deep.decals} tracers=${deep.tracers}`);
  ok(deep.lamps === 0 && GR.applyLevel({ ...u, lamps: 1 }, 4).lamps === 1, '灯光预算只在"最低负载"那一档被清零，中间档不动它');
  ok(deep.res === Math.round(u.res * 0.6), '分辨率是阶梯唯一按倍率再砍一刀的项（用户 100% → 最低 60%）');
  ok(GR.applyLevel(u, 3).res === Math.round(u.res * 0.8), '分辨率按阶梯倍率折算（用户 100% → 80%）');

  // 自动调整：迟滞 + 冷却
  const run = (mode, seq, target) => { const st = { level: 0, bad: 0, good: 0, cool: 0 }; const ch = []; for (const f of seq) { const r = GR.autoStep(st, f, target, mode); if (r) ch.push(r.level); } return { st, ch }; };
  const flat = [58, 58, 58, 58];
  ok(run('conservative', flat, 60).st.level === 0, '帧率贴着目标（差 2 以内）不动作，不来回抖');
  const down = run('conservative', [40, 40, 40, 40, 40, 40], 60);
  ok(down.ch.join(',') === '1,2', '保守档：连续 3 个窗口掉帧才降一级，且一次只降一级', down.ch.join('>'));
  const up = run('conservative', [40, 40, 40, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80], 60);
  ok(up.ch.join(',') === '1,0', '帧率回到目标以上会逐级升回去（不是"只降不升"）', up.ch.join('>'));
  const floorC = run('conservative', new Array(60).fill(10), 60);
  ok(floorC.st.level === GR.AUTO_FLOOR.conservative, '保守档有底：最多降到第 3 档，不会把画质榨干', 'level=' + floorC.st.level);
  const floorA = run('aggressive', new Array(60).fill(10), 60);
  ok(floorA.st.level === GR.LEVEL_MAX, '积极档能一路降到底', 'level=' + floorA.st.level);
  const flap = run('aggressive', [40, 80, 40, 80, 40, 80, 40, 80, 40, 80, 40, 80], 60);
  ok(flap.ch.length <= 2, '忽高忽低时冷却生效，不会每窗口换一档', '切换 ' + flap.ch.length + ' 次');
  ok(GR.describeLevel(0) === '未降载' && GR.describeLevel(2).includes('第 2 档'), '档位说明可读');
}

// ================= 第二段：实时落到 GPU 上（真 Chrome + 软件 WebGL） =================
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
if (!browser) { console.log('SKIP：本机没有 Chrome（第一段已过 ' + out.length + ' 条）'); srv.kill('SIGTERM'); process.exit(0); }

const errs = [];
const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
page.on('pageerror', (e) => errs.push('pageerror: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' <- ')));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
// 用空白宿主页：它只配 importmap，不抢 WebGL 上下文（软件渲染下第二个上下文可能建不起来）
await page.goto(base + '/tools/plain.html', { waitUntil: 'load' });

const R2 = await page.evaluate(async () => {
  const THREE = await import('three');
  const { Renderer } = await import('/src/render.js');
  const { Environment } = await import('/src/env.js');
  const { Effects } = await import('/src/effects.js');
  const BL = await import('/src/bosslook.js');
  const { Soldier } = await import('/src/character.js');
  const { HUD } = await import('/src/hud.js');
  const GFX = await import('/src/graphics.js');
  const r = [];
  const ok = (c, t, x) => r.push((c ? 'PASS ' : 'FAIL ') + t + (x ? '：' + x : ''));

  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const hi = Object.assign(GFX.userGfx({ quality: 'high', gfx: {} }), { _level: 0 });
  const R = new Renderer(canvas, hi);
  const scene = new THREE.Scene();
  const env = new Environment(R.renderer, scene, hi);
  const tiny = () => { const c = document.createElement('canvas'); c.width = c.height = 4; return new THREE.CanvasTexture(c); };
  const T = { glow: tiny(), puff: tiny(), holeMetal: tiny(), holeWood: tiny(), blood: tiny(), scorch: tiny(), flash: [tiny(), tiny(), tiny()] };
  const fx = new Effects(scene, T, R.camera);

  // ---- 渲染分辨率：内部 RT 尺寸跟着 res% 走，窗口尺寸不变 ----
  const w0 = R.rtW;
  R.applyQuality(Object.assign({}, hi, { res: 50 }));
  const w50 = R.rtW;
  R.applyQuality(hi);
  ok(w0 > 0 && Math.abs(w50 - w0 / 2) < 2, '渲染分辨率 50% 让内部缓冲减半（' + w0 + '→' + w50 + '）');
  ok(R.rtW === w0, '调回原值能精确还原内部缓冲尺寸');

  // ---- MSAA：换 render target 才能改采样数 ----
  R.applyQuality(Object.assign({}, hi, { msaa: 0 }));
  const s0 = R.composer.renderTarget1.samples;
  R.applyQuality(Object.assign({}, hi, { msaa: 4 }));
  const s4 = R.composer.renderTarget1.samples;
  ok(s0 === 0 && s4 === 4, '抗锯齿采样数实时生效（0→4）', 'samples=' + s0 + '/' + s4);
  ok(R.composer.renderTarget1 !== R.composer.renderTarget2, '换 RT 后两块缓冲仍然独立（否则 composer 会自我读写）');

  // ---- 辉光三兄弟 + 屏幕特效 uniform ----
  R.applyQuality(Object.assign({}, hi, { bloom: 0, bloomStrength: 0.31, bloomThreshold: 4.5, vignette: 0.62, grain: 0.041, hurtFx: 0.25 }));
  ok(R.bloom && R.bloom.enabled === false, '辉光开关直接落在 pass.enabled 上');
  ok(Math.abs(R.bloom.strength - 0.31) < 1e-6 && Math.abs(R.bloom.threshold - 4.5) < 1e-6, '辉光强度/阈值生效');
  const fu = R.fx.uniforms;
  ok(Math.abs(fu.uVignette.value - 0.62) < 1e-6 && Math.abs(fu.uGrain.value - 0.041) < 1e-6 && Math.abs(fu.uHurt.value - 0.25) < 1e-6, '暗角/颗粒/受击强度进了着色器 uniform');
  R.applyQuality(hi);
  ok(R.bloom.enabled === true, '辉光能再打开（不用重建管线）');

  // ---- 阴影：分辨率 + 总开关（生效层两处：env 管灯，renderer 管通道） ----
  env.applyQuality(Object.assign({}, hi, { shadow: 1024 }));
  R.applyQuality(Object.assign({}, hi, { shadow: 1024 }));
  ok(env.sun.shadow.mapSize.x === 1024 && env.sun.castShadow === true, '阴影分辨率热切到 1024');
  env.applyQuality(Object.assign({}, hi, { shadow: 0 }));
  R.applyQuality(Object.assign({}, hi, { shadow: 0 }));
  ok(env.sun.castShadow === false && R.renderer.shadowMap.enabled === false, '关阴影同时关掉渲染器的阴影通道');
  env.applyQuality(hi); R.applyQuality(hi);
  ok(env.sun.shadow.mapSize.x === 4096 && R.renderer.shadowMap.enabled === true, '阴影能回到 4096');

  // ---- 曝光与雾：切时间(tod)不能把用户倍率冲掉（apply() 会重算一切，最容易漏） ----
  env.applyQuality(hi);
  const eBase = R.renderer.toneMappingExposure;
  env.applyQuality(Object.assign({}, hi, { exposure: 1.3, fogK: 0.4 }));
  ok(Math.abs(eBase * 1.3 - R.renderer.toneMappingExposure) < 1e-6, '曝光倍率 1.3 生效');
  env.apply('dusk');
  ok(Math.abs(R.renderer.toneMappingExposure - env.preset.exposure * 1.3) < 1e-6, '换时间后曝光倍率没被 apply() 冲掉');
  ok(Math.abs(scene.fog.density - env.preset.fogDensity * 0.4) < 1e-9, '换时间后雾倍率没被冲掉');
  env.applyQuality(Object.assign({}, hi, { exposure: 1, fogK: 1 }));
  env.applyQuality(Object.assign({}, hi, { clouds: 0 }));
  const cv = env.clouds.visible;
  env.applyQuality(hi);
  ok(cv === false && env.clouds.visible === true, '云层能关能开');

  // ---- 特效预算 ----
  fx.applyQuality(Object.assign({}, hi, { fxDensity: 0.5, decals: 30, tracers: 8, lamps: 0, ambient: 0 }));
  ok(fx.add.max === 450 && fx.smoke.max === 450, '粒子密度 50% 把两池上限砍半（900→' + fx.add.max + '）');
  ok(fx.decals.metal.max === 30 && fx.decals.wood.max === 30 && fx.decals.scorch.max === 12, '弹孔上限逐项封顶，不会超过各自的池容量');
  ok(fx.tracerMax === 8, '曳光上限生效');
  const before = fx.lights.reduce((a, L) => a + L.l.intensity, 0);
  fx.light(new THREE.Vector3(0, 1, 0), 9, 0.1);
  ok(before === 0 && fx.lights.every((L) => L.l.intensity === 0), '灯光预算为 0 时枪口动态光直接不分配');
  fx.applyQuality(hi);
  fx.light(new THREE.Vector3(0, 1, 0), 9, 0.1);
  ok(fx.lights.some((L) => L.l.intensity > 0), '恢复灯光预算后枪口光又能用');
  ok(fx.add.max === 900 && fx.decals.metal.max === 160 && fx.tracerMax === 48, '特效预算能精确还原到满档');

  // ---- BOSS 光效分档：降档热切，升档必须重穿（面片当初没建） ----
  const sol = new Soldier('GR');
  BL.dressSoldier(sol, 'tyran', false, { glow: 2 });
  const built = { halo: !!(sol.fxRefs && sol.fxRefs.halo), beam: !!(sol.fxRefs && sol.fxRefs.beam), ring: !!sol.aura };
  ok(built.halo && built.beam && built.ring, '完整档建出了光环/天光柱/地面环');
  ok(BL.glowVisible(sol, 0) === true && sol.fxRefs.halo.o.visible === false && sol.aura.visible === false, '降到 0 档：现成的面片直接隐藏，不用重穿');
  ok(BL.glowVisible(sol, 2) === true && sol.fxRefs.halo.o.visible === true, '切回 2 档：只是重新显示（当前已是 2 档）');
  BL.undressSoldier(sol);
  BL.dressSoldier(sol, 'tyran', false, { glow: 1 });
  ok(!sol.fxRefs.halo && !sol.fxRefs.beam && !!sol.aura, '精简档只留地面技能环（它是危险范围信息，不是装饰）');
  ok(BL.glowVisible(sol, 2) === false, '从精简档升到完整档报告"需要重穿"');
  BL.undressSoldier(sol);

  // ---- 面板：每一项都渲染出来、点了就走真实的 onOption → applyGfx 落到 GPU 上 ----
  const { Game } = await import('/src/game.js');
  const ui = document.createElement('div'); ui.id = 'ui'; document.body.appendChild(ui);
  const spy = [];
  // 用真的 Game 原型当宿主：面板只负责写 opts 并回调 onOption，路由与生效全在 game.js 里，
  // 用假对象会把这条链整个跳过（那样测出来的"通过"是假的）
  const fake = Object.assign(Object.create(Game.prototype), {
    opts: null, hud: null, renderer: R, env, fx, autoLevel: 0, mapLights: [], map: null, net: null, vm: null,
    playing: false, paused: false, ended: true, fps: 61, infoCalls: 123, infoProgs: 45,
    audio: { setVolumes() { }, playUI() { } },
    onOption(k, v) { spy.push([k, v]); Game.prototype.onOption.call(this, k, v); },
  });
  const hud = new HUD(fake);
  fake.hud = hud; fake.opts = hud.opts;
  ok(!!hud.el.gfx && hud.el.gfx.classList.contains('hidden'), '画面设置屏在模板里（默认隐藏）');
  ok(hud.root.querySelectorAll('#gfxBody .gfxRow').length === GFX.GFX_ITEMS.length, '面板为每一项都生成了控件', hud.root.querySelectorAll('#gfxBody .gfxRow').length + '/' + GFX.GFX_ITEMS.length);
  ok(hud.root.querySelectorAll('#gfxBody [data-k^="gfx."]').length === GFX.GFX_ITEMS.length, '控件都带 gfx. 前缀的键名');
  ok(GFX.GFX_GROUPS.every((g) => hud.root.innerHTML.includes(g.g)), '分组标题都出现了');
  hud.openGfx();
  ok(!hud.el.gfx.classList.contains('hidden') && hud.el.menu.classList.contains('hidden'), '打开面板：只留一屏，主菜单让位');
  hud.gfxSync();
  const stat = hud.el.gfxStat.textContent;
  ok(stat.includes('61') && stat.includes('123') && stat.includes('45'), '读数条显示 FPS / draw call / 着色器数', stat.slice(0, 60));
  hud.root.querySelector('#gfxBody .seg[data-k="gfx.bloom"] button[data-v="0"]').click();
  ok(hud.opts.gfx.bloom === 0 && R.bloom.enabled === false, '点"辉光关闭"经真实 onOption 落到 pass.enabled 上', spy.map((s) => s[0]).join(','));
  const rng = hud.root.querySelector('#gfxBody .slider[data-k="gfx.res"] input');
  rng.value = '50'; rng.dispatchEvent(new Event('input'));
  ok(hud.opts.gfx.res === 50 && hud.root.querySelector('.slider[data-k="gfx.res"] span').textContent === '50%' && R.rtW === Math.round(900 / 2), '滑杆：写入、回显带单位、并真的改了内部缓冲', 'rtW=' + R.rtW);
  ok(JSON.parse(localStorage.getItem('cf_ship_opts')).gfx.res === 50, '设置写进 localStorage');
  hud.root.querySelector('#gfxBody .seg[data-k="gfx.tex"] button[data-v="low"]').click();
  ok(hud.opts.gfx.tex === 'low' && spy.some((s) => s[0] === 'gfx.tex'), '贴图精度同样即时下发（生效层自己决定下一局才用）');
  hud.calmGfx();
  ok(hud.opts.gfx.shake === 0.1 && hud.opts.gfx.bob === 0.3 && hud.opts.gfx.grain === 0 && R.fx.uniforms.uGrain.value === 0, '防晕预设一次给足四项并立刻生效');
  hud.opts.gfx.bloom = 1; hud.saveOpts();
  hud.root.querySelector('#menu .seg[data-k="quality"] button[data-v="low"]').click();
  ok(hud.opts.quality === 'low' && hud.opts.gfx.bloom === 0 && hud.opts.gfx.res === 80, '切档位会把细节项整体换成该档预设');
  ok(R.bloom.enabled === false && R.rtW === Math.round(900 * 0.8), '切档位无需刷新页面就落到 GPU 上', 'rtW=' + R.rtW);
  ok(hud.getOpt('gfx.res') === 80 && hud.getOpt('fov') === hud.opts.fov, '嵌套键与平铺键共用一套读写');
  // 自动调整走真实链路：喂低帧率 → 阶梯降载 → 再喂高帧率 → 原样升回用户的设定
  hud.opts.gfx.auto = 'aggressive'; hud.opts.gfx.autoTarget = 60; hud.opts.gfx.res = 100; hud.opts.gfx.bloom = 1;
  fake.playing = true;   // 自动调整只管对局中：菜单里掉帧不该动画质
  for (let i = 0; i < 4; i++) { fake.fps = 20; Game.prototype.autoTick.call(fake); }
  ok(fake.autoLevel >= 1 && R.bloom.enabled === false && R.rtW < 900, '自动调整：持续掉帧后真的降了载', 'level=' + fake.autoLevel);
  const mid = Object.assign({}, hud.opts.gfx);
  for (let i = 0; i < 14; i++) { fake.fps = 120; Game.prototype.autoTick.call(fake); }
  ok(fake.autoLevel === 0 && R.rtW === Math.round(900 * (hud.opts.gfx.res / 100)) && mid.res === 100, '自动调整：帧率回来后逐级升回用户设定（不是只降不升）', 'level=' + fake.autoLevel);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
  ok(!hud.el.menu.classList.contains('hidden') && hud.el.gfx.classList.contains('hidden'), 'Esc 从面板返回上一页');
  R.renderer.dispose();
  return r;
});

let fail = 0;
for (const line of out.concat(R2)) { if (line.startsWith('FAIL')) fail++; console.log(line); }
if (!errs.length) console.log('PASS 全程无页面报错'); else { fail++; errs.slice(0, 3).forEach((e) => console.log('FAIL ' + e)); }
const total = out.length + R2.length;
// --shots：真游戏页面里走一遍入口按钮 → 面板，用眼睛确认布局（CSS 的事不能只靠断言）
let shot = null;
if (process.argv.includes('--shots')) {
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  p2.on('pageerror', (e) => errs.push('game pageerror: ' + e.message));
  await p2.goto(base + '/', { waitUntil: 'load' });
  await p2.waitForFunction(() => document.querySelector('#menu:not(.hidden)'), { timeout: 30000 });
  await p2.screenshot({ path: 'test/_gfx_menu.png' });
  await p2.click('#menu [data-act="gfx"]');
  await p2.waitForFunction(() => !document.querySelector('#gfx').classList.contains('hidden'));
  await p2.evaluate(() => { document.querySelectorAll('#gfx .gfxG')[3].scrollIntoView(); });
  await p2.screenshot({ path: 'test/_gfx_panel.png' });
  const box = await p2.evaluate(() => {
    const b = document.querySelector('#gfx .gfxBox'), sc = document.querySelector('#gfxBody');
    const cs = getComputedStyle(document.querySelector('#gfx .gfxH'));
    return { h: b.getBoundingClientRect().height, vh: innerHeight, scrollable: sc.scrollHeight > sc.clientHeight, headColor: cs.color, rows: sc.querySelectorAll('.gfxRow').length };
  });
  shot = box;
  console.log((box.h <= box.vh && box.scrollable && box.headColor !== 'rgb(0, 0, 0)' ? 'PASS' : 'FAIL')
    + ` 截图：面板不超出视口(${Math.round(box.h)}/${box.vh})、中间可滚(${box.scrollable})、${box.rows} 行已排布`);
  if (!(box.h <= box.vh && box.scrollable)) fail++;
  // 真实用户路径再走一遍：返回主菜单 → 开始游戏 → Esc 暂停 → 画面设置 → 关掉阴影与辉光 → 回到对局
  await p2.click('#gfx [data-act="gfxBack"]');
  await p2.waitForFunction(() => !document.querySelector('#menu').classList.contains('hidden'));
  await p2.click('#btnStart');
  await p2.waitForFunction(() => !document.querySelector('#hud').classList.contains('hidden'), { timeout: 25000 });
  await p2.waitForTimeout(1600);
  await p2.screenshot({ path: 'test/_gfx_play.png' });
  // 无头环境里按下 Esc 不会真的解除指针锁定，直接走浏览器同一件事：exitPointerLock → onLockChange → 暂停
  await p2.evaluate(() => document.exitPointerLock && document.exitPointerLock());
  await p2.waitForFunction(() => !document.querySelector('#pause').classList.contains('hidden'), { timeout: 8000 });
  await p2.click('#pause [data-act="gfx"]');
  await p2.waitForFunction(() => !document.querySelector('#gfx').classList.contains('hidden'));
  await p2.click('#gfx .seg[data-k="gfx.shadow"] button[data-v="0"]');
  await p2.click('#gfx .seg[data-k="gfx.bloom"] button[data-v="0"]');
  await p2.click('#gfx .seg[data-k="gfx.auto"] button[data-v="aggressive"]');
  await p2.click('#gfx [data-act="gfxBack"]');
  await p2.waitForFunction(() => !document.querySelector('#pause').classList.contains('hidden'));
  const live = await p2.evaluate(() => JSON.parse(localStorage.getItem('cf_ship_opts')).gfx);
  const pass2 = live.shadow === 0 && live.bloom === 0 && live.auto === 'aggressive';
  if (!pass2) fail++;
  console.log((pass2 ? 'PASS' : 'FAIL') + ` 对局中改的三项立刻存盘（shadow=${live.shadow} bloom=${live.bloom} auto=${live.auto}）`);
  await p2.click('#btnResume');
  await p2.waitForTimeout(1500);
  await p2.screenshot({ path: 'test/_gfx_play2.png' });
  await p2.close();
}
if (process.env.CHECK) console.log('CHECK ' + JSON.stringify(shot));
console.log('画质细节回归：' + (total - fail) + ' 通过 / ' + fail + ' 失败');
await browser.close();
srv.kill('SIGTERM');
process.exit(fail ? 1 : 0);
