/**
 * 游戏界面 · title
 * 标题页：继续 / 新游戏 / 读取 / 导入、存档位列表、备份面板、选角页（新游戏），以及顶栏「存档」菜单。
 * 共享状态和公共工具在 app-core.js（DAO.App）。
 * 对外（挂在 DAO.App 上）：leaveTitle、renderTitle、renderChooser、openSaveMenu
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const UI = DAO.UI;
  const G = DAO.Game;
  const h = UI.h;
  const A = DAO.App;

  // ================= 标题页 =================
  function leaveTitle() { document.body.classList.remove('at-title'); }
  /** 需要二次确认的按钮：第一次点变成「再点一次确认…」，3 秒内再点才执行 */
  function armBtn(key, label, armedLabel, onGo, cls) {
    const armed = A.titleArm === key;
    return h('button', { class: (cls || 'mini') + (armed ? ' danger' : ''), onclick: () => {
      if (A.titleArm !== key) { A.titleArm = key; renderTitle(); setTimeout(() => { if (A.titleArm === key) { A.titleArm = null; if (!A.save) renderTitle(); } }, 3000); return; }
      A.titleArm = null; onGo();
    } }, armed ? armedLabel : label);
  }
  const REASON_NAME = { auto: '自动', manual: '手动保存', title: '回标题页', 'before-new': '新游戏覆盖前', 'before-import': '导入覆盖前', 'before-restore': '恢复前', 'before-delete': '删除前', 'before-disk': '用硬盘存档前', 'before-sync': '同步前', migrate: '升级版本后', 'before-tool': '存档工具修改前' };
  function slotInfoView(it) {
    const src = A.Disk.disk.source[it.slot] === 'disk' ? '硬盘' : '浏览器';
    const onDisk = A.Disk.disk.state === 'ok' && A.Disk.disk.files[it.slot] && A.Disk.disk.files[it.slot].raw === A.slots.rawOf(it.slot);
    if (it.status === 'empty') return h('div', { class: 'slot-info' }, h('b', { class: 'muted' }, '空'), it.backups ? h('small', { class: 'muted' }, `（有 ${it.backups} 份备份）`) : null);
    if (it.status === 'error') return h('div', { class: 'slot-info' }, h('b', { class: 'lack' }, '读不出来'), h('small', null, it.errorText), h('small', { class: 'muted' }, '原始存档原样保留着，不会被自动覆盖。可以导出原始存档，或从备份恢复。'));
    const f = it.info;
    if (!f) return h('div', { class: 'slot-info' }, h('b', null, '存档'));
    return h('div', { class: 'slot-info' },
      h('b', null, `${f.name} · ${f.roleName} Lv${f.level}`),
      h('small', null, `进度 ${f.best ? `${f.best.id} ${f.best.name}` : '还没通关'} · 上阵 ${f.lineup}/${f.slots} · 金币 ${UI.num(f.gold)}`),
      h('small', { class: 'muted' }, `最后保存 ${A.fmtDate(f.savedAt)} · 来源：${src}${onDisk && src === '浏览器' ? '（硬盘已同步）' : ''}${it.migratedFrom != null ? ` · 旧版本 v${it.migratedFrom}，读取时自动升级` : ''}`));
  }
  function slotCard(it, actions) {
    return h('div', { class: 'slot-card' + (it.status === 'error' ? ' bad' : it.status === 'empty' ? ' empty' : '') },
      h('div', { class: 'slot-no' }, `存档位 ${it.slot}`), slotInfoView(it), h('div', { class: 'save-acts' }, actions));
  }
  function pickImportFile(n) {
    const input = h('input', { type: 'file', accept: '.json,application/json,text/plain', style: { display: 'none' } });
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const r = A.slots.importText(n, String(rd.result), Date.now());
        if (!r.ok) { A.toast(`导入失败：${r.errorText || r.error}；存档位 ${n} 没有改动`, 'bad'); return; }
        A.Disk.put(n, A.slots.rawOf(n), { backup: true });
        A.Disk.disk.source[n] = 'browser';
        A.toast(`已导入到存档位 ${n}${r.migratedFrom != null ? `（从 v${r.migratedFrom} 升级）` : ''}`, 'good');
        A.title = { mode: 'load' };
        renderTitle();
      };
      rd.readAsText(f);
    });
    document.body.appendChild(input);
    input.click();
  }
  function deleteSlot(n) {
    A.slots.remove(n, Date.now());
    A.Disk.remove(n);
    A.toast(`存档位 ${n} 已删除（删除前的数据留在这个存档位的备份里${A.Disk.disk.state === 'ok' ? '，硬盘上的移到了 saves/deleted/' : ''}）`);
    renderTitle();
  }
  function backupsView(n) {
    const now = Date.now();
    const list = A.slots.backups(n), orig = A.slots.originals(n);
    const alt = A.Disk.altFor(A.slots, n, now);
    const wrap = h('div', { class: 'title-panel' }, h('h2', null, `存档位 ${n} · 备份`),
      h('p', { class: 'muted' }, `自动备份：保存时每隔 ${Math.round(DAO.CONFIG.saves.backupEveryMs / 60000)} 分钟留一份（手动保存、回标题页、覆盖 / 删除前也会留），保留最近 ${DAO.CONFIG.saves.backups} 份。恢复时当前数据会先存进备份。`));
    if (alt) wrap.appendChild(h('div', { class: 'backup-row' }, h('span', null, h('b', null, '硬盘上的存档'), h('small', { class: 'muted' }, ` 最后保存 ${A.fmtDate(alt.savedAt)}（和浏览器里的不一样）`)),
      armBtn('alt' + n, '用这份', '再点一次确认', () => { A.slots.writeRaw(n, alt.raw, Date.now(), 'disk'); A.Disk.disk.source[n] = 'disk'; A.toast(`存档位 ${n} 已换成硬盘上的那份`, 'good'); renderTitle(); })));
    if (!list.length) wrap.appendChild(h('p', { class: 'muted' }, '还没有备份。'));
    list.forEach((b, i) => {
      const p = A.slots.parse(b.data, now);
      let info = '';
      if (p.status === 'ok') { try { const f = A.slots.summary(p.save); info = `${f.roleName} Lv${f.level} · ${f.best ? f.best.id : '未通关'} · 金币 ${UI.num(f.gold)}`; } catch (e) { info = ''; } }
      wrap.appendChild(h('div', { class: 'backup-row' },
        h('span', null, h('b', null, A.fmtDate(b.at)), h('small', { class: 'muted' }, ` ${REASON_NAME[b.reason] || b.reason} · v${b.v == null ? '?' : b.v} · ${p.status === 'ok' ? info : '读不出来'}`)),
        h('span', { class: 'save-acts' },
          h('button', { class: 'mini', onclick: () => A.exportText(b.data, `dao-slot${n}-backup-${A.fileStamp(b.at)}.json`) }, '导出'),
          p.status === 'ok' ? armBtn(`rs${n}:${i}`, '恢复', '再点一次确认恢复', () => {
            const r = A.slots.restore(n, i, Date.now());
            if (!r.ok) { A.toast('恢复失败：' + (r.errorText || r.error), 'bad'); return; }
            A.Disk.put(n, A.slots.rawOf(n), { backup: true });
            A.toast(`存档位 ${n} 已从 ${A.fmtDate(b.at)} 的备份恢复`, 'good');
            A.title = { mode: 'load' }; renderTitle();
          }) : null)));
    });
    if (orig.length) {
      wrap.appendChild(h('h3', { class: 'group-title' }, '升级前的原始存档'));
      wrap.appendChild(h('p', { class: 'muted' }, `读取旧版本存档时，升级前的原样数据按版本号各留一份（保留最近 ${DAO.CONFIG.saves.originals} 份）。`));
      orig.forEach((o, i) => wrap.appendChild(h('div', { class: 'backup-row' },
        h('span', null, h('b', null, `v${o.v}`), h('small', { class: 'muted' }, ` ${A.fmtDate(o.at)}`)),
        h('span', { class: 'save-acts' },
          h('button', { class: 'mini', onclick: () => A.exportText(o.data, `dao-slot${n}-v${o.v}-original.json`) }, '导出'),
          armBtn(`ro${n}:${i}`, '放回存档位', '再点一次确认', () => { A.slots.restoreOriginal(n, i, Date.now()); A.toast(`已把 v${o.v} 的原始存档放回存档位 ${n}`); A.title = { mode: 'load' }; renderTitle(); })))));
    }
    wrap.appendChild(h('div', { class: 'title-back' }, h('button', { onclick: () => { A.title = { mode: 'load' }; renderTitle(); } }, '返回存档列表')));
    return wrap;
  }
  function renderTitle() {
    A.headerSig = '';
    document.body.classList.add('at-title');
    UI.clear(A.els.app);
    UI.clear(A.els.chips);
    UI.clear(A.els.nav);
    A.els.activity.hidden = true;
    A.els.modal.hidden = true;
    const now = Date.now();
    const list = A.slots.list(now);
    const last = A.slots.lastSlot(now);
    const page = h('section', { class: 'title-page' });
    page.appendChild(h('div', { class: 'title-head' }, h('span', { class: 'seal big' }, '道'), h('div', null, h('h1', null, '青石山'), h('p', { class: 'muted' }, A.Disk.describe()))));
    if (A.title.mode === 'main') {
      const lastIt = last && list.find((x) => x.slot === last);
      const menu = h('div', { class: 'title-menu' });
      if (lastIt) menu.appendChild(h('button', { class: 'primary big-btn', onclick: () => tryOpen(last) }, '继续游戏', h('small', null, lastIt.info ? `存档位 ${last} · ${lastIt.info.name} ${lastIt.info.roleName} Lv${lastIt.info.level}` : `存档位 ${last}`)));
      menu.appendChild(h('button', { class: 'big-btn', onclick: () => { A.title = { mode: 'new' }; renderTitle(); } }, '新游戏'));
      menu.appendChild(h('button', { class: 'big-btn', onclick: () => { A.title = { mode: 'load' }; renderTitle(); } }, '读取存档'));
      menu.appendChild(h('button', { class: 'big-btn', onclick: () => { A.title = { mode: 'import' }; renderTitle(); } }, '导入存档'));
      page.appendChild(menu);
      const bad = list.filter((x) => x.status === 'error');
      if (bad.length) page.appendChild(h('p', { class: 'lack' }, `存档位 ${bad.map((x) => x.slot).join('、')} 读不出来：原始存档保留着，去「读取存档」里可以导出或从备份恢复。`));
    } else if (A.title.mode === 'backups') {
      page.appendChild(backupsView(A.title.slot));
    } else {
      const head = { new: ['新游戏', '选一个存档位开始。已有存档的位置要再点一次确认才覆盖（覆盖前的存档会留在备份里）。'],
        load: ['读取存档', '每个存档位互不影响。'], import: ['导入存档', '选一个存档位，再选存档文件（.json）。旧版本的存档会自动升级；已有存档的位置要确认才覆盖。'] }[A.title.mode];
      const panel = h('div', { class: 'title-panel' }, h('h2', null, head[0]), h('p', { class: 'muted' }, head[1]));
      for (const it of list) {
        const n = it.slot, acts = [];
        if (A.title.mode === 'new') {
          if (it.status === 'empty') acts.push(h('button', { class: 'mini primary', onclick: () => startNewIn(n) }, '在这里开始'));
          else acts.push(armBtn('new' + n, '覆盖并开始', '再点一次确认覆盖', () => startNewIn(n), 'mini'));
        } else if (A.title.mode === 'import') {
          if (it.status === 'empty') acts.push(h('button', { class: 'mini primary', onclick: () => pickImportFile(n) }, '导入到这里'));
          else acts.push(armBtn('imp' + n, '导入并覆盖', '再点一次确认覆盖', () => pickImportFile(n), 'mini'));
        } else {
          if (it.status === 'ok') acts.push(h('button', { class: 'mini primary', onclick: () => tryOpen(n) }, '读取'));
          if (it.status !== 'empty') acts.push(h('button', { class: 'mini', onclick: () => A.exportText(A.slots.rawOf(n), `dao-slot${n}-${it.status === 'error' ? 'original' : 'save'}-${A.fileStamp()}.json`) }, it.status === 'error' ? '导出原始存档' : '导出到文件'));
          if (it.backups || it.originals || A.Disk.altFor(A.slots, n, now)) acts.push(h('button', { class: 'mini', onclick: () => { A.title = { mode: 'backups', slot: n }; renderTitle(); } }, `备份（${it.backups}）`));
          if (it.status !== 'empty') acts.push(armBtn('del' + n, '删除', '再点一次确认删除', () => deleteSlot(n), 'mini ghost'));
        }
        panel.appendChild(slotCard(it, acts));
      }
      panel.appendChild(h('div', { class: 'title-back' }, h('button', { onclick: () => { A.title = { mode: 'main' }; renderTitle(); } }, '返回')));
      page.appendChild(panel);
    }
    A.els.app.appendChild(page);
  }
  function tryOpen(n) {
    const r = A.openSlot(n);
    if (r.status === 'ok') return;
    A.toast(r.status === 'empty' ? `存档位 ${n} 是空的` : `存档位 ${n} 读不出来：${r.errorText}。原始存档保留着，没有覆盖`, 'bad');
    A.title = { mode: 'load' };
    renderTitle();
  }
  /** 新游戏：选好存档位后进选角页 */
  function startNewIn(n) {
    A.title = { mode: 'chooser', slot: n };
    renderChooser(n);
  }

  // ================= 选角 =================
  function renderChooser(slotN) {
    A.headerSig = '';
    document.body.classList.add('at-title');
    UI.clear(A.els.app);
    UI.clear(A.els.chips);
    UI.clear(A.els.nav);
    A.els.activity.hidden = true;
    let picked = null;
    const nameInput = h('input', { id: 'hero-name', type: 'text', maxlength: 8, placeholder: '道号（可不填）', class: 'name-input' });
    const goBtn = h('button', { class: 'primary big-btn', disabled: true, onclick: () => {
      A.stopSession();
      A.clock = DAO.GameClock.create({ scale: DAO.CONFIG.debug.timeScale });
      const fresh = G.newSave(picked, nameInput.value, A.gnow());
      G.setClock(fresh, A.clock.save());
      // 新游戏覆盖存档位（玩家已确认）：旧数据先进备份
      const w = A.slots.write(slotN, fresh, Date.now(), { reason: 'new', force: true });
      if (!w.ok) { A.toast('浏览器存档写不进去，没法开始新游戏', 'bad'); return; }
      A.Disk.disk.source[slotN] = 'browser';
      A.Disk.put(slotN, w.raw, { now: true });
      A.curSlot = slotN;
      A.save = fresh;
      leaveTitle();
      A.tab = 'stages';
      A.render();
      A.step();
    } }, '选一个定位');
    const cards = Object.entries(DAO.CONFIG.game.starters).map(([role, st]) => {
      const c = G.newSave(role, '', 0).roster[0];
      const u = G.charUnit(c);
      const card = h('button', { class: 'role-card', type: 'button', onclick: () => {
        picked = role;
        cards.forEach((x) => x.classList.toggle('on', x === card));
        goBtn.disabled = false;
        goBtn.textContent = `以${st.title}入道`;
      } },
        h('div', { class: 'role-head' }, A.charGlyph({ role, name: st.title, art: st.art }), h('div', null, h('h3', null, st.title), h('p', null, st.desc))),
        h('div', { class: 'role-section' }, h('h4', null, '一级属性'),
          h('div', { class: 'triad-grid' }, ['str', 'agi', 'int'].map((k) => h('div', null,
            h('span', null, A.STAT_NAME[k]), h('b', null, Math.round(u.base[k])), h('small', null, `+${st.growth[k]}/级`))))),
        h('div', { class: 'role-section' }, h('h4', null, '1 级'),
          h('div', { class: 'kv-grid' }, A.statRows(u, role).map(([k, v]) => h('div', null, h('span', null, k), h('b', null, v))))),
        h('div', { class: 'role-section' }, h('h4', null, '技能'),
          u.skills.map((s) => h('div', { class: 'skill-row' }, h('b', null, s.name), h('span', null, (s.key === 'basic' ? '普攻 · ' : '固有主动 · ') + A.skillDesc(s))))),
        h('div', { class: 'role-section' }, h('h4', null, '天赋'), c.talents.map((t) => h('div', { class: 'skill-row' }, A.talentDesc(t)))));
      return card;
    });
    A.els.app.appendChild(h('section', { class: 'chooser' },
      h('div', { class: 'chooser-intro' },
        h('h2', null, `入道 · 存档位 ${slotN}`),
        h('p', null, '选一个定位开始。开局资质中等、固定，不随机。一个人走到青石山的石甲关会卡住，那时洞府开门，可以招募同伴。')),
      h('div', { class: 'role-cards' }, cards),
      h('div', { class: 'chooser-go' }, nameInput, goBtn,
        h('button', { onclick: () => { A.title = { mode: 'new' }; renderTitle(); } }, '返回'))));
  }

  /** 顶栏「存档」：手动保存、回到标题页 */
  function openSaveMenu() {
    if (!A.save) return;
    const info = A.Disk.disk.state === 'ok' ? '浏览器 + 硬盘（saves/）' : '浏览器';
    A.showModal({
      title: `存档 · 存档位 ${A.curSlot}`,
      body: [`最后保存：${A.fmtDate(A.save.savedAt)}。游戏会自动保存（操作后、每 5 秒、离开页面前），存在${info}。`,
        `自动备份每 ${Math.round(DAO.CONFIG.saves.backupEveryMs / 60000)} 分钟留一份，手动保存和回标题页时也会留一份；在标题页「读取存档 → 备份」里可以恢复。`],
      buttons: [
        { label: '手动保存', primary: true, onClick: () => { if (A.persist('manual')) A.toast(`已保存到存档位 ${A.curSlot}（并留了一份备份）`, 'good'); } },
        { label: '回到标题页', onClick: () => A.backToTitle() },
        { label: '关闭' },
      ],
    });
  }

  Object.assign(A, {
    leaveTitle, renderTitle, renderChooser, openSaveMenu,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
