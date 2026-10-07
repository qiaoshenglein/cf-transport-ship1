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
  // 怪口/补给之外，再算一份"到达时间"体检：导航代价 ≈ 路程 ÷ 速度，所以代价差就是先后差
  const cent = (list) => ({ x: list.reduce((a, p) => a + p.x, 0) / list.length, z: list.reduce((a, p) => a + p.z, 0) / list.length });
  const blC = cent(rec.spawns.BL), grC = cent(rec.spawns.GR);
  const poly = (p) => { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return s; };
  const cost = (a, b) => { const p = nav.findPath(a.x, a.z, b.x, b.z); return p && p.length ? poly(p) : NaN; };
  const dev = (a, b) => Math.abs(a - b) / Math.max(a, b);
  // ①两分支基地必须互为镜像，否则下面的对称比较没有意义
  const mir = Math.hypot(blC.x + grC.x, blC.z + grC.z);
  if (mir > 0.6) fails.push(`双方基地重心不互为镜像（残差 ${mir.toFixed(1)}m）——对称性检查失效`);
  // ②抢中路的到达时间必须接近：这是巷战图最常见的隐性不公
  const midB = cost(blC, { x: 0, z: 0 }), midG = cost(grC, { x: 0, z: 0 });
  if (!(midB > 0 && midG > 0)) fails.push('中路不可达');
  else if (dev(midB, midG) > 0.12) fails.push(`中路到达不对称 BL ${midB.toFixed(0)}m vs GR ${midG.toFixed(0)}m（差 ${(dev(midB, midG) * 100).toFixed(0)}%）`);
  const crossB = cost(blC, grC), crossG = cost(grC, blC);
  if (!(crossB > 0 && crossG > 0) || dev(crossB, crossG) > 0.05) fails.push('两基地互达路径代价不一致（NavGrid 有方向性 bug？）');
  // ③补给经济：双方到全部补给站的导航代价总和要接近
  let sb = 0, sg = 0, det = 0;
  for (const s of suppliesForMap(id)) {
    const a = cost(blC, s), b = cost(grC, s);
    if (!(a > 0) || !(b > 0)) { fails.push(`补给 ${s.kind}@${s.x},${s.z} 有一边根本走不到`); continue; }
    sb += a; sg += b;
    const eu = Math.min(Math.hypot(s.x - blC.x, s.z - blC.z), Math.hypot(s.x - grC.x, s.z - grC.z));
    det = Math.max(det, Math.min(a, b) / eu);          // 绕行系数：为拿个补给绕半个地图 = 死角落
  }
  if (dev(sb, sg) > 0.15) fails.push(`补给经济偏一边 BL ${sb.toFixed(0)}m vs GR ${sg.toFixed(0)}m（差 ${(dev(sb, sg) * 100).toFixed(0)}%）`);
  if (det > 1.8) fails.push(`有补给点的绕行系数 ${det.toFixed(2)}（>1.8，进了死角，没人会去拿）`);
  // ④开局机动面积：同样 45m 路程，两边各自能铺开多大地方（比值 >2 才算失衡——
  //    类 Dust2 图两半场本就不同形，允许 1.5 上下的差异）
  const reach45 = (base) => {
    const d = new Float32Array(nav.w * nav.h).fill(1e9), seen = [];
    let s = -1;
    for (let r = 0; r < 24 && s < 0; r++) for (let dj = -r; dj <= r && s < 0; dj++) for (let di = -r; di <= r && s < 0; di++) {
      const ni = Math.floor((base.x - x0) / nav.cell) + di, nj = Math.floor((base.z - z0) / nav.cell) + dj;
      if (ni < 0 || nj < 0 || ni >= nav.w || nj >= nav.h || nav.block[nj * nav.w + ni]) continue;
      s = nj * nav.w + ni;
    }
    d[s] = 0; seen.push(s);
    for (let head = 0; head < seen.length; head++) {
      const cur = seen[head], ci = cur % nav.w, cj = (cur / nav.w) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= nav.w || nj >= nav.h) continue;
        const k = nj * nav.w + ni;
        if (nav.block[k]) continue;
        if (di && dj && (nav.block[cj * nav.w + ni] || nav.block[nj * nav.w + ci])) continue;   // 不切墙角
        const nd = d[cur] + nav.cell * (di && dj ? 1.4142 : 1);
        if (nd > 45 || nd >= d[k]) continue;
        d[k] = nd; seen.push(k);
      }
    }
    return seen.length;
  };
  const rB = reach45(blC), rG = reach45(grC), rMax = Math.max(rB, rG);
  if (rMax / Math.min(rB, rG) > 2) fails.push(`开局机动面积差 ${rMax / Math.min(rB, rG)} 倍（BL ${rB} 格 / GR ${rG} 格）——一边出门就是迷宫`);
  // 双层图的硬规矩（只有声明了 twoLevel 的图才检）：头顶平台下面必须还是能走的地面通路。
  // NavGrid 只测 0.4~1.8m，架在 2.9m 的甲板对 bot 等于"不存在"；可一旦甲板下堆满掩体，
  // AI 就实际上被关在楼下，绕后与回防都比玩家慢一层——这是垂直分层图最容易踩的坑。
  // 老图不检：房屋的屋顶、运输船压在集装箱上的管道走道都属于"下面本就不需要通路"的结构
  if (def.twoLevel) {
    const decks = rec.world.colliders.filter((c) => c.solid && c.bottom > 2.2 && c.bottom < 4 && c.top - c.bottom < 1 && !c.yaw && (c.hx * 2) * (c.hz * 2) > 12);
    for (const d of decks) {
      let cells = 0, shut = 0;
      for (let i = Math.ceil((d.minX - x0) / nav.cell); i * nav.cell + x0 <= d.maxX; i++)
        for (let j = Math.ceil((d.minZ - z0) / nav.cell); j * nav.cell + z0 <= d.maxZ; j++) {
          if (i < 0 || j < 0 || i >= nav.w || j >= nav.h) continue;
          cells++;
          if (nav.block[j * nav.w + i]) shut++;
        }
      if (cells > 20 && shut / cells > 0.4) fails.push(`头顶平台 ${Math.round(d.hx * 2)}×${Math.round(d.hz * 2)}m 下有 ${Math.round(shut / cells * 100)}% 走不通（AI 被关在楼下）`);
    }
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
  console.log(`     公平性（代价=导航路程米数，÷7m/s 即到达秒数）：中路 BL ${midB.toFixed(0)} GR ${midG.toFixed(0)}  互达 ${crossB.toFixed(0)}/${crossG.toFixed(0)}  补给代价合计 BL ${sb.toFixed(0)} GR ${sg.toFixed(0)}（差 ${(dev(sb, sg) * 100).toFixed(0)}%，最差绕行 ${det.toFixed(2)}×）  机动面积 BL ${rB} GR ${rG} 格（${(rMax / Math.min(rB, rG)).toFixed(2)}×）`);
  if (n <= 12) console.log('   ✗ 碰撞体过少：地图几乎没内容（或建造函数没跑到）');
  if (nan) console.log('   ✗ 碰撞体存在 NaN');
  if (!inRange) console.log('   ✗ 有碰撞体超出 bounds 太多（NavGrid 覆盖不到）');
  if (buried.length) console.log('   ✗ 出生点被掩体埋住：', buried.join(' '));
  if (blockedSup.length) console.log('   ✗ 补给点卡在几何里：', blockedSup.join(' '));
  if (blockedMon.length) console.log('   注：怪口落在几何体内（出生时会自动挪到附近空位）：', blockedMon.join(' '));
  if (fails.length) console.log('   ✗ 不通/不公：', fails.join(' | '));
}
console.log(bad ? `\n${bad} 张图有问题` : '\n全部通过');
process.exit(bad ? 1 : 0);
