/**
 * 配置表页：整张 DAO.CONFIG 以 JSON 显示，可直接改、应用、导出、恢复。
 * 本文件要在 state.js 之前加载：启动时先把本机保存的配置覆盖上去。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});
  const UI = DAO.UI;
  const h = UI.h;

  DAO.CONFIG_DEFAULT = JSON.parse(JSON.stringify(DAO.CONFIG));

  function replaceConfig(obj) {
    for (const k of Object.keys(DAO.CONFIG)) delete DAO.CONFIG[k];
    Object.assign(DAO.CONFIG, obj);
  }

  // 启动时应用本机保存的配置
  const saved = UI.store.get('config', null);
  if (saved) {
    try { replaceConfig(saved); UI.configOverridden = true; } catch (e) { UI.store.del('config'); }
  }

  let rootEl, ta, msg;
  function build() {
    UI.clear(rootEl);
    ta = h('textarea', { class: 'config-text', spellcheck: 'false' });
    ta.value = JSON.stringify(DAO.CONFIG, null, 2);
    msg = h('span', { class: 'status' }, UI.configOverridden ? '当前使用本机保存的配置' : '当前为代码里的默认配置');
    rootEl.appendChild(h('div', { class: 'toolbar' },
      h('button', { class: 'primary', onclick: apply }, '应用并保存'),
      h('button', { onclick: copyJson }, '复制 JSON'),
      h('button', { onclick: reset }, '恢复默认'),
      msg));
    rootEl.appendChild(h('p', { class: 'muted' }, '所有数值（系数、技能、技能卡、天赋、角色、默认阵容）都在这一张表里。改完点应用，阵容编辑和模拟立即使用新值。要永久改动，把复制出的内容合并回 src/config/*.js。'));
    rootEl.appendChild(ta);
  }

  function apply() {
    try {
      const obj = JSON.parse(ta.value);
      replaceConfig(obj);
      UI.store.set('config', obj);
      UI.configOverridden = true;
      msg.textContent = '已应用 ✓';
      UI.changed();
    } catch (e) {
      msg.textContent = 'JSON 解析失败：' + e.message;
    }
  }

  function reset() {
    UI.store.del('config');
    replaceConfig(JSON.parse(JSON.stringify(DAO.CONFIG_DEFAULT)));
    UI.configOverridden = false;
    ta.value = JSON.stringify(DAO.CONFIG, null, 2);
    msg.textContent = '已恢复默认';
    UI.changed();
  }

  function copyJson() {
    const text = JSON.stringify(DAO.CONFIG, null, 2);
    const fallback = () => { ta.focus(); ta.select(); msg.textContent = '已全选，按 Ctrl/⌘+C 复制'; };
    try {
      navigator.clipboard.writeText(text).then(() => { msg.textContent = '已复制到剪贴板 ✓'; }, fallback);
    } catch (e) { fallback(); }
  }

  UI.ConfigView = {
    mount(el) { rootEl = el; build(); UI.onChange(() => { if (document.activeElement !== ta) ta.value = JSON.stringify(DAO.CONFIG, null, 2); }); },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
