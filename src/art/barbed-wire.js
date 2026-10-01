/**
 * Barbed wire — the thin-wire primitive (docs/barbed-wire.md §4.1, §6).
 *
 * Every element thinner than a pixel (line wire, barbs, concertina loops, guys, ties, snow beads on a strand) is a
 * COVERAGE-WIDENED SEGMENT RIBBON ("phone-wire AA", Persson, GPU Pro 5): the vertex shader expands each segment in
 * view space to at least `uWirePx · minPx` and hands the fragment `coverage = trueWidth / drawnWidth`, so a 5 mm wire
 * at 0.2 px is drawn as a ~1 px line at 20 % alpha instead of a dotted, crawling raster. Short segments (barb points,
 * ties) are also extended ALONG their length to ≥ 1 px with the length ratio folded into the coverage, so a 15 mm
 * barb point never pops between pixel centres while the camera pans. The fragment rebuilds a cylinder normal across
 * the ribbon (lit top, dark underside), paints the 2-strand twist, rust along the arc length, snow on the upward side
 * and the wet sheen; the same geometry drawn with the shadow define is the soft ground shadow along the sun.
 *
 * Pure geometry helpers (paths, catenary, helix, barb layout, LOD) run in Node for the unit tests; the materials
 * only touch three.js classes (no WebGL needed to build them).
 * @module art/barbed-wire
 */
import * as THREE from 'three';
import { WIND_GLSL, WIND_UNIFORMS } from '../world/wind.js';

// ------------------------------------------------------------------------------------------------ pure helpers

/** Deterministic PRNG (mulberry32). */
export function wireRng(seed = 1) {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (structure ids → seeds). */
export function wireSeed(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Sagging span between two fixings: a parabola (≈ catenary for sag ≪ span) of `sag` metres at mid-span, sampled
 * every ≤ `step` m. Returns [[x, y, z], …] including both ends.
 */
export function catenary(a, b, sag, step = 0.25) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const n = Math.max(2, Math.ceil(L / step));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 4 * sag * t * (1 - t), a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

/** Lowest point of a sampled path relative to the chord: the measured sag (m). */
export function measuredSag(path) {
  const a = path[0], b = path[path.length - 1];
  let worst = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const t = i / (path.length - 1);
    worst = Math.max(worst, a[1] + (b[1] - a[1]) * t - path[i][1]);
  }
  return worst;
}

/** Cumulative arc length of a path. */
export function arcLengths(path) {
  const s = [0];
  for (let i = 1; i < path.length; i++) {
    const p = path[i], q = path[i - 1];
    s.push(s[i - 1] + Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
  }
  return s;
}

/**
 * Point + unit tangent at arc length `d` along `path` (with its arcLengths `s`). `cur` ({k}) speeds up monotone
 * walks; `out` ({p: [3], t: [3]}) is filled in place instead of allocating (the build's barb / bead loops).
 */
export function pointAt(path, s, d, cur = null, out = null) {
  let k = cur ? Math.max(1, cur.k) : 1;
  if (s[k - 1] > d) k = 1;
  while (k < path.length - 1 && s[k] < d) k++;
  if (cur) cur.k = k;
  const a = path[k - 1], b = path[k], L = Math.max(1e-9, s[k] - s[k - 1]);
  const t = Math.min(1, Math.max(0, (d - s[k - 1]) / L));
  const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L, tz = (b[2] - a[2]) / L;
  if (out) {
    out.p[0] = a[0] + (b[0] - a[0]) * t; out.p[1] = a[1] + (b[1] - a[1]) * t; out.p[2] = a[2] + (b[2] - a[2]) * t;
    out.t[0] = tx; out.t[1] = ty; out.t[2] = tz;
    return out;
  }
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], t: [tx, ty, tz] };
}

/** Barb stations along a strand of length L: every `spacing` ± `jitter`, never closer than 4 cm to an end. */
export function barbStations(L, spacing = 0.12, jitter = 0.015, rnd = Math.random) {
  const out = [];
  for (let d = spacing * (0.3 + 0.7 * rnd()); d < L - 0.04; d += spacing + (rnd() * 2 - 1) * jitter) if (d > 0.04) out.push(d);
  return out;
}

/**
 * Concertina coil along a base line a→b on the ground: helix loops of `pitch` with radial noise and loop tilt,
 * each loop's lowest point clamped to `groundAt` (the coil rests on the ground at every loop).
 * Returns one path [[x, y, z], …] (the coil is one continuous wire).
 */
export function concertinaPath(a, b, o = {}, rnd = Math.random, groundAt = () => 0) {
  const R = (o.diameter ?? 0.8) / 2, pitch = o.pitch ?? 0.28, seg = o.segments ?? 14, lift = o.lift ?? 0;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L, nx = -tz, nz = tx;
  const loops = Math.max(1, Math.round(L / pitch));
  const out = [];
  let tilt = 0, rad = 1;
  for (let i = 0; i <= loops * seg; i++) {
    const u = i / seg, k = Math.floor(u);
    if (i % seg === 0) { tilt = (rnd() * 2 - 1) * 0.09; rad = 1 + (rnd() * 2 - 1) * (0.03 / R); }
    const th = u * Math.PI * 2;
    const r = R * rad * (1 + 0.04 * Math.sin(th * 3 + k));
    const along = Math.min(L, (u / loops) * L) + Math.sin(th) * r * tilt * 2;
    const cx = a[0] + tx * along, cz = a[1] + tz * along;
    const g = groundAt(cx, cz);
    const x = cx + nx * Math.sin(th) * r, z = cz + nz * Math.sin(th) * r;
    const y = g + lift + r - Math.cos(th) * r;   // th = 0 → bottom of the loop, on the ground
    out.push([x, y, z]);
  }
  return out;
}

