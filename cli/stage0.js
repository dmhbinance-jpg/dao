#!/usr/bin/env node
/**
 * 阶段 0 验收：剑修、法修通过引导关第一段的等级和用时。
 *   node cli/stage0.js [模拟玩家数=200]     结果写入 docs/STAGE0_REPORT.md
 *
 * 两部分：
 *  1. 胜率表：每关 × 每个等级，用全新角色打 200 个种子，看几级能稳定通过
 *  2. 模拟新玩家：按顺序打下一关，打不过就挂机刷已通关的最后一关直到升一级，再回来打
 *     时长 = 手动战斗（按 2× 观看 + 每场阅读点击时间）+ 挂机战斗（挂机计时）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DAO = require('../src/node.js');
const S0 = DAO.Stage0;
const C = DAO.CONFIG.stage0;

const PLAYERS = Number(process.argv[2] || 200);
const ROLES = ['sword', 'mage'];
const ROLE_NAME = { sword: '剑修', mage: '法修' };
const out = [];
const log = (s = '') => { out.push(s); console.log(s); };
const pct = (x) => Math.round(x * 100) + '%';
const q = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const min = (ms) => (ms / 60000).toFixed(1);

const t0 = Date.now();
log('# 阶段 0 验收报告');
log();
log(`> 由 \`node cli/stage0.js ${PLAYERS}\` 生成。数值为占位，配置见 \`src/config/stage0.js\`。`);
log();

// ---------- 0. 确定性 ----------
{
  const save = S0.newSave('sword', 't');
  save.hero.level = 5;
  const a = JSON.stringify(S0.runBattle(save, '1-6', { record: true }).result.log);
  const b = JSON.stringify(S0.runBattle(save, '1-6', { record: true }).result.log);
  log(`同种子战斗结果一致：**${a === b ? '是' : '否'}**`);
  log();
}

// ---------- 1. 胜率表 ----------
log('## 1. 各关胜率（全新角色，200 个种子）');
log();
const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const minLevel = { sword: {}, mage: {} };
for (const role of ROLES) {
  log(`### ${ROLE_NAME[role]}`);
  log();
  log('| 关卡 | ' + LEVELS.map((l) => 'Lv' + l).join(' | ') + ' | 胜率≥50% | ≥80% |');
  log('|---' + '|---'.repeat(LEVELS.length + 2) + '|');
  for (const st of S0.stages()) {
    const cells = [];
    let l50 = null, l80 = null;
    for (const lv of LEVELS) {
      const save = S0.newSave(role, 't');
      save.hero.level = lv;
      let w = 0;
      for (let i = 0; i < 200; i++) {
        save.seedCounter = 1000 + i;
        if (S0.runBattle(save, st.id).win) w++;
      }
      const r = w / 200;
      if (l50 == null && r >= 0.5) l50 = lv;
      if (l80 == null && r >= 0.8) l80 = lv;
      cells.push(pct(r));
    }
    minLevel[role][st.id] = { l50, l80 };
    log(`| ${st.id} ${st.name} | ${cells.join(' | ')} | ${l50 == null ? '>12' : 'Lv' + l50} | ${l80 == null ? '>12' : 'Lv' + l80} |`);
  }
  log();
}

// ---------- 2. 模拟新玩家 ----------
function simulatePlayer(role, seedBase) {
  const save = S0.newSave(role, 'sim');
  save.seedCounter = seedBase;
  let clock = 0, manual = 0, idle = 0, losses = 0;
  const clearLv = {}, clearAt = {};
  const E = C.estimate;
  let guard = 0;
  while (!S0.chapterCleared(save) && guard++ < 3000) {
    const st = S0.nextStage(save);
    const lv = save.hero.level;
    const o = S0.runBattle(save, st.id);
    clock += S0.durationMs(o.result, E.manualSpeed) + E.overheadMs;
    manual++;
    S0.applyOutcome(save, o);
    if (o.win) { clearLv[st.id] = lv; clearAt[st.id] = clock; continue; }
    losses++;
    // 打不过：挂机刷已通关的最后一关，直到升一级
    const farm = S0.bestClearedStage(save);
    if (!farm) continue;
    const target = save.hero.level + 1;
    while (save.hero.level < target && save.hero.level < C.maxLevel && guard++ < 3000) {
      const f = S0.runBattle(save, farm.id);
      clock += S0.idleBattleMs(f);
      idle++;
      S0.applyOutcome(save, f);
    }
  }
  return { done: S0.chapterCleared(save), clock, manual, idle, losses, clearLv, clearAt, finalLevel: save.hero.level };
}

log('## 2. 模拟新玩家：从选角到打完第一段');
log();
log(`策略：按顺序打下一关；打输了就挂机刷已通关的最后一关，升一级再回来。手动战斗按 ${C.estimate.manualSpeed}× 观看并加 ${C.estimate.overheadMs / 1000} 秒阅读点击；挂机按 ${C.idle.speed}× 计时、每场间隔 ${C.idle.gapMs / 1000} 秒。每个定位模拟 ${PLAYERS} 名玩家（种子不同）。`);
log();
const sims = {};
for (const role of ROLES) {
  sims[role] = [];
  for (let p = 0; p < PLAYERS; p++) sims[role].push(simulatePlayer(role, 100000 + p * 5000));
}
log('| 定位 | 全部通关 | 首领通关等级 中位（P10–P90） | 总用时 分钟 中位（P10–P90） | 手动场次 | 挂机场次 | 战败次数 |');
log('|---|---|---|---|---|---|---|');
const summary = {};
for (const role of ROLES) {
  const s = sims[role];
  const boss = s.map((x) => x.clearLv['1-8']).filter((x) => x != null);
  const t = s.map((x) => x.clock);
  summary[role] = { boss: q(boss, 0.5), time: q(t, 0.5) };
  log(`| ${ROLE_NAME[role]} | ${pct(s.filter((x) => x.done).length / s.length)} | Lv${q(boss, 0.5)}（${q(boss, 0.1)}–${q(boss, 0.9)}） | ${min(q(t, 0.5))}（${min(q(t, 0.1))}–${min(q(t, 0.9))}） | ${q(s.map((x) => x.manual), 0.5)} | ${q(s.map((x) => x.idle), 0.5)} | ${q(s.map((x) => x.losses), 0.5)} |`);
}
log();
log('各关首次通关时的等级（中位）与累计用时（分钟，中位）：');
log();
log('| 关卡 | ' + ROLES.map((r) => `${ROLE_NAME[r]} 等级 | ${ROLE_NAME[r]} 用时`).join(' | ') + ' |');
log('|---' + '|---|---'.repeat(ROLES.length) + '|');
for (const st of S0.stages()) {
  const cells = [];
  for (const role of ROLES) {
    const s = sims[role];
    cells.push('Lv' + q(s.map((x) => x.clearLv[st.id]).filter((x) => x != null), 0.5));
    cells.push(min(q(s.map((x) => x.clearAt[st.id]).filter((x) => x != null), 0.5)));
  }
  log(`| ${st.id} ${st.name} | ${cells.join(' | ')} |`);
}
log();

// ---------- 验收结论 ----------
const gap = Math.abs(summary.sword.boss - summary.mage.boss);
log('## 3. 验收');
log();
log(`- 首领通关等级：剑修 Lv${summary.sword.boss}，法修 Lv${summary.mage.boss}，差 ${gap} 级（要求 ≤ 2）：**${gap <= 2 ? '通过' : '不通过'}**`);
log(`- 选角到打完第一段：剑修 ${min(summary.sword.time)} 分钟，法修 ${min(summary.mage.time)} 分钟（要求约 10–20）：**${[summary.sword.time, summary.mage.time].every((x) => x >= 9 * 60000 && x <= 21 * 60000) ? '通过' : '不通过'}**`);
log();
log(`---\n耗时 ${((Date.now() - t0) / 1000).toFixed(1)} s`);

fs.writeFileSync(path.join(__dirname, '..', 'docs', 'STAGE0_REPORT.md'), out.join('\n') + '\n');
console.error('\n已写入 docs/STAGE0_REPORT.md');
