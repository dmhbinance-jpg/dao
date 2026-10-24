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
  if (gearTier != null) for (const c of s.roster) for (const slot of C.game.forge.slots) c.equip[slot] = { id: 'x' + c.id + slot, slot, tier: gearTier, stat: slot === 'ring' ? G.mainStat(c) : undefined };
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
  for (const [k, v] of Object.entries(C.game.forge.recipes)) use(v.art, '装备 ' + k);
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
