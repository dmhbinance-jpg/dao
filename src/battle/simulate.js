/**
 * 单场与批量模拟。不依赖 UI。
 *
 * batch 输出：胜率、平均回合、伤害占比、触发次数、技能稳定性（每次施放伤害的变异系数）、辅助贡献。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  function runOne(lineupA, lineupB, seed, record) {
    const b = new DAO.Battle(lineupA, lineupB, { seed, record });
    return b.run();
  }

  /**
   * @param {Array} lineupA
   * @param {Array} lineupB
   * @param {object} opts { runs, seedBase, swapSides }
   *   swapSides=true：一半场次交换 A/B 位置，抵消同速时的次序偏差（统计仍按原 A/B 记）
   */
  function newAgg() {
    return {
      runs: 0, wins: { A: 0, B: 0, draw: 0 }, timeouts: 0,
      roundsSum: 0, roundsList: [], recursionBlocked: 0,
      units: {}, // key = side + ':' + name
      sideDmg: { A: 0, B: 0 },
      triggers: {}, // triggerName -> total
    };
  }

  /** 跑第 i 场并累加（i 为 0 起的场次序号） */
  function runInto(agg, lineupA, lineupB, i, opts) {
    const seedBase = opts.seedBase == null ? DAO.CONFIG.sim.seedBase : opts.seedBase;
    const seed = seedBase + i;
    const swap = opts.swapSides && i % 2 === 1;
    const r = swap ? runOne(lineupB, lineupA, seed, false) : runOne(lineupA, lineupB, seed, false);
    const mapSide = (x) => (swap ? (x === 'A' ? 'B' : 'A') : x);
    agg.runs++;
    const w = r.winner === 'draw' ? 'draw' : mapSide(r.winner);
    agg.wins[w]++;
    if (r.timeout) agg.timeouts++;
    agg.roundsSum += r.rounds;
    agg.roundsList.push(r.rounds);
    agg.recursionBlocked += r.recursionBlocked;

    for (const u of r.units) {
      const side = mapSide(u.side);
      const key = side + ':' + u.name;
      const a = (agg.units[key] = agg.units[key] || {
        side, name: u.name, title: u.title, row: u.row, role: u.role,
        survived: 0, dmg: 0, overkill: 0, heal: 0, shieldAbsorbed: 0, mitigated: 0, amplified: 0,
        armorBuff: 0, armorBreak: 0, dmgBuff: 0, dmgTaken: 0, redirected: 0,
        actions: 0, extraActions: 0, crits: 0, kills: 0, triggers: {}, skills: {},
      });
      const s = u.stats;
      if (u.alive) a.survived++;
      a.dmg += s.dmgEffective;
      a.overkill += s.overkill;
      a.heal += s.healDone;
      a.shieldAbsorbed += s.shieldAbsorbed;
      a.mitigated += s.supportMitigated;
      a.amplified += s.supportAmplified;
      a.armorBuff += s.supportArmorBuff;
      a.armorBreak += s.supportArmorBreak;
      a.dmgBuff += s.supportDmgBuff;
      a.dmgTaken += s.dmgTaken;
      a.redirected += s.redirected;
      a.actions += s.actions;
      a.extraActions += s.extraActions;
      a.crits += s.crits;
      a.kills += s.kills;
      agg.sideDmg[side] += s.dmgEffective;
      for (const k in s.triggers) {
        a.triggers[k] = (a.triggers[k] || 0) + s.triggers[k];
        agg.triggers[k] = (agg.triggers[k] || 0) + s.triggers[k];
      }
      for (const k in s.skills) {
        const src = s.skills[k];
        const d = (a.skills[k] = a.skills[k] || { casts: 0, dmg: 0, sumSq: 0, hits: 0, heal: 0, shape: src.shape });
        d.casts += src.casts; d.dmg += src.dmg; d.sumSq += src.sumSq; d.hits += src.hits; d.heal += src.heal;
      }
    }
  }

  /**
   * @param {Array} lineupA
   * @param {Array} lineupB
   * @param {object} opts { runs, seedBase, swapSides }
   *   swapSides=true：奇数场交换 A/B 位置，抵消同速时的次序偏差（统计仍按原 A/B 记）
   */
  function batch(lineupA, lineupB, opts) {
    opts = opts || {};
    const runs = opts.runs || DAO.CONFIG.sim.defaultRuns;
    const agg = newAgg();
    for (let i = 0; i < runs; i++) runInto(agg, lineupA, lineupB, i, opts);
    return summarize(agg);
  }

  function summarize(agg) {
    const N = agg.runs;
    const units = Object.values(agg.units).map((a) => {
      const skills = Object.entries(a.skills).map(([name, d]) => {
        const mean = d.casts ? d.dmg / d.casts : 0;
        const variance = d.casts ? d.sumSq / d.casts - mean * mean : 0;
        return {
          name, shape: d.shape,
          castsPerBattle: d.casts / N,
          dmgPerCast: mean,
          cv: mean > 0 ? Math.sqrt(Math.max(0, variance)) / mean : 0, // 变异系数：越小越「稳」
          hitsPerCast: d.casts ? d.hits / d.casts : 0,
          healPerCast: d.casts ? d.heal / d.casts : 0,
          dmgShareOfUnit: a.dmg > 0 ? d.dmg / a.dmg : 0,
        };
      });
      const triggers = {};
      for (const k in a.triggers) triggers[k] = a.triggers[k] / N;
      return {
        side: a.side, name: a.name, title: a.title, row: a.row, role: a.role,
        survival: a.survived / N,
        dmg: a.dmg / N,
        dmgShare: agg.sideDmg[a.side] > 0 ? a.dmg / agg.sideDmg[a.side] : 0,
        overkillPct: a.dmg + a.overkill > 0 ? a.overkill / (a.dmg + a.overkill) : 0,
        heal: a.heal / N,
        shieldAbsorbed: a.shieldAbsorbed / N,
        mitigated: a.mitigated / N,
        amplified: a.amplified / N,
        armorBuff: a.armorBuff / N,
        armorBreak: a.armorBreak / N,
        dmgBuff: a.dmgBuff / N,
        dmgTaken: a.dmgTaken / N,
        redirected: a.redirected / N,
        actions: a.actions / N,
        extraActions: a.extraActions / N,
        crits: a.crits / N,
        kills: a.kills / N,
        triggers, skills,
      };
    });
    const triggers = {};
    for (const k in agg.triggers) triggers[k] = agg.triggers[k] / N;
    const sorted = agg.roundsList.slice().sort((x, y) => x - y);
    return {
      runs: N,
      winRate: { A: agg.wins.A / N, B: agg.wins.B / N, draw: agg.wins.draw / N },
      timeouts: agg.timeouts,
      avgRounds: agg.roundsSum / N,
      medianRounds: sorted[Math.floor(sorted.length / 2)],
      recursionBlocked: agg.recursionBlocked / N,
      sideDmg: { A: agg.sideDmg.A / N, B: agg.sideDmg.B / N },
      triggers,
      units,
    };
  }

  /** 文本报告（命令行用） */
  function report(sum, title) {
    const pct = (x) => (x * 100).toFixed(1) + '%';
    const num = (x) => Math.round(x).toLocaleString('en-US');
    const lines = [];
    if (title) lines.push(`## ${title}`);
    lines.push(`场数 ${sum.runs} | A 胜 ${pct(sum.winRate.A)} | B 胜 ${pct(sum.winRate.B)} | 平 ${pct(sum.winRate.draw)} | 平均回合 ${sum.avgRounds.toFixed(2)}（中位 ${sum.medianRounds}）`);
    for (const side of ['A', 'B']) {
      lines.push(`  [${side}] 场均有效伤害 ${num(sum.sideDmg[side])}`);
      for (const u of sum.units.filter((x) => x.side === side)) {
        const parts = [
          `${u.name}(${u.row === 'front' ? '前' : '后'})`.padEnd(8, '　'),
          `伤害占比 ${pct(u.dmgShare).padStart(6)}`,
          `存活 ${pct(u.survival).padStart(6)}`,
          `行动 ${u.actions.toFixed(1)}`,
        ];
        if (u.heal > 1) parts.push(`治疗 ${num(u.heal)}`);
        if (u.shieldAbsorbed > 1) parts.push(`护盾吸收 ${num(u.shieldAbsorbed)}`);
        if (u.armorBuff > 1) parts.push(`减伤贡献 ${num(u.armorBuff)}`);
        if (u.armorBreak > 1) parts.push(`破甲贡献 ${num(u.armorBreak)}`);
        if (u.dmgBuff > 1) parts.push(`增伤贡献 ${num(u.dmgBuff)}`);
        if (u.redirected > 0.05) parts.push(`代受 ${u.redirected.toFixed(1)}`);
        if (u.extraActions > 0.005) parts.push(`再动 ${u.extraActions.toFixed(2)}`);
        const trig = Object.entries(u.triggers).map(([k, v]) => `${k}×${v.toFixed(2)}`);
        if (trig.length) parts.push(`触发 ${trig.join(' ')}`);
        lines.push('    ' + parts.join(' | '));
      }
    }
    return lines.join('\n');
  }

  DAO.Sim = { runOne, batch, report, newAgg, runInto, summarize };
})(typeof globalThis !== 'undefined' ? globalThis : this);
