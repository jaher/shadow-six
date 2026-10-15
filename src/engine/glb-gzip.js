/**
 * Gzip-wrapped GLBs. Every `*.glb` under assets/ is stored as gzip(GLB) (tools/perf/glb_gzip.mjs): the meshopt
 * geometry inside is built to be entropy-coded on top (EXT_meshopt_compression leaves that to a general-purpose
 * compressor) and GitHub Pages serves binaries as they are on disk, so the wrap takes 27 % off the GLB bytes (geometry
 * −35…40 %; the JPEGs inside stay byte-identical) without changing a single decoded vertex or texel. The .hdr HDRIs
 * are wrapped too (engine/assets.js loadHDR inflates them).
 *
 * Importing this module patches `GLTFLoader.prototype.parse` once: an ArrayBuffer that starts with the gzip magic
 * (1f 8b) is inflated with the browser's native DecompressionStream (in a small worker, off the main thread) before the
 * stock parser sees it; anything else (a plain GLB, glTF JSON) goes straight through. URLs, manifests, the service
 * worker cache and every loader stay as they were, and plain GLBs (a fresh art export before it is wrapped) keep loading. Modules that build GLTFLoaders
 * import the class from here so the hook is guaranteed to be installed (tests/unit/glb-gzip.test.mjs checks it).
 * Node tools read GLB files with tools/glb-io.mjs (zlib, synchronous).
 * @module engine/glb-gzip
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Inflate counters for the page (perf tools read them): files (of them inflated in the worker), compressed / inflated
 * bytes, summed wall ms from request to result. */
export const glbGzipStats = { files: 0, inWorker: 0, bytesIn: 0, bytesOut: 0, ms: 0 };

const isArrayBuffer = (d) => Object.prototype.toString.call(d) === '[object ArrayBuffer]';

/** Does this buffer start with the gzip magic (1f 8b)? @param {ArrayBuffer|ArrayBufferView} data */
export function isGzip(data) {
  if (!data) return false;
  const u = isArrayBuffer(data) ? new Uint8Array(data, 0, Math.min(2, data.byteLength))
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, Math.min(2, data.byteLength)) : null;
  return !!u && u.length === 2 && u[0] === 0x1f && u[1] === 0x8b;
}

/** Inflate on this thread (native DecompressionStream). @param {ArrayBuffer} data @returns {Promise<ArrayBuffer>} */
function inflateHere(data) {
  if (typeof DecompressionStream !== 'function') return Promise.reject(new Error('gzip-wrapped asset: this browser has no DecompressionStream'));
  return new Response(new Response(data).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

// One small inline worker inflates off the main thread (a mission inflates 15–60 MB; ~0.2–0.6 s of CPU that would
// otherwise share the main thread with parsing and uploads). Blob-URL source: nothing for the build to bundle.
// Where workers are missing (node tests) or fail, inflation runs here instead.
const WORKER_SRC = `onmessage = async (e) => {
  const { id, buf } = e.data;
  try {
    const out = await new Response(new Response(buf).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    postMessage({ id, out }, [out]);
  } catch (err) { postMessage({ id, err: String((err && err.message) || err) }); }
};`;
let worker = null; // null: not tried yet; false: unavailable
let nextId = 0;
const pending = new Map(); // id → {resolve, reject}

function inflateWorker() {
  if (worker !== null) return worker || null;
  worker = false;
  try {
    if (typeof Worker !== 'function' || typeof Blob !== 'function' || typeof URL?.createObjectURL !== 'function') return null;
    const w = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
    w.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.err) p.reject(new Error(e.data.err)); else p.resolve(e.data.out);
    };
    w.onerror = (e) => { // the worker itself broke: this page inflates on the main thread from now on
      e?.preventDefault?.();
      worker = false;
      for (const p of pending.values()) p.retry();
      pending.clear();
    };
    worker = w;
  } catch { worker = false; }
  return worker || null;
}

/**
 * Inflate a gzip buffer (DecompressionStream, in the inflate worker when there is one; the worker gets a copy, so
 * `data` stays usable).
 * @param {ArrayBuffer} data @returns {Promise<ArrayBuffer>}
 */
export async function gunzip(data) {
  const t0 = globalThis.performance?.now?.() ?? Date.now();
  const bytesIn = data.byteLength;
  const w = inflateWorker();
  const out = await (w ? new Promise((resolve, reject) => {
    const id = ++nextId;
    const buf = data.slice(0);
    pending.set(id, { resolve, reject, retry: () => inflateHere(data).then(resolve, reject) });
    w.postMessage({ id, buf }, [buf]);
  }) : inflateHere(data));
  glbGzipStats.files++;
  if (w) glbGzipStats.inWorker++;
  glbGzipStats.bytesIn += bytesIn;
  glbGzipStats.bytesOut += out.byteLength;
  glbGzipStats.ms += (globalThis.performance?.now?.() ?? Date.now()) - t0;
  return out;
}

const HOOKED = Symbol.for('shadow-six.glb-gzip');

/**
 * Install the inflate step on a GLTFLoader class (idempotent).
 * @param {typeof GLTFLoader} Loader
 */
export function installGlbGzip(Loader = GLTFLoader) {
  const P = Loader.prototype;
  if (P[HOOKED]) return Loader;
  const parse = P.parse;
  P.parse = function (data, path, onLoad, onError) {
    if (!isArrayBuffer(data) || !isGzip(data)) return parse.call(this, data, path, onLoad, onError);
    const fail = (e) => { if (onError) onError(e); else console.error(e); };
    gunzip(data).then((glb) => {
      try { parse.call(this, glb, path, onLoad, onError); } catch (e) { fail(e); } // the stock parser throws on bad JSON
    }, fail);
  };
  P[HOOKED] = true;
  return Loader;
}

installGlbGzip(GLTFLoader);

export { GLTFLoader };
