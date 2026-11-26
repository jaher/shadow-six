/**
 * LIGHTS OUT mission 6 "Thin Ice" (docs/expansion/e06.md §13): the train-ferry port's own art. Fährhafen Lütjenbrook,
 * Holstein, January 1945, frozen dusk: red-brown brick with frost, riveted grey-green steel, grey-white ice with black
 * open water in the ice-breaker's channel, the mines' black horns in the sea ice.
 *
 * buildE06Art(world, o) draws, once as the load ends (the mission script's `visuals`), visual only — every piece is
 * sized from the mission's gameplay boxes (the structures it stands in for are `visual: false`, their footprints and
 * walk heights untouched):
 *  - the ferry terminal: a long North German brick hall, stepped gables on its two wings, the waiting hall's tall
 *    arched windows (lit), slate roofs, chimneys; its clock tower on the quay front with tw1's open gallery at y 10,
 *    the clock stage and a verdigris spire;
 *  - the searchlight tower at the harbour mouth: board-marked concrete, its deck and parapet at y 5.5, the iron ladder on
 *    the channel face (and its foot down the mole into the water), the searchlight, whose beam follows the crew's eyes
 *    and dies with them;
 *  - the span master's brick cabin (its west and north windows over the span, the open door in its east wall, the
 *    switch box inside);
 *  - the rail link-span: a riveted plate-girder deck with its rails, handrails and lifting lugs, hinged on the quay,
 *    its outer end lifted by chains from a lattice gantry on two piers with counterweights inside the legs — the deck,
 *    the chains and the weights move with the drawbridge's state;
 *  - the sealed wagon (a Reichsbahn-brown covered goods wagon, sealed doors, stencils) and the shunting engine (a
 *    black 0-6-0 tank engine) on the two pushables, following them; the wagon's fall off the span's end and its splash;
 *  - the kennel [Hard]; ice collars round the mines frozen into the sea; broken slabs along the channel's and the
 *    lead's edges and brash in the open water; pressure ridges on the sea ice and a refrozen crack in the basin;
 *    the fishermen's holes off the west quay.
 * Snow on every roof, sill and coping comes from the scene's own prop snow pass (art/terrain.js coverPropsWithSnow).
 * @module art/e06-dressing
 */
import * as THREE from 'three';
import { Geo, CASTLE_SETS, segFrame, segBox, castleMaterial } from './castle-kit.js';
import { rng, seedOf } from './dressing.js';
import { buildHarbourIce, sheetTopMaterial, polySD, inPoly } from './e06-ice.js';
import { buildSearchlight } from './field-guns.js';
import { coverPropsWithSnow, propSnowAmount } from './terrain.js';
import { addSnowCover } from './terrain/snowfx.js';
import { vnoise } from './terrain/noise.js';
import { coneAt } from '../ai/perception.js';
import { applyBakedCoplanar } from './coplanar-baked.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const deg = (d) => (d * Math.PI) / 180;
const HAS_DOM = typeof document !== 'undefined';

/** e06 materials: [library set, tint, flat colour, metres per tile, normal strength] (castle-kit CASTLE_SETS). */
export const E06_SETS = {
  e6_brick: ['brick_red', 0xc08470, 0x6b3a2c, 2.2, 1.1], // red-brown North German brick (#6b3a2c)
  e6_clinker: ['brick_dark', 0x9a7a6c, 0x3e2a24, 2.0, 1.1], // dark clinker: plinths, bands, lintels, pilasters
  e6_slate: ['roof_slate', 0x9aa3b0, 0x3a414c, 3.0, 1.0],
  e6_felt: ['bitumen_felt', 0x80838a, 0x2e3034, 2.0, 0.7],
  e6_conc: ['concrete_formwork', 0xb8b6ae, 0x7c7a72, 2.6, 1.1], // board-marked concrete
  e6_granite: ['granite', 0xb6b4ae, 0x6c6a66, 1.8, 1.0], // sills, copings, the gallery's slab
  e6_steel: ['rivet', 0x83928a, 0x3f4a44, 1.4, 0.9], // the span's riveted grey-green (#3f4a44)
  e6_rust: ['rust_heavy', 0x927058, 0x5a3a28, 1.2, 1.0],
  e6_iron: ['cast_iron', 0x5e5e5c, 0x2a2a2a, 1.0, 0.6],
  e6_glass: ['glass_dirty', 0x36404a, 0x1a2024, 1.0, 0.4],
  e6_frame: ['wood_paint', 0xe6e2d6, 0xbcb8ac, 1.0, 0.5], // white window frames
  e6_door: ['door_planks', 0x6e4c38, 0x2e2018, 1.4, 1.0],
  e6_timber: ['timber_tarred', 0x7a6c5e, 0x2e2620, 1.6, 1.0],
  e6_wagon: ['weatherboard_paint', 0xa06e52, 0x5a3d2e, 1.6, 0.9], // Reichsbahn brown (#5a3d2e)
  e6_black: ['steel_painted', 0x4c4c4a, 0x1c1c1c, 1.5, 0.7],
  e6_red: ['steel_painted', 0xb4483a, 0x7a2a1e, 1.5, 0.6], // buffer beams, wheel centres
  e6_copper: ['paint_metal', 0x86b4a0, 0x3e6a5a, 1.6, 0.7], // the spire's verdigris
  e6_dial: ['plaster_white', 0xf2eee2, 0xd8d4c8, 1.0, 0.3],
  e6_rail: ['cast_iron', 0x6a6a68, 0x2e2e2e, 1.0, 0.6], // rail heads: kept clear of snow (the snow pass skips them)
  e6_coal: ['coal', 0x8c8c8c, 0x1a1a1a, 1.2, 1.0],
  // (the deck plate takes no prop snow: its snow and its trodden wet plate are one painted decal, spanDeckCrust — the
  // plate's held-back prop snow broke up into square steps, verifier r3)
  e6_deck: ['rivet', 0x7a786e, 0x3a3a34, 1.4, 1.0], // the span's deck plate: riveted, grimed, rust-tinged
  // (the keys below carry the scene's own prop snow held back to a thin broken crust — buildE06Art, SNOW_BIAS: the same
  // snow shader and look, laid thinner where heat or wind keep it off; the full pass covers any top flatter than ~50
  // degrees completely, which read as smooth white slabs)
  e6_felt_warm: ['bitumen_felt', 0x6a6b70, 0x26272a, 1.6, 0.8], // the span cabin's felt over its stove: snow thin on it
};
/** The prop snow's bias per material key (art/terrain/snowfx.js snowCoverage): below ~ -0.5 a flat top breaks up. */
const SNOW_BIAS = { e6_felt_warm: -0.62, e6_coal: -0.65 };
/** Material keys weathered like stone by the Geo build (damp band, rain streaks): the brick and the concrete. */
const WEATHER = /^e6_(brick|clinker|conc)/;
Object.assign(CASTLE_SETS, E06_SETS);

