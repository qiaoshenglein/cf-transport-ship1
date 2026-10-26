import { createArena, defineArena } from './map_tactical.js';

const palette = { wall: 0xc5cccb, ground: 0x7d919b, roof: 0x385966, trim: 0x254553, accent: 0xd18a40 };
function build(scene, T, world, opts = {}) {
  const { k, box, block, pair, building, sign, tank, finish } = createArena(scene, T, world, opts, { id: 'turbine', w: 84, d: 52, palette, openSky: false });
  // 四间贯通机房围绕中心采光厅；外圈检修道始终连通。
  for (const x of [-19, 19]) for (const z of [-11, 11]) {
    building(x, z, 16, 14, 6, [0, 1, 2, 3]);
    for (const dx of [-5, 5]) {
      block(x + dx, z - 4, 2, 2, 2.7, 'trim');
      block(x + dx, z + 4, 2, 2, 2.7, 'trim');
      for (const dz of [-4, 4]) for (let y = 0.5; y < 2.6; y += 0.5) box(x + dx, y, z + dz + 1.02, 1.5, 0.06, 0.04, 0, 'greenLamp');
    }
    sign(x, z < 0 ? z + 7.3 : z - 7.3, 5.2);
  }
  pair(tank, -5, -7, 2, 3.6, 'accent');
  pair(block, -6, 2.5, 3, 2.4, 2.4, 'trim');
  pair(block, -18, -22, 6, 1.8, 2.4, 'accent');
  pair(block, -4, -20, 5, 3, 2.8, 'trim');
  for (const x of [-31, 31]) for (const z of [-13, 13]) block(x, z, 1.4, 8, 4, 'wall');
  // 高位管束与承重肋：所有地面通路净高至少 4.3m。
  for (const z of [-23, 23]) for (const dz of [-0.4, 0.4]) k.rod('steel', -38, 5.4, z + dz, 38, 5.4, z + dz, 0.23);
  for (const x of [-30, 0, 30]) {
    block(x, 0, 0.4, 49, 0.5, 'trim', 8.5);
    for (const z of [-24, 24]) block(x, z, 0.6, 0.6, 8.5, 'trim');
    for (let z = -20; z <= 20; z += 10) box(x, 8.35, z, 1, 0.1, 3.2, 0, 'lamp');
  }
  // 中厅天窗用横肋留出天空；端部和机房有不透光屋顶。
  for (const x of [-35, 35]) block(x, 0, 12, 50, 0.35, 'roof', 8.7);
  for (const z of [-24, 24]) block(0, z, 84, 1, 8.5, 'wall');
  for (let z = -20; z <= 20; z += 4) box(0, 8.7, z, 58, 0.22, 0.3, 0, 'steel');
  for (const z of [-20, 0, 20]) {
    box(0, 0.01, z, 78, 0.02, 0.16, 0, 'accent');
    for (let x = -35; x < 36; x += 6) box(x, 0.015, z + 1, 1.2, 0.01, 0.14, 0, 'white');
  }
  return finish();
}
export const turbineMap = defineArena({ id: 'turbine', name: '涡轮研究所', desc: '普通 · 贯通机房、储罐中厅与检修道，近中距交火', w: 84, d: 52, palette, label: 'TURBINE LAB', build,
  pve: { spawns: [{ x: 37, z: 0 }, { x: 35, z: -17 }, { x: 35, z: 17 }, { x: 19, z: 0 }, { x: 0, z: 19 }],
    supplies: [{ x: -37, z: -12, kind: 'med' }, { x: 37, z: 12, kind: 'med' }, { x: -25, z: -20, kind: 'ammo' }, { x: 25, z: 20, kind: 'ammo' }, { x: -6, z: -14, kind: 'armor' }, { x: 6, z: 14, kind: 'armor' }] } });
