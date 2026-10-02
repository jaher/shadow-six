/**
 * BEL Mission 13 — "David and Goliath" (buildable layout: docs/missions/m13.md). Owned by MISSIONS.
 * Le Havre, 15 May 1944. A copy of the Bismarck lies at the N quay behind a lock gate. The team lands on a rock
 * ledge below the S jetty. The Marine must take the dock's mini-sub (2 straight-running torpedoes) out through
 * the N lock and put one torpedo into the battleship's bow. The Sapper blows the two fuel tanks by her berth, and
 * then everyone rows the inflatable out through the S lock to the red buoy in the SW. The supply boat cycles the S
 * lock (e5 opens it on the horn; a swimmer can slip through behind it). A lever in either shack latches its
 * gate open. The Panzer II waits in the brick garage: on the dock alarm it drives out and hunts the sub, and a
 * tank hit on the sub fails the mission. A truck parked across the garage door keeps it in. The patrol boat
 * that comes at the end is sunk with the pier gun (Driver) or the spare torpedo.
 *
 * Conventions: headings/rot in DEGREES in the dossier, converted with deg(); route `look` and `post.sweep` stay in
 * degrees (0 = E, 90 = S, 180 = W, 270 = N). Briefing text is our own wording (§7.3).
 *
 * Deviations from the dossier (grid fit, engine; see the commit message):
 *  - flat map (M7 precedent): quay decks at y 0; the two sub-pontoon ladders are a 2.5 m gangway gap in the quay
 *    edge; the quay faces are a B.FENCE `quay_edge` set-piece (scripts/m13.js), not a new prop type (E1);
 *  - z_dock: seen → RINT; noise is not a zone sensor (the engine trips `onHeard` zones on explosions map-wide,
 *    and the dossier's `heardLocal` does not exist). The fuel blast and the ship hit raise it by trigger (T2, T2b);
 *  - the torpedo must strike inside marker `bow_hit` (21,28) r 7 (hull S side, bow tip to x 28). This stands in for
 *    the 12 m target radius (E8) and keeps a remote bomb on the N quay corner out of reach (torpedo only);
 *  - e5 stands at the S shack door (no operator walk, E3); the supply boat is an uncrewed, undriveable
 *    `patrolboat` (E2), with no skipper; the raft starts inflated on the ledge rim (§3.8 row 13 gives the Marine
 *    no carried raft) with 5 seats, and m13Tick keeps any relaunched raft at 5 (E7); the extraction is the buoy circle,
 *    where anyone aboard a craft counts by the craft's position (E6);
 *  - garage 10 × 10 (the painted one is 14 wide, which no truck could close); the launch, crates by the garage,
 *    e12, e18 (the dossier spot is in the water), barrels and two beacon masts moved off water/route cells;
 *  - the tank is blind until RINT (`dormantUntilAlarm` + m13Tick, so a quick load cannot wake it) and hunts the sub
 *    only once it has driven out of the garage and has a clear line (m13Tick), which is how the truck across the
 *    door "keeps it in" even when it fires;
 *  - the truck starts at (70,104.8), 1.7 m E of the dossier spot, and TANK_ROUTE runs S round it;
 *  - e3 (58.5,142.5), e10 (22,88), e8's W look 200 and e19's S end z 68 are nudged off the dossier so that no
 *    34–36 m sightline cuts through the Prima/Kildread kill order (e3 from e7, e10 from e20, R4 from e8, Patrol 11's
 *    S turn from e19); e14's S-end look is 100, not 90, so his turn N goes through the W, not over e19's S end;
 *  - e15 is a walker on a 3 m beat along row_s (Kildread: 10 moving + 9 isolated), facing N at both ends;
 *  - the supply boat's horn is routine (noise level 0, no guard reacts), and it stays silent at a latched gate.
 */

import { BOW_HIT, SHIP, aftHit, outOfTorpedoes, m13Tick } from './scripts/m13.js';
import { applyExplosion } from '../abilities/explosions.js';
import { joinStructures } from './schema.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (enemy-brain reads wp.look * DEG)

