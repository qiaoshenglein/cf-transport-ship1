// BOSS 登场帧时探针：真实（软件）WebGL 下量"基线 vs 母体登场"，定位卡死到底是渲染、重编译还是 JS
// 运行：node test/bossperf.mjs [ship|town|desert] [宽] [高]   默认 1600×900（贴近玩家实际分辨率）
import { chromium } from 'playwright-core';

const map = process.argv[2] || 'ship';
const W = +(process.argv[3] || 1600), H = +(process.argv[4] || 900);
process.env.PORT = '0'; process.env.HOST = '127.0.0.1'; process.env.DEV_SRC = '1';
const mod = await import('../server/index.js');
let port = 0;
for (let i = 0; i < 60 && !port; i++) { port = mod.boundPort(); if (!port) await new Promise((r) => setTimeout(r, 50)); }
console.log(`BOSS 性能探针 · ${map} · ${W}x${H} · 端口 ${port}`);

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--mute-audio', '--no-sandbox', '--enable-unsafe-swiftshader', `--window-size=${W},${H}`],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[err] ' + m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:${port}/test/boss-perf.html?map=${map}`, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction(() => document.title === 'PERFDONE', null, { timeout: 90000 });
} catch (e) {
  console.log('超时：探针未跑完');
}
console.log(await page.textContent('#out'));
if (errs.length) console.log('异常：\n' + errs.join('\n'));
await browser.close();
process.exit(0);
