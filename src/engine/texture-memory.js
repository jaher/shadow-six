/**
 * Texture memory: the page's copy of a texture's pixels goes once the GPU holds them.
 *
 * three keeps `texture.image` for as long as the Texture lives, only to upload it again (needsUpdate, a new sampler
 * variant of a shared image, a lost and restored context). For the GLB images that copy is an ImageBitmap — a full
 * RGBA decode, 4 MB per 1k map, 0.6–1.2 GB per mission — and for the terrain / vegetation layer arrays a Uint8Array
 * (32–48 MB each, also kept by the session cache). Here:
 *  - `EncodedBitmapLoader` (an ImageBitmapLoader that remembers each bitmap's encoded Blob) and the GLTFLoader plugin
 *    `keepEncodedImages` (installs it, watches the loaded scene's textures): after a texture's first upload its
 *    ImageBitmap is closed and `source.data` becomes an <img> of the same file bytes (the JPEG/PNG, ~5 % of the decode).
 *    three can upload from it again at any time — the browser decodes it on demand into the same pixels (no flip, no
 *    premultiply, no colour conversion on either path) and may discard that decode again; nothing re-decodes while the
 *    texture stays on the GPU.
 *  - `releaseDataAfterUpload(texture, reload)`: a data texture keeps only its size after the upload
 *    (`source.dataReady = false`: a later upload allocates without data); `reload()` fills it again after a restored
 *    WebGL context (`installTextureMemory(renderer)` listens for it) or whenever three had to upload it again (e.g.
 *    disposed by a cache eviction while something still draws it).
 * Only page memory changes: GPU memory, pixels and upload timing stay as they were.
 * @module engine/texture-memory
 */

import * as THREE from 'three';

const encoded = new WeakMap(); // ImageBitmap → Blob (its file bytes)
const swapping = new WeakSet(); // sources whose <img> stand-in is loading
const watched = new WeakSet(); // textures with the release hook
const holding = new WeakSet(); // sources still holding a decoded copy that goes after their first upload
const reloadOf = new WeakMap(); // data texture → reload()
const released = new Set(); // WeakRef<Texture>: data textures whose array was dropped (reloaded on a restored context)
const listed = new WeakSet();
export const textureMemoryStats = { bitmapsReleased: 0, bitmapBytes: 0, dataReleased: 0, dataBytes: 0, reloaded: 0 };

const hasBitmap = () => typeof ImageBitmap !== 'undefined';
const isBitmap = (x) => hasBitmap() && x instanceof ImageBitmap;

/** ImageBitmapLoader that keeps each bitmap's encoded Blob, so the decode can be swapped for the bytes after upload. */
export class EncodedBitmapLoader extends THREE.ImageBitmapLoader {
  load(url, onLoad, onProgress, onError) {
    if (url === undefined) url = '';
    if (this.path !== undefined) url = this.path + url;
    url = this.manager.resolveURL(url);
    const scope = this;
    scope.manager.itemStart(url);
    const init = { credentials: this.crossOrigin === 'anonymous' ? 'same-origin' : 'include', headers: this.requestHeader };
    fetch(url, init)
      .then((res) => res.blob())
      .then((blob) => createImageBitmap(blob, Object.assign({}, scope.options, { colorSpaceConversion: 'none' })).then((bmp) => { encoded.set(bmp, blob); return bmp; }))
      .then((bmp) => { onLoad?.(bmp); scope.manager.itemEnd(url); })
      .catch((e) => { onError?.(e); scope.manager.itemError(url); scope.manager.itemEnd(url); });
  }
}

/** After `texture`'s upload: swap its ImageBitmap for an <img> of the same bytes, then close the bitmap. */
function afterUpload(texture) {
  const src = texture.source, bmp = src?.data;
  if (!isBitmap(bmp) || swapping.has(src) || typeof Image === 'undefined') return;
  const blob = encoded.get(bmp);
  if (!blob) return;
  swapping.add(src);
  const img = new Image();
  img.decoding = 'async';
  const u = URL.createObjectURL(blob);
  const done = (ok) => {
    URL.revokeObjectURL(u);
    swapping.delete(src);
    // a newer image in the meantime (or a failed stand-in): keep whatever is there
    if (!ok || src.data !== bmp || img.naturalWidth !== bmp.width || img.naturalHeight !== bmp.height) return;
    src.data = img; // same version: nothing is uploaded again
    holding.delete(src);
    textureMemoryStats.bitmapsReleased++;
    textureMemoryStats.bitmapBytes += bmp.width * bmp.height * 4;
    encoded.delete(bmp);
    bmp.close();
  };
  img.onload = () => done(true);
  img.onerror = () => done(false);
  img.src = u;
}

/** Release `texture`'s decoded image after its first upload (idempotent; only images from EncodedBitmapLoader). */
export function watchTexture(texture) {
  if (!texture?.isTexture || watched.has(texture) || !encoded.has(texture.source?.data)) return texture;
  watched.add(texture);
  holding.add(texture.source);
  const prev = texture.onUpdate;
  texture.onUpdate = function (t) { prev?.call(this, t); afterUpload(t); };
  return texture;
}

/** Watch every texture of the materials under `root` (a loaded glTF scene). */
export function watchScene(root) {
  root?.traverse?.((o) => {
    for (const m of o.material ? [].concat(o.material) : []) for (const k in m) if (m[k]?.isTexture) watchTexture(m[k]);
  });
  return root;
}

/**
 * GLTFLoader plugin: `loader.register(keepEncodedImages)`. Decodes images with EncodedBitmapLoader (where the parser
 * would use an ImageBitmapLoader) and watches the textures of the parsed scenes.
 */
