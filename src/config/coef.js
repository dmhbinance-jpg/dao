/**
 * 配置表 —— 所有数值系数集中在这里。
 * 设计文档第 16 节：「所有系数放在一张配置表里，V0 做出来后用加速按钮跑模拟再调」。
 *
 * 文件以 UMD 方式挂到 globalThis.DAO，浏览器 <script> 直接加载，Node 用 require 加载。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  DAO.CONFIG = {
    // ===== 阵型 =====
    formation: {
      teamSize: 5,        // 默认上阵人数（第 6 位由奖励解锁，V0 不做）
      maxPerRow: 3,       // 每排最多 3 人
    },

    // ===== 行动条 / 回合 =====
    actionBar: {
      max: 1000,          // 行动条满值
      ticksPerRound: 10,  // 多少个 tick 算一个「回合」：速度 100 的单位每回合恰好出手 1 次
      maxRounds: 40,      // 超过回合数判负/平局（防止双奶拖死）
      maxActionsPerUnitPerRound: 3, // 引擎硬上限：每单位每回合最多行动次数
      maxExtraActionsPerRound: 1,   // 再动每回合上限
    },

    // ===== 三维 → 二级属性 =====
    // 力：物攻、护甲；敏：速度、暴击率、暴伤、闪避；智：法攻、治疗、法抗
    derive: {
      pAtkPerStr: 2.0,
      armorPerStr: 1.0,
      mAtkPerInt: 2.0,
      resistPerInt: 1.0,
      healPowerPerInt: 1.6,
      speedBase: 80,
      speedPerAgi: 0.4,
      critRateBase: 0.05,
      critRatePerAgi: 0.0025,   // 敏 100 → +25%
      critDmgBase: 1.5,
      critDmgPerAgi: 0.002,     // 敏 100 → +0.2
      dodgeRatePerAgi: 0.0,     // 文档提到敏→闪避，但同时要求无随机浮动；V0 默认关闭，见 DESIGN_QUESTIONS
      dodgeRateCap: 0.3,
      hpBase: 1000,
      hpPerLevel: 40,
    },

    // ===== 五个乘区 =====
    damage: {
      defenseK: 100,      // k/(k+护甲或法抗)。文档：k 随层数缩放
      defenseKPerLayer: 0,// 预留：每层 +k
      minDefense: 0,      // 破甲最多减到 0
      critRateCap: 1.0,
      floorDamage: true,  // 伤害向下取整
      minDamage: 1,
    },

    // ===== 弹射 =====
    bounce: {
      defaultHits: 3,
      defaultDecay: 0.75,  // 每次弹射倍率衰减
      allowRepeatConsecutive: false, // 连续两跳是否可打同一目标
    },

    // ===== 触发 =====
    trigger: {
      defaultMaxPerRound: 99, // 每条触发型天赋每回合默认最多触发次数（单条天赋可覆盖）
      allowRecursion: false, // 触发不可递归
    },

    // ===== 治疗 =====
    heal: {
      overhealCounts: false,
    },

    // ===== 自动战斗 AI =====
    ai: {
      // 技能选择优先级：就绪即放，按槽位顺序
      priority: ['activeCard', 'innate', 'basic'],
    },

    // ===== 定位基础（气血倍率等） =====
    roles: {
      sword:     { name: '剑修', hpMul: 1.0 },
      mage:      { name: '法修', hpMul: 0.8 },
      body:      { name: '体修', hpMul: 1.6 },
      alchemist: { name: '丹修', hpMul: 0.9 },
      formation: { name: '阵修', hpMul: 0.9 },
      general:   { name: '名将', hpMul: 1.25 },
    },

    // ===== 技能释放条件 =====
    cast: {
      healBelowHpRatio: 0.85, // 治疗 / 护盾：有队友低于该血量比例才放
      startReady: true,       // 开场时主动技能是否就绪
    },

    // ===== 嘲讽 / 守护 =====
    guard: {
      coversBounce: false,    // 守护是否也替后排挡弹射
    },

    // ===== 模拟 =====
    sim: {
      defaultRuns: 200,
      seedBase: 1,
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
