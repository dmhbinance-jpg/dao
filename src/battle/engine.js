/**
 * 战斗引擎：拉条内核（设计文档第 4 节）。
 *
 *  - 每个单位行动条按速度填充，满了出手；技能可推条 / 拉条
 *  - CD 按角色自己的行动次数计：施放后 CD=n，此后每次「自己行动但没放这个技能」CD−1
 *  - 「回合」= 全局时间每 ticksPerRound 个刻度；速度 100 的单位每回合恰好出手一次
 *  - 有界规则：再动每回合最多 1 次；触发不可递归；每单位每回合行动上限
 *  - 唯一随机来源是 battle.rng（暴击、随机目标、弹射、触发几率）——同种子同阵容完全复现
 *
 * 纯逻辑，不碰 DOM；浏览器和 Node 共用。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});
  const EV = DAO.EVENTS;

  class Battle {
    /**
     * @param {Array} lineupA  [{charId, row, override?}]
     * @param {Array} lineupB
     * @param {object} opts    { seed, record }
     */
    constructor(lineupA, lineupB, opts) {
      opts = opts || {};
      this.seed = opts.seed == null ? 1 : opts.seed;
      this.record = !!opts.record;
      this.rng = new DAO.RNG(this.seed);
      this.bus = new DAO.EventBus();
      this.units = DAO.Model.buildTeam(lineupA, 'A').concat(DAO.Model.buildTeam(lineupB, 'B'));
      this.byUid = {};
      for (const u of this.units) {
        this.byUid[u.uid] = u;
        u.tiebreak = this.rng.next(); // 同速同条时的稳定随机次序
      }
      this.time = 0;
      this.round = 0;
      this.over = false;
      this.winner = null;
      this.log = [];
      this.current = null; // 正在结算的日志条目（触发链挂在这里）
      this.recursionBlocked = 0;
      this.registerTriggers();
    }

    // ================= 事件 / 触发 =================
    registerTriggers() {
      for (const u of this.units) {
        for (const t of u.triggers) {
          this.bus.on(t.event, {
            id: u.uid + ':' + t.id,
            owner: u,
            maxPerRound: t.maxPerRound,
            filter: (ctx) => {
              if (t.event === EV.HIT) { if (ctx.target !== u) return false; }
              else if (t.event === EV.ACT || t.event === EV.CRIT || t.event === EV.KILL) { if (ctx.actor !== u) return false; }
              if (t.requireTags && !(ctx.skill && DAO.tagsMatch(ctx.skill.tags, t.requireTags))) return false;
              return true;
            },
            fn: (ctx) => {
              if (t.chance < 1 && !this.rng.chance(t.chance)) return false;
              return this.applyTrigger(u, t, ctx);
            },
          });
        }
      }
    }

    emit(event, ctx) {
      const before = this.bus.suppressed;
      const fired = this.bus.emit(event, ctx);
      this.recursionBlocked += this.bus.suppressed - before;
      return fired;
    }

    chain(owner, trig, text) {
      const rec = { owner: owner.uid, trigger: trig.name, text };
      owner.stats.triggers[trig.name] = (owner.stats.triggers[trig.name] || 0) + 1;
      if (this.current) this.current.chain.push(rec);
      else if (this.record) this.log.push({ type: 'trigger', round: this.round, time: this.time, chain: [rec] });
    }

    /** 执行一条触发效果。返回 false 表示没有生效（不计次数）。 */
    applyTrigger(u, t, ctx) {
      const e = t.effect;
      const C = DAO.CONFIG;
      switch (e.kind) {
        case 'cdReduce': {
          const changed = [];
          for (const s of u.skills) {
            if (s.key === 'basic') continue;
            if (e.tags && e.tags.length && !DAO.tagsMatch(s.tags, e.tags)) continue;
            if (u.cds[s.key] > 0) {
              u.cds[s.key] = Math.max(0, u.cds[s.key] - e.value);
              changed.push(s.name);
            }
          }
          if (!changed.length) return false;
          this.chain(u, t, `${t.name} → ${changed.join('、')} CD −${e.value}`);
          return true;
        }
        case 'extraAction': {
          if (u.pendingExtra || u.extraThisRound >= C.actionBar.maxExtraActionsPerRound) return false;
          u.pendingExtra = true;
          this.chain(u, t, `${t.name} → ${u.name} 再动`);
          return true;
        }
        case 'healSelf': {
          const amt = this.doHeal(u, u, Math.floor(u.base.maxHp * e.value));
          if (amt <= 0) return false;
          this.chain(u, t, `${t.name} → ${u.name} 回复 ${amt}`);
          return true;
        }
        case 'shieldSelf': {
          const amt = Math.floor(u.base.maxHp * e.value);
          this.giveShield(u, u, amt);
          this.chain(u, t, `${t.name} → ${u.name} 护盾 ${amt}`);
          return true;
        }
        case 'buffSelf':
        case 'buffRow': {
          const targets = e.kind === 'buffSelf' ? [u] : DAO.Targeting.rowUnits(this, u.side, u.row);
          for (const x of targets) this.applyBuff(x, { stat: e.stat, value: e.value, duration: e.duration, source: u.uid, name: t.name });
          this.chain(u, t, `${t.name} → ${targets.map((x) => x.name).join('、')} ${statLabel(e.stat)} +${fmt(e.value)}`);
          return true;
        }
        case 'pushSelf': {
          u.bar += e.value;
          this.chain(u, t, `${t.name} → ${u.name} 推条 +${Math.round(e.value)}`);
          return true;
        }
        default:
          return false;
      }
    }

    // ================= 状态 =================
    applyBuff(target, b) {
      const ex = target.buffs.find((x) => x.name === b.name && x.stat === b.stat && x.source === b.source);
      if (ex) {
        ex.remaining = Math.max(ex.remaining, b.duration);
        if (Math.abs(b.value) > Math.abs(ex.value)) ex.value = b.value;
      } else {
        target.buffs.push({ stat: b.stat, value: b.value, remaining: b.duration, source: b.source, name: b.name });
      }
    }

    /** 持有者每次行动开始时，buff / 守护 / 嘲讽 剩余次数 −1 */
    tickStatuses(u) {
      for (const b of u.buffs) b.remaining--;
      u.buffs = u.buffs.filter((b) => b.remaining > 0);
      if (u.status.guard > 0) u.status.guard--;
      if (u.status.taunt > 0) u.status.taunt--;
    }

    doHeal(caster, target, amount) {
      if (!target.alive || amount <= 0) return 0;
      const actual = Math.min(amount, target.base.maxHp - target.hp);
      target.hp += actual;
      caster.stats.healDone += actual;
      caster.stats.overheal += amount - actual;
      return actual;
    }

    giveShield(caster, target, amount) {
      if (amount > target.shield) {
        target.shield = amount;
        target.shieldSource = caster.uid;
      }
      caster.stats.shieldGiven += amount;
    }

    // ================= 选技能 =================
    castable(u, s) {
      const needsHurt = s.dmgType === 'heal' || (s.effects || []).some((e) => e.kind === 'shield');
      if (needsHurt) {
        const th = DAO.CONFIG.cast.healBelowHpRatio;
        return DAO.Targeting.sideUnits(this, u.side).some((x) => x.hp / x.base.maxHp < th);
      }
      return true;
    }

    chooseSkill(u) {
      for (const s of u.skills) {
        if (u.cds[s.key] > 0) continue;
        if (!this.castable(u, s)) continue;
        return s;
      }
      return u.skills[u.skills.length - 1];
    }

    // ================= 出手 =================
    act(u, isExtra) {
      const C = DAO.CONFIG;
      u.actionsThisRound++;
      u.stats.actions++;
      if (isExtra) { u.extraThisRound++; u.stats.extraActions++; }
      this.tickStatuses(u);

      const skill = this.chooseSkill(u);
      const entry = {
        type: 'action', round: this.round, time: this.time, actor: u.uid,
        skill: skill.name, skillKey: skill.key, shape: skill.shape, tags: skill.tags,
        extra: !!isExtra, hits: [], heals: [], effects: [], chain: [],
      };
      this.current = entry;

      let justUsed = null;
      if (skill.cd > 0) { u.cds[skill.key] = skill.cd; justUsed = skill.key; }

      this.castDmg = 0;
      this.emit(EV.ACT, { actor: u, skill });
      this.resolve(u, skill, entry);

      // 自身其他技能 CD −1
      for (const s of u.skills) if (s.key !== justUsed && u.cds[s.key] > 0) u.cds[s.key]--;
      if (!isExtra) u.bar = Math.max(0, u.bar - C.actionBar.max);

      // 技能统计
      const ss = (u.stats.skills[skill.name] = u.stats.skills[skill.name] || { casts: 0, dmg: 0, sumSq: 0, hits: 0, heal: 0, shape: skill.shape });
      ss.casts++;
      ss.dmg += this.castDmg;
      ss.sumSq += this.castDmg * this.castDmg;
      ss.hits += entry.hits.length;
      ss.heal += entry.heals.reduce((a, h) => a + h.amount, 0);

      this.current = null;
      if (this.record) {
        entry.snapshot = this.snapshot();
        this.log.push(entry);
      }
      this.checkEnd();
    }

    resolve(u, skill, entry) {
      const Tg = DAO.Targeting;
      const primary = [];
      if (skill.dmgType === 'physical' || skill.dmgType === 'magic') {
        if (skill.shape === 'single') {
          const r = Tg.singleEnemyTarget(this, u, skill);
          if (r.target) { this.hit(u, r.target, skill, 1, entry, r.redirectedBy, r.original); primary.push(r.target); }
        } else if (skill.shape === 'bounce') {
          const n = skill.bounces || DAO.CONFIG.bounce.defaultHits;
          const decay = skill.bounceDecay != null ? skill.bounceDecay : DAO.CONFIG.bounce.defaultDecay;
          let last = null;
          for (let i = 0; i < n && !this.over; i++) {
            const r = Tg.bounceTarget(this, u, last);
            if (!r.target) break;
            this.hit(u, r.target, skill, Math.pow(decay, i), entry, r.redirectedBy, r.original);
            primary.push(r.target);
            last = r.target;
          }
        } else {
          for (const t of Tg.shapeTargets(this, u, skill)) {
            if (this.over) break;
            this.hit(u, t, skill, 1, entry);
            primary.push(t);
          }
        }
      } else if (skill.dmgType === 'heal') {
        for (const t of Tg.healTargets(this, u, skill)) {
          const amt = this.doHeal(u, t, DAO.Damage.computeHeal(u, skill, 1));
          entry.heals.push({ target: t.uid, amount: amt });
          primary.push(t);
        }
      } else if ((skill.effects || []).some((e) => e.target === 'target')) {
        // 无伤害的指向敌人技能（破甲符等）
        const t = Tg.pickByRule(this, Tg.sideUnits(this, Tg.otherSide(u.side)), skill.targetRule);
        if (t) primary.push(t);
      }
      if (this.over) return;
      for (const e of skill.effects || []) this.applyEffect(u, skill, e, primary, entry);
    }

    applyEffect(u, skill, e, primary, entry) {
      const targets = DAO.Targeting.effectTargets(this, u, e, primary);
      if (!targets.length) return;
      const names = targets.map((t) => t.name).join('、');
      switch (e.kind) {
        case 'buff':
        case 'debuff': {
          const v = e.kind === 'debuff' ? -Math.abs(e.value) : e.value;
          for (const t of targets) this.applyBuff(t, { stat: e.stat, value: v, duration: e.duration, source: u.uid, name: skill.name });
          entry.effects.push(`${names} ${statLabel(e.stat)} ${v > 0 ? '+' : ''}${fmt(v)}（${e.duration} 动）`);
          break;
        }
        case 'guard':
          for (const t of targets) t.status.guard = Math.max(t.status.guard, e.duration);
          entry.effects.push(`${names} 守护后排（${e.duration} 动）`);
          break;
        case 'taunt':
          for (const t of targets) t.status.taunt = Math.max(t.status.taunt, e.duration);
          entry.effects.push(`${names} 嘲讽（${e.duration} 动）`);
          break;
        case 'shield': {
          const amt = DAO.Damage.computeShield(u, e.value);
          for (const t of targets) this.giveShield(u, t, amt);
          entry.effects.push(`${names} 护盾 ${amt}`);
          break;
        }
        case 'push':
          for (const t of targets) t.bar += e.value;
          entry.effects.push(`${names} 推条 +${Math.round(e.value)}`);
          break;
        case 'pull':
          for (const t of targets) t.bar = Math.max(0, t.bar - e.value);
          entry.effects.push(`${names} 拉条 −${Math.round(e.value)}`);
          break;
        case 'heal': {
          for (const t of targets) {
            const amt = this.doHeal(u, t, Math.floor(u.base.healPower * e.value));
            entry.heals.push({ target: t.uid, amount: amt });
          }
          break;
        }
      }
    }

    hit(attacker, target, skill, scale, entry, redirectedBy, original) {
      if (!target || !target.alive || this.over) return;
      const r = DAO.Damage.computeDamage(this, attacker, target, skill, scale);

      for (const c of r.contrib) {
        const src = this.byUid[c.source];
        if (!src) continue;
        if (c.kind === 'mitigate') { src.stats.supportMitigated += c.amount; src.stats.supportArmorBuff += c.amount; }
        else if (c.kind === 'break') { src.stats.supportAmplified += c.amount; src.stats.supportArmorBreak += c.amount; }
        else if (c.kind === 'amplify') { src.stats.supportAmplified += c.amount; src.stats.supportDmgBuff += c.amount; }
      }

      const dmg = r.dmg;
      const absorbed = Math.min(target.shield, dmg);
      if (absorbed > 0) {
        target.shield -= absorbed;
        const src = this.byUid[target.shieldSource];
        if (src) src.stats.shieldAbsorbed += absorbed;
      }
      const hpLoss = dmg - absorbed;
      const realLoss = Math.min(hpLoss, target.hp);
      target.hp -= realLoss;
      const effective = realLoss + absorbed;

      attacker.stats.dmgDealt += dmg;
      attacker.stats.dmgEffective += effective;
      attacker.stats.overkill += hpLoss - realLoss;
      target.stats.dmgTaken += effective;
      this.castDmg += effective;

      const killed = target.hp <= 0;
      const h = { target: target.uid, dmg, crit: r.crit, absorbed, killed, scale };
      if (redirectedBy) { h.redirectedBy = redirectedBy; target.stats.redirected++; if (original) h.original = original.uid; }
      entry.hits.push(h);

      if (r.crit) {
        attacker.stats.crits++;
        this.emit(EV.CRIT, { actor: attacker, target, skill });
      }
      if (!killed) this.emit(EV.HIT, { actor: attacker, target, skill });
      if (killed) {
        target.alive = false;
        target.hp = 0;
        target.shield = 0;
        attacker.stats.kills++;
        this.emit(EV.KILL, { actor: attacker, target, skill });
        this.checkEnd();
      }
    }

    // ================= 时间 / 回合 =================
    newRound(r) {
      this.round = r;
      this.bus.newRound(r);
      for (const u of this.units) { u.actionsThisRound = 0; u.extraThisRound = 0; }
      if (this.record) this.log.push({ type: 'round', round: r, time: this.time, snapshot: this.snapshot() });
      this.emit(EV.ROUND_START, { round: r });
    }

    checkEnd() {
      if (this.over) return;
      const a = this.units.some((u) => u.side === 'A' && u.alive);
      const b = this.units.some((u) => u.side === 'B' && u.alive);
      if (!a || !b) {
        this.over = true;
        this.winner = a ? 'A' : b ? 'B' : 'draw';
      }
    }

    snapshot() {
      const out = {};
      for (const u of this.units) {
        out[u.uid] = {
          hp: u.hp, maxHp: u.base.maxHp, shield: u.shield, bar: u.bar, alive: u.alive,
          speed: DAO.Damage.speedOf(u), cds: Object.assign({}, u.cds),
          buffs: u.buffs.map((b) => ({ stat: b.stat, value: b.value, remaining: b.remaining, name: b.name })),
          guard: u.status.guard, taunt: u.status.taunt,
        };
      }
      return out;
    }

    run() {
      const C = DAO.CONFIG.actionBar;
      const MAX = C.max;
      const EPS = 1e-6;
      this.round = 1;
      this.bus.newRound(1);
      this.current = { type: 'start', round: 1, time: 0, chain: [] };
      this.emit(EV.BATTLE_START, {});
      if (this.record) this.log.push(Object.assign(this.current, { snapshot: this.snapshot() }));
      this.current = null;
      this.newRound(1);

      let guard = 0;
      while (!this.over) {
        if (++guard > 100000) throw new Error('战斗循环超限');
        if (this.round > C.maxRounds) { this.over = true; this.winner = 'draw'; this.timeout = true; break; }

        // 1) 再动优先
        const ex = this.units.find((u) => u.alive && u.pendingExtra);
        if (ex) {
          ex.pendingExtra = false;
          if (ex.actionsThisRound < C.maxActionsPerUnitPerRound) this.act(ex, true);
          continue;
        }

        // 2) 行动条满的单位
        const ready = this.units.filter((u) => u.alive && u.bar >= MAX - EPS && u.actionsThisRound < C.maxActionsPerUnitPerRound);
        if (ready.length) {
          ready.sort((a, b) => b.bar - a.bar || DAO.Damage.speedOf(b) - DAO.Damage.speedOf(a) || a.tiebreak - b.tiebreak);
          this.act(ready[0], false);
          continue;
        }

        // 3) 推进时间到下一个满条或回合边界
        const boundary = this.round * C.ticksPerRound;
        let dt = boundary - this.time;
        for (const u of this.units) {
          if (!u.alive || u.actionsThisRound >= C.maxActionsPerUnitPerRound) continue;
          dt = Math.min(dt, (MAX - u.bar) / DAO.Damage.speedOf(u));
        }
        dt = Math.max(0, dt);
        for (const u of this.units) if (u.alive) u.bar = Math.min(MAX, u.bar + DAO.Damage.speedOf(u) * dt);
        this.time += dt;
        if (this.time >= boundary - EPS) {
          this.time = boundary;
          this.newRound(this.round + 1);
        }
      }

      if (this.record) this.log.push({ type: 'end', round: this.round, time: this.time, winner: this.winner, timeout: !!this.timeout, snapshot: this.snapshot() });
      return this.result();
    }

    result() {
      return {
        seed: this.seed,
        winner: this.winner,
        timeout: !!this.timeout,
        rounds: Math.min(this.round, DAO.CONFIG.actionBar.maxRounds),
        time: this.time,
        recursionBlocked: this.recursionBlocked,
        units: this.units.map((u) => ({
          uid: u.uid, side: u.side, name: u.name, title: u.title, row: u.row, role: u.role,
          alive: u.alive, hp: u.hp, maxHp: u.base.maxHp, stats: u.stats,
        })),
        log: this.record ? this.log : null,
      };
    }
  }

  // ---------- 文本工具 ----------
  const STAT_LABEL = {
    armor: '护甲', resist: '法抗', dmgUp: '增伤', critRate: '暴击率', critDmg: '暴伤',
    speed: '速度', healUp: '治疗加成', finalDmg: '终伤',
  };
  function statLabel(s) { return STAT_LABEL[s] || s; }
  function fmt(v) {
    if (Math.abs(v) < 1) return Math.round(v * 100) + '%';
    return String(Math.round(v));
  }

  DAO.Battle = Battle;
  DAO.statLabel = statLabel;
  DAO.fmtValue = fmt;
})(typeof globalThis !== 'undefined' ? globalThis : this);
