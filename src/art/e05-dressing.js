/**
 * LIGHTS OUT e05 "Cold Iron" set dressing (docs/expansion/e05.md §13): Hammerø's granite star fort, its rooms and its
 * harbour, built with art/castle-kit.js (Geo: merged geometry per material, grime in the vertex colours). Owned by the
 * e05 build; the assets the campaign assigns to e05 (`drawbridge_fort`, `casemate_radio`, `rampart_granite`,
 * `powder_magazine`, `folboat`) are built here and drawn by scripts/e05-art.js from the mission's gameplay data.
 *
 *  - rooms (`buildRoomHouse`): walls, windows, doors and floor (the body) and a separate roof group the script lifts
 *    while a commando is inside — the commandant's yellow-washed house, the old powder magazine, the brick radio
 *    casemate, the keeper's switch room, the hoist house, the harbour magazine; their furniture (desks, the radio
 *    benches, the stove, the hoist's winding gear);
 *  - the drawbridge span (a pivot group the script tilts), the signal mast, the officers' quarters and guardroom,
 *    the harbour's kerbs, bollards, lobster pots, the boat sheds, the folboats in the cove, caged wall lamps.
 * Plain pennant only; no insignia anywhere (character bible §0.2, §5.4).
 * @module art/e05-dressing
 */
import * as THREE from 'three';
import { Geo, CASTLE_SETS, segBox, localFrame, hipRoof, castleMaterial } from './castle-kit.js';

// ---------------------------------------------------------------- materials (castle-kit sets, Baltic palette §13)
// (key names keep castle-kit's grime rule: 'field'/'rubble'/'plaster' stone get damp bands and streaks)
// (the library's `granite` set is long thin brown courses that read as planking from the game camera: Bornholm's
// rough-squared granite is the coursed `fieldstone` set greyed, its dressed work the grey `ashlar` blocks)
Object.assign(CASTLE_SETS, {
  field_granite: ['fieldstone', 0xb4b9bd, 0x5c6166, 2.4, 1.35], // granite #5c6166, lichen-flecked
  field_granite_dk: ['fieldstone', 0x979ca0, 0x4a4f53, 2.4, 1.35],
  e05_ashlar: ['ashlar', 0xc9cdd1, 0x6c7074, 2.2, 1.25], // dressed granite blocks (the gate, the quoins of the casemates)
  e05_dressed: ['limestone_smooth', 0xb8bcc0, 0x7d8185, 2.0, 0.8], // tooled granite copings and string courses
  e05_rubble: ['rubble_stone', 0xb0b4b8, 0x63676b, 2.0, 1.3], // the battered plinths
  rubble_brick: ['brick_red', 0xc79a86, 0x6b3f2f, 1.4, 1.15], // the casemates' brick #6b3f2f
  rubble_brick_dk: ['brick_dark', 0xb3998c, 0x4a2e24, 1.4, 1.15],
  plaster_yellow: ['plaster_limewash', 0xe4cf8c, 0xd9c27a, 2.0, 0.8], // the commandant's yellow wash #d9c27a
  roof_tile: ['roof_tile_flat', 0xc07a62, 0x8a3a2a, 2.2, 1.0], // red tile #8a3a2a
  tar_roof: ['tar_paper', 0x7a7a78, 0x2a2a2a, 2.2, 0.8], // the camp's tarred roofs
  turf_top: ['turf_grass', 0xc4d29e, 0x5f7b46, 2.4, 0.8], // turf #4f6b3a (lit: the texture runs dark)
  tarp: ['tent_canvas', 0x737b5f, 0x3e4434, 3.0, 0.9], // the stores' dark olive tarpaulins (the yard's canvas, darker)
  gravel: ['gravel_grey', 0xb8b5ae, 0x77746b, 2.0, 0.9],
  floor_boards: ['deck_planks', 0x9c8a72, 0x5c4c3a, 1.6, 0.9],
  glass: ['glass_dirty', 0x5a6a72, 0x2a3236, 1.2, 0.4],
  felt: ['bitumen_felt', 0x8d8d8a, 0x3a3b3c, 1.6, 0.6],
});

/** Wall height of a room building (the gameplay walls stand to ROOM_H; the drawn roof reaches its ridge). */
export const ROOM_WALL = 4.3;

/** castle-kit's limestone masonry → Hammerø's grey granite (castle-kit builders drawn in e05's palette). */
export const GRANITE_REGRADE = { ashlar: 'e05_ashlar', dressed: 'e05_dressed', rubble: 'e05_rubble', field: 'field_granite' };
/**
 * Re-material a built castle-kit group: every mesh drawn in castle material `from` is drawn in `to` (same geometry,
 * same box-projected UVs). Only e05's own copies of the kit's builders are touched (the kit's shared materials stay).
 */
export function regrade(group, map = GRANITE_REGRADE) {
  group.traverse((o) => {
    const name = o.isMesh && o.material?.name;
    const from = name?.startsWith('castle:') ? name.slice(7) : null;
    if (from && map[from]) o.material = castleMaterial(map[from]);
  });
  return group;
}

const H2 = Math.PI / 2;
/** Emissive glass for a lit lamp (one shared material: no light, no shadow; the bloom picks it up). */
let LAMP_GLOW = null;
export function lampGlow() {
  return (LAMP_GLOW ||= new THREE.MeshStandardMaterial({ color: 0x1a1408, emissive: 0xffc46a, emissiveIntensity: 2.4, roughness: 0.5 }));
}

// ---------------------------------------------------------------- rooms
/**
 * A room building over the gameplay footprint `r` {x0, z0, x1, z1, side, at, gap} (scripts read the same numbers):
 * walls `t` thick standing inside the footprint, a doorway on `side`, windows, a floor, a hipped roof in its own group.
 * o: {wall: set, trim: set, roof: set|'flat', h: wall height, rh: roof rise, windows: n per long face, storeys,
 *     plinth: set, door: 'oak'|'iron'|null, slits: bool, seed, flatTop: set (flat roofs: turf / felt)}
 * @returns {{body: THREE.Group, roof: THREE.Group, inner: {x0, z0, x1, z1}}}
 */
export function buildRoomHouse(r, o = {}) {
  const G = new Geo(o.seed ?? `${r.x0},${r.z0}`), Rf = new Geo(`${o.seed ?? r.x0}:roof`);
  const t = o.t ?? 0.5, h = o.h ?? ROOM_WALL, wall = o.wall ?? 'rubble_brick', trim = o.trim ?? 'dressed';
  const { x0, z0, x1, z1 } = r, doorTop = o.doorTop ?? 2.3;
  // every doorway (`r.doors`: a room with several; else its one `side` / `at` / `gap`)
  const doorways = (r.doors ?? [{ side: r.side, at: r.at, gap: r.gap }]).map((d) => ({ side: d.side, a: d.at - d.gap / 2, b: d.at + d.gap / 2 }));
  const R = G.R;
  // wall runs (the doorways cut out of their sides); each run: [p, q] along the outer face, inward normal
  const runs = [];
  const seg = (side, u0, u1) => runs.push({ side, u0, u1 });
  const sides = { N: [x0, x1], S: [x0, x1], W: [z0, z1], E: [z0, z1] };
  for (const [side, [lo, hi]] of Object.entries(sides)) {
    let u = lo;
    for (const d of doorways.filter((q) => q.side === side).sort((p, q) => p.a - q.a)) { seg(side, u, d.a); u = d.b; }
    seg(side, u, hi);
  }
  const box = (side, u0, u1, y0, y1, mat, tone = 1, d0 = 0, d1 = t) => {
    // u along the side, d inward from the outer face
    if (side === 'N') G.box(mat, (u0 + u1) / 2, (y0 + y1) / 2, z0 + (d0 + d1) / 2, u1 - u0, y1 - y0, d1 - d0, 0, tone);
    else if (side === 'S') G.box(mat, (u0 + u1) / 2, (y0 + y1) / 2, z1 - (d0 + d1) / 2, u1 - u0, y1 - y0, d1 - d0, 0, tone);
    else if (side === 'W') G.box(mat, x0 + (d0 + d1) / 2, (y0 + y1) / 2, (u0 + u1) / 2, d1 - d0, y1 - y0, u1 - u0, 0, tone);
    else G.box(mat, x1 - (d0 + d1) / 2, (y0 + y1) / 2, (u0 + u1) / 2, d1 - d0, y1 - y0, u1 - u0, 0, tone);
  };
  // plinth band and wall body (cut at the doorways), eaves cornice (round the whole side: it runs on over a doorway).
  // A side with a doorway is laid in two lifts split inside the lintel (`split`): below it the runs stop at the jambs,
  // above it the runs and the masonry over each doorway (doorways' loop below) meet edge to edge in one plane, one tone
  // a side, corner on corner — so the per-vertex grime matches across every joint and no seam shows over the door
  // (review r2: a 4 mm set-back infill drew a hairline up the house's front from the lintel to the eaves)
  const sideTone = {}, split = {};
  for (const k of Object.keys(sides)) sideTone[k] = 0.96 + R() * 0.06;
  for (const d of doorways) { const y = Math.min(h, doorTop + 0.35) - 0.05; if (y < h - 0.3) split[d.side] = y; }
  for (const s of runs) {
    if (s.u1 - s.u0 < 0.05) continue;
    box(s.side, s.u0, s.u1, -0.2, 0.55, o.plinth ?? 'field_granite', 0.95, -0.05, t);
    const ys = split[s.side];
    if (ys == null) box(s.side, s.u0, s.u1, 0.55, h - 0.02, wall, sideTone[s.side]); // (under the cornice's top: no shared plane)
    else { box(s.side, s.u0, s.u1, 0.55, ys, wall, sideTone[s.side]); box(s.side, s.u0, s.u1, ys, h - 0.02, wall, sideTone[s.side]); }
  }
  for (const [side, [lo, hi]] of Object.entries(sides)) box(side, lo, hi, h - 0.22, h, trim, 1.02, -0.12, t);
  // corners: quoins up the four corners (dressed granite)
  for (const [cx, cz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
    for (let y = 0.55, k = 0; y + 0.52 < h - 0.24; y += 0.62, k++) { // (the last stone under the cornice)
      const big = k % 2 === 0, sx = big ? 0.7 : 0.45, sz = big ? 0.45 : 0.7;
      G.box(trim, cx + (cx === x0 ? sx / 2 - 0.04 : -sx / 2 + 0.04), y + 0.27, cz + (cz === z0 ? sz / 2 - 0.04 : -sz / 2 + 0.04), sx, 0.5, sz, 0, 1.0 + R() * 0.05);
    }
  }
  // the doorways: lintel and jambs, the leaf swung back (oak) or none (an iron or plank door is its own leaf)
  for (const { side, a, b } of doorways) {
    const dlen = b - a, lintelTop = Math.min(h, doorTop + 0.35);
    box(side, a - 0.1, b + 0.1, doorTop, lintelTop, trim, 1.05, -0.06, t + 0.02);
    // the masonry over the lintel, up under the cornice (without it the doorway was a slot to the eaves the camera
    // looked through into the room): the upper lift's piece between the jambs, flush with the runs either side and
    // meeting them edge to edge, its foot inside the lintel, its head inside the cornice
    if (split[side] != null) box(side, a, b, split[side], h - 0.02, wall, sideTone[side]);
    // (jambs stand 1 cm out into the opening: flush, their faces lay in the planes of the plinth's and the wall's ends)
    box(side, a - 0.12, a + 0.01, 0, doorTop, trim, 1.0, -0.06, t + 0.02);
    box(side, b - 0.01, b + 0.12, 0, doorTop, trim, 1.0, -0.06, t + 0.02);
    if (o.door === 'oak') {
      // the leaf stands open against the inner face, hinged at the doorway's `a` side; in a small room it stops short
      // of the corner (a full-width leaf ran through the end wall of the keeper's switch room)
      const lo = Math.max(a - dlen + 0.1, (side === 'N' || side === 'S' ? x0 : z0) + t + 0.03), mid = (lo + a) / 2, len = a - lo;
      if (side === 'N' || side === 'S') { const zz = side === 'N' ? z0 + t + 0.08 : z1 - t - 0.08; G.box('planks', mid, doorTop / 2, zz, len, doorTop - 0.05, 0.08, 0, 0.75); }
      else { const xx = side === 'W' ? x0 + t + 0.08 : x1 - t - 0.08; G.box('planks', xx, doorTop / 2, mid, 0.08, doorTop - 0.05, len, 0, 0.75); }
    }
  }
  // windows: dark glass panes with sills and lintels, or slits
  const storeys = o.storeys ?? 1;
  for (const s of runs) {
    const L = s.u1 - s.u0;
    if (L < 1.6 || (o.windowSides && !o.windowSides.includes(s.side))) continue;
    const n = Math.max(1, Math.floor(L / (o.slits ? 2.4 : 3.0)));
    for (let k = 0; k < n; k++) {
      const uc = s.u0 + (L * (k + 0.5)) / n;
      for (let st = 0; st < storeys; st++) {
        const yb = 1.05 + st * (h / storeys), wh = o.slits ? 1.1 : 1.35, ww = o.slits ? 0.22 : 0.95;
        if (yb + wh > h - 0.3) continue;
        box(s.side, uc - ww / 2, uc + ww / 2, yb, yb + wh, 'glass', 0.9, -0.03, 0.08);
        if (!o.slits) {
          box(s.side, uc - ww / 2 - 0.08, uc + ww / 2 + 0.08, yb - 0.12, yb, trim, 1.05, -0.12, 0.1); // sill
          box(s.side, uc - ww / 2 - 0.1, uc + ww / 2 + 0.1, yb + wh, yb + wh + 0.18, trim, 1.04, -0.06, 0.08); // lintel
          box(s.side, uc - 0.035, uc + 0.035, yb, yb + wh, 'timber', 0.6, -0.05, 0.06); // mullion
        }
      }
    }
  }
  // the floor
  const inner = { x0: x0 + t, z0: z0 + t, x1: x1 - t, z1: z1 - t };
  G.box(o.floor ?? 'floor_boards', (inner.x0 + inner.x1) / 2, 0.01, (inner.z0 + inner.z1) / 2, inner.x1 - inner.x0, 0.04, inner.z1 - inner.z0, 0, 0.9);
  // the roof (its own group: the script lifts it while a commando is inside)
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, W = x1 - x0, D = z1 - z0;
  if (o.roof === 'flat') {
    Rf.box(o.flatTop ?? 'turf_top', cx, h + 0.32, cz, W + 0.1, 0.24, D + 0.1, 0, 1);
    Rf.box(trim, cx, h + 0.12, cz, W + 0.25, 0.2, D + 0.25, 0, 1.02);
  } else {
    const long = W >= D, F = localFrame(cx, cz, long ? 0 : H2), hu = (long ? W : D) / 2, hw = (long ? D : W) / 2;
    hipRoof(Rf, F, -hu, hu, -hw, hw, h, o.rh ?? Math.min(3.6, hw * 0.95), o.roof ?? 'roof_tile', 0.4);
    // ceiling under the eaves (closes the roof seen from below the wall top)
    Rf.box('timber', cx, h - 0.04, cz, W - 2 * t + 0.02, 0.06, D - 2 * t + 0.02, 0, 0.6);
    if (o.chimney) for (const [ux, uz] of o.chimney) {
      Rf.box(wall, ux, h + (o.rh ?? 2.6) * 0.7, uz, 0.6, (o.rh ?? 2.6) * 1.1 + 0.8, 0.6, 0, 0.95);
      Rf.box(trim, ux, h + (o.rh ?? 2.6) * 1.25 + 0.45, uz, 0.75, 0.12, 0.75, 0, 1.0);
    }
  }
  const body = G.build(o.name ? `${o.name}:body` : 'e05-room', { ground: 0 });
  const roof = Rf.build(o.name ? `${o.name}:roof` : 'e05-roof', { ground: h, damp: 0, moss: 0.25 });
  return { body, roof, inner };
}

// ---------------------------------------------------------------- furniture and fittings (one Geo per room)
/** A writing desk (top at 0.76 m) with drawers; rot = facing of the man sitting at it. */
export function desk(G, x, z, rot = 0, { w = 1.5, d = 0.75 } = {}) {
  G.box('timber', x, 0.73, z, w, 0.06, d, rot + H2, 0.7);
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const k of [-1, 1]) G.box('timber', x - s * k * (w / 2 - 0.25), 0.36, z + c * k * (w / 2 - 0.25), 0.42, 0.72, d - 0.08, rot + H2, 0.62);
}
export function chair(G, x, z, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  G.box('timber', x, 0.45, z, 0.45, 0.05, 0.45, rot, 0.68);
  G.box('timber', x - c * 0.21, 0.72, z - s * 0.21, 0.05, 0.55, 0.45, rot, 0.66);
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) G.box('timber', x + a * 0.18, 0.22, z + b * 0.18, 0.04, 0.44, 0.04, 0, 0.6);
}
export function stove(G, x, z) {
  G.cyl('iron', x, 0, z, 0.32, 0.3, 0.95, 12, 0.18);
  G.cyl('iron', x, 0.95, z, 0.34, 0.3, 0.08, 12, 0.2);
  G.cyl('iron', x, 1.03, z, 0.07, 0.07, 2.6, 8, 0.15);
}
export function cabinet(G, x, z, rot = 0, h = 1.5) { G.box('paint', x, h / 2, z, 0.9, h, 0.5, rot, 0.75); }
export function shelf(G, x, z, rot = 0, w = 1.8) {
  for (const y of [0.3, 0.8, 1.3, 1.8]) G.box('timber', x, y, z, w, 0.04, 0.32, rot, 0.62);
  for (const k of [-1, 1]) G.box('timber', x + Math.cos(rot) * k * w / 2, 1.0, z + Math.sin(rot) * k * w / 2, 0.04, 2.0, 0.32, rot, 0.6);
  for (let k = 0; k < 9; k++) G.box(k % 3 ? 'canvas' : 'signal', x + Math.cos(rot) * (-w / 2 + 0.2 + k * 0.18), 0.95 + (k % 3) * 0.5, z + Math.sin(rot) * (-w / 2 + 0.2 + k * 0.18), 0.12, 0.3, 0.25, rot, 0.6 + (k % 4) * 0.08);
}
/** A receiver bench against a wall: table, two sets with dials, a headphone hook, cable trunking up the wall. */
export function radioBench(G, x, z, rot = 0, w = 2.4) {
  G.box('timber', x, 0.76, z, w, 0.06, 0.7, rot, 0.68);
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const k of [-1, 1]) G.box('timber', x + c * k * (w / 2 - 0.1), 0.38, z + s * k * (w / 2 - 0.1), 0.08, 0.76, 0.6, rot, 0.6);
  for (const k of [-0.5, 0.5]) {
    const ux = x + c * k * w * 0.55 - s * 0.1, uz = z + s * k * w * 0.55 + c * 0.1;
    G.box('paint', ux, 1.02, uz, 0.6, 0.45, 0.38, rot, 0.55);
    for (const d of [-0.18, 0, 0.18]) G.cyl('dressed', ux + c * d - s * 0.2, 1.0, uz + s * d + c * 0.2, 0.045, 0.045, 0.03, 8, 1.1);
  }
  G.box('rubber', x - s * 0.33, 1.6, z + c * 0.33, w * 0.9, 0.08, 0.06, rot, 0.4); // trunking
}
/** The hoist's winding gear over its cage: a gallows frame, the drum, the cage guides. */
export function hoistGear(G, x, z, h = 3.6) {
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) G.box('iron', x + a * 1.0, h / 2, z + b * 1.0, 0.1, h, 0.1, 0, 0.25);
  G.box('iron', x, h, z, 2.2, 0.14, 0.14, 0, 0.3);
  G.box('iron', x, h, z, 0.14, 0.14, 2.2, 0, 0.3);
  G.cyl('iron', x - 0.5, h + 0.1, z, 0.32, 0.32, 0.5, 12, 0.35);
  G.box('signal', x + 0.9, 1.1, z + 1.12, 0.12, 0.5, 0.12, 0, 0.8); // the bell-pull handle
}

