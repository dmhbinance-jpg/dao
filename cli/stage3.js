#!/usr/bin/env node
/**
 * 阶段 3 验收：采集灵矿 + 锻造装备 + 第三段引导关。
 *   node cli/stage3.js [每种开局模拟玩家数=300] [阶梯快照数=40]     结果写入 docs/STAGE3_REPORT.md
 *
 *  0. 同种子一致；阶段 2（v3）存档迁移
 *  1. 第三段：穿一套中档白装 vs 不穿的通关等级（用模拟玩家第二段通关时的真实阵容做快照，改等级）
 *  2. 模拟玩家：从选角一路玩到第三段通关，统计第三段（第二段首领通关 → 第三段首领通关）的用时、挂机占比、
 *     上阵 / 研究 / 采集 / 闲置的「角色·分钟」、装备、金币和灵矿结余
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DAO = require('../src/node.js');
const G = DAO.Game;
const C = DAO.CONFIG.game;

const PLAYERS = Number(process.argv[2] || 300);
const SNAPS = Number(process.argv[3] || 40);
const ROLES = ['sword', 'mage'];
const RN = { sword: '剑修', mage: '法修' };
const CH1 = C.chapters[0].id, CH2 = C.chapters[1].id, CH3 = C.chapters[2].id;
const SEG3 = C.chapters[2].stages.map((s) => s.id);
const BOSS3 = SEG3[SEG3.length - 1];
const out = [];
const log = (s = '') => { out.push(s); console.log(s); };
const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
const q = (arr, p) => { const a = arr.filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null; };
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
const min = (ms) => (ms == null ? '—' : (ms / 60000).toFixed(1));
const num = (x) => (x == null ? '—' : Math.round(x).toLocaleString('en-US'));
const T0 = new Date(2026, 9, 24, 9, 0, 0).getTime();
const clone = (o) => JSON.parse(JSON.stringify(o));
const checks = [];
const t0 = Date.now();

log('# 阶段 3 验收报告');
log();
log(`> 由 \`node cli/stage3.js ${PLAYERS} ${SNAPS}\` 生成。数值为占位，配置见 \`src/config/game.js\`（gather / forge / 第三段 tieyan）。`);
log();

// ---------------- 模拟玩家 ----------------
/**
 * 从选角玩到第三段通关。
 * kind = 'std'：推关战斗按 2× 观看 + 阅读点击；引导和提示确认；有闲人且金币够就研究上阵位；
 *               第三段起按「下一件装备」（Game.nextUpgrade：上阵角色先补齐中品，再往上品走）够了就打造并穿上。
 * kind = 'auto'：只在引导 / 提示处点确认（采集引导默认派力资质最高的闲置角色，锻造引导打一件下品武器），不做可选研究、不主动锻造。
 */
