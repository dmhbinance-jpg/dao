/**
 * 游戏模块 · economy
 * 钱包：金币和三种原料（灵矿 ore、灵草 herb、灵石 stone）的增减。别的模块花钱 / 进账都调这里，不直接改这些字段。
 * 花费 / 收入写成 { gold?, ore?, herb?, stone? }，canPay / pay / refund 按里面出现的键处理。
 * 读写字段：gold、ore、herb、stone。
 * 对外（挂在 DAO.Game 上）：MATS、matName、matAmount、addGold、spendGold、addOre、addMat、canPay、pay、refund
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const G = DAO.Game;
  const { cfg } = DAO.GameUtil;

  /** 原料 id（顺序 = 显示顺序） */
  const MATS = ['ore', 'herb', 'stone'];
  const WALLET = ['gold'].concat(MATS);

  function matName(mat) { return mat === 'gold' ? '金币' : ((cfg().gather.mats || {})[mat] || {}).name || mat; }
  /** 现有数量（金币或某种原料） */
  function matAmount(save, key) { return save[key] || 0; }

  /** 进账金币（战斗、退款、出售） */
  function addGold(save, n) { save.gold += n; }
  /** 花金币（调用方先判断够不够） */
  function spendGold(save, n) { save.gold -= n; }
  /** 进账灵矿（兼容旧调用） */
  function addOre(save, n) { save.ore += n; }
  /** 进账某种原料（采集、分解） */
  function addMat(save, mat, n) {
    if (!MATS.includes(mat)) throw new Error('未知原料: ' + mat);
    save[mat] = (save[mat] || 0) + n;
  }
  /** cost = { gold?, ore?, herb?, stone? } 够不够付 */
  function canPay(save, cost) {
    for (const k of Object.keys(cost)) { if (!WALLET.includes(k)) return false; if ((save[k] || 0) < cost[k]) return false; }
    return true;
  }
  /** 付 cost（调用方先判断够不够） */
  function pay(save, cost) { for (const k of Object.keys(cost)) if (WALLET.includes(k)) save[k] = (save[k] || 0) - cost[k]; }
  /** 退还 / 进账 cost（打造退还、分解返还） */
  function refund(save, cost) { for (const k of Object.keys(cost)) if (WALLET.includes(k)) save[k] = (save[k] || 0) + cost[k]; }

  Object.assign(G, { MATS, matName, matAmount, addGold, spendGold, addOre, addMat, canPay, pay, refund });
})(typeof globalThis !== 'undefined' ? globalThis : this);
