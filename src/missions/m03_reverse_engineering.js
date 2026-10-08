/**
 * BEL Mission 3 — "Reverse Engineering" (design-spec §7.6 buildable layout). Owned by MISSIONS.
 * Sysendam dam near the Sima hydro plant, Eidfjord, 4 Mar 1941. The dam faces the camera from the north-west: its
 * raised reservoir lies beyond it (top of the screen), the river pours from its foot towards the camera and bends
 * diagonally to the SE. The team starts on the NE plateau behind a ruined
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
/**
 * T2 tailwater river with natural banks instead of a ruler-straight channel (user request 2026-09-30 "make the edges
 * of the shore more smooth and less polygonal"): the centreline `C` (foot of the dam → SE corner, 20 m) is resampled
 * every ~4 m and, past the bend at (60, 54), each bank wanders on its own (cosine-eased keys, ±~2 m over 12–25 m).
 * The NE / camp bank (R, offsets + = into the water) keeps the raft afloat, the E6 post, E14, the uniform line and
 * the camp palisade on dry land. Keys are in metres along the old straight channel from (37, 33) (s 31 = the bend).
 * @param {number[][]} C centreline
 * @param {number} w nominal width
 * @returns {{points: number[][], widths: number[]}} for a `path` terrain entry (per-point widths)
 */
function tailwaterPath(C, w = 20) {
  const LK = [[0, 0], [31, 0], [36, 0.2], [50, -1.0], [62, 0.8], [78, 2.2], [92, 0.6], [104, -0.8], [118, 1.2], [132, 2.0], [142, 0.5], [160, 0]];
  const RK = [[0, 0], [31, 0], [40, 1.2], [48, 1.4], [58, 0.4], [70, -0.6], [80, 0.3], [91, 0.9], [100, -0.5], [112, 0.6], [124, 1.6], [136, 0.2], [160, 0]];
  const key = (K, s) => {
    if (s >= K[K.length - 1][0]) return K[K.length - 1][1];
    const j = Math.max(0, K.findIndex((q, i) => i + 1 < K.length && s < K[i + 1][0]));
    const [s0, v0] = K[j], [s1, v1] = K[Math.min(K.length - 1, j + 1)], t = s1 > s0 ? Math.min(1, Math.max(0, (s - s0) / (s1 - s0))) : 0;
    return v0 + (v1 - v0) * (1 - Math.cos(Math.PI * t)) / 2;
  };
  const bend = C.findIndex((q) => q[0] === 60 && q[1] === 54);
  const points = [], widths = [];
  let sBend = 0;
  for (let i = 0; i + 1 < C.length; i++) {
    const [x0, z0] = C[i], [x1, z1] = C[i + 1], L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L;
    const n = Math.max(1, Math.round(L / 4)), last = i + 2 === C.length;
    for (let k = 0; k < n + (last ? 1 : 0); k++) {
      const d = (L * k) / n, s = i < bend ? 0 : 31 + sBend + d;
      const lv = key(LK, s), rv = key(RK, s), off = (lv + rv) / 2; // SW (station) bank at +w/2 + lv, NE (camp) at -w/2 + rv
      points.push([+(x0 + ux * d - uz * off).toFixed(2), +(z0 + uz * d + ux * off).toFixed(2)]);
      widths.push(+(w + lv - rv).toFixed(2));
    }
    if (i >= bend) sBend += L;
  }
  return { points, widths };
}
const square = (x, z, s = 5) => [[x - s / 2, z - s / 2], [x + s / 2, z - s / 2], [x + s / 2, z + s / 2], [x - s / 2, z + s / 2], [x - s / 2, z - s / 2]];
const CAGES = [];
// the E column stands 1 m west of the old x 56: clear of st_barr2's steps / flagpole and pylon_1's legs
for (const z of [100, 110, 120]) for (const x of [20, 32, 44, 55]) CAGES.push([x, z]);

/**
 * The dam faces the camera (design-spec §7.6, 2026-09 re-author): rot 345° turns its downstream face to the default
 * 15° camera yaw, so the player looks at the tall wall with the reservoir beyond it and the river pouring towards
 * the bottom of the screen. The crest is a raised deck (`elev` 7 m: the visual stands that high, units on it stand at
 * grid elev 7) reached by two stairs (`ramps`); the reservoir behind it is held 5.8 m up by the dam and two rock rims.
 * `damPt(u, v)`: dam-local metres (u along the crest towards its E end, v downstream) → world [x, z].
 */
