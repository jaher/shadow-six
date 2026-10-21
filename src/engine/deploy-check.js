/**
 * Reload-on-new-deploy (web build only). Every deploy is stamped with the commit it was built from
 * (tools/build/build.mjs): dist/index.html carries it as window.__SS_BUILD__.v and dist/version.json repeats
 * it. A page that outlives its deploy — a tab left open, or one the browser restored from its HTTP cache
 * (GitHub Pages serves max-age=600) — would otherwise keep running the old build. This module compares the
 * two stamps and reloads exactly once when they differ:
 *
 * - at boot, and again whenever the tab becomes visible / regains focus (a deploy that lands while the
 *   player is tabbed away is picked up on return);
 * - version.json is fetched with cache:'no-store' and the worker's code path is network-first, so neither
 *   the HTTP cache nor Cache Storage can answer with the previous deploy's copy;
 * - the reload is guarded per target build in sessionStorage: if the reloaded page somehow still runs the
 *   old build (a CDN edge mid-deploy), it does not reload a second time this session.
 *
 * The new page is safe to land on: its JS/CSS are content-hashed or version-stamped, and the new worker's
 * activate step purges the old build's code cache. On the dev server there is no build stamp, so no check
 * is possible — and no version.json request is made at all.
 * @module engine/deploy-check
 */

/** sessionStorage key: the build stamp this session already reloaded for. */
export const RELOAD_KEY = 'ss-deploy-reloaded-for';

/** The build stamp of the running page (e.g. 'c39eae69xx'), or null when there is none (dev server). */
export function runningBuild(g = globalThis) {
  const v = g?.__SS_BUILD__?.v;
  return typeof v === 'string' && v ? v : null;
}

/**
 * Decide what a version check should do.
 * @param {string|null} running build stamp of this page
 * @param {string|null} served build stamp from version.json (null: unfetchable — no check possible)
 * @param {string|null} reloadedFor build stamp this session already reloaded for
 * @returns {'skip'|'current'|'reload'|'loop-guard'}
 */
export function deployDecision(running, served, reloadedFor) {
  if (!running || !served) return 'skip';
  if (served === running) return 'current';
  return reloadedFor === served ? 'loop-guard' : 'reload';
}

/** sessionStorage, or null where it is unavailable / throws (private mode). */
function store(g) {
  try { return g?.sessionStorage || null; } catch { return null; }
}

/**
 * One version check: fetch version.json (no-store) and reload if the served build is not the running one.
 * Never throws; a missing/unreadable version.json is 'skip' (no check possible), never a reload.
 * @param {{global?: object, fetch?: Function, url?: string, running?: string|null,
 *          storage?: object|null, reload?: () => void}} [o] injectables for tests
 * @returns {Promise<'skip'|'current'|'reloaded'|'loop-guard'>}
 */
export async function checkForNewDeploy(o = {}) {
  const g = o.global || globalThis;
  const running = o.running !== undefined ? o.running : runningBuild(g);
  if (!running) return 'skip';
  const fetchFn = o.fetch || (typeof g?.fetch === 'function' ? g.fetch.bind(g) : null);
  if (!fetchFn) return 'skip';
  let served = null;
  try {
    let url = o.url;
    if (!url) {
      const base = g?.location?.href;
      if (!base) return 'skip'; // nowhere to resolve version.json against
      url = new URL('version.json', base).href;
    }
    const res = await fetchFn(url, { cache: 'no-store' });
    if (res?.ok) {
      const info = await res.json().catch(() => null);
      served = typeof info?.short === 'string' && info.short ? info.short : null;
    }
  } catch { served = null; }
  const storage = o.storage !== undefined ? o.storage : store(g);
  const get = (k) => { try { return storage?.getItem(k) ?? null; } catch { return null; } };
  const decision = deployDecision(running, served, get(RELOAD_KEY));
  if (decision !== 'reload') return decision;
  try { storage?.setItem(RELOAD_KEY, served); } catch { /* private mode: no guard to write */ }
  (o.reload || (() => { try { g?.location?.reload(); } catch { /* nowhere to go */ } }))();
  return 'reloaded';
}

/**
 * Wire the check to the page: once now (boot), then whenever the tab becomes visible or regains focus.
 * Concurrent triggers share one in-flight check. @returns {() => void} uninstall
 */
export function installDeployCheck(o = {}) {
  const g = o.global || globalThis;
  let busy = false;
  const run = () => {
    if (busy) return;
    busy = true;
    checkForNewDeploy(o).catch(() => {}).finally(() => { busy = false; });
  };
  run();
  const doc = o.document !== undefined ? o.document : g?.document;
  const win = o.window !== undefined ? o.window : g;
  const onVisible = () => { if (!doc || doc.visibilityState === 'visible') run(); };
  const onFocus = () => run();
  doc?.addEventListener?.('visibilitychange', onVisible);
  win?.addEventListener?.('focus', onFocus);
  return () => {
    doc?.removeEventListener?.('visibilitychange', onVisible);
    win?.removeEventListener?.('focus', onFocus);
  };
}
