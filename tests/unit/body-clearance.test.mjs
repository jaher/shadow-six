/** Body clearance against vehicle hulls (src/world/body-clearance.js; docs/clipping-audit.md "Characters and vehicles"). */
import { test, assert } from './lib.mjs';
import { World } from '../../src/world/world.js';
import { createVehicle } from '../../src/entities/vehicle.js';
import { Commando } from '../../src/entities/commando.js';
import { Enemy } from '../../src/entities/enemy.js';
import {
  BODY, STOP_MARGIN, bodyCapsule, bodyShape, rectSDF, capsuleRectGap, hullRect, bodyGap, unitGap, clearPose, avoidMask, sweepClear,
} from '../../src/world/body-clearance.js';

const DT = 1 / 60;
function mkWorld() { const w = new World({ size: [60, 60] }); w.vehicleFactory = createVehicle; return w; }
function step(w, n = 1) {
  for (let k = 0; k < n; k++) {
    w.rebuildSpatial(); w.refreshDynamicOccluders();
    for (const c of [...w.commandos]) if (!c.removed) c.update(DT);
    for (const e of [...w.enemies]) if (!e.removed) e.update(DT);
    for (const v of [...w.vehicles]) if (!v.removed) v.update(DT);
    w.flushRemovals(); w.time += DT;
  }
}
const freeze = (e) => { if (e.brain) e.brain.update = () => {}; return e; };

test('body capsule: prone runs head to toes along the heading, standing is a disc', () => {
  const C = bodyCapsule(10, 10, 0, 'crawl');
  assert.ok(Math.abs(C.ax + C.r - (10 + BODY.prone.front)) < 1e-9 && Math.abs(C.bx - C.r - (10 - BODY.prone.back)) < 1e-9);
  assert.ok(C.az === 10 && C.bz === 10);
  const S = bodyCapsule(10, 10, 1.2, 'stand');
  assert.ok(Math.hypot(S.ax - S.bx, S.az - S.bz) < 1e-9, 'standing: a disc');
  for (const st of ['crawl', 'downed', 'dead_prone']) assert.equal(bodyShape(st), BODY.prone, st);
  assert.equal(bodyShape('dead'), BODY.dead, 'a corpse on his back: heels ahead, head and flung-out hands behind');
  assert.equal(bodyShape('crouch'), BODY.stand);
  // turned 90°: the long axis follows the heading
  const T = bodyCapsule(0, 0, Math.PI / 2, 'crawl');
  assert.ok(Math.abs(T.ax) < 1e-9 && T.az > 0.7 && T.bz < -0.6);
});

test('capsule vs oriented hull: gap, penetration, rotated rect corners', () => {
  const R = { x: 0, z: 0, h: 0, hl: 3, hw: 1.2 };
  assert.ok(Math.abs(rectSDF(4, 0, R) - 1) < 1e-9 && Math.abs(rectSDF(0, 0, R) + 1.2) < 1e-9);
  // lying parallel 0.5 m off the side: gap 0.5 - r
  const side = capsuleRectGap(bodyCapsule(0, 1.2 + 0.5, 0, 'crawl'), R);
  assert.ok(Math.abs(side - (0.5 - BODY.prone.r)) < 0.02, `side gap ${side}`);
  // pelvis 0.8 m off the end (a standing man's disc would clear it) but facing the hull: the head is under it
  assert.ok(capsuleRectGap(bodyCapsule(3.8, 0, Math.PI, 'stand'), R) > 0);
  const head = capsuleRectGap(bodyCapsule(3.8, 0, Math.PI, 'crawl'), R);
  assert.ok(head < 0, `facing the hull, head under (${head})`);
  // the same spot facing away: the toes reach 0.92 m back
  const away = capsuleRectGap(bodyCapsule(4.5, 0, 0, 'crawl'), R);
  assert.ok(Math.abs(away - (1.5 - BODY.prone.back)) < 0.03, `facing away ${away}`);
  // a rect corner poking at the middle of a body lying diagonally is caught (corner vs segment, not just samples)
  const Rr = { x: 0, z: 0, h: Math.PI / 4, hl: 1, hw: 1 };
  const corner = capsuleRectGap({ ax: 1.6, az: -1, bx: 1.6, bz: 1, r: 0.3 }, Rr);
  assert.ok(Math.abs(corner - (1.6 - Math.SQRT2 - 0.3)) < 0.02, `corner ${corner}`);
});

test('hull rect: the larger of the def size and the measured model, the vehicle pose', () => {
  const w = mkWorld();
  const v = w.spawnVehicle('truck', { x: 30, z: 30, heading: 0.4 });
  const R = hullRect(v);
  assert.ok(R.hl >= 3 && R.hw >= 1.2 && R.h === 0.4);
  v.model = { ...(v.model || {}), dims: { l: 7, w: 2 } };
  assert.equal(hullRect(v).hl, 3.5);
});

test('stop placement: the nearest pose with the whole body ≥ 0.1 m clear (turn in place, else a short move)', () => {
  const w = mkWorld();
  w.spawnVehicle('truck', { x: 30, z: 30, heading: 0 });
  // pelvis 0.75 m off the side, lying across the hull: head under; turning parallel clears it in place
  const h0 = Math.PI / 2 + Math.PI; // facing the hull (−z)
  assert.ok(bodyGap(w, 30, 31.95, h0, 'crawl') < 0);
  const cp = clearPose(w, 30, 31.95, h0, 'crawl', { sweep: false });
  assert.ok(cp && !cp.moved && bodyGap(w, cp.x, cp.z, cp.heading, 'crawl') >= STOP_MARGIN, JSON.stringify(cp));
  // turning there would swing the head through the hull → with sweep it moves instead (or turns the other way round)
  const cs = clearPose(w, 30, 31.95, h0, 'crawl');
  assert.ok(cs && bodyGap(w, cs.x, cs.z, cs.heading, 'crawl') >= STOP_MARGIN);
  if (!cs.moved) assert.ok(sweepClear(w, 30, 31.95, h0, cs.heading, 'crawl', 0.05));
  // deep under the hull: moved out to the nearest walkable clear spot
  const cu = clearPose(w, 30.5, 30.4, 0, 'crawl', { maxDist: 3 });
  assert.ok(cu && cu.moved && bodyGap(w, cu.x, cu.z, cu.heading, 'crawl') >= STOP_MARGIN, JSON.stringify(cu));
});

