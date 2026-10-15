/**
 * The raft's floor joined to its tube (user 2026-10-15: "When the inflatable raft is inflated there should not be water
 * or the ground inside it" — "it looks like the raft has a hole in the front?"): art/raft-hull.js floorRimY /
 * raftFloorFix, tools/blender/vehicles/naval/scripts/raft.py floor_z. raft.py laid the floor flat 2 cm above the
 * waterline at 0.8 × / 0.93 × the tube's centreline; toward the bow the tube rises 14 cm and the floor's end lay below
 * the tube's underside: a slot under the bow tube the eye looked through. The rim must be inside the tube all round.
 */
import { test, assert, near } from './lib.mjs';
import { HULL, FLOOR_SEAT, floorRimY, tubeLoop } from '../../src/art/raft-hull.js';

/** raft.py loop_path (n points): the tube's centreline in model space (+x left, y up, +z bow). */
function loopPath(n = 40) {
  const a = HULL.L / 2 - HULL.R, b = HULL.B / 2 - HULL.R, pts = [];
  for (let i = 0; i < n; i++) {
    const t = 2 * Math.PI * i / n;
    const yb = a * Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** 0.35;
    let xb = b * Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** 0.8;
    if (yb < 0) xb *= 1 - 0.18 * (-yb / a) ** 3;
    const zb = HULL.ZC + (yb < 0 ? 0.14 * Math.max(0, (-yb - a * 0.4) / (a * 0.6)) ** 2 : 0);
    pts.push({ x: xb, y: zb, z: -yb });
  }
  return pts;
}

/** Distance of a model point from the tube's centreline (m). */
function fromCentreline(x, y, z) {
  const L = tubeLoop();
  let bd = Infinity;
  for (let i = 0; i < L.n; i++) bd = Math.min(bd, (L.P[i * 3] - x) ** 2 + (L.P[i * 3 + 1] - y) ** 2 + (L.P[i * 3 + 2] - z) ** 2);
  return Math.sqrt(bd);
}

/** The floor's rim as raft.py lays it out (0.8 × / 0.93 × the centreline). */
const rim = () => loopPath(40).map((p) => ({ x: p.x * 0.8, z: p.z * 0.93 }));

test('raft floor: the flat floor of the old GLB ended outside the raised bow tube (the hole in the front)', () => {
  const out = rim().filter((q) => fromCentreline(q.x, HULL.ZF, q.z) > HULL.R);
  assert.ok(out.length >= 3, `rim points outside the tube with the floor flat: ${out.length}`);
  assert.ok(out.every((q) => q.z > 0.9), 'all of them at the bow (+z)');
});

test('raft floor: the rim swept up into the bow is inside the tube all round, at least 1.5 cm under its skin', () => {
  for (const q of rim()) {
    const y = floorRimY(q.x, q.z), d = fromCentreline(q.x, y, q.z);
    assert.ok(d < HULL.R - 0.015, `rim (${q.x.toFixed(2)}, ${y.toFixed(3)}, ${q.z.toFixed(2)}) ${(d / HULL.R).toFixed(2)} R from the centreline`);
  }
});

test('raft floor: flat where the crew kneel, a ramp only in the last ~0.3 m of the bow, the stern unchanged', () => {
  const r = rim();
  for (const q of r) {
    const y = floorRimY(q.x, q.z);
    if (q.z < 0.75) near(y, HULL.ZF, 1e-9, `flat at z ${q.z.toFixed(2)}`);
  }
  const tip = r.reduce((m, q) => (q.z > m.z ? q : m), r[0]);
  const yTip = floorRimY(tip.x, tip.z);
  assert.ok(yTip > 0.08 && yTip < 0.14, `the bow tip rim raised to ${yTip.toFixed(3)} m`);
  // (rising toward the tip along each side of the rim)
  for (const side of [1, -1]) {
    let last = -1;
    for (const q of r.filter((p) => p.z > 0.5 && p.x * side >= 0).sort((p, q) => p.z - q.z)) {
      const y = floorRimY(q.x, q.z);
      assert.ok(y >= last - 1e-9, `rising toward the bow at z ${q.z.toFixed(2)} (side ${side})`); last = y;
    }
  }
  assert.equal(floorRimY(0.3, -1.0), HULL.ZF, 'the stern end stays flat (its tube is not raised)');
  assert.ok(FLOOR_SEAT > 0 && FLOOR_SEAT < HULL.R, 'seat depth inside the tube');
});