/** Wire LOD from the camera zoom (orthographic: a zoom STEP, never distance). barbGeo 0 at zoom ≤ 1 → 1 at 2. */
export function wireLod(zoom) {
  const z = Math.max(0.05, zoom || 1);
  const barbGeo = Math.min(1, Math.max(0, z - 1));
  return { barbGeo, lumps: z >= 0.9 ? 1 : Math.max(0, (z - 0.6) / 0.3), level: z >= 1.5 ? 'near' : z >= 0.75 ? 'mid' : 'far' };
}

// ------------------------------------------------------------------------------------------------ geometry buffer

/** Element kinds (aMat.y): line wire, barb point, snow bead, bright cut tip, tie/clip. */
export const KIND = { strand: 0, barb: 1, snow: 2, tip: 3, tie: 4 };

/**
 * Collects coverage-widened segment ribbons (strands as polylines, barbs / ties / beads as short segments) into
 * one interleaved Float32 vertex store (VSTRIDE floats: pos 3, tangent 3, info 4, wind 2, mat 3; grown by doubling,
 * no per-value JS array pushes); `geometry()` wraps it as one BufferGeometry. `groundAt(x, z)` feeds the shadow
 * projection. `pos` / `mat` / `idx` are views for the tests.
 */
export class WireBuffer {
  constructor(groundAt = () => 0) {
    this.groundAt = groundAt;
    this._vb = new Float32Array(VSTRIDE * 1024); this._nv = 0;
    this._ib = new Uint32Array(3072); this._ni = 0;
    this._inst = [new ChunkedInst(), new ChunkedInst()];   // barbs, snow beads (per 32 m map chunk)
    this.nStrands = 0; this.nBarbs = 0; this.length = 0;
  }
  get vertexCount() { return this._nv; }
  get triangles() { return this._ni / 3; }
  _attr(off, n) { const o = new Float32Array(this._nv * n); for (let i = 0; i < this._nv; i++) for (let j = 0; j < n; j++) o[i * n + j] = this._vb[i * VSTRIDE + off + j]; return o; }
  get pos() { return this._attr(0, 3); }
  get mat() { return this._attr(12, 3); }
  get idx() { return this._ib.subarray(0, this._ni); }
  _v(p, t, side, end, r, arc, w, ph, rust, kind, g = this.groundAt(p[0], p[2])) {
    if ((this._nv + 1) * VSTRIDE > this._vb.length) { const b = new Float32Array(this._vb.length * 2); b.set(this._vb); this._vb = b; }
    const a = this._vb, k = this._nv++ * VSTRIDE;
    a[k] = p[0]; a[k + 1] = p[1]; a[k + 2] = p[2]; a[k + 3] = t[0]; a[k + 4] = t[1]; a[k + 5] = t[2];
    a[k + 6] = side; a[k + 7] = end; a[k + 8] = r; a[k + 9] = arc; a[k + 10] = w; a[k + 11] = ph;
    a[k + 12] = rust; a[k + 13] = kind; a[k + 14] = g;
  }
  _quad(k) {
    if (this._ni + 6 > this._ib.length) { const b = new Uint32Array(this._ib.length * 2); b.set(this._ib); this._ib = b; }
    const a = this._ib, n = this._ni; this._ni += 6;
    a[n] = k; a[n + 1] = k + 1; a[n + 2] = k + 2; a[n + 3] = k + 1; a[n + 4] = k + 3; a[n + 5] = k + 2;
  }
  /**
   * One strand span between two fixings (or a free path). o: {r=0.0025, rust=0, kind, sway (weight at mid-span),
   * phase, arc0, swayFn(t) → weight, pinned: [a, b] ends fixed (default both)}.
   */
  strand(path, o = {}) {
    if (path.length < 2) return 0;
    const s = o.s || arcLengths(path), L = s[s.length - 1];
    if (L < 1e-4) return 0;
    const r = o.r ?? 0.0025, rust = o.rust ?? 0, kind = o.kind ?? KIND.strand, ph = o.phase ?? 0, arc0 = o.arc0 ?? 0;
    const sway = (o.sway ?? 0.12) * Math.min(2, Math.max(0.3, L / 3));
    const base = this.vertexCount;
    for (let i = 0; i < path.length; i++) {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
      const t = [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l];
      const u = s[i] / L, w = o.swayFn ? o.swayFn(u) : sway * Math.sin(Math.PI * u);
      const g = o.g ? o.g[i] : this.groundAt(path[i][0], path[i][2]);
      this._v(path[i], t, -1, 0, r, arc0 + s[i], w, ph, rust, kind, g);
      this._v(path[i], t, 1, 0, r, arc0 + s[i], w, ph, rust, kind, g);
      if (i) this._quad(base + 2 * (i - 1));
    }
    this.nStrands++; this.length += L;
    return L;
  }
  /** One short straight segment a→b (barb point, tie, bead): extended to ≥ 1 px along its length by the shader. */
  seg(a, b, o = {}) {
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], h = [(b[0] - a[0]) / 2, (b[1] - a[1]) / 2, (b[2] - a[2]) / 2];
    const r = o.r ?? 0.0009, rust = o.rust ?? 0, kind = o.kind ?? KIND.barb, w = o.sway ?? 0, ph = o.phase ?? 0, arc = o.arc ?? 0;
    const base = this.vertexCount;
    for (const end of [-1, 1]) for (const side of [-1, 1]) this._v(m, h, side, end, r, arc, w, ph, rust, kind);
    this._quad(base);
  }
  /**
   * Barbs along a strand path, as INSTANCES (one per station: centre, strand tangent, random roll); the barb shape
   * (knot + 4 or 2 points ~`len` long, ±35° off the perpendicular) is built in the vertex shader. o: {spacing,
   * jitter, points, len, rust, rnd, sway (fn of u or number), phase, snow (chance of a snow bead on a barb)}.
   */
  barbs(path, o = {}) {
    const s = o.s || arcLengths(path), L = s[s.length - 1], rnd = o.rnd || Math.random;
    const spacing = o.spacing ?? 0.12, jitter = o.jitter ?? 0.015;   // = barbStations(L, spacing, jitter), inlined
    const kind = (o.points ?? 4) === 2 ? 1 : 0, len = o.len ?? 0.019, rust = Math.min(1, (o.rust ?? 0) + 0.15);
    const cur = { k: 1 }, pt = { p: [0, 0, 0], t: [0, 0, 0] }, { p, t } = pt, ph = o.phase ?? 0, swf = typeof o.sway === 'function' ? o.sway : null, sw = o.sway ?? 0;
    const B = this._inst[0], S = this._inst[1];
    let n = 0;
    for (let d = spacing * (0.3 + 0.7 * rnd()); d < L - 0.04; d += spacing + (rnd() * 2 - 1) * jitter) {
      if (d <= 0.04) continue;
      pointAt(path, s, d, cur, pt);
      const u = d / L, w = swf ? swf(u) : sw * Math.sin(Math.PI * u);
      B.put(p[0], p[1], p[2], t[0], t[1], t[2], rnd() * 6.283185307, rust, len, kind, d, w, ph);
      if (o.snow && rnd() < o.snow) S.put(p[0], p[1] + 0.004, p[2], t[0], t[1], t[2], 0.006 + rnd() * 0.005, 0, 0.008 + rnd() * 0.012, 2, d, w, ph);
      n++;
    }
    this.nBarbs += n;
    return n;
  }
  /** Snow beads riding on top of a strand (every 5–20 cm, broken), for snow theaters: instances too. */
  snowBeads(path, o = {}) {
    const s = o.s || arcLengths(path), L = s[s.length - 1], rnd = o.rnd || Math.random, cur = { k: 1 }, pt = { p: [0, 0, 0], t: [0, 0, 0] };
    for (let d = rnd() * 0.15; d < L; d += 0.05 + rnd() * 0.15) {
      if (rnd() > (o.cover ?? 0.6)) continue;
      pointAt(path, s, d, cur, pt);
      const { p, t } = pt, u = d / L;
      const w = typeof o.sway === 'function' ? o.sway(u) : (o.sway ?? 0) * Math.sin(Math.PI * u);
      this._inst[1].put(p[0], p[1], p[2], t[0], t[1], t[2], 0.004 + rnd() * 0.004, 0, 0.01 + rnd() * 0.035, 2, d, w, o.phase ?? 0);
    }
  }
  /** BufferGeometry of the strands / segments collected (null when empty). */
  geometry() {
    if (!this._ni) return null;
    const g = new THREE.BufferGeometry(), ib = new THREE.InterleavedBuffer(this._vb.slice(0, this._nv * VSTRIDE), VSTRIDE);
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
    g.setAttribute('aTan', new THREE.InterleavedBufferAttribute(ib, 3, 3));
    g.setAttribute('aInfo', new THREE.InterleavedBufferAttribute(ib, 4, 6));
    g.setAttribute('aWind', new THREE.InterleavedBufferAttribute(ib, 2, 10));
    g.setAttribute('aMat', new THREE.InterleavedBufferAttribute(ib, 3, 12));
    const idx = this._ib.slice(0, this._ni);
    g.setIndex(new THREE.BufferAttribute(this._nv > 65535 ? idx : Uint16Array.from(idx), 1));
    g.computeBoundingSphere();
    g.boundingSphere.radius += 0.6;   // ribbons widen and sway a little past their centre lines
    return g;
  }
  /** Per-instance data (INST_STRIDE floats each) of the barbs / snow beads collected so far. */
  get barb() { return this._inst[0].data; }
  get bead() { return this._inst[1].data; }
  get barbCount() { return this.barb.length / INST_STRIDE; }
  get beadCount() { return this.bead.length / INST_STRIDE; }
  /**
   * Instanced barb (or bead: `beads`) geometries, one per `cell` × `cell` m chunk of the map so the frustum culls
   * the off-screen barbs (they are ~60 % of the wire's triangles).
   */
  instGeometries(beads = false) {
    return [...this._inst[beads ? 1 : 0].chunks.values()].map((c) => this.instGeometry(beads, c.data));
  }
  /** Instanced barb (or bead: `beads`) geometry: a shared base of segment quads + per-instance data. */
  instGeometry(beads = false, data = beads ? this.bead : this.barb) {
    const n = data.length / INST_STRIDE;
    if (!n) return null;
    const g = new THREE.InstancedBufferGeometry();
    const base = beads ? BEAD_BASE : BARB_BASE;
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(base.length / 3 * 3), 3));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(base, 3));
    g.setIndex(beads ? [0, 1, 2, 1, 3, 2] : BARB_INDEX);
    if (!beads) {   // even records first, then odd: the far LOD draws every other barb (instanceCount / 2)
      const o = new Float32Array(data.length), h = Math.ceil(n / 2);
      for (let i = 0; i < n; i++) o.set(data.subarray(i * INST_STRIDE, (i + 1) * INST_STRIDE), ((i & 1) ? h + (i >> 1) : i >> 1) * INST_STRIDE);
      data = o;
    }
    const ib = new THREE.InstancedInterleavedBuffer(data instanceof Float32Array ? data : new Float32Array(data), INST_STRIDE);
    g.setAttribute('iPos', new THREE.InterleavedBufferAttribute(ib, 4, 0));
    g.setAttribute('iTan', new THREE.InterleavedBufferAttribute(ib, 4, 4));      // tangent xyz + roll
    g.setAttribute('iParam', new THREE.InterleavedBufferAttribute(ib, 4, 8));    // rust, len, kind, arc
    g.setAttribute('iWind', new THREE.InterleavedBufferAttribute(ib, 2, 12));
    g.instanceCount = n; g.userData.n = n; g.userData.barbs = !beads;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < data.length; i += INST_STRIDE) {
      x0 = Math.min(x0, data[i]); y0 = Math.min(y0, data[i + 1]); z0 = Math.min(z0, data[i + 2]);
      x1 = Math.max(x1, data[i]); y1 = Math.max(y1, data[i + 1]); z1 = Math.max(z1, data[i + 2]);
    }
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 0.6);
    return g;
  }
}

