// 画质细节的单一真相：设置面板照这份 schema 生成，三档预设与"自动调整"的降载阶梯也在这里。
//
// 刻意不 import three —— 降载决策必须能用 Node 直接跑回归（开浏览器量这些开关的代价太高），
// 也因此这里只做"算出一组生效值"，真正落到 GPU 上是各模块自己的 applyQuality()。
//
// 两条设计约束（都是踩出来的）：
// ① 自动调整永远不许写回用户设定：它只在用户值之上叠一层"降载档"，帧率回来就原样交还，
//    否则用户精心调的画质会被悄悄吃掉且再也找不回来（老版本"只降不升"就是这个毛病）。
// ② 每一项都必须能实时生效。只有贴图精度（tex）例外——它决定 canvas 生成尺寸，
//    重建等于重做一遍地图，所以它标注"下一局生效"，不假装能热切。

const ITEMS = [
  // ---- 显示 ----
  { k: 'res', g: '显示', lab: '渲染分辨率', t: 'rng', min: 50, max: 200, step: 5, unit: '%', dec: 0, hint: '内部画面相对窗口大小的倍率。低于 100% 会变糊但明显更省，高于 100% 是超采样。' },
  { k: 'msaa', g: '显示', lab: '抗锯齿', t: 'seg', o: [[0, '关闭'], [2, '2×'], [4, '4×']], hint: '边缘锯齿。高分屏上 2× 已足够，4× 很贵。' },
  { k: 'maxFps', g: '显示', lab: '帧率上限', t: 'seg', o: [[0, '不限'], [30, '30'], [60, '60'], [90, '90'], [120, '120']], hint: '限帧能压住显卡发热与占用，自动调整不会去追超过这里的上限。' },
  { k: 'tex', g: '显示', lab: '贴图精度', t: 'seg', o: [['low', '省'], ['medium', '中'], ['high', '高']], nextMatch: true, hint: '程序化生成贴图的画布尺寸，决定显存与首次生成耗时。改完下一局生效。' },
  // ---- 光照与阴影 ----
  { k: 'shadow', g: '光照与阴影', lab: '阴影', t: 'seg', o: [[0, '关闭'], [1024, '低'], [2048, '中'], [4096, '高']], hint: '太阳投影贴图分辨率。关掉能省最多，但会失去脚下的落地感。' },
  { k: 'shadowEvery', g: '光照与阴影', lab: '阴影刷新', t: 'seg', o: [[1, '每帧'], [2, '隔帧'], [3, '每三帧']], hint: '太阳不动、只有人在动，隔帧刷新的滞后可忽略。' },
  { k: 'exposure', g: '光照与阴影', lab: '曝光', t: 'rng', min: 0.5, max: 1.5, step: 0.05, dec: 2, hint: '整屏亮度倍率，在色调映射之后。' },
  { k: 'lamps', g: '光照与阴影', lab: '动态灯光', t: 'rng', min: 0, max: 6, step: 1, dec: 0, hint: '街灯 + 枪口闪光 + BOSS 灯共用的点光源预算。每多一盏，材质着色器就多算一份。' },
  { k: 'clouds', g: '光照与阴影', lab: '云层', t: 'seg', o: [[0, '关闭'], [1, '开启']], hint: '天空盒里的程序化云。' },
  { k: 'bossGlow', g: '光照与阴影', lab: 'BOSS 光效', t: 'seg', o: [[0, '关闭'], [1, '精简'], [2, '完整']], hint: '光环 / 天光柱 / 地面警示环 / 本体粒子。贴脸时这几层面片最吃填充率。' },
  // ---- 后处理 ----
  { k: 'bloom', g: '后处理', lab: '辉光', t: 'seg', o: [[0, '关闭'], [1, '开启']], hint: '强光源溢出成光晕。关掉最省。' },
  { k: 'bloomStrength', g: '后处理', lab: '辉光强度', t: 'rng', min: 0, max: 0.4, step: 0.01, dec: 2 },
  { k: 'bloomThreshold', g: '后处理', lab: '辉光阈值', t: 'rng', min: 1, max: 6, step: 0.1, dec: 1, hint: '亮度超过这条线的像素才发光。调大 = 只有强光源发光，更省。' },
  { k: 'vignette', g: '后处理', lab: '暗角', t: 'rng', min: 0, max: 0.8, step: 0.02, dec: 2 },
  { k: 'grain', g: '后处理', lab: '胶片颗粒', t: 'rng', min: 0, max: 0.05, step: 0.005, dec: 3, hint: '逐帧噪声。看着有质感，但对晕动症不友好，可调 0。' },
  { k: 'fogK', g: '后处理', lab: '雾浓度', t: 'rng', min: 0, max: 2, step: 0.1, dec: 1, hint: '按倍率缩放每张图自带的雾。0 = 通透，看得更远。' },
  { k: 'hurtFx', g: '后处理', lab: '受击视觉', t: 'rng', min: 0, max: 1, step: 0.05, dec: 2, hint: '受伤时的色差、红边与残血脉动。只压表现，不影响伤害与准星。' },
  // ---- 特效 ----
  { k: 'fxDensity', g: '特效', lab: '粒子密度', t: 'seg', o: [[0, '关闭'], [0.35, '少'], [0.7, '中'], [1, '全']], hint: '爆炸、烟尘、血雾的粒子上限倍率。' },
  { k: 'decals', g: '特效', lab: '弹孔上限', t: 'rng', min: 0, max: 200, step: 10, dec: 0, hint: '墙上留多少个弹孔/血渍（超出后覆盖最旧的）。' },
  { k: 'tracers', g: '特效', lab: '曳光上限', t: 'rng', min: 0, max: 48, step: 4, dec: 0 },
  { k: 'ambient', g: '特效', lab: '环境特效', t: 'seg', o: [[0, '关闭'], [1, '开启']], hint: '烟囱排烟、海鸥、飘尘。与战斗无关，关掉最划算。' },
  // ---- 舒适（防晕）----
  { k: 'shake', g: '舒适（防晕）', lab: '镜头震动', t: 'rng', min: 0, max: 1, step: 0.05, dec: 2, hint: '爆炸与近身命中的屏幕晃动。0 = 完全不晃。' },
  { k: 'bob', g: '舒适（防晕）', lab: '行走晃动', t: 'rng', min: 0, max: 1, step: 0.05, dec: 2, hint: '走路时镜头的上下左右摆动。' },
  { k: 'kick', g: '舒适（防晕）', lab: '开枪镜头上抬', t: 'rng', min: 0, max: 1, step: 0.05, dec: 2, hint: '只影响镜头表现，不影响弹道。调 0 后压枪手感会变轻。' },
  // ---- 自动调整 ----
  { k: 'auto', g: '自动调整', lab: '自动调整', t: 'seg', o: [['off', '关闭'], ['conservative', '保守'], ['aggressive', '积极']], hint: '按实测帧率自动降/升负载，落在下面这套阶梯上；帧率回来会原样恢复你的设定。' },
  { k: 'autoTarget', g: '自动调整', lab: '目标帧率', t: 'seg', o: [[30, '30'], [45, '45'], [60, '60'], [90, '90']] },
];

