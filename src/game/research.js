/**
 * 游戏模块 · research
 * 研究（上阵位）：下一级、时长、能不能派人、开始 / 完成 / 取消研究、卡关时找谁去研究。
 * 读写字段：research。花钱走 economy。
 * 对外（挂在 DAO.Game 上）：isResearching、researchCap、researchNext、researchDurationMs、researchBlock、startResearch、tickResearch、pickResearcher、cancelResearch、researchable、slotsFirst、pickSlotResearcher
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const G = DAO.Game;
  const { clone, cfg, P } = DAO.GameUtil;

  function isResearching(save, id) { return !!(save.research.active && save.research.active.charId === id); }

  /** 现在上阵位最多能研究到几级：stageCap，或按已开放的章节放宽（chapterCaps：打到这一章时上限变成多少） */
  function researchCap(save) {
    const S = cfg().research.slots;
    let cap = S.stageCap || S.max;
    for (const [chId, c] of Object.entries(S.chapterCaps || {})) {
      const idx = cfg().chapters.findIndex((ch) => ch.id === chId);
      if (idx > 0 && G.chapterDone(save, cfg().chapters[idx - 1].id)) cap = Math.max(cap, c);
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
    const c = G.getChar(save, charId);
    if (!nx || !c) return 0;
    const int = G.charUnit(c).base.int;
    return Math.round((nx.sec * 1000) / (1 + int * cfg().research.slots.intSpeedPerPoint));
  }

  /** 能不能派这个角色去研究；返回原因（null = 可以） */
  function researchBlock(save, charId) {
    if (!save.unlocks.cave) return 'locked';
    if (save.research.active) return 'busy';
    const nx = researchNext(save);
    if (!nx) return 'max';
    const c = G.getChar(save, charId);
    if (!c) return 'nochar';
    if (G.isCrafting(save, charId)) return 'crafting';
    if (G.inLineup(save, charId) && save.lineup.length <= 1) return 'lastFighter';
    if (save.gold < nx.gold) return 'gold';
    return null;
  }

  function startResearch(save, charId, now) {
    if (researchBlock(save, charId)) return false;
    const nx = researchNext(save);
    G.spendGold(save, nx.gold);
    if (G.isGathering(save, charId)) G.stopGather(save, charId, now, { noLineup: true });
    if (G.inLineup(save, charId)) G.removeFromLineup(save, charId);
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
    G.addToLineup(save, a.charId);
    // 研究者是从采集调过来的、现在没人采集了：再引导一次派人去采集
    if (save.unlocks.forge && !save.gather.ids.length && save.guide.seen.gather) G.requeueGuide(save, 'gather');
    return { level: a.level, charId: a.charId };
  }

  /** 引导用：挑一个研究者（优先闲置里智力最高的，其次非唯一的上阵角色） */
  function pickResearcher(save) {
    const ints = (c) => G.charUnit(c).base.int;
    const idle = save.roster.filter((c) => G.status(save, c.id) === 'idle').sort((a, b) => ints(b) - ints(a));
    if (idle.length) return idle[0].id;
    if (save.lineup.length > 1) {
      const l = G.lineupChars(save).map((x) => x.char).sort((a, b) => ints(b) - ints(a));
      return l[0].id;
    }
    return null;
  }

  /** 取消研究（把研究中的人调去别处）：退还金币，研究者变为闲置 */
  function cancelResearch(save) {
    const a = save.research.active;
    if (!a) return null;
    const lv = cfg().research.slots.levels[a.level];
    G.addGold(save, lv ? lv.gold : 0);
    save.research.active = null;
    return a.charId;
  }

  /** 现在能不能研究下一个上阵位（还有级、没在研究、有人可派；不管金币够不够） */
  function researchable(save) { return !save.research.active && !!researchNext(save) && !!pickSlotResearcher(save); }

  /** 这一章卡关时先研究上阵位（还能研究的话）再补装备 */
  function slotsFirst(save, chId) { return (cfg().research.slots.stuckChapters || []).includes(chId) && researchable(save); }

  /** 卡关时研究上阵位找谁去：闲置里智力最高的，其次采集中智力最高的（采集中的人被调走，采集停下） */
  function pickSlotResearcher(save) {
    const ints = (c) => G.charUnit(c).base.int;
    const pick = (list) => list.sort((a, b) => ints(b) - ints(a))[0];
    const idle = save.roster.filter((c) => G.status(save, c.id) === 'idle');
    if (idle.length) return pick(idle).id;
    const gat = save.roster.filter((c) => G.isGathering(save, c.id));
    return gat.length ? pick(gat).id : null;
  }

  Object.assign(G, {
    isResearching, researchCap, researchNext, researchDurationMs, researchBlock, startResearch, tickResearch, pickResearcher, cancelResearch,
    researchable, slotsFirst, pickSlotResearcher,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
