/**
 * 标签。第一版共 7 个（设计文档第 6 节）：
 *   伤害类型：物理、法术、治疗
 *   形状：单体、群体
 *   流派：剑、火（预留扩展位）
 * 天赋只认标签、不认具体技能。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  DAO.TAGS = {
    PHYSICAL: '物理',
    MAGIC: '法术',
    HEAL: '治疗',
    SINGLE: '单体',
    AOE: '群体',
    SWORD: '剑',
    FIRE: '火',
  };

  DAO.TAG_LIST = Object.values(DAO.TAGS);

  DAO.TAG_GROUP = {
    物理: 'type', 法术: 'type', 治疗: 'type',
    单体: 'shape', 群体: 'shape',
    剑: 'school', 火: 'school',
  };

  /** 形状 → 自动附带的形状标签 */
  DAO.shapeTag = function (shape) {
    return shape === 'single' ? DAO.TAGS.SINGLE : DAO.TAGS.AOE;
  };

  /** 技能标签是否命中天赋标签集合（任一命中即可；allTags=true 则需全部命中） */
  DAO.tagsMatch = function (skillTags, talentTags, allTags) {
    if (!talentTags || !talentTags.length) return true;
    const set = new Set(skillTags || []);
    return allTags ? talentTags.every((t) => set.has(t)) : talentTags.some((t) => set.has(t));
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
