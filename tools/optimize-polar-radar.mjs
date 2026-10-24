// 保留 API 生成的几何与 UV，只把 4K 道具贴图缩至 1K，再重新打包 GLB。
// node tools/optimize-polar-radar.mjs <API输出.glb> <项目输出.glb>
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('需要输入与输出 GLB 路径');
const source = await fs.readFile(input);
if (source.readUInt32LE(0) !== 0x46546c67 || source.readUInt32LE(4) !== 2) throw new Error('只支持 GLB 2');
const jsonLength = source.readUInt32LE(12);
const doc = JSON.parse(source.subarray(20, 20 + jsonLength).toString());
const bin = source.subarray(28 + jsonLength);
const replacements = new Map();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  const colorImages = new Set(doc.materials.map((m) => doc.textures[m.pbrMetallicRoughness?.baseColorTexture?.index]?.source));
  for (const [i, image] of doc.images.entries()) {
    const view = doc.bufferViews[image.bufferView], start = view.byteOffset || 0;
    const data = bin.subarray(start, start + view.byteLength);
    const mime = colorImages.has(i) ? 'image/jpeg' : 'image/png';
    const encoded = await page.evaluate(async ({ data, mime }) => {
      const img = new Image(); img.src = data; await img.decode();
      const k = Math.min(1, 1024 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(img.width * k); canvas.height = Math.round(img.height * k);
      const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL(mime, 0.92).split(',')[1];
    }, { data: `data:${image.mimeType};base64,${data.toString('base64')}`, mime });
    image.mimeType = mime; replacements.set(image.bufferView, Buffer.from(encoded, 'base64'));
  }
} finally { await browser.close(); }
const chunks = []; let offset = 0;
for (const [i, view] of doc.bufferViews.entries()) {
  const data = replacements.get(i) || bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  view.byteOffset = offset; view.byteLength = data.length;
  chunks.push(data); offset += data.length;
  const pad = (4 - offset % 4) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
}
doc.buffers[0].byteLength = offset;
const json = Buffer.from(JSON.stringify(doc)), jsonPad = Buffer.alloc((4 - json.length % 4) % 4, 32);
const body = Buffer.concat(chunks), header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + json.length + jsonPad.length + body.length, 8);
header.writeUInt32LE(json.length + jsonPad.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
binHeader.writeUInt32LE(body.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
const result = Buffer.concat([header, json, jsonPad, binHeader, body]);
await fs.writeFile(output, result);
console.log(`GLB ${source.length} -> ${result.length} bytes; geometry and UV preserved`);
