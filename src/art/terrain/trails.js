/**
 * World-space deformable-ground trail system (terrain final).
 *  - GPU: deformation RT (RG16F: R rut depth, G berm) over the whole map + a quarter-resolution flatten RT (R16F,
 *    grass push-down). Stamps = instanced oriented quads, MAX blending. Fading = in-place multiply blend every
 *    `fadeInterval` s with per-layer lives from the splat (no ping-pong copy): 4.1 B/px instead of 16 B/px.
 *  - CPU: ring buffer of trail records for gameplay (guards following footprints in snow/sand).
 *  - High-level API (grafted from T-A): 'vehicle' stamps every wheel / track (dual rear tyres, half-tracks),
 *    'walker' auto-alternates boot prints, onSpray hook for dust / mud / snow spray VFX.
 * Heading: facing = (cos h, sin h) in (x, z) (docs/ARCHITECTURE.md).
 * @module terrain-final/trails
 */
import * as THREE from 'three';
import { STAMP_VERT, STAMP_FRAG, FADE_VERT, FADE_FRAG } from './trails-glsl.js';

export const TRAIL_KINDS = { tire: 0, track: 1, foot: 2, crawl: 3, drag: 4, crater: 5, flatten: 6 };
// defaults per kind: feature width (m), quad width factor, depth, berm, min spacing for CPU records (m)
const KIND_DEF = {
  tire: { fw: 0.26, qw: 1.9, depth: 0.85, berm: 0.8, rec: 0.6 },
  track: { fw: 0.52, qw: 1.8, depth: 1.1, berm: 0.9, rec: 0.6 },
  foot: { fw: 0.2, qw: 1.0, len: 0.34, depth: 0.75, berm: 0.5, rec: 0 },
  crawl: { fw: 0.6, qw: 1.7, depth: 0.55, berm: 0.4, rec: 0.4 },
  drag: { fw: 0.42, qw: 1.7, depth: 0.5, berm: 0.4, rec: 0.4 },
  crater: { fw: 2.0, qw: 1.8, depth: 1.4, berm: 1.0, rec: 0 },
  flatten: { fw: 0.8, qw: 1.0, depth: 0, berm: 0, rec: 1e9 },
};
const MAX_BATCH = 4096;
/** Vehicle layouts: track (m, wheel centre to centre), wheelbase, tyre width, rear dual tyres, tracked rear. */
export const VEHICLE_TYPES = {
  car: { track: 1.45, wb: 2.6, tire: 0.2, load: 0.7 },
  jeep: { track: 1.25, wb: 2.05, tire: 0.2, load: 0.6 },
  truck: { track: 1.8, wb: 3.6, tire: 0.26, dualRear: true, load: 1 },
  motorcycle: { track: 0, wb: 1.4, tire: 0.12, load: 0.45 },
  halftrack: { track: 1.75, wb: 3.2, tire: 0.26, rearTrack: 0.32, load: 1.05 },
  tank: { track: 2.3, wb: 0, trackW: 0.52, tracked: true, load: 1.25 },
};

