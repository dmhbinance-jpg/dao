/**
 * 战斗播放：连续播放 1× / 2× / 4× / 跳过；行动条常驻；日志显示触发链。
 * 先用引擎一次性算完整场（record=true），再按日志条目回放快照。表现层与逻辑层完全分离。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});
  const UI = DAO.UI;
  const h = UI.h;

  const BASE_DELAY = { action: 700, round: 250, start: 400, trigger: 300, end: 0 };

  let rootEl, fieldEl, barEl, orderEl, logEl, statusEl, speedBtns = {};
  let result = null, units = [], idx = 0, timer = null, speed = 1, playing = false;
  let cardEls = {};

  function build() {
    UI.clear(rootEl);
    const seedInput = h('input', { type: 'number', value: UI.state.seed, min: 1, style: { width: '6em' }, onchange: (e) => { UI.state.seed = Number(e.target.value) || 1; UI.save(); } });
    const ctrl = h('div', { class: 'toolbar' },
      h('label', null, '种子 ', seedInput),
      h('button', { class: 'primary', onclick: () => { start(); } }, '开战'),
      h('button', { onclick: () => { UI.state.seed = (Number(seedInput.value) || 1) + 1; seedInput.value = UI.state.seed; UI.save(); start(); } }, '下一种子'),
      h('span', { class: 'sep' }),
      [1, 2, 4].map((s) => (speedBtns[s] = h('button', { class: 'speed', onclick: () => setSpeed(s) }, s + '×'))),
      h('button', { onclick: togglePause, id: 'pauseBtn' }, '暂停'),
      h('button', { onclick: skip }, '跳过'),
      (statusEl = h('span', { class: 'status' })));
    rootEl.appendChild(ctrl);

    barEl = h('div', { class: 'actionbar' });
    orderEl = h('div', { class: 'order' });
    rootEl.appendChild(h('div', { class: 'card bar-card' }, h('div', { class: 'bar-head' }, h('b', null, '行动条'), orderEl), barEl));

    fieldEl = h('div', { class: 'field-grid' });
    logEl = h('div', { class: 'log' });
    rootEl.appendChild(h('div', { class: 'player-grid' }, h('div', { class: 'card' }, fieldEl), h('div', { class: 'card log-card' }, h('b', null, '战斗日志'), logEl)));
    setSpeed(speed);
  }

  function setSpeed(s) {
    speed = s;
    for (const k in speedBtns) speedBtns[k].classList.toggle('on', Number(k) === s);
  }

  function start() {
    stop();
    const A = UI.lineup('A'), B = UI.lineup('B');
    const errs = DAO.Model.validateLineup(A).concat(DAO.Model.validateLineup(B));
    if (errs.length) { statusEl.textContent = '阵容不合法：' + errs.join('；'); return; }
    const battle = new DAO.Battle(A, B, { seed: UI.state.seed, record: true });
    result = battle.run();
    units = battle.units;
    idx = 0;
    buildField();
    UI.clear(logEl);
    playing = true;
    document.getElementById('pauseBtn').textContent = '暂停';
    step();
  }

  function stop() { if (timer) clearTimeout(timer); timer = null; playing = false; }

  function togglePause() {
    if (!result) return;
    const btn = document.getElementById('pauseBtn');
    if (playing) { stop(); btn.textContent = '继续'; }
    else if (idx < result.log.length) { playing = true; btn.textContent = '暂停'; step(); }
  }

  function skip() {
    if (!result) return;
    stop();
    while (idx < result.log.length) show(result.log[idx++], true);
    finish();
  }

  function step() {
    if (!playing || !result) return;
    if (idx >= result.log.length) { finish(); return; }
    const e = result.log[idx++];
    show(e, false);
    timer = setTimeout(step, (BASE_DELAY[e.type] || 300) / speed);
  }

  function finish() {
    playing = false;
    statusEl.textContent = (result.winner === 'draw' ? '平局' : result.winner + ' 方胜') + ` · ${result.rounds} 回合 · 种子 ${result.seed}`;
  }

  // ---------------- 场地 ----------------
  function buildField() {
    UI.clear(fieldEl);
    cardEls = {};
    // A 在左：后排 | 前排   B 在右：前排 | 后排
    const col = (side, row) => {
      const c = h('div', { class: `col col-${side} col-${row}` }, h('div', { class: 'col-label' }, `${side} ${UI.ROW_NAME[row]}`));
      for (const u of units.filter((x) => x.side === side && x.row === row)) {
        const el = unitCard(u);
        cardEls[u.uid] = el;
        c.appendChild(el.root);
      }
      return c;
    };
    fieldEl.appendChild(col('A', 'back'));
    fieldEl.appendChild(col('A', 'front'));
    fieldEl.appendChild(h('div', { class: 'vs' }, '对'));
    fieldEl.appendChild(col('B', 'front'));
    fieldEl.appendChild(col('B', 'back'));

    UI.clear(barEl);
    for (const u of units) {
      const m = h('div', { class: 'marker side-' + u.side, title: u.name }, u.name.slice(0, 2));
      cardEls[u.uid].marker = m;
      barEl.appendChild(m);
    }
    barEl.appendChild(h('div', { class: 'bar-end' }));
  }

  function unitCard(u) {
    const hp = h('div', { class: 'hp-fill' });
    const sh = h('div', { class: 'sh-fill' });
    const hpText = h('span', { class: 'hp-text' });
    const status = h('div', { class: 'u-status' });
    const cds = h('div', { class: 'u-cds' });
    const root = h('div', { class: 'unit side-' + u.side },
      h('div', { class: 'u-name' }, u.name, h('small', null, DAO.ROLE_NAMES[u.role])),
      h('div', { class: 'hp' }, hp, sh, hpText),
      cds, status);
    return { root, hp, sh, hpText, status, cds };
  }

  function applySnapshot(snap) {
    if (!snap) return;
    for (const u of units) {
      const s = snap[u.uid];
      const el = cardEls[u.uid];
      if (!s || !el) continue;
      el.root.classList.toggle('dead', !s.alive);
      el.hp.style.width = (100 * s.hp / s.maxHp) + '%';
      el.sh.style.width = Math.min(100, 100 * s.shield / s.maxHp) + '%';
      el.hpText.textContent = `${s.hp}/${s.maxHp}` + (s.shield ? ` +${s.shield}` : '');
      UI.clear(el.status);
      if (s.guard) el.status.appendChild(h('span', { class: 'st st-guard' }, '守护'));
      if (s.taunt) el.status.appendChild(h('span', { class: 'st st-taunt' }, '嘲讽'));
      for (const b of s.buffs) {
        el.status.appendChild(h('span', { class: 'st ' + (b.value > 0 ? 'st-buff' : 'st-debuff'), title: b.name },
          `${DAO.statLabel(b.stat)}${b.value > 0 ? '+' : ''}${DAO.fmtValue(b.value)}·${b.remaining}`));
      }
      UI.clear(el.cds);
      for (const sk of u.skills) {
        if (sk.key === 'basic') continue;
        const cd = s.cds[sk.key];
        el.cds.appendChild(h('span', { class: 'cd' + (cd ? '' : ' ready'), title: sk.name }, `${sk.name.split('·')[0]} ${cd ? 'CD' + cd : '就绪'}`));
      }
      el.marker.style.left = `calc(${Math.min(1, s.bar / DAO.CONFIG.actionBar.max) * 100}% - 14px)`;
      el.marker.classList.toggle('dead', !s.alive);
    }
    // 出手预览
    const max = DAO.CONFIG.actionBar.max;
    const order = units.filter((u) => snap[u.uid].alive)
      .map((u) => ({ u, t: Math.max(0, max - snap[u.uid].bar) / snap[u.uid].speed }))
      .sort((a, b) => a.t - b.t).slice(0, 6);
    UI.clear(orderEl);
    orderEl.appendChild(h('span', { class: 'muted' }, '接下来：'));
    order.forEach((o, i) => orderEl.appendChild(h('span', { class: 'ord side-' + o.u.side }, (i ? '→ ' : '') + o.u.name)));
  }

  function flash(entry) {
    for (const k in cardEls) cardEls[k].root.classList.remove('acting', 'hit', 'healed');
    if (entry.type !== 'action') return;
    const a = cardEls[entry.actor];
    if (a) a.root.classList.add('acting');
    for (const hit of entry.hits) {
      const t = cardEls[hit.target];
      if (!t) continue;
      t.root.classList.add('hit');
      pop(t.root, '−' + hit.dmg, hit.crit ? 'pop crit' : 'pop');
    }
    for (const hl of entry.heals) {
      const t = cardEls[hl.target];
      if (t && hl.amount) { t.root.classList.add('healed'); pop(t.root, '+' + hl.amount, 'pop heal'); }
    }
  }

  function pop(el, text, cls) {
    const p = h('span', { class: cls }, text);
    el.appendChild(p);
    setTimeout(() => p.remove(), 900);
  }

  function show(entry, fast) {
    if (!fast) { applySnapshot(entry.snapshot); flash(entry); }
    else if (entry.type === 'end') applySnapshot(entry.snapshot);
    const lines = DAO.BattleLog.formatEntry(entry, units);
    const block = h('div', { class: 'log-entry log-' + entry.type });
    for (const l of lines) block.appendChild(h('div', { class: `ll ll-${l.kind} d${l.depth}` + (l.side ? ' side-' + l.side : '') }, l.text));
    if (lines.length) {
      logEl.appendChild(block);
      if (!fast || entry.type === 'end') logEl.scrollTop = logEl.scrollHeight;
    }
    if (entry.type !== 'action' || !fast) statusEl.textContent = `第 ${entry.round} 回合`;
  }

  UI.Player = {
    mount(el) { rootEl = el; build(); },
    start,
    stop,
    hasResult: () => !!result,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
