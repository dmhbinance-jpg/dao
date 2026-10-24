#!/usr/bin/env node
/**
 * 四个设计问题的验证实验。
 *   node cli/experiments.js [N]         每组对局 N 场（默认 1000），结果写入 docs/V0_SIM_REPORT.md
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
const TEAM_A = team([['shigandang', 'front'], ['huoxiao', 'front'], ['liuwuying', 'back'], ['sujin', 'back'], ['linqingnang', 'back']]);
const TEAM_B = team([['mengshan', 'front'], ['hantieyi', 'front'], ['chixiazi', 'back'], ['situyan', 'back'], ['baisu', 'back']]);
const TEAM_B32 = setRow(TEAM_B, 'situyan', 'front');
// 辅助实验用：去掉孟山的护体罡气，避免镜像里两边都回血导致大量回合上限平局
const TEAM_S = setTalent(TEAM_B, 'mengshan', 'hutigangqi', 'changsheng');

const t0 = Date.now();
log('# V0 战斗模拟报告');
log();
log(`> 由 \`node cli/experiments.js ${N}\` 生成。每组 ${N} 场，种子 1–${N}，开启换边。数值全部是占位值，结论看方向不看绝对值。`);
log();

// ================= 基线 =================
log('## 0. 基线');
log();
{
  const s = vs(TEAM_A, TEAM_B);
  log('默认阵容 A（守护体修+名将 前 / 刺客剑修+弹射法修+奶妈 后） vs B（嘲讽体修+剑修 前 / 单体法修+阵修+护盾丹修 后）');
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
  ['shigandang', 'hutigangqi', 'changsheng', '护体罡气（受击回血，每回合 2 次）', '长生 气血+14%'],
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
  'B 2前3后（含嘲讽）': TEAM_B,
  'B 3前2后（含嘲讽）': TEAM_B32,
  'A 镜像（含守护）': TEAM_A,
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
{
  // 守护挡不挡弹射
  const old = DAO.CONFIG.guard.coversBounce;
  DAO.CONFIG.guard.coversBounce = true;
  const s = vs(TEAM_A, TEAM_A);
  const sb = vs(mageVariants['单体（赤焰·凝 + 火雨）'], TEAM_A);
  DAO.CONFIG.guard.coversBounce = old;
  log(`对照：若守护也替后排挡弹射（guard.coversBounce=true），镜像中石敢当场均代受 ${unit(s, 'A', '石敢当').redirected.toFixed(1)} 次；单体苏烬 vs 弹射苏烬镜像胜率 ${pct(sb.winRate.A)}。`);
  log();
}

// ================= 3. 辅助走防御区 =================
log('## 3. 辅助走防御区有没有存在感');
log();
log('做法：以 B 队为底（阵修司徒衍 + 护盾丹修白素，都在后排；孟山的护体罡气换成长生，避免镜像拖到回合上限），镜像对局里只改辅助的配置。「贡献」= 把该辅助施加的 buff / debuff 拿掉重算伤害的差值。');
log();
const supVariants = [
  ['阵修 2选1：壁（同排护甲/法抗）vs 锋（同排增伤）', setBranch(TEAM_S, 'situyan', 1), TEAM_S],
  ['阵修主动卡：固元符（全队护甲/法抗）vs 破甲符', setCard(TEAM_S, 'situyan', 'activeCard', 'guyuan'), TEAM_S],
  ['阵修主动卡：疾风阵（全队推条）vs 破甲符', setCard(TEAM_S, 'situyan', 'activeCard', 'jifeng'), TEAM_S],
  ['阵修主动卡：破甲符 vs 空卡槽', TEAM_S, setCard(TEAM_S, 'situyan', 'activeCard', null)],
  ['丹修主动卡：固元符（全队护甲/法抗）vs 护盾符（白素默认）', setCard(TEAM_S, 'baisu', 'activeCard', 'guyuan'), TEAM_S],
  ['丹修主动卡：固元符 vs 空卡槽', setCard(TEAM_S, 'baisu', 'activeCard', 'guyuan'), setCard(TEAM_S, 'baisu', 'activeCard', null)],
  ['丹修主动卡：护盾符 vs 空卡槽', TEAM_S, setCard(TEAM_S, 'baisu', 'activeCard', null)],
  ['把阵修换成输出（柳无影）vs 保留阵修', (() => { const l = clone(TEAM_S); l[3] = { charId: 'liuwuying', row: 'back' }; return l; })(), TEAM_S],
];
log('| 变量 | 前者胜 | 后者胜 | 平局 | 平均回合 |');
log('|---|---|---|---|---|');
for (const [name, x, y] of supVariants) {
  const s = vs(x, y);
  log(`| ${name} | **${pct(s.winRate.A)}** | ${pct(s.winRate.B)} | ${pct(s.winRate.draw)} | ${s.avgRounds.toFixed(1)} |`);
}
log();
{
  const s = vs(TEAM_S, TEAM_S);
  const st = unit(s, 'A', '司徒衍');
  const bs = unit(s, 'A', '白素');
  const top = s.units.filter((u) => u.side === 'A').sort((a, b) => b.dmg - a.dmg)[0];
  log(`B 镜像中的场均贡献（参照：本队输出最高的 ${top.name} 场均伤害 ${num(top.dmg)}）：`);
  log();
  log(`- 司徒衍：破甲 ${num(st.armorBreak)}，增伤 buff ${num(st.dmgBuff)}，减伤 ${num(st.armorBuff)}，自身伤害 ${num(st.dmg)} → 合计 ${num(st.armorBreak + st.dmgBuff + st.armorBuff + st.dmg)}`);
  log(`- 白素：减伤 ${num(bs.armorBuff)}，治疗 ${num(bs.heal)}，护盾吸收 ${num(bs.shieldAbsorbed)}，自身伤害 ${num(bs.dmg)} → 合计 ${num(bs.armorBuff + bs.heal + bs.shieldAbsorbed + bs.dmg)}`);
  log();
}
{
  // 破甲对坦克 vs 脆皮：破甲符目标规则改成随机
  const card = DAO.CONFIG.cards.pojia;
  const old = card.skill.targetRule;
  card.skill.targetRule = 'default';
  const sRand = vs(TEAM_S, TEAM_A);
  card.skill.targetRule = old;
  const sDef = vs(TEAM_S, TEAM_A);
  log(`破甲符目标选择：打最高护甲目标时司徒衍场均破甲贡献 ${num(unit(sDef, 'A', '司徒衍').armorBreak)}；随机目标时 ${num(unit(sRand, 'A', '司徒衍').armorBreak)}。`);
  log();
}

// ================= 4. 前后排 =================
log('## 4. 前后排人数分配有没有真实取舍');
log();
log(`5 人上阵、每排最多 ${DAO.CONFIG.formation.maxPerRow} 人 → 合法的人数分配只有 2前3后 和 3前2后 两种。`);
log();
const formA = {
  'A 2前3后（默认）': TEAM_A,
  'A 3前2后（柳无影上前）': setRow(TEAM_A, 'liuwuying', 'front'),
  'A 3前2后（苏烬上前）': setRow(TEAM_A, 'sujin', 'front'),
  'A 3前2后（林青囊上前）': setRow(TEAM_A, 'linqingnang', 'front'),
};
const formB = {
  'B 2前3后（默认）': TEAM_B,
  'B 3前2后（司徒衍上前）': TEAM_B32,
  'B 3前2后（赤霞子上前）': setRow(TEAM_B, 'chixiazi', 'front'),
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
  ['A 3前2后（林青囊上前）', 'A 2前3后（默认）', formA],
  ['B 3前2后（司徒衍上前）', 'B 2前3后（默认）', formB],
  ['B 3前2后（赤霞子上前）', 'B 2前3后（默认）', formB],
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
  const one = setRow(setRow(TEAM_A, 'huoxiao', 'back'), 'liuwuying', 'back');
  const s1 = vs(one, TEAM_A);
  const sB = vs(one, TEAM_B);
  DAO.CONFIG.formation.maxPerRow = old;
  log(`规则外参考（每排上限放开到 4）：A 1前4后（只留石敢当）vs A 默认 2前3后 胜率 ${pct(s1.winRate.A)}；vs B 默认 ${pct(sB.winRate.A)}。`);
  log();
}

log(`---\n总耗时 ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const file = path.join(__dirname, '..', 'docs', 'V0_SIM_REPORT.md');
fs.writeFileSync(file, out.join('\n') + '\n');
console.error('\n已写入 ' + file);
