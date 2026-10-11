// 3D 资产工作台：清单 + 提示词 + GLB 实时预览 + 自动验收 + 状态回写（数据存本机 IndexedDB）
// 用法：npm start 后打开 http://localhost:8080/tools/assetlab.html（需 DEV_SRC=1，与自动化测试同一套源码路由）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSETS, SPEC, WORKFLOW } from './asset-manifest.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (msg, err) => {
  const d = document.createElement('div');
  d.className = err ? 'err' : '';
  d.textContent = msg;
  $('toast').appendChild(d);
  setTimeout(() => d.remove(), err ? 5200 : 2400);
};
const mtf = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B');
const ST = { todo: '待生成', ready: '待验收', pass: '合格', reject: '退回' };
const STCLS = { todo: 'todo', ready: 'ready', pass: 'pass', reject: 'reject' };
const pcls = (p) => (p === true ? 'ok' : p === 'warn' ? 'warn' : 'bad');
const pmark = (p) => (p === true ? '✓' : p === 'warn' ? '△' : '✗');
const pchk = (p) => 'auto-' + (p === true ? 'pass' : p === 'warn' ? 'warn' : 'fail');

// ---------------- 本地库（IndexedDB：状态 + GLB 二进制都留在浏览器里） ----------------
const DB = 'cf-assetlab';
let db = null, store = {};
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('assets'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const rq = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
async function loadStore() {
  try {
    db = await openDb();
    const os = db.transaction('assets').objectStore('assets');
    const keys = await rq(os.getAllKeys()), vals = await rq(os.getAll());
    keys.forEach((k, i) => { store[k] = vals[i]; });
  } catch (e) { toast('本地库打不开（' + e.message + '），状态只保留在本页内存', true); }
}
function save(id) {
  if (!db) return;
  try { db.transaction('assets', 'readwrite').objectStore('assets').put(store[id], id); } catch (e) { /* 内存态仍在 */ }
}
const rec = (id) => (store[id] || (store[id] = { id, status: 'todo', notes: '', checks: {}, clipMap: {}, measured: null, glb: null, ts: 0 }));

// ---------------- 3D 预览 ----------------
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070b);
const camera = new THREE.PerspectiveCamera(38, 1, 0.02, 400);
camera.position.set(2.2, 1.7, 3.2);
const ctl = new OrbitControls(camera, renderer.domElement);
ctl.target.set(0, 0.9, 0);
ctl.enableDamping = true; ctl.dampingFactor = 0.08;
scene.add(new THREE.HemisphereLight(0xbdd0e8, 0x2a2620, 1.15));
const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(3, 5, 4); scene.add(key);
const rim = new THREE.DirectionalLight(0x88aaff, 1.1); rim.position.set(-4, 2.5, -3); scene.add(rim);
const grid = new THREE.GridHelper(8, 32, 0x33455f, 0x1b2432); scene.add(grid);
// 参考人形：Tripo 出来的东西经常尺度飘，旁边立个 1.8m 的人一眼就看出来
const ref = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 1.06, 4, 10), new THREE.MeshBasicMaterial({ color: 0x2f6f57, wireframe: true }));
  body.position.y = 0.9; ref.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0x2f6f57, wireframe: true }));
  head.position.y = 1.66; ref.add(head);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.42, 0, 0), new THREE.Vector3(0.42, 1.8, 0)]), new THREE.LineBasicMaterial({ color: 0x3fb37f }));
  ref.add(line);
  ref.position.x = -1.1;
}
scene.add(ref);

const modelRoot = new THREE.Group(); scene.add(modelRoot);
let mixer = null, actions = [], skel = null, wire = false, current = null, live = [];

