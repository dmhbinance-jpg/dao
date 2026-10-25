/**
 * 游戏模块 · save（存档位部分）。存档位（阶段 3.7）：3 个存档位、自动备份、迁移前的原始存档、老存档导入。
 * 对外：DAO.SaveSlots = { create, browserStorage, memoryStorage }；create() 返回 read / write / list / backups / restore / importText / remove 等。
 * 读写：整份存档（按存档位存取字符串）和 savedAt；不改存档里其他模块的字段。
 *
 * 规则（存档保护）：
 *  - 永远不清档：读不出来（损坏、版本比代码新、迁移出错）的存档位显示错误，原始数据原样留着，不当成「空」，也不会被自动覆盖。
 *    只有玩家明确操作（新游戏确认覆盖、导入、从备份恢复、删除确认）才会替换它，替换前先把旧数据放进备份。
 *  - 迁移前先把原始存档原样存一份（dao.slot.N.orig，按版本号区分，保留最近 CONFIG.saves.originals 份）。
 *  - 自动备份：保存时距上一份备份超过 backupEveryMs 就再存一份（手动保存、回标题页时总会存），轮换保留最近 backups 份。
 *  - 老的单一存档（dao.save，更早的 dao.s0.save）第一次打开时复制进第 1 个存档位，老键原样保留。
 *
 * 只管「键 → 字符串」的存取，不碰 DOM；浏览器里传 localStorage 的包装，命令行检查传内存实现。
 * 写硬盘（saves/ 目录）在 src/ui/save-disk.js。
 *
 * 键：
 *   dao.slot.N        当前存档（JSON 字符串，原样保存）
 *   dao.slot.N.bak    自动备份 [{ at, v, reason, data }]（新的在前）
 *   dao.slot.N.orig   迁移前的原始存档 [{ at, v, data }]（新的在前，同一版本只留最新一份）
 *   dao.slot.N.lock   { tab, at } 最近写这个存档位的游戏页面
 *   dao.slots.meta    { last: 最近一次玩的存档位, legacyImported: true }
 */
