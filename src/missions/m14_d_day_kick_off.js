/**
 * BEL Mission 14 — "D-Day Kick Off" (buildable layout: docs/missions/m14.md). Owned by MISSIONS.
 * The coast by La Rivière, sector "Juno", Normandy, 25 May 1944. The whole team (GB, Sniper, Marine, Sapper,
 * Driver) starts aboard a rowboat off the SW beach of an island that runs off the W edge. Four coastal guns, each
 * of a different build, must be destroyed (o1): the S casemate g1, the SE casemate g2 (rear sand drift up to its
 * roof), the NE turret block g3 (ladder) and the NW open gun pit g4. The Sapper has three remote bombs, so one gun
 * goes up with a carried fuel barrel. A diagonal rock ridge (y 4, Green Beret only) splits the S half from the N
 * half; an empty Panzer II waits in the W of the N half. Anyone seen from the fortified line (z_wall) raises the
 * alarm; the beaches are outside it. The way out is the rowboat, rowed to the red buoy in the SE (o2).
 *
 * Conventions: headings/rot in DEGREES in the dossier, converted with deg(); route `look` and `post.sweep` stay in
 * degrees (0 = E, 90 = S, 180 = W, 270 = N). Raised positions are true positions (dossier §1 projection).
 * Briefing text is our own wording (§7.3).
 *
 * Deviations from the dossier (grid fit / engine; see the commit message):
 *  - the team spawns on the SW beach's W end and a `start` trigger seats it in the rowboat (no schema field);
 *  - g4's apron is 0.5 m (a walkable step for everyone) instead of 1 m, which would need a link;
 *  - bar_n's roof is at 6 m (flat_roof_house h 6, E4); gun roof posts are placed in each gun's local frame;
 *  - g2's rear drift is a stepped `walkways` ramp (E5); g3 and g4 are axis-aligned (the turret target is central);
 *  - wire belts and beach obstacles were fitted to the traced shore (a few moved a metre or two onto the sand);
 *  - g4 keeps `bunker: true` (D12 said false): otherwise a tank shell would destroy it, against §10's hit rule;
 *  - shovel: none (§3.8 row 12 is binding; the dossier's open question D1 stands);
 *  - D3 decided (review): the Panzer II carries its machine guns only (systems.md "2 MGs, no cannon", Prima's Phase 5
 *    "machine-guns everyone", as in M4), so no map-wide shell report lures both garrisons into its sights;
 *  - the W pass between the ridge tip and the E boulders is widened to ~5 m so the tank can use it (dossier T10).
 */

import {
  RIDGE_Y, ROOF_Y, BAR_ROOF_Y, APRON_Y, GUNS, gunFrame, levelStrips, rampWalkways, boardAll, outOfCharges, m14Script,
} from './scripts/m14.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (§4.1)

// ---------------------------------------------------------------- terrain shapes (dossier §4.3)
/** T2 the island (sand, footprints show). */
const ISLAND = [[0, 33], [10, 28], [20, 21], [35, 19], [50, 17], [64, 17], [68, 12], [72, 6], [80, 6], [82, 15], [95, 18], [105, 23], [112, 32],
  [116, 45], [115, 60], [112, 72], [114, 78], [127, 82], [127, 87], [114, 90], [108, 100], [100, 110], [96, 118], [95, 128], [100, 140], [95, 144],
  [88, 146], [80, 152], [65, 157], [55, 158], [53, 168], [46, 166], [40, 165], [28, 172], [15, 180], [0, 188]];
/** T3 the fortified interior (grass, no footprints). */
const INTERIOR = [[0, 47], [20, 50], [36, 44], [60, 43], [65, 40], [82, 46], [96, 60], [100, 76], [93, 84], [95, 95], [90, 108], [80, 118], [65, 125],
  [52, 130], [46, 140], [38, 146], [30, 150], [15, 152], [0, 152]];
/** T4 the central ridge (y 4, GB only). */
const RIDGE = [[0, 99], [20, 99], [32, 97], [46, 93], [60, 87], [72, 82], [75.5, 80.5], [76.5, 84.5], [74, 88], [61, 93], [47, 99], [33, 103], [20, 105], [0, 105]];
/** T5–T9 rock masses (not walkable); the spit tips run 2.5 m out over the shallow rim so nobody wades round them. */
const BOULDERS_E = [[81, 77], [85, 75], [87, 80], [86, 88], [81.5, 88], [81, 83]];
const SPIT_ENE = [[92, 84], [94, 79], [100, 77], [112, 80], [129.5, 81.5], [129.5, 88.5], [112, 90], [100, 90], [94, 88]];
const SPIT_S = [[76, 116], [77, 110], [84, 112], [90, 120], [98.5, 130], [103, 141.5], [98.5, 146.5], [92, 140], [88, 130], [82, 122]];
const SPIT_SW = [[36, 146], [38, 142], [46, 146], [50, 152], [53, 157], [55.5, 170.5], [47, 169.5], [43, 160], [40, 152]];
const RIDGE_NS = [[72, 3.5], [80, 3.5], [82, 14], [82, 30], [80, 45], [76, 50], [68, 48], [64, 40], [66, 28], [70, 15]];
const ROCK_GAP = [[18, 105], [24, 105], [24, 111], [18, 111]];
const ROCKS = [
  { id: 'rk_boulders_e', poly: BOULDERS_E, h: 5 }, { id: 'rk_spit_ene', poly: SPIT_ENE, h: 4 }, { id: 'rk_spit_s', poly: SPIT_S, h: 4 },
  { id: 'rk_spit_sw', poly: SPIT_SW, h: 3.5 }, { id: 'rk_ridge_ns', poly: RIDGE_NS, h: 5 }, { id: 'rk_gap', poly: ROCK_GAP, h: 4.5 },
];

