/**
 * The rear strap curtain of a canvas-covered lorry (user request 2026-10-07: "In the tailgate or the truck can we make
 * the stripes slide sideways as commandos enter the truck from behind"). The Opel Blitz cargo's canvas is rolled up
 * over the rear opening and five leather straps hang from the roll across it — the "stripes" seen from behind (2 cm
 * wide, 1 cm thick, 0.9 m long). They were one static mesh; now each strap is a short chain (STRAP_K.seg links,
 * Verlet, inextensible, a little bending stiffness) pinned under the roll:
 *  - a man climbing in or out over the tailgate (art/vehicle-crew.js bay figures) PARTS them: every link his body
 *    (capsules along his bones, `bodyCapsules`) would pass through slides SIDEWAYS out of it — the whole strap to the
 *    side of him it hangs on, the links above and below bending round him — and is dragged a little along with him;
 *    straps meeting stack side by side or slide one in front of the other (never through one another), the outer
 *    ones stop at the canvas walls;
 *  - when he has passed they fall back and swing to rest (damped, settled in ~2 s); each man of a file parts them
 *    again;
 *  - the pins ride on the canvas roll (cloth-wind.js `canvasEval`, the CPU twin of the cover's vertex shader: the
 *    straps never come off the hem as it billows), the chain feels gravity in the hull's frame (pitch / roll), the
 *    hull's acceleration and the relative air.
 * The chain is simulated in the vehicle model's own frame (metres, +z = front), so the straps ride with the hull and
 * a teleport / load never stretches them. Pure state + step functions (node-tested: tests/unit/strap-curtain.test.mjs);
 * the mesh is rewritten from the chain when it is drawn after a change.
 * @module art/strap-curtain
 */
import * as THREE from 'three';
import { canvasEval, canvasUniforms, canvasStateOf } from './cloth-wind.js';

/** Tunables. */
export const STRAP_K = Object.freeze({
  seg: 10,        // links per strap
  iters: 8,       // constraint passes per substep
  maxDt: 1 / 60,  // longest substep (s)
  damp: 3.0,      // velocity damping (1/s): a parted strap swings back past rest once or twice and settles in ~2 s
  bend: 0.5,      // bending stiffness (share of the straightening correction per pass)
  drag: 0.1,      // relative air → acceleration (1/s): ~5° of lean in a 8 m/s wind
  pad: 0.016,     // half the strap's width + clearance kept from a body (m)
  gap: 0.024,     // closest two straps' links come across the opening (m): they stack or slide past, never through
  carry: 0.15,    // share of a touching body's own motion in / out of the opening the strap is dragged along with
  wall: 0.025,    // clearance from the canvas side walls (m)
  swing: 0.7,     // furthest a link may swing in / out of the opening (m, model z)
  forget: 0.12,   // a strap untouched this long (s) picks its side afresh (from where it hangs then) at the next touch
  kick: 0.15,     // share of a push (by a body, a neighbour) kept as the strap's own speed: it is carried aside, not flung
});

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/**
 * Fresh curtain: the straps hanging straight down from their pins.
 * @param {{x:number,y:number,z:number,len:number,w?:number,t?:number}[]} defs strap pins (model frame: top centre) + length
 * @param {{half?:number}} [o] half-width of the opening between the canvas walls (m)
 */
export function curtainState(defs, o = {}) {
  const K = STRAP_K, n = K.seg + 1;
  const straps = defs.slice().sort((a, b) => a.x - b.x).map((d, i) => {
    const P = new Float64Array(n * 3);
    for (let k = 0; k < n; k++) { P[k * 3] = d.x; P[k * 3 + 1] = d.y - (d.len * k) / K.seg; P[k * 3 + 2] = d.z; }
    return { x: d.x, y: d.y, z: d.z, len: d.len, w: d.w ?? 0.02, t: d.t ?? 0.01, i, P, Q: P.slice(), l: d.len / K.seg, side: 0, idle: 9, held: new Uint8Array(n) };
  });
  return { straps, half: o.half ?? 1.1, bodies: [], prevBodies: null, time: 0, version: 0 };
}

/**
 * Advance the curtain by dt s. env (model frame): g gravity [3] (default straight down), acc the hull's acceleration
 * [3], air the relative air [3] (m/s), pins per-strap pin offsets [[dx,dy,dz]…] (the canvas roll's displacement),
 * gust 0..1 modulation phase source `ph` (the canvas phases) for a slow flutter.
 */
