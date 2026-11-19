/**
 * LIGHTS OUT e01 "Dry Stone" art kit (Contrada Sant'Elia, Valle d'Itria, Puglia, September 1943): the procedural
 * buildings and props of an inland karst valley, our own models. Every builder draws inside its gameplay box (local
 * origin at the ground centre, +X along `w`, front = local +Z) or, for the walls, inside the gameplay line (world-frame
 * meshes), so what blocks is drawn and what is drawn blocks:
 *   - trullo              round whitewashed drum, corbelled cone of grey limestone slabs in courses, a white pinnacle,
 *                         an arched door and a small window (`door`: the door's local angle in degrees, 90 = front)
 *   - trullo_ruin         the knoll's broken trullo: a split drum, the cone fallen in as a heap of slabs
 *   - masseria_house      the fortified farm's whitewashed two-storey house: flat lime roof and parapet, an outside
 *                         stair up one gable (`stair`: 'W' | 'E'), shutters, rain spouts, a dovecote turret
 *   - masseria_tower      square watch tower: a battered (scarped) base, ashlar quoins, slit windows, corbelled
 *                         machicolations under a parapet with merlons; its outside stair climbs the `stair` face
 *   - masseria_stable     the garrison's stone stable block: rubble limestone, a terracotta pent roof, wide doors
 *   - masseria_roof       the radio room's lime-plastered roof slab on its beams, a stove pipe (visual only: the room's
 *                         walls are `wall` runs, variant masseria_room)
 *   - masseria_gate       the compound's arched gateway: two piers (the gameplay parts, `navParts`) and a round arch
 *   - cistern_tower       round limestone water tower by the north road, a parapet ring, an iron ladder, a spout
 *   - chapel_small        whitewashed wayside chapel with a bell gable (campanile a vela) and a slab roof
 *   - prickly_pear        a clump / hedge of Opuntia: chains of flat oval pads, a few fruit
 *   - e01_prop            small dressing by `variant`: radio_set, map_table, stove, chair, packing_cases, jars,
 *                         trough, shrine, bale, cart, pennant, hay
 * and two wall variants (art/dressing.js buildWall): `drystone_field` (the 1 m field walls, low cover) and
 * `masseria_rubble` / `masseria_room` (the compound's 3 m rubble wall, the radio room's plastered walls).
 * Palette (design §13): whitewash #efe9dc, slab grey #7f7d76, terra rossa #9a4e2e, dry-stone grey #a39d8c, ochre
 * render #d8b68a.
 * @module art/e01-kit
 */
import * as THREE from 'three';
import { dressingMaterial, boxUV, consolidate, boulderGeometry, rng, seedOf } from './dressing.js';
import { buildKitHouse } from './kit-buildings.js';
import { smoothLathe } from './round-roofs.js';
import { navProxy } from './ruin-kit.js';

const TAU = Math.PI * 2;
const H = 2, L = 1; // B.HIGH, B.LOW (world/grid.js B; not imported: no grid here)

// ------------------------------------------------------------------------------------------ materials

const MATS = new Map();
/** A dressing material tinted for e01 (memoised: one material per name + tint). */
function tinted(name, color) {
  const k = `${name}|${color}`;
  if (!MATS.has(k)) {
    const m = dressingMaterial(name).clone();
    m.color = new THREE.Color(color);
    m.name = `${m.name || name}:e01`;
    MATS.set(k, m);
  }
  return MATS.get(k);
}
const M = {
  lime: () => tinted('limewash', 0xf4efe4),        // whitewash
  limeShade: () => tinted('limewash', 0xd9d1c2),   // a dirtier band at the foot
  slab: () => tinted('stone', 0xa7aaa8),           // chiancarelle: grey limestone roof slabs
  slabDark: () => tinted('stone', 0x8a8d8c),
  dry: () => tinted('ashlar', 0xd2cdc1),           // dry-stone walls: pale karst limestone, the stones a shade darker than the packing
  dryMid: () => tinted('ashlar', 0xe4e0d6),        // (the core: the pale limestone set, read as packed stones)
  dryWarm: () => tinted('ashlar', 0xd9c7a8),       // lichen / terra rossa stained stones
  dryShade: () => tinted('ashlar', 0xbdb7aa),      // weathered grey stones (the north faces, old lichen)
  dryCore: () => tinted('stone', 0xe2ded3),        // the dry-laid core: the fieldstone set (flat stones, dark voids, no mortar)
  // (the loose stones of a dry wall — face, cap and fallen stones: the screed set's mottle reads as weathered limestone
  // with lichen; the ashlar set's coursing lines read as wood grain on a small split slab)
  stoneA: () => tinted('screed', 0xd8d4c8),
  stoneB: () => tinted('screed', 0xb7b2a6),
  stoneWarm: () => tinted('screed', 0xd9c6a4),
  rubble: () => tinted('rubble', 0xddd2bc),        // the compound wall
  ashlar: () => tinted('ashlar', 0xf0e6d2),
  ochre: () => tinted('plasterRough', 0xe6c99e),
  wood: () => dressingMaterial('door'),
  beam: () => dressingMaterial('beam'),
  iron: () => dressingMaterial('castIron'),
  terracotta: () => dressingMaterial('roofTerracotta'),
  screed: () => tinted('screed', 0xe8e1d2),
  dark: () => darkRecess(),
};
let DARK = null;
function darkRecess() {
  if (!DARK) DARK = new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 1, name: 'e01:recess' });
  return DARK;
}
const LAPPED = new Map();
/**
 * A cap stone's material for every other stone along a crest: the same look, drawn a depth step nearer (polygonOffset).
 * Neighbouring cap stones lie across each other at odd angles, their tops nearly level: where two stones' faces cross at
 * a shallow angle they fought in a band along the crossing (z-fighting); the offset gives every crossing one winner.
 * (A geometric step instead — every other stone 6 mm lower — only moved the crossings: tops apart, sides met.)
 */
function lapped(mat) {
  if (!LAPPED.has(mat)) {
    const m = mat.clone();
    m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2; m.name = `${mat.name}:lapped`;
    LAPPED.set(mat, m);
  }
  return LAPPED.get(mat);
}
const PAINT = new Map();
function paint(color, rough = 0.7) {
  const k = `${color}|${rough}`;
  if (!PAINT.has(k)) PAINT.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, name: `e01:paint:${color.toString(16)}` }));
  return PAINT.get(k);
}

// ------------------------------------------------------------------------------------------ helpers

function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}
function tbox(w, h, d, mat, x = 0, y = h / 2, z = 0, tile = 1.6) {
  const m = mesh(boxUV(new THREE.BoxGeometry(w, h, d).toNonIndexed(), tile), mat);
  m.position.set(x, y, z);
  return m;
}
function tcyl(r0, r1, h, seg, mat, x = 0, y = h / 2, z = 0, tile = 1.4) {
  const m = mesh(boxUV(new THREE.CylinderGeometry(r0, r1, h, seg).toNonIndexed(), tile), mat);
  m.position.set(x, y, z);
  return m;
}
function lathe(pts, seg, mat, tile = 1.4, o = {}) {
  return mesh(smoothLathe(pts, seg, { tile, ...o }), mat);
}
/** A stone of size (sx, sy, sz) at (x, y, z), yaw `ry`. */
function stone(sx, sy, sz, seed, mat, x, y, z, ry = 0) {
  const m = mesh(boulderGeometry(sx, sy, sz, seed, 0), mat);
  m.position.set(x, y, z); m.rotation.y = ry;
  return m;
}
const seedFor = (p, tag) => seedOf(`${tag}:${p.id ?? `${p.x},${p.z}`}`);

/**
 * A split limestone slab (half-sizes sx, sy, sz): a box whose corners are knocked about and whose faces stay flat —
 * the angular, faceted read of field stone (a smooth rounded stone reads as a sandbag at the game camera).
 */
function slab(sx, sy, sz, R, mat) {
  const g = new THREE.BoxGeometry(sx * 2, sy * 2, sz * 2).toNonIndexed(), P = g.attributes.position;
  const jit = new Map();
  for (let i = 0; i < P.count; i++) {
    const key = `${Math.sign(P.getX(i))}${Math.sign(P.getY(i))}${Math.sign(P.getZ(i))}`;
    if (!jit.has(key)) jit.set(key, [1 + (R() - 0.5) * 0.45, 1 + (R() - 0.5) * 0.5, 1 + (R() - 0.5) * 0.45]);
    const [jx, jy, jz] = jit.get(key);
    P.setXYZ(i, P.getX(i) * jx, P.getY(i) * jy, P.getZ(i) * jz);
  }
  g.computeVertexNormals();
  return mesh(boxUV(g, 0.6), mat);
}

