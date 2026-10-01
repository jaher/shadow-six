/**
 * BEL Mission 11 — "In the Soup" (buildable layout: docs/missions/m11.md). Owned by MISSIONS.
 * Maradah oil field, south of El Agheila, Libya, 3 December 1942. The full team (GB, Sniper, Sapper, Driver and
 * the Spy, in uniform from the start) comes in on the W edge. Four drilling rigs must fall (o_rigs): two in the
 * walled inner yard and the E valley (remote bombs), two in a sealed quarry nobody can enter (fuel: the shuttling
 * tanker, three barrels, an explosive process tank). Three garrisons each answer only their own zone: the SW camp
 * barracks (siren), the central sandbag bunker (silent) and the N HQ behind the tunnel (silent; its half-track
 * comes through the bore on a northern alarm unless the tunnel has been brought down). The escape is the vacant
 * SdKfz 251 in the E valley, driven out through gate 1 and up the W road to the W edge (o_escape).
 *
 * Conventions: headings/rot in DEGREES in the dossier, converted with deg(); route `look` and `post.sweep` stay in
 * degrees (0 = E, 90 = S, 180 = W, 270 = N). Raised positions already carry the dossier's §4.1 shift.
 * Briefing text is our own wording (§7.3).
 *
 * Deviations from the dossier (grid fit / engine; see scripts/m11.js and the commit message):
 *  - levels are `walkways` strips (D3 fallback); the W road is three stepped ramp legs (y 0 → 2.4 → 4.6 → 6);
 *    the exit circle sits on the plateau at (1.5, 41) so a hull on the floor below the scarp cannot "exit";
 *  - heardLocal (D1) zones and the 45 m `explosionPull` (D2) are engine options; the half-tracks' ramp/plateau
 *    driving (D3/D9) is a mission-local runtime patch; D4 (hull MG elevation limit: a hull gun fires down from its own height, never
 *    up onto a roof) and D11 are the engine's;
 *  - the quarry's S rim is a one-cell LOW lip under the ridge (the 6 m drop seals the pit), so the ridge overlooks
 *    the pit floor for the ridge shots;
 *  - the explosive quarry tanks are `barrels`-class structures (the only explosive structure the schema allows);
 *  - rigs use a 6.5 × 6.5 m block (derrick base) so the tanker lane clears them; the tanker's W stop is (72, 38.5)
 *    and its E stop (96, 32) (±1.5 m rule, §6.1); ld_mesa sits 1.7 m S of the dossier spot so its top is on
 *    the mesa; the mesa runs to the E edge (no strip past it); the hedgehogs stand at the foot of the mesa rim;
 *  - wall_diag ends inside the mesa and wire_sw inside barracks_sw (no gaps); yard bushes moved off the road;
 *  - shed_m moved onto the mesa top (94, 111); e7 and e_hq2 nudged off footprints; the burnt lorry stands on the
 *    ridge's scarp side (64.5, 60.4) so the half-track can drive the ridge road over the quarry (Prima's exit loop).
 */

import {
  PLATEAU_Y, MESA_Y, ROOF_Y, EXPLOSION_PULL, levelStrips, rectPoly, segmentHoles, rampWalkways, m11Script, m11Tick, rigsImpossible, tunnelRubble,
  rampJointPads,
} from './scripts/m11.js';

import { joinStructures } from './schema.js';
const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (§4.1)
const Y = PLATEAU_Y;

// ---------------------------------------------------------------- terrain shapes (dossier §4)
/** T2 the rock wall along the N edge (scenery). */
const N_RIM = [[0, 0], [58, 0], [58, 13], [0, 13]];
/** T3 the N plateau (y 6): NW desert, the tunnel loop and the narrow ridge (x 57–100, z 53–62). */
const N_PLATEAU = [[0, 13], [44, 13], [44, 20], [46, 26], [50, 29.5], [54, 29.5], [57, 27], [58, 30], [58, 50], [57, 53], [100, 53],
  [100, 62], [62, 62], [57, 58], [50, 57], [33, 53], [18, 52], [10, 46], [0, 46]];
/** T4 the rock mass the tunnel pierces. */
const TUNNEL_ROCK = [[44, 13], [58, 13], [62, 20], [60, 27], [58, 30], [57, 27], [54, 29.5], [50, 29.5], [46, 26], [44, 20]];
/** T5 + T6 the HQ plateau (y 6), joined to the N plateau only through the tunnel. */
const HQ_PLATEAU = [[58, 0], [101, 0], [101, 27], [60, 27], [62, 20], [58, 13]];
/** T7 the quarry's hidden walls (W, S under the ridge, E strip): no walkable link into the pit. */
const QUARRY_W = [[58, 27], [60, 27], [60, 53], [58, 53]];
/** The quarry's S rim under the ridge: a one-cell LOW lip (sight passes; the 6 m drop already seals the pit) so
 * the ridge overlooks the pit floor: pistol → brl_q3, the half-track's MG → the tanker [P][K][NL][DE]. */
const QUARRY_S = [[58, 52.5], [101, 52.5], [101, 53], [58, 53]];
const QUARRY_E = [[100, 27], [101, 27], [101, 62], [100, 62]];
/** T10 the start spur, T11 the SE mesa (y 4), T12 the gate-2 rocks, T13 the oil crater. */
const SPUR = [[3, 72], [9, 72], [15.5, 68], [16.5, 76], [15, 86], [10, 91], [4, 86], [3, 80]];
const MESA = [[70, 94], [74, 92], [87, 103], [101, 112], [101, 126], [90, 122], [80, 118], [70, 112], [67, 104]];
const ROCKS_G2 = [[58, 88], [70, 94], [67, 104], [62, 96], [57, 95]];
const CRATER = [[30, 96], [39, 94], [47, 95], [50, 99], [50, 110], [44, 114], [35, 113], [30, 108]];
/** The tunnel bore (y 6) from the S portal on the loop to the N portal on the HQ plateau, and its collapse area. */
const BORE = { a: [52.6, 31], b: [62.4, 14], width: 4 };
export const TUNNEL_POLY = [[50, 29.5], [55.2, 32.5], [65, 15.5], [59.8, 12.5]];

