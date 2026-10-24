#!/usr/bin/env node
/**
 * 阶段 2 验收：第一张技能卡 + 第二段引导关。
 *   node cli/stage2.js [每种开局模拟玩家数=300]     结果写入 docs/STAGE2_REPORT.md
 *
 *  0. 同种子一致（战斗 / 掷数值 / 掉落）；阶段 1 存档迁移
 *  1. 第二段首领：插卡 vs 不插卡的胜率表
 *  2. 模拟玩家：从选角一路玩到第二段通关，统计第二段（第一段首领通关 → 第二段首领通关）的用时、挂机占比、
 *     重掷 / 换卡选择次数、金币结余
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DAO = require('../src/node.js');
const G = DAO.Game;
const C = DAO.CONFIG.game;

const PLAYERS = Number(process.argv[2] || 300);
const ROLES = ['sword', 'mage'];
const RN = { sword: '剑修', mage: '法修' };
const CH1 = C.chapters[0].id, CH2 = C.chapters[1].id;
const BOSS2 = C.chapters[1].stages[C.chapters[1].stages.length - 1].id;
const out = [];
const log = (s = '') => { out.push(s); console.log(s); };
const pct = (x) => Math.round(x * 100) + '%';
const q = (arr, p) => { const a = arr.filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null; };
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
const min = (ms) => (ms == null ? '—' : (ms / 60000).toFixed(1));
const num = (x) => (x == null ? '—' : Math.round(x).toLocaleString('en-US'));
const T0 = new Date(2026, 9, 24, 9, 0, 0).getTime();
const checks = [];

const t0 = Date.now();
log('# 阶段 2 验收报告');
log();
log(`> 由 \`node cli/stage2.js ${PLAYERS}\` 生成。数值为占位，配置见 \`src/config/game.js\`。`);
log();

// ---------------- 工具 ----------------
function stdChar(save, role, level) {
  const c = G.rollRecruit(save, { role, quality: 'blue' });
  const st = C.starters[role];
  c.growth = JSON.parse(JSON.stringify(st.growth));
  c.innate = st.innate;
  c.talents = [{ id: role === 'sword' ? 'li' : 'zhi', roll: 0.5 }];
  c.card = null;
  c.level = level;
  save.nextId++;
  return c;
}
/** 两人：开局角色 Lv N（cards: 'none' | 'first' | 'both'），互补招募角色 Lv N−1 */
function duo(role, lv, cards) {
  const s = G.newSave(role, 't', T0);
  s.roster[0].level = lv;
  const other = role === 'sword' ? 'mage' : 'sword';
  const c = stdChar(s, other, Math.max(1, lv - 1));
  s.roster.push(c);
  s.research.slots = 2;
  G.addToLineup(s, c.id);
  if (cards !== 'none') s.roster[0].card = { id: C.cards.firstCard[role], roll: 0.5 };
  if (cards === 'both') c.card = { id: C.cards.firstCard[other], roll: 0.5 };
  return s;
}
function winRate(save, stageId, n) {
  let w = 0;
  for (let i = 0; i < n; i++) { save.seedCounter = 7000 + i; if (G.runBattle(save, stageId).win) w++; }
  return w / n;
}

