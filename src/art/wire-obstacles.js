/**
 * Wire obstacles (docs/barbed-wire.md §4–§8): the variant alias table, one recipe per obstacle type (posts, frames,
 * strands, coils, extras), theater looks, the cut-gap state and the electric power state, batched into ONE wire layer
 * per mission: a few merged ribbon meshes (strands + barbs + snow beads per look, their ground shadow), one
 * InstancedMesh per post / frame kind and one chain-link panel mesh.
 *
 * Entry: buildWireLayer(root, opts) collects every `userData.wireRun` (fence runs tagged by props.js) and
 * `userData.wireCoping` (palisade tops recorded by dressing.js) under `root` and builds the layer.
 * @module art/wire-obstacles
 */
import * as THREE from 'three';
import { addSnowCover } from './terrain/snowfx.js';
import { missionWire } from './wire-missions.js';
import { WireBuffer, KIND, catenary, concertinaPath, wireRng, wireSeed, wireMaterial, wireShadowMaterial, wireMesh, arcLengths, WIRE_UNIFORMS, BARB_TRIS } from './barbed-wire.js';

// ------------------------------------------------------------------------------------------------ aliases

/** Mission variant → wire type (§4). `null` keys = no variant. */
export const WIRE_ALIASES = {
  wire: 'field_fence', field_fence: 'field_fence', barbed_wire_fence: 'field_fence',
  wire_on_stakes: 'double_apron', double_apron: 'double_apron',
  knife_rest: 'knife_rest', knife_rest_wood: 'knife_rest', knife_rest_steel: 'knife_rest',
  concertina: 'concertina', wire_gun: 'concertina', concertina_hedgehog: 'triple_concertina', triple_concertina: 'triple_concertina',
  barbed_wire_hedgehog: 'hedgehog_belt', czech_hedgehog_wire: 'hedgehog_belt', hedgehog_belt: 'hedgehog_belt',
  palisade_wire: 'coping_bracket', wall_stone_zigzag: 'coping_bracket', coping_bracket: 'coping_bracket',
  mudbrick_wire: 'coping_concertina', wall_mudbrick_wire: 'coping_concertina', coping_concertina: 'coping_concertina',
  chainlink: 'chainlink', fence_chainlink: 'chainlink', electric: 'chainlink', square: 'chainlink', mesh_iron: 'chainlink',
  prisoner_cage: 'cage', wire_cage: 'cage', cage: 'cage',
  low_entanglement: 'low_entanglement',
};
export const WIRE_TYPES = ['field_fence', 'double_apron', 'knife_rest', 'concertina', 'triple_concertina', 'hedgehog_belt',
  'coping_bracket', 'coping_concertina', 'chainlink', 'cage', 'low_entanglement'];

/**
 * Wire type for a structure def (fence / wall / prison_pen), or null when it is not wire (plain palisades, the BCD
 * ostrich pen). An explicit `wire: '<type>'` hint wins.
 */
export function wireTypeOf(def = {}, ctx = {}) {
  if (def.wire && WIRE_TYPES.includes(def.wire)) return def.wire;
  if (def.wire === false) return null;
  const mw = missionWire(def, ctx.missionId);   // M4–M20 per-structure choice (art/wire-missions.js)
  if (mw?.type && WIRE_TYPES.includes(mw.type)) return mw.type;
  const v = def.variant == null ? null : String(def.variant);
  if (def.type === 'wall') return v && WIRE_ALIASES[v] && /coping/.test(WIRE_ALIASES[v]) ? WIRE_ALIASES[v] : null;
  if (def.type === 'prison_pen') return def.mat && def.mat !== 'wire' ? null : 'cage';
  if (def.type !== 'fence') return null;
  if (v == null) return /bcd|^b\d/i.test(String(ctx.missionId ?? '')) ? null : 'field_fence';   // zoo paddock rail ≠ wire
  if (v === 'barbed_wire') return (def.h ?? 1.2) >= 1.6 ? 'field_fence' : 'double_apron';
  if (v === 'wire_on_stakes' && (def.knifeRest || (def.width ?? 0) >= 0.6 && /m0?4\b/.test(String(ctx.missionId ?? '')))) return 'knife_rest';
  // an unknown variant is wire only when it says so: railings, plank palisades, bullet stops, rock rims keep their own look
  return WIRE_ALIASES[v] ?? (/wire|barb/.test(v) ? 'field_fence' : null);
}

/** Theater (+ snow) → look name in WIRE_LOOKS. A def may override with `wireLook`. */
export function wireLookOf(def = {}, theater = 'temperate') {
  if (def.wireLook) return def.wireLook;
  if (def.reinforced) return 'reinforced';
  return ['snow', 'desert', 'coast', 'night', 'temperate'].includes(theater) ? theater : 'temperate';
}

// ------------------------------------------------------------------------------------------------ run geometry

/** A 2-D polyline run with arc-length queries. */
export class Run {
  constructor(points) {
    this.p = points.map((q) => (Array.isArray(q) ? [q[0], q[1]] : [q.x, q.z]));
    this.s = [0];
    for (let i = 1; i < this.p.length; i++) this.s.push(this.s[i - 1] + Math.hypot(this.p[i][0] - this.p[i - 1][0], this.p[i][1] - this.p[i - 1][1]));
    this.length = this.s[this.s.length - 1];
    let cx = 0, cz = 0;
    for (const q of this.p) { cx += q[0]; cz += q[1]; }
    this.centroid = [cx / this.p.length, cz / this.p.length];
    const a = this.p[0], b = this.p[this.p.length - 1];
    this.closed = this.p.length > 3 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.6;
  }
  /** {x, z, tx, tz, nx, nz} at arc length d (n = left normal). */
  at(d) {
    const s = this.s, p = this.p;
    let k = 1;
    while (k < p.length - 1 && s[k] < d) k++;
    const L = Math.max(1e-9, s[k] - s[k - 1]), t = Math.min(1, Math.max(0, (d - s[k - 1]) / L));
    const tx = (p[k][0] - p[k - 1][0]) / L, tz = (p[k][1] - p[k - 1][1]) / L;
    return { x: p[k - 1][0] + (p[k][0] - p[k - 1][0]) * t, z: p[k - 1][1] + (p[k][1] - p[k - 1][1]) * t, tx, tz, nx: tz, nz: -tx };
  }
  /** Interior corner arc lengths. */
  corners() { return this.s.slice(1, -1); }
  /** Post stations every ~`spacing` m per straight leg, always at the corners and the ends. */
  stations(spacing) {
    const out = [0];
    for (let k = 1; k < this.p.length; k++) {
      const a = this.s[k - 1], b = this.s[k], n = Math.max(1, Math.round((b - a) / spacing));
      for (let i = 1; i <= n; i++) out.push(a + ((b - a) * i) / n);
    }
    return out;
  }
  /** Projection of (x, z) on the run: {d (arc), dist}. */
  project(x, z) {
    let best = { d: 0, dist: Infinity };
    for (let k = 1; k < this.p.length; k++) {
      const [ax, az] = this.p[k - 1], [bx, bz] = this.p[k], L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1e-9;
      const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L2));
      const px = ax + (bx - ax) * t, pz = az + (bz - az) * t, dist = Math.hypot(x - px, z - pz);
      if (dist < best.dist) best = { d: this.s[k - 1] + Math.sqrt(L2) * t, dist };
    }
    return best;
  }
  /**
   * Sign (+1 left normal, −1 right) of the run's OUTSIDE: away from the centroid for closed / enclosing runs,
   * else away from `inside` [x, z] when given, else left of travel.
   */
  outsideSign(inside = null) {
    const c = inside || this.centroid, m = this.at(this.length / 2);
    if (!inside && !this.closed && this.p.length < 3) return 1;
    return (m.x - c[0]) * m.nx + (m.z - c[1]) * m.nz >= 0 ? 1 : -1;
  }
}

// ------------------------------------------------------------------------------------------------ parts

const _Y = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

/**
 * Matrix that maps a unit geometry standing on y ∈ [0, 1] (section 1 × 1 / radius 1 about the Y axis) onto a beam
 * from a to b with section sx × sz, rolled `roll` rad about its own axis.
 */
export function beamMatrix(a, b, sx, sz = sx, roll = 0) {
  _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const L = _v.length() || 1e-6;
  _q.setFromUnitVectors(_Y, _v.multiplyScalar(1 / L));
  if (roll) _q.multiply(_q2.setFromAxisAngle(_Y, roll));
  return new THREE.Matrix4().compose(new THREE.Vector3(a[0], a[1], a[2]), _q, _s.set(sx, L, sz));
}

/**
 * Everything one or more runs contribute, before batching: strand items (paths with run-arc mapping for the cut
 * gaps), instanced parts by kind, chain-link panels, spark points and stats.
 */
