/**
 * 批量模拟页：不同种子跑 N 场，分块执行不卡界面。
 * 输出胜率、平均回合、伤害占比、触发次数、辅助贡献、技能稳定性。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});
  const UI = DAO.UI;
  const h = UI.h;

  let rootEl, outEl, progEl, running = false;

  function build() {
    UI.clear(rootEl);
    const runs = h('input', { type: 'number', value: UI.state.runs, min: 10, step: 100, style: { width: '6em' }, onchange: (e) => { UI.state.runs = Number(e.target.value) || 100; UI.save(); } });
    const seed = h('input', { type: 'number', value: 1, min: 1, style: { width: '6em' } });
    const swap = h('input', { type: 'checkbox', checked: true });
    rootEl.appendChild(h('div', { class: 'toolbar' },
      h('label', null, '场数 ', runs),
      h('label', null, '起始种子 ', seed),
      h('label', { title: '奇数场交换左右，抵消同速先后手偏差' }, swap, ' 换边'),
      h('button', { class: 'primary', onclick: () => run(Number(runs.value) || 100, Number(seed.value) || 1, swap.checked) }, '运行'),
      (progEl = h('span', { class: 'status' }))));
    outEl = h('div');
    rootEl.appendChild(outEl);
  }

  function run(N, seedBase, swapSides) {
    if (running) return;
    const A = UI.lineup('A'), B = UI.lineup('B');
    const errs = DAO.Model.validateLineup(A).concat(DAO.Model.validateLineup(B));
    if (errs.length) { progEl.textContent = '阵容不合法：' + errs.join('；'); return; }
    running = true;
    const agg = DAO.Sim.newAgg();
    const opts = { seedBase, swapSides };
    const t0 = performance.now();
    let i = 0;
    const chunk = () => {
      const end = Math.min(N, i + 50);
      for (; i < end; i++) DAO.Sim.runInto(agg, A, B, i, opts);
      progEl.textContent = `${i}/${N}`;
      if (i < N) setTimeout(chunk, 0);
      else {
        running = false;
        progEl.textContent = `完成 ${N} 场，${Math.round(performance.now() - t0)} ms`;
        render(DAO.Sim.summarize(agg));
      }
    };
    chunk();
  }

  function bar(v, cls) {
    return h('div', { class: 'mini-bar' }, h('div', { class: 'mini-fill ' + (cls || ''), style: { width: Math.max(0, Math.min(100, v * 100)) + '%' } }));
  }

  function render(s) {
    UI.clear(outEl);
    // 胜率
    outEl.appendChild(h('div', { class: 'card' },
      h('div', { class: 'win-head' },
        h('div', null, h('span', { class: 'big side-A' }, UI.pct(s.winRate.A)), h('small', null, ' A 胜')),
        h('div', null, h('span', { class: 'big muted' }, UI.pct(s.winRate.draw)), h('small', null, ' 平局')),
        h('div', null, h('span', { class: 'big side-B' }, UI.pct(s.winRate.B)), h('small', null, ' B 胜')),
        h('div', null, h('span', { class: 'big' }, s.avgRounds.toFixed(1)), h('small', null, ` 平均回合（中位 ${s.medianRounds}）`))),
      h('div', { class: 'win-bar' },
        h('div', { class: 'wb-A', style: { width: s.winRate.A * 100 + '%' } }),
        h('div', { class: 'wb-D', style: { width: s.winRate.draw * 100 + '%' } }),
        h('div', { class: 'wb-B', style: { width: s.winRate.B * 100 + '%' } }))));

    // 单位表
    const head = ['角色', '排', '伤害占比', '场均伤害', '溢出', '存活', '行动', '再动', '暴击', '击杀', '治疗', '护盾吸收', '减伤贡献', '破甲贡献', '增伤贡献', '代受', '触发'];
    const table = h('table', { class: 'data' }, h('thead', null, h('tr', null, head.map((x) => h('th', null, x)))));
    const tb = h('tbody');
    for (const side of ['A', 'B']) {
      tb.appendChild(h('tr', { class: 'grp' }, h('td', { colspan: head.length }, `${side} 队 · 场均有效伤害 ${UI.num(s.sideDmg[side])}`)));
      for (const u of s.units.filter((x) => x.side === side)) {
        const z = (v) => (v > 0.5 ? UI.num(v) : '—');
        tb.appendChild(h('tr', null,
          h('td', null, h('b', null, u.name), h('small', { class: 'muted' }, ' ' + (u.title || ''))),
          h('td', null, UI.ROW_NAME[u.row]),
          h('td', null, h('div', { class: 'share' }, bar(u.dmgShare, 'side-' + side), UI.pct(u.dmgShare))),
          h('td', null, UI.num(u.dmg)),
          h('td', null, UI.pct(u.overkillPct, 0)),
          h('td', null, UI.pct(u.survival, 0)),
          h('td', null, u.actions.toFixed(1)),
          h('td', null, u.extraActions ? u.extraActions.toFixed(2) : '—'),
          h('td', null, u.crits.toFixed(1)),
          h('td', null, u.kills.toFixed(2)),
          h('td', null, z(u.heal)),
          h('td', null, z(u.shieldAbsorbed)),
          h('td', null, z(u.armorBuff)),
          h('td', null, z(u.armorBreak)),
          h('td', null, z(u.dmgBuff)),
          h('td', null, u.redirected > 0.05 ? u.redirected.toFixed(1) : '—'),
          h('td', null, Object.entries(u.triggers).map(([k, v]) => h('div', { class: 'trig-cell' }, `${k} ×${v.toFixed(2)}`)))));
      }
    }
    table.appendChild(tb);
    outEl.appendChild(h('div', { class: 'card scroll-x' }, h('b', null, '角色'), table));

    // 技能表
    const sh = ['角色', '技能', '形状', '场均施放', '每次伤害', '每次命中', '变异系数 CV', '占本人伤害', '每次治疗'];
    const st = h('table', { class: 'data' }, h('thead', null, h('tr', null, sh.map((x) => h('th', null, x)))));
    const sb = h('tbody');
    for (const u of s.units) {
      for (const k of u.skills.slice().sort((a, b) => b.castsPerBattle - a.castsPerBattle)) {
        sb.appendChild(h('tr', null,
          h('td', { class: 'side-' + u.side }, u.name),
          h('td', null, k.name),
          h('td', null, DAO.SHAPE_NAMES[k.shape] || k.shape),
          h('td', null, k.castsPerBattle.toFixed(1)),
          h('td', null, k.dmgPerCast > 0.5 ? UI.num(k.dmgPerCast) : '—'),
          h('td', null, k.hitsPerCast.toFixed(2)),
          h('td', null, k.dmgPerCast > 0.5 ? k.cv.toFixed(2) : '—'),
          h('td', null, k.dmgShareOfUnit ? UI.pct(k.dmgShareOfUnit, 0) : '—'),
          h('td', null, k.healPerCast > 0.5 ? UI.num(k.healPerCast) : '—')));
      }
    }
    st.appendChild(sb);
    outEl.appendChild(h('div', { class: 'card scroll-x' }, h('b', null, '技能'), h('p', { class: 'muted' }, 'CV = 每次施放伤害的标准差 / 均值，越小越稳。'), st));

    const trig = Object.entries(s.triggers);
    outEl.appendChild(h('div', { class: 'card' }, h('b', null, '触发次数（场均）'),
      trig.length ? h('div', { class: 'trig-list' }, trig.map(([k, v]) => h('span', { class: 'chip' }, `${k} ${v.toFixed(2)}`))) : h('p', { class: 'muted' }, '无'),
      h('p', { class: 'muted' }, `递归保护拦截：场均 ${s.recursionBlocked.toFixed(2)} 次 · 回合上限平局 ${s.timeouts} 场`)));
  }

  UI.Batch = { mount(el) { rootEl = el; build(); } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
