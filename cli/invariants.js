#!/usr/bin/env node
/**
 * 不变量检查（战斗、事件时间线、回放、资源清单）。改引擎、日志、回放、配置后跑一遍：
 *   node cli/invariants.js [每关种子数=3]
 * 全部通过退出码 0，否则 1。
 *
 *  A. 战斗：同种子结果一致；记录事件（record）与否结果一致
 *  B. 事件时间线：id / 时间 / 回合有序；父事件存在且在前；每次命中一条，血量前后对得上并且首尾相接；
 *     统计（伤害、治疗、出手、暴击、击杀）能从事件加总出来；每拍有快照；文字日志由事件生成且每次命中一行
 *  C. 回放：1× / 2× / 4×、中途暂停 / 继续、中途改速度、开头 / 中间 / 结尾跳过——渲染器收到的拍序列、最终状态都一样，
 *     结束恰好一次，时间线和战斗结果不被修改；游戏结算不受回放方式影响
 *  D. 规则：再动每回合 ≤ 1；每排 ≤ 3；破甲不让防御低于 0；每次命中伤害 ≥ 1
 *  E. 资源：配置里的 art 都在资源清单登记，清单没有多余 id；找不到资源时返回 null（界面退回文字 / 色块）
 *  F. 时间：游戏时钟累加「真实流逝 × 倍率」不跳变；倍率 10 时研究 / 采集 / 挂机都按 10 倍推进；倍率不改战斗结果
 *  G. 招募：3 名候选同种子一致；首抽互补、排除流影；价格固定；名额满不能招；候选存档、不能放弃重抽；为采集招募默认选力资质最高
 *  H. 调参：tuning 按路径合并、错误项不生效
 *  I. 打造：品质同种子一致、按概率表；占用角色、状态优先级；按时长完成进背包；取消退还；离线不计；走游戏时钟；v5 存档迁移
 */
'use strict';
const DAO = require('../src/node.js');
const G = DAO.Game;
const C = DAO.CONFIG;
const SEEDS = Number(process.argv[2] || 3);
const T0 = new Date(2026, 9, 24, 9, 0, 0).getTime();
const clone = (o) => JSON.parse(JSON.stringify(o));
const t0 = Date.now();

const fails = {};
const order = [];
let checks = 0;
function check(name, ok, detail) {
  checks++;
  if (!order.includes(name)) order.push(name);
  if (!ok) (fails[name] = fails[name] || []).push(detail || '');
}
const ROOTS = ['battleStart', 'roundStart', 'action', 'battleEnd'];

// ---------------- 样本：V0 满编对局 + 游戏三段所有关卡 ----------------
function v0Battles() {
  const T = C.defaultTeams;
  const out = [];
  for (let s = 1; s <= 30; s++) out.push({ name: `V0 默认阵容 种子 ${s}`, make: (rec) => new DAO.Battle(T.A, T.B, { seed: s, record: rec }) });
  return out;
}
/** 游戏阵容：开局角色 + 两个招募角色（带卡），部分带装备 */
function gameSave(role, lv, gearTier) {
  const s = G.newSave(role, 't', T0);
  s.gold = 1e6; s.unlocks.cave = true; s.recruit.freeUsed = true; s.research.slots = 3;
  s.cardsInfo.firstGot = true;
  s.roster[0].level = lv;
  s.roster[0].card = { id: C.game.cards.firstCard[role], roll: 0.5 };
  for (const r of [role === 'sword' ? 'mage' : 'sword', role]) {
    const c = G.rollRecruit(s, { role: r });
    s.nextId++;
    c.level = Math.max(1, lv - 1);
    s.roster.push(c);
    G.addToLineup(s, c.id);
  }
  G.applyDefaultRows(s);
  if (gearTier != null) for (const c of s.roster) for (const slot of G.gearSlots()) c.equip[slot] = { id: 'x' + c.id + slot, slot, quality: G.qualities()[gearTier].id };
  return s;
}
function gameBattles() {
  const out = [];
  const stages = G.stages();
  stages.forEach((st, i) => {
    const lv = Math.max(1, st.enemies.reduce((m, e) => Math.max(m, e.level), 1));
    for (const role of ['sword', 'mage']) {
      for (let k = 0; k < SEEDS; k++) {
        const gear = i % 3 === 0 ? null : i % 3 - 1;
        const L0 = Math.max(1, lv + [-3, 0, 3][k % 3]);   // 等级有高有低，既有一边倒也有势均力敌的局
        out.push({
          name: `${st.id} ${role} Lv${L0} 种子 ${k}`,
          make: (rec) => { const s = gameSave(role, L0, gear); s.seedCounter = 500 + i * 37 + k; const L = G.lineups(s, st); return new DAO.Battle(L.A, L.B, { seed: s.seedCounter, record: rec }); },
        });
      }
    }
  });
  return out;
}
const samples = v0Battles().concat(gameBattles());

const summary = (r) => JSON.stringify({ w: r.winner, rd: r.rounds, t: r.time, to: r.timeout, u: r.units.map((u) => [u.uid, u.hp, u.alive, u.stats]) });

// ---------------- 模拟时钟 + 记录用渲染器 ----------------
function fakeClock() {
  let now = 0, seq = 0;
  const q = [];
  return {
    setTimeout(fn, ms) { const id = ++seq; q.push({ id, at: now + Math.max(0, ms), fn }); return id; },
    clearTimeout(id) { const i = q.findIndex((x) => x.id === id); if (i >= 0) q.splice(i, 1); },
    /** 推进到下一个计时器；没有了返回 false */
    tick() { if (!q.length) return false; q.sort((a, b) => a.at - b.at || a.id - b.id); const x = q.shift(); now = x.at; x.fn(); return true; },
    pending: () => q.length,
    now: () => now,
  };
}
function recorder() {
  const r = { mounted: 0, beats: [], ends: 0, last: null };
  return Object.assign(r, {
    mount() { r.mounted++; },
    beat(b, o) { r.beats.push(b.index + (o && o.fast ? 'f' : '')); if (b.snapshot) r.last = b.snapshot; },
    end() { r.ends++; },
  });
}
/** 按脚本回放：actions = { at: 第几拍之后, do: 'pause'|'resume'|'speed:N'|'skip' } */
function replayWith(tl, speed, script) {
  const clock = fakeClock();
  const rec = recorder();
  let endedCb = 0;
  const rp = DAO.Replay.create(tl, rec, { speed, clock, onEnd: () => endedCb++ });
  rp.play();
  const todo = (script || []).slice();
  let guard = 0;
  while (guard++ < 100000) {
    const st = rp.state();
    while (todo.length && st.index >= todo[0].at) {
      const a = todo.shift().do;
      if (a === 'pause') rp.pause();
      else if (a === 'resume') rp.resume();
      else if (a === 'skip') rp.skip();
      else if (a.startsWith('speed:')) rp.setSpeed(Number(a.slice(6)));
    }
    if (rp.state().ended) break;
    if (!clock.tick()) { if (!rp.state().playing && !rp.state().ended) rp.resume(); else break; }
  }
  return { rec, endedCb, elapsed: clock.now(), state: rp.state() };
}

