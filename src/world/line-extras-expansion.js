/**
 * Line extras of the LIGHTS OUT expansion missions (the same VISUAL data as world/line-extras.js, which keeps the base
 * missions' table): trodden ground, fans and lines the road look paints over the splat's GPU bytes only. Nothing here
 * reaches the simulation (the nav grid, LOS, footprints, the road network the sim reads are untouched);
 * `lineExtrasFor(id)` (world/line-extras.js) serves both tables. tests/unit/line-extras-expansion.test.mjs checks them
 * (tests/unit/line-extras-e06.test.mjs e06's).
 * @module world/line-extras-expansion
 */

/** A small seeded generator (visual data only: the jitter of the generated fans below). */
function mulb(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f2 = (v) => Math.round(v * 100) / 100;

/**
 * Fans for a fenced pen x0..x1 × z0..z1 trodden to spring mud by the animals in it: a jittered field of mud patches
 * (wet `wash`, drier `path` and `cart` earth, by `mix`; none when `interior` is false — the pen's fill then carries its
 * wet / dry drift alone) stopping short of the rails, the corners least trodden, then a broken strip of grass along the
 * rails (the bottom rail keeps feet and beaks off it; gaps where the mud runs to the posts, none in a `gaps` circle
 * [x, z, r] — a gate the ground is poached through) and, with `corners` (m), a wedge of grass surviving in each corner
 * the animals cut across.
 */
function penFans(x0, z0, x1, z1, o = {}) {
  const { seed = 1, step = 3.2, r = [1.9, 2.7], inset = 1.3, grass = 0.72, gaps = [], mix = [0.45, 0.8], interior = true, corners = 0 } = o;
  const R = mulb(seed), F = [];
  const nx = Math.max(1, Math.round((x1 - x0 - 2 * inset) / step));
  const nz = Math.max(1, Math.round((z1 - z0 - 2 * inset) / step));
  if (interior) for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
    const corner = (i === 0 || i === nx) && (j === 0 || j === nz), a = R() * Math.PI * 2, q = R();
    const x = x0 + inset + (i / nx) * (x1 - x0 - 2 * inset) + (R() - 0.5) * step * 0.6;
    const z = z0 + inset + (j / nz) * (z1 - z0 - 2 * inset) + (R() - 0.5) * step * 0.6, rr = r[0] + R() * (r[1] - r[0]);
    if (corner && q < 0.7) continue;
    const recipe = q < mix[0] ? 'wash' : q < mix[1] ? 'path' : 'cart';
    F.push({ x: f2(x), z: f2(z), r: f2(rr), dir: [f2(Math.cos(a)), f2(Math.sin(a))], recipe });
  }
  const side = (ax, az, bx, bz, ix, iz) => {
    const L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L;
    for (let s = 0.5 + R() * 0.6; s < L - 0.3; s += 1.2 + R() * 0.9) {
      const x = ax + tx * s + ix * (0.2 + R() * 0.35), z = az + tz * s + iz * (0.2 + R() * 0.35);
      const rr = 0.75 + R() * 0.55;
      if (R() > grass || gaps.some(([gx, gz, gr]) => Math.hypot(x - gx, z - gz) < gr + rr * 0.6)) continue;
      F.push({ x: f2(x), z: f2(z), r: f2(rr), dir: [f2(tx), f2(tz)], recipe: 'base' });
    }
  };
  side(x0, z0, x1, z0, 0, 1); side(x1, z0, x1, z1, -1, 0); side(x1, z1, x0, z1, 0, -1); side(x0, z1, x0, z0, 1, 0);
  if (corners > 0) for (const [cx, cz, ix, iz] of [[x0, z0, 1, 1], [x1, z0, -1, 1], [x1, z1, -1, -1], [x0, z1, 1, -1]]) {
    const rr = corners * (0.8 + R() * 0.4), d = 0.35 + R() * 0.3, x = cx + ix * d, z = cz + iz * d;
    if (gaps.some(([gx, gz, gr]) => Math.hypot(x - gx, z - gz) < gr + rr)) continue;
    const a = Math.atan2(iz, ix) + (R() - 0.5) * 0.6;
    F.push({ x: f2(x), z: f2(z), r: f2(rr), dir: [f2(Math.cos(a)), f2(Math.sin(a))], recipe: 'base' });
  }
  return F;
}

/** A rect x0..x1 × z0..z1 grown by `m` m on every side, as a polygon. */
const grown = (x0, z0, x1, z1, m) => [[x0 - m, z0 - m], [x1 + m, z0 - m], [x1 + m, z1 + m], [x0 - m, z1 + m]];

