// 核港（唯一的双层图）专用路线回归：node test/nuke-layers.mjs —— 0.6 秒
// 探的是"垂直分层到底成立不成立"：钢梯上不上得去、高架环道能不能一路绕行不落地、
// 平台底下的地面直不直得穿、反应堆坑的门洞是不是唯一入口。
// mapprobe 只按 2D 网格数空格，看不见"撞在栏杆上""料堆堵在平台口"这类真人在玩的路线问题
import { loadMap } from '../server/mapdata.js';
import { moveStep, STAND_H, EYE_STAND } from '../src/movement.js';

const world = loadMap('nuke').world;
const mk = (x, z, y = 0.05) => ({
  pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 },
  radius: 0.36, height: STAND_H, stepHeight: 0.42,
  onGround: true, crouch: false, eyeH: EYE_STAND, jumpCD: 0, yaw: 0,
});
// 直线走 secs 秒，报告终点、最高离地、以及"被顶起/被卡住"的次数（撞墙是预期，只看不判）
function walk(a, wx, wz, secs) {
  let hi = 0, lo = 1e9, blockedFrames = 0;
  for (let i = 0; i < Math.round(secs * 30); i++) {
    moveStep(a, 1 / 30, { wx, wz, jump: false, crouch: false }, world, null);
    hi = Math.max(hi, a.pos.y); lo = Math.min(lo, a.pos.y);
    if (Math.hypot(a.vel.x, a.vel.z) < 0.4) blockedFrames++;
  }
  return { a, hi, lo, blockedFrames };
}
const r = [];
const put = (name, pass, info) => r.push([name, pass, info]);

// ① 北边缘道 → 十级钢梯 → 龙门平台甲板
const s1 = walk(mk(-16, 25.4), 0, -1, 3);
put('钢梯把人送上平台甲板（3.2m）', s1.hi > 3.1 && s1.a.pos.y > 3.1 && Math.abs(s1.a.pos.z) < 20.2, `y ${s1.lo.toFixed(2)}~${s1.hi.toFixed(2)} 终点 ${s1.a.pos.x.toFixed(1)},${s1.a.pos.z.toFixed(1)}`);
// ② 大院侧 → 栈桥楼梯 → 高栈桥
const s2 = walk(mk(-32.6, 0), 1, 0, 3);
put('楼梯把人送上侧向栈桥', s2.hi > 3.1 && s2.a.pos.y > 3.1, `y ${s2.lo.toFixed(2)}~${s2.hi.toFixed(2)} 终点 ${s2.a.pos.x.toFixed(1)},${s2.a.pos.z.toFixed(1)}`);
// ③ 高架成环：栈桥北行 → 缺口 → 北平台，全程不落地、不撞栏
const s3 = walk(mk(-26, -6, 3.2), 0, 1, 5);
put('栈桥 → 北平台 接口通（不落地）', s3.a.pos.z > 15 && s3.lo > 3.0, `z→${s3.a.pos.z.toFixed(1)} 最低 y=${s3.lo.toFixed(2)} 撞停帧=${s3.blockedFrames}`);
// ④ 整条环道一路走到底：北平台西行 → 折向南 → 过西栈桥 → 穿南平台（绕地图半圈不落地）
const s4 = walk(mk(-10, 19.6, 3.2), -1, 0, 4);
const s4b = walk(s4.a, 0, -1, 12);
put('北平台 → 栈桥 → 南平台 连成一路', s4.a.pos.x < -22 && s4b.a.pos.z < -14 && s4b.lo > 3.0,
  `先 x→${s4.a.pos.x.toFixed(1)}，再 z→${s4b.a.pos.z.toFixed(1)}，最低 y=${s4b.lo.toFixed(2)}`);
// ⑤ 楼下地面：从北边缘直穿到南边，全程贴地（顶板 2.9m 不该顶头）
const s5 = walk(mk(4.5, 23.5), 0, -1, 12);
put('平台底下的地面能一路穿到对面', s5.a.pos.z < -14 && s5.hi < 0.6, `z→${s5.a.pos.z.toFixed(1)} 最高离地 ${s5.hi.toFixed(2)}`);
// ⑥ 反证：坑沿 0.9m 挡得住从东面直冲的人，只有南北两道门进得去
const s6 = walk(mk(7.0, 0), -1, 0, 1.5);
put('反应堆坑沿挡住东侧直冲（须走门洞）', s6.a.pos.x > 4.1, `停在 x=${s6.a.pos.x.toFixed(2)}`);
const s7 = walk(mk(0, 6.5), 0, -1, 2);
put('北门洞进得了坑、也能从南门出（原点可站可走）', s7.a.pos.z < -3.6 && s7.hi < 0.6, `z→${s7.a.pos.z.toFixed(2)} 最高 ${s7.hi.toFixed(2)}`);

let bad = 0;
for (const [n, p, i] of r) { if (!p) bad++; console.log(`${p ? 'PASS' : 'FAIL'} ${n} —— ${i}`); }
console.log(bad ? `\n${bad} 项失败` : '\n上下两层都通');
process.exit(bad ? 1 : 0);
