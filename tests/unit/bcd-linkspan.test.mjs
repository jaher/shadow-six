/**
 * BCD pushables and link-spans (docs/expansion/MECHANICS.md; built for e06 "Thin Ice", generic for any BCD mission):
 *   - a drawbridge that is not fully down across a wagon's rail stops the push with the wagon's nose at its edge;
 *     lowered, the span carries the wagon on;
 *   - a rail wagon with `drop: {at}` tips off the rail when its centre passes that point: destroyed (a `destroy`
 *     objective counts it), a level-2 splash, 'pushable:drop';
 *   - a span is never raised with a wagon standing on it; the span's `downAt` (when it came down) is saved;
 *   - `roles: []` (a locomotive nobody can push), `bombable` (a charge wrecks it, bullets do not), `haul(to, speed,
 *     train)` (a scripted move with coupled cars), saved and restored mid-haul; a raised span stops a haul too;
 *   - terrain features: `flat` keeps a ground polygon level (grid.flatExtra), `paint` lays a palette layer over it.
 * The BEL suites never place a pushable or a drawbridge (BCD-only data): nothing here runs under BEL.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { bcdSim } from './bcd-sim.mjs';
import { Entity } from '../../src/entities/entity.js';
import { restoreWorld } from '../../src/save.js';
import { createObjectives, checkObjectives } from '../../src/core/objectives.js';
import { paintFeatures, featurePainter } from '../../src/art/terrain.js';

// a span 14 m long across the rail (x 33–47), over a slip of open water; the wagon is pushed east along z 20
const SPAN = { x: 40, z: 20, w: 14, d: 6, rot: 0 };
const SLIP = [[33, 14], [47, 14], [47, 26], [33, 26]];
const WAGON = { kind: 'pushable', id: 'w', x: 20, z: 20, heading: 0, size: [10, 2.8], rail: [[10, 20], [78, 20]], drop: { at: [44, 20] } };
function linkSpan({ raised = true, wagon = {}, extra = [] } = {}) {
  Entity.nextId = 1;
  return bcdSim({
    size: [80, 40],
    terrain: [{ type: 'poly', terrain: 'water', points: SLIP }],
    commandos: [{ role: 'driver', x: 13.6, z: 20.2 }, { role: 'spy', x: 30, z: 30 }],
    interactables: [
      { kind: 'drawbridge', id: 'span', x: SPAN.x, z: SPAN.z, rect: { ...SPAN }, raised },
      { kind: 'drawbridgeSwitch', id: 'sw', x: 30, z: 31.5, targets: ['span'] },
      { ...WAGON, ...wagon },
      ...extra,
    ],
  });
}
const push = (s, dr = s.cmd('driver'), w = s.get('w')) => {
  assert.equal(dr.useAbility('use', w), true, 'the Driver takes hold of the wagon');
  assert.ok(s.run(10, () => !!w.goal), 'pushing');
};

test('BCD link-span: raised across the rail it stops the push with the wagon\'s nose at its edge ("The span is up.")', () => {
  const s = linkSpan({ raised: true });
  const w = s.get('w');
  push(s);
  s.run(30, () => !w.goal);
  assert.equal(w.goal, null, 'the push stopped');
  assert.ok(Math.abs(w.x + w.size[0] / 2 - 33) < 0.3, `nose at the span's edge x 33 (nose at ${(w.x + w.size[0] / 2).toFixed(2)})`);
  assert.equal(w.destroyed, false);
  assert.ok(s.log.some((l) => l.name === 'message' && /span is up/i.test(l.p.text)), 'the pusher is told why');
  // a fresh push still goes nowhere while the span stays up
  const x0 = w.x, said = s.count('message', (p) => /span is up/i.test(p.text));
  assert.equal(s.cmd('driver').useAbility('use', w), true);
  s.run(4);
  assert.ok(w.x - x0 < 0.05, 'no further while it is up');
  assert.ok(s.count('message', (p) => /span is up/i.test(p.text)) > said, 'told again');
});

test('BCD link-span: lowered, the wagon rolls over it and tips off at its `drop` point: destroyed, a destroy objective done, a level-2 splash', () => {
  const s = linkSpan({ raised: true });
  const span = s.get('span'), w = s.get('w'), spy = s.cmd('spy');
  assert.equal(spy.useAbility('use', s.get('sw')), true, 'the Spy works the switch');
  assert.ok(s.run(15, () => span.down), 'the span comes down in 5 s');
  assert.ok(Math.abs(span.downAt - s.world.time) < 0.2, 'it records when it came down (downAt)');
  s.world.objectives = createObjectives([{ id: 'o1', type: 'destroy', targets: ['w'] }]);
  push(s);
  assert.ok(s.run(60, () => w.destroyed), 'over the end');
  assert.equal(w.dropped, true);
  assert.ok(Math.abs(w.x - 44) < 0.1, `tipped at its drop point (x ${w.x.toFixed(2)})`);
  assert.equal(s.count('pushable:drop'), 1);
  assert.ok(s.log.some((l) => l.name === 'structure:destroyed' && l.p.id === 'w' && l.p.cause === 'drop'));
  assert.ok(s.log.some((l) => l.name === 'noise' && l.p.kind === 'splash' && l.p.level === 2 && l.p.radius === 20), 'a heavy splash');
  checkObjectives(s.world);
  assert.equal(s.world.objectives[0].done, true, 'the destroy objective counts the wagon gone');
  assert.equal(s.cmd('driver').alive, true, 'the pusher stays on the span');
  assert.equal(w.canUse(s.cmd('driver')), 'Nothing there.');
});

test('BCD link-span: never raised with a wagon on its deck; raised once the wagon is off it', () => {
  const s = linkSpan({ raised: false, wagon: { x: 40 } });
  const span = s.get('span'), w = s.get('w');
  assert.equal(span.down, true);
  assert.equal(w.overSpan(span), true);
  assert.equal(span.toggle(), false, 'refused under a load');
  assert.equal(span.down, true);
  w.x = 22; s.run(0.2);
  assert.equal(w.overSpan(span), false);
  assert.equal(span.toggle(), true, 'raised with the deck clear');
  assert.equal(span.raised, true);
  // downAt survives a save: a span that came down at t keeps t after a load
  const s2 = linkSpan({ raised: true });
  s2.get('span').toggle(); s2.run(6);
  const d = s2.get('span').serialize();
  const s3 = linkSpan({ raised: true });
  s3.get('span').deserialize(d);
  assert.equal(s3.get('span').down, true);
  assert.equal(s3.get('span').downAt, s2.get('span').downAt);
});

test('BCD locomotive: `roles: []` nobody pushes, a `haul` pulls a coupled wagon; saved mid-haul, a load re-couples it', () => {
  const LOCO = { kind: 'pushable', id: 'L', x: 1.6 + 9.4, z: 20, heading: 0, size: [8, 2.8], rail: [[0, 20], [78, 20]], roles: [], bombable: true, label: 'Shunting engine' };
  const make = () => linkSpan({ raised: false, wagon: { x: 1.6, drop: undefined }, extra: [LOCO] });
  const s = make();
  const L = s.get('L'), w = s.get('w'), dr = s.cmd('driver');
  assert.equal(L.canUse(dr), 'Too heavy for me.', 'nobody pushes an engine');
  // the engine is at the wagon's east end: it pulls the wagon west, then (re-coupled) east over the lowered span
  L.x = 20 + 9.4; w.x = 20;
  assert.equal(L.haul({ x: 60, z: 20 }, 3, [w]), true);
  s.run(2);
  assert.ok(L.hauling && w.hauling, 'both under way');
  const off = L.x - w.x;
  assert.ok(Math.abs(off - 9.4) < 1e-6, 'the coupling holds the offset');
  assert.ok(L.x > 29.4 + 5, `moving at its speed (${(L.x - 29.4).toFixed(2)} m in 2 s)`);
  // save mid-haul, restore into a fresh copy of the map
  const dL = L.serialize(), dW = w.serialize();
  const s2 = make();
  s2.get('L').deserialize(dL); s2.get('w').deserialize(dW);
  s2.run(0.2);
  assert.ok(s2.get('L').hauling && s2.get('w').hauling, 're-coupled after the load');
  s2.run(20);
  assert.ok(Math.abs(s2.get('L').x - 60) < 0.05, 'the haul runs to its end');
  assert.ok(Math.abs(s2.get('L').x - s2.get('w').x - 9.4) < 1e-6, 'the wagon came with it');
  assert.equal(s2.get('L').hauling, false, 'stopped');
  assert.ok(s2.log.some((l) => l.name === 'pushable:hauled'));
});

test('BCD pushable: saved mid-push, a load resumes the push — its goal, the man pushing and where he stands on it', () => {
  const make = () => linkSpan({ raised: false, wagon: { drop: undefined } });
  const s = make();
  const w = s.get('w'), dr = s.cmd('driver');
  push(s);
  s.run(2);
  const dW = w.serialize(), dD = dr.serialize();
  assert.ok(dW.goal && dW.pusher === dr.id && dW.off, 'saved with its push (goal, pusher, offset)');
  s.run(6); // the run without a load
  assert.ok(w.goal && w.pusher === dr, 'still pushing');
  const s2 = make();
  s2.cmd('driver').deserialize(dD); s2.get('w').deserialize(dW);
  s2.run(6);
  const w2 = s2.get('w'), dr2 = s2.cmd('driver');
  assert.equal(w2.pusher, dr2, 'the same man pushes after the load');
  assert.ok(Math.abs(w2.x - w.x) < 1e-6 && Math.abs(w2.z - w.z) < 1e-6, `the wagon where the unloaded run has it (${w2.x.toFixed(3)} vs ${w.x.toFixed(3)})`);
  assert.ok(Math.abs(dr2.x - dr.x) < 1e-6 && Math.abs(dr2.z - dr.z) < 1e-6, 'the pusher walks with it');
  // a wagon at rest saves no push
  const s3 = make();
  assert.equal(s3.get('w').serialize().pusher, null);
});

test('BCD pushables through a real load (save.restoreWorld): the push and the haul are whole before the first tick — the state right after the load is the saved one, and a save made straight after it (still paused) keeps both', () => {
  const save = (s) => JSON.parse(JSON.stringify({ ...s.world.serialize(), nextId: Entity.nextId }));
  const rec = (S, id) => S.entities.find((e) => e.id === id);
  // a push in progress
  {
    const make = () => linkSpan({ raised: false, wagon: { drop: undefined } });
    const s = make();
    const w = s.get('w');
    push(s);
    s.run(2);
    const S = save(s);
    const s2 = make();
    restoreWorld(s2.world, S);
    const w2 = s2.get('w'), dr2 = s2.cmd('driver');
    assert.equal(w2.pusher?.id ?? null, dr2.id, 'the man pushing, right after the load (no tick yet)');
    assert.deepEqual(w2.goal, w.goal);
    const S2 = save(s2); // the load came back paused: saved again before any tick
    assert.equal(rec(S2, w2.id).pusher, dr2.id, 'a save straight after the load keeps the push');
    const s3 = make();
    restoreWorld(s3.world, S2);
    s.run(4); s3.run(4);
    assert.ok(Math.abs(s3.get('w').x - w.x) < 1e-6, `load of the load: the wagon where the run without one has it (${s3.get('w').x.toFixed(3)} vs ${w.x.toFixed(3)})`);
  }
  // a haul in progress (an engine pulling a coupled wagon)
  {
    const LOCO = { kind: 'pushable', id: 'L', x: 29.4, z: 20, heading: 0, size: [8, 2.8], rail: [[0, 20], [78, 20]], roles: [], bombable: true, label: 'Shunting engine' };
    const make = () => linkSpan({ raised: false, wagon: { drop: undefined }, extra: [LOCO] });
    const s = make();
    const L = s.get('L'), w = s.get('w');
    assert.equal(L.haul({ x: 60, z: 20 }, 3, [w]), true);
    s.run(2);
    const S = save(s);
    const s2 = make();
    restoreWorld(s2.world, S);
    const L2 = s2.get('L'), w2 = s2.get('w');
    assert.ok(L2.hauling && w2.hauling && w2._hauledBy === L2, 'engine and wagon coupled right after the load');
    for (const p of [L2, w2]) {
      assert.equal(s2.world.grid._navStamps.has(`push:${p.id}`), s.world.grid._navStamps.has(`push:${p.id}`), `${p.tag ?? p.id}: no rest block while it rolls, as in the run without a load`);
    }
    const S2 = save(s2);
    assert.ok(rec(S2, L2.id).haul?.train?.includes(w2.id), 'a save straight after the load keeps the haul and its train');
    s.run(4); s2.run(4);
    assert.ok(Math.abs(L2.x - L.x) < 1e-6 && Math.abs(w2.x - w.x) < 1e-6, 'the haul runs on as without a load');
  }
});

test('BCD pushable dropped off the span\'s end, through a real load (save.restoreWorld): still dropped and destroyed, its body hidden in the harbour — never drawn back on the span, never burnt where it went over (e06 verifier r2)', () => {
  const save = (s) => JSON.parse(JSON.stringify({ ...s.world.serialize(), nextId: Entity.nextId }));
  // a drawn body on the wagon (the mission's skin hangs under it: art/e06-dressing.js skinPushable)
  const skin = (s) => {
    const w = s.get('w'), o = new THREE.Group(), m = new THREE.Mesh(new THREE.BoxGeometry(10, 3, 2.8), new THREE.MeshBasicMaterial());
    m.name = 'skin'; o.add(m); w.object3d = o;
    return o;
  };
  const s = linkSpan({ raised: false });
  skin(s);
  const w = s.get('w');
  push(s);
  assert.ok(s.run(60, () => w.dropped), 'over the end');
  s.run(3);
  const S = save(s);
  assert.equal(S.entities.find((e) => e.id === w.id).dropped, true, 'saved dropped');
  const s2 = linkSpan({ raised: false });
  const o2 = skin(s2);
  restoreWorld(s2.world, S);
  const w2 = s2.get('w');
  assert.equal(w2.dropped, true, 'dropped after the load');
  assert.equal(w2.destroyed, true, 'destroyed after the load');
  assert.equal(o2.visible, false, 'its body hidden: at the bottom of the harbour, not standing on the span\'s end');
  assert.ok(!o2.userData.charred && !o2.getObjectByName('skin').material.userData?.charred, 'not burnt where it went over');
  assert.equal(w2.canUse(s2.cmd('driver')), 'Nothing there.');
  assert.equal(s2.world.grid._navStamps.has(`push:${w2.id}`), false, 'no rest block left on the rail');
  // a wagon still on the rail loads drawn
  const s3 = linkSpan({ raised: false });
  const o3 = skin(s3);
  restoreWorld(s3.world, save(linkSpan({ raised: false })));
  assert.equal(s3.get('w').destroyed, false);
  assert.equal(o3.visible, true, 'an intact wagon stays drawn');
});

test('BCD locomotive: a raised span stops a haul at its edge; bullets do not hurt the engine, a charge wrecks it and the haul ends', () => {
  const LOCO = { kind: 'pushable', id: 'L', x: 18, z: 20, heading: 0, size: [8, 2.8], rail: [[0, 20], [78, 20]], roles: [], bombable: true };
  const s = linkSpan({ raised: true, wagon: { x: 6, drop: undefined }, extra: [LOCO] });
  const L = s.get('L');
  L.haul({ x: 70, z: 20 }, 3);
  s.run(10, () => !L.hauling);
  assert.equal(L.hauling, false);
  assert.ok(Math.abs(L.x + L.size[0] / 2 - 33) < 0.3, `stopped at the raised span's edge (nose ${(L.x + 4).toFixed(2)})`);
  L.haul({ x: 2, z: 20 }, 3);
  s.run(0.5);
  L.takeDamage(80, null, 'rifle');
  assert.equal(L.destroyed, false, 'a rifle bullet does nothing');
  L.takeDamage(200, null, 'explosion');
  assert.equal(L.destroyed, true, 'a charge wrecks it');
  assert.equal(L.hauling, false, 'the haul ends');
  assert.ok(s.log.some((l) => l.name === 'structure:destroyed' && l.p.id === 'L'));
});

test('terrain features: `flat` keeps a ground polygon level (grid.flatExtra); `paint` lays a palette layer over it', () => {
  const ICE = [[10, 10], [30, 10], [30, 30], [10, 30]];
  const s = bcdSim({ size: [40, 40], terrain: [{ type: 'poly', terrain: 'ground', points: ICE, flat: true, paint: 'ice', edge: 1, keep: 0.2 }] });
  const g = s.world.grid, at = (x, z) => { const c = g.worldToCell(x, z); return g.flatExtra?.[g.idx(c.i, c.j)] ?? 0; };
  assert.equal(at(20, 20), 1, 'inside: flat');
  assert.equal(at(5, 5), 0, 'outside: untouched');
  assert.equal(g.walkableAt(20, 20), true, 'still walkable ground (visual only)');
  const feats = paintFeatures(s.mission);
  assert.equal(feats.length, 1);
  assert.equal(feats[0].paint, 'ice');
  const layers = ['snow', 'rock', 'gravel', 'dirt', 'ice', 'x', 'y', 'z'];
  const P = featurePainter(s.mission, layers);
  const w = (x, z) => { const a = [1, 0, 0, 0, 0, 0, 0, 0]; P(x, z, a); return a; };
  const inside = w(20, 20), outside = w(2, 2), edge = w(10, 20);
  assert.ok(inside[4] > 0.9 && Math.abs(inside[0] - 0.2) < 1e-9, `inside: ice over 20 % of the snow (${inside.map((v) => v.toFixed(2))})`);
  assert.deepEqual(outside, [1, 0, 0, 0, 0, 0, 0, 0], 'outside the feature (and its edge band): untouched');
  assert.ok(edge[4] > 0.3 && edge[4] < 0.7, `on the border: blended (${edge[4].toFixed(2)})`);
  assert.equal(featurePainter(s.mission, ['grass', 'dirt']), undefined, 'no layer of that name in the palette: no painter');
});
