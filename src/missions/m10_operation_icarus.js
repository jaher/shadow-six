/**
 * BEL Mission 10 — "Operation Icarus" (buildable layout: docs/missions/m10.md). Owned by MISSIONS.
 * El Agheila, Libya, 14 November 1942. Rommel's retreat has dug in round an airfield. The team starts in the
 * ruins in the NW; S of them lies the camp: a walled compound (the prisoner pen with the RAF pilot McRae, the
 * domed bomb store) and a concrete apron (the NE barracks, five tank sheds). A wired road winds N up to the
 * airfield shelf (y 5), where the Ju 52 waits. Free McRae, blow the store with the Sapper's one time bomb and
 * fly out; McRae is the only pilot. The only vacant Panzer IV in BEL stands in the bombed SE shed: boarding
 * it sounds the camp alarm and wakes the four crewed tanks. The two Stukas are an optional extra (no merit).
 *
 * Conventions: dossier headings/rot in DEGREES (0 = E, 90 = S), converted with deg(); route `look` and
 * `post.sweep` stay in degrees; route `vel` in VEL units. Airfield positions already carry the dossier's +6 m
 * projection shift (§4.1). Briefing text is our own wording (§7.3).
 *
 * Deviations from the dossier (engine / grid fit, see the commit message):
 *  - the shelf and the road ramp are `walkways` (M5/M8 method, delta 7); land vehicles never enter a raised cell,
 *    so every tank stops at the ramp FOOT (z ≈ 64) rather than at the chevaux-de-frise on the rim (delta 5): the
 *    hedgehog row stands at the ramp foot and the team walks the last ~50 m;
 *  - the ramp runs (67.5,64) → (73,49) and belts W2/E1 stop at z 60 so it clears them; the glacis is flat ground;
 *  - grenade-killable enemy Panzer IVs, the indestructible Ju 52 that taxis on the shelf, pz22's looping alarm
 *    patrol and the take-off climb are mission-script glue (scripts/m10.js, deltas 1, 2, 4, 12);
 *  - o1 (free McRae) and o3 (the Stukas) are `script` objectives set by triggers: the #14 checker only knows
 *    structure targets. McRae's death still loses the mission (§8.1: a guest is a commando); the escape (o4)
 *    needs every living man, McRae included, aboard the Ju 52;
 *  - the tank sheds are three-sided walls; shed_5 is 15 × 12 at (106,199) so it stays on the map; each tank sits
 *    in its shed facing out of the open side; tents, crates and a few posts moved ≤ 2 m off walls they overlapped.
 */

import {
  SHELF_Y, shelfStrips, segmentHoles, rampWalkways, m10Script, m10Tick, setVehicleRoute, startDrive,
} from './scripts/m10.js';
import { rectPoly } from './scripts/m05.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (enemy-brain)
const Y = SHELF_Y;
const ROT = 333; // the camp's isometric grid (dossier §5)
const TENT_ROT = 327.6; // the N tent row, parallel to wall_n's E run and fence_mast

// ---------------------------------------------------------------- terrain (dossier §4)
/** T2 the airfield shelf (y 5); the notch at x 70–80 is the ramp head. */
const SHELF = [[0, 0], [119, 0], [119, 51], [86, 51], [80, 49], [70, 49], [50, 51], [0, 51]];
/** T6 the road ramp up the escarpment ([x, z, y] ends; 13 steps of 0.385 m). */
const RAMP = { a: [73, 49, Y], b: [67.5, 64, 0], width: 5, steps: 13 };
/** T6 the road: N gate → ramp foot, and on the shelf from the ramp head. */
const ROAD = [[40, 138], [38.2, 134.4], [47, 128], [56, 116], [64, 104], [67, 92], [67, 70], [67.5, 64]];
const APRON = [[68, 118], [95, 106], [119, 150], [119, 209], [80, 209], [62, 184], [72, 160], [76, 138]];

// ---------------------------------------------------------------- airfield (L1, y 5; dossier §5.1)
const drum = (id, x, z, extra = {}) => ({ id, type: 'barrels', variant: 'fuel_explosive', x, z, r: 0.3, h: 0.9, explosive: 'barrel', carriable: true, destructible: true, hp: 1, ...extra });
const wire = (id, points, h = 1.2) => ({ id, type: 'fence', variant: 'wire_on_stakes', points, h });
const hedgehog = (id, x, z) => ({ id, type: 'crates', variant: 'czech_hedgehog', x, z, rot: deg(45), w: 1.2, d: 1.2, h: 1.2, block: 1 });

const AIRFIELD = [
  { id: 'dugout', type: 'bunker', variant: 'dugout_airfield', label: 'Dugout', x: 21, z: 30, rot: 0, w: 14, d: 6, h: 2.5, mat: 'wood', flag: true, garrison: true, door: deg(90) },
  { id: 'sentry_hut', type: 'hut', variant: 'sentry_box_sandbag', x: 84, z: 45, rot: 0, w: 3, d: 3, h: 2.4 },
  { id: 'crates_af', type: 'crates', variant: 'ammo_crates', x: 99, z: 45.5, rot: 0, w: 5, d: 3, h: 1.1, block: 1 },
  { id: 'drums_af_e', type: 'barrels', variant: 'drum_pyramid', x: 113, z: 45, rot: 0, w: 4, d: 4, h: 1.8, block: 1 },
  { id: 'drums_af_w', type: 'barrels', variant: 'drum_pyramid', x: 21, z: 42, rot: 0, w: 4, d: 4, h: 1.8, block: 1 },
  wire('belt_rim_w', [[0, 49.5], [49, 50]]),
  wire('belt_rim_e', [[87, 50], [119, 49.5]]),
];
/** 3 of the 4 site barrels, by the Stukas (Prima's "nearby explosive barrels"). */
const AIR_DRUMS = [drum('barrel_1', 104, 43), drum('barrel_2', 106, 45.5), drum('barrel_3', 108.5, 43)];
/** Holes in the shelf walkways so the airfield props keep their block. */
const SHELF_HOLES = [
  ...AIRFIELD.filter((s) => s.w != null).map((s) => ({ poly: rectPoly(s.x, s.z, s.w, s.d, s.rot ?? 0) })),
  ...segmentHoles(AIRFIELD.find((s) => s.id === 'belt_rim_w').points, 0.3),
  ...segmentHoles(AIRFIELD.find((s) => s.id === 'belt_rim_e').points, 0.3),
];
/** Everything drawn on the shelf is lifted by the script (meshes) — drums too (entities). */
const LIFT = [...AIRFIELD.map((s) => s.id), ...AIR_DRUMS.map((s) => s.id)];

