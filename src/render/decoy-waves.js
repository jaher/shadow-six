/**
 * Decoy sound waves (user 2026-10-22: "When decoy beeps can we have some transparent air blast animation around it",
 * "Like sound wave"): every beep of the Green Beret's radio decoy sends three thin, soft, translucent rings out over
 * the ground, like a pulse of air. The leader travels out to the decoy's real hearing radius
 * (CONFIG.stealth.noise.decoy.radius, the radius of the 'noise' event itself) and fades there, so the player reads how
 * far the beep carries; the two behind it die out sooner (0.8 R, 0.6 R), the way a sound thins with distance. Each
 * ring is a bright crest with a darker trough behind it (a lens-like pair that reads on snow, sand and grass alike) and a
 * slight waver, the heat-haze shimmer of a pressure front. Like the selection and noise rings it is a GROUND DECAL
 * (Renderer.decalScene: depth-tested, no depth writes) draped over the terrain relief; it is hidden where the surface
 * leaves the decoy's own level (a wall, a roof, a cliff face), so it never climbs a wall or floats over a drop.
 *
 * Cost: ONE draw per decoy (a polar-grid mesh sampled once on the terrain; the rings live in the fragment shader, and the
 * draw range is cut to the radial band that holds a ring), no per-frame allocation, one shader program (compiled by the
 * load's warm-up frame: `prewarm()` + userData.warmShow, Game._warmFrame). Render time only: it reads the 'noise' event
 * the sim already emits (the same event the beep sound plays from, so ring and beep start together) and never touches the
 * sim. The clock is the interpolated SIM time, so a pause freezes the rings and video mode's 2× / 4× runs them faster
 * with the beeps. Off under reduced motion (like the noise rings).
 * @module render/decoy-waves
 */
import * as THREE from 'three';
import { reducedMotion } from './fx.js';
import { CONFIG } from '../config.js';

/** The three rings of one pulse: start delay (s), share of the hearing radius they reach, peak opacity. */
export const WAVE_RINGS = Object.freeze([
  Object.freeze({ delay: 0, reach: 1, gain: 1 }),
  Object.freeze({ delay: 0.14, reach: 0.8, gain: 0.72 }),
  Object.freeze({ delay: 0.28, reach: 0.6, gain: 0.5 }),
]);
export const WAVE_TRAVEL = 1.0; // s a ring takes from the radio to its reach (eased out: it slows and settles)
export const WAVE_LIFE = WAVE_RINGS[WAVE_RINGS.length - 1].delay + WAVE_TRAVEL; // s until the last ring is gone (< the 1.5 s pulse)
export const WAVE_R0 = 0.32; // m: a ring starts at the radio's case
export const WAVE_HALF0 = 0.07, WAVE_HALF1 = 0.09; // m: crest half-width at the start / the added width at the end
export const WAVE_WAKE0 = 0.4, WAVE_WAKE1 = 0.9; // m: the soft air behind the crest, its fall-off length at the start / the added length at the end
export const WAVE_LIFT = 0.05; // m above the surface (+ polygonOffset)
const SEG = 72, NR = 30; // polar grid
const RHO_IN = 0.015, RHO_OUT = 1.07; // grid extent as a share of the radius (the leader's crest + its trough fit)
const POOL = 4;
const STEEP0 = 1.0, STEEP1 = 1.5; // rise per metre where the ring starts / has finished fading out (a cliff, a wall)
const LEVEL0 = 0.12, LEVEL1 = 0.4; // m: the grid level may differ from the decoy's by this much before the ring fades

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Normalised progress of ring k at `age` s since the pulse (0 before it starts, 1 once it has run its course). */
export function ringU(age, k) {
  const u = (age - WAVE_RINGS[k].delay) / WAVE_TRAVEL;
  return u <= 0 ? 0 : u >= 1 ? 1 : u;
}

/** Radius (m) of ring k's front at `age` for a hearing radius R; -1 while it is not on screen (before / after). */
export function ringFront(age, k, R) {
  const u = ringU(age, k);
  if (u <= 0 || u >= 1) return -1;
  const e = 1 - (1 - u) * (1 - u);
  return WAVE_R0 + (R * WAVE_RINGS[k].reach - WAVE_R0) * e;
}

