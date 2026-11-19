/**
 * LIGHTS OUT e01 "Dry Stone" set dressing (Contrada Sant'Elia, Valle d'Itria, 14 September 1943): pure data, spread in
 * by the mission (src/missions/expansion/e01_dry_stone.js). The meshes are the e01 kit's (art/e01-kit.js) and the
 * tree system's (olive / almond / fig species, art/terrain/treegen.js).
 *   - the olive groves (SW round the team's start, a small one in the NW field), almond trees in the stubble, figs
 *     against walls; trunks block like every mission tree
 *   - the dry-stone field walls (`low`: low cover, 1 m), with field gaps every 20 m or so
 *   - prickly-pear hedges along the white road and round the hamlet (low cover)
 *   - hay stooks, a cart, jars, a trough, packing cases, straw bales, the checkpoint's shrine, a plain pennant
 * Everything stands off the guards' beats and the solution's routes (tools/solutions/e01.solution.mjs); the placement
 * rules settle what is left.
 * @module art/e01-dressing
 */

/** Mulberry32, seeded: the groves are the same in every build. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const deg = (d) => (d * Math.PI) / 180;

/** Keep-out discs / rects for the groves: the road, the start, the hamlet, the walls and the knoll. */
const KEEP_OUT = [
  { rect: [0, 105.5, 54, 114.5] },  // the white road west of the piazza (4.5 m) and its verges
  { disc: [14, 126, 6] },           // the team's start
  { rect: [33.5, 86, 35.5, 141] },  // the grove's east wall
  { rect: [-1, 86.5, 36, 88.6] },   // the grove's north wall
];
function clear(x, z) {
  for (const k of KEEP_OUT) {
    if (k.rect && x >= k.rect[0] && x <= k.rect[2] && z >= k.rect[1] && z <= k.rect[3]) return false;
    if (k.disc && Math.hypot(x - k.disc[0], z - k.disc[1]) < k.disc[2]) return false;
  }
  return true;
}

/** The SW olive grove: rows 7 m apart, a hand of jitter, a few gaps (dead trees taken out). */
function oliveGrove() {
  const R = rng(19430914), out = [];
  for (let z = 91; z <= 138; z += 7) {
    for (let x = 4; x <= 31; x += 7) {
      if (R() < 0.12) continue;
      const tx = +(x + (R() - 0.5) * 2.4 + ((z / 7) % 2) * 1.5).toFixed(2), tz = +(z + (R() - 0.5) * 2.2).toFixed(2);
      if (!clear(tx, tz)) continue;
      out.push({ type: 'tree', variant: 'olive', x: tx, z: tz, r: 0.45, h: +(4.2 + R() * 1.8).toFixed(2), seed: 7100 + out.length });
    }
  }
  return out;
}

const OLIVES_NW = [[9, 15.5], [16, 21], [23.5, 15], [30, 21.5], [12.5, 25.5], [27, 26.5], [36.5, 16.5]]
  .map(([x, z], k) => ({ type: 'tree', variant: 'olive', x, z, r: 0.45, h: 4.6 + (k % 3) * 0.5, seed: 7300 + k }));
const OLIVES_HAMLET = [[38, 99.5], [63.5, 127.5], [75, 113]]
  .map(([x, z], k) => ({ type: 'tree', variant: 'olive', x, z, r: 0.45, h: 4.8 + k * 0.4, seed: 7350 + k }));
const ALMONDS = [[20, 5], [37, 21.5], [52, 5.5], [56, 22.5], [81, 18.5], [97, 5], [92.5, 22.5], [10.5, 57], [44, 62], [84, 97], [100.5, 111], [95, 128]]
  .map(([x, z], k) => ({ type: 'tree', variant: 'almond', x, z, r: 0.4, h: 4.5 + (k % 4) * 0.4, seed: 7400 + k }));
const FIGS = [[39, 95], [73.5, 124], [116, 93.5]]
  .map(([x, z], k) => ({ type: 'tree', variant: 'fig', x, z, r: 0.45, h: 4.2 + k * 0.3, seed: 7500 + k }));

