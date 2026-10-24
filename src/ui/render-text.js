/**
 * 文字渲染器：渲染器接口（见 battle/replay.js）的第一个实现。
 * 场地卡片（头像位 / 血条 / 护盾 / CD / 状态）、常驻行动条、出手顺序预览、文字日志。
 * 只读时间线的 units、事件和快照；不碰战斗逻辑，也不改时间线。
 *
 *   const r = UI.createTextRenderer({ field, bar, order, log, status }, { sideNames })
 *   r.mount(timeline) / r.beat(beat, { fast }) / r.end(timeline)
 * 头像位用 UI.artBox：资源清单里有图就显示图，没有（目前全是占位）就退回文字色块。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});
  const UI = DAO.UI;
  const h = UI.h;

  UI.createTextRenderer = function (els, opts) {
    opts = opts || {};
    const sideNames = opts.sideNames || { A: 'A', B: 'B' };
    let tl = null, cards = {};

    function mount(timeline) {
      tl = timeline;
      buildField();
      UI.clear(els.log);
      const first = DAO.Replay.beats(tl)[0];
      if (first && first.snapshot) applySnapshot(first.snapshot);
    }

    function buildField() {
      UI.clear(els.field);
      cards = {};
      // 左：A 后排 | A 前排   右：B 前排 | B 后排；空的一列不画
      const cols = [];
      const col = (side, row) => {
        const list = tl.units.filter((x) => x.side === side && x.row === row);
        if (!list.length) return null;
        const c = h('div', { class: `col col-${side} col-${row}` }, h('div', { class: 'col-label' }, `${sideNames[side]} ${UI.ROW_NAME[row]}`));
        for (const u of list) {
          const el = unitCard(u);
          cards[u.uid] = el;
          c.appendChild(el.root);
        }
        return c;
      };
      [col('A', 'back'), col('A', 'front')].forEach((c) => c && cols.push(c));
      cols.push(h('div', { class: 'vs' }, '对'));
      [col('B', 'front'), col('B', 'back')].forEach((c) => c && cols.push(c));
      els.field.style.setProperty('--cols', cols.map((c) => (c.classList.contains('vs') ? '28px' : 'minmax(0, 1fr)')).join(' '));
      cols.forEach((c) => els.field.appendChild(c));

      UI.clear(els.bar);
      for (const u of tl.units) {
        const m = h('div', { class: 'marker side-' + u.side, title: u.name }, u.name.slice(0, 2));
        cards[u.uid].marker = m;
        els.bar.appendChild(m);
      }
      els.bar.appendChild(h('div', { class: 'bar-end' }));
    }

    function unitCard(u) {
      const hp = h('div', { class: 'hp-fill' });
      const sh = h('div', { class: 'sh-fill' });
      const hpText = h('span', { class: 'hp-text' });
      const status = h('div', { class: 'u-status' });
      const cds = h('div', { class: 'u-cds' });
      const label = (u.title && u.title !== DAO.ROLE_NAMES[u.role] ? u.title : DAO.ROLE_NAMES[u.role]) + (u.level ? ` Lv${u.level}` : '');
      const rootEl = h('div', { class: 'unit side-' + u.side },
        h('div', { class: 'u-head' }, UI.artBox(u.art, { use: 'portrait', text: u.name.slice(0, 1), cls: 'u-art side-' + u.side, title: u.name }),
          h('div', { class: 'u-name' }, u.name, h('small', null, label))),
        h('div', { class: 'hp' }, hp, sh, hpText),
        cds, status);
      return { root: rootEl, hp, sh, hpText, status, cds };
    }

    function applySnapshot(snap) {
      if (!snap) return;
      for (const u of tl.units) {
        const s = snap[u.uid];
        const el = cards[u.uid];
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
      const order = tl.units.filter((u) => snap[u.uid].alive)
        .map((u) => ({ u, t: Math.max(0, max - snap[u.uid].bar) / snap[u.uid].speed }))
        .sort((a, b) => a.t - b.t).slice(0, 6);
      UI.clear(els.order);
      els.order.appendChild(h('span', { class: 'muted' }, '接下来：'));
      order.forEach((o, i) => els.order.appendChild(h('span', { class: 'ord side-' + o.u.side }, (i ? '→ ' : '') + o.u.name)));
    }

    /** 出手 / 受击 / 回复的闪烁和飘字（每次命中一个飘字） */
    function flash(beat) {
      for (const k in cards) cards[k].root.classList.remove('acting', 'hit', 'healed');
      if (beat.root.type !== 'action') return;
      const a = cards[beat.root.actor];
      if (a) a.root.classList.add('acting');
      for (const e of beat.events) {
        const t = cards[e.target];
        if (!t) continue;
        if (e.type === 'hit') { t.root.classList.add('hit'); pop(t.root, '−' + e.dmg, e.crit ? 'pop crit' : 'pop'); }
        else if (e.type === 'heal' && e.amount) { t.root.classList.add('healed'); pop(t.root, '+' + e.amount, 'pop heal'); }
      }
    }
    function pop(el, text, cls) {
      const p = h('span', { class: cls }, text);
      el.appendChild(p);
      setTimeout(() => p.remove(), 900);
    }

    function beat(b, o) {
      const fast = o && o.fast;
      if (!fast) { applySnapshot(b.snapshot); flash(b); }
      else if (b.root.type === 'battleEnd') applySnapshot(b.snapshot);
      const lines = DAO.BattleLog.formatBeat(b, tl, { sideNames: opts.sideNames });
      if (lines.length) {
        const block = h('div', { class: 'log-entry log-' + b.root.type });
        for (const l of lines) block.appendChild(h('div', { class: `ll ll-${l.kind} d${l.depth}` + (l.side ? ' side-' + l.side : '') }, l.text));
        els.log.appendChild(block);
        if (!fast || b.root.type === 'battleEnd') els.log.scrollTop = els.log.scrollHeight;
      }
      if (els.status && (b.root.type !== 'action' || !fast)) els.status.textContent = `第 ${b.root.round} 回合`;
    }

    function end(timeline) {
      if (els.status) els.status.textContent = (timeline.winner === 'draw' ? '平局' : (sideNames[timeline.winner] || timeline.winner) + '胜') + ` · ${timeline.rounds} 回合 · 种子 ${timeline.seed}`;
    }

    return { mount, beat, end, destroy() {} };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
