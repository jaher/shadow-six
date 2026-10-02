/**
 * A body at rest stays put (the user, 2026-10-01: "When you leave a body close to a rock it starts moving/jerking").
 * Headless (grid + Rapier, no meshes): the settle ragdoll never starts inside a collider (a rock's nav-footprint
 * cuboid is larger than the rock): a body laid there starts on the nearest spot with room and the model glides
 * there, so the solver never shoves it; a body put down by a carrier is laid where that room is (aside, not turned);
 * the live pose record keys its base exactly like the baked one (a changed key popped the drawn body on the frame it
 * settled); a corpse on his back is shaped with his hands flung out past his head.
 */
import { test, assert } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { Entity } from '../../src/entities/entity.js';
import { createPhysics } from '../../src/physics/world-physics.js';
import { liveView, poseRecord } from '../../src/physics/ragdoll.js';
import { dropSpot } from '../../src/abilities/common.js';
import { BODY, bodyGap, clearPose, armsCapsule, deadStance } from '../../src/world/body-clearance.js';

/** 60 × 60 grass, a 7 × 4 m rock block (nav footprint, B.HIGH: a 3.2 m STATIC cuboid in Rapier) at (30, 30). */
async function rockSim(extra = {}) {
  Entity.nextId = 1;
  const s = makeSim({
    size: [60, 60], commandos: [{ role: 'greenberet', x: 10, z: 50 }], enemies: [guard('v', 20, 50, 0)],
    structures: [{ id: 'rock', type: 'rocks', x: 30, z: 30, rot: 0, w: 7, d: 4, h: 2.5 }], ...extra,
  }, { brains: false });
  s.world.physics = await createPhysics(s.world);
  return s;
}

/** Kill `e` where he stands, run the death through (settle and bake), then put him at (x, z, h) as a fresh body. */
function corpseAt(s, e, x, z, h) {
  e.die('test', null);
  s.run(5);
  e.bodyPose = null; e.settled = false;
  e.x = x; e.z = z; e.heading = h; e.prevHeading = h;
  return e;
}

test('body rest: a body laid inside a rock\'s collider starts its settle with room (glide), then never slides', async () => {
  const s = await rockSim(), w = s.world, P = w.physics, e = s.world.enemies[0];
  // on his back with the head end towards the rock's west face (x = 26.5): pelvis spot 1.1 m out, the head inside
  corpseAt(s, e, 25.4, 30, Math.PI);
  assert.ok(w.grid.walkableAt(e.x, e.z), 'his spot itself is walkable');
  assert.ok(!P.lyingFits(e.x, e.z, 0, e.heading, false), 'the lying pose there starts inside the rock collider');
  const x0 = e.x, z0 = e.z;
  const rd = P.startRagdoll(e, 'settle', { prone: false });
  assert.ok(rd, 'settle ragdoll');
  const moved = Math.hypot(e.x - x0, e.z - z0);
  assert.ok(moved > 0.05 && moved <= 1.5 + 1e-6, `shifted to the nearest spot with room (${moved.toFixed(2)} m)`);
  assert.ok(P.lyingFits(e.x, e.z, 0, e.heading, false), 'room there');
  assert.ok(rd.glide && Math.abs(rd.glide.x + (e.x - x0)) < 1e-9 && Math.abs(rd.glide.z + (e.z - z0)) < 1e-9, 'the model glides from where he was laid');
  const v = liveView(rd);
  assert.deepEqual(v.g, [rd.glide.x, rd.glide.z], 'the live pose record carries the glide');
  const x1 = e.x, z1 = e.z, t0 = w.time;
  assert.ok(s.run(8, () => e.settled), 'settles');
  assert.ok(w.time - t0 < 3, `within 3 s (${(w.time - t0).toFixed(2)} s; inside the collider it thrashed to the 6 s timeout)`);
  assert.ok(Math.hypot(e.x - x1, e.z - z1) < 0.05, `no slide while settling (${Math.hypot(e.x - x1, e.z - z1).toFixed(3)} m)`);
});

test('body rest: the same body with room keeps its spot (no shift, no glide)', async () => {
  const s = await rockSim(), P = s.world.physics, e = s.world.enemies[0];
  corpseAt(s, e, 22, 30, Math.PI);
  assert.ok(P.lyingFits(e.x, e.z, 0, e.heading, false));
  const rd = P.startRagdoll(e, 'settle', { prone: false });
  assert.ok(rd && !rd.glide && e.x === 22 && e.z === 30);
  assert.equal(liveView(rd).g, null);
});