// ---------------------------------------------------------------- the drawbridge (drawbridge_fort)
/**
 * The span (`rect` {x, z, w, d, rot}: w along the bridge): heavy oak deck on iron-strapped beams, a kerb each side,
 * chains up to the gatehouse. Returned as a pivot group at the inner (hinge) end; the script tilts `pivot.rotation.x`.
 * @returns {{group: THREE.Group, pivot: THREE.Group, chains: THREE.Object3D[]}}
 */
export function buildDrawbridgeSpan(rect, { hingeAtMinZ = true, chainTo = 4.6 } = {}) {
  const L = rect.w, W = rect.d, G = new Geo('drawbridge_fort');
  // local frame: the hinge at the origin, the span along +z (out over the moat), width along x
  for (let k = 0; k < 4; k++) G.box('timber', -W / 2 + 0.35 + k * ((W - 0.7) / 3), -0.18, L / 2, 0.24, 0.3, L, 0, 0.55); // stringers
  for (let z = 0.15, k = 0; z < L - 0.1; z += 0.32, k++) G.box('planks', 0, 0.0, z, W, 0.08, 0.3, 0, 0.82 + (k % 5) * 0.04);
  for (const s of [-1, 1]) {
    G.box('timber', s * (W / 2 - 0.12), 0.18, L / 2, 0.22, 0.28, L, 0, 0.6); // kerb
    for (let z = 0.6; z < L; z += 1.4) G.box('iron', s * (W / 2 - 0.12), 0.18, z, 0.26, 0.32, 0.08, 0, 0.25); // straps
    G.box('iron', s * (W / 2 - 0.12), 0.38, L - 0.25, 0.3, 0.12, 0.3, 0, 0.3); // chain eye
  }
  const deck = G.build('drawbridge:span', { ground: -1, damp: 0, moss: 0.1 });
  const pivot = new THREE.Group();
  pivot.name = 'drawbridge:pivot';
  pivot.add(deck);
  const group = new THREE.Group();
  group.name = 'drawbridge_fort';
  group.add(pivot);
  // chains: thin dark bars from the span's eyes to the gatehouse; re-aimed by the script as the span lifts
  const chainMat = castleMaterial('iron');
  const chains = [];
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1), chainMat);
    c.userData.side = s;
    c.castShadow = true;
    group.add(c);
    chains.push(c);
  }
  const zMin = rect.z - L / 2;
  group.position.set(rect.x, 0.04, hingeAtMinZ ? zMin : rect.z + L / 2);
  if (!hingeAtMinZ) group.rotation.y = Math.PI;
  group.userData = { L, W, chainTo };
  return { group, pivot, chains };
}
/** Tilt the span to `a` radians (0 = down) and re-aim its chains at the gatehouse face (`chainTo` m up, at the hinge). */
export function poseDrawbridge(span, a) {
  const { group, pivot, chains } = span, { L, W, chainTo } = group.userData;
  pivot.rotation.x = -a;
  const tip = new THREE.Vector3(0, Math.sin(a) * (L - 0.25) + 0.4, Math.cos(a) * (L - 0.25));
  for (const c of chains) {
    const s = c.userData.side, A = new THREE.Vector3(s * (W / 2 - 0.12), chainTo, -0.3), B = new THREE.Vector3(s * (W / 2 - 0.12), tip.y, tip.z);
    const len = A.distanceTo(B);
    c.position.copy(A).add(B).multiplyScalar(0.5);
    c.scale.set(1, 1, len);
    c.lookAt(group.localToWorld(B.clone()));
  }
  group.updateMatrixWorld(true);
}

// ---------------------------------------------------------------- the signal station and the mast (NE bastion)
/**
 * A guyed lattice mast (h m) with a plain pennant, and its shelter `hut` {x, z, w, d} (w along x): a boarded lean-to open
 * to the west under a tarred pent roof falling to the east, on a plank floor — the stove at `stove` [x, z] against its
 * back with a stovepipe through the roof, a table with the receiver and a lamp along its north wall, a stool. The guys
 * run to iron eyes on the walk at `guys` (offsets from the mast's foot), clear of the shelter and inside the breastwork.
 */
