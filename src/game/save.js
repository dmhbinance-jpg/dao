/**
 * 游戏模块 · save
 * 存档：新存档、迁移链（v1 → 当前版本）、存档里的设置 / 时钟 / 统计。存档位、备份、读不出来时的保护在 save-slots.js。
 * 读写字段：v、createdAt、settings、clock、stats（统计计数，其他模块通过 addStat 累加）；newSave 和迁移链负责整份存档的结构，不受字段归属限制。
 * 对外（挂在 DAO.Game 上）：starterChar、emptyEquip、emptyStats、newSave、migrate、migrateV1、migrateV2、migrateV3、migrateV4、migrateV5、migrateV6、isValidV2
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const G = DAO.Game;
  const { clone, cfg, P } = DAO.GameUtil;

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

  function emptyEquip() { const o = {}; for (const sl of G.gearSlots()) o[sl] = null; return o; }

  function emptyStats() {
    return { battles: 0, wins: 0, kills: 0, expTotal: 0, goldTotal: 0, playMs: 0, pushMs: 0, idleMs: 0, oreTotal: 0, herbTotal: 0, stoneTotal: 0, gatherCharMs: 0, forged: 0, forgeGold: 0, forgeOre: 0 };
  }

  function newBuildings() { const o = {}; for (const id of Object.keys(cfg().buildings.list)) o[id] = 1; return o; }

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
      herb: 0,                        // 灵草（阶段 4a）
      stone: 0,                       // 灵石（阶段 4a）
      gather: { ids: [], mats: {}, last: null },   // 采集中的角色和各自采的原料
      gearBag: [],
      nextGearId: 1,
      production: { jobs: {} },       // 生产任务（持续制造）：jobs[工位 id] = { line, slot, charId, cur, made, last }
      craftSeed: 1,                   // 掷品质的独立种子
      buildings: newBuildings(),      // 洞府建筑等级（阶段 4a）
    };
  }

  /**
   * 读入任意版本存档，返回 v2 存档或 null。
   * v1（阶段 0）：单个 hero → 角色 c1；已经打过开放关（通关或战败过）的直接开放洞府。
   */
  function migrate(s, now) {
    if (!s || typeof s !== 'object') return null;
    if (s.v === cfg().saveVersion) return isValidV2(s) ? s : null;
    if (s.v === 7) return isValidV2(s) ? migrateV7(s) : null;
    if (s.v === 6) return isValidV2(s) ? migrateV7(migrateV6(s)) : null;
    if (s.v === 5) return isValidV2(s) ? migrateV7(migrateV6(migrateV5(s))) : null;
    if (s.v === 4) return isValidV2(s) ? migrateV7(migrateV6(migrateV5(migrateV4(s)))) : null;
    if (s.v === 3) return isValidV2(s) ? migrateV7(migrateV6(migrateV5(migrateV4(migrateV3(s))))) : null;
    if (s.v === 2) return isValidV2(s) ? migrateV7(migrateV6(migrateV5(migrateV4(migrateV3(migrateV2(s)))))) : null;
    if (s.v === 1 && s.hero && cfg().starters[s.hero.role]) return migrateV7(migrateV6(migrateV5(migrateV4(migrateV3(migrateV2(migrateV1(s, now)))))));
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
    if (out.progress.cleared[cfg().recruit.unlockStage]) G.unlockCave(out);
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
    if (G.isCleared(s, cfg().cards.firstCardStage)) G.grantFirstCard(s);
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
    if (G.chapterDone(s, 'heifeng')) G.unlockForge(s);   // v4 的规则：第二段通关开放（v5 改到 1-8，见 migrateV4）
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
    if (G.isCleared(s, cfg().gather.unlockStage)) G.unlockForge(s);
    return s;
  }

  /**
   * v5（阶段 3.5）→ v6（阶段 3.6）：锻造改版。档位换品质（下品 → 白、中品 → 绿、上品 → 蓝）；
   * 戒指槽移除（以后归饰品线），穿着的戒指卸下放进背包、标「暂不可用」；加打造任务、打造种子、工坊等级。
   */
  function migrateV5(s) {
    s.v = 6;
    const TQ = ['white', 'green', 'blue'];
    const slots = G.gearSlots();
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
    s.crafting = s.crafting || null;   // v6 的单件打造（v7 迁移成生产任务）
    s.craftSeed = s.craftSeed || 1;
    s.workshops = Object.assign({ forge: { level: 1 } }, s.workshops || {});
    return s;
  }

  /** v6（阶段 3.6）→ v7（阶段 3.7）：单件打造 save.crafting 换成持续制造的生产任务 save.production.jobs */
  function migrateV6(s) {
    s.v = 7;
    s.production = s.production || { jobs: {} };
    const c = s.crafting;
    if (c && c.charId && c.slot) {
      const line = c.line || G.lineOfSlot(c.slot) || 'forge';
      s.production.jobs[line] = { line, slot: c.slot, charId: c.charId, cur: { cost: c.cost, durMs: c.durMs, progressMs: c.progressMs || 0 }, made: 0, last: c.last == null ? null : c.last };
    }
    delete s.crafting;
    return s;
  }

  /**
   * v7（阶段 3.7）→ v8（阶段 4a）：生产补完。
   *  - 加灵草、灵石；采集记录每人采的原料（老的都算灵矿）
   *  - 工坊等级 workshops 换成六个建筑 buildings（锻造房沿用原来的等级，其余 1 级）；采集工位按矿脉 1 级算，
   *    原来采集的人超过工位数也不踢（只是满员前不能再派）
   *  - 角色补齐 6 个装备槽；阶段 3.6 标「暂不可用」的戒指放进饰品线，恢复可用
   *  - 第三段已经通关的开放裁缝、饰品（排队「派人采集灵草 / 灵石」引导）
   *  - 统计补齐新项（顺带修好 v3–v6 老存档统计项缺失变 NaN 的问题）；设置补齐自动分解开关
   */
  function migrateV7(s) {
    s.v = cfg().saveVersion;
    s.herb = s.herb || 0;
    s.stone = s.stone || 0;
    s.gather = s.gather || { ids: [], last: null };
    s.gather.mats = s.gather.mats || {};
    for (const id of s.gather.ids) if (!s.gather.mats[id]) s.gather.mats[id] = 'ore';
    const b = newBuildings();
    if (s.workshops) { for (const [line, w] of Object.entries(s.workshops)) { const id = G.craftBuilding(line); if (id && w && w.level) b[id] = w.level; } delete s.workshops; }
    s.buildings = Object.assign(b, s.buildings || {});
    const fixEquip = (c) => { c.equip = Object.assign(emptyEquip(), c.equip || {}); };
    for (const c of s.roster) fixEquip(c);
    if (s.pendingRecruit) fixEquip(s.pendingRecruit);
    if (s.recruitChoice) for (const c of s.recruitChoice.candidates) fixEquip(c);
    const slots = G.gearSlots();
    const undisable = (it) => { if (it && it.disabled && slots.includes(it.slot)) delete it.disabled; };
    (s.gearBag || []).forEach(undisable);
    for (const c of s.roster) Object.values(c.equip).forEach(undisable);
    for (const ch of cfg().chapters) if (G.chapterDone(s, ch.id)) G.unlockLines(s, ch.id);
    s.stats = Object.assign(emptyStats(), s.stats || {});
    for (const k of Object.keys(s.stats)) if (typeof s.stats[k] !== 'number' || Number.isNaN(s.stats[k])) s.stats[k] = 0;
    s.settings = Object.assign(clone(cfg().settings), s.settings || {});
    s.production = s.production || { jobs: {} };
    return s;
  }

  function isValidV2(s) {
    return !!(s && Array.isArray(s.roster) && s.roster.length && Array.isArray(s.lineup) && s.research && s.progress);
  }

  /** 存档里的游戏时钟状态（DAO.GameClock 的 save() 结果） */
  function setClock(save, data) { save.clock = data; }
  /** 玩家设置（settings 里的开关） */
  function setSetting(save, key, value) { save.settings[key] = value; }
  /** 统计计数累加（各模块通过它写 stats） */
  function addStat(save, key, n) { save.stats[key] += n; }

  Object.assign(G, {
    setClock, setSetting, addStat, starterChar, emptyEquip, emptyStats, newSave, migrate, migrateV1, migrateV2, migrateV3, migrateV4, migrateV5, migrateV6, migrateV7, newBuildings, isValidV2,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
