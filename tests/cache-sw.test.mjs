/**
 * Persistent asset cache (tools/build/sw.mjs + engine/offline-cache.js), web build only (SS_DIST=1; the dev tree has
 * no service worker): a first visit stores the mission it played — including what loaded before the worker took the
 * page — and a second visit loads that mission with no asset request reaching the server.
 */
const CACHEABLE = /\.(glb|webp|jpe?g|png|hdr|ogg|mp3|webm|mp4|woff2?|ttf|cube|wasm|svg)$/i;

export default async function (page, t) {
  const h = t.harness;
  if (!h.dist) { t.log('dev tree: no service worker here (run with SS_DIST=1)'); return; }
  const ctx = await h.browser.newContext({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  const open = async () => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/GPU stall|GL Driver/i.test(m.text())) errs.push('console.error: ' + m.text().slice(0, 300)); });
    await p.goto(`${h.url}/index.html?test=1&sw=1`);
    await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
    await p.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30000 });
    return p;
  };
  try {
    const p1 = await open();
    await p1.evaluate(() => window.__game.loadMission('m01'));
    const stored = await p1.evaluate(() => window.__game.cache.cacheLoadedAssets());
    const st1 = await p1.evaluate(() => window.__game.cache.status());
    t.log(`first visit: cache-urls ${JSON.stringify(stored)}, ${st1.assets} assets cached, build ${st1.version}`);
    t(stored && stored.total > 50, 'the page reports what it loaded');
    t(st1.assets > 100, 'the mission is in the worker cache');
    await p1.close();

    const n0 = h.server.stats.paths.length;
    const p2 = await open();
    let fromSW = 0;
    p2.on('response', (r) => { if (r.fromServiceWorker() && /\/assets\//.test(r.url())) fromSW++; });
    const ms = await p2.evaluate(async () => { const t0 = performance.now(); await window.__game.loadMission('m01'); return performance.now() - t0; });
    const served = h.server.stats.paths.slice(n0).filter((u) => /^\/(assets|vendor)\//.test(u) && CACHEABLE.test(u));
    t.log(`second visit: M1 in ${ms.toFixed(0)} ms, ${fromSW} assets from the worker, ${served.length} from the server ${served.slice(0, 4)}`);
    t.equal(served.length, 0, 'second visit: no asset request reaches the server');
    t(fromSW > 100, 'assets come from the worker cache');
    // manifests / code are network-first: still fetched (never stale)
    t(h.server.stats.paths.slice(n0).some((u) => /\.json$/.test(u)), 'JSON manifests still come from the network');
    // OPTIONS → CLEAR CACHED GAME DATA (the mission on screen keeps what it uses in memory)
    const cl = await p2.evaluate(async () => {
      const n = await window.__game.cache.clear({ keepMission: 'm01' });
      return { n, left: (await caches.keys()).filter((k) => k.startsWith('ss-')), mem: window.__game.cache.stats().entries };
    });
    t.log(`clear: ${cl.n} caches deleted, left ${JSON.stringify(cl.left)}, ${cl.mem} in-memory entries kept for the mission on screen`);
    t(cl.n >= 2 && cl.left.length === 0, 'clearing deletes every SHADOW SIX cache');
    await p2.close();
  } finally {
    await ctx.close();
  }
  t.equal(errs.length, 0, 'no errors ' + errs.slice(0, 3).join(' | '));
}
