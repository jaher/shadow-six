/**
 * Session asset cache: what a mission load produces that does not depend on the simulation — decoded texture arrays,
 * parsed templates, analysis of the built structures' geometry, baked terrain data — kept between missions so RESTART,
 * quick load and loading a save of the same mission rebuild only the simulation and the scene instances (no fetch,
 * no decode, no re-analysis). Generic: entries are keyed by URL / asset id / content signature, never per feature.
 *
 *   import { sessionCache as cache } from './asset-cache.js';
 *   const arr = await cache.memoAsync('layer:' + url, () => decode(url), { bytes: (v) => v.image.width * …, dispose: (v) => v.dispose() });
 *   cache.retain(texture);              // unloadMission skips disposing it (isRetained)
 *   cache.beginMission('m01');          // tags every entry used from now on; keeps current + last mission
 *
 * Memory: a byte budget (from navigator.deviceMemory: phones keep less) with LRU eviction; entries used by the current
 * or the previous mission are never evicted, the rest go oldest first, and `dispose(value)` runs on eviction (GPU
 * resources are freed then, not when a mission unloads). `clear()` drops everything (Options → clear cached data).
 * @module engine/asset-cache
 */

const MB = 1024 * 1024;

const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
/** Two 32-bit FNV-1a lanes over strings and float bits (a 64-bit signature). */
export function hasher() {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  const mix = (x) => { a = Math.imul(a ^ x, 0x01000193); b = Math.imul(b ^ (x + 0x9e3779b9 | 0), 0x5bd1e995); b ^= b >>> 15; };
  return {
    str(t) { t = String(t ?? ''); for (let i = 0; i < t.length; i++) mix(t.charCodeAt(i)); mix(0xff); },
    num(x) { _f[0] = x; mix(_u[0]); },
    words(w) { for (let i = 0; i < w.length; i++) mix(w[i]); },
    floats(arr) { for (let i = 0; i < arr.length; i++) { _f[0] = arr[i]; mix(_u[0]); } },
    hex() { return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0'); },
  };
}

/** 64-bit hex key of whatever `fill(h)` feeds the hasher (h.str / h.num / h.floats / h.words). */
export function dataKey(fill) { const h = hasher(); fill(h); return h.hex(); }

/** Byte budget for a device: ~1/6 of its RAM, clamped to 256 MB … 1.5 GB (deviceMemory is capped at 8 by browsers). */
export function defaultBudget(nav = typeof navigator !== 'undefined' ? navigator : null) {
  const gb = Number(nav?.deviceMemory) || 4;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(nav?.userAgent || '');
  return Math.round(Math.min(mobile ? 512 : 1536, Math.max(256, (gb * 1024) / 6)) * MB);
}

export class SessionCache {
  /** @param {{budget?: number, keepMissions?: number, now?: () => number}} [o] */
  constructor(o = {}) {
    this.budget = o.budget ?? defaultBudget();
    this.keepMissions = o.keepMissions ?? 2; // current + last
    this.now = o.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.entries = new Map(); // key → {value, bytes, dispose, missions:Set, used}
    this.pending = new Map(); // key → Promise
    this.missions = []; // most recent first
    this.bytes = 0;
    this.hits = 0;
    this.misses = 0;
    this._retained = new WeakSet();
    this._tick = 0;
  }

  get mission() { return this.missions[0] ?? null; }

  /** A mission starts loading: entries used from now on belong to it; older missions beyond `keepMissions` unpin. */
  beginMission(id) {
    if (id == null) return;
    this.missions = [id, ...this.missions.filter((m) => m !== id)].slice(0, Math.max(1, this.keepMissions));
    this.evict();
  }

  _touch(e) {
    e.used = this.now() + (this._tick++) * 1e-6; // strictly increasing on equal clocks
    if (this.mission != null) e.missions.add(this.mission);
  }

  has(key) { return this.entries.has(key); }

  /** Value for `key` (marks it used by the current mission), or undefined. */
  get(key) {
    const e = this.entries.get(key);
    if (!e) return undefined;
    this._touch(e);
    return e.value;
  }

  /**
   * Store `value`. bytes: number or (value) => number (estimated memory); dispose: (value) => void on eviction.
   * @returns the value
   */
  set(key, value, o = {}) {
    this.delete(key);
    const bytes = Math.max(0, Number(typeof o.bytes === 'function' ? o.bytes(value) : o.bytes) || 0);
    const e = { value, bytes, dispose: o.dispose || null, missions: new Set(), used: 0 };
    this._touch(e);
    this.entries.set(key, e);
    this.bytes += bytes;
    this.evict();
    return value;
  }

  /** Cached value, or compute it now with fn() and keep it. */
  memo(key, fn, o) {
    if (this.entries.has(key)) { this.hits++; return this.get(key); }
    this.misses++;
    return this.set(key, fn(), o);
  }

  /** Async memo: concurrent callers share one load; a rejected load is not cached. */
  memoAsync(key, fn, o) {
    if (this.entries.has(key)) { this.hits++; return Promise.resolve(this.get(key)); }
    if (this.pending.has(key)) { this.hits++; return this.pending.get(key); }
    this.misses++;
    const p = Promise.resolve().then(fn).then((v) => {
      if (this.pending.get(key) === p) { this.pending.delete(key); this.set(key, v, o); }
      return v;
    }, (err) => { if (this.pending.get(key) === p) this.pending.delete(key); throw err; });
    this.pending.set(key, p);
    return p;
  }

  /** Remove one entry (disposing it). */
  delete(key) {
    const e = this.entries.get(key);
    if (!e) return false;
    this.entries.delete(key);
    this.bytes -= e.bytes;
    try { e.dispose?.(e.value); } catch (err) { console.warn('[asset-cache] dispose failed', key, err); }
    return true;
  }

  /** Is this entry pinned (used by one of the kept missions)? */
  pinned(e, keep = this.missions) {
    for (const m of keep) if (e.missions.has(m)) return true;
    return false;
  }

  /**
   * Evict least-recently-used unpinned entries until under budget. `keep`: the missions whose entries stay (default:
   * current + last). @returns {string[]} evicted keys
   */
  evict(budget = this.budget, keep = this.missions) {
    if (this.bytes <= budget) return [];
    const out = [];
    const cands = [...this.entries].filter(([, e]) => !this.pinned(e, keep)).sort((a, b) => a[1].used - b[1].used);
    for (const [k] of cands) {
      if (this.bytes <= budget) break;
      this.delete(k);
      out.push(k);
    }
    return out;
  }

  /**
   * Keep only what the `keep` missions use: every other entry is dropped (disposed) and the other missions leave the
   * history, so a later load of one of them is cold again (ui/loading.js reads `missions` to pick the warm path).
   * @param {string|string[]} keep @returns {string[]} evicted keys
   */
  keepOnly(keep) {
    const ids = [].concat(keep ?? []).filter((m) => m != null);
    const out = this.evict(0, ids);
    this.missions = this.missions.filter((m) => ids.includes(m));
    return out;
  }

  /** Drop everything (and the mission history). */
  clear() {
    for (const k of [...this.entries.keys()]) this.delete(k);
    this.pending.clear();
    this.missions = [];
    this.hits = this.misses = 0;
  }

  /** Mark a GPU resource (geometry, texture, material) as owned by the cache: mission unload must not dispose it. */
  retain(obj) { if (obj && typeof obj === 'object') this._retained.add(obj); return obj; }
  isRetained(obj) { return !!obj && this._retained.has(obj); }
  /** Owner-side dispose: frees `obj` unless the cache owns it (then the cache frees it when it evicts the entry). */
  release(obj) { if (obj && !this._retained.has(obj)) obj.dispose?.(); }

  stats() {
    return { entries: this.entries.size, bytes: this.bytes, budget: this.budget, hits: this.hits, misses: this.misses, missions: [...this.missions] };
  }
}

/** The one cache of this page (survives every mission; Options → CLEAR CACHED GAME DATA clears it). */
export const sessionCache = new SessionCache();