function clearModel() {
  modelRoot.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  modelRoot.clear();
  if (skel) { scene.remove(skel); skel = null; }
  mixer = null; actions = []; live = [];
  const sel = $('clips'); sel.innerHTML = '<option value="">（无动画）</option>'; sel.disabled = true;
}
function measure(root) {
  const box = new THREE.Box3().setFromObject(root), size = new THREE.Vector3();
  box.getSize(size);
  let tris = 0, mats = new Set(), texs = [], meshes = 0, bones = [], nodes = [];
  root.traverse((o) => {
    if (o.name) nodes.push(o.name);
    if (o.isMesh) {
      meshes++;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      for (const m of [].concat(o.material)) {
        if (!m) continue;
        mats.add(m.name || 'unnamed');
        for (const k of ['map', 'normalMap', 'emissiveMap', 'metalnessMap', 'roughnessMap']) {
          const t = m[k];
          if (t && t.image && !texs.includes((t.name || '') + (t.image.width || 0) + 'x' + (t.image.height || 0))) texs.push((t.name || 'tex') + ' ' + (t.image.width || 0) + '×' + (t.image.height || 0));
        }
      }
    }
    if (o.isBone) bones.push(o.name);
  });
  return { tris: Math.round(tris), meshes, mats: [...mats], texs, bones, nodes, w: +size.x.toFixed(2), h: +size.y.toFixed(2), d: +size.z.toFixed(2) };
}
function fit(root) {
  const box = new THREE.Box3().setFromObject(root), size = new THREE.Vector3();
  box.getSize(size);
  root.position.y -= box.min.y;                       // 脚底贴地，方便和参考人形比高
  const span = Math.max(size.x, size.y, size.z, 0.6);
  camera.position.set(span * 1.5, size.y * 0.62 + span * 0.75, span * 2.0);
  ctl.target.set(0, size.y * 0.5, 0);
  camera.near = span / 100; camera.far = span * 60; camera.updateProjectionMatrix();
  ctl.update();
}
const loader = new GLTFLoader();
function loadGlb(buf, name, size) {
  loader.parse(buf, '', (gltf) => {
    clearModel();
    const root = gltf.scene || gltf.scenes[0];
    root.traverse((o) => {
      if (o.isMesh && !o.material) o.material = new THREE.MeshStandardMaterial();
      if (o.isSkinnedMesh) {
        // 蒙皮网格的包围球要逐顶点过骨骼算，视锥剔除会每帧触发；骨骼动画网格直接关掉剔除
        o.frustumCulled = false;
        const si = o.geometry.attributes.skinIndex;
        // glTF 的 JOINTS_0 字节本身就是骨索引；three 按 normalized 读会拿到 0.0039 这种小数，
        // skeleton.bones[小数] 越界 → 整帧渲染抛错、预览黑屏。Tripo 导出的文件全部带 normalized 标记，必须清掉。
        if (si && si.normalized) si.normalized = false;
      }
    });
    modelRoot.add(root);
    let m = measure(root);
    // 尺寸对不上不退回：Tripo 经常按别的单位出，等比例缩放就能救回来。容差内不动它，保留真实测量值。
    const a0 = ASSETS.find((x) => x.id === selId);
    const sp = a0 && a0.spec, target = sp && sp.h;
    const tol = sp && sp.tol != null ? sp.tol : 0.18;
    m.rawH = m.h; m.rawW = m.w; m.rawD = m.d; m.scale = 1;
    if (target && m.h > 0.01 && (m.h < target * (1 - tol) || m.h > target * (1 + tol))) {
      const k = target / m.h;
      root.scale.setScalar(k);
      m = Object.assign(measure(root), { rawH: m.rawH, rawW: m.rawW, rawD: m.rawD, scale: k });
    }
    m.name = name; m.bytes = size;
    mixer = gltf.animations && gltf.animations.length ? new THREE.AnimationMixer(root) : null;
    actions = (gltf.animations || []).map((c) => c.name || '(未命名)');
    m.clips = actions;
    const sel = $('clips');
    sel.disabled = !mixer;
    sel.innerHTML = mixer ? gltf.animations.map((c, i) => '<option value="' + i + '">' + esc(c.name || ('clip ' + i)) + ' · ' + c.duration.toFixed(2) + 's</option>').join('') : '<option value="">（无动画）</option>';
    current = { root, m, clips: gltf.animations || [] };   // play() 要读 current.clips，必须先赋值
    if (mixer) play(0);
    fit(root);
    if (skel) { scene.remove(skel); skel = null; }
    if ($('btnBone').classList.contains('on')) showBones(root);
    const r = rec(selId);
    r.glb = { name, size, ts: Date.now(), buffer: buf.slice(0) };
    r.measured = { tris: m.tris, h: m.h, w: m.w, d: m.d, rawH: m.rawH, rawW: m.rawW, rawD: m.rawD, scale: m.scale, bones: m.bones, nodes: m.nodes, clips: actions, mats: m.mats.length, texs: m.texs };
    r.ts = Date.now();
    if (r.status === 'todo') r.status = 'ready';
    save(r.id); renderDetail(); renderList(); renderHud();
    toast('已载入 ' + name + '（' + m.tris.toLocaleString() + ' 三角面）');
  }, (e) => { toast('GLB 解析失败：' + (e && e.message || e), true); });
}
function showBones(root) {
  if (skel) { scene.remove(skel); skel = null; }
  let b = null; root.traverse((o) => { if (o.isBone && !b) b = o; });
  if (b) { skel = new THREE.SkeletonHelper(root); skel.visible = true; scene.add(skel); }
}
function play(i) {
  if (!mixer) return;
  const c = current.clips[i]; if (!c) return;
  // r186 移除了 mixer.getExistingAction，改自己记已创建的 action 来停
  for (const a of live) a.stop();
  live = [];
  const act = mixer.clipAction(c);
  live.push(act);
  act.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveTimeScale(+$('speed').value || 1).play();
  $('clips').value = String(i);
}
function renderHud() {
  const el = $('hud');
  if (!current) { el.innerHTML = '<span class="k">等待 GLB…　</span>把 Tripo 导出的 .glb 拖进来即可实时预览；载入后会自动核对尺寸、面数、骨骼与动作。'; return; }
  const m = current.m, a = ASSETS.find((x) => x.id === sel_id()) || {};
  const chk = autoChecks(a, m, rec(sel_id()));
  el.innerHTML = '<b>' + esc(m.name) + '</b> <span class="k">' + mtf(m.bytes || 0) + '</span><br>'
    + '<span class="k">尺寸</span> ' + m.w + '×' + m.h + '×' + m.d + ' m　<span class="k">面数</span> ' + m.tris.toLocaleString()
    + '　<span class="k">网格</span> ' + m.meshes + '　<span class="k">材质</span> ' + m.mats.length + '　<span class="k">贴图</span> ' + (m.texs.length || 0)
    + '　<span class="k">骨骼</span> ' + m.bones.length + '　<span class="k">动作</span> ' + (current.clips.length || 0)
    + '<br>' + chk.map((c) => '<span class="tagline ' + pcls(c.pass) + '">' + pmark(c.pass) + ' ' + esc(c.k) + '：' + esc(c.got) + '（要求 ' + esc(c.want) + '）</span>').join('');
}
// Tripo 自动绑定 / 动画库的命名不可控（mixamorig:LeftUpLeg、Armature|Run_001、Humanoid Running…），
// 所以骨名与 clip 名都按"去分隔符 + 同义词组"匹配；一个 clip 只能占一个语义槽，防止一段动画蒙混多项。
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
function rigCheck(s, m) {
  const req = SPEC.RIGS[s.rig] || [];
  const have = (m.bones || []).map(norm);
  const miss = req.filter((g) => !g.alt.some((a) => have.some((h) => h.includes(norm(a)))));
  return { req, miss, count: (m.bones || []).length };
}
// 语义动作 → 实际 clip 名。手工映射优先（Tripo 动画库常把片段叫 Take 001），其次按同义词自动认。
function clipPairs(a, r, m) {
  const want = (a.spec && a.spec.clips) || [];
  const raw = ((m && m.clips) || []).map(String);
  const names = raw.map(norm);
  const man = (r && r.clipMap) || {};
  const used = new Set();
  const out = [];
  for (const k of want) {
    let v = man[k] || null;
    if (v != null && !raw.includes(v)) v = null;            // 映射指向的 clip 不在这个文件里 → 视为未映射
    if (v) { used.add(raw.indexOf(v)); out.push([k, v, true]); continue; }
    const alts = SPEC.CLIPS[k] || [k];
    const i = names.findIndex((n, idx) => !used.has(idx) && alts.some((alt) => n.includes(norm(alt))));
    if (i >= 0) { used.add(i); out.push([k, raw[i], false]); } else out.push([k, null, false]);
  }
  return out;
}
// 机器能判的验收项：尺寸（不达标就等比例缩放）/ 面数 / 骨骼 / 动作（可手工映射）/ 锚点 / 贴图上限
function autoChecks(a, m, r) {
  if (!a || !a.spec || !m) return [];
  const s = a.spec, out = [];
  if (s.h) {
    const tol = s.tol == null ? 0.18 : s.tol, lo = s.h * (1 - tol), hi = s.h * (1 + tol);
    const k = m.scale || 1, raw = m.rawH || m.h, ns = Math.abs(k - 1) < 1e-6;
    out.push({
      k: '总高度', want: lo.toFixed(2) + '~' + hi.toFixed(2) + 'm',
      got: ns ? m.h + 'm（在容差内，按原尺寸）'
        : '原始 ' + raw + 'm → 等比例 ×' + k.toFixed(3) + ' → ' + m.h + 'm' + (k >= 0.1 && k <= 10 ? '（已自动归一，比例没走形就算合格）' : '（差 10 倍以上，不像单位问题，先确认导出是否正常）'),
      pass: ns ? (m.h >= lo && m.h <= hi) : (k >= 0.1 && k <= 10 ? 'warn' : false),
    });
  }
  // 面数只做参考、绝不拦人：质量优先，真实性能要在引擎里按同屏总三角面与实测 FPS 判，而不是按单模型预算判
  if (s.tris) {
    const lo = s.tris[0] || 0, hi = s.tris[1], over = m.tris > hi, under = m.tris < lo;
    out.push({
      k: '三角面（参考）', want: lo.toLocaleString() + '~' + hi.toLocaleString(),
      got: m.tris.toLocaleString() + (over ? '（超参考 ' + Math.round((m.tris / hi - 1) * 100) + '%，不拦，接入时按同屏总量与实测帧率判）'
        : under ? '（低于参考下限，细节可能不够）' : '（在参考区间内）'),
      pass: over || under ? 'warn' : true,
    });
  }
  if (s.rig && s.rig !== 'none') {
    const r = rigCheck(s, m);
    out.push({
      k: '骨骼 · ' + (s.rig === 'humanoid' ? '人形 19 骨' : '怪物主干'),
      want: r.req.map((g) => g.label).join('/'), got: r.miss.length ? (r.count ? '共 ' + r.count + ' 骨，缺 ' + r.miss.slice(0, 4).map((g) => g.label).join('/') : '完全没有骨骼（Tripo 需开 Auto Rigify）') : '全含（' + r.count + ' 骨）',
      pass: r.miss.length === 0,
    });
  }
  if ((s.clips || []).length) {
    const p = clipPairs(a, r, m);
    const raw = (m.clips || []).map(String);
    const miss = p.filter((x) => !x[1]);
    const autoKnown = p.some((x) => x[1] && !x[2]);
    out.push({
      k: '动作片段', want: s.clips.join(' / '),
      got: !raw.length ? 'GLB 里没有动画（Tripo 请勾选动画后再导出）'
        : !miss.length ? p.map((x) => x[0] + '→' + x[1] + (x[2] ? '*' : '')).join(' ')
        : '待指认：' + miss.map((x) => x[0]).join('/') + '（在下方「动作名映射」里逐个选实际 clip 名）',
      pass: !raw.length ? false : !miss.length ? true : (!autoKnown && raw.length >= s.clips.length ? 'warn' : false),
    });
  }
  if (s.anchors) {
    const have = (m.nodes || []).map(norm);
    const miss = s.anchors.filter((k) => !have.some((h) => h.includes(norm(k))));
    out.push({ k: '锚点节点', want: s.anchors.join(' / '), got: miss.length ? '缺 ' + miss.join('/') + '（能接受：集成时按包围盒推断，但手感要重调）' : '全含', pass: miss.length === 0 ? true : 'warn' });
  }
  if (s.texMax) {
    const big = m.texs.filter((t) => { const mm = /(\d+)×(\d+)/.exec(t); return mm && Math.max(+mm[1], +mm[2]) > s.texMax; });
    out.push({ k: '贴图上限', want: s.texMax + 'px', got: big.length ? big[0] : (m.texs[0] || '无'), pass: big.length === 0 });
  }
  return out;
}

