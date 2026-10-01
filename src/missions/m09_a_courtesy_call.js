/**
 * BEL Mission 9 — "A Courtesy Call" (buildable layout: docs/missions/m09.md). Owned by MISSIONS.
 * Bab el Qattara, Egypt, 20 October 1942: a forward camp of the 21st Panzer Division inside an octagonal
 * mud-brick wall. Five targets — the radio hut (o1), its dish aerial (o2), the weapons store (o3), the command
 * post (o4; the two centre houses, Dutch FAQ) and the sandbag bunker (o5) — then everyone into our lorry,
 * which comes in along the W road 15 s after the last target falls (o6). Two start groups: GB, Sapper and
 * Sniper S of the forecourt (the GB climbs the broken wall stub, anyone can open the mesh gate); the Spy (in
 * uniform) and the Driver outside the NE wall. The whole map is one alarm zone (seen OR heard → RINT). The
 * alarm wakes three Panzer IVs in the shed (dormant, no cone before it): they drive out and shell what they
 * see; pz1 hunts our lorry. The fuel tanker parked across the shed front is shot by the tanks still in their
 * bays, and its fireball wrecks all three. No live mines (the team starts past the minefield, gap-8).
 *
 * Conventions: headings/rot in DEGREES in the dossier, converted with deg(); route `look` and `post.sweep`
 * stay in degrees (0 = E, 90 = S, 180 = W, 270 = N). Briefing text is our own wording (§7.3).
 *
 * Deviations from the dossier (grid fit / engine, see the commit message):
 *  - dormant tanks and their drive-out (D1/D1b) are the mission script (scripts/m09.js) plus the vehicle-ai spawn flag
 *    `dormantUntilAlarm` (no perception before the first alarm, also on the first steps after a quick load); the "tank shoots its blocker" rule is the script's blocked-bay check (a tank still
 *    in its bay, tanker within 10 m of the bay) instead of three `hunt` actions (pz1 passes 11.6 m from the tanker's
 *    parking place by the bunker on its way out, which a plain hunt would have shot);
 *  - no `extraction.spawnDelay` (D4): a hidden helper objective `o_ready` is set 15 s after o1–o5 (m08 pattern);
 *  - pt_yard's W turn is (43,71) inside the yard (the dossier's (42,78) lies on the forecourt side of w_ssw);
 *  - the SW corner joins at (15,62) (f_in / w_sw2 / f_fw met 1–2 m apart in the dossier);
 *  - the dish aerial is a 7 × 7 m target (Ø 6 dish on its turntable) so one bomb at the cable midpoint (75,75) takes both it
 *    and the radio hut, as NL/DE do; the cosmetic fleeing-survivors trigger (D5) is left out;
 *  - art variants (D6) are named in `variant` with plain catalogue fallbacks.
 */

import { m09Script, wreckArmourNear } from './scripts/m09.js';
import { joinStructures } from './schema.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (§4.1)

// ---------------------------------------------------------------- walls, fences, gates (dossier §5.2)
const wall = (id, points, extra = {}) => ({ id, type: 'wall', variant: 'mudbrick_wire', mat: 'plaster', points, h: 3, width: 0.8, ...extra });
const mesh = (id, points) => ({ id, type: 'fence', variant: 'mesh_iron', points, h: 3 });

/** The octagon's inside (hardpan decal; also used by tests). */
export const OCTAGON = [[27, 6], [53, 6], [73, 30], [77.5, 31.5], [93, 40], [93.5, 65], [65, 97], [42, 74], [38, 72], [30, 62], [15, 62], [5, 51], [5, 27]];