/** T9 the W road: three ramp legs from gate 1's forecourt up round the scarp's W end to the plateau. */
const RAMPS = [
  { a: [16.5, 57, 0], b: [8, 56.5, 2.4], width: 5, steps: 6 },
  { a: [8, 56.5, 2.4], b: [3, 50.5, 4.6], width: 5, steps: 6 },
  { a: [3, 50.5, 4.6], b: [4, 44.5, 6], width: 5, steps: 4 },
];
const RAMP_PADS = rampJointPads(RAMPS);

// ---------------------------------------------------------------- props standing on raised levels (holes + lift)
const flagpole = (id, x, z) => ({ id, type: 'sign', variant: 'flagpole_german', x, z, rot: 0, w: 0.3, d: 0.3, h: 6, block: 0 });
const scrub = (id, x, z) => ({ id, type: 'bush', variant: 'scrub_desert', x, z, r: 0.9 });
const WRECK_R = { id: 'wreck_r', type: 'crates', variant: 'truck_flatbed_burnt', label: 'Burnt-out lorry', x: 64.5, z: 60.4, rot: deg(8), w: 7, d: 2.5, h: 2.2, block: 2 };
const HQ_N = { id: 'hq_n', type: 'barracks', variant: 'hq_domed_terraced', label: 'Headquarters', x: 84.5, z: 17.5, rot: 0, w: 9, d: 8, h: 7, mat: 'plaster',
  flag: true, garrison: true, destructible: true, destroyedBy: ['explosion'], hp: 100, door: deg(90) };
const DRUMS_HQ = [[97.4, 14.3], [96.3, 16.3], [95.2, 18.6]].map(([x, z], k) => ({ id: `drums_hq${k + 1}`, type: 'barrels', variant: 'fuel_drum_stack', x, z, r: 0.35, h: 0.9, block: 1 }));
const SHED_M = { id: 'shed_m', type: 'hut', variant: 'shed_timber_long', label: 'Lean-to', x: 94, z: 111, rot: deg(-30), w: 7, d: 4, h: 3, mat: 'planks', block: 2 };
const PLATEAU_PROPS = [WRECK_R, HQ_N, ...DRUMS_HQ, flagpole('flag_c', 57, 55.5), flagpole('flag_hq', 88.5, 12.5), scrub('bush_n1', 7, 17), scrub('bush_n2', 20, 30), scrub('bush_n3', 41, 30)];
const MESA_PROPS = [SHED_M];
/** Holes (footprints of props on a level, so they keep their block). */
const holeOf = (s) => (s.w != null && s.d != null ? { poly: rectPoly(s.x, s.z, s.w, s.d, s.rot ?? 0) } : { x: s.x, z: s.z, r: s.r ?? 0.5 });

// ---------------------------------------------------------------- the four rigs and the fuel (dossier §5.3–§5.5)
/** A drilling rig: o_rigs target. Bomb (3 m of the skid), barrel / tanker blast, or grenade (eggie) fells it. */
const rig = (id, x, z) => ({ id, type: 'drilling_rig', variant: 'drilling_rig', label: 'Drilling rig', x, z, rot: 0, w: 6.5, d: 6.5, h: 22,
  destructible: true, destroyedBy: ['explosion'], hp: 100, grenadeDestructible: true });
const RIGS = [rig('rig_w', 30.5, 89), rig('rig_e', 95, 81.5), rig('rig_nw', 80, 33), rig('rig_ne', 91, 40)];
/** Loose explosive drums (§3.8 row 11: five on site): two at the camp's S edge, three by rig_ne. */
const drum = (id, x, z, extra = {}) => ({ id, type: 'barrels', variant: 'fuel_explosive', x, z, r: 0.3, h: 0.9, explosive: 'barrel', carriable: true, destructible: true, hp: 1, ...extra });
const BARRELS = [drum('brl_s1', 35, 150), drum('brl_s2', 37.7, 150), drum('brl_q1', 94.2, 36), drum('brl_q2', 95.2, 37), drum('brl_q3', 95, 41.5)];
/** The quarry's two white process tanks: a round or a blast bursts them like a barrel (fallback for rig_nw, §12 #23). */
const qTank = (id, x, z) => ({ id, type: 'barrels', variant: 'oil_tanks_vertical', label: 'Oil tank', x, z, rot: 0, r: 1.75, h: 7,
  explosive: 'barrel', carriable: false, destructible: true, hp: 1 });
/** The yard's three tanks (inert: an explosive one 5.6 m from rig_w would break the 3-charge budget, §5.4). */
const wTank = (id, x, z) => ({ id, type: 'fueltank', variant: 'oil_tanks_vertical', label: 'Oil tank', x, z, rot: 0, r: 1.75, h: 7, mat: 'whitePaint',
  destructible: true, destroyedBy: ['explosion'], hp: 100 });

// ---------------------------------------------------------------- buildings, walls, cover
/** An enterable house; `door` is the world point [x, z] in front of its door (dossier §5; the door interactable). */
const flat = (id, variant, x, z, w, d, h, door, rot = 0, extra = {}) => ({ id, type: 'flat_roof_house', variant, x, z, rot: deg(rot), w, d, h, mat: 'plaster',
  roofWalk: false, enterable: true, door, ...extra });
