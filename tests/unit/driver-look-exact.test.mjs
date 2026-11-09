/**
 * The solution driver's look-aheads were made cheaper for the M1 perf pass (tools/solutions/driver.mjs): clearAhead /
 * routeClear / rowClear each run as one withMirrors look (a guard's mirror refreshed once per call), walkerSees works
 * out each head's cone first and builds a ghost only for a head whose cone holds the point, and rowClear refills its
 * dummies and works out a posted man's cone once per sample. The solutions decide on these answers tick by tick, so
 * they must be exactly the old code's (fixtures/driver-look-ref.mjs, verbatim): walkerSees true / false for random
 * guards (sweeping, a head carried round, round and elliptical cones, wide ellipses, a halt's second heading) and
 * points, and rowClear's verdict and its `why` (the first sighting, found in the same order) for random rows — pads,
 * slack, holds, guards left out, posts sweeping, walkers on their beats — the clock moving on between batches.
 */
import { test, assert } from './lib.mjs';
import { makeDriver, driverWalkerSees } from '../../tools/solutions/driver.mjs';
import { refWalkerSees, refRowClear } from './fixtures/driver-look-ref.mjs';

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const frac = (x) => x - Math.floor(x);
/** A pure line of sight: blocked for some cell pairs (by a hash of the ends' cells and the target's height). */
const los = (x0, z0, x1, z1, o) => frac(Math.sin(Math.floor(x0 / 3) * 12.9898 + Math.floor(z0 / 3) * 78.233 + Math.floor(x1 / 2) * 37.719 + Math.floor(z1 / 2) * 4.581 + (o?.targetLow ? 9.1 : 0)) * 43758.5453) > 0.25;

function world(r) {
  const byId = new Map();
  const w = { time: 0, enemies: [], vehicles: [], entities: [], commandos: [], interactables: [], ai: { squads: new Map() }, mission: { rules: {} },
    events: { on: () => () => {} },
    grid: { version: 1, elevAt: (x, z) => (frac(Math.sin(Math.floor(x) * 3.1 + Math.floor(z) * 7.7) * 99) < 0.1 ? 0.6 : 0), lineOfSight: los },
    byId: (id) => byId.get(id) };
  w._add = (e, list = w.enemies) => { e.id = e.id ?? `u${byId.size + 1}`; byId.set(e.id, e); list.push(e); w.entities.push(e); return e; };
  return w;
}
// (soldier-like cones: round or elliptical — narrow, or wider than long — a sweep or none; fov in radians as normalised)
const vision = (r) => ({ far: 28 + r() * 12, range: 30, fov: 0.9 + r() * 0.9, elliptical: r() < 0.6, ellipseRatio: r() < 0.3 ? 1.4 : r() < 0.5 ? undefined : 0.33,
  near: 14, eyeHeight: 1.6, sweep: r() < 0.6 ? 0.4 + r() * 0.6 : 0, period: 4 + r() * 4, phase: r() * 3 });
function brainOf(r, R) {
  return { state: 'IDLE', routeIndex: Math.floor(r() * (R?.length || 1)), routeDir: r() < 0.5 ? 1 : -1, _routeType: r() < 0.5 ? 'LOOP' : 'PINGPONG', _loopStart: 0, atWait: false, waitT: 0, _leader: () => null };
}
function post(w, r, tag) {
  const e = { tag, world: w, alive: true, removed: false, incapacitated: false, x: 10 + r() * 80, z: 10 + r() * 80, y: 0, heading: r() * 6.28 - 3.14, vision: vision(r), speed: 1 };
  e.sweepActive = !!e.vision.sweep && r() < 0.8; e.sweepAmp = r() < 0.2 ? undefined : e.vision.sweep;
  e.headOffset = r() < 0.3 ? (r() - 0.5) * 0.6 : 0; e.headCarry = r() < 0.4 ? (r() - 0.5) * 1.2 : r() < 0.5 ? 0 : undefined;
  e.brain = brainOf(r, null);
  return w._add(e);
}
function walker(w, r, tag) {
  const R = Array.from({ length: 2 + Math.floor(r() * 3) }, () => ({ x: 10 + r() * 80, z: 10 + r() * 80, ...(r() < 0.6 ? { wait: 1 + r() * 10, ...(r() < 0.6 ? { look: Math.round(r() * 360 - 180) } : {}) } : {}) }));
  const e = { tag, world: w, alive: true, removed: false, incapacitated: false, route: R, vision: vision(r), speed: 0.9 + r() * 0.8, y: 0, sweepActive: false,
    headOffset: 0, headCarry: r() < 0.4 ? (r() - 0.5) * 1.2 : 0, path: null, pathIndex: 0 };
  e.sweepAmp = e.vision.sweep;
  e.brain = brainOf(r, R);
  const wp = R[e.brain.routeIndex];
  if (wp.wait && r() < 0.5) { e.x = wp.x; e.z = wp.z; e.heading = r() * 6.28 - 3.14; e.brain.atWait = true; e.brain.waitT = r() * wp.wait; e.isMoving = false; }
  else { e.x = wp.x + (r() - 0.5) * 30; e.z = wp.z + (r() - 0.5) * 30; e.heading = Math.atan2(wp.z - e.z, wp.x - e.x); e.isMoving = true; }
  return w._add(e);
}
function populate(w, r) {
  const n = 3 + Math.floor(r() * 5);
  for (let i = 0; i < n; i++) (r() < 0.45 ? post : walker)(w, r, `e${i + 1}`);
  if (r() < 0.2) w.enemies[0].alive = false;
}

