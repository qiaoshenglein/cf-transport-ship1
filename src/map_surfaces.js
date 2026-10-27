// 每种场景使用独立表面语言；纹理完全本地生成，不依赖远程贴图。
import * as THREE from 'three';
import { mulberry32, normalFromHeight } from './textures.js';

const styles = {
  bazaar: { Wall: ['stucco', 0xcba66f], Ground: ['stone', 0x9c8d71], Roof: ['tile', 0x944e32], Metal: ['metal', 0x436d70] },
  depot: { Wall: ['brick', 0x8a5141], Ground: ['asphalt', 0x505959], Roof: ['rib', 0x476269], Metal: ['metal', 0x5f7c7c] },
  turbine: { Wall: ['panel', 0x98a9aa], Ground: ['floor', 0x596c73], Roof: ['rib', 0x354f5c], Metal: ['metal', 0x557480] },
  harbor: { Wall: ['concrete', 0x9e9f91], Ground: ['asphalt', 0x5a615e], Roof: ['rib', 0x365b62], Metal: ['metal', 0x546e70] },
};
function surface(S, pattern, color, seed) {
  const rnd = mulberry32(seed), c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d'), img = ctx.createImageData(S, S), h = new Float32Array(S * S);
  const rough = document.createElement('canvas'); rough.width = rough.height = S;
  const rc = rough.getContext('2d'), ri = rc.createImageData(S, S);
  const rgb = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
  // 整块表面周期性的色差，避免近看像白噪点、远看像纯色块。
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const cloud = Math.sin(u * Math.PI * 6 + Math.sin(v * Math.PI * 4)) * Math.cos(v * Math.PI * 8) * 0.045;
    const fine = rnd(), row = Math.floor(v * 8), bx = (u * 4 + (row % 2) * 0.5) % 1;
    let value = 0.9 + cloud + fine * 0.14, height = 0.5 + (fine - 0.5) * 0.06, seam = false;
    if (pattern === 'brick') {
      seam = v * 8 % 1 < 0.06 || bx < 0.025;
      value *= 0.88 + Math.sin(row * 71 + Math.floor(u * 4 + row % 2 * 0.5) * 91) * 0.13;
      if (seam) { value = 0.52; height = 0.12; }
    } else if (pattern === 'stone') {
      const ry = Math.floor(v * 4), tx = (u * 4 + ry % 2 * 0.5) % 1;
      seam = tx < 0.018 || v * 4 % 1 < 0.018;
      value *= 0.93 + Math.cos(ry * 28 + Math.floor(u * 4 + ry % 2 * 0.5) * 47) * 0.1;
      if (seam) { value = 0.42; height = 0.2; }
    } else if (pattern === 'rib' || pattern === 'tile') {
      const wave = Math.cos(u * Math.PI * (pattern === 'tile' ? 16 : 32));
      height = 0.5 + wave * (pattern === 'tile' ? 0.14 : 0.05);
      value *= 0.84 + wave * 0.13;
      if (pattern === 'tile' && v * 5 % 1 < 0.06) { value *= 0.65; height -= 0.1; }
    } else if (pattern === 'floor' || pattern === 'panel' || pattern === 'concrete') {
      seam = u * 2 % 1 < 0.009 || v * (pattern === 'panel' ? 4 : 2) % 1 < 0.009;
      if (seam) { value *= 0.48; height = 0.3; }
      if (pattern === 'panel') value *= (Math.floor(v * 4) % 4 === 3 ? 0.73 : 1);
    } else if (pattern === 'asphalt') {
      value = 0.77 + cloud * 2 + fine * 0.35;
      height = 0.45 + fine * 0.09;
      if (fine > 0.985) value += 0.4;
    } else if (pattern === 'metal') {
      value *= 0.85 + Math.sin(v * S * 1.5) * 0.04;
      if ((u * 8) % 1 < 0.013) { value *= 0.5; height -= 0.04; }
    } else if (pattern === 'stucco') {
      value += cloud * 2;
      if (Math.sin(u * 57 + Math.sin(v * 30) * 2) > 0.995) { value *= 0.65; height -= 0.06; }
    }
    img.data.set([...rgb.map((n) => Math.min(255, Math.max(0, n * value))), 255], i * 4);
    h[i] = height;
    const r = Math.round(pattern === 'metal' || pattern === 'rib' ? 145 + fine * 50 : pattern === 'floor' ? 165 + fine * 30 : 210 + fine * 40);
    ri.data.set([r, r, r, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0); rc.putImageData(ri, 0, 0);
  // 裂纹、轮胎擦痕和雨水流挂提供中尺度信息，画布接缝附近保持干净。
  for (let i = 0; i < 32; i++) {
    const x = (0.06 + rnd() * 0.88) * S, y = (0.06 + rnd() * 0.8) * S;
    ctx.strokeStyle = `rgba(25,27,23,${0.04 + rnd() * 0.09})`; ctx.lineWidth = Math.max(1, S / 256);
    ctx.beginPath(); ctx.moveTo(x, y);
    const vertical = ['stucco', 'brick', 'panel', 'concrete'].includes(pattern);
    ctx.lineTo(x + (vertical ? 2 : S * 0.13), Math.min(S * 0.98, y + S * (vertical ? 0.16 : 0.01))); ctx.stroke();
  }
  const map = new THREE.CanvasTexture(c), normalMap = new THREE.CanvasTexture(normalFromHeight(h, S, S, pattern === 'stone' ? 0.45 : 0.7)), roughnessMap = new THREE.CanvasTexture(rough);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, normalMap, roughnessMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  return { map, normalMap, roughnessMap };
}

function graphic(draw, w = 512, h = 256) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  return { map };
}
export function arenaTextures(id, palette, label) {
  return (T, quality = 'high') => {
    const S = quality === 'low' ? 128 : quality === 'medium' ? 256 : 512;
    const cacheKey = id + 'Surfaces' + S;
    if (!T[cacheKey]) {
      const result = {};
      for (const [suffix, [pattern, color]] of Object.entries(styles[id])) result[suffix] = surface(S, pattern, color, suffix.length * 73 + id.length * 841);
      result.Sign = graphic((ctx, w, h) => {
        ctx.fillStyle = '#' + palette.trim.toString(16).padStart(6, '0'); ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#dbb866'; ctx.lineWidth = 7; ctx.strokeRect(12, 12, w - 24, h - 24);
        ctx.fillStyle = '#f2e2ba'; ctx.font = 'bold 43px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(label, w / 2, 100); ctx.font = '24px sans-serif'; ctx.fillText('SECTOR A  ←  /  →  SECTOR B', w / 2, 175);
        ctx.font = '13px monospace'; ctx.fillText(id === 'bazaar' ? 'EST. 1927 · OLD QUARTER' : 'AUTHORIZED PERSONNEL · 07', w / 2, 216);
      });
      result.Hazard = graphic((ctx, w, h) => {
        ctx.fillStyle = '#c99b35'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#242f32';
        for (let x = -h; x < w + h; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 35, 0); ctx.lineTo(x + h + 35, h); ctx.lineTo(x + h, h); ctx.fill(); }
      }, 256, 64);
      result.Detail = graphic((ctx, w, h) => {
        ctx.fillStyle = '#20373e'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#bedac9';
        ctx.font = 'bold 42px monospace'; ctx.fillText(id === 'depot' ? 'FR-2048' : id === 'harbor' ? 'PORT 07' : 'TURBINE 02', 24, 64);
        ctx.font = '18px monospace'; ctx.fillText('INSPECTED / SERVICE ACCESS', 24, 104);
        for (let i = 0; i < 9; i++) { ctx.fillStyle = i % 3 ? '#438b83' : '#d2af50'; ctx.fillRect(24, 135 + i * 10, 160 + (i * 31 % 240), 4); }
        ctx.strokeStyle = '#6bb5ad'; ctx.lineWidth = 4; ctx.strokeRect(340, 132, 130, 96);
      });
      result.Rug = graphic((ctx, w, h) => {
        ctx.fillStyle = '#803b33'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#c8a666'; ctx.lineWidth = 7;
        for (let i = 12; i < 40; i += 12) ctx.strokeRect(i, i, w - i * 2, h - i * 2);
        for (let x = 55; x < w - 40; x += 45) for (let y = 55; y < h - 30; y += 40) { ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.lineTo(x + 13, y); ctx.lineTo(x, y + 12); ctx.lineTo(x - 13, y); ctx.closePath(); ctx.stroke(); }
      });
      T[cacheKey] = result;
    }
    for (const [suffix, value] of Object.entries(T[cacheKey])) T[id + suffix] = value;
  };
}