// ---------------- 逐场检查 ----------------
for (const smp of samples) {
  const b1 = smp.make(true), r1 = b1.run();
  const b2 = smp.make(true), r2 = b2.run();
  const b0 = smp.make(false), r0 = b0.run();
  const tl = r1.timeline;
  // A
  check('A1 同种子结果与时间线一致', JSON.stringify(r1) === JSON.stringify(r2), smp.name);
  check('A2 记录事件与否结果一致', summary(r1) === summary(r0) && r0.timeline === null, smp.name);

  // B
  const ev = tl.events;
  const byId = new Map();
  let okOrder = true, okParent = true, okRoots = true;
  ev.forEach((e, i) => {
    if (e.id !== i + 1) okOrder = false;
    if (i && (e.t < ev[i - 1].t - 1e-9 || e.round < ev[i - 1].round)) okOrder = false;
    if (e.parent == null) { if (!ROOTS.includes(e.type)) okRoots = false; }
    else if (!byId.has(e.parent)) okParent = false;
    if (ROOTS.includes(e.type) && e.parent != null) okRoots = false;
    byId.set(e.id, e);
  });
  check('B1 事件 id 递增、时间和回合不倒退', okOrder, smp.name);
  check('B2 每个非根事件的父事件存在且在它之前', okParent, smp.name);
  check('B3 根事件只有 battleStart / roundStart / action / battleEnd', okRoots && ev[0].type === 'battleStart' && ev[ev.length - 1].type === 'battleEnd' &&
    ev.filter((e) => e.type === 'battleStart').length === 1 && ev.filter((e) => e.type === 'battleEnd').length === 1, smp.name);

  const hp = {}, maxHp = {};
  for (const u of tl.units) { hp[u.uid] = u.maxHp; maxHp[u.uid] = u.maxHp; }
  const agg = {};
  const A = (uid) => (agg[uid] = agg[uid] || { dmg: 0, heal: 0, actions: 0, crits: 0, kills: 0, extra: {} });
  let okHit = true, okChain = true, okDeath = true, okMin = true;
  for (const e of ev) {
    if (e.type === 'hit') {
      const loss = e.dmg - e.absorbed;
      if (e.hpAfter !== Math.max(0, e.hpBefore - loss) || e.absorbed > e.shieldBefore || e.absorbed < 0 || e.killed !== (e.hpAfter === 0)) okHit = false;
      if (e.hpBefore !== hp[e.target]) okChain = false;
      hp[e.target] = e.hpAfter;
      if (e.dmg < C.damage.minDamage) okMin = false;
      A(e.actor).dmg += (e.hpBefore - e.hpAfter) + e.absorbed;
      if (e.crit) A(e.actor).crits++;
      if (e.killed && !ev.some((d) => d.type === 'death' && d.parent === e.id && d.target === e.target)) okDeath = false;
    } else if (e.type === 'heal') {
      if (e.hpBefore !== hp[e.target] || e.hpAfter !== e.hpBefore + e.amount || e.hpAfter > maxHp[e.target]) okChain = false;
      hp[e.target] = e.hpAfter;
      A(e.actor).heal += e.amount;
    } else if (e.type === 'action') {
      A(e.actor).actions++;
      if (e.extra) { const k = e.round; A(e.actor).extra[k] = (A(e.actor).extra[k] || 0) + 1; }
    } else if (e.type === 'death') A(e.actor).kills++;
  }
  check('B4 每次命中：血量前后、护盾吸收、击杀标记对得上', okHit, smp.name);
  check('B5 每个单位的血量在命中 / 治疗事件之间首尾相接', okChain, smp.name);
  check('B6 致死命中后面跟着一条死亡事件', okDeath, smp.name);
  const endSnap = tl.snapshots[ev[ev.length - 1].id];
  check('B7 事件推出的最终血量 = 战斗结果 = 结束快照', r1.units.every((u) => hp[u.uid] === u.hp && endSnap[u.uid].hp === u.hp), smp.name);
  check('B8 伤害 / 治疗 / 出手 / 暴击 / 击杀统计能从事件加总出来', r1.units.every((u) => {
    const a = agg[u.uid] || A(u.uid);
    return a.dmg === u.stats.dmgEffective && a.heal === u.stats.healDone && a.actions === u.stats.actions && a.crits === u.stats.crits && a.kills === u.stats.kills;
  }), smp.name);
  const trig = ev.filter((e) => e.type === 'trigger');
  check('B9 触发事件都有效果事件挂在下面；再动 / 减 CD 只来自触发', trig.every((t) => ev.some((x) => x.parent === t.id)) &&
    ev.filter((e) => e.type === 'cdReduce' || e.type === 'extraAction').every((e) => byId.get(e.parent).type === 'trigger'), smp.name);
  const beats = DAO.Replay.beats(tl);
  check('B10 每一拍都有快照', beats.every((b) => b.snapshot), smp.name);
  const lines = beats.flatMap((b) => DAO.BattleLog.formatBeat(b, tl));
  check('B11 文字日志由事件生成：每次命中一行', lines.filter((l) => l.kind === 'hit' || l.kind === 'crit').length === ev.filter((e) => e.type === 'hit').length &&
    lines.filter((l) => l.kind === 'action').length === ev.filter((e) => e.type === 'action').length, smp.name);

  // D
  check('D1 再动每回合 ≤ ' + C.actionBar.maxExtraActionsPerRound, Object.values(agg).every((a) => Object.values(a.extra).every((n) => n <= C.actionBar.maxExtraActionsPerRound)), smp.name);
  check('D2 每排 ≤ ' + C.formation.maxPerRow, ['A', 'B'].every((sd) => ['front', 'back'].every((rw) => tl.units.filter((u) => u.side === sd && u.row === rw).length <= C.formation.maxPerRow)), smp.name);
  check('D4 每次命中伤害 ≥ ' + C.damage.minDamage, okMin, smp.name);

  // E（单位和技能的资源 id）
  check('E3 时间线里的单位和技能都带登记过的资源 id', tl.units.every((u) => DAO.Art.known(u.art) && u.skills.every((s) => DAO.Art.known(s.art))), smp.name + ' ' + tl.units.filter((u) => !DAO.Art.known(u.art) || u.skills.some((s) => !DAO.Art.known(s.art))).map((u) => u.art + ':' + u.skills.map((s) => s.art).join('/')).join(' '));
}

// ---------------- C. 回放 ----------------
const replaySamples = samples.filter((_, i) => i % 7 === 0);
for (const smp of replaySamples) {
  const r = smp.make(true).run();
  const tl = r.timeline;
  const frozen = JSON.stringify(r);
  const n = DAO.Replay.beats(tl).length;
  const total = DAO.Replay.totalMs(tl);
  const mid = Math.floor(n / 2);
  const variants = {
    '1×': [1, []], '2×': [2, []], '4×': [4, []],
    '中途暂停再继续': [1, [{ at: mid, do: 'pause' }, { at: mid, do: 'resume' }]],
    '中途改 4×': [1, [{ at: mid, do: 'speed:4' }]],
    '开头跳过': [1, [{ at: 0, do: 'skip' }]],
    '中间跳过': [2, [{ at: mid, do: 'skip' }]],
    '最后一拍跳过': [4, [{ at: n - 1, do: 'skip' }]],
  };
  const res = {};
  for (const [k, [sp, sc]] of Object.entries(variants)) res[k] = replayWith(tl, sp, sc);
  const order = (x) => x.rec.beats.map((b) => parseInt(b, 10)).join(',');
  const want = Array.from({ length: n }, (_, i) => i).join(',');
  const endSnap = JSON.stringify(tl.snapshots[tl.events[tl.events.length - 1].id]);
  for (const [k, x] of Object.entries(res)) {
    check('C1 每种播放方式都按顺序画完所有拍、结束恰好一次', order(x) === want && x.rec.ends === 1 && x.endedCb === 1 && x.rec.mounted === 1 && x.state.ended, `${smp.name} ${k}`);
    check('C2 每种播放方式的最终状态 = 结束快照', JSON.stringify(x.rec.last) === endSnap, `${smp.name} ${k}`);
  }
  for (const sp of [1, 2, 4]) check('C3 播放时长 = 总时长 ÷ 速度', Math.abs(res[sp + '×'].elapsed - total / sp) < 1e-6, `${smp.name} ${sp}× ${res[sp + '×'].elapsed} vs ${total / sp}`);
  check('C4 跳过的拍标记为 fast，其余不是', res['开头跳过'].rec.beats.every((b, i) => (i === 0 ? !b.endsWith('f') : b.endsWith('f'))), smp.name);
  check('C5 回放不修改时间线和战斗结果', JSON.stringify(r) === frozen, smp.name);
}
// 游戏结算：同一场推关，4× 看完 vs 立刻跳过 → 结算后的存档一样
for (const role of ['sword', 'mage']) {
  const base = gameSave(role, 14, 1);
  base.seedCounter = 4242;
  const o = G.runBattle(base, '2-5', { record: true });
  const frozen = JSON.stringify(o.result);
  const sA = clone(base), sB = clone(base);
  replayWith(o.result.timeline, 4, []);
  const rA = G.applyOutcome(sA, o, { kind: 'push', elapsedMs: 0 });
  replayWith(o.result.timeline, 1, [{ at: 0, do: 'skip' }]);
  const rB = G.applyOutcome(sB, o, { kind: 'push', elapsedMs: 0 });
  check('C6 游戏结算不受播放速度 / 跳过影响', JSON.stringify(sA) === JSON.stringify(sB) && JSON.stringify(rA) === JSON.stringify(rB) && JSON.stringify(o.result) === frozen, role);
  const o2 = G.runBattle(base, '2-5', { record: false });
  check('C7 推关（记录事件）和挂机（不记录）同一场结果一致', o2.win === o.win && o2.exp === o.exp && o2.gold === o.gold && JSON.stringify(o2.drops) === JSON.stringify(o.drops), role);
}

