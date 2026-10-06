// 地图通用建造层：合批几何 + 权威碰撞体 + 常用预制件
// 运输船 / 沙漠灰 / 黑色城镇 共用同一套 API，服务端 headless 复用时贴图全为 null，只产出碰撞体
import * as THREE from 'three';
import { mulberry32 } from './textures.js';

// 集装箱标准件尺寸（ISO）
export const CH = 2.59, CW = 2.44, L20 = 6.06, L40 = 12.19;

const FACE = {
  px: { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  nx: { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  py: { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  ny: { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  pz: { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  nz: { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
};

// 按材质合批的几何缓冲
// 顶点色 = 廉价环境光遮蔽：朝下的面压暗、侧面按"离本面底沿的高度"渐变、朝上的面保持满亮
// 比 aoMap 便宜得多（不占第二套 UV、不加贴图），且三张图与预制件一次全覆盖
const AO_DOWN = 0.5, AO_BASE = 0.72, AO_TOP = 1.0, AO_RAMP = 1.5;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function aoSide(dy) { return AO_BASE + (AO_TOP - AO_BASE) * clamp01(dy / AO_RAMP); }
class Batch {
  constructor() { this.p = []; this.n = []; this.uv = []; this.col = []; this.idx = []; this.count = 0; }
  quad(v0, v1, v2, v3, nrm, uvs) {
    const b = this.count;
    this.p.push(...v0, ...v1, ...v2, ...v3);
    for (let i = 0; i < 4; i++) this.n.push(nrm[0], nrm[1], nrm[2]);
    this.uv.push(...uvs);
    // 这一面自己的底沿：集装箱叠到 2.6m 高也能在自己的底沿下压出接触阴影
    const yb = Math.min(v0[1], v1[1], v2[1], v3[1]);
    if (nrm[1] < -0.5) for (let i = 0; i < 4; i++) this.col.push(AO_DOWN, AO_DOWN, AO_DOWN);
    else if (nrm[1] > 0.5) for (let i = 0; i < 4; i++) this.col.push(1, 1, 1);
    else {
      for (const v of [v0, v1, v2, v3]) { const s = aoSide(v[1] - yb); this.col.push(s, s, s); }
    }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.count += 4;
  }
  geom(g, m4) {
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const b = this.count;
    const v = new THREE.Vector3(), nn = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(m4);
    // 基元先摸出变换后的最低点：圆柱/球体的下半身才该压暗，抬到半空的桶不该整只发黑
    let yb = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = v.fromBufferAttribute(pos, i).applyMatrix4(m4).y;
      if (y < yb) yb = y;
    }
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m4);
      this.p.push(v.x, v.y, v.z);
      nn.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      this.n.push(nn.x, nn.y, nn.z);
      if (uv) this.uv.push(uv.getX(i), uv.getY(i)); else this.uv.push(0, 0);
      const s = nn.y < -0.5 ? AO_DOWN : nn.y > 0.5 ? 1 : aoSide(v.y - yb);
      this.col.push(s, s, s);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(b + g.index.getX(i));
    else for (let i = 0; i < pos.count; i++) this.idx.push(b + i);
    this.count += pos.count;
  }
  build(noAO) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    // 远景剪影要纯色：给满亮会把地平线照得"发飘"，直接铺 1 关掉这条
    if (noAO) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(this.count * 3).fill(1), 3));
    else g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// 一套地图 = 一个 kit：材质表 + 合批缓冲 + 碰撞体写入 + 落地阴影足迹
export function makeKit(T, world, seed = 2024) {
  const rnd = mulberry32(seed);
  const batches = new Map();
  const matDefs = {};
  const footprints = [];   // 供 AO 烘焙（仅客户端）
  const lampSpots = [];
  const anim = [];

  const batch = (key) => {
    let b = batches.get(key);
    if (!b) { b = new Batch(); batches.set(key, b); }
    return b;
  };

  // ---------- 几何工具 ----------
  // 盒子：faces 为 {px,nx,py,ny,pz,nz: matKey|null} 或单一 matKey
  function box(cx, cy, cz, sx, sy, sz, yaw, faces, uvOff) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const half = [sx / 2, sy / 2, sz / 2], size = [sx, sy, sz];
    const off = uvOff ?? [rnd(), rnd()];
    for (const fk in FACE) {
      const key = typeof faces === 'string' ? faces : faces[fk];
      if (!key) continue;
      const F = FACE[fk], def = matDefs[key];
      const su = Math.abs(F.u[0] * size[0] + F.u[1] * size[1] + F.u[2] * size[2]);
      const sv = Math.abs(F.v[0] * size[0] + F.v[1] * size[1] + F.v[2] * size[2]);
      const ctr = [F.n[0] * half[0], F.n[1] * half[1], F.n[2] * half[2]];
      const corner = (a, b) => {
        const lx = ctr[0] + F.u[0] * su * a + F.v[0] * sv * b;
        const ly = ctr[1] + F.u[1] * su * a + F.v[1] * sv * b;
        const lz = ctr[2] + F.u[2] * su * a + F.v[2] * sv * b;
        return [cx + c * lx + s * lz, cy + ly, cz - s * lx + c * lz];
      };
      const n = [c * F.n[0] + s * F.n[2], F.n[1], -s * F.n[0] + c * F.n[2]];
      let u0 = 0, v0 = 0, u1 = 1, v1 = 1;
      if (def.uv !== 'unit' && def.uv !== 'custom') {
        const tu = Array.isArray(def.uv) ? def.uv[0] : def.uv, tv = Array.isArray(def.uv) ? def.uv[1] : def.uv;
        u0 = off[0]; v0 = Array.isArray(def.uv) ? 0 : off[1];
        u1 = u0 + su / tu; v1 = v0 + sv / tv;
      }
      batch(key).quad(corner(-0.5, -0.5), corner(0.5, -0.5), corner(0.5, 0.5), corner(-0.5, 0.5), n, [u0, v0, u1, v0, u1, v1, u0, v1]);
    }
  }
  const solid = (cx, cy, cz, sx, sy, sz, yaw, props = {}) => world.add({ x: cx, y: cy, z: cz, sx, sy, sz, yaw, ...props });
  const foot = (cx, cz, sx, sz, yaw, dark = 0.6) => footprints.push({ cx, cz, sx, sz, yaw, dark });

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), vs = new THREE.Vector3(1, 1, 1);
  function geom(key, g, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    e.set(rx, ry, rz); q.setFromEuler(e); vs.set(sx, sy, sz);
    m4.compose(new THREE.Vector3(x, y, z), q, vs);
    batch(key).geom(g, m4);
  }
  const up = new THREE.Vector3(0, 1, 0);
  function rod(key, x0, y0, z0, x1, y1, z1, r) {
    const d = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0); const L = d.length(); d.normalize();
    q.setFromUnitVectors(up, d); vs.set(r, L, r);
    m4.compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), q, vs);
    batch(key).geom(prims.cyl8, m4);
  }
  // 自定义 UV 的矩形贴片（标识牌 / 地面标线）
  function decal(key, cx, cy, cz, w, h, yaw, pitch, rect, texW = 1024) {
    const c = Math.cos(yaw), s = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const tr = (lx, ly) => {
      const y1 = ly * cp, z1 = ly * sp;
      return [cx + c * lx + s * z1, cy + y1, cz - s * lx + c * z1];
    };
    const nz = [s * cp, -sp, c * cp];
    const [rx, ry, rw, rh] = rect;
    const u0 = rx / texW, u1 = (rx + rw) / texW, v1 = 1 - ry / texW, v0 = 1 - (ry + rh) / texW;
    batch(key).quad(tr(-w / 2, -h / 2), tr(w / 2, -h / 2), tr(w / 2, h / 2), tr(-w / 2, h / 2), nz, [u0, v0, u1, v0, u1, v1, u0, v1]);
  }

  // 共享基元（只作为合批输入，不进场景，不需回收）
  const prims = {
    cyl: new THREE.CylinderGeometry(1, 1, 1, 16, 1),
    cyl8: new THREE.CylinderGeometry(1, 1, 1, 8, 1),
    sph: new THREE.SphereGeometry(1, 10, 8),
    cone: new THREE.ConeGeometry(1, 1, 10, 1),
    tor: new THREE.TorusGeometry(0.32, 0.07, 8, 20),
    capsule: (r, l) => new THREE.CapsuleGeometry(r, l, 4, 12),
  };

  // ---------- 常用预制件 ----------
  function container(x, z, yawDeg, len, colorIdx, level = 0, o = {}) {
    const L = len === 40 ? L40 : L20;
    const yaw = yawDeg * Math.PI / 180;
    const cy = level * CH + CH / 2;
    const ci = colorIdx % T.containers.length;
    const side = `c${ci}${len === 40 ? 's40' : 's20'}`;
    box(x, cy, z, L, CH, CW, yaw, {
      px: o.noEnds ? null : `c${ci}door`, nx: o.noEnds ? null : `c${ci}door`,
      py: o.noTop ? null : `c${ci}roof`, ny: level > 0 ? null : null,
      pz: side, nz: side,
    });
    if (o.collide !== false) solid(x, cy, z, L, CH, CW, yaw, { mat: 'metal', surface: 'container', tag: 'container' });
    if (level === 0) foot(x, z, L, CW, yaw);
  }
  function crate(x, z, sx, sy, sz, idx, y = 0, yawDeg = 0) {
    const yaw = yawDeg * Math.PI / 180;
    box(x, y + sy / 2, z, sx, sy, sz, yaw, `crate${idx}`);
    const wood = T.crates[idx].kind === 'wood';
    solid(x, y + sy / 2, z, sx, sy, sz, yaw, { mat: wood ? 'wood' : 'metal', bullet: wood ? 'pen' : 'block', surface: wood ? 'wood' : 'metal' });
    if (y < 0.05) foot(x, z, sx, sz, yaw, 0.45);
  }
  function barrel(x, z, colorKey = 'red', y = 0) {
    geom(colorKey, prims.cyl, x, y + 0.45, z, 0, rnd() * 6, 0, 0.3, 0.9, 0.3);
    geom('black', prims.cyl, x, y + 0.9, z, 0, 0, 0, 0.29, 0.02, 0.29);
    for (const hy of [0.25, 0.65]) geom('darkSteel', prims.cyl, x, y + hy, z, 0, 0, 0, 0.305, 0.03, 0.305);
    solid(x, y + 0.45, z, 0.56, 0.9, 0.56, 0, { mat: 'metal', bullet: 'pen' });
    foot(x, z, 0.6, 0.6, 0, 0.4);
  }
  // 栏杆：从 (x0,z0) 到 (x1,z1)，底部高度 y。默认挡视线不挡弹（可以穿过去打）
  function railing(x0, z0, x1, z1, y = 0, key = 'railYellow', h = 1.1, collide = true) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dz, dx);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const n = Math.max(1, Math.round(L / 1.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      geom(key, prims.cyl8, x0 + dx * t, y + h / 2, z0 + dz * t, 0, 0, 0, 0.03, h, 0.03);
    }
    for (const hh of [h, h * 0.5, 0.08]) rod(key, x0, y + hh, z0, x1, y + hh, z1, hh === 0.08 ? 0.02 : 0.028);
    if (collide) solid(mx, y + 0.8, mz, L, 1.6, 0.1, yaw, { bullet: 'pass', sight: false, mat: 'metal' });
  }
  function fence(x0, z0, x1, z1, y0, y1, frameKey = 'railYellow', collide = true) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), yaw = Math.atan2(-dz, dx);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, h = y1 - y0;
    box(mx, (y0 + y1) / 2, mz, L, h, 0.001, yaw, { pz: 'fence' });
    geom(frameKey, prims.cyl8, x0, (y0 + y1) / 2, z0, 0, 0, 0, 0.04, h, 0.04);
    geom(frameKey, prims.cyl8, x1, (y0 + y1) / 2, z1, 0, 0, 0, 0.04, h, 0.04);
    rod(frameKey, x0, y1, z0, x1, y1, z1, 0.035);
    rod(frameKey, x0, y0 + 0.02, z0, x1, y0 + 0.02, z1, 0.035);
    if (collide) solid(mx, (y0 + y1) / 2, mz, L, h, 0.08, yaw, { bullet: 'pass', sight: false, mat: 'mesh' });
  }
  function lamp(x, y, z, pointLight = false, key = 'lamp') {
    geom(key, prims.sph, x, y, z, 0, 0, 0, 0.09, 0.09, 0.09);
    geom('darkSteel', prims.cyl8, x, y + 0.1, z, 0, 0, 0, 0.12, 0.05, 0.12);
    if (pointLight) lampSpots.push(new THREE.Vector3(x, y - 0.15, z));
  }
  // 直墙：默认挡弹挡视线。open = [{at, w, h}]（at 为沿墙从 (x0,z0) 起算的米数）自动切段并留门楣
  function wall(x0, z0, x1, z1, y0, y1, th = 0.3, key = 'wall', o = {}) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    if (L < 0.02) return;
    const yaw = Math.atan2(-dz, dx), ux = dx / L, uz = dz / L;
    const holes = (o.open || []).slice().sort((a, b) => a.at - b.at);
    const segs = [];   // [起点, 终点, 底高, 顶高]
    let cur = 0;
    for (const hp of holes) {
      const hw = (hp.w ?? 1.8) / 2;
      const a = Math.max(cur, hp.at - hw), b = Math.min(L, hp.at + hw);
      const dh = Math.min(y1, hp.h ?? 2.2);
      if (a > cur + 0.01) segs.push([cur, a, y0, y1]);
      if (b > a + 0.01 && dh < y1 - 0.01) segs.push([a, b, dh, y1]);
      if (o.threshold) {
        const mx = x0 + ux * (a + b) / 2, mz = z0 + uz * (a + b) / 2;
        box(mx, y0 + 0.05, mz, b - a, 0.1, th + 0.2, yaw, o.threshold);
      }
      cur = Math.max(cur, b);
    }
    if (cur < L - 0.01) segs.push([cur, L, y0, y1]);
    for (const [s0, s1, wy0, wy1] of segs) {
      const mx = x0 + ux * (s0 + s1) / 2, mz = z0 + uz * (s0 + s1) / 2;
      box(mx, (wy0 + wy1) / 2, mz, s1 - s0, wy1 - wy0, th, yaw, o.faces || key);
      if (o.collide !== false) solid(mx, (wy0 + wy1) / 2, mz, s1 - s0, wy1 - wy0, th, yaw, {
        mat: o.mat || 'concrete', bullet: o.bullet || 'block', surface: o.surface || 'concrete',
        ...(o.sight === false ? { sight: false } : {}),
      });
      if (o.foot !== false && wy0 <= y0 + 0.02) foot(mx, mz, s1 - s0, th, yaw, o.dark ?? 0.5);
    }
  }
  // 楼梯：沿 (x0,z0)->(x1,z1) 逐级升高到 h，n 级，宽 w；(x0,z0) 端最低
  function stairs(x0, z0, x1, z1, h, n, w, key = 'darkSteel', topKey = null) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L, yaw = Math.atan2(-dz, dx);
    const tread = L / n;
    for (let i = 0; i < n; i++) {
      const hh = h * (i + 1) / n;
      const mx = x0 + ux * (i + 0.5) * tread, mz = z0 + uz * (i + 0.5) * tread;
      box(mx, hh / 2, mz, tread, hh, w, yaw, topKey ? { py: topKey, px: key, nx: key, pz: key, nz: key } : key);
      solid(mx, hh / 2, mz, tread, hh, w, yaw, { mat: 'metal', surface: 'grate' });
    }
    foot(x0 + ux * L / 2, z0 + uz * L / 2, L, w, yaw, 0.5);
  }
  // 房屋：以 (cx,cz) 为中心、w×d 的四面围墙，可绕 yaw 旋转
  // doors = [{side:0..3（+X/-X/+Z/-Z 边）, at:-0.5..0.5（该边长度比例）, w, h}]
  function building(cx, cz, w, d, h, key = 'wall', o = {}) {
    const ry = o.yaw || 0, c = Math.cos(ry), s = Math.sin(ry);
    const tf = (lx, lz) => [cx + c * lx + s * lz, cz - s * lx + c * lz];
    const y0 = o.y0 ?? 0;
    const edges = [
      [w / 2, -d / 2, w / 2, d / 2, d],      // +X 边（沿 Z 增长），开口沿边长度 = d
      [-w / 2, d / 2, -w / 2, -d / 2, d],    // -X 边
      [-w / 2, d / 2, w / 2, d / 2, w],      // +Z 边
      [-w / 2, -d / 2, w / 2, -d / 2, w],    // -Z 边
    ];
    const doorsByEdge = [[], [], [], []];
    for (const dr of o.doors || []) {
      const e = edges[dr.side];
      doorsByEdge[dr.side].push({ at: (0.5 + (dr.at || 0)) * e[4], w: dr.w ?? 1.8, h: dr.h ?? 2.2 });
    }
    for (let i = 0; i < 4; i++) {
      const e = edges[i];
      const [ax, az] = tf(e[0], e[1]), [bx, bz] = tf(e[2], e[3]);
      wall(ax, az, bx, bz, y0, h, o.th ?? 0.3, key, {
        open: doorsByEdge[i], faces: o.faces, mat: o.mat, surface: o.surface,
        sight: o.sight, bullet: o.bullet, threshold: o.threshold,
      });
    }
    const [rx, rz] = tf(0, 0);
    if (o.roof !== false) {
      const rh = o.roofY ?? 0.16, ov = o.overhang ?? 0.2;
      box(rx, h + rh / 2, rz, w + ov, rh, d + ov, ry, o.roofKey || key);
      if (o.roofSolid !== false) solid(rx, h + rh / 2, rz, w + ov, rh, d + ov, ry, { mat: 'concrete', surface: 'concrete' });
    }
    if (o.floor) box(rx, y0 + 0.03, rz, w, 0.06, d, ry, o.floor);
    if (o.foot !== false) foot(rx, rz, w, d, ry, o.dark ?? 0.6);
    return { cx, cz, w, d, h, yaw: ry };
  }
  // 沙袋 / 矮掩体：挡弹不挡视野以下的身位
  function sandbags(x, z, w, d, h = 0.9, key = 'canvas') {
    box(x, h / 2, z, w, h, d, 0, key);
    solid(x, h / 2, z, w, h, d, 0, { mat: 'concrete', surface: 'concrete' });
    foot(x, z, w, d, 0, 0.4);
  }

  const kit = {
    T, world, rnd, matDefs, footprints, lampSpots, anim, batches, prims,
    std: (p) => new THREE.MeshStandardMaterial(p),
    def(key, mat, uv = 'unit', flags = {}) { matDefs[key] = { mat, uv, ...flags }; return mat; },
    // 纯色材质（新图最常用）
    plain(key, color, o = {}) {
      return kit.def(key, kit.std({ color, roughness: o.rough ?? 0.75, metalness: o.metal ?? 0.06, ...(o.map ? { map: o.map } : {}) }), o.tiling ?? 1, o.flags || {});
    },
    emissive(key, color, inten = 3.5) {
      return kit.def(key, kit.std({ color, emissive: color, emissiveIntensity: inten, roughness: 0.3 }), 1, { shadow: false });
    },
    box, solid, foot, geom, rod, decal,
    container, crate, barrel, railing, fence, lamp, wall, stairs, building, sandbags,
    // 生成合批网格：scene 传地图根 Group，方便整图一次性回收
    flush(scene, opts = {}) {
      const meshes = [];
      for (const [key, b] of batches) {
        if (!b.count) continue;
        const def = matDefs[key];
        const g = b.build(def.noAO);
        if (!def.noAO) def.mat.vertexColors = true;
        const mesh = new THREE.Mesh(g, def.mat);
        mesh.castShadow = def.shadow !== false;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        if (def.alpha && !opts.headless) {
          mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: def.mat.map, alphaTest: 0.5 });
        }
        mesh.name = key;
        scene.add(mesh);
        meshes.push(mesh);
      }
      world.build();
      return meshes;
    },
    update(dt, t) { for (const f of anim) f(dt, t); },
  };

  // 预制件默认材质：任何地图一上来就能用 container / crate / barrel / railing / fence
  // （运输船随后用自己的贴图材质覆盖同名键，行为不变；headless 桩里贴图全是 null）
  T.containers.forEach((c, i) => {
    const [r, g, b] = c.color.rgb;
    kit.def(`c${i}s20`, kit.std({ map: c.side20, normalMap: c.n20, roughness: 0.62, metalness: 0.3, normalScale: new THREE.Vector2(1.1, 1.1) }));
    kit.def(`c${i}s40`, kit.std({ map: c.side40, normalMap: c.n40, roughness: 0.62, metalness: 0.3, normalScale: new THREE.Vector2(1.1, 1.1) }));
    kit.def(`c${i}door`, kit.std({ map: c.door, normalMap: c.doorN, roughness: 0.6, metalness: 0.3 }));
    kit.def(`c${i}roof`, kit.std({ map: c.roof, normalMap: c.roofN, color: new THREE.Color((r * 0.6 + 60) / 200, (g * 0.6 + 60) / 200, (b * 0.6 + 60) / 200), roughness: 0.75, metalness: 0.25 }));
  });
  T.crates.forEach((c, i) => kit.def(`crate${i}`, kit.std({ map: c.map, normalMap: c.normalMap, roughness: c.kind === 'wood' ? 0.85 : 0.55, metalness: c.kind === 'wood' ? 0 : 0.4 })));
  kit.def('fence', kit.std({ map: T.fence, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.6 }), 1, { alpha: true });
  kit.def('grating', kit.std({ map: T.grating, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.6 }), 0.5, { alpha: true });
  kit.def('darkSteel', kit.std({ map: T.darkSteel.map, normalMap: T.darkSteel.normalMap, roughness: 0.55, metalness: 0.5 }), 3);
  kit.plain('railYellow', 0xd4a51c, { rough: 0.45, metal: 0.25 });
  kit.plain('railWhite', 0xe6e6e0, { rough: 0.5, metal: 0.2 });
  kit.plain('black', 0x1a1b1c, { rough: 0.8, metal: 0.1 });
  kit.plain('steel', 0x8a8f94, { rough: 0.35, metal: 0.9 });
  kit.plain('orange', 0xe0621a, { rough: 0.5, metal: 0.1 });
  kit.plain('white', 0xdedfda, { rough: 0.6, metal: 0.1 });
  kit.plain('yellow', 0xd4a51c, { rough: 0.5, metal: 0.2 });
  kit.plain('red', 0xa0302a, { rough: 0.5, metal: 0.2 });
  kit.plain('green', 0x4a6a52, { rough: 0.6, metal: 0.25 });
  kit.plain('canvas', 0xb0a184, { rough: 0.9, metal: 0.02 });
  kit.def('lamp', kit.std({ color: 0xfff2d0, emissive: 0xffe2a8, emissiveIntensity: 3.5, roughness: 0.3 }), 1, { shadow: false });
  kit.def('redLamp', kit.std({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 4, roughness: 0.3 }), 1, { shadow: false });
  kit.def('greenLamp', kit.std({ color: 0x30ff60, emissive: 0x20ff50, emissiveIntensity: 4, roughness: 0.3 }), 1, { shadow: false });
  return kit;
}

// 回收一张图：几何 / 材质 / 该图自建的贴图 / 点光源全部释放（全局 T 里的贴图属于所有图，不动）
export function disposeMap(map) {
  if (!map) return;
  if (map.root) {
    map.root.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    if (map.root.parent) map.root.parent.remove(map.root);
  }
  for (const m of Object.values(map.materials || {})) { if (m.mat && m.mat.dispose) m.mat.dispose(); }
  for (const t of map.texs || []) t.dispose();
  for (const l of map.lights || []) { if (l.parent) l.parent.remove(l); l.dispose && l.dispose(); }
  if (map.extraDispose) map.extraDispose();
}