const tent = (id, x, z) => ({ id, type: 'tent', variant: 'tent_pyramid_desert', x, z, rot: 0, w: 6, d: 5, h: 3 });
const hedgehog = (id, x, z) => ({ id, type: 'crates', variant: 'czech_hedgehog', x, z, rot: deg(45), w: 1.4, d: 1.4, h: 1.2, block: 1 });
const wall = (id, points) => ({ id, type: 'wall', variant: 'wall_ruined_stone', mat: 'stone', points, h: 3.5, width: 1.2 });
const wire = (id, points) => ({ id, type: 'fence', variant: 'concertina_hedgehog', points, h: 1.5 });
const palm = (id, x, z, k) => ({ id, type: 'palm', variant: 'date_palm', x, z, r: 0.35, h: 6 + k, seed: 1101 + k });

const STRUCTURES = [
  // --- terrain: rock masses first, then the raised levels (their strips clear the block they overlap), ramps last
  { id: 'rim_n', type: 'cliff', variant: 'rock_wall', points: N_RIM, h: 12, block: 2 },
  { id: 'tunnel_rock', type: 'cliff', variant: 'rock_mass', points: TUNNEL_ROCK, h: 10, block: 2 },
  { id: 'quarry_w', type: 'cliff', variant: 'quarry_face', points: QUARRY_W, h: Y, block: 2 },
  { id: 'quarry_s', type: 'cliff', variant: 'quarry_face', points: QUARRY_S, h: 0.8, block: 1 },
  { id: 'quarry_e', type: 'cliff', variant: 'quarry_face', points: QUARRY_E, h: Y, block: 2 },
  { id: 'spur_start', type: 'cliff', variant: 'rock_outcrop_desert', points: SPUR, h: 4, block: 2 },
  { id: 'rocks_g2', type: 'cliff', variant: 'rock_outcrop_desert', points: ROCKS_G2, h: 5, block: 2 },
  { id: 'crater', type: 'cliff', variant: 'oil_crater', label: 'Oil crater', points: CRATER, h: 0.3, block: 1 },
  { id: 'plateau_n', type: 'cliff', variant: 'plateau_top', points: N_PLATEAU, h: Y, block: 2,
    walkways: levelStrips(N_PLATEAU, [...PLATEAU_PROPS.filter((s) => s.z > 27 || s.x < 58).map(holeOf), { poly: rectPoly(50.5, 61, 13, 8) }, { poly: TUNNEL_ROCK }], Y) },
  { id: 'plateau_hq', type: 'cliff', variant: 'plateau_top', points: HQ_PLATEAU, h: Y, block: 2,
    walkways: levelStrips(HQ_PLATEAU, [...[HQ_N, ...DRUMS_HQ].map(holeOf), { poly: TUNNEL_ROCK }], Y) },
  { id: 'mesa_se', type: 'cliff', variant: 'plateau_top', points: MESA, h: MESA_Y, block: 2, walkways: levelStrips(MESA, MESA_PROPS.map(holeOf), MESA_Y) },
  { id: 'tunnel', type: 'road', variant: 'tunnel_bore', label: 'Tunnel', points: [BORE.a, BORE.b], width: BORE.width,
    walkways: [{ id: 'bore', points: [BORE.a, BORE.b], width: BORE.width, y: Y }] },
  // the bends' outer corners (fix round 2): flat pads first, so the ramp steps overwrite the cells they share
  ...RAMP_PADS.map((p, k) => ({ id: `ramp_pad${k + 1}`, type: 'road', variant: 'road_cut', points: [p.a, p.b], width: p.width,
    walkways: [{ points: [p.a, p.b], width: p.width, y: p.y }] })),
  ...RAMPS.map((r, k) => ({ id: `ramp_w${k + 1}`, type: 'road', variant: 'road_cut', points: [r.a.slice(0, 2), r.b.slice(0, 2)], width: r.width,
    walkways: rampWalkways(r.a, r.b, r.width, r.steps) })),
  // --- the tunnel portals (arched faces drawn by the script; the placeholder boxes are hidden, no block)
  { id: 'tunnel_s', type: 'ruins', variant: 'tunnel_portal', label: 'Tunnel', x: 53.4, z: 29.7, rot: deg(120), w: 10, d: 1, h: 7, block: 0 },
  { id: 'tunnel_n', type: 'ruins', variant: 'tunnel_portal', label: 'Tunnel', x: 60.5, z: 17.3, rot: deg(300), w: 10, d: 1, h: 7, block: 0 },
  // --- N plateau / HQ plateau props (lifted to y 6)
  ...PLATEAU_PROPS,
  // --- the quarry (floor, sealed): the N rigs, the explosive tanks, the barrels by rig_ne
  RIGS[2], RIGS[3], qTank('tank_q1', 68, 35), qTank('tank_q2', 73.5, 29.8), ...BARRELS.slice(2),
  // --- the inner yard: central bunker (garrison, walkable roof), rig_w, its tanks, the windpump, houses
  { id: 'bunker_c', type: 'flat_roof_house', variant: 'bunker_sandbag_timber', label: 'Bunker', x: 50.5, z: 61, rot: 0, w: 13, d: 8, h: ROOF_Y,
    roofY: ROOF_Y, roofWalk: true, mat: 'sandbag', flag: true, garrison: true, destructible: true, destroyedBy: ['explosion'], hp: 100, bombOnly: true, door: deg(90) },
  RIGS[0], wTank('tank_w1', 16, 87), wTank('tank_w2', 22, 82), wTank('tank_w3', 28, 76),
  { id: 'windpump', type: 'radio_mast', variant: 'windpump', label: 'Wind pump', x: 39, z: 79, rot: 0, w: 3, d: 3, h: 9, block: 1 },
  flat('house_y', 'house_whitewash_flat', 40, 87, 10, 8, 4, [41.4, 91], -20),
  { id: 'dugout_y', type: 'hut', variant: 'dugout', label: 'Dugout', x: 62, z: 84.5, rot: 0, w: 4.5, d: 4, h: 2, mat: 'sandbag', enterable: true, door: [62, 86.6] },
  { id: 'drums_y', type: 'barrels', variant: 'fuel_drum_stack', x: 51.5, z: 101.5, rot: 0, w: 2, d: 1.2, h: 1.8, block: 2 },
  ...[[31, 68], [44, 76], [58, 82], [40, 58.5]].map(([x, z], k) => scrub(`bush_y${k + 1}`, x, z)),
  // --- gate 1 (W wall), the diagonal wall with arch_e, the S wall with gate 2 (5.5–6.4 m gaps: the half-track
  //     drives through on one click, arch_e along the road at z ≈ 72)
  wall('wall_w1', [[15.6, 68.6], [23.2, 59.8]]), wall('wall_w2', [[27, 55.6], [28, 54.5], [33, 52.5], [34, 52.2]]),
  wall('wall_diag1', [[62, 57], [66.8, 68.9]]), wall('wall_diag2', [[69.2, 74.8], [74.5, 88], [73.5, 92.8]]),
  wall('wall_s1', [[41, 117], [56.9, 108.9]]), wall('wall_s2', [[61.3, 105.6], [62, 105], [67, 102.5]]),
  { id: 'tower_s', type: 'ruins', variant: 'wall_ruined_stone_tower', x: 68.5, z: 103, rot: 0, w: 3, d: 3, h: 5, block: 2 },
  // --- the E valley: the house by the half-track, rig_e, the Gatling nest, "the rock", hedgehogs under the mesa rim
  flat('house_e', 'hq_domed_terraced', 81.5, 67.5, 9, 7, 5, [82, 71.2]),
  RIGS[1],
  { id: 'mg_e_pit', type: 'sandbags', variant: 'mg_nest_sandbag', x: 80, z: 87.7, rot: deg(240), ring: { r: 2 }, h: 1.0, block: 1 },
  { id: 'rock_e', type: 'rocks', variant: 'rock_outcrop_desert', x: 84.5, z: 91, rot: 0, w: 3.5, d: 2.5, h: 2.2, block: 2 },
  ...[[74.5, 91], [77, 93.5], [79.5, 95.5], [82, 97.5], [84.2, 99.2], [90, 104], [93, 106.3], [96, 108.2]].map(([x, z], k) => hedgehog(`hh_mesa${k + 1}`, x, z)),
  ...[[74, 64], [90, 64], [95, 66], [99, 72], [60, 86]].map(([x, z], k) => scrub(`bush_e${k + 1}`, x, z)),
  // --- the SE mesa top (y 4)
  ...MESA_PROPS,
  // --- the S lowlands: the little building (the Sniper's post), crates, the rocky hollow
  flat('house_l', 'house_whitewash_flat', 62.5, 126, 5, 6, 3.5, [59.9, 126]),
  { id: 'crates_s', type: 'crates', variant: 'crate_stack', x: 56, z: 118, rot: 0, w: 4, d: 4, h: 2, block: 2 },
  { id: 'pit_se', type: 'crater', variant: 'crater_rocky', x: 78, z: 136, r: 4, h: 0.5, block: 1 },
  ...[[46, 125.3], [51.8, 126.5], [57, 131], [68, 143], [72, 112], [73, 120]].map(([x, z], k) => scrub(`bush_s${k + 1}`, x, z)),
  // --- the S camp: the flagged barracks (garrison), the big house, the small house, tents, water tower, barrels
  { id: 'barracks_sw', type: 'barracks', variant: 'barracks_desert', label: 'Barracks', x: 37.5, z: 119.5, rot: 0, w: 9, d: 8, h: 5, mat: 'plaster',
    flag: true, garrison: true, destructible: true, destroyedBy: ['explosion'], hp: 100, door: deg(180) },
  flat('house_a', 'hq_domed_terraced', 26, 124.5, 10, 12, 6, [31.3, 127]),
  flat('house_w', 'house_whitewash_flat', 7, 102, 6, 6, 3.5, [7.8, 105.2], -15),
  { id: 'water_tower', type: 'fueltank', variant: 'water_tower_legs', label: 'Water tower', x: 38, z: 132, rot: 0, r: 2, h: 10, block: 1 },
  tent('tent_1', 10.5, 113), tent('tent_2', 15, 119.5), tent('tent_3', 7.5, 136), tent('tent_4', 16.5, 143), tent('tent_5', 28, 143),
  // the camp's E edge: stores tents and crate stacks screen it from the S lowlands (the road passes between), so
  // Phase 1 can be played out of sight of e16, e19 and Patrol 14 [P Phase 1]
  tent('tent_6', 47.5, 129.5), tent('tent_7', 47.5, 142.5),
  { id: 'crates_c1', type: 'crates', variant: 'crate_stack', x: 46.5, z: 133.7, rot: 0, w: 3, d: 3.8, h: 2, block: 2 },
  { id: 'crates_c4', type: 'crates', variant: 'crate_stack', x: 43.5, z: 125, rot: 0, w: 2.4, d: 2.6, h: 2, block: 2 }, // SE corner of barracks_sw
  { id: 'crates_c3', type: 'crates', variant: 'crate_stack', x: 51.5, z: 137.8, rot: 0, w: 2.6, d: 4, h: 2.2, block: 2 }, // the road doglegs round it
  { id: 'crates_c2', type: 'crates', variant: 'crate_stack', x: 46.5, z: 148, rot: 0, w: 3, d: 3, h: 2, block: 2 },
  BARRELS[0], BARRELS[1],
  wire('wire_sw', [[3.4, 83.5], [10, 93], [18, 103], [25, 110.5], [32, 115], [33.8, 116.2]]),
  palm('palm_1', 4.8, 90.5, 0), palm('palm_2', 6.5, 95.5, 1), palm('palm_3', 12, 97.8, 2),
  ...[[21, 105], [24, 108], [46, 123], [42.8, 127.2]].map(([x, z], k) => scrub(`bush_sw${k + 1}`, x, z)),
];