// ---------------------------------------------------------------- small vector helpers and oriented faces
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** A convex polygon (3 or 4 points) facing `want` (its winding fixed so the front face looks that way). */
function face(G, mat, pts, want, tone = 1) {
  const n = cross3(sub3(pts[1], pts[0]), sub3(pts[2], pts[0]));
  const P = dot3(n, want) < 0 ? pts.slice().reverse() : pts;
  for (let k = 1; k + 1 < P.length; k++) G.tri(mat, P[0], P[k], P[k + 1], tone);
}
/** A slab whose top face is the quad `top` (any slope), `th` thick straight down: top, bottom and four edges. */
function slab(G, mat, top, th, tone = 1, { bottom = true } = {}) {
  const bot = top.map((p) => [p[0], p[1] - th, p[2]]);
  const c = top.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4, s[2] + p[2] / 4], [0, 0, 0]);
  const n = cross3(sub3(top[1], top[0]), sub3(top[2], top[0])), up = n[1] < 0 ? [-n[0], -n[1], -n[2]] : n;
  face(G, mat, top, up, tone);
  if (bottom) face(G, mat, bot, [-up[0], -up[1], -up[2]], tone * 0.8);
  for (let i = 0; i < 4; i++) {
    const a = top[i], b = top[(i + 1) % 4], m = [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2];
    face(G, mat, [a, b, bot[(i + 1) % 4], bot[i]], [m[0] - c[0], 0, m[2] - c[2]], tone * 0.9);
  }
}
/** A thin straight member (square section `t`) from a to b. */
function member(G, mat, a, b, t, tone = 1) {
  const d = sub3(b, a), L = Math.hypot(d[0], d[1], d[2]);
  if (L < 1e-4) return;
  const f = [d[0] / L, d[1] / L, d[2] / L];
  const ref = Math.abs(f[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = cross3(f, ref); const ul = Math.hypot(...u); u = u.map((v) => (v / ul) * (t / 2));
  let v = cross3(f, u); const vl = Math.hypot(...v); v = v.map((q) => (q / vl) * (t / 2));
  const P = (p, su, sv) => [p[0] + u[0] * su + v[0] * sv, p[1] + u[1] * su + v[1] * sv, p[2] + u[2] * su + v[2] * sv];
  const A = [P(a, -1, -1), P(a, 1, -1), P(a, 1, 1), P(a, -1, 1)], B = [P(b, -1, -1), P(b, 1, -1), P(b, 1, 1), P(b, -1, 1)];
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, q = [(A[i][0] + A[j][0]) / 2 - a[0], (A[i][1] + A[j][1]) / 2 - a[1], (A[i][2] + A[j][2]) / 2 - a[2]];
    face(G, mat, [A[i], A[j], B[j], B[i]], q, tone);
  }
  face(G, mat, A, sub3(a, mid), tone); face(G, mat, B, sub3(b, mid), tone);
}

// ---------------------------------------------------------------- lit windows (one emissive mesh)
/**
 * The few lit panes of a port under blackout (January 1945): lamp-light behind a half-drawn blackout blind — the blind
 * a dark band of slats from the top down to a different height in each pane, the light below it brightest low in the
 * middle and falling off to the frame, the glazing bars dark across it; its hottest spot above the bloom's threshold
 * (a faint halo on the medium and high presets). Four blind heights in one atlas (a column each).
 */
const BLINDS = [0.42, 0.55, 0.33, 0.62];
function blindAtlas() {
  if (!HAS_DOM) return null;
  const W = 64, H = 128, c = document.createElement('canvas'); c.width = W * BLINDS.length; c.height = H;
  const x = c.getContext('2d');
  BLINDS.forEach((b, k) => {
    const x0 = k * W, yb = Math.round(b * H);
    // the light: a warm glow, brightest a third of the way up from the sill, falling off to the edges
    const gr = x.createRadialGradient(x0 + W * 0.5, H * 0.78, 2, x0 + W * 0.5, H * 0.72, H * 0.62);
    gr.addColorStop(0, 'rgb(255,236,190)'); gr.addColorStop(0.35, 'rgb(236,170,96)'); gr.addColorStop(1, 'rgb(70,36,14)');
    x.fillStyle = gr; x.fillRect(x0, 0, W, H);
    // the blind: dark cloth with its slat shadows, a pale edge where it is drawn down to
    x.fillStyle = 'rgb(14,10,8)'; x.fillRect(x0, 0, W, yb);
    x.fillStyle = 'rgba(40,26,16,0.9)';
    for (let y = 6; y < yb - 2; y += 7) x.fillRect(x0 + 2, y, W - 4, 1);
    x.fillStyle = 'rgb(120,82,46)'; x.fillRect(x0 + 1, yb - 2, W - 2, 3);
    // the glazing bars and the frame, dark against the light
    x.fillStyle = 'rgb(18,12,8)';
    x.fillRect(x0 + W / 2 - 2, 0, 4, H); x.fillRect(x0, Math.round(H * 0.66), W, 4);
    x.fillRect(x0, 0, 3, H); x.fillRect(x0 + W - 3, 0, 3, H); x.fillRect(x0, H - 3, W, 3);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
let GLOW = null;
function glowMaterial() {
  if (GLOW) return GLOW;
  const map = blindAtlas();
  GLOW = new THREE.MeshStandardMaterial({ color: 0x0c0806, emissive: 0xffc890, emissiveMap: map, emissiveIntensity: map ? 2.6 : 0.5, roughness: 0.35, name: 'e06:lit_window' });
  GLOW.userData.snowCover = true; // (no snow on a pane)
  return GLOW;
}
/** Quads [[a, b, c, d, n], ...] → one mesh in `mat`, each quad's UVs a column of the blind atlas (`R` picks it). */
function quadsMesh(quads, mat, name, R = Math.random) {
  if (!quads.length) return null;
  const pos = [], nor = [], uv = [];
  for (const [a, b, c, d, n] of quads) {
    const nn = cross3(sub3(b, a), sub3(c, a)), flip = dot3(nn, n) < 0, P = flip ? [a, d, c, b] : [a, b, c, d];
    // (corner order a, b, c, d = sill-left, sill-right, head-right, head-left as brickWall writes them)
    const k = Math.floor(R() * BLINDS.length), u0 = k / BLINDS.length, u1 = (k + 1) / BLINDS.length;
    const U = flip ? [[u0, 0], [u0, 1], [u1, 1], [u1, 0]] : [[u0, 0], [u1, 0], [u1, 1], [u0, 1]];
    for (const q of [0, 1, 2, 0, 2, 3]) { pos.push(...P[q]); nor.push(...n); uv.push(...U[q]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const m = new THREE.Mesh(g, mat);
  m.name = name; m.castShadow = false; m.receiveShadow = false;
  return m;
}

// ---------------------------------------------------------------- brick walls with openings
/**
 * A brick wall on the segment frame F (outer face on the line, `t` thick inward), u 0..L, y0..y1, with openings
 * [{u0, u1, v0, v1, kind: 'win' | 'arch' | 'door' | 'portal', lit}]: piers and spandrels round them, the panes set back
 * 0.16 m (lit ones into `lit`), granite sills, clinker lintels or arches, white frames and glazing bars, plank doors.
 * Openings in the same column (same u0/u1) stack.
 */
function brickWall(G, F, L, y0, y1, ops, { t = 0.42, mat = 'e6_brick', lit = null, tone = 1 } = {}) {
  const cols = [];
  for (const o of ops) {
    let c = cols.find((q) => Math.abs(q.u0 - o.u0) < 1e-3 && Math.abs(q.u1 - o.u1) < 1e-3);
    if (!c) cols.push((c = { u0: o.u0, u1: o.u1, ops: [] }));
    c.ops.push(o);
  }
  cols.sort((a, b) => a.u0 - b.u0);
  let u = 0;
  for (const c of cols) {
    if (c.u0 > u + 1e-3) segBox(G, mat, F, u, c.u0, -t, 0, y0, y1, tone);
    c.ops.sort((a, b) => a.v0 - b.v0);
    let v = y0;
    for (const o of c.ops) {
      if (o.v0 > v + 1e-3) segBox(G, mat, F, c.u0, c.u1, -t, 0, v, o.v0, tone);
      v = o.v1;
    }
    if (y1 > v + 1e-3) segBox(G, mat, F, c.u0, c.u1, -t, 0, v, y1, tone);
    u = c.u1;
  }
  if (L > u + 1e-3) segBox(G, mat, F, u, L, -t, 0, y0, y1, tone);
  const P = (uu, w, y) => { const [x, z] = F.at(uu, w); return [x, y, z]; };
  const n = [F.n[0], 0, F.n[1]];
  for (const o of ops) {
    const { u0, u1, v0, v1 } = o, door = o.kind === 'door' || o.kind === 'portal', arch = o.kind === 'arch' || o.kind === 'portal';
    const r = (u1 - u0) / 2, vs = arch ? v1 - r : v1; // (an arch: the opening's top is a half circle from vs)
    // the arch's haunches inside the opening (stepped brick, five courses each side) and its clinker ring on the face
    if (arch) {
      const N = 6;
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * (Math.PI / 2), a1 = ((k + 1) / N) * (Math.PI / 2);
        const yA = vs + Math.sin(a0) * r, yB = vs + Math.sin(a1) * r, inset = r - Math.cos(a1) * r;
        segBox(G, mat, F, u0, u0 + inset, -t, 0, yA, yB, tone); segBox(G, mat, F, u1 - inset, u1, -t, 0, yA, yB, tone);
      }
      for (let k = 0; k < 9; k++) {
        const a0 = (k / 9) * Math.PI, a1 = ((k + 1) / 9) * Math.PI, rr = r + 0.02, R2 = r + 0.3;
        const c0 = [Math.cos(a0), Math.sin(a0)], c1 = [Math.cos(a1), Math.sin(a1)], um = (u0 + u1) / 2;
        const q = [P(um - c0[0] * rr, 0.035, vs + c0[1] * rr), P(um - c1[0] * rr, 0.035, vs + c1[1] * rr), P(um - c1[0] * R2, 0.035, vs + c1[1] * R2), P(um - c0[0] * R2, 0.035, vs + c0[1] * R2)];
        face(G, 'e6_clinker', q, n, 0.85 + 0.1 * (k % 2));
      }
    } else {
      segBox(G, 'e6_clinker', F, u0 - 0.12, u1 + 0.12, 0, 0.035, v1, v1 + 0.24, 0.85); // flat lintel (a soldier course)
    }
    if (door) {
      // plank door leaf set back, a granite threshold
      face(G, 'e6_door', [P(u0, -0.24, v0), P(u1, -0.24, v0), P(u1, -0.24, vs), P(u0, -0.24, vs)], n, 0.9);
      if (arch) face(G, 'e6_glass', [P(u0, -0.24, vs), P(u1, -0.24, vs), P(u1, -0.24, v1), P(u0, -0.24, v1)], n, 0.8);
      segBox(G, 'e6_granite', F, u0 - 0.05, u1 + 0.05, -0.3, 0.16, v0 - 0.12, v0 + 0.02, 0.9);
      continue;
    }
    // sill, pane (lit or dark), frame and glazing bars
    segBox(G, 'e6_granite', F, u0 - 0.08, u1 + 0.08, -0.08, 0.07, v0 - 0.07, v0 + 0.02, 0.95);
    // the pane: glass, a lit pane (blackout blind half down), boarded over, or blacked out with paint; the frame's
    // paint fresh or grimed (o.frame: its tone)
    const pane = [P(u0, -0.16, v0), P(u1, -0.16, v0), P(u1, -0.16, v1), P(u0, -0.16, v1)];
    if (o.lit && lit) lit.push([...pane, n]);
    else if (o.pane === 'board') face(G, 'e6_door', pane, n, 0.7);
    else if (o.pane === 'black') face(G, 'e6_black', pane, n, 0.5);
    else face(G, 'e6_glass', pane, n, 0.9);
    const bar = 0.06, um = (u0 + u1) / 2, vt = v0 + (vs - v0) * 0.68, ft = o.frame ?? 0.95;
    segBox(G, 'e6_frame', F, um - bar / 2, um + bar / 2, -0.155, -0.11, v0, arch ? v1 - 0.02 : v1, ft);
    segBox(G, 'e6_frame', F, u0, u1, -0.15, -0.117, vt - bar / 2, vt + bar / 2, ft);
    if (arch) segBox(G, 'e6_frame', F, u0 + 0.02, u1 - 0.02, -0.15, -0.117, vs - bar / 2, vs + bar / 2, ft);
  }
}
/** A stepped gable on the frame F above y (u 0..L): `n` steps, `t` thick, granite cap on every step. */
function steppedGable(G, F, L, y, n, h, t = 0.45) {
  const s = L / (2 * n + 1);
  for (let i = 0; i <= n; i++) {
    const a = i * s, b = L - i * s, y0 = y + i * h, y1 = y + (i + 1) * h;
    segBox(G, 'e6_brick', F, a, b, -t, 0, y0, y1, 1 - 0.03 * i);
    // the caps: the step's exposed top at each side (and the top one whole), 6 cm proud of both faces
    if (i < n) {
      segBox(G, 'e6_granite', F, a - 0.06, a + s, -t - 0.06, 0.06, y1, y1 + 0.12, 0.92);
      segBox(G, 'e6_granite', F, b - s, b + 0.06, -t - 0.06, 0.06, y1, y1 + 0.12, 0.92);
    } else segBox(G, 'e6_granite', F, a - 0.06, b + 0.06, -t - 0.06, 0.06, y1, y1 + 0.14, 0.92);
  }
  // blind niches in clinker on the gable face (two courses up)
  for (const k of [-1, 0, 1]) {
    const um = L / 2 + k * s * 1.2, w = s * 0.55;
    if (um - w / 2 < s * 1.2 || um + w / 2 > L - s * 1.2) continue;
    segBox(G, 'e6_clinker', F, um - w / 2, um + w / 2, -0.06, 0.03, y + h * 0.4, y + h * (k === 0 ? 2.6 : 1.7), 0.8);
  }
}

/** A pitched roof as two slabs over x0..x1 × z0..z1, ridge along `axis` ('x' | 'z'), eaves at y, ridge at y + H. */
function gableRoof(G, mat, x0, x1, z0, z1, y, H, axis, th = 0.16) {
  if (axis === 'x') {
    const zc = (z0 + z1) / 2;
    slab(G, mat, [[x0, y, z0], [x0, y + H, zc], [x1, y + H, zc], [x1, y, z0]], th);
    slab(G, mat, [[x0, y + H, zc], [x0, y, z1], [x1, y, z1], [x1, y + H, zc]], th);
    G.box('e6_slate', (x0 + x1) / 2, y + H + 0.04, zc, x1 - x0, 0.12, 0.3, 0, 0.7); // ridge capping
  } else {
    const xc = (x0 + x1) / 2;
    slab(G, mat, [[x0, y, z0], [x0, y, z1], [xc, y + H, z1], [xc, y + H, z0]], th);
    slab(G, mat, [[xc, y + H, z0], [xc, y + H, z1], [x1, y, z1], [x1, y, z0]], th);
    G.box('e6_slate', xc, y + H + 0.04, (z0 + z1) / 2, 0.3, 0.12, z1 - z0, 0, 0.7);
  }
}
/** A brick chimney stack with a clinker cap and two pots. */
function chimney(G, x, z, y0, y1, w = 1.0, d = 0.75) {
  G.box('e6_brick', x, (y0 + y1) / 2, z, w, y1 - y0, d, 0, 0.95);
  // the stack's top courses blackened by the smoke, the cap and the pots sooted (warm: no snow lies on them)
  for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const wx = nx ? 0.02 : w * 0.96, wz = nz ? 0.02 : d * 0.96;
    G.box('e6_rail', x + nx * (w / 2 + 0.012), y1 - 0.32, z + nz * (d / 2 + 0.012), wx, 0.5, wz, 0, 0.55);
  }
  G.box('e6_rail', x, y1 + 0.09, z, w + 0.16, 0.18, d + 0.16, 0, 0.7);
  for (const k of [-0.22, 0.22]) G.cyl('e6_rail', x + k * w, y1 + 0.18, z, 0.11, 0.09, 0.42, 8, 0.6);
}

// ---------------------------------------------------------------- the ferry terminal and its clock tower
const TERM = { x0: 50, x1: 102, z0: 74.5, z1: 87.5, eave: 8.6, wing: 10 };
function buildTerminal(G, lit, R, clock, extras) {
  const { x0, x1, z0, z1, eave } = TERM, inside = [(x0 + x1) / 2, (z0 + z1) / 2], t = 0.45;
  const wl = TERM.wing, tw = { x0: clock.x - 2.2, x1: clock.x + 2.2 };
  const L = x1 - x0, D = z1 - z0;
  const litP = (p) => R() < p;
  // (a window's pane and frame: one in ten boarded over, one in eight painted out for the blackout, frames grimed unevenly)
  const look = () => { const r = R(); return { pane: r < 0.1 ? 'board' : r < 0.22 ? 'black' : undefined, frame: 0.72 + R() * 0.26 }; };
  // ---- north (quay) front: the wings' two-storey windows, the waiting hall's tall arched windows either side of the tower
  const N = [];
  for (const c of [3, 7, L - 7, L - 3]) for (const [v0, v1] of [[1.1, 3.3], [5.1, 7.2]]) N.push({ u0: c - 0.65, u1: c + 0.65, v0, v1, kind: 'win', lit: litP(0.12), ...look() });
  for (const c of [12.7, 16.3, 19.9, 23.5, 26.3]) if (c + 0.9 < tw.x0 - x0 - 0.3) N.push({ u0: c - 0.9, u1: c + 0.9, v0: 1.0, v1: 6.8, kind: 'arch', lit: litP(0.22) });
  for (const c of [35.0, 38.6]) N.push({ u0: c - 0.9, u1: c + 0.9, v0: 1.0, v1: 6.8, kind: 'arch', lit: litP(0.22) });
  brickWall(G, segFrame([x0, z0], [x1, z0], inside), L, 0, eave, N, { t, lit });
  // ---- south (yard) front: two storeys of windows, the yard door at the middle
  const S = [];
  for (let c = 2.6; c < L - 2; c += 3.4) {
    if (Math.abs(c - (80 - x0)) < 2.2) continue;
    for (const [v0, v1] of [[1.1, 3.3], [5.1, 7.2]]) S.push({ u0: c - 0.65, u1: c + 0.65, v0, v1, kind: 'win', lit: litP(0.12), ...look() });
  }
  S.push({ u0: 80 - x0 - 0.9, u1: 80 - x0 + 0.9, v0: 0, v1: 3.0, kind: 'portal' });
  S.push({ u0: 80 - x0 - 0.65, u1: 80 - x0 + 0.65, v0: 5.1, v1: 7.2, kind: 'win', lit: litP(0.5) });
  brickWall(G, segFrame([x0, z1], [x1, z1], inside), L, 0, eave, S, { t, lit });
  // ---- the end walls (butting the long walls: they span z0 + t .. z1 - t)
  const endOps = (door) => {
    const o = [];
    for (const c of [3.2, 6.5, 9.8]) {
      if (door && Math.abs(c - door) < 1.5) { o.push({ u0: door - 0.8, u1: door + 0.8, v0: 0, v1: 2.7, kind: 'door' }); o.push({ u0: door - 0.8, u1: door + 0.8, v0: 5.1, v1: 7.2, kind: 'win', lit: litP(0.3) }); continue; }
      for (const [v0, v1] of [[1.1, 3.3], [5.1, 7.2]]) o.push({ u0: c - 0.65, u1: c + 0.65, v0, v1, kind: 'win', lit: litP(0.12), ...look() });
    }
    return o.map((q) => ({ ...q, u0: q.u0 - t, u1: q.u1 - t }));
  };
  brickWall(G, segFrame([x0, z0 + t], [x0, z1 - t], inside), D - 2 * t, 0, eave, endOps(null), { t, lit });
  brickWall(G, segFrame([x1, z0 + t], [x1, z1 - t], inside), D - 2 * t, 0, eave, endOps(78 - z0), { t, lit });
  // ---- plinth, string course, cornice (clinker), corner pilasters covering the bands' ends
  const tall = N.filter((o) => o.v0 < 4.5 && o.v1 > 4.25).map((o) => [o.u0 - 0.12, o.u1 + 0.12]);
  for (const [a, b] of [[[x0, z0], [x1, z0]], [[x0, z1], [x1, z1]], [[x0, z0], [x0, z1]], [[x1, z0], [x1, z1]]]) {
    const F = segFrame(a, b, inside), Lf = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const gaps = a[1] === z1 && b[1] === z1 ? [[80 - x0 - 1.0, 80 - x0 + 1.0]] : a[0] === x1 && b[0] === x1 ? [[78 - z0 - 0.9, 78 - z0 + 0.9]] : [];
    let u = 0.3;
    for (const [g0, g1] of [...gaps, [Lf - 0.3, Lf]]) { if (g0 > u) segBox(G, 'e6_clinker', F, u, g0, -0.05, 0.05, 0, 0.75, 0.8); u = g1; }
    // (the string course runs between the hall's tall windows on the quay front, and through the clock tower there)
    const sg = a[1] === z0 && b[1] === z0 ? [...tall, [tw.x0 - x0, tw.x1 - x0]].sort((p, q) => p[0] - q[0]) : [];
    u = 0.3;
    for (const [g0, g1] of [...sg, [Lf - 0.3, Lf]]) { if (g0 > u) segBox(G, 'e6_clinker', F, u, g0, -0.05, 0.05, 4.25, 4.5, 0.82); u = Math.max(u, g1); }
    segBox(G, 'e6_clinker', F, 0.3, Lf - 0.3, -0.05, 0.1, eave - 0.42, eave - 0.24, 0.8);
    segBox(G, 'e6_clinker', F, 0.3, Lf - 0.3, -0.05, 0.17, eave - 0.24, eave + 0.02, 0.78);
    // (dentils under the cornice: every other header course)
    for (let uu = 0.6; uu < Lf - 0.6; uu += 0.5) segBox(G, 'e6_clinker', F, uu - 0.1, uu + 0.1, -0.05, 0.13, eave - 0.54, eave - 0.42, 0.75);
  }
  for (const [cx, cz, sx, sz] of [[x0, z0, 1, 1], [x1, z0, -1, 1], [x0, z1, 1, -1], [x1, z1, -1, -1]]) {
    G.box('e6_clinker', cx + sx * 0.2, eave / 2, cz + sz * 0.2, 0.62, eave, 0.62, 0, 0.85);
  }
  // ---- the wings: stepped gables front and back, steep slate roofs (ridge north-south), chimneys
  const wingH = 5.6;
  for (const [a, b] of [[x0, x0 + wl], [x1 - wl, x1]]) {
    steppedGable(G, segFrame([a, z0], [b, z0], inside), b - a, eave, 5, 1.12);
    steppedGable(G, segFrame([a, z1], [b, z1], inside), b - a, eave, 5, 1.12);
    gableRoof(G, 'e6_slate', a - 0.25, b + 0.25, z0 + 0.3, z1 - 0.3, eave - 0.2, wingH, 'z');
    chimney(G, (a + b) / 2, z0 + D * 0.7, eave + wingH - 1.0, eave + wingH + 1.6);
  }
  // ---- the hall between them: a lower slate roof (ridge east-west) running into the wings' roofs, two chimneys
  gableRoof(G, 'e6_slate', x0 + wl / 2, x1 - wl / 2, z0 + 0.02, z1 - 0.02, eave - 0.08, 4.0, 'x');
  chimney(G, 68, 83.2, eave + 2.0, eave + 4.6, 0.9, 0.7);
  chimney(G, 88.5, 83.2, eave + 2.0, eave + 4.6, 0.9, 0.7);
  // dormers on both slopes of the hall's roof (a lit pane here and there), a glazed lantern over the waiting hall
  for (const [x, side] of [[63.5, -1], [71, -1], [89, -1], [63.5, 1], [69.5, 1], [75.5, 1], [86.5, 1]]) {
    const zc = side < 0 ? z0 + 2.3 : z1 - 2.3, yb = eave + 1.15, fz = zc + side * 0.71;
    G.box('e6_brick', x, yb + 0.5, zc, 1.5, 1.0, 1.4, 0, 0.9);
    slab(G, 'e6_slate', [[x - 0.92, yb + 1.0, zc - 0.8], [x - 0.92, yb + 1.0, zc + 0.8], [x, yb + 1.45, zc + 0.8], [x, yb + 1.45, zc - 0.8]], 0.08, 0.85);
    slab(G, 'e6_slate', [[x, yb + 1.45, zc - 0.8], [x, yb + 1.45, zc + 0.8], [x + 0.92, yb + 1.0, zc + 0.8], [x + 0.92, yb + 1.0, zc - 0.8]], 0.08, 0.85);
    const pane = [[x - 0.45, yb + 0.15, fz + side * 0.04], [x + 0.45, yb + 0.15, fz + side * 0.04], [x + 0.45, yb + 0.85, fz + side * 0.04], [x - 0.45, yb + 0.85, fz + side * 0.04]];
    if (R() < 0.12) lit.push([...pane, [0, 0, side]]); else face(G, 'e6_glass', pane, [0, 0, side], 0.8);
    face(G, 'e6_brick', [[x - 0.75, yb + 1.0, fz], [x + 0.75, yb + 1.0, fz], [x, yb + 1.43, fz]], [0, 0, side], 0.85);
  }
  const ly = eave + 4.0 - 0.07, lx0 = 72, lx1 = 77;
  G.box('e6_iron', (lx0 + lx1) / 2, ly + 0.03, 81, lx1 - lx0, 0.06, 2.4, 0, 0.6);
  slab(G, 'e6_glass', [[lx0, ly + 0.11, 79.8], [lx0, ly + 0.75, 81], [lx1, ly + 0.75, 81], [lx1, ly + 0.11, 79.8]], 0.03, 0.8);
  slab(G, 'e6_glass', [[lx0, ly + 0.75, 81], [lx0, ly + 0.11, 82.2], [lx1, ly + 0.11, 82.2], [lx1, ly + 0.75, 81]], 0.03, 0.8);
  for (let x = lx0; x <= lx1 + 0.01; x += 1.25) { member(G, 'e6_iron', [x, ly + 0.1, 79.8], [x, ly + 0.77, 81], 0.04, 0.6); member(G, 'e6_iron', [x, ly + 0.77, 81], [x, ly + 0.1, 82.2], 0.04, 0.6); }
  // ---- a canopy over the quay door's flank: the timetable board's lamp bracket is the furniture's; enamel name band
  const F = segFrame([x0, z0], [x1, z0], inside);
  segBox(G, 'e6_dial', F, 7.5 - 0.1, L - 7.5 + 0.1, -0.05, 0.06, 7.55, 7.95, 0.9);
  buildClockTower(G, clock, lit, R);
  terminalWear(G, R, extras, clock);
}

/**
 * The terminal's wear (art review r1: "smooth, uniform planes … ruler-regular grids … no downpipes, weathering bands,
 * patching or signage"): zinc gutters on the hall's eaves and the wings' side eaves with their downpipes (between the
 * windows, never over one), patched slates and the chimneys' soot streaks on the roofs, rain runs under the sills,
 * salt bloom on the quay front's plinth, a repaired patch of newer brick, an enamel sign beside the hall's door.
 * Every overlay stands a real step proud of what it lies on (>= 8 mm: never in its plane).
 */
function terminalWear(G, R, extras, clock) {
  const { x0, x1, z0, z1, eave } = TERM, wl = TERM.wing;
  const tw0 = clock.x - 2.35, tw1 = clock.x + 2.35;
  // ---- gutters: the hall's north and south eaves (hung 1 cm in front of the cornice, whose face stands 0.17 out; the
  // north one broken by the clock tower), the wings' outer side eaves (under their roofs' edge)
  const yg = eave - 0.03, zgN = z0 - 0.245, zgS = z1 + 0.245, ygs = eave - 0.3, xgW = x0 - 0.33, xgE = x1 + 0.33;
  const gutterX = (z, xa, xb) => member(G, 'e6_iron', [xa, yg, z], [xb, yg, z], 0.13, 0.72);
  gutterX(zgN, x0 + wl + 0.3, tw0); gutterX(zgN, tw1, x1 - wl - 0.3); gutterX(zgS, x0 + wl + 0.3, x1 - wl - 0.3);
  for (const x of [xgW, xgE]) member(G, 'e6_iron', [x, ygs, z0 + 0.4], [x, ygs, z1 - 0.4], 0.13, 0.72);
  // ---- downpipes in the piers between windows: a swan neck from the gutter's outlet back past the cornice to 0.1 m
  // off the wall (clear of the string course and the plinth, 5 cm proud), down to a shoe; iron straps into the wall
  const pipe = (g, n, w) => { // g: the outlet [x, y, z]; n: the wall's outward normal [nx, nz]; w: the wall line (x or z)
    const at = (y, off) => (n[0] ? [w + n[0] * off, y, g[2]] : [g[0], y, w + n[1] * off]);
    const neck = at(eave - 1.2, 0.1), foot = at(0.32, 0.1), shoe = at(0.1, 0.38);
    member(G, 'e6_iron', [g[0], g[1] - 0.05, g[2]], neck, 0.085, 0.68);
    member(G, 'e6_iron', neck, foot, 0.085, 0.68);
    member(G, 'e6_iron', foot, shoe, 0.085, 0.68);
    for (let y = 1.6; y < eave - 1.6; y += 2.1) {
      const [bx, , bz] = at(y, 0.04);
      G.box('e6_iron', bx, y, bz, n[0] ? 0.1 : 0.16, 0.05, n[0] ? 0.16 : 0.1, 0, 0.5);
    }
  };
  for (const x of [60.6, 83.0, 91.3]) pipe([x, yg, zgN], [0, -1], z0);
  for (const x of [61.1, 71.3, 88.3]) pipe([x, yg, zgS], [0, 1], z1);
  for (const z of [75.6, 86.4]) { pipe([xgW, ygs, z], [-1, 0], x0); pipe([xgE, ygs, z], [1, 0], x1); }
  // ---- patched slates (a darker or a paler batch) and the chimneys' soot down the slopes: slabs 1.5 cm proud of the
  // slates, clear of the dormers, the chimneys, the lantern and the ridge
  const hallSlope = (side) => { // the hall roof's slope (gableRoof's top face): x along, d (0 eave .. 1 ridge) up
    const zE = side < 0 ? z0 + 0.02 : z1 - 0.02, zc = (z0 + z1) / 2, yE = eave - 0.08, H = 4.0, run = Math.abs(zc - zE), L = Math.hypot(run, H);
    const n = [0, run / L, side * H / L]; // (up and out over its eave)
    return (x, d, lift = 0.015) => [x + n[0] * lift, yE + H * d + n[1] * lift, zE + (zc - zE) * d + n[2] * lift];
  };
  const DORMERS = [[63.5, -1], [71, -1], [89, -1], [63.5, 1], [69.5, 1], [75.5, 1], [86.5, 1]];
  const clear = (side, xa, xb, da, db) => {
    if (side < 0 && xb > tw0 - 0.5 && xa < tw1 + 0.5 && da < 0.3) return false; // (the clock tower)
    if (xb > 71.2 && xa < 77.8 && db > 0.74) return false; // (the waiting hall's lantern)
    if (side > 0 && db > 0.52 && da < 0.8 && [68, 88.5].some((c) => xb > c - 0.8 && xa < c + 0.8)) return false; // (the chimneys)
    return !DORMERS.some(([x, s2]) => s2 === side && xb > x - 1.15 && xa < x + 1.15 && db > 0.18 && da < 0.55);
  };
  // the roofs' snow, worked (verifier r2: "a plaster-smooth white slab with black 'hole' patches"): the slates' courses
  // faint through the thin snow over every slope; slates bared below the hall's stacks (their warmth), their soot run
  // down the slope in streaks; the snow scoured off along the ridges and thin at the eaves below the snow guards, banked
  // behind the guards; drifts filling the valleys where the hall's roof runs into the wings'. Decals over the snowed
  // slates (extras.roof: an atlas, extras.courses: the courses), the banks and drifts geometry in the slates' own snow.
  // (The snow shader is the scene's, untouched.)
  const roof = (extras.roof ||= []), courses = (extras.courses ||= []);
  const slopeN = (P) => { const a = P(0, 0, 0), b = P(0, 1, 0), c = P(1, 0, 0), u = sub3(b, a), v = sub3(c, a), n = cross3(u, v), l = Math.hypot(...n) * (n[1] < 0 ? -1 : 1); return n.map((q) => q / l); };
  const LH = Math.hypot((z1 - z0) / 2 - 0.02, 4.0); // (the hall's slope, eave to ridge)
  const put = (P, col, x, d, w, h, lift = 0.03) => roof.push({ col, w, h, p: P(x, d, lift), n: slopeN(P), flip: R() < 0.5 });
  // a scoured band from x0 to x1 round d: pieces ~1.1 m wide side by side (the atlas column, its slates at their own
  // size: one stretched plane smeared them), each 1.4 m up the slope with the ragged band across its middle
  const band = (P, x0b, x1b, d, lift = 0.03) => {
    const k = Math.max(1, Math.round((x1b - x0b) / 1.1)), w = (x1b - x0b) / k;
    for (let i = 0; i < k; i++) put(P, 1, x0b + w * (i + 0.5) + (R() - 0.5) * 0.1, d + (R() - 0.5) * 0.012, w * 1.45, 1.4, lift + i * 0.0005);
  };
  for (const cx of [68, 88.5]) {
    const P = hallSlope(1);
    put(P, 0, cx + (R() - 0.5) * 0.2, 0.6 - 1.05 / LH, 1.55 + R() * 0.3, 2.1);
    put(P, 2, cx + (R() - 0.5) * 0.12, 0.6 - 1.25 / LH, 1.1, 2.5, 0.036);
  }
  for (const side of [-1, 1]) {
    const P = hallSlope(side);
    courses.push({ P, u0: x0 + wl / 2, u1: x1 - wl / 2, L: LH });
    // ridge scour in broken lengths, clear of the lantern, the chimneys, the tower, the dormers
    for (let k = 0, n = 0; k < 40 && n < 9; k++) {
      const w = 1.4 + R() * 2.6, xa = x0 + wl + 0.6 + R() * (x1 - x0 - 2 * wl - 1.2 - w), h = 0.35 + R() * 0.45, dc = 1 - (0.12 + h / 2 + R() * 0.12) / LH;
      if (!clear(side, xa, xa + w, dc - h / 2 / LH, dc + h / 2 / LH)) continue;
      band(P, xa, xa + w, dc);
      n++;
    }
    // the eave strip below the snow guards: the snow slid off it, thin and broken, in lengths
    for (let x = x0 + wl + 0.6; x < x1 - wl - 0.8;) {
      const w = 1.2 + R() * 2.4;
      if (R() < 0.7 && !(side < 0 && x + w > tw0 - 0.3 && x < tw1 + 0.3)) band(P, x, x + w, (0.26 + R() * 0.08) / LH, 0.028);
      x += w + 0.2 + R() * 1.4;
    }
    // the snow banked behind the guard bar (d 0.09, 17 cm out): up against it, tapering uphill, broken where it slid
    const xs = [x0 + wl + 0.8, x1 - wl - 0.8], cuts = side < 0 ? [[tw0 - 0.3, tw1 + 0.3]] : [];
    let xa = xs[0];
    for (const [c0, c1] of [...cuts, [xs[1], xs[1]]]) {
      for (let x = xa; x < c0 - 0.6;) {
        const len = Math.min(1.5 + R() * 4.5, c0 - x);
        if (R() < 0.82 && len > 0.6) guardBank(G, P, x, x + len, R);
        x += len + 0.15 + R() * 0.6;
      }
      xa = Math.max(xa, c1);
    }
  }
  // the wings: courses, ridge scour both slopes, their stacks' soot down both slopes (the stack stands on the ridge)
  const wingH = 5.6;
  for (const [a, b] of [[x0, x0 + wl], [x1 - wl, x1]]) {
    const xc = (a + b) / 2, run = (b + 0.25) - xc, WL = Math.hypot(run, wingH);
    for (const side of [-1, 1]) {
      const xe = side < 0 ? a - 0.25 : b + 0.25;
      // (u along the ridge (z), d from the eave (0) to the ridge (1)); the normal up and out over its eave
      const nrm = [side * wingH / WL, run / WL, 0];
      const P = (z, d, lift = 0) => [xe + (xc - xe) * d + nrm[0] * lift, eave - 0.2 + wingH * d + nrm[1] * lift, z];
      courses.push({ P, u0: z0 + 0.3, u1: z1 - 0.3, L: WL, wing: true });
      const sz = z0 + 13 * 0.7; // (the stack: buildTerminal's chimney at z0 + D * 0.7)
      for (let k = 0, n = 0; k < 20 && n < 4; k++) {
        const w = 1.4 + R() * 2.2, za = z0 + 0.8 + R() * (z1 - z0 - 1.6 - w), h = 0.35 + R() * 0.4;
        if (za + w > sz - 0.9 && za < sz + 0.9) continue;
        const k = Math.max(1, Math.round(w / 1.1)), pw = w / k;
        for (let i = 0; i < k; i++) roof.push({ col: 1, w: pw * 1.45, h: 1.4, p: P(za + pw * (i + 0.5), 1 - (0.12 + h / 2) / WL, 0.03 + i * 0.0005), n: nrm, flip: R() < 0.5 });
        n++;
      }
      roof.push({ col: 2, w: 0.95, h: 2.2, p: P(sz + (R() - 0.5) * 0.1, 1 - (0.55 + 1.1) / WL, 0.036), n: nrm, flip: R() < 0.5 });
    }
    // the valleys where the hall's slopes run into this wing's inner slope: a drift along each
    const inner = a < x0 + 1 ? 1 : -1, xe = inner > 0 ? b + 0.25 : a - 0.25;
    const wingY = (x) => eave - 0.2 + wingH * Math.max(0, Math.min(1, (xe - x) / (xe - xc)));
    for (const side of [-1, 1]) valleyDrift(G, hallSlope(side), wingY, xc, xe, side, R);
  }
  // the roof's ironmongery standing proud of the slates and the snow: snow guards (a round bar on brackets) along
  // both eaves of the hall (the north one broken by the clock tower), and the chimney sweep's walkway (boards on iron
  // stirrups) along the south slope from the roof hatch to each chimney, below the lantern
  for (const side of [-1, 1]) {
    const P = hallSlope(side), d = 0.09, xs = [x0 + wl + 0.8, x1 - wl - 0.8];
    const cuts = side < 0 ? [[tw0 - 0.3, tw1 + 0.3]] : [];
    let xa = xs[0];
    for (const [c0, c1] of [...cuts, [xs[1], xs[1]]]) {
      if (c0 - xa > 0.8) {
        member(G, 'e6_iron', P(xa, d, 0.17), P(c0, d, 0.17), 0.035, 0.6);
        for (let x = xa + 0.3; x < c0; x += 1.4) member(G, 'e6_iron', P(x, d - 0.01, 0.01), P(x, d, 0.19), 0.03, 0.55);
      }
      xa = Math.max(xa, c1);
    }
  }
  {
    const P = hallSlope(1), hx = 79.6, dh = 0.68;
    // the roof hatch: an iron frame along the slope, 8 cm proud of the slates
    slab(G, 'e6_iron', [P(hx - 0.36, dh, 0.08), P(hx + 0.36, dh, 0.08), P(hx + 0.36, dh + 0.11, 0.08), P(hx - 0.36, dh + 0.11, 0.08)], 0.1, 0.6);
    for (const cx of [68, 88.5]) {
      // boards on stirrups 12 cm over the slates, across the slope from the hatch to the chimney's flank (d 0.66)
      const xa = hx + (cx > hx ? 0.45 : -0.45), xb = cx + (cx > hx ? -0.5 : 0.5), da = dh + 0.03, db = 0.66;
      const n = Math.max(2, Math.round(Math.abs(xb - xa) / 1.6));
      for (let k = 0; k <= n; k++) {
        const x = xa + ((xb - xa) * k) / n, dd = da + ((db - da) * k) / n;
        member(G, 'e6_iron', P(x, dd, 0.0), P(x, dd, 0.12), 0.025, 0.5);
      }
      member(G, 'e6_timber', P(xa, da, 0.145), P(xb, db, 0.145), 0.22, 0.7);
    }
  }
  // ---- rain runs under a third of the sills (down to what stands proud below them: the string course, the plinth),
  // salt bloom on the quay front's plinth: faces 8 mm proud
  const runs = (zF, nz, xs) => {
    for (const [xc, ysill, yfloor] of xs) {
      if (R() > 0.45) continue;
      const w = 0.35 + R() * 0.55, len = Math.min(0.6 + R() * 1.4, ysill - 0.1 - yfloor), z = zF + nz * 0.008;
      if (len < 0.15) continue;
      const a = [xc - w / 2, ysill - 0.1, z], b = [xc + w / 2, ysill - 0.1, z], c = [xc + w * 0.18, ysill - 0.1 - len, z], d = [xc - w * 0.22, ysill - 0.1 - len * 0.8, z];
      face(G, 'e6_brick', [a, b, c, d], [0, 0, nz], 0.62 + R() * 0.1);
    }
  };
  const S = [];
  for (let c = 2.6; c < (x1 - x0) - 2; c += 3.4) { if (Math.abs(c - (80 - x0)) < 2.2) continue; S.push([x0 + c, 1.1, 0.82], [x0 + c, 5.1, 4.55]); }
  runs(z1 + 0.003, 1, S);
  runs(z0 - 0.003, -1, [53, 57, 95, 99].flatMap((x) => [[x, 1.1, 0.82], [x, 5.1, 4.55]]));
  for (let x = x0 + 0.6; x < x1 - 1.0;) {
    const w = Math.min(0.5 + R() * 1.8, x1 - 0.6 - x);
    if (R() < 0.55 && !(x + w > tw0 && x < tw1)) {
      const h0 = 0.08 + R() * 0.12, h1 = 0.18 + R() * 0.3, z = z0 - 0.05 - 0.008;
      face(G, 'e6_dial', [[x, h0, z], [x + w, h0 + R() * 0.05, z], [x + w * 0.85, h1, z], [x + w * 0.2, h1 * (0.7 + R() * 0.3), z]], [0, 0, -1], 0.85 + R() * 0.1);
    }
    x += w + 0.4 + R() * 2.2;
  }
  // ---- repaired patches of newer, paler brick between the yard front's windows (1.2 cm proud)
  for (const [xa, ya, w, h] of [[66.95, 3.7, 1.75, 1.2], [91.05, 0.9, 1.6, 1.6]]) {
    // (from 2 mm inside the face to 12 mm out: its back face, turned to the wall, is never drawn)
    G.box('e6_brick', xa + w / 2, ya + h / 2, z1 + 0.005, w, h, 0.014, 0, 1.18);
  }
  // ---- an enamel sign beside the hall's door in the clock tower (on the tower's quay face, west of the portal): an
  // iron plate 1.2 cm proud, the enamel on it
  const sx = clock.x - 2.2 + 0.94, sz = clock.z - 2.2;
  G.box('e6_iron', sx, 1.95, sz - 0.004, 0.66, 0.34, 0.016, 0, 0.55);
  extras.decals.push({ tex: 'wartesaal', w: 0.62, h: 0.3, p: [sx, 1.95, sz - 0.022], n: [0, 0, -1] });
}

/**
 * Snow banked up behind a snow guard bar on the hall's slope `P` (the bar at d 0.09, 17 cm out) from x = xa to xb: its
 * face against the bar, 10–22 cm deep there, thinning uphill to nothing ~0.9 m up; its edges and ends tucked 3 cm into
 * the slates (never lying in their plane). In 'e6_slate': the slates' own snow covers it.
 */
function guardBank(G, P, xa, xb, R) {
  const n = Math.max(2, Math.ceil((xb - xa) / 0.35)), D = [0.083, 0.094, 0.13, 0.17, 0.205];
  const rows = [];
  let hv = 0.12 + R() * 0.08;
  for (let k = 0; k <= n; k++) {
    const x = xa + ((xb - xa) * k) / n, end = k === 0 || k === n;
    hv = Math.max(0.08, Math.min(0.24, 0.6 * hv + 0.4 * (0.1 + R() * 0.14)));
    const h = end ? -0.03 : hv;
    rows.push([P(x, D[0], -0.03), P(x, D[1], h), P(x, D[2], end ? -0.03 : h * 0.62), P(x, D[3], end ? -0.03 : h * 0.24), P(x, D[4], -0.03)]);
  }
  const up = P(0, 0.5, 1).map((v, i) => v - P(0, 0.5, 0)[i]);
  for (let k = 0; k < n; k++) for (let i = 0; i < 4; i++) face(G, 'e6_slate', [rows[k][i], rows[k + 1][i], rows[k + 1][i + 1], rows[k][i + 1]], up, 1);
}
/**
 * A drift filling a valley where the hall's slope `P` (side: -1 north, +1 south) runs into a wing's inner slope
 * (`wingY`(x), its ridge at xc, its eave at xe): a soft roll of snow along the valley line from the eave nearly to the
 * hall's ridge, deepest low down, its edges and ends tucked 3 cm under the slates.
 */
function valleyDrift(G, P, wingY, xc, xe, side, R) {
  // the valley line: where the hall's slope stands as high as the wing's, from d 0 (the eave) up
  const hallY = (d) => P(0, d, 0)[1];
  const xAt = (d) => { // the x on the wing's inner slope at the hall's height for d
    const y = hallY(d), f = (y - wingY(xe)) / (wingY(xc) - wingY(xe));
    return xe + (xc - xe) * f;
  };
  const N = 12, d0 = 0.02, d1 = 0.86, rows = [];
  const pz = (d) => P(0, d, 0)[2];
  for (let k = 0; k <= N; k++) {
    const d = d0 + ((d1 - d0) * k) / N, x = xAt(d), z = pz(d), y = hallY(d), end = k === 0 || k === N;
    // the plan's perpendicular to the valley line here
    const dn = Math.min(d1, d + 0.02), dx = xAt(dn) - x, dz = pz(dn) - z, l = Math.hypot(dx, dz) || 1, px = -dz / l, pzz = dx / l;
    const w = (0.95 - 0.55 * (k / N)) * (0.85 + 0.3 * R()), h = end ? -0.03 : (0.14 + 0.16 * (1 - k / N)) * (0.85 + 0.3 * R());
    const at = (s, lift) => {
      const qx = x + px * s * w / 2, qz = z + pzz * s * w / 2;
      // (the roof there: the higher of the two slopes)
      const dq = Math.max(0, Math.min(1, (qz - pz(0)) / (pz(1) - pz(0)))), yr = Math.max(hallY(dq), wingY(qx));
      return [qx, yr + lift, qz];
    };
    rows.push([at(-1, -0.03), at(-0.5, end ? -0.03 : h * 0.62), [x, y + h, z], at(0.5, end ? -0.03 : h * 0.62), at(1, -0.03)]);
  }
  for (let k = 0; k < N; k++) for (let i = 0; i < 4; i++) face(G, 'e6_slate', [rows[k][i], rows[k + 1][i], rows[k + 1][i + 1], rows[k][i + 1]], [0, 1, 0], 1);
}

/** The terminal's clock tower: brick shaft to the gallery (y = deck), open arcade, clock stage, verdigris spire. */
function buildClockTower(G, c, lit, R) {
  const h = 2.2, x0 = c.x - h, x1 = c.x + h, z0 = c.z - h, z1 = c.z + h, y = c.y, inside = [c.x, c.z], t = 0.5;
  const shaft = (side) => {
    const ops = [];
    if (side === 'N') ops.push({ u0: h - 0.85, u1: h + 0.85, v0: 0, v1: 3.4, kind: 'portal' }, { u0: h - 0.45, u1: h + 0.45, v0: 5.0, v1: 6.6, kind: 'arch', lit: R() < 0.25 });
    else ops.push({ u0: h - 0.45, u1: h + 0.45, v0: 5.0, v1: 6.6, kind: 'arch', lit: R() < 0.2 });
    ops.push({ u0: h - 0.35, u1: h + 0.35, v0: 7.6, v1: 8.7, kind: 'win', lit: false });
    return ops;
  };
  brickWall(G, segFrame([x0, z0], [x1, z0], inside), 2 * h, 0, y - 0.6, shaft('N'), { t, lit });
  brickWall(G, segFrame([x0, z1], [x1, z1], inside), 2 * h, 0, y - 0.6, [], { t, lit });
  brickWall(G, segFrame([x0, z0 + t], [x0, z1 - t], inside), 2 * (h - t), 0, y - 0.6, shaft('W').map((o) => ({ ...o, u0: o.u0 - t, u1: o.u1 - t })), { t, lit });
  brickWall(G, segFrame([x1, z0 + t], [x1, z1 - t], inside), 2 * (h - t), 0, y - 0.6, shaft('E').map((o) => ({ ...o, u0: o.u0 - t, u1: o.u1 - t })), { t, lit });
  // corner pilasters, the plinth and a round-arched corbel frieze under the gallery
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) G.box('e6_clinker', c.x + sx * (h - 0.18), (y - 0.6) / 2, c.z + sz * (h - 0.18), 0.56, y - 0.6, 0.56, 0, 0.85);
  for (const [a, b] of [[[x0, z0], [x1, z0]], [[x0, z1], [x1, z1]], [[x0, z0], [x0, z1]], [[x1, z0], [x1, z1]]]) {
    const F = segFrame(a, b, inside);
    segBox(G, 'e6_clinker', F, 0.3, 2 * h - 0.3, -0.05, 0.05, 0, 0.8, 0.8);
    segBox(G, 'e6_clinker', F, 0.1, 2 * h - 0.1, -0.05, 0.12, y - 0.6, y - 0.32, 0.8);
    for (let u = 0.45; u < 2 * h - 0.3; u += 0.55) segBox(G, 'e6_clinker', F, u - 0.07, u + 0.07, -0.05, 0.12, y - 0.95, y - 0.6, 0.75);
  }
  // the gallery: a granite slab (its top is the deck, y), corner piers, an iron railing, the clock stage over it
  G.box('e6_granite', c.x, y - 0.16, c.z, 2 * h + 0.5, 0.32, 2 * h + 0.5, 0, 0.9);
  const pier = 0.42, top = y + 2.9;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) G.box('e6_brick', c.x + sx * (h - pier / 2 + 0.05), (y + top) / 2, c.z + sz * (h - pier / 2 + 0.05), pier, top - y, pier, 0, 0.92);
  const e = h + 0.12;
  for (const [a, b] of [[[-e, -e], [e, -e]], [[e, -e], [e, e]], [[e, e], [-e, e]], [[-e, e], [-e, -e]]]) {
    member(G, 'e6_iron', [c.x + a[0], y + 1.0, c.z + a[1]], [c.x + b[0], y + 1.0, c.z + b[1]], 0.05);
    member(G, 'e6_iron', [c.x + a[0], y + 0.5, c.z + a[1]], [c.x + b[0], y + 0.5, c.z + b[1]], 0.03);
    for (let k = 1; k < 9; k++) { const f = k / 9, x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f; member(G, 'e6_iron', [c.x + x, y, c.z + z], [c.x + x, y + 1.0, c.z + z], 0.025); }
  }
  // the clock stage: a brick drum on a slab, dials on the four faces, a cornice
  G.box('e6_granite', c.x, top + 0.12, c.z, 2 * h + 0.3, 0.24, 2 * h + 0.3, 0, 0.88);
  G.box('e6_brick', c.x, top + 0.24 + 1.3, c.z, 2 * h - 0.1, 2.6, 2 * h - 0.1, 0, 0.95);
  G.box('e6_clinker', c.x, top + 2.95, c.z, 2 * h + 0.25, 0.3, 2 * h + 0.25, 0, 0.8);
  const yc = top + 1.55;
  for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const fx = c.x + nx * (h - 0.05), fz = c.z + nz * (h - 0.05), F = segFrame([fx - nz * 1, fz + nx * 1], [fx + nz * 1, fz - nx * 1], [c.x, c.z]);
    // dial: a white disc of 16 facets 6 cm proud, a dark rim, two hands (twenty to five)
    const ring = (r, w) => Array.from({ length: 17 }, (_, k) => { const a = (k / 16) * Math.PI * 2; return F.at(1 + Math.cos(a) * r, w).concat([yc + Math.sin(a) * r]); });
    const rim = ring(0.95, 0.05), disc = ring(0.86, 0.08);
    const P3 = (q) => [q[0], q[2], q[1]], cn = [F.n[0], 0, F.n[1]], [ccx, ccz] = F.at(1, 0.08);
    for (let k = 0; k < 16; k++) {
      face(G, 'e6_iron', [P3(rim[k]), P3(rim[k + 1]), [ccx - F.n[0] * 0.03, yc, ccz - F.n[1] * 0.03]], cn, 0.6);
      face(G, 'e6_dial', [P3(disc[k]), P3(disc[k + 1]), [ccx, yc, ccz]], cn, 1.0);
    }
    for (const [ang, len, w] of [[deg(-50), 0.48, 0.07], [deg(150), 0.72, 0.05]]) {
      const [hx, hz] = F.at(1 + Math.cos(ang) * len, 0.1);
      member(G, 'e6_black', [ccx + F.n[0] * 0.02, yc, ccz + F.n[1] * 0.02], [hx, yc + Math.sin(ang) * len, hz], w);
    }
  }
  // the spire: eaves, a four-sided verdigris pyramid, a ball and a vane rod
  const ys = top + 3.1, sh = h + 0.35;
  G.box('e6_copper', c.x, ys + 0.06, c.z, 2 * sh, 0.12, 2 * sh, 0, 0.85);
  const ap = [c.x, ys + 6.2, c.z];
  for (const [a, b] of [[[-sh, -sh], [sh, -sh]], [[sh, -sh], [sh, sh]], [[sh, sh], [-sh, sh]], [[-sh, sh], [-sh, -sh]]]) {
    const A = [c.x + a[0], ys + 0.12, c.z + a[1]], B = [c.x + b[0], ys + 0.12, c.z + b[1]], m = [(a[0] + b[0]) / 2, 0.6, (a[1] + b[1]) / 2];
    face(G, 'e6_copper', [A, B, ap], m, 0.9);
  }
  G.cyl('e6_copper', ap[0], ap[1] - 0.2, ap[2], 0.16, 0.16, 0.32, 10, 0.85);
  member(G, 'e6_iron', [ap[0], ap[1], ap[2]], [ap[0], ap[1] + 1.4, ap[2]], 0.05);
  member(G, 'e6_iron', [ap[0] - 0.35, ap[1] + 1.1, ap[2]], [ap[0] + 0.45, ap[1] + 1.1, ap[2]], 0.04);
}

// ---------------------------------------------------------------- the searchlight tower at the harbour mouth
function buildSearchlightTower(G, T, lit) {
  const h = 2.25, y = T.y, x0 = T.x - h, x1 = T.x + h, z0 = T.z - h, z1 = T.z + h;
  // board-marked concrete, slightly battered (the base 10 cm wider), a darker splash band at the foot
  const fh = h - 0.05; // (the shaft's face, 5 cm inside the footprint)
  G.box('e6_conc', T.x, (y - 0.25) / 2, T.z, 2 * fh, y - 0.25, 2 * fh, 0, 0.95);
  G.box('e6_conc', T.x, 0.3, T.z, 2 * h + 0.04, 0.6, 2 * h + 0.04, 0, 0.72);
  // the deck slab (its top is the walk height y), a parapet on its edge with a gap at the ladder, drain spouts
  G.box('e6_conc', T.x, y - 0.14, T.z, 2 * h + 0.5, 0.28, 2 * h + 0.5, 0, 0.9);
  const e = h + 0.25, pt = 0.18, ph = 0.95, lad = [30.6 - 0.55, 30.6 + 0.55];
  G.box('e6_conc', T.x, y + ph / 2, z0 - 0.25 + pt / 2, 2 * e, ph, pt, 0, 0.88);
  G.box('e6_conc', T.x, y + ph / 2, z1 + 0.25 - pt / 2, 2 * e, ph, pt, 0, 0.88);
  G.box('e6_conc', x1 + 0.25 - pt / 2, y + ph / 2, T.z, pt, ph, 2 * e - 2 * pt, 0, 0.88);
  // (west parapet in two pieces round the ladder's head)
  const wx = x0 - 0.25 + pt / 2, zA = z0 - 0.25 + pt, zB = z1 + 0.25 - pt;
  G.box('e6_conc', wx, y + ph / 2, (zA + lad[0]) / 2, pt, ph, lad[0] - zA, 0, 0.88);
  G.box('e6_conc', wx, y + ph / 2, (lad[1] + zB) / 2, pt, ph, zB - lad[1], 0, 0.88);
  for (const [sx, sz] of [[-1, -1], [1, 1]]) G.box('e6_iron', T.x + sx * (e + 0.12), y - 0.05, T.z + sz * (h - 0.6), 0.3, 0.08, 0.1, 0, 0.6);
  // observation slits on the north and east faces, a drip band under the deck, rust runs under the spouts
  for (const [sx, sz, along] of [[0, -1, 'x'], [1, 0, 'z']]) {
    for (const k of [-0.9, 0.9]) {
      const cx = T.x + sx * (fh + 0.01) + (along === 'x' ? k : 0), cz = T.z + sz * (fh + 0.01) + (along === 'z' ? k : 0);
      G.box('e6_iron', cx, y - 1.3, cz, along === 'x' ? 0.55 : 0.06, 0.16, along === 'x' ? 0.06 : 0.55, 0, 0.35);
    }
  }
  for (const [a, b, n] of [[[x0, z0], [x1, z0], 'N'], [[x0, z1], [x1, z1], 'S'], [[x0, z0], [x0, z1], 'W'], [[x1, z0], [x1, z1], 'E']]) {
    const F = segFrame(a, b, [T.x, T.z]);
    segBox(G, 'e6_conc', F, -0.1, 2 * h + 0.1, -0.1, 0.07, y - 0.6, y - 0.42, 0.8);
    void n;
  }
  for (const [sx, sz] of [[-1, -1], [1, 1]]) G.box('e6_rust', T.x + sx * (fh + 0.006), y - 1.4, T.z + sz * (h - 0.6), 0.02, 2.4, 0.12, 0, 0.75);
  // an iron door at the foot of the east face, a cable conduit up the south face
  G.box('e6_iron', T.x + fh + 0.01, 1.1, T.z + 0.4, 0.06, 2.0, 0.95, 0, 0.62);
  member(G, 'e6_iron', [T.x + 0.9, 0.6, T.z + fh + 0.03], [T.x + 0.9, y - 0.3, T.z + fh + 0.03], 0.08);
  // the ladder on the channel face: stiles from the mole top over the parapet's gap, rungs every 0.3 m; its foot
  // continues down the mole's face into the water (the Marine comes up out of the channel)
  const lx = 97.95, lz = 30.6;
  // (the ladder from the mole top to the deck is the game's own ladder for `lad_sl`: only its foot is drawn here)
  for (const s of [-0.24, 0.24]) {
    member(G, 'e6_iron', [96.95, -1.4, lz + s], [96.95, 0.6, lz + s], 0.05);
    member(G, 'e6_iron', [96.95, 0.6, lz + s], [lx - 0.12, 0.6, lz + s], 0.04);
  }
  for (let yy = -1.2; yy < 0.5; yy += 0.3) member(G, 'e6_iron', [96.95, yy, lz - 0.24], [96.95, yy, lz + 0.24], 0.03);
  for (const s of [-0.24, 0.24]) member(G, 'e6_iron', [lx, 0.9, lz + s], [T.x - fh + 0.04, 0.9, lz + s], 0.04); // (stays to the wall)
  void lit;
}

// ---------------------------------------------------------------- the span master's cabin
/** A notice on a wall (paper or enamel, a canvas of its own): a decal plane 1.5 cm off the wall. */
function noticeTexture(lines, bg = 'rgb(214,206,180)', fg = 'rgb(40,32,26)', w = 128, h = 160) {
  if (!HAS_DOM) return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  // weathered: a water stain, a torn corner
  const st = x.createLinearGradient(0, h * 0.5, 0, h); st.addColorStop(0, 'rgba(90,80,60,0)'); st.addColorStop(1, 'rgba(90,80,60,0.35)');
  x.fillStyle = st; x.fillRect(0, 0, w, h);
  x.fillStyle = fg;
  for (const [txt, px, py, size] of lines) { x.font = `bold ${size}px "DejaVu Sans Condensed", Arial Narrow, sans-serif`; x.fillText(txt, px, py); }
  x.clearRect(w - 14, 0, 14, 10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function buildCabin(G, C, lit, extras) {
  const t = 0.3, h = 3.0, inside = [(C.x0 + C.x1) / 2, (C.z0 + C.z1) / 2];
  // the walls on the gameplay lines (0.3 m centred on them): outer face 0.15 m out
  const X0 = C.x0 - 0.15, X1 = C.x1 + 0.15, Z0 = C.z0 - 0.15, Z1 = C.z1 + 0.15;
  const W = X1 - X0, D = Z1 - Z0;
  brickWall(G, segFrame([X0, Z0], [X1, Z0], inside), W, 0, h, [{ u0: 2.5, u1: 3.6, v0: 1.2, v1: 2.1, kind: 'win', lit: false }], { t, lit });
  // the south wall (towards the berth quay): a small window, half boarded over where a pane was broken; a notice beside it
  const FS = segFrame([X0, Z1], [X1, Z1], inside);
  brickWall(G, FS, W, 0, h, [{ u0: 1.0, u1: 1.85, v0: 1.25, v1: 2.15, kind: 'win', lit: false }], { t, lit });
  const PS = (u, w, y) => { const [x, z] = FS.at(u, w); return [x, y, z]; };
  for (const [ua, va, ub, vb] of [[0.92, 1.42, 1.93, 1.62], [0.95, 1.83, 1.9, 1.7]]) { // two planks nailed across the lower panes
    const a = PS(ua, 0.03, va), b = PS(ub, 0.03, vb);
    member(G, 'e6_door', a, b, 0.11, 0.8);
  }
  extras.decals.push({ tex: 'cabin_notice', w: 0.42, h: 0.55, p: PS(2.95, 0.017, 1.75), n: [FS.n[0], 0, FS.n[1]] });
  // the west wall: the wide window over the span
  brickWall(G, segFrame([X0, Z0 + t], [X0, Z1 - t], inside), D - 2 * t, 0, h, [{ u0: 0.55, u1: 2.75, v0: 1.0, v1: 2.15, kind: 'win', lit: true }], { t, lit });
  // the east wall: its door gap (the gameplay gap z door[0]..door[1]) open to the lintel
  const g0 = C.door[0] - (Z0 + t), g1 = C.door[1] - (Z0 + t);
  brickWall(G, segFrame([X1, Z0 + t], [X1, Z1 - t], inside), D - 2 * t, 0, h, [{ u0: g0, u1: g1, v0: 0, v1: 2.25, kind: 'gap' }], { t, lit });
  // the door leaf thrown open outward against the wall north of the gap; a coal scuttle by the door
  G.box('e6_door', X1 + 0.05, 1.08, C.door[0] - 0.5, 0.06, 2.1, 0.92, 0, 0.85);
  G.cyl('e6_iron', X1 + 0.42, 0.0, C.door[1] + 0.42, 0.17, 0.2, 0.34, 10, 0.55);
  G.cyl('e6_coal', X1 + 0.42, 0.3, C.door[1] + 0.42, 0.15, 0.15, 0.06, 9, 0.8);
  member(G, 'e6_iron', [X1 + 0.27, 0.36, C.door[1] + 0.42], [X1 + 0.57, 0.36, C.door[1] + 0.42], 0.025, 0.5);
  // plinth band, corner quoins
  for (const [sx, sz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) G.box('e6_clinker', sx ? X1 - 0.17 : X0 + 0.17, h / 2, sz ? Z1 - 0.17 : Z0 + 0.17, 0.46, h, 0.46, 0, 0.82);
  // a tarred-felt hip roof over 0.3 m eaves: the felt laid in strips over battens down the slopes, a patch or two
  const ex = 0.32, yE = h - 0.04, ap = 1.25;
  const E = [[X0 - ex, Z0 - ex], [X1 + ex, Z0 - ex], [X1 + ex, Z1 + ex], [X0 - ex, Z1 + ex]];
  const r0 = [X0 + D / 2, yE + ap, (Z0 + Z1) / 2], r1 = [X1 - D / 2, yE + ap, (Z0 + Z1) / 2];
  const P = (q) => [q[0], yE, q[1]];
  // (the felt over the stove's warmth: the snow on it thin and broken — e6_felt_warm, SNOW_BIAS — caught along the battens)
  face(G, 'e6_felt_warm', [P(E[0]), P(E[1]), r1, r0], [0, 1, -1], 0.92);
  face(G, 'e6_felt_warm', [P(E[2]), P(E[3]), r0, r1], [0, 1, 1], 0.92);
  face(G, 'e6_felt_warm', [P(E[3]), P(E[0]), r0], [-1, 1, 0], 0.9);
  face(G, 'e6_felt_warm', [P(E[1]), P(E[2]), r1], [1, 1, 0], 0.9);
  // battens over the felt's laps, eave to ridge (or to the hip) on the long slopes, 3 cm proud of the felt
  const zc = (Z0 + Z1) / 2, run = D / 2 + ex, Ls = Math.hypot(run, ap);
  for (const side of [-1, 1]) {
    const ze = side < 0 ? Z0 - ex : Z1 + ex, ny = run / Ls, nz = side * ap / Ls; // (the slope's outward normal)
    const top = (x) => { // where a batten up the slope from (x, ze) ends: the ridge, or the hip line
      const xl = X0 - ex, xr = X1 + ex;
      const s = x < r0[0] ? (x - xl) / (r0[0] - xl) : x > r1[0] ? (xr - x) / (xr - r1[0]) : 1;
      return [x, yE + ap * s, ze + (zc - ze) * s];
    };
    let k = 0;
    for (let x = X0 - ex + 0.42; x < X1 + ex - 0.3; x += 0.58 + 0.08 * Math.sin(++k * 2.3)) {
      const a = [x, yE, ze], b = top(x);
      if (b[1] - yE < 0.25) continue;
      member(G, 'e6_timber', [a[0], a[1] + ny * 0.03, a[2] + nz * 0.03], [b[0], b[1] + ny * 0.03 - 0.02, b[2] + nz * 0.03], 0.045, 0.6);
    }
  }
  face(G, 'e6_timber', E.map((q) => [q[0], yE - 0.02, q[1]]), [0, -1, 0], 0.6); // soffit
  for (let i = 0; i < 4; i++) { const a = E[i], b = E[(i + 1) % 4]; member(G, 'e6_timber', [a[0], yE - 0.08, a[1]], [b[0], yE - 0.08, b[1]], 0.12, 0.7); }
  // the stove pipe through the south slope: a flashing collar where it leaves the felt, the pipe sooted black over its
  // top foot, a shallow "Chinese hat" cowl on three stays a hand over its mouth (wider than the pipe, flat: the hat, not
  // a point); its soot down the felt below is a decal (extras.decals)
  const sx = X1 - 1.1, sz = Z1 - 1.0, rise = yE + ap * ((Z1 + ex) - sz) / run, pt = yE + 1.62;
  G.cyl('e6_iron', sx, rise - 0.15, sz, 0.075, 0.075, pt - rise + 0.15, 8, 0.6);
  G.cyl('e6_rail', sx, pt - 0.3, sz, 0.082, 0.082, 0.3, 8, 0.5, { caps: false }); // (its top foot sooted: a sleeve 7 mm proud of the pipe, open ends)
  G.cyl('e6_iron', sx, rise - 0.08, sz, 0.15, 0.09, 0.1, 8, 0.55, { caps: false }); // (the flashing collar)
  G.cyl('e6_rail', sx, pt + 0.1, sz, 0.2, 0.03, 0.07, 10, 0.45); // (the hat)
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4, c = Math.cos(a), s2 = Math.sin(a);
    member(G, 'e6_rail', [sx + c * 0.08, pt - 0.04, sz + s2 * 0.08], [sx + c * 0.13, pt + 0.11, sz + s2 * 0.13], 0.014, 0.5);
  }
  {
    const n2 = [0, run / Ls, ap / Ls];
    extras.decals.push({ tex: 'soot', w: 0.42, h: 0.85, p: [sx + 0.02, yE + ap * ((Z1 + ex) - (sz + 0.42)) / run + 0.02, sz + 0.42 + n2[2] * 0.02], n: n2 });
  }
  // a gutter along the south eave and its downpipe down the south-east corner, a shoe at its foot
  member(G, 'e6_iron', [X0 - ex + 0.05, yE - 0.11, Z1 + ex + 0.115], [X1 + ex - 0.05, yE - 0.11, Z1 + ex + 0.115], 0.1, 0.75);
  member(G, 'e6_iron', [X1 - 0.2, yE - 0.16, Z1 + ex + 0.115], [X1 - 0.2, yE - 0.45, Z1 + 0.12], 0.07, 0.7);
  member(G, 'e6_iron', [X1 - 0.2, yE - 0.45, Z1 + 0.12], [X1 - 0.2, 0.25, Z1 + 0.12], 0.075, 0.7);
  member(G, 'e6_iron', [X1 - 0.2, 0.25, Z1 + 0.12], [X1 - 0.2, 0.08, Z1 + 0.42], 0.075, 0.7);
  // inside: the span's switch box on the west wall by the north-west corner (flat to the wall: the man who works it
  // stands in front of it), its lever up
  G.box('e6_steel', C.x0 + 0.29, 1.3, 57.3, 0.26, 0.75, 0.55, 0, 0.8);
  member(G, 'e6_red', [C.x0 + 0.42, 1.4, 57.3], [C.x0 + 0.5, 1.82, 57.3], 0.045);
}

// ---------------------------------------------------------------- the rail link-span and its gantry
const SPAN_RAISE = deg(22); // the outer end ~5 m up
/** The deck (in the pivot's frame: hinge at the origin, the deck along -z, its top at y 0.03). */
function buildSpanDeck(S) {
  const G = new Geo('e06-span'), L = S.d, hw = S.w / 2, top = 0.03;
  // two plate girders along the sides, cross girders, the deck plate, rails on longitudinal timbers
  for (const s of [-1, 1]) {
    const x = s * (hw - 0.22);
    G.box('e6_steel', x, -0.28, -L / 2, 0.2, 1.2, L - 0.1, 0, 0.9);
    G.box('e6_steel', x, 0.33, -L / 2, 0.44, 0.06, L - 0.1, 0, 0.85);
    G.box('e6_steel', x, -0.89, -L / 2, 0.44, 0.06, L - 0.1, 0, 0.8);
    for (let z = -L + 0.6; z < -0.3; z += 1.4) G.box('e6_steel', x + s * 0.12, -0.28, z, 0.06, 1.1, 0.12, 0, 0.75); // web stiffeners
    // handrail: posts, a top rail and a knee rail on the girder's outer flange
    for (let z = -L + 0.3; z <= -0.2; z += 1.75) member(G, 'e6_iron', [x + s * 0.12, 0.36, z], [x + s * 0.12, 1.36, z], 0.05);
    member(G, 'e6_iron', [x + s * 0.12, 1.36, -L + 0.3], [x + s * 0.12, 1.36, -0.2], 0.05);
    member(G, 'e6_iron', [x + s * 0.12, 0.86, -L + 0.3], [x + s * 0.12, 0.86, -0.2], 0.035);
    // the lifting lug at the outer corner
    G.box('e6_steel', s * (hw + 0.05), 0.05, -L + 0.45, 0.25, 0.5, 0.4, 0, 0.8);
  }
  // (the deck plate's own material: riveted plate; its snow and wear are spanDeckCrust's decal)
  G.box('e6_deck', 0, top - 0.06, -L / 2, S.w - 0.9, 0.12, L - 0.1, 0, 0.82);
  // the toe plate at the hinge end, 12 mm of steel lapped over the deck plate where it rests on the quay: lowered, the
  // plate's last 0.35 m lies over the end of the quay's track bed, the two tops one plane (they fought, r3 jitter check)
  G.box('e6_deck', 0, top + 0.005, -0.25, S.w - 0.9, 0.014, 0.4, 0, 0.78);
  for (let z = -L + 0.7; z < -0.3; z += 1.75) G.box('e6_steel', 0, -0.4, z, S.w - 0.9, 0.5, 0.14, 0, 0.75);
  for (const s of [-1, 1]) {
    G.box('e6_timber', s * 0.7175, top + 0.04, -L / 2, 0.3, 0.08, L - 0.1, 0, 0.75);
    G.box('e6_rail', s * 0.7175, top + 0.135, -L / 2, 0.07, 0.11, L - 0.1, 0, 0.7);
  }
  // the outer end: a hinged apron lip and its stop
  G.box('e6_steel', 0, -0.02, -L - 0.3, S.w - 0.6, 0.08, 0.6, 0, 0.78);
  G.box('e6_rust', 0, -0.35, -L + 0.05, S.w - 0.7, 0.55, 0.12, 0, 0.7);
  spanDeckWear(G, S, L, hw, top);
  return G.build('e06:span', { ground: -1, damp: 0, streaks: 0.08, moss: 0 });
}
/**
 * The deck's riveting and wear (art review r1: "three smooth, untextured grey slabs … no rivets, plate seams, rust, ice
 * or grime"): the deck plates' butt straps across it, a worn bright band down the middle where the shunters walk,
 * rivet rows along the girders' top flanges, rust run from the rivets down the girders' webs, a salt tide-mark along their
 * foot, snow and ice packed in the rails' grooves (broken where the wheels last ran). Every piece a real step proud of
 * what it lies on (>= 4 mm on the deck, 12 mm on a web).
 */
function spanDeckWear(G, S, L, hw, top) {
  const R = rng(seedOf('e06-span-wear'));
  const dw = S.w - 0.9;
  for (let z = -L + 0.9; z < -0.4; z += 1.75) G.box('e6_deck', 0, top + 0.006, z, dw - 0.05, 0.012, 0.07, 0, 0.72);
  // (the rust bled out of the plate's seams and from under the rail chairs: spanRustStreaks, decals in the deck's pivot —
  // verifier r2: the stains drawn here as solid patches "read as red flakes")
  // (every strip below runs from z to at most 0.1 m short of the deck's hinge end: nothing hangs past the plate)
  const run = (z, len) => { const e = Math.min(z + len, -0.1); return [(z + e) / 2, e - z]; };
  // (the shunters' trodden way between the rails — long, feathered wet streaks of bare plate — and the deck's snow are
  // one painted decal over the plate: spanDeckCrust; verifier r3: the worn patches drawn here as heptagons read as dark
  // angular shards, and the plate's held-back prop snow broke up into square steps)
  for (const s of [-1, 1]) {
    const gx = s * (hw - 0.22);
    // rivets: two rows on the top flange, one down each stiffener
    for (const off of [-0.15, 0.15]) for (let z = -L + 0.2; z < -0.15; z += 0.22) G.box('e6_iron', gx + off, 0.372, z, 0.034, 0.024, 0.034, 0, 0.55);
    for (let z = -L + 0.6; z < -0.3; z += 1.4) for (let y = -0.75; y < 0.2; y += 0.2) G.box('e6_iron', gx + s * 0.155, y, z, 0.02, 0.03, 0.03, 0, 0.5);
    // rust runs down the outer web from under the flange, a salt tide-mark along its foot
    const wx = s * (hw - 0.22 + 0.1 + 0.007);
    for (let z = -L + 0.3; z < -0.3; z += 0.35 + R() * 0.9) {
      const h = 0.25 + R() * 0.65;
      G.box('e6_rust', wx, 0.3 - h / 2, z, 0.012, h, 0.05 + R() * 0.07, 0, 0.6 + R() * 0.3);
    }
    for (let z = -L + 0.4; z < -0.6;) {
      const [zc, l] = run(z, 0.4 + R() * 1.6);
      G.box('e6_dial', wx, -0.78 + (R() - 0.5) * 0.06, zc, 0.012, 0.05 + R() * 0.06, l, 0, 0.8 + R() * 0.15);
      z += l + 0.2 + R() * 1.1;
    }
    // snow and ice in the rail's grooves, both sides of the head, in broken lengths
    const rx = s * 0.7175;
    for (const g of [-1, 1]) {
      for (let z = -L + 0.1; z < -0.4;) {
        const [zc, l] = run(z, 0.3 + R() * 1.4);
        // (white: packed snow and ice; it stands on the timber, 1.2 cm off the rail head)
        if (R() < 0.75) { const hh = 0.035 + R() * 0.02; G.box('e6_dial', rx + g * 0.072, top + 0.08 + hh / 2, zc, 0.05, hh, l, 0, 0.9 + R() * 0.1); }
        z += l + 0.1 + R() * 0.5;
      }
    }
  }
}

/** The fixed parts: hinge bearings on the quay, the gantry's piers and lattice legs, its cross girder and sheaves. */
function buildGantry(G, S, legs) {
  const zh = S.z + S.d / 2;
  for (const s of [-1, 1]) {
    G.box('e6_granite', S.x + s * (S.w / 2 - 0.6), -0.05, zh + 0.45, 1.0, 0.5, 0.9, 0, 0.8);
    G.cyl('e6_iron', S.x + s * (S.w / 2 - 0.6), 0.15, zh + 0.1, 0.18, 0.18, 0.12, 10, 0.6);
  }
  const top = 10;
  for (const L of legs) {
    G.box('e6_conc', L.x, -0.6, L.z, 1.6, 1.6, 1.6, 0, 0.85); // pier from the water (the leg's blocked footprint), 0.2 m over the ice
    const a = 0.72;
    const corners = [[-a, -a], [a, -a], [a, a], [-a, a]];
    for (const [cx, cz] of corners) member(G, 'e6_steel', [L.x + cx, 0.2, L.z + cz], [L.x + cx * 0.82, top, L.z + cz * 0.82], 0.16, 0.9);
    for (let y = 0.2; y < top - 0.1; y += 2.45) {
      const y1 = Math.min(top, y + 2.45), k0 = 1 - (0.18 * (y - 0.2)) / (top - 0.2), k1 = 1 - (0.18 * (y1 - 0.2)) / (top - 0.2);
      for (let i = 0; i < 4; i++) {
        const p = corners[i], q = corners[(i + 1) % 4];
        member(G, 'e6_steel', [L.x + p[0] * k1, y1, L.z + p[1] * k1], [L.x + q[0] * k1, y1, L.z + q[1] * k1], 0.1, 0.85);
        member(G, 'e6_steel', [L.x + p[0] * k0, y, L.z + p[1] * k0], [L.x + q[0] * k1, y1, L.z + q[1] * k1], 0.072, 0.8);
        member(G, 'e6_steel', [L.x + q[0] * k0, y, L.z + q[1] * k0], [L.x + p[0] * k1, y1, L.z + p[1] * k1], 0.058, 0.8);
      }
    }
  }
  // the cross girder over both legs and the span's end, the machinery house on it, four sheaves
  const xa = legs[0].x - 0.8, xb = legs[1].x + 0.8, zc = legs[0].z;
  G.box('e6_steel', (xa + xb) / 2, top + 0.45, zc, xb - xa, 0.9, 0.7, 0, 0.88);
  G.box('e6_steel', (xa + xb) / 2, top + 0.93, zc, xb - xa, 0.06, 1.0, 0, 0.82);
  G.box('e6_steel', (xa + xb) / 2, top + 1.65, zc, 3.2, 1.4, 1.8, 0, 0.85);
  G.box('e6_felt', (xa + xb) / 2, top + 2.42, zc, 3.5, 0.14, 2.1, 0, 0.8);
  // four sheaves on the girder (axles along z): over each leg and over each of the span's lifting lugs
  for (const x of [legs[0].x, S.x - S.w / 2 - 0.05, S.x + S.w / 2 + 0.05, legs[1].x]) {
    for (const s of [-1, 1]) {
      const seg = 14, r = 0.42, zz = zc + s * 0.07;
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
        face(G, 'e6_iron', [[x + Math.cos(a0) * r, top + 1.25 + Math.sin(a0) * r, zz], [x + Math.cos(a1) * r, top + 1.25 + Math.sin(a1) * r, zz], [x, top + 1.25, zz]], [0, 0, s], 0.7);
      }
    }
    for (let k = 0; k < 14; k++) {
      const a0 = (k / 14) * Math.PI * 2, a1 = ((k + 1) / 14) * Math.PI * 2, r = 0.42;
      face(G, 'e6_iron', [[x + Math.cos(a0) * r, top + 1.25 + Math.sin(a0) * r, zc - 0.07], [x + Math.cos(a1) * r, top + 1.25 + Math.sin(a1) * r, zc - 0.07], [x + Math.cos(a1) * r, top + 1.25 + Math.sin(a1) * r, zc + 0.07], [x + Math.cos(a0) * r, top + 1.25 + Math.sin(a0) * r, zc + 0.07]], [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0], 0.6);
    }
    G.box('e6_steel', x, top + 1.0, zc, 0.12, 0.5, 0.3, 0, 0.8); // its bearing block
  }
  void S;
}

/** Link-span: the moving deck, the chains and the counterweights, driven by the drawbridge's state each frame. */
function linkSpan(world, root, S, spanId, legs) {
  const G = new Geo('e06-gantry');
  buildGantry(G, S, legs);
  const fixed = G.build('e06:gantry', { ground: 0, damp: 0.6, streaks: 0.12, moss: 0, weather: WEATHER });
  root.add(fixed);
  const pivot = new THREE.Group();
  pivot.name = 'e06:span_pivot';
  pivot.position.set(S.x, 0, S.z + S.d / 2);
  pivot.add(buildSpanDeck(S));
  const rust = spanRustStreaks(S, S.d, 0.03); // (buildSpanDeck's L and plate top)
  if (rust) pivot.add(rust);
  const crust = spanDeckCrust(S, S.d, 0.03); // (the deck's own snow and trodden wet plate, over the rust)
  if (crust) pivot.add(crust);
  root.add(pivot);
  // chains (lug → sheave) and the counterweights inside the legs: thin boxes stretched each frame
  const iron = new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.55, metalness: 0.6, name: 'e06:chain' });
  const weightG = new Geo('e06-weights');
  weightG.box('e6_conc', 0, 0, 0, 0.95, 1.6, 0.95, 0, 0.8);
  weightG.box('e6_rust', 0, 0.86, 0, 0.3, 0.12, 0.3, 0, 0.7);
  const wproto = weightG.build('e06:weight', { ground: -9, damp: 0, streaks: 0.05, moss: 0 });
  const chain = () => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1, 0.07), iron); m.castShadow = true; root.add(m); return m; };
  const top = 10 + 1.25, sides = [-1, 1].map((s) => ({
    s, lugL: [s * (S.w / 2 + 0.05), 0.25, -S.d + 0.45], sheaveX: S.x + s * (S.w / 2 + 0.05), legX: legs[s < 0 ? 0 : 1].x,
    up: chain(), down: chain(), weight: wproto.clone(),
  }));
  for (const q of sides) root.add(q.weight);
  const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const stretch = (m, p, q) => {
    v.subVectors(q, p); const L = v.length();
    m.position.copy(p).addScaledVector(v, 0.5); m.scale.set(1, Math.max(0.01, L), 1);
    m.quaternion.setFromUnitVectors(Y, v.normalize());
  };
  let last = null;
  const T = 5;
  const update = () => {
    const d = world.interactables?.find?.((i) => (i.tag ?? i.id) === spanId);
    let f = 1;
    if (d) f = d.moving > 0 ? (d._target ? 1 - d.moving / T : d.moving / T) : d.raised ? 1 : 0;
    f = Math.max(0, Math.min(1, f));
    if (f === last) return;
    last = f;
    const th = f * SPAN_RAISE;
    pivot.rotation.x = th;
    pivot.updateMatrixWorld(true);
    for (const q of sides) {
      a.set(...q.lugL).applyMatrix4(pivot.matrixWorld);
      b.set(q.sheaveX, top - 0.3, legs[0].z);
      stretch(q.up, a, b);
      const cy = 2.6 + (1 - f) * 5.0; // (the weight rides high with the span down)
      q.weight.position.set(q.legX, cy, legs[0].z);
      stretch(q.down, new THREE.Vector3(q.legX, cy + 0.85, legs[0].z), new THREE.Vector3(q.legX, top - 0.3, legs[0].z));
    }
  };
  update();
  // (the deck's girders are drawn every frame the span is in view: their onBeforeRender drives the pose)
  pivot.traverse((m) => { if (m.isMesh && !m.onBeforeRender.__e06) { m.onBeforeRender = update; m.onBeforeRender.__e06 = true; } });
  fixed.traverse((m) => { if (m.isMesh) m.onBeforeRender = update; });
  return { pivot, update };
}

