/**
 * 配置网站 · 调参页：列出 DAO.CONFIG 全部项（默认值来自页面加载的默认配置），当前值来自本地服务的 /api/tuning。
 * 编辑 → 校验 → 保存（PUT /api/tuning，服务端再校验一遍）→ 写回 src/config/tuning.js（只放改过的项）。
 */
(function () {
  'use strict';
  const DAO = window.DAO;
  const T = DAO.Tuning, R = DAO.ConfigRules, h = DAO.UI.h;
  const DEFAULTS = JSON.parse(JSON.stringify(DAO.CONFIG));
  const ITEMS = T.flatten(DEFAULTS).map((x) => Object.assign(x, { group: R.group(x.path), label: R.label(x.path) }));
  const BY_PATH = Object.fromEntries(ITEMS.map((x) => [x.path, x]));
  const PINNED = R.PINNED.map(([p]) => p).filter((p) => BY_PATH[p]);
  let saved = {};      // 服务端当前的 tuning
  let draft = {};      // 编辑中的 tuning（path → 值，只放和默认不同的）
  let errors = {};     // path → 错误
  let query = '', onlyChanged = false;
  const SHOW_LIMIT = 80;   // 每组默认最多显示多少行（搜索时不限）
  const expanded = {};

  const $ = (id) => document.getElementById(id);
  const fmt = (v) => (v === null ? 'null（占位）' : typeof v === 'string' ? JSON.stringify(v) : String(v));
  const cur = (p) => (p in draft ? draft[p] : BY_PATH[p].value);
  const changed = (p) => p in draft;
  const dirty = () => JSON.stringify(sortObj(draft)) !== JSON.stringify(sortObj(saved));
  function sortObj(o) { return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])); }

  function toast(text, kind) {
    const el = h('div', { class: 'toast ' + (kind || '') }, text);
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  async function load() {
    try {
      const r = await fetch('/api/tuning', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      saved = j.tuning || {};
      draft = Object.assign({}, saved);
      errors = {};
      for (const e of j.errors || []) errors[e.path] = e.reason;
      setStatus(Object.keys(saved).length ? `tuning.js 现有 ${Object.keys(saved).length} 项改动` : 'tuning.js 没有改动（全是默认值）');
    } catch (e) {
      setStatus('读不到 /api/tuning：请用 node tools/server.js 启动后从 http://localhost:端口/tools/ 打开', true);
    }
    render();
  }
  function setStatus(t, bad) { const s = $('status'); s.textContent = t; s.className = bad ? 'bad' : 'muted'; }

  /** 输入框的值 → 配置值（按默认值的类型） */
  function parseInput(def, raw, checked) {
    if (typeof def === 'boolean') return !!checked;
    if (typeof def === 'number') { if (raw.trim() === '') return NaN; return Number(raw); }
    if (def === null) return raw.trim() === '' ? null : raw;
    return raw;
  }
  function edit(p, v) {
    const it = BY_PATH[p];
    const err = typeof v === 'number' && isNaN(v) ? '请输入数字' : R.validate(p, v, it.value, DEFAULTS);
    if (err) errors[p] = err; else delete errors[p];
    if (!err) { if (v === it.value) delete draft[p]; else draft[p] = v; }
    updateBar();
  }
  function resetOne(p) { delete draft[p]; delete errors[p]; render(); }

  function updateBar() {
    const nErr = Object.keys(errors).length;
    const save = $('save');
    save.disabled = !!nErr || !dirty();
    save.textContent = nErr ? `有 ${nErr} 处错误` : dirty() ? `保存（${Object.keys(draft).length} 项改动）` : '已保存';
    $('reset-all').disabled = !Object.keys(draft).length && !Object.keys(saved).length;
  }

  function row(it) {
    const p = it.path, d = it.value, v = cur(p);
    let input;
    if (typeof d === 'boolean') input = h('input', { type: 'checkbox', checked: !!v, onchange: (e) => { edit(p, e.target.checked); paintRow(el, p); } });
    else input = h('input', { type: typeof d === 'number' ? 'number' : 'text', step: 'any', value: v === null ? '' : String(v), placeholder: d === null ? '占位（null）' : '',
      oninput: (e) => { edit(p, parseInput(d, e.target.value)); paintRow(el, p); } });
    const el = h('div', { class: 'trow', 'data-path': p },
      h('div', { class: 'tpath' }, it.label ? h('span', { class: 'tlabel' }, it.label) : null, p),
      h('div', { class: 'tdef', title: '默认值' }, fmt(d)),
      h('div', null, input),
      h('div', null, h('button', { class: 'ghost', title: '恢复默认', onclick: () => resetOne(p) }, '恢复默认')),
      h('div', { class: 'terr' }));
    paintRow(el, p);
    return el;
  }
  function paintRow(el, p) {
    el.classList.toggle('mod', changed(p));
    el.classList.toggle('err', !!errors[p]);
    el.querySelector('.terr').textContent = errors[p] || '';
    el.querySelector('.terr').hidden = !errors[p];
    el.querySelector('button').disabled = !changed(p) && !errors[p];
    renderGroupsNav();
  }

  function matches(it) {
    if (onlyChanged && !changed(it.path) && !errors[it.path]) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return it.path.toLowerCase().includes(q) || (it.label && it.label.includes(query)) || it.group.name.includes(query);
  }

  function groupsList() {
    const groups = [{ id: '__pinned', name: '常用', items: PINNED.map((p) => BY_PATH[p]) }];
    const map = {};
    for (const it of ITEMS) {
      if (!map[it.group.id]) { map[it.group.id] = { id: it.group.id, name: it.group.name, items: [] }; groups.push(map[it.group.id]); }
      map[it.group.id].items.push(it);
    }
    return groups;
  }

  function renderGroupsNav() {
    const nav = $('groups');
    nav.innerHTML = '';
    for (const g of groupsList()) {
      const shown = g.items.filter(matches).length;
      if (!shown) continue;
      const mod = g.items.filter((it) => changed(it.path)).length;
      nav.appendChild(h('button', { class: mod ? 'mod' : '', onclick: () => { const t = document.getElementById('g-' + g.id); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
        h('span', null, g.name), h('small', null, mod ? `${mod} 改 · ${shown}` : shown)));
    }
  }

  function render() {
    const list = $('list');
    list.innerHTML = '';
    list.appendChild(h('div', { class: 'tnote' },
      h('b', null, '怎么用：'), '改数值 → 点右上角「保存」→ 写入 src/config/tuning.js（只存改过的项）→ ', h('b', null, '刷新游戏页面生效'), '。',
      '默认值在 src/config/*.js，由开发对话维护，这里不会改它们。命令行脚本也读 tuning.js（加 --defaults 只用默认值）。',
      ' 黄底 = 改过；红底 = 值不合法（不能保存）。'));
    for (const g of groupsList()) {
      const items = g.items.filter(matches);
      if (!items.length) continue;
      const lim = query || onlyChanged || expanded[g.id] ? items.length : SHOW_LIMIT;
      const box = h('div', { class: 'tgroup', id: 'g-' + g.id },
        h('h2', null, g.name, h('small', { class: 'muted' }, `${items.length} 项`)),
        h('div', { class: 'trow head' }, h('div', null, '配置项'), h('div', null, '默认值'), h('div', null, '当前值'), h('div', null, '')));
      for (const it of items.slice(0, lim)) box.appendChild(row(it));
      if (items.length > lim) box.appendChild(h('button', { class: 'tmore mini', onclick: () => { expanded[g.id] = true; render(); } }, `还有 ${items.length - lim} 项，展开`));
      list.appendChild(box);
    }
    if (!list.querySelector('.tgroup')) list.appendChild(h('p', { class: 'muted' }, '没有匹配的配置项。'));
    renderGroupsNav();
    updateBar();
  }

  async function save(tuning, msg) {
    try {
      const r = await fetch('/api/tuning', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tuning }) });
      const j = await r.json();
      if (!j.ok) {
        for (const e of j.errors || []) errors[e.path] = e.reason;
        render();
        toast('没有保存：' + (j.errors || []).map((e) => `${e.path} ${e.reason}`).join('；'), 'bad');
        return;
      }
      saved = Object.assign({}, tuning);
      draft = Object.assign({}, tuning);
      render();
      setStatus(`已保存 ${j.count} 项改动 · 刷新游戏页面生效`);
      toast(msg || '已保存。刷新游戏页面生效。', 'good');
    } catch (e) {
      toast('保存失败：本地服务没开？', 'bad');
    }
  }

  $('search').addEventListener('input', (e) => { query = e.target.value.trim(); render(); });
  $('only-changed').addEventListener('change', (e) => { onlyChanged = e.target.checked; render(); });
  $('save').addEventListener('click', () => { if (!Object.keys(errors).length) save(draft); });
  let armed = null;
  $('reset-all').addEventListener('click', (e) => {
    const b = e.target;
    if (!armed) { b.textContent = '再点一次确认'; b.classList.add('danger'); armed = setTimeout(() => { armed = null; b.textContent = '全部恢复默认'; b.classList.remove('danger'); }, 3000); return; }
    clearTimeout(armed); armed = null; b.textContent = '全部恢复默认'; b.classList.remove('danger');
    errors = {};
    save({}, '已全部恢复默认（tuning.js 为空）。刷新游戏页面生效。');
  });
  window.addEventListener('beforeunload', (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
  load();
})();
