/**
 * Mission-scoped library templates. The art libraries (buildings, vehicles, characters) keep loaded GLB templates in
 * their own Maps for synchronous lookup; registering each one here hands its lifetime to the session cache
 * (engine/asset-cache.js): every mission that uses a template tags it, and once the next mission has loaded
 * (`sessionCache.settle()`) a template no kept mission used is disposed — GPU textures, vertex buffers, materials —
 * and dropped from its library, instead of staying for the whole session. A later mission that needs it loads it again
 * (from the HTTP / service-worker cache).
 *
 *   scoped(`bld:${url}`, gltf.scene, { bytes: sceneBytes(scene, isShared), free: () => { lib.delete(k); disposeScene(scene, isShared); } });
 *   touch(`bld:${url}`);                         // a cache hit: this mission uses it too
 * @module engine/scoped-assets
 */
import { sessionCache } from './asset-cache.js';

const depsOf = new Map(); // cache key → keys it was built from (touched with it)

/** Register a loaded template under `key`; `free(value)` runs when the cache evicts it. @returns value */
export function scoped(key, value, { bytes = 0, free = null } = {}) {
  return sessionCache.set(key, value, { bytes, dispose: free });
}

/** The current mission uses these keys (library cache hits: tags them so they stay with it) — and what they were built from. */
export function touch(...keys) {
  const seen = new Set();
  const visit = (k) => {
    if (!k || seen.has(k)) return;
    seen.add(k);
    sessionCache.get(k);
    for (const d of depsOf.get(k) || []) visit(d);
  };
  for (const k of keys.flat()) visit(k);
}

const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'emissiveMap', 'bumpMap',
  'displacementMap', 'lightMap', 'specularMap', 'envMap', 'clearcoatMap', 'clearcoatNormalMap', 'sheenColorMap', 'transmissionMap'];

function eachMaterialTexture(m, fn) {
  for (const k of TEX_KEYS) if (m[k]?.isTexture) fn(m[k]);
  for (const u of Object.values(m.uniforms || {})) if (u?.value?.isTexture) fn(u.value);
}

/** GPU bytes of a texture (RGBA8 + mip chain, layers). */
export function textureBytes(t) {
  const im = t?.image || {};
  const w = im.width || im.naturalWidth || 0, h = im.height || im.naturalHeight || 0, d = im.depth || 1;
  return w * h * d * 4 * (t?.generateMipmaps === false ? 1 : 4 / 3);
}

/**
 * Approximate memory of a loaded scene: vertex / index arrays (page + GPU copy) and the images it owns (counted once
 * per image: glTF hands out clones of a texture for each sampler / UV transform, all on one GPU copy).
 * @param {(tex) => boolean} [isShared] textures accounted elsewhere (shared library maps, or clones of them)
 */
export function sceneBytes(root, isShared = () => false) {
  let n = 0;
  const seen = new Set();
  root?.traverse?.((o) => {
    const g = o.geometry;
    if (g && !seen.has(g)) {
      seen.add(g);
      for (const a of Object.values(g.attributes || {})) if (a?.array && !seen.has(a.array)) { seen.add(a.array); n += a.array.byteLength * 2; }
      if (g.index?.array) n += g.index.array.byteLength * 2;
    }
    for (const m of o.material ? [].concat(o.material) : []) {
      eachMaterialTexture(m, (t) => { const k = t.source || t; if (!seen.has(k) && !isShared(t)) { seen.add(k); n += textureBytes(t); } });
    }
  });
  return n;
}

/**
 * Free a loaded scene: geometries, materials and its textures (`isShared`: texture objects that belong to their own
 * entries; clones of them are this scene's and go — three frees a GPU image when its last texture object is disposed).
 * Sources stay intact: a texture somebody still draws uploads again (engine/texture-memory.js keeps it uploadable).
 */
export function disposeScene(root, isShared = () => false) {
  const done = new Set();
  root?.traverse?.((o) => {
    if (o.geometry && !done.has(o.geometry)) { done.add(o.geometry); o.geometry.dispose(); }
    if (o.isSkinnedMesh && o.skeleton && !done.has(o.skeleton)) { done.add(o.skeleton); o.skeleton.dispose?.(); }
    for (const m of o.material ? [].concat(o.material) : []) {
      if (done.has(m)) continue;
      done.add(m);
      eachMaterialTexture(m, (t) => { if (!done.has(t) && !isShared(t)) { done.add(t); t.dispose(); } });
      m.dispose();
    }
  });
}

const capture = []; // stack of dep lists being collected by scopedMemo builds

/**
 * Memoise a value in a module's own Map (shared materials, textures), scoped to the missions that use it: a hit tags
 * it — and everything its build used through scopedMemo (a material's textures) — for the current mission; a miss
 * builds it. Eviction deletes it from the Map and runs `free(value)`.
 * @param {string} ns namespace of the cache key @param {Map} map the module's Map @param {string} key
 * @param {() => any} make @param {{bytes?: number|((v) => number), free?: (v) => void}} [o]
 */
export function scopedMemo(ns, map, key, make, { bytes = 0, free = null } = {}) {
  const ck = `${ns}:${key}`;
  capture[capture.length - 1]?.push(ck);
  if (map.has(key)) { touch(ck); return map.get(key); }
  const deps = [];
  capture.push(deps);
  let v;
  try { v = make(); } finally { capture.pop(); }
  map.set(key, v);
  if (deps.length) depsOf.set(ck, deps);
  scoped(ck, v, {
    bytes: typeof bytes === 'function' ? bytes(v) : bytes,
    free: (x) => { if (map.get(key) === x) map.delete(key); depsOf.delete(ck); free?.(x); },
  });
  return v;
}

/** Bytes of a texture still loading (TextureLoader): its size once known, else a 1k map. */
export const pendingTextureBytes = (t) => textureBytes(t) || 1024 * 1024 * 4 * (4 / 3);
