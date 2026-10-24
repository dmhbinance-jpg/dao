#!/usr/bin/env node
/**
 * 阶段 1 验收：洞府招募 + 研究上阵位 + 自动推关。
 *   node cli/stage1.js [每种开局模拟玩家数=300]     结果写入 docs/STAGE1_REPORT.md
 *
 *  0. 同种子一致；阶段 0 存档迁移
 *  1. 1-4 卡关：单人 vs 两人（剑修开局 / 法修开局），按等级的胜率表
 *  2. 布阵：两人时剑修前 / 法修后 vs 反过来
 *  3. 模拟玩家：标准玩家（推关战斗按 2× 观看 + 每场阅读点击）和全自动玩家（只在引导处点确认）
 *  4. 招募随机性：按招到的角色品质 / 资质分组看通关等级和用时
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
const out = [];
const log = (s = '') => { out.push(s); console.log(s); };
const pct = (x) => Math.round(x * 100) + '%';
const q = (arr, p) => { const a = arr.filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null; };
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
const min = (ms) => (ms == null ? '—' : (ms / 60000).toFixed(1));
const T0 = new Date(2026, 9, 24, 9, 0, 0).getTime(); // 模拟时钟起点（本地上午 9 点，一整天内不会跨日）
const checks = [];

const t0 = Date.now();
log('# 阶段 1 验收报告');
log();
log(`> 由 \`node cli/stage1.js ${PLAYERS}\` 生成。数值为占位，配置见 \`src/config/game.js\`。`);
log();

// ---------------- 工具：构造固定阵容 ----------------
/** 标准招募角色：互补定位、成长与开局同定位角色相同（资质 1.00）、1 条 50 档属性天赋 */
function stdRecruit(save, role) {
  const c = G.rollRecruit(save, { role, quality: 'blue' });
  const st = C.starters[role];
  c.growth = JSON.parse(JSON.stringify(st.growth));
  c.innate = st.innate;
  c.talents = [{ id: role === 'sword' ? 'li' : 'zhi', roll: 0.5 }];
  return c;
}
function soloSave(role, level) {
  const s = G.newSave(role, 't', T0);
  s.roster[0].level = level;
  return s;
}
function duoSave(role, level, reversed) {
  const s = soloSave(role, level);
  const other = role === 'sword' ? 'mage' : 'sword';
  const c = stdRecruit(s, other);
  c.level = Math.max(1, level + C.recruit.levelOffset);
  s.nextId++;
  s.roster.push(c);
  s.research.slots = 2;
  G.addToLineup(s, c.id);
  if (reversed) G.swapRows(s);
  return s;
}
function winRate(save, stageId, n) {
  let w = 0;
  for (let i = 0; i < n; i++) { save.seedCounter = 5000 + i; if (G.runBattle(save, stageId).win) w++; }
  return w / n;
}

// ---------------- 0. 确定性与迁移 ----------------
log('## 0. 确定性与存档迁移');
log();
{
  const s = duoSave('sword', 5);
  s.seedCounter = 42;
  const a = JSON.stringify(G.runBattle(s, '1-7', { record: true }).result.timeline);
  const b = JSON.stringify(G.runBattle(s, '1-7', { record: true }).result.timeline);
  const s1 = G.newSave('mage', 'x', T0), s2 = G.newSave('mage', 'x', T0);
  s1.gachaSeed = s2.gachaSeed = 77;
  const r1 = JSON.stringify(G.rollRecruit(s1)), r2 = JSON.stringify(G.rollRecruit(s2));
  const ok = a === b && r1 === r2;
  checks.push(['同种子结果一致（战斗、招募）', ok]);
  log(`- 同种子战斗结果一致、同招募种子出同一个角色：**${ok ? '是' : '否'}**`);

  const v1 = { v: 1, createdAt: T0, seedCounter: 37, hero: { name: '老玩家', role: 'sword', level: 6, exp: 12, base: { str: 14, agi: 10, int: 4 }, growth: { str: 3, agi: 2, int: 0.8 }, innate: 'jianqizhan', branch: 0, talents: [{ id: 'li', roll: 0.5 }] }, progress: { cleared: { '1-1': 3, '1-2': 1, '1-3': 2, '1-4': 1 } }, idle: { stageId: '1-3' }, stats: { battles: 30, wins: 25, kills: 50, expTotal: 400, playMs: 600000 } };
  const m = G.migrate(JSON.parse(JSON.stringify(v1)), T0);
  const v1b = JSON.parse(JSON.stringify(v1)); v1b.progress.cleared = { '1-1': 1, '1-2': 1 };
  const m2 = G.migrate(v1b, T0);
  const okM = m && m.v === C.saveVersion && m.roster.length === 1 && m.roster[0].level === 6 && m.roster[0].exp === 12 && m.seedCounter === 37 &&
    m.unlocks.cave && G.currentGuide(m) === 'cave' && m.progress.cleared['1-3'] === 2 && m.gold === C.migration.v1StartGold &&
    m2 && !m2.unlocks.cave && G.nextStage(m2).id === '1-3';
  checks.push(['阶段 0 存档能迁移', !!okM]);
  log(`- 阶段 0（v1）存档迁移：等级、经验、种子、通关记录保留，补 ${C.migration.v1StartGold} 金；打过 1-4 的直接开放洞府，没打过的不开放：**${okM ? '通过' : '不通过'}**`);
  log();
}