/** Floats per ribbon vertex (interleaved store). */
const VSTRIDE = 15;
/** Instance records (INST_STRIDE floats) in growable Float32Arrays, one per 32 m map chunk (culled per chunk). */
const CHUNK = 32;
class ChunkedInst {
  constructor() { this.chunks = new Map(); this.n = 0; }
  put(x, y, z, tx, ty, tz, roll, rust, len, kind, d, w, ph) {
    const key = Math.floor(x / CHUNK) * 4096 + Math.floor(z / CHUNK);
    let c = this.chunks.get(key);
    if (!c) this.chunks.set(key, (c = { a: new Float32Array(INST_STRIDE * 128), n: 0, get data() { return this.a.subarray(0, this.n); } }));
    if (c.n + INST_STRIDE > c.a.length) { const b = new Float32Array(c.a.length * 2); b.set(c.a); c.a = b; }
    const a = c.a, k = c.n; c.n += INST_STRIDE; this.n++;
    a[k] = x; a[k + 1] = y; a[k + 2] = z; a[k + 3] = 0; a[k + 4] = tx; a[k + 5] = ty; a[k + 6] = tz; a[k + 7] = roll;
    a[k + 8] = rust; a[k + 9] = len; a[k + 10] = kind; a[k + 11] = d; a[k + 12] = w; a[k + 13] = ph;
  }
  /** All records, concatenated (tests / stats). */
  get data() {
    const out = new Float32Array(this.n * INST_STRIDE); let o = 0;
    for (const c of this.chunks.values()) { out.set(c.data, o); o += c.n; }
    return out;
  }
}