// ---------------------------------------------------------------- terrain (dossier §4)
/** Land masses (T1–T5): paved granite quays. */
const T1_DOCK = [[28.5, 31], [87, 31], [87, 112], [78, 113], [40, 113], [30, 112], [29.5, 103], [33, 98.5], [49, 99.5], [58, 98], [63, 96],
  [64, 83], [60, 75], [60, 51], [57, 49.5], [36, 49.5], [28.5, 48]];
const T2_JETTY = [[35, 142], [38, 138], [46, 137.5], [50, 139.5], [80, 139.5], [81, 139], [81, 150], [50, 150.5], [47, 154], [38, 155], [35, 151]];
const T3_SW = [[0, 116.5], [12, 127.5], [14, 136], [21, 137], [26, 139], [26.5, 152], [14, 152.5], [12, 147], [0, 134]];
const T4_MW = [[0, 77.5], [20, 78.5], [22.5, 80.5], [27.5, 81], [29, 85], [28, 91], [22, 92], [18, 90], [0, 90.5]];
const T5_NW = [[0, 41], [6, 41], [10, 39], [15, 40.5], [17.5, 43], [17.5, 51], [12, 52], [6, 50], [0, 50.5]];
const T6_ROCKS = [[78, 112], [87, 112], [87, 166], [83, 166], [86, 156], [84, 151], [81, 150], [81, 139], [84, 125]];
const T7_LEDGE = [[74, 151], [81, 150.5], [84, 151], [86, 156], [83, 160], [77, 158.5], [74, 155]];
/** The five slipways (R1–R5): the only places to climb out of the water or launch/land the raft. */
const RAMPS = {
  ramp_n: { type: 'rect', x: 36.5, z: 49.5, w: 4, d: 8.5 },
  ramp_se: { type: 'rect', x: 67.5, z: 113, w: 5, d: 11 },
  ramp_mw: { type: 'rect', x: 5, z: 74.5, w: 5.5, d: 4.5 },
  ramp_sw: { type: 'poly', points: [[12, 128], [20, 130.5], [21, 136], [13.5, 136]] },
  ramp_s: { type: 'rect', x: 47, z: 135.5, w: 11, d: 4 },
};

const TERRAIN = [
  ...[T1_DOCK, T2_JETTY, T3_SW, T4_MW, T5_NW].map((points) => ({ type: 'poly', terrain: 'road', points })),
  { type: 'poly', terrain: 'ground', points: T7_LEDGE },
  // T8 the ledge's wet rim (the Marine deploys the raft here at the start)
  { type: 'poly', terrain: 'shallow', points: [[72.5, 151], [74, 151], [74, 155], [77, 158.5], [83, 160], [82.5, 162], [76, 160.5], [72.5, 156]] },
  ...Object.values(RAMPS).map((r) => ({ ...r, terrain: 'shallow' })),
];

/** quay_edge set-piece: every quay outline, with gaps at the ramps and the pontoon gangway (dossier §4.2, §7.1). */
const QUAY_EDGE = {
  type: 'quay_edge', id: 'quay_edge', width: 1,
  rings: [T1_DOCK, T2_JETTY, T3_SW, T4_MW, T5_NW],
  lines: [[[51, 64.5], [60, 64.5]]], // the pontoon's N side (it is boarded from the W and S, or by the gangway)
  gaps: [ // exactly as wide as each ramp, so a swimmer beside it cannot step up onto the quay
    { x: 36.5, z: 48, w: 4, d: 3 },      // R1 under the N shack
    { x: 67.5, z: 111.5, w: 5, d: 3 },   // R2 by the garage
    { x: 5, z: 76, w: 5.5, d: 4 },       // R3 mid-W mole
    { x: 11.5, z: 128.5, w: 3.5, d: 7.5 }, // R4 SW mole (the ramp runs down its NE face)
    { x: 47, z: 137, w: 11, d: 3.5 },    // R5 S jetty
    { x: 59, z: 65.2, w: 2.5, d: 2 },    // the pontoon gangway (the dossier's two ladders)
  ],
};

// ---------------------------------------------------------------- structures (dossier §5)
const crates = (id, x, z, w = 3, d = 3, h = 1.6) => ({ id, type: 'crates', x, z, rot: 0, w, d, h, block: 1 });
const barrels = (id, x, z, w = 2, d = 2) => ({ id, type: 'barrels', x, z, rot: 0, w, d, h: 1.2, block: 1 });
const mast = (id, x, z) => ({ id, type: 'radio_mast', variant: 'quay_beacon_lattice', x, z, r: 0.8, h: 6, block: 2 });
const nissen = (id, x, z, w, extra = {}) => ({ id, type: 'barracks', variant: 'nissen_hut', x, z, rot: deg(-30), w, d: 6, h: 4, mat: 'metal', ...extra });

const SHIP_AND_GATES = [
  { id: SHIP.id, type: 'battleship', variant: 'battleship_replica', x: SHIP.x, z: SHIP.z, rot: deg(180), w: SHIP.w, d: SHIP.d, h: 12,
    destructible: true, bombOnly: true, targetAt: 'bow', marker: BOW_HIT.id, hp: 100, destroyFx: ['explode', 'sinkBow'] },
  { id: 'gate_n', type: 'lock_gate', variant: 'lock_gates', x: 23.25, z: 48.5, rot: 0, w: 11.5, d: 1.4, h: 4 },
  { id: 'gate_s', type: 'lock_gate', variant: 'lock_gates', x: 30.75, z: 146.5, rot: 0, w: 9.5, d: 1.4, h: 4 },
  { id: 'shack_n', type: 'control_shack', variant: 'guard_hut_a', x: 32, z: 43, rot: 0, w: 3.5, d: 3, h: 2.6 },
  { id: 'shack_s', type: 'control_shack', variant: 'guard_hut_a', x: 24.5, z: 142, rot: deg(-2.2), w: 3, d: 3, h: 2.6 },
  mast('mast_nw', 16, 45.5), mast('mast_mw', 24, 83), mast('mast_mm', 36, 100.5), mast('mast_sw', 20, 142), mast('mast_sc', 44, 142),
  { id: 'buoy_sw', type: 'sign', variant: 'buoy_red', x: 2, z: 176, r: 0.8, h: 1.5, block: 0 },
  { id: 'rocks_se', type: 'cliff', variant: 'coastal_granite', points: T6_ROCKS, h: 6 },
];

const DOCK_N = [
  { id: 'crane_1', type: 'bunker', variant: 'crane_dock_portal', x: 32, z: 37, rot: deg(225), w: 1.2, d: 1.2, h: 18, mat: 'metalRust', block: 2 },
  { id: 'fuel_1', type: 'fueltank', variant: 'fuel_tank_horizontal', label: 'Fuel tank', x: 76, z: 33.5, rot: 0, w: 12, d: 4.5, h: 5, destructible: true, bombOnly: false, hp: 100 },
  { id: 'fuel_2', type: 'fueltank', variant: 'fuel_tank_horizontal', label: 'Fuel tank', x: 77.5, z: 38.2, rot: 0, w: 11, d: 4.5, h: 5, destructible: true, bombOnly: false, hp: 100 },
  crates('crates_n1', 48, 31.5, 4, 3), barrels('barrels_n1', 54, 33, 4, 5), crates('crates_n2', 54, 37.5, 4, 3),
  crates('crates_3box_1', 64.5, 38), crates('crates_3box_2', 66.5, 41.5), crates('crates_3box_3', 68.5, 44.5),
  crates('crates_n3a', 78, 42), crates('crates_n3b', 81, 42.5),
  // the barrel-and-crate row along the N quay's S edge ("the pile of barrels"): low cover
  { id: 'row_s', type: 'crates', variant: 'crates_barrels_row', x: 50.5, z: 45, rot: 0, w: 15, d: 2, h: 1.4, block: 1 },
  barrels('barrels_n2', 46, 42.5, 2, 3),
];

