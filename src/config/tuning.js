/**
 * 调参覆盖：只放改过的项（配置网站 tools/ 写入这个文件；默认值在 src/config/*.js，不要在这里改默认值）。
 * 键是 DAO.CONFIG 里的路径（数组下标照写，键里带点的用 ["..."]），值是新值。删掉一项 = 恢复默认。
 * 在默认配置之后加载，由 apply-tuning.js 合并进 DAO.CONFIG。命令行加 --defaults 可以忽略这个文件。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});
  DAO.TUNING = {
    "game.forge.recipes.weapon.baseSec": 10,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
