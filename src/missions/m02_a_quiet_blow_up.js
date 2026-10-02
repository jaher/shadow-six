/**
 * BEL Mission 2 — "A Quiet Blow-Up" (design-spec §7.5 buildable layout). Owned by MISSIONS.
 * Stamsund, Lofoten (Operation Claymore), 1 Mar 1941. A river runs SE across the map: the team starts
 * behind the palisade of the small SW settlement; the walled camp with the fuel depot, two MG towers,
 * a garrison and the escape truck stands on the NE bank, whose whole area is the `z_ne` alarm zone.
 *
 * Conventions: headings/rot in DEGREES in the spec, converted with deg(); route `look` and `post.sweep` stay in
 * degrees. Briefing text is our own wording (§7.3).
 */

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (enemy-brain reads wp.look * DEG, §4.1)

// SE wall edge E(71,35) → S(46,58); the boom's 4 m road opening is centred on (56, 48.8). The wall opening is wider
// (local metres along the gate line, + toward the E corner): S log gate post, pivot post + counterweight, the road
// under the boom, the fork rest, a 1.5 m pedestrian footway (walk round the barrier), the E log gate post.
const GATE = { x: 56, z: 48.8 };
const GAP = [-3.6, 4.05];
const SE = [(46 - 71) / Math.hypot(25, 23), (58 - 35) / Math.hypot(25, 23)];
const gapA = [+(GATE.x - SE[0] * GAP[1]).toFixed(2), +(GATE.z - SE[1] * GAP[1]).toFixed(2)]; // E side (local +x = −SE)
const gapB = [+(GATE.x - SE[0] * GAP[0]).toFixed(2), +(GATE.z - SE[1] * GAP[0]).toFixed(2)]; // S side

// p3 loop (also the camp garrison squad's loop after its exit run)
const P3_LOOP = [P(20, 34), P(38, 14.5, 3, 225), P(64, 32.5), P(64, 40, 3, 45), P(46, 53), P(20, 34)];
const OUT_LOOP = [P(58, 54), P(68, 44), P(78, 52), P(70, 62)];

// The river was widened from 12 m to ~24 m (user request 2026-09-30, "make the river in mission 2 wider"): the
// NE (camp) bank keeps its old edge (old centreline − 6 m), the SW bank moved out, and everything on the SW
// bank (settlement, start, settlement patrols) moved DZ m south; the map grew by the same amount (104 → 120).
const DZ = 16;
const Q = (x, z, wait = 0, look = null) => P(x, z + DZ, wait, look); // a SW-bank waypoint (old coordinates + DZ)

/**
 * Islet outline (user request 2026-09-30 "make the edges of the shore more smooth and less polygonal"; review: the
 * islets read as perfect circles): 24 points on r(θ) = r·(1 + 0.12 sin(2θ + a) + 0.035 sin(3θ + b)),
 * a lobed, natural outline the shore field smooths further. The long axis runs N–S (along the view: the 45° camera
 * foreshortens it, so no lobe reads as a sharp tip) and the rocks' side (θ ≈ 115–185°) stays ≥ 0.87 r.
 */
function islet(x, z, r, a, b) {
  const out = [];
  for (let k = 0; k < 24; k++) {
    const t = (k / 24) * 2 * Math.PI, q = r * (1 + 0.12 * Math.sin(2 * t + a) + 0.035 * Math.sin(3 * t + b));
    out.push([+(x + q * Math.cos(t)).toFixed(2), +(z + q * Math.sin(t)).toFixed(2)]);
  }
  return out;
}

/**
 * T1 river with natural banks: a Catmull-Rom curve through the old 12 m river's centreline (plus map-edge
 * extensions), sampled every ~4 m. NE (camp) bank = the old NE edge (centre − 6 m), only ever nudged INTO the
 * water (≤ 0.9 m, so nothing on the camp side gets closer to it); SW bank = NE bank + width(s): 24 m ± ~15–20%
 * (WK keys + a short ripple).
 * @returns {{points: number[][], widths: number[]}} for a `path` terrain entry (per-point widths)
 */
