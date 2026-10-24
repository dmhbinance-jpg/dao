/**
 * 五个乘区（设计文档第 5 节）：
 *   伤害 = 攻击 × 技能倍率 × (1+Σ增伤) × 暴击 × (1+Σ终伤) × k/(k+护甲或法抗)
 *
 *  - buff / debuff 都加算进已有乘区，没有独立的易伤 / 承伤区
 *  - 辅助效果主要走防御区：己方减伤 buff 加护甲 / 法抗，敌方破甲 debuff 减护甲 / 法抗，最多减到 0
 *  - 终伤区只来自稀有天赋和橙卡，不做 buff
 *  - 没有伤害随机浮动；暴击用带种子的随机数判定
 *
 * 同时计算「辅助贡献」：把防御区 buff、破甲 debuff、增伤 buff 分别拿掉重算一遍，差值记到施加者头上。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  /** 某属性上所有 buff 的和；sign>0 只算正值，<0 只算负值 */
  function buffSum(unit, stat, sign) {
    let s = 0;
    for (const b of unit.buffs) {
      if (b.stat !== stat) continue;
      if (sign > 0 && b.value < 0) continue;
      if (sign < 0 && b.value > 0) continue;
      s += b.value;
    }
    return s;
  }
  function buffsOf(unit, stat, sign) {
    return unit.buffs.filter((b) => b.stat === stat && (sign > 0 ? b.value > 0 : b.value < 0));
  }

  function speedOf(u) {
    return Math.max(1, u.base.speed + buffSum(u, 'speed', 0));
  }

  /** 增伤区里非 buff 的部分（天赋 / 被动卡 / 标签） */
  function staticDmgUp(attacker, skill) {
    let s = attacker.mods.dmgUp;
    for (const t of attacker.mods.tagDmg) if (DAO.tagsMatch(skill.tags, t.tags)) s += t.value;
    return s;
  }

  function defenseMul(def) {
    const k = DAO.CONFIG.damage.defenseK;
    return k / (k + Math.max(DAO.CONFIG.damage.minDefense, def));
  }

  /**
   * @returns {{ dmg, crit, zones, contrib: [{source, kind, amount}] }}
   */
  function computeDamage(battle, attacker, target, skill, multScale) {
    const C = DAO.CONFIG.damage;
    const isPhys = skill.dmgType === 'physical';
    const atk = isPhys ? attacker.base.pAtk : attacker.base.mAtk;
    const baseZone = atk * (skill.mult || 0) * (multScale == null ? 1 : multScale);

    const dmgUpStatic = staticDmgUp(attacker, skill);
    const dmgUpBuff = buffSum(attacker, 'dmgUp', 0);
    const dmgUpZone = 1 + dmgUpStatic + dmgUpBuff;

    const critRate = Math.min(C.critRateCap, attacker.base.critRate + buffSum(attacker, 'critRate', 0));
    const crit = battle.rng.chance(critRate);
    const critZone = crit ? attacker.base.critDmg + buffSum(attacker, 'critDmg', 0) : 1;

    const finalZone = 1 + attacker.mods.finalDmg;

    const stat = isPhys ? 'armor' : 'resist';
    const defBase = target.base[stat];
    const defUp = buffSum(target, stat, 1);   // 目标己方给的减伤（加护甲 / 法抗）
    const defDown = buffSum(target, stat, -1); // 攻击方给的破甲（负值）
    const def = Math.max(0, defBase + defUp + defDown);
    const defZone = defenseMul(def);

    const raw = baseZone * dmgUpZone * critZone * finalZone * defZone;
    const fin = (x) => Math.max(C.minDamage, C.floorDamage ? Math.floor(x) : x);
    const dmg = fin(raw);

    // ---- 辅助贡献归因 ----
    const contrib = [];
    const common = baseZone * critZone * finalZone;
    if (defUp > 0) {
      const without = common * dmgUpZone * defenseMul(Math.max(0, defBase + defDown));
      const saved = without - raw;
      if (saved > 0) for (const b of buffsOf(target, stat, 1)) contrib.push({ source: b.source, kind: 'mitigate', amount: (saved * b.value) / defUp });
    }
    if (defDown < 0) {
      const without = common * dmgUpZone * defenseMul(Math.max(0, defBase + defUp));
      const extra = raw - without;
      if (extra > 0) for (const b of buffsOf(target, stat, -1)) contrib.push({ source: b.source, kind: 'break', amount: (extra * b.value) / defDown });
    }
    if (dmgUpBuff > 0) {
      const without = common * (1 + dmgUpStatic) * defZone;
      const extra = raw - without;
      if (extra > 0) for (const b of buffsOf(attacker, 'dmgUp', 1)) contrib.push({ source: b.source, kind: 'amplify', amount: (extra * b.value) / dmgUpBuff });
    }

    return {
      dmg, crit,
      zones: { base: baseZone, dmgUp: dmgUpZone, crit: critZone, final: finalZone, def: defZone, defValue: def },
      contrib,
    };
  }

  /** 治疗：治疗强度 × 倍率 × (1 + 治疗加成 + 匹配标签) */
  function computeHeal(caster, skill, multScale) {
    const up = caster.mods.healUp + staticDmgUp(caster, skill) + buffSum(caster, 'healUp', 0);
    return Math.floor(caster.base.healPower * (skill.mult || 0) * (multScale == null ? 1 : multScale) * (1 + up));
  }

  function computeShield(caster, value) {
    const up = caster.mods.healUp + buffSum(caster, 'healUp', 0);
    return Math.floor(caster.base.healPower * value * (1 + up));
  }

  DAO.Damage = { computeDamage, computeHeal, computeShield, buffSum, speedOf, staticDmgUp, defenseMul };
})(typeof globalThis !== 'undefined' ? globalThis : this);