// ---------------------------------------------------------------- the four guns (dossier §5.1)
/** Gun blocks: centre, w × d, rot (deg) = front heading − 90 so the local +z side is the embrasure. */
const GUN = {
  g1: { x: 54, z: 125.5, w: 8, d: 9, rot: -45 }, // front 45: over the S beach
  g2: { x: 90, z: 99.5, w: 12, d: 9, rot: -30 }, // front 60: over the E beach
  g3: { x: 90.5, z: 60, w: 11, d: 10, rot: 0 }, // turret block (target central)
  g4: { x: 42, z: 48, w: 9, d: 9, rot: 180 }, // open pit + apron (square, symmetric: rot 180 only trains the gun N)
};
const F1 = gunFrame(GUN.g1), F2 = gunFrame(GUN.g2);
const gun = (id, variant, h, extra = {}) => {
  const g = GUN[id];
  return { id, type: 'casemate_gun', variant, label: 'Coastal gun', x: g.x, z: g.z, rot: deg(g.rot), w: g.w, d: g.d, h,
    destructible: true, destroyedBy: ['explosion'], hp: 100, bombOnly: false, bunker: true, roofWalk: true, roofY: h,
    quietDestroy: true, ...extra }; // T2 names the gun that went up (no generic 'Coastal gun destroyed.' on top)
};
const GUNS_S = [
  // g1–g3: a bomb must lie within 3 m of the embrasure / turret point (§3.3), not anywhere on the block
  gun('g1', 'casemate_embrasure', ROOF_Y, { targetAt: 'front', targetRadius: 3 }),
  gun('g2', 'casemate_embrasure', ROOF_Y, { targetAt: 'front', targetRadius: 3 }),
  gun('g3', 'gun_turret_block', ROOF_Y, { targetRadius: 3 }),
  gun('g4', 'gun_pit_open', 0.65, { roofY: APRON_Y }), // bunker class too: the tank's cannon must not do the barrel's job (§10)
];
/** E5 gun 2's rear sand drift: a stepped ramp from the ground NW of the block onto its roof (anyone). */
const RAMP_G2 = { a: [...F2(-4, -11), 0], b: [...F2(-4, -3.6), ROOF_Y - 0.1], width: 4, steps: 9 };

// ---------------------------------------------------------------- small builders
const rock = (id, x, z, w, d, h = 2.2) => ({ id, type: 'rocks', variant: 'rock_coast', x, z, rot: 0, w, d, h, block: 2 });
// art pass: tree_13 by bar_n's S wall is a narrow Lombardy poplar (a spreading crown reached into the barracks);
// tree_10/11/12 round house_t ("the house near the tank") are young birches, low and narrow, so the landmark reads
// from the default camera (full-size oaks/planes S of it hid its roof)
const TREE_LOOK = { tree_13: { species: 'poplar' }, tree_10: { species: 'birch', h: 6.5 }, tree_11: { species: 'birch', h: 6 },
  tree_12: { species: 'birch', h: 6.5 } };
const tree = (id, x, z, k) => ({ id, type: 'tree', variant: 'broadleaf_normandy', x, z, r: 0.5, h: 8 + (k % 3), seed: 1401 + k,
  ...(TREE_LOOK[id] || {}) });
// art pass: every third beach obstacle is a steel Czech hedgehog (same footprint and block as the concrete tetrahedra)
const tetra = (id, x, z, k = 0) => ({ id, type: 'crates', variant: k % 3 === 2 ? 'czech_hedgehog' : 'beach_tetrahedron', label: 'Beach obstacle', x, z,
  rot: deg(30), w: 1.4, d: 1.4, h: 1.4, block: 1 });
const tooth = (id, x, z) => ({ id, type: 'crates', variant: 'dragons_teeth', label: "Dragon's tooth", x, z, rot: 0, w: 1.2, d: 1.2, h: 1.2, block: 1 });
// dossier §5.3: barbed wire with a Czech hedgehog every 3 m — `hedgehogEvery` steers feat/barbed-wire's belt recipes
// (wire-obstacles: hedgehog_belt / concertina with a hedgehog variant), which replace the plain fence look
const wire = (id, points) => ({ id, type: 'fence', variant: 'barbed_wire_hedgehog', points, h: 1.2, hedgehogEvery: 3 });
const drum = (id, x, z) => ({ id, type: 'barrels', variant: 'fuel_explosive', x, z, r: 0.3, h: 0.9, explosive: 'barrel', carriable: true, destructible: true, hp: 1 });
const nestRing = (id, x, z, h) => ({ id, type: 'sandbags', variant: 'mg_nest_sandbag', x, z, rot: deg(h), ring: { r: 1.6 }, h: 1.0, block: 1 });