/** An arched door (a dark recess, the plank leaf set back, a limestone surround) on a face at local (x, z), facing yaw. */
function archDoor(g, x, z, yaw, w = 0.95, h = 1.9, o = {}) {
  const d = new THREE.Group();
  d.position.set(x, 0, z); d.rotation.y = yaw;
  const r = w / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-r, 0); shape.lineTo(-r, h - r); shape.absarc(0, h - r, r, Math.PI, 0, true); shape.lineTo(r, 0); shape.lineTo(-r, 0);
  const recess = mesh(new THREE.ShapeGeometry(shape, 8), M.dark(), false);
  recess.position.z = 0.012; d.add(recess);
  if (o.leaf !== false) {
    const leaf = mesh(boxUV(new THREE.ShapeGeometry(shape, 8), 1.0), o.leafMat || paint(o.color ?? 0x3f5f78, 0.75), false);
    leaf.scale.set(0.94, 0.97, 1); leaf.position.set(0, 0.01, 0.02); d.add(leaf);
    const hinge = tbox(0.05, 0.05, 0.02, M.iron(), w * 0.32, h * 0.62, 0.035, 0.5); d.add(hinge);
  }
  // the surround: jambs and a voussoir ring in pale limestone, a hair proud of the face
  for (const s of [-1, 1]) d.add(tbox(0.16, h - r, 0.06, M.ashlar(), s * (r + 0.08), (h - r) / 2, 0.03, 0.8));
  const ring = new THREE.Shape();
  ring.absarc(0, 0, r + 0.16, 0, Math.PI, false); ring.absarc(0, 0, r, Math.PI, 0, true);
  const rg = mesh(new THREE.ExtrudeGeometry(ring, { depth: 0.06, bevelEnabled: false, curveSegments: 10 }), M.ashlar());
  rg.position.set(0, h - r, 0); d.add(rg);
  if (o.step !== false) d.add(tbox(w + 0.4, 0.12, 0.34, M.ashlar(), 0, 0.06, 0.17, 0.8));
  g.add(d);
  return d;
}
/** A small square window: dark pane, a limestone sill, painted shutters folded back. */
function smallWindow(g, x, y, z, yaw, w = 0.55, h = 0.65, color = 0x4f6b52) {
  const d = new THREE.Group(); d.position.set(x, y, z); d.rotation.y = yaw;
  d.add(tbox(w, h, 0.03, M.dark(), 0, 0, 0.015, 1));
  d.add(tbox(w + 0.14, 0.06, 0.12, M.ashlar(), 0, -h / 2 - 0.03, 0.06, 0.6));
  for (const s of [-1, 1]) { const sh = tbox(w / 2, h, 0.03, paint(color), s * (w / 2 + w / 4 + 0.02), 0, 0.03, 0.8); d.add(sh); }
  g.add(d);
}

// ------------------------------------------------------------------------------------------ trullo

/**
 * Trullo: limewashed drum (`r` m outer radius at the foot, battered), a cone of grey slab courses springing from a
 * narrow ledge, a white pinnacle. The drum is 2.25 m; the whole stands `h` m. `door` (deg, local; 90 = +Z front),
 * `win` (deg) the small window, `chimney` (deg) an optional flue stack on the drum.
 */
export function buildTrullo(p) {
  const r = p.r ?? 3.5, h = p.h ?? 6, R = rng(seedFor(p, 'trullo'));
  const g = new THREE.Group(); g.name = 'e01:trullo';
  const hd = 2.25, rTop = r * 0.95, seg = 28;
  // drum with a darker splash band at the foot
  g.add(lathe([[r * 0.995, 0], [r, 0.3], [rTop, hd], [rTop * 0.985, hd + 0.02], [0, hd + 0.02]], seg, M.lime(), 1.6));
  g.add(lathe([[r * 1.002, -0.02], [r * 1.003, 0.32], [r * 0.97, 0.32], [r * 0.97, -0.02]], seg, M.limeShade(), 1.2));
  // the ledge (a course of slabs) and the cone in corbelled courses: each course a riser and a step in
  const y0 = hd + 0.02, rc0 = rTop * 0.97, hc = Math.max(2.4, h - hd - 0.7), N = 15, pts = [[rc0 + 0.02, y0], [rc0 + 0.02, y0 + 0.1]];
  for (let k = 0; k < N; k++) {
    const t0 = k / N, t1 = (k + 1) / N;
    const rad = (t) => 0.26 + (rc0 - 0.26) * (1 - t) * (1 + 0.16 * t); // a near-straight cone, a hint convex (ogival)
    const ya = y0 + 0.1 + hc * t0, yb = y0 + 0.1 + hc * t1;
    pts.push([rad(t0), ya + (yb - ya) * 0.72], [rad(t1) + 0.035, ya + (yb - ya) * 0.78], [rad(t1), yb]);
  }
  const apex = y0 + 0.1 + hc;
  pts.push([0, apex]);
  g.add(lathe(pts, seg, M.slab(), 0.9, { crease: 25 }));
  // pinnacle: a limewashed neck, a disc and a ball
  g.add(tcyl(0.24, 0.3, 0.32, 12, M.lime(), 0, apex + 0.12, 0, 0.8));
  g.add(tcyl(0.2, 0.2, 0.06, 12, M.lime(), 0, apex + 0.31, 0, 0.8));
  const ball = mesh(new THREE.SphereGeometry(0.15, 12, 8), M.lime()); ball.position.set(0, apex + 0.48, 0); g.add(ball);
  // door, window, a stone bench by the door
  const at = (deg, rr = r) => { const a = (deg * Math.PI) / 180; return [Math.cos(a) * rr, Math.sin(a) * rr, Math.PI / 2 - a]; };
  const dAng = p.doorDeg ?? 90, [dx, dz, dy] = at(dAng, r * 0.985);
  archDoor(g, dx, dz, dy, 0.9, 1.85, { color: [0x3f5f78, 0x5a6f4a, 0x6b4a32][Math.floor(R() * 3)] });
  const wAng = p.win ?? dAng + 120 + R() * 60, [wx, wz, wy] = at(wAng, r * 0.975);
  smallWindow(g, wx, 1.45, wz, wy, 0.45, 0.5, [0x4f6b52, 0x3f5f78, 0x6b5a3a][Math.floor(R() * 3)]);
  if (p.chimney != null) {
    const [cx, cz] = at(p.chimney, rTop * 0.8);
    g.add(tbox(0.55, 1.5, 0.55, M.lime(), cx, hd + 0.75, cz, 1.2));
    g.add(tbox(0.7, 0.08, 0.7, M.slab(), cx, hd + 1.54, cz, 0.8));
  }
  return consolidate(g);
}

/** The knoll's broken trullo: a split, jagged drum and the fallen cone heaped inside and spilling out of the gap. */
export function buildTrulloRuin(p) {
  const r = p.r ?? 2.6, h = p.h ?? 2.2, R = rng(seedFor(p, 'trullo_ruin'));
  const g = new THREE.Group(); g.name = 'e01:trullo_ruin';
  const seg = 24, gap = 0.9; // the breach (rad), facing the knoll's path (+Z)
  const geo = new THREE.CylinderGeometry(r * 0.94, r, h, seg, 3, true, Math.PI / 2 + gap / 2, TAU - gap);
  const P = geo.attributes.position;
  for (let i = 0; i < P.count; i++) {
    if (P.getY(i) > h / 2 - 1e-3) P.setY(i, h / 2 - (R() < 0.4 ? R() * 1.1 : R() * 0.3));
  }
  geo.computeVertexNormals();
  const drum = mesh(boxUV(geo.toNonIndexed(), 1.4), M.limeShade()); drum.position.y = h / 2;
  g.add(drum);
  const inner = mesh(boxUV(geo.clone().scale(0.86, 1, 0.86).toNonIndexed(), 1.4), M.dryMid()); inner.position.y = h / 2;
  g.add(inner);
  // the fallen cone: slabs heaped in the middle and through the breach
  for (let k = 0; k < 46; k++) {
    const a = R() * TAU, rr = Math.sqrt(R()) * r * 0.75, out = R() < 0.25;
    const x = out ? (R() - 0.5) * 1.6 : Math.cos(a) * rr, z = out ? r * (0.9 + R() * 0.7) : Math.sin(a) * rr;
    const s = 0.22 + R() * 0.25, y = out ? 0 : Math.max(0, (1 - rr / r) * 1.1) * R();
    g.add(stone(s, s * 0.35, s * 0.8, Math.floor(R() * 1e9), R() < 0.6 ? M.slab() : M.slabDark(), x, y, z, R() * TAU));
  }
  return consolidate(g);
}

// ------------------------------------------------------------------------------------------ masseria

/** Merlons along a parapet run from (x0, z0) to (x1, z1) at height y (local frame). */
function merlons(g, x0, z0, x1, z1, y, mat, mw = 0.55, gapW = 0.45, mh = 0.55, t = 0.4) {
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.floor((L + gapW) / (mw + gapW)));
  const step = (L - mw) / Math.max(1, n - 1), ux = (x1 - x0) / L, uz = (z1 - z0) / L;
  for (let k = 0; k < n; k++) {
    const s = mw / 2 + k * step;
    const m = tbox(ux ? mw : t, mh, ux ? t : mw, mat, x0 + ux * s, y + mh / 2, z0 + uz * s, 1);
    g.add(m);
  }
}

/** A straight stone stair (visual) rising from (x0, z0) at y 0 along +u to height `top` over `run` m, `w` wide. */
function outsideStair(g, x0, z0, ux, uz, run, top, w, mat, rail = true, railSide = 1) {
  const n = Math.max(4, Math.round(top / 0.19)), tr = run / n, rise = top / n;
  const yaw = Math.atan2(-uz, ux);
  // (the steps overlap 1 cm along the run: their sides alternate 12 / 24 mm in from the landing's so no two side faces
  // share a plane, and the top step stops at the landing instead of reaching 5 mm into it — z-fighting)
  for (let k = 0; k < n; k++) {
    const top = k === n - 1, len = top ? tr : tr + 0.01, s = top ? tr * k + tr / 2 : tr * (k + 0.5), y = rise * (k + 1);
    const m = tbox(len, y, w - (k % 2 ? 0.024 : 0.012), mat, x0 + ux * s, y / 2, z0 + uz * s, 1.2);
    m.rotation.y = yaw; g.add(m);
  }
  if (rail) { // a solid limewashed parapet on the open side
    const nx = -uz * railSide, nz = ux * railSide, len = Math.hypot(run, top), cx = x0 + ux * run / 2 + nx * (w / 2 - 0.08), cz = z0 + uz * run / 2 + nz * (w / 2 - 0.08);
    const m = tbox(len, 0.16, 0.16, M.ashlar(), cx, top / 2 + 0.7, cz, 1);
    m.rotation.set(0, yaw, Math.atan2(top, run)); g.add(m);
  }
}

