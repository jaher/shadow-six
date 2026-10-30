/**
 * M9 A Courtesy Call (Bab el Qattara, 20 October 1942) second art pass: set dressing, kept in its own module so the
 * mission file only spreads it in (as M10's / M18's). Every piece that blocks stands ≥ 6 m off every guard's post and
 * beat, the patrols' alarm runs, the tanks' drive-outs, the tanker's way to the shed front, the Spy's walk in by the NE
 * road and our lorry's road (tests/unit/art-m09.test.mjs). What blocks is drawn and what is drawn blocks (the wreck and
 * the gun by their drawn models, the pit's sandbags B.LOW, the ammunition B.LOW).
 *
 * - the camp's worn ground (art/camp-ruts.js, drawn by scripts/m09.js): the Panzers' ruts from their bays over the apron
 *   to the E gate, to the workshop's gantry and down through the inner gap and the forecourt to the W road; the tanker's
 *   and the lorries' tyre tracks; lanes packed dark by the traffic; oil on the apron, under the gantry's engine, by the
 *   tanker and the drums; the tow marks of the write-off
 * - NE, beyond the road: the workshop's write-off, a Panzer III burnt out in the September fighting and towed in for spares
 * - S of the SE wall, covering the minefield: an 8.8 cm Flak in its sandbagged pit (the Wurzburg's gun), the ready
 *   ammunition by the pit's mouth
 * @module art/m09-dressing
 */

const deg = (d) => (d * Math.PI) / 180;

/** The worn ground's decal (art/camp-ruts.js): its extent, the lanes, the ruts and tracks, the stains. */
export const M09_RUTS = {
  area: { x0: 3, x1: 99, z0: 0, z1: 112 }, y: 0.05, px: 12, seed: 19421020,
  lanes: [
    // the main traffic: bays → apron → across the N yard → the E gate and out up the NE road
    { pts: [[24.5, 26], [31, 31], [42, 33.5], [55, 35], [66, 34.5], [73, 32], [76.5, 28], [80.5, 19], [85, 8], [88, 0]], w: 4.2, a: 0.16 },
    // the apron → the gantry → the yard's middle → the inner gap → the forecourt → the W opening
    { pts: [[20, 31], [27, 38.5], [36, 44.5], [42, 52], [42.5, 62], [40.5, 71.5], [36.5, 78], [30, 84], [25.5, 88.5]], w: 3.6, a: 0.13 },
    // the W road's lorries on to the two centre houses
    { pts: [[47.5, 60.5], [52, 55.5], [57, 53.5], [61, 53.5]], w: 3, a: 0.1 },
  ],
  tracks: [
    // the Panzers (Pz IV: 0.4 m tracks, 2.45 m apart): out of each bay, swinging E for the gate or S for the gantry and the gap
    { kind: 'track', pts: [[22.1, 22.9], [25, 26.6], [30, 30.6], [40, 33.2], [52, 35.2], [63, 35], [70.5, 33.2], [75, 30.4], [78.5, 24], [82.5, 14], [86.5, 3]], gauge: 2.45, a: 0.4 },
    { kind: 'track', pts: [[27.1, 17.9], [30.2, 21.8], [34.5, 25.2], [44, 29], [56, 31.6], [66, 32.4], [72, 31], [75.8, 29]], gauge: 2.45, a: 0.24 },
    { kind: 'track', pts: [[17.2, 27.8], [20.6, 31.6], [26, 36.6], [33, 41.6], [39.5, 47], [42.6, 54], [42.6, 62.5], [41, 70], [38.6, 75.6], [33.4, 81.4], [28, 86.2], [24.6, 89.6], [21, 92.4]], gauge: 2.45, a: 0.34 },
    { kind: 'track', pts: [[19.5, 30.5], [24.5, 36.5], [29.5, 41.6], [32.4, 45.2]], gauge: 2.45, a: 0.22 }, // a tank backed up to the gantry
    // the tanker in from the gate to its stand by the bunker, and the lorries' tyres along the lanes
    { kind: 'tyre', pts: [[75.4, 30.6], [68, 36.4], [55, 38.6], [40, 38.4], [27, 38.6], [19.5, 40.6], [15.8, 40.2]], gauge: 1.85, w: 0.3, a: 0.3 },
    { kind: 'tyre', pts: [[74.6, 31.4], [70, 38], [64, 47], [58.4, 52.6], [52.6, 55.4], [47, 61], [41.2, 70.8], [37, 77.4], [30, 84.4], [25.6, 89.2]], gauge: 1.8, w: 0.28, a: 0.24 },
    { kind: 'tyre', pts: [[56, 100.4], [64, 103.8], [74, 106.6], [83, 107.4]], gauge: 1.8, w: 0.26, a: 0.18 }, // gate_s → the Flak pit
    // the write-off towed in from the road to its rest (its tracks rolling)
    { kind: 'track', pts: [[80.2, 20.6], [85, 21.6], [90, 21.4], [93, 21.1]], gauge: 2.6, a: 0.34 },
  ],
  stains: [
    // the apron before each bay, the gantry's engine, the tanker's engine and fuel cap, the yellow drums, the pump
    [19.6, 30.6, 1.7, 0.6], [24.6, 25.6, 1.8, 0.66], [29.4, 20.8, 1.6, 0.58], [26.5, 31.5, 1.1, 0.4], [22.4, 33.4, 0.8, 0.36], [31.2, 24.4, 0.9, 0.4],
    [35, 49.2, 1.5, 0.42], [33.4, 47.8, 0.7, 0.3], [16.2, 40, 1.0, 0.32], [12.4, 41.2, 0.7, 0.26],
    [41.6, 101.4, 1.4, 0.3], [39, 98.6, 0.8, 0.24], [55, 52.2, 0.8, 0.22],
  ],
};

/** The set pieces (structures). */
export const M09_DRESSING = [
  // --- NE, beyond the road: the workshop's write-off, towed in and stripped (B.HIGH by its drawn hull)
  { id: 'wreck_pz3', type: 'crates', variant: 'tank_wreck_burnt', label: 'Burnt-out Panzer III', x: 95.6, z: 21.4, rot: deg(-172),
    w: 5.6, d: 2.95, h: 2.5, block: 2, vehicleArt: 'panzer3_j', wreck: true, fixed: true },
  // --- S of the SE wall, covering the minefield: the 8.8 cm Flak in its sandbag pit (mouth NW, towards the camp)
  { id: 'flak_pit', type: 'sandbags', variant: 'sandbag_ring', x: 88, z: 110.5, rot: deg(45), ring: { r: 4.6, arc: 300 }, h: 1.0, block: 1 },
  { id: 'flak_se', type: 'crates', variant: 'flak_emplaced', label: '8.8 cm Flak', x: 88, z: 110.5, rot: deg(20),
    w: 5.2, d: 4.6, h: 2.45, block: 2, vehicleArt: 'flak88', fixed: true },
  { id: 'flak_ammo', type: 'crates', variant: 'ammo_boxes', label: 'Ammunition', asset: 'ammo_boxes_bq_b', x: 83.6, z: 106.2, rot: deg(-45),
    w: 2, d: 2, h: 1.1, block: 1, fixed: true },
];
