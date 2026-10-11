// 资产工作台回归：真 Chrome 里跑 tools/assetlab.html —— 清单渲染、GLB 实时预览、自动验收三态、IndexedDB 持久化
//
// 为什么值得留：工作台是"人工验收模型"的唯一入口，它坏掉时没人会发现问题；而且这一轮真机跑出了三个只有浏览器能撞出来的坑：
//  · three r186 移除了 AnimationMixer.getExistingAction → 播放第一段动画就抛错
//  · glTF 的 JOINTS_0 带 normalized 标记时 three 会把骨索引读成 0.0039，skeleton.bones[小数] 越界 → 整帧渲染崩、预览黑屏
//  · loadGlb 里 current 赋值晚于 play(0) → 带动画的 GLB 必崩
// 用法：ELECTRON_RUN_AS_NODE=1 node test/assetlab.mjs（需本机 Chrome，约 12s）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

// ---------------- 造三个最小合法 GLB（含 skin + 动画），覆盖三种验收路径 ----------------
const BONE_NAMES = ['Hips', 'Spine', 'Spine1', 'Neck', 'Head', 'LeftUpperArm', 'LeftLowerArm', 'LeftHand',
  'RightUpperArm', 'RightLowerLeg', 'RightFoot', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightHand'];
function glb({ h, skinned, clipNames }) {
  const x = h * 0.175, z = h * 0.15;
  const pos = [-x, 0, -z, x, 0, -z, x, h, -z, -x, h, -z, -x, 0, z, x, 0, z, x, h, z, -x, h, z];
  const idx = [0, 1, 2, 2, 3, 0, 4, 5, 6, 6, 7, 4, 0, 4, 7, 7, 3, 0, 1, 5, 6, 6, 2, 1, 3, 7, 6, 6, 2, 3, 0, 3, 7, 7, 4, 0, 1, 2, 6, 6, 5, 1];
  const nrm = []; for (let i = 0; i < 8; i++) nrm.push(0, 1, 0);
  const parts = [], views = [];
  const put = (a, comp, size) => {
    const b = Buffer.from(a.buffer ? a.buffer : a);
    views.push({ buffer: 0, byteOffset: parts.reduce((s, p) => s + p.length, 0), byteLength: b.length });
    parts.push(b);
    if (b.length % 4) parts.push(Buffer.alloc(4 - (b.length % 4)));
    return views.length - 1;
  };
  const vPos = put(new Float32Array(pos));
  const vIdx = put(new Uint16Array(idx));
  const vNrm = put(new Float32Array(nrm));
  let vJ = -1, vW = -1;
  if (skinned) {
    const j = new Uint8Array(8 * 4), w = new Float32Array(8 * 4);
    for (let i = 0; i < 8; i++) { j[i * 4] = 1; w[i * 4] = 1; }
    vJ = put(j); vW = put(w);
  }
  const vT = clipNames.length ? put(new Float32Array([0, 0.5, 1])) : -1;
  const vOut = clipNames.map(() => put(new Float32Array([0, h * 0.5, 0, 0, h * 0.5 + 0.08, 0, 0, h * 0.5, 0])));
  const bin = Buffer.concat(parts);
  const acc = [
    { bufferView: vPos, componentType: 5126, count: 8, type: 'VEC3', min: [-x, 0, -z], max: [x, h, z] },
    { bufferView: vIdx, componentType: 5123, count: idx.length, type: 'SCALAR' },
    { bufferView: vNrm, componentType: 5126, count: 8, type: 'VEC3' },
  ];
  if (skinned) {
    acc.push({ bufferView: vJ, componentType: 5121, count: 8, type: 'VEC4', normalized: true });
    acc.push({ bufferView: vW, componentType: 5126, count: 8, type: 'VEC4' });
  }
  const base = acc.length;
  if (vT >= 0) acc.push({ bufferView: vT, componentType: 5126, count: 3, type: 'SCALAR' });
  for (const v of vOut) acc.push({ bufferView: v, componentType: 5126, count: 3, type: 'VEC3' });
  const nodes = [{ name: 'Asset', mesh: 0 }];
  if (skinned) {
    nodes[0].skin = 0; nodes[0].children = [1];
    nodes[1] = { name: 'mixamorig:' + BONE_NAMES[0], translation: [0, h * 0.5, 0], children: [] };
    for (let i = 1; i < BONE_NAMES.length; i++) { nodes.push({ name: 'mixamorig:' + BONE_NAMES[i], translation: [0, 0.2, 0] }); nodes[1].children.push(1 + i); }
  }
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes,
    meshes: [{ primitives: [{ attributes: skinned ? { POSITION: 0, NORMAL: 2, JOINTS_0: 3, WEIGHTS_0: 4 } : { POSITION: 0, NORMAL: 2 }, indices: 1, material: 0 }] }],
    materials: [{ name: 'armour', pbrMetallicRoughness: { baseColorFactor: [0.5, 0.55, 0.6, 1], metallicFactor: 0.7, roughnessFactor: 0.5 } }],
    buffers: [{ byteLength: bin.length }], bufferViews: views, accessors: acc,
  };
  if (skinned) json.skins = [{ joints: BONE_NAMES.map((_, i) => 1 + i), skeleton: 1 }];
  if (clipNames.length) {
    json.animations = clipNames.map((n, c) => ({
      name: n, samplers: [{ input: base, output: base + 1 + c, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }],
    }));
  }
  let js = JSON.stringify(json); while (js.length % 4) js += ' ';
  const jb = Buffer.from(js), pad = (4 - (bin.length % 4)) % 4, bb = Buffer.concat([bin, Buffer.alloc(pad)]);
  const head = Buffer.alloc(20), bh = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(head.length + jb.length + bh.length + bb.length, 8);
  head.writeUInt32LE(jb.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  bh.writeUInt32LE(bb.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jb, bh, bb]);
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-lab-'));
const FIX = {
  ok: path.join(TMP, 'rig_ok.glb'),
  opaque: path.join(TMP, 'Take 001.glb'),
  bad: path.join(TMP, 'flat_no_rig.glb'),
  short: path.join(TMP, 'short_boss.glb'),
};
fs.writeFileSync(FIX.ok, glb({ h: 3.4, skinned: true, clipNames: ['Idle_001', 'Humanoid Running', 'Melee Attack', 'Spell Cast', 'Death'] }));
fs.writeFileSync(FIX.opaque, glb({ h: 3.4, skinned: true, clipNames: ['Take 001', 'Take 002', 'Take 003', 'Take 004', 'Take 005'] }));
fs.writeFileSync(FIX.bad, glb({ h: 1.0, skinned: false, clipNames: [] }));
fs.writeFileSync(FIX.short, glb({ h: 1.7, skinned: true, clipNames: ['Idle_001', 'Run', 'Attack'] }));

// ---------------- 起服务端（DEV_SRC 才暴露 /tools 与 /vendor） ----------------
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DEV_SRC: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let port = 0;
await new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error('服务端 10s 内没报端口')), 10000);
  srv.stdout.on('data', (b) => { const m = /localhost:(\d+)/.exec(b.toString()); if (m) { port = +m[1]; clearTimeout(to); res(); } });
  srv.stderr.on('data', (b) => process.stderr.write(b));
});
const base = 'http://127.0.0.1:' + port;

