/**
 * BEL Mission 6 — "Menace of the Leopold" (buildable layout: docs/missions/m06.md). Owned by MISSIONS.
 * Masi, Finnmark, northern Norway, 10 May 1941. Flat inland plateau in early spring: green ground with
 * residual snow drifts. A German exercise base; the K5 railway gun "Leopold" stands on the main line in the
 * E. The team (GB, Sniper, Sapper) starts behind the rocks in the NW corner; the bombed-out log manor W of
 * the compound is the way in (walkable upper floor, y 3.2). One silent zone `z_base` covers everything but
 * the start corner and the cratered SW practice field: being SEEN raises the siren, noise alone never does
 * (`onHeard: null`), which keeps the no-alarm armoured-car bomb at the W turn-round possible. Destroying the
 * gun (remote bomb at `leopold_charge`) calls a friendly truck in from the NE corner; it stops NE of the
 * Gatling nest and waits. The Gatling fires on it; losing the truck loses the mission (game.js §8.1).
 *
 * Conventions: headings/rot in DEGREES in the dossier, converted with deg(); route `look` and `post.sweep`
 * stay in degrees (0 = E, 90 = S, 180 = W, 270 = N). Briefing text is our own wording (§7.3).
 *
 * Deviations from the dossier (grid fit, see the commit message): start rocks moved to (6,17) so the team
 * starts W/N of them rather than inside them, and e1's W turn to (13,23) so the rocks screen the start; the
 * gun's charge marker (ladder foot) sits beside the carriage, SW side, 4 m in from its NW end (the dossier
 * point fell inside the carriage footprint, and past a 30 m target's explosion candidate radius); the round towers use a plain round prop (the catalogue watchtower is a climbable deck);
 * `ladders[].kind: 'stairs'` and `extraction.boardWhileMoving` are carried as data for the engine deltas
 * D-E1/D-E2 (ignored today: plain ladder links, the truck stops and waits).
 */

import { joinStructures } from './schema.js';
const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (enemy-brain reads wp.look * DEG, §4.1)

/** Deck heights (m): the two bombed log houses' upper floors and the HQ's flat roof section. */
const DECK = 3.2;
const HQ_ROOF = 6.5;

/**
 * The Leopold on the main line: centre, rotation (deg), carriage length. The charge marker is the foot of the
 * carriage ladder: on its SW (compound) side, 4 m in from the NW end, 1 m clear of the carriage. It stays within
 * 11.5 m of the gun's centre so every bomb inside the 3 m marker circle is in applyExplosion's candidate radius.
 */
const GUN = { x: 110, z: 66, rot: 45, w: 30, d: 5 };
const GUN_AX = [Math.cos(deg(GUN.rot)), Math.sin(deg(GUN.rot))];
const GUN_SW = [GUN_AX[1], -GUN_AX[0]].map((v) => -v); // unit normal towards the SW side
const CHARGE_ALONG = -(GUN.w / 2 - 4), CHARGE_OFF = GUN.d / 2 + 1;
const CHARGE = {
  x: +(GUN.x + GUN_AX[0] * CHARGE_ALONG + GUN_SW[0] * CHARGE_OFF).toFixed(2),
  z: +(GUN.z + GUN_AX[1] * CHARGE_ALONG + GUN_SW[1] * CHARGE_OFF).toFixed(2),
};

/**
 * Round towers (log or stone): the catalogue's round tower prop (`minaret`: tapered shaft + gallery ring, honours
 * `mat`), B.HIGH, not climbable (nothing in the sources climbs them; `watchtower` would add a deck + climb marker).
 * `variant` keeps the building-inventory look for the building library.
 */
const tower = (id, x, z, r, h, mat = 'woodDark', variant = 'tower_round_log') =>
  ({ id, type: 'minaret', variant, x, z, rot: 0, r, h, mat, block: 2 });

/** Czech hedgehog (road barricade / wire belts): low, blocks movement, see-through above 1 m. */
const hedgehog = (id, x, z) => ({ id, type: 'crates', variant: 'czech_hedgehog', x, z, rot: deg(45), w: 1.4, d: 1.4, h: 1.2, block: 1 });

/**
 * Walls standing on a deck (dossier §5.1: the W ruin's broken parapets and interior partitions). The elevation pass
 * clears the block of every cell under a walkable deck, so a deck wall is a `walkways` strip raised above the deck:
 * cells more than LOS_CLEAR (1 m) above both ends of a sight line block it like B.HIGH, and any step over MAX_STEP
 * blocks movement. Partitions stand 2.2 m above the deck (block sight and movement); parapets 1 m (block movement
 * only: a man standing on the deck still sees and is seen over them). The mesh is a wall rising from the ground.
 */
