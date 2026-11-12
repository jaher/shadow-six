/**
 * Line extras (roads-and-tracks r1): per-mission VISUAL data for the road model of world/roads.js — every trodden route,
 * vehicle rut and per-road look option the terrain audits name — keyed by mission id. Nothing here reaches the
 * simulation: the nav grid, LOS, footprints and the road network the sim reads (normalizeRoadNetwork) are untouched;
 * the splat painter (terrainPainter), the pre-trampled ruts (pretrampleRoads, stamped with no gameplay record) and the
 * non-blocking telegraph poles (expandFurniture) are the only readers.
 *
 * Entry fields (all optional):
 *   recipe      'thaw' — the theatre's verge / rut table variant (M6, Masi in May)
 *   roads       [{match: {id} | {near: [x, z], r?}, ...opts}] per-road options, matched against the normalized network:
 *                 smooth (corner fillet radius, m), widthRange [min, max] (visual width, m), wander (fraction),
 *                 pairs / gauge / wear / passes (rut lanes), vergeW [min, max], vergeLeft / vergeRight (cap, m; left =
 *                 + side of travel), ends {start|end: 'open'|'joined'|'edge'|'hard'}, taper (m), course (visual centre
 *                 line replacing the authored points), glaze (snow), tongues (false: no desert sand tongues),
 *                 hardVerge [min, max] (hard ribbons' worn shoulder), rutsPast (m: ruts running onto a hard ribbon's
 *                 ends), skip
 *   lines       [{kind, pts, w?, strength?, passes?, gauge?, pairs?, paint?, ruts?, seed?}] trodden lines:
 *                 'foot' (path, walkers), 'boot' (deep-snow boot lane, ~40 passes), 'drag', 'cart' (two narrow ruts),
 *                 'vehicle' (a tyre pair), 'tracked' (two track bands), 'sled'
 *   stamps      [{kind: 'track'|'tire'|'drag', pts, width?, load?}] static marks (a wreck's track links, outrigger drags)
 *   areas       {pavementId: {ring?: m, wash?: m}} worn ring round a pad / dirt-oil wash outside a slab
 *   poles       [{line: telegraph index, slide: {poleIndex: Δs m}}] non-blocking poles slid along their line
 *   campRuts    {seed, mask: [{pts, w}], scuff: {poly, a, patches?}} art/camp-ruts.js (matched by the decal spec's seed):
 *                 lanes masked where a road already runs, low-alpha scuff patches over the hardpan
 *   fans        [{x, z, r, dir: [dx, dz], recipe}] mud / grit / gravel fans painted where wheels leave a surface or stop
 * Road references key on geometry (`near`), not on positional ids, so a mission whose roads another lane re-lays keeps
 * working, and a reference that matches nothing is a no-op.
 * @module world/line-extras
 */

