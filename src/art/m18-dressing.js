/**
 * M18 The Force of Circumstance (the Maas bridge north of Liège again, 16 December 1944) second art pass: set dressing,
 * kept in its own module so the mission file only spreads it in (as M16's art/m16-dressing.js). Every piece that blocks
 * stands ≥ 1 m off every guard's post and beat, the barracks squads' runs and the vehicle routes (≥ 4 m off the
 * dossier's solution spots, ≥ 8 m off the start; tests/unit/art-m18.test.mjs). What blocks is drawn and what is drawn
 * blocks (the buffer stop, the cable drum and the boat B.LOW on their footprints, the jeep by its drawn body).
 *
 * - the station: the freight wagon stood on the grass — the stub siding it stands on now runs in from the NE map edge
 *   under it and ends at a rail-built buffer stop with its Sh 2 board, 1.6 m short of the station's NE gable
 * - the bridge island: the green case of German charges is drawn as one (art/explosives-case.js; it drew as two bare
 *   plank crates), with a reel of firing cable beside it, and the garrison's rowing boat lies keel up on the S beach
 * - the E village: Belgian setts round the fountain (visual only, as M16: the beats cross the square)
 * - the SE fields: the line is giving way — a US jeep caught by a shell on the field W of the start walls, burnt out
 *   beside the crater
 */
const deg = (d) => (d * Math.PI) / 180;
/** A point in a frame (+x along `rot`, +z its door side) → world [x, z]. */
const local = (cx, cz, rot, lx, lz) => [cx + lx * Math.cos(rot) - lz * Math.sin(rot), cz + lx * Math.sin(rot) + lz * Math.cos(rot)];
const R45 = deg(-45);

// --- the stub siding under the freight wagon (wagon_1 at (194, 19.5), rot −45: its axis is the siding's centre line)
const WAGON = [194, 19.5];
/** A point `a` m along the siding from the wagon's centre (+ towards the NE map edge). */
const sid = (a) => local(WAGON[0], WAGON[1], R45, a, 0);
/** The buffer stop's centre: its beam face 1 m short of the wagon's SW buffers (a −6), its back 1.6 m off the gable. */
export const BUFFER_AT = sid(-6.65);
/** Past the wagon's NE buffers the siding swings 6° towards the main line it leaves off the map (its junction is out
 *  there): its last 7 m end 2.3 m past the NE edge and the edge extension carries it on along that heading. (The
 *  heading also keeps the apron's forest as it was: the extension's levelled band takes no apron tree — straight on
 *  at −45° it took four, and art/apron.js seeds each tree's look by its index, so every one after them changed.) */
const SWING = local(...sid(5.4), deg(-39), 7, 0);
/** The siding's run: from past the NE map edge, round the swing, to the buffer stop. */
export const SIDING = [SWING, sid(5.4), BUFFER_AT];

// --- the bridge island: the case at (50.5, 88.5) rot 30
const CASE = [50.5, 88.5], CASE_ROT = deg(30);

export const M18_DRESSING = [
  // --- the station
  { id: 'siding_n', type: 'rail_track', points: SIDING },
  { id: 'buffer_n', type: 'crates', variant: 'buffer_stop_std', label: 'Buffer stop', x: BUFFER_AT[0], z: BUFFER_AT[1], rot: R45, w: 1.3, d: 2.4, h: 1.4,
    block: 1, fixed: true },
  // --- the bridge island
  { id: 'reel_case', type: 'crates', variant: 'cable_drum', label: 'Firing cable', x: local(...CASE, CASE_ROT, 1.6, -0.2)[0], z: local(...CASE, CASE_ROT, 1.6, -0.2)[1],
    rot: deg(-30), w: 0.9, d: 0.7, h: 0.9, block: 1, fixed: true },
  { id: 'boat_isl', type: 'crates', variant: 'boat_beached_overturned', x: 44.2, z: 101.6, rot: deg(-4), w: 4, d: 1.8, h: 1, block: 1, fixed: true,
    vehicleArt: 'rowboat', vehicleArtHide: ['oar_l', 'oar_r'] },
  // --- the SE fields: the burnt-out jeep by its shell crater
  { id: 'jeep_wreck', type: 'crates', variant: 'jeep_wreck_burnt', label: 'Burnt-out jeep', x: 186.2, z: 138.6, rot: deg(-30), w: 3.4, d: 1.6, h: 1.4,
    block: 1, fixed: true, vehicleArt: 'willys_mb', wreck: true },
  { id: 'crater_se', type: 'crater', x: 183, z: 141.4, r: 1.4 }, // (its rim and clods reach 2.1 m: 0.6 m short of the jeep's tail)
];

/** Setts round the village fountain (visual only), as M16's. */
const F = (lx, lz) => local(178.2, 95.8, R45, lx, lz);
export const M18_PAVEMENTS = [
  { id: 'pave_fountain', surface: 'belgian', points: [F(-4.5, -3.2), F(-3.2, -4.5), F(3.2, -4.5), F(4.5, -3.2), F(4.5, 3.2), F(3.2, 4.5), F(-3.2, 4.5), F(-4.5, 3.2)],
    wear: 0.6, weeds: 0.45, cracks: 0.3, puddles: 0.15, edge: 'ragged', grid: false },
];