export function buildSignalStation(x, z, y0, { h = 16, hut = null, stove: stovePt = null, guys = [[1.3, -2.25], [1.1, 3.4], [-3.2, 0]] } = {}) {
  const G = new Geo(`mast:${x},${z}`), R = seededRandom(`e05:mast:${x},${z}`), rnd = (a, b) => a + (b - a) * R();
  // three-legged lattice, tapering
  const legs = [0, 2.094, 4.189];
  for (let k = 0; k < 12; k++) {
    const y = y0 + (k * h) / 12, y1 = y0 + ((k + 1) * h) / 12, r = 0.45 - (k / 12) * 0.3, r1 = 0.45 - ((k + 1) / 12) * 0.3;
    for (const a of legs) {
      const p = [x + Math.cos(a) * r, y, z + Math.sin(a) * r], q = [x + Math.cos(a) * r1, y1, z + Math.sin(a) * r1];
      G.box('iron', (p[0] + q[0]) / 2, (y + y1) / 2, (p[2] + q[2]) / 2, 0.06, y1 - y + 0.02, 0.06, 0, 0.3);
    }
    G.cyl('iron', x, y + 0.02, z, r, r, 0.04, 3, 0.3, { caps: false });
  }
  G.cyl('iron', x, y0 + h, z, 0.03, 0.03, 2.2, 6, 0.3); // the whip on top
  for (const [ax, az] of [[1, 0.2], [-0.6, 0.9], [-0.5, -0.9]]) G.box('rubber', x + ax * 0.15, y0 + h * 0.66, z + az * 0.15, 0.04, 0.04, 0.04, 0, 0.3);
  // the guys' anchor eyes on the walk (a plate, a ring)
  for (const [dx, dz] of guys) { G.box('iron', x + dx, y0 + 0.02, z + dz, 0.28, 0.04, 0.28, Math.atan2(dz, dx), 0.3); G.cyl('iron', x + dx, y0 + 0.04, z + dz, 0.05, 0.05, 0.16, 6, 0.25); }
  if (hut) {
    const { x: hx, z: hz, w = 2.0, d = 2.0 } = hut, W2 = w / 2, D2 = d / 2, xw = hx - W2, xe = hx + W2, zn = hz - D2, zs = hz + D2;
    const yF = y0 + 0.07, yW = y0 + 2.42, yE = y0 + 2.02; // the floor's top, the roof's underside at the west / east edge
    const under = (px) => yW + ((px - xw) / w) * (yE - yW);
    // the plank floor (1 cm off the turf), boards across, uneven
    for (let u = zn + 0.02; u < zs - 0.04;) {
      const bw = Math.min(rnd(0.14, 0.22), zs - 0.02 - u);
      G.box('planks', hx, y0 + 0.04, u + bw / 2, w - 0.04, 0.05, bw - 0.008, 0, rnd(0.5, 0.68));
      u += bw;
    }
    // corner posts, up under the roof
    for (const [px, pz] of [[xw + 0.06, zn + 0.06], [xe - 0.06, zn + 0.06], [xe - 0.06, zs - 0.06], [xw + 0.06, zs - 0.06]]) {
      const top = under(px) - 0.01;
      G.box('timber', px, (yF + top) / 2, pz, 0.1, top - yF, 0.1, 0, 0.5);
    }
    // the boarded walls: north, east, south (vertical boards of uneven width and tone, gaps between; the west stands open)
    const boards = (along, fixed, lo, hi, axis) => {
      for (let u = lo; u < hi - 0.04;) {
        const bw = Math.min(rnd(0.15, 0.24), hi - u), c = u + bw / 2, px = axis === 'x' ? c : fixed, top = under(px) - 0.025 - rnd(0, 0.04);
        const tone = R() < 0.12 ? rnd(0.72, 0.85) : rnd(0.4, 0.58);
        if (axis === 'x') G.box('boards', c, (yF + top) / 2, fixed, bw - 0.014, top - yF, 0.03, 0, tone);
        else G.box('boards', fixed, (yF + top) / 2, c, 0.03, top - yF, bw - 0.014, 0, tone);
        u += bw;
      }
    };
    boards('x', zn + 0.035, xw + 0.12, xe - 0.12, 'x');
    boards('x', zs - 0.035, xw + 0.12, xe - 0.12, 'x');
    boards('z', xe - 0.035, zn + 0.12, zs - 0.12, 'z');
    // rails behind the boards at knee and shoulder height (inside)
    for (const y of [y0 + 0.5, y0 + 1.6]) {
      G.box('timber', hx, y, zn + 0.08, w - 0.24, 0.07, 0.04, 0, 0.45);
      G.box('timber', hx, y, zs - 0.08, w - 0.24, 0.07, 0.04, 0, 0.45);
      G.box('timber', xe - 0.08, y, hz, 0.04, 0.07, d - 0.24, 0, 0.45);
    }
    // the pent roof: tarred felt on boards, 15 cm over all round, falling to the east; battens down the fall
    const ov = 0.15, th = 0.07;
    const P = (px, pz, dy = 0) => [px, under(px) + dy, pz];
    G.hexa('tar_roof', [P(xw - ov, zn - ov), P(xw - ov, zs + ov), P(xe + ov, zs + ov), P(xe + ov, zn - ov),
      P(xw - ov, zn - ov, th), P(xw - ov, zs + ov, th), P(xe + ov, zs + ov, th), P(xe + ov, zn - ov, th)], rnd(0.85, 1.0), { bottom: true });
    for (let u = zn; u <= zs + 0.01; u += d / 3) strand(G, 'timber', P(xw - ov + 0.01, u, th + 0.02), P(xe + ov - 0.01, u, th + 0.02), 0.02, 0.42);
    // the front's fascia, 2 cm past the roof's ends (its end faces were in the roof's end planes)
    strand(G, 'timber', P(xw - ov, zn - ov - 0.02, th / 2), P(xw - ov, zs + ov + 0.02, th / 2), 0.04, 0.5);
    // inside: the stove at the back with its stovepipe through the roof, the table with the receiver along the north
    // wall, a stool, a hurricane lamp hung under the roof
    const [sx, sz] = stovePt ?? [xe - 0.55, hz + 0.15];
    G.cyl('iron', sx, yF, sz, 0.22, 0.2, 0.6, 10, 0.32);
    G.cyl('iron', sx, yF + 0.6, sz, 0.24, 0.24, 0.04, 10, 0.28);
    G.cyl('iron', sx + 0.08, yF + 0.64, sz - 0.05, 0.055, 0.055, under(sx + 0.08) - yF - 0.64 + 0.75, 8, 0.25);
    G.cyl('iron', sx + 0.08, under(sx + 0.08) + 0.78, sz - 0.05, 0.11, 0.04, 0.1, 8, 0.25);
    const tz = zn + 0.34;
    G.box('timber', hx - 0.1, y0 + 0.78, tz, 1.1, 0.04, 0.48, 0, 0.6);
    for (const [lx, lz] of [[-0.6, -0.2], [0.4, -0.2], [-0.6, 0.2], [0.4, 0.2]]) G.box('timber', hx - 0.1 + lx, (yF + y0 + 0.76) / 2, tz + lz, 0.05, y0 + 0.76 - yF, 0.05, 0, 0.5);
    G.box('paint', hx - 0.25, y0 + 0.95, tz - 0.04, 0.46, 0.3, 0.3, 0, 0.32); // the receiver
    G.box('signal', hx - 0.35, y0 + 0.98, tz + 0.115, 0.06, 0.06, 0.01, 0, 0.9); // its dial lamp
    G.box('rubber', hx + 0.18, y0 + 0.84, tz + 0.05, 0.2, 0.08, 0.16, 0, 0.3); // the headphones on the table
    G.cyl('timber', hx - 0.15, yF, tz + 0.62, 0.15, 0.14, 0.45, 8, 0.55); // the stool
    G.cyl('iron', hx, under(hx) - 0.35, hz, 0.07, 0.07, 0.2, 8, 0.4); // the lamp
  }
  const g = G.build('signal_station', { ground: y0, damp: 0.15, moss: 0.15 });
  // guys: three thin wires to their eyes
  const wireMat = castleMaterial('iron');
  for (const [dx, dz] of guys) {
    const A = new THREE.Vector3(x, y0 + h * 0.66, z), B = new THREE.Vector3(x + dx, y0 + 0.12, z + dz);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, A.distanceTo(B)), wireMat);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.lookAt(B);
    g.add(m);
  }
  // the pennant (plain: a grey-blue swallow-tail, no emblem)
  const pen = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.4, 6, 1), new THREE.MeshStandardMaterial({ color: 0x51606a, roughness: 0.8, side: THREE.DoubleSide }));
  pen.position.set(x + 0.75, y0 + h + 1.6, z);
  pen.name = 'e05:pennant';
  g.add(pen);
  return g;
}

// ---------------------------------------------------------------- solid buildings
/** A plain two-storey brick block with a hipped roof (the officers' quarters, the guardroom). */
export function buildBlock(s, { wall = 'rubble_brick', roof = 'slate', h = 6, rh = 2.4, storeys = 2, door = 'S', seed } = {}) {
  const r = { x0: s.x - s.w / 2, z0: s.z - s.d / 2, x1: s.x + s.w / 2, z1: s.z + s.d / 2, side: door, at: door === 'S' || door === 'N' ? s.x : s.z, gap: 1.2 };
  const { body, roof: rf } = buildRoomHouse(r, { wall, roof, h, rh, storeys, door: 'oak', seed: seed ?? s.id, name: s.id, chimney: [[s.x - s.w * 0.25, s.z]] });
  const g = new THREE.Group(); g.name = `e05:${s.id}`; g.add(body, rf);
  return g;
}

// ---------------------------------------------------------------- the harbour and the shore
export function lobsterPots(G, x, z, n = 4) {
  for (let k = 0; k < n; k++) {
    const px = x + (k % 2) * 0.75, pz = z + Math.floor(k / 2) * 0.62, py = k >= 2 && k % 3 === 0 ? 0.42 : 0;
    G.cyl('timber', px, py, pz, 0.3, 0.3, 0.38, 8, 0.65, { caps: false });
    G.cyl('canvas', px, py + 0.38, pz, 0.3, 0.12, 0.08, 8, 0.6);
  }
}
/** A timber boat shed with a pent roof, open to the water side (`rot` = the open end's heading). */
export function buildBoatShed(s) {
  const G = new Geo(s.id), F = localFrame(s.x, s.z, s.rot ?? 0), W2 = s.w / 2, D2 = s.d / 2, H = s.h ?? 3.2;
  const P = (u, w, y) => { const [x, z] = F.at(u, w); return [x, y, z]; };
  // the mono-pitch roof falls from the back (H - 0.1) to the open front (H - 0.6); everything under it stops short of
  // its underside (a wall poking through the felt, the old posts did, reads at once)
  const under = (u) => H - 0.1 - 0.5 * (u + W2 + 0.3) / (s.w + 0.6) - 0.03;
  // the long walls: tarred boards, their tops following the roof's fall, butting against the back wall
  for (const w of [-D2, D2 - 0.12]) {
    const u0 = -W2 + 0.12, u1 = W2 - 0.4;
    G.hexa('boards', [P(u0, w, 0), P(u0, w + 0.12, 0), P(u1, w + 0.12, 0), P(u1, w, 0),
      P(u0, w, under(u0)), P(u0, w + 0.12, under(u0)), P(u1, w + 0.12, under(u1)), P(u1, w, under(u1))], 0.62);
    // vertical battens over the board joints, uneven (some replaced, paler)
    for (let u = u0 + 0.35; u < u1 - 0.1; u += 0.42 + ((u * 13) % 0.1)) {
      const o = w < 0 ? -0.025 : 0.12;
      segBox(G, 'timber', F, u - 0.03, u + 0.03, w + o, w + o + 0.025, 0.08, under(u) - 0.06, 0.5 + ((u * 7) % 0.3));
    }
  }
  segBox(G, 'boards', F, -W2, -W2 + 0.12, -D2, D2, 0, under(-W2 + 0.12), 0.6);
  for (const w of [-D2 + 0.06, D2 - 0.06]) segBox(G, 'timber', F, W2 - 0.3, W2, w - 0.1, w + 0.1, 0, under(W2), 0.55);
  G.hexa('tar_roof', [P(-W2 - 0.3, -D2 - 0.3, H - 0.1), P(-W2 - 0.3, D2 + 0.3, H - 0.1), P(W2 + 0.3, D2 + 0.3, H - 0.6), P(W2 + 0.3, -D2 - 0.3, H - 0.6),
    P(-W2 - 0.3, -D2 - 0.3, H), P(-W2 - 0.3, D2 + 0.3, H), P(W2 + 0.3, D2 + 0.3, H - 0.5), P(W2 + 0.3, -D2 - 0.3, H - 0.5)], 0.7, { bottom: true });
  // a rowing boat on its cradle inside
  const [bx, bz] = F.at(0, 0);
  G.box('timber', bx, 0.25, bz, 0.4, 0.5, 0.4, F.rot, 0.55);
  G.box('planks', bx, 0.62, bz, s.w * 0.75, 0.42, 1.25, F.rot, 0.7, 0.2);
  return G.build(`e05:${s.id}`, { ground: 0 });
}

/** The camp huts' finishes (castle sets) — no two huts of the camp alike. */
const HUT_STYLES = {
  // the garrison's own hut: creosoted weatherboard, white-painted frames, tarred felt on battens
  tarred: { wall: 'hut_siding', wallTone: [0.92, 1.04], trim: 'hut_trim', roof: 'tar_roof', roofTone: [1.15, 1.3], battens: 'timber', canopy: true },
  // field-grey-green paint on weatherboard (faded, peeling), white frames, galvanised corrugated iron
  painted: { wall: 'hut_paint', wallTone: [0.86, 0.98], trim: 'hut_trim', roof: 'corr_galv', roofTone: [0.85, 1.05], corrugated: true, canopy: true },
  // silvered board-and-batten, unpainted frames, old corrugated iron gone to rust (a few newer galvanised sheets), a
  // brick chimney, a lean-to woodshed at the east end
  grey: { wall: 'hut_grey', wallTone: [0.9, 1.02], trim: 'timber', roof: 'corr_rusty', roofTone: [0.85, 1.05], corrugated: true, rusty: true, boardBatten: true, annex: true, chimney: true },
};
Object.assign(CASTLE_SETS, {
  hut_siding: ['timber_siding', 0xf2e4cf, 0x4f3e2e, 2.6, 1.0], // creosoted weatherboard (the texture runs dark)
  hut_paint: ['weatherboard_paint', 0x95a387, 0x7f8b72, 2.2, 0.9], // faded field-grey-green paint
  hut_trim: ['weatherboard_paint', 0xeeeae0, 0xdcd8ce, 1.0, 0.5], // white-painted window frames and fascias
  hut_grey: ['timber_grey', 0xe2ded6, 0x8a857c, 2.4, 1.0], // silvered vertical boards
  corr_galv: ['corrugated_galv', 0xc6cacd, 0x868a8e, 1.6, 1.0], // galvanised corrugated iron
  corr_rusty: ['corrugated_galv', 0xb08a6c, 0x6a4a36, 1.6, 1.0], // the same, rust-streaked
});

/**
 * A timber barrack hut of the garrison's camp on the glacis (structure `s` {id, x, z, w, d, h, rot}; `door`: the side
 * the door is on, 'W' 'E' 'N' 'S' in the hut's own frame, w along `rot`; `style`: its finish, HUT_STYLES): on a sill
 * over low brick piers, small-paned windows (some boarded up), a plank door up two steps, corner boards, a gabled roof
 * whose ridge sags between the gables and whose eaves droop unevenly, a kick board along the foot of the walls.
 *  - 'tarred': creosoted weatherboard, a canopy over the door on brackets, two stovepipes, fire buckets by the door;
 *  - 'painted': faded grey-green weatherboard with bare patches, corrugated iron with rusty sheets and a ridge
 *    ventilator, a water butt at the seaward end;
 *  - 'grey': board-and-batten, a brick chimney, rusty corrugated iron with a few newer galvanised sheets, and a
 *    lower lean-to woodshed across the east end (open to the south, logs stacked inside).
 * Built to its footprint (the gameplay box): the eaves and the canopy overhang above head height, the fire buckets and
 * the butt stand within 0.3 m of the walls where nobody walks; no two faces share a plane (trims 1.5–6 cm proud).
 * (round-1 review: the camp's huts were "near-black featureless identical boxes")
 */
