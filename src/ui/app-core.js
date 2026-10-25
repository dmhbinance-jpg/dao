/**
 * 游戏界面 · core
 * 公共状态与工具：共享状态（DAO.App 上的 save、tab、activity、clock 等）、存档会话（读存档位、保存、回标题页）、格式化 / 提示 / 小组件。
 * 只负责显示和把玩家操作转给 DAO.Game（规则在 src/game/），不直接改存档字段；存档位读写走 DAO.SaveSlots，写硬盘走 DAO.SaveDisk。
 * 页面文件（src/ui/app-*.js）共享 DAO.App：跨文件用到的状态写成 A.名字，函数在定义的文件里导出到 A。加载顺序：app-core 最先，app-main 最后。
 * 对外（挂在 DAO.App 上）：store、slots、Disk、farm、gnow、els、stopSession、openSlot、TAB_ID、persist、backToTitle、exportText、fileStamp、fmtDate、charGlyph、STAT_NAME、STATUS_NAME、fmtTime、skillDesc、talentDesc、tierClass、statRows、qualityBadge、toast、levelToast、talentTagsOf、tagChips、cardName、cardQuality、cardRange、cardVal、tierOf、cardSkillLine、cardRoles、SLOT_NAME、oreText、gearStatText、gearLine、fmtGame、costText、dropToast、showModal、changed
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const UI = DAO.UI;
  const G = DAO.Game;
  const h = UI.h;
  const A = (DAO.App = DAO.App || {});

  const store = UI.makeStore('dao.');   // 界面偏好（回放速度等），不是存档
  let ls = null;
  try { ls = root.localStorage; } catch (e) { ls = null; }
  const slots = DAO.SaveSlots.create({ storage: ls ? DAO.SaveSlots.browserStorage(ls) : DAO.SaveSlots.memoryStorage() });
  const Disk = DAO.SaveDisk;

  A.save = null;
  A.curSlot = null;              // 正在玩的存档位（标题页时为 null）
  A.title = { mode: 'main' };    // 标题页：main | new | load | import | backups（slot）
  A.titleArm = null;             // 标题页上等待二次确认的按钮 key
  A.tab = 'stages';
  A.view = null;                 // 战斗回放组件
  A.pending = null;              // 正在播放、尚未结算的推关战斗 { outcome, startedAt }
  A.lastSettle = null;           // 最近一次推关的结算 { outcome, r }
  A.activity = { type: 'none' }; // none | push | farm | wait
  const farm = { timer: null, tick: null, outcome: null, startedAt: 0, dur: 0, stageId: null, session: null };
  A.autoTimer = null;
  A.modalClosedFor = null;       // 玩家点了「稍后」的引导 id
  A.lastRecruit = null;          // 洞府页展示最近一次招募结果
  A.adhoc = null;                // 临时弹窗（换卡确认、插卡结果）{ title, body, extra, buttons: [{label, primary, onClick}] }
  A.caveSig = '';                                    // 洞府页的状态签名：变了就重画（灵矿、金币涨了按钮能不能点等）
  A.hintSig = '';
  A.lastPersist = 0;
  // 游戏时钟：所有按时间走的规则（研究、采集、挂机、战斗播放）都从这里取 now；倍率 = CONFIG.debug.timeScale
  A.clock = DAO.GameClock.create({ scale: DAO.CONFIG.debug.timeScale });
  const gnow = () => A.clock.now();
  const els = {};

  // ================= 存档 =================
  /** 停掉当前这局的计时、回放（读另一个存档位 / 回标题页前） */
  function stopSession() {
    clearTimeout(A.autoTimer);
    A.stopFarm();
    if (A.view) A.view.stop();
    A.pending = null; A.lastSettle = null; A.lastRecruit = null; A.activity = { type: 'none' }; farm.session = null; A.adhoc = null;
    els.stagesPage = null; els.otherPage = null; A.view = null; A.headerSig = ''; A.hintSig = ''; A.caveSig = '';
    A.modalClosedFor = null;
    if (els.modal) els.modal.hidden = true;
    A.tab = 'stages';
  }
  /** 读一个存档位进游戏。读不出来时不进游戏、不改存档，返回读取结果（标题页显示错误） */
  function openSlot(n) {
    const r = slots.read(n, Date.now());
    if (r.status !== 'ok') return r;
    stopSession();
    A.curSlot = n;
    A.save = r.save;
    slots.setLast(n);
    // 游戏时间从存档里记的接着走（老存档没有就从现在起步）
    A.clock = DAO.GameClock.create({ scale: DAO.CONFIG.debug.timeScale, saved: A.save.clock });
    // 采集、打造都不补离线：重新打开页面时从现在开始算
    G.resumeGather(A.save, gnow());
    G.resumeProduction(A.save, gnow());
    persist(r.migratedFrom != null ? 'migrate' : 'auto');
    if (r.migratedFrom != null) toast(`存档已从 v${r.migratedFrom} 升级到 v${DAO.CONFIG.game.saveVersion}；升级前的原始存档已另存一份`, 'good');
    A.leaveTitle();
    A.render();
    A.step();
    return r;
  }
  /**
   * 保存（写浏览器 + 硬盘）。reason：auto（定时 / 操作后）、manual（手动保存）、title（回标题页）。
   * 存档位被别的页面写成了读不出来的数据时拒绝写（不覆盖），停下这局回到标题页。
   */
  let lastStorageWarn = 0;
  const TAB_ID = Math.random().toString(36).slice(2, 10);   // 这个页面的标识：两个游戏页面开着同一个存档位时，后写的那边让出来
  function persist(reason) {
    if (!A.save || !A.curSlot) return false;
    G.setClock(A.save, A.clock.save());
    slots.claim(A.curSlot, TAB_ID, Date.now());   // 先登记「这个页面在写」，再写存档（别的页面收到改动时能看到是谁写的）
    const w = slots.write(A.curSlot, A.save, Date.now(), { reason: reason || 'auto' });
    if (!w.ok) {
      if (w.error === 'protected') {
        toast(`存档位 ${A.curSlot} 被别的页面写成了这个版本读不出来的数据：本页停止保存，没有覆盖它`, 'bad');
        backToTitle(false);
      } else if (Date.now() - lastStorageWarn > 30000) {
        lastStorageWarn = Date.now();
        toast('浏览器存档写不进去（存储空间满了，或者浏览器禁止了存储）' + (Disk.disk.state === 'ok' ? '；硬盘存档照常' : ''), 'bad');
        if (Disk.disk.state === 'ok') Disk.put(A.curSlot, JSON.stringify(A.save), { now: true });
      }
      return false;
    }
    Disk.put(A.curSlot, w.raw, { backup: w.backedUp });
    return true;
  }
  /** 回到标题页（先保存，留一份备份） */
  function backToTitle(doSave) {
    if (doSave !== false) persist('title');
    stopSession();
    A.save = null;
    A.curSlot = null;
    A.title = { mode: 'main' };
    A.render();
  }
  function exportText(text, name) {
    const blob = new Blob([text], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const fileStamp = (t) => new Date(t || Date.now()).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const fmtDate = (t) => { if (!t) return '—'; const d = new Date(t); const p2 = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };

  // ================= 小工具 =================
  /** 角色头像位：资源清单里有图就用图，没有（目前都是占位）退回定位色块 */
  const charArt = (c) => c.art || (DAO.CONFIG.game.starters[c.role] || {}).art;
  const charGlyph = (c) => UI.artBox(charArt(c), { use: 'portrait', text: c.role === 'sword' ? '剑' : '法', cls: 'role-glyph role-' + c.role, title: c.name });
  const STAT_NAME = { str: '力', agi: '敏', int: '智' };
  const STATUS_NAME = { lineup: '上阵', idle: '闲置', research: '研究中', craft: '打造中', gather: '采集中', new: '新人' };
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
  // ---- 装备 ----
  const SLOT_NAME = () => DAO.CONFIG.game.production.slotNames;
  const oreText = (x) => UI.num(Math.floor(x));
  function gearStatText(stats) {
    const names = { atk: '攻击', armor: '护甲', resist: '法抗', hp: '气血', str: '力', agi: '敏', int: '智' };
    return Object.entries(stats).map(([k, v]) => `${names[k] || k} +${v}`).join(' · ');
  }
  function gearLine(item) { return h('span', { class: 'gear-name gq-' + item.quality + (G.gearUsable(item) ? '' : ' off') }, G.gearName(item)); }
  /** 一段游戏时长换成真实剩余时间显示（时间倍率下倒计时按真实时间走） */
  const fmtGame = (gameMs) => fmtTime(A.clock.realMs(gameMs));
  /** 花费 / 收入 { gold?, ore?, herb?, stone? } → 「60 灵矿 · 150 金」 */
  function costText(c) {
    const parts = Object.entries(c || {}).filter(([k, v]) => k !== 'gold' && v).map(([k, v]) => `${UI.num(Math.floor(v))} ${G.matName(k)}`);
    if (c && c.gold) parts.push(`${UI.num(c.gold)} 金`);
    return parts.join(' · ') || '0';
  }

  function dropToast(drops) {
    if (!drops || !drops.length) return;
    const cnt = {};
    for (const id of drops) cnt[id] = (cnt[id] || 0) + 1;
    toast('掉落：' + Object.entries(cnt).map(([id, n]) => cardName(id) + (n > 1 ? ' ×' + n : '')).join('、'), 'good');
  }
  function showModal(spec) { A.adhoc = spec; A.renderModal(); }
  function changed() { persist(); A.render(); }

  Object.assign(A, {
    store, slots, Disk, farm, gnow, els, stopSession, openSlot, TAB_ID, persist, backToTitle, exportText, fileStamp, fmtDate, charGlyph,
    STAT_NAME, STATUS_NAME, fmtTime, skillDesc, talentDesc, tierClass, statRows, qualityBadge, toast, levelToast, talentTagsOf, tagChips, cardName,
    cardQuality, cardRange, cardVal, tierOf, cardSkillLine, cardRoles, SLOT_NAME, oreText, gearStatText, gearLine, fmtGame, costText, dropToast,
    showModal, changed,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
