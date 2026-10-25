/**
 * 配置网站 · 按对象编辑：把 DAO.CONFIG 里属于同一个东西的字段（一只怪、一关、一张卡、一条天赋……）聚成一张卡片，
 * 卡片头是图 + 名字，下面按含义分组放字段，另外实时算出「这个等级时的气血 / 攻击」和「用在哪里」。
 *
 * 只是另一种展示：改的还是同一批配置路径（和「按字段」视图同一份草稿），校验、保存、写 tuning.js 都在 config.js。
 * 能改的只有已经存在的字段的值；增删怪物、给怪加天赋、关卡加怪会改数组长度，要改 src/config/*.js。
 *
 *   DAO.ConfigEntities.autoLabel(path, cfg)   路径 → 中文名（按字段视图也用）
 *   DAO.ConfigEntities.optionsFor(path, cfg)  这个字段能选哪些值（枚举 / 引用别的配置），没有返回 null
 *   DAO.ConfigEntities.hintFor(path)          字段旁边的换算提示（+80%、1 分 30 秒……），没有返回 null
 *   DAO.ConfigEntities.createView(Page, els)  按对象视图 { render, refresh, goto }
 * 不被游戏加载。
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;
  const T = DAO.Tuning;

  const sub = (base, ...ks) => T.join((base ? T.parse(base) : []).concat(ks.map(String)));
  const segs = (p) => T.parse(p);
  const isIdx = (x) => /^\d+$/.test(String(x));
  const num = (x) => Math.round(x).toLocaleString('zh-CN');
  const pct = (x) => +(x * 100).toFixed(1) + '%';
  const fmtVal = (v) => (typeof v !== 'number' ? String(v) : v !== 0 && Math.abs(v) < 1 ? pct(v) : Number.isInteger(v) ? String(v) : v.toFixed(2));
  const imgPath = (artId) => sub('assets.images', artId);
  /** el.append 的安全版：数组摊平，跳过 null / false */
  const put = (el, ...cs) => { for (const c of cs.flat(Infinity)) if (c != null && c !== false) el.append(c); return el; };

  // ================= 名字 =================
  const KEY = {
    name: '名字', title: '称号', desc: '描述', note: '说明', role: '定位', row: '站位', boss: '首领', gate: '卡关点',
    str: '力', agi: '敏', int: '智', base: '基础三维', growth: '每级成长', stats: '三维', hpMul: '气血倍率', dmgUp: '增伤',
    exp: '经验', gold: '金币', ore: '灵矿', basic: '普攻', innate: '固有技能', branch: '分支', talents: '天赋', roll: '档位', id: 'id',
    level: '等级', enemyId: '敌人', enemies: '敌人', stages: '关卡', chapters: '章节', art: '资源 id',
    shape: '形状', range: '射程', dmgType: '伤害类型', mult: '倍率', cd: '冷却', tags: '标签', pierce: '穿透', targetRule: '选目标',
    bounces: '弹射次数', bounceDecay: '每跳衰减', effects: '附带效果', kind: '效果', target: '对象', stat: '属性', value: '数值', duration: '持续（次行动）',
    variants: '分支', slot: '卡槽', quality: '品质', roles: '可用定位', key: '掷哪个值', min: '最小', max: '最大',
    skill: '技能', passive: '被动', trigger: '触发特效', tagDmgUp: '标签增伤', event: '触发时机', chance: '概率', maxPerRound: '每回合上限',
    effect: '效果', requireTags: '需要标签', tier: '档位类型', rare: '稀有', exclusive: '专属', activeCard: '主动卡', passiveCard: '被动卡',
    atk: '攻击', armor: '护甲', resist: '法抗', hp: '气血', charId: '角色',
    weapon: '武器', chest: '胸甲', ring: '戒指', white: '凡品', blue: '良品', yellow: '上品', orange: '极品', A: 'A 队', B: 'B 队',
    // coef.js
    teamSize: '上阵人数', maxPerRow: '每排上限', ticksPerRound: '每回合刻度', maxRounds: '回合上限',
    maxActionsPerUnitPerRound: '每单位每回合行动上限', maxExtraActionsPerRound: '每回合再动上限',
    pAtkPerStr: '每点力 → 物攻', armorPerStr: '每点力 → 护甲', mAtkPerInt: '每点智 → 法攻', resistPerInt: '每点智 → 法抗',
    healPowerPerInt: '每点智 → 治疗', speedBase: '基础速度', speedPerAgi: '每点敏 → 速度', critRateBase: '基础暴击率',
    critRatePerAgi: '每点敏 → 暴击率', critDmgBase: '基础暴伤', critDmgPerAgi: '每点敏 → 暴伤', dodgeRatePerAgi: '每点敏 → 闪避',
    dodgeRateCap: '闪避上限', hpBase: '气血基数', hpPerLevel: '每级气血',
    defenseK: '防御常数 k', defenseKPerLayer: '每层 +k', minDefense: '破甲下限', critRateCap: '暴击率上限', floorDamage: '伤害向下取整', minDamage: '最低伤害',
    defaultHits: '默认弹射次数', defaultDecay: '默认每跳衰减', allowRepeatConsecutive: '可连续打同一目标',
    defaultMaxPerRound: '默认每回合上限', allowRecursion: '允许递归触发', overhealCounts: '溢出治疗计入统计',
    priority: '技能优先级', healBelowHpRatio: '治疗 / 护盾阈值（血量比例）', startReady: '开场技能就绪', coversBounce: '守护也挡弹射',
    defaultRuns: '默认场数', seedBase: '起始种子',
    battleStart: '开场', roundStart: '回合开始', action: '出手', battleEnd: '结束', timeScale: '时间倍率',
    images: '图片', root: '图片根目录',
    // game.js
    saveVersion: '存档版本', startLevel: '起始等级', maxLevel: '等级上限', cap: '名额（总人数上限）', defaultRow: '默认站位',
    firstCardStage: '第一张卡在哪关掉', firstCard: '第一张卡', pool: '卡池', drops: '掉落', perKill: '每击杀一只', bossKills: '首领掉随机卡',
    recruitCard: '招募自带卡', power: '升级经验指数', killMul: '击杀倍率', lossKeepsKills: '战败保留已击杀的奖励', split: '上阵角色平分经验',
    start: '起始', unlockStage: '开放关卡', firstFree: '首抽免费', firstComplement: '首抽保底互补定位', cost: '价格', candidates: '候选人数',
    levelOffset: '等级差（相对最高等级）', roleWeights: '定位权重', qualities: '品质', weight: '权重', growthMul: '成长倍率',
    tierWeights: '天赋档位权重', excludeTalents: '不出的天赋', innatePool: '固有技能池', firstExcludeInnates: '首抽不出的固有技能', names: '名字池',
    slots: '上阵位', stageCap: '本阶段最多研究到', chapterCaps: '打到这一章时上限放宽到', stuckChapters: '这些章节卡关先引导研究',
    levels: '各级花费', sec: '时长（秒）', intSpeedPerPoint: '每点智力提速', research: '研究', perLevel: '每级 +', maxExtra: '最多扩建',
    defaultOn: '默认打开', stopBeforeBoss: '首领关前停下', stopAtGuides: '引导处停下', perSec: '每秒产出（系数 1.0）', mats: '原料', mat: '原料', building: '建筑', kind: '类型', unlockChapter: '开放章节', costMult: '每级花费倍率', list: '列表', sell: '出售比例', salvage: '分解比例', surplusMin: '推荐分解的最少件数', tidyAt: '整理引导的件数', autoSalvage: '自动分解',
    refGrowth: '资质系数的成长参考', minFactor: '资质系数下限', slotNames: '部位名', tierNames: '档位名', recipes: '配方', tiers: '档位',
    costs: '花费', guideSlot: '引导打的部位', guideTier: '引导打的档位', stuckGuideChapters: '这些章节卡关引导补装备',
    cardPrompts: '拿到卡时停下提示', forgeHints: '打造 / 新装备提示',
    boots: '靴子', gloves: '护手', amulet: '项链',
    production: '生产', lines: '生产线', building: '建筑名', baseSec: '基础时长（秒）', craft: '打造', statCoef: '每点打造值提速',
    enabled: '开放', qualityTables: '品质概率（%）', speed: '速度', gapMs: '两场间隔（毫秒）', watchSpeed: '观看倍速',
    overheadMs: '每场操作（毫秒）', guideMs: '每个引导（毫秒）', forgeMs: '每件装备操作（毫秒）', v1StartGold: '阶段 0 存档补金币',
    same: '同名卡（重掷用）', other: '随机卡',
  };
  const PATH_LABELS = [
    [/qualities\.[^.]+\.talents$/, '天赋条数'], [/qualities\.[^.]+\.trigger$/, '可出触发型'],
    [/^game\.idle\.speed$/, '挂机计时倍率'], [/^game\.gold\.start$/, '初始金币'], [/^game\.exp\.base$/, '升级经验基数'],
    [/research\.slots\.start$/, '起始上阵位'], [/research\.slots\.max$/, '上阵位上限'], [/research\.slots\.name$/, '研究名'],
    [/^game\.quota\.research$/, '开放扩建研究'], [/^actionBar\.max$/, '行动条满值'], [/^game\.recruit\.roles$/, '可招定位'],
    [/recipes\.[^.]+\.cost$/, '每件花费'], [/recipes\.[^.]+\.base$/, '白品质数值'], [/production\.lines\.[^.]+\.stat$/, '打造值用'],
    [/production\.lines\.[^.]+\.slots$/, '部位'], [/production\.qualities\.\d+\.mult$/, '数值倍率'], [/^game\.cards\.drops\.chapters$/, '掉卡章节'],
    [/(activeCard|passiveCard)\.id$/, '卡'], [/talents\.\d+\.id$/, '天赋'],
    [/tierWeights\.stat$/, '属性型'], [/tierWeights\.tag$/, '标签型'], [/tierWeights\.trigger$/, '触发型'],
  ];

  const ENUM = {
    row: { front: '前排', back: '后排' },
    range: { melee: '近战', ranged: '远程' },
    dmgType: { physical: '物理', magic: '法术', heal: '治疗', none: '无伤害' },
    targetRule: { default: '随机', lowestHp: '血最少', backRow: '优先后排', highestAtk: '攻击最高' },
    tier: { stat: '属性型', tag: '标签型', trigger: '触发型' },
    quality: { white: '白', blue: '蓝', yellow: '黄', orange: '橙' },
    cardSlot: { active: '主动', passive: '被动' },
    event: { battleStart: '开场', roundStart: '回合开始', act: '出手时', crit: '暴击时', kill: '击杀时', hit: '受击时' },
    effectKind: { buff: '增益', debuff: '减益', heal: '治疗', shield: '护盾', push: '推条', pull: '拉条', guard: '守护', taunt: '嘲讽' },
    triggerKind: { cdReduce: '技能 CD 减少', extraAction: '再动', healSelf: '自身回血', shieldSelf: '自身护盾', buffSelf: '自身增益', buffRow: '同排增益', pushSelf: '自身推条' },
    target: { self: '自己', target: '目标', allies: '己方全体', otherAllies: '其他队友', row: '同排', enemies: '敌方全体', hitTargets: '被命中的目标' },
    stat: { strPct: '力 %', agiPct: '敏 %', intPct: '智 %', hpPct: '气血 %', armorPct: '护甲 %', resistPct: '法抗 %', critRate: '暴击率', critDmg: '暴伤',
      finalDmg: '终伤', speed: '速度', dmgUp: '增伤', healUp: '治疗加成', armor: '护甲', resist: '法抗', str: '力', agi: '敏', int: '智' },
    rollKey: { mult: '技能倍率', value: '效果数值' },
    attr: { str: '力', agi: '敏', int: '智' },
    aiSlot: { activeCard: '主动卡', innate: '固有技能', basic: '普攻' },
  };
  const enumOpts = (map) => Object.keys(map).map((v) => ({ value: v, label: map[v] }));
  const refOpts = (obj, filter) => Object.keys(obj || {}).filter((k) => !filter || filter(obj[k], k))
    .map((k) => ({ value: k, label: (obj[k] && obj[k].name ? obj[k].name + ' · ' : '') + k }));

  function nameOfId(id, cfg) {
    const G = (cfg && cfg.game) || {};
    for (const src of [G.enemies, cfg && cfg.characters, cfg && cfg.cards, cfg && cfg.talents, cfg && cfg.innateSkills]) if (src && src[id] && src[id].name) return src[id].name;
    const ch = (G.chapters || []).find((c) => c.id === id);
    return ch ? ch.name : null;
  }

  /** 单个字段名（短）：卡片里用 */
  function labelKey(k, path, cfg) {
    if (path) for (const [re, name] of PATH_LABELS) if (re.test(path)) return name;
    if (KEY[k]) return KEY[k];
    if (DAO.ROLE_NAMES && DAO.ROLE_NAMES[k]) return DAO.ROLE_NAMES[k];
    if (cfg) { const n = nameOfId(k, cfg); if (n) return n; }
    return isIdx(k) ? String(+k + 1) : k;
  }

  /** 完整中文名：「敌人 · 灰狼 · 每级成长 · 力」（按字段视图的标签列用） */
  function autoLabel(path, cfg) {
    const s = segs(path);
    const GN = (DAO.ConfigRules && DAO.ConfigRules.GROUP_NAMES) || {};
    const out = [];
    let node = cfg, parent = null;
    for (let i = 0; i < s.length; i++) {
      const seg = s[i];
      parent = node;
      node = node == null ? undefined : node[seg];
      const here = T.join(s.slice(0, i + 1));
      if (i === 0) { if (seg !== 'game') out.push(GN[seg] || labelKey(seg, here, cfg)); continue; }
      if (i === 1 && s[0] === 'game') { out.push(GN['game.' + seg] || labelKey(seg, here, cfg)); continue; }
      const isObj = node && typeof node === 'object' && !Array.isArray(node);
      if (isObj && Array.isArray(parent)) { out.push(node.id && node.name ? `${node.id} ${node.name}` : node.name || node.id || `第 ${+seg + 1} 个`); continue; }
      if (isObj && typeof node.name === 'string' && !KEY[seg]) { out.push(node.name); continue; }
      out.push(labelKey(seg, here, cfg));
    }
    return out.filter(Boolean).join(' · ');
  }

  /** 字段能选的值：枚举或引用别的配置（返回 [{ value, label }]），自由填写返回 null */
  function optionsFor(p, cfg) {
    const s = segs(p), n = s.length;
    const k = s[n - 1], par = s[n - 2], gp = s[n - 3];
    const arr = isIdx(k);
    const key = arr ? par : k;          // 数组元素按数组名判断
    const ctx = arr ? gp : par;
    const G = cfg.game || {};
    const v = T.get(cfg, p);
    if (typeof v === 'number') {
      if (k === 'branch') {
        const owner = T.get(cfg, T.join(s.slice(0, -1)));
        const inn = owner && cfg.innateSkills && cfg.innateSkills[owner.innate];
        if (inn) return inn.variants.map((x, i) => ({ value: i, label: `${'AB'[i] || i + 1} · ${x.name}` }));
      }
      return null;
    }
    if (typeof v !== 'string') return null;
    if (key === 'row' || par === 'defaultRow') return enumOpts(ENUM.row);
    if (k === 'shape') return enumOpts(DAO.SHAPE_NAMES || {});
    if (k === 'range') return enumOpts(ENUM.range);
    if (k === 'dmgType') return enumOpts(ENUM.dmgType);
    if (k === 'targetRule') return enumOpts(ENUM.targetRule);
    if (k === 'tier' && s[0] === 'talents') return enumOpts(ENUM.tier);
    if (k === 'quality') return enumOpts(ENUM.quality);
    if (k === 'slot' && s[0] === 'cards') return enumOpts(ENUM.cardSlot);
    if (k === 'event') return enumOpts(ENUM.event);
    if (k === 'kind') return enumOpts(s.includes('effect') ? ENUM.triggerKind : ENUM.effectKind);
    if (k === 'target') return enumOpts(ENUM.target);
    if (k === 'stat' && s.includes('production')) return enumOpts(ENUM.attr);
    if (k === 'stat') return enumOpts(ENUM.stat);
    if (k === 'key' && par === 'roll') return enumOpts(ENUM.rollKey);
    if (k === 'role' || key === 'roles') return refOpts(cfg.roles);
    if (key === 'tags' || key === 'requireTags') return (DAO.TAG_LIST || []).map((t) => ({ value: t, label: t }));
    if (k === 'innate' || ctx === 'innatePool' || key === 'firstExcludeInnates') return refOpts(cfg.innateSkills);
    if (k === 'basic') return refOpts(cfg.basicSkills);
    if (k === 'enemyId') return refOpts(G.enemies);
    if (k === 'charId') return refOpts(cfg.characters);
    if (k === 'id' && (par === 'activeCard' || par === 'passiveCard')) return refOpts(cfg.cards, (c) => c.slot === (par === 'activeCard' ? 'active' : 'passive'));
    if (k === 'id' && isIdx(par) && gp === 'talents') return refOpts(cfg.talents);
    if (key === 'excludeTalents') return refOpts(cfg.talents);
    if (par === 'firstCard' || ctx === 'pool') return refOpts(cfg.cards);
    if (/Stage$/.test(k)) return (G.chapters || []).flatMap((c) => c.stages.map((st) => ({ value: st.id, label: `${st.id} ${st.name}` })));
    if (arr && s[0] === 'game' && /^(chapters|stuckChapters|stuckGuideChapters)$/.test(par)) return (G.chapters || []).map((c) => ({ value: c.id, label: `${c.name} · ${c.id}` }));
    if ((key === 'slots' && s.includes('production')) || k === 'guideSlot') return enumOpts((G.production && G.production.slotNames) || {});
    if (key === 'priority') return enumOpts(ENUM.aiSlot);
    return null;
  }

  /** 天赋 / 卡档位 → 实际数值的提示 */
  function rollHint(p, v, cfg) {
    const s = segs(p);
    const owner = T.get(cfg, T.join(s.slice(0, -1)));
    if (!owner || typeof v !== 'number') return '';
    const def = /talents$/.test(s[s.length - 3] || '') ? cfg.talents[owner.id] : cfg.cards[owner.id] && cfg.cards[owner.id].roll;
    if (!def) return '';
    const val = def.min + (def.max - def.min) * Math.max(0, Math.min(1, v));
    return '= ' + (def.key === 'mult' ? '×' + val.toFixed(2) : fmtVal(val));
  }
  function hintFor(p) {
    const s = segs(p), k = s[s.length - 1];
    if (/^(dmgUp|finalDmg|healUp)$/.test(k)) return (v) => (typeof v === 'number' && v ? (v > 0 ? '+' : '') + pct(v) : '');
    if (/^(critRate|critRateBase|critRateCap|chance|healBelowHpRatio|dodgeRateCap|same|other)$/.test(k) || /Pct$/.test(k)) return (v) => (typeof v === 'number' ? pct(v) : '');
    if (k === 'statCoef') return (v) => (typeof v === 'number' ? `打造值 50 → 时长 ×${(1 / (1 + 50 * v)).toFixed(2)}` : '');
    if (k === 'sec' || k === 'baseSec') return (v) => (v >= 60 ? `${Math.floor(v / 60)} 分${v % 60 ? ' ' + (v % 60) + ' 秒' : ''}` : '');
    if (/Ms$/.test(k) && s[0] === 'game') return (v) => (v >= 1000 ? +(v / 1000).toFixed(2) + ' 秒' : '');
    if (k === 'roll' && (s[s.length - 3] === 'talents' || /^(activeCard|passiveCard)$/.test(s[s.length - 2]))) return (v, cfg) => rollHint(p, v, cfg);
    return null;
  }

  // ================= 预览计算 =================
  /** 用「默认值 + 当前草稿」的配置跑一段逻辑（Model 读全局 DAO.CONFIG） */
  function withWork(Page, fn) {
    const keep = DAO.CONFIG;
    DAO.CONFIG = Page.work();
    try { return fn(); } finally { DAO.CONFIG = keep; }
  }
  function buildPreview(Page, tpl, id, level) {
    return withWork(Page, () => {
      const ch = JSON.parse(JSON.stringify(tpl));
      if (level != null) ch.level = level;
      ch.id = id;
      return DAO.Model.buildUnit(ch, 'B', ch.row || 'front', 0, id);
    });
  }
  /** 一次出手的伤害估算：不计防御、不暴击、不算 buff */
  function skillEstimate(u, s) {
    if (s.dmgType !== 'physical' && s.dmgType !== 'magic') return null;
    const atk = s.dmgType === 'physical' ? u.base.pAtk : u.base.mAtk;
    let up = u.mods.dmgUp;
    for (const t of u.mods.tagDmg) if (DAO.tagsMatch(s.tags, t.tags)) up += t.value;
    return atk * (s.mult || 0) * (1 + up) * (1 + u.mods.finalDmg);
  }

  // ================= 视图 =================
  function createView(Page, els) {
    const h = DAO.UI.h, UI = DAO.UI;
    const D = Page.DEFAULTS;
    const W = () => Page.work();
    const pathCache = new Map();
    let cards = [];
    let cat = null;

    /** base 下面的所有叶子路径（结构不会变，缓存） */
    function prefixPaths(base) {
      if (pathCache.has(base)) return pathCache.get(base);
      const out = Page.ITEMS.filter((it) => it.path === base || it.path.startsWith(base + '.') || it.path.startsWith(base + '[')).map((it) => it.path);
      pathCache.set(base, out);
      return out;
    }
    function specPaths(spec) {
      if (spec._paths) return spec._paths;
      let ps = [];
      if (spec.pathList) ps = spec.pathList.slice();
      else if (spec.keys) for (const k of spec.keys) ps.push(...prefixPaths(sub(spec.base, k)));
      else ps = prefixPaths(spec.base).slice();
      const art = spec.artId && spec.artId();
      if (art && art !== true) ps.push(...prefixPaths(imgPath(art)));
      spec._paths = ps;
      return ps;
    }
    const changedCount = (spec) => specPaths(spec).filter((p) => Page.changed(p) || Page.error(p)).length;

    // ---------- 字段 ----------
    function leafField(p, k, extra) {
      const v = T.get(D, p);
      return Page.field(p, Object.assign({
        label: labelKey(k, p, W()),
        options: optionsFor(p, W()),
        hint: hintFor(p),
        wide: /^(desc|note)$/.test(k) || (typeof v === 'string' && v.length > 14),
      }, extra || {}));
    }
    function arrayField(p, k, arr, bare) {
      const box = h('div', { class: 'ef-arr' });
      const sep = arr.length === 2 && typeof arr[0] === 'number' ? '–' : null;
      arr.forEach((x, i) => {
        if (i && sep) box.appendChild(h('span', { class: 'ef-sep' }, sep));
        box.appendChild(Page.field(sub(p, i), { bare: true, options: optionsFor(sub(p, i), W()), hint: hintFor(sub(p, i)) }));
      });
      if (bare) return box;
      const wide = arr.length > 3;
      return h('div', { class: 'ef ef-group' + (wide ? ' wide' : '') }, h('span', { class: 'ef-l' }, labelKey(k, p, W())), box);
    }
    const emptyField = (k, p) => h('div', { class: 'ef' }, h('span', { class: 'ef-l' }, labelKey(k, p, W())),
      h('span', { class: 'muted ef-none', title: '数组长度不能在配置网站里改；要增删请改 src/config/*.js' }, '无'));
    const isRefId = (p) => /(\.talents\.\d+|activeCard|passiveCard)\.id$/.test(p);

    /** 表格：数组或对象，每一项都是只含数值（或数值数组）的对象，比如研究各级、品质、档位、附带效果 */
    function tableFor(p, v, rowLabel) {
      const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x]) : Object.entries(v);
      if (!entries.length) return null;
      if (!Array.isArray(v) && entries.length < 2) return null;
      const okRow = (x) => x && typeof x === 'object' && !Array.isArray(x) &&
        Object.values(x).every((y) => T.isLeaf(y) || (Array.isArray(y) && y.every(T.isLeaf)));
      if (!entries.every(([, x]) => okRow(x))) return null;
      const cols = [];
      for (const [, x] of entries) for (const c of Object.keys(x)) if (!cols.includes(c) && c !== 'art' && !(c === 'id' && !isRefId(sub(p, entries[0][0], c)))) cols.push(c);
      if (!cols.length) return null;
      const t = h('table', { class: 'etable' });
      t.appendChild(h('tr', null, h('th', null, ''), cols.map((c) => h('th', null, labelKey(c, sub(p, entries[0][0], c), W())))));
      for (const [rk, x] of entries) {
        const rl = rowLabel ? rowLabel(rk) : Array.isArray(v) ? String(+rk + 1) : labelKey(rk, sub(p, rk), W());
        t.appendChild(h('tr', null, h('th', { class: 'erow' }, rl), cols.map((c) => {
          const cp = sub(p, rk, c);
          if (!(c in x)) return h('td', { class: 'muted' }, '—');
          if (Array.isArray(x[c])) return h('td', null, x[c].length ? arrayField(cp, c, x[c], true) : h('span', { class: 'muted' }, '无'));
          return h('td', null, Page.field(cp, { bare: true, options: optionsFor(cp, W()), hint: hintFor(cp) }));
        })));
      }
      return h('div', { class: 'etable-wrap' }, t);
    }
    function rowLabelFor(p) {
      if (/research\.slots\.levels$/.test(p)) return (k) => `第 ${k} 位`;
      if (/production\.lines$/.test(p)) return (k) => k;
      if (/production\.qualities$/.test(p)) return (i) => T.get(D, sub(p, i, 'id')) || String(+i + 1);
      return null;
    }

    /** 通用：对象 → 字段格子 + 子分组 / 表格 */
    function block(base, obj, keys, gridCls) {
      const frag = document.createDocumentFragment();
      const grid = h('div', { class: 'efields' + (gridCls ? ' ' + gridCls : '') });
      const later = [];
      for (const k of keys) {
        const v = obj[k];
        const p = sub(base, k);
        if (v === undefined || k === 'art' || (k === 'id' && !isRefId(p))) continue;
        if (T.isLeaf(v)) grid.appendChild(leafField(p, k));
        else if (Array.isArray(v) && v.every(T.isLeaf)) grid.appendChild(v.length ? arrayField(p, k, v) : emptyField(k, p));
        else if (v && typeof v === 'object') later.push(k);
      }
      if (grid.childNodes.length) frag.appendChild(grid);
      for (const k of later) {
        const p = sub(base, k);
        const inner = tableFor(p, obj[k], rowLabelFor(p)) || block(p, obj[k], Object.keys(obj[k]));
        if (!inner.childNodes.length) continue;
        frag.appendChild(h('div', { class: 'esub' }, h('h5', null, labelKey(k, p, W())), inner));
      }
      return frag;
    }
    /** 只有一个非数值键时，直接放它的表格 / 内容，不再套一层小标题 */
    function sectionBody(base, obj, sec) {
      if (sec.render) return sec.render(base, obj);
      if (sec.at) { const o = T.get(D, sub(base, sec.at)); return o == null ? null : block(sub(base, sec.at), o, Object.keys(o), sec.layout); }
      const keys = sec.keys.filter((k) => obj[k] !== undefined);
      if (!keys.length) return null;
      if (keys.length === 1 && Array.isArray(obj[keys[0]]) && !obj[keys[0]].length)
        return h('div', { class: 'muted ef-none', title: '数组长度不能在配置网站里改；要增删请改 src/config/*.js' }, '无');
      if (keys.length === 1 && Array.isArray(obj[keys[0]]) && obj[keys[0]].every(T.isLeaf)) return arrayField(sub(base, keys[0]), keys[0], obj[keys[0]], true);
      if (keys.length === 1 && obj[keys[0]] && typeof obj[keys[0]] === 'object' && !(Array.isArray(obj[keys[0]]) && obj[keys[0]].every(T.isLeaf))) {
        const p = sub(base, keys[0]), v = obj[keys[0]];
        return tableFor(p, v, rowLabelFor(p)) || block(p, v, Object.keys(v), sec.layout);
      }
      return block(base, obj, keys, sec.layout);
    }

    // ---------- 图片 ----------
    function artSrc(artId) {
      const A = W().assets;
      const e = artId ? A.images[artId] : null;
      const p = typeof e === 'string' ? e : (e && (e.portrait || e.default || e.icon)) || null;
      return p ? { url: '../' + A.root + p, rel: A.root + p } : null;
    }
    function thumbBox(kind, small) {
      const box = h('span', { class: 'ethumb-box' + (small ? ' s' : '') });
      let last;
      box.update = (artId, glyph) => {
        const src = artSrc(artId);
        const sig = (src ? src.url : '') + '|' + glyph;
        if (sig === last) return;
        last = sig;
        const fb = (broken) => h('span', { class: `ethumb k-${kind}${broken ? ' broken' : ''}`, title: broken ? '找不到图片：' + src.rel : artId ? `还没出图（资源 ${artId}）` : '' }, glyph);
        UI.clear(box);
        if (!src) { box.appendChild(fb(false)); return; }
        const img = h('img', { class: 'ethumb', src: src.url, alt: '', title: src.rel });
        img.addEventListener('error', () => img.replaceWith(fb(true)));
        box.appendChild(img);
      };
      return box;
    }
    function imageFields(artId) {
      const p = imgPath(artId);
      const v = T.get(D, p);
      if (v === undefined) return h('div', { class: 'ef wide' }, h('span', { class: 'ef-l' }, '图片'), h('span', { class: 'muted' }, `资源清单里没有 ${artId}`));
      const opts = { label: '图片', wide: true, list: 'dl-assets', placeholder: '还没出图（占位）', cls: 'ef-img' };
      const fields = T.isLeaf(v) ? [Page.field(p, opts)] : Object.keys(v).map((use) => Page.field(sub(p, use), Object.assign({}, opts, { label: '图片 · ' + use })));
      return h('div', { class: 'efields' }, fields, h('div', { class: 'ef-note wide' }, `路径相对 ${W().assets.root}，图片放进仓库的 ${W().assets.root} 文件夹 · 资源 id ${artId}`));
    }

    // ---------- 卡片 ----------
    const badge = (text, cls) => h('span', { class: 'badge ' + (cls || '') }, text);
    function buildCard(spec) {
      const obj = spec.base != null ? T.get(D, spec.base) : null;
      const el = h('article', { class: 'ecard' + (spec.wide ? ' wide' : '') + (spec.cls ? ' ' + spec.cls : ''), id: 'e-' + spec.key.replace(/[^\w-]/g, '_') });
      const thumb = spec.kind ? thumbBox(spec.kind) : null;
      const titleB = h('b'), subS = h('small'), badges = h('span', { class: 'ebadges' });
      const head = h('header', { class: 'ehead' }, thumb, h('div', { class: 'etitle' }, titleB, subS), badges);
      el.appendChild(head);
      const refreshers = [];
      for (const top of spec.top || []) {
        const r = top();
        if (!r) continue;
        el.appendChild(r.el);
        if (r.refresh) refreshers.push(r.refresh);
      }
      const covered = new Set(['id', 'art']);
      for (const sec of spec.sections || []) {
        (sec.keys || []).forEach((k) => covered.add(k));
        if (sec.at) covered.add(sec.at);
        (sec.covers || []).forEach((k) => covered.add(k));
        let body = obj ? sectionBody(spec.base, obj, sec) : sec.render ? sec.render(spec.base, obj) : null;
        if (body && body.el) { if (body.refresh) refreshers.push(body.refresh); body = body.el; }
        const extra = sec.image && spec.artId && spec.artId() ? imageFields(spec.artId()) : null;
        if ((!body || !body.childNodes.length) && !extra) continue;
        el.appendChild(h('section', { class: 'esec' }, sec.title ? h('h4', null, sec.title, sec.note ? h('small', null, sec.note) : null) : null, body, extra));
      }
      // 没归到任何分组的字段放「其他」，保证配置里新加的字段也能改到
      if (obj && typeof obj === 'object' && !spec.keys && !spec.pathList) {
        const rest = Object.keys(obj).filter((k) => !covered.has(k));
        if (rest.length) {
          const body = block(spec.base, obj, rest);
          if (body.childNodes.length) el.appendChild(h('section', { class: 'esec' }, h('h4', null, '其他'), body));
        }
      }
      const refresh = () => {
        titleB.textContent = spec.title();
        UI.clear(subS); put(subS, spec.sub ? spec.sub() : []);
        if (thumb) thumb.update(spec.artId ? spec.artId() : null, spec.glyph ? spec.glyph() : (spec.title() || '?').slice(0, 1));
        const n = changedCount(spec);
        UI.clear(badges);
        put(badges, spec.badges ? spec.badges() : [], n ? badge(`改 ${n}`, 'go') : null);
        el.classList.toggle('mod', !!n);
        for (const f of refreshers) f();
      };
      if (thumb) thumb.addEventListener('click', () => { const inp = el.querySelector('.ef-img input'); if (inp) { inp.focus(); inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); } });
      refresh();
      return { el, refresh, spec };
    }

    // ---------- 用在哪里 ----------
    function stageUses(enemyId) {
      const out = [];
      W().game.chapters.forEach((c) => c.stages.forEach((s) => s.enemies.forEach((e) => {
        if (e.enemyId === enemyId) out.push({ stage: s.id, level: e.level, row: e.row });
      })));
      return out;
    }
    function whoUses(test) {
      const C = W(), G = C.game, out = [];
      for (const [id, x] of Object.entries(G.enemies)) if (test(x, 'enemy')) out.push({ cat: 'enemies', key: 'enemy:' + id, text: x.name });
      for (const [id, x] of Object.entries(G.starters)) if (test(x, 'starter')) out.push({ cat: 'starters', key: 'starter:' + id, text: '开局' + (x.title || id) });
      for (const [id, x] of Object.entries(C.characters)) if (test(x, 'char')) out.push({ cat: 'v0', key: 'char:' + id, text: x.name });
      return out;
    }
    function usesTop(label, list) {
      return () => {
        const box = h('div', { class: 'euse' });
        const refresh = () => {
          const items = list();
          UI.clear(box);
          put(box, h('span', { class: 'muted' }, label + '：'), items.length ? items.map((u) =>
            u.cat ? h('button', { class: 'mini', type: 'button', title: '跳过去', onclick: () => goto(u.cat, u.key) }, u.text) : h('span', { class: 'euse-t' }, u.text)) : h('span', { class: 'muted' }, '没有'));
        };
        return { el: box, refresh };
      };
    }

    // ---------- 单位预览（某等级的气血 / 攻击…） ----------
    function previewTop(getTpl, id, opts) {
      return () => {
        const lv = h('input', { type: 'number', min: 1, max: 200, step: 1, value: opts.level ? opts.level() : 1, disabled: !!opts.fixed });
        const quick = h('span', { class: 'equick' });
        const stats = h('div', { class: 'estats' });
        const skills = h('div', { class: 'eskills' });
        const el = h('div', { class: 'epreview' }, h('div', { class: 'eprev-head' }, h('span', null, '预览 Lv'), lv, quick, opts.note ? h('small', null, opts.note) : null), stats, skills);
        const refresh = () => {
          const L = opts.fixed ? null : Math.max(1, Math.round(Number(lv.value) || 1));
          if (opts.fixed) lv.value = W().level;
          let u;
          try { u = buildPreview(Page, getTpl(), id, L); } catch (e) { stats.textContent = '算不出来：' + e.message; UI.clear(skills); return; }
          const b = u.base;
          const mainMagic = (u.skills.find((s) => s.key === 'basic') || {}).dmgType === 'magic';
          const st = (k, v, main) => h('span', { class: main ? 'main' : '' }, h('i', null, k), h('b', null, v));
          UI.clear(stats);
          put(stats, st('气血', num(b.maxHp), true), st('物攻', num(b.pAtk), !mainMagic), st('法攻', num(b.mAtk), mainMagic),
            st('护甲', num(b.armor)), st('法抗', num(b.resist)), st('速度', num(b.speed)), st('暴击', pct(b.critRate)), st('暴伤', '×' + b.critDmg.toFixed(2)),
            u.mods.dmgUp ? st('增伤', '+' + pct(u.mods.dmgUp)) : null, u.mods.finalDmg ? st('终伤', '+' + pct(u.mods.finalDmg)) : null);
          UI.clear(skills);
          put(skills, u.skills.map((s) => {
            const est = skillEstimate(u, s);
            const bits = [(DAO.SHAPE_NAMES || {})[s.shape] || s.shape];
            if (s.mult) bits.push('×' + s.mult.toFixed(2));
            if (s.bounces) bits.push(s.bounces + ' 跳');
            if (s.cd) bits.push('CD ' + s.cd);
            return h('span', { class: 'esk' }, h('b', null, s.name || s.baseName), ' ', bits.join(' '), est != null ? h('em', { title: '一次命中的伤害：不计防御、不暴击、不算 buff' }, ' ≈ ' + num(est)) : (s.effects || []).length ? h('em', null, ' 效果') : null);
          }));
          UI.clear(quick);
          for (const q of opts.quick ? opts.quick() : []) quick.appendChild(h('button', { class: 'mini', type: 'button', onclick: () => { lv.value = q.level; refresh(); } }, q.label));
        };
        lv.addEventListener('input', refresh);
        return { el, refresh };
      };
    }

    // ---------- 各类对象 ----------
    const roleName = (r) => (DAO.ROLE_NAMES || {})[r] || r;

    function enemySpec(id) {
      const base = sub('game.enemies', id);
      const d = () => W().game.enemies[id];
      const uses = () => stageUses(id);
      const lvs = () => uses().map((u) => u.level);
      return {
        key: 'enemy:' + id, base, kind: 'enemy', artId: () => T.get(D, base).art,
        title: () => d().name, sub: () => [id, roleName(d().role), d().title].filter(Boolean).join(' · '),
        badges: () => (d().boss ? [badge('首领', 'boss')] : []),
        search: () => [id, d().name, d().title, roleName(d().role)].join(' '),
        top: [
          usesTop('出现在', () => {
            const byStage = new Map();
            for (const u of uses()) { const k = u.stage + '|' + u.level; byStage.set(k, Object.assign(byStage.get(k) || { stage: u.stage, level: u.level, n: 0 }, {})); byStage.get(k).n++; }
            return [...byStage.values()].map((u) => ({ cat: 'stages', key: 'stage:' + u.stage, text: `${u.stage} Lv${u.level}${u.n > 1 ? ' ×' + u.n : ''}` }));
          }),
          previewTop(d, id, {
            level: () => (lvs().length ? Math.min(...lvs()) : 1),
            quick: () => { const l = lvs(); return l.length ? [{ label: `最低 Lv${Math.min(...l)}`, level: Math.min(...l) }, { label: `最高 Lv${Math.max(...l)}`, level: Math.max(...l) }] : []; },
          }),
        ],
        sections: [
          { title: '基础三维', at: 'base', layout: 'triad' },
          { title: '每级成长', note: '三维 = 基础 + 成长 × 等级', at: 'growth', layout: 'triad' },
          { title: '战斗', keys: ['hpMul', 'dmgUp', 'role', 'boss'], note: '气血 = (基数 + 每级 × 等级) × 气血倍率' },
          { title: '击杀奖励', keys: ['exp', 'gold'], note: '实际 = 基数 × 敌人等级 × 击杀倍率' },
          { title: '技能', keys: ['basic', 'innate', 'branch'] },
          { title: '天赋', keys: ['talents'] },
          { title: '显示', keys: ['name', 'title'], image: true },
        ],
      };
    }

    function stageSpec(ci, si) {
      const base = sub('game.chapters', ci, 'stages', si);
      const d = () => W().game.chapters[ci].stages[si];
      const sid = T.get(D, base).id;
      return {
        key: 'stage:' + sid, base, kind: 'stage', glyph: () => sid,
        title: () => d().name, sub: () => d().note || '',
        badges: () => [d().boss ? badge('首领', 'boss') : null, d().gate ? badge('卡关点', 'lock') : null].filter(Boolean),
        search: () => [sid, d().name, d().note, ...d().enemies.map((e) => (W().game.enemies[e.enemyId] || {}).name)].join(' '),
        sections: [
          { title: '敌人', covers: ['enemies'], render: () => stageEnemies(base, ci, si) },
          { title: '关卡', keys: ['name', 'note', 'boss', 'gate'] },
        ],
      };
    }
    function chapterSpec(ci) {
      const base = sub('game.chapters', ci);
      const d = () => W().game.chapters[ci];
      const cid = T.get(D, base).id;
      return {
        key: 'chapter:' + cid, base, keys: ['name', 'desc'], wide: true, cls: 'echapter', kind: 'chapter', glyph: () => String(ci + 1),
        title: () => d().name, sub: () => `${cid} · 第 ${ci + 1} 段 · ${d().stages.length} 关 · ${d().desc || ''}`,
        search: () => [cid, d().name, d().desc].join(' '),
        sections: [{ title: '', keys: ['name', 'desc'] }],
      };
    }
    function stageEnemies(base, ci, si) {
      const list = T.get(D, base).enemies;
      const box = h('div', { class: 'estage' });
      const rows = list.map((e, i) => {
        const p = sub(base, 'enemies', i);
        const art = thumbBox('enemy', true);
        const info = h('span', { class: 'estage-info' });
        box.appendChild(h('div', { class: 'estage-row' }, art,
          Page.field(sub(p, 'enemyId'), { bare: true, options: optionsFor(sub(p, 'enemyId'), W()) }),
          Page.field(sub(p, 'level'), { label: 'Lv' }),
          Page.field(sub(p, 'row'), { bare: true, options: optionsFor(sub(p, 'row'), W()) }),
          info));
        return { art, info, i };
      });
      const total = h('div', { class: 'estage-total' });
      box.appendChild(total);
      const refresh = () => {
        const C = W(), G = C.game, st = G.chapters[ci].stages[si];
        let hp = 0, exp = 0, gold = 0;
        for (const r of rows) {
          const e = st.enemies[r.i], t = G.enemies[e.enemyId];
          if (!t) { r.info.textContent = '没有这个敌人'; continue; }
          r.art.update(t.art, (t.name || '?').slice(0, 1));
          let u = null;
          try { u = buildPreview(Page, t, e.enemyId, e.level); } catch (err) { /* 显示为空 */ }
          if (u) {
            const magic = (u.skills.find((s) => s.key === 'basic') || {}).dmgType === 'magic';
            r.info.textContent = `气血 ${num(u.base.maxHp)} · ${magic ? '法攻' : '物攻'} ${num(magic ? u.base.mAtk : u.base.pAtk)}`;
            r.info.title = `${t.name}（${e.enemyId}）Lv${e.level}`;
            hp += u.base.maxHp;
          }
          exp += Math.round(t.exp * e.level * G.exp.killMul);
          gold += Math.round((t.gold || 0) * e.level * G.gold.killMul);
        }
        total.textContent = `合计：气血 ${num(hp)} · 经验 ${num(exp)}${G.exp.split ? '（上阵角色平分）' : '（每个上阵角色各拿这么多）'} · 金币 ${num(gold)}`;
      };
      return { el: box, refresh };
    }

    function starterSpec(id) {
      const base = sub('game.starters', id);
      const d = () => W().game.starters[id];
      return {
        key: 'starter:' + id, base, kind: 'unit', artId: () => T.get(D, base).art,
        title: () => d().title || id, sub: () => [id, '开局角色'].join(' · '),
        search: () => [id, d().title, '开局'].join(' '),
        top: [previewTop(d, id, { level: () => 1, quick: () => [1, 10, 20, W().game.maxLevel].map((l) => ({ label: 'Lv' + l, level: l })) })],
        sections: [
          { title: '介绍', keys: ['desc'] },
          { title: '基础三维', at: 'base', layout: 'triad' },
          { title: '每级成长', note: '三维 = 基础 + 成长 × 等级', at: 'growth', layout: 'triad' },
          { title: '技能', keys: ['innate', 'branch'] },
          { title: '天赋', keys: ['talents'] },
          { title: '显示', keys: ['title', 'role'], image: true },
        ],
      };
    }

    function charSpec(id) {
      const base = sub('characters', id);
      const d = () => W().characters[id];
      return {
        key: 'char:' + id, base, kind: 'unit', artId: () => T.get(D, base).art,
        title: () => d().name, sub: () => [id, d().title].filter(Boolean).join(' · '),
        search: () => [id, d().name, d().title].join(' '),
        top: [
          usesTop('V0 默认阵容', () => Object.entries(W().defaultTeams).flatMap(([side, list]) => list.filter((e) => e.charId === id).map((e) => ({ text: `${side} 队${(UI.ROW_NAME || {})[e.row] || e.row}` })))),
          previewTop(d, id, { fixed: true, note: 'V0 角色写的是最终三维，等级用「V0 等级」' }),
        ],
        sections: [
          { title: '三维（最终值）', at: 'stats', layout: 'triad' },
          { title: '定位与站位', keys: ['role', 'row'] },
          { title: '技能', keys: ['innate', 'branch'] },
          { title: '技能卡', keys: ['activeCard', 'passiveCard'] },
          { title: '天赋', keys: ['talents'] },
          { title: '显示', keys: ['name', 'title'], image: true },
        ],
      };
    }

    function cardSpec(id) {
      const base = sub('cards', id);
      const d = () => W().cards[id];
      return {
        key: 'card:' + id, base, kind: 'card', artId: () => T.get(D, base).art,
        title: () => d().name, sub: () => [id, ENUM.cardSlot[d().slot] || d().slot, (d().roles || []).map(roleName).join('、')].join(' · '),
        badges: () => [badge((ENUM.quality[d().quality] || d().quality) + '卡', 'q-' + d().quality)],
        search: () => [id, d().name, (d().roles || []).map(roleName).join(' ')].join(' '),
        top: [
          () => {
            const el = h('div', { class: 'euse' });
            const refresh = () => {
              const r = d().roll;
              const f = (x) => (r.key === 'mult' ? '×' + x.toFixed(2) : fmtVal(x));
              el.textContent = r ? `插卡时掷「${ENUM.rollKey[r.key] || r.key}」：${f(r.min)} – ${f(r.max)}（中位 ${f((r.min + r.max) / 2)}）` : '';
            };
            return { el, refresh };
          },
          usesTop('谁带着', () => {
            const C = W(), G = C.game, out = whoUses((x) => (x.activeCard && x.activeCard.id === id) || (x.passiveCard && x.passiveCard.id === id));
            for (const [r, c] of Object.entries(G.cards.firstCard)) if (c === id) out.push({ text: `${roleName(r)}第一张卡` });
            for (const [r, l] of Object.entries(G.cards.pool)) if (l.includes(id)) out.push({ text: `${roleName(r)}卡池` });
            return out;
          }),
        ],
        sections: [
          { title: '基本', keys: ['quality', 'slot', 'roles'] },
          { title: '插卡数值', at: 'roll' },
          { title: '技能', at: 'skill' },
          { title: '被动', at: 'passive' },
          { title: '触发特效', at: 'trigger' },
          { title: '显示', keys: ['name'], image: true },
        ],
      };
    }

    function innateSpec(id) {
      const base = sub('innateSkills', id);
      const d = () => W().innateSkills[id];
      return {
        key: 'innate:' + id, base, kind: 'skill', artId: () => T.get(D, base).art,
        title: () => d().name, sub: () => [id, d().variants.length > 1 ? 'A / B 两个分支' : '一个分支'].join(' · '),
        search: () => [id, d().name, ...d().variants.map((v) => v.name)].join(' '),
        top: [usesTop('谁用', () => {
          const out = whoUses((x) => x.innate === id);
          for (const [r, l] of Object.entries(W().game.recruit.innatePool)) if (l.includes(id)) out.push({ text: `招募${roleName(r)}` });
          return out;
        })],
        sections: [
          { title: '', covers: ['variants'], render: (b, obj) => {
            const wrap = h('div', { class: 'evariants' });
            obj.variants.forEach((v, i) => wrap.appendChild(h('div', { class: 'evar' }, h('h5', null, obj.variants.length > 1 ? `${'AB'[i] || i + 1} 分支` : '技能'), block(sub(b, 'variants', i), v, Object.keys(v)))));
            return wrap;
          } },
          { title: '显示', keys: ['name'], image: true },
        ],
      };
    }

    function basicSpec(id) {
      const base = sub('basicSkills', id);
      const d = () => W().basicSkills[id];
      return {
        key: 'basic:' + id, base, kind: 'skill', artId: () => T.get(D, base).art,
        title: () => d().name, sub: () => [id, roleName(id) + '普攻'].join(' · '),
        search: () => [id, d().name, roleName(id)].join(' '),
        top: [usesTop('谁用', () => whoUses((x, t) => (x.basic || x.role) === id))],
        sections: [
          { title: '技能', keys: ['shape', 'range', 'dmgType', 'mult', 'cd', 'tags'] },
          { title: '显示', keys: ['name'], image: true },
        ],
      };
    }

    function talentSpec(id) {
      const base = sub('talents', id);
      const d = () => W().talents[id];
      return {
        key: 'talent:' + id, base, kind: 'talent-' + T.get(D, base).tier,
        title: () => d().name, sub: () => [id, ENUM.tier[d().tier] || d().tier, d().stat ? ENUM.stat[d().stat] || d().stat : null, (d().tags || []).join('') || null].filter(Boolean).join(' · '),
        badges: () => [d().rare ? badge('稀有', 'go') : null, d().exclusive ? badge('专属 ' + (nameOfId(d().exclusive, W()) || d().exclusive), 'lock') : null].filter(Boolean),
        search: () => [id, d().name, d().desc, ENUM.tier[d().tier]].join(' '),
        top: [
          () => {
            const el = h('div', { class: 'euse' });
            const refresh = () => { const x = d(); el.textContent = `数值 ${fmtVal(x.min)}${x.max !== x.min ? ' – ' + fmtVal(x.max) : ''}（档位 0 → 1）`; };
            return { el, refresh };
          },
          usesTop('谁带着', () => whoUses((x) => (x.talents || []).some((t) => t.id === id))),
        ],
        sections: [
          { title: '数值范围', keys: ['min', 'max'] },
          { title: '类型', keys: ['tier', 'stat', 'tags', 'rare', 'exclusive'] },
          { title: '触发', keys: ['event', 'requireTags', 'maxPerRound', 'chance', 'effect'] },
          { title: '说明', keys: ['name', 'desc'] },
        ],
      };
    }

    // 部位配方在「所在生产线 id」下面：game.forge.recipes、以后 game.tailor.recipes…
    const P = () => W().game.production;
    const recipeLines = () => Object.keys(T.get(D, 'game.production.lines') || {}).filter((l) => T.get(D, sub('game', l, 'recipes')));
    const qualityList = () => P().qualities;
    const qName = (q) => q.name || q.id;
    /** 一件装备的加成（和 src/game/equipment.js 的 gearStats 一样：基础数值 × 品质倍率，取整） */
    const gearValue = (v, q) => Math.round(v * q.mult);
    function gearSpec(lineId, slot) {
      const base = sub('game', lineId, 'recipes', slot);
      const d = () => W().game[lineId].recipes[slot];
      const line = () => P().lines[lineId] || {};
      const statWord = (k) => labelKey(k, sub(base, 'base', k), W());
      return {
        key: 'gear:' + lineId + ':' + slot, base, kind: 'gear', artId: () => T.get(D, base).art,
        glyph: () => (P().slotNames[slot] || slot).slice(0, 1),
        title: () => d().name, sub: () => [slot, P().slotNames[slot], line().name + '线', line().enabled ? null : '未开放'].filter(Boolean).join(' · '),
        badges: () => (line().enabled ? [] : [badge('线未开放', 'lock')]),
        search: () => [slot, d().name, d().desc, P().slotNames[slot], line().name].join(' '),
        top: [() => {
          // 各品质数值 + 1 级工坊的出货概率
          const box = h('div', { class: 'equal' });
          const refresh = () => {
            UI.clear(box);
            const r = d(), qs = qualityList(), tab = P().qualityTables[1] || [];
            const total = tab.reduce((a, b) => a + b, 0) || 1;
            const t = h('table', { class: 'etable eq' });
            t.appendChild(h('tr', null, h('th', null, '品质'), qs.map((q) => h('th', { class: 'gq gq-' + q.id }, qName(q)))));
            for (const k of Object.keys(r.base)) t.appendChild(h('tr', null, h('th', { class: 'erow' }, statWord(k)), qs.map((q) => h('td', null, num(gearValue(r.base[k], q))))));
            t.appendChild(h('tr', { class: 'muted' }, h('th', { class: 'erow' }, '1 级工坊'), qs.map((q, i) => h('td', null, tab[i] ? +(tab[i] / total * 100).toFixed(1) + '%' : '—'))));
            const st = labelKey(line().stat, null, null);
            const dur = (v) => Math.round(r.baseSec / (1 + v * P().craft.statCoef));
            put(box, h('div', { class: 'etable-wrap' }, t),
              h('div', { class: 'euse' }, `每件 ${Object.entries(r.cost).filter(([k]) => k !== 'gold').map(([k, v]) => num(v) + ' ' + ((T.get(D, 'game.gather.mats') || {})[k] || {}).name).join(' + ')} + ${num(r.cost.gold)} 金 · 打造时长：${ENUM.attr[line().stat] || st} 20 → ${dur(20)} 秒，50 → ${dur(50)} 秒，100 → ${dur(100)} 秒`));
          };
          return { el: box, refresh };
        }],
        sections: [
          { title: '白品质数值', note: '其他品质 = 白品质 × 品质倍率（取整）', at: 'base' },
          { title: '打造', keys: ['cost', 'baseSec'], note: '时长 = 基础时长 ÷ (1 + 打造值 × 系数)' },
          { title: '显示', keys: ['name', 'desc'], image: true },
        ],
      };
    }
    function linesSpec() {
      return {
        key: 'prod:lines', base: 'game.production.lines', wide: true,
        title: () => '生产线', sub: () => '锻造在 1-8 开放，裁缝 / 饰品在 unlockChapter 那一章通关时开放 · game.production.lines',
        search: () => '生产线 锻造 裁缝 饰品 ' + Object.values(P().lines).map((l) => l.name + ' ' + l.building).join(' '),
        sections: [{ title: '', covers: Object.keys(T.get(D, 'game.production.lines')), render: (b, o) => tableFor(b, o, rowLabelFor(b)) }],
      };
    }
    function qualitySpec() {
      return {
        key: 'prod:quality', base: 'game.production', keys: ['qualities', 'qualityTables', 'craft', 'slotNames'], wide: true,
        title: () => '品质与打造', sub: () => '打造时按工坊等级查概率表掷品质，不能选 · game.production',
        search: () => '品质 概率 工坊 打造 ' + qualityList().map(qName).join(' '),
        sections: [
          { title: '品质', note: '数值 = 部位白品质数值 × 倍率', keys: ['qualities'] },
          { title: '工坊等级 → 各品质概率（%）', note: '1 级先定，2–5 级占位；每行加起来应为 100', covers: ['qualityTables'], render: (b) => qualityTable(sub(b, 'qualityTables')) },
          { title: '打造', keys: ['craft'] },
          { title: '部位名', keys: ['slotNames'] },
        ],
      };
    }
    /** 概率表：行 = 工坊等级，列 = 品质；最后一列是合计（≠ 100 标红）和期望数值倍率 */
    function qualityTable(p) {
      const tabs = T.get(D, p);
      const qs = T.get(D, 'game.production.qualities');
      const t = h('table', { class: 'etable' });
      t.appendChild(h('tr', null, h('th', null, ''), qs.map((q, i) => h('th', { class: 'gq gq-' + q.id }, q.name || q.id)), h('th', null, '合计'), h('th', null, '期望倍率')));
      const sums = [];
      for (const lv of Object.keys(tabs)) {
        const sumEl = h('td', { class: 'esum' }), expEl = h('td', { class: 'esum' });
        sums.push({ lv, sumEl, expEl });
        t.appendChild(h('tr', null, h('th', { class: 'erow' }, `${lv} 级`), tabs[lv].map((x, i) => h('td', null, Page.field(sub(p, lv, i), { bare: true }))), sumEl, expEl));
      }
      const refresh = () => {
        const cur = P().qualityTables, ql = qualityList();
        for (const r of sums) {
          const row = cur[r.lv], tot = row.reduce((a, b) => a + b, 0);
          r.sumEl.textContent = +tot.toFixed(2) + '%';
          r.sumEl.classList.toggle('bad', Math.abs(tot - 100) > 1e-6);
          r.sumEl.title = Math.abs(tot - 100) > 1e-6 ? '加起来不是 100：游戏按比例换算（每格 ÷ 合计）' : '';
          r.expEl.textContent = tot ? '×' + (row.reduce((a, x, i) => a + x * ((ql[i] || {}).mult || 0), 0) / tot).toFixed(2) : '—';
        }
      };
      return { el: h('div', { class: 'etable-wrap' }, t), refresh };
    }

    function roleSpec(id) {
      const base = sub('roles', id);
      const d = () => W().roles[id];
      return {
        key: 'role:' + id, base, kind: 'role', glyph: () => (d().name || id).slice(0, 1),
        title: () => d().name, sub: () => id,
        search: () => [id, d().name].join(' '),
        top: [usesTop('谁是这个定位', () => whoUses((x) => x.role === id))],
        sections: [{ title: '', keys: ['name', 'hpMul'] }],
      };
    }

    const GN = () => (DAO.ConfigRules && DAO.ConfigRules.GROUP_NAMES) || {};
    function sysSpec(base, title, opts) {
      opts = opts || {};
      const o = T.get(D, base);
      const keys = opts.keys || Object.keys(o);
      return {
        key: 'sys:' + base + (opts.keys ? ':' + keys.join(',') : ''), base, keys: opts.keys, wide: opts.wide !== false,
        title: () => title || GN()[base] || labelKey(segs(base).pop(), base), sub: () => opts.sub || base,
        search: () => [base, title || GN()[base] || '', opts.sub || ''].join(' '),
        sections: [opts.keys ? { title: '', keys } : { title: '', covers: keys, render: () => tableFor(base, o, rowLabelFor(base)) || block(base, o, keys) }],
      };
    }
    function pinnedSpec() {
      const R = DAO.ConfigRules;
      return {
        key: 'pinned', wide: true, pathList: Page.PINNED.slice(),
        title: () => '常用', sub: () => '调得最多的几项（和按字段视图置顶的那组一样）', search: () => '常用',
        sections: [{ title: '', render: () => h('div', { class: 'efields' }, Page.PINNED.map((p) => Page.field(p, { label: R.LABELS[p] || autoLabel(p, W()), options: optionsFor(p, W()), hint: hintFor(p) }))) }],
      };
    }
    function artSpec(artId) {
      const owners = () => {
        const C = W(), G = C.game, out = [];
        const scan = (obj, label) => { for (const [k, x] of Object.entries(obj || {})) if (x && x.art === artId) out.push(`${label}：${x.name || x.title || k}`); };
        scan(G.enemies, '敌人'); scan(G.starters, '开局'); scan(C.characters, 'V0 角色'); scan(C.basicSkills, '普攻'); scan(C.innateSkills, '固有技能'); scan(C.cards, '技能卡');
        for (const l of Object.keys(G.production ? G.production.lines : {})) if (G[l] && G[l].recipes) scan(G[l].recipes, '装备');
        return out;
      };
      const kind = String(artId).split('.')[0];
      return {
        key: 'art:' + artId, pathList: prefixPaths(imgPath(artId)), kind: kind === 'unit' ? 'unit' : kind, artId: () => artId,
        glyph: () => ((owners()[0] || '').split('：')[1] || artId).slice(0, 1),
        title: () => (owners()[0] || '').split('：')[1] || artId, sub: () => [artId, ...owners().map((x) => x.split('：')[0])].join(' · '),
        search: () => [artId, ...owners()].join(' '),
        sections: [{ title: '', render: () => imageFields(artId) }],
      };
    }

    // ---------- 分类 ----------
    const keysOf = (p) => Object.keys(T.get(D, p) || {});
    const CATS = [
      { id: 'pinned', name: '常用', groups: () => [{ specs: [pinnedSpec()] }] },
      { id: 'enemies', name: '敌人', groups: () => [{ specs: keysOf('game.enemies').map(enemySpec) }] },
      { id: 'stages', name: '关卡', groups: () => T.get(D, 'game.chapters').map((c, ci) => ({
        specs: [chapterSpec(ci)].concat(c.stages.map((s, si) => stageSpec(ci, si))),
      })) },
      { id: 'starters', name: '开局角色', groups: () => [{ specs: keysOf('game.starters').map(starterSpec) }] },
      { id: 'cards', name: '技能卡', groups: () => [
        { title: '主动卡', specs: keysOf('cards').filter((k) => T.get(D, sub('cards', k)).slot === 'active').map(cardSpec) },
        { title: '被动卡（第一版没有被动卡槽，V0 模拟器在用）', specs: keysOf('cards').filter((k) => T.get(D, sub('cards', k)).slot !== 'active').map(cardSpec) },
        { title: '掉落与卡池', specs: [sysSpec('game.cards', '卡牌掉落与卡池')] },
      ] },
      { id: 'innate', name: '固有技能', groups: () => [{ specs: keysOf('innateSkills').map(innateSpec) }] },
      { id: 'basic', name: '普攻', groups: () => [{ specs: keysOf('basicSkills').map(basicSpec) }] },
      { id: 'talents', name: '天赋', groups: () => ['stat', 'tag', 'trigger'].map((tier) => ({
        title: ENUM.tier[tier], specs: keysOf('talents').filter((k) => T.get(D, sub('talents', k)).tier === tier).map(talentSpec),
      })) },
      { id: 'gear', name: '装备', groups: () => [
        ...recipeLines().map((l) => ({ title: `${T.get(D, sub('game.production.lines', l, 'name'))}线 · ${(T.get(D, sub('game.buildings.list', T.get(D, sub('game.production.lines', l, 'building')))) || {}).name || T.get(D, sub('game.production.lines', l, 'building'))}`,
          specs: keysOf(sub('game', l, 'recipes')).map((slot) => gearSpec(l, slot))
            .concat(keysOf(sub('game', l)).some((k) => k !== 'recipes') ? [sysSpec(sub('game', l), T.get(D, sub('game.production.lines', l, 'name')) + '引导', { keys: keysOf(sub('game', l)).filter((k) => k !== 'recipes') })] : []) })),
        { title: '生产线与品质', specs: [qualitySpec(), linesSpec()] },
      ] },
      { id: 'roles', name: '定位', groups: () => [{ specs: keysOf('roles').map(roleSpec) }] },
      { id: 'economy', name: '成长与经济', groups: () => [{ specs: [
        sysSpec('game', '游戏总览', { keys: keysOf('game').filter((k) => T.isLeaf(T.get(D, sub('game', k)))) }),
        ...['research', 'recruit', 'exp', 'gold', 'gather', 'buildings', 'salvage', 'roster', 'auto', 'settings', 'idle', 'estimate', 'migration', 'quota'].filter((k) => T.get(D, sub('game', k))).map((k) => sysSpec(sub('game', k))),
      ] }] },
      { id: 'rules', name: '战斗规则', groups: () => [{ specs: ['derive', 'damage', 'actionBar', 'formation', 'bounce', 'trigger', 'heal', 'cast', 'guard', 'ai', 'playback', 'debug']
        .filter((k) => D[k] !== undefined).map((k) => sysSpec(k)) }] },
      { id: 'art', name: '图片', groups: () => [
        { specs: [sysSpec('assets', '图片设置', { keys: ['root'], wide: false })] },
        ...['unit', 'enemy', 'skill', 'card', 'gear'].map((kind) => ({
          title: (DAO.Art && { unit: '角色', enemy: '敌人', skill: '技能', card: '技能卡', gear: '装备' }[kind]) || kind,
          specs: Object.keys(D.assets.images).filter((id) => id.split('.')[0] === kind).map(artSpec),
        })),
      ] },
      { id: 'v0', name: 'V0 模拟器', groups: () => [
        { specs: keysOf('characters').map(charSpec) },
        { title: '默认阵容与等级', specs: [sysSpec('defaultTeams', 'V0 默认阵容', { wide: false }), sysSpec('', 'V0 等级与批量模拟', { keys: ['level', 'sim'], wide: false })] },
      ] },
    ];
    // 没被任何分类覆盖的顶层配置（以后新加的模块）放进「其他」
    (function addOther() {
      const known = new Set(['formation', 'actionBar', 'derive', 'damage', 'bounce', 'trigger', 'heal', 'ai', 'roles', 'cast', 'guard', 'sim', 'basicSkills', 'innateSkills',
        'cards', 'talents', 'level', 'characters', 'defaultTeams', 'game', 'playback', 'debug', 'assets']);
      const knownGame = new Set(['starters', 'enemies', 'chapters', 'cards', 'production', ...Object.keys(D.game.production ? D.game.production.lines : {}), 'forge', 'research', 'recruit', 'exp', 'gold', 'gather', 'buildings', 'salvage', 'roster', 'auto', 'settings', 'idle', 'estimate', 'migration', 'quota']);
      const extra = Object.keys(D).filter((k) => !known.has(k)).map((k) => sysSpec(k))
        .concat(Object.keys(D.game || {}).filter((k) => !knownGame.has(k) && !T.isLeaf(D.game[k])).map((k) => sysSpec(sub('game', k))));
      if (extra.length) CATS.push({ id: 'other', name: '其他', groups: () => [{ specs: extra }] });
    })();

    // ---------- 渲染 ----------
    function match(spec, q, oc) {
      if (oc && !changedCount(spec)) return false;
      if (q && !spec.search().toLowerCase().includes(q)) return false;
      return true;
    }
    function catById(id) { return CATS.find((c) => c.id === id) || CATS[1]; }

    function render() {
      if (!cat) { const want = decodeURIComponent((location.hash || '').slice(1)); cat = CATS.some((c) => c.id === want) ? want : 'enemies'; }
      Page.beginRender();
      UI.clear(els.list);
      cards = [];
      const q = Page.query.trim().toLowerCase(), oc = Page.onlyChanged;
      els.list.appendChild(h('div', { class: 'tnote' }, h('b', null, '按对象：'), '同一只怪、同一关、同一张卡的字段放在一起；顶上的数值按当前草稿实时算。',
        '改完点右上角「保存」，', h('b', null, '刷新游戏页面生效'), '。黄框 = 改过（↺ 恢复默认），红框 = 值不合法。',
        '这里只能改已有字段的值：增删怪物、给怪加天赋、关卡加怪要改 src/config/*.js。'));
      const cats = q || oc ? CATS : [catById(cat)];
      for (const c of cats) {
        let shown = 0;
        const box = h('div', { class: 'ecat', id: 'cat-' + c.id }, h('h2', null, c.name));
        for (const g of c.groups()) {
          const specs = g.specs.filter((s) => match(s, q, oc));
          if (!specs.length) continue;
          if (g.title || g.head) box.appendChild(g.head ? g.head() : h('h3', { class: 'egroup-title' }, g.title));
          const grid = h('div', { class: 'egrid' });
          for (const s of specs) { const cd = buildCard(s); cards.push(cd); grid.appendChild(cd.el); }
          box.appendChild(grid);
          shown += specs.length;
        }
        if (shown) els.list.appendChild(box);
      }
      if (!cards.length) els.list.appendChild(h('p', { class: 'muted' }, q ? '没有匹配的对象（按名字或 id 搜）。' : '没有改过的对象。'));
      renderNav();
    }
    function renderNav() {
      UI.clear(els.nav);
      const q = Page.query.trim().toLowerCase(), oc = Page.onlyChanged;
      for (const c of CATS) {
        const specs = c.groups().flatMap((g) => g.specs);
        const mod = specs.filter((s) => changedCount(s)).length;
        const hit = q || oc ? specs.filter((s) => match(s, q, oc)).length : specs.length;
        if ((q || oc) && !hit) continue;
        els.nav.appendChild(h('button', { type: 'button', class: [mod ? 'mod' : '', !q && !oc && c.id === cat ? 'on' : ''].join(' '), onclick: () => {
          if (q || oc) { const t = document.getElementById('cat-' + c.id); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
          cat = c.id; history.replaceState(null, '', '#' + c.id); render(); window.scrollTo({ top: 0 });
        } }, h('span', null, c.name), h('small', null, mod ? `${mod} 改 · ${hit}` : String(hit))));
      }
    }
    function refresh() { for (const c of cards) c.refresh(); renderNav(); }
    function goto(catId, key) {
      cat = catId;
      history.replaceState(null, '', '#' + catId);
      Page.clearFilters();
      render();
      const el = document.getElementById('e-' + key.replace(/[^\w-]/g, '_'));
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
    }
    return { render, refresh, goto, cats: CATS, specPaths, allSpecs: () => CATS.flatMap((c) => c.groups().flatMap((g) => g.specs)) };
  }

  DAO.ConfigEntities = { autoLabel, labelKey, optionsFor, hintFor, createView, ENUM };
})(typeof globalThis !== 'undefined' ? globalThis : this);
