/**
 * 游戏界面 · stages
 * 关卡页：关卡列表、战斗回放面板、结算横幅。
 * 共享状态和公共工具在 app-core.js（DAO.App）。
 * 对外（挂在 DAO.App 上）：stageList、battlePanel、resultBanner、refreshStageList
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const UI = DAO.UI;
  const G = DAO.Game;
  const h = UI.h;
  const A = DAO.App;

  // ================= 关卡页 =================
  function stageRow(st, next) {
    const unlocked = G.isUnlocked(A.save, st.id);
    const n = A.save.progress.cleared[st.id] || 0;
    const farming = A.activity.type === 'farm' && A.farm.stageId === st.id;
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
          h('button', { class: unlocked ? 'primary' : '', disabled: !unlocked, onclick: () => A.manualChallenge(st.id) }, '挑战'),
          n ? h('button', { class: farming ? 'on' : '', onclick: () => A.manualFarm(st.id) }, farming ? '挂机中' : '挂机') : null)));
  }

  function stageList() {
    const next = G.nextStage(A.save);
    const box = h('div', { class: 'card stages-card' });
    const chs = G.chapters();
    chs.forEach((ch, i) => {
      const done = G.chapterDone(A.save, ch.id);
      const open = i === 0 || G.chapterDone(A.save, chs[i - 1].id);
      const cleared = ch.stages.filter((st) => G.isCleared(A.save, st.id)).length;
      const drops = DAO.CONFIG.game.cards.drops.chapters.includes(ch.id);
      const head = h('div', { class: 'stages-head' },
        h('div', null, h('h2', null, ch.name), h('span', { class: 'muted' }, ch.desc + (drops ? ' · 小怪会掉技能卡' : ''))),
        h('span', { class: 'progress-chip' }, open ? `${cleared} / ${ch.stages.length}` : '未开放'));
      if (!open) { box.appendChild(h('div', { class: 'chapter-block locked' }, head, h('p', { class: 'muted' }, `打完${chs[i - 1].name}后开放。`))); return; }
      const rows = ch.stages.map((st) => stageRow(st, next));
      const isCurrent = !done || i === chs.length - 1 || (i < chs.length - 1 && !G.chapterDone(A.save, chs[i + 1].id) && !G.isUnlocked(A.save, chs[i + 1].stages[0].id));
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
    A.els.battleHead = h('div', { class: 'battle-head' });
    box.appendChild(A.els.battleHead);
    A.els.banner = h('div');
    A.els.banner.appendChild(resultBanner());
    box.appendChild(A.els.banner);
    const vc = h('div');
    box.appendChild(vc);
    A.view = UI.createBattleView(vc, {
      store: A.store,
      sideNames: { A: '我方', B: '敌方' },
      timeScale: () => A.clock.scale,
      onEnd: () => A.onPushEnd(),
    });
    return box;
  }

  function resultBanner() {
    if (A.pending) return h('div', { class: 'result-banner muted' }, '战斗进行中……播完或点「跳过」后结算。');
    if (!A.lastSettle) return h('div', { class: 'result-banner muted' }, '还没有推关战斗。');
    const { outcome: o, r } = A.lastSettle;
    const nx = G.stages()[G.stageIndex(o.stageId) + 1];
    return h('div', { class: 'result-banner ' + (o.win ? 'win' : 'lose') },
      h('div', { class: 'rb-main' },
        h('b', { class: 'rb-title' }, o.win ? '胜利' : '战败'),
        h('span', null, `击杀 ${o.kills} · 每人 +${r.expEach} 经验 · +${o.gold} 金`),
        r.levelUps.map((u) => h('span', { class: 'lvup' }, `${u.name} 升到 Lv${u.to}`)),
        r.firstClear ? h('span', { class: 'first' }, nx ? `首次通关，解锁 ${nx.id} ${nx.name}` : '首次通关，本段完成！') : null,
        r.drops && r.drops.length ? h('span', { class: 'drops' }, '掉落：' + r.drops.map(A.cardName).join('、')) : null,
        !o.win && !A.save.auto.on ? h('span', { class: 'muted' }, '打不过就挂机刷已通关的关卡，或打开自动推关。') : null,
        A.save.auto.on ? h('span', { class: 'muted' }, '自动推关继续中') : null),
      !A.save.auto.on ? h('div', { class: 'rb-btns' },
        h('button', { onclick: () => A.manualChallenge(o.stageId) }, '再打一次'),
        o.win && nx && G.isUnlocked(A.save, nx.id) ? h('button', { class: 'primary', onclick: () => A.manualChallenge(nx.id) }, `下一关 ${nx.id}`) : null) : null);
  }

  // ================= 渲染 =================
  A.stageListEl = null;
  function refreshStageList() {
    if (A.tab !== 'stages' || !A.stageListEl) return;
    const fresh = stageList();
    A.stageListEl.replaceWith(fresh);
    A.stageListEl = fresh;
  }

  Object.assign(A, {
    stageList, battlePanel, resultBanner, refreshStageList,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