/** Per-instance floats: pos.xyz, ground (0: instances cast no projected shadow), tan.xyz, roll, rust, len|size, kind, arc, sway weight, phase. */
export const INST_STRIDE = 14;
/**
 * Barb base: two tip-to-tip lines through the knot (each line = two opposite points, leaning ±35° along the strand,
 * so a 4-point barb reads as an X across the strand) + the 1 cm wrap knot (dark: at zoom 2 the knots are the
 * regular ticks every 12 cm that tell barbed wire from plain cable). 6 tris an instance.
 */
const BARB_BASE = [], BARB_INDEX = [];
for (const pt of [4, 0, 1]) {   // knot first: the far LOD draws the first 2 quads only (knot + one line)
  const k = BARB_BASE.length / 3;
  for (const end of [-1, 1]) for (const side of [-1, 1]) BARB_BASE.push(pt, side, end);
  BARB_INDEX.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
}
/** Triangles per barb instance (stats). */
export const BARB_TRIS = BARB_INDEX.length / 3;
const BEAD_BASE = [4, -1, -1, 4, 1, -1, 4, -1, 1, 4, 1, 1];

// ------------------------------------------------------------------------------------------------ materials

/**
 * Shared per-frame uniforms: uWirePx = world size of one drawing-buffer pixel (set from the camera in
 * onBeforeRender), uWireMinPx = minimum drawn width in px, uWireGain = readability gain on coverage (≥ 1: the eye
 * reads a wire band slightly heavier than its true area), uBarbVis = barb LOD fade, uSunDir = towards the sun.
 */
