// 浏览器端联机回归：进程内启动服务端 -> Playwright 驱动真实 Chrome 跑 test/netplay-harness.html
// 运行：node test/browser-net.mjs   （预算 ~30s）
import { chromium } from 'playwright-core';

process.env.PORT = '0'; process.env.HOST = '127.0.0.1'; process.env.DEV_SRC = '1';
const mod = await import('../server/index.js');
let port = 0;
for (let i = 0; i < 60 && !port; i++) { port = mod.boundPort(); if (!port) await new Promise((r) => setTimeout(r, 50)); }
console.log('测试服务端口', port);

const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('[page error]', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageexception]', String(e).slice(0, 300)));
await page.goto(`http://127.0.0.1:${port}/test/netplay-harness.html`, { waitUntil: 'domcontentloaded' });
let done = false;
try {
  await page.waitForFunction(() => document.title === 'NETDONE', null, { timeout: 24000 });
  done = true;
} catch (e) {
  console.log('超时：浏览器测试未跑完');
}
const text = await page.textContent('#out');
console.log(text);
const mres = /RESULT (\d+) (\d+)/.exec(text || '');
await browser.close();
mod.stopAll();
const fail = done && mres ? +mres[2] : 1;
console.log(done ? `完成：${mres ? mres[1] + ' 通过 / ' + mres[2] + ' 失败' : ''}` : '未完成');
process.exit(fail ? 1 : 0);
