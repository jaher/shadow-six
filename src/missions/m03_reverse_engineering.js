/**
 * BEL Mission 3 — "Reverse Engineering" (design-spec §7.6 buildable layout). Owned by MISSIONS.
 * Sysendam dam near the Sima hydro plant, Eidfjord, 4 Mar 1941. The reservoir fills the NW corner; the
 * river pours from the dam toe diagonally to the SE. The team starts on the NE plateau behind a ruined
 * wall; a gully between two cliffs leads down to the river. The German camp (zone `z_camp`, event RCAMP)
 * sits on the E bank; the electrified power station and the dam bunker lie on the S bank (zone `z_south`,
 * RINT + siren). The evacuation truck spawns north of the dam once the bunker and the dam are destroyed.
 *
 * Conventions: headings/rot in DEGREES in the spec, converted with deg(); route `look` and `post.sweep` stay in
 * degrees. Briefing text is our own wording (§7.3).
 */

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (enemy-brain reads wp.look * DEG, §4.1)

/** Closed square outline (a 5 × 5 transformer cage). */
const square = (x, z, s = 5) => [[x - s / 2, z - s / 2], [x + s / 2, z - s / 2], [x + s / 2, z + s / 2], [x - s / 2, z + s / 2], [x - s / 2, z - s / 2]];
const CAGES = [];
// the E column stands 1 m west of the old x 56: clear of st_barr2's steps / flagpole and pylon_1's legs
for (const z of [100, 110, 120]) for (const x of [20, 32, 44, 55]) CAGES.push([x, z]);

const E7_LOOP = [P(104, 50), P(138, 50, 3, 90), P(138, 89), P(116, 78), P(104, 64, 3, 180)];