test('driver walkerSees: the same answer as a ghost per head (random guards, heads, points)', () => {
  let n = 0, seen = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const r = rng(seed * 7919), w = world(r);
    populate(w, r);
    for (let k = 0; k < 400; k++) {
      const e = w.enemies[Math.floor(r() * w.enemies.length)];
      const q = { x: 10 + r() * 80, z: 10 + r() * 80, heading: r() * 6.28 - 3.14, ...(r() < 0.3 ? { alt: r() * 6.28 - 3.14 } : {}) };
      // (points anywhere, many of them near a cone's reach or its edges: within about the longest far of the guard)
      const a = r() * 6.28, d = r() < 0.7 ? r() * 45 : 45 + r() * 20;
      const dummy = { x: q.x + Math.cos(a) * d, z: q.z + Math.sin(a) * d, y: 0, isLow: r() < 0.4, isVisibleToEnemies: true };
      const tAbs = w.time + r() * 20;
      const want = refWalkerSees(e, q, dummy, w, tAbs), got = driverWalkerSees(e, q, dummy, w, tAbs);
      if (got !== want) assert.fail(`seed ${seed} case ${k}: ${e.tag} at (${q.x.toFixed(2)},${q.z.toFixed(2)}) h${q.heading.toFixed(3)} alt ${q.alt} -> (${dummy.x.toFixed(2)},${dummy.z.toFixed(2)}): got ${got}, want ${want}`);
      n++; if (want) seen++;
    }
    w.time += 3.7;
  }
  assert.ok(seen > n * 0.05 && seen < n * 0.95, `a fair mix of seen and unseen (${seen} of ${n})`);
});

test('driver rowClear: the same verdict and the same first sighting as before (random rows, pads, slack, holds)', () => {
  let n = 0, clear = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed * 104729), w = world(r);
    populate(w, r);
    const raft = w._add({ tag: 'raft', vehicleType: 'raft', removed: false, x: 10 + r() * 80, z: 10 + r() * 80, heading: r() * 6.28 - 3.14,
      def: { fast: 4, slow: 2.5, turn: Math.PI / 2 } }, w.vehicles);
    const D = makeDriver(w, { step: () => { w.time += 1 / 60; }, quiet: true, log: () => {} });
    for (let k = 0; k < 12; k++) {
      const pts = Array.from({ length: 1 + Math.floor(r() * 3) }, () => [10 + r() * 80, 10 + r() * 80]);
      const o = { fast: r() < 0.5, slack: r() < 0.5 ? [-0.1, 0.25] : [-(r() * 1.2), r() * 1.6], pad: r() < 0.5 ? 0 : r() * 1.2, hold: r() < 0.5 ? 0 : r() * 4,
        delay: r() < 0.5 ? 0 : r() * 6, minDist: r() < 0.5 ? 6 : 2, step: r() < 0.7 ? 0.5 : 1,
        except: r() < 0.3 ? [w.enemies[Math.floor(r() * w.enemies.length)]] : null, ...(r() < 0.2 ? { from: [pts[0][0] + 3, pts[0][1] - 2, 0.3] } : {}) };
      const whyA = [], whyB = [];
      const want = refRowClear(w, raft, D.dt, pts, { ...o, why: whyB }), got = D.rowClear(pts, { ...o, why: whyA });
      assert.equal(got, want, `seed ${seed} row ${k}: verdict (${whyB.join(' ')})`);
      assert.deepEqual(whyA, whyB, `seed ${seed} row ${k}: the first sighting`);
      n++; if (want) clear++;
    }
    for (let i = 0; i < 90; i++) w.time += 1 / 60;
    D.dispose();
  }
  assert.ok(clear > 0 && clear < n, `rows both clear and seen (${clear} of ${n} clear)`);
});
