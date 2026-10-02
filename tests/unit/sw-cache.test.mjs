// The web build's service worker (tools/build/sw.mjs) run in a VM with an in-memory Cache Storage and a fake network:
// content-hash versioning across deploys, cache-first assets, network-first code with an offline fallback, ranges.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { test, assert } from './lib.mjs';
import { writeServiceWorker } from '../../tools/build/sw.mjs';
import { canPrefetch, missionUrls, upcomingMissions, installOfflineCache } from '../../src/engine/offline-cache.js';

const SCOPE = 'https://x.test/shadow-six/';

function site(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ss-sw-'));
  for (const [p, body] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), body); }
  return dir;
}

/** Fake network serving `dir` (null = offline); Cache Storage shared between worker generations. */
function env(state) {
  const stores = state.stores ||= new Map();
  const open = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name), k = (r) => new URL(String(r?.url ?? r), SCOPE).href; // Cache Storage keys are absolute
    return {
      async match(r) { const v = m.get(k(r)); return v ? v.clone() : undefined; },
      async put(r, res) { m.set(k(r), new Response(await res.arrayBuffer(), { status: res.status, headers: res.headers })); },
      async keys() { return [...m.keys()].map((url) => ({ url })); },
      async delete(r) { return m.delete(k(r)); },
    };
  };
  const caches = { open: async (n) => open(n), keys: async () => [...stores.keys()], delete: async (n) => stores.delete(n) };
  // `state.http`: the browser's HTTP cache (Pages: max-age=600) — a fresh entry answers a default-mode fetch without
  // asking the server, so after a deploy it can still hold the previous file; `state.edge`: a CDN copy served instead
  const fetch = async (req, init) => {
    const url = new URL(String(req?.url ?? req), SCOPE).href; // the worker fetches its index relative to itself
    const mode = init?.cache || req?.cache || 'default';
    const rel = url.slice(SCOPE.length).replace(/[?#].*$/, '') || 'index.html';
    const ok = (b) => { const r = new Response(b, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } }); Object.defineProperty(r, 'type', { value: 'basic' }); return r; };
    if (mode === 'default' && state.http?.has(rel)) return ok(state.http.get(rel));
    state.net.push(url.slice(SCOPE.length));
    if (!state.dir) throw new TypeError('offline');
    if (state.edge?.has(rel)) return ok(state.edge.get(rel));
    let body;
    try { body = readFileSync(join(state.dir, rel)); } catch { return new Response('nf', { status: 404 }); }
    state.http?.set(rel, body);
    const res = new Response(body, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
    Object.defineProperty(res, 'type', { value: 'basic' });
    return res;
  };
  return { caches, fetch };
}

