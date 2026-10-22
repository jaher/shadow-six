/**
 * SHADOW SIX water — approach W-A (spectral / physical).
 *
 *   const water = createWater(renderer, scene, camera, { quality: 'high', envMap: hdrEquirect });
 *   water.addBody({ type: 'river', polygon: [[x,z],...], depth: 2, flow: { dir: [1,0], speed: 1.2 },
 *                   obstacles: [{ x, z, r }], level: 0, preset: 'river' });
 *   water.disturb(x, z, strength, radius);  // splashes, swimmer, boat wake, falling bodies
 *   water.update(dt);                        // BEFORE renderer.render(dt)
 *
 * `renderer` may be the project's engine Renderer (src/engine/renderer.js) — the WaterPass is inserted
 * after its `decals` pass and re-inserted whenever the composer is rebuilt (preset change) — or a bare
 * THREE.WebGLRenderer, in which case call water.attach(composer, index) yourself.
 * Frame order: FFT cascades → caustics → ripple sim → planar reflection(s) → [composer: world → decals →
 * WaterPass (copy colour+depth, draw water sampling both) → GTAO → bloom → output → AA].
 */
import * as THREE from 'three';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { DepthStashPass, WaterPass, LateFxPass, ensureDepthTextures, FX_LAYER } from './passes.js';
import { captureHeights, captureHeightsAsync, captureMaterial } from './fields.js';
import { FFTOcean, FFT_PERIOD } from './fft.js';
import { RippleSim } from './ripples.js';
import { Caustics } from './caustics.js';
import { bakeBodyG, bodyGrid } from './bake.js';
import { due, runSync } from '../../engine/slice.js';
import { compileAhead } from '../../engine/parallel-compile.js';
import { sessionCache, dataKey } from '../../engine/asset-cache.js';
import { withExtraCull, WorldBoxes } from '../../engine/cull-hooks.js';
import { sceneSignature, geometryHashG } from '../../world/placement-visual.js';

export { FX_LAYER };
import { makeWaterMaterial, TIME_LOOP } from './material.js';
import { dryHullUniforms, packDryHulls } from './hulls.js';
/**
 * Sun glint (material.js): the unresolved-glint sheen is soft-capped at SUN_SHEEN_CAP x the sun (2x on the sea), and a
 * sparkle facet that mirrors the sun shines SUN_GLITTER x Fresnel x the sun (~6 HDR at the 40° mirror angle). The
 * orthographic camera sees every pixel from the same direction, so an uncapped lobe whitened whole bodies at once
 * (M13-M15 at yaw 45 under the 40° NW sun). opts.sheenCap / opts.glitter override them.
 */
export const SUN_SHEEN_CAP = 0.025, SUN_GLITTER = 110;
/**
 * A diver under the surface (user 2026-10-11 "he should be visible clearly when under water"): seen through the
 * surface with the water's own tint, refraction and a slight blur, but as if under at most SUBMERGED_LOOK[1] m of it,
 * absorption × [0], plus a soft rim of scattered light round his silhouette ([2]); blur radius [3] px at zoom 1.
 */
export const SUBMERGED_LOOK = [0.55, 0.3, 0.5, 1.2];
/** Characters farther than this (m, XZ) from every reflecting water body are left out of the mirror render. */
const REFLECT_REACH = 6;

export const WATER_QUALITY = {
  low: { fftN: 64, seaFFT: false, caustics: false, reflection: 0, reflScale: 0, ripple: 256, seaSeg: 0.6, bodyRes: 128 },
  medium: { fftN: 128, seaFFT: true, caustics: true, causticsRes: 256, reflection: 1, reflScale: 0.35, reflEvery: 2, ripple: 256, seaSeg: 0.8, bodyRes: 192 },
  high: { fftN: 256, seaFFT: true, caustics: true, causticsRes: 512, reflection: 2, reflScale: 0.5, reflEvery: 2, ripple: 512, seaSeg: 1, bodyRes: 256 },
  ultra: { fftN: 256, seaFFT: true, caustics: true, causticsRes: 512, reflection: 3, reflScale: 0.75, reflEvery: 1, ripple: 768, seaSeg: 1.5, bodyRes: 320 },
};

/** Optical presets: absorption (1/m, linear RGB), in-scatter albedo colour, foam albedo, roughness. */
export const WATER_PRESETS = {
  sea: { absorb: [0.42, 0.075, 0.045], scatter: [0.010, 0.060, 0.070], foam: [0.9, 0.92, 0.93], roughness: 0.09, sss: 1.2 },
  harbor: { absorb: [0.75, 0.30, 0.32], scatter: [0.020, 0.046, 0.040], foam: [0.82, 0.84, 0.80], roughness: 0.08, sss: 0.9, turbidity: 0.1 },
  lake: { absorb: [0.60, 0.26, 0.30], scatter: [0.012, 0.035, 0.030], foam: [0.80, 0.80, 0.76], roughness: 0.05, sss: 0 },
  river: { absorb: [1.00, 0.62, 0.85], scatter: [0.050, 0.060, 0.036], foam: [0.80, 0.80, 0.75], roughness: 0.07, sss: 0, sheen: 1.6 },
  fjord: { absorb: [0.75, 0.32, 0.26], scatter: [0.004, 0.018, 0.024], foam: [0.86, 0.9, 0.93], roughness: 0.06, sss: 0.6 },
  reservoir: { absorb: [0.55, 0.20, 0.22], scatter: [0.010, 0.040, 0.042], foam: [0.82, 0.83, 0.80], roughness: 0.05, sss: 0 },
  // from W-B's turbidity looks: `turbidity` (1/m) is extinction by suspended matter added to absorption
  clear: { absorb: [0.45, 0.075, 0.035], scatter: [0.006, 0.050, 0.060], foam: [0.9, 0.92, 0.93], roughness: 0.06, sss: 0.8, turbidity: 0.02 },
  muddy: { absorb: [0.90, 0.55, 0.75], scatter: [0.060, 0.050, 0.028], foam: [0.78, 0.74, 0.66], roughness: 0.07, sss: 0, turbidity: 0.9 },
};

/** Cosine-weighted upper-hemisphere irradiance of an equirect HDR (DataTexture, float/half). */
function skyIrradiance(tex) {
  const img = tex && tex.image; if (!img || !img.data) return null;
  const { width: w, height: h, data } = img; const half = data instanceof Uint16Array;
  const ch = data.length / (w * h); const f = half ? THREE.DataUtils.fromHalfFloat : (x) => x;
  const out = new THREE.Vector3(); let wsum = 0;
  for (let y = 0; y < h / 2; y += 2) {
    const el = (0.5 - (y + 0.5) / h) * Math.PI; // flipY=false DataTexture: row 0 = top (zenith)
    const cosT = Math.sin(el), wgt = cosT * Math.cos(el);
    if (cosT <= 0) continue;
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * ch;
      out.x += f(data[i]) * wgt; out.y += f(data[i + 1]) * wgt; out.z += f(data[i + 2]) * wgt; wsum += wgt;
    }
  }
  return out.multiplyScalar(Math.PI / wsum); // E = pi * <L cos>/<cos>... (irradiance)
}

/**
 * Orthographic camera: make its near clip plane the world plane y = h (keeps y > h) with a depth range of `range` m from
 * it. Depth stays affine and increasing along every view ray (same visibility order); x/y rows are untouched.
 */
const _clipPlane = new THREE.Plane();
const _vp = new THREE.Matrix4(), _vpInv = new THREE.Matrix4(), _wb = new THREE.Box3(), _wp = new THREE.Vector3(), _wd = new THREE.Vector3();
const _jp = new THREE.Vector3(), _jq = new THREE.Quaternion();
/** Bilinear read of channel `c` (stride `st`) at cell k0 (row width rx), fractions tx / tz: sample()'s formula. */
function bilerp(arr, st, c, k0, rx, tx, tz) {
  return (arr[k0 * st + c] * (1 - tx) + arr[(k0 + 1) * st + c] * tx) * (1 - tz) + (arr[(k0 + rx) * st + c] * (1 - tx) + arr[(k0 + rx + 1) * st + c] * tx) * tz;
}
/** Mirror levels drawn in turn: each texture covers this much NDC past the screen edges (5 % of the width each side). */
const MIRROR_PAD = 0.1;
function obliqueNear(cam, h, range) {
  cam.updateMatrixWorld();
  _clipPlane.set(new THREE.Vector3(0, 1, 0), -h).applyMatrix4(cam.matrixWorldInverse);
  const n = _clipPlane.normal, k = 2 / Math.max(1, range), e = cam.projectionMatrix.elements;
  e[2] = n.x * k; e[6] = n.y * k; e[10] = n.z * k; e[14] = _clipPlane.constant * k - 1;
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
}

