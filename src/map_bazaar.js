import * as THREE from 'three';
import { createArena, defineArena } from './map_tactical.js';

const palette = { wall: 0xd8b982, ground: 0xb3a489, roof: 0xa66344, trim: 0x365b60, accent: 0xd79b48 };
function build(scene, T, world, opts = {}) {
  const { k, box, block, pair, building, sign, art, finish } = createArena(scene, T, world, opts, { id: 'bazaar', w: 88, d: 52, palette });
  // 四个店铺形成双院落，轴线是转角街，外侧是连通侧巷。
  for (const x of [-19, 19]) for (const z of [-11, 11]) {
    building(x, z, 14, 12, 7, [0, 1, z < 0 ? 2 : 3]);
    sign(x, z + (z < 0 ? 6.3 : -6.3), 5.2);
    for (const dx of [-4.5, 4.5]) k.crate(x + dx, z, 1.6, 1.1, 2, 1);
    // 陶瓦房檐：沿每段屋檐排布瓦筒。
    for (let dx = -7; dx <= 7; dx += 0.7) for (const dz of [-6.3, 6.3])
      k.geom('roof', k.prims.cyl8, x + dx, 7.4, z + dz, Math.PI / 2, 0, 0, 0.22, 1.3, 0.22);
  }
  // 双拱门：弧形石块有真实碰撞，最低处保持 4.5 米净高。
  for (const x of [-9, 9]) {
    block(x, -4.2, 1.2, 1.2, 5, 'wall'); block(x, 4.2, 1.2, 1.2, 5, 'wall');
    for (let i = 0; i < 11; i++) {
      const a = i / 10 * Math.PI, z = Math.cos(a) * 4.2, y = 4.6 + Math.sin(a) * 2;
      k.solid(x, y + 0.325, z, 1.2, 0.65, 0.9, 0, { mat: 'concrete' });
    }
    const arch = new THREE.TorusGeometry(1, 0.13, 8, 32, Math.PI);
    k.geom('ivory', arch, x, 4.8, 0, 0, Math.PI / 2, 0, 4.2, 2.2, 3.5); arch.dispose();
    for (const dz of [-4.2, 4.2]) for (const y of [0.3, 4.5]) box(x, y, dz, 1.4, 0.35, 1.4, 0, 'ivory');
  }
  // 布棚、货架和陶罐沿侧巷布置；柜台供蹲姿换位。
  const stall = (x, z) => {
    block(x, z, 4.5, 2.4, 1.15, 'trim');
    box(x, 3.3, z, 5, 0.16, 3.3, 0, 'accent');
    for (const dx of [-2.2, 2.2]) for (const dz of [-1.1, 1.1]) block(x + dx, z + dz, 0.12, 0.12, 3.3, 'trim');
    for (let dx = -1.4; dx < 1.5; dx += 0.7) k.geom('roof', k.prims.sph, x + dx, 1.5, z, 0, 0, 0, 0.25, 0.4, 0.25);
    art.stall(x, z);
  };
  pair(stall, -7, -21); pair(stall, -31, 16);
  pair(block, -4, -2.5, 4, 2.5, 2.6, 'wall');
  pair(k.crate, -29, -8, 2.4, 2.1, 2.4, 0);
  pair(block, -18, -22.8, 8, 1, 2.7, 'wall');
  pair(block, -1.5, -18, 5, 2, 3.1, 'wall');
  // 掩体花池和棕榈：树干碰撞覆盖真实可见体积。
  for (const [x, z] of [[-5, 11], [5, -11]]) {
    block(x, z, 2.7, 2.7, 0.8, 'wall');
    block(x, z, 0.45, 0.45, 6, 'roof');
    for (let i = 0; i < 8; i++) k.geom('leaf', k.prims.sph, x + Math.cos(i * Math.PI / 4) * 1.2, 6, z + Math.sin(i * Math.PI / 4) * 1.2, 0, -i * Math.PI / 4, 0.2, 2, 0.15, 0.42);
  }
  for (const z of [-20, 0, 20]) {
    // 顶部彩旗与串灯把街巷连成一体，最低点仍在 7m 以上。
    for (let x = -30; x < 30; x += 3) {
      const y = 8.5 - Math.sin((x + 30) / 60 * Math.PI) * 0.8;
      const y1 = 8.5 - Math.sin((x + 33) / 60 * Math.PI) * 0.8;
      k.rod('wood', x, y, z, x + 3, y1, z, 0.018);
      const flag = new THREE.ConeGeometry(0.32, 0.65, 3);
      k.geom(x % 2 ? 'canvasRed' : 'canvasGold', flag, x + 1.5, y - 0.33, z, Math.PI, 0, 0, 1.5, 1, 0.08); flag.dispose();
      if (x % 9 === 0) art.lantern(x, y - 0.45, z);
    }
    // 嵌在铺石中的排水沟，不改变地形高度。
    box(0, 0.018, z, 78, 0.015, 0.18, 0, 'trim');
  }
  return finish();
}
export const bazaarMap = defineArena({ id: 'bazaar', name: '琥珀集市', desc: '普通 · 双院落、拱门街与布棚侧巷，转角绕后', w: 88, d: 52, palette, label: 'AMBER MARKET', build,
  pve: { spawns: [{ x: 39, z: 0 }, { x: 36, z: -18 }, { x: 36, z: 18 }, { x: 20, z: 0 }, { x: 4, z: 20 }],
    supplies: [{ x: -39, z: -12, kind: 'med' }, { x: 39, z: 12, kind: 'med' }, { x: -22, z: -20, kind: 'ammo' }, { x: 22, z: 20, kind: 'ammo' }, { x: -5, z: 6, kind: 'armor' }, { x: 5, z: -6, kind: 'armor' }] } });