// ---------------------------------------------------------------- structures (dossier §5)
const STRUCTURES = [
  // --- terrain: rock masses, then the ridge (its strips clear the block), then the sand ramp
  ...ROCKS.map((r) => ({ id: r.id, type: 'cliff', variant: 'rock_coast', points: r.poly, h: r.h, block: 2 })),
  { id: 'ridge', type: 'cliff', variant: 'rock_ridge_coast', label: 'Rock ridge', points: RIDGE, h: RIDGE_Y, block: 2, walkways: levelStrips(RIDGE, [], RIDGE_Y) },
  { id: 'ramp_g2', type: 'road', variant: 'sand_drift', label: 'Sand drift', points: [RAMP_G2.a.slice(0, 2), RAMP_G2.b.slice(0, 2)], width: RAMP_G2.width,
    walkways: rampWalkways(RAMP_G2.a, RAMP_G2.b, RAMP_G2.width, RAMP_G2.steps) },
  // --- the four guns (o1)
  ...GUNS_S,
  // --- buildings (§5.2): two garrisons, the house by the tank, the gun-4 shed, two blockhouses
  { id: 'bar_s', type: 'barracks', variant: 'barracks_concrete_2st', label: 'Barracks', x: 55.5, z: 104, rot: 0, w: 9, d: 6, h: 4, mat: 'concrete',
    flag: true, garrison: true, destructible: true, destroyedBy: ['explosion'], hp: 100, door: deg(90) },
  { id: 'bar_n', type: 'flat_roof_house', variant: 'barracks_concrete_2st', label: 'Barracks', x: 57.5, z: 68.5, rot: 0, w: 12, d: 8, h: BAR_ROOF_Y,
    roofY: BAR_ROOF_Y, roofWalk: true, mat: 'concrete', garrison: true, destructible: true, destroyedBy: ['explosion'], hp: 100, door: deg(180) },
  { id: 'flag_n', type: 'sign', variant: 'flagpole_german', x: 60, z: 58, rot: 0, w: 0.3, d: 0.3, h: 6, block: 0 },
  // (chimney: false — the modelled stacks / stove pipe stand in for the FX placeholder brick stack)
  { id: 'house_t', type: 'house', variant: 'house_concrete_2st', label: 'House', x: 19.5, z: 84.5, rot: 0, w: 9, d: 7, h: 6, mat: 'concrete', chimney: false },
  { id: 'hut_g4', type: 'hut', variant: 'shed_concrete', label: 'Shed', x: 52, z: 48.5, rot: 0, w: 6, d: 5, h: 3, mat: 'concrete', chimney: false },
  { id: 'van_g4', type: 'crates', variant: 'van_parked', label: 'Van', x: 57.8, z: 48.5, rot: deg(90), w: 4.5, d: 2, h: 2.2, block: 2,
    vehicleArt: 'opel_blitz_cargo' }, // the light lorry by the gun-4 shed: a parked Opel Blitz (library model, decor + cover)
  { id: 'pb_w', type: 'bunker', variant: 'blockhouse_small', label: 'Blockhouse', x: 37, z: 114, rot: 0, w: 6, d: 6, h: 2.5 },
  { id: 'bh_g1', type: 'bunker', variant: 'blockhouse_small', label: 'Blockhouse', x: 47.5, z: 135, rot: 0, w: 5, d: 5, h: 2.5 },
  // --- the anti-tank wall (§5.3): two concrete segments, gap_n and gap_mid open
  { id: 'w1', type: 'sea_wall', variant: 'at_wall_segment', label: 'Anti-tank wall', points: [[23.5, 117], [31, 129]], width: 1.2, h: 2.5 },
  { id: 'w2', type: 'sea_wall', variant: 'at_wall_segment', label: 'Anti-tank wall', points: [[35, 133], [44, 145]], width: 1.2, h: 2.5,
    clipAllow: ['rk_spit_sw'] }, // its S end is built into the SW rock spit (dossier §5.3)
  // --- wire belts (see-through)
  wire('wr_sw1', [[1, 168], [14, 167.5]]), wire('wr_sw2', [[8, 181.5], [18, 176.5]]), wire('wr_sw3', [[22, 156], [34, 155]]),
  wire('wr_s1', [[59, 123], [70, 126.5]]), wire('wr_s2', [[45.5, 147.5], [48.5, 150]]),
  wire('wr_e', [[97, 90.5], [102, 92.5]]),
  wire('wr_ne1', [[87, 30], [93.5, 40], [95.5, 45]]), wire('wr_ne2', [[97, 47.5], [100, 55], [103.5, 62]]), wire('wr_ne3', [[105, 64.5], [106, 68], [108, 75]]),
  wire('wr_n1', [[18, 25], [37, 25.5]]), wire('wr_n2', [[5, 37], [17, 33]]), wire('wr_n3', [[1, 50.5], [18, 52]]), wire('wr_n4', [[22, 49], [33, 43.5]]),
  wire('wr_n5', [[48, 41], [56, 40]]),
  // --- beach obstacles: tetrahedra (Patrol 1 turns round (12,163), P35 stands by (109,55)) and the dragon's teeth W of gun 4
  ...[[4, 162], [12, 163], [19, 153.5], [24, 161], [33, 157.5], [37, 163], [11, 175], [6, 177.5], [14, 173.5], [17, 171.5], [31, 168],
    [57, 140.5], [57, 151.5], [48, 153.5], [72, 136], [73, 143], [79, 127.5], [80, 139],
    [105, 95], [108, 98.5], [100, 108], [88, 32], [93, 36.5], [96, 29.5], [104, 43], [100, 51.5], [109, 55], [108, 59.5], [110, 67.5],
    [12, 40], [20, 45], [27, 36], [35, 39], [45, 32.5], [55, 37.5], [5, 46]].map(([x, z], k) => tetra(`tt_${k + 1}`, x, z, k)),
  ...[[30.5, 50], [31, 52.5], [31.5, 55], [33.5, 50.5], [34, 53], [34.5, 55.5], [44.5, 57.5], [46, 59.5]].map(([x, z], k) => tooth(`dt_${k + 1}`, x, z)),
  // --- MG nests (sandbag rings; the guns themselves are `mgNest` vehicles)
  nestRing('mg1_ring', 88, 136, 200), nestRing('mg2_ring', 93, 91.5, 120), nestRing('mg3_ring', 93, 75.5, 330), nestRing('mg4_ring', 83.5, 52, 300),
  nestRing('mg5_ring', 60, 26, 250),
  // --- rocks named in the walkthroughs (§4.3 T11) and the gap between bar_n and rk_bn
  rock('rk_sw', 8.5, 148, 6, 6, 2.5), rock('rk_41', 7, 62, 3, 2.5), rock('rk_nw', 8, 40.5, 3, 2.5), rock('rk_nb', 55, 22, 3, 2.5),
  rock('rk_g4', 25, 55, 3, 2.5), rock('rk_17', 67, 117, 3, 2.5), rock('rk_bn', 69.5, 67.5, 4, 14, 3), rock('rk_g3a', 70, 62, 3, 3),
  rock('rk_g3b', 92, 70.5, 3, 2), rock('rk_e1', 82, 72, 2.5, 2),
  // --- barrels (3, carriable), crates, trees
  drum('brl_1', 55, 53.3), drum('brl_2', 56.2, 54), drum('brl_3', 55.4, 54.8),
  { id: 'cr_s1', type: 'crates', variant: 'crate_stack', x: 51.5, z: 110, rot: 0, w: 3, d: 2, h: 1.6, block: 2 },
  { id: 'cr_s2', type: 'crates', variant: 'crate_stack', x: 62, z: 116, rot: 0, w: 4, d: 3, h: 1.6, block: 2 },
  { id: 'cr_g4', type: 'crates', variant: 'crate_stack', x: 46, z: 73, rot: 0, w: 6, d: 4, h: 1.5, block: 2 },
  ...[[3, 118], [8, 122], [5, 128], [12, 125], [30, 148], [32, 109], [45, 102.5], [15, 62], [37, 77], [2, 83], [15, 95], [22, 95], [55, 78], [66, 76]]
    .map(([x, z], k) => tree(`tree_${k + 1}`, x, z, k)),
  // --- the red buoy (extraction point)
  { id: 'buoy', type: 'sign', variant: 'buoy_red', label: 'Buoy', x: 122, z: 191, r: 0.6, h: 1.5, block: 0 },
  // --- art pass set dressing (visual only, block 0): 'Achtung Minen' boards on the seaward side of the wire belts,
  // a 'Halt! Sperrgebiet' board on the N beach, ammunition and stores stacked by the garrisons
  ...[[7, 169.5], [31, 153.3], [66, 123.4], [99.5, 89.3], [89.5, 28.6], [27, 23.6], [52, 38.8], [107.2, 66], [9, 34.5], [3, 49]]
    .map(([x, z], k) => ({ id: `minen_${k + 1}`, type: 'sign', variant: 'sign_minen', x, z, rot: deg((k * 67) % 360), r: 0.2, h: 1.5, block: 0 })),
  { id: 'sperr_n', type: 'sign', variant: 'sign_sperrgebiet', x: 42.5, z: 37.6, rot: deg(-4), w: 1.9, d: 0.4, h: 1.8, block: 0 },
  { id: 'ammo_bs', type: 'crates', variant: 'ammo_boxes', x: 61.6, z: 102.2, rot: 0, w: 1.4, d: 0.9, h: 0.7, block: 0 },
  { id: 'ammo_bn', type: 'crates', variant: 'ammo_boxes', x: 49.8, z: 63.2, rot: 0, w: 1.4, d: 0.9, h: 0.7, block: 0 },
  { id: 'stores_g3', type: 'crates', variant: 'crate_stack', x: 83.2, z: 64.6, rot: deg(90), w: 1.6, d: 1.0, h: 0.9, block: 0 },
];

