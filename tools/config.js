/**
 * 配置网站 · 调参页：默认值来自页面加载的默认配置（不加载 tuning.js），当前值来自本地服务的 /api/tuning。
 * 编辑 → 校验 → 保存（PUT /api/tuning，服务端再校验一遍）→ 写回 src/config/tuning.js（只放改过的项）。
 *
 * 两种视图改的是同一份草稿：
 *   按对象（entities.js）：一只怪 / 一关 / 一张卡一张卡片，图 + 名字 + 分组字段 + 实时预览
 *   按字段（本文件）：DAO.CONFIG 拍平成路径的完整列表，按模块分组
 * Page 是两种视图共用的状态和字段控件（Page.field 生成的输入框会跟着草稿同步）。
 */
(function () {
  'use strict';
  const DAO = window.DAO;
  const T = DAO.Tuning, R = DAO.ConfigRules, E = DAO.ConfigEntities, h = DAO.UI.h, UI = DAO.UI;
  const DEFAULTS = JSON.parse(JSON.stringify(DAO.CONFIG));
  const ITEMS = T.flatten(DEFAULTS).map((x) => Object.assign(x, { group: R.group(x.path), label: R.label(x.path) || E.autoLabel(x.path, DEFAULTS) }));
  const BY_PATH = Object.fromEntries(ITEMS.map((x) => [x.path, x]));
  const PINNED = R.PINNED.map(([p]) => p).filter((p) => BY_PATH[p]);
  const store = UI.makeStore('dao.tools.');
  let saved = {};      // 服务端当前的 tuning
  let draft = {};      // 编辑中的 tuning（path → 值，只放和默认不同的）
  let errors = {};     // path → 错误
  let rawText = {};    // path → 不合法时输入框里的原文（重画时保留）
  let query = '', onlyChanged = false;
  let viewName = store.get('view', 'entity') === 'flat' ? 'flat' : 'entity';
  let workCache = null;
  const bound = new Map();   // path → Set(字段元素)
  const SHOW_LIMIT = 80;     // 按字段视图：每组默认最多显示多少行（搜索时不限）
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
  function setStatus(t, bad) { const s = $('status'); s.textContent = t; s.className = bad ? 'bad' : 'muted'; }

  /** 默认值 + 草稿 合成的配置（预览用；结构和默认值完全一样） */
  function work() {
    if (!workCache) { workCache = JSON.parse(JSON.stringify(DEFAULTS)); T.apply(draft, workCache); }
    return workCache;
  }

  // ================= 字段控件 =================
  /** 输入框的值 → 配置值（按默认值的类型） */
  function parseInput(def, raw, checked) {
    if (typeof def === 'boolean') return !!checked;
    if (typeof def === 'number') { if (raw.trim() === '') return NaN; return Number(raw); }
    if (def === null) return raw.trim() === '' ? null : raw.trim();
    return raw;
  }
  /**
   * 一个配置项的输入控件。opts：
   *   label     名字（bare=true 时不显示）
   *   options   [{ value, label }] → 下拉框
   *   hint(v, cfg) → 输入框旁的换算提示
   *   wide / bare / list（datalist id）/ placeholder / cls
   */
  function field(p, opts) {
    opts = opts || {};
    const it = BY_PATH[p];
    if (!it) return h('span', { class: 'muted' }, '（没有 ' + p + '）');
    const d = it.value, v = cur(p);
    let input;
    if (typeof d === 'boolean') {
      input = h('input', { type: 'checkbox', checked: !!v, onchange: (e) => edit(p, e.target.checked) });
    } else if (opts.options) {
      const list = opts.options.slice();
      if (!list.some((o) => o.value === v)) list.unshift({ value: v, label: String(v) + '（不在可选项里）' });
      input = h('select', { onchange: (e) => edit(p, list[e.target.selectedIndex].value) },
        list.map((o) => h('option', { selected: o.value === v }, o.label)));
      input._list = list;
    } else {
      input = h('input', {
        type: typeof d === 'number' ? 'number' : 'text', step: 'any',
        value: p in rawText ? rawText[p] : v === null ? '' : String(v),
        placeholder: opts.placeholder || (d === null ? '占位（null）' : ''), list: opts.list || null,
        oninput: (e) => { const x = parseInput(d, e.target.value); if (edit(p, x)) delete rawText[p]; else rawText[p] = e.target.value; },
      });
    }
    const el = h('div', { class: ['ef', opts.bare ? 'bare' : '', opts.wide ? 'wide' : '', opts.cls || ''].join(' '), 'data-path': p },
      opts.bare ? null : h('span', { class: 'ef-l', title: p }, opts.label != null ? opts.label : it.label),
      h('span', { class: 'ef-c' }, input,
        opts.hint ? h('span', { class: 'ef-h' }) : null,
        h('button', { class: 'ef-r', type: 'button', title: '恢复默认', onclick: () => reset(p) }, '↺')),
      h('span', { class: 'ef-d' }), h('span', { class: 'ef-e' }));
    el._input = input;
    el._hint = opts.hint || null;
    if (!bound.has(p)) bound.set(p, new Set());
    bound.get(p).add(el);
    paint(el, p, true);
    return el;
  }
  function paint(el, p, init) {
    const v = cur(p), d = BY_PATH[p].value;
    el.classList.toggle('mod', changed(p));
    el.classList.toggle('err', !!errors[p]);
    el.querySelector('.ef-d').textContent = changed(p) ? '默认 ' + fmt(d) : '';
    el.querySelector('.ef-e').textContent = errors[p] || '';
    el.title = changed(p) ? `${BY_PATH[p].label}\n默认：${fmt(d)}\n${p}` : `${BY_PATH[p].label}\n${p}`;
    const inp = el._input;
    if (!init && inp !== document.activeElement && !errors[p]) {
      if (inp.type === 'checkbox') inp.checked = !!v;
      else if (inp.tagName === 'SELECT') { const i = inp._list.findIndex((o) => o.value === v); if (i >= 0) inp.selectedIndex = i; }
      else inp.value = v === null ? '' : String(v);
    }
    if (el._hint) el.querySelector('.ef-h').textContent = el._hint(v, work(), p) || '';
  }
  function repaint(p) { for (const el of bound.get(p) || []) if (el.isConnected) paint(el, p); }

  /** 改一项；返回是否合法 */
  function edit(p, v) {
    const it = BY_PATH[p];
    const err = typeof v === 'number' && isNaN(v) ? '请输入数字' : R.validate(p, v, it.value, DEFAULTS);
    if (err) errors[p] = err; else delete errors[p];
    if (!err) { if (v === it.value) delete draft[p]; else draft[p] = v; workCache = null; }
    repaint(p);
    changedSoon();
    return !err;
  }
  function reset(p) {
    delete draft[p]; delete errors[p]; delete rawText[p];
    workCache = null;
    for (const el of bound.get(p) || []) if (el.isConnected) { el._input.blur(); paint(el, p); }
    changedSoon();
  }
  let pending = false;
  function changedSoon() {
    updateBar();
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; views[viewName].refresh(); });
  }

  function updateBar() {
    const nErr = Object.keys(errors).length;
    const save = $('save');
    save.disabled = !!nErr || !dirty();
    save.textContent = nErr ? `有 ${nErr} 处错误` : dirty() ? `保存（${Object.keys(draft).length} 项改动）` : '已保存';
    $('reset-all').disabled = !Object.keys(draft).length && !Object.keys(saved).length;
  }

  const Page = {
    DEFAULTS, ITEMS, BY_PATH, PINNED,
    cur, changed, error: (p) => errors[p] || null, work, field, edit, reset, toast,
    get query() { return query; }, get onlyChanged() { return onlyChanged; },
    beginRender() { bound.clear(); },
    clearFilters() { query = ''; onlyChanged = false; $('search').value = ''; $('only-changed').checked = false; },
  };

  // ================= 按字段视图 =================
  function flatMatches(it) {
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
  function flatRow(it) {
    const p = it.path;
    return h('div', { class: 'trow', 'data-path': p },
      h('div', { class: 'tpath' }, it.label ? h('span', { class: 'tlabel' }, it.label) : null, p),
      h('div', { class: 'tdef', title: '默认值' }, fmt(it.value)),
      field(p, { bare: true, options: E.optionsFor(p, work()), hint: E.hintFor(p) }));
  }
  const flatView = {
    render() {
      Page.beginRender();
      const list = $('list');
      UI.clear(list);
      list.appendChild(h('div', { class: 'tnote' },
        h('b', null, '按字段：'), '配置的完整列表。改数值 → 点右上角「保存」→ 写入 src/config/tuning.js（只存改过的项）→ ', h('b', null, '刷新游戏页面生效'), '。',
        '默认值在 src/config/*.js，由开发对话维护，这里不会改它们。命令行脚本也读 tuning.js（加 --defaults 只用默认值）。',
        ' 黄底 = 改过；红底 = 值不合法（不能保存）。'));
      for (const g of groupsList()) {
        const items = g.items.filter(flatMatches);
        if (!items.length) continue;
        const lim = query || onlyChanged || expanded[g.id] ? items.length : SHOW_LIMIT;
        const box = h('div', { class: 'tgroup', id: 'g-' + g.id },
          h('h2', null, g.name, h('small', { class: 'muted' }, `${items.length} 项`)),
          h('div', { class: 'trow head' }, h('div', null, '配置项'), h('div', null, '默认值'), h('div', null, '当前值')));
        for (const it of items.slice(0, lim)) box.appendChild(flatRow(it));
        if (items.length > lim) box.appendChild(h('button', { class: 'tmore mini', onclick: () => { expanded[g.id] = true; flatView.render(); } }, `还有 ${items.length - lim} 项，展开`));
        list.appendChild(box);
      }
      if (!list.querySelector('.tgroup')) list.appendChild(h('p', { class: 'muted' }, '没有匹配的配置项。'));
      flatView.refresh();
    },
    refresh() {
      const nav = $('groups');
      UI.clear(nav);
      for (const g of groupsList()) {
        const shown = g.items.filter(flatMatches).length;
        if (!shown) continue;
        const mod = g.items.filter((it) => changed(it.path)).length;
        nav.appendChild(h('button', { class: mod ? 'mod' : '', onclick: () => { const t = document.getElementById('g-' + g.id); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
          h('span', null, g.name), h('small', null, mod ? `${mod} 改 · ${shown}` : shown)));
      }
    },
  };

  // ================= 两种视图 =================
  const views = { flat: flatView, entity: E.createView(Page, { nav: $('groups'), list: $('list') }) };
  function render() {
    for (const b of document.querySelectorAll('#views button')) b.classList.toggle('on', b.dataset.view === viewName);
    $('search').placeholder = viewName === 'entity' ? '搜对象：名字或 id（例如 灰狼、wolf、1-4、穿云剑）' : '搜配置项：路径或中文名（例如 research、采集、costs）';
    views[viewName].render();
    updateBar();
  }
  for (const b of document.querySelectorAll('#views button')) b.addEventListener('click', () => {
    if (b.dataset.view === viewName) return;
    viewName = b.dataset.view;
    store.set('view', viewName);
    render();
    window.scrollTo({ top: 0 });
  });

  // ================= 读写 =================
  async function load() {
    try {
      const r = await fetch('/api/tuning', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      saved = j.tuning || {};
      draft = Object.assign({}, saved);
      errors = {};
      rawText = {};
      for (const e of j.errors || []) errors[e.path] = e.reason;
      workCache = null;
      setStatus(Object.keys(saved).length ? `tuning.js 现有 ${Object.keys(saved).length} 项改动` : 'tuning.js 没有改动（全是默认值）');
    } catch (e) {
      setStatus('读不到 /api/tuning：请用 node tools/server.js 启动后从 http://localhost:端口/tools/ 打开', true);
    }
    render();
    loadAssets();
  }
  /** assets/ 下已有的图片，给图片输入框做候选 */
  async function loadAssets() {
    try {
      const r = await fetch('/api/assets', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      const dl = $('dl-assets');
      UI.clear(dl);
      for (const f of j.files || []) dl.appendChild(h('option', { value: f }));
    } catch (e) { /* 没有本地服务时没有候选，照样能手填 */ }
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
      rawText = {};
      workCache = null;
      render();
      setStatus(`已保存 ${j.count} 项改动 · 刷新游戏页面生效`);
      toast(msg || '已保存。刷新游戏页面生效。', 'good');
    } catch (e) {
      toast('保存失败：本地服务没开？', 'bad');
    }
  }

  $('search').addEventListener('input', (e) => { query = e.target.value.trim(); views[viewName].render(); updateBar(); });
  $('only-changed').addEventListener('change', (e) => { onlyChanged = e.target.checked; views[viewName].render(); updateBar(); });
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
  window.DAO.ConfigPage = Page;   // 方便在控制台里看
  window.DAO.ConfigViews = views;
  load();
})();