// `walk`: the crest's walking surface = the top of the lifted asset's snow-covered deck (concrete 7.06, snow 7.18–7.26) plus the 2–5 cm a boot sole dips below its root in the walk cycle
const DAM = { x: 40, z: 22, rot: 345, elev: 7, walk: 7.28 };
const DC = Math.cos(deg(DAM.rot)), DS = Math.sin(deg(DAM.rot));
const r2 = (v) => Math.round(v * 100) / 100;
const damPt = (u, v) => [r2(DAM.x + u * DC - v * DS), r2(DAM.z + u * DS + v * DC)];
/** Arc of the arch (centre 20 m downstream of the crest's middle, like the dam_arch asset) at radius r, a0 → a1 degrees. */
const arc = (r, a0, a1, n = 12) => Array.from({ length: n + 1 }, (_, k) => { const a = deg(a0 + ((a1 - a0) * k) / n); return damPt(r * Math.sin(a), 20 - r * Math.cos(a)); });
/**
 * Walkable crest between the parapets (their inner faces at radius 18.45 / 21.55: the lane 19.0–20.95 keeps a body's
 * clearance, ±38°) and the wadeable toe ledge at the foot of the face. The stairs' top 1.6 m (`landing`) run under the
 * deck's ends, at its height.
 */
const CREST = [...arc(20.95, -38, 38), ...arc(19.0, 38, -38)];
const TOE = [...arc(16.3, -27, 27, 8), ...arc(13.2, 27, -27, 8)];
const W_STAIR = [[22.85, 40.3], damPt(-12.31, 4.24)]; // bottom → top (the crest's W end)
const E_STAIR = [[59.35, 33.9], damPt(12.31, 4.24)];
/** Point `f` of the way down a stair ([bottom, top]) from its top, `off` m off its axis towards the plunge pool. */
const stairPt = ([[bx, bz], [tx, tz]], f, off) => {
  const L = Math.hypot(bx - tx, bz - tz), ux = (bx - tx) / L, uz = (bz - tz) / L, [px, pz] = damPt(0, 20);
  const s = ((px - tx) * -uz + (pz - tz) * ux) > 0 ? 1 : -1; // the normal (-uz, ux) or its opposite: the pool side
  return [r2(tx + ux * L * f - s * uz * off), r2(tz + uz * L * f + s * ux * off)];
};
/** Point at radius r about the arch's centre (20 m downstream of the crest's middle), angle a degrees (+ = towards the E end). */
const polar = (r, a) => arc(r, a, a, 1)[0];
/**
 * The dam is keyed into the valley's rock (user request 2026-10-07: "dam should be connected to the edges of the side
 * mountains and there should be water behind the dam"): a rock massif (rim_s W, abut_e E) closes on each end of the
 * dam (the radial end of the arch at ±38°: from the crest lane's corner out to its upstream face, just inside its
 * concrete) and runs down the outer side of that end's crest stair to half its length, so the stair climbs a cut in
 * the rock; no pocket of open ground is left between the crest, the stair and the rock (they showed the valley floor
 * 7 m down through the gap). `abut` keeps those faces plumb on the outline.
 */
const STAIR_OUT = 0.8; // the rock face beside a stair: on the edge of its 1.6 m treads (the rails stand 8 cm in)
const ABUT_F = 0.5; // how far down its stair (fraction from the top) the rock runs
const abutment = (stair, sign) => {
  // (`head`: the middle of the stair's head, where it meets the arch's end. The little corner between the head, the
  // rock and the crest's end lies under the dam's end block; its ground is out of bounds: `noWalk` dam_end_w / _e.
  // The rock does not wrap round the head: a reflex corner there folded its top cap out over the landing)
  const top = stairPt(stair, 0, -STAIR_OUT), low = stairPt(stair, ABUT_F, -STAIR_OUT);
  return { low, top, head: stairPt(stair, 0, 0), cut: polar(20.97, sign * 38), end: polar(22.3, sign * 37.6), water: polar(24, sign * 37.6) };
};
const AB_W = abutment(W_STAIR, -1), AB_E = abutment(E_STAIR, 1);
/**
 * Nobody walks in front of the dam (user request 2026-10-02: "people should not be able to walk right in front of
 * the dam"): the face, the toe ledge (T3) with its rim and the snow at the feet of the face, from the crest's
 * downstream edge (r 19.2, ±45°) down the inner side of the stairs (E to its middle, W to 40 %) and across to the
 * plunge pool (r 10.5, +50° … -36°, then r 12.5 at -40°: the W shore below the face's end, where boats land for the
 * bunker, stays open). `noWalk` (map-builder): ground-level cells only, so the crest deck and the stair treads stay open.
 */