// ---------------- D. 规则（静态） ----------------
check('D2 每排 ≤ 3：阵容校验拒绝一排 4 人', DAO.Model.validateLineup([1, 2, 3, 4].map((i) => ({ charId: 'c' + i, row: 'front' }))).length > 0);
check('D3 破甲不让防御低于 0', DAO.Damage.defenseMul(-500) === DAO.Damage.defenseMul(0) && DAO.Damage.defenseMul(0) === 1);

// ---------------- E. 资源清单 ----------------
{
  const used = new Map();
  const use = (id, what) => { if (!used.has(id)) used.set(id, []); used.get(id).push(what); };
  for (const [k, v] of Object.entries(C.basicSkills)) use(v.art, '普攻 ' + k);
  for (const [k, v] of Object.entries(C.innateSkills)) use(v.art, '固有技能 ' + k);
  for (const [k, v] of Object.entries(C.cards)) use(v.art, '技能卡 ' + k);
  for (const [k, v] of Object.entries(C.characters)) use(v.art, 'V0 角色 ' + k);
  for (const [k, v] of Object.entries(C.game.starters)) use(v.art, '开局角色 ' + k);
  for (const [k, v] of Object.entries(C.game.enemies)) use(v.art, '敌人 ' + k);
  for (const line of Object.keys(C.game.production.lines)) for (const [k, v] of Object.entries((C.game[line] || {}).recipes || {})) use(v.art, '装备 ' + k);
  const missing = [...used.entries()].filter(([id]) => !id || !DAO.Art.known(id)).map(([id, w]) => `${id}（${w.join('、')}）`);
  const orphan = DAO.Art.ids().filter((id) => !used.has(id));
  check('E1 配置里的角色 / 敌人 / 技能 / 技能卡 / 装备都有 art，且都在资源清单登记', !missing.length, missing.join('；'));
  check('E2 资源清单没有多余的 id', !orphan.length, orphan.join('、'));
  // 查询规则：占位 / 没登记 / 用途缺图 → null；字符串 / 对象 → 拼 root
  const imgs = C.assets.images;
  const keep = clone(imgs);
  imgs['__t.str'] = 'a/b.png'; imgs['__t.obj'] = { portrait: 'p.png', default: 'd.png' }; imgs['__t.objNoDef'] = { icon: 'i.png' };
  const R = C.assets.root;
  check('E4 找不到资源时返回 null（界面退回文字 / 色块）', DAO.Art.path('unit.sword') === null && DAO.Art.path('nope.nope') === null && DAO.Art.path(null) === null &&
    DAO.Art.path('__t.objNoDef', 'portrait') === null);
  check('E5 登记了路径时按用途取图、取不到用 default', DAO.Art.path('__t.str') === R + 'a/b.png' && DAO.Art.path('__t.obj', 'portrait') === R + 'p.png' &&
    DAO.Art.path('__t.obj', 'icon') === R + 'd.png' && DAO.Art.path('__t.objNoDef', 'icon') === R + 'i.png');
  for (const k of Object.keys(imgs)) if (!(k in keep)) delete imgs[k];
}

// ---------------- F. 时间倍率 / 游戏时钟 ----------------
{
  // 模拟真实时钟：可以前进、停住、倒退
  let real = 1000;
  const clk = DAO.GameClock.create({ scale: 10, realNow: () => real });
  const g0 = clk.now();
  real += 60000; const g1 = clk.now();
  real -= 5000; const g2 = clk.now();          // 真实时钟倒退：游戏时间不倒退
  real += 5000; const g3 = clk.now();          // 回到原处：不重复计时
  real += 1000; const g4 = clk.now();
  check('F1 游戏时钟 = 累加的真实流逝 × 倍率，不跳变、不倒退', g1 - g0 === 600000 && g2 === g1 && g3 === g1 && g4 - g3 === 10000);
  const saved = clk.save();
  real += 30000;
  const clk2 = DAO.GameClock.create({ scale: 10, realNow: () => real, saved });
  check('F2 重新打开时从存档的游戏时间接着走（关闭期间按倍率计入）', clk2.now() === saved.game + 300000);
  const clk1 = DAO.GameClock.create({ scale: 1, realNow: () => real });
  check('F3 倍率 1 时游戏时间就是真实时间', clk1.now() === real);

  // 研究 / 采集 / 挂机按倍率推进：真实流逝相同，倍率 10 的推进量是倍率 1 的 10 倍
  const progress = (scale) => {
    let rl = 5000;
    const ck = DAO.GameClock.create({ scale, realNow: () => rl });
    const s = gameSave('sword', 12, null);
    s.unlocks.forge = true; s.research.slots = 2;
    const g = s.roster.find((c) => !G.inLineup(s, c.id)) || s.roster[2];
    G.removeFromLineup(s, s.lineup[s.lineup.length - 1].id);
    const gid = s.roster.find((c) => G.status(s, c.id) === 'idle').id;
    G.startGather(s, gid, ck.now());
    G.startResearch(s, s.lineup[s.lineup.length - 1].id, ck.now());
    const dur = s.research.active.endsAt - s.research.active.startedAt;
    rl += 3000;                                   // 真实 3 秒
    const now = ck.now();
    G.tickGather(s, now);
    const researchDone = !!G.tickResearch(s, now);
    // 挂机：一场后台战斗的真实等待 = 游戏时长 ÷ 倍率
    const o = G.runBattle(s, '1-3');
    return { ore: s.ore, researchDone, dur, idleReal: ck.realMs(G.backgroundBattleMs(o)), idleGame: G.backgroundBattleMs(o), gameElapsed: now - 5000 };
  };
  const p1 = progress(1), p10 = progress(10);
  check('F4 倍率 10：采集产出是倍率 1 的 10 倍', Math.abs(p10.ore - p1.ore * 10) < 1e-6 && p1.ore > 0, `${p1.ore} vs ${p10.ore}`);
  check('F5 倍率 10：研究倒计时 10 倍速（同样 3 秒真实时间，倍率 10 走完了 30 秒的研究进度）', p10.gameElapsed === 30000 && p1.gameElapsed === 3000 && p10.researchDone === (p10.dur <= 30000) && p1.researchDone === (p1.dur <= 3000), JSON.stringify([p1, p10]));
  check('F6 倍率 10：挂机每场的真实等待是倍率 1 的十分之一，游戏时长不变', Math.abs(p10.idleReal * 10 - p1.idleReal) < 1e-6 && p10.idleGame === p1.idleGame);
  // 战斗结果与倍率无关
  const keep = C.debug.timeScale;
  const before = samples.slice(0, 40).map((smp) => summary(smp.make(true).run()));
  C.debug.timeScale = 10;
  const after = samples.slice(0, 40).map((smp) => summary(smp.make(true).run()));
  C.debug.timeScale = keep;
  check('F7 时间倍率不改战斗结果（同种子倍率 1 / 10 结果一样）', JSON.stringify(before) === JSON.stringify(after));
}

