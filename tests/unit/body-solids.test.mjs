/**
 * Body clearance against solid props, drums, pushables and wrecks (src/world/body-clearance.js; user: "neither
 * soldiers nor commandos can cross cars or any other object which could be climbed on").
 */
import { test, assert } from './lib.mjs';
import { World } from '../../src/world/world.js';
import { createVehicle } from '../../src/entities/vehicle.js';
import { Commando } from '../../src/entities/commando.js';
import { Enemy } from '../../src/entities/enemy.js';
import { createInteractable } from '../../src/entities/interactables.js';
import '../../src/entities/bcd-interactables.js';
import {
  STOP_MARGIN, bodyGap, unitGap, setStaticSolids, removeStaticSolids, staticNear, minAreaRect, isSolidHull, hasObstacles,
  capsuleRectGap, bodyCapsule,
} from '../../src/world/body-clearance.js';

const DT = 1 / 60;
function mkWorld() { const w = new World({ size: [60, 60] }); w.vehicleFactory = createVehicle; return w; }
function step(w, n = 1) {
  for (let k = 0; k < n; k++) {
    w.rebuildSpatial(); w.refreshDynamicOccluders();
    for (const c of [...w.commandos]) if (!c.removed) c.update(DT);
    for (const e of [...w.enemies]) if (!e.removed) e.update(DT);
    for (const v of [...w.vehicles]) if (!v.removed) v.update(DT);
    for (const it of [...w.interactables]) if (!it.removed) it.update?.(DT);
    w.flushRemovals(); w.time += DT;
  }
}
const freeze = (e) => { if (e.brain) e.brain.update = () => {}; return e; };

/** A 2 × 1.4 m crate stack at (30, 30) turned 0.5 rad: static solid + its nav footprint (as map-builder does). */
function withCrate(w, x = 30, z = 30, h = 0.5, l = 2, d = 1.4) {
  setStaticSolids(w, [{ owner: 7, R: { x, z, h, hl: l / 2, hw: d / 2 } }]);
  w.grid.navStamp('crate', w.grid.rectCells(x, z, l, d, h));
  return w.bodySolids.list[0].R;
}

test('min-area rect of a plan hull: a turned box comes back as itself', () => {
  const h = 0.4, c = Math.cos(h), s = Math.sin(h);
  const pts = [[-1.5, -0.6], [1.5, -0.6], [1.5, 0.6], [-1.5, 0.6]].map(([u, v]) => [10 + u * c - v * s, 20 + u * s + v * c]);
  const R = minAreaRect(pts);
  assert.ok(Math.abs(R.x - 10) < 1e-6 && Math.abs(R.z - 20) < 1e-6, 'centre');
  const long = Math.max(R.hl, R.hw), short = Math.min(R.hl, R.hw);
  assert.ok(Math.abs(long - 1.5) < 1e-6 && Math.abs(short - 0.6) < 1e-6, `half sizes ${R.hl} ${R.hw}`);
});

test('static solids: bucket lookup finds them, a destroyed one is dropped', () => {
  const w = mkWorld();
  assert.ok(!hasObstacles(w));
  withCrate(w);
  assert.ok(hasObstacles(w));
  assert.equal(staticNear(w, 31, 30, 1).length, 1);
  assert.equal(staticNear(w, 40, 30, 1).length, 0);
  assert.ok(bodyGap(w, 30, 30, 0, 'stand') < 0, 'inside the crate');
  removeStaticSolids(w, 7);
  assert.equal(staticNear(w, 31, 30, 1).length, 0);
  assert.equal(bodyGap(w, 30, 30, 0, 'stand'), Infinity);
});

test('crawling at a crate stack from 8 directions: head and legs never in it, stops >= 0.1 m clear', () => {
  for (let k = 0; k < 8; k++) {
    const w = mkWorld();
    withCrate(w);
    const a = k * Math.PI / 4 + 0.1;
    const c = w.add(new Commando({ role: 'greenberet', x: 30 + Math.cos(a) * 6, z: 30 + Math.sin(a) * 6, heading: a + Math.PI }));
    c.setStance('crawl'); step(w, 30);
    assert.ok(c.moveTo(30, 30), `k${k}: order taken`);
    let min = Infinity;
    for (let n = 0; n < 60 * 14 && c.path; n++) { step(w); min = Math.min(min, unitGap(c)); }
    assert.ok(!c.path, `k${k}: arrived`);
    assert.ok(min >= 0, `k${k}: min gap ${min}`);
    assert.ok(unitGap(c) >= STOP_MARGIN - 0.01, `k${k}: stop gap ${unitGap(c)}`);
    assert.ok(Math.hypot(c.x - 30, c.z - 30) < 4, `k${k}: crawled up to it (${Math.hypot(c.x - 30, c.z - 30).toFixed(2)} m)`);
  }
});

