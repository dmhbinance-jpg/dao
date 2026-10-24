/**
 * 回放驱动 + 渲染器接口（表现层预留）。纯逻辑，不碰 DOM；浏览器和 Node 共用。
 *
 * 战斗先整场算完（Battle.run），回放只是把 result.timeline 按节奏交给渲染器画出来。
 * 播放速度、暂停、跳过只改「什么时候画」，不会碰战斗结果（cli/invariants.js 检查这一条）。
 *
 * ---- 一拍（beat）----
 * 时间线里每个根事件（battleStart / roundStart / action / battleEnd）连同它的所有后代事件是一拍：
 *   { index, root, events: [root, ...后代，按发生顺序], snapshot: 这一拍结束时的状态, ms: 1× 速度下这一拍的时长 }
 *
 * ---- 渲染器接口（Renderer）----
 * 渲染器只读时间线、事件和快照，不改它们，也不调战斗逻辑。现有的文字回放（ui/render-text.js）是第一个实现。
 *   mount(timeline)            建场景：单位静态信息在 timeline.units（含 art 资源 id、技能列表）
 *   beat(beat, { fast })       画一拍；fast=true 表示正在跳过，可以只更新到 beat.snapshot、不做动画
 *   end(timeline)              整场结束（每次回放恰好一次）
 *   destroy()                  可选：被新的回放替换时调用
 * 以后的图片 / 动画渲染器实现同样四个方法即可，可以用 beat.events 里的 t、parent 排自己的动画时间轴，
 * 但必须在 ms / speed 内画完一拍（或者忽略时长，由驱动决定节奏）。
 *
 * ---- 驱动（Replay）----
 *   const r = DAO.Replay.create(timeline, renderer, { speed, clock, onEnd })
 *   r.play() / r.pause() / r.resume() / r.setSpeed(s) / r.skip() / r.stop() / r.state()
 *   clock = { setTimeout(fn, ms), clearTimeout(h) }：默认用全局计时器；命令行检查时传模拟时钟。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  /** 时间线 → 拍 */
  function beats(tl) {
    const P = DAO.CONFIG.playback;
    const out = [];
    const rootOf = {};
    for (const e of tl.events) {
      if (e.parent == null) {
        out.push({ index: out.length, root: e, events: [e], snapshot: tl.snapshots[e.id] || null, ms: P[e.type] || 0 });
        rootOf[e.id] = out[out.length - 1];
      } else {
        const b = rootOf[e.parent];
        if (!b) throw new Error('事件 ' + e.id + ' 的来源 ' + e.parent + ' 不在它之前');
        b.events.push(e);
        rootOf[e.id] = b;
      }
    }
    return out;
  }
  /** 1× 速度下整场的回放时长（毫秒） */
  function totalMs(tl) { return beats(tl).reduce((a, b) => a + b.ms, 0); }

  const realClock = {
    setTimeout: (fn, ms) => root.setTimeout(fn, ms),
    clearTimeout: (h) => root.clearTimeout(h),
  };

  function create(tl, renderer, opts) {
    opts = opts || {};
    const clock = opts.clock || realClock;
    const list = beats(tl);
    let speed = opts.speed || 1;
    let idx = 0, timer = null, playing = false, ended = false;

    renderer.mount(tl);

    function clear() { if (timer != null) clock.clearTimeout(timer); timer = null; }
    function next() {
      timer = null;
      if (!playing) return;
      if (idx >= list.length) { finish(); return; }
      const b = list[idx++];
      renderer.beat(b, { fast: false });
      timer = clock.setTimeout(next, b.ms / speed);
    }
    function finish() {
      if (ended) return;
      ended = true;
      playing = false;
      clear();
      renderer.end(tl);
      if (opts.onEnd) opts.onEnd(tl);
    }
    return {
      play() { if (ended || playing) return; playing = true; next(); },
      pause() { playing = false; clear(); },
      resume() { if (ended || playing) return; playing = true; next(); },
      setSpeed(s) { speed = s > 0 ? s : 1; },
      /** 跳过：剩下的拍立即画完（fast），然后结束 */
      skip() {
        if (ended) return;
        playing = false;
        clear();
        while (idx < list.length) renderer.beat(list[idx++], { fast: true });
        finish();
      },
      /** 停止：不画剩下的、不触发 end（被新回放替换时用） */
      stop() { playing = false; clear(); if (renderer.destroy) renderer.destroy(); },
      state() { return { index: idx, total: list.length, playing, ended, speed }; },
    };
  }

  DAO.Replay = { beats, totalMs, create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
