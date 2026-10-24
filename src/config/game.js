/**
 * 游戏主线配置（设计文档第 15 节「开局成长阶梯」）。当前做到阶段 1：洞府开门。
 *
 *  - starters  开局角色：剑修或法修，资质中等且固定，1 条属性型天赋，不随机
 *  - enemies   敌人模板：三维 = base + growth × 等级，与玩家角色同一套公式
 *  - stages    引导关第一段：1-4 是卡关点，单人很难过、两人能过
 *  - exp/gold  击杀经验与金币
 *  - recruit   洞府招募（抽卡）：首抽免费且保底互补定位；品质决定资质区间和天赋条数
 *  - research  研究：只有「上阵位」一条，每级 +1，从 1 到 5；研究占用一个角色
 *  - auto      自动推关
 *
 * 开局角色和招募角色规则完全相同，没有主角特殊逻辑。
 * 只有普攻 + 固有主动：不插技能卡、不选 2选1（固有主动固定用 A 分支）、没有被动卡槽。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  DAO.CONFIG.game = {
    saveVersion: 2,

    // ===== 开局角色 =====
    starters: {
      sword: {
        role: 'sword', title: '剑修',
        desc: '近战物理。力量高、气血厚，只能先打前排；前排倒下后才能打到后排。',
        base: { str: 14, agi: 10, int: 4 },
        growth: { str: 3.0, agi: 2.0, int: 0.8 },   // 每级加的三维（成长资质，中等）
        innate: 'jianqizhan', branch: 0,             // 剑气斩·单：单体 ×2.2，CD 2
        talents: [{ id: 'li', roll: 0.5 }],          // 力拔 +10%
      },
      mage: {
        role: 'mage', title: '法修',
        desc: '远程法术。智力高、气血薄，可以打任意目标，连珠火弹射多次。',
        base: { str: 4, agi: 10, int: 14 },
        growth: { str: 0.8, agi: 2.0, int: 3.0 },
        innate: 'lianzhuhuo', branch: 0,             // 连珠火·散：弹射 4 次，逐跳 ×0.75，CD 2
        talents: [{ id: 'zhi', roll: 0.5 }],         // 慧根 +10%
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
        name: '灰狼', role: 'beast', basic: 'beast', innate: 'pounce', branch: 0,
        base: { str: 5, agi: 8, int: 1 }, growth: { str: 2.0, agi: 1.4, int: 0.4 },
        hpMul: 0.5, exp: 1.0, gold: 1.0, talents: [],
      },
      boar: {
        name: '野猪', role: 'beast', basic: 'beast', innate: 'gore', branch: 0,
        base: { str: 7, agi: 3, int: 1 }, growth: { str: 2.2, agi: 0.9, int: 0.4 },
        hpMul: 0.85, exp: 1.5, gold: 1.5, talents: [],
      },
      stoneboar: {
        name: '石甲猪', role: 'beast', basic: 'beast', innate: 'gore', branch: 0,
        base: { str: 9, agi: 3, int: 1 }, growth: { str: 2.4, agi: 0.9, int: 0.4 },
        hpMul: 1.6, exp: 3.0, gold: 3.0, talents: [{ id: 'tiepi', roll: 1 }],
      },
      fox: {
        name: '狐妖', role: 'demon', basic: 'demon', innate: 'foxfire', branch: 0,
        base: { str: 2, agi: 9, int: 6 }, growth: { str: 0.5, agi: 1.5, int: 1.8 },
        hpMul: 0.45, exp: 1.5, gold: 1.5, talents: [],
      },
      shanxiao: {
        name: '山魈', title: '首领', role: 'beast', basic: 'beast', innate: 'shanxiao', branch: 0, boss: true,
        base: { str: 10, agi: 6, int: 3 }, growth: { str: 2.4, agi: 1.4, int: 0.8 },
        hpMul: 2.6, exp: 6.0, gold: 10.0, talents: [{ id: 'tiepi', roll: 0.5 }],
      },
    },

    // ===== 引导关第一段 =====
    // 每关 enemies: [{ enemyId, level, row }]。
    // 1-4 是卡关点：前排石甲猪血厚、后排两只狐妖远程。剑修单人被狐妖磨死，法修单人被石甲猪顶死。
    // 1-4 第一次战败时开放洞府（招募 + 研究）。
    chapter: { id: 'qingshi', name: '青石山', desc: '引导关第一段' },
    stages: [
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
    ],

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
      names: ['云渺', '沈烛', '陆青', '顾长川', '萧寒', '林岫', '白鹭', '江离', '谢沉', '苏晚', '叶澄', '温衡',
        '韩樵', '裴雪', '楚歌', '秦岳', '方岩', '宋清', '许溪', '唐苇', '段云', '凌霄', '易水', '洛川'],
    },

    // ===== 研究（设计文档第 13 节）：只做「上阵位」 =====
    research: {
      slots: {
        name: '上阵位',
        start: 1, max: 5,
        // 升到第 N 级（= N 个上阵位）的花费与时长（秒）
        levels: {
          2: { gold: 20, sec: 60 },
          3: { gold: 120, sec: 240 },
          4: { gold: 400, sec: 600 },
          5: { gold: 1200, sec: 1800 },
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
    },

    // ===== 存档迁移 =====
    migration: {
      v1StartGold: 60,       // 阶段 0 存档迁移时补的金币（阶段 0 没有金币）
    },
  };

  // 播放节奏（毫秒，1× 速度）。V0 播放器、战斗回放和后台计时共用。
  DAO.CONFIG.playback = { action: 700, round: 250, start: 400, trigger: 300, end: 0 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