export const WIRE_UNIFORMS = {
  uWirePx: { value: 0.025 },
  uWireMinPx: { value: 1.0 },   // minimum HALF-width in px
  uWireGain: { value: 3.0 },
  uBarbVis: { value: 1 },
  uBarbDecim: { value: 1 },   // 2 when the far LOD draws every other barb (knot + one line): coverage doubled
  uSunDir: { value: new THREE.Vector3(-0.54, 0.64, -0.54) },
};

/** Barb LOD fade from the pixel footprint (m/px): full ≤ 3 cm/px, gone ≥ 4.5 cm/px (zoom 0.5 at DPR 1). */
export const barbVisFor = (px) => 1 - Math.min(1, Math.max(0, (px - 0.03) / 0.015));

const WIRE_VERT_PARS = WIND_GLSL + /* glsl */ `
#ifdef WIRE_INST
attribute vec3 aB; attribute vec4 iPos; attribute vec4 iTan; attribute vec4 iParam; attribute vec2 iWind;
#else
attribute vec3 aTan; attribute vec4 aInfo; attribute vec2 aWind; attribute vec3 aMat;
#endif
uniform float uWirePx; uniform float uWireMinPx; uniform vec3 uSunDir; uniform float uBarbVis; uniform float uBarbDecim;
varying vec4 vWire; varying vec3 vSideV; varying vec3 vWMat; varying vec3 vTanV; varying vec2 vSeg;
`;
const WIRE_VERT_MAIN = /* glsl */ `
vec3 wC; vec3 wTv; float wSide; float wEnd; float wR; float wArc; vec3 wM; vec2 wSw; float wMinK = 1.0;
#ifdef WIRE_INST
  vec3 wT0 = normalize(iTan.xyz);
  vec3 wE1 = vec3(-wT0.z, 0.0, wT0.x); float wL1 = length(wE1); wE1 = wL1 > 1e-3 ? wE1 / wL1 : vec3(1.0, 0.0, 0.0);
  vec3 wE2 = cross(wT0, wE1);
  wSide = aB.y; wEnd = aB.z; wSw = iWind; wArc = iParam.w; wM = vec3(iParam.x, 1.0, iPos.w);
  if (iParam.z > 1.5) {            // snow bead: a short fat segment riding on top of the strand
    wC = iPos.xyz + vec3(0.0, iTan.w * 0.6, 0.0); wTv = wT0 * iParam.y; wR = iTan.w; wM.y = 2.0;
  } else if (aB.x > 3.5) {         // the barb's wrap knot (darker: wraps and grooves, kind 1.25)
    wC = iPos.xyz; wTv = wT0 * 0.006; wR = 0.0045; wM.y = 1.25;
    // near LOD: the knot is drawn as a ≥ 3 px dot (the strand's line is 2 px), so the barbs read as dark ticks
    if (uBarbDecim < 1.5) wMinK = 1.6;
  } else {                         // one barb line: tip → knot → opposite tip, rolled round the strand, ±35° lean
    float wNp = iParam.z > 0.5 ? 2.0 : 4.0;
    float wAng = iTan.w + aB.x * 1.5708;
    vec3 wDir3 = wE1 * cos(wAng) + wE2 * sin(wAng);
    float wLean = aB.x > 0.5 ? -0.7 : 0.7;
    wC = iPos.xyz; wTv = normalize(wDir3 + wT0 * wLean) * iParam.y; wR = 0.001;
    if (wNp < 3.0 && aB.x > 0.5) wR = 0.0;
  }
#else
  wC = position; wTv = aTan; wSide = aInfo.x; wEnd = aInfo.y; wR = aInfo.z; wArc = aInfo.w; wM = aMat; wSw = aWind;
#endif
if (wSw.x > 1e-4) {
  vec4 ws = windSample(wC.xz);
  float wv = length(ws.xy);
  vec2 wd = wv > 1e-3 ? ws.xy / wv : uWindA.xy;
  float wph = uWindA.w * (1.6 + 0.12 * wv) + wSw.y * 6.2832;
  wC += (vec3(wd.x, 0.0, wd.y) * (0.0007 * wv * wv + 0.012 * ws.z) * (0.75 + 0.25 * sin(wph * 0.37))
    + vec3(-wd.y, 0.3, wd.x) * sin(wph) * (0.003 * wv + 0.016 * ws.z)) * wSw.x;
}
#ifdef WIRE_SHADOW
  float wH = max(0.0, wC.y - wM.z);
  wC -= uSunDir * (wH / max(uSunDir.y, 0.2));
  wC.y = wM.z + 0.025;
  wR = wR * 1.5 + 0.006 * min(wH, 3.0);      // penumbra widens with height
#endif
vec3 vT = mat3(viewMatrix) * wTv;
float wSl = length(vT.xy);
vec2 wDir = wSl > 1e-7 ? vT.xy / wSl : vec2(1.0, 0.0);
vec2 wSd = vec2(-wDir.y, wDir.x);
float wPx = uWirePx;
// half-width ≥ uWireMinPx px: a sub-pixel wire becomes a 2-px tent whose samples sum to the same coverage at any
// sub-pixel phase (partition of unity) → no crawl while the view slides
float wW = max(wR, uWireMinPx * wMinK * wPx);
float wCov = wR / wW;
vec2 wOff = wSd * wSide * wW;
vSeg = vec2(0.0);
if (abs(wEnd) > 0.5) {
  float wHl = max(wSl, 0.25 * wR);
  float wHH = max(wHl, uWireMinPx * wMinK * wPx);
  wCov *= wHl / wHH;
  wOff += wDir * wEnd * wHH;
  vSeg = vec2(wEnd, min(1.0, wPx / wHH));
}
// barbs: the eye reads a barb as a tick heavier than its 2 mm wire (and the strand core is already saturated)
if (wMinK > 1.0) wCov = max(wCov, 0.1);   // the readability knot: a saturated core whatever its true area
if (wM.y > 0.5 && wM.y < 1.5) wCov *= uBarbVis * 3.0 * uBarbDecim;
vWire = vec4(wSide, wCov, min(1.0, wPx / wW), wArc);
vSideV = vec3(wSd, 0.0);
vTanV = vT;
vWMat = wM;
vec3 transformed = wC + vec3(wOff, 0.0) * mat3(viewMatrix);
`;