const WALLS = [
  wall('w_n', [[27, 6], [53, 6]]),
  wall('w_ne', [[53, 6], [73, 30]]),
  // gate_e: the 4.7 m gap (73,30)–(77.5,31.5), no leaf; the NE road comes in here
  wall('w_e1', [[77.5, 31.5], [93, 40]]),
  wall('w_e2', [[93, 40], [93.5, 65]]),
  wall('w_se', [[93.5, 65], [65, 97]]),
  wall('w_ssw', [[65, 97], [42, 74]]),
  // gap_s: the inner S gap (38,72)–(42,74) between the yard and the forecourt; the W road passes
  wall('w_sw', [[38, 72], [30, 62]]),
  { id: 'gate_sw', type: 'gate', variant: 'mesh_iron', x: 28, z: 62.25, rot: Math.atan2(0.5, -4), w: 4, h: 3, open: true },
  mesh('f_in', [[26, 62.5], [15, 62]]),
  wall('w_sw2', [[15, 62], [5, 51]]),
  wall('w_w', [[5, 51], [5, 27]]),
  wall('w_nw', [[5, 27], [27, 6]]),
  // the SW forecourt
  mesh('f_fw', [[15, 62], [23.5, 88]]),
  // opening_w: (23.5,88)–(27.5,88), the forecourt's W opening; the W road, our lorry and a tank fit
  mesh('f_fse', [[27.5, 88], [37.5, 109]]),
  mesh('f_fs', [[37.5, 109], [46, 104]]),
  // the broken wall stub the Green Beret climbs (climb_s)
  wall('stub_s', [[46, 104], [50.37, 100.72]], { variant: 'mudbrick_broken', h: 2.2, clipAllow: ['gate_s'] }), // joined to the gate's pier
  // closed, not locked: any commando opens it (§5.2 [rec])
  { id: 'gate_s', type: 'gate', variant: 'mesh_iron_roofed', x: 54.25, z: 98.25, rot: Math.atan2(-5.5, 8.5), w: 10.1, h: 3, open: false, locked: false },
  mesh('f_fs2', [[58.5, 95.5], [61, 93.3]]),
];

// ---------------------------------------------------------------- buildings and props (dossier §5.1, §5.3)
/** `door` is the dossier §5.1 door point [x, z] (world m). */
const house = (id, x, z, w, d, door, extra = {}) => ({ id, type: 'house', variant: 'house_stone_pitched', x, z, rot: 0, w, d, h: 5, mat: 'stone', enterable: true, door, ...extra });
const flat = (id, x, z, w, d, door, extra = {}) => ({ id, type: 'flat_roof_house', variant: 'house_whitewash_flat', x, z, rot: 0, w, d, h: 4, mat: 'plaster', roofWalk: false, enterable: true, door, ...extra });
/** The GB's four explosive drums (§3.8 row 9), a 2 × 2 pile between the two centre houses. */
const drum = (id, x, z) => ({ id, type: 'barrels', variant: 'fuel_explosive', x, z, r: 0.3, h: 0.9, explosive: 'barrel', carriable: true, destructible: true, hp: 1 });
export const DRUMS = [drum('brl1', 54.5, 50.2), drum('brl2', 55.5, 50.2), drum('brl3', 54.5, 51.2), drum('brl4', 55.5, 51.2)];
const bush = (k, x, z) => ({ id: `bush_${k}`, type: 'bush', variant: 'scrub_desert', x, z, r: 0.9, h: 0.8 });
const BUSHES = [[29.5, 10.5], [48.5, 49], [37, 71.5], [44.5, 82], [47.5, 85], [57, 95.5], [2, 71.5], [18, 100], [73, 90.5], [90, 101], [79, 108], [93, 15.5], [98, 103]]
  .map(([x, z], k) => bush(k + 1, x, z));
const crate = (id, x, z, w = 2, d = 2, h = 1.1) => ({ id, type: 'crates', x, z, rot: 0, w, d, h, block: 1 });

/** Gantry hoist (D6 fallback): two lattice posts 7 m high with the engine block between them (open under the beam). */
const GANTRY = [-1, 1].map((s) => ({ id: `gantry_${s < 0 ? 'a' : 'b'}`, type: 'ruins', variant: 'gantry_hoist_post', mat: 'metal',
  x: +(35 + s * 3.5 * Math.cos(deg(30))).toFixed(2), z: +(49 + s * 3.5 * Math.sin(deg(30))).toFixed(2), rot: deg(30), w: 0.6, d: 0.6, h: 7, block: 2 }));

