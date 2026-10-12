/**
 * One Texture per external image across the building and vehicle libraries (perf/gpu-memory). Both draw shared
 * library maps from their GLBs (cast_iron, timber_grey, timber_creosote…); each kept its own Map, so a map a building
 * and a vehicle both used went to the GPU twice (~180 MB summed over the 22 missions on desktop high). The key is
 * everything the upload depends on: the final image URL (after the alias / tier rewrites), the glTF sampler's
 * parameters and the colour space the GLB's material slots give the map — the same key is the same GPU image.
 *
 * Lifetime: one session-cache entry per map (`libtex:<key>`, engine/scoped-assets.js), a dependency of every LOD
 * scene that uses it (`parser.shadowLibKeys`): freed once no kept mission draws a GLB that uses it.
 * @module art/lib-textures
 */
import { scoped, touch, textureBytes } from '../engine/scoped-assets.js';
import { gltfColorSpaces } from '../engine/texture-memory.js';

const CACHE = new Map(); // key → Promise<Texture>
const SHARED = new Set(); // the shared texture objects
const SHARED_SRC = new Set(); // …and their images (glTF clones of a shared texture draw the same GPU image)

/** The shared texture object itself (it has its own cache entry: a scene's disposal leaves it alone). */
export const isLibTexture = (t) => SHARED.has(t);
/** A shared texture or a clone of one (same GPU image: not counted in a scene's bytes). */
export const isLibImage = (t) => !!t && SHARED_SRC.has(t.source);

/** Cache key of glTF texture `index` whose image resolves to `url`. */
export function libTextureKey(parser, index, url) {
  const json = parser.json, def = json.textures[index], s = (json.samplers || [])[def.sampler] || {};
  const cs = (parser._ssSpaces ||= gltfColorSpaces(json)).get(index) ?? '-';
  return `${url}|${s.magFilter ?? '-'},${s.minFilter ?? '-'},${s.wrapS ?? '-'},${s.wrapT ?? '-'}|${cs}`;
}

/**
 * The shared Texture for glTF texture `index` (loaded through this parser the first time anybody needs it); its cache
 * entry becomes a dependency of the parser's scene. For a GLTFLoader plugin's `loadTexture`.
 * @returns {Promise<import('three').Texture>}
 */
export function sharedLibTexture(parser, index, url) {
  const key = libTextureKey(parser, index, url), ck = 'libtex:' + key;
  let p = CACHE.get(key);
  if (!p) {
    p = parser.loadTextureImage(index, parser.json.textures[index].source, parser.textureLoader);
    CACHE.set(key, p);
    p.then((t) => {
      if (!t || CACHE.get(key) !== p) return;
      SHARED.add(t); SHARED_SRC.add(t.source);
      scoped(ck, t, { bytes: textureBytes(t), free: (tt) => {
        if (CACHE.get(key) === p) CACHE.delete(key);
        SHARED.delete(tt); SHARED_SRC.delete(tt.source);
        tt.dispose();
      } });
    }, () => { if (CACHE.get(key) === p) CACHE.delete(key); });
  } else touch(ck);
  (parser.shadowLibKeys ||= new Set()).add(ck);
  return p;
}

/** Shared textures currently cached (tests / tools). */
export const libTextureCount = () => CACHE.size;