export class Parts {
  constructor() { this.items = []; this.inst = new Map(); this.panels = []; this.sparks = []; this.guards = []; this.counts = {}; }
  count(k, n = 1) { this.counts[k] = (this.counts[k] || 0) + n; }
  /**
   * A wire path. o: {look, r, sway, phase, rust, barbs: {spacing, points, len} | null, snow (beads 0..1), runKey,
   * sArr (run arc per path point, for gaps), cuttable, tails (curl when cut: 'hard' | 'soft')}.
   */
  wire(path, o = {}) { if (path.length >= 2) this.items.push({ path, ...o }); }
  /** One instance of kind `kind` (see INSTANCE_KINDS) with matrix m. */
  add(kind, m) {
    if (!this.inst.has(kind)) this.inst.set(kind, []);
    this.inst.get(kind).push(m);
  }
  /** Chain-link panel between two ground points: bottom/top heights above their ground. */
  panel(a, b, ga, gb, bottom, top, o = {}) { this.panels.push({ a, b, ga, gb, bottom, top, ...o }); }
}

// ------------------------------------------------------------------------------------------------ recipes

const D35 = (35 * Math.PI) / 180;

/** Recipe context for one run: fixing points, spans of strands, posts. */
function ctxFor(run, def, o) {
  const rnd = wireRng(wireSeed(`${def.id ?? def.variant ?? 'wire'}#${o.runIndex ?? 0}`));
  const G = o.groundAt || (() => 0);
  const out = o.outside ?? run.outsideSign(o.inside);
  const C = {
    run, def, rnd, G, out, P: o.parts, look: o.look, snow: o.snow ?? 0, runKey: o.runKey, theater: o.theater,
    h: def.h ?? 1.2, width: def.width ?? 0.3, cut: def.type !== 'wall' && def.cuttable !== false && !def.reinforced, solidAt: o.solidAt || (() => false), offMap: o.offMap || (() => false),
    /** World point at arc d, height y above the ground there, offset `off` towards the outside. */
    fix(d, y, off = 0) { const a = run.at(d), x = a.x + a.nx * off * out, z = a.z + a.nz * off * out; return [x, G(x, z) + y, z]; },
    /** A wire item (catenary span a→b) with the run-arc range [da, db] for the cut gaps. */
    span(a, b, da, db, w = {}) {
      // a taut span needs few vertices (chord error sag / n² ≤ 1.5 mm; ≥ 4 for the wind's sin(πu) sway). Near the
      // ground the coarse chords are checked at their quarter points and fall back to 0.25 m steps (the ground clamp
      // only holds at vertices); clearance-checked coping spans over the stakes always keep 0.25 m
      const sag = w.sag ?? 0.015, Ls = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const nAd = Math.min(Math.max(Ls > 1.2 ? 4 : 2, Math.ceil(Math.sqrt(sag / 0.0015))), Math.ceil(Ls / 0.25));
      let path = w.step || w.minAbove != null ? null : catenary(a, b, sag, Ls / nAd + 1e-6);
      if (path && Math.min(a[1] - G(a[0], a[2]), b[1] - G(b[0], b[2])) < 0.5) {
        const clear = (w.minClear ?? 0.03) + 0.01;
        outer: for (let i = 1; i < path.length; i++) for (const f of [0.25, 0.5, 0.75]) {
          const p = path[i - 1], q = path[i], x = p[0] + (q[0] - p[0]) * f, z = p[2] + (q[2] - p[2]) * f;
          if (p[1] + (q[1] - p[1]) * f - G(x, z) < clear) { path = null; break outer; }
        }
      }
      if (!path) path = catenary(a, b, sag, w.step ?? 0.25);
      const sArr = path.map((_, i) => da + ((db - da) * i) / (path.length - 1));
      C.P.wire(path, { look: C.look, r: w.r ?? 0.0026, sway: w.sway ?? 0.12, phase: rnd(), rust: rnd() * 0.35, barbs: w.barbs === undefined ? { spacing: 0.12, points: 4 } : w.barbs,
        snow: C.snow, runKey: C.runKey, sArr, cuttable: w.cuttable ?? C.cut, tails: w.tails ?? 'soft', minClear: w.minClear, minAbove: w.minAbove });
      C.P.count('strandSpans');
    },
    /** A staple / tie at a fixing: two short legs across the strand. */
    tie(p, t = [0, 1, 0]) {
      C.P.wire([[p[0] - t[0] * 0.012, p[1] - t[1] * 0.012, p[2] - t[2] * 0.012], [p[0] + t[0] * 0.012, p[1] + t[1] * 0.012, p[2] + t[2] * 0.012]],
        { look: C.look, r: 0.0022, sway: 0, kind: KIND.tie, barbs: null, snow: 0, tie: true });
    },
    /** A wrap of wire round a post (end posts, hedgehog arms): `turns` loops of radius r at height y. */
    wrap(c, y, r, turns = 1.5, pitch = 0.025) {
      const pts = [], n = Math.ceil(turns * 10);
      for (let i = 0; i <= n; i++) { const a = (i / 10) * Math.PI * 2; pts.push([c[0] + Math.cos(a) * r, y + (i / 10) * pitch, c[1] + Math.sin(a) * r]); }
      C.P.wire(pts, { look: C.look, r: 0.0026, sway: 0, barbs: null, snow: C.snow * 0.5 });
    },
  };
  return C;
}

/** Leaning post: base at the ground (sunk `sink`), height h, lean jitter (rad). */
function post(C, kind, d, h, r, o = {}) {
  const a = C.fix(d, 0, o.off ?? 0), lean = o.lean ?? 0.06;
  const lx = (C.rnd() * 2 - 1) * lean, lz = (C.rnd() * 2 - 1) * lean, sink = o.sink ?? 0.3;
  const top = [a[0] + lx * h, a[1] + h, a[2] + lz * h], base = [a[0] - lx * sink, a[1] - sink, a[2] - lz * sink];
  C.P.add(kind, beamMatrix(base, top, r, o.rz ?? r, o.roll ?? C.rnd() * Math.PI));
  C.P.count('posts');
  return { a, top, lx, lz, at: (y) => [a[0] + lx * y, a[1] + y, a[2] + lz * y] };
}

/** Field fence (§4.2): timber stakes 2.5–3 m apart, 4–8 strands on the outside face, strainer braces at the ends. */
function fieldFence(C) {
  const { run, h } = C, mil = C.def.military || C.theater === 'desert';
  // `strands` overrides the count: 1 = a minefield marking line (one strand near the stake tops, the signs hang on it)
  const n = Math.max(1, Math.round(C.def.strands ?? (h <= 1.4 ? 4 : 5 + Math.max(0, Math.round((h - 1.5) / 0.25)))));
  const ys = n === 1 ? [h - 0.12] : Array.from({ length: n }, (_, i) => 0.15 + ((h - 0.2) * i) / (n - 1));
  const st = run.stations(2.7), posts = [];
  for (const d of st) {
    const end = d === 0 || d === run.length, corner = run.corners().some((c) => Math.abs(c - d) < 1e-6);
    const r = end || corner ? 0.07 : 0.045 + C.rnd() * 0.015;
    posts.push(mil && !end && !corner ? post(C, 'angle', d, h + 0.05, 0.045, { lean: 0.04 }) : post(C, C.theater === 'snow' ? 'stake' : 'stakeGrey', d, h + 0.04, r, { lean: end || corner ? 0.02 : 0.07 }));
    posts[posts.length - 1].r = r; posts[posts.length - 1].d = d;
    if (end) {   // strainer brace: a diagonal strut from 2/3 up the end post to the foot of the next one
      const inward = d === 0 ? 1 : -1, b = C.fix(Math.min(run.length, Math.max(0, d + inward * 1.4)), 0);
      C.P.add(C.theater === 'snow' ? 'stake' : 'stakeGrey', beamMatrix([b[0], b[1] - 0.05, b[2]], posts[posts.length - 1].at(h * 0.66), 0.04));
    }
  }
  for (let k = 1; k < posts.length; k++) {
    const A = posts[k - 1], B = posts[k];
    for (const y of ys) {
      const pa = A.at(y), pb = B.at(y);
      const fa = [pa[0] + C.run.at(A.d).nx * C.out * A.r, pa[1], pa[2] + C.run.at(A.d).nz * C.out * A.r];
      const fb = [pb[0] + C.run.at(B.d).nx * C.out * B.r, pb[1], pb[2] + C.run.at(B.d).nz * C.out * B.r];
      C.span(fa, fb, A.d, B.d, { sag: 0.015 * ((B.d - A.d) / 3) ** 2 * (0.7 + C.rnd() * 0.6), barbs: { spacing: C.def.farm ? 0.11 : 0.12, points: C.def.farm ? 2 : 4 } });
      if (k === 1) C.tie(fa); C.tie(fb);
    }
  }
  for (const y of ys) for (const P of [posts[0], posts[posts.length - 1]]) if (P) C.wrap([P.at(y)[0], P.at(y)[2]], P.at(y)[1] - 0.02, P.r + 0.004, 1.3);
}

/** Apron half-width at arc d: narrowed (per picket) where the anchor would land in a solid. */
function apronAt(C, d, side, want) {
  for (let a = want; a >= 0.5; a -= 0.15) { const p = C.fix(d, 0, a * side * C.out); if (!C.solidAt(p[0], p[2])) return a; }
  return 0.5;
}