// ---------------- 0. 确定性与迁移 ----------------
log('## 0. 确定性与存档迁移');
log();
{
  const s = duo('sword', 14, 'first');
  s.seedCounter = 99;
  const o1 = G.runBattle(s, '2-6', { record: true }), o2 = G.runBattle(s, '2-6', { record: true });
  const okB = JSON.stringify(o1.result.log) === JSON.stringify(o2.result.log) && JSON.stringify(o1.drops) === JSON.stringify(o2.drops);
  const a = duo('mage', 14, 'first'), b = duo('mage', 14, 'first');
  a.rollSeed = b.rollSeed = 55; a.bag.huoyu = 3; b.bag.huoyu = 3;
  const ra = [G.insertCard(a, 'c1', 'huoyu'), G.insertCard(a, 'c1', 'huoyu')].map((x) => x.roll).join(',');
  const rb = [G.insertCard(b, 'c1', 'huoyu'), G.insertCard(b, 'c1', 'huoyu')].map((x) => x.roll).join(',');
  checks.push(['同种子战斗与掉落一致', okB]);
  checks.push(['掷数值同种子结果一致', ra === rb]);
  log(`- 同种子战斗日志与掉落一致：**${okB ? '是' : '否'}**；同掷数值种子两次重掷结果一致（${ra}）：**${ra === rb ? '是' : '否'}**`);

  // 阶段 1（v2）存档：打过第一段首领
  const v2 = G.newSave('sword', '老玩家', T0);
  v2.v = 2;
  delete v2.bag; delete v2.rollSeed; delete v2.settings; delete v2.cardsInfo; delete v2.bagNew;
  v2.roster[0].talents = [{ id: 'li', roll: 0.5 }];
  delete v2.roster[0].card;
  v2.roster[0].level = 11;
  for (const st of C.chapters[0].stages) v2.progress.cleared[st.id] = 1;
  v2.guide.seen = { cave: true, research: true, formation: true, chapterDone: true };
  v2.gold = 1800;
  const m = G.migrate(JSON.parse(JSON.stringify(v2)), T0);
  const v2b = JSON.parse(JSON.stringify(v2)); v2b.progress.cleared = { '1-1': 1 }; v2b.guide.seen = {};
  const m2 = G.migrate(v2b, T0);
  const okM = m && m.v === C.saveVersion && m.bag[C.cards.firstCard.sword] === 1 && G.currentGuide(m) === 'firstCard' && m.roster[0].talents[0].id === 'jianxin' &&
    m.guide.seen['done:' + CH1] && m.gold === 1800 && m.roster[0].level === 11 && m2 && G.bagCount(m2) === 0 && !m2.cardsInfo.firstGot;
  checks.push(['阶段 1 存档能迁移（打过第一段首领的补发第一张卡）', !!okM]);
  log(`- 阶段 1（v2）存档迁移：打过第一段首领的补发第一张卡并排队插卡引导，开局天赋换成同门标签型，金币等级保留；没打过的不补发：**${okM ? '通过' : '不通过'}**`);
  log();
}

// ---------------- 1. 第二段首领 ----------------
log(`## 1. 第二段首领 ${BOSS2}：插卡 vs 不插卡`);
log();
log('两人 = 开局角色 Lv N + 互补招募角色 Lv N−1（资质与开局角色相同），默认站位。卡的数值取 50 档。每格 200 个种子。');
log();
const LV = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
const bossLv = {};
for (const role of ROLES) {
  const rows = {};
  for (const k of ['none', 'first', 'both']) rows[k] = LV.map((lv) => winRate(duo(role, lv, k), BOSS2, 200));
  const first = (arr, th) => { const i = arr.findIndex((x) => x >= th); return i < 0 ? null : LV[i]; };
  bossLv[role] = { none: first(rows.none, 0.5), first: first(rows.first, 0.5), both: first(rows.both, 0.5) };
  log(`### ${RN[role]}开局（第一张卡：${DAO.CONFIG.cards[C.cards.firstCard[role]].name}）`);
  log();
  log('| 卡 | ' + LV.map((l) => 'Lv' + l).join(' | ') + ' | ≥50% |');
  log('|---' + '|---'.repeat(LV.length + 1) + '|');
  const label = { none: '都不插卡', first: '开局角色插第一张卡', both: '两人都插卡' };
  for (const k of ['none', 'first', 'both']) log(`| ${label[k]} | ${rows[k].map(pct).join(' | ')} | ${first(rows[k], 0.5) == null ? '>22' : 'Lv' + first(rows[k], 0.5)} |`);
  log();
}

// ---------------- 2. 模拟玩家 ----------------
/**
 * 从选角玩到第二段通关。
 * kind = 'std'：推关战斗按 2× 观看 + 阅读点击；引导和卡牌提示确认；有闲人且金币够就研究第 3 个上阵位（可选研究）。
 * kind = 'auto'：只在引导 / 提示处点确认（卡牌提示走默认的一键处理），不做可选研究。
 */
