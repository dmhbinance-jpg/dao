/**
 * 游戏界面 · main
 * 页面骨架与启动：render / renderMain（按当前页签画），boot（读存档位、和硬盘对一遍、进标题页、事件监听）。最后加载。
 * 共享状态和公共工具在 app-core.js（DAO.App）。
 * 对外（挂在 DAO.App 上）：renderMain、render
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const UI = DAO.UI;
  const G = DAO.Game;
  const h = UI.h;
  const A = DAO.App;

  function renderMain() {
    // 关卡页的战斗回放组件只建一次，切页时保留（推关回放在后台继续）
    if (!A.els.stagesPage) {
      A.els.stagesPage = h('div', { class: 's1-stages' });
      A.stageListEl = A.stageList();
      A.els.stagesPage.appendChild(A.stageListEl);
      A.els.stagesPage.appendChild(A.battlePanel());
    }
    A.els.stagesPage.hidden = A.tab !== 'stages';
    if (A.tab === 'stages') A.refreshStageList();
    if (A.els.otherPage) A.els.otherPage.remove();
    A.els.otherPage = null;
    if (A.tab === 'cave' && A.save.unlocks.cave) A.els.otherPage = A.cavePage();
    else if (A.tab === 'roster') A.els.otherPage = A.rosterPage();
    else if (A.tab === 'bag') A.els.otherPage = A.bagPage();
    if (!A.els.stagesPage.isConnected) A.els.app.appendChild(A.els.stagesPage);
    if (A.els.otherPage) A.els.app.appendChild(A.els.otherPage);
    if (A.els.banner) { UI.clear(A.els.banner); A.els.banner.appendChild(A.resultBanner()); }
    if (A.els.battleHead) {
      UI.clear(A.els.battleHead);
      const o = (A.pending || A.lastSettle || {}).outcome;
      if (o) {
        const st = G.stageById(o.stageId);
        A.els.battleHead.append(h('h2', null, `${st.id} ${st.name}`), h('span', { class: 'muted' }, st.note));
      } else {
        A.els.battleHead.append(h('h2', null, '战斗'), h('span', { class: 'muted' }, '推关的战斗在这里回放；挂机在后台进行。'));
      }
    }
  }
  function render() {
    if (!A.save) { if (A.title.mode === 'chooser') A.renderChooser(A.title.slot); else A.renderTitle(); return; }
    if (A.tab === 'cave' && !A.save.unlocks.cave) A.tab = 'stages';
    if (A.tab === 'bag' && !(A.save.cardsInfo.firstGot || G.bagCount(A.save) > 0)) A.tab = 'stages';
    if (!A.els.stagesPage || !A.els.stagesPage.isConnected) UI.clear(A.els.app);
    A.renderHeader();
    A.renderActivity();
    renderMain();
    A.renderModal();
  }

  function boot() {
    A.els.app = document.getElementById('app');
    A.els.chips = document.getElementById('chips');
    A.els.nav = document.getElementById('nav');
    A.els.activity = document.getElementById('activity');
    A.els.modal = document.getElementById('modal');
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) saveBtn.addEventListener('click', A.openSaveMenu);
    // 老的单一存档放进第 1 个存档位；从本地服务打开时和硬盘对一遍，再进标题页
    A.slots.importLegacy(Date.now());
    document.body.classList.add('at-title');
    A.els.app.appendChild(h('p', { class: 'muted title-wait' }, '正在读取存档…'));
    A.Disk.init().then(() => { A.Disk.sync(A.slots, Date.now()); }).catch(() => {}).then(() => { if (!A.save) A.renderTitle(); });
    setInterval(A.tick, 1000);
    // 离开页面前自动保存（硬盘用 sendBeacon，页面关掉也能送达）
    const flush = () => {
      if (!A.save || !A.curSlot) return;
      G.setClock(A.save, A.clock.save());
      const w = A.slots.write(A.curSlot, A.save, Date.now(), { reason: 'auto' });
      if (w.ok) A.Disk.beacon(A.curSlot, w.raw);
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    // 别的页面改了存档位：
    //  - 另一个游戏页面在玩同一个存档位 → 本页让出来回标题页（不然两边会互相覆盖）
    //  - 存档工具改的（读得出来）→ 重新读入
    //  - 写成了读不出来的数据 / 被删除 → 本页停下，不覆盖、不删除
    window.addEventListener('storage', (e) => {
      if (!e.key || !e.key.startsWith('dao.slot')) return;
      if (!A.curSlot) { if (!A.save && A.title.mode !== 'chooser') A.renderTitle(); return; }
      if (e.key !== A.slots.key(A.curSlot)) return;
      const n = A.curSlot;
      const stop = (msg, mode) => { A.toast(msg, 'bad'); A.stopSession(); A.save = null; A.curSlot = null; A.title = { mode: mode || 'main' }; render(); };
      if (e.newValue == null) return stop(`存档位 ${n} 在别的页面被删除了：本页停止保存（删除前的数据在备份里）`);
      const owner = A.slots.owner(n);
      if (owner && owner.tab !== A.TAB_ID && Date.now() - owner.at < 30000) return stop(`存档位 ${n} 在另一个游戏页面里打开了：本页已停下，避免两边互相覆盖`);
      const r = A.slots.parse(e.newValue, Date.now());
      if (r.status !== 'ok') return stop(`存档位 ${n} 在别的页面被写成了读不出来的数据（${r.errorText}）：本页停止保存，没有覆盖它`, 'load');
      A.openSlot(n);
      A.toast('存档在别处被修改（存档工具？），已重新读入');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  Object.assign(A, {
    renderMain, render,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
