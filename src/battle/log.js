/**
 * 战斗日志 → 文本。命令行和 UI 共用。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  function nameOf(battleOrUnits, uid) {
    const units = battleOrUnits.units || battleOrUnits;
    const u = units.find((x) => x.uid === uid);
    return u ? u.name : uid;
  }

  /** 返回 [{text, kind, depth}] */
  function formatEntry(entry, units) {
    const lines = [];
    const n = (uid) => nameOf(units, uid);
    switch (entry.type) {
      case 'round':
        lines.push({ kind: 'round', depth: 0, text: `—— 第 ${entry.round} 回合 ——` });
        break;
      case 'start':
        lines.push({ kind: 'round', depth: 0, text: '—— 开场 ——' });
        break;
      case 'trigger':
        break;
      case 'action': {
        const shape = DAO.SHAPE_NAMES[entry.shape] || '';
        let head = `${n(entry.actor)}${entry.extra ? '【再动】' : ''} 施放「${entry.skill}」〔${shape}〕`;
        lines.push({ kind: 'action', depth: 0, text: head, side: entry.actor[0] });
        for (const h of entry.hits) {
          let t = `→ ${n(h.target)} −${h.dmg}`;
          if (h.crit) t += ' 暴击!';
          if (h.absorbed) t += `（护盾吸收 ${h.absorbed}）`;
          if (h.redirectedBy === 'guard') t += `（守护，替 ${n(h.original)} 挡下）`;
          if (h.redirectedBy === 'taunt') t += '（被嘲讽）';
          if (h.killed) t += ' ✗ 击杀';
          lines.push({ kind: h.crit ? 'crit' : 'hit', depth: 1, text: t });
        }
        for (const h of entry.heals) lines.push({ kind: 'heal', depth: 1, text: `→ ${n(h.target)} +${h.amount}` });
        for (const e of entry.effects) lines.push({ kind: 'effect', depth: 1, text: `· ${e}` });
        break;
      }
      case 'end':
        lines.push({
          kind: 'end', depth: 0,
          text: entry.winner === 'draw' ? `== 平局${entry.timeout ? '（回合上限）' : ''} ==` : `== ${entry.winner} 方胜 ==`,
        });
        break;
    }
    for (const c of entry.chain || []) lines.push({ kind: 'chain', depth: 2, text: `⚡ ${c.text}` });
    return lines;
  }

  function formatLog(log, units) {
    const out = [];
    for (const e of log) for (const l of formatEntry(e, units)) out.push('  '.repeat(l.depth) + l.text);
    return out.join('\n');
  }

  DAO.BattleLog = { formatEntry, formatLog };
})(typeof globalThis !== 'undefined' ? globalThis : this);
