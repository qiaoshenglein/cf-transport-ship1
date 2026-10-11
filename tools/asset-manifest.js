// 资产清单：要建什么模型、给 Tripo 什么提示词、必须带哪些骨骼与动作、怎么算验收合格
//
// 契约来自代码实测（src/character.js:53-60 的 BONES 表、src/bosssize.js 的体型、src/guns.js 的锚点约定）：
//  · 人类骨架 19 骨：hips spine chest neck head / shoulder·upperArm·forearm·hand ×2 / thigh·shin·foot ×2
//  · 引擎当前**没有 AnimationMixer**，姿态是每帧手写的；换 GLB 后要走 mixer，所以动作片段必须自带且名字可识别
//  · Tripo / Mixamo 自动绑定用的是 mixamorig:Hips / LeftArm 这类命名 —— 可以接受，检查按"同义词组"放行
//  · 武器：枪口朝 -Z、上 +Y、原点在握把，锚点节点名 grip / fore / muzzle / eject / magwell（awm 另加 scope）
export const SPEC = {
  version: '2026-10-11',
  prLabel: { P0: '先做（BOSS）', P1: '第二批', P2: '第三批', P3: '有余力再做' },
  cats: { boss: 'BOSS', mon: '怪物', sol: '人类角色', wp: '武器', prop: '道具' },
  // 骨名同义词组：任意一组命中即算该骨存在（大小写不敏感、子串匹配）
  RIGS: {
    humanoid: [
      { label: 'hips', alt: ['hips', 'pelvis', 'waist'] },
      { label: 'spine', alt: ['spine', 'abdomen', 'back'] },
      { label: 'chest', alt: ['chest', 'thorax', 'spine1', 'spine2'] },
      { label: 'neck', alt: ['neck', 'cervical'] },
      { label: 'head', alt: ['head', 'skull'] },
      { label: 'arm(上臂)', alt: ['upperarm', 'arm', 'shoulderpad'] },
      { label: 'forearm(前臂)', alt: ['forearm', 'lowerarm'] },
      { label: 'hand', alt: ['hand', 'palm'] },
      { label: 'thigh(大腿)', alt: ['thigh', 'upleg', 'upperleg'] },
      { label: 'shin(小腿)', alt: ['shin', 'lowerleg', 'calf', 'leg'] },
      { label: 'foot', alt: ['foot', 'ankle'] },
    ],
    // 怪物允许缺锁骨/手指这类细节，只要求主干 + 四肢
    monster: [
      { label: 'hips', alt: ['hips', 'pelvis'] }, { label: 'spine', alt: ['spine'] },
      { label: 'chest', alt: ['chest', 'spine1'] }, { label: 'head', alt: ['head', 'skull'] },
      { label: 'arm', alt: ['arm', 'upperarm', 'clavicle'] }, { label: 'forearm', alt: ['forearm', 'lowerarm'] },
      { label: 'hand', alt: ['hand'] }, { label: 'thigh', alt: ['thigh', 'upleg'] },
      { label: 'shin', alt: ['shin', 'calf', 'leg'] }, { label: 'foot', alt: ['foot'] },
    ],
    none: [],
  },
  // 动作同义词组：键是清单里写的"语义动作名"，值是可接受的 clip 名片段
  CLIPS: {
    idle: ['idle', 'stand', 'breath'],
    run: ['run', 'jog', 'sprint'],
    walk: ['walk'],
    attack: ['attack', 'melee', 'swing', 'slash', 'hit'],
    shoot: ['shoot', 'fire', 'aim', 'recoil'],
    skill: ['skill', 'charge', 'slam', 'cast', 'barrage', 'summon', 'teleport', 'blink', 'special', 'ability'],
    death: ['death', 'die', 'dying', 'defeat'],
    hurt: ['hurt', 'hit_react', 'flinch', 'reaction'],
  },
};

