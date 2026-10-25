/**
 * 游戏界面 · activity
 * 顶栏与活动条：金币 / 灵矿 / 上阵 / 名额、自动推关开关、页签；活动条（推关 / 挂机 / 等待、研究 / 采集 / 打造进度、锻造提示）。
 * 共享状态和公共工具在 app-core.js（DAO.App）。
 * 对外（挂在 DAO.App 上）：renderHeader、renderActivity、hintKey
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const UI = DAO.UI;
  const G = DAO.Game;
  const h = UI.h;
  const A = DAO.App;

  // ================= 顶栏 =================
  A.headerSig = '';
  function renderHeader() {
    const autoOn = A.save.auto.on;
    const showBag = A.save.cardsInfo.firstGot || G.bagCount(A.save) > 0;
    const mats = G.MATS.filter((m) => G.matUnlocked(A.save, m));
    const sig = [A.tab, autoOn, A.save.unlocks.cave, mats.join(), A.save.roster.length, showBag, G.bagCount(A.save), G.rosterCap(A.save)].join('|');
    // 只有结构变化时才重建（避免挂机时按钮被反复替换）；金币、上阵位就地更新
    if (sig === A.headerSig && A.els.goldVal) {
      A.els.goldVal.textContent = UI.num(A.save.gold);
      A.els.slotVal.textContent = `${A.save.lineup.length}/${G.slots(A.save)}`;
      if (A.els.quotaVal) A.els.quotaVal.textContent = `${A.save.roster.length}/${G.rosterCap(A.save)}`;
      for (const m of mats) if (A.els.matVal && A.els.matVal[m]) A.els.matVal[m].textContent = A.oreText(A.save[m]);
      return;
    }
    A.headerSig = sig;
    UI.clear(A.els.chips);
    A.els.chips.appendChild(h('span', { class: 'chip-stat', title: '金币' }, h('small', null, '金币'), (A.els.goldVal = h('b', null, UI.num(A.save.gold)))));
    A.els.matVal = {};
    for (const m of mats) A.els.chips.appendChild(h('span', { class: 'chip-stat ore mat-' + m, title: `${G.matName(m)}（洞府采集）` }, h('small', null, G.matName(m)), (A.els.matVal[m] = h('b', { 'data-live': 'mat', 'data-mat': m }, A.oreText(A.save[m])))));
    A.els.chips.appendChild(h('span', { class: 'chip-stat', title: '上阵：同时打怪的人数 / 已解锁的上阵位（研究解锁）' }, h('small', null, '上阵'), (A.els.slotVal = h('b', null, `${A.save.lineup.length}/${G.slots(A.save)}`))));
    A.els.quotaVal = null;
    if (A.save.unlocks.cave) A.els.chips.appendChild(h('span', { class: 'chip-stat', title: '名额：总人数 / 上限（上阵、替补、采集、研究的人都算）' }, h('small', null, '名额'), (A.els.quotaVal = h('b', null, `${A.save.roster.length}/${G.rosterCap(A.save)}`))));
    if (A.clock.scale !== 1) A.els.chips.appendChild(h('span', { class: 'chip-stat warn', title: '时间倍率（配置网站 debug.timeScale）：研究、采集、挂机、战斗播放都按这个倍率走' }, h('small', null, '时间'), h('b', null, '×' + A.clock.scale)));
    A.els.chips.appendChild(h('button', { class: 'switch' + (autoOn ? ' on' : ''), role: 'switch', 'aria-checked': autoOn ? 'true' : 'false', title: '自动推关：胜了打下一关，输了退回挂机，升级后再挑战', onclick: A.toggleAuto },
      h('span', { class: 'knob' }), '自动推关'));
    UI.clear(A.els.nav);
    const tabs = [['stages', '关卡'], ['cave', A.save.unlocks.cave ? '洞府' : '洞府 🔒'], ['roster', `角色 ${A.save.roster.length}`]];
    if (showBag) tabs.push(['bag', `背包 ${G.bagCount(A.save)}`]);
    for (const [id, label] of tabs) {
      A.els.nav.appendChild(h('button', { class: A.tab === id ? 'on' : '', disabled: id === 'cave' && !A.save.unlocks.cave, onclick: () => { A.tab = id; A.render(); } }, label));
    }
  }

  // ================= 活动条 =================
  function renderActivity() {
    const box = A.els.activity;
    box.hidden = false;
    UI.clear(box);
    const left = h('div', { class: 'act-main' });
    const right = h('div', { class: 'act-side' });
    const a = A.activity;
    if (a.type === 'push') {
      const st = G.stageById(a.stageId);
      left.appendChild(h('span', { class: 'act-dot push' }));
      left.appendChild(h('span', null, `推关中 · ${st.id} ${st.name}`));
      if (A.tab !== 'stages') right.appendChild(h('button', { class: 'mini', onclick: () => { A.tab = 'stages'; A.render(); } }, '去看'));
    } else if (a.type === 'farm') {
      const st = G.stageById(A.farm.stageId);
      const ss = A.farm.session || { battles: 0, exp: 0 };
      left.appendChild(h('span', { class: 'act-dot farm' }));
      left.appendChild(h('span', null, `挂机 · ${st.id} ${st.name} · 第 ${ss.battles + 1} 场`));
      const bar = h('div', { class: 'act-bar' }, (A.els.farmFill = h('div', { class: 'act-fill' })));
      left.appendChild(bar);
      left.appendChild(h('small', { class: 'muted' }, `本次 ${ss.battles} 场 · +${ss.exp} 经验 · +${ss.gold || 0} 金`));
      right.appendChild(h('button', { class: 'mini', onclick: () => { G.setAuto(A.save, false); A.stopFarm(); G.setIdle(A.save, null); A.persist(); A.activity = { type: 'none' }; A.render(); } }, '停止'));
    } else if (a.type === 'wait') {
      left.appendChild(h('span', { class: 'act-dot wait' }));
      left.appendChild(h('span', null, waitText(a)));
      if (a.reason === 'guide' || a.reason === 'recruitDecision' || a.reason === 'recruitChoice' || a.reason === 'boss' || a.reason === 'cards') {
        right.appendChild(h('button', { class: 'mini primary', onclick: () => { A.modalClosedFor = null; A.renderModal(); } }, a.reason === 'boss' ? '准备挑战' : a.reason === 'recruitChoice' ? '去选人' : '查看'));
      }
    } else {
      left.appendChild(h('span', { class: 'act-dot' }));
      left.appendChild(h('span', { class: 'muted' }, A.save.auto.on ? '自动推关：准备中' : '空闲。点关卡的「挑战」或「挂机」，或打开自动推关。'));
    }
    // 研究进度
    const ra = A.save.research.active;
    if (ra) {
      const c = G.getChar(A.save, ra.charId);
      const total = ra.endsAt - ra.startedAt;
      const left2 = ra.endsAt - A.gnow();
      right.prepend(h('div', { class: 'act-research', title: '研究进度' },
        h('small', null, `研究 上阵位→${ra.level} · ${c ? c.name : ''} · 剩 `, (A.els.researchLeft = h('span', null, A.fmtGame(left2)))),
        h('div', { class: 'act-bar small' }, (A.els.researchFill = h('div', { class: 'act-fill research', style: { width: Math.min(100, 100 * (1 - left2 / total)) + '%' } })))));
    }
    // 采集 / 锻造提示（不打断推关）
    if (A.save.unlocks.forge && A.save.gather.ids.length) {
      const parts = G.MATS.filter((m) => G.gatherersOf(A.save, m).length).map((m) => `${G.matName(m)} ${G.gatherersOf(A.save, m).length} 人 ${G.totalGatherRate(A.save, m).toFixed(2)}/秒`);
      right.prepend(h('div', { class: 'act-gather', title: '采集中' }, h('small', null, '采集 · ' + parts.join(' · '))));
    }
    // 生产任务（持续制造，每个工位一条）
    for (const [key, job] of Object.entries(G.jobs(A.save))) {
      const cc = G.getChar(A.save, job.charId);
      right.prepend(h('div', { class: 'act-research', title: '持续制造：一件接一件地做，直到召回' },
        h('small', null, `${A.SLOT_NAME()[job.slot]} · ${cc ? cc.name : ''} · 已出 ${job.made} 件 · `, job.cur ? h('span', null, '这件剩 ', h('span', { 'data-live': 'craftLeft', 'data-line': key }, A.fmtGame(G.craftRemainingMs(A.save, key)))) : h('b', { class: 'lack' }, '等待材料')),
        h('div', { class: 'act-bar small' }, h('div', { class: 'act-fill craft', 'data-live': 'craftFill', 'data-line': key, style: { width: (job.cur ? Math.min(100, 100 * job.cur.progressMs / job.cur.durMs) : 0) + '%' } }))));
    }
    if (A.save.guide.queue.includes('forge') && G.guideBlock(A.save, 'forge') === 'ore') {
      const c = G.craftCost(DAO.CONFIG.game.forge.guideSlot);
      right.prepend(h('div', { class: 'act-gather' }, h('small', null, `第一件装备：灵矿 `, h('b', { 'data-live': 'mat', 'data-mat': 'ore' }, A.oreText(A.save.ore)), ` / ${c.ore}`)));
    }
    const hint = G.forgeHint(A.save);
    if (hint) {
      right.prepend(h('div', { class: 'act-hint' },
        h('small', null, A.upgradeText(hint)),
        h('button', { class: 'mini primary', onclick: () => A.doUpgradeHint() }, A.upgradeButton(hint)),
        h('button', { class: 'mini ghost', title: '关掉锻造提示（锻造房里可以再打开）', onclick: () => { G.setSetting(A.save, 'forgeHints', false); A.persist(); renderActivity(); } }, '×')));
    }
    A.hintSig = hintKey(hint);
    box.appendChild(left);
    box.appendChild(right);
  }
  function hintKey(u) { return u ? [u.kind, u.charId, u.slot, u.gearId, u.crafter, u.building, (u.gearIds || []).length].join(':') : ''; }
  /** 装备 / 生产建议的一句话说明（活动条、卡关引导、整理装备引导共用） */
  function upgradeText(u) {
    const who = u.charId ? G.getChar(A.save, u.charId) : null;
    const sn = A.SLOT_NAME();
    if (u.kind === 'equip') return `新装备：${G.gearName(G.findGear(A.save, u.gearId).item)} 可以穿给 ${who.name}`;
    if (u.kind === 'switch') { const j = G.jobOf(A.save, u.key || u.line); return `${who.name} 的${sn[u.slot]}还空着，${G.buildingDef(G.craftBuilding(u.line)).name}在做${j ? sn[j.slot] : '别的部位'}`; }
    if (u.kind === 'salvage') return `背包里有 ${u.gearIds.length} 件没人用得上的装备，可以分解回原料`;
    if (u.kind === 'build') return `可以升级${G.buildingDef(u.building).name}到 ${G.buildingLevel(A.save, u.building) + 1} 级（${A.costText(u.cost)}）`;
    return `可以打造${sn[u.slot]}（给 ${who.name}，每件 ${A.costText(u.cost)}）`;
  }
  function upgradeButton(u) {
    if (u.kind === 'equip') return '穿上';
    if (u.kind === 'switch') return `改做${A.SLOT_NAME()[u.slot]}`;
    if (u.kind === 'salvage') return '分解';
    if (u.kind === 'build') return '升级';
    return `派 ${G.getChar(A.save, u.crafter).name} 去打造`;
  }
  function waitText(a) {
    if (a.reason === 'boss') { const st = G.stageById(a.stageId); return `首领关 ${st.id} ${st.name}：等你确认后挑战`; }
    if (a.reason === 'guide') return a.guide && a.guide.startsWith('gearUp:') ? '卡关了：可以补装备，等你确认' : a.guide === 'tidy' ? '装备背包满了不少，等你整理' : '有新内容开放，等你确认';
    if (a.reason === 'recruitDecision') return '角色名额已满，等你决定新角色的去留';
    if (a.reason === 'recruitChoice') return '招募：等你从 3 名候选里挑一位';
    if (a.reason === 'cards') return '背包里有能用的技能卡，等你处理';
    return '等待中';
  }

  Object.assign(A, {
    renderHeader, renderActivity, hintKey, upgradeText, upgradeButton,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