function simulate(role, idx, kind, wantSnap) {
  const E = C.estimate;
  let now = T0;
  const save = G.newSave(role, 'sim', now);
  save.seedCounter = 300000 + idx * 7919;
  save.gachaSeed = 7 + idx * 104729;
  save.rollSeed = 11 + idx * 3571;
  const r = { role, kind, done: false, t2: null, t3: null, push3: 0, idle3: 0, wait3: 0, forge3: 0, cm: { lineup: 0, research: 0, gather: 0, idle: 0 }, gatherPlan: null, firstGearAt: null };
  let guard = 0;
  const seg3 = () => r.t2 != null;
  const advance = (ms, bucket) => {
    if (seg3()) {
      r[bucket] += ms;
      const nL = save.lineup.length, nR = save.research.active ? 1 : 0, nG = save.gather.ids.length;
      r.cm.lineup += ms * nL; r.cm.research += ms * nR; r.cm.gather += ms * nG;
      r.cm.idle += ms * Math.max(0, save.roster.length - nL - nR - nG);
    }
    now += ms;
    G.tickGather(save, now);
  };
  while (guard++ < 12000) {
    G.tickResearch(save, now);
    G.tickGather(save, now);
    if (kind === 'std' && save.unlocks.cave && !save.research.active && G.researchNext(save)) {
      const idle = save.roster.find((c) => G.status(save, c.id) === 'idle');
      if (idle && !G.researchBlock(save, idle.id)) G.startResearch(save, idle.id, now);
    }
    if (kind === 'std' && save.unlocks.forge) {
      let g2 = 0;
      for (let u = G.nextUpgrade(save); u && u.affordable && g2++ < 20; u = G.nextUpgrade(save)) {
        G.doUpgrade(save, u);
        if (r.firstGearAt == null && seg3()) r.firstGearAt = now - r.t2;
        advance(E.forgeMs, 'forge3');
      }
    }
    const d = G.autoDecide(save);
    if (d.type === 'wait') {
      advance(E.guideMs, 'wait3');
      if (d.reason === 'guide') {
        const info = G.ackGuide(save, d.guide, now);
        if (d.guide === 'gather' && info.ok) r.gatherPlan = info.recruit ? 'recruit' : (G.gatherPlan ? 'ok' : '');
        if (d.guide === 'forge' && info.item && r.firstGearAt == null) r.firstGearAt = now - r.t2;
        if (d.guide === 'done:' + CH3) break;
      } else if (d.reason === 'boss') G.confirmBoss(save, d.stageId);
      else if (d.reason === 'cards') G.autoHandleCards(save);
      else break;
      continue;
    }
    const push = d.type === 'challenge';
    const o = G.runBattle(save, d.stageId);
    const ms = push ? G.durationMs(o.result, E.watchSpeed) + (kind === 'std' ? E.overheadMs : 0) : G.backgroundBattleMs(o);
    advance(ms, push ? 'push3' : 'idle3');
    G.applyOutcome(save, o, { kind: push ? 'push' : 'idle', elapsedMs: ms });
    if (r.t2 == null && G.chapterDone(save, CH2)) {
      r.t2 = now; r.gold2 = save.gold; r.inc2 = save.stats.goldTotal; r.lv2 = G.starter(save).level; r.roster2 = save.roster.length;
      r.idleAt2 = save.roster.filter((c) => G.status(save, c.id) === 'idle').length;
      r.researchAt2 = !!save.research.active;
      G.tickGather(save, now);
      if (wantSnap) r.snap = clone(save);
    }
    if (r.t3 == null && G.chapterDone(save, CH3)) {
      r.t3 = now; r.done = true; r.lv3 = G.starter(save).level;
      r.gold3 = save.gold; r.ore3 = save.ore; r.inc3 = save.stats.goldTotal - r.inc2; r.oreInc3 = save.stats.oreTotal;
      r.forgeGold = save.stats.forgeGold; r.forgeOre = save.stats.forgeOre; r.forged = save.stats.forged;
      const L = G.lineupChars(save).map((x) => x.char);
      r.mid = L.filter((c) => C.forge.slots.every((s) => c.equip[s] && c.equip[s].tier >= 1)).length + '/' + L.length;
      r.pieces = L.reduce((a, c) => a + C.forge.slots.filter((s) => c.equip[s]).length, 0);
      r.avgTier = mean([].concat(...L.map((c) => C.forge.slots.map((s) => (c.equip[s] ? c.equip[s].tier + 1 : 0)))));
      r.gatherers = save.gather.ids.length;
      r.roster3 = save.roster.length;
    }
    if (now - T0 > 180 * 60000) break;
  }
  if (r.t2 != null) r.dur3 = (r.t3 || now) - r.t2;
  r.final = { gold: save.gold, ore: Math.round(save.ore), seed: save.seedCounter, lv: save.roster.map((c) => c.level).join(',') };
  return r;
}