let browser = null;
for (const p of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']) {
  try { browser = await chromium.launch({ executablePath: p, args: ['--use-gl=swiftshader', '--no-sandbox'] }); break; } catch (e) { /* 试下一个 */ }
}
if (!browser) { try { browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--no-sandbox'] }); } catch (e) { /* 没 Chrome */ } }
if (!browser) { console.log('SKIP：本机没有 Chrome，无法验证资产工作台'); srv.kill('SIGTERM'); process.exit(0); }

const errs = [];
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => errs.push('pageerror: ' + (e.stack || e.message).split('\n').slice(0, 4).join(' <- ')));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
let pass = 0, fail = 0;
const ok = (c, t) => { (c ? pass++ : fail++); console.log((c ? 'PASS ' : 'FAIL ') + t); };

await page.goto(base + '/tools/assetlab.html', { waitUntil: 'load' });
await page.waitForSelector('.item', { timeout: 10000 });
await page.evaluate(() => {
  window.__toasts = [];
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => window.__toasts.push(n.textContent)))).observe(document.getElementById('toast'), { childList: true });
});
const rows = () => page.$$eval('#detail .chk', (els) => els.filter((e) => /auto-/.test(e.className)).map((e) => ({ cls: /auto-\w+/.exec(e.className)[0], t: e.children[1].textContent })));
const pick = async (f) => {
  await (await page.$('#file')).setInputFiles(f);
  try {
    await page.waitForFunction(() => /三角面/.test(document.getElementById('hud').textContent), null, { timeout: 8000 });
  } catch (e) {
    console.log('  诊断 toasts=' + JSON.stringify(await page.evaluate(() => window.__toasts)) + ' errs=' + JSON.stringify(errs.slice(0, 2)));
    throw e;
  }
  return rows();
};
const at = (rs, k) => rs.find((r) => r.t.includes(k)) || {};