export default {
  id: 'm03',
  campaign: 'BEL',
  title: 'Reverse Engineering',
  subtitle: 'Sysendam dam, Eidfjord, Norway · 4 March 1941',
  date: '1941-03-04',
  place: 'Sysendam dam near the Sima hydro plant, Eidfjord',
  theater: 'snow',
  coneColors: 'green',
  size: [148, 133],
  seed: 1941_0304,
  briefing: {
    historical: 'The Sysendam dam powers the valley\'s plant and carries its only crossing. Bring it down and the Germans lose both power and road for months.',
    text: 'You\'ll come in from the plateau in the north-east. Our charges are already inside the power station south of the river, but the station fence is electrified. Find the switch before your Sapper touches the wire. There\'s a German camp on the east bank; with luck your Spy can borrow a uniform there. Destroy the bunker at the dam and then the dam itself. When it goes, a truck will come for you north of the dam. Mind your step, officer.',
    objectivesSummary: 'Destroy the dam bunker. Demolish the dam. Escape in the truck north of the dam.',
    hints: [
      'The station fence is live; the switch is inside.',
      'The explosives are in the station shed.',
      'A uniform hangs outside the east camp, by the river.',
      'Anything suspicious in the east camp or south of the river raises the alarm.',
      'The bunker gunner turns towards any noise. Give him something to look at before you go behind him.',
      'The truck will wait north of the dam.',
    ],
  },
  lighting: { sunElevDeg: 18, sunAzimuthDeg: 315, kelvin: 6000, hdri: 'overcast', fog: null, lut: 'norway' },
  water: { velocity: 1.0, angleDeg: 42, turbulence: 0.6 }, // tailwater below the dam
  shoreShallowWidth: 2.0,
  baseTerrain: 'snow',
  terrain: [
    // T1 reservoir (NW corner)
    { type: 'poly', terrain: 'water', points: [[0, 0], [44, 0], [47, 16], [45, 22], [25, 40], [10, 42], [0, 41]] },
    // T2 river from the dam toe to the SE corner
    { type: 'path', terrain: 'water', points: [[37, 33], [60, 54], [84, 74], [108, 94], [132, 114], [150, 129]], width: 20 },
    // T3 dam-toe ledge (the auto 2 m rim is added by the builder)
    { type: 'poly', terrain: 'shallow', points: [[31, 33], [39, 26], [42, 29], [34, 36]] },
    // T4 station yard (= fence polygon) and camp interior (= palisade polygon)
    { type: 'poly', terrain: 'ground', points: [[4, 58], [34, 58], [70, 90], [70, 126], [4, 126]] },
    { type: 'poly', terrain: 'ground', points: [[98, 48], [142, 48], [142, 96], [126, 90], [98, 66]] },
    // T5 station road through the W gate; dirt road to the truck pickup north of the dam
    { type: 'path', terrain: 'road', points: [[0, 92], [4, 92], [20, 92], [26, 88]], width: 5, surface: 'snow_packed' },
    { type: 'path', terrain: 'road', points: [[52, 0], [52, 14]], width: 4, surface: 'snow_packed' },
  ],
  // step 3p road network: the works road on to the shed, concrete switchyard under the transformer cages and an
  // apron at the shed doors (station yard = packed ground: no gameplay change), camp tracks on the E bank
  roads: [
    { id: 'works_road', surface: 'snow_packed', points: [[26, 88], [33, 87.5], [40, 88]], width: 4.5, wear: 0.7 },
    { id: 'camp_track', surface: 'snow_packed', points: [[118, 49], [120, 60], [124, 70], [128, 82]], width: 3, wear: 0.5 },
  ],
  pavements: [
    { id: 'switchyard', surface: 'concrete', points: [[14, 95], [59, 95], [59, 125], [14, 125]], cracks: 0.45, weeds: 0.25, patches: 0.15 },
    { id: 'shed_apron', surface: 'concrete', points: [[33, 84.2], [47, 84.2], [47, 91], [33, 91]], cracks: 0.3, patches: 0.2, edge: 'ragged' },
  ],
  // street furniture: visual only in the locked BEL layout
  furniture: [
    { type: 'floodlight', x: 7, z: 61, rot: 0.8, block: false },
    { type: 'floodlight', x: 66.5, z: 96, rot: 2.4, block: false },
    { type: 'floodlight', x: 38, z: 93.5, rot: -Math.PI / 2, block: false },
    { type: 'lamp', variant: 'norway_wood', x: 1.5, z: 95.5, rot: -Math.PI / 2, block: false },
    { type: 'lamp', variant: 'wall_lamp', x: 19.05, z: 70, rot: 0, hooded: true, block: false },
    { type: 'lamp', variant: 'norway_wood', x: 115, z: 64, rot: 0, hooded: true, block: false },
    { type: 'sign', variant: 'plate', x: 7, z: 95.5, rot: 0, text: 'ADGANG\nFORBUDT', block: false },
  ],
  markers: [
    // demolition marker for o2: the bomb must be armed within 3 m
    { id: 'dam_charge', x: 37, z: 31, r: 3, target: 'dam' },
  ],
  structures: [
    // --- dam and bunker (objectives, bomb only). The crest is a walkable deck (bridge cells).
    { id: 'dam', type: 'dam', variant: 'concrete_arch', x: 35, z: 31, rot: deg(318), w: 27, d: 4, h: 14, deck: true,
      destructible: true, bombOnly: true, marker: 'dam_charge', hp: 100, destroyFx: ['collapse', 'flood', 'removeCrest'],
      // the surge drowns the toe ledge (T3) + its rim: with the crest gone the two banks are split
      floodPoly: [[29.5, 33], [39, 24.5], [43.5, 29], [34, 37.5]] },
    { id: 'dam_bunker', type: 'bunker', variant: 'surveillance', x: 19, z: 46, rot: deg(315), w: 5, d: 4, h: 2.4,
      destructible: true, bombOnly: true, hp: 100, crew: ['e34'] },
    // --- the power station (S bank): electrified chain-link fence with a N gap (x 24–28) and the W gate
    { id: 'st_fence', type: 'fence', variant: 'electric', h: 2.5, powered: true, poweredBy: 'fence_switch', cuttable: true,
      segments: [[[28, 58], [34, 58], [70, 90], [70, 126], [4, 126], [4, 94]], [[4, 90], [4, 58], [24, 58]]] },
    { id: 'gate_w', type: 'gate', variant: 'chainlink', x: 4, z: 92, rot: deg(270), w: 4, open: true },
    { id: 'st_admin', type: 'house', variant: 'admin_brick', x: 14, z: 68, rot: 0, w: 10, d: 7, h: 6,
      switches: [{ id: 'fence_switch', x: 19.5, z: 68, activation: 1.0, controls: 'st_fence', on: true, roles: null }] },
    { id: 'st_barr1', type: 'barracks', x: 16, z: 82, rot: 0, w: 12, d: 6, h: 4.5, flag: true, garrison: true },
    { id: 'st_shed', type: 'hangar', variant: 'shed', x: 40, z: 80, rot: 0, w: 12, d: 8, h: 6, doorSide: 'S' },
    { id: 'st_barr2', type: 'barracks', x: 64, z: 108, rot: deg(90), w: 12, d: 7, h: 4.5, flag: true, garrison: true },
    // 12 transformer cages (5 × 5 fence + a transformer each; sparking FX, hum SFX)
    ...CAGES.map(([x, z], k) => ({ id: `cage_${k + 1}`, type: 'fence', variant: 'square', points: square(x, z), h: 2.2, sparks: true })),
    ...CAGES.map(([x, z], k) => ({ id: `transformer_${k + 1}`, type: 'generator', variant: 'transformer', x, z, rot: 0, w: 2, d: 1.4, h: 2.0, hum: true })),
    { id: 'mg_gate', type: 'sandbags', variant: 'mg_ring', x: 10, z: 99, rot: deg(180), ring: { r: 1.8 }, h: 1.0, block: 1 },
    ...[[30, 72], [31.5, 73.5], [56, 94]].map(([x, z], k) => ({ id: `drum_${k + 1}`, type: 'crates', variant: 'cable_drum', x, z, rot: 0, w: 1.5, d: 1.5, h: 1.5, block: 1 })),
    { id: 'sign_w', type: 'sign', x: 2, z: 88, rot: 0, text: 'SIMA KRAFTVERK' },
    ...[[60, 122], [80, 100], [95.64, 62.27]].map(([x, z], k) => ({ id: `pylon_${k + 1}`, type: 'telegraph_pole', variant: 'lattice_pylon', x, z, h: 18, r: 0.6, wireTo: k < 2 ? `pylon_${k + 2}` : null })),
    // --- the north: cliffs with the gully (x 74–84) between them, and the start wall on the plateau
    { id: 'cliff_e', type: 'cliff', points: [[84, 20], [148, 20], [148, 34], [124, 38], [84, 42]], h: 12, climbable: false },
    { id: 'cliff_w', type: 'cliff', points: [[56, 18], [74, 18], [74, 34], [56, 30]], h: 10, climbable: false },
    { id: 'start_wall', type: 'ruins', variant: 'wall_ruin', x: 108, z: 8, rot: 0, w: 16, d: 1.5, h: 1.6, block: 2 },
    // --- the German camp (E bank): palisade with a N gate (x 116–120) and a W gate (z 55–59)
    { id: 'camp_wall', type: 'wall', variant: 'palisade', h: 2.4, width: 0.5,
      segments: [[[120, 48], [142, 48], [142, 96], [126, 90], [98, 66], [98, 59]], [[98, 55], [98, 48], [116, 48]]] },
    { id: 'camp_barr', type: 'hut', variant: 'log_cabin', x: 122, z: 58, rot: 0, w: 7, d: 5, h: 3.5, flag: true, garrison: true },
    ...[[108, 54], [116, 68], [133, 63], [132, 82]].map(([x, z], k) => ({ id: `cabin_${k + 1}`, type: 'hut', variant: 'log_cabin', x, z, rot: 0, w: 6, d: 5, h: 3.5, snowRoof: true })),
    { id: 'well', type: 'well', x: 124, z: 72, rot: 0, r: 0.8 },
    { id: 'spools', type: 'crates', variant: 'cable_drum', x: 114, z: 61, rot: 0, w: 1.5, d: 1.5, h: 1.5, block: 1 },
    { id: 'camp_tent', type: 'tent', x: 132, z: 43, rot: 0, w: 4, d: 4, flag: true, garrison: true },
    { id: 'tent2', type: 'tent', x: 141, z: 42, rot: 0, w: 4, d: 4 },
    ...[[48.77, 6.55], [58, 8], [90, 6], [130, 6], [140, 10], [6, 50], [2, 70], [90, 48], [146, 60]]
      .map(([x, z], k) => ({ type: 'pine', x, z, r: 0.6, h: 9 + (k % 6), seed: 401 + k })),
  ],
  items: [
    { id: 'bombs_shed', itemId: 'timeBomb', x: 37.58, z: 86.17, count: 2 }, // beside the shed's ramp, not on it
  ],
  // §3.4/§7.6 the Spy's uniform hangs on a clothesline: 'use' it (1.5 s activation) and she is dressed at once
  interactables: [
    { id: 'uniform_line', interactKind: 'clothesline', x: 114, z: 82.5 },
  ],
  vehicles: [
    { id: 'raft', vehicleType: 'raft', x: 64, z: 45, heading: deg(90), inflated: true, suspicious: false, operators: ['diver'] },
  ],
  commandos: [
    { role: 'greenberet', x: 103, z: 3.5, heading: deg(90), inventory: { knife: 1, pistol: 1, decoy: 1, shovel: 1 } },
    { role: 'diver', x: 106, z: 3.5, heading: deg(90), inventory: { knife: 1, pistol: 1, harpoon: 1, divingGear: 1, inflatableBoat: 0 } },
    { role: 'sapper', x: 110, z: 3.5, heading: deg(90), inventory: { pistol: 1, bearTrap: 1, wireCutters: 1, timeBomb: 0 } },
    { role: 'spy', x: 113, z: 3.5, heading: deg(90), inventory: { pistol: 1, lethalInjection: 1, firstAid: 6 } },
  ],
  enemies: [
    // patrol p1 along the plateau, 4 m in front of the start wall
    ...[['e1', 62, 13], ['e2', 60.5, 13], ['e3', 59, 13]].map(([id, x, z], k) => ({
      id, prima: 1 + k, soldierType: k ? 'trooper' : 'sergeant', x, z, heading: deg(0), jail: 'camp_barr',
      squad: { id: 'p1', leader: 'e1', columns: 1 },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(62, 13, 6, 180), P(146, 13, 6, 0)] },
    })),
    // the gully down to the river
    { id: 'e4', prima: 4, soldierType: 'sentry', x: 79, z: 22, heading: deg(200), flags: { holdsPost: true, investigates: false }, post: { heading: deg(200), sweep: 35 } },
    { id: 'e5', prima: 5, soldierType: 'sentry', x: 77, z: 36, heading: deg(210), flags: { investigates: true, holdsPost: false }, post: { heading: deg(210), sweep: 40 } },
    { id: 'e6', prima: 6, soldierType: 'sentry', x: 80, z: 56, heading: deg(150), flags: { holdsPost: true, investigates: false }, post: { heading: deg(150), sweep: 25 } },
    // the east camp
    { id: 'e7', prima: 7, soldierType: 'soldier', x: 104, z: 50, heading: deg(0), flags: { investigates: true, followsTracks: true },
      route: { type: 'LOOP', vel: 1.0, points: E7_LOOP } },
    { id: 'e8', prima: 8, soldierType: 'soldier', x: 126, z: 46.5, heading: deg(0), flags: { investigates: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(126, 46.5, 4, 270), P(147, 46.5, 4, 270)] } },
    { id: 'e9', prima: 9, soldierType: 'sentry', x: 118, z: 46, heading: deg(270), flags: { holdsPost: true, investigates: false }, post: { heading: deg(270), sweep: 45 } },
    { id: 'e10', prima: 10, soldierType: 'soldier', x: 104, z: 60, heading: deg(10), flags: { investigates: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(104, 60, 3, 180), P(126, 64, 3, 0)] } },
    { id: 'e11', prima: 11, soldierType: 'sentry', x: 130, z: 70, heading: deg(180), flags: { investigates: true, holdsPost: false }, post: { heading: deg(180), sweep: 50 } },
    { id: 'e12', prima: 12, soldierType: 'sentry', x: 101, z: 57, heading: deg(180), flags: { holdsPost: true, investigates: false }, post: { heading: deg(180), sweep: 35 } },
    { id: 'e13', prima: 13, soldierType: 'sentry', x: 138, z: 92, heading: deg(135), flags: { investigates: true, holdsPost: false }, post: { heading: deg(135), sweep: 40 } },
    { id: 'e14', prima: 14, soldierType: 'sentry', x: 103, z: 72, heading: deg(225), flags: { holdsPost: true, investigates: false }, post: { heading: deg(225), sweep: 40 } },
    // the power-station bank, outside the fence
    { id: 'e15', prima: 15, soldierType: 'soldier', x: 1.5, z: 62, heading: deg(90), flags: { investigates: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(1.5, 62, 4, 90), P(1.5, 124, 4, 270)] } },
    { id: 'e16', prima: 16, soldierType: 'soldier', x: 8, z: 129.5, heading: deg(0), flags: { investigates: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(8, 129.5, 4, 0), P(68, 129.5, 4, 180)] } },
    // inside the station
    { id: 'e17', prima: 17, soldierType: 'sentry', x: 50, z: 74, heading: deg(315), flags: { holdsPost: true, investigates: false }, post: { heading: deg(315), sweep: 45 } },
    { id: 'e18', prima: 18, soldierType: 'sentry', x: 26, z: 61, heading: deg(270), flags: { investigates: true, holdsPost: false }, post: { heading: deg(270), sweep: 35 } },
    { id: 'e19', prima: 19, soldierType: 'soldier', x: 24, z: 64, heading: deg(78), flags: { investigates: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(24, 64, 3, 0), P(30, 92, 3, 90)] } },
    { id: 'e20', prima: 20, soldierType: 'sentry', x: 28, z: 80, heading: deg(45), flags: { investigates: true, holdsPost: false }, post: { heading: deg(45), sweep: 50 } },
    { id: 'e21', prima: 21, soldierType: 'sentry', x: 64, z: 96, heading: deg(180), flags: { holdsPost: true, investigates: false }, post: { heading: deg(180), sweep: 40 } },
    { id: 'e22', prima: 22, soldierType: 'sentry', x: 7, z: 90, heading: deg(180), flags: { holdsPost: true, investigates: false }, post: { heading: deg(180), sweep: 35 } },
    { id: 'e23', prima: 23, soldierType: 'soldier', x: 8, z: 95.5, heading: deg(0), flags: { holdsPost: true, investigates: false },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(8, 95.5, 3), P(15, 95.5, 3)] } },
    ...[['e24', 14.33, 87.68, 200, true], ['e25', 6, 104, 180, false], ['e26', 12, 108, 180, true], ['e27', 8, 116, 135, false]]
      .map(([id, x, z, h, inv], k) => ({ id, prima: 24 + k, soldierType: 'sentry', x, z, heading: deg(h),
        flags: { investigates: inv, holdsPost: !inv }, post: { heading: deg(h), sweep: 40 } })),
    { id: 'e28', soldierType: 'mg', x: 10, z: 99, heading: deg(180), post: { heading: deg(180), sweep: 50, giro: 180 } },
    // patrol p5 (sergeant + 4 troopers, 2 columns) circling the NW by the N gate; RINT → run to (26,56), then resume
    ...[['e29', 2, 49], ['e30', 1.2, 48.2], ['e31', 1.2, 49.8], ['e32', 0.5, 48.2], ['e33', 0.5, 49.8]].map(([id, x, z], k) => ({
      id, soldierType: k ? 'trooper' : 'sergeant', x, z, heading: deg(14), jail: 'st_barr1', reactEvents: ['RINT'],
      squad: { id: 'p5', leader: 'e29', columns: 2 },
      route: { type: 'LOOP', vel: 1.0, points: [P(2, 49), P(14, 52), P(30, 54, 4, 270), P(10, 55), P(2, 49)] },
      alarmRoute: { run: { x: 26, z: 56, vel: 3 }, resume: true },
    })),
    // the dam bunker's crew (vision `bunker`: near 18, far 36, 40°, sweep 50) facing NE over the dam
    { id: 'e34', soldierType: 'crew', x: 19, z: 46, heading: deg(315), structure: 'dam_bunker', firesOnSight: true,
      vision: { fov: 40, near: 18, far: 36, sweep: 50 }, post: { heading: deg(315), sweep: 50 } },
  ],
  zones: [
    { id: 'z_camp', poly: [[86, 40], [148, 36], [148, 110], [128, 102], [90, 76]], onSeen: 'RCAMP', onHeard: 'RCAMP', siren: false },
    { id: 'z_south', poly: [[0, 44], [24, 42], [30, 50], [45, 53.8], [60, 67.5], [84, 87.5], [108, 107.5], [120, 117.5], [136, 133], [0, 133]],
      onSeen: 'RINT', onHeard: 'RINT', siren: true },
  ],
  jails: ['camp_barr', 'st_barr1'],
  barracks: {
    camp_barr: { pool: 10, squads: [{ event: 'RCAMP', size: 3, exitRoute: [P(122, 61)], loop: E7_LOOP }] },
    camp_tent: { pool: 5, squads: [{ event: 'RCAMP', size: 2, exitRoute: [], loop: [P(124, 46.5), P(147, 46.5), P(147, 70), P(144, 70)] }] },
    st_barr1: { pool: 10, squads: [{ event: 'RINT', size: 3, exitRoute: [], loop: [P(24, 61), P(6, 61), P(6, 76), P(28, 76)] }] },
    st_barr2: { pool: 10, squads: [{ event: 'RINT', size: 3, exitRoute: [], loop: [P(69, 96), P(69, 124.5), P(16, 124.5), P(16, 96)] }] },
  },
  climbLinks: [],
  ladders: [],
  triplines: [],
  objectives: [
    { id: 'o1', text: 'Destroy the dam bunker', type: 'destroy', targets: ['dam_bunker'], required: true, bombOnly: true },
    { id: 'o2', text: 'Demolish the dam', type: 'destroy', targets: ['dam'], marker: 'dam_charge', required: true, bombOnly: true },
    { id: 'o3', text: 'Escape in the truck north of the dam', type: 'escape', required: true, vehicleId: 'evac_truck' },
  ],
  // the friendly truck spawns off-map when o1 and o2 are done, drives to (52,12) at 6 m/s and waits;
  // once everyone is aboard it drives off north (ESC skips)
  extraction: {
    vehicleId: 'evac_truck', vehicleType: 'truck', friendly: true, seats: 6, spawnWhen: ['o1', 'o2'],
    spawnAt: { x: 52, z: -6, heading: deg(90) }, arrive: { x: 52, z: 12, speed: 6 }, exit: { x: 52, z: 0, r: 3 },
  },
  par: { time: 720 },
  cameraStart: { x: 108, z: 14, zoom: 1 },
  startDisguised: [], // the Spy starts WITHOUT the uniform (clothesline at the east camp)
};