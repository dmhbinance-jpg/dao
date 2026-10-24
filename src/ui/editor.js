/**
 * 阵容编辑：选人、前后排、2选1、技能卡与天赋档位。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});
  const UI = DAO.UI;
  const h = UI.h;

  const TALENT_STAT = { strPct: '力 %', agiPct: '敏 %', intPct: '智 %', hpPct: '气血 %', armorPct: '护甲 %', resistPct: '法抗 %', critRate: '暴击率', critDmg: '暴伤', finalDmg: '终伤', speed: '速度', dmgUp: '增伤', healUp: '治疗加成' };
  const TALENT_ZONE = { critRate: '暴击区', critDmg: '暴击区', finalDmg: '终伤区', dmgUp: '增伤区', armorPct: '防御区', resistPct: '防御区' };
  const EFFECT_TARGET = { self: '自身', target: '目标', hitTargets: '命中目标', allies: '全队', row: '同排', ally: '血最少队友', enemies: '敌方全体' };

  function describeEffects(s) {
    return (s.effects || []).map((e) => {
      const tgt = EFFECT_TARGET[e.target] || e.target;
      switch (e.kind) {
        case 'buff': return `${tgt} ${DAO.statLabel(e.stat)} +${DAO.fmtValue(e.value)}（${e.duration} 动）`;
        case 'debuff': return `${tgt} ${DAO.statLabel(e.stat)} −${DAO.fmtValue(Math.abs(e.value))}（${e.duration} 动）`;
        case 'guard': return `守护后排（${e.duration} 动）`;
        case 'taunt': return `嘲讽（${e.duration} 动）`;
        case 'shield': return `${tgt} 护盾 = 治疗强度 ×${e.value.toFixed(2)}`;
        case 'push': return `${tgt} 推条 +${Math.round(e.value)}`;
        case 'pull': return `${tgt} 拉条 −${Math.round(e.value)}`;
        default: return e.kind;
      }
    });
  }

  function skillLine(s, hlTags) {
    const bits = [DAO.SHAPE_NAMES[s.shape] || s.shape];
    if (s.dmgType === 'heal') bits.push(`治疗 ×${s.mult.toFixed(2)}`);
    else if (s.dmgType !== 'none') bits.push(`×${s.mult.toFixed(2)}`);
    if (s.shape === 'bounce') bits.push(`${s.bounces} 跳 · 衰减 ${s.bounceDecay}`);
    if (s.range === 'melee') bits.push(s.pierce ? '近战·穿透' : '近战');
    if (s.cd) bits.push(`CD ${s.cd}`);
    return h('div', { class: 'skill-line' },
      h('span', { class: 'skill-meta' }, bits.join(' · ')),
      describeEffects(s).map((t) => h('span', { class: 'skill-eff' }, t)),
      tagChips(s.tags, hlTags));
  }

  function tagChips(tags, hl) {
    return h('span', { class: 'tags' }, (tags || []).map((t) => h('span', { class: 'tag' + (hl && hl.has(t) ? ' on' : '') }, t)));
  }

  /** 角色身上所有「认标签」的东西 */
  function talentTagSet(o) {
    const set = new Set();
    for (const t of o.talents || []) {
      const d = DAO.CONFIG.talents[t.id];
      if (!d) continue;
      (d.tags || []).forEach((x) => set.add(x));
      (d.requireTags || []).forEach((x) => set.add(x));
      if (d.effect && d.effect.tags) d.effect.tags.forEach((x) => set.add(x));
    }
    const pc = o.passiveCard && DAO.CONFIG.cards[o.passiveCard.id];
    if (pc && pc.passive && pc.passive.tagDmgUp) pc.passive.tagDmgUp.tags.forEach((x) => set.add(x));
    return set;
  }

  // ================= 队伍面板 =================
  function teamPanel(side) {
    const st = UI.state;
    const lineup = st.lineups[side];
    const errs = DAO.Model.validateLineup(lineup);
    const used = new Set(lineup.map((e) => e.charId));
    const panel = h('div', { class: 'team team-' + side });
    panel.appendChild(h('div', { class: 'team-head' },
      h('h3', null, side + ' 队'),
      h('span', { class: 'muted' }, `${lineup.length}/${DAO.CONFIG.formation.teamSize} 人`)));

    for (const row of ['front', 'back']) {
      const slots = lineup.map((e, i) => ({ e, i })).filter((x) => x.e.row === row);
      const rowEl = h('div', { class: 'row-line' }, h('div', { class: 'row-label' }, UI.ROW_NAME[row], h('small', null, `${slots.length}/${DAO.CONFIG.formation.maxPerRow}`)));
      const cards = h('div', { class: 'row-cards' });
      for (const { e, i } of slots) {
        const sel = st.selected.side === side && st.selected.index === i;
        const o = e.override;
        cards.appendChild(h('div', {
          class: 'slot' + (sel ? ' sel' : ''),
          onclick: () => { st.selected = { side, index: i }; render(); },
        },
          h('div', { class: 'slot-name' }, o.name),
          h('div', { class: 'slot-title' }, o.title || DAO.ROLE_NAMES[o.role]),
          h('div', { class: 'slot-actions' },
            h('button', { class: 'mini', title: '换排', onclick: (ev) => { ev.stopPropagation(); e.row = e.row === 'front' ? 'back' : 'front'; UI.changed(); } }, '⇅'),
            h('button', { class: 'mini', title: '移除', onclick: (ev) => { ev.stopPropagation(); lineup.splice(i, 1); st.selected = { side, index: 0 }; UI.changed(); } }, '✕'))));
      }
      if (!slots.length) cards.appendChild(h('div', { class: 'slot empty' }, '空'));
      rowEl.appendChild(cards);
      panel.appendChild(rowEl);
    }

    if (lineup.length < DAO.CONFIG.formation.teamSize) {
      const avail = Object.entries(DAO.CONFIG.characters).filter(([id]) => !used.has(id));
      const selC = h('select', null, avail.map(([id, c]) => h('option', { value: id }, `${c.name} · ${c.title}`)));
      const selR = h('select', null, h('option', { value: 'front' }, '前排'), h('option', { value: 'back' }, '后排'));
      if (avail.length) {
        panel.appendChild(h('div', { class: 'add-line' }, selC, selR,
          h('button', { onclick: () => { lineup.push(UI.entryFor(selC.value, selR.value)); st.selected = { side, index: lineup.length - 1 }; UI.changed(); } }, '添加')));
      }
    }
    if (errs.length) panel.appendChild(h('div', { class: 'errors' }, errs.map((x) => h('div', null, '⚠ ' + x))));
    return panel;
  }

  // ================= 详情面板 =================
  function rollSlider(inst, def, onChange) {
    const out = h('span', { class: 'roll-val' });
    const show = () => {
      const v = DAO.Model.rollValue(def, inst.roll);
      out.textContent = `${UI.val(v, def.key)}（${UI.val(def.min, def.key)}–${UI.val(def.max, def.key)}，${Math.round(inst.roll * 100)} 档）`;
    };
    const input = h('input', {
      type: 'range', min: 0, max: 100, step: 1, value: Math.round((inst.roll == null ? 0.5 : inst.roll) * 100),
      oninput: (ev) => { inst.roll = Number(ev.target.value) / 100; show(); },
      onchange: () => onChange(),
    });
    show();
    return h('span', { class: 'roll' }, input, out);
  }

  function cardSlot(o, slot) {
    const C = DAO.CONFIG;
    const want = slot === 'activeCard' ? 'active' : 'passive';
    const options = Object.values(C.cards).filter((c) => c.slot === want && (!c.roles || c.roles.includes(o.role)));
    const cur = o[slot];
    const sel = h('select', {
      onchange: (ev) => { o[slot] = ev.target.value ? { id: ev.target.value, roll: 0.5 } : null; UI.changed(); },
    }, h('option', { value: '' }, '（空槽）'),
    options.map((c) => h('option', { value: c.id, selected: cur && cur.id === c.id }, `${UI.QUALITY_NAME[c.quality] || ''}·${c.name}`)));
    const body = [sel];
    if (cur && C.cards[cur.id]) {
      const card = C.cards[cur.id];
      body.push(rollSlider(cur, card.roll, () => UI.changed()));
      if (card.skill) body.push(skillLine(DAO.Model.cardSkill(cur), talentTagSet(o)));
      if (card.passive) {
        const p = card.passive;
        body.push(h('div', { class: 'skill-line' }, h('span', { class: 'skill-meta' },
          p.tagDmgUp ? `〔${p.tagDmgUp.tags.join('·')}〕增伤（主数值）` : `${DAO.statLabel(p.stat)}（主数值）`)));
      }
      if (card.trigger) body.push(h('div', { class: 'skill-line trig' }, `橙卡特效：${card.trigger.name}（${card.trigger.desc || ''}，固定）`));
    }
    return h('div', { class: 'field' }, h('label', null, slot === 'activeCard' ? '主动卡槽' : '被动卡槽'), h('div', null, body));
  }

  function talentRows(o) {
    const C = DAO.CONFIG;
    const rows = [];
    const triggers = (o.talents || []).filter((t) => C.talents[t.id] && C.talents[t.id].tier === 'trigger').length;
    (o.talents || []).forEach((t, i) => {
      const def = C.talents[t.id];
      const groups = ['stat', 'tag', 'trigger'].map((tier) => h('optgroup', { label: UI.TIER_NAME[tier] },
        Object.entries(C.talents).filter(([, d]) => d.tier === tier && (!d.exclusive || d.exclusive === o.id))
          .map(([id, d]) => h('option', { value: id, selected: id === t.id }, d.name))));
      const sel = h('select', { onchange: (ev) => { o.talents[i] = { id: ev.target.value, roll: 0.5 }; UI.changed(); } }, groups);
      const parts = [sel];
      if (def) {
        parts.push(h('span', { class: 'tier tier-' + def.tier }, UI.TIER_NAME[def.tier]));
        if (def.min !== def.max) parts.push(rollSlider(t, { min: def.min, max: def.max }, () => UI.changed()));
        parts.push(h('span', { class: 'muted' }, def.desc || (def.tier === 'tag' ? `〔${def.tags.join('·')}〕增伤（增伤区）` : `${TALENT_STAT[def.stat] || DAO.statLabel(def.stat)}（${TALENT_ZONE[def.stat] || '属性'}）`)));
      }
      parts.push(h('button', { class: 'mini', onclick: () => { o.talents.splice(i, 1); UI.changed(); } }, '✕'));
      rows.push(h('div', { class: 'talent-row' }, parts));
    });
    if ((o.talents || []).length < 3) {
      rows.push(h('button', { onclick: () => { (o.talents = o.talents || []).push({ id: 'li', roll: 0.5 }); UI.changed(); } }, '＋ 天赋'));
    }
    if (triggers > 1) rows.push(h('div', { class: 'errors' }, '⚠ 每角色最多一条触发型天赋，多出的不生效'));
    return rows;
  }

  function statsBlock(o) {
    const u = DAO.Model.buildUnit(o, 'A', 'front', 0, o.id);
    const b = u.base;
    const items = [
      ['气血', UI.num(b.maxHp)], ['物攻', UI.num(b.pAtk)], ['法攻', UI.num(b.mAtk)], ['治疗强度', UI.num(b.healPower)],
      ['护甲', UI.num(b.armor)], ['法抗', UI.num(b.resist)], ['速度', b.speed.toFixed(1)],
      ['暴击率', UI.pct(b.critRate)], ['暴伤', '×' + b.critDmg.toFixed(2)],
    ];
    if (u.mods.finalDmg) items.push(['终伤', '+' + UI.pct(u.mods.finalDmg)]);
    return h('div', { class: 'stat-grid' }, items.map(([k, v]) => h('div', null, h('span', null, k), h('b', null, v))));
  }

  function detailPanel() {
    const st = UI.state;
    const lineup = st.lineups[st.selected.side] || [];
    const e = lineup[st.selected.index];
    const panel = h('div', { class: 'detail card' });
    if (!e) return h('div', { class: 'detail card muted' }, '点一个角色查看和编辑');
    const o = e.override;
    o.id = e.charId;
    const C = DAO.CONFIG;
    const hl = talentTagSet(o);

    panel.appendChild(h('div', { class: 'detail-head' },
      h('h3', null, o.name, h('small', null, ` ${o.title || ''} · ${DAO.ROLE_NAMES[o.role]} · ${st.selected.side} 队${UI.ROW_NAME[e.row]}`)),
      h('button', { class: 'mini', onclick: () => { e.override = JSON.parse(JSON.stringify(C.characters[e.charId])); UI.changed(); } }, '恢复模板')));

    // 三维
    panel.appendChild(h('div', { class: 'field' }, h('label', null, '三维（含等级）'),
      h('div', { class: 'triad' }, ['str', 'agi', 'int'].map((k) => h('span', null, { str: '力', agi: '敏', int: '智' }[k],
        h('input', { type: 'number', value: o.stats[k], min: 0, step: 5, onchange: (ev) => { o.stats[k] = Number(ev.target.value) || 0; UI.changed(); } }))))));
    panel.appendChild(statsBlock(o));

    // 普攻
    panel.appendChild(h('div', { class: 'field' }, h('label', null, '普攻'),
      h('div', null, h('b', null, C.basicSkills[o.role].name), skillLine(DAO.Model.basicSkill(o.role), hl))));

    // 固有主动 2选1
    const inn = C.innateSkills[o.innate];
    if (inn) {
      panel.appendChild(h('div', { class: 'field' }, h('label', null, '固有主动 · 2选1'),
        h('div', { class: 'branches' }, inn.variants.map((v, bi) => h('label', { class: 'branch' + ((o.branch || 0) === bi ? ' on' : '') },
          h('input', { type: 'radio', name: 'branch', checked: (o.branch || 0) === bi, onchange: () => { o.branch = bi; UI.changed(); } }),
          h('b', null, (bi ? 'B ' : 'A ') + v.name),
          skillLine(DAO.Model.innateSkill(o.innate, bi), hl))))));
    }

    panel.appendChild(cardSlot(o, 'activeCard'));
    panel.appendChild(cardSlot(o, 'passiveCard'));
    panel.appendChild(h('div', { class: 'field' }, h('label', null, '天赋（1–3 条）'), h('div', null, talentRows(o))));
    return panel;
  }

  let rootEl;
  function render() {
    if (!rootEl) return;
    UI.clear(rootEl);
    rootEl.appendChild(h('div', { class: 'toolbar' },
      h('span', { class: 'muted' }, '改动自动保存在本机。技能标签与天赋标签匹配时高亮。'),
      h('button', { onclick: () => { UI.resetLineups(); UI.changed(); } }, '恢复默认阵容'),
      h('button', { onclick: () => { const t = UI.state.lineups.A; UI.state.lineups.A = UI.state.lineups.B; UI.state.lineups.B = t; UI.changed(); } }, 'A ⇄ B')));
    rootEl.appendChild(h('div', { class: 'editor-grid' },
      h('div', { class: 'teams' }, teamPanel('A'), teamPanel('B')),
      detailPanel()));
  }

  UI.Editor = {
    mount(el) { rootEl = el; render(); UI.onChange(render); },
    render,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