export function curtainStep(C, dt, env = {}) {
  let left = Math.min(Math.max(dt, 0), 0.1); // a long frame (a tab coming back) does not fling them
  while (left > 1e-6) {
    const h = Math.min(STRAP_K.maxDt, left);
    left -= h;
    substep(C, h, env);
  }
  for (const s of C.straps) s.idle += dt;
  C.time += dt;
  C.version++;
}

function substep(C, h, env) {
  const K = STRAP_K, n = K.seg + 1;
  const g = env.g || [0, -9.81, 0], a = env.acc || [0, 0, 0], air = env.air || [0, 0, 0], ph = env.ph || null;
  const damp = Math.exp(-K.damp * h), h2 = h * h;
  for (const s of C.straps) {
    const P = s.P, Q = s.Q, pin = env.pins?.[s.i];
    // a slow gust flutter along the curtain (the canvas's own phases, offset per strap)
    const fl = ph ? 1 + 0.35 * Math.sin(ph[3] + s.x * 3.1) + 0.15 * Math.sin(ph[1] * 1.7 + s.x * 5.3) : 1;
    for (let k = 1; k < n; k++) {
      const j = k * 3, wk = k / K.seg; // the air acts more on the free end
      for (let c = 0; c < 3; c++) {
        const v = P[j + c] - Q[j + c];
        const f = g[c] - a[c] + K.drag * air[c] * fl * (0.5 + 0.5 * wk);
        Q[j + c] = P[j + c];
        P[j + c] += v * damp + f * h2;
      }
    }
    P[0] = s.x + (pin?.[0] || 0); P[1] = s.y + (pin?.[1] || 0); P[2] = s.z + (pin?.[2] || 0);
    Q[0] = P[0]; Q[1] = P[1]; Q[2] = P[2];
  }
  constrain(C, K.iters);
}

/** Inextensible links + bending (the pin holds node 0). */
function chain(s) {
  const K = STRAP_K, P = s.P, n = K.seg + 1, l = s.l;
  for (let k = 1; k < n; k++) {
    const i = (k - 1) * 3, j = k * 3;
    const dx = P[j] - P[i], dy = P[j + 1] - P[i + 1], dz = P[j + 2] - P[i + 2], d = Math.hypot(dx, dy, dz) || 1e-9;
    const e = (d - l) / d;
    if (k === 1) { P[j] -= dx * e; P[j + 1] -= dy * e; P[j + 2] -= dz * e; continue; }
    const hx = dx * e * 0.5, hy = dy * e * 0.5, hz = dz * e * 0.5;
    P[i] += hx; P[i + 1] += hy; P[i + 2] += hz; P[j] -= hx; P[j + 1] -= hy; P[j + 2] -= hz;
  }
  // bending: each link joint drawn onto the line of its neighbours (stiff leather, not a rope), the pair moved the
  // other way so the strap as a whole keeps its swing; the pin does not move
  for (let k = 1; k < n - 1; k++) {
    const i = (k - 1) * 3, c = k * 3, j = (k + 1) * 3, pin = k === 1;
    for (let q = 0; q < 3; q++) {
      const d = ((P[i + q] + P[j + q]) / 2 - P[c + q]) * K.bend;
      if (pin) { P[c + q] += d * 0.8; P[j + q] -= d * 0.4; } else { P[c + q] += d * (2 / 3); P[i + q] -= d / 3; P[j + q] -= d / 3; }
    }
  }
}

/**
 * Straps never pass through one another: per link level, every two straps' links are kept a strap's width apart in
 * the plane across the opening (x, z) — side by side they stack (gathered at the side), one a little in front of the
 * other they slide past. A link a body holds stays put: the other gives way. Mostly inelastic (STRAP_K.kick).
 */
function neighbours(C) {
  const K = STRAP_K, S = C.straps, n = K.seg + 1, keep = 1 - K.kick, g2 = K.gap * K.gap;
  for (let k = 1; k < n; k++) {
    const j = k * 3;
    for (let a = 0; a < S.length; a++) for (let b = a + 1; b < S.length; b++) {
      const A = S[a].P, B = S[b].P;
      let dx = B[j] - A[j], dz = B[j + 2] - A[j + 2];
      const d2 = dx * dx + dz * dz;
      if (d2 >= g2) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-6) { dx = 1; dz = 0; d = 1; } // coincident: by their order across the opening
      const ha = S[a].held[k], hb = S[b].held[k];
      if (ha && hb) { // both pressed against him: one slides in front of the other (along z), both stay against him
        const dz2 = Math.sqrt(Math.max(0, g2 - dx * dx)), sz = (dz !== 0 ? Math.sign(dz) : (a + b) % 2 ? 1 : -1), cz = (dz2 - Math.abs(dz)) / 2;
        A[j + 2] -= sz * cz; B[j + 2] += sz * cz;
        S[a].Q[j + 2] -= sz * cz * keep; S[b].Q[j + 2] += sz * cz * keep;
        continue;
      }
      const fix = K.gap - (d < 1e-6 ? 0 : d), ux = dx / d, uz = dz / d;
      const wa = ha && !hb ? 0 : hb && !ha ? 1 : 0.5;
      A[j] -= ux * fix * wa; A[j + 2] -= uz * fix * wa; B[j] += ux * fix * (1 - wa); B[j + 2] += uz * fix * (1 - wa);
      S[a].Q[j] -= ux * fix * wa * keep; S[a].Q[j + 2] -= uz * fix * wa * keep;
      S[b].Q[j] += ux * fix * (1 - wa) * keep; S[b].Q[j + 2] += uz * fix * (1 - wa) * keep;
    }
  }
}

/** The canvas walls and how far a link may swing in or out of the opening. */
function walls(C) {
  const K = STRAP_K, lim = C.half - K.wall, n = K.seg + 1;
  for (const s of C.straps) {
    const P = s.P;
    for (let k = 1; k < n; k++) {
      const j = k * 3;
      if (Math.abs(P[j]) > lim) { P[j] = clamp(P[j], -lim, lim); s.Q[j] = P[j]; } // against the canvas: stops there
      P[j + 1] = Math.min(P[j + 1], P[1] - 0.01 * k); // never flipped up over the roll it hangs from
      P[j + 2] = clamp(P[j + 2], s.z - K.swing, s.z + K.swing);
    }
  }
}

/**
 * Extent along x of capsule `c` ({a:[3], b:[3], r}) on the line through (y, z) parallel to x, grown by `pad`, or
 * null when the line misses it. Sampled along the axis (convex: the hull of the samples' chords).
 */
function capsuleSpan(c, y, z, pad, out) {
  const R = c.r + pad, R2 = R * R, A = c.a, B = c.b;
  const dy = B[1] - A[1], dz = B[2] - A[2];
  // nearest axis parameter in the yz plane, plus a fixed sampling of the axis
  const L2 = dy * dy + dz * dz;
  const t0 = L2 > 1e-12 ? clamp(((y - A[1]) * dy + (z - A[2]) * dz) / L2, 0, 1) : 0.5;
  let lo = Infinity, hi = -Infinity;
  for (let q = -1; q <= 8; q++) {
    const t = q < 0 ? t0 : q / 8;
    const py = A[1] + dy * t - y, pz = A[2] + dz * t - z, d2 = py * py + pz * pz;
    if (d2 >= R2) continue;
    const cx = A[0] + (B[0] - A[0]) * t, h = Math.sqrt(R2 - d2);
    if (cx - h < lo) lo = cx - h;
    if (cx + h > hi) hi = cx + h;
  }
  if (lo > hi) return null;
  out[0] = lo; out[1] = hi;
  return out;
}

