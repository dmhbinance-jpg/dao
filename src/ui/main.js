/**
 * UI 入口：标签页切换与各页挂载。
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const UI = DAO.UI;

  function boot() {
    const tabs = document.querySelectorAll('[data-tab]');
    const show = (name) => {
      tabs.forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
      document.querySelectorAll('.page').forEach((p) => (p.hidden = p.id !== 'page-' + name));
      UI.store.set('tab', name);
      if (name !== 'player') UI.Player.stop();
      else if (!UI.Player.hasResult()) UI.Player.start();
    };
    tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));

    UI.Editor.mount(document.getElementById('page-editor'));
    UI.Player.mount(document.getElementById('page-player'));
    UI.Batch.mount(document.getElementById('page-batch'));
    UI.ConfigView.mount(document.getElementById('page-config'));
    const first = UI.store.get('tab', 'player');
    show(first);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
