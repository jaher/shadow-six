/** Grid extensions (design-spec §10.2 / §10.4 #7): dynamicBlock, elev, climb/ladder links in A*. */
import { test, assert, near } from './lib.mjs';
import { NavGrid, B, LINK, MAX_STEP } from '../../src/world/grid.js';
import { findPath } from '../../src/world/pathfinding.js';

test('dynamicBlock: stamp blocks sight (not static version), clear restores it', () => {
  const g = new NavGrid(40, 20);
  const v0 = g.version, d0 = g.dynamicVersion;
  assert.ok(g.lineOfSight(2, 10, 38, 10));
  const n = g.stampDynamic(20, 10, 6, 2.4, 0); // truck across the sight line
  assert.ok(n > 0);
  assert.equal(g.dynamicAt(20, 10), B.HIGH);
  assert.equal(g.version, v0, 'static version untouched');
  assert.ok(g.dynamicVersion > d0);
  assert.equal(g.lineOfSight(2, 10, 38, 10), false, 'vehicle occludes');
  assert.ok(g.lineOfSight(2, 10, 38, 10, { dynamic: false }), 'opt-out');
  near(g.castRay(2, 10, 0, 36), 20 - 3 - 2, 0.51, 'castRay stops at the hull');
  assert.ok(g.isWalkable(40, 20), 'movement ignores dynamic by default');
  assert.equal(g.isWalkable(40, 20, { dynamic: true }), false);
  g.clearDynamic();
  assert.equal(g.dynamicAt(20, 10), 0);
  assert.ok(g.lineOfSight(2, 10, 38, 10));
});

test('dynamicBlock: oriented stamp follows the heading', () => {
  const g = new NavGrid(20, 20);
  g.stampDynamic(10, 10, 6, 1, Math.PI / 2); // long axis along z
  assert.equal(g.dynamicAt(10, 12.5), B.HIGH);
  assert.equal(g.dynamicAt(12.5, 10), 0);
});

test('elev: raised cells block ground LOS, not roof-to-roof; steps limited by MAX_STEP', () => {
  const g = new NavGrid(30, 10);
  g.fillRect(12, 0, 6, 10, 'elev', 4); // a 4 m high walkable roof strip (block stays NONE)
  near(g.elevAt(15, 5), 4);
  assert.equal(g.lineOfSight(2, 5, 28, 5), false, 'roof hides ground units behind it');
  assert.ok(g.lineOfSight(13, 2, 17, 8, { viewerY: 4, targetY: 4 }), 'same roof level sees');
  const k0 = g.idx(23, 5), k1 = g.idx(24, 5); // 11.5 → 12.0 boundary
  assert.equal(g.canStep(k0, k1), false);
  assert.ok(g.canStep(g.idx(25, 5), g.idx(26, 5)));
  assert.ok(MAX_STEP > 0 && MAX_STEP < 1);
  assert.equal(g.walkableLine(2, 5, 28, 5, { elevRef: 0 }), false, 'smoothing never crosses a level change');
  assert.ok(g.walkableLine(2, 5, 10, 5, { elevRef: 0 }));
});

test('pathfinding: raised island is unreachable without a link', () => {
  const g = new NavGrid(30, 30);
  g.fillRect(10, 10, 6, 6, 'elev', 3);
  assert.equal(findPath(g, 2, 2, 13, 13), null, 'no link → nothing reaches the roof');
  const p = findPath(g, 2, 2, 28, 28);
  assert.ok(p, 'ground route around the island');
  for (const q of p) assert.ok(g.elevAt(q.x, q.z) === 0);
});

test('links: climb edges are Green-Beret-only, ladders open to all, disabled ladders unusable', () => {
  const g = new NavGrid(30, 30);
  g.fillRect(10, 10, 6, 6, 'elev', 3);
  const climb = g.addLink(LINK.CLIMB, { x: 9.25, z: 12.25 }, { x: 10.25, z: 12.25, y: 3 });
  assert.deepEqual(climb.roles, ['greenberet']);
  near(climb.a.y, 0); near(climb.b.y, 3);
  assert.equal(findPath(g, 2, 12, 13, 13, { role: 'sniper' }), null, 'sniper cannot climb');
  const p = findPath(g, 2, 12, 13, 13, { role: 'greenberet' });
  assert.ok(p, 'green beret climbs');
  const li = p.findIndex((q) => q.link);
  assert.ok(li > 0, 'a waypoint marks the link');
  assert.equal(p[li].link.kind, 'climb');
  near(p[li].y, 3);
  near(p[li - 1].x, 9.25); near(p[li].x, 10.25);
  assert.equal(p[p.length - 1].x, 13);

  const lad = g.addLink(LINK.LADDER, { x: 16.75, z: 14.25 }, { x: 15.75, z: 14.25, y: 3 });
  assert.equal(lad.roles, null);
  assert.ok(findPath(g, 25, 14, 13, 13, { role: 'sniper' }), 'anyone uses the ladder');
  assert.ok(findPath(g, 25, 14, 13, 13, { role: 'enemy' }), 'enemies too');
  g.setLinkEnabled(lad.id, false);
  assert.equal(findPath(g, 25, 14, 13, 13, { role: 'sniper' }), null, 'raised ladder');
  const snap = g.serialize();
  g.setLinkEnabled(lad.id, true);
  g.deserialize(snap);
  assert.equal(g.links.find((l) => l.id === lad.id).enabled, false, 'link state saved');
  assert.ok(g.removeLink(climb.id));
  assert.equal(findPath(g, 2, 12, 13, 13, { role: 'greenberet' })?.some((q) => q.link?.kind === 'climb') ?? false, false);
  assert.equal(g.linksAt(climb.ka).length, 0);
});

test('links: role "*" may use every enabled link; paths without links are unchanged', () => {
  const g = new NavGrid(20, 20);
  g.fillRect(12, 0, 8, 20, 'elev', 5);
  g.addLink(LINK.CLIMB, { x: 11.25, z: 5.25 }, { x: 12.25, z: 5.25, y: 5 }, { roles: ['greenberet'] });
  assert.ok(findPath(g, 2, 5, 15, 5, { role: '*' }));
  const p = findPath(g, 1, 1, 10, 18);
  assert.equal(p.length, 2, 'straight open-ground path still smooths to 2 points');
});