/**
 * The masseria's main house: a whitewashed kit body (art/kit-buildings.js buildKitHouse, desert style: limewash, a
 * flat lime-screed roof behind a parapet, painted shutters) set in from one gable by the outside stair that climbs
 * along that gable to a first-floor door; a dovecote turret and rain spouts.
 */
export function buildMasseriaHouse(p) {
  const w = p.w ?? 20, d = p.d ?? 8, h = p.h ?? 7, side = p.stair ?? 'W', sw = p.stairW ?? 1.25;
  const g = new THREE.Group(); g.name = 'e01:masseria_house';
  const sgn = side === 'E' ? 1 : side === 'W' ? -1 : 0, bw = w - (sgn ? sw : 0);
  const body = buildKitHouse({ ...p, w: bw, variant: 'whitewash_masseria', roofWalk: false, chimney: false }, 'desert');
  body.position.x = -sgn * sw / 2;
  g.add(body);
  if (sgn) {
    const xg = sgn * (w / 2 - sw / 2), top = Math.min(h - 0.6, (h / Math.max(1, Math.round(h / 3.1))) + 0.05);
    // the stair runs along the gable from its front corner to a landing at the back
    outsideStair(g, xg, d / 2 - 0.1, 0, -1, d - 1.6, top, sw - 0.1, M.lime(), true, sgn); // (the rail on the open, outer side)
    g.add(tbox(sw - 0.1, top, 1.5, M.lime(), xg, top / 2, -d / 2 + 0.75, 1.4));
    // the upper door on the landing, opening on the gable
    archDoor(g, xg - sgn * (sw / 2 - 0.02), -d / 2 + 0.75, sgn > 0 ? Math.PI / 2 : -Math.PI / 2, 0.9, 1.9, { step: false, color: 0x6b4a32 });
  }
  // a dovecote turret on the roof's far end (a colombaia: square, holes, a slab cap) — off the parapet
  const R = rng(seedFor(p, 'house'));
  const dx = (bw / 2 - 1.4) * (sgn ? sgn : 1) * -1 + (-sgn * sw / 2), dz = -d / 2 + 1.3;
  // (1.66 m: the kit's desert stairhead, when the roof has one at this end, stands 1.8 × 1.6 at the same corner — a 1.6 m
  // dovecote and its 1.8 m cap shared its side and back planes: z-fighting; now every face stands 3–7 cm off them)
  const dw = 1.66;
  g.add(tbox(dw, 1.5, dw, M.lime(), dx, h + 0.75, dz, 1.2));
  g.add(tbox(dw + 0.2, 0.1, dw + 0.2, M.slab(), dx, h + 1.55, dz, 0.8));
  for (let k = 0; k < 3; k++) g.add(tbox(0.12, 0.14, 0.03, M.dark(), dx - 0.4 + k * 0.4, h + 1.05, dz + dw / 2 + 0.01, 0.5));
  // terracotta rain spouts through the parapet on the front
  for (let k = 0; k < Math.max(2, Math.floor(bw / 6)); k++) {
    const sx = -bw / 2 + (bw / Math.max(2, Math.floor(bw / 6))) * (k + 0.5) - sgn * sw / 2;
    const s = tcyl(0.07, 0.07, 0.5, 8, M.terracotta(), sx, h + 0.12, d / 2 + 0.05, 0.6); s.rotation.x = Math.PI / 2 - 0.15; g.add(s);
  }
  void R;
  return consolidate(g);
}

/**
 * Square watch tower: battered base to 2.6 m, limewashed body with ashlar quoins and slit windows, a corbelled
 * machicolation course and a parapet with merlons round the walkable top (`top`, default h - 1). Its outside stair
 * (`stair`: 'E' | 'S' | 'W' | 'N') climbs inside the box along that face to a door at mid-height.
 */
export function buildMasseriaTower(p) {
  const w = p.w ?? 7, d = p.d ?? 7, h = p.h ?? 11, top = p.top ?? h - 1;
  const g = new THREE.Group(); g.name = 'e01:masseria_tower';
  const st = p.stair ?? null, sw = 1.1, inset = 0.35;
  const ox = st === 'E' ? -sw / 2 : st === 'W' ? sw / 2 : 0, oz = st === 'S' ? -sw / 2 : st === 'N' ? sw / 2 : 0;
  const bw = w - (st === 'E' || st === 'W' ? sw : 0) - inset, bd = d - (st === 'S' || st === 'N' ? sw : 0) - inset;
  // scarp: a frustum from the full plan at the foot to the body at 2.6 m
  const scarp = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4);
  const SP = scarp.attributes.position;
  for (let i = 0; i < SP.count; i++) {
    const up = SP.getY(i) > 0, sx = up ? bw : bw + inset, sz = up ? bd : bd + inset;
    SP.setXYZ(i, SP.getX(i) * sx * Math.SQRT2 / 2 * Math.SQRT2, (SP.getY(i) + 0.5) * 2.6, SP.getZ(i) * sz * Math.SQRT2 / 2 * Math.SQRT2);
  }
  scarp.computeVertexNormals();
  const sm = mesh(boxUV(scarp.toNonIndexed(), 1.6), M.rubble()); sm.position.set(ox, 0, oz); g.add(sm);
  // body
  // (the body stops under the 6 cm roof deck: its top and the deck's shared the walk plane — z-fighting)
  g.add(tbox(bw, top - 2.66, bd, M.lime(), ox, 2.6 + (top - 2.66) / 2, oz, 1.8));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    for (let y = 2.7; y < top - 0.4; y += 0.62) { // alternating quoins
      const long = Math.round(y / 0.62) % 2 === 0;
      g.add(tbox(long ? 0.62 : 0.34, 0.3, long ? 0.34 : 0.62, M.ashlar(), ox + sx * (bw / 2 - (long ? 0.29 : 0.15)), y + 0.15, oz + sz * (bd / 2 - (long ? 0.15 : 0.29)), 0.8));
    }
  }
  // slit windows on every face, two storeys
  for (const fy of [4.6, 7.4]) {
    if (fy > top - 1.2) continue;
    for (const [nx, nz, len] of [[0, 1, bw], [0, -1, bw], [1, 0, bd], [-1, 0, bd]]) {
      const x = ox + nx * (bw / 2 + 0.005), z = oz + nz * (bd / 2 + 0.005);
      const m = tbox(nz ? 0.18 : 0.02, 0.85, nz ? 0.02 : 0.18, M.dark(), x, fy, z, 1); g.add(m); void len;
    }
  }
  // machicolation: corbels under a projecting parapet course (0.25 m out, above head height)
  const py = top - 0.5;
  for (const [nx, nz, len] of [[0, 1, bw], [0, -1, bw], [1, 0, bd], [-1, 0, bd]]) {
    const n = Math.max(3, Math.floor(len / 0.8));
    for (let k = 0; k < n; k++) {
      const u = -len / 2 + (len / n) * (k + 0.5);
      const x = ox + (nz ? u : nx * (bw / 2 + 0.1)), z = oz + (nx ? u : nz * (bd / 2 + 0.1));
      g.add(tbox(nz ? 0.22 : 0.22, 0.45, 0.22, M.ashlar(), x, py - 0.22, z, 0.6));
    }
  }
  const pw = bw + 0.5, pd = bd + 0.5;
  g.add(tbox(pw, 0.12, pd, M.ashlar(), ox, py + 0.06, oz, 1));
  // parapet walls with merlons round the walkable top
  // (the E / W walls run between the N / S ones: overlapping corner blocks shared their outer and top faces — z-fighting)
  for (const [x, z, ax, len] of [[0, pd / 2 - 0.2, true, pw], [0, -pd / 2 + 0.2, true, pw], [pw / 2 - 0.2, 0, false, pd - 0.8], [-pw / 2 + 0.2, 0, false, pd - 0.8]]) {
    g.add(tbox(ax ? len : 0.4, top + 0.55 - py - 0.12, ax ? 0.4 : len, M.lime(), ox + x, py + 0.12 + (top + 0.55 - py - 0.12) / 2, oz + z, 1.6));
  }
  merlons(g, ox - pw / 2, oz + pd / 2 - 0.2, ox + pw / 2, oz + pd / 2 - 0.2, top + 0.55, M.lime());
  merlons(g, ox - pw / 2, oz - pd / 2 + 0.2, ox + pw / 2, oz - pd / 2 + 0.2, top + 0.55, M.lime());
  merlons(g, ox + pw / 2 - 0.2, oz - pd / 2 + 0.6, ox + pw / 2 - 0.2, oz + pd / 2 - 0.6, top + 0.55, M.lime());
  merlons(g, ox - pw / 2 + 0.2, oz - pd / 2 + 0.6, ox - pw / 2 + 0.2, oz + pd / 2 - 0.6, top + 0.55, M.lime());
  g.add(tbox(pw - 0.8, 0.06, pd - 0.8, M.screed(), ox, top - 0.03, oz, 2)); // the roof deck the sentry stands on
  // the outside stair along `stair` up to a door at the first storey
  if (st) {
    const fl = 3.6, run = Math.min((st === 'E' || st === 'W' ? d : w) - 1.6, fl / 0.55);
    const [x0, z0, ux, uz] = st === 'E' ? [w / 2 - sw / 2, d / 2 - 0.3, 0, -1] : st === 'W' ? [-w / 2 + sw / 2, d / 2 - 0.3, 0, -1]
      : st === 'S' ? [-w / 2 + 0.3, d / 2 - sw / 2, 1, 0] : [-w / 2 + 0.3, -d / 2 + sw / 2, 1, 0];
    outsideStair(g, x0, z0, ux, uz, run, fl, sw - 0.12, M.lime(), true);
    const lx = x0 + ux * (run + 0.5), lz = z0 + uz * (run + 0.5);
    g.add(tbox(ux ? 1.0 : sw - 0.12, fl, uz ? 1.0 : sw - 0.12, M.lime(), lx, fl / 2, lz, 1.4));
    const yaw = st === 'E' ? Math.PI / 2 : st === 'W' ? -Math.PI / 2 : st === 'S' ? 0 : Math.PI;
    const dd = archDoor(g, lx - (st === 'E' ? sw / 2 : st === 'W' ? -sw / 2 : 0), lz - (st === 'S' ? sw / 2 : st === 'N' ? -sw / 2 : 0), yaw, 0.85, 1.85, { step: false, color: 0x5a4636 });
    dd.position.y = fl;
  }
  return consolidate(g);
}

