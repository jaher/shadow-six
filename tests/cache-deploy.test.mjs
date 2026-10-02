/**
 * A new deploy on the same origin (web build only, SS_DIST=1): the service worker keeps every unchanged asset and
 * fetches only the changed file; HTML / build info are network-first, so the page is never stale after a version bump.
 * The "deploy" is a hard-linked copy of dist/ with one texture changed, a new index.html and a regenerated sw.js. It is
 * served with GitHub Pages' cache headers (max-age=600 + ETag) and lands while the browser still holds the old texture
 * fresh in its HTTP cache: the new worker must revalidate, never store those old bytes under the new content hash.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OUT_DIR, ROOT } from './harness.mjs';

const CACHEABLE = /\.(glb|webp|jpe?g|png|hdr|ogg|mp3|webm|mp4|woff2?|ttf|cube|wasm|svg)$/i;

export default async function (page, t) {
  const h = t.harness;
  if (!h.dist) { t.log('dev tree: no service worker here (run with SS_DIST=1)'); return; }
  const copy = join(OUT_DIR, 'deploy2');
  const { startServer } = await import(pathToFileURL(join(ROOT, 'tools/serve.mjs')).href);
  const srv = await startServer({ port: 0, root: h.dist, base: '/shadow-six/', gzip: true, pages: true });
  const url = srv.url.replace(/\/$/, '');
  const ctx = await h.browser.newContext({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  const ready = async (p, what) => {
    const t0 = Date.now();
    await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
    await p.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30000 });
    t.log(`${what} ready in ${Date.now() - t0} ms`);
  };
  const open = async () => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/GPU stall|GL Driver/i.test(m.text())) errs.push('console.error: ' + m.text().slice(0, 300)); });
    await p.goto(`${url}/index.html?test=1&sw=1`);
    await ready(p, 'page');
    return p;
  };
  try {
    // deploy 1: play M1, keep it
    const p1 = await open();
    const v1 = await p1.evaluate(() => window.__SS_BUILD__.v);
    await p1.evaluate(() => window.__game.loadMission('m01'));
    await p1.evaluate(() => window.__game.cache.cacheLoadedAssets());
    const jpgs = await p1.evaluate(() => [...new Set(performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname).filter((u) => /\/assets\/textures\/.+\.jpg$/.test(u)))]);
    t(jpgs.length > 0, 'M1 loads JPEG textures');
    // the texture about to change sits fresh in the browser's HTTP cache (max-age=600) when the deploy lands: the
    // in-memory HTTP cache of a test context is small, so re-read it from the network past the worker right now
    const cdp1 = await ctx.newCDPSession(p1);
    await cdp1.send('Network.enable');
    await cdp1.send('Network.setBypassServiceWorker', { bypass: true });
    await p1.evaluate((u) => fetch(u, { cache: 'reload' }).then((r) => r.arrayBuffer()), jpgs[0]);
    await p1.close();

    // deploy 2: one texture changed (bytes after a JPEG's end marker are ignored by decoders), new HTML + worker
    rmSync(copy, { recursive: true, force: true });
    execFileSync('cp', ['-al', h.dist, copy]);
    const changed = jpgs[0].replace(/^\/shadow-six\//, '');
    const buf = readFileSync(join(copy, changed));
    unlinkSync(join(copy, changed)); // break the hard link: dist/ stays as it was
    writeFileSync(join(copy, changed), Buffer.concat([buf, Buffer.from('deploy2')]));
    const html = readFileSync(join(copy, 'index.html'), 'utf8');
    unlinkSync(join(copy, 'index.html'));
    writeFileSync(join(copy, 'index.html'), html.replace(`"v":"${v1}"`, '"v":"deploy2"').replace('</head>', '<meta name="ss-deploy" content="2"></head>'));
    for (const f of ['sw.js']) if (existsSync(join(copy, f))) unlinkSync(join(copy, f));
    const { writeServiceWorker } = await import(pathToFileURL(join(ROOT, 'tools/build/sw.mjs')).href);
    await writeServiceWorker(copy, { short: 'deploy2' });
    srv.setRoot(copy);

    // the next visit picks the new worker up; once it controls the page, reload and replay M1
    const p2 = await open();
    await p2.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg.update().catch(() => {});
      for (let i = 0; i < 200; i++) {
        const st = await window.__game.cache.status();
        if (st.version === 'deploy2') return;
        await new Promise((ok) => setTimeout(ok, 100));
      }
    });
    // a player reloading after the deploy: the new worker answers every request, the page itself revalidates
    const p3 = p2;
    await p3.reload();
    await ready(p3, 'reloaded page');
    const fresh = await p3.evaluate(async () => ({ v: window.__SS_BUILD__?.v, meta: !!document.querySelector('meta[name="ss-deploy"]'), sw: (await window.__game.cache.status()).version }));
    t.log(`after the deploy: build ${fresh.v}, marker ${fresh.meta}, worker ${fresh.sw}`);
    t(fresh.v === 'deploy2' && fresh.meta, 'no stale HTML / build info after a version bump');
    t.equal(fresh.sw, 'deploy2', 'the new worker controls the page');
    const n0 = srv.stats.paths.length;
    await p3.evaluate(() => window.__game.loadMission('m01'));
    const served = srv.stats.paths.slice(n0).filter((u) => /^\/(assets|vendor)\//.test(u) && CACHEABLE.test(u));
    t.log(`M1 after the deploy: ${served.length} assets from the server: ${served.slice(0, 5)}`);
    t.equal(served.length, 1, 'only the changed file is fetched again');
    t.equal(served[0], '/' + changed);
    // the worker's copy is the new file, also once the browser's HTTP cache is gone
    const tail = async (p) => p.evaluate(async (u) => { const b = new Uint8Array(await (await fetch(u)).arrayBuffer()); return String.fromCharCode(...b.slice(-7)); }, jpgs[0]);
    t.equal(await tail(p3), 'deploy2', 'the page gets the new texture');
    const cdp = await ctx.newCDPSession(p3);
    await cdp.send('Network.clearBrowserCache');
    const n1 = srv.stats.paths.length;
    t.equal(await tail(p3), 'deploy2', 'the worker stored the new bytes under the new hash');
    t.equal(srv.stats.paths.slice(n1).filter((u) => u === '/' + changed).length, 0, 'answered by the worker');
    await p3.close();
  } finally {
    await ctx.close();
    await srv.close();
    rmSync(copy, { recursive: true, force: true });
  }
  t.equal(errs.length, 0, 'no errors ' + errs.slice(0, 3).join(' | '));
}
