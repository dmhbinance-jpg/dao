/**
 * 战斗时间线 → 文字日志。命令行和文字回放共用；文字全部由结构化事件生成（见 engine.js 顶部的事件说明）。
 *
 *   DAO.BattleLog.formatBeat(beat, timeline, opts) → [{ text, kind, depth, side? }]   一拍的文字行
 *   DAO.BattleLog.formatTimeline(timeline, opts)   → string                           整场
 *   opts.sideNames = { A, B }：结束行用的阵营名
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  const EFFECT_TYPES = ['buff', 'debuff', 'guard', 'taunt', 'shield', 'push', 'pull'];

  function namer(tl) {
    const m = {};
    for (const u of tl.units) m[u.uid] = u.name;
    return (uid) => m[uid] || uid;
  }

  /** 效果事件（可能是同一效果作用于多个目标的一组）→ 一句话 */
  function effectText(group, n) {
    const e = group[0];
    const names = group.map((x) => n(x.target)).join('、');
    switch (e.type) {
      case 'buff': case 'debuff': return `${names} ${DAO.statLabel(e.stat)} ${e.value > 0 ? '+' : ''}${DAO.fmtValue(e.value)}（${e.duration} 动）`;
      case 'guard': return `${names} 守护后排（${e.duration} 动）`;
      case 'taunt': return `${names} 嘲讽（${e.duration} 动）`;
      case 'shield': return `${names} 护盾 ${e.amount}`;
      case 'push': return `${names} 推条 +${Math.round(e.value)}`;
      case 'pull': return `${names} 拉条 −${Math.round(e.value)}`;
      case 'heal': return `${names} 回复 ${group.reduce((a, x) => a + x.amount, 0)}`;
      case 'cdReduce': return `${e.skills.join('、')} CD −${e.value}`;
      case 'extraAction': return `${n(e.actor)} 再动`;
      default: return e.type;
    }
  }
  /** 连续的、同一来源同一效果的事件合成一组（「A、B 护甲 +60」） */
  function groupEffects(list) {
    const out = [];
    for (const e of list) {
      const last = out[out.length - 1];
      const same = last && last[0].type === e.type && last[0].parent === e.parent && last[0].stat === e.stat && last[0].value === e.value &&
        last[0].duration === e.duration && last[0].amount === e.amount && e.type !== 'cdReduce' && e.type !== 'extraAction';
      if (same) last.push(e); else out.push([e]);
    }
    return out;
  }

  function formatBeat(beat, tl, opts) {
    opts = opts || {};
    const n = namer(tl);
    const lines = [];
    const r = beat.root;
    switch (r.type) {
      case 'battleStart': lines.push({ kind: 'round', depth: 0, text: '—— 开场 ——' }); break;
      case 'roundStart': lines.push({ kind: 'round', depth: 0, text: `—— 第 ${r.round} 回合 ——` }); break;
      case 'action': lines.push({ kind: 'action', depth: 0, side: r.actor[0], text: `${n(r.actor)}${r.extra ? '【再动】' : ''} 施放「${r.skillName}」〔${DAO.SHAPE_NAMES[r.shape] || ''}〕` }); break;
      case 'battleEnd': {
        const sn = opts.sideNames;
        const text = r.winner === 'draw' ? `== 平局${r.timeout ? '（回合上限）' : ''} ==` : sn ? `== ${sn[r.winner] || r.winner}胜 ==` : `== ${r.winner} 方胜 ==`;
        lines.push({ kind: 'end', depth: 0, text });
        break;
      }
    }
    const rest = beat.events.slice(1);
    const triggerIds = new Set(rest.filter((e) => e.type === 'trigger').map((e) => e.id));
    let pending = [];  // 待合并的效果事件
    const flush = () => { for (const g of groupEffects(pending)) lines.push({ kind: g[0].type === 'heal' ? 'heal' : 'effect', depth: 1, text: g[0].type === 'heal' ? `→ ${n(g[0].target)} +${g[0].amount}` : `· ${effectText(g, n)}` }); pending = []; };
    for (const e of rest) {
      if (triggerIds.has(e.parent)) continue;          // 触发产生的效果写在触发那一行里
      if (EFFECT_TYPES.includes(e.type) || e.type === 'heal') { pending.push(e); continue; }
      flush();
      if (e.type === 'hit') {
        let t = `→ ${n(e.target)} −${e.dmg}`;
        if (e.crit) t += ' 暴击!';
        if (e.absorbed) t += `（护盾吸收 ${e.absorbed}）`;
        if (e.redirectedBy === 'guard') t += `（守护，替 ${n(e.original)} 挡下）`;
        if (e.redirectedBy === 'taunt') t += '（被嘲讽）';
        if (e.killed) t += ' ✗ 击杀';
        lines.push({ kind: e.crit ? 'crit' : 'hit', depth: 1, text: t });
      } else if (e.type === 'trigger') {
        const kids = groupEffects(rest.filter((x) => x.parent === e.id));
        lines.push({ kind: 'chain', depth: 2, text: `⚡ ${e.name} → ${kids.map((g) => effectText(g, n)).join('；')}` });
      }
      // death 已写在 hit 行（✗ 击杀）
    }
    flush();
    return lines;
  }

  function formatTimeline(tl, opts) {
    const out = [];
    for (const b of DAO.Replay.beats(tl)) for (const l of formatBeat(b, tl, opts)) out.push('  '.repeat(l.depth) + l.text);
    return out.join('\n');
  }

  DAO.BattleLog = { formatBeat, formatTimeline };
})(typeof globalThis !== 'undefined' ? globalThis : this);
