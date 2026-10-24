/**
 * UI 状态：两队阵容（每个角色带一份可编辑的完整覆盖），本地存档带版本号。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});
  const UI = DAO.UI;
  const SAVE_VERSION = 1;

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function entryFor(charId, row) {
    const tpl = DAO.CONFIG.characters[charId];
    return { charId, row: row || tpl.row || 'front', override: clone(tpl) };
  }

  function defaultLineups() {
    const T = DAO.CONFIG.defaultTeams;
    return {
      A: T.A.map((e) => entryFor(e.charId, e.row)),
      B: T.B.map((e) => entryFor(e.charId, e.row)),
    };
  }

  const saved = UI.store.get('state', null);
  UI.state = {
    lineups: saved && saved.v === SAVE_VERSION ? saved.lineups : defaultLineups(),
    selected: { side: 'A', index: 0 },
    seed: (saved && saved.seed) || 1,
    runs: (saved && saved.runs) || 300,
  };

  UI.entryFor = entryFor;
  UI.resetLineups = function () {
    UI.state.lineups = defaultLineups();
    UI.save();
  };
  UI.save = function () {
    UI.store.set('state', { v: SAVE_VERSION, lineups: UI.state.lineups, seed: UI.state.seed, runs: UI.state.runs });
  };

  /** 有效阵容（去掉配置表里已不存在的角色） */
  UI.lineup = function (side) {
    return UI.state.lineups[side].filter((e) => DAO.CONFIG.characters[e.charId]);
  };

  // 简单的发布/订阅，阵容变化时通知各页
  const subs = [];
  UI.onChange = (fn) => subs.push(fn);
  UI.changed = function () {
    UI.save();
    subs.forEach((f) => f());
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