const STRUCTURES = [
  ...WALLS,
  // --- the NW tank shed: 3 open bays (open side SE), pz1–pz3 inside; not destructible
  { id: 'shed', type: 'tank_shed', variant: 'tank_shed_open', label: 'Tank shed', x: 20.9, z: 21.6, rot: deg(315), w: 21, d: 9, h: 5, open: 'S' },
  // --- the five targets
  house('wstore', 50, 43.5, 8, 7.5, [52, 47.3], { label: 'Weapons store', destructible: true, hp: 100 }),
  flat('cp', 62.5, 58.5, 9, 7, [65, 62], { label: 'Command post', flag: true, destructible: true, hp: 100 }),
  { id: 'bunker', type: 'bunker', variant: 'bunker_sandbag_thatch', label: 'Bunker', x: 18.5, z: 50.5, rot: 0, w: 8, d: 7, h: 2.5, mat: 'sandbag',
    destructible: true, bombOnly: false, hp: 100 },
  { id: 'ant', type: 'radio_mast', variant: 'wurzburg_dish', label: 'Aerial', x: 79.5, z: 71, rot: 0, w: 7, d: 7, r: 3.5, h: 7, destructible: true, hp: 100 },
  { id: 'ant_ring', type: 'sandbags', variant: 'sandbag_ring', x: 79.5, z: 71, rot: deg(45), ring: { r: 4.5, arc: 300 }, h: 1.2, block: 1 },
  { id: 'comms', type: 'hut', variant: 'comms_hut_antenna', label: 'Radio hut', x: 70.5, z: 79.5, rot: 0, w: 8, d: 6, h: 4.5, mat: 'wood', destructible: true, hp: 100 },
  // --- the garrison: the domed two-storey block with its roof terrace (y 4) and outside stairs; NOT a target
  { id: 'barr', type: 'flat_roof_house', variant: 'hq_domed_terraced', label: 'Barracks', x: 87, z: 52.5, rot: 0, w: 12, d: 15, h: 4, roofY: 4,
    roofWalk: true, dome: true, flag: true, mat: 'plaster', garrison: true, destructible: true, hp: 100, door: deg(90) }, // S face (a side angle: map-builder doorPoint)
  // --- hideouts
  house('house_n1', 50, 13.5, 7, 7, [48.5, 17]),
  house('house_n2', 57, 21, 7, 7, [54.5, 24.5]),
  flat('house_ne', 64.5, 28, 7, 6, [61, 28]),
  { id: 'house_ne_annex', type: 'hut', variant: 'lean_to_mudbrick', x: 69, z: 30.5, rot: 0, w: 2.5, d: 3, h: 2.6, mat: 'plaster' },
  ...GANTRY,
  crate('gantry_engine', 35, 49, 1.6, 1.2, 1.2),
  // --- props
  ...DRUMS,
  { id: 'drums_y', type: 'barrels', variant: 'drum_stack_yellow', label: 'Yellow drums', x: 40.5, z: 100, rot: 0, w: 5, d: 4, h: 1.2, block: 1 },
  crate('crates_g1', 29, 52.5), crate('crates_g2', 31, 54.5), crate('crates_g3', 33.5, 57), crate('crates_g4', 36.5, 59.5),
  crate('drum_g', 38, 50.5, 0.8, 0.8, 1),
  crate('box_gate', 25, 64, 1, 0.6, 0.6),
  { id: 'debris_s1', type: 'sandbags', variant: 'sandbags_collapsed', x: 32, z: 105.5, rot: 0, w: 3, d: 1.5, h: 0.8, block: 1 },
  { id: 'debris_s2', type: 'sandbags', variant: 'sandbags_collapsed', x: 41, z: 108.5, rot: 0, w: 3, d: 1.5, h: 0.8, block: 1 },
  { id: 'flag_barr', type: 'sign', variant: 'flag_pole', x: 87.5, z: 43, r: 0.15, h: 7, block: 0 },
  ...BUSHES,
  // --- the minefield edge behind the team (decor only: no live mines, dossier §12 #8)
  ...Array.from({ length: 8 }, (_, k) => ({ id: `mine_sign_${k + 1}`, type: 'sign', variant: 'minefield_warning', x: 6 + k * 12.5, z: 118, r: 0.15, h: 1.2, block: 0, text: 'Achtung Minen' })),
];

