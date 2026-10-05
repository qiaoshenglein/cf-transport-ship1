// 角色基类：移动物理 + 武器状态机（玩家与机器人共用）
import * as THREE from 'three';
import { WeaponState } from './weapons.js';
import { weaponStep, startReload } from './weaponsim.js';
import { Soldier } from './character.js';
import { moveStep, STAND_H, CROUCH_H, EYE_STAND, EYE_CROUCH } from './movement.js';

export { STAND_H, CROUCH_H, EYE_STAND, EYE_CROUCH };

export class Actor {
  constructor(game, { id, name, team, isPlayer = false }) {
    this.game = game; this.id = id; this.name = name; this.team = team; this.isPlayer = isPlayer;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.radius = 0.36; this.height = STAND_H; this.stepHeight = 0.42;
    this.onGround = false; this.crouch = false; this.eyeH = EYE_STAND;
    this.yaw = 0; this.pitch = 0; this.punchP = 0; this.punchY = 0; this.aimPunch = 0;
    this.hp = 100; this.armor = 100; this.alive = false; this.deadT = 0; this.respawnT = 0; this.protectT = 0;
    this.inv = []; this.slot = 0; this.lastSlot = 1; this.readyAt = 0;
    this.stats = { k: 0, d: 0, hs: 0, shots: 0, hits: 0 };
    this.streak = 0; this.lastKillT = -99; this.multi = 0;
    this.radarT = 0; this.ping = 20 + ((Math.random() * 40) | 0);
    this.primary = 'ak47';
    this.soldier = new Soldier(team);
    game.renderer.scene.add(this.soldier.root);
    this.stepDist = 0; this.scoped = 0; this.scopeReady = false; this.scopeT = 0;
    this.lastHurt = -99; this.lastAttacker = null;
    this.walk = false;
    this.pendingThrow = 0;
  }
  get weapon() { return this.inv[this.slot]; }
  eye(out) { return out.set(this.pos.x, this.pos.y + this.eyeH, this.pos.z); }
  forward(out) {
    const p = this.pitch + this.punchP, y = this.yaw + this.punchY;
    return out.set(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  }
  giveLoadout(primary) {
    this.primary = primary || this.primary;
    this.inv = [new WeaponState(this.primary), new WeaponState('deagle'), new WeaponState('knife'), new WeaponState('he')];
    for (const w of this.inv) w.patternSeed = Math.random() * 6;
    this.slot = 0; this.lastSlot = 1;
    this.readyAt = this.game.time + 0.3;
    this.soldier.setWeapon(this.primary);
  }
  spawn(sp) {
    this.pos.set(sp.x, 0.02, sp.z); this.vel.set(0, 0, 0);
    this.yaw = sp.yaw; this.pitch = 0; this.punchP = this.punchY = 0;
    this.hp = 100; this.armor = 100; this.alive = true; this.deadT = 0;
    this.crouch = false; this.height = STAND_H; this.eyeH = EYE_STAND;
    this.protectT = 3; this.onGround = true;
    this.giveLoadout(this.nextPrimary || this.primary);
    this.soldier.reset();
    this.soldier.root.position.copy(this.pos);
    this.soldier.root.visible = !this.isPlayer;
    this.scoped = 0; this.scopeReady = false;
    this.streak = 0;
  }
  // wish: 世界坐标系下的期望移动方向（长度 0..1）
  move(dt, wishX, wishZ, jump, crouch, walk) {
    const g = this.game;
    const w = this.weapon;
    const ev = moveStep(this, dt, { wx: wishX, wz: wishZ, jump, crouch, walk, speedMul: w ? w.def.speed : 1 }, g.world, g.actors);
    if (ev.jumped) g.onJump(this);
    if (ev.landed && ev.landSpeed > 3) g.onLand(this, ev.landSpeed);
    // 脚步
    const hs = ev.speed;
    if (this.onGround && hs > 2.6 && !walk && !this.crouch) {
      this.stepDist += hs * dt;
      if (this.stepDist > 2.3) { this.stepDist = 0; g.onFootstep(this); }
    }
  }
  // 武器逻辑。inp: {fire, firePressed, alt, altPressed, reload, sw}
  // 武器逻辑（状态机在 weaponsim.js，与服务端共用）。inp: {fire, firePressed, alt, altPressed, reload, sw}
  weaponUpdate(dt, inp) {
    weaponStep(this, dt, inp, this.game.time, this.hooks(), Math.random);
  }
  startReload() { startReload(this, this.game.time, this.hooks()); }
  hooks() {
    if (this._H) return this._H;
    const g = this.game;
    return (this._H = {
      fire: (a, w, spread) => g.fireWeapon(a, w, spread),
      melee: (a, heavy) => g.melee(a, heavy),
      throwNade: (a) => g.throwGrenade(a),
      switched: (a, w) => { a.soldier.setWeapon(w.id); g.onSwitch(a); },
      reloadStart: (a, empty) => g.onReloadStart(a, empty),
      reloadDone: (a) => g.onReloadDone(a),
      scope: (a) => g.onScope(a),
      dryFire: (a) => g.onDryFire(a),
      nadeStart: (a) => g.onGrenadeStart(a),
    });
  }
}