// ---------------------------------------------------------------- enemies (dossier §8; `prima` = Prima's number)
const sentry = (id, prima, x, z, h, sweep, period = 10, extra = {}, flags = {}) => ({ id, ...(prima ? { prima } : {}), soldierType: 'sentry', x, z,
  heading: deg(h), flags: { holdsPost: true, investigates: true, ...flags }, post: { heading: deg(h), sweep, period }, ...extra });
const walker = (id, prima, pts, extra = {}, flags = {}, vel = 1.0) => {
  const [a, b] = pts;
  return { id, ...(prima ? { prima } : {}), soldierType: 'soldier', x: a.x, z: a.z, heading: Math.atan2(b.z - a.z, b.x - a.x),
    flags: { investigates: true, ...flags }, route: { type: 'PINGPONG', vel, points: pts }, ...extra };
};
/** A three-man patrol (sergeant + 2 troopers, one column); `trail` = the troopers' spawn offsets. */
const patrol = (key, prima, type, pts, trail, extra = {}) => {
  const route = { type, vel: 1.0, points: pts };
  const lead = pts[0], next = pts[1];
  const h = Math.atan2(next.z - lead.z, next.x - lead.x);
  const squad = { id: `p${key}`, leader: `p${key}a`, columns: 1 };
  return [
    { id: `p${key}a`, prima, soldierType: 'sergeant', x: lead.x, z: lead.z, heading: h, flags: { investigates: true }, squad, route, ...extra },
    ...trail.map(([x, z], k) => ({ id: `p${key}${'bc'[k]}`, prima, soldierType: 'trooper', x, z, heading: h, flags: { investigates: true }, squad, route, ...extra })),
  ];
};
const mg = (id, prima, x, z, h, sweep, gunId) => ({ id, ...(prima ? { prima } : {}), soldierType: 'mg', x, z, heading: deg(h), emplacement: gunId,
  post: { heading: deg(h), sweep, giro: 180 } });