// ---------------------------------------------------------------- the ruins and the start (L0; dossier §5.2)
const ruin = (id, points, h) => ({ id, type: 'wall', variant: 'ruins_mudbrick', mat: 'stone', points, h, width: 0.8 });
const RUINS = [
  ruin('rw1', [[13, 57], [16, 67]], 2.4), // the start wall: the team waits W of it
  ruin('rw2', [[20, 57], [27, 68]], 2.2),
  ruin('rw3', [[27, 74], [33, 79], [33, 85]], 2.4),
  ruin('rw4', [[36, 64], [44, 70]], 2.0),
  ruin('rw5', [[37, 86], [44, 97]], 2.6),
  ruin('rw6', [[15, 87], [18, 95]], 2.2),
  { id: 'rw7', type: 'ruins', variant: 'ruins_mudbrick_low', mat: 'stone', x: 24, z: 101, rot: Math.atan2(4, 8), w: 9.7, d: 0.8, h: 1.6, block: 1 },
  ...[[[2, 64], [10, 58], [14, 55]], [[18, 80], [26, 88], [22, 96]], [[26, 91], [36, 99], [36, 104]], [[0, 80], [8, 86], [4, 96]]]
    .map((points, k) => ({ id: `trench_${k + 1}`, type: 'trench', variant: 'trench_ruins', points, width: 1.4, terrain: 2 })),
  { id: 'wreck_1', type: 'ruins', variant: 'vehicle_wreck_burnt', x: 13, z: 106, rot: deg(30), w: 5, d: 2.5, h: 2, block: 2 },
  { id: 'crater_1', type: 'crater', x: 16, z: 115, r: 4 },
  { id: 'wreck_2', type: 'ruins', variant: 'aircraft_wreck', x: 16, z: 115, rot: deg(20), w: 6, d: 3, h: 1.2, block: 1 },
  { id: 'crater_2', type: 'crater', x: 9, z: 127, r: 3.5 },
  { id: 'crater_3', type: 'crater', x: 108, z: 66, r: 5 },
];

// ---------------------------------------------------------------- the camp (L0; dossier §5.3–§5.5, rot 333)
const C = Math.cos(deg(ROT)), S = Math.sin(deg(ROT));
/** Camp-local (lx, lz) about (x, z) → world [x, z]. */
const L = (x, z, lx, lz) => [+(x + lx * C - lz * S).toFixed(2), +(z + lx * S + lz * C).toFixed(2)];
/** Outward heading (deg) of each camp-local side. */
const SIDE = { N: ROT - 90, E: ROT, S: ROT + 90, W: ROT + 180 };
/** A tank shed: three walls (the `open` side missing) + the tank spot 1 m towards the open side, facing out. */
function shed(id, x, z, w, d, open, extra = {}) {
  const hw = w / 2, hd = d / 2;
  const corners = [L(x, z, -hw, -hd), L(x, z, hw, -hd), L(x, z, hw, hd), L(x, z, -hw, hd)]; // sides N E S W = c0c1 c1c2 c2c3 c3c0
  const k = { N: 0, E: 1, S: 2, W: 3 }[open];
  const points = [1, 2, 3, 4].map((n) => corners[(k + n) % 4]);
  const h = SIDE[open];
  const spot = { x: +(x + Math.cos(deg(h))).toFixed(2), z: +(z + Math.sin(deg(h))).toFixed(2), heading: deg(h) };
  return { def: { id, type: 'wall', variant: 'tank_shed', mat: 'concrete', points, h: 5, width: 0.6, ...extra }, spot };
}
const SHED_1 = shed('shed_1', 101, 138, 11, 12, 'S');
const SHED_2 = shed('shed_2', 110, 155, 11, 12, 'W');
const SHED_3 = shed('shed_3', 65, 177, 12, 10, 'E');
const SHED_4 = shed('shed_4', 77, 193, 12, 10, 'E');
const SHED_5 = shed('shed_5', 106, 199, 15, 12, 'W', { broken: true }); // bombed: roof half gone; the vacant Panzer IV

/** The prisoner pen (mesh cage on timber posts) and its locked gate in the S side (the jail door). */
const PEN = [[23, 146], [36, 139], [38, 153], [28, 161]];
const PEN_GATE = { x: 33, z: 157, rot: Math.atan2(8, -10), w: 2.4 };
const PEN_DOOR = { x: 33.75, z: 157.95 }; // just outside the gate: the jail interactable

