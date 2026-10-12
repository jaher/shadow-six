/** Rule (e) head room (world/map-builder.js stampHeadroom) leaves open water alone: a beam over a channel (M13's south
 *  lock gate, latched open) never shuts it to divers and boats, also when a blast re-stamps the head room. */
import { test, assert } from './lib.mjs';
import { NavGrid, T, B } from '../../src/world/grid.js';
import { stampHeadroom } from '../../src/world/map-builder.js';

test('head room: a low beam nav-blocks the dry cells under it, never the open water', () => {
  const g = new NavGrid(20, 20);
  const water = (x, z) => x >= 8 && x < 12;
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) {
    const c = g.cellCenter(i, j);
    if (water(c.x, c.z)) g.terrain[g.idx(i, j)] = T.WATER;
  }
  // a beam 1.91 m up across the whole map at z 10 (the lock gate's walkway over the channel)
  const beam = new Map();
  for (let i = 0; i < g.cols; i++) { const c = g.worldToCell(0, 10); beam.set(g.idx(i, c.j), [1.91, 2.09]); }
  g.overStamp('beam', beam);
  const handlers = [];
  const world = { grid: g, groundY: () => 0.05, structureDoors: new Map(), events: { on: (n, f) => { if (n === 'structure:destroyed') handlers.push(f); return () => {}; } } };
  stampHeadroom(world, []);
  const nav = (x, z) => { const c = g.worldToCell(x, z); return g.navBlock[g.idx(c.i, c.j)]; };
  assert.ok(nav(4, 10) > 0, 'dry ground under the beam: no head room');
  assert.equal(nav(10, 10), 0, 'the channel under the beam stays open');
  assert.ok(g.isWalkable(g.worldToCell(10, 10).i, g.worldToCell(10, 10).j, { swim: true }), 'a diver swims under it');
  // a blast somewhere re-stamps the head room (a structure's overhang may have gone): the channel stays open
  assert.equal(handlers.length, 1);
  handlers[0]();
  assert.equal(nav(10, 10), 0, 'still open after the re-stamp');
  assert.ok(nav(4, 10) > 0);
  assert.equal(g.block[g.idx(g.worldToCell(10, 10).i, g.worldToCell(10, 10).j)], B.NONE);
});
