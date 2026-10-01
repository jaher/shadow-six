/**
 * Closed enclosures (user report "Level 2 the fence is not fully closed"): placement rule (a) only cuts a wall /
 * fence where a solid stands ON it, and enclosureGaps() finds every drawn-run hole nothing explains. The GPU side
 * (tests/enclosure.test.mjs) runs the same check on the real visual shapes and against the nav grid.
 */
import { test, assert } from './lib.mjs';
import { rectPoly } from '../../src/world/placement-geom.js';
import { resolvePlacement, enclosureGaps } from '../../src/world/placement.js';
import { MISSIONS } from '../../src/missions/index.js';

const wall = { id: 'w', type: 'wall', points: [[0, 10], [30, 10]], width: 0.5, h: 3 };
const hut = (id, x, z) => ({ id, type: 'hut', x, z, w: 6, d: 4, rot: 0, h: 3 });

test('enclosure: a hut beside a wall whose snow skirt reaches over the line does not cut it (M2 sbox_se / barr_out)', () => {
  // body (0.3–1.8 m) stops 0.15 m short of the wall face; the ground skirt ('low' band) crosses the centreline
  const shapeOf = (def, k, band) => (def.id !== 'h' ? null
    : band === 'body' ? [rectPoly(15, 12.4, 6, 4)] : [rectPoly(15, 11.9, 7, 5)]);
  const res = resolvePlacement([hut('h', 15, 12.4), wall], { shapeOf });
  const w = res.structures[1];
  assert.ok(!w.visualRuns || (w.visualRuns.length === 1 && w.visualRuns[0].length === 2), 'wall drawn whole');
  assert.ok(!res.log.some((l) => /run w: .*cut/.test(l)), res.log.join('\n'));
  assert.deepEqual(enclosureGaps(res.records), []);
});

test('enclosure: a hut standing on the wall cuts it exactly at its body; the cut is explained (no gap)', () => {
  const res = resolvePlacement([hut('h', 15, 10), wall]);
  assert.equal(res.structures[1].visualRuns.length, 2);
  const cut = res.structures[1].visualRuns.map((r) => r.map((p) => p[0]));
  assert.ok(Math.abs(cut[0][1] - (12 - 0.25 - 0.06)) < 0.02 && Math.abs(cut[1][0] - (18 + 0.25 + 0.06)) < 0.02, JSON.stringify(cut));
  assert.deepEqual(enclosureGaps(res.records), []);
});

test('enclosure: a hole in the drawn run that no solid explains is reported with its extent', () => {
  const res = resolvePlacement([hut('h', 15, 13), wall]); // the hut stands 0.75 m off the wall face
  const rec = res.records.find((r) => r.id === 'w');
  rec.def.visualRuns = [[[0, 10], [11.69, 10]], [[18.31, 10], [30, 10]]]; // the old rule's cut beside the hut
  const g = enclosureGaps(res.records);
  assert.equal(g.length, 1, JSON.stringify(g));
  assert.equal(g[0].id, 'w');
  assert.ok(Math.abs(g[0].len - 6.6) < 0.25, `gap length ${g[0].len}`);
});

test('enclosure: every wall / fence of every mission is closed except at declared openings (data shapes)', () => {
  for (const m of MISSIONS) {
    const res = resolvePlacement(m.structures || [], { vehicles: m.vehicles, terrain: m.terrain, items: m.items, interactables: m.interactables });
    assert.deepEqual(enclosureGaps(res.records), [], m.id);
  }
});

// verifier (M2 gate_se): the gate's padded cell body cut the palisade ~1 m short of each post — a see-through slot
// beside the gate that the nav line still blocked, and that enclosureGaps() counted as explained
const pal = { id: 'p', type: 'wall', variant: 'palisade_wire', width: 0.5, h: 3, segments: [[[0, 10], [10, 10]], [[14, 10], [24, 10]]] };
const gateAt = (body) => ({ shapeOf: (def, k, band) => (def.id === 'g' ? [rectPoly(...body)] : null) });

test('enclosure: a palisade meets a gate filling its declared opening post-to-post (flush stakes, no hw slot)', () => {
  const g = { id: 'g', type: 'gate', variant: 'barrier_boom', x: 12, z: 10, rot: 0, w: 4 };
  const res = resolvePlacement([pal, g], gateAt([12, 10, 4, 0.3])); // the gate mesh spans exactly the 4 m opening
  const runs = res.structures[0].visualRuns || pal.segments;
  const ends = runs.map((r) => [r[0][0], r[r.length - 1][0]]);
  assert.ok(ends.some(([, b]) => Math.abs(b - (10 - 0.06)) < 0.02 || Math.abs(b - 10) < 1e-9), JSON.stringify(ends));
  assert.ok(ends.some(([a]) => Math.abs(a - (14 + 0.06)) < 0.02 || Math.abs(a - 14) < 1e-9), JSON.stringify(ends));
  assert.deepEqual(enclosureGaps(res.records), []);
});

test('enclosure: a run cut short beside an in-line gate is a reported slot (not explained by the gate)', () => {
  const g = { id: 'g', type: 'gate', variant: 'barrier_boom', x: 12, z: 10, rot: 0, w: 4 };
  const res = resolvePlacement([pal, g], gateAt([12, 10, 4, 0.3]));
  const rec = res.records.find((r) => r.id === 'p');
  rec.def.visualRuns = [[[0, 10], [9, 10]], [[14.6, 10], [24, 10]]]; // the old cut: 1 m / 0.6 m short of the posts
  const gaps = enclosureGaps(res.records).map((x) => x.len).sort((a, b) => a - b);
  assert.equal(gaps.length, 2, JSON.stringify(gaps));
  assert.ok(Math.abs(gaps[0] - 0.5) < 0.15 && Math.abs(gaps[1] - 0.9) < 0.15, JSON.stringify(gaps));
});
