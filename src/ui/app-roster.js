/**
 * 游戏界面 · roster
 * 角色页：角色卡片、卡槽 / 装备槽、角色操作（上阵 / 下阵 / 采集 / 召回 / 遣散）、布阵、穿装备。
 * 共享状态和公共工具在 app-core.js（DAO.App）。
 * 对外（挂在 DAO.App 上）：openEquipFor、charCard、rosterPage
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const UI = DAO.UI;
  const G = DAO.Game;
  const h = UI.h;
  const A = DAO.App;

  /** 选一个角色穿上这件 */
  function openEquipFor(item) {
    const list = h('div', { class: 'swap-list' }, A.save.roster.map((c) => {
      const cur = c.equip[item.slot];
      return h('button', { class: 'mini', onclick: () => { A.adhoc = null; G.equip(A.save, c.id, item.id); A.toast(`${c.name} 穿上 ${G.gearName(item)}`); A.changed(); } },
        `${c.name} Lv${c.level}${cur ? `（换下 ${G.gearName(cur)}）` : '（空）'}`);
    }));
    A.showModal({ title: `穿上 ${G.gearName(item)}`, body: [A.gearStatText(G.gearStats(item))], extra: list, buttons: [{ label: '取消' }] });
  }
  /** 给角色的某个部位挑一件：背包里的，或别的角色身上的 */
  function openSlotChooser(c, slot) {
    const opts = [];
    for (const it of A.save.gearBag) if (it.slot === slot && G.gearUsable(it)) opts.push({ it, from: null });
    for (const o of A.save.roster) if (o.id !== c.id && o.equip[slot]) opts.push({ it: o.equip[slot], from: o });
    opts.sort((a, b) => G.gearRank(b.it) - G.gearRank(a.it));
    const list = h('div', { class: 'gear-choose' }, opts.length ? opts.map(({ it, from }) => h('button', { class: 'gear-opt', onclick: () => { A.adhoc = null; G.equip(A.save, c.id, it.id); A.toast(`${c.name} 穿上 ${G.gearName(it)}${from ? `（从 ${from.name} 身上换来）` : ''}`); A.changed(); } },
      A.gearLine(it), h('small', null, ` ${A.gearStatText(G.gearStats(it))}${from ? ` · 在 ${from.name} 身上` : ' · 背包'}`)))
      : h('p', { class: 'muted' }, `没有可穿的${A.SLOT_NAME()[slot]}。去洞府的${G.buildingDef(G.craftBuilding(G.lineOfSlot(slot))).name}打造。`));
    A.showModal({ title: `${c.name} · ${A.SLOT_NAME()[slot]}`, body: [c.equip[slot] ? `现在：${G.gearName(c.equip[slot])}（${A.gearStatText(G.gearStats(c.equip[slot]))}），换下的回背包。` : '这个部位还空着。'], extra: list,
      buttons: [{ label: '取消' }].concat(A.save.unlocks.cave ? [{ label: '去' + G.buildingDef(G.craftBuilding(G.lineOfSlot(slot))).name, onClick: () => { A.selectCraftSlot(slot); A.tab = 'cave'; A.render(); } }] : []) });
  }

  // ================= 角色页 =================
  function charCard(c, opts) {
    opts = opts || {};
    const u = G.charUnit(c);
    const stt = A.save.roster.includes(c) ? G.status(A.save, c.id) : 'new';
    const need = G.expToNext(c.level);
    const card = h('div', { class: 'char-card st-' + stt },
      h('div', { class: 'cc-head' }, A.charGlyph(c),
        h('div', { class: 'cc-name' }, h('b', null, c.name), h('small', null, `${DAO.ROLE_NAMES[c.role]} · `, A.qualityBadge(c.quality))),
        h('div', { class: 'lv' }, h('small', null, '等级'), h('b', null, c.level))),
      h('div', { class: 'expbar' }, h('div', { class: 'exp-fill', style: { width: (100 * c.exp / need) + '%' } }), h('span', null, `经验 ${c.exp} / ${need}`)),
      h('div', { class: 'triad-grid' }, ['str', 'agi', 'int'].map((k) => h('div', null,
        h('span', null, A.STAT_NAME[k]), h('b', null, Math.round(u.base[k])), h('small', null, `+${c.growth[k]}/级`)))),
      opts.compact ? null : h('div', { class: 'kv-grid' }, A.statRows(u, c.role).map(([k, v]) => h('div', null, h('span', null, k), h('b', null, v)))),
      h('div', { class: 'cc-skills' }, u.skills.filter((s) => s.key !== 'basic').map((s) => h('div', { class: 'skill-row' }, h('b', null, s.name), h('span', null, A.skillDesc(s))))),
      h('div', { class: 'cc-talents' }, c.talents.map((t) => h('div', { class: 'talent-line ' + A.tierClass(t) }, A.talentDesc(t)))),
      cardSlotView(c),
      gearSlotsView(c),
      h('small', { class: 'muted' }, `资质 ×${G.aptitude(c).toFixed(2)}（相对开局角色）${A.save.unlocks.forge ? ` · 采集 ${G.gatherRate(c).toFixed(2)}/秒` : ''}`));
    if (!opts.compact && A.save.roster.includes(c)) card.appendChild(charActions(c));
    return card;
  }

  function cardSlotView(c) {
    if (!A.save.cardsInfo || (!A.save.cardsInfo.firstGot && !c.card)) return null;
    const hl = A.talentTagsOf(c);
    if (!c.card) return h('div', { class: 'card-slot empty' }, h('span', { class: 'cs-label' }, '主动卡槽'), h('span', { class: 'muted' }, '空'),
      A.save.roster.includes(c) && Object.keys(A.save.bag).some((id) => G.canUseCard(c, id)) ? h('button', { class: 'mini', onclick: () => { A.tab = 'bag'; A.render(); } }, '去背包插卡') : null);
    const sk = DAO.Model.cardSkill(c.card);
    return h('div', { class: 'card-slot' },
      h('div', { class: 'cs-top' }, UI.artBox(DAO.CONFIG.cards[c.card.id].art, { use: 'icon', text: '主动卡槽', cls: 'cs-label card-icon', title: A.cardName(c.card.id) }), A.cardQuality(c.card.id), h('b', null, A.cardName(c.card.id)),
        h('span', { class: 'cs-val' }, `${A.cardVal(c.card.id, c.card.roll)} · ${A.tierOf(c.card.roll)}`)),
      h('div', { class: 'skill-row' }, h('span', null, A.skillDesc(sk)), A.tagChips(sk.tags, hl)));
  }

  function gearSlotsView(c) {
    if (!A.save.unlocks.forge || !c.equip) return null;
    const mine = A.save.roster.includes(c);
    if (!mine) return null;   // 招募候选 / 待定新人没有装备
    return h('div', { class: 'gear-slots' }, G.gearSlots().map((slot) => {
      const it = c.equip[slot];
      const open = G.slotUnlocked(A.save, slot);
      if (!open && !it) {
        const ln = DAO.CONFIG.game.production.lines[G.lineOfSlot(slot)];
        return h('div', { class: 'gear-slot empty locked' },
          UI.artBox(G.recipe(slot).art, { use: 'icon', text: A.SLOT_NAME()[slot], cls: 'cs-label gear-icon', title: A.SLOT_NAME()[slot] }),
          h('span', { class: 'muted' }, `${ln.name}线未开放`), null);
      }
      return h('div', { class: 'gear-slot' + (it ? '' : ' empty') },
        UI.artBox(G.recipe(slot).art, { use: 'icon', text: A.SLOT_NAME()[slot], cls: 'cs-label gear-icon', title: A.SLOT_NAME()[slot] }),
        it ? h('span', { class: 'gs-main' }, A.gearLine(it), h('small', null, A.gearStatText(G.gearStats(it)))) : h('span', { class: 'muted' }, '空'),
        mine ? h('span', { class: 'gs-btns' },
          h('button', { class: 'mini', onclick: () => openSlotChooser(c, slot) }, it ? '换' : '穿戴'),
          it ? h('button', { class: 'mini ghost', onclick: () => { G.unequip(A.save, c.id, slot); A.changed(); } }, '卸下') : null) : null);
    }));
  }

  function charActions(c) {
    const box = h('div', { class: 'cc-actions' });
    const stt = G.status(A.save, c.id);
    if (stt === 'idle') {
      box.appendChild(h('button', { class: 'mini primary', disabled: !G.canAddToLineup(A.save, c.id), title: A.save.lineup.length >= G.slots(A.save) ? '上阵位已满' : '', onclick: () => { G.addToLineup(A.save, c.id); A.changed(); } }, A.save.lineup.length >= G.slots(A.save) ? '上阵位已满' : '上阵'));
      if (A.save.unlocks.forge) for (const m of G.MATS.filter((x) => G.matUnlocked(A.save, x))) {
        const blk = G.gatherBlock(A.save, c.id, m);
        box.appendChild(h('button', { class: 'mini', disabled: !!blk, title: blk === 'full' ? `${G.matName(m)}的采集工位满了` : '', onclick: () => A.doGather(c.id, m) }, `采${G.matName(m)}`));
      }
    } else if (stt === 'lineup') {
      box.appendChild(h('button', { class: 'mini', disabled: A.save.lineup.length <= 1, onclick: () => { G.removeFromLineup(A.save, c.id); A.changed(); } }, '下阵'));
    } else if (stt === 'craft') {
      const jb = G.jobOfChar(A.save, c.id);
      box.appendChild(h('span', { class: 'muted' }, `持续打造${A.SLOT_NAME()[jb.slot]}${jb.cur ? '' : '（等待材料）'}`));
      box.appendChild(h('button', { class: 'mini', onclick: () => A.doCancelCraft(jb.key) }, '召回'));
    } else if (stt === 'gather') {
      box.appendChild(h('span', { class: 'muted' }, `采${G.matName(G.gatherMatOf(A.save, c.id))}中`));
      box.appendChild(h('button', { class: 'mini primary', onclick: () => { G.stopGather(A.save, c.id, A.gnow()); A.changed(); A.step(); } }, '召回'));
    } else {
      box.appendChild(h('span', { class: 'muted' }, '研究中'));
    }
    if (c.origin !== 'starter' || A.save.roster.length > 1) {
      const btn = h('button', { class: 'mini ghost', disabled: !G.canDismiss(A.save, c.id), onclick: () => {
        if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = '再点一次确认遣散'; btn.classList.add('danger'); setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = '遣散'; btn.classList.remove('danger'); } }, 3000); return; }
        G.dismiss(A.save, c.id, A.gnow()); A.changed();
      } }, '遣散');
      box.appendChild(btn);
    }
    return box;
  }

  function formationBoard() {
    const box = h('div', { class: 'card formation-card' }, h('div', { class: 'fm-head' }, h('h2', null, '布阵'),
      h('span', { class: 'muted' }, '剑修近战顶前排，法修远程站后排。敌方近战只能打前排；前排倒下后后排暴露。')));
    const rows = h('div', { class: 'fm-rows' });
    for (const row of ['back', 'front']) {
      const col = h('div', { class: 'fm-col fm-' + row }, h('div', { class: 'fm-label' }, row === 'front' ? '前排（挨近战）' : '后排（只挨远程）'));
      for (const { entry, char } of G.lineupChars(A.save).filter((x) => x.entry.row === row)) {
        col.appendChild(h('div', { class: 'fm-unit' }, A.charGlyph(char), h('span', null, char.name, h('small', null, ` Lv${char.level}`)),
          h('button', { class: 'mini', onclick: () => { G.setRow(A.save, char.id, row === 'front' ? 'back' : 'front'); A.changed(); } }, row === 'front' ? '→ 后排' : '→ 前排')));
      }
      if (!col.querySelector('.fm-unit')) col.appendChild(h('div', { class: 'fm-empty muted' }, '空'));
      rows.appendChild(col);
    }
    rows.appendChild(h('div', { class: 'fm-enemy muted' }, '敌方 →'));
    box.appendChild(rows);
    box.appendChild(h('div', { class: 'fm-btns' },
      h('button', { class: 'mini', onclick: () => { G.swapRows(A.save); A.changed(); } }, '前后互换'),
      h('button', { class: 'mini', onclick: () => { G.applyDefaultRows(A.save); A.changed(); } }, '恢复默认（剑前法后）')));
    return box;
  }

  function rosterPage() {
    const wrap = h('div', { class: 'roster-page' });
    if (G.showFormation(A.save)) wrap.appendChild(formationBoard());
    const groups = [['lineup', `上阵（${A.save.lineup.length}/${G.slots(A.save)}）`], ['research', '研究中'], ['craft', '打造中'], ['gather', '采集中'], ['idle', '闲置']];
    for (const [key, label] of groups) {
      const list = A.save.roster.filter((c) => G.status(A.save, c.id) === key);
      if (key === 'lineup') list.sort((a, b) => A.save.lineup.findIndex((e) => e.id === a.id) - A.save.lineup.findIndex((e) => e.id === b.id));
      if (!list.length && key !== 'lineup') continue;
      wrap.appendChild(h('h3', { class: 'group-title' }, label));
      wrap.appendChild(h('div', { class: 'char-grid' }, list.map((c) => charCard(c))));
    }
    if (A.save.roster.length === 1) wrap.appendChild(h('p', { class: 'muted' }, A.save.unlocks.cave ? '去洞府招募同伴。' : '一个人走到石甲关时，洞府会开门。'));
    return wrap;
  }

  Object.assign(A, {
    openEquipFor, charCard, rosterPage,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
