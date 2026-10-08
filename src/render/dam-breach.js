/**
 * The burst dam (M3, structure `waterFx`; design-spec §7.6). Once the dam is destroyed the raised reservoir pours
 * through the slot blown in dam_arch_destroyed as ONE continuous body of water — a single flow-aligned mesh and a single
 * shader (render/dam-breach-glsl.js), rows across the flow, so every piece meets the next edge to edge, at the same
 * width, with the same streaks running on through it (user: "Make the transition of the waterfall seamlessly cross all
 * segments, they should be aligned"):
 * - the funnel on the reservoir: flow lines converging on the slot's mouth (the lake drawn towards the breach);
 * - the slot, the full width between its cheeks: a fast surface bending down from the reservoir's level to the lip,
 *   torn white round the pier stubs hanging into it;
 * - the column: over the brink and down the broken face, a thick sheet clinging to the face's own profile (plumb, then
 *   battered out to the waterline), with side walls back to the concrete; it curves out at its foot into the pool;
 * - the river: the same surface carried on along the river's centreline, widening to the banks, a churning boil where the
 *   column lands, then a broad current whose foam thins with distance; the flood front runs down it.
 * Speeds (user: "The water on the river looks too fast after the dam explodes. Its not going as fast when falling
 * vertically"): the pattern is advected in travel time from one speed profile — slow on the lake, accelerating through
 * the slot, fastest down the face (free fall, ~5 → ~9.5 m/s), slowing in the boil and down the river (3.4 → 1.2 m/s,
 * `riverSpeed`), so the fall always reads fastest and the river calms with distance.
 * Spray is thrown off the brink, an impact cloud / spray / mist stands where the column lands (render/dam-water-spray.js).
 * The flow's shape follows the reservoir (art/water.js `drains`): just after the blast the water stands almost at full
 * height in the gap (the dam-break "wall") and races to the pool, then the drawdown develops and the reservoir drops
 * RESERVOIR_DRAWDOWN m and holds — a strong steady outflow for good (the lake behind keeps feeding it).
 * Visual only; owned by render/dam-water.js (`createBreach(...)` → {group, start, frame}).
 * @module render/dam-breach
 */
import * as THREE from 'three';
import { FX_LAYER, WATER_LEVEL, RESERVOIR_DRAWDOWN, DRAIN_S } from '../art/water.js';
import { damWaterUniforms, damLight } from './dam-water-mats.js';
import { breachMaterial } from './dam-breach-glsl.js';
import { createDamSpray } from './dam-water-spray.js';

/**
 * The slot blown through dam_arch_destroyed, in the dam frame (u along the crest, v downstream, y world) as the model
 * stands at the M3 dam (elev 7): the cheeks' faces at |u| `hw` from their upstream ends (`vMouth`) to the downstream
 * face (`vLip`); its floor a V down to `yFloor` (under the tailwater); the pier stubs hang into it from the deck down to
 * y ~3.7 (centre: |u| < 0.25, v -1 … 3; sides: |u| 1.75 … 2.25, v 1.5 … 3.1). `vEdge`: where the reservoir's own
 * water surface ends inside the slot — its polygon stops at the upstream face's arc (v -0.97 at u 0), but near a bank
 * the body's mask is the continuous shore field (art/water/bake.js), which runs on over the tailwater cells under the
 * deck: the drawn surface reaches ~1.5 m further (measured on screen). The flow stays on top of it up to there.
 * `rim` / `rimDeg`: the funnel on the reservoir.
 */
export const BREACH = { u0: 0, hw: 2.25, vMouth: -2.2, vLip: 3.1, vEdge: 0.55, yFloor: -2, rim: 11, rimDeg: 75 };
/** Settled drop of the surface from the reservoir to the lip, × the head over the slot's floor. */
export const BREACH_DRAW = 0.2;
/**
 * The dam's downstream face beside the slot: v of the concrete at height y (measured on dam_arch_destroyed at |u| 2.5:
 * plumb under the lip down to y 2.6, then battered out to v ~4.0 at the waterline).
 */