export function buildTimberHut(s, { door = 'W', style = 'tarred' } = {}) {
  const ST = HUT_STYLES[style] || HUT_STYLES.tarred;
  const G = new Geo(s.id), R = seededRandom(`e05:hut:${s.id}`), rnd = (a, b) => a + (b - a) * R();
  const F = localFrame(s.x, s.z, s.rot ?? 0), W2 = s.w / 2, D2 = s.d / 2;
  const P = (u, w, y) => { const [x, z] = F.at(u, w); return [x, y, z]; };
  const fy = 0.32, Hw = Math.max(2.4, (s.h ?? 4) - 1.45), rise = Math.min(1.45, D2 * 0.55), T = 0.12;
  const annex = ST.annex ? Math.min(2.2, s.w * 0.2) : 0, uA = W2 - annex; // the main body: u in [-W2, uA]
  const wallMat = ST.wall, wt = () => rnd(ST.wallTone[0], ST.wallTone[1]);
  // under the floor: brick piers and the dark crawl space between them (a recessed box), the sill beam above
  segBox(G, 'rubber', F, -W2 + 0.15, uA - 0.15, -D2 + 0.15, D2 - 0.15, 0, fy - 0.08, 0.35);
  for (const w of [-D2 + 0.12, D2 - 0.12]) for (let k = 0, n = Math.max(2, Math.round((uA + W2) / 2.4)); k <= n; k++) {
    const u = -W2 + 0.18 + ((uA + W2 - 0.36) * k) / n;
    // (piers 1 cm inside the sill's faces and under its bottom: their faces were in the sill's planes)
    segBox(G, 'rubble_brick', F, u - 0.17, u + 0.17, w - 0.14, w + 0.14, 0, fy - 0.09, 0.85 + R() * 0.15);
  }
  segBox(G, 'timber', F, -W2 - 0.03, uA + 0.03, -D2 - 0.03, D2 + 0.03, fy - 0.08, fy + 0.06, 0.62);
  // walls: the long walls run the full length, the end walls fit between them (no shared faces)
  const walls = [['N', -W2, uA, -D2, -D2 + T], ['S', -W2, uA, D2 - T, D2], ['W', -W2, -W2 + T, -D2 + T, D2 - T], ['E', uA - T, uA, -D2 + T, D2 - T]];
  for (const [, u0, u1, w0, w1] of walls) segBox(G, wallMat, F, u0, u1, w0, w1, fy + 0.06, Hw, wt());
  // a strip `out0`..`out1` m proud of a wall face, along it from a to b (u on N/S, w on W/E), y0..y1 high
  const onFace = (side, a, b, y0, y1, out0, out1, mat, tone) => {
    if (side === 'N') segBox(G, mat, F, a, b, -D2 - out1, -D2 - out0, y0, y1, tone);
    else if (side === 'S') segBox(G, mat, F, a, b, D2 + out0, D2 + out1, y0, y1, tone);
    else if (side === 'W') segBox(G, mat, F, -W2 - out1, -W2 - out0, a, b, y0, y1, tone);
    else segBox(G, mat, F, uA + out0, uA + out1, a, b, y0, y1, tone);
  };
  const onFaceC = (side, c, half, y0, y1, out0, out1, mat, tone) => onFace(side, c - half, c + half, y0, y1, out0, out1, mat, tone);
  // openings per side: windows (u or w centre) and the door
  const L = uA + W2, longN = Math.max(1, Math.floor(L / 2.3));
  const opens = { N: [], S: [], W: [], E: [] };
  for (const side of ['N', 'S']) for (let k = 0; k < longN; k++) opens[side].push({ c: -W2 + (L * (k + 0.5)) / longN, hw: 0.5, y0: fy + 0.95, y1: fy + 1.95, kind: 'win' });
  if (door === 'N' || door === 'S') {
    // the door replaces the window nearest the middle
    const arr = opens[door], mid = (uA - W2) / 2, i = arr.reduce((b, q, k) => (Math.abs(q.c - mid) < Math.abs(arr[b].c - mid) ? k : b), 0);
    arr[i] = { c: arr[i].c, hw: 0.5, y0: fy + 0.06, y1: fy + 2.05, kind: 'door' };
  } else opens[door].push({ c: 0, hw: 0.5, y0: fy + 0.06, y1: fy + 2.05, kind: 'door' });
  if (D2 > 2 && door !== 'W') opens.W.push({ c: 0, hw: 0.35, y0: fy + 1.05, y1: fy + 1.85, kind: 'win' });
  if (D2 > 2 && door !== 'E' && !annex) opens.E.push({ c: 0, hw: 0.35, y0: fy + 1.05, y1: fy + 1.85, kind: 'win' });
  const span = (side) => (side === 'N' || side === 'S' ? [-W2 + 0.1, uA - 0.1] : [-D2 + 0.1, D2 - 0.1]);
  const clear = (side, a, b, y0, y1) => opens[side].every((o) => b < o.c - o.hw - 0.1 || a > o.c + o.hw + 0.1 || y1 < o.y0 - 0.1 || y0 > o.y1 + 0.12);
  // the kick board along the foot of every wall (darker, splashed), cut at the door
  for (const side of ['N', 'S', 'W', 'E']) {
    const [lo, hi] = span(side), d = opens[side].find((o) => o.kind === 'door');
    const runs = d ? [[lo - 0.1, d.c - d.hw - 0.09], [d.c + d.hw + 0.09, hi + 0.1]] : [[lo - 0.1, hi + 0.1]];
    for (const [a, b] of runs) if (b - a > 0.1) onFace(side, a, b, fy + 0.07, fy + 0.27, 0, 0.022, ST.trim === 'hut_trim' ? 'timber' : wallMat, 0.55);
  }
  if (ST.boardBatten) {
    // board-and-batten: battens over the board joints every half metre, broken round the openings
    for (const side of ['N', 'S', 'W', 'E']) {
      const [lo, hi] = span(side);
      for (let a = lo + 0.2; a < hi - 0.05; a += 0.5) {
        const o = opens[side].find((q) => a > q.c - q.hw - 0.1 && a < q.c + q.hw + 0.1), y0 = fy + 0.28, y1 = Hw - 0.02;
        const parts = o ? [[y0, o.y0 - 0.1], [o.y1 + 0.12, y1]] : [[y0, y1]];
        for (const [b0, b1] of parts) if (b1 - b0 > 0.08) onFaceC(side, a, 0.028, b0, b1, 0, 0.02, wallMat, rnd(0.82, 1.0));
      }
    }
  } else {
    // a few boards replaced (paler, newer) or tarred over (darker); on the painted hut, the paint gone in patches
    for (let k = 0; k < 7; k++) {
      const side = ['N', 'S', 'W', 'E'][Math.floor(R() * 4)], [lo, hi] = span(side), len = rnd(0.8, 2.4), a = rnd(lo, Math.max(lo, hi - len)), y = rnd(fy + 0.35, Hw - 0.35);
      if (!clear(side, a, a + len, y, y + 0.2)) continue;
      const bare = style === 'painted' && k % 2 === 0;
      onFace(side, a, a + len, y, y + (bare ? rnd(0.18, 0.5) : 0.2), 0, 0.015, bare ? 'boards' : wallMat, bare ? rnd(0.62, 0.75) : R() < 0.5 ? rnd(1.15, 1.3) : rnd(0.6, 0.72));
    }
  }
  // the openings: windows (dark panes, glazing bars and a frame, a sill and a head; some boarded up), the door
  for (const side of ['N', 'S', 'W', 'E']) for (const o of opens[side]) {
    if (o.kind === 'win') {
      const boarded = R() < 0.2;
      onFaceC(side, o.c, o.hw, o.y0, o.y1, -0.01, 0.01, boarded ? 'boards' : 'glass', boarded ? 0.55 : 0.85);
      if (!boarded) {
        onFaceC(side, o.c, 0.022, o.y0, o.y1, 0, 0.03, ST.trim, 1.0);
        for (const f of [0.36, 0.68]) onFaceC(side, o.c, o.hw, o.y0 + (o.y1 - o.y0) * f - 0.018, o.y0 + (o.y1 - o.y0) * f + 0.018, 0, 0.03, ST.trim, 1.0);
      } else for (const f of [0.25, 0.75]) onFaceC(side, o.c, o.hw + 0.06, o.y0 + (o.y1 - o.y0) * f - 0.06, o.y0 + (o.y1 - o.y0) * f + 0.06, 0.01, 0.035, 'boards', rnd(0.5, 0.65));
      for (const sg of [-1, 1]) onFaceC(side, o.c + sg * (o.hw + 0.04), 0.04, o.y0 - 0.02, o.y1 + 0.02, 0, 0.04, ST.trim, 0.95);
      onFaceC(side, o.c, o.hw + 0.12, o.y0 - 0.08, o.y0 - 0.02, 0, 0.07, 'timber', 0.7); // the sill
      onFaceC(side, o.c, o.hw + 0.1, o.y1 + 0.02, o.y1 + 0.1, 0, 0.05, ST.trim, 0.9); // the head
    } else {
      onFaceC(side, o.c, o.hw, o.y0, o.y1, -0.01, 0.025, 'planks', style === 'painted' ? 0.5 : 0.66);
      for (const k of [0.3, 1.0, 1.7]) onFaceC(side, o.c, o.hw - 0.05, o.y0 + k, o.y0 + k + 0.12, 0.025, 0.045, 'planks', 0.52); // ledges
      for (const sg of [-1, 1]) onFaceC(side, o.c + sg * (o.hw + 0.04), 0.04, o.y0, o.y1 + 0.06, 0, 0.05, ST.trim, 0.95);
      onFaceC(side, o.c, o.hw + 0.08, o.y1 + 0.06, o.y1 + 0.16, 0, 0.06, ST.trim, 0.9);
      onFaceC(side, o.c + o.hw - 0.16, 0.03, o.y0 + 1.0, o.y0 + 1.06, 0.045, 0.07, 'iron', 0.5); // the latch
      // two steps up to the sill (a plank tread on a block), within 0.3 m of the wall
      onFaceC(side, o.c, o.hw + 0.16, 0.0, 0.15, 0.03, 0.3, 'timber', 0.5);
      onFaceC(side, o.c, o.hw + 0.12, 0.15, fy - 0.02, 0.03, 0.17, 'timber', 0.56);
      if (ST.canopy && (side === 'W' || side === 'E')) {
        // a pent canopy over the door on two brackets (on the gable end, clear of the eaves)
        const c0 = o.y1 + 0.24, c1 = c0 + 0.16;
        const q = (dw, out, y) => (side === 'W' ? P(-W2 - out, o.c + dw, y) : P(uA + out, o.c + dw, y));
        const hw = o.hw + 0.35, oo = 0.85, mat = ST.roof === 'corr_galv' ? 'corr_galv' : 'tar_roof';
        const ring = [q(-hw, 0.02, c1), q(hw, 0.02, c1), q(hw, oo, c0), q(-hw, oo, c0)];
        hexaUp(G, mat, ring, 0.06, 0.9);
        for (const sg of [-1, 1]) {
          strand(G, 'timber', q(sg * (hw - 0.12), 0.03, c0 - 0.55), q(sg * (hw - 0.12), oo - 0.1, c0 - 0.005), 0.03, 0.55); // the brackets
          onFaceC(side, o.c + sg * (hw - 0.12), 0.035, c0 - 0.62, c1 + 0.04, 0, 0.03, 'timber', 0.55);
        }
      }
    }
  }
  // corner boards (proud of both faces; not where the lean-to stands against the end wall: there a board would share
  // the long wall's inner plane inside the corner)
  for (const [cu, cw] of annex ? [[-W2, -D2], [-W2, D2]] : [[-W2, -D2], [uA, -D2], [uA, D2], [-W2, D2]]) {
    const u0 = cu < 0 ? cu - 0.035 : cu - 0.12, w0 = cw < 0 ? cw - 0.035 : cw - 0.12;
    segBox(G, ST.trim === 'hut_trim' ? 'hut_trim' : 'timber', F, u0, u0 + 0.155, w0, w0 + 0.155, fy - 0.02, Hw + 0.02, ST.trim === 'hut_trim' ? 0.85 : 0.6);
  }
  // ---- the roof: the underside's height at (u, w) — the ridge sags between the gables, the eaves droop, unevenly
  const og = 0.28, ov = 0.35, U0 = -W2 - og, U1 = uA + og, Uc = (U0 + U1) / 2, Uh = (U1 - U0) / 2;
  const sagR = rnd(0.06, 0.11), twist = rnd(-0.015, 0.015), ridge = Hw + 0.05 + rise;
  const droops = Array.from({ length: 10 }, () => rnd(0, 0.04));
  const droopAt = (u) => { const t = Math.max(0, Math.min(8.999, ((u - U0) / (U1 - U0)) * 9)), i = Math.floor(t), f = t - i; return droops[i] * (1 - f) + droops[i + 1] * f; };
  const under = (u, w) => {
    const aw = Math.abs(w), k = 1 - ((u - Uc) / Uh) ** 2;
    return Hw + 0.05 + rise * (1 - aw / D2) - sagR * k * Math.max(0, 1 - 0.75 * aw / D2)
      - (aw > D2 ? droopAt(u) * ((aw - D2) / ov) ** 2 : 0) + twist * ((u - Uc) / Uh) * (w / D2) * (aw < D2 ? 1 : 1);
  };
  const us = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  const WS = (sg) => [0, D2 * 0.5, D2, D2 + ov * 0.5, D2 + ov].map((w) => sg * w);
  /** A slab on the roof surface: u stations `uu`, w stations `ww` (ridge → eave), `th` thick, `lift` over the underside. */
  const slab = (mat, uu, ww, th, tone, lift = 0, { ridgeFace = false } = {}) => {
    const Q = (i, j, top) => P(uu[i], ww[j], under(uu[i], ww[j]) + lift + (top ? th : 0));
    const up = [0, 1, 0], dn = [0, -1, 0];
    for (let i = 0; i + 1 < uu.length; i++) for (let j = 0; j + 1 < ww.length; j++) {
      sheet(G, mat, Q(i, j, 1), Q(i + 1, j, 1), Q(i + 1, j + 1, 1), Q(i, j + 1, 1), up, tone);
      sheet(G, mat, Q(i, j, 0), Q(i + 1, j, 0), Q(i + 1, j + 1, 0), Q(i, j + 1, 0), dn, tone);
    }
    const sgW = Math.sign(ww[ww.length - 1]) || 1, nI = uu.length - 1, nJ = ww.length - 1;
    const tv = [F.t[0], 0, F.t[1]], nv = [F.n[0] * sgW, 0, F.n[1] * sgW];
    for (let i = 0; i < nI; i++) {
      sheet(G, mat, Q(i, nJ, 0), Q(i + 1, nJ, 0), Q(i + 1, nJ, 1), Q(i, nJ, 1), nv, tone); // the eave edge
      if (ridgeFace) sheet(G, mat, Q(i, 0, 0), Q(i + 1, 0, 0), Q(i + 1, 0, 1), Q(i, 0, 1), nv.map((v) => -v), tone);
    }
    for (let j = 0; j < nJ; j++) {
      sheet(G, mat, Q(0, j, 0), Q(0, j + 1, 0), Q(0, j + 1, 1), Q(0, j, 1), tv.map((v) => -v), tone); // the verge edges
      sheet(G, mat, Q(nI, j, 0), Q(nI, j + 1, 0), Q(nI, j + 1, 1), Q(nI, j, 1), tv, tone);
    }
  };
  // a strand down the roof at u through the stations `ws`, its axis `lift` over the underside
  const alongW = (mat, u, ws, lift, r, tone) => {
    for (let i = 0; i + 1 < ws.length; i++) strand(G, mat, P(u, ws[i], under(u, ws[i]) + lift), P(u, ws[i + 1], under(u, ws[i + 1]) + lift), r, tone);
  };
  // the gables: boards up to just inside the slab (a pentagon: the wall head, the eave line, the apex), both faces
  for (const [ue, sg] of [[-W2, -1], [uA, 1]]) {
    for (const [uu, out, tone] of [[ue, sg, 0.92], [ue - sg * T, -sg, 0.4]]) {
      const yE = (w) => under(uu, w) + 0.03, o = [out * F.t[0], 0, out * F.t[1]], dD = out > 0 === sg > 0 ? 0 : T;
      const A = P(uu, -D2 + dD, Hw), B = P(uu, D2 - dD, Hw), C = P(uu, D2 - dD, yE(D2 - dD)), E = P(uu, -D2 + dD, yE(-D2 + dD)), Dp = P(uu, 0, yE(0) - 0.01);
      sheet(G, uu === ue ? wallMat : 'boards', A, B, C, E, o, uu === ue ? tone * wt() : tone);
      sheet(G, uu === ue ? wallMat : 'boards', E, C, Dp, Dp, o, uu === ue ? tone * wt() : tone);
    }
    // a louvred vent under the apex (a dark hole in a frame, slats across)
    const vy = under(ue, 0) - 0.55, side = sg < 0 ? 'W' : 'E';
    onFaceC(side, 0, 0.2, vy - 0.15, vy + 0.15, 0, 0.012, 'rubber', 0.3);
    for (const f of [-0.08, 0, 0.08]) onFaceC(side, 0, 0.19, vy + f - 0.012, vy + f + 0.012, 0.012, 0.03, ST.trim, 0.8);
    for (const sg2 of [-1, 1]) onFaceC(side, sg2 * 0.22, 0.025, vy - 0.17, vy + 0.17, 0, 0.035, ST.trim, 0.9);
  }
  const RT = () => rnd(ST.roofTone[0], ST.roofTone[1]);
  const NU = 10;
  if (ST.corrugated) {
    // corrugated iron: sheets ~0.76 m wide from the ridge to the eave, alternate laps 1.5 cm higher, a few rusty
    const n = Math.max(4, Math.round((U1 - U0) / 0.76));
    for (const sg of [-1, 1]) for (let k = 0; k < n; k++) {
      // (the painted hut's galvanised sheets with a few gone to rust; the grey hut's rusty with a few replaced)
      const a = U0 + ((U1 - U0) * k) / n, b = U0 + ((U1 - U0) * (k + 1)) / n, odd = R() < 0.18;
      const mat = odd !== !!ST.rusty ? 'corr_rusty' : 'corr_galv';
      slab(mat, us(a, b, 2), WS(sg), 0.035 + (k % 2) * 0.015, mat === 'corr_rusty' ? rnd(0.8, 1.0) : RT());
    }
    // the ridge capping (a bent strip over both slopes' heads), the ridge ventilator over the middle
    for (const sg of [-1, 1]) slab(ST.rusty ? 'corr_rusty' : 'corr_galv', us(U0, U1, NU), [0, sg * 0.2], 0.012, 0.95, 0.055, { ridgeFace: false });
    if (!ST.chimney) {
      const vu = Uc + rnd(-0.6, 0.6), vy = under(vu, 0) + 0.06;
      const [vx, vz] = F.at(vu, 0);
      G.box('corr_galv', vx, vy + 0.1, vz, 0.7, 0.52, 0.34, F.rot, 0.8);
      G.box('rubber', vx, vy + 0.2, vz, 0.62, 0.22, 0.36, F.rot, 0.25);
      G.box('corr_galv', vx, vy + 0.42, vz, 0.86, 0.06, 0.5, F.rot, 0.9);
    }
  } else {
    // tarred felt in one slab per slope, battens down the slope every ~0.9 m, patches of paler, older felt, and moss
    // creeping up from the north slope's eave
    for (const sg of [-1, 1]) slab(ST.roof, us(U0, U1, NU), WS(sg), 0.09, RT());
    for (const sg of [-1, 1]) {
      for (let u = U0 + 0.3; u < U1 - 0.2; u += rnd(0.82, 0.98)) alongW(ST.battens, u, [0.02, D2 * 0.5, D2, D2 + ov * 0.5, D2 + ov - 0.02].map((w) => sg * w), 0.09 + 0.02, 0.022, 0.62);
      for (let k = 0; k < 3; k++) {
        const pu = rnd(U0 + 0.8, U1 - 0.8), hu = rnd(0.3, 0.65), w0 = rnd(0.35, D2 * 0.55), w1 = Math.min(D2, w0 + rnd(0.5, 1.1));
        slab(ST.roof, us(pu - hu, pu + hu, 2), [sg * w0, sg * w1], 0.008, rnd(1.35, 1.6), 0.09 + 0.006);
      }
      if (sg < 0) for (let k = 0; k < 4; k++) {
        const pu = rnd(U0 + 0.5, U1 - 0.5), hu = rnd(0.2, 0.5);
        slab('moss', us(pu - hu, pu + hu, 2), [-(D2 - rnd(0.1, 0.4)), -D2, -(D2 + ov * 0.5), -(D2 + ov - 0.04)], 0.006, rnd(0.5, 0.7), 0.09 + 0.004);
      }
    }
    // the ridge board, following the sag
    for (const sg of [-1, 1]) slab(ST.battens, us(U0 - 0.01, U1 + 0.01, NU), [0, sg * 0.11], 0.06, 0.5, 0.09);
  }
  // the barge boards along both gables' verges (following the eave droop)
  for (const ue of [U0 - 0.02, U1 + 0.02]) for (const sg of [-1, 1]) alongW(ST.trim === 'hut_trim' ? 'hut_trim' : 'timber', ue, [0, D2 * 0.5, D2, D2 + ov * 0.5, D2 + ov].map((w) => sg * w), 0.03, 0.035, 0.8);
  // stovepipes through the south slope (two on the tarred hut), the brick chimney through the grey hut's ridge
  if (ST.chimney) {
    const cu = -W2 * 0.3, [cx, cz] = F.at(cu, 0), y0 = under(cu, 0) - 0.4;
    G.box('rubble_brick', cx, (y0 + ridge + 0.75) / 2, cz, 0.5, ridge + 0.75 - y0, 0.5, F.rot, 0.9);
    G.box('e05_dressed', cx, ridge + 0.79, cz, 0.6, 0.08, 0.6, F.rot, 0.9);
    G.cyl('iron', cx, ridge + 0.83, cz, 0.1, 0.09, 0.32, 8, 0.32);
  } else for (const f of style === 'tarred' ? [-0.35, 0.42] : [0.25]) {
    const pu = W2 * f, pw = D2 * 0.35, [px, pz] = F.at(pu, pw), y = under(pu, pw);
    G.cyl('iron', px, y - 0.2, pz, 0.09, 0.09, 1.25 + rise * 0.3, 8, 0.3);
    G.cyl('iron', px, y + 1.05 + rise * 0.3, pz, 0.16, 0.05, 0.14, 8, 0.28);
    G.cyl('iron', px, y + 0.06, pz, 0.16, 0.1, 0.06, 8, 0.25); // the flashing collar
  }
  // ---- the lean-to woodshed across the east end (grey): posts, a boarded back and north side, a pent felt roof
  if (annex) {
    const h0 = Hw - 0.35, h1 = 2.05, ue = W2 - 0.06, uT = W2 + 0.2, roofU = (u) => h0 + ((h1 - 0.03 - h0) * (u - uA)) / (uT - uA);
    segBox(G, 'e05_rubble', F, uA + 0.02, W2, -D2, D2, 0, 0.12, 0.7); // the plinth
    // a board or a beam from `below` m under the lean-to's roof (null: from the plinth) to 1 cm under it
    const wallTo = (u0, u1, w0, w1, mat, tone, below = null) => {
      const yb = (u) => (below == null ? 0.12 : roofU(u) - below), yt = (u) => roofU(u) - 0.01;
      hexaUp(G, mat, [P(u0, w0, yb(u0)), P(u0, w1, yb(u0)), P(u1, w1, yb(u1)), P(u1, w0, yb(u1))], 0, tone,
        [P(u0, w0, yt(u0)), P(u0, w1, yt(u0)), P(u1, w1, yt(u1)), P(u1, w0, yt(u1))]);
    };
    wallTo(ue - 0.1, ue, -D2 + 0.06, D2 - 0.06, 'hut_grey', wt()); // the back, to the sea
    wallTo(uA + 0.02, ue - 0.1, -D2 + 0.06, -D2 + 0.14, 'hut_grey', wt()); // the north side
    // the corner post, 1.5 cm proud of the back's end and its seaward face (flush, their faces shared one plane)
    segBox(G, 'timber', F, ue - 0.14, ue + 0.015, D2 - 0.18, D2 - 0.045, 0.12, roofU(ue) - 0.01, 0.55);
    wallTo(uA + 0.02, ue - 0.14, D2 - 0.17, D2 - 0.07, 'timber', 0.5, 0.15); // the head rail over the open south side
    const ring = [P(uA + 0.01, -D2 - 0.2, h0), P(uA + 0.01, D2 + 0.2, h0), P(uT, D2 + 0.2, h1 - 0.03), P(uT, -D2 - 0.2, h1 - 0.03)];
    // (the lean-to roofed like the hut: rusty corrugated iron, its sheets' laps every 0.76 m)
    hexaUp(G, ST.rusty ? 'corr_rusty' : 'tar_roof', ring, 0.04, ST.rusty ? 0.82 : 1.2);
    for (let w = -D2 - 0.2 + 0.76; w < D2 + 0.1; w += 0.76) strand(G, ST.rusty ? 'corr_rusty' : 'timber', P(uA + 0.05, w, h0 + 0.05), P(uT - 0.03, w, h1 + 0.02 - 0.03), 0.012, 0.7);
    // firewood stacked inside, the sawn ends showing on the open south side
    const rows = 9, perRow = Math.floor((ue - 0.14 - uA - 0.1) / 0.15);
    for (let r = 0; r < rows; r++) for (let k = 0; k < perRow; k++) {
      const u = uA + 0.18 + k * 0.15 + (r % 2) * 0.07, y = 0.12 + 0.075 + r * 0.135, rr = rnd(0.055, 0.072);
      if (u > ue - 0.22 || y + rr > roofU(u) - 0.15) continue;
      const w0 = D2 - 1.25 + rnd(-0.06, 0.06), w1 = D2 - 0.3 + rnd(-0.05, 0.05);
      tube(G, 'bark', P(u, w0, y), P(u, w1, y), rr, rr, 6, rnd(0.6, 0.85), { capB: false });
      tube(G, 'endgrain', P(u, w1, y), P(u, w1 + 0.012, y), rr * 0.97, rr * 0.97, 6, rnd(0.75, 1.0), { capA: false });
    }
  }
  // ---- by the walls: fire buckets on a board beside the tarred hut's door; a water butt at the painted hut's seaward end
  if (style === 'tarred') {
    const side = door, d = opens[side].find((o) => o.kind === 'door'), c = d ? d.c + d.hw + 0.85 : 0;
    onFaceC(side, c, 0.5, fy + 1.55, fy + 1.66, 0.02, 0.06, 'timber', 0.55);
    for (let k = 0; k < 4; k++) {
      const a = c - 0.36 + k * 0.24, q = side === 'W' ? P(-W2 - 0.17, a, fy + 1.12) : side === 'E' ? P(uA + 0.17, a, fy + 1.12) : side === 'N' ? P(a, -D2 - 0.17, fy + 1.12) : P(a, D2 + 0.17, fy + 1.12);
      G.cyl('signal', q[0], q[1], q[2], 0.075, 0.11, 0.3, 10, 0.85);
      strand(G, 'iron', [q[0], q[1] + 0.3, q[2]], [q[0], fy + 1.55, q[2]], 0.006, 0.4);
    }
  }
  if (style === 'painted') {
    const [bx, bz] = F.at(uA + 0.32, D2 - 0.75);
    G.cyl('timber', bx, 0, bz, 0.28, 0.3, 0.92, 12, 0.6);
    for (const y of [0.15, 0.75]) G.cyl('iron', bx, y, bz, 0.295, 0.305, 0.05, 12, 0.35, { caps: false });
    G.cyl('rubber', bx, 0.921, bz, 0.25, 0.25, 0.005, 12, 0.3);
    // its downpipe from the gutter
    const [gx, gz] = F.at(uA + 0.06, D2 + 0.06);
    strand(G, 'iron', [gx, under(uA, D2) - 0.05, gz], [gx, 1.05, gz], 0.035, 0.35);
  }
  return G.build(`e05:${s.id}`, { ground: 0, damp: 0.3, moss: 0.1 });
}