// ---------------------------------------------------------------- enemies (dossier §8; Prima's numbers)
const sentry = (id, prima, x, z, h, sweep, inv) => ({ id, prima, soldierType: 'sentry', x, z, heading: deg(h), nervousness: 50,
  flags: { investigates: inv, holdsPost: true }, post: { heading: deg(h), sweep } });
const walker = (id, prima, pts) => {
  const [a, b] = pts;
  return { id, prima, soldierType: 'soldier', x: a.x, z: a.z, heading: Math.atan2(b.z - a.z, b.x - a.x), nervousness: 50,
    flags: { investigates: true, followsTracks: true }, route: { type: 'PINGPONG', vel: 1.0, points: pts } };
};
/** The courtyard / garrison loop (alarm): through the S gap, past both centre houses, to the E gate and back. */
export const L_YARD = [P(42, 76), P(56, 64), P(70, 50), P(74, 40), P(58, 33), P(40, 40), P(30, 58)];
const ALARM_LOOP = { type: 'LOOP', vel: 1.8, points: L_YARD };
/** A 3-man patrol: a sergeant and two troopers in file; on RINT they run the dossier §8.5 alarm route `run` (noises do not
 * turn them aside on the way, §4.9) and then loop L_YARD. */
const patrol = (sq, prima, route, run) => [0, 1, 2].map((k) => {
  const a = route[0], b = route[1];
  const ux = b.x - a.x, uz = b.z - a.z, L = Math.hypot(ux, uz);
  return {
    id: `${sq}${'abc'[k]}`, ...(prima && !k ? { prima } : {}), soldierType: k ? 'trooper' : 'sergeant',
    x: +(a.x - (ux / L) * 1.2 * k).toFixed(2), z: +(a.z - (uz / L) * 1.2 * k).toFixed(2), heading: Math.atan2(uz, ux), nervousness: 50,
    flags: { investigates: true, followsTracks: true }, squad: { id: sq, leader: `${sq}a`, columns: 1 },
    route: { type: 'PINGPONG', vel: 1.0, points: route },
    reactEvents: ['RINT'], alarmRoute: { run: run.map(([x, z]) => ({ x, z, vel: 2.7 })), loop: ALARM_LOOP },
  };
});

/** Dossier §8.5 alarm routes: pt_nw down the W side past the lorry's parking spot [DE][eg]; pt_se in through gate_e over
 * the trap point [P]. */
export const PT_NW_RUN = [[1.5, 50], [3, 75], [12, 91], [25.5, 89], [40, 74]];
export const PT_SE_RUN = [[98, 36], [88, 27], [80, 27], [75.2, 30.8], [72, 40]];

const ENEMIES = [
  // ===== Phase 1a: the forecourt (P1–P3)
  sentry('e1', 1, 43.5, 80, 180, 40, true), // back to the drum stack and the S gate
  walker('e2', 2, [P(26, 70, 3, 270), P(34, 94, 3, 200)]), // turns at the drum stack's W end
  sentry('e3', 3, 24.5, 90.5, 180, 40, false), // on the road just outside the W opening, watching W
  // ===== Phase 1b: the bunker and the tanker (P4–P5)
  sentry('e4', 4, 13, 44.5, 20, 35, true),
  walker('e5', 5, [P(27, 46.5, 3, 180), P(41, 37.5, 3, 330)]),
  // ===== Phase 1c: the E gate (P6–P7)
  sentry('e6', 6, 76, 35.5, 285, 35, true), // looks out up the NE road
  walker('e7', 7, [P(74, 33.5, 3, 300), P(78, 49, 3, 90)]),
  // ===== Phase 1d: the north yard and the tanks (P8–P9)
  walker('e8', 8, [P(34, 28, 3, 135), P(58, 34, 3, 0)]), // 6 m N of the weapons store; watches the bunker at his W turn
  sentry('e9', 9, 34, 17, 110, 40, true), // the still guard by the Panzers
  // ===== the three 3-man patrols
  // Patrol 10, the courtyard: W turn inside the S gap, E turn 3.6 m from the barracks door
  ...patrol('pt_yard', 10, [P(43, 71, 4, 150), P(58, 76), P(66, 73), P(74, 64), P(86, 64.5, 4, 45)], [[42, 76]]),
  // outside the NW and W walls; on the alarm runs S past our lorry's parking place and in by the forecourt
  ...patrol('pt_nw', null, [P(16, 4, 3, 250), P(4, 17), P(1.5, 30), P(1.5, 50, 3, 90)], PT_NW_RUN),
  // outside the SE and E walls (on the alarm in through the E gate, over the Sapper's trap); starts at its painted place just outside w_se's S corner (fan map), facing up the wall
  ...patrol('pt_se', null, [P(74, 99, 3, 45), P(82, 84), P(98, 67), P(98, 36, 3, 225)], PT_SE_RUN),
];