// ---------------- 渲染：列表与详情 ----------------
let selId = null;
const sel_id = () => selId;
const filt = { pr: new Set(), cat: new Set(), st: new Set(), q: '' };
function visible(a) {
  const r = rec(a.id);
  if (filt.pr.size && !filt.pr.has(a.p)) return false;
  if (filt.cat.size && !filt.cat.has(a.cat)) return false;
  if (filt.st.size && !filt.st.has(r.status)) return false;
  if (filt.q) {
    const hay = (a.name + ' ' + a.id + ' ' + (a.use || '') + ' ' + (a.prompts || []).map((p) => p.text).join(' ') + ' ' + (a.tips || []).join(' ')).toLowerCase();
    if (!hay.includes(filt.q.toLowerCase())) return false;
  }
  return true;
}
function chips(el, items, set) {
  el.innerHTML = items.map((x) => '<span class="chip ' + x.cls + (set.has(x.v) ? ' on' : '') + '" data-v="' + esc(x.v) + '">' + esc(x.t) + '</span>').join('');
  el.onclick = (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    const v = c.getAttribute('data-v');
    set.has(v) ? set.delete(v) : set.add(v);
    renderList(); chips(el, items, set);
  };
}
function renderFilters() {
  chips($('prChips'), ['P0', 'P1', 'P2'].map((p) => ({ v: p, t: p + ' ' + (SPEC.prLabel[p] || ''), cls: p.toLowerCase() })), filt.pr);
  const cats = [...new Set(ASSETS.map((a) => a.cat))];
  chips($('catChips'), cats.map((c) => ({ v: c, t: SPEC.cats[c] || c, cls: '' })), filt.cat);
  chips($('stChips'), Object.keys(ST).map((k) => ({ v: k, t: ST[k], cls: 'st' })), filt.st);
}
function renderList() {
  const list = ASSETS.filter(visible);
  $('list').innerHTML = list.map((a) => {
    const r = rec(a.id);
    return '<div class="item' + (a.id === selId ? ' sel' : '') + '" data-id="' + esc(a.id) + '">'
      + '<span class="dot ' + STCLS[r.status] + '"></span>'
      + '<div style="min-width:0;flex:1"><div class="nm">' + esc(a.name) + '</div><div class="sub">' + esc(SPEC.cats[a.cat] || a.cat) + ' · ' + esc(a.slot || '') + (r.glb ? ' · 已挂 ' + esc(r.glb.name) : '') + '</div></div>'
      + '<span class="pr ' + a.p + '">' + a.p + '</span></div>';
  }).join('') || '<div id="empty">没有匹配的条目</div>';
  const done = ASSETS.filter((a) => rec(a.id).status === 'pass').length;
  $('prog').textContent = '进度 ' + done + ' / ' + ASSETS.length + ' 合格';
  $('progBar').style.width = (done / Math.max(1, ASSETS.length) * 100).toFixed(0) + '%';
  $('dbInfo').textContent = '本地库 ' + Object.keys(store).filter((k) => store[k].glb).length + ' 个 GLB';
}
function renderDetail() {
  const a = ASSETS.find((x) => x.id === selId);
  if (!a) { $('detail').innerHTML = '<div id="empty">左侧选一个资产条目</div>'; return; }
  const r = rec(a.id);
  const m = r.measured;
  const auto = m ? autoChecks(a, { ...m, texs: m.texs || [] }, r) : [];
  $('detail').setAttribute('data-id', a.id);
  $('detail').innerHTML = '<h1>' + esc(a.name) + ' <span class="pr ' + a.p + '">' + a.p + '</span></h1>'
    + '<div class="meta">' + esc(SPEC.cats[a.cat] || a.cat) + ' · 引擎槽位 <b>' + esc(a.slot || '—') + '</b> · 资产 id <b>' + esc(a.id) + '</b></div>'
    + '<div class="note">' + esc(a.use) + '</div>'
    + '<h2>规格与约束</h2><div class="spec">'
    + (a.spec.rows || []).map((row) => '<div><b>' + esc(row[0]) + '</b><span>' + esc(row[1]) + '</span></div>').join('')
    + (a.spec.h ? '<div><b>目标尺寸（米）</b><span>高 ' + a.spec.h + ' × 宽 ' + (a.spec.w || '—') + ' × 深 ' + (a.spec.d || '—') + '</span></div>' : '')
    + (a.spec.tris ? '<div><b>面数参考（不卡门槛）</b><span>' + (a.spec.tris[0] || 0).toLocaleString() + ' ~ ' + a.spec.tris[1].toLocaleString() + ' 三角面</span></div>' : '')
    + (a.spec.texMax ? '<div><b>贴图上限</b><span>' + a.spec.texMax + ' px</span></div>' : '')
    + '</div>'
    + (a.spec.rig && a.spec.rig !== 'none' ? '<div style="margin-top:8px"><span class="k meta">骨骼要求（' + (a.spec.rig === 'humanoid' ? '人形 19 骨，命名含下列关键词即可，mixamorig 系也算' : '怪物主干 + 四肢，命名含关键词即可') + '）</span><br>' + (SPEC.RIGS[a.spec.rig] || []).map((g) => '<span class="tagline">' + esc(g.label) + '</span>').join('') + '</div>' : '')
    + ((a.spec.clips || []).length ? '<div style="margin-top:4px"><span class="k meta">需要的动作片段（左边是用途，右边是 Tripo 动画库里可认的英文名，任选一个对上的勾上即可）</span><br>' + a.spec.clips.map((k) => '<span class="tagline">' + esc(k) + ' → ' + esc((SPEC.CLIPS[k] || [k]).slice(0, 3).join('/')) + '</span>').join('') + '</div>' : '')
    + ((a.spec.anchors || []).length ? '<div style="margin-top:4px"><span class="k meta">锚点节点（缺了也能挂，我们按包围盒推断，但第一人称手感要重调）</span><br>' + a.spec.anchors.map((k) => '<span class="tagline">' + esc(k) + '</span>').join('') + '</div>' : '')
    + '<h2>给 Tripo 的提示词</h2>'
    + (a.prompts || []).map((p, i) => '<div class="prompt"><button class="copy" data-copy="' + i + '">复制</button>' + esc(p.text) + '</div>'
      + (p.note ? '<div class="note">' + esc(p.note) + '</div>' : '')).join('')
    + (a.tips && a.tips.length ? '<h2>生成参数与注意事项</h2><ul class="tips">' + a.tips.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>' : '')
    + '<details' + (r.glb ? '' : ' open') + ' class="flow"><summary class="k">导入流程：Tripo 挂动画 → 本页核对 → 发我验收单</summary><ul class="tips">' + WORKFLOW.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul></details>'
    + '<h2>验收</h2>'
    + (m && r.glb ? '<div class="meta">当前挂载：' + esc(m.name || r.glb.name) + ' · ' + mtf((r.glb || {}).size || 0) + ' · 载入于 ' + new Date(r.glb.ts).toLocaleString() + '</div>' + auto.map((c) => '<div class="chk ' + pchk(c.pass) + '"><span>' + pmark(c.pass) + '</span><div>' + esc(c.k) + '：实测 <b>' + esc(c.got) + '</b>，要求 ' + esc(c.want) + '</div></div>').join('')
      + ((m.clips || []).length ? '<div class="why">实测 clip 名：' + esc(m.clips.join(' · ')) + '</div>' : '')
      : '<div class="note">还没有挂载 GLB。右侧预览面板拖入文件即可自动核对下面这些机器可判项。</div>')
    // 动作名映射：Tripo 的动画库经常给片段起名 Take 001，指认一次就写进本地库，验收与导出都按映射算
    + (m && (m.clips || []).length && (a.spec.clips || []).length ? '<h2>动作名映射</h2><div class="spec">' + clipPairs(a, r, m).map((p) => '<div><b>' + esc(p[0]) + '</b><span><select data-clip="' + esc(p[0]) + '">'
      + '<option value="">' + (p[1] && !p[2] ? '（自动：' + esc(p[1]) + '）' : '（自动识别）') + '</option>'
      + m.clips.map((c) => '<option' + (p[2] && c === p[1] ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select> '
      + (p[2] ? '<span class="ok">已手工指定</span>' : p[1] ? '<span class="ok">自动命中</span>' : '<span class="bad">未对上</span>') + '</span></div>').join('') + '</div>' : '')
    + (a.manual || []).map((t, i) => '<label class="chk"><input type="checkbox" data-chk="' + i + '"' + (r.checks[i] ? ' checked' : '') + '><div>' + esc(t) + '</div></label>').join('')
    + '<div class="row"><button data-st="ready">标为待验收</button><button data-st="pass">验收合格</button><button data-st="reject">退回重做</button>'
    + (r.glb ? '<button id="btnUnhook">卸载 GLB</button><button id="btnSave">下载 GLB</button>' : '') + '</div>'
    + '<textarea id="notes" placeholder="验收意见 / 退回原因（会随 JSON 导出给我）">' + esc(r.notes) + '</textarea>';
}

// ---------------- 交互 ----------------
$('list').addEventListener('click', (e) => {
  const it = e.target.closest('.item'); if (!it) return;
  selId = it.getAttribute('data-id');
  renderList(); renderDetail();
  const r = rec(selId);
  if (r.glb && (!current || current.m.name !== r.glb.name)) loadGlb(r.glb.buffer.slice(0), r.glb.name, r.glb.size);
  else if (!r.glb) { clearModel(); current = null; renderHud(); }
});
$('detail').addEventListener('click', async (e) => {
  const a = ASSETS.find((x) => x.id === selId); const r = rec(selId);
  const cp = e.target.closest('[data-copy]');
  if (cp) {
    const t = a.prompts[+cp.getAttribute('data-copy')].text;
    try { await navigator.clipboard.writeText(t); toast('提示词已复制'); }
    catch (err) {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); toast('提示词已复制（兼容路径）');
    }
    return;
  }
  const st = e.target.closest('[data-st]');
  if (st) {
    r.status = st.getAttribute('data-st'); r.ts = Date.now();
    if (r.status === 'ready' && !r.glb) toast('还没挂 GLB：先把文件拖进右侧预览', true);
    save(r.id); renderList(); renderDetail();
    return;
  }
  if (e.target.id === 'btnUnhook') { r.glb = null; r.measured = null; clearModel(); current = null; save(r.id); renderList(); renderDetail(); renderHud(); return; }
  if (e.target.id === 'btnSave' && r.glb) {
    const url = URL.createObjectURL(new Blob([r.glb.buffer], { type: 'model/gltf-binary' }));
    const d = document.createElement('a'); d.href = url; d.download = a.id + '.glb'; d.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return;
  }
});
$('detail').addEventListener('input', (e) => {
  const r = rec(selId);
  if (e.target.id === 'notes') { r.notes = e.target.value; save(r.id); }
  const c = e.target.closest('[data-chk]');
  if (c) { r.checks[+c.getAttribute('data-chk')] = c.checked; save(r.id); }
  const cl = e.target.closest('select[data-clip]');
  if (cl) {
    const k = cl.getAttribute('data-clip');
    r.clipMap = r.clipMap || {};
    if (cl.value) r.clipMap[k] = cl.value; else delete r.clipMap[k];
    save(r.id); renderDetail(); renderHud();
  }
});
$('q').oninput = (e) => { filt.q = e.target.value; renderList(); };
$('btnReload').onclick = () => location.reload();
$('file').onchange = (e) => { const f = e.target.files[0]; if (f) take(f); e.target.value = ''; };
$('btnFile').onclick = () => $('file').click();
$('clips').onchange = (e) => play(+e.target.value || 0);
$('speed').onchange = () => { if (mixer && current) play(+$('clips').value || 0); };
$('btnPlay').onclick = function () {
  if (!mixer) return toast('这个 GLB 没有动画片段', true);
  this.classList.toggle('on');
  if (this.classList.contains('on')) mixer.timeScale = 1; else mixer.timeScale = 0;
};
$('btnWire').onclick = function () {
  wire = !wire; this.classList.toggle('on', wire);
  modelRoot.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) m.wireframe = wire; });
};
$('btnGrid').onclick = function () { grid.visible = !grid.visible; this.classList.toggle('on', grid.visible); };
$('btnRef').onclick = function () { ref.visible = !ref.visible; this.classList.toggle('on', ref.visible); };
$('btnBone').onclick = function () {
  this.classList.toggle('on');
  if (!current) return;
  if (this.classList.contains('on')) showBones(current.root);
  else if (skel) { scene.remove(skel); skel = null; }
};
let spin = false;
$('btnSpin').onclick = function () { spin = !spin; this.classList.toggle('on', spin); };
$('btnFit').onclick = () => current && fit(current.root);