const WIRE_FRAG_PARS = /* glsl */ `
varying vec4 vWire; varying vec3 vSideV; varying vec3 vWMat; varying vec3 vTanV; varying vec2 vSeg;
// coverage profile across (and along, for short segments): a box with an anti-aliased edge for wide ribbons,
// blending to a normalised tent (mean 1) as the ribbon shrinks to its 2-px minimum
float wireProfile(float a, float e) { e = clamp(e, 0.0, 1.0); return mix(1.0 - smoothstep(1.0 - e, 1.0, a), 2.0 * max(0.0, 1.0 - a), e); }
uniform float uWireGain; uniform float uWirePx;
uniform vec3 uZinc; uniform vec3 uRustCol; uniform vec3 uDustCol;
uniform vec4 uLook;     // rust base, dust, wet, snow
uniform vec4 uLook2;    // seed, reinforced, readability gain at zoom ≤ 1, -
float wHash(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
float wNoise(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(wHash(i), wHash(i + 1.0), f); }
float wRough; float wMetal;
`;
const WIRE_FRAG_COLOR = /* glsl */ `
float wA = vWire.x, wAa = abs(wA);
float wProf = wireProfile(wAa, vWire.z) * (vSeg.y > 0.0 ? wireProfile(abs(vSeg.x), vSeg.y) : 1.0);
// per-look readability gain (dark coils on bright sand) fading in as the pixel footprint grows past zoom ~1.5
float wGain = uWireGain * mix(1.0, max(1.0, uLook2.z), smoothstep(0.011, 0.016, uWirePx));
float wAlpha = clamp(vWire.y * wGain * wProf, 0.0, 1.0);
float wKind = vWMat.y;
vec3 wNv = normalize(vSideV * wA + vec3(0.0, 0.0, 1.0) * sqrt(max(0.0, 1.0 - wA * wA)));
vec3 wNw = normalize((vec4(wNv, 0.0) * viewMatrix).xyz);
float wS = vWire.w + uLook2.x * 17.0;
float wN1 = wNoise(wS * 0.9), wN2 = wNoise(wS * 6.3 + 3.0), wN3 = wNoise(wS * 23.0 + 7.0);
float wRust = clamp(uLook.x + vWMat.x * 0.55 + (wN1 - 0.5) * 0.9 + (wN2 - 0.5) * 0.35, 0.0, 1.0);
float wRm = smoothstep(0.3, 0.8, wRust);
vec3 wCol = mix(uZinc * (0.9 + 0.2 * wN3), uRustCol * (0.8 + 0.4 * wN2), wRm);
// the 2-strand twist: grooves every half lay (8 cm lay), only once a pixel is fine enough to resolve them
float wTwist = 0.5 + 0.5 * sin(6.2832 * (vWire.w / 0.04) + wA * 2.6);
float wTv = 1.0 - smoothstep(0.004, 0.012, uWirePx);
wCol *= mix(1.0, 0.72 + 0.28 * wTwist, wTv * (wKind < 0.5 ? 1.0 : 0.0));
// dust in the grooves and on the upper surfaces (desert)
wCol = mix(wCol, uDustCol, uLook.y * (0.35 + 0.65 * smoothstep(0.0, 0.7, wNw.y)) * (0.6 + 0.4 * wN2));
// weathered steel: low metal (oxide / rust skin), the IBL never turns a strand into a bright sky mirror
wRough = mix(0.62, 0.88, wRm) + uLook.y * 0.1;
wMetal = mix(0.22, 0.06, wRm) * (1.0 - uLook.y * 0.5);
// wet / coastal: darker albedo, a tighter sheen (roughness ≥ 0.42: never a bloom sparkle)
wCol *= 1.0 - 0.35 * uLook.z;
wRough = mix(wRough, 0.42, uLook.z);
// snow riding on the upward half of the strand, broken every 5–20 cm; beads are snow through and through
float wSnow = 0.6 * uLook.w * smoothstep(0.45, 0.9, wNw.y) * smoothstep(0.4, 0.6, wNoise(wS * 7.0 + 11.0));
// a sub-pixel strand keeps a dark core (snow only on its upper rim): snowy wire still reads dark against snow
wSnow *= mix(1.0, smoothstep(0.3, 0.8, wAa), clamp(vWire.z, 0.0, 1.0));
if (wKind > 1.5 && wKind < 2.5) { wSnow = 1.0; wAlpha *= step(0.001, uLook.w); }
if (wKind > 2.5 && wKind < 3.5) { wCol = vec3(0.75, 0.76, 0.78); wRough = 0.25; wMetal = 1.0; }  // bright cut steel
if (wKind > 3.5) { wCol *= 0.6; }
if (wKind > 0.5 && wKind < 1.5) { wCol *= wKind > 1.1 ? 0.45 : 0.7; }   // barbs rust first; the wrap knot (wraps + grooves) darkest
wCol = mix(wCol, vec3(0.9, 0.92, 0.95), wSnow);
wRough = mix(wRough, 0.8, wSnow); wMetal = mix(wMetal, 0.0, wSnow);
// sub-pixel: the glossy lobe averaged over the cylinder's normals is a much rougher lobe (no laser-line highlight)
wRough = mix(wRough, max(wRough, 0.82 - 0.14 * uLook.z), clamp(vWire.z, 0.0, 1.0));
diffuseColor = vec4(wCol, diffuseColor.a * wAlpha);
`;
const WIRE_FRAG_NORMAL = /* glsl */ `
float faceDirection = 1.0;
vec3 normal = wNv;
#if NUM_DIR_LIGHTS > 0
{ // a sub-pixel wire is the whole visible half-cylinder inside one pixel: shade it with its MEAN radiance. With φ the
  // angle between the view and the light (both perpendicular to the wire), the projected-area-weighted mean of
  // max(0, n·l) over the visible half is f(φ) = (sin φ + (π − φ) cos φ) / 4 (π/4 lit from behind the eye, 0 back-lit):
  // the effective normal sits at acos f from the light, on the viewer's side (diffuse exact; the glossy lobe is
  // widened in the colour stage, since a highlight covers only a sliver of the cylinder)
  vec3 wTt = normalize(vTanV + vec3(1e-5));
  vec3 wVp = normalize(vec3(0.0, 0.0, 1.0) - wTt * wTt.z);
  vec3 wLd = directionalLights[0].direction;
  vec3 wLp = wLd - wTt * dot(wLd, wTt);
  float wLl = length(wLp);
  vec3 wNh = wVp;
  if (wLl > 1e-3) {
    vec3 wLn = wLp / wLl;
    float wCp = clamp(dot(wVp, wLn), -1.0, 1.0), wPhi = acos(wCp);
    float wF = 0.25 * (sin(wPhi) + (PI - wPhi) * wCp);
    vec3 wP = wVp - wLn * wCp; float wPl = length(wP);
    wP = wPl > 1e-3 ? wP / wPl : normalize(cross(wTt, wLn));
    wNh = normalize(wLn * wF + wP * sqrt(max(0.0, 1.0 - wF * wF)));
  }
  normal = normalize(mix(wNv, wNh, clamp(vWire.z, 0.0, 1.0)));
}
#endif
vec3 nonPerturbedNormal = normal;
`;