// ---------------- G. 招募 3 选 1 / 名额 ----------------
{
  const mk = (role, seed, free) => { const s = G.newSave(role, 't', T0); s.unlocks.cave = true; s.gold = 1000; s.gachaSeed = seed; if (!free) s.recruit.freeUsed = true; G.recruit(s, T0); return s; };
  let same = true, firstOk = true, three = true;
  for (let i = 0; i < 200; i++) {
    const role = i % 2 ? 'sword' : 'mage';
    if (JSON.stringify(mk(role, 50 + i, false).recruitChoice) !== JSON.stringify(mk(role, 50 + i, false).recruitChoice)) same = false;
    const f = mk(role, 900 + i, true);
    const want = role === 'sword' ? 'mage' : 'sword';
    if (f.recruitChoice.cost !== 0 || !f.recruitChoice.candidates.every((c) => c.role === want && !C.game.recruit.firstExcludeInnates.includes(c.innate))) firstOk = false;
    if (f.recruitChoice.candidates.length !== C.game.recruit.candidates || new Set(f.recruitChoice.candidates.map((c) => c.name)).size !== C.game.recruit.candidates) three = false;
  }
  check('G1 同招募种子出同样的 3 名候选', same);
  check('G2 首抽免费，3 名候选都是互补定位、都不出流影', firstOk);
  check('G3 每次招募 3 名候选、名字不重复', three);
  const s = G.newSave('sword', 't', T0); s.unlocks.cave = true; s.recruit.freeUsed = true; s.gold = 1e6;
  const costs = [];
  while (G.canRecruit(s)) { const g0 = s.gold; G.recruit(s, T0); costs.push(g0 - s.gold); G.chooseRecruit(s, G.defaultChoice(s), T0); }
  check('G4 价格固定、多次招募不涨价', costs.every((c) => c === C.game.recruit.cost) && costs.length > 1, costs.join(','));
  check('G5 名额满 10 人时不能招募', s.roster.length === C.game.roster.cap && G.recruitBlock(s) === 'full');
  const t = G.newSave('mage', 't', T0); t.unlocks.cave = true; t.recruit.freeUsed = true; t.gold = 1000;
  G.recruit(t, T0);
  const blocked = G.recruit(t, T0);
  const kept = t.recruitChoice.candidates[1].name;
  const r = G.chooseRecruit(t, 1, T0);
  check('G6 候选存进存档；没选之前不能再招（不能放弃重抽）；选中的留下、其余离开', !blocked.ok && blocked.error === 'choosing' && r.char.name === kept && t.roster.length === 2 && !t.recruitChoice);
  const u = G.newSave('mage', 't', T0); u.unlocks.cave = true; u.unlocks.forge = true; u.recruit.freeUsed = true; u.gold = 1000;
  G.recruit(u, T0, { reason: 'gather' });
  const di = G.defaultChoice(u);
  const strMax = Math.max(...u.recruitChoice.candidates.map((c) => c.growth.str));
  const gr = G.chooseRecruit(u, di, T0);
  check('G7 为采集招募：默认选力资质最高的，选完直接去采集', u.roster.find((c) => c.id === gr.char.id).growth.str === strMax && G.isGathering(u, gr.char.id));
}

// ---------------- H. 调参（tuning.js） ----------------
{
  const cfg = clone(C);
  const res = DAO.Tuning.apply({ 'game.research.slots.levels.2.sec': 3, 'game.nope': 1, 'game.recruit.unlockStage': 5, 'assets.images["unit.sword"]': 'units/sword.png' }, cfg);
  check('H1 tuning 合并：已有的叶子按路径改；不存在 / 类型不对的不改并报出来', cfg.game.research.slots.levels[2].sec === 3 && cfg.assets.images['unit.sword'] === 'units/sword.png' &&
    res.applied.length === 2 && res.errors.length === 2 && cfg.game.recruit.unlockStage === C.game.recruit.unlockStage);
  check('H2 本次加载的 tuning.js 没有报错项', !DAO.Tuning.status.errors.length, JSON.stringify(DAO.Tuning.status.errors));
}