const DOCK_E = [
  nissen('hut_a', 73.5, 57.5, 12, { flag: true, garrison: true, destructible: true, hp: 100, door: deg(150) }),
  nissen('hut_b', 80.5, 54, 12),
  nissen('hut_c', 84, 63.5, 10),
  { id: 'garage', type: 'garage', variant: 'garage_brick', x: 80, z: 97, rot: 0, w: 10, d: 10, h: 7, open: 'S' },
  crates('sandbags_1', 71.5, 77), { ...crates('crate_e1', 70, 87), rot: deg(4.4) },
  { id: 'sandbags_2', type: 'sandbags', x: 72, z: 97.5, rot: 0, w: 4, d: 3, h: 1.2, block: 1 },
  crates('crates_e2', 84.5, 108, 3, 4), { ...crates('crates_e3', 78, 111, 4, 2), alignFree: 'straddles the S quay kink: kept on the dock grid of the long 180° face' },
  { id: 'launch', type: 'train_car', variant: 'boat_on_cradle', x: 70, z: 70, rot: deg(90), w: 10, d: 5, h: 3, mat: 'greyPaint', block: 2 },
  barrels('barrels_e', 65, 54),
  { id: 'pontoon', type: 'pier', variant: 'pontoon_minisub', x: 55.5, z: 68, rot: 0, w: 9, d: 6 },
  { id: 'crane_2', type: 'bunker', variant: 'crane_dock_portal', x: 53, z: 102, rot: deg(225), w: 1.2, d: 1.2, h: 18, mat: 'metalRust', block: 2 },
  barrels('barrels_m', 33.5, 101, 3, 2),
];

const SOUTH = [
  crates('crate_s1', 75, 145, 4, 5), crates('crate_s2', 61.5, 143, 3, 4), crates('crate_s3', 52.5, 143.5, 3, 4), crates('crates_sc', 46.5, 144.5),
  { ...crates('crate_mw', 12.5, 83.5, 3, 5), rot: deg(2.9) },
  // the two explosive barrels on the S central head (§3.8 row 13 "2 on site")
  { id: 'brl_1', type: 'barrels', variant: 'fuel_explosive', x: 44, z: 151.5, explosive: 'barrel', carriable: true },
  { id: 'brl_2', type: 'barrels', variant: 'fuel_explosive', x: 45.2, z: 152.2, explosive: 'barrel', carriable: true },
];

const STRUCTURES = [...SHIP_AND_GATES, ...DOCK_N, ...DOCK_E, ...SOUTH];

// ---------------------------------------------------------------- enemies (dossier §8; Prima numbers 1–20, 11 = the patrol)
/** Lone walker: PINGPONG between a and b (1.0 m/s), starting at a facing b. */
const walker = (id, prima, a, b, flags = {}) => ({
  id, prima, soldierType: 'soldier', x: a.x, z: a.z, heading: Math.atan2(b.z - a.z, b.x - a.x),
  flags: { investigates: true, ...flags }, route: { type: 'PINGPONG', vel: 1.0, points: [a, b] },
});
/** Post guard: `holds` = returns to his post after a look (holdsPost), else he investigates. */
const sentry = (id, prima, x, z, h, sweep, { holds = false, investigates = true } = {}) => ({
  id, prima, soldierType: 'sentry', x, z, heading: deg(h), flags: { holdsPost: holds, investigates }, post: { heading: deg(h), sweep },
});

/** Patrol 11's shared PINGPONG: the E quay, from the crates by the garage to the fuel depot (dossier §8.3). */
const P11_ROUTE = [P(66, 108, 5, 90), P(66, 95), P(67, 80), P(64, 66), P(62, 48, 5, 270)];
const P11_ALARM_LOOP = [P(62, 52), P(64, 66), P(66, 95), P(64, 66)];
const patrol11 = () => ['p11a', 'p11b', 'p11c'].map((id, k) => ({
  id, prima: 11, soldierType: k ? 'trooper' : 'sergeant', x: 66, z: +(108 + 1.5 * k).toFixed(1), heading: deg(270),
  flags: { investigates: true }, squad: { id: 'p11', leader: 'p11a', columns: 1 },
  route: { type: 'PINGPONG', vel: 1.0, points: P11_ROUTE },
  reactEvents: ['RINT'], alarmRoute: { run: { x: 64, z: 80, vel: 2.7 }, loop: { type: 'LOOP', vel: 1.8, points: P11_ALARM_LOOP } },
}));

