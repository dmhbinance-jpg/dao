/**
 * 配置网站 · 存档工具：直接读写本机浏览器里的游戏存档（localStorage「dao.save」，和游戏同一个网址才看得到）。
 * 每个操作：读存档 → Game.migrate → 改 → 写回。游戏页开着时会通过 storage 事件自动重新读入。
 */
(function () {
  'use strict';
  const DAO = window.DAO, G = DAO.Game, C = DAO.CONFIG.game, h = DAO.UI.h;
  const KEY = 'dao.save';
  const $ = (id) => document.getElementById(id);
  document.getElementById('origin').textContent = location.origin;

  function toast(text, kind) { const el = h('div', { class: 'toast ' + (kind || '') }, text); $('toasts').appendChild(el); setTimeout(() => el.remove(), 3500); }
  function read() {
    try { const raw = localStorage.getItem(KEY); return raw ? G.migrate(JSON.parse(raw), Date.now()) : null; } catch (e) { return null; }
  }
  function write(s, msg) { localStorage.setItem(KEY, JSON.stringify(s)); toast(msg || '已写入存档', 'good'); render(); }
  /** 存档里的「游戏时间」：游戏时钟按倍率走，研究的结束时间用的是它 */
  function gameNow(s) { return DAO.GameClock.create({ scale: DAO.CONFIG.debug.timeScale, saved: s.clock }).now(); }
  function edit(fn, msg) {
    const s = read();
    if (!s) { toast('没有存档：先在游戏里开一局', 'bad'); return; }
    const r = fn(s);
    if (r === false) return;
    write(s, msg);
  }
  const card = (title, ...kids) => h('div', { class: 'card' }, h('h2', null, title), ...kids);
  const num = (id, val, attrs) => h('input', Object.assign({ id, type: 'number', value: val, step: 'any' }, attrs || {}));

  function render() {
    const app = $('app');
    app.innerHTML = '';
    const s = read();
    // ---- 概况 ----
    if (!s) {
      app.appendChild(card('没有存档', h('p', { class: 'muted' }, '这个网址下还没有游戏存档。先打开游戏开一局，或者在下面导入一份。')));
    } else {
      const best = G.bestClearedStage(s);
      const ra = s.research.active;
      app.appendChild(card('概况', h('div', { class: 'skv' },
        h('span', null, '存档版本'), h('b', null, 'v' + s.v),
        h('span', null, '开局'), h('b', null, `${G.starter(s).name}（${DAO.ROLE_NAMES[G.starter(s).role]}）`),
        h('span', null, '金币 / 灵矿'), h('b', null, `${DAO.UI.num(s.gold)} / ${Math.floor(s.ore || 0)}`),
        h('span', null, '名额 / 上阵位'), h('b', null, `${s.roster.length}/${G.rosterCap(s)} · 上阵 ${s.lineup.length}/${G.slots(s)}`),
        h('span', null, '最高通关'), h('b', null, best ? `${best.id} ${best.name}` : '—'),
        h('span', null, '研究'), h('b', null, ra ? `上阵位 → ${ra.level}，${G.getChar(s, ra.charId).name}` : '无'))));
      // ---- 资源 ----
      app.appendChild(card('加金币 / 灵矿',
        h('div', { class: 'srow' }, h('label', null, '金币 '), num('add-gold', 1000), h('button', { class: 'primary', onclick: () => { const v = Number($('add-gold').value) || 0; edit((x) => { x.gold = Math.max(0, x.gold + v); }, `金币 ${v >= 0 ? '+' : ''}${v}`); } }, '加')),
        h('div', { class: 'srow' }, h('label', null, '灵矿 '), num('add-ore', 100), h('button', { class: 'primary', onclick: () => { const v = Number($('add-ore').value) || 0; edit((x) => { x.ore = Math.max(0, (x.ore || 0) + v); }, `灵矿 ${v >= 0 ? '+' : ''}${v}`); } }, '加')),
        h('p', { class: 'muted' }, '填负数可以减。')));
      // ---- 角色等级 ----
      app.appendChild(card('改角色等级', ...s.roster.map((c) => h('div', { class: 'srow' },
        h('span', { style: { minWidth: '9em' } }, `${c.name}（${DAO.ROLE_NAMES[c.role]}）`),
        num('lv-' + c.id, c.level, { min: 1, max: C.maxLevel, step: 1 }),
        h('button', { onclick: () => { const v = Math.round(Number($('lv-' + c.id).value)); if (!(v >= 1 && v <= C.maxLevel)) { toast(`等级要在 1–${C.maxLevel}`, 'bad'); return; } edit((x) => { const ch = G.getChar(x, c.id); ch.level = v; ch.exp = 0; }, `${c.name} → Lv${v}`); } }, '改'))),
        h('p', { class: 'muted' }, '经验清零。')));
      // ---- 解锁关卡 ----
      const sel = h('select', { id: 'stage-sel' }, G.stages().map((st) => h('option', { value: st.id, selected: (G.nextStage(s) || {}).id === st.id }, `${st.id} ${st.name}`)));
      app.appendChild(card('解锁关卡',
        h('div', { class: 'srow' }, sel, h('button', { class: 'primary', onclick: () => unlockTo($('stage-sel').value) }, '解锁到这一关')),
        h('p', { class: 'muted' }, '这一关之前的都算通关一次；途中会开放的系统照常开放（洞府、采集 / 锻造房、第一张技能卡），对应的引导会排队。')));
      // ---- 研究 ----
      app.appendChild(card('研究', ra
        ? h('div', null, h('p', null, `${G.getChar(s, ra.charId).name} 正在研究第 ${ra.level} 个上阵位。`),
          h('button', { class: 'primary', onclick: () => edit((x) => { const a = x.research.active; if (!a) return false; G.tickResearch(x, Math.max(a.endsAt, gameNow(x))); }, '研究已完成') }, '立即完成'))
        : h('p', { class: 'muted' }, '现在没有在研究。')));
    }
    // ---- 导出 / 导入 / 重置 ----
    const ta = h('textarea', { id: 'io', placeholder: '导入：把存档 JSON 粘贴到这里，再点「导入」' });
    if (s) ta.value = JSON.stringify(s, null, 1);
    const file = h('input', { type: 'file', accept: '.json,application/json', onchange: (e) => { const f = e.target.files[0]; if (!f) return; f.text().then((t) => { ta.value = t; toast('已读入文件，点「导入」写进存档'); }); } });
    app.appendChild(card('导出 / 导入', ta,
      h('div', { class: 'srow' },
        h('button', { disabled: !s, onclick: () => { const blob = new Blob([JSON.stringify(read(), null, 1)], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: `dao-save-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json` }); document.body.appendChild(a); a.click(); a.remove(); } }, '导出为文件'),
        file,
        h('button', { class: 'primary', onclick: doImport }, '导入'))));
    let armed = null;
    const rb = h('button', { disabled: !s, onclick: () => {
      if (!armed) { rb.textContent = '再点一次确认删除'; rb.classList.add('danger'); armed = setTimeout(() => { armed = null; rb.textContent = '重置存档'; rb.classList.remove('danger'); }, 3000); return; }
      clearTimeout(armed); localStorage.removeItem(KEY); toast('存档已删除', 'good'); render();
    } }, '重置存档');
    app.appendChild(card('重置', h('p', { class: 'muted' }, '删除这个网址下的游戏存档（游戏页会回到选角）。先导出一份备份更稳妥。'), rb));
  }

  function doImport() {
    let obj;
    try { obj = JSON.parse($('io').value); } catch (e) { toast('不是有效的 JSON', 'bad'); return; }
    const s = G.migrate(obj, Date.now());
    if (!s) { toast('不认识这份存档（版本或格式不对）', 'bad'); return; }
    write(s, `已导入（v${obj.v} → v${s.v}）`);
  }

  function unlockTo(stageId) {
    edit((s) => {
      const list = G.stages();
      const idx = list.findIndex((x) => x.id === stageId);
      for (let i = 0; i < idx; i++) {
        const st = list[i];
        if (G.isCleared(s, st.id)) continue;
        s.progress.cleared[st.id] = 1;
        // 洞府在开放关「第一次战败或通关」时开放（按顺序开，引导也按顺序排）
        if (st.id === C.recruit.unlockStage && !s.unlocks.cave) G.unlockCave(s);
        G.onFirstClear(s, st.id);
      }
    }, '已解锁到 ' + stageId);
  }

  render();
  window.addEventListener('storage', (e) => { if (e.key === KEY) render(); });
})();
