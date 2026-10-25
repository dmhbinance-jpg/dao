/**
 * 游戏模块 · production
 * 生产：采集三种原料（灵矿 / 灵草 / 灵石，速率看力 / 敏 / 智，人数受采集建筑的工位数限制）和通用生产任务
 * （持续制造：锻造 / 裁缝 / 饰品，每条线的工位数看制造建筑等级），生产线 / 配方 / 品质概率。
 * 读写字段：gather（{ ids, mats: { 角色 id: 原料 }, last }）、production（{ jobs: { 工位 id: 任务 } }）、craftSeed。
 * 原料、金币的进出走 economy，打好的装备走 equipment.addGear（自动分解走 equipment.salvageGear），建筑等级读 buildings。
 * 对外（挂在 DAO.Game 上）：lineUnlocked、matUnlocked、slotUnlocked、unlockedLines、gatherMatOf、gatherersOf、gatherSlots、
 *   isGathering、gatherFactor、gatherRate、totalGatherRate、tickGather、resumeGather、gatherBlock、startGather、stopGather、
 *   gatherPlan、gatherOptions、doGatherPlan、lines、gearSlots、lineOfSlot、slotName、workshopLevel、qualityTable、rollQuality、
 *   recipe、craftCost、jobs、jobOf、jobsOfLine、stationIds、freeStation、jobOfChar、isCrafting、craftDurationMs、canAfford、
 *   craftBlock、tryStartItem、startProduction、tickProduction、resumeProduction、craftRemainingMs、recallProduction、
 *   switchProduction、pickCrafter、craftOptions、doCraftPlan
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const G = DAO.Game;
  const { clone, cfg, P } = DAO.GameUtil;
  const GM = () => cfg().gather.mats;

  // ---- 开放 ----
  /** 生产线开放了没有：锻造看 unlocks.forge（1-8），裁缝 / 饰品看 unlocks[线 id]（第三段通关） */
  function lineUnlocked(save, lineId) {
    const l = P().lines[lineId];
    if (!l || !l.enabled) return false;
    return !!(lineId === 'forge' ? save.unlocks.forge : save.unlocks[lineId]);
  }
  function matUnlocked(save, mat) { return !!GM()[mat] && lineUnlocked(save, GM()[mat].line); }
  function slotUnlocked(save, slot) { const l = lineOfSlot(slot); return !!l && lineUnlocked(save, l); }
  function unlockedLines(save) { return lines().filter((l) => lineUnlocked(save, l.id)); }

  // ---- 采集 ----
  function isGathering(save, id) { return !!(save.gather && save.gather.ids.includes(id)); }
  /** 这个人在采哪种原料（没记录的老数据算灵矿） */
  function gatherMatOf(save, id) { return isGathering(save, id) ? ((save.gather.mats || {})[id] || 'ore') : null; }
  function gatherersOf(save, mat) { return save.gather.ids.filter((id) => gatherMatOf(save, id) === mat); }
  /** 这种原料的采集工位数（采集建筑等级决定） */
  function gatherSlots(save, mat) { return G.buildingSlots(save, G.gatherBuilding(mat)); }

  /** 资质系数 = 对应三维的成长 ÷ 参考值（开局剑修采灵矿 = 1.0），有下限 */
  function gatherFactor(c, mat) {
    const Gc = cfg().gather;
    const stat = (GM()[mat || 'ore'] || GM().ore).stat;
    return Math.max(Gc.minFactor, c.growth[stat] / Gc.refGrowth);
  }

  function gatherRate(c, mat) { return cfg().gather.perSec * gatherFactor(c, mat); }

  /** 每秒总产量：mat 给定时只算这种原料，否则所有原料加起来 */
  function totalGatherRate(save, mat) {
    return save.gather.ids.reduce((a, id) => {
      const m = gatherMatOf(save, id);
      if (mat && m !== mat) return a;
      const c = G.getChar(save, id);
      return a + (c ? gatherRate(c, m) : 0);
    }, 0);
  }

  /** 按秒结算到 now。离线不计算：页面重新打开时先调 resumeGather，关掉期间的产出不补。返回这次各原料的产出 */
  function tickGather(save, now) {
    const g = save.gather;
    if (!g.ids.length || g.last == null) { g.last = now; return {}; }
    const dt = Math.max(0, now - g.last);
    const gains = {};
    for (const mat of G.MATS) {
      const n = gatherersOf(save, mat).length;
      if (!n) continue;
      const gain = (totalGatherRate(save, mat) * dt) / 1000;
      G.addMat(save, mat, gain);
      G.addStat(save, mat + 'Total', gain);
      gains[mat] = gain;
    }
    G.addStat(save, 'gatherCharMs', dt * g.ids.length);
    g.last = now;
    return gains;
  }

  function resumeGather(save, now) { save.gather.last = now; }

  /** 能不能派这个角色去采这种原料；返回原因（null = 可以） */
  function gatherBlock(save, id, mat) {
    mat = mat || 'ore';
    if (!matUnlocked(save, mat)) return 'locked';
    const c = G.getChar(save, id);
    if (!c) return 'nochar';
    if (isGathering(save, id)) return gatherMatOf(save, id) === mat ? 'already' : 'otherMat';
    if (G.isResearching(save, id)) return 'research';
    if (isCrafting(save, id)) return 'crafting';
    if (G.inLineup(save, id) && save.lineup.length <= 1) return 'lastFighter';
    if (gatherersOf(save, mat).length >= gatherSlots(save, mat)) return 'full';
    return null;
  }

  function startGather(save, id, now, mat) {
    mat = mat || 'ore';
    if (gatherBlock(save, id, mat)) return false;
    tickGather(save, now);
    if (G.inLineup(save, id)) G.removeFromLineup(save, id);
    save.gather.ids.push(id);
    save.gather.mats = save.gather.mats || {};
    save.gather.mats[id] = mat;
    return true;
  }

  /** 召回：变为闲置；有空的上阵位就自动上阵（opts.noLineup 不上阵） */
  function stopGather(save, id, now, opts) {
    if (!isGathering(save, id)) return false;
    if (now != null) tickGather(save, now);
    save.gather.ids = save.gather.ids.filter((x) => x !== id);
    if (save.gather.mats) delete save.gather.mats[id];
    if (!(opts && opts.noLineup)) G.addToLineup(save, id);
    return true;
  }

  /** 采集引导的默认做法（gatherOptions 的第一个） */
  function gatherPlan(save, now, mat) {
    const opts = gatherOptions(save, now, mat);
    return opts[0] || null;
  }

  /**
   * 派人去采集某种原料的办法，按默认顺序：招募一位（3 选 1，选完直接去采集；名额和金币够时）→ 闲置里对应资质最高的 →
   * 把研究中的人调来 → 上阵里非开局角色中等级最低的。工位满了时没有办法（返回空）。
   */
  function gatherOptions(save, now, mat) {
    mat = mat || 'ore';
    const out = [];
    if (!matUnlocked(save, mat) || gatherersOf(save, mat).length >= gatherSlots(save, mat)) return out;
    const stat = GM()[mat].stat;
    if (G.canRecruit(save)) out.push({ mode: 'recruit', cost: G.recruitCost(save), mat });
    const idle = save.roster.filter((c) => G.status(save, c.id) === 'idle').sort((a, b) => b.growth[stat] - a.growth[stat]);
    if (idle.length) out.push({ mode: 'idle', charId: idle[0].id, mat });
    if (save.research.active) out.push({ mode: 'research', charId: save.research.active.charId, mat });
    if (save.lineup.length > 1) {
      const l = G.lineupChars(save).map((x) => x.char).filter((c) => c.origin !== 'starter')
        .sort((a, b) => a.level - b.level || b.growth[stat] - a.growth[stat]);
      if (l.length) out.push({ mode: 'lineup', charId: l[0].id, mat });
    }
    return out;
  }

  /** 按计划派人去采集；返回 { charId, recruit? } 或 null */
  function doGatherPlan(save, plan, now) {
    if (!plan) return null;
    const mat = plan.mat || 'ore';
    const info = {};
    const id = plan.charId;
    if (plan.mode === 'recruit') {
      // 3 选 1：先生成候选，玩家（或默认）选完后 chooseRecruit 会把人直接派去采集
      info.recruit = G.recruit(save, now, { reason: 'gather', mat });
      return info.recruit.ok ? info : null;
    } else if (plan.mode === 'research') {
      G.cancelResearch(save);
    }
    if (!startGather(save, id, now, mat)) return null;
    info.charId = id;
    info.mat = mat;
    return info;
  }

  // ---- 生产线 / 品质 ----
  /** 配置里启用的生产线 [{ id, ...line }]（是否已开放看 lineUnlocked） */
  function lines() { return Object.entries(P().lines).filter(([, l]) => l.enabled).map(([id, l]) => Object.assign({ id }, l)); }

  /** 角色身上的装备部位（三条线各 2 个，共 6 个；没开放的线的部位穿不了新装备，但槽位一直在） */
  function gearSlots() { return lines().reduce((a, l) => a.concat(l.slots), []); }

  function lineOfSlot(slot) { const e = Object.entries(P().lines).find(([, l]) => l.slots.includes(slot)); return e ? e[0] : null; }

  function slotName(slot) { return P().slotNames[slot] || slot; }

  /** 制造建筑等级（buildings 模块） */
  function workshopLevel(save, lineId) { return G.buildingLevel(save, G.craftBuilding(lineId)); }

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
    for (let i = 0; i < table.length; i++) { x -= table[i]; if (x < 0 && table[i] > 0) return G.qualities()[i].id; }
    return G.qualities()[0].id;
  }

  /** 部位配方（所在生产线的 recipes） */
  function recipe(slot) { const l = lineOfSlot(slot); return (l && cfg()[l] && cfg()[l].recipes && cfg()[l].recipes[slot]) || null; }

  function craftCost(slot) { const r = recipe(slot); return r ? r.cost : null; }

  // ---- 生产任务（持续制造；三条线通用） ----
  // save.production.jobs[工位 id] = { line, slot, charId, cur, made, last }
  //   工位 id：每条线第 1 个工位就是线 id（'forge'），第 n 个是 '线 id' + n（'forge2'）；工位数看制造建筑等级。
  //   cur = { cost, durMs, progressMs } 正在做的这一件（开工时已扣材料）；null = 等待材料
  // 一个角色一个任务。派人后他一件接一件地做，直到召回；材料不够时停在岗位上等，够了自动继续。
  function jobs(save) { return (save.production && save.production.jobs) || {}; }

  /** 某个工位上的任务（工位 id；传线 id 就是这条线的第 1 个工位） */
  function jobOf(save, key) { return jobs(save)[key] || null; }

  /** 这条线上所有在做的任务 [{ key, ...job }]（按工位顺序） */
  function jobsOfLine(save, lineId) {
    return stationIds(save, lineId, true).filter((k) => jobs(save)[k]).map((k) => Object.assign({ key: k }, jobs(save)[k]));
  }

  /** 这条线的工位 id；all = true 时连超出当前工位数、但还有任务的工位也算上 */
  function stationIds(save, lineId, all) {
    const n = G.buildingSlots(save, G.craftBuilding(lineId));
    const out = [];
    for (let i = 1; i <= n; i++) out.push(i === 1 ? lineId : lineId + i);
    if (all) for (const [k, j] of Object.entries(jobs(save))) if (j.line === lineId && !out.includes(k)) out.push(k);
    return out;
  }

  /** 这条线第一个空着的工位 id；都占了返回 null */
  function freeStation(save, lineId) { return stationIds(save, lineId).find((k) => !jobs(save)[k]) || null; }

  function jobOfChar(save, id) {
    const e = Object.entries(jobs(save)).find(([, j]) => j.charId === id);
    return e ? Object.assign({ key: e[0] }, e[1]) : null;
  }

  function isCrafting(save, id) { return !!jobOfChar(save, id); }

  /** 一件的打造时长 = baseSec ÷ (1 + 打造值 × statCoef)，打造值 = 打造者在这条线用的三维（锻造力、裁缝敏、饰品智） */
  function craftDurationMs(save, slot, charId) {
    const r = recipe(slot), c = G.getChar(save, charId);
    if (!r || !c) return 0;
    const line = P().lines[lineOfSlot(slot)];
    const v = G.charUnit(c).base[line.stat] || 0;
    return Math.round((r.baseSec * 1000) / (1 + v * P().craft.statCoef));
  }

  /** 材料够不够开一件 */
  function canAfford(save, slot) { const c = craftCost(slot); return !!c && G.canPay(save, c); }

  /**
   * 能不能派这个人去做这个部位（null = 可以）。材料不够也能派（他会等材料）。
   * charId 省略时只看生产线开放、部位和空工位。
   */
  function craftBlock(save, slot, charId) {
    const line = lineOfSlot(slot);
    if (!line || !lineUnlocked(save, line)) return 'locked';
    const r = recipe(slot);
    if (!r || !gearSlots().includes(slot)) return 'invalid';
    if (!freeStation(save, line)) return 'busy';
    if (charId === undefined) return null;
    const c = G.getChar(save, charId);
    if (!c) return 'nochar';
    if (G.isResearching(save, charId)) return 'research';
    if (isCrafting(save, charId)) return 'crafting';
    if (G.inLineup(save, charId) && save.lineup.length <= 1) return 'lastFighter';
    return null;
  }

  /** 材料够就开下一件（扣材料），不够就等材料 */
  function tryStartItem(save, j) {
    if (canAfford(save, j.slot)) {
      const c = craftCost(j.slot);
      G.pay(save, c);
      j.cur = { cost: clone(c), durMs: craftDurationMs(save, j.slot, j.charId), progressMs: 0 };
    } else j.cur = null;
    return !!j.cur;
  }

  /** 派人去生产：占这条线第一个空工位，他离开上阵 / 采集，按部位持续制造。返回工位 id（失败 false） */
  function startProduction(save, slot, charId, now) {
    if (craftBlock(save, slot, charId)) return false;
    if (isGathering(save, charId)) stopGather(save, charId, now, { noLineup: true });
    if (G.inLineup(save, charId)) G.removeFromLineup(save, charId);
    const line = lineOfSlot(slot);
    const key = freeStation(save, line);
    save.production.jobs[key] = { line, slot, charId, cur: null, made: 0, last: now };
    tryStartItem(save, save.production.jobs[key]);
    return key;
  }

  /**
   * 按游戏时钟推进所有生产任务：做完一件就掷品质、放进背包、接着开下一件（多出来的时间顺延）；
   * 等材料的任务材料够了就开工。设置了自动分解时，低于那个品质的产出直接分解。离线不计算（页面打开时 resumeProduction）。
   * @returns [{ item, charId, line, key, salvaged? }] 这次做好的装备
   */
  function tickProduction(save, now) {
    const out = [];
    for (const [key, j] of Object.entries(jobs(save))) {
      if (j.last == null) j.last = now;
      let dt = Math.max(0, now - j.last);
      j.last = now;
      let guard = 0;
      while (guard++ < 1000) {
        if (!j.cur && !tryStartItem(save, j)) break;           // 等材料
        const need = j.cur.durMs - j.cur.progressMs;
        if (dt < need) { j.cur.progressMs += dt; break; }
        dt -= need;
        const item = G.addGear(save, j.slot, rollQuality(save, j.line));
        G.addStat(save, 'forged', 1);
        G.addStat(save, 'forgeGold', j.cur.cost.gold || 0);
        G.addStat(save, 'forgeOre', j.cur.cost[P().lines[j.line].mat] || 0);
        j.made++;
        j.cur = null;
        const rec = { item, charId: j.charId, line: j.line, key };
        const th = save.settings.autoSalvage;
        if (th && G.qualityIndex(item.quality) < G.qualityIndex(th)) rec.salvaged = G.salvageGear(save, item.id);
        out.push(rec);
        if (!rec.salvaged && !save.guide.seen.equipFirst) G.queueGuide(save, 'equipFirst');
        if (!rec.salvaged && save.gearBag.length >= cfg().salvage.tidyAt) G.queueGuide(save, 'tidy');
      }
    }
    return out;
  }

  function resumeProduction(save, now) { for (const j of Object.values(jobs(save))) j.last = now; }

  /** 某个工位当前这件还剩多久（等材料时 null） */
  function craftRemainingMs(save, key) {
    const j = jobOf(save, key || 'forge');
    return j && j.cur ? Math.max(0, j.cur.durMs - j.cur.progressMs) : null;
  }

  /** 召回某个工位的人：正在做的这件退还材料，角色回到闲置 */
  function recallProduction(save, key) {
    const j = jobOf(save, key);
    if (!j) return null;
    if (j.cur) G.refund(save, j.cur.cost);
    delete save.production.jobs[key];
    return j.charId;
  }

  /** 某个工位换部位（同一条线）：正在做的这件退还材料，按新部位重新开工 */
  function switchProduction(save, key, slot) {
    const j = jobOf(save, key);
    if (!j || lineOfSlot(slot) !== j.line || !recipe(slot)) return false;
    if (j.slot === slot) return true;
    if (j.cur) G.refund(save, j.cur.cost);
    j.slot = slot;
    j.cur = null;
    tryStartItem(save, j);
    return true;
  }

  /** 派谁去打造：闲置里打造值（这条线的三维）最高的 → 采集中最高的（采集停下）→ null */
  function pickCrafter(save, slot) {
    const stat = (P().lines[lineOfSlot(slot || 'weapon')] || {}).stat || 'str';
    const v = (c) => G.charUnit(c).base[stat];
    const pick = (list) => list.sort((a, b) => v(b) - v(a))[0];
    const idle = save.roster.filter((c) => G.status(save, c.id) === 'idle');
    if (idle.length) return pick(idle).id;
    const gat = save.roster.filter((c) => isGathering(save, c.id));
    return gat.length ? pick(gat).id : null;
  }

  /**
   * 派人去生产的办法，按默认顺序：闲置里打造值最高的 → 招募一位（3 选 1，选完直接开工；名额够、金币够招募 + 第一件）→
   * 调一个采集的人（采集停下）→ 上阵里非开局角色中等级最低的。
   */
  function craftOptions(save, slot) {
    const out = [];
    const v = (c) => G.charUnit(c).base[(P().lines[lineOfSlot(slot)] || {}).stat || 'str'];
    const idle = save.roster.filter((c) => G.status(save, c.id) === 'idle').sort((a, b) => v(b) - v(a));
    if (idle.length) out.push({ mode: 'idle', charId: idle[0].id });
    const cost = craftCost(slot);
    if (G.canRecruit(save) && cost && save.gold >= G.recruitCost(save) + (cost.gold || 0)) out.push({ mode: 'recruit', cost: G.recruitCost(save) });
    const gat = save.roster.filter((c) => isGathering(save, c.id)).sort((a, b) => v(b) - v(a));
    if (gat.length) out.push({ mode: 'gather', charId: gat[0].id });
    if (save.lineup.length > 1) {
      const l = G.lineupChars(save).map((x) => x.char).filter((c) => c.origin !== 'starter').sort((a, b) => a.level - b.level);
      if (l.length) out.push({ mode: 'lineup', charId: l[0].id });
    }
    return out;
  }

  /** 按办法派人去生产；招募的话先出 3 选 1，选完 chooseRecruit 会直接开工 */
  function doCraftPlan(save, slot, plan, now) {
    if (!plan) return null;
    if (plan.mode === 'recruit') {
      const r = G.recruit(save, now, { reason: 'craft', slot });
      return r.ok ? { recruit: r } : null;
    }
    const key = startProduction(save, slot, plan.charId, now);
    return key ? { charId: plan.charId, key } : null;
  }

  Object.assign(G, {
    lineUnlocked, matUnlocked, slotUnlocked, unlockedLines, gatherMatOf, gatherersOf, gatherSlots,
    isGathering, gatherFactor, gatherRate, totalGatherRate, tickGather, resumeGather, gatherBlock, startGather, stopGather, gatherPlan, gatherOptions,
    doGatherPlan, lines, gearSlots, lineOfSlot, slotName, workshopLevel, qualityTable, rollQuality, recipe, craftCost, jobs, jobOf, jobsOfLine,
    stationIds, freeStation, jobOfChar, isCrafting, craftDurationMs, canAfford, craftBlock, tryStartItem, startProduction, tickProduction,
    resumeProduction, craftRemainingMs, recallProduction, switchProduction, pickCrafter, craftOptions, doCraftPlan,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
