// SHADOW SIX — final VFX library.
//   createVfx(scene, camera, renderer, opts) -> { spawn(kind,pos,opts), update(dt), setQuality(preset), stats(), dispose(), pass, ... }
// `renderer` may be the engine Renderer (src/engine/renderer.js; auto-attached: fx pass, shared
// depth, decalScene, preset tracking) or a bare THREE.WebGLRenderer (then insert `vfx.pass`
// yourself and set `vfx.depthProvider`).
import * as THREE from 'three';
import { ParticlePool } from './pool.js';
import { SMOKE_VERT, SMOKE_FRAG, HOT_VERT, HOT_FRAG } from './shaders.js';
import { bakeVfxTextures } from './textures.js';
import { Debris } from './debris.js';
import { LightPool } from './lights.js';
import { Decals } from './decals.js';
import { FxPass, NHAZE } from './pass.js';
import { attachToEngine } from './engine.js';
import { RECIPES, ALIASES } from './effects.js';
import { WIND_UNIFORMS } from '../../world/wind.js';

export const FIXED_DT = 1 / 60;
/** VFX quality tiers, keyed like engine QUALITY_PRESETS. */
export const VFX_QUALITY = {
  low: { smokeCap: 9000, hotCap: 3000, density: 0.55, fxMaxHeight: 540, haze: false, debrisCap: 160, softK: 0.5 },
  medium: { smokeCap: 16000, hotCap: 5000, density: 0.75, fxMaxHeight: 720, haze: true, debrisCap: 300, softK: 0.5 },
  high: { smokeCap: 26000, hotCap: 8000, density: 1, fxMaxHeight: 900, haze: true, debrisCap: 450, softK: 0.5 },
  ultra: { smokeCap: 36000, hotCap: 12000, density: 1, fxMaxHeight: 1080, haze: true, debrisCap: 600, softK: 0.5 },
};

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function createVfx(scene, camera, renderer, opts = {}) {
  const eng = renderer && renderer._buildComposer ? renderer : null;
  const gl = eng ? eng.renderer : renderer;
  const textures = bakeVfxTextures(gl);
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const u = {
    uTime: { value: 0 }, uWind: { value: (opts.wind || V3(1.6, 0, 0.6)).clone() },
    uSunDir: { value: V3(0.3, 0.7, 0.6).normalize() }, uSunColor: { value: new THREE.Color(3.2, 3.0, 2.7) },
    uSkyColor: { value: new THREE.Color(0.55, 0.62, 0.75) }, uGroundColor: { value: new THREE.Color(0.35, 0.28, 0.2) },
    uLightPos: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, -1000, 0, 1)) },
    uLightCol: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
    uFireGain: { value: opts.fireGain ?? 3.0 }, uFlameGain: { value: opts.flameGain ?? 1.5 }, uSoftK: { value: 0.5 },
    tDepth: { value: null }, uHasDepth: { value: 0 }, uNear: { value: 1 }, uFar: { value: 1000 }, uOrtho: { value: 1 },
    uFogColor: { value: new THREE.Color(0.7, 0.7, 0.7) }, uFogRange: { value: new THREE.Vector2(0, 0) }, uPxWorld: { value: 0.03 },
    ...WIND_UNIFORMS, // shared WindField set (local gust fronts through plumes, see shaders.js gustPush)
  };
  const premult = { side: THREE.DoubleSide, transparent: true, depthWrite: false, depthTest: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor };
  const smokeMat = new THREE.ShaderMaterial({ uniforms: { ...u, uPuff: { value: textures.puff.texture }, uDetail: { value: textures.detail.texture }, uRes: { value: new THREE.Vector2(1, 1) } },
    vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG, ...premult });
  const hotMat = new THREE.ShaderMaterial({ uniforms: { ...u, uRes: { value: new THREE.Vector2(1, 1) } },
    vertexShader: HOT_VERT, fragmentShader: HOT_FRAG, ...premult, blendDst: THREE.OneFactor, blendDstAlpha: THREE.OneFactor });
  const QMAX = VFX_QUALITY.ultra;
  const smoke = new ParticlePool(QMAX.smokeCap, smokeMat, { sorted: true, name: 'vfx-smoke' });
  const hot = new ParticlePool(QMAX.hotCap, hotMat, { sorted: false, name: 'vfx-hot' });
  const lights = new LightPool(scene, u);
  const decals = new Decals(opts.decalScene || (eng ? eng.decalScene : scene), textures);
  const debris = new Debris(scene, QMAX.debrisCap, opts.groundHeight);
  const haze = [];

  const vfx = {
    time: 0, acc: 0, seedCounter: 1, camera, scene, textures, u, smoke, hot, lights, decals, debris, haze,
    events: [], emitters: [], explosives: [], shake: 0, onShake: null, quality: { ...VFX_QUALITY.high, name: 'high' },
    depthProvider: null, groundHeight: opts.groundHeight || (() => 0), pressure: 1, env: { auto: opts.autoEnvironment !== false },
    rand(seed) { return mulberry32((seed ?? this.seedCounter++) * 9301 + 49297); },
    /** density-scaled integer count (quality tier + budget pressure) */
    n(count) { return Math.max(1, Math.round(count * this.quality.density * this.pressure)); },
    at(delay, fn) { this.events.push({ t: this.time + delay, fn }); },
    addEmitter(e) { e.acc = 0; e.t0 = this.time; this.emitters.push(e); return e; },
    emit(p) {
      const pool = p.hot ? hot : smoke;
      if (pool.liveCount >= (p.hot ? this.quality.hotCap : this.quality.smokeCap) && pool.free.length) {
        // over the preset budget: recycle the oldest instead of growing
        const f = pool.free; pool.free = []; const r = pool.emit(this.time + (p.dtOff || 0), p); pool.free = f; return r;
      }
      return pool.emit(this.time + (p.dtOff || 0), p);
    },
    light(req) { req.t0 = this.time + (req.delay || 0); return lights.add(req); },
    heatSource(h) { h.t0 = this.time; haze.push(h); return h; },
    decal(pos, size, kind = 'scorch', o = {}) { return decals.add(this.time, { x: pos.x, y: this.groundHeight(pos.x, pos.z), z: pos.z }, size, kind, o); },
    addShake(a) { this.shake = Math.min(1.5, this.shake + a); if (this.onShake) this.onShake(a); },
    /** Register a prop that detonates when a blast reaches it (chain reactions). kind: 'barrel_explosion'|'tanker_explosion'|... */
    addExplosive(object3D, kind = 'barrel_explosion', o = {}) { const ex = { obj: object3D, kind, opts: o, armed: true }; this.explosives.push(ex); return ex; },
    removeExplosive(object3D) { this.explosives = this.explosives.filter((e) => e.obj !== object3D); },
    blast(pos, radius, rng) {
      for (const ex of this.explosives) {
        if (!ex.armed) continue;
        const d = ex.obj.position.distanceTo(pos);
        if (d < radius) {
          ex.armed = false; const delay = 0.2 + rng() * 0.6 * (0.5 + d / radius);
          this.at(delay, () => { ex.obj.visible = false; this.spawn(ex.kind, ex.obj.position.clone().setY(this.groundHeight(ex.obj.position.x, ex.obj.position.z)), { ...ex.opts, chainFrom: pos }); ex.onDetonate?.(); });
        }
      }
    },
    /** Spawn an effect. pos: Vector3 or {x,y,z}. Persistent effects return a handle with stop(). */
    spawn(kind, pos, o = {}) {
      const r = RECIPES[ALIASES[kind] || kind];
      if (!r) throw new Error('unknown vfx kind ' + kind);
      const rng = this.rand(o.seed);
      const p = pos.isVector3 ? pos.clone() : V3(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0);
      return r(this, p, o, rng) || null;
    },
    /** Advance with a fixed internal step (deterministic regardless of frame rate). */
    update(dt) {
      this.acc += Math.min(Math.max(dt, 0), 0.25);
      while (this.acc >= FIXED_DT - 1e-9) { this.acc -= FIXED_DT; this._step(FIXED_DT); }
      this._frame();
    },
    /** Simulation-only advance (host sim tick); pair with frame() once per displayed frame. */
    advance(dt) {
      this.acc += Math.min(Math.max(dt, 0), 0.25);
      while (this.acc >= FIXED_DT - 1e-9) { this.acc -= FIXED_DT; this._step(FIXED_DT); }
    },
    /** Per displayed frame: sort + upload particles, lights, decals (camera-dependent work). */
    frame() { this._frame(); },
  };
  Object.assign(vfx, makeRuntime(vfx, { eng, gl, u, smoke, hot, lights, decals, debris, haze, textures, smokeMat, hotMat }));
  vfx.pass = new FxPass(vfx);
  vfx.pass.smokeScene.add(smoke.mesh); vfx.pass.hotScene.add(hot.mesh);
  if (eng) vfx.detach = attachToEngine(eng, vfx);
  else vfx.setQuality(opts.quality || 'high');
  return vfx;
}

