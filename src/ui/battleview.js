/**
 * 战斗回放组件：场地、常驻行动条、出手预览、触发链日志、1× / 2× / 4× / 暂停 / 跳过。
 * V0 模拟器和阶段 0 共用。只读 Battle.run() 的日志和快照，不碰战斗逻辑。
 *
 *   const view = UI.createBattleView(container, { controls: [...额外按钮], sideNames: {A,B}, onEnd(result) })
 *   view.play(result, units)   // result.log 必须是 record=true 跑出来的
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});
  const UI = DAO.UI;
  const h = UI.h;

  UI.createBattleView = function (container, opts) {
    opts = opts || {};
    const store = opts.store || UI.store;
    const sideNames = opts.sideNames || { A: 'A', B: 'B' };
    let fieldEl, barEl, orderEl, logEl, statusEl, pauseBtn;
    const speedBtns = {};
    let result = null, units = [], idx = 0, timer = null, playing = false, ended = false;
    let speed = store.get('speed', 1);
    let cardEls = {};

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
    barEl = h('div', { class: 'actionbar' });
    orderEl = h('div', { class: 'order' });
    container.appendChild(h('div', { class: 'card bar-card' }, h('div', { class: 'bar-head' }, h('b', null, '行动条'), orderEl), barEl));
    fieldEl = h('div', { class: 'field-grid' });
    logEl = h('div', { class: 'log' });
    container.appendChild(h('div', { class: 'player-grid' },
      h('div', { class: 'card' }, fieldEl),
      h('div', { class: 'card log-card' }, h('b', null, '战斗日志'), logEl)));
    setSpeed(speed);

    function setSpeed(s) {
      speed = s;
      store.set('speed', s);
      for (const k in speedBtns) speedBtns[k].classList.toggle('on', Number(k) === s);
    }

    function play(res, us) {
      stop();
      result = res;
      units = us;
      idx = 0;
      ended = false;
      buildField();
      UI.clear(logEl);
      playing = true;
      pauseBtn.textContent = '暂停';
      step();
    }

    function stop() { if (timer) clearTimeout(timer); timer = null; playing = false; }

    function togglePause() {
      if (!result || ended) return;
      if (playing) { stop(); pauseBtn.textContent = '继续'; }
      else { playing = true; pauseBtn.textContent = '暂停'; step(); }
    }

    function skip() {
      if (!result || ended) return;
      stop();
      while (idx < result.log.length) show(result.log[idx++], true);
      finish();
    }

    function step() {
      if (!playing || !result) return;
      if (idx >= result.log.length) { finish(); return; }
      const e = result.log[idx++];
      show(e, false);
      timer = setTimeout(step, (DAO.CONFIG.playback[e.type] || 300) / speed);
    }

    function finish() {
      if (ended) return;
      ended = true;
      playing = false;
      statusEl.textContent = (result.winner === 'draw' ? '平局' : (sideNames[result.winner] || result.winner) + '胜') + ` · ${result.rounds} 回合 · 种子 ${result.seed}`;
      if (opts.onEnd) opts.onEnd(result);
    }

    // ---------- 场地 ----------
    function buildField() {
      UI.clear(fieldEl);
      cardEls = {};
      // 左：A 后排 | A 前排   右：B 前排 | B 后排；空的一列不画
      const cols = [];
      const col = (side, row) => {
        const list = units.filter((x) => x.side === side && x.row === row);
        if (!list.length) return null;
        const c = h('div', { class: `col col-${side} col-${row}` }, h('div', { class: 'col-label' }, `${sideNames[side]} ${UI.ROW_NAME[row]}`));
        for (const u of list) {
          const el = unitCard(u);
          cardEls[u.uid] = el;
          c.appendChild(el.root);
        }
        return c;
      };
      [col('A', 'back'), col('A', 'front')].forEach((c) => c && cols.push(c));
      cols.push(h('div', { class: 'vs' }, '对'));
      [col('B', 'front'), col('B', 'back')].forEach((c) => c && cols.push(c));
      fieldEl.style.setProperty('--cols', cols.map((c) => (c.classList.contains('vs') ? '28px' : 'minmax(0, 1fr)')).join(' '));
      cols.forEach((c) => fieldEl.appendChild(c));

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
      const label = (u.title && u.title !== DAO.ROLE_NAMES[u.role] ? u.title : DAO.ROLE_NAMES[u.role]) + (u.level ? ` Lv${u.level}` : '');
      const rootEl = h('div', { class: 'unit side-' + u.side },
        h('div', { class: 'u-name' }, u.name, h('small', null, label)),
        h('div', { class: 'hp' }, hp, sh, hpText),
        cds, status);
      return { root: rootEl, hp, sh, hpText, status, cds };
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
      if (entry.type === 'end' && opts.sideNames) {
        lines.forEach((l) => { if (l.kind === 'end') l.text = entry.winner === 'draw' ? '== 平局 ==' : `== ${sideNames[entry.winner]}胜 ==`; });
      }
      const block = h('div', { class: 'log-entry log-' + entry.type });
      for (const l of lines) block.appendChild(h('div', { class: `ll ll-${l.kind} d${l.depth}` + (l.side ? ' side-' + l.side : '') }, l.text));
      if (lines.length) {
        logEl.appendChild(block);
        if (!fast || entry.type === 'end') logEl.scrollTop = logEl.scrollHeight;
      }
      if (entry.type !== 'action' || !fast) statusEl.textContent = `第 ${entry.round} 回合`;
    }

    return {
      play, stop, skip,
      isPlaying: () => playing,
      hasResult: () => !!result,
      isEnded: () => ended,
      setStatus: (t) => { statusEl.textContent = t; },
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