/** The garrison's stable block: rubble limestone walls, wide plank doors, a terracotta pent roof sloping to the back. */
export function buildMasseriaStable(p) {
  const w = p.w ?? 20, d = p.d ?? 7, h = p.h ?? 5;
  const g = new THREE.Group(); g.name = 'e01:masseria_stable';
  const hb = h - 0.9, R = rng(seedFor(p, 'stable'));
  g.add(tbox(w, hb, d, M.rubble(), 0, hb / 2, 0, 1.8));
  g.add(tbox(w + 0.04, 0.35, d + 0.04, M.limeShade(), 0, 0.17, 0, 1.2));
  // pent roof: front eave at hb + 0.15, back at h
  const roof = new THREE.BoxGeometry(w + 0.5, 0.14, d + 0.5);
  const rp = roof.attributes.position;
  for (let i = 0; i < rp.count; i++) rp.setY(i, rp.getY(i) + (rp.getZ(i) < 0 ? (h - hb) : 0.15));
  roof.computeVertexNormals();
  const rm = mesh(boxUV(roof.toNonIndexed(), 1.6), M.terracotta()); rm.position.y = hb; g.add(rm);
  // the raised back wall under the pent
  g.add(tbox(w, h - hb, 0.5, M.rubble(), 0, hb + (h - hb) / 2, -d / 2 + 0.25, 1.6));
  // stable doors (two wide plank pairs) and hay hatches on the front
  const n = Math.max(2, Math.floor(w / 7));
  for (let k = 0; k < n; k++) {
    const x = -w / 2 + (w / n) * (k + 0.5);
    g.add(tbox(2.2, 2.4, 0.04, M.dark(), x, 1.2, d / 2 + 0.01, 1));
    for (const s of [-1, 1]) g.add(tbox(1.05, 2.3, 0.05, M.wood(), x + s * 0.56, 1.15, d / 2 + 0.03, 1));
    g.add(tbox(2.5, 0.2, 0.12, M.ashlar(), x, 2.5, d / 2 + 0.06, 0.8));
    g.add(tbox(0.7, 0.5, 0.04, M.dark(), x + 2.2, hb - 0.6, d / 2 + 0.01, 1));
  }
  // iron tethering rings and a stone trough along the front (inside the box: against the wall)
  for (let k = 0; k < Math.floor(w / 3); k++) {
    const ring = mesh(new THREE.TorusGeometry(0.06, 0.012, 4, 8), M.iron(), false);
    ring.position.set(-w / 2 + 1.5 + k * 3 + R() * 0.3, 1.3, d / 2 + 0.02); g.add(ring);
  }
  return consolidate(g);
}

/** The radio room's roof: a lime-screed slab on its beam ends, a parapet lip, the stove's iron pipe (visual only). */
export function buildMasseriaRoof(p) {
  const w = p.w ?? 7, d = p.d ?? 7, h = p.h ?? 3.5;
  const g = new THREE.Group(); g.name = 'e01:masseria_roof';
  g.add(tbox(w, 0.22, d, M.screed(), 0, h + 0.11, 0, 2));
  g.add(tbox(w + 0.06, 0.18, d + 0.06, M.lime(), 0, h - 0.09, 0, 1.5));
  // (the E / W lips run between the N / S ones: overlapping corners shared their end and top faces — z-fighting)
  for (const [len, x, z, ax] of [[w, 0, d / 2 - 0.12, true], [w, 0, -d / 2 + 0.12, true], [d - 0.48, w / 2 - 0.12, 0, false], [d - 0.48, -w / 2 + 0.12, 0, false]]) {
    g.add(tbox(ax ? len : 0.24, 0.32, ax ? 0.24 : len, M.lime(), x, h + 0.38, z, 1.4));
  }
  if (p.pipe) {
    const [px, pz] = p.pipe;
    g.add(tcyl(0.09, 0.09, 1.5, 10, M.iron(), px, h + 0.75, pz, 0.5));
    g.add(tcyl(0.16, 0.12, 0.12, 10, M.iron(), px, h + 1.52, pz, 0.5));
  }
  return consolidate(g);
}

/** The compound's gateway: two rubble piers (the gameplay parts) and a round limestone arch over the passage. */
export function buildMasseriaGate(p) {
  const w = p.w ?? 6, d = p.d ?? 1.2, h = p.h ?? 4.8, open = p.open ?? 4;
  const g = new THREE.Group(); g.name = 'e01:masseria_gate';
  const pierW = (w - open) / 2, sp = open / 2 + pierW / 2;
  for (const s of [-1, 1]) {
    g.add(tbox(pierW, h, d, M.rubble(), s * sp, h / 2, 0, 1.6));
    g.add(tbox(pierW + 0.08, 0.16, d + 0.08, M.ashlar(), s * sp, h + 0.08, 0, 1));
  }
  const spring = h - open / 2 - 0.35, R0 = open / 2, R1 = open / 2 + 0.45;
  const sh = new THREE.Shape(); sh.absarc(0, 0, R1, 0, Math.PI, false); sh.absarc(0, 0, R0, Math.PI, 0, true);
  // (the arch ring stands 2 cm proud of the piers it springs from and the spandrel rubble sits 1.5 cm back: all three
  // were flush, front and back, where the ring and the spandrels run into the piers — z-fighting)
  const arch = mesh(new THREE.ExtrudeGeometry(sh, { depth: d + 0.04, bevelEnabled: false, curveSegments: 14 }), M.ashlar());
  arch.position.set(0, spring, -d / 2 - 0.02); g.add(arch);
  // spandrels up to the coping
  const sp2 = new THREE.Shape(); sp2.moveTo(-R1, 0); sp2.lineTo(-R1, h - spring); sp2.lineTo(R1, h - spring); sp2.lineTo(R1, 0); sp2.absarc(0, 0, R1, 0, Math.PI, false);
  const span = mesh(new THREE.ExtrudeGeometry(sp2, { depth: d - 0.03, bevelEnabled: false, curveSegments: 14 }), M.rubble());
  span.position.set(0, spring, -d / 2 + 0.015); g.add(span);
  // (the coping over the arch butts the piers' copings: it overlapped them 0.5 m each side, top and faces flush)
  g.add(tbox(open - 0.08, 0.16, d + 0.08, M.ashlar(), 0, h + 0.08, 0, 1));
  return consolidate(g);
}