export class WaterSystem {
  constructor(renderer, scene, camera, opts = {}) {
    this.engine = renderer.renderer && renderer.composer !== undefined ? renderer : null;
    this.renderer = this.engine ? this.engine.renderer : renderer;
    this.scene = scene; this.camera = camera; this.opts = opts;
    this.qualityName = opts.quality || (this.engine && this.engine.presetName) || 'high';
    this.Q = WATER_QUALITY[this.qualityName] || WATER_QUALITY.high;
    this.time = opts.time || 0;
    this.bodies = []; this.frames = 0; this.lateRoots = []; this.texturesReady = Promise.resolve();
    this.waterScene = new THREE.Scene();
    this.shared = this._sharedUniforms();
    this.sea = { wind: 6.5, windDir: 0.6, fetch: 12000, chop: 1.25, patch: 97, ...(opts.sea || {}) };
    this.detail = { wind: 6, windDir: 0.9, fetch: 4000, chop: 0.9, patch: 21, ...(opts.detail || {}) };
    this._build();
    this.stash = null; this.pass = new WaterPass(this); this.fxPass = null;
    if (this.engine) this._hookEngine();
  }

  _sharedUniforms() {
    const v = (x) => ({ value: x });
    return {
      time: v(0), dispA: v(null), dispB: v(null), nrmA: v(null), nrmB: v(null), rippleTex: v(null),
      rippleArea: v(new THREE.Vector4(0, 0, 1, 1)), rippleTexel: v(1 / 512), detailTex: v(null), foamTex: v(null),
      causticsTex: v(null), causticsPatch: v(21), sceneColor: v(null), sceneDepth: v(null), resolution: v(new THREE.Vector2(1, 1)),
      projInv: v(new THREE.Matrix4()), camWorld: v(new THREE.Matrix4()), viewMat: v(new THREE.Matrix4()),
      uOrtho: v(1), camNear: v(0.1), camFar: v(1000), envTex: v(null), envIntensity: v(1), envRot: v(0), skyIrr: v(new THREE.Vector3(1, 1, 1)),
      sunDir: v(new THREE.Vector3(0.3, 0.8, -0.5).normalize()), sunColor: v(new THREE.Vector3(3, 3, 3)),
      plPos: v([0, 1, 2, 3].map(() => new THREE.Vector3())), plCol: v([0, 1, 2, 3].map(() => new THREE.Vector3())), plCount: v(0),
      fogOn: v(0), fogNear: v(100), fogFar: v(300), fogColor: v(new THREE.Vector3()),
      directFrac: v(1), sunShadow: v(null), sunShadowMat: v(new THREE.Matrix4()), shadowOn: v(0), shadowBias: v(0.0015), shadowTexel: v(new THREE.Vector2(1 / 4096, 1 / 4096)), dbg: v(this.opts.dbg | 0), flowPeriod: v(1.6), night: v(0),
      sheenCap: v(this.opts.sheenCap ?? SUN_SHEEN_CAP), glitter: v(SUN_GLITTER),
      // submerged divers (setSubmerged): their depth mask, on/off, look (absorption scale, view-path cap m, rim, blur px)
      subMask: v(null), subOn: v(0), subLook: v(new THREE.Vector4(...SUBMERGED_LOOK)), subBox: v(new THREE.Vector4(0, 0, 1, 1)),
      ...dryHullUniforms(),
    };
  }

  _build() {
    const r = this.renderer, Q = this.Q;
    this.detailOcean = new FFTOcean(r, { N: Q.fftN, patch: this.detail.patch, ...this.detail, cutoff: 0.01, depth: 20, seed: 0.71, foamBias: 0.35 });
    this.seaOcean = Q.seaFFT ? new FFTOcean(r, { N: Q.fftN, patch: this.sea.patch, ...this.sea, cutoff: 0.05, seed: 0.37 }) : null;
    this.ripples = new RippleSim(r, { resolution: Q.ripple, size: this.opts.rippleSize || 64 });
    this.caustics = Q.caustics ? new Caustics(r, this.detailOcean, { resolution: Q.causticsRes }) : null;
    const s = this.shared;
    s.rippleTexel.value = 1 / Q.ripple;
    s.causticsPatch.value = this.detail.patch;
    this.reflections = new Map(); // level → {rt, cam, matrix}
    // plain (uncompressed) maps on purpose: the shader thresholds foam and detail-normal glints, which would magnify
    // block-compression error (engine/gpu-compress.js compresses the material maps only)
    const loader = new THREE.TextureLoader();
    const base = this.opts.textureBase || new URL('../../../assets/water/', import.meta.url).href;
    if (!s.detailTex.value) {
      // texturesReady: resolves when both images are decoded (a map load awaits it, so the first frame has foam)
      const ld = (url) => { let t; const p = new Promise((ok) => { t = loader.load(base + url, ok, undefined, (e) => { console.error('[water] texture', url, e); ok(); }); }); return [t, p]; };
      const [t, pt] = ld('waternormals.jpg'); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; s.detailTex.value = t;
      const [f, pf] = ld('foam2.png'); f.wrapS = f.wrapT = THREE.RepeatWrapping; f.anisotropy = 8; s.foamTex.value = f;
      this.texturesReady = Promise.all([pt, pf]).then(() => undefined);
    }
    if (!this.caustics) { // flat caustics texture (value 1 = no modulation)
      this._flat = this._flat || new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1); this._flat.needsUpdate = true;
    }
  }

  /**
   * Engine integration. Preferred: the engine's official post hooks (renderer.addPostHook, see
   * engine/renderer-water-slot.patch): DepthStashPass at 'afterWorld', WaterPass + LateFxPass at 'afterAO'.
   * Fallback for an unpatched engine: the same hooks are emulated by wrapping _buildComposer once (shim).
   */
  _hookEngine() {
    const eng = this.engine;
    const world = (composer) => { ensureDepthTextures(composer); this.stash = new DepthStashPass(); return this.stash; };
    const late = (composer, passes) => {
      this.pass = new WaterPass(this, this.stash); this.fxPass = new LateFxPass(this.scene, this.camera, this.opts.fxLayer ?? FX_LAYER);
      this.fxPass.roots = this.lateRoots; // live array: callers push their FX roots (see addLateRoot)
      this.composer = composer;
      // ground decals (vision cones, markers) move after the water so they stay readable over rivers and fjords;
      // they are depth-tested against the world + water surface and are no longer darkened by AO
      if (this.opts.lateDecals && passes && passes.decals && eng.decalScene) {
        passes.decals.enabled = false;
        const dp = new RenderPass(eng.decalScene, eng.camera); dp.clear = false; passes.lateDecals = dp;
        return [this.pass, dp, this.fxPass];
      }
      return [this.pass, this.fxPass];
    };
    // the mirrors receive sun shadows too: their views keep the casters they show (engine/shadow-cull.js); 3 m slack for
    // the camera moving before the next reflection samples this frame's shadow map
    if (Array.isArray(eng.shadowViews)) {
      const out = [];
      const views = () => { out.length = 0; for (const R of this.reflections.values()) if (R.cam) out.push(R.view ||= { camera: R.cam, pad: 3 }); return out; };
      eng.shadowViews.push(views);
      this._unviews = () => { const i = eng.shadowViews.indexOf(views); if (i >= 0) eng.shadowViews.splice(i, 1); };
    }
    if (typeof eng.addPostHook === 'function') {
      this.hookMode = 'official';
      this._unhook = [eng.addPostHook('afterWorld', world), eng.addPostHook('afterAO', late)];
      return;
    }
    this.hookMode = 'shim';
    const orig = eng._buildComposer.bind(eng);
    const self = this;
    eng._buildComposer = function () {
      orig();
      const c = eng.composer, P = eng.passes;
      const iw = c.passes.indexOf(P.decals) + 1;
      c.insertPass(world(c), iw);
      const ia = P.ao ? c.passes.indexOf(P.ao) + 1 : iw + 1;
      late(c).forEach((p, k) => c.insertPass(p, ia + k));
    };
    this._unhook = [() => { eng._buildComposer = orig; if (eng.camera) { orig(); eng.resize(); } }];
    if (eng.camera) { eng._buildComposer(); eng.resize(); }
  }

  /** Register an Object3D whose FX_LAYER descendants must draw on the very frame they appear (particles, splashes). */
  addLateRoot(root) { if (root && !this.lateRoots.includes(root)) this.lateRoots.push(root); }

  /** Bare THREE.WebGLRenderer + your own EffectComposer: insert the water after your opaque passes (index). */
  attach(composer, index = 1) {
    ensureDepthTextures(composer);
    const i = composer.passes.indexOf(this.pass);
    if (i >= 0) composer.passes.splice(i, 1);
    this.stash = null; this.pass = new WaterPass(this, null);
    composer.insertPass(this.pass, Math.max(1, index));
    this.composer = composer;
  }

  /**
   * Add a water body.
   * @param {{type:'river'|'lake'|'sea', polygon:number[][], level?:number, depth?:number, preset?:string,
   *   flow?:{dir?:number[], speed?:number, centerline?:number[][]}, obstacles?:{x:number,z:number,r:number}[],
   *   bed?:(x:number,z:number)=>number, bankWidth?:number, ice?:number, surf?:{amp:number,length?:number,period?:number},
   *   reflect?:boolean, foamTrail?:number, absorb?:number[], scatter?:number[]}} o
   */
  addBody(o) { return runSync(this._addBodyG(o)); }

  /**
   * addBody() for a list of bodies as a sliced job (engine/slice.js; art/water.js buildWaterAsync drives it — the job
   * yields promises it waits for, and pauses): the same bodies as addBody one after the other, built without one long
   * task. The bed captures' programs are linked by the driver first (a dry run of the captures, engine/parallel-compile.js);
   * the geometry hashes their cache keys read are made a slice at a time; then each body's three captures are drawn
   * in one task (one look at the scene, as back-to-back addBody calls had), their pixels read back without waiting,
   * and each body's bake runs a slice at a time.
   * @returns {Generator<any, object[]>} the bodies
   */
  *addBodiesG(list) {
    const mat = captureMaterial(); // (one for every capture of the batch: its programs stay linked from the dry run on)
    try {
      const want = list.map((o) => o.capture !== false);
      if (want.some(Boolean)) {
        // a capture's program variants: with the clip plane and without (one dry draw each over every body's area)
        for (const clip of [true, false]) {
          if (due()) yield;
          yield compileAhead(this.renderer, () => this._captureDry(list.filter((o, k) => want[k]), mat, clip), { all: true }).catch(() => null);
        }
        // (memoised per geometry: the keys below only look them up)
        const geos = new Set();
        this.scene.traverse((ob) => { if ((ob.isMesh || ob.isLine || ob.isPoints) && ob.geometry) geos.add(ob.geometry); });
        for (const t of [].concat(this.opts.terrain || [])) t?.traverse?.((ob) => { if (ob.geometry) geos.add(ob.geometry); });
        for (const g of geos) { try { yield* geometryHashG(g); } catch { /* the key falls back to no cache */ } if (due()) yield; }
      }
      const caps = [];
      for (let k = 0; k < list.length; k++) {
        caps.push(want[k] ? this._captureAsync(list[k], list[k].level ?? 0, mat) : null);
        if (k + 1 < list.length) yield; // (a body's captures per task)
      }
      const got = {};
      yield Promise.all(caps).then((v) => { got.caps = v; });
      const out = [];
      for (let k = 0; k < list.length; k++) out.push(yield* this._addBodyG(list[k], got.caps[k]));
      return out;
    } finally { mat.dispose(); }
  }

  /**
   * The off-screen passes' materials (FFT oceans, caustics, the ripple step) drawn once into a scratch target — as a
   * compile probe only (engine/parallel-compile.js compileAhead, `all`: the drivers link their programs aside before
   * the first update() draws them; art/water.js buildWaterAsync). Leaves nothing behind: no pass target is touched,
   * the FFT quads get their (empty) material back.
   */
  passProbeDraws() {
    const r = this.renderer, prev = r.getRenderTarget();
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    try {
      r.setRenderTarget(rt);
      for (const o of [this.detailOcean, this.seaOcean]) {
        if (!o) continue;
        const keep = o.quad.material;
        try { for (const m of [o.mH0, o.mSpec, o.mFFT, o.mDisp, o.mNrm]) { o.quad.material = m; o.quad.render(r); } } finally { o.quad.material = keep; }
      }
      this.caustics?.quad?.render(r);
      this.ripples?.quad?.render(r);
    } finally { r.setRenderTarget(prev); rt.dispose(); }
  }

  /** addBody's work (a sliced job): `cap` = its bed capture when already made, else captured here. */
  *_addBodyG(o, cap) {
    const type = o.type || 'lake';
    const level = o.level ?? 0;
    const P = { ...WATER_PRESETS[o.preset || o.look || (type === 'sea' ? 'sea' : type)] || WATER_PRESETS.lake };
    if (o.absorb) P.absorb = o.absorb; if (o.scatter) P.scatter = o.scatter;
    const bake = yield* bakeBodyG({ ...o, level }, o.bakeRes || this.Q.bodyRes, cap !== undefined ? cap : o.capture === false ? null : this._capture(o, level));
    if (due()) yield;
    const b = bake.bounds;
    const segLen = type === 'sea' ? 1 / this.Q.seaSeg : 0.75;
    const sx = Math.min(512, Math.max(2, Math.round(b.z / segLen))), sz = Math.min(512, Math.max(2, Math.round(b.w / segLen)));
    const geo = new THREE.PlaneGeometry(b.z, b.w, sx, sz);
    geo.rotateX(-Math.PI / 2);
    geo.translate(b.x + b.z / 2, level, b.y + b.w / 2);
    const v = (x) => ({ value: x });
    const V3 = (a) => new THREE.Vector3(...a);
    const s = this.shared;
    const uniforms = {
      ...s,
      level: v(level), bodyTex2: v(bake.texture2), bodyType: v(type === 'sea' ? 2 : type === 'river' ? 1 : 0), bodyTex: v(bake.texture), bodyBounds: v(b),
      patchA: v(this.sea.patch), patchB: v(this.detail.patch),
      dispScaleA: v(type === 'sea' ? 1 : 0), dispScaleB: v(type === 'sea' ? 0.6 : 0),
      slopeA: v(1), slopeB: v(o.slopeScale ?? (type === 'sea' ? 0.8 : type === 'river' ? 0.45 : 0.22)),
      detailScale: v(o.detailScale ?? (type === 'sea' ? 0.05 : type === 'river' ? 0.035 : 0.04)),
      surfAmp: v(o.surf ? o.surf.amp : 0), surfLen: v(o.surf ? (o.surf.length ?? 7) : 7), surfPeriod: v(TIME_LOOP / Math.max(1, Math.round(TIME_LOOP / (o.surf ? (o.surf.period ?? 7) : 7)))),
      causticsStrength: v(this.caustics ? (o.caustics ?? (type === 'river' ? 0.45 : 1.2)) : 0), flowDir: v(new THREE.Vector2(...(o.flow && o.flow.dir ? o.flow.dir : [1, 0])).normalize()), reflTex: v(null), reflMatrix: v(new THREE.Matrix4()), reflEnabled: v(0),
      refrStrength: v(o.refraction ?? 0.035), roughness: v(o.roughness ?? P.roughness), sssStrength: v(o.sss ?? P.sss),
      foamScale: v(o.foamScale ?? 3.5), shoreFoamDepth: v(o.shoreFoamDepth ?? (type === 'sea' ? 0.5 : 0.15)), shoreFoam: v(o.shoreFoam ?? (type === 'sea' ? 1 : type === 'river' ? 0.35 : 0.5)), foamAmount: v(o.foam ?? 1), sheen: v(o.sheen ?? P.sheen ?? 1), iceWidth: v(o.frozen ? 1e4 : (o.ice || 0)),
      reflDistort: v(o.reflDistort ?? 0.06), maskCut: v(o.mask ? (o.maskCut ?? -0.35) : -1e9), fadeDepth: v(o.fadeDepth ?? 0.06),
      iceFree: v(Array.from({ length: 4 }, (_, k) => { const f = o.iceFree?.[k]; return f ? new THREE.Vector3(f.x, f.z, f.r) : new THREE.Vector3(0, 0, 0); })),
      absorb: v(V3(P.absorb).addScalar(o.turbidity ?? P.turbidity ?? 0)), scatterColor: v(V3(P.scatter)), foamColor: v(V3(P.foam)), iceColor: v(V3(o.iceColor || [0.72, 0.80, 0.86])),
    };
    if (!this.caustics) uniforms.causticsTex = v(this._flat);
    const mat = makeWaterMaterial(uniforms);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = type !== 'sea';
    mesh.name = 'water:' + type;
    mesh.renderOrder = type === 'sea' ? 0 : 1;
    this.waterScene.add(mesh);
    const body = { o: { ...o, type, level }, mesh, uniforms, bake, level };
    this.bodies.push(body);
    this._syncRippleEnv();
    return body;
  }

  /**
   * Top-down bed capture over the body's bake grid (W-B graft, 3 passes): bed below level+0.35 (bridge decks cut),
   * unclipped top where nothing is below, and closed solids crossing the surface (piers, rocks, hulls) with the
   * terrain hidden. Objects with userData.waterIgnore / userData.dynamic are hidden; terrain = userData.waterTerrain
   * or opts.terrain. Returns null when the scene has nothing to capture.
   */
  _capture(o, level) {
    const { g, hide, terr, key, t0 } = this._captureKey(o, level);
    if (key) {
      const hit = sessionCache.get(key);
      if (hit !== undefined) { this.lastCaptureMs = performance.now() - t0; return hit && { hgt: hit.hgt.slice(), solid: hit.solid.slice() }; }
    }
    const res = this._captureNow(o, level, g, hide, terr);
    if (key) sessionCache.set(key, res && { hgt: res.hgt.slice(), solid: res.solid.slice() }, { bytes: res ? res.hgt.byteLength + res.solid.byteLength : 0 });
    this.lastCaptureMs = performance.now() - t0;
    return res;
  }

  /** _capture() drawn now, read back without waiting: a Promise of its result. `mat`: the shared capture material. */
  _captureAsync(o, level, mat) {
    const { g, hide, terr, key, t0 } = this._captureKey(o, level);
    if (key) {
      const hit = sessionCache.get(key);
      if (hit !== undefined) { this.lastCaptureMs = performance.now() - t0; return Promise.resolve(hit && { hgt: hit.hgt.slice(), solid: hit.solid.slice() }); }
    }
    return this._captureDraws(o, level, mat, 'async', { g, hide, terr }).then((res) => {
      if (key) sessionCache.set(key, res && { hgt: res.hgt.slice(), solid: res.solid.slice() }, { bytes: res ? res.hgt.byteLength + res.solid.byteLength : 0 });
      this.lastCaptureMs = performance.now() - t0;
      return res;
    });
  }

  /**
   * The three capture draws of _captureNow with a shared material: 'async' → Promise of the same result; 'dry' → drawn
   * only (the compile probe of addBodiesG). `at`: {g, hide, terr} from _captureKey (else worked out here).
   */
  _captureDraws(o, level, mat, mode, at = null) {
    const { g, hide, terr } = at || this._captureKey(o, level, false);
    const B = [g.minX, g.minZ, g.maxX, g.maxZ], clipY = level + 0.35, r = this.renderer;
    const ph = captureHeightsAsync(r, this.scene, B, g.rx, g.rz, hide, clipY, mat, mode);
    const pt = captureHeightsAsync(r, this.scene, B, g.rx, g.rz, hide, Infinity, mat, mode);
    const ps = captureHeightsAsync(r, this.scene, B, g.rx, g.rz, hide.concat(terr), clipY, mat, mode);
    if (mode === 'dry') return null;
    return Promise.all([ph, pt, ps]).then(([hgt, top, sol]) => this._captureMerge(hgt, top, sol, g, clipY));
  }

  /**
   * A compile probe's capture draw (addBodiesG): the capture material over the union of the bodies' areas, with the
   * clip plane or without — the program variants the real captures will pick. Draws into a throwaway target only.
   */
  _captureDry(list, mat, clip) {
    if (!list.length) return;
    let B = null, lv = -Infinity;
    for (const o of list) {
      const level = o.level ?? 0, g = bodyGrid({ ...o, level }, o.bakeRes || this.Q.bodyRes);
      B = B ? [Math.min(B[0], g.minX), Math.min(B[1], g.minZ), Math.max(B[2], g.maxX), Math.max(B[3], g.maxZ)] : [g.minX, g.minZ, g.maxX, g.maxZ];
      lv = Math.max(lv, level);
    }
    const { hide } = this._captureKey(list[0], list[0].level ?? 0, false);
    captureHeightsAsync(this.renderer, this.scene, B, 16, 16, hide, clip ? lv + 0.35 : Infinity, mat, 'dry');
  }

  /** The capture's grid, what it hides, the terrain it draws apart and its session-cache key (null: not cacheable). */
  _captureKey(o, level, wantKey = true) {
    const g = bodyGrid({ ...o, level }, o.bakeRes || this.Q.bodyRes), t0 = performance.now();
    const hide = [], terr = [].concat(this.opts.terrain || []);
    // instanced meshes (grass, clutter stones, debris, wind particles) and points / lines / sprites (snowfall) are left
    // out: the capture material has no per-instance or shader-driven placement, so they would all land on the world
    // origin and bake a dry "floe" into any water at map corner (0, 0) (user request 2026-10-01: nothing may mark the
    // map's corner)
    this.scene.traverse((ob) => { const u = ob.userData || {};
      if (u.waterIgnore || u.dynamic || ob.isInstancedMesh || ob.isBatchedMesh || ob.geometry?.isInstancedBufferGeometry
        || ob.isPoints || ob.isLine || ob.isSprite) hide.push(ob);
      else if (u.waterTerrain && !terr.includes(ob)) terr.push(ob); });
    // session cache: the same body over the same drawn scene (a restart) captures the same heights — skip the three
    // GPU passes and their read-backs. Key: the body + grid + a signature of everything the passes would draw.
    let key = null;
    if (wantKey) try {
      const sig = sceneSignature(this.scene, new Set(hide)), ts = terr.map((t) => sceneSignature(t));
      if (sig && ts.every(Boolean)) key = `water:capture:${dataKey((h) => { h.num(level); h.str(JSON.stringify(g)); h.str(sig); h.str(ts.join(',')); })}`;
    } catch { key = null; }
    return { g, hide, terr, key, t0 };
  }

  _captureNow(o, level, g, hide, terr) {
    const B = [g.minX, g.minZ, g.maxX, g.maxZ], clipY = level + 0.35, r = this.renderer;
    const hgt = captureHeights(r, this.scene, B, g.rx, g.rz, hide, clipY);
    const top = captureHeights(r, this.scene, B, g.rx, g.rz, hide);
    const sol = captureHeights(r, this.scene, B, g.rx, g.rz, hide.concat(terr), clipY);
    return this._captureMerge(hgt, top, sol, g, clipY);
  }

  /** The bed (below the clip), the open top where nothing is below, and the solids, merged. */
  _captureMerge(hgt, top, sol, g, clipY) {
    const N = g.rx * g.rz, solid = new Uint8Array(N); let any = false;
    for (let k = 0; k < N; k++) {
      if (hgt[k] < -900 && top[k] > -900) hgt[k] = top[k];
      if (hgt[k] > 900 || sol[k] > 900) { solid[k] = 1; hgt[k] = clipY; }
      if (hgt[k] > -900) any = true;
    }
    return any ? { hgt, solid } : null;
  }

  removeBody(body) {
    const i = this.bodies.indexOf(body); if (i < 0) return;
    this.bodies.splice(i, 1); this.waterScene.remove(body.mesh); this._syncRippleEnv();
    body.mesh.geometry.dispose(); body.mesh.material.dispose(); body.bake.texture.dispose(); body.bake.texture2.dispose();
  }

  /**
   * Units shown under the water this frame (art/swim-pose.js: the diving Marine): [{root: Object3D, sel: boolean,
   * x, y, z: his body's centre}].
   * The water pass draws its surface over them even where a fin or the tank pokes out of very shallow water, and
   * keeps them readable (shader `subMask`). Empty / null: no mask pass.
   */
  setSubmerged(list = null) { this._sub = list && list.length ? list : null; }

  /**
   * Render the submerged units' depth mask (R = gl_FragCoord.z of the nearest diver fragment, 1 = none; G = selected)
   * at the post chain's resolution. Called by WaterPass before it draws. @returns {THREE.Texture|null}
   */
  renderSubmergedMask(renderer, readBuffer) {
    const s = this.shared, L = this._sub;
    s.subOn.value = 0;
    if (!L) return null;
    const w = readBuffer.width, h = readBuffer.height;
    let rt = this._subRT;
    if (!rt) {
      rt = this._subRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGFormat, depthBuffer: true,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      const m = this._subMat = new THREE.MeshBasicMaterial();
      m.userData.sel = { value: 0 };
      m.onBeforeCompile = (sh) => {
        sh.uniforms.subSel = m.userData.sel;
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float subSel;')
          .replace(/}\s*$/, '  gl_FragColor = vec4(gl_FragCoord.z, subSel, 0.0, 1.0);\n}');
      };
      m.customProgramCacheKey = () => 's6subMask';
      this._subScene = new THREE.Scene();
      this._subScene.matrixWorldAutoUpdate = false;
      this._subScene.overrideMaterial = m;
    }
    // on screen? the screen box the shader looks for each in: ±1.6 m round him, through the refraction (+ the rim)
    const box = [1, 1, 0, 0], p = this._subP || (this._subP = new THREE.Vector3()), show = this._subShow || (this._subShow = []);
    show.length = 0;
    for (const it of L) {
      if (!it.root?.visible) continue;
      const cx = it.x ?? it.root.position.x, cy = it.y ?? it.root.position.y, cz = it.z ?? it.root.position.z;
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (let k = 0; k < 8; k++) {
        p.set(cx + (k & 1 ? 1.6 : -1.6), cy + (k & 2 ? 0.7 : -0.7), cz + (k & 4 ? 1.6 : -1.6)).project(this.camera);
        x0 = Math.min(x0, p.x * 0.5 + 0.5); y0 = Math.min(y0, p.y * 0.5 + 0.5); x1 = Math.max(x1, p.x * 0.5 + 0.5); y1 = Math.max(y1, p.y * 0.5 + 0.5);
      }
      if (x1 < -0.05 || y1 < -0.05 || x0 > 1.05 || y0 > 1.05) continue;   // off screen: nothing to draw
      box[0] = Math.min(box[0], x0); box[1] = Math.min(box[1], y0); box[2] = Math.max(box[2], x1); box[3] = Math.max(box[3], y1);
      show.push(it);
    }
    if (!show.length) return null;
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    const prevT = renderer.getRenderTarget(), ac = renderer.autoClear, sa = renderer.shadowMap.autoUpdate;
    const cc = renderer.getClearColor(this._cc || (this._cc = new THREE.Color())), ca = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0xff0000, 1);   // R = 1: no diver; G = 0: not selected
    renderer.clear(true, true, false);
    renderer.autoClear = false; renderer.shadowMap.autoUpdate = false;
    // (the roots stay in the world scene: the mask scene only borrows them as children for this draw)
    const sc = this._subScene, kids = sc.children;
    for (const it of show) {
      this._subMat.userData.sel.value = it.sel ? 1 : 0;
      kids.length = 0; kids.push(it.root);
      renderer.render(sc, this.camera);
    }
    kids.length = 0;
    renderer.setRenderTarget(prevT); renderer.setClearColor(cc, ca);
    renderer.autoClear = ac; renderer.shadowMap.autoUpdate = sa;
    s.subBox.value.set(box[0] - 0.03, box[1] - 0.03, box[2] + 0.03, box[3] + 0.03);
    s.subMask.value = rt.texture; s.subOn.value = 1;
    return rt.texture;
  }

  /** Push the water surface at (x,z): strength = metres (negative pushes down, |s|<1), radius in metres, foam 0..1 extra churn. */
  disturb(x, z, strength = 0.1, radius = 0.6, foam = 0) { this.ripples.disturb(x, z, strength, radius, foam); }
  /** Boat wake crest dab: height (m) + crisp, short-lived crest foam 0..1 (the Kelvin V arms; see RippleSim.crest). */
  crest(x, z, strength = 0.01, radius = 0.3, amount = 0.5, x1 = x, z1 = z) { this.ripples.crest(x, z, strength, radius, amount, x1, z1); }

  /**
   * Hulls to keep dry this frame (art/water/hulls.js dryHullOf() results): the water is not drawn inside their
   * waterline plans. Call before the render; the nearest MAX_DRY_HULLS to the view centre are kept.
   */
  setDryHulls(list = []) { const c = this._viewCentre; return packDryHulls(list, this.shared, c?.x ?? 0, c?.z ?? 0); }

  _syncRippleEnv() { this.ripples.setBodies(this.bodies.filter((b) => b.mesh.visible).map((b) => ({ texture: b.bake.texture, bounds: b.bake.bounds }))); }

  /**
   * Gameplay query (W-B API merged with depthAt): water under (x,z), bilinear over the bake grid.
   * @returns {{depth:number, flow:[number,number], level:number, type:string, shore:number, ice:boolean, body:object}|null}
   *   depth in metres (bed from bed(x,z) or the capture), flow in m/s, shore = distance to the nearest bank/obstacle (m).
   */
  sample(x, z) { return this._sample(x, z, null); }

  /** sample() written into `out` ({flow: [0, 0]}, reused by a caller that reads it at once: the fish, 5 Hz each). */
  sampleInto(x, z, out) { return this._sample(x, z, out); }

  _sample(x, z, out) {
    // (bilinear reads in a plain function: the per-body closures here were a stream of garbage — fish, ducks, wakes)
    const bodies = this.bodies;
    for (let n = 0; n < bodies.length; n++) {
      const b = bodies[n], bk = b.bake, B = bk.bounds, rx = bk.rx, rz = bk.rz, data = bk.data;
      const fx = (x - B.x) / B.z * rx - 0.5, fz = (z - B.y) / B.w * rz - 0.5;
      if (fx < -0.5 || fz < -0.5 || fx > rx - 0.5 || fz > rz - 0.5) continue;
      const i = Math.max(0, Math.min(rx - 2, Math.floor(fx))), j = Math.max(0, Math.min(rz - 2, Math.floor(fz)));
      const tx = Math.min(1, Math.max(0, fx - i)), tz = Math.min(1, Math.max(0, fz - j)), k0 = j * rx + i;
      const depth = bilerp(data, 4, 3, k0, rx, tx, tz);
      if (depth <= 0) continue;
      const shore = bilerp(bk.shoreDist, 1, 0, k0, rx, tx, tz), iw = b.o.frozen ? Infinity : (b.o.ice || 0);
      const f0 = bilerp(data, 4, 0, k0, rx, tx, tz), f1 = bilerp(data, 4, 1, k0, rx, tx, tz);
      if (out) {
        out.depth = depth; out.flow[0] = f0; out.flow[1] = f1; out.level = b.level; out.type = b.o.type; out.shore = shore; out.ice = shore < iw * 0.62; out.body = b;
        return out;
      }
      return { depth, flow: [f0, f1], level: b.level, type: b.o.type, shore, ice: shore < iw * 0.62, body: b };
    }
    return null;
  }

  /** Depth (m) of the body under (x,z) or -1 when dry — useful for gameplay (swimming, wading). */
  depthAt(x, z) { const s = this.sample(x, z); return s ? s.depth : -1; }

  /**
   * Level (m) of the body whose own cells hold (x, z) — the nav-grid water cells it was made from (`o.mask`), not its
   * bake: a gameplay query, the same at every preset (sample() reads the bake, at the quality's resolution: a shore
   * point wet on 'high' could read dry on 'low'). Bodies without a mask: sample(). null = no body there.
   */
  levelAt(x, z) {
    let maskless = false;
    for (const b of this.bodies) {
      if (typeof b.o.mask !== 'function') { maskless = true; continue; }
      if (b.o.mask(x, z)) return b.level;
    }
    return maskless ? (this.sample(x, z)?.level ?? null) : null;
  }

  _frameUniforms(readBuffer, depthTex) {
    const s = this.shared, c = this.camera;
    s.sceneColor.value = readBuffer.texture; s.sceneDepth.value = depthTex || readBuffer.depthTexture;
    s.resolution.value.set(readBuffer.width, readBuffer.height);
    s.projInv.value.copy(c.projectionMatrixInverse); s.camWorld.value.copy(c.matrixWorld); s.viewMat.value.copy(c.matrixWorldInverse);
    s.uOrtho.value = c.isOrthographicCamera ? 1 : 0; s.camNear.value = c.near; s.camFar.value = c.far;
  }

  _envAndLights() {
    const s = this.shared, eng = this.engine, o = this.opts;
    const env = o.envMap || (eng && eng.theaterHdr) || null;
    if (env !== s.envTex.value) {
      s.envTex.value = env;
      const irr = o.skyIrradiance ? new THREE.Vector3(...o.skyIrradiance) : skyIrradiance(env);
      if (irr) s.skyIrr.value.copy(irr).multiplyScalar(o.envIntensity ?? 1);
    }
    s.envIntensity.value = o.envIntensity ?? 1;
    s.envRot.value = o.envRotation ?? 0;
    const sun = o.sun || (eng && eng.sun);
    // sun shadow map (PCF depth texture with compare) → shadowed caustics, glints, foam and SSS
    const sm = sun && sun.castShadow && this.renderer.shadowMap.enabled && sun.shadow.map ? sun.shadow.map.depthTexture : null;
    s.shadowOn.value = sm && sm.compareFunction ? 1 : 0;
    if (s.shadowOn.value) {
      s.sunShadow.value = sm; s.sunShadowMat.value.copy(sun.shadow.matrix);
      s.shadowTexel.value.set(1 / sun.shadow.mapSize.x, 1 / sun.shadow.mapSize.y);
    }
    if (sun) {
      if (eng && sun === eng.sun && eng.sunDir) s.sunDir.value.copy(eng.sunDir).normalize();
      else s.sunDir.value.copy(sun.position).sub(sun.target.position).normalize();
      s.sunColor.value.set(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(sun.intensity * (o.sunScale ?? 1));
    }
    // night factor from the key light level (sun/moon irradiance + sky): drives foam dimming
    const lum = (v) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
    const key = lum(s.sunColor.value) * Math.max(s.sunDir.value.y, 0) + lum(s.skyIrr.value) / Math.PI;
    s.night.value = o.night ?? 1 - THREE.MathUtils.smoothstep(key, 0.15, 0.9);
    const sunE = lum(s.sunColor.value) * Math.max(s.sunDir.value.y, 0), skyE = lum(s.skyIrr.value);
    s.directFrac.value = sunE / Math.max(sunE + skyE, 1e-4);
    s.glitter.value = (o.glitter ?? SUN_GLITTER) * (1 - 0.65 * s.night.value); // moonlight: fainter sparkles
    // nearest point lights to the view centre (re-gathered every 30 frames)
    if (!this._pl || (this._plTick = (this._plTick || 0) + 1) % 30 === 0) { this._pl = []; this.scene.traverseVisible((ob) => { if (ob.isPointLight || ob.isSpotLight) this._pl.push(ob); }); }
    const c = this._viewCentre || new THREE.Vector3();
    const pls = this._pl.slice().sort((a, b) => a.position.distanceToSquared(c) - b.position.distanceToSquared(c)).slice(0, 4);
    pls.forEach((l, i) => { l.getWorldPosition(s.plPos.value[i]); s.plCol.value[i].set(l.color.r, l.color.g, l.color.b).multiplyScalar(l.intensity); });
    s.plCount.value = pls.length;
    const fog = this.scene.fog;
    s.fogOn.value = fog && fog.isFog ? 1 : 0;
    if (fog && fog.isFog) { s.fogNear.value = fog.near; s.fogFar.value = fog.far; s.fogColor.value.set(fog.color.r, fog.color.g, fog.color.b); }
  }

  /**
   * Hide scene children flagged `userData.reflectCull` (characters) that stand more than REFLECT_REACH m (XZ) from
   * every reflecting water body: seen from the game camera a figure's mirror image lands within ~2 × its height of
   * its feet, so far ones never show on the water and only cost draw calls. Returns the hidden objects.
   */
  _reflectCull() {
    const out = [];
    const boxes = (this._reflBoxes ||= []), reach = REFLECT_REACH;
    boxes.length = 0;
    for (const b of this.bodies) {
      if (b.o.reflect === false || !b.mesh.visible) continue;
      b.mesh.updateWorldMatrix(true, false);
      boxes.push((b._box ||= new THREE.Box3()).setFromObject(b.mesh));
    }
    for (const o of this.scene.children) {
      if (!o.userData.reflectCull || !o.visible) continue;
      const x = o.position.x, z = o.position.z;
      let near = false;
      for (const bx of boxes) {
        const dx = Math.max(bx.min.x - x, 0, x - bx.max.x), dz = Math.max(bx.min.z - z, 0, z - bx.max.z);
        if (dx * dx + dz * dz < reach * reach) { near = true; break; }
      }
      if (!near) { o.visible = false; out.push(o); }
    }
    return out;
  }

  /**
   * Reflection texels the visible water of `level` can sample: the screen box of its bodies (clipped to the view) mapped
   * through the mirror matrix, widened by the shader's ripple distortion (reflDistort, UV) and a texel. Pixel rect
   * {x, y, w, h} in the mirror target (y up), or null when no such water is on screen.
   */
  _reflWindow(level, R, pad = 0) {
    const cam = this.camera, W = R.rt.width, H = R.rt.height;
    _vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, dist = 0;
    for (const b of this.bodies) {
      if (b.o.reflect === false || !b.mesh.visible || Math.round(b.level * 100) / 100 !== level) continue;
      const g = b.mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      b.mesh.updateWorldMatrix(true, false);
      _wb.copy(g.boundingBox).applyMatrix4(b.mesh.matrixWorld);
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (let k = 0; k < 4; k++) {
        _wp.set(k & 1 ? _wb.max.x : _wb.min.x, level, k & 2 ? _wb.max.z : _wb.min.z).applyMatrix4(_vp);
        bx0 = Math.min(bx0, _wp.x); bx1 = Math.max(bx1, _wp.x); by0 = Math.min(by0, _wp.y); by1 = Math.max(by1, _wp.y);
      }
      // clip to the screen (+ `pad` NDC each side: a texture reused next frame covers a panning camera's new edge)
      bx0 = Math.max(bx0, -1 - pad); by0 = Math.max(by0, -1 - pad); bx1 = Math.min(bx1, 1 + pad); by1 = Math.min(by1, 1 + pad);
      if (bx0 >= bx1 || by0 >= by1) continue;
      x0 = Math.min(x0, bx0); y0 = Math.min(y0, by0); x1 = Math.max(x1, bx1); y1 = Math.max(y1, by1);
      dist = Math.max(dist, b.uniforms.reflDistort?.value ?? 0.06);
    }
    if (!(x0 < x1 && y0 < y1)) return null;
    // screen corners → the water plane → mirror UV (the mirror flips x: map every corner)
    _vpInv.copy(_vp).invert();
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    const fwd = _wd.set(0, 0, -1).transformDirection(cam.matrixWorld);
    for (let k = 0; k < 4; k++) {
      _wp.set(k & 1 ? x1 : x0, k & 2 ? y1 : y0, -1).applyMatrix4(_vpInv);
      if (Math.abs(fwd.y) > 1e-6) _wp.addScaledVector(fwd, (level - _wp.y) / fwd.y);
      _wp.y = level;
      _wp.applyMatrix4(R.matrix);
      u0 = Math.min(u0, _wp.x); u1 = Math.max(u1, _wp.x); v0 = Math.min(v0, _wp.y); v1 = Math.max(v1, _wp.y);
    }
    const m = dist + 1.5 / Math.min(W, H);
    const px0 = Math.max(0, Math.floor((u0 - m) * W)), px1 = Math.min(W, Math.ceil((u1 + m) * W));
    const py0 = Math.max(0, Math.floor((v0 - m) * H)), py1 = Math.min(H, Math.ceil((v1 + m) * H));
    if (px1 <= px0 || py1 <= py0) return null;
    return { x: px0, y: py0, w: px1 - px0, h: py1 - py0 };
  }

  /**
   * Water footprint of a mirror level: a 2 m grid over its bodies (their polygons, dilated), as a summed-area table
   * (rebuilt when that level's bodies change). @returns {{x0, z0, cell, nx, nz, sat}|null}
   */
  _waterMask(level) {
    // the bodies of this level (a draining reservoir keeps its mesh while its level moves: same mask)
    const bodies = (this._lvlBodies ||= []);
    bodies.length = 0;
    for (const b of this.bodies) if (b.o.reflect !== false && Math.round(b.level * 100) / 100 === level) bodies.push(b);
    if (!bodies.length) return null;
    const masks = (this._masks ||= []);
    const fits = (m) => m.bodies.length === bodies.length && m.bodies.every((b, i) => {
      const e = b.mesh.matrixWorld.elements, s = m.sig, k = i * 5;
      return b === bodies[i] && s[k] === b.mesh.geometry.id && s[k + 1] === b.mesh.geometry.attributes.position.version && s[k + 2] === e[12] && s[k + 3] === e[14] && s[k + 4] === e[0];
    });
    for (const m of masks) if (fits(m)) return m.mask;
    const sig = [];
    for (const b of bodies) { b.mesh.updateWorldMatrix(true, false); const e = b.mesh.matrixWorld.elements; sig.push(b.mesh.geometry.id, b.mesh.geometry.attributes.position.version, e[12], e[14], e[0]); }
    const entry = { bodies: bodies.slice(), sig, mask: null };
    masks.push(entry);
    if (masks.length > 4) masks.shift();
    const cell = 2, box = new THREE.Box3();
    for (const b of bodies) {
      const g = b.mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      box.union(_wb.copy(g.boundingBox).applyMatrix4(b.mesh.matrixWorld));
    }
    const x0 = Math.floor(box.min.x / cell) * cell, z0 = Math.floor(box.min.z / cell) * cell;
    const nx = Math.max(1, Math.ceil((box.max.x - x0) / cell) + 1), nz = Math.max(1, Math.ceil((box.max.z - z0) / cell) + 1);
    if (nx * nz > 4e6) return null; // absurd extent: no mask (entry.mask stays null)
    const occ = new Uint8Array(nx * nz), cellIn = (x, z, poly) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i], [xj, zj] = poly[j];
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
      }
      return c;
    };
    for (const b of bodies) {
      // the surface mesh is the body's whole bake rectangle (shore masked in the shader): the water is its wet mask or
      // polygon, dilated 2 cells (the shore band drawn just outside it, the bake's 2 m pad); neither → the rectangle
      const poly = b.o.polygon?.length >= 3 ? b.o.polygon : null, wet = typeof b.o.mask === 'function' ? b.o.mask : null;
      _wb.copy(b.mesh.geometry.boundingBox).applyMatrix4(b.mesh.matrixWorld);
      const i0 = Math.max(0, Math.floor((_wb.min.x - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((_wb.max.x - x0) / cell));
      const j0 = Math.max(0, Math.floor((_wb.min.z - z0) / cell)), j1 = Math.min(nz - 1, Math.floor((_wb.max.z - z0) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (wet) { // the body's wet-cell mask (raised water, apron components): 4 × 4 samples a cell (0.5 m)
          let any = false;
          for (let q = 0; q < 16 && !any; q++) any = !!wet(x0 + (i + ((q & 3) + 0.5) / 4) * cell, z0 + (j + ((q >> 2) + 0.5) / 4) * cell);
          if (!any) continue;
        } else if (poly && !cellIn(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell, poly)) continue;
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < nx && jj < nz) occ[jj * nx + ii] = 1;
        }
      }
    }
    const sat = new Int32Array((nx + 1) * (nz + 1));
    for (let j = 0; j < nz; j++) {
      let row = 0;
      for (let i = 0; i < nx; i++) { row += occ[j * nx + i]; sat[(j + 1) * (nx + 1) + i + 1] = sat[j * (nx + 1) + i + 1] + row; }
    }
    return (entry.mask = { x0, z0, cell, nx, nz, sat });
  }

  /**
   * Extra cull for a mirror render (engine/cull-hooks.js): an object can show in the mirror only where its reflection
   * lands on this level's water. A point h m above the water reflects on the plane h·cot(pitch) m towards the camera,
   * so the object's footprint swept that far towards the camera, widened by the shader's ripple distortion reach
   * (reflDistort × the view extent) and 1 m, must touch a water cell. Returns null (no extra cull) without a mask.
   */
  _mirrorReach(level, win, pad = 0) {
    const mask = this._waterMask(level);
    if (!mask) return null;
    const cam = this.camera, f = _wd.set(0, 0, -1).transformDirection(cam.matrixWorld);
    const hl = Math.hypot(f.x, f.z);
    if (!(f.y < -0.05) || hl < 1e-4) return null; // not looking down: no simple sweep
    const cot = hl / -f.y, ux = -f.x / hl, uz = -f.z / hl;
    const viewW = cam.isOrthographicCamera ? (cam.right - cam.left) / cam.zoom : 100, viewH = cam.isOrthographicCamera ? (cam.top - cam.bottom) / cam.zoom / -f.y : 100;
    let dist = 0;
    for (const b of this.bodies) if (Math.round(b.level * 100) / 100 === level) dist = Math.max(dist, b.uniforms.reflDistort?.value ?? 0.06);
    const margin = (dist + pad * 0.5) * Math.max(viewW, viewH) + 1;
    if (this._reach?.size > 8) this._reach.clear(); // a draining level walks through many values
    const P = ((this._reach ||= new Map()).get(level)) || {};
    P.mask = mask; P.cot = cot; P.ux = ux; P.uz = uz; P.margin = margin;
    if (P.fn) return P.fn;
    this._reach.set(level, P);
    const boxes = (this._wboxes ||= new WorldBoxes()), tmp = (this._tmpBox ||= new THREE.Box3());
    return (P.fn = (o) => {
      const { mask, cot, ux, uz, margin } = P, { x0, z0, cell, nx, nz, sat } = mask, W1 = nx + 1;
      const b = boxes.getOrSphere(o, tmp);
      if (!b) return true;
      const h = b.max.y - level;
      if (h <= 0) return true; // below the plane: the oblique near plane decides
      const t = h * cot;
      let ax = b.min.x, bx = b.max.x, az = b.min.z, bz = b.max.z;
      const sx = ux * t, sz = uz * t;
      if (sx < 0) ax += sx; else bx += sx;
      if (sz < 0) az += sz; else bz += sz;
      const i0 = Math.max(0, Math.floor((ax - margin - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((bx + margin - x0) / cell));
      const j0 = Math.max(0, Math.floor((az - margin - z0) / cell)), j1 = Math.min(nz - 1, Math.floor((bz + margin - z0) / cell));
      if (i1 < i0 || j1 < j0) return false;
      return sat[(j1 + 1) * W1 + i1 + 1] - sat[j0 * W1 + i1 + 1] - sat[(j1 + 1) * W1 + i0] + sat[j0 * W1 + i0] > 0;
    });
  }

  /** Did the view move more than MIRROR_PAD allows since the last call (a cut, a zoom, a fast pan or turn)? */
  _viewJump(cam) {
    const L = (this._lastView ||= { p: new THREE.Vector3(), q: new THREE.Quaternion(), w: 0, ok: false });
    const p = _jp.setFromMatrixPosition(cam.matrixWorld), q = _jq.setFromRotationMatrix(cam.matrixWorld);
    const w = cam.isOrthographicCamera ? (cam.right - cam.left) / (cam.zoom || 1) : 0;
    const jump = !L.ok || !cam.isOrthographicCamera || p.distanceTo(L.p) > MIRROR_PAD * 0.4 * w || Math.abs(w - L.w) > MIRROR_PAD * 0.4 * w || q.angleTo(L.q) > 0.02;
    L.p.copy(p); L.q.copy(q); L.w = w; L.ok = true;
    return jump;
  }

  _renderReflections() {
    const Q = this.Q, r = this.renderer, cam = this.camera;
    // perf review (art integration 2): the mirror is a second full scene render (~2 ms CPU on M3). With a still
    // camera it is refreshed every `reflEvery` frames; the stored reflMatrix keeps the old texture registered.
    // (the still-camera test on the matrices' numbers: a joined string of them every frame was garbage)
    const every = Q.reflEvery ?? 1, K = (this._reflKey ||= new Float64Array(17)), me = cam.matrixWorld.elements, p0 = cam.projectionMatrix.elements[0];
    let still = K[16] === p0;
    for (let i = 0; i < 16 && still; i++) still = K[i] === me[i];
    this._reflN = (this._reflN || 0) + 1;
    if (every > 1 && this._reflN % every !== 0 && still && this._reflKeyed && this.reflections.size) return;
    for (let i = 0; i < 16; i++) K[i] = me[i];
    K[16] = p0; this._reflKeyed = true;
    const levels = [];
    for (const b of this.bodies) {
      b.uniforms.reflEnabled.value = 0;
      if (b.o.reflect === false || !b.mesh.visible) continue;
      const key = Math.round(b.level * 100) / 100;
      if (!levels.includes(key)) levels.push(key);
    }
    const used = levels.slice(0, Q.reflection);
    if (!used.length) return;
    // mirror levels under a moving camera (quality with reflEvery > 1): one level redrawn per frame in turn (one level
    // alone: every `every` frames), each texture drawn a little past the screen edge (MIRROR_PAD) so the next frame's
    // view still finds its reflection in it (its reflMatrix kept with it); every level again after a cut or a jump
    // (one level alone: redrawn every `every` frames the same way — the still camera's rule above, for a camera on the move)
    const multi = every > 1, pad = multi ? MIRROR_PAD : 0;
    const jump = multi ? this._viewJump(cam) : true;
    const slot = this._reflN % Math.max(every, used.length);
    const turn = multi && !jump && used.every((l) => this.reflections.get(l)?.drawn) ? (slot < used.length ? used[slot] : NaN) : null;
    // the world render allocates the sun's shadow map: before its first frame the mirrored render would bind a
    // non-depth placeholder to the shadow samplers (GL sampler-type mismatch) — skip that one frame
    const sun = this.opts.sun || (this.engine && this.engine.sun);
    if (sun && sun.castShadow && r.shadowMap.enabled && !sun.shadow.map) return;
    const size = r.getDrawingBufferSize(new THREE.Vector2()).multiplyScalar(Q.reflScale).floor();
    const prevTarget = r.getRenderTarget(), prevClip = r.clippingPlanes, prevAuto = r.shadowMap.autoUpdate;
    const prevBg = this.scene.background, prevAlpha = r.getClearAlpha(), prevCC = r.getClearColor(new THREE.Color());
    r.shadowMap.autoUpdate = false;
    this.scene.background = null;
    r.setClearColor(0x000000, 0);
    for (const level of used) {
      if (turn !== null && level !== turn) {
        // (its last texture stays: re-enabled with the matrix it was drawn with)
        for (const b of this.bodies) if (Math.round(b.level * 100) / 100 === level && b.o.reflect !== false) b.uniforms.reflEnabled.value = 1;
        continue;
      }
      let R = this.reflections.get(level);
      if (!R) {
        R = { rt: new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 }), cam: cam.clone(), matrix: new THREE.Matrix4() };
        this.reflections.set(level, R);
      }
      if (R.rt.width !== size.x || R.rt.height !== size.y) R.rt.setSize(size.x, size.y);
      // mirror the camera about the plane y = level
      const rc = R.cam; rc.copy(cam);
      const p = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
      const fwd = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
      const up = new THREE.Vector3(0, 1, 0).transformDirection(cam.matrixWorld);
      const target = p.clone().add(fwd);
      p.y = 2 * level - p.y; target.y = 2 * level - target.y; up.y = -up.y;
      rc.position.copy(p); rc.up.copy(up); rc.lookAt(target); rc.updateMatrixWorld(true);
      if (rc.isPerspectiveCamera || rc.isOrthographicCamera) rc.projectionMatrix.copy(cam.projectionMatrix), rc.projectionMatrixInverse.copy(cam.projectionMatrixInverse);
      R.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
      // keep only what lies above y = level - 0.05. Orthographic game camera: the mirror projection's near plane IS that
      // plane (oblique depth row, still monotonic along every view ray), so nothing below it is drawn and the frustum
      // culls it. A global clipping plane did the same per fragment but switched every material to its clipped
      // program variant and back in the main pass, every reflection frame (three re-derives the program each switch).
      // only the texels the visible water can sample (its screen box + the ripple distortion reach) are rendered: the
      // mirror camera is cut to that window (same projection inside it, so the same texels) and culls the rest
      const win = this._reflWindow(level, R, pad);
      R.drawn = !!win;
      if (!win) continue; // no water of this level on screen: nothing samples the mirror (reflEnabled stays 0)
      if (win.w < R.rt.width || win.h < R.rt.height) {
        rc.setViewOffset(R.rt.width, R.rt.height, win.x, R.rt.height - win.y - win.h, win.w, win.h);
        rc.updateProjectionMatrix();
      }
      if (rc.isOrthographicCamera) obliqueNear(rc, level - 0.05, rc.far - rc.near);
      else r.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -(level - 0.05))];
      R.rt.viewport.set(win.x, win.y, win.w, win.h); R.rt.scissor.copy(R.rt.viewport); R.rt.scissorTest = true;
      r.setRenderTarget(R.rt); r.clear();
      const culled = this._reflectCull();
      const reach = this._mirrorReach(level, win, pad);
      if (reach) withExtraCull(reach, () => r.render(this.scene, rc));
      else r.render(this.scene, rc);
      for (const o of culled) o.visible = true;
      R.rt.viewport.set(0, 0, R.rt.width, R.rt.height); R.rt.scissor.copy(R.rt.viewport); R.rt.scissorTest = false;
      if (rc.view) { rc.clearViewOffset(); rc.projectionMatrix.copy(cam.projectionMatrix); rc.projectionMatrixInverse.copy(cam.projectionMatrixInverse); }
      for (const b of this.bodies) if (Math.round(b.level * 100) / 100 === level && b.o.reflect !== false) {
        b.uniforms.reflTex.value = R.rt.texture; b.uniforms.reflMatrix.value.copy(R.matrix); b.uniforms.reflEnabled.value = 1;
      }
    }
    r.clippingPlanes = prevClip; r.shadowMap.autoUpdate = prevAuto; this.scene.background = prevBg;
    r.setClearColor(prevCC, prevAlpha); r.setRenderTarget(prevTarget);
  }

  /** Advance simulation and render the off-screen inputs; call once per frame BEFORE the world render. */
  update(dt = 1 / 60, draw = true) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;
    const s = this.shared, t0 = performance.now();
    s.time.value = this.time % TIME_LOOP;
    // nothing drawn this frame (a menu covers the view): no FFT, caustics, ripple or mirror passes — the clock runs on,
    // and the next drawn frame computes them all (at its time) before it renders
    if (!draw) { this.skipped = (this.skipped || 0) + 1; this.lastUpdateMs = performance.now() - t0; return; }
    this.detailOcean.update(this.time % FFT_PERIOD, dt);
    s.dispB.value = this.detailOcean.displacementTexture; s.nrmB.value = this.detailOcean.normalTexture;
    if (this.seaOcean && this.bodies.some((b) => b.o.type === 'sea')) {
      this.seaOcean.update(this.time % FFT_PERIOD, dt);
      s.dispA.value = this.seaOcean.displacementTexture; s.nrmA.value = this.seaOcean.normalTexture;
    } else { s.dispA.value = s.dispB.value; s.nrmA.value = s.nrmB.value; }
    if (this.caustics) { this.caustics.update(); s.causticsTex.value = this.caustics.texture; }
    // ripple window follows the point of the lowest water plane under the screen centre
    const cam = this.camera; cam.updateMatrixWorld();
    const p = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld), f = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
    const lvl = this.bodies.length ? this.bodies[0].level : 0;
    if (Math.abs(f.y) > 1e-3) { const t = (lvl - p.y) / f.y; this.ripples.follow(p.x + f.x * t, p.z + f.z * t); this._viewCentre = new THREE.Vector3(p.x + f.x * t, lvl, p.z + f.z * t); }
    this.ripples.update(dt);
    s.rippleTex.value = this.ripples.texture; s.rippleArea.value.copy(this.ripples.area);
    for (const b of this.bodies) { b.uniforms.dispScaleA.value = b.o.type === 'sea' && this.seaOcean ? 1 : 0; }
    this._envAndLights();
    // (`mirrorLater`: the host draws the mirror itself once the frame's world matrices are up to date — Game.render
    // calls renderMirror() after its one scene.updateMatrixWorld — instead of a full extra matrix update per level here)
    if (this.mirrorLater) this._mirrorDue = true;
    else this._renderReflections();
    this.lastUpdateMs = performance.now() - t0;
    this.frames = (this.frames || 0) + 1;
  }

  /** The mirror render update() left for later (`mirrorLater`); nothing when it was not due this frame. */
  renderMirror() {
    if (!this._mirrorDue) return;
    this._mirrorDue = false;
    this._renderReflections();
  }

  /** Switch water quality ('low'|'medium'|'high'|'ultra'); bodies are kept. */
  setQuality(name) {
    if (!WATER_QUALITY[name] || name === this.qualityName) return;
    this._disposeInternals();
    this.qualityName = name; this.Q = WATER_QUALITY[name];
    this._build();
    const old = this.bodies.slice(); this.bodies = [];
    for (const b of old) { this.waterScene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); b.bake.texture.dispose(); b.bake.texture2.dispose(); this.addBody(b.o); }
  }

  /** Tweak spectra at runtime, e.g. setSea({ wind: 14, chop: 1.6 }) for a storm. */
  setSea(o) { Object.assign(this.sea, o); this.seaOcean && this.seaOcean.set(this.sea); }
  setDetail(o) { Object.assign(this.detail, o); this.detailOcean.set(this.detail); }

  _disposeInternals() {
    if (this._subRT) { this._subRT.dispose(); this._subMat.dispose(); this._subRT = null; }
    this.detailOcean.dispose(); this.seaOcean && this.seaOcean.dispose(); this.ripples.dispose(); this.caustics && this.caustics.dispose();
    for (const R of this.reflections.values()) R.rt.dispose();
    this.reflections.clear();
  }

  dispose() {
    for (const b of this.bodies.slice()) this.removeBody(b);
    this._disposeInternals();
    this._unviews?.(); this._unviews = null;
    if (this._unhook) { this._unhook.forEach((f) => f()); this._unhook = null; }
    else if (this.composer) { const i = this.composer.passes.indexOf(this.pass); if (i >= 0) this.composer.passes.splice(i, 1); }
    this.pass.dispose();
    this.shared.detailTex.value && this.shared.detailTex.value.dispose();
    this.shared.foamTex.value && this.shared.foamTex.value.dispose();
  }
}

/** Factory matching the SHADOW SIX API contract. */
export function createWater(renderer, scene, camera, opts = {}) {
  return new WaterSystem(renderer, scene, camera, opts);
}
export { waterBodiesFromGrid } from './grid.js';
