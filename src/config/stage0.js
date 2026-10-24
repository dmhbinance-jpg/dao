/**
 * 阶段 0 配置：单角色起步（设计文档第 15 节「开局成长阶梯」第 0 级）。
 *
 *  - starters  开局角色：剑修或法修，资质中等且固定，1 条属性型天赋，不随机
 *  - enemies   敌人模板：三维 = base + growth × 等级，与玩家角色同一套公式
 *  - stages    引导关第一段：线性关卡链，1 打 1 → 1 打 2 → 1 打 3 → 首领
 *  - exp       经验曲线与击杀经验
 *  - idle      挂机：已通关的关卡自动重复
 *
 * 开局角色和其他角色规则完全相同，没有主角特殊逻辑。
 * 阶段 0 只有普攻 + 固有主动：不插技能卡、不选 2选1（固有主动固定用 A 分支）、没有被动卡槽。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  DAO.CONFIG.stage0 = {
    saveVersion: 1,

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
        growth: { str: 0.8, agi: 2.0, int: 3.2 },
        innate: 'lianzhuhuo', branch: 0,             // 连珠火·散：弹射 4 次，逐跳 ×0.75，CD 2
        talents: [{ id: 'zhi', roll: 0.5 }],         // 慧根 +10%
      },
    },
    startLevel: 1,
    maxLevel: 20,

    // ===== 敌人模板 =====
    // exp：每级击杀经验基数（实际经验 = exp × 等级 × exp.killMul）
    enemies: {
      wolf: {
        name: '灰狼', role: 'beast', basic: 'beast', innate: 'pounce', branch: 0,
        base: { str: 5, agi: 8, int: 1 }, growth: { str: 2.0, agi: 1.4, int: 0.4 },
        hpMul: 0.5, exp: 1.0, talents: [],
      },
      boar: {
        name: '野猪', role: 'beast', basic: 'beast', innate: 'gore', branch: 0,
        base: { str: 7, agi: 3, int: 1 }, growth: { str: 2.2, agi: 0.9, int: 0.4 },
        hpMul: 0.85, exp: 1.5, talents: [],
      },
      fox: {
        name: '狐妖', role: 'demon', basic: 'demon', innate: 'foxfire', branch: 0,
        base: { str: 2, agi: 9, int: 6 }, growth: { str: 0.5, agi: 1.5, int: 1.8 },
        hpMul: 0.45, exp: 1.5, talents: [],
      },
      shanxiao: {
        name: '山魈', title: '首领', role: 'beast', basic: 'beast', innate: 'shanxiao', branch: 0, boss: true,
        base: { str: 10, agi: 6, int: 3 }, growth: { str: 2.4, agi: 1.4, int: 0.8 },
        hpMul: 2.6, exp: 6.0, talents: [{ id: 'tiepi', roll: 0.5 }],
      },
    },

    // ===== 引导关第一段 =====
    // 每关 enemies: [{ enemyId, level, row }]。玩家一人站前排。
    // 剑修是近战：凡是有后排的关，前排都放得下手（前排倒下后后排暴露），不会卡死。
    chapter: { id: 'qingshi', name: '青石山', desc: '引导关第一段' },
    stages: [
      { id: '1-1', name: '山道', note: '1 打 1',
        enemies: [{ enemyId: 'wolf', level: 1, row: 'front' }] },
      { id: '1-2', name: '林边', note: '1 打 1',
        enemies: [{ enemyId: 'boar', level: 2, row: 'front' }] },
      { id: '1-3', name: '狼迹', note: '1 打 2',
        enemies: [{ enemyId: 'wolf', level: 2, row: 'front' }, { enemyId: 'wolf', level: 2, row: 'front' }] },
      { id: '1-4', name: '狐影', note: '1 打 2：前排挡着后排',
        enemies: [{ enemyId: 'wolf', level: 3, row: 'front' }, { enemyId: 'fox', level: 3, row: 'back' }] },
      { id: '1-5', name: '狼群', note: '1 打 3',
        enemies: [{ enemyId: 'wolf', level: 3, row: 'front' }, { enemyId: 'wolf', level: 3, row: 'front' }, { enemyId: 'wolf', level: 3, row: 'front' }] },
      { id: '1-6', name: '猪突', note: '1 打 3',
        enemies: [{ enemyId: 'boar', level: 4, row: 'front' }, { enemyId: 'wolf', level: 4, row: 'front' }, { enemyId: 'fox', level: 4, row: 'back' }] },
      { id: '1-7', name: '狐巢', note: '1 打 3：两只在后排',
        enemies: [{ enemyId: 'boar', level: 6, row: 'front' }, { enemyId: 'fox', level: 6, row: 'back' }, { enemyId: 'fox', level: 6, row: 'back' }] },
      { id: '1-8', name: '山魈', note: '首领', boss: true,
        enemies: [{ enemyId: 'shanxiao', level: 8, row: 'front' }] },
    ],

    // ===== 经验 =====
    exp: {
      // 升到下一级所需经验 = round(base × 等级 ^ power)
      base: 10,
      power: 1.6,
      killMul: 2.0,          // 击杀经验 = 敌人模板 exp × 敌人等级 × killMul
      lossKeepsKills: true, // 战败时已击杀的敌人照样给经验
    },

    // ===== 挂机 =====
    idle: {
      speed: 2,            // 挂机战斗按 2× 播放速度计时
      gapMs: 1500,         // 两场之间的间隔
    },

    // ===== 时长估算（命令行验证用） =====
    estimate: {
      manualSpeed: 2,      // 假设玩家手动战斗用 2× 观看
      overheadMs: 4000,    // 每场手动战斗的阅读 / 点击时间
    },
  };

  // 播放节奏（毫秒，1× 速度）。V0 播放器、阶段 0 回放和挂机计时共用。
  DAO.CONFIG.playback = { action: 700, round: 250, start: 400, trigger: 300, end: 0 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
