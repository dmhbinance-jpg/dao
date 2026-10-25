/**
 * 游戏规则层的公共部分：建立 DAO.Game（各模块往上挂公开函数），以及几个无状态的小工具（DAO.GameUtil）。
 * 游戏规则层（src/game/*.js）：纯逻辑，不碰 DOM，浏览器和 Node 共用。所有随机走 DAO.RNG；涉及时间的函数都显式接收 now（毫秒时间戳）。
 * 模块列表、职责、依赖方向见 docs/ARCHITECTURE.md。加载顺序：common.js 最先，其余模块之间只在调用时通过 DAO.Game 互相找，不依赖加载顺序。
 * 对外：DAO.Game.dayKey；DAO.GameUtil = { clone, cfg, P }。不读写存档。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});
  const G = (DAO.Game = DAO.Game || {});

  const clone = (o) => JSON.parse(JSON.stringify(o));
  /** 游戏配置 DAO.CONFIG.game（每次现取：配置网站 / tuning 合并后的值） */
  const cfg = () => DAO.CONFIG.game;
  /** 生产线配置 DAO.CONFIG.game.production */
  const P = () => cfg().production;

  /** 本地日期键（次日重置用） */
  function dayKey(now) {
    const d = new Date(now);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  DAO.GameUtil = { clone, cfg, P };
  G.dayKey = dayKey;
})(typeof globalThis !== 'undefined' ? globalThis : this);
