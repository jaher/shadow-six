/**
 * Static colliders built once per mission (bodies-design §A.2): the TERRAIN heightfield sampled from `world.groundY`
 * (flat 0 in headless worlds) and STATIC cuboids merged from the NavGrid (blockers by height class, raised walkable
 * surfaces at their elevation). Pure grid data → deterministic in node and in the browser.
 * @module physics/statics
 */

import { CONFIG } from '../config.js';
import { B } from '../world/grid.js';

/** Collision group bits (§A.2 table). */
export const G = Object.freeze({ TERRAIN: 1, STATIC: 2, RAGDOLL: 4, PROP: 8, VEHICLE: 16, DEBRIS: 32, UNIT: 64 });
/** Rapier interaction groups: membership in the high 16 bits, filter in the low 16. */
export const groups = (member, filter) => (((member & 0xffff) << 16) | (filter & 0xffff)) >>> 0;
export const GROUPS = Object.freeze({
  TERRAIN: groups(G.TERRAIN, 0xffff),
  STATIC: groups(G.STATIC, 0xffff),
  RAGDOLL: groups(G.RAGDOLL, G.TERRAIN | G.STATIC | G.PROP | G.VEHICLE | G.UNIT),
  /** A settle / put-down ragdoll ignores standing men (a body laid at a carrier's feet never rests its legs on him). */
  RAGDOLL_SETTLE: groups(G.RAGDOLL, G.TERRAIN | G.STATIC | G.PROP | G.VEHICLE),
  PROP: groups(G.PROP, G.TERRAIN | G.STATIC | G.PROP | G.RAGDOLL | G.VEHICLE | G.UNIT),
  VEHICLE: groups(G.VEHICLE, G.TERRAIN | G.STATIC | G.PROP | G.RAGDOLL),
  DEBRIS: groups(G.DEBRIS, G.TERRAIN | G.STATIC),
  UNIT: groups(G.UNIT, G.PROP | G.RAGDOLL),
  /** Ray filter for blast occlusion: STATIC only. */
  RAY_STATIC: groups(0xffff, G.STATIC),
  /** Ray filter for ground probes: TERRAIN + STATIC. */
  RAY_GROUND: groups(0xffff, G.TERRAIN | G.STATIC),
});

/** World ground height (visual relief) at (x, z); 0 when the world has none (headless). */
export function groundAt(world, x, z) {
  const g = world.groundY;
  return typeof g === 'function' ? (g.call(world, x, z) || 0) : 0;
}

/** Height (m above ground) of the STATIC collider over grid cell k (0 = none). */
export function cellHeight(grid, k) {
  const H = CONFIG.physics.staticH;
  const b = grid.block[k];
  const cls = b === B.HIGH ? H.high : b === B.LOW ? H.low : b === B.FENCE ? H.fence : 0;
  return Math.max(cls, grid.elev[k] || 0);
}

/**
 * Build the terrain heightfield + merged static cuboids into Rapier world `rw`.
 * @returns {{colliders: number, cuboids: number, samples: number}}
 */
export function buildStatics(R, rw, world, skipOwners = null) {
  const step = CONFIG.physics.terrainStep;
  const W = world.width, D = world.depth;
  const ncols = Math.max(1, Math.ceil(W / step)), nrows = Math.max(1, Math.ceil(D / step));
  const heights = new Float32Array((nrows + 1) * (ncols + 1));
  // the surface right under each sample (world.lyingY): world.groundY's feet ring steps a walker up onto a kerb or a
  // crate top 0.36 m away, which raised the heightfield round every low surface (a body put down against a crate
  // stack was spawned 0.3 m up and drawn that much into the ground once it fell)
  const at = (x, z) => (typeof world.lyingY === 'function' ? world.lyingY(x, z) || 0 : groundAt(world, x, z));
  for (let c = 0; c <= ncols; c++) {
    for (let r = 0; r <= nrows; r++) heights[c * (nrows + 1) + r] = at(Math.min(W, c * step), Math.min(D, r * step));
  }
  const sx = ncols * step, sz = nrows * step;
  const tb = rw.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(sx / 2, 0, sz / 2));
  rw.createCollider(R.ColliderDesc.heightfield(nrows, ncols, heights, { x: sx, y: 1, z: sz })
    .setCollisionGroups(GROUPS.TERRAIN).setFriction(0.9), tb);
  // a floor slab under the map so nothing falls forever (heightfields are one-sided)
  rw.createCollider(R.ColliderDesc.cuboid(sx / 2 + 5, 0.5, sz / 2 + 5).setTranslation(0, -3.5, 0).setCollisionGroups(GROUPS.TERRAIN), tb);

  // STATIC cuboids: greedy rectangles over cells with the same quantised top height
  const grid = world.grid, cols = grid.cols, rows = grid.rows, cell = grid.cell;
  const top = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i, h = skipOwners?.has(grid.owner[k]) ? 0 : cellHeight(grid, k);
      top[k] = h > 0.05 ? Math.round((h + groundAt(world, (i + 0.5) * cell, (j + 0.5) * cell)) * 10) / 10 : 0;
    }
  }
  const used = new Uint8Array(cols * rows);
  const sb = rw.createRigidBody(R.RigidBodyDesc.fixed());
  let cuboids = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i, t = top[k];
      if (!t || used[k]) continue;
      let w = 1;
      while (i + w < cols && !used[k + w] && top[k + w] === t) w++;
      let d = 1;
      grow: while (j + d < rows) {
        for (let q = 0; q < w; q++) { const kk = (j + d) * cols + i + q; if (used[kk] || top[kk] !== t) break grow; }
        d++;
      }
      for (let dj = 0; dj < d; dj++) for (let q = 0; q < w; q++) used[(j + dj) * cols + i + q] = 1;
      const base = -1.0, hy = (t - base) / 2;
      rw.createCollider(R.ColliderDesc.cuboid((w * cell) / 2, hy, (d * cell) / 2)
        .setTranslation((i + w / 2) * cell, base + hy, (j + d / 2) * cell)
        .setCollisionGroups(GROUPS.STATIC).setFriction(0.7), sb);
      cuboids++;
    }
  }
  return { colliders: cuboids + 2, cuboids, samples: heights.length, field: { heights, step, ncols, nrows } };
}

/**
 * Height of the TERRAIN heightfield as built (its `field` record: 1 m samples of world.groundY, triangulated) at
 * (x, z): the higher of the cell's two triangulations, so a body placed over it is never under it. The heightfield is
 * not the drawn ground: by a step, a plinth or a snow skirt (world.groundY's sharp low surfaces) it ramps up to 0.45 m
 * over the ground beside them; a lying ragdoll lifted to clear only world.groundY there started under it and its legs
 * fell through (heightfields are one-sided). null without a field.
 */
export function fieldAt(field, x, z) {
  if (!field) return null;
  const { heights: H, step, ncols, nrows } = field;
  const fx = Math.min(ncols - 1e-6, Math.max(0, x / step)), fz = Math.min(nrows - 1e-6, Math.max(0, z / step));
  const c = Math.floor(fx), r = Math.floor(fz), u = fx - c, v = fz - r, R1 = nrows + 1;
  const h00 = H[c * R1 + r], h10 = H[(c + 1) * R1 + r], h01 = H[c * R1 + r + 1], h11 = H[(c + 1) * R1 + r + 1];
  const a = u > v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h01 - h00) * v + (h11 - h01) * u;
  const b = u + v < 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  return Math.max(a, b);
}
