/**
 * 游戏模块 · recruit
 * 招募：价格、能不能招、生成候选（3 选 1）、选定、名额满时的决定。
 * 读写字段：recruit、recruitChoice、pendingRecruit、gachaSeed。花钱走 economy，加人走 roster.addChar。
 * 对外（挂在 DAO.Game 上）：recruitCost、recruitBlock、canRecruit、weighted、rollRecruit、rollCandidates、rollCandidate、recruit、candidateScore、defaultChoice、chooseRecruit、resolvePending
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const G = DAO.Game;
  const { clone, cfg, P } = DAO.GameUtil;

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
    if (save.roster.length >= G.rosterCap(save)) return 'full';
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
      const liked = pool.filter((id) => DAO.tagsMatch(G.cardTags(id), talentTags) && talentTags.length);
      card = { id: rng.pick(liked.length ? liked : pool), roll: Math.round(rng.next() * 100) / 100 };
    }
    return {
      id: null, name, role, quality, origin: 'recruit',
      level: Math.max(1, G.maxLevel(save) + R.levelOffset), exp: 0,
      base: clone(ref.base), growth,
      innate, branch: 0, talents, card,
      equip: G.emptyEquip(),
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
    if (free && R.firstComplement) ro.role = G.starter(save).role === 'sword' ? 'mage' : 'sword';
    if (free) ro.excludeInnates = R.firstExcludeInnates || [];
    const candidates = rollCandidates(save, R.candidates, ro);
    G.spendGold(save, cost);
    if (free) save.recruit.freeUsed = true;
    save.recruitChoice = { candidates, cost, free, reason: opts.reason || null, slot: opts.slot || null, mat: opts.mat || null, at: now || 0 };
    return { ok: true, cost, choice: save.recruitChoice };
  }

  /** 候选的综合资质（成长相对开局同定位角色的平均倍率） */
  function candidateScore(c) { return G.aptitude(c); }

  /** 默认选谁：为采集招募选力资质（力成长）最高的，其余选综合资质最高的；并列取靠前的 */
  function defaultChoice(save) {
    const ch = save.recruitChoice;
    if (!ch) return -1;
    // 为采集 / 打造招人：按那种原料 / 那条线用的三维的成长挑（灵矿和锻造看力、灵草和裁缝看敏、灵石和饰品看智）
    const stat = ch.reason === 'gather' ? (cfg().gather.mats[ch.mat || 'ore'] || {}).stat
      : ch.reason === 'craft' ? (cfg().production.lines[G.lineOfSlot(ch.slot)] || {}).stat : null;
    const key = stat ? (c) => c.growth[stat] : candidateScore;
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
    c.id = G.newCharId(save);
    save.recruitChoice = null;
    if (save.roster.length >= G.rosterCap(save)) {
      save.pendingRecruit = c;
      return { ok: true, char: c, added: false, needsDecision: true };
    }
    G.addChar(save, c);
    const res = { ok: true, char: c, added: true };
    if (ch.reason === 'gather' && save.unlocks.forge) res.gathering = G.startGather(save, c.id, now, ch.mat || 'ore');
    else if (ch.reason === 'craft' && ch.slot) res.crafting = G.startProduction(save, ch.slot, c.id, now) ? ch.slot : null;
    else G.addToLineup(save, c.id); // 有空的上阵位就直接上阵
    return res;
  }

  /** 名额满时的决定：keep=true 时遣散 dismissId 换进新人；keep=false 遣散新人 */
  function resolvePending(save, keep, dismissId) {
    const c = save.pendingRecruit;
    if (!c) return false;
    if (keep) {
      if (!G.dismiss(save, dismissId)) return false;
      G.addChar(save, c);
      G.addToLineup(save, c.id);
    }
    save.pendingRecruit = null;
    return true;
  }

  Object.assign(G, {
    recruitCost, recruitBlock, canRecruit, weighted, rollRecruit, rollCandidates, rollCandidate, recruit, candidateScore, defaultChoice,
    chooseRecruit, resolvePending,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
