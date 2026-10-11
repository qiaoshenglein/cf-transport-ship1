// 外部 GLB 蒙皮模型（Tripo 生成的 BOSS）——只替换"看得见的那一层"
//
// 为什么可以放心换：服务端命中盒不读模型文件，它只吃 poseOf(a) 的 7 个量 + 19 骨 FK 前向运动学
// （src/hitbox.js、server/room.js 的 hitScaleOf）。所以这里加一个视觉体、把程序化 mesh 藏掉，判定完全不变；
// 唯一必须对齐的是**高度**：视觉高 = 程序化人体净高 × SIZE[kind].h，和命中盒用同一个数。
//
// Tripo 实测（2026-10-11 三只 BOSS）：0.80 / 0.98 / 0.95 m 高、65 骨 mixamorig 骨架、1 个材质 + 1024² 贴图、
// clip 名中英混杂（run / idle / 攻击 / fall / box_01），且各 clip 的骨盆 x/z 偏移不一致
// → 载入时以 idle 的骨盆偏移为基准把其它 clip 平移归零，否则 idle↔run 一切换整具身体横移半米多。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { SIZE } from './bosssize.js';

const FILES = { tyran: 'boss_tyran', mother: 'boss_mother', shade: 'boss_shade' };
// 语义动作 → 可接受的 clip 名片段（中英都列，Tripo 动画库两种命名都会出现）
const CLIP_WORDS = {
  idle: ['idle', 'stand', 'breath'],
  run: ['run', 'jog', 'sprint'],
  attack: ['attack', '攻击', 'melee', 'swing', 'slash'],
  skill: ['skill', 'box', 'punch', 'charge', 'slam', 'cast', 'special'],
  death: ['death', 'die', 'fall', 'dying', 'defeat'],
};
const ATTACK_T = 0.6, SKILL_T = 0.9, DEATH_T = 3.0;
const store = new Map();   // kind -> {pending,p} | {failed} | {ready,root,clips,height,maps}
let loader = null;

const nn = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
const has = (name, words) => words.some((w) => nn(name).includes(nn(w)));
// 注意：three r186 的 VectorKeyframeTrack 上没有 valueSize，只能按轨道名与数据长度判
const hipsTrack = (c) => c.tracks.find((t) => /\.position$/.test(t.name) && /hips/i.test(t.name) && t.values && t.values.length % 3 === 0);

// 以 idle 的骨盆 x/z 为基准，把其它 clip 整体平移（只平移，不改姿态形状）
function rebaseHips(clips) {
  const idle = clips.find((c) => /idle|stand|breath/.test(nn(c.name)));
  const ref = idle && hipsTrack(idle);
  if (!ref) return 0;
  const rx = ref.values[0], rz = ref.values[2];
  let n = 0;
  for (const c of clips) {
    const t = hipsTrack(c);
    if (!t) continue;
    const dx = rx - t.values[0], dz = rz - t.values[2];
    if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) continue;
    const v = Float32Array.from(t.values);
    for (let i = 0; i < v.length; i += 3) { v[i] += dx; v[i + 2] += dz; }
    t.values = v;
    n++;
  }
  return n;
}

