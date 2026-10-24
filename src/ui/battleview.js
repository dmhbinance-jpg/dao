/**
 * 战斗回放组件：工具条（1× / 2× / 4× / 暂停 / 跳过）+ 回放驱动（battle/replay.js）+ 渲染器。
 * V0 模拟器和游戏共用。只读 Battle.run() 产出的时间线，不碰战斗逻辑；速度和跳过只影响播放。
 *
 *   const view = UI.createBattleView(container, { controls: [...额外按钮], sideNames: {A,B}, onEnd(timeline), renderer? })
 *   view.play(result.timeline)   // record=true 跑出来的时间线（也接受整个 result）
 * opts.renderer(els, opts) 可以换成别的渲染器工厂（默认 UI.createTextRenderer）。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});
  const UI = DAO.UI;
  const h = UI.h;

  UI.createBattleView = function (container, opts) {
    opts = opts || {};
    const store = opts.store || UI.store;
    const makeRenderer = opts.renderer || UI.createTextRenderer;
    const speedBtns = {};
    let replay = null, tl = null;
    let speed = store.get('speed', 1);
    let pauseBtn, statusEl;

    // ---------- 骨架 ----------
    UI.clear(container);
    pauseBtn = h('button', { onclick: togglePause }, '暂停');
    container.appendChild(h('div', { class: 'toolbar' },
      opts.controls || null,
      opts.controls ? h('span', { class: 'sep' }) : null,
      [1, 2, 4].map((s) => (speedBtns[s] = h('button', { class: 'speed', onclick: () => setSpeed(s) }, s + '×'))),
      pauseBtn,
      h('button', { onclick: skip }, '跳过'),
      (statusEl = h('span', { class: 'status' }))));
    const els = { bar: h('div', { class: 'actionbar' }), order: h('div', { class: 'order' }), field: h('div', { class: 'field-grid' }), log: h('div', { class: 'log' }), status: statusEl };
    container.appendChild(h('div', { class: 'card bar-card' }, h('div', { class: 'bar-head' }, h('b', null, '行动条'), els.order), els.bar));
    container.appendChild(h('div', { class: 'player-grid' },
      h('div', { class: 'card' }, els.field),
      h('div', { class: 'card log-card' }, h('b', null, '战斗日志'), els.log)));
    setSpeed(speed);

    function setSpeed(s) {
      speed = s;
      store.set('speed', s);
      for (const k in speedBtns) speedBtns[k].classList.toggle('on', Number(k) === s);
      if (replay) replay.setSpeed(s);
    }

    function play(x) {
      stop();
      tl = x.timeline || x;
      if (!tl || !tl.events) throw new Error('回放需要 record=true 跑出来的时间线');
      const renderer = makeRenderer(els, { sideNames: opts.sideNames });
      replay = DAO.Replay.create(tl, renderer, { speed, onEnd: (t) => { pauseBtn.textContent = '暂停'; if (opts.onEnd) opts.onEnd(t); } });
      pauseBtn.textContent = '暂停';
      replay.play();
    }
    function stop() { if (replay) replay.stop(); }
    function togglePause() {
      if (!replay || replay.state().ended) return;
      if (replay.state().playing) { replay.pause(); pauseBtn.textContent = '继续'; }
      else { replay.resume(); pauseBtn.textContent = '暂停'; }
    }
    function skip() { if (replay) replay.skip(); }

    return {
      play, stop, skip,
      isPlaying: () => !!replay && replay.state().playing,
      hasResult: () => !!tl,
      isEnded: () => !!replay && replay.state().ended,
      setStatus: (t) => { statusEl.textContent = t; },
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
