/**
 * Mission asset packs: a few archive fetches per mission instead of ~1,000 individual file requests.
 *
 * tools/packs/build-packs.mjs turns each mission's list (assets/mission-assets.json) into store-only ZIP parts
 * (assets/packs/<preset>-<mission>-pN.zip, each under the repo's 50 MB per-file ceiling) and records them in
 * the generated catalog (engine/pack-catalog.js) with an index of [path, part, dataOffset, size]. When a
 * mission loads, `openMissionPack` fetches its parts once; from then on the fetch layer serves every listed
 * asset straight out of those buffers. A mission the catalog does not list is never probed for (no 404s):
 * it loads file by file exactly as before.
 *
 *   - `window.fetch` is wrapped: a GET whose site-relative path is in the pack answers with a Response over a
 *     view of the buffer (THREE's FileLoader, the audio engine, texture-memory, portraits — every fetch user).
 *   - THREE's LoadingManager URL modifier (default manager + the assets manager) rewrites the same paths to
 *     blob URLs for the loads that go through <img> (TextureLoader / GLTF external images).
 *
 * Anything not in the pack — the app shell, unlisted files, other missions — falls through to the network
 * untouched, so a tree without packs (or with `?packs=0`) behaves exactly as before. Source asset files are
 * never modified; packs are build artifacts. The archive buffer is assembled from the response stream in
 * frame-paced slices (engine/slice.js nextTask): the loading screen keeps drawing while it arrives.
 * @module engine/mission-pack
 */
import * as THREE from 'three';
import { assets } from './assets.js';
import { nextTask } from './slice.js';
import { PACK_CATALOG } from './pack-catalog.js';

const PACKS_URL = new URL('../../assets/packs/', import.meta.url).href;
const SITE = () => new URL('../../', import.meta.url).href;
/** `?packs=0`: A/B switch and emergency off (the load as it was, one file at a time). */
export const PACKS_OFF = typeof location !== 'undefined' && /[?&]packs=0\b/.test(location.search);

const CT = {
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.json': 'application/json', '.hdr': 'image/vnd.radiance',
  '.ktx2': 'image/ktx2', '.woff2': 'font/woff2', '.bin': 'application/octet-stream',
};
const ctype = (p) => CT[p.slice(p.lastIndexOf('.')).toLowerCase()] || 'application/octet-stream';

let current = null; // {mission, preset, buf, view, index: Map<path,{off,len}>, blobs: Map<path,string>, hits, blobHits}
let realFetch = null;
let installed = false;

function install() {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;
  realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const hit = current?.entryFor(input, init);
    if (hit) return Promise.resolve(hit);
    return realFetch(input, init);
  };
  const modifier = (url) => current?.blobUrlFor(url) ?? url;
  THREE.DefaultLoadingManager.setURLModifier(modifier);
  if (assets.manager?.setURLModifier) assets.manager.setURLModifier(modifier);
}

