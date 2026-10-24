#!/usr/bin/env node
/**
 * 阶段 3 验收（阶段 3.5 起按新流程）：采集 / 锻造（1-8 开放）+ 第三段引导关（卡点：第 4 个上阵位）。
 * 阶段 3.5 起数值以配置网站集中调为主，这份报告作参考，不要求全部通过。
 *   node cli/stage3.js [每种开局模拟玩家数=300] [阶梯快照数=40] [--defaults]     结果写入 docs/STAGE3_REPORT.md
 *
 *  0. 同种子一致；上一版（v4）和更早的存档迁移
 *  1. 模拟玩家：第三段用时、挂机占比、通关等级、上阵人数和装备；全自动玩家能否打完前三段
 *  2. 各关通关等级（3 人不穿 / 3 人全绿 / 3 人全蓝 / 4 人全绿）、角色·分钟、金币和灵矿结余
 */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./lib/play.js');
const { DAO, G, C, q, mean, pct, min, num, T0, clone } = P;

const PLAYERS = Number(process.argv[2] || 300);
const SNAPS = Number(process.argv[3] || 40);
const ROLES = ['sword', 'mage'];
const RN = { sword: '剑修', mage: '法修' };
const CH = C.chapters.map((c) => c.id);
const CH3 = CH[2];
const SEG3 = C.chapters[2].stages.map((s) => s.id);
const BOSS3 = SEG3[SEG3.length - 1];
const out = [];
const log = (s = '') => { out.push(s); console.log(s); };
const checks = [];
const t0 = Date.now();

log('# 阶段 3 验收报告');
log();
log(P.header('stage3.js', `${PLAYERS} ${SNAPS}`).join('\n'));
log();

// ---------------- 0. 确定性与迁移 ----------------
log('## 0. 确定性与存档迁移');
log();
{
  const a = P.simulate('sword', 3, { kind: 'std', seeds: P.SEEDS.s23 }), b = P.simulate('sword', 3, { kind: 'std', seeds: P.SEEDS.s23 });
  delete a.save; delete b.save;
  const okD = JSON.stringify(a) === JSON.stringify(b) && a.done;
  checks.push(['同种子结果一致（整局模拟跑两遍逐项相同，含招募 3 名候选）', okD]);
  log(`- 同种子整局模拟（战斗、招募 3 选 1、掉落、掷数值、采集、锻造）跑两遍结果相同：**${okD ? '是' : '否'}**`);

  // 上一版（v4，阶段 3）存档：打完第二段，名额超过 10 人，还带着递增招募价格
  const v4 = G.newSave('mage', '老玩家', T0);
  v4.v = 4;
  delete v4.recruitChoice; delete v4.quota;
  v4.recruit = { day: 20261024, today: 4, freeUsed: true };
  v4.unlocks.cave = true;
  for (let i = 0; i < 11; i++) { const c = G.rollRecruit(v4, { role: i % 2 ? 'sword' : 'mage' }); v4.nextId++; v4.roster.push(c); }
  v4.roster[0].level = 18;
  for (const ch of [C.chapters[0], C.chapters[1]]) for (const st of ch.stages) v4.progress.cleared[st.id] = 1;
  v4.guide.seen = { cave: true, research: true, formation: true, firstCard: true, ['done:' + CH[0]]: true, ['done:' + CH[1]]: true, extraRecruit: true };
  v4.gold = 4000; v4.cardsInfo.firstGot = true; v4.unlocks.forge = true; v4.guide.seen.gather = true;
  const m = G.migrate(clone(v4), T0);
  const okM = m && m.v === C.saveVersion && m.roster.length === 12 && G.recruitBlock(m) === 'full' && JSON.stringify(m.recruit) === '{"freeUsed":true}' &&
    m.quota && m.quota.extra === 0 && m.recruitChoice === null && m.gold === 4000 && m.roster[0].level === 18 && G.rosterCap(m) === C.roster.cap;
  checks.push(['上一版（v4）存档能迁移（超过 10 人不删、但不能招募；递增价格状态丢弃）', !!okM]);
  // v4 打过 1-8 但没打完第二段：迁移后开放采集 / 锻造房并排队采集引导
  const v4b = G.newSave('sword', 'x', T0); v4b.v = 4; delete v4b.recruitChoice; delete v4b.quota; v4b.recruit = { day: null, today: 0, freeUsed: true };
  for (const st of C.chapters[0].stages.slice(0, 8)) v4b.progress.cleared[st.id] = 1;
  const m2 = G.migrate(v4b, T0);
  const okM2 = m2 && m2.unlocks.forge && m2.guide.queue.includes('gather');
  checks.push(['v4 存档打过 1-8 的迁移后开放采集 / 锻造房', !!okM2]);
  const v3 = clone(v4); v3.v = 3; delete v3.ore; delete v3.gather; delete v3.gearBag; delete v3.nextGearId; delete v3.unlocks.forge; for (const c of v3.roster) delete c.equip;
  const m3 = G.migrate(v3, T0);
  const okChain = !!(m3 && m3.v === C.saveVersion && m3.unlocks.forge && Array.isArray(m3.gearBag));
  checks.push(['阶段 2（v3）存档经 v4 迁移到当前版本', okChain]);
  log(`- 上一版（v4）存档迁移：12 人的存档一个不删，但名额 ${C.roster.cap} 已满不能招募；递增招募价格和每日计数丢弃；金币、等级保留：**${okM ? '通过' : '不通过'}**`);
  log(`- v4 存档打过 1-8（没打完第二段）：迁移后开放采集 / 锻造房并排队采集引导：**${okM2 ? '通过' : '不通过'}**；v3 走 v3→v4→v5 整条链：**${okChain ? '通过' : '不通过'}**`);
  log();
}

