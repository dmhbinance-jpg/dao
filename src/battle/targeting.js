/**
 * 目标选择（设计文档第 4 节）。
 *  - 近战单体只能打前排；前排全灭后后排暴露
 *  - 远程 / 法术 / 带 pierce 的技能可以打任意目标
 *  - 前排 / 后排 / 全体 / 弹射：任何技能都不会因对手站位而作废（某排空了就落到另一排）
 *  - 嘲讽：敌方单体攻击只能打嘲讽者
 *  - 守护：己方后排受到的单体攻击转给守护者
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  const alive = (units) => units.filter((u) => u.alive);

  function sideUnits(battle, side) {
    return alive(battle.units.filter((u) => u.side === side));
  }
  function otherSide(side) {
    return side === 'A' ? 'B' : 'A';
  }
  function rowUnits(battle, side, row) {
    return sideUnits(battle, side).filter((u) => u.row === row);
  }
  /** 当前「暴露在前」的一排：前排还有人就是前排，否则后排 */
  function exposedFront(battle, side) {
    const f = rowUnits(battle, side, 'front');
    return f.length ? f : rowUnits(battle, side, 'back');
  }
  function backOrFallback(battle, side) {
    const b = rowUnits(battle, side, 'back');
    return b.length ? b : rowUnits(battle, side, 'front');
  }

  const hpRatio = (u) => u.hp / u.base.maxHp;
  const defOf = (u) => u.base.armor + u.base.resist;

  /** 按规则从候选里挑一个 */
  function pickByRule(battle, candidates, rule) {
    if (!candidates.length) return null;
    switch (rule) {
      case 'lowestHp':
        return candidates.slice().sort((a, b) => hpRatio(a) - hpRatio(b) || a.index - b.index)[0];
      case 'highestDef':
        return candidates.slice().sort((a, b) => defOf(b) - defOf(a) || a.index - b.index)[0];
      case 'highestAtk':
        return candidates.slice().sort((a, b) => Math.max(b.base.pAtk, b.base.mAtk) - Math.max(a.base.pAtk, a.base.mAtk))[0];
      case 'backRow': {
        const back = candidates.filter((u) => u.row === 'back');
        return battle.rng.pick(back.length ? back : candidates);
      }
      default:
        return battle.rng.pick(candidates);
    }
  }

  function findTaunter(battle, side) {
    return sideUnits(battle, side).find((u) => u.status.taunt > 0) || null;
  }
  function findGuard(battle, side, exclude) {
    return sideUnits(battle, side).find((u) => u.status.guard > 0 && u !== exclude) || null;
  }

  /**
   * 敌方单体攻击的目标：返回 { target, redirectedBy }
   */
  function singleEnemyTarget(battle, actor, skill) {
    const es = otherSide(actor.side);
    const taunter = findTaunter(battle, es);
    if (taunter) return { target: taunter, redirectedBy: 'taunt' };
    let candidates;
    if (skill.range === 'melee' && !skill.pierce) candidates = exposedFront(battle, es);
    else candidates = sideUnits(battle, es);
    let target = pickByRule(battle, candidates, skill.targetRule);
    if (!target) return { target: null };
    // 守护：后排被单体攻击时，由守护者代受
    if (target.row === 'back') {
      const g = findGuard(battle, es, target);
      if (g) return { target: g, redirectedBy: 'guard', original: target };
    }
    return { target };
  }

  /** 群体形状的目标集合 */
  function shapeTargets(battle, actor, skill) {
    const es = otherSide(actor.side);
    switch (skill.shape) {
      case 'front': return exposedFront(battle, es);
      case 'back': return backOrFallback(battle, es);
      case 'all': return sideUnits(battle, es);
      default: return [];
    }
  }

  /** 弹射单跳的目标 */
  function bounceTarget(battle, actor, lastTarget) {
    const es = otherSide(actor.side);
    let candidates = sideUnits(battle, es);
    if (!DAO.CONFIG.bounce.allowRepeatConsecutive && lastTarget && candidates.length > 1) {
      candidates = candidates.filter((u) => u !== lastTarget);
    }
    let target = battle.rng.pick(candidates);
    if (target && DAO.CONFIG.guard.coversBounce && target.row === 'back') {
      const g = findGuard(battle, es, target);
      if (g) return { target: g, redirectedBy: 'guard', original: target };
    }
    return { target };
  }

  /** 治疗目标 */
  function healTargets(battle, actor, skill) {
    const allies = sideUnits(battle, actor.side);
    if (skill.shape === 'single') return [pickByRule(battle, allies, 'lowestHp')].filter(Boolean);
    if (skill.shape === 'front') return exposedFront(battle, actor.side);
    if (skill.shape === 'back') return backOrFallback(battle, actor.side);
    return allies;
  }

  /** 效果目标解析 */
  function effectTargets(battle, actor, effect, primaryTargets) {
    switch (effect.target) {
      case 'self': return [actor];
      case 'target':
      case 'hitTargets': return primaryTargets.filter((u) => u.alive);
      case 'allies': return sideUnits(battle, actor.side);
      case 'row': return rowUnits(battle, actor.side, actor.row);
      case 'ally': return [pickByRule(battle, sideUnits(battle, actor.side), 'lowestHp')].filter(Boolean);
      case 'enemies': return sideUnits(battle, otherSide(actor.side));
      default: return [];
    }
  }

  DAO.Targeting = {
    sideUnits, otherSide, rowUnits, exposedFront, backOrFallback,
    singleEnemyTarget, shapeTargets, bounceTarget, healTargets, effectTargets, pickByRule, hpRatio,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