/** Double-apron fence (§4.3): angle-iron centre pickets every 3 m, short anchors, guys, 3 apron wires a side. */
function doubleApron(C) {
  const { run, h } = C, want = Math.min(2.0, Math.max(0.6, C.width * 2)), hhEvery = C.def.hedgehogEvery || 0;
  const st = run.stations(hhEvery || 3), cen = [], anc = { [-1]: [], [1]: [] };
  for (const d of st) {
    const P = post(C, 'angle', d, h, 0.045, { lean: 0.03 });
    P.d = d; cen.push(P);
    for (const side of [-1, 1]) {
      const a = apronAt(C, d, side, want), q = post(C, 'screw', d, 0.32, 0.009, { off: a * side, lean: 0.12, sink: 0.4 });
      q.d = d; q.a = a; anc[side].push(q);
      C.span(P.at(h - 0.03), q.at(0.28), d, d, { sag: 0.01, sway: 0.2, barbs: { spacing: 0.12, points: 4 }, step: 0.3 });   // guy
    }
  }
  for (let k = 1; k < cen.length; k++) {
    const A = cen[k - 1], B = cen[k], da = A.d, db = B.d, L = db - da;
    for (const y of [0.3, 0.65, 1.0].map((f) => f * h)) C.span(A.at(y), B.at(y), da, db, { sag: 0.02 * (L / 3) ** 2 });
    for (const side of [-1, 1]) {
      const qa = anc[side][k - 1], qb = anc[side][k];
      // apron wires along the guy slope (¼, ½, ¾ of the way down) + the trip wire at the anchors
      for (const f of [0.25, 0.5, 0.75]) {
        const lerp = (P, Q) => { const t = P.at(h - 0.03), u = Q.at(0.28); return [t[0] + (u[0] - t[0]) * f, t[1] + (u[1] - t[1]) * f, t[2] + (u[2] - t[2]) * f]; };
        C.span(lerp(A, qa), lerp(B, qb), da, db, { sag: 0.04 * (L / 3) ** 2 * (0.7 + C.rnd() * 0.6), sway: 0.3 });
      }
      C.span(qa.at(0.15), qb.at(0.15), da, db, { sag: 0.05, sway: 0.3 });
    }
    // M10 wire belt: a hedgehog in every bay, the line strands wrapped twice round its crossing (tied in)
    if (hhEvery && L > 2.2) {
      const H = hedgehogAt(C, (da + db) / 2, 0, Math.min(1.6, L - 0.6));
      if (H) for (let w = 0; w < 2; w++) C.wrap([H.c[0], H.c[2]], H.c[1] - 0.1 + w * 0.12, 0.09, 1.2, 0.03);
    }
  }
}

/** Concertina coil(s) along the run (§4.4). o: {lift, off (across), diameter, pitch, pickets}. */
function coil(C, o = {}) {
  const { run } = C, reinf = !!C.def.reinforced;
  const pitch = o.pitch ?? (reinf ? 0.2 : 0.28), dia = o.diameter ?? 0.8, off = (o.off ?? 0) * C.out;
  for (let k = 1; k < run.p.length; k++) {
    const a0 = run.at(run.s[k - 1] + 0.01), a = [run.p[k - 1][0] + a0.nx * off, run.p[k - 1][1] + a0.nz * off], b = [run.p[k][0] + a0.nx * off, run.p[k][1] + a0.nz * off];
    const ground = o.ground || C.G;
    const path = concertinaPath(a, b, { diameter: dia, pitch, lift: o.lift ?? 0, segments: 14 }, C.rnd, ground);
    const L = run.s[k] - run.s[k - 1], n = path.length - 1;
    const sArr = path.map((_, i) => run.s[k - 1] + (L * i) / n);
    C.P.wire(path, { look: C.look, r: 0.0026, sway: 0, swayFn: () => 0.08, phase: C.rnd(), rust: C.rnd() * 0.3, barbs: { spacing: reinf ? 0.075 : 0.12, points: 4 },
      snow: C.snow, runKey: C.runKey, sArr, cuttable: C.cut, tails: 'hard', coil: true, onGround: !o.ground && !(o.lift > 0) });
    C.P.count('coilLoops', Math.round(L / pitch));
    // clips where neighbouring loops touch: 3 a loop, dark
    const segs = 14;
    for (let i = segs; i < path.length; i += segs) for (const j of [0, 5, 9]) { const p = path[i - segs + j]; if (p) C.tie(p, [run.at(run.s[k - 1]).tx, 0, run.at(run.s[k - 1]).tz]); }
  }
  if (o.pickets !== false) for (let d = 1.0; d < run.length - 0.5; d += 4.5) post(C, 'screw', d, (o.lift ?? 0) + dia * 0.75, 0.009, { off: o.off ?? 0, lean: 0.05, sink: 0.4 });
}
const concertina = (C) => coil(C);

/** Triple concertina: two base coils side by side, one on top, taut strands along the crest; hedgehogs optional. */
function tripleConcertina(C) {
  coil(C, { off: -0.42 }); coil(C, { off: 0.42, pickets: false });
  coil(C, { lift: 0.62, pickets: false });
  const st = C.run.stations(4.5);
  for (let k = 1; k < st.length; k++) C.span(C.fix(st[k - 1], 1.42), C.fix(st[k], 1.42), st[k - 1], st[k], { sag: 0.03 });
  if (/hedgehog/.test(String(C.def.variant))) hedgehogs(C, C.def.hedgehogEvery ?? 6, 1.6, 1.75);
}

/** Knife rests (§4.5): 3.5 m timber beams on X-trestles, wound with strands and a zig-zag, butted end to end. */
function knifeRest(C) {
  const { run } = C, steel = /steel/.test(String(C.def.variant)), legK = steel ? 'angle' : C.theater === 'snow' ? 'stake' : 'stakeGrey';
  const units = Math.max(1, Math.round(run.length / 3.5)), U = run.length / units;
  for (let u = 0; u < units; u++) {
    const d0 = u * U + 0.12, d1 = (u + 1) * U - 0.12, yaw = (C.rnd() * 2 - 1) * 0.08;
    const A = run.at(d0), B = run.at(d1), m = [(A.x + B.x) / 2, (A.z + B.z) / 2], hl = (d1 - d0) / 2;
    const tx = A.tx * Math.cos(yaw) - A.tz * Math.sin(yaw), tz = A.tx * Math.sin(yaw) + A.tz * Math.cos(yaw), nx = tz, nz = -tx;
    const at = (s, a, y) => { const x = m[0] + tx * s + nx * a, z = m[1] + tz * s + nz * a; return [x, C.G(x, z) + y, z]; };
    const at0 = (s, a, y) => { const x = m[0] + tx * s + nx * a, z = m[1] + tz * s + nz * a; return [x, C.G(m[0], m[1]) + y, z]; };
    const yc = 0.72;
    for (const s of [-hl, hl]) {   // X-trestle: two legs crossing at the beam
      C.P.add(legK, beamMatrix(at(s, -0.7, -0.05), at0(s, 0.5, 1.25), steel ? 0.04 : 0.055, steel ? 0.04 : 0.055, C.rnd()));
      C.P.add(legK, beamMatrix(at(s, 0.7, -0.05), at0(s, -0.5, 1.25), steel ? 0.04 : 0.055, steel ? 0.04 : 0.055, C.rnd()));
    }
    C.P.add(steel ? 'angle' : 'beam', beamMatrix(at0(-hl - 0.15, 0, yc), at0(hl + 0.15, 0, yc), steel ? 0.05 : 0.11, steel ? 0.05 : 0.11, 0.6));
    C.P.count('knifeRests');
    // 6 strands end to end on the X arms (the leg points at three heights, both legs)
    const leg = (s, sgn, f) => { const lo = at(s, -0.7 * sgn, -0.05), hi = at0(s, 0.5 * sgn, 1.25); return [lo[0] + (hi[0] - lo[0]) * f, lo[1] + (hi[1] - lo[1]) * f, lo[2] + (hi[2] - lo[2]) * f]; };
    for (const sgn of [-1, 1]) for (const f of [0.15, 0.4, 0.92]) C.span(leg(-hl, sgn, f), leg(hl, sgn, f), u * U, (u + 1) * U, { sag: 0.03, sway: 0.2 });
    // zig-zag spiral round the frame: one wrap per 0.4 m, an ellipse through the X arms
    const zz = [], n = Math.round((2 * hl) / 0.4) * 8;
    for (let i = 0; i <= n; i++) {
      const s = -hl + (2 * hl * i) / n, th = (i / 8) * Math.PI * 2;
      zz.push(at0(s, Math.sin(th) * 0.55, yc + Math.cos(th) * 0.48 + 0.03 * Math.sin(th * 2.3)));
    }
    C.P.wire(zz, { look: C.look, r: 0.0026, sway: 0.15, phase: C.rnd(), rust: C.rnd() * 0.4, barbs: { spacing: 0.12, points: 4 }, snow: C.snow, runKey: C.runKey,
      sArr: zz.map((_, i) => u * U + (U * i) / n), cuttable: C.cut, tails: 'soft' });
    // a loose loop hanging off one side
    if (C.rnd() < 0.7) C.span(at0(-hl * 0.5, -0.45, 0.95), at0(hl * 0.3, -0.5, 0.9), u * U, (u + 1) * U, { sag: 0.35, sway: 0.6 });
  }
}

