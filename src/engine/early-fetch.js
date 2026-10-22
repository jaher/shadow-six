/**
 * Early downloads (perf/download-speed). A mission load runs its stages one after another — buildings, characters,
 * vehicles, the map build (seconds of CPU), then the units, physics, the sound pack and the talking portraits — and
 * each stage only asked for its files when it started, so the link sat idle through the CPU-bound map build and the
 * last stages then waited on the network. The load now names, as soon as it knows them, files a LATER stage will
 * request (the terrain and vegetation strips, the enemies' look GLBs, the mission's sound clips, the portraits'
 * clips): `earlyFetch(urls)` downloads them in the background while the earlier stages work, and the later request
 * — the same `fetch(url)` the loader always made — is answered from memory (or joins the download in flight).
 *
 * - Nothing changes in what is loaded, in which order the game builds, or in what any loader receives: the bytes are
 *   the server's, the Response a plain 200 over them. A URL never named here, or not yet named, goes to the network
 *   exactly as before. Each early download serves ONE later request, then its buffer is dropped.
 * - The background downloads never crowd out what a stage is waiting for: at most `MAX_ACTIVE` run at once, at low
 *   fetch priority, in the order they were named (what is needed first goes first); a request for a URL still queued
 *   starts it at once. A failed early download (network, HTTP error) is forgotten: the later request goes to the
 *   network as it always did and meets the error itself (so nothing is ever reported twice, nor hidden).
 * - `dropEarlyFetches(ms)` (a new mission load) frees what an earlier load named and never asked for; any entry also
 *   expires TTL_MS after it was named.
 * - The service worker (tools/build/sw.mjs) sees an early download like any asset fetch: it is cached for the next
 *   visit as before. The loading bar's Resource Timing count sees each file once (the early download).
 *
 * `window.fetch` is wrapped when this module is first imported (before the audio engine binds `fetch`), only in a
 * browser; `?earlyfetch=0` turns the whole thing off (A/B, emergency).
 * @module engine/early-fetch
 */

const OFF = typeof location !== 'undefined' && /[?&]earlyfetch=0\b/.test(location.search);
/** Background downloads running at once (a stage's own requests share the link with at most these). */
export const MAX_ACTIVE = 6;
/** An early download nobody asked for is dropped after this long (ms). */
export const TTL_MS = 180000;

const entries = new Map(); // absolute URL (no hash) → {state: 'queued'|'active'|'done', p: Promise<{buf,type}|null>, start, t}
const queue = []; // URLs waiting for a slot, in the order named
let active = 0;
let slots = MAX_ACTIVE; // background downloads allowed at once now (earlyFetchSlots)
let realFetch = null;
export const earlyFetchStats = { named: 0, fetched: 0, bytes: 0, served: 0, joined: 0, failed: 0, dropped: 0 };
if (typeof globalThis !== 'undefined') globalThis.__ssEarlyFetch = earlyFetchStats; // perf tools read it (measure-download)

