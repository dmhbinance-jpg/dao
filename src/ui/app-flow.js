/**
 * 游戏界面 · flow
 * 推关流程：手动挑战 / 挂机、自动推关的下一步（step）、推关回放结算、后台挂机、每秒刷新（tick：研究、采集、打造、自动保存）。
 * 共享状态和公共工具在 app-core.js（DAO.App）。
 * 对外（挂在 DAO.App 上）：toggleAuto、manualChallenge、manualFarm、onPushEnd、stopFarm、step、tick
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const UI = DAO.UI;
  const G = DAO.Game;
  const h = UI.h;
  const A = DAO.App;

  function toggleAuto() {
    G.setAuto(A.save, !A.save.auto.on);
    if (A.save.auto.on) {
      G.setIdle(A.save, null);
      A.persist();
      if (A.activity.type === 'farm' || A.activity.type === 'none' || A.activity.type === 'wait') { stopFarm(); step(); }
    } else {
      if (A.activity.type === 'farm') G.setIdle(A.save, A.farm.stageId);
      A.persist();
    }
    A.render();
  }
  function manualChallenge(stageId) {
    if (!G.isUnlocked(A.save, stageId)) return;
    A.tab = 'stages';
    startPush(stageId);
  }
  function manualFarm(stageId) {
    if (A.activity.type === 'farm' && A.farm.stageId === stageId && !A.save.auto.on) {
      stopFarm(); G.setIdle(A.save, null); A.activity = { type: 'none' }; A.persist(); A.render(); return;
    }
    if (A.save.auto.on) { G.setAuto(A.save, false); A.toast('已关闭自动推关，改为手动挂机'); }
    G.setIdle(A.save, stageId);
    A.persist();
    startFarm(stageId);
  }

  // ================= 推关（回放） =================
  function startPush(stageId) {
    clearTimeout(A.autoTimer);
    settlePending();
    stopFarm();
    const o = G.runBattle(A.save, stageId, { record: true });
    A.pending = { outcome: o, startedAt: A.gnow() };
    A.lastSettle = null;
    A.activity = { type: 'push', stageId };
    A.render();
    A.view.play(o.result.timeline);
  }
  function settlePending() {
    if (!A.pending) return null;
    const p = A.pending;
    A.pending = null;
    const r = G.applyOutcome(A.save, p.outcome, { kind: 'push', elapsedMs: A.gnow() - p.startedAt });
    A.lastSettle = { outcome: p.outcome, r };
    A.levelToast(r.levelUps);
    A.dropToast(r.drops);
    if (r.caveUnlocked) A.toast('洞府开门了', 'good');
    A.persist();
    return A.lastSettle;
  }
  function onPushEnd() {
    settlePending();
    A.activity = { type: 'none' };
    if (A.els.banner) { UI.clear(A.els.banner); A.els.banner.appendChild(A.resultBanner()); }
    A.renderHeader();
    A.renderActivity();
    A.refreshStageList();
    A.renderModal();
    if (A.save.auto.on) A.autoTimer = setTimeout(step, A.clock.realMs(1200));
    else if (A.save.idle) startFarm(A.save.idle.stageId);
  }

  // ================= 挂机（后台） =================
  function startFarm(stageId) {
    stopFarm();
    if (!G.isCleared(A.save, stageId)) return;
    if (A.farm.stageId !== stageId || !A.farm.session) A.farm.session = { battles: 0, exp: 0, gold: 0, wins: 0 };
    A.farm.stageId = stageId;
    A.activity = { type: 'farm', stageId };
    const o = G.runBattle(A.save, stageId);
    A.farm.outcome = o;
    A.farm.startedAt = A.gnow();
    A.farm.dur = G.backgroundBattleMs(o);
    A.farm.tick = setInterval(() => { if (A.els.farmFill) A.els.farmFill.style.width = Math.min(100, 100 * (A.gnow() - A.farm.startedAt) / A.farm.dur) + '%'; }, 150);
    A.farm.timer = setTimeout(finishFarm, A.clock.realMs(A.farm.dur));
    A.renderActivity();
    A.refreshStageList();
  }
  function stopFarm() {
    clearTimeout(A.farm.timer);
    clearInterval(A.farm.tick);
    A.farm.timer = A.farm.tick = null;
    A.farm.outcome = null;
  }
  function finishFarm() {
    clearInterval(A.farm.tick);
    A.farm.tick = null;
    A.farm.timer = null;
    const o = A.farm.outcome;
    if (!o) return;
    A.farm.outcome = null;
    const r = G.applyOutcome(A.save, o, { kind: 'idle', elapsedMs: A.farm.dur });
    A.farm.session.battles++;
    A.farm.session.exp += r.expEach;
    A.farm.session.gold += o.gold;
    if (o.win) A.farm.session.wins++;
    A.levelToast(r.levelUps);
    A.dropToast(r.drops);
    A.persist();
    A.renderHeader();
    if (A.tab === 'roster' || A.tab === 'cave' || A.tab === 'bag') A.renderMain();
    if (A.save.auto.on) step();
    else startFarm(A.farm.stageId);
  }

  // ================= 自动推关调度 =================
  function step() {
    clearTimeout(A.autoTimer);
    if (!A.save) return;
    G.tickResearch(A.save, A.gnow());
    if (A.pending) return; // 推关回放中，播完再说
    if (!A.save.auto.on) {
      if (A.save.idle && G.isCleared(A.save, A.save.idle.stageId)) { if (A.activity.type !== 'farm') startFarm(A.save.idle.stageId); }
      else if (A.activity.type !== 'farm') A.activity = { type: 'none' };
      A.render();
      return;
    }
    const d = G.autoDecide(A.save);
    if (d.type === 'challenge') { startPush(d.stageId); return; }
    if (d.type === 'idle') {
      if (A.activity.type === 'farm' && A.farm.stageId === d.stageId && A.farm.timer) { A.renderActivity(); return; }
      startFarm(d.stageId);
      A.render();
      return;
    }
    stopFarm();
    A.activity = Object.assign({ type: 'wait' }, d);
    A.render();
  }
  /** 带 data-live 的数字就地刷新（灵矿、金币、倒计时、进度条） */
  function liveText() {
    const now = A.gnow();
    const ra = A.save.research.active;
    for (const el of document.querySelectorAll('[data-live]')) {
      const k = el.dataset.live;
      const job = el.dataset.line ? G.jobOf(A.save, el.dataset.line) : null;
      if (k === 'ore') el.textContent = A.oreText(A.save.ore);
      else if (k === 'mat') el.textContent = A.oreText(A.save[el.dataset.mat] || 0);
      else if (k === 'gold') el.textContent = UI.num(A.save.gold);
      else if (k === 'craftLeft' && job && job.cur) el.textContent = A.fmtGame(G.craftRemainingMs(A.save, el.dataset.line));
      else if (k === 'craftFill' && job) el.style.width = (job.cur ? Math.min(100, 100 * job.cur.progressMs / job.cur.durMs) : 0) + '%';
      else if (k === 'researchLeft' && ra) el.textContent = A.fmtGame(ra.endsAt - now);
    }
  }

  /** 每秒：研究倒计时、研究完成、采集、打造、洞府页实时刷新 */
  function tick() {
    if (!A.save) return;
    const now = A.gnow();
    if (Date.now() - A.lastPersist > 5000) { A.lastPersist = Date.now(); A.persist(); }
    if (A.save.unlocks.forge) {
      G.tickGather(A.save, now);
      const waitingBefore = Object.values(G.jobs(A.save)).filter((j) => !j.cur).length;
      const made = G.tickProduction(A.save, now);
      const waitingAfter = Object.values(G.jobs(A.save)).filter((j) => !j.cur).length;
      if (made.length) {
        const kept = made.filter((m) => !m.salvaged), sal = made.length - kept.length;
        const msg = kept.length === 1 ? `打好了：${G.gearName(kept[0].item)}（进了装备背包），接着打下一件` : kept.length ? `打好了 ${kept.length} 件（进了装备背包）：${kept.map((m) => G.gearName(m.item)).join('、')}` : '';
        A.toast([msg, sal ? `自动分解了 ${sal} 件` : ''].filter(Boolean).join('；'), 'good');
        A.persist();
        A.render();
        if (A.save.auto.on && A.activity.type !== 'push') step();
      } else if (waitingBefore !== waitingAfter) A.renderActivity();
      const hint = G.forgeHint(A.save);
      if (A.hintKey(hint) !== A.hintSig) A.renderActivity();
      // 卡关补装备 / 第一件装备之类的引导：条件够了时弹出
      if (A.save.auto.on && A.activity.type === 'farm' && G.autoDecide(A.save).type === 'wait') step();
    }
    if (A.tab === 'cave' && A.els.otherPage && A.els.otherPage.isConnected) {
      const sig = A.caveSignature();
      if (sig !== A.caveSig) { A.caveSig = sig; A.renderMain(); }
    }
    liveText();
    const done = G.tickResearch(A.save, now);
    if (done) {
      const c = G.getChar(A.save, done.charId);
      A.toast(`研究完成：上阵位 ${done.level} 个${c && G.inLineup(A.save, c.id) ? `，${c.name} 已上阵` : ''}`, 'good');
      A.persist();
      A.render();
      if (A.save.auto.on && A.activity.type !== 'push') step();
      return;
    }
    const ra = A.save.research.active;
    if (ra && A.els.researchLeft) {
      A.els.researchLeft.textContent = A.fmtGame(ra.endsAt - A.gnow());
      if (A.els.researchFill) A.els.researchFill.style.width = Math.min(100, 100 * (1 - (ra.endsAt - A.gnow()) / (ra.endsAt - ra.startedAt))) + '%';
    }
  }

  Object.assign(A, {
    toggleAuto, manualChallenge, manualFarm, onPushEnd, stopFarm, step, tick,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
