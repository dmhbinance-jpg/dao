/**
 * 游戏模块 · progress
 * 关卡进度与战斗结算：章节 / 关卡查询、开战、结算（经验、金币、掉落、首通、战败计数）、系统开放（洞府、采集 / 锻造房）。
 * 读写字段：progress、unlocks、seedCounter、idle。金币走 economy，经验走 roster.addExp，掉落走 cards.addDrops，统计走 save.addStat。
 * 对外（挂在 DAO.Game 上）：unlockLines、killExp、killGold、chapters、stages、chapterOf、chapterDone、stageById、stageIndex、isCleared、isUnlocked、nextStage、chapterCleared、bestClearedStage、stageExp、stageGold、lineups、lineupSig、runBattle、applyOutcome、onFirstClear、durationMs、backgroundBattleMs、unlockCave、unlockForge
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const G = DAO.Game;
  const { clone, cfg, P } = DAO.GameUtil;

  function killExp(enemyId, level) {
    const t = cfg().enemies[enemyId];
    return t ? Math.round(t.exp * level * cfg().exp.killMul) : 0;
  }

  function killGold(enemyId, level) {
    const t = cfg().enemies[enemyId];
    return t ? Math.round((t.gold || 0) * level * cfg().gold.killMul) : 0;
  }

  function chapters() { return cfg().chapters; }

  function stages() { return cfg().chapters.reduce((a, ch) => a.concat(ch.stages), []); }

  function chapterOf(stageId) { return cfg().chapters.find((ch) => ch.stages.some((s) => s.id === stageId)) || null; }

  function chapterDone(save, chId) { const ch = cfg().chapters.find((c) => c.id === chId); return !!ch && ch.stages.every((s) => isCleared(save, s.id)); }

  function stageById(id) { return stages().find((s) => s.id === id); }

  function stageIndex(id) { return stages().findIndex((s) => s.id === id); }

  function isCleared(save, id) { return (save.progress.cleared[id] || 0) > 0; }

  function isUnlocked(save, id) {
    const i = stageIndex(id);
    return i === 0 || (i > 0 && isCleared(save, stages()[i - 1].id));
  }

  function nextStage(save) { return stages().find((s) => !isCleared(save, s.id)) || null; }

  /** 当前开放的全部章节都已通关 */
  function chapterCleared(save) { return stages().every((s) => isCleared(save, s.id)); }

  function bestClearedStage(save) {
    const c = stages().filter((s) => isCleared(save, s.id));
    return c.length ? c[c.length - 1] : null;
  }

  function stageExp(stage) { return stage.enemies.reduce((a, e) => a + killExp(e.enemyId, e.level), 0); }

  function stageGold(stage) { return stage.enemies.reduce((a, e) => a + killGold(e.enemyId, e.level), 0); }

  function lineups(save, stage) {
    const solo = save.lineup.length === 1;
    return {
      A: G.lineupChars(save).map(({ entry, char }) => ({ char: G.charDef(char), row: solo ? 'front' : entry.row })),
      B: stage.enemies.map((e) => ({ enemyId: e.enemyId, level: e.level, row: e.row })),
    };
  }

  function lineupSig(save) {
    // 等级或装备变了都算阵容变化（自动推关会再挑战一次最新关）
    return G.lineupChars(save).map(({ char }) => char.id + ':' + char.level + (char.equip ? ':' + G.gearSlots().map((sl) => (char.equip[sl] ? char.equip[sl].id : '')).join('.') : '')).join(',');
  }

  /** 跑一场（不改存档）。 */
  function runBattle(save, stageId, opts) {
    opts = opts || {};
    const stage = stageById(stageId);
    if (!stage) throw new Error('未知关卡: ' + stageId);
    const L = lineups(save, stage);
    const seed = save.seedCounter;
    const battle = new DAO.Battle(L.A, L.B, { seed, record: !!opts.record });
    const result = battle.run();
    const win = result.winner === 'A';
    const victims = [];
    for (const u of result.units) if (u.side === 'A') victims.push(...u.stats.victims);
    const keep = win || cfg().exp.lossKeepsKills;
    return {
      stageId, seed, result, units: battle.units, win,
      drops: keep ? G.rollDrops(save, stageId, seed, victims) : [],
      kills: victims.length,
      exp: keep ? victims.reduce((a, v) => a + killExp(v.id, v.level), 0) : 0,
      gold: keep ? victims.reduce((a, v) => a + killGold(v.id, v.level), 0) : 0,
      lineupIds: save.lineup.map((e) => e.id),
      sig: lineupSig(save),
      frontier: (nextStage(save) || {}).id === stageId,
      durationMs: durationMs(result, 1),
    };
  }

  /**
   * 结算一场：经验（上阵角色）、金币、通关 / 战败记录、洞府开放、种子推进。
   * @param opts { kind: 'push' | 'idle', elapsedMs }
   */
  function applyOutcome(save, o, opts) {
    opts = opts || {};
    save.seedCounter = Math.max(save.seedCounter, o.seed + 1);
    const members = o.lineupIds.map((id) => G.getChar(save, id)).filter(Boolean);
    const each = cfg().exp.split ? Math.floor(o.exp / Math.max(1, members.length)) : o.exp;
    const levelUps = [];
    for (const c of members) {
      const from = c.level;
      if (G.addExp(c, each)) levelUps.push({ id: c.id, name: c.name, from, to: c.level });
    }
    G.addGold(save, o.gold);
    G.addStat(save, 'battles', 1);
    G.addStat(save, 'kills', o.kills);
    G.addStat(save, 'expTotal', o.exp);
    G.addStat(save, 'goldTotal', o.gold);
    const ms = opts.elapsedMs || 0;
    G.addStat(save, 'playMs', ms);
    if (opts.kind === 'idle') G.addStat(save, 'idleMs', ms); else G.addStat(save, 'pushMs', ms);
    if (o.frontier) G.noteAttempt(save, o.stageId, o.sig);

    const wasCleared = isCleared(save, o.stageId);
    let unlocked = null;
    let caveUnlocked = false;
    if (o.win) {
      G.addStat(save, 'wins', 1);
      save.progress.cleared[o.stageId] = (save.progress.cleared[o.stageId] || 0) + 1;
      if (!wasCleared) {
        const nx = stages()[stageIndex(o.stageId) + 1];
        unlocked = nx ? nx.id : null;
        onFirstClear(save, o.stageId);
      }
    } else {
      save.progress.lost[o.stageId] = (save.progress.lost[o.stageId] || 0) + 1;
      // 第三段卡关：引导「该去打装备了」（等灵矿和金币够了才弹出，不够时不拦自动推关）
      const ch = chapterOf(o.stageId);
      if (o.frontier && ch && (cfg().forge.stuckGuideChapters || []).includes(ch.id) && save.guide.seen.forge) {
        // 上阵位还能研究、又没在研究：提示多开一个上阵位（每次研究完、再卡关时会再提示）
        if (G.researchable(save)) G.queueGuide(save, 'moreSlots');
        // 「该去打装备了」；这一章以上阵位为卡点（research.slots.stuckChapters）时，能研究就先研究，装备引导往后放
        if (!G.slotsFirst(save, ch.id)) G.queueGuide(save, 'gearUp:' + o.stageId);
      }
    }
    // 洞府：在开放关第一次战败（或单人硬过）时开放
    if (o.stageId === cfg().recruit.unlockStage && !save.unlocks.cave) {
      unlockCave(save);
      caveUnlocked = true;
    }
    const drops = G.addDrops(save, o.drops || []);
    return { levelUps, expEach: each, gold: o.gold, firstClear: o.win && !wasCleared, unlocked, caveUnlocked, drops };
  }

  /** 某关第一次通关时开放的东西（章节通关引导、采集 / 锻造房、第一张卡）。存档工具「解锁关卡」也用它。 */
  function onFirstClear(save, stageId) {
    const ch = chapterOf(stageId);
    if (ch && ch.stages[ch.stages.length - 1].id === stageId) G.queueGuide(save, 'done:' + ch.id);
    if (stageId === cfg().gather.unlockStage) unlockForge(save);
    if (ch && ch.stages[ch.stages.length - 1].id === stageId) unlockLines(save, ch.id);
    if (stageId === cfg().cards.firstCardStage) G.grantFirstCard(save);
    // 卡关补装备的引导：这关打过了就不用了
    const gid = 'gearUp:' + stageId;
    G.retireGuide(save, gid);
  }

  /** 战斗播放时长（毫秒）。按行动数估算，与播放器节奏一致。 */
  function durationMs(result, speed) {
    const P = DAO.CONFIG.playback;
    const actions = result.units.reduce((a, u) => a + u.stats.actions, 0);
    return (P.battleStart + actions * P.action + result.rounds * P.roundStart) / (speed || 1);
  }

  function backgroundBattleMs(o) {
    return durationMs(o.result, cfg().idle.speed) + cfg().idle.gapMs;
  }

  function unlockCave(save) {
    save.unlocks.cave = true;
    G.queueGuide(save, 'cave');
  }

  function unlockForge(save) {
    if (save.unlocks.forge) return;
    save.unlocks.forge = true;
    G.queueGuide(save, 'gather');
  }

  /** 章节通关时开放的生产线（production.lines[].unlockChapter，阶段 4a：第三段通关开放裁缝、饰品），带一次「派人采集灵草 / 灵石」引导 */
  function unlockLines(save, chId) {
    let any = false;
    for (const [id, l] of Object.entries(cfg().production.lines)) {
      if (!l.enabled || l.unlockChapter !== chId || save.unlocks[id]) continue;
      save.unlocks[id] = true;
      any = true;
    }
    if (any) G.queueGuide(save, 'gather2');
    return any;
  }

  Object.assign(G, {
    unlockLines, killExp, killGold, chapters, stages, chapterOf, chapterDone, stageById, stageIndex, isCleared, isUnlocked, nextStage, chapterCleared,
    bestClearedStage, stageExp, stageGold, lineups, lineupSig, runBattle, applyOutcome, onFirstClear, durationMs, backgroundBattleMs, unlockCave,
    unlockForge,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
