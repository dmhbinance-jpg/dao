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
  function emptyEquip() { const o = {}; for (const sl of gearSlots()) o[sl] = null; return o; }

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
      recruit: { freeUsed: false },
      recruitChoice: null,   // 3 选 1 的候选（生成后存档，可以先关掉窗口再回来选；不能放弃重抽）
      pendingRecruit: null,  // 名额已满时选中的人，等玩家决定遣散谁
      quota: { extra: 0 },   // 名额扩建（预留，研究还没做）
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
      crafting: null,                 // 正在打造：{ line, slot, charId, cost, durMs, progressMs, last }
      craftSeed: 1,                   // 掷品质的独立种子
      workshops: { forge: { level: 1 } }, // 工坊等级（本阶段固定 1）
    };
  }

  /**
   * 读入任意版本存档，返回 v2 存档或 null。
   * v1（阶段 0）：单个 hero → 角色 c1；已经打过开放关（通关或战败过）的直接开放洞府。
   */
  function migrate(s, now) {
    if (!s || typeof s !== 'object') return null;
    if (s.v === cfg().saveVersion) return isValidV2(s) ? s : null;
    if (s.v === 5) return isValidV2(s) ? migrateV5(s) : null;
    if (s.v === 4) return isValidV2(s) ? migrateV5(migrateV4(s)) : null;
    if (s.v === 3) return isValidV2(s) ? migrateV5(migrateV4(migrateV3(s))) : null;
    if (s.v === 2) return isValidV2(s) ? migrateV5(migrateV4(migrateV3(migrateV2(s)))) : null;
    if (s.v === 1 && s.hero && cfg().starters[s.hero.role]) return migrateV5(migrateV4(migrateV3(migrateV2(migrateV1(s, now)))));
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
    s.v = 4;
    s.ore = s.ore || 0;
    s.gather = s.gather || { ids: [], last: null };
    s.gearBag = s.gearBag || [];
    s.nextGearId = s.nextGearId || 1;
    s.unlocks = Object.assign({ cave: false, forge: false }, s.unlocks || {});
    s.settings = Object.assign(clone(cfg().settings), s.settings || {});
    s.stats = Object.assign(emptyStats(), s.stats || {});
    for (const c of s.roster) c.equip = Object.assign({ weapon: null, chest: null, ring: null }, c.equip || {});
    if (s.pendingRecruit) s.pendingRecruit.equip = Object.assign({ weapon: null, chest: null, ring: null }, s.pendingRecruit.equip || {});
    if (chapterDone(s, 'heifeng')) unlockForge(s);   // v4 的规则：第二段通关开放（v5 改到 1-8，见 migrateV4）
    return s;
  }

  /**
   * v4（阶段 3）→ v5（阶段 3.5）：招募改 3 选 1、固定价格（递增价格 / 每日计数直接丢弃）；名额与上阵位分开（名额 10，
   * 超过的人不删，降到 10 以下之前不能招募）；采集 / 锻造房提前到 1-8；额外招募引导并进 1-8 的引导。
   */
  function migrateV4(s) {
    s.v = 5;
    s.recruit = { freeUsed: !!(s.recruit && s.recruit.freeUsed) };
    s.recruitChoice = s.recruitChoice || null;
    s.quota = s.quota || { extra: 0 };
    const drop = (id) => { s.guide.queue = s.guide.queue.filter((x) => x !== id); };
    if (s.guide.queue.includes('extraRecruit')) { drop('extraRecruit'); s.guide.seen.extraRecruit = true; }
    if (isCleared(s, cfg().gather.unlockStage)) unlockForge(s);
    return s;
  }

  /**
   * v5（阶段 3.5）→ v6（阶段 3.6）：锻造改版。档位换品质（下品 → 白、中品 → 绿、上品 → 蓝）；
   * 戒指槽移除（以后归饰品线），穿着的戒指卸下放进背包、标「暂不可用」；加打造任务、打造种子、工坊等级。
   */
  function migrateV5(s) {
    s.v = cfg().saveVersion;
    const TQ = ['white', 'green', 'blue'];
    const slots = gearSlots();
    const conv = (it) => {
      if (it.tier != null) { it.quality = TQ[it.tier] || 'white'; delete it.tier; }
      if (!it.quality) it.quality = 'white';
      if (!slots.includes(it.slot)) it.disabled = true;
      return it;
    };
    s.gearBag = (s.gearBag || []).map(conv);
    const fixChar = (c, toBag) => {
      const eq = c.equip || {};
      const out = emptyEquip();
      for (const [slot, it] of Object.entries(eq)) {
        if (!it) continue;
        conv(it);
        if (slots.includes(slot)) out[slot] = it; else if (toBag) s.gearBag.push(it);
      }
      c.equip = out;
    };
    for (const c of s.roster) fixChar(c, true);
    if (s.pendingRecruit) fixChar(s.pendingRecruit, false);
    if (s.recruitChoice) for (const c of s.recruitChoice.candidates) fixChar(c, false);
    s.crafting = s.crafting || null;
    s.craftSeed = s.craftSeed || 1;
    s.workshops = Object.assign({ forge: { level: 1 } }, s.workshops || {});
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
      art: c.art || (cfg().starters[c.role] || {}).art || null,
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
    if (isCrafting(save, id)) return 'craft';
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
    return lineupChars(save).map(({ char }) => char.id + ':' + char.level + (char.equip ? ':' + gearSlots().map((sl) => (char.equip[sl] ? char.equip[sl].id : '')).join('.') : '')).join(',');
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
        onFirstClear(save, o.stageId);
      }
    } else {
      save.progress.lost[o.stageId] = (save.progress.lost[o.stageId] || 0) + 1;
      // 第三段卡关：引导「该去打装备了」（等灵矿和金币够了才弹出，不够时不拦自动推关）
      const ch = chapterOf(o.stageId);
      if (o.frontier && ch && (cfg().forge.stuckGuideChapters || []).includes(ch.id) && save.guide.seen.forge) {
        // 上阵位还能研究、又没在研究：提示多开一个上阵位（每次研究完、再卡关时会再提示）
        if (researchable(save)) queueGuide(save, 'moreSlots');
        // 「该去打装备了」；这一章以上阵位为卡点（research.slots.stuckChapters）时，能研究就先研究，装备引导往后放
        if (!slotsFirst(save, ch.id)) queueGuide(save, 'gearUp:' + o.stageId);
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

  /** 某关第一次通关时开放的东西（章节通关引导、采集 / 锻造房、第一张卡）。存档工具「解锁关卡」也用它。 */
  function onFirstClear(save, stageId) {
    const ch = chapterOf(stageId);
    if (ch && ch.stages[ch.stages.length - 1].id === stageId) queueGuide(save, 'done:' + ch.id);
    if (stageId === cfg().gather.unlockStage) unlockForge(save);
    if (stageId === cfg().cards.firstCardStage) grantFirstCard(save);
    // 卡关补装备的引导：这关打过了就不用了
    const gid = 'gearUp:' + stageId;
    if (save.guide.queue.includes(gid)) { save.guide.queue = save.guide.queue.filter((x) => x !== gid); save.guide.seen[gid] = true; }
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

  // ================= 洞府：招募 =================
  function unlockCave(save) {
    save.unlocks.cave = true;
    queueGuide(save, 'cave');
  }

  /** 名额：总人数上限（和上阵位无关）。扩建名额的研究预留在 save.quota.extra。 */
  function rosterCap(save) { return cfg().roster.cap + ((save.quota && save.quota.extra) || 0); }
  /** 招募价格：首抽免费，之后固定（不递增、不按日重置） */
  function recruitCost(save) {
    const R = cfg().recruit;
    if (R.firstFree && !save.recruit.freeUsed) return 0;
    return R.cost;
  }
  /** 现在不能招募的原因（null = 可以）：locked 洞府没开 / choosing 还有候选没选 / pending 名额满了等决定 / full 名额已满 / gold 金币不够 */
  function recruitBlock(save) {
    if (!save.unlocks.cave) return 'locked';
    if (save.recruitChoice) return 'choosing';
    if (save.pendingRecruit) return 'pending';
    if (save.roster.length >= rosterCap(save)) return 'full';
    if (save.gold < recruitCost(save)) return 'gold';
    return null;
  }
  function canRecruit(save) { return !recruitBlock(save); }

  function weighted(rng, weights) {
    const entries = Object.entries(weights).filter(([, w]) => w > 0);
    const total = entries.reduce((a, [, w]) => a + w, 0);
    let x = rng.next() * total;
    for (const [k, w] of entries) { if ((x -= w) < 0) return k; }
    return entries[entries.length - 1][0];
  }

  /** 随机生成一个招募角色（不改存档，除了招募种子） */
  /** 生成一个招募角色（只用来测试 / 命令行造人；正式招募走 recruit 的 3 选 1）。每次用掉一个招募种子。 */
  function rollRecruit(save, opts) {
    const rng = new DAO.RNG(DAO.hashSeed('recruit:' + save.gachaSeed));
    save.gachaSeed++;
    const c = rollCandidate(save, rng, opts || {}, new Set(save.roster.map((x) => x.name)));
    c.id = 'c' + save.nextId;
    return c;
  }
  /** 用同一个招募种子生成 n 名候选（名字互不重复） */
  function rollCandidates(save, n, opts) {
    const rng = new DAO.RNG(DAO.hashSeed('recruit:' + save.gachaSeed));
    save.gachaSeed++;
    const used = new Set(save.roster.map((x) => x.name));
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = rollCandidate(save, rng, opts || {}, used);
      c.id = 'cand' + (i + 1);
      used.add(c.name);
      out.push(c);
    }
    return out;
  }
  function rollCandidate(save, rng, opts, usedNames) {
    const R = cfg().recruit;
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
    const freeNames = R.names.filter((n) => !usedNames.has(n));
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
      id: null, name, role, quality, origin: 'recruit',
      level: Math.max(1, maxLevel(save) + R.levelOffset), exp: 0,
      base: clone(ref.base), growth,
      innate, branch: 0, talents, card,
      equip: emptyEquip(),
    };
  }

  /**
   * 招募一次（3 选 1）：付钱，用同一个招募种子生成 3 名候选，存进 save.recruitChoice 等玩家挑。
   * 首抽免费，3 名候选都是与开局角色互补的定位、都不出「流影」。
   * @param opts { reason, slot }：'gather' = 为采集招募（默认选力资质最高的，选完直接去采集）；
   *   'craft' = 为打造招募（默认选力资质最高的，选完直接去打造 slot）
   * @returns { ok, cost, choice, error }
   */
  function recruit(save, now, opts) {
    opts = opts || {};
    const R = cfg().recruit;
    const blk = recruitBlock(save);
    if (blk) return { ok: false, error: blk, cost: recruitCost(save) };
    const cost = recruitCost(save);
    const free = R.firstFree && !save.recruit.freeUsed;
    const ro = {};
    if (free && R.firstComplement) ro.role = starter(save).role === 'sword' ? 'mage' : 'sword';
    if (free) ro.excludeInnates = R.firstExcludeInnates || [];
    const candidates = rollCandidates(save, R.candidates, ro);
    save.gold -= cost;
    if (free) save.recruit.freeUsed = true;
    save.recruitChoice = { candidates, cost, free, reason: opts.reason || null, slot: opts.slot || null, at: now || 0 };
    return { ok: true, cost, choice: save.recruitChoice };
  }
  /** 候选的综合资质（成长相对开局同定位角色的平均倍率） */
  function candidateScore(c) { return aptitude(c); }
  /** 默认选谁：为采集招募选力资质（力成长）最高的，其余选综合资质最高的；并列取靠前的 */
  function defaultChoice(save) {
    const ch = save.recruitChoice;
    if (!ch) return -1;
    const key = ch.reason === 'gather' || ch.reason === 'craft' ? (c) => c.growth.str : candidateScore;
    let best = 0;
    ch.candidates.forEach((c, i) => { if (key(c) > key(ch.candidates[best]) + 1e-9) best = i; });
    return best;
  }
  /**
   * 选定一名候选，其余离开。名额已满时放进 pendingRecruit 等玩家决定遣散谁（沿用原流程）。
   * 为采集招募的人选完直接去采集。
   * @returns { ok, char, added, needsDecision, gathering }
   */
  function chooseRecruit(save, index, now) {
    const ch = save.recruitChoice;
    if (!ch || !ch.candidates[index]) return { ok: false };
    const c = ch.candidates[index];
    c.id = 'c' + save.nextId;
    save.nextId++;
    save.recruitChoice = null;
    if (save.roster.length >= rosterCap(save)) {
      save.pendingRecruit = c;
      return { ok: true, char: c, added: false, needsDecision: true };
    }
    save.roster.push(c);
    const res = { ok: true, char: c, added: true };
    if (ch.reason === 'gather' && save.unlocks.forge) res.gathering = startGather(save, c.id, now);
    else if (ch.reason === 'craft' && ch.slot) res.crafting = startCraft(save, ch.slot, c.id, now) ? ch.slot : null;
    else addToLineup(save, c.id); // 有空的上阵位就直接上阵
    return res;
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
    if (isCrafting(save, id)) cancelCraft(save);   // 打造中：取消并退还材料
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
  /** 现在上阵位最多能研究到几级：stageCap，或按已开放的章节放宽（chapterCaps：打到这一章时上限变成多少） */
  function researchCap(save) {
    const S = cfg().research.slots;
    let cap = S.stageCap || S.max;
    for (const [chId, c] of Object.entries(S.chapterCaps || {})) {
      const idx = cfg().chapters.findIndex((ch) => ch.id === chId);
      if (idx > 0 && chapterDone(save, cfg().chapters[idx - 1].id)) cap = Math.max(cap, c);
    }
    return Math.min(S.max, cap);
  }
  function researchNext(save) {
    const S = cfg().research.slots;
    const lv = save.research.slots + 1;
    return lv <= researchCap(save) ? Object.assign({ level: lv }, S.levels[lv]) : null;
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
    if (isCrafting(save, charId)) return 'crafting';
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
    if (isCrafting(save, id)) return 'crafting';
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
    const opts = gatherOptions(save, now);
    return opts[0] || null;
  }
  /** 没有闲置角色时的几种办法（引导里列出来让玩家选） */
  /**
   * 派人去采集的办法，按默认顺序：招募一位（3 选 1，选完直接去采集；名额和金币够时）→ 闲置里力资质最高的 →
   * 把研究中的人调来 → 上阵里非开局角色中等级最低的。
   */
  function gatherOptions(save, now) {
    const out = [];
    if (canRecruit(save)) out.push({ mode: 'recruit', cost: recruitCost(save) });
    const idle = save.roster.filter((c) => status(save, c.id) === 'idle').sort((a, b) => b.growth.str - a.growth.str);
    if (idle.length) out.push({ mode: 'idle', charId: idle[0].id });
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
      // 3 选 1：先生成候选，玩家（或默认）选完后 chooseRecruit 会把人直接派去采集
      info.recruit = recruit(save, now, { reason: 'gather' });
      return info.recruit.ok ? info : null;
    } else if (plan.mode === 'research') {
      cancelResearch(save);
    }
    if (!startGather(save, id, now)) return null;
    info.charId = id;
    return info;
  }

  // ================= 生产线 / 品质 =================
  const P = () => cfg().production;
  /** 已开放的生产线 [{ id, ...line }] */
  function lines() { return Object.entries(P().lines).filter(([, l]) => l.enabled).map(([id, l]) => Object.assign({ id }, l)); }
  /** 角色身上能穿的装备部位（已开放生产线的部位；本阶段 = 武器、胸甲） */
  function gearSlots() { return lines().reduce((a, l) => a.concat(l.slots), []); }
  function lineOfSlot(slot) { const e = Object.entries(P().lines).find(([, l]) => l.slots.includes(slot)); return e ? e[0] : null; }
  function slotName(slot) { return P().slotNames[slot] || slot; }
  function qualities() { return P().qualities; }
  function qualityIndex(id) { return qualities().findIndex((q) => q.id === id); }
  function qualityOf(id) { return qualities()[qualityIndex(id)] || qualities()[0]; }
  /** 工坊等级（本阶段固定 1，升级以后做；存档 workshops[线].level） */
  function workshopLevel(save, lineId) { return ((save.workshops || {})[lineId] || {}).level || 1; }
  function qualityTable(save, lineId) {
    const T = P().qualityTables;
    return T[workshopLevel(save, lineId)] || T[1];
  }
  /** 掷品质：独立的打造种子（hashSeed('craft:' + craftSeed)，每掷 +1），同种子同结果 */
  function rollQuality(save, lineId) {
    const rng = new DAO.RNG(DAO.hashSeed('craft:' + save.craftSeed));
    save.craftSeed++;
    const table = qualityTable(save, lineId);
    const total = table.reduce((a, b) => a + b, 0);
    let x = rng.next() * total;
    for (let i = 0; i < table.length; i++) { x -= table[i]; if (x < 0 && table[i] > 0) return qualities()[i].id; }
    return qualities()[0].id;
  }

  // ================= 锻造 / 装备 =================
  /** 部位配方（所在生产线的 recipes；本阶段只有锻造线） */
  function recipe(slot) { const l = lineOfSlot(slot); return (l && cfg()[l] && cfg()[l].recipes && cfg()[l].recipes[slot]) || null; }
  function craftCost(slot) { const r = recipe(slot); return r ? r.cost : null; }
  function mainStat(c) { return c.role === 'mage' ? 'int' : 'str'; }
  /** 装备能不能用：部位所在的生产线开放了、配方存在、没被标成「暂不可用」 */
  function gearUsable(item) { return !!item && !item.disabled && gearSlots().includes(item.slot) && !!recipe(item.slot); }
  /** 一件装备的加成 = 基础数值 × 品质倍率（按配置表现算，调表后老装备跟着变） */
  function gearStats(item) {
    if (!gearUsable(item)) return {};
    const r = recipe(item.slot), m = qualityOf(item.quality).mult;
    const out = {};
    for (const [k, v] of Object.entries(r.base)) out[k] = Math.round(v * m);
    return out;
  }
  function gearBonus(equip) {
    const out = {};
    if (!equip) return out;
    for (const slot of gearSlots()) {
      const it = equip[slot];
      if (!it) continue;
      for (const [k, v] of Object.entries(gearStats(it))) out[k] = (out[k] || 0) + v;
    }
    return out;
  }
  function gearName(item) {
    const r = recipe(item.slot);
    return `${qualityOf(item.quality).name}·${r ? r.name : slotName(item.slot)}${gearUsable(item) ? '' : '（暂不可用）'}`;
  }
  /** 同部位比较：品质高的更好 */
  function gearRank(item) { return item ? qualityIndex(item.quality) : -1; }

  // ---- 打造（占用角色、要时间） ----
  function isCrafting(save, id) { return !!(save.crafting && save.crafting.charId === id); }
  /** 打造时长 = baseSec ÷ (1 + 打造值 × statCoef)，打造值 = 打造者在这条线用的三维（锻造用力） */
  function craftDurationMs(save, slot, charId) {
    const r = recipe(slot), c = getChar(save, charId);
    if (!r || !c) return 0;
    const line = P().lines[lineOfSlot(slot)];
    const v = charUnit(c).base[line.stat] || 0;
    return Math.round((r.baseSec * 1000) / (1 + v * P().craft.statCoef));
  }
  /** 不能打造的原因（null = 可以）。charId 省略时只看资源和工坊 */
  function craftBlock(save, slot, charId) {
    if (!save.unlocks.forge) return 'locked';
    const r = recipe(slot);
    if (!r || !gearSlots().includes(slot)) return 'invalid';
    if (save.crafting) return 'busy';
    if (save.ore < r.cost.ore) return 'ore';
    if (save.gold < r.cost.gold) return 'gold';
    if (charId === undefined) return null;
    const c = getChar(save, charId);
    if (!c) return 'nochar';
    if (isResearching(save, charId)) return 'research';
    if (inLineup(save, charId) && save.lineup.length <= 1) return 'lastFighter';
    return null;
  }
  /** 开始打造：扣材料，打造者离开上阵 / 采集（打完回到闲置） */
  function startCraft(save, slot, charId, now) {
    if (craftBlock(save, slot, charId)) return false;
    const r = recipe(slot);
    if (isGathering(save, charId)) stopGather(save, charId, now, { noLineup: true });
    if (inLineup(save, charId)) removeFromLineup(save, charId);
    save.ore -= r.cost.ore;
    save.gold -= r.cost.gold;
    save.crafting = { line: lineOfSlot(slot), slot, charId, cost: clone(r.cost), durMs: craftDurationMs(save, slot, charId), progressMs: 0, last: now };
    return true;
  }
  /** 按游戏时钟推进打造；打完掷品质、放进装备背包、打造者回到闲置。离线不计算（页面打开时 resumeCraft）。 */
  function tickCraft(save, now) {
    const j = save.crafting;
    if (!j) return null;
    if (j.last == null) j.last = now;
    j.progressMs += Math.max(0, now - j.last);
    j.last = now;
    if (j.progressMs < j.durMs) return null;
    const item = { id: 'g' + save.nextGearId++, slot: j.slot, quality: rollQuality(save, j.line) };
    save.gearBag.push(item);
    save.crafting = null;
    save.stats.forged++;
    save.stats.forgeGold += j.cost.gold;
    save.stats.forgeOre += j.cost.ore;
    if (!save.guide.seen.equipFirst) queueGuide(save, 'equipFirst');
    return { item, charId: j.charId };
  }
  function resumeCraft(save, now) { if (save.crafting) save.crafting.last = now; }
  function craftRemainingMs(save) { const j = save.crafting; return j ? Math.max(0, j.durMs - j.progressMs) : 0; }
  /** 取消打造：退还材料，打造者回到闲置 */
  function cancelCraft(save) {
    const j = save.crafting;
    if (!j) return null;
    save.ore += j.cost.ore;
    save.gold += j.cost.gold;
    save.crafting = null;
    return j.charId;
  }
  /** 派谁去打造：闲置里打造值（锻造 = 力）最高的 → 采集中力最高的（采集停下）→ null */
  function pickCrafter(save, slot) {
    const stat = (P().lines[lineOfSlot(slot || 'weapon')] || {}).stat || 'str';
    const v = (c) => charUnit(c).base[stat];
    const pick = (list) => list.sort((a, b) => v(b) - v(a))[0];
    const idle = save.roster.filter((c) => status(save, c.id) === 'idle');
    if (idle.length) return pick(idle).id;
    const gat = save.roster.filter((c) => isGathering(save, c.id));
    return gat.length ? pick(gat).id : null;
  }
  /**
   * 派人去打造的办法，按默认顺序：闲置里力最高的 → 招募一位（3 选 1，选完直接去打造；名额够、金币够招募 + 打造）→
   * 调一个采集的人（采集停下）→ 上阵里非开局角色中等级最低的。
   */
  function craftOptions(save, slot) {
    const out = [];
    const v = (c) => charUnit(c).base[(P().lines[lineOfSlot(slot)] || {}).stat || 'str'];
    const idle = save.roster.filter((c) => status(save, c.id) === 'idle').sort((a, b) => v(b) - v(a));
    if (idle.length) out.push({ mode: 'idle', charId: idle[0].id });
    const cost = craftCost(slot);
    if (canRecruit(save) && cost && save.gold >= recruitCost(save) + cost.gold) out.push({ mode: 'recruit', cost: recruitCost(save) });
    const gat = save.roster.filter((c) => isGathering(save, c.id)).sort((a, b) => v(b) - v(a));
    if (gat.length) out.push({ mode: 'gather', charId: gat[0].id });
    if (save.lineup.length > 1) {
      const l = lineupChars(save).map((x) => x.char).filter((c) => c.origin !== 'starter').sort((a, b) => a.level - b.level);
      if (l.length) out.push({ mode: 'lineup', charId: l[0].id });
    }
    return out;
  }
  /** 按办法派人去打造；招募的话先出 3 选 1，选完 chooseRecruit 会直接开工 */
  function doCraftPlan(save, slot, plan, now) {
    if (!plan) return null;
    if (plan.mode === 'recruit') {
      const r = recruit(save, now, { reason: 'craft', slot });
      return r.ok ? { recruit: r } : null;
    }
    return startCraft(save, slot, plan.charId, now) ? { charId: plan.charId } : null;
  }

  /** 找装备：在背包或某个角色身上 */
  function findGear(save, gearId) {
    const i = save.gearBag.findIndex((g) => g.id === gearId);
    if (i >= 0) return { item: save.gearBag[i], owner: null };
    for (const c of save.roster) for (const slot of Object.keys(c.equip || {})) if (c.equip[slot] && c.equip[slot].id === gearId) return { item: c.equip[slot], owner: c };
    return null;
  }
  /** 穿上（可以从背包，也可以从别的角色身上换过来）；原来那件回背包。暂不可用的装备穿不上。 */
  function equip(save, charId, gearId) {
    const c = getChar(save, charId);
    const f = findGear(save, gearId);
    if (!c || !f || !gearUsable(f.item)) return false;
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
    for (const slot of Object.keys(c.equip)) if (c.equip[slot]) { save.gearBag.push(c.equip[slot]); c.equip[slot] = null; }
  }
  /** 背包里这件给谁穿最合适：上阵角色里这个部位空着或品质最低的（并列取上阵顺序靠前的）；没人比它差就 null */
  function bestWearer(save, item) {
    if (!gearUsable(item)) return null;
    let best = null;
    for (const { char } of lineupChars(save)) {
      const cur = char.equip[item.slot];
      if (gearRank(cur) >= gearRank(item)) continue;
      if (!best || gearRank(cur) < gearRank(best.equip[item.slot])) best = char;
    }
    return best ? best.id : null;
  }
  /**
   * 下一步装备建议（活动条提示 / 卡关引导 / 标准玩家用），按部位，不分档位：
   *  1. 背包里有比上阵角色身上更好的 → 穿上（不花钱）
   *  2. 否则打造：先补上阵角色空着的部位（上阵顺序 × 武器、胸甲），都有了就补品质最低的那个部位
   * @returns { kind: 'equip', charId, slot, gearId, affordable: true } | { kind: 'craft', slot, charId（给谁做）, crafter, cost, affordable } | null
   */
  function nextUpgrade(save) {
    if (!save.unlocks.forge) return null;
    const bag = save.gearBag.filter(gearUsable).sort((a, b) => gearRank(b) - gearRank(a));
    for (const it of bag) {
      const w = bestWearer(save, it);
      if (w) return { kind: 'equip', charId: w, slot: it.slot, gearId: it.id, affordable: true };
    }
    const chars = lineupChars(save).map((x) => x.char);
    let target = null;
    for (const c of chars) for (const slot of gearSlots()) if (!target && !c.equip[slot]) target = { c, slot };
    if (!target) for (const c of chars) for (const slot of gearSlots()) if (!target || gearRank(c.equip[slot]) < gearRank(target.c.equip[target.slot])) target = { c, slot };
    if (!target) return null;
    const crafter = pickCrafter(save, target.slot);
    return { kind: 'craft', slot: target.slot, charId: target.c.id, crafter, cost: craftCost(target.slot), affordable: !!crafter && !craftBlock(save, target.slot, crafter) };
  }
  function doUpgrade(save, u, now) {
    if (!u || !u.affordable) return null;
    if (u.kind === 'equip') return equip(save, u.charId, u.gearId) ? findGear(save, u.gearId).item : null;
    return startCraft(save, u.slot, u.crafter, now) ? { crafting: u.slot, charId: u.crafter } : null;
  }
  /** 活动条提示（不打断推关）：有新装备可穿，或者材料够、有人能去打造 */
  function forgeHint(save) {
    if (!save.settings.forgeHints) return null;
    const u = nextUpgrade(save);
    return u && u.affordable ? u : null;
  }
  /** 现在一口气能做的装备动作（不改存档），卡关引导的预览用 */
  function planUpgrades(save, now) {
    const s = clone(save);
    const out = [];
    for (let u = nextUpgrade(s), g = 0; u && u.affordable && g < 20; u = nextUpgrade(s), g++) { out.push(u); doUpgrade(s, u, now || 0); }
    return out;
  }
  function doAllUpgrades(save, now) {
    const out = [];
    for (let u = nextUpgrade(save), g = 0; u && u.affordable && g < 20; u = nextUpgrade(save), g++) out.push(Object.assign({ item: doUpgrade(save, u, now) }, u));
    return out;
  }
  function unlockForge(save) {
    if (save.unlocks.forge) return;
    save.unlocks.forge = true;
    queueGuide(save, 'gather');
  }

  /** 现在能不能研究下一个上阵位（还有级、没在研究、有人可派；不管金币够不够） */
  function researchable(save) { return !save.research.active && !!researchNext(save) && !!pickSlotResearcher(save); }
  /** 这一章卡关时先研究上阵位（还能研究的话）再补装备 */
  function slotsFirst(save, chId) { return (cfg().research.slots.stuckChapters || []).includes(chId) && researchable(save); }
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
    if (id === 'gather') {
      if (save.recruitChoice || save.pendingRecruit) return 'choosing';
      return save.gather.ids.length || gatherPlan(save, guideNow) ? null : 'nochar';
    }
    if (id === 'moreSlots') {
      if (save.research.active || !researchNext(save)) return null;   // 已经在研究 / 研究满了：确认后直接关掉
      const rid = pickSlotResearcher(save);
      return rid ? researchBlock(save, rid) : 'nochar';
    }
    if (id.startsWith('gearUp:')) {
      const ch = chapterOf(id.slice(7));
      if (ch && slotsFirst(save, ch.id)) return 'research';
      const u = nextUpgrade(save);
      return u && u.affordable ? null : 'ore';
    }
    if (id === 'forge') {
      if (gearAll(save).length || save.crafting) return null;   // 已经有装备 / 正在打：确认后直接关掉
      if (save.recruitChoice || save.pendingRecruit) return 'choosing';
      const slot = cfg().forge.guideSlot;
      const blk = craftBlock(save, slot);
      if (blk) return blk;
      return craftOptions(save, slot).length ? null : 'nochar';
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
    for (const c of save.roster) for (const slot of Object.keys(c.equip || {})) if (c.equip[slot]) out.push(c.equip[slot]);
    return out;
  }
  /** 「穿上第一件装备」：背包里最好的一件，和最需要它的上阵角色 */
  function firstEquipPlan(save) {
    const bag = save.gearBag.filter(gearUsable).sort((a, b) => gearRank(b) - gearRank(a));
    for (const it of bag) { const w = bestWearer(save, it); if (w) return { gearId: it.id, charId: w }; }
    return null;
  }
  /**
   * @param opts { plan }：采集 / 打造引导里玩家选的办法（默认 gatherPlan / craftOptions 的第一个）
   */
  function ackGuide(save, id, now, opts) {
    guideNow = now || Date.now();
    opts = opts || {};
    if (!save.guide.queue.includes(id)) return { ok: false };
    if (guideBlock(save, id)) return { ok: false, error: guideBlock(save, id) };
    const info = { ok: true };
    if (id === 'cave') {
      if (!save.recruit.freeUsed && !save.recruitChoice) info.recruit = recruit(save, now);
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
    } else if (id === 'gather') {
      if (!save.gather.ids.length) {
        const r = doGatherPlan(save, opts.plan || gatherPlan(save, now), now);
        if (!r) return { ok: false, error: 'nochar' };
        Object.assign(info, r);
      }
      queueGuide(save, 'forge');
    } else if (id.startsWith('gearUp:')) {
      info.upgrades = doAllUpgrades(save, now);
    } else if (id === 'moreSlots') {
      if (!save.research.active && researchNext(save)) {
        const rid = pickSlotResearcher(save);
        if (rid && startResearch(save, rid, now)) info.researcher = rid;
      }
    } else if (id === 'forge') {
      if (!gearAll(save).length && !save.crafting) {
        const slot = cfg().forge.guideSlot;
        const r = doCraftPlan(save, slot, opts.plan || craftOptions(save, slot)[0], now);
        if (!r) return { ok: false, error: 'nochar' };
        Object.assign(info, r, { slot });
      }
    } else if (id === 'equipFirst') {
      const pl = firstEquipPlan(save);
      if (pl && equip(save, pl.charId, pl.gearId)) info.equipped = Object.assign({ item: findGear(save, pl.gearId).item }, pl);
    }
    save.guide.queue = save.guide.queue.filter((x) => x !== id);
    if (id.startsWith('gearUp:')) {
      // 卡关补装备的引导可以反复出现：这关还没过，就留在队列里，下次灵矿和金币够了再弹
      if (!isCleared(save, id.slice(7))) save.guide.queue.push(id);
    } else if (id !== 'moreSlots') save.guide.seen[id] = true;   // moreSlots 也可以再出现（下一级上阵位）
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
    if (save.recruitChoice) return { type: 'wait', reason: 'recruitChoice' };
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
    recruitCost, canRecruit, recruitBlock, rosterCap, rollRecruit, rollCandidates, recruit, candidateScore, defaultChoice, chooseRecruit,
    canDismiss, dismiss, resolvePending, onFirstClear, unlockCave, unlockForge,
    researchCap, researchNext, researchDurationMs, researchBlock, startResearch, tickResearch, pickResearcher,
    queueGuide, currentGuide, guideBlock, ackGuide,
    chapters, chapterOf, chapterDone,
    cardDef, cardTags, canUseCard, cardValue, bagCount, insertPreview, insertCard, cardActions, autoHandleCards, dismissCardPrompt, dropKind, grantFirstCard,
    autoDecide, confirmBoss,
    cancelResearch,
    isGathering, gatherFactor, gatherRate, totalGatherRate, tickGather, resumeGather, gatherBlock, startGather, stopGather, gatherPlan, gatherOptions, doGatherPlan,
    lines, gearSlots, lineOfSlot, slotName, qualities, qualityIndex, qualityOf, workshopLevel, qualityTable, rollQuality,
    recipe, craftCost, mainStat, gearUsable, gearStats, gearBonus, gearName, gearRank, findGear, equip, unequip, bestWearer, firstEquipPlan,
    isCrafting, craftDurationMs, craftBlock, startCraft, tickCraft, resumeCraft, craftRemainingMs, cancelCraft, pickCrafter, craftOptions, doCraftPlan,
    nextUpgrade, doUpgrade, planUpgrades, doAllUpgrades, forgeHint, gearAll, pickSlotResearcher,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