/** The handler's dog kennel by the camp (structure `s`): a boarded box under a pitched felt roof, its opening (dark) on
 * the `rot` side facing the post, a water bowl. Inside its 1.4 × 1.2 m footprint. */
export function buildKennel(s) {
  const G = new Geo(s.id), F = localFrame(s.x, s.z, s.rot ?? 0), W2 = s.w / 2 - 0.05, D2 = s.d / 2 - 0.05, H = 0.78;
  const P = (u, w, y) => { const [x, z] = F.at(u, w); return [x, y, z]; };
  segBox(G, 'timber', F, -W2 - 0.02, W2 + 0.02, -D2 - 0.02, D2 + 0.02, 0, 0.08, 0.45); // the floor frame on the ground
  segBox(G, 'boards', F, -W2, W2, -D2, D2, 0.08, H, 0.6);
  segBox(G, 'rubber', F, -0.2, 0.2, -D2 - 0.012, -D2 + 0.02, 0.1, 0.5, 0.2); // the opening, dark
  segBox(G, 'timber', F, -0.24, 0.24, -D2 - 0.03, -D2 - 0.012, 0.5, 0.56, 0.5);
  const rise = 0.36, ov = 0.08;
  for (const sg of [-1, 1]) {
    const q = [P(-W2 - ov, 0, H + rise), P(W2 + ov, 0, H + rise), P(W2 + ov, sg * (D2 + ov), H - 0.03), P(-W2 - ov, sg * (D2 + ov), H - 0.03)];
    const ring = sg < 0 ? [q[0], q[3], q[2], q[1]] : q;
    G.hexa('tar_roof', [...ring, ...ring.map(([x, y, z]) => [x, y + 0.05, z])], 0.7, { bottom: true });
  }
  for (const sg of [-1, 1]) sheet(G, 'boards', P(sg * W2, -D2, H), P(sg * W2, D2, H), P(sg * W2, 0, H + rise - 0.02), P(sg * W2, 0, H + rise - 0.02), [sg * F.t[0], 0, sg * F.t[1]], 0.5);
  const [bx, bz] = F.at(0.42, -D2 + 0.12);
  G.cyl('iron', bx, 0.0, bz, 0.12, 0.1, 0.07, 10, 0.4, { caps: false });
  return G.build(`e05:${s.id}`, { ground: 0, damp: 0.2, moss: 0.1 });
}

