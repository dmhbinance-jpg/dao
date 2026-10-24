#!/usr/bin/env node
/**
 * 阶段 2 验收（阶段 3.5 起按新流程）：第一张技能卡 + 第二段引导关。
 *   node cli/stage2.js [每种开局模拟玩家数=300] [快照数=40] [--defaults]     结果写入 docs/STAGE2_REPORT.md
 *
 *  0. 同种子一致（战斗 / 掷数值 / 掉落）；阶段 1 存档迁移（迁移链到当前版本）
 *  1. 第二段首领：插卡 vs 不插卡的通关等级——用标准玩家走到 2-8 时的真实存档（真实阵容、真实装备），只改等级
 *  2. 模拟玩家（cli/lib/play.js）：第二段（第一段首领通关 → 第二段首领通关）的用时、挂机占比、重掷 / 换卡选择、金币结余
 */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./lib/play.js');
const { DAO, G, C, q, mean, pct, min, num, T0 } = P;

const PLAYERS = Number(process.argv[2] || 300);
const SNAPS = Number(process.argv[3] || 40);
const ROLES = ['sword', 'mage'];
const RN = { sword: '剑修', mage: '法修' };
const CH1 = C.chapters[0].id, CH2 = C.chapters[1].id;
const BOSS2 = C.chapters[1].stages[C.chapters[1].stages.length - 1].id;
const out = [];
const log = (s = '') => { out.push(s); console.log(s); };
const checks = [];
const t0 = Date.now();
log('# 阶段 2 验收报告');
log();
log(P.header('stage2.js', `${PLAYERS} ${SNAPS}`).join('\n'));
log();

// ---------------- 0. 确定性与迁移 ----------------
log('## 0. 确定性与存档迁移');
log();
{
  const s = P.simulate('sword', 2, { kind: 'std', until: CH1, seeds: P.SEEDS.s23, stopAtClear: true }).save;
  s.seedCounter = 99;
  const o1 = G.runBattle(s, '2-6', { record: true }), o2 = G.runBattle(s, '2-6', { record: true });
  const okB = JSON.stringify(o1.result.timeline) === JSON.stringify(o2.result.timeline) && JSON.stringify(o1.drops) === JSON.stringify(o2.drops);
  const a = G.newSave('mage', 't', T0), b = G.newSave('mage', 't', T0);
  a.rollSeed = b.rollSeed = 55; a.bag.huoyu = 3; b.bag.huoyu = 3;
  const ra = [G.insertCard(a, 'c1', 'huoyu'), G.insertCard(a, 'c1', 'huoyu')].map((x) => x.roll).join(',');
  const rb = [G.insertCard(b, 'c1', 'huoyu'), G.insertCard(b, 'c1', 'huoyu')].map((x) => x.roll).join(',');
  checks.push(['同种子战斗与掉落一致', okB]);
  checks.push(['掷数值同种子结果一致', ra === rb]);
  log(`- 同种子战斗日志与掉落一致：**${okB ? '是' : '否'}**；同掷数值种子两次重掷结果一致（${ra}）：**${ra === rb ? '是' : '否'}**`);

  // 阶段 1（v2）存档：打过第一段首领
  const v2 = G.newSave('sword', '老玩家', T0);
  v2.v = 2;
  for (const k of ['bag', 'rollSeed', 'settings', 'cardsInfo', 'bagNew', 'ore', 'gather', 'gearBag', 'nextGearId', 'recruitChoice', 'quota']) delete v2[k];
  v2.recruit = { day: 20261024, today: 2, freeUsed: true };
  v2.roster[0].talents = [{ id: 'li', roll: 0.5 }];
  delete v2.roster[0].card; delete v2.roster[0].equip;
  v2.roster[0].level = 11;
  for (const st of C.chapters[0].stages) v2.progress.cleared[st.id] = 1;
  v2.guide.seen = { cave: true, research: true, formation: true, chapterDone: true };
  v2.gold = 1800;
  const m = G.migrate(JSON.parse(JSON.stringify(v2)), T0);
  const okM = m && m.v === C.saveVersion && m.bag[C.cards.firstCard.sword] === 1 && m.guide.queue.includes('firstCard') && m.roster[0].talents[0].id === 'jianxin' &&
    m.guide.seen['done:' + CH1] && m.gold === 1800 && m.roster[0].level === 11 && m.unlocks.forge && JSON.stringify(m.recruit) === '{"freeUsed":true}';
  checks.push(['阶段 1 存档能迁移到当前版本（补发第一张卡；打过 1-8 的开放采集 / 锻造房；递增招募价格丢弃）', !!okM]);
  log(`- 阶段 1（v2）存档迁移到 v${C.saveVersion}：补发第一张卡、开局天赋换成同门标签型、打过 1-8 的开放采集 / 锻造房、递增招募价格状态丢弃，金币等级保留：**${okM ? '通过' : '不通过'}**`);
  log();
}