const RIDGE_UP = { elevated: true, y: RIDGE_Y }, ROOF = { elevated: true, y: ROOF_Y };
const R1 = (lx, lz) => { const [x, z] = F1(lx, lz); return { x, z }; };
const R2 = (lx, lz) => { const [x, z] = F2(lx, lz); return { x, z }; };
const at = (p, wait, look) => P(p.x, p.z, wait, look);

const ENEMIES = [
  // ===== §8.1 the SW pocket and the SW beach (outside the zone): Phase 1
  ...patrol('1', 1, 'LOOP', [P(36, 161, 4, 0), P(24, 165.5), P(14, 167), P(8, 165, 3, 180), P(9, 160), P(16, 158.5), P(26, 158.5)], [[37.5, 161.5], [39, 162]]),
  ...patrol('3', 3, 'PINGPONG', [P(20, 115, 4, 270), P(20, 130), P(14, 139), P(4, 140, 3, 180)], [[20, 113.5], [20, 112]]),
  sentry('e2', 2, 14, 102, 60, 45, 10, RIDGE_UP),

  // ===== §8.2 gun 1 (Prima 4–19)
  walker('e4', 4, [P(27, 111.5, 3, 180), P(33.5, 121, 3, 0)]),
  walker('e5', 5, [at(R1(-2.5, -2), 3, 225), at(R1(2.5, -2), 3, 45)], ROOF, {}, 0.8),
  walker('e6', 6, [P(39, 125, 3, 90), P(45, 129, 3, 0)]),
  sentry('e7', 7, 33.5, 127.5, 0, 60, 9),
  sentry('e8', 8, ...Object.values(R1(2, 2.5)), 45, 40, 10, ROOF),
  sentry('e9', 9, ...Object.values(R1(-2.5, 2)), 135, 40, 10, ROOF),
  walker('e10', 10, [P(41, 107.5, 3, 180), P(49, 107.5, 3, 0)]),
  walker('e11', 11, [P(41, 110.5, 3, 180), P(47.5, 113.5, 3, 0)]),
  ...patrol('12', 12, 'PINGPONG', [P(50, 147.5, 4, 180), P(62, 149), P(80, 148, 4, 0)], [[48.5, 147], [47, 146.5]]),
  walker('e13', 13, [P(62, 129, 3, 90), P(70, 131, 3, 0)]),
  walker('e14', 14, [P(56, 137, 3, 90), P(66, 139, 3, 0)]),
  sentry('e15', 15, 58, 111, 180, 40, 12),
  sentry('e16', 16, 63, 112.5, 135, 40, 14),
  walker('e17', 17, [P(63, 120, 3, 180), P(73, 120, 3, 0)]),
  mg('mg1g', 18, 88, 136, 200, 60, 'mg1'),
  walker('e19', 19, [P(70, 108, 3, 180), P(77, 97, 3, 270)]),

  // ===== §8.3 the E sector: guns 2 and 3 (Prima 20–39)
  sentry('e20', 20, 52, 93.5, 45, 50, 10, RIDGE_UP),
  walker('e21', 21, [P(69, 92, 3, 180), P(75, 92, 3, 0)]),
  walker('e22', 22, [P(74, 100, 3, 90), P(80, 104, 3, 0)]),
  walker('e23', 23, [P(80, 108, 3, 270), P(86, 112, 3, 0)]),
  walker('e24', 24, [P(77, 90.5, 3, 270), P(77, 99, 3, 90)]),
  sentry('e25', 25, ...Object.values(R2(3.5, 1.5)), 45, 30, 14, ROOF),
  sentry('e26', 26, ...Object.values(R2(-2, 2.5)), 90, 30, 14, ROOF),
  walker('e25x', null, [at(R2(-4.5, -1), 4, 180), at(R2(4.5, -1), 4, 0)], ROOF, {}, 0.8),
  walker('e27', 27, [P(98, 109, 3, 45), P(104, 100, 3, 270)]),
  sentry('e28', 28, 92, 107, 60, 50),
  mg('mg2g', 29, 93, 91.5, 120, 50, 'mg2'),
  sentry('e30', 30, 88, 71, 0, 60, 9),
  walker('e31', 31, [P(86, 67, 3, 180), P(97, 67.5, 3, 0)]),
  walker('e32', 32, [P(84, 74.5, 3, 180), P(95, 73.5, 3, 0)]),
  walker('e33', 33, [P(74, 70.5, 3, 180), P(78, 76), P(88, 76, 3, 90)]),
  sentry('e34', 34, 109, 70.5, 300, 60),
  sentry('e35', 35, 107, 57.5, 90, 50),
  walker('e36', 36, [P(98, 44, 3, 180), P(104, 50.5, 3, 0)]),
  ...patrol('37', 37, 'PINGPONG', [P(110, 76.5, 4, 90), P(112, 62), P(110, 42), P(102, 27), P(92, 22, 4, 270)], [[110.5, 78], [111, 79.5]]),
  walker('e_g3r', null, [P(87, 58, 4, 180), P(94.5, 58, 4, 0)], ROOF, {}, 0.8),
  mg('mg3g', null, 93, 75.5, 330, 50, 'mg3'),
  mg('mg4g', null, 83.5, 52, 300, 50, 'mg4'),
  walker('e38', 38, [P(66, 52, 3, 270), P(73, 56.5, 3, 0)]),
  walker('e39', 39, [P(70, 79.5, 3, 180), P(77, 77, 3, 0)]),

  // ===== §8.4 the N sector: gun 4 and the tank (Prima 40–46)
  walker('e40', 40, [P(30, 77, 3, 0), P(17.5, 78, 2, 270)]),
  sentry('e41', 41, 15, 75.5, 0, 60),
  walker('e42', 42, [P(34, 47, 3, 0), P(12, 57.5, 3, 180)], {}, { followsTracks: true }),
  ...patrol('43', 43, 'PINGPONG', [P(4, 43, 4, 180), P(20, 40), P(40, 37), P(62, 32, 4, 0)], [[2.5, 43.5], [1.5, 44.5]]),
  sentry('e44', 44, 44, 67, 270, 60),
  sentry('e45', 45, 40, 50.5, 270, 70, 12, { y: APRON_Y }),
  sentry('e46', 46, 48, 51.5, 0, 60),
  sentry('e_flag', null, 61, 56.5, 180, 60),
  mg('mg5g', null, 60, 26, 250, 60, 'mg5'),
];