/** @type {Record<string, object>} */
export const LINE_EXTRAS = {
  // ---- M0 Sandbox (Flanders polder): the pave's verges, the depot's lorry and patrol wear, the farm's trodden paths
  m00: {
    roads: [
      { match: { near: [20, 30] }, ends: { end: 'joined' }, vergeW: [0.7, 1.2] },        // under the pave, on to the deck
      { match: { near: [52, 30] }, ends: { start: 'joined' }, vergeW: [0.6, 1.0] },     // off the deck into the yard
    ],
    lines: [
      { kind: 'foot', w: 1.3, strength: 0.75, pts: [[49, 20], [49, 33], [49, 46], [55, 46], [55, 33], [55, 20], [49, 20]] }, // patrol_east's beat
      { kind: 'vehicle', strength: 0.9, passes: 3, pts: [[44.6, 30.2], [47.6, 31.3], [50.4, 34.2], [52, 37.6]] },          // the lorry: gate → tank apron
      { kind: 'foot', w: 1.2, pts: [[16, 17.2], [16.2, 21], [15.8, 24.5], [16, 28.2]] },                                     // farmhouse door → road
      { kind: 'foot', w: 1.0, strength: 0.8, pts: [[16.8, 17.4], [19, 17.4], [20, 14.4], [22.2, 11.6], [23.2, 8.5], [22.8, 5.6]] },  // door → well (round the handcart)
      { kind: 'foot', w: 1.1, strength: 0.8, pts: [[25.3, 31.6], [25.6, 35], [25.9, 39.4]] },  // road → paddock gate (clear of the telegraph pole)
    ],
    fans: [{ x: 35.6, z: 30, r: 1.8, dir: [1, 0], recipe: 'fan' }, { x: 44.6, z: 30, r: 1.4, dir: [-1, 0], recipe: 'fan' }],
    areas: { yard_road: { wash: 0.28 }, yard_depot: { wash: 0.28 } },
  },
  // ---- M1 Baptism of Fire (Sola, February): coast road rut pairs, farm and camp lanes, the parked vehicles' ruts
  m01: {
    roads: [
      { match: { near: [26, 131] }, pairs: 3, glaze: 0.85, vergeW: [0.5, 1.0] },
      { match: { near: [26, 26] }, ends: { start: 'open' }, taper: 3 },                   // the camp track fades out at the pier
    ],
    lines: [
      { kind: 'foot', w: 1.3, pts: [[30.5, 108.8], [31, 106], [31.6, 103.6], [32, 102.2]] },                            // house door → jetty
      { kind: 'foot', w: 1.1, pts: [[31.6, 108.2], [35, 108.6], [38.2, 108.2]] },                                          // house → stabbur
      { kind: 'foot', w: 1.3, pts: [[12.5, 14.8], [13.2, 20], [14.6, 25.8], [14.9, 27.6], [14.3, 28.8]] },  // relay hut → barr_2 (past the log pile)
      { kind: 'foot', w: 1.3, pts: [[14.6, 13.6], [20, 14.4], [25, 14.8], [28, 15]] },                                   // relay hut → barr_L_a
      { kind: 'foot', w: 1.2, pts: [[33.2, 22.6], [34.8, 25.2], [36.4, 26.4]] },                                         // barr_L_a → barr_L_b
      { kind: 'foot', w: 1.2, pts: [[16.2, 35.2], [19, 37.4], [21, 38.4]] },                                             // barr_2 → MG ring
      { kind: 'boot', w: 1.4, strength: 0.6, passes: 18, pts: [[5, 36], [5, 6], [26, 3], [46, 8], [48, 18], [46, 33], [28, 37.5], [5, 36]] }, // p3's loop
      { kind: 'vehicle', gauge: 1.35, passes: 2, strength: 0.85, pts: [[14, 18.8], [16.5, 15.6], [19.2, 13]] },          // the Kubelwagen
      { kind: 'vehicle', gauge: 1.1, passes: 2, strength: 0.8, pts: [[27.2, 10.4], [31, 11.2], [34.2, 12.2]] },        // the BMW combination
    ],
  },
  // ---- M2 A Quiet Blow-Up (Stamsund): escape road rut pairs, the village path, the gate's truck line
  m02: {
    roads: [
      { match: { near: [66, 58] }, pairs: 2, gauge: 1.8, glaze: 0.7 },
      { match: { near: [20, 96] }, foot: true, passes: 14, vergeW: [0.3, 0.7], ends: { end: 'open' }, taper: 2.5 },   // village path
    ],
    lines: [
      { kind: 'vehicle', gauge: 1.8, passes: 3, pts: [[50.6, 44.4], [53, 46.4], [55.4, 48.4], [57, 50]] },               // the truck line: gate → road
      { kind: 'foot', w: 3, strength: 0.7, passes: 10, pts: [[31.6, 89.4], [28.5, 84], [26, 80.5]] },                    // the landing at the faerings
      { kind: 'drag', w: 0.6, strength: 0.8, pts: [[24.4, 76.6], [24, 74.3], [23.6, 72.6]] },
      { kind: 'drag', w: 0.6, strength: 0.8, pts: [[26.9, 77.6], [27.3, 75.4], [27.6, 73.8]] },
    ],
  },
  // ---- M3 Reverse Engineering (Vemork, March): one rut model for the station road + works road, the camp track
  m03: {
    roads: [
      { match: { near: [12, 92] }, pairs: 2 },
      { match: { near: [33, 87.6] }, pairs: 2 },
      // the camp track bent 2.5 m W of the well (visual centre line), fading into the gate gap with boot prints
      { match: { near: [120, 60] }, course: [[118, 49], [120, 60], [121.2, 70], [128, 82]], ends: { start: 'open' }, taper: 4, pairs: 1 },
    ],
    lines: [
      { kind: 'boot', w: 1.4, strength: 0.7, passes: 16, pts: [[16, 105.2], [30, 104.8], [45, 105.3], [58, 105]] },  // switchyard aisle between the cage rows (patrol line)
      { kind: 'boot', w: 1.2, strength: 0.6, passes: 12, pts: [[37, 96], [37.3, 110], [36.8, 124]] },
      { kind: 'boot', w: 1.2, strength: 0.55, passes: 10, pts: [[24, 64], [27, 78], [30, 92]] },
      { kind: 'boot', w: 1.4, strength: 0.6, passes: 14, pts: [[104, 50], [138, 50], [139, 90], [115.5, 79.2], [104, 64], [104, 50]] }, // e7's loop
      { kind: 'foot', w: 1.6, strength: 0.7, passes: 10, pts: [[117.4, 46], [117.8, 48.6], [118.2, 51]] },              // boots through the gate gap
    ],
  },
  // ---- M4 Restore Pride: grit where the lorry stops (crossing, gatehouse)
  m04: {
    roads: [{ match: { near: [121, 70] }, pairs: 2, glaze: 0.6 }],
    fans: [{ x: 165.5, z: 77.8, r: 4.5, dir: [0.7, 0.7], recipe: 'grit' }, { x: 104.5, z: 58.5, r: 4, dir: [0.7, 0.7], recipe: 'grit' }],
  },
  // ---- M5 Blind Justice: Patrol 19's beaten track and the village footpath as boot lanes; the motorcycle's tyres
  m05: {
    lines: [
      { kind: 'boot', w: 2.2, strength: 0.9, passes: 40, pts: [[20, 33], [21.6, 38.5], [24.2, 43.6], [23.4, 50.5], [21.6, 55.5], [21.8, 62], [22.2, 64], [23, 65], [23.66, 65.5], [24.08, 66], [24.42, 67], [24.84, 68.5], [25.12, 69.5], [25.3, 71.5], [25.4, 73.6], [24.8, 78.8], [24.9, 84.4], [25, 89.4], [27.4, 92.8], [32.4, 94.8], [38.6, 96.8], [44, 99]] },
      { kind: 'boot', w: 1.7, strength: 0.95, passes: 40, pts: [[44, 99], [48, 114], [66, 118], [82, 117], [90, 110], [95, 100], [98, 94]] },
      { kind: 'vehicle', gauge: 1.1, passes: 2, strength: 0.8, pts: [[31.5, 52], [38, 51.4], [44, 50], [49, 49.4], [52.6, 50]] },
    ],
  },
  // ---- M6 Menace of the Leopold (Masi, May thaw): crowned road, verge, tent lines and garrison exits
  m06: {
    recipe: 'thaw',
    roads: [{ match: { near: [44, 70] }, vergeW: [0.8, 1.2], pairs: 2 }],
    // the HQ's apron churned to wet mud (the mud layer's wet term puddles the garrison's prints on it)
    fans: [{ x: 88.4, z: 86.2, r: 3.4, dir: [0.25, 1], recipe: 'fan' }, { x: 59, z: 55.6, r: 2.6, dir: [0, 1], recipe: 'fan' }],
    lines: [
      { kind: 'cart', gauge: 1.0, passes: 2, strength: 0.75, pts: [[20.8, 91], [22.6, 91], [24.2, 91]] },                // the handcart's rut dashes
      { kind: 'foot', w: 1.4, strength: 0.85, pts: [[54.5, 63.4], [62, 63.2], [70, 61.4], [78, 62.2], [86.5, 62.8]] },    // the tent line
      { kind: 'foot', w: 1.0, strength: 0.7, pts: [[81, 62.6], [81.2, 64.8]] },
      { kind: 'foot', w: 1.3, strength: 0.85, pts: [[59, 53.4], [60.4, 57.6], [60.2, 62.2], [57.2, 65.2], [55.4, 70.4], [53, 71.4]] },  // barracks → road (between the tents, round the crates)
      { kind: 'foot', w: 1.3, strength: 0.85, pts: [[87.6, 83.4], [88.8, 87.6], [90.2, 91]] },                           // HQ → road
      { kind: 'foot', w: 1.1, strength: 0.6, pts: [[37.6, 75.2], [40, 76], [47, 76.2], [52, 75.2]] },                         // tents 8/9 → road
    ],
  },
  // ---- M7 Chase of the Wolves: the desire-line network, quay half-track and cart ruts, the village lane, the sled road
  m07: {
    // (the quay strip: bollards at its face, lamps at its back, no room for a wheel lane between them — no ruts on it;
    //  the carts and the half-track run inland of the lamps)
    roads: [{ match: { near: [26, 123] }, pairs: 0 }],
    lines: [
      { kind: 'tracked', gauge: 1.75, w: 2.4, passes: 1, strength: 0.85, pts: [[45.47, 132.05], [42.13, 129.19], [38.99, 126.71], [34.52, 123.45], [31.72, 122.08], [29.44, 121.62], [27.26, 120.3]] },  // the half-track's tracks to its stand, inland of the lamp row and swinging in clear of the bollards (the game's placement moves them 3.5 m in off the water: quay_bollard_7 stands 4.5 m ahead of its nose)
      { kind: 'cart', gauge: 1.3, passes: 2, strength: 0.7, pts: [[7.3, 99.73], [14.85, 106.28], [23.96, 114.1], [33.13, 121.85], [42.24, 129.66]] },  // the quay carts, inland of the lamps and the parked half-track
      { kind: 'foot', w: 1.5, pts: [[28, 67.6], [22, 71], [15.6, 74.4]] },                                              // gate_n → barr_dock
      { kind: 'foot', w: 1.4, pts: [[29.6, 67], [38, 69.4], [44.6, 71.6]] },                                            // gate_n → house_mid
      { kind: 'foot', w: 1.4, pts: [[30, 66.4], [45, 65.4], [58, 68.4], [63, 75.4]] },                                  // gate_n → barr_mid
      { kind: 'foot', w: 1.2, pts: [[9, 81.6], [6.6, 87], [5.6, 90]] },                                                 // barr_dock → gun 22
      { kind: 'foot', w: 1.2, pts: [[40, 118], [44, 128], [46.4, 135]] },                                               // quay → gun 23
      { kind: 'foot', w: 1.3, pts: [[34, 113.2], [19.57, 115.39], [14, 120.6]] },  // crane → pier root (between bollards)
      { kind: 'foot', w: 1.3, pts: [[50.6, 48.8], [58, 51], [66, 54.4], [72, 57]] },  // stores pocket → gate_ne
      // the village lane links the doors round the houses (h_big W door → h_1 S door → h_3 W door; round h_3's N gable to h_5's N door)
      { kind: 'foot', w: 2.6, strength: 0.95, passes: 10, pts: [[99.6, 66.4], [99.4, 72], [101.6, 75.4], [105.6, 76.4], [107, 78.6], [108, 81.8], [112.6, 82.4], [113.4, 84.5], [114, 88.4]] },
      { kind: 'foot', w: 2.2, strength: 0.95, passes: 8, pts: [[113.4, 85.6], [115.6, 82.2], [121.6, 80.8], [124, 85], [126.4, 89.5], [127, 91.2]] },
      { kind: 'foot', w: 1.0, strength: 0.7, pts: [[114, 79.4], [114.8, 82]] }, { kind: 'foot', w: 1.0, strength: 0.7, pts: [[124.5, 77], [122.6, 84]] },
      { kind: 'foot', w: 1.0, strength: 0.7, pts: [[114.2, 88.5], [112.4, 88.9]] }, { kind: 'foot', w: 1.0, strength: 0.7, pts: [[127, 91.3], [127.3, 89.2]] },
      { kind: 'foot', w: 1.0, strength: 0.7, pts: [[103.8, 95.4], [108, 89]] },
      { kind: 'foot', w: 1.2, pts: [[136, 117.4], [137.6, 120.2]] }, { kind: 'foot', w: 1.2, pts: [[127.4, 121.6], [124, 122.6], [121, 124]] }, // naust → jetties
      { kind: 'sled', gauge: 0.9, passes: 2, strength: 0.8, pts: [[100.2, 104.4], [101.4, 107.6], [102.4, 110.8]] },  // a sled hauled from h_6's deck to the beached boat
    ],
  },
  // ---- M8 Pyrotechnics: pistes into sand2 / dirt, the pole-side verge, garrison beats, the dump loops
  m08: {
    roads: [
      { match: { near: [40, 36] }, vergeLeft: 0.2, wander: 0.03 }, // (the telegraph poles stand 0.9-1.1 m off this side: the paint stops short of them)
    ],
    lines: [
      { kind: 'foot', w: 1.3, strength: 0.8, pts: [[36.2, 61.2], [38.4, 60.6], [40.4, 58.4], [43.2, 57]] },
      { kind: 'foot', w: 1.3, strength: 0.8, pts: [[36, 56.6], [44.6, 49.6], [50.4, 48.9]] },
      { kind: 'foot', w: 1.2, strength: 0.75, pts: [[52.4, 58], [56, 64], [60, 67.6]] },
      { kind: 'foot', w: 1.2, strength: 0.7, pts: [[58, 50], [64, 47], [68, 46]] },
      { kind: 'foot', w: 1.3, strength: 0.8, pts: [[25, 62.4], [19.4, 67.2], [14.4, 71], [12.4, 77]] },
      { kind: 'foot', w: 1.1, strength: 0.6, pts: [[12, 80], [11.6, 86], [11.6, 89]] },
      { kind: 'vehicle', gauge: 1.8, passes: 2, strength: 0.75, pts: [[16, 50.6], [13, 52.6], [9.8, 53.4], [6.8, 55]] },  // the bowser's stand at the oil tanks
    ],
  },
  // ---- M9 A Courtesy Call: road_w's open end, piste edges, the Flak's outriggers, the wreck's track links, the camp decal
  m09: {
    roads: [
      { match: { near: [40, 74] }, ends: { end: 'open' }, taper: 7.5, windrow: true },
      { match: { near: [80, 18] }, windrow: true },
    ],
    stamps: [
      // the 8.8 cm Flak's four outrigger feet pushed into the sand as it was emplaced
      { kind: 'drag', width: 0.45, load: 0.7, pts: [[90.6, 111.3], [91.6, 111.6]] }, { kind: 'drag', width: 0.45, load: 0.7, pts: [[87.2, 113.1], [86.9, 114.1]] },
      { kind: 'drag', width: 0.45, load: 0.7, pts: [[85.4, 109.7], [84.4, 109.4]] }, { kind: 'drag', width: 0.45, load: 0.7, pts: [[88.8, 107.9], [89.1, 106.9]] },
      // the burnt Panzer III's tracks pressed into the sand under its hull
      { kind: 'track', width: 0.42, load: 0.8, pts: [[98.9, 23.1], [92.6, 22.2]] }, { kind: 'track', width: 0.42, load: 0.8, pts: [[98.5, 20.6], [92.2, 19.7]] },
    ],
    campRuts: {
      seed: 19421020,
      // road_w and road_ne (their own splat paint is the lane there); the lane runs on past road_w's open end at (48, 60)
      mask: [{ pts: [[0, 95], [12, 93.5], [25.5, 89], [33, 82], [40, 74], [47, 62]], w: 5 }, { pts: [[88, 0], [83, 12], [77, 24], [75.4, 30]], w: 5 }],
      scuff: { poly: [[27, 6], [53, 6], [73, 30], [77.5, 31.5], [93, 40], [93.5, 65], [65, 97], [42, 74], [38, 72], [30, 62], [15, 62], [5, 51], [5, 27]], a: 0.11 },
    },
  },
  // ---- M10 Operation Icarus: the nests' path, tyre wear out of the N gate (the landing ground: art/airstrip.js)
  m10: {
    // through the N gate the authored line doglegs (a 4 m stub then a sharp turn SE): the visual course swings round in
    // one curve instead, so the lanes do not loop under the arch
    roads: [{ match: { near: [56, 116] }, ends: { start: 'joined' },
      course: [[40, 138], [39.8, 135.4], [40.9, 132.6], [43.6, 130], [47, 128], [56, 116], [64, 104], [67, 92], [67, 70], [67.5, 64]] }],
    lines: [
      { kind: 'foot', w: 1.2, strength: 0.75, pts: [[54, 64.2], [57, 59.4], [62, 57.4], [66, 55.6], [70.4, 56.4], [73, 57.8], [76.6, 61.6], [78, 66]] },  // nest to nest round the wire belts' south ends
      { kind: 'foot', w: 1.2, strength: 0.75, pts: [[79, 68.4], [80, 78], [79.2, 88], [78.2, 92.8]] },
      { kind: 'vehicle', gauge: 1.8, passes: 3, strength: 0.85, pts: [[40, 137.6], [42, 141.6], [45.4, 146.2], [50.6, 149.8]] },
    ],
  },
  // ---- M11 In the Soup: the floor pistes (ruts inside ±0.8 m, windrows, tongues, width 3.5-6 m), junction fans, rig spurs,
  //      camp footpaths, the tanker's shuttle
  m11: {
    roads: [
      { match: { near: [40, 66] }, widthRange: [3.5, 6], pairs: 1, gauge: 1.6, windrow: true, fillet: 3.5 },
      { match: { near: [53, 85] }, widthRange: [3.5, 5.5], pairs: 1, gauge: 1.6, windrow: true, fillet: 3.5 },
      { match: { near: [30, 134] }, widthRange: [3.5, 6], pairs: 1, gauge: 1.6, windrow: true, fillet: 3.5 },
      { match: { near: [69, 143] }, widthRange: [3.5, 5.5], pairs: 1, gauge: 1.6, windrow: true, fillet: 3.5 },
      { match: { near: [70, 57] }, fillet: 3.5 }, { match: { near: [40, 36] }, fillet: 3.5 },
    ],
    lines: [
      { kind: 'vehicle', gauge: 1.8, passes: 3, strength: 0.85, pts: [[34, 93], [42, 93.8], [50, 94], [53.4, 93.6]] },   // rig_w → road
      { kind: 'vehicle', gauge: 1.8, passes: 3, strength: 0.85, pts: [[91.6, 80], [88.6, 78.4]] },                      // rig_e
      { kind: 'vehicle', gauge: 1.8, passes: 3, strength: 0.85, pts: [[80, 29.4], [79.6, 24], [79, 19]] },              // rig_nw
      { kind: 'vehicle', gauge: 1.8, passes: 3, strength: 0.85, pts: [[91, 43.6], [91, 50], [90.6, 56]] },              // rig_ne
      { kind: 'vehicle', gauge: 1.85, passes: 4, strength: 0.95, pts: [[70, 48.6], [70.8, 43.6], [71.6, 40.2]] },  // tanker shuttle (to its stand at the tanks)
      { kind: 'foot', w: 1.3, strength: 0.8, pts: [[15.8, 114.4], [19, 115.8], [24, 117], [30, 117.4], [33, 117.8]] },
      { kind: 'foot', w: 1.3, strength: 0.8, pts: [[10, 133.4], [16, 131.8], [24, 132], [31.6, 131.4], [32.4, 128]] },
      { kind: 'foot', w: 1.2, strength: 0.75, pts: [[19, 141], [26, 138], [34, 131], [37, 127.6]] },
      { kind: 'foot', w: 1.1, strength: 0.7, pts: [[30, 140.4], [36, 134]] },
      { kind: 'foot', w: 1.1, strength: 0.7, pts: [[44.4, 129], [41, 127], [38, 124.6]] },
      { kind: 'foot', w: 1.1, strength: 0.7, pts: [[45, 140], [40, 135.4]] },
    ],
  },
  // ---- M12 Up on the Roof: the non-blocking telegraph poles slid clear of truck_q / car_q
  m12: {
    poles: [{ line: 0, slide: { 1: 2.6, 2: 3.4 } }],
  },
  // ---- M14 D-Day Kick-Off: the pads' worn rings, the supply track's wear along its length, the spurs, the garrison paths
  m14: {
    areas: { pad_bar_n: { ring: 2 }, pad_bar_s: { ring: 2.2 } },
    roads: [{ match: { near: [60, 56] }, wearAt: [[55, 111.5, 9, 1.5], [79.5, 75, 9, 1.4], [70, 105, 8, 1.35], [57.5, 72.5, 8, 1.35], [12, 72, 10, 1.4], [40, 108.5, 8, 1.2]] }],
    lines: [
      { kind: 'vehicle', gauge: 1.75, passes: 3, strength: 0.8, pts: [[55, 111.5], [56.4, 115.2], [58, 119]] },
      { kind: 'vehicle', gauge: 1.75, passes: 3, strength: 0.8, pts: [[79.2, 74], [79.4, 69.6], [86, 68.8], [91.6, 67.6]] },
      { kind: 'vehicle', gauge: 1.75, passes: 3, strength: 0.8, pts: [[70, 105], [75.2, 100.6], [80, 97]] },
      { kind: 'foot', w: 1.2, strength: 0.8, pts: [[57, 73], [58, 82], [57.4, 92], [56, 100]] },
      { kind: 'foot', w: 1.1, strength: 0.75, pts: [[60.2, 103.6], [63, 104.2], [70, 100.8], [82, 95], [90, 92.4]] },
      { kind: 'foot', w: 1.1, strength: 0.75, pts: [[63.4, 70], [75, 72], [86, 74.4], [91, 75.4]] },
      { kind: 'foot', w: 1.1, strength: 0.7, pts: [[62, 64.6], [66, 60.2], [72, 57.4], [80, 54]] },
    ],
  },
  // ---- M15 The End of the Butcher: the tanker's arcs on the fuel lot, the cemetery's gravel paths
  m15: {
    lines: [
      { kind: 'vehicle', gauge: 1.85, passes: 4, strength: 0.9, pts: [[38.4, 21.6], [38.9, 17], [38.7, 12.4], [38.2, 8]] },  // the bowser off the north street
      { kind: 'vehicle', gauge: 1.85, passes: 3, strength: 0.75, pts: [[34.4, 16], [36.4, 11], [38, 7]] },
      { kind: 'foot', w: 1.5, strength: 0.95, recipe: 'gravel', pts: [[49.4, 23.2], [50.6, 19], [53.4, 16.6], [60.8, 13.6], [67, 12.6], [70, 12.4]] },  // cemetery gate → chapel
      { kind: 'foot', w: 1.5, strength: 0.9, recipe: 'gravel', pts: [[47.6, 4.4], [60, 4.4], [77, 4.6]] },
      { kind: 'foot', w: 1.5, strength: 0.9, recipe: 'gravel', pts: [[49.2, 23.4], [52, 22.4], [60, 22.2], [77, 22.4]] },
      { kind: 'foot', w: 1.5, strength: 0.9, recipe: 'gravel', pts: [[60.8, 4.5], [60.9, 13.6], [60.7, 22.2]] },
    ],
  },
  // ---- M16 Stop Wildfire: setts shoulders and ruts past the ends, the S road's splay, camp lanes, the dozer's tracks
  m16: {
    roads: [
      { match: { near: [12, 39] }, hardVerge: [1.0, 1.5], rutsPast: 3.5 },
      { match: { near: [100, 118] }, hardVerge: [1.0, 1.5], rutsPast: 3.5 },
      { match: { near: [160, 93] }, hardVerge: [1.0, 1.5], rutsPast: 3.5 },
      { match: { near: [130, 140] }, ends: { start: 'hard' }, pairs: 2 },
    ],
    fans: [{ x: 120.2, z: 131.4, r: 4.5, dir: [0.74, 0.67], recipe: 'fan' }, { x: 116.8, z: 133.6, r: 2.6, dir: [-0.6, 0.8], recipe: 'gravel' }],
    lines: [
      // (the tent lines' own paths keep 3.5 m off the tents: along their NW side, the lorry's track along their SE side)
      { kind: 'foot', w: 1.3, strength: 0.85, pts: [[55.5, 4.4], [50.8, 10.2], [45.4, 15.2], [40, 19.4], [34.6, 25.2], [28.8, 31.6], [25.5, 35.5]] }, // between the tents
      { kind: 'foot', w: 1.2, strength: 0.75, pts: [[35.2, 25.4], [30, 29.4], [22, 36], [17, 41]] },                   // camp → NW road
      { kind: 'foot', w: 1.2, strength: 0.8, pts: [[183.4, 31.2], [185.6, 32.2]] },                                    // station door → platform
      { kind: 'tracked', gauge: 1.9, w: 2.6, passes: 1, strength: 1, pts: [[166, 100], [167.4, 106], [167.6, 111.6], [171.4, 117.4], [177.4, 119.8]] }, // the bulldozer
      { kind: 'foot', w: 1.1, strength: 0.75, pts: [[23.4, 74.4], [25, 68], [27.4, 61.6]] },                           // pit → W ramp
      { kind: 'foot', w: 1.0, strength: 0.7, pts: [[22, 74.6], [21.6, 69], [21.5, 65.6]] },                            // pit → pillbox
      { kind: 'foot', w: 1.0, strength: 0.7, pts: [[88.6, 110.6], [90.4, 109.6]] },                                    // pb_e → road
      { kind: 'vehicle', gauge: 1.8, passes: 2, strength: 0.8, pts: [[61.5, 10.6], [60, 15.5], [56.5, 19.5], [50, 24.5], [44, 30.5], [37, 37.5], [30, 42], [22, 44.5], [17, 45]] }, // lorry → NW road
      { kind: 'foot', w: 0.6, strength: 0.5, pts: [[100, 95], [110, 85], [118, 80], [128, 72]] },                       // cattle / foot paths
      { kind: 'foot', w: 0.6, strength: 0.45, pts: [[104, 100], [116, 96], [130, 90]] },
      { kind: 'vehicle', gauge: 1.45, passes: 1, strength: 1, pts: [[134, 46], [130, 47.8], [127.4, 49.2]] },           // the car's skid down the bank
    ],
  },
  // ---- M17 Before Dawn: smoothed roads with width wander, shore-side gravel, the camp lanes, cattle and headland paths,
  //      the parked vehicles' ruts
  m17: {
    roads: [
      { match: { near: [20, 48] }, widthRange: [3.4, 4.6] },
      { match: { near: [36, 46.6] }, widthRange: [3.4, 4.4] },
      { match: { near: [45, 93] }, widthRange: [3.6, 4.6], shoreWin: true },
      { match: { near: [9, 112] }, widthRange: [3.4, 4.6] },
      { match: { near: [24, 162] }, widthRange: [3.4, 4.6] },
      { match: { near: [68, 150] }, widthRange: [3.4, 4.4] },
    ],
    lines: [
      { kind: 'cart', gauge: 1.35, passes: 2, strength: 0.85, pts: [[46, 167.2], [46.4, 171], [47.4, 175]] },          // clamp → road s
      { kind: 'vehicle', gauge: 1.8, passes: 2, strength: 0.8, pts: [[59.4, 123.6], [59.6, 119.6], [60.8, 116]] },        // gateway → fuel tanks
      { kind: 'foot', w: 1.3, strength: 0.85, pts: [[49.5, 95.6], [42, 99], [33, 102], [24, 104]] },                    // back gate along the wall
      { kind: 'foot', w: 1.2, strength: 0.8, pts: [[55, 131], [58.4, 128], [60.4, 124]] },
      { kind: 'foot', w: 1.1, strength: 0.75, pts: [[62.8, 123.8], [60.4, 124.6]] },
      { kind: 'foot', w: 1.2, strength: 0.8, pts: [[66.4, 130.4], [63.4, 128.4], [60.4, 126.4]] },
      { kind: 'foot', w: 1.2, strength: 0.8, pts: [[60, 145.4], [62.4, 140], [64.4, 136]] },
      { kind: 'foot', w: 1.2, strength: 0.8, pts: [[72.6, 143.6], [69.4, 143.8], [66.4, 143]] },
      { kind: 'foot', w: 0.55, strength: 0.45, pts: [[5, 30], [8, 27.6], [11.5, 24.6], [16.4, 24.4], [28, 22], [40, 24]] },                          // cattle paths
      { kind: 'foot', w: 0.55, strength: 0.45, pts: [[50, 10], [60, 15], [70, 22], [82, 26]] },
      { kind: 'foot', w: 1.0, strength: 0.75, pts: [[52, 27.6], [58, 27.8], [66, 27.6], [69.2, 28.2]] },                 // vineyard headland
      { kind: 'vehicle', gauge: 1.35, passes: 2, strength: 0.85, pts: [[73.4, 174], [75, 171.6], [76.2, 169.6]] },      // kubel_gate
      { kind: 'vehicle', gauge: 1.45, passes: 2, strength: 0.85, pts: [[38, 45.6], [39.2, 42.6], [40, 40.6]] },         // car_hq
      { kind: 'vehicle', gauge: 1.1, passes: 2, strength: 0.75, pts: [[42.6, 49], [42.9, 46], [42.8, 44.2]] },            // moto_hq
      { kind: 'vehicle', gauge: 1.8, passes: 2, strength: 0.8, pts: [[3, 47], [4, 35], [5, 24], [6, 16.4]] },           // the escape lorry
      { kind: 'vehicle', gauge: 1.8, passes: 2, strength: 0.8, pts: [[12, 121.6], [15, 121.1], [17.4, 120.6]] },        // truck_winch
    ],
  },
  // ---- M18 The Force of Circumstance: setts shoulders with gutter streaks, the S road's bed and fan, camp churn, the tank arc
  m18: {
    roads: [
      { match: { near: [12, 39] }, hardVerge: [0.8, 1.5], gutter: true, rutsPast: 3 },
      { match: { near: [100, 118] }, hardVerge: [0.8, 1.5], gutter: true, rutsPast: 3 },
      { match: { near: [160, 93] }, hardVerge: [0.8, 1.5], gutter: true, rutsPast: 3 },
      { match: { near: [130, 140] }, ends: { start: 'hard' }, pairs: 2 },
    ],
    fans: [{ x: 120.6, z: 131.2, r: 5.2, dir: [0.74, 0.67], recipe: 'fan' }],
    lines: [
      { kind: 'foot', w: 1.3, strength: 0.85, pts: [[51.6, 9.6], [45.4, 15.2], [40, 19.4], [34.6, 25.2], [30.6, 29.6]] },
      { kind: 'foot', w: 1.2, strength: 0.75, pts: [[30, 36.4], [27, 50], [25, 62], [24.4, 71.6]] },
      { kind: 'foot', w: 1.1, strength: 0.7, pts: [[26, 74.6], [29.6, 74.8], [34, 82], [42, 88], [45.4, 90.6]] },
      { kind: 'vehicle', gauge: 1.8, passes: 3, strength: 0.9, pts: [[62, 12.4], [56, 17.6], [50, 24.5], [46, 28.6]] },
      { kind: 'vehicle', gauge: 1.4, passes: 3, strength: 0.85, pts: [[41.6, 12.4], [46, 16.4], [49.4, 22.4]] },
      { kind: 'vehicle', gauge: 1.1, passes: 2, strength: 0.8, pts: [[174.2, 25.8], [171, 28.8], [168.4, 32.8], [167, 38]] },
      { kind: 'tracked', gauge: 2.4, w: 3.1, passes: 1, strength: 1, pts: [[5.4, 16.4], [7.4, 22], [8.4, 28], [8.2, 32]] }, // pz3 → NW road
    ],
  },
  // ---- M19 Frustrate Retaliation: ROAD_S's gravel-earth bed, twin ruts and ragged verge; tyre tracks pads ↔ road
  m19: {
    roads: [{ match: { near: [122, 95] }, pairs: 1, gauge: 1.8, vergeW: [0.5, 1.0], ends: { end: 'hard' } }],
    lines: [
      { kind: 'vehicle', gauge: 1.8, passes: 2, strength: 0.85, pts: [[121.4, 45], [119.6, 42.6], [118.6, 41]] },
      { kind: 'vehicle', gauge: 1.8, passes: 2, strength: 0.85, pts: [[127.6, 48.6], [128.4, 43], [129.4, 38.8]] },
      { kind: 'vehicle', gauge: 1.8, passes: 2, strength: 0.85, pts: [[125, 52], [133, 50], [139, 48]] },
    ],
  },
  // ---- M20 Operation Valhalla (Breisgau, February frost): approach-road verges and wheel lines, the detour round rk_e7,
  //      moat and gate lanes, cart tracks to the fields, the range's lanes, the huts' desire lines (roads matched by
  //      geometry: the castle lane re-lays the inner roads)
  m20: {
    roads: [
      { match: { near: [30, 142] }, hardVerge: [0.6, 1.0], hardRuts: 0.55 },
      { match: { near: [146, 141] }, hardVerge: [0.6, 1.0], hardRuts: 0.55 },
    ],
    lines: [
      { kind: 'cart', gauge: 1.35, passes: 3, strength: 0.9, pts: [[124.8, 123.6], [125.9, 127.6], [126.4, 131.4], [129, 132.2], [133.4, 132.4], [136.2, 133.2]] }, // detour round rk_e7
      { kind: 'foot', w: 1.2, strength: 0.8, pts: [[35, 104.2], [50, 118.6], [60, 125.2], [80, 131], [98, 136]] },        // along the moat
      { kind: 'foot', w: 1.2, strength: 0.75, pts: [[104, 135.4], [120, 124], [126.2, 116.6], [140, 104.6], [147, 90]] },
      { kind: 'cart', gauge: 1.35, passes: 2, strength: 0.8, pts: [[32, 141], [24, 134], [16, 128.4], [8, 124]] },       // cart tracks to the fields
      { kind: 'cart', gauge: 1.35, passes: 2, strength: 0.8, pts: [[48, 130], [50, 140], [53, 150], [55, 160]] },
      { kind: 'cart', gauge: 1.35, passes: 2, strength: 0.8, pts: [[140, 138], [146, 128], [150, 118]] },
      { kind: 'foot', w: 1.4, strength: 0.85, pts: [[110, 72], [120, 72.6], [130, 73]] },                                // range firing line
      { kind: 'foot', w: 0.9, strength: 0.7, pts: [[116, 74.4], [115.4, 77]] }, { kind: 'foot', w: 0.9, strength: 0.7, pts: [[119, 75], [118.4, 81]] },
      { kind: 'foot', w: 0.9, strength: 0.7, pts: [[124, 75], [124, 82]] }, { kind: 'foot', w: 0.9, strength: 0.7, pts: [[126.4, 75.4], [125.6, 79], [125.6, 85.4], [126.6, 87.4]] },
      { kind: 'cart', gauge: 1.35, passes: 2, strength: 0.85, pts: [[58, 108], [55.4, 103.4], [54.6, 100.2], [56.4, 97.6], [58.4, 94.6], [57.6, 90.4], [54.6, 86.2]] }, // W yard: gate road → hut doors
    ],
    toRoad: { kind: 'foot', w: 1.1, strength: 0.75, from: [[88, 102.6], [72, 106.6], [88, 114.6], [96, 102.6], [103.5, 111], [76, 93.6], [58.8, 79.2], [52.6, 99.6], [60.7, 96.8]] },
  },
};

/** The line extras of a mission (null when it has none). */
export function lineExtrasFor(id) {
  return (id && Object.prototype.hasOwnProperty.call(LINE_EXTRAS, id) && LINE_EXTRAS[id]) || null;
}
