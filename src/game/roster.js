/**
 * 游戏模块 · roster
 * 角色与阵容：角色查询和属性、经验升级、上阵位 / 上阵 / 布阵、角色状态（研究 > 打造 > 采集 > 上阵 > 闲置）、名额、加入和遣散角色。
 * 读写字段：roster（角色对象，含等级、经验、装备槽、卡槽的容器）、lineup、nextId、quota。读：research.slots（上阵位数量）。
 * 对外（挂在 DAO.Game 上）：getChar、starter、maxLevel、qualityName、charDef、charUnit、aptitude、expToNext、addExp、slots、inLineup、status、lineupChars、defaultRow、applyDefaultRows、canAddToLineup、addToLineup、fixRowOverflow、removeFromLineup、setRow、swapRows、showFormation、rosterCap、canDismiss、dismiss
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const G = DAO.Game;
  const { clone, cfg, P } = DAO.GameUtil;

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
      gear: G.gearBonus(c.equip),
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

  function expToNext(level) {
    const e = cfg().exp;
    return Math.round(e.base * Math.pow(level, e.power));
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

  function slots(save) { return save.research.slots; }

  function inLineup(save, id) { return save.lineup.some((e) => e.id === id); }

  function status(save, id) {
    if (G.isResearching(save, id)) return 'research';
    if (G.isCrafting(save, id)) return 'craft';
    if (G.isGathering(save, id)) return 'gather';
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
      G.queueGuide(save, 'formation');
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

  /** 名额：总人数上限（和上阵位无关）。扩建名额的研究预留在 save.quota.extra。 */
  function rosterCap(save) { return cfg().roster.cap + ((save.quota && save.quota.extra) || 0); }

  function canDismiss(save, id) {
    const c = getChar(save, id);
    if (!c || G.isResearching(save, id)) return false;
    if (inLineup(save, id) && save.lineup.length <= 1) return false;
    return save.roster.length > 1;
  }

  function dismiss(save, id, now) {
    if (!canDismiss(save, id)) return false;
    if (G.isGathering(save, id)) G.stopGather(save, id, now, { noLineup: true });
    { const j = G.jobOfChar(save, id); if (j) G.recallProduction(save, j.key); }   // 生产中：召回，退还当前这件的材料
    G.returnGear(save, getChar(save, id));   // 身上的装备回背包
    save.roster = save.roster.filter((c) => c.id !== id);
    save.lineup = save.lineup.filter((e) => e.id !== id);
    return true;
  }

  /** 给新角色分配编号（c2、c3……） */
  function newCharId(save) {
    const id = 'c' + save.nextId;
    save.nextId++;
    return id;
  }
  /** 新角色加入名单（名额由调用方先判断） */
  function addChar(save, c) { save.roster.push(c); }

  Object.assign(G, {
    newCharId, addChar, getChar, starter, maxLevel, qualityName, charDef, charUnit, aptitude, expToNext, addExp, slots, inLineup, status, lineupChars, defaultRow,
    applyDefaultRows, canAddToLineup, addToLineup, fixRowOverflow, removeFromLineup, setRow, swapRows, showFormation, rosterCap, canDismiss, dismiss,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