// ---------------------------------------------------------------- zone and garrisons (dossier §9)
/** "Seen from the wall": the fortified interior, all four guns, both barracks, the ridge E of x 30. */
const Z_WALL = [[0, 47], [20, 50], [34, 43], [48, 40], [60, 42], [65, 40], [82, 46], [96, 60], [100, 76], [93, 84], [95, 95], [90, 108], [80, 118],
  [65, 125], [52, 130], [46, 140], [45, 146], [35, 133], [31, 129], [23.5, 117], [24, 105], [30, 103.5], [30, 97.4], [20, 99], [0, 99]];
/** exit 2.7 m/s, loops 1.8 m/s */
const squad = (size, exitRoute, loop) => ({ event: 'RINT', size, exitVel: 2.7, exitRoute, loopVel: 1.8, loop });
const BARRACKS = {
  bar_s: { pool: 10, squads: [
    squad(4, [P(55.5, 108.5), P(50, 116), P(46, 119)], [P(46, 119), P(35, 121), P(28, 113), P(36, 109), P(46, 108.5), P(48, 117)]), // W of gun 1
    squad(3, [P(58, 108.5), P(68, 108), P(76, 100)], [P(76, 100), P(80, 109), P(92, 110), P(98, 104), P(92, 110), P(80, 109)]), // gun 2 front
  ] },
  bar_n: { pool: 10, squads: [
    squad(4, [P(50.5, 68.5), P(46, 62), P(42, 57)], [P(42, 57), P(28, 60), P(16, 70), P(27, 78), P(40, 66)]), // gun 4 and the tank yard
    squad(3, [P(50.5, 70), P(56, 76.5), P(66, 77.5), P(76, 71), P(82, 66)], [P(82, 66), P(96, 68), P(88, 75), P(78, 62), P(72, 54)]), // gun 3
  ] },
};

// ---------------------------------------------------------------- climb links (GB) and the gun-3 ladder (dossier §7.1)
const GB = ['greenberet'];
const CLIMBS = [
  { id: 'cl_ridge_w', a: [10, 103, RIDGE_Y], b: [10, 106.5, 0], roles: GB }, // behind P2 [K][P]
  { id: 'cl_ridge_pb', a: [37, 99.5, RIDGE_Y], b: [37, 103.5, 0], roles: GB }, // N of the blockhouse [K]
  { id: 'cl_ridge_bs', a: [47, 96.5, RIDGE_Y], b: [47, 100.5, 0], roles: GB }, // W of bar_s [P]
  { id: 'cl_ridge_e', a: [72, 85.5, RIDGE_Y], b: [72, 90, 0], roles: GB }, // by P21 [P]
  { id: 'cl_ridge_n', a: [30, 99.5, RIDGE_Y], b: [30, 95.5, 0], roles: GB }, // the N face: over to the gun-4 side
  { id: 'cl_g1', a: [...F1(-3, 0), ROOF_Y], b: [...F1(-5.3, 0), 0], roles: GB }, // g1's SW wall [K][P][eg]
  { id: 'cl_bn', a: [57.5, 71.5, BAR_ROOF_Y], b: [57.5, 73.7, 0], roles: GB }, // bar_n's S wall [eg]
];
const LADDERS = [
  { id: 'ld_g3', x: 84.2, z: 60, y: 0, top: [85.8, 60, ROOF_Y], raised: false, heading: deg(0) }, // g3's W wall, anyone [P]
];

