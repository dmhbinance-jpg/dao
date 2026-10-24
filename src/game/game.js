/**
 * 游戏主线规则（阶段 0 + 阶段 1）：角色与上阵、引导关、经验金币、洞府招募、研究上阵位、引导、自动推关、存档迁移。
 * 纯逻辑，不碰 DOM；浏览器和 Node 共用。所有随机走 DAO.RNG（战斗用 battle.rng，招募用存档里的招募种子）。
 * 涉及时间的函数都显式接收 now（毫秒时间戳），命令行模拟传模拟时钟。
 *
 * 存档 v2：
 *   { v, createdAt, seedCounter, gachaSeed, gold, nextId,
 *     roster: [角色], lineup: [{ id, row }],
 *     research: { slots, active: { level, charId, startedAt, endsAt } | null },
 *     unlocks: { cave }, guide: { queue: [], seen: {} },
 *     recruit: { day, today, freeUsed }, pendingRecruit: 角色 | null,
 *     progress: { cleared: {}, lost: {} },
 *     auto: { on, confirmed: {}, lastAttempt: { stageId, sig } | null },
 *     idle: { stageId } | null,
 *     stats: { battles, wins, kills, expTotal, goldTotal, playMs, pushMs, idleMs } }
 *   角色：{ id, name, role, quality, origin, level, exp, base, growth, innate, branch, talents }
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const cfg = () => DAO.CONFIG.game;

  // ================= 时间 =================
  /** 本地日期键（次日重置用） */
  function dayKey(now) {
    const d = new Date(now);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  // ================= 存档 =================
  function starterChar(role, name) {
    const st = cfg().starters[role];
    return {
      id: 'c1', name: (name || '').trim() || (role === 'sword' ? '无名剑修' : '无名法修'),
      role, quality: 'starter', origin: 'starter',
      level: cfg().startLevel, exp: 0,
      base: clone(st.base), growth: clone(st.growth),
      innate: st.innate, branch: st.branch, talents: clone(st.talents),
    };
  }

  function emptyStats() {
    return { battles: 0, wins: 0, kills: 0, expTotal: 0, goldTotal: 0, playMs: 0, pushMs: 0, idleMs: 0 };
  }

  function newSave(role, name, now) {
    if (!cfg().starters[role]) throw new Error('未知开局定位: ' + role);
    return {
      v: cfg().saveVersion,
      createdAt: now || Date.now(),
      seedCounter: 1,
      gachaSeed: 1,
      gold: cfg().gold.start,
      nextId: 2,
      roster: [starterChar(role, name)],
      lineup: [{ id: 'c1', row: 'front' }],
      research: { slots: cfg().research.slots.start, active: null },
      unlocks: { cave: false },
      guide: { queue: [], seen: {} },
      recruit: { day: null, today: 0, freeUsed: false },
      pendingRecruit: null,
      progress: { cleared: {}, lost: {} },
      auto: { on: cfg().auto.defaultOn, confirmed: {}, lastAttempt: null },
      idle: null,
      stats: emptyStats(),
    };
  }

  /**
   * 读入任意版本存档，返回 v2 存档或 null。
   * v1（阶段 0）：单个 hero → 角色 c1；已经打过开放关（通关或战败过）的直接开放洞府。
   */
  function migrate(s, now) {
    if (!s || typeof s !== 'object') return null;
    if (s.v === cfg().saveVersion) return isValidV2(s) ? s : null;
    if (s.v === 1 && s.hero && cfg().starters[s.hero.role]) {
      const h = s.hero;
      const out = newSave(h.role, h.name, s.createdAt || now);
      const c = out.roster[0];
      c.level = h.level || 1;
      c.exp = h.exp || 0;
      c.base = clone(h.base || c.base);
      c.growth = clone(h.growth || c.growth);
      c.talents = clone(h.talents || c.talents);
      out.seedCounter = s.seedCounter || 1;
      out.gold = cfg().migration.v1StartGold;
      out.progress.cleared = Object.assign({}, (s.progress && s.progress.cleared) || {});
      out.stats = Object.assign(emptyStats(), s.stats || {});
      // 阶段 0 的 1-4 和现在的 1-4 不同，但打过就算打过：直接开放洞府
      if (out.progress.cleared[cfg().recruit.unlockStage]) unlockCave(out);
      return out;
    }
    return null;
  }

  function isValidV2(s) {
    return !!(s && Array.isArray(s.roster) && s.roster.length && Array.isArray(s.lineup) && s.research && s.progress);
  }

  // ================= 角色 =================
  function getChar(save, id) { return save.roster.find((c) => c.id === id) || null; }
  function starter(save) { return save.roster.find((c) => c.origin === 'starter') || save.roster[0]; }
  function maxLevel(save) { return save.roster.reduce((m, c) => Math.max(m, c.level), 1); }
  function qualityName(q) {
    if (q === 'starter') return '开局';
    const d = cfg().recruit.qualities[q];
    return d ? d.name : q;
  }

  /** 角色 → 引擎用的角色定义（开局角色和招募角色同一套字段） */
  function charDef(c, row) {
    return {
      id: c.id, name: c.name, title: DAO.ROLE_NAMES[c.role], role: c.role, row: row || 'front',
      level: c.level, base: c.base, growth: c.growth,
      innate: c.innate, branch: c.branch, talents: c.talents,
      activeCard: null, passiveCard: null,
    };
  }
  function charUnit(c, level) {
    const d = charDef(c);
    if (level != null) d.level = level;
    return DAO.Model.buildUnit(d, 'A', 'front', 0, c.id);
  }

  /** 资质评分：各项成长相对开局同定位角色的平均倍率（1.00 = 与开局角色相同） */
  function aptitude(c) {
    const ref = cfg().starters[c.role].growth;
    const ks = ['str', 'agi', 'int'];
    return ks.reduce((a, k) => a + c.growth[k] / ref[k], 0) / ks.length;
  }

  // ================= 经验 / 金币 =================
  function expToNext(level) {
    const e = cfg().exp;
    return Math.round(e.base * Math.pow(level, e.power));
  }
  function killExp(enemyId, level) {
    const t = cfg().enemies[enemyId];
    return t ? Math.round(t.exp * level * cfg().exp.killMul) : 0;
  }
  function killGold(enemyId, level) {
    const t = cfg().enemies[enemyId];
    return t ? Math.round((t.gold || 0) * level * cfg().gold.killMul) : 0;
  }
  function addExp(c, amount) {
    let ups = 0;
    c.exp += amount;
    while (c.level < cfg().maxLevel && c.exp >= expToNext(c.level)) {
      c.exp -= expToNext(c.level);
      c.level++;
      ups++;
    }
    if (c.level >= cfg().maxLevel) c.exp = Math.min(c.exp, expToNext(c.level));
    return ups;
  }

  // ================= 上阵 =================
  function slots(save) { return save.research.slots; }
  function isResearching(save, id) { return !!(save.research.active && save.research.active.charId === id); }
  function inLineup(save, id) { return save.lineup.some((e) => e.id === id); }
  function status(save, id) {
    if (isResearching(save, id)) return 'research';
    if (inLineup(save, id)) return 'lineup';
    return 'idle';
  }
  function lineupChars(save) {
    return save.lineup.map((e) => ({ entry: e, char: getChar(save, e.id) })).filter((x) => x.char);
  }
  function defaultRow(role) { return cfg().roster.defaultRow[role] || 'front'; }

  /** 默认站位：剑修前、法修后；某排超过上限时挪到另一排 */
  function applyDefaultRows(save) {
    const max = DAO.CONFIG.formation.maxPerRow;
    const cnt = { front: 0, back: 0 };
    for (const e of save.lineup) {
      const c = getChar(save, e.id);
      let r = defaultRow(c.role);
      if (cnt[r] >= max) r = r === 'front' ? 'back' : 'front';
      e.row = r;
      cnt[r]++;
    }
  }

  function canAddToLineup(save, id) {
    return !!getChar(save, id) && status(save, id) === 'idle' && save.lineup.length < slots(save);
  }
  function addToLineup(save, id) {
    if (!canAddToLineup(save, id)) return false;
    const before = save.lineup.length;
    save.lineup.push({ id, row: defaultRow(getChar(save, id).role) });
    if (before < 2 && save.lineup.length >= 2) {
      applyDefaultRows(save);
      queueGuide(save, 'formation');
    } else {
      fixRowOverflow(save);
    }
    return true;
  }
  function fixRowOverflow(save) {
    const max = DAO.CONFIG.formation.maxPerRow;
    for (const r of ['front', 'back']) {
      const list = save.lineup.filter((e) => e.row === r);
      for (let i = max; i < list.length; i++) list[i].row = r === 'front' ? 'back' : 'front';
    }
  }
  function removeFromLineup(save, id) {
    if (!inLineup(save, id) || save.lineup.length <= 1) return false;
    save.lineup = save.lineup.filter((e) => e.id !== id);
    return true;
  }
  function setRow(save, id, row) {
    const e = save.lineup.find((x) => x.id === id);
    if (!e || (row !== 'front' && row !== 'back')) return false;
    if (e.row === row) return true;
    if (save.lineup.filter((x) => x.row === row).length >= DAO.CONFIG.formation.maxPerRow) return false;
    e.row = row;
    return true;
  }
  /** 两人时互换前后排 */
  function swapRows(save) {
    for (const e of save.lineup) e.row = e.row === 'front' ? 'back' : 'front';
    fixRowOverflow(save);
  }
  function showFormation(save) { return save.lineup.length >= 2; }

  // ================= 关卡 =================
  function stages() { return cfg().stages; }
  function stageById(id) { return stages().find((s) => s.id === id); }
  function stageIndex(id) { return stages().findIndex((s) => s.id === id); }
  function isCleared(save, id) { return (save.progress.cleared[id] || 0) > 0; }
  function isUnlocked(save, id) {
    const i = stageIndex(id);
    return i === 0 || (i > 0 && isCleared(save, stages()[i - 1].id));
  }
  function nextStage(save) { return stages().find((s) => !isCleared(save, s.id)) || null; }
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
      A: lineupChars(save).map(({ entry, char }) => ({ char: charDef(char), row: solo ? 'front' : entry.row })),
      B: stage.enemies.map((e) => ({ enemyId: e.enemyId, level: e.level, row: e.row })),
    };
  }
  function lineupSig(save) {
    return lineupChars(save).map(({ char }) => char.id + ':' + char.level).join(',');
  }

  // ================= 战斗 =================
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
    const members = o.lineupIds.map((id) => getChar(save, id)).filter(Boolean);
    const each = cfg().exp.split ? Math.floor(o.exp / Math.max(1, members.length)) : o.exp;
    const levelUps = [];
    for (const c of members) {
      const from = c.level;
      if (addExp(c, each)) levelUps.push({ id: c.id, name: c.name, from, to: c.level });
    }
    save.gold += o.gold;
    const st = save.stats;
    st.battles++;
    st.kills += o.kills;
    st.expTotal += o.exp;
    st.goldTotal += o.gold;
    const ms = opts.elapsedMs || 0;
    st.playMs += ms;
    if (opts.kind === 'idle') st.idleMs += ms; else st.pushMs += ms;
    if (o.frontier) save.auto.lastAttempt = { stageId: o.stageId, sig: o.sig };

    const wasCleared = isCleared(save, o.stageId);
    let unlocked = null;
    let caveUnlocked = false;
    if (o.win) {
      st.wins++;
      save.progress.cleared[o.stageId] = (save.progress.cleared[o.stageId] || 0) + 1;
      if (!wasCleared) {
        const nx = stages()[stageIndex(o.stageId) + 1];
        unlocked = nx ? nx.id : null;
        if (!nx) queueGuide(save, 'chapterDone');
      }
    } else {
      save.progress.lost[o.stageId] = (save.progress.lost[o.stageId] || 0) + 1;
    }
    // 洞府：在开放关第一次战败（或单人硬过）时开放
    if (o.stageId === cfg().recruit.unlockStage && !save.unlocks.cave) {
      unlockCave(save);
      caveUnlocked = true;
    }
    return { levelUps, expEach: each, gold: o.gold, firstClear: o.win && !wasCleared, unlocked, caveUnlocked };
  }

  /** 战斗播放时长（毫秒）。按行动数估算，与播放器节奏一致。 */
  function durationMs(result, speed) {
    const P = DAO.CONFIG.playback;
    const actions = result.units.reduce((a, u) => a + u.stats.actions, 0);
    return (P.start + actions * P.action + result.rounds * P.round) / (speed || 1);
  }
  function backgroundBattleMs(o) {
    return durationMs(o.result, cfg().idle.speed) + cfg().idle.gapMs;
  }

  // ================= 洞府：招募 =================
  function unlockCave(save) {
    save.unlocks.cave = true;
    queueGuide(save, 'cave');
  }

  function recruitCost(save, now) {
    const R = cfg().recruit;
    if (R.firstFree && !save.recruit.freeUsed) return 0;
    const n = save.recruit.day === dayKey(now) ? save.recruit.today : 0;
    return Math.round(R.dailyFirstCost * Math.pow(R.costMul, n));
  }
  function canRecruit(save, now) {
    return save.unlocks.cave && !save.pendingRecruit && save.gold >= recruitCost(save, now);
  }

  function weighted(rng, weights) {
    const entries = Object.entries(weights).filter(([, w]) => w > 0);
    const total = entries.reduce((a, [, w]) => a + w, 0);
    let x = rng.next() * total;
    for (const [k, w] of entries) { if ((x -= w) < 0) return k; }
    return entries[entries.length - 1][0];
  }

  /** 随机生成一个招募角色（不改存档，除了招募种子） */
  function rollRecruit(save, opts) {
    opts = opts || {};
    const R = cfg().recruit;
    const rng = new DAO.RNG(DAO.hashSeed('recruit:' + save.gachaSeed));
    save.gachaSeed++;
    const role = opts.role || weighted(rng, R.roleWeights);
    const quality = opts.quality || weighted(rng, Object.fromEntries(Object.entries(R.qualities).map(([k, q]) => [k, q.weight])));
    const Q = R.qualities[quality];
    const ref = cfg().starters[role];
    const growth = {};
    for (const k of ['str', 'agi', 'int']) {
      growth[k] = Math.round(ref.growth[k] * rng.range(Q.growthMul[0], Q.growthMul[1]) * 100) / 100;
    }
    // 天赋：条数按品质；档位按权重；触发型仅稀有品质、最多一条；不重复
    const count = rng.int(Q.talents[0], Q.talents[1]);
    const pool = Object.entries(DAO.CONFIG.talents).filter(([id, d]) => !d.exclusive && !R.excludeTalents.includes(id));
    const talents = [];
    for (let i = 0; i < count; i++) {
      const w = Object.assign({}, R.tierWeights);
      if (!Q.trigger || talents.some((t) => DAO.CONFIG.talents[t.id].tier === 'trigger')) w.trigger = 0;
      const tier = weighted(rng, w);
      const cands = pool.filter(([id, d]) => d.tier === tier && !talents.some((t) => t.id === id));
      if (!cands.length) continue;
      const [id] = rng.pick(cands);
      talents.push({ id, roll: Math.round(rng.next() * 100) / 100 });
    }
    const used = new Set(save.roster.map((c) => c.name));
    const freeNames = R.names.filter((n) => !used.has(n));
    const name = freeNames.length ? rng.pick(freeNames) : rng.pick(R.names) + (save.nextId);
    return {
      id: 'c' + save.nextId, name, role, quality, origin: 'recruit',
      level: Math.max(1, maxLevel(save) + R.levelOffset), exp: 0,
      base: clone(ref.base), growth,
      innate: rng.pick(R.innatePool[role]), branch: 0, talents,
    };
  }

  /**
   * 招募一次。名额满时返回 needsDecision，角色放进 pendingRecruit 等玩家决定。
   * @returns { ok, char, cost, added, needsDecision, error }
   */
  function recruit(save, now) {
    const R = cfg().recruit;
    if (!save.unlocks.cave) return { ok: false, error: 'locked' };
    if (save.pendingRecruit) return { ok: false, error: 'pending' };
    const cost = recruitCost(save, now);
    if (save.gold < cost) return { ok: false, error: 'gold', cost };
    const free = R.firstFree && !save.recruit.freeUsed;
    const opts = {};
    if (free && R.firstComplement) opts.role = starter(save).role === 'sword' ? 'mage' : 'sword';
    const c = rollRecruit(save, opts);
    save.nextId++;
    save.gold -= cost;
    if (free) save.recruit.freeUsed = true;
    else {
      const dk = dayKey(now);
      if (save.recruit.day !== dk) { save.recruit.day = dk; save.recruit.today = 0; }
      save.recruit.today++;
    }
    if (save.roster.length >= cfg().roster.cap) {
      save.pendingRecruit = c;
      return { ok: true, char: c, cost, added: false, needsDecision: true };
    }
    save.roster.push(c);
    addToLineup(save, c.id); // 有空的上阵位就直接上阵
    return { ok: true, char: c, cost, added: true };
  }

  function canDismiss(save, id) {
    const c = getChar(save, id);
    if (!c || isResearching(save, id)) return false;
    if (inLineup(save, id) && save.lineup.length <= 1) return false;
    return save.roster.length > 1;
  }
  function dismiss(save, id) {
    if (!canDismiss(save, id)) return false;
    save.roster = save.roster.filter((c) => c.id !== id);
    save.lineup = save.lineup.filter((e) => e.id !== id);
    return true;
  }
  /** 名额满时的决定：keep=true 时遣散 dismissId 换进新人；keep=false 遣散新人 */
  function resolvePending(save, keep, dismissId) {
    const c = save.pendingRecruit;
    if (!c) return false;
    if (keep) {
      if (!dismiss(save, dismissId)) return false;
      save.roster.push(c);
      addToLineup(save, c.id);
    }
    save.pendingRecruit = null;
    return true;
  }

  // ================= 洞府：研究（上阵位） =================
  function researchNext(save) {
    const S = cfg().research.slots;
    const lv = save.research.slots + 1;
    return lv <= S.max ? Object.assign({ level: lv }, S.levels[lv]) : null;
  }
  function researchDurationMs(save, charId) {
    const nx = researchNext(save);
    const c = getChar(save, charId);
    if (!nx || !c) return 0;
    const int = charUnit(c).base.int;
    return Math.round((nx.sec * 1000) / (1 + int * cfg().research.slots.intSpeedPerPoint));
  }
  /** 能不能派这个角色去研究；返回原因（null = 可以） */
  function researchBlock(save, charId) {
    if (!save.unlocks.cave) return 'locked';
    if (save.research.active) return 'busy';
    const nx = researchNext(save);
    if (!nx) return 'max';
    const c = getChar(save, charId);
    if (!c) return 'nochar';
    if (inLineup(save, charId) && save.lineup.length <= 1) return 'lastFighter';
    if (save.gold < nx.gold) return 'gold';
    return null;
  }
  function startResearch(save, charId, now) {
    if (researchBlock(save, charId)) return false;
    const nx = researchNext(save);
    save.gold -= nx.gold;
    if (inLineup(save, charId)) removeFromLineup(save, charId);
    const dur = researchDurationMs(save, charId);
    save.research.active = { level: nx.level, charId, startedAt: now, endsAt: now + dur };
    return true;
  }
  /** 研究到时间就完成；研究者有空位时自动上阵 */
  function tickResearch(save, now) {
    const a = save.research.active;
    if (!a || now < a.endsAt) return null;
    save.research.slots = a.level;
    save.research.active = null;
    addToLineup(save, a.charId);
    return { level: a.level, charId: a.charId };
  }
  /** 引导用：挑一个研究者（优先闲置里智力最高的，其次非唯一的上阵角色） */
  function pickResearcher(save) {
    const ints = (c) => charUnit(c).base.int;
    const idle = save.roster.filter((c) => status(save, c.id) === 'idle').sort((a, b) => ints(b) - ints(a));
    if (idle.length) return idle[0].id;
    if (save.lineup.length > 1) {
      const l = lineupChars(save).map((x) => x.char).sort((a, b) => ints(b) - ints(a));
      return l[0].id;
    }
    return null;
  }

  // ================= 引导 =================
  function queueGuide(save, id) {
    if (save.guide.seen[id] || save.guide.queue.includes(id)) return;
    save.guide.queue.push(id);
  }
  function currentGuide(save) { return save.guide.queue[0] || null; }
  /** 引导确认按钮当前能否执行（例如研究金币不够） */
  function guideBlock(save, id) {
    if (id === 'research') {
      if (save.research.active || save.research.slots >= 2) return null;
      const rid = pickResearcher(save);
      if (!rid) return 'nochar';
      return researchBlock(save, rid);
    }
    return null;
  }
  /** 确认引导，执行它代表的动作 */
  function ackGuide(save, id, now) {
    if (currentGuide(save) !== id) return { ok: false };
    if (guideBlock(save, id)) return { ok: false, error: guideBlock(save, id) };
    const info = { ok: true };
    if (id === 'cave') {
      if (!save.recruit.freeUsed) info.recruit = recruit(save, now);
      queueGuide(save, 'research');
    } else if (id === 'research') {
      if (!save.research.active && save.research.slots < 2) {
        const rid = pickResearcher(save);
        startResearch(save, rid, now);
        info.researcher = rid;
      }
    } else if (id === 'formation') {
      applyDefaultRows(save);
    }
    save.guide.queue.shift();
    save.guide.seen[id] = true;
    return info;
  }

  // ================= 自动推关 =================
  /**
   * 自动推关的下一步：
   *  - 胜利后自动进入下一关
   *  - 在最新关战败，退回最高已通关的关卡挂机
   *  - 上阵角色每升一级（或阵容变化），再挑战一次最新关
   *  - 首领关第一次、新系统开放的引导：停下来等确认
   * @returns { type: 'challenge'|'idle'|'wait', stageId?, reason? }
   */
  function autoDecide(save) {
    const A = cfg().auto;
    if (save.pendingRecruit) return { type: 'wait', reason: 'recruitDecision' };
    const g = currentGuide(save);
    if (g && A.stopAtGuides && !guideBlock(save, g)) return { type: 'wait', reason: 'guide', guide: g };
    const frontier = nextStage(save);
    const best = bestClearedStage(save);
    if (!frontier) return best ? { type: 'idle', stageId: best.id } : { type: 'wait', reason: 'none' };
    const la = save.auto.lastAttempt;
    const attempted = la && la.stageId === frontier.id && la.sig === lineupSig(save);
    if (!attempted || !best) {
      if (frontier.boss && A.stopBeforeBoss && !save.auto.confirmed[frontier.id]) return { type: 'wait', reason: 'boss', stageId: frontier.id };
      return { type: 'challenge', stageId: frontier.id };
    }
    return { type: 'idle', stageId: best.id };
  }
  function confirmBoss(save, stageId) { save.auto.confirmed[stageId] = true; }

  DAO.Game = {
    dayKey, newSave, migrate,
    getChar, starter, maxLevel, qualityName, charDef, charUnit, aptitude,
    expToNext, killExp, killGold, addExp,
    slots, status, isResearching, inLineup, lineupChars, canAddToLineup, addToLineup, removeFromLineup,
    setRow, swapRows, applyDefaultRows, showFormation,
    stages, stageById, stageIndex, isCleared, isUnlocked, nextStage, chapterCleared, bestClearedStage, stageExp, stageGold, lineups, lineupSig,
    runBattle, applyOutcome, durationMs, backgroundBattleMs,
    recruitCost, canRecruit, rollRecruit, recruit, canDismiss, dismiss, resolvePending,
    researchNext, researchDurationMs, researchBlock, startResearch, tickResearch, pickResearcher,
    queueGuide, currentGuide, guideBlock, ackGuide,
    autoDecide, confirmBoss,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
