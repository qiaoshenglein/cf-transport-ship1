import * as THREE from 'three';
import { createArena, defineArena } from './map_tactical.js';

const palette = { wall: 0xb4b8ab, ground: 0x838a84, roof: 0x49727c, trim: 0x304c59, accent: 0xd5a140 };
function build(scene, T, world, opts = {}) {
  const { k, box, block, pair, building, sign, tank, art, finish } = createArena(scene, T, world, opts, { id: 'harbor', w: 180, d: 112, palette, seed: 8455, openSky: false, surroundGround: false });
  // 五条东西向走廊通过四条横向道路相连，每个仓库本身也能贯通。
  for (const z of [-45, 0, 45]) {
    box(0, 0.008, z, 174, 0.016, 8, 0, 'paving');
    for (let x = -82; x <= 82; x += 6) box(x, 0.02, z, 2.5, 0.015, 0.15, 0, 'accent');
  }
  for (const x of [-72, -38, 0, 38, 72]) box(x, 0.009, 0, 7, 0.018, 104, 0, 'paving');
  // 停泊区与消防通道：薄地面标线不产生额外台阶。
  for (const s of [-1, 1]) for (let x = -70; x <= 70; x += 14) {
    for (const dx of [-5.5, 5.5]) box(x + dx, 0.024, s * 39, 0.12, 0.012, 6, 0, 'ivory');
    box(x, 0.024, s * 42, 11, 0.012, 0.12, 0, 'ivory');
  }
  for (const x of [-54, 54]) for (const z of [-22, 22]) {
    building(x, z, 24, 24, 8, [0, 1, 2, 3]);
    sign(x, z + (z < 0 ? 12.3 : -12.3), 6);
    // 靠墙的货架使室内也有掩体，十字轴线完全畅通。
    for (const dx of [-8, 8]) for (const dz of [-8, 8]) {
      block(x + dx, z + dz, 4, 3, 3.2, 'trim');
      box(x + dx, 1.6, z + dz, 4.1, 0.18, 3.1, 0, 'accent');
      for (const dd of [-1, 1]) k.crate(x + dx + dd, z + dz, 1.6, 1.1, 2, 0, 3.2);
    }
  }
  // 中央集装箱堆场分成两组，箱间保留横向穿插口。
  for (const s of [-1, 1]) {
    for (const [x, z, yaw, color] of [[19, 16, 0, 0], [26, 28, 90, 2], [17, 39, 0, 3], [10, 25, 90, 1]]) {
      k.container(s * x, s * z, yaw, 40, color);
      if (z === 28) k.container(s * x, s * z, yaw, 20, color, 1);
    }
    // 对角动力站形成另外两个有明确轮廓的区域。
    building(s * 21, -s * 23, 18, 18, 6.5, [0, 1, 2, 3]);
    tank(s * 22, -s * 39, 3.2, 6, 'accent');
    tank(s * 12, -s * 39, 2.2, 4.5, 'trim');
  }
  pair(block, -7, -3, 5, 4, 3, 'accent');
  pair(block, -33, 3.5, 5, 4, 2.8, 'trim');
  pair(block, -62, -2.5, 5, 3, 2.8, 'accent');
  for (const s of [-1, 1]) for (const x of [-60, -30, 0, 30, 60]) {
    // 偏置掩体切断外圈长枪线，同时保留至少 5m 通路。
    block(x, s * 48, 5, 4, 2.8, 'trim');
    box(x, 2.9, s * 48, 5.1, 0.2, 4.1, 0, 'accent');
  }
  // 双岸吊机：可触达的支腿有碰撞；横梁在 17m 高，吊钩停在头顶。
  for (const s of [-1, 1]) {
    const x = s * 47, z = s * 51;
    for (const dx of [-8, 8]) {
      block(x + dx, z, 1.1, 1.4, 17, 'accent');
      k.rod('trim', x + dx, 5, z, x - dx, 16.5, z, 0.18);
    }
    box(x, 17.5, z, 30, 1.2, 2.4, 0, 'accent');
    // 箱形桁架与延伸到船上的吊臂，保留清晰的港口天际线。
    for (const dz of [-1.2, 1.2]) {
      k.rod('accent', x - 16, 20, z + dz, x + 16, 20, z + dz, 0.18);
      for (let dx = -16; dx < 16; dx += 4) {
        k.rod('accent', x + dx, 17.6, z + dz, x + dx + 4, 20, z + dz, 0.1);
        k.rod('trim', x + dx, 20, z + dz, x + dx + 4, 17.6, z + dz, 0.075);
      }
    }
    for (const dx of [-1.5, 1.5]) {
      k.rod('accent', x + dx, 18.5, z - s * 5, x + dx, 18.5, z + s * 25, 0.22);
      k.rod('accent', x + dx, 21, z - s * 5, x + dx, 21, z + s * 25, 0.18);
      for (let dz = -5; dz < 25; dz += 5) k.rod('trim', x + dx, 18.5, z + s * dz, x + dx, 21, z + s * (dz + 5), 0.1);
      k.rod('steel', x + dx, 21, z + s * 17, x + dx, 6, z + s * 17, 0.045);
    }
    box(x, 5.9, z + s * 17, 7, 0.5, 3, 0, 'accent');
    art.plate('detail', x, 18, z - s * 1.3, 5.5, 1.1);
    box(x - s * 8, 16, z, 3.5, 2.4, 3, 0, 'trim');
    box(x - s * 8, 16.2, z - s * 1.53, 2.7, 1.1, 0.04, 0, 'glass');
    for (const dx of [-1, 1]) k.rod('steel', x + dx, 17, z, x + dx, 10, z, 0.06);
    box(x, 10, z, 4, 0.4, 1, 0, 'trim');
    // 航标塔和远处货轮都是边界外视觉地标。
    box(s * 99, 8, s * 40, 6, 16, 6, 0, 'wall');
    box(s * 99, 17, s * 40, 8, 2, 8, 0, 'glass');
    box(s * 99, 18.2, s * 40, 9, 0.3, 9, 0, 'trim');
    k.rod('steel', s * 99, 18.2, s * 40, s * 99, 24, s * 40, 0.08);
    k.geom('redLamp', k.prims.sph, s * 99, 24, s * 40, 0, 0, 0, 0.18, 0.18, 0.18);
    for (let y = 3; y < 16; y += 3) box(s * 99, y, s * 40, 6.2, 0.25, 6.2, 0, 'trim');
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-43, -5); hullShape.lineTo(-32, -8.5); hullShape.lineTo(34, -8.5); hullShape.lineTo(44, 0);
    hullShape.lineTo(34, 8.5); hullShape.lineTo(-32, 8.5); hullShape.lineTo(-43, 5); hullShape.closePath();
    const hull = new THREE.ExtrudeGeometry(hullShape, { depth: 8, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.3, bevelThickness: 0.3 });
    k.geom('trim', hull, s * 20, 0.7, s * 75, Math.PI / 2); hull.dispose();
    for (let dx = -27; dx <= 25; dx += 13) for (const dz of [-3.2, 3.2]) {
      // 远景货柜沿用运输船纹理，但不调用会写入碰撞的预制件。
      box(s * 20 + dx, 2.1, s * 75 + dz, 11.8, 2.6, 5.8, 0, { pz: 'c0s40', nz: 'c0s40', px: 'c0door', nx: 'c0door', py: 'c0roof', ny: null });
      box(s * 20 + dx, 4.7, s * 75 + dz, 11.8, 2.6, 5.8, 0, { pz: 'c2s40', nz: 'c2s40', px: 'c2door', nx: 'c2door', py: 'c2roof', ny: null });
    }
    box(s * 56, 5.7, s * 75, 10, 10, 13, 0, 'wall');
    box(s * 56, 11.5, s * 75, 12, 2.2, 14, 0, 'ivory');
    for (const dz of [-7.05, 7.05]) for (let dx = -4.5; dx < 5; dx += 1.5) box(s * 56 + dx, 11.8, s * 75 + dz, 1.1, 1, 0.05, 0, 'glass');
    box(s * 56, 13, s * 75, 12.5, 0.3, 14.5, 0, 'trim');
    k.geom('rust', k.prims.cyl8, s * 58, 16, s * 75, 0, 0, 0, 1.4, 6, 1.4);
    k.rod('steel', s * 52, 13.2, s * 75, s * 52, 21, s * 75, 0.1);
    for (const dz of [-8, 8]) k.railing(s * 20 - 32, s * 75 + dz, s * 20 + 34, s * 75 + dz, 0.8, 'steel', 0.8, false);
  }
  return finish();
}
export const harborMap = defineArena({ id: 'harbor', name: '远海联合港', desc: '超大 · 180×112米，仓储/堆场/码头联通，建议12–16人', w: 180, d: 112, palette, label: 'UNION PORT', build, huge: true, sea: true,
  pve: { spawns: [{ x: 84, z: 0 }, { x: 80, z: -37 }, { x: 80, z: 37 }, { x: 38, z: -43 }, { x: 38, z: 43 }],
    supplies: [{ x: -84, z: -13, kind: 'med' }, { x: 84, z: 13, kind: 'med' }, { x: -38, z: -20, kind: 'ammo' }, { x: 38, z: 20, kind: 'ammo' }, { x: -6, z: -19, kind: 'armor' }, { x: 6, z: 19, kind: 'armor' }, { x: -39, z: 40, kind: 'med' }, { x: 39, z: -40, kind: 'med' }, { x: -6, z: 42, kind: 'ammo' }, { x: 6, z: -42, kind: 'ammo' }] } });
