/**
 * 游戏界面 · cave
 * 洞府页：招募、研究上阵位，以及这两项的处理函数；采集、三条生产线、装备背包、建筑这几张卡片在 app-workshop.js。
 * 共享状态和公共工具在 app-core.js（DAO.App）。
 * 对外（挂在 DAO.App 上）：cavePage、doChoose、caveSignature
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const UI = DAO.UI;
  const G = DAO.Game;
  const h = UI.h;
  const A = DAO.App;

  // ================= 洞府页 =================
  function cavePage() {
    A.caveSig = caveSignature();
    const wrap = h('div', { class: 'cave-grid' });
    const now = A.gnow();
    // ---- 招募 ----
    const cost = G.recruitCost(A.save, now);
    const free = cost === 0;
    const R = DAO.CONFIG.game.recruit;
    const blk = G.recruitBlock(A.save);
    const why = { choosing: '先把上一次的候选选完', pending: '名额已满，先决定遣散谁', full: `名额已满（${A.save.roster.length}/${G.rosterCap(A.save)}），遣散到 ${G.rosterCap(A.save) - 1} 人以下才能再招`, gold: `金币不够（需要 ${cost}）` }[blk];
    const rc = h('div', { class: 'card cave-card' },
      h('h2', null, '招募 · 3 选 1'),
      h('p', { class: 'muted' }, (free
        ? `新手首抽免费，3 名候选都是${G.starter(A.save).role === 'sword' ? '法修' : '剑修'}（与开局角色互补）。`
        : `每次 ${R.cost} 金，价格固定、不涨价。`) + '每次出 3 名候选，挑 1 名留下，其余离开；候选会一直等你选，不能放弃重抽。'),
      h('div', { class: 'recruit-row' },
        A.save.recruitChoice
          ? h('button', { class: 'primary big-btn', onclick: () => { A.modalClosedFor = null; A.renderModal(); } }, '去选人（3 选 1）')
          : h('button', { class: 'primary big-btn', disabled: !!blk, title: why || '', onclick: doRecruit }, free ? '免费招募' : `招募 · ${cost} 金`),
        h('span', { class: 'muted' }, `名额 ${A.save.roster.length}/${G.rosterCap(A.save)}（上阵、替补、采集、研究都算）· 新角色等级 = 最高等级 ${R.levelOffset}`)),
      why && blk !== 'choosing' ? h('p', { class: 'warn-text' }, why) : null,
      h('details', { class: 'odds' }, h('summary', null, '品质概率'),
        h('div', { class: 'odds-list' }, Object.entries(R.qualities).map(([k, q]) => h('div', null, A.qualityBadge(k),
          h('span', null, `${q.weight}% · 成长 ×${q.growthMul[0]}–${q.growthMul[1]} · 天赋 ${q.talents[0] === q.talents[1] ? q.talents[0] : q.talents[0] + '–' + q.talents[1]} 条${q.trigger ? ' · 可出触发型' : ''}`))))));
    if (A.save.pendingRecruit) rc.appendChild(h('div', { class: 'pending-box' }, h('b', null, '名额已满：'), '在弹出的窗口里决定留下还是遣散。'));
    if (A.lastRecruit) rc.appendChild(h('div', { class: 'recruit-result' }, h('h4', null, '刚刚招到'), A.charCard(A.lastRecruit, { compact: true })));
    wrap.appendChild(rc);

    // ---- 研究 ----
    const S = DAO.CONFIG.game.research.slots;
    const nx = G.researchNext(A.save);
    const ra = A.save.research.active;
    const dots = h('div', { class: 'slot-dots' });
    for (let i = 1; i <= S.max; i++) dots.appendChild(h('span', { class: 'dot' + (i <= G.slots(A.save) ? ' on' : '') + (ra && ra.level === i ? ' busy' : '') }, i));
    const rs = h('div', { class: 'card cave-card' },
      h('h2', null, '研究 · 上阵位'),
      h('p', { class: 'muted' }, '每级 +1 个上阵位，从 1 到 5。研究要占用一个角色，研究期间他不能上阵、不拿经验。智力越高研究越快。'),
      dots);
    if (ra) {
      const c = G.getChar(A.save, ra.charId);
      rs.appendChild(h('div', { class: 'research-active' },
        h('span', null, `${c.name} 正在研究第 ${ra.level} 个上阵位，剩 `, h('b', { 'data-live': 'researchLeft' }, A.fmtGame(ra.endsAt - now)))));
    } else if (!nx) {
      rs.appendChild(h('p', null, G.slots(A.save) >= S.max ? '上阵位已经研究到最高。' : `现在上阵位最多研究到 ${G.researchCap(A.save)} 个，后面的等以后开放。`));
    } else {
      rs.appendChild(h('div', { class: 'research-next' }, `下一级：第 ${nx.level} 个上阵位 · ${nx.gold} 金 · 基础 ${A.fmtTime(nx.sec * 1000)}`, nx.level === 3 ? h('small', { class: 'muted' }, '（可选：多一个人上阵）') : nx.level === 4 ? h('small', { class: 'muted' }, '（第三段的卡点：铁岩谷按 4 人上阵设计）') : null));
      const list = h('div', { class: 'researcher-list' });
      for (const c of A.save.roster) {
        const blk = G.researchBlock(A.save, c.id);
        const why = { gold: '金币不够', lastFighter: '唯一上阵的角色', busy: '研究中', crafting: '打造中' }[blk];
        list.appendChild(h('div', { class: 'researcher' },
          A.charGlyph(c),
          h('span', { class: 'r-name' }, c.name, h('small', null, ` Lv${c.level} · ${A.STATUS_NAME[G.status(A.save, c.id)]}`)),
          h('span', { class: 'muted' }, `约 ${A.fmtTime(G.researchDurationMs(A.save, c.id))}`),
          h('button', { class: 'mini' + (blk ? '' : ' primary'), disabled: !!blk, title: why || '', onclick: () => doResearch(c.id) }, why || '派去研究')));
      }
      rs.appendChild(list);
    }
    wrap.appendChild(rs);
    if (A.save.unlocks.forge) {
      wrap.appendChild(A.gatherCard());
      for (const c of A.lineCards()) wrap.appendChild(c);
      wrap.appendChild(A.gearBagCard());
      wrap.appendChild(A.buildingsCard());
    }
    return wrap;
  }

  // ================= 动作 =================
  function doRecruit() {
    const r = G.recruit(A.save, A.gnow());
    if (!r.ok) { A.toast({ gold: `金币不够（需要 ${r.cost}）`, full: '名额已满', choosing: '先把上一次的候选选完', pending: '名额已满，先决定遣散谁' }[r.error] || '现在不能招募', 'bad'); return; }
    A.modalClosedFor = null;
    A.changed();
    A.step();
  }
  /** 3 选 1：选定第 i 名候选 */
  function doChoose(i) {
    const res = G.chooseRecruit(A.save, i, A.gnow());
    if (!res.ok) return;
    A.lastRecruit = res.char;
    if (res.needsDecision) A.toast(`选了 ${res.char.name}，但名额已满：决定遣散谁`, 'bad');
    else A.toast(`${res.char.name}（${G.qualityName(res.char.quality)}${DAO.ROLE_NAMES[res.char.role]}）加入${res.gathering ? `，去采${G.matName(G.gatherMatOf(A.save, res.char.id) || 'ore')}了` : res.crafting ? '，去持续打造了' : G.inLineup(A.save, res.char.id) ? '，已上阵' : ''}`, 'good');
    A.modalClosedFor = null;
    A.changed();
    A.step();
  }
  function doResearch(id) {
    if (!G.startResearch(A.save, id, A.gnow())) return;
    A.toast(`${G.getChar(A.save, id).name} 开始研究上阵位`);
    A.changed();
    A.step();
  }
  /** 每秒：研究倒计时、研究完成 */
  /** 洞府页的状态签名：能不能招募 / 打造 / 研究 / 采集、谁在做什么、背包件数。变了就重画，数字类的就地更新（liveText） */
  function caveSignature() {
    const slots = G.gearSlots();
    return JSON.stringify([G.recruitBlock(A.save), A.save.research.active && A.save.research.active.level, G.researchNext(A.save) && G.researchBlock(A.save, G.pickResearcher(A.save) || ''),
      slots.map((sl) => G.craftBlock(A.save, sl)), Object.entries(G.jobs(A.save)).map(([k, j]) => [k, j.slot, j.charId, !!j.cur, j.made]), A.save.gather.ids.join(),
      JSON.stringify(A.save.gather.mats || {}), A.save.roster.map((c) => c.id + G.status(A.save, c.id)).join(), A.save.gearBag.length, A.save.gold >= (G.researchNext(A.save) || {}).gold,
      G.buildingIds().map((id) => G.upgradeBlock(A.save, id) + G.buildingLevel(A.save, id)).join(), G.MATS.map((m) => G.gatherersOf(A.save, m).length + '/' + G.gatherSlots(A.save, m)).join()]);
  }

  Object.assign(A, {
    cavePage, doChoose, caveSignature,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
