/** perf/download-speed: early downloads (src/engine/early-fetch.js) — one network fetch per named file, served once. */
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert } from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ORIGIN = 'https://game.test';

/** A fresh early-fetch module over a fake window whose fetch records calls; `gate` holds responses until released. */
async function fresh({ fail = new Set(), status = {} } = {}) {
  const calls = [], waiting = [];
  let hold = false;
  const net = (input, init) => {
    const url = String(typeof input === 'string' ? input : input.url ?? input);
    calls.push({ url, init });
    const respond = () => {
      if (fail.has(url)) return Promise.reject(new TypeError('network'));
      const body = new TextEncoder().encode('bytes of ' + url);
      return Promise.resolve(new Response(body, { status: status[url] || 200, headers: { 'Content-Type': 'model/gltf-binary' } }));
    };
    if (!hold) return respond();
    return new Promise((ok) => waiting.push(() => ok(respond())));
  };
  globalThis.window = { fetch: net };
  globalThis.location = { href: ORIGIN + '/index.html', origin: ORIGIN, search: '' };
  const m = await import(`../../src/engine/early-fetch.js?i=${Math.random()}`);
  const page = (u, init) => globalThis.window.fetch(u, init);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const release = async () => { while (waiting.length) waiting.shift()(); await tick(); await tick(); };
  return { m, calls, page, tick, release, hold: (v) => { hold = v; } };
}
const done = () => { delete globalThis.window; delete globalThis.location; };

test('early-fetch: a named file is downloaded once and the later request gets its bytes from memory', async () => {
  const { m, calls, page, tick } = await fresh();
  assert.equal(m.earlyFetch(['assets/a.glb', '/assets/b.glb', 'assets/a.glb']), 2);
  await tick(); await tick();
  assert.equal(calls.length, 2);
  const r = await page(ORIGIN + '/assets/a.glb');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), `bytes of ${ORIGIN}/assets/a.glb`);
  assert.equal(r.headers.get('Content-Type'), 'model/gltf-binary');
  assert.equal(calls.length, 2, 'no second network request');
  await page('assets/a.glb'); // served once: the next request is the loader's own again
  assert.equal(calls.length, 3);
  assert.equal(m.earlyFetchStats.served, 1);
  done();
});

test('early-fetch: at most MAX_ACTIVE run at once, lower rank first; a request for a queued file starts it at once', async () => {
  const { m, calls, page, tick, release, hold } = await fresh();
  hold(true);
  const urls = Array.from({ length: m.MAX_ACTIVE + 4 }, (_, i) => `/assets/s${i}.ogg`);
  m.earlyFetch(urls, { rank: 4 });
  m.earlyFetch(['/assets/terrain.webp'], { rank: 0 });
  await tick();
  assert.equal(calls.length, m.MAX_ACTIVE);
  assert.ok(!calls.some((c) => c.url.endsWith('terrain.webp')), 'all slots taken before the rank-0 file was named');
  assert.equal(calls[0].init?.priority, 'low');
  const p = page('/assets/s9.ogg'); // queued → starts now, beyond the limit
  await tick();
  assert.equal(calls.length, m.MAX_ACTIVE + 1);
  assert.ok(calls.at(-1).url.endsWith('s9.ogg'));
  await release();
  assert.equal(await (await p).text(), `bytes of ${ORIGIN}/assets/s9.ogg`);
  // the freed slots go to the rank-0 file before the remaining sounds
  const next = calls.slice(m.MAX_ACTIVE + 1).map((c) => c.url.split('/').pop());
  assert.equal(next[0], 'terrain.webp');
  await release(); await release();
  done();
});

test('early-fetch: a failed early download is forgotten — the later request goes to the network itself', async () => {
  const bad = `${ORIGIN}/assets/missing.glb`, err = `${ORIGIN}/assets/err.glb`;
  const { m, calls, page, tick } = await fresh({ fail: new Set([bad]), status: { [err]: 404 } });
  m.earlyFetch([bad, err]);
  await tick(); await tick(); await tick();
  assert.equal(m.isEarlyFetched(bad), false);
  assert.equal(m.isEarlyFetched(err), false);
  const r = await page(err);
  assert.equal(r.status, 404, 'the loader sees the server answer, as before');
  await assert.rejects(page(bad));
  assert.equal(calls.length, 4);
  done();
});

test('early-fetch: non-GET, range and other-origin requests are never served from it', async () => {
  const { m, calls, page, tick } = await fresh();
  m.earlyFetch(['/assets/v.webm', 'https://elsewhere.test/x.glb']);
  await tick(); await tick();
  assert.equal(calls.length, 1, 'other origin not named');
  await page('/assets/v.webm', { headers: { Range: 'bytes=0-9' } });
  await page('/assets/v.webm', { method: 'HEAD' });
  assert.equal(calls.length, 3);
  assert.equal(m.isEarlyFetched('/assets/v.webm'), true);
  done();
});

test('early-fetch: dropEarlyFetches(ms) forgets what an earlier load named', async () => {
  const { m, tick } = await fresh();
  m.earlyFetch(['/assets/old.glb']);
  await tick();
  m.dropEarlyFetches(60000);
  assert.equal(m.isEarlyFetched('/assets/old.glb'), true, 'named just now: kept');
  m.dropEarlyFetches(0);
  assert.equal(m.isEarlyFetched('/assets/old.glb'), false);
  done();
});

test('early-fetch: off in node (no window): earlyFetch is a no-op', async () => {
  delete globalThis.window;
  const m = await import(`../../src/engine/early-fetch.js?node=${Math.random()}`);
  assert.equal(m.earlyFetch(['/assets/a.glb']), 0);
});

test('early-fetch: the terrain / vegetation URL helpers name files that exist (same names the loaders build)', async () => {
  const { terrainLayerUrls } = await import('../../src/art/terrain/terrain.js');
  const { vegetationStripUrls, VEGETATION_STRIPS } = await import('../../src/art/terrain/vegetation.js');
  const base = join(ROOT, 'assets/terrain') + '/';
  const missing = [];
  for (const th of ['temperate', 'snow', 'desert', 'night', 'coast']) for (const res of [512, 1024, 2048]) {
    for (const u of terrainLayerUrls(th, res, base)) if (!existsSync(u)) missing.push(u.slice(ROOT.length + 1));
  }
  for (const u of vegetationStripUrls(base)) if (!existsSync(u)) missing.push(u.slice(ROOT.length + 1));
  assert.deepEqual(missing, []);
  assert.equal(VEGETATION_STRIPS.length, 6);
});

test('early-fetch: earlyFetchSlots holds the background downloads back (a stage waiting on the link) — never a request', async () => {
  const { m, calls, page, tick, release, hold } = await fresh();
  hold(true);
  m.earlyFetchSlots(0);
  m.earlyFetch(['/assets/x1.glb', '/assets/x2.glb', '/assets/x3.glb']);
  await tick();
  assert.equal(calls.length, 0, 'no slot: nothing starts');
  const p = page('/assets/x2.glb'); // the loader asks for one: it starts at once
  await tick();
  assert.equal(calls.length, 1);
  m.earlyFetchSlots(1);
  await tick();
  assert.equal(calls.length, 2);
  await release();
  assert.equal(await (await p).text(), `bytes of ${ORIGIN}/assets/x2.glb`);
  m.earlyFetchSlots(m.MAX_ACTIVE);
  await release(); await release();
  assert.equal(calls.length, 3);
  done();
});
