/**
 * V0 模拟器的战斗播放页：用当前两队阵容和种子跑一场，交给通用回放组件播放。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});
  const UI = DAO.UI;
  const h = UI.h;

  let view = null;

  function start() {
    const A = UI.lineup('A'), B = UI.lineup('B');
    const errs = DAO.Model.validateLineup(A).concat(DAO.Model.validateLineup(B));
    if (errs.length) { view.setStatus('阵容不合法：' + errs.join('；')); return; }
    const battle = new DAO.Battle(A, B, { seed: UI.state.seed, record: true });
    view.play(battle.run(), battle.units);
  }

  function mount(el) {
    const seedInput = h('input', { type: 'number', value: UI.state.seed, min: 1, style: { width: '6em' }, onchange: (e) => { UI.state.seed = Number(e.target.value) || 1; UI.save(); } });
    view = UI.createBattleView(el, {
      controls: [
        h('label', null, '种子 ', seedInput),
        h('button', { class: 'primary', onclick: start }, '开战'),
        h('button', { onclick: () => { UI.state.seed = (Number(seedInput.value) || 1) + 1; seedInput.value = UI.state.seed; UI.save(); start(); } }, '下一种子'),
      ],
    });
  }

  UI.Player = {
    mount,
    start: () => start(),
    stop: () => view && view.stop(),
    hasResult: () => !!view && view.hasResult(),
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
