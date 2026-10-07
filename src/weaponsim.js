// 武器状态机（纯逻辑，无 three / DOM）：单机 Actor、联机客户端预测、权威服务端共用
// a: {inv, slot, lastSlot, readyAt, scoped, scopeReady, scopeT, reScope, pendingThrow, autoSwitchAt, punchP, punchY, aimPunch, speed, onGround, crouch, stats, protectT, isPlayer, recoilControl}
// inp: {fire, firePressed, alt, altPressed, reload, sw}
// H: 事件钩子 {fire(a,w,spread,rnd), melee(a,heavy), throwNade(a), switched(a,w), reloadStart(a,empty), reloadDone(a), scope(a), dryFire(a), nadeStart(a)}
import { currentSpread, recoilKick, WeaponState } from './weapons.js';
import { shotRng } from './protocol.js';

// 联机用确定性出生装备：后坐摆动相位由种子决定，客户端预测与服务端一致
// melee：近战槽（2）用哪把——普通玩家 'knife'，附身 BOSS 换成专属 'bossclaw'
export function makeLoadout(primary, seed, melee = 'knife') {
  const inv = [new WeaponState(primary), new WeaponState('deagle'), new WeaponState(melee), new WeaponState('he')];
  inv.forEach((w, i) => { w.patternSeed = shotRng(seed, 100000 + i)() * 6; });
  return inv;
}

export function startReload(a, now, H) {
  const w = a.inv[a.slot];
  if (!w || !w.canReload()) return;
  w.reloadUntil = now + w.def.reload;
  a.scoped = 0; a.scopeReady = false; a.reScope = 0;
  H.reloadStart?.(a, w.mag === 0);
}

export function weaponStep(a, dt, inp, now, H, rnd) {
  // 切枪
  if (inp.sw !== undefined && inp.sw !== null && inp.sw !== a.slot && a.inv[inp.sw]) {
    const tgt = a.inv[inp.sw];
    if (!(tgt.def.type === 'grenade' && tgt.mag <= 0)) {
      a.inv[a.slot].reloadUntil = 0;
      a.lastSlot = a.slot; a.slot = inp.sw;
      a.readyAt = now + tgt.def.draw;
      a.scoped = 0; a.scopeReady = false;
      H.switched?.(a, tgt);
    }
  }
  const w = a.inv[a.slot], d = w.def;
  // 散布恢复
  if (d.spread) {
    if (now - w.lastShot > 60 / d.rpm * 1.2) w.spreadAcc *= Math.exp(-d.spread.recover * dt);
    if (now - w.lastShot > 0.28) w.shotsFired = 0;
  }
  // 后坐恢复
  if (d.recoil && now - w.lastShot > 60 / d.rpm + 0.05) {
    const k = Math.exp(-d.recoil.recover * dt);
    a.punchP *= k; a.punchY *= k;
  }
  a.aimPunch = (a.aimPunch || 0) * Math.exp(-dt * 10);
  // 换弹完成
  if (w.reloading && now >= w.reloadUntil) { w.finishReload(); H.reloadDone?.(a); }
  // 狙击镜
  if (d.type === 'sniper') {
    if (inp.altPressed && now >= a.readyAt && !w.reloading && now >= w.boltUntil) {
      a.scoped = (a.scoped + 1) % 3; a.scopeT = now; a.scopeReady = false;
      H.scope?.(a);
    }
    if (a.scoped && now - a.scopeT > 0.18) a.scopeReady = true;
    if (a.reScope && now >= w.boltUntil && !w.reloading) { a.scoped = a.reScope; a.reScope = 0; a.scopeT = now; a.scopeReady = false; H.scope?.(a); }
  }
  if (now < a.readyAt) return;
  // 换弹
  if (inp.reload && w.canReload()) startReload(a, now, H);
  if (w.reloading) return;
  if (d.type === 'melee') {
    if (now >= w.nextFire) {
      if (inp.fire) { w.nextFire = now + d.rateLight; H.melee?.(a, false); }
      else if (inp.alt) { w.nextFire = now + d.rateHeavy; H.melee?.(a, true); }
    }
    return;
  }
  if (d.type === 'grenade') {
    if (a.pendingThrow > 0) {
      a.pendingThrow -= dt;
      if (a.pendingThrow <= 0) {
        H.throwNade?.(a);
        w.mag = 0;
        a.readyAt = now + 0.4;
        a.autoSwitchAt = now + 0.45;
      }
      return;
    }
    if (a.autoSwitchAt && now >= a.autoSwitchAt) {
      a.autoSwitchAt = 0;
      const back = a.inv[a.lastSlot] && a.lastSlot !== 3 ? a.lastSlot : 0;
      weaponStep(a, 0, { sw: back }, now, H, rnd);
      return;
    }
    if (inp.firePressed && w.mag > 0) { a.pendingThrow = 0.52; H.nadeStart?.(a); }
    return;
  }
  // 枪械
  const trigger = d.auto ? inp.fire : inp.firePressed;
  if (!trigger || now < w.nextFire || now < w.boltUntil) return;
  if (w.mag <= 0) {
    if (inp.firePressed) H.dryFire?.(a);
    if (w.canReload()) startReload(a, now, H);
    return;
  }
  w.mag--; w.lastShot = now; w.nextFire = now + 60 / d.rpm;
  a.stats.shots++;
  // 联机时每发子弹使用 (种子, 发序号) 生成的确定性随机数
  if (a.shotSeed !== undefined) rnd = shotRng(a.shotSeed, a.shotN++);
  const spread = currentSpread(w, { speed: a.speed || 0, onGround: a.onGround, crouch: a.crouch, scoped: a.scoped > 0, scopeReady: a.scopeReady });
  H.fire?.(a, w, spread, rnd);
  // 后坐
  const [up, side] = recoilKick(w, rnd);
  const ctl = a.recoilControl ?? 1;
  a.punchP = Math.min(d.recoil.upMax, a.punchP + up * ctl);
  a.punchY += side * ctl;
  w.shotsFired++;
  if (d.spread) w.spreadAcc = Math.min(d.spread.max, w.spreadAcc + d.spread.perShot);
  a.protectT = 0;
  if (d.type === 'sniper') {
    w.boltUntil = now + d.bolt;
    if (a.scoped) { a.reScope = a.scoped; a.scoped = 0; a.scopeReady = false; }
  }
  if (w.mag === 0 && w.canReload() && !a.isPlayer) startReload(a, now, H);
}
