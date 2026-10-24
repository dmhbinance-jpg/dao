/**
 * 天赋（设计文档第 6 节）。三档：
 *   stat    属性型 —— 进对应乘区                         （约 60%）
 *   tag     标签型 —— 加算进增伤区，只认标签             （约 30%）
 *   trigger 触发型 —— 走事件系统，仅稀有，每角色最多一条（约 10%）
 *
 * 实例写法：{ id, roll }，roll ∈ [0,1] 为档位（0 档 = min，100 档 = max）。
 *
 * stat 可选：strPct agiPct intPct hpPct armorPct resistPct critRate critDmg finalDmg speed dmgUp healUp
 * trigger.event：battleStart | roundStart | act | crit | kill | hit
 * trigger.effect.kind：
 *   cdReduce   {tags, value}          指定标签技能 CD −value
 *   extraAction                        再动（受每回合 1 次上限）
 *   healSelf   {value}                 回复 value × 最大生命
 *   shieldSelf {value}                 获得 value × 最大生命 护盾
 *   buffSelf   {stat, value, duration}
 *   buffRow    {stat, value, duration} 同排队友（含自己）
 *   pushSelf   {value}                 推条
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});
  const T = DAO.TAGS;

  DAO.CONFIG.talents = {
    // ===== 属性型 =====
    li:        { name: '力拔',   tier: 'stat', stat: 'strPct',  min: 0.05, max: 0.15 },
    min:       { name: '身轻',   tier: 'stat', stat: 'agiPct',  min: 0.05, max: 0.15 },
    zhi:       { name: '慧根',   tier: 'stat', stat: 'intPct',  min: 0.05, max: 0.15 },
    tiepi:     { name: '铁皮',   tier: 'stat', stat: 'armorPct', min: 0.10, max: 0.25 },
    changsheng:{ name: '长生',   tier: 'stat', stat: 'hpPct',   min: 0.08, max: 0.20 },
    xinyan:    { name: '心眼',   tier: 'stat', stat: 'critRate', min: 0.03, max: 0.08 },
    lieren:    { name: '裂刃',   tier: 'stat', stat: 'critDmg', min: 0.10, max: 0.30 },
    jisu:      { name: '疾速',   tier: 'stat', stat: 'speed',   min: 5,    max: 15 },
    shaqi:     { name: '杀气',   tier: 'stat', stat: 'finalDmg', min: 0.03, max: 0.08, rare: true },

    // ===== 标签型（加算进增伤区） =====
    jianxin:   { name: '剑心',   tier: 'tag', tags: [T.SWORD],    min: 0.08, max: 0.18 },
    huoling:   { name: '火灵',   tier: 'tag', tags: [T.FIRE],     min: 0.08, max: 0.18 },
    guangsan:  { name: '广散',   tier: 'tag', tags: [T.AOE],      min: 0.08, max: 0.16 },
    zhuanzhu:  { name: '专注',   tier: 'tag', tags: [T.SINGLE],   min: 0.08, max: 0.16 },
    ganglie:   { name: '刚烈',   tier: 'tag', tags: [T.PHYSICAL], min: 0.06, max: 0.14 },
    xuanwei:   { name: '玄微',   tier: 'tag', tags: [T.MAGIC],    min: 0.06, max: 0.14 },
    renxin:    { name: '仁心',   tier: 'tag', tags: [T.HEAL],     min: 0.08, max: 0.18 },

    // ===== 触发型（稀有，走事件系统） =====
    jianxintongming: { name: '剑心通明', tier: 'trigger', rare: true, min: 1, max: 1,
      event: 'crit', requireTags: [T.SWORD],
      effect: { kind: 'cdReduce', tags: [T.SWORD], value: 1 },
      desc: '暴击时，剑系技能 CD −1' },
    shafa: { name: '杀伐', tier: 'trigger', rare: true, min: 1, max: 1,
      event: 'kill',
      effect: { kind: 'extraAction' },
      desc: '击杀时再动' },
    hutigangqi: { name: '护体罡气', tier: 'trigger', rare: true, min: 0.03, max: 0.06,
      event: 'hit', maxPerRound: 2,
      effect: { kind: 'healSelf' },
      desc: '受击时回复最大生命的 3%–6%（每回合最多 2 次）' },
    xianshengduoren: { name: '先声夺人', tier: 'trigger', rare: true, min: 300, max: 600,
      event: 'battleStart',
      effect: { kind: 'pushSelf' },
      desc: '开场推条 300–600' },
    liaoyuan: { name: '燎原', tier: 'trigger', rare: true, min: 150, max: 300,
      event: 'act', requireTags: [T.FIRE], maxPerRound: 1,
      effect: { kind: 'pushSelf' },
      desc: '施放火系技能时推条 150–300（每回合 1 次）' },
    zhenxin: { name: '阵心', tier: 'trigger', rare: true, min: 0.08, max: 0.15,
      event: 'battleStart',
      effect: { kind: 'buffRow', stat: 'dmgUp', duration: 3 },
      desc: '开场时同排队友增伤 8%–15%（3 次行动）' },
    // 名将专属（exclusive = 角色 id；文档：名将专属天赋可以认具体技能）
    pojunzhiwei: { name: '破军之威', tier: 'trigger', rare: true, exclusive: 'huoxiao', min: 1, max: 1,
      event: 'kill',
      effect: { kind: 'cdReduce', tags: [], value: 2 },
      desc: '击杀时所有技能 CD −2' },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