export function loadBossModel(kind, onBytes) {
  if (store.has(kind)) {
    const e = store.get(kind);
    return e.p || Promise.resolve(e);
  }
  const file = FILES[kind];
  if (!file) return Promise.resolve(null);
  let settle;
  const p = new Promise((r) => { settle = r; });
  store.set(kind, { p });
  (async () => {
    try {
      const r = await fetch('/assets/models/' + file + '.glb');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = await readBody(r, onBytes);
      loader = loader || new GLTFLoader();
      const gltf = await new Promise((res, rej) => loader.parse(buf, '', res, rej));
      const root = gltf.scene || gltf.scenes[0];
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root), sz = new THREE.Vector3();
      box.getSize(sz);
      const clips = (gltf.animations || []).slice();
      const rebased = clips.length > 1 ? rebaseHips(clips) : 0;
      let bones = 0, srcMat = null;
      root.traverse((o) => {
        if (o.isBone) bones++;
        if (o.isMesh && !srcMat) srcMat = [].concat(o.material)[0] || null;
      });
      if (!srcMat) throw new Error('模型里没有网格');
      const maps = { map: srcMat.map, normalMap: srcMat.normalMap, roughnessMap: srcMat.roughnessMap, metalnessMap: srcMat.metalnessMap };
      const e = { ready: true, root, clips, maps, bones, height: sz.y || 1, minY: box.min.y, rebased };
      store.set(kind, e);
      settle(e);
    } catch (err) {
      const e = { failed: true, why: String((err && err.message) || err) };
      store.set(kind, e);
      settle(e);
    }
  })();
  return p;
}
// 流式读取：只有拿到逐字节数，进度条才不是"3 格跳一下"
async function readBody(res, onBytes) {
  const len = +res.headers.get('content-length') || 0;
  if (!res.body || !res.body.getReader) { const b = await res.arrayBuffer(); if (onBytes) onBytes(b.byteLength, len); return b; }
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (onBytes) onBytes(got, len);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}
export function preloadBossModels(onProg) {
  const keys = Object.keys(FILES);
  return (async () => {
    const sizes = {};
    let totalBytes = 0;
    for (const k of keys) {
      const e = store.get(k);
      if (e && (e.ready || e.failed)) continue;
      try {
        const r = await fetch('/assets/models/' + FILES[k] + '.glb', { method: 'HEAD' });
        if (r.ok) sizes[k] = +r.headers.get('content-length') || 0;
      } catch (err) { /* HEAD 不通就退回按文件数计进度 */ }
      totalBytes += sizes[k] || 0;
    }
    let doneBytes = 0, done = 0;
    const emit = (k, got) => {
      if (!onProg) return;
      const b = doneBytes + got;
      onProg({
        frac: totalBytes ? Math.min(1, b / totalBytes) : (done + (got ? 0.5 : 0)) / keys.length,
        done, n: keys.length, mb: b / 1048576, totMb: totalBytes / 1048576, name: k,
      });
    };
    const out = [];
    for (const k of keys) {
      emit(k, 0);
      const e = await loadBossModel(k, (got) => emit(k, got));
      out.push(e);
      doneBytes += sizes[k] || 0; done++;
      emit(k, 0);
    }
    return out;
  })();
}
export const bossModelReady = (kind) => !!(store.get(kind) || {}).ready;
export function bossModelInfo(kind) {
  const e = store.get(kind);
  if (!e || !e.ready) return null;
  const picked = {};
  for (const sem in CLIP_WORDS) { const c = e.clips.find((x) => has(x.name, CLIP_WORDS[sem])); if (c) picked[sem] = c.name; }
  return { height: e.height, bones: e.bones, clips: e.clips.map((c) => c.name), picked, rebased: e.rebased };
}

