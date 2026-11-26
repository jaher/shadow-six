/**
 * "Winter Quarters" (LIGHTS OUT mission 3, docs/expansion/e03.md): the map's shared layout, one place for every
 * position the mission data, its script (missions/scripts/e03.js), its art (art/e03-dressing.js) and its solution
 * (tools/solutions/e03.solution.mjs) read. Pure data, no imports.
 * Axes: x east, z south (the Elbe along the south edge); metres.
 * @module missions/expansion/e03-layout
 */

const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // route point, `look` in degrees

/** Points on a circle round (cx, cz), radius r, from angle a0 to a1 (degrees, 0 = +x, 90 = +z), n segments. */
export function arcPoints(cx, cz, r, a0, a1, n) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const a = ((a0 + ((a1 - a0) * k) / n) * Math.PI) / 180;
    out.push([+(cx + r * Math.cos(a)).toFixed(3), +(cz + r * Math.sin(a)).toFixed(3)]);
  }
  return out;
}

const RING = [66, 74];
const RING_R = 6.5;

export const E03 = Object.freeze({
  // --- the river and the bank
  RIVER_Z: 100, // the Elbe's north bank (water z 100-120)
  TOWPATH_Z: 94.5,
  LANDING: [44, 98], // the ferry landing (timber stage from the towpath into the river)
  FERRY: [44, 103.6], // the rope ferry, moored at the stage's end
  CABLE: [[44, 103.6], [44, 118.5]], // the ferry's cable across the river (it rides along it)
  EXIT: [44, 116], // the far bank (extraction: the ferry inside 5 m of it)
  R1: [47.5, 94.5], // the landing's sentry (looks E along the towpath)
  R2: [92, 94.6], // [Hard] the towpath's east post (looks S over the river)

  // --- the riding hall (the intercept station) and the mast field
  HALL: { x0: 60, x1: 100, z0: 8, z1: 32 },
  DOOR_W: [60, 20], DOOR_S: [80, 32], DOOR_E: [100, 20],
  OPERATORS: [['op1', 70, 11.6], ['op2', 80, 11.6], ['op3', 90, 11.6]], // at their receivers on the N wall
  TABLE: [92, 26.6], // the chief's table
  JUMPS: [[63.5, 28.6, 0], [75.6, 30.1, 90]], // the hall's old show jumps: stacked in the SW corner, and against the wall by the S door
  TABLE_STAND: [92, 25.3], // where the chief stands at it (N side, facing S over it)
  BINDER: [92, 26.6], // the key-table binder on the table
  HD1: [80, 33.6], // the S door's sentry
  MAST_C: [128, 12], // the main mast (o2)
  MAST_CHARGE: [128, 15.2], // the charge spot at its foot (S side)
  TOWER: [104, 46], TOWER_DECK: 8, // the water tower and h1's deck height

  // --- the lawn and the villa
  WELL: [84, 48], // the camp well (the binder's grave on alarm)
  HAY_CART: [77.5, 44.5],
  VERANDA_FOOT: [107.5, 62], // where the chief reports (the veranda's steps)
  VILLA: [124, 62], // the owner's villa body (20 × 15: x 114-134, z 54.5-69.5)
  ANSBACH_OUT: [110, 62], // at the veranda rail, looking W over the lawn
  ANSBACH_IN: [113.3, 62], // at the drawing room's French windows (his back to the lawn)
  ESCORT: [['ge1', -2.6, 270], ['ge2', 2.6, 90]], // the Gestapo men: offset along the veranda, facing out along it
  VERANDA: { x0: 108.6, x1: 114, z0: 57, z1: 67 }, // the timber veranda (its deck at ground level)
  VERANDA_RAILS: [
    [[108.6, 58.8], [108.6, 57], [114, 57]], // NW corner (the N steps between the rail ends)
    [[108.6, 60.4], [108.6, 60.6]], // (stub by the W steps)
    [[108.6, 63.6], [108.6, 63.4]],
    [[108.6, 65.2], [108.6, 67], [114, 67]], // SW corner
  ],
  BARN: [124, 90], // the garrison's barn
  BARN_DOOR: [124, 84.6], // its N door (the trainer runs for it): the byre doors under the bridge to the threshing floor
  // (the model, barn_b, is turned a half turn: its earth ramp up to the threshing floor runs N from the bridge deck. The
  // deck spans the 2.25 m passage along the N wall, z 83.25-85.5, where the two byre doors open; the ramp's body — stone
  // side walls and earth fill — is solid from z 83.25 to its foot: a wall's height by the bridge, low cover down the slope)
  BARN_RAMP: { x0: 121.9, x1: 126.1, z0: 76.4, zLow: 80, z1: 83.25 },
  BARN_BYRES: [[122.6, 84.6], [125.4, 84.6]], // where a man stands at each byre door, under the deck (W, E)
  BARN_PASSAGE: [[120.4, 84.3], [127.8, 84.3]], // out from under the deck, W and E of the ramp
  T1: [73, 54.5], // the lone sergeant at the lawn road's bend N of the big top (the puppet: one walk from hd1)
  T1_LOOK: 40, // over the lawn and the well, towards the villa

  // --- the big top and the ring
  RING, RING_R,
  KERB: [57.9, 77.5], // the trainer's stand at the ring's SW kerb, S of the lions' cage wagon (he faces the ring)
  // the kerb: a 0.6 m step round the ring, open on the W for the runway (a gap 4 m wide)
  RING_KERB: arcPoints(RING[0], RING[1], RING_R + 0.5, 197, 523, 40),
  KING_POLES: [[59.4, 67.4], [72.6, 67.4], [72.6, 80.6], [59.4, 80.6]],
  TOP: { x: 66, z: 74, r: 16 }, // the big top's canvas (half raised)
  // its side poles round the north half (the raised canvas's eave rests on them; the south half is down)
  SIDE_POLES: arcPoints(RING[0], RING[1], 16, 192, 348, 13),

  // --- the camp
  MEN_TENT: [28, 60], // the menagerie tent (22 × 9)
  TRAINER_WAGON: [15, 45], // the trainer's living wagon (row A, W end)
  MANAGER_WAGON: [35, 80], // the manager's (row D, E end)
  C1: [42.5, 60], // the sentry at the menagerie tent's E end
  PADDOCK: { x0: 6, x1: 30, z0: 12, z1: 36 },
  OSTRICH_GATE: [30, 24],
  KENNEL: { x0: 44, x1: 54, z0: 1.5, z1: 9.5 },
  KENNEL_GATE: [49, 9.5],
  HANDLER: [49, 12.2],
  DOGS: [['dog1', 47, 6], ['dog2', 51.5, 6.5]],

  // --- routes
  // the camp patrol: round the menagerie tent and the first wagon rows, clockwise (the E lane S, the tent's S lane W,
  // the W lane N, the N lane E); it looks down the E lane at the big top's west mouth and up the W lane
  P1_LOOP: [P(48.5, 41), P(48.5, 66.5, 6, 90), P(7.5, 66.5, 6, 270), P(6.5, 41.5, 6, 0)],
  // the trainer: the ring kerb (facing the lions), the paddock gate, the menagerie tent, his wagon, back
  ZK_LOOP: [P(57.9, 77.5, 40, 337), P(31.6, 24, 15, 180), P(41.2, 58.4, 20, 180), P(15, 48.4, 20, 270)],
  // the manager: down the camp's E lane, along the N lane, down the W lane, back along the S lane
  MGR_LOOP: [P(39.5, 76.6), P(39.5, 49.5, 10, 180), P(9.5, 49.5, 10, 90), P(9.5, 76.6, 10, 0)],
});

export default E03;