const deckWall = (id, points, above, width = 0.5) =>
  ({ id, type: 'wall', variant: above > 1.5 ? 'log_partition' : 'log_parapet_broken', mat: 'woodDark', points, h: DECK + above, width,
    walkways: [{ points, width, y: DECK + above }] });

// garrison loops (released on RINT, §9 of the dossier)
const CHAPEL_LOOP = [P(78, 28), P(100, 35), P(90, 42), P(72, 33)];
const BARRC_LOOP = [P(50, 62), P(80, 62), P(80, 52), P(50, 54)];
const HQ_LOOP = [P(103, 81), P(104, 68), P(96, 62), P(80, 64), P(78, 88), P(100, 88)];

export default {
  id: 'm06',
  campaign: 'BEL',
  title: 'Menace of the Leopold',
  subtitle: 'Masi, Finnmark, Norway · 10 May 1941',
  date: '1941-05-10',
  place: 'Masi, Finnmark, northern Norway',
  theater: 'temperate',
  coneColors: 'green',
  size: [132, 105],
  seed: 1941_0510,
  briefing: {
    historical: 'May 1941. Within weeks Germany will march on the Soviet Union, and even in the far north of Norway its troops are rehearsing for it. Among them is a monster of a railway gun, the Leopold, shelling Resistance hideouts in the hills before it is sent east. It must never get there.',
    text: 'There is little to tell you this time. You will come in from the north-west. Reach that gun by whatever route you can find and wreck it for good. As soon as it goes up, one of our trucks will collect you in the north-east. Their headquarters stands just south of the gun: keep well away from it. I do not want to hear that gun fire again. Good luck.',
    objectivesSummary: 'Destroy the Leopold railway gun. Then get everyone aboard the truck in the north-east.',
    hints: [
      'The bombed-out manor in the north-west is the way in. Your Green Beret can climb its broken wall.',
      'Anyone seen between the ruined manor and the gun raises the alarm. Only the cratered field in the south-west is quiet.',
      'The armoured car could probably be destroyed out in the south-west field without anyone sounding the alarm.',
      'The gun must be blown at the foot of its ladder, on the south-west side of the carriage near its north-west end.',
      'When the gun is gone, a friendly truck will come for you from the north-east.',
      'Their guns can shoot the truck to pieces. Clear its approach first, and mind the machine gun by the spur line.',
    ],
  },
  lighting: { sunElevDeg: 28, sunAzimuthDeg: 315, kelvin: 6000, hdri: 'spring_broken_cloud', fog: 180, lut: 'norway_spring' },
  water: null,
  baseTerrain: 'grass',
  terrain: [
    // T2 the road (W stub dead-ends at the barricade; it passes under the gun at the level crossing)
    { type: 'path', terrain: 'road', points: [[0, 30], [22, 50], [44, 70], [55, 83], [65, 92], [75, 97], [85, 96], [95, 86], [110, 72], [120, 62], [132, 52]], width: 6 },
    // T3 compound yard (trodden earth) and T4 the SW practice field
    { type: 'poly', terrain: 'ground', points: [[38, 52], [46, 40], [66, 38], [80, 40], [96, 52], [100, 62], [88, 68], [80, 84], [70, 80], [58, 80]] },
    { type: 'poly', terrain: 'ground', points: [[0, 50], [26, 56], [44, 74], [44, 104], [0, 104]] },
    // T6 residual snow drifts (footprints show on snow)
    { type: 'poly', terrain: 'snow', points: [[0, 0], [26, 0], [24, 10], [12, 12], [0, 10]] },
    { type: 'poly', terrain: 'snow', points: [[4, 18], [14, 20], [16, 30], [8, 30]] },
    { type: 'poly', terrain: 'snow', points: [[58, 0], [68, 0], [68, 12], [60, 12]] },
    { type: 'poly', terrain: 'snow', points: [[88, 4], [104, 0], [130, 0], [130, 14], [112, 22], [104, 28], [92, 30], [88, 20]] },
    { type: 'poly', terrain: 'snow', points: [[0, 90], [28, 88], [30, 105], [0, 105]] },
    { type: 'poly', terrain: 'snow', points: [[8, 60], [22, 60], [22, 66], [8, 66]] },
    { type: 'poly', terrain: 'snow', points: [[50, 95], [66, 95], [66, 105], [50, 105]] },
    { type: 'poly', terrain: 'snow', points: [[104, 82], [112, 82], [112, 90], [104, 92]] },
    { type: 'poly', terrain: 'snow', points: [[118, 94], [132, 90], [132, 105], [116, 105]] },
  ],
  markers: [
    // demolition marker for o1: the remote bomb must go off within 3 m of the foot of the gun's ladder
    { id: 'leopold_charge', x: CHARGE.x, z: CHARGE.z, r: 3, target: 'leopold' },
  ],
  // placement rule (c): the towers, lean-to and tent pair below are deliberate joins (joinStructures)
  structures: joinStructures([
    // --- the W ruin (the way in): roofless 2-storey log manor, whole footprint a walkable upper floor at y 3.2
    { id: 'ruin_w', type: 'flat_roof_house', variant: 'house_bombed_log', x: 32, z: 35.5, rot: 0, w: 24, d: 21, h: DECK, roofY: DECK, mat: 'woodDark', roofWalk: true },
    // its upper floor (x 20–44, z 25–46): parapets round the edge, open at the climb spot, the ladder and both stair
    // heads; partitions: the N room (e2, e3) walled off from the middle, a W passage from the climb spot (fan map)
    ...[
      ['rw_pn', [[20.3, 25.3], [43.7, 25.3]]], ['rw_pw1', [[20.3, 25.3], [20.3, 34]]], ['rw_pw2', [[20.3, 38], [20.3, 45.7]]],
      ['rw_ps1', [[20.3, 45.7], [28, 45.7]]], ['rw_ps2', [[32, 45.7], [43.7, 45.7]]],
      ['rw_pe1', [[43.7, 25.3], [43.7, 25.8]]], ['rw_pe2', [[43.7, 29], [43.7, 31.5]]], ['rw_pe3', [[43.7, 35.5], [43.7, 40]]],
    ].map(([id, pts]) => deckWall(id, pts, 1.0, 0.4)),
    ...[
      ['rw_n1', [[24.5, 32.5], [31, 32.5]]], ['rw_n2', [[33, 32.5], [38, 32.5]]], ['rw_w', [[24.5, 32.5], [24.5, 39.5]]],
    ].map(([id, pts]) => deckWall(id, pts, 2.2)),
    // the grandfather clock by e2 (cover on the deck: bodies are hidden behind it [K][P])
    { id: 'rw_clock', type: 'crates', variant: 'grandfather_clock', x: 22.5, z: 27.5, rot: 0, w: 0.8, d: 0.5, h: DECK + 2.0, block: 2,
      walkways: [{ points: [[22.2, 27.5], [22.8, 27.5]], width: 0.6, y: DECK + 2.0 }] },
    tower('turret_w', 17.5, 29, 2.5, 8),
    // --- the NE ruin (second bombed house), held by e31–e33 on its upper floor; W and E turrets
    { id: 'ruin_ne', type: 'flat_roof_house', variant: 'house_bombed_log', x: 120, z: 44, rot: 0, w: 20, d: 16, h: DECK, roofY: DECK, mat: 'woodDark', roofWalk: true },
    tower('ruin_ne_tw', 107.5, 44.5, 2.5, 8),
    tower('ruin_ne_te', 132, 42, 2, 8),
    // --- the three garrisons (Kildread's "3 Bunkers"): chapel (N), central barracks, HQ (S of the gun)
    { id: 'chapel', type: 'barracks', variant: 'stone_chapel_tower', x: 75, z: 12.5, rot: 0, w: 14, d: 8, h: 8, mat: 'stone', flag: true, garrison: true, destructible: true, hp: 100 },
    tower('chapel_tower', 84, 14, 2.5, 10, 'stone', 'tower_round_stone'),
    { id: 'barr_c', type: 'barracks', variant: 'hq_log_flatroof', x: 59, z: 48, rot: 0, w: 14, d: 10, h: 5, flag: true, garrison: true, destructible: true, hp: 100 },
    { id: 'hq', type: 'flat_roof_house', variant: 'fortified_block_tower', x: 90, z: 77, rot: 0, w: 16, d: 12, h: HQ_ROOF, roofY: HQ_ROOF, mat: 'stone', roofWalk: true, flag: true, garrison: true, destructible: true, hp: 100 },
    tower('hq_tower', 100, 76, 2.5, 10, 'stone', 'tower_round_stone'),
    { id: 'hq_leanto', type: 'hut', variant: 'lean_to_canopy', x: 78.5, z: 80, rot: 0, w: 5, d: 5, h: 3, block: 1 },
    { id: 'ruin_s', type: 'ruins', variant: 'burned_timber', x: 46, z: 92, rot: 0, w: 10, d: 8, h: 2.5 },
    tower('tower_nw', 46.5, 40, 2.25, 7),
    tower('tower_s', 58.5, 80, 2.25, 7),
    // --- railway: main line NW → SE with the gun on it, dead-end spur NE; parked wagons (no traffic)
    { id: 'rail_main', type: 'rail_track', points: [[46, 2], [58, 12], [72, 24], [80, 33], [88, 43], [100, 55], [110, 66], [125, 80], [133, 88]] },
    { id: 'rail_spur', type: 'rail_track', points: [[72, 24], [80, 28.5], [88, 31], [100, 32], [110, 30], [120, 22], [130.5, 10.5]] },
    { id: 'leopold', type: 'railway_gun', variant: 'railway_gun_k5', x: GUN.x, z: GUN.z, rot: deg(GUN.rot), w: GUN.w, d: GUN.d, h: 6,
      label: 'The Leopold railway gun', barrelElevDeg: 30, // barrel raised ~30°, muzzle SE (art: building library)
      destructible: true, bombOnly: true, marker: 'leopold_charge', hp: 100, destroyFx: ['bigBlast', 'barrelDrop', 'fire'] },
    { id: 'wagon_cov', type: 'train_car', variant: 'covered_goods', x: 86, z: 42.5, rot: deg(50), w: 8, d: 3, h: 3.5 },
    { id: 'flatcar_aa', type: 'train_car', variant: 'flatcar_tarp', x: 93, z: 48, rot: deg(45), w: 8, d: 3, h: 2.5 },
    { id: 'flatcar_logs', type: 'train_car', variant: 'flatcar_logs', x: 58, z: 12, rot: deg(40), w: 8, d: 3, h: 2 },
    { id: 'cart_n', type: 'train_car', variant: 'tip_cart', x: 48.5, z: 3.5, rot: deg(40), w: 3, d: 2, h: 1.5, block: 1 },
    // --- walls (stone with an iron-railing top), barbed wire, the road barricade
    ...[
      ['w_x1', [[48, 17], [66, 37]]], ['w_x2', [[46, 37], [63, 24]]], ['w_n', [[55, 3], [65, 14]]], ['w_nn', [[30, 0], [35, 10]]],
      ['w_sw', [[38, 53], [57, 77]]], ['w_s', [[61, 79.75], [72, 79.75]]], ['w_brk', [[70, 51], [74, 43], [78, 51]]], ['w_ch', [[86, 16], [92, 27]]],
      ['w_hq', [[100, 70], [106, 65]]], ['w_gun', [[120, 68], [126, 77]]], ['w_ne', [[113, 53], [114.9, 52]], [[130, 44.05], [132, 43]]], ['w_yard', [[0, 45], [9, 40], [10, 47]]],
    ].map(([id, points, rest]) => ({ id, type: 'wall', variant: 'stone_railing', mat: 'stone', ...(rest ? { segments: [points, rest] } : { points }), h: 2.2, width: 0.5 })),
    // (w_ne stops at ruin_ne's walls: inside, the ruin's upper floor is the way across)
    { id: 'wire_n', type: 'fence', variant: 'barbed_wire', points: [[35, 11], [44, 14], [48, 16]], h: 1.2 },
    // the NE belt runs from the chapel wall's gap into the rock pile N of the Gatling: it seals the N edge (fan map)
    { id: 'wire_ne', type: 'fence', variant: 'barbed_wire', points: [[95, 24], [104.5, 6.5], [103.5, 4.5]], h: 1.2 },
    hedgehog('hh_ne1', 97.5, 18.5), hedgehog('hh_ne2', 101, 12),
    { id: 'wire_se', type: 'fence', variant: 'barbed_wire', points: [[92, 88], [113, 96]], h: 1.2 },
    { id: 'wire_bar', type: 'fence', variant: 'barbed_wire', points: [[10, 40], [18, 47]], h: 1.2 },
    hedgehog('hh_1', 12, 41), hedgehog('hh_2', 15, 45), hedgehog('hh_3', 17, 42.5),
    // --- the Gatling: a wheeled gun standing in the open on the snow (fan map), its carriage in front of the gunner
    { id: 'mg_gatling', type: 'crates', variant: 'gatling_wheeled', x: 105.6, z: 15.9, rot: deg(250), w: 1.6, d: 1.2, h: 0.9, block: 1 },
    // --- tents: compound, SW field, SE
    ...[[57, 60], [64, 60], [69, 56], [75, 58], [82, 58], [87, 59], [81, 67], [29, 72], [35, 75], [114, 83], [122, 87], [127, 93]]
      .map(([x, z], k) => ({ id: `tent_${k + 1}`, type: 'tent', variant: 'tent_ridge_field', x, z, rot: 0, w: 4, d: 3 })),
    // --- craters (the SW "explosion marks" of the safe field), rocks, crates, log stack, cart
    ...[[9, 56, 3.5], [15, 71, 3.5], [4, 78, 3.5], [38, 85, 3], [40, 99, 3], [50, 57, 3], [40, 5, 3.5], [98, 97, 3.5]]
      .map(([x, z, r], k) => ({ id: `crater_${k + 1}`, type: 'crater', x, z, r })),
    { id: 'start_rocks', type: 'rocks', x: 6, z: 17, r: 3.5, h: 2.4 },
    { id: 'sw_rocks', type: 'rocks', x: 21, z: 66, r: 4.5, h: 2.6 },
    { id: 'gat_rocks', type: 'rocks', x: 102, z: 3, r: 3.5, h: 2.4 },
    ...[[94, 14], [113, 17], [130, 98], [53, 99]].map(([x, z], k) => ({ id: `rock_${k + 1}`, type: 'rocks', x, z, r: 1.5 })),
    { id: 'se_rocks', type: 'rocks', x: 114, z: 100, r: 3.5, h: 2.4 },
    ...[[49, 17.5], [25, 58], [70, 67], [73, 77]].map(([x, z], k) => ({ id: `crates_${k + 1}`, type: 'crates', x, z, rot: 0, w: 2, d: 2, h: 1.2, block: 1 })),
    { id: 'logs_sw', type: 'crates', variant: 'log_pile', x: 12, z: 62, rot: 0, w: 3, d: 1.5, h: 1.0, block: 1 },
    { id: 'handcart', type: 'crates', variant: 'handcart', x: 25, z: 91, rot: 0, w: 2, d: 1.2, h: 1.0, block: 1 },
    // --- pines (snow under them); (100,21) is the tree e29 walks round (E of the wire belt)
    ...[[8, 3], [13, 8], [20, 6], [4, 26], [65, 5], [92, 7], [100, 21], [113, 12], [123, 14], [127, 18], [126, 25], [131, 24],
      [128, 62], [131, 68], [68, 86], [60, 95], [104, 89], [91, 100], [7, 90], [22, 88], [27, 96], [12, 102], [17, 99]]
      .map(([x, z], k) => ({ type: 'pine', x, z, r: 0.5, h: 9 + (k % 6), seed: 601 + k })),
  ], [['ruin_w', 'turret_w'], ['ruin_w', 'tower_nw'], ['ruin_ne', 'ruin_ne_tw'], ['ruin_ne', 'ruin_ne_te'], ['chapel', 'chapel_tower'], ['hq', 'hq_tower'], ['hq', 'hq_leanto'], ['tent_5', 'tent_6']]),
  items: [],
  interactables: [],
  vehicles: [
    // SdKfz 231 armoured car (enemy): up and down the road between the W turn-round and the HQ bend
    { id: 'sdkfz', vehicleType: 'sdkfz', x: 24, z: 52.5, heading: deg(42), driveable: false, crew: ['e38'],
      route: { type: 'PINGPONG', speed: 3.0, points: [P(24, 52.5, 5), P(44, 70), P(55, 83), P(65, 92), P(75, 97), P(84, 96, 5)] } },
  ],
  commandos: [
    // behind (N/W of) the start rocks in the NW corner
    { role: 'greenberet', x: 2, z: 11.5, heading: deg(0), inventory: { knife: 1, pistol: 1, decoy: 1, shovel: 1 } },
    { role: 'sniper', x: 3.5, z: 13, heading: deg(0), inventory: { pistol: 1, sniperRifle: 5, firstAid: 6 } },
    { role: 'sapper', x: 1.5, z: 14.5, heading: deg(0), inventory: { pistol: 1, bearTrap: 1, remoteBomb: 2, detonator: 1 } },
  ],
  enemies: [
    // ===== Phase 1: the W ruin (upper floor y 3.2) and the NW. Kildread: 13 walkers + 18 sentries + p2 + p3 + MG.
    { id: 'e1', prima: 1, soldierType: 'soldier', x: 13, z: 23, heading: deg(0), flags: { investigates: true, followsTracks: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(13, 23, 3, 180), P(34, 20, 3, 0)] } },
    ...[
      // [id, prima, x, z, heading, sweep, investigates]
      ['e2', 2, 24, 28, 0, 35, false], ['e4', 4, 43, 34, 90, 30, false], ['e6', 6, 42, 43, 90, 35, true],
      ['e8', 8, 30, 44, 90, 35, true], ['e10', 10, 22.5, 42, 135, 30, true],
    ].map(([id, prima, x, z, h, sweep, inv]) => ({ id, prima, soldierType: 'sentry', x, z, y: DECK, heading: deg(h),
      flags: { investigates: inv, holdsPost: !inv }, post: { heading: deg(h), sweep } })),
    ...[
      // [id, prima, a, b] deck walkers
      ['e3', 3, P(27, 31, 3, 90), P(39, 29, 3, 0)], ['e5', 5, P(33, 36, 3, 90), P(40, 38, 4, 45)], ['e7', 7, P(26, 36, 3, 180), P(34, 41, 3, 90)],
    ].map(([id, prima, a, b]) => ({ id, prima, soldierType: 'soldier', x: a.x, z: a.z, y: DECK, heading: Math.atan2(b.z - a.z, b.x - a.x),
      flags: { investigates: true }, route: { type: 'PINGPONG', vel: 1.0, points: [a, b] } })),
    { id: 'e9', prima: 9, soldierType: 'soldier', x: 26, z: 49, heading: deg(0), flags: { investigates: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(26, 49, 3, 180), P(40, 49, 3, 0)] } },
    // the guard by the road barricade (outside the zone; sniped from the ruin's W side)
    // he faces along the road towards the SW field, his back to the ruin, so the GB's climb foot is out of his cone
    { id: 'e11', soldierType: 'sentry', x: 12, z: 48, heading: deg(25), flags: { holdsPost: true, investigates: false }, post: { heading: deg(25), sweep: 40 } },

    // ===== Phase 2: the SW practice field (outside the zone)
    { id: 'e12', prima: 11, soldierType: 'soldier', x: 14, z: 77, heading: deg(10), flags: { investigates: true, followsTracks: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(14, 77, 4, 180), P(31, 80, 4, 0)] } },
    { id: 'e13', prima: 12, soldierType: 'sentry', x: 38, z: 78, heading: deg(200), flags: { investigates: true, holdsPost: false }, post: { heading: deg(200), sweep: 40 } },
    // S of the road, facing E along it: his back is to the armoured car's W turn-round, 14 m off, clear of the car's
    // 9 m blast (a guard killed there leaves a body the investigators find from inside the zone: replay m06 F2)
    { id: 'e14', prima: 13, soldierType: 'sentry', x: 32.5, z: 63.5, heading: deg(40), flags: { holdsPost: true, investigates: false }, post: { heading: deg(40), sweep: 30 } },

    // ===== Phase 3: the compound and the HQ
    // patrol p2 (2 men) round the SW yard
    ...[['e15', 48, 60], ['e16', 47, 61.5]].map(([id, x, z], k) => ({
      id, prima: 14 + k, soldierType: k ? 'soldier' : 'sergeant', x, z, heading: deg(50), jail: 'barr_c', flags: { investigates: true },
      squad: { id: 'p2', leader: 'e15', columns: 2 },
      route: { type: 'LOOP', vel: 1.0, points: [P(48, 60), P(56, 70, 3, 90), P(66, 72), P(70, 64, 3, 0), P(58, 57), P(48, 60)] },
    })),
    // the HQ roof guard (y 6.5): watches the S compound past tower_s; only the Sniper can reach him
    { id: 'e17', prima: 16, soldierType: 'sentry', x: 90, z: 74, y: HQ_ROOF, elevated: true, heading: deg(180),
      flags: { holdsPost: true, investigates: false }, post: { heading: deg(180), sweep: 45 } },
    ...[
      // [id, prima, x, z, heading, sweep, investigates]
      ['e18', 17, 70, 70, 180, 40, false], ['e19', 18, 78, 63, 0, 35, true], ['e20', 19, 82, 46, 180, 35, false],
      ['e21', 20, 97, 58, 200, 45, false], ['e22', null, 78, 45, 90, 40, true],
    ].map(([id, prima, x, z, h, sweep, inv]) => ({ id, ...(prima ? { prima } : {}), soldierType: 'sentry', x, z, heading: deg(h),
      flags: { investigates: inv, holdsPost: !inv }, post: { heading: deg(h), sweep } })),
    // patrol p3 (Prima's "Patrol 21": sergeant + 2) E–W along the N side of the central barracks; RINT → the yard
    ...[['e23', 53, 39], ['e24', 51.5, 39], ['e25', 50, 39]].map(([id, x, z], k) => ({
      id, prima: 21, soldierType: k ? 'trooper' : 'sergeant', x, z, heading: deg(0), jail: 'barr_c', reactEvents: ['RINT'], flags: { investigates: true },
      squad: { id: 'p3', leader: 'e23', columns: 1 },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(53, 39, 5, 270), P(80, 40, 5, 0)] },
      alarmRoute: { run: { x: 60, z: 62, vel: 3 }, loop: { type: 'LOOP', vel: 1.0, points: BARRC_LOOP } },
    })),

    // ===== Phase 4: the north and the Gatling
    { id: 'e26', prima: 22, soldierType: 'sentry', x: 84, z: 30, heading: deg(0), flags: { holdsPost: true, investigates: false }, post: { heading: deg(0), sweep: 40 } },
    { id: 'e27', prima: 23, soldierType: 'soldier', x: 86, z: 35, heading: deg(0), flags: { investigates: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(86, 35, 3, 180), P(102, 36, 3, 0)] } },
    { id: 'e28', prima: 24, soldierType: 'sentry', x: 90, z: 20, heading: deg(0), flags: { holdsPost: true, investigates: false }, post: { heading: deg(0), sweep: 35 } },
    { id: 'e29', prima: 25, soldierType: 'soldier', x: 102.5, z: 14, heading: deg(56), flags: { investigates: true },
      route: { type: 'LOOP', vel: 1.0, points: [P(102.5, 14, 2, 270), P(104, 20), P(101, 26, 2, 90), P(99, 19.5)] } },
    { id: 'e30', prima: 26, soldierType: 'soldier', x: 100, z: 27, heading: deg(20), flags: { investigates: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(100, 27, 3, 180), P(108, 30, 3, 0)] } },
    // the Gatling gunner: covers the wire belt and the truck's approach and stop; he fires on the evacuation truck.
    // Post 250 (dossier 200): his sweep must reach the truck's stop NE of him (299°) or he never engages it (replay m06)
    { id: 'e34', prima: 30, soldierType: 'mg', x: 106, z: 17, heading: deg(250), post: { heading: deg(250), sweep: 60, giro: 180 } },

    // ===== Phase 5: the NE ruin (upper floor y 3.2); the three cover each other
    { id: 'e31', prima: 27, soldierType: 'soldier', x: 116, z: 38, y: DECK, heading: deg(85), flags: { investigates: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(116, 38, 3, 270), P(117, 49, 3, 90)] } },
    { id: 'e32', prima: 28, soldierType: 'sentry', x: 112, z: 39, y: DECK, heading: deg(225), flags: { holdsPost: true, investigates: false }, post: { heading: deg(225), sweep: 35 } },
    { id: 'e33', prima: 29, soldierType: 'soldier', x: 122, z: 50, y: DECK, heading: deg(330), flags: { investigates: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(122, 50, 3, 90), P(129, 46, 3, 0)] } },

    // ===== the N strip (fan map: a sentry at the N end of w_n, men on the N edge and on the main line). Kildread's
    // K-only extras (HQ door, HQ road, SE) stand here: the N edge is no free way round the base.
    { id: 'e35', soldierType: 'sentry', x: 61, z: 4.5, heading: deg(195), flags: { holdsPost: true, investigates: false }, post: { heading: deg(195), sweep: 40 } },
    { id: 'e36', soldierType: 'soldier', x: 40, z: 7, heading: deg(0), flags: { investigates: true, followsTracks: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(40, 7, 3, 180), P(54, 1.5), P(73, 1.5, 3, 0)] } },
    { id: 'e37', soldierType: 'soldier', x: 51.5, z: 17, heading: deg(40), flags: { investigates: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(51.5, 17, 3, 200), P(58, 16), P(66, 24.5, 3, 20)] } },

    // the armoured car's crew (folded into the vehicle: its turret MG and `sdkfz` cone)
    { id: 'e38', soldierType: 'crew', x: 24, z: 52.5, heading: deg(42), vehicle: 'sdkfz' },
  ],
  // One silent zone: everything from the W ruin to the gun, except the start corner and the SW practice field
  // (W of x 16 and S/W of the road's N edge). SEEN → RINT + siren; HEARD → nothing (investigators only), so the
  // armoured-car bomb at the W turn-round and pistol lures raise no alarm (dossier §9, D4).
  zones: [
    { id: 'z_base', poly: [[16, 0], [132, 0], [132, 105], [96, 105], [96, 88], [88, 93.5], [75, 94.5], [65, 89], [55, 80], [44, 67], [22, 47], [16, 41.5]],
      onSeen: 'RINT', onHeard: null, siren: true },
  ],
  jails: ['barr_c', 'hq', 'chapel'],
  // garrisons (all on RINT; exit at 2.7 m/s, loop at 1.8 m/s). Pools 5/10/10 [rec, Dutch FAQ's 5-man waves]
  barracks: {
    chapel: { pool: 5, squads: [{ event: 'RINT', size: 3, exitVel: 2.7, exitRoute: [P(73, 17.5), P(78, 28)], loopVel: 1.8, loop: CHAPEL_LOOP }] },
    barr_c: { pool: 10, squads: [{ event: 'RINT', size: 4, exitVel: 2.7, exitRoute: [P(59, 54), P(60.5, 58)], loopVel: 1.8, loop: BARRC_LOOP }] },
    hq: { pool: 10, squads: [{ event: 'RINT', size: 4, exitVel: 2.7, exitRoute: [P(97, 85), P(103, 81)], loopVel: 1.8, loop: HQ_LOOP }] },
  },
  // the GB's climb spot below e2 ("the little piece of wall" by the barricade): up and down. 2 m N of the dossier's
  // (18.8,38), out of e11's near cone (replay m06: his sweep reached the old foot every 8.5 s)
  climbLinks: [
    { id: 'climb_w', a: [18.8, 36, 0], b: [20.8, 36, DECK], roles: ['greenberet'] },
  ],
  // everyone: the ladder at the W ruin's E entrance, its two exterior stairways, the NE ruin's SW ladder.
  // Enemies path over these too (reinforcements can climb the stairs: the Dutch "hold the stairs" fight)
  ladders: [
    { id: 'lad_w_e', x: 45.4, z: 27, y: 0, top: [43.4, 27, DECK], raised: false, heading: deg(180) },
    { id: 'stair_w_s', x: 30, z: 49, y: 0, top: [30, 45.5, DECK], raised: false, kind: 'stairs', heading: deg(270) },
    { id: 'stair_w_e', x: 47, z: 45, y: 0, top: [43.4, 42, DECK], raised: false, kind: 'stairs', heading: deg(220) },
    { id: 'lad_ne', x: 108.8, z: 51, y: 0, top: [111, 50, DECK], raised: false, heading: deg(335) },
  ],
  triplines: [],
  objectives: [
    { id: 'o1', text: 'Destroy the Leopold railway gun', type: 'destroy', targets: ['leopold'], marker: 'leopold_charge', required: true, bombOnly: true },
    { id: 'o2', text: 'Get everyone aboard the truck in the north-east', type: 'escape', required: true, hidden: true, vehicleId: 'evac_truck' },
  ],
  // T1 [rec, dossier D13]: the gun's blast brings the whole base out as the truck comes in
  triggers: [
    { on: 'objective', match: { id: 'o1', status: 'done' }, once: true, delay: 1.0,
      do: [
        { alarm: 'z_base', x: GUN.x, z: GUN.z, cause: 'leopold' },
        // the truck drives in hostile: every gun that sees it (the Gatling, e28–e33, the garrisons) fires on it
        { taint: 'evac_truck' },
        // the Gatling gunner lays his gun on the truck as it comes in (dossier §8.4: kill him before the gun blows);
        // in COMBAT he is not swung away by his comrades' shots (replay m06: noise turns kept him off it)
        { run: (w) => { const g = w.byId('e34'), v = w.byId('evac_truck'); if (g?.alive && g.brain && v && !v.destroyed && !g.held) g.brain.onBoardSeen?.(v); } },
        { message: 'The Leopold is finished. The truck is on its way: get to the north-east!', kind: 'info' },
        { objective: 'o2', set: 'show' },
      ] },
    // the truck is destroyed before everyone is aboard: that loss, even when its blast kills a commando nearby
    { on: 'vehicle:destroyed', match: { vehicle: 'evac_truck' }, once: true, when: (p, w) => !w.objectives?.find((o) => o.id === 'o2')?.done,
      do: [{ fail: 'YOU DESTROYED THE TRUCK, BUT YOU NEEDED IT TO ESCAPE.' }] },
  ],
  // the friendly truck spawns off the NE edge when o1 is done, drives W past the Gatling at 5 m/s and waits NE
  // of the nest; once everyone is aboard it leaves E. Destroyed (Gatling/rifles, 30 hits) = loss (game.js §8.1).
  extraction: {
    vehicleId: 'evac_truck', vehicleType: 'truck', friendly: true, seats: 6, spawnWhen: ['o1'],
    spawnAt: { x: 137, z: 6, heading: deg(180) }, arrive: { x: 112, z: 6, speed: 5 },
    exit: { x: 128, z: 5, r: 4 }, leave: { x: 140, z: 5 },
    boardWhileMoving: true, // engine delta D-E2 (ignored today: the truck stops at `arrive` and waits)
  },
  alarmFail: null,
  par: { time: 780 },
  cameraStart: { x: 10, z: 22, zoom: 1 },
  startDisguised: [],
};