const camp = (id, type, variant, x, z, w, d, h, extra = {}) => ({ id, type, variant, x, z, rot: deg(ROT), w, d, h, ...extra });
const COMPOUND = [
  // walls: N (with the arched main gate), W (with the open W arch), S; barbed wire on N and S
  { id: 'wall_n', type: 'wall', variant: 'wall_mudbrick_wire', mat: 'plaster', h: 3, width: 1,
    clipAllow: ['gate_n'], // the runs end at the arch gate's piers: joined, not cut back by its body
    segments: [[[11, 152], [37.8, 139.1]], [[42.2, 136.9], [66, 121]]] },
  { id: 'gate_n', type: 'gate', variant: 'arch_gate_mudbrick', x: 40, z: 138, rot: Math.atan2(-4, 8), w: 4.9, open: true },
  { id: 'wall_w', type: 'wall', variant: 'wall_mudbrick', mat: 'plaster', h: 3, width: 1,
    segments: [[[11, 152], [19, 171], [20.2, 173.7]], [[21.8, 177.3], [23, 180], [33, 196]]] },
  { id: 'arch_w', type: 'ruins', variant: 'arch_mudbrick', x: 21, z: 175.5, rot: Math.atan2(9, 4), w: 5, d: 1, h: 3.5, block: 0 },
  { id: 'wall_s', type: 'wall', variant: 'wall_mudbrick_wire', mat: 'plaster', h: 3, width: 1, points: [[33, 196], [62, 182]] },
  // the pen: the jail for McRae (and for any commando captured here)
  { id: 'pen', type: 'fence', variant: 'prisoner_cage', h: 3, width: 0.3,
    segments: [[PEN[3], PEN[0], PEN[1], PEN[2], [33.94, 156.25]], [[32.06, 157.75], PEN[3]]] },
  { id: 'pen_gate', type: 'gate', variant: 'jail_door_mesh', ...PEN_GATE, h: 2.4, locked: true },
  // the bomb store (o2): domed block, time bomb only, the team can hide inside
  camp('store', 'house', 'domed_block', 48, 177, 10, 9, 4, { label: 'Bomb store', mat: 'plaster', enterable: true, door: [43.0, 179.5],
    destructible: true, bombOnly: true, hp: 100, destroyFx: ['bigBlast', 'fire'] }),
  { id: 'windpump', type: 'radio_mast', variant: 'windpump', x: 35, z: 182, r: 1.5, h: 9 },
  camp('truck_wreck', 'ruins', 'vehicle_wreck', 38, 164, 7, 2.6, 2.4, { rot: deg(340), block: 2 }),
  camp('crates_c1', 'crates', 'crates_big', 18, 162, 2.5, 2.5, 2, { block: 2, rot: deg(337.2) }), // ∥ wall_w
  camp('crates_c2', 'crates', 'crates', 32.8, 163, 2, 2, 1.1, { block: 1, rot: deg(321.3) }), // ∥ the pen's S side
  camp('crates_c3', 'crates', 'crates_pile', 20.5, 168.5, 3, 2, 1.4, { block: 1, rot: deg(337.2) }), // ∥ wall_w
  camp('crates_c4', 'crates', 'crates_pile', 41, 188, 3, 2, 1.4, { block: 1 }),
  camp('wreck_dismantled', 'ruins', 'vehicle_dismantled', 36.5, 171.5, 3, 2, 1.2, { block: 1 }),
  // the tent row runs along wall_n's E run (−33.8°) and fence_mast (−31°): 327.6° is parallel to both (≤ 2°)
  camp('tent_1', 'tent', 'tent_pyramid_desert', 51, 144.5, 6, 5, 3, { rot: deg(TENT_ROT) }),
  camp('tent_2', 'tent', 'tent_pyramid_desert', 59, 139.5, 6, 5, 3, { rot: deg(TENT_ROT) }),
  camp('tent_3', 'tent', 'tent_pyramid_desert', 69, 142, 6, 5, 3, { rot: deg(TENT_ROT) }),
];

const APRON_S = [
  { id: 'barracks', type: 'barracks', variant: 'barracks_corrugated_gable', label: 'Barracks', x: 88, z: 121, rot: deg(66), w: 22, d: 10, h: 6,
    mat: 'greyPaint', flag: true, garrison: true, door: deg(90) }, // indestructible (§4)
  { id: 'mast', type: 'radio_mast', variant: 'lattice_crane', x: 74, z: 124, r: 1.5, h: 12 },
  camp('mast_hut', 'crates', 'crate_big', 75, 129, 3, 2, 1.8, { block: 2, rot: deg(329) }), // ∥ fence_mast
  SHED_1.def, SHED_2.def, SHED_3.def, SHED_4.def, SHED_5.def,
  // the gantry hoist over the tank under repair (static hull, not a unit)
  camp('gantry', 'crates', 'gantry_hoist', 79, 157, 10, 5, 7, { block: 2, rot: deg(326.3) }), // ∥ fence_f2
  { id: 'tank_repair', type: 'ruins', variant: 'panzer4_hull', x: 78, z: 160, rot: deg(200), w: 5.9, d: 2.9, h: 2, block: 2 },
  // K's "inverted T wall" (A) and the wall by the vacant tank's shed (B)
  { id: 'wall_a', type: 'wall', variant: 'blast_wall_revetment', mat: 'concrete', h: 2.4, width: 1, segments: [[[86, 165], [91, 176]], [[87, 178], [98, 170]]] },
  { id: 'wall_b', type: 'wall', variant: 'blast_wall_revetment', mat: 'concrete', h: 2.4, width: 1, segments: [[[90, 191], [108, 182]], [[90, 190], [93, 200]]] },
  drum('barrel_4', 70, 182, { variant: 'fuel_explosive_blue' }), // the 4th site barrel, by e14
  // chain-link fences (see-through, uncrossable; no cutters in this mission)
  { id: 'fence_mast', type: 'fence', variant: 'fence_chainlink', points: [[66, 121], [75, 136]], h: 2.4 },
  { id: 'fence_ap_n', type: 'fence', variant: 'fence_chainlink', points: [[66, 121], [68, 118], [95, 106]], h: 2.4 },
  { id: 'fence_ap_e', type: 'fence', variant: 'fence_chainlink', points: [[95, 106], [119, 152]], h: 2.4 },
  { id: 'fence_f2', type: 'fence', variant: 'fence_chainlink', points: [[54, 168], [72, 156]], h: 2.4 },
  // f3 stops at shed_3's NW corner: from there the shed's own W wall is the divider (a fence laid over it made the wall see-through)
  { id: 'fence_f3', type: 'fence', variant: 'fence_chainlink', points: [[54, 168], [57.2, 174.6]], h: 2.4 },
  { id: 'fence_sw', type: 'fence', variant: 'fence_chainlink', points: [[62, 184], [79, 209]], h: 2.4 },
  camp('crate_f2', 'crates', 'crates', 64, 159, 2, 2, 1.1, { block: 1, rot: deg(326.3) }), // ∥ fence_f2
];