async function boot(state) {
  const handlers = {};
  const { caches, fetch } = env(state);
  const ctx = { caches, fetch, Response, Request, URL, console, setTimeout, crypto: webcrypto, Uint8Array, location: new URL(SCOPE + 'sw.js'),
    addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  ctx.self = ctx;
  vm.runInNewContext(readFileSync(join(state.dir, 'sw.js'), 'utf8'), vm.createContext(ctx));
  const run = async (type, ev) => { const w = []; handlers[type]({ ...ev, waitUntil: (p) => w.push(p) }); await Promise.all(w); };
  await run('install', {}); await run('activate', {});
  const get = async (rel, o = {}) => {
    let out = null; const w = [];
    handlers.fetch({ request: new Request(SCOPE + rel, { headers: o.headers || {} }), respondWith: (p) => { out = p; }, waitUntil: (p) => w.push(p) });
    const res = out ? await out : await fetch(SCOPE + rel);
    await Promise.all(w);
    return res;
  };
  const post = async (data) => { const w = []; let out = null; handlers.message({ data, ports: [{ postMessage: (m) => { out = m; } }], waitUntil: (p) => w.push(p) }); await Promise.all(w); return out; };
  return { get, post };
}

test('sw: assets cache-first by content hash; a deploy refetches only the changed file', async () => {
  const dir = site({ 'index.html': '<html>v1', 'js/main-AAAAAAAA.js': 'code1', 'assets/a.glb': 'AAA', 'assets/b.jpg': 'BBB', 'assets/m.json': '{"v":1}' });
  try {
    await writeServiceWorker(dir, { short: 'v1' });
    const st = { dir, net: [] };
    let sw = await boot(st);
    await sw.get('assets/a.glb'); await sw.get('assets/b.jpg');
    st.net.length = 0;
    assert.equal(await (await sw.get('assets/a.glb')).text(), 'AAA');
    assert.equal(await (await sw.get('assets/b.jpg')).text(), 'BBB');
    assert.deepEqual(st.net, [], 'second fetch: from the cache');
    // deploy 2: b.jpg changed, a.glb untouched
    writeFileSync(join(dir, 'assets/b.jpg'), 'B2');
    await writeServiceWorker(dir, { short: 'v2' });
    sw = await boot(st);
    st.net.length = 0;
    assert.equal(await (await sw.get('assets/a.glb')).text(), 'AAA');
    assert.equal(await (await sw.get('assets/b.jpg')).text(), 'B2');
    assert.deepEqual(st.net.filter((u) => u.startsWith('assets/')), ['assets/b.jpg'], 'only the changed file');
    const keys = [...st.stores.get('ss-assets-v1').keys()];
    assert.equal(keys.filter((k) => k.includes('/b.jpg')).length, 1, 'the stale b.jpg entry was purged');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sw: a deploy while the browser still holds the old file fresh never stores it under the new hash', async () => {
  const dir = site({ 'assets/a.glb': 'AAA', 'assets/b.jpg': 'BBB', 'assets/c.ogg': 'CCC' });
  try {
    await writeServiceWorker(dir, { short: 'v1' });
    const st = { dir, net: [], http: new Map() }; // Pages: max-age=600 → the HTTP cache answers without asking
    let sw = await boot(st);
    await sw.get('assets/a.glb'); await sw.get('assets/b.jpg');
    st.http.set('assets/c.ogg', Buffer.from('CCC')); // loaded by the page before the worker controlled it
    // deploy 2 within the max-age: b.jpg and c.ogg changed, the browser's copies are still fresh
    writeFileSync(join(dir, 'assets/b.jpg'), 'B2'); writeFileSync(join(dir, 'assets/c.ogg'), 'C2');
    await writeServiceWorker(dir, { short: 'v2' });
    sw = await boot(st);
    assert.equal(await (await sw.get('assets/b.jpg')).text(), 'B2', 'a miss revalidates: the new file at once');
    const r = await sw.post({ type: 'prefetch', id: 1, urls: [SCOPE + 'assets/c.ogg', SCOPE + 'assets/a.glb'] });
    assert.deepEqual([r.total, r.fetched], [2, 1], 'prefetch: only the changed file');
    st.http.clear(); st.dir = null; // the HTTP cache expires, then offline: only the worker's copies are left
    assert.equal(await (await sw.get('assets/b.jpg')).text(), 'B2', 'the worker kept the new bytes');
    assert.equal(await (await sw.get('assets/c.ogg')).text(), 'C2', 'prefetch stored the new bytes');
    assert.equal(await (await sw.get('assets/a.glb')).text(), 'AAA', 'unchanged file kept across the deploy');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sw: bytes that do not match the index hash (a stale CDN edge) are served but never stored', async () => {
  const dir = site({ 'assets/b.jpg': 'BBB' });
  try {
    await writeServiceWorker(dir, { short: 'v1' });
    writeFileSync(join(dir, 'assets/b.jpg'), 'B2');
    await writeServiceWorker(dir, { short: 'v2' });
    const st = { dir, net: [], edge: new Map([['assets/b.jpg', Buffer.from('BBB')]]) }; // the edge still has deploy 1
    const sw = await boot(st);
    assert.equal(await (await sw.get('assets/b.jpg')).text(), 'BBB', 'served as received');
    assert.equal([...(st.stores.get('ss-assets-v1') || new Map()).keys()].length, 0, 'not stored under the new hash');
    st.edge.clear(); st.net.length = 0;
    assert.equal(await (await sw.get('assets/b.jpg')).text(), 'B2');
    assert.deepEqual(st.net, ['assets/b.jpg'], 'asked the network again');
    st.net.length = 0;
    assert.equal(await (await sw.get('assets/b.jpg')).text(), 'B2');
    assert.deepEqual(st.net, [], 'the verified copy is kept');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sw: code / JSON network-first (never stale), this build\'s copy offline; old builds\' code purged', async () => {
  const dir = site({ 'index.html': '<html>v1', 'assets/m.json': '{"v":1}', 'assets/a.glb': 'AAA' });
  try {
    await writeServiceWorker(dir, { short: 'v1' });
    const st = { dir, net: [] };
    let sw = await boot(st);
    assert.equal(await (await sw.get('index.html')).text(), '<html>v1');
    assert.equal(await (await sw.get('assets/m.json')).text(), '{"v":1}');
    await sw.get('assets/a.glb');
    writeFileSync(join(dir, 'index.html'), '<html>v2'); writeFileSync(join(dir, 'assets/m.json'), '{"v":2}');
    assert.equal(await (await sw.get('index.html')).text(), '<html>v2', 'online: the new HTML at once');
    assert.equal(await (await sw.get('assets/m.json')).text(), '{"v":2}');
    await new Promise((ok) => setTimeout(ok, 20)); // the code cache is written in the background
    st.dir = null; // offline
    const off = await sw.get('index.html').then((r) => r.text(), (e) => 'ERR ' + e.message);
    assert.equal(off, '<html>v2', 'offline: last copy ' + off);
    assert.equal(await (await sw.get('assets/a.glb')).text(), 'AAA', 'offline: cached asset');
    st.dir = dir;
    await writeServiceWorker(dir, { short: 'v2' });
    sw = await boot(st);
    assert.deepEqual([...st.stores.keys()].filter((k) => k.startsWith('ss-code-')), [], 'v1 code cache dropped');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sw: a Range request is answered from the cached file', async () => {
  const dir = site({ 'assets/p/idle.webm': '0123456789' });
  try {
    await writeServiceWorker(dir, { short: 'v1' });
    const st = { dir, net: [] };
    const sw = await boot(st);
    await sw.get('assets/p/idle.webm', { headers: { range: 'bytes=0-' } }); // streams, stores the whole file
    st.net.length = 0;
    const r = await sw.get('assets/p/idle.webm', { headers: { range: 'bytes=2-5' } });
    assert.equal(r.status, 206);
    assert.equal(await r.text(), '2345');
    assert.equal(r.headers.get('content-range'), 'bytes 2-5/10');
    assert.deepEqual(st.net, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('offline-cache: prefetch policy and mission lists', () => {
  assert.equal(canPrefetch({}), true);
  assert.equal(canPrefetch({ connection: { saveData: true } }), false);
  assert.equal(canPrefetch({ connection: { effectiveType: '2g' } }), false);
  assert.equal(canPrefetch({ connection: { effectiveType: 'slow-2g' } }), false);
  assert.equal(canPrefetch({ connection: { type: 'cellular', effectiveType: '4g' } }), false);
  assert.equal(canPrefetch({ connection: { type: 'wifi', effectiveType: '4g' } }), true);
  const L = { presets: { high: { m02: ['assets/a.glb'] }, low: { m02: ['assets/a_512.glb'] } } };
  assert.deepEqual(missionUrls(L, 'm02', 'low', SCOPE), [SCOPE + 'assets/a_512.glb']);
  assert.deepEqual(missionUrls(L, 'm02', 'ultra', SCOPE), [SCOPE + 'assets/a.glb'], 'ultra falls back to high');
  assert.deepEqual(missionUrls(L, 'm09', 'high', SCOPE), []);
  assert.deepEqual(missionUrls(null, 'm02', 'high', SCOPE), []);
});

test('offline-cache: after a load, prefetch the next two missions in order; a newer load stops the chain', async () => {
  const ids = ['m00', 'm01', 'm02', 'm03'];
  const flow = { nextMissionId: (id) => ids[ids.indexOf(id) + 1] || null };
  assert.deepEqual(upcomingMissions(flow, 'm01'), ['m02', 'm03']);
  assert.deepEqual(upcomingMissions(flow, 'm02', 2), ['m03'], 'campaign end');
  assert.deepEqual(upcomingMissions(flow, 'm03'), []);
  const handlers = [], idle = [], got = [];
  let release = null, hold = false;
  const game = { flow, renderer: { presetName: 'high' }, events: { on: (_t, f) => { handlers.push(f); return () => {}; } } };
  installOfflineCache(game, { active: () => true, idle: (fn) => idle.push(fn), store: async () => null,
    prefetch: (id, preset) => { got.push(id + ':' + preset); return hold && id === 'm02' ? new Promise((ok) => { release = ok; }) : Promise.resolve({ total: 1, fetched: 1 }); } });
  handlers[0]({ mission: { id: 'm00' } });
  await idle.shift()();
  assert.deepEqual(got, ['m01:high', 'm02:high'], 'next, then the one after');
  got.length = 0; hold = true;
  handlers[0]({ mission: { id: 'm01' } });
  const run = idle.shift()();
  await new Promise((ok) => setTimeout(ok, 0));
  assert.deepEqual(got, ['m02:high'], 'm02 in flight');
  handlers[0]({ mission: { id: 'm02' } }); // the player moved on before it finished
  release({ total: 1, fetched: 1 });
  await run;
  assert.deepEqual(got, ['m02:high'], 'the old chain stops (no m03 from it)');
  await idle.shift()();
  assert.deepEqual(got, ['m02:high', 'm03:high'], 'the new load prefetches from where the player is');
  got.length = 0;
  installOfflineCache({ ...game, events: { on: (_t, f) => { f({ mission: { id: 'm00' } }); return () => {}; } } },
    { active: () => true, idle: (fn) => idle.push(fn), store: async () => null, prefetch: async (id) => { got.push(id); return null; } });
  await idle.shift()();
  assert.deepEqual(got, ['m01'], 'a skipped prefetch (metered / storage) does not go further');
});
