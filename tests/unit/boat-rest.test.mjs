// Boats at rest on the ground (src/art/boat-rest.js): a hull on a bank, a beach or dry land rests on the drawn ground
// under it — never into it, pitched / rolled to the slope onto its contacts, not perched on one; afloat it keeps the
// floating pose; half beached, the land end lies on the shore and the water end floats.
import { test, assert, near } from './lib.mjs';
import { hullUnderside, hullUndersideTris, sampleXZ, restPose, boatRest, groundOf, waterOf, terrainReady, BEACHED, REST } from '../../src/art/boat-rest.js';
import { inPlan, HULL_PLANS } from '../../src/art/water/hulls.js';
import { T } from '../../src/world/grid.js';

/** A raft-like underside: the tube ring (bottom −0.08) and the floor (0.02), model space (+x left, +z bow). */
function raftPts() {
  const pts = [];
  for (let k = 0; k < 24; k++) { const a = (k / 24) * 2 * Math.PI; pts.push({ x: 0.5 * Math.cos(a), y: -0.08, z: 1.15 * Math.sin(a) }); }
  for (const z of [-0.6, 0, 0.6]) for (const x of [-0.2, 0.2]) pts.push({ x, y: 0.02, z });
  return pts;
}
const FLOAT = { h: -0.1, pitch: 0, roll: 0 };
/** Heights of the samples for a boatRest pose (the linear model it solves). */
const heights = (pts, r) => { const A = -Math.sin(r.pitch), B = Math.sin(r.roll) * Math.cos(r.pitch); return pts.map((p) => r.h + p.y + A * p.z + B * p.x); };
const pose = (pts, G, W = () => null, o = {}) => {
  const g = pts.map(G), w = pts.map(W), r = boatRest(pts, o.float || FLOAT, g, w, o);
  const y = heights(pts, r), gap = pts.map((p, i) => y[i] - g[i]);
  return { r, y, g, w, gap, minGap: Math.min(...gap) };
};
/** Is (0, c) inside the convex hull of the (x, z) points? */
function encloses(pts, c = [0, 0]) {
  const P = pts.map((p) => [p.x, p.z]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.slice().reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  const H = lo.slice(0, -1).concat(hi.slice(0, -1));
  if (H.length < 3) return false;
  for (let i = 0; i < H.length; i++) if (cross(H[i], H[(i + 1) % H.length], c) < -1e-9) return false;
  return true;
}

test('boat rest: on flat dry ground the hull sits on its tubes, level, not sunk by its draft', () => {
  const pts = raftPts(), { r, minGap, gap } = pose(pts, () => 0.3);
  near(r.pitch, 0, 1e-6, 'pitch'); near(r.roll, 0, 1e-6, 'roll');
  near(minGap, 0, 0.001, 'tube undersides on the ground');
  assert.ok(gap.every((d) => d > -0.001), 'nothing under the ground');
  near(r.h, 0.38, 0.001, 'waterline 8 cm above the ground (the tubes\' draft)');
  assert.ok(!r.afloat && r.grounded === 1);
});

test('boat rest: on a slope it pitches / rolls to the ground, every tube underside touching', () => {
  const pts = raftPts();
  for (const [sx, sz] of [[0, 0.25], [0.3, 0], [-0.2, -0.15]]) {
    const { r, gap } = pose(pts, (p) => 1 + sx * p.x + sz * p.z);
    assert.ok(gap.every((d) => d > -0.001), `slope ${sx},${sz}: nothing under the ground`);
    const tubes = gap.filter((d, i) => pts[i].y < 0);
    assert.ok(Math.max(...tubes) < 0.002, `slope ${sx},${sz}: the whole tube ring on the ground (max gap ${Math.max(...tubes).toFixed(4)})`);
    near(-Math.sin(r.pitch), sz, 1e-3, 'bow-up slope'); near(Math.sin(r.roll) * Math.cos(r.pitch), sx, 1e-3, 'left-up slope');
  }
});

test('boat rest: afloat the floating pose is kept exactly (bob, pitch, roll)', () => {
  const pts = raftPts(), float = { h: -0.07, pitch: 0.01, roll: -0.02 };
  const { r } = pose(pts, () => -1.5, () => -0.1, { float });
  assert.ok(r.afloat && r.grounded === 0);
  assert.equal(r.h, float.h); assert.equal(r.pitch, float.pitch); assert.equal(r.roll, float.roll);
  // over wet cells with no known bed (placeholder ground): afloat too
  const p2 = pose(pts, () => -Infinity, () => -0.1);
  assert.ok(p2.r.afloat && p2.r.h === -0.1);
});

test('boat rest: half beached — the stern rests on the bank, the bow floats, tilted between', () => {
  const pts = raftPts();
  // the bank rises aft of z = −0.3 (behind the centre of mass: it cannot lie on the bank), deep water forward of it
  const G = (p) => (p.z < -0.3 ? 0.1 * (-0.3 - p.z) - 0.02 : -0.5), W = (p) => (p.z < -0.3 ? null : -0.1);
  const { r, gap, y, g, w } = pose(pts, G, W);
  assert.ok(!r.afloat && r.grounded > 0.2 && r.grounded < 0.8, `partly grounded (${r.grounded.toFixed(2)})`);
  assert.ok(gap.every((d) => d > -0.001), 'nothing under the bank');
  assert.ok(r.pitch > 0.02, `bow down toward the water (${(r.pitch * 57.3).toFixed(1)}°)`);
  const land = pts.map((p, i) => i).filter((i) => w[i] == null), water = pts.map((p, i) => i).filter((i) => w[i] != null);
  assert.ok(Math.min(...land.map((i) => gap[i])) < 0.002, 'the stern touches the bank');
  // the bow end floats at its waterline (bottom at the water level − draft), not in the air or sunk
  const bowTip = water.reduce((a, i) => (pts[i].z > pts[a].z ? i : a), water[0]);
  near(y[bowTip], -0.1 - 0.08, 0.004, 'bow tube at its floating draft');
  // resting on contacts round its centre of mass (ground + water), not hovering on one
  const contacts = pts.filter((p, i) => y[i] - Math.max(g[i], w[i] != null ? -0.1 + p.y : -Infinity) < 0.003);
  assert.ok(encloses(contacts, [0, -0.08]), 'contacts enclose the centre');
});

test('boat rest: on a gentle bank holding its centre of mass it lies along the bank, the bow out over the water', () => {
  const pts = raftPts();
  const G = (p) => (p.z < 0.3 ? 0.1 * (0.3 - p.z) - 0.02 : -0.5), W = (p) => (p.z < 0.3 ? null : -0.1);
  const { r, gap, w } = pose(pts, G, W);
  assert.ok(gap.every((d) => d > -0.001), 'nothing under the bank');
  near(-Math.sin(r.pitch), -0.1, 0.002, 'along the bank\'s slope');
  const land = gap.filter((d, i) => w[i] == null && pts[i].y < 0);
  assert.ok(Math.max(...land) < 0.002, 'the tubes on the bank all touch it');
});

test('boat rest: a hump under the middle tips it onto its tubes instead of balancing on the hump', () => {
  const pts = raftPts();
  const { r, gap, y, g } = pose(pts, (p) => (Math.abs(p.z) < 0.05 && Math.abs(p.x) < 0.25 ? 0.15 : 0), () => null, { com: [0, -0.08] });
  assert.ok(gap.every((d) => d > -0.001), 'not through the hump');
  const contacts = pts.filter((p, i) => y[i] - g[i] < 0.003);
  assert.ok(contacts.length >= 3 && encloses(contacts, [0, -0.08]), `rests on contacts round its centre (${contacts.length})`);
  assert.ok(Math.abs(r.pitch) > 0.01, 'tipped over the hump');
});

test('boat rest: a keel boat on flat ground stays upright on its keel', () => {
  const pts = [];
  for (const z of [-1.5, -0.75, 0, 0.75, 1.5]) { pts.push({ x: 0, y: -0.2, z }); pts.push({ x: 0.55, y: 0, z }); pts.push({ x: -0.55, y: 0, z }); }
  const r = restPose(pts, pts.map(() => 0.5), {});
  near(r.h, 0.7, 0.001); near(r.A, 0, 1e-4); near(r.B, 0, 1e-4);
});

test('boat rest: steep ground — at most maxTilt, still out of the ground', () => {
  const pts = raftPts(), { r, gap } = pose(pts, (p) => 2 * p.z);
  assert.ok(Math.abs(Math.sin(r.pitch)) <= REST.maxTilt + 1e-9);
  assert.ok(gap.every((d) => d > -0.001), 'lifted clear when it cannot tilt further');
});

test('boat rest: soft tubes flatten a few millimetres (squash), never more', () => {
  const pts = raftPts(), { minGap } = pose(pts, () => 0, () => null, { squash: REST.squash.raft });
  near(minGap, -REST.squash.raft, 0.001);
  assert.ok(REST.squash.raft <= 0.01);
});

test('boat rest: underside samples — the lowest vertex per cell over the plan', () => {
  const verts = [];
  for (let x = -0.6; x <= 0.6001; x += 0.05) for (let z = -1.3; z <= 1.3001; z += 0.05) {
    verts.push([x, 0.4, z]); // the top
    verts.push([x, Math.abs(x) > 0.4 ? -0.08 : 0.02, z]); // tubes at the sides, floor between
  }
  const u = hullUnderside(verts, { nx: 6, nz: 13 });
  assert.equal(u.length, 6 * 13);
  assert.ok(u.every((p) => p.y <= 0.02), 'never the top');
  assert.ok(u.some((p) => p.y === -0.08) && u.some((p) => p.y === 0.02), 'tubes and floor');
  assert.deepEqual(hullUnderside([]), []);
});

test('boat rest: underside from triangles — a big flat face is sampled across, not only at its corners', () => {
  // a 1 × 2 m floor (two triangles) at 0.02 and a 10 cm-wide keel strip below it along x = 0
  const tris = [
    [-0.5, 0.02, -1, 0.5, 0.02, -1, 0.5, 0.02, 1], [-0.5, 0.02, -1, 0.5, 0.02, 1, -0.5, 0.02, 1],
    [-0.05, -0.1, -1, 0.05, -0.1, -1, 0.05, -0.1, 1], [-0.05, -0.1, -1, 0.05, -0.1, 1, -0.05, -0.1, 1],
  ];
  const u = hullUndersideTris(tris);
  assert.ok(u.length >= 150, `the floor covered (${u.length} samples)`);
  assert.ok(u.some((p) => Math.abs(p.x) < 0.3 && Math.abs(p.x) > 0.15 && Math.abs(p.z) < 0.2 && p.y === 0.02), 'a sample in the middle of the floor');
  assert.ok(u.filter((p) => p.y < 0).every((p) => Math.abs(p.x) <= 0.1 + 1e-9), 'the keel where it is');
  // a long hull: coarser cells, about 400 samples at most (whole cells round the plan)
  const big = [[-1.5, -1, -7, 1.5, -1, -7, 1.5, -1, 7], [-1.5, -1, -7, 1.5, -1, 7, -1.5, -1, 7]];
  assert.ok(hullUndersideTris(big).length <= 480);
});

test('boat rest: samples to world — the model\'s +x is the boat\'s left, +z its bow', () => {
  const o = sampleXZ({ x: 1, y: 0, z: 2 }, 10, 20, 0); // heading 0 = east: bow +x, left = −z
  near(o.x, 12, 1e-9); near(o.z, 19, 1e-9);
  const b = sampleXZ({ x: 0, y: 0, z: 1 }, 0, 0, Math.PI / 2, 0.5); // heading south (+z): left = +x
  near(b.x, 0.5, 1e-9); near(b.z, 1, 1e-9);
});

test('boat rest: ground and water under a hull from the world (placeholder ground: no bed under wet cells)', () => {
  const terr = new Uint8Array(4); terr[1] = T.WATER; terr[2] = T.SHALLOW;
  const grid = { terrainAt: (x) => terr[Math.max(0, Math.min(3, Math.floor(x)))] };
  const w = { grid, groundY: () => 0.2, water: { level: -0.1 } };
  assert.ok(!terrainReady(w));
  const G = groundOf(w), W = waterOf(w);
  assert.equal(G(0.5, 0), 0.2); assert.equal(G(1.5, 0), -Infinity); assert.equal(G(2.5, 0), -Infinity);
  assert.equal(W(0.5, 0), null); assert.equal(W(1.5, 0), -0.1);
  // the drawn terrain once built: its surface everywhere (the bed too), the water system's own level per body
  const real = { grid, real: true, terrain: { terrain: {}, real: true, surfaceAt: (x) => -x }, water: { level: -0.1, sample: (x) => (x > 1 ? { level: 0.4 } : null) } };
  real.terrain.terrain = {}; real.terrain.real = true;
  const w2 = { ...real, terrain: real.terrain };
  assert.ok(terrainReady(w2));
  assert.equal(groundOf(w2)(1.5, 0), -1.5);
  assert.equal(waterOf(w2)(1.5, 0), 0.4); assert.equal(waterOf(w2)(0.5, 0), null);
  assert.ok(BEACHED.has('raft') && BEACHED.has('rowboat') && !BEACHED.has('patrolboat'));
});

test('dry hulls: a hull lifted onto a bank keeps the water under its bottom (the plan stops below the tubes / keel)', () => {
  const R = HULL_PLANS.raft, W = HULL_PLANS.rowboat;
  assert.ok(inPlan(R, 0, 0, 0) && inPlan(R, 0, 0, -0.08), 'afloat: water at the tubes\' bottom inside');
  assert.ok(!inPlan(R, 0, 0, -0.1), 'below the tubes: drawn');
  assert.ok(inPlan(W, 0, 0, -0.18) && !inPlan(W, 0, 0, -0.25), 'rowboat: down to its keel');
  assert.ok(inPlan(HULL_PLANS.patrolboat, 0, 0, -5), 'decked boats unchanged');
});

test('raft paddles in their rowlocks: the blade swings up onto the bank, never into it; afloat they hang as before', async () => {
  const THREE = await import('three');
  const { rowlockFit, BLADE_CLEAR } = await import('../../src/art/boat-crew.js');
  // a paddle node at its rowlock (hull space −0.6, 0.32, −0.55), shaft out and down to its blade 1.05 m away (raft.py)
  const hull = new THREE.Group(), node = new THREE.Group();
  node.position.set(-0.6, 0.32, -0.55); hull.add(node);
  const d = new THREE.Vector3(-0.85, -0.42, -0.3).normalize();
  const geo = new THREE.BoxGeometry(0.04, 0.04, 1.6).translate(0, 0, 0.25); // −0.55 … 1.05 along +z, then aimed along d
  const mesh = new THREE.Mesh(geo); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d); node.add(mesh);
  hull.position.set(10, 0.5, 20); hull.updateMatrixWorld(true);
  const vis = { parts: { paddle_r: node } };
  const fit = rowlockFit(vis, 'paddle_r');
  assert.ok(fit && fit.blade > 0);
  const lowest = (a) => {
    node.quaternion.copy(fit.quat(a)); hull.updateMatrixWorld(true);
    const p = new THREE.Vector3(), pos = geo.attributes.position; let y = Infinity;
    for (let i = 0; i < pos.count; i++) { p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); y = Math.min(y, p.y); }
    node.quaternion.identity(); hull.updateMatrixWorld(true);
    return y;
  };
  const tip0 = lowest(0); // ≈ 0.5 + 0.32 − 0.42 ≈ 0.38 (− the box's half-thickness)
  assert.equal(fit.lift(() => -5), 0, 'over the water / a deep bed: hangs as before');
  const bank = tip0 + 0.1, a = fit.lift(() => bank);
  assert.ok(a > 0.05 && a < 1.4, `swung up (${a.toFixed(3)} rad)`);
  assert.ok(lowest(a) >= bank + BLADE_CLEAR - 0.004, `blade on the bank (${(lowest(a) - bank).toFixed(4)} m over it)`);
  assert.ok(lowest(a * 0.8) < bank + BLADE_CLEAR, 'no higher than it needs');
});