// ---------------- 1. 1-4 卡关 ----------------
log('## 1. 1-4 卡关：单人 vs 两人');
log();
log('两人 = 开局角色 Lv N + 互补定位的标准招募角色 Lv N−1（资质与开局角色相同），默认站位。每格 200 个种子。');
log();
const LV = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const gate = C.recruit.unlockStage;
const gateLv = {};
for (const role of ROLES) {
  const rows = { solo: [], duo: [], rev: [] };
  for (const lv of LV) {
    rows.solo.push(winRate(soloSave(role, lv), gate, 200));
    rows.duo.push(winRate(duoSave(role, lv), gate, 200));
    rows.rev.push(winRate(duoSave(role, lv, true), gate, 200));
  }
  const first = (arr, th) => { const i = arr.findIndex((x) => x >= th); return i < 0 ? null : LV[i]; };
  gateLv[role] = { solo50: first(rows.solo, 0.5), duo50: first(rows.duo, 0.5), solo80: first(rows.solo, 0.8), duo80: first(rows.duo, 0.8) };
  log(`### ${RN[role]}开局`);
  log();
  log('| 阵容 | ' + LV.map((l) => 'Lv' + l).join(' | ') + ' | ≥50% | ≥80% |');
  log('|---' + '|---'.repeat(LV.length + 2) + '|');
  const fmt = (x) => (x == null ? '>12' : 'Lv' + x);
  log(`| 单人 | ${rows.solo.map(pct).join(' | ')} | ${fmt(first(rows.solo, 0.5))} | ${fmt(first(rows.solo, 0.8))} |`);
  log(`| 两人（默认站位） | ${rows.duo.map(pct).join(' | ')} | ${fmt(first(rows.duo, 0.5))} | ${fmt(first(rows.duo, 0.8))} |`);
  log(`| 两人（站位反过来） | ${rows.rev.map(pct).join(' | ')} | ${fmt(first(rows.rev, 0.5))} | ${fmt(first(rows.rev, 0.8))} |`);
  log();
}

// ---------------- 2. 布阵 ----------------
log('## 2. 布阵：剑修前 / 法修后 vs 反过来');
log();
log('每关取「默认站位胜率首次 ≥ 50%」的等级，比较两种站位的胜率。每格 300 个种子。');
log();
log('| 开局 | 关卡 | 等级 | 剑前法后 | 反过来 | 差 |');
log('|---|---|---|---|---|---|');
const formDiffs = [];
for (const role of ROLES) {
  for (const st of C.chapters[0].stages.slice(3)) {
    let lv = null, d = 0, r = 0;
    for (const L of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
      d = winRate(duoSave(role, L), st.id, 120);
      if (d >= 0.5) { lv = L; break; }
    }
    if (lv == null) { log(`| ${RN[role]} | ${st.id} ${st.name} | >15 | — | — | — |`); continue; }
    d = winRate(duoSave(role, lv), st.id, 300);
    r = winRate(duoSave(role, lv, true), st.id, 300);
    formDiffs.push(d - r);
    log(`| ${RN[role]} | ${st.id} ${st.name} | Lv${lv} | ${pct(d)} | ${pct(r)} | ${d - r >= 0 ? '+' : ''}${Math.round((d - r) * 100)} |`);
  }
}
log();

// ---------------- 3. 模拟玩家 ----------------
/**
 * 一个玩家：按自动推关策略走；引导处等 guideMs 后确认；研究按模拟时钟推进。
 * watchOverhead=true：推关战斗按 2× 观看并加阅读点击时间；false：全自动，只在引导处点确认。
 * solo=true：从不招募（测单人硬过 1-4 要多少级）。
 */
