/**
 * sneak.mjs walkerSeesWide (M20 perf pass): `seesAny(walkerViews(e, q, w, tAbs, m), dummy, w, margin)` — would a walking
 * guard predicted at q see the dummy, his cones widened by a margin — asked the cheap way (a head's viewer copy and
 * cone built only when the point can lie in its widened cone). The solutions decide on the answer and a run must stay
 * the same tick for tick, so both are asked the same questions over random guards (round and elliptical cones, halts
 * with exact heads, turns, cries, sweeps), points (near, far, at the eye, crawling, standing, a body) and margins, with
 * a sight line that comes and goes, and every answer must be the same — and how often canSee is reached stays the same
 * or less.
 */
import { test, assert } from './lib.mjs';
import { walkerSeesWide, walkerViews, seesAny } from '../../tools/solutions/sneak.mjs';
import { mirrorOf } from '../../tools/solutions/ghost.mjs';

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** A world whose sight line comes and goes by where it runs from and to (a pure function of its ends, as a grid's is). */
function world(r) {
  const calls = { n: 0 };
  const w = {
    time: 100 + r() * 50, structures: new Map(), enemies: [], calls,
    sneakHaltExact: r() < 0.5 ? 1.5 : null, sneakTurns: r() < 0.5, sneakTurnTie: 0.02, sneakSweepSteps: r() < 0.3 ? 3 : undefined,
    sneakCries: r() < 0.3 ? [{ t: 90, x: r() * 40, z: r() * 40, r: 30 }] : undefined,
    grid: {
      sightLine(x0, z0, x1, z1, o) {
        calls.n++;
        const h = rng((Math.floor(x0 * 13) * 7919) ^ (Math.floor(z0 * 17) * 104729) ^ (Math.floor(x1 * 3) * 1299709) ^ (Math.floor(z1 * 5) * 15485863) ^ (o.targetLow ? 7 : 0));
        h(); return h() < 0.7;
      },
    },
  };
  return w;
}

function guard(r, w) {
  const elliptical = r() < 0.6;
  const e = {
    world: w, alive: true, removed: false, spawn: {}, x: r() * 40, z: r() * 40, y: r() < 0.2 ? 3 : 0, heading: r() * 6.4 - 3.2,
    vision: { far: 18 + r() * 22, near: 6 + r() * 6, fov: (60 + r() * 60) * Math.PI / 180, elliptical, ellipseRatio: elliptical ? 0.5 + r() * 0.4 : undefined, phase: r() * 10 },
    sweepAmp: r() < 0.5 ? 0.6 : 0,
  };
  return e;
}

function predicted(r, e) {
  const q = { x: e.x + (r() - 0.5) * 10, z: e.z + (r() - 0.5) * 10, heading: r() * 6.4 - 3.2 };
  const k = r();
  if (k < 0.3) q.halt = true; else if (k < 0.7) q.halt = false;
  if (q.halt && r() < 0.5) q.alt = q.heading + (r() - 0.5) * 2;
  if (!q.halt && r() < 0.4) { q.turnFrom = q.heading + (r() - 0.5) * 5; q.turnT = r() * 1.5; }
  return q;
}

function dummy(r, q, far) {
  const k = r(), a = r() * 6.4, d = k < 0.05 ? 0 : r() * far * 1.4;
  const x = q.x + Math.cos(a) * d, z = q.z + Math.sin(a) * d;
  if (k < 0.35) return { x, z, y: 0, isLow: true, isVisibleToEnemies: true, alive: true, kind: 'commando' };
  if (k < 0.85) return { x, z, y: r() < 0.1 ? 4 : 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' };
  return { x, z, y: 0, kind: 'body' };
}

test('walkerSeesWide: the same answer as seesAny(walkerViews(...), margin), canSee asked no more often', () => {
  const r = rng(20261030);
  let n = 0, seen = 0, slow = 0, fast = 0;
  for (let k = 0; k < 400; k++) {
    const w = world(r), e = guard(r, w);
    w.enemies.push(e);
    for (let j = 0; j < 60; j++) {
      const q = predicted(r, e), d = dummy(r, q, e.vision.far), tAbs = w.time + r() * 30;
      const mg = r() < 0.15 ? [0, 0] : [r() * 6, r() * 0.6];
      const m = mirrorOf(e);
      const c0 = w.calls.n, a = seesAny(walkerViews(e, q, w, tAbs, m), d, w, mg), c1 = w.calls.n;
      const b = walkerSeesWide(e, q, d, w, tAbs, mg, m), c2 = w.calls.n;
      assert.equal(b, a, `case ${k}/${j}: wide ${b} vs views ${a}`);
      assert.ok(c2 - c1 <= c1 - c0, `case ${k}/${j}: sight lines ${c2 - c1} > ${c1 - c0}`);
      n++; if (a) seen++; slow += c1 - c0; fast += c2 - c1;
    }
  }
  // (the questions cover both answers, and the sight line was asked often)
  assert.ok(seen > n * 0.1 && seen < n * 0.9, `seen ${seen} of ${n}`);
  assert.ok(slow > 1000, `sight lines asked ${slow}`);
});

test('walkerSeesWide: no margin, a vehicle\'s eye, no vision: answered as seesAny(walkerViews(...)) itself', () => {
  const r = rng(7);
  for (let k = 0; k < 200; k++) {
    const w = world(r), e = guard(r, w);
    if (k % 3 === 1) e.vision = null;
    if (k % 3 === 2) { e.vehEye = true; }
    const q = predicted(r, e), d = dummy(r, q, 30), tAbs = w.time + r() * 10, mg = k % 2 ? null : [3, 0.3];
    const a = seesAny(walkerViews(e, q, w, tAbs, mirrorOf(e)), d, w, mg), b = walkerSeesWide(e, q, d, w, tAbs, mg);
    assert.equal(b, a, `case ${k}`);
  }
});
