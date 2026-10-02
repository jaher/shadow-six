// Dry hulls (src/art/water/hulls.js): each boat's waterline plan is cut out of the water and the waves are laid down
// round it. The plans must cover the hull's inside (the raft's floor, the rowboat's bilge) and stay inside its outer
// skin at every height (a plan wider than the hull would open a dry hole in the water beside it).
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { HULL_PLANS, MAX_DRY_HULLS, CALM, planAt, inPlan, dryHullOf, inDryHull, calmAt, packDryHulls, dryHullUniforms } from '../../src/art/water/hulls.js';

/** Plan half-beam at u (null past the ends). */
const halfBeam = (P, u, z = 0) => { const [aF, aA, b] = planAt(P, z), a = u >= 0 ? aF : aA; return Math.abs(u) >= a ? null : b * (1 - Math.abs(u / a) ** P.pu) ** (1 / P.pv); };

/** raft.py loop_path: the buoyancy tube's centreline (Blender: -Y = bow), as hull-frame (u forward, v side) points. */
function raftCentreline(n = 80) {
  const L = 2.7, B = 1.3, R = 0.19, a = L / 2 - R, b = B / 2 - R, out = [];
  for (let i = 0; i < n; i++) {
    const t = 2 * Math.PI * i / n;
    const y = a * Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** 0.35;
    let x = b * Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** 0.8;
    if (y < 0) x *= 1 - 0.18 * (-y / a) ** 3;
    out.push({ u: -y, v: x });
  }
  return out;
}

test('dry hulls: the raft plan takes in the whole floor and stays under the tube', () => {
  const P = HULL_PLANS.raft;
  for (const c of raftCentreline()) {
    // floor_poly: 0.8 × the centreline across, 0.93 along (a hair inside its edge)
    assert.ok(inPlan(P, c.u * 0.93 * 0.99, c.v * 0.8 * 0.99), `floor vertex (${c.u.toFixed(2)}, ${c.v.toFixed(2)}) inside the plan`);
    // 12 cm outside the centreline (the tube covers ±15 cm of it at the waterline) is never cut out
    const r = Math.hypot(c.u, c.v), k = (r + 0.12) / r;
    assert.ok(!inPlan(P, c.u * k, c.v * k), `outside the tube at (${(c.u * k).toFixed(2)}, ${(c.v * k).toFixed(2)})`);
  }
  assert.ok(inPlan(P, 0, 0) && !inPlan(P, 1.4, 0) && !inPlan(P, 0, 0.7), 'centre in, beyond the tubes out');
});

// rowboat.py hull lines: outer skin half-breadth at height z (rows) and u = 0, 0.6, 1.0, 1.3, 1.5, 1.7 m from amidships
const ROWBOAT_SKIN = { '-0.08': [0.392, 0.342, 0.262, 0.172, 0.099, 0], 0: [0.494, 0.442, 0.36, 0.261, 0.171, 0.063],
  0.12: [0.594, 0.547, 0.466, 0.36, 0.256, 0.129], 0.2: [0.642, 0.596, 0.518, 0.411, 0.301, 0.165] };
const US = [0, 0.6, 1.0, 1.3, 1.5, 1.7];

test('dry hulls: the rowboat plan follows its flared lines, inside the skin and up to the inner skin amidships', () => {
  const P = HULL_PLANS.rowboat;
  for (const [zs, row] of Object.entries(ROWBOAT_SKIN)) {
    const z = +zs;
    US.forEach((u, k) => {
      for (const s of [1, -1]) { // bow and stern (double-ended)
        const hb = halfBeam(P, s * u, z);
        if (row[k] <= 0.005) { assert.ok(hb == null || hb < 0.01, `no plan past the stem at u ${s * u}, z ${z}`); continue; }
        assert.ok(hb != null && hb <= row[k] - 0.005, `z ${z} u ${s * u}: plan ${hb?.toFixed(3)} inside the skin ${row[k]}`);
      }
    });
    assert.ok(halfBeam(P, 0, z) >= row[0] - 0.022 - 0.02, `z ${z}: the plan reaches the inner skin amidships (${halfBeam(P, 0, z).toFixed(3)})`);
  }
  // the flare: wider as the water climbs the topsides
  assert.ok(halfBeam(P, 0, 0.2) > halfBeam(P, 0, 0) && halfBeam(P, 0, 0) > halfBeam(P, 0, -0.08));
});

test('dry hulls: only floating boats with a plan, as drawn (bob, pitch, heading), wrecks take water', () => {
  const vis = new THREE.Group(), root = new THREE.Group(), body = new THREE.Group();
  root.add(body); body.add(vis);
  const v = { def: { kind: 'boat' }, alive: true, destroyed: false,
    model: { library: true, libType: 'raft', isReady: true, root, visual: { object3d: vis } } };
  root.position.set(10, -0.13, 20); root.rotation.y = Math.PI / 2; // bow (+z model) → world +x
  const d = dryHullOf(v);
  assert.ok(d, 'raft has a dry plan');
  assert.ok(inDryHull(d, 10, -0.1, 20), 'centre');
  assert.ok(inDryHull(d, 11.0, -0.1, 20) && !inDryHull(d, 10, -0.1, 21.0), 'bow along world +x, beam along z');
  assert.ok(!inDryHull(d, 11.5, -0.1, 20), 'past the bow');
  assert.equal(calmAt(d, 10, -0.1, 20), 1, 'still water at the hull');
  assert.equal(calmAt(d, 10, -0.1, 20 + 0.46 + CALM[1] + 0.01), 0, 'full waves beyond the calm ring');
  const mid = calmAt(d, 10, -0.1, 20 + 0.46 + (CALM[0] + CALM[1]) / 2);
  assert.ok(mid > 0.3 && mid < 0.7, `calm fades between (${mid.toFixed(2)})`);
  assert.equal(dryHullOf({ ...v, destroyed: true }), null, 'deflated / wrecked');
  assert.equal(dryHullOf({ ...v, model: { ...v.model, isReady: false } }), null, 'model still loading');
  assert.equal(dryHullOf({ ...v, model: { ...v.model, libType: 'minisub' } }), null, 'the mini-sub runs awash');
  assert.equal(dryHullOf({ ...v, def: { kind: 'land' } }), null, 'not a boat');
  root.visible = false;
  assert.equal(dryHullOf(v), null, 'hidden');
});

test('dry hulls: packed into the shader uniforms, nearest the view first, capped', () => {
  const U = dryHullUniforms();
  const mk = (x) => ({ inv: new THREE.Matrix4().makeTranslation(-x, 0.1, 0), plan: HULL_PLANS.rowboat, x, z: 0 });
  const list = Array.from({ length: MAX_DRY_HULLS + 3 }, (_, k) => mk(100 - k * 10));
  assert.equal(packDryHulls(list, U, 0, 0), MAX_DRY_HULLS);
  assert.equal(U.dryN.value, MAX_DRY_HULLS);
  assert.equal(-U.dryM.value[0].elements[12], 0, 'nearest (x 0) first');
  const P = HULL_PLANS.rowboat;
  assert.deepEqual(U.dryB.value[0].toArray(), [P.pu, P.pv, P.z0, P.z1]);
  assert.ok(U.dryA.value[0].w >= planAt(P, P.z1)[0], 'bounding radius covers the widest plan');
  assert.equal(packDryHulls([], U), 0);
  assert.equal(U.dryN.value, 0);
});
