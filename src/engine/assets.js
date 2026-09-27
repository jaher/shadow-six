/**
 * Assets — manifest-driven loader with cache, progress events and graceful placeholders.
 *
 * - `assets.preload(group?)` loads every manifest entry flagged `preload` (or a named group) and
 *   reports progress through `onProgress(loaded, total, id)` and the `assets:progress` event.
 * - `assets.texture(id)`, `assets.model(id)`, `assets.hdr(id)`, `assets.audio(id)` return cached
 *   results (async variants `load*` fetch on demand). A missing/broken file never throws: it logs a
 *   console.warn once and returns a placeholder (checker texture, magenta box, null audio buffer).
 * - Models are returned as SkeletonUtils clones so every instance can animate independently.
 * @module engine/assets
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { MANIFEST } from './manifest.js';

const ADDONS = new URL('../../vendor/addons/', import.meta.url).href;

export class Assets {
  /**
   * @param {object} [manifest] defaults to engine/manifest.js
   */
  constructor(manifest = MANIFEST) {
    this.manifest = manifest;
    this.events = null; // optional EventBus for 'assets:progress'
    this.renderer = null; // THREE.WebGLRenderer, needed by KTX2 transcoder support detection
    this.audioContext = null;
    this._cache = new Map(); // 'kind:id' → result
    this._pending = new Map(); // 'kind:id' → Promise
    this._warned = new Set();
    this._placeholders = {};
    this.manager = new THREE.LoadingManager();
    this.textureLoader = new THREE.TextureLoader(this.manager);
    this.hdrLoader = new HDRLoader(this.manager);
    this.exrLoader = new EXRLoader(this.manager);
    this.gltfLoader = new GLTFLoader(this.manager);
    this._draco = null;
    this._ktx2 = null;
  }

  /**
   * Attach renderer-dependent decoders (KTX2 needs the renderer to detect GPU formats).
   * @param {THREE.WebGLRenderer} renderer
   */
  init(renderer, events = null, audioContext = null) {
    this.renderer = renderer;
    this.events = events;
    this.audioContext = audioContext;
    return this;
  }

  _url(entry) {
    const url = typeof entry === 'string' ? entry : entry.url;
    if (/^(https?:|data:|blob:|\/)/.test(url)) return url;
    return (this.manifest.base || '') + url;
  }

  _warn(key, err) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    console.warn(`[assets] ${key} unavailable, using placeholder:`, err?.message || err);
  }

  _ensureGltfDecoders() {
    if (!this._draco) {
      this._draco = new DRACOLoader(this.manager).setDecoderPath(ADDONS + 'libs/draco/');
      this.gltfLoader.setDRACOLoader(this._draco);
      this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    }
    if (!this._ktx2 && this.renderer) {
      this._ktx2 = new KTX2Loader(this.manager).setTranscoderPath(ADDONS + 'libs/basis/').detectSupport(this.renderer);
      this.gltfLoader.setKTX2Loader(this._ktx2);
    }
  }

  /** Memoise one async load per key. */
  _once(key, fn) {
    if (this._cache.has(key)) return Promise.resolve(this._cache.get(key));
    if (this._pending.has(key)) return this._pending.get(key);
    const p = fn().then((v) => {
      this._cache.set(key, v);
      this._pending.delete(key);
      return v;
    });
    this._pending.set(key, p);
    return p;
  }

  // ------------------------------------------------------------ placeholders

  /** 8×8 grey checker (tinted), marks missing textures without looking broken. */
  placeholderTexture() {
    if (!this._placeholders.texture) {
      const size = 8;
      const data = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const v = (x + y) % 2 ? 120 : 150;
          data.set([v, v, v, 255], (y * size + x) * 4);
        }
      }
      const t = new THREE.DataTexture(data, size, size);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      this._placeholders.texture = t;
    }
    return this._placeholders.texture;
  }

  /** Magenta box standing in for a missing model (a fresh object each call). */
  placeholderModel() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff00ff, roughness: 0.8 }));
    m.position.y = 0.5;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    g.userData.placeholder = true;
    return { scene: g, animations: [], placeholder: true };
  }

  // ------------------------------------------------------------ loaders

  /**
   * Load a texture by manifest id or URL.
   * @param {string} idOrUrl
   * @param {{colorSpace?: 'srgb'|'linear', repeat?: number[], anisotropy?: number}} [opts]
   * @returns {Promise<THREE.Texture>}
   */
  loadTexture(idOrUrl, opts = {}) {
    const entry = this.manifest.textures[idOrUrl] || { url: idOrUrl };
    const key = `textures:${idOrUrl}`;
    return this._once(key, async () => {
      try {
        const url = this._url(entry);
        const tex = url.endsWith('.ktx2')
          ? (this._ensureGltfDecoders(), await this._ktx2.loadAsync(url))
          : await this.textureLoader.loadAsync(url);
        const o = { ...entry, ...opts };
        tex.colorSpace = o.colorSpace === 'linear' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        if (o.repeat) tex.repeat.set(o.repeat[0], o.repeat[1]);
        tex.anisotropy = o.anisotropy ?? (this.renderer ? Math.min(8, this.renderer.capabilities.getMaxAnisotropy()) : 4);
        return tex;
      } catch (err) {
        this._warn(key, err);
        return this.placeholderTexture();
      }
    });
  }

  /**
   * Load a glTF/GLB model. Resolves to the raw gltf ({scene, animations, …}) — use model(id) for clones.
   * @returns {Promise<{scene: THREE.Object3D, animations: THREE.AnimationClip[], placeholder?: boolean}>}
   */
  loadModel(idOrUrl) {
    const entry = this.manifest.models[idOrUrl] || { url: idOrUrl };
    const key = `models:${idOrUrl}`;
    return this._once(key, async () => {
      try {
        this._ensureGltfDecoders();
        const gltf = await this.gltfLoader.loadAsync(this._url(entry));
        gltf.scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        return gltf;
      } catch (err) {
        this._warn(key, err);
        return this.placeholderModel();
      }
    });
  }

  /**
   * Load an equirectangular HDR (.hdr or .exr) for image based lighting.
   * @returns {Promise<THREE.DataTexture|null>} null when unavailable
   */
  loadHDR(idOrUrl) {
    const entry = this.manifest.hdr[idOrUrl] || { url: idOrUrl };
    const key = `hdr:${idOrUrl}`;
    return this._once(key, async () => {
      try {
        const url = this._url(entry);
        const tex = await (url.endsWith('.exr') ? this.exrLoader : this.hdrLoader).loadAsync(url);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        return tex;
      } catch (err) {
        this._warn(key, err);
        return null;
      }
    });
  }

  /**
   * Fetch and decode an audio file (needs an AudioContext; returns null without one or on failure).
   * @returns {Promise<AudioBuffer|null>}
   */
  loadAudio(idOrUrl, audioContext = this.audioContext) {
    const entry = this.manifest.audio[idOrUrl] || { url: idOrUrl };
    const key = `audio:${idOrUrl}`;
    return this._once(key, async () => {
      if (!audioContext) return null;
      try {
        const res = await fetch(this._url(entry));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await audioContext.decodeAudioData(await res.arrayBuffer());
      } catch (err) {
        this._warn(key, err);
        return null;
      }
    });
  }

  // ------------------------------------------------------------ sync accessors (after preload)

  /** Cached texture or placeholder. */
  texture(id) {
    return this._cache.get(`textures:${id}`) || this.placeholderTexture();
  }

  /**
   * Fresh clone of a cached model's scene (skinned meshes cloned correctly), or a placeholder.
   * @returns {{scene: THREE.Object3D, animations: THREE.AnimationClip[], placeholder?: boolean}}
   */
  model(id) {
    const gltf = this._cache.get(`models:${id}`);
    if (!gltf || gltf.placeholder) return this.placeholderModel();
    return { scene: SkeletonUtils.clone(gltf.scene), animations: gltf.animations, placeholder: false };
  }

  /** Cached HDR texture or null. */
  hdr(id) {
    return this._cache.get(`hdr:${id}`) || null;
  }

  /** Cached AudioBuffer or null. */
  audio(id) {
    return this._cache.get(`audio:${id}`) || null;
  }

  /** True when an id is declared in the manifest. */
  has(kind, id) {
    return !!this.manifest[kind]?.[id];
  }

  // ------------------------------------------------------------ batch

  /**
   * List of `kind:id` refs for a group, or every entry flagged `preload`.
   * @param {string} [group]
   */
  refs(group) {
    if (group) return [...(this.manifest.groups?.[group] || [])];
    const out = [];
    for (const kind of ['textures', 'models', 'hdr', 'audio']) {
      for (const [id, e] of Object.entries(this.manifest[kind] || {})) if (e.preload) out.push(`${kind}:${id}`);
    }
    return out;
  }

  /**
   * Load a set of assets with progress reporting. Never rejects.
   * @param {string|string[]} [groupOrRefs] group name, list of 'kind:id' refs, or omitted (= preload set)
   * @param {(loaded: number, total: number, ref: string) => void} [onProgress]
   */
  async preload(groupOrRefs, onProgress) {
    const refs = Array.isArray(groupOrRefs) ? groupOrRefs : this.refs(groupOrRefs);
    const total = refs.length;
    let loaded = 0;
    const report = (ref) => {
      onProgress?.(loaded, total, ref);
      this.events?.emit('assets:progress', { loaded, total, ref });
    };
    report(null);
    await Promise.all(refs.map(async (ref) => {
      const [kind, id] = ref.split(':');
      if (kind === 'textures') await this.loadTexture(id);
      else if (kind === 'models') await this.loadModel(id);
      else if (kind === 'hdr') await this.loadHDR(id);
      else if (kind === 'audio') await this.loadAudio(id);
      loaded++;
      report(ref);
    }));
    return { loaded, total };
  }

  /** Free GPU resources of cached textures/models. */
  dispose() {
    for (const v of this._cache.values()) {
      if (v?.isTexture) v.dispose();
      else if (v?.scene) v.scene.traverse((o) => { o.geometry?.dispose?.(); });
    }
    this._cache.clear();
    this._draco?.dispose();
    this._ktx2?.dispose();
  }
}

/** Shared singleton used by the game and art modules. */
export const assets = new Assets();
export default assets;
