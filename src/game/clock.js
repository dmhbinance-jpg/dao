/**
 * 游戏时钟：游戏时间 = 累加的「真实流逝 × 时间倍率」（CONFIG.debug.timeScale）。
 * 研究倒计时、采集、挂机、战斗播放都从这里取 now，倍率只改时间流速，不改战斗结果。
 * 每次读取只累加两次读取之间的真实流逝，所以运行中不会出现时间跳变；真实时钟倒退时不倒退。
 * 纯逻辑，不碰 DOM。
 *
 *   const clock = DAO.GameClock.create({ scale, realNow, saved })
 *     saved = 存档里的 { game, real }：从上次保存的游戏时间继续；页面关闭期间的真实流逝也按倍率计入
 *            （研究离线照样走；采集离线不算由 resumeGather 保证）。没有 saved 时游戏时间从当前真实时间起步。
 *   clock.now()            当前游戏时间（毫秒）
 *   clock.realMs(gameMs)   一段游戏时长对应的真实毫秒（定时器用）
 *   clock.save()           → { game, real }，写进存档
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  function create(opts) {
    opts = opts || {};
    const realNow = opts.realNow || (() => Date.now());
    const scale = opts.scale > 0 ? opts.scale : 1;
    let lastReal = realNow();
    let game;
    if (opts.saved && isFinite(opts.saved.game) && isFinite(opts.saved.real)) game = opts.saved.game + Math.max(0, lastReal - opts.saved.real) * scale;
    else game = lastReal;
    return {
      scale,
      now() {
        const r = realNow();
        if (r > lastReal) { game += (r - lastReal) * scale; lastReal = r; }
        return game;
      },
      realMs(gameMs) { return gameMs / scale; },
      save() { const g = this.now(); return { game: g, real: lastReal }; },
    };
  }

  DAO.GameClock = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
