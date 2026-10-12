/**
 * Ramps and stairs are got on to at their foot or head only, head-on (user 2026-10-08, watching the M3 solution film:
 * "In the video the rapper crosses the slide when crawling,  fix to make it work properly"). The Sapper reached the
 * foot of the barn's ramp from beside it and crawled up it on the slant: his body across the ramp's raised stone curbs
 * at the foot and partway up, lying flat at a height up to 0.4 m under the stone slope. Now:
 *  - every ramp / stair run of every mission (grid.addRun: the M3 barn ramp and dam stairs, the M2 platform stair) is
 *    stepped on to only across its ends, never over its sides, and stays walkable from end to end;
 *  - the barn ramp's curbs are no walking ground, and a straight line over its side is no path;
 *  - a crawler sent up the barn ramp from all round its foot comes at it head-on, lies along it centred between its
 *    curbs (no part of his body over a curb or its flared end at the foot), on its stone (his height and the slope his
 *    body is pitched to are the ramp's measured surface) — and the same coming down.
 * The curbs and the slope are measured off the barn model (barn_a_snow; raycasts 10 cm apart).
 */
import { test, assert } from './lib.mjs';
import { getMission, MISSIONS } from '../../src/missions/index.js';
import { findPath } from '../../src/world/pathfinding.js';
import { bodyCapsule } from '../../src/world/body-clearance.js';
import * as SG from '../../src/art/stair-gait.js';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { loadGrid } from './mission-check.mjs';
import { pointInPolygon } from '../../src/core/math.js';

/** The barn ramp's stone curbs (top ~0.28 m over the slope) and their ends flared out at its foot, in plan. */
const CURBS = [
  [[38.55, 85.9], [39.0, 85.9], [39.0, 91.3], [38.55, 91.3]],
  [[38.35, 91.3], [38.95, 91.3], [38.7, 92.3], [37.85, 92.3]],
  [[41.05, 85.9], [41.5, 85.9], [41.5, 91.3], [41.05, 91.3]],
  [[41.1, 91.3], [41.75, 91.3], [42.25, 92.3], [41.35, 92.3]],
];
/** The barn ramp's stone surface along its middle (z, y), measured. */
const MESH = [[92.3, 0], [92.0, 0.122], [91.5, 0.154], [91.2, 0.242], [91.0, 0.331], [90.0, 0.754], [89.0, 1.185], [88.0, 1.598],
  [87.0, 2.038], [86.0, 2.471], [85.9, 2.535], [84.1, 2.535]];
const meshY = (z) => {
  if (z >= MESH[0][0]) return 0;
  for (let k = 1; k < MESH.length; k++) if (z >= MESH[k][0]) return MESH[k - 1][1] + ((MESH[k][1] - MESH[k - 1][1]) * (MESH[k - 1][0] - z)) / (MESH[k - 1][0] - MESH[k][0]);
  return MESH[MESH.length - 1][1];
};
const TOP = [40, 84.7];
/** Is (x, z) on the ramp's slope between its curbs (where the measured middle line is its surface)? */
const onSlope = (x, z) => x > 39.0 && x < 41.05 && z > 84.1 && z < 92.0;

/** Points over a lying man's body: his capsule's axis and both its sides, ends included. */
function bodyPoints(u) {
  const c = bodyCapsule(u.x, u.z, u.heading, 'crawl'), L = Math.hypot(c.ax - c.bx, c.az - c.bz), out = [];
  const ux = (c.ax - c.bx) / L, uz = (c.az - c.bz) / L;
  for (let t = -c.r; t <= L + c.r + 1e-9; t += 0.1) for (const v of [-c.r, 0, c.r]) {
    const tt = Math.min(Math.max(t, 0), L), cap = t < 0 || t > L ? Math.sqrt(Math.max(0, c.r * c.r - (t < 0 ? t * t : (t - L) ** 2))) : c.r;
    if (Math.abs(v) > cap + 1e-9) continue;
    out.push([c.bx + ux * t - uz * v, c.bz + uz * t + ux * v, tt]);
  }
  return out;
}