// ---------------------------------------------------------------- the wire field and the road (dossier §5.6)
const BELT_W1 = [[30, 131], [41, 110], [48, 95], [48, 56], [48.5, 50.5]]; // runs on up the cliff face into the rim wire: no gap
const BELT_W2 = [[44, 126], [52, 114], [60, 104], [62, 90], [62, 60]];
const BELT_E1 = [[56, 128], [64, 112], [71, 100], [73, 90], [73, 60]];
const BELT_E2 = [[82, 96], [86, 88], [86, 52], [86.5, 50.5]]; // likewise closes on the rim
/** Distance from (x, z) to a polyline. */
function distLine(pts, x, z) {
  let best = Infinity;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}
/** x-range of the field between belts `a` and `b` at depth z (linear along each belt). */
const xAt = (pts, z) => {
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    if ((az - z) * (bz - z) <= 0 && az !== bz) return ax + ((z - az) / (bz - az)) * (bx - ax);
  }
  return null;
};
/** Loose hedgehogs between two belts on a 7 m jittered grid; ≥ 2.5 m from the wire, ≥ 4 m from `keep` spots. */
function fieldHedgehogs(prefix, a, b, z0, z1, keep, seed) {
  const out = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let z = z0; z <= z1; z += 7) {
    const xa = xAt(a, z), xb = xAt(b, z);
    if (xa == null || xb == null) continue;
    for (let x = Math.min(xa, xb) + 3.5; x < Math.max(xa, xb) - 2; x += 7) {
      const px = +(x + (rnd() - 0.5) * 2).toFixed(1), pz = +(z + (rnd() - 0.5) * 2).toFixed(1);
      if (distLine(a, px, pz) < 2.5 || distLine(b, px, pz) < 2.5 || keep.some(([kx, kz]) => Math.hypot(px - kx, pz - kz) < 4)) continue;
      out.push(hedgehog(`${prefix}${out.length + 1}`, px, pz));
    }
  }
  return out;
}
const MG = [[54, 62], [79, 66], [78, 95]];
const mgRing = (id, x, z, rot) => ({ id, type: 'sandbags', variant: 'mg_nest_sandbag', x, z, rot: deg(rot), ring: { r: 1.6 }, h: 1.0, block: 1 });

const FIELD = [
  wire('belt_w1', BELT_W1), wire('belt_w2', BELT_W2), wire('belt_e1', BELT_E1), wire('belt_e2', BELT_E2),
  // a hedgehog on the wire every ~4.5 m is drawn by the belt mesh; the loose ones stop vehicles, not men
  ...fieldHedgehogs('hh_w', BELT_W1, BELT_W2, 62, 125, MG, 1001),
  ...fieldHedgehogs('hh_e', BELT_E1, BELT_E2, 62, 92, MG, 1002),
  // the chevaux-de-frise at the ramp foot, either side of the road
  hedgehog('cheval_w', 63.8, 64.5), hedgehog('cheval_e', 71.2, 63.5),
  mgRing('mg_1_ring', 54, 62, 20), mgRing('mg_2_ring', 79, 66, 180), mgRing('mg_3_ring', 78, 95, 200),
  // the telegraph line from the base to the airfield
  ...[[46.5, 134.5], [69.5, 80], [70.5, 68]].map(([x, z], k) => ({ id: `pole_${k + 1}`, type: 'telegraph_pole', x, z })),
  ...[[87, 43], [106, 48]].map(([x, z], k) => ({ id: `pole_af${k + 1}`, type: 'telegraph_pole', x, z, block: 0 })),
  // E field: rocks along the bank E of belt E2, scrub on the ruins and the E field (scenery)
  ...[[90, 60], [91, 70], [90, 82], [92, 91]].map(([x, z], k) => ({ id: `rocks_e${k + 1}`, type: 'rocks', variant: 'desert_rocks', x, z, r: 1, h: 1, block: 1 })),
  ...[[6, 72], [24, 64], [31, 70], [9, 102], [28, 112], [36, 124], [100, 76], [110, 86], [98, 100], [112, 104], [104, 60], [66, 57]]
    .map(([x, z], k) => ({ id: `bush_${k + 1}`, type: 'bush', variant: 'camel_thorn', x, z, r: 0.8, h: 0.8, block: 0 })),
];