// ---------------------------------------------------------------- enemies (dossier §8; `prima` = Prima's number)
const sentry = (id, prima, x, z, h, sweep, extra = {}, flags = {}) => ({ id, ...(prima ? { prima } : {}), soldierType: 'sentry', x, z, heading: deg(h),
  flags: { investigates: true, ...flags }, post: { heading: deg(h), sweep, period: 10 }, ...extra });
const walker = (id, prima, type, pts, extra = {}, flags = {}) => {
  const [a, b] = pts;
  return { id, ...(prima ? { prima } : {}), soldierType: 'soldier', x: a.x, z: a.z, heading: Math.atan2(b.z - a.z, b.x - a.x),
    flags: { investigates: true, ...flags }, route: { type, vel: 1.0, points: pts }, ...extra };
};
/** A three-man patrol (sergeant + 2 troopers, one column) on a LOOP at vel 1.1; `trail` = the troopers' spawn offsets. */
const patrol = (key, prima, pts, trail, extra = {}) => {
  const route = { type: 'LOOP', vel: 1.1, points: pts };
  const lead = pts[0], next = pts[1];
  const h = Math.atan2(next.z - lead.z, next.x - lead.x);
  const squad = { id: `pat${key}`, leader: `s${key}`, columns: 1 };
  return [
    { id: `s${key}`, prima, soldierType: 'sergeant', x: lead.x, z: lead.z, heading: h, flags: { investigates: true }, squad, route, ...extra },
    ...trail.map(([x, z], k) => ({ id: `t${key}${'ab'[k]}`, prima, soldierType: 'trooper', x, z, heading: h, flags: { investigates: true }, squad, route, ...extra })),
  ];
};
const UP = { y: Y }, ON_MESA = { y: MESA_Y }, ROOF = { y: ROOF_Y, elevated: true };

