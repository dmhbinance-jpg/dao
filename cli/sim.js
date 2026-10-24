#!/usr/bin/env node
/**
 * 批量模拟：不同种子跑 N 场。
 *   node cli/sim.js [N] [seedBase]
 * 输出胜率、平均回合、伤害占比、触发次数。
 */
'use strict';
const DAO = require('../src/node.js');
const N = Number(process.argv[2] || 500);
const seedBase = Number(process.argv[3] || 1);
const T = DAO.CONFIG.defaultTeams;
const t0 = Date.now();
const sum = DAO.Sim.batch(T.A, T.B, { runs: N, seedBase, swapSides: true });
console.log(DAO.Sim.report(sum, '默认阵容 A vs B'));
console.log('\n场均触发：' + Object.entries(sum.triggers).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('，'));
console.log(`递归保护拦截：场均 ${sum.recursionBlocked.toFixed(2)} 次`);
console.log(`耗时 ${Date.now() - t0} ms`);