test('walkers go round fuel drums, never brushing through them; a crawling GB still picks one up', () => {
  for (const st of ['stand', 'crouch']) {
    const w = mkWorld();
    for (const [x, z] of [[30, 29.6], [30.6, 30.1], [29.6, 30.4]]) w.add(createInteractable({ interactKind: 'barrel', x, z }, { meshes: false }));
    const e = freeze(w.add(new Enemy({ soldierType: 'soldier', x: 24, z: 30 })));
    e.setStance(st); step(w, 30);
    assert.ok(e.moveTo(36, 30.1));
    let min = Infinity;
    for (let n = 0; n < 60 * 20 && e.path; n++) { step(w); min = Math.min(min, unitGap(e)); }
    assert.ok(min >= 0, `${st}: min gap ${min}`);
    assert.ok(Math.hypot(e.x - 36, e.z - 30.1) < 0.6, `${st}: arrived (${e.x.toFixed(2)}, ${e.z.toFixed(2)})`);
  }
  const w = mkWorld();
  const b = w.add(createInteractable({ interactKind: 'barrel', x: 30, z: 30 }, { meshes: false }));
  const gb = w.add(new Commando({ role: 'greenberet', x: 24, z: 30.2, heading: 0 }));
  gb.setStance('crawl'); step(w, 30);
  assert.ok(gb.issue({ type: 'ability', id: 'hand', target: { x: b.x, z: b.z } }) !== false, 'order taken');
  let min = Infinity;
  for (let n = 0; n < 60 * 20 && b.carriedBy !== gb; n++) { step(w); if (!b.carriedBy) min = Math.min(min, bodyGap(w, gb.x, gb.z, gb.heading, gb.stance)); }
  assert.ok(b.carriedBy === gb, 'picked the drum up');
  assert.ok(min >= 0, `crawler min gap to the drum ${min}`);
});

test('a burnt-out (baked) wreck is still solid: nobody lies under it', () => {
  const w = mkWorld();
  const v = w.spawnVehicle('truck', { x: 30, z: 30, heading: 0.3 });
  v.destroyed = true; v.wreckBaked = true;
  assert.ok(isSolidHull(v));
  for (let k = 0; k < 8; k += 2) {
    const a = k * Math.PI / 4;
    const c = w.add(new Commando({ role: 'greenberet', x: 30 + Math.cos(a) * 7, z: 30 + Math.sin(a) * 7, heading: a + Math.PI }));
    c.setStance('crawl'); step(w, 30);
    c.moveTo(30, 30);
    let min = Infinity;
    for (let n = 0; n < 60 * 14 && c.path; n++) { step(w); min = Math.min(min, unitGap(c)); }
    assert.ok(min >= 0, `k${k}: min gap ${min}`);
    w.remove(c);
  }
});

test('a pushed wagon stops against a man in its way (standing or prone), never rolls through him', () => {
  for (const st of ['stand', 'crawl']) {
    const w = mkWorld();
    const p = w.add(createInteractable({ interactKind: 'pushable', id: 'wg', x: 20, z: 30, rail: [[10, 30], [50, 30]] }, { meshes: false }));
    const gb = w.add(new Commando({ role: 'greenberet', x: 16.95, z: 30, heading: 0 }));
    const e = freeze(w.add(new Enemy({ soldierType: 'soldier', x: 27, z: 30.4, heading: Math.PI / 2 })));
    e.setStance(st); step(w, 30);
    p.goal = { x: 50, z: 30 }; p.pusher = gb; p._off = { x: gb.x - p.x, z: gb.z - p.z };
    const R = () => ({ x: p.x, z: p.z, h: p.heading ?? 0, hl: p.size[0] / 2, hw: p.size[1] / 2 });
    let min = Infinity;
    for (let n = 0; n < 60 * 12 && p.goal; n++) { step(w); min = Math.min(min, capsuleRectGap(bodyCapsule(e.x, e.z, e.heading, e.stance), R())); }
    assert.ok(!p.goal, `${st}: the push stopped`);
    assert.ok(p.x < 27, `${st}: short of him (${p.x.toFixed(2)})`);
    assert.ok(min >= 0, `${st}: min gap ${min}`);
    assert.ok(e.alive && Math.hypot(e.x - 27, e.z - 30.4) < 1e-6, `${st}: he is alive where he was`);
  }
});