// ---------------- 1. 两种方案 ----------------
const LV = []; for (let l = 12; l <= 34; l++) LV.push(l);
const four = (s) => {
  // 4 人上阵：上阵位设为 4，把采集里等级最高的人调回来上阵
  s.research.slots = Math.max(4, s.research.slots);
  const g = s.gather.ids.slice().sort((a, b) => G.getChar(s, b).level - G.getChar(s, a).level)[0];
  if (g) G.stopGather(s, g, 0);
  else { const idle = s.roster.find((c) => G.status(s, c.id) === 'idle'); if (idle) G.addToLineup(s, idle.id); }
};
const LADDERS = {
  none3: { name: '3 人不穿装备', fn: P.stripGear },
  mid3: { name: '3 人全绿', fn: P.fullSet('green') },
  top3: { name: '3 人全蓝', fn: P.fullSet('blue') },
  mid4: { name: '4 人全绿', fn: (s) => { four(s); P.fullSet('green')(s); } },
};
const R = {};
{
  const sims = {};
  for (const kind of ['std', 'auto']) {
    sims[kind] = {};
    for (const role of ROLES) {
      sims[kind][role] = [];
      for (let i = 0; i < PLAYERS; i++) sims[kind][role].push(P.simulate(role, i, { kind, seeds: P.SEEDS.s23, snapAt: kind === 'std' && i < SNAPS ? ['3-1'] : [] }));
    }
  }
  const lad = {};
  for (const role of ROLES) {
    const snaps = sims.std[role].map((r) => r.snaps['3-1']).filter(Boolean);
    lad[role] = { arrive: q(snaps.map((s) => G.starter(s).level), 0.5), per: {} };
    for (const st of SEG3) {
      lad[role].per[st] = {};
      for (const [k, L] of Object.entries(LADDERS)) lad[role].per[st][k] = P.ladder(snaps, st, LV, L.fn, 5).first;
    }
  }
  R.slots = { sims, lad };
}

const seg3 = (r) => r.segs[CH3];
function stat(vid, kind, role) {
  const rs = R[vid].sims[kind][role];
  const s = rs.map(seg3).filter(Boolean);
  const done = rs.filter((r) => seg3(r) && !seg3(r).unfinished);
  const ds = done.map(seg3);
  return { n: rs.length, done: done.length / rs.length, time: q(ds.map((x) => x.dur), 0.5), t10: q(ds.map((x) => x.dur), 0.1), t90: q(ds.map((x) => x.dur), 0.9),
    share: q(s.map((x) => x.idle / Math.max(1, x.dur)), 0.5), share90: q(s.map((x) => x.idle / Math.max(1, x.dur)), 0.9), lv: q(ds.map((x) => x.lv1), 0.5),
    lv10: q(ds.map((x) => x.lv1), 0.1), lv90: q(ds.map((x) => x.lv1), 0.9), slots: q(ds.map((x) => x.slots), 0.5), lineup: q(ds.map((x) => x.lineup), 0.5),
    tiers: G.qualities().slice(0, 3).map((qq, t) => q(ds.map((x) => x.tiers[t]), 0.5)), all3: rs.filter((r) => r.done).length / rs.length };
}