/** Dry-stone field walls: low cover, 1 m high, 0.6 m wide; `segments` keep the field gaps. */
const dry = (id, segments) => ({ id, type: 'wall', variant: 'drystone_field', low: true, h: 1.0, width: 0.6, segments });
export const E01_FIELD_WALLS = [
  // round the SW olive grove: its north side (a field gate at x 14–16) and its east side (the road crosses at z 106–114)
  dry('wl_grove_n', [[[0, 87.6], [14, 87.6]], [[16, 87.6], [34.5, 87.6]]]),
  dry('wl_grove_e', [[[34.5, 88.2], [34.5, 95]], [[34.5, 97.2], [34.5, 105.2]], [[34.5, 114.8], [34.5, 121.2]], [[34.5, 123.4], [34.5, 139.5]]]),
  // the long wall north of the hamlet and the road (the team's crawl to the checkpoint), field gates at 21–23, 43–45
  dry('wl_n86', [[[0, 85.6], [21, 85.6]], [[23, 85.6], [43, 85.6]], [[45, 85.6], [64.5, 85.6]]]),
  // its branch down to the checkpoint: the field wall the team crawls behind to the boom (cp2 walks the road beyond it)
  dry('wl_cp', [[[66.6, 87.7], [68.6, 89.4], [72.0, 92.2]]]), // (a field gate where it leaves the long wall)
  // east of the gate road: the south field's north wall (gap 101–103) and its west wall down to the map edge
  dry('wl_e86', [[[92.5, 89.6], [101, 89.6]], [[103, 89.6], [110.9, 89.6]]]),
  dry('wl_x111', [[[111.5, 90.2], [111.5, 104]], [[111.5, 106], [111.5, 124]], [[111.5, 126], [111.5, 139.5]]]),
  // the north fields: rows at z 10 and 30 either side of the threshing floor's meadow, the x 64 boundary
  dry('wl_z10a', [[[0, 10], [14, 10]], [[16, 10], [30, 10]], [[32, 10], [44, 10]]]),
  dry('wl_z10b', [[[70, 10], [88, 10]], [[90, 10], [107.5, 10]]]),
  dry('wl_z30a', [[[0, 30], [20, 30]], [[22, 30], [40, 30]]]),
  dry('wl_z30b', [[[78, 30.5], [92, 30.5]], [[94, 30.5], [106.5, 30.5]]]),
  dry('wl_x64', [[[64, 0.5], [64, 14]], [[64, 16], [64, 30.6]]]),
  // the knoll's field (W of the threshing floor)
  dry('wl_z50', [[[0, 50], [12, 50]], [[14, 50], [26, 50]]]),
];

/** Prickly-pear hedges (low cover) along the white road and in the hamlet. */
const pear = (id, x, z, w, d, rotDeg) => ({ id, type: 'prickly_pear', x, z, w, d, rot: deg(rotDeg), h: 1.8, block: 1 });
export const E01_HEDGES = [
  pear('pp_road1', 69.6, 109.6, 4.2, 1.4, -55),
  pear('pp_cp', 80.2, 91.2, 5.4, 1.6, -58),
  pear('pp_road2', 98.6, 88.4, 6.0, 1.4, 8),
  pear('pp_hamlet', 49.5, 95.5, 2.6, 1.6, 10),
  pear('pp_west', 40.5, 114.8, 4.0, 1.3, 0),
];

/** Small dressing (e01_prop, art/e01-kit.js buildE01Prop): low obstacles where they stand. */
const prop = (id, variant, x, z, w, d, rotDeg = 0, extra = {}) => ({ id, type: 'e01_prop', variant, x, z, w, d, rot: deg(rotDeg), block: 1, ...extra });
export const E01_PROPS = [
  // the hamlet
  prop('cart_piazza', 'cart', 49.5, 101.0, 2.6, 1.5, 200),
  prop('jars_t1', 'jars', 54.2, 102.2, 1.4, 0.6, 20),
  prop('jars_t5', 'jars', 53.0, 117.8, 1.2, 0.6, 0),
  prop('trough_well', 'trough', 58.9, 111.6, 1.6, 0.6, 0),
  // the checkpoint's wayside shrine (a niche, a faded Madonna)
  prop('shrine_cp', 'shrine', 69.8, 101.2, 0.8, 0.6, -70, { h: 2.0, block: 2 }),
  // hay stooks in the north meadow
  ...[[84, 15], [89.5, 19.5], [86, 24.5], [94.5, 16], [26, 39], [33, 44.5], [20.5, 45]].map(([x, z], k) => prop(`hay_${k}`, 'hay', x, z, 1.4, 1.4, k * 37)),
  // the courtyard: the detachment's packing cases, the stable's bales and trough
  prop('cases_yard', 'packing_cases', 98.6, 61.2, 1.8, 1.3, 90),
  prop('cases_gate', 'packing_cases', 84.4, 73.4, 1.6, 1.2, 10),
  // the detachment's crated gear stacked high against the south wall, east of the arch
  prop('cases_south', 'packing_cases', 94.2, 74.3, 3.2, 1.8, 0, { h: 2.2, block: 2 }),
  prop('bales_stable', 'bale', 85.2, 70.4, 1.8, 0.6, 90),
  prop('trough_stable', 'trough', 84.9, 56.4, 1.6, 0.6, 90),
  // a plain pennant on its pole beside the gate (no emblem)
  prop('pennant_gate', 'pennant', 92.5, 77.6, 0.4, 0.4, 0, { h: 5, block: 1 }),
];

export const E01_TREES = [...oliveGrove(), ...OLIVES_NW, ...OLIVES_HAMLET, ...ALMONDS, ...FIGS];

/** Everything above, in the order the mission spreads it. */
export const E01_DRESSING = [...E01_FIELD_WALLS, ...E01_HEDGES, ...E01_PROPS, ...E01_TREES];