export default {
  id: 'm14',
  campaign: 'BEL',
  title: 'D-Day Kick Off',
  subtitle: 'La Rivière, sector Juno, Normandy · 25 May 1944',
  date: '1944-05-25',
  place: 'The coast by La Rivière, sector "Juno", Normandy',
  theater: 'coast',
  coneColors: 'green',
  size: [134, 209],
  seed: 1944_0525,
  briefing: {
    historical: 'May 1944. Overlord is ready down to the last landing craft, and Eisenhower waits only for the weather. New air photographs show four heavy guns dug in near La Rivière, where our beaches Gold and Juno meet. If they are still firing on the day, they will cut the assault boats to pieces.',
    text: 'You go in by boat, officer, from this corner. There are four guns, and every one of them must be silenced; not one may be left standing. Then get your men back into the boat and row out to the buoy. A great many soldiers are counting on you.',
    objectivesSummary: 'Destroy all four coastal guns, then row everyone out to the red buoy in the south-east.',
    hints: [
      'Four guns to wreck, then everyone back in the boat and out to the buoy in the south-east.',
      'The Marine can row you round the island and land you wherever it is quietest.',
      'The Green Beret can climb the rock ridge in the middle of the island and come down behind the wall.',
      'Out on the beaches the Marine can use his speargun and nobody in the fortifications will hear it.',
      'The Panzer II standing in the west can carry the whole team back down to the boat.',
      'Anyone seen from inside the fortified line brings the alarm down on you. Only the ground just north of your landing is quiet.',
    ],
  },
  lighting: { sunElevDeg: 40, sunAzimuthDeg: 315, kelvin: 6000, hdri: 'coast_overcast_spring', fog: 180, lut: 'coast_may' },
  water: { velocity: 0.25, angleDeg: 200, turbulence: 0.35, color: '#13403d' },
  shoreShallowWidth: 2.0,
  baseTerrain: 'water',
  terrain: [
    { type: 'poly', terrain: 'sand', points: ISLAND },
    { type: 'poly', terrain: 'grass', points: INTERIOR },
    // T10 the dirt tracks (no footprints): the S track through the W pass to the tank yard, and three spurs
    { type: 'path', terrain: 'ground', points: [[22, 114], [40, 108.5], [55, 111.5], [68, 108], [78.5, 90], [79.5, 75], [78, 66], [74, 57], [64, 55], [50, 58], [30, 62], [12, 72]], width: 4 },
    { type: 'path', terrain: 'ground', points: [[55, 111.5], [58, 119]], width: 4 },
    { type: 'path', terrain: 'ground', points: [[79.5, 75], [92, 68]], width: 4 },
    { type: 'path', terrain: 'ground', points: [[70, 105], [80, 97]], width: 4 },
  ],
  // art pass (step 3p road network, visual only: grid false keeps the layout's dirt tracks as the nav terrain):
  // rutted dirt on the supply track, concrete hardstands at the two garrison doors
  roads: [
    { id: 'supply_track', surface: 'dirt', points: [[22, 114], [40, 108.5], [55, 111.5], [68, 108], [78.5, 90], [79.5, 75], [78, 66], [74, 57], [64, 55],
      [50, 58], [30, 62], [12, 72]], width: 3.4, wear: 0.7, puddles: 0.4, weeds: 0.4, grid: false },
  ],
  pavements: [
    { id: 'pad_bar_n', surface: 'concrete', points: [[46.8, 65.2], [51.4, 65.2], [51.4, 71.8], [46.8, 71.8]], cracks: 0.5, weeds: 0.5, patches: 0.2, edge: 'ragged', grid: false },
    { id: 'pad_bar_s', surface: 'concrete', points: [[51.2, 107.1], [59.8, 107.1], [59.8, 109.6], [51.2, 109.6]], cracks: 0.5, weeds: 0.4, edge: 'ragged', grid: false },
  ],
  // field telephone net between the garrisons and the batteries, blackout lamps at the barracks doors, unit boards
  furniture: [
    { type: 'telegraph', points: [[48.5, 101.5], [63.5, 101], [73.5, 98.5]], spacing: 12, h: 6.5, wires: 2, block: false },
    { type: 'telegraph', points: [[84, 67.5], [79.5, 61.5], [70, 58.8], [60, 61.4], [48, 61.6], [38.5, 56.5]], spacing: 12, h: 6.5, wires: 2, block: false },
    { type: 'lamp', variant: 'wall_lamp', x: 51.45, z: 66.6, rot: Math.PI, hooded: true, block: false },
    { type: 'lamp', variant: 'wall_lamp', x: 57.7, z: 107.05, rot: Math.PI / 2, hooded: true, block: false },
    { type: 'floodlight', x: 47.5, z: 101.2, rot: deg(150), block: false },
    { type: 'sign', variant: 'wehrmacht', x: 17.6, z: 113.6, rot: deg(-30), text: 'SPERRGEBIET\nBETRETEN VERBOTEN', block: false },
    { type: 'sign', variant: 'wehrmacht', x: 49.6, z: 72.8, rot: Math.PI, text: 'KP.-GEF.STD.', block: false },
    { type: 'sign', variant: 'wehrmacht', x: 53.6, z: 116.6, rot: deg(-20), text: 'BTTR. LA RIVIERE', block: false },
  ],
  // vegetation tags for the vegetation pass (docs/vegetation.md §1 M14): Normandy coast in late May
  vegetation: { region: 'normandy_coast', month: 5, dune: ['marram', 'sea_kale', 'sea_rocket'], trees: ['oak', 'ash', 'elm'],
    shrubs: ['hawthorn', 'blackthorn', 'gorse'], meadow: ['cow_parsley', 'buttercup', 'red_campion'],
    farmland: { crops: 'none', orchards: 0.25 } }, // bocage fringe (art/terrain/bocage.js), clear of gameplay
  structures: STRUCTURES,
  items: [],
  interactables: [],
  vehicles: [
    // the team's rowboat off the SW beach (the escape vehicle); only the Marine rows; MG fire sinks it
    { id: 'boat', vehicleType: 'rowboat', label: 'Rowboat', x: 8, z: 204, heading: deg(0), seats: 5, operators: ['diver'] },
    // the empty Panzer II in the W of the N half [K][P][ooc]
    { id: 'pz2', vehicleType: 'panzer2', x: 9, z: 77, heading: deg(10), driveable: true, operators: ['driver'], seats: 5, weapons: ['tankMg'] },
    // five Gatling nests; the Driver may man one once its gunner is dead
    { id: 'mg1', vehicleType: 'mgNest', x: 88, z: 136, heading: deg(200), gunner: 'mg1g', driveable: true },
    { id: 'mg2', vehicleType: 'mgNest', x: 93, z: 91.5, heading: deg(120), gunner: 'mg2g', driveable: true },
    { id: 'mg3', vehicleType: 'mgNest', x: 93, z: 75.5, heading: deg(330), gunner: 'mg3g', driveable: true },
    { id: 'mg4', vehicleType: 'mgNest', x: 83.5, z: 52, heading: deg(300), gunner: 'mg4g', driveable: true },
    { id: 'mg5', vehicleType: 'mgNest', x: 60, z: 26, heading: deg(250), gunner: 'mg5g', driveable: true },
  ],
  // spawn marks on the SW beach's W end; the `start` trigger seats the whole team in the rowboat (dossier §7)
  commandos: [
    { role: 'greenberet', x: 2, z: 183, heading: deg(270), inventory: { knife: 1, pistol: 1, decoy: 1 } },
    { role: 'sniper', x: 3.5, z: 183.5, heading: deg(270), inventory: { pistol: 1, sniperRifle: 8 } },
    { role: 'diver', x: 5, z: 184, heading: deg(270), inventory: { knife: 1, pistol: 1, harpoon: 1, divingGear: 1 } },
    { role: 'sapper', x: 2.5, z: 185, heading: deg(270), inventory: { pistol: 1, bearTrap: 1, remoteBomb: 3 } },
    { role: 'driver', x: 4, z: 185.5, heading: deg(270), inventory: { pistol: 1, firstAid: 6 } },
  ],
  enemies: ENEMIES,
  zones: [{ id: 'z_wall', poly: Z_WALL, onSeen: 'RINT', onHeard: null, siren: true }],
  jails: [],
  barracks: BARRACKS,
  climbLinks: CLIMBS,
  ladders: LADDERS,
  triplines: [],
  objectives: [
    { id: 'o1', text: 'Destroy the four coastal guns', type: 'destroy', targets: [...GUNS], required: true },
    { id: 'o2', text: 'Get everyone into the boat and row out to the red buoy', type: 'escape', required: true, vehicleId: 'boat' },
  ],
  setpieces: [],
  triggers: [
    // the whole team starts aboard the rowboat, the Marine at the oars [P][K][eg][ooc]
    { on: 'start', do: [{ run: (w) => boardAll(w, 'boat') }] },
    // T1 [rec]: a blast inside the fortified line raises it ("anything suspect", K); beach blasts and accidents do not
    { on: 'explosion', once: false, when: (p, w) => !p.accident && w.alarm?.zoneAt?.(p.x, p.z)?.id === 'z_wall',
      do: [{ alarm: 'z_wall', cause: 'explosion' }] },
    // T2: which guns are down
    { on: 'structure:destroyed', match: { id: 'g1' }, do: [{ message: 'The gun above the south beach is out of action.', kind: 'info' }] },
    { on: 'structure:destroyed', match: { id: 'g2' }, do: [{ message: 'The gun above the east beach is out of action.', kind: 'info' }] },
    { on: 'structure:destroyed', match: { id: 'g3' }, do: [{ message: 'The turret gun is out of action.', kind: 'info' }] },
    { on: 'structure:destroyed', match: { id: 'g4' }, do: [{ message: 'The gun pit on the north shore is out of action.', kind: 'info' }] },
    // T3
    { on: 'objective', match: { id: 'o1', status: 'done' }, do: [{ message: 'All four guns are silenced. Everyone into the boat, then row for the red buoy.', kind: 'objective' }] },
    // losing the boat loses the way out (§8.1)
    // (playtest r_a3e) the wording follows who sank it: the M7 line only when the player did, a neutral one otherwise
    { on: 'vehicle:destroyed', match: { vehicle: 'boat' }, when: (p) => p.source?.faction === 'player',
      do: [{ fail: 'YOU DESTROYED THE BOAT, BUT YOU NEEDED IT TO ESCAPE.' }] },
    { on: 'vehicle:destroyed', match: { vehicle: 'boat' }, when: (p) => p.source?.faction !== 'player',
      do: [{ fail: 'THE BOAT WAS LOST, AND YOU NEEDED IT TO ESCAPE.' }] },
    // T4 [rec]: soft-lock, fewer charges left than guns standing
    { on: 'tick', when: (_p, w) => outOfCharges(w), do: [{ fail: 'YOU NO LONGER HAVE THE EXPLOSIVES TO DESTROY EVERY GUN.' }] },
  ],
  // art pass: the ridge and the rock spits keep their realistic `cliff` dressing (art/dressing.js rock massifs);
  // only the sand drift needs the script's ramp mesh
  script: m14Script({
    ramps: [RAMP_G2],
    hide: ['ramp_g2'],
  }),
  // the rowboat is on the map from the start; the exit counts once o1 is done and every living commando is aboard
  extraction: { vehicleId: 'boat', exit: { x: 122, z: 191, r: 6 }, spawnWhen: [] },
  alarmFail: null,
  // art pass: the Atlantic Wall assets are visuals only; roofs, ladders and climb links stay the layout's (§4.2, §7.1)
  libraryNav: false,
  par: { time: 900 },
  cameraStart: { x: 16, z: 190, zoom: 1 },
  startDisguised: [],
  flags: { shovel: false },
};