export class TrailSystem {
  /**
   * @param {THREE.WebGLRenderer} gl
   * @param {{width:number, depth:number, pxPerM?:number, splatA:THREE.Texture, splatB:THREE.Texture,
   *   tau:number[], materialAt:(x:number,z:number)=>{soft:number, visible:number, tau:number, name:string}}} o
   */
  constructor(gl, o) {
    this.gl = gl;
    this.W = o.width; this.D = o.depth;
    this.pxPerM = o.pxPerM || 16;
    this.materialAt = o.materialAt;
    this.onSpray = o.onSpray || null;
    const w = Math.min(4096, Math.ceil(this.W * this.pxPerM)), h = Math.min(4096, Math.ceil(this.D * this.pxPerM));
    const mk = (ww, hh, fmt) => new THREE.WebGLRenderTarget(ww, hh, {
      type: THREE.HalfFloatType, format: fmt, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    });
    this.rtDef = mk(w, h, THREE.RGFormat);                                   // must-fix 10: RG16F, single buffer
    this.rtFlat = mk(Math.ceil(w / 4), Math.ceil(h / 4), THREE.RedFormat);  // grass flatten at 1/4 res
    this.texel = new THREE.Vector2(1 / w, 1 / h);
    this.memoryBytes = w * h * 4 + Math.ceil(w / 4) * Math.ceil(h / 4) * 2;
    this._clearTargets();

    // stamp batch
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BATCH * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BATCH * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aParam = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BATCH * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aExtra = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BATCH * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPosDir', this.aPos); g.setAttribute('iSize', this.aSize); g.setAttribute('iParam', this.aParam); g.setAttribute('iExtra', this.aExtra);
    g.instanceCount = 0;
    this.stampMat = new THREE.ShaderMaterial({
      vertexShader: STAMP_VERT, fragmentShader: STAMP_FRAG,
      uniforms: { uMapSize: { value: new THREE.Vector2(this.W, this.D) }, uFlat: { value: 0 } },
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendEquationAlpha: THREE.MaxEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    this.stampMesh = new THREE.Mesh(g, this.stampMat);
    this.stampMesh.frustumCulled = false;
    this.stampScene = new THREE.Scene();
    this.stampScene.add(this.stampMesh);
    this.cam = new THREE.Camera();
    this.nBatch = 0;

    // fade pass: in-place multiply (dst *= src)
    const tau = o.tau || new Array(8).fill(600);
    this.fadeMat = new THREE.ShaderMaterial({
      vertexShader: FADE_VERT, fragmentShader: FADE_FRAG, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      uniforms: {
        tSplatA: { value: o.splatA }, tSplatB: { value: o.splatB },
        uTauA: { value: new THREE.Vector4(...tau.slice(0, 4)) }, uTauB: { value: new THREE.Vector4(...tau.slice(4, 8)) },
        uDt: { value: 1 }, uFlatTau: { value: 0 },
      },
    });
    this.flatTau = o.flatTau ?? 420;
    const fq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fadeMat);
    fq.frustumCulled = false;
    this.fadeScene = new THREE.Scene();
    this.fadeScene.add(fq);
    this.fadeAcc = 0;
    this.fadeInterval = o.fadeInterval ?? 6; // half-float multiply needs k <= ~0.998 per step to make progress
    this.timeScale = 1; // >1 to preview fading

    // CPU records
    this.cap = o.capacity || 8192;
    this.rec = new Array(this.cap);
    this.recN = 0; this.recHead = 0;
    this.sources = new Map(); // id → {x, z, odo, lastRecX, lastRecZ, stepAcc, side}
    this.time = 0;
    this.stats = { stamps: 0, frameStamps: 0 };
  }

  /** Deformation texture (RG: rut, berm). */
  get texture() { return this.rtDef.texture; }
  /** Grass flatten texture (R). */
  get flatTexture() { return this.rtFlat.texture; }

  _push(kind, x, z, cos, sin, len, qw, fw, odo, depth, berm, side, coh = 0.7, seed = 0) {
    if (this.nBatch >= MAX_BATCH) return;
    const e = this.nBatch * 2;
    this.aExtra.array[e] = coh; this.aExtra.array[e + 1] = seed;
    const i = this.nBatch++ * 4;
    const P = this.aPos.array, S = this.aSize.array, Q = this.aParam.array;
    P[i] = x; P[i + 1] = z; P[i + 2] = cos; P[i + 3] = sin;
    S[i] = len; S[i + 1] = qw; S[i + 2] = fw; S[i + 3] = odo;
    Q[i] = kind; Q[i + 1] = depth; Q[i + 2] = berm; Q[i + 3] = side;
  }

  _record(kind, x, z, heading, id, mat, extra) {
    if (this._noRecord) return;
    const r = { kind, x, z, heading, id, t: this.time, strength: mat.visible, tau: mat.tau, material: mat.name, ...extra };
    this.rec[this.recHead] = r;
    this.recHead = (this.recHead + 1) % this.cap;
    this.recN = Math.min(this.cap, this.recN + 1);
  }

  /**
   * Stamp a trail mark. Low-level kinds: tire, track, foot, crawl, drag, crater, flatten. Continuous kinds
   * (tire, track, crawl, drag) with `params.id` are joined into a seamless strip from the previous call of the
   * same id (odometer keeps tread patterns continuous).
   * High-level kinds (T-A API): 'vehicle' {id, type, speed?, track?, wheelbase?} stamps every wheel / track;
   * 'walker' | 'walk' | 'run' | 'crouch' {id, run?, stride?} auto-place alternating boot prints at stride length.
   * @returns {{material:string, soft:number, wet:number, visible:number}} surface info for dust/mud-spray VFX hooks
   */
  stamp(kind, x, z, heading = 0, params = {}) {
    if (params.record === false) { this._noRecord = true; try { return this.stamp(kind, x, z, heading, { ...params, record: true }); } finally { this._noRecord = false; } }
    if (this.nBatch > MAX_BATCH - 64) this.update(0); // flush long scripted stamping runs
    const mat = this.materialAt(x, z);
    if (x < 0 || z < 0 || x > this.W || z > this.D) return mat;
    if (kind === 'vehicle') return this._vehicle(x, z, heading, params, mat);
    if (kind === 'walker' || kind === 'walk' || kind === 'run' || kind === 'crouch') {
      return this._steps(params.run ? 'run' : kind === 'walker' ? 'walk' : kind, x, z, heading, params, mat);
    }
    const d = KIND_DEF[kind];
    if (!d) throw new Error('unknown trail kind ' + kind);
    const k = TRAIL_KINDS[kind];
    const fw = params.width ?? d.fw;
    const depth = (params.depth ?? d.depth) * (params.load ?? 1);
    const berm = params.berm ?? d.berm;
    const coh = mat.coh ?? 0.7;
    const seed = params.seed ?? (typeof params.id === 'string' ? (params.id.length * 7.31 + params.id.charCodeAt(params.id.length - 1)) % 97 : (params.id ?? 0) % 97);
    let c = Math.cos(heading), s = Math.sin(heading);
    if (k <= 4 && k !== 2 && params.id != null) {
      const src = this.sources.get(params.id);
      if (src && Math.hypot(x - src.x, z - src.z) < 4) {
        const dx = x - src.x, dz = z - src.z, dist = Math.hypot(dx, dz);
        if (dist < 0.015) return mat;
        c = dx / dist; s = dz / dist;
        this._push(k, (x + src.x) / 2, (z + src.z) / 2, c, s, dist + fw * 0.3, fw * d.qw, fw, src.odo + dist / 2, depth, berm, seed, coh, seed);
        src.odo += dist; src.x = x; src.z = z;
        if (Math.hypot(x - src.rx, z - src.rz) >= d.rec) { src.rx = x; src.rz = z; this._record(params.recordKind || kind, x, z, Math.atan2(s, c), params.owner ?? params.id, mat); }
        this.stats.stamps++;
        return mat;
      }
      this.sources.set(params.id, { x, z, odo: 0, rx: x, rz: z });
    }
    const len = params.length ?? d.len ?? fw;
    this._push(k, x, z, c, s, len, fw * d.qw, fw, 0, depth, berm, params.side ?? 1, coh, seed);
    this._record(params.recordKind || kind, x, z, heading, params.owner ?? params.id ?? null, mat, params.side ? { side: params.side } : undefined);
    this.stats.stamps++;
    return mat;
  }

  /** Every wheel / track of a vehicle at (x, z) facing `heading` (T-A graft; wheel ids are `${id}:w…`). */
  _vehicle(x, z, h, p, mat) {
    const V = VEHICLE_TYPES[p.type || 'truck'] || VEHICLE_TYPES.truck;
    const id = p.id ?? 'veh', c = Math.cos(h), s = Math.sin(h);
    const track = p.track ?? V.track, wb = p.wheelbase ?? V.wb, load = (p.load ?? 1) * V.load;
    const at = (a, b) => [x + c * a - s * b, z + s * a + c * b]; // along a (forward), side b (right = (-sin, cos))
    const o = { owner: id, recordKind: 'vehicle', load, seed: p.seed };
    if (V.tracked) {
      for (const side of [-1, 1]) { const [px, pz] = at(0, side * track / 2); this.stamp('track', px, pz, h, { ...o, id: `${id}:t${side}`, width: p.trackWidth ?? V.trackW }); }
    } else if (!track) {                                   // motorcycle: one line, rear slightly deeper
      const [fx, fz] = at(wb / 2, 0), [rx, rz] = at(-wb / 2, 0);
      this.stamp('tire', fx, fz, h, { ...o, id: `${id}:f`, width: V.tire });
      this.stamp('tire', rx, rz, h, { ...o, id: `${id}:r`, width: V.tire * 1.15, load: load * 1.1 });
    } else {
      for (const side of [-1, 1]) {
        const [fx, fz] = at(wb / 2, side * track / 2);
        this.stamp('tire', fx, fz, h, { ...o, id: `${id}:f${side}`, width: p.tireWidth ?? V.tire, load: load * 0.85 });
        const [rx, rz] = at(-wb / 2, side * track / 2);
        if (V.rearTrack) this.stamp('track', rx, rz, h, { ...o, id: `${id}:r${side}`, width: V.rearTrack, load });
        else this.stamp('tire', rx, rz, h, { ...o, id: `${id}:r${side}`, width: (p.tireWidth ?? V.tire) * (V.dualRear ? 1.9 : 1), load: load * 1.1 });
      }
    }
    if (this.onSpray && (p.speed ?? 0) > 0.5 && mat.soft > 0.01) this.onSpray({ x, z, heading: h, material: mat.name, wet: mat.wet, snow: mat.snow, speed: p.speed, type: p.type || 'truck', id });
    return mat;
  }

  _steps(kind, x, z, heading, params, mat) {
    const id = params.id ?? 'anon';
    const stride = params.stride ?? (kind === 'run' ? 1.05 : kind === 'crouch' ? 0.5 : 0.72);
    let src = this.sources.get(id);
    if (!src || Math.hypot(x - src.x, z - src.z) > 4) {
      src = { x, z, acc: stride, side: 1 };
      this.sources.set(id, src);
    }
    src.acc += Math.hypot(x - src.x, z - src.z);
    src.x = x; src.z = z;
    if (src.acc >= stride) {
      src.acc = 0;
      src.side = -src.side;
      const c = Math.cos(heading), s = Math.sin(heading);
      const j = Math.random();
      const off = (0.1 + 0.02 * j) * src.side; // right vector = (-sin, cos)
      const px = x - s * off, pz = z + c * off;
      const yaw = heading + src.side * (0.06 + 0.06 * j) + (Math.random() - 0.5) * 0.08; // toes out + gait noise
      const depth = (params.depth ?? 0.75) * (kind === 'run' ? 1.1 : 1) * (0.9 + 0.2 * Math.random());
      // art review: in deep soft snow a boot sinks and the walls collapse outward — the hole is ~1.5x the sole,
      // which also keeps prints resolvable on the ~20–30 texel/m trail RT (a 10 cm sole is 2–3 texels wide)
      const sc = 1 + 0.5 * Math.min(1, (mat.snow ?? 0) * Math.min(1, (mat.soft ?? 0) / 0.12));
      this._push(2, px, pz, Math.cos(yaw), Math.sin(yaw), (params.length ?? 0.34) * sc, 0.2 * sc, 0.2 * sc, 0, depth, 0.5, src.side, mat.coh ?? 0.7, Math.random() * 97);
      this._record('foot', px, pz, heading, id, mat, { side: src.side });
      this.stats.stamps++;
    }
    return mat;
  }

  /**
   * Gameplay-only record (no visual stamp), e.g. from the unit 'footprint' event while visuals are stamped per frame
   * with record:false. `aiVisible:false` records are kept but never returned to AI queries that pass `aiOnly`.
   */
  record(kind, x, z, heading, id, extra) {
    const mat = this.materialAt(x, z);
    this._record(kind, x, z, heading, id, mat, extra);
    return mat;
  }

  /** Forget the joining state of a source (e.g. vehicle teleported / unit died). Vehicle ids clear all wheels. */
  endSource(id) { for (const k of [...this.sources.keys()]) if (k === id || String(k).startsWith(id + ':')) this.sources.delete(k); }

  /**
   * Gameplay query: trail records within r of (x, z), newest first. `visibility` (= strength) is 0..1:
   * material print visibility (snow 1, sand .95, mud .9, grass .45, road .15, rock .02) × exp(-age / material life).
   * @param {{maxAge?:number, minStrength?:number, minVisibility?:number, kinds?:string[], excludeId?:any}} [o]
   * @returns {{x:number,z:number,heading:number,kind:string,id:any,age:number,strength:number,visibility:number,material:string,side?:number}[]}
   */
  query(x, z, r, o = {}) {
    const out = [], r2 = r * r, maxAge = o.maxAge ?? Infinity, minS = o.minVisibility ?? o.minStrength ?? 0.05;
    for (let n = 0; n < this.recN; n++) {
      const e = this.rec[n];
      const dx = e.x - x, dz = e.z - z;
      if (dx * dx + dz * dz > r2) continue;
      const age = this.time - e.t;
      if (age > maxAge) continue;
      if (o.kinds && !o.kinds.includes(e.kind)) continue;
      if (o.excludeId != null && e.id === o.excludeId) continue;
      if (o.aiOnly && e.aiVisible === false) continue;
      const strength = e.strength * Math.exp(-age / e.tau);
      if (strength < minS) continue;
      out.push({ x: e.x, z: e.z, heading: e.heading, kind: e.kind, id: e.id, age, strength, visibility: strength, material: e.material, side: e.side, aiVisible: e.aiVisible !== false });
    }
    out.sort((a, b) => a.age - b.age);
    return out;
  }

  update(dt) {
    const gl = this.gl;
    this.time += dt;
    const prevRT = gl.getRenderTarget(), prevAuto = gl.autoClear;
    gl.autoClear = false;
    this.stats.frameStamps = this.nBatch;
    if (this.nBatch > 0) {
      const g = this.stampMesh.geometry;
      g.instanceCount = this.nBatch;
      for (const a of [this.aPos, this.aSize, this.aParam, this.aExtra]) { a.clearUpdateRanges(); a.addUpdateRange(0, this.nBatch * a.itemSize); a.needsUpdate = true; }
      this.stampMat.uniforms.uFlat.value = 0;
      gl.setRenderTarget(this.rtDef); gl.render(this.stampScene, this.cam);
      this.stampMat.uniforms.uFlat.value = 1;
      gl.setRenderTarget(this.rtFlat); gl.render(this.stampScene, this.cam);
      this.nBatch = 0;
    }
    this.fadeAcc += dt * this.timeScale;
    if (this.fadeAcc >= this.fadeInterval) {
      const U = this.fadeMat.uniforms;
      U.uDt.value = this.fadeAcc; this.fadeAcc = 0;
      U.uFlatTau.value = 0; gl.setRenderTarget(this.rtDef); gl.render(this.fadeScene, this.cam);
      U.uFlatTau.value = this.flatTau; gl.setRenderTarget(this.rtFlat); gl.render(this.fadeScene, this.cam);
    }
    gl.setRenderTarget(prevRT);
    gl.autoClear = prevAuto;
  }

  /** Zero both render targets, restoring the renderer's target and clear colour (the game's composer relies on them). */
  _clearTargets() {
    const gl = this.gl, prev = gl.getRenderTarget(), cc = gl.getClearColor(new THREE.Color()), ca = gl.getClearAlpha();
    for (const r of [this.rtDef, this.rtFlat]) { gl.setRenderTarget(r); gl.setClearColor(0x000000, 0); gl.clear(true, false, false); }
    gl.setRenderTarget(prev);
    gl.setClearColor(cc, ca);
  }

  clear() {
    this._clearTargets();
    this.recN = 0; this.recHead = 0; this.sources.clear();
  }

  dispose() {
    this.rtDef.dispose(); this.rtFlat.dispose();
    this.stampMesh.geometry.dispose(); this.stampMat.dispose(); this.fadeMat.dispose();
  }
}