/** Shelf visual lift: the airfield props (plus the two rim telegraph poles). */
const LIFT_ALL = [...LIFT, 'pole_af1', 'pole_af2'];

const STRUCTURES = [
  // the shelf (walkways) first, the ramp after it (overwrites the rim cells)
  { id: 'shelf', type: 'cliff', variant: 'escarpment_sandstone', points: SHELF, h: Y, block: 2, walkways: shelfStrips(SHELF, SHELF_HOLES) },
  { id: 'ramp', type: 'road', variant: 'road_ramp', points: [RAMP.a.slice(0, 2), RAMP.b.slice(0, 2)], width: RAMP.width,
    walkways: rampWalkways(RAMP.a, RAMP.b, RAMP.width, RAMP.steps) },
  ...AIRFIELD, ...AIR_DRUMS, ...RUINS, ...COMPOUND, ...APRON_S, ...FIELD,
];

// ---------------------------------------------------------------- enemies (dossier §8; Prima numbers where sure)
const JAIL = 'pen';
const sentry = (id, prima, x, z, h, sweep, period, inv, extra = {}) => ({ id, ...(prima ? { prima } : {}), soldierType: 'sentry', x, z, heading: deg(h),
  jail: JAIL, flags: { investigates: inv, holdsPost: !inv }, post: { heading: deg(h), sweep, period }, ...extra });
const walker = (id, prima, type, pts, extra = {}) => {
  const [a, b] = pts;
  return { id, ...(prima ? { prima } : {}), soldierType: 'soldier', x: a.x, z: a.z, heading: Math.atan2(b.z - a.z, b.x - a.x), jail: JAIL,
    flags: { investigates: true }, route: { type, vel: 1.0, points: pts }, ...extra };
};
/** 3-man patrol (sergeant + 2) in one column behind the leader. */
const patrol = (ids, prima, sq, x, z, h, route) => ids.map((id, k) => ({
  id, prima, soldierType: k === 0 ? 'sergeant' : 'trooper', x: +(x - Math.cos(deg(h)) * 1.2 * k).toFixed(2), z: +(z - Math.sin(deg(h)) * 1.2 * k).toFixed(2),
  heading: deg(h), jail: JAIL, squad: { id: sq, leader: ids[0], columns: 1 }, flags: { investigates: true }, route,
}));
const gunner = (id, x, z, h, gun) => ({ id, soldierType: 'mg', x, z, heading: deg(h), emplacement: gun, post: { heading: deg(h), sweep: 40, period: 10, giro: 90 } });

const ENEMIES = [
  // ===== Phase 1: the ruins (outside every zone): Prima 1–5. A shot from the start brings e1 and Patrol 4.
  sentry('e1', 1, 24, 73, 200, 40, 8, true),
  walker('e2', 2, 'PINGPONG', [P(30, 60, 3, 180), P(46, 62, 3, 0)]),
  walker('e3', 3, 'PINGPONG', [P(39, 72, 4, 270), P(35, 85, 4, 90)]),
  sentry('e4', 5, 37, 91, 180, 45, 10, true),
  ...patrol(['p4a', 'p4b', 'p4c'], 4, 'p4', 12, 98, 90, { type: 'PINGPONG', vel: 1.0, points: [P(12, 98, 4, 90), P(5, 76, 3, 0)] }),
  // ===== outside the W gate (z_camp): Prima 6
  walker('e5', 6, 'PINGPONG', [P(10, 160, 4, 180), P(24, 190, 4, 180)]),
  // ===== the walled compound: Prima 7–10, 12
  walker('e6', 7, 'PINGPONG', [P(21, 156, 3, 270), P(29, 176, 3, 90)]),
  walker('e7', 8, 'PINGPONG', [P(40, 184, 3, 0), P(32, 192, 4, 180)]),
  walker('e8', 9, 'PINGPONG', [P(44, 168, 3, 180), P(56, 162, 3, 0)]),
  sentry('e9', 10, 39, 157, 0, 35, 8, false), // at the pen: reached from behind
  sentry('e10', 12, 45, 145, 300, 40, 8, true),
  // ===== the apron: Prima 11, 13–19 and Patrol 20
  sentry('e11', 11, 67, 129, 150, 45, 10, false), // sees both e10 and e12: the Sniper's first round
  sentry('e12', 13, 63, 154, 300, 40, 8, true),
  walker('e13', 14, 'PINGPONG', [P(82, 132, 4, 270), P(79, 146, 3, 180)]),
  sentry('e14', 15, 69, 186, 0, 50, 10, true), // between sheds 3 and 4, by barrel_4
  walker('e15', 16, 'PINGPONG', [P(74, 165, 3, 180), P(84, 170, 3, 0)]),
  sentry('e16', 17, 107.5, 146.5, 200, 40, 8, true), // between sheds 1 and 2
  sentry('e17', 18, 99, 172, 315, 30, 8, false), // E end of the inverted-T wall
  walker('e18', 19, 'PINGPONG', [P(88, 183, 3, 180), P(101, 176, 3, 0)]),
  ...patrol(['p20a', 'p20b', 'p20c'], 20, 'p20', 112, 187, 90, { type: 'PINGPONG', vel: 1.0,
    points: [P(84, 146, 4, 270), P(100, 164), P(112, 180), P(112, 188, 4, 90)] }),
  // ===== the road (outside every zone): the three MG nests, fire on sight
  gunner('g1', 54, 62, 20, 'mg_1'), gunner('g2', 79, 66, 180, 'mg_2'), gunner('g3', 78, 95, 200, 'mg_3'),
];