const _span = [0, 0];
const SPREAD = [[-1, 0.55], [1, 0.55], [-2, 0.2], [2, 0.2]];
/** Slide every link out of the bodies, sideways, to its strap's side. @returns {number} links moved */
function bodies(C, spread = true) {
  const K = STRAP_K, B = C.bodies, n = K.seg + 1;
  if (!B.length) return 0;
  let moved = 0;
  for (const s of C.straps) {
    const P = s.P;
    // sweeps over the strap until no link is inside anyone (a link pushed out of one capsule, or carried along by its
    // neighbour, may land in another: always toward the strap's side, so it ends)
    for (let sweep = 0; sweep < 8; sweep++) {
      let hit = false;
      for (let k = 1; k < n; k++) {
        const j = k * 3;
        for (const c of B) {
          if (!capsuleSpan(c, P[j + 1], P[j + 2], K.pad, _span)) continue;
          const x = P[j];
          if (x <= _span[0] || x >= _span[1]) continue;
          if (!s.side) s.side = pickSide(C, s);
          const to = s.side > 0 ? _span[1] : _span[0]; // the whole strap out on one side of him
          const dx = to - x;
          s.Q[j] += dx * (1 - K.kick); // carried aside with the body, not flung
          P[j] = to;
          // the links above and below go along part of the way (the strap bends round him, no kink)
          if (spread) for (const [o, w] of SPREAD) {
            const q = k + o;
            if (q < 1 || q > K.seg) continue;
            const jj = q * 3, want = P[jj] + dx * w;
            if (s.side > 0 ? want > P[jj] : want < P[jj]) { s.Q[jj] += (want - P[jj]) * (1 - K.kick); P[jj] = want; }
          }
          s.held[k] = 1; s.idle = 0; hit = true; moved++;
        }
      }
      if (!hit) break;
    }
  }
  return moved;
}

/**
 * Which way a strap goes round the man: to the side of him it hangs on (the man's core x = the first body capsule's
 * mid x). Monotone across the curtain, so two straps never have to pass each other.
 */
function pickSide(C, s) {
  let c = null, best = Infinity;
  for (const q of C.bodies) if (q.core) { const dz = Math.abs((q.a[2] + q.b[2]) / 2 - s.z); if (dz < best) { best = dz; c = q; } }
  c ||= C.bodies[0];
  let mx = 0; for (let k = 1; k <= STRAP_K.seg; k++) mx += s.P[k * 3];
  const cx = c ? (c.a[0] + c.b[0]) / 2 : 0, d = mx / STRAP_K.seg - cx; // where it hangs now (a swing may have taken it round)
  if (Math.abs(d) > 0.05) return Math.sign(d);
  // the strap in front of him: the side with more room (fewer straps there), else his left (+x)
  const S = C.straps, left = S.filter((q) => q.x > s.x).length, right = S.filter((q) => q.x < s.x).length;
  return left < right ? 1 : left > right ? -1 : d < -0.005 ? -1 : 1;
}

/** Exact link lengths, from the pin down (follow the leader): the leather never stretches under its own weight. */
function lengths(s) {
  const P = s.P, n = STRAP_K.seg + 1, l = s.l;
  for (let k = 1; k < n; k++) {
    const i = (k - 1) * 3, j = k * 3;
    const dx = P[j] - P[i], dy = P[j + 1] - P[i + 1], dz = P[j + 2] - P[i + 2], d = Math.hypot(dx, dy, dz) || 1e-9, e = l / d;
    P[j] = P[i] + dx * e; P[j + 1] = P[i + 1] + dy * e; P[j + 2] = P[i + 2] + dz * e;
  }
}

function constrain(C, iters) {
  for (const s of C.straps) s.held.fill(0);
  for (let it = 0; it < iters; it++) {
    for (const s of C.straps) chain(s);
    neighbours(C);
    walls(C);
    bodies(C);
  }
  // last exact passes: lengths from the pin down, then the bodies and the walls again (they have the last word)
  for (let it = 0; it < 4; it++) {
    for (const s of C.straps) lengths(s);
    walls(C);
    neighbours(C);
    bodies(C, false);
  }
  // a strap free of every body picks its side afresh at the next touch, from where it hangs then
  for (const s of C.straps) if (s.idle > STRAP_K.forget) s.side = 0;
}

/**
 * The men passing through the opening this frame (capsules in the model frame, the man's core first): they part the
 * straps at once (no link inside a body on the frame drawn) and drag the links they touch a little along.
 * @param {{a:number[],b:number[],r:number,id?:string}[]} caps
 */
export function curtainPush(C, caps) {
  const prev = C.prevBodies;
  C.bodies = near(C, caps || []);
  C.prevBodies = C.bodies.map((c) => ({ id: c.id, a: c.a.slice(), b: c.b.slice() }));
  if (!C.bodies.length) return 0;
  // drag along (front / back, up / down) by the body's own motion since the last push, where it touches
  if (prev?.length) {
    const K = STRAP_K, n = K.seg + 1;
    for (const s of C.straps) for (let k = 1; k < n; k++) {
      const j = k * 3;
      for (const c of C.bodies) {
        if (!capsuleSpan(c, s.P[j + 1], s.P[j + 2], K.pad + 0.01, _span) || s.P[j] < _span[0] - 0.01 || s.P[j] > _span[1] + 0.01) continue;
        const p = c.id != null ? prev.find((q) => q.id === c.id) : null;
        if (!p) continue;
        const mz = ((c.a[2] + c.b[2]) - (p.a[2] + p.b[2])) / 2;
        if (Math.abs(mz) > 0.3) continue; // a jump (load, new figure): no drag
        s.P[j + 2] += mz * K.carry;
        break;
      }
    }
  }
  constrain(C, STRAP_K.iters);
  C.version++;
  return C.bodies.length;
}

