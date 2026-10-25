/**
 * 存档写硬盘（阶段 3.7）：从本地服务（node tools/server.js）打开游戏时，存档同时写到仓库的 saves/ 目录。
 * 清了浏览器数据、换了端口都能从硬盘读回来。双击 index.html（file://）或别的网址打开时不可用，只用浏览器存档。
 *
 * 接口见 tools/server.js：GET /api/saves、PUT|POST|DELETE /api/saves/N。
 * 浏览器那边的存档位规则在 src/game/save-slots.js；这里只做同步和网络请求。
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;

  const disk = {
    state: 'off',            // off：file:// 等，不写硬盘；checking；ok：本地服务可用；error：连不上本地服务
    files: {},               // 上次读到的硬盘存档 { N: { raw, mtime } }
    source: {},              // 各存档位这次是从哪读来的：'disk' | 'browser'
    lastError: null,
  };
  const timers = {}, lastPut = {}, pendingRaw = {};

  const usable = () => typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && typeof fetch === 'function';
  const cfg = () => DAO.CONFIG.saves;

  function withTimeout(p, ms) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  }

  /** 看本地服务在不在，读硬盘上的存档。不在时 state = 'error'（游戏照常，只用浏览器存档） */
  async function init() {
    if (!usable()) { disk.state = 'off'; return disk; }
    disk.state = 'checking';
    try {
      const r = await withTimeout(fetch('/api/saves', { cache: 'no-store' }), 2500);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || !j.ok) throw new Error('接口返回不对');
      disk.files = j.slots || {};
      disk.state = 'ok';
    } catch (e) {
      disk.state = 'error';
      disk.lastError = String(e.message || e);
    }
    return disk;
  }

  const savedAtOf = (raw) => { try { return JSON.parse(raw).savedAt || 0; } catch (e) { return 0; } };

  /**
   * 打开游戏时把浏览器和硬盘对一遍：
   *  - 浏览器里没有、硬盘上有 → 用硬盘的（写进浏览器）
   *  - 两边都有且都读得出 → 用最后保存时间新的那份（另一份进备份 / 被覆盖前硬盘会自动留备份）
   *  - 浏览器那份读不出来 → 不动它（不自动覆盖），硬盘那份在「备份」里可以选用
   *  - 硬盘上没有、浏览器有 → 写到硬盘
   */
  function sync(slots, now) {
    if (disk.state !== 'ok') return;
    for (const n of slots.slotIds()) {
      const d = disk.files[n] && disk.files[n].raw;
      const b = slots.rawOf(n);
      disk.source[n] = 'browser';
      if (d == null) { if (b != null && slots.parse(b, now).status === 'ok') put(n, b, { now: true }); continue; }
      if (b == null) { slots.writeRaw(n, d, now, 'disk'); disk.source[n] = 'disk'; continue; }
      if (b === d) continue;
      const pb = slots.parse(b, now), pd = slots.parse(d, now);
      if (pb.status !== 'ok') continue;
      if (pd.status === 'ok' && savedAtOf(d) > savedAtOf(b)) { slots.writeRaw(n, d, now, 'disk'); disk.source[n] = 'disk'; }
      else put(n, b, { now: true });
    }
  }
  /** 硬盘上这个存档位和浏览器里不一样、而且读得出来时，返回硬盘那份（给「备份」面板） */
  function altFor(slots, n, now) {
    const d = disk.files[n] && disk.files[n].raw;
    if (d == null || d === slots.rawOf(n)) return null;
    return slots.parse(d, now).status === 'ok' ? { raw: d, savedAt: savedAtOf(d), mtime: disk.files[n].mtime } : null;
  }

  function send(n, raw, backup) {
    lastPut[n] = Date.now();
    const q = backup ? `?backup=1&keep=${cfg().backups}` : '';
    disk.files[n] = { raw, mtime: Date.now() };
    return fetch(`/api/saves/${n}${q}`, { method: 'PUT', body: raw, headers: { 'Content-Type': 'application/json' } })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); disk.lastError = null; return true; })
      .catch((e) => { disk.lastError = String(e.message || e); return false; });
  }
  /**
   * 写硬盘（节流：最短间隔 CONFIG.saves.diskThrottleMs，间隔内的改动合并成最后一份）。
   * @param o { now: 立刻写, backup: 同时在 saves/backups/ 留一份 }
   */
  function put(n, raw, o) {
    o = o || {};
    if (disk.state !== 'ok') return Promise.resolve(false);
    pendingRaw[n] = raw;
    const wait = (lastPut[n] || 0) + cfg().diskThrottleMs - Date.now();
    if (o.now || o.backup || wait <= 0) {
      clearTimeout(timers[n]); timers[n] = null;
      delete pendingRaw[n];
      return send(n, raw, o.backup);
    }
    if (!timers[n]) timers[n] = setTimeout(() => { timers[n] = null; const r = pendingRaw[n]; delete pendingRaw[n]; if (r != null) send(n, r, false); }, wait);
    return Promise.resolve(true);
  }
  /** 离开页面时：用 sendBeacon 把最后一份送出去（页面关掉也能送达） */
  function beacon(n, raw) {
    if (disk.state !== 'ok') return false;
    clearTimeout(timers[n]); timers[n] = null; delete pendingRaw[n];
    disk.files[n] = { raw, mtime: Date.now() };
    try {
      if (navigator.sendBeacon) return navigator.sendBeacon(`/api/saves/${n}`, new Blob([raw], { type: 'text/plain' }));
    } catch (e) { /* 退回普通请求 */ }
    send(n, raw, false);
    return true;
  }
  /** 删除：服务端移到 saves/deleted/，不真删 */
  function remove(n) {
    if (disk.state !== 'ok') return Promise.resolve(false);
    clearTimeout(timers[n]); timers[n] = null; delete pendingRaw[n];
    delete disk.files[n];
    return fetch(`/api/saves/${n}`, { method: 'DELETE' }).then((r) => r.ok).catch(() => false);
  }
  /** 一句话说明存档存在哪 */
  function describe() {
    if (disk.state === 'ok') return '存档同时保存在浏览器和硬盘（仓库 saves/ 目录）';
    if (disk.state === 'error') return '连不上本地服务：存档只保存在浏览器里';
    if (disk.state === 'checking') return '正在检查本地服务…';
    return '存档只保存在浏览器里（从本地服务 node tools/server.js 打开时会同时写到硬盘）';
  }

  DAO.SaveDisk = { disk, init, sync, altFor, put, beacon, remove, describe };
})(typeof globalThis !== 'undefined' ? globalThis : this);