/** Site-relative path of a request URL (query/hash stripped, percent-decoded), or null when not same-site. */
function relOf(url) {
  try {
    const abs = new URL(String(url), typeof location !== 'undefined' ? location.href : undefined).href;
    const root = SITE();
    if (!abs.startsWith(root)) return null;
    return decodeURIComponent(abs.slice(root.length).split(/[?#]/)[0]);
  } catch { return null; }
}

class MissionPack {
  constructor(meta, bufs, index) {
    this.mission = meta.mission; this.preset = meta.preset;
    this.bufs = bufs; // one ArrayBuffer per ZIP part
    this.index = index; this.blobs = new Map();
    this.files = meta.files; this.bytes = meta.bytes;
    this.hits = 0; this.blobHits = 0;
  }

  _entry(input, init) {
    if (!this.index.size) return null;
    if (init?.method && String(init.method).toUpperCase() !== 'GET') return null;
    if (typeof Request !== 'undefined' && input instanceof Request && input.method !== 'GET') return null;
    const url = typeof input === 'string' ? input : input?.url;
    if (!url) return null;
    const rel = relOf(url);
    const e = rel ? this.index.get(rel) : null;
    return e ? { rel, ...e } : null;
  }

  _view(e) { return new Uint8Array(this.bufs[e.p], e.off, e.len); }

  /** A Response over the entry's bytes (a view of the part buffer — readers copy out), or null. */
  entryFor(input, init) {
    const e = this._entry(input, init);
    if (!e) return null;
    this.hits++;
    return new Response(this._view(e), {
      status: 200,
      headers: { 'Content-Type': ctype(e.rel), 'Content-Length': String(e.len) },
    });
  }

  /** A blob URL for the entry (for <img>-based loaders), created once per entry; null when not packed. */
  blobUrlFor(url) {
    const e = this._entry(url);
    if (!e) return null;
    let b = this.blobs.get(e.rel);
    if (!b) {
      b = URL.createObjectURL(new Blob([this._view(e)], { type: ctype(e.rel) }));
      this.blobs.set(e.rel, b);
    }
    this.blobHits++;
    return b;
  }

  dispose() {
    for (const b of this.blobs.values()) URL.revokeObjectURL(b);
    this.blobs.clear();
  }
}

/**
 * Fetch and install a mission's pack. Resolves to the pack, or null when packs are off / not built / failed —
 * the caller loads either way (every asset then falls back to its own request).
 * @param {string} mission @param {string} preset @param {(frac: number) => void} [onProgress] download progress 0..1
 * @param {import('./download-meter.js').DownloadMeter} [meter] live download figures: exact streamed bytes
 *   and the parts' exact sizes are counted into it as they arrive (the loading screen's numbers)
 */
export async function openMissionPack(mission, preset, onProgress, meter) {
  install();
  closeMissionPack();
  if (PACKS_OFF || !realFetch) return null;
  const meta = PACK_CATALOG.packs?.[`${preset}-${mission}`];
  if (!meta?.parts?.length) return null; // not built for this deployment: no probe, the load is as it was
  if (meter) meter.active = true; // the load progress now reports this meter's exact counters
  try {
    const parts = meta.parts;
    // fetch the parts in parallel; each part is assembled from its stream with a frame yield every ~8 MB, so
    // the loading screen never sits in one long task even on a slow link
    let streamed = 0;
    const report = () => onProgress?.(Math.min(1, streamed / Math.max(1, meta.bytes)));
    const bufs = await Promise.all(parts.map(async (name) => {
      const res = await realFetch(PACKS_URL + name);
      if (!res.ok) throw new Error(`part ${name}: HTTP ${res.status}`);
      const chunks = [];
      let got = 0;
      // the part's exact size joins the meter's total as soon as its headers land (its length at the end
      // when the server sent no Content-Length)
      let totalCounted = false;
      const cl = Number(res.headers.get('Content-Length')) || 0;
      if (meter && cl > 0) { meter.addTotal(cl); totalCounted = true; }
      if (res.body?.getReader) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value); got += value.length; streamed += value.length; meter?.add(value.length); report();
        }
      } else {
        const ab = await res.arrayBuffer();
        chunks.push(new Uint8Array(ab)); got = ab.byteLength; streamed += got; meter?.add(got); report();
      }
      if (meter && !totalCounted) meter.addTotal(got);
      const buf = new ArrayBuffer(got);
      const dst = new Uint8Array(buf);
      let off = 0, sinceYield = 0;
      for (const c of chunks) {
        dst.set(c, off); off += c.length; sinceYield += c.length;
        if (sinceYield >= 8 * 1024 * 1024) { sinceYield = 0; await nextTask(); }
      }
      return buf;
    }));
    const index = new Map();
    for (const [p, part, o, s] of meta.entries || []) {
      if (!bufs[part] || o + s > bufs[part].byteLength) throw new Error(`pack entry ${p} out of range`);
      index.set(p, { p: part, off: o, len: s });
    }
    current = new MissionPack(meta, bufs, index);
    return current;
  } catch (err) {
    if (meter) meter.active = false; // the load fell back to files: the observer's figures take over again
    console.warn(`[packs] ${preset}-${mission} unavailable, loading files individually:`, err?.message || err);
    return null;
  }
}

/** Drop the installed pack (blob URLs revoked; the buffer is GC'd with the pack). */
export function closeMissionPack() {
  current?.dispose();
  current = null;
}

/** The installed pack (debug/tests), or null. */
export const missionPack = () => current;

/** Counters of the installed pack (debug/tests): how many loads the pack served vs. built entries. */
export function packStats() {
  return current ? { mission: current.mission, preset: current.preset, files: current.files, bytes: current.bytes, hits: current.hits, blobHits: current.blobHits } : null;
}