const ENEMIES = [
  // ===== the S jetty and the SW mole (Phase 1; outside every zone)
  sentry('e1', 1, 70.5, 144, 270, 45),
  walker('e2', 2, P(68, 147, 4, 270), P(54, 147, 4, 180)),
  sentry('e3', 3, 58.5, 142.5, 270, 60), // 36.4 m from e7's S look at (70,108); his sweep still ends short of e1's post
  walker('e4', 4, P(39.5, 148.5, 6, 180), P(50, 146.5, 3, 0)),
  sentry('e5', 5, 23, 146.5, 0, 50, { holds: true }), // S lock operator, by the shack door
  // ===== the mid-W mole (Phase 2; outside every zone)
  walker('e9', 9, P(9, 84.5, 8, 0), P(8, 79.5, 4, 270)),
  sentry('e10', 10, 22, 88, 0, 60), // 38.6 m from e20 on the pontoon (his body is out of her cone)
  // ===== the main dock, S part (Phases 2–3; z_dock)
  walker('e8', 8, P(33.5, 104.5, 8, 200), P(38, 108, 3, 90)), // W look 200: the R4 ramp (34 m SW) stays out of his sweep
  walker('e6', 6, P(81.5, 108.5, 4, 0), P(74, 108.5, 3, 180)),
  walker('e7', 7, P(70, 108, 3, 90), P(46, 106, 4, 180)),
  ...patrol11(),
  sentry('e12', 12, 72, 90, 180, 60),
  // ===== the main dock, N part: the N quay and the sub pad (Phase 4; z_dock)
  sentry('e13', 13, 33, 46.5, 90, 30, { holds: true }), // N lock operator, outside his shack
  // e14's S-end look 100 (not 90): leaving it he turns N through the W, so his turn never sweeps the e19 kill spot
  // (63.7,66.8) 31 m SE (with look 90 the 176° turn went through the E and caught the GB there)
  walker('e14', 14, P(42, 33, 4, 270), P(41, 46.5, 4, 100)),
  // e15 paces a short W–E beat along the N face of row_s (Kildread's 10th moving guard), facing N at both ends; it
  // never turns through the S, so the pontoon and the sub pad stay out of his cone as they were from his old post
  walker('e15', 15, P(50.5, 40.5, 8, 270), P(47.5, 40.5, 5, 270)),
  walker('e16', 16, P(83, 45.5, 3, 0), P(64, 34, 4, 225)),
  sentry('e17', 17, 57, 41, 180, 50),
  sentry('e18', 18, 61.5, 59, 90, 40),
  walker('e19', 19, P(62.5, 61.5, 5, 270), P(62.5, 68, 4, 90)), // S end z 68: Patrol 11's S turn is 37 m off
  sentry('e20', 20, 55, 68, 135, 40),
];

// ---------------------------------------------------------------- vehicles (dossier §6.1)
const TANK_CREW = [{ soldierType: 'crew' }, { soldierType: 'crew' }];
/** The tank's alarm drive: out of the door, W past the crates, N along the E quay to the sub pad. */
export const TANK_ROUTE = [[80, 104.5], [75.5, 108.5], [64.5, 108.5], [64, 102], [66, 84], [63.5, 62], [62, 52]]; // S round the parked truck
const VEHICLES = [
  // the inflatable, ready on the ledge's wet rim: §3.8 row 13 lists no carried raft, so it starts deployed here
  // ([K] "unload the pneumatic boat at your starting position"); the Marine can pack and relaunch it as usual.
  // Five seats: every walkthrough rows the whole team (D9)
  { id: 'raft', vehicleType: 'raft', x: 74.5, z: 157.5, heading: deg(180), inflated: true, seats: 5, operators: ['diver'], suspicious: false },
  // the Biber: Marine only, one seat, two torpedoes; moored S of the pontoon
  { id: 'sub', vehicleType: 'minisub', variant: 'biber', x: 51, z: 73, heading: deg(180), seats: 1, operators: ['diver'], driveable: true, suspicious: false },
  // the Opel Blitz parked by the garage (dossier (68.5,104), nudged to (70,104.8) off the tank's route): its job is to
  // close the garage door, a 10 m reverse E [K]
  { id: 'truck', vehicleType: 'truck', variant: 'opel_canvas', x: 70, z: 104.8, heading: deg(180), driveable: true, operators: ['driver'] },
  // the Panzer II on standby in the brick garage (blind until the dock alarm: m13Tick)
  { id: 'pz2', vehicleType: 'panzer2', x: 80, z: 96.5, heading: deg(90), driveable: false, crew: TANK_CREW.map((c) => ({ ...c })), behavior: 'parked',
    dormantUntilAlarm: true }, // no perception before the alarm, also on the first steps after a quick load (M9 precedent)
  // the pier gun on the SW mole head: unmanned; the Driver takes it
  { id: 'pier_gun', vehicleType: 'cannon', x: 16.5, z: 145, heading: deg(112), giro: 180, driveable: true, operators: ['driver'] }, // ±90° about 112
  // the civilian supply boat that cycles the S lock: nobody aboard can fight, nobody can take it
  { id: 'supply', vehicleType: 'patrolboat', variant: 'fishing_boat', x: 31, z: 176, heading: deg(270), driveable: false, suspicious: false },
];
/** The armed patrol boat, spawned by T3 (dossier §6.1 `pboat`). */
const PBOAT_SPAWN = {
  id: 'pboat', x: 60, z: 186, heading: deg(225), driveable: false, crew: [{ soldierType: 'mg' }],
  route: { type: 'LOOP', speed: 2.5, points: [P(40, 174), P(8, 170, 6), P(4, 182), P(30, 184)] },
};