const ENEMIES = [
  // ===== Phase 1: the S camp (L0), Prima 1–13
  walker('e1', 1, 'PINGPONG', [P(1.5, 91, 3, 0), P(2.5, 104, 3, 90)]), // the W-edge path past house_w
  walker('e2', 2, 'PINGPONG', [P(9.5, 97.5, 3, 270), P(15, 104, 3, 45)]),
  walker('e3', 3, 'PINGPONG', [P(8, 109, 2, 180), P(20, 108, 2, 0)]),
  sentry('e4', 4, 8.5, 107.5, 250, 50),
  sentry('e5', 5, 19, 108.5, 90, 45),
  walker('e6', 6, 'PINGPONG', [P(19.5, 112, 3, 0), P(19.5, 130, 3, 90)], {}, { followsTracks: true }), // reads the GB's tracks
  sentry('e7', 7, 19.3, 121.5, 90, 40), // E of tent_2: a body behind that tent is out of every cone
  walker('e8', 8, 'PINGPONG', [P(12, 126, 3, 0), P(11.5, 140, 4, 90)]),
  walker('e9', 9, 'PINGPONG', [P(3, 139.5, 3, 270), P(12, 146, 3, 0)]),
  walker('e10', 10, 'PINGPONG', [P(23.5, 138.5, 3, 90), P(20.5, 147, 3, 180)]),
  walker('e11', 11, 'PINGPONG', [P(27.5, 132, 3, 270), P(34, 138, 3, 90)]),
  walker('e12', 12, 'PINGPONG', [P(35, 129, 4, 90), P(44, 134, 4, 0)]), // round the water tower
  // Patrol 13 passes barracks_sw's W wall at (32, 119): where the first barrel goes
  ...patrol('13', 13, [P(17, 114), P(29.5, 116.8, 2, 90), P(32, 119), P(33, 128), P(30, 137, 3, 90), P(21, 147), P(8, 147, 3, 270), P(4, 130), P(5.5, 118)],
    [[15.5, 114], [14, 114]]),

  // ===== Phase 2: the S lowlands, gate 2 and the SE mesa, Prima 14–20, 27
  ...patrol('14', 14, [P(72, 127.5), P(66.5, 133), P(56, 140.5, 3, 90), P(53, 133, 3, 270), P(57, 134), P(66, 140), P(80, 145, 3, 0), P(90, 138), P(81, 129.5)],
    [[70.5, 127.5], [69, 127.5]]),
  sentry('e15', 15, 79, 115.5, 160, 40, ON_MESA, { holdsPost: true, investigates: false }), // watches house_l and the road
  walker('e16', 16, 'PINGPONG', [P(56, 148, 3, 20), P(76, 148, 3, 0)]),
  sentry('e17', 17, 59.5, 109.8, 90, 45), // gate 2, outside
  walker('e18', 18, 'PINGPONG', [P(84, 130, 3, 270), P(96, 146, 3, 0)]),
  walker('e19', 19, 'PINGPONG', [P(51, 124.5, 3, 30), P(54.5, 115, 3, 300)]), // S of wall_s1, facing the lowlands
  walker('e20', 20, 'PINGPONG', [P(88.5, 106, 4, 90), P(93, 117, 4, 90)], ON_MESA),
  sentry('e27', 27, 63.8, 109, 60, 30),

  // ===== Phase 3: the E valley, Prima 21–24
  walker('e21', 21, 'PINGPONG', [P(80.5, 82, 3, 180), P(87.5, 97.5, 3, 45)]), // past the rock and the mesa ladder
  { id: 'e22', prima: 22, soldierType: 'mg', x: 80, z: 87.7, heading: deg(240), emplacement: 'mg_e', post: { heading: deg(240), sweep: 60, period: 12, giro: 180 } },
  sentry('e23', 23, 82, 73.5, 140, 50, {}, { holdsPost: true, investigates: false }), // sees the Gatling and the arch
  sentry('e24', 24, 70.8, 74.5, 180, 70, {}, { followsTracks: true }),

  // ===== Phase 4: the inner yard and the bunker roof (y 3.5), Prima 25, 26, 28, 29
  walker('e25', 25, 'PINGPONG', [P(45.5, 58.5, 3, 90), P(55.5, 58.5, 3, 90)], ROOF, { holdsPost: true }),
  sentry('e26', 26, 52, 63.5, 90, 60, ROOF, { holdsPost: true, investigates: false }),
  ...patrol('28', 28, [P(48, 67.5), P(60, 70, 3, 0), P(63, 80), P(56, 92, 3, 90), P(47.5, 93), P(46.5, 80, 3, 180), P(36, 70)], [[46.5, 68], [45, 68.5]]),
  walker('e29', 29, 'PINGPONG', [P(54, 69, 3, 90), P(55, 99, 3, 270)]),
  sentry('e_g1', null, 26.8, 62.5, 30, 40), // inside gate 1 (the map shows him; no walkthrough names him)

  // ===== the N plateau, the ridge and the HQ plateau (y 6), Prima 30, 31 + the two HQ men
  ...patrol('30', 30, [P(6, 28), P(22, 38), P(35, 35, 3, 0), P(46, 42), P(50, 48, 3, 90), P(40, 50, 3, 90), P(22, 50, 3, 90), P(8, 42)],
    [[5.5, 26.5], [5, 25]], UP),
  walker('e31', 31, 'PINGPONG', [P(69.5, 57, 4, 90), P(97, 57, 4, 90)], UP), // the lone guard on the narrow ridge
  walker('e_hq1', null, 'PINGPONG', [P(64, 24, 4, 90), P(84, 25, 4, 90)], UP), // watches the ridge across the quarry
  sentry('e_hq2', null, 81, 23.2, 90, 60, UP),
];

