/**
 * 战斗引擎：拉条内核（设计文档第 4 节）。
 *
 *  - 每个单位行动条按速度填充，满了出手；技能可推条 / 拉条
 *  - CD 按角色自己的行动次数计：施放后 CD=n，此后每次「自己行动但没放这个技能」CD−1
 *  - 「回合」= 全局时间每 ticksPerRound 个刻度；速度 100 的单位每回合恰好出手一次
 *  - 有界规则：再动每回合最多 1 次；触发不可递归；每单位每回合行动上限
 *  - 唯一随机来源是 battle.rng（暴击、随机目标、弹射、触发几率）——同种子同阵容完全复现
 *  - record=true 时记录结构化事件时间线（result.timeline，见下方「事件」说明），文字日志和回放都由它生成；
 *    记录与否不影响战斗结果（不消耗随机数、不改任何状态）
 *
 * 事件（timeline.events，按发生顺序；每次命中单独一条）：
 *   公共字段  id（递增）、t（战斗时间，刻度）、round、type、parent（触发来源：父事件 id，根事件为 null）
 *   根事件    battleStart | roundStart | action | battleEnd     —— 一个根事件和它的所有后代 = 回放的「一拍」
 *   action    actor、skill（技能 key）、skillId、skillName、shape、tags、extra（是否再动）
 *   hit       actor、target、skill、skillName、dmg（护盾前伤害）、crit、absorbed、hpBefore、hpAfter、shieldBefore、shieldAfter、
 *             killed、scale（弹射衰减）、redirectedBy?（guard|taunt）、original?（被替挡的目标）
 *   death     actor（击杀者）、target                    parent = 致死的 hit
 *   heal      actor、target、amount、hpBefore、hpAfter
 *   shield    actor、target、amount、shieldBefore、shieldAfter
 *   buff / debuff  actor、target、stat、value、duration、name
 *   guard / taunt  actor、target、duration
 *   push / pull    actor、target、value、barBefore、barAfter
 *   trigger   actor（天赋 / 特效持有者）、trigger（id）、name、effect（效果种类）     parent = 引发它的事件；它产生的效果事件以它为 parent
 *   cdReduce  actor、skills（技能名）、value
 *   extraAction actor
 *   battleEnd winner、timeout
 * timeline.snapshots[根事件 id] = 这一拍结束时全体单位的状态（血量、护盾、行动条、CD、buff、守护 / 嘲讽）。
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
      this.events = [];    // 结构化事件（record=true 时）
      this.snapshots = {}; // 根事件 id → 快照
      this.evSeq = 0;
      this.cause = null;   // 当前效果的来源事件 id（新事件默认挂在它下面）
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
              // 先记一条 trigger 事件，效果事件挂在它下面；没生效就撤掉
              const mark = this.events.length, seq = this.evSeq, prevCause = this.cause;
              const tid = this.rec({ type: 'trigger', actor: u.uid, trigger: t.id, name: t.name, effect: t.effect.kind, parent: ctx.eventId == null ? this.cause : ctx.eventId });
              this.cause = tid;
              const ok = this.applyTrigger(u, t, ctx);
              this.cause = prevCause;
              if (!ok && this.record) { this.events.length = mark; this.evSeq = seq; }
              return ok;
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

    /** 记一条事件（record=false 时什么都不做，返回 null）。parent 默认是当前来源 this.cause。 */
    rec(ev) {
      if (!this.record) return null;
      ev.id = ++this.evSeq;
      ev.t = this.time;
      ev.round = this.round;
      if (ev.parent === undefined) ev.parent = this.cause;
      this.events.push(ev);
      return ev.id;
    }
    /** 一拍结束：给根事件存快照 */
    snapAt(rootId) { if (this.record && rootId != null) this.snapshots[rootId] = this.snapshot(); }

    /** 触发计数（文字由事件生成） */
    chain(owner, trig) {
      owner.stats.triggers[trig.name] = (owner.stats.triggers[trig.name] || 0) + 1;
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
          this.chain(u, t);
          this.rec({ type: 'cdReduce', actor: u.uid, skills: changed, value: e.value });
          return true;
        }
        case 'extraAction': {
          if (u.pendingExtra || u.extraThisRound >= C.actionBar.maxExtraActionsPerRound) return false;
          u.pendingExtra = true;
          this.chain(u, t);
          this.rec({ type: 'extraAction', actor: u.uid });
          return true;
        }
        case 'healSelf': {
          const hpBefore = u.hp;
          const amt = this.doHeal(u, u, Math.floor(u.base.maxHp * e.value));
          if (amt <= 0) return false;
          this.chain(u, t);
          this.rec({ type: 'heal', actor: u.uid, target: u.uid, amount: amt, hpBefore, hpAfter: u.hp });
          return true;
        }
        case 'shieldSelf': {
          const amt = Math.floor(u.base.maxHp * e.value);
          this.giveShieldEv(u, u, amt);
          this.chain(u, t);
          return true;
        }
        case 'buffSelf':
        case 'buffRow': {
          const targets = e.kind === 'buffSelf' ? [u] : DAO.Targeting.rowUnits(this, u.side, u.row);
          for (const x of targets) {
            this.applyBuff(x, { stat: e.stat, value: e.value, duration: e.duration, source: u.uid, name: t.name });
            this.rec({ type: e.value < 0 ? 'debuff' : 'buff', actor: u.uid, target: x.uid, stat: e.stat, value: e.value, duration: e.duration, name: t.name });
          }
          this.chain(u, t);
          return true;
        }
        case 'pushSelf': {
          const barBefore = u.bar;
          u.bar += e.value;
          this.chain(u, t);
          this.rec({ type: 'push', actor: u.uid, target: u.uid, value: e.value, barBefore, barAfter: u.bar });
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

    giveShieldEv(caster, target, amount) {
      const shieldBefore = target.shield;
      this.giveShield(caster, target, amount);
      this.rec({ type: 'shield', actor: caster.uid, target: target.uid, amount, shieldBefore, shieldAfter: target.shield });
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
      const aid = this.rec({ type: 'action', actor: u.uid, skill: skill.key, skillId: skill.id, skillName: skill.name, shape: skill.shape, tags: skill.tags.slice(), extra: !!isExtra, parent: null });
      this.cause = aid;
      this.castHits = 0;
      this.castHeal = 0;

      let justUsed = null;
      if (skill.cd > 0) { u.cds[skill.key] = skill.cd; justUsed = skill.key; }

      this.castDmg = 0;
      this.emit(EV.ACT, { actor: u, skill, eventId: aid });
      this.resolve(u, skill);

      // 自身其他技能 CD −1
      for (const s of u.skills) if (s.key !== justUsed && u.cds[s.key] > 0) u.cds[s.key]--;
      if (!isExtra) u.bar = Math.max(0, u.bar - C.actionBar.max);

      // 技能统计
      const ss = (u.stats.skills[skill.name] = u.stats.skills[skill.name] || { casts: 0, dmg: 0, sumSq: 0, hits: 0, heal: 0, shape: skill.shape });
      ss.casts++;
      ss.dmg += this.castDmg;
      ss.sumSq += this.castDmg * this.castDmg;
      ss.hits += this.castHits;
      ss.heal += this.castHeal;

      this.cause = null;
      this.snapAt(aid);
      this.checkEnd();
    }

    resolve(u, skill) {
      const Tg = DAO.Targeting;
      const primary = [];
      if (skill.dmgType === 'physical' || skill.dmgType === 'magic') {
        if (skill.shape === 'single') {
          const r = Tg.singleEnemyTarget(this, u, skill);
          if (r.target) { this.hit(u, r.target, skill, 1, r.redirectedBy, r.original); primary.push(r.target); }
        } else if (skill.shape === 'bounce') {
          const n = skill.bounces || DAO.CONFIG.bounce.defaultHits;
          const decay = skill.bounceDecay != null ? skill.bounceDecay : DAO.CONFIG.bounce.defaultDecay;
          let last = null;
          for (let i = 0; i < n && !this.over; i++) {
            const r = Tg.bounceTarget(this, u, last);
            if (!r.target) break;
            this.hit(u, r.target, skill, Math.pow(decay, i), r.redirectedBy, r.original);
            primary.push(r.target);
            last = r.target;
          }
        } else {
          for (const t of Tg.shapeTargets(this, u, skill)) {
            if (this.over) break;
            this.hit(u, t, skill, 1);
            primary.push(t);
          }
        }
      } else if (skill.dmgType === 'heal') {
        for (const t of Tg.healTargets(this, u, skill)) {
          this.healEv(u, t, DAO.Damage.computeHeal(u, skill, 1));
          primary.push(t);
        }
      } else if ((skill.effects || []).some((e) => e.target === 'target')) {
        // 无伤害的指向敌人技能（破甲符等）
        const t = Tg.pickByRule(this, Tg.sideUnits(this, Tg.otherSide(u.side)), skill.targetRule);
        if (t) primary.push(t);
      }
      if (this.over) return;
      for (const e of skill.effects || []) this.applyEffect(u, skill, e, primary);
    }

    healEv(caster, target, amount) {
      const hpBefore = target.hp;
      const amt = this.doHeal(caster, target, amount);
      this.castHeal += amt;
      this.rec({ type: 'heal', actor: caster.uid, target: target.uid, amount: amt, hpBefore, hpAfter: target.hp });
      return amt;
    }

    applyEffect(u, skill, e, primary) {
      const targets = DAO.Targeting.effectTargets(this, u, e, primary);
      if (!targets.length) return;
      switch (e.kind) {
        case 'buff':
        case 'debuff': {
          const v = e.kind === 'debuff' ? -Math.abs(e.value) : e.value;
          for (const t of targets) {
            this.applyBuff(t, { stat: e.stat, value: v, duration: e.duration, source: u.uid, name: skill.name });
            this.rec({ type: e.kind, actor: u.uid, target: t.uid, stat: e.stat, value: v, duration: e.duration, name: skill.name });
          }
          break;
        }
        case 'guard':
        case 'taunt':
          for (const t of targets) {
            t.status[e.kind] = Math.max(t.status[e.kind], e.duration);
            this.rec({ type: e.kind, actor: u.uid, target: t.uid, duration: e.duration });
          }
          break;
        case 'shield': {
          const amt = DAO.Damage.computeShield(u, e.value);
          for (const t of targets) this.giveShieldEv(u, t, amt);
          break;
        }
        case 'push':
        case 'pull':
          for (const t of targets) {
            const barBefore = t.bar;
            t.bar = e.kind === 'push' ? t.bar + e.value : Math.max(0, t.bar - e.value);
            this.rec({ type: e.kind, actor: u.uid, target: t.uid, value: e.value, barBefore, barAfter: t.bar });
          }
          break;
        case 'heal':
          for (const t of targets) this.healEv(u, t, Math.floor(u.base.healPower * e.value));
          break;
      }
    }

    hit(attacker, target, skill, scale, redirectedBy, original) {
      if (!target || !target.alive || this.over) return;
      const r = DAO.Damage.computeDamage(this, attacker, target, skill, scale);
      const hpBefore = target.hp, shieldBefore = target.shield;

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
      this.castHits++;
      if (redirectedBy) target.stats.redirected++;
      let hid = null;
      if (this.record) {
        const ev = { type: 'hit', actor: attacker.uid, target: target.uid, skill: skill.key, skillName: skill.name, dmg, crit: r.crit, absorbed,
          hpBefore, hpAfter: Math.max(0, target.hp), shieldBefore, shieldAfter: killed ? 0 : target.shield, killed, scale };
        if (redirectedBy) { ev.redirectedBy = redirectedBy; if (original) ev.original = original.uid; }
        hid = this.rec(ev);
      }

      if (r.crit) {
        attacker.stats.crits++;
        this.emit(EV.CRIT, { actor: attacker, target, skill, eventId: hid });
      }
      if (!killed) this.emit(EV.HIT, { actor: attacker, target, skill, eventId: hid });
      if (killed) {
        target.alive = false;
        target.hp = 0;
        target.shield = 0;
        attacker.stats.kills++;
        attacker.stats.victims.push({ id: target.charId, level: target.level, exp: target.exp });
        const did = this.rec({ type: 'death', actor: attacker.uid, target: target.uid, parent: hid });
        this.emit(EV.KILL, { actor: attacker, target, skill, eventId: did });
        this.checkEnd();
      }
    }

    // ================= 时间 / 回合 =================
    newRound(r) {
      this.round = r;
      this.bus.newRound(r);
      for (const u of this.units) { u.actionsThisRound = 0; u.extraThisRound = 0; }
      const rid = this.rec({ type: 'roundStart', parent: null });
      this.cause = rid;
      this.emit(EV.ROUND_START, { round: r, eventId: rid });
      this.cause = null;
      this.snapAt(rid);
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
      const sid = this.rec({ type: 'battleStart', parent: null });
      this.cause = sid;
      this.emit(EV.BATTLE_START, { eventId: sid });
      this.cause = null;
      this.snapAt(sid);
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

      const eid = this.rec({ type: 'battleEnd', parent: null, winner: this.winner, timeout: !!this.timeout });
      this.snapAt(eid);
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
          uid: u.uid, charId: u.charId, side: u.side, name: u.name, title: u.title, row: u.row, role: u.role, level: u.level,
          alive: u.alive, hp: u.hp, maxHp: u.base.maxHp, stats: u.stats,
        })),
        timeline: this.record ? this.timeline() : null,
      };
    }

    /** 回放 / 渲染用的时间线：单位的静态信息 + 事件 + 快照。只读，渲染器不应修改它。 */
    timeline() {
      return {
        version: 1,
        seed: this.seed,
        winner: this.winner,
        timeout: !!this.timeout,
        rounds: Math.min(this.round, DAO.CONFIG.actionBar.maxRounds),
        units: this.units.map((u) => ({
          uid: u.uid, charId: u.charId, side: u.side, row: u.row, index: u.index, name: u.name, title: u.title, role: u.role, level: u.level,
          art: u.art || null, maxHp: u.base.maxHp,
          skills: u.skills.map((s) => ({ key: s.key, id: s.id, name: s.name, shape: s.shape, cd: s.cd || 0, art: s.art || null })),
        })),
        events: this.events,
        snapshots: this.snapshots,
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