// ---------------------------------------------------------------- garrisons (dossier §9; exit 2.7 m/s, loops 1.8 m/s)
const pts = (list) => list.map(([x, z]) => P(x, z));
const BARRACKS = {
  barracks: { pool: 9, squads: [
    { id: 'a1', event: 'RINT', size: 3, leader: 'sergeant', exitVel: 2.7, loopVel: 1.8, door: [89, 134], exitRoute: pts([[89, 134], [84, 140]]),
      loop: pts([[84, 140], [100, 150], [114, 170], [104, 178], [100, 160]]) }, // the apron
    { id: 'a2', event: 'RINT', size: 3, leader: 'sergeant', exitVel: 2.7, loopVel: 1.8, door: [83, 128], exitRoute: pts([[83, 128], [73.5, 148]]),
      loop: pts([[73.5, 148], [46, 150], [42, 168], [38, 186], [28, 179], [26, 158], [42, 142], [58, 148]]) }, // the compound
    { id: 'a3', event: 'RINT', size: 3, leader: 'sergeant', exitVel: 2.7, loopVel: 1.8, door: [79, 126], exitRoute: pts([[79, 126], [76, 137], [64, 133], [52, 135], [40, 139]]),
      loop: pts([[40, 139], [56, 116], [67, 92], [67, 70], [67, 92], [56, 116]]) }, // the road
  ] },
  // each squad leaves by its own door along its own line (b3 straight for the ramp head, b1 along the rim, b2 round
  // by the runway) so they reach the ramp head spread out, not stacked on one spot
  dugout: { pool: 9, squads: [
    { id: 'b1', event: 'RINT_AIR', size: 3, leader: 'sergeant', exitVel: 2.7, loopVel: 1.8, door: [16, 34.5], exitRoute: pts([[16, 35], [30, 41], [40, 38]]),
      loop: pts([[40, 38], [76, 46], [98, 29], [60, 32]]) },
    { id: 'b2', event: 'RINT_AIR', size: 3, leader: 'sergeant', exitVel: 2.7, loopVel: 1.8, door: [21, 34.5], exitRoute: pts([[21, 35], [46, 30], [66, 33], [76, 46]]),
      loop: pts([[76, 46], [88, 40], [104, 28], [116, 22], [100, 20]]) },
    { id: 'b3', event: 'RINT_AIR', size: 3, leader: 'sergeant', exitVel: 2.7, loopVel: 1.8, door: [26, 34.5], exitRoute: pts([[26, 35], [48, 42], [70, 45]]),
      loop: pts([[70, 45], [80, 46]]) }, // holds the ramp head; they never leave the shelf
  ] },
};

// ---------------------------------------------------------------- vehicles (dossier §6.1)
const crew2 = () => [{ soldierType: 'crew' }, { soldierType: 'crew' }];
const tank = (id, spot, extra = {}) => ({ id, vehicleType: 'panzer4', x: spot.x, z: spot.z, heading: spot.heading, driveable: false, crew: crew2(), behavior: 'standby', ...extra });
/** pz24 on the camp alarm: out of shed 3, S of the inverted-T wall, round the apron, through the N gate, up the road to below the ramp. */
export const PZ24_ROUTE = [[74, 174], [82, 182], [95, 182], [103, 172], [98, 158], [92, 148], [76, 147.5], [60, 151.5], [45, 150.5], [41.8, 141.6],
  [38.2, 134.4], [47, 128], [56, 116], [64, 104], [67, 92], [67, 78]]; // parks 14 m short of the ramp foot: a man on the ramp above
  // the roof-rule height (y 2.5, hidden from the road) is then > 18 m away, out of grenade reach (13.5 m throw + 4.5 m blast)
/** pz21 on the camp alarm: rolls out of the mouth of shed 1 and covers the apron. */
export const PZ21_ROUTE = [[103.5, 143.5]];
/** pz22 on the camp alarm: loops the E side of the apron. */
export const PZ22_LOOP = [P(103, 163), P(113, 174), P(113, 184, 4), P(106, 176), P(103, 163, 4)];

const VEHICLES = [
  // the vacant Panzer IV (the only drivable one in BEL): Driver only, the whole party fits; boarding it sounds the alarm
  { id: 'pz4', vehicleType: 'panzer4', x: SHED_5.spot.x, z: SHED_5.spot.z, heading: SHED_5.spot.heading, driveable: true, operators: ['driver'], seats: 6 },
  // the four crewed Panzer IVs on standby (fire at any commando they see); the alarm sets them moving (T2)
  tank('pz21', SHED_1.spot), tank('pz22', SHED_2.spot), tank('pz23', SHED_4.spot), tank('pz24', SHED_3.spot),
  // the escape plane: only McRae flies it; it takes off by itself (extraction)
  { id: 'ju52', vehicleType: 'ju52', x: 91, z: 20, y: Y, heading: deg(180), driveable: true, operators: ['mcrae'], seats: 6 },
  // the optional targets: static, nobody boards them
  { id: 'stuka_a', vehicleType: 'ju87', x: 97, z: 38, y: Y, heading: deg(250), driveable: false },
  { id: 'stuka_b', vehicleType: 'ju87', x: 111, z: 35, y: Y, heading: deg(265), driveable: false },
  // the three MG nests on the winding road (the Driver can take one once its gunner is dead)
  ...MG.map(([x, z], k) => ({ id: `mg_${k + 1}`, vehicleType: 'mgNest', x, z, heading: deg([20, 180, 200][k]), gunner: `g${k + 1}`, driveable: true })),
];