/**
 * The team's two folding canoes drawn up on the cove's shingle (design §13): each a 4.6 m two-man folboat lofted from
 * stations along its length: a rubberised flat bottom, hard chines, rubberised-canvas sides drawn tight over the
 * frames (the skin sags a little between them, so the ribs read in the light), a cambered canvas deck sheered up to the
 * ends; an oval cockpit with a timber coaming round a dark well; a two-bladed paddle (blades feathered) on each, the
 * second boat's on the stones between the two. `rot`: the boats' heading.
 */
export function buildFolboats(x, z, rot = 0) {
  const G = new Geo('folboats');
  const L = 4.6, Bm = 0.36, NS = 32, CK = 0.95;               // length, half-beam, stations, cockpit half-length
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // a quad wound to face `out` (a world direction it should face)
  const oq = (mat, a, b, c, d, out, tone) => {
    const n = crs(sub(b, a), sub(c, a));
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] >= 0) G.quad(mat, a, b, c, d, tone); else G.quad(mat, d, c, b, a, tone);
  };
  const boat = (bx, bz, paddleOnDeck) => {
    const F = localFrame(bx, bz, rot);
    const P = (u, w, y) => { const [px, pz] = F.at(u, w); return [px, y, pz]; };
    const D = (u, w, y) => { const [px, pz] = [F.t[0] * u + F.n[0] * w, F.t[1] * u + F.n[1] * w]; return [px, y, pz]; };
    const st = [];
    for (let i = 0; i <= NS; i++) {
      const u = -L / 2 + (L * i) / NS, e = Math.abs((2 * u) / L);
      const frame = i % 4 === 0, B = Math.max(0.012, Bm * Math.pow(Math.max(0, 1 - Math.pow(e, 2.2)), 0.62)) * (frame ? 1 : 0.965);
      const sh = 0.07 * e * e, ck = Math.abs(u) < CK ? 0.25 * Math.sqrt(Math.max(0, 1 - (u / CK) ** 2)) : 0;
      st.push({ u, B, sh, ck, bot: 0.02 + 0.03 * e * e });
    }
    // section points of station s, side g (+1 / -1): bottom edge, chine, gunwale; the deck crown on the keel line
    const sec = (s, g) => ({
      bot: P(s.u, g * 0.62 * s.B, s.bot), chine: P(s.u, g * s.B, s.bot + 0.12), gun: P(s.u, g * 0.93 * s.B, 0.3 + s.sh),
    });
    const crown = (s) => P(s.u, 0, 0.36 + s.sh);
    for (let i = 0; i < NS; i++) {
      const a = st[i], b = st[i + 1];
      for (const g of [-1, 1]) {
        const A = sec(a, g), Bq = sec(b, g), side = D(0, g, 0);
        oq('rubber', A.bot, Bq.bot, Bq.chine, A.chine, [side[0], -0.6, side[2]], 0.45);              // the rubberised lower strake
        oq('canvas', A.chine, Bq.chine, Bq.gun, A.gun, [side[0], 0.15, side[2]], 0.5 + 0.06 * (i % 4 === 0 ? 1 : 0));
        // the deck: gunwale to crown, or to the coaming where the cockpit is open
        const hwA = a.ck, hwB = b.ck;
        if (hwA > 0 || hwB > 0) {
          const yA = 0.3 + a.sh + 0.06 * (1 - hwA / (0.93 * a.B)), yB = 0.3 + b.sh + 0.06 * (1 - hwB / (0.93 * b.B));
          const cA = P(a.u, g * hwA, yA), cB = P(b.u, g * hwB, yB);
          oq('canvas', A.gun, Bq.gun, cB, cA, [0, 1, 0], 0.42);
          // the coaming: timber band round the opening (outside and top), the well's dark wall inside
          const tA = [cA[0], cA[1] + 0.045, cA[2]], tB = [cB[0], cB[1] + 0.045, cB[2]], inward = D(0, -g, 0);
          oq('timber', cA, cB, tB, tA, [side[0], 0.1, side[2]], 0.62);
          const iA = P(a.u, g * Math.max(0, hwA - 0.02), yA + 0.045), iB = P(b.u, g * Math.max(0, hwB - 0.02), yB + 0.045);
          oq('timber', tA, tB, iB, iA, [0, 1, 0], 0.68);
          const fA = P(a.u, g * Math.max(0, hwA - 0.02), 0.07), fB = P(b.u, g * Math.max(0, hwB - 0.02), 0.07);
          oq('rubber', iA, iB, fB, fA, [inward[0], 0, inward[2]], 0.22);
        } else oq('canvas', A.gun, Bq.gun, crown(b), crown(a), [0, 1, 0], 0.42);
      }
      // the bottom (on the stones) and the cockpit's floor
      oq('rubber', sec(a, -1).bot, sec(b, -1).bot, sec(b, 1).bot, sec(a, 1).bot, [0, -1, 0], 0.4);
      if (a.ck > 0 || b.ck > 0) oq('rubber', P(a.u, -Math.max(0, a.ck - 0.02), 0.07), P(b.u, -Math.max(0, b.ck - 0.02), 0.07), P(b.u, Math.max(0, b.ck - 0.02), 0.07), P(a.u, Math.max(0, a.ck - 0.02), 0.07), [0, 1, 0], 0.18);
    }
    // the two-bladed paddle: a shaft, the blades feathered 90° to each other
    const paddle = (a0, a1, y) => {
      tube(G, 'timber', a0, a1, 0.017, 0.017, 6, 0.62);
      const dx = a1[0] - a0[0], dz = a1[2] - a0[2], l = Math.hypot(dx, dz) || 1, tx = dx / l, tz = dz / l;
      const blade = (c, flat) => {
        const r = Math.atan2(tz, tx);
        if (flat) G.box('paint', c[0], y, c[2], 0.46, 0.012, 0.15, r, 0.55);
        else G.box('paint', c[0], y + 0.07, c[2], 0.46, 0.15, 0.012, r, 0.55);
      };
      blade([a0[0] - tx * 0.23, y, a0[2] - tz * 0.23], true);
      blade([a1[0] + tx * 0.23, y, a1[2] + tz * 0.23], false);
    };
    if (paddleOnDeck) paddle(P(-1.5, 0.04, 0.42), P(0.75, -0.05, 0.39), 0.4);
    else paddle(P(-1.2, -0.6, 0.045), P(1.1, -0.54, 0.045), 0.03);   // on the shingle between the two boats (not in the surf)
  };
  boat(x, z, true);
  boat(x + 0.2 - Math.sin(rot) * 1.15, z + Math.cos(rot) * 1.15, false);
  return G.build('folboat', { ground: 0, damp: 0, moss: 0 });
}
/** A caged wall lamp at (x, y, z) on a wall facing `rot` (outward normal); its glass glows. */
export function wallLamp(G, x, y, z, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  G.box('iron', x - c * 0.12, y + 0.25, z - s * 0.12, 0.05, 0.05, 0.3, rot, 0.25);
  G.box('iron', x, y, z, 0.24, 0.32, 0.24, rot, 0.25);
}
/** The glowing glass of the lamps (one mesh for all, emissive). */
export function lampGlass(points) {
  const geo = new THREE.BoxGeometry(0.18, 0.22, 0.18), mat = lampGlow();
  const m = new THREE.InstancedMesh(geo, mat, points.length);
  const M = new THREE.Matrix4();
  points.forEach(([x, y, z], k) => { M.makeTranslation(x, y, z); m.setMatrixAt(k, M); });
  m.name = 'e05:lamp-glass';
  m.castShadow = false;
  return m;
}

// ---------------------------------------------------------------- the radio casemate's roof (casemate_radio)
/**
 * What stands on the casemate's tarred roof (drawn into its roof group, so it lifts with the roof): a low brick
 * parapet with a granite coping, the receivers' ventilator cowls, a stovepipe, two hatches, and the feeder cable from
 * the roof's NE corner up the rampart's inner face to the mast on the NE bastion (`cable`: [[x, y, z], …]).
 * r: the room footprint {x0, z0, x1, z1}; h: the wall height (the roof deck stands at h + 0.44).
 */
export function casemateRoof(r, h, { cable = null } = {}) {
  const G = new Geo('casemate_radio:roof'), y = h + 0.44, t = 0.3, ph = 0.45;
  const { x0, z0, x1, z1 } = r, cx = (x0 + x1) / 2, W = x1 - x0, D = z1 - z0;
  // the parapet ring (four runs) and its coping
  for (const [x, z, w, d] of [[cx, z0 + t / 2, W, t], [cx, z1 - t / 2, W, t], [x0 + t / 2, (z0 + z1) / 2, t, D - 2 * t], [x1 - t / 2, (z0 + z1) / 2, t, D - 2 * t]]) {
    G.box('rubble_brick', x, y + ph / 2, z, w, ph, d, 0, 0.95);
    G.box('e05_dressed', x, y + ph + 0.05, z, w + 0.06, 0.1, d + 0.06, 0, 1.02);
  }
  // ventilator cowls over the receiver rooms, a stovepipe over the duty room, two hatches
  for (const z of [z0 + D * 0.22, z0 + D * 0.5, z0 + D * 0.78]) {
    G.cyl('iron', x0 + W * 0.66, y, z, 0.2, 0.2, 0.95, 10, 0.32);
    G.cyl('iron', x0 + W * 0.66, y + 0.95, z, 0.32, 0.12, 0.22, 10, 0.3);
  }
  G.cyl('iron', x0 + W * 0.3, y, z0 + D * 0.5, 0.09, 0.09, 1.6, 8, 0.2);
  G.cyl('iron', x0 + W * 0.3, y + 1.6, z0 + D * 0.5, 0.16, 0.16, 0.1, 8, 0.22);
  for (const z of [z0 + D * 0.12, z0 + D * 0.88]) G.box('planks', x0 + W * 0.35, y + 0.08, z, 1.0, 0.16, 0.9, 0, 0.7);
  // standing water and patches on the felt (darker squares)
  for (const [u, v, s] of [[0.2, 0.3, 1.6], [0.55, 0.7, 2.2], [0.8, 0.15, 1.2]]) G.box('felt', x0 + W * u, y + 0.005, z0 + D * v, s, 0.01, s * 0.7, 0.3, 0.6);
  // the feeder cable: a dark run along the deck to the NE corner, then wherever `cable` goes
  if (cable?.length > 1) for (let k = 0; k + 1 < cable.length; k++) {
    const [ax, ay, az] = cable[k], [bx, by, bz] = cable[k + 1];
    const L = Math.hypot(bx - ax, by - ay, bz - az);
    if (L < 0.01) continue;
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, L), castleMaterial('rubber'));
    g.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    g.lookAt(bx, by, bz);
    G._extra = (G._extra || []).concat(g);
  }
  const g = G.build('casemate_radio:roof', { ground: y, damp: 0, moss: 0.15 });
  for (const e of G._extra || []) g.add(e);
  return g;
}

// ---------------------------------------------------------------- yard and bastion dressing
/** Stores under a lashed tarpaulin with ammunition boxes and two drums beside it (rot: the stack's long axis). */
export function yardStores(G, x, z, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot), at = (u, w) => [x + c * u - s * w, z + s * u + c * w];
  // the stack: boxes under canvas, the cover sagging over them, two lashings
  G.box('canvas', x, 0.62, z, 2.6, 1.24, 1.4, rot, 0.72);
  G.box('canvas', x, 1.27, z, 2.3, 0.08, 1.15, rot, 0.68, 0.18);
  for (const u of [-0.7, 0.7]) { const [lx, lz] = at(u, 0); G.box('rubber', lx, 0.67, lz, 0.05, 1.33, 1.46, rot, 0.5); } // (over the cover's top)
  // ammunition boxes (field grey, a couple stacked), two fuel drums
  for (const [u, w, yy, r2] of [[1.85, -0.3, 0, 0.1], [1.85, 0.35, 0, -0.05], [1.8, 0.0, 0.34, 0.3]]) {
    const [bx, bz] = at(u, w); G.box('paint', bx, yy + 0.17, bz, 0.72, 0.34, 0.38, rot + r2, 0.62);
  }
  for (const [u, w] of [[-1.8, -0.25], [-1.85, 0.42]]) { const [dx, dz] = at(u, w); G.cyl('paint', dx, 0, dz, 0.29, 0.29, 0.88, 12, 0.5); G.cyl('iron', dx, 0.88, dz, 0.3, 0.29, 0.03, 12, 0.4); }
}
/** Deterministic 0..1 stream from a string (mulberry32 over a string hash): the stacks' crates and folds. */
export function seededRandom(seed) {
  let a = [...String(seed)].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 2654435761) >>> 0, 0x9e3779b9);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Quad a-b-c-d wound so that its face looks along `out` (cloth sheets: no winding bookkeeping at the call site). */