export function keepEncodedImages(parser) {
  const l = parser.textureLoader;
  if (l?.isImageBitmapLoader && !(l instanceof EncodedBitmapLoader) && typeof Blob !== 'undefined') {
    const e = new EncodedBitmapLoader(l.manager);
    e.setCrossOrigin(l.crossOrigin);
    e.setRequestHeader(l.requestHeader);
    e.setOptions(l.options);
    if (l.path !== undefined) e.setPath(l.path);
    parser.textureLoader = e;
  }
  return {
    name: 'SHADOW_keep_encoded_images',
    afterRoot(result) {
      watchScene(result.scene);
      for (const s of result.scenes || []) if (s !== result.scene) watchScene(s);
    },
  };
}

/**
 * Drop a data texture's pixel array after its first upload (it keeps its size; `source.dataReady = false`).
 * `reload()` → Promise<{data}> (e.g. the same decode again) refills it when a lost WebGL context is restored.
 */
export function releaseDataAfterUpload(texture, reload) {
  if (!texture?.isTexture) return texture;
  holding.add(texture.source);
  if (reload) reloadOf.set(texture, reload);
  const prev = texture.onUpdate;
  texture.onUpdate = function (t) {
    prev?.call(this, t);
    const s = t.source, d = s.data;
    // uploaded again without its array (disposed by a cache eviction while still drawn, or a lost context): three
    // allocated it empty — decode the array again and upload it (a moment of a blank texture instead of a lasting one)
    if (!s.dataReady && reload && !refilling.has(s)) { refill(t); return; }
    if (!d?.data || !s.dataReady) return;
    textureMemoryStats.dataReleased++;
    textureMemoryStats.dataBytes += d.data.byteLength;
    s.data = { width: d.width, height: d.height, depth: d.depth, data: null };
    s.dataReady = false;
    holding.delete(s);
    if (reload && !listed.has(t)) { listed.add(t); released.add(new WeakRef(t)); }
  };
  return texture;
}

const refilling = new WeakSet(); // sources being decoded again

/** Decode a released data texture's array again and upload it. */
function refill(t) {
  const s = t.source, reload = reloadOf.get(t);
  if (!reload || refilling.has(s) || s.dataReady) return Promise.resolve();
  refilling.add(s);
  return Promise.resolve().then(reload).then((img) => {
    const data = img?.data ?? img?.image?.data;
    if (!data) return;
    s.data = { width: s.data.width, height: s.data.height, depth: s.data.depth, data };
    s.dataReady = true;
    t.needsUpdate = true; // texture + source version: uploads again, then releases again (the hook stays on it)
    textureMemoryStats.reloaded++;
  }).catch((err) => console.warn('[texture-memory] reload failed', err)).finally(() => refilling.delete(s));
}

/** A restored context lost every GPU copy: refill the released data textures (images re-upload by themselves). */
export async function reloadReleased() {
  const jobs = [];
  for (const ref of [...released]) {
    const t = ref.deref();
    if (!t) { released.delete(ref); continue; }
    jobs.push(refill(t));
  }
  await Promise.all(jobs);
}

/** Data textures currently released (alive). */
export function releasedDataTextures() {
  const out = [];
  for (const ref of released) { const t = ref.deref(); if (t) out.push(t); else released.delete(ref); }
  return out;
}

/** Listen for a restored WebGL context on the renderer's canvas. @returns {() => void} uninstall */
export function installTextureMemory(renderer) {
  const el = renderer?.domElement;
  if (!el?.addEventListener) return () => {};
  const on = () => { reloadReleased(); };
  el.addEventListener('webglcontextrestored', on);
  return () => el.removeEventListener('webglcontextrestored', on);
}

const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'emissiveMap', 'bumpMap', 'displacementMap', 'lightMap', 'specularMap'];

/**
 * Uploads, a few per frame, the textures under a root whose page copy still waits for their first draw (objects off
 * screen, hidden parts): once on the GPU that copy goes, and the first pan onto them does not stall a frame on an
 * upload. Game queues the mission's scene when it has loaded (the briefing) and steps it every drawn frame.
 */
export class TextureWarmer {
  constructor(renderer) { this.renderer = renderer; this.queue = []; this.done = 0; }

  /** Queue every texture under `root` (materials and shader uniforms) still holding a decoded copy. */
  add(root) {
    const seen = new Set(this.queue);
    const take = (t) => { if (t?.isTexture && !seen.has(t) && holding.has(t.source)) { seen.add(t); this.queue.push(t); } };
    root?.traverse?.((o) => {
      for (const m of o.material ? [].concat(o.material) : []) {
        for (const k of TEX_KEYS) take(m[k]);
        for (const u of Object.values(m.uniforms || {})) take(u?.value);
      }
    });
    return this.queue.length;
  }

  clear() { this.queue.length = 0; }

  /** Upload queued textures for up to `budgetMs` (at least one). @returns {number} left */
  step(budgetMs = 3) {
    const r = this.renderer;
    if (!this.queue.length || !r?.initTexture) return this.queue.length;
    const t0 = performance.now();
    while (this.queue.length) {
      const t = this.queue.shift();
      if (!holding.has(t.source)) continue; // released meanwhile (drawn, or a sibling clone was)
      try { r.initTexture(t); this.done++; } catch (e) { console.warn('[texture-memory] upload failed', e); }
      if (performance.now() - t0 >= budgetMs) break;
    }
    return this.queue.length;
  }
}
