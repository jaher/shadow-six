/**
 * A route plan's other-hull test (Vehicle._planFree → _hullDepthAt) gives the very answers of the _hullDepth test it
 * replaces (perf/m13: M13's tank shut in its garage by the truck re-plans every 3 s to the end of the mission; ~60 % of
 * each search was this test, two outlines allocated and ~80 cos/sin per pose). Same depths, same comparisons, only
 * decided sooner (a separating axis wider than 0.25 m, a running maximum already over the threshold): checked pose by
 * pose against _hullDepth around a parked truck — overlapping, touching, near the 0.25 m band and far — for several
 * thresholds, and through _planFree against the old per-pose test.
 */
import { test, assert } from './lib.mjs';
import { World } from '../../src/world/world.js';
import { createVehicle } from '../../src/entities/vehicle.js';

/** Small deterministic PRNG (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function scene() {
  const w = new World({ size: [60, 60] });
  w.vehicleFactory = createVehicle;
  const tank = w.spawnVehicle('panzer2', { x: 30, z: 30, heading: 0.4 });
  const truck = w.spawnVehicle('truck', { x: 34.5, z: 31.2, heading: Math.PI / 2 + 0.3, seats: 6 });
  return { w, tank, truck };
}

test('_hullDepthAt answers `_hullDepth > T` exactly, pose by pose (overlap, contact, the 0.25 m band, far)', () => {
  const { tank, truck } = scene();
  const snap = Object.create(truck, { x: { value: truck.x }, z: { value: truck.z }, heading: { value: truck.heading } });
  const r = rng(13);
  const Ts = [-0.25, -0.25 + 1e-9, -0.1, 0, 0.05, 0.3, 1.2, 3.5, -1e-6];
  let n = 0, hits = 0, early = 0;
  for (let k = 0; k < 6000; k++) {
    // poses round the truck: radius 0..9 m, any heading (a third within 2-4 m: the band where the answer flips)
    const rad = k % 3 === 0 ? 2 + r() * 2 : r() * 9, a = r() * Math.PI * 2, h = (r() - 0.5) * Math.PI * 4;
    const x = truck.x + Math.cos(a) * rad, z = truck.z + Math.sin(a) * rad, c = Math.cos(h), s = Math.sin(h);
    const dq = tank._hullDepth(snap, x, z, h);
    for (const T of Ts) {
      const fast = tank._hullDepthAt(snap, T)(x, z, h, c, s);
      assert.equal(fast, dq > T, `pose (${x}, ${z}, ${h}) T ${T}: depth ${dq}`);
      n++; if (fast) hits++;
      if (dq < -0.25 && dq > -0.6) early++;
    }
  }
  assert.ok(hits > n * 0.1 && hits < n * 0.9, `both answers well represented (${hits} of ${n})`);
  assert.ok(early > 500, `poses in the band just outside 0.25 m (${early})`);
});

test('_hullDepthAt: a pose exactly at the threshold, and the start pose against its own depth (d0 − 1e-6)', () => {
  const { tank, truck } = scene();
  const snap = Object.create(truck, { x: { value: truck.x }, z: { value: truck.z }, heading: { value: truck.heading } });
  const r = rng(7);
  for (let k = 0; k < 400; k++) {
    const x = 28 + r() * 10, z = 26 + r() * 10, h = r() * 7;
    const dq = tank._hullDepth(snap, x, z, h);
    // T exactly the depth (not over it), a hair under it, and the planner's own rule from this pose
    assert.equal(tank._hullDepthAt(snap, dq)(x, z, h, Math.cos(h), Math.sin(h)), false, 'depth == T is not over T');
    if (dq > -0.25) assert.equal(tank._hullDepthAt(snap, dq - 1e-12)(x, z, h, Math.cos(h), Math.sin(h)), dq > dq - 1e-12);
    const T = Math.max(-0.25, dq - 1e-6);
    assert.equal(tank._hullDepthAt(snap, T)(x, z, h, Math.cos(h), Math.sin(h)), dq > T);
  }
});

test('_planFree with other hulls: the same free / not free as the per-pose _hullDepth test it replaces', () => {
  const { tank, truck } = scene();
  const had = tank._hadCells();
  const fast = tank._planFree(had, { gatesOpen: true });
  // the old test: _hullDepth at every pose (a reference _hullDepthAt asking it pose by pose)
  const own = tank._hullDepthAt;
  tank._hullDepthAt = (v, T) => (x, z, h) => tank._hullDepth(v, x, z, h) > T;
  const ref = tank._planFree(had, { gatesOpen: true });
  tank._hullDepthAt = own;
  const r = rng(99);
  let blocked = 0;
  for (let k = 0; k < 5000; k++) {
    const x = 24 + r() * 16, z = 24 + r() * 14, h = r() * Math.PI * 2;
    const a = fast(x, z, h), b = ref(x, z, h);
    assert.equal(a, b, `pose (${x}, ${z}, ${h})`);
    if (!a) blocked++;
  }
  assert.ok(blocked > 300, `the truck blocks poses (${blocked})`);
  assert.ok(truck.x > 0, 'the truck stands where it was put');
});