const A = (a) => a;
export const ASSETS = [
  // ================= P0：BOSS 三件套（用户指定优先） =================
  A({
    id: 'boss_tyran', name: '铁皮暴君', cat: 'boss', p: 'P0', slot: 'LOOKS.tyran → dressSoldier',
    use: '生化模式第三个 BOSS：冲锋 + 震地重击。当前是"士兵模型 + 装甲配件 + 非等比压扁"，换独立模型后轮廓才有压迫感。',
    spec: {
      h: 3.5, w: 2.2, d: 2.0, tol: 0.15, tris: [18000, 60000], texMax: 2048, rig: 'monster',
      clips: ['idle', 'run', 'attack', 'skill', 'death'],
      rows: [['世界身高', '3.5 m（当前 SIZE.h 1.95 × 人体基准，导出请保持真实米制、1 单位 = 1 米）'],
        ['锚点', '脚底中心为原点（Y=0 在地面），面朝 -Z'],
        ['材质', '至少分 3 个材质槽：装甲 metal / 血肉 flesh / 发光 emissive（引擎会原地改 emissive 做技能预警）'],
        ['不要', '不要手持枪械（引擎对 tyran 走 hideGun，近战爪要直接做进模型）']],
    },
    prompts: [
      {
        text: 'Game-ready boss monster: a hulking humanoid brute in battered industrial power armour, 3.5 metres tall, massively overdeveloped right arm ending in a riveted steel gauntlet and piston knuckles, hunched sloped back with exhaust vents and hydraulic hoses, dented grey-green armour plates over dark oily flesh, one glowing amber reactor core embedded in the chest, heavy clawed feet, no weapon in hand, menacing forward-leaning silhouette, single subject, T-pose, front-facing, clean silhouette, PBR texture, game-ready topology',
        note: '中文对照：重工业装甲巨汉，右臂夸张粗大并带钢制巨爪，胸口嵌一枚琥珀色反应堆核心（技能预警要发光）。' },
      {
        text: 'Alternative (更"铁皮"味，可选第二版对比): a grotesque bio-mechanical juggernaut, rusted welded steel plating bolted directly into scarred flesh, exposed rebar spine, steam leaking from shoulder joints, one huge hammer-fist arm, glowing orange seams between armour plates, hulking low stance, single character, T-pose, PBR, game-ready',
        note: '备选方向：把装甲"焊死在肉上"，用于和第一版比轮廓辨识度。两版都生成，验收时留一版。' },
    ],
    tips: ['Tripo 里选 Character + 自动绑定（Auto Rigify）；若绑定后骨名是 mixamorig 系也没关系，代码侧做名字映射',
      '冲锋与震地是两个不同技能：skill 片段建议做"低头蓄力→双臂砸地"，charge 用 run 加速前倾代替',
      '面数参考值 6 万以内（同屏最多 32 只怪 + 玩家，BOSS 还要跑 30Hz 服务端）——工作台不卡这道门槛，超了照样收，接入时按同屏总三角面与实测帧率判，',
      '导出 GLB 时勾选 Include textures / PBR，不要 Draco 压缩（我们这边解码链路还没做）',
      '脚底务必贴地：引擎按 root.position 落在地面上，模型悬空或陷地都会露馅'],
    manual: ['缩略图在 3 米外仍能一眼认出是"暴君"（轮廓优先于细节）', '装甲与血肉的分界清楚，方便我们做受击部位高亮',
      '没有多余穿插的破面、手指数量不明显畸形', '发光部分只在胸口/缝隙，不是全身糊光（会打爆辉光）'],
  }),
  A({
    id: 'boss_mother', name: '瘟疫母体', cat: 'boss', p: 'P0', slot: 'LOOKS.mother → dressSoldier',
    use: '生化模式 BOSS：酸液齐射 + 死亡分裂。需要明显的"可打部位"（背上的囊泡），齐射时我们要按骨名挂粒子。',
    spec: {
      h: 4.0, w: 2.6, d: 2.4, tol: 0.15, tris: [18000, 60000], texMax: 2048, rig: 'monster',
      clips: ['idle', 'attack', 'skill', 'death', 'hurt'],
      rows: [['世界身高', '4.0 m（当前 SIZE.h 2.20，三只里最高）'],
        ['锚点', '脚底中心原点，面朝 -Z'],
        ['材质', '3 槽：甲壳 shell / 肿胀血肉 flesh / 酸液囊 sac（emissive，齐射前会整体亮起）'],
        ['注意', '这只会持霰弹枪（引擎挂 in chest 骨）——建议把武器直接做进模型的双手持握姿态']],
    },
    prompts: [
      {
        text: 'Game-ready boss monster: a bloated plague matriarch, four metres tall, swollen translucent belly and back crammed with glowing green acid sacs, cracked chitinous plates, weeping sores, a hunched priestess-like head with no eyes, one arm fused into a rusted heavy shotgun, long clawed fingers, sickly yellow-green and bone-white palette, wet emissive pustules, intimidating symmetrical silhouette, single subject, T-pose, front-facing, PBR texture, game-ready topology',
        note: '中文对照：肿胀的瘟疫母体，背与腹布满发绿光的酸液囊，一只手臂已与锈蚀的重型霰弹枪长在一起（省掉挂枪对齐问题）。' },
    ],
    tips: ['"齐射"是往天空/前方连续喷吐：skill 片段做"仰身、腹部囊泡鼓起再收缩"最有效',
      'death 片段很重要：这只会"死亡分裂"，倒地 + 囊泡破裂的动作我们要接粒子和镜头',
      '囊泡的发光要集中在少数几处，整只全身自发光会把辉光通道糊成一团白（这个坑已经踩过）',
      '如果自动绑定把腹部做成一根骨，考虑接受——我们用 mixer 播放，不依赖逐骨 IK'],
    manual: ['远看能分清它和暴君（一胖一壮，轮廓不能撞）', '囊泡分布在前胸/背两侧，方便我们在不同骨上挂特效',
      '没有细如发丝的飘带（低画质下会闪）'],
  }),
  A({
    id: 'boss_shade', name: '幽影猎手', cat: 'boss', p: 'P0', slot: 'LOOKS.shade → dressSoldier',
    use: '生化模式 BOSS：瞬移突袭。当前用"瘦长比例 + 冷色"区分，独立模型要把它做成真正不同的物种。',
    spec: {
      h: 3.2, w: 1.3, d: 1.3, tol: 0.15, tris: [14000, 45000], texMax: 2048, rig: 'monster',
      clips: ['idle', 'run', 'attack', 'skill', 'death'],
      rows: [['世界身高', '3.2 m，但体型极瘦（w/d 只有 1.3）'],
        ['锚点', '脚底中心原点，面朝 -Z'],
        ['材质', '3 槽：暗影甲 shadow-armor / 布条 wrap / 冷光 cyan-emissive（瞬移时整体拉一道残影）'],
        ['不要', '不要枪械（shade 也走 hideGun，靠爪与瞬移）']],
    },
    prompts: [
      {
        text: 'Game-ready boss monster: a gaunt spectral assassin, three metres tall and unnaturally thin, elongated limbs with too many joints, tattered dark wraps and lightweight obsidian armour, a blank porcelain mask with a single vertical cyan glowing slit, long blade-like claws, trailing smoke ribbons around the feet, cold blue-violet and near-black palette with sharp cyan emissive accents, predatory hunched stance, single subject, T-pose, front-facing, PBR texture, game-ready topology',
        note: '中文对照：枯瘦的幽影刺客，四肢过长、关节反常，戴一具只有一道青色竖光的白瓷面具，脚下拖烟带。' },
    ],
    tips: ['瞬移（blink）我们靠代码做位移 + 残影，模型只需要一个"消散/凝实"的 skill 片段（身体微前倾、双臂内收）',
      '布条/飘带数量要克制：引擎每帧 updateMatrixWorld(true) 是热路径，飘带多了同屏掉帧',
      '青色发光只给面具缝与爪刃，别全身发光',
      '这只最考验"瘦高轮廓"，如果 Tripo 出的人形太壮，宁可加一版提示词强调 emaciated / skeletal'],
    manual: ['和另外两只在剪影阶段就能区分（壮 / 胖 / 瘦长）', '面具是视觉焦点，正面远看可见',
      '没有大面积半透明材质（我们没开透明排序，会穿帮）'],
  }),
  // ================= P1：三类怪 + 人类士兵 =================
  A({
    id: 'mon_infected', name: '感染体（小怪）', cat: 'mon', p: 'P1', slot: 'LOOKS.infected',
    use: '怪海里的主力，同屏可达 20~30 只。这只的预算最紧：好看是其次，便宜 + 轮廓清楚才是第一位。',
    spec: {
      h: 1.9, w: 0.9, d: 0.9, tol: 0.2, tris: [3000, 9000], texMax: 1024, rig: 'monster',
      clips: ['idle', 'run', 'attack', 'death'],
      rows: [['世界身高', '1.9 m'], ['面数参考', '9000 上下（同屏 20+ 只；不卡门槛，接入时按同屏总量判）'], ['材质', '2 槽：皮肉 / 破布；引擎会按只换色调，别做太花的贴图'],
        ['动作', 'run 要"蹒跚前扑"感，death 要能直接倒地不弹起']],
    },
    prompts: [
      {
        text: 'Game-ready low-poly zombie grunt: a shambling infected worker, 1.9 metres tall, grey-green necrotic skin, torn coverall rags, head tilted forward, one arm hanging and dragging, slightly hunched sprint posture, subtle bioluminescent veins on the neck, empty white eyes, readable silhouette, single subject, T-pose, front-facing, PBR texture, optimized game-ready topology',
        note: '中文对照：穿破烂工装的蹒感染者，颈部有微弱发光血管，眼白无瞳。' },
    ],
    tips: ['这是数量最多的资产，同屏 20+ 只，面数与贴图尺寸心里有数就行，细节可以后续用材质补',
      '引擎会给不同个体换色（tint），所以身体主色要中性（灰绿/土色），不要做成品位极端的颜色',
      'death 片段建议"前扑倒地"，因为我们按受击方向播'],
    manual: ['在 20 米外与人类士兵一眼可分', '没有薄片状飘带（数量多会闪）'],
  }),
  A({
    id: 'mon_heavy', name: '重装暴徒', cat: 'mon', p: 'P1', slot: 'LOOKS.heavy',
    use: '高血量挡子弹的"肉盾怪"，需要一眼看出"要打很久"。',
    spec: {
      h: 2.3, w: 1.5, d: 1.3, tol: 0.2, tris: [6000, 14000], texMax: 1024, rig: 'monster',
      clips: ['idle', 'run', 'attack', 'death', 'hurt'],
      rows: [['世界身高', '2.3 m'], ['材质', '3 槽：装甲 / 皮肉 / 金属件'], ['动作', 'hurt 很重要——它挨打多，需要一个明显的"被打到往后顶一下"的反应']],
    },
    prompts: [
      {
        text: 'Game-ready heavy enemy: a massive infected bruiser, 2.3 metres tall, improvised armour bolted over mutated muscle — car-door shoulder plate, welded steel chest slab, rebar braces, one huge arm ending in a spiked gauntlet, pale bruised skin with dark veins, hulking wide stance, intimidating bulk, single subject, T-pose, front-facing, PBR texture, game-ready topology',
        note: '中文对照：把车门、钢板、钢筋焊在变异肌肉上的重装暴徒，一只手臂是钉刺巨爪。' },
    ],
    tips: ['"临时拼装的装甲"比"制式装甲"更有故事感，也和 BOSS 暴君的制式工业装甲区分开',
      '面数比感染体高一档，参考 1.4 万左右（不卡门槛）'],
    manual: ['装甲上有明显可辨认的"弱点"区域（缝隙/锈穿），方便我们做爆头/弱点判定视觉暗示'],
  }),
  A({
    id: 'mon_shooter', name: '游荡射手', cat: 'mon', p: 'P1', slot: 'LOOKS.shooter',
    use: '远程怪，会站着开枪。需要上半身稳定的瞄准姿态。',
    spec: {
      h: 1.85, w: 0.9, d: 0.9, tol: 0.2, tris: [3000, 9000], texMax: 1024, rig: 'monster',
      clips: ['idle', 'run', 'shoot', 'death'],
      rows: [['世界身高', '1.85 m'], ['动作', 'shoot 片段要"双手据枪、后坐一下"，我们会按射击节奏循环它'],
        ['注意', '如果模型自带手枪/步枪更好；否则引擎会把枪挂在 chest 骨上，位置可能不贴手']],
    },
    prompts: [
      {
        text: 'Game-ready ranged enemy: a gaunt infected marksman, 1.85 metres tall, decayed skin stretched over bone, tattered hooded tactical vest, holding an old hunting rifle against the shoulder with both hands, unnaturally steady posture, faint glowing amber eyes, elongated fingers on the trigger hand, lean silhouette, single subject, aiming pose facing -Z, PBR texture, game-ready topology',
        note: '中文对照：枯瘦的感染者神射手，戴破旧战术背心兜帽，双手据着一支老式猎枪做瞄准姿态。' },
    ],
    tips: ['这只直接生成"持枪瞄准姿态"最省事（枪做进模型），否则挂枪对不齐手会很难看',
      'shoot 片段用后坐 + 退壳节奏，别做完整换弹（换弹我们靠停火时间表现）'],
    manual: ['兜帽不遮脸到看不出朝向（我们要判断它有没有对准玩家）'],
  }),
  A({
    id: 'sol_human', name: '人类士兵（BL / GR 通用底模）', cat: 'sol', p: 'P1', slot: 'character.js Soldier（19 骨）',
    use: '真人玩家与机器人的身体。这只最敏感：骨骼必须严格对齐引擎的 19 骨命名，否则持枪 IK 与命中盒全错位。',
    spec: {
      h: 1.8, w: 0.6, d: 0.4, tol: 0.08, tris: [9000, 20000], texMax: 1024, rig: 'humanoid',
      clips: ['idle', 'run', 'walk', 'shoot', 'attack', 'death', 'hurt'],
      rows: [['世界身高', '1.8 m（STAND_H=1.8，容差压到 ±8%）'],
        ['骨骼', '必须含：hips / spine / chest / neck / head / 左右 shoulder·upperArm·forearm·hand / 左右 thigh·shin·foot（mixamorig 前缀可接受，代码做映射）'],
        ['硬约束', '上臂 0.29 m、前臂 0.28 m、hips 离地 0.98 m（character.js 里写死的 IK 长度，比例差太多手会够不到枪）'],
        ['材质', '2 槽：制服（会被队伍色染色）/ 装备带与护具（保持原色）']],
    },
    prompts: [
      {
        text: 'Game-ready soldier character: an athletic mercenary in modern tactical gear, 1.8 metres tall, neutral grey uniform with plate carrier, knee pads, gloves, boots, utility belt and thigh holster, head with a plain ballistic helmet and goggles (face intentionally simple, no insignia, no faction colours), arms out in a clean A-pose, symmetrical proportions, single subject, front-facing, PBR texture, game-ready topology',
        note: '中文对照：中性灰制服的现代佣兵，A-pose，无阵营色无徽章（队伍色由引擎染），面部简化。' },
    ],
    tips: ['**A-pose 或 T-pose 必须标准**，斜下 45° 的手臂会让我们的 IK 与挂枪点全错',
      '不要给模型做持枪姿势——枪是引擎实时挂上去的，模型要空手',
      '制服部分要"纯色易染色"，花纹太重会盖住队伍色（BL 红 / GR 蓝）',
      '这只可以最后做：先拿 BOSS 验证整条 GLB 链路，再回来看人类模型值不值得换'],
    manual: ['四肢比例接近真实（我们按 0.29/0.28 的臂长做 IK）', '头盔/护目镜轮廓在 20 米外仍可辨',
      '没有披风、长飘带等会穿模的部件'],
  }),
  // ================= P2：武器与关键道具 =================
  A({
    id: 'wp_bossclaw', name: '撕裂巨爪（BOSS 专属近战）', cat: 'wp', p: 'P2', slot: 'guns.js bossclaw + viewmodel 第一人称',
    use: '附身 BOSS 后玩家手里的唯一武器，第一人称出镜率极高，现在的程序化模型最露怯。',
    spec: {
      h: 0, w: 0, d: 0, tris: [2500, 8000], texMax: 1024, rig: 'none', clips: [],
      rows: [['真实尺寸', '整爪长约 0.9 m（第一人称会占屏一角，太大挡视野）'],
        ['原点/朝向', '原点在握把上方，刃尖朝 -Z，上方向 +Y（引擎全局约定）'],
        ['锚点节点', '必须有命名空物体：grip / muzzle（近战只用这两个）'],
        ['子网格名', '第一人称要能单独动：保留 bolt 或 blade 命名的子网格']],
    },
    prompts: [
      {
        text: 'Game-ready weapon asset: a monstrous bio-mechanical claw gauntlet, riveted dark steel plates over pale bone spurs, three long curved talons with a faint heat-glow edge, worn leather and tendon straps inside, sized to be worn on one forearm, isolated object, no character, no hand, three-quarter view, PBR texture, game-ready topology',
        note: '中文对照：套在前臂上的骨刺钢爪，三根长弯刃带微微灼光。只要武器本体，不要手。' },
    ],
    tips: ['Tripo 生成"孤立物体"时容易附带一只手 —— 提示词里明确 no hand / no character，否则第一人称会多出一只怪手',
      '刃口不要全身发光，第一人称 + 辉光会把屏幕糊白'],
    manual: ['刃尖方向与模型 -Z 一致（不然挥砍方向反了）', '没有比 5 mm 更薄的悬空结构（会闪）'],
  }),
  A({
    id: 'wp_ak47', name: 'AK-47（步枪）', cat: 'wp', p: 'P2', slot: 'guns.js ak47（第三人称 + 第一人称共用）',
    use: '默认主武器，出镜率最高的一把。',
    spec: {
      h: 0, w: 0, d: 0, tris: [2000, 6000], texMax: 1024, rig: 'none', clips: [],
      rows: [['真实尺寸', '全长约 0.88 m'], ['原点/朝向', '原点在握把上方，枪口朝 -Z，上 +Y'],
        ['锚点节点', 'grip / fore / muzzle / eject / magwell 全部必备（弹壳从 eject 出、准星视线从 muzzle 起）'],
        ['子网格名', '保留 bolt（拉机柄）与 mag（弹匣），第一人称换弹动画靠它们']],
    },
    prompts: [
      {
        text: 'Game-ready weapon asset: a well-worn AK-47 assault rifle, laminated wood stock and handguard with chipped edges, matte parkerized steel receiver, curved 30-round magazine, slight scratches and dust, no sling, isolated object, no hands, side profile with a slight three-quarter angle, PBR texture, game-ready topology',
        note: '中文对照：磨损的木护木 AK-47，钢制机匣有擦痕，无背带，孤立物体。' },
    ],
    tips: ['武器类资产建议用 Tripo 的"图生 3D"：先找一张干净的 AK 侧视图，比纯文字更准',
      '生成后如果枪管是弯的/机匣糊成一团，直接退回——武器细节玩家天天看，容忍度最低',
      '务必确认它没有把弹匣做成透明或与护木融合'],
    manual: ['锚点节点齐全（工作台会自动列出缺哪个）', '枪口在模型最前端的 -Z 方向上', '拉机柄/弹匣是独立子网格'],
  }),
  A({
    id: 'wp_m4a1', name: 'M4A1（步枪）', cat: 'wp', p: 'P2', slot: 'guns.js m4a1',
    use: '保卫者阵营主武器，与 AK 成对。',
    spec: { h: 0, w: 0, d: 0, tris: [2000, 6000], texMax: 1024, rig: 'none', clips: [],
      rows: [['真实尺寸', '全长约 0.84 m（枪托展开）'], ['原点/朝向', '原点在握把上方，枪口朝 -Z，上 +Y'],
        ['锚点节点', 'grip / fore / muzzle / eject / magwell'], ['子网格名', 'mag + bolt（或 carryhandle 可省）']] },
    prompts: [
      {
        text: 'Game-ready weapon asset: a modern M4A1 carbine, flat dark earth polymer stock and handguard, rail with a simple flip-up sight, black anodized receiver, straight STANAG magazine, minimal wear, no optic, no sling, isolated object, no hands, three-quarter side view, PBR texture, game-ready topology',
        note: '中文对照：沙色聚合物枪托的 M4A1，不装光学瞄具。' },
    ],
    tips: ['与 AK 用同一套生成参数（同分辨率同光照），两把枪摆在一起才不会风格割裂'],
    manual: ['握把位置与 AK 接近（第一人称挂点表 HIP 才能复用手感）'],
  }),
  A({
    id: 'wp_awm', name: 'AWM（狙击）', cat: 'wp', p: 'P2', slot: 'guns.js awm（多一个 scope 锚点）',
    use: '开镜武器：瞄具光轴必须与相机视线一致，否则开镜后弹道与准心不重合。',
    spec: { h: 0, w: 0, d: 0, tris: [2500, 7000], texMax: 1024, rig: 'none', clips: [],
      rows: [['真实尺寸', '全长约 1.2 m'], ['锚点节点', 'grip / fore / muzzle / eject / magwell / **scope**（scope 必须在瞄具目镜中心，开镜相机贴到这里）'],
        ['子网格名', 'bolt（枪机拉柄，拉栓动画靠它）']] },
    prompts: [
      {
        text: 'Game-ready weapon asset: a heavy bolt-action sniper rifle with a green-grey chassis, large tactical scope mounted high on a rail, bipod folded under the fore-end, thick recoil pad, muzzle brake, isolated object, no hands, three-quarter view, PBR texture, game-ready topology',
        note: '中文对照：绿灰枪托的重型狙击枪，高位战术瞄具，两脚架收起。' },
    ],
    tips: ['**scope 锚点是这只的关键**：导入后在工作台里看节点列表，没有 scope 就退回',
      '瞄具镜片不要做半透明（我们没开透明排序），用深色不透明即可'],
    manual: ['瞄具光轴与枪管平行且明显高于机匣', '枪机拉柄是独立子网格'],
  }),
  A({
    id: 'wp_m3', name: 'M3 霰弹枪', cat: 'wp', p: 'P2', slot: 'guns.js m3',
    use: '一发射 8 颗弹丸，枪口面积大，弹道起点视觉最敏感。',
    spec: { h: 0, w: 0, d: 0, tris: [2000, 6000], texMax: 1024, rig: 'none', clips: [],
      rows: [['真实尺寸', '全长约 1.0 m'], ['锚点节点', 'grip / fore / muzzle / eject / magwell（muzzle 要在两个枪口管之间靠前的位置）'],
        ['子网格名', 'pump（护木，泵动动画靠它）']] },
    prompts: [
      {
        text: 'Game-ready weapon asset: a classic pump-action combat shotgun, blued steel twin barrels, ribbed sliding fore-end, pistol grip and short stock, red bead sight, worn wood grain, isolated object, no hands, three-quarter view, PBR texture, game-ready topology',
        note: '中文对照：双管泵动战斗霰弹枪，带肋滑动护木。' },
    ],
    tips: ['把护木做成可独立移动的网格（pump），否则泵动时整把枪会一起前后抖'],
    manual: ['枪口位置明显、不被护木遮挡'],
  }),
  A({
    id: 'wp_mp5', name: 'MP5（冲锋枪）', cat: 'wp', p: 'P2', slot: 'guns.js mp5',
    use: '游荡射手与部分玩家用枪。',
    spec: { h: 0, w: 0, d: 0, tris: [1800, 5000], texMax: 1024, rig: 'none', clips: [],
      rows: [['真实尺寸', '全长约 0.68 m'], ['锚点节点', 'grip / fore / muzzle / eject / magwell'], ['子网格名', 'mag + bolt']] },
    prompts: [
      {
        text: 'Game-ready weapon asset: a compact submachine gun with a curved magazine, black polymer body, slim tubular stock, ring sights, slight scuffing on the edges, isolated object, no hands, three-quarter view, PBR texture, game-ready topology',
        note: '中文对照：弧形弹匣的紧凑型冲锋枪。' },
    ],
    tips: ['如果预算紧，武器这一批可以只做 AK / M4 / 狙击三把，其余继续用程序化模型'],
    manual: ['机匣没有和弹匣融合', '准星不挡枪口方向'],
  }),
  // ================= P3：有余力再做 =================
  A({
    id: 'wp_knife', name: '军刀', cat: 'wp', p: 'P3', slot: 'guns.js knife',
    use: '默认近战，玩家最常看到的一把（切枪/奔跑时握在手里）。',
    spec: { h: 0, w: 0, d: 0, tris: [800, 2500], texMax: 512, rig: 'none', clips: [],
      rows: [['真实尺寸', '全长约 0.32 m'], ['锚点节点', 'grip / muzzle（近战只有这两个；muzzle 放在刃尖）']] },
    prompts: [
      {
        text: 'Game-ready weapon asset: a black tactical combat knife, clip-point blade with a partial serrated spine, textured rubber grip, small crossguard, sheath not included, isolated object, no hands, three-quarter view, PBR texture, game-ready topology',
        note: '中文对照：黑色战术匕首，带部分锯齿背，不含刀鞘。' },
    ],
    tips: ['刃尖要放在 muzzle 锚点上，挥砍特效与命中判定都从那里出'],
    manual: ['没有刀鞘（第一人称会穿帮）'],
  }),
  A({
    id: 'prop_supplies', name: '补给箱三件套（弹药 / 医疗 / 护甲）+ 空投', cat: 'prop', p: 'P3', slot: '客户端补给渲染（src/supplies.js 坐标）',
    use: 'PVE 里玩家抢着拿的东西，现在是小方块 + 颜色，做成有辨识度的箱体能让"哪个是补给"一眼看清。',
    spec: { h: 0.55, w: 0.55, d: 0.55, tol: 0.4, tris: [400, 2000], texMax: 512, rig: 'none', clips: ['idle'],
      rows: [['真实尺寸', '约 0.55 m 见方（引擎按 0.55m 判定与渲染）'], ['数量', '4 个变体：弹药箱 / 医疗箱 / 护甲箱 / 空投舱'],
        ['要求', '顶面留出明显的标识区（我们贴阵营色发光），不要做完整闭合盖（打开动画要能掀盖）']] },
    prompts: [
      {
        text: 'Game-ready prop set: three small military supply crates and one airdrop pod, distinct silhouettes — ammo crate with bandolier stencil, medical case with a cross relief, armour case with ceramic plate texture, airdrop pod with parachute housing on top; worn olive drab metal with bright safety-colour accents, isolated objects, no characters, front three-quarter view, PBR texture, game-ready low-poly',
        note: '中文对照：三种补给箱 + 一个空投舱，橄榄绿金属 + 高饱和安全色标识。' },
    ],
    tips: ['一次生成 4 个物体时 Tripo 容易把它们粘在一起——建议逐个生成，或生成后确认是 4 个独立网格',
      '箱体不要自带强烈自发光，我们用引擎的发光脉冲表现"可拾取"'],
    manual: ['四个变体在 15 米外仅凭轮廓就能区分', '顶面标识区平整（我们要贴动态标签）'],
  }),
];

