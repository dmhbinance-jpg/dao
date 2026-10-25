/**
 * 模块边界检查（阶段 3.8）：只用 Node 自带模块，自己做简单的词法分析（去掉注释、字符串、正则），按词法模式查。
 *  1. 分层引用：src/core、src/config → 不引用战斗 / 游戏 / 界面；src/battle → 不引用游戏 / 界面；src/game → 不引用界面。
 *  2. 不碰 DOM：src/core、src/config、src/battle、src/game 里不出现 document / window / localStorage 等。
 *  3. 存档字段归属：src/game 的每个模块只直接写自己负责的存档字段（save.xxx = / += / ++ / delete / .push(...) 等），
 *     别的字段要调负责它的模块的公开函数。角色对象上的 level / exp（roster）、equip（equipment）、card（cards）同样按归属检查。
 *     save.js 的新存档和迁移链负责整份存档的结构，不受限制。
 *  4. 界面不直接改存档：src/ui 里不出现对 save / A.save 开头的写操作。
 *  5. 文件长度：src/ 下单个文件超过 500 行给提示（不算错误）。
 * 用法：node cli/boundaries.js；cli/invariants.js 的 K 组也调它。
 * 局限：按变量名认存档（save、A.save）和角色字段，别名（const r = save.research; r.x = 1）查不到；新写法请保持用 save.字段 直接写。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/** 存档顶层字段 → 负责的模块（docs/ARCHITECTURE.md 有同一张表） */
const FIELD_OWNER = {
  v: 'save', createdAt: 'save', settings: 'save', clock: 'save', stats: 'save', savedAt: 'save',
  gold: 'economy', ore: 'economy',
  roster: 'roster', lineup: 'roster', nextId: 'roster', quota: 'roster',
  progress: 'progress', unlocks: 'progress', seedCounter: 'progress',
  recruit: 'recruit', recruitChoice: 'recruit', pendingRecruit: 'recruit', gachaSeed: 'recruit',
  research: 'research',
  herb: 'economy', stone: 'economy',
  gather: 'production', production: 'production', craftSeed: 'production',
  buildings: 'buildings',
  gearBag: 'equipment', nextGearId: 'equipment',
  bag: 'cards', bagNew: 'cards', cardsInfo: 'cards', rollSeed: 'cards',
  guide: 'guide',
  auto: 'auto', idle: 'auto',
};
/** 可以用动态键写存档的模块（save[k] = …）：economy 按 cost 的键写金币 / 原料 */
const DYNAMIC_WRITERS = ['economy'];
/** 角色对象字段 → 负责的模块 */
const CHAR_FIELD_OWNER = { level: 'roster', exp: 'roster', equip: 'equipment', card: 'cards' };
/** 各层定义的命名空间（DAO.xxx） */
const LAYER_NS = {
  core: ['TAGS', 'TAG_NAMES', 'tagsMatch', 'shapeTag', 'RNG', 'hashSeed', 'EVENTS', 'EventBus', 'Model', 'fmtValue', 'statLabel'],
  config: ['CONFIG', 'TUNING', 'Tuning', 'Art', 'ROLE_NAMES', 'SHAPE_NAMES'],
  battle: ['Battle', 'BattleLog', 'Damage', 'Replay', 'Sim', 'Targeting'],
  game: ['Game', 'GameUtil', 'GameClock', 'SaveSlots'],
  ui: ['UI', 'App', 'SaveDisk'],
};
/** 每层不许引用的层 */
const FORBIDDEN = { core: ['battle', 'game', 'ui'], config: ['battle', 'game', 'ui'], battle: ['game', 'ui'], game: ['ui'], ui: [] };
const DOM = new Set(['document', 'window', 'localStorage', 'sessionStorage', 'navigator', 'location', 'fetch', 'XMLHttpRequest', 'HTMLElement', 'alert', 'confirm', 'requestAnimationFrame']);
const MUTATORS = new Set(['push', 'splice', 'pop', 'shift', 'unshift', 'sort', 'reverse', 'fill', 'copyWithin']);
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '||=', '&&=', '??=', '<<=', '>>=', '>>>=', '|=', '&=', '^=']);

