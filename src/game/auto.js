/**
 * 游戏模块 · auto
 * 自动推关：下一步做什么（挑战 / 挂机 / 停下等确认）、首领确认、开关。
 * 读写字段：auto。
 * 对外（挂在 DAO.Game 上）：autoDecide、confirmBoss
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const G = DAO.Game;
  const { clone, cfg, P } = DAO.GameUtil;

  /**
   * 自动推关的下一步：
   *  - 胜利后自动进入下一关
   *  - 在最新关战败，退回最高已通关的关卡挂机
   *  - 上阵角色每升一级（或阵容变化），再挑战一次最新关
   *  - 首领关第一次、新系统开放的引导：停下来等确认
   * @returns { type: 'challenge'|'idle'|'wait', stageId?, reason? }
   */
  function autoDecide(save) {
    const A = cfg().auto;
    if (save.recruitChoice) return { type: 'wait', reason: 'recruitChoice' };
    if (save.pendingRecruit) return { type: 'wait', reason: 'recruitDecision' };
    const g = G.currentGuide(save);
    if (g && A.stopAtGuides && !G.guideBlock(save, g)) return { type: 'wait', reason: 'guide', guide: g };
    if (save.bagNew && save.settings.cardPrompts && G.cardActions(save).any) return { type: 'wait', reason: 'cards' };
    const frontier = G.nextStage(save);
    const best = G.bestClearedStage(save);
    if (!frontier) return best ? { type: 'idle', stageId: best.id } : { type: 'wait', reason: 'none' };
    const la = save.auto.lastAttempt;
    const attempted = la && la.stageId === frontier.id && la.sig === G.lineupSig(save);
    if (!attempted || !best) {
      if (frontier.boss && A.stopBeforeBoss && !save.auto.confirmed[frontier.id]) return { type: 'wait', reason: 'boss', stageId: frontier.id };
      return { type: 'challenge', stageId: frontier.id };
    }
    return { type: 'idle', stageId: best.id };
  }

  function confirmBoss(save, stageId) { save.auto.confirmed[stageId] = true; }

  /** 打开 / 关闭自动推关 */
  function setAuto(save, on) { save.auto.on = on; }
  /** 手动挂机的关卡（null = 停止挂机） */
  function setIdle(save, stageId) { save.idle = stageId === null ? null : { stageId }; }
  /** 记下在最新关的这次尝试（阵容签名不变就不再挑战，退回挂机） */
  function noteAttempt(save, stageId, sig) { save.auto.lastAttempt = { stageId, sig }; }

  Object.assign(G, {
    autoDecide, confirmBoss, setAuto, setIdle, noteAttempt,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
