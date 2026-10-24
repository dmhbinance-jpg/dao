/**
 * 事件系统。
 * 五个事件：开场 battleStart、回合开始 roundStart、出手时 act、暴击时 crit、击杀时 kill、受击时 hit。
 * 天赋、橙卡特效、橙装特效都挂在这里。
 *
 * 防无限循环（文档第 4 节「有界规则」）：
 *  - 触发不可递归：处理某个触发的效果期间，再发出的事件只记日志、不再触发别的 handler
 *  - 每条触发每回合有次数上限（handler 自己带 maxPerRound，由 bus 计数）
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  DAO.EVENTS = {
    BATTLE_START: 'battleStart',
    ROUND_START: 'roundStart',
    ACT: 'act',        // 单位出手时（选定技能后、结算前）
    CRIT: 'crit',      // 单位打出暴击时
    KILL: 'kill',      // 单位击杀时
    HIT: 'hit',        // 单位受击时
    AFTER_ACT: 'afterAct', // 内部用：行动结算完成
  };

  class EventBus {
    constructor() {
      this.handlers = {};   // event -> [handler]
      this.depth = 0;       // >0 表示正在处理触发效果
      this.round = 0;
      this.suppressed = 0;  // 被递归保护拦下的次数（用于统计）
    }

    /**
     * @param {string} event
     * @param {object} h  { id, owner, fn(ctx, bus), maxPerRound, filter(ctx) }
     */
    on(event, h) {
      (this.handlers[event] = this.handlers[event] || []).push(
        Object.assign({ maxPerRound: Infinity, usedThisRound: 0, totalFired: 0 }, h)
      );
      return h;
    }

    off(event, id) {
      const list = this.handlers[event];
      if (!list) return;
      this.handlers[event] = list.filter((h) => h.id !== id);
    }

    /** 回合开始时重置每回合计数 */
    newRound(round) {
      this.round = round;
      for (const ev in this.handlers) for (const h of this.handlers[ev]) h.usedThisRound = 0;
    }

    /**
     * 发出事件。返回被触发的 handler 列表（用于日志里的触发链）。
     * 递归保护：depth>0 时不执行 handler。
     */
    emit(event, ctx) {
      const list = this.handlers[event];
      const fired = [];
      if (!list || !list.length) return fired;
      if (this.depth > 0 && !DAO.CONFIG.trigger.allowRecursion) {
        this.suppressed++;
        return fired;
      }
      // 复制一份，handler 执行中可能注销
      for (const h of list.slice()) {
        if (h.owner && h.owner.alive === false && !h.allowDead) continue;
        if (h.usedThisRound >= h.maxPerRound) continue;
        if (h.filter && !h.filter(ctx)) continue;
        this.depth++;
        let result;
        try {
          result = h.fn(ctx, this);
        } finally {
          this.depth--;
        }
        if (result !== false) {
          h.usedThisRound++;
          h.totalFired++;
          fired.push({ handler: h, result });
        }
      }
      return fired;
    }
  }

  DAO.EventBus = EventBus;
})(typeof globalThis !== 'undefined' ? globalThis : this);