/** 简单词法分析：返回 [{ t: 'id'|'p'|'num'|'str', v, line }]（注释、字符串、模板、正则内容都不进标识符） */
function tokenize(src) {
  const out = [];
  let i = 0, line = 1;
  const n = src.length;
  const isIdStart = (c) => /[A-Za-z_$\u0080-￿]/.test(c);
  const isId = (c) => /[A-Za-z0-9_$\u0080-￿]/.test(c);
  const PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '||=', '&&=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '|=', '&=', '^=', '**', '<<', '>>'];
  const regexAllowed = () => {
    const last = out[out.length - 1];
    if (!last) return true;
    if (last.t === 'num' || last.t === 'str') return false;
    if (last.t === 'id') return ['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await'].includes(last.v);
    return ![')', ']', '}'].includes(last.v);
  };
  function skipString(q) {
    i++;
    while (i < n && src[i] !== q) { if (src[i] === '\\') i++; else if (src[i] === '\n') line++; i++; }
    i++;
  }
  function skipTemplate() {
    i++;
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '\n') line++;
      if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        // 模板里的表达式照常分词
        let depth = 1;
        const start = out.length;
        while (i < n && depth > 0) {
          const before = i;
          step(true);
          const last = out[out.length - 1];
          if (out.length > start && last && last.t === 'p') { if (last.v === '{') depth++; else if (last.v === '}') depth--; }
          if (i === before) i++;
        }
        if (out.length && out[out.length - 1].v === '}') out.pop();
        continue;
      }
      i++;
    }
    i++;
    out.push({ t: 'str', v: '`', line });
  }
  function step() {
    const c = src[i];
    if (c === '\n') { line++; i++; return; }
    if (/\s/.test(c)) { i++; return; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; return; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; return; }
    if (c === '"' || c === "'") { const l = line; skipString(c); out.push({ t: 'str', v: c, line: l }); return; }
    if (c === '`') { skipTemplate(); return; }
    if (c === '/' && regexAllowed()) {
      i++;
      let cls = false;
      while (i < n) { const d = src[i]; if (d === '\\') { i += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; else if (d === '\n') break; i++; }
      i++;
      while (i < n && /[a-z]/.test(src[i])) i++;
      out.push({ t: 'str', v: '/re/', line });
      return;
    }
    if (isIdStart(c)) { let j = i; while (j < n && isId(src[j])) j++; out.push({ t: 'id', v: src.slice(i, j), line }); i = j; return; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) { let j = i; while (j < n && /[0-9A-Za-z_.]/.test(src[j])) j++; out.push({ t: 'num', v: src.slice(i, j), line }); i = j; return; }
    for (const p of PUNCT) if (src.startsWith(p, i)) { out.push({ t: 'p', v: p, line }); i += p.length; return; }
    out.push({ t: 'p', v: c, line });
    i++;
  }
  while (i < n) step();
  return out;
}

/**
 * 找写操作：根是 rootTest(toks, k) 认出的变量（返回根占几个词），之后的 .a / [..] 链。
 * @returns [{ field（第一个属性名，[] 访问时为 null）, line, chain }]
 */
function findWrites(toks, rootLen) {
  const res = [];
  for (let k = 0; k < toks.length; k++) {
    const len = rootLen(toks, k);
    if (!len) continue;
    if (k > 0 && (toks[k - 1].v === '.' || toks[k - 1].v === '?.')) continue;
    let j = k + len;
    const chain = [];
    while (j < toks.length) {
      if ((toks[j].v === '.' || toks[j].v === '?.') && toks[j + 1] && toks[j + 1].t === 'id') { chain.push(toks[j + 1].v); j += 2; continue; }
      if (toks[j].v === '[') {
        let d = 1, m = j + 1;
        while (m < toks.length && d) { if (toks[m].v === '[') d++; else if (toks[m].v === ']') d--; m++; }
        chain.push('[]'); j = m; continue;
      }
      break;
    }
    if (!chain.length) continue;
    const next = toks[j], prev = toks[k - 1];
    let write = false;
    if (next && next.t === 'p' && (ASSIGN.has(next.v) || next.v === '++' || next.v === '--')) write = true;
    if (prev && (prev.v === 'delete' || prev.v === '++' || prev.v === '--')) write = true;
    if (next && next.v === '(' && chain.length >= 2 && MUTATORS.has(chain[chain.length - 1])) write = true;
    if (write) res.push({ field: chain[0] === '[]' ? null : chain[0], line: toks[k].line, chain: chain.join('.') });
  }
  return res;
}

