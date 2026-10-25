/**
 * 资源清单（表现层预留，目前没有任何美术）。
 *
 * 配置里的角色、敌人、技能、技能卡、装备都有 art 字段，值是这里的资源 id。这张表把 id 映射到图片路径：
 *   'unit.sword': 'units/sword.png'                     —— 一张图（路径相对 root）
 *   'unit.sword': { portrait: 'units/sword.png', icon: 'units/sword_s.png', sprite: 'units/sword_atlas.json' }
 *                                                        —— 按用途分开；界面按用途取，取不到用 default，再取不到算缺图
 *   'unit.sword': null                                   —— 占位：还没出图
 * 找不到（null、没登记、图片加载失败）时界面退回文字 / 色块，所以出图前后逻辑不用改。
 * 新增配置项时在这里登记它的 id；`node cli/invariants.js` 会检查配置里的 art 都登记过、这里没有多余的 id。
 *
 * 纯数据 + 查询函数，不碰 DOM。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  DAO.CONFIG.assets = {
    root: 'assets/',
    images: {
      // 角色
      'unit.sword': null,                  // 开局 / 招募角色：剑修
      'unit.mage': null,                   // 开局 / 招募角色：法修
      'unit.liuwuying': null,              // V0 角色：柳无影
      'unit.sujin': null,                  // V0 角色：苏烬
      'unit.huoxiao': null,                // V0 角色：霍骁
      'unit.hantieyi': null,               // V0 角色：韩铁衣
      'unit.chixiazi': null,               // V0 角色：赤霞子
      'unit.yueling': null,                // V0 角色：岳凌
      'unit.qinshuang': null,              // V0 角色：秦霜
      'unit.shenqingya': null,             // V0 角色：沈青崖
      'unit.wenruyu': null,                // V0 角色：温如玉
      'unit.lufen': null,                  // V0 角色：陆焚

      // 敌人
      'enemy.wolf': null,                  // 敌人：灰狼
      'enemy.boar': null,                  // 敌人：野猪
      'enemy.stoneboar': null,             // 敌人：石甲猪
      'enemy.fox': null,                   // 敌人：狐妖
      'enemy.shanxiao': null,              // 敌人：山魈
      'enemy.blackwolf': null,             // 敌人：黑风狼
      'enemy.ironbear': null,              // 敌人：铁背熊
      'enemy.redfox': null,                // 敌人：赤狐
      'enemy.bearking': null,              // 敌人：铁背熊王
      'enemy.foxking': null,               // 敌人：黑风狐王

      // 技能
      'skill.basic.sword': null,           // 普攻：剑击
      'skill.basic.mage': null,            // 普攻：火弹
      'skill.basic.beast': null,           // 普攻：撕咬
      'skill.basic.demon': null,           // 普攻：妖火
      'skill.liuying': null,               // 固有技能：流影
      'skill.lianzhuhuo': null,            // 固有技能：连珠火
      'skill.chiyan': null,                // 固有技能：赤焰
      'skill.jianqizhan': null,            // 固有技能：剑气斩
      'skill.pojun': null,                 // 固有技能：破军
      'skill.pounce': null,                // 固有技能：扑击
      'skill.gore': null,                  // 固有技能：冲撞
      'skill.foxfire': null,               // 固有技能：狐火
      'skill.yaofengzhen': null,           // 固有技能：妖风阵
      'skill.shanxiao': null,              // 固有技能：裂山

      // 技能卡
      'card.chuanyun': null,               // 技能卡：穿云剑
      'card.jianqi': null,                 // 技能卡：剑气横扫
      'card.lieyan': null,                 // 技能卡：烈焰
      'card.huoyu': null,                  // 技能卡：火雨
      'card.liuhuo': null,                 // 技能卡：流火弹
      'card.zhenshe': null,                // 技能卡：震慑
      'card.ruifeng': null,                // 技能卡：锐锋
      'card.fenxin': null,                 // 技能卡：焚心
      'card.jingang': null,                // 技能卡：金刚
      'card.ningshen': null,               // 技能卡：凝神
      'card.xunjie': null,                 // 技能卡：迅捷
      'card.wanjian': null,                // 技能卡：万剑归宗

      // 装备
      'gear.weapon': null,                 // 装备：武器
      'gear.chest': null,                  // 装备：胸甲
      'gear.gloves': null,                 // 装备：护手
      'gear.boots': null,                  // 装备：靴子
      'gear.amulet': null,                 // 装备：项链
      'gear.ring': null,                   // 装备：戒指
    },
  };

  const KIND_NAMES = { unit: '角色', enemy: '敌人', skill: '技能', card: '技能卡', gear: '装备' };

  DAO.Art = {
    /** 这个 id 在清单里登记过吗（值可以是 null 占位） */
    known(id) { return !!id && Object.prototype.hasOwnProperty.call(DAO.CONFIG.assets.images, id); },
    /** 图片路径；没有图（占位 / 没登记 / 这个用途没图）返回 null，调用方退回文字 / 色块 */
    path(id, use) {
      if (!id) return null;
      const A = DAO.CONFIG.assets;
      const e = A.images[id];
      if (!e) return null;
      const p = typeof e === 'string' ? e : (use && e[use]) || e.default || null;
      return p ? A.root + p : null;
    },
    /** id 的种类（unit / enemy / skill / card / gear），界面选色块颜色用 */
    kind(id) { return id ? String(id).split('.')[0] : null; },
    kindName(id) { return KIND_NAMES[this.kind(id)] || ''; },
    ids() { return Object.keys(DAO.CONFIG.assets.images); },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