function makeRuntime(vfx, { eng, gl, u, smoke, hot, lights, decals, debris, haze, textures, smokeMat, hotMat }) {
  const _v = new THREE.Vector3(), _w = new THREE.Vector3();
  let sunL = null, hemiL = null;
  const findLights = () => {
    sunL = eng?.sun || null; hemiL = eng?.hemi || null;
    if (!sunL || !hemiL) for (const o of vfx.scene.children) { if (!sunL && o.isDirectionalLight) sunL = o; if (!hemiL && o.isHemisphereLight) hemiL = o; }
  };
  return {
    _step(dt) {
      this.time += dt; const t = this.time;
      if (this.events.length) {
        const due = this.events.filter((e) => e.t <= t + 1e-9);
        if (due.length) { this.events = this.events.filter((e) => e.t > t + 1e-9); for (const e of due) e.fn(); }
      }
      // budget pressure: thin out continuous emitters when the smoke pool nears its cap
      const fill = smoke.liveCount / this.quality.smokeCap;
      this.pressure = fill > 0.7 ? Math.max(0.35, 1 - (fill - 0.7) * 2.2) : 1;
      for (const e of this.emitters) {
        const age = t - e.t0; if (age > e.dur || e.stopped) { e.dead = true; continue; }
        e.acc += dt * (typeof e.rate === 'function' ? e.rate(age) : e.rate) * (e.noScale ? 1 : this.quality.density * this.pressure);
        while (e.acc >= 1) { e.acc -= 1; e.fn(age, e); }
        if (e.tick) e.tick(age, dt, e);
      }
      if (this.emitters.some((e) => e.dead)) this.emitters = this.emitters.filter((e) => !e.dead);
      debris.step(dt, (it, sdt, resting) => RECIPES._trail(this, it, sdt, resting));
      this.shake *= Math.exp(-dt * 3.5);
      for (let i = haze.length - 1; i >= 0; i--) if (t - haze[i].t0 > haze[i].dur || haze[i].stopped) haze.splice(i, 1);
    },
    _frame() {
      const t = this.time;
      u.uTime.value = t;
      if (this.env.auto) this.syncEnvironment();
      this.camera.updateMatrixWorld();
      smoke.update(t, this.camera, u.uWind.value);
      hot.update(t, this.camera, u.uWind.value);
      lights.update(t);
      decals.update(t);
    },
    /** Pull sun / sky / fog from the scene (or the engine) so smoke takes on theater lighting. */
    syncEnvironment() {
      if (!sunL || !hemiL) findLights();
      if (sunL) {
        _v.copy(sunL.position).sub(sunL.target.position).normalize(); u.uSunDir.value.copy(_v);
        u.uSunColor.value.copy(sunL.color).multiplyScalar(sunL.intensity / Math.PI); // same 1/pi Lambert as MeshStandardMaterial
      }
      if (hemiL) {
        const envI = this.scene.environment ? (this.scene.environmentIntensity ?? 1) * 0.5 : 0, hI = hemiL.intensity / Math.PI;
        u.uSkyColor.value.copy(hemiL.color).multiplyScalar(hI + envI);
        u.uGroundColor.value.copy(hemiL.groundColor).multiplyScalar(hI + envI * 0.5);
      }
      const f = this.scene.fog;
      if (f && f.isFog) { u.uFogColor.value.copy(f.color); u.uFogRange.value.set(f.near, f.far); } else u.uFogRange.value.set(0, 0);
    },
    /** Environment override (wind in m/s; colours as THREE.Color). */
    setEnvironment(e = {}) {
      if (e.wind) u.uWind.value.copy(e.wind);
      if (e.auto !== undefined) this.env.auto = e.auto;
      if (e.sunDir) u.uSunDir.value.copy(e.sunDir).normalize();
      if (e.sunColor) u.uSunColor.value.copy(e.sunColor);
      if (e.skyColor) u.uSkyColor.value.copy(e.skyColor);
      if (e.groundColor) u.uGroundColor.value.copy(e.groundColor);
    },
    _prepareFrame(readBuffer, w, h) {
      const d = this.depthProvider ? this.depthProvider(readBuffer) : null;
      this.pass._lastDepth = d; u.tDepth.value = d; u.uHasDepth.value = d ? 1 : 0;
      const c = this.camera;
      u.uNear.value = c.near; u.uFar.value = c.far; u.uOrtho.value = c.isOrthographicCamera ? 1 : 0;
      if (c.isOrthographicCamera) u.uPxWorld.value = (c.top - c.bottom) / c.zoom / h;
      else { const dist = c.position.length() || 50; u.uPxWorld.value = 2 * Math.tan(THREE.MathUtils.degToRad(c.fov) / 2) * dist / h; }
      u.uPxWorld.value *= gl.getPixelRatio ? gl.getPixelRatio() : 1; // min sizes are in CSS pixels
    },
    /** Pixel rect (x,y,w,h) covering live smoke (projected AABB grown by the largest sprite) and heat sources. */
    _screenRect(w, h, nHaze, out) {
      const c = this.camera; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      const add = (p, rx, ry) => { _w.copy(p).project(c); const px = (_w.x * 0.5 + 0.5) * w, py = (_w.y * 0.5 + 0.5) * h;
        x0 = Math.min(x0, px - rx); x1 = Math.max(x1, px + rx); y0 = Math.min(y0, py - ry); y1 = Math.max(y1, py + ry); };
      const ppm = c.isOrthographicCamera ? h / ((c.top - c.bottom) / c.zoom) : h / 20;
      if (smoke.liveCount) {
        const b = smoke.box, m = smoke.maxSize * 0.75 + 2;
        for (let i = 0; i < 8; i++) add(_v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y + smoke.maxSize * 0.6 : b.min.y, i & 4 ? b.max.z : b.min.z), m * ppm, m * ppm);
      }
      if (nHaze) { const U = this.pass.mat.uniforms; for (let i = 0; i < U.uNH.value; i++) { const q = U.uHaze.value[i]; const r = q.z * h * 1.25 + 8;
        const px = q.x * w, py = q.y * h; x0 = Math.min(x0, px - r); x1 = Math.max(x1, px + r); y0 = Math.min(y0, py - r); y1 = Math.max(y1, py + r); } }
      x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(w, Math.ceil(x1)); y1 = Math.min(h, Math.ceil(y1));
      if (x1 <= x0 || y1 <= y0) return null;
      return out.set(x0, y0, x1 - x0, y1 - y0);
    },
    /** Project live heat sources to screen space (strongest NHAZE). Returns count. */
    _fillHaze(U, w, h) {
      const c = this.camera, t = this.time; let n = 0;
      const vh = c.isOrthographicCamera ? (c.top - c.bottom) / c.zoom : 30;
      for (const q of haze) {
        if (n >= NHAZE) break;
        const a = t - q.t0; const k = (q.fn ? q.fn(a) : 1) * Math.min(1, a / 0.15);
        if (k <= 0.01) continue;
        _w.copy(q.pos).project(c); if (Math.abs(_w.x) > 1.3 || Math.abs(_w.y) > 1.3) continue;
        _v.copy(q.pos).applyMatrix4(c.matrixWorldInverse);
        const ringR = q.ring ? (a / q.dur) : 0;
        U.uHaze.value[n].set(_w.x * 0.5 + 0.5, _w.y * 0.5 + 0.5, q.radius / vh, (q.strength ?? 1) * k);
        U.uHaze2.value[n].set(_v.z, q.radius * 2, q.ring ? 1 : 0, ringR); n++;
      }
      U.uNH.value = n; return this.quality.haze ? n : 0;
    },
    /** Engine preset name ('low'|'medium'|'high'|'ultra') or a partial VFX_QUALITY object. */
    setQuality(preset) {
      const q = typeof preset === 'string' ? { ...(VFX_QUALITY[preset] || VFX_QUALITY.high), name: preset } : { ...this.quality, ...preset };
      this.quality = q; u.uSoftK.value = q.softK; debris.cap = q.debrisCap;
      return q;
    },
    setDecalScene(s) { decals.clear(); decals.scene = s; },
    /** Deterministic camera-shake offset (m, camera plane) for the host camera controller. */
    shakeOffset() { const t = this.time, a = this.shake * this.shake * 0.35;
      return new THREE.Vector2(Math.sin(t * 61.3) * 0.6 + Math.sin(t * 37.1), Math.cos(t * 53.7) * 0.6 + Math.sin(t * 29.3 + 1)).multiplyScalar(a); },
    /** Budget report: particles, draws, lights and a GPU-time estimate (ms, calibrated on RTX 5090 x9 for a mid laptop). */
    stats() {
      const p = this.pass, s = smoke.liveCount, hN = hot.liveCount;
      const draws = (p.drawn ? 2 + (hN ? 1 : 0) : 0) + (debris.mesh.count ? 2 : 0) + debris.heroes.length * 2 + (decals.count ? 1 : 0);
      return { smoke: s, hot: hN, particles: s + hN, recycled: smoke.recycled + hot.recycled, debris: debris.items.length, decals: decals.count,
        lights: lights.reqs.length, emitters: this.emitters.length, haze: haze.length, draws, pressure: this.pressure, quality: this.quality.name,
        fxRes: p.fxRT ? [p.fxRT.width, p.fxRT.height] : null };
    },
    clear() {
      this.events = []; this.emitters = []; lights.clear(); debris.clear(); decals.clear(); haze.length = 0;
      smoke.clear(); hot.clear(); this.time = 0; this.acc = 0; for (const ex of this.explosives) ex.armed = true;
    },
    dispose() {
      this.detach?.(); this.clear(); smoke.dispose(); hot.dispose(); debris.dispose(); decals.dispose(); lights.dispose();
      textures.dispose(); this.pass.dispose(true);
    },
  };
}
