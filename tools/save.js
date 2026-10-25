/**
 * 配置网站 · 存档工具：直接读写本机浏览器里的游戏存档（和游戏同一个网址才看得到），先选要改哪个存档位。
 * 每个操作：读存档位（自动迁移）→ 改 → 写回（写之前自动留一份备份；本地服务可用时同时写硬盘 saves/）。
 * 游戏页开着这个存档位时会通过 storage 事件自动重新读入。读不出来的存档位不让改，只能导出原始数据。
 */
(function () {
  'use strict';
  const DAO = window.DAO, G = DAO.Game, C = DAO.CONFIG.game, h = DAO.UI.h;
  const slots = DAO.SaveSlots.create({ storage: DAO.SaveSlots.browserStorage(localStorage) });
  const Disk = DAO.SaveDisk;
  let cur = Number((location.hash.match(/slot=(\d+)/) || [])[1]) || slots.lastSlot(Date.now()) || 1;
  const $ = (id) => document.getElementById(id);
  document.getElementById('origin').textContent = location.origin;

  function toast(text, kind) { const el = h('div', { class: 'toast ' + (kind || '') }, text); $('toasts').appendChild(el); setTimeout(() => el.remove(), 3500); }
  function readSlot() { return slots.read(cur, Date.now()); }
  function read() { const r = readSlot(); return r.status === 'ok' ? r.save : null; }
  function write(s, msg) {
    const w = slots.write(cur, s, Date.now(), { reason: 'tool' });
    if (!w.ok) { toast(w.error === 'protected' ? '这个存档位读不出来，不能直接改（先导出原始存档）' : '写不进浏览器存储', 'bad'); return; }
    Disk.put(cur, w.raw, { backup: true });
    toast((msg || '已写入存档') + `（存档位 ${cur}）`, 'good');
    render();
  }
  /** 存档里的「游戏时间」：游戏时钟按倍率走，研究的结束时间用的是它 */
  function gameNow(s) { return DAO.GameClock.create({ scale: DAO.CONFIG.debug.timeScale, saved: s.clock }).now(); }
  function edit(fn, msg) {
    const s = read();
    if (!s) { toast('这个存档位没有能改的存档', 'bad'); return; }
    const r = fn(s);
    if (r === false) return;
    write(s, msg);
  }
  const card = (title, ...kids) => h('div', { class: 'card' }, h('h2', null, title), ...kids);
  const num = (id, val, attrs) => h('input', Object.assign({ id, type: 'number', value: val, step: 'any' }, attrs || {}));

  function render() {
    const app = $('app');
    app.innerHTML = '';
    const rs = readSlot();
    const s = rs.status === 'ok' ? rs.save : null;
    // ---- 选存档位 ----
    const list = slots.list(Date.now());
    app.appendChild(card('存档位', h('div', { class: 'seg' }, list.map((it) => h('button', { class: it.slot === cur ? 'on' : '', onclick: () => { cur = it.slot; location.hash = 'slot=' + cur; render(); } },
      `${it.slot}：${it.status === 'empty' ? '空' : it.status === 'error' ? '读不出来' : it.info ? `${it.info.roleName} Lv${it.info.level} · ${it.info.best ? it.info.best.id : '未通关'}` : '存档'}`))),
      h('p', { class: 'muted' }, `下面的操作都只改存档位 ${cur}。改之前会自动留一份备份（游戏标题页「读取存档 → 备份」里可以恢复）。${Disk.describe()}。`)));
    // ---- 概况 ----
    if (rs.status === 'error') {
      app.appendChild(card('存档读不出来', h('p', null, rs.errorText), h('p', { class: 'muted' }, '原始数据原样保留着，这里不能直接改。可以导出原始存档，或者在下面导入一份覆盖（覆盖前的数据会进备份）。'),
        h('button', { onclick: () => exportText(slots.rawOf(cur), `dao-slot${cur}-original.json`) }, '导出原始存档')));
    } else if (!s) {
      app.appendChild(card('空存档位', h('p', { class: 'muted' }, `存档位 ${cur} 还没有存档。先在游戏里选这个位置开一局，或者在下面导入一份。`)));
    } else {
      const best = G.bestClearedStage(s);
      const ra = s.research.active;
      app.appendChild(card('概况', h('div', { class: 'skv' },
        h('span', null, '存档版本'), h('b', null, 'v' + s.v),
        h('span', null, '开局'), h('b', null, `${G.starter(s).name}（${DAO.ROLE_NAMES[G.starter(s).role]}）`),
        h('span', null, '金币 / 灵矿 / 灵草 / 灵石'), h('b', null, `${DAO.UI.num(s.gold)} / ${Math.floor(s.ore || 0)} / ${Math.floor(s.herb || 0)} / ${Math.floor(s.stone || 0)}`),
        h('span', null, '名额 / 上阵位'), h('b', null, `${s.roster.length}/${G.rosterCap(s)} · 上阵 ${s.lineup.length}/${G.slots(s)}`),
        h('span', null, '最高通关'), h('b', null, best ? `${best.id} ${best.name}` : '—'),
        h('span', null, '研究'), h('b', null, ra ? `上阵位 → ${ra.level}，${G.getChar(s, ra.charId).name}` : '无'))));
      // ---- 资源 ----
      app.appendChild(card('加金币 / 原料',
        h('div', { class: 'srow' }, h('label', null, '金币 '), num('add-gold', 1000), h('button', { class: 'primary', onclick: () => { const v = Number($('add-gold').value) || 0; edit((x) => { x.gold = Math.max(0, x.gold + v); }, `金币 ${v >= 0 ? '+' : ''}${v}`); } }, '加')),
        ...[['ore', '灵矿'], ['herb', '灵草'], ['stone', '灵石']].map(([k, nm]) => h('div', { class: 'srow' }, h('label', null, nm + ' '), num('add-' + k, 100),
          h('button', { class: 'primary', onclick: () => { const v = Number($('add-' + k).value) || 0; edit((x) => { x[k] = Math.max(0, (x[k] || 0) + v); }, `${nm} ${v >= 0 ? '+' : ''}${v}`); } }, '加'))),
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
        h('button', { disabled: !s, onclick: () => exportText(JSON.stringify(read(), null, 1), `dao-slot${cur}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`) }, '导出为文件'),
        file,
        h('button', { class: 'primary', onclick: doImport }, '导入'))));
    let armed = null;
    const rb = h('button', { disabled: rs.status === 'empty', onclick: () => {
      if (!armed) { rb.textContent = '再点一次确认删除'; rb.classList.add('danger'); armed = setTimeout(() => { armed = null; rb.textContent = '删除这个存档位'; rb.classList.remove('danger'); }, 3000); return; }
      clearTimeout(armed); slots.remove(cur, Date.now()); Disk.remove(cur); toast(`存档位 ${cur} 已删除（删除前的数据在备份里）`, 'good'); render();
    } }, '删除这个存档位');
    app.appendChild(card('删除', h('p', { class: 'muted' }, `删除存档位 ${cur}（游戏页如果开着它会回到标题页）。删除前的数据会留在这个存档位的备份里${Disk.disk.state === 'ok' ? '，硬盘上的移到 saves/deleted/' : ''}。`), rb));
  }

  function exportText(text, name) {
    const blob = new Blob([text], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }
  function doImport() {
    const r = slots.importText(cur, $('io').value, Date.now());
    if (!r.ok) { toast(`导入失败：${r.errorText || r.error}；存档位 ${cur} 没有改动`, 'bad'); return; }
    Disk.put(cur, slots.rawOf(cur), { backup: true });
    toast(`已导入到存档位 ${cur}${r.migratedFrom != null ? `（v${r.migratedFrom} → v${r.save.v}）` : ''}`, 'good');
    render();
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
  Disk.init().then(() => { Disk.sync(slots, Date.now()); render(); });
  window.addEventListener('storage', (e) => { if (e.key && e.key.startsWith('dao.slot')) render(); });
})();
