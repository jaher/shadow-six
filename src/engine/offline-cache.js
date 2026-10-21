/**
 * Persistent asset cache, page side. The service worker (tools/build/sw.mjs, web build only) keeps every versioned
 * asset in Cache Storage; this module tells it what to keep and when:
 *
 * - after a mission loads: `cache-urls` with every asset this page fetched (the first visit loads the title screen and
 *   the first mission before the worker controls the page, so those would otherwise stay uncached). Only the mission
 *   being played is ever cached — no assets are downloaded ahead for any other mission;
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

/**
 * Wire to the game: after each mission load (when the page is idle) store the assets that mission loaded and ask
 * for persistence. Nothing is ever fetched for another mission. @returns {() => void} unsubscribe
 */
export function installOfflineCache(game, o = {}) {
  const idle = o.idle || ((fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 8000 }) : setTimeout(fn, 3000)));
  const active = o.active || swActive, store = o.store || cacheLoadedAssets;
  return game.events.on('mission:loaded', () => {
    if (!active()) return;
    idle(async () => {
      await store();
      requestPersistence();
    });
  });
}