log('## 1. 模拟玩家：第三段（第二段首领通关 → 第三段首领通关）');
log();
log('第三段的卡点是第 4 个上阵位：打完第二段后上阵位可以研究到第 4 级（6,000 金），铁岩谷按 4 人上阵设计；卡关时先引导研究上阵位，研究不了再引导补装备。标准玩家 / 全自动玩家的策略见 cli/lib/play.js。');
log();
log('| 玩家 | 开局 | 打完第三段 | 第三段用时 分钟 中位（P10–P90） | 挂机占比 中位 | 通关时开局角色等级 中位（P10–P90） | 上阵人数 | 上阵装备 白 / 绿 / 蓝 件数 中位 |');
log('|---|---|---|---|---|---|---|---|');
const ST = { slots: {} };
for (const kind of ['std', 'auto']) {
  ST.slots[kind] = {};
  for (const role of ROLES) {
    const x = (ST.slots[kind][role] = stat('slots', kind, role));
    log(`| ${kind === 'std' ? '标准' : '全自动'} | ${RN[role]} | ${pct(x.done)} | ${min(x.time)}（${min(x.t10)}–${min(x.t90)}） | ${pct(x.share)} | Lv${x.lv}（${x.lv10}–${x.lv90}） | ${x.lineup} | ${x.tiers.join(' / ')} |`);
  }
}
log();
const fmtLv = (x) => (x == null ? '>' + LV[LV.length - 1] : 'Lv' + x);

// ---------------- 2. 细节 ----------------
log('## 2. 各关通关等级（标准玩家第二段通关时的真实存档，开局角色 Lv N、其他 Lv N−1）');
log();
for (const role of ROLES) {
  const L = R.slots.lad[role];
  log(`#### ${RN[role]}开局（进第三段时开局角色 Lv${L.arrive}）`);
  log();
  log('| 关卡 | ' + Object.values(LADDERS).map((l) => l.name).join(' | ') + ' |');
  log('|---|' + '---|'.repeat(Object.keys(LADDERS).length));
  for (const st of SEG3) log(`| ${st} ${G.stageById(st).name} | ${Object.keys(LADDERS).map((k) => fmtLv(L.per[st][k])).join(' | ')} |`);
  log();
}

log('### 角色·分钟：上阵 / 研究 / 采集 / 闲置（第三段，中位）');
log();
log('| 玩家 | 开局 | 上阵 | 研究 | 采集 | 闲置 | 采集占比 | 有人采集的玩家 | 第三段结束名册 中位 | 采集人数 中位 |');
log('|---|---|---|---|---|---|---|---|---|---|');
const CM = {};
for (const kind of ['std', 'auto']) for (const role of ROLES) {
  const s = R.slots.sims[kind][role].map(seg3).filter((x) => x && !x.unfinished);
  const m = (k) => q(s.map((x) => x.cm[k] / 60000), 0.5) || 0;
  const tot = s.map((x) => x.cm.lineup + x.cm.research + x.cm.gather + x.cm.idle);
  const share = q(s.map((x, i) => x.cm.gather / Math.max(1, tot[i])), 0.5);
  CM[kind + role] = { share, anyone: s.filter((x) => x.cm.gather > 0).length / Math.max(1, s.length) };
  log(`| ${kind === 'std' ? '标准' : '全自动'} | ${RN[role]} | ${m('lineup').toFixed(1)} | ${m('research').toFixed(1)} | ${m('gather').toFixed(1)} | ${m('idle').toFixed(1)} | ${pct(share)} | ${pct(CM[kind + role].anyone)} | ${q(s.map((x) => x.roster), 0.5)} | ${q(s.map((x) => x.gatherers), 0.5)} |`);
}
log();

