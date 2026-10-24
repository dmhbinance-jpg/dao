/**
 * 游戏主线规则（阶段 0–2）：角色与上阵、引导关、经验金币、洞府招募、研究上阵位、技能卡（背包 / 插卡 / 掉落）、引导、自动推关、存档迁移。
 * 纯逻辑，不碰 DOM；浏览器和 Node 共用。所有随机走 DAO.RNG（战斗用 battle.rng，招募用存档里的招募种子）。
 * 涉及时间的函数都显式接收 now（毫秒时间戳），命令行模拟传模拟时钟。
 *
 * 存档 v3（v2 基础上加：bag、rollSeed、settings、cardsInfo、bagNew，角色加 card）：
 *   { v, createdAt, seedCounter, gachaSeed, gold, nextId,
 *     roster: [角色], lineup: [{ id, row }],
 *     research: { slots, active: { level, charId, startedAt, endsAt } | null },
 *     unlocks: { cave }, guide: { queue: [], seen: {} },
 *     recruit: { day, today, freeUsed }, pendingRecruit: 角色 | null,
 *     progress: { cleared: {}, lost: {} },
 *     auto: { on, confirmed: {}, lastAttempt: { stageId, sig } | null },
 *     idle: { stageId } | null,
 *     stats: { battles, wins, kills, expTotal, goldTotal, playMs, pushMs, idleMs } }
 *     bag: { [cardId]: 张数 }, rollSeed, settings: { cardPrompts }, bagNew,
 *     cardsInfo: { firstGot, rerolls, replaces, swapOffers, inserts } }
 *   角色：{ id, name, role, quality, origin, level, exp, base, growth, innate, branch, talents, card: { id, roll } | null }
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
      card: null,
      equip: emptyEquip(),
    };
  }
  function emptyEquip() { return { weapon: null, chest: null, ring: null }; }

  function emptyStats() {
    return { battles: 0, wins: 0, kills: 0, expTotal: 0, goldTotal: 0, playMs: 0, pushMs: 0, idleMs: 0, oreTotal: 0, gatherCharMs: 0, forged: 0, forgeGold: 0, forgeOre: 0 };
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
      unlocks: { cave: false, forge: false },
      guide: { queue: [], seen: {} },
      recruit: { day: null, today: 0, freeUsed: false },
      pendingRecruit: null,
      progress: { cleared: {}, lost: {} },
      auto: { on: cfg().auto.defaultOn, confirmed: {}, lastAttempt: null },
      idle: null,
      stats: emptyStats(),
      bag: {},
      rollSeed: 1,
      settings: clone(cfg().settings),
      bagNew: false,
      cardsInfo: { firstGot: false, rerolls: 0, replaces: 0, swapOffers: 0, inserts: 0 },
      ore: 0,
      gather: { ids: [], last: null },
      gearBag: [],
      nextGearId: 1,
    };
  }

  /**
   * 读入任意版本存档，返回 v2 存档或 null。
   * v1（阶段 0）：单个 hero → 角色 c1；已经打过开放关（通关或战败过）的直接开放洞府。
   */
  function migrate(s, now) {
    if (!s || typeof s !== 'object') return null;
    if (s.v === cfg().saveVersion) return isValidV2(s) ? s : null;
    if (s.v === 3) return isValidV2(s) ? migrateV3(s) : null;
    if (s.v === 2) return isValidV2(s) ? migrateV3(migrateV2(s)) : null;
    if (s.v === 1 && s.hero && cfg().starters[s.hero.role]) return migrateV3(migrateV2(migrateV1(s, now)));
    return null;
  }

  /** v1（阶段 0）→ v2：单个 hero → 角色 c1；打过开放关的直接开放洞府 */
  function migrateV1(s, now) {
    const h = s.hero;
    const out = newSave(h.role, h.name, s.createdAt || now);
    out.v = 2;
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
    if (out.progress.cleared[cfg().recruit.unlockStage]) unlockCave(out);
    return out;
  }

  /** v2（阶段 1）→ v3：加背包与卡槽；开局天赋换成同门标签型；打过第一段首领的补发第一张卡 */
  function migrateV2(s) {
    s.v = 3;
    s.bag = s.bag || {};
    s.rollSeed = s.rollSeed || 1;
    s.settings = Object.assign(clone(cfg().settings), s.settings || {});
    s.bagNew = false;
    s.cardsInfo = Object.assign({ firstGot: false, rerolls: 0, replaces: 0, swapOffers: 0, inserts: 0 }, s.cardsInfo || {});
    const swapTalent = { li: 'jianxin', zhi: 'huoling' };
    for (const c of s.roster) {
      if (c.card === undefined) c.card = null;
      if (c.origin === 'starter') c.talents = c.talents.map((t) => (swapTalent[t.id] && cfg().starters[c.role].talents.some((x) => x.id === swapTalent[t.id]) ? { id: swapTalent[t.id], roll: t.roll } : t));
    }
    // 引导 id：v2 的 chapterDone = 第一段通关
    const ren = (id) => (id === 'chapterDone' ? 'done:' + cfg().chapters[0].id : id);
    s.guide.queue = s.guide.queue.map(ren);
    if (s.guide.seen.chapterDone) { s.guide.seen[ren('chapterDone')] = true; delete s.guide.seen.chapterDone; }
    if (isCleared(s, cfg().cards.firstCardStage)) grantFirstCard(s);
    return s;
  }

  /** v3（阶段 2）→ v4：加灵矿、采集、装备；打完第二段的直接开放采集 / 锻造房并排队采集引导 */
  function migrateV3(s) {
    s.v = cfg().saveVersion;
    s.ore = s.ore || 0;
    s.gather = s.gather || { ids: [], last: null };
    s.gearBag = s.gearBag || [];
    s.nextGearId = s.nextGearId || 1;
    s.unlocks = Object.assign({ cave: false, forge: false }, s.unlocks || {});
    s.settings = Object.assign(clone(cfg().settings), s.settings || {});
    s.stats = Object.assign(emptyStats(), s.stats || {});
    for (const c of s.roster) c.equip = Object.assign(emptyEquip(), c.equip || {});
    if (s.pendingRecruit) s.pendingRecruit.equip = Object.assign(emptyEquip(), s.pendingRecruit.equip || {});
    if (chapterDone(s, cfg().gather.unlockChapter)) unlockForge(s);
    return s;
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
      activeCard: c.card ? { id: c.card.id, roll: c.card.roll } : null, passiveCard: null,
      gear: gearBonus(c.equip),
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
    if (isGathering(save, id)) return 'gather';
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
      A: lineupChars(save).map(({ entry, char }) => ({ char: charDef(char), row: solo ? 'front' : entry.row })),
      B: stage.enemies.map((e) => ({ enemyId: e.enemyId, level: e.level, row: e.row })),
    };
  }
  function lineupSig(save) {
    // 等级或装备变了都算阵容变化（自动推关会再挑战一次最新关）
    return lineupChars(save).map(({ char }) => char.id + ':' + char.level + (char.equip ? ':' + cfg().forge.slots.map((sl) => (char.equip[sl] ? char.equip[sl].id : '')).join('.') : '')).join(',');
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
      drops: keep ? rollDrops(save, stageId, seed, victims) : [],
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
        const ch = chapterOf(o.stageId);
        if (ch && ch.stages[ch.stages.length - 1].id === o.stageId) {
          queueGuide(save, 'done:' + ch.id);
          if (ch.id === cfg().gather.unlockChapter) unlockForge(save);
        }
        if (o.stageId === cfg().cards.firstCardStage) grantFirstCard(save);
        if (o.stageId === cfg().recruit.extraGuideStage) queueGuide(save, 'extraRecruit');
        // 卡关补装备的引导：这关打过了就不用了
        const gid = 'gearUp:' + o.stageId;
        if (save.guide.queue.includes(gid)) { save.guide.queue = save.guide.queue.filter((x) => x !== gid); save.guide.seen[gid] = true; }
      }
    } else {
      save.progress.lost[o.stageId] = (save.progress.lost[o.stageId] || 0) + 1;
      // 第三段卡关：引导「该去打装备了」（等灵矿和金币够了才弹出，不够时不拦自动推关）
      const ch = chapterOf(o.stageId);
      if (o.frontier && ch && (cfg().forge.stuckGuideChapters || []).includes(ch.id) && save.guide.seen.forge) {
        queueGuide(save, 'gearUp:' + o.stageId);
        // 上阵位还能研究、又没在研究：顺带提示多开一个上阵位（只提示一次）
        if (!save.research.active && researchNext(save) && pickSlotResearcher(save)) queueGuide(save, 'moreSlots');
      }
    }
    // 洞府：在开放关第一次战败（或单人硬过）时开放
    if (o.stageId === cfg().recruit.unlockStage && !save.unlocks.cave) {
      unlockCave(save);
      caveUnlocked = true;
    }
    const drops = addDrops(save, o.drops || []);
    return { levelUps, expEach: each, gold: o.gold, firstClear: o.win && !wasCleared, unlocked, caveUnlocked, drops };
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
    const innates = R.innatePool[role].filter((id) => !(opts.excludeInnates || []).includes(id));
    const innate = rng.pick(innates.length ? innates : R.innatePool[role]);
    // 拿到第一张卡之后，新招募的角色自带一张按天赋倾向随机的卡（已插好、已掷数值）
    let card = null;
    if (cfg().cards.recruitCard && save.cardsInfo && save.cardsInfo.firstGot) {
      const pool = cfg().cards.pool[role];
      const talentTags = talents.flatMap((t) => DAO.CONFIG.talents[t.id].tags || []);
      const liked = pool.filter((id) => DAO.tagsMatch(cardTags(id), talentTags) && talentTags.length);
      card = { id: rng.pick(liked.length ? liked : pool), roll: Math.round(rng.next() * 100) / 100 };
    }
    return {
      id: 'c' + save.nextId, name, role, quality, origin: 'recruit',
      level: Math.max(1, maxLevel(save) + R.levelOffset), exp: 0,
      base: clone(ref.base), growth,
      innate, branch: 0, talents, card,
      equip: emptyEquip(),
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
    if (free) opts.excludeInnates = R.firstExcludeInnates || [];
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
  function dismiss(save, id, now) {
    if (!canDismiss(save, id)) return false;
    if (isGathering(save, id)) stopGather(save, id, now, { noLineup: true });
    returnGear(save, getChar(save, id));   // 身上的装备回背包
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
    return lv <= Math.min(S.max, S.stageCap || S.max) ? Object.assign({ level: lv }, S.levels[lv]) : null;
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
    if (isGathering(save, charId)) stopGather(save, charId, now, { noLineup: true });
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
    // 研究者是从采集调过来的、现在没人采集了：再引导一次派人去采集
    if (save.unlocks.forge && !save.gather.ids.length && save.guide.seen.gather) { delete save.guide.seen.gather; queueGuide(save, 'gather'); }
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

  /** 取消研究（把研究中的人调去别处）：退还金币，研究者变为闲置 */
  function cancelResearch(save) {
    const a = save.research.active;
    if (!a) return null;
    const lv = cfg().research.slots.levels[a.level];
    save.gold += lv ? lv.gold : 0;
    save.research.active = null;
    return a.charId;
  }

  // ================= 采集（灵矿） =================
  function isGathering(save, id) { return !!(save.gather && save.gather.ids.includes(id)); }
  /** 资质系数 = 力成长 ÷ 参考值（开局剑修 = 1.0），有下限 */
  function gatherFactor(c) {
    const G = cfg().gather;
    return Math.max(G.minFactor, c.growth.str / G.refStrGrowth);
  }
  function gatherRate(c) { return cfg().gather.perSec * gatherFactor(c); }
  function totalGatherRate(save) {
    return save.gather.ids.reduce((a, id) => { const c = getChar(save, id); return a + (c ? gatherRate(c) : 0); }, 0);
  }
  /** 按秒结算到 now。离线不计算：页面重新打开时先调 resumeGather，关掉期间的产出不补。 */
  function tickGather(save, now) {
    const g = save.gather;
    if (!g.ids.length || g.last == null) { g.last = now; return 0; }
    const dt = Math.max(0, now - g.last);
    const gain = (totalGatherRate(save) * dt) / 1000;
    save.ore += gain;
    save.stats.oreTotal += gain;
    save.stats.gatherCharMs += dt * g.ids.length;
    g.last = now;
    return gain;
  }
  function resumeGather(save, now) { save.gather.last = now; }
  /** 能不能派这个角色去采集；返回原因（null = 可以） */
  function gatherBlock(save, id) {
    if (!save.unlocks.forge) return 'locked';
    const c = getChar(save, id);
    if (!c) return 'nochar';
    if (isGathering(save, id)) return 'already';
    if (isResearching(save, id)) return 'research';
    if (inLineup(save, id) && save.lineup.length <= 1) return 'lastFighter';
    return null;
  }
  function startGather(save, id, now) {
    if (gatherBlock(save, id)) return false;
    tickGather(save, now);
    if (inLineup(save, id)) removeFromLineup(save, id);
    save.gather.ids.push(id);
    return true;
  }
  /** 召回：变为闲置；有空的上阵位就自动上阵（opts.noLineup 不上阵） */
  function stopGather(save, id, now, opts) {
    if (!isGathering(save, id)) return false;
    if (now != null) tickGather(save, now);
    save.gather.ids = save.gather.ids.filter((x) => x !== id);
    if (!(opts && opts.noLineup)) addToLineup(save, id);
    return true;
  }
  /**
   * 采集引导的默认做法：闲置里力资质最高的 → 招募一位（金币够、名额没满）→ 把研究中的人调去 → 上阵里非开局角色中等级最低的。
   * @returns { mode: 'idle'|'recruit'|'research'|'lineup', charId?, cost? } 或 null
   */
  function gatherPlan(save, now) {
    const idle = save.roster.filter((c) => status(save, c.id) === 'idle').sort((a, b) => b.growth.str - a.growth.str);
    if (idle.length) return { mode: 'idle', charId: idle[0].id };
    const opts = gatherOptions(save, now);
    return opts[0] || null;
  }
  /** 没有闲置角色时的几种办法（引导里列出来让玩家选） */
  function gatherOptions(save, now) {
    const out = [];
    if (save.unlocks.cave && !save.pendingRecruit && save.roster.length < cfg().roster.cap && save.gold >= recruitCost(save, now)) out.push({ mode: 'recruit', cost: recruitCost(save, now) });
    if (save.research.active) out.push({ mode: 'research', charId: save.research.active.charId });
    if (save.lineup.length > 1) {
      const l = lineupChars(save).map((x) => x.char).filter((c) => c.origin !== 'starter')
        .sort((a, b) => a.level - b.level || b.growth.str - a.growth.str);
      if (l.length) out.push({ mode: 'lineup', charId: l[0].id });
    }
    return out;
  }
  /** 按计划派人去采集；返回 { charId, recruit? } 或 null */
  function doGatherPlan(save, plan, now) {
    if (!plan) return null;
    const info = {};
    let id = plan.charId;
    if (plan.mode === 'recruit') {
      info.recruit = recruit(save, now);
      if (!info.recruit.ok || !info.recruit.added) return info.recruit.ok ? info : null;
      id = info.recruit.char.id;
    } else if (plan.mode === 'research') {
      cancelResearch(save);
    }
    if (!startGather(save, id, now)) return null;
    info.charId = id;
    return info;
  }

  // ================= 锻造房 / 装备 =================
  function recipe(slot) { return cfg().forge.recipes[slot]; }
  function forgeCost(tier) { return cfg().forge.costs[tier]; }
  function mainStat(c) { return c.role === 'mage' ? 'int' : 'str'; }
  /** 一件装备的加成（数值按配置表现算，调表后老装备跟着变） */
  function gearStats(item) {
    const r = recipe(item.slot);
    const t = r && r.tiers[item.tier];
    if (!t) return {};
    if (item.slot === 'ring') return { [item.stat]: t.value };
    return Object.assign({}, t);
  }
  function gearBonus(equip) {
    const out = {};
    if (!equip) return out;
    for (const slot of cfg().forge.slots) {
      const it = equip[slot];
      if (!it) continue;
      for (const [k, v] of Object.entries(gearStats(it))) out[k] = (out[k] || 0) + v;
    }
    return out;
  }
  function gearName(item) {
    const F = cfg().forge;
    const statName = { str: '力', agi: '敏', int: '智' };
    return F.tierNames[item.tier] + recipe(item.slot).name + (item.slot === 'ring' ? '·' + statName[item.stat] : '');
  }
  function forgeBlock(save, slot, tier) {
    if (!save.unlocks.forge) return 'locked';
    const c = forgeCost(tier);
    if (!recipe(slot) || !c) return 'invalid';
    if (save.ore < c.ore) return 'ore';
    if (save.gold < c.gold) return 'gold';
    return null;
  }
  /** 即时打造一件，放进背包。opts.stat：戒指的三维（默认力） */
  function forge(save, slot, tier, opts) {
    if (forgeBlock(save, slot, tier)) return null;
    const c = forgeCost(tier);
    save.ore -= c.ore;
    save.gold -= c.gold;
    const r = recipe(slot);
    const item = { id: 'g' + save.nextGearId++, slot, tier };
    if (slot === 'ring') item.stat = r.stats.includes(opts && opts.stat) ? opts.stat : r.stats[0];
    save.gearBag.push(item);
    save.stats.forged++;
    save.stats.forgeGold += c.gold;
    save.stats.forgeOre += c.ore;
    return item;
  }
  /** 找装备：在背包或某个角色身上 */
  function findGear(save, gearId) {
    const i = save.gearBag.findIndex((g) => g.id === gearId);
    if (i >= 0) return { item: save.gearBag[i], owner: null };
    for (const c of save.roster) for (const slot of cfg().forge.slots) if (c.equip[slot] && c.equip[slot].id === gearId) return { item: c.equip[slot], owner: c };
    return null;
  }
  /** 穿上（可以从背包，也可以从别的角色身上换过来）；原来那件回背包 */
  function equip(save, charId, gearId) {
    const c = getChar(save, charId);
    const f = findGear(save, gearId);
    if (!c || !f) return false;
    if (f.owner && f.owner.id === c.id) return true;
    const slot = f.item.slot;
    if (f.owner) f.owner.equip[slot] = null;
    else save.gearBag = save.gearBag.filter((g) => g.id !== gearId);
    if (c.equip[slot]) save.gearBag.push(c.equip[slot]);
    c.equip[slot] = f.item;
    return true;
  }
  function unequip(save, charId, slot) {
    const c = getChar(save, charId);
    if (!c || !c.equip[slot]) return false;
    save.gearBag.push(c.equip[slot]);
    c.equip[slot] = null;
    return true;
  }
  function returnGear(save, c) {
    if (!c || !c.equip) return;
    for (const slot of cfg().forge.slots) if (c.equip[slot]) { save.gearBag.push(c.equip[slot]); c.equip[slot] = null; }
  }
  function forgeAndEquip(save, charId, slot, tier, stat) {
    const c = getChar(save, charId);
    const item = forge(save, slot, tier, { stat: stat || (c ? mainStat(c) : 'str') });
    if (item && c) equip(save, charId, item.id);
    return item;
  }
  /**
   * 下一件该做的装备（活动条提示 / 标准玩家用）：按上阵顺序 × 武器、胸甲、戒指，
   * 先补到「中品」（forge.hintTier），都到了再往上品走。背包里有更好的就直接穿（不花钱）。
   * @returns { kind: 'equip'|'forge', charId, slot, tier, stat?, gearId?, cost?, affordable } 或 null
   */
  function nextUpgrade(save) {
    if (!save.unlocks.forge) return null;
    const F = cfg().forge;
    const top = F.costs.length - 1;
    const chars = lineupChars(save).map((x) => x.char);
    for (const target of [F.hintTier, top]) {
      for (const c of chars) {
        for (const slot of F.slots) {
          const cur = c.equip[slot];
          const curTier = cur ? cur.tier : -1;
          if (curTier >= target) continue;
          const want = mainStat(c);
          const better = save.gearBag.filter((g) => g.slot === slot && g.tier > curTier && (slot !== 'ring' || g.stat === want)).sort((a, b) => b.tier - a.tier)[0];
          if (better) return { kind: 'equip', charId: c.id, slot, tier: better.tier, gearId: better.id, affordable: true };
          const cost = forgeCost(target);
          return { kind: 'forge', charId: c.id, slot, tier: target, stat: slot === 'ring' ? want : undefined, cost, affordable: !forgeBlock(save, slot, target) };
        }
      }
    }
    return null;
  }
  function doUpgrade(save, u) {
    if (!u || !u.affordable) return null;
    if (u.kind === 'equip') return equip(save, u.charId, u.gearId) ? findGear(save, u.gearId).item : null;
    return forgeAndEquip(save, u.charId, u.slot, u.tier, u.stat);
  }
  /** 活动条提示：灵矿和金币够打下一件时返回建议（不打断推关） */
  function forgeHint(save) {
    if (!save.settings.forgeHints) return null;
    const u = nextUpgrade(save);
    return u && u.kind === 'forge' && u.affordable ? u : null;
  }
  /** 现在的灵矿和金币一口气能做完的升级（不改存档），卡关引导的预览用 */
  function planUpgrades(save) {
    const s = clone(save);
    const out = [];
    for (let u = nextUpgrade(s), g = 0; u && u.affordable && g < 20; u = nextUpgrade(s), g++) {
      out.push(u);
      doUpgrade(s, u);
    }
    return out;
  }
  function doAllUpgrades(save) {
    const out = [];
    for (let u = nextUpgrade(save), g = 0; u && u.affordable && g < 20; u = nextUpgrade(save), g++) out.push(Object.assign({ item: doUpgrade(save, u) }, u));
    return out;
  }
  function unlockForge(save) {
    if (save.unlocks.forge) return;
    save.unlocks.forge = true;
    queueGuide(save, 'gather');
  }

  /** 卡关时研究上阵位找谁去：闲置里智力最高的，其次采集中智力最高的（采集中的人被调走，采集停下） */
  function pickSlotResearcher(save) {
    const ints = (c) => charUnit(c).base.int;
    const pick = (list) => list.sort((a, b) => ints(b) - ints(a))[0];
    const idle = save.roster.filter((c) => status(save, c.id) === 'idle');
    if (idle.length) return pick(idle).id;
    const gat = save.roster.filter((c) => isGathering(save, c.id));
    return gat.length ? pick(gat).id : null;
  }

  // ================= 技能卡 =================
  function cardDef(id) { return DAO.CONFIG.cards[id] || null; }
  function cardTags(id) {
    const s = DAO.Model.cardSkill({ id, roll: 0.5 });
    return s ? s.tags : [];
  }
  function canUseCard(c, cardId) {
    const d = cardDef(cardId);
    return !!(d && d.slot === 'active' && (!d.roles || d.roles.includes(c.role)));
  }
  function cardValue(id, roll) { const d = cardDef(id); return DAO.Model.rollValue(d.roll, roll); }
  function bagCount(save) { return Object.values(save.bag).reduce((a, b) => a + b, 0); }
  function addToBag(save, id, n) { save.bag[id] = (save.bag[id] || 0) + (n || 1); }

  /** 第一段首领首次通关：按开局角色定位固定掉落第一张卡，并排队插卡引导 */
  function grantFirstCard(save) {
    if (save.cardsInfo.firstGot) return;
    save.cardsInfo.firstGot = true;
    addToBag(save, cfg().cards.firstCard[starter(save).role]);
    queueGuide(save, 'firstCard');
  }

  /** 掉落（不改存档）：第二段起每击杀一只小怪，按概率掉同名卡或随机卡。种子由战斗种子派生。 */
  function rollDrops(save, stageId, seed, victims) {
    const D = cfg().cards.drops;
    const ch = chapterOf(stageId);
    if (!ch || !D.chapters.includes(ch.id)) return [];
    const rng = new DAO.RNG(DAO.hashSeed('drop:' + seed + ':' + stageId));
    const inserted = save.roster.filter((c) => c.card).map((c) => c.card.id);
    const all = [].concat(...Object.values(cfg().cards.pool));
    const out = [];
    for (const v of victims) {
      const t = cfg().enemies[v.id];
      if (t && t.boss && !D.bossKills) continue;
      const r = rng.next();
      if (r < D.perKill.same) { if (inserted.length) out.push(rng.pick(inserted)); }
      else if (r < D.perKill.same + D.perKill.other) out.push(rng.pick(all));
    }
    return out;
  }

  /** 掉落入包；记录「换卡选择」次数；有能用的卡就标记 bagNew（自动推关会停下来提示） */
  function addDrops(save, drops) {
    for (const id of drops) {
      addToBag(save, id);
      const kind = dropKind(save, id);
      if (kind === 'swap') save.cardsInfo.swapOffers++;
      if (kind) save.bagNew = true;
    }
    return drops;
  }
  /** 这张卡对现有角色意味着什么：reroll 重掷 / fill 插空槽 / swap 换卡选择 / null 暂时没人能用 */
  function dropKind(save, id) {
    const users = save.roster.filter((c) => canUseCard(c, id));
    if (users.some((c) => c.card && c.card.id === id)) return 'reroll';
    if (users.some((c) => !c.card)) return 'fill';
    if (users.length) return 'swap';
    return null;
  }

  /** 插卡预览：new 新插 / reroll 同名重掷（择优）/ replace 换卡（旧卡销毁） */
  function insertPreview(save, charId, cardId) {
    const c = getChar(save, charId);
    if (!c || !canUseCard(c, cardId) || !(save.bag[cardId] > 0)) return null;
    if (!c.card) return { mode: 'new' };
    if (c.card.id === cardId) return { mode: 'reroll', old: Object.assign({ value: cardValue(c.card.id, c.card.roll) }, c.card) };
    return { mode: 'replace', old: Object.assign({ value: cardValue(c.card.id, c.card.roll) }, c.card) };
  }

  /**
   * 插卡。掷数值用独立的掷数值种子（hashSeed('roll:' + rollSeed)，每掷 +1）。
   * @returns { mode, cardId, roll, value, old, kept: 'new'|'old' }
   */
  function insertCard(save, charId, cardId) {
    const pv = insertPreview(save, charId, cardId);
    if (!pv) return null;
    const c = getChar(save, charId);
    const rng = new DAO.RNG(DAO.hashSeed('roll:' + save.rollSeed));
    save.rollSeed++;
    const roll = Math.round(rng.next() * 100) / 100;
    save.bag[cardId]--;
    if (save.bag[cardId] <= 0) delete save.bag[cardId];
    const res = { mode: pv.mode, cardId, roll, value: cardValue(cardId, roll), old: pv.old || null, kept: 'new' };
    if (pv.mode === 'reroll') {
      save.cardsInfo.rerolls++;
      if (roll > c.card.roll) c.card.roll = roll; else res.kept = 'old';
    } else {
      if (pv.mode === 'replace') save.cardsInfo.replaces++;
      else save.cardsInfo.inserts++;
      c.card = { id: cardId, roll };
    }
    return res;
  }

  /** 背包里现在能做的事 */
  function cardActions(save) {
    const rerolls = [], fills = [], swaps = [];
    for (const [id, n] of Object.entries(save.bag)) {
      if (!(n > 0)) continue;
      for (const c of save.roster) {
        if (!canUseCard(c, id)) continue;
        if (c.card && c.card.id === id) rerolls.push({ charId: c.id, cardId: id });
        else if (!c.card) fills.push({ charId: c.id, cardId: id });
        else swaps.push({ charId: c.id, cardId: id });
      }
    }
    return { rerolls, fills, swaps, any: rerolls.length + fills.length + swaps.length > 0 };
  }

  /** 一键处理（提示框的默认动作、全自动玩家）：同名卡全部重掷，空卡槽插上能用的卡；不做换卡（换卡要玩家自己决定） */
  function autoHandleCards(save) {
    const results = [];
    let guard = 0;
    while (guard++ < 200) {
      const a = cardActions(save);
      const next = a.rerolls[0] || a.fills[0];
      if (!next) break;
      results.push(Object.assign({ charId: next.charId }, insertCard(save, next.charId, next.cardId)));
    }
    save.bagNew = false;
    return results;
  }
  function dismissCardPrompt(save) { save.bagNew = false; }

  // ================= 引导 =================
  function queueGuide(save, id) {
    if (save.guide.seen[id] || save.guide.queue.includes(id)) return;
    save.guide.queue.push(id);
  }
  /** 当前该弹的引导：队列里第一个现在就能执行的；都执行不了时返回队首（界面显示「等待中」） */
  function currentGuide(save) {
    const q = save.guide.queue;
    return q.find((id) => !guideBlock(save, id)) || q[0] || null;
  }
  /** 引导确认按钮当前能否执行（例如研究金币不够） */
  function guideBlock(save, id) {
    if (id === 'extraRecruit') {
      if (save.pendingRecruit) return 'pending';
      return save.gold >= recruitCost(save, guideNow) ? null : 'gold';
    }
    if (id === 'gather') return save.gather.ids.length || gatherPlan(save, guideNow) ? null : 'nochar';
    if (id === 'moreSlots') {
      if (save.research.active || !researchNext(save)) return null;   // 已经在研究 / 研究满了：确认后直接关掉
      const rid = pickSlotResearcher(save);
      return rid ? researchBlock(save, rid) : 'nochar';
    }
    if (id.startsWith('gearUp:')) {
      const u = nextUpgrade(save);
      return u && u.affordable ? null : 'ore';
    }
    if (id === 'forge') {
      if (Object.values(gearAll(save)).length) return null;
      return forgeBlock(save, cfg().forge.guideSlot, cfg().forge.guideTier);
    }
    if (id === 'research') {
      if (save.research.active || save.research.slots >= 2) return null;
      const rid = pickResearcher(save);
      if (!rid) return 'nochar';
      return researchBlock(save, rid);
    }
    return null;
  }
  /** 确认引导，执行它代表的动作 */
  let guideNow = Date.now();
  /** 玩家已经有的全部装备（背包 + 身上） */
  function gearAll(save) {
    const out = save.gearBag.slice();
    for (const c of save.roster) for (const slot of cfg().forge.slots) if (c.equip && c.equip[slot]) out.push(c.equip[slot]);
    return out;
  }
  /** 锻造引导给谁穿：开局角色在上阵就给他，否则第一个上阵角色 */
  function forgeGuideTarget(save) {
    const st = starter(save);
    if (inLineup(save, st.id)) return st.id;
    return save.lineup[0] ? save.lineup[0].id : st.id;
  }
  /**
   * @param opts { plan }：采集引导里玩家选的办法（默认 gatherPlan）
   */
  function ackGuide(save, id, now, opts) {
    guideNow = now || Date.now();
    opts = opts || {};
    if (!save.guide.queue.includes(id)) return { ok: false };
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
    } else if (id === 'firstCard') {
      const cid = cfg().cards.firstCard[starter(save).role];
      const target = save.roster.find((c) => c.origin === 'starter' && canUseCard(c, cid) && !c.card) ||
        save.roster.find((c) => canUseCard(c, cid) && !c.card);
      if (target && (save.bag[cid] || 0) > 0) info.insert = insertCard(save, target.id, cid);
    } else if (id === 'extraRecruit') {
      info.recruit = recruit(save, now);
    } else if (id === 'gather') {
      if (!save.gather.ids.length) {
        const r = doGatherPlan(save, opts.plan || gatherPlan(save, now), now);
        if (!r) return { ok: false, error: 'nochar' };
        Object.assign(info, r);
      }
      queueGuide(save, 'forge');
    } else if (id.startsWith('gearUp:')) {
      info.upgrades = doAllUpgrades(save);
    } else if (id === 'moreSlots') {
      if (!save.research.active && researchNext(save)) {
        const rid = pickSlotResearcher(save);
        if (rid && startResearch(save, rid, now)) info.researcher = rid;
      }
    } else if (id === 'forge') {
      if (!gearAll(save).length) {
        const F = cfg().forge;
        const tid = forgeGuideTarget(save);
        info.item = forgeAndEquip(save, tid, F.guideSlot, F.guideTier);
        info.charId = tid;
      }
    }
    save.guide.queue = save.guide.queue.filter((x) => x !== id);
    if (id.startsWith('gearUp:')) {
      // 卡关补装备的引导可以反复出现：这关还没过，就留在队列里，下次灵矿和金币够了再弹
      if (!isCleared(save, id.slice(7))) save.guide.queue.push(id);
    } else save.guide.seen[id] = true;
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
    if (save.bagNew && save.settings.cardPrompts && cardActions(save).any) return { type: 'wait', reason: 'cards' };
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
    chapters, chapterOf, chapterDone,
    cardDef, cardTags, canUseCard, cardValue, bagCount, insertPreview, insertCard, cardActions, autoHandleCards, dismissCardPrompt, dropKind, grantFirstCard,
    autoDecide, confirmBoss,
    cancelResearch,
    isGathering, gatherFactor, gatherRate, totalGatherRate, tickGather, resumeGather, gatherBlock, startGather, stopGather, gatherPlan, gatherOptions, doGatherPlan,
    recipe, forgeCost, mainStat, gearStats, gearBonus, gearName, forgeBlock, forge, findGear, equip, unequip, forgeAndEquip, nextUpgrade, doUpgrade, planUpgrades, doAllUpgrades, forgeHint, gearAll, pickSlotResearcher,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