/** Czech hedgehogs along the run every ~`every` m (±0.4 m lateral, ±20° yaw); returns their centres. */
function hedgehogs(C, every = 3.5, armL = 2.0, off = 0) {
  const out = [];
  // cube axes rotated so the body diagonal (1,1,1) is vertical
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 1, 1).normalize(), _Y);
  for (let d = Math.min(every / 2, C.run.length / 2); d <= C.run.length; d += every * (0.85 + C.rnd() * 0.3)) {
    const h = hedgehogAt(C, d, off + (C.rnd() * 2 - 1) * 0.4, armL, q);
    if (h) out.push(h);
  }
  return out;
}

/** One Czech hedgehog (3 I-beams, 3 feet on the ground) at run arc d, `lat` m to the outside; null when avoided. */
function hedgehogAt(C, d, lat, armL = 2.0, q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 1, 1).normalize(), _Y)) {
  const half = armL / 2, ch = half * Math.cos(Math.atan(Math.SQRT2)) + 0.02;   // centre height: 3 feet on the ground
  {
    const c = C.fix(d, 0, lat), skip = C.avoid?.(c[0], c[2]);
    if (skip) return null;
    const yaw = new THREE.Quaternion().setFromAxisAngle(_Y, C.rnd() * Math.PI * 2);
    const ctr = [c[0], c[1] + ch, c[2]];
    for (const ax of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      const e = new THREE.Vector3(...ax).applyQuaternion(q).applyQuaternion(yaw);
      C.P.add('ibeam', beamMatrix([ctr[0] - e.x * half, ctr[1] - e.y * half - 0.08, ctr[2] - e.z * half], [ctr[0] + e.x * half, ctr[1] + e.y * half, ctr[2] + e.z * half], 0.11, 0.11, C.rnd()));
    }
    C.P.count('hedgehogs');
    return { d, c: ctr, g: c[1] };
  }
}

/** Hedgehog belt (§4.6): hedgehogs with 3 sagging strands threaded through, wrapped twice each; beach tangles. */
function hedgehogBelt(C) {
  const beach = C.theater === 'coast', H = hedgehogs(C, C.def.hedgehogEvery ?? (beach ? 3.2 : 3.5), 2.0);
  for (const h of H) for (let w = 0; w < 2; w++) C.wrap([h.c[0], h.c[2]], h.c[1] - 0.1 + w * 0.12, 0.09, 1.2, 0.03);
  for (let k = 1; k < H.length; k++) {
    const A = H[k - 1], B = H[k];
    for (const y of [0.3, 0.7, 1.1]) {
      const sag = beach ? 0.08 + C.rnd() * 0.25 : 0.08 + C.rnd() * 0.07;
      C.span([A.c[0], A.g + y, A.c[2]], [B.c[0], B.g + y, B.c[2]], A.d, B.d, { sag, sway: beach ? 0.8 : 0.5, minClear: beach ? 0.01 : 0.03 });
    }
    if (beach && C.rnd() < 0.8) {   // random tangle loops hanging to the sand
      const f = 0.2 + C.rnd() * 0.5, m = [A.c[0] + (B.c[0] - A.c[0]) * f, A.g + 0.6, A.c[2] + (B.c[2] - A.c[2]) * f];
      C.span([A.c[0], A.g + 0.9, A.c[2]], [m[0] + (C.rnd() - 0.5) * 0.8, m[1], m[2] + (C.rnd() - 0.5) * 0.8], A.d, B.d, { sag: 0.5, sway: 0.8, minClear: 0.01 });
    }
  }
  if (/czech/.test(String(C.def.variant)) || C.def.footCoil) coil(C, { diameter: 0.5, pitch: 0.3, off: 1.7, pickets: false });
}

/**
 * Wall-top coping on outward brackets (§4.7). On a palisade the brackets are nailed to the tallest stake near each
 * station and every strand clears the tallest stake top of its spans by ≥ 4 cm (the M2 crossing fix).
 * C.coping = {stakes: [{x, z, top, r}], top (wall coping height)}.
 */
function copingBracket(C) {
  const { run } = C, cp = C.coping || {}, stakes = cp.stakes || [], yBrackets = !stakes.length;
  // absolute heights: palisades and wall boxes stand on y = 0 (their own base), not on the terrain samples
  const base0 = cp.base ?? 0;
  const sAt = stakes.map((s) => ({ ...s, d: run.project(s.x, s.z).d }));
  const br = [];
  for (const d0 of run.stations(2.8)) {
    let b;
    if (sAt.length) {   // nailed to the tallest stake within ±0.8 m of the station
      let best = null;
      for (const s of sAt) if (Math.abs(s.d - d0) < 0.8 && (!best || s.top > best.top)) best = s;
      best = best || sAt.reduce((a, s) => (Math.abs(s.d - d0) < Math.abs(a.d - d0) ? s : a), sAt[0]);
      b = { d: best.d, top: best.top, x: best.x, z: best.z, r: best.r };
    } else { const a = run.at(d0); b = { d: d0, top: cp.top ?? C.h, x: a.x, z: a.z, r: 0 }; }
    if (!br.some((q) => Math.abs(q.d - b.d) < 0.5)) br.push(b);
  }
  br.sort((a, b) => a.d - b.d);
  const maxTop = (a, b) => { let m = -Infinity; for (const s of sAt) if (s.d >= a - 0.2 && s.d <= b + 0.2) m = Math.max(m, s.top); return m; };
  const arm = [0.22, 0.4, 0.58];
  for (let k = 0; k < br.length; k++) {
    const b = br[k], q = run.at(b.d), ox = q.nx * C.out, oz = q.nz * C.out;
    const M = Math.max(maxTop(br[Math.max(0, k - 1)].d, b.d), maxTop(b.d, br[Math.min(br.length - 1, k + 1)].d));
    const baseY = base0 + (stakes.length ? b.top - 0.14 : b.top);
    const shift = Number.isFinite(M) ? Math.max(0, (base0 + M + 0.06 - baseY) / Math.cos(D35) - arm[0]) : 0;
    b.ds = arm.map((a) => a + shift);
    b.pts = {};
    for (const sd of yBrackets ? [-1, 1] : [1]) {
      const r0 = stakes.length ? b.r + 0.025 : 0;
      const at = (a) => [b.x + ox * (r0 + sd * a * Math.sin(D35)), baseY + a * Math.cos(D35), b.z + oz * (r0 + sd * a * Math.sin(D35))];
      C.P.add('angleThin', beamMatrix(at(-0.08), at(b.ds[2] + 0.07), 0.035, 0.035, sd > 0 ? 0.3 : 3.4));
      b.pts[sd] = b.ds.map(at);
    }
    C.P.count('brackets');
  }
  for (let k = 1; k < br.length; k++) for (const sd of Object.keys(br[k].pts)) for (let j = 0; j < 3; j++) {
    const a = br[k - 1].pts[sd]?.[j], b = br[k].pts[sd]?.[j];
    if (a && b) C.span(a, b, br[k - 1].d, br[k].d, { sag: 0.012, sway: 0.12, minAbove: base0 + maxTop(br[k - 1].d, br[k].d) + 0.04 });
  }
  C.brackets = br;
  // body guard (placement rule e): the palisade + coping as one standing barrier along the authored line
  if (stakes.length) C.P.guards.push({ points: run.p, y0: base0 + C.h - 0.2, y1: base0 + C.h + 0.4 });
}

/** Concertina laid along a wall top (§4.7), pinned by short brackets every 3 m. */
function copingConcertina(C) {
  const top = C.coping?.top ?? C.h;
  coil(C, { diameter: 0.6, pitch: 0.26, ground: (x, z) => C.G(x, z) + top + 0.07, pickets: false });
  for (let d = 0.8; d < C.run.length; d += 3) C.P.add('angleThin', beamMatrix(C.fix(d, top - 0.05), C.fix(d, top + 0.45), 0.03));
}

/**
 * Chain-link (§4.8): galvanised pipe posts every 3 m, one mesh panel per span, top tension wire; fences get 45°
 * outward arms with 3 barbed strands, cages a short vertical extension with 2; electric adds porcelain insulators,
 * 4 live strands on the mesh face, enamel warning plates (~30 m) and spark points.
 */