function sheet(G, mat, a, b, c, d, out, tone) {
  if (dot3(cross3(sub3(b, a), sub3(c, a)), out) >= 0) G.quad(mat, a, b, c, d, tone);
  else G.quad(mat, a, d, c, b, tone);
}
/** A square-section strand (rope, lashing) of half-width r from a to b ([x, y, z]). */
function strand(G, mat, a, b, r, tone) {
  const L = Math.hypot(...sub3(b, a));
  if (L < 1e-4) return;
  const t = sub3(b, a).map((v) => v / L);
  let p1 = cross3(t, [0, 1, 0]);
  if (Math.hypot(...p1) < 1e-3) p1 = cross3(t, [1, 0, 0]);
  const n1 = Math.hypot(...p1); p1 = p1.map((v) => v / n1);
  const p2 = cross3(t, p1); // p1 × p2 = t: the rings run counter-clockwise seen from b (Geo.hexa's order)
  const ring = (o) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [0, 1, 2].map((k) => o[k] + (p1[k] * i + p2[k] * j) * r));
  G.hexa(mat, [...ring(a), ...ring(b)], tone, { bottom: true });
}

/**
 * A hexahedron from a bottom ring (four corners, either winding) and either a top ring or a lift `h` straight up:
 * wound the way Geo.hexa wants (counter-clockwise from above), so a call site never tracks the winding.
 */
function hexaUp(G, mat, bot, h, tone, top = null) {
  const t = top || bot.map(([x, y, z]) => [x, y + h, z]);
  const a2 = bot.reduce((acc, p, i) => { const q = bot[(i + 1) % 4]; return acc + p[0] * q[2] - q[0] * p[2]; }, 0);
  if (a2 > 0) G.hexa(mat, [bot[3], bot[2], bot[1], bot[0], t[3], t[2], t[1], t[0]], tone, { bottom: true });
  else G.hexa(mat, [...bot, ...t], tone, { bottom: true });
}

/**
 * A tall stack of stores under a tarpaulin (the e05 `stores_tall` sight blockers: structure `s` {id, x, z, w, d, h,
 * rot}): columns of crates and ammunition boxes piled unevenly on a pallet, each column its own height (all near the
 * blocker's `h`, which is what hides a man behind it), a dark tarpaulin thrown over the top that sags between the
 * columns and hangs down every side to a ragged, pleated hem (shorter at the ends), two lashings over it pegged at the
 * foot. Everything lies inside the gameplay footprint (w along `rot`, d across), the lashings' pegs included, so a man
 * walking round the stack never walks through any of it. Deterministic from the structure's id.
 */
export function tallStores(G, s) {
  const R = seededRandom(`e05:stores:${s.id}`), rnd = (a, b) => a + (b - a) * R();
  const rot = s.rot ?? 0, c = Math.cos(rot), sn = Math.sin(rot);
  const W2 = s.w / 2, D2 = s.d / 2, H = s.h;
  const at = (u, v, y) => [s.x + c * u - sn * v, y, s.z + sn * u + c * v]; // local (u along w, v across) → world
  const box = (mat, u, v, y, sx, sy, sz, r2, tone, taper = 0) => { const [x, , z] = at(u, v, 0); G.box(mat, x, y, z, sx, sy, sz, rot + r2, tone, taper); };
  // the pallet under it all (dark, wet timber), its runners showing at the ends
  const PH = 0.13, M = 0.07; // pallet height; the crates' inset from the footprint's edge
  box('timber', 0, 0, PH / 2, s.w - 0.1, PH, s.d - 0.08, 0, 0.42);
  // columns along u: 2-4 of them, gaps of 6-9 cm, each its own height
  const n = Math.max(2, Math.min(4, Math.round(s.w / 0.85)));
  const span = s.w - 2 * M, gaps = Array.from({ length: n - 1 }, () => rnd(0.06, 0.09));
  const free = span - gaps.reduce((a, b) => a + b, 0);
  const share = Array.from({ length: n }, () => rnd(0.8, 1.2)), tot = share.reduce((a, b) => a + b, 0);
  const cols = [];
  let u = -W2 + M;
  for (let k = 0; k < n; k++) {
    const cw = (free * share[k]) / tot;
    cols.push({ u0: u, u1: u + cw, top: PH });
    u += cw + (gaps[k] ?? 0);
  }
  // crates in each column: 2-4 tiers (ammunition boxes: more, smaller), each a little smaller and shifted on the one below
  for (const [k, col] of cols.entries()) {
    const target = H * rnd(0.92, 0.99) - 0.03, ammo = k === (n > 2 ? 1 : 0) && R() < 0.6;
    let cu0 = col.u0, cu1 = col.u1, cv0 = -D2 + M + rnd(0, 0.04), cv1 = D2 - M - rnd(0, 0.04), y = PH;
    for (let tier = 0; tier < (ammo ? 8 : 4); tier++) {
      const left = target - y;
      if (left < 0.08) break;
      // (the last tier fills the column to its height: no sliver of a box on top)
      let ch = ammo ? rnd(0.3, 0.38) : Math.max(0.42, (left / Math.max(1, 3 - tier)) * rnd(0.85, 1.15));
      if (ch > left || left - ch < (ammo ? 0.22 : 0.3)) ch = left;
      const cu = (cu0 + cu1) / 2, cv = (cv0 + cv1) / 2, cw = cu1 - cu0, cd = cv1 - cv0;
      const r2 = rnd(-0.015, 0.015), tone = ammo ? rnd(0.72, 0.9) : rnd(0.66, 0.98);
      box(ammo ? 'paint' : 'boards', cu, cv, y + ch / 2, cw, ch, cd, r2, tone);
      if (!ammo) for (const f of [0.22, 0.78]) box('timber', cu, cv, y + ch * f, cw + 0.025, 0.06, cd + 0.025, r2, tone * 0.62); // battens
      else box('iron', cu, cv, y + ch * 0.55, cw + 0.02, 0.025, cd * 0.35, r2, 0.4); // the boxes' carrying straps
      y += ch;
      // the next tier: inset a little on each side (it rests on this one; ammunition boxes stack nearly flush)
      const di = () => (ammo ? rnd(0.0, 0.03) : rnd(0.02, 0.1));
      cu0 += di(); cu1 -= di(); cv0 += ammo ? rnd(0, 0.02) : rnd(0.0, 0.07); cv1 -= ammo ? rnd(0, 0.02) : rnd(0.0, 0.07);
      if (cu1 - cu0 < 0.35) break;
    }
    col.top = y;
  }
  // the tarpaulin: a grid over the top that follows the columns (held up by the taller neighbour within a cell),
  // sagging between them; side drapes to a ragged hem
  const tone = rnd(0.82, 1.0), WT = W2 - 0.02, DT = D2 - 0.02;
  const nu = Math.max(4, Math.ceil(s.w / 0.22)), nv = 4, du = (2 * WT) / nu, dv = (2 * DT) / nv;
  const topAt = (uu) => Math.max(PH, ...cols.filter((q) => q.u1 > uu - du - 0.03 && q.u0 < uu + du + 0.03).map((q) => q.top));
  const top = [];
  for (let i = 0; i <= nu; i++) {
    const uu = -WT + i * du, base = topAt(uu), row = [];
    for (let j = 0; j <= nv; j++) {
      const vv = -DT + j * dv, edge = j === 0 || j === nv;
      // (a rounded shoulder at the long edges, still clear of the crates' top edges 5 cm in; a little sag mid-span)
      row.push(at(uu, vv, base + (edge ? 0.012 : 0.035 + 0.02 * R() - (j === nv / 2 ? 0.012 : 0))));
    }
    top.push(row);
  }
  const up = [0, 1, 0];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) sheet(G, 'tarp', top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1], up, tone * rnd(0.92, 1.04));
  const outV = (sgn) => [-sn * sgn, 0, c * sgn], outU = (sgn) => [c * sgn, 0, sn * sgn];
  // long sides: hem 32-62 % of the height (a random walk: the cloth's weight pulls it down in places), pleats outward
  for (const sgn of [-1, 1]) {
    const j = sgn < 0 ? 0 : nv, hemFrac = [];
    let f = rnd(0.35, 0.6);
    for (let i = 0; i <= nu; i++) { f = Math.min(0.62, Math.max(0.32, f + rnd(-0.07, 0.07))); hemFrac.push(f); }
    const hem = top.map((row, i) => {
      // (folds where the cloth bunches: irregular, some flat stretches, some deep — never inward, into the crates)
      const [x, y, z] = row[j], o = outV(sgn), pleat = R() < 0.45 ? rnd(0.012, 0.03) : rnd(0, 0.006);
      return [x + o[0] * pleat, Math.max(PH + 0.1, H * hemFrac[i]) + rnd(-0.02, 0.02), z + o[2] * pleat];
    });
    for (let i = 0; i < nu; i++) sheet(G, 'tarp', top[i][j], top[i + 1][j], hem[i + 1], hem[i], outV(sgn), tone * rnd(0.78, 0.9));
  }
  // the ends: shorter drapes (hem 55-80 % up)
  for (const sgn of [-1, 1]) {
    const i = sgn < 0 ? 0 : nu, o = outU(sgn);
    const hem = top[i].map(([x, , z]) => { const pleat = R() < 0.5 ? rnd(0.01, 0.025) : rnd(0, 0.006); return [x + o[0] * pleat, H * rnd(0.55, 0.8), z + o[2] * pleat]; });
    for (let j = 0; j < nv; j++) sheet(G, 'tarp', top[i][j], top[i][j + 1], hem[j + 1], hem[j], o, tone * rnd(0.72, 0.84));
  }
  // on top: what the storemen left there (a coil of rope, a jerrycan lying flat, a loose plank), each on the tarpaulin
  // over the column under it, well inside the footprint
  // (the highest tarpaulin vertex over a patch u0..u1 × v0..v1: whatever lies there rests on it)
  const onTop = (u0, u1, v0, v1) => {
    let y = 0;
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const uu = -WT + i * du, vv = -DT + j * dv;
      if (uu >= u0 - du && uu <= u1 + du && vv >= v0 - dv && vv <= v1 + dv) y = Math.max(y, top[i][j][1]);
    }
    return y;
  };
  {
    const ru = rnd(-W2 * 0.6, -W2 * 0.15), rv = rnd(-0.15, 0.15), ry = onTop(ru - 0.22, ru + 0.22, rv - 0.22, rv + 0.22);
    for (let k = 0; k < 3; k++) { const [x, , z] = at(ru, rv, 0); G.cyl('rubber', x, ry + 0.005 + k * 0.035, z, 0.22 - k * 0.03, 0.22 - k * 0.03, 0.035, 12, 0.55 + k * 0.05, { caps: k === 2 }); }
    const ju = rnd(W2 * 0.15, W2 * 0.55), jv = rnd(-0.12, 0.12), jy = onTop(ju - 0.3, ju + 0.3, jv - 0.3, jv + 0.3);
    box('paint', ju, jv, jy + 0.09, 0.47, 0.17, 0.34, rnd(-0.6, 0.6), 0.55);
    const pL = Math.min(1.4, s.w * 0.45), pu = rnd(-0.3, 0.3), pv = rnd(-0.25, 0.25), py = onTop(pu - pL / 2, pu + pL / 2, pv - 0.15, pv + 0.15);
    box('boards', pu, pv, py + 0.03, pL, 0.03, 0.16, rnd(-0.25, 0.25), 0.8);
  }
  // two lashings over the top, down both long sides to pegs at the foot (just inside the footprint); the side runs
  // stand 4.5 cm off the drape (clear of its pleats, which reach 3 cm out)
  for (const fu of [-0.3, 0.3]) {
    const i = Math.round((fu * s.w + WT) / du), uu = -WT + i * du;
    const off = (p, sgn, d) => { const o = outV(sgn); return [p[0] + o[0] * d, p[1], p[2] + o[2] * d]; };
    const path = [at(uu, -(D2 - 0.03), 0.02), at(uu, -(DT + 0.045), PH + 0.25), off(top[i][0], -1, 0.03)];
    for (let j = 1; j < nv; j++) path.push([top[i][j][0], top[i][j][1] + 0.025, top[i][j][2]]);
    path.push(off(top[i][nv], 1, 0.03), at(uu, DT + 0.045, PH + 0.25), at(uu, D2 - 0.03, 0.02));
    for (let k = 0; k + 1 < path.length; k++) strand(G, 'rubber', path[k], path[k + 1], 0.014, 0.45);
    for (const sgn of [-1, 1]) box('timber', uu, sgn * (D2 - 0.03), 0.06, 0.05, 0.12, 0.05, 0.3, 0.5); // the pegs
  }
}

