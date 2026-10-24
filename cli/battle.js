#!/usr/bin/env node
/**
 * 命令行跑一场，打印完整日志。
 *   node cli/battle.js [seed]
 */
'use strict';
const DAO = require('../src/node.js');
const seed = Number(process.argv[2] || 1);
const T = DAO.CONFIG.defaultTeams;
const r = DAO.Sim.runOne(T.A, T.B, seed, true);
console.log(DAO.BattleLog.formatLog(r.log, r.units));
console.log(`\n胜者 ${r.winner}，${r.rounds} 回合，种子 ${seed}`);