/** Round limestone cistern tower: battered courses, a parapet ring round its top, an iron ladder, a spout and basin. */
export function buildCisternTower(p) {
  const r = p.r ?? 3, h = p.h ?? 8, R = rng(seedFor(p, 'cistern'));
  const g = new THREE.Group(); g.name = 'e01:cistern_tower';
  const seg = 26, top = h - 0.7;
  // (the drum ends where the parapet ring starts: a 2 cm lip ran up the ring's own outer face — z-fighting)
  g.add(lathe([[r, 0], [r * 0.93, top]], seg, M.ashlar(), 1.2));
  const cap = mesh(boxUV(new THREE.CircleGeometry(r * 0.93, seg).rotateX(-Math.PI / 2), 1.6), M.screed()); cap.position.y = top + 0.02; g.add(cap);
  // string courses
  for (const y of [1.2, 3.6, 6.0]) if (y < top) g.add(lathe([[r * (1 - 0.07 * y / top) + 0.02, y], [r * (1 - 0.07 * y / top) + 0.04, y + 0.1], [r * (1 - 0.07 * (y + 0.18) / top) + 0.02, y + 0.18]], seg, M.lime(), 0.8));
  // the parapet ring and its coping
  const rp = r * 0.93;
  g.add(lathe([[rp, top], [rp, h], [rp - 0.32, h], [rp - 0.32, top + 0.02]], seg, M.ashlar(), 1));
  g.add(lathe([[rp + 0.04, h], [rp + 0.04, h + 0.1], [rp - 0.36, h + 0.1], [rp - 0.36, h]], seg, M.lime(), 0.8));
  // iron ladder on the west face (-X), rungs every 0.3 m, the stiles bracketed to the stone
  const lx = -(r * 0.97) - 0.12;
  for (const s of [-1, 1]) g.add(tcyl(0.025, 0.025, h + 0.6, 6, M.iron(), lx, (h + 0.6) / 2, s * 0.24, 0.4));
  for (let y = 0.3; y < h + 0.4; y += 0.3) { const rung = tcyl(0.016, 0.016, 0.48, 5, M.iron(), lx, y, 0, 0.4); rung.rotation.x = Math.PI / 2; g.add(rung); }
  // the outlet spout and a stone basin on the east (+X) foot
  const sp = tcyl(0.05, 0.05, 0.5, 8, M.iron(), r * 1.0 + 0.1, 0.9, 0, 0.4); sp.rotation.z = Math.PI / 2 - 0.3; g.add(sp);
  g.add(tbox(0.9, 0.45, 0.6, M.ashlar(), r * 0.75 + 0.35, 0.225, 0, 0.8));
  g.add(tbox(0.7, 0.05, 0.4, paint(0x4f5d52, 0.2), r * 0.75 + 0.35, 0.42, 0, 0.5));
  void R;
  return consolidate(g);
}

/** Whitewashed wayside chapel: a front door with a limestone frame, an oculus, a bell gable over the front, slab roof. */
export function buildChapel(p) {
  const w = p.w ?? 6, d = p.d ?? 8, h = p.h ?? 7;
  const g = new THREE.Group(); g.name = 'e01:chapel_small';
  const hw = Math.min(h - 2.4, 4.2);
  g.add(tbox(w, hw, d, M.lime(), 0, hw / 2, 0, 1.8));
  g.add(tbox(w + 0.04, 0.3, d + 0.04, M.limeShade(), 0, 0.15, 0, 1.2));
  // a pitched slab roof
  const rise = 1.5, shape = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.15, 0), new THREE.Vector2(w / 2 + 0.15, 0), new THREE.Vector2(0, rise)]);
  const roof = new THREE.ExtrudeGeometry(shape, { depth: d + 0.3, bevelEnabled: false });
  roof.translate(0, 0, -(d + 0.3) / 2);
  const rm = mesh(boxUV(roof, 1.2), M.slab()); rm.position.y = hw; g.add(rm);
  // the gable front with its bell gable (a wall with an arched opening and the bell)
  const gs = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, rise)]);
  const gf = mesh(new THREE.ExtrudeGeometry(gs, { depth: 0.3, bevelEnabled: false }), M.lime()); gf.position.set(0, hw, d / 2 - 0.3); g.add(gf);
  const bw = 1.4, bh = h - hw - rise + 0.6;
  const bell = new THREE.Shape(); bell.moveTo(-bw / 2, 0); bell.lineTo(bw / 2, 0); bell.lineTo(bw / 2, bh - 0.3); bell.lineTo(0, bh); bell.lineTo(-bw / 2, bh - 0.3); bell.lineTo(-bw / 2, 0);
  const hole = new THREE.Path(); hole.moveTo(-0.32, 0.25); hole.lineTo(0.32, 0.25); hole.lineTo(0.32, bh - 0.75); hole.absarc(0, bh - 0.75, 0.32, 0, Math.PI, false); hole.lineTo(-0.32, 0.25);
  bell.holes.push(hole);
  const bm = mesh(new THREE.ExtrudeGeometry(bell, { depth: 0.3, bevelEnabled: false, curveSegments: 8 }), M.lime());
  bm.position.set(0, hw + rise - 0.6, d / 2 - 0.3); g.add(bm);
  const b = mesh(new THREE.CylinderGeometry(0.1, 0.2, 0.32, 12, 1, true), paint(0x6b5a3a, 0.4)); b.position.set(0, hw + rise - 0.6 + bh - 0.85, d / 2 - 0.15); g.add(b);
  // door, oculus, side windows
  // (on the 2 cm foot band's face: at the wall face the leaf's foot lay in the band's front plane — z-fighting)
  archDoor(g, 0, d / 2 + 0.02, 0, 1.15, 2.3, { color: 0x5a3a26 });
  const oc = mesh(new THREE.CircleGeometry(0.32, 16), M.dark(), false); oc.position.set(0, hw - 0.6, d / 2 + 0.012); g.add(oc);
  const ocr = mesh(new THREE.TorusGeometry(0.38, 0.06, 6, 18), M.ashlar()); ocr.position.set(0, hw - 0.6, d / 2 + 0.02); g.add(ocr);
  for (const s of [-1, 1]) smallWindow(g, s * (w / 2 + 0.005), 2.4, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0.35, 0.9, 0x5a3a26);
  return consolidate(g);
}

/**
 * Opuntia (prickly pear): `w` × `d` (a hedge along the longer side) or a clump of radius `r`: plants of chained flat
 * oval pads, the old ones grey-green and woody at the base, a few orange-red fruit on the rims.
 */
export function buildPricklyPear(p) {
  const R = rng(seedFor(p, 'opuntia'));
  const g = new THREE.Group(); g.name = 'e01:prickly_pear';
  const w = p.w ?? (p.r ?? 1.2) * 2, d = p.d ?? (p.r ?? 1.2) * 2, along = w >= d, len = Math.max(w, d), wid = Math.min(w, d);
  const pad = new THREE.SphereGeometry(0.5, 8, 6);
  pad.scale(0.3, 0.38, 0.06); pad.translate(0, 0.17, 0); // pivot at the joint (its base), the pad growing up from it
  const padMats = [paint(0x6f8f5a, 0.85), paint(0x7d9a62, 0.85), paint(0x627f4f, 0.85), paint(0x86a06a, 0.85)];
  const old = paint(0x8f8a6a, 0.95), fruit = paint(0xc8562e, 0.6);
  const top = Math.min(p.h ?? 1.8, 2.0), half = [w / 2 - 0.2, d / 2 - 0.2];
  const plants = Math.max(1, Math.round(len / 1.1));
  const tmp = new THREE.Object3D(), up = new THREE.Vector3(), dir = new THREE.Vector3();
  // one pad at (x, y, z) leaning `tilt` from upright in the vertical plane at `yaw`; its children grow from its rim
  const grow = (x, y, z, yaw, tilt, s, depth) => {
    if (depth > 5 || y > top - 0.15) return;
    tmp.position.set(x, y, z); tmp.rotation.set(0, yaw, 0); tmp.rotateZ(-tilt); tmp.scale.setScalar(s); tmp.updateMatrix();
    const m = mesh(pad, depth === 0 ? old : padMats[Math.floor(R() * 4)]);
    m.applyMatrix4(tmp.matrix); g.add(m);
    // the pad's tip, where the next ones sprout
    up.set(0, 0.34 * s, 0).applyEuler(tmp.rotation);
    const tx = x + up.x, ty = y + up.y, tz = z + up.z;
    if (depth >= 2 && R() < 0.4) { const f = mesh(new THREE.SphereGeometry(0.04, 5, 4), fruit, false); f.position.set(tx, ty + 0.02, tz); g.add(f); }
    const kids = depth < 2 ? 3 : R() < 0.55 ? 2 : 1;
    for (let c = 0; c < kids; c++) {
      const nt = Math.max(-1.0, Math.min(1.0, tilt + (c - (kids - 1) / 2) * 0.7 + (R() - 0.5) * 0.4));
      const ny = yaw + (R() - 0.5) * 1.2;
      dir.set(Math.sin(nt) * 0.04, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), ny);
      const nx = tx + dir.x, nz = tz + dir.z;
      if (Math.abs(along ? nx : nz) > (along ? half[0] : half[1]) || Math.abs(along ? nz : nx) > (along ? half[1] : half[0])) continue;
      grow(nx, ty - 0.03, nz, ny, nt, s * (0.9 + R() * 0.15), depth + 1);
    }
  };
  for (let k = 0; k < plants; k++) {
    const u = plants === 1 ? 0 : -len / 2 + 0.45 + (len - 0.9) * (k / (plants - 1)) + (R() - 0.5) * 0.25;
    const v = (R() - 0.5) * Math.max(0, wid - 0.9);
    const bx = along ? u : v, bz = along ? v : u;
    g.add(tcyl(0.08, 0.12, 0.35, 6, old, bx, 0.17, bz, 0.5));
    const n0 = 2 + Math.floor(R() * 2);
    for (let q = 0; q < n0; q++) grow(bx, 0.3, bz, R() * TAU, (R() - 0.5) * 0.8, 1.0 + R() * 0.15, 1);
  }
  return consolidate(g);
}

// ------------------------------------------------------------------------------------------ small props

