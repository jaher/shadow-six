/**
 * The library's bombed brick house (house_bombed_b: a roofless two-storey shell, one corner breached, rubble spilling
 * out) as a ruin whose gameplay is the drawn model. Drawn at its 0.72 plan fit on the 5 × 4 footprint below (a
 * 7.9 × 5.8 m shell, walls ~7 m); `navParts` are the sidecar's own parts in the ruin's frame (+z = the breached side):
 * the shell walls B.HIGH (they hide a standing man and stop sight, h 7), the breached corner and the two rubble spills
 * B.LOW (crawl cover, see-through), the shell's inside the heap of the fallen storeys (B.LOW, closed off). The low parts
 * come first: the walls are stamped over them. `nav: false`: none of the sidecar's upper floors, stair ladders or climb
 * edges (the browser and the grid-only builds see the same ruin). M7's ruins field, M4's SE farm ruins.
 * @module missions/scripts/bombed-ruin
 */

/** The ruin's gameplay parts ({x, z, w, d, block} in its frame, before `rot`). */
export const BOMBED_RUIN_NAV = [
  { x: 0, z: 0, w: 7.128, d: 4.968, block: 1 },                                                                    // the fallen storeys inside the shell
  { x: 2.628, z: 2.682, w: 2.232, d: 0.54, block: 1 },                                                             // the breach (fallen brick)
  { x: 2.232, z: 3.96, w: 2.534, d: 2.534, block: 1 }, { x: 0.432, z: -3.744, w: 1.958, d: 1.958, block: 1 },     // rubble spills (+z, −z)
  { x: -1.224, z: 2.682, w: 5.472, d: 0.396, block: 2 }, { x: 3.852, z: 2.682, w: 0.216, d: 0.396, block: 2 },  // +z wall, either side of the breach
  { x: 3.762, z: 0, w: 0.396, d: 5.76, block: 2 }, { x: 0, z: -2.682, w: 7.92, d: 0.396, block: 2 }, { x: -3.762, z: 0, w: 0.396, d: 5.76, block: 2 }, // +x, −z, −x
];

/** Plan extent of the drawn ruin in its frame (shell ± rubble), m: x −3.96..3.96, z −4.72..5.23. */
export const BOMBED_RUIN_EXTENT = { x0: -3.96, x1: 3.96, z0: -4.72, z1: 5.23 };

/**
 * A bombed brick house ruin at (x, z), turned `rot` rad.
 * @param {string} id @param {number} x @param {number} z @param {number} [rot] @param {object} [extra] more fields
 */
export const bombedRuin = (id, x, z, rot = 0, extra = {}) => ({ id, type: 'ruins', variant: 'bombed_brick', asset: 'house_bombed_b', x, z, rot, w: 5, d: 4, h: 7, block: 0, nav: false, navParts: BOMBED_RUIN_NAV, ...extra });