// ---------------------------------------------------------------- vehicles (dossier §8.6)
const TANK_CREW = [{ soldierType: 'crew' }, { soldierType: 'crew' }];
const panzer = (id, x, z) => ({ id, vehicleType: 'panzer4', variant: 'panzer4_desert', x, z, heading: deg(45), driveable: false, crew: TANK_CREW.map((c) => ({ ...c })), behavior: 'parked', dormantUntilAlarm: true });
const VEHICLES = [
  panzer('pz1', 17.2, 27.8), panzer('pz2', 22.1, 22.9), panzer('pz3', 27.1, 17.9),
  // K's "Blitz Opel": the red fuel tanker by the bunker; one bullet or any blast explodes it (§3.6)
  { id: 'tanker', vehicleType: 'opel_blitz_tanker', variant: 'opel_blitz_tanker_red', x: 13.5, z: 40, heading: deg(345), operators: ['driver'] },
];
/**
 * T2 fireball radius (m, to the tank's centre). The shed-front spot is 5.3–8.7 m from the three bays and a plain move
 * order parks the tanker up to ~1 m off it (9.75 m from pz3), so 11 m leaves margin; the tanker's own place by the bunker
 * stays out of reach (12.7 m from pz1's bay).
 */
export const TANKER_BLAST = 11;
/** Where the Driver parks the tanker across the bay fronts (hint marker; §11 step 11). */
export const TANKER_SPOT = { x: 25.5, z: 26.5, heading: 315 };

/** Was this kill ours? A commando, or something a commando owns / placed (bomb, trap, thrown drum). */
const byCommando = (src) => !!src && (src.kind === 'commando' || src.faction === 'player' || src.owner?.kind === 'commando' || src.placedBy?.kind === 'commando');
/** §8 / dossier §10: the evac loss names who did it — the enemy (pz1, pt_nw) or the team itself. */
export const evacLossText = (src) => (byCommando(src) ? 'YOU DESTROYED THE TRUCK, BUT YOU NEEDED IT TO ESCAPE.' : 'YOU NO LONGER HAVE AN ESCAPE VEHICLE.');

/** o1–o5 all done. */
function allDown(world) {
  const list = world.objectives || [];
  return ['o1', 'o2', 'o3', 'o4', 'o5'].every((id) => list.find((o) => o.id === id)?.done);
}