/** Small dressing by `variant` (local origin on the ground, front +Z). */
export function buildE01Prop(p) {
  const v = String(p.variant || ''), R = rng(seedFor(p, `prop:${v}`)), w = p.w ?? 1, d = p.d ?? 1;
  const g = new THREE.Group(); g.name = `e01:prop:${v}`;
  if (v === 'radio_set') { // a trestle table under a field transceiver, a receiver, a key, headphones
    g.add(tbox(w, 0.05, d, M.beam(), 0, 0.76, 0, 1));
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(tbox(0.05, 0.74, 0.05, M.beam(), sx * (w / 2 - 0.08), 0.37, sz * (d / 2 - 0.08), 0.6));
    g.add(tbox(0.55, 0.32, 0.32, paint(0x3e4637, 0.6), -w / 4, 0.95, -d / 4, 0.6));
    g.add(tbox(0.42, 0.26, 0.28, paint(0x3e4637, 0.6), w / 5, 0.92, -d / 4, 0.6));
    for (let k = 0; k < 6; k++) { const k2 = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 8), paint(0x1b1b1b, 0.4)); k2.rotation.x = Math.PI / 2; k2.position.set(-w / 4 - 0.18 + k * 0.07, 0.98, -d / 4 + 0.165); g.add(k2); }
    g.add(tbox(0.12, 0.03, 0.07, paint(0x2a2a2a, 0.4), 0.05, 0.8, d / 4, 0.4));
    return consolidate(g);
  }
  if (v === 'map_table') { // a heavy farmhouse table with a spread map and a lamp
    g.add(tbox(w, 0.08, d, M.beam(), 0, 0.78, 0, 1));
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(tbox(0.09, 0.74, 0.09, M.beam(), sx * (w / 2 - 0.1), 0.37, sz * (d / 2 - 0.1), 0.6));
    const map = tbox(w * 0.7, 0.01, d * 0.66, paint(0xd9cfae, 0.95), 0, 0.825, 0, 1); map.rotation.y = 0.06; g.add(map);
    g.add(tcyl(0.07, 0.09, 0.22, 10, paint(0x6a5a32, 0.4), w * 0.35, 0.93, -d * 0.3, 0.4));
    return consolidate(g);
  }
  if (v === 'stove') { // a cast-iron stove on stone, its pipe
    g.add(tbox(w, 0.12, d, M.ashlar(), 0, 0.06, 0, 0.8));
    g.add(tbox(w * 0.7, 0.75, d * 0.7, M.iron(), 0, 0.5, 0, 0.6));
    g.add(tcyl(0.09, 0.09, (p.h ?? 3.4) - 0.88, 10, M.iron(), 0, 0.88 + ((p.h ?? 3.4) - 0.88) / 2, -d * 0.15, 0.5));
    g.add(tbox(w * 0.3, 0.2, 0.02, paint(0x8a3418, 0.5), 0, 0.42, d * 0.351, 0.4)); // the fire door's glow
    return consolidate(g);
  }
  if (v === 'chair') {
    g.add(tbox(0.42, 0.04, 0.42, M.beam(), 0, 0.45, 0, 0.6));
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(tbox(0.04, 0.45, 0.04, M.beam(), sx * 0.18, 0.225, sz * 0.18, 0.4));
    g.add(tbox(0.42, 0.45, 0.04, M.beam(), 0, 0.7, -0.19, 0.6));
    return consolidate(g);
  }
  if (v === 'packing_cases') { // the detachment's cases, stencilled, stacked for the road
    const n = Math.max(2, Math.round((w * d) / 0.7));
    for (let k = 0; k < n; k++) {
      const cw = 0.7 + R() * 0.3, cd = 0.5 + R() * 0.2, ch = 0.45 + R() * 0.2;
      const x = (R() - 0.5) * Math.max(0, w - cw), z = (R() - 0.5) * Math.max(0, d - cd), y = k % 3 === 2 ? 0.5 : 0;
      const c = tbox(cw, ch, cd, R() < 0.5 ? paint(0x5c5a42, 0.8) : M.beam(), x, y + ch / 2, z, 0.8); c.rotation.y = (R() - 0.5) * 0.3; g.add(c);
    }
    return consolidate(g);
  }
  if (v === 'jars') { // terracotta storage jars (capase) against a wall
    const n = Math.max(2, Math.round(w / 0.55));
    for (let k = 0; k < n; k++) {
      const x = -w / 2 + 0.3 + (w - 0.6) * (n === 1 ? 0.5 : k / (n - 1)), s = 0.75 + R() * 0.4;
      const jar = lathe([[0.12 * s, 0], [0.26 * s, 0.25 * s], [0.28 * s, 0.45 * s], [0.18 * s, 0.7 * s], [0.12 * s, 0.75 * s], [0.14 * s, 0.8 * s], [0, 0.8 * s]], 12, M.terracotta(), 0.6);
      jar.position.set(x, 0, (R() - 0.5) * Math.max(0, d - 0.6)); g.add(jar);
    }
    return consolidate(g);
  }
  if (v === 'trough') {
    g.add(tbox(w, 0.55, d, M.ashlar(), 0, 0.275, 0, 0.8));
    g.add(tbox(w - 0.2, 0.04, d - 0.2, paint(0x4f5d52, 0.15), 0, 0.5, 0, 0.5));
    return consolidate(g);
  }
  if (v === 'shrine') { // a limewashed pier with a niche (the faded Madonna as a dark recess), a slab cap, a jar of flowers
    g.add(tbox(w, p.h ?? 2, d, M.lime(), 0, (p.h ?? 2) / 2, 0, 1.2));
    g.add(tbox(w * 0.55, 0.6, 0.05, M.dark(), 0, (p.h ?? 2) - 0.75, d / 2 + 0.005, 0.5));
    g.add(tbox(w * 0.45, 0.45, 0.03, paint(0x6f7f9a, 0.8), 0, (p.h ?? 2) - 0.78, d / 2 + 0.02, 0.5));
    g.add(tbox(w + 0.12, 0.1, d + 0.12, M.slab(), 0, (p.h ?? 2) + 0.05, 0, 0.6));
    return consolidate(g);
  }
  if (v === 'buttress') { // a battered rubble buttress against the gate pier: uneven courses, a worn slab on top (the old mounting block)
    const h = p.h ?? 2.4;
    const core = new THREE.BoxGeometry(w, h, d, 3, 6, 4), P = core.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const t = (P.getY(i) + h / 2) / h;
      P.setX(i, P.getX(i) * (1 - 0.16 * t) + (R() - 0.5) * 0.05);
      P.setZ(i, P.getZ(i) * (1 - 0.1 * t) + (R() - 0.5) * 0.05);
    }
    core.computeVertexNormals();
    g.add(mesh(boxUV(core.toNonIndexed(), 0.8), M.rubble())).position.y = h / 2;
    for (let y = 0.25; y < h - 0.3; y += 0.32 + R() * 0.1) { // proud stones in loose courses on the faces
      for (const sd of [-1, 1]) {
        if (R() < 0.35) continue;
        const s = 0.14 + R() * 0.08;
        g.add(stone(s * 1.6, s * 0.7, s * 0.6, Math.floor(R() * 1e9), R() < 0.7 ? M.dry() : M.dryWarm(), sd * (w / 2) * (1 - 0.16 * (y / h)), y, (R() - 0.5) * d * 0.7));
      }
    }
    g.add(tbox(w * 0.92 + 0.1, 0.12, d * 0.92 + 0.1, M.slab(), (R() - 0.5) * 0.05, h + 0.04, 0, 0.6));
    return consolidate(g);
  }
  if (v === 'bale') { // straw bales
    const n = Math.max(1, Math.round(w / 0.9));
    for (let k = 0; k < n; k++) g.add(tbox(0.85, 0.42, 0.5, dressingMaterial('straw'), -w / 2 + 0.45 + k * 0.9, 0.21, (R() - 0.5) * 0.1, 0.8));
    return consolidate(g);
  }
  if (v === 'cart') { // a two-wheeled farm cart, shafts down
    g.add(tbox(w * 0.62, 0.08, d, M.beam(), 0, 0.85, 0, 0.8));
    // (the side boards stop 1 cm short of the bed's ends: their end faces and the bed's shared a plane — z-fighting)
    for (const s of [-1, 1]) g.add(tbox(w * 0.62 - 0.02, 0.35, 0.05, M.beam(), 0, 1.05, s * (d / 2 - 0.03), 0.8));
    for (const s of [-1, 1]) { const wh = mesh(new THREE.TorusGeometry(0.62, 0.05, 6, 16), M.beam()); wh.position.set(0, 0.62, s * (d / 2 + 0.02)); g.add(wh); }
    for (const s of [-1, 1]) { const sh = tbox(w * 0.42, 0.06, 0.06, M.beam(), w * 0.48, 0.42, s * 0.35, 0.6); sh.rotation.z = -0.55; g.add(sh); }
    return consolidate(g);
  }
  if (v === 'pennant') { // a plain pennant on a pole by the gate (no emblem)
    g.add(tcyl(0.04, 0.05, p.h ?? 5, 6, M.beam(), 0, (p.h ?? 5) / 2, 0, 0.6));
    const f = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.2, -0.22), new THREE.Vector2(0, -0.45)]);
    const fm = mesh(new THREE.ShapeGeometry(f), paint(0x8a8a7a, 0.9), false); fm.material.side = THREE.DoubleSide; fm.position.set(0.04, (p.h ?? 5) - 0.1, 0); g.add(fm);
    return consolidate(g);
  }
  if (v === 'hay') { // hay stooks in a field
    const n = Math.max(1, Math.round((w * d) / 4));
    for (let k = 0; k < n; k++) {
      const st = lathe([[0.55, 0], [0.5, 0.5], [0.3, 1.0], [0.05, 1.25], [0, 1.25]], 9, dressingMaterial('straw'), 0.8);
      st.position.set((R() - 0.5) * Math.max(0, w - 1.2), 0, (R() - 0.5) * Math.max(0, d - 1.2)); g.add(st);
    }
    return consolidate(g);
  }
  if (v === 'loop_antenna') { // the DF van's rotating loop on its mast (stands on the van's roof)
    const y = p.y ?? 2.6;
    g.add(tcyl(0.03, 0.03, 0.7, 6, M.iron(), 0, y + 0.35, 0, 0.4));
    const loop = mesh(new THREE.TorusGeometry(0.42, 0.025, 6, 20), paint(0x3a3f36, 0.5)); loop.position.set(0, y + 1.1, 0); loop.rotation.y = p.loopYaw ?? 0.6; g.add(loop);
    return consolidate(g);
  }
  return consolidate(g);
}