/** Theater looks (docs/barbed-wire.md §5): zinc / rust colours, base rust, dust, wetness, readability gain at zoom ≤ 1. */
export const WIRE_LOOKS = {
  fresh: { zinc: 0x8c8f90, rust: 0x7a3f20, dust: 0x9a8a70, rustBase: -0.25, dust_: 0, wet: 0, gain: 1.3 },
  temperate: { zinc: 0x5e6264, rust: 0x5e3420, dust: 0x8a7a60, rustBase: 0.32, dust_: 0, wet: 0.05, gain: 1.6 },
  snow: { zinc: 0x45484b, rust: 0x5a2e18, dust: 0x9a9080, rustBase: 0.4, dust_: 0, wet: 0.15, gain: 1.4 },
  desert: { zinc: 0x45403a, rust: 0x56341c, dust: 0x8f7858, rustBase: 0.5, dust_: 0.14, wet: 0, gain: 1.8 },
  coast: { zinc: 0x3e3834, rust: 0x3e2416, dust: 0xd8d4c8, rustBase: 0.55, dust_: 0.08, wet: 0.75, gain: 1.5 },
  night: { zinc: 0x7c7f81, rust: 0x7a4024, dust: 0x8a7a60, rustBase: 0.15, dust_: 0, wet: 0.1, gain: 1.3 },
  reinforced: { zinc: 0x2b2f36, rust: 0x3a2a22, dust: 0x8a7a60, rustBase: -0.2, dust_: 0, wet: 0.05, gain: 1.4 },
};

const _mats = new Map();
const col3 = (hex) => new THREE.Color(hex);

/**
 * The lit wire material for one look (cached per look + snow + seed key): MeshStandardMaterial with the ribbon
 * vertex stage, the cylinder normal and the weathering fragment. o: {snow 0..1, seed}.
 */