// ---------------------------------------------------------------- the sealed wagon and the shunting engine
/** Stencils on a canvas (white on transparent): the wagon's lettering. Node: null. */
function stencilTexture(lines, w = 512, h = 128) {
  if (!HAS_DOM) return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.clearRect(0, 0, w, h);
  x.fillStyle = 'rgba(232,228,214,0.92)';
  for (const [txt, px, py, size] of lines) { x.font = `bold ${size}px "DejaVu Sans Condensed", Arial Narrow, sans-serif`; x.fillText(txt, px, py); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/**
 * Soot down a slope below a stack or a pipe (a canvas of its own): many overlapping tongues of brown-black from the top
 * edge down, each its own width, length and strength — darkest at the stack, ragged at its sides, fading out downhill.
 */
function sootTexture(w = 64, h = 128) {
  if (!HAS_DOM) return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'), R = rng(seedOf('e06-soot'));
  x.clearRect(0, 0, w, h);
  for (let k = 0; k < 46; k++) {
    const cx = w * (0.5 + (R() - 0.5) * 0.55), len = h * (0.25 + Math.pow(R(), 0.7) * 0.72), rx = w * (0.06 + R() * 0.2);
    const g = x.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(22,17,14,${(0.07 + R() * 0.07).toFixed(3)})`); g.addColorStop(1, 'rgba(22,17,14,0)');
    x.fillStyle = g;
    x.beginPath(); x.ellipse(cx, 0, rx, len, 0, 0, Math.PI); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/**
 * Rust run from the span deck's seams and rail chairs (verifier r2: "long low-contrast streaks … desaturated
 * orange-brown, blended", not the red flakes of before): an atlas of `cols` streak clusters, each a faint wash under a
 * few tongues — each its own width, length and strength, wavering, narrowing, fading out downhill; soft-edged.
 */
function rustStreakTexture(cols = 4, w = 64, h = 256) {
  if (!HAS_DOM) return null;
  const c = document.createElement('canvas'); c.width = w * cols; c.height = h;
  const x = c.getContext('2d'), R = rng(seedOf('e06-rust-streaks'));
  x.clearRect(0, 0, c.width, c.height);
  x.filter = 'blur(1.2px)';
  const rgba = (r, g, b, a) => `rgba(${r | 0},${g | 0},${b | 0},${a.toFixed(3)})`;
  for (let col = 0; col < cols; col++) {
    const x0 = col * w;
    x.save(); x.beginPath(); x.rect(x0 + 2, 0, w - 4, h); x.clip(); // (no bleed into the next cluster)
    const wash = x.createLinearGradient(0, 0, 0, h * 0.7);
    wash.addColorStop(0, rgba(108, 78, 56, 0.24)); wash.addColorStop(1, rgba(108, 78, 56, 0));
    x.fillStyle = wash; x.beginPath(); x.ellipse(x0 + w * (0.4 + R() * 0.2), 0, w * (0.26 + R() * 0.12), h * (0.4 + R() * 0.3), 0, 0, Math.PI); x.fill();
    for (let k = 0, n = 3 + Math.floor(R() * 4); k < n; k++) {
      const cx = x0 + w * (0.18 + R() * 0.64), len = h * (0.3 + Math.pow(R(), 0.8) * 0.68), rw = w * (0.03 + R() * 0.08), a = 0.3 + R() * 0.26;
      const r = 122 + R() * 22, g = 80 + R() * 12, b = 50 + R() * 10; // (orange-brown, greyed)
      const grad = x.createLinearGradient(0, 0, 0, len);
      grad.addColorStop(0, rgba(r, g, b, a)); grad.addColorStop(0.55, rgba(r, g, b, a * 0.45)); grad.addColorStop(1, rgba(r, g, b, 0));
      x.fillStyle = grad;
      const steps = 14, L = [], Rt = [];
      let drift = 0;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, ww = rw * (1 - 0.75 * t) * (0.75 + 0.5 * R());
        drift += (R() - 0.5) * 1.2;
        L.push([cx + drift - ww, t * len]); Rt.push([cx + drift + ww, t * len]);
      }
      x.beginPath(); x.moveTo(...L[0]);
      for (const p of L) x.lineTo(...p);
      for (const p of Rt.reverse()) x.lineTo(...p);
      x.closePath(); x.fill();
    }
    x.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/**
 * The span deck's own snow and wear (verifier r3: the deck plate's held-back prop snow broke up into blocky, square-
 * stepped patches — "pixelated or 8-bit, not broken crust"; the trodden plate's worn patches read as "flat dark-grey
 * angular shards"). One field painted once over the plate (u across the deck from its centre line, v along it from its
 * outer end, metres): a domain-warped noise, its octaves turned against each other (no lattice steps) and drawn out down
 * the track, thresholded by a lane profile — drifts against the girders' webs and the rail timbers' outer faces, a crust
 * breaking up toward the rails, little between them where the shunters walk — with a soft rim (thin powder, then a damp
 * halo on the steel round each patch), small holes broken out of the crust, snow caught along the plate's butt straps,
 * and long, feathered wet streaks of bare plate, low in contrast, on the trodden way. A second map carries the roughness
 * (the snow matte, the wet plate glossy), a third the crust's thickness (~2 cm: its broken edges catch the light).
 * dw: the plate's width, len: its length, straps: the butt straps' v (m).
 */
function deckCrustTexture(dw, len, straps) {
  if (!HAS_DOM) return null;
  const W = 192, H = Math.round((W * len) / dw), m = dw / W; // (3.7 cm a texel: soft edges; painted once, at load)
  const seed = seedOf('e06-deck-crust') % 100000;
  const OCT = [0.7, 1.83, 2.96].map((a) => [Math.cos(a), Math.sin(a)]);
  /** Value noise summed over turned octaves, normalised to about zero mean and unit spread. */
  const fbmT = (x, z, oct, sd) => {
    let s = 0, amp = 1, f = 1;
    for (let o = 0; o < oct; o++) {
      const [c, sn] = OCT[o];
      s += amp * (vnoise((x * c - z * sn) * f, (x * sn + z * c) * f, sd + o * 31) - 0.5);
      amp *= 0.5; f *= 2.13;
    }
    return s * (oct > 2 ? 3.6 : 3.9);
  };
  // the lane profile: |u| → how readily the snow lies there (in the noise's spread)
  const LANE = [[0, -1.35], [0.45, -1.3], [0.5675, -0.35], [0.8675, 0.4], [0.97, 0.3], [1.15, -0.35], [1.7, -0.5],
    [2.5, -0.05], [3.1, 0.45], [3.4, 1.3], [dw / 2, 1.8]];
  const lane = (au) => {
    for (let k = 1; k < LANE.length; k++) if (au <= LANE[k][0]) {
      const [a0, b0] = LANE[k - 1], [a1, b1] = LANE[k], t = (au - a0) / (a1 - a0);
      return b0 + (b1 - b0) * t;
    }
    return LANE[LANE.length - 1][1];
  };
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const col = new Uint8ClampedArray(W * H * 4), rough = new Uint8ClampedArray(W * H * 4), hgt = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) * m;
    const along = (vnoise(0.37, v * 0.21, seed + 5) - 0.5) * 0.9; // (stretches with more or less on them)
    const quay = sstep(len - 1.8, len - 0.3, v); // (the quay end: trodden on and off)
    let strap = 0, sk = 0;
    for (let q = 0; q < straps.length; q++) {
      const d = Math.abs(v - straps[q]);
      if (d < 0.14 && 1 - sstep(0.03, 0.12, d) > strap) { strap = 1 - sstep(0.03, 0.12, d); sk = q; }
    }
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) * m - dw / 2, au = Math.abs(u);
      const wx = (vnoise(u * 0.8, v * 0.3, seed + 1) - 0.5) * 0.7, wv = (vnoise(u * 0.8 + 13.1, v * 0.3, seed + 2) - 0.5) * 1.4;
      const n = fbmT((u + wx) * 2.7, (v + wv) * 1.15, 3, seed + 3);
      // (the snow caught along a butt strap lies in broken lengths)
      const st = strap ? strap * sstep(0.38, 0.62, vnoise(u * 1.7, sk * 7.31, seed + 8)) * (au > 0.9 ? 0.8 : 0.35) : 0;
      const base = lane(au) + along - quay * 0.7 * (1 - sstep(2.2, 3.0, au)) + st;
      const c = base + n;
      // the crust: soft-edged patches with thin powder spreading past them, thick in places and thin in others (a thin
      // crust shows the plate through it, broken finer), small holes broken out of it in the outer lanes
      const thick = 0.6 + 0.4 * sstep(0.32, 0.68, vnoise(u * 0.75, v * 0.42, seed + 10));
      let aS = sstep(-0.3, 0.3, c) + 0.2 * sstep(-0.9, -0.25, c) * (1 - sstep(-0.3, 0.3, c));
      hgt[j * W + i] = aS * thick * (0.75 + 0.25 * sstep(0.2, 1.2, c));
      const g = vnoise(u * 15, v * 10, seed + 4);
      aS *= (0.9 + 0.1 * g) * (thick + (1 - thick) * 0.55 * g);
      if (au > 0.95 && c > 0.3 && c < 1.6) aS *= 1 - 0.7 * sstep(0.8, 0.9, vnoise(u * 8.5, v * 5.5, seed + 6)) * sstep(0.3, 0.7, c) * (1 - sstep(1.1, 1.6, c));
      // the wet plate: a damp halo round each patch and long streaks on the trodden way, feathered
      const halo = sstep(-1.4, -0.75, c) * (1 - sstep(-0.75, -0.25, c)) * 0.16;
      const wlane = au < 0.56 ? 1 : au < 0.87 ? 0 : au < 1.6 ? 0.55 : 0.55 * (1 - sstep(1.6, 2.2, au));
      const ws = wlane ? sstep(0.35, 1.2, fbmT(u * 6.5, v * 0.75, 2, seed + 7)) * wlane * 0.3 : 0;
      const aW = Math.min(0.42, halo + ws);
      // the snow's tone: dirtier toward the rails (soot, the shunters' boots)
      const dirt = 1 - sstep(0.9, 1.9, au) * 0.9, mot = 0.95 + 0.07 * vnoise(u * 3.3, v * 2.1, seed + 9);
      const sr = (233 - 30 * dirt) * mot, sg = (238 - 30 * dirt) * mot, sb = (246 - 28 * dirt) * mot;
      const A = aS + aW * (1 - aS), k = (j * W + i) * 4;
      if (A < 1e-3) { rough[k] = rough[k + 1] = rough[k + 2] = 200; rough[k + 3] = 255; continue; }
      const fS = aS / A, fW = 1 - fS;
      col[k] = sr * fS + 36 * fW; col[k + 1] = sg * fS + 40 * fW; col[k + 2] = sb * fS + 41 * fW; col[k + 3] = A * 255;
      rough[k] = rough[k + 1] = rough[k + 2] = 242 * fS + 70 * fW; rough[k + 3] = 255;
    }
  }
  const mk = (data) => {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    cv.getContext('2d').putImageData(new ImageData(data, W, H), 0, 0);
    return cv;
  };
  // the crust's thickness as a normal map (tangent space: +u across to +x, +v up the canvas, which flipY puts at v = 1)
  const nrm = new Uint8ClampedArray(W * H * 4), th = 0.02 / (2 * m);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const r = j * W, i0 = i > 0 ? i - 1 : i, i1 = i < W - 1 ? i + 1 : i, j0 = j > 0 ? j - 1 : j, j1 = j < H - 1 ? j + 1 : j;
    const du = (hgt[r + i1] - hgt[r + i0]) * th, dv = (hgt[j0 * W + i] - hgt[j1 * W + i]) * th;
    const l = Math.hypot(du, dv, 1), k = (j * W + i) * 4;
    nrm[k] = (-du / l) * 127.5 + 127.5; nrm[k + 1] = (-dv / l) * 127.5 + 127.5; nrm[k + 2] = (1 / l) * 127.5 + 127.5; nrm[k + 3] = 255;
  }
  const t = new THREE.CanvasTexture(mk(col)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const tr = new THREE.CanvasTexture(mk(rough)); tr.anisotropy = 4;
  const tn = new THREE.CanvasTexture(mk(nrm)); tn.anisotropy = 4;
  return { map: t, rough: tr, normal: tn };
}
/**
 * The deck's snow and wear decal (deckCrustTexture) in the pivot's frame: one plane over the plate, 16 mm up (4 mm over
 * the butt straps' and the toe plate's tops, under the rail timbers'), polygon offset, no depth write, drawn after the
 * rust streaks.
 */
function spanDeckCrust(S, L, top) {
  const dw = S.w - 0.9, len = L - 0.1;
  const straps = []; // (spanDeckWear's butt straps, by their distance from the plate's outer end, -L + 0.05)
  for (let z = -L + 0.9; z < -0.4; z += 1.75) straps.push(z + L - 0.05);
  const tex = deckCrustTexture(dw, len, straps);
  if (!tex) return null;
  // (the canvas's top row is the plate's outer end: v = 1 there, where the rotated plane's +v runs out along -z)
  const g = new THREE.PlaneGeometry(dw, len).rotateX(-Math.PI / 2).translate(0, top + 0.016, -0.05 - len / 2);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0,
    normalMap: tex.normal,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, name: 'e06:deck_crust' }));
  m.material.userData.snowCover = true; // (it is the snow: the scene's prop snow pass leaves it alone)
  m.name = 'e06:span_crust'; m.renderOrder = 3; m.receiveShadow = true;
  return m;
}
/**
 * The streaks on the span's deck, in its own frame (the pivot at the hinge, the deck out along -z): from each plate seam
 * on the two outer lanes and from beside the rail timbers' chairs, run downhill towards the hinge (+z, the way the
 * water runs off the raised span). One mesh, one draw; 5 mm over the plate, polygon offset, no depth write; the deck's
 * own held-back snow over them (the same snow as on the plate under them).
 */
function spanRustStreaks(S, L, top) {
  const tex = rustStreakTexture();
  if (!tex) return null;
  const R = rng(seedOf('e06-span-rust')), dw = S.w - 0.9, y = top + 0.005, geos = [], COLS = 4;
  const streak = (cx, z0, w, h) => {
    const ze = Math.min(z0 + h, -0.15);
    if (ze - z0 < 0.2) return;
    const g = new THREE.PlaneGeometry(w, ze - z0).rotateX(-Math.PI / 2).translate(cx, y, (z0 + ze) / 2);
    const col = Math.floor(R() * COLS), flip = R() < 0.5, uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) { let u = uv.getX(i); if (flip) u = 1 - u; uv.setX(i, (col + 0.04 + u * 0.92) / COLS); }
    geos.push(g);
  };
  for (let z = -L + 0.9; z < -0.4; z += 1.75) {
    for (const s of [-1, 1]) {
      for (let k = 0, n = 1 + Math.floor(R() * 3); k < n; k++) {
        const w = 0.2 + R() * 0.32, cx = s * (1.0 + w / 2 + R() * (dw / 2 - 1.15 - w));
        streak(cx, z + 0.04, w, 0.6 + Math.pow(R(), 0.8) * 1.3);
      }
    }
  }
  // (from under the chairs, along the rail timbers' outer sides)
  for (const s of [-1, 1]) {
    for (let z = -L + 0.5; z < -0.8; z += 0.9 + R() * 1.6) {
      if (R() < 0.35) continue;
      streak(s * (0.7175 + 0.15 + 0.07), z, 0.12 + R() * 0.08, 0.35 + R() * 0.9);
    }
  }
  if (!geos.length) return null;
  const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 0.85, name: 'e06:rust_streaks' }));
  m.material.userData.snowCover = true; // (the deck's snow lies over it: spanDeckCrust)
  m.name = 'e06:span_rust'; m.renderOrder = 2;
  return m;
}
/**
 * The terminal roofs' wear, an atlas of three: (0) slates bared by a stack's warmth — courses with staggered joints, each
 * slate its own grey, snow lodged along the courses' lower edges, thicker toward the ragged rim where it closes over;
 * (1) a scoured band (the same slates, more snow left on them, a ragged band across); (2) soot run down the slope from
 * the top edge, in thin streaks. Canvas top: up the slope.
 */
function roofWearTexture(W = 128, H = 256) {
  if (!HAS_DOM) return null;
  const c = document.createElement('canvas'); c.width = W * 3; c.height = H;
  const x = c.getContext('2d'), R = rng(seedOf('e06-roofwear'));
  x.clearRect(0, 0, c.width, c.height);
  const slates = (x0, snow) => { // courses every ~0.25 m (H/8.4 px for the bared patch's ~2.1 m)
    const ch = H / 8.4, sw = ch * 1.15;
    x.save(); x.beginPath(); x.rect(x0, 0, W, H); x.clip();
    for (let r = 0, y = 0; y < H; r++, y += ch) {
      for (let u = -((r % 2) * sw) / 2; u < W; u += sw * (0.85 + R() * 0.3)) {
        const g = 70 + R() * 26;
        x.fillStyle = `rgb(${g | 0},${(g + 6) | 0},${(g + 16) | 0})`;
        x.fillRect(x0 + u, y, sw, ch);
        x.fillStyle = 'rgba(28,30,36,0.55)'; x.fillRect(x0 + u, y, 1.4, ch); // (the joint)
      }
      x.fillStyle = 'rgba(24,26,32,0.7)'; x.fillRect(x0, y + ch - 2, W, 2); // (the course's shadowed lower edge)
      // snow lodged on the course below the edge: broken dashes
      for (let u = 0; u < W; u += 3 + R() * 10) {
        if (R() > snow) continue;
        const len = 3 + R() * 14, th = 1.5 + R() * 3.5;
        x.fillStyle = `rgba(222,228,236,${(0.7 + R() * 0.3).toFixed(2)})`; x.fillRect(x0 + u, y + ch - 1, len, th);
      }
    }
    for (let k = 0; k < 60 * snow; k++) { x.fillStyle = 'rgba(224,230,238,0.8)'; x.beginPath(); x.arc(x0 + R() * W, R() * H, 0.8 + R() * 2.2, 0, 6.29); x.fill(); }
    x.restore();
  };
  const mask = (x0, shape) => { // keep the drawing inside a ragged soft shape: destination-in with many soft blobs
    const m = document.createElement('canvas'); m.width = W; m.height = H;
    const mx = m.getContext('2d');
    for (let k = 0; k < 70; k++) {
      const [cx, cy, rx, ry] = shape(R);
      const g = mx.createRadialGradient(cx, cy, 0, cx, cy, 1);
      g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(0.6, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      mx.save(); mx.translate(cx, cy); mx.scale(rx, ry); mx.translate(-cx, -cy); mx.fillStyle = g; mx.beginPath(); mx.arc(cx, cy, 1, 0, 6.29); mx.fill(); mx.restore();
    }
    // (faded out toward the column's sides: pieces laid side by side blend into one band, its ends soft — a cut at the
    // column's edge read as a block)
    mx.globalCompositeOperation = 'destination-in';
    const fx = mx.createLinearGradient(0, 0, W, 0);
    fx.addColorStop(0, 'rgba(0,0,0,0)'); fx.addColorStop(0.18, 'rgba(0,0,0,1)'); fx.addColorStop(0.82, 'rgba(0,0,0,1)'); fx.addColorStop(1, 'rgba(0,0,0,0)');
    mx.fillStyle = fx; mx.fillRect(0, 0, W, H);
    // (clipped to the column: destination-in clears all it may touch)
    x.save(); x.beginPath(); x.rect(x0, 0, W, H); x.clip(); x.globalCompositeOperation = 'destination-in'; x.drawImage(m, x0, 0); x.restore();
  };
  // (0) bared by a stack's warmth: wider at the top under the stack, a tongue downhill
  slates(0, 0.45);
  mask(0, (R) => [W * (0.5 + (R() - 0.5) * 0.35), H * Math.pow(R(), 0.8) * 0.9, W * (0.12 + R() * 0.16) * (1 - 0.3 * R()), H * (0.06 + R() * 0.1)]);
  // (1) scoured: a band across, ragged both edges, more snow on it
  slates(W, 0.75);
  mask(W, (R) => [W * R(), H * (0.5 + (R() - 0.5) * 0.36), W * (0.08 + R() * 0.12), H * (0.1 + R() * 0.12)]);
  // (2) soot streaks
  x.save(); x.beginPath(); x.rect(2 * W, 0, W, H); x.clip();
  for (let k = 0; k < 30; k++) {
    const cx = 2 * W + W * (0.5 + (R() - 0.5) * 0.6), len = H * (0.3 + Math.pow(R(), 0.6) * 0.68), rx = W * (0.02 + R() * 0.06);
    const g = x.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(30,26,24,${(0.07 + R() * 0.07).toFixed(3)})`); g.addColorStop(1, 'rgba(30,26,24,0)');
    x.fillStyle = g; x.beginPath(); x.ellipse(cx, 0, rx, len, 0, 0, Math.PI); x.fill();
  }
  x.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/** The slates' courses, faint through the thin snow: broken grey lines, two to a tile (repeat). */
function roofCoursesTexture(S = 128) {
  if (!HAS_DOM) return null;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const x = c.getContext('2d'), R = rng(seedOf('e06-courses'));
  x.clearRect(0, 0, S, S);
  for (const y0 of [S * 0.25, S * 0.75]) {
    for (let u = 0; u < S;) {
      const len = 6 + R() * 30;
      if (R() < 0.75) {
        x.fillStyle = `rgba(52,58,68,${(0.24 + R() * 0.24).toFixed(2)})`; x.fillRect(u, y0 + (R() - 0.5) * 2, len, 2 + R() * 2);
        x.fillStyle = 'rgba(52,58,68,0.08)'; x.fillRect(u, y0 + 3, len, 6); // (the faint shadow under the course)
      }
      u += len + 2 + R() * 8;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
/** Decal planes from an atlas of `cols` columns ({col, w, h, p, n, flip, along}), merged into one mesh. */
function atlasDecals(tex, list, cols, name, order = 2) {
  if (!tex || !list.length) return null;
  const o = new THREE.Object3D(), geos = [];
  for (const d of list) {
    o.position.set(...d.p);
    // (the plane's width along the eave line, its height up the slope: the hall's eaves run along x, the wings' along z)
    o.up.set(0, 1, 0);
    o.lookAt(d.p[0] + d.n[0], d.p[1] + d.n[1], d.p[2] + d.n[2]);
    o.updateMatrix();
    const g = new THREE.PlaneGeometry(d.w, d.h).applyMatrix4(o.matrix), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) { let u = uv.getX(i); if (d.flip) u = 1 - u; uv.setX(i, (d.col + 0.02 + u * 0.96) / cols); }
    geos.push(g);
  }
  const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 0.85, name }));
  m.material.userData.snowCover = true;
  m.name = name; m.renderOrder = order;
  return m;
}
/**
 * The courses over each roof slope ({P(u, d, lift), u0, u1, L}): a grid 2.2 cm over the slates, its alpha in each corner
 * wandering (the snow thinner here, deeper there; thinnest toward the eaves), the texture repeating every 1.1 m along
 * the eaves and 0.5 m (two courses) up the slope.
 */
function coursesMesh(tex, list, R) {
  if (!tex || !list.length) return null;
  const pos = [], uv = [], col = [], idx = [];
  for (const s of list) {
    const nu = Math.max(2, Math.ceil((s.u1 - s.u0) / 1.6)), nd = Math.max(2, Math.ceil(s.L / 1.2)), base = pos.length / 3;
    const ph = R() * 6.28;
    for (let j = 0; j <= nd; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = s.u0 + ((s.u1 - s.u0) * i) / nu, d = j / nd, p = s.P(u, Math.min(0.985, d), 0.022);
        pos.push(...p); uv.push((u - s.u0) / 1.1, (d * s.L) / 0.5);
        const a = (0.35 + 0.45 * (0.5 + 0.5 * Math.sin(u * 0.37 + d * 2.1 + ph)) * (0.6 + 0.4 * R())) * (1 - 0.35 * d);
        col.push(1, 1, 1, Math.max(0, Math.min(1, a)));
      }
    }
    for (let j = 0; j < nd; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, e = c + 1;
      idx.push(a, b, e, a, e, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  // (faces wound either way round: drawn from both sides would double the overlap — wind each slope's to face up)
  const p = g.attributes.position.array, ix = g.index.array;
  for (let t = 0; t < ix.length; t += 3) {
    const A = ix[t] * 3, B = ix[t + 1] * 3, C = ix[t + 2] * 3;
    const ny = (p[B + 2] - p[A + 2]) * (p[C] - p[A]) - (p[B] - p[A]) * (p[C + 2] - p[A + 2]);
    if (ny < 0) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; }
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, vertexColors: true,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, roughness: 0.9, name: 'e06:roof_courses' }));
  m.material.userData.snowCover = true;
  m.name = 'e06:roof_courses'; m.renderOrder = 1;
  return m;
}
/** Decal planes [{w, h, p, n}] sharing one texture, merged into one mesh (one draw): the decal() material. */
function decalBatch(tex, list, name) {
  if (!tex || !list.length) return null;
  const o = new THREE.Object3D();
  const geos = list.map(({ w, h, p, n }) => {
    o.position.set(...p); o.lookAt(p[0] + n[0], p[1] + n[1], p[2] + n[2]); o.updateMatrix();
    return new THREE.PlaneGeometry(w, h).applyMatrix4(o.matrix);
  });
  const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 0.95 }));
  m.material.userData.snowCover = true;
  m.name = name; m.renderOrder = 2;
  return m;
}
/** A decal plane (stencilled lettering) at p facing n. */
function decal(tex, wd, ht, p, n) {
  if (!tex) return null;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(wd, ht), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 0.9 }));
  m.material.userData.snowCover = true;
  m.position.set(...p);
  m.lookAt(p[0] + n[0], p[1] + n[1], p[2] + n[2]);
  m.renderOrder = 2;
  return m;
}
/** Spoked wheel pair sides: a disc with a rim, in the plane x = const (axle along x), centre (x, y, z). */
function wheel(G, x, y, z, r, mat = 'e6_black') {
  const seg = 14;
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2, s = Math.sign(x) || 1;
    const P = (a, rr, dx) => [x + dx, y + Math.sin(a) * rr, z + Math.cos(a) * rr];
    face(G, mat, [P(a0, r, s * 0.07), P(a1, r, s * 0.07), [x + s * 0.07, y, z]], [s, 0, 0], 0.75);
    face(G, 'e6_iron', [P(a0, r, s * 0.07), P(a0, r, -s * 0.07), P(a1, r, -s * 0.07), P(a1, r, s * 0.07)], [0, Math.sin((a0 + a1) / 2), Math.cos((a0 + a1) / 2)], 0.6);
  }
  G.cyl('e6_iron', x + (Math.sign(x) || 1) * 0.07, y - 0.08, z, 0.08, 0.08, 0.16, 8, 0.6);
}
/** A buffer head: a dished disc (r 0.2) facing ±z (`s`) at (x, y, z), 6 cm thick. */
function bufferHead(G, x, y, z, s) {
  const seg = 12, r = 0.2;
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    const P = (a, zz) => [x + Math.cos(a) * r, y + Math.sin(a) * r, zz];
    face(G, 'e6_iron', [P(a0, z), P(a1, z), [x, y, z + s * 0.012]], [0, 0, s], 0.65);
    face(G, 'e6_iron', [P(a0, z), P(a0, z - s * 0.06), P(a1, z - s * 0.06), P(a1, z)], [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0], 0.6);
  }
}
/** The sealed wagon, authored along +z (model forward), base on the rail head (y 0.17): 10 m over buffers. */
function buildWagon() {
  const G = new Geo('e06-wagon'), L = 9.0, W = 2.75, y0 = 1.18, y1 = 3.38, ry = 3.82;
  // underframe: sole bars, buffer beams, axle guards, leaf springs, wheels, buffers, a brake column
  for (const s of [-1, 1]) {
    G.box('e6_black', s * 0.95, y0 - 0.18, 0, 0.16, 0.32, L - 0.1, 0, 0.8);
    G.box('e6_red', 0, y0 - 0.16, s * (L / 2 - 0.06), 2.7, 0.34, 0.16, 0, 0.8);
    for (const bx of [-0.88, 0.88]) { G.cyl('e6_iron', bx, y0 - 0.22, s * (L / 2 + 0.25), 0.2, 0.2, 0.06, 12, 0.6); }
    for (const az of [-2.6, 2.6]) {
      wheel(G, s * 0.72, 0.67, az, 0.5);
      G.box('e6_black', s * 0.98, 0.95, az, 0.12, 0.42, 0.5, 0, 0.7);
      G.box('e6_black', s * 0.98, 1.04, az, 0.1, 0.08, 1.6, 0, 0.65);
    }
  }
  for (const s of [-1, 1]) for (const bx of [-0.88, 0.88]) {
    const z0 = s * (L / 2), z1 = s * (L / 2 + 0.45);
    member(G, 'e6_iron', [bx, y0 - 0.22, z0], [bx, y0 - 0.22, z1 - s * 0.03], 0.13, 0.7);
  }
  for (const s of [-1, 1]) for (const bx of [-0.88, 0.88]) bufferHead(G, bx, y0 - 0.22, s * (L / 2 + 0.47), s);
  // body: vertical boarded sides (two tones of brown boards), corner and middle stanchions, the floor's edge
  G.box('e6_wagon', 0, (y0 + y1) / 2, 0, W, y1 - y0, L, 0, 0.95);
  for (const s of [-1, 1]) {
    for (const zz of [-L / 2 + 0.06, -2.2, 2.2, L / 2 - 0.06]) G.box('e6_black', s * (W / 2 + 0.03), (y0 + y1) / 2, zz, 0.06, y1 - y0, 0.12, 0, 0.7);
    for (const yy of [y0 + 0.05, (y0 + y1) / 2, y1 - 0.06]) G.box('e6_black', s * (W / 2 + 0.025), yy, 0, 0.05, 0.08, L, 0, 0.66);
    // the sliding door: a panel proud of the side on its top rail, its handle and the seal on the latch
    G.box('e6_wagon', s * (W / 2 + 0.07), (y0 + y1 - 0.1) / 2, 0.2, 0.06, y1 - y0 - 0.25, 2.0, 0, 0.82);
    G.box('e6_black', s * (W / 2 + 0.1), y1 - 0.05, 0.2, 0.06, 0.1, 4.2, 0, 0.6);
    G.box('e6_black', s * (W / 2 + 0.1), y0 + 0.06, 0.2, 0.05, 0.06, 4.2, 0, 0.6);
    G.box('e6_red', s * (W / 2 + 0.115), 2.05, -0.75, 0.04, 0.1, 0.06, 0, 0.9);
    member(G, 'e6_iron', [s * (W / 2 + 0.11), 1.7, -0.72], [s * (W / 2 + 0.11), 2.25, -0.72], 0.04);
    // a small ventilation hatch high on each side, shut
    G.box('e6_wagon', s * (W / 2 + 0.05), 3.0, -3.3, 0.04, 0.4, 0.7, 0, 0.75);
    // the step and grab handle at each end
    for (const e of [-1, 1]) { G.box('e6_iron', s * (W / 2 - 0.1), y0 - 0.45, e * (L / 2 - 0.4), 0.3, 0.04, 0.35, 0, 0.6); member(G, 'e6_iron', [s * (W / 2 + 0.06), 1.5, e * (L / 2 - 0.25)], [s * (W / 2 + 0.06), 2.6, e * (L / 2 - 0.25)], 0.035); }
  }
  // the arched roof (six facets), its end boards, a handbrake wheel on one end
  const facets = 6, rr = 2.0;
  for (let k = 0; k < facets; k++) {
    const a0 = Math.PI / 2 - 0.62 + (k / facets) * 1.24, a1 = Math.PI / 2 - 0.62 + ((k + 1) / facets) * 1.24;
    const P = (a, z) => [Math.cos(a) * (W / 2 + 0.08) / Math.cos(0.62 - Math.PI / 2 + Math.PI / 2), 0, z];
    void P;
    const x0 = Math.cos(a0) * rr * 0.73, x1 = Math.cos(a1) * rr * 0.73, yA = y1 + (Math.sin(a0) - Math.sin(Math.PI / 2 - 0.62)) * rr, yB = y1 + (Math.sin(a1) - Math.sin(Math.PI / 2 - 0.62)) * rr;
    slab(G, 'e6_felt', [[x0, yA, -L / 2 - 0.08], [x0, yA, L / 2 + 0.08], [x1, yB, L / 2 + 0.08], [x1, yB, -L / 2 - 0.08]], 0.06, 0.95);
  }
  void ry;
  for (const s of [-1, 1]) {
    const zz = s * (L / 2 + 0.005), poly = [];
    for (let k = 0; k <= facets; k++) { const a = Math.PI / 2 - 0.62 + (k / facets) * 1.24; poly.push([Math.cos(a) * rr * 0.73, y1 + (Math.sin(a) - Math.sin(Math.PI / 2 - 0.62)) * rr - 0.05, zz]); }
    for (let k = 0; k < facets; k++) face(G, 'e6_wagon', [[poly[k][0], y1 - 0.02, zz], poly[k], poly[k + 1], [poly[k + 1][0], y1 - 0.02, zz]], [0, 0, s], 0.85);
  }
  G.cyl('e6_iron', 0.9, 2.2, L / 2 + 0.15, 0.22, 0.22, 0.04, 12, 0.6);
  return G.build('e06:wagon', { ground: 0, damp: 0.6, streaks: 0.15, moss: 0 });
}
/** The shunting engine: a black 0-6-0 tank engine along +z (smokebox forward), 8 m over buffers. */
function buildShunter() {
  const G = new Geo('e06-shunter'), fy = 1.0;
  // frames, buffer beams (red), buffers, six coupled wheels with coupling rods, cylinders
  for (const s of [-1, 1]) {
    G.box('e6_black', s * 0.62, fy, 0.1, 0.1, 0.62, 7.0, 0, 0.75);
    for (const az of [-1.55, 0.05, 1.65]) wheel(G, s * 0.78, 0.6, az, 0.55, 'e6_red');
    member(G, 'e6_iron', [s * 0.93, 0.62, -1.55], [s * 0.93, 0.62, 1.65], 0.07, 0.6);
    G.cyl('e6_black', s * 0.98, 0.95, 2.75, 0.3, 0.3, 0.9, 12, 0.7);
  }
  for (const s of [-1, 1]) {
    G.box('e6_red', 0, fy - 0.05, s * 3.55, 2.7, 0.4, 0.14, 0, 0.82);
    for (const bx of [-0.88, 0.88]) {
      member(G, 'e6_iron', [bx, fy - 0.05, s * 3.6], [bx, fy - 0.05, s * 3.92], 0.12, 0.7);
      bufferHead(G, bx, fy - 0.05, s * 3.94, s);
    }
  }
  G.box('e6_black', 0, fy + 0.34, 0.1, 2.5, 0.08, 7.0, 0, 0.7); // running plate
  // boiler, smokebox and its door, chimney, steam and sand domes, safety valves, whistle
  const by = 2.35, br = 0.78;
  const cylZ = (r, z0, z1, mat, tone) => { const seg = 16; for (let k = 0; k < seg; k++) { const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2; face(G, mat, [[Math.cos(a0) * r, by + Math.sin(a0) * r, z0], [Math.cos(a1) * r, by + Math.sin(a1) * r, z0], [Math.cos(a1) * r, by + Math.sin(a1) * r, z1], [Math.cos(a0) * r, by + Math.sin(a0) * r, z1]], [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0], tone); } };
  cylZ(br, -0.9, 2.3, 'e6_black', 0.85);
  cylZ(br + 0.05, 2.3, 3.4, 'e6_black', 0.6);
  for (let k = 0; k < 16; k++) {
    const a0 = (k / 16) * Math.PI * 2, a1 = ((k + 1) / 16) * Math.PI * 2;
    face(G, 'e6_black', [[Math.cos(a0) * (br + 0.05), by + Math.sin(a0) * (br + 0.05), 3.4], [Math.cos(a1) * (br + 0.05), by + Math.sin(a1) * (br + 0.05), 3.4], [0, by, 3.46]], [0, 0, 1], 0.55);
  }
  G.cyl('e6_black', 0, by + br - 0.1, 2.85, 0.26, 0.22, 0.95, 12, 0.6);
  G.cyl('e6_black', 0, by + br + 0.82, 2.85, 0.24, 0.28, 0.1, 12, 0.55);
  G.cyl('e6_black', 0, by + br - 0.1, 0.9, 0.36, 0.3, 0.62, 12, 0.8);
  G.cyl('e6_black', 0, by + br - 0.1, -0.1, 0.24, 0.2, 0.42, 12, 0.8);
  G.cyl('e6_iron', 0, by + br - 0.05, -0.75, 0.06, 0.05, 0.38, 6, 0.7);
  // side tanks along the boiler, the cab (windows, roof), the coal bunker
  for (const s of [-1, 1]) G.box('e6_black', s * 1.0, fy + 1.15, 0.65, 0.7, 1.6, 3.2, 0, 0.82);
  const cz0 = -3.1, cz1 = -0.95, cy1 = 3.55;
  G.box('e6_black', 0, (fy + 0.38 + cy1) / 2, (cz0 + cz1) / 2, 2.62, cy1 - fy - 0.38, cz1 - cz0, 0, 0.84);
  slab(G, 'e6_black', [[-1.48, cy1 + 0.12, cz0 - 0.15], [-1.48, cy1 + 0.12, cz1 + 0.15], [0, cy1 + 0.38, cz1 + 0.15], [0, cy1 + 0.38, cz0 - 0.15]], 0.06, 0.7);
  slab(G, 'e6_black', [[0, cy1 + 0.38, cz0 - 0.15], [0, cy1 + 0.38, cz1 + 0.15], [1.48, cy1 + 0.12, cz1 + 0.15], [1.48, cy1 + 0.12, cz0 - 0.15]], 0.06, 0.7);
  for (const s of [-1, 1]) {
    face(G, 'e6_glass', [[s * 1.315, 2.55, -1.35], [s * 1.315, 2.55, -2.35], [s * 1.315, 3.25, -2.35], [s * 1.315, 3.25, -1.35]], [s, 0, 0], 0.7);
    face(G, 'e6_glass', [[s * 0.45, 2.75, cz1 + 0.005], [s * 1.0, 2.75, cz1 + 0.005], [s * 1.0, 3.25, cz1 + 0.005], [s * 0.45, 3.25, cz1 + 0.005]], [0, 0, 1], 0.7);
  }
  G.box('e6_black', 0, fy + 0.95, -3.4, 2.5, 1.15, 0.62, 0, 0.8);
  G.box('e6_iron', 0, fy + 1.58, -3.4, 2.2, 0.16, 0.5, 0, 0.35); // (coal heaped in the bunker)
  // lamps on the buffer beams, a number plate on the smokebox door
  for (const s of [-1, 1]) G.box('e6_iron', s * 0.95, fy + 0.45, 3.5, 0.18, 0.24, 0.16, 0, 0.6);
  G.box('e6_red', 0, by - 0.1, 3.47, 0.6, 0.14, 0.02, 0, 0.85);
  return G.build('e06:shunter', { ground: 0, damp: 0.5, streaks: 0.12, moss: 0 });
}