/** @type {Record<string, object>} */
export const EXPANSION_LINE_EXTRAS = {
  // ---- e03 Winter Quarters (a circus's winter quarters on the Elbe, spring): the ostrich paddock, the kennel yard and
  //      the hens' run trodden to mud with a broken strip of grass along their rails (their gameplay ground stays the
  //      mission's `ground` rects: this is the look alone), the gates and the stable trough poached wet, the trainer's
  //      boots in and out of the paddock gate and round the trough, the handler's at the kennel gate
  e03: {
    // the pens' ground laid wholly to spring mud from rail to rail (a fan field alone left the gameplay 'ground' rects'
    // dry cracked clay showing between its fans): the paddock and the kennel yard wet, churned mud with drier trodden
    // ground drifting through it in broad patches with broken edges (`trodden`: the pale packed layers — the round-3
    // `edge` / `shoulder` mixes kept enough mud for the height blend to show mud clods all over, an even carpet); the
    // hens' run scratched, drier earth. Grown past the rails so the mud is whole right up to them (the ragged edge — a
    // keeper's boots along the fence — lies outside, never a clay rim inside), spilling out under them in tongues.
    fills: [
      { poly: grown(6, 12, 30, 36, 0.8), recipe: 'gutter', recipe2: 'trodden', cut: [0.44, 0.58], scale: 3.6, scale2: 1.3, amp2: 0.3,
        edge: 0.7, lobes: 1.6, seed: 3.1 },
      { poly: grown(44, 1.5, 54, 9.5, 0.6), recipe: 'gutter', recipe2: 'trodden', cut: [0.55, 0.68], scale: 2.8, scale2: 1.1, amp2: 0.25,
        edge: 0.6, lobes: 1.2, seed: 5.7 },
      { poly: grown(48.6, 25.4, 54, 37.4, 0.55), recipe: 'path', recipe2: 'wash', scale: 2.2, edge: 0.5, lobes: 0.8, seed: 8.2 },
    ],
    fans: [
      // over the fills: the grass strip along the rails, wedges of it in the paddock's corners; the paddock's wet hollows
      // round its puddles (the hens' run's fan field: a small pen, scratched all over)
      ...penFans(6, 12, 30, 36, { seed: 301, gaps: [[30, 24, 2.4]], interior: false, corners: 1.8 }),
      ...[[14.4, 30.3, 2.1], [22.6, 17.6, 1.8], [9.6, 21.2, 1.6]].map(([x, z, r]) => ({ x, z, r, dir: [1, 0.3], recipe: 'gutter' })),
      ...penFans(44, 1.5, 54, 9.5, { seed: 302, step: 2.6, r: [1.5, 2.2], inset: 1.0, gaps: [[49, 9.5, 1.6]], interior: false }),
      // (the hens' run: scratched, drier)
      ...penFans(48.6, 25.4, 54, 37.4,
        { seed: 303, step: 2.4, r: [1.2, 1.9], inset: 0.9, grass: 0.6, mix: [0.2, 0.75] }),
      // the paddock gate
      { x: 28.8, z: 24, r: 2.6, dir: [1, 0], recipe: 'gutter' },
      { x: 31.2, z: 24.4, r: 2.1, dir: [0.95, 0.31], recipe: 'wash' },
      // the stable trough
      { x: 35.4, z: 28.6, r: 2.5, dir: [0, 1], recipe: 'wash' },
      { x: 35.6, z: 28.6, r: 1.7, dir: [0, 1], recipe: 'gutter' },
      // the kennel gate
      { x: 49, z: 9.9, r: 1.7, dir: [0, 1], recipe: 'gutter' },
      // the menagerie tent's floor (28, 60; 22 × 9: seen through its doorways): trodden earth, damp at the doors
      ...[[19.6, 60, 'wash'], [23.6, 58.2, 'cart'], [23.6, 61.8, 'path'], [28, 58.2, 'cart'], [28, 61.8, 'cart'],
        [32.4, 58.2, 'path'], [32.4, 61.8, 'cart'], [36.4, 60, 'wash'], [16.6, 60, 'gutter'], [39.4, 60, 'gutter']]
        .map(([x, z, recipe]) => ({ x, z, r: 2.7, dir: [1, 0], recipe })),
    ],
    lines: [
      // the trainer: in at the paddock gate, to the trough; round the trough; the handler at the kennel gate
      { kind: 'foot', w: 1.2, passes: 10, strength: 0.9,
        pts: [[26.4, 23.4], [28.6, 23.9], [30, 24.1], [31.6, 25.2], [33.2, 27], [34.4, 28.2]] },
      { kind: 'foot', w: 1.0, passes: 6, strength: 0.8,
        pts: [[34.6, 27.4], [36.4, 27.2], [37, 28.8], [36.6, 30.2], [34.9, 30.1]] },
      { kind: 'foot', w: 1.0, passes: 8, strength: 0.85, pts: [[49.2, 6.4], [49, 8.2], [49, 9.5], [49.3, 11.6]] },
    ],
  },
  // ---- LIGHTS OUT e06 Thin Ice: the fishermen's trodden way out over the basin ice from the families' quay to their
  //      holes and a sledge's runners beside it; coal grit trodden into the snow under the yard's coal bunker
  e06: {
    lines: [
      { kind: 'foot', w: 1.1, strength: 0.8, pts: [[38, 66.4], [43, 63.7], [48.6, 61.3], [54, 59.6]] },
      { kind: 'foot', w: 0.9, strength: 0.7, pts: [[55.2, 58.6], [58.7, 57.5], [62, 57.5]] },
      { kind: 'foot', w: 0.8, strength: 0.6, pts: [[63.2, 57.6], [67, 58.7], [71, 59.2]] },
      { kind: 'sled', gauge: 0.8, passes: 2, strength: 0.6, pts: [[39.4, 66.5], [44.4, 64.6], [50.2, 62.1], [55.6, 60.5]] },
    ],
    fans: [{ x: 119.4, z: 116.9, r: 2.4, dir: [0, 1], recipe: 'fan' }, { x: 126.6, z: 117.4, r: 1.6, dir: [0.4, 1], recipe: 'fan' }],
  },
};