/** A stack of split firewood against a wall (rot: along the wall), with a chopping block. */
export function woodStack(G, x, z, rot = 0, L = 3.0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let row = 0; row < 4; row++) for (let k = 0; k < Math.floor(L / 0.32); k++) {
    const u = -L / 2 + 0.16 + k * 0.32 + (row % 2) * 0.08, yy = 0.13 + row * 0.24;
    if (Math.abs(u) > L / 2 - 0.12) continue;
    G.box('bark', x + c * u, yy, z + s * u, 0.26, 0.24, 0.62, rot, 0.85 + ((k * 7 + row * 3) % 5) * 0.05);
  }
  G.cyl('timber', x + c * (L / 2 + 0.7) + s * 0.3, 0, z + s * (L / 2 + 0.7) - c * 0.3, 0.26, 0.26, 0.45, 10, 0.6);
}
/**
 * A round tube from point A to point B (3D), radius r0 at A and r1 at B, `seg` sides, with end caps (`capA`, `capB`):
 * Geo.cyl laid along any axis (the same winding: faces out).
 */
export function tube(G, mat, A, B, r0, r1, seg = 12, tone = 1, { capA = true, capB = true } = {}) {
  const w = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(...w) || 1, W = w.map((v) => v / L);
  const up = Math.abs(W[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let U = cross3(W, up); const lu = Math.hypot(...U) || 1; U = U.map((v) => v / lu);
  const V = cross3(U, W); // (U × V = -W: Geo.cyl's ring handedness)
  const ring = (C, r) => Array.from({ length: seg }, (_, k) => {
    const a = (k / seg) * Math.PI * 2, c = Math.cos(a) * r, s = Math.sin(a) * r;
    return [C[0] + U[0] * c + V[0] * s, C[1] + U[1] * c + V[1] * s, C[2] + U[2] * c + V[2] * s];
  });
  const RA = ring(A, r0), RB = ring(B, r1);
  for (let k = 0; k < seg; k++) { const k1 = (k + 1) % seg; G.quad(mat, RA[k], RB[k], RB[k1], RA[k1], tone); }
  if (capA && r0 > 1e-4) for (let k = 1; k + 1 < seg; k++) G.tri(mat, RA[0], RA[k], RA[k + 1], tone);
  if (capB && r1 > 1e-4) for (let k = 1; k + 1 < seg; k++) G.tri(mat, RB[0], RB[k + 1], RB[k], tone);
}

/**
 * The SE bastion's coast-defence searchlight, idle (design §13: dark, parked): a cast-iron pedestal on a bolted foot,
 * a turntable, a trunnion yoke (two arms off a crossbar, bosses at the pivots) carrying the horizontal drum; the drum
 * ringed by cooling fins behind a louvred hood, its domed back with a pair of handles, its front door rim round dark
 * glass (three bars across it), aimed out over the moat (`rot`: the heading, `el` a little down: parked); the armoured
 * cable runs from the foot across the walk to a junction box. Geometry into `G`; returns the glass (its own mesh).
 */
export function bastionSearchlight(G, x, y, z, rot, { el = -0.07, cableTo = null } = {}) {
  const F = localFrame(x, z, rot);
  G.cyl('paint', x, y, z, 0.36, 0.3, 0.1, 16, 0.72);                              // the foot, bolted down
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.3; G.cyl('iron', x + Math.cos(a) * 0.3, y + 0.1, z + Math.sin(a) * 0.3, 0.025, 0.025, 0.03, 6, 0.45); }
  G.cyl('iron', x, y + 0.1, z, 0.13, 0.1, 0.6, 12, 0.62);                          // the column
  G.cyl('paint', x, y + 0.7, z, 0.25, 0.25, 0.07, 18, 0.78);                       // the turntable
  segBox(G, 'paint', F, -0.09, 0.09, -0.5, 0.5, y + 0.77, y + 0.86, 0.8);         // the yoke's crossbar
  for (const sw of [-1, 1]) {
    segBox(G, 'paint', F, -0.075, 0.075, sw * 0.46 - 0.035, sw * 0.46 + 0.035, y + 0.86, y + 1.3, 0.8, { taperOut: 0 });
  }
  const c = [x, y + 1.21, z], d = [Math.cos(el) * F.t[0], Math.sin(el), Math.cos(el) * F.t[1]];
  const up = [-Math.sin(el) * F.t[0], Math.cos(el), -Math.sin(el) * F.t[1]], side = [F.n[0], 0, F.n[1]];
  const P = (k, s = 0, h = 0) => [c[0] + d[0] * k + side[0] * s + up[0] * h, c[1] + d[1] * k + up[1] * h, c[2] + d[2] * k + side[2] * s + up[2] * h];
  for (const sw of [-1, 1]) tube(G, 'iron', P(0, sw * 0.37), P(0, sw * 0.52), 0.07, 0.07, 10, 0.5);   // trunnion bosses
  tube(G, 'paint', P(-0.34), P(0.3), 0.36, 0.37, 20, 0.84);                          // the drum
  for (let k = -0.27; k < 0.08; k += 0.07) tube(G, 'paint', P(k), P(k + 0.02), 0.425, 0.425, 20, 0.7); // cooling fins
  tube(G, 'iron', P(0.3), P(0.37), 0.405, 0.405, 20, 0.55, { capA: false, capB: false }); // the front door's rim
  tube(G, 'iron', P(0.37), P(0.385), 0.405, 0.35, 20, 0.5, { capA: false, capB: false }); // its bezel (the glass sits inside)
  tube(G, 'paint', P(-0.34), P(-0.47), 0.36, 0.2, 18, 0.78);                         // the domed back
  tube(G, 'paint', P(-0.47), P(-0.52), 0.2, 0.08, 12, 0.74);
  for (const sw of [-1, 1]) {                                                       // the training handles
    tube(G, 'iron', P(-0.42, sw * 0.17, 0.05), P(-0.6, sw * 0.17, 0.05), 0.017, 0.017, 6, 0.45);
  }
  tube(G, 'iron', P(-0.6, -0.17, 0.05), P(-0.6, 0.17, 0.05), 0.02, 0.02, 6, 0.45);
  // the louvred hood over the lamp house (the carbons' heat), set into the drum's top behind the fins' ring
  const hc = P(-0.12, 0, 0.36);
  G.box('paint', hc[0], hc[1] + 0.03, hc[2], 0.3, 0.16, 0.24, rot, 0.76);
  G.box('paint', hc[0], hc[1] + 0.13, hc[2], 0.36, 0.035, 0.3, rot, 0.68);
  for (const k of [-0.09, -0.03, 0.03, 0.09]) { const q = P(-0.12 + k, 0, 0.36); G.box('iron', q[0], q[1] + 0.04, q[2], 0.018, 0.1, 0.26, rot, 0.4); }
  // three bars across the glass (the front door's cross-straps)
  const g0 = P(0.372);
  for (const s of [-0.16, 0, 0.16]) {
    const hh = Math.sqrt(Math.max(0, 0.35 * 0.35 - s * s));
    tube(G, 'iron', P(0.372, s, -hh), P(0.372, s, hh), 0.012, 0.012, 6, 0.4);
  }
  // the armoured cable: up out of the foot, across the walk, to a junction box
  if (cableTo) {
    const a0 = F.at(-0.26, 0.1);
    const pts = [[a0[0], y + 0.16, a0[1]], [a0[0], y + 0.03, a0[1]], ...cableTo.map(([cx, cz]) => [cx, y + 0.03, cz])];
    for (let k = 0; k + 1 < pts.length; k++) tube(G, 'rubber', pts[k], pts[k + 1], 0.026, 0.026, 6, 0.5, { capA: k === 0, capB: k + 2 === pts.length });
    const [ex, ez] = cableTo[cableTo.length - 1];
    G.box('iron', ex, y + 0.22, ez, 0.26, 0.36, 0.2, rot, 0.5);
    G.box('iron', ex, y + 0.42, ez, 0.3, 0.04, 0.24, rot, 0.42);
  }
  // the glass: dark, a cold sheen (the lamp is out); a disc just inside the lip, facing out
  const glassGeo = new THREE.CircleGeometry(0.352, 28);
  const glass = new THREE.Mesh(glassGeo, new THREE.MeshStandardMaterial({ color: 0x1d262b, roughness: 0.07, metalness: 0.0, envMapIntensity: 1.4 }));
  glass.position.set(...P(0.362));
  glass.lookAt(g0[0] + d[0], g0[1] + d[1], g0[2] + d[2]);
  glass.name = 'e05:searchlight-glass';
  glass.castShadow = false;
  // (the silvered mirror shows through the glass as a paler ring round the dark lamp house: 2 cm before the drum's
  // front, 4 cm behind the glass)
  const refl = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.34, 28), new THREE.MeshStandardMaterial({ color: 0x8f969a, roughness: 0.25, metalness: 0.9 }));
  refl.position.set(...P(0.32));
  refl.lookAt(...P(1.2));
  refl.name = 'e05:searchlight-reflector';
  const grp = new THREE.Group();
  grp.add(glass, refl);
  return grp;
}

/**
 * An old cast-iron garrison gun on its truck carriage (rot: the muzzle's heading), on a walk at y: the barrel turned
 * in profile (cascabel, base ring, two reinforces, the chase tapering to a swelled muzzle with its dark bore) on its
 * trunnions, laid a little up; the carriage's stepped oak cheeks on two axle-trees, four small trucks on their axles.
 */
export function fieldCannon(G, x, z, y, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  // a point `u` m along the muzzle's heading, `v` m to its left, `h` m up from the walk
  const at = (u, v, h) => [x + c * u - s * v, y + h, z + s * u + c * v];
  // the carriage: two oak cheeks rising to the front (where the trunnions bear), on two axle-trees, four small trucks
  for (const v of [-0.27, 0.27]) {
    const q = (u, vv, h) => at(u, v + vv, h);
    G.hexa('timber', [q(-0.78, -0.055, 0.12), q(-0.78, 0.055, 0.12), q(0.62, 0.055, 0.12), q(0.62, -0.055, 0.12),
      q(-0.78, -0.055, 0.4), q(-0.78, 0.055, 0.4), q(0.62, 0.055, 0.66), q(0.62, -0.055, 0.66)], 0.62, { bottom: true });
    const [bx, , bz] = at(0.3, v, 0);
    G.box('iron', bx, y + 0.625 + 0.012, bz, 0.2, 0.024, 0.13, rot, 0.3); // the trunnion's cap-square, on the cheek's top
  }
  for (const u of [-0.55, 0.42]) {
    const [ax, , az] = at(u, 0, 0);
    G.box('timber', ax, y + 0.2, az, 0.16, 0.14, 0.82, rot, 0.5); // the axle-tree, through both cheeks
    for (const v of [-0.44, 0.44]) {
      tube(G, 'timber', at(u, v - 0.05, 0.2), at(u, v + 0.05, 0.2), 0.2, 0.2, 14, 0.5); // a truck on its axle
      tube(G, 'iron', at(u, v - 0.052, 0.2), at(u, v + 0.052, 0.2), 0.206, 0.206, 14, 0.28, { capA: false, capB: false }); // its iron tyre
      tube(G, 'iron', at(u, v - 0.07, 0.2), at(u, v + 0.07, 0.2), 0.06, 0.06, 8, 0.32); // the hub and linch-pin
    }
  }
  // the barrel turned in profile — stations [u, r] from the cascabel's knob to the muzzle (a step is two stations a
  // few mm apart) — laid 3° up about its trunnions
  const tilt = (3 * Math.PI) / 180, pivot = 0.3, h0 = 0.74;
  const P = (u) => { const du = u - pivot; return at(pivot + du * Math.cos(tilt), 0, h0 + du * Math.sin(tilt)); };
  const prof = [[-0.94, 0.0], [-0.92, 0.045], [-0.88, 0.065], [-0.84, 0.05], [-0.82, 0.04], [-0.78, 0.04], [-0.778, 0.245], [-0.72, 0.245],
    [-0.718, 0.232], [-0.12, 0.225], [-0.118, 0.24], [-0.08, 0.24], [-0.078, 0.215], [0.4, 0.205], [0.402, 0.218], [0.44, 0.218],
    [0.442, 0.192], [1.3, 0.152], [1.38, 0.172], [1.45, 0.176], [1.46, 0.17]];
  for (let k = 0; k + 1 < prof.length; k++) {
    const [u0, r0] = prof[k], [u1, r1] = prof[k + 1];
    tube(G, 'iron', P(u0), P(u1), r0, r1, 14, 0.27 + (k % 3) * 0.02, { capA: false, capB: k === prof.length - 2 });
  }
  tube(G, 'rubber', P(1.455), P(1.466), 0.072, 0.072, 12, 0.12, { capA: false }); // the bore, dark in the muzzle's face
  tube(G, 'iron', at(pivot, -0.335, h0), at(pivot, 0.335, h0), 0.06, 0.06, 10, 0.3); // the trunnions
}

/**
 * A field-telephone line on poles: creosoted poles (h m) with a cross-arm and two insulators each, two sagging wires
 * between consecutive poles. points: [[x, z, groundY?], …]. Returns a Group (poles merged; wires thin boxes).
 */
export function telegraphLine(points, { h = 5.2 } = {}) {
  const G = new Geo('e05:telegraph'), tops = [];
  for (const [x, z, y0 = 0] of points) {
    G.cyl('timber', x, y0 - 0.2, z, 0.11, 0.085, h + 0.2, 8, 0.5);
    G.box('timber', x, y0 + h - 0.35, z, 0.9, 0.09, 0.09, 0, 0.55);
    for (const s of [-0.35, 0.35]) { G.cyl('e05_dressed', x + s, y0 + h - 0.3, z, 0.045, 0.035, 0.12, 6, 1.2); tops.push([x + s, y0 + h - 0.18, z]); }
  }
  const g = G.build('e05:telegraph', { ground: 0, damp: 0, moss: 0 });
  const mat = castleMaterial('rubber');
  for (let k = 0; k + 2 < tops.length; k++) {
    const a = tops[k], b = tops[k + 2];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - Math.hypot(b[0] - a[0], b[2] - a[2]) * 0.035, (a[2] + b[2]) / 2];
    for (const [p, q] of [[a, mid], [mid, b]]) {
      const L = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, L), mat);
      w.position.set((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2);
      w.lookAt(q[0], q[1], q[2]);
      w.castShadow = false;
      g.add(w);
    }
  }
  return g;
}
