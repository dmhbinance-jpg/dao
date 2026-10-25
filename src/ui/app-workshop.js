/**
 * 游戏界面 · workshop
 * 洞府的生产部分（阶段 4a）：建筑（等级、工位、下一级效果和花费、升级）、采集（三种原料）、三条生产线（每个工位持续制造）、
 * 装备背包（单件 / 批量出售分解、自动分解设置），以及这些操作的处理函数。洞府页（app-cave.js）把这些卡片排进来。
 * 规则都在 DAO.Game（production / buildings / equipment / economy）；这里只显示和转发操作。
 * 共享状态和公共工具在 app-core.js（DAO.App）。
 * 对外（挂在 DAO.App 上）：buildingsCard、gatherCard、lineCards、gearBagCard、selectCraftSlot、doGather、doCancelCraft、doUpgradeHint
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const UI = DAO.UI;
  const G = DAO.Game;
  const h = UI.h;
  const A = DAO.App;

  const craftSel = {};        // 每条线空工位上的选择：{ [线 id]: { slot, crafter } }
  const bagSel = { qualities: {}, armed: null };   // 装备背包批量处理：勾选的品质、等待二次确认的操作
  const PR = () => DAO.CONFIG.game.production;
  const matSpan = (m) => h('span', { 'data-live': 'mat', 'data-mat': m }, A.oreText(A.save[m] || 0));

  // ================= 建筑 =================
  function buildingsCard() {
    const box = h('div', { class: 'card cave-card buildings-card' },
      h('h2', null, '洞府建筑'),
      h('p', { class: 'muted' }, `矿脉 / 药园 / 灵石矿决定每种原料同时能派几个人采集；锻造房 / 织坊 / 琢玉坊决定每条生产线的工位数和品质概率。升级马上完成，花金币和对应的原料，每升一级花费约翻倍，最高 ${DAO.CONFIG.game.buildings.maxLevel} 级。`));
    const table = h('div', { class: 'bld-list' });
    for (const id of G.buildingIds()) {
      const d = G.buildingDef(id), lv = G.buildingLevel(A.save, id);
      const open = G.buildingOpen(A.save, id);
      const nx = G.nextLevelInfo(A.save, id);
      const blk = G.upgradeBlock(A.save, id);
      const cur = d.kind === 'gather'
        ? `采集工位 ${G.gatherersOf(A.save, d.mat).length}/${G.buildingSlots(A.save, id)}`
        : `制造工位 ${G.jobsOfLine(A.save, d.line).length}/${G.buildingSlots(A.save, id)}`;
      let next = '已满级';
      if (nx) {
        next = d.kind === 'gather' ? `→ ${nx.level} 级：工位 ${nx.slots}` : `→ ${nx.level} 级：工位 ${nx.slots}，品质 ${qualityOdds(nx.table)}`;
      }
      table.appendChild(h('div', { class: 'bld-row' + (open ? '' : ' locked') },
        h('div', { class: 'bld-name' }, h('b', null, d.name), h('small', null, ` ${lv} 级`)),
        h('div', { class: 'bld-info' }, open ? h('span', null, cur, d.kind === 'craft' ? h('small', { class: 'muted' }, ` · 品质 ${qualityOdds(G.qualityTable(A.save, d.line))}`) : null) : h('span', { class: 'muted' }, '第三段通关后开放'),
          open ? h('small', { class: 'muted' }, next) : null),
        open && nx ? h('div', { class: 'bld-act' },
          h('small', { class: blk === 'cost' ? 'lack' : 'muted' }, A.costText(nx.cost)),
          h('button', { class: 'mini' + (blk ? '' : ' primary'), disabled: !!blk, onclick: () => doUpgradeBuilding(id) }, blk === 'cost' ? '材料不够' : '升级')) : h('div', null)));
    }
    box.appendChild(table);
    return box;
  }
  function qualityOdds(table) {
    return PR().qualities.map((q, i) => (table[i] > 0 ? `${q.name}${table[i]}%` : null)).filter(Boolean).join(' ');
  }

  // ================= 采集 =================
  function gatherCard() {
    const Gc = DAO.CONFIG.game.gather;
    const mats = G.MATS.filter((m) => G.matUnlocked(A.save, m));
    const box = h('div', { class: 'card cave-card' },
      h('h2', null, '采集 · ' + mats.map((m) => G.matName(m)).join(' / ')),
      h('p', { class: 'muted' }, `派角色去采原料，随时派出、随时召回。每人每秒 ${Gc.perSec} × 资质系数（对应三维的成长 ÷ ${Gc.refGrowth}，最低 ${Gc.minFactor}）：灵矿看力、灵草看敏、灵石看智。采集中的角色不能上阵、不能研究、不拿经验；关掉页面期间不产出。每种原料的人数受采集建筑的工位数限制。`),
      h('div', { class: 'gather-total' }, mats.map((m) => h('span', null, `${G.matName(m)} `, h('b', null, `${G.totalGatherRate(A.save, m).toFixed(2)}/秒`),
        h('small', { class: 'muted' }, ` · ${G.gatherersOf(A.save, m).length}/${G.gatherSlots(A.save, m)} 人 · 有 `), matSpan(m)))));
    const list = h('div', { class: 'researcher-list' });
    const order = { gather: 0, idle: 1, lineup: 2, craft: 3, research: 4 };
    const best = (c) => Math.max(...mats.map((m) => G.gatherRate(c, m)));
    const chars = A.save.roster.slice().sort((a, b) => order[G.status(A.save, a.id)] - order[G.status(A.save, b.id)] || best(b) - best(a));
    for (const c of chars) {
      const stt = G.status(A.save, c.id);
      const btns = h('span', { class: 'gs-btns' });
      if (stt === 'gather') {
        btns.appendChild(h('span', { class: 'muted' }, `采${G.matName(G.gatherMatOf(A.save, c.id))}中 `));
        btns.appendChild(h('button', { class: 'mini', onclick: () => { G.stopGather(A.save, c.id, A.gnow()); A.toast(`${c.name} 召回${G.inLineup(A.save, c.id) ? '，已上阵' : ''}`); A.changed(); A.step(); } }, '召回'));
      } else {
        for (const m of mats) {
          const blk = G.gatherBlock(A.save, c.id, m);
          const why = { research: '研究中', crafting: '打造中', lastFighter: '唯一上阵的角色', full: `${G.matName(m)}工位满了` }[blk];
          btns.appendChild(h('button', { class: 'mini' + (blk ? '' : stt === 'idle' ? ' primary' : ''), disabled: !!blk, title: why || (stt === 'lineup' ? '会从上阵里撤下来' : ''), onclick: () => doGather(c.id, m) }, `采${G.matName(m)}`));
        }
      }
      list.appendChild(h('div', { class: 'researcher' + (stt === 'gather' ? ' on' : '') },
        A.charGlyph(c),
        h('span', { class: 'r-name' }, c.name, h('small', null, ` Lv${c.level} · ${A.STATUS_NAME[stt]}`)),
        h('span', { class: 'muted' }, mats.map((m) => `${G.matName(m)} ${G.gatherRate(c, m).toFixed(2)}`).join(' · ')),
        btns));
    }
    box.appendChild(list);
    return box;
  }

  // ================= 生产线 =================
  function lineCards() {
    const out = [];
    for (const l of G.lines()) {
      if (!G.lineUnlocked(A.save, l.id)) continue;
      out.push(lineCard(l));
    }
    const locked = G.lines().filter((l) => !G.lineUnlocked(A.save, l.id));
    if (locked.length) out.push(h('div', { class: 'card cave-card muted-card' }, h('p', { class: 'muted' }, `${locked.map((l) => `${l.name}（${G.buildingDef(l.building).name}）`).join('、')}：第三段通关后开放。`)));
    return out;
  }
  function lineCard(l) {
    const bd = G.buildingDef(l.building), lvl = G.workshopLevel(A.save, l.id);
    const table = G.qualityTable(A.save, l.id);
    const stat = A.STAT_NAME[l.stat];
    const box = h('div', { class: 'card cave-card forge-card' },
      h('h2', null, `${bd.name} · ${lvl} 级 · ${l.name}`),
      h('p', { class: 'muted' }, `派角色去持续打造${l.slots.map((s) => A.SLOT_NAME()[s]).join('或')}：一件接一件地做，直到召回。每件开工时扣${G.matName(l.mat)} + 金币，打好直接进装备背包；材料不够就停在岗位上等。打造期间他不能上阵、研究、采集，不拿经验；${stat}越高打得越快。现在 ${G.stationIds(A.save, l.id).length} 个工位。`),
      h('div', { class: 'q-odds' }, h('span', { class: 'muted' }, '品质概率：'), PR().qualities.map((q, i) => (table[i] > 0 ? h('span', { class: 'gq-chip gq-' + q.id }, `${q.name} ${table[i]}%`) : null)),
        h('small', { class: 'muted' }, '（品质越高数值越高：' + PR().qualities.map((q) => `${q.name} ×${q.mult}`).join(' · ') + '）')));
    for (const key of G.stationIds(A.save, l.id, true)) {
      const job = G.jobOf(A.save, key);
      box.appendChild(job ? busyStation(l, key, job) : freeStation(l, key));
    }
    return box;
  }
  const seg = (items, cur, onPick) => h('div', { class: 'seg' }, items.map(([v, label]) => h('button', { class: cur === v ? 'on' : '', onclick: () => onPick(v) }, label)));
  function busyStation(l, key, job) {
    const cc = G.getChar(A.save, job.charId);
    const rec = G.recipe(job.slot);
    return h('div', { class: 'forge-preview station' },
      h('div', null, h('b', null, `${cc ? cc.name : ''} 正在持续打造${A.SLOT_NAME()[job.slot]}`), h('span', { class: 'muted' }, `（已出 ${job.made} 件，每件 ${A.costText(rec.cost)}，约 ${A.fmtGame(G.craftDurationMs(A.save, job.slot, job.charId))}）`)),
      job.cur
        ? h('div', null, h('span', { class: 'muted' }, '这一件还剩 '), h('b', { 'data-live': 'craftLeft', 'data-line': key }, A.fmtGame(G.craftRemainingMs(A.save, key))))
        : h('div', null, h('b', { class: 'lack' }, '等待材料'), h('span', { class: 'muted' }, `：${G.matName(l.mat)} `, matSpan(l.mat), ` / ${rec.cost[l.mat]}，金币 `, h('span', { 'data-live': 'gold' }, UI.num(A.save.gold)), ` / ${UI.num(rec.cost.gold)}，够了自动开工`)),
      h('div', { class: 'act-bar' }, h('div', { class: 'act-fill craft', 'data-live': 'craftFill', 'data-line': key, style: { width: (job.cur ? Math.min(100, 100 * job.cur.progressMs / job.cur.durMs) : 0) + '%' } })),
      h('div', { class: 'forge-row' }, h('span', { class: 'fr-label' }, '改做'), seg(l.slots.map((sl) => [sl, A.SLOT_NAME()[sl]]), job.slot, (v) => doSwitchCraft(key, v)),
        h('small', { class: 'muted' }, job.cur ? '改部位时当前这件退还材料、按新部位重新开工' : '')),
      h('div', null, h('button', { onclick: () => doCancelCraft(key) }, job.cur ? `召回 ${cc ? cc.name : ''}（退还当前这件的 ${A.costText(job.cur.cost)}）` : `召回 ${cc ? cc.name : ''}`)));
  }
  function freeStation(l, key) {
    const sel = (craftSel[l.id] = craftSel[l.id] || { slot: l.slots[0], crafter: null });
    if (!l.slots.includes(sel.slot)) sel.slot = l.slots[0];
    const wrap = h('div', { class: 'station free' });
    wrap.appendChild(h('div', { class: 'forge-row' }, h('span', { class: 'fr-label' }, '部位'), seg(l.slots.map((sl) => [sl, A.SLOT_NAME()[sl]]), sel.slot, (v) => { sel.slot = v; A.renderMain(); })));
    const rec = G.recipe(sel.slot);
    const cost = rec.cost;
    // 派谁去：闲置、采集中、上阵（不是唯一上阵的）都可以
    const cands = A.save.roster.filter((c) => ['idle', 'gather', 'lineup'].includes(G.status(A.save, c.id)) && !G.craftBlock(A.save, sel.slot, c.id));
    if (!sel.crafter || !cands.some((c) => c.id === sel.crafter)) sel.crafter = G.pickCrafter(A.save, sel.slot) || (cands[0] && cands[0].id) || null;
    const crafter = sel.crafter ? G.getChar(A.save, sel.crafter) : null;
    const pick = h('select', { onchange: (e) => { sel.crafter = e.target.value; A.renderMain(); } },
      cands.map((c) => h('option', { value: c.id, selected: sel.crafter === c.id }, `${c.name}（${A.STATUS_NAME[G.status(A.save, c.id)]} · ${A.STAT_NAME[l.stat]} ${Math.round(G.charUnit(c).base[l.stat])} · 每件约 ${A.fmtGame(G.craftDurationMs(A.save, sel.slot, c.id))}）`)));
    wrap.appendChild(h('div', { class: 'forge-row' }, h('span', { class: 'fr-label' }, '派谁'), cands.length ? pick : h('span', { class: 'muted' }, '没有能派的人')));
    const blk = crafter ? G.craftBlock(A.save, sel.slot, crafter.id) : 'nochar';
    const afford = G.canAfford(A.save, sel.slot);
    const white = { slot: sel.slot, quality: 'white' };
    wrap.appendChild(h('div', { class: 'forge-preview' },
      h('div', null, h('b', null, rec.name), h('span', null, `：${rec.desc}，白品质 ${A.gearStatText(G.gearStats(white))}`)),
      crafter && G.status(A.save, crafter.id) !== 'idle' ? h('small', { class: 'muted' }, `${crafter.name} 现在${A.STATUS_NAME[G.status(A.save, crafter.id)]}，派去打造会离开${G.status(A.save, crafter.id) === 'gather' ? '采集' : '上阵'}，召回后回到闲置。`) : null,
      h('div', { class: 'forge-cost' },
        h('span', { class: (A.save[l.mat] || 0) < cost[l.mat] ? 'lack' : '' }, `每件 ${G.matName(l.mat)} ${cost[l.mat]}（有 `, matSpan(l.mat), '）'),
        h('span', { class: A.save.gold < cost.gold ? 'lack' : '' }, `金币 ${UI.num(cost.gold)}（有 `, h('span', { 'data-live': 'gold' }, UI.num(A.save.gold)), '）')),
      !afford && !blk ? h('small', { class: 'muted' }, '材料现在不够：派过去后会先「等待材料」，够了自动开工。') : null,
      h('button', { class: 'primary', disabled: !!blk, onclick: () => doCraft(l.id) }, { nochar: '没有能派的人', busy: '工位已有人' }[blk] || `派 ${crafter.name} 去持续打造${A.SLOT_NAME()[sel.slot]}`)));
    return wrap;
  }
  /** 从角色页「去锻造房」跳过来时，预先选好部位 */
  function selectCraftSlot(slot) {
    const l = G.lineOfSlot(slot);
    if (!l) return;
    craftSel[l] = craftSel[l] || { slot, crafter: null };
    craftSel[l].slot = slot;
  }

  // ================= 装备背包 =================
  function gearBagCard() {
    const bag = A.save.gearBag;
    const box = h('div', { class: 'card cave-card bag-card' }, h('h2', null, `装备背包（${bag.length}）`));
    box.appendChild(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: A.save.settings.forgeHints, onchange: (e) => { G.setSetting(A.save, 'forgeHints', e.target.checked); A.persist(); A.renderActivity(); } }), ' 可以打造 / 有新装备可穿 / 可以升级建筑时在活动条提示'));
    // 自动分解
    const qs = PR().qualities;
    const auto = A.save.settings.autoSalvage;
    box.appendChild(h('div', { class: 'forge-row' }, h('span', { class: 'fr-label' }, '自动分解'),
      h('select', { onchange: (e) => { G.setSetting(A.save, 'autoSalvage', e.target.value || null); A.persist(); A.renderMain(); } },
        h('option', { value: '', selected: !auto }, '关'),
        qs.slice(1).map((q, i) => h('option', { value: q.id, selected: auto === q.id }, `持续制造的产出低于${q.name}的直接分解（${qs.slice(0, i + 1).map((x) => x.name).join('、')}）`)))));
    if (!bag.length) { box.appendChild(h('p', { class: 'muted' }, '空。打好的、换下来的、遣散角色身上的装备都会放在这里。')); return box; }
    // 批量处理：按品质勾选
    const present = qs.filter((q) => bag.some((g) => g.quality === q.id));
    for (const k of Object.keys(bagSel.qualities)) if (!present.some((q) => q.id === k)) delete bagSel.qualities[k];
    const chosen = present.filter((q) => bagSel.qualities[q.id]).map((q) => q.id);
    const prev = chosen.length ? G.disposePreview(A.save, { qualities: chosen }) : [];
    const gold = prev.reduce((a, it) => a + G.sellPrice(it), 0);
    const mats = {};
    for (const it of prev) for (const [k, v] of Object.entries(G.salvageReturn(it))) mats[k] = (mats[k] || 0) + v;
    const armBtn = (mode, label, armedLabel) => h('button', { class: 'mini' + (bagSel.armed === mode ? ' danger' : ''), disabled: !prev.length, onclick: () => {
      if (bagSel.armed !== mode) { bagSel.armed = mode; A.renderMain(); setTimeout(() => { if (bagSel.armed === mode) { bagSel.armed = null; if (A.tab === 'cave') A.renderMain(); } }, 3000); return; }
      bagSel.armed = null;
      doDisposeMany(mode, chosen);
    } }, bagSel.armed === mode ? armedLabel : label);
    box.appendChild(h('div', { class: 'bag-batch' },
      h('span', { class: 'fr-label' }, '批量'),
      present.map((q) => h('label', { class: 'check gq-' + q.id }, h('input', { type: 'checkbox', checked: !!bagSel.qualities[q.id], onchange: (e) => { bagSel.qualities[q.id] = e.target.checked; bagSel.armed = null; A.renderMain(); } }),
        ` ${q.name}（${bag.filter((g) => g.quality === q.id).length}）`)),
      armBtn('sell', prev.length ? `出售 ${prev.length} 件 · +${UI.num(gold)} 金` : '出售', `再点一次确认出售 ${prev.length} 件`),
      armBtn('salvage', prev.length ? `分解 ${prev.length} 件 · +${A.costText(mats)}` : '分解', `再点一次确认分解 ${prev.length} 件`),
      h('small', { class: 'muted' }, '只处理背包里的，穿在身上的不会动。')));
    // 单件
    const sorted = bag.slice().sort((a, b) => G.gearRank(b) - G.gearRank(a) || G.gearSlots().indexOf(a.slot) - G.gearSlots().indexOf(b.slot));
    for (const it of sorted) {
      box.appendChild(h('div', { class: 'gear-bag-row' }, A.gearLine(it), h('small', { class: 'muted' }, G.gearUsable(it) ? A.gearStatText(G.gearStats(it)) : ''),
        h('span', { class: 'gs-btns' },
          G.gearUsable(it) && G.slotUnlocked(A.save, it.slot) ? h('button', { class: 'mini', onclick: () => A.openEquipFor(it) }, '穿给…') : null,
          h('button', { class: 'mini ghost', title: `出售：+${G.sellPrice(it)} 金`, onclick: () => doSell(it) }, `卖 ${G.sellPrice(it)}金`),
          h('button', { class: 'mini ghost', title: `分解：+${A.costText(G.salvageReturn(it))}`, onclick: () => doSalvage(it) }, `分解 +${A.costText(G.salvageReturn(it))}`))));
    }
    return box;
  }

  // ================= 动作 =================
  function doGather(id, mat) {
    mat = mat || 'ore';
    const c = G.getChar(A.save, id);
    if (!G.startGather(A.save, id, A.gnow(), mat)) { A.toast(G.gatherBlock(A.save, id, mat) === 'full' ? `${G.matName(mat)}的采集工位满了（升级${G.buildingDef(G.gatherBuilding(mat)).name}多派人）` : '现在不能派去采集', 'bad'); return; }
    A.toast(`${c.name} 开始采集${G.matName(mat)}（${G.gatherRate(c, mat).toFixed(2)}/秒）`);
    A.changed();
    A.step();
  }
  function doCraft(lineId) {
    const sel = craftSel[lineId];
    const slot = sel.slot, id = sel.crafter;
    const key = G.startProduction(A.save, slot, id, A.gnow());
    if (!key) { A.toast('现在派不了：工位已有人，或者这个角色走不开', 'bad'); return; }
    const j = G.jobOf(A.save, key);
    A.toast(`${G.getChar(A.save, id).name} 开始持续打造${A.SLOT_NAME()[slot]}${j.cur ? `（每件约 ${A.fmtGame(j.cur.durMs)}）` : '，材料不够，先等待材料'}`);
    sel.crafter = null;
    A.changed();
    A.step();
  }
  /** 召回某个工位的人：当前这件退还材料（key 省略 = 锻造的第 1 个工位） */
  function doCancelCraft(key) {
    key = typeof key === 'string' ? key : 'forge';
    const j = G.jobOf(A.save, key);
    const refund = j && j.cur ? j.cur.cost : null;
    const id = G.recallProduction(A.save, key);
    if (!id) return;
    A.toast(`${G.getChar(A.save, id).name} 召回，回到闲置${refund ? `；当前这件退还 ${A.costText(refund)}` : ''}`);
    A.changed();
    A.step();
  }
  /** 某个工位改打造的部位：当前这件退还材料，按新部位重新开工 */
  function doSwitchCraft(key, slot) {
    const j = G.jobOf(A.save, key);
    if (!j || j.slot === slot) return;
    const refund = j.cur ? j.cur.cost : null;
    G.switchProduction(A.save, key, slot);
    A.toast(`改做${A.SLOT_NAME()[slot]}${refund ? `，上一件退还 ${A.costText(refund)}` : ''}${j.cur ? '' : '；材料不够，等待材料'}`);
    A.changed();
  }
  function doUpgradeBuilding(id) {
    const cost = G.upgradeCost(A.save, id);
    if (!G.upgradeBuilding(A.save, id)) { A.toast('现在升级不了：材料不够或已满级', 'bad'); return; }
    A.toast(`${G.buildingDef(id).name}升到 ${G.buildingLevel(A.save, id)} 级（花了 ${A.costText(cost)}）`, 'good');
    A.changed();
    A.step();
  }
  function doSell(it) {
    const g = G.sellGear(A.save, it.id);
    if (g == null) { A.toast('穿在身上的装备不能出售', 'bad'); return; }
    A.toast(`出售 ${G.gearName(it)}：+${g} 金`);
    A.changed();
  }
  function doSalvage(it) {
    const r = G.salvageGear(A.save, it.id);
    if (!r) { A.toast('穿在身上的装备不能分解', 'bad'); return; }
    A.toast(`分解 ${G.gearName(it)}：+${A.costText(r)}`);
    A.changed();
  }
  function doDisposeMany(mode, qualities) {
    const r = G.disposeMany(A.save, mode, { qualities });
    bagSel.qualities = {};
    A.toast(mode === 'sell' ? `出售 ${r.count} 件：+${UI.num(r.gold)} 金` : `分解 ${r.count} 件：+${A.costText(r.mats)}`, 'good');
    A.changed();
  }
  function doUpgradeHint() {
    const u = G.forgeHint(A.save);
    if (!u) return;
    const r = G.doUpgrade(A.save, u, A.gnow());
    if (r && u.kind === 'equip') A.toast(`${G.getChar(A.save, u.charId).name} 穿上 ${G.gearName(r)}`, 'good');
    else if (r && u.kind === 'switch') A.toast(`${G.buildingDef(G.craftBuilding(u.line)).name}改做${A.SLOT_NAME()[u.slot]}`);
    else if (r && u.kind === 'salvage') A.toast(`分解 ${r.count} 件：+${A.costText(r.mats)}`);
    else if (r && u.kind === 'build') A.toast(`${G.buildingDef(u.building).name}升到 ${r.level} 级`, 'good');
    else if (r) A.toast(`${G.getChar(A.save, u.crafter).name} 开始持续打造${A.SLOT_NAME()[u.slot]}`);
    A.changed();
    A.step();
  }

  Object.assign(A, {
    buildingsCard, gatherCard, lineCards, gearBagCard, selectCraftSlot, doGather, doCancelCraft, doUpgradeHint,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
