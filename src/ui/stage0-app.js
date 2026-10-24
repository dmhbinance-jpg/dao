/**
 * 阶段 0 界面：选角页、角色面板、关卡列表、战斗回放、挂机。
 * 只负责显示和计时；所有规则在 src/game/stage0.js。
 * 存档：localStorage「dao.s0.save」，带版本号，与 V0 存档（dao.v0.*）分开。
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const UI = DAO.UI;
  const S0 = DAO.Stage0;
  const h = UI.h;
  const store = UI.makeStore('dao.s0.');

  let save = null;
  let appEl, view = null;
  let screen = 'stages';           // stages | battle
  let pending = null;              // 正在播放、尚未结算的手动战斗 { outcome, startedAt }
  let lastSettle = null;           // 最近一次手动战斗的结算
  const idle = { timer: null, tick: null, outcome: null, startedAt: 0, dur: 0, session: null };

  // ================= 存档 =================
  function load() {
    const s = store.get('save', null);
    save = S0.isValidSave(s) ? s : null;
  }
  function persist() { if (save) store.set('save', save); }

  // ================= 工具 =================
  const roleName = (r) => DAO.ROLE_NAMES[r] || r;
  const STAT_NAME = { str: '力', agi: '敏', int: '智' };

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
    const v = DAO.Model.rollValue(d, t.roll);
    const label = { strPct: '力', agiPct: '敏', intPct: '智', hpPct: '气血', armorPct: '护甲', critRate: '暴击率', critDmg: '暴伤', speed: '速度' }[d.stat] || d.stat;
    return `${d.name}：${label} +${d.stat === 'speed' ? Math.round(v) : Math.round(v * 100) + '%'}`;
  }

  function statRows(u, hero) {
    const b = u.base;
    const phys = hero.role === 'sword';
    return [
      ['气血', UI.num(b.maxHp)],
      [phys ? '物攻' : '法攻', UI.num(phys ? b.pAtk : b.mAtk)],
      ['护甲', UI.num(b.armor)], ['法抗', UI.num(b.resist)],
      ['速度', b.speed.toFixed(1)], ['暴击率', UI.pct(b.critRate)], ['暴伤', '×' + b.critDmg.toFixed(2)],
    ];
  }

  // ================= 选角 =================
  function renderChooser() {
    UI.clear(appEl);
    let picked = null;
    const nameInput = h('input', { id: 'hero-name', type: 'text', maxlength: 8, placeholder: '道号（可不填）', class: 'name-input' });
    const goBtn = h('button', { class: 'primary big-btn', disabled: true, onclick: () => {
      save = S0.newSave(picked, nameInput.value);
      persist();
      screen = 'stages';
      render();
    } }, '选一个定位');
    const cards = Object.entries(DAO.CONFIG.stage0.starters).map(([role, st]) => {
      const hero = S0.newSave(role, '').hero;
      const u = S0.heroUnit(hero);
      const card = h('button', { class: 'role-card', type: 'button', onclick: () => {
        picked = role;
        cards.forEach((c) => c.classList.toggle('on', c === card));
        goBtn.disabled = false;
        goBtn.textContent = `以${st.title}入道`;
      } },
        h('div', { class: 'role-head' }, h('span', { class: 'role-glyph role-' + role }, role === 'sword' ? '剑' : '法'), h('div', null, h('h3', null, st.title), h('p', null, st.desc))),
        h('div', { class: 'role-section' }, h('h4', null, '一级属性'),
          h('div', { class: 'triad-grid' }, ['str', 'agi', 'int'].map((k) => h('div', null,
            h('span', null, STAT_NAME[k]), h('b', null, Math.round(u.base[k])), h('small', null, `+${st.growth[k]}/级`))))),
        h('div', { class: 'role-section' }, h('h4', null, '1 级'),
          h('div', { class: 'kv-grid' }, statRows(u, hero).map(([k, v]) => h('div', null, h('span', null, k), h('b', null, v))))),
        h('div', { class: 'role-section' }, h('h4', null, '技能'),
          u.skills.map((s) => h('div', { class: 'skill-row' }, h('b', null, s.name), h('span', null, (s.key === 'basic' ? '普攻 · ' : '固有主动 · ') + skillDesc(s))))),
        h('div', { class: 'role-section' }, h('h4', null, '天赋'), hero.talents.map((t) => h('div', { class: 'skill-row' }, talentDesc(t)))));
      return card;
    });
    appEl.appendChild(h('section', { class: 'chooser' },
      h('div', { class: 'chooser-intro' },
        h('h2', null, '入道'),
        h('p', null, '选一个定位开始。开局资质中等、固定，不随机；之后靠打引导关、挂机升级变强。')),
      h('div', { class: 'role-cards' }, cards),
      h('div', { class: 'chooser-go' }, nameInput, goBtn)));
  }

  // ================= 角色面板 =================
  function heroPanel() {
    const hero = save.hero;
    const u = S0.heroUnit(hero);
    const need = S0.expToNext(hero.level);
    const maxed = hero.level >= DAO.CONFIG.stage0.maxLevel;
    return h('div', { class: 'card hero-card' },
      h('div', { class: 'hero-head' },
        h('span', { class: 'role-glyph role-' + hero.role }, hero.role === 'sword' ? '剑' : '法'),
        h('div', null, h('h2', null, hero.name), h('span', { class: 'muted' }, roleName(hero.role))),
        h('div', { class: 'lv' }, h('small', null, '等级'), h('b', null, hero.level))),
      h('div', { class: 'expbar', title: '经验' },
        h('div', { class: 'exp-fill', style: { width: (maxed ? 100 : (100 * hero.exp / need)) + '%' } }),
        h('span', null, maxed ? '已满级' : `经验 ${hero.exp} / ${need}`)),
      h('div', { class: 'triad-grid' }, ['str', 'agi', 'int'].map((k) => h('div', null,
        h('span', null, STAT_NAME[k]), h('b', null, Math.round(u.base[k])), h('small', null, `+${hero.growth[k]}/级`)))),
      h('div', { class: 'kv-grid' }, statRows(u, hero).map(([k, v]) => h('div', null, h('span', null, k), h('b', null, v)))),
      h('h4', null, '技能'),
      u.skills.map((s) => h('div', { class: 'skill-row' }, h('b', null, s.name), h('span', null, (s.key === 'basic' ? '普攻 · ' : '固有主动 · ') + skillDesc(s)))),
      h('h4', null, '天赋'),
      hero.talents.map((t) => h('div', { class: 'skill-row' }, talentDesc(t))),
      h('div', { class: 'hero-foot muted' },
        `战斗 ${save.stats.battles} · 胜 ${save.stats.wins} · 击杀 ${save.stats.kills} · 游戏时长 ${Math.round(save.stats.playMs / 60000)} 分钟`));
  }

  // ================= 挂机 =================
  function idlePanel() {
    const box = h('div', { class: 'card idle-card' });
    if (!save.idle) {
      box.appendChild(h('h4', null, '挂机'));
      box.appendChild(h('p', { class: 'muted' }, '已通关的关卡可以挂机自动重复，刷经验。离开页面后挂机暂停，离线不计收益。'));
      return box;
    }
    const st = S0.stageById(save.idle.stageId);
    const ss = idle.session || { battles: 0, wins: 0, exp: 0, levels: 0 };
    const fill = h('div', { class: 'idle-fill' });
    box.appendChild(h('div', { class: 'idle-head' },
      h('h4', null, '挂机中 · ', h('span', null, `${st.id} ${st.name}`)),
      h('button', { class: 'mini', onclick: stopIdle }, '停止')));
    box.appendChild(h('div', { class: 'idle-bar' }, fill));
    box.appendChild(h('p', { class: 'idle-sum' }, `本次：${ss.battles} 场 · 胜 ${ss.wins} · +${ss.exp} 经验` + (ss.levels ? ` · 升 ${ss.levels} 级` : '')));
    if (ss.last) box.appendChild(h('p', { class: 'muted idle-last' }, ss.last));
    idle.fillEl = fill;
    return box;
  }

  function startIdle(stageId) {
    if (!S0.canIdle(save, stageId)) return;
    stopIdle(true);
    save.idle = { stageId };
    idle.session = { battles: 0, wins: 0, exp: 0, levels: 0, last: '' };
    persist();
    nextIdleBattle();
    render();
  }

  function stopIdle(silent) {
    if (idle.timer) clearTimeout(idle.timer);
    if (idle.tick) clearInterval(idle.tick);
    idle.timer = idle.tick = null;
    idle.outcome = null;
    if (save && save.idle) { save.idle = null; persist(); }
    if (!silent) render();
  }

  function nextIdleBattle() {
    if (!save || !save.idle) return;
    const o = S0.runBattle(save, save.idle.stageId);
    idle.outcome = o;
    idle.startedAt = Date.now();
    idle.dur = S0.idleBattleMs(o);
    idle.tick = setInterval(() => {
      if (idle.fillEl) idle.fillEl.style.width = Math.min(100, 100 * (Date.now() - idle.startedAt) / idle.dur) + '%';
    }, 150);
    idle.timer = setTimeout(finishIdleBattle, idle.dur);
  }

  function finishIdleBattle() {
    clearInterval(idle.tick);
    idle.tick = null;
    const o = idle.outcome;
    if (!o || !save.idle) return;
    const r = S0.applyOutcome(save, o, { elapsedMs: idle.dur });
    const ss = idle.session;
    ss.battles++;
    if (o.win) ss.wins++;
    ss.exp += o.exp;
    ss.levels += r.levelsGained;
    ss.last = `上一场：${o.win ? '胜' : '负'} · 击杀 ${o.kills} · +${o.exp} 经验` + (r.levelsGained ? ` · 升到 ${r.levelAfter} 级！` : '');
    persist();
    if (screen === 'stages') render(); else refreshSide();
    nextIdleBattle();
  }

  // ================= 关卡列表 =================
  function stageList() {
    const ch = DAO.CONFIG.stage0.chapter;
    const all = S0.stages();
    const cleared = all.filter((s) => S0.isCleared(save, s.id)).length;
    const box = h('div', { class: 'card stages-card' },
      h('div', { class: 'stages-head' },
        h('div', null, h('h2', null, ch.name), h('span', { class: 'muted' }, ch.desc)),
        h('span', { class: 'progress-chip' }, `${cleared} / ${all.length}`)));
    if (S0.chapterCleared(save)) {
      box.appendChild(h('div', { class: 'chapter-done' }, h('b', null, '第一段已通关'),
        h('span', null, '阶段 0 的内容到这里为止。下一阶段会在通关后掉落第一张技能卡。可以继续挂机升级。')));
    }
    const next = S0.nextStage(save);
    for (const st of all) {
      const unlocked = S0.isUnlocked(save, st.id);
      const clearedN = save.progress.cleared[st.id] || 0;
      const isIdle = save.idle && save.idle.stageId === st.id;
      const status = clearedN ? h('span', { class: 'badge ok' }, `已通关 ×${clearedN}`)
        : unlocked ? h('span', { class: 'badge go' }, '可挑战') : h('span', { class: 'badge lock' }, '未解锁');
      box.appendChild(h('div', { class: 'stage-row' + (unlocked ? '' : ' locked') + (next && next.id === st.id ? ' next' : '') + (st.boss ? ' boss' : '') },
        h('div', { class: 'stage-id' }, st.id),
        h('div', { class: 'stage-main' },
          h('div', { class: 'stage-title' }, h('b', null, st.name), h('span', { class: 'muted' }, st.note)),
          h('div', { class: 'enemy-chips' }, st.enemies.map((e) => {
            const t = DAO.CONFIG.stage0.enemies[e.enemyId];
            return h('span', { class: 'enemy-chip' + (t.boss ? ' boss' : '') }, `${t.name} Lv${e.level}`, h('small', null, e.row === 'back' ? '后' : '前'));
          }), h('span', { class: 'muted exp-note' }, `全杀 +${S0.stageExp(st)} 经验`))),
        h('div', { class: 'stage-side' },
          status,
          h('div', { class: 'stage-btns' },
            h('button', { class: unlocked ? 'primary' : '', disabled: !unlocked, onclick: () => challenge(st.id) }, '挑战'),
            clearedN ? h('button', { class: isIdle ? 'on' : '', onclick: () => (isIdle ? stopIdle() : startIdle(st.id)) }, isIdle ? '挂机中' : '挂机') : null))));
    }
    return box;
  }

  // ================= 战斗 =================
  function challenge(stageId) {
    if (!S0.isUnlocked(save, stageId)) return;
    settlePending();
    stopIdle(true);
    const o = S0.runBattle(save, stageId, { record: true });
    pending = { outcome: o, startedAt: Date.now() };
    lastSettle = null;
    screen = 'battle';
    render();
    view.play(o.result, o.units);
  }

  /** 结算正在播放的战斗（播完、跳过或离开时调用） */
  function settlePending() {
    if (!pending) return null;
    const p = pending;
    pending = null;
    const r = S0.applyOutcome(save, p.outcome, { elapsedMs: Date.now() - p.startedAt });
    lastSettle = { outcome: p.outcome, r };
    persist();
    return lastSettle;
  }

  function resultBanner() {
    if (!lastSettle) return h('div', { class: 'result-banner muted' }, '战斗进行中……播完或点「跳过」后结算。');
    const { outcome: o, r } = lastSettle;
    const st = S0.stageById(o.stageId);
    const idx = S0.stageIndex(o.stageId);
    const nx = S0.stages()[idx + 1];
    return h('div', { class: 'result-banner ' + (o.win ? 'win' : 'lose') },
      h('div', { class: 'rb-main' },
        h('b', { class: 'rb-title' }, o.win ? '胜利' : '战败'),
        h('span', null, `击杀 ${o.kills} · +${o.exp} 经验`),
        r.levelsGained ? h('span', { class: 'lvup' }, `升级！Lv${r.levelBefore} → Lv${r.levelAfter}`) : null,
        r.firstClear ? h('span', { class: 'first' }, nx ? `首次通关，解锁 ${nx.id} ${nx.name}` : '首次通关，第一段完成！') : null,
        !o.win ? h('span', { class: 'muted' }, '打不过就去挂机刷已通关的关卡，升级后再来。') : null),
      h('div', { class: 'rb-btns' },
        h('button', { onclick: () => challenge(st.id) }, '再打一次'),
        o.win && nx && S0.isUnlocked(save, nx.id) ? h('button', { class: 'primary', onclick: () => challenge(nx.id) }, `下一关 ${nx.id}`) : null,
        !o.win && S0.bestClearedStage(save) ? h('button', { onclick: () => { startIdle(S0.bestClearedStage(save).id); backToStages(); } }, `挂机 ${S0.bestClearedStage(save).id}`) : null,
        h('button', { onclick: backToStages }, '返回关卡')));
  }

  function backToStages() {
    if (view) view.stop();
    settlePending();
    screen = 'stages';
    render();
  }

  // ================= 布局 =================
  let sideEl, mainEl, bannerEl;
  function refreshSide() {
    if (!sideEl) return;
    UI.clear(sideEl);
    sideEl.appendChild(heroPanel());
    sideEl.appendChild(idlePanel());
  }

  function render() {
    if (!save) { renderChooser(); return; }
    UI.clear(appEl);
    sideEl = h('aside', { class: 's0-side' });
    mainEl = h('section', { class: 's0-main' });
    appEl.appendChild(h('div', { class: 's0-grid' }, sideEl, mainEl));
    refreshSide();
    if (screen === 'battle' && (pending || lastSettle)) {
      const o = (pending || lastSettle).outcome;
      const st = S0.stageById(o.stageId);
      mainEl.appendChild(h('div', { class: 'battle-head' },
        h('button', { onclick: backToStages }, '← 返回关卡'),
        h('h2', null, `${st.id} ${st.name}`), h('span', { class: 'muted' }, st.note)));
      bannerEl = h('div');
      bannerEl.appendChild(resultBanner());
      mainEl.appendChild(bannerEl);
      const vc = h('div');
      mainEl.appendChild(vc);
      view = UI.createBattleView(vc, {
        store,
        sideNames: { A: '我方', B: '敌方' },
        onEnd: () => {
          settlePending();
          UI.clear(bannerEl);
          bannerEl.appendChild(resultBanner());
          refreshSide();
        },
      });
    } else {
      screen = 'stages';
      view = null;
      mainEl.appendChild(stageList());
    }
  }

  function boot() {
    appEl = document.getElementById('app');
    load();
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
      clearTimeout(armed);
      armed = null;
      resetBtn.textContent = '重新开始';
      resetBtn.classList.remove('danger');
      stopIdle(true);
      if (view) view.stop();
      pending = null;
      lastSettle = null;
      store.del('save');
      save = null;
      screen = 'stages';
      render();
    });
    render();
    // 刷新页面后继续挂机（不补离线收益）
    if (save && save.idle && S0.canIdle(save, save.idle.stageId)) {
      idle.session = { battles: 0, wins: 0, exp: 0, levels: 0, last: '' };
      nextIdleBattle();
      render();
    } else if (save && save.idle) {
      save.idle = null;
      persist();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