export const faceV = (y) => BREACH.vLip + 0.36 * Math.max(0, 2.6 - y);
/** The river's surface current below the boil (m/s) `d` m down from where the column lands: 3.4 → 1.2, e-folding 12 m. */
export const riverSpeed = (d) => 1.2 + 2.2 * Math.exp(-Math.max(0, d) / 12);
const FRONT_X = 2.2;  // the flood front runs ahead of the surface current (× its speed)
const OFF = 0.05;     // the flow surface over the reservoir's (clear of its ripples)
const OVER = 0.35;    // inside the slot the water runs this far into the cheeks (hidden in the concrete: no seam on a jagged face)
const WALL_T = 2.2;   // the dam-break wall of water settles into the drawdown over ~this (s)
const COLS = 17, NF = 14, NB = 7, NC = 10, NT = 8, NW = 6;
const W_LIP = BREACH.hw + 0.12, W_TOE = BREACH.hw + 0.45; // the column's half width at the lip (= the slot's there) and its foot

const cubic = (p0, p1, p2, p3, t) => { const s = 1 - t; return [0, 1].map((i) => s * s * s * p0[i] + 3 * s * s * t * p1[i] + 3 * s * t * t * p2[i] + t * t * t * p3[i]); };
const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

/**
 * Long profile of the flow for reservoir level `L` (m) and the dam-break wall `w` (1 at the blast → 0 settled), in the
 * dam frame's (v, y) plane: the surface stays at the reservoir's level (+OFF) while the reservoir's own water lies under
 * it, bends down through the slot to `yLip`, goes over the brink and down the face `th(y)` out from the concrete, and
 * curves out at its foot into the pool, meeting its surface at `vLand`. `column` = its rows past the lip ({v, y, f}: f the
 * share of the column's length, 1 at `vLand`).
 */
export function breachProfile(L, w = 0, yW = WATER_LEVEL) {
  const B = BREACH, h = Math.max(0.5, L - B.yFloor);
  const d = BREACH_DRAW * h * (1 - 0.75 * w) + OFF;
  const v0 = B.vEdge + 0.15, run = B.vLip - v0, yTop = L + OFF, yLip = yTop - d;
  const slope = (-1.5 * d) / run;                      // dy/dv where the water leaves the slot
  const vh = Math.sqrt(2.25 + 19.62 * d);              // speed over the lip: the approach (1.5 m/s) + the drop
  const yT = 0.7, yB = Math.max(yLip - 1.1, yT + 0.4);  // the brink ends at yB, the foot's curve starts at yT
  const th = (y) => 0.55 + 0.3 * Math.min(1, Math.max(0, (y - yT) / Math.max(0.4, yB - yT))); // thinning as it speeds up
  const vCol = (y) => faceV(y) + th(y);
  const down = (y) => norm(vCol(y - 0.01) - vCol(y), -0.01);
  const pts = [];
  // over the brink: from the slot's slope round to the face
  const P0 = [B.vLip, yLip], T0 = norm(1, slope), P3 = [vCol(yB), yB], T3 = down(yB), hb = 0.4 * Math.hypot(P3[0] - P0[0], P3[1] - P0[1]);
  for (let k = 1; k <= NB; k++) pts.push(cubic(P0, [P0[0] + T0[0] * hb, P0[1] + T0[1] * hb], [P3[0] - T3[0] * hb, P3[1] - T3[1] * hb], P3, k / NB));
  // down the face
  for (let k = 1; k <= NC; k++) { const y = yB + ((yT - yB) * k) / NC; pts.push([vCol(y), y]); }
  // the foot: curving out into the pool's surface
  const Q0 = [vCol(yT), yT], TQ = down(yT), Q3 = [Q0[0] + 1.4, yW + 0.04], hq = 0.5;
  for (let k = 1; k <= NT; k++) pts.push(cubic(Q0, [Q0[0] + TQ[0] * hq, Q0[1] + TQ[1] * hq], [Q3[0] - hq, Q3[1]], Q3, ((k / NT) ** 0.9)));
  let len = 0; const arc = [0];
  for (let i = 0; i < pts.length; i++) { const p = i ? pts[i - 1] : P0; len += Math.hypot(pts[i][0] - p[0], pts[i][1] - p[1]); arc.push(len); }
  const column = pts.map(([v, y], i) => ({ v, y, f: arc[i + 1] / len, part: i < NB ? 'brink' : i < NB + NC ? 'face' : 'foot' }));
  return {
    L, yTop, yLip, d, v0, run, slope, vh, yB, yT, th, column, len, vLand: Q3[0],
    ySlot: (v) => (v <= v0 ? yTop : yTop - d * Math.min(1, (v - v0) / run) ** 1.5),
    /** the column's surface speed at height y over the brink and the face (free fall from the lip) */
    speedAt: (y) => Math.sqrt(vh * vh + 19.62 * Math.max(0, yLip - y)),
  };
}

