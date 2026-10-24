#!/usr/bin/env node
/**
 * 本地服务（只用 Node 自带模块，不装依赖）：
 *   node tools/server.js [端口=8765]
 *   http://localhost:8765/        游戏（和双击 index.html 一样）
 *   http://localhost:8765/tools/  配置网站（调参 + 存档工具）
 *
 * 接口（只监听 127.0.0.1）：
 *   GET  /api/tuning   → { tuning, errors }           当前 tuning.js 的内容
 *   PUT  /api/tuning   ← { tuning }  → { ok, errors }  校验后写回 src/config/tuning.js（只写改过的项）
 * 静态文件不缓存，改完配置刷新游戏页面就生效。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const TUNING_FILE = path.join(ROOT, 'src', 'config', 'tuning.js');
const PORT = Number(process.argv[2] || process.env.PORT || 8765);

// 默认值（不读 tuning.js）+ 校验规则
process.env.DAO_DEFAULTS = '1';
const DAO = require(path.join(ROOT, 'src', 'node.js'));
require(path.join(__dirname, 'validate.js'));
const DEFAULTS = JSON.parse(JSON.stringify(DAO.CONFIG));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

/** 读 tuning.js：在沙箱里执行，取 DAO.TUNING */
function readTuning() {
  if (!fs.existsSync(TUNING_FILE)) return {};
  const ctx = { DAO: {} };
  ctx.globalThis = ctx;
  vm.runInNewContext(fs.readFileSync(TUNING_FILE, 'utf8'), ctx, { filename: 'tuning.js', timeout: 1000 });
  return ctx.DAO.TUNING || {};
}

/** 校验整份改动；返回 [{ path, reason }] */
function check(tuning) {
  const errs = [];
  if (!tuning || typeof tuning !== 'object' || Array.isArray(tuning)) return [{ path: '', reason: '格式不对' }];
  for (const [p, v] of Object.entries(tuning)) {
    const def = DAO.Tuning.get(DEFAULTS, p);
    if (def === undefined || !DAO.Tuning.isLeaf(def)) { errs.push({ path: p, reason: '没有这个配置项' }); continue; }
    const e = DAO.ConfigRules.validate(p, v, def, DEFAULTS);
    if (e) errs.push({ path: p, reason: e });
  }
  return errs;
}

function writeTuning(tuning) {
  // 和默认值相同的项不写；按路径排序，方便看 diff
  const keys = Object.keys(tuning).filter((p) => DAO.Tuning.get(DEFAULTS, p) !== tuning[p]).sort();
  const body = keys.length ? '{\n' + keys.map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(tuning[k])},`).join('\n') + '\n  }' : '{}';
  const src = `/**
 * 调参覆盖：只放改过的项（配置网站 tools/ 写入这个文件；默认值在 src/config/*.js，不要在这里改默认值）。
 * 键是 DAO.CONFIG 里的路径（数组下标照写，键里带点的用 ["..."]），值是新值。删掉一项 = 恢复默认。
 * 在默认配置之后加载，由 apply-tuning.js 合并进 DAO.CONFIG。命令行加 --defaults 可以忽略这个文件。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});
  DAO.TUNING = ${body};
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
  fs.writeFileSync(TUNING_FILE + '.tmp', src);
  fs.renameSync(TUNING_FILE + '.tmp', TUNING_FILE);
  return keys.length;
}

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, TYPES['.json'], JSON.stringify(obj));

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  if (p === '/api/tuning') {
    if (req.method === 'GET') {
      try { const t = readTuning(); return json(res, 200, { tuning: t, errors: check(t) }); } catch (e) { return json(res, 500, { error: 'tuning.js 读不出来：' + e.message }); }
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; if (raw.length > 2e6) req.destroy(); });
      req.on('end', () => {
        let body;
        try { body = JSON.parse(raw); } catch (e) { return json(res, 400, { ok: false, errors: [{ path: '', reason: '不是 JSON' }] }); }
        const errs = check(body.tuning);
        if (errs.length) return json(res, 400, { ok: false, errors: errs });
        const n = writeTuning(body.tuning);
        console.log(`[tuning] 已保存 ${n} 项改动`);
        json(res, 200, { ok: true, count: n });
      });
      return;
    }
    return json(res, 405, { error: '只支持 GET / PUT' });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, TYPES['.txt'], '405');
  if (p === '/') p = '/index.html';
  if (p.endsWith('/')) p += 'index.html';
  const file = path.resolve(ROOT, '.' + p);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, TYPES['.txt'], '403');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, TYPES['.txt'], '404 ' + p);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`道 · 本地服务已启动\n  游戏：      http://localhost:${PORT}/\n  配置网站：  http://localhost:${PORT}/tools/\n  （Ctrl+C 停止）`);
});