// ---------------------------------------------------------------- zones (§9): the whole map, three local alarms
const Z_SW = [[0, 72], [3.4, 83.5], [18, 103], [32, 115], [41, 117], [45, 125], [50, 153], [0, 153]];
const Z_C = [[0, 46], [10, 46], [18, 52], [33, 53], [57, 57], [60, 62], [101, 62], [101, 153], [50, 153], [45, 125], [41, 117], [32, 115], [18, 103], [3.4, 83.5], [0, 72]];
const Z_N = [[0, 0], [101, 0], [101, 62], [60, 62], [57, 57], [33, 53], [18, 52], [10, 46], [0, 46]];

// ---------------------------------------------------------------- garrisons (§9; exit 2.7 m/s, loops 1.8 m/s)
const squad = (event, exitRoute, loop) => ({ event, size: 3, exitVel: 2.7, exitRoute, loopVel: 1.8, loop });
const BARRACKS = {
  barracks_sw: { pool: 6, squads: [
    squad('RINT', [P(28, 117)], [P(28, 117), P(14, 109), P(6, 128), P(14, 147.5), P(32, 140), P(36, 128)]),
    squad('RINT', [P(40, 127)], [P(40, 127), P(46, 136), P(60, 140), P(68, 126), P(58, 114), P(44, 124)]),
  ] },
  bunker_c: { pool: 9, squads: [
    squad('EV_C', [P(52, 72)], [P(52, 72), P(36, 72), P(46, 80), P(54, 92), P(58, 78)]), // the yard
    squad('EV_C', [P(62, 73), P(72, 69.5), P(78, 78)], [P(78, 78), P(90, 86), P(86, 95.5), P(76, 84)]), // through arch_e: the E valley
    squad('EV_C', [P(55, 100), P(59.5, 104), P(60, 110), P(62, 114)], [P(62, 114), P(70, 130), P(56, 140), P(46, 128)]), // gate 2, the lowlands
  ] },
  hq_n: { pool: 6, squads: [
    // through the tunnel onto the loop (cut once the tunnel has fallen: the squad stops at the rubble)
    squad('EV_N', [P(70, 15), P(62, 15), P(53, 30.5), P(50, 36)], [P(50, 36), P(35, 35), P(22, 40), P(40, 48), P(56, 55), P(80, 57)]),
    squad('EV_N', [P(80, 25)], [P(66, 24), P(95, 26)]), // the quarry's N rim: fires across the pit at the ridge
  ] },
};

/** Structure meshes standing on a raised level (lifted by the script). */
const LIFT = [...PLATEAU_PROPS.map((s) => [s.id, Y]), ...MESA_PROPS.map((s) => [s.id, MESA_Y])];