// 武器锚点：引擎硬约定（src/guns.js 按节点名取挂点），集中声明避免七条条目各写一遍
const GUN_ANCHORS = ['grip', 'fore', 'muzzle', 'eject', 'magwell'];
for (const a of ASSETS) {
  if (a.cat !== 'wp') continue;
  a.spec.anchors = a.id === 'wp_awm' ? GUN_ANCHORS.concat('scope')
    : a.id === 'wp_knife' || a.id === 'wp_bossclaw' ? ['grip', 'muzzle'] : GUN_ANCHORS;
}

// 导入侧的统一工作流（Tripo 直接出"带动画的 GLB"这一条路径）
export const WORKFLOW = [
  'Tripo 生成角色时开自动绑定（Auto Rigify），再到动画库里按下面每项列出的英文名逐条挂动作，一次导出一个 .glb（勾选 Include textures，不要 Draco 压缩）。',
  '骨名与 clip 名不用迁就我们：mixamorig:LeftUpLeg、Idle_001、Humanoid Running 这类都能自动对上关键词；真的对不上（比如只叫 Take 001）会标黄，在条目下方的「动作名映射」里逐个指认实际 clip 名即可，映射会存进本地库并随验收单一起导出。',
  '高度对不上不再退回：工作台会按目标高度等比例缩放（原始尺寸与缩放系数都写进验收单，方便判断是不是整体走形）。只有差 10 倍以上才判失败——那通常是导出单位或场景缩放坏了，不是模型比例问题。',
  '把 .glb 拖进右侧预览：尺寸会按真实米制核对（脚底贴地、旁边立 1.8m 参照人形），骨骼与动作两项机器直接判定；面数只给参考、不卡门槛。',
  '验收结论在本页"待验收 → 合格/退回"里点，最后用右上角"导出验收单"发我 JSON（含实测数据与退回理由），我按单子接进引擎。',
];
