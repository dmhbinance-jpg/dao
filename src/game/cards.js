/**
 * 游戏模块 · cards
 * 技能卡：背包、掉落、插卡（掷数值 / 重掷 / 换卡）、自动处理、第一张卡。
 * 读写字段：bag、bagNew、cardsInfo、rollSeed；角色的卡槽（roster 里角色对象的 card）。
 * 对外（挂在 DAO.Game 上）：cardDef、cardTags、canUseCard、cardValue、bagCount、addToBag、grantFirstCard、rollDrops、addDrops、dropKind、insertPreview、insertCard、cardActions、autoHandleCards、dismissCardPrompt
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const G = DAO.Game;
  const { clone, cfg, P } = DAO.GameUtil;

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
    addToBag(save, cfg().cards.firstCard[G.starter(save).role]);
    G.queueGuide(save, 'firstCard');
  }

  /** 掉落（不改存档）：第二段起每击杀一只小怪，按概率掉同名卡或随机卡。种子由战斗种子派生。 */
  function rollDrops(save, stageId, seed, victims) {
    const D = cfg().cards.drops;
    const ch = G.chapterOf(stageId);
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
    const c = G.getChar(save, charId);
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
    const c = G.getChar(save, charId);
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

  Object.assign(G, {
    cardDef, cardTags, canUseCard, cardValue, bagCount, addToBag, grantFirstCard, rollDrops, addDrops, dropKind, insertPreview, insertCard,
    cardActions, autoHandleCards, dismissCardPrompt,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