export default {
  id: 'm11',
  campaign: 'BEL',
  title: 'In the Soup',
  subtitle: 'Maradah oil field, Libya · 3 December 1942',
  date: '1942-12-03',
  place: 'Maradah oil field, south of El Agheila, Libya',
  theater: 'desert',
  coneColors: 'desert',
  size: [101, 153],
  seed: 1942_1203,
  briefing: {
    historical: 'December 1942. Out of Tunisia the Axis is hitting back hard. While the armies grind against each other, small Allied parties are to slip into the corner of Libya the enemy still holds, cut his supply lines and find out how strong Rommel really is. Your target is the oil field at Maradah, south of El Agheila. Wreck its drilling rigs and Berlin will have to send whole divisions south just to guard what is left.',
    text: 'You come in on the western edge of the field. Four drilling rigs are pumping out there: every one of them has to come down. When they are burning, get out along the dirt road to the west. There is an armoured half-track standing in the eastern valley, and you may well need to borrow it. That is all. Good luck.',
    objectivesSummary: 'Bring down all four drilling rigs, then take the half-track out along the west road.',
    hints: [
      'Bring the tunnel down and nothing from the north can get at you.',
      'With all four rigs burning, take the half-track and leave by the north-west road.',
      'Two of the rigs stand in a quarry no one can climb into. Fuel will have to do the work.',
      'Anyone who sees you, anywhere on this map, will raise the alarm, but each garrison only answers for its own ground.',
      'The men on the bunker roof are out of reach of the half-track\'s gun.',
    ],
  },
  lighting: { sunElevDeg: 58, sunAzimuthDeg: 180, kelvin: 5200, hdri: 'desert_clear_noon', fog: 200, lut: 'desert_noon' },
  water: null,
  baseTerrain: 'sand',
  terrain: [
    // T7 the oil-stained quarry floor; T14–T17 dirt roads (the W ramp and the plateau roads are drawn by the script)
    { type: 'poly', terrain: 'ground', points: [[60, 27], [100, 27], [100, 50], [60, 50]] },
    { type: 'path', terrain: 'road', points: [[26, 57], [35, 62], [50, 70], [62, 74], [67.6, 71], [78, 77], [88, 78]], width: 4 },
    { type: 'path', terrain: 'road', points: [[52, 70], [54, 100], [59.5, 107]], width: 4 },
    { type: 'path', terrain: 'road', points: [[0, 122], [20, 131], [40, 137], [48.5, 138], [52, 141.5], [57, 140.5], [66, 132], [68, 120], [59.5, 107]], width: 4 },
    { type: 'path', terrain: 'road', points: [[66, 132], [72, 140], [66, 153]], width: 4 },
    { type: 'path', terrain: 'road', points: [[16.5, 57], [26, 57]], width: 5 },
    { type: 'path', terrain: 'road', points: [[4, 44.5], [12, 42], [22, 38], [35, 35], [44, 38], [50, 34], [54, 40], [50, 45], [44, 43]], width: 5 },
    { type: 'path', terrain: 'road', points: [[50, 45], [58, 56], [96, 57]], width: 5 },
    { type: 'path', terrain: 'road', points: [[62, 15], [70, 15], [78, 17], [86, 23]], width: 4 },
  ],
  // placement rule (c): deliberate compound joins (wings, towers, party walls) — joinStructures
  structures: joinStructures(STRUCTURES, [['rig_w', 'house_y']]),
  items: [],
  interactables: [],
  vehicles: [
    // the vacant SdKfz 251 (HUD "SdKfz 251"): the escape vehicle; seats all five; the Driver's MG for Phases 4–5
    { id: 'ht_ours', vehicleType: 'sdkfz', variant: 'sdkfz251_desert', label: 'SdKfz 251', x: 90, z: 72, heading: deg(180), driveable: true, operators: ['driver'], seats: 10 },
    // the SdKfz on standby on the HQ plateau (y 6): comes through the tunnel on a northern alarm (trigger below)
    { id: 'ht_n', vehicleType: 'sdkfz', variant: 'sdkfz251_desert', label: 'SdKfz 251', x: 76, z: 11.5, heading: deg(180), behavior: 'standby',
      crew: [{ id: 'htn_d', soldierType: 'crew' }, { id: 'htn_g', soldierType: 'crew' }] },
    // the Opel Blitz fuel truck shuttling in the sealed quarry; any hit blows it up (vehicle + barrel blast, §3.6).
    // At W_mid (88.5, 33.8) it is within reach of both N rigs and brl_q1 [P][K]; at the W stop only rig_nw [DE]
    { id: 'tanker', vehicleType: 'opel_blitz_tanker', variant: 'opel_blitz_tanker_desert', label: 'Fuel truck', x: 72, z: 38.5, heading: deg(0), driveable: false,
      crew: [{ id: 'tank_drv', soldierType: 'truckDriver' }],
      route: { type: 'PINGPONG', speed: 2.5, points: [
        { x: 72, z: 38.5, wait: 10 }, { x: 76, z: 39 }, { x: 84.5, z: 39 }, { x: 86, z: 35.8 },
        { x: 88.5, z: 33.8, wait: 4 }, { x: 93, z: 31.5 }, { x: 96, z: 32, wait: 8 }] } },
    // the Gatling guarding the half-track (e22 mans it; the Driver may take it once he is dead)
    { id: 'mg_e', vehicleType: 'mgNest', x: 80, z: 87.7, heading: deg(240), gunner: 'e22', driveable: false },
  ],
  commandos: [
    // the NW foot of the start spur, W edge; the Spy already in a German officer's uniform (§3.8 row 11)
    { role: 'greenberet', x: 8.7, z: 63, heading: deg(90), inventory: { knife: 1, pistol: 1, decoy: 1, shovel: 1 } },
    { role: 'sniper', x: 5.5, z: 64.5, heading: deg(90), inventory: { pistol: 1, sniperRifle: 5 } },
    { role: 'sapper', x: 9.7, z: 61.2, heading: deg(90), inventory: { pistol: 1, bearTrap: 1, grenade: 1, remoteBomb: 3 } },
    { role: 'driver', x: 8.6, z: 68.8, heading: deg(90), inventory: { pistol: 1, firstAid: 6 } },
    { role: 'spy', x: 7, z: 71, heading: deg(90), inventory: { pistol: 1, lethalInjection: 1 } },
  ],
  enemies: ENEMIES,
  zones: [
    { id: 'z_sw', poly: Z_SW, onSeen: 'RINT', onHeard: 'RINT', heardLocal: true, siren: true }, // the camp: siren
    { id: 'z_c', poly: Z_C, onSeen: 'EV_C', onHeard: 'EV_C', heardLocal: true }, // yard, E valley, lowlands: silent
    { id: 'z_n', poly: Z_N, onSeen: 'EV_N', onHeard: 'EV_N', heardLocal: true }, // plateau, ridge, quarry, HQ: silent
  ],
  jails: [],
  barracks: BARRACKS,
  // the Green Beret's climb spots (§7.1)
  climbLinks: [
    { id: 'cl_mesa_s', a: [86, 119.5, MESA_Y], b: [86, 124.5, 0], roles: ['greenberet'] }, // "south of 20" [P]
    { id: 'cl_mesa_w', a: [74, 113, MESA_Y], b: [71.5, 115.5, 0], roles: ['greenberet'] },
    { id: 'cl_ridge_e', a: [97, 61, Y], b: [97, 64.5, 0], roles: ['greenberet'] }, // up behind e31 [K]
    { id: 'cl_ridge_w', a: [60.5, 60.5, Y], b: [61, 63.5, 0], roles: ['greenberet'] },
    { id: 'cl_start', a: [15, 49, Y], b: [17, 54, 0], roles: ['greenberet'] },
  ],
  ladders: [
    { id: 'ld_bunker', x: 48.7, z: 65.6, y: 0, top: [48.7, 64.3, ROOF_Y], raised: false, heading: deg(270) },
    { id: 'ld_scarp', x: 48, z: 57.6, y: ROOF_Y, top: [48, 56, Y], raised: false, heading: deg(270) },
    { id: 'ld_mesa', x: 86.5, z: 101.3, y: 0, top: [86.5, 103.8, MESA_Y], raised: false, heading: deg(90) },
  ],
  triplines: [],
  objectives: [
    { id: 'o_rigs', text: 'Destroy the four drilling rigs', type: 'destroy', targets: RIGS.map((r) => r.id), required: true },
    { id: 'o_escape', text: 'Escape in the half-track along the west road', type: 'escape', required: true, vehicleId: 'ht_ours' },
  ],
  setpieces: [
    // the remote bomb at the S portal's E jamb [ooc]: the bore and the portal become rock; anyone inside dies
    { type: 'collapse', id: 'tunnel_fall', at: [53.5, 30.5], r: 3.5, by: ['bomb'], block: { poly: TUNNEL_POLY }, kill: { poly: TUNNEL_POLY },
      message: 'The tunnel has caved in. Nothing can come through from the north now.' },
  ],
  triggers: [
    // mission glue every tick: the half-tracks' ramp/plateau driving and heights (D3/D9)
    { on: 'tick', once: false, when: () => true, do: [{ run: (w) => m11Tick(w) }] },
    // the N half-track answers the northern alarm through the tunnel [P tip][g3]; it fights whatever it meets
    { on: 'alarm:zone', match: { event: 'EV_N' }, once: true,
      do: [{ drive: 'ht_n', to: [[70, 12.5], [63, 13.5], [52.8, 30.8], [50, 36], [50, 40]], speed: 5 }] },
    // a half-track caught in the bore when it falls is crushed with it [P tip] (collapse kills units only, D6)
    { on: 'structure:destroyed', match: { id: 'tunnel_fall' }, once: true, do: [{ run: (w) => {
      tunnelRubble(w, [53.4, 30.2]);
      const v = w.byId('ht_n');
      if (v && !v.destroyed && inside(TUNNEL_POLY, v.x, v.z)) v.destroy(null, 'explosion');
    } }] },
    // the two silent garrison alerts: only the camp's siren is an alarm (stats.alarms, gap-7 scores neither); the
    // silent EV_C / EV_N calls are tallied apart in stats.zoneAlerts (once each)
    { on: 'alarm:zone', match: { event: 'EV_C' }, once: true, do: [{ run: (w) => { w.stats.zoneAlerts = (w.stats.zoneAlerts || 0) + 1; } }] },
    { on: 'alarm:zone', match: { event: 'EV_N' }, once: true, do: [{ run: (w) => { w.stats.zoneAlerts = (w.stats.zoneAlerts || 0) + 1; } }] },
    // the escape half-track lost before the escape (§8.1 vehicle wording naming the half-track, dossier §10.3)
    { on: 'vehicle:destroyed', match: { vehicle: 'ht_ours' }, once: true, when: (_p, w) => !w.objectives?.find((o) => o.id === 'o_escape')?.done,
      do: [{ fail: 'YOU DESTROYED THE HALF-TRACK, BUT YOU NEEDED IT TO ESCAPE.' }] },
    { on: 'objective', match: { id: 'o_rigs', status: 'done' }, once: true,
      do: [{ message: 'All four rigs are burning. Take the half-track out along the west road.', kind: 'objective' }] },
    // §8.1 main objective made impossible: a quarry rig with no fuel left that could still reach it
    { on: 'tick', once: true, when: (_p, w) => rigsImpossible(w), do: [{ fail: 'THE LAST RIGS CAN NO LONGER BE DESTROYED.' }] },
  ],
  script: m11Script({
    levels: [{ poly: N_PLATEAU, y: Y }, { poly: HQ_PLATEAU, y: Y }, { poly: MESA, y: MESA_Y }],
    rocks: [{ poly: N_RIM, h: 12 }, { poly: TUNNEL_ROCK, h: 11 }, { poly: QUARRY_W, h: Y }, { poly: QUARRY_E, h: Y },
      { poly: SPUR, h: 4 }, { poly: ROCKS_G2, h: 5 }],
    ramps: RAMPS,
    rampPads: RAMP_PADS,
    crater: CRATER,
    portals: [{ x: 53.4, z: 29.7, rot: deg(120), y: Y }, { x: 60.5, z: 17.3, rot: deg(300), y: Y }],
    hide: ['rim_n', 'tunnel_rock', 'quarry_w', 'quarry_s', 'quarry_e', 'spur_start', 'rocks_g2', 'crater', 'plateau_n', 'plateau_hq', 'mesa_se',
      'tunnel', 'tunnel_s', 'tunnel_n'],
    lift: LIFT,
    tanks: ['tank_q1', 'tank_q2'],
    yardTanks: ['tank_w1', 'tank_w2', 'tank_w3'],
  }),
  // the vacant half-track, driven by the team: all living commandos aboard and it reaches the W edge on the
  // plateau at the top of the W road (spec disagreement table "M11 exit → W/NW"; the TA's "east" is overruled)
  extraction: { vehicleId: 'ht_ours', spawnWhen: [], exit: { x: 1.5, z: 41, r: 3.5 } },
  alarmFail: null,
  // §13 D2: a blast pulls only the investigators within 45 m (engine default: the whole map)
  explosionPull: EXPLOSION_PULL,
  par: { time: 780 },
  cameraStart: { x: 12, z: 68, zoom: 1 },
  startDisguised: ['spy'],
};

/** Point in polygon (the trigger's bore test). */
function inside(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
