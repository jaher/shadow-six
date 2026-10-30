/**
 * M20 second art pass (art/m20-dressing.js): the set dressing stands clear of every post, beat, route, spawn, link and
 * road of the dossier, on its own level, drawn inside its footprint; the floating rampart crate stands on T_n; the HQ
 * porch keeps no baked AO on its dressed stone.
 * Run with the unit suite: node tests/unit/run.mjs art-m20
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { getMission } from '../../src/missions/index.js';
import { M20_DRESSING, M20_DRESSING_BUILDERS, M20_DRESSING_VARIANTS } from '../../src/art/m20-dressing.js';
import { VARIANT_HINTS } from '../../src/art/building-props.js';
import { T_N, T_NE, Y, ROAD_IN, POOL } from '../../src/missions/m20_operation_valhalla.js';

const m20 = getMission('m20');
const S = (id) => m20.structures.find((s) => s.id === id);
const segD = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
};
const inPoly = ([x, z], poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const edgeD = (p, poly) => Math.min(...poly.map((a, i) => segD(p, a, poly[(i + 1) % poly.length])));
/** The footprint's corners (and centre) in world x/z. */
const corners = (s) => {
  const c = Math.cos(s.rot ?? 0), n = Math.sin(s.rot ?? 0), w = s.w / 2, d = s.d / 2;
  return [[0, 0], [-w, -d], [w, -d], [w, d], [-w, d]].map(([u, v]) => [s.x + u * c - v * n, s.z + u * n + v * c]);
};
/** Distance from a point to the footprint rect (0 inside). */
const rectD = (s, [x, z]) => {
  const c = Math.cos(s.rot ?? 0), n = Math.sin(s.rot ?? 0), dx = x - s.x, dz = z - s.z, u = dx * c + dz * n, v = -dx * n + dz * c;
  return Math.hypot(Math.max(Math.abs(u) - s.w / 2, 0), Math.max(Math.abs(v) - s.d / 2, 0));
};

test('art m20 p2: every dressing piece is in the mission, fixed, drawn by its own builder and never a library crate', () => {
  assert.ok(M20_DRESSING.length >= 9);
  for (const d of M20_DRESSING) {
    const s = S(d.id);
    assert.ok(s, d.id);
    assert.equal(s.fixed, true, `${d.id} fixed (the placement rules never move it off its level)`);
    assert.equal(typeof M20_DRESSING_BUILDERS[s.variant], 'function', `${d.id}: a builder for ${s.variant}`);
    assert.ok(M20_DRESSING_VARIANTS.has(s.variant));
    assert.equal(VARIANT_HINTS.crates[s.variant], null, `${s.variant}: no library pick`);
  }
});

test('art m20 p2: the dressing keeps 3 m off every post, beat, spawn, link end and the tank\'s road; off the roads', () => {
  const pts = [], lines = [];
  for (const e of m20.enemies) {
    pts.push([e.x, e.z]);
    const r = e.route?.points || [];
    for (let k = 0; k + 1 < r.length; k++) lines.push([[r[k].x, r[k].z], [r[k + 1].x, r[k + 1].z]]);
  }
  for (const c of m20.commandos) pts.push([c.x, c.z]);
  for (const l of m20.ladders || []) pts.push([l.x, l.z], [l.top[0], l.top[1]]);
  for (const c of m20.climbLinks || []) pts.push([c.a[0], c.a[1]], [c.b[0], c.b[1]]);
  for (let k = 0; k + 1 < ROAD_IN.length; k++) lines.push([ROAD_IN[k], ROAD_IN[k + 1]]);
  for (const d of M20_DRESSING) {
    const s = S(d.id);
    const near = Math.min(...pts.map((p) => rectD(s, p)));
    assert.ok(near >= 3, `${s.id}: ${near.toFixed(2)} m from a post / spawn / link`);
    // a beat or a road line: sampled every 0.25 m against the footprint
    for (const [a, b] of lines) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 0; t <= L; t += 0.25) {
        const p = [a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L];
        assert.ok(rectD(s, p) >= 3, `${s.id}: ${rectD(s, p).toFixed(2)} m from a beat / the tank road at (${p[0].toFixed(1)}, ${p[1].toFixed(1)})`);
      }
    }
    for (const t of m20.terrain.filter((q) => q.type === 'path' && q.terrain === 'road')) {
      for (let k = 0; k + 1 < t.points.length; k++) for (const p of corners(s)) {
        assert.ok(segD(p, t.points[k], t.points[k + 1]) > t.width / 2 + 0.5, `${s.id}: on a road`);
      }
    }
  }
});