function chainlink(C) {
  const { run, h, def } = C, kennel = !!def.kennel, cage = kennel || def.variant === 'square', electric = !!(def.electric || def.variant === 'electric');
  const meshTop = cage ? h - 0.05 : h - 0.15, st = run.stations(3), posts = [];
  // a leg within 5 m of the map edge on its outside (the edge treeline) takes its arms INWARD: outriggers never reach into the
  // edge foliage / skirt; a corner between an inward and an outward leg gets an upright arm
  const legOut = run.p.slice(1).map((_, k) => {
    for (let f = 0.1; f < 1; f += 0.2) { const q = run.at(run.s[k] + (run.s[k + 1] - run.s[k]) * f); if (C.offMap(q.x + q.nx * C.out * 5, q.z + q.nz * C.out * 5)) return -1; }
    return 1;
  });
  const armSide = (d) => {
    let k = 1; while (k < run.p.length - 1 && run.s[k] < d - 1e-6) k++;
    return Math.abs(run.s[k] - d) < 1e-6 && k < run.p.length - 1 && legOut[k] !== legOut[k - 1] ? 0 : legOut[k - 1];
  };
  for (const d of st) {
    const end = d === 0 || d === run.length;
    const P = post(C, 'pipe', d, kennel ? h : cage ? h + 0.35 : h, end ? 0.045 : 0.032, { lean: 0.008, sink: 0.4 });
    P.d = d; posts.push(P);
    if (!cage) {   // outward arm at 45°
      const sg = armSide(d) * C.out, up = sg ? 0.45 : 0.5;
      const a = P.at(h - 0.02), arm = (f) => { const q = run.at(d); return [a[0] + q.nx * sg * 0.45 * f, a[1] + up * f, a[2] + q.nz * sg * 0.45 * f]; };
      C.P.add('angleThin', beamMatrix(arm(0), arm(1.08), 0.035, 0.035, 0.5));
      P.arm = [0.33, 0.66, 1].map(arm);
    } else P.arm = kennel ? [] : [P.at(h + 0.12), P.at(h + 0.3)];
    if (electric) for (const p of P.arm) { C.P.add('insulator', beamMatrix([p[0], p[1] - 0.06, p[2]], [p[0], p[1] + 0.02, p[2]], 0.022)); }
    if (electric || def.sparks) C.P.sparks.push(...P.arm.map((p) => ({ x: p[0], y: p[1], z: p[2], id: def.id })));
  }
  const live = electric ? [0.55, 1.05, 1.55, 2.0].filter((y) => y < meshTop - 0.1) : [];
  for (let k = 1; k < posts.length; k++) {
    const A = posts[k - 1], B = posts[k], a = run.at(A.d), b = run.at(B.d);
    C.P.panel([a.x, a.z], [b.x, b.z], C.G(a.x, a.z), C.G(b.x, b.z), 0.03, meshTop, { runKey: C.runKey, da: A.d, db: B.d, cuttable: C.cut });
    C.span(A.at(meshTop), B.at(meshTop), A.d, B.d, { sag: 0.008, barbs: null, sway: 0.05, r: 0.0022 });   // tension wire
    for (let j = 0; j < A.arm.length; j++) C.span(A.arm[j], B.arm[j], A.d, B.d, { sag: 0.015, sway: 0.12 });
    for (const y of live) {
      const off = (P, q) => { const p = P.at(y); return [p[0] + q.nx * C.out * 0.12, p[1], p[2] + q.nz * C.out * 0.12]; };
      C.span(off(A, a), off(B, b), A.d, B.d, { sag: 0.01, barbs: null, sway: 0.08, r: 0.0022 });
      if (k === 1) C.P.add('insulator', beamMatrix(off(A, a), [off(A, a)[0] - a.nx * C.out * 0.1, y, off(A, a)[2] - a.nz * C.out * 0.1], 0.016));
      C.P.add('insulator', beamMatrix(off(B, b), [off(B, b)[0] - b.nx * C.out * 0.1, y, off(B, b)[2] - b.nz * C.out * 0.1], 0.016));
    }
  }
  // enamel warning plates: every ~30 m on fences, one per cage
  const plates = kennel ? [] : cage ? [run.length * 0.375] : Array.from({ length: Math.max(1, Math.floor(run.length / 30)) }, (_, i) => 15 + i * 30).filter((d) => d < run.length - 1);
  for (const d of plates) {
    const q = run.at(d), p = C.fix(d, 1.45, 0.02);
    C.P.add('plate', new THREE.Matrix4().compose(new THREE.Vector3(p[0] + q.nx * C.out * 0.01, p[1], p[2] + q.nz * C.out * 0.01),
      new THREE.Quaternion().setFromAxisAngle(_Y, Math.atan2(q.nx * C.out, q.nz * C.out)), new THREE.Vector3(0.32, 0.22, 0.01)));
    C.P.count('plates');
  }
}

/** Prison wire cage (§4.8, M17): square timber posts every 3 m, strands every 15 cm, a 3-strand inward overhang. */
function cage(C) {
  const { run, h } = C, st = run.stations(3), posts = [];
  for (const d of st) { const P = post(C, 'square', d, h + 0.1, 0.065, { lean: 0.015, roll: Math.atan2(run.at(d).tz, run.at(d).tx) }); P.d = d; posts.push(P); }
  const ys = []; for (let y = 0.15; y <= h - 0.05; y += 0.15) ys.push(y);
  for (let k = 1; k < posts.length; k++) {
    const A = posts[k - 1], B = posts[k];
    for (const y of ys) C.span(A.at(y), B.at(y), A.d, B.d, { sag: 0.01, sway: 0.1, barbs: { spacing: 0.12, points: 4 } });
  }
  for (const P of posts) {
    const q = run.at(P.d), arm = (f) => { const a = P.at(h); return [a[0] - q.nx * C.out * 0.42 * f, a[1] + 0.42 * f, a[2] - q.nz * C.out * 0.42 * f]; };
    C.P.add('angleThin', beamMatrix(arm(0), arm(1.05), 0.035, 0.035, 0.5));
    P.arm = [0.35, 0.68, 1].map(arm);
  }
  for (let k = 1; k < posts.length; k++) for (let j = 0; j < 3; j++) C.span(posts[k - 1].arm[j], posts[k].arm[j], posts[k - 1].d, posts[k].d, { sag: 0.015 });
}

/** Low wire entanglement: stakes ~15 cm proud, irregular, wire taut between random neighbours (a trip obstacle). */
function lowEntanglement(C) {
  const pts = [];
  for (let d = 0.3; d < C.run.length; d += 0.9 + C.rnd() * 0.8) {
    const off = (C.rnd() * 2 - 1) * Math.max(0.3, C.width / 2), P = post(C, 'stakeGrey', d, 0.16, 0.025, { off, lean: 0.15, sink: 0.25 });
    P.d = d; pts.push(P);
  }
  for (let k = 1; k < pts.length; k++) for (const j of [1, 2]) if (pts[k - j]) C.span(pts[k - j].at(0.12), pts[k].at(0.1), pts[k - j].d, pts[k].d, { sag: 0.01, sway: 0.1, minClear: 0.02 });
}

export const RECIPES = {
  field_fence: fieldFence, double_apron: doubleApron, knife_rest: knifeRest, concertina, triple_concertina: tripleConcertina,
  hedgehog_belt: hedgehogBelt, coping_bracket: copingBracket, coping_concertina: copingConcertina, chainlink, cage, low_entanglement: lowEntanglement,
};

/** Run one recipe for one run into `parts` (pure; Node-safe). Returns the recipe context (brackets etc.). */
export function buildWireRun(type, points, def, o = {}) {
  const run = new Run(points);
  if (run.length < 0.3) return null;
  const C = ctxFor(run, def, o);
  C.coping = o.coping || null; C.avoid = o.avoid || null;
  (RECIPES[type] || fieldFence)(C);
  return C;
}

// ------------------------------------------------------------------------------------------------ cut gaps

/**
 * Split a wire path at the gaps (run-arc intervals [s0, s1]): the pieces outside every gap, plus one cut per
 * severed end {p, dir (unit, pointing into the gap)}. Pure.
 */
export function cutPath(path, sArr, gaps) {
  if (!gaps?.length || !sArr) return { pieces: [{ path, sArr }], cuts: [] };
  const inGap = (s) => gaps.some((g) => s > g[0] && s < g[1]);
  const pieces = [], cuts = [];
  let cur = null;
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const dirOf = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l]; };
  for (let i = 0; i < path.length; i++) {
    const g = inGap(sArr[i]);
    if (!g) {
      if (!cur) {
        cur = { path: [], sArr: [] };
        if (i > 0) {   // entering from a gap: the cut point at the gap edge
          const e = gaps.find((q) => sArr[i - 1] > q[0] && sArr[i - 1] < q[1]), edge = sArr[i] >= e[1] ? e[1] : e[0];
          const t = Math.abs(sArr[i] - sArr[i - 1]) > 1e-9 ? (edge - sArr[i - 1]) / (sArr[i] - sArr[i - 1]) : 0;
          const p = lerp(path[i - 1], path[i], Math.min(1, Math.max(0, t)));
          cur.path.push(p); cur.sArr.push(edge); cuts.push({ p, dir: dirOf(path[i], path[i - 1]) });
        }
      }
      cur.path.push(path[i]); cur.sArr.push(sArr[i]);
    } else if (cur) {   // leaving into a gap
      const e = gaps.find((q) => sArr[i] > q[0] && sArr[i] < q[1]), edge = sArr[i - 1] <= e[0] ? e[0] : e[1];
      const t = Math.abs(sArr[i] - sArr[i - 1]) > 1e-9 ? (edge - sArr[i - 1]) / (sArr[i] - sArr[i - 1]) : 1;
      const p = lerp(path[i - 1], path[i], Math.min(1, Math.max(0, t)));
      cur.path.push(p); cur.sArr.push(edge); cuts.push({ p, dir: dirOf(path[i - 1], path[i]) });
      if (cur.path.length >= 2) pieces.push(cur);
      cur = null;
    }
  }
  if (cur && cur.path.length >= 2) pieces.push(cur);
  return { pieces, cuts };
}

/**
 * A sprung, curled tail at a cut end (§1.5, §4.9): a decaying helix coiling back from the cut, drooping.
 * 'hard' = high-tensile (2–3 turns, 0.25–0.45 m), 'soft' = a lazy loop. Returns the path.
 */
