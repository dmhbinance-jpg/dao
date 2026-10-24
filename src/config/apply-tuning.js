/**
 * 把 DAO.TUNING（tuning.js）合并进 DAO.CONFIG，并提供配置路径工具（配置网站和服务端共用）。
 * 加载顺序：默认配置（coef / skills / talents / characters / game / assets）→ tuning.js → 本文件。
 *
 *   DAO.Tuning.flatten(obj)        → [{ path, value }]   所有叶子（数字 / 字符串 / 布尔 / null），数组按下标展开
 *   DAO.Tuning.get(obj, path) / set(obj, path, value)
 *   DAO.Tuning.apply(tuning, cfg)  → { applied: [path], errors: [{ path, reason }] }   只改已存在、类型相同的叶子
 *   DAO.Tuning.status              本次加载的合并结果（applied、errors、skipped=是否忽略了 tuning.js）
 * 路径格式：段之间用「.」；段里含「.」的写成 ["unit.sword"]；数组下标写数字。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  function parse(path) {
    const out = [];
    const re = /\["((?:[^"\\]|\\.)*)"\]|([^.[\]]+)/g;
    let m;
    while ((m = re.exec(path))) out.push(m[1] != null ? m[1].replace(/\\"/g, '"') : m[2]);
    return out;
  }
  function join(segs) {
    return segs.map((s, i) => (/[.[\]"]/.test(s) ? `["${String(s).replace(/"/g, '\\"')}"]` : (i ? '.' : '') + s)).join('').replace(/^\./, '');
  }
  const isLeaf = (v) => v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';

  function flatten(obj, prefix, out) {
    out = out || [];
    prefix = prefix || [];
    if (isLeaf(obj)) { out.push({ path: join(prefix), value: obj }); return out; }
    if (!obj || typeof obj !== 'object') return out;   // 函数等跳过
    for (const k of Object.keys(obj)) flatten(obj[k], prefix.concat(String(k)), out);
    return out;
  }
  function get(obj, path) {
    let cur = obj;
    for (const s of parse(path)) { if (cur == null || typeof cur !== 'object' || !(s in cur)) return undefined; cur = cur[s]; }
    return cur;
  }
  function set(obj, path, value) {
    const segs = parse(path);
    let cur = obj;
    for (let i = 0; i < segs.length - 1; i++) { cur = cur[segs[i]]; if (cur == null || typeof cur !== 'object') return false; }
    cur[segs[segs.length - 1]] = value;
    return true;
  }
  /** 类型是否相容：默认值是 null（占位资源）时可以填字符串 */
  function sameType(def, v) {
    if (def === null) return v === null || typeof v === 'string';
    if (typeof def === 'string' && v === null) return false;
    return typeof def === typeof v;
  }
  function apply(tuning, cfg) {
    const res = { applied: [], errors: [] };
    for (const [path, v] of Object.entries(tuning || {})) {
      const def = get(cfg, path);
      if (def === undefined) { res.errors.push({ path, reason: '没有这个配置项' }); continue; }
      if (!isLeaf(def)) { res.errors.push({ path, reason: '不是单个数值' }); continue; }
      if (!sameType(def, v)) { res.errors.push({ path, reason: `类型不对（默认是 ${def === null ? 'null' : typeof def}）` }); continue; }
      if (typeof v === 'number' && !isFinite(v)) { res.errors.push({ path, reason: '不是有效数字' }); continue; }
      set(cfg, path, v);
      res.applied.push(path);
    }
    return res;
  }

  DAO.Tuning = { parse, join, flatten, get, set, apply, isLeaf, sameType };
  const skipped = !DAO.TUNING;
  DAO.Tuning.status = Object.assign({ skipped }, apply(DAO.TUNING || {}, DAO.CONFIG));
  if (DAO.Tuning.status.errors.length && root.console) root.console.warn('[tuning] 有改动没有生效：', DAO.Tuning.status.errors);
  /** 一句话说明本次用的数值来源（命令行报告头用） */
  DAO.Tuning.describe = function () {
    const s = DAO.Tuning.status;
    if (s.skipped) return '只用默认值（忽略了 tuning.js）';
    if (!s.applied.length) return '默认值（tuning.js 没有改动）';
    return `默认值 + tuning.js 的 ${s.applied.length} 项改动：${s.applied.map((p) => p + ' = ' + JSON.stringify(DAO.Tuning.get(DAO.CONFIG, p))).join('，')}`;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