test('ramps & stairs: every run of every mission is stepped on to across its foot or head only, and walkable end to end', () => {
  const want = { m02: 1, m03: 3 };
  for (const def of MISSIONS) {
    const { grid } = loadGrid(def), runs = grid.runs || [];
    assert.ok(runs.length >= (want[def.id] ?? 0), `${def.id}: ${runs.length} ramp / stair runs (${want[def.id]} expected)`);
    const c = grid.cell;
    for (const R of runs) {
      const local = (x, z) => grid.runLocal(R, x, z);
      let band = 0;
      for (let k = 0; k < grid.size; k++) {
        if (grid.runOf[k] !== runs.indexOf(R) + 1 || !grid.isWalkable(k % grid.cols, (k / grid.cols) | 0)) continue;
        band++;
        const i = k % grid.cols, j = (k / grid.cols) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const ni = i + di, nj = j + dj;
          if (!grid.inBounds(ni, nj) || !grid.isWalkable(ni, nj)) continue;
          const nk = grid.idx(ni, nj);
          if (grid.runOf[nk] === grid.runOf[k] || !grid.canStep(k, nk)) continue;
          if (di && dj && (!grid.isWalkable(i + di, j) || !grid.isWalkable(i, j + dj) || !grid.canStep(k, grid.idx(i + di, j)) || !grid.canStep(k, grid.idx(i, j + dj)))) continue;
          const q = local((ni + 0.5) * c, (nj + 0.5) * c);
          assert.ok((q.s < 0 || q.s > R.L) && Math.abs(q.v) <= R.w / 2 + c / 2 + 1e-9,
            `${def.id} ${R.id}: on at (${((i + 0.5) * c).toFixed(2)},${((j + 0.5) * c).toFixed(2)}) from (${((ni + 0.5) * c).toFixed(2)},${((nj + 0.5) * c).toFixed(2)}), s ${q.s.toFixed(2)} v ${q.v.toFixed(2)}: over its side`);
        }
      }
      assert.ok(band > 0, `${def.id} ${R.id}: walkable cells on it`);
      // end to end: from straight in front of its foot to its last metre (its head may be a door: the barn's)
      const f = grid.runPoint(R, -1, 0), t = grid.runPoint(R, Math.max(0.5, R.L - 0.6), 0);
      if (!grid.walkableAt(f.x, f.z)) continue;
      const p = findPath(grid, f.x, f.z, t.x, t.z, { maxNodes: 400000 });
      assert.ok(p, `${def.id} ${R.id}: a way up it from its foot`);
      const end = p[p.length - 1];
      assert.ok(Math.hypot(end.x - t.x, end.z - t.z) < 0.8, `${def.id} ${R.id}: up to (${t.x.toFixed(1)},${t.z.toFixed(1)}), ends (${end.x.toFixed(1)},${end.z.toFixed(1)})`);
    }
  }
});

