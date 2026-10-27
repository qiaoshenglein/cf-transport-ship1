import { createArena, defineArena } from './map_tactical.js';

const palette = { wall: 0x9badae, ground: 0x798080, roof: 0x55727d, trim: 0x344751, accent: 0xd4a34b };
function build(scene, T, world, opts = {}) {
  const { k, box, block, pair, building, sign, art, finish } = createArena(scene, T, world, opts, { id: 'depot', w: 88, d: 56, palette, seed: 8420 });
  // 三股轨道只是地面标记，不会绊住玩家或改变导航高度。
  for (const z of [-12, 0, 12]) {
    box(0, 0.008, z, 84, 0.012, 3.2, 0, 'ground');
    for (let x = -39; x < 40; x += 1.2) for (const dz of [-1.3, 1.3])
      k.geom('trim', k.prims.cyl8, x, 0.035, z + dz, 0, k.rnd() * 6, 0, 0.16, 0.055, 0.13);
    for (let x = -40; x < 41; x += 1.5) box(x, 0.02, z, 0.22, 0.04, 2.8, 0, 'trim');
    for (const dz of [-1, 1]) box(0, 0.05, z + dz, 84, 0.07, 0.09, 0, 'steel');
  }
  const wagon = (x, z, color) => {
    block(x, z, 16, 3.6, 3.6, color);
    box(x, 3.7, z, 16.3, 0.2, 3.9, 0, 'roof');
    for (const dz of [-1.84, 1.84]) {
      box(x, 0.6, z + dz, 16, 0.4, 0.1, 0, 'trim');
      for (let dx = -7; dx <= 7; dx += 1.4) box(x + dx, 2, z + dz, 0.12, 3.2, 0.1, 0, 'trim');
      box(x, 2, z + dz * 1.02, 3.1, 2.8, 0.08, 0, 'roof');
      for (const dx of [-5.5, 5.5]) k.geom('black', k.prims.cyl, x + dx, 0.5, z + dz, Math.PI / 2, 0, 0, 0.5, 0.2, 0.5);
    }
    for (const dx of [-8.4, 8.4]) block(x + dx, z, 0.8, 0.6, 0.8, 'trim');
    art.wagon(x, z);
  };
  wagon(-15, -12, 'accent'); wagon(15, 12, 'accent');
  wagon(-14, 5, 'wall'); wagon(14, -5, 'wall');
  // 南北维修库提供与车厢枪线垂直的近战捷径。
  building(-26, 20, 14, 10, 6, [0, 1, 3]); building(26, -20, 14, 10, 6, [0, 1, 2]);
  sign(-26, 14.7); sign(26, -14.7);
  // 中央候车雨棚，轨道间留 6 米通路。
  block(0, 0, 11, 32, 0.3, 'roof', 6.3);
  for (const x of [-4.8, 4.8]) for (const z of [-14, 14]) {
    block(x, z, 0.4, 0.4, 6.3, 'trim');
    k.rod('accent', x, 5, z, 0, 6.3, z, 0.09);
  }
  for (const z of [-14, 0, 14]) box(0, 6.1, z, 4, 0.1, 0.24, 0, 'lamp');
  for (let z = -14; z <= 14; z += 4) {
    k.rod('accent', -5.1, 6, z, 0, 7.4, z, 0.1); k.rod('accent', 0, 7.4, z, 5.1, 6, z, 0.1);
    k.rod('trim', -5.1, 6, z, 5.1, 6, z, 0.08);
    for (const x of [-2.5, 0, 2.5]) k.rod('trim', x, 6, z, x, 7.4 - Math.abs(x) * 0.27, z, 0.035);
  }
  for (const z of [-12, 12]) {
    // 接触网跨越轨道，立柱位于既有边界外。
    for (const x of [-48, 48]) { box(x, 5, z, 0.3, 10, 0.35, 0, 'trim'); k.rod('steel', x, 9, z - 3, x, 9, z + 3, 0.09); }
    k.rod('steel', -48, 8.8, z, 48, 8.8, z, 0.025);
    k.rod('steel', -48, 10, z, 48, 10, z, 0.025);
    for (let x = -40; x <= 40; x += 8) k.rod('steel', x, 8.8, z, x, 10, z, 0.014);
  }
  pair(k.crate, -5, -22, 3.2, 2.3, 2.6, 1);
  pair(k.crate, -26, -3, 2.6, 1.1, 2.6, 0);
  pair(block, -36, -19, 4, 3, 2.7, 'trim');
  pair(block, -10, -1, 3, 2.4, 2.3, 'accent');
  pair(block, -25, -22, 6, 5, 3.8, 'roof');
  pair(block, -1.5, -21, 4, 4, 3.2, 'accent');
  pair(block, 0, -7, 2.4, 5, 3.2, 'trim');
  pair(block, -32, -8, 2, 6, 3.5, 'wall');
  for (const s of [-1, 1]) {
    block(s * 37, s * 22, 0.4, 0.4, 8, 'trim');
    box(s * 37, 7, s * 22, 0.7, 1.6, 0.5, 0, 'black');
    k.geom('redLamp', k.prims.sph, s * 37, 7.4, s * 22 - 0.3, 0, 0, 0, 0.2, 0.2, 0.2);
    k.geom('greenLamp', k.prims.sph, s * 37, 6.8, s * 22 - 0.3, 0, 0, 0, 0.2, 0.2, 0.2);
  }
  return finish();
}
export const depotMap = defineArena({ id: 'depot', name: '货运车站', desc: '普通 · 错列货车、站台雨棚与维修库，穿插包抄', w: 88, d: 56, palette, label: 'FREIGHT / 04', build,
  pve: { spawns: [{ x: 39, z: 0 }, { x: 36, z: -10 }, { x: 36, z: 17 }, { x: 24, z: 5 }, { x: 6, z: 24 }],
    supplies: [{ x: -39, z: -12, kind: 'med' }, { x: 39, z: 12, kind: 'med' }, { x: -14, z: -23, kind: 'ammo' }, { x: 14, z: 23, kind: 'ammo' }, { x: -2, z: 8, kind: 'armor' }, { x: 2, z: -8, kind: 'armor' }] } });