/** Skin a pushable: its placeholder meshes hidden, `model` (authored along +z) parented to its object3d. */
function skinPushable(world, id, model) {
  const p = world.interactables?.find?.((i) => (i.tag ?? i.id) === id);
  const o = p?.object3d;
  if (!o) return null;
  o.traverse((m) => { if (m.isMesh) m.visible = false; });
  model.name = `e06:skin:${id}`;
  o.add(model);
  return p;
}
/** The wagon's fall off the span's end: re-parented to the scene, it tips nose-down, slides off and sinks; a splash. */
function wagonDrop(world, root, p, model) {
  if (!p || !model) return;
  let t0 = null;
  const start = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), base = new THREE.Vector3();
  world.events?.on?.('pushable:drop', (e) => {
    if (e.pushable !== p || t0 != null) return;
    model.updateMatrixWorld(true);
    start.copy(model.matrixWorld);
    start.decompose(base, q, s);
    root.attach(model);
    model.visible = true;
    t0 = world.time;
    world.fx?.spawn?.('splash', e.x, e.z - 3, { big: true, radius: 4.5 });
    world.water?.disturb?.(e.x, e.z - 3, 0.6, 3.5, 1);
  });
  const fwd = new THREE.Vector3(), pitchQ = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0);
  const tick = () => {
    // (a load after the drop: the wagon is at the bottom of the harbour — the pushable's body is hidden on restore,
    // Pushable._applyDestroyedState; never drawn back on the span's end)
    if (t0 == null) { if (p.dropped) model.visible = false; return; }
    const t = Math.max(0, (world.time ?? 0) - t0), k = Math.min(1, t / 3.2);
    fwd.set(0, 0, 1).applyQuaternion(q);
    const slide = 2.6 * k + 1.2 * k * k, pitch = Math.min(deg(58), deg(70) * Math.sqrt(k)), drop = 0.6 * k + 6.5 * k * k;
    model.position.copy(base).addScaledVector(fwd, slide);
    model.position.y = base.y - drop;
    pitchQ.setFromAxisAngle(X, pitch);
    model.quaternion.copy(q).multiply(pitchQ);
    if (t > 1.1 && t < 1.2) { world.water?.disturb?.(base.x + fwd.x * 4, base.z + fwd.z * 4, 0.4, 3, 1); }
    if (k >= 1) model.visible = false;
  };
  model.traverse((m) => { if (m.isMesh) m.onBeforeRender = tick; });
}