// 清单与提示词
ok((await page.$$('.item')).length === 15, '清单渲染 15 条模型条目');
ok((await page.textContent('#prog')).includes('0 / 15'), '初始进度 0/15');
await page.click('.item[data-id="boss_tyran"]');
const d0 = await page.textContent('#detail');
ok(d0.includes('骨骼要求') && d0.includes('怪物主干'), 'BOSS 条目列出怪物骨骼要求（按关键词命中）');
ok(/idle → idle\//.test(d0), '动作要求给出 Tripo 动画库英文名');
ok((await page.$$eval('.prompt', (e) => e.length)) === 2, '暴君给了两条可复制提示词');
ok((await page.textContent('.prompt')).includes('3.5 metres tall'), '提示词写死真实米制');

// 自动验收三态
const r1 = await pick(FIX.ok);
ok(at(r1, '骨骼').cls === 'auto-pass' && at(r1, '骨骼').t.includes('全含（16 骨）'), 'mixamorig 骨名全部命中：' + (at(r1, '骨骼').t || ''));
ok(at(r1, '动作片段').cls === 'auto-pass' && at(r1, '动作片段').t.includes('idle→Idle_001') && at(r1, '动作片段').t.includes('death→Death'), 'clip 名按同义词自动对上 5/5：' + (at(r1, '动作片段').t || ''));
ok(at(r1, '总高度').cls === 'auto-pass', '3.4m 落在 3.5m±15% 容差内');
ok(at(r1, '三角面').cls === 'auto-warn', '面数只做参考：远低于参考值也只标黄，不拦');
ok((await page.$$eval('#clips option', (e) => e.length)) === 5, '动画下拉列出 5 段 clip');
ok((await page.textContent('#detail')).includes('Idle_001'), '详情回显实测 clip 名');

await page.click('.item[data-id="boss_mother"]');
const r2 = await pick(FIX.opaque);
ok(at(r2, '动作片段').cls === 'auto-warn', 'clip 名不可读时标黄并提示去映射：' + (at(r2, '动作片段').t || ''));
ok((await page.$$('select[data-clip]')).length === 5, '五个语义动作各给一个映射下拉');
for (const [k, v] of [['idle', 'Take 001'], ['attack', 'Take 002'], ['skill', 'Take 003'], ['death', 'Take 004'], ['hurt', 'Take 005']]) {
  await page.selectOption('select[data-clip="' + k + '"]', v);
}
const r2b = await rows();
ok(at(r2b, '动作片段').cls === 'auto-pass' && at(r2b, '动作片段').t.includes('idle→Take 001'), '手工指认后动作判合格：' + (at(r2b, '动作片段').t || ''));
ok((await page.textContent('#detail')).includes('已手工指定'), '映射来源标注清楚（自动 / 手工）');

await page.click('.item[data-id="boss_shade"]');
const rs = await pick(FIX.short);
ok(at(rs, '总高度').cls === 'auto-warn' && at(rs, '总高度').t.includes('×1.882') && at(rs, '总高度').t.includes('3.2m'), '1.7m 挂到 3.2m 条目：等比例归一而不是退回：' + (at(rs, '总高度').t || ''));
ok(at(rs, '三角面').cls === 'auto-warn', '归一不影响其它判项（面数仍是参考值）');

await page.click('.item[data-id="mon_shooter"]');
const r3 = await pick(FIX.bad);
ok(at(r3, '骨骼').cls === 'auto-fail', '无骨骼 GLB 判红');
ok(at(r3, '动作片段').cls === 'auto-fail' && at(r3, '动作片段').t.includes('没有动画'), '无动画 GLB 判红并说明原因');

await page.click('.item[data-id="sol_human"]');
const r4 = await pick(FIX.ok);
ok(at(r4, '人形 19 骨').cls === 'auto-pass', '人形骨骼同义词组也全命中');
ok(at(r4, '总高度').cls === 'auto-warn' && at(r4, '总高度').t.includes('×0.529'), '3.4m 挂到 1.8m 底模：按目标缩到 1.8m 并标黄提醒看比例');

await page.click('.item[data-id="wp_ak47"]');
ok(at(await pick(FIX.ok), '锚点节点').cls === 'auto-warn', '武器缺 grip/fore/muzzle 锚点标黄（可按包围盒推断）');
ok((await page.textContent('#detail')).includes('grip / fore / muzzle'), '武器条目列出锚点要求');

// 状态与本地库
await page.click('[data-st="pass"]');
ok((await page.textContent('#prog')).includes('1 / 15'), '点验收合格后进度 1/15');
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.item', { timeout: 10000 });
ok((await page.textContent('#prog')).includes('1 / 15'), '刷新后验收状态仍在 IndexedDB');
ok((await page.textContent('#dbInfo')).includes('6 个 GLB'), '刷新后 6 个 GLB 二进制仍在本地库');
await page.click('.item[data-id="boss_tyran"]');
await page.waitForFunction(() => /三角面/.test(document.getElementById('hud').textContent), null, { timeout: 10000 });
ok(at(await rows(), '总高度').cls === 'auto-pass', '刷新后自动重挂 GLB 并复检');
await page.click('.item[data-id="boss_mother"]');
await page.waitForFunction(() => /三角面/.test(document.getElementById('hud').textContent), null, { timeout: 10000 });
ok(at(await rows(), '动作片段').cls === 'auto-pass', '刷新后动作名映射仍在（存在本地库而不是内存）');
// 导出验收单：走真实下载链路，拿到文件内容后校验 JSON 结构
const dl = page.waitForEvent('download', { timeout: 8000 });
await page.click('#btnExport');
let exportOk = false, exportWhy = '';
try {
  const d = await dl;
  const p = await d.path();
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const mo = j.assets.find((x) => x.id === 'boss_mother'), sh = j.assets.find((x) => x.id === 'boss_shade');
  exportOk = Array.isArray(j.assets) && j.assets.length === 15
    && j.assets.some((a) => a.status === 'pass' && a.measured && a.measured.h)
    && mo && mo.clipMap && mo.clipMap.idle === 'Take 001' && mo.clipMap.hurt === 'Take 005'
    && sh && sh.measured.scale > 1.8 && sh.measured.rawH === 1.7;
  exportWhy = exportOk ? '' : '（结构不对：' + JSON.stringify({ mo: mo && mo.clipMap, sh: sh && sh.measured }) + '）';
} catch (e) { exportWhy = '（' + e.message.split('\n')[0] + '）'; }
ok(exportOk, '导出验收单：15 条 + 实测数据 + 合格状态 + 动作映射 + 缩放系数' + exportWhy);
ok(!errs.length, '全程无页面报错' + (errs.length ? '：' + errs.slice(0, 2).join(' | ') : ''));

await browser.close();
srv.kill('SIGTERM');
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`资产工作台回归：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