/** Opacity envelope (0..1, × the ring's gain) of ring k at `age`: quick fade-in, holds, fades over its last 30 % (it has all but reached its radius by then). */
export function ringAlpha(age, k) {
  const u = ringU(age, k);
  if (u <= 0 || u >= 1) return 0;
  return WAVE_RINGS[k].gain * sstep(0, 0.06, u) * (1 - sstep(0.7, 1, u));
}

/** Crest half-width (m) of ring k at `age`: the front spreads and softens as it travels. */
export function ringHalfWidth(age, k) {
  return WAVE_HALF0 + WAVE_HALF1 * ringU(age, k);
}

/** Fall-off length (m) of the soft air trailing behind ring k's crest. */
export function ringWake(age, k) {
  return WAVE_WAKE0 + WAVE_WAKE1 * ringU(age, k);
}

/**
 * The shape of the whole pulse at `age`: {rings: [{r, a, w}…] (r −1 = not drawn), lo, hi} where [lo, hi] is the radial
 * band (m) that holds every ring with its trough (hi < lo: nothing to draw). Pure (unit-tested); fills `out` if given.
 */
export function waveShape(age, R, out = null) {
  const o = out || { rings: WAVE_RINGS.map(() => ({ r: -1, a: 0, w: 0, wake: 0 })), lo: 1, hi: 0 };
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < WAVE_RINGS.length; k++) {
    const r = ringFront(age, k, R), q = o.rings[k];
    q.r = r; q.a = r < 0 ? 0 : ringAlpha(age, k); q.w = r < 0 ? 0 : ringHalfWidth(age, k); q.wake = r < 0 ? 0 : ringWake(age, k);
    if (r >= 0) { lo = Math.min(lo, r - 3.2 * q.wake - 0.3); hi = Math.max(hi, r + 3 * q.w + 0.4); } // (the wake behind, the waver all round)
  }
  o.lo = lo === Infinity ? 1 : Math.max(0, lo);
  o.hi = hi === -Infinity ? 0 : hi;
  return o;
}

// ---------------------------------------------------------------------------------------------------- geometry

