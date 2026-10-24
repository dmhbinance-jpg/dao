/**
 * Node 入口：按依赖顺序加载与浏览器相同的脚本，返回 globalThis.DAO。
 * 顺序必须与 index.html 中的 <script> 一致。
 * 默认读 src/config/tuning.js（和游戏同一套数值）；命令行加 --defaults（或环境变量 DAO_DEFAULTS=1）只用默认值。
 * --defaults 会从 process.argv 里去掉，脚本自己的位置参数不受影响。
 */
'use strict';
const flagAt = process.argv.indexOf('--defaults');
const DEFAULTS_ONLY = flagAt >= 0 || process.env.DAO_DEFAULTS === '1';
if (flagAt >= 0) process.argv.splice(flagAt, 1);
const FILES = [
  './core/tags.js',
  './core/rng.js',
  './config/coef.js',
  './config/skills.js',
  './config/talents.js',
  './config/characters.js',
  './config/game.js',
  './config/assets.js',
  DEFAULTS_ONLY ? null : './config/tuning.js',
  './config/apply-tuning.js',
  './core/events.js',
  './core/model.js',
  './battle/targeting.js',
  './battle/damage.js',
  './battle/engine.js',
  './battle/replay.js',
  './battle/log.js',
  './battle/simulate.js',
  './game/clock.js',
  './game/game.js',
];
for (const f of FILES) if (f) require(f);
module.exports = globalThis.DAO;