// ---------------------------------------------------------------- commandos (§3.8 row 10; W of the start wall rw1)
const COMMANDOS = [
  { role: 'greenberet', x: 11.5, z: 58, heading: deg(0), inventory: { knife: 1, pistol: 1, decoy: 1, shovel: 1 } },
  { role: 'sniper', x: 10.5, z: 60.5, heading: deg(0), inventory: { pistol: 1, sniperRifle: 3 } },
  { role: 'sapper', x: 11.5, z: 55.5, heading: deg(0), inventory: { pistol: 1, bearTrap: 1, grenade: 4, timeBomb: 1 } },
  { role: 'driver', x: 11.5, z: 63, heading: deg(0), inventory: { pistol: 1, smg: 20, firstAid: 6 } }, // inside 18 m of e1 and Patrol 4's N end: the lure shot
  // the guest: Capt. Gregor McRae, RAF, locked in the pen (character-bible §6.1). Unarmed; the only pilot.
  { role: 'guest', id: 'mcrae', guestId: 'mcrae', name: 'Capt. Gregor McRae', nickname: 'McRae', x: 31, z: 151, heading: deg(90),
    jailed: true, jailId: 'pen', inventory: {} },
];

// ---------------------------------------------------------------- trigger helpers
const byIdAlive = (w, id) => { const v = w.byId(id); return v && !v.destroyed && v.alive !== false ? v : null; };
const objDone = (w, id) => !!(w.objectives || []).find((o) => o.id === id)?.done;
/** T4: a commando (on foot, or driving the stolen tank) near the ramp foot / ramp head. */
function nearRamp(w) {
  const inRect = (x, z) => x >= 58 && x <= 90 && z >= 42 && z <= 68;
  if ((w.commandos || []).some((c) => c.alive !== false && c.state !== 'jailed' && inRect(c.x, c.z))) return true;
  const t = byIdAlive(w, 'pz4');
  return !!t?.driver && inRect(t.x, t.z);
}
/** Open the pen gate once McRae is free (the jail door interactable already let him out). */
function openPen(w) {
  const g = (w.interactables || []).find((i) => i.interactKind === 'door' && (i.tag === 'pen_gate' || i.structure?.id === 'pen_gate'));
  if (g) { g.locked = false; g.setOpen?.(true); }
}