function riverPath() {
  const K = [[-12, 26.6], [0, 36], [18, 50], [36, 64], [52, 78], [64, 92], [70, 104], [73, 116], [74, 132]];
  const cr = (p0, p1, p2, p3, t) => p1.map((_, i) => 0.5 * (2 * p1[i] + (p2[i] - p0[i]) * t
    + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t * t + (3 * p1[i] - p0[i] - 3 * p2[i] + p3[i]) * t * t * t));
  const c = [];
  for (let k = 0; k + 1 < K.length; k++) {
    const n = Math.max(1, Math.round(Math.hypot(K[k + 1][0] - K[k][0], K[k + 1][1] - K[k][1]) / 4));
    for (let q = 0; q < n; q++) c.push(cr(K[Math.max(0, k - 1)], K[k], K[k + 1], K[Math.min(K.length - 1, k + 2)], q / n));
  }
  c.push(K.at(-1));
  // width keys along the curve (s m from the W edge): wide pools round the islets (s≈42, s≈77), narrows between
  const WK = [[0, 22], [20, 21], [42, 26.5], [64, 20.5], [84, 27.5], [96, 22], [116, 20], [140, 23]];
  const points = [], widths = [];
  let s = 0;
  for (let k = 0; k < c.length; k++) {
    if (k) s += Math.hypot(c[k][0] - c[k - 1][0], c[k][1] - c[k - 1][1]);
    const a = c[Math.max(0, k - 1)], b = c[Math.min(c.length - 1, k + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L; // towards the SW bank
    const nudge = Math.max(0, 0.9 * Math.sin(s / 9.1 + 1.3));
    const j = Math.max(0, WK.findIndex((q, i) => i + 1 < WK.length && s < WK[i + 1][0]));
    const [s0, w0] = WK[j], [s1, w1] = WK[Math.min(WK.length - 1, j + 1)], u = s1 > s0 ? Math.min(1, (s - s0) / (s1 - s0)) : 0;
    const w = w0 + (w1 - w0) * (1 - Math.cos(Math.PI * u)) / 2 + 1.0 * Math.sin(s / 6.7 + 2.1);
    const off = -6 + nudge + (w - nudge) / 2; // centre offset along n from the old centreline
    points.push([c[k][0] + nx * off, c[k][1] + nz * off]);
    widths.push(w - nudge);
  }
  // two [1 2 1]/4 passes: the offset of the Catmull-Rom has curvature spikes at its knots, and 10-12 m in on the
  // inside of a bend (SW bank at (52, 100.5), (29, 76)) the bank of a tight one turns ~30° in half a metre (a corner)
  for (let pass = 0; pass < 2; pass++) {
    const P = points.map((q) => q.slice()), Wd = widths.slice();
    for (let k = 1; k + 1 < P.length; k++) {
      for (const d of [0, 1]) points[k][d] = (P[k - 1][d] + 2 * P[k][d] + P[k + 1][d]) / 4;
      widths[k] = (Wd[k - 1] + 2 * Wd[k] + Wd[k + 1]) / 4;
    }
  }
  return { points: points.map((q) => [+q[0].toFixed(2), +q[1].toFixed(2)]), widths: widths.map((w) => +w.toFixed(2)) };
}

export default {
  id: 'm02',
  campaign: 'BEL',
  title: 'A Quiet Blow-Up',
  subtitle: 'Stamsund, Lofoten Islands · 1 March 1941',
  date: '1941-03-01',
  place: 'Stamsund, Lofoten (Operation Claymore)',
  theater: 'snow',
  treeSnow: 0.8, // snow load on the conifers (0..1.3; art/terrain.js): wind off the lake has stripped the sprays
  coneColors: 'green',
  size: [82, 104 + DZ],
  seed: 1941_0301,
  briefing: {
    historical: 'March 1941. Operation Claymore is about to strike the Lofoten Islands, whose fish-oil factories supply glycerine for German explosives. The fuel stored at Stamsund keeps the occupation moving, and it has to burn before the main force comes ashore.',
    text: 'You start in the small settlement south of the river. The depot is inside the walled camp on the far bank: two big fuel tanks. A patrol boat works the river, so hide when you hear its engine. The camp\'s ladder is pulled up; your Green Beret will have to go over the wall. There\'s a truck inside the camp. Blow the depot and drive out through the south-east gate, and don\'t stop for anyone.',
    objectivesSummary: 'Destroy the fuel depot. Escape in the truck through the south-east gate.',
    hints: [
      'Anything suspicious on the far bank raises the alarm.',
      'Hide when the patrol boat passes; pack the raft after crossing.',
      'The packed raft slows the Marine down. Send him off a little ahead of the others.',
      'The ladder can be lowered from the top of the wall.',
      'Footprints in the snow can lead a curious guard into a trap.',
      'Drive the truck out of the SE gate without stopping.',
    ],
  },
  lighting: { sunElevDeg: 16, sunAzimuthDeg: 315, kelvin: 6200, hdri: 'overcast', fog: null, lut: 'norway', riverColor: '#107083' },
  water: { velocity: 0.6, angleDeg: 40, turbulence: 0.4 },
  shoreShallowWidth: 1.5, // T2 auto rim 1.5 m
  baseTerrain: 'snow',
  terrain: [
    // T1 river (SW bank = start, NE bank = camp): ~20–28 m wide (mean 24; the old river was 12), natural banks
    { type: 'path', terrain: 'water', ...riverPath() },
    // islets (land in the river's SW half, clear of the boat lane; rocks + a pine on each): irregular, not discs
    { type: 'poly', terrain: 'snow', points: islet(16.9, 63.7, 3.0, 4.71, 0) },
    { type: 'poly', terrain: 'snow', points: islet(40.6, 83.0, 2.8, 3.5, 4.8) },
    // T3 camp interior (packed, trampled)
    { type: 'poly', terrain: 'ground', points: [[16, 33], [42, 10], [71, 35], [46, 58]] },
    // T4 escape road from the SE gate to the east edge
    { type: 'path', terrain: 'road', points: [[56, 49], [62, 56], [70, 62], [82, 68]], width: 5, surface: 'snow_packed' },
  ],
  // step 3p road network: truck tracks inside the camp (packed, trampled ground), a trodden path through the
  // settlement that stays snow for gameplay (grid: false)
  roads: [
    { id: 'camp_track', surface: 'snow_packed', points: [[56, 48], [53, 41], [47, 33], [41.5, 28.4]], width: 3.5, wear: 0.8 },
    { id: 'depot_track', surface: 'slush', points: [[53, 41], [58.5, 40.5], [63, 39.5]], width: 3, wear: 0.6 },
    { id: 'village_path', surface: 'snow_packed', points: [[8, 119], [8.5, 108], [12, 102], [20, 96], [28, 94], [32, 89.5]], width: 1.8, grid: false, wear: 0.3 },
  ],
  // street furniture: visual only in the locked BEL layout
  furniture: [
    { type: 'lamp', variant: 'norway_wood', x: 5, z: 88 + DZ, rot: 0, block: false },
    { type: 'lamp', variant: 'norway_wood', x: 23, z: 83.5 + DZ, rot: -Math.PI / 2, hooded: true, block: false },
    { type: 'floodlight', x: 42, z: 13.5, rot: Math.PI / 2, block: false },
    { type: 'floodlight', x: 67, z: 35, rot: Math.PI, block: false },
    { type: 'sign', variant: 'fingerpost', x: 59, z: 51, rot: -0.8, text: 'STAMSUND 2 km', block: false },
    { type: 'telegraph', points: [[82, 72], [70, 66], [58, 58]], spacing: 14, h: 6.5, wires: 2, block: false },
  ],
  structures: [
    // --- the walled camp (NE bank). Closed palisade W(16,33) → N(42,10) → E(71,35) → S(46,58) → W,
    // gate gap on the SE edge. The SW edge (22.5,38.4)–(29.5,44.3) is climbable (GB) and carries the
    // wall walk `walk_sw` (y 2.2) where e5 stands.
    { id: 'camp_wall', type: 'wall', variant: 'palisade_wire', h: 3.0, width: 0.5,
      segments: [[gapB, [46, 58], [16, 33], [42, 10], [71, 35], gapA]],
      climbable: { from: [22.5, 38.4], to: [29.5, 44.3] },
      walkways: [{ id: 'walk_sw', points: [[22.72, 38.13], [29.72, 44.03]], width: 1.4, y: 2.2 }] },
    // the boom barrier (striped pole, pivot post + counterweight on the sentry-box side, fork rest): raised by hand,
    // a slow vehicle stops at it, a fast one snaps the pole (world/breakables.js); walkers go round it by the footway
    // the access platform inside the river wall (the original's timber scaffold by the ladder): a plank landing off
    // walk_sw and a stair down into the camp along the wall (the way in for the team once the GB lowers the ladder)
    // (fixed: built against walk_sw on purpose — the placement rules must not shift it along the wall)
    // The landing sits by the ladder top, clear of cab1's porch skirt; the stair runs on SE along the walk (local +x)
    // with its hand rail on the camp side only (the walk's edge is its other side: e5's body falls inward, clear).
    { id: 'plat_sw', type: 'timber_platform', x: 27.99, z: 40.94, rot: deg(39.8), w: 2.2, d: 1.05, h: 2.2, fixed: true,
      stair: { run: 3.2, z: -0.075, w: 0.9, outerRail: false }, rails: ['-z', '-x'] },
    { id: 'gate_se', type: 'gate', variant: 'barrier_boom', x: GATE.x, z: GATE.z, rot: deg(317), w: 4, gap: GAP, operable: true, rammable: true },
    // sentry box just outside the gate on the SW verge of T4 beside the S gate post, clear of the straight truck line to
    // the exit and SW of the boom's pivot post (gate-local u −5.6, v +1.47): from the default camera (south-west, high) the
    // pivot post, counterweight and pole root stay in view instead of seeming to come out of the box roof
    { id: 'sbox_se', type: 'hut', variant: 'sentry_box', x: 52.87, z: 53.67, rot: deg(317), w: 1.6, d: 1.6, h: 2.4 },
    // buildings run parallel to the palisade edge they stand by (NW edge −41.5°, NE edge 40.8°, SE edge 137.4°, SW edge −140.2°)
    { id: 'barr_camp', type: 'barracks', variant: 'log_garrison', x: 37.74, z: 24.01, rot: deg(318.5), w: 12, d: 6, h: 4.5, flag: true, garrison: true },
    { id: 'cab1', type: 'hut', variant: 'log_cabin', x: 29.26, z: 36.77, rot: deg(219.8), w: 5, d: 4, h: 3.5 },
    // the depot: two tanks end to end along the NE edge, between p3's wall-side leg and the camp track
    { id: 'depot_a', type: 'fueltank', variant: 'horizontal_cradle', x: 49.64, z: 27.94, rot: deg(40.8), w: 9, d: 3.4, h: 3.5, destructible: true, bombOnly: false, hp: 100 },
    { id: 'depot_b', type: 'fueltank', variant: 'horizontal_cradle', x: 57.21, z: 34.47, rot: deg(40.8), w: 9, d: 3.4, h: 3.5, destructible: true, bombOnly: false, hp: 100 },
    // MG towers: open timber MG platforms as in the original (sandbagged deck, MG 34 on its tripod, ladder at the back),
    // just inside the palisade, outer legs against it (placement rule a: never astride the wall);
    // t1 sits 3 m SW along the NW edge of the aligned barracks' W end
    { id: 't1', type: 'watchtower', variant: 'mg_platform', x: 27.06, z: 26.49, rot: deg(228), w: 3, d: 3, h: 5.5, deckY: 5.5 },
    { id: 't2', type: 'watchtower', variant: 'mg_platform', x: 54.42, z: 23.93, rot: deg(311), w: 3, d: 3, h: 5.5, deckY: 5.5 },
    { id: 'crates1', type: 'crates', x: 46, z: 48, rot: deg(317.4), w: 2, d: 2, h: 1.2, block: 1 },
    ...[['bar1', 25, 33], ['bar2', 26, 33], ['bar3', 48.5, 36.2], ['bar4', 49.4, 36.8]]
      .map(([id, x, z]) => ({ id, type: 'barrels', variant: 'fuel_explosive', x, z, r: 0.3, h: 0.9, explosive: 'barrel', carriable: true, destructible: true, hp: 1 })),
    // garrison outside the E corner, parallel to the SE edge that runs on to the gate road (a charge within 6.75 m of the E corner razes it)
    { id: 'barr_out', type: 'barracks', variant: 'log_garrison', x: 73.26, z: 39.18, rot: deg(47.4), w: 6, d: 8, h: 4, flag: true, garrison: true, razeRadius: 6.75, destructible: true, hp: 100 },
    // cover between the SW wall and the river
    { id: 'rocks_n1', type: 'rocks', x: 21.83, z: 40.75, rot: 0, w: 4, d: 2.5, h: 2.2 },
    { id: 'rocks_n2', type: 'rocks', x: 34, z: 51, rot: 0, w: 4, d: 2.5, h: 2.2 },
    { id: 'rocks_n3', type: 'rocks', x: 40.31, z: 55.81, rot: 0, w: 3, d: 2, h: 2 },
    // islets in the river (land discs in `terrain`)
    { id: 'islet1', type: 'rocks', x: 16.0, z: 64.2, r: 1.4, h: 1.8 },
    { type: 'pine', x: 18.0, z: 64.4, r: 0.45, h: 9, seed: 301 }, // clear of the boat lane and the rock
    { id: 'islet2', type: 'rocks', x: 39.8, z: 83.5, r: 1.3, h: 1.7 },
    { type: 'pine', x: 41.7, z: 83.4, r: 0.45, h: 10, seed: 302 },
    // --- the SW settlement: palisade with openings S (x 6–10) and E (z 92–96)
    { id: 'sw_wall', type: 'wall', variant: 'palisade', h: 2.2, width: 0.4,
      segments: [[[10, 113], [28, 113], [28, 96]], [[6, 113], [1, 113], [1, 86], [28, 86], [28, 92]]] },
    { id: 'cabA', type: 'hut', variant: 'log_cabin', x: 6.5, z: 80 + DZ, // clear of the W palisade
      rot: 0, w: 7, d: 5, h: 4, snowRoof: true },
    { id: 'cabB', type: 'hut', variant: 'log_cabin', x: 16, z: 91 + DZ, rot: 0, w: 7, d: 5, h: 4, snowRoof: true },
    // pines: SW bank (shore and settlement), then the NE bank
    ...[[4, 72], [11, 76], [33, 96], [44, 108], [60, 70], [70, 20], [78, 8], [8, 20], [20, 6]]
      .map(([x, z], k) => ({ type: 'pine', x, z, r: 0.6, h: 9 + (k % 5), seed: 311 + k })),
  ],
  vehicles: [
    { id: 'truck', vehicleType: 'truck', variant: 'opel_canvas', x: 50, z: 44, heading: deg(47.4), driveable: true, seats: 6, hits: 30, escape: true },
    // the boat lane runs 9.5 m off the NE bank (the old lane + 3.5 m), deep water clear of both islets for the
    // true-scale 13.6 m HS 114; same legs and timing as on the 12 m river
    { id: 'pboat', vehicleType: 'patrolboat', x: 1, z: 41.3, heading: deg(39), driveable: false, crew: ['e17'], engineAudible: 60,
      route: { type: 'PINGPONG', speed: 2.5, points: [P(1, 41.3, 15), P(15.9, 52.8), P(33.8, 66.7), P(49.5, 80.5), P(62.9, 96.6, 15)] } },
  ],
  commandos: [
    { role: 'greenberet', x: 8, z: 101 + DZ, heading: deg(270), inventory: { knife: 1, pistol: 1, decoy: 1, shovel: 1 } },
    { role: 'sniper', x: 11, z: 101 + DZ, heading: deg(270), inventory: { pistol: 1, sniperRifle: 5 } },
    { role: 'diver', x: 14, z: 101 + DZ, heading: deg(270), inventory: { knife: 1, pistol: 1, harpoon: 1, divingGear: 1, inflatableBoat: 1 } },
    { role: 'sapper', x: 17, z: 101 + DZ, heading: deg(270), inventory: { pistol: 1, bearTrap: 1, timeBomb: 2 } },
    { role: 'driver', x: 20, z: 101 + DZ, heading: deg(270), inventory: { pistol: 1, smg: 20, firstAid: 6 } },
  ],
  enemies: [
    // SW settlement: three walkers that support each other (trap + footprint lures)
    { id: 'e1', prima: 1, soldierType: 'soldier', x: 4, z: 73 + DZ, heading: deg(0), flags: { investigates: true, followsTracks: true },
      route: { type: 'LOOP', vel: 1.0, points: [Q(4, 73), Q(24, 73, 3, 0), Q(24, 85), Q(11, 85, 3, 180), Q(11, 75)] } },
    { id: 'e2', prima: 2, soldierType: 'soldier', x: 14, z: 78 + DZ, heading: deg(56), flags: { investigates: true, followsTracks: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [Q(14, 78, 4, 90), Q(24, 92, 4, 180)] } },
    { id: 'e3', prima: 3, soldierType: 'soldier', x: 22.13, z: 95.08 + DZ, heading: deg(270), flags: { investigates: true, followsTracks: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [Q(22, 95, 3, 90), Q(22, 76, 3, 270)] } },
    // NE bank outside the SW wall, in front of the rocks (snipe him there)
    { id: 'e4', prima: 4, soldierType: 'soldier', x: 20, z: 42.5, heading: deg(37), flags: { holdsPost: true, investigates: false },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(20, 42.5, 3, 135), P(40, 57.5, 3, 135)] } },
    // on the wall walk beside the (raised) ladder, watching the river
    { id: 'e5', prima: 5, soldierType: 'sentry', x: 28.60, z: 43.08, // on the walk's deck, 0.3 m off the palisade line (≥ 0.32 m: e7 finds the body, §7.5 step 2)
      heading: deg(130), elevated: true, y: 2.2,
      flags: { holdsPost: true, investigates: false }, post: { heading: deg(130), sweep: 35 } },
    { id: 'e6', prima: 6, soldierType: 'soldier', x: 30, z: 31, heading: deg(41), flags: { investigates: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(30, 31, 3, 180), P(51, 49.5, 5, 40)] } },
    { id: 'e7', prima: 7, soldierType: 'soldier', x: 47.28, z: 21.41, heading: deg(41), flags: { holdsPost: true, investigates: false },
      // loop round the depot, parallel to the NE edge
      route: { type: 'LOOP', vel: 1.0, points: [P(47.28, 21.41, 2, 41), P(63.98, 35.81, 2, 315), P(59.01, 41.57), P(42.31, 27.17, 2, 180)] } },
    // MG gunners on the open platforms, facing outward; they look down from the deck past the roof rule (`overlooks`:
    // a 5.5 m deck would otherwise blind them to the ground), see and fire over the 3 m palisade below their sight
    // line (`overWalls`) and traverse ±90° round the post heading (giro 180)
    { id: 'e8', soldierType: 'mg', x: 27.06, z: 26.49, heading: deg(228), elevated: true, overlooks: true, overWalls: true, y: 5.5, tower: 't1', post: { heading: deg(228), sweep: 50, giro: 180 } },
    { id: 'e9', soldierType: 'mg', x: 54.42, z: 23.93, heading: deg(311), elevated: true, overlooks: true, overWalls: true, y: 5.5, tower: 't2', post: { heading: deg(311), sweep: 50, giro: 180 } },
    // patrol p3 (sergeant + 2 troopers) circling inside the camp
    ...[['e10', 20, 34], ['e11', 21.2, 35.4], ['e12', 21.81, 36.92]].map(([id, x, z], k) => ({
      id, soldierType: k ? 'trooper' : 'sergeant', x, z, heading: deg(313), jail: 'barr_camp',
      squad: { id: 'p3', leader: 'e10', columns: 1 }, route: { type: 'LOOP', vel: 1.0, points: P3_LOOP },
    })),
    // patrol p4 (sergeant + 3 troopers, 2 columns) along the east edge; RINT sends it to the gate road
    ...[['e13', 80.5, 4], ['e14', 79, 4], ['e15', 80.5, 2.5], ['e16', 79, 2.5]].map(([id, x, z], k) => ({
      id, soldierType: k ? 'trooper' : 'sergeant', x, z, heading: deg(90), jail: 'barr_camp', reactEvents: ['RINT'],
      squad: { id: 'p4', leader: 'e13', columns: 2 },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(80.5, 4, 5, 180), P(80.5, 96, 5, 180)] },
      alarmRoute: { run: { x: 62, z: 54, vel: 3 }, loop: { type: 'LOOP', vel: 1.0, points: OUT_LOOP } },
    })),
    // the patrol boat's MG gunner (vision mg, sweep 60, facing travel)
    { id: 'e17', soldierType: 'mg', x: 1, z: 41.3, heading: deg(39), vehicle: 'pboat', post: { heading: deg(39), sweep: 60, giro: 180 } },
  ],
  items: [],
  zones: [
    { id: 'z_ne', poly: [[0, 0], [82, 0], [82, 104 + DZ], [78, 104 + DZ], [74, 104], [64, 84], [52, 70], [36, 56], [18, 42], [0, 28]], onSeen: 'RINT', onHeard: 'RINT' },
  ],
  jails: ['barr_camp'],
  barracks: {
    barr_camp: { pool: 10, squads: [{ event: 'RINT', size: 4, exitVel: 3, exitRoute: [P(41.04, 27.71), P(46, 40), P(52, 48)], loopVel: 2, loop: P3_LOOP }] },
    barr_out: { pool: 5, squads: [{ event: 'RINT', size: 3, exitRoute: [P(70.5, 44), P(66, 50)], loop: OUT_LOOP }] },
  },
  climbLinks: [
    // GB over the climbable SW edge: river side → wall walk (down into the camp by plat_sw's stair)
    { a: [23.73, 41.0, 0], b: [23.72, 39.3, 2.2], roles: ['greenberet'] },
  ],
  ladders: [
    // the camp ladder, left pulled up: lowered from the top of the wall (1.0 s)
    { id: 'ladder_sw', x: 27.4, z: 43.0, y: 0, top: [27, 42.2, 2.2], raised: true, lowerTime: 1.0, heading: deg(130) },
  ],
  triplines: [],
  objectives: [
    { id: 'o1', text: 'Destroy the fuel depot', type: 'destroy', targets: ['depot_a', 'depot_b'], required: true },
    { id: 'o2', text: 'Escape in the truck through the south-east gate', type: 'escape', required: true, vehicleId: 'truck' },
  ],
  // exit on the T4 road end, inside the drivable area (the truck's nose stops ~3 m short of the E edge);
  // it lies on the straight line truck start (50,44) → gate → exit, so one double-click drives it out.
  // reaching the exit with o1 still pending (a bomb ticking) → (C)ONTINUE / (Q)UICK LOAD dialog (§8.1)
  extraction: { vehicleId: 'truck', exit: { x: 78, z: 66, r: 4 }, spawnWhen: [] },
  par: { time: 480 },
  cameraStart: { x: 16, z: 92 + DZ, zoom: 1 },
  startDisguised: [],
};