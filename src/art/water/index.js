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
import { captureHeights } from './fields.js';
import { FFTOcean, FFT_PERIOD } from './fft.js';
import { RippleSim } from './ripples.js';
import { Caustics } from './caustics.js';
import { bakeBody, bodyGrid } from './bake.js';

export { FX_LAYER };
import { makeWaterMaterial, TIME_LOOP } from './material.js';
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
  addBody(o) {
    const type = o.type || 'lake';
    const level = o.level ?? 0;
    const P = { ...WATER_PRESETS[o.preset || o.look || (type === 'sea' ? 'sea' : type)] || WATER_PRESETS.lake };
    if (o.absorb) P.absorb = o.absorb; if (o.scatter) P.scatter = o.scatter;
    const bake = bakeBody({ ...o, level }, this.Q.bodyRes, o.capture === false ? null : this._capture(o, level));
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
    const g = bodyGrid({ ...o, level }, this.Q.bodyRes), t0 = performance.now();
    const hide = [], terr = [].concat(this.opts.terrain || []);
    this.scene.traverse((ob) => { const u = ob.userData || {}; if (u.waterIgnore || u.dynamic) hide.push(ob); else if (u.waterTerrain && !terr.includes(ob)) terr.push(ob); });
    const B = [g.minX, g.minZ, g.maxX, g.maxZ], clipY = level + 0.35, r = this.renderer;
    const hgt = captureHeights(r, this.scene, B, g.rx, g.rz, hide, clipY);
    const top = captureHeights(r, this.scene, B, g.rx, g.rz, hide);
    const sol = captureHeights(r, this.scene, B, g.rx, g.rz, hide.concat(terr), clipY);
    const N = g.rx * g.rz, solid = new Uint8Array(N); let any = false;
    for (let k = 0; k < N; k++) {
      if (hgt[k] < -900 && top[k] > -900) hgt[k] = top[k];
      if (hgt[k] > 900 || sol[k] > 900) { solid[k] = 1; hgt[k] = clipY; }
      if (hgt[k] > -900) any = true;
    }
    this.lastCaptureMs = performance.now() - t0;
    return any ? { hgt, solid } : null;
  }

  removeBody(body) {
    const i = this.bodies.indexOf(body); if (i < 0) return;
    this.bodies.splice(i, 1); this.waterScene.remove(body.mesh); this._syncRippleEnv();
    body.mesh.geometry.dispose(); body.mesh.material.dispose(); body.bake.texture.dispose(); body.bake.texture2.dispose();
  }

  /** Push the water surface at (x,z): strength = metres (negative pushes down, |s|<1), radius in metres, foam 0..1 extra churn. */
  disturb(x, z, strength = 0.1, radius = 0.6, foam = 0) { this.ripples.disturb(x, z, strength, radius, foam); }

  _syncRippleEnv() { this.ripples.setBodies(this.bodies.filter((b) => b.mesh.visible).map((b) => ({ texture: b.bake.texture, bounds: b.bake.bounds }))); }

  /**
   * Gameplay query (W-B API merged with depthAt): water under (x,z), bilinear over the bake grid.
   * @returns {{depth:number, flow:[number,number], level:number, type:string, shore:number, ice:boolean, body:object}|null}
   *   depth in metres (bed from bed(x,z) or the capture), flow in m/s, shore = distance to the nearest bank/obstacle (m).
   */
  sample(x, z) {
    for (const b of this.bodies) {
      const B = b.bake.bounds, { rx, rz, data, shoreDist } = b.bake;
      const fx = (x - B.x) / B.z * rx - 0.5, fz = (z - B.y) / B.w * rz - 0.5;
      if (fx < -0.5 || fz < -0.5 || fx > rx - 0.5 || fz > rz - 0.5) continue;
      const i = Math.max(0, Math.min(rx - 2, Math.floor(fx))), j = Math.max(0, Math.min(rz - 2, Math.floor(fz)));
      const tx = Math.min(1, Math.max(0, fx - i)), tz = Math.min(1, Math.max(0, fz - j));
      const L = (arr, st, c) => { const k = (q) => arr[q * st + c];
        const k0 = j * rx + i; return (k(k0) * (1 - tx) + k(k0 + 1) * tx) * (1 - tz) + (k(k0 + rx) * (1 - tx) + k(k0 + rx + 1) * tx) * tz; };
      const depth = L(data, 4, 3);
      if (depth <= 0) continue;
      const shore = L(shoreDist, 1, 0), iw = b.o.frozen ? Infinity : (b.o.ice || 0);
      return { depth, flow: [L(data, 4, 0), L(data, 4, 1)], level: b.level, type: b.o.type, shore, ice: shore < iw * 0.62, body: b };
    }
    return null;
  }

  /** Depth (m) of the body under (x,z) or -1 when dry — useful for gameplay (swimming, wading). */
  depthAt(x, z) { const s = this.sample(x, z); return s ? s.depth : -1; }

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

  _renderReflections() {
    const Q = this.Q, r = this.renderer, cam = this.camera;
    // perf review (art integration 2): the mirror is a second full scene render (~2 ms CPU on M3). With a still
    // camera it is refreshed every `reflEvery` frames; the stored reflMatrix keeps the old texture registered.
    const every = Q.reflEvery ?? 1, key = cam.matrixWorld.elements.join() + cam.projectionMatrix.elements[0];
    this._reflN = (this._reflN || 0) + 1;
    if (every > 1 && this._reflN % every !== 0 && key === this._reflKey && this.reflections.size) return;
    this._reflKey = key;
    const levels = [];
    for (const b of this.bodies) {
      b.uniforms.reflEnabled.value = 0;
      if (b.o.reflect === false || !b.mesh.visible) continue;
      const key = Math.round(b.level * 100) / 100;
      if (!levels.includes(key)) levels.push(key);
    }
    const used = levels.slice(0, Q.reflection);
    if (!used.length) return;
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
      r.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -(level - 0.05))];
      r.setRenderTarget(R.rt); r.clear();
      const culled = this._reflectCull();
      r.render(this.scene, rc);
      for (const o of culled) o.visible = true;
      for (const b of this.bodies) if (Math.round(b.level * 100) / 100 === level && b.o.reflect !== false) {
        b.uniforms.reflTex.value = R.rt.texture; b.uniforms.reflMatrix.value.copy(R.matrix); b.uniforms.reflEnabled.value = 1;
      }
    }
    r.clippingPlanes = prevClip; r.shadowMap.autoUpdate = prevAuto; this.scene.background = prevBg;
    r.setClearColor(prevCC, prevAlpha); r.setRenderTarget(prevTarget);
  }

  /** Advance simulation and render the off-screen inputs; call once per frame BEFORE the world render. */
  update(dt = 1 / 60) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;
    const s = this.shared, t0 = performance.now();
    s.time.value = this.time % TIME_LOOP;
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
    this._renderReflections();
    this.lastUpdateMs = performance.now() - t0;
    this.frames = (this.frames || 0) + 1;
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
    this.detailOcean.dispose(); this.seaOcean && this.seaOcean.dispose(); this.ripples.dispose(); this.caustics && this.caustics.dispose();
    for (const R of this.reflections.values()) R.rt.dispose();
    this.reflections.clear();
  }

  dispose() {
    for (const b of this.bodies.slice()) this.removeBody(b);
    this._disposeInternals();
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