// ---------------- I. 打造（阶段 3.6） ----------------
{
  const seq = (seed) => { const s = G.newSave('sword', 't', T0); s.craftSeed = seed; return Array.from({ length: 50 }, () => G.rollQuality(s, 'forge')).join(','); };
  check('I1 掷品质：同种子结果一致', seq(17) === seq(17) && seq(17) !== seq(18));
  const cnt = {}; const s0 = G.newSave('mage', 't', T0); s0.craftSeed = 3;
  for (let i = 0; i < 20000; i++) { const qq = G.rollQuality(s0, 'forge'); cnt[qq] = (cnt[qq] || 0) + 1; }
  const tbl = C.game.production.qualityTables[1];
  check('I2 掷品质按工坊等级的概率表（1 级：白 90%、绿 10%，其余 0）', G.qualities().every((qq, i) => Math.abs((cnt[qq.id] || 0) / 20000 - tbl[i] / 100) < 0.01), JSON.stringify(cnt));
  // 流程：派人 → 计时 → 进背包 → 穿上；状态优先级；取消退还；离线不计；倍率
  const mk = () => {
    const s = G.newSave('sword', 't', T0); s.unlocks.cave = true; s.unlocks.forge = true; s.ore = 1000; s.gold = 5000; s.recruit.freeUsed = true;
    for (const r of ['mage', 'sword']) { const c = G.rollRecruit(s, { role: r }); s.nextId++; s.roster.push(c); }
    G.addToLineup(s, 'c2'); s.research.slots = 2;
    G.startGather(s, 'c3', T0);
    return s;
  };
  const s = mk();
  const cost = G.craftCost('weapon'), ore0 = s.ore, gold0 = s.gold;
  const okStart = G.startProduction(s, 'weapon', 'c3', T0);
  const dur = G.jobOf(s, 'forge').cur.durMs;
  const okState = okStart && G.status(s, 'c3') === 'craft' && !G.isGathering(s, 'c3') && G.researchBlock(s, 'c3') === 'crafting' && G.gatherBlock(s, 'c3') === 'crafting' &&
    !G.canAddToLineup(s, 'c3') && G.craftBlock(s, 'chest', 'c1') === 'busy' && G.craftBlock(s, 'weapon', 'c1') === 'busy' && s.ore === ore0 - cost.ore && s.gold === gold0 - cost.gold;
  check('I3 生产任务占用角色：状态「打造」（研究 > 打造 > 采集 > 上阵 > 闲置），不能上阵 / 研究 / 采集，锻造房 1 个工位，开工时扣第一件的材料', okState);
  const early = G.tickProduction(s, T0 + dur - 1);
  const done = G.tickProduction(s, T0 + dur);
  const j1 = G.jobOf(s, 'forge');
  const okDone = !early.length && done.length === 1 && s.gearBag.length === 1 && s.gearBag[0].slot === 'weapon' && G.status(s, 'c3') === 'craft' &&
    j1 && j1.cur && j1.cur.progressMs === 0 && j1.made === 1 && s.ore === ore0 - 2 * cost.ore && s.gold === gold0 - 2 * cost.gold && s.guide.queue.includes('equipFirst');
  const okWear = G.equip(s, 'c1', s.gearBag[0].id) && s.roster[0].equip.weapon && G.charDef(s.roster[0]).gear.atk > 0;
  check('I4 持续制造：到点前不出；到点进背包，接着开下一件（扣下一件的材料），打造者留在岗位；能穿上', okDone && okWear);
  // 一次推进很久：连续出多件，多出来的时间顺延
  const many = mk(); G.startProduction(many, 'weapon', 'c3', T0);
  const d1 = G.jobOf(many, 'forge').cur.durMs;
  const got = G.tickProduction(many, T0 + d1 * 3 + 5);
  check('I5 连续出多件：推进 3 件多的时间出 3 件，第 4 件已经开工、进度顺延', got.length === 3 && many.gearBag.length === 3 && Math.abs(G.jobOf(many, 'forge').cur.progressMs - 5) < 1e-6 && G.jobOf(many, 'forge').made === 3);
  // 材料不够：等待材料，角色留在岗位；够了自动继续
  const w = mk(); w.ore = cost.ore; G.startProduction(w, 'weapon', 'c3', T0);
  const wd = G.jobOf(w, 'forge').cur.durMs;
  G.tickProduction(w, T0 + wd + 1000);
  const waiting = G.jobOf(w, 'forge') && !G.jobOf(w, 'forge').cur && G.status(w, 'c3') === 'craft' && w.gearBag.length === 1 && w.ore === 0 && G.craftRemainingMs(w, 'forge') === null;
  G.tickProduction(w, T0 + wd + 60000);
  const stillWait = !G.jobOf(w, 'forge').cur && w.gearBag.length === 1;
  w.ore += cost.ore;
  G.tickProduction(w, T0 + wd + 61000);
  const resumed = G.jobOf(w, 'forge').cur && G.jobOf(w, 'forge').cur.progressMs <= 1000 && w.ore === 0;
  G.tickProduction(w, T0 + wd + 61000 + G.jobOf(w, 'forge').cur.durMs);
  check('I6 材料不够：等待材料、角色留在岗位、不计进度；材料够了自动开工', waiting && stillWait && resumed && w.gearBag.length === 2);
  // 召回：退还当前这件，角色回到闲置
  const t = mk(); G.startProduction(t, 'chest', 'c3', T0); G.tickProduction(t, T0 + 1000);
  const back = G.recallProduction(t, 'forge');
  check('I7 召回：当前这件退还全部材料，角色回到闲置；解雇打造中的角色同样退还', back === 'c3' && t.ore === 1000 && t.gold === 5000 && !G.jobOf(t, 'forge') && G.status(t, 'c3') === 'idle');
  const wt = mk(); wt.ore = 0; G.startProduction(wt, 'weapon', 'c3', T0);
  check('I8 召回等待材料的人：没有要退的，角色回到闲置', G.recallProduction(wt, 'forge') === 'c3' && wt.ore === 0 && wt.gold === 5000 && G.status(wt, 'c3') === 'idle');
  // 换部位：退还当前这件，按新部位重新开工
  const sw = mk(); G.startProduction(sw, 'weapon', 'c3', T0); G.tickProduction(sw, T0 + 1000);
  const okSw = G.switchProduction(sw, 'forge', 'chest');
  const sj = G.jobOf(sw, 'forge');
  check('I9 换部位：当前这件退还材料，按新部位重新开工（只扣一件的材料）', okSw && sj.slot === 'chest' && sj.cur.progressMs === 0 && sw.ore === 1000 - G.craftCost('chest').ore && sw.gold === 5000 - G.craftCost('chest').gold && G.status(sw, 'c3') === 'craft');
  const u = mk(); G.startProduction(u, 'weapon', 'c3', T0); G.tickProduction(u, T0 + 2000);
  G.resumeProduction(u, T0 + 3600000);           // 关了一小时再打开
  G.tickProduction(u, T0 + 3600000 + 1000);
  check('I10 离线不计算：重新打开页面后从当时接着算', Math.abs(G.jobOf(u, 'forge').cur.progressMs - 3000) < 1e-6);
  const prog = (scale) => { let rl = 1000; const ck = DAO.GameClock.create({ scale, realNow: () => rl }); const x = mk(); G.startProduction(x, 'weapon', 'c3', ck.now()); rl += 2000; G.tickProduction(x, ck.now()); const jx = G.jobOf(x, 'forge'); return jx.made * jx.cur.durMs + jx.cur.progressMs; };
  check('I11 打造走游戏时钟：倍率 10 时进度是倍率 1 的 10 倍', prog(10) === prog(1) * 10);
  // 推荐：已经有人在做时不再每件派人；有部位空着时建议换部位
  const r1 = mk(); G.startProduction(r1, 'weapon', 'c3', T0);
  const sug1 = G.nextUpgrade(r1);                 // 正在做的就是空着的部位：不用再派人
  G.tickProduction(r1, T0 + G.jobOf(r1, 'forge').cur.durMs);
  const ups = G.doAllUpgrades(r1, T0);            // 穿上做好的武器；胸甲还空着 → 换成做胸甲
  check('I12 推荐按持续制造：有人在做空着的部位时不再派人；做好的穿上，另一个部位空着时建议换部位（不重新派人）',
    (sug1 === null || sug1.kind === 'build') && ups.some((x) => x.kind === 'equip') && ups.some((x) => x.kind === 'switch') && G.jobOf(r1, 'forge').slot === 'chest' && G.jobOf(r1, 'forge').charId === 'c3' &&
    r1.roster[0].equip.weapon && !ups.some((x) => x.kind === 'craft') && (!G.nextUpgrade(r1) || ['build', 'salvage'].includes(G.nextUpgrade(r1).kind)));
  // v6 存档迁移：单件打造 → 生产任务
  const v6 = mk(); G.startProduction(v6, 'weapon', 'c3', T0); G.tickProduction(v6, T0 + 1500);
  const jj = G.jobOf(v6, 'forge');
  v6.v = 6; v6.crafting = { line: 'forge', slot: 'weapon', charId: 'c3', cost: jj.cur.cost, durMs: jj.cur.durMs, progressMs: 1500, last: T0 + 1500 }; delete v6.production;
  const m6 = G.migrate(clone(v6), T0);
  const mj = m6 && G.jobOf(m6, 'forge');
  check('I13 上一版（v6）存档迁移：正在打的那件变成生产任务、进度保留，之后接着持续制造', !!mj && m6.v === C.game.saveVersion && !('crafting' in m6) && mj.charId === 'c3' && mj.slot === 'weapon' && mj.cur.progressMs === 1500 && G.status(m6, 'c3') === 'craft');
  // v5 存档迁移
  const v5 = G.newSave('sword', 'old', T0); v5.v = 5; delete v5.crafting; delete v5.craftSeed; delete v5.workshops;
  v5.roster[0].equip = { weapon: { id: 'g1', slot: 'weapon', tier: 1 }, chest: { id: 'g2', slot: 'chest', tier: 0 }, ring: { id: 'g3', slot: 'ring', tier: 2, stat: 'str' } };
  v5.gearBag = [{ id: 'g4', slot: 'weapon', tier: 2 }, { id: 'g5', slot: 'ring', tier: 0, stat: 'int' }];
  const m = G.migrate(clone(v5), T0);
  const ring = m && m.roster[0].equip.ring;
  check('I14 更早（v5）存档迁移：下品 / 中品 / 上品 → 白 / 绿 / 蓝；戒指归饰品线（阶段 4a 起可用，穿着的留在身上）', !!m && m.v === C.game.saveVersion && m.roster[0].equip.weapon.quality === 'green' && m.roster[0].equip.chest.quality === 'white' &&
    ring && ring.id === 'g3' && !ring.disabled && ring.quality === 'blue' && G.gearUsable(ring) &&
    m.gearBag.find((g) => g.id === 'g4').quality === 'blue' && !m.gearBag.find((g) => g.id === 'g5').disabled && m.craftSeed === 1 && m.buildings.forge === 1 && !('workshops' in m) && !('crafting' in m) && Object.keys(m.production.jobs).length === 0);
}

