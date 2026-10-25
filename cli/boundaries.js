#!/usr/bin/env node
/** 模块边界检查：node cli/boundaries.js（规则见 cli/lib/boundaries.js、docs/ARCHITECTURE.md） */
'use strict';
const { check } = require('./lib/boundaries');
const r = check();
for (const w of r.warnings) console.log('⚠️  ' + w);
for (const e of r.errors) console.log('❌ ' + e);
console.log(r.errors.length ? `边界检查：${r.errors.length} 处越界（${r.files.length} 个文件）` : `边界检查：${r.files.length} 个文件，没有越界`);
process.exit(r.errors.length ? 1 : 0);