log('### 金币与灵矿结余（第三段结束时）');
log();
log('| 玩家 | 开局 | 第二段结束金币 中位 | 第三段金币收入 中位 | 锻造花掉 中位 | 招募花掉 中位 | 第三段结束金币 中位（P10–P90） | 第三段灵矿产出 中位 | 锻造花掉灵矿 中位 | 第三段结束灵矿 中位（P10–P90） |');
log('|---|---|---|---|---|---|---|---|---|---|');
const BAL = {};
for (const kind of ['std', 'auto']) for (const role of ROLES) {
  const s = R.slots.sims[kind][role].map(seg3).filter((x) => x && !x.unfinished);
  const g3 = s.map((x) => x.gold1), o3 = s.map((x) => x.ore1);
  BAL[kind + role] = { g2: q(s.map((x) => x.gold0), 0.5), g3: q(g3, 0.5), o3: q(o3, 0.5), oreInc: q(s.map((x) => x.oreInc), 0.5) };
  log(`| ${kind === 'std' ? '标准' : '全自动'} | ${RN[role]} | ${num(BAL[kind + role].g2)} | ${num(q(s.map((x) => x.goldInc), 0.5))} | ${num(q(s.map((x) => x.forgeGold), 0.5))} | ${num(q(s.map((x) => x.recruitGold), 0.5))} | ${num(q(g3, 0.5))}（${num(q(g3, 0.1))}–${num(q(g3, 0.9))}） | ${num(BAL[kind + role].oreInc)} | ${num(q(s.map((x) => x.forgeOre), 0.5))} | ${num(q(o3, 0.5))}（${num(q(o3, 0.1))}–${num(q(o3, 0.9))}） |`);
}
log();

// ---------------- 验收 ----------------
log('## 3. 验收');
log();
for (const role of ROLES) {
  const p = R.slots.lad[role].per[BOSS3];
  checks.push([`第三段卡点：4 人全绿比 3 人全绿的首领通关等级低 ≥ 3 级（${RN[role]}开局：4 人 ${fmtLv(p.mid4)}，3 人 ${fmtLv(p.mid3)}）`, p.mid4 != null && (p.mid3 == null || p.mid3 - p.mid4 >= 3)]);
}
const S3 = ST.slots;
for (const role of ROLES) {
  checks.push([`第三段总时长 10–20 分钟，含采集等待（标准玩家，${RN[role]}开局：${min(S3.std[role].time)} 分钟）`, S3.std[role].time >= 10 * 60000 && S3.std[role].time <= 20 * 60000]);
  checks.push([`挂机时间不超过三分之一（标准玩家，${RN[role]}开局：中位 ${pct(S3.std[role].share)}）`, S3.std[role].share <= 1 / 3]);
  checks.push([`采集真的有人去做（标准玩家，${RN[role]}开局：${pct(CM['std' + role].anyone)} 的玩家有人采集，采集占角色·分钟 ${pct(CM['std' + role].share)}）`, CM['std' + role].anyone === 1 && CM['std' + role].share > 0.1]);
  checks.push([`全自动玩家（只在引导处点确认）能打完前三段（${RN[role]}开局：${pct(S3.auto[role].all3)}）`, S3.auto[role].all3 === 1]);
}
checks.push([`剑修开局、法修开局第三段通关等级差 ≤ 2（Lv${S3.std.sword.lv} vs Lv${S3.std.mage.lv}）`, Math.abs(S3.std.sword.lv - S3.std.mage.lv) <= 2]);
for (const role of ROLES) {
  const b = BAL['std' + role];
  checks.push([`第三段结束时没有大量囤积（标准玩家，${RN[role]}开局：金币 ${num(b.g2)} → ${num(b.g3)}，灵矿结余 ${num(b.o3)} / 本段产出 ${num(b.oreInc)}）`, b.g3 <= b.g2 && b.o3 <= Math.max(1, b.oreInc) * 0.25]);
}
for (const [name, ok] of checks) log(`- ${ok ? '✅' : '❌'} ${name}`);
log();
log(`---\n耗时 ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (!process.env.NOWRITE) {
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'STAGE3_REPORT.md'), out.join('\n') + '\n');
  console.error('\n已写入 docs/STAGE3_REPORT.md');
}