// ---------------- 模拟玩家（先跑，阶梯用它的快照） ----------------
const sims = {};
for (const kind of ['std', 'auto']) {
  sims[kind] = {};
  for (const role of ROLES) {
    sims[kind][role] = [];
    for (let i = 0; i < PLAYERS; i++) sims[kind][role].push(P.simulate(role, i, { kind, until: CH2, seeds: P.SEEDS.s23, snapAt: kind === 'std' && i < SNAPS ? [BOSS2] : [] }));
  }
}

// ---------------- 1. 第二段首领 ----------------
log(`## 1. 第二段首领 ${BOSS2}：插卡 vs 不插卡（按中位玩家的实际装备）`);
log();
log(`阵容取标准玩家走到 ${BOSS2} 那一刻的真实存档（每种开局 ${SNAPS} 份：真实的招募角色、卡、装备和站位；还在研究的当作研究完），开局角色设为 Lv N、其他角色 Lv N−1。`);
log('「插卡」= 存档原样；「不插卡」= 拔掉所有角色的技能卡。每格 = 快照数 × 5 个种子。通关等级 = 胜率 ≥ 50% 的最低等级。');
log();
const LV = []; for (let l = 8; l <= 30; l++) LV.push(l);
const bossLv = {};
for (const role of ROLES) {
  const snaps = sims.std[role].map((r) => r.snaps[BOSS2]).filter(Boolean);
  const withC = P.ladder(snaps, BOSS2, LV, null, 5), noC = P.ladder(snaps, BOSS2, LV, P.stripCards, 5);
  const gear = snaps.map((s) => G.lineupChars(s).reduce((a, x) => a + G.gearSlots().filter((sl) => x.char.equip[sl]).length, 0));
  const arrive = snaps.map((s) => G.starter(s).level);
  bossLv[role] = { card: withC.first, none: noC.first, arrive: q(arrive, 0.5), gear: q(gear, 0.5), lineup: q(snaps.map((s) => G.lineupChars(s).length + (s.research.active ? 1 : 0)), 0.5) };
  log(`### ${RN[role]}开局（快照：开局角色中位 Lv${bossLv[role].arrive}，上阵 ${bossLv[role].lineup} 人，上阵角色装备中位 ${bossLv[role].gear} 件）`);
  log();
  log('| | ' + LV.map((l) => 'Lv' + l).join(' | ') + ' | ≥50% |');
  log('|---' + '|---'.repeat(LV.length + 1) + '|');
  log(`| 插卡（原样） | ${withC.rates.map(pct).join(' | ')} | ${withC.first == null ? '>30' : 'Lv' + withC.first} |`);
  log(`| 不插卡 | ${noC.rates.map(pct).join(' | ')} | ${noC.first == null ? '>30' : 'Lv' + noC.first} |`);
  log();
}

