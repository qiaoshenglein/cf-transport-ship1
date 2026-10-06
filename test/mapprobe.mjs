// 地图自检（headless，无需浏览器）：node test/mapprobe.mjs [ship|desert|town|all]
// 检查：碰撞体数量与合法性、出生点不被埋、基地↔怪口↔补给点在 NavGrid 上连通
import { NavGrid } from '../src/physics.js';
import { loadMap } from '../server/mapdata.js';
import { MAP_IDS, mapOf, suppliesForMap } from '../src/maps.js';
import { STAND_H } from '../src/movement.js';

const want = process.argv[2] || 'all';
const ids = want === 'all' ? MAP_IDS : [want];
let bad = 0;
const R = 0.42;

for (const id of ids) {
  const def = mapOf(id);
  const rec = loadMap(id);
  const [x0, z0, x1, z1] = def.bounds;
  const nav = new NavGrid(rec.world, x0, z0, x1, z1, 0.5, R);
  const n = rec.world.colliders.length;
  const nan = rec.world.colliders.some((c) => !Number.isFinite(c.x) || !Number.isFinite(c.z) || !Number.isFinite(c.hx) || !Number.isFinite(c.hy) || !Number.isFinite(c.y));
  const inRange = rec.world.colliders.every((c) => c.minX > x0 - 40 && c.maxX < x1 + 40 && c.minZ > z0 - 40 && c.maxZ < z1 + 40);
  const buried = [];
  for (const team of ['BL', 'GR']) {
    for (const p of rec.spawns[team]) {
      if (rec.world.blocked(p.x, 0.06, p.z, R, STAND_H)) buried.push(`${team} ${p.x},${p.z}`);
    }
  }
  const reach = (a, b) => {
    const path = nav.findPath(a.x, a.z, b.x, b.z);
    return !!(path && path.length);
  };
  const fails = [];
  for (const team of ['BL', 'GR']) {
    const base = rec.spawns[team][0];
    for (const s of def.pve.spawns) if (!reach(base, { x: s.x, z: s.z })) fails.push(`${team}基地->怪口 ${s.x},${s.z}`);
    for (const s of suppliesForMap(id)) if (!reach(base, s)) fails.push(`${team}基地->补给 ${s.kind}@${s.x},${s.z}`);
    if (!reach(base, rec.spawns[team === 'BL' ? 'GR' : 'BL'][0])) fails.push(`${team}基地->敌方基地`);
  }
  // 视线体检：把可走点连成线，统计"能打到 30m 外"的比例——新手图最常见的毛病是一条街通直到底
  const pts = [];
  for (let i = 4; i < nav.w; i += 14) for (let j = 4; j < nav.h; j += 12) {
    if (nav.block[j * nav.w + i]) continue;
    pts.push([x0 + (i + 0.5) * nav.cell, z0 + (j + 0.5) * nav.cell]);
  }
  let pairs = 0, long30 = 0, maxD = 0;
  for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) {
    const dx = pts[b][0] - pts[a][0], dz = pts[b][1] - pts[a][1], d = Math.hypot(dx, dz);
    if (d < 6) continue;
    pairs++;
    if (d > maxD) maxD = d;
    if (d > 30) continue;
    if (!rec.world.raycast(pts[a][0], 1.6, pts[a][1], dx / d, 0, dz / d, d - 0.15, 'sight')) long30++;
  }
  const ratio = pairs ? long30 / pairs : 0;
  // 每张图容忍度不同：运输船本就是一条长甲板，巷战图则必须把通透视线压到 18% 以下
  if (ratio > (def.sightBudget || 0.18)) fails.push(`通透视线过多 ${(ratio * 100).toFixed(0)}%（>30m 无遮挡）——需要加挡墙/房地`);
  const blockedSup = suppliesForMap(id).filter((s) => rec.world.blocked(s.x, 0.06, s.z, R, STAND_H)).map((s) => `${s.kind}@${s.x},${s.z}`);
  const blockedMon = def.pve.spawns.filter((s) => rec.world.blocked(s.x, 0.06, s.z, R, STAND_H)).map((s) => `${s.x},${s.z}`);
  const tri = rec.map.meshes ? rec.map.meshes.reduce((a, m) => a + (m.geometry.index ? m.geometry.index.count / 3 : 0), 0) : 0;
  // 顶点色 AO：合批几何必须带 color 属性，且真的压出暗端（缺属性 = 材质 vertexColors 读到 0，整图发黑）
  let aoMin = 1, aoMax = 0, aoBad = 0;
  for (const m of rec.map.meshes || []) {
    const c = m.geometry.attributes.color;
    if (!c) { aoBad++; continue; }
    for (let i = 0; i < c.array.length; i += 3) {
      if (c.array[i] < aoMin) aoMin = c.array[i];
      if (c.array[i] > aoMax) aoMax = c.array[i];
    }
  }
  if (aoBad) fails.push(`${aoBad} 个合批网格缺 color 属性`);
  if (aoMin > 0.9) fails.push(`AO 没有暗端（最亮 ${aoMin.toFixed(2)}）——接地阴影没生效`);
  if (aoMax > 1.001 || aoMin < 0.4) fails.push(`AO 取值越界 ${aoMin.toFixed(2)}~${aoMax.toFixed(2)}`);
  // 远景剪影：图外的几何不能长出碰撞体，否则玩家会被看不见的墙挡住
  const farCols = rec.world.colliders.filter((c) => Math.abs(c.x) > 46 || Math.abs(c.z) > 30).length;
  if (farCols) fails.push(`远景装饰生成了 ${farCols} 个碰撞体（应纯视觉）`);
  const ok = n > 12 && !nan && inRange && !buried.length && !fails.length && !blockedSup.length;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${id.padEnd(7)} 碰撞体 ${String(n).padStart(4)}  三角面 ${String(tri | 0).padStart(6)}  出生点 ${rec.spawns.BL.length}/${rec.spawns.GR.length}  怪口 ${def.pve.spawns.length}  补给 ${suppliesForMap(id).length}  通透视线 ${(ratio * 100).toFixed(0)}% / 最远 ${maxD.toFixed(0)}m  AO ${aoMin.toFixed(2)}~${aoMax.toFixed(2)}`);
  if (n <= 12) console.log('   ✗ 碰撞体过少：地图几乎没内容（或建造函数没跑到）');
  if (nan) console.log('   ✗ 碰撞体存在 NaN');
  if (!inRange) console.log('   ✗ 有碰撞体超出 bounds 太多（NavGrid 覆盖不到）');
  if (buried.length) console.log('   ✗ 出生点被掩体埋住：', buried.join(' '));
  if (blockedSup.length) console.log('   ✗ 补给点卡在几何里：', blockedSup.join(' '));
  if (blockedMon.length) console.log('   注：怪口落在几何体内（出生时会自动挪到附近空位）：', blockedMon.join(' '));
  if (fails.length) console.log('   ✗ 不连通：', fails.join(' | '));
}
console.log(bad ? `\n${bad} 张图有问题` : '\n全部通过');
process.exit(bad ? 1 : 0);
