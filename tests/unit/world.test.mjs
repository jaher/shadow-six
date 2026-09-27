import { test, assert, near } from './lib.mjs';
import { World } from '../../src/world/world.js';
import { B, T } from '../../src/world/grid.js';

const scene = () => ({ items: new Set(), add(o) { this.items.add(o); }, remove(o) { this.items.delete(o); } });
let nid = 1;
function ent(x, z, extra = {}) {
  return {
    id: nid++, kind: 'enemy', x, z, alive: true, hp: 100, object3d: {}, taken: 0,
    takeDamage(a) { this.taken += a; this.hp -= a; if (this.hp <= 0) this.alive = false; },
    ...extra,
  };
}

test('add/remove/byId (numeric, tag, numeric string) and scene sync', () => {
  const s = scene();
  const w = new World({ size: [40, 40], scene: s });
  const e = w.add(ent(5, 5, { tag: 'guard1' }));
  assert.equal(w.byId(e.id), e);
  assert.equal(w.byId('guard1'), e);
  assert.equal(w.byId(String(e.id)), e);
  assert.equal(w.enemies.length, 1);
  assert.ok(s.items.has(e.object3d));
  w.remove(e);
  assert.equal(w.byId('guard1'), null);
  assert.equal(w.enemies.length, 0);
  assert.ok(!s.items.has(e.object3d));
});

test('entitiesInRadius: exact results, no duplicates, matches brute force', () => {
  const w = new World({ size: [200, 200] });
  const all = [];
  for (let k = 0; k < 400; k++) all.push(w.add(ent(w.rng.range(0, 200), w.rng.range(0, 200))));
  w.rebuildSpatial();
  for (const [x, z, r] of [[100, 100, 10], [0, 0, 30], [199, 5, 7], [50, 150, 0.5], [100, 100, 500]]) {
    const got = w.entitiesInRadius(x, z, r);
    const want = all.filter((e) => Math.hypot(e.x - x, e.z - z) <= r);
    assert.equal(new Set(got).size, got.length, 'no duplicates');
    assert.equal(got.length, want.length, `count at ${x},${z},${r}`);
  }
});

test('entitiesInRadius sees entities that moved one bucket since rebuild; filter applies', () => {
  const w = new World({ size: [100, 100] });
  const e = w.add(ent(10, 10));
  w.rebuildSpatial();
  e.x = 13.5; // moved without rebuild
  assert.deepEqual(w.entitiesInRadius(14, 10, 1), [e]);
  assert.deepEqual(w.entitiesInRadius(14, 10, 1, (q) => q.kind === 'commando'), []);
});

test('emitNoise emits a canonical noise event', () => {
  const w = new World({ size: [20, 20] });
  let got = null;
  w.listen('noise', (p) => (got = p));
  const src = { id: 99 };
  w.emitNoise(3, 4, 18, 'pistol', src);
  assert.deepEqual(got, { x: 3, z: 4, radius: 18, kind: 'pistol', level: 2, source: src }); // level from CONFIG.stealth.noise (§4.4)
});

test('damageRadius: full at centre, 25% at edge, nothing outside, dead ignored', () => {
  const w = new World({ size: [50, 50] });
  const a = w.add(ent(10, 10)), b = w.add(ent(14, 10)), c = w.add(ent(20, 10)), d = w.add(ent(11, 10, { alive: false }));
  w.rebuildSpatial();
  const hit = w.damageRadius(10, 10, 4, 80);
  near(a.taken, 80); near(b.taken, 20); assert.equal(c.taken, 0); assert.equal(d.taken, 0);
  assert.equal(hit.length, 2);
});

test('groundAt reports terrain, water, bridge, out of bounds', () => {
  const w = new World({ size: [20, 20] });
  w.grid.fillRect(0, 10, 20, 2, 'terrain', T.WATER);
  w.grid.fillRect(5, 10, 2, 2, 'bridge', 1);
  assert.equal(w.groundAt(1, 10.5).water, true);
  assert.equal(w.groundAt(1, 10.5).walkable, false);
  assert.equal(w.groundAt(5.5, 10.5).bridge, true);
  assert.equal(w.groundAt(5.5, 10.5).walkable, true);
  assert.equal(w.groundAt(-1, 3).walkable, false);
  assert.equal(w.groundAt(2, 2).terrain, 'ground');
});

test('world.findPath: walkers use the bridge, swimmers go straight', () => {
  const w = new World({ size: [30, 30] });
  w.grid.fillRect(0, 14, 30, 2, 'terrain', T.WATER);
  w.grid.fillRect(25, 14, 2, 2, 'bridge', 1);
  const walk = w.findPath(5, 5, 5, 25);
  assert.ok(walk.some((p) => p.x > 20), 'detours via bridge');
  const swim = w.findPath(5, 5, 5, 25, { swim: true });
  assert.equal(swim.length, 2);
});

test('dispose unsubscribes world listeners', () => {
  const w = new World({ size: [10, 10] });
  let n = 0;
  w.listen('noise', () => n++);
  w.dispose();
  w.events.emit('noise', {});
  assert.equal(n, 0);
});