/** The unit-radius polar grid: positions (y filled later), per-vertex visibility, rings in radial order. */
export function waveGeometry() {
  const nv = (NR + 1) * (SEG + 1);
  const pos = new Float32Array(nv * 3), vis = new Float32Array(nv).fill(1);
  for (let j = 0; j <= NR; j++) {
    const rho = RHO_IN + (RHO_OUT - RHO_IN) * (j / NR);
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2, v = j * (SEG + 1) + i;
      pos[v * 3] = Math.cos(a) * rho; pos[v * 3 + 2] = Math.sin(a) * rho;
    }
  }
  const idx = new Uint16Array(NR * SEG * 6);
  let n = 0;
  for (let j = 0; j < NR; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = j * (SEG + 1) + i, b = a + 1, c = a + SEG + 1, d = c + 1;
      idx[n++] = a; idx[n++] = c; idx[n++] = b; idx[n++] = b; idx[n++] = c; idx[n++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aVis', new THREE.BufferAttribute(vis, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), RHO_OUT * 1.05);
  return g;
}

/**
 * Lay the grid on the ground around (cx, cz) for hearing radius R: vertex heights relative to the surface under the
 * decoy, plus the per-vertex visibility (1 on the decoy's own level, fading to 0 on a wall, a roof, a cliff face).
 * `terrain(x, z)` is the visual ground relief, `elev(x, z)` the raised walkable level (roofs, decks, plateaus).
 * Returns the surface height under the decoy. Pure (unit-tested); allocation-free apart from two scratch arrays.
 */
export function fillWaveGeometry(geo, cx, cz, R, terrain, elev, lift = WAVE_LIFT) {
  const pos = geo.attributes.position, vis = geo.attributes.aVis, P = pos.array, V = vis.array;
  const e0 = elev(cx, cz), h0 = terrain(cx, cz) + e0;
  const H = new Float32Array((NR + 1) * (SEG + 1)), L = new Float32Array((NR + 1) * (SEG + 1));
  for (let j = 0; j <= NR; j++) {
    for (let i = 0; i < SEG; i++) {
      const v = j * (SEG + 1) + i, x = cx + P[v * 3] * R, z = cz + P[v * 3 + 2] * R, e = elev(x, z);
      H[v] = terrain(x, z) + e - h0;
      L[v] = Math.abs(e - e0);
    }
    const s = j * (SEG + 1); H[s + SEG] = H[s]; L[s + SEG] = L[s]; // (the seam)
  }
  const dr = ((RHO_OUT - RHO_IN) / NR) * R; // m between rings
  for (let j = 0; j <= NR; j++) {
    const rho = RHO_IN + (RHO_OUT - RHO_IN) * (j / NR), da = Math.max(0.05, (2 * Math.PI * rho * R) / SEG);
    for (let i = 0; i <= SEG; i++) {
      const v = j * (SEG + 1) + i, ip = i === 0 ? SEG - 1 : i - 1, in_ = i === SEG ? 1 : i + 1;
      let slope = 0;
      if (j > 0) slope = Math.max(slope, Math.abs(H[v] - H[v - (SEG + 1)]) / dr);
      if (j < NR) slope = Math.max(slope, Math.abs(H[v] - H[v + (SEG + 1)]) / dr);
      slope = Math.max(slope, Math.abs(H[v] - H[j * (SEG + 1) + ip]) / da, Math.abs(H[v] - H[j * (SEG + 1) + in_]) / da);
      P[v * 3 + 1] = H[v] + lift;
      V[v] = (1 - sstep(LEVEL0, LEVEL1, L[v])) * (1 - sstep(STEEP0, STEEP1, slope));
    }
  }
  pos.needsUpdate = true; vis.needsUpdate = true;
  return h0;
}

// ------------------------------------------------------------------------------------------------------ shader

const f = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
/** The three rings, unrolled with their constants (the GLSL mirrors ringFront / ringAlpha / ringHalfWidth above). */
const RING_CALLS = (age) => WAVE_RINGS.map((q, k) => `ring( ${age}, rad, ang, fw, ${f(q.delay)}, ${f(q.reach)}, ${f(q.gain)}, ${f(k)} )`).join(' + ');

const VERT = /* glsl */`
attribute float aVis;
varying vec2 vXZ;
varying float vVis;
uniform float uR;
void main() {
  vXZ = position.xz * uR;
  vVis = aVis;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const FRAG = /* glsl */`
uniform float uR;
uniform vec2 uAge;      // s since the latest / the previous pulse (< 0: none)
uniform vec2 uBand;     // m: radial band that holds a ring (outside it nothing is drawn)
uniform float uGain;
uniform vec3 uCrest;
uniform vec3 uTrough;
varying vec2 vXZ;
varying float vVis;

const float TRAVEL = ${f(WAVE_TRAVEL)};
const float R0 = ${f(WAVE_R0)};
const float HALF0 = ${f(WAVE_HALF0)};
const float HALF1 = ${f(WAVE_HALF1)};
const float WAKE0 = ${f(WAVE_WAKE0)};
const float WAKE1 = ${f(WAVE_WAKE1)};

// one ring: x = crest (a thin bright line), y = trough (a fine dark line just behind it: the lens-like pair of a
// refraction ring), z = the soft air trailing behind the crest; all 0..1, already × the ring's opacity envelope
vec3 ring( float age, float rad, float ang, float fw, float delay, float reach, float gain, float k ) {
  float u = ( age - delay ) / TRAVEL;
  if ( u <= 0.0 || u >= 1.0 ) return vec3( 0.0 );
  float e = 1.0 - ( 1.0 - u ) * ( 1.0 - u );
  float front = R0 + ( uR * reach - R0 ) * e;
  // the heat-haze waver of a pressure front: the radius shivers a little, more as it spreads
  front += u * ( 0.07 * sin( ang * 5.0 + age * 8.0 + k * 1.9 ) + 0.04 * sin( ang * 11.0 - age * 11.0 + k * 3.1 ) );
  float w = max( HALF0 + HALF1 * u, fw * 1.1 );
  float wake = WAKE0 + WAKE1 * u;
  float d = rad - front;
  float s = d > 0.0 ? d / ( w * 0.7 ) : d / w;
  float crest = exp( -s * s );
  float t = ( d + 2.4 * w ) / ( 1.3 * w );
  float trough = exp( -t * t );
  float air = d > 0.0 ? exp( -( d * d ) / ( w * w * 1.2 ) ) : exp( d / wake );
  float env = gain * smoothstep( 0.0, 0.06, u ) * ( 1.0 - smoothstep( 0.7, 1.0, u ) );
  // a little patchy, drifting along the front (air is never quite even)
  env *= 0.86 + 0.18 * sin( ang * 7.0 + age * 6.0 + k * 2.3 ) * sin( ang * 13.0 - age * 9.0 + k * 1.1 );
  return vec3( crest, trough, air ) * env;
}

void main() {
  float rad = length( vXZ );
  float fw = fwidth( rad );
  if ( rad < uBand.x || rad > uBand.y || vVis < 0.01 ) discard;
  float ang = atan( vXZ.y, vXZ.x );
  vec3 c = ${RING_CALLS('uAge.x')};
  if ( uAge.y >= 0.0 ) c += ${RING_CALLS('uAge.y')};
  c = min( c, vec3( 1.0 ) ) * uGain * vVis;
  // premultiplied "over", bottom to top: the soft air, the fine dark line, the bright crest
  float aA = c.z * 0.11, aT = c.y * 0.20, aC = c.x * 0.55;
  vec4 acc = vec4( uCrest * 0.8 * aA, aA );
  acc = vec4( uTrough * aT, aT ) + acc * ( 1.0 - aT );
  acc = vec4( uCrest * aC, aC * 0.6 ) + acc * ( 1.0 - aC * 0.6 );
  if ( acc.a < 0.004 ) discard;
  gl_FragColor = acc;
}`;

/** Linear HDR crest (pale cool white: a little light) and trough (dusk blue: a little shade). */
const CREST = new THREE.Color().setRGB(1.55, 1.7, 1.85, THREE.LinearSRGBColorSpace);
const TROUGH = new THREE.Color().setRGB(0.04, 0.07, 0.13, THREE.LinearSRGBColorSpace);

function waveMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uR: { value: 13.5 }, uAge: { value: new THREE.Vector2(-1, -1) }, uBand: { value: new THREE.Vector2(1, 0) },
      uGain: { value: 1 }, uCrest: { value: CREST.clone() }, uTrough: { value: TROUGH.clone() },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true, premultipliedAlpha: true, depthTest: true, depthWrite: false, fog: false, toneMapped: false,
    side: THREE.DoubleSide, forceSinglePass: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
}

// --------------------------------------------------------------------------------------------------------- pool

export class DecoyWaves {
  /** @param {THREE.Group} group parent in the decal scene */
  constructor(group) {
    this.group = group;
    this.world = null;
    /** @type {{mesh: THREE.Mesh, src: any, x: number, z: number, R: number, sampled: boolean, live: boolean, t0: number, t1: number, shape: object}[]} */
    this.slots = [];
    this._off = null;
    this._tmp = waveShape(0, 1); // (the previous pulse's tail: scratch)
    this.enabled = true;
    this.lift = WAVE_LIFT;
  }

  attach(world) {
    this.detach();
    this.world = world;
    // (every decoy pulse is a 'noise' event of kind 'decoy': the beep sound plays from the same event)
    this._off = world.events.on('noise', (n) => { if (n?.kind === 'decoy') this.spawn(n.x, n.z, n.radius, n.source ?? null); });
  }

  detach() {
    this._off?.();
    this._off = null;
    this.world = null;
    for (const s of this.slots) { s.live = false; s.mesh.visible = false; s.src = null; s.sampled = false; }
  }

  _on() {
    return this.enabled && this.world && !reducedMotion(this.world.game?.options?.reducedMotion);
  }

  /** The sim clock at this draw: the tick's time wound back by the part of a tick the frame has not reached yet. */
  _now(alpha) {
    return this.world.time - (1 - Math.min(1, Math.max(0, alpha))) * CONFIG.sim.dt;
  }

  /** A pulse at (x, z) for hearing radius R from `src` (the decoy). Cheap: the ground is sampled at the next draw. */
  spawn(x, z, R, src = null) {
    if (!this._on() || !(R > 0)) return null;
    let s = src ? this.slots.find((q) => q.src === src) : null;
    if (!s) s = this.slots.find((q) => !q.live && !q.src) || this.slots.find((q) => !q.live);
    if (!s && this.slots.length < POOL) s = this._make();
    if (!s) s = this.slots.reduce((a, b) => (b.t0 < a.t0 ? b : a)); // the longest-quiet decoy's slot
    if (s.src !== src || s.x !== x || s.z !== z || s.R !== R) s.sampled = false; // (a new decoy / spot: the ground again)
    const now = this.world.time;
    s.t1 = s.live && now - s.t0 < WAVE_LIFE ? s.t0 : -Infinity; // (an overlapping earlier pulse keeps going)
    Object.assign(s, { src, x, z, R, live: true, t0: now });
    s.mesh.visible = false; // (shown by update() once the ground is laid)
    return s;
  }

  /** The pool's first slot made now (never shown): the load's program warm-up frame draws it (userData.warmShow). */
  prewarm() {
    if (!this.slots.length) {
      const s = this._make();
      s.mesh.userData.warmShow = true;
      s.mesh.material.uniforms.uAge.value.set(0.4, -1);
      s.mesh.material.uniforms.uBand.value.set(0, 14);
      s.mesh.scale.set(13.5, 1, 13.5);
    }
  }

  _make() {
    const mesh = new THREE.Mesh(waveGeometry(), waveMaterial());
    mesh.name = 'decoy-wave';
    mesh.renderOrder = 8;
    mesh.frustumCulled = false; // (the grid is bounded by its sphere; a draw off screen is a handful of triangles)
    mesh.visible = false;
    this.group.add(mesh);
    const s = { mesh, src: null, x: 0, z: 0, R: 0, sampled: false, live: false, t0: -Infinity, t1: -Infinity, shape: waveShape(0, 1) };
    this.slots.push(s);
    return s;
  }

  /** Lay slot `s`'s grid on the ground under its decoy (once per decoy and spot). */
  _lay(s) {
    const w = this.world;
    const terrain = typeof w.groundY === 'function' ? (x, z) => w.groundY(x, z) || 0 : () => 0;
    const elev = typeof w.grid?.elevAt === 'function' ? (x, z) => w.grid.elevAt(x, z) || 0 : () => 0;
    const h0 = fillWaveGeometry(s.mesh.geometry, s.x, s.z, s.R, terrain, elev, this.lift);
    s.mesh.position.set(s.x, h0, s.z);
    s.mesh.scale.set(s.R, 1, s.R);
    s.mesh.material.uniforms.uR.value = s.R;
    s.sampled = true;
  }

  /**
   * Per-frame refresh (render time).
   * @param {number} dt frame delta (s; unused: the rings follow the sim clock)
   * @param {number} [alpha] interpolation factor between the previous and current tick
   */
  update(dt, alpha = 1) {
    const w = this.world;
    if (!w) return;
    const on = this._on();
    let now = 0, haveNow = false;
    for (const s of this.slots) {
      if (!s.live) continue;
      if (!on) { s.live = false; s.mesh.visible = false; continue; }
      if (!haveNow) { now = this._now(alpha); haveNow = true; }
      const a0 = Math.max(0, now - s.t0);
      let a1 = now - s.t1;
      if (!(a1 < WAVE_LIFE)) { s.t1 = -Infinity; a1 = -1; }
      if (a0 >= WAVE_LIFE) { // (this pulse is over; a picked-up decoy lets go of its slot)
        s.live = false; s.mesh.visible = false;
        if (s.src && (s.src.removed || s.src.alive === false)) { s.src = null; s.sampled = false; }
        continue;
      }
      if (!s.sampled) this._lay(s);
      const u = s.mesh.material.uniforms, sh = waveShape(a0, s.R, s.shape);
      let lo = sh.lo, hi = sh.hi;
      if (a1 >= 0) { // (the previous pulse's tail, if it still runs: one more band)
        const q = waveShape(a1, s.R, this._tmp);
        if (q.hi > q.lo) { lo = hi > lo ? Math.min(lo, q.lo) : q.lo; hi = Math.max(hi, q.hi); }
      }
      if (!(hi > lo)) { s.mesh.visible = false; continue; }
      u.uAge.value.set(a0, a1);
      u.uBand.value.set(lo, hi);
      // (only the radial rings of the grid that hold the band are drawn: 6 indices per cell, SEG cells per ring)
      const dr = (RHO_OUT - RHO_IN) / NR, j0 = Math.max(0, Math.floor((lo / s.R - RHO_IN) / dr)), j1 = Math.min(NR - 1, Math.ceil((hi / s.R - RHO_IN) / dr));
      s.mesh.geometry.setDrawRange(j0 * SEG * 6, Math.max(0, j1 - j0 + 1) * SEG * 6);
      s.mesh.visible = true;
    }
  }

  /** Waves currently drawn (tests). */
  get active() {
    return this.slots.filter((s) => s.live && s.mesh.visible).length;
  }

  dispose() {
    this.detach();
    for (const s of this.slots) {
      this.group.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
    }
    this.slots = [];
  }
}