// ---------------- 0. 确定性与迁移 ----------------
log('## 0. 确定性与存档迁移');
log();
{
  const a = simulate('sword', 3, 'std'), b = simulate('sword', 3, 'std');
  const okD = JSON.stringify(a) === JSON.stringify(b) && a.done;
  checks.push(['同种子结果一致（整局模拟跑两遍逐项相同）', okD]);
  log(`- 同种子整局模拟（战斗、招募、掉落、掷数值、采集、锻造）跑两遍结果相同：**${okD ? '是' : '否'}**`);

  // 阶段 2（v3）存档：打完第二段
  const v3 = G.newSave('mage', '老玩家', T0);
  v3.v = 3;
  delete v3.ore; delete v3.gather; delete v3.gearBag; delete v3.nextGearId;
  delete v3.unlocks.forge;
  for (const k of ['oreTotal', 'gatherCharMs', 'forged', 'forgeGold', 'forgeOre']) delete v3.stats[k];
  delete v3.settings.forgeHints;
  for (const c of v3.roster) delete c.equip;
  v3.roster[0].level = 18; v3.roster[0].card = { id: 'huoyu', roll: 0.7 };
  for (const ch of [C.chapters[0], C.chapters[1]]) for (const st of ch.stages) v3.progress.cleared[st.id] = 1;
  v3.guide.seen = { cave: true, research: true, formation: true, firstCard: true, ['done:' + CH1]: true, ['done:' + CH2]: true };
  v3.gold = 4000; v3.cardsInfo.firstGot = true;
  const m = G.migrate(clone(v3), T0);
  const v3b = clone(v3); v3b.progress.cleared = { '1-1': 1 };
  const m2 = G.migrate(v3b, T0);
  const okM = m && m.v === C.saveVersion && m.unlocks.forge && G.currentGuide(m) === 'gather' && m.ore === 0 && m.roster[0].equip && m.roster[0].level === 18 &&
    m.roster[0].card.roll === 0.7 && m.gold === 4000 && m.settings.forgeHints === true && m2 && !m2.unlocks.forge && m2.guide.queue.length === 0 && G.charUnit(m.roster[0]).base.mAtk > 0;
  checks.push(['阶段 2（v3）存档能迁移（打完第二段的开放采集 / 锻造房并弹采集引导）', !!okM]);
  // 更早的存档走完整条链
  const v2 = clone(v3); v2.v = 2; delete v2.bag; delete v2.rollSeed; delete v2.cardsInfo; delete v2.bagNew; for (const c of v2.roster) delete c.card;
  const m3 = G.migrate(v2, T0);
  const okChain = !!(m3 && m3.v === C.saveVersion && m3.unlocks.forge && Array.isArray(m3.gearBag));
  checks.push(['阶段 1（v2）存档经 v3 迁移到 v4', okChain]);
  log(`- 阶段 2（v3）存档迁移：打完第二段的直接开放采集 / 锻造房并排队采集引导，等级、卡、金币保留；没打完的不开放：**${okM ? '通过' : '不通过'}**`);
  log(`- 阶段 1（v2）存档走 v2→v3→v4 整条链：**${okChain ? '通过' : '不通过'}**`);
  log();
}

// ---------------- 2. 模拟玩家（先跑，阶梯用它的快照） ----------------
const sims = {};
for (const kind of ['std', 'auto']) {
  sims[kind] = {};
  for (const role of ROLES) {
    sims[kind][role] = [];
    for (let i = 0; i < PLAYERS; i++) sims[kind][role].push(simulate(role, i, kind, kind === 'std' && i < SNAPS));
  }
}