/**
 * @param {{x:number, z:number, rot:number}} def the dam's structure def
 * @param {object} fx its `waterFx` (`surge` or `downstream`: the river's centreline below the dam)
 * @param {number} level0 the reservoir's surface before the breach (m)
 */
export function createBreach(def, fx, level0) {
  const yW = WATER_LEVEL, H0 = Math.max(1, level0 - yW), B = BREACH;
  const c = Math.cos(def.rot ?? 0), s = Math.sin(def.rot ?? 0), X = def.x ?? 0, Z = def.z ?? 0;
  const world = (u, v) => [X + u * c - v * s, Z + u * s + v * c];
  const local = (x, z) => [(x - X) * c + (z - Z) * s, -(x - X) * s + (z - Z) * c];
  const [dx, dz] = [-s, c]; // downstream (world xz)
  const group = new THREE.Group();
  group.name = 'dam-breach';
  group.visible = false;
  const amt = { value: 0 }, geos = [], mats = [], sprays = [];
  const levelEnd = Math.max(yW, level0 - RESERVOIR_DRAWDOWN);
  const nominal = breachProfile(levelEnd, 0, yW);

  // the river's centreline below the foot (dam frame): straight on downstream, then the mission's surge line
  const surgeW = (fx.surge || fx.downstream || []).map((q) => local(...(Array.isArray(q) ? q : [q.x, q.z])));
  const riverLine = (vStart) => {
    const pts = [[B.u0, vStart], [B.u0 + 0.1, vStart + 4]];
    for (const p of surgeW) if (p[1] > vStart + 7) pts.push(p);
    if (pts.length < 3) pts.push([B.u0 + 0.2, vStart + 40]);
    return pts;
  };
  const along = (pts, d) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [au, av] = pts[i], [bu, bv] = pts[i + 1], l = Math.hypot(bu - au, bv - av);
      if (d <= l || i + 2 === pts.length) { const t = Math.min(1, d / l); return { u: au + (bu - au) * t, v: av + (bv - av) * t, du: (bu - au) / l, dv: (bv - av) / l }; }
      d -= l;
    }
    return null;
  };
  const lineLen = (pts) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  const riverLen = lineLen(riverLine(nominal.vLand)) - 2;
  const riverD = [];
  for (let d = 0.5; d <= Math.min(12, riverLen); d += 0.5) riverD.push(d);
  for (let d = 13.5, st = 1.5; d <= riverLen; d += st, st = Math.min(3, st * 1.12)) riverD.push(d);
  const hwRiver = (d) => W_TOE + (6.5 - W_TOE) * smooth(0, 12, d) + 2.5 * smooth(12, 60, d); // (the flood spreading to the banks)

  // 1. the flow: one mesh in the dam frame (x = u, y world, z = v), rows across the flow, + the column's side walls
  const flowG = new THREE.Group();
  flowG.position.set(X, 0, Z); flowG.rotation.y = -(def.rot ?? 0);
  const slotV = [];
  for (let v = B.vMouth; v < B.vLip - 0.12; v += 0.25) slotV.push(v);
  slotV.push(B.vLip);
  const nCol = NB + NC + NT, rowsN = NF + slotV.length + nCol + riverD.length, nMain = rowsN * COLS;
  const wallRows = 1 + nCol, nWall = 2 * wallRows * NW, N = nMain + nWall;
  const pos = new Float32Array(N * 3), flow = new Float32Array(N * 2), aux = new Float32Array(N * 4);
  const acr = (k) => (2 * k) / (COLS - 1) - 1;
  const th = (B.rimDeg * Math.PI) / 180;
  const slotHw = (v) => W_LIP + (B.hw + OVER - W_LIP) * (1 - smooth(B.vLip - 0.8, B.vLip, v)); // into the cheeks, then the lip's width
  const colHw = (f) => W_LIP + (W_TOE - W_LIP) * f ** 1.2;
  // funnel rows: from the rim (s 1) to just short of the mouth; each column a streamline from the rim to the mouth
  const funnelUV = (k, sr) => {
    const t = acr(k) * th, e = [acr(k) * (B.hw + OVER), B.vMouth], A = [B.u0 + B.rim * Math.sin(t), B.vMouth - B.rim * Math.cos(t)], f = sr ** 1.6;
    return [e[0] + (A[0] - e[0]) * f, e[1] + (A[1] - e[1]) * f];
  };
  const zSlot = (v) => -1 + (v - B.vMouth) / (B.vLip - B.vMouth);
  let landD = []; // the river rows' distances (for the front)
  /** Lay the vertices out for profile P (positions + the zone coordinate; travel times and speeds are fixed at build). */
  function shape(P) {
    let r = 0;
    // a row across the flow: centre (cu, cv), across (au, av), half width hw, at height y; `bulge` m out along (nv, ny)
    // in the middle (a round sheet), nothing at its edges
    const row = (cu, cv, au, av, hw, y, z, bulge = 0, nv = 0, ny = 1) => {
      for (let k = 0; k < COLS; k++) {
        const q = r * COLS + k, a = acr(k), b = bulge * (1 - a * a);
        pos.set([cu + au * a * hw, y + ny * b, cv + av * a * hw + nv * b], q * 3); aux[q * 4] = z;
      }
      r++;
    };
    for (let i = 0; i < NF; i++) {
      const sr = 1 - i / NF;
      for (let k = 0; k < COLS; k++) { const [u, v] = funnelUV(k, sr), q = r * COLS + k; pos.set([u, P.yTop, v], q * 3); aux[q * 4] = -1 - sr; }
      r++;
    }
    for (const v of slotV) row(B.u0, v, 1, 0, slotHw(v), P.ySlot(v), Math.min(zSlot(v), 0));
    const colRow0 = r;
    P.column.forEach((p, i) => {
      const a = i ? P.column[i - 1] : { v: B.vLip, y: P.yLip }, b = P.column[i + 1] || { v: p.v + (p.v - a.v), y: p.y + (p.y - a.y) };
      const [tv, ty] = norm(b.v - a.v, b.y - a.y); // (the outward normal of the column: (-ty, tv))
      row(B.u0, p.v, 1, 0, colHw(p.f), p.y, p.f, 0.14 * Math.sin(Math.PI * p.f) ** 0.5, -ty, tv);
    });
    const line = riverLine(P.vLand), len = lineLen(line);
    for (const d of riverD) {
      // (the rows turn with the centreline's direction averaged over ±4 m: at a corner of the polyline a row turned at
      // once folded the wide river surface over itself — a straight bright crease across the foam)
      const q = along(line, d), a = along(line, Math.max(0, d - 4)), b = along(line, Math.min(len, d + 4)), [tu, tv] = norm(b.u - a.u, b.v - a.v);
      row(q.u, q.v, tv, -tu, hwRiver(d), yW + 0.04, 1 + d / 20);
    }
    // the column's side walls: from its edges back to the concrete (over the brink and down the face), then straight down
    // into the pool along its foot; they bulge out like a round sheet's flanks
    let qw = nMain;
    for (const sd of [-1, 1]) for (let j = 0; j < wallRows; j++) {
      const cr = j === 0 ? NF + slotV.length - 1 : colRow0 + j - 1, p = j === 0 ? { v: B.vLip, y: P.yLip, f: 0, part: 'brink' } : P.column[j - 1];
      const hw = (j === 0 ? W_LIP : colHw(p.f)) - 0.12, eu = B.u0 + sd * hw; // (just inside the top's frayed edge)
      const foot = p.part === 'foot' ? (j - NB - NC) / NT : 0;
      const kv = (1 - foot) * Math.min(p.v, faceV(p.y) - 0.15) + foot * p.v, ky = (1 - foot) * p.y + foot * (yW - 0.3);
      for (let m = 0; m < NW; m++, qw++) {
        const f = m / (NW - 1), bulge = sd * 0.12 * Math.sin(Math.PI * f) * Math.min(1, p.f * 3);
        pos.set([eu + bulge, p.y + (ky - p.y) * f, p.v + (kv - p.v) * f], qw * 3);
        aux.set([aux[(cr * COLS) * 4], 1, f], qw * 4);
      }
    }
  }
  shape(nominal);
  // travel time from the rim along the centre streamline and the surface speed of each row, from the settled flow
  // (fixed: the pattern never jumps): slow on the lake, accelerating through the slot, free fall down the face, slowing
  // through the foot into the boil, then the river current slowing with distance
  const tauRow = new Float32Array(rowsN), spdRow = new Float32Array(rowsN);
  {
    const mid = (COLS - 1) >> 1, wM = 2 * (B.hw + OVER), r0 = NF + slotV.length, uFoot = nominal.speedAt(nominal.yT);
    for (let r = 0; r < rowsN; r++) {
      const q = r * COLS, y = pos[(q + mid) * 3 + 1];
      let U;
      if (r < NF) U = Math.max(0.25, (1.5 * wM) / Math.hypot(pos[q * 3] - pos[(q + COLS - 1) * 3], pos[q * 3 + 2] - pos[(q + COLS - 1) * 3 + 2]));
      else if (r < r0) U = Math.sqrt(2.25 + 19.62 * Math.max(0, nominal.yTop - y));
      else if (r < r0 + NB + NC) U = nominal.speedAt(y);
      else if (r < r0 + nCol) U = uFoot + (riverSpeed(0) - uFoot) * ((r - r0 - NB - NC + 1) / NT);
      else U = riverSpeed(riverD[r - r0 - nCol]);
      spdRow[r] = U;
      if (r) {
        const a = (q + mid - COLS) * 3, b = (q + mid) * 3;
        tauRow[r] = tauRow[r - 1] + Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]) / (0.5 * (U + spdRow[r - 1]));
      }
      for (let k = 0; k < COLS; k++) { flow.set([acr(k), tauRow[r]], (q + k) * 2); aux[(q + k) * 4 + 3] = U; }
    }
    let qw = nMain;
    for (const sd of [-1, 1]) for (let j = 0; j < wallRows; j++) {
      const cr = j === 0 ? r0 - 1 : r0 + j - 1;
      for (let m = 0; m < NW; m++, qw++) { flow.set([sd, tauRow[cr]], qw * 2); aux[qw * 4 + 3] = spdRow[cr]; }
    }
    landD = riverD.map((d, i) => [d, tauRow[r0 + nCol + i]]);
  }
  const tauMouth = tauRow[NF], tauLand = tauRow[NF + slotV.length + nCol - 1];
  const idx = [];
  for (let r = 0; r + 1 < rowsN; r++) for (let k = 0; k + 1 < COLS; k++) { const a = r * COLS + k; idx.push(a, a + COLS, a + 1, a + 1, a + COLS, a + COLS + 1); }
  for (let sd = 0; sd < 2; sd++) for (let j = 0; j + 1 < wallRows; j++) for (let m = 0; m + 1 < NW; m++) {
    const a = nMain + sd * wallRows * NW + j * NW + m;
    idx.push(a, a + NW, a + 1, a + 1, a + NW, a + NW + 1);
  }
  const fg = new THREE.BufferGeometry();
  const posA = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage), auxA = new THREE.BufferAttribute(aux, 4).setUsage(THREE.DynamicDrawUsage);
  fg.setAttribute('position', posA); fg.setAttribute('flow', new THREE.BufferAttribute(flow, 2)); fg.setAttribute('aux', auxA);
  fg.setIndex(idx);
  const fmat = breachMaterial({ ...damWaterUniforms, ...damLight });
  fmat.uniforms.uAmt = amt;
  fmat.uniforms.uBend.value = zSlot(nominal.v0 + 0.3);
  const flowMesh = new THREE.Mesh(fg, fmat);
  flowMesh.name = 'dam-breach-flow'; flowMesh.layers.set(FX_LAYER); flowMesh.renderOrder = 3; flowMesh.frustumCulled = false;
  flowG.add(flowMesh); geos.push(fg); mats.push(fmat);
  group.add(flowG);

  // 2. spray: thrown off the brink, and the impact cloud / spray / mist where the column meets the pool (GPU particles)
  const lipAmt = { value: 0 }, hitAmt = { value: 0 };
  const sprayU = (fade) => ({ ...damWaterUniforms, ...damLight, uFade: fade });
  const across = (n, v, y, st, hw) => Array.from({ length: n }, (_, k) => { const [x, z] = world(B.u0 + ((k + 0.5) / n - 0.5) * 2 * hw, v); return { x, y, z, s: st }; });
  const lipSpray = createDamSpray(across(5, B.vLip + 0.35, nominal.yLip, 0.7, B.hw - 0.2), [dx, dz], sprayU(lipAmt), { spray: 170, mist: 0, cloud: 0 });
  const hitSpray = createDamSpray(across(6, nominal.vLand - 0.8, yW + 0.05, 1, W_TOE - 0.3), [dx, dz], sprayU(hitAmt), { spray: 320, mist: 80, cloud: 72 });
  for (const sp of [lipSpray, hitSpray]) { sprays.push(sp); for (const m of sp.meshes) { m.layers.set(FX_LAYER); group.add(m); } }

  let t = -1, P = nominal, lastL = -1e9, lastW = -1e9, frontTau = -1;
  const landing = { x: 0, z: 0, dx, dz, w: 2 * W_TOE };
  const setLanding = () => { const [x, z] = world(B.u0, P.vLand - 0.4); landing.x = x; landing.z = z; };
  setLanding();
  const lineW = () => riverLine(P.vLand).map(([u, v]) => world(u, v));
  return {
    group,
    /** Where the water lands and which way it runs (ripples in the water sim). */
    landing,
    /** The current long profile (breachProfile). */
    get profile() { return P; },
    get flowMesh() { return flowMesh; },
    /** Surface speed (m/s) and travel time (s) of the flow, row by row along it (funnel → slot → column → river). */
    get rows() { return { tau: tauRow, speed: spdRow, river: landD }; },
    get active() { return t >= 0 && amt.value > 0.001; },
    /** How far (m) the flood front has run down the river from where the column lands. */
    get surgeAt() { let d = 0; for (const [dd, tt] of landD) if (tt <= frontTau) d = dd; return t < 0 ? 0 : d; },
    get surgeLine() { return lineW(); },
    /** Ease the spray's drift towards the wind (m/s, world xz). */
    setWind(x, z, dt) { for (const sp of sprays) sp.setWind(x, z, dt); },
    /** @param {boolean} [settled] loaded with the dam already down: straight into the steady outflow */
    start(settled = false) { if (t < 0) { t = settled ? 10 * DRAIN_S : 0; group.visible = true; } },
    /**
     * @param {number} dt
     * @param {number|null} level the reservoir's surface now (null: own drawdown curve)
     * @returns {number} strength 0..1
     */
    frame(dt, level) {
      if (t < 0) return 0;
      t += dt;
      const u = Math.min(1, t / DRAIN_S), own = level0 + (levelEnd - level0) * (1 - (1 - u) ** 3);
      const L = level ?? own, k = Math.max(0, Math.min(1, (L - yW) / H0));
      const ramp = Math.min(1, t / 0.6);
      amt.value = k < 2e-3 ? 0 : ramp * ramp * Math.min(1, k * 4); // (snap: the last millimetres of head)
      const w = Math.exp(-t / WALL_T);
      if (Math.abs(L - lastL) > 2e-3 || Math.abs(w - lastW) > 2e-3) {
        lastL = L; lastW = w; P = breachProfile(L, w, yW);
        shape(P); posA.needsUpdate = true; auxA.needsUpdate = true; setLanding();
        // the spray rides with the lip and the foot
        for (const m of lipSpray.meshes) m.position.y = P.yLip - nominal.yLip;
        for (const m of hitSpray.meshes) m.position.set(dx * (P.vLand - nominal.vLand), 0, dz * (P.vLand - nominal.vLand));
      }
      // the water front: from the slot's mouth just after the blast, FRONT_X × the surface current, all the way down
      frontTau = tauMouth + FRONT_X * Math.max(0, t - 0.1);
      fmat.uniforms.uFrontTau.value = Math.min(1e4, frontTau);
      fmat.uniforms.uMass.value = Math.max(0.5, Math.min(1.5, ((L - B.yFloor) / (level0 - B.yFloor)) ** 1.5 * (1 + 0.35 * w)));
      lipAmt.value = amt.value * Math.min(1, Math.max(0, (frontTau - tauRow[NF + slotV.length - 1]) / 0.3));
      hitAmt.value = amt.value * Math.min(1, Math.max(0, (frontTau - tauLand + 0.2) / 0.4));
      if (amt.value <= 0.001 && t > 2) group.visible = false;
      return amt.value;
    },
    dispose() {
      group.removeFromParent();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const sp of sprays) sp.dispose();
    },
  };
}

function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
