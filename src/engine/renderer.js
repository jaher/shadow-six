/**
 * Renderer — WebGLRenderer + scene + lighting + shadows + post-processing + overlay pass.
 *
 * - Physically based lighting (r155+ light units), sRGB output, AgX/ACES/Neutral tone mapping.
 * - One sun DirectionalLight whose orthographic shadow frustum is refitted every frame to the ground
 *   footprint of the game camera (texel-snapped in light space → no shimmering while panning).
 * - Image based lighting: PMREM from an equirect HDR supplied by the mission/theater, otherwise a
 *   procedural sky environment (three's Sky), with RoomEnvironment as last-resort fallback.
 * - EffectComposer chain per quality preset (FXAA / SMAA, GTAO, HDR-thresholded bloom) ending in OutputPass
 *   (tone mapping + colour space conversion).
 * - `decalScene` holds the ground decals — vision cones, selection rings, move markers and the path preview
 *   (render/selection.js), BCD puppet disc / knock-out arcs, VFX scorch marks: drawn right after the world,
 *   depth-tested against it (no depth writes), so soldiers, vehicles, trees and buildings are drawn OVER them; tone-mapped with the world.
 *   Objects on XRAY_LAYER in it (the selection ring/path "ghosts") are drawn only by the XRayPass.
 * - `overlayScene` is drawn AFTER post-processing, straight to the canvas, without tone mapping or AO, and
 *   is not depth tested against the world (always on top): talking portraits.
 * @module engine/renderer
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { AlphaAwareGTAOPass } from './gtao-alpha.js';
import { gradeEquirect, gradeSkyMaterial } from './env-grade.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { LUTPass } from 'three/addons/postprocessing/LUTPass.js';
import { LUTCubeLoader } from 'three/addons/loaders/LUTCubeLoader.js';
import { CONFIG } from '../config.js';
import { THEATER_LIGHTING, resolveLighting, analyzeHDR, autoEnvIntensity } from './lighting.js';
import { gradeFor, bakeLUTData } from './grade.js';
import { SanitizePass, XRayPass, makeLUTTexture } from './post-passes.js';

/**
 * Quality presets. pixelRatio is a cap on window.devicePixelRatio.
 * Measured (2026-09-26, `__game.bench(150)`, RTX 5090 / ANGLE GL headless, 1920×1080, BEL M1–M3 placeholder art,
 * zoom 1 and 0.5; median GPU timer / median wall ms):
 *   DPR 1 → low 0.16–0.19 / 0.8–2.2 · medium 0.26–0.28 / 1.1–2.5 · high 0.61–1.10 / 1.9–3.8 · ultra 0.66–1.20 / 1.9–3.6
 *   DPR 2 (M3 zoom 0.5, worst case) → low 0.19 / 1.6 · medium 0.36 / 1.9 · high 1.28 / 2.8 · ultra 2.52 / 4.1
 * Re-measure when the real art lands (realism §3.8: a mid-range GPU is ~5–8× slower).
 * shadowRadius is the PCF filter radius in texels (r186 removed PCFSoftShadowMap; PCF + radius is soft).
 */
export const QUALITY_PRESETS = {
  low: {
    pixelRatio: 1, shadowMapSize: 1024, shadowRadius: 1.5, shadows: true, aa: 'fxaa', ao: false, bloom: false, envResolution: 128,
    sanitize: true, lut: true, xray: true,
  },
  medium: {
    pixelRatio: 1.25, shadowMapSize: 2048, shadowRadius: 2, shadows: true, aa: 'smaa', ao: false, bloom: true, bloomStrength: 0.1, bloomThreshold: 2.0, bloomRadius: 0.2,
    envResolution: 256, sanitize: true, lut: true, xray: true,
  },
  high: {
    pixelRatio: 1.5, shadowMapSize: 4096, shadowRadius: 2.5, shadows: true, aa: 'smaa',
    ao: true, aoSamples: 12, aoRadius: 0.9, aoBlend: 0.9, bloom: true, bloomStrength: 0.12, bloomThreshold: 2.0, bloomRadius: 0.2, envResolution: 256,
    sanitize: true, lut: true, xray: true,
  },
  ultra: {
    pixelRatio: 2, shadowMapSize: 8192, shadowRadius: 3, shadows: true, aa: 'smaa',
    ao: true, aoSamples: 16, aoRadius: 1.0, aoBlend: 1.0, bloom: true, bloomStrength: 0.14, bloomThreshold: 2.0, bloomRadius: 0.2, envResolution: 512,
    sanitize: true, lut: true, xray: true,
  },
};