// ---------------- 1. 装备 vs 不穿 ----------------
log(`## 1. 第三段：穿一套中档白装 vs 不穿`);
log();
log(`阵容取标准玩家第二段通关那一刻的真实存档（每种开局 ${SNAPS} 份：真实的招募角色、卡和站位），把开局角色设为 Lv N、其他角色 Lv N−1。`);
log('「不穿」= 全部卸下；「中档」= 每个上阵角色穿中品武器 + 中品胸甲 + 中品戒指（戒指加主属性）。每格 = 快照数 × 5 个种子。通关等级 = 胜率 ≥ 50% 的最低等级。');
log();
const LV = []; for (let l = 12; l <= 32; l++) LV.push(l);
function ladderSave(snap, lv, gear) {
  const s = clone(snap);
  // 第二段通关时还在研究的，当作研究已完成（第三段开头几分钟内就会完成）
  if (s.research.active) { const a = s.research.active; s.research.slots = a.level; s.research.active = null; G.addToLineup(s, a.charId); }
  for (const c of s.roster) {
    c.level = c.origin === 'starter' ? lv : Math.max(1, lv - 1);
    for (const slot of C.forge.slots) c.equip[slot] = null;
  }
  if (gear === 'mid') {
    for (const { char } of G.lineupChars(s)) {
      for (const slot of C.forge.slots) char.equip[slot] = { id: 'x' + slot, slot, tier: 1, stat: slot === 'ring' ? G.mainStat(char) : undefined };
    }
  }
  return s;
}
const clearLv = {};
for (const role of ROLES) {
  const snaps = sims.std[role].filter((x) => x.snap).map((x) => x.snap);
  const tbl = {};
  for (const gear of ['none', 'mid']) {
    tbl[gear] = {};
    for (const st of SEG3) tbl[gear][st] = [];
    for (const lv of LV) {
      const saves = snaps.map((sn) => ladderSave(sn, lv, gear));
      for (const st of SEG3) {
        let w = 0, n = 0;
        for (const s of saves) for (let k = 0; k < 5; k++) { s.seedCounter = 9100 + k * 31 + n; n++; if (G.runBattle(s, st).win) w++; }
        tbl[gear][st].push(w / n);
      }
    }
  }
  const first = (arr) => { const i = arr.findIndex((x) => x >= 0.5); return i < 0 ? null : LV[i]; };
  const seg = (gear) => { const ls = SEG3.map((st) => first(tbl[gear][st])); return ls.includes(null) ? null : Math.max(...ls); };
  clearLv[role] = { none: seg('none'), mid: seg('mid'), per: {} };
  for (const st of SEG3) clearLv[role].per[st] = { none: first(tbl.none[st]), mid: first(tbl.mid[st]) };
  log(`### ${RN[role]}开局`);
  log();
  log('| 关卡 | 不穿：通关等级 | 中档白装：通关等级 | 差 |');
  log('|---|---|---|---|');
  for (const st of SEG3) {
    const p = clearLv[role].per[st];
    log(`| ${st} ${G.stageById(st).name} | ${p.none == null ? '>' + LV[LV.length - 1] : 'Lv' + p.none} | ${p.mid == null ? '>' + LV[LV.length - 1] : 'Lv' + p.mid} | ${p.none != null && p.mid != null ? p.none - p.mid : '—'} |`);
  }
  log(`| **整段** | **${clearLv[role].none == null ? '>' + LV[LV.length - 1] : 'Lv' + clearLv[role].none}** | **Lv${clearLv[role].mid}** | **${clearLv[role].none != null ? clearLv[role].none - clearLv[role].mid : '—'}** |`);
  log();
  log(`首领 ${BOSS3} 胜率：`);
  log();
  log('| | ' + LV.map((l) => 'Lv' + l).join(' | ') + ' |');
  log('|---' + '|---'.repeat(LV.length) + '|');
  log('| 不穿 | ' + tbl.none[BOSS3].map(pct).join(' | ') + ' |');
  log('| 中档 | ' + tbl.mid[BOSS3].map(pct).join(' | ') + ' |');
  log();
}

log('## 2. 模拟玩家：第三段（第二段首领通关 → 第三段首领通关）');
log();
log(`策略：沿用阶段 1–2 的自动推关；引导、首领确认、卡牌提示各等 ${C.estimate.guideMs / 1000} 秒后确认。每种开局 ${PLAYERS} 名玩家。采集按模拟时钟连续结算（推关、挂机、等确认期间都在采）。`);
log();
log(`- **标准玩家**：推关战斗每场另加 ${C.estimate.overheadMs / 1000} 秒阅读点击；有闲人且金币够就研究上阵位；第三段起灵矿和金币够了就打造下一件（上阵角色先补齐中品武器 / 胸甲 / 戒指，再换上品），每件 ${C.estimate.forgeMs / 1000} 秒`);
log('- **全自动玩家**：只在引导 / 提示处点确认（采集引导默认派力资质最高的闲置角色，没有闲置就招募一位；锻造引导打一件下品武器给开局角色），不做可选研究、不主动锻造');
log();
log('| 玩家 | 开局 | 打完第三段 | 第三段用时 分钟 中位（P10–P90） | 挂机占比 中位（P90） | 第三段通关时开局角色等级 中位（P10–P90） | 第一件装备 分钟 | 上阵角色装备件数 中位 | 全身中品以上的上阵角色 |');
log('|---|---|---|---|---|---|---|---|---|');
const S = {};
for (const kind of ['std', 'auto']) {
  S[kind] = {};
  for (const role of ROLES) {
    const s = sims[kind][role];
    const share = s.map((x) => x.idle3 / Math.max(1, x.dur3));
    const midFull = s.filter((x) => x.mid).map((x) => Number(x.mid.split('/')[0]));
    S[kind][role] = {
      done: s.filter((x) => x.done).length / s.length, time: q(s.map((x) => x.dur3), 0.5), share: q(share, 0.5), share90: q(share, 0.9),
      lv: q(s.map((x) => x.lv3), 0.5),
    };
    log(`| ${kind === 'std' ? '标准' : '全自动'} | ${RN[role]} | ${pct(S[kind][role].done)} | ${min(S[kind][role].time)}（${min(q(s.map((x) => x.dur3), 0.1))}–${min(q(s.map((x) => x.dur3), 0.9))}） | ${pct(S[kind][role].share)}（${pct(S[kind][role].share90)}） | Lv${S[kind][role].lv}（${q(s.map((x) => x.lv3), 0.1)}–${q(s.map((x) => x.lv3), 0.9)}） | ${min(q(s.map((x) => x.firstGearAt), 0.5))} | ${q(s.map((x) => x.pieces), 0.5)} | 中位 ${q(midFull, 0.5)} 人 |`);
  }
}
log();

log('### 角色·分钟：上阵 / 研究 / 采集 / 闲置');
log();
log('第三段内每个角色每分钟所处的状态加总（中位数）。后三列说明采集的人从哪来：第二段通关时的名册人数、当时有没有闲置角色、采集引导是否靠招募补人（全自动玩家卡关时被引导去研究第 3 个上阵位，采集的人被调去研究，研究完会再引导一次采集，这时通常靠招募补人）。');
log();
log('| 玩家 | 开局 | 上阵 | 研究 | 采集 | 闲置 | 采集占比 | 有人采集的玩家 | 第二段通关时名册 中位 | 当时有闲置角色 | 采集引导靠招募补人 |');
log('|---|---|---|---|---|---|---|---|---|---|---|');
const CM = {};
for (const kind of ['std', 'auto']) {
  for (const role of ROLES) {
    const s = sims[kind][role].filter((x) => x.done);
    const m = (k) => q(s.map((x) => x.cm[k] / 60000), 0.5) || 0;
    const tot = s.map((x) => x.cm.lineup + x.cm.research + x.cm.gather + x.cm.idle);
    const gshare = q(s.map((x, i) => x.cm.gather / Math.max(1, tot[i])), 0.5);
    CM[kind + role] = { gather: m('gather'), share: gshare, anyone: s.filter((x) => x.cm.gather > 0).length / Math.max(1, s.length) };
    log(`| ${kind === 'std' ? '标准' : '全自动'} | ${RN[role]} | ${m('lineup').toFixed(1)} | ${m('research').toFixed(1)} | ${m('gather').toFixed(1)} | ${m('idle').toFixed(1)} | ${pct(gshare)} | ${pct(CM[kind + role].anyone)} | ${q(s.map((x) => x.roster2), 0.5)} | ${pct(s.filter((x) => x.idleAt2 > 0).length / Math.max(1, s.length))} | ${pct(s.filter((x) => x.gatherPlan === 'recruit').length / Math.max(1, s.length))} |`);
  }
}
log();

