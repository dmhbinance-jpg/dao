/**
 * 技能原语与技能卡（设计文档第 8 节）。
 *
 * 技能 = 原语组合：伤害 + 形状、增益、减益、治疗、推拉条、护盾。
 * 字段说明：
 *   shape    : single | front | back | all | bounce
 *   range    : melee | ranged    近战单体只能打前排；pierce=true 可越过前排（刺客）
 *   dmgType  : physical | magic | heal | none
 *   mult     : 技能倍率（卡牌插入时掷出，见 roll）
 *   cd       : 按角色自己的行动次数计
 *   tags     : 7 个标签之一，形状标签由引擎按 shape 自动补
 *   targetRule : default(随机) | lowestHp | backRow | highestAtk
 *   effects  : [{ kind, ... }]  kind ∈ buff | debuff | heal | shield | push | pull | guard | taunt
 *              target ∈ self | target | allies | row | enemies | hitTargets
 *   bounces / bounceDecay : 弹射次数与衰减
 *
 * 2选1 分支只改参数、形状和标签，永远不新增 AI 行为。
 *
 * 第一版只有剑修（近战物理）和法修（远程法术）。体修、丹修、阵修及其专属技能 / 技能卡已在阶段 0 删除。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});
  const T = DAO.TAGS;

  // ---------- 普攻（随定位固定） ----------
  DAO.CONFIG.basicSkills = {
    sword: { id: 'basic_sword', name: '剑击', shape: 'single', range: 'melee', dmgType: 'physical', mult: 1.0, cd: 0, tags: [T.PHYSICAL, T.SWORD] },
    mage: { id: 'basic_mage', name: '火弹', shape: 'single', range: 'ranged', dmgType: 'magic', mult: 0.9, cd: 0, tags: [T.MAGIC, T.FIRE] },
    // ---- 敌人（阶段 0）----
    beast: { id: 'basic_beast', name: '撕咬', shape: 'single', range: 'melee', dmgType: 'physical', mult: 1.0, cd: 0, tags: [T.PHYSICAL] },
    demon: { id: 'basic_demon', name: '妖火', shape: 'single', range: 'ranged', dmgType: 'magic', mult: 1.0, cd: 0, tags: [T.MAGIC, T.FIRE] },
  };

  // ---------- 固有主动（随定位 / 角色固定，带一次 2选1） ----------
  // key = 角色 innate id；variants[0]=A，variants[1]=B
  DAO.CONFIG.innateSkills = {
    // 后排刺客剑修：越过前排刺后排
    liuying: {
      id: 'liuying', name: '流影',
      variants: [
        { name: '流影·刺', shape: 'single', range: 'melee', pierce: true, targetRule: 'backRow', dmgType: 'physical', mult: 2.4, cd: 2, tags: [T.PHYSICAL, T.SWORD] },
        { name: '流影·扫', shape: 'front', range: 'melee', dmgType: 'physical', mult: 1.3, cd: 2, tags: [T.PHYSICAL, T.SWORD] },
      ],
    },
    // 弹射法修
    lianzhuhuo: {
      id: 'lianzhuhuo', name: '连珠火',
      variants: [
        { name: '连珠火·散', shape: 'bounce', range: 'ranged', dmgType: 'magic', mult: 1.0, bounces: 4, bounceDecay: 0.75, cd: 2, tags: [T.MAGIC, T.FIRE] },
        { name: '连珠火·落', shape: 'back', range: 'ranged', dmgType: 'magic', mult: 1.2, cd: 2, tags: [T.MAGIC, T.FIRE] },
      ],
    },
    // 单体法修
    chiyan: {
      id: 'chiyan', name: '赤焰',
      variants: [
        { name: '赤焰·凝', shape: 'single', range: 'ranged', dmgType: 'magic', mult: 2.4, cd: 2, tags: [T.MAGIC, T.FIRE] },
        { name: '赤焰·燎', shape: 'back', range: 'ranged', dmgType: 'magic', mult: 1.1, cd: 2, tags: [T.MAGIC, T.FIRE] },
      ],
    },
    // 前排剑修（文档例子：剑气斩 A 单体×2.2，B 前排×1.2）
    jianqizhan: {
      id: 'jianqizhan', name: '剑气斩',
      variants: [
        { name: '剑气斩·单', shape: 'single', range: 'melee', dmgType: 'physical', mult: 2.2, cd: 2, tags: [T.PHYSICAL, T.SWORD] },
        { name: '剑气斩·横', shape: 'front', range: 'melee', dmgType: 'physical', mult: 1.2, cd: 2, tags: [T.PHYSICAL, T.SWORD] },
      ],
    },
    // 名将（剑修）
    pojun: {
      id: 'pojun', name: '破军',
      variants: [
        { name: '破军·斩', shape: 'single', range: 'melee', dmgType: 'physical', mult: 2.6, cd: 2, tags: [T.PHYSICAL] },
        { name: '破军·扫', shape: 'all', range: 'melee', dmgType: 'physical', mult: 1.0, cd: 2, tags: [T.PHYSICAL] },
      ],
    },

    // ---- 敌人（阶段 0，只有一个变体）----
    pounce: { id: 'pounce', name: '扑击', variants: [
      { name: '扑击', shape: 'single', range: 'melee', dmgType: 'physical', mult: 1.6, cd: 2, tags: [T.PHYSICAL] }] },
    gore: { id: 'gore', name: '冲撞', variants: [
      { name: '冲撞', shape: 'single', range: 'melee', dmgType: 'physical', mult: 1.4, cd: 2, tags: [T.PHYSICAL],
        effects: [{ kind: 'pull', target: 'hitTargets', value: 250 }] }] },
    foxfire: { id: 'foxfire', name: '狐火', variants: [
      { name: '狐火', shape: 'single', range: 'ranged', dmgType: 'magic', mult: 1.7, cd: 2, tags: [T.MAGIC, T.FIRE] }] },
    shanxiao: { id: 'shanxiao', name: '裂山', variants: [
      { name: '裂山', shape: 'front', range: 'melee', dmgType: 'physical', mult: 2.0, cd: 3, tags: [T.PHYSICAL],
        effects: [{ kind: 'buff', target: 'self', stat: 'armor', value: 15, duration: 2 }] }] },
  };

  // ---------- 技能卡 ----------
  // roll: 插卡时掷出的唯一一条主数值。key 指向 skill 的字段（mult）或 effects[0].value（value）。
  // 橙卡另带一条固定特效（trigger），结构同触发型天赋。
  DAO.CONFIG.cards = {
    // ===== 主动卡 =====
    chuanyun: { id: 'chuanyun', name: '穿云剑', slot: 'active', quality: 'yellow', roles: ['sword'],
      roll: { key: 'mult', min: 1.3, max: 2.0 },
      skill: { shape: 'single', range: 'melee', pierce: true, dmgType: 'physical', mult: 1.6, cd: 2, tags: [T.PHYSICAL, T.SWORD] } },
    jianqi: { id: 'jianqi', name: '剑气横扫', slot: 'active', quality: 'blue', roles: ['sword'],
      roll: { key: 'mult', min: 0.9, max: 1.4 },
      skill: { shape: 'front', range: 'melee', dmgType: 'physical', mult: 1.1, cd: 2, tags: [T.PHYSICAL, T.SWORD] } },
    lieyan: { id: 'lieyan', name: '烈焰', slot: 'active', quality: 'blue', roles: ['mage'],
      roll: { key: 'mult', min: 0.6, max: 0.9 },
      skill: { shape: 'all', range: 'ranged', dmgType: 'magic', mult: 0.75, cd: 2, tags: [T.MAGIC, T.FIRE] } },
    huoyu: { id: 'huoyu', name: '火雨', slot: 'active', quality: 'yellow', roles: ['mage'],
      roll: { key: 'mult', min: 1.0, max: 1.5 },
      skill: { shape: 'back', range: 'ranged', dmgType: 'magic', mult: 1.2, cd: 2, tags: [T.MAGIC, T.FIRE] } },
    liuhuo: { id: 'liuhuo', name: '流火弹', slot: 'active', quality: 'yellow', roles: ['mage'],
      roll: { key: 'mult', min: 0.8, max: 1.2 },
      skill: { shape: 'bounce', range: 'ranged', dmgType: 'magic', mult: 1.0, bounces: 3, bounceDecay: 0.75, cd: 1, tags: [T.MAGIC, T.FIRE] } },
    zhenshe: { id: 'zhenshe', name: '震慑', slot: 'active', quality: 'blue', roles: ['sword'],
      roll: { key: 'mult', min: 1.0, max: 1.5 },
      skill: { shape: 'single', range: 'melee', dmgType: 'physical', mult: 1.2, cd: 2, tags: [T.PHYSICAL],
        effects: [{ kind: 'pull', target: 'hitTargets', value: 300 }] } },

    // ===== 被动卡 =====
    ruifeng: { id: 'ruifeng', name: '锐锋', slot: 'passive', quality: 'blue', roles: ['sword'],
      roll: { key: 'value', min: 0.08, max: 0.15 }, passive: { tagDmgUp: { tags: [T.SWORD], value: 0.12 } } },
    fenxin: { id: 'fenxin', name: '焚心', slot: 'passive', quality: 'blue', roles: ['mage'],
      roll: { key: 'value', min: 0.08, max: 0.15 }, passive: { tagDmgUp: { tags: [T.FIRE], value: 0.12 } } },
    jingang: { id: 'jingang', name: '金刚', slot: 'passive', quality: 'blue', roles: ['sword'],
      roll: { key: 'value', min: 20, max: 40 }, passive: { stat: 'armor', value: 30 } },
    ningshen: { id: 'ningshen', name: '凝神', slot: 'passive', quality: 'yellow', roles: ['sword', 'mage'],
      roll: { key: 'value', min: 0.05, max: 0.12 }, passive: { stat: 'critRate', value: 0.08 } },
    xunjie: { id: 'xunjie', name: '迅捷', slot: 'passive', quality: 'blue', roles: ['sword', 'mage'],
      roll: { key: 'value', min: 8, max: 16 }, passive: { stat: 'speed', value: 12 } },
    // 橙卡：主数值 + 固定触发特效
    wanjian: { id: 'wanjian', name: '万剑归宗', slot: 'passive', quality: 'orange', roles: ['sword'],
      roll: { key: 'value', min: 0.03, max: 0.08 }, passive: { stat: 'finalDmg', value: 0.05 },
      trigger: { id: 'wanjian_trig', name: '万剑归宗·归', desc: '暴击时剑系技能 CD −1，每回合 1 次', event: 'crit', chance: 1, maxPerRound: 1,
        effect: { kind: 'cdReduce', tags: [T.SWORD], value: 1 } } },
  };

  DAO.ROLE_NAMES = {
    sword: '剑修', mage: '法修', beast: '妖兽', demon: '妖修',
  };

  DAO.SHAPE_NAMES = { single: '单体', front: '前排', back: '后排', all: '全体', bounce: '弹射' };
})(typeof globalThis !== 'undefined' ? globalThis : this);