const abs = (u) => {
  try { return new URL(String(u), typeof location !== 'undefined' ? location.href : undefined).href.replace(/#.*$/, ''); } catch { return null; }
};

function install() {
  if (realFetch || OFF || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  realFetch = window.fetch.bind(window);
  window.fetch = function earlyFetchAware(input, init) {
    const hit = take(input, init);
    return hit || realFetch(input, init);
  };
}

/** A later request for a named URL: the early download's bytes as a fresh Response (null: not ours → network). */
function take(input, init) {
  if (!entries.size) return null;
  const method = (init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase();
  if (method !== 'GET') return null;
  if (typeof Request !== 'undefined' && input instanceof Request && input.headers?.has?.('range')) return null;
  if (init?.headers && new Headers(init.headers).has('range')) return null;
  const url = abs(typeof input === 'string' || input instanceof URL ? input : input?.url);
  const e = url && entries.get(url);
  if (!e) return null;
  entries.delete(url);
  if (e.state === 'queued') { const i = queue.indexOf(url); if (i >= 0) queue.splice(i, 1); e.start(true); } // wanted now: no slot needed
  else if (e.state === 'active') earlyFetchStats.joined++;
  return e.p.then((r) => {
    if (!r) return realFetch(input, init); // the early download failed: the request goes out as it always did
    earlyFetchStats.served++;
    return new Response(r.buf, { status: 200, statusText: 'OK', headers: { 'Content-Type': r.type || 'application/octet-stream', 'Content-Length': String(r.buf.byteLength) } });
  });
}

/**
 * How many background downloads may run at once from now on (0..MAX_ACTIVE). Game.loadMission keeps the link for the
 * stages that are waiting on it (the HDRI: none; the art libraries: one) and opens every slot once the CPU-bound map
 * build starts — what a stage asks for itself always starts at once whatever this says.
 */
export function earlyFetchSlots(n) {
  slots = Math.max(0, Math.min(MAX_ACTIVE, n | 0));
  pump();
}

function pump() {
  while (active < slots && queue.length) {
    const url = queue.shift();
    entries.get(url)?.start();
  }
}

/**
 * Name files a later stage of this load will request: they download in the background (low priority, a few at a
 * time), lower `rank` first (what the load needs sooner: 0 terrain strips, 1 tree atlases, 2 the men's bodies,
 * 3 portraits, 4 sounds), in naming order within a rank. Already named / other-origin URLs are skipped. No-op
 * outside a browser or with ?earlyfetch=0.
 * @param {Iterable<string>} urls @param {{rank?: number}} [o]
 * @returns {number} how many were newly named
 */
export function earlyFetch(urls, { rank = 2 } = {}) {
  install();
  if (!realFetch) return 0;
  let n = 0;
  const now = Date.now();
  for (const u of urls || []) {
    const url = abs(u);
    if (!url || entries.has(url) || (typeof location !== 'undefined' && !url.startsWith(location.origin))) continue;
    let resolve;
    const e = { state: 'queued', t: now, rank, p: new Promise((r) => { resolve = r; }) };
    e.start = (asked = false) => { // asked: the loader's own request (never counted against the background slots)
      if (e.state !== 'queued') return;
      e.state = 'active';
      if (!asked) active++;
      earlyFetchStats.fetched++;
      realFetch(url, { priority: 'low', credentials: 'same-origin' })
        .then((res) => (res.ok && res.status === 200 ? res.arrayBuffer().then((buf) => ({ buf, type: res.headers.get('Content-Type') })) : null))
        .catch(() => null)
        .then((r) => {
          e.state = 'done';
          if (!asked) active--;
          if (r) earlyFetchStats.bytes += r.buf.byteLength;
          else { earlyFetchStats.failed++; entries.delete(url); } // a later request meets the error on its own
          resolve(r);
          pump();
        });
    };
    entries.set(url, e);
    let at = queue.length; // after every queued URL of the same or a lower rank
    while (at > 0 && (entries.get(queue[at - 1])?.rank ?? 0) > rank) at--;
    queue.splice(at, 0, url);
    n++;
  }
  earlyFetchStats.named += n;
  expire(now);
  pump();
  return n;
}

function expire(now = Date.now(), ttl = TTL_MS) {
  for (const [url, e] of entries) {
    if (now - e.t < ttl) continue;
    if (e.state === 'queued') { const i = queue.indexOf(url); if (i >= 0) queue.splice(i, 1); }
    entries.delete(url);
    earlyFetchStats.dropped++;
  }
}

/**
 * Forget early downloads nobody asked for, named more than `olderThanMs` ago (a new mission load drops what an earlier
 * one named and never used; what is still current — a menu diorama's tree atlases the mission wants too — stays).
 */
export function dropEarlyFetches(olderThanMs = 0) {
  expire(Date.now(), olderThanMs);
}

/** Is `url` named and not yet served? (tests / debug) */
export const isEarlyFetched = (url) => entries.has(abs(url));

/** URLs named and not yet served (tests / debug). */
export const pendingEarlyFetches = () => [...entries.keys()];

install();