test('m03 barn ramp: its curbs are no walking ground; no step and no straight line goes over its side', () => {
  const { grid } = loadGrid(getMission('m03'));
  const R = grid.runs?.find((r) => /shed_ramp/.test(r.id));
  assert.ok(R, 'the barn ramp is a run');
  for (let z = 86.25; z <= 91.25; z += 0.5) {
    for (const x of [38.75, 41.25]) assert.equal(grid.walkableAt(x, z), false, `the curb at (${x},${z}) is not walked on`);
    for (const x of [39.25, 39.75, 40.25, 40.75]) assert.ok(grid.walkableAt(x, z), `the lane at (${x},${z}) is`);
    // from beside it: a line on to it crosses its side
    for (const [ox, ix] of [[37.25, 39.25], [42.75, 40.75]]) assert.ok(grid.crossesRunSide(ox, z, ix, z - 0.6), `a line from (${ox},${z}) on to the ramp crosses its side`);
  }
  assert.equal(grid.crossesRunSide(40, 94, 40, 90), false, 'a line up its middle from in front of its foot does not');
  // the dam stairs (railings both sides): from the ground beside their first treads, no straight line on to them
  let lines = 0;
  for (const S of grid.runs.filter((r) => /stair_[we]/.test(r.id))) {
    const ri = grid.runs.indexOf(S) + 1, c = grid.cell;
    for (let k = 0; k < grid.size; k++) {
      if (grid.runOf[k] !== ri || !grid.isWalkable(k % grid.cols, (k / grid.cols) | 0)) continue;
      const i = k % grid.cols, j = (k / grid.cols) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = grid.idx(i + di, j + dj);
        if (grid.runOf[nk] || !grid.isWalkable(i + di, j + dj) || Math.abs(grid.elev[nk] - grid.elev[k]) > 0.6) continue;
        const q = grid.runLocal(S, (i + di + 0.5) * c, (j + dj + 0.5) * c);
        if (q.s < 0 || q.s > S.L) continue; // (beside it, not past an end)
        lines++;
        assert.equal(grid.canStep(k, nk), false, `${S.id}: a step on to it from beside it at (${((i + di + 0.5) * c).toFixed(2)},${((j + dj + 0.5) * c).toFixed(2)})`);
        assert.equal(grid.walkableLine((i + di + 0.5) * c, (j + dj + 0.5) * c, (i + 0.5) * c, (j + 0.5) * c), false, `${S.id}: a line on to it from beside it`);
      }
    }
  }
  assert.ok(lines > 0, 'dam stairs: cells beside their low treads tried');
  for (const [sx, sz] of [[36.5, 90], [43.5, 88], [37.5, 93.5], [42.6, 94], [44, 92.5]]) for (const lying of [false, true]) {
    const who = `(${sx},${sz}) ${lying ? 'crawling' : 'walking'}`;
    const p = findPath(grid, sx, sz, ...TOP, { lying });
    assert.ok(p, `${who}: a way up`);
    // it comes on across the foot: the leg on to the ramp starts in front of its foot (within its width)
    const k = p.findIndex((q) => q.z < 92.31 && q.z > 84 && Math.abs(q.x - 40) < 1.0);
    assert.ok(k > 0, `${who}: on the ramp`);
    const before = p[k - 1], on = p[k];
    const xf = before.x + ((on.x - before.x) * (92.3 - before.z)) / (on.z - before.z); // (where it crosses the foot)
    assert.ok(before.z > 92.3 && Math.abs(xf - 40) <= 1.0, `${who}: on from (${before.x.toFixed(2)},${before.z.toFixed(2)}) across its foot at x ${xf.toFixed(2)}, between its curbs`);
    assert.ok(!grid.crossesRunSide(before.x, before.z, on.x, on.z), `${who}: not over its side`);
    if (!lying) continue;
    // a crawler: lined up on its axis 1.6 m out, then up its middle
    assert.ok(Math.abs(before.x - 40) < 0.05 && before.z > 93.4, `${who}: lined up at (${before.x.toFixed(2)},${before.z.toFixed(2)}) before its foot`);
    for (const q of p.slice(k)) assert.ok(Math.abs(q.x - 40) < 0.05, `${who}: up its middle (${q.x.toFixed(2)},${q.z.toFixed(2)})`);
  }
});

/** Crawl the Sapper from (sx, sz) to (tx, tz); every tick, his body and height against the barn ramp's stone. */
function crawl(sim, sp, tx, tz, label, out) {
  assert.ok(sp.issue({ type: 'move', x: tx, z: tz }), `${label}: ${sp.lastRefusal?.text}`);
  const rg = SG.rampGround || null;
  let onRamp = 0, firstOn = null;
  for (let i = 0; i < 60 * 60 && (sp.path || sp.isMoving); i++) {
    sim.step();
    if (sp.stance !== 'crawl') continue;
    const pts = bodyPoints(sp);
    for (const [x, z] of pts) {
      const hit = CURBS.findIndex((poly) => pointInPolygon(x, z, poly));
      if (hit >= 0) out.curb.push(`${label} t${(i / 60).toFixed(1)}: (${x.toFixed(2)},${z.toFixed(2)}) on curb ${hit} — him at (${sp.x.toFixed(2)},${sp.z.toFixed(2)}) h${((sp.heading * 180) / Math.PI).toFixed(0)}`);
    }
    if (!onSlope(sp.x, sp.z) || sp.z > 91.6) continue;
    onRamp++;
    if (!firstOn) firstOn = { h: sp.heading, x: sp.x };
    // his height: on the stone, not in it (the sim's y is where his pelvis lies)
    const y = sp.y || 0, m = meshY(sp.z);
    if (y < m - 0.03 || y > m + 0.1) out.y.push(`${label}: y ${y.toFixed(3)} on stone at ${m.toFixed(3)} (z ${sp.z.toFixed(2)})`);
    // the ground his lying body is pitched to (art/unit-model.js _proneGround): under chest and feet, the stone
    const g = rg?.(sp) || null, at = (x, z) => g?.(x, z) ?? (sp.world.groundY?.(x, z) ?? 0) + y;
    for (const a of [0.45, -0.85]) {
      const x = sp.x + Math.cos(sp.heading) * a, z = sp.z + Math.sin(sp.heading) * a;
      if (!onSlope(x, z)) continue;
      const gy = at(x, z), my = meshY(z);
      if (gy < my - 0.03 || gy > my + 0.1) out.pitch.push(`${label}: ground under ${a > 0 ? 'chest' : 'feet'} ${gy.toFixed(3)}, stone ${my.toFixed(3)} (z ${z.toFixed(2)})`);
    }
    // along it
    const along = Math.abs(Math.sin(sp.heading)) > Math.cos((12 * Math.PI) / 180);
    if (!along && sp.z < 91.4 && sp.z > 85.2) out.slant.push(`${label}: heading ${((sp.heading * 180) / Math.PI).toFixed(0)}° at (${sp.x.toFixed(2)},${sp.z.toFixed(2)})`);
  }
  return { onRamp, firstOn };
}