export const GFX_ITEMS = ITEMS;
export const GFX_BY_KEY = Object.fromEntries(ITEMS.map((i) => [i.k, i]));
export const GFX_GROUPS = [...new Set(ITEMS.map((i) => i.g))].map((g) => ({ g, items: ITEMS.filter((i) => i.g === g) }));

// 三档预设。high 就是改造前的默认表现（除舒适项按防晕重新给了初值）。
export const TIERS = {
  low: {
    res: 80, msaa: 0, maxFps: 0, tex: 'low',
    shadow: 0, shadowEvery: 3, exposure: 1, lamps: 0, clouds: 0, bossGlow: 1,
    bloom: 0, bloomStrength: 0.14, bloomThreshold: 3.2, hurtFx: 1, vignette: 0.16, grain: 0, fogK: 1,
    fxDensity: 0.35, decals: 40, tracers: 12, ambient: 0,
    shake: 0.2, bob: 0.4, kick: 0.8,
  },
  medium: {
    res: 100, msaa: 2, maxFps: 0, tex: 'medium',
    shadow: 2048, shadowEvery: 2, exposure: 1, lamps: 5, clouds: 1, bossGlow: 2,
    bloom: 1, bloomStrength: 0.14, bloomThreshold: 3.2, hurtFx: 1, vignette: 0.24, grain: 0.012, fogK: 1,
    fxDensity: 0.7, decals: 120, tracers: 32, ambient: 1,
    shake: 0.45, bob: 0.7, kick: 0.9,
  },
  high: {
    res: 100, msaa: 4, maxFps: 0, tex: 'high',
    shadow: 4096, shadowEvery: 2, exposure: 1, lamps: 6, clouds: 1, bossGlow: 2,
    bloom: 1, bloomStrength: 0.14, bloomThreshold: 3.2, hurtFx: 1, vignette: 0.28, grain: 0.018, fogK: 1,
    fxDensity: 1, decals: 160, tracers: 48, ambient: 1,
    shake: 0.6, bob: 0.85, kick: 1,
  },
};