// 把 GLB 挂到某个 Soldier 上（程序化身体藏起来）。返回 false = 没有可用模型，调用方保留原外观。
export function attachBossModel(sol, kind, scaleMul) {
  const e = store.get(kind);
  if (!e || !e.ready || !sol || !sol.root || sol.glb) return false;
  const src = cloneSkinned(e.root);
  const mats = [];
  src.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
    o.material = new THREE.MeshStandardMaterial(Object.assign({ name: 'glb-' + kind, roughness: 0.75, metalness: 0.1 }, e.maps));
    mats.push(o.material);
    const si = o.geometry && o.geometry.attributes && o.geometry.attributes.skinIndex;
    // glTF 的 JOINTS_0 带 normalized 标记时 three 会把骨索引读成 0.0039 这种小数 → skeleton.bones[小数] 越界，整帧渲染崩
    if (si && si.normalized) si.normalized = false;
  });
  const box = new THREE.Box3().setFromObject(src), sz = new THREE.Vector3();
  box.getSize(sz);
  // 目标高 = 程序化人体净高（未缩放）× SIZE.h，与命中盒同源
  const g = sol.mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const humanH = g.boundingBox.max.y - g.boundingBox.min.y;
  const k = (humanH * SIZE[kind].h * (scaleMul || 1)) / (sz.y || 1);
  src.scale.setScalar(k);
  src.position.y = -box.min.y * k;                 // 脚底贴地
  // Tripo 出的模型脚尖朝 +Z，而本项目的约定是实体朝向 -Z（yaw=0 时 forward=(0,-1)）→ 不转就会倒着跑
  src.rotation.y = Math.PI;

  const mixer = new THREE.AnimationMixer(src);
  const act = {};
  for (const sem in CLIP_WORDS) {
    const c = e.clips.find((x) => has(x.name, CLIP_WORDS[sem]));
    if (!c) continue;
    act[sem] = mixer.clipAction(c);
    // r186 的 AnimationAction 没有 setClampWhenFinished()，clampWhenFinished 是普通属性
    if (sem !== 'idle' && sem !== 'run') { act[sem].setLoop(THREE.LoopOnce, 1); act[sem].clampWhenFinished = true; }
  }
  const st = { cur: null, atk: 0, skill: 0, death: false };
  const go = (sem, force) => {
    const a = act[sem];
    if (!a) return false;
    if (st.cur === sem && !force) return true;
    const prev = st.cur && act[st.cur];
    a.reset();
    if (sem === 'death' || sem === 'attack' || sem === 'skill') a.setLoop(THREE.LoopOnce, 1);
    else a.setLoop(THREE.LoopRepeat, Infinity);
    if (prev && prev !== a) a.crossFadeFrom(prev, 0.16, false); else a.fadeIn(0.1);
    a.play();
    st.cur = sem;
    return true;
  };
  const old = { frame: sol.onFrame, fade: sol.onFade, kick: sol.kick, reset: sol.reset };
  sol.root.add(src);
  sol.mesh.visible = false;
  const bodyMat = sol.material;
  const glb = { src, mixer, act, st, kind, k, go };
  sol.glb = glb;
  sol.onFrame = (dt, s) => {
    if (old.frame) old.frame(dt, s);
    // 受击闪光 / 死亡 Blink 都写在程序化材质上，逐帧同步到 GLB 材质
    for (const mm of mats) {
      mm.emissive.copy(bodyMat.emissive);
      mm.emissiveIntensity = bodyMat.emissiveIntensity;
      mm.transparent = bodyMat.transparent || bodyMat.opacity < 1;
      mm.opacity = bodyMat.opacity;
    }
    if (sol.deadT >= 0) { if (!st.death) { st.death = true; st.atk = 0; st.skill = 0; go('death', true); } }
    else if (st.death) { st.death = false; st.cur = null; }
    if (st.atk > 0) { st.atk -= dt; if (st.atk <= 0) st.cur = null; else if (act.attack) go('attack'); }
    else if (st.skill > 0) { st.skill -= dt; if (st.skill <= 0) st.cur = null; else if (act.skill) go('skill'); }
    else if (!st.death) {
      const sp = s && s.speed || 0;
      const want = sp > 0.3 && s.onGround ? 'run' : 'idle';
      if (go(want) && want === 'run') act.run.setEffectiveTimeScale(THREE.MathUtils.clamp(0.5 + sp * 0.12, 0.6, 1.8));
    }
    mixer.update(dt);
  };
  sol.kick = function () { if (old.kick) old.kick.call(this); st.atk = ATTACK_T; };
  sol.reset = function () { if (old.reset) old.reset.call(this); st.death = false; st.atk = 0; st.skill = 0; st.cur = null; };
  sol.onFade = (op) => { if (old.fade) old.fade(op); for (const mm of mats) { mm.transparent = true; mm.opacity = op; } };
  return true;
}

// 技能起手：AI 与附身玩家共用，由 netplay 的 boss 事件调用
export function bossAnim(sol, sem) {
  const g = sol && sol.glb;
  if (!g) return false;
  if (sem === 'skill') { g.st.skill = SKILL_T; return g.go('skill', true); }
  if (sem === 'attack') { g.st.atk = ATTACK_T; return g.go('attack', true); }
  return false;
}

export function detachBossModel(sol) {
  const g = sol && sol.glb;
  if (!g) return false;
  g.mixer.stopAllAction();
  sol.root.remove(g.src);
  g.src.traverse((o) => { if (o.isMesh && o.material) o.material.dispose(); });   // 材质是每次挂装新建的，几何与贴图共用不能动
  sol.glb = null;
  sol.mesh.visible = true;
  return true;
}

// 登场前把 GLB 的着色器编译掉：BOSS 出现那一帧现编译会卡全客户端（历史上实测首帧 178ms）
export function prewarmBossModels(renderer, scene, camera) {
  if (!renderer || !scene || !camera || !renderer.compile) return 0;
  const grp = new THREE.Group();
  grp.visible = false;
  grp.position.set(0, -900, 0);
  let n = 0;
  const geo = new THREE.BoxGeometry(0.02, 0.02, 0.02);
  for (const kind in FILES) {
    const e = store.get(kind);
    if (!e || !e.ready) continue;
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(Object.assign({ name: 'glb-' + kind, roughness: 0.75, metalness: 0.1 }, e.maps)));
    m.position.set(n * 0.1, 0, 0);
    grp.add(m); n++;
  }
  if (!n) { geo.dispose(); return 0; }
  scene.add(grp);
  try { renderer.compile(scene, camera); } catch (err) { /* 拿不到就不强求，最坏是登场那帧慢一点 */ }
  scene.remove(grp);
  grp.traverse((o) => { if (o.isMesh) o.material.dispose(); });
  geo.dispose();
  return n;
}