test('body rest: the live pose record keys its base exactly like the baked one (no pop on the frame it settles)', async () => {
  const s = await rockSim(), P = s.world.physics, e = s.world.enemies[0];
  // an anchor and heading with more decimals than the record keeps
  corpseAt(s, e, 21.123456789, 40.987654321, 2.718281828);
  const rd = P.startRagdoll(e, 'settle', { prone: false });
  s.run(0.4);
  const v = liveView(rd), rec = poseRecord(rd);
  assert.deepEqual(v.a, rec.a, 'anchor');
  assert.deepEqual(Array.from(v.s), rec.s, 'spawn rotations');
  assert.deepEqual(v.p0, rec.p0, 'spawn pelvis');
  assert.equal(`${v.mode}:${v.a.join(',')}`, `${rec.mode}:${rec.a.join(',')}`, 'the model\'s base key');
});

test('body rest: a body put down facing the rock is laid aside where the lying pose has room, not turned', async () => {
  const s = await rockSim(), w = s.world, P = w.physics, gb = s.cmd('greenberet'), e = s.world.enemies[0];
  e.die('test', null); s.run(5);
  // the Green Beret 1.2 m from the west face, facing it: the body would go down at his feet ahead, head into the rock
  gb.x = 25.3; gb.z = 30; gb.heading = 0;
  gb.carrying = e; gb.carryMode = 'shoulder'; e.carriedBy = gb; e.state = 'carried';
  const h = gb.heading + Math.PI;
  const plain = { x: gb.x + 0.6, z: gb.z };
  assert.ok(!P.lyingFits(plain.x, plain.z, 0, h, false), 'no room at his feet');
  const p = dropSpot(gb, 'gentle');
  assert.ok(P.lyingFits(p.x, p.z, 0, p.heading ?? h, false), `room at the drop spot ${JSON.stringify(p)}`);
  assert.ok(Math.abs(Math.atan2(Math.sin((p.heading ?? h) - h), Math.cos((p.heading ?? h) - h))) < 1e-9, 'laid aside, not swung round');
  assert.ok(w.grid.walkableAt(p.x, p.z));
});

test('body rest: a corpse on his back is shaped heels ahead, head and flung-out hands behind', () => {
  assert.equal(deadStance('stand'), 'dead');
  assert.equal(deadStance('crawl'), 'dead_prone');
  const A = armsCapsule(10, 10, 0, 'dead');
  assert.ok(Math.abs(A.ax - (10 - BODY.dead.arms.at)) < 1e-9 && Math.abs(A.bx - A.ax) < 1e-9, 'the arms bar lies across the body');
  assert.ok(Math.abs(Math.abs(A.az - A.bz) / 2 + A.r - BODY.dead.arms.half) < 1e-9, 'half span');
  assert.equal(armsCapsule(10, 10, 0, 'dead_prone'), null);
  // a crate 1.45 m behind him and 0.55 m to his side: clear of the body's axis, but under his hand
  const s = { bodySolids: null };
  const world = { vehicles: [], interactables: [], grid: null, ...s };
  const R = { x: 10 - 1.45, z: 10 + 0.55 + 0.3, h: 0, hl: 0.25, hw: 0.25 };
  world.bodySolids = { list: [{ owner: null, R, gone: false }], buckets: new Map([[Math.floor(R.x / 4) * 65536 + Math.floor(R.z / 4), [0]]]), version: 1, masks: new Map() };
  assert.ok(bodyGap(world, 10, 10, 0, 'dead') < 0, `the hand is in the crate (${bodyGap(world, 10, 10, 0, 'dead')})`);
  assert.ok(bodyGap(world, 10, 10, 0, 'dead_prone') > 0, 'a crawler-shaped body would have missed it');
});

test('body rest: clearPose — an extra fit test, and the nearest spot with the same heading before any turn', () => {
  const world = { vehicles: [], interactables: [], bodySolids: null, grid: { walkableAt: () => true } };
  // nothing solid; the fit test rejects everything within 0.4 m of the start
  const fits = (x, z) => Math.hypot(x - 10, z - 10) > 0.4;
  const cp = clearPose(world, 10, 10, 1, 'dead', { fits, shiftFirst: true, sweep: false });
  assert.ok(cp && cp.moved && cp.heading === 1 && fits(cp.x, cp.z), JSON.stringify(cp));
  assert.ok(Math.hypot(cp.x - 10, cp.z - 10) <= 0.5 + 1e-9, 'the nearest ring');
  // without options it behaves as before: free here, untouched
  assert.deepEqual(clearPose(world, 10, 10, 1, 'dead'), { x: 10, z: 10, heading: 1, moved: false });
});
