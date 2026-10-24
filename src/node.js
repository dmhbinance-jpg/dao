/**
 * Node 入口：按依赖顺序加载与浏览器相同的脚本，返回 globalThis.DAO。
 * 顺序必须与 index.html 中的 <script> 一致。
 */
'use strict';
const FILES = [
  './core/tags.js',
  './core/rng.js',
  './config/coef.js',
  './config/skills.js',
  './config/talents.js',
  './config/characters.js',
  './core/events.js',
  './core/model.js',
  './battle/targeting.js',
  './battle/damage.js',
  './battle/engine.js',
  './battle/log.js',
  './battle/simulate.js',
];
for (const f of FILES) require(f);
module.exports = globalThis.DAO;