// ---------------------------------------------------------------- commandos (§3.8 row 13, exact)
const COMMANDOS = [
  { role: 'greenberet', x: 79, z: 152.5, heading: deg(270), inventory: { knife: 1, pistol: 1, decoy: 1 } },
  { role: 'sniper', x: 77, z: 154.5, heading: deg(270), inventory: { pistol: 1, sniperRifle: 4 } },
  { role: 'diver', x: 75.5, z: 153, heading: deg(180), inventory: { knife: 1, pistol: 1, harpoon: 1, divingGear: 1 } },
  { role: 'sapper', x: 80.5, z: 156, heading: deg(270), inventory: { pistol: 1, bearTrap: 1, remoteBomb: 1 } },
  { role: 'driver', x: 82.5, z: 154.5, heading: deg(270), inventory: { pistol: 1, firstAid: 6 } },
];

// ---------------------------------------------------------------- zones and garrison (dossier §9)
/** "The right dock": T1 plus a 3 m water margin. */
const Z_DOCK = [[25.5, 28], [87, 28], [87, 116], [27, 116], [26.5, 100], [46, 96.5], [56, 95], [60.5, 82], [57, 76], [50, 75], [50, 63], [57, 62], [57, 53], [25.5, 52]]; // + the sub pontoon
const HUT_DOOR = P(67, 61.5);

const FUEL = ['fuel_1', 'fuel_2'];
/** One tank going up sets off its neighbour on the shared cradle (dossier §10.1). */
const chainFuel = (w, other) => {
  const s = (w.interactables || []).find((i) => (i.tag === other || i.id === other) && !i.destroyed);
  if (s) applyExplosion(w, s.x, s.z, 'barrel', null, { silent: true });
};

// ---------------------------------------------------------------- barbed wire (docs/barbed-wire.md §12)
/** The M4–M20 wire pass: see-through, uncrossable (B.FENCE) runs added where the wire belongs; none crosses a route
 *  or lengthens an approach (tests/unit/wire-placements.test.mjs). Drawn by the map's wire layer (art/wire-obstacles.js). */
const WIRE_PASS = [
  // harbour wire: concertina along the outer faces of the SW mole (by the pier gun) and the empty NW mole (no ramp, no post)
  { id: 'wx_mole_sw', type: 'fence', variant: 'concertina', points: [[1.5, 134.6], [6, 139.4], [11.2, 145]], h: 1.2 },
  { id: 'wx_mole_nw', type: 'fence', variant: 'concertina', points: [[1, 42.2], [6, 42.3], [10, 40.4], [12.8, 41.1]], h: 1.2 },
];