// ------------------------------------------------------------------------------------------ walls (dressing.js buildWall)

/**
 * The dry-stone field wall (muretto a secco; the jazzo's 2.3 m walls too): a battered core of pale karst limestone laid
 * dry — the fieldstone set, its stones in loose courses with dark voids between (no mortar) — a crest that wanders and
 * dips where the wall ends, flat face stones standing proud in staggered courses (they break the silhouette and the
 * shading: never a smooth slab), flat cap stones laid across the top at odd angles, and a few stones fallen at the
 * foot. Everything inside the gameplay line and its ends but the fallen stones (within a hand's breadth of the foot,
 * ankle-high); the cap's top within a hand of the gameplay height.
 * @param {number[][]} points world polyline @param {{h: number, width: number, id?: string}} o @param {() => number} R
 */
export function drystoneFieldWall(points, o, R) {
  const { h, width } = o, root = new THREE.Group(); root.name = 'dressing:wall:drystone_field';
  const hc = h - 0.1; // the cap stones make up the height
  const stoneMat = () => { const r = R(); return r < 0.55 ? M.stoneA() : r < 0.85 ? M.stoneB() : M.stoneWarm(); };
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1], Lseg = Math.hypot(bx - ax, bz - az);
    if (Lseg < 1e-3) continue;
    const rot = -Math.atan2(bz - az, bx - ax), cx = (ax + bx) / 2, cz = (az + bz) / 2;
    const first = k === 0, last = k + 2 === points.length;
    const Lw = Lseg + (first ? 0 : width / 2) + (last ? 0 : width / 2), shift = ((last ? 0 : width / 2) - (first ? 0 : width / 2)) / 2;
    const tx = Math.cos(-rot), tz = Math.sin(-rot), nx = -tz, nz = tx;
    const at = (u, v, y, m) => { m.position.set(cx + tx * (u + shift) + nx * v, y, cz + tz * (u + shift) + nz * v); m.rotation.y = rot + (m.userData.yaw || 0); return m; };
    // (a free end's crest falls away over its last ~0.7 m: walls in these fields end in a tumble, not a cut)
    const endDrop = (u) => {
      const e = Math.min(first ? u + Lw / 2 : Infinity, last ? Lw / 2 - u : Infinity);
      return e < 0.7 ? (1 - e / 0.7) * Math.min(0.28, hc * 0.18) : 0;
    };
    // (a stone at a free end stays within it: `ext` is its half-reach along the wall, corners knocked about included)
    const endLo = first ? -Lw / 2 : -Infinity, endHi = last ? Lw / 2 : Infinity;
    const fits = (u, ext) => u - ext >= endLo - 0.03 && u + ext <= endHi + 0.03;
    const segs = Math.max(4, Math.round(Lw / 0.3)), rows = Math.max(3, Math.round(hc / 0.3));
    const geo = new THREE.BoxGeometry(Lw, hc, width * 0.9, segs, rows, 1), P = geo.attributes.position;
    const wob = Array.from({ length: segs + 1 }, () => (R() - 0.5) * 0.11);
    const bulge = Array.from({ length: (segs + 1) * (rows + 1) }, () => 0.93 + R() * 0.12);
    for (let i = 0; i < P.count; i++) {
      const t = (P.getY(i) + hc / 2) / hc, u = P.getX(i), j = Math.round((u / Lw + 0.5) * segs), r = Math.round(t * rows);
      P.setZ(i, P.getZ(i) * (1 - 0.22 * t) * bulge[Math.min(bulge.length - 1, j * (rows + 1) + r)]);
      if (t > 0.999) P.setY(i, hc / 2 + wob[j] - endDrop(u));
      else if (t > 0.5) P.setY(i, P.getY(i) - endDrop(u) * (t - 0.5) * 2 * 0.7);
    }
    geo.computeVertexNormals();
    root.add(at(0, 0, hc / 2, mesh(boxUV(geo.toNonIndexed(), 1.7), M.dryCore())));
    // face stones standing proud, in staggered courses (every 0.24–0.3 m), most of the face covered
    const course = Math.min(0.3, Math.max(0.22, hc / Math.max(3, Math.round(hc / 0.27))));
    for (const sd of [-1, 1]) {
      let row = 0;
      for (let y = course * 0.55; y < hc - 0.12; y += course * (0.9 + R() * 0.2), row++) {
        for (let u = -Lw / 2 + 0.12 + (row % 2) * 0.18 + R() * 0.12; u < Lw / 2 - 0.12; u += 0.32 + R() * 0.3) {
          if (R() < 0.22) continue;
          const yy = y - endDrop(u) * (y / hc);
          if (yy > hc - 0.1 - endDrop(u)) continue;
          const s = 0.1 + R() * 0.08, face = (width * 0.9 / 2) * (1 - 0.22 * (yy / hc)), sx = s * (1.1 + R() * 0.6);
          if (!fits(u, sx * 1.3)) continue;
          const m = slab(sx, s * (0.4 + R() * 0.25), Math.min(s * 0.5, (width / 2 - face) / 1.25), R, stoneMat());
          m.userData.yaw = (R() - 0.5) * 0.16;
          m.rotation.x = (R() - 0.5) * 0.25;
          root.add(at(u, sd * (face - 0.015), yy + (R() - 0.5) * 0.05, m));
        }
      }
    }
    // the cap: flat stones laid across the crest at odd angles, some overlapping, one now and then on edge
    for (let u = -Lw / 2 + 0.1, nCap = 0; u < Lw / 2 - 0.08; u += 0.2 + R() * 0.17) {
      const s = 0.1 + R() * 0.07, onEdge = R() < 0.12;
      const thick = onEdge ? s * 0.65 : s * (0.28 + R() * 0.17), deep = onEdge ? s * 0.35 : Math.min(width * 0.42, s * 1.3);
      // (laid across at an odd angle, yet inside the gameplay line: the slab's half-length across the wall is what the
      // line leaves once its yaw, its offset and its knocked-about corners (×1.25) are paid for)
      const yaw = (R() - 0.5) * 0.7, v = (R() - 0.5) * width * 0.1;
      const room = (width / 2 + 0.015 - Math.abs(v)) / 1.25 - deep * Math.abs(Math.sin(yaw));
      const len = Math.max(0.06, Math.min(s * (1.6 + R() * 0.8), room / Math.cos(yaw)));
      const r = R();
      if (!fits(u, 1.25 * (deep * Math.cos(yaw) + len * Math.abs(Math.sin(yaw))))) continue;
      const cm = r < 0.55 ? M.stoneB() : r < 0.88 ? M.stoneA() : M.stoneWarm();
      const m = slab(deep, thick, len, R, nCap++ % 2 ? lapped(cm) : cm);
      m.userData.yaw = yaw;
      m.rotation.z = (R() - 0.5) * 0.3;
      // (its top no higher than a hand over the gameplay height: the cover the player reads is the cover he gets)
      root.add(at(u, v, Math.min(hc + wob[Math.round((u / Lw + 0.5) * segs)] - endDrop(u) + thick * 0.45, h + 0.08 - thick * 1.25), m));
    }
    // a few stones fallen at the foot (more where a free end has tumbled)
    for (const sd of [-1, 1]) {
      for (let u = -Lw / 2 + R() * 1.5; u < Lw / 2; u += 1.2 + R() * 2.2) {
        if (R() < 0.45 && endDrop(u) === 0) continue;
        const s = 0.05 + R() * 0.04, yaw = (R() - 0.5) * 0.8; // (lying along the foot, as they fell)
        if (!fits(u, 1.25 * (s * 1.3 * Math.cos(yaw) + s * 0.9 * Math.abs(Math.sin(yaw))))) continue;
        const m = slab(s * 1.3, s * 0.4, s * 0.9, R, stoneMat());
        m.userData.yaw = yaw;
        root.add(at(u, sd * (width * 0.45 + s * 0.6), s * 0.3, m));
      }
    }
  }
  return consolidate(root);
}

/**
 * The dry-stone walls' gameplay stamping source: the walls' first look (a battered core, proud stones in two loose
 * courses, a row of rounded coping stones), on which the mission's nav, sight and tops were measured — the game's
 * grid the reference solution plays, cached for the headless sim in tools/solutions/navcache/e01.json. It stays the
 * measured geometry, never drawn (art/ruin-kit.js navProxy), under the drawn look (drystoneFieldWall). The visual nav
 * stamp (world/map-builder.js stampVisualNav) blocks every 0.25 m cell a wall's dressing reaches at body height: the
 * redone look's proud stones cross a cell line here and there — 256 more cells over the walls, 32 of them along the
 * jazzo's north wall, which closed the Easy route past its corner. Built from the wall's own seed: the same geometry,
 * stone for stone, as before the look was redone.
 */
