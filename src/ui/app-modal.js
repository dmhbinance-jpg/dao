/**
 * 游戏界面 · modal
 * 弹窗：引导文案（GUIDES）、招募 3 选 1、名额已满、卡关补装备、临时弹窗（showModal 的内容）。
 * 共享状态和公共工具在 app-core.js（DAO.App）。
 * 对外（挂在 DAO.App 上）：renderModal
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const UI = DAO.UI;
  const G = DAO.Game;
  const h = UI.h;
  const A = DAO.App;

  // ================= 引导 / 弹窗 =================
  const GUIDES = {
    cave: () => {
      const other = G.starter(A.save).role === 'sword' ? '法修' : '剑修';
      const why = G.starter(A.save).role === 'sword' ? '石甲猪挡在前面，后排的狐妖一直放火，剑修够不着。' : '石甲猪皮糙肉厚、撞得又狠，法修一个人顶不住。';
      return { title: '一个人不够', body: [why, `洞府开门了：可以招募同伴，还能研究第 2 个上阵位。新手首抽免费：出 3 名候选，都是${other}，挑一位留下。`], btn: '免费招募（3 选 1）' };
    },
    research: () => {
      const rid = G.pickResearcher(A.save);
      const c = rid && G.getChar(A.save, rid);
      const nx = G.researchNext(A.save);
      const blk = G.guideBlock(A.save, 'research');
      const fighter = G.lineupChars(A.save).map((x) => x.char).find((x) => x.id !== rid);
      return {
        title: '研究第 2 个上阵位',
        body: [
          c ? `让 ${c.name} 去研究（${nx.gold} 金，约 ${A.fmtTime(G.researchDurationMs(A.save, rid))}）。研究期间他不能上阵${fighter ? `，${fighter.name} 继续推关、挂机` : ''}。` : '',
          '研究完成后两人一起上阵。',
          blk === 'gold' ? `金币不够（需要 ${nx.gold}），先挂机攒一攒，够了再来。` : '',
        ].filter(Boolean),
        btn: '开始研究', disabled: !!blk,
      };
    },
    formation: () => ({ title: '布阵', body: ['现在两人上阵，可以分前后排了。', '剑修近战，顶在前排挨打；法修远程，站后排输出。敌方近战只能打前排，前排倒下后排才会暴露。', '默认已按剑前法后排好，可以在「角色」页调换。'], btn: '就这样' }),
    'done:qingshi': () => ({ title: '青石山第一段通关', body: ['首领掉了一张技能卡。', '第二段「黑风林」已开放：小怪会掉技能卡，可以重掷、换卡。'], btn: '好' }),
    'done:heifeng': () => ({ title: '黑风林第二段通关', body: ['第三段「铁岩谷」已开放：铁背熊皮糙肉厚、赤狐伤害高，3 个人硬拼很吃力。', '上阵位现在可以研究到第 4 个了（洞府 → 研究）。多一个人上阵，这一段就顺得多。'], btn: '好' }),
    'done:tieyan': () => ({ title: '铁岩谷第三段通关', body: ['引导关到这里为止。', '洞府开放了裁缝（敏、灵草：护手、靴子）和饰品（智、灵石：项链、戒指）两条生产线，装备槽补到 6 个；洞府的六个建筑可以升级，多余的装备可以出售或分解。'], btn: '好' }),
    gather2: () => {
      const need = ['herb', 'stone'].filter((m) => G.matUnlocked(A.save, m) && !G.gatherersOf(A.save, m).length);
      const lines = need.map((m) => { const p = G.gatherPlan(A.save, A.gnow(), m); return `${G.matName(m)}（看${A.STAT_NAME[DAO.CONFIG.game.gather.mats[m].stat]}）：${p ? planLabel(p, m) : '没有能派的人'}`; });
      return { title: '采集灵草和灵石', body: ['裁缝要灵草、饰品要灵石，和灵矿一样派人去采：灵草的速度看敏捷成长，灵石看智力成长。每种原料的采集人数受矿脉 / 药园 / 灵石矿的工位数限制，建筑升级后多派人。', need.length ? lines.join('；') + '。' : '已经有人在采了。'], btn: need.length ? '照这样派人' : '好' };
    },
    craft2: () => ({ title: '打造新部位', body: ['灵草 / 灵石够了：派人去织坊打护手、去琢玉坊打项链（持续制造，和锻造一样），裁缝看敏、饰品看智。打好的进装备背包。'], btn: '派人开工' }),
    equip2: () => ({ title: '新部位的装备打好了', body: ['把护手、项链之类的新装备穿给上阵角色？以后也可以在角色页的装备槽自己换。'], btn: '都穿上' }),
    tidy: () => {
      const plan = G.planUpgrades(A.save, A.gnow());
      return { title: '整理装备', body: ['装备背包里攒了不少东西：', plan.length ? plan.map((u) => A.upgradeText(u)).join('；') + '。' : '暂时没有能做的。', '也可以去洞府的装备背包自己出售 / 分解，或者打开「自动分解」。'], btn: '照这样做' };
    },
    gather: () => {
      const plan = G.gatherPlan(A.save, A.gnow());
      const opts = A.save.gather.ids.length ? null : G.gatherOptions(A.save, A.gnow());
      const first = G.craftCost(DAO.CONFIG.game.forge.guideSlot);
      const body = ['洞府开了「采集」和「锻造房」：灵矿 + 金币能打造装备，第一段的首领山魈就得靠装备过。灵矿要派人去采——采集中的人不能上阵、不能研究，按秒产出，力资质越高越快。'];
      if (A.save.gather.ids.length) body.push('已经有人在采集了。');
      else if (plan && plan.mode === 'recruit') body.push(`上阵位已经满了，招一位新人（${plan.cost} 金，3 选 1，默认挑力资质最高的）——他没有上阵位，正好去采灵矿。攒够 ${first.ore} 灵矿就能打第一件装备。`);
      else if (plan && plan.mode === 'idle') body.push(`派闲置的 ${G.getChar(A.save, plan.charId).name} 去采集（${G.gatherRate(G.getChar(A.save, plan.charId), 'ore').toFixed(2)}/秒）。攒够 ${first.ore} 灵矿就能打第一件装备。`);
      else if (plan) body.push('现在招不了人（名额或金币不够）、也没有闲人。可以把研究中的人调过来（研究会取消、退还金币），或者从上阵里撤一个人。');
      return { title: '采集灵矿', body, btn: plan ? planLabel(plan) : '没有能派的人', disabled: !plan && !A.save.gather.ids.length, plans: opts && opts.length ? opts : null };
    },
    forge: () => {
      const slot = DAO.CONFIG.game.forge.guideSlot;
      const opts = G.craftOptions(A.save, slot);
      const plan = opts[0];
      const cost = G.craftCost(slot);
      const body = [`灵矿够了，可以打第一件装备：派一个人去锻造房打${A.SLOT_NAME()[slot]}（${A.costText(cost)}）。打造要一点时间，期间他不能上阵、研究、采集；力越高打得越快。品质打出来才知道（现在白 90%、绿 10%），打好放进装备背包，再穿到上阵角色身上。`];
      if (plan && plan.mode === 'recruit') body.push(`现在没有闲人，招一位新人去打（${plan.cost} 金，3 选 1，默认挑力资质最高的）。`);
      if (plan && plan.mode === 'gather') body.push(`现在没有闲人，先让采集的 ${G.getChar(A.save, plan.charId).name} 去打，打完他回到闲置。`);
      return { title: '打第一件装备', body, btn: plan ? craftPlanLabel(plan, slot) : '没有能派的人', disabled: !plan, plans: opts.length > 1 ? opts : null };
    },
    equipFirst: () => {
      const pl = G.firstEquipPlan(A.save);
      if (!pl) return { title: '装备打好了', body: ['装备已经在背包里了，去角色页给上阵的人穿上。'], btn: '好' };
      const it = G.findGear(A.save, pl.gearId).item, c = G.getChar(A.save, pl.charId);
      return { title: '装备打好了', body: [`打出了 ${G.gearName(it)}（${A.gearStatText(G.gearStats(it))}），放在装备背包里。`, `给 ${c.name} 穿上？以后打好的装备也在背包里，可以在角色页的装备槽穿上、换下、在角色间换。`], btn: `穿给 ${c.name}` };
    },
    moreSlots: () => {
      const nx = G.researchNext(A.save);
      const rid = G.pickSlotResearcher(A.save);
      const c = rid && G.getChar(A.save, rid);
      if (!nx || A.save.research.active) return { title: '上阵位', body: ['已经在研究或已经到上限了。'], btn: '好' };
      return { title: `研究第 ${nx.level} 个上阵位`, body: ['卡关了。除了打装备，多一个人上阵也很管用。', c ? `让 ${c.name} 去研究（${UI.num(nx.gold)} 金，约 ${A.fmtTime(G.researchDurationMs(A.save, rid))}）${G.isGathering(A.save, rid) ? '，他会停下采集' : ''}。研究完他就上阵；如果那时没人采集，会再提示你派人。` : ''].filter(Boolean), btn: '开始研究' };
    },
  };
  function planLabel(p, mat) {
    const mn = G.matName(mat || p.mat || 'ore');
    if (p.mode === 'recruit') return `招募一位去采${mn}（3 选 1）· ${p.cost} 金`;
    if (p.mode === 'idle') return `派闲置的 ${G.getChar(A.save, p.charId).name} 去采${mn}`;
    if (p.mode === 'research') return `把研究中的 ${G.getChar(A.save, p.charId).name} 调去采${mn}`;
    if (p.mode === 'lineup') return `让上阵的 ${G.getChar(A.save, p.charId).name} 去采${mn}`;
    return '派去采集';
  }
  function craftPlanLabel(p, slot) {
    const sn = A.SLOT_NAME()[slot];
    if (p.mode === 'recruit') return `招一位去打${sn}（3 选 1）· ${p.cost} 金`;
    if (p.mode === 'idle') return `派 ${G.getChar(A.save, p.charId).name} 去打${sn}`;
    if (p.mode === 'gather') return `让采集的 ${G.getChar(A.save, p.charId).name} 去打${sn}`;
    if (p.mode === 'lineup') return `让上阵的 ${G.getChar(A.save, p.charId).name} 去打${sn}`;
    return '去打造';
  }
  function gearUpGuide(id) {
    const st = G.stageById(id.slice(7));
    const plan = G.planUpgrades(A.save, A.gnow());
    return {
      title: '该去补装备了',
      body: [`${st.id} ${st.name} 打不过，先把装备补上：`,
        plan.length ? plan.map((u) => A.upgradeText(u)).join('；') + '。' : '暂时没有能做的。',
        '打造是持续的：派去的人会一件接一件地做，打好的进背包；再遇到卡关会提示你穿上更好的。也可以去锻造房和角色页自己安排。'],
      btn: '照这样做',
    };
  }
  const GUIDES_END = {
    firstCard: () => {
      const id = DAO.CONFIG.game.cards.firstCard[G.starter(A.save).role];
      const st = G.starter(A.save);
      const sk = DAO.Model.cardSkill({ id, roll: 0.5 });
      const hl = A.talentTagsOf(st);
      const match = sk.tags.filter((t) => hl.has(t));
      return {
        title: `第一张技能卡：${A.cardName(id)}`,
        body: [
          `${A.cardSkillLine(id)}。主数值范围 ${A.cardRange(id)}。`,
          '散卡在背包里没有数值，插到角色的主动卡槽时才掷数值（档位 0–100）。以后拿到同名卡可以再插一次重掷，保留好的那个；插别的卡会把这张销毁。',
          match.length ? `它的标签〔${match.join('·')}〕和 ${st.name} 的天赋对上了，伤害有加成。` : '',
          id === 'chuanyun' ? '穿云剑能越过前排、优先打后排——第二段首领躲在后排，用得上。' : id === 'huoyu' ? '火雨打整个后排——第二段首领躲在后排，用得上。' : '',
        ].filter(Boolean),
        btn: `插给 ${st.name}`,
      };
    },
  };
  Object.assign(GUIDES, GUIDES_END);

  function renderModal() {
    const layer = A.els.modal;
    UI.clear(layer);
    layer.hidden = true;
    if (!A.save && !A.adhoc) return;
    if (A.adhoc) {
      const a = A.adhoc;
      layer.hidden = false;
      layer.appendChild(h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        h('h2', null, a.title), (a.body || []).map((p) => h('p', null, p)), a.extra || null,
        h('div', { class: 'modal-btns' }, a.buttons.map((b) => h('button', { class: b.primary ? 'primary' : '', onclick: () => { A.adhoc = null; renderModal(); if (b.onClick) b.onClick(); } }, b.label)))));
      return;
    }
    if (!A.save) return;
    let spec = null, onOk = null, extra = null;
    let g = G.currentGuide(A.save);
    // 阶段 3 的引导在条件不满足时（灵矿不够等）不弹窗，等够了再弹；活动条上会显示进度
    if (g && G.guideBlock(A.save, g) && (g === 'forge' || g === 'gather' || g === 'moreSlots' || g === 'gather2' || g === 'craft2' || g === 'equip2' || g.startsWith('gearUp:'))) g = null;
    if (A.save.recruitChoice && A.modalClosedFor !== 'choice') {
      const ch = A.save.recruitChoice;
      const di = G.defaultChoice(A.save);
      const gm = DAO.CONFIG.game.gather.mats[ch.mat || 'ore'];
      const lineStat = ch.slot ? DAO.CONFIG.game.production.lines[G.lineOfSlot(ch.slot)].stat : 'str';
      const why = ch.reason === 'gather' ? `这次是为采集招人：默认挑${A.STAT_NAME[gm.stat]}资质最高的（采集更快），选完直接去采${gm.name}。`
        : ch.reason === 'craft' ? `这次是为打造招人：默认挑${A.STAT_NAME[lineStat]}资质最高的（打得更快），选完直接去打${A.SLOT_NAME()[ch.slot] || '装备'}。` : '默认挑综合资质（三项成长的平均）最高的。';
      spec = { title: ch.free ? '首抽 · 3 选 1' : '招募 · 3 选 1', body: [`挑一位留下，其余两位离开。${why}可以先「稍后再选」，候选会一直留着，但不能放弃重抽。`], btn: `选 ${ch.candidates[di].name}（默认）`, wide: true };
      onOk = () => A.doChoose(di);
      extra = h('div', { class: 'choice-grid' }, ch.candidates.map((c, i) => h('div', { class: 'choice' + (i === di ? ' def' : '') },
        A.charCard(c, { compact: true }),
        h('div', { class: 'choice-meta' }, h('span', null, `资质 ×${G.aptitude(c).toFixed(2)}`), h('span', null, `采${gm.name} ${G.gatherRate(c, ch.mat || 'ore').toFixed(2)}/秒（系数 ${G.gatherFactor(c, ch.mat || 'ore').toFixed(2)}）`)),
        h('button', { class: i === di ? 'primary' : '', onclick: () => { A.els.modal.hidden = true; A.doChoose(i); } }, `选 ${c.name}`))));
    } else if (A.save.pendingRecruit) {
      const pc = A.save.pendingRecruit;
      spec = { title: '角色名额已满', body: [`选中了 ${pc.name}，但名额只有 ${G.rosterCap(A.save)} 个。选一个现有角色遣散，或者遣散新人。`], btn: `遣散 ${pc.name}` };
      onOk = () => { G.resolvePending(A.save, false); A.changed(); A.step(); };
      extra = h('div', null, A.charCard(pc, { compact: true }),
        h('div', { class: 'swap-list' }, A.save.roster.filter((c) => G.canDismiss(A.save, c.id)).map((c) =>
          h('button', { class: 'mini', onclick: () => { G.resolvePending(A.save, true, c.id); A.changed(); A.step(); } }, `遣散 ${c.name}（Lv${c.level}）换他`))));
    } else if (g && A.modalClosedFor !== g) {
      spec = g.startsWith('gearUp:') ? gearUpGuide(g) : GUIDES[g] ? GUIDES[g]() : { title: g, body: [], btn: '好' };
      if (G.guideBlock(A.save, g)) spec.disabled = true;
      const ackWith = (plan) => {
        const info = G.ackGuide(A.save, g, A.gnow(), plan ? { plan } : undefined);
        if (!info.ok) { A.toast('现在做不了：' + (info.error || ''), 'bad'); return; }
        if (info.charId && g === 'gather') A.toast(`${G.getChar(A.save, info.charId).name} 开始采集灵矿`, 'good');
        if (info.charId && g === 'forge') A.toast(`${G.getChar(A.save, info.charId).name} 开始打造${A.SLOT_NAME()[info.slot]}`, 'good');
        if (info.equipped && !Array.isArray(info.equipped)) A.toast(`${G.getChar(A.save, info.equipped.charId).name} 穿上 ${G.gearName(info.equipped.item)}`, 'good');
        if (info.upgrades && info.upgrades.length) A.toast(`装备：${info.upgrades.map((u) => ({ equip: '穿上 1 件', salvage: `分解 ${(u.gearIds || []).length} 件`, build: `${G.buildingDef(u.building || 'forge').name}升级`, switch: '改做' + A.SLOT_NAME()[u.slot] }[u.kind] || '开始打造' + A.SLOT_NAME()[u.slot])).join('、')}`, 'good');
        if (info.gathered && info.gathered.length) A.toast(info.gathered.map((x) => x.charId ? `${G.getChar(A.save, x.charId).name} 去采${G.matName(x.mat)}` : `招人去采${G.matName(x.mat)}（3 选 1）`).join('，'), 'good');
        if (info.started && info.started.length) A.toast(info.started.map((x) => x.charId ? `${G.getChar(A.save, x.charId).name} 开始打${A.SLOT_NAME()[x.slot]}` : `招人去打${A.SLOT_NAME()[x.slot]}（3 选 1）`).join('，'), 'good');
        if (Array.isArray(info.equipped)) A.toast(`穿上 ${info.equipped.length} 件新装备`, 'good');
        if (info.recruit && info.recruit.ok) A.modalClosedFor = null;   // 弹 3 选 1
        if (info.researcher) A.toast(`${G.getChar(A.save, info.researcher).name} 开始研究上阵位`);
        A.changed();
        A.step();
      };
      if (spec.plans && spec.plans.length > 1) {
        extra = h('div', { class: 'swap-list' }, spec.plans.slice(1).map((p) => h('button', { class: 'mini', onclick: () => { A.els.modal.hidden = true; ackWith(p); } }, g === 'forge' ? craftPlanLabel(p, DAO.CONFIG.game.forge.guideSlot) : planLabel(p))));
      }
      onOk = ['gather', 'moreSlots', 'forge', 'equipFirst', 'gather2', 'craft2', 'equip2', 'tidy'].includes(g) || g.startsWith('gearUp:') ? () => ackWith(spec.plans ? spec.plans[0] : null) : () => {
        const info = G.ackGuide(A.save, g, A.gnow());
        if (info.recruit && info.recruit.ok) A.modalClosedFor = null;   // 弹 3 选 1
        if (info.researcher) A.toast(`${G.getChar(A.save, info.researcher).name} 开始研究上阵位`);
        A.changed();
        if (info.insert) { const c = G.starter(A.save); A.showModal(Object.assign(A.insertResultSpec(c, info.insert), { buttons: [{ label: '好', primary: true, onClick: () => A.step() }] })); return; }
        A.step();
      };
    } else if (A.activity.type === 'wait' && A.activity.reason === 'cards' && A.modalClosedFor !== 'cards') {
      const a = G.cardActions(A.save);
      spec = {
        title: '背包里有能用的技能卡',
        body: [
          a.rerolls.length ? `可以重掷：${a.rerolls.map((x) => `${G.getChar(A.save, x.charId).name}「${A.cardName(x.cardId)}」`).join('、')}（同名卡再插一次，保留好的数值）。` : '',
          a.fills.length ? `空卡槽可以插：${[...new Set(a.fills.map((x) => G.getChar(A.save, x.charId).name))].join('、')}。` : '',
          a.swaps.length ? `可以换卡：${[...new Set(a.swaps.map((x) => A.cardName(x.cardId)))].join('、')}（换卡会销毁原卡，去背包自己决定）。` : '',
          '「一键处理」只做重掷和插空槽，不会替你换卡。',
        ].filter(Boolean),
        btn: '一键处理',
      };
      onOk = () => { A.doAutoCards(); };
      extra = h('div', { class: 'modal-extra' },
        h('button', { class: 'mini', onclick: () => { G.dismissCardPrompt(A.save); A.persist(); A.tab = 'bag'; A.modalClosedFor = null; A.render(); A.step(); } }, '去背包自己处理'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { G.setSetting(A.save, 'cardPrompts', !e.target.checked); A.persist(); } }), ' 以后不再提示'));
    } else if (A.activity.type === 'wait' && A.activity.reason === 'boss' && A.modalClosedFor !== 'boss:' + A.activity.stageId) {
      const st = G.stageById(A.activity.stageId);
      const ch = G.chapterOf(st.id);
      spec = { title: `首领关：${st.name}`, body: [`这是${ch ? ch.name : '本段'}的首领。${st.note ? st.note + '。' : ''}准备好了就开打；没把握可以先挂机升几级。`], btn: `挑战 ${st.name}` };
      onOk = () => { G.confirmBoss(A.save, st.id); A.persist(); A.step(); };
    }
    if (!spec) return;
    const closeKey = A.save.recruitChoice && A.modalClosedFor !== 'choice' ? 'choice' : A.save.pendingRecruit ? null : (g && A.modalClosedFor !== g ? g : A.activity.reason === 'cards' ? 'cards' : ('boss:' + A.activity.stageId));
    layer.hidden = false;
    layer.appendChild(h('div', { class: 'modal' + (spec.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
      h('h2', null, spec.title),
      spec.body.map((p) => h('p', null, p)),
      extra,
      h('div', { class: 'modal-btns' },
        closeKey ? h('button', { onclick: () => { A.modalClosedFor = closeKey; if (closeKey === 'cards') { G.dismissCardPrompt(A.save); A.persist(); A.step(); } renderModal(); } }, closeKey === 'choice' ? '稍后再选' : '稍后') : null,
        h('button', { class: 'primary', disabled: !!spec.disabled, onclick: () => { layer.hidden = true; onOk(); } }, spec.btn))));
  }

  Object.assign(A, {
    renderModal,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
