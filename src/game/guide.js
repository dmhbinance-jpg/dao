/**
 * 游戏模块 · guide
 * 引导链：排队、当前该弹哪个、能不能执行、确认后执行对应动作（动作本身调各模块的公开函数）。
 * 读写字段：guide。
 * 引导一览：cave → research → formation → gather → forge → equipFirst → firstCard …；卡关时 gearUp:关卡 / moreSlots（可重复）；
 *   装备背包攒多了时 tidy（整理装备，可重复）；第三段通关后 gather2（派人采灵草 / 灵石）→ craft2（新部位开工）→ equip2（穿上新部位）。
 * 对外（挂在 DAO.Game 上）：retireGuide、requeueGuide、queueGuide、currentGuide、guideBlock、ackGuide
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const G = DAO.Game;
  const { clone, cfg, P } = DAO.GameUtil;

  /** 引导已经做完 / 不需要了：从队列里拿掉并记为看过（卡关补装备的引导在这关打过后用） */
  function retireGuide(save, id) {
    if (save.guide.queue.includes(id)) { save.guide.queue = save.guide.queue.filter((x) => x !== id); save.guide.seen[id] = true; }
  }
  /** 看过的引导重新排队（例如研究者从采集调走后没人采集了，再引导一次） */
  function requeueGuide(save, id) {
    delete save.guide.seen[id];
    queueGuide(save, id);
  }
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
      return save.gather.ids.length || G.gatherPlan(save, guideNow) ? null : 'nochar';
    }
    if (id === 'gather2') {
      const need = ['herb', 'stone'].filter((m) => G.matUnlocked(save, m) && !G.gatherersOf(save, m).length);
      if (!need.length) return null;   // 已经有人在采：确认后直接关掉
      if (save.recruitChoice || save.pendingRecruit) return 'choosing';
      return need.some((m) => G.gatherPlan(save, guideNow, m)) ? null : 'nochar';
    }
    if (id === 'craft2') {
      const todo = newLinesTodo(save);
      if (!todo.length) return null;   // 都有人在做 / 都有装备了：确认后直接关掉
      if (save.recruitChoice || save.pendingRecruit) return 'choosing';
      if (!todo.some((l) => G.canAfford(save, l.slots[0]))) return 'ore';
      return todo.some((l) => !G.craftBlock(save, l.slots[0]) && G.craftOptions(save, l.slots[0]).length) ? null : 'nochar';
    }
    if (id === 'equip2') {
      if (!newLinesEquipPlan(save).length) return G.unlockedLines(save).some((l) => l.unlockChapter && G.jobsOfLine(save, l.id).length) ? 'wait' : null;
      return null;
    }
    if (id === 'tidy') return null;
    if (id === 'moreSlots') {
      if (save.research.active || !G.researchNext(save)) return null;   // 已经在研究 / 研究满了：确认后直接关掉
      const rid = G.pickSlotResearcher(save);
      return rid ? G.researchBlock(save, rid) : 'nochar';
    }
    if (id.startsWith('gearUp:')) {
      const ch = G.chapterOf(id.slice(7));
      if (ch && G.slotsFirst(save, ch.id)) return 'research';
      const u = G.nextUpgrade(save);
      return u && u.affordable ? null : 'ore';
    }
    if (id === 'forge') {
      if (G.gearAll(save).length || G.jobsOfLine(save, 'forge').length) return null;   // 已经有装备 / 已经有人在做：确认后直接关掉
      if (save.recruitChoice || save.pendingRecruit) return 'choosing';
      const slot = cfg().forge.guideSlot;
      if (!G.canAfford(save, slot)) return 'ore';
      const blk = G.craftBlock(save, slot);
      if (blk) return blk;
      return G.craftOptions(save, slot).length ? null : 'nochar';
    }
    if (id === 'research') {
      if (save.research.active || save.research.slots >= 2) return null;
      const rid = G.pickResearcher(save);
      if (!rid) return 'nochar';
      return G.researchBlock(save, rid);
    }
    return null;
  }

  /** 确认引导，执行它代表的动作 */
  let guideNow = Date.now();

  /** 第三段通关开放的生产线里，还没人在做、也还没有这条线装备的（「开始打造新部位」引导要处理的） */
  function newLinesTodo(save) {
    return G.unlockedLines(save).filter((l) => l.unlockChapter && !G.jobsOfLine(save, l.id).length &&
      !G.gearAll(save).some((g) => l.slots.includes(g.slot)));
  }
  /** 新开放的线做出来的装备里，能穿给上阵角色的 */
  function newLinesEquipPlan(save) {
    const newSlots = G.unlockedLines(save).filter((l) => l.unlockChapter).reduce((a, l) => a.concat(l.slots), []);
    return save.gearBag.filter((it) => newSlots.includes(it.slot) && G.bestWearer(save, it));
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
      if (!save.recruit.freeUsed && !save.recruitChoice) info.recruit = G.recruit(save, now);
      queueGuide(save, 'research');
    } else if (id === 'research') {
      if (!save.research.active && save.research.slots < 2) {
        const rid = G.pickResearcher(save);
        G.startResearch(save, rid, now);
        info.researcher = rid;
      }
    } else if (id === 'formation') {
      G.applyDefaultRows(save);
    } else if (id === 'firstCard') {
      const cid = cfg().cards.firstCard[G.starter(save).role];
      const target = save.roster.find((c) => c.origin === 'starter' && G.canUseCard(c, cid) && !c.card) ||
        save.roster.find((c) => G.canUseCard(c, cid) && !c.card);
      if (target && (save.bag[cid] || 0) > 0) info.insert = G.insertCard(save, target.id, cid);
    } else if (id === 'gather') {
      if (!save.gather.ids.length) {
        const r = G.doGatherPlan(save, opts.plan || G.gatherPlan(save, now), now);
        if (!r) return { ok: false, error: 'nochar' };
        Object.assign(info, r);
      }
      queueGuide(save, 'forge');
    } else if (id === 'gather2') {
      // 派人采集灵草和灵石（各一人；招募的话只能招一次，另一种原料从闲人里派）
      info.gathered = [];
      for (const mat of ['herb', 'stone']) {
        if (!G.matUnlocked(save, mat) || G.gatherersOf(save, mat).length) continue;
        const plans = G.gatherOptions(save, now, mat).filter((p) => p.mode !== 'recruit' || !save.recruitChoice);
        const pl = (opts.plans && opts.plans[mat]) || plans[0];
        const r = pl && G.doGatherPlan(save, pl, now);
        if (r) info.gathered.push(Object.assign({ mat }, r));
      }
      const stillNeed = ['herb', 'stone'].some((m) => G.matUnlocked(save, m) && !G.gatherersOf(save, m).length);
      if (!info.gathered.length && stillNeed) return { ok: false, error: 'nochar' };
      queueGuide(save, 'craft2');
    } else if (id === 'craft2') {
      // 新开放的线各派一个人去持续打造第一个部位（护手 / 项链）
      info.started = [];
      for (const l of newLinesTodo(save)) {
        const slot = l.slots[0];
        if (G.craftBlock(save, slot) || !G.canAfford(save, slot)) continue;
        const plans = G.craftOptions(save, slot).filter((p) => p.mode !== 'recruit' || !save.recruitChoice);
        const r = plans.length && G.doCraftPlan(save, slot, plans[0], now);
        if (r) info.started.push(Object.assign({ line: l.id, slot }, r));
      }
      if (!info.started.length && newLinesTodo(save).length) return { ok: false, error: 'nochar' };
      queueGuide(save, 'equip2');
    } else if (id === 'equip2') {
      // 新部位的装备穿给最需要的上阵角色
      info.equipped = [];
      for (const it of newLinesEquipPlan(save)) { const w = G.bestWearer(save, it); if (w && G.equip(save, w, it.id)) info.equipped.push({ gearId: it.id, charId: w, item: it }); }
    } else if (id === 'tidy') {
      info.upgrades = G.doAllUpgrades(save, now);
    } else if (id.startsWith('gearUp:')) {
      info.upgrades = G.doAllUpgrades(save, now);
    } else if (id === 'moreSlots') {
      if (!save.research.active && G.researchNext(save)) {
        const rid = G.pickSlotResearcher(save);
        if (rid && G.startResearch(save, rid, now)) info.researcher = rid;
      }
    } else if (id === 'forge') {
      if (!G.gearAll(save).length && !G.jobsOfLine(save, 'forge').length) {
        const slot = cfg().forge.guideSlot;
        const r = G.doCraftPlan(save, slot, opts.plan || G.craftOptions(save, slot)[0], now);
        if (!r) return { ok: false, error: 'nochar' };
        Object.assign(info, r, { slot });
      }
    } else if (id === 'equipFirst') {
      const pl = G.firstEquipPlan(save);
      if (pl && G.equip(save, pl.charId, pl.gearId)) info.equipped = Object.assign({ item: G.findGear(save, pl.gearId).item }, pl);
    }
    save.guide.queue = save.guide.queue.filter((x) => x !== id);
    // 新生产线的引导：还有原料没人采 / 新线没人做时留在队列里，有闲人、材料够了再弹（被挡住时不会打断自动推关）
    if (id === 'gather2' && ['herb', 'stone'].some((m) => G.matUnlocked(save, m) && !G.gatherersOf(save, m).length)) { save.guide.queue.push(id); return info; }
    if (id === 'craft2' && newLinesTodo(save).length) { save.guide.queue.push(id); return info; }
    if (id.startsWith('gearUp:')) {
      // 卡关补装备的引导可以反复出现：这关还没过，就留在队列里，下次灵矿和金币够了再弹
      if (!G.isCleared(save, id.slice(7))) save.guide.queue.push(id);
    } else if (id !== 'moreSlots' && id !== 'tidy') save.guide.seen[id] = true;   // tidy 可以反复出现   // moreSlots 也可以再出现（下一级上阵位）
    return info;
  }

  Object.assign(G, {
    retireGuide, requeueGuide, queueGuide, currentGuide, guideBlock, ackGuide,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