function simulate(role, idx, opts) {
  const E = C.estimate;
  let now = T0;
  const save = G.newSave(role, 'sim', now);
  save.seedCounter = 100000 + idx * 7919;
  save.gachaSeed = 1 + idx * 104729;
  const res = { role, done: false, gateLv: null, gateAt: null, clearLv: null, clearAt: null, pushMs: 0, idleMs: 0, guideMs: 0, recruit: null, battles: 0 };
  let guard = 0;
  while (guard++ < 4000) {
    G.tickResearch(save, now);
    if (save.guide.queue.length && opts.solo) { save.guide.queue = []; } // 单人对照：忽略引导，不招募
    const d = G.autoDecide(save);
    if (d.type === 'wait') {
      if (d.reason === 'guide') {
        now += E.guideMs; res.guideMs += E.guideMs;
        const info = G.ackGuide(save, d.guide, now);
        if (info.recruit && info.recruit.char) res.recruit = info.recruit.char;
        if (d.guide.startsWith('done:')) break;
        continue;
      }
      if (d.reason === 'boss') { now += E.guideMs; res.guideMs += E.guideMs; G.confirmBoss(save, d.stageId); continue; }
      break;
    }
    const isPush = d.type === 'challenge';
    const o = G.runBattle(save, d.stageId);
    const ms = isPush ? G.durationMs(o.result, E.watchSpeed) + (opts.watchOverhead ? E.overheadMs : 0) : G.backgroundBattleMs(o);
    now += ms;
    if (isPush) res.pushMs += ms; else res.idleMs += ms;
    res.battles++;
    const lvBefore = G.maxLevel(save);
    G.applyOutcome(save, o, { kind: isPush ? 'push' : 'idle', elapsedMs: ms });
    if (o.win && o.stageId === gate && res.gateAt == null) { res.gateLv = lvBefore; res.gateAt = now - T0; }
    if (G.chapterDone(save, 'qingshi') && res.clearAt == null) { res.clearLv = G.starter(save).level; res.clearAt = now - T0; res.done = true; if (opts.stopAtClear) break; }
    if (now - T0 > 90 * 60000) break;
  }
  res.total = now - T0;
  res.save = save;
  return res;
}