async function take(f) {
  if (!selId) return toast('先在左侧选一个资产条目，再挂文件', true);
  const buf = await f.arrayBuffer();
  loadGlb(buf, f.name, f.size);
}
window.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('hot'); });
window.addEventListener('dragleave', () => stage.classList.remove('hot'));
window.addEventListener('drop', (e) => {
  stage.classList.remove('hot');
  e.preventDefault();
  const f = [...(e.dataTransfer.files || [])].find((x) => /\.glb$/i.test(x.name));
  if (f) take(f);
});

// ---------------- 导入导出 ----------------
$('btnExport').onclick = () => {
  const out = {
    kind: 'cf-assetlab', ver: 1, ts: new Date().toISOString(), spec: SPEC.version,
    assets: ASSETS.map((a) => {
      const r = rec(a.id);
      return { id: a.id, name: a.name, p: a.p, status: r.status, notes: r.notes, checks: r.checks, clipMap: r.clipMap || {}, glb: r.glb ? { name: r.glb.name, size: r.glb.size } : null, measured: r.measured };
    }),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  const d = document.createElement('a'); d.href = url; d.download = 'asset-验收单-' + new Date().toISOString().slice(0, 10) + '.json'; d.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('已导出验收单（不含 GLB 二进制）');
};
$('btnImport').onclick = () => $('jsonFile').click();
$('jsonFile').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (!j || !Array.isArray(j.assets)) throw new Error('格式不对');
    let n = 0;
    for (const a of j.assets) {
      if (!ASSETS.some((x) => x.id === a.id)) continue;
      const r = rec(a.id);
      Object.assign(r, { status: a.status || r.status, notes: a.notes == null ? r.notes : a.notes, checks: a.checks || r.checks, clipMap: a.clipMap || r.clipMap, ts: Date.now() });
      save(r.id); n++;
    }
    renderList(); renderDetail();
    toast('已合并 ' + n + ' 条状态');
  } catch (err) { toast('导入失败：' + err.message, true); }
};

// ---------------- 尺寸与循环 ----------------
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
const clock = new THREE.Clock();
(function loop() {
  requestAnimationFrame(loop);
  const dt = clock.getDelta();
  if (mixer) mixer.update(dt);
  if (spin) modelRoot.rotation.y += dt * 0.6;
  ctl.update();
  renderer.render(scene, camera);
})();

// ---------------- 启动 ----------------
await loadStore();
ASSETS.forEach((a) => rec(a.id));
renderFilters(); renderList(); renderHud();
selId = (ASSETS.filter((a) => rec(a.id).status !== 'pass').sort((x, y) => x.p.localeCompare(y.p))[0] || ASSETS[0]).id;
renderList(); renderDetail();
resize();
