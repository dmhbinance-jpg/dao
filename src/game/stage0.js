/**
 * 阶段 0 游戏逻辑：开局角色、引导关、经验与升级、挂机计时。
 * 纯逻辑，不碰 DOM；浏览器和 Node 共用（命令行验证脚本直接调用）。
 *
 * 存档结构（save）：
 *   { v, createdAt, seedCounter,
 *     hero: { name, role, level, exp, base, growth, innate, branch, talents },
 *     progress: { cleared: { [stageId]: 通关次数 } },
 *     idle: { stageId } | null,
 *     stats: { battles, wins, kills, expTotal, playMs } }
 *
 * 一场战斗分两步：runBattle（只算，不改存档，除了不推进种子）→ applyOutcome（结算经验 / 通关 / 种子）。
 * 这样界面可以先播完回放再结算，挂机可以等计时结束再结算。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const cfg = () => DAO.CONFIG.stage0;

  // ================= 存档 =================
  function newSave(role, name) {
    const st = cfg().starters[role];
    if (!st) throw new Error('未知开局定位: ' + role);
    return {
      v: cfg().saveVersion,
      createdAt: Date.now(),
      seedCounter: 1,
      hero: {
        name: (name || '').trim() || (role === 'sword' ? '无名剑修' : '无名法修'),
        role, level: cfg().startLevel, exp: 0,
        base: clone(st.base), growth: clone(st.growth),
        innate: st.innate, branch: st.branch, talents: clone(st.talents),
      },
      progress: { cleared: {} },
      idle: null,
      stats: { battles: 0, wins: 0, kills: 0, expTotal: 0, playMs: 0 },
    };
  }

  function isValidSave(s) {
    return !!(s && s.v === cfg().saveVersion && s.hero && cfg().starters[s.hero.role]);
  }

  // ================= 角色 =================
  /** 存档里的角色 → 引擎用的角色定义（与其他角色同一套字段，没有主角特例） */
  function heroChar(hero) {
    const st = cfg().starters[hero.role];
    return {
      id: 'hero', name: hero.name, title: st.title, role: hero.role, row: 'front',
      level: hero.level, base: hero.base, growth: hero.growth,
      innate: hero.innate, branch: hero.branch, talents: hero.talents,
      activeCard: null, passiveCard: null,
    };
  }

  /** 角色面板用：编译出的单位（属性、技能） */
  function heroUnit(hero, level) {
    const ch = heroChar(hero);
    if (level != null) ch.level = level;
    return DAO.Model.buildUnit(ch, 'A', 'front', 0, 'hero');
  }

  // ================= 经验 =================
  function expToNext(level) {
    const e = cfg().exp;
    return Math.round(e.base * Math.pow(level, e.power));
  }

  function killExp(enemyId, level) {
    const t = cfg().enemies[enemyId];
    return t ? Math.round(t.exp * level * cfg().exp.killMul) : 0;
  }

  /** 加经验并升级，返回升了几级 */
  function addExp(hero, amount) {
    let ups = 0;
    hero.exp += amount;
    while (hero.level < cfg().maxLevel && hero.exp >= expToNext(hero.level)) {
      hero.exp -= expToNext(hero.level);
      hero.level++;
      ups++;
    }
    if (hero.level >= cfg().maxLevel) hero.exp = Math.min(hero.exp, expToNext(hero.level));
    return ups;
  }

  // ================= 关卡 =================
  function stages() { return cfg().stages; }
  function stageById(id) { return stages().find((s) => s.id === id); }
  function stageIndex(id) { return stages().findIndex((s) => s.id === id); }
  function isCleared(save, id) { return (save.progress.cleared[id] || 0) > 0; }
  function isUnlocked(save, id) {
    const i = stageIndex(id);
    return i === 0 || (i > 0 && isCleared(save, stages()[i - 1].id));
  }
  /** 下一个未通关的关卡（全部通关返回 null） */
  function nextStage(save) {
    return stages().find((s) => !isCleared(save, s.id)) || null;
  }
  function chapterCleared(save) { return stages().every((s) => isCleared(save, s.id)); }
  /** 已通关里最难（最靠后）的一关 */
  function bestClearedStage(save) {
    const c = stages().filter((s) => isCleared(save, s.id));
    return c.length ? c[c.length - 1] : null;
  }

  function lineups(save, stage) {
    return {
      A: [{ char: heroChar(save.hero), row: 'front' }],
      B: stage.enemies.map((e) => ({ enemyId: e.enemyId, level: e.level, row: e.row })),
    };
  }

  /** 关卡总经验（全杀） */
  function stageExp(stage) {
    return stage.enemies.reduce((a, e) => a + killExp(e.enemyId, e.level), 0);
  }

  // ================= 战斗 =================
  /**
   * 跑一场（不改存档）。
   * @returns outcome { stageId, seed, result, units, win, kills, exp, durationMs(1×) }
   */
  function runBattle(save, stageId, opts) {
    opts = opts || {};
    const stage = stageById(stageId);
    if (!stage) throw new Error('未知关卡: ' + stageId);
    const L = lineups(save, stage);
    const seed = save.seedCounter;
    const battle = new DAO.Battle(L.A, L.B, { seed, record: !!opts.record });
    const result = battle.run();
    const hero = result.units.find((u) => u.side === 'A');
    const win = result.winner === 'A';
    const victims = hero.stats.victims;
    const keep = win || cfg().exp.lossKeepsKills;
    const exp = keep ? victims.reduce((a, v) => a + killExp(v.id, v.level), 0) : 0;
    return {
      stageId, seed, result, units: battle.units, win,
      kills: victims.length, exp,
      durationMs: durationMs(result, 1),
    };
  }

  /**
   * 结算一场：经验、升级、通关记录、种子推进。
   * @returns { levelBefore, levelAfter, levelsGained, firstClear, unlocked }
   */
  function applyOutcome(save, outcome, opts) {
    opts = opts || {};
    const h = save.hero;
    const levelBefore = h.level;
    const wasCleared = isCleared(save, outcome.stageId);
    save.seedCounter = Math.max(save.seedCounter, outcome.seed + 1);
    const ups = addExp(h, outcome.exp);
    save.stats.battles++;
    save.stats.kills += outcome.kills;
    save.stats.expTotal += outcome.exp;
    save.stats.playMs += opts.elapsedMs || 0;
    let unlocked = null;
    if (outcome.win) {
      save.stats.wins++;
      save.progress.cleared[outcome.stageId] = (save.progress.cleared[outcome.stageId] || 0) + 1;
      if (!wasCleared) {
        const nx = stages()[stageIndex(outcome.stageId) + 1];
        unlocked = nx ? nx.id : null;
      }
    }
    return { levelBefore, levelAfter: h.level, levelsGained: ups, firstClear: outcome.win && !wasCleared, unlocked };
  }

  /** 战斗播放时长（毫秒）。按日志条目数估算，与播放器的节奏一致。 */
  function durationMs(result, speed) {
    const P = DAO.CONFIG.playback;
    const actions = result.units.reduce((a, u) => a + u.stats.actions, 0);
    const ms = P.start + actions * P.action + result.rounds * P.round;
    return ms / (speed || 1);
  }

  // ================= 挂机 =================
  function canIdle(save, stageId) { return isCleared(save, stageId); }
  function idleBattleMs(outcome) {
    return durationMs(outcome.result, cfg().idle.speed) + cfg().idle.gapMs;
  }

  DAO.Stage0 = {
    newSave, isValidSave, heroChar, heroUnit,
    expToNext, killExp, addExp,
    stages, stageById, stageIndex, isCleared, isUnlocked, nextStage, chapterCleared, bestClearedStage, lineups, stageExp,
    runBattle, applyOutcome, durationMs,
    canIdle, idleBattleMs,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