(function (root) {
  'use strict';
  const DAO = root.DAO;

  const LEGACY_KEYS = ['dao.save', 'dao.s0.save'];
  const ERROR_TEXT = {
    corrupt: '存档数据损坏（不是有效的 JSON）',
    invalid: '存档数据不完整',
    newer: '存档来自更新版本的游戏',
    migrate: '旧版本存档迁移失败',
  };

  /** localStorage 的包装（存取失败不抛错，返回 false / null） */
  function browserStorage(ls) {
    return {
      get(k) { try { return ls.getItem(k); } catch (e) { return null; } },
      set(k, v) { try { ls.setItem(k, v); return true; } catch (e) { return false; } },
      del(k) { try { ls.removeItem(k); return true; } catch (e) { return false; } },
    };
  }
  /** 内存实现（命令行检查用） */
  function memoryStorage(init) {
    const m = new Map(Object.entries(init || {}));
    return {
      get: (k) => (m.has(k) ? m.get(k) : null),
      set: (k, v) => { m.set(k, String(v)); return true; },
      del: (k) => { m.delete(k); return true; },
      dump: () => Object.fromEntries(m),
    };
  }

  /**
   * @param opts { storage, migrate(obj, now) → save|null, version, cfg（CONFIG.saves） }
   */
  function create(opts) {
    const st = opts.storage;
    const C = () => opts.cfg || DAO.CONFIG.saves;
    const version = () => (opts.version != null ? opts.version : DAO.CONFIG.game.saveVersion);
    const migrate = opts.migrate || ((s, now) => DAO.Game.migrate(s, now));
    const key = (n) => 'dao.slot.' + n;
    const written = {};   // 本页最近一次写进各存档位的字符串（没被别的页面改过就不用再检查）
    const slotIds = () => Array.from({ length: C().slots }, (_, i) => i + 1);

    function getJSON(k, d) { const s = st.get(k); if (s == null) return d; try { return JSON.parse(s); } catch (e) { return d; } }
    function setJSON(k, v) { return st.set(k, JSON.stringify(v)); }
    function meta() { return getJSON('dao.slots.meta', {}) || {}; }
    function setMeta(patch) { setJSON('dao.slots.meta', Object.assign(meta(), patch)); }

    /**
     * 解析一份原始存档字符串（不写任何东西）。
     * @returns { status: 'empty'|'ok'|'error', save?, raw, v?, migratedFrom?, error?, errorText? }
     */
    function parse(raw, now) {
      if (raw == null || raw === '') return { status: 'empty', raw: null };
      let obj;
      try { obj = JSON.parse(raw); } catch (e) { return { status: 'error', raw, error: 'corrupt', errorText: ERROR_TEXT.corrupt }; }
      if (!obj || typeof obj !== 'object') return { status: 'error', raw, error: 'corrupt', errorText: ERROR_TEXT.corrupt };
      const v = obj.v;
      if (typeof v === 'number' && v > version()) return { status: 'error', raw, v, error: 'newer', errorText: `${ERROR_TEXT.newer}（v${v}，当前 v${version()}）` };
      let s = null, detail = '';
      try { s = migrate(obj, now); } catch (e) { detail = String((e && e.message) || e); }
      if (!s) {
        const err = v === version() ? 'invalid' : 'migrate';
        return { status: 'error', raw, v, error: err, errorText: ERROR_TEXT[err] + (v != null && v !== version() ? `（v${v} → v${version()}）` : '') + (detail ? '：' + detail : '') };
      }
      return { status: 'ok', raw, v, save: s, migratedFrom: v !== version() ? v : null };
    }

    /** 迁移前的原始存档：按版本号区分，同一版本只留最新一份，总共留最近 originals 份 */
    function keepOriginal(n, raw, v, now) {
      const list = getJSON(key(n) + '.orig', []).filter((o) => !(o.v === v && o.data === raw) && o.v !== v);
      list.unshift({ at: now, v, data: raw });
      setJSON(key(n) + '.orig', list.slice(0, Math.max(1, C().originals)));
    }

    /**
     * 读一个存档位。需要迁移时先把原始存档原样备份，再在内存里迁移（存档位里还是原始数据，等游戏保存时才写成新版本）。
     */
    function read(n, now) {
      importLegacy(now);
      const raw = st.get(key(n));
      const r = parse(raw, now);
      r.slot = n;
      if (r.status !== 'empty' && r.v !== version() && r.v != null) keepOriginal(n, raw, r.v, now);
      return r;
    }

    /** 自动备份（新的在前，留最近 backups 份）。force：不管间隔都存（手动保存、回标题页、覆盖前） */
    function backup(n, raw, now, reason, force) {
      if (raw == null) return false;
      const list = getJSON(key(n) + '.bak', []);
      if (!force && list.length && now - list[0].at < C().backupEveryMs) return false;
      if (list.length && list[0].data === raw) return false;
      let v = null;
      try { v = JSON.parse(raw).v; } catch (e) { /* 损坏的也照样备份 */ }
      list.unshift({ at: now, v, reason: reason || 'auto', data: raw });
      setJSON(key(n) + '.bak', list.slice(0, Math.max(1, C().backups)));
      return true;
    }

    /**
     * 保存游戏。存档位当前是读不出来的数据时拒绝（不会自动覆盖），除非 opts.force（玩家确认过）——那时旧数据先进备份。
     * @param opts { reason: 'auto'|'manual'|'title'|'new'|'import'|'restore', force }
     * @returns { ok, error?, raw? }
     */
    function write(n, save, now, o) {
      o = o || {};
      const reason = o.reason || 'auto';
      const prev = st.get(key(n));
      if (prev != null && !o.force && prev !== written[n]) {
        const p = parse(prev, now);
        if (p.status === 'error') return { ok: false, error: 'protected' };
      }
      save.savedAt = now;
      const raw = JSON.stringify(save);
      // 覆盖别的存档（新游戏、导入、恢复）前：旧数据先进备份
      const replacing = reason === 'new' || reason === 'import' || reason === 'restore' || reason === 'tool';
      if (prev != null && (replacing || o.force)) backup(n, prev, now, 'before-' + reason, true);
      if (!st.set(key(n), raw)) return { ok: false, error: 'storage' };
      written[n] = raw;
      const backedUp = !replacing ? backup(n, raw, now, reason, reason === 'manual' || reason === 'title' || reason === 'migrate') : false;
      setMeta({ last: n });
      return { ok: true, raw, backedUp };
    }

    /** 直接写一份原始字符串（从硬盘同步来的），不改内容；旧数据先进备份 */
    function writeRaw(n, raw, now, reason) {
      const prev = st.get(key(n));
      if (prev === raw) return true;
      if (prev != null) backup(n, prev, now, 'before-' + (reason || 'sync'), true);
      return st.set(key(n), raw);
    }

    /** 删除（玩家二次确认后）：先把当前数据放进备份，存档位变空，备份留着可以恢复 */
    function remove(n, now) {
      const prev = st.get(key(n));
      if (prev != null) backup(n, prev, now, 'before-delete', true);
      st.del(key(n));
      const m = meta();
      if (m.last === n) setMeta({ last: null });
      return true;
    }

    function backups(n) { return getJSON(key(n) + '.bak', []); }
    function originals(n) { return getJSON(key(n) + '.orig', []); }
    /** 从备份恢复：当前数据先进备份，再把那份备份原样放回存档位 */
    function restore(n, idx, now) {
      const b = backups(n)[idx];
      if (!b) return { ok: false, error: 'nobackup' };
      const p = parse(b.data, now);
      if (p.status !== 'ok') return { ok: false, error: p.error, errorText: p.errorText };
      const prev = st.get(key(n));
      if (prev != null) backup(n, prev, now, 'before-restore', true);
      st.set(key(n), b.data);
      setMeta({ last: n });
      return { ok: true };
    }
    /** 从迁移前的原始存档恢复（例如修好迁移代码之后） */
    function restoreOriginal(n, idx, now) {
      const o = originals(n)[idx];
      if (!o) return { ok: false, error: 'nobackup' };
      const prev = st.get(key(n));
      if (prev != null && prev !== o.data) backup(n, prev, now, 'before-restore', true);
      st.set(key(n), o.data);
      return { ok: true };
    }

    /**
     * 导入：文件里的文本放进存档位（自动迁移旧版本）。读不出来的不导入。
     * @returns { ok, save?, error?, errorText? }
     */
    function importText(n, text, now) {
      const p = parse(text, now);
      if (p.status !== 'ok') return { ok: false, error: p.error || 'corrupt', errorText: p.errorText || ERROR_TEXT.corrupt };
      if (p.migratedFrom != null) keepOriginal(n, text, p.migratedFrom, now);
      const w = write(n, p.save, now, { reason: 'import', force: true });
      return w.ok ? { ok: true, save: p.save, migratedFrom: p.migratedFrom } : w;
    }
    function rawOf(n) { return st.get(key(n)); }

    /** 老的单一存档第一次打开时复制进第 1 个存档位（第 1 位已有数据时不动）；老键保留 */
    function importLegacy(now) {
      const m = meta();
      if (m.legacyImported) return null;
      let found = null;
      for (const k of LEGACY_KEYS) { const raw = st.get(k); if (raw != null) { found = { key: k, raw }; break; } }
      setMeta({ legacyImported: true });
      if (!found) return null;
      if (st.get(key(1)) != null) return null;
      st.set(key(1), found.raw);
      setMeta({ last: 1, legacyFrom: found.key });
      return found.key;
    }

    /** 存档位的摘要（标题页 / 存档列表显示） */
    function summary(s) {
      const G = DAO.Game;
      const st0 = G.starter(s);
      const best = G.bestClearedStage(s);
      return {
        role: st0.role, roleName: (DAO.ROLE_NAMES || {})[st0.role] || st0.role, name: st0.name, level: st0.level,
        best: best ? { id: best.id, name: best.name } : null,
        lineup: s.lineup.length, slots: G.slots(s), roster: s.roster.length,
        gold: s.gold, savedAt: s.savedAt || null,
      };
    }
    function list(now) {
      importLegacy(now);
      return slotIds().map((n) => {
        const raw = st.get(key(n));
        const p = parse(raw, now);
        const out = { slot: n, status: p.status, v: p.v, migratedFrom: p.migratedFrom, error: p.error, errorText: p.errorText, backups: backups(n).length, originals: originals(n).length };
        if (p.status === 'ok') { try { out.info = summary(p.save); } catch (e) { out.info = null; } }
        return out;
      });
    }
    function lastSlot(now) {
      const m = meta();
      const ok = (n) => n && n <= C().slots && parse(st.get(key(n)), now).status === 'ok';
      if (ok(m.last)) return m.last;
      // 没记录（例如清了浏览器数据、存档是从硬盘读回来的）：取最后保存时间最新的那个
      let best = null, bestAt = -1;
      for (const n of slotIds()) {
        const p = parse(st.get(key(n)), now);
        if (p.status === 'ok' && (p.save.savedAt || 0) > bestAt) { best = n; bestAt = p.save.savedAt || 0; }
      }
      return best;
    }
    function setLast(n) { setMeta({ last: n }); }
    /** 哪个游戏页面在写这个存档位（两个页面开同一个存档位时，后写的那边让出来） */
    function claim(n, tab, now) { setJSON(key(n) + '.lock', { tab, at: now }); }
    function owner(n) { return getJSON(key(n) + '.lock', null); }

    return {
      slotIds, key, parse, read, write, writeRaw, remove, backup, backups, originals, restore, restoreOriginal,
      importText, importLegacy, rawOf, list, summary, lastSlot, setLast, meta, claim, owner,
    };
  }

  DAO.SaveSlots = { create, browserStorage, memoryStorage, LEGACY_KEYS, ERROR_TEXT };
})(typeof globalThis !== 'undefined' ? globalThis : this);