// ---------------------------------------------------------------- the mission
export default {
  id: 'm10',
  campaign: 'BEL',
  title: 'Operation Icarus',
  subtitle: 'El Agheila, Libya · 14 November 1942',
  date: '1942-11-14',
  place: 'El Agheila, Libya',
  theater: 'desert',
  coneColors: 'desert',
  size: [119, 209],
  seed: 1942_1114,
  briefing: {
    historical: 'November 1942. Alamein was won ten days ago, and Rommel\'s army is retreating across Libya. Far behind it, at El Agheila, the enemy holds an airfield with a prison camp beside it. Yesterday one of our reconnaissance pilots, Captain Gregor McRae of the RAF, was shot down and taken there. We want him back.',
    text: 'You start in the ruins north-west of the camp. Get McRae out of his cage, and while you are inside, blow up the bomb store on the south side of the compound. If you fancy one of their tanks, help yourself, but think first: only one of them has no crew, and they will hear the engine. Your way home is the Junkers transport on the airfield up the hill to the north, and McRae can fly it. If you find a moment for the two Stukas parked beside it, nobody here will complain. That is all.',
    objectivesSummary: 'Free Captain McRae. Destroy the bomb store with a time bomb. Everyone aboard the Junkers on the airfield, McRae at the controls. The Stukas are a bonus.',
    hints: [
      'A captured Panzer would make the road up to the airfield a great deal easier.',
      'McRae is locked in a wire cage inside the camp. Open it.',
      'Only McRae can fly the transport. Get everyone aboard and he will take off.',
      'In the camp they react to what they see; up on the airfield they also react to what they hear.',
      'The ruins and the road belong to nobody: a shot out there raises no alarm, though the men nearby will come to look.',
      'A bang only carries so far down here: the men near it will come to look. Up on the airfield, though, any explosion wakes the dugout.',
      'The sand keeps footprints. Crawl when a patrol is about to cross your trail.',
      'The store needs the Sapper\'s time bomb. Clear everyone out of it first.',
      'The burnt-out plane in the crater south of the ruins may be his.',
    ],
  },
  lighting: { sunElevDeg: 55, sunAzimuthDeg: 110, kelvin: 5200, hdri: 'desert_clear_morning', fog: 240, lut: 'desert_noon' },
  water: null,
  baseTerrain: 'sand',
  terrain: [
    // T8 the concrete apron, T9 the trampled compound yard
    { type: 'poly', terrain: 'ground', points: APRON },
    { type: 'poly', terrain: 'ground', points: [[11, 152], [66, 121], [75, 136], [72, 156], [54, 168], [62, 184], [33, 196], [23, 180], [19, 171]] },
    // T2 the shelf (visual; the walkways raise it), T7 the runway
    { type: 'poly', terrain: 'ground', points: SHELF },
    { type: 'rect', terrain: 'road', x: 0, z: 13, w: 119, d: 12 },
    // T6 the road: N gate → ramp foot; on the shelf from the ramp head
    { type: 'path', terrain: 'road', points: ROAD, width: 5 },
    { type: 'path', terrain: 'road', points: [[73, 49], [76, 46], [80, 38]], width: 5 },
  ],
  structures: STRUCTURES,
  items: [],
  interactables: [
    // the pen's jail door: frees McRae (§4.10: not while an enemy sees you)
    { kind: 'jail', id: 'pen_door', x: PEN_DOOR.x, z: PEN_DOOR.z, jailId: 'pen' },
  ],
  vehicles: VEHICLES,
  commandos: COMMANDOS,
  enemies: ENEMIES,
  // K: the camp reacts to what it SEES, the airfield to what it sees OR HEARS; the ruins and the road are in no zone
  zones: [
    { id: 'z_camp', poly: [[0, 138], [28, 126], [50, 108], [72, 100], [95, 96], [119, 96], [119, 209], [0, 209]], onSeen: 'RINT', onHeard: null },
    { id: 'z_air', poly: [[0, 0], [119, 0], [119, 57], [86, 57], [80, 60], [50, 60], [50, 57], [0, 57]], onSeen: 'RINT_AIR', onHeard: 'RINT_AIR' },
  ],
  jails: [JAIL],
  barracks: BARRACKS,
  // the Green Beret's one climb spot: over the unwired W wall N of the arch, landing behind the crates (§7.1)
  climbLinks: [{ id: 'climb_w1', a: [14.7, 165.8, 0], b: [17.8, 165.4, 0], roles: ['greenberet'] }],
  ladders: [],
  triplines: [],
  objectives: [
    { id: 'o1', text: 'Free Captain McRae', type: 'script', required: true },
    { id: 'o2', text: 'Destroy the bomb store', type: 'destroy', targets: ['store'], required: true, bombOnly: true },
    { id: 'o3', text: 'Wreck both Stukas (optional)', type: 'script', required: false },
    { id: 'o4', text: 'Fly out in the Junkers, everyone aboard', type: 'escape', required: true, vehicleId: 'ju52' },
  ],
  setpieces: [],
  triggers: [
    // per-tick glue: grenade-killable enemy tanks, the Ju 52's rules, pz24's drive, the take-off climb
    { on: 'tick', once: false, do: [{ run: (w) => m10Tick(w) }] },
    // T1 boarding the vacant Panzer IV: the whole camp hears it
    { on: 'vehicle:enter', match: { vehicle: 'pz4' }, once: true,
      do: [{ alarm: 'z_camp', x: 105, z: 199 }, { taint: 'pz4' }, { message: 'They heard the engine. The whole camp is up!', kind: 'warn' }] },
    // T2 the camp alarm wakes the four tanks: pz21 rolls out onto the apron (every armed vehicle attacks the
    // tainted stolen tank on sight), pz22 patrols the E side, pz24 heads for
    // the airfield road, pz23 stays in its shed
    { on: 'alarm:zone', match: { event: 'RINT' }, once: true, do: [
      { run: (w) => startDrive(w, 'pz21', PZ21_ROUTE) },
      { run: (w) => setVehicleRoute(w, 'pz22', { type: 'LOOP', points: PZ22_LOOP }) },
      { run: (w) => startDrive(w, 'pz24', PZ24_ROUTE) },
    ] },
    // T3 McRae freed (o1): the pen gate swings open
    { on: 'unit:freed', match: { unit: 'mcrae' }, once: true, do: [
      { run: (w) => openPen(w) }, { objective: 'o1', set: 'done' },
      { message: 'McRae: "About time, lads. Point me at an aeroplane."', kind: 'objective' },
    ] },
    // T4 nobody stands on the airfield at the start: the dugout empties as the team reaches the ramp
    { on: 'tick', once: true, when: (_p, w) => nearRamp(w), do: [{ event: 'RINT_AIR', zone: 'z_air', x: 73, z: 49 }] },
    // o3 the Stukas (no merit)
    { on: 'tick', once: true, when: (_p, w) => !byIdAlive(w, 'stuka_a') && !byIdAlive(w, 'stuka_b'),
      do: [{ objective: 'o3', set: 'done' }, { message: 'Both Stukas are burning.', kind: 'info' }] },
    { on: 'objective', match: { id: 'o2', status: 'done' }, once: true, do: [{ message: 'The bomb store is gone. Now for the Junkers.', kind: 'objective' }] },
    // T6 the plane waits for the store (and for McRae)
    // (once per 10 s, not once per man: a party boarding together hears it once)
    { on: 'vehicle:enter', match: { vehicle: 'ju52' }, once: false,
      when: (_p, w) => !objDone(w, 'o2') && !(w.time - (w._m10?.t6 ?? -Infinity) < 10),
      do: [{ run: (w) => { w._m10 = w._m10 || {}; w._m10.t6 = w.time; } }, { message: 'McRae: "Not before that bomb store goes up. Orders."', kind: 'info' }] },
  ],
  script: m10Script({ shelf: SHELF, ramp: RAMP, hide: ['shelf'], lift: LIFT_ALL }),
  // the Ju 52 is on the airfield from the start; once McRae is free, the store is down and every living man is
  // aboard, McRae taxis W down the runway, over the dugout, and takes off off the W edge
  extraction: { vehicleId: 'ju52', spawnAt: { x: 91, z: 20, heading: deg(180) }, spawnWhen: ['o1', 'o2'],
    exit: { x: 6, z: 14, r: 6 }, leave: { x: -14, z: 13, speed: 18 } },
  // dossier §9 [P]: the opening grenade on Patrol 4 'raises nothing in the camp', and the camp and the airfield each
  // turn out for their own bangs only: a blast carries 60 m to the guards (the zone sensors still hear it map-wide,
  // so any explosion wakes the dugout, whose squads then patrol the shelf)
  rules: { explosionHearing: 60 },
  alarmFail: null,
  par: { time: 780 },
  cameraStart: { x: 14, z: 64, zoom: 1 },
  startDisguised: [],
};