test('avoid mask: every point of a free cell keeps the inflation from the hull', () => {
  const w = mkWorld();
  w.spawnVehicle('kubelwagen', { x: 30, z: 30, heading: 0.7 });
  const m = avoidMask(w, 1.15), g = w.grid;
  let worst = Infinity;
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) {
    if (m[j * g.cols + i]) continue;
    const c = g.cellCenter(i, j);
    for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
      const R = hullRect(w.vehicles[0]);
      worst = Math.min(worst, rectSDF(c.x + dx, c.z + dz, R));
    }
  }
  assert.ok(worst >= 1.15 - 1e-6, `closest free-cell corner ${worst}`);
});

test('crawling at a parked hull from 8 directions: never under it, stops ≥ 0.1 m clear on his side', () => {
  for (const type of ['truck', 'kubelwagen', 'panzer2']) {
    for (let k = 0; k < 8; k++) {
      const w = mkWorld();
      w.spawnVehicle(type, { x: 30, z: 30, heading: 0.3 });
      const a = k * Math.PI / 4;
      const c = w.add(new Commando({ role: 'greenberet', x: 30 + Math.cos(a) * 7, z: 30 + Math.sin(a) * 7, heading: a + Math.PI }));
      c.setStance('crawl'); step(w, 30);
      assert.ok(c.moveTo(30, 30), `${type} k${k}: order taken`);
      let min = Infinity;
      for (let n = 0; n < 60 * 14 && c.path; n++) { step(w); min = Math.min(min, unitGap(c)); }
      assert.ok(!c.path, `${type} k${k}: arrived`);
      assert.ok(min >= 0, `${type} k${k}: min gap ${min}`);
      assert.ok(unitGap(c) >= STOP_MARGIN - 0.01, `${type} k${k}: stop gap ${unitGap(c)}`);
      assert.ok((c.x - 30) * Math.cos(a) + (c.z - 30) * Math.sin(a) > 0, `${type} k${k}: on his side`);
      // up to it: within 4.7 m of the centre for a 1.05 m reach ahead of the hips; the reach (the weapon held out ahead
      // of the face, crawl-animation.md §4.1) moves that limit with it
      const near = 4.7 + (BODY.prone.front - 1.05);
      assert.ok(Math.hypot(c.x - 30, c.z - 30) < near, `${type} k${k}: crawled up to it (${Math.hypot(c.x - 30, c.z - 30).toFixed(2)} m)`);
    }
  }
});

test('turning while prone next to a hull never swings the legs under it', () => {
  const w = mkWorld();
  w.spawnVehicle('truck', { x: 30, z: 30, heading: 0 });
  // (0.75 m off the side: his drawn-up knee reaches 0.67 m out of his body line, world/body-clearance.js LIMBS)
  const c = w.add(new Commando({ role: 'greenberet', x: 30, z: 31.2 + 0.75, heading: 0 }));
  c.setStance('crawl'); step(w, 30);
  assert.ok(unitGap(c) > 0);
  c.moveTo(30, 36); // straight away from the hull: he must turn 90° first
  let min = Infinity;
  for (let n = 0; n < 60 * 8 && c.path; n++) { step(w); min = Math.min(min, unitGap(c)); }
  assert.ok(min >= 0, `min gap while turning away ${min}`);
  assert.ok(c.z > 33, `he got away (${c.z.toFixed(2)})`);
});

test('soldiers and commandos walk round a parked car, never through it', () => {
  for (const make of [(w) => w.add(new Commando({ role: 'spy', x: 22, z: 30 })), (w) => freeze(w.add(new Enemy({ soldierType: 'soldier', x: 22, z: 30 })))]) {
    for (const st of ['stand', 'crouch']) {
      const w = mkWorld();
      w.spawnVehicle('kubelwagen', { x: 30, z: 30, heading: 0.2 });
      const u = make(w);
      u.setStance(st); step(w, 30);
      assert.ok(u.moveTo(38, 30.2));
      let min = Infinity;
      for (let n = 0; n < 60 * 20 && u.path; n++) { step(w); min = Math.min(min, unitGap(u)); }
      assert.ok(min >= 0, `${u.kind} ${st}: min gap ${min}`);
      assert.ok(Math.hypot(u.x - 38, u.z - 30.2) < 0.6, `${u.kind} ${st}: arrived (${u.x.toFixed(2)}, ${u.z.toFixed(2)})`);
    }
  }
});

test('a corpse never lies under a hull (fall turned / slid clear), but a man run over lies where he was hit', () => {
  const w = mkWorld();
  w.spawnVehicle('truck', { x: 30, z: 30, heading: 0 });
  const e = freeze(w.add(new Enemy({ soldierType: 'soldier', x: 30, z: 31.2 + 0.45, heading: -Math.PI / 2 })));
  step(w, 2);
  e.die('audit', null);
  assert.ok(unitGap(e) >= STOP_MARGIN - 0.01, `corpse gap ${unitGap(e)}`);
});