// ---------------- L. 生产补完（阶段 4a）：三条线、建筑、出售分解 ----------------
{
  const mk = () => {
    const s = G.newSave('sword', 't', T0); s.unlocks.cave = true; s.unlocks.forge = true; s.unlocks.tailor = true; s.unlocks.jewelry = true;
    s.ore = 100000; s.herb = 1000; s.stone = 1000; s.gold = 50000; s.recruit.freeUsed = true;
    for (const r of ['mage', 'sword', 'mage', 'sword', 'mage']) { const c = G.rollRecruit(s, { role: r }); c.id = 'c' + s.nextId++; s.roster.push(c); }
    s.research.slots = 2; G.addToLineup(s, 'c2');
    return s;
  };
  // L1 三种原料：速率看对应三维；三条线都能持续打造、产出进背包、穿到对应部位
  const a = mk();
  const okG = G.startGather(a, 'c3', T0, 'ore') && G.startGather(a, 'c4', T0, 'herb') && G.startGather(a, 'c5', T0, 'stone');
  const c4 = G.getChar(a, 'c4'), c5 = G.getChar(a, 'c5');
  const rateOk = Math.abs(G.gatherRate(c4, 'herb') - C.game.gather.perSec * Math.max(C.game.gather.minFactor, c4.growth.agi / C.game.gather.refGrowth)) < 1e-9 &&
    Math.abs(G.gatherRate(c5, 'stone') - C.game.gather.perSec * Math.max(C.game.gather.minFactor, c5.growth.int / C.game.gather.refGrowth)) < 1e-9;
  const h0 = a.herb, s0 = a.stone;
  G.tickGather(a, T0 + 10000);
  const gainOk = Math.abs(a.herb - h0 - G.gatherRate(c4, 'herb') * 10) < 1e-6 && Math.abs(a.stone - s0 - G.gatherRate(c5, 'stone') * 10) < 1e-6;
  check('L1 三种原料各自采集：灵矿看力、灵草看敏、灵石看智，按秒产出进各自的库存', okG && rateOk && gainOk && G.gatherMatOf(a, 'c4') === 'herb');
  const kg = G.startProduction(a, 'gloves', 'c6', T0), ka = G.startProduction(a, 'amulet', 'c2', T0);
  const dG = G.jobOf(a, kg).cur.durMs, dA = G.jobOf(a, ka).cur.durMs;
  const durOk = dG === G.craftDurationMs(a, 'gloves', 'c6') && Math.round(C.game.tailor.recipes.gloves.baseSec * 1000 / (1 + G.charUnit(G.getChar(a, 'c6')).base.agi * C.game.production.craft.statCoef)) === dG;
  const herbPaid = a.herb === h0 + G.gatherRate(c4, 'herb') * 10 - C.game.tailor.recipes.gloves.cost.herb;
  G.tickProduction(a, T0 + Math.max(dG, dA));
  const gl = a.gearBag.find((g) => g.slot === 'gloves'), am = a.gearBag.find((g) => g.slot === 'amulet');
  const wearOk = gl && am && G.equip(a, 'c1', gl.id) && G.equip(a, 'c1', am.id) && G.charDef(G.getChar(a, 'c1')).gear.agi > 0 && G.charDef(G.getChar(a, 'c1')).gear.int > 0;
  check('L2 裁缝 / 饰品持续打造：时长看敏 / 智，扣灵草 / 灵石，产出进背包、能穿到护手 / 项链槽', kg === 'tailor' && ka === 'jewelry' && durOk && Math.abs(herbPaid ? 0 : 1) === 0 && wearOk && G.gearSlots().length === 6);
  // L3 采集工位：按采集建筑等级限制人数；升级后多一个
  const b = mk();
  const cap = G.gatherSlots(b, 'ore');
  const ids = ['c2', 'c3', 'c4', 'c5', 'c6', 'c7'];
  let n = 0; for (const id of ids) if (G.startGather(b, id, T0, 'ore')) n++;
  const blk = G.gatherBlock(b, 'c1', 'ore');
  const fullBefore = G.gatherBlock(b, 'c6', 'ore') === 'full';
  const cost1 = G.upgradeCost(b, 'mine');
  const goldBefore = b.gold, oreBefore = b.ore;
  const up = G.upgradeBuilding(b, 'mine');
  check('L3 采集工位数看采集建筑等级：满了不能再派，升级（扣金币 + 灵矿）后多一个工位', n === cap && G.gatherersOf(b, 'ore').length === cap && fullBefore && !G.gatherBlock(b, 'c6', 'ore') &&
    up && b.gold === goldBefore - cost1.gold && b.ore === oreBefore - cost1.ore && G.gatherSlots(b, 'ore') === C.game.buildings.list.mine.slots[1] && blk !== null);
  // L4 制造建筑：工位数、品质概率表随等级变化；升级花费逐级翻倍，上限 5 级
  const c = mk();
  const costs = [];
  for (let k = 0; k < 6; k++) { costs.push(G.upgradeCost(c, 'forge')); G.upgradeBuilding(c, 'forge'); }
  const dbl = costs.slice(0, 4).every((x, k) => k === 0 || x.gold === costs[k - 1].gold * C.game.buildings.costMult);
  check('L4 建筑升级：花费逐级 ×' + C.game.buildings.costMult + '，上限 ' + C.game.buildings.maxLevel + ' 级；锻造房 5 级时工位 ' + C.game.buildings.list.forge.slots[4] + ' 个、用 5 级品质表',
    dbl && costs[4] === null && G.buildingLevel(c, 'forge') === 5 && G.upgradeBlock(c, 'forge') === 'max' &&
    G.stationIds(c, 'forge').length === C.game.buildings.list.forge.slots[4] && JSON.stringify(G.qualityTable(c, 'forge')) === JSON.stringify(C.game.production.qualityTables[5]));
  const k1 = G.startProduction(c, 'weapon', 'c3', T0), k2 = G.startProduction(c, 'chest', 'c4', T0), k3 = G.startProduction(c, 'weapon', 'c5', T0), k4 = G.startProduction(c, 'weapon', 'c6', T0);
  check('L5 多个制造工位：同一条线同时派多人（锻造房 5 级 = 3 个工位），满了不能再派；召回按工位', k1 === 'forge' && k2 === 'forge2' && k3 === 'forge3' && k4 === false &&
    G.craftBlock(c, 'weapon', 'c6') === 'busy' && G.recallProduction(c, 'forge2') === 'c4' && G.freeStation(c, 'forge') === 'forge2');
  const cnt = {}; const t5 = mk(); t5.buildings.forge = 5;
  for (let k = 0; k < 20000; k++) { const q = G.rollQuality(t5, 'forge'); cnt[q] = (cnt[q] || 0) + 1; }
  const tb = C.game.production.qualityTables[5];
  check('L6 掷品质按制造建筑等级的概率表（5 级）', G.qualities().every((q, k) => Math.abs((cnt[q.id] || 0) / 20000 - tb[k] / 100) < 0.012), JSON.stringify(cnt));
  // L7 出售 / 分解：单件和批量，穿着的不能处理
  const d = mk();
  const w1 = G.addGear(d, 'weapon', 'white'), w2 = G.addGear(d, 'weapon', 'green'), g1 = G.addGear(d, 'gloves', 'white'), r1 = G.addGear(d, 'ring', 'blue');
  G.equip(d, 'c1', w2.id);
  const gold0 = d.gold, ore0 = d.ore, herb0 = d.herb, stone0 = d.stone;
  const sp = G.sellGear(d, w1.id);
  const sv = G.salvageGear(d, g1.id);
  const worn = G.sellGear(d, w2.id) === null && G.salvageGear(d, w2.id) === null && G.disposeBlock(d, w2.id) === 'worn';
  const okSingle = sp === Math.round(150 * C.game.salvage.sell.white) && d.gold === gold0 + sp && sv.herb === Math.round(60 * C.game.salvage.salvage.white) && d.herb === herb0 + sv.herb && worn &&
    !d.gearBag.some((g) => g.id === w1.id || g.id === g1.id) && d.roster[0].equip.weapon.id === w2.id;
  for (let k = 0; k < 3; k++) G.addGear(d, 'chest', 'white');
  G.addGear(d, 'chest', 'green');
  const prev = G.disposePreview(d, { qualities: ['white'] });
  const res = G.disposeMany(d, 'salvage', { qualities: ['white'] });
  check('L7 出售换金币、分解按线返还原料（按品质比例）；穿着的不能处理；批量按品质只处理背包里的', okSingle && prev.length === 3 && res.count === 3 &&
    res.mats.ore === 3 * Math.round(60 * C.game.salvage.salvage.white) && d.gearBag.filter((g) => g.slot === 'chest').length === 1 && d.roster[0].equip.weapon && d.gearBag.some((g) => g.id === r1.id));
  // L8 自动分解低于某品质的产出（默认关）
  const e = mk();
  G.setSetting(e, 'autoSalvage', 'green');
  G.startProduction(e, 'weapon', 'c3', T0);
  const made = G.tickProduction(e, T0 + G.jobOf(e, 'forge').cur.durMs * 30 + 1);
  check('L8 自动分解：设成「绿」时白装产出直接分解（返还灵矿），绿装进背包；默认关', C.game.settings.autoSalvage === null && made.length === 30 &&
    made.every((m) => (m.item.quality === 'white') === !!m.salvaged) && e.gearBag.every((g) => g.quality !== 'white') && made.some((m) => m.salvaged));
  // L9 第三段通关开放裁缝 / 饰品，引导派人采集灵草 / 灵石，接着开工新部位
  const f = G.newSave('sword', 't', T0); f.unlocks.cave = true; f.unlocks.forge = true; f.recruit.freeUsed = true; f.gold = 50000;
  for (const r of ['mage', 'sword', 'mage']) { const ch = G.rollRecruit(f, { role: r }); ch.id = 'c' + f.nextId++; f.roster.push(ch); }
  const lockedBefore = !G.lineUnlocked(f, 'tailor') && G.gatherBlock(f, 'c2', 'herb') === 'locked' && G.craftBlock(f, 'gloves', 'c2') === 'locked';
  const last = C.game.chapters.find((ch) => ch.id === C.game.production.lines.tailor.unlockChapter);
  for (const st of last.stages) f.progress.cleared[st.id] = 1;
  G.onFirstClear(f, last.stages[last.stages.length - 1].id);
  const unl = G.lineUnlocked(f, 'tailor') && G.lineUnlocked(f, 'jewelry') && f.guide.queue.includes('gather2');
  f.guide.queue = ['gather2'];
  const ack = G.ackGuide(f, 'gather2', T0);
  const viaRecruit = !!(f.recruitChoice && f.recruitChoice.mat === 'herb');
  if (f.recruitChoice) G.chooseRecruit(f, G.defaultChoice(f), T0);   // 为采集招的人（3 选 1）选完直接去采灵草
  const gOk = ack.ok && viaRecruit && G.gatherersOf(f, 'herb').length === 1 && G.gatherersOf(f, 'stone').length === 1 && f.guide.queue.includes('craft2');
  f.herb = 500; f.stone = 500;
  const sug = G.nextUpgrade(f);
  check('L9 第三段通关开放裁缝 / 饰品（之前锁着）；引导派人采灵草 / 灵石，接着排「开工新部位」；推荐覆盖 6 个部位', lockedBefore && unl && gOk && !!sug);
  // L10 v7 存档迁移
  const v7 = G.newSave('sword', 'old', T0); v7.v = 7; delete v7.herb; delete v7.stone; delete v7.buildings; v7.workshops = { forge: { level: 2 } };
  v7.unlocks.forge = true; v7.gather = { ids: ['c1'], last: null };
  v7.roster[0].equip = { weapon: { id: 'g1', slot: 'weapon', quality: 'green' }, chest: null };
  v7.gearBag = [{ id: 'g2', slot: 'ring', quality: 'blue', disabled: true }];
  v7.stats = { battles: 3 };
  for (const ch of C.game.chapters) for (const st of ch.stages) v7.progress.cleared[st.id] = 1;
  const m7 = G.migrate(clone(v7), T0);
  check('L10 上一版（v7）存档迁移：加灵草 / 灵石、采集记原料、工坊等级换成建筑（锻造房沿用）、6 个装备槽、「暂不可用」的戒指恢复、已通第三段的开放新线、统计补齐',
    !!m7 && m7.v === C.game.saveVersion && m7.herb === 0 && m7.stone === 0 && m7.gather.mats.c1 === 'ore' && m7.buildings.forge === 2 && m7.buildings.mine === 1 && !('workshops' in m7) &&
    Object.keys(m7.roster[0].equip).length === 6 && m7.roster[0].equip.weapon.id === 'g1' && !m7.gearBag[0].disabled && G.gearUsable(m7.gearBag[0]) &&
    m7.unlocks.tailor && m7.unlocks.jewelry && m7.guide.queue.includes('gather2') && m7.stats.battles === 3 && m7.stats.forged === 0 && m7.stats.herbTotal === 0 && 'autoSalvage' in m7.settings);
  // 原来采集人数超过 1 级工位数的不踢
  const v7b = G.newSave('sword', 'old', T0); v7b.v = 7; delete v7b.buildings; v7b.unlocks.forge = true; v7b.recruit.freeUsed = true;
  for (let k = 0; k < 6; k++) { const ch = G.rollRecruit(v7b, { role: 'sword' }); ch.id = 'c' + v7b.nextId++; v7b.roster.push(ch); }
  v7b.gather = { ids: ['c2', 'c3', 'c4', 'c5', 'c6'], last: null };
  const m7b = G.migrate(clone(v7b), T0);
  check('L11 迁移时采集人数超过矿脉 1 级工位数的不踢（只是满员前不能再派）', !!m7b && G.gatherersOf(m7b, 'ore').length === 5 && G.gatherBlock(m7b, 'c7', 'ore') === 'full');
  // L12 钱包：多种原料的花费
  const w = mk();
  check('L12 钱包按花费里出现的键处理（金币 + 灵草 / 灵石）', G.canPay(w, { gold: 100, herb: 50 }) && !G.canPay(w, { stone: 1e9 }) && (G.pay(w, { gold: 100, stone: 50 }), w.gold === 49900 && w.stone === 950) && (G.refund(w, { herb: 5 }), w.herb === 1005));
}