const DAM_FRONT = [...arc(19.2, -45, 45, 18), stairPt(E_STAIR, 0.5, 0.5), ...arc(10.5, 50, -36, 18), arc(12.5, -40, -40, 1)[0],
  stairPt(W_STAIR, 0.4, 0.5)];
/**
 * The dam's own control shack (dam_arch BL.control_shack, sidecar footprint x 16.0–19.4, z 6.6–9.4, door on its
 * W face, HALT sign on its S face) stood on a 6.6 m crag right beside the E stair and read as a tank from the camera
 * (user request 2026-10-02: "Fuel tank in the dam mission is too close to the stairs"). The dam hides it
 * (`hideParts`) and `dam_shack` rebuilds that very part (`assetPart`) on the ground by the truck road N of the dam.
 */
const SHACK_PART = { asset: 'dam_arch', box: [16.0, 6.6, 19.4, 9.4], pad: 0.7, y: [-0.8, 4.6] };
/** Water surface of the raised reservoir (the asset's reservoir sits 1.2 m under its deck). */
export const M3_RESERVOIR_LEVEL = DAM.elev - 1.2;

const E7_LOOP = [P(104, 50), P(138, 50, 3, 90), P(138, 89), P(116, 78), P(104, 64, 3, 180)];

export default {
  id: 'm03',
  campaign: 'BEL',
  title: 'Reverse Engineering',
  subtitle: 'Sysendam dam, Eidfjord, Norway · 4 March 1941',
  date: '1941-03-04',
  place: 'Sysendam dam near the Sima hydro plant, Eidfjord',
  theater: 'snow',
  treeSnow: 1.15, // snow load on the conifers (0..1.3; art/terrain.js): deep inland snow
  coneColors: 'green',
  size: [148, 133],
  seed: 1941_0304,
  briefing: {
    historical: 'March 1941. High above Eidfjord, the dam at Sysen powers the valley\'s plant and carries its only crossing. Bring it down, and the Germans lose their power and their road for months.',
    text: 'You\'ll come in from the plateau in the north-east. Our charges are already inside the power station south of the river, but the station fence is electrified. Find the switch before your Sapper touches the wire. There\'s a German camp on the east bank; with luck your Spy can borrow a uniform there. Destroy the bunker at the dam and then the dam itself. When it goes, a truck will come for you north of the dam. Mind your step, officer.',
    objectivesSummary: 'Destroy the dam bunker. Demolish the dam. Escape in the truck north of the dam.',
    hints: [
      'The station fence is live; the switch is inside.',
      'The explosives are in the station shed.',
      'A uniform hangs outside the east camp, by the river.',
      'Anything suspicious in the east camp or south of the river raises the alarm.',
      'The bunker gunner turns towards any noise. Give him something to look at before you go behind him.',
      'The dam\'s weak point is the spillway gates in the middle of the crest. Light the fuse and get off the crest.',
      'The truck will wait north of the dam.',
    ],
  },
  lighting: { sunElevDeg: 18, sunAzimuthDeg: 315, kelvin: 6000, hdri: 'overcast', fog: null, lut: 'norway' },
  // tailwater below the dam; `iceFree`: the pool where the dam's water lands stays open (no shore ice)
  water: { velocity: 1.0, angleDeg: 42, turbulence: 0.6, iceFree: [{ x: damPt(0, 5)[0], z: damPt(0, 5)[1], r: 11 }] },
  shoreShallowWidth: 2.0,
  baseTerrain: 'snow',
  terrain: [
    // T1 reservoir (N of the dam, held up at M3_RESERVOIR_LEVEL: `level` makes it its own raised water body)
    // `iceFree`: open water right up to the dam's upstream face (the shore ice stays on the rock shores)
    { type: 'poly', terrain: 'water', level: M3_RESERVOIR_LEVEL, drainOn: 'dam',
      iceFree: [-26, 0, 26].map((a) => { const [x, z] = polar(22, a); return { x, z, r: 9 }; }),
      // (against the dam it runs under its upstream parapet from the crest's edge, its ends inside the rock abutments: no dry seam)
      points: [[0, 0], [55, 0], [56, 10], [55, 18], ...arc(20.97, 38.5, -38.5), [25, 27.4], [14, 29], [0, 30]] },
    // T2 river from the foot of the dam (towards the camera), bending SE to the SE corner (its end runs past the corner: ending at (150, 129) left a snow
    // triangle with an ice ring on the corner point itself, marking the map boundary)
    { type: 'path', terrain: 'water', ...tailwaterPath([[41, 23], [44, 35], [52, 46], [60, 54], [84, 74], [108, 94], [132, 114], [153, 131.5]], 20) },
    // T3 dam-toe ledge along the foot of the face (the auto 2 m rim is added by the builder)
    { type: 'poly', terrain: 'shallow', points: TOE },
    // T4 station yard (= fence polygon) and camp interior (= palisade polygon)
    { type: 'poly', terrain: 'ground', points: [[4, 58], [34, 58], [70, 90], [70, 126], [4, 126]] },
    { type: 'poly', terrain: 'ground', points: [[98, 48], [142, 48], [142, 96], [126, 90], [98, 66]] },
    // T5 station road through the W gate; dirt road to the truck pickup north of the dam
    { type: 'path', terrain: 'road', points: [[0, 92], [4, 92], [20, 92], [26, 88]], width: 5, surface: 'snow_packed' },
    { type: 'path', terrain: 'road', points: [[60, 0], [60, 12]], width: 4, surface: 'snow_packed' },
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
    // demolition marker for o2: the bomb must be armed within 3 m of the spillway gates in the middle of the crest
    // (the face's foot is out of bounds, `noWalk`): the gate piers and their hoists are the arch's weak section, and
    // dam_arch_destroyed breaks open right there (gap_x ±4.6; render/dam-breach BREACH u0 0)
    { id: 'dam_charge', x: damPt(0, 0)[0], z: damPt(0, 0)[1], r: 3, target: 'dam' },
  ],
  structures: [
    // --- dam and bunker (objectives, bomb only). The crest is a walkable deck (bridge cells).
    // `points` = the curved walkable crest (bridge cells, raised to `elev`); `ramps` = the two crest stairs;
    // `waterFx` = the water running down the face (render/dam-water.js) and the burst's surge line (render/dam-breach.js)
    { id: 'dam', type: 'dam', variant: 'concrete_arch', x: DAM.x, z: DAM.z, rot: deg(DAM.rot), w: 27, d: 3, h: 14, deck: true,
      elev: DAM.elev, walkY: DAM.walk, points: CREST,
      ramps: [{ id: 'stair_w', points: W_STAIR, width: 1.6, y0: 0.25, y1: DAM.walk, landing: 1.6 }, { id: 'stair_e', points: E_STAIR, width: 1.6, y0: 0.25, y1: DAM.walk, landing: 1.6 }],
      waterFx: { downstream: [[44, 35], [50, 43.5], [56, 50]], surge: [[44, 35], [52, 46], [60, 54], [84, 74], [100, 87.5]] },
      hideParts: [SHACK_PART], // its control shack stands on the ground by the truck road (`dam_shack`)
      destructible: true, bombOnly: true, marker: 'dam_charge', hp: 100, destroyFx: ['collapse', 'flood', 'removeCrest'],
      // the surge drowns the toe ledge (T3) + its rim: with the crest gone the two banks are split
      floodPoly: [...arc(18, -42, 42, 12), ...arc(10.5, 42, -42, 12)] }, // the whole foot of the face, abutment to abutment
    // rock rims holding the raised reservoir (S and E shores)
    // (rim_s and abut_e close on the dam's ends and run down beside its stairs: `abutment` above)
    { id: 'rim_s', type: 'cliff', points: [[-1, 29.5], [14, 28.5], [25, 26.6], AB_W.water, AB_W.end, AB_W.cut, AB_W.top, AB_W.low, [14, 34.4], [-1, 35]], h: 7.6, climbable: false,
      abut: [[AB_W.end, AB_W.cut], [AB_W.cut, AB_W.top], [AB_W.top, AB_W.low]] },
    // the dam's gate-keeper shack (its own part of the dam asset, `assetPart`) on the ground E of the truck road at the
    // N edge, door to the road, parallel to it, its HALT sign to the camera (12 m clear of cliff_w, which would hide
    // it); nav: false (no climbable roof)
    { id: 'dam_shack', type: 'hut', variant: 'dam_shack', x: 64.4, z: 2.6, rot: 0, w: 3.4, d: 2.8, h: 2.95, assetPart: SHACK_PART, nav: false },
    { id: 'rim_e', type: 'cliff', points: [[55, -1], [58.4, -1], [58, 9], [57.4, 15.5], [56.6, 20.2], [55, 21.2], [54.6, 18], [55, 12]], h: 7.6, climbable: false },
    // its S end grows into the dam's E abutment: a massif of its own merging into rim_e (rim_e itself is left as it was:
    // its faces by the truck road, where the escape truck turns, keep their shape)
    { id: 'abut_e', type: 'cliff', points: [[55.9, 15.2], [57.25, 16.4], [58.4, 22], [58.4, 26.3], AB_E.low, AB_E.top, AB_E.cut, AB_E.end, AB_E.water, [55.2, 17.2]], h: 7.6, climbable: false,
      abut: [[AB_E.low, AB_E.top], [AB_E.top, AB_E.cut], [AB_E.cut, AB_E.end]] },
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
    { id: 'cliff_w', type: 'cliff', points: [[63, 17], [74, 17], [74, 34], [65, 31]], h: 10, climbable: false },
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
    ...[[70.2, 4.2], [70.5, 9], [90, 6], [130, 6], [140, 10], [6, 50], [2, 70], [90, 48], [146, 60]]
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
  noWalk: [{ id: 'dam_front', points: DAM_FRONT }, ...[AB_W, AB_E].map((a, k) => ({ id: `dam_end_${'we'[k]}`, points: [a.top, a.head, a.cut] }))],
  objectives: [
    { id: 'o1', text: 'Destroy the dam bunker', type: 'destroy', targets: ['dam_bunker'], required: true, bombOnly: true },
    { id: 'o2', text: 'Demolish the dam', type: 'destroy', targets: ['dam'], marker: 'dam_charge', required: true, bombOnly: true },
    { id: 'o3', text: 'Escape in the truck north of the dam', type: 'escape', required: true, vehicleId: 'evac_truck' },
  ],
  // the friendly truck spawns off-map when o1 and o2 are done, drives to (60,10) (NE of the reservoir) at 6 m/s
  // and waits; once everyone is aboard it drives off north (ESC skips)
  extraction: {
    vehicleId: 'evac_truck', vehicleType: 'truck', friendly: true, seats: 6, spawnWhen: ['o1', 'o2'],
    spawnAt: { x: 60, z: -6, heading: deg(90) }, arrive: { x: 60, z: 10, speed: 6 }, exit: { x: 60, z: 0, r: 3 },
  },
  // the water falling down the dam, layered and positional (all stop when the dam is destroyed): the rush of the falls
  // at the face, the low roar of the plunge pool, and the tailwater rushing away downstream
  ambience: [
    ['waterfall', 0.6, { at: { x: damPt(0, 3.6)[0], z: damPt(0, 3.6)[1] }, until: 'dam' }],
    ['waterfall_roar', 0.55, { at: { x: damPt(0, 6)[0], z: damPt(0, 6)[1] }, until: 'dam', rate: 0.62 }],
    ['rapids', 0.4, { at: { x: 50, z: 43.5 }, until: 'dam', rate: 1.12 }],
  ],
  par: { time: 720 },
  cameraStart: { x: 108, z: 14, zoom: 1 },
  startDisguised: [], // the Spy starts WITHOUT the uniform (clothesline at the east camp)
};