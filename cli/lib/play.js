/**
 * 命令行模拟玩家（cli/stage1.js、stage2.js、stage3.js 共用）。
 *
 *   const P = require('./lib/play.js');
 *   const r = P.simulate('sword', 7, { kind: 'std', until: 'tieyan', seeds: P.SEEDS.s23, snapAt: ['1-12', '2-8'] });
 *
 * 一个玩家从选角开始按自动推关走，模拟时钟按 CONFIG.game.estimate / idle 推进，采集和研究按模拟时钟结算。
 *  - kind 'std'（标准玩家）：推关战斗按 2× 观看 + 每场阅读点击；引导 / 首领 / 卡牌提示 / 3 选 1 等 guideMs 后确认（3 选 1 选默认）；
 *      研究上阵位：金币够就派闲人（没有闲人就调一个采集的人）去研究；第二段起还能研究时，打造装备会先给研究留出金币；
 *      采集开放后闲人都去采集，采集的人少于 stdGatherers（2）时花钱招人去采集（留 200 金余量）；
 *      灵矿和金币够了就按 Game.nextUpgrade 打造并穿上（每件 forgeMs）。
 *  - kind 'auto'（全自动玩家）：只在引导 / 提示 / 3 选 1 处点确认（都用默认），不做可选研究、不主动招募和锻造。
 *  - solo：从不招募（单人对照）。
 * 时间按「当前在打的章节」分段统计：用时、推关 / 挂机 / 等待 / 锻造时间、角色·分钟（上阵 / 研究 / 采集 / 闲置）、
 * 金币和灵矿的收支与结余、开局角色等级、重掷 / 换卡选择、装备件数。
 */
'use strict';
const DAO = require('../../src/node.js');
const G = DAO.Game;
const C = DAO.CONFIG.game;
const clone = (o) => JSON.parse(JSON.stringify(o));

const T0 = new Date(2026, 9, 24, 9, 0, 0).getTime();
/** 每个脚本沿用自己原来的种子方案，方便和旧报告对比 */
const SEEDS = {
  s1: (i) => ({ battle: 100000 + i * 7919, gacha: 1 + i * 104729, roll: 1 }),
  s23: (i) => ({ battle: 300000 + i * 7919, gacha: 7 + i * 104729, roll: 11 + i * 3571 }),
};
const STD_GATHERERS = 2;

function emptySeg(now, save) {
  return { start: now, end: null, push: 0, idle: 0, wait: 0, forge: 0, cm: { lineup: 0, research: 0, gather: 0, idle: 0 },
    gold0: save.gold, goldInc0: save.stats.goldTotal, ore0: save.stats.oreTotal || 0, forgeGold0: save.stats.forgeGold || 0, forgeOre0: save.stats.forgeOre || 0,
    ci0: clone(save.cardsInfo), recruits: 0, recruitGold: 0 };
}
function closeSeg(seg, now, save) {
  seg.end = now;
  seg.dur = now - seg.start;
  seg.gold1 = save.gold;
  seg.goldInc = save.stats.goldTotal - seg.goldInc0;
  seg.ore1 = save.ore || 0;
  seg.oreInc = (save.stats.oreTotal || 0) - seg.ore0;
  seg.forgeGold = (save.stats.forgeGold || 0) - seg.forgeGold0;
  seg.forgeOre = (save.stats.forgeOre || 0) - seg.forgeOre0;
  seg.lv1 = G.starter(save).level;
  seg.rerolls = save.cardsInfo.rerolls - seg.ci0.rerolls;
  seg.swaps = save.cardsInfo.swapOffers - seg.ci0.swapOffers;
  const L = G.lineupChars(save).map((x) => x.char);
  seg.lineup = L.length;
  seg.slots = save.research.slots;
  seg.roster = save.roster.length;
  seg.gatherers = save.gather.ids.length;
  seg.pieces = L.reduce((a, c) => a + C.forge.slots.filter((s) => c.equip[s]).length, 0);
  seg.tiers = [0, 1, 2].map((t) => L.reduce((a, c) => a + C.forge.slots.filter((s) => c.equip[s] && c.equip[s].tier === t).length, 0));
  seg.carded = L.filter((c) => c.card).length;
  delete seg.ci0;
}

/**
 * @param opts { kind, until (章节 id，打完就停), seeds(i) → { battle, gacha, roll }, solo, snapAt: [关卡 id]（这一关成为最新关时存一份存档快照）,
 *               maxMinutes, stdGatherers }
 */
function simulate(role, idx, opts) {
  opts = opts || {};
  const kind = opts.kind || 'std';
  const E = C.estimate;
  const seeds = (opts.seeds || SEEDS.s23)(idx);
  const maxMs = (opts.maxMinutes || 240) * 60000;
  const gatherCap = opts.stdGatherers != null ? opts.stdGatherers : STD_GATHERERS;
  let now = T0;
  const save = G.newSave(role, 'sim', now);
  save.seedCounter = seeds.battle;
  save.gachaSeed = seeds.gacha;
  save.rollSeed = seeds.roll;
  const chs = C.chapters.map((c) => c.id);
  const untilIdx = opts.until ? chs.indexOf(opts.until) : chs.length - 1;
  const r = { role, kind, idx, done: false, segs: {}, clears: {}, gateLv: null, gateAt: null, firstRecruit: null, snaps: {}, firstGearAt: null, forgeAt: null };
  const curCh = () => chs.find((id) => !G.chapterDone(save, id)) || null;
  let seg = emptySeg(now, save);
  let segCh = curCh();

  const advance = (ms, bucket) => {
    if (seg) {
      seg[bucket] += ms;
      const nL = save.lineup.length, nR = save.research.active ? 1 : 0, nG = save.gather.ids.length;
      seg.cm.lineup += ms * nL; seg.cm.research += ms * nR; seg.cm.gather += ms * nG;
      seg.cm.idle += ms * Math.max(0, save.roster.length - nL - nR - nG);
    }
    now += ms;
    G.tickGather(save, now);
  };
  const choose = () => {
    const res = G.chooseRecruit(save, G.defaultChoice(save), now);
    if (res.ok && !r.firstRecruit) r.firstRecruit = res.char;
    if (res.needsDecision) G.resolvePending(save, false);
    return res;
  };
  const snap = () => {
    const nx = G.nextStage(save);
    if (nx && (opts.snapAt || []).includes(nx.id) && !r.snaps[nx.id]) { G.tickGather(save, now); r.snaps[nx.id] = clone(save); }
  };

  let guard = 0;
  while (guard++ < 20000) {
    G.tickResearch(save, now);
    G.tickGather(save, now);
    if (opts.solo && save.guide.queue.length) save.guide.queue = [];
    if (kind === 'std' && !opts.solo) {
      // 研究上阵位：金币够就派闲人去；没有闲人调一个采集的人（智力最高的）
      const nxR = save.unlocks.cave && !save.research.active ? G.researchNext(save) : null;
      if (nxR) {
        const rid = G.pickSlotResearcher(save);
        if (rid && !G.researchBlock(save, rid)) G.startResearch(save, rid, now);
      }
      // 第二段起优先攒钱研究上阵位（第一段的钱留给第一批装备）
      const reserve = chs.indexOf(curCh()) >= 1 && !save.research.active && G.researchNext(save) && G.pickSlotResearcher(save) ? G.researchNext(save).gold : 0;
      if (save.unlocks.forge && save.guide.seen.gather) {
        // 闲人去采集；采集的人不够就招
        for (const c of save.roster) if (G.status(save, c.id) === 'idle') G.startGather(save, c.id, now);
        if (save.gather.ids.length < gatherCap && !save.recruitChoice && G.canRecruit(save) && save.gold >= G.recruitCost(save) + 200) {
          const cost = G.recruitCost(save);
          if (G.recruit(save, now, { reason: 'gather' }).ok) { if (seg) { seg.recruits++; seg.recruitGold += cost; } advance(E.guideMs, 'wait'); choose(); }
        }
        // 打造：按推荐顺序，够了就打
        for (let u = G.nextUpgrade(save), k = 0; u && u.affordable && (u.kind === 'equip' || save.gold - u.cost.gold >= reserve) && k < 30; u = G.nextUpgrade(save), k++) {
          G.doUpgrade(save, u);
          if (r.firstGearAt == null) r.firstGearAt = now - T0;
          advance(E.forgeMs, 'forge');
        }
      }
    }
    snap();
    const d = G.autoDecide(save);
    if (d.type === 'wait') {
      advance(E.guideMs, 'wait');
      if (d.reason === 'guide') {
        const info = G.ackGuide(save, d.guide, now);
        if (d.guide === 'forge' && info.item && r.firstGearAt == null) r.firstGearAt = now - T0;
        if (d.guide === 'gather' && r.forgeAt == null) r.forgeAt = now - T0;
        if (info.recruit && info.recruit.ok && seg && d.guide !== 'cave') { seg.recruits++; seg.recruitGold += info.recruit.cost; }
        if (d.guide === 'done:' + chs[untilIdx]) break;
      } else if (d.reason === 'recruitChoice') choose();
      else if (d.reason === 'recruitDecision') G.resolvePending(save, false);
      else if (d.reason === 'boss') G.confirmBoss(save, d.stageId);
      else if (d.reason === 'cards') G.autoHandleCards(save);
      else break;
      continue;
    }
    const push = d.type === 'challenge';
    const o = G.runBattle(save, d.stageId);
    const ms = push ? G.durationMs(o.result, E.watchSpeed) + (kind === 'std' ? E.overheadMs : 0) : G.backgroundBattleMs(o);
    advance(ms, push ? 'push' : 'idle');
    const lvBefore = G.maxLevel(save);
    const was = G.isCleared(save, o.stageId);
    G.applyOutcome(save, o, { kind: push ? 'push' : 'idle', elapsedMs: ms });
    if (o.win && !was) r.clears[o.stageId] = { t: now - T0, lv: G.maxLevel(save), slv: G.starter(save).level };
    if (o.win && o.stageId === C.recruit.unlockStage && r.gateAt == null) { r.gateLv = lvBefore; r.gateAt = now - T0; }
    const c2 = curCh();
    if (c2 !== segCh) {
      closeSeg(seg, now, save);
      r.segs[segCh] = seg;
      if (chs.indexOf(segCh) >= untilIdx) { r.done = true; seg = null; if (opts.stopAtClear) break; }
      else { segCh = c2; seg = emptySeg(now, save); }
      if (!c2) { r.done = true; }
    }
    if (now - T0 > maxMs) break;
  }
  if (seg && !r.segs[segCh]) { closeSeg(seg, now, save); seg.unfinished = true; r.segs[segCh] = seg; }
  r.total = now - T0;
  r.save = save;
  return r;
}

// ---------- 统计小工具 ----------
const q = (arr, p) => { const a = arr.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null; };
const mean = (arr) => { const a = arr.filter((x) => x != null); return a.reduce((s, b) => s + b, 0) / Math.max(1, a.length); };
const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
const min = (ms) => (ms == null ? '—' : (ms / 60000).toFixed(1));
const num = (x) => (x == null ? '—' : Math.round(x).toLocaleString('en-US'));

/**
 * 「通关等级」阶梯：拿真实存档快照，把开局角色设为 Lv N、其他角色 Lv N−1，改造（mutate）后对一关跑多个种子。
 * @returns { rates: [胜率]，first: 胜率 ≥ 50% 的最低等级或 null }
 */
function ladder(snaps, stageId, levels, mutate, seedsPer) {
  const rates = [];
  for (const lv of levels) {
    let w = 0, n = 0;
    for (const sn of snaps) {
      const s = clone(sn);
      if (s.research.active) { const a = s.research.active; s.research.slots = a.level; s.research.active = null; G.addToLineup(s, a.charId); }
      for (const c of s.roster) c.level = c.origin === 'starter' ? lv : Math.max(1, lv - 1);
      if (mutate) mutate(s);
      for (let k = 0; k < (seedsPer || 5); k++) { s.seedCounter = 9100 + k * 31 + n; n++; if (G.runBattle(s, stageId).win) w++; }
    }
    rates.push(w / Math.max(1, n));
  }
  const i = rates.findIndex((x) => x >= 0.5);
  return { rates, first: i < 0 ? null : levels[i] };
}
/** 快照改造：卸下全部装备 / 拔掉全部技能卡 / 每个上阵角色穿一整套某档白装 */
const stripGear = (s) => { for (const c of s.roster) for (const slot of C.forge.slots) c.equip[slot] = null; };
const stripCards = (s) => { for (const c of s.roster) c.card = null; };
const fullSet = (tier) => (s) => {
  for (const { char } of G.lineupChars(s)) for (const slot of C.forge.slots) char.equip[slot] = { id: 'x' + char.id + slot, slot, tier, stat: slot === 'ring' ? G.mainStat(char) : undefined };
};

/** 报告头：用的是哪套数值 */
function header(script, args) {
  return [`> 由 \`node cli/${script}${args ? ' ' + args : ''}\` 生成。数值：${DAO.Tuning.describe()}。配置见 \`src/config/game.js\`。`];
}

module.exports = { DAO, G, C, T0, SEEDS, STD_GATHERERS, simulate, ladder, stripGear, stripCards, fullSet, q, mean, pct, min, num, clone, header };