export default {
  id: 'm09',
  campaign: 'BEL',
  title: 'A Courtesy Call',
  subtitle: 'Bab el Qattara, Egypt · 20 October 1942',
  date: '1942-10-20',
  place: 'Bab el Qattara, Egypt (21st Panzer Division forward camp)',
  theater: 'desert',
  coneColors: 'desert',
  size: [103, 122],
  seed: 1942_1020,
  briefing: {
    historical: '20 October 1942. All along the El Alamein line the question is the same: why does Montgomery not attack? He will not move until his superiority in men and armour is overwhelming. Until that day Rommel\'s army must never be allowed to settle. Tonight you slip through the minefields at Bab el Qattara to a forward camp of the 21st Panzer Division. Lie low until first light, then tear the place apart and disappear.',
    text: 'Get into position round the camp before dawn, officer. And watch those Panzers: their crews sleep aboard and will roll the moment the camp wakes up. Your targets are the listening post, that is the radio hut and its aerial, the weapons store, the command post and the bunker. Once they are down, one of our lorries will come for you on the south-west side. A simple job. Good luck.',
    objectivesSummary: 'Destroy the radio hut, its aerial, the weapons store, the command post and the bunker, then board our lorry in the south-west.',
    hints: [
      'The tanks are the real danger. The moment anyone raises the alarm they will roll out and open fire.',
      'Our lorry will wait for you in the south-west, on the road outside the forecourt. Everyone must be aboard to leave.',
      'When the camp wakes up, the patrol outside the west wall runs south past the pick-up point. Deal with it before you board, or it will shoot up our lorry.',
      'A fuel tanker is a bomb on wheels, even for the side that owns it.',
      'Nothing on this map goes unnoticed: anyone who sees you, or hears a shot or a blast, will sound the alarm.',
      'The Green Beret can climb the broken piece of wall south of the forecourt.',
      'Sand keeps your footprints for a while, and the courtyard patrol looks into the forecourt from the inner gap and follows fresh tracks. Where you can, cross the forecourt on the road.',
    ],
  },
  // faithful default: the map is painted in daylight (§2.4 row 9); the dawn variant is optional
  lighting: { sunElevDeg: 55, sunAzimuthDeg: 135, kelvin: 5200, hdri: 'desert_clear_noon', fog: 200, lut: 'desert_noon',
    variants: { dawn: { sunElevDeg: 10, sunAzimuthDeg: 90, kelvin: 3500, lut: 'desert_dawn' } } },
  water: null,
  baseTerrain: 'sand',
  terrain: [
    { type: 'poly', terrain: 'ground', points: OCTAGON }, // rutted hardpan inside the walls
    { type: 'path', terrain: 'road', points: [[88, 0], [83, 12], [77, 24], [75, 31]], width: 5 }, // road_ne → the E gate
    { type: 'path', terrain: 'road', points: [[0, 95], [12, 93.5], [25.5, 89], [33, 82], [40, 74], [48, 60]], width: 5 }, // road_w
  ],
  // placement rule (c): deliberate compound joins (wings, towers, party walls) — joinStructures
  structures: joinStructures(STRUCTURES, [['house_n1', 'house_n2'], ['house_n2', 'house_ne'], ['house_ne', 'house_ne_annex']]),
  items: [],
  interactables: [],
  vehicles: VEHICLES,
  commandos: [
    // S group, outside the forecourt E of the broken stub
    { role: 'greenberet', x: 49.5, z: 105, heading: deg(250), inventory: { knife: 1, pistol: 1, decoy: 1, shovel: 1 } },
    { role: 'sniper', x: 52.6, z: 106.5, heading: deg(250), inventory: { pistol: 1, sniperRifle: 5 } },
    { role: 'sapper', x: 51, z: 105.8, heading: deg(250), inventory: { pistol: 1, bearTrap: 1, remoteBomb: 2, detonator: 1 } },
    // N group, outside the NE wall W of the road
    { role: 'driver', x: 54.5, z: 4, heading: deg(0), inventory: { pistol: 1, firstAid: 6 } },
    { role: 'spy', x: 58.5, z: 2.5, heading: deg(45), inventory: { pistol: 1, lethalInjection: 1 } },
  ],
  startDisguised: ['spy'],
  enemies: ENEMIES,
  // K: "anything suspect or seen in the ENTIRE map will immediately sound the alarm"
  zones: [
    { id: 'z_all', poly: [[0, 0], [103, 0], [103, 122], [0, 122]], onSeen: 'RINT', onHeard: 'RINT', siren: true },
  ],
  jails: [],
  barracks: {
    barr: { pool: 10, squads: [
      { event: 'RINT', size: 4, exitVel: 2.7, exitRoute: [P(87, 61.5), P(84, 66)], loopVel: 1.8, loop: L_YARD },
    ] },
  },
  climbLinks: [
    // over the broken stub into the forecourt, landing behind the yellow drums (K)
    { id: 'climb_s', a: [48.9, 104.3, 0], b: [46.9, 100.9, 0], roles: ['greenberet'] },
  ],
  ladders: [
    // outside stairs to the barracks' roof terrace (nobody is posted up there)
    { id: 'stair_barr', kind: 'stairs', x: 91.5, z: 62, y: 0, top: [91.5, 58.5, 4], raised: false, heading: deg(270) },
  ],
  triplines: [],
  markers: [
    { id: 'tanker_spot', x: TANKER_SPOT.x, z: TANKER_SPOT.z, r: 3 },
    { id: 'trap_gate_e', x: 75.2, z: 30.8, r: 1 },
  ],
  objectives: [
    { id: 'o1', text: 'Destroy the radio hut', type: 'destroy', targets: ['comms'], required: true },
    { id: 'o2', text: 'Destroy the aerial', type: 'destroy', targets: ['ant'], required: true },
    { id: 'o3', text: 'Destroy the weapons store', type: 'destroy', targets: ['wstore'], required: true },
    { id: 'o4', text: 'Destroy the command post', type: 'destroy', targets: ['cp'], required: true },
    { id: 'o5', text: 'Destroy the bunker', type: 'destroy', targets: ['bunker'], required: true },
    // helper: set 15 s after o1–o5 (the lorry's call-in, dossier D4); never shown, never required
    { id: 'o_ready', text: 'Our lorry is on its way', type: 'script', required: false, hidden: true },
    { id: 'o6', text: 'Everyone into our lorry in the south-west', type: 'escape', required: true, hidden: true, vehicleId: 'evac' },
  ],
  triggers: [
    // T1: the alarm wakes the tank depot (the wake / drive-out itself is scripts/m09.js); pz1 goes for our lorry [DE]
    { on: 'alarm:start', once: true, do: [
      { hunt: 'pz1', target: 'evac', range: 40 }, // resolves once the lorry exists
      { message: 'The Panzers are moving!', kind: 'warn' },
    ] },
    // T2: the tanker's fireball wrecks the armour within TANKER_BLAST m (heavy armour otherwise ignores barrel/vehicle blasts)
    { on: 'vehicle:destroyed', match: { vehicle: 'tanker' }, once: true, do: [
      { run: (w, _d, p) => { if (wreckArmourNear(w, p.vehicle, p.source, TANKER_BLAST).length) w.events.emit('message', { text: 'The tanker has taken the Panzers with it!', kind: 'info' }); } },
    ] },
    // all five targets down → our lorry is called in; it comes 15 s later (dossier D4)
    { on: 'tick', once: true, when: (_p, w) => allDown(w),
      do: [{ message: 'All targets destroyed. Our lorry is on its way to the south-west.', kind: 'objective' }] },
    { on: 'tick', once: true, delay: 15, when: (_p, w) => allDown(w),
      do: [{ objective: 'o_ready', set: 'done' }, { objective: 'o6', set: 'show' }] },
    // T3: the lorry is fair game for the enemy once it is on the map [DE][eg]
    { on: 'tick', once: true, when: (_p, w) => !!w.byId('evac'), do: [
      { taint: 'evac' },
      { message: 'Our lorry is coming in along the west road. Get everyone to the south-west!', kind: 'info' },
    ] },
    // our lorry destroyed while still needed → loss (dossier §10: "YOU NO LONGER HAVE AN ESCAPE VEHICLE." when the enemy did it)
    { on: 'vehicle:destroyed', match: { vehicle: 'evac' }, once: true, when: (_p, w) => !w.objectives?.find((o) => o.id === 'o6')?.done,
      do: [{ run: (_w, d, p) => d.fail(evacLossText(p.source)) }] },
  ],
  script: m09Script({ tanks: ['pz1', 'pz2', 'pz3'], tanker: 'tanker' }),
  // our lorry comes in on the W road and parks at (16,95), heading E; with everyone aboard it leaves W
  extraction: {
    vehicleId: 'evac', vehicleType: 'truck', friendly: true, seats: 6, spawnWhen: ['o_ready'],
    spawnAt: { x: -6, z: 95, heading: deg(0) }, arrive: { x: 16, z: 95, speed: 6 },
    exit: { x: 2, z: 95, r: 3 }, leave: { x: -12, z: 95 },
  },
  alarmFail: null, // no scripted failure on the alarm: the Panzers make it deadly instead
  par: { time: 540 },
  cameraStart: { x: 50, z: 96, zoom: 1 },
};