function layerOf(rel) { const m = /^src\/(core|config|battle|game|ui)\//.exec(rel); return m ? m[1] : null; }
function moduleOf(rel) { const m = /^src\/game\/([\w-]+)\.js$/.exec(rel); return m ? m[1].replace(/-slots$/, '') : null; }

function listFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** 跑全部检查。@returns { errors: [文字], warnings: [文字], files } */
function check(root) {
  root = root || ROOT;
  const errors = [], warnings = [];
  const nsLayer = {};
  for (const [layer, list] of Object.entries(LAYER_NS)) for (const ns of list) nsLayer[ns] = layer;
  const files = listFiles(path.join(root, 'src')).map((f) => path.relative(root, f).split(path.sep).join('/')).filter((f) => f !== 'src/node.js');
  for (const rel of files) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    const layer = layerOf(rel);
    if (!layer) continue;
    const toks = tokenize(src);
    const lines = src.split('\n').length;
    if (lines > 500) warnings.push(`${rel}：${lines} 行（建议不超过约 500 行）`);
    // 1. 分层引用
    for (let k = 0; k + 2 < toks.length; k++) {
      if (toks[k].v === 'DAO' && toks[k + 1].v === '.' && toks[k + 2].t === 'id') {
        const ns = toks[k + 2].v, nl = nsLayer[ns];
        if (nl && FORBIDDEN[layer].includes(nl) && toks[k - 1] && toks[k - 1].v !== '.') errors.push(`${rel}:${toks[k].line} ${layer} 层引用了 ${nl} 层的 DAO.${ns}`);
      }
    }
    // 2. 不碰 DOM
    if (layer !== 'ui') {
      for (let k = 0; k < toks.length; k++) {
        const t = toks[k];
        if (t.t === 'id' && DOM.has(t.v) && !(toks[k - 1] && (toks[k - 1].v === '.' || toks[k - 1].v === '?.')) && !(toks[k + 1] && toks[k + 1].v === ':')) errors.push(`${rel}:${t.line} ${layer} 层用到了 DOM / 浏览器对象 ${t.v}`);
      }
    }
    // 3. 存档字段归属（游戏模块）
    const mod = layer === 'game' ? moduleOf(rel) : null;
    if (mod && !['save', 'common', 'clock'].includes(mod)) {
      for (const w of findWrites(toks, (ts, k) => (ts[k].t === 'id' && ts[k].v === 'save' ? 1 : 0))) {
        if (w.field === null && DYNAMIC_WRITERS.includes(mod)) continue;   // economy 按键名写钱包（save[k]）
        const owner = FIELD_OWNER[w.field];
        if (!owner) errors.push(`${rel}:${w.line} 写了没登记归属的存档字段 save.${w.chain}`);
        else if (owner !== mod) errors.push(`${rel}:${w.line} ${mod} 模块直接改了 ${owner} 模块负责的 save.${w.chain}（改调 ${owner} 的公开函数）`);
      }
      // 角色对象字段（按属性名认）
      for (const w of findWrites(toks, (ts, k) => (ts[k].t === 'id' && ts[k].v !== 'save' && ts[k].v !== 'this' ? 1 : 0))) {
        const owner = CHAR_FIELD_OWNER[w.field];
        if (owner && owner !== mod && w.chain.split('.').length <= 2) errors.push(`${rel}:${w.line} ${mod} 模块直接改了角色的 ${w.field}（归 ${owner} 模块；写法：${w.chain}）`);
      }
    }
    // 4. 界面不直接改存档
    if (layer === 'ui') {
      const writes = findWrites(toks, (ts, k) => {
        if (ts[k].t === 'id' && ts[k].v === 'save' && !(ts[k - 1] && ts[k - 1].v === '.')) return 1;
        if (ts[k].v === 'A' && ts[k + 1] && ts[k + 1].v === '.' && ts[k + 2] && ts[k + 2].v === 'save') return 3;
        return 0;
      });
      for (const w of writes) errors.push(`${rel}:${w.line} 界面直接改了存档 save.${w.chain}（改调 DAO.Game 的公开函数）`);
    }
  }
  return { errors, warnings, files };
}

module.exports = { check, tokenize, findWrites, FIELD_OWNER, CHAR_FIELD_OWNER, LAYER_NS, FORBIDDEN };
