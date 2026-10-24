#!/usr/bin/env node
/**
 * 四个设计问题的验证实验。
 *   node cli/experiments.js [N]         每组对局 N 场（默认 1000），结果写入 docs/V0_SIM_REPORT.md
 *
 * 阶段 0 起只用剑修、法修（体修、丹修、阵修已删除）。
 * 第 3 节「辅助走防御区」依赖辅助定位，标记为 V0 遗留、不再维护；V0 原始数据见 docs/archive/V0_SIM_REPORT_v0.md。
 *
 * 方法：大多用「镜像对局」——两边阵容完全相同，只改一个变量，看改动方的胜率偏离 50% 多少。
 * 每组都开 swapSides，抵消同速时的先后手偏差。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DAO = require('../src/node.js');

const N = Number(process.argv[2] || 1000);
const out = [];
const log = (s = '') => { out.push(s); console.log(s); };
const pct = (x) => (x * 100).toFixed(1) + '%';
const num = (x) => Math.round(x).toLocaleString('en-US');
const clone = (o) => JSON.parse(JSON.stringify(o));
const CH = DAO.CONFIG.characters;

// ---------- 阵容工具 ----------
const team = (spec) => spec.map(([charId, row]) => ({ charId, row }));
function patch(lineup, charId, fn) {
  const l = clone(lineup);
  const e = l.find((x) => x.charId === charId);
  const base = Object.assign(clone(CH[charId]), e.override || {});
  fn(base, e);
  e.override = base;
  return l;
}
const setTalent = (l, c, from, to, roll = 0.5) =>
  patch(l, c, (ch) => { ch.talents = ch.talents.map((t) => (t.id === from ? { id: to, roll } : t)); });
const setRow = (l, c, row) => { const x = clone(l); x.find((e) => e.charId === c).row = row; return x; };
const setBranch = (l, c, b) => patch(l, c, (ch) => { ch.branch = b; });
const setCard = (l, c, slot, id, roll = 0.5) => patch(l, c, (ch) => { ch[slot] = id ? { id, roll } : null; });

function vs(x, y) {
  return DAO.Sim.batch(x, y, { runs: N, seedBase: 1, swapSides: true });
}
function unit(sum, side, name) {
  return sum.units.find((u) => u.side === side && u.name === name);
}

// ---------- 基准阵容 ----------
const TEAM_A = team([['huoxiao', 'front'], ['yueling', 'front'], ['liuwuying', 'back'], ['sujin', 'back'], ['chixiazi', 'back']]);
const TEAM_B = team([['hantieyi', 'front'], ['qinshuang', 'front'], ['shenqingya', 'back'], ['wenruyu', 'back'], ['lufen', 'back']]);
const TEAM_B32 = setRow(TEAM_B, 'shenqingya', 'front');

const t0 = Date.now();
log('# V0 战斗模拟报告');
log();
log(`> 由 \`node cli/experiments.js ${N}\` 生成。每组 ${N} 场，种子 1–${N}，开启换边。数值全部是占位值，结论看方向不看绝对值。`);
log();
log('> 阶段 0 起只剩剑修、法修。含体修 / 丹修 / 阵修的 V0 原始报告见 `docs/archive/V0_SIM_REPORT_v0.md`，`docs/DESIGN_QUESTIONS.md` 引用的是那份数据。');
log();

// ================= 基线 =================
log('## 0. 基线');
log();
{
  const s = vs(TEAM_A, TEAM_B);
  log('默认阵容 A（名将+护体剑修 前 / 刺客剑修+弹射法修+单体法修 后） vs B（前排剑修+快剑剑修 前 / 横扫剑修+群攻法修+燎原法修 后）');
  log();
  log('```');
  log(DAO.Sim.report(s));
  log('```');
  const s2 = vs(TEAM_A, TEAM_A);
  log();
  log(`镜像 A vs A：A 胜 ${pct(s2.winRate.A)}，B 胜 ${pct(s2.winRate.B)}，平 ${pct(s2.winRate.draw)}，平均 ${s2.avgRounds.toFixed(1)} 回合（检验换边后无先后手偏差）。`);
  log();
}

// ================= 1. 触发型天赋 =================
log('## 1. 触发型天赋是否过强');
log();
log('做法：镜像对局，一方某角色带触发型天赋，另一方把这条换成 50 档的属性型天赋（触发型约 10% 稀有，属性型约 60% 常见）。胜率是带触发的一方。');
log();
log('| 角色 | 触发型天赋 | 对照（属性型 50 档） | 带触发方胜率 | 平局 | 场均触发 | 平均回合 |');
log('|---|---|---|---|---|---|---|');
const trigTests = [
  ['liuwuying', 'jianxintongming', 'xinyan', '剑心通明（暴击时剑系 CD−1）', '心眼 暴击率+5.5%'],
  ['huoxiao', 'pojunzhiwei', 'lieren', '破军之威（击杀时全技能 CD−2，名将专属）', '裂刃 暴伤+20%'],
  ['yueling', 'hutigangqi', 'changsheng', '护体罡气（受击回血，每回合 2 次）', '长生 气血+14%'],
];
// 把可移植的触发天赋挂到同一个角色上比较
const portable = [
  ['huoxiao', 'pojunzhiwei', 'shafa', '杀伐（击杀时再动）'],
  ['sujin', 'guangsan', 'liaoyuan', '燎原（火系出手推条，每回合 1 次）'],
  ['sujin', 'guangsan', 'xianshengduoren', '先声夺人（开场推条）'],
];
const trigResults = {};
for (const [c, trig, ctrl, tName, cName] of trigTests) {
  const withT = TEAM_A;
  const without = setTalent(TEAM_A, c, trig, ctrl);
  const s = vs(withT, without);
  const u = unit(s, 'A', CH[c].name);
  const tc = Object.values(u.triggers).reduce((a, b) => a + b, 0);
  trigResults[trig] = s.winRate.A;
  log(`| ${CH[c].name} | ${tName} | ${cName} | **${pct(s.winRate.A)}** | ${pct(s.winRate.draw)} | ${tc.toFixed(2)} | ${s.avgRounds.toFixed(1)} |`);
}
for (const [c, from, trig, tName] of portable) {
  const withT = setTalent(TEAM_A, c, from, trig, 0.5);
  const base = TEAM_A; // 对照组保持原天赋（名将对照为破军之威，苏烬对照为 广散 50 档）
  const s = vs(withT, base);
  const u = unit(s, 'A', CH[c].name);
  const tc = Object.values(u.triggers).reduce((a, b) => a + b, 0);
  trigResults[trig] = s.winRate.A;
  const ctrlName = from === 'pojunzhiwei' ? '破军之威' : DAO.CONFIG.talents[from].name + ' 50 档';
  log(`| ${CH[c].name} | ${tName} | ${ctrlName} | **${pct(s.winRate.A)}** | ${pct(s.winRate.draw)} | ${tc.toFixed(2)} | ${s.avgRounds.toFixed(1)} |`);
}
{
  // 全部触发 vs 全部换成属性
  let none = TEAM_A;
  for (const [c, trig, ctrl] of trigTests) none = setTalent(none, c, trig, ctrl);
  const s = vs(TEAM_A, none);
  trigResults.all = s.winRate.A;
  log(`| 全队 | 3 条触发型全部带上 | 3 条全换属性型 | **${pct(s.winRate.A)}** | ${pct(s.winRate.draw)} | — | ${s.avgRounds.toFixed(1)} |`);
}
log();
{
  // 剑心通明 每回合上限敏感度
  const T = DAO.CONFIG.talents.jianxintongming;
  const old = T.maxPerRound;
  const rows = [];
  for (const cap of [1, 2, 99]) {
    T.maxPerRound = cap;
    const s = vs(TEAM_A, setTalent(TEAM_A, 'liuwuying', 'jianxintongming', 'xinyan'));
    const u = unit(s, 'A', '柳无影');
    rows.push(`每回合上限 ${cap === 99 ? '不限' : cap}：胜率 ${pct(s.winRate.A)}，场均触发 ${(u.triggers['剑心通明'] || 0).toFixed(2)}，柳无影伤害占比 ${pct(u.dmgShare)}`);
  }
  if (old == null) delete T.maxPerRound; else T.maxPerRound = old;
  log('剑心通明 每回合触发上限敏感度：');
  log();
  for (const r of rows) log('- ' + r);
  log();
}

// ================= 2. 弹射 =================
log('## 2. 弹射是否过稳');
log();
log('做法：A 队的苏烬换三套配置，各自对三种敌方阵型。看每次施放伤害的变异系数（CV，越小越稳）、对不同阵型的伤害波动、以及胜率。');
log();
const mageVariants = {
  '弹射（连珠火·散 + 流火弹）': TEAM_A,
  '单体（赤焰·凝 + 火雨）': patch(TEAM_A, 'sujin', (ch) => {
    ch.innate = 'chiyan'; ch.branch = 0; ch.activeCard = { id: 'huoyu', roll: 0.6 };
    ch.talents = [{ id: 'huoling', roll: 0.5 }, { id: 'zhuanzhu', roll: 0.5 }];
  }),
  '后排（连珠火·落 + 火雨）': patch(TEAM_A, 'sujin', (ch) => {
    ch.branch = 1; ch.activeCard = { id: 'huoyu', roll: 0.6 };
  }),
  '全体（连珠火·散 + 烈焰）': patch(TEAM_A, 'sujin', (ch) => { ch.activeCard = { id: 'lieyan', roll: 0.6 }; }),
};
const opponents = {
  'B 2前3后': TEAM_B,
  'B 3前2后': TEAM_B32,
  'A 镜像': TEAM_A,
};
log('| 苏烬配置 | 对手 | 胜率 | 苏烬伤害占比 | 苏烬场均伤害 | 主技能每次伤害 | 主技能 CV | 卡技能每次伤害 | 卡技能 CV |');
log('|---|---|---|---|---|---|---|---|---|');
const bounceDmg = {};
for (const [vn, lineup] of Object.entries(mageVariants)) {
  bounceDmg[vn] = [];
  for (const [on, opp] of Object.entries(opponents)) {
    const s = vs(lineup, opp);
    const u = unit(s, 'A', '苏烬');
    const inn = u.skills.find((k) => k.name.startsWith('连珠火') || k.name.startsWith('赤焰')) || {};
    const card = u.skills.find((k) => ['流火弹', '火雨', '烈焰'].includes(k.name)) || {};
    bounceDmg[vn].push([inn.dmgPerCast || 0, card.dmgPerCast || 0]);
    log(`| ${vn} | ${on} | ${pct(s.winRate.A)} | ${pct(u.dmgShare)} | ${num(u.dmg)} | ${num(inn.dmgPerCast || 0)} | ${(inn.cv || 0).toFixed(2)} | ${num(card.dmgPerCast || 0)} | ${(card.cv || 0).toFixed(2)} |`);
  }
}
log();
log('每次施放伤害在三种对手间的极差 / 均值（越小 = 越不受对手站位影响）：');
log();
const spread = (arr) => { const m = arr.reduce((a, b) => a + b, 0) / arr.length; return m ? (Math.max(...arr) - Math.min(...arr)) / m : 0; };
for (const [vn, arr] of Object.entries(bounceDmg)) {
  log(`- ${vn}：主技能 ${pct(spread(arr.map((x) => x[0])))}，卡技能 ${pct(spread(arr.map((x) => x[1])))}`);
}
log();
log('（V0 里的「守护挡弹射」对照依赖体修，已移除。）');
log();

// ================= 3. 辅助走防御区（V0 遗留，不再维护） =================
log('## 3. 辅助走防御区有没有存在感（V0 遗留，不再维护）');
log();
log('这一节依赖阵修、丹修，阶段 0 删除辅助定位后无法运行。V0 结论和数据见 `docs/archive/V0_SIM_REPORT_v0.md` 与 `docs/DESIGN_QUESTIONS.md` Q3。');
log();

// ================= 4. 前后排 =================
log('## 4. 前后排人数分配有没有真实取舍');
log();
log(`5 人上阵、每排最多 ${DAO.CONFIG.formation.maxPerRow} 人 → 合法的人数分配只有 2前3后 和 3前2后 两种。`);
log();
const formA = {
  'A 2前3后（默认）': TEAM_A,
  'A 3前2后（柳无影上前）': setRow(TEAM_A, 'liuwuying', 'front'),
  'A 3前2后（苏烬上前）': setRow(TEAM_A, 'sujin', 'front'),
  'A 3前2后（赤霞子上前）': setRow(TEAM_A, 'chixiazi', 'front'),
};
const formB = {
  'B 2前3后（默认）': TEAM_B,
  'B 3前2后（沈青崖上前）': TEAM_B32,
  'B 3前2后（温如玉上前）': setRow(TEAM_B, 'wenruyu', 'front'),
  'A 后排AOE版 2前3后': mageVariants['后排（连珠火·落 + 火雨）'],
};
log('A 各站位对 B 各站位的胜率（A 方）：');
log();
log('| A \\ B | ' + Object.keys(formB).join(' | ') + ' |');
log('|---' + '|---'.repeat(Object.keys(formB).length) + '|');
for (const [an, al] of Object.entries(formA)) {
  const cells = [];
  for (const [, bl] of Object.entries(formB)) cells.push(pct(vs(al, bl).winRate.A));
  log(`| ${an} | ${cells.join(' | ')} |`);
}
log();
log('同队不同站位直接对打（前者胜率）：');
log();
const pairs = [
  ['A 3前2后（柳无影上前）', 'A 2前3后（默认）', formA],
  ['A 3前2后（苏烬上前）', 'A 2前3后（默认）', formA],
  ['A 3前2后（赤霞子上前）', 'A 2前3后（默认）', formA],
  ['B 3前2后（沈青崖上前）', 'B 2前3后（默认）', formB],
  ['B 3前2后（温如玉上前）', 'B 2前3后（默认）', formB],
];
for (const [x, y, src] of pairs) {
  const s = vs(src[x], src[y]);
  log(`- ${x} vs ${y}：**${pct(s.winRate.A)}**`);
}
log();
{
  // 规则外参考：放开到每排 4 人
  const old = DAO.CONFIG.formation.maxPerRow;
  DAO.CONFIG.formation.maxPerRow = 4;
  const one = setRow(TEAM_A, 'huoxiao', 'back');
  const s1 = vs(one, TEAM_A);
  const sB = vs(one, TEAM_B);
  DAO.CONFIG.formation.maxPerRow = old;
  log(`规则外参考（每排上限放开到 4）：A 1前4后（只留岳凌）vs A 默认 2前3后 胜率 ${pct(s1.winRate.A)}；vs B 默认 ${pct(sB.winRate.A)}。`);
  log();
}

log(`---\n总耗时 ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const file = path.join(__dirname, '..', 'docs', 'V0_SIM_REPORT.md');
fs.writeFileSync(file, out.join('\n') + '\n');
console.error('\n已写入 ' + file);
