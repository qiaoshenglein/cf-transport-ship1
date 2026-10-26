// Third-person visuals only. Logical bones, hit boxes and first-person arms remain independent.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const cache = new Map();
const names = {
  Hips: 'hips', Spine: 'spine', Spine1: 'spine', Spine2: 'chest', Neck: 'neck', Head: 'head',
  RightShoulder: 'shoulderR', RightArm: 'upperArmR', RightForeArm: 'forearmR', RightHand: 'handR',
  LeftShoulder: 'shoulderL', LeftArm: 'upperArmL', LeftForeArm: 'forearmL', LeftHand: 'handL',
  RightUpLeg: 'thighR', RightLeg: 'shinR', RightFoot: 'footR',
  LeftUpLeg: 'thighL', LeftLeg: 'shinL', LeftFoot: 'footL',
};
const canonical = name => name.replace(/^mixamorig:?/, '');
const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const down = new THREE.Vector3(0, -1, 0);
const p = V(), p2 = V(), q = Q(), q2 = Q(), q3 = Q();

export function loadSoldierModel(team) {
  if (!['BL', 'GR'].includes(team)) return Promise.resolve(null);
  if (cache.has(team)) return cache.get(team).promise;
  const entry = {};
  cache.set(team, entry);
  entry.promise = (async () => {
    try {
      const response = await fetch('/assets/models/soldier_' + team.toLowerCase() + '.glb', { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('Soldier asset HTTP ' + response.status);
      const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
      const root = gltf.scene, bones = {};
      root.traverse(o => {
        if (o.isBone) bones[canonical(o.name)] = o;
        if (o.isSkinnedMesh && o.geometry.attributes.skinIndex) o.geometry.attributes.skinIndex.normalized = false;
      });
      for (const name of Object.keys(names)) if (!bones[name]) throw new Error('Missing soldier bone: ' + name);
      root.updateMatrixWorld(true);
      // Derive facing from anatomical right, instead of assuming Tripo always exports +Z.
      const right = bones.RightUpLeg.getWorldPosition(V()).sub(bones.LeftUpLeg.getWorldPosition(V()));
      const yaw = Math.atan2(right.z, right.x);
      const box = new THREE.Box3().setFromObject(root);
      const clips = gltf.animations.map(c => {
        const clip = c.clone();
        for (const track of clip.tracks) {
          if (/Hips\.position$/.test(track.name)) {
            const values = track.values, rest = bones.Hips.position;
            const dx = rest.x - values[0], dy = rest.y - values[1], dz = rest.z - values[2];
            for (let i = 0; i < values.length; i += 3) { values[i] += dx; values[i + 1] += dy; values[i + 2] += dz; }
          }
        }
        return clip;
      });
      // Some Tripo fall clips finish above the floor. Measure their final skinned pose
      // once per shared asset; compensate smoothly while falling, without per-frame mesh scans.
      let deathOffset = 0;
      const fall = clips.find(c => c.name.toLowerCase() === 'fall');
      if (fall) {
        const saved = Object.values(bones).map(b => [b, b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
        const sampler = new THREE.AnimationMixer(root), action = sampler.clipAction(fall);
        action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play(); sampler.update(fall.duration);
        root.updateMatrixWorld(true);
        root.traverse(o => { if (o.isSkinnedMesh) o.computeBoundingBox(); });
        deathOffset = new THREE.Box3().setFromObject(root).min.y - box.min.y;
        sampler.stopAllAction(); sampler.uncacheRoot(root);
        for (const [b, pos, rot, size] of saved) { b.position.copy(pos); b.quaternion.copy(rot); b.scale.copy(size); }
        root.updateMatrixWorld(true);
        root.traverse(o => { if (o.isSkinnedMesh) o.computeBoundingBox(); });
      }
      Object.assign(entry, { ready: true, root, clips, yaw, deathOffset, height: box.max.y - box.min.y, minY: box.min.y });
      return entry;
    } catch (e) {
      entry.error = e.message;
      return entry; // An unavailable asset must never prevent entering a match.
    }
  })();
  return entry.promise;
}

export async function preloadSoldierModels(progress) {
  const results = [];
  for (const team of ['BL', 'GR']) {
    results.push(await loadSoldierModel(team));
    progress?.(results.length / 2);
  }
  return results;
}

export function attachSoldierModel(sol) {
  const entry = cache.get(sol.team);
  if (!sol.humanEligible || sol.human || sol.lookKey || sol.glb || !entry?.ready || sol.disposed) return false;
  const src = clone(entry.root), bones = {}, mats = [], rest = new Map(), mapping = [];
  src.name = 'soldier-' + sol.team;
  const geo = sol.mesh.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const scale = (geo.boundingBox.max.y - geo.boundingBox.min.y) / entry.height;
  src.scale.setScalar(scale); src.rotation.y = entry.yaw; src.position.y = -entry.minY * scale;
  src.traverse(o => {
    if (o.isBone) { bones[canonical(o.name)] = o; rest.set(o, { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }); }
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      const copy = m => { const mm = m.clone(); mats.push(mm); return mm; };
      o.material = Array.isArray(o.material) ? o.material.map(copy) : copy(o.material);
    }
  });
  // Capture rest orientations before parenting to an already translated/rotated actor.
  src.updateMatrixWorld(true);
  for (const [name, source] of Object.entries(names)) {
    const bone = bones[name], bindQ = bone.getWorldQuaternion(Q());
    if (/Arm$|ForeArm$|Hand$|UpLeg$|Leg$/.test(name)) {
      const child = /Hand$/.test(name) ? bones[name + 'Middle1'] : bone.children.find(o => o.isBone);
      const dir = child.getWorldPosition(V()).sub(bone.getWorldPosition(V())).normalize();
      bindQ.premultiply(Q().setFromUnitVectors(dir, down));
    }
    mapping.push({ name, bone, source, bindQ });
  }
  const mixer = new THREE.AnimationMixer(src), actions = {};
  for (const sem of ['idle', 'walk', 'run', 'shoot', 'fall']) {
    const clip = entry.clips.find(c => c.name.toLowerCase() === sem);
    if (clip) {
      actions[sem] = mixer.clipAction(clip);
      if (sem === 'fall') { actions[sem].setLoop(THREE.LoopOnce, 1); actions[sem].clampWhenFinished = true; }
    }
  }
  // Take finger articulation from the official shoot clip; aim and grip remain weapon-specific.
  const grip = new Map();
  if (actions.shoot) {
    actions.shoot.play(); mixer.update(.5);
    for (const [name, bone] of Object.entries(bones)) if (/Hand.+[123]$/.test(name)) grip.set(bone, bone.quaternion.clone());
    mixer.stopAllAction();
  }
  for (const [bone, value] of rest) { bone.position.copy(value.p); bone.quaternion.copy(value.q); bone.scale.copy(value.s); }
  const animated = new Map([...rest].map(([b, v]) => [b, { p: v.p.clone(), q: v.q.clone(), s: v.s.clone() }]));
  sol.human = { src, bones, mats, rest, animated, mapping, mixer, actions, grip, baseY: src.position.y, deathOffset: entry.deathOffset * scale, current: null, procedural: 0, team: sol.team };
  sol.root.add(src);
  sol.setBodyVisible(sol.bodyVisible);
  return true;
}

function orient(bone, worldQ) {
  bone.quaternion.copy(bone.parent.getWorldQuaternion(q3).invert().multiply(worldQ));
  bone.updateMatrixWorld(true);
}

// Two-bone IK using the generated skeleton's measured lengths; it never moves logical hitboxes.
function armIK(h, side, target, pole) {
  const arm = h.bones[side + 'Arm'], fore = h.bones[side + 'ForeArm'], hand = h.bones[side + 'Hand'];
  const shoulder = arm.getWorldPosition(V()), elbow = fore.getWorldPosition(V()), wrist = hand.getWorldPosition(V());
  const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(wrist);
  const dir = target.clone().sub(shoulder), d = THREE.MathUtils.clamp(dir.length(), Math.abs(a - b) + .001, a + b - .001);
  dir.normalize();
  const bend = pole.clone().sub(shoulder); bend.addScaledVector(dir, -bend.dot(dir)).normalize();
  const cos = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const desiredElbow = shoulder.clone().addScaledVector(dir, a * cos).addScaledVector(bend, a * Math.sqrt(1 - cos * cos));
  q.setFromUnitVectors(elbow.sub(shoulder).normalize(), desiredElbow.clone().sub(shoulder).normalize());
  orient(arm, arm.getWorldQuaternion(q2).premultiply(q));
  fore.getWorldPosition(elbow); hand.getWorldPosition(wrist);
  q.setFromUnitVectors(wrist.sub(elbow).normalize(), shoulder.addScaledVector(dir, d).sub(elbow).normalize());
  orient(fore, fore.getWorldQuaternion(q2).premultiply(q));
}

export function updateSoldierModel(sol, dt, st = {}) {
  if (sol.human?.team !== sol.team) detachSoldierModel(sol);
  if (!sol.human) attachSoldierModel(sol);
  const h = sol.human;
  if (!h) return;
  sol.setBodyVisible(sol.bodyVisible);
  if (sol.lookKey || sol.glb) return;
  for (const mat of h.mats) {
    mat.emissive.copy(sol.material.emissive); mat.emissiveIntensity = sol.material.emissiveIntensity;
    mat.opacity = sol.material.opacity; mat.transparent = mat.opacity < .999;
  }
  const dead = sol.deadT >= 0, speed = st.speed || 0;
  h.src.position.y = h.baseY - (dead ? h.deathOffset * THREE.MathUtils.smoothstep(sol.deadT, 0, h.actions.fall?.getClip().duration || 3) : 0);
  const moving = speed > (h.current === 'walk' || h.current === 'run' ? .3 : .6) && st.onGround;
  const want = dead ? 'fall' : moving ? (speed > (h.current === 'run' ? 3 : 3.6) ? 'run' : 'walk') : 'idle';
  if (want !== h.current && h.actions[want]) {
    const old = h.actions[h.current], next = h.actions[want];
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    if (old) next.crossFadeFrom(old, dead ? .1 : .18, false);
    h.current = want;
  }
  if (moving && h.actions[want]) h.actions[want].setEffectiveTimeScale(THREE.MathUtils.clamp(speed / (want === 'run' ? 5 : 2.3), .55, 1.65));
  // Restore the previous *animation* pose before mixing, not the bind pose.
  // Three skips writing unchanged tracks; resetting to rest would make clamped
  // death clips snap back to T-pose and would feed procedural IK into blending.
  for (const [bone, value] of h.animated) { bone.position.copy(value.p); bone.quaternion.copy(value.q); bone.scale.copy(value.s); }
  h.mixer.update(dt);
  for (const [bone, value] of h.animated) { value.p.copy(bone.position); value.q.copy(bone.quaternion); value.s.copy(bone.scale); }
  sol.root.updateWorldMatrix(true, false);
  // SkinnedMesh.updateMatrixWorld also refreshes bindMatrixInverse. The generic
  // updateWorldMatrix path would apply a moving corpse's root translation twice.
  h.src.updateMatrixWorld(true);
  if (dead) return;
  sol.mesh.updateWorldMatrix(true, true);
  // Anchor pelvis to the gameplay pose: crouch/air and server feet share the same origin.
  h.bones.Hips.position.copy(h.bones.Hips.parent.worldToLocal(sol.B.hips.getWorldPosition(p)));
  h.src.updateMatrixWorld(true);
  const procedural = st.crouch || !st.onGround || st.fwd < -.3;
  h.procedural = THREE.MathUtils.damp(h.procedural, procedural ? 1 : 0, 14, dt);
  for (const item of h.mapping) {
    const leg = /UpLeg$|Leg$|Foot$/.test(item.name);
    if (leg && h.procedural < .001) continue;
    q.copy(sol.B[item.source].getWorldQuaternion(q2)).multiply(item.bindQ);
    if (leg) { const desired = q.clone(); q.copy(item.bone.getWorldQuaternion(q2)).slerp(desired, h.procedural); }
    orient(item.bone, q);
  }
  for (const [bone, pose] of h.grip) bone.quaternion.copy(pose);
  if (sol.gun) {
    const anchors = sol.gun.userData.anchors, knife = sol.gunType === 'knife' || sol.gunType === 'he';
    for (const [side, anchor] of [['Right', anchors.grip], ['Left', !knife && anchors.fore]]) {
      if (!anchor) continue;
      const hand = h.bones[side + 'Hand'];
      // Keep the hand orientation from the retargeted arm while solving the wrist to the grip.
      const handQ = hand.getWorldQuaternion(Q());
      const palm = h.bones[side + 'HandMiddle1'].position.clone().multiplyScalar(.5 * h.src.scale.x).applyQuaternion(handQ);
      const target = sol.gun.localToWorld(p.copy(anchor)).sub(palm).clone();
      if (side === 'Left') {
        // The generated forearms are shorter than the logical rig. Slide the support
        // palm back along the handguard, never stretch the skin or move the muzzle.
        const upper = h.bones.LeftArm.getWorldPosition(V()), elbow = h.bones.LeftForeArm.getWorldPosition(V());
        const reach = upper.distanceTo(elbow) + elbow.distanceTo(hand.getWorldPosition(V())) - .018;
        const offset = target.clone().sub(upper);
        if (offset.length() > reach) {
          const along = new THREE.Vector3(0, 0, 1).applyQuaternion(sol.gun.getWorldQuaternion(Q()));
          const dot = offset.dot(along), disc = dot * dot - (offset.lengthSq() - reach * reach);
          if (disc >= 0) target.addScaledVector(along, THREE.MathUtils.clamp(-dot - Math.sqrt(disc), 0, .22));
        }
      }
      const pole = sol.B.chest.localToWorld(p2.set(side === 'Right' ? .6 : -.5, -.5, .1)).clone();
      armIK(h, side, target, pole); orient(hand, handQ);
    }
  }
  h.src.updateMatrixWorld(true);
}

export function resetSoldierModel(sol) {
  const h = sol.human;
  if (!h) return;
  h.mixer.stopAllAction(); h.current = null; h.procedural = 0;
  for (const [bone, value] of h.rest) {
    bone.position.copy(value.p); bone.quaternion.copy(value.q); bone.scale.copy(value.s);
    const animated = h.animated.get(bone); animated.p.copy(value.p); animated.q.copy(value.q); animated.s.copy(value.s);
  }
  for (const mat of h.mats) { mat.opacity = 1; mat.transparent = false; }
}

export function detachSoldierModel(sol) {
  const h = sol.human;
  if (!h) return;
  h.mixer.stopAllAction(); h.mixer.uncacheRoot(h.src);
  sol.root.remove(h.src);
  const skeletons = new Set();
  h.src.traverse(o => { if (o.isSkinnedMesh) skeletons.add(o.skeleton); });
  for (const skeleton of skeletons) skeleton.dispose();
  for (const mat of h.mats) mat.dispose();
  sol.human = null;
  sol.setBodyVisible(sol.bodyVisible);
}