const TONE_MAPPINGS = {
  agx: THREE.AgXToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  neutral: THREE.NeutralToneMapping,
  none: THREE.NoToneMapping,
};

/** Per-theater lighting defaults: see engine/lighting.js (re-exported for existing importers). */
export { THEATER_LIGHTING };

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

export class Renderer {
  /**
   * @param {HTMLElement} container element the canvas is appended to
   * @param {{preset?: string, toneMapping?: string, exposure?: number, preserveDrawingBuffer?: boolean}} [opts]
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.presetName = opts.preset || CONFIG.render.preset;
    this.preset = QUALITY_PRESETS[this.presetName] || QUALITY_PRESETS.high;

    const r = new THREE.WebGLRenderer({
      antialias: false, // AA is done in post (FXAA/SMAA)
      powerPreference: 'high-performance',
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
      stencil: false,
    });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = TONE_MAPPINGS[opts.toneMapping || CONFIG.render.toneMapping] ?? THREE.AgXToneMapping;
    r.toneMappingExposure = opts.exposure ?? CONFIG.render.exposure;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.domElement.tabIndex = 0;
    container.appendChild(r.domElement);
    /** @type {THREE.WebGLRenderer} */
    this.renderer = r;
    this.domElement = r.domElement;

    /** Main world scene (lit, shadowed, post-processed). */
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x202018);
    /**
     * Ground-decal scene (vision cones, selection rings / move markers / path preview, scorch decals): drawn
     * right after the world into the same colour+depth buffer, depth-tested against it (no depth writes), so
     * soldiers, props and buildings stand ON the decal as in BEL. Goes through AO/tone mapping with the world.
     * XRAY_LAYER objects in it are drawn by the XRayPass only (selection ghosts under x-rayed commandos).
     */
    this.decalScene = new THREE.Scene();
    /** Overlay scene drawn after post-processing (unlit, not tone-mapped, always on top; BCD overlays). */
    this.overlayScene = new THREE.Scene();

    // Lights --------------------------------------------------------------
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.name = 'sun';
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 600;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd4ee, 0x5a5236, 0.5);
    this.hemi.name = 'hemi';
    this.scene.add(this.hemi);
    /** Unit vector pointing from the ground TOWARDS the sun. */
    this.sunDir = new THREE.Vector3(0.3, 0.7, 0.6).normalize();
    this.shadowCasterHeight = 16; // tallest expected caster (m) for shadow fitting
    this.mapCenter = new THREE.Vector3();
    this.theater = null;

    this.pmrem = new THREE.PMREMGenerator(r);
    this._envRT = null;
    this.camera = null;
    this.composer = null;
    this.passes = {};
    /** Post-chain insertion points (see addPostHook): slot → [fn(composer, passes, renderer) → Pass|Pass[]|void]. */
    this.postHooks = { afterWorld: [], afterAO: [], fx: [] };
    /** X-ray silhouettes (design-spec §2.4): () => Object3D[] of friendly units to reveal behind occluders. */
    this.xrayTargets = null;
    this.xrayOptions = { ...(CONFIG.render.xray || {}) };
    /** Current display-referred grade: { id, texture: Data3DTexture, size } (see setLUT). */
    this.lut = null;
    this.frame = 0;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  // ------------------------------------------------------------------ setup

  /**
   * Set the camera used by every pass (the CameraController's OrthographicCamera).
   * @param {THREE.Camera} camera
   */
  setCamera(camera) {
    this.camera = camera;
    this._buildComposer();
    this.resize();
  }

  /**
   * Switch quality preset at runtime ('low' | 'medium' | 'high' | 'ultra').
   * @param {string} name
   */
  setPreset(name) {
    if (!QUALITY_PRESETS[name]) throw new Error(`unknown quality preset "${name}"`);
    this.presetName = name;
    this.preset = QUALITY_PRESETS[name];
    this._applyShadowPreset();
    if (this.camera) {
      this._buildComposer();
      this.resize();
    }
    if (this.theater) this._applyEnvironment(this.theater);
  }

  /** @param {'agx'|'aces'|'neutral'|'none'} name */
  setToneMapping(name) {
    this.renderer.toneMapping = TONE_MAPPINGS[name] ?? THREE.AgXToneMapping;
  }

  /** @param {number} v */
  setExposure(v) {
    this.renderer.toneMappingExposure = v;
  }

  _applyShadowPreset() {
    const p = this.preset;
    const sh = this.sun.shadow;
    this.renderer.shadowMap.enabled = p.shadows;
    this.sun.castShadow = p.shadows;
    if (sh.mapSize.x !== p.shadowMapSize) {
      sh.mapSize.set(p.shadowMapSize, p.shadowMapSize);
      if (sh.map) {
        sh.map.dispose();
        sh.map = null;
      }
    }
    sh.radius = p.shadowRadius * (this.theater?.shadowSoft ?? 1); // overcast skies → softer shadows
    sh.blurSamples = 8;
    this.renderer.shadowMap.needsUpdate = true;
  }

  /**
   * Register a post-processing insertion point callback. Slots:
   *  - 'afterWorld': after the world + decal render (colour and depth of the opaque world in the read buffer), before AO
   *  - 'afterAO'   : after GTAO (or right after 'afterWorld' when AO is off), before bloom/OutputPass/AA
   *  - 'fx'        : after every 'afterAO' pass (water surface, late FX layer), before sanitize/bloom — the VFX pass
   *                  (smoke/fire/flashes composite over world AND water; HDR fire still feeds bloom + tone mapping)
   * fn(composer, passes, renderer) is called on every composer (re)build (preset change) and returns the Pass(es)
   * to insert, in order. Returns a function that removes the hook (and rebuilds the chain).
   * @param {'afterWorld'|'afterAO'|'fx'} slot @param {Function} fn @returns {() => void}
   */
  addPostHook(slot, fn) {
    if (!this.postHooks[slot]) throw new Error(`unknown post hook slot "${slot}"`);
    this.postHooks[slot].push(fn);
    if (this.camera) { this._buildComposer(); this.resize(); }
    return () => {
      const i = this.postHooks[slot].indexOf(fn);
      if (i >= 0) this.postHooks[slot].splice(i, 1);
      if (this.camera) { this._buildComposer(); this.resize(); }
    };
  }

  _runPostHooks(slot, composer, passes) {
    for (const fn of this.postHooks[slot]) {
      const out = fn(composer, passes, this);
      for (const p of [].concat(out || [])) composer.addPass(p);
    }
  }

  _buildComposer() {
    if (this.composer) {
      for (const pass of this.composer.passes) pass.dispose?.();
      this.composer.dispose();
    }
    this._applyShadowPreset();
    const p = this.preset;
    const size = this.renderer.getSize(new THREE.Vector2());
    const composer = new EffectComposer(this.renderer);
    const passes = {};
    passes.render = new RenderPass(this.scene, this.camera);
    composer.addPass(passes.render);
    // decals share the world's depth buffer (same read buffer, no clear) → occluded by world geometry
    passes.decals = new RenderPass(this.decalScene, this.camera);
    passes.decals.clear = false;
    composer.addPass(passes.decals);
    this._runPostHooks('afterWorld', composer, passes);
    // x-ray silhouettes need the world depth still bound to the read buffer → right after the world
    const xo = this.xrayOptions;
    if (p.xray && xo.enabled !== false) {
      passes.xray = new XRayPass(this.scene, this.camera, () => this.xrayTargets?.() || [], xo, this.decalScene);
      composer.addPass(passes.xray);
    }
    if (p.ao) {
      passes.ao = new AlphaAwareGTAOPass(this.scene, this.camera, Math.max(1, size.x), Math.max(1, size.y));
      passes.ao.output = GTAOPass.OUTPUT.Default;
      passes.ao.blendIntensity = p.aoBlend ?? 1;
      passes.ao.updateGtaoMaterial({ radius: p.aoRadius ?? 0.8, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: p.aoSamples ?? 12 });
      passes.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      composer.addPass(passes.ao);
    }
    // water surface, late transparent FX etc.: after AO (never darkened by it), before bloom/tone mapping
    this._runPostHooks('afterAO', composer, passes);
    this._runPostHooks('fx', composer, passes);
    // NaN/Inf guard before anything that spreads pixels (bloom) — realism §3.3 step 5
    if (p.sanitize) {
      passes.sanitize = new SanitizePass(64);
      composer.addPass(passes.sanitize);
    }
    if (p.bloom) {
      // threshold in LINEAR HDR (before OutputPass tone mapping): a sunlit white wall is ~1, so only
      // emissive sources / hot speculars (lamps, muzzle flashes, fire; emissiveIntensity > 2) bloom.
      passes.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), p.bloomStrength ?? 0.12, p.bloomRadius ?? 0.2, p.bloomThreshold ?? 2.0);
      composer.addPass(passes.bloom);
    }
    passes.output = new OutputPass();
    composer.addPass(passes.output);
    // per-theater grade on the display-referred image (design-spec §2.4: AgX, then a 3D LUT)
    if (p.lut && CONFIG.render.lut !== false) {
      passes.lut = new LUTPass({ lut: this.lut?.texture || null, intensity: this.lut?.intensity ?? 1 });
      passes.lut.enabled = !!this.lut?.texture;
      composer.addPass(passes.lut);
    }
    // Anti-aliasing runs on the display-referred (tone-mapped) image, as SMAA/FXAA expect.
    if (p.aa === 'smaa') {
      passes.aa = new SMAAPass();
      composer.addPass(passes.aa);
    } else if (p.aa === 'fxaa') {
      passes.aa = new FXAAPass();
      composer.addPass(passes.aa);
    }
    this.composer = composer;
    this.passes = passes;
  }

  // ------------------------------------------------------------------ lighting & environment

  /**
   * Apply a theater's lighting (by name or explicit object) with a mission's `lighting` block on top
   * ({ sunElevDeg, sunAzimuthDeg, kelvin, hdri, fog, lut, … } — see engine/lighting.js resolveLighting).
   * With an HDR texture the sky fill (envIntensity) is derived from its measured irradiance unless the mission
   * sets envIntensity; texels > 24 are clamped before the PMREM (realism §1.1.5).
   * @param {string|object} theater
   * @param {object} [overrides] mission.lighting (or renderer-native keys)
   * @param {{hdrTexture?: THREE.Texture|null}} [opts] equirect HDR for IBL (from engine/assets)
   */
  setTheater(theater, overrides = null, opts = {}) {
    const L = resolveLighting(theater, overrides);
    this.theater = L;
    this.theaterHdr = opts.hdrTexture || null;
    if (this.theaterHdr) {
      const a = analyzeHDR(this.theaterHdr);
      if (a) {
        L.hdrStats = { E1: +a.E1.toFixed(3), sunLum: +a.sunLum.toFixed(1), clamped: a.clamped };
        if (L.autoEnv) L.envIntensity = +autoEnvIntensity(L, a).toFixed(3);
      }
    }
    this.setSun(L.sunAzimuth, L.sunElevation, L.sunColor, L.sunIntensity);
    this.hemi.color.set(L.hemiSky);
    this.hemi.groundColor.set(L.hemiGround);
    this.hemi.intensity = L.hemiIntensity;
    this.setExposure(L.exposure ?? 1);
    this.setFog(L.fog);
    this._applyShadowPreset();
    this._applyEnvironment(L);
    this.setLUT(L.lut ?? null);
  }

  /**
   * Mission lighting from the mission file: resolves the theater + `def.lighting`, loads the HDRI through
   * the asset loader (manifest ids = engine/lighting.js HDRI keys; missing file → procedural sky) and applies it.
   * @param {{theater?: string, lighting?: object}} def
   * @param {{assets?: {loadHDR: (id: string) => Promise<THREE.Texture|null>}}} [opts]
   * @returns {Promise<object>} the resolved lighting
   */
  async applyMissionLighting(def, { assets = null } = {}) {
    const theater = def?.theater || 'temperate';
    const L = resolveLighting(theater, def?.lighting || null);
    let hdr = null;
    if (L.hdriId && assets?.loadHDR) {
      try { hdr = await assets.loadHDR(L.hdriId); } catch { hdr = null; }
    }
    this.setTheater(theater, def?.lighting || null, { hdrTexture: hdr });
    return this.theater;
  }

  /**
   * Set the display-referred grade: a GRADES id (engine/grade.js), a params object, a `.cube` URL, or null (off).
   * @param {string|object|null} lut @param {number} [intensity]
   */
  setLUT(lut, intensity = 1) {
    this._lutCache ||= new Map();
    if (!lut) this.lut = null;
    else if (typeof lut === 'string' && lut.endsWith('.cube')) {
      const url = lut;
      this.lut = this._lutCache.get(url) || null;
      if (!this.lut) {
        new LUTCubeLoader().loadAsync(url).then((res) => {
          const e = { id: url, texture: res.texture3D, size: res.size, intensity };
          this._lutCache.set(url, e);
          if (this.theater?.lut === url) { this.lut = e; this._syncLUTPass(); }
        }).catch((err) => console.warn(`[renderer] LUT ${url} failed`, err));
      }
    } else {
      const key = typeof lut === 'string' ? lut : null;
      let e = key && this._lutCache.get(key);
      if (!e) {
        const size = 32;
        e = { id: key || 'custom', texture: makeLUTTexture(bakeLUTData(key ? gradeFor(key) : lut, size), size), size, intensity };
        if (key) this._lutCache.set(key, e);
      }
      this.lut = { ...e, intensity };
    }
    this._syncLUTPass();
  }

  _syncLUTPass() {
    const pass = this.passes?.lut;
    if (!pass) return;
    pass.lut = this.lut?.texture || null;
    pass.intensity = this.lut?.intensity ?? 1;
    pass.enabled = !!this.lut?.texture;
  }

  /**
   * Place the sun. Azimuth in compass degrees (0 = N, 90 = E), elevation in degrees above horizon.
   */
  setSun(azimuthDeg, elevationDeg, color = 0xffffff, intensity = 3) {
    const az = THREE.MathUtils.degToRad(azimuthDeg);
    const el = THREE.MathUtils.degToRad(elevationDeg);
    // Compass: north = -Z, east = +X.
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.sun.color.set(color);
    this.sun.intensity = intensity;
  }

  /**
   * Image based lighting from an equirectangular HDR texture (null → procedural sky → RoomEnvironment).
   * @param {THREE.Texture|null} hdrTexture
   * @param {{intensity?: number, background?: boolean}} [opts]
   */
  setEnvironment(hdrTexture, opts = {}) {
    this.theaterHdr = hdrTexture;
    const L = { ...(this.theater || THEATER_LIGHTING.temperate) };
    if (opts.intensity !== undefined) L.envIntensity = opts.intensity;
    L.envBackground = !!opts.background;
    this.theater = L;
    this._applyEnvironment(L);
  }

  _applyEnvironment(L) {
    // same HDRI + same lighting as the environment in use (a restart, the next mission in the theatre): keep the
    // filtered PMREM instead of grading + filtering it again
    let key = null;
    try { key = `${this.theaterHdr?.uuid || 'sky'}|${JSON.stringify(L)}`; } catch { key = null; }
    if (key && key === this._envKey && this._envRT) {
      this.scene.environment = this._envRT.texture;
      this.scene.environmentIntensity = L.envIntensity ?? 0.5;
      this._rebindEnvironment();
      if (L.envBackground) this.scene.background = this._envRT.texture;
      return;
    }
    this._envKey = key;
    const old = this._envRT;
    let rt = null;
    try {
      if (this.theaterHdr) {
        this.theaterHdr.mapping = THREE.EquirectangularReflectionMapping;
        const sat = L.envSaturation ?? 1, warm = L.envWarmth ?? 0;
        if (sat !== 1 || warm) { // must-fix 2: grade the blue sky chroma before PMREM filtering
          const g = gradeEquirect(this.renderer, this.theaterHdr, sat, warm);
          rt = this.pmrem.fromEquirectangular(g.texture);
          g.dispose();
        } else rt = this.pmrem.fromEquirectangular(this.theaterHdr);
      } else {
        rt = this._skyEnvironment(L);
      }
    } catch (err) {
      console.warn('[renderer] environment generation failed, using RoomEnvironment', err);
      rt = null;
    }
    if (!rt) {
      const room = new RoomEnvironment();
      rt = this.pmrem.fromScene(room, 0.04);
      room.dispose?.();
    }
    this._envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = L.envIntensity ?? 0.5;
    this._rebindEnvironment();
    if (L.envBackground) this.scene.background = rt.texture;
    old?.dispose();
  }

  /**
   * Must-fix 2: three.js replaces material.envMapIntensity by scene.environmentIntensity whenever material.envMap
   * is null. Bound materials get the environment explicitly, so their envMapIntensity = theater envIntensity × scale
   * is honoured (terrain, foliage and snow use scale < 1 / > 1 instead of desaturating their own ambient).
   * Re-applied automatically on every environment/theater change. Returns an unbind function.
   * @param {THREE.Material} material @param {number} [scale]
   */
  bindEnvironment(material, scale = 1) {
    (this._envBound ||= new Map()).set(material, scale);
    this._rebindEnvironment();
    const onDispose = () => this._envBound?.delete(material);
    material.addEventListener('dispose', onDispose);
    return () => { this._envBound?.delete(material); material.removeEventListener('dispose', onDispose); };
  }

  _rebindEnvironment() {
    if (!this._envBound) return;
    const env = this.scene.environment, I = this.scene.environmentIntensity;
    for (const [m, k] of this._envBound) {
      if (m.envMap !== env) { m.envMap = env; m.needsUpdate = true; }
      m.envMapIntensity = I * k;
    }
  }

  _skyEnvironment(L) {
    const sky = new Sky();
    gradeSkyMaterial(sky.material, L.envSaturation ?? 1, L.envWarmth ?? 0);
    sky.scale.setScalar(1000);
    const u = sky.material.uniforms;
    const s = L.sky || {};
    u.turbidity.value = s.turbidity ?? 3;
    u.rayleigh.value = s.rayleigh ?? 1.5;
    u.mieCoefficient.value = s.mieCoefficient ?? 0.005;
    u.mieDirectionalG.value = s.mieDirectionalG ?? 0.8;
    if (u.showSunDisc) u.showSunDisc.value = 0; // the DirectionalLight is the sun; avoid a double highlight
    if (u.cloudCoverage) u.cloudCoverage.value = s.cloudCoverage ?? 0.25;
    u.sunPosition.value.copy(this.sunDir).multiplyScalar(1000);
    const scene = new THREE.Scene();
    scene.add(sky);
    const rt = this.pmrem.fromScene(scene, 0.02, 1, 5000, { size: this.preset.envResolution ?? 256 });
    sky.geometry.dispose();
    sky.material.dispose();
    return rt;
  }

  /**
   * Linear fog around the camera distance so the far (top) part of the screen gets slightly hazier.
   * `near`/`far` are measured beyond the camera target distance. Pass null to disable.
   * @param {{color:number, near:number, far:number}|null} fog
   */
  setFog(fog) {
    if (!fog) {
      this.scene.fog = null;
      return;
    }
    this.fogSpec = fog;
    const d = CONFIG.camera.distance;
    this.scene.fog = new THREE.Fog(fog.color, d + fog.near - 60, d + fog.far);
    // Off-map surround (seen at the widest zoom on narrow maps): a dark, fog-tinted slate like the original's
    // black border — a light fog grey read as unfinished ground (art review).
    this.scene.background = new THREE.Color(fog.color).multiplyScalar(0.07);
  }

  /** Map extent, used to keep the sun position stable (stable light-space → snapped shadows). */
  setMapBounds(width, depth) {
    this.mapCenter.set(width / 2, 0, depth / 2);
    this.mapRadius = Math.hypot(width, depth) / 2;
  }

  /**
   * Refit the sun's shadow frustum to the visible ground (call once per frame before render()).
   * @param {{groundFootprint: (y?: number) => {x:number, y?:number, z:number}[]}} cameraController
   */
  fitShadowToView(cameraController) {
    if (!this.preset.shadows) return;
    const H = this.shadowCasterHeight;
    // Screen-corner rays hit y=0 and y=H at DIFFERENT xz (oblique view): fit both sets of real hit
    // points, so roofs/canopies seen at a screen corner stay inside the shadow camera.
    const pts = cameraController.groundFootprint(0).map((p) => ({ x: p.x, y: 0, z: p.z }));
    const top = cameraController.groundFootprint(H);
    if (top.length && top[0].y === H) pts.push(...top);
    else for (const p of pts.slice()) pts.push({ x: p.x, y: H, z: p.z }); // controller without height support
    const sun = this.sun;
    const dist = 400;
    sun.position.copy(this.mapCenter).addScaledVector(this.sunDir, dist);
    sun.target.position.copy(this.mapCenter);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    // Light view matrix (same as the one LightShadow builds from position → target).
    _m.lookAt(sun.position, sun.target.position, _up);
    _m.setPosition(sun.position);
    const view = _m.clone().invert();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    // Each hit point at y=H casts down to the ground too (its shadow receiver may be the ground under it):
    // include the vertical segment for both sets.
    for (const p of pts) {
      for (const y of [0, H]) {
        _v.set(p.x, y, p.z).applyMatrix4(view);
        minX = Math.min(minX, _v.x); maxX = Math.max(maxX, _v.x);
        minY = Math.min(minY, _v.y); maxY = Math.max(maxY, _v.y);
        minZ = Math.min(minZ, _v.z); maxZ = Math.max(maxZ, _v.z);
      }
    }
    const pad = 2;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    // Snap extents to shadow texels to avoid shimmering while panning.
    const size = this.preset.shadowMapSize;
    const w = Math.max(maxX - minX, maxY - minY);
    const texel = w / size;
    const snap = (v) => Math.floor(v / texel) * texel;
    const cx = snap((minX + maxX) / 2), cy = snap((minY + maxY) / 2);
    const half = Math.ceil(w / 2 / texel) * texel;
    const cam = sun.shadow.camera;
    cam.left = cx - half;
    cam.right = cx + half;
    cam.bottom = cy - half;
    cam.top = cy + half;
    cam.near = Math.max(0.5, -maxZ - 40);
    cam.far = -minZ + 40;
    cam.updateProjectionMatrix();
    // Normal bias scales with texel size so small texels don't over-offset.
    sun.shadow.normalBias = THREE.MathUtils.clamp(texel * 1.5, 0.01, 0.08);
  }

  // ------------------------------------------------------------------ frame

  /** Resize canvas, composer and passes to the container. */
  resize() {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    const pr = Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
    this.width = w;
    this.height = h;
    this.onResize?.(w, h);
  }

  /**
   * Draw one frame: post-processed world, then the overlay scene on top.
   * @param {number} [dt] frame delta (s), forwarded to time-based passes
   */
  render(dt = 1 / 60) {
    if (!this.camera) return;
    this.frame++;
    // whole-frame stats: the composer + overlay call render() many times per frame
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    if (this.composer) this.composer.render(dt);
    else {
      this.renderer.render(this.scene, this.camera);
      if (this.decalScene.children.length) {
        const r = this.renderer;
        const prevAuto = r.autoClear;
        r.autoClear = false;
        r.render(this.decalScene, this.camera); // keeps the world depth buffer
        r.autoClear = prevAuto;
      }
    }
    if (this.overlayScene.children.length) {
      const r = this.renderer;
      const prevAuto = r.autoClear;
      const prevTone = r.toneMapping;
      r.autoClear = false;
      r.toneMapping = THREE.NoToneMapping;
      r.setRenderTarget(null);
      r.clearDepth();
      r.render(this.overlayScene, this.camera);
      r.toneMapping = prevTone;
      r.autoClear = prevAuto;
    }
  }

  /** Renderer statistics for the debug overlay/tests (whole-frame totals: info is reset once per frame). */
  stats() {
    const i = this.renderer.info;
    return {
      preset: this.presetName,
      calls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      pixelRatio: this.renderer.getPixelRatio(),
      size: [this.width, this.height],
      passes: this.composer ? this.composer.passes.map((p) => p.constructor.name) : [],
      lighting: this.theater ? {
        theater: this.theater.theaterName, hdri: this.theater.hdriId || null, hdrLoaded: !!this.theaterHdr, lut: this.lut?.id || null,
        sunAzimuth: this.theater.sunAzimuth, sunElevation: this.theater.sunElevation, kelvin: this.theater.kelvin,
        envIntensity: this.scene.environmentIntensity, fog: this.scene.fog ? [+this.scene.fog.near.toFixed(1), +this.scene.fog.far.toFixed(1)] : null,
        sunDir: this.sunDir.toArray().map((v) => +v.toFixed(3)),
      } : null,
    };
  }

  /**
   * Read back the canvas right after a frame (no preserveDrawingBuffer needed within the same task) and
   * summarise it for the CI smoke test (realism §3.9): mean/std per channel, mean HSV saturation, mean
   * luminance, fraction of near-black pixels, gl.isContextLost(). Samples every `step`-th pixel.
   */
  frameStats(step = 3) {
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    this.renderer.setRenderTarget(null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0, sr = 0, sg = 0, sb = 0, qr = 0, qg = 0, qb = 0, sat = 0, black = 0;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const o = (y * w + x) * 4, r = px[o], g = px[o + 1], b = px[o + 2];
        sr += r; sg += g; sb += b; qr += r * r; qg += g * g; qb += b * b;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx > 0) sat += (mx - mn) / mx;
        if (mx < 8) black++;
        n++;
      }
    }
    const m = [sr / n, sg / n, sb / n];
    const sd = [Math.sqrt(Math.max(0, qr / n - m[0] ** 2)), Math.sqrt(Math.max(0, qg / n - m[1] ** 2)), Math.sqrt(Math.max(0, qb / n - m[2] ** 2))];
    const f = (v) => +v.toFixed(2);
    return {
      mean: m.map(f), std: sd.map(f), luma: f(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]), saturation: +(sat / n).toFixed(3),
      black: +(black / n).toFixed(4), contextLost: gl.isContextLost(), size: [w, h], preset: this.presetName,
      lut: this.lut?.id || null, toneMapping: this.renderer.toneMapping, xray: this.passes.xray?.drawn ?? null,
    };
  }

  /** Is this a real GPU (vs SwiftShader software rendering)? */
  gpuInfo() {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.composer?.dispose();
    this._envRT?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
