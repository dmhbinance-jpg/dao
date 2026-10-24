/**
 * 游戏主线配置（设计文档第 15 节「开局成长阶梯」）。当前做到阶段 3：采集灵矿 + 锻造装备。
 *
 *  - starters  开局角色：剑修或法修，资质中等且固定，1 条与本门标签匹配的天赋（阶段 2 起由属性型改为标签型），不随机
 *  - enemies   敌人模板：三维 = base + growth × 等级，与玩家角色同一套公式
 *  - chapters  引导关：第一段青石山（1-4 卡关，单人难过、两人能过）、第二段黑风林（首领狐王，第一张卡能解）
 *  - cards     技能卡：第一张卡、卡池、掉落率、招募自带卡
 *  - gather    采集：闲置角色派去采灵矿，按秒连续产出（力资质越高越快），不补离线
 *  - forge     锻造房：灵矿 + 金币即时打造白装（武器 / 胸甲 / 戒指 × 下品 / 中品 / 上品）
 *  - exp/gold  击杀经验与金币
 *  - recruit   洞府招募（抽卡）：首抽免费且保底互补定位；品质决定资质区间和天赋条数
 *  - research  研究：只有「上阵位」一条，每级 +1，从 1 到 5；研究占用一个角色
 *  - auto      自动推关
 *
 * 开局角色和招募角色规则完全相同，没有主角特殊逻辑。
 * 每个角色：普攻 + 固有主动（固定 A 分支，2选1 不做）+ 1 个主动卡槽（阶段 2 起）；没有被动卡槽。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  DAO.CONFIG.game = {
    saveVersion: 4,

    // ===== 开局角色 =====
    starters: {
      sword: {
        role: 'sword', title: '剑修', art: 'unit.sword',
        desc: '近战物理。力量高、气血厚，只能先打前排；前排倒下后才能打到后排。',
        base: { str: 14, agi: 10, int: 4 },
        growth: { str: 3.0, agi: 2.0, int: 0.8 },   // 每级加的三维（成长资质，中等）
        innate: 'jianqizhan', branch: 0,             // 剑气斩·单：单体 ×2.2，CD 2
        talents: [{ id: 'jianxin', roll: 0.5 }],     // 剑心：剑系伤害 +13%（和剑系卡标签匹配）
      },
      mage: {
        role: 'mage', title: '法修', art: 'unit.mage',
        desc: '远程法术。智力高、气血薄，可以打任意目标，连珠火弹射多次。',
        base: { str: 4, agi: 10, int: 14 },
        growth: { str: 0.8, agi: 2.0, int: 3.0 },
        innate: 'lianzhuhuo', branch: 0,             // 连珠火·散：弹射 4 次，逐跳 ×0.75，CD 2
        talents: [{ id: 'huoling', roll: 0.5 }],     // 火灵：火系伤害 +13%（和火系卡标签匹配）
      },
    },
    startLevel: 1,
    maxLevel: 30,

    // ===== 角色与上阵 =====
    roster: {
      cap: 12,                                     // 角色名额上限（设计文档第 6 节：起步 12）
      defaultRow: { sword: 'front', mage: 'back' }, // 上阵 2 人以上时的默认站位
    },

    // ===== 敌人模板 =====
    // exp / gold：每级击杀奖励基数（实际 = 基数 × 敌人等级 × killMul）
    enemies: {
      wolf: {
        art: 'enemy.wolf', name: '灰狼', role: 'beast', basic: 'beast', innate: 'pounce', branch: 0,
        base: { str: 5, agi: 8, int: 1 }, growth: { str: 2.0, agi: 1.4, int: 0.4 },
        hpMul: 0.5, exp: 1.0, gold: 1.0, talents: [],
      },
      boar: {
        art: 'enemy.boar', name: '野猪', role: 'beast', basic: 'beast', innate: 'gore', branch: 0,
        base: { str: 7, agi: 3, int: 1 }, growth: { str: 2.2, agi: 0.9, int: 0.4 },
        hpMul: 0.85, exp: 1.5, gold: 1.5, talents: [],
      },
      stoneboar: {
        art: 'enemy.stoneboar', name: '石甲猪', role: 'beast', basic: 'beast', innate: 'gore', branch: 0,
        base: { str: 9, agi: 3, int: 1 }, growth: { str: 2.4, agi: 0.9, int: 0.4 },
        hpMul: 1.6, exp: 3.0, gold: 3.0, talents: [{ id: 'tiepi', roll: 1 }],
      },
      fox: {
        art: 'enemy.fox', name: '狐妖', role: 'demon', basic: 'demon', innate: 'foxfire', branch: 0,
        base: { str: 2, agi: 9, int: 6 }, growth: { str: 0.5, agi: 1.5, int: 1.8 },
        hpMul: 0.45, exp: 1.5, gold: 1.5, talents: [],
      },
      shanxiao: {
        art: 'enemy.shanxiao', name: '山魈', title: '首领', role: 'beast', basic: 'beast', innate: 'shanxiao', branch: 0, boss: true,
        base: { str: 10, agi: 6, int: 3 }, growth: { str: 2.4, agi: 1.4, int: 0.8 },
        hpMul: 2.6, exp: 6.0, gold: 10.0, talents: [{ id: 'tiepi', roll: 0.5 }],
      },
      blackwolf: {
        art: 'enemy.blackwolf', name: '黑风狼', role: 'beast', basic: 'beast', innate: 'pounce', branch: 0,
        base: { str: 7, agi: 10, int: 1 }, growth: { str: 2.3, agi: 1.6, int: 0.4 },
        hpMul: 0.6, exp: 1.3, gold: 1.3, talents: [],
      },
      ironbear: {
        art: 'enemy.ironbear', name: '铁背熊', role: 'beast', basic: 'beast', innate: 'gore', branch: 0,
        base: { str: 10, agi: 4, int: 1 }, growth: { str: 2.6, agi: 1.0, int: 0.4 },
        hpMul: 1.6, dmgUp: 0.8, exp: 2.5, gold: 2.5, talents: [{ id: 'tiepi', roll: 0.5 }],
      },
      redfox: {
        art: 'enemy.redfox', name: '赤狐', role: 'demon', basic: 'demon', innate: 'foxfire', branch: 0,
        base: { str: 2, agi: 10, int: 8 }, growth: { str: 0.5, agi: 1.6, int: 2.2 },
        hpMul: 0.55, dmgUp: 0.8, exp: 2.0, gold: 2.0, talents: [],
      },
      bearking: {
        // 首领：前排硬抗，靠「山啸」群伤；没有特殊机制，就是皮厚伤高——考验装备。
        art: 'enemy.bearking', name: '铁背熊王', title: '首领', role: 'beast', basic: 'beast', innate: 'shanxiao', branch: 0, boss: true,
        base: { str: 12, agi: 6, int: 2 }, growth: { str: 2.8, agi: 1.2, int: 0.6 },
        hpMul: 3.0, dmgUp: 1.0, exp: 10.0, gold: 15.0, talents: [{ id: 'tiepi', roll: 1 }],
      },
      foxking: {
        // 首领机制：躲在后排、开场护盾；「妖风阵」让其他妖兽护甲 / 法抗 +60（不加自己）。本体血薄、伤害高——先越过前排打掉它最划算。
        art: 'enemy.foxking', name: '黑风狐王', title: '首领', role: 'demon', basic: 'demon', innate: 'yaofengzhen', branch: 0, boss: true,
        base: { str: 4, agi: 10, int: 10 }, growth: { str: 0.8, agi: 1.6, int: 4.0 },
        hpMul: 0.5, dmgUp: 2.5, exp: 8.0, gold: 12.0, talents: [{ id: 'yaofeng', roll: 1 }],
      },
    },

    // ===== 引导关第一段 =====
    // 每关 enemies: [{ enemyId, level, row }]。
    // 1-4 是卡关点：前排石甲猪血厚、后排两只狐妖远程。剑修单人被狐妖磨死，法修单人被石甲猪顶死。
    // 1-4 第一次战败时开放洞府（招募 + 研究）。
    chapters: [{ id: 'qingshi', name: '青石山', desc: '引导关第一段', stages: [
      { id: '1-1', name: '山道', note: '1 打 1',
        enemies: [{ enemyId: 'wolf', level: 1, row: 'front' }] },
      { id: '1-2', name: '林边', note: '1 打 1',
        enemies: [{ enemyId: 'boar', level: 2, row: 'front' }] },
      { id: '1-3', name: '狼迹', note: '1 打 2',
        enemies: [{ enemyId: 'wolf', level: 2, row: 'front' }, { enemyId: 'wolf', level: 2, row: 'front' }] },
      { id: '1-4', name: '石甲关', note: '前排硬怪挡着后排远程', gate: true,
        enemies: [{ enemyId: 'stoneboar', level: 4, row: 'front' }, { enemyId: 'fox', level: 3, row: 'back' }, { enemyId: 'fox', level: 3, row: 'back' }] },
      { id: '1-5', name: '狐影', note: '前排两狼，后排一狐',
        enemies: [{ enemyId: 'wolf', level: 6, row: 'front' }, { enemyId: 'wolf', level: 6, row: 'front' }, { enemyId: 'fox', level: 6, row: 'back' }] },
      { id: '1-6', name: '狼群', note: '三只灰狼',
        enemies: [{ enemyId: 'wolf', level: 7, row: 'front' }, { enemyId: 'wolf', level: 7, row: 'front' }, { enemyId: 'wolf', level: 7, row: 'front' }] },
      { id: '1-7', name: '猪突', note: '野猪带狼，后排一狐',
        enemies: [{ enemyId: 'boar', level: 7, row: 'front' }, { enemyId: 'wolf', level: 7, row: 'front' }, { enemyId: 'fox', level: 7, row: 'back' }] },
      { id: '1-8', name: '狐巢', note: '两只狐妖在后排',
        enemies: [{ enemyId: 'boar', level: 8, row: 'front' }, { enemyId: 'fox', level: 8, row: 'back' }, { enemyId: 'fox', level: 8, row: 'back' }] },
      { id: '1-9', name: '石林', note: '石甲猪又来了',
        enemies: [{ enemyId: 'stoneboar', level: 8, row: 'front' }, { enemyId: 'wolf', level: 8, row: 'front' }, { enemyId: 'fox', level: 8, row: 'back' }] },
      { id: '1-10', name: '群狼', note: '四只妖兽',
        enemies: [{ enemyId: 'wolf', level: 9, row: 'front' }, { enemyId: 'wolf', level: 9, row: 'front' }, { enemyId: 'wolf', level: 9, row: 'front' }, { enemyId: 'fox', level: 9, row: 'back' }] },
      { id: '1-11', name: '妖林', note: '前后各两只',
        enemies: [{ enemyId: 'stoneboar', level: 8, row: 'front' }, { enemyId: 'wolf', level: 8, row: 'front' }, { enemyId: 'fox', level: 8, row: 'back' }, { enemyId: 'fox', level: 8, row: 'back' }] },
      { id: '1-12', name: '山魈', note: '首领', boss: true,
        enemies: [{ enemyId: 'shanxiao', level: 10, row: 'front' }, { enemyId: 'wolf', level: 9, row: 'front' }, { enemyId: 'wolf', level: 9, row: 'front' }] },
    ] },
    // 第二段：小怪会掉技能卡（见 cards.drops）。首领狐王躲在后排、开场自带大护盾，
    // 剑修的穿云剑（优先打后排）和法修的火雨（打整个后排）正好能越过前排打到它。
    { id: 'heifeng', name: '黑风林', desc: '引导关第二段', stages: [
      { id: '2-1', name: '林口', note: '黑风狼出没',
        enemies: [{ enemyId: 'blackwolf', level: 16, row: 'front' }, { enemyId: 'blackwolf', level: 16, row: 'front' }, { enemyId: 'fox', level: 16, row: 'back' }] },
      { id: '2-2', name: '风穴', note: '野猪带狼',
        enemies: [{ enemyId: 'boar', level: 17, row: 'front' }, { enemyId: 'wolf', level: 17, row: 'front' }, { enemyId: 'fox', level: 17, row: 'back' }] },
      { id: '2-3', name: '狐群', note: '两只狐妖在后排',
        enemies: [{ enemyId: 'wolf', level: 20, row: 'front' }, { enemyId: 'fox', level: 20, row: 'back' }, { enemyId: 'fox', level: 20, row: 'back' }] },
      { id: '2-4', name: '石阵', note: '两只石甲猪',
        enemies: [{ enemyId: 'stoneboar', level: 14, row: 'front' }, { enemyId: 'stoneboar', level: 14, row: 'front' }, { enemyId: 'fox', level: 14, row: 'back' }] },
      { id: '2-5', name: '狼嚎', note: '三只黑风狼',
        enemies: [{ enemyId: 'blackwolf', level: 18, row: 'front' }, { enemyId: 'blackwolf', level: 18, row: 'front' }, { enemyId: 'blackwolf', level: 18, row: 'front' }] },
      { id: '2-6', name: '妖风', note: '前后各两只',
        enemies: [{ enemyId: 'stoneboar', level: 16, row: 'front' }, { enemyId: 'wolf', level: 16, row: 'front' }, { enemyId: 'fox', level: 16, row: 'back' }, { enemyId: 'fox', level: 16, row: 'back' }] },
      { id: '2-7', name: '林深', note: '五只妖兽',
        enemies: [{ enemyId: 'blackwolf', level: 15, row: 'front' }, { enemyId: 'boar', level: 15, row: 'front' }, { enemyId: 'blackwolf', level: 15, row: 'front' }, { enemyId: 'fox', level: 15, row: 'back' }, { enemyId: 'fox', level: 15, row: 'back' }] },
      { id: '2-8', name: '黑风狐王', note: '首领：躲在后排给前排加甲', boss: true,
        enemies: [{ enemyId: 'stoneboar', level: 13, row: 'front' }, { enemyId: 'stoneboar', level: 13, row: 'front' }, { enemyId: 'foxking', level: 15, row: 'back' }] },
    ] },
    // 第三段：敌人皮厚、伤害高（铁背熊、赤狐），只靠等级追得很慢，打一套中档白装才顺。
    { id: 'tieyan', name: '铁岩谷', desc: '引导关第三段 · 该打装备了', stages: [
      { id: '3-1', name: '谷口', note: '两只铁背熊挡路',
        enemies: [{ enemyId: 'ironbear', level: 18, row: 'front' }, { enemyId: 'ironbear', level: 18, row: 'front' }, { enemyId: 'redfox', level: 18, row: 'back' }] },
      { id: '3-2', name: '赤狐坡', note: '后排两只赤狐',
        enemies: [{ enemyId: 'blackwolf', level: 19, row: 'front' }, { enemyId: 'ironbear', level: 19, row: 'front' }, { enemyId: 'redfox', level: 19, row: 'back' }, { enemyId: 'redfox', level: 19, row: 'back' }] },
      { id: '3-3', name: '熊穴', note: '该去打装备了',
        enemies: [{ enemyId: 'ironbear', level: 19, row: 'front' }, { enemyId: 'ironbear', level: 19, row: 'front' }, { enemyId: 'redfox', level: 19, row: 'back' }, { enemyId: 'redfox', level: 19, row: 'back' }] },
      { id: '3-4', name: '乱石', note: '五只妖兽',
        enemies: [{ enemyId: 'stoneboar', level: 19, row: 'front' }, { enemyId: 'ironbear', level: 19, row: 'front' }, { enemyId: 'blackwolf', level: 19, row: 'front' }, { enemyId: 'redfox', level: 19, row: 'back' }, { enemyId: 'redfox', level: 19, row: 'back' }] },
      { id: '3-5', name: '赤焰林', note: '三只赤狐',
        enemies: [{ enemyId: 'ironbear', level: 20, row: 'front' }, { enemyId: 'blackwolf', level: 20, row: 'front' }, { enemyId: 'redfox', level: 20, row: 'back' }, { enemyId: 'redfox', level: 20, row: 'back' }, { enemyId: 'redfox', level: 20, row: 'back' }] },
      { id: '3-6', name: '熊群', note: '三只铁背熊',
        enemies: [{ enemyId: 'ironbear', level: 20, row: 'front' }, { enemyId: 'ironbear', level: 20, row: 'front' }, { enemyId: 'ironbear', level: 20, row: 'front' }, { enemyId: 'redfox', level: 20, row: 'back' }] },
      { id: '3-7', name: '铁岩', note: '五只妖兽',
        enemies: [{ enemyId: 'ironbear', level: 21, row: 'front' }, { enemyId: 'ironbear', level: 21, row: 'front' }, { enemyId: 'blackwolf', level: 21, row: 'front' }, { enemyId: 'redfox', level: 21, row: 'back' }, { enemyId: 'redfox', level: 21, row: 'back' }] },
      { id: '3-8', name: '铁背熊王', note: '首领：皮糙肉厚', boss: true,
        enemies: [{ enemyId: 'bearking', level: 21, row: 'front' }, { enemyId: 'ironbear', level: 20, row: 'front' }, { enemyId: 'redfox', level: 20, row: 'back' }, { enemyId: 'redfox', level: 20, row: 'back' }] },
    ] }],

    // ===== 技能卡（设计文档第 8 节） =====
    // 散卡在背包里没有数值；插卡时才掷一条主数值（档位 0–100）。同名卡再插 = 重掷，自动择优；换别的卡 = 旧卡销毁。
    cards: {
      firstCardStage: '1-12',                          // 第一段首领首次通关固定掉落
      firstCard: { sword: 'chuanyun', mage: 'huoyu' },  // 按开局角色定位：剑修剑系卡、法修火系卡
      pool: { sword: ['chuanyun', 'jianqi', 'zhenshe'], mage: ['huoyu', 'liuhuo', 'lieyan'] },
      drops: {
        chapters: ['heifeng'],   // 哪些章节的小怪掉卡
        perKill: {
          same: 0.10,            // 每击杀一只：掉一张「已插在角色身上的卡」的同名卡（用来重掷）
          other: 0.09,          // 每击杀一只：从两种定位的卡池里随机掉一张
        },
        bossKills: false,        // 首领本身不掉随机卡
      },
      recruitCard: true,         // 拿到第一张卡之后，新招募的角色自带一张按天赋倾向随机的卡（已插好、已掷数值）
    },

    // ===== 经验 =====
    exp: {
      base: 10,              // 升到下一级所需经验 = round(base × 等级 ^ power)
      power: 1.6,
      killMul: 3.0,          // 击杀经验 = 敌人模板 exp × 敌人等级 × killMul
      lossKeepsKills: true,  // 战败时已击杀的敌人照样给经验和金币
      split: false,          // false：每个上阵角色都拿全额；true：上阵角色平分
    },

    // ===== 金币 =====
    gold: {
      killMul: 3.0,          // 击杀金币 = 敌人模板 gold × 敌人等级 × killMul
      start: 0,
    },

    // ===== 洞府招募（抽卡，设计文档第 11 节） =====
    recruit: {
      unlockStage: '1-4',    // 在这一关第一次战败时开放洞府（招募 + 研究）
      firstFree: true,       // 新手首抽免费
      firstComplement: true, // 首抽保底出与开局角色互补的定位
      dailyFirstCost: 100,   // 之后每日首次 100 金
      costMul: 1.5,          // 每次 ×1.5，次日重置
      levelOffset: -1,       // 招募角色等级 = 当前最高等级角色 + levelOffset（最低 1 级）
      roles: ['sword', 'mage'],
      roleWeights: { sword: 1, mage: 1 },
      // 品质：决定成长资质区间（相对开局角色的成长倍率）、天赋条数、能否出触发型天赋
      qualities: {
        white:  { name: '凡品', weight: 50, growthMul: [0.80, 0.98], talents: [1, 1], trigger: false },
        blue:   { name: '良品', weight: 35, growthMul: [0.92, 1.08], talents: [1, 2], trigger: false },
        yellow: { name: '上品', weight: 12, growthMul: [1.02, 1.18], talents: [2, 3], trigger: true },
        orange: { name: '极品', weight: 3,  growthMul: [1.12, 1.30], talents: [3, 3], trigger: true },
      },
      // 天赋档位权重（设计文档第 6 节：属性型约 60%、标签型约 30%、触发型约 10%，触发型仅稀有品质、每角色最多一条）
      tierWeights: { stat: 60, tag: 30, trigger: 10 },
      excludeTalents: ['renxin'], // 治疗类天赋：第一版没有治疗技能
      innatePool: { sword: ['jianqizhan', 'liuying'], mage: ['lianzhuhuo', 'chiyan'] },
      firstExcludeInnates: ['liuying'], // 首抽不出「流影」（穿透、优先打后排），保证「剑修打不到后排」的教学成立
      extraGuideStage: '2-3',           // 第二段这一关首次通关后，引导一次额外招募（花金币）
      names: ['云渺', '沈烛', '陆青', '顾长川', '萧寒', '林岫', '白鹭', '江离', '谢沉', '苏晚', '叶澄', '温衡',
        '韩樵', '裴雪', '楚歌', '秦岳', '方岩', '宋清', '许溪', '唐苇', '段云', '凌霄', '易水', '洛川'],
    },

    // ===== 研究（设计文档第 13 节）：只做「上阵位」 =====
    research: {
      slots: {
        name: '上阵位',
        start: 1, max: 5,
        stageCap: 3,           // 当前阶段最多研究到第几级（阶段 2：第 3 级可选，不是通关必需）
        // 升到第 N 级（= N 个上阵位）的花费与时长（秒）
        levels: {
          2: { gold: 20, sec: 60 },
          3: { gold: 3500, sec: 600 },  // 阶段 2 的主要金币出口（可选）
          4: { gold: 6000, sec: 600 },
          5: { gold: 15000, sec: 1800 },
        },
        intSpeedPerPoint: 0.01, // 研究者每点智力让研究快 1%（时长 ÷ (1 + 智 × 0.01)）
      },
    },

    // ===== 自动推关 =====
    auto: {
      defaultOn: true,
      stopBeforeBoss: true,  // 首领关第一次挑战前停下来等确认
      stopAtGuides: true,    // 新系统开放的引导停下来等确认
    },

    // ===== 采集（设计文档第 10 节：不分班次，按秒连续产出） =====
    // 采集中的角色不能上阵、不能研究、不拿经验。离线不计算：关掉页面期间的产出不补。
    gather: {
      unlockChapter: 'heifeng',  // 这一段通关后开放采集和锻造房，并在第三段开头引导
      oreName: '灵矿',
      perSec: 1.0,               // 资质系数 1.0 的角色每秒产出
      refStrGrowth: 3.0,         // 资质系数 = 力成长 ÷ 3.0（开局剑修 = 1.0）
      minFactor: 0.5,            // 资质系数下限（法修力成长低，也不至于完全没用）
    },

    // ===== 锻造房：灵矿 + 金币即时打造白装，不占角色，不做建筑升级 =====
    forge: {
      slots: ['weapon', 'chest', 'ring'],
      slotNames: { weapon: '武器', chest: '胸甲', ring: '戒指' },
      tierNames: ['下品', '中品', '上品'],
      // 每个部位三档：词条固定，档位越高数值越高、花费越多。
      recipes: {
        weapon: { art: 'gear.weapon', name: '白铁兵刃', desc: '加攻击（物攻、法攻同时加）', tiers: [{ atk: 12 }, { atk: 24 }, { atk: 40 }] },
        chest: { art: 'gear.chest', name: '白铁甲', desc: '加护甲和气血', tiers: [{ armor: 12, hp: 150 }, { armor: 24, hp: 300 }, { armor: 40, hp: 500 }] },
        ring: { art: 'gear.ring', name: '白玉戒', desc: '加一项三维（打造时选力 / 敏 / 智）', stats: ['str', 'agi', 'int'], tiers: [{ value: 6 }, { value: 12 }, { value: 20 }] },
      },
      costs: [
        { ore: 20, gold: 500 },
        { ore: 50, gold: 1300 },
        { ore: 120, gold: 3000 },
      ],
      guideSlot: 'weapon',       // 锻造引导打的第一件
      guideTier: 0,
      hintTier: 1,               // 活动条提示按「中品」判断够不够
      stuckGuideChapters: ['tieyan'], // 这些章节在最新关第一次战败时排队「该去打装备了」引导（灵矿和金币够了才弹出）
    },

    // ===== 默认设置 =====
    settings: {
      cardPrompts: true,     // 拿到卡、背包里有可重掷的同名卡时，自动推关停下来提示
      forgeHints: true,      // 灵矿够打下一件装备时在活动条提示（不打断推关）
    },

    // ===== 挂机 / 战斗计时 =====
    idle: {
      speed: 2,              // 后台战斗（挂机刷关）按 2× 播放速度计时
      gapMs: 1500,           // 两场之间的间隔
    },

    // ===== 时长估算（命令行验证用） =====
    estimate: {
      watchSpeed: 2,         // 推新关的战斗按 2× 观看
      overheadMs: 4000,      // 每场推关战斗的阅读 / 点击时间（全自动玩家为 0）
      guideMs: 8000,         // 每个引导的阅读 / 确认时间
      forgeMs: 5000,         // 标准玩家每打造 / 穿上一件装备的操作时间
    },

    // ===== 存档迁移 =====
    migration: {
      v1StartGold: 60,       // 阶段 0 存档迁移时补的金币（阶段 0 没有金币）
    },
  };

  // 播放节奏（毫秒，1× 速度）。V0 播放器、战斗回放和后台计时共用。
  // 回放节奏（1× 速度下每一拍的毫秒数，按根事件类型）；只影响播放，不影响战斗结果
  DAO.CONFIG.playback = { battleStart: 400, roundStart: 250, action: 700, battleEnd: 0 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