// ---------------- J. 存档位与存档保护（阶段 3.7） ----------------
{
  const SS = DAO.SaveSlots;
  const SC = C.saves;
  const mkSlots = (init) => { const st = SS.memoryStorage(init); return { st, sl: SS.create({ storage: st }) }; };
  const cur = G.newSave('sword', '新', T0); cur.gold = 4321;
  // 老的单一存档 → 第 1 个存档位，老键保留
  const old6 = clone(cur); old6.v = 6; old6.crafting = null; delete old6.production; old6.gold = 777;
  const a = mkSlots({ 'dao.save': JSON.stringify(old6) });
  const la = a.sl.list(T0);
  check('J1 老的单一存档（dao.save）自动放进第 1 个存档位，老键原样保留；其他存档位是空的',
    la.length === SC.slots && la[0].status === 'ok' && la[0].info.gold === 777 && la.slice(1).every((x) => x.status === 'empty') && a.st.get('dao.save') === JSON.stringify(old6) && a.sl.lastSlot(T0) === 1);
  // 升级版本：旧存档读得出来；迁移前原样备份；存档位里的原始数据要等游戏保存时才换
  const r1 = a.sl.read(1, T0);
  const orig = a.sl.originals(1);
  check('J2 旧版本存档能读（自动迁移），迁移前的原始存档按版本号原样另存一份；读的时候不改存档位里的原始数据',
    r1.status === 'ok' && r1.migratedFrom === 6 && r1.save.v === C.game.saveVersion && orig.length === 1 && orig[0].v === 6 && orig[0].data === JSON.stringify(old6) && a.st.get('dao.slot.1') === JSON.stringify(old6));
  a.sl.read(1, T0 + 1); a.sl.read(1, T0 + 2);
  check('J3 同一版本的原始存档只留一份（不会越存越多）', a.sl.originals(1).length === 1);
  // 坏存档：不当成空、不被覆盖
  const badRaws = { corrupt: '{"v":7, "roster": [', newer: JSON.stringify(Object.assign(clone(cur), { v: C.game.saveVersion + 5 })), invalid: JSON.stringify({ v: C.game.saveVersion, hello: 1 }), migrate: JSON.stringify(Object.assign(clone(cur), { v: 4, roster: null })) };
  for (const [kind, raw] of Object.entries(badRaws)) {
    const b = mkSlots({ 'dao.slot.2': raw, 'dao.slots.meta': JSON.stringify({ legacyImported: true, last: 2 }) });
    const r = b.sl.read(2, T0);
    const w = b.sl.write(2, clone(cur), T0, { reason: 'auto' });
    const li = b.sl.list(T0)[1];
    check(`J4 坏存档（${kind}）：读出来是「错误」不是「空」，自动保存被拒绝，原始数据原样还在；继续游戏不会选它`,
      r.status === 'error' && r.error === kind && !!r.errorText && !w.ok && w.error === 'protected' && b.st.get('dao.slot.2') === raw && li.status === 'error' && b.sl.lastSlot(T0) === null, `${r.status} ${r.error} ${w.ok}`);
    const f = b.sl.write(2, clone(cur), T0 + 10, { reason: 'new', force: true });
    check(`J5 坏存档（${kind}）只在玩家确认覆盖时才被替换，替换前原样进备份`, f.ok && b.sl.backups(2)[0].data === raw && b.sl.read(2, T0).status === 'ok');
  }
  // 自动备份：按间隔轮换，保留最近 N 份；手动保存总会备份
  const c = mkSlots({ 'dao.slots.meta': JSON.stringify({ legacyImported: true }) });
  let tt = T0;
  for (let i = 0; i < SC.backups * 3; i++) { const s = clone(cur); s.gold = i; c.sl.write(1, s, tt, { reason: 'auto' }); tt += SC.backupEveryMs / 2; }
  const bk = c.sl.backups(1);
  const s2 = clone(cur); s2.gold = 99999; c.sl.write(1, s2, tt + 1, { reason: 'manual' });
  check('J6 自动备份：保存时按间隔留一份、轮换保留最近 ' + SC.backups + ' 份（新的在前）；手动保存总会留一份',
    bk.length === SC.backups && bk[0].at > bk[1].at && tt - bk[bk.length - 1].at <= SC.backupEveryMs * (SC.backups + 1) && JSON.parse(c.sl.backups(1)[0].data).gold === 99999 && c.sl.backups(1)[0].reason === 'manual');
  const pick = c.sl.backups(1)[2];
  const rr = c.sl.restore(1, 2, tt + 2);
  check('J7 从备份恢复：存档位换成那份备份，恢复前的数据留在备份里（和最新一份备份相同时不重复存）', rr.ok && c.st.get('dao.slot.1') === pick.data && c.sl.backups(1).some((b) => JSON.parse(b.data).gold === 99999));
  // 存档位互不影响
  const d = mkSlots({ 'dao.slots.meta': JSON.stringify({ legacyImported: true }) });
  const x1 = clone(cur); x1.gold = 1; const x2 = G.newSave('mage', '二', T0); x2.gold = 2;
  d.sl.write(1, x1, T0); d.sl.write(2, x2, T0);
  const s1before = d.st.get('dao.slot.1');
  for (let i = 0; i < 5; i++) { x2.gold += 10; d.sl.write(2, x2, T0 + i * 1e6, { reason: 'auto' }); }
  d.sl.remove(3, T0);
  const ld = d.sl.list(T0);
  check('J8 存档位互不影响：反复保存第 2 位、删除第 3 位，第 1 位的数据和备份都不变', d.st.get('dao.slot.1') === s1before && ld[0].info.gold === 1 && ld[1].info.roleName === DAO.ROLE_NAMES.mage && ld[2].status === 'empty' && d.sl.backups(1).length === 1 && d.sl.lastSlot(T0) === 2);
  const g2 = mkSlots({ 'dao.slots.meta': JSON.stringify({ legacyImported: true }), 'dao.slot.1': JSON.stringify(Object.assign(clone(cur), { savedAt: 5 })), 'dao.slot.3': JSON.stringify(Object.assign(clone(cur), { savedAt: 9 })), 'dao.slot.2': '{bad' });
  check('J8b 「继续游戏」没有记录时（清过浏览器数据、从硬盘读回）取最后保存时间最新、读得出来的存档位', g2.sl.lastSlot(T0) === 3);
  // 删除：存档位变空，删除前的数据进备份
  d.sl.remove(2, T0 + 9e6);
  check('J9 删除：存档位变空，删除前的数据留在这个存档位的备份里，可以恢复', d.st.get('dao.slot.2') == null && JSON.parse(d.sl.backups(2)[0].data).gold === x2.gold && d.sl.restore(2, 0, T0 + 9e6 + 1).ok && JSON.parse(d.st.get('dao.slot.2')).gold === x2.gold);
  // 导入：旧版本自动迁移；读不出来的不导入
  const e = mkSlots({ 'dao.slots.meta': JSON.stringify({ legacyImported: true }) });
  const imp = e.sl.importText(3, JSON.stringify(old6), T0);
  const impBad = e.sl.importText(2, 'not json', T0);
  check('J10 导入：旧版本存档自动升级后放进选定的存档位（原始数据另存）；读不出来的文件不导入、存档位不变',
    imp.ok && imp.migratedFrom === 6 && JSON.parse(e.st.get('dao.slot.3')).v === C.game.saveVersion && e.sl.originals(3)[0].v === 6 && !impBad.ok && e.st.get('dao.slot.2') == null);
  // 已经有第 1 位时不会再导入老存档
  const f2 = mkSlots({ 'dao.save': JSON.stringify(old6), 'dao.slot.1': JSON.stringify(cur) });
  f2.sl.list(T0);
  check('J11 第 1 个存档位已有存档时，老存档不会覆盖它', JSON.parse(f2.st.get('dao.slot.1')).gold === cur.gold);
}