log('## 3. 模拟玩家：从选角到打完第一段');
log();
log(`策略：自动推关（胜了打下一关；最新关输了退回最高已通关的关卡挂机；上阵角色升级后再挑战一次）。引导处等 ${C.estimate.guideMs / 1000} 秒后确认（首抽免费招募 → 研究第 2 个上阵位 → 布阵 → 首领确认）。推关战斗按 ${C.estimate.watchSpeed}× 计时；挂机按 ${C.idle.speed}× 计时、每场间隔 ${C.idle.gapMs / 1000} 秒；研究按真实时间推进。每种开局 ${PLAYERS} 名玩家。`);
log();
log('- **标准玩家**：推关战斗每场另加 ' + C.estimate.overheadMs / 1000 + ' 秒阅读点击');
log('- **全自动玩家**：完全不操作，只在引导处点确认');
log();
const sims = {};
for (const kind of ['std', 'auto']) {
  sims[kind] = {};
  for (const role of ROLES) {
    sims[kind][role] = [];
    for (let i = 0; i < PLAYERS; i++) sims[kind][role].push(simulate(role, i, { watchOverhead: kind === 'std', stopAtClear: true }));
  }
}
log('| 玩家 | 开局 | 打完第一段 | 总用时 分钟 中位（P10–P90） | 挂机占比 中位（P90） | 1-4 通关时最高等级 | 第一段通关时开局角色等级 中位（P10–P90） |');
log('|---|---|---|---|---|---|---|');
const summary = {};
for (const kind of ['std', 'auto']) {
  summary[kind] = {};
  for (const role of ROLES) {
    const s = sims[kind][role];
    const share = s.map((x) => x.idleMs / x.total);
    summary[kind][role] = { time: q(s.map((x) => x.clearAt), 0.5), share: q(share, 0.5), share90: q(share, 0.9), clearLv: q(s.map((x) => x.clearLv), 0.5), done: s.filter((x) => x.done).length / s.length };
    log(`| ${kind === 'std' ? '标准' : '全自动'} | ${RN[role]} | ${pct(summary[kind][role].done)} | ${min(q(s.map((x) => x.clearAt), 0.5))}（${min(q(s.map((x) => x.clearAt), 0.1))}–${min(q(s.map((x) => x.clearAt), 0.9))}） | ${pct(summary[kind][role].share)}（${pct(summary[kind][role].share90)}） | Lv${q(s.map((x) => x.gateLv), 0.5)} | Lv${q(s.map((x) => x.clearLv), 0.5)}（${q(s.map((x) => x.clearLv), 0.1)}–${q(s.map((x) => x.clearLv), 0.9)}） |`);
  }
}
log();
// 单人对照：从不招募，硬过 1-4 要多少级
const solo = {};
for (const role of ROLES) {
  const s = [];
  for (let i = 0; i < Math.min(100, PLAYERS); i++) s.push(simulate(role, i, { watchOverhead: true, solo: true, stopAtClear: true }));
  solo[role] = s;
}
log('单人硬过 1-4（从不招募的对照玩家）与两人玩家对比：');
log();
log('| 开局 | 单人 1-4 通关等级 中位 | 单人到 1-4 通关用时 | 两人（标准玩家）1-4 通关时最高等级 中位 | 差 |');
log('|---|---|---|---|---|');
const gateGap = {};
for (const role of ROLES) {
  const sl = q(solo[role].map((x) => x.gateLv), 0.5);
  const dl = q(sims.std[role].map((x) => x.gateLv), 0.5);
  gateGap[role] = sl != null && dl != null ? sl - dl : null;
  log(`| ${RN[role]} | ${sl == null ? '90 分钟内未通过' : 'Lv' + sl} | ${min(q(solo[role].map((x) => x.gateAt), 0.5))} 分钟 | Lv${dl} | ${gateGap[role] == null ? '—' : gateGap[role]} |`);
}
log();
log('各关首次通关的累计用时（标准玩家，分钟，中位）：');
log();
{
  // 重跑少量玩家记录每关时间点
  const per = {};
  for (const role of ROLES) {
    per[role] = {};
    for (let i = 0; i < Math.min(100, PLAYERS); i++) {
      const E = C.estimate;
      let now = T0;
      const save = G.newSave(role, 'p', now);
      save.seedCounter = 100000 + i * 7919; save.gachaSeed = 1 + i * 104729;
      let guard = 0;
      while (guard++ < 4000 && !G.chapterDone(save, 'qingshi')) {
        G.tickResearch(save, now);
        const d = G.autoDecide(save);
        if (d.type === 'wait') {
          now += E.guideMs;
          if (d.reason === 'guide') G.ackGuide(save, d.guide, now); else if (d.reason === 'boss') G.confirmBoss(save, d.stageId); else break;
          continue;
        }
        const o = G.runBattle(save, d.stageId);
        now += d.type === 'challenge' ? G.durationMs(o.result, E.watchSpeed) + E.overheadMs : G.backgroundBattleMs(o);
        const was = G.isCleared(save, o.stageId);
        G.applyOutcome(save, o, {});
        if (o.win && !was) (per[role][o.stageId] = per[role][o.stageId] || []).push({ t: now - T0, lv: G.maxLevel(save) });
      }
    }
  }
  log('| 关卡 | ' + ROLES.map((r) => `${RN[r]} 用时 | ${RN[r]} 最高等级`).join(' | ') + ' |');
  log('|---' + '|---|---'.repeat(ROLES.length) + '|');
  for (const st of C.chapters[0].stages) {
    const cells = [];
    for (const role of ROLES) {
      const arr = per[role][st.id] || [];
      cells.push(min(q(arr.map((x) => x.t), 0.5)), 'Lv' + q(arr.map((x) => x.lv), 0.5));
    }
    log(`| ${st.id} ${st.name} | ${cells.join(' | ')} |`);
  }
  log();
}

