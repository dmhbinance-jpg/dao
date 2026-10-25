/**
 * 游戏界面 · bag
 * 背包页：技能卡背包、插卡 / 重掷 / 换卡、一键处理。
 * 共享状态和公共工具在 app-core.js（DAO.App）。
 * 对外（挂在 DAO.App 上）：bagPage、insertResultSpec、doAutoCards
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const UI = DAO.UI;
  const G = DAO.Game;
  const h = UI.h;
  const A = DAO.App;

  // ================= 背包页 =================
  function bagPage() {
    const wrap = h('div', { class: 'bag-page' });
    const acts = G.cardActions(A.save);
    const ci = A.save.cardsInfo;
    wrap.appendChild(h('div', { class: 'card bag-head' },
      h('div', null, h('h2', null, '背包 · 技能卡'),
        h('p', { class: 'muted' }, '散卡在背包里没有数值，插卡时才掷数值（档位 0–100）。同名卡再插一次 = 重掷，新旧两个数值自动保留好的那个；插另一张卡 = 换卡，旧卡销毁。卡只能插给对应定位的角色。')),
      h('div', { class: 'bag-tools' },
        h('button', { class: 'primary', disabled: !(acts.rerolls.length || acts.fills.length), onclick: doAutoCards }, `一键处理（重掷 ${acts.rerolls.length} · 插空槽 ${acts.fills.length}）`),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: A.save.settings.cardPrompts, onchange: (e) => { G.setSetting(A.save, 'cardPrompts', e.target.checked); A.persist(); } }), ' 拿到卡时让自动推关停下来提示'),
        h('small', { class: 'muted' }, `累计：插卡 ${ci.inserts} · 重掷 ${ci.rerolls} · 换卡 ${ci.replaces}`))));
    const ids = Object.keys(A.save.bag).filter((id) => A.save.bag[id] > 0);
    if (!ids.length) {
      wrap.appendChild(h('p', { class: 'muted' }, ci.firstGot ? '背包是空的。第二段的小怪会掉卡。' : '打完第一段首领会拿到第一张技能卡。'));
    }
    const grid = h('div', { class: 'bag-grid' });
    for (const id of ids) {
      const d = DAO.CONFIG.cards[id];
      const sk = DAO.Model.cardSkill({ id, roll: 0.5 });
      const users = A.save.roster.filter((c) => G.canUseCard(c, id));
      const item = h('div', { class: 'card bag-item' },
        h('div', { class: 'bi-head' }, A.cardQuality(id), h('b', null, d.name), h('span', { class: 'bi-count' }, '×' + A.save.bag[id])),
        h('div', { class: 'skill-row' }, h('span', null, A.cardSkillLine(id)), A.tagChips(sk.tags)),
        h('small', { class: 'muted' }, `主数值 ${A.cardRange(id)} · 可用：${A.cardRoles(id)}`));
      if (!users.length) item.appendChild(h('small', { class: 'muted' }, `暂时没有能用这张卡的角色（需要${A.cardRoles(id)}）。`));
      for (const c of users) {
        const pv = G.insertPreview(A.save, c.id, id);
        const hl = A.talentTagsOf(c);
        const match = sk.tags.some((t) => hl.has(t));
        const label = pv.mode === 'new' ? '插入' : pv.mode === 'reroll' ? `重掷（现 ${A.tierOf(c.card.roll)}）` : `换卡（销毁 ${A.cardName(c.card.id)}）`;
        item.appendChild(h('div', { class: 'bi-user' }, A.charGlyph(c),
          h('span', null, c.name, h('small', null, ` Lv${c.level}${match ? ' · 标签匹配' : ''}`)),
          h('button', { class: 'mini' + (pv.mode === 'replace' ? ' ghost' : ' primary'), onclick: () => openInsert(c.id, id) }, label)));
      }
      grid.appendChild(item);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  function openInsert(charId, cardId) {
    const c = G.getChar(A.save, charId);
    const pv = G.insertPreview(A.save, charId, cardId);
    if (!pv) return;
    if (pv.mode === 'replace') {
      A.showModal({
        title: '换卡',
        body: [`${c.name} 身上的「${A.cardName(pv.old.id)}」（${A.cardVal(pv.old.id, pv.old.roll)}，${A.tierOf(pv.old.roll)}）会被销毁，换成「${A.cardName(cardId)}」。`, `新卡插入时掷数值，范围 ${A.cardRange(cardId)}。确定吗？`],
        buttons: [{ label: '取消' }, { label: '确认换卡', primary: true, onClick: () => doInsert(charId, cardId) }],
      });
      return;
    }
    doInsert(charId, cardId);
  }

  function insertResultSpec(c, res) {
    const id = res.cardId;
    if (res.mode === 'reroll') {
      const box = (label, roll, kept) => h('div', { class: 'roll-box' + (kept ? ' kept' : '') }, h('small', null, label),
        h('b', null, A.cardVal(id, roll)), h('span', null, A.tierOf(roll)), kept ? h('span', { class: 'kept-mark' }, '保留') : h('span', { class: 'muted' }, '丢弃'));
      return {
        title: `重掷「${A.cardName(id)}」`,
        body: [`${c.name} 的同名卡再插一次：新旧两个数值保留好的那个。范围 ${A.cardRange(id)}。`],
        extra: h('div', { class: 'roll-compare' }, box('原来', res.old.roll, res.kept === 'old'), h('span', { class: 'vs-arrow' }, 'vs'), box('新掷', res.roll, res.kept === 'new')),
        buttons: [{ label: '好', primary: true }],
      };
    }
    const sk = DAO.Model.cardSkill({ id, roll: res.roll });
    const hl = A.talentTagsOf(c);
    const match = sk.tags.filter((t) => hl.has(t));
    return {
      title: res.mode === 'replace' ? `换上「${A.cardName(id)}」` : `插入「${A.cardName(id)}」`,
      body: [
        `${c.name} 掷出 ${A.cardVal(id, res.roll)}（${A.tierOf(res.roll)}，范围 ${A.cardRange(id)}）。`,
        res.mode === 'replace' ? `原来的「${A.cardName(res.old.id)}」已销毁。` : '',
        match.length ? `技能标签〔${match.join('·')}〕和 ${c.name} 的天赋对上了，伤害有加成。` : '',
        '这个技能开场就绪，在固有主动之前优先施放。',
      ].filter(Boolean),
      extra: h('div', { class: 'skill-row' }, h('span', null, A.skillDesc(sk)), A.tagChips(sk.tags, hl)),
      buttons: [{ label: '好', primary: true }],
    };
  }

  function doInsert(charId, cardId) {
    const c = G.getChar(A.save, charId);
    const res = G.insertCard(A.save, charId, cardId);
    if (!res) return;
    if (!G.cardActions(A.save).rerolls.length && !G.cardActions(A.save).fills.length) G.dismissCardPrompt(A.save);
    A.persist();
    A.showModal(insertResultSpec(c, res));
    A.render();
  }

  function doAutoCards() {
    const results = G.autoHandleCards(A.save);
    A.persist();
    if (results.length) {
      const lines = results.map((r) => {
        const c = G.getChar(A.save, r.charId);
        if (r.mode === 'reroll') return `${c.name}「${A.cardName(r.cardId)}」重掷：原 ${A.tierOf(r.old.roll)} vs 新 ${A.tierOf(r.roll)} → 保留${r.kept === 'new' ? '新' : '原'}值`;
        return `${c.name} 插入「${A.cardName(r.cardId)}」：${A.cardVal(r.cardId, r.roll)}（${A.tierOf(r.roll)}）`;
      });
      A.showModal({ title: '一键处理完成', body: lines, buttons: [{ label: '好', primary: true, onClick: () => A.step() }] });
    }
    A.render();
    if (!results.length) A.step();
  }

  Object.assign(A, {
    bagPage, insertResultSpec, doAutoCards,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