test('m03 barn ramp: a crawler sent up from all round its foot comes at it head-on, lies along it clear of its curbs, on its stone — and down again', () => {
  const out = { curb: [], y: [], pitch: [], slant: [], misc: [] };
  const check = (ok, msg) => { if (!ok) out.misc.push(msg); };
  for (const [sx, sz] of [[42.6, 94.0], [37.5, 93.5], [36.5, 90], [43.5, 88]]) {
    const sim = headlessMission('m03'), w = sim.world;
    for (const e of w.enemies) { e.alive = false; e.removed = true; } // (the route, not stealth)
    const sp = w.commandos.find((c) => c.role === 'sapper');
    sp.setPosition(sx, sz); sp.y = 0; sp.setStance('crawl');
    for (let i = 0; i < 60; i++) sim.step();
    const up = crawl(sim, sp, ...TOP, `up from (${sx},${sz})`, out);
    check(up.onRamp > 60, `up from (${sx},${sz}): on the ramp (${up.onRamp} ticks)`);
    check(Math.hypot(sp.x - TOP[0], sp.z - TOP[1]) < 0.6 && (sp.y || 0) > 2.4, `up from (${sx},${sz}): at its top (${sp.x.toFixed(2)},${sp.z.toFixed(2)} y ${(sp.y || 0).toFixed(2)})`);
    check(up.firstOn && Math.abs(up.firstOn.x - 40) < 0.25 && Math.abs(Math.sin(up.firstOn.h)) > Math.cos((15 * Math.PI) / 180), `up from (${sx},${sz}): onto it head-on (x ${up.firstOn?.x.toFixed(2)}, heading ${((up.firstOn?.h * 180) / Math.PI).toFixed(0)}°)`);
    // back down the way he came (facing up it: feet first until he is off it, then round)
    const down = crawl(sim, sp, sx, sz, `down to (${sx},${sz})`, out);
    check(down.onRamp > 60, `down to (${sx},${sz}): on the ramp`);
    check(Math.hypot(sp.x - sx, sp.z - sz) < 0.8, `down to (${sx},${sz}): there (${sp.x.toFixed(2)},${sp.z.toFixed(2)})`);
  }
  assert.equal(out.curb.length, 0, `his body over a curb: ${out.curb.length} samples, e.g. ${out.curb.slice(0, 4).join(' | ')}`);
  assert.equal(out.y.length, 0, `his height off the stone: ${out.y.length} ticks, e.g. ${out.y.slice(0, 3).join(' | ')}`);
  assert.equal(out.pitch.length, 0, `his body not pitched to the slope: ${out.pitch.length}, e.g. ${out.pitch.slice(0, 3).join(' | ')}`);
  assert.equal(out.slant.length, 0, `on the slant: ${out.slant.length}, e.g. ${out.slant.slice(0, 3).join(' | ')}`);
  assert.equal(out.misc.length, 0, out.misc.join(' | '));
});
