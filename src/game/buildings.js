/**
 * 游戏模块 · buildings
 * 洞府建筑（阶段 4a）：矿脉 / 药园 / 灵石矿（采集工位数），锻造房 / 织坊 / 琢玉坊（制造工位数、品质概率表）。
 * 升级即时完成，花金币 + 对应原料（走 economy），每升一级花费 × costMult，上限 maxLevel。数值都在 CONFIG.game.buildings。
 * 读写字段：buildings（{ 建筑 id: 等级 }）。
 * 对外（挂在 DAO.Game 上）：buildingIds、buildingDef、buildingLevel、buildingOpen、buildingSlots、gatherBuilding、craftBuilding、
 *   upgradeCost、upgradeBlock、upgradeBuilding、nextLevelInfo
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const G = DAO.Game;
  const { clone, cfg } = DAO.GameUtil;

  const B = () => cfg().buildings;
  function buildingIds() { return Object.keys(B().list); }
  function buildingDef(id) { return B().list[id] || null; }
  function buildingLevel(save, id) { return ((save.buildings || {})[id]) || 1; }
  /** 这种原料的采集建筑 id */
  function gatherBuilding(mat) { return (cfg().gather.mats[mat] || {}).building || null; }
  /** 这条生产线的制造建筑 id */
  function craftBuilding(lineId) { return (cfg().production.lines[lineId] || {}).building || null; }
  /** 建筑开放了没有（所在原料 / 生产线开放了） */
  function buildingOpen(save, id) {
    const d = buildingDef(id);
    if (!d) return false;
    const line = d.kind === 'craft' ? d.line : cfg().gather.mats[d.mat].line;
    return G.lineUnlocked(save, line);
  }
  /** 当前等级（或 level）的工位数 */
  function buildingSlots(save, id, level) {
    const d = buildingDef(id);
    if (!d) return 0;
    const lv = level || buildingLevel(save, id);
    return d.slots[Math.min(lv, d.slots.length) - 1] || 0;
  }
  /** 从当前等级升到下一级的花费；满级 null */
  function upgradeCost(save, id) {
    const d = buildingDef(id), lv = buildingLevel(save, id);
    if (!d || lv >= B().maxLevel) return null;
    const m = Math.pow(B().costMult, lv - 1);
    const out = {};
    for (const [k, v] of Object.entries(d.cost)) out[k] = Math.round(v * m);
    return out;
  }
  /** 能不能升级（null = 可以）：locked / max / cost */
  function upgradeBlock(save, id) {
    if (!buildingDef(id)) return 'invalid';
    if (!buildingOpen(save, id)) return 'locked';
    const c = upgradeCost(save, id);
    if (!c) return 'max';
    return G.canPay(save, c) ? null : 'cost';
  }
  function upgradeBuilding(save, id) {
    if (upgradeBlock(save, id)) return false;
    G.pay(save, upgradeCost(save, id));
    save.buildings[id] = buildingLevel(save, id) + 1;
    return true;
  }
  /** 下一级的效果（界面显示用）：{ level, slots, table? } 或 null（满级） */
  function nextLevelInfo(save, id) {
    const d = buildingDef(id), lv = buildingLevel(save, id);
    if (!d || lv >= B().maxLevel) return null;
    const out = { level: lv + 1, slots: buildingSlots(save, id, lv + 1), cost: upgradeCost(save, id) };
    if (d.kind === 'craft') out.table = clone(cfg().production.qualityTables[lv + 1] || []);
    return out;
  }

  Object.assign(G, {
    buildingIds, buildingDef, buildingLevel, buildingOpen, buildingSlots, gatherBuilding, craftBuilding,
    upgradeCost, upgradeBlock, upgradeBuilding, nextLevelInfo,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