test('art m20 p2: raised pieces stand on their level (inside it, 0.6 m in from its edges); the ground ones on the ground', () => {
  for (const d of M20_DRESSING) {
    const s = S(d.id), level = s.baseY === Y.N ? T_N : s.baseY === Y.NE ? T_NE : null;
    if (!s.baseY) { for (const lv of [T_N, T_NE]) for (const p of corners(s)) assert.ok(!inPoly(p, lv), `${s.id} under a level`); continue; }
    assert.ok(level, `${s.id}: baseY ${s.baseY} names T_n or T_ne`);
    for (const p of corners(s)) assert.ok(inPoly(p, level) && edgeD(p, level) >= 0.6, `${s.id}: corner (${p.map((v) => v.toFixed(1))}) off its level`);
    assert.equal(s.block, 0, `${s.id}: raised cells carry no block (the drawn pieces are measured instead)`);
    assert.deepEqual(s.clipAllow, [s.baseY === Y.N ? 't_n' : 't_ne'], `${s.id}: stands on its level's flags (a bond, not a clip)`);
  }
  // the rampart crate pushed over the N range's cornice: on T_n now, and pinned
  const c = S('crates_n4');
  assert.equal(c.fixed, true);
  for (const p of corners(c)) assert.ok(inPoly(p, T_N) && edgeD(p, T_N) >= 0.6, `crates_n4 corner (${p}) off T_n`);
});

test('art m20 p2: the log piles lie outside the wood and clear of the rocks, B.LOW; the range pieces clear of the basin', () => {
  const forest = S('forest').points, rocks = m20.structures.filter((s) => s.type === 'rocks');
  for (const id of ['logs_ne1', 'logs_ne2']) {
    const s = S(id);
    assert.equal(s.block, 1, `${id} B.LOW`);
    for (const p of corners(s)) assert.ok(!inPoly(p, forest) && edgeD(p, forest) >= 3, `${id}: corner in or within 3 m of the forest`);
    for (const r of rocks) assert.ok(rectD(s, [r.x, r.z]) >= r.w / 2 + 1, `${id}: against ${r.id}`);
  }
  for (const id of ['rng_sandbags', 'rng_targets']) {
    const s = S(id);
    for (const p of corners(s)) assert.ok(p[0] < POOL.x - 0.9 || p[1] > POOL.z + POOL.d + 0.9 || p[1] < POOL.z - 0.9, `${id}: on the basin's coping`);
    assert.ok(rectD(s, [S('well').x, S('well').z]) >= S('well').r + 0.5, `${id}: against the well`);
  }
});

test('art m20 p2: every builder draws inside its footprint (+0.15 m) and on the ground (no part below it, none floating)', () => {
  for (const d of M20_DRESSING) {
    const s = S(d.id), g = M20_DRESSING_BUILDERS[s.variant]({ ...s, y0: 0, seed: s.id });
    g.updateMatrixWorld(true);
    let n = 0, minY = Infinity;
    const v = new THREE.Vector3();
    g.traverse((o) => {
      if (!o.isMesh) return;
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        n++; minY = Math.min(minY, v.y);
        assert.ok(rectD(s, [v.x, v.z]) <= 0.15, `${s.id}: a vertex ${rectD(s, [v.x, v.z]).toFixed(2)} m out of its footprint`);
        assert.ok(v.y <= s.h + 0.25, `${s.id}: ${v.y.toFixed(2)} m over its height ${s.h}`);
      }
    });
    assert.ok(n > 100, `${s.id}: ${n} vertices`);
    assert.ok(minY > -0.03 && minY < 0.05, `${s.id}: lowest point ${minY.toFixed(3)} (on the ground)`);
  }
});

test('art m20 p2: the HQ porch keeps the live AO only on its dressed stone (its baked AO drew the steps\' ends black)', () => {
  assert.equal(S('hq').dropAo, 'kit:limestone_smooth');
});
