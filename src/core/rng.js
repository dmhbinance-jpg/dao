/**
 * 带种子的随机数（mulberry32）。
 * 战斗内唯一的随机来源：暴击判定、弹射目标、随机选目标、触发几率。
 * 同一种子 + 同一阵容 ⇒ 完全相同的战斗，可复盘。
 */
(function (root) {
  'use strict';
  const DAO = (root.DAO = root.DAO || {});

  class RNG {
    constructor(seed) {
      this.seed = seed >>> 0;
      this.state = this.seed || 0x9e3779b9;
      this.calls = 0;
    }
    /** [0,1) */
    next() {
      this.calls++;
      let t = (this.state += 0x6d2b79f5) >>> 0;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    /** 整数 [min, max] */
    int(min, max) {
      return min + Math.floor(this.next() * (max - min + 1));
    }
    /** 浮点 [min, max) */
    range(min, max) {
      return min + this.next() * (max - min);
    }
    chance(p) {
      if (p >= 1) return true;
      if (p <= 0) return false;
      return this.next() < p;
    }
    pick(arr) {
      if (!arr.length) return undefined;
      return arr[Math.floor(this.next() * arr.length)];
    }
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }
    /** 派生子种子（用于把一个主种子拆成多场） */
    fork() {
      return new RNG(Math.floor(this.next() * 0xffffffff));
    }
  }

  /** 字符串 → 32 位种子 */
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }

  DAO.RNG = RNG;
  DAO.hashSeed = hashSeed;
})(typeof globalThis !== 'undefined' ? globalThis : this);