// ---------------- 2. 模拟玩家 ----------------
log('## 2. 模拟玩家：第二段（第一段首领通关 → 第二段首领通关）');
log();
log(`策略见 cli/lib/play.js。引导、首领确认、卡牌提示、3 选 1 各等 ${C.estimate.guideMs / 1000} 秒后确认；卡牌提示的默认动作是「同名卡全部重掷、空卡槽插上能用的卡」，不主动换卡。每种开局 ${PLAYERS} 名玩家。`);
log();
log('- **标准玩家**：推关战斗每场另加 ' + C.estimate.overheadMs / 1000 + ' 秒阅读点击；研究上阵位（第二段起优先攒钱研究）；2 人采集；灵矿金币够就按推荐打装备');
log('- **全自动玩家**：只在引导 / 提示处点确认，不做可选研究、不主动招募和锻造');
log();
log('| 玩家 | 开局 | 打完第二段 | 第二段用时 分钟 中位（P10–P90） | 挂机占比 中位（P90） | 第二段通关时开局角色等级 中位（P10–P90） | 研究到第 3 位 | 人均重掷 | 人均换卡选择 | 上阵装备件数 中位 |');
log('|---|---|---|---|---|---|---|---|---|---|');
const S = {};
for (const kind of ['std', 'auto']) {
  S[kind] = {};
  for (const role of ROLES) {
    const s = sims[kind][role].map((r) => r.segs[CH2]).filter(Boolean);
    const done = s.filter((x) => !x.unfinished);
    const share = s.map((x) => x.idle / Math.max(1, x.dur));
    S[kind][role] = { done: done.length / PLAYERS, time: q(s.map((x) => x.dur), 0.5), share: q(share, 0.5), share90: q(share, 0.9), lv: q(done.map((x) => x.lv1), 0.5),
      rerolls: mean(s.map((x) => x.rerolls)), swaps: mean(s.map((x) => x.swaps)) };
    log(`| ${kind === 'std' ? '标准' : '全自动'} | ${RN[role]} | ${pct(S[kind][role].done)} | ${min(S[kind][role].time)}（${min(q(s.map((x) => x.dur), 0.1))}–${min(q(s.map((x) => x.dur), 0.9))}） | ${pct(S[kind][role].share)}（${pct(S[kind][role].share90)}） | Lv${S[kind][role].lv}（${q(done.map((x) => x.lv1), 0.1)}–${q(done.map((x) => x.lv1), 0.9)}） | ${pct(done.filter((x) => x.slots >= 3).length / Math.max(1, done.length))} | ${S[kind][role].rerolls.toFixed(1)} | ${S[kind][role].swaps.toFixed(1)} | ${q(done.map((x) => x.pieces), 0.5)} |`);
  }
}
log();
log('### 金币与灵矿结余');
log();
log('「留存比例」= 本段结束时的金币 ÷（本段开始时的金币 + 本段收入）。');
log();
log('| 玩家 | 开局 | 第一段结束金币 中位（P10–P90） | 第二段收入 中位 | 锻造花掉 中位 | 第二段结束金币 中位（P10–P90） | 留存比例 中位 | 第二段结束灵矿 中位 |');
log('|---|---|---|---|---|---|---|---|');
const goldDrop = {};
for (const kind of ['std', 'auto']) {
  for (const role of ROLES) {
    const rs = sims[kind][role].filter((r) => r.segs[CH1] && r.segs[CH2] && !r.segs[CH2].unfinished);
    const g1 = rs.map((r) => r.segs[CH1].gold1), g2 = rs.map((r) => r.segs[CH2].gold1);
    const inc = rs.map((r) => r.segs[CH2].goldInc);
    const keep = rs.map((r) => r.segs[CH2].gold1 / Math.max(1, r.segs[CH1].gold1 + r.segs[CH2].goldInc));
    goldDrop[kind + role] = { g1: q(g1, 0.5), g2: q(g2, 0.5), keep: q(keep, 0.5) };
    log(`| ${kind === 'std' ? '标准' : '全自动'} | ${RN[role]} | ${num(q(g1, 0.5))}（${num(q(g1, 0.1))}–${num(q(g1, 0.9))}） | ${num(q(inc, 0.5))} | ${num(q(rs.map((r) => r.segs[CH2].forgeGold), 0.5))} | ${num(q(g2, 0.5))}（${num(q(g2, 0.1))}–${num(q(g2, 0.9))}） | ${pct(q(keep, 0.5))} | ${num(q(rs.map((r) => r.segs[CH2].ore1), 0.5))} |`);
  }
}
log();

// ---------------- 验收 ----------------
log('## 3. 验收');
log();
for (const role of ROLES) {
  const b = bossLv[role];
  checks.push([`第二段首领：插卡比不插卡的通关等级低 ≥ 3 级，按中位玩家的实际装备（${RN[role]}开局：插卡 ${b.card == null ? '>30' : 'Lv' + b.card}，不插卡 ${b.none == null ? '>30' : 'Lv' + b.none}）`, b.card != null && (b.none == null || b.none - b.card >= 3)]);
}
for (const role of ROLES) {
  checks.push([`第二段总时长 10–15 分钟（标准玩家，${RN[role]}开局：${min(S.std[role].time)} 分钟）`, S.std[role].time >= 10 * 60000 && S.std[role].time <= 15 * 60000]);
  checks.push([`挂机时间不超过三分之一（标准玩家，${RN[role]}开局：中位 ${pct(S.std[role].share)}）`, S.std[role].share <= 1 / 3]);
  checks.push([`全自动玩家能打完第二段（${RN[role]}开局：${pct(S.auto[role].done)}，第二段用时 ${min(S.auto[role].time)} 分钟）`, S.auto[role].done === 1]);
}
checks.push([`剑修开局、法修开局第二段通关等级差 ≤ 2（Lv${S.std.sword.lv} vs Lv${S.std.mage.lv}）`, Math.abs(S.std.sword.lv - S.std.mage.lv) <= 2]);
for (const role of ROLES) checks.push([`第二段人均至少 2 次重掷、1 次换卡选择（标准玩家，${RN[role]}开局：重掷 ${S.std[role].rerolls.toFixed(1)}，换卡选择 ${S.std[role].swaps.toFixed(1)}）`, S.std[role].rerolls >= 2 && S.std[role].swaps >= 1]);
for (const role of ROLES) {
  const g = goldDrop['std' + role];
  checks.push([`第二段结束时金币结余比第一段结束时明显下降（标准玩家，${RN[role]}开局：结余 ${num(g.g1)} → ${num(g.g2)}；本段留存比例 ${pct(g.keep)}）`, g.g2 <= g.g1 * 0.7]);
}
for (const [name, ok] of checks) log(`- ${ok ? '✅' : '❌'} ${name}`);
log();
log(`---\n耗时 ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (!process.env.NOWRITE) {
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'STAGE2_REPORT.md'), out.join('\n') + '\n');
  console.error('\n已写入 docs/STAGE2_REPORT.md');
}