/** The capsules that can reach a strap this frame (box round the links, grown by the swing a frame can bring). */
function near(C, caps) {
  if (!caps.length) return caps;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of C.straps) for (let j = 0; j < s.P.length; j += 3) {
    const x = s.P[j], y = s.P[j + 1], z = s.P[j + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const g = 0.25 + STRAP_K.pad;
  return caps.filter((c) => {
    const r = c.r + g;
    return Math.min(c.a[0], c.b[0]) - r < x1 && Math.max(c.a[0], c.b[0]) + r > x0 && Math.min(c.a[1], c.b[1]) - r < y1
      && Math.max(c.a[1], c.b[1]) + r > y0 && Math.min(c.a[2], c.b[2]) - r < z1 && Math.max(c.a[2], c.b[2]) + r > z0;
  });
}

/** Deepest any link sits inside any body (m, ≤ 0 = clear): tests. */
export function curtainPenetration(C, caps = C.bodies) {
  let worst = -Infinity;
  const n = STRAP_K.seg + 1;
  for (const s of C.straps) for (let k = 1; k < n; k++) {
    const j = k * 3;
    for (const c of caps) {
      if (!capsuleSpan(c, s.P[j + 1], s.P[j + 2], 0, _span)) continue;
      const x = s.P[j];
      worst = Math.max(worst, Math.min(x - _span[0], _span[1] - x));
    }
  }
  return worst === -Infinity ? 0 : worst;
}

/** Sideways offset of strap i's free end from where it hangs at rest (m, model x). */
export const strapOffset = (C, i, k = STRAP_K.seg) => C.straps[i].P[k * 3] - C.straps[i].x;

/** Speed of the fastest link over the last substep (m/s): settled when tiny. */
export function curtainMotion(C) {
  let m = 0;
  for (const s of C.straps) for (let j = 3; j < s.P.length; j += 3) m = Math.max(m, Math.hypot(s.P[j] - s.Q[j], s.P[j + 1] - s.Q[j + 1], s.P[j + 2] - s.Q[j + 2]));
  return m / STRAP_K.maxDt;
}

// ------------------------------------------------------------------ the mesh

/**
 * Ribbon mesh of a curtain: per strap a box section (width w along the strap's sideways axis, thickness t) per chain
 * node, flat-shaded faces (8 vertices per ring) and a cap at the free end.
 */
export function curtainGeometry(C) {
  const n = STRAP_K.seg + 1, per = n * 8 + 4, S = C.straps.length;
  const pos = new Float32Array(S * per * 3), nor = new Float32Array(S * per * 3), uv = new Float32Array(S * per * 2), idx = [];
  C.straps.forEach((s, si) => {
    const b = si * per;
    for (let k = 0; k < n; k++) for (let f = 0; f < 4; f++) for (let e = 0; e < 2; e++) {
      const v = b + k * 8 + f * 2 + e;
      uv[v * 2] = (f + e) / 4; uv[v * 2 + 1] = (k / STRAP_K.seg) * s.len;
    }
    for (let k = 0; k + 1 < n; k++) for (let f = 0; f < 4; f++) {
      const a0 = b + k * 8 + f * 2, a1 = a0 + 1, c0 = a0 + 8, c1 = a1 + 8;
      idx.push(a0, c0, a1, a1, c0, c1);
    }
    const cap = b + n * 8;
    idx.push(cap, cap + 2, cap + 1, cap, cap + 3, cap + 2);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  writeCurtain(C, g);
  return g;
}

const _T = new THREE.Vector3(), _W = new THREE.Vector3(), _N = new THREE.Vector3(), _Z = new THREE.Vector3(0, 0, 1);
/** Rewrite the ribbon from the chain. */
export function writeCurtain(C, g) {
  const n = STRAP_K.seg + 1, per = n * 8 + 4, pos = g.attributes.position.array, nor = g.attributes.normal.array;
  // faces: 0 back (−N), 1 side (+W), 2 front (+N), 3 side (−W); corners (±W, ±N) going round
  const CW = [-1, 1, 1, -1, -1], CN = [-1, -1, 1, 1, -1];
  const FW = [0, 1, 0, -1], FN = [-1, 0, 1, 0];
  C.straps.forEach((s, si) => {
    const P = s.P, b = si * per, hw = s.w / 2, ht = s.t / 2;
    for (let k = 0; k < n; k++) {
      const i0 = Math.max(0, k - 1) * 3, i1 = Math.min(n - 1, k + 1) * 3;
      _T.set(P[i1] - P[i0], P[i1 + 1] - P[i0 + 1], P[i1 + 2] - P[i0 + 2]).normalize(); // along the strap (down)
      _W.crossVectors(_T, _Z); if (_W.lengthSq() < 1e-8) _W.set(1, 0, 0); _W.normalize();
      if (_W.x < 0) _W.negate();                                                        // sideways (≈ +x)
      _N.crossVectors(_W, _T).normalize();                                              // thickness (≈ ±z)
      if (_N.z < 0) _N.negate();
      const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
      for (let f = 0; f < 4; f++) for (let e = 0; e < 2; e++) {
        const c = f + e, v = (b + k * 8 + f * 2 + e) * 3;
        pos[v] = x + _W.x * hw * CW[c] + _N.x * ht * CN[c];
        pos[v + 1] = y + _W.y * hw * CW[c] + _N.y * ht * CN[c];
        pos[v + 2] = z + _W.z * hw * CW[c] + _N.z * ht * CN[c];
        nor[v] = _W.x * FW[f] + _N.x * FN[f]; nor[v + 1] = _W.y * FW[f] + _N.y * FN[f]; nor[v + 2] = _W.z * FW[f] + _N.z * FN[f];
      }
      if (k === n - 1) for (let c = 0; c < 4; c++) { // the cut end
        const v = (b + n * 8 + c) * 3;
        pos[v] = x + _W.x * hw * CW[c] + _N.x * ht * CN[c];
        pos[v + 1] = y + _W.y * hw * CW[c] + _N.y * ht * CN[c];
        pos[v + 2] = z + _W.z * hw * CW[c] + _N.z * ht * CN[c];
        nor[v] = _T.x; nor[v + 1] = _T.y; nor[v + 2] = _T.z;
      }
    }
  });
  g.attributes.position.needsUpdate = true;
  g.attributes.normal.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ on a vehicle model

/**
 * Straps hanging in the rear opening of a canvas cover: thin vertical pieces (≤ 8 cm wide, ≤ 5 cm deep, ≥ 0.3 m
 * long) whose top is under the cover's rear end. Every mesh made only of such pieces is a strap mesh (one per LOD).
 * @param {object} inst the vehicle instance root (model frame) @param {object} cover the cover mesh (LOD0)
 * @returns {{meshes:object[], defs:object[], material:object, half:number}|null}
 */
export function findRearStraps(inst, cover) {
  inst.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(inst.matrixWorld).invert(), M = new THREE.Matrix4(), v = new THREE.Vector3();
  const cb = new THREE.Box3();
  { const g = cover.geometry; if (!g.boundingBox) g.computeBoundingBox(); cb.copy(g.boundingBox).applyMatrix4(M.multiplyMatrices(inv, cover.matrixWorld)); }
  const meshes = [];
  let best = null;
  inst.traverse((o) => {
    if (!o.isMesh || o === cover || o.geometry.attributes.aFlap) return;
    const g = o.geometry, P = g.attributes.position;
    if (!P || P.count > 4000) return;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox.clone().applyMatrix4(M.multiplyMatrices(inv, o.matrixWorld));
    if (bb.max.z > cb.min.z + 0.3 || bb.min.z < cb.min.z - 0.1 || bb.max.y < cb.min.y + 0.3 || bb.max.y - bb.min.y < 0.3) return;
    // pieces: vertices welded by position, joined by triangles
    const X = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(M); X[i * 3] = v.x; X[i * 3 + 1] = v.y; X[i * 3 + 2] = v.z; }
    const par = new Int32Array(P.count).map((_, i) => i), find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    const join = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
    const key = new Map();
    for (let i = 0; i < P.count; i++) { const k = `${Math.round(X[i * 3] * 1000)},${Math.round(X[i * 3 + 1] * 1000)},${Math.round(X[i * 3 + 2] * 1000)}`; if (key.has(k)) join(i, key.get(k)); else key.set(k, i); }
    const I = g.index ? g.index.array : null, nt = I ? I.length : P.count;
    for (let t = 0; t < nt; t += 3) { const a = I ? I[t] : t; join(a, I ? I[t + 1] : t + 1); join(a, I ? I[t + 2] : t + 2); }
    const comp = new Map();
    for (let i = 0; i < P.count; i++) {
      const r = find(i);
      let c = comp.get(r);
      if (!c) comp.set(r, (c = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] }));
      for (let q = 0; q < 3; q++) { c.lo[q] = Math.min(c.lo[q], X[i * 3 + q]); c.hi[q] = Math.max(c.hi[q], X[i * 3 + q]); }
    }
    const defs = [];
    for (const c of comp.values()) {
      const w = c.hi[0] - c.lo[0], h = c.hi[1] - c.lo[1], t = c.hi[2] - c.lo[2], x = (c.lo[0] + c.hi[0]) / 2;
      const strap = w <= 0.08 && t <= 0.05 && h >= 0.3 && x > cb.min.x && x < cb.max.x && c.hi[2] < cb.min.z + 0.3 && c.lo[2] > cb.min.z - 0.1 && c.hi[1] > cb.min.y + 0.4;
      if (!strap) return; // a mesh with anything else in it is not a strap mesh
      defs.push({ x, y: c.hi[1], z: (c.lo[2] + c.hi[2]) / 2, len: h, w: Math.max(w, 0.004), t: Math.max(t, 0.004) });
    }
    if (!defs.length) return;
    meshes.push(o);
    if (!best || P.count > best.n) best = { n: P.count, defs, mesh: o };
  });
  if (!best) return null;
  best.defs.sort((a, b) => a.x - b.x);
  return { meshes, defs: best.defs, material: best.mesh.material, cast: best.mesh.castShadow, receive: best.mesh.receiveShadow, half: Math.max(0.3, (cb.max.x - cb.min.x) / 2), coverBox: cb };
}

/**
 * Live strap curtain on a vehicle instance: hides the static straps (every LOD) and draws the chain instead.
 * @param {object} inst vehicle instance root (model frame) @param {object} cover the LOD0 canvas cover mesh
 * @returns {object|null} {state, mesh, step(dt, env), push(capsules), dispose()}
 */
export function createStrapCurtain(inst, cover) {
  const found = findRearStraps(inst, cover);
  if (!found) return null;
  const C = curtainState(found.defs, { half: found.half - 0.035 });
  const geo = curtainGeometry(C);
  const mesh = new THREE.Mesh(geo, found.material);
  mesh.name = 'strap_curtain';
  mesh.castShadow = !!found.cast; mesh.receiveShadow = !!found.receive;
  mesh.frustumCulled = true;
  for (const m of found.meshes) m.visible = false;
  inst.add(mesh);
  let drawn = -1;
  mesh.onBeforeRender = () => { if (drawn !== C.version) { writeCurtain(C, geo); drawn = C.version; } };
  // the pins ride on the canvas roll: the cover vertex nearest each pin, its displacement from the CPU twin
  inst.updateMatrixWorld(true);
  const toInst = new THREE.Matrix4().copy(inst.matrixWorld).invert().multiply(cover.matrixWorld);
  const A = cover.geometry.attributes, pinV = C.straps.map((s) => {
    if (!A.aFlapDir) return -1;
    let bi = -1, bd = 0.12 * 0.12;
    const p = new THREE.Vector3();
    for (let i = 0; i < A.position.count; i++) {
      p.fromBufferAttribute(A.position, i).applyMatrix4(toInst);
      const d = (p.x - s.x) ** 2 + (p.y - s.y) ** 2 + (p.z - s.z) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  });
  const lin = new THREE.Matrix3().setFromMatrix4(toInst), U = { air: new Float32Array(4), k: new Float32Array(4), ph: new Float32Array(4) };
  const pins = C.straps.map(() => [0, 0, 0]), dv = new THREE.Vector3();
  const pinOffsets = () => {
    const cs = canvasStateOf(cover);
    if (!cs) return null;
    canvasUniforms(cs, cover.matrixWorld.elements, U.air, U.k, U.ph);
    pinV.forEach((i, si) => {
      if (i < 0) return;
      const { D } = canvasEval([A.aFlapP.getX(i), A.aFlapP.getY(i), A.aFlapP.getZ(i)], [A.aFlapDir.getX(i), A.aFlapDir.getY(i), A.aFlapDir.getZ(i)],
        A.aFlap.getX(i), [A.aFlapG.getX(i), A.aFlapG.getY(i), A.aFlapG.getZ(i)], U);
      dv.set(A.aFlapDir.getX(i), A.aFlapDir.getY(i), A.aFlapDir.getZ(i)).multiplyScalar(D * A.aFlapP.getW(i)).applyMatrix3(lin);
      pins[si][0] = dv.x; pins[si][1] = dv.y; pins[si][2] = dv.z;
    });
    return pins;
  };
  const g = new THREE.Vector3(), q = new THREE.Quaternion(), air = new THREE.Vector3();
  return {
    state: C, mesh, found,
    /**
     * One sim step: gravity in the hull's frame, its acceleration (model frame: x left, z forward), the relative air
     * (the canvas's low-passed air, world → model frame) and the roll's own motion at the pins.
     */
    step(dt, o = {}) {
      inst.updateWorldMatrix(true, false);
      inst.getWorldQuaternion(q).invert();
      g.set(0, -9.81, 0).applyQuaternion(q);
      const cs = canvasStateOf(cover);
      if (cs) air.set(cs.ax, 0, cs.az).applyQuaternion(q); else air.set(0, 0, 0);
      curtainStep(C, dt, { g: [g.x, g.y, g.z], acc: o.acc || [0, 0, 0], air: [air.x, air.y, air.z], pins: pinOffsets(), ph: cs?.ph });
    },
    /** Bodies in the opening this frame: capsules in the model frame. */
    push(caps) { return curtainPush(C, caps); },
    dispose() { mesh.removeFromParent(); geo.dispose(); for (const m of found.meshes) m.visible = true; },
  };
}

// ------------------------------------------------------------------ bodies

/** Capsules along a character's bones: [from, to, radius (m)]; the core (pelvis → chest) first. */
export const BODY_CAPS = Object.freeze([
  ['pelvis', 'spine_03', 0.15], ['spine_03', 'neck_01', 0.15], ['upperarm_l', 'upperarm_r', 0.08], ['neck_01', 'head', 0.06], ['head', 'head', 0.115],
  ['upperarm_l', 'lowerarm_l', 0.06], ['lowerarm_l', 'hand_l', 0.05], ['hand_l', 'middle_01_l', 0.045],
  ['upperarm_r', 'lowerarm_r', 0.06], ['lowerarm_r', 'hand_r', 0.05], ['hand_r', 'middle_01_r', 0.045],
  ['thigh_l', 'calf_l', 0.085], ['calf_l', 'foot_l', 0.065], ['thigh_r', 'calf_r', 0.085], ['calf_r', 'foot_r', 0.065],
  ['foot_l', 'ball_l', 0.05], ['foot_r', 'ball_r', 0.05],
]);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _inv = new THREE.Matrix4();
/**
 * Capsules of a character model's body in `frame`'s local space (a UnitModel: `real.inner.bones`), appended to `out`.
 * The head capsule is lifted to the crown. @returns {object[]} out
 */
export function bodyCapsules(m, frame, out = [], tag = '') {
  const B = m?.real?.inner?.bones;
  if (!B?.pelvis) return out;
  frame.updateWorldMatrix(true, false);
  _inv.copy(frame.matrixWorld).invert();
  const bone = (n) => B[n] || (n === 'head' ? B.Head : null);
  BODY_CAPS.forEach(([p, q, r], i) => {
    const a = bone(p), b = bone(q);
    if (!a) return;
    a.getWorldPosition(_a).applyMatrix4(_inv);
    if (b && b !== a) b.getWorldPosition(_b).applyMatrix4(_inv); else _b.copy(_a);
    if (p === 'head' && q === 'head') { _a.y += 0.03; _b.y += 0.1; } // the skull above the head joint
    out.push({ a: [_a.x, _a.y, _a.z], b: [_b.x, _b.y, _b.z], r, id: `${tag}:${i}`, core: i === 0 });
  });
  return out;
}