// ---------------- 4. 招募随机性 ----------------
log('## 4. 招募随机性：首抽角色的品质 / 资质对通关的影响（标准玩家）');
log();
log('| 开局 | 首抽品质 | 人数 | 资质（成长倍率）均值 | 第一段用时 中位（P90） | 通关时开局角色等级 中位（P90） |');
log('|---|---|---|---|---|---|');
for (const role of ROLES) {
  const s = sims.std[role].filter((x) => x.recruit);
  for (const qk of Object.keys(C.recruit.qualities)) {
    const g = s.filter((x) => x.recruit.quality === qk);
    if (!g.length) continue;
    log(`| ${RN[role]} | ${C.recruit.qualities[qk].name} | ${g.length} | ${mean(g.map((x) => G.aptitude(x.recruit))).toFixed(2)} | ${min(q(g.map((x) => x.clearAt), 0.5))}（${min(q(g.map((x) => x.clearAt), 0.9))}） | Lv${q(g.map((x) => x.clearLv), 0.5)}（${q(g.map((x) => x.clearLv), 0.9)}） |`);
  }
}
log();
log('按首抽资质四分位：');
log();
log('| 开局 | 资质分组 | 资质范围 | 第一段用时 中位（P90） | 通关时开局角色等级 中位（P90） |');
log('|---|---|---|---|---|');
const aptGap = {};
for (const role of ROLES) {
  const s = sims.std[role].filter((x) => x.recruit).map((x) => ({ x, a: G.aptitude(x.recruit) })).sort((a, b) => a.a - b.a);
  const n = s.length;
  const groups = [['最差 25%', s.slice(0, Math.floor(n / 4))], ['中间 50%', s.slice(Math.floor(n / 4), Math.floor((3 * n) / 4))], ['最好 25%', s.slice(Math.floor((3 * n) / 4))]];
  for (const [label, g] of groups) {
    log(`| ${RN[role]} | ${label} | ${g[0].a.toFixed(2)}–${g[g.length - 1].a.toFixed(2)} | ${min(q(g.map((y) => y.x.clearAt), 0.5))}（${min(q(g.map((y) => y.x.clearAt), 0.9))}） | Lv${q(g.map((y) => y.x.clearLv), 0.5)}（${q(g.map((y) => y.x.clearLv), 0.9)}） |`);
  }
  aptGap[role] = { time: q(groups[0][1].map((y) => y.x.clearAt), 0.5) - q(groups[2][1].map((y) => y.x.clearAt), 0.5), lv: q(groups[0][1].map((y) => y.x.clearLv), 0.5) - q(groups[2][1].map((y) => y.x.clearLv), 0.5), done: groups[0][1].every((y) => y.x.done) };
}
log();

// ---------------- 验收 ----------------
log('## 5. 验收');
log();
const S = summary.std, A = summary.auto;
for (const role of ROLES) {
  checks.push([`1-4 单人通关等级比两人高 ≥ 3 级（${RN[role]}开局：单人模拟 Lv${q(solo[role].map((x) => x.gateLv), 0.5)}，两人 Lv${q(sims.std[role].map((x) => x.gateLv), 0.5)}；胜率表 ≥50%：单人 ${gateLv[role].solo50 == null ? '>12' : 'Lv' + gateLv[role].solo50}，两人 Lv${gateLv[role].duo50}）`, gateGap[role] != null && gateGap[role] >= 3]);
}
for (const role of ROLES) {
  checks.push([`第一段总时长 10–15 分钟（标准玩家，${RN[role]}开局：${min(S[role].time)} 分钟）`, S[role].time >= 10 * 60000 && S[role].time <= 15 * 60000]);
  checks.push([`挂机时间不超过三分之一（标准玩家，${RN[role]}开局：中位 ${pct(S[role].share)}）`, S[role].share <= 1 / 3]);
}
for (const role of ROLES) checks.push([`全自动玩家能打完第一段（${RN[role]}开局：${pct(A[role].done)}，用时 ${min(A[role].time)} 分钟）`, A[role].done === 1]);
const lvGap = Math.abs(S.sword.clearLv - S.mage.clearLv);
checks.push([`剑修开局、法修开局第一段通关等级差 ≤ 2（Lv${S.sword.clearLv} vs Lv${S.mage.clearLv}）`, lvGap <= 2]);
for (const role of ROLES) checks.push([`招到差资质不会卡死（${RN[role]}开局：最差 25% 比最好 25% 慢 ${min(aptGap[role].time)} 分钟、通关等级高 ${aptGap[role].lv} 级，全部打完：${aptGap[role].done ? '是' : '否'}）`, aptGap[role].done]);
checks.push([`两人时剑修前 / 法修后明显优于反过来（平均胜率差 +${Math.round(mean(formDiffs) * 100)} 个百分点，最小 ${Math.round(Math.min(...formDiffs) * 100)}）`, mean(formDiffs) >= 0.15]);
for (const [name, ok] of checks) log(`- ${ok ? '✅' : '❌'} ${name}`);
log();
log(`---\n耗时 ${((Date.now() - t0) / 1000).toFixed(1)} s`);

fs.writeFileSync(path.join(__dirname, '..', 'docs', 'STAGE1_REPORT.md'), out.join('\n') + '\n');
console.error('\n已写入 docs/STAGE1_REPORT.md');
