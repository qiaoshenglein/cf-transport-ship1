// 合批场景美术：细节放在既有碰撞体表面、屋顶或战斗区之外。
// 可行走路线不靠装饰网格定义；少量动态风扇独立绘制，离图统一回收。
import * as THREE from 'three';

export function createMapArt(k, scene, T, world, opts, { id, w, d }) {
  const { box, geom, rod, prims } = k;
  const ownedTextures = [], animated = [];
  k.def('paint', k.std({ ...T[id + 'Metal'], roughness: 0.85, metalness: 0.35 }), 3);
  k.def('hazard', k.std({ ...T[id + 'Hazard'], roughness: 0.8 }), 'unit');
  k.def('detail', k.std({ ...T[id + 'Detail'], roughness: 0.75, emissive: id === 'turbine' ? 0x1b4b43 : 0x000000, emissiveIntensity: 0.35 }), 'unit');
  k.def('rug', k.std({ ...T[id + 'Rug'], roughness: 1 }), 'unit');
  for (const [key, color] of [['ivory', 0xc6b48b], ['wood', 0x674730], ['rust', 0x714334], ['canvasRed', 0x93473a], ['canvasGold', 0xc5a16c], ['foliage', 0x486345], ['rubber', 0x262b29]]) k.plain(key, color, { rough: 0.9 });
  k.emissive('warmLight', 0xffc47b, 1.6); k.emissive('coolLight', 0x7ed7de, 1.3);

  const plate = (key, x, y, z, width, height, yaw = 0) => box(x, y, z, width, height, 0.025, yaw, key);
  const vent = (x, y, z, width, height, yaw = 0) => {
    box(x, y, z, width, height, 0.08, yaw, 'trim');
    for (let row = -height / 2 + 0.12; row < height / 2; row += 0.16) box(x, y + row, z, width * 0.88, 0.035, 0.14, yaw, 'steel');
  };
  const lantern = (x, y, z) => {
    rod('wood', x, y + 0.8, z, x, y + 0.35, z, 0.025);
    geom('warmLight', prims.cyl8, x, y, z, 0, 0, 0, 0.17, 0.5, 0.17);
    for (const dy of [-0.29, 0.29]) geom('wood', prims.cone, x, y + dy, z, dy < 0 ? Math.PI : 0, 0, 0, 0.24, 0.18, 0.24);
    for (let a = 0; a < 6; a++) { const t = a * Math.PI / 3; rod('wood', x + Math.cos(t) * 0.17, y - 0.25, z + Math.sin(t) * 0.17, x + Math.cos(t) * 0.17, y + 0.25, z + Math.sin(t) * 0.17, 0.015); }
  };
  // 四片弯叶是一张网格，角速度按时间计算而不累积漂移。
  const rotorGeometry = () => {
    const p = [], n = [];
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5, vertices = [[0.15, a], [0.92, a + 0.18], [1, a + 0.49], [0.28, a + 0.63]];
      for (const j of [0, 1, 2, 0, 2, 3]) { const [r, t] = vertices[j]; p.push(r * Math.cos(t), r * Math.sin(t), 0); n.push(0, 0, 1); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3)); return g;
  };
  let fanGeometry = null, fanMaterial = null;
  const fan = (x, y, z, radius = 1, horizontal = true, phase = 0) => {
    const ring = new THREE.TorusGeometry(radius, 0.08, 6, 24);
    geom('trim', ring, x, y, z, horizontal ? Math.PI / 2 : 0); ring.dispose();
    geom('steel', prims.sph, x, y, z, 0, 0, 0, 0.16, 0.16, 0.16);
    if (opts.headless) return;
    if (!fanGeometry) fanGeometry = rotorGeometry();
    if (!fanMaterial) fanMaterial = k.def('fanBlades', k.std({ color: 0x6e8c91, metalness: 0.65, roughness: 0.45, side: THREE.DoubleSide }));
    const pivot = new THREE.Group(); pivot.position.set(x, y, z); pivot.rotation.x = horizontal ? -Math.PI / 2 : 0;
    const mesh = new THREE.Mesh(fanGeometry, fanMaterial); mesh.scale.setScalar(radius * 0.93); pivot.add(mesh); scene.add(pivot);
    animated.push({ pivot, mesh, phase });
    k.anim.push((dt, t) => { mesh.rotation.z = phase + t * 0.9; });
  };

  const building = (x, z, sx, sz, h, doors) => {
    const market = id === 'bazaar';
    for (let side = 0; side < 4; side++) {
      const alongZ = side < 2, s = side % 2 ? -1 : 1, L = alongZ ? sz : sx;
      const fx = alongZ ? x + s * (sx / 2 + 0.29) : x, fz = alongZ ? z : z + s * (sz / 2 + 0.29);
      const panel = (key, u, y, length, height, thick = 0.05) => box(fx + (alongZ ? 0 : u), y, fz + (alongZ ? u : 0), alongZ ? thick : length, height, alongZ ? length : thick, 0, key);
      const door = doors.includes(side), len = door ? (L - 4.8) / 2 : L;
      for (const u of door ? [-(L + 4.8) / 4, (L + 4.8) / 4] : [0]) {
        panel(market ? 'ivory' : 'paint', u, 0.55, len, 1.1, 0.09);
        panel('trim', u, 1.13, len, 0.08, 0.13);
      }
      for (let u = -L / 2 + 0.5; u < L / 2; u += market ? 3.2 : 4) {
        if (!door || Math.abs(u) >= 2.65) panel(market ? 'ivory' : 'paint', u, h / 2, market ? 0.22 : 0.16, h, 0.15);
        if (Math.abs(u) > 3 || !door) {
          panel('trim', u + 0.6, h - 1.2, 1.65, 1.5, 0.09);
          panel('glass', u + 0.6, h - 1.2, 1.45, 1.24, 0.11);
          panel(market ? 'wood' : 'steel', u + 0.6, h - 1.2, 0.07, 1.3, 0.16);
          panel(market ? 'wood' : 'steel', u + 0.6, h - 1.2, 1.5, 0.07, 0.16);
          if (market) for (const du of [-0.9, 0.9]) panel('paint', u + 0.6 + du, h - 1.2, 0.25, 1.4, 0.13);
        }
      }
      if (door) {
        for (const u of [-2.52, 2.52]) panel(market ? 'ivory' : 'paint', u, 2.15, 0.2, 4.3, 0.18);
        panel(market ? 'wood' : 'hazard', 0, 4.42, 5.1, 0.23, 0.18);
        panel('warmLight', 0, 4.85, 2.2, 0.07, 0.3);
        if (market) {
          const wx = fx + (alongZ ? s * 0.8 : 0), wz = fz + (alongZ ? 0 : s * 0.8);
          box(wx, 4.65, wz, alongZ ? 1.7 : 5.8, 0.12, alongZ ? 5.8 : 1.7, 0, 'canvasRed');
          for (let u = -2.6; u <= 2.6; u += 0.65) box(wx + (alongZ ? 0 : u), 4.72, wz + (alongZ ? u : 0), alongZ ? 1.7 : 0.3, 0.025, alongZ ? 0.3 : 1.7, 0, 'canvasGold');
          lantern(fx + (alongZ ? s * 0.5 : -2.9), 3.7, fz + (alongZ ? -2.9 : s * 0.5));
        }
      }
      panel(market ? 'ivory' : 'trim', 0, h + 0.13, L + 0.6, 0.22, 0.6);
    }
    if (market) {
      // 露台护墙和金属格栅；非战斗屋顶上的圆顶更容易从街巷辨认方向。
      for (const dz of [-sz / 2 + 0.3, sz / 2 - 0.3]) {
        box(x, h + 0.68, z + dz, sx, 0.65, 0.25, 0, 'wall');
        for (let dx = -sx / 2; dx <= sx / 2; dx += 1.1) box(x + dx, h + 1.1, z + dz, 0.35, 0.4, 0.4, 0, 'ivory');
      }
      if (x * z < 0) {
        geom('paint', prims.sph, x, h + 0.5, z, 0, 0, 0, 2.4, 2.5, 2.4);
        geom('ivory', prims.cyl, x, h + 0.45, z, 0, 0, 0, 2.5, 0.4, 2.5);
        rod('accent', x, h + 2.8, z, x, h + 3.5, z, 0.05);
      }
      // 店铺内铺陈地毯，贴地不会改变脚步高度。
      box(x, 0.025, z, 5, 0.012, 3, 0, 'rug');
    } else {
      // 真正的双坡屋顶与长条采光窗，取代纯平盒盖。
      const rise = id === 'harbor' ? 2.4 : 1.4, slope = Math.atan2(rise, sx / 2);
      const g = new THREE.BoxGeometry(1, 1, 1);
      for (const s of [-1, 1]) {
        geom('roof', g, x + s * sx / 4, h + 0.45 + rise / 2, z, 0, 0, -s * slope, Math.hypot(sx / 2, rise) + 0.6, 0.18, sz + 0.9);
        geom('glass', g, x + s * sx / 4, h + 0.58 + rise / 2, z, 0, 0, -s * slope, 1.3, 0.06, sz * 0.64);
      }
      g.dispose();
      rod('steel', x, h + rise + 0.55, z - sz / 2 - 0.4, x, h + rise + 0.55, z + sz / 2 + 0.4, 0.12);
      for (const dx of [-sx / 2 + 1, sx / 2 - 1]) {
        rod('rust', x + dx, h, z + sz / 2 + 0.32, x + dx, 0.15, z + sz / 2 + 0.32, 0.07);
        box(x + dx, h - 0.4, z, 0.15, 0.15, sz, 0, 'steel');
      }
      fan(x - sx / 4, h + rise + 0.8, z, 0.9, true, x);
    }
    // 墙根的通风格与电箱均贴在完整墙段上。
    vent(x - sx / 2 + 1.3, 2.5, z + sz / 2 + 0.31, 1.4, 0.8);
  };

  const cover = (x, z, sx, sz, h, key) => {
    if (sx < 1.5 || sz < 1.5 || h < 2 || h > 4.2 || sx > 18 || sz > 18 || key === 'wall') return;
    const alongZ = sz > sx, L = alongZ ? sz : sx;
    for (const s of [-1, 1]) {
      const fx = x + (alongZ ? s * (sx / 2 + 0.015) : 0), fz = z + (alongZ ? 0 : s * (sz / 2 + 0.015));
      const yaw = alongZ ? Math.PI / 2 : 0;
      plate('paint', fx, h / 2, fz, L - 0.15, h - 0.1, yaw);
      plate('hazard', fx + (alongZ ? s * 0.02 : 0), 0.32, fz + (alongZ ? 0 : s * 0.02), L - 0.2, 0.28, yaw);
      for (let u = -L / 2 + 0.4; u <= L / 2 - 0.3; u += 1.6) {
        const px = fx + (alongZ ? 0 : u), pz = fz + (alongZ ? u : 0);
        box(px, h / 2, pz, alongZ ? 0.1 : 0.1, h - 0.18, 0.1, 0, 'trim');
      }
      plate('detail', fx + (alongZ ? s * 0.04 : 0), h * 0.65, fz + (alongZ ? 0 : s * 0.04), Math.min(L * 0.45, 1.5), 0.65, yaw);
    }
  };

  const wagon = (x, z) => {
    for (const s of [-1, 1]) {
      const zz = z + s * 1.91;
      plate('paint', x, 2.05, zz, 15.8, 2.8);
      for (let dx = -7.4; dx <= 7.4; dx += 0.47) box(x + dx, 2.05, zz + s * 0.04, 0.045, 2.7, 0.08, 0, 'trim');
      plate('detail', x - 4, 2.5, zz + s * 0.1, 2.6, 1.1);
      box(x, 2.1, zz + s * 0.12, 3.2, 2.9, 0.13, 0, 'roof');
      for (const dx of [-1.35, 1.35]) rod('steel', x + dx, 0.9, zz + s * 0.23, x + dx, 3.3, zz + s * 0.23, 0.04);
      for (const dx of [-6, 6]) {
        box(x + dx, 0.47, zz, 2.8, 0.45, 0.32, 0, 'trim');
        for (const dw of [-0.7, 0.7]) {
          geom('rubber', prims.cyl, x + dx + dw, 0.43, zz + s * 0.1, Math.PI / 2, 0, 0, 0.43, 0.22, 0.43);
          geom('steel', prims.cyl8, x + dx + dw, 0.43, zz + s * 0.24, Math.PI / 2, 0, 0, 0.2, 0.08, 0.2);
        }
      }
      plate('hazard', x + 6, 0.9, zz + s * 0.14, 2.1, 0.22);
    }
    for (const dx of [-8.3, 8.3]) {
      for (const dz of [-1, 1]) geom('rubber', prims.cyl8, x + dx, 0.85, z + dz, 0, 0, Math.PI / 2, 0.28, 0.5, 0.28);
    }
  };

  const stall = (x, z) => {
    for (let dx = -2.3; dx < 2.4; dx += 0.58) {
      box(x + dx, 3.4, z, 0.28, 0.035, 3.3, 0, 'canvasRed');
      for (const dz of [-1.65, 1.65]) geom('canvasRed', prims.sph, x + dx, 3.28, z + dz, 0, 0, 0, 0.29, 0.22, 0.05);
    }
    for (const dz of [-1.23, 1.23]) {
      plate('wood', x, 0.65, z + dz, 4.5, 1);
      for (let dx = -2; dx < 2.1; dx += 0.4) box(x + dx, 0.65, z + dz, 0.03, 1.03, 0.08, 0, 'ivory');
    }
    for (const dx of [-1.3, 0, 1.3]) {
      box(x + dx, 1.23, z, 1, 0.16, 1.5, 0, 'wood');
      for (let i = 0; i < 9; i++) geom(dx < 0 ? 'canvasRed' : dx > 0 ? 'foliage' : 'accent', prims.sph, x + dx - 0.3 + i % 3 * 0.3, 1.4, z - 0.4 + Math.floor(i / 3) * 0.4, 0, 0, 0, 0.15, 0.14, 0.15);
    }
    lantern(x, 2.65, z + 1.3);
  };
  const tank = (x, z, r, h) => {
    for (const yy of [0.5, h / 2, h - 0.4]) {
      const g = new THREE.TorusGeometry(r * 1.015, 0.045, 6, 24); geom('steel', g, x, yy, z, Math.PI / 2); g.dispose();
    }
    plate('hazard', x, 0.55, z + r + 0.02, r * 1.4, 0.3);
    plate('detail', x, h * 0.61, z + r + 0.03, Math.min(1.5, r), 0.75);
    for (const dx of [-r * 0.35, r * 0.35]) rod('steel', x + dx, h * 0.55, z - r * 0.95, x + dx, h + 0.4, z - r * 0.95, 0.035);
    for (let yy = h * 0.55; yy < h + 0.4; yy += 0.3) rod('steel', x - r * 0.35, yy, z - r * 0.95, x + r * 0.35, yy, z - r * 0.95, 0.025);
    if (id === 'turbine') {
      // 带可见叶轮的机组顶盖：动画不影响碰撞或枪线。
      fan(x, h + 0.35, z, r * 0.8, true, x);
      for (const s of [-1, 1]) rod('paint', x + s * r * 0.7, h + 0.15, z, x + s * r * 0.7, h + 1.1, z, 0.12);
      rod('paint', x - r * 0.7, h + 1.1, z, x + r * 0.7, h + 1.1, z, 0.12);
    }
  };

  const skyline = () => {
    if (id === 'turbine' || id === 'harbor') return;
    for (const s of [-1, 1]) for (let i = 0; i < 7; i++) {
      const x = -w / 2 + 5 + i * 13, z = s * (d / 2 + 14 + i % 3 * 4), hh = 8 + (i * 7 % 12);
      box(x, hh / 2 - 1, z, 10, hh, 9, 0, 'wall');
      box(x, hh - 0.8, z, 10.5, 0.4, 9.5, 0, 'ivory');
      for (let y = 2; y < hh - 2; y += 2.8) for (const dx of [-3, 0, 3]) plate('glass', x + dx, y, z - s * 4.52, 1.25, 1.7);
      if (id === 'bazaar') {
        if (i % 3 === 0) { geom('paint', prims.sph, x, hh, z, 0, 0, 0, 3, 2.8, 3); rod('accent', x, hh + 2, z, x, hh + 4, z, 0.06); }
        for (const dx of [-4.5, 4.5]) box(x + dx, hh + 0.1, z, 0.4, 1.6, 9, 0, 'ivory');
      } else {
        box(x, hh + 0.1, z, 10.8, 0.5, 9.8, 0, 'roof');
        if (i % 2 === 0) {
          geom('rust', prims.cyl, x, hh + 4, z, 0, 0, 0, 0.7, 8, 0.7);
          for (let y = hh; y < hh + 8; y += 2) geom('trim', prims.cyl, x, y, z, 0, 0, 0, 0.8, 0.15, 0.8);
        }
      }
    }
    if (id === 'bazaar') for (const s of [-1, 1]) {
      const x = s * 47, z = s * 37;
      geom('wall', prims.cyl8, x, 12, z, 0, 0, 0, 2.3, 24, 2.3);
      for (const y of [8, 17, 22]) geom('ivory', prims.cyl, x, y, z, 0, 0, 0, 2.8, 0.5, 2.8);
      geom('paint', prims.cone, x, 26, z, 0, 0, 0, 2.8, 4, 2.8);
    }
  };

  const contactShadows = () => {
    if (opts.headless) return;
    const scale = Math.min(8, 1536 / Math.max(w, d)), c = document.createElement('canvas');
    c.width = Math.ceil(w * scale); c.height = Math.ceil(d * scale);
    const ctx = c.getContext('2d');
    // 所有静态接地阴影放在一张透明图中：低画质关闭实时阴影时仍有接地感。
    for (const col of world.colliders) {
      if (!col.solid || col.tag === 'deck' || col.bottom > 0.12 || col.top < 0.5) continue;
      ctx.save(); ctx.translate((col.x + w / 2) * scale, (col.z + d / 2) * scale); ctx.rotate(-col.yaw);
      ctx.shadowColor = 'rgba(5,12,15,0.6)'; ctx.shadowBlur = scale * 0.6;
      ctx.fillStyle = 'rgba(5,12,15,0.3)'; ctx.fillRect(-col.hx * scale, -col.hz * scale, col.hx * scale * 2, col.hz * scale * 2); ctx.restore();
    }
    const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; ownedTextures.push(map);
    const mat = k.def('contactShadow', new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.72, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.075; mesh.renderOrder = 1; mesh.name = 'contact-shadows'; scene.add(mesh);
  };
  const finish = () => {
    contactShadows();
    return { texs: ownedTextures, artAnimations: animated,
      extraDispose() { for (const { pivot } of animated) pivot.removeFromParent(); fanGeometry?.dispose(); } };
  };
  return { building, cover, wagon, stall, tank, skyline, fan, plate, vent, lantern, finish };
}