export function curlTail(cut, kind = 'soft', rnd = Math.random, groundAt = () => 0) {
  const ax = [-cut.dir[0], -cut.dir[1], -cut.dir[2]];
  let e1 = [0, 1, 0];
  const dp = e1[1] * ax[1];
  e1 = [-ax[0] * dp, 1 - ax[1] * dp, -ax[2] * dp];
  const l1 = Math.hypot(...e1) || 1; e1 = e1.map((v) => v / l1);
  const e2 = [ax[1] * e1[2] - ax[2] * e1[1], ax[2] * e1[0] - ax[0] * e1[2], ax[0] * e1[1] - ax[1] * e1[0]];
  const hard = kind === 'hard', turns = hard ? 2 + rnd() : 0.9 + rnd() * 0.6, R0 = (hard ? 0.13 : 0.1) + rnd() * 0.09;
  const droop = 0.2 + rnd() * 0.2, n = Math.ceil(turns * 16), side = rnd() < 0.5 ? -1 : 1, out = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, a = f * turns * Math.PI * 2, R = R0 * (1 - 0.45 * f);
    const c = Math.cos(a), s = Math.sin(a) * side, adv = f * (hard ? 0.3 : 0.45);
    const p = [0, 1, 2].map((k) => cut.p[k] + e1[k] * R0 - e1[k] * R * c + e2[k] * R * s + ax[k] * adv);
    p[1] -= droop * f * f;
    p[1] = Math.max(p[1], groundAt(p[0], p[2]) + 0.012);
    out.push(p);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ assembly

/**
 * Turn the wire items into ribbon buffers (one WireBuffer per look), applying the cut gaps (Map runKey →
 * [[s0, s1], …]) and the ground clearance. Pure (no GPU): returns {buffers: Map look → WireBuffer, cuts, tails}.
 */
export function assembleRibbons(parts, gaps = new Map(), groundAt = () => 0, o = {}) {
  const buffers = new Map(), stat = { cuts: 0, tails: 0 };
  const bufOf = (look) => { if (!buffers.has(look)) buffers.set(look, new WireBuffer(groundAt)); return buffers.get(look); };
  for (let k = 0; k < parts.items.length; k++) assembleItem(parts.items[k], k, bufOf, gaps, groundAt, o, stat);
  return { buffers, ...stat };
}

/**
 * One wire item into its look's buffer. o.strands === false → barbs only, o.barbs === false → no barbs: the two
 * passes are independent (own random streams: strands / beads, barbs, and one per cut tail), so the barbs can be
 * laid later (time-sliced) and land exactly where a single pass would put them. The strand pass clamps the path to
 * the ground in place (before any barb pass).
 */
export function assembleItem(it, k, bufOf, gaps, groundAt, o, stat) {
  const buf = bufOf(it.look || 'temperate'), rnd = wireRng(0x5eed + k), rndB = wireRng(0xb4eb + k * 7);
  const strands = o.strands !== false, barbs = !!it.barbs && o.barbs !== false;
  if (!strands && !barbs) return;
  let gs = null;
  if (strands) {
    const clear = it.coil ? 0.004 : it.minClear ?? 0.03;
    gs = new Float32Array(it.path.length);   // ground under every point, once: the clamp + the shadow projection share it
    for (let i = 0; i < it.path.length; i++) { const p = it.path[i]; gs[i] = groundAt(p[0], p[2]); if (!it.tie && !it.noClamp) p[1] = Math.max(p[1], gs[i] + clear); }
  }
  const g = it.cuttable && it.runKey != null ? gaps.get(it.runKey) : null;
  const { pieces, cuts } = cutPath(it.path, it.sArr, g);
  for (const pc of pieces) {
    const swayFn = it.swayFn ? it.swayFn : null, s = arcLengths(pc.path), L = s[s.length - 1];
    if (strands) buf.strand(pc.path, { s, g: pc.path === it.path ? gs : null, r: it.r, rust: it.rust, kind: it.kind ?? KIND.strand, sway: it.sway, phase: it.phase, swayFn, arc0: pc.sArr?.[0] ?? 0 });
    if (barbs) buf.barbs(pc.path, { ...it.barbs, s, rust: it.rust, rnd: rndB, sway: swayFn || it.sway * Math.min(2, Math.max(0.3, (L || 1) / 3)), phase: it.phase, snow: it.snow > 0 ? 0.3 * it.snow : 0 });
    if (strands && it.snow > 0 && !it.tie) buf.snowBeads(pc.path, { s, cover: 0.55 * it.snow, rnd, sway: it.sway, phase: it.phase });
  }
  cuts.forEach((c, ci) => {
    const rt = wireRng(0x7a11 + k * 131 + ci), tail = curlTail(c, it.tails, rt, groundAt), n = tail.length - 1, ph = rt();
    if (strands) {
      buf.strand(tail, { r: it.r ?? 0.0026, rust: it.rust, sway: 1, phase: ph, swayFn: (u) => 0.15 + 0.85 * u });
      const a = tail[n - 1], b = tail[n];
      buf.seg(a.map((v, j) => b[j] + (a[j] - b[j]) * 0.15), b, { r: 0.0028, kind: KIND.tip, sway: 1 });
      stat.cuts++; stat.tails++;
    }
    if (barbs) buf.barbs(tail, { ...it.barbs, rust: it.rust, rnd: rndB, sway: (u) => 0.15 + 0.85 * u });
  });
}

const PANEL_TILE = 0.11;   // two 55 mm diamonds per texture tile

/** Chain-link panel geometry (one quad per span, the cut gaps removed; uv in tiles). Pure. */
export function panelGeometry(panels, gaps = new Map()) {
  const pos = [], uv = [], idx = [];
  for (const p of panels) {
    const L = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
    let spans = [[0, 1]];
    const g = p.cuttable ? gaps.get(p.runKey) : null;
    if (g) for (const [s0, s1] of g) {
      const f0 = (s0 - p.da) / (p.db - p.da), f1 = (s1 - p.da) / (p.db - p.da);
      spans = spans.flatMap(([a, b]) => (f1 <= a || f0 >= b ? [[a, b]] : [[a, Math.max(a, f0)], [Math.min(b, f1), b]].filter(([x, y]) => y - x > 0.01)));
    }
    for (const [fa, fb] of spans) {
      const k = pos.length / 3;
      for (const [f, top] of [[fa, 0], [fb, 0], [fa, 1], [fb, 1]]) {
        const x = p.a[0] + (p.b[0] - p.a[0]) * f, z = p.a[1] + (p.b[1] - p.a[1]) * f, g0 = p.ga + (p.gb - p.ga) * f;
        pos.push(x, g0 + (top ? p.top : p.bottom), z);
        uv.push((f * L) / PANEL_TILE, ((top ? p.top : p.bottom) - p.bottom) / PANEL_TILE);
      }
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// ------------------------------------------------------------------------------------------------ GPU side

let _geos = null;
/** Unit geometries standing on y ∈ [0, 1] (plate: centred). */
function instanceGeometries() {
  if (_geos) return _geos;
  const up = (g) => g.translate(0, 0.5, 0);
  const shape = (pts) => { const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); return s; };
  const extrude = (sh) => { const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false }); g.rotateX(-Math.PI / 2); return g; };   // depth → +y
  const t = 0.12;   // flange thickness as a fraction of the section
  const L = extrude(shape([[-0.5, -0.5], [0.5, -0.5], [0.5, -0.5 + t], [-0.5 + t, -0.5 + t], [-0.5 + t, 0.5], [-0.5, 0.5]]));
  const I = extrude(shape([[-0.5, -0.5], [0.5, -0.5], [0.5, -0.5 + t], [t / 2, -0.5 + t], [t / 2, 0.5 - t], [0.5, 0.5 - t], [0.5, 0.5], [-0.5, 0.5], [-0.5, 0.5 - t], [-t / 2, 0.5 - t], [-t / 2, -0.5 + t], [-0.5, -0.5 + t]]));
  const stake = up(new THREE.CylinderGeometry(0.92, 1, 1, 7, 1));
  const bob = new THREE.LatheGeometry([[0.001, 0], [1, 0.1], [0.62, 0.4], [0.95, 0.64], [0.001, 1]].map(([x, y]) => new THREE.Vector2(x, y)), 5);   // 40 tris: 3 px at zoom 2
  _geos = {
    stake, stakeGrey: stake, square: up(new THREE.BoxGeometry(1, 1, 1)), beam: up(new THREE.BoxGeometry(1, 1, 1)),
    angle: L, angleThin: L, ibeam: I, screw: up(new THREE.CylinderGeometry(1, 1, 1, 6, 1)), pipe: up(new THREE.CylinderGeometry(1, 1, 1, 8, 1)),
    insulator: bob, plate: new THREE.BoxGeometry(1, 1, 1),
  };
  return _geos;
}

/** RGBA DataTexture from a per-texel function (Node-safe, no canvas). */
function dataTex(n, fn, srgb = true) {
  const d = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const c = fn((i + 0.5) / n, (j + 0.5) / n); d.set(c.map((v) => Math.max(0, Math.min(255, Math.round(v * 255)))), (j * n + i) * 4); }
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}

