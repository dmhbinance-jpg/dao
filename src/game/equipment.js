/**
 * 游戏模块 · equipment
 * 装备：品质、数值、名字、穿戴 / 卸下、装备背包、出售 / 分解（单件和批量）、推荐（穿更好的 / 派人打造 / 改做部位 / 升级建筑 / 分解多余）。
 * 读写字段：gearBag、nextGearId；角色身上的装备槽（roster 里角色对象的 equip）。出售的金币、分解的原料走 economy。
 * 对外（挂在 DAO.Game 上）：addGear、qualities、qualityIndex、qualityOf、mainStat、gearUsable、gearStats、gearBonus、gearName、gearRank、
 *   findGear、equip、unequip、returnGear、bestWearer、sellPrice、salvageReturn、disposeBlock、sellGear、salvageGear、disposeMany、
 *   disposePreview、surplusGear、nextUpgrade、doUpgrade、forgeHint、planUpgrades、doAllUpgrades、gearAll、firstEquipPlan
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const G = DAO.Game;
  const { clone, cfg, P } = DAO.GameUtil;

  function qualities() { return P().qualities; }

  function qualityIndex(id) { return qualities().findIndex((q) => q.id === id); }

  function qualityOf(id) { return qualities()[qualityIndex(id)] || qualities()[0]; }

  function mainStat(c) { return c.role === 'mage' ? 'int' : 'str'; }

  /** 装备能不能用：部位所在的生产线开放了、配方存在、没被标成「暂不可用」 */
  function gearUsable(item) { return !!item && !item.disabled && G.gearSlots().includes(item.slot) && !!G.recipe(item.slot); }

  /** 一件装备的加成 = 基础数值 × 品质倍率（按配置表现算，调表后老装备跟着变） */
  function gearStats(item) {
    if (!gearUsable(item)) return {};
    const r = G.recipe(item.slot), m = qualityOf(item.quality).mult;
    const out = {};
    for (const [k, v] of Object.entries(r.base)) out[k] = Math.round(v * m);
    return out;
  }

  function gearBonus(equip) {
    const out = {};
    if (!equip) return out;
    for (const slot of G.gearSlots()) {
      const it = equip[slot];
      if (!it) continue;
      for (const [k, v] of Object.entries(gearStats(it))) out[k] = (out[k] || 0) + v;
    }
    return out;
  }

  function gearName(item) {
    const r = G.recipe(item.slot);
    return `${qualityOf(item.quality).name}·${r ? r.name : G.slotName(item.slot)}${gearUsable(item) ? '' : '（暂不可用）'}`;
  }

  /** 同部位比较：品质高的更好 */
  function gearRank(item) { return item ? qualityIndex(item.quality) : -1; }

  /** 找装备：在背包或某个角色身上 */
  function findGear(save, gearId) {
    const i = save.gearBag.findIndex((g) => g.id === gearId);
    if (i >= 0) return { item: save.gearBag[i], owner: null };
    for (const c of save.roster) for (const slot of Object.keys(c.equip || {})) if (c.equip[slot] && c.equip[slot].id === gearId) return { item: c.equip[slot], owner: c };
    return null;
  }

  /** 穿上（可以从背包，也可以从别的角色身上换过来）；原来那件回背包。暂不可用的装备穿不上。 */
  function equip(save, charId, gearId) {
    const c = G.getChar(save, charId);
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
    const c = G.getChar(save, charId);
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
    if (!gearUsable(item) || !G.slotUnlocked(save, item.slot)) return null;
    let best = null;
    for (const { char } of G.lineupChars(save)) {
      const cur = char.equip[item.slot];
      if (gearRank(cur) >= gearRank(item)) continue;
      if (!best || gearRank(cur) < gearRank(best.equip[item.slot])) best = char;
    }
    return best ? best.id : null;
  }

  // ---- 出售 / 分解 ----
  const SV = () => cfg().salvage;
  /** 出售价 = 配方金币花费 × 品质比例 */
  function sellPrice(item) {
    const r = G.recipe(item.slot);
    return r ? Math.round((r.cost.gold || 0) * (SV().sell[item.quality] || 0)) : 0;
  }
  /** 分解返还 = 这条线原料的配方花费 × 品质比例 → { 原料: 数量 } */
  function salvageReturn(item) {
    const r = G.recipe(item.slot), line = G.lineOfSlot(item.slot);
    if (!r || !line) return {};
    const mat = P().lines[line].mat;
    return { [mat]: Math.round((r.cost[mat] || 0) * (SV().salvage[item.quality] || 0)) };
  }
  /** 能不能处理这件（null = 可以）：穿在身上的不行 */
  function disposeBlock(save, gearId) {
    const f = findGear(save, gearId);
    if (!f) return 'nogear';
    if (f.owner) return 'worn';
    return null;
  }
  function takeFromBag(save, gearId) {
    const it = save.gearBag.find((g) => g.id === gearId);
    save.gearBag = save.gearBag.filter((g) => g.id !== gearId);
    return it;
  }
  /** 出售：换金币，返回金币数（不能处理时 null） */
  function sellGear(save, gearId) {
    if (disposeBlock(save, gearId)) return null;
    const it = takeFromBag(save, gearId);
    const gold = sellPrice(it);
    G.addGold(save, gold);
    return gold;
  }
  /** 分解：返还部分原料，返回 { 原料: 数量 }（不能处理时 null） */
  function salvageGear(save, gearId) {
    if (disposeBlock(save, gearId)) return null;
    const it = takeFromBag(save, gearId);
    const ret = salvageReturn(it);
    G.refund(save, ret);
    return ret;
  }
  /** 批量处理会处理哪些（不改存档）：filter = { qualities?: [品质], slots?: [部位], ids?: [装备 id] }，只看背包 */
  function disposePreview(save, filter) {
    filter = filter || {};
    return save.gearBag.filter((g) => (!filter.qualities || filter.qualities.includes(g.quality)) &&
      (!filter.slots || filter.slots.includes(g.slot)) && (!filter.ids || filter.ids.includes(g.id)));
  }
  /**
   * 批量出售 / 分解（mode = 'sell' | 'salvage'）。穿在身上的不会被处理（只看背包）。
   * @returns { count, gold, mats: { 原料: 数量 } }
   */
  function disposeMany(save, mode, filter) {
    const out = { count: 0, gold: 0, mats: {} };
    for (const it of disposePreview(save, filter)) {
      if (mode === 'sell') { const g = sellGear(save, it.id); if (g == null) continue; out.gold += g; }
      else { const r = salvageGear(save, it.id); if (!r) continue; for (const [k, v] of Object.entries(r)) out.mats[k] = (out.mats[k] || 0) + v; }
      out.count++;
    }
    return out;
  }
  /** 背包里没人用得上的装备（没有哪个上阵角色穿上会更好） */
  function surplusGear(save) { return save.gearBag.filter((it) => gearUsable(it) && !bestWearer(save, it)); }

  // ---- 推荐 ----
  /** 一条线的打造建议：先补上阵角色空着的部位，都有了就补品质最低的；有空工位就派人，否则在需要时让一个工位改做 */
  function lineSuggestion(save, lineId) {
    const slots = P().lines[lineId].slots;
    const chars = G.lineupChars(save).map((x) => x.char);
    let target = null;
    for (const c of chars) for (const slot of slots) if (!target && !c.equip[slot]) target = { c, slot };
    if (!target) for (const c of chars) for (const slot of slots) if (!target || gearRank(c.equip[slot]) < gearRank(target.c.equip[target.slot])) target = { c, slot };
    if (!target) return null;
    const js = G.jobsOfLine(save, lineId);
    if (js.some((j) => j.slot === target.slot)) return null;          // 已经有人在做这个部位
    const empty = !target.c.equip[target.slot];
    const free = G.freeStation(save, lineId);
    if (!free) {
      // 工位都占了：这个部位还空着时，建议让第一个工位改做它
      if (!empty || !js.length) return null;
      return { kind: 'switch', line: lineId, key: js[0].key, slot: target.slot, charId: target.c.id, crafter: js[0].charId, affordable: true };
    }
    if (js.length && !empty) return null;                             // 已经有人在做这条线的另一个部位、这个部位也有装备：不再加人
    const crafter = G.pickCrafter(save, target.slot);
    return { kind: 'craft', line: lineId, slot: target.slot, charId: target.c.id, crafter, cost: G.craftCost(target.slot),
      affordable: !!crafter && !G.craftBlock(save, target.slot, crafter) && G.canAfford(save, target.slot) };
  }
  /** 建筑升级建议：在用的制造建筑（提高品质概率），或工位已满、还有闲人的采集建筑；升级后金币还要够研究下一个上阵位 */
  function buildSuggestion(save) {
    const reserve = G.researchable(save) ? (G.researchNext(save) || {}).gold || 0 : 0;
    const cands = [];
    for (const l of G.unlockedLines(save)) if (G.jobsOfLine(save, l.id).length) cands.push(G.craftBuilding(l.id));
    const idle = save.roster.some((c) => G.status(save, c.id) === 'idle');
    if (idle) for (const mat of G.MATS) if (G.matUnlocked(save, mat) && G.gatherersOf(save, mat).length >= G.gatherSlots(save, mat)) cands.push(G.gatherBuilding(mat));
    let first = null;
    for (const id of cands) {
      const cost = G.upgradeCost(save, id);
      if (!cost) continue;
      const u = { kind: 'build', building: id, cost, affordable: !G.upgradeBlock(save, id) && save.gold - (cost.gold || 0) >= reserve };
      if (u.affordable) return u;
      first = first || u;
    }
    return first;
  }

  /**
   * 下一步装备建议（活动条提示 / 卡关引导 / 全自动和标准玩家用），按开放了的生产线（6 个部位）：
   *  1. 背包里有比上阵角色身上更好的 → 穿上（不花钱）
   *  2. 每条线的打造建议（lineSuggestion）：派人去持续制造（kind 'craft'）/ 工位改做空着的部位（kind 'switch'）
   *  3. 背包里没人用得上的装备够多了 → 分解（kind 'salvage'）
   *  4. 升级在用的制造建筑 / 满员的采集建筑（kind 'build'）
   * 优先返回现在就能做的（affordable）；都做不了时返回第一条打造建议（界面显示还差什么）。
   */
  function nextUpgrade(save) {
    if (!save.unlocks.forge) return null;
    const bag = save.gearBag.filter(gearUsable).sort((a, b) => gearRank(b) - gearRank(a));
    for (const it of bag) {
      const w = bestWearer(save, it);
      if (w) return { kind: 'equip', charId: w, slot: it.slot, gearId: it.id, affordable: true };
    }
    const sugs = G.unlockedLines(save).map((l) => lineSuggestion(save, l.id)).filter(Boolean);
    const ok = sugs.find((u) => u.affordable);
    if (ok) return ok;
    const sur = surplusGear(save);
    if (sur.length >= SV().surplusMin) return { kind: 'salvage', gearIds: sur.map((g) => g.id), affordable: true };
    const b = buildSuggestion(save);
    if (b && b.affordable) return b;
    return sugs[0] || b || null;
  }

  function doUpgrade(save, u, now) {
    if (!u || !u.affordable) return null;
    if (u.kind === 'equip') return equip(save, u.charId, u.gearId) ? findGear(save, u.gearId).item : null;
    if (u.kind === 'switch') return G.switchProduction(save, u.key || u.line, u.slot) ? { switched: u.slot } : null;
    if (u.kind === 'salvage') { const r = disposeMany(save, 'salvage', { ids: u.gearIds }); return r.count ? r : null; }
    if (u.kind === 'build') return G.upgradeBuilding(save, u.building) ? { building: u.building, level: G.buildingLevel(save, u.building) } : null;
    const key = G.startProduction(save, u.slot, u.crafter, now);
    return key ? { crafting: u.slot, charId: u.crafter, key } : null;
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

  /** 新装备放进装备背包，返回这件装备 { id, slot, quality } */
  function addGear(save, slot, quality) {
    const item = { id: 'g' + save.nextGearId++, slot, quality };
    save.gearBag.push(item);
    return item;
  }

  Object.assign(G, {
    addGear, qualities, qualityIndex, qualityOf, mainStat, gearUsable, gearStats, gearBonus, gearName, gearRank, findGear, equip, unequip, returnGear,
    bestWearer, sellPrice, salvageReturn, disposeBlock, sellGear, salvageGear, disposeMany, disposePreview, surplusGear, nextUpgrade, doUpgrade, forgeHint, planUpgrades, doAllUpgrades, gearAll, firstEquipPlan,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