log('### 金币与灵矿结余（第三段结束时）');
log();
log('| 玩家 | 开局 | 第二段结束金币 中位 | 第三段金币收入 中位 | 锻造花掉金币 中位 | 第三段结束金币 中位（P10–P90） | 第三段灵矿产出 中位 | 锻造花掉灵矿 中位 | 第三段结束灵矿 中位（P10–P90） |');
log('|---|---|---|---|---|---|---|---|---|');
const BAL = {};
for (const kind of ['std', 'auto']) {
  for (const role of ROLES) {
    const s = sims[kind][role].filter((x) => x.done);
    const g3 = s.map((x) => x.gold3), o3 = s.map((x) => x.ore3);
    BAL[kind + role] = { g2: q(s.map((x) => x.gold2), 0.5), g3: q(g3, 0.5), o3: q(o3, 0.5), oreInc: q(s.map((x) => x.oreInc3), 0.5), inc: q(s.map((x) => x.inc3), 0.5) };
    log(`| ${kind === 'std' ? '标准' : '全自动'} | ${RN[role]} | ${num(BAL[kind + role].g2)} | ${num(BAL[kind + role].inc)} | ${num(q(s.map((x) => x.forgeGold), 0.5))} | ${num(q(g3, 0.5))}（${num(q(g3, 0.1))}–${num(q(g3, 0.9))}） | ${num(BAL[kind + role].oreInc)} | ${num(q(s.map((x) => x.forgeOre), 0.5))} | ${num(q(o3, 0.5))}（${num(q(o3, 0.1))}–${num(q(o3, 0.9))}） |`);
  }
}
log();

// ---------------- 验收 ----------------
log('## 3. 验收');
log();
for (const role of ROLES) {
  const c = clearLv[role];
  checks.push([`第三段穿一套中档白装的通关等级比不穿至少低 3 级（${RN[role]}开局：不穿 ${c.none == null ? '>' + LV[LV.length - 1] : 'Lv' + c.none}，中档 Lv${c.mid}）`, c.mid != null && (c.none == null || c.none - c.mid >= 3)]);
}
for (const role of ROLES) {
  checks.push([`第三段总时长 10–20 分钟，含采集等待（标准玩家，${RN[role]}开局：${min(S.std[role].time)} 分钟）`, S.std[role].time >= 10 * 60000 && S.std[role].time <= 20 * 60000]);
  checks.push([`挂机时间不超过三分之一（标准玩家，${RN[role]}开局：中位 ${pct(S.std[role].share)}）`, S.std[role].share <= 1 / 3]);
  checks.push([`采集真的有人去做（标准玩家，${RN[role]}开局：${pct(CM['std' + role].anyone)} 的玩家有人采集，采集占角色·分钟 ${pct(CM['std' + role].share)}）`, CM['std' + role].anyone === 1 && CM['std' + role].share > 0.1]);
  checks.push([`全自动玩家能打完第三段（${RN[role]}开局：${pct(S.auto[role].done)}，用时 ${min(S.auto[role].time)} 分钟）`, S.auto[role].done === 1]);
}
checks.push([`剑修开局、法修开局第三段通关等级差 ≤ 2（Lv${S.std.sword.lv} vs Lv${S.std.mage.lv}）`, Math.abs(S.std.sword.lv - S.std.mage.lv) <= 2]);
for (const role of ROLES) {
  const b = BAL['std' + role];
  checks.push([`第三段结束时没有大量囤积（标准玩家，${RN[role]}开局：金币 ${num(b.g2)} → ${num(b.g3)}，灵矿结余 ${num(b.o3)} / 本段产出 ${num(b.oreInc)}）`, b.g3 <= b.g2 && b.o3 <= Math.max(1, b.oreInc) * 0.25]);
}
for (const [name, ok] of checks) log(`- ${ok ? '✅' : '❌'} ${name}`);
log();
log(`---\n耗时 ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (!process.env.NOWRITE) {
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'STAGE3_REPORT.md'), out.join('\n') + '\n');
  console.error('\n已写入 docs/STAGE3_REPORT.md');
}
