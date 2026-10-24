/**
 * 数据定义 → 战斗单位。
 * 把配置表里的角色模板（三维、技能卡档位、天赋档位、2选1）编译成战斗引擎用的单位对象。
 * 纯函数，不依赖 UI。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const lerp = (min, max, roll) => min + (max - min) * Math.max(0, Math.min(1, roll));

  /** 档位 → 实际数值 */
  function rollValue(def, roll) {
    return lerp(def.min, def.max, roll == null ? 0.5 : roll);
  }

  /** 给技能补上形状标签 */
  function withShapeTag(skill) {
    const tags = (skill.tags || []).slice();
    if (skill.dmgType !== 'none' || skill.shape !== 'single') {
      const st = DAO.shapeTag(skill.shape);
      if (!tags.includes(st)) tags.push(st);
    }
    skill.tags = tags;
    return skill;
  }

  /** 解析技能卡：掷出的数值写回技能 */
  function cardSkill(cardInst) {
    const card = DAO.CONFIG.cards[cardInst.id];
    if (!card || !card.skill) return null;
    const s = clone(card.skill);
    const v = rollValue(card.roll, cardInst.roll);
    if (card.roll.key === 'mult') s.mult = v;
    else if (card.roll.key === 'value') (s.effects || []).forEach((e) => (e.value = v));
    s.id = card.id;
    s.name = card.name;
    s.source = 'card';
    s.rolled = { key: card.roll.key, value: v, roll: cardInst.roll };
    return withShapeTag(s);
  }

  function innateSkill(innateId, branch) {
    const def = DAO.CONFIG.innateSkills[innateId];
    if (!def) return null;
    const s = clone(def.variants[branch || 0]);
    s.id = def.id + (branch ? '_B' : '_A');
    s.baseName = def.name;
    s.source = 'innate';
    return withShapeTag(s);
  }

  function basicSkill(key) {
    const s = clone(DAO.CONFIG.basicSkills[key]);
    s.source = 'basic';
    s.cd = 0;
    return withShapeTag(s);
  }

  /**
   * 某等级的三维。
   *  - 有 growth（成长资质）时：三维 = base + growth × 等级（设计文档第 6 节）
   *  - 否则直接用 stats（V0 角色写的是已含等级的最终值）
   */
  function statsAt(ch, level) {
    if (ch.growth) {
      const b = ch.base || { str: 0, agi: 0, int: 0 };
      return {
        str: b.str + ch.growth.str * level,
        agi: b.agi + ch.growth.agi * level,
        int: b.int + ch.growth.int * level,
      };
    }
    return ch.stats;
  }

  /**
   * 编译单位
   * @param {object} ch     角色模板（CONFIG.characters[x]，可被阵容编辑器覆盖）
   * @param {string} side   'A' | 'B'
   * @param {string} row    'front' | 'back'
   * @param {number} slot
   */
  function buildUnit(ch, side, row, slot, charId) {
    const C = DAO.CONFIG;
    const D = C.derive;
    const role = C.roles[ch.role] || { hpMul: 1 };
    const hpMul = ch.hpMul != null ? ch.hpMul : role.hpMul;
    const level = ch.level || C.level || 1;
    const stats = statsAt(ch, level);

    const pct = { strPct: 0, agiPct: 0, intPct: 0, hpPct: 0, armorPct: 0, resistPct: 0 };
    const flat = { critRate: 0, critDmg: 0, speed: 0, armor: 0, resist: 0 };
    const mods = { dmgUp: ch.dmgUp || 0, finalDmg: 0, healUp: 0, tagDmg: [] }; // ch.dmgUp：敌人模板的伤害修正（进增伤区）
    const triggers = [];
    const talentInfo = [];

    // ---- 天赋 ----
    let triggerCount = 0;
    for (const t of ch.talents || []) {
      const def = C.talents[t.id];
      if (!def) continue;
      const v = rollValue(def, t.roll);
      talentInfo.push({ id: t.id, name: def.name, tier: def.tier, value: v, roll: t.roll, desc: def.desc });
      if (def.tier === 'stat') {
        if (def.stat in pct) pct[def.stat] += v;
        else if (def.stat in flat) flat[def.stat] += v;
        else if (def.stat in mods) mods[def.stat] += v;
      } else if (def.tier === 'tag') {
        mods.tagDmg.push({ tags: def.tags, value: v, src: def.name });
      } else if (def.tier === 'trigger') {
        if (triggerCount++ >= 1) continue; // 每角色最多一条触发型
        triggers.push({
          id: t.id, name: def.name, event: def.event,
          requireTags: def.requireTags || null,
          effect: Object.assign({}, def.effect, def.effect.value == null ? { value: v } : {}),
          maxPerRound: def.maxPerRound != null ? def.maxPerRound : C.trigger.defaultMaxPerRound,
          chance: def.chance != null ? def.chance : 1,
        });
      }
    }

    // ---- 被动卡 ----
    let passiveInfo = null;
    if (ch.passiveCard && C.cards[ch.passiveCard.id]) {
      const card = C.cards[ch.passiveCard.id];
      const v = rollValue(card.roll, ch.passiveCard.roll);
      const p = card.passive || {};
      if (p.tagDmgUp) mods.tagDmg.push({ tags: p.tagDmgUp.tags, value: v, src: card.name });
      else if (p.stat in flat) flat[p.stat] += v;
      else if (p.stat in mods) mods[p.stat] += v;
      passiveInfo = { id: card.id, name: card.name, value: v, roll: ch.passiveCard.roll, stat: p.stat || 'tagDmgUp' };
      if (card.trigger && triggerCount < 1) {
        triggers.push({
          id: card.trigger.id, name: card.trigger.name, event: card.trigger.event,
          requireTags: card.trigger.requireTags || null,
          effect: Object.assign({}, card.trigger.effect),
          maxPerRound: card.trigger.maxPerRound != null ? card.trigger.maxPerRound : C.trigger.defaultMaxPerRound,
          chance: card.trigger.chance != null ? card.trigger.chance : 1,
        });
        triggerCount++;
      }
    }

    // ---- 三维 → 二级属性 ----
    // 装备（阶段 3）：ch.gear = { atk, armor, resist, hp, str, agi, int } 合计加成。三维加在百分比天赋之前。
    const gear = ch.gear || {};
    const str = (stats.str + (gear.str || 0)) * (1 + pct.strPct);
    const agi = (stats.agi + (gear.agi || 0)) * (1 + pct.agiPct);
    const int = (stats.int + (gear.int || 0)) * (1 + pct.intPct);
    const base = {
      str, agi, int,
      pAtk: str * D.pAtkPerStr,
      mAtk: int * D.mAtkPerInt,
      healPower: int * D.healPowerPerInt,
      armor: str * D.armorPerStr * (1 + pct.armorPct) + flat.armor,
      resist: int * D.resistPerInt * (1 + pct.resistPct) + flat.resist,
      speed: D.speedBase + agi * D.speedPerAgi + flat.speed,
      critRate: D.critRateBase + agi * D.critRatePerAgi + flat.critRate,
      critDmg: D.critDmgBase + agi * D.critDmgPerAgi + flat.critDmg,
      maxHp: Math.round((D.hpBase + D.hpPerLevel * level) * hpMul * (1 + pct.hpPct)),
    };
    // 装备的固定攻击加在物攻和法攻上（剑修吃物攻、法修吃法攻），护甲 / 法抗 / 气血直接加
    if (gear.atk) { base.pAtk += gear.atk; base.mAtk += gear.atk; }
    if (gear.armor) base.armor += gear.armor;
    if (gear.resist) base.resist += gear.resist;
    if (gear.hp) base.maxHp += Math.round(gear.hp);

    // ---- 技能（优先级顺序：主动卡 > 固有 > 普攻） ----
    const skills = [];
    if (ch.activeCard) {
      const s = cardSkill(ch.activeCard);
      if (s) { s.key = 'activeCard'; skills.push(s); }
    }
    const inn = innateSkill(ch.innate, ch.branch);
    if (inn) { inn.key = 'innate'; skills.push(inn); }
    const bas = basicSkill(ch.basic || ch.role);
    bas.key = 'basic';
    skills.push(bas);
    const order = C.ai.priority;
    skills.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

    const cds = {};
    for (const s of skills) cds[s.key] = C.cast.startReady ? 0 : s.cd || 0;

    return {
      uid: side + slot,
      charId: charId || ch.id,
      side, row, slot,
      name: ch.name, title: ch.title, role: ch.role, level,
      exp: ch.exp || 0, // 被击杀时给击杀者的经验（敌人用）
      base, mods, skills, cds, triggers,
      talentInfo, passiveInfo,
      hp: base.maxHp, shield: 0, alive: true, bar: 0,
      buffs: [],
      status: { guard: 0, taunt: 0 },
      // 每回合计数
      actionsThisRound: 0, extraThisRound: 0, pendingExtra: false,
      stats: newStats(),
    };
  }

  function newStats() {
    return {
      actions: 0, extraActions: 0, crits: 0, kills: 0,
      dmgDealt: 0, dmgEffective: 0, overkill: 0, dmgTaken: 0,
      healDone: 0, overheal: 0, shieldGiven: 0, shieldAbsorbed: 0,
      supportMitigated: 0, supportAmplified: 0, // 辅助贡献：防御区（减伤/破甲）和增伤 buff
      supportArmorBuff: 0, supportArmorBreak: 0, supportDmgBuff: 0,
      redirected: 0, // 守护/嘲讽挡下的攻击次数
      victims: [],   // 击杀记录 [{ id, level, exp }]，用于结算经验
      triggers: {},  // triggerName -> count
      skills: {},    // skillName -> {casts, dmg, sumSq, hits}
    };
  }

  /**
   * 阵容 → 单位数组
   * lineup: [{ charId, row, override? }]，override 用于阵容编辑器（覆盖 branch、卡档位等）
   */
  function buildTeam(lineup, side) {
    const out = [];
    const rowCount = { front: 0, back: 0 };
    lineup.forEach((entry, i) => {
      // 三种来源：内联角色（玩家角色）/ V0 角色模板 / 敌人模板
      const id = entry.charId || entry.enemyId || (entry.char && entry.char.id);
      const tpl = entry.char || (entry.enemyId ? ((DAO.CONFIG.game || {}).enemies || {})[entry.enemyId] : DAO.CONFIG.characters[entry.charId]);
      if (!tpl) throw new Error('未知角色: ' + id);
      const ch = Object.assign(clone(tpl), entry.override ? clone(entry.override) : {});
      if (entry.level != null) ch.level = entry.level;
      ch.id = id;
      const row = entry.row || ch.row || 'front';
      out.push(buildUnit(ch, side, row, rowCount[row]++ + (row === 'back' ? 10 : 0), id));
      out[out.length - 1].uid = side + i;
      out[out.length - 1].index = i;
    });
    return out;
  }

  /** 阵容合法性 */
  function validateLineup(lineup) {
    const errs = [];
    const C = DAO.CONFIG.formation;
    if (lineup.length === 0) errs.push('阵容为空');
    if (lineup.length > C.teamSize) errs.push(`上阵人数超过 ${C.teamSize}`);
    const f = lineup.filter((e) => e.row === 'front').length;
    const b = lineup.filter((e) => e.row === 'back').length;
    if (f > C.maxPerRow) errs.push(`前排 ${f} 人，超过上限 ${C.maxPerRow}`);
    if (b > C.maxPerRow) errs.push(`后排 ${b} 人，超过上限 ${C.maxPerRow}`);
    const ids = lineup.filter((e) => e.charId).map((e) => e.charId); // 敌人模板可重复
    if (new Set(ids).size !== ids.length) errs.push('同一角色重复上阵');
    return errs;
  }

  DAO.Model = { rollValue, cardSkill, innateSkill, basicSkill, statsAt, buildUnit, buildTeam, validateLineup, clone, newStats };
})(typeof globalThis !== 'undefined' ? globalThis : this);
