/**
 * 游戏界面（阶段 2）：选角、关卡 + 战斗回放、洞府（招募 / 研究）、角色与布阵、背包与插卡、引导、自动推关。
 * 只负责显示、计时和把玩家操作转给 DAO.Game；规则都在 src/game/game.js。
 * 存档：localStorage「dao.save」（v2）。第一次打开时若有阶段 0 存档「dao.s0.save」（v1）会自动迁移，旧键保留不动。
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const UI = DAO.UI;
  const G = DAO.Game;
  const h = UI.h;
  const store = UI.makeStore('dao.');
  const legacyStore = UI.makeStore('dao.s0.');

  let save = null;
  let tab = 'stages';
  let view = null;                 // 战斗回放组件
  let pending = null;              // 正在播放、尚未结算的推关战斗 { outcome, startedAt }
  let lastSettle = null;           // 最近一次推关的结算 { outcome, r }
  let activity = { type: 'none' }; // none | push | farm | wait
  const farm = { timer: null, tick: null, outcome: null, startedAt: 0, dur: 0, stageId: null, session: null };
  let autoTimer = null;
  let modalClosedFor = null;       // 玩家点了「稍后」的引导 id
  let lastRecruit = null;          // 洞府页展示最近一次招募结果
  let adhoc = null;                // 临时弹窗（换卡确认、插卡结果）{ title, body, extra, buttons: [{label, primary, onClick}] }
  const els = {};

  // ================= 存档 =================
  function load() {
    const now = Date.now();
    let s = G.migrate(store.get('save', null), now);
    if (!s) {
      const old = legacyStore.get('save', null);
      if (old) {
        s = G.migrate(old, now);
        if (s) toast(`已从阶段 0 存档迁移：${s.roster[0].name} Lv${s.roster[0].level}`);
      }
    }
    save = s;
    if (save) persist();
  }
  function persist() { if (save) store.set('save', save); }

  // ================= 小工具 =================
  const roleGlyph = (role) => h('span', { class: 'role-glyph role-' + role }, role === 'sword' ? '剑' : '法');
  const STAT_NAME = { str: '力', agi: '敏', int: '智' };
  const fmtTime = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function skillDesc(s) {
    const bits = [DAO.SHAPE_NAMES[s.shape] || s.shape];
    if (s.dmgType !== 'none') bits.push('×' + s.mult.toFixed(1));
    if (s.shape === 'bounce') bits.push(`${s.bounces} 跳，逐跳 ×${s.bounceDecay}`);
    bits.push(s.range === 'melee' ? (s.pierce ? '近战·穿透' : '近战') : '远程');
    if (s.cd) bits.push(`CD ${s.cd}`);
    return bits.join(' · ');
  }
  function talentDesc(t) {
    const d = DAO.CONFIG.talents[t.id];
    if (!d) return t.id;
    if (d.tier === 'trigger') return `${d.name}：${d.desc || ''}`;
    const v = DAO.Model.rollValue(d, t.roll);
    if (d.tier === 'tag') return `${d.name}：〔${d.tags.join('·')}〕伤害 +${Math.round(v * 100)}%`;
    const label = { strPct: '力', agiPct: '敏', intPct: '智', hpPct: '气血', armorPct: '护甲', resistPct: '法抗', critRate: '暴击率', critDmg: '暴伤', speed: '速度', finalDmg: '终伤' }[d.stat] || d.stat;
    return `${d.name}：${label} +${d.stat === 'speed' ? Math.round(v) : Math.round(v * 100) + '%'}`;
  }
  function tierClass(t) { const d = DAO.CONFIG.talents[t.id]; return d ? 'tier-' + d.tier : ''; }
  function statRows(u, role) {
    const b = u.base;
    const phys = role === 'sword';
    return [
      ['气血', UI.num(b.maxHp)], [phys ? '物攻' : '法攻', UI.num(phys ? b.pAtk : b.mAtk)],
      ['护甲', UI.num(b.armor)], ['法抗', UI.num(b.resist)],
      ['速度', b.speed.toFixed(1)], ['暴击率', UI.pct(b.critRate)],
    ];
  }
  function qualityBadge(q) { return h('span', { class: 'q-badge q-' + q }, G.qualityName(q)); }

  function toast(text, kind) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const t = h('div', { class: 'toast ' + (kind || '') }, text);
    box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3800);
  }

  function levelToast(ups) {
    if (!ups.length) return;
    const byLv = {};
    for (const u of ups) (byLv[u.to] = byLv[u.to] || []).push(u.name);
    toast(Object.entries(byLv).map(([lv, names]) => `${names.join('、')} 升到 Lv${lv}`).join('；'), 'good');
  }

  // ---- 技能卡显示 ----
  function talentTagsOf(c) {
    const set = new Set();
    for (const t of c.talents || []) { const d = DAO.CONFIG.talents[t.id]; if (d) (d.tags || []).concat(d.requireTags || []).forEach((x) => set.add(x)); }
    return set;
  }
  function tagChips(tags, hl) {
    return h('span', { class: 'tags' }, (tags || []).map((t) => h('span', { class: 'tag' + (hl && hl.has(t) ? ' on' : ''), title: hl && hl.has(t) ? '和天赋标签匹配，伤害加成' : '' }, t)));
  }
  function cardName(id) { const d = DAO.CONFIG.cards[id]; return d ? d.name : id; }
  function cardQuality(id) { const d = DAO.CONFIG.cards[id]; return h('span', { class: 'q-badge q-' + (d ? d.quality : 'white') }, UI.QUALITY_NAME[d && d.quality] || ''); }
  function cardKey(id) { return DAO.CONFIG.cards[id].roll.key; }
  function cardRange(id) { const r = DAO.CONFIG.cards[id].roll; return `${UI.val(r.min, r.key)}–${UI.val(r.max, r.key)}`; }
  function cardVal(id, roll) { return UI.val(G.cardValue(id, roll), cardKey(id)); }
  function tierOf(roll) { return Math.round(roll * 100) + ' 档'; }
  function cardSkillLine(id, roll) {
    const sk = DAO.Model.cardSkill({ id, roll: roll == null ? 0.5 : roll });
    return sk ? skillDesc(sk) : '';
  }
  function cardRoles(id) { const d = DAO.CONFIG.cards[id]; return (d.roles || []).map((r) => DAO.ROLE_NAMES[r]).join('、'); }
  function dropToast(drops) {
    if (!drops || !drops.length) return;
    const cnt = {};
    for (const id of drops) cnt[id] = (cnt[id] || 0) + 1;
    toast('掉落：' + Object.entries(cnt).map(([id, n]) => cardName(id) + (n > 1 ? ' ×' + n : '')).join('、'), 'good');
  }
  function showModal(spec) { adhoc = spec; renderModal(); }

  // ================= 选角 =================
  function renderChooser() {
    headerSig = '';
    UI.clear(els.app);
    UI.clear(els.chips);
    UI.clear(els.nav);
    els.activity.hidden = true;
    let picked = null;
    const nameInput = h('input', { id: 'hero-name', type: 'text', maxlength: 8, placeholder: '道号（可不填）', class: 'name-input' });
    const goBtn = h('button', { class: 'primary big-btn', disabled: true, onclick: () => {
      save = G.newSave(picked, nameInput.value, Date.now());
      persist();
      tab = 'stages';
      render();
      step();
    } }, '选一个定位');
    const cards = Object.entries(DAO.CONFIG.game.starters).map(([role, st]) => {
      const c = G.newSave(role, '', 0).roster[0];
      const u = G.charUnit(c);
      const card = h('button', { class: 'role-card', type: 'button', onclick: () => {
        picked = role;
        cards.forEach((x) => x.classList.toggle('on', x === card));
        goBtn.disabled = false;
        goBtn.textContent = `以${st.title}入道`;
      } },
        h('div', { class: 'role-head' }, roleGlyph(role), h('div', null, h('h3', null, st.title), h('p', null, st.desc))),
        h('div', { class: 'role-section' }, h('h4', null, '一级属性'),
          h('div', { class: 'triad-grid' }, ['str', 'agi', 'int'].map((k) => h('div', null,
            h('span', null, STAT_NAME[k]), h('b', null, Math.round(u.base[k])), h('small', null, `+${st.growth[k]}/级`))))),
        h('div', { class: 'role-section' }, h('h4', null, '1 级'),
          h('div', { class: 'kv-grid' }, statRows(u, role).map(([k, v]) => h('div', null, h('span', null, k), h('b', null, v))))),
        h('div', { class: 'role-section' }, h('h4', null, '技能'),
          u.skills.map((s) => h('div', { class: 'skill-row' }, h('b', null, s.name), h('span', null, (s.key === 'basic' ? '普攻 · ' : '固有主动 · ') + skillDesc(s))))),
        h('div', { class: 'role-section' }, h('h4', null, '天赋'), c.talents.map((t) => h('div', { class: 'skill-row' }, talentDesc(t)))));
      return card;
    });
    els.app.appendChild(h('section', { class: 'chooser' },
      h('div', { class: 'chooser-intro' },
        h('h2', null, '入道'),
        h('p', null, '选一个定位开始。开局资质中等、固定，不随机。一个人走到青石山的石甲关会卡住，那时洞府开门，可以招募同伴。')),
      h('div', { class: 'role-cards' }, cards),
      h('div', { class: 'chooser-go' }, nameInput, goBtn)));
  }

  // ================= 顶栏 =================
  let headerSig = '';
  function renderHeader() {
    const autoOn = save.auto.on;
    const showBag = save.cardsInfo.firstGot || G.bagCount(save) > 0;
    const sig = [tab, autoOn, save.unlocks.cave, save.roster.length, showBag, G.bagCount(save)].join('|');
    // 只有结构变化时才重建（避免挂机时按钮被反复替换）；金币、上阵位就地更新
    if (sig === headerSig && els.goldVal) {
      els.goldVal.textContent = UI.num(save.gold);
      els.slotVal.textContent = `${save.lineup.length}/${G.slots(save)}`;
      return;
    }
    headerSig = sig;
    UI.clear(els.chips);
    els.chips.appendChild(h('span', { class: 'chip-stat', title: '金币' }, h('small', null, '金币'), (els.goldVal = h('b', null, UI.num(save.gold)))));
    els.chips.appendChild(h('span', { class: 'chip-stat', title: '上阵位（研究解锁）' }, h('small', null, '上阵位'), (els.slotVal = h('b', null, `${save.lineup.length}/${G.slots(save)}`))));
    els.chips.appendChild(h('button', { class: 'switch' + (autoOn ? ' on' : ''), role: 'switch', 'aria-checked': autoOn ? 'true' : 'false', title: '自动推关：胜了打下一关，输了退回挂机，升级后再挑战', onclick: toggleAuto },
      h('span', { class: 'knob' }), '自动推关'));
    UI.clear(els.nav);
    const tabs = [['stages', '关卡'], ['cave', save.unlocks.cave ? '洞府' : '洞府 🔒'], ['roster', `角色 ${save.roster.length}`]];
    if (showBag) tabs.push(['bag', `背包 ${G.bagCount(save)}`]);
    for (const [id, label] of tabs) {
      els.nav.appendChild(h('button', { class: tab === id ? 'on' : '', disabled: id === 'cave' && !save.unlocks.cave, onclick: () => { tab = id; render(); } }, label));
    }
  }

  // ================= 活动条 =================
  function renderActivity() {
    const box = els.activity;
    box.hidden = false;
    UI.clear(box);
    const left = h('div', { class: 'act-main' });
    const right = h('div', { class: 'act-side' });
    const a = activity;
    if (a.type === 'push') {
      const st = G.stageById(a.stageId);
      left.appendChild(h('span', { class: 'act-dot push' }));
      left.appendChild(h('span', null, `推关中 · ${st.id} ${st.name}`));
      if (tab !== 'stages') right.appendChild(h('button', { class: 'mini', onclick: () => { tab = 'stages'; render(); } }, '去看'));
    } else if (a.type === 'farm') {
      const st = G.stageById(farm.stageId);
      const ss = farm.session || { battles: 0, exp: 0 };
      left.appendChild(h('span', { class: 'act-dot farm' }));
      left.appendChild(h('span', null, `挂机 · ${st.id} ${st.name} · 第 ${ss.battles + 1} 场`));
      const bar = h('div', { class: 'act-bar' }, (els.farmFill = h('div', { class: 'act-fill' })));
      left.appendChild(bar);
      left.appendChild(h('small', { class: 'muted' }, `本次 ${ss.battles} 场 · +${ss.exp} 经验 · +${ss.gold || 0} 金`));
      right.appendChild(h('button', { class: 'mini', onclick: () => { save.auto.on = false; stopFarm(); save.idle = null; persist(); activity = { type: 'none' }; render(); } }, '停止'));
    } else if (a.type === 'wait') {
      left.appendChild(h('span', { class: 'act-dot wait' }));
      left.appendChild(h('span', null, waitText(a)));
      if (a.reason === 'guide' || a.reason === 'recruitDecision' || a.reason === 'boss' || a.reason === 'cards') {
        right.appendChild(h('button', { class: 'mini primary', onclick: () => { modalClosedFor = null; renderModal(); } }, a.reason === 'boss' ? '准备挑战' : '查看'));
      }
    } else {
      left.appendChild(h('span', { class: 'act-dot' }));
      left.appendChild(h('span', { class: 'muted' }, save.auto.on ? '自动推关：准备中' : '空闲。点关卡的「挑战」或「挂机」，或打开自动推关。'));
    }
    // 研究进度
    const ra = save.research.active;
    if (ra) {
      const c = G.getChar(save, ra.charId);
      const total = ra.endsAt - ra.startedAt;
      const left2 = ra.endsAt - Date.now();
      right.prepend(h('div', { class: 'act-research', title: '研究进度' },
        h('small', null, `研究 上阵位→${ra.level} · ${c ? c.name : ''} · 剩 `, (els.researchLeft = h('span', null, fmtTime(left2)))),
        h('div', { class: 'act-bar small' }, (els.researchFill = h('div', { class: 'act-fill research', style: { width: Math.min(100, 100 * (1 - left2 / total)) + '%' } })))));
    }
    box.appendChild(left);
    box.appendChild(right);
  }
  function waitText(a) {
    if (a.reason === 'boss') { const st = G.stageById(a.stageId); return `首领关 ${st.id} ${st.name}：等你确认后挑战`; }
    if (a.reason === 'guide') return '有新内容开放，等你确认';
    if (a.reason === 'recruitDecision') return '角色名额已满，等你决定新角色的去留';
    if (a.reason === 'cards') return '背包里有能用的技能卡，等你处理';
    return '等待中';
  }

  // ================= 关卡页 =================
  function stageRow(st, next) {
    const unlocked = G.isUnlocked(save, st.id);
    const n = save.progress.cleared[st.id] || 0;
    const farming = activity.type === 'farm' && farm.stageId === st.id;
    const status = n ? h('span', { class: 'badge ok' }, `通关 ×${n}`)
      : unlocked ? h('span', { class: 'badge go' }, '可挑战') : h('span', { class: 'badge lock' }, '未解锁');
    return h('div', { class: 'stage-row' + (unlocked ? '' : ' locked') + (next && next.id === st.id ? ' next' : '') + (st.boss ? ' boss' : '') + (st.gate ? ' gate' : '') },
      h('div', { class: 'stage-id' }, st.id),
      h('div', { class: 'stage-main' },
        h('div', { class: 'stage-title' }, h('b', null, st.name), h('span', { class: 'muted' }, st.note)),
        h('div', { class: 'enemy-chips' }, st.enemies.map((e) => {
          const t = DAO.CONFIG.game.enemies[e.enemyId];
          return h('span', { class: 'enemy-chip' + (t.boss ? ' boss' : '') }, `${t.name} ${e.level}`, h('small', null, e.row === 'back' ? '后' : '前'));
        }))),
      h('div', { class: 'stage-side' },
        status,
        h('div', { class: 'stage-btns' },
          h('button', { class: unlocked ? 'primary' : '', disabled: !unlocked, onclick: () => manualChallenge(st.id) }, '挑战'),
          n ? h('button', { class: farming ? 'on' : '', onclick: () => manualFarm(st.id) }, farming ? '挂机中' : '挂机') : null)));
  }

  function stageList() {
    const next = G.nextStage(save);
    const box = h('div', { class: 'card stages-card' });
    const chs = G.chapters();
    chs.forEach((ch, i) => {
      const done = G.chapterDone(save, ch.id);
      const open = i === 0 || G.chapterDone(save, chs[i - 1].id);
      const cleared = ch.stages.filter((st) => G.isCleared(save, st.id)).length;
      const drops = DAO.CONFIG.game.cards.drops.chapters.includes(ch.id);
      const head = h('div', { class: 'stages-head' },
        h('div', null, h('h2', null, ch.name), h('span', { class: 'muted' }, ch.desc + (drops ? ' · 小怪会掉技能卡' : ''))),
        h('span', { class: 'progress-chip' }, open ? `${cleared} / ${ch.stages.length}` : '未开放'));
      if (!open) { box.appendChild(h('div', { class: 'chapter-block locked' }, head, h('p', { class: 'muted' }, `打完${chs[i - 1].name}后开放。`))); return; }
      const rows = ch.stages.map((st) => stageRow(st, next));
      const isCurrent = !done || i === chs.length - 1 || (i < chs.length - 1 && !G.chapterDone(save, chs[i + 1].id) && !G.isUnlocked(save, chs[i + 1].stages[0].id));
      if (done && !isCurrent) {
        box.appendChild(h('details', { class: 'chapter-block done' }, h('summary', null, head), rows));
      } else {
        const blk = h('div', { class: 'chapter-block' }, head);
        if (done) blk.appendChild(h('div', { class: 'chapter-done' }, h('b', null, `${ch.name}已通关`),
          h('span', null, i === chs.length - 1 ? '阶段 2 的内容到这里为止。可以继续挂机、招募、研究、重掷技能卡。' : '下一段已开放。')));
        rows.forEach((r) => blk.appendChild(r));
        box.appendChild(blk);
      }
    });
    return box;
  }

  function battlePanel() {
    const box = h('div', { class: 's1-battle' });
    els.battleHead = h('div', { class: 'battle-head' });
    box.appendChild(els.battleHead);
    els.banner = h('div');
    els.banner.appendChild(resultBanner());
    box.appendChild(els.banner);
    const vc = h('div');
    box.appendChild(vc);
    view = UI.createBattleView(vc, {
      store,
      sideNames: { A: '我方', B: '敌方' },
      onEnd: () => onPushEnd(),
    });
    return box;
  }

  function resultBanner() {
    if (pending) return h('div', { class: 'result-banner muted' }, '战斗进行中……播完或点「跳过」后结算。');
    if (!lastSettle) return h('div', { class: 'result-banner muted' }, '还没有推关战斗。');
    const { outcome: o, r } = lastSettle;
    const nx = G.stages()[G.stageIndex(o.stageId) + 1];
    return h('div', { class: 'result-banner ' + (o.win ? 'win' : 'lose') },
      h('div', { class: 'rb-main' },
        h('b', { class: 'rb-title' }, o.win ? '胜利' : '战败'),
        h('span', null, `击杀 ${o.kills} · 每人 +${r.expEach} 经验 · +${o.gold} 金`),
        r.levelUps.map((u) => h('span', { class: 'lvup' }, `${u.name} 升到 Lv${u.to}`)),
        r.firstClear ? h('span', { class: 'first' }, nx ? `首次通关，解锁 ${nx.id} ${nx.name}` : '首次通关，本段完成！') : null,
        r.drops && r.drops.length ? h('span', { class: 'drops' }, '掉落：' + r.drops.map(cardName).join('、')) : null,
        !o.win && !save.auto.on ? h('span', { class: 'muted' }, '打不过就挂机刷已通关的关卡，或打开自动推关。') : null,
        save.auto.on ? h('span', { class: 'muted' }, '自动推关继续中') : null),
      !save.auto.on ? h('div', { class: 'rb-btns' },
        h('button', { onclick: () => manualChallenge(o.stageId) }, '再打一次'),
        o.win && nx && G.isUnlocked(save, nx.id) ? h('button', { class: 'primary', onclick: () => manualChallenge(nx.id) }, `下一关 ${nx.id}`) : null) : null);
  }

  // ================= 洞府页 =================
  function cavePage() {
    const wrap = h('div', { class: 'cave-grid' });
    const now = Date.now();
    // ---- 招募 ----
    const cost = G.recruitCost(save, now);
    const free = cost === 0;
    const R = DAO.CONFIG.game.recruit;
    const rc = h('div', { class: 'card cave-card' },
      h('h2', null, '招募'),
      h('p', { class: 'muted' }, free
        ? `新手首抽免费，保底出${G.starter(save).role === 'sword' ? '法修' : '剑修'}（与开局角色互补）。`
        : `每日首次 ${R.dailyFirstCost} 金，之后每次 ×${R.costMul}，次日重置。今天已招 ${save.recruit.day === G.dayKey(now) ? save.recruit.today : 0} 次。`),
      h('div', { class: 'recruit-row' },
        h('button', { class: 'primary big-btn', disabled: !G.canRecruit(save, now), onclick: doRecruit }, free ? '免费招募' : `招募 · ${cost} 金`),
        h('span', { class: 'muted' }, `名额 ${save.roster.length}/${DAO.CONFIG.game.roster.cap} · 新角色等级 = 最高等级 ${R.levelOffset}`)),
      h('details', { class: 'odds' }, h('summary', null, '品质概率'),
        h('div', { class: 'odds-list' }, Object.entries(R.qualities).map(([k, q]) => h('div', null, qualityBadge(k),
          h('span', null, `${q.weight}% · 成长 ×${q.growthMul[0]}–${q.growthMul[1]} · 天赋 ${q.talents[0] === q.talents[1] ? q.talents[0] : q.talents[0] + '–' + q.talents[1]} 条${q.trigger ? ' · 可出触发型' : ''}`))))));
    if (save.pendingRecruit) rc.appendChild(h('div', { class: 'pending-box' }, h('b', null, '名额已满：'), '在弹出的窗口里决定留下还是遣散。'));
    if (lastRecruit) rc.appendChild(h('div', { class: 'recruit-result' }, h('h4', null, '刚刚招到'), charCard(lastRecruit, { compact: true })));
    wrap.appendChild(rc);

    // ---- 研究 ----
    const S = DAO.CONFIG.game.research.slots;
    const nx = G.researchNext(save);
    const ra = save.research.active;
    const dots = h('div', { class: 'slot-dots' });
    for (let i = 1; i <= S.max; i++) dots.appendChild(h('span', { class: 'dot' + (i <= G.slots(save) ? ' on' : '') + (ra && ra.level === i ? ' busy' : '') }, i));
    const rs = h('div', { class: 'card cave-card' },
      h('h2', null, '研究 · 上阵位'),
      h('p', { class: 'muted' }, '每级 +1 个上阵位，从 1 到 5。研究要占用一个角色，研究期间他不能上阵、不拿经验。智力越高研究越快。'),
      dots);
    if (ra) {
      const c = G.getChar(save, ra.charId);
      rs.appendChild(h('div', { class: 'research-active' },
        h('span', null, `${c.name} 正在研究第 ${ra.level} 个上阵位，`, h('b', null, `剩 ${fmtTime(ra.endsAt - now)}`))));
    } else if (!nx) {
      rs.appendChild(h('p', null, G.slots(save) >= S.max ? '上阵位已经研究到最高。' : `本阶段上阵位最多研究到 ${S.stageCap} 个，后面的等以后开放。`));
    } else {
      rs.appendChild(h('div', { class: 'research-next' }, `下一级：第 ${nx.level} 个上阵位 · ${nx.gold} 金 · 基础 ${fmtTime(nx.sec * 1000)}`, nx.level >= 3 ? h('small', { class: 'muted' }, '（可选：多一个人上阵，需要第三个角色顶上研究的空缺）') : null));
      const list = h('div', { class: 'researcher-list' });
      for (const c of save.roster) {
        const blk = G.researchBlock(save, c.id);
        const why = { gold: '金币不够', lastFighter: '唯一上阵的角色', busy: '研究中' }[blk];
        list.appendChild(h('div', { class: 'researcher' },
          roleGlyph(c.role),
          h('span', { class: 'r-name' }, c.name, h('small', null, ` Lv${c.level} · ${({ lineup: '上阵', idle: '闲置', research: '研究中' })[G.status(save, c.id)]}`)),
          h('span', { class: 'muted' }, `约 ${fmtTime(G.researchDurationMs(save, c.id))}`),
          h('button', { class: 'mini' + (blk ? '' : ' primary'), disabled: !!blk, title: why || '', onclick: () => doResearch(c.id) }, why || '派去研究')));
      }
      rs.appendChild(list);
    }
    wrap.appendChild(rs);
    return wrap;
  }

  // ================= 角色页 =================
  function charCard(c, opts) {
    opts = opts || {};
    const u = G.charUnit(c);
    const stt = save.roster.includes(c) ? G.status(save, c.id) : 'new';
    const need = G.expToNext(c.level);
    const card = h('div', { class: 'char-card st-' + stt },
      h('div', { class: 'cc-head' }, roleGlyph(c.role),
        h('div', { class: 'cc-name' }, h('b', null, c.name), h('small', null, `${DAO.ROLE_NAMES[c.role]} · `, qualityBadge(c.quality))),
        h('div', { class: 'lv' }, h('small', null, '等级'), h('b', null, c.level))),
      h('div', { class: 'expbar' }, h('div', { class: 'exp-fill', style: { width: (100 * c.exp / need) + '%' } }), h('span', null, `经验 ${c.exp} / ${need}`)),
      h('div', { class: 'triad-grid' }, ['str', 'agi', 'int'].map((k) => h('div', null,
        h('span', null, STAT_NAME[k]), h('b', null, Math.round(u.base[k])), h('small', null, `+${c.growth[k]}/级`)))),
      opts.compact ? null : h('div', { class: 'kv-grid' }, statRows(u, c.role).map(([k, v]) => h('div', null, h('span', null, k), h('b', null, v)))),
      h('div', { class: 'cc-skills' }, u.skills.filter((s) => s.key !== 'basic').map((s) => h('div', { class: 'skill-row' }, h('b', null, s.name), h('span', null, skillDesc(s))))),
      h('div', { class: 'cc-talents' }, c.talents.map((t) => h('div', { class: 'talent-line ' + tierClass(t) }, talentDesc(t)))),
      cardSlotView(c),
      h('small', { class: 'muted' }, `资质 ×${G.aptitude(c).toFixed(2)}（相对开局角色）`));
    if (!opts.compact && save.roster.includes(c)) card.appendChild(charActions(c));
    return card;
  }

  function cardSlotView(c) {
    if (!save.cardsInfo || (!save.cardsInfo.firstGot && !c.card)) return null;
    const hl = talentTagsOf(c);
    if (!c.card) return h('div', { class: 'card-slot empty' }, h('span', { class: 'cs-label' }, '主动卡槽'), h('span', { class: 'muted' }, '空'),
      save.roster.includes(c) && Object.keys(save.bag).some((id) => G.canUseCard(c, id)) ? h('button', { class: 'mini', onclick: () => { tab = 'bag'; render(); } }, '去背包插卡') : null);
    const sk = DAO.Model.cardSkill(c.card);
    return h('div', { class: 'card-slot' },
      h('div', { class: 'cs-top' }, h('span', { class: 'cs-label' }, '主动卡槽'), cardQuality(c.card.id), h('b', null, cardName(c.card.id)),
        h('span', { class: 'cs-val' }, `${cardVal(c.card.id, c.card.roll)} · ${tierOf(c.card.roll)}`)),
      h('div', { class: 'skill-row' }, h('span', null, skillDesc(sk)), tagChips(sk.tags, hl)));
  }

  function charActions(c) {
    const box = h('div', { class: 'cc-actions' });
    const stt = G.status(save, c.id);
    if (stt === 'idle') {
      box.appendChild(h('button', { class: 'mini primary', disabled: !G.canAddToLineup(save, c.id), title: save.lineup.length >= G.slots(save) ? '上阵位已满' : '', onclick: () => { G.addToLineup(save, c.id); changed(); } }, save.lineup.length >= G.slots(save) ? '上阵位已满' : '上阵'));
    } else if (stt === 'lineup') {
      box.appendChild(h('button', { class: 'mini', disabled: save.lineup.length <= 1, onclick: () => { G.removeFromLineup(save, c.id); changed(); } }, '下阵'));
    } else {
      box.appendChild(h('span', { class: 'muted' }, '研究中'));
    }
    if (c.origin !== 'starter' || save.roster.length > 1) {
      const btn = h('button', { class: 'mini ghost', disabled: !G.canDismiss(save, c.id), onclick: () => {
        if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = '再点一次确认遣散'; btn.classList.add('danger'); setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = '遣散'; btn.classList.remove('danger'); } }, 3000); return; }
        G.dismiss(save, c.id); changed();
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
      for (const { entry, char } of G.lineupChars(save).filter((x) => x.entry.row === row)) {
        col.appendChild(h('div', { class: 'fm-unit' }, roleGlyph(char.role), h('span', null, char.name, h('small', null, ` Lv${char.level}`)),
          h('button', { class: 'mini', onclick: () => { G.setRow(save, char.id, row === 'front' ? 'back' : 'front'); changed(); } }, row === 'front' ? '→ 后排' : '→ 前排')));
      }
      if (!col.querySelector('.fm-unit')) col.appendChild(h('div', { class: 'fm-empty muted' }, '空'));
      rows.appendChild(col);
    }
    rows.appendChild(h('div', { class: 'fm-enemy muted' }, '敌方 →'));
    box.appendChild(rows);
    box.appendChild(h('div', { class: 'fm-btns' },
      h('button', { class: 'mini', onclick: () => { G.swapRows(save); changed(); } }, '前后互换'),
      h('button', { class: 'mini', onclick: () => { G.applyDefaultRows(save); changed(); } }, '恢复默认（剑前法后）')));
    return box;
  }

  function rosterPage() {
    const wrap = h('div', { class: 'roster-page' });
    if (G.showFormation(save)) wrap.appendChild(formationBoard());
    const groups = [['lineup', `上阵（${save.lineup.length}/${G.slots(save)}）`], ['research', '研究中'], ['idle', '闲置']];
    for (const [key, label] of groups) {
      const list = save.roster.filter((c) => G.status(save, c.id) === key);
      if (key === 'lineup') list.sort((a, b) => save.lineup.findIndex((e) => e.id === a.id) - save.lineup.findIndex((e) => e.id === b.id));
      if (!list.length && key !== 'lineup') continue;
      wrap.appendChild(h('h3', { class: 'group-title' }, label));
      wrap.appendChild(h('div', { class: 'char-grid' }, list.map((c) => charCard(c))));
    }
    if (save.roster.length === 1) wrap.appendChild(h('p', { class: 'muted' }, save.unlocks.cave ? '去洞府招募同伴。' : '一个人走到石甲关时，洞府会开门。'));
    return wrap;
  }

  // ================= 背包页 =================
  function bagPage() {
    const wrap = h('div', { class: 'bag-page' });
    const acts = G.cardActions(save);
    const ci = save.cardsInfo;
    wrap.appendChild(h('div', { class: 'card bag-head' },
      h('div', null, h('h2', null, '背包 · 技能卡'),
        h('p', { class: 'muted' }, '散卡在背包里没有数值，插卡时才掷数值（档位 0–100）。同名卡再插一次 = 重掷，新旧两个数值自动保留好的那个；插另一张卡 = 换卡，旧卡销毁。卡只能插给对应定位的角色。')),
      h('div', { class: 'bag-tools' },
        h('button', { class: 'primary', disabled: !(acts.rerolls.length || acts.fills.length), onclick: doAutoCards }, `一键处理（重掷 ${acts.rerolls.length} · 插空槽 ${acts.fills.length}）`),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: save.settings.cardPrompts, onchange: (e) => { save.settings.cardPrompts = e.target.checked; persist(); } }), ' 拿到卡时让自动推关停下来提示'),
        h('small', { class: 'muted' }, `累计：插卡 ${ci.inserts} · 重掷 ${ci.rerolls} · 换卡 ${ci.replaces}`))));
    const ids = Object.keys(save.bag).filter((id) => save.bag[id] > 0);
    if (!ids.length) {
      wrap.appendChild(h('p', { class: 'muted' }, ci.firstGot ? '背包是空的。第二段的小怪会掉卡。' : '打完第一段首领会拿到第一张技能卡。'));
    }
    const grid = h('div', { class: 'bag-grid' });
    for (const id of ids) {
      const d = DAO.CONFIG.cards[id];
      const sk = DAO.Model.cardSkill({ id, roll: 0.5 });
      const users = save.roster.filter((c) => G.canUseCard(c, id));
      const item = h('div', { class: 'card bag-item' },
        h('div', { class: 'bi-head' }, cardQuality(id), h('b', null, d.name), h('span', { class: 'bi-count' }, '×' + save.bag[id])),
        h('div', { class: 'skill-row' }, h('span', null, cardSkillLine(id)), tagChips(sk.tags)),
        h('small', { class: 'muted' }, `主数值 ${cardRange(id)} · 可用：${cardRoles(id)}`));
      if (!users.length) item.appendChild(h('small', { class: 'muted' }, `暂时没有能用这张卡的角色（需要${cardRoles(id)}）。`));
      for (const c of users) {
        const pv = G.insertPreview(save, c.id, id);
        const hl = talentTagsOf(c);
        const match = sk.tags.some((t) => hl.has(t));
        const label = pv.mode === 'new' ? '插入' : pv.mode === 'reroll' ? `重掷（现 ${tierOf(c.card.roll)}）` : `换卡（销毁 ${cardName(c.card.id)}）`;
        item.appendChild(h('div', { class: 'bi-user' }, roleGlyph(c.role),
          h('span', null, c.name, h('small', null, ` Lv${c.level}${match ? ' · 标签匹配' : ''}`)),
          h('button', { class: 'mini' + (pv.mode === 'replace' ? ' ghost' : ' primary'), onclick: () => openInsert(c.id, id) }, label)));
      }
      grid.appendChild(item);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  function openInsert(charId, cardId) {
    const c = G.getChar(save, charId);
    const pv = G.insertPreview(save, charId, cardId);
    if (!pv) return;
    if (pv.mode === 'replace') {
      showModal({
        title: '换卡',
        body: [`${c.name} 身上的「${cardName(pv.old.id)}」（${cardVal(pv.old.id, pv.old.roll)}，${tierOf(pv.old.roll)}）会被销毁，换成「${cardName(cardId)}」。`, `新卡插入时掷数值，范围 ${cardRange(cardId)}。确定吗？`],
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
        h('b', null, cardVal(id, roll)), h('span', null, tierOf(roll)), kept ? h('span', { class: 'kept-mark' }, '保留') : h('span', { class: 'muted' }, '丢弃'));
      return {
        title: `重掷「${cardName(id)}」`,
        body: [`${c.name} 的同名卡再插一次：新旧两个数值保留好的那个。范围 ${cardRange(id)}。`],
        extra: h('div', { class: 'roll-compare' }, box('原来', res.old.roll, res.kept === 'old'), h('span', { class: 'vs-arrow' }, 'vs'), box('新掷', res.roll, res.kept === 'new')),
        buttons: [{ label: '好', primary: true }],
      };
    }
    const sk = DAO.Model.cardSkill({ id, roll: res.roll });
    const hl = talentTagsOf(c);
    const match = sk.tags.filter((t) => hl.has(t));
    return {
      title: res.mode === 'replace' ? `换上「${cardName(id)}」` : `插入「${cardName(id)}」`,
      body: [
        `${c.name} 掷出 ${cardVal(id, res.roll)}（${tierOf(res.roll)}，范围 ${cardRange(id)}）。`,
        res.mode === 'replace' ? `原来的「${cardName(res.old.id)}」已销毁。` : '',
        match.length ? `技能标签〔${match.join('·')}〕和 ${c.name} 的天赋对上了，伤害有加成。` : '',
        '这个技能开场就绪，在固有主动之前优先施放。',
      ].filter(Boolean),
      extra: h('div', { class: 'skill-row' }, h('span', null, skillDesc(sk)), tagChips(sk.tags, hl)),
      buttons: [{ label: '好', primary: true }],
    };
  }

  function doInsert(charId, cardId) {
    const c = G.getChar(save, charId);
    const res = G.insertCard(save, charId, cardId);
    if (!res) return;
    if (!G.cardActions(save).rerolls.length && !G.cardActions(save).fills.length) save.bagNew = false;
    persist();
    showModal(insertResultSpec(c, res));
    render();
  }

  function doAutoCards() {
    const results = G.autoHandleCards(save);
    persist();
    if (results.length) {
      const lines = results.map((r) => {
        const c = G.getChar(save, r.charId);
        if (r.mode === 'reroll') return `${c.name}「${cardName(r.cardId)}」重掷：原 ${tierOf(r.old.roll)} vs 新 ${tierOf(r.roll)} → 保留${r.kept === 'new' ? '新' : '原'}值`;
        return `${c.name} 插入「${cardName(r.cardId)}」：${cardVal(r.cardId, r.roll)}（${tierOf(r.roll)}）`;
      });
      showModal({ title: '一键处理完成', body: lines, buttons: [{ label: '好', primary: true, onClick: () => step() }] });
    }
    render();
    if (!results.length) step();
  }

  // ================= 引导 / 弹窗 =================
  const GUIDES = {
    cave: () => {
      const other = G.starter(save).role === 'sword' ? '法修' : '剑修';
      const why = G.starter(save).role === 'sword' ? '石甲猪挡在前面，后排的狐妖一直放火，剑修够不着。' : '石甲猪皮糙肉厚、撞得又狠，法修一个人顶不住。';
      return { title: '一个人不够', body: [why, `洞府开门了：可以招募同伴，还能研究第 2 个上阵位。新手首抽免费，保底出${other}。`], btn: '免费招募' };
    },
    research: () => {
      const rid = G.pickResearcher(save);
      const c = rid && G.getChar(save, rid);
      const nx = G.researchNext(save);
      const blk = G.guideBlock(save, 'research');
      const fighter = G.lineupChars(save).map((x) => x.char).find((x) => x.id !== rid);
      return {
        title: '研究第 2 个上阵位',
        body: [
          c ? `让 ${c.name} 去研究（${nx.gold} 金，约 ${fmtTime(G.researchDurationMs(save, rid))}）。研究期间他不能上阵${fighter ? `，${fighter.name} 继续推关、挂机` : ''}。` : '',
          '研究完成后两人一起上阵。',
          blk === 'gold' ? `金币不够（需要 ${nx.gold}），先挂机攒一攒，够了再来。` : '',
        ].filter(Boolean),
        btn: '开始研究', disabled: !!blk,
      };
    },
    formation: () => ({ title: '布阵', body: ['现在两人上阵，可以分前后排了。', '剑修近战，顶在前排挨打；法修远程，站后排输出。敌方近战只能打前排，前排倒下后排才会暴露。', '默认已按剑前法后排好，可以在「角色」页调换。'], btn: '就这样' }),
    'done:qingshi': () => ({ title: '青石山第一段通关', body: ['首领掉了一张技能卡。', '第二段「黑风林」已开放：小怪会掉技能卡，可以重掷、换卡。'], btn: '好' }),
    'done:heifeng': () => ({ title: '黑风林第二段通关', body: ['阶段 2 的内容到这里为止。', '可以继续挂机升级、重掷技能卡、招募和研究。'], btn: '好' }),
    firstCard: () => {
      const id = DAO.CONFIG.game.cards.firstCard[G.starter(save).role];
      const st = G.starter(save);
      const sk = DAO.Model.cardSkill({ id, roll: 0.5 });
      const hl = talentTagsOf(st);
      const match = sk.tags.filter((t) => hl.has(t));
      return {
        title: `第一张技能卡：${cardName(id)}`,
        body: [
          `${cardSkillLine(id)}。主数值范围 ${cardRange(id)}。`,
          '散卡在背包里没有数值，插到角色的主动卡槽时才掷数值（档位 0–100）。以后拿到同名卡可以再插一次重掷，保留好的那个；插别的卡会把这张销毁。',
          match.length ? `它的标签〔${match.join('·')}〕和 ${st.name} 的天赋对上了，伤害有加成。` : '',
          id === 'chuanyun' ? '穿云剑能越过前排、优先打后排——第二段首领躲在后排，用得上。' : id === 'huoyu' ? '火雨打整个后排——第二段首领躲在后排，用得上。' : '',
        ].filter(Boolean),
        btn: `插给 ${st.name}`,
      };
    },
    extraRecruit: () => {
      const cost = G.recruitCost(save, Date.now());
      const blk = G.guideBlock(save, 'extraRecruit');
      return {
        title: '多一位道友',
        body: [
          `现在招到的新角色会自带一张已插好的技能卡。招募一次 ${cost} 金。`,
          '多一个人可以去研究第 3 个上阵位（可选，比较贵），也能在别人研究时顶上。',
          blk === 'gold' ? `金币不够（需要 ${cost}），先挂机攒一攒。` : '',
        ].filter(Boolean),
        btn: `招募 · ${cost} 金`, disabled: !!blk,
      };
    },
  };

  function renderModal() {
    const layer = els.modal;
    UI.clear(layer);
    layer.hidden = true;
    if (!save) return;
    if (adhoc) {
      const a = adhoc;
      layer.hidden = false;
      layer.appendChild(h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        h('h2', null, a.title), (a.body || []).map((p) => h('p', null, p)), a.extra || null,
        h('div', { class: 'modal-btns' }, a.buttons.map((b) => h('button', { class: b.primary ? 'primary' : '', onclick: () => { adhoc = null; renderModal(); if (b.onClick) b.onClick(); } }, b.label)))));
      return;
    }
    let spec = null, onOk = null, extra = null;
    const g = G.currentGuide(save);
    if (save.pendingRecruit) {
      const pc = save.pendingRecruit;
      spec = { title: '角色名额已满', body: [`招到了 ${pc.name}，但名额只有 ${DAO.CONFIG.game.roster.cap} 个。选一个现有角色遣散，或者遣散新人。`], btn: `遣散 ${pc.name}` };
      onOk = () => { G.resolvePending(save, false); changed(); step(); };
      extra = h('div', null, charCard(pc, { compact: true }),
        h('div', { class: 'swap-list' }, save.roster.filter((c) => G.canDismiss(save, c.id)).map((c) =>
          h('button', { class: 'mini', onclick: () => { G.resolvePending(save, true, c.id); changed(); step(); } }, `遣散 ${c.name}（Lv${c.level}）换他`))));
    } else if (g && modalClosedFor !== g) {
      spec = GUIDES[g] ? GUIDES[g]() : { title: g, body: [], btn: '好' };
      onOk = () => {
        const info = G.ackGuide(save, g, Date.now());
        if (info.recruit && info.recruit.char) { lastRecruit = info.recruit.char; toast(`招到 ${info.recruit.char.name}（${G.qualityName(info.recruit.char.quality)}${DAO.ROLE_NAMES[info.recruit.char.role]}）`, 'good'); }
        if (info.researcher) toast(`${G.getChar(save, info.researcher).name} 开始研究上阵位`);
        changed();
        if (info.insert) { const c = G.starter(save); showModal(Object.assign(insertResultSpec(c, info.insert), { buttons: [{ label: '好', primary: true, onClick: () => step() }] })); return; }
        step();
      };
    } else if (activity.type === 'wait' && activity.reason === 'cards' && modalClosedFor !== 'cards') {
      const a = G.cardActions(save);
      spec = {
        title: '背包里有能用的技能卡',
        body: [
          a.rerolls.length ? `可以重掷：${a.rerolls.map((x) => `${G.getChar(save, x.charId).name}「${cardName(x.cardId)}」`).join('、')}（同名卡再插一次，保留好的数值）。` : '',
          a.fills.length ? `空卡槽可以插：${[...new Set(a.fills.map((x) => G.getChar(save, x.charId).name))].join('、')}。` : '',
          a.swaps.length ? `可以换卡：${[...new Set(a.swaps.map((x) => cardName(x.cardId)))].join('、')}（换卡会销毁原卡，去背包自己决定）。` : '',
          '「一键处理」只做重掷和插空槽，不会替你换卡。',
        ].filter(Boolean),
        btn: '一键处理',
      };
      onOk = () => { doAutoCards(); };
      extra = h('div', { class: 'modal-extra' },
        h('button', { class: 'mini', onclick: () => { G.dismissCardPrompt(save); persist(); tab = 'bag'; modalClosedFor = null; render(); step(); } }, '去背包自己处理'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { save.settings.cardPrompts = !e.target.checked; persist(); } }), ' 以后不再提示'));
    } else if (activity.type === 'wait' && activity.reason === 'boss' && modalClosedFor !== 'boss:' + activity.stageId) {
      const st = G.stageById(activity.stageId);
      const ch = G.chapterOf(st.id);
      spec = { title: `首领关：${st.name}`, body: [`这是${ch ? ch.name : '本段'}的首领。${st.note ? st.note + '。' : ''}准备好了就开打；没把握可以先挂机升几级。`], btn: `挑战 ${st.name}` };
      onOk = () => { G.confirmBoss(save, st.id); persist(); step(); };
    }
    if (!spec) return;
    const closeKey = save.pendingRecruit ? null : (g && modalClosedFor !== g ? g : activity.reason === 'cards' ? 'cards' : ('boss:' + activity.stageId));
    layer.hidden = false;
    layer.appendChild(h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
      h('h2', null, spec.title),
      spec.body.map((p) => h('p', null, p)),
      extra,
      h('div', { class: 'modal-btns' },
        closeKey ? h('button', { onclick: () => { modalClosedFor = closeKey; if (closeKey === 'cards') { G.dismissCardPrompt(save); persist(); step(); } renderModal(); } }, '稍后') : null,
        h('button', { class: 'primary', disabled: !!spec.disabled, onclick: () => { layer.hidden = true; onOk(); } }, spec.btn))));
  }

  // ================= 动作 =================
  function doRecruit() {
    const r = G.recruit(save, Date.now());
    if (!r.ok) { toast(r.error === 'gold' ? `金币不够（需要 ${r.cost}）` : '现在不能招募', 'bad'); return; }
    lastRecruit = r.char;
    toast(`招到 ${r.char.name}（${G.qualityName(r.char.quality)}${DAO.ROLE_NAMES[r.char.role]}）${r.added && G.inLineup(save, r.char.id) ? '，已上阵' : ''}`, 'good');
    changed();
    step();
  }
  function doResearch(id) {
    if (!G.startResearch(save, id, Date.now())) return;
    toast(`${G.getChar(save, id).name} 开始研究上阵位`);
    changed();
    step();
  }
  function toggleAuto() {
    save.auto.on = !save.auto.on;
    if (save.auto.on) {
      save.idle = null;
      persist();
      if (activity.type === 'farm' || activity.type === 'none' || activity.type === 'wait') { stopFarm(); step(); }
    } else {
      if (activity.type === 'farm') save.idle = { stageId: farm.stageId };
      persist();
    }
    render();
  }
  function manualChallenge(stageId) {
    if (!G.isUnlocked(save, stageId)) return;
    tab = 'stages';
    startPush(stageId);
  }
  function manualFarm(stageId) {
    if (activity.type === 'farm' && farm.stageId === stageId && !save.auto.on) {
      stopFarm(); save.idle = null; activity = { type: 'none' }; persist(); render(); return;
    }
    if (save.auto.on) { save.auto.on = false; toast('已关闭自动推关，改为手动挂机'); }
    save.idle = { stageId };
    persist();
    startFarm(stageId);
  }
  function changed() { persist(); render(); }

  // ================= 推关（回放） =================
  function startPush(stageId) {
    clearTimeout(autoTimer);
    settlePending();
    stopFarm();
    const o = G.runBattle(save, stageId, { record: true });
    pending = { outcome: o, startedAt: Date.now() };
    lastSettle = null;
    activity = { type: 'push', stageId };
    render();
    view.play(o.result, o.units);
  }
  function settlePending() {
    if (!pending) return null;
    const p = pending;
    pending = null;
    const r = G.applyOutcome(save, p.outcome, { kind: 'push', elapsedMs: Date.now() - p.startedAt });
    lastSettle = { outcome: p.outcome, r };
    levelToast(r.levelUps);
    dropToast(r.drops);
    if (r.caveUnlocked) toast('洞府开门了', 'good');
    persist();
    return lastSettle;
  }
  function onPushEnd() {
    settlePending();
    activity = { type: 'none' };
    if (els.banner) { UI.clear(els.banner); els.banner.appendChild(resultBanner()); }
    renderHeader();
    renderActivity();
    refreshStageList();
    renderModal();
    if (save.auto.on) autoTimer = setTimeout(step, 1200);
    else if (save.idle) startFarm(save.idle.stageId);
  }

  // ================= 挂机（后台） =================
  function startFarm(stageId) {
    stopFarm();
    if (!G.isCleared(save, stageId)) return;
    if (farm.stageId !== stageId || !farm.session) farm.session = { battles: 0, exp: 0, gold: 0, wins: 0 };
    farm.stageId = stageId;
    activity = { type: 'farm', stageId };
    const o = G.runBattle(save, stageId);
    farm.outcome = o;
    farm.startedAt = Date.now();
    farm.dur = G.backgroundBattleMs(o);
    farm.tick = setInterval(() => { if (els.farmFill) els.farmFill.style.width = Math.min(100, 100 * (Date.now() - farm.startedAt) / farm.dur) + '%'; }, 150);
    farm.timer = setTimeout(finishFarm, farm.dur);
    renderActivity();
    refreshStageList();
  }
  function stopFarm() {
    clearTimeout(farm.timer);
    clearInterval(farm.tick);
    farm.timer = farm.tick = null;
    farm.outcome = null;
  }
  function finishFarm() {
    clearInterval(farm.tick);
    farm.tick = null;
    farm.timer = null;
    const o = farm.outcome;
    if (!o) return;
    farm.outcome = null;
    const r = G.applyOutcome(save, o, { kind: 'idle', elapsedMs: farm.dur });
    farm.session.battles++;
    farm.session.exp += r.expEach;
    farm.session.gold += o.gold;
    if (o.win) farm.session.wins++;
    levelToast(r.levelUps);
    dropToast(r.drops);
    persist();
    renderHeader();
    if (tab === 'roster' || tab === 'cave' || tab === 'bag') renderMain();
    if (save.auto.on) step();
    else startFarm(farm.stageId);
  }

  // ================= 自动推关调度 =================
  function step() {
    clearTimeout(autoTimer);
    if (!save) return;
    G.tickResearch(save, Date.now());
    if (pending) return; // 推关回放中，播完再说
    if (!save.auto.on) {
      if (save.idle && G.isCleared(save, save.idle.stageId)) { if (activity.type !== 'farm') startFarm(save.idle.stageId); }
      else if (activity.type !== 'farm') activity = { type: 'none' };
      render();
      return;
    }
    const d = G.autoDecide(save);
    if (d.type === 'challenge') { startPush(d.stageId); return; }
    if (d.type === 'idle') {
      if (activity.type === 'farm' && farm.stageId === d.stageId && farm.timer) { renderActivity(); return; }
      startFarm(d.stageId);
      render();
      return;
    }
    stopFarm();
    activity = Object.assign({ type: 'wait' }, d);
    render();
  }

  /** 每秒：研究倒计时、研究完成 */
  function tick() {
    if (!save) return;
    const done = G.tickResearch(save, Date.now());
    if (done) {
      const c = G.getChar(save, done.charId);
      toast(`研究完成：上阵位 ${done.level} 个${c && G.inLineup(save, c.id) ? `，${c.name} 已上阵` : ''}`, 'good');
      persist();
      render();
      if (save.auto.on && activity.type !== 'push') step();
      return;
    }
    const ra = save.research.active;
    if (ra && els.researchLeft) {
      els.researchLeft.textContent = fmtTime(ra.endsAt - Date.now());
      if (els.researchFill) els.researchFill.style.width = Math.min(100, 100 * (1 - (ra.endsAt - Date.now()) / (ra.endsAt - ra.startedAt))) + '%';
    }
  }

  // ================= 渲染 =================
  let stageListEl = null;
  function refreshStageList() {
    if (tab !== 'stages' || !stageListEl) return;
    const fresh = stageList();
    stageListEl.replaceWith(fresh);
    stageListEl = fresh;
  }
  function renderMain() {
    // 关卡页的战斗回放组件只建一次，切页时保留（推关回放在后台继续）
    if (!els.stagesPage) {
      els.stagesPage = h('div', { class: 's1-stages' });
      stageListEl = stageList();
      els.stagesPage.appendChild(stageListEl);
      els.stagesPage.appendChild(battlePanel());
    }
    els.stagesPage.hidden = tab !== 'stages';
    if (tab === 'stages') refreshStageList();
    if (els.otherPage) els.otherPage.remove();
    els.otherPage = null;
    if (tab === 'cave' && save.unlocks.cave) els.otherPage = cavePage();
    else if (tab === 'roster') els.otherPage = rosterPage();
    else if (tab === 'bag') els.otherPage = bagPage();
    if (!els.stagesPage.isConnected) els.app.appendChild(els.stagesPage);
    if (els.otherPage) els.app.appendChild(els.otherPage);
    if (els.banner) { UI.clear(els.banner); els.banner.appendChild(resultBanner()); }
    if (els.battleHead) {
      UI.clear(els.battleHead);
      const o = (pending || lastSettle || {}).outcome;
      if (o) {
        const st = G.stageById(o.stageId);
        els.battleHead.append(h('h2', null, `${st.id} ${st.name}`), h('span', { class: 'muted' }, st.note));
      } else {
        els.battleHead.append(h('h2', null, '战斗'), h('span', { class: 'muted' }, '推关的战斗在这里回放；挂机在后台进行。'));
      }
    }
  }
  function render() {
    if (!save) { renderChooser(); return; }
    if (tab === 'cave' && !save.unlocks.cave) tab = 'stages';
    if (tab === 'bag' && !(save.cardsInfo.firstGot || G.bagCount(save) > 0)) tab = 'stages';
    if (!els.stagesPage || !els.stagesPage.isConnected) UI.clear(els.app);
    renderHeader();
    renderActivity();
    renderMain();
    renderModal();
  }

  function resetGame() {
    clearTimeout(autoTimer);
    stopFarm();
    if (view) view.stop();
    pending = null; lastSettle = null; lastRecruit = null; activity = { type: 'none' }; farm.session = null; adhoc = null;
    store.del('save');
    save = null;
    els.stagesPage = null; els.otherPage = null; view = null; headerSig = '';
    els.modal.hidden = true;
    tab = 'stages';
    render();
  }

  function boot() {
    els.app = document.getElementById('app');
    els.chips = document.getElementById('chips');
    els.nav = document.getElementById('nav');
    els.activity = document.getElementById('activity');
    els.modal = document.getElementById('modal');
    const resetBtn = document.getElementById('reset-btn');
    let armed = null;
    resetBtn.addEventListener('click', () => {
      if (!save) return;
      if (!armed) {
        resetBtn.textContent = '再点一次确认删除存档';
        resetBtn.classList.add('danger');
        armed = setTimeout(() => { armed = null; resetBtn.textContent = '重新开始'; resetBtn.classList.remove('danger'); }, 3000);
        return;
      }
      clearTimeout(armed); armed = null;
      resetBtn.textContent = '重新开始';
      resetBtn.classList.remove('danger');
      resetGame();
    });
    load();
    render();
    if (save) step();
    setInterval(tick, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
