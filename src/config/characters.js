/**
 * V0 示例角色（满编 5v5 模拟器用，数值全部占位）。
 * 第一版只有剑修、法修两种定位。体修、丹修、阵修的角色已在阶段 0 删除。
 * 阶段 0 的开局角色不在这里，见 config/stage0.js 的 starters。
 *
 * 字段：
 *   role       定位：sword | mage
 *   stats      三维（已含等级成长的最终值）
 *   innate     固有主动 id；branch 为 2选1：0=A，1=B
 *   activeCard / passiveCard  { id, roll }，roll 为档位 0–1
 *   talents    [{ id, roll }]，1–3 条，触发型最多一条
 *   row        默认站位 front | back
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  DAO.CONFIG.level = 30;

  DAO.CONFIG.characters = {
    liuwuying: {
      name: '柳无影', title: '后排刺客剑修', role: 'sword', row: 'back',
      stats: { str: 95, agi: 120, int: 30 },
      innate: 'liuying', branch: 0,
      activeCard: { id: 'chuanyun', roll: 0.6 },
      passiveCard: { id: 'ningshen', roll: 0.5 },
      talents: [{ id: 'min', roll: 0.6 }, { id: 'jianxin', roll: 0.5 }, { id: 'jianxintongming', roll: 1 }],
    },
    sujin: {
      name: '苏烬', title: '弹射法修', role: 'mage', row: 'back',
      stats: { str: 30, agi: 85, int: 125 },
      innate: 'lianzhuhuo', branch: 0,
      activeCard: { id: 'liuhuo', roll: 0.6 },
      passiveCard: { id: 'fenxin', roll: 0.5 },
      talents: [{ id: 'huoling', roll: 0.5 }, { id: 'guangsan', roll: 0.5 }],
    },
    huoxiao: {
      name: '霍骁', title: '名将·破军', role: 'sword', row: 'front',
      stats: { str: 130, agi: 90, int: 40 },
      innate: 'pojun', branch: 0,
      activeCard: { id: 'jianqi', roll: 0.5 },
      passiveCard: { id: 'ruifeng', roll: 0.5 },
      talents: [{ id: 'li', roll: 0.7 }, { id: 'ganglie', roll: 0.6 }, { id: 'pojunzhiwei', roll: 1 }],
    },
    hantieyi: {
      name: '韩铁衣', title: '前排剑修', role: 'sword', row: 'front',
      stats: { str: 115, agi: 90, int: 30 },
      innate: 'jianqizhan', branch: 0,
      activeCard: { id: 'jianqi', roll: 0.5 },
      passiveCard: { id: 'jingang', roll: 0.5 },
      talents: [{ id: 'jianxintongming', roll: 1 }, { id: 'jianxin', roll: 0.5 }],
    },
    chixiazi: {
      name: '赤霞子', title: '单体法修', role: 'mage', row: 'back',
      stats: { str: 30, agi: 85, int: 125 },
      innate: 'chiyan', branch: 0,
      activeCard: { id: 'huoyu', roll: 0.5 },
      passiveCard: { id: 'fenxin', roll: 0.5 },
      talents: [{ id: 'huoling', roll: 0.5 }, { id: 'zhuanzhu', roll: 0.5 }],
    },
    yueling: {
      name: '岳凌', title: '护体剑修', role: 'sword', row: 'front',
      stats: { str: 120, agi: 60, int: 50 },
      innate: 'jianqizhan', branch: 1,
      activeCard: { id: 'zhenshe', roll: 0.5 },
      passiveCard: { id: 'jingang', roll: 0.5 },
      talents: [{ id: 'tiepi', roll: 0.6 }, { id: 'hutigangqi', roll: 0.5 }],
    },
    qinshuang: {
      name: '秦霜', title: '快剑剑修', role: 'sword', row: 'front',
      stats: { str: 100, agi: 115, int: 30 },
      innate: 'jianqizhan', branch: 0,
      activeCard: { id: 'chuanyun', roll: 0.5 },
      passiveCard: { id: 'wanjian', roll: 0.5 },
      talents: [{ id: 'min', roll: 0.5 }, { id: 'xinyan', roll: 0.5 }],
    },
    shenqingya: {
      name: '沈青崖', title: '横扫剑修', role: 'sword', row: 'back',
      stats: { str: 110, agi: 95, int: 30 },
      innate: 'liuying', branch: 1,
      activeCard: { id: 'jianqi', roll: 0.5 },
      passiveCard: { id: 'ruifeng', roll: 0.5 },
      talents: [{ id: 'li', roll: 0.5 }, { id: 'ganglie', roll: 0.5 }],
    },
    wenruyu: {
      name: '温如玉', title: '群攻法修', role: 'mage', row: 'back',
      stats: { str: 30, agi: 90, int: 120 },
      innate: 'chiyan', branch: 1,
      activeCard: { id: 'lieyan', roll: 0.5 },
      passiveCard: { id: 'xunjie', roll: 0.5 },
      talents: [{ id: 'zhi', roll: 0.5 }, { id: 'xuanwei', roll: 0.5 }],
    },
    lufen: {
      name: '陆焚', title: '燎原法修', role: 'mage', row: 'back',
      stats: { str: 30, agi: 85, int: 125 },
      innate: 'lianzhuhuo', branch: 1,
      activeCard: { id: 'huoyu', roll: 0.5 },
      passiveCard: { id: 'fenxin', roll: 0.5 },
      talents: [{ id: 'huoling', roll: 0.5 }, { id: 'liaoyuan', roll: 0.5 }],
    },
  };

  /** V0 默认两队阵容：{ charId, row } */
  DAO.CONFIG.defaultTeams = {
    A: [
      { charId: 'huoxiao', row: 'front' },
      { charId: 'yueling', row: 'front' },
      { charId: 'liuwuying', row: 'back' },
      { charId: 'sujin', row: 'back' },
      { charId: 'chixiazi', row: 'back' },
    ],
    B: [
      { charId: 'hantieyi', row: 'front' },
      { charId: 'qinshuang', row: 'front' },
      { charId: 'shenqingya', row: 'back' },
      { charId: 'wenruyu', row: 'back' },
      { charId: 'lufen', row: 'back' },
    ],
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