export const gfxDefaults = (quality) => Object.assign({}, TIERS[quality] || TIERS.high, { auto: 'off', autoTarget: 60 });

// 用户设定 = 档位预设 + 手动微调（老存档缺哪一项就从档位补，永不出现 undefined）
export function userGfx(opts) {
  const d = gfxDefaults(opts.quality);
  const g = opts.gfx || {};
  for (const k in d) if (g[k] !== undefined && g[k] !== null) d[k] = g[k];
  return d;
}

// 自动调整的降载阶梯：级别越高越省。每一项都在用户值之上再压一刀。
export const LEVELS = [
  { n: '你的设定', set: {} },
  { n: '关闭辉光', set: { bloom: 0 } },
  { n: '降分辨率、关抗锯齿', set: { bloom: 0, msaa: 0 }, resK: 0.8 },
  { n: '阴影降到低、砍环境特效', set: { bloom: 0, msaa: 0, shadow: 1024, ambient: 0, fxDensity: 0.7 }, resK: 0.8 },
  { n: '精简弹孔/曳光/灯光', set: { bloom: 0, msaa: 0, shadow: 1024, ambient: 0, fxDensity: 0.7, decals: 60, tracers: 16, lamps: 2, vignette: 0, grain: 0, bossGlow: 1 }, resK: 0.8 },
  { n: '最低负载', set: { bloom: 0, msaa: 0, shadow: 0, ambient: 0, fxDensity: 0.35, decals: 40, tracers: 12, lamps: 0, vignette: 0, grain: 0, bossGlow: 0, clouds: 0, shadowEvery: 3 }, resK: 0.6 },
];
export const LEVEL_MAX = LEVELS.length - 1;

// 降载只会把画质往下压；阴影刷新反过来（数值越大越省）
const cheaper = (k, cur, v) => (k === 'shadowEvery' ? Math.max(cur, v) : Math.min(cur, v));

export function applyLevel(user, level) {
  const out = Object.assign({}, user);
  for (let i = 1; i <= level && i < LEVELS.length; i++) {
    for (const k in LEVELS[i].set) out[k] = cheaper(k, out[k], LEVELS[i].set[k]);
    if (LEVELS[i].resK) out.res = Math.max(45, Math.round(user.res * LEVELS[i].resK));
  }
  out._level = level;
  return out;
}

export const AUTO_FLOOR = { conservative: 3, aggressive: LEVEL_MAX };

// 每 1 秒一个窗口喂进来。同方向连续降载不需要冷却（每降一级画面就更轻，本来就不会抖），
// 但"降完又升、升完又降"必须等冷却过去，否则阈值附近会来回换档闪人眼。
export function autoStep(st, fps, target, mode) {
  const floor = AUTO_FLOOR[mode] || 3;
  const need = mode === 'aggressive' ? 2 : 3;
  const needUp = mode === 'aggressive' ? 6 : 12;
  if (st.cool > 0) st.cool--;
  if (fps < target - 2) { st.bad++; st.good = 0; }
  else if (fps > target + 4) { st.good++; st.bad = 0; }
  else { st.bad = Math.max(0, st.bad - 1); st.good = Math.max(0, st.good - 1); }
  const down = st.level < floor && st.bad >= need;
  const up = st.level > 0 && st.good >= needUp;
  if (!down && !up) return null;
  const dir = down ? 1 : -1;
  if (st.cool > 0 && dir !== st.last) return null;
  st.level += dir; st.bad = 0; st.good = 0; st.last = dir;
  if (dir < 0) st.cool = 4; else st.cool = 0;
  return { level: st.level, dir: dir > 0 ? '降' : '升', name: LEVELS[st.level].n };
}

// 面板上"当前生效"的一行说明
export function describeLevel(level) {
  return level <= 0 ? '未降载' : `第 ${level} 档 · ${LEVELS.slice(1, level + 1).map((l) => l.n).join('，')}`;
}

export function formatItem(it, v) {
  if (it.t === 'seg') { const o = it.o.find((x) => String(x[0]) === String(v)); return o ? o[1] : String(v); }
  return (+v).toFixed(it.dec == null ? 2 : it.dec) + (it.unit || '');
}