function simulate(role, idx, kind) {
  const E = C.estimate;
  let now = T0;
  const save = G.newSave(role, 'sim', now);
  save.seedCounter = 300000 + idx * 7919;
  save.gachaSeed = 7 + idx * 104729;
  save.rollSeed = 11 + idx * 3571;
  const r = { role, kind, done: false, t1: null, t2: null, gold1: null, gold2: null, lv2: null, push2: 0, idle2: 0, wait2: 0, rerolls: 0, swaps: 0, recruits: 0, research3: false };
  let guard = 0;
  const seg2 = () => r.t1 != null;
  while (guard++ < 8000) {
    G.tickResearch(save, now);
    if (kind === 'std' && save.unlocks.cave && !save.research.active && G.researchNext(save)) {
      const idle = save.roster.find((c) => G.status(save, c.id) === 'idle');
      if (idle && !G.researchBlock(save, idle.id)) { G.startResearch(save, idle.id, now); if (seg2()) r.research3 = true; }
    }
    const d = G.autoDecide(save);
    if (d.type === 'wait') {
      now += E.guideMs;
      if (seg2()) r.wait2 += E.guideMs;
      if (d.reason === 'guide') {
        const info = G.ackGuide(save, d.guide, now);
        if (info.recruit && info.recruit.ok && seg2()) r.recruits++;
        if (d.guide === 'done:' + CH2) break;
      } else if (d.reason === 'boss') G.confirmBoss(save, d.stageId);
      else if (d.reason === 'cards') G.autoHandleCards(save);
      else break;
      continue;
    }
    const push = d.type === 'challenge';
    const o = G.runBattle(save, d.stageId);
    const ms = push ? G.durationMs(o.result, E.watchSpeed) + (kind === 'std' ? E.overheadMs : 0) : G.backgroundBattleMs(o);
    now += ms;
    if (seg2()) { if (push) r.push2 += ms; else r.idle2 += ms; }
    G.applyOutcome(save, o, { kind: push ? 'push' : 'idle', elapsedMs: ms });
    if (r.t1 == null && G.chapterDone(save, CH1)) { r.t1 = now; r.gold1 = save.gold; r.inc1 = save.stats.goldTotal; r.lv1 = G.starter(save).level; r.ci1 = JSON.parse(JSON.stringify(save.cardsInfo)); }
    if (r.t2 == null && G.chapterDone(save, CH2)) { r.t2 = now; r.gold2 = save.gold; r.inc2 = save.stats.goldTotal - r.inc1; r.lv2 = G.starter(save).level; r.done = true; }
    if (now - T0 > 120 * 60000) break;
  }
  if (r.t1 != null) {
    r.dur2 = (r.t2 || now) - r.t1;
    r.rerolls = save.cardsInfo.rerolls - (r.ci1 ? r.ci1.rerolls : 0);
    r.swaps = save.cardsInfo.swapOffers - (r.ci1 ? r.ci1.swapOffers : 0);
    r.replaces = save.cardsInfo.replaces;
    r.cardsAll = save.roster.filter((c) => c.card).length + '/' + save.roster.length;
    r.slots = save.research.slots;
    r.gain2 = save.stats.goldTotal;
  }
  return r;
}

