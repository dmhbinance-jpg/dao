/**
 * UI 小工具：DOM 构造、格式化。只在浏览器里用。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});
  const UI = (DAO.UI = DAO.UI || {});

  /** h('div', {class:'x', onclick:fn}, child, 'text', [children]) */
  UI.h = function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v;
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    };
    children.forEach(add);
    return el;
  };

  /**
   * 资源位：清单里有图（DAO.Art.path）就放图，否则 / 图片加载失败时退回文字色块。
   * opts: { use: 'portrait'|'icon'|..., text: 色块上的字, cls, title }
   */
  UI.artBox = function (id, opts) {
    opts = opts || {};
    const kind = (DAO.Art && DAO.Art.kind(id)) || 'none';
    const fallback = () => UI.h('span', { class: `art-fb art-${kind} ${opts.cls || ''}`, title: opts.title || '' }, opts.text || '');
    const p = DAO.Art && DAO.Art.path(id, opts.use);
    if (!p) return fallback();
    const img = UI.h('img', { class: `art-img ${opts.cls || ''}`, src: p, alt: opts.title || '', title: opts.title || '' });
    img.addEventListener('error', () => img.replaceWith(fallback()));
    return img;
  };

  UI.clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  UI.pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
  UI.num = (x) => Math.round(x).toLocaleString('zh-CN');
  UI.fix = (x, d = 2) => Number(x).toFixed(d);

  /** 数值显示：<1 的按百分比 */
  UI.val = (v, key) => {
    if (key === 'mult') return '×' + v.toFixed(2);
    if (Math.abs(v) < 1) return (v * 100).toFixed(1) + '%';
    if (Math.abs(v) < 10) return v.toFixed(2);
    return String(Math.round(v));
  };

  /** 本地存储，按前缀隔离（V0 用 dao.v0.，阶段 0 用 dao.s0.）；读写失败时静默退回默认值 */
  UI.makeStore = function (prefix) {
    return {
      get(k, d) { try { const s = localStorage.getItem(prefix + k); return s ? JSON.parse(s) : d; } catch (e) { return d; } },
      set(k, v) { try { localStorage.setItem(prefix + k, JSON.stringify(v)); } catch (e) { /* 存储不可用时忽略 */ } },
      del(k) { try { localStorage.removeItem(prefix + k); } catch (e) { /* ignore */ } },
    };
  };
  UI.store = UI.makeStore('dao.v0.');

  UI.ROW_NAME = { front: '前排', back: '后排' };
  UI.TIER_NAME = { stat: '属性型', tag: '标签型', trigger: '触发型' };
  UI.QUALITY_NAME = { white: '白', blue: '蓝', yellow: '黄', orange: '橙' };
})(typeof globalThis !== 'undefined' ? globalThis : this);
