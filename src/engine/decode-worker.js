/**
 * Image strips decoded off the main thread. A terrain layer strip (1024 × 8192 WebP, eight layers; 2K arrays as 2 × 4
 * tiles) was drawn into a 2D canvas and read back on the main thread: 100–480 ms per strip, nine per mission. Here a
 * worker does exactly that — createImageBitmap from the downloaded bytes, the same drawImage calls into an
 * OffscreenCanvas with the same 2D settings, getImageData — and hands back the pixel buffer (transferred, not copied).
 * The main thread only fetches the file (so the loading screen's byte count sees it) and wraps the result.
 *
 * The worker is built from the source below (a blob: URL): no module resolution, the same in the dev tree and in the
 * bundled web build. Without workers or OffscreenCanvas (or on any failure) callers fall back to their main-thread
 * decode.
 *
 *   const s = await decodeStrip(blob, tile);   // → {data: Uint8Array (RGBA, tile × tile·n), tile, n, w, h} | null
 * @module engine/decode-worker
 */

import { SLICED } from './slice.js';

const SRC = `
self.onmessage = async (e) => {
  const { id, blob, tile } = e.data;
  try {
    const bm = await createImageBitmap(blob);
    const W = bm.width, H = bm.height, t = Math.min(tile || W, W);
    const cols = Math.max(1, Math.round(W / t)), rows = Math.max(1, Math.round(H / t)), n = cols * rows;
    const cv = new OffscreenCanvas(t, t * n), cx = cv.getContext('2d', { willReadFrequently: true });
    if (cols === 1) cx.drawImage(bm, 0, 0);
    else for (let i = 0; i < n; i++) cx.drawImage(bm, (i % cols) * t, Math.floor(i / cols) * t, t, t, 0, i * t, t, t);
    bm.close();
    const data = cx.getImageData(0, 0, t, t * n).data;
    cv.width = cv.height = 1;
    self.postMessage({ id, w: W, h: H, tile: t, n, buf: data.buffer }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};`;

/** Workers kept for the session (strips decode two at a time; a mission has ~9). */
const POOL = 2;
const workers = [];
const pending = new Map();
let nextId = 1, broken = false, rr = 0;

function available() {
  return !broken && SLICED && typeof Worker === 'function' && typeof OffscreenCanvas === 'function' && typeof Blob === 'function' && typeof URL?.createObjectURL === 'function';
}

function worker() {
  if (workers.length < POOL) {
    const url = URL.createObjectURL(new Blob([SRC], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve({ data: new Uint8Array(e.data.buf), tile: e.data.tile, n: e.data.n, w: e.data.w, h: e.data.h });
    };
    w.onerror = (e) => { // the worker itself failed (no OffscreenCanvas 2D …): everything waiting falls back
      e.preventDefault?.();
      broken = true;
      for (const [id, p] of pending) { pending.delete(id); p.reject(new Error('decode worker failed')); }
    };
    workers.push(w);
    return w;
  }
  return workers[rr++ % workers.length];
}

/**
 * Decode an image strip into stacked square tiles off the main thread (see the module notes).
 * @param {Blob} blob the image file @param {number} [tile] tile side (default: the image width)
 * @returns {Promise<{data: Uint8Array, tile: number, n: number, w: number, h: number}|null>} null: not possible here
 */
export function decodeStrip(blob, tile = 0) {
  if (!available()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, { resolve, reject: () => resolve(null) });
    try { worker().postMessage({ id, blob, tile }); } catch { pending.delete(id); broken = true; resolve(null); }
  });
}