log('## 2. 模拟玩家：第二段（第一段首领通关 → 第二段首领通关）');
log();
log(`策略：沿用阶段 1 的自动推关；引导、首领确认、卡牌提示各等 ${C.estimate.guideMs / 1000} 秒后确认；卡牌提示的默认动作是「同名卡全部重掷、空卡槽插上能用的卡」，不主动换卡。每种开局 ${PLAYERS} 名玩家。`);
log();
log('- **标准玩家**：推关战斗每场另加 ' + C.estimate.overheadMs / 1000 + ' 秒阅读点击；有闲人且金币够就研究第 3 个上阵位（可选）');
log('- **全自动玩家**：只在引导 / 提示处点确认，不做可选研究');
log();
const sims = {};
for (const kind of ['std', 'auto']) {
  sims[kind] = {};
  for (const role of ROLES) {
    sims[kind][role] = [];
    for (let i = 0; i < PLAYERS; i++) sims[kind][role].push(simulate(role, i, kind));
  }
}
log('| 玩家 | 开局 | 打完第二段 | 第二段用时 分钟 中位（P10–P90） | 挂机占比 中位（P90） | 第二段通关时开局角色等级 中位（P10–P90） | 研究到第 3 位 | 人均重掷 | 人均换卡选择 |');
log('|---|---|---|---|---|---|---|---|---|');
const S = {};
for (const kind of ['std', 'auto']) {
  S[kind] = {};
  for (const role of ROLES) {
    const s = sims[kind][role];
    const share = s.map((x) => x.idle2 / Math.max(1, x.dur2));
    S[kind][role] = {
      done: s.filter((x) => x.done).length / s.length, time: q(s.map((x) => x.dur2), 0.5), share: q(share, 0.5), share90: q(share, 0.9),
      lv: q(s.map((x) => x.lv2), 0.5), rerolls: mean(s.map((x) => x.rerolls)), swaps: mean(s.map((x) => x.swaps)),
    };
    log(`| ${kind === 'std' ? '标准' : '全自动'} | ${RN[role]} | ${pct(S[kind][role].done)} | ${min(S[kind][role].time)}（${min(q(s.map((x) => x.dur2), 0.1))}–${min(q(s.map((x) => x.dur2), 0.9))}） | ${pct(S[kind][role].share)}（${pct(S[kind][role].share90)}） | Lv${S[kind][role].lv}（${q(s.map((x) => x.lv2), 0.1)}–${q(s.map((x) => x.lv2), 0.9)}） | ${pct(s.filter((x) => x.slots >= 3).length / s.length)} | ${S[kind][role].rerolls.toFixed(1)} | ${S[kind][role].swaps.toFixed(1)} |`);
  }
}
log();
log('### 金币结余');
log();
log('「留存比例」= 本段结束时的结余 ÷（本段开始时的结余 + 本段收入）。阶段 1 结束时几乎全部留存（第一段只花了研究第 2 位的 20 金）。');
log();
log('| 玩家 | 开局 | 第一段结束时 中位（P10–P90） | 第二段收入 中位 | 第二段结束时 中位（P10–P90） | 第二段花掉 中位 | 留存比例 中位 |');
log('|---|---|---|---|---|---|---|');
const goldDrop = {};
for (const kind of ['std', 'auto']) {
  for (const role of ROLES) {
    const s = sims[kind][role].filter((x) => x.done);
    const g1 = s.map((x) => x.gold1), g2 = s.map((x) => x.gold2);
    const spent = s.map((x) => x.gold1 + x.inc2 - x.gold2);
    const keep = s.map((x) => x.gold2 / Math.max(1, x.gold1 + x.inc2));
    goldDrop[kind + role] = { g1: q(g1, 0.5), g2: q(g2, 0.5), keep: q(keep, 0.5) };
    log(`| ${kind === 'std' ? '标准' : '全自动'} | ${RN[role]} | ${num(q(g1, 0.5))}（${num(q(g1, 0.1))}–${num(q(g1, 0.9))}） | ${num(q(s.map((x) => x.inc2), 0.5))} | ${num(q(g2, 0.5))}（${num(q(g2, 0.1))}–${num(q(g2, 0.9))}） | ${num(q(spent, 0.5))} | ${pct(q(keep, 0.5))} |`);
  }
}
log();

// ---------------- 验收 ----------------
log('## 3. 验收');
log();
for (const role of ROLES) {
  const b = bossLv[role];
  checks.push([`第二段首领：插卡的通关等级比不插卡至少低 3 级（${RN[role]}开局：不插 ${b.none == null ? '>22' : 'Lv' + b.none}，开局角色插卡 Lv${b.first}，两人都插 Lv${b.both}）`, b.none == null || b.none - b.first >= 3]);
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
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'STAGE2_REPORT.md'), out.join('\n') + '\n');
console.error('\n已写入 docs/STAGE2_REPORT.md');