export function wireMaterial(lookName = 'temperate', o = {}) {
  const look = WIRE_LOOKS[lookName] || WIRE_LOOKS.temperate;
  const key = `${lookName}|${o.snow ?? 0}|${o.seed ?? 0}|${o.inst ? 1 : 0}`;
  if (_mats.has(key)) return _mats.get(key);
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.8, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.forceSinglePass = true;   // camera-facing ribbons: no back faces, so not the two-pass transparent DoubleSide draw
  if (o.inst) m.defines = { WIRE_INST: '' };
  const U = {
    uZinc: { value: col3(look.zinc) }, uRustCol: { value: col3(look.rust) }, uDustCol: { value: col3(look.dust) },
    uLook: { value: new THREE.Vector4(look.rustBase, look.dust_, look.wet, o.snow ?? 0) },
    uLook2: { value: new THREE.Vector4((o.seed ?? 0) % 97, lookName === 'reinforced' ? 1 : 0, look.gain ?? 1, 0) },
  };
  m.userData.wire = U;
  m.userData.snowCover = true;   // coverPropsWithSnow: the wire draws its own snow
  m.userData.aoExclude = true;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WIND_UNIFORMS, WIRE_UNIFORMS, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + WIRE_VERT_PARS)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <begin_vertex>', WIRE_VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + WIRE_FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + WIRE_FRAG_COLOR)
      .replace('#include <normal_fragment_begin>', WIRE_FRAG_NORMAL)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nroughnessFactor = wRough; metalnessFactor = wMetal;');
  };
  m.customProgramCacheKey = () => (o.inst ? 'wire-inst-1' : 'wire-ribbon-1');
  _mats.set(key, m);
  return m;
}

/** Soft ground shadow of the same ribbons, cast along uSunDir (shared by every look). `strength` 0..1. */
export function wireShadowMaterial(strength = 0.4) {
  const key = `shadow|${strength}`;
  if (_mats.has(key)) return _mats.get(key);
  const m = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const U = { uShadowAmt: { value: strength } };
  m.userData.wire = U; m.userData.snowCover = true; m.userData.aoExclude = true;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WIND_UNIFORMS, WIRE_UNIFORMS, U);
    sh.vertexShader = '#define WIRE_SHADOW\n' + sh.vertexShader.replace('#include <common>', '#include <common>\n' + WIRE_VERT_PARS)
      .replace('#include <begin_vertex>', WIRE_VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec4 vWire; varying vec3 vWMat; varying vec2 vSeg; uniform float uShadowAmt; uniform float uWireGain;
        float wireProfile(float a, float e) { e = clamp(e, 0.0, 1.0); return mix(1.0 - smoothstep(1.0 - e, 1.0, a), 2.0 * max(0.0, 1.0 - a), e); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wProf = wireProfile(abs(vWire.x), max(vWire.z, 0.6));   // soft penumbra
        diffuseColor.a = clamp(vWire.y * uWireGain * wProf, 0.0, 1.0) * uShadowAmt * step(vWMat.y, 1.5);`);
  };
  m.customProgramCacheKey = () => 'wire-shadow-1';
  _mats.set(key, m);
  return m;
}

/** Keep uWirePx in step with whatever camera draws the wire (game view, bed capture, screenshots). */
const _sz = new THREE.Vector2();
export function wirePxHook(renderer, scene, camera) {
  const rt = renderer.getRenderTarget?.();
  const hpx = rt ? rt.height : renderer.getDrawingBufferSize(_sz).y;
  let px = 0.025;
  if (camera.isOrthographicCamera) px = (camera.top - camera.bottom) / Math.max(1e-6, camera.zoom) / Math.max(1, hpx);
  else if (camera.isPerspectiveCamera) px = 2 * Math.tan((camera.fov * Math.PI) / 360) * 30 / Math.max(1, hpx);
  WIRE_UNIFORMS.uWirePx.value = px;
  WIRE_UNIFORMS.uBarbVis.value = barbVisFor(px);
  WIRE_UNIFORMS.uBarbDecim.value = px > BARB_FULL_PX ? 2 : 1;
}
/** Pixel footprint (m/px) up to which every barb is drawn whole (an X + knot); coarser: every other one, knot + 1 line. */
export const BARB_FULL_PX = 0.014;

/** A ribbon mesh (strands or their shadow) for a WireBuffer geometry. */
export function wireMesh(geo, material, name) {
  const m = new THREE.Mesh(geo, material);
  m.name = name; m.castShadow = false; m.receiveShadow = !material.isMeshBasicMaterial;
  m.userData.aoExclude = true;
  m.renderOrder = material.isMeshBasicMaterial ? 1 : 2;
  m.onBeforeRender = geo.isInstancedBufferGeometry
    ? (r, sc, cam) => {
      wirePxHook(r, sc, cam);
      const beads = !geo.userData.barbs, far = WIRE_UNIFORMS.uBarbDecim.value > 1;
      geo.instanceCount = beads ? geo.userData.n : WIRE_UNIFORMS.uBarbVis.value <= 0 ? 0 : far ? Math.ceil(geo.userData.n / 2) : geo.userData.n;
      if (!beads) geo.setDrawRange(0, far ? 12 : Infinity);
    }
    : wirePxHook;
  return m;
}
