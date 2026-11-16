/**
 * M20 layout: the E group (Sniper, Marine, Sapper, Driver: prone among the rocks NE of the castle) can crawl S out of
 * the NE fields. The E field between the E wall walk and the map edge is only ~16 m wide; e11, posted on the walk
 * looking E with a 90° sweep, saw a man lying anywhere across it at his z (near band 18 m: every lane within reach)
 * while he stood on the walk's middle. Posted on its inner half, he leaves a lane along the map edge (sol/m20).
 */
import { test, assert } from './lib.mjs';
import { headlessMission } from '../../tools/solutions/headless.mjs';

test('m20: a crawl lane along the E map edge stays beyond e11\'s near band', () => {
  const { world: w } = headlessMission('m20');
  const e11 = w.enemies.find((e) => e.tag === 'e11'), g = w.grid;
  let edge = 0;
  for (let x = 150; x < 157; x += 0.25) if (g.walkableAt(x, e11.z)) edge = x;
  const near = e11.vision.near ?? 18;
  assert.ok(Math.hypot(edge - e11.x, 0) > near + 1, `the E field's last walkable cell at his z (${edge}) is ${(edge - e11.x).toFixed(2)} m from him (near band ${near} m)`);
  assert.ok(g.elevAt(e11.x, e11.z) > 6.5, 'e11 still stands on the E wall walk');
});

test('m20: a stone flight is masonry down to the ground — no way on foot through its run, its foot and top open', () => {
  const { world: w } = headlessMission('m20');
  const g = w.grid, f = g.flights.flights.find((q) => q.solid && Math.hypot(q.ox - 62, q.oz - 67.41) < 0.6); // S_gw (user 2026-11-15: re-routed into the gatehouse forecourt pocket, climbing N to the T_wb edge at z=62; it stands freestanding in the pocket, not wedged)
  assert.ok(f, 'the W quarter stairs (S_gw) are a solid flight');
  // solid to the ground: no way on foot through its run (the cell on its centreline, mid-run)
  assert.ok(!g.walkableAt(62, 65.0), 'through its run: no way on foot');
  // the narrow gap between its E cheek and the gatehouse face is passable — a man squeezes beside it, not through it
  assert.ok(g.walkableAt(63.6, 65.0), 'beside the run, in the gap: a way on foot');
  assert.ok(g.walkableAt(62, 67.7), 'its foot is open');
  const top = { x: f.ox + f.ux * f.sTop, z: f.oz + f.uz * f.sTop };
  assert.ok(g.walkableAt(top.x + f.ux * 0.6, top.z + f.uz * 0.6), 'past its top is open');
  // a man from the yard W of it to the tunnel goes beside it or round its foot, never through the solid flight
  const p = w.findPath(59, 65, 72, 66, { role: 'greenberet' });
  assert.ok(p && p.every((q) => !(q.x > 60.8 && q.x < 63.2 && q.z > 62.1 && q.z < 67.4)), 'beside it or round its foot, never through it');
});