export default {
  id: 'm13',
  campaign: 'BEL',
  title: 'David and Goliath',
  subtitle: 'Le Havre, France · 15 May 1944',
  date: '1944-05-15',
  place: 'The port of Le Havre, France',
  theater: 'coast',
  coneColors: 'green',
  size: [87, 188],
  seed: 1944_0515,
  // farmland fringe (art/terrain/bocage.js): field hedges, crops and orchards on the clear map edges, hedges
  // backing walls (visual only: laid out clear of every gameplay point and route)
  vegetation: { farmland: { crops: 'none', orchards: 0.3 } },
  briefing: {
    historical: 'May 1944. Three years ago the Bismarck sank the Hood and went down on her first sortie, with half the Royal Navy on her heels. Now a copy of her has been finished at Le Havre, and she sails today to guard the Normandy coast. If she reaches the open sea, every landing beach will pay for it.',
    text: 'You will be put ashore on the rocks below the southern jetty. Somewhere in the docks the enemy keeps a small, heavily armed submarine. Take it, bring it within range of the battleship and put a torpedo into the forward part of her hull. While you are there, the fuel tanks beside her berth must go up as well. Then take the inflatable south-west to the red buoy, where you will be picked up. This is a chance to make history. Good luck.',
    objectivesSummary: 'Sink the new battleship with a torpedo in the bow and blow up her fuel tanks. Then row everyone south-west to the red buoy.',
    hints: [
      'The fuel tanks beside the battleship\'s berth must be destroyed too.',
      'Only the Marine can handle the mini-submarine. Its torpedoes run straight ahead, so point its nose at the bow before firing; anywhere further back the armour holds.',
      'The lock gates open for the supply boat when it sounds its horn. A swimmer can follow it through, and the lever in each gate\'s shack keeps that gate open for good.',
      'The quay walls are sheer. Swimmers can only climb out on the slipways.',
      'Anything seen on the big dock on the right brings out the whole garrison.',
      'If the alarm sounds, the tank in the brick garage comes out after the submarine. A truck parked across its door keeps it inside.',
      'A patrol boat comes by at the end. The gun on the south-west pier can sink it.',
      'With the ship and the fuel gone, row everyone out to the buoy in the south-west.',
    ],
  },
  lighting: { sunElevDeg: 40, sunAzimuthDeg: 315, kelvin: 6000, hdri: 'overcast_harbour_noon', fog: 140, lut: 'coast_day' },
  water: { velocity: 0.05, angleDeg: 90, turbulence: 0.15, color: '#13403d' },
  shoreShallowWidth: 0,
  baseTerrain: 'water',
  terrain: TERRAIN,
  markers: [
    // the torpedo must strike the forward hull (bow tip to x 28, S side)
    { ...BOW_HIT, target: SHIP.id },
    // the Sapper's charge point on the S side of the tank cradle [K]
    { id: 'fuel_charge', x: 76, z: 43.5, r: 3, target: FUEL },
  ],
  // placement rule (c): deliberate compound joins (wings, towers, party walls) — joinStructures
  structures: joinStructures([...STRUCTURES, ...WIRE_PASS], [['hut_a', 'hut_b']]),
  items: [],
  interactables: [],
  vehicles: VEHICLES,
  commandos: COMMANDOS,
  enemies: ENEMIES,
  zones: [{ id: 'z_dock', poly: Z_DOCK, onSeen: 'RINT', onHeard: null, siren: true }],
  jails: [],
  // the flagged Nissen hut: two squads on RINT (exit 2.7 m/s, then loop 1.8 m/s)
  barracks: {
    hut_a: { pool: 6, squads: [
      { event: 'RINT', size: 3, exitVel: 2.7, exitRoute: [HUT_DOOR, P(63, 64)], loopVel: 1.8, loop: [P(63, 64), P(66, 95), P(70, 108), P(66, 95), P(63, 64), P(50, 47.5)] },
      { event: 'RINT', size: 3, exitVel: 2.7, exitRoute: [HUT_DOOR, P(60, 47)], loopVel: 1.8, loop: [P(60, 47), P(38, 47.5), P(36, 34), P(62, 36)] },
    ] },
  },
  climbLinks: [
    // the GB's pick up the jetty's face from the start ledge [P][K]
    { id: 'cl_jetty', a: [79, 149.2, 0], b: [79, 151.8, 0], roles: ['greenberet'] },
  ],
  ladders: [],
  triplines: [],
  objectives: [
    { id: 'o_ship', text: 'Torpedo the battleship in the bow', type: 'destroy', targets: [SHIP.id], marker: BOW_HIT.id, required: true, bombOnly: true },
    { id: 'o_fuel', text: 'Destroy the fuel tanks beside her berth', type: 'destroy', targets: FUEL, marker: 'fuel_charge', required: true },
    { id: 'o_buoy', text: 'Row everyone out to the red buoy in the south-west', type: 'escape', required: true },
  ],
  setpieces: [
    QUAY_EDGE,
    { type: 'lock_gate', id: 'lock_s', gate: { rect: { x: 27, z: 145.5, w: 7.5, d: 2 } }, shack: { at: [24.5, 144], id: 'lever_s' },
      operator: 'e5', boat: 'supply', sides: [[31, 163], [31, 127]], period: 45, hornDelay: 3, openTime: 14 },
    { type: 'lock_gate', id: 'lock_n', gate: { rect: { x: 18, z: 47.5, w: 10.5, d: 2 } }, shack: { at: [31, 45], id: 'lever_n' }, operator: 'e13' },
  ],
  triggers: [
    // per-tick glue: raft seats, the tank's eyes and its hunt for the sub
    { on: 'tick', once: false, when: () => true, do: [{ run: (w) => m13Tick(w) }] },
    // T1: the supply boat steams up to the S lock
    { on: 'start', do: [{ drive: 'supply', to: [[31, 163]] }] },
    // T2: the ship going down wakes the whole port; T2b: so does the fuel blast (it is on the dock)
    { on: 'objective', match: { id: 'o_ship', status: 'done' }, delay: 4,
      do: [{ alarm: 'z_dock', x: 24, z: 30, cause: 'torpedo' }, { message: 'The battleship is going down by the bow!', kind: 'objective' }] },
    { on: 'structure:destroyed', match: { id: FUEL }, delay: 0.5, do: [{ alarm: 'z_dock', x: 77, z: 36, cause: 'explosion' }] },
    { on: 'structure:destroyed', match: { id: 'fuel_1' }, delay: 0.2, do: [{ run: (w) => chainFuel(w, 'fuel_2') }] },
    { on: 'structure:destroyed', match: { id: 'fuel_2' }, delay: 0.2, do: [{ run: (w) => chainFuel(w, 'fuel_1') }] },
    // T3: the patrol boat comes in 20 s after the first dock alarm (the ship hit always raises one)
    { on: 'alarm:zone', match: { event: 'RINT' }, delay: 20, do: [{ spawnVehicle: 'patrolboat', spawn: PBOAT_SPAWN }] },
    // T4: the tank drives out after the sub (a truck across the door stops it dead)
    { on: 'alarm:zone', match: { event: 'RINT' }, delay: 1, do: [{ drive: 'pz2', to: TANK_ROUTE }] },
    // T5: a tank hit on the sub is the alarm-fail
    { on: 'vehicle:destroyed', match: { vehicle: 'sub' }, when: (p) => p.source?.tag === 'pz2' || p.source?.vehicle?.tag === 'pz2', do: [{ event: 'SUB_SHELLED' }] },
    // T6: the sub lost any other way before the ship is hit
    { on: 'vehicle:destroyed', match: { vehicle: 'sub' }, delay: 0.2,
      when: (p, w) => !w.objectives?.find((o) => o.id === 'o_ship')?.done && !w.scriptFail,
      do: [{ fail: 'THE MINI-SUBMARINE IS LOST. THE BATTLESHIP CANNOT BE STOPPED.' }] },
    // T7: both torpedoes spent and the ship still afloat (re-checked after 3 s)
    { on: 'tick', when: (p, w) => outOfTorpedoes(w), delay: 3,
      do: [{ run: (w, dir) => { if (outOfTorpedoes(w)) dir.fail('NO TORPEDOES LEFT.'); } }] },
    // T8: a torpedo on the hull aft of the bow zone is wasted
    { on: 'hit', once: false, when: (p) => aftHit(p), do: [{ message: 'Too far aft. The armour held.', kind: 'hint' }] },
    // T9: both objectives done
    { on: 'objective', match: { status: 'done' },
      when: (p, w) => ['o_ship', 'o_fuel'].every((id) => w.objectives?.find((o) => o.id === id)?.done),
      do: [{ message: 'Ship and fuel destroyed. Get everyone into the boat and make for the buoy.', kind: 'objective' }] },
  ],
  extraction: { zone: { x: 3, z: 178, r: 5 } },
  alarmFail: { events: ['SUB_SHELLED'], message: 'THE TANK HAS SUNK THE MINI-SUBMARINE.' },
  par: { time: 720 },
  cameraStart: { x: 72, z: 150, zoom: 1 },
  startDisguised: [],
};