let _chain = null, _plate = null;
/** Chain-link coverage texture: 2 × 2 diamonds of 2.8 mm wire per tile, a rounded highlight across each wire. */
function chainTexture() {
  if (_chain) return _chain;
  const w = 0.06;    // wire half-width in tile units (a touch heavier than 2.8 mm: the weave's double bends)
  _chain = dataTex(128, (u, v) => {
    const a = Math.abs(((u + v) * 2) % 1 - 0.5) * 2, b = Math.abs(((u - v + 2) * 2) % 1 - 0.5) * 2;   // 0 on a wire
    const d = Math.min(1 - a, 1 - b) / 2;   // distance (tile units) to the nearest wire
    const cov = 1 - Math.min(1, Math.max(0, (d - w) / 0.012));
    const sh = 0.75 + 0.25 * Math.cos(Math.min(1, d / w) * Math.PI / 2);
    return [0.2 * sh, 0.21 * sh, 0.22 * sh, cov];   // weathered galvanising: dark against snow and sand
  });
  return _chain;
}
/** Enamel warning plate: yellow field, black border and lightning bolt. */
function plateTexture() {
  if (_plate) return _plate;
  const bolt = [[0.58, 0.08], [0.3, 0.55], [0.5, 0.52], [0.38, 0.92], [0.72, 0.4], [0.52, 0.43], [0.66, 0.08]];
  const inPoly = (x, y) => { let c = false; for (let i = 0, j = bolt.length - 1; i < bolt.length; j = i++) { const [xi, yi] = bolt[i], [xj, yj] = bolt[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  _plate = dataTex(64, (u, v) => {
    const edge = Math.min(u, v, 1 - u, 1 - v) < 0.07, chip = Math.sin(u * 37) * Math.sin(v * 23) > 0.92;
    const k = edge || inPoly(u, 1 - v) ? [0.06, 0.06, 0.05] : chip ? [0.35, 0.3, 0.25] : [0.86, 0.66, 0.08];
    return [...k, 1];
  });
  return _plate;
}

const _kindMats = new Map();
/**
 * Material for an instanced kind in a theater (wood / painted or rusty steel / galvanised pipe / porcelain): own
 * clones, so the snow sits only on truly top faces of thin frames (bias −0.22; the shared prop snow would whiten
 * a 45° knife-rest leg completely) and coverPropsWithSnow leaves them alone.
 */
function kindMaterial(kind, theater, base, snow = 0) {
  const key = `${kind}|${theater}|${snow}`;
  if (_kindMats.has(key)) return _kindMats.get(key);
  const rusty = theater === 'desert' || theater === 'coast';
  let m;
  if (kind === 'insulator') m = new THREE.MeshStandardMaterial({ color: 0xece8dc, roughness: 0.18, metalness: 0 });
  else if (kind === 'plate') m = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.35, metalness: 0.1 });
  else if (/stake|square|beam/.test(kind)) {
    const w = base('logs');
    m = new THREE.MeshStandardMaterial({ map: w.map || null, normalMap: w.normalMap || null, color: w.map ? (theater === 'desert' ? 0xfffaf0 : 0xf0ece6) : 0x7a7268, roughness: 0.88, metalness: 0 });
  }
  else if (kind === 'pipe') { m = base('galv').clone(); m.metalness = 0.55; m.roughness = 0.6; m.color = new THREE.Color(0xc4c8cc); }
  else {
    m = base('steel').clone();
    m.color = new THREE.Color(rusty || kind === 'screw' || kind === 'ibeam' ? 0x8a5a3e : 0x8d9278);
    if (rusty) m.color.multiplyScalar(0.85);
    m.metalnessMap = null; m.aoMap = null; m.metalness = 0.3;
  }
  m.name = `wire:${kind}`;
  if (snow > 0 && kind !== 'plate') addSnowCover(m, { amount: snow, bias: kind === 'insulator' ? -0.1 : /beam|plate/.test(kind) ? -0.25 : -0.5 });
  m.userData.snowCover = true;
  _kindMats.set(key, m);
  return m;
}

function chainMaterial() {
  if (_kindMats.has('chain')) return _kindMats.get('chain');
  const m = new THREE.MeshStandardMaterial({ map: chainTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.7, metalness: 0.3, alphaTest: 0 });
  m.forceSinglePass = true;   // a transparent DoubleSide mesh would draw twice (back faces, then front)
  m.userData.aoExclude = true;
  // once the 55 mm diamonds fall below ~2 px the mips average them to a flat veil: keep the weave's diagonal ridges
  // (the light/dark bands a woven mesh shows from afar, ~4 tiles) and a denser core so the panel reads as wire mesh
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      { vec2 fw = fwidth(vMapUv); float cf = smoothstep(0.1, 0.3, max(fw.x, fw.y));
        float rd = sin(6.2832 * (vMapUv.x + vMapUv.y) * 0.25) * sin(6.2832 * (vMapUv.x - vMapUv.y) * 0.25);
        diffuseColor.rgb *= mix(1.0, 0.75 + 0.35 * rd * rd, cf);
        diffuseColor.a = min(1.0, diffuseColor.a * (1.0 + 1.4 * cf) * mix(1.0, 0.45 + 1.1 * rd * rd, cf)); }`);
  };
  m.customProgramCacheKey = () => 'wire-chain-2';
  _kindMats.set('chain', m);
  return m;
}

/**
 * Build the mission wire layer from the tagged runs under `root`.
 * opts: {groundAt(x, z), theater, snow (0..1), world, grid, missionId, sunDir (THREE.Vector3, towards the sun),
 *   material(name) → dressing material, night}.
 * @returns {{group, runs, update(dt), rebuild(), setGaps(map), stats, dispose()}|null}
 */
export function buildWireLayer(root, opts = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const tagged = [];
  root.traverse((o) => { if (o.userData?.wireRun) tagged.push(o.userData.wireRun); });
  if (!tagged.length) return null;
  const theater = opts.theater || 'temperate', snow = opts.snow ?? (theater === 'snow' ? 1 : 0), G = opts.groundAt || (() => 0);
  const grid = opts.grid || opts.world?.grid || null;
  const offMap = grid ? (x, z) => { const c = grid.worldToCell(x, z); return c.i < 0 || c.j < 0 || c.i >= grid.cols || c.j >= grid.rows; } : () => false;
  const solidAt = grid ? (x, z) => { const c = grid.worldToCell(x, z); return c.i < 0 || c.j < 0 || c.i >= grid.cols || c.j >= grid.rows || grid.block[grid.idx(c.i, c.j)] === 2; } : () => false;
  // structure centroids: the "inside" of enclosures (outward arms / brackets lean away from it)
  const cen = new Map();
  for (const r of tagged) {
    const k = r.def.id ?? r.def.variant ?? '?', c = cen.get(k) || [0, 0, 0];
    for (const p of r.points) { c[0] += p[0]; c[1] += p[1]; c[2]++; }
    cen.set(k, c);
  }
  const parts = new Parts(), runs = [];
  tagged.forEach((r, i) => {
    const mw = missionWire(r.def, opts.missionId), type = mw?.type || r.type || wireTypeOf(r.def, { missionId: opts.missionId });
    if (!type) return;
    if (mw) r = { ...r, def: { ...r.def, ...mw } };
    const c = cen.get(r.def.id ?? r.def.variant ?? '?'), runKey = `${r.def.id ?? 'wire'}#${i}`;
    const C = buildWireRun(type, r.points, r.def, { parts, groundAt: G, look: wireLookOf(r.def, theater), snow, theater, runKey, runIndex: i,
      inside: c && c[2] > 2 ? [c[0] / c[2], c[1] / c[2]] : null, solidAt, offMap, coping: r.coping });
    if (C) runs.push({ key: runKey, type, def: r.def, run: C.run, cut: C.cut, brackets: C.brackets || null });
  });
  const group = new THREE.Group();
  group.name = 'wire-layer';
  const gaps = new Map(), base = opts.material || ((n) => new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.8 }));
  // instanced posts / frames (built once: the cutters never take a post)
  const geos = instanceGeometries(), inst = [];
  for (const [kind, mats] of parts.inst) {
    const im = new THREE.InstancedMesh(geos[kind], kindMaterial(kind, theater, base, snow), mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.name = `wire:${kind}`; im.castShadow = kind !== 'insulator'; im.receiveShadow = true;
    if (/insulator|plate|screw|angleThin/.test(kind)) im.userData.aoExclude = true;   // too small for the GTAO prepass
    im.computeBoundingSphere();
    group.add(im); inst.push(im);
  }
  // never drawn (layer 30): the standing barrier the dying-body rule stamps (map-builder stampStanding)
  let standing = null;
  if (parts.guards.length) {
    const pos = [], idx = [];
    for (const gd of parts.guards) for (let k = 1; k < gd.points.length; k++) {
      const a = gd.points[k - 1], b = gd.points[k], n = pos.length / 3;
      pos.push(a[0], gd.y0, a[1], b[0], gd.y0, b[1], a[0], gd.y1, a[1], b[0], gd.y1, b[1]);
      idx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
    const gm = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    gm.name = 'wire:guard'; gm.layers.set(30); gm.castShadow = false; gm.userData.aoExclude = true;
    group.add(gm);
    standing = { object3d: gm, type: 'wire', def: { id: 'wire' }, owner: 'wire' };
  }
  // Barbs (~60 % of the work in a belt-heavy map like M10) are laid in a second pass. With opts.deferBarbs (the game)
  // that pass runs time-sliced (≤ 4 ms slices on zero-delay timers, plus ≤ 3 ms in each update()) and swaps in
  // when complete, typically before the map's async textures are ready; until then the previous
  // barb meshes stay (a cut's gap keeps its old barbs for a few frames, never a bare strand flicker).
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let ribbons = [], barbMeshes = [], job = null, stats = {};
  const swapBarbs = (buffers) => {
    for (const m of barbMeshes) { group.remove(m); m.geometry.dispose(); }
    barbMeshes = [];
    let tris = 0, n = 0;
    for (const [look, buf] of buffers) for (const beads of [false, true]) for (const ig of buf.instGeometries(beads)) {   // per 32 m chunk: culled off screen
      const im = wireMesh(ig, wireMaterial(look, { snow, inst: true }), `wire:${beads ? 'snow' : 'barbs'}:${look}`);
      group.add(im); barbMeshes.push(im);
      tris += ig.instanceCount * (beads ? 2 : BARB_TRIS); n += beads ? 0 : ig.instanceCount;
    }
    Object.assign(stats, { ribbonTris: stats.strandTris + tris, barbs: n, drawCalls: group.children.filter((o) => o.layers.mask & 1).length, barbsPending: false });
  };
  const stepBarbs = (budget = Infinity) => {
    if (!job) return false;
    const t = now(), items = parts.items;
    while (job.k < items.length) {
      assembleItem(items[job.k], job.k, job.bufOf, gaps, G, { strands: false }, job.stat);
      if ((++job.k & 31) === 0 && now() - t > budget) break;
    }
    job.ms += now() - t;
    if (job.k < items.length) return true;
    swapBarbs(job.buffers);
    stats.barbMs = +job.ms.toFixed(1);
    job = null;
    return false;
  };
  const rebuild = () => {
    for (const m of ribbons) { group.remove(m); m.geometry.dispose(); }
    ribbons = [];
    const asm = assembleRibbons(parts, gaps, G, { barbs: false });
    let tris = 0, verts = 0;
    for (const [look, buf] of asm.buffers) {
      const geo = buf.geometry();
      if (geo) {
        tris += buf.triangles; verts += buf.vertexCount;
        const m = wireMesh(geo, wireMaterial(look, { snow }), `wire:strands:${look}`);
        const sh = wireMesh(geo, wireShadowMaterial(opts.night ? 0.12 : snow > 0 ? 0.42 : theater === 'desert' ? 0.62 : 0.4), `wire:shadow:${look}`);
        group.add(m, sh); ribbons.push(m, sh);
      }
      for (const ig of buf.instGeometries(true)) {   // the strands' own snow beads
        const im = wireMesh(ig, wireMaterial(look, { snow, inst: true }), `wire:snow:${look}`);
        group.add(im); ribbons.push(im); tris += ig.instanceCount * 2;
      }
    }
    const pg = panelGeometry(parts.panels, gaps);
    if (pg) { const pm = new THREE.Mesh(pg, chainMaterial()); pm.name = 'wire:chainlink'; pm.receiveShadow = true; pm.userData.aoExclude = true; group.add(pm); ribbons.push(pm); }
    stats = { runs: runs.length, ribbonTris: tris, strandTris: tris, barbs: stats.barbs ?? 0, ribbonVerts: verts, instances: inst.reduce((a, m) => a + m.count, 0), instanceKinds: inst.length,
      panels: parts.panels.length, cuts: asm.cuts, drawCalls: group.children.filter((o) => o.layers.mask & 1).length, barbsPending: true, buildMs: stats.buildMs, ...parts.counts };
    const buffers = new Map();
    job = { k: 0, buffers, stat: { cuts: 0, tails: 0 }, ms: 0, bufOf: (look) => { if (!buffers.has(look)) buffers.set(look, new WireBuffer(G)); return buffers.get(look); } };
    if (!opts.deferBarbs) stepBarbs(); else kick();
  };
  let timer = 0;
  const tick = () => { timer = 0; if (stepBarbs(4)) kick(); };
  function kick() { if (!timer && typeof setTimeout === 'function') timer = setTimeout(tick, 0); }
  rebuild();
  const handle = { group, runs, parts, gaps, rebuild, standing, stepBarbs, finishBarbs: () => stepBarbs(), stopBarbs: () => { clearTimeout(timer); timer = 0; job = null; }, get stats() { return stats; } };
  stats.buildMs = +(now() - t0).toFixed(1);
  return attachRuntime(handle, opts);
}

/**
 * Runtime: cut gaps re-derived from the grid (a sapper's `fence-gap`, or a loaded save: the FENCE cells along a
 * cuttable run that are gone), electric sparks while powered (world.fencePower; cages follow the station power),
 * the sun direction for the ground shadows.
 */
function attachRuntime(h, opts) {
  const world = opts.world || null, grid = opts.grid || world?.grid || null;
  // sample the cuttable runs every 0.25 m: the cells that start as FENCE
  const samples = [];
  if (grid) for (const r of h.runs) {
    if (!r.cut) continue;
    for (let d = 0.05; d < r.run.length; d += 0.25) {
      const a = r.run.at(d), c = grid.worldToCell(a.x, a.z);
      if (c.i < 0 || c.j < 0 || c.i >= grid.cols || c.j >= grid.rows) continue;
      const k = grid.idx(c.i, c.j);
      if (grid.block[k] === 3) samples.push({ key: r.key, d, k });
    }
  }
  let ver = grid?.version ?? 0;
  h.scanGaps = () => {
    const found = new Map();
    for (const s of samples) if (grid.block[s.k] !== 3) {
      const list = found.get(s.key) || [];
      const last = list[list.length - 1];
      if (last && s.d - last[1] < 0.6) last[1] = s.d + 0.2; else list.push([s.d - 0.2, s.d + 0.2]);
      found.set(s.key, list);
    }
    const sig = (m) => JSON.stringify([...m].sort());
    if (sig(found) === sig(h.gaps)) return false;
    h.gaps.clear();
    for (const [k, v] of found) h.gaps.set(k, v);
    h.rebuild();
    return true;
  };
  const off = world?.events?.on?.('structure:destroyed', (e) => { if (e?.type === 'fence-gap') h.scanGaps(); });
  // sparks: per structure id, a rate (bursts / s) and its spark points
  const byId = new Map();
  for (const s of h.parts.sparks) { if (!byId.has(s.id)) byId.set(s.id, []); byId.get(s.id).push(s); }
  const rates = new Map();
  for (const r of h.runs) if (byId.has(r.def.id)) rates.set(r.def.id, (rates.get(r.def.id) || 0) + (r.def.variant === 'square' ? 3 / 60 : r.run.length / 50 / 3));
  const powered = (id) => {
    const fp = world?.fencePower;
    if (fp?.has(id)) return !!fp.get(id);
    if (fp && fp.size) return [...fp.values()].some(Boolean);   // transformer cages follow the station power
    return true;
  };
  let simT = world?.time ?? 0, sparkClock = 0;
  const rnd = wireRng(77);
  h.sparksSpawned = 0;
  h.isPowered = powered;
  h.update = (dt = 0) => {
    h.stepBarbs?.(3);
    if (opts.sunDir) WIRE_UNIFORMS.uSunDir.value.copy(opts.sunDir);
    if (grid && grid.version !== ver) { ver = grid.version; h.scanGaps(); }
    const t = world?.time ?? simT + dt, step = Math.max(0, Math.min(0.5, t - simT));
    simT = t;
    if (!step || !world?.fx?.spawn) return;
    sparkClock += step;
    for (const [id, rate] of rates) {
      if (!powered(id)) continue;
      if (rnd() < rate * step) {
        const pts = byId.get(id), p = pts[Math.floor(rnd() * pts.length)];
        world.fx.spawn('sparks', p.x, p.z, { y: p.y });
        h.sparksSpawned++;
      }
    }
  };
  h.dispose = () => {
    off?.(); h.stopBarbs?.();
    h.group.parent?.remove(h.group);
    h.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
  };
  return h;
}

/**
 * Map-builder entry (one hook line): the mission's wire layer on the finished terrain, added under `propsRoot`
 * (before coverPropsWithSnow, so posts and frames take the shared prop snow; the ribbons draw their own).
 * o: {terrain, theater, mission, world, renderer, material, night}
 */
export function buildMissionWire(propsRoot, o = {}) {
  try {
    // snow beads: full in winter theaters; a frost palette (M18 rimed grass) puts hoarfrost on the strands
    const snow = o.theater === 'snow' ? 1 : (o.mission?.lighting?.snow ?? (o.mission?.groundPalette === 'frost' ? 0.35 : 0));
    const layer = buildWireLayer(propsRoot, {
      groundAt: o.terrain?.heightAt || (() => 0), theater: o.theater, snow, world: o.world, grid: o.world?.grid,
      missionId: o.mission?.id, sunDir: o.renderer?.sunDir || null, material: o.material, night: !!o.night, deferBarbs: o.deferBarbs ?? true,
    });
    if (layer) propsRoot.add(layer.group);
    return layer;
  } catch (e) {
    console.error('[wire] build failed', e);
    return null;
  }
}
