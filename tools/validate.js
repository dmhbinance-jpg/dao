/**
 * 配置项校验与分组（配置网站和本地服务共用；不被游戏加载）。
 *   DAO.ConfigRules.validate(path, value, def, cfg) → null | 错误说明
 *   DAO.ConfigRules.group(path) → { id, name }       按模块分组
 *   DAO.ConfigRules.PINNED → 常用项（置顶），DAO.ConfigRules.label(path) → 中文名（只给常用项和部分项；其余由 entities.js 的 autoLabel 生成）
 *   DAO.ConfigRules.GROUP_NAMES → 模块中文名
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  // ---- 常用项（置顶）----
  const PINNED = [
    ['debug.timeScale', '时间倍率（1 / 2 / 5 / 10）'],
    ['game.research.slots.levels.2.sec', '研究上阵位 2：时长（秒）'],
    ['game.research.slots.levels.3.sec', '研究上阵位 3：时长（秒）'],
    ['game.research.slots.levels.4.sec', '研究上阵位 4：时长（秒）'],
    ['game.research.slots.levels.5.sec', '研究上阵位 5：时长（秒）'],
    ['game.research.slots.levels.2.gold', '研究上阵位 2：金币'],
    ['game.research.slots.levels.3.gold', '研究上阵位 3：金币'],
    ['game.research.slots.levels.4.gold', '研究上阵位 4：金币'],
    ['game.research.slots.levels.5.gold', '研究上阵位 5：金币'],
    ['game.gather.perSec', '采集速率（资质系数 1.0 每秒灵矿）'],
    ['game.gold.killMul', '金币掉落倍率'],
    ['game.exp.killMul', '经验倍率'],
    ['game.recruit.cost', '招募价格（固定）'],
    ['game.forge.recipes.weapon.cost.ore', '锻造武器：灵矿'],
    ['game.forge.recipes.weapon.cost.gold', '锻造武器：金币'],
    ['game.forge.recipes.weapon.baseSec', '锻造武器：基础时长（秒）'],
    ['game.forge.recipes.chest.cost.ore', '锻造胸甲：灵矿'],
    ['game.forge.recipes.chest.cost.gold', '锻造胸甲：金币'],
    ['game.forge.recipes.chest.baseSec', '锻造胸甲：基础时长（秒）'],
    ['game.production.craft.statCoef', '打造时长系数（时长 ÷ (1 + 打造值 × 系数)）'],
    ['game.production.qualityTables.1.0', '1 级工坊：白 %'],
    ['game.production.qualityTables.1.1', '1 级工坊：绿 %'],
    ['game.production.qualityTables.1.2', '1 级工坊：蓝 %'],
  ];
  const LABELS = Object.fromEntries(PINNED);
  Object.assign(LABELS, {
    'game.roster.cap': '名额（总人数上限）',
    'game.research.slots.stageCap': '本阶段上阵位最多研究到',
    'game.gather.minFactor': '采集资质系数下限',
    'game.gather.refGrowth': '采集资质系数的成长参考值（灵矿看力、灵草看敏、灵石看智）',
    'game.buildings.costMult': '建筑每升一级花费倍率', 'game.buildings.maxLevel': '建筑等级上限',
    'game.salvage.surplusMin': '推荐分解：多余装备至少几件', 'game.salvage.tidyAt': '「整理装备」引导：背包几件时弹',
    'game.exp.base': '升级经验基数', 'game.exp.power': '升级经验指数',
    'game.idle.speed': '挂机战斗计时倍率', 'game.idle.gapMs': '挂机两场间隔（毫秒）',
    'game.maxLevel': '等级上限',
  });

  const GROUP_NAMES = {
    debug: '调试', formation: '阵型', actionBar: '行动条 / 回合', derive: '三维 → 二级属性', damage: '伤害乘区', bounce: '弹射', trigger: '触发',
    heal: '治疗', ai: '战斗 AI', cast: '施放', guard: '守护', sim: '批量模拟', roles: '定位', basicSkills: '普攻', innateSkills: '固有技能', cards: '技能卡', talents: '天赋',
    characters: 'V0 角色', defaultTeams: 'V0 默认阵容', level: 'V0 等级', playback: '回放节奏', assets: '资源清单', shapeTags: '形状标签',
    'game.starters': '开局角色', 'game.roster': '名额 / 站位', 'game.enemies': '敌人', 'game.chapters': '引导关', 'game.cards': '卡牌掉落',
    'game.exp': '经验', 'game.gold': '金币', 'game.recruit': '招募', 'game.research': '研究', 'game.auto': '自动推关', 'game.gather': '采集',
    'game.forge': '锻造线', 'game.production': '生产线 / 品质', 'game.settings': '默认设置', 'game.idle': '挂机', 'game.estimate': '时长估算（命令行）', 'game.migration': '存档迁移',
    'game.quota': '名额扩建（预留）', saves: '存档（存档位 / 备份）',
    'game.tailor': '裁缝线', 'game.jewelry': '饰品线', 'game.buildings': '洞府建筑', 'game.salvage': '出售 / 分解',
  };
  function group(path) {
    const segs = DAO.Tuning.parse(path);
    const id = segs[0] === 'game' && segs.length > 2 ? 'game.' + segs[1] : segs[0] === 'game' ? 'game' : segs[0];
    return { id, name: GROUP_NAMES[id] || (id === 'game' ? '游戏（其他）' : id) };
  }

  // ---- 范围规则：按路径匹配，先匹配先用 ----
  const RULES = [
    [/^debug\.timeScale$/, { enum: [1, 2, 5, 10] }],
    [/^saves\.(slots|backups|originals)$/, { min: 1, max: 20, int: true }],
    [/^saves\.(backupEveryMs|diskThrottleMs)$/, { min: 0, max: 86400000, int: true }],
    [/research\.slots\.levels\.\d+\.sec$/, { min: 1, max: 86400 }],
    [/research\.slots\.(start|max|stageCap)$/, { min: 1, max: 6, int: true }],
    [/^game\.roster\.cap$/, { min: 1, max: 50, int: true }],
    [/recipes\.\w+\.cost\.(ore|herb|stone|gold)$/, { min: 0, max: 1e6 }],
    [/^game\.buildings\.costMult$/, { min: 1, max: 10 }],
    [/^game\.buildings\.maxLevel$/, { min: 1, max: 10, int: true }],
    [/^game\.buildings\.list\.\w+\.slots\.\d+$/, { min: 0, max: 20, int: true }],
    [/^game\.buildings\.list\.\w+\.cost\.(ore|herb|stone|gold)$/, { min: 0, max: 1e7 }],
    [/^game\.salvage\.(sell|salvage)\.\w+$/, { min: 0, max: 1 }],
    [/^game\.salvage\.(surplusMin|tidyAt)$/, { min: 1, max: 1000, int: true }],
    [/recipes\.\w+\.baseSec$/, { min: 1, max: 86400 }],
    [/qualityTables\.\d+\.\d+$/, { min: 0, max: 100 }],
    [/^game\.recruit\.cost$/, { min: 0, max: 1e6 }],
    [/\.level$/, { min: 1, max: 200, int: true }],
    [/(weight|chance)$/, { min: 0, max: 1000 }],
    [/\.roll$/, { min: 0, max: 1 }],
    [/^game\.maxLevel$/, { min: 1, max: 200, int: true }],
    [/^actionBar\.maxRounds$/, { min: 1, max: 500, int: true }],
  ];
  const ENUMS = {
    row: ['front', 'back'], shape: ['single', 'front', 'back', 'all', 'bounce'], range: ['melee', 'ranged'],
    dmgType: ['physical', 'magic', 'heal', 'none'], targetRule: ['default', 'lowestHp', 'backRow', 'highestAtk'],
  };

  function validate(path, value, def, cfg) {
    if (!DAO.Tuning.sameType(def, value)) return `类型不对：应该是${def === null ? '文字或留空' : { number: '数字', string: '文字', boolean: '开关' }[typeof def]}`;
    const last = DAO.Tuning.parse(path).slice(-1)[0];
    if (typeof value === 'number') {
      if (!isFinite(value)) return '不是有效数字';
      const r = (RULES.find(([re]) => re.test(path)) || [])[1];
      if (r) {
        if (r.enum && !r.enum.includes(value)) return `只能是 ${r.enum.join(' / ')}`;
        if (r.int && !Number.isInteger(value)) return '必须是整数';
        if (r.min != null && value < r.min) return `不能小于 ${r.min}`;
        if (r.max != null && value > r.max) return `不能大于 ${r.max}`;
        return null;
      }
      // 通用：正数默认值 → 0 到 max(默认 × 100, 100)；负数默认值 → 不大于 0；0 → 绝对值不超过 1e6
      if (def > 0) { if (value < 0) return '不能是负数'; if (value > Math.max(def * 100, 100)) return `超出合理范围（默认 ${def}，最多 ${Math.max(def * 100, 100)}）`; }
      else if (def < 0) { if (value > 0) return '应该是负数或 0'; if (value < def * 100) return `超出合理范围（最小 ${def * 100}）`; }
      else if (Math.abs(value) > 1e6) return '超出合理范围';
      if (Number.isInteger(def) && /(level|Level|cap|max|start|count|bounces|duration|cd|maxPerRound)$/.test(last) && !Number.isInteger(value)) return '必须是整数';
      return null;
    }
    if (typeof value === 'string') {
      if (!value.trim() && def !== '') return '不能为空';
      if (ENUMS[last] && !ENUMS[last].includes(value)) return `只能是 ${ENUMS[last].join(' / ')}`;
      if (cfg) {
        const G = cfg.game || {};
        const stageIds = (G.chapters || []).flatMap((c) => c.stages.map((s) => s.id));
        if (/Stage$/.test(last) && def && stageIds.includes(def) && !stageIds.includes(value)) return '没有这个关卡：' + value;
        if (last === 'innate' && cfg.innateSkills && !cfg.innateSkills[value]) return '没有这个固有技能：' + value;
        if (last === 'enemyId' && G.enemies && !G.enemies[value]) return '没有这个敌人：' + value;
        if (last === 'basic' && cfg.basicSkills && !cfg.basicSkills[value]) return '没有这个普攻：' + value;
      }
    }
    return null;
  }

  DAO.ConfigRules = { PINNED, LABELS, GROUP_NAMES, label: (p) => LABELS[p] || '', group, validate };
})(typeof globalThis !== 'undefined' ? globalThis : this);