// ---------------- K. 模块边界（阶段 3.8） ----------------
{
  const fs = require('fs'), path = require('path');
  const ROOT = path.resolve(__dirname, '..');
  const B = require('./lib/boundaries');
  const r = B.check(ROOT);
  check('K1 分层引用、不碰 DOM、存档字段归属、界面不直接改存档（cli/boundaries.js）', r.errors.length === 0, r.errors.slice(0, 3).join(' | '));
  // 调用方（界面、命令行、工具）用到的 DAO.Game.xxx 都存在
  const callers = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.js$/.test(e.name)) callers.push(p); } };
  ['src/ui', 'cli', 'tools'].forEach((d) => walk(path.join(ROOT, d)));
  const missing = new Set();
  for (const f of callers) {
    const src = fs.readFileSync(f, 'utf8');
    const aliased = /\bG = (?:root\.|window\.)?DAO\.Game\b|DAO, G = DAO\.Game/.test(src);   // 把 G 指向 DAO.Game 的文件才查 G.xxx
    const toks = B.tokenize(src);
    for (let k = 0; k + 2 < toks.length; k++) {
      if (aliased && toks[k].t === 'id' && toks[k].v === 'G' && toks[k + 1].v === '.' && toks[k + 2].t === 'id' && !(toks[k - 1] && toks[k - 1].v === '.')) {
        if (!(toks[k + 2].v in G)) missing.add(path.relative(ROOT, f) + ':' + toks[k + 2].v);
      }
      if (toks[k].v === 'DAO' && toks[k + 1].v === '.' && toks[k + 2].v === 'Game' && toks[k + 3] && toks[k + 3].v === '.' && toks[k + 4] && toks[k + 4].t === 'id') {
        if (!(toks[k + 4].v in G)) missing.add(path.relative(ROOT, f) + ':' + toks[k + 4].v);
      }
    }
  }
  check('K2 界面、命令行、工具里用到的 DAO.Game 函数都存在（拆分后对外接口不变）', missing.size === 0, [...missing].slice(0, 5).join(', '));
  // index.html 和 src/node.js 加载同一组逻辑文件、顺序一致
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const fromHtml = [...html.matchAll(/<script src="src\/((?:core|config|battle|game)\/[\w-]+\.js)"/g)].map((m) => m[1]);
  const nodeSrc = fs.readFileSync(path.join(ROOT, 'src/node.js'), 'utf8');
  const fromNode = [...nodeSrc.matchAll(/'\.\/((?:core|config|battle|game)\/[\w-]+\.js)'/g)].map((m) => m[1]).concat(nodeSrc.includes("'./config/tuning.js'") ? [] : []);
  check('K3 index.html 和 src/node.js 加载的逻辑文件、顺序一致', JSON.stringify(fromHtml) === JSON.stringify(fromNode), `html ${fromHtml.length} / node ${fromNode.length}`);
  // 每个游戏模块文件开头写了职责、对外函数、读写字段
  const mods = fs.readdirSync(path.join(ROOT, 'src/game')).filter((f) => f.endsWith('.js'));
  const noHead = mods.filter((f) => { const t = fs.readFileSync(path.join(ROOT, 'src/game', f), 'utf8').slice(0, 1500); return !/^\/\*\*/.test(t) || !/对外/.test(t) || !/(读写字段|不读写存档|存档)/.test(t); });
  check('K4 游戏模块文件开头都有说明（职责、对外函数、读写的存档字段）', noHead.length === 0, noHead.join(', '));
}

// ---------------- 输出 ----------------
console.log(`不变量检查：${samples.length} 场战斗（V0 30 场 + 游戏 ${G.stages().length} 关 × 2 种开局 × ${SEEDS} 个种子），回放 ${replaySamples.length} 场 × 8 种播放方式`);
order.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
let bad = 0;
for (const n of order) {
  const f = fails[n];
  if (f) bad++;
  console.log(`${f ? '❌' : '✅'} ${n}${f ? `（${f.length} 处，例：${f.slice(0, 2).join(' | ')}）` : ''}`);
}
console.log(`共 ${checks} 次检查，${bad ? bad + ' 项不通过' : '全部通过'}。耗时 ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(bad ? 1 : 0);
