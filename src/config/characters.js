/**
 * 示例角色（数值全部占位）。
 * 字段：
 *   role       定位：sword | mage | body | alchemist | formation | general
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
    shigandang: {
      name: '石敢当', title: '守护后排的体修', role: 'body', row: 'front',
      stats: { str: 110, agi: 50, int: 60 },
      innate: 'panshi', branch: 0,
      activeCard: { id: 'zhenshe', roll: 0.5 },
      passiveCard: { id: 'jingang', roll: 0.5 },
      talents: [{ id: 'tiepi', roll: 0.6 }, { id: 'hutigangqi', roll: 0.5 }],
    },
    linqingnang: {
      name: '林青囊', title: '奶妈丹修', role: 'alchemist', row: 'back',
      stats: { str: 30, agi: 70, int: 125 },
      innate: 'huichun', branch: 0,
      activeCard: { id: 'hudun', roll: 0.5 },
      passiveCard: { id: 'lingshu', roll: 0.5 },
      talents: [{ id: 'renxin', roll: 0.6 }, { id: 'zhi', roll: 0.4 }],
    },
    situyan: {
      name: '司徒衍', title: '同排加成的阵修', role: 'formation', row: 'front',
      stats: { str: 70, agi: 95, int: 85 },
      innate: 'zhenfa', branch: 0,
      activeCard: { id: 'pojia', roll: 0.5 },
      passiveCard: { id: 'xunjie', roll: 0.5 },
      talents: [{ id: 'jisu', roll: 0.5 }, { id: 'zhenxin', roll: 0.5 }],
    },
    huoxiao: {
      name: '霍骁', title: '名将·破军', role: 'general', row: 'front',
      stats: { str: 130, agi: 90, int: 40 },
      innate: 'pojun', branch: 0,
      activeCard: { id: 'jianqi', roll: 0.5 },
      passiveCard: { id: 'ruifeng', roll: 0.5 },
      talents: [{ id: 'li', roll: 0.7 }, { id: 'ganglie', roll: 0.6 }, { id: 'pojunzhiwei', roll: 1 }],
    },
    // ---- 补充角色，方便组第二队 ----
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
    mengshan: {
      name: '孟山', title: '嘲讽体修', role: 'body', row: 'front',
      stats: { str: 110, agi: 50, int: 60 },
      innate: 'panshi', branch: 1,
      activeCard: { id: 'zhenshe', roll: 0.5 },
      passiveCard: { id: 'jingang', roll: 0.5 },
      talents: [{ id: 'tiepi', roll: 0.5 }, { id: 'hutigangqi', roll: 0.5 }],
    },
    baisu: {
      name: '白素', title: '护盾丹修', role: 'alchemist', row: 'back',
      stats: { str: 30, agi: 70, int: 125 },
      innate: 'huichun', branch: 1,
      activeCard: { id: 'hudun', roll: 0.5 },
      passiveCard: { id: 'lingshu', roll: 0.5 },
      talents: [{ id: 'renxin', roll: 0.5 }, { id: 'changsheng', roll: 0.4 }],
    },
  };

  /** 默认两队阵容：{ charId, row } */
  DAO.CONFIG.defaultTeams = {
    A: [
      { charId: 'shigandang', row: 'front' },
      { charId: 'huoxiao', row: 'front' },
      { charId: 'liuwuying', row: 'back' },
      { charId: 'sujin', row: 'back' },
      { charId: 'linqingnang', row: 'back' },
    ],
    B: [
      { charId: 'mengshan', row: 'front' },
      { charId: 'hantieyi', row: 'front' },
      { charId: 'chixiazi', row: 'back' },
      { charId: 'situyan', row: 'back' },
      { charId: 'baisu', row: 'back' },
    ],
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
