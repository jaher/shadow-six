/**
 * Persistent asset cache, page side. The service worker (tools/build/sw.mjs, web build only) keeps every versioned
 * asset in Cache Storage; this module tells it what to keep and when:
 *
 * - after a mission loads: `cache-urls` with every asset this page fetched (the first visit loads the title screen and
 *   the first mission before the worker controls the page, so those would otherwise stay uncached);
 * - when idle after that: `prefetch` of the next two campaign missions, in order (assets/mission-assets.json, written
 *   by tools/perf/measure-load.mjs --budget), unless the connection is metered / data-saver / 2G or storage is short;
 * - `navigator.storage.persist()` once, so the browser does not evict the download under storage pressure;
 * - Options → CLEAR CACHED GAME DATA: `clearCachedGameData()` (Cache Storage + the in-memory session cache).
 *
 * On the dev server (no worker) every call is a cheap no-op.
 * @module engine/offline-cache
 */
import { sessionCache } from './asset-cache.js';

const nav = () => (typeof navigator !== 'undefined' ? navigator : null);
const SITE = () => new URL('../../', import.meta.url).href; // site root (dev: repo root; build: rewritten by esbuild-plugin)

/** Is a service worker controlling this page? */
export function swActive() { return !!nav()?.serviceWorker?.controller; }

/** Post a message to the controlling worker; resolves with its reply, or null (no worker / timeout). */
function post(msg, timeoutMs = 120000) {
  const c = nav()?.serviceWorker?.controller;
  if (!c || typeof MessageChannel === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data); };
    c.postMessage(msg, [ch.port2]);
  });
}

/** Same-origin asset URLs (assets/, vendor/) this page has fetched (Resource Timing). */
export function loadedAssetUrls(site = SITE()) {
  if (typeof performance === 'undefined') return [];
  const out = new Set();
  for (const e of performance.getEntriesByType('resource')) {
    const u = String(e.name).replace(/[?#].*$/, '');
    if (u.startsWith(site) && /^(assets|vendor)\//.test(u.slice(site.length))) out.add(u);
  }
  return [...out];
}

/** Store what this page already loaded. @returns {Promise<{total:number, fetched:number}|null>} */
export function cacheLoadedAssets() {
  const urls = loadedAssetUrls();
  return urls.length ? post({ type: 'cache-urls', urls }) : Promise.resolve(null);
}

/** May we download ahead? No on data-saver, 2G or a cellular (metered) connection. */
export function canPrefetch(n = nav()) {
  const c = n?.connection;
  if (!c) return true;
  if (c.saveData) return false;
  if (/(^|-)2g$/.test(c.effectiveType || '')) return false;
  return c.type !== 'cellular';
}

let listP = null;
/** assets/mission-assets.json: {presets: {high: {m01: [site-relative urls]}}} (null when missing). */
export function missionAssetLists() {
  if (typeof fetch !== 'function') return Promise.resolve(null);
  listP ||= fetch(new URL('assets/mission-assets.json', SITE()).href).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return listP;
}

/** Asset URLs a mission loads at a preset (falls back to the closest preset recorded). */
export function missionUrls(lists, id, preset = 'high', site = SITE()) {
  const P = lists?.presets || {};
  const alt = preset === 'ultra' || preset === 'medium' ? 'high' : preset;
  const rel = P[preset]?.[id] || P[alt]?.[id] || P.high?.[id] || null;
  return rel ? rel.map((r) => new URL(r, site).href) : [];
}

/**
 * Download a mission's assets into the worker cache in the background (low priority).
 * @returns {Promise<{total:number, fetched:number}|null>} null when skipped
 */
export async function prefetchMission(id, preset) {
  if (!id || !swActive() || !canPrefetch()) return null;
  const urls = missionUrls(await missionAssetLists(), id, preset);
  if (!urls.length) return null;
  try { // leave room: skip when the origin is within ~250 MB of its quota
    const est = await nav()?.storage?.estimate?.();
    if (est?.quota && est.quota - (est.usage || 0) < 250e6) return null;
  } catch { /* no estimate: go ahead */ }
  return post({ type: 'prefetch', urls }, 600000);
}

let persistAsked = false;
/** Ask once per page for persistent storage. @returns {Promise<boolean|null>} */
export async function requestPersistence() {
  const s = nav()?.storage;
  if (persistAsked || !s?.persist) return null;
  persistAsked = true;
  try { return (await s.persisted?.()) || (await s.persist()); } catch { return null; }
}

/**
 * Options → CLEAR CACHED GAME DATA: every SHADOW SIX cache in Cache Storage + the in-memory asset cache. `keepMission`:
 * the mission on screen, whose in-memory resources are in use and stay (they go with the normal LRU later).
 * @returns {Promise<number>} caches deleted
 */
export async function clearCachedGameData({ keepMission = null } = {}) {
  if (keepMission == null) sessionCache.clear();
  else sessionCache.keepOnly(keepMission);
  listP = null;
  if (typeof caches === 'undefined') return 0;
  let n = 0;
  for (const k of await caches.keys()) if (/^ss-/.test(k) && (await caches.delete(k))) n++;
  return n;
}

/** Storage used by this origin and the worker's cached asset count (for the Options readout). */
export async function cacheStatus() {
  let est = null;
  try { est = await nav()?.storage?.estimate?.(); } catch { est = null; }
  const st = await post({ type: 'status' }, 3000);
  return { usage: est?.usage ?? null, quota: est?.quota ?? null, assets: st?.assets ?? null, version: st?.version ?? null, worker: swActive(), memory: sessionCache.stats() };
}

/** Campaign missions after `id`, `n` deep (flow.nextMissionId chain). */
export function upcomingMissions(flow, id, n = 2) {
  const out = [];
  for (let m = id; out.length < n;) {
    m = flow?.nextMissionId?.(m);
    if (!m || out.includes(m)) break;
    out.push(m);
  }
  return out;
}

/**
 * Wire to the game: after each mission load (when the page is idle) store the loaded assets, ask for persistence,
 * then prefetch the next `o.lookahead` (default 2) campaign missions one after another, so the one after next is warm
 * too. A newer mission load stops the chain (it starts its own). @returns {() => void} unsubscribe
 */
export function installOfflineCache(game, o = {}) {
  const idle = o.idle || ((fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 8000 }) : setTimeout(fn, 3000)));
  const active = o.active || swActive, prefetch = o.prefetch || prefetchMission, store = o.store || cacheLoadedAssets;
  let gen = 0;
  return game.events.on('mission:loaded', ({ mission }) => {
    if (!active()) return;
    const my = ++gen;
    idle(async () => {
      await store();
      requestPersistence();
      for (const id of upcomingMissions(game.flow, mission?.id, o.lookahead ?? 2)) {
        if (my !== gen) return; // the player moved on: that load prefetches from where they are now
        if (!(await prefetch(id, game.renderer?.presetName))) return; // skipped (metered, storage short, no list)
      }
    });
  });
}