function drystoneNavSource(points, o, R) {
  const { h, width } = o, root = new THREE.Group(); root.name = 'dressing:wall:drystone_field';
  const hc = h - 0.16; // the coping stones make up the height
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1], Lseg = Math.hypot(bx - ax, bz - az);
    if (Lseg < 1e-3) continue;
    const rot = -Math.atan2(bz - az, bx - ax), cx = (ax + bx) / 2, cz = (az + bz) / 2;
    const first = k === 0, last = k + 2 === points.length;
    const Lw = Lseg + (first ? 0 : width / 2) + (last ? 0 : width / 2), shift = ((last ? 0 : width / 2) - (first ? 0 : width / 2)) / 2;
    const tx = Math.cos(-rot), tz = Math.sin(-rot), nx = -tz, nz = tx;
    const at = (u, v, y, m) => { m.position.set(cx + tx * (u + shift) + nx * v, y, cz + tz * (u + shift) + nz * v); m.rotation.y = rot + (m.userData.yaw || 0); return m; };
    const segs = Math.max(4, Math.round(Lw / 0.4)), geo = new THREE.BoxGeometry(Lw, hc, width * 0.9, segs, 3, 1), P = geo.attributes.position;
    const wob = Array.from({ length: segs + 1 }, () => (R() - 0.5) * 0.08);
    for (let i = 0; i < P.count; i++) {
      const t = (P.getY(i) + hc / 2) / hc, j = Math.round((P.getX(i) / Lw + 0.5) * segs);
      P.setZ(i, P.getZ(i) * (1 - 0.25 * t) * (0.96 + R() * 0.08));
      if (t > 0.999) P.setY(i, hc / 2 + wob[j]);
    }
    geo.computeVertexNormals();
    root.add(at(0, 0, hc / 2, mesh(boxUV(geo.toNonIndexed(), 0.9), M.dryMid())));
    // proud stones in two loose courses on each face
    for (const sd of [-1, 1]) {
      for (const y of [0.22, 0.55]) {
        for (let u = -Lw / 2 + 0.3 + R() * 0.2; u < Lw / 2 - 0.3; u += 0.55 + R() * 0.35) {
          if (R() < 0.25) continue;
          const s = 0.13 + R() * 0.08, face = (width * 0.9 / 2) * (1 - 0.25 * (y / hc));
          const m = stone(s * (1.2 + R() * 0.5), s * (0.55 + R() * 0.25), Math.min(s * 0.7, width / 2 - face + 0.02), Math.floor(R() * 1e9), R() < 0.7 ? M.dry() : M.dryWarm(), 0, 0, 0);
          root.add(at(u, sd * (face - 0.02), y + (R() - 0.5) * 0.06, m));
        }
      }
    }
    // coping: rounded stones set along the crest
    for (let u = -Lw / 2 + 0.1; u < Lw / 2 - 0.1; u += 0.22 + R() * 0.16) {
      const s = 0.1 + R() * 0.07;
      const m = stone(s * (1 + R() * 0.6), s * 0.75, Math.min(width * 0.38, s * 1.3), Math.floor(R() * 1e9), R() < 0.8 ? M.dry() : M.dryWarm(), 0, 0, 0);
      root.add(at(u, (R() - 0.5) * width * 0.12, hc + s * 0.45 + (R() - 0.5) * 0.04, m));
    }
  }
  return consolidate(root);
}

/**
 * The masseria's 3 m compound wall (`masseria_rubble`): coursed rubble limestone, a lime-washed upper band and a
 * rounded lime coping; or the radio room's plastered walls (`masseria_room`: limewash both faces, a dado).
 */
export function masseriaWall(points, o, R) {
  const { h, width } = o, root = new THREE.Group();
  const room = /room/.test(String(o.variant)); root.name = `dressing:wall:${room ? 'masseria_room' : 'masseria_rubble'}`;
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1], Lseg = Math.hypot(bx - ax, bz - az);
    if (Lseg < 1e-3) continue;
    const rot = -Math.atan2(bz - az, bx - ax), cx = (ax + bx) / 2, cz = (az + bz) / 2;
    const first = k === 0, last = k + 2 === points.length;
    // (every other run is 3 % thinner, and reaches into the corners only by its own half width: where two runs overlap
    // at a corner, the one's end face and the other's side face shared a plane, rubble and lime band alike —
    // z-fighting; now the thinner run's faces all sit 1 cm inside the other's)
    const wk = !room && k % 2 ? width * 0.97 : width, ext = wk / 2;
    const Lw = Lseg + (first ? 0 : ext) + (last ? 0 : ext), shift = ((last ? 0 : ext) - (first ? 0 : ext)) / 2;
    const tx = Math.cos(-rot), tz = Math.sin(-rot), nx = -tz, nz = tx;
    const at = (u, v, y, m) => { m.position.set(cx + tx * (u + shift) + nx * v, y, cz + tz * (u + shift) + nz * v); m.rotation.y = rot; return m; };
    if (room) {
      root.add(at(0, 0, h / 2, tbox(Lw, h, width, M.lime(), 0, 0, 0, 1.8)));
      root.add(at(0, 0, 0.3, tbox(Lw + 0.01, 0.6, width + 0.02, M.limeShade(), 0, 0, 0, 1.2)));
      continue;
    }
    const band = Math.min(1.1, h * 0.35);
    root.add(at(0, 0, (h - band) / 2, tbox(Lw, h - band, wk, M.rubble(), 0, 0, 0, 1.4)));
    root.add(at(0, 0, h - band / 2, tbox(Lw, band, wk * 0.96, M.lime(), 0, 0, 0, 1.6)));
    const cap = new THREE.CylinderGeometry(wk / 2, wk / 2, Lw, 8, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.45, 1);
    root.add(at(0, 0, h, mesh(boxUV(cap.toNonIndexed(), 1.2), M.lime())));
    // a few weathered patches where the render has fallen off the upper band
    for (let u = -Lw / 2 + 1 + R() * 3; u < Lw / 2 - 1; u += 4 + R() * 6) {
      for (const sd of [-1, 1]) if (R() < 0.5) root.add(at(u, sd * (wk / 2 + 0.004), h - band * (0.3 + R() * 0.4), tbox(0.6 + R() * 0.9, 0.25 + R() * 0.3, 0.01, M.rubble(), 0, 0, 0, 1)));
    }
  }
  return consolidate(root);
}

/** Wall variants this kit draws (art/dressing.js buildWall). */
export const E01_WALL_RX = /^(drystone_field|masseria_rubble|masseria_room)$/;
export function buildE01Wall(points, o, R) {
  if (o.variant !== 'drystone_field') return masseriaWall(points, o, R);
  // the drawn look is visual only (`userData.clip = false` on the group and on every mesh: no gameplay measure sees it);
  // the first look's geometry, from the same seed as R (dressing.js buildWall), stays the stamping source, undrawn
  const look = drystoneFieldWall(points, o, R);
  look.name = 'dressing:wall:drystone_field:look';
  look.traverse((m) => { m.userData.clip = false; });
  const nav = navProxy(drystoneNavSource(points, o, rng(seedOf(o.id ?? points.flat().join(',')))));
  // (the GTAO normal prepass swaps every visible mesh's material for its own: an undrawn mesh would still be drawn
  // there — 15 draws, 80 k triangles — and shade the drawn look with ambient occlusion of a wall nobody sees)
  nav.traverse((m) => { if (m.isMesh) m.userData.aoExclude = true; });
  nav.add(look);
  return nav;
}

// ------------------------------------------------------------------------------------------ extra prop registry

/** Extra prop types (art/props-extra.js): defaults; footprints by kind (round: circle r, box: rect w × d). */
export const E01_EXTRA_DEFAULTS = {
  trullo: { r: 3.5, h: 6, block: H, mat: 'plaster', kind: 'round' },
  trullo_ruin: { r: 2.6, h: 2.2, block: H, mat: 'stone', kind: 'round' },
  masseria_house: { w: 20, d: 8, h: 7, block: H, mat: 'plaster' },
  masseria_tower: { w: 7, d: 7, h: 11, block: H, mat: 'plaster' },
  masseria_stable: { w: 20, d: 7, h: 5, block: H, mat: 'stone' },
  masseria_roof: { w: 7, d: 7, h: 3.5, block: 0, mat: 'plaster' },
  masseria_gate: { w: 6, d: 1.2, h: 4.8, block: H, mat: 'stone' },
  cistern_tower: { r: 3, h: 8, block: H, mat: 'stone', kind: 'round' },
  chapel_small: { w: 6, d: 8, h: 7, block: H, mat: 'plaster' },
  prickly_pear: { w: 2.4, d: 1.4, h: 1.8, block: L, mat: 'wood' },
  e01_prop: { w: 1, d: 1, h: 1, block: L, mat: 'wood' },
};
const BUILD = {
  trullo: buildTrullo, trullo_ruin: buildTrulloRuin, masseria_house: buildMasseriaHouse, masseria_tower: buildMasseriaTower,
  masseria_stable: buildMasseriaStable, masseria_roof: buildMasseriaRoof, masseria_gate: buildMasseriaGate, cistern_tower: buildCisternTower,
  chapel_small: buildChapel, prickly_pear: buildPricklyPear, e01_prop: buildE01Prop,
};
/** The kit mesh for an e01 extra type (local frame), or null for another type. */
export function buildE01Extra(type, p) {
  const f = BUILD[type];
  return f ? f(p) : null;
}