// ---------------------------------------------------------------- the searchlight and its beam
/**
 * The searchlight's light (art review r1: "a pale, flat, hard-edged wedge with straight sides and a crisp elliptical
 * end … reads as a decal sheet, not light"):
 *  - the beam: an open cone, additive, its light falling off along it (brightest by the lamp, gone before its end)
 *    and across it (a wall seen edge-on fades: no hard sides), faded out as it nears the ice (no line where the cone
 *    meets the ground);
 *  - the pool: where the beam falls on the ice, a quad following the beam whose shader works out the light on each
 *    point of the ice from the lamp (a soft spot cone, falling off with distance) and BRIGHTENS what is drawn there
 *    (blend: dst × (1 + light)) — the ice's own texture, snow and cracks break it up, the fishermen's holes stay
 *    dark; a little noise of its own (drifted snow catching the light).
 * One shader each, compiled at the load's warm-up frame (both drawn from the start); off (not drawn) once the crew is
 * out.
 */
const BEAM_LEN = 70, BEAM_TILT = -0.12, POOL_Y = 0.05;
function beamMaterial() {
  return new THREE.ShaderMaterial({
    name: 'e06:beam',
    uniforms: { uOn: { value: 1 }, uColor: { value: new THREE.Color(0xc6d6ff) }, uGround: { value: 0 } },
    vertexShader: /* glsl */`
      varying float vT; varying float vY; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        vT = clamp(position.x / ${BEAM_LEN.toFixed(1)}, 0.0, 1.0);
        vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; vW = w.xyz;
        vec4 mv = viewMatrix * w;
        vN = normalize(normalMatrix * normal);
        vV = isOrthographic ? vec3(0.0, 0.0, 1.0) : -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    // (art review r1: "a pale, flat, hard-edged wedge with straight sides … reads as a decal sheet, not light": the
    // shaft is now brightest down its middle and gone at its silhouette — facing^3, a soft cross-section, no edge
    // line — it fades out along its length and near the ice, and the falling snow and the haze it lights break it up)
    fragmentShader: /* glsl */`
      uniform float uOn; uniform vec3 uColor; uniform float uGround;
      varying float vT; varying float vY; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float n3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
      void main() {
        float facing = abs(dot(normalize(vN), normalize(vV)));
        float core = facing * facing * facing;
        float along = smoothstep(0.0, 0.06, vT) * pow(1.0 - vT, 2.2);
        float ground = smoothstep(uGround + 0.4, uGround + 3.4, vY);
        float haze = n3(vW * 0.32) * 0.65 + n3(vW * 1.4) * 0.35;
        gl_FragColor = vec4(uColor, 0.13 * uOn * core * along * ground * (0.35 + 0.9 * haze));
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
function poolMaterial() {
  return new THREE.ShaderMaterial({
    name: 'e06:beam_pool',
    uniforms: {
      uOn: { value: 1 }, uColor: { value: new THREE.Color(0xd2deff) }, uLamp: { value: new THREE.Vector3() }, uAxis: { value: new THREE.Vector3(1, 0, 0) },
      // (the pool's edge soft all round: the cone's falloff from its axis out past the shaft's own rim, squared; the far
      // end fading over 40 m; the ice's grain and drifted snow break it up — no crisp line anywhere)
      uCos: { value: new THREE.Vector2(Math.cos(0.19), Math.cos(0.0)) }, uRange: { value: new THREE.Vector2(36, 82) }, uGain: { value: 2.4 },
    },
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uOn; uniform vec3 uColor; uniform vec3 uLamp; uniform vec3 uAxis; uniform vec2 uCos; uniform vec2 uRange; uniform float uGain;
      varying vec3 vW;
      float h2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main() {
        vec3 d = vW - uLamp; float dist = length(d);
        float cone = smoothstep(uCos.x, uCos.y, dot(d / dist, uAxis)); cone *= cone;
        float fall = min(pow(56.0 / dist, 1.2), 2.0) * (1.0 - smoothstep(uRange.x, uRange.y, dist));
        float n = vn(vW.xz * 0.33) * 0.5 + vn(vW.xz * 1.9) * 0.3 + vn(vW.xz * 6.1) * 0.2;
        float I = uGain * uOn * cone * fall * (0.3 + 1.0 * n);
        gl_FragColor = vec4(uColor * I, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor, blendDst: THREE.OneFactor, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  });
}
function searchlight(world, root, at, crew) {
  const pivot = new THREE.Group();
  pivot.name = 'e06:searchlight';
  pivot.position.set(at[0], at[1], at[2]);
  pivot.add(buildSearchlight({ x: 0, z: 0, y0: 0, rot: 0, elev: 0.1, seed: 'e06-sl' }));
  root.add(pivot);
  if (!HAS_DOM) return;
  // the beam: an open cone along the group's +x (radius 0.32 at the lamp, 9 m at its end)
  const beamGeo = new THREE.CylinderGeometry(0.32, 9, BEAM_LEN, 24, 4, true);
  beamGeo.translate(0, -BEAM_LEN / 2, 0);
  beamGeo.rotateZ(Math.PI / 2);
  const beamMat = beamMaterial(), poolMat = poolMaterial(); // (held here: a pass may swap a mesh's material for its draw)
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.name = 'e06:beam';
  beam.renderOrder = 5;
  const bp = new THREE.Group();
  bp.position.set(at[0], at[1] + 1.25, at[2]);
  bp.add(beam);
  root.add(bp);
  // the pool: a quad on the ice under the beam's reach (18..82 m out, 15 m either side of its line), turned with it
  const poolGeo = new THREE.PlaneGeometry(64, 30);
  poolGeo.rotateX(-Math.PI / 2);
  poolGeo.translate(50, 0, 0);
  const pool = new THREE.Mesh(poolGeo, poolMat);
  pool.name = 'e06:beam_pool';
  pool.renderOrder = 4;
  pool.frustumCulled = false; // (it turns with the beam: its bounds are the group's)
  const pg = new THREE.Group();
  pg.position.set(at[0], POOL_Y, at[2]);
  pg.add(pool);
  root.add(pg);
  const lamp = new THREE.Vector3(at[0], at[1] + 1.25, at[2]);
  let frame = -1;
  const update = (renderer) => {
    const f = renderer?.info?.render?.frame ?? -2;
    if (f === frame) return;
    frame = f;
    const live = crew.map((t) => world.byId?.(t)).filter((e) => e && e.alive !== false && !e.ko && !e.incapacitated);
    if (!live.length) { beam.visible = pool.visible = false; return; }
    const e = live[0], h = coneAt(e, world.time)?.heading ?? e.heading;
    bp.rotation.set(0, -h, BEAM_TILT);
    pg.rotation.set(0, -h, 0);
    pivot.rotation.set(0, -h + Math.PI / 2, 0);
    poolMat.uniforms.uLamp.value.copy(lamp);
    poolMat.uniforms.uAxis.value.set(Math.cos(h) * Math.cos(BEAM_TILT), Math.sin(BEAM_TILT), Math.sin(h) * Math.cos(BEAM_TILT));
  };
  beam.onBeforeRender = update;
  pool.onBeforeRender = update;
}

// ---------------------------------------------------------------- ice: mines' collars, broken edges, brash, ridges, holes
function iceArt(world, root, o) {
  const R = rng(seedOf('e06-ice'));
  const keep = (x, z) => !(o.avoid || []).some(([ax, az, r]) => Math.hypot(x - ax, z - az) < r);
  const mines = (world.interactables || []).filter((i) => i.kind === 'seaMine' || i.interactKind === 'seaMine' || /^mine_/.test(i.tag ?? i.id ?? ''));
  const tugS = world.structures?.get?.('tug'), t = tugS?.def ?? tugS?.spec ?? tugS;
  const tug = t ? { x: t.x, z: t.z, w: t.w, d: t.d } : null;
  // the banks of open water: the frozen sheet (the sea and the basin ice, not a quay, a mole or the tower's foot) has a
  // broken fast-ice edge; stone has none (art/e06-ice.js iceEdge)
  const quays = o.quays || [], tw = o.tower;
  const stone = (x, z) => quays.some((q) => polySD(q, x, z) < 0.4) || (tw && Math.abs(x - tw.x) < 2.75 && Math.abs(z - tw.z) < 2.75);
  const sheet = (x, z) => !stone(x, z) && (inPoly(o.seaIce, x, z) || inPoly(o.basinIce, x, z));
  // (the Marine's dive from the west bank down the channel: no slab over his way, where he would show through it)
  const swim = (x, z) => (o.swim || []).some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 1.4);
  const hull = (x, z, pad) => tug && Math.abs(x - tug.x) < tug.w / 2 + pad && Math.abs(z - tug.z) < tug.d / 2 + pad;
  const S = o.span, legs = o.legs || [];
  // the slip: its slabs stay off the lowered span's deck — its girders reach 0.9 m down, its outer lip 0.6 m past its
  // end — and the gantry's piers; and off the wagon's plunge at the deck's outer end (it goes in there: open water)
  const underDeck = (x, z) => Math.abs(x - S.x) < S.w / 2 + 0.12 && z > S.z - S.d / 2 - 0.65 && z < S.z + S.d / 2 + 0.3;
  const onPier = (x, z) => legs.some((l) => Math.abs(x - l.x) < 1.05 && Math.abs(z - l.z) < 1.05);
  const plunge = (x, z) => Math.abs(x - S.x) < 1.9 && z < S.z - S.d / 2 + 0.6;
  const banks = [
    { poly: o.channel, land: sheet, stone, keep, blocked: (x, z) => hull(x, z, 0.4) || !keep(x, z) || swim(x, z),
      wMin: 0.6, wMax: 3.2, wMid: 1.8, wAmp: 1.0, len: [0.9, 2.6], gapP: 0.1, iceFoot: true,
      cover: 0.42, clusterScale: 9, chipP: 0.05 }, // (in clusters, the sheet's own edge between: verifier r3)
    { poly: o.slip, land: sheet, stone, keep, blocked: (x, z) => underDeck(x, z) || onPier(x, z) || plunge(x, z) || !keep(x, z),
      wMin: 0.12, wMax: 1.6, wMid: 0.8, wAmp: 0.45, len: [0.35, 1.1], gapP: 0.3, iceFoot: true, rubble: 0.55,
      tone: 0.86, raiseP: 0.25, awashP: 0.2, cover: 0.6, clusterScale: 4 }, // (a working berth: its ice broken small, grey and wet, plates shoved up)
  ].filter((b) => b.poly);
  // the berth's open water under the raised deck: brash packed against its sides, clear of the girders (0.65 m in from
  // the deck's sides) and of the hinge end, where the raised girders still dip into the water (2.4 m)
  // (and out past the deck's end, in the strip of water at the slip's outer end, between the gantry's piers)
  const pit = S && o.slip ? [{ x0: S.x - S.w / 2 + 0.65, x1: S.x + S.w / 2 - 0.65, z0: S.z - S.d / 2 + 0.3, z1: S.z + S.d / 2 - 2.4 },
    { x0: S.x - S.w / 2 + 0.25, x1: S.x + S.w / 2 - 0.25, z0: o.slip[0][1] + 0.12, z1: S.z - S.d / 2 - 0.7, n: 30 }] : null;
  // (the slabs' tops in the sheet's own surface: the terrain's shader and uniforms, when the real terrain is built)
  const sheetTop = sheetTopMaterial(world.terrain?.terrain?.uniforms);
  const bounds = world.mission?.size || (world.grid ? [world.grid.width, world.grid.depth] : null);
  const g = buildHarbourIce({ rng: R, channel: o.channel, mines, ridges: o.ridges, holes: o.holes, keep, wind: [-0.6, 0.8], tug, banks, quays, pit, sheet: sheetTop, bounds });
  root.add(g);
  return g;
}
/**
 * Small wooden things on the ice by the holes (box stools, rods, an ice pick, a sledge). In the castle kit's own 'timber'
 * — the material the game's built ladders use (the searchlight tower's, fitted again after the load's warm-up frame):
 * drawn here, its program is compiled by that warm-up, not the first time the camera sees the ladder in play.
 */
function iceProps(G, holes, R) {
  for (const [x, z] of holes) {
    const a = R() * Math.PI * 2, sx = x + Math.cos(a) * 0.95, sz = z + Math.sin(a) * 0.95;
    G.box('timber', sx, 0.22, sz, 0.42, 0.38, 0.32, a, 0.8);
    member(G, 'timber', [x + Math.cos(a + 0.4) * 0.6, 0.12, z + Math.sin(a + 0.4) * 0.6], [x + Math.cos(a + 0.4) * 0.05, 0.36, z + Math.sin(a + 0.4) * 0.05], 0.025, 0.6);
  }
  // a zinc bucket and its bail by the second hole
  if (holes.length > 1) {
    const [x, z] = holes[1], bx = x - 0.85, bz = z + 0.55, N = 12, h = 0.3;
    const o = (a, r, y) => [bx + Math.cos(a) * r, y, bz + Math.sin(a) * r];
    for (let k = 0; k < N; k++) {
      // an open pail: its tapered wall, the inside of it down to the catch (dark, wet), a rolled lip
      const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2, am = (a0 + a1) / 2, out = [Math.cos(am), 0, Math.sin(am)];
      face(G, 'e6_iron', [o(a0, 0.13, 0), o(a1, 0.13, 0), o(a1, 0.16, h), o(a0, 0.16, h)], out, 0.75);
      face(G, 'e6_iron', [o(a0, 0.148, h), o(a1, 0.148, h), o(a1, 0.138, 0.19), o(a0, 0.138, 0.19)], [-out[0], 0, -out[2]], 0.45);
      face(G, 'e6_iron', [o(a0, 0.148, h), o(a1, 0.148, h), o(a1, 0.165, h + 0.008), o(a0, 0.165, h + 0.008)], [0, 1, 0], 0.6);
      face(G, 'e6_rail', [[bx, 0.19, bz], o(a1, 0.138, 0.19), o(a0, 0.138, 0.19)], [0, 1, 0], 0.22);
    }
    const arc = [[-0.16, 0.3], [-0.12, 0.43], [0, 0.48], [0.12, 0.43], [0.16, 0.3]];
    for (let i = 0; i + 1 < arc.length; i++) member(G, 'e6_iron', [bx + arc[i][0], arc[i][1], bz], [bx + arc[i + 1][0], arc[i + 1][1], bz], 0.012, 0.5);
  }
  // an ice pick stuck upright, a hand sledge with a basket
  if (holes.length) {
    const [x, z] = holes[0];
    member(G, 'timber', [x + 1.4, 0.0, z - 0.6], [x + 1.45, 1.25, z - 0.62], 0.05, 0.7);
    const sx = x + 2.2, sz = z + 1.1;
    for (const k of [-0.28, 0.28]) member(G, 'e6_iron', [sx - 0.8, 0.05, sz + k], [sx + 0.8, 0.05, sz + k], 0.04, 0.6);
    G.box('timber', sx, 0.24, sz, 1.4, 0.06, 0.62, 0, 0.75);
    G.box('timber', sx - 0.2, 0.45, sz, 0.6, 0.36, 0.5, 0, 0.7);
  }
}

// ---------------------------------------------------------------- the engines' coal bunker in the yard
/** A coal lump: a jittered octahedron (r m across) at (x, y, z), sunk a little into what it lies on. */
function lump(G, R, x, y, z, r, mat = 'e6_coal') {
  const k = (a) => a * (0.7 + R() * 0.6);
  const P = [[k(r), 0, 0], [-k(r), 0, 0], [0, k(r) * 0.8, 0], [0, -k(r) * 0.5, 0], [0, 0, k(r)], [0, 0, -k(r)]];
  const yaw = R() * 6.28, c = Math.cos(yaw), sn = Math.sin(yaw);
  const W = P.map(([a, b, d]) => [x + a * c - d * sn, y + b, z + a * sn + d * c]);
  const F = [[2, 4, 0], [2, 1, 4], [2, 5, 1], [2, 0, 5], [3, 0, 4], [3, 4, 1], [3, 1, 5], [3, 5, 0]];
  for (const [a, b, d] of F) face(G, mat, [W[a], W[b], W[d]], sub3(W[a], [x, y, z]).map((v, i) => v + sub3(W[b], [x, y, z])[i] + sub3(W[d], [x, y, z])[i]), 0.7 + R() * 0.35);
}
/**
 * The bunker (its gameplay box: x, z, w × d): a planked hopper on four posts with cross-braced sides, its sloping
 * bottom running down to a steel discharge chute with a slide gate and its lever, the lid's boards and a hatch, coal
 * spilled under the chute (black grit trodden into the snow round it: the mission's line extras).
 */
function buildCoalBunker(G, s) {
  const R = rng(seedOf('e06-coal-bunker'));
  const x = s.x, z = s.z, hw = s.w / 2 - 0.15, hd = s.d / 2 - 0.15, y0 = 2.6, y1 = 5.2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) G.box('e6_timber', x + sx * (hw - 0.15), y1 / 2 + 0.05, z + sz * (hd - 0.15), 0.3, y1 + 0.1, 0.3, 0, 0.75);
  // cross-bracing: an X on the north side, a single brace on each end (the south side is the chute's)
  member(G, 'e6_timber', [x - hw + 0.15, 0.4, z - hd + 0.15], [x + hw - 0.15, y0 - 0.2, z - hd + 0.15], 0.14, 0.7);
  member(G, 'e6_timber', [x + hw - 0.15, 0.4, z - hd + 0.12], [x - hw + 0.15, y0 - 0.2, z - hd + 0.12], 0.12, 0.7);
  for (const sx of [-1, 1]) member(G, 'e6_timber', [x + sx * (hw - 0.15), 0.5, z - hd + 0.15], [x + sx * (hw - 0.12), y0 - 0.25, z + hd - 0.15], 0.12, 0.68);
  // the bin: a dark core, planks laid on its four sides (each its own tone, a hair apart), corner and middle battens
  G.box('e6_timber', x, (y0 + y1) / 2, z, 2 * hw - 0.12, y1 - y0, 2 * hd - 0.12, 0, 0.45);
  const ph = 0.22;
  for (const [ax, az, bx, bz, nx, nz] of [[-hw, -hd, hw, -hd, 0, -1], [hw, -hd, hw, hd, 1, 0], [hw, hd, -hw, hd, 0, 1], [-hw, hd, -hw, -hd, -1, 0]]) {
    const L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L;
    // (the end sides' courses half a plank up: no two planks' tops level where they cross at a corner)
    for (let y = y0 + 0.02 + (nx ? ph / 2 : 0); y < y1 - 0.08; y += ph + 0.012) {
      // (each plank 4 cm thick, its inner face 5 mm off the core's face: hw - 0.06)
      const h = Math.min(ph, y1 - 0.03 - y), cx = x + (ax + bx) / 2 - nx * 0.035, cz = z + (az + bz) / 2 - nz * 0.035, j = (R() - 0.5) * 0.012;
      G.box('e6_door', cx + nx * j, y + h / 2, cz + nz * j, tx ? L + 0.06 : 0.04, h, tz ? L + 0.06 : 0.04, 0, 0.72 + R() * 0.3);
    }
    for (const u of [0.3, 0.7]) G.box('e6_timber', x + ax + (bx - ax) * u + nx * 0.013, (y0 + y1) / 2, z + az + (bz - az) * u + nz * 0.013, tx ? 0.12 : 0.05, y1 - y0 + 0.04, tz ? 0.12 : 0.05, 0, 0.6);
  }
  // the lid: boards with gaps, a steel hatch frame
  for (let u = -hw - 0.1; u < hw + 0.1; u += 0.27) G.box('e6_door', x + u + 0.12, y1 + 0.06, z, 0.24, 0.05, 2 * hd + 0.3, 0, 0.68 + R() * 0.25);
  G.box('e6_iron', x + 0.8, y1 + 0.11, z - 0.4, 0.95, 0.05, 0.95, 0, 0.5);
  // the hopper's sloping bottom down to the chute's mouth, the chute out to the south with its slide gate and lever
  const m = 0.32, yb = y0 - 0.85, mz = z + hd - 0.6;
  const C0 = [[x - hw + 0.1, y0, z - hd + 0.1], [x + hw - 0.1, y0, z - hd + 0.1], [x + hw - 0.1, y0, z + hd - 0.1], [x - hw + 0.1, y0, z + hd - 0.1]];
  const C1 = [[x - m, yb, mz - m], [x + m, yb, mz - m], [x + m, yb, mz + m], [x - m, yb, mz + m]];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; face(G, 'e6_door', [C0[i], C0[j], C1[j], C1[i]], [((C0[i][0] + C0[j][0]) / 2 - x), -0.4, ((C0[i][2] + C0[j][2]) / 2 - mz)], 0.62); }
  const end = [x, 1.0, z + hd + 0.9], beg = [x, yb - 0.02, mz + 0.1], cw = 0.36; // (a 27-degree slide)
  // (the chute's plate worn bare and black by the coal running down it: the rail iron's, which takes no snow)
  slab(G, 'e6_rail', [[beg[0] - cw, beg[1], beg[2]], [beg[0] + cw, beg[1], beg[2]], [end[0] + cw, end[1], end[2]], [end[0] - cw, end[1], end[2]]], 0.04, 0.8);
  for (const sx of [-1, 1]) face(G, 'e6_rust', [[x + sx * cw, beg[1], beg[2]], [x + sx * cw, end[1], end[2]], [x + sx * cw, end[1] + 0.3, end[2]], [x + sx * cw, beg[1] + 0.3, beg[2]]], [sx, 0, 0], 0.62);
  G.box('e6_iron', x, end[1] + 0.2, end[2] - 0.04, 2 * cw + 0.08, 0.42, 0.04, 0, 0.55);
  member(G, 'e6_iron', [x + cw + 0.05, end[1] + 0.3, end[2] - 0.05], [x + cw + 0.45, end[1] + 1.05, end[2] - 0.25], 0.04, 0.5);
  // coal spilled under the chute's end and between the posts: lumps of all sizes in a low drift
  for (let k = 0; k < 70; k++) {
    const a = R() * 6.28, r = Math.pow(R(), 1.6) * 1.6, px = end[0] + Math.cos(a) * r * 1.2, pz = end[2] + 0.3 + Math.sin(a) * r * 0.8;
    lump(G, R, px, 0.02 + (1.6 - r) * 0.08, pz, 0.05 + R() * 0.14);
  }
  for (let k = 0; k < 18; k++) lump(G, R, x + (R() - 0.5) * 2 * hw, 0.03, z + (R() - 0.5) * 2 * hd, 0.04 + R() * 0.08);
}
/**
 * The coal heap beside the bunker (its gameplay box: x, z, w × d, h): a low irregular mound of black coal heaped with
 * lumps; the snow on it is the scene's own prop snow (art/terrain/snowfx.js) held back on the coal (a negative bias:
 * a thin broken crust on the flattest tops, black lumps showing through), grit round its foot (the line extras' fans).
 */
function buildCoalHeap(G, s) {
  const R = rng(seedOf('e06-coal-heap'));
  // (art review r1 on the first heap: 22 long radial facets met at its peak — a faceted star under the snow. Now a
  // lobed mound in fine facets, its height and outline broken by low and high noise: the snow, held back on the coal,
  // lies in a broken crust on the flatter bits; most lumps rolled down to its foot)
  const rx = s.w / 2, rz = s.d / 2, H = (s.h ?? 1.8) * 0.9, N = 34;
  const rings = [1, 0.9, 0.79, 0.67, 0.55, 0.43, 0.31, 0.19, 0.08];
  const lobe = Array.from({ length: 5 }, () => [R() * 6.28, 0.04 + R() * 0.07, 1 + Math.floor(R() * 4)]);
  const rad = (a) => 1 + lobe.reduce((t, [p, m, k]) => t + Math.sin(a * k + p) * m, 0); // (the outline's lobes)
  const ang = Array.from({ length: N }, (_, i) => (i / N) * 6.28 + (R() - 0.5) * 0.08);
  const cx = s.x + (R() - 0.5) * 0.5, cz = s.z + (R() - 0.5) * 0.5;
  const V = rings.map((rr, k) => ang.map((a) => {
    const j = rad(a) * (1 + (R() - 0.5) * 0.08), hh = k ? H * (1 - Math.pow(rr, 1.5)) + (R() - 0.5) * 0.16 * (1 - rr * 0.6) : 0;
    return [cx + Math.cos(a) * rx * rr * j, Math.max(0, hh), cz + Math.sin(a) * rz * rr * j];
  }));
  const peak = [cx + (R() - 0.5) * 0.3, H * (1 - Math.pow(0.02, 1.5)) + 0.05, cz + (R() - 0.5) * 0.3];
  for (let k = 0; k + 1 < rings.length; k++) for (let i = 0; i < N; i++) {
    const j = (i + 1) % N, a = V[k][i], b = V[k][j], c = V[k + 1][j], d = V[k + 1][i];
    face(G, 'e6_coal', [a, b, c], [a[0] - cx, 1.2, a[2] - cz], 0.78 + R() * 0.25);
    face(G, 'e6_coal', [a, c, d], [a[0] - cx, 1.2, a[2] - cz], 0.78 + R() * 0.25);
  }
  const last = V[rings.length - 1];
  for (let i = 0; i < N; i++) face(G, 'e6_coal', [last[i], last[(i + 1) % N], peak], [0, 1, 0], 0.8 + R() * 0.15);
  // lumps on its flanks and rolled to its foot (seated on the mound's profile)
  const hAt = (px, pz) => {
    const a = Math.atan2((pz - cz) / rz, (px - cx) / rx), q = Math.min(1, Math.hypot((px - cx) / rx, (pz - cz) / rz) / rad(a));
    return H * (1 - Math.pow(Math.max(q, 0.08), 1.5));
  };
  for (let k = 0; k < 200; k++) {
    // (the first 30 heaped round the peak, where the facets meet)
    const a = R() * 6.28, q = k < 30 ? R() * 0.3 : 0.15 + Math.pow(R(), 0.55) * 0.95, px = cx + Math.cos(a) * rx * q * rad(a), pz = cz + Math.sin(a) * rz * q * rad(a);
    lump(G, R, px, hAt(px, pz) - 0.03, pz, 0.05 + Math.pow(R(), 1.5) * (k < 30 ? 0.14 : 0.2));
  }
}

// ---------------------------------------------------------------- the kennel [Hard]
function buildKennelE06(G, s) {
  const x = s.x, z = s.z, w = s.w * 0.92, d = s.d * 0.92;
  G.box('e6_timber', x, 0.4, z, w, 0.8, d, 0, 0.8);
  face(G, 'e6_iron', [[x - 0.25, 0.08, z - d / 2 - 0.005], [x + 0.25, 0.08, z - d / 2 - 0.005], [x + 0.25, 0.62, z - d / 2 - 0.005], [x - 0.25, 0.62, z - d / 2 - 0.005]], [0, 0, -1], 0.25);
  slab(G, 'e6_felt', [[x - w / 2 - 0.1, 0.8, z - d / 2 - 0.12], [x - w / 2 - 0.1, 0.8, z + d / 2 + 0.12], [x, 1.25, z + d / 2 + 0.12], [x, 1.25, z - d / 2 - 0.12]], 0.04, 0.85);
  slab(G, 'e6_felt', [[x, 1.25, z - d / 2 - 0.12], [x, 1.25, z + d / 2 + 0.12], [x + w / 2 + 0.1, 0.8, z + d / 2 + 0.12], [x + w / 2 + 0.1, 0.8, z - d / 2 - 0.12]], 0.04, 0.85);
  for (const sz of [-1, 1]) face(G, 'e6_timber', [[x - w / 2, 0.8, z + sz * d / 2], [x + w / 2, 0.8, z + sz * d / 2], [x, 1.22, z + sz * d / 2]], [0, 0, sz], 0.75);
  G.box('e6_iron', x - 0.4, 0.02, z - d / 2 - 0.45, 0.3, 0.04, 0.3, 0, 0.5); // the bowl
}

// ---------------------------------------------------------------- assembly
/**
 * Build e06's art into world.scene (once). `o`: the mission's geometry — span {x, z, w, d}, cabin, clock {x, z, y},
 * tower {x, z, y}, channel, ids (wagon, shunter, spanId), gantry legs, ridges, holes, avoid [[x, z, r]].
 */
/**
 * The mission's visuals hook (script.visuals): its art, then the baked coplanar plans on its own library buildings
 * (o.baked: [{id, asset}], art/coplanar-baked.js) — resolves when the plans are applied.
 */
export async function e06Visuals(world, o = {}) {
  buildE06Art(world, o);
  if (o.baked?.length) await applyBakedCoplanar(world, o.baked);
}

export function buildE06Art(world, o = {}) {
  if (!world?.scene || world._e06Art) return;
  world._e06Art = true;
  const root = new THREE.Group();
  root.name = 'e06:art';
  const R = rng(seedOf('e06-art'));
  const lit = [], extras = { decals: [] };
  const G = new Geo('e06-port');
  if (o.clock) buildTerminal(G, lit, R, o.clock, extras);
  if (o.tower) buildSearchlightTower(G, o.tower, lit);
  if (o.cabin) buildCabin(G, o.cabin, lit, extras);
  const kennel = world.structures?.get?.('kennel');
  if (kennel) buildKennelE06(G, kennel.def ?? kennel.spec ?? kennel);
  const bunker = world.structures?.get?.('coal_hopper');
  if (bunker) buildCoalBunker(G, bunker.def ?? bunker.spec ?? bunker);
  const heap = world.structures?.get?.('coal_heap');
  if (heap) buildCoalHeap(G, heap.def ?? heap.spec ?? heap);
  if (o.holes) iceProps(G, o.holes, R);
  root.add(G.build('e06:port', { ground: 0, damp: 0.9, streaks: 0.24, moss: 0.05, weather: WEATHER }));
  const glow = quadsMesh(lit, glowMaterial(), 'e06:lit_windows', R);
  if (glow) root.add(glow);
  // the notices and the enamel sign (canvas lettering on decal planes, a polygon offset over their walls)
  const TEX = {
    cabin_notice: () => noticeTexture([['BETRETEN', 10, 36, 22], ['VERBOTEN!', 10, 64, 22], ['Der', 10, 96, 14], ['Hafenkapitän', 10, 116, 15]]),
    wartesaal: () => noticeTexture([['WARTESAAL', 12, 40, 26]], 'rgb(38,62,118)', 'rgb(236,238,232)', 192, 64),
  };
  for (const d of extras.decals) {
    if (d.tex === 'soot') continue;
    const m = decal(TEX[d.tex]?.(), d.w, d.h, d.p, d.n);
    if (m) root.add(m);
  }
  // the stacks' and the stove pipe's soot down their slopes: one mesh
  const soot = decalBatch(sootTexture(), extras.decals.filter((d) => d.tex === 'soot'), 'e06:soot');
  if (soot) root.add(soot);
  // the terminal roofs' worked snow: the courses faint through it, the bared, scoured and sooted slates over them
  const courses = coursesMesh(roofCoursesTexture(), extras.courses || [], R);
  if (courses) root.add(courses);
  const wear = atlasDecals(roofWearTexture(), extras.roof || [], 3, 'e06:roof_wear');
  if (wear) root.add(wear);
  if (o.span) linkSpan(world, root, o.span, o.spanId, o.legs);
  // hide the span's placeholder plank
  const d = world.interactables?.find?.((i) => (i.tag ?? i.id) === o.spanId);
  if (d?.object3d) d.object3d.traverse((m) => { if (m.isMesh) m.visible = false; });
  if (o.tower) searchlight(world, root, [o.tower.x - 1.3, o.tower.y, o.tower.z + 1.75], o.crew || ['sl1', 'sl2', 'sl3']);
  iceArt(world, root, o);
  world.scene.add(root);
  // the wagon and the engine on their pushables, the wagon's fall
  const wagon = buildWagon(), wp = skinPushable(world, o.wagon, wagon);
  wagon.position.y = 0;
  wagonDrop(world, root, wp, wagon);
  const loco = buildShunter();
  skinPushable(world, o.shunter, loco);
  // decals: the wagon's stencils (both sides)
  const tex = stencilTexture([['Gw  01 80  155 2 14', 14, 40, 30], ['Hamburg', 14, 82, 30], ['REF. N  —  PLOMBIERT', 250, 82, 32], ['20 t', 420, 40, 28]]);
  for (const s of [-1, 1]) {
    const m = decal(tex, 2.6, 0.65, [s * (2.75 / 2 + 0.03), 1.75, -2.6 * s], [s, 0, 0]);
    if (m) wagon.add(m);
  }
  // the scene's snow on everything drawn here (roofs, copings, sills, the span's flanges, the wagon's roof); the rail
  // heads stay bare
  castleMaterial('e6_rail').userData.snowCover = true;
  castleMaterial('e6_deck').userData.snowCover = true; // (the span deck's snow is its own decal: spanDeckCrust)
  // the same snow held back (SNOW_BIAS, as boulder-row.js does on granite): the cabin's warm felt, slates bared by the
  // stacks or scoured by the wind, the coal (heap, spill, soot)
  for (const [key, bias] of Object.entries(SNOW_BIAS)) {
    const m = castleMaterial(key);
    if (!m.userData.snowCover) { addSnowCover(m, { uniforms: { uSnowAmt: propSnowAmount(), uSnowBias: { value: bias } } }); m.userData.snowCover = true; }
  }
  const amt = propSnowAmount?.().value || 1;
  coverPropsWithSnow(root, amt);
  coverPropsWithSnow(wagon, amt);
  coverPropsWithSnow(loco, amt);
}
