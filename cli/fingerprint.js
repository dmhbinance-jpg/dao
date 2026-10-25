#!/usr/bin/env node
/**
 * 整局模拟指纹（重构对照用）：同一组种子跑整局——标准 / 全自动玩家 × 剑修 / 法修 × N 人，外加单人模式——
 * 每局的完整结果（含最终存档）做 sha1。重构前后各跑一次，逐行比较就知道结果是不是完全一致。
 *   node cli/fingerprint.js [N=6] > before.txt   （改代码）  node cli/fingerprint.js [N=6] > after.txt   然后 diff
 *   加 --defaults 只用默认值（忽略 tuning.js）
 */
'use strict';
require('../src/node.js');
const P = require('./lib/play.js');
const crypto = require('crypto');
const N = Number(process.argv[2] || 6);
const runs = [];
for (const kind of ['std', 'auto']) for (const role of ['sword', 'mage']) for (let i = 0; i < N; i++) {
  runs.push([`${kind}/${role}/${i}`, () => P.simulate(role, i, { kind, seeds: P.SEEDS.s23, snapAt: kind === 'std' && i < 2 ? ['3-1'] : [] })]);
}
for (const role of ['sword', 'mage']) for (let i = 0; i < 2; i++) runs.push([`solo/${role}/${i}`, () => P.simulate(role, i, { solo: true, maxMinutes: 90, seeds: P.SEEDS.s1 })]);
for (const [name, fn] of runs) {
  const r = fn();
  const j = JSON.stringify(r);
  console.log(`${name}\t${crypto.createHash('sha1').update(j).digest('hex')}\t${r.done ? '打完' : '未打完'}\t${Math.round(r.total / 60000)} 分钟`);
}
