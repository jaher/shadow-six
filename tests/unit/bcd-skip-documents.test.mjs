/**
 * BCD mechanics added for LIGHTS OUT e04 (docs/expansion/MECHANICS.md): the winch-only, enclosed lift (an incline's
 * spoil skip: refused at its stops, sent by its winch, its riders carried along the line and unseen while it travels)
 * and mission papers (`kind: 'documents'`: taken with the hand by any commando, also from inside a building with a
 * walk-in; a script can hand them to an enemy and drop them again).
 */
import { test, assert } from './lib.mjs';
import { bcdSim, post } from './bcd-sim.mjs';
import { canSee } from '../../src/ai/perception.js';
import { validateMission } from '../../src/missions/schema.js';

const SKIP = { kind: 'lift', id: 'skip', x: 10, z: 30, a: [10, 30, 0], b: [10, 10, 6], winchOnly: true, enclosed: true, travel: 8, boardR: 1.7,
  winchMsg: 'Worked from the house.' };

test('BCD winch-only lift: `use` at a stop is refused with its message; the winch sends the skip; a locked lift refuses', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 10, z: 30 }, { role: 'spy', x: 30, z: 30 }],
    interactables: [SKIP, { kind: 'winch', id: 'w', x: 30, z: 32, targets: ['skip'] }] });
  const gb = s.cmd('greenberet'), spy = s.cmd('spy'), skip = s.get('skip'), w = s.get('w');
  assert.equal(skip.canUse(gb), 'Worked from the house.');
  assert.equal(skip.interact(gb), false, 'nothing moves from the stop');
  assert.equal(skip.ride, null);
  assert.equal(spy.useAbility('use', w), true);
  s.run(25, () => skip.at === 1);
  assert.equal(skip.at, 1, 'the winch sent it up');
  assert.ok(Math.hypot(gb.x - 10, gb.z - 10) < 1.2 && Math.abs(gb.y - 6) < 0.01, `the rider arrived on the top stop (${gb.x.toFixed(1)}, ${gb.z.toFixed(1)}, y ${gb.y})`);
  skip.locked = 'Stopped.';
  assert.equal(w.canUse(spy), 'Stopped.', 'a locked lift: the winch refuses with the reason');
  assert.equal(skip.send(), false);
});

test('BCD enclosed lift: riders are carried along the line, unseen while it travels, and seen again once it stops', () => {
  // a sentry 8 m off the line, looking straight at it
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 10, z: 30 }, { role: 'sapper', x: 10.5, z: 30.4 }, { role: 'spy', x: 40, z: 40 }],
    enemies: [post('watch', 18, 20, Math.PI)], interactables: [SKIP, { kind: 'winch', id: 'w', x: 40, z: 42, targets: ['skip'] }] });
  const gb = s.cmd('greenberet'), sap = s.cmd('sapper'), skip = s.get('skip'), watch = s.get('watch');
  gb.setStance('crouch'); sap.setStance('crouch');
  assert.ok(s.cmd('spy').useAbility('use', s.get('w')));
  s.run(3, () => !!skip.ride);
  s.run(4); // half way up: z ≈ 20, y ≈ 3
  assert.ok(skip.ride, 'still travelling');
  assert.ok(gb.z < 26 && gb.z > 14 && gb.y > 1 && gb.y < 5, `carried along the line (z ${gb.z.toFixed(1)}, y ${gb.y.toFixed(2)})`);
  for (const u of [gb, sap]) assert.equal(canSee(watch, u, s.world), 'none', `${u.role} unseen in the skip`);
  assert.ok(gb.scripted && gb.insideStructure, 'held by the skip');
  s.run(10, () => skip.at === 1);
  assert.equal(skip.at, 1);
  assert.ok(!gb.scripted && !gb.insideStructure && !sap.scripted, 'released at the top');
  assert.ok(Math.abs(gb.y - 6) < 0.01 && Math.abs(sap.y - 6) < 0.01, 'both on the top stop');
  // an open lift (no `enclosed`) keeps its old rule: riders stay put until the end of the trip
  const o = bcdSim({ commandos: [{ role: 'greenberet', x: 10, z: 30 }, { role: 'spy', x: 40, z: 40 }],
    interactables: [{ kind: 'lift', id: 'cage', x: 10, z: 30, a: [10, 30], b: [10, 10] }, { kind: 'winch', id: 'w', x: 40, z: 42, targets: ['cage'] }] });
  assert.ok(o.cmd('spy').useAbility('use', o.get('w')));
  o.run(3, () => !!o.get('cage').ride);
  o.run(2);
  assert.ok(Math.abs(o.cmd('greenberet').z - 30) < 0.5 && !o.cmd('greenberet').scripted, 'open cage: no carry');
});

test('BCD enclosed lift at rest: men lying or crouching in the skip at its stop are below its sides; standing, they are seen', () => {
  // a sentry 6 m from the foot stop, looking straight at it
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 10, z: 30 }, { role: 'sapper', x: 10.6, z: 30.2 }, { role: 'spy', x: 40, z: 40 }],
    enemies: [post('watch', 16, 30, Math.PI)], interactables: [SKIP, { kind: 'winch', id: 'w', x: 40, z: 42, targets: ['skip'] }] });
  const gb = s.cmd('greenberet'), sap = s.cmd('sapper'), skip = s.get('skip'), watch = s.get('watch');
  assert.equal(skip.at, 0);
  s.run(0.5);
  assert.notEqual(canSee(watch, gb, s.world), 'none', 'standing in the skip: seen');
  gb.setStance('crawl'); sap.setStance('crouch');
  s.run(1.5);
  for (const u of [gb, sap]) assert.equal(canSee(watch, u, s.world), 'none', `${u.role} lying low in the skip: unseen`);
  // he climbs out and walks off: seen again
  gb.setStance('stand'); s.run(1);
  gb.issue({ type: 'move', x: 12.5, z: 30 }); s.run(3);
  assert.ok(!gb.insideStructure, 'out of the skip: nothing hides him');
  assert.notEqual(canSee(watch, gb, s.world), 'none', 'out of the skip: seen');
  // the skip sent up with the crouching sapper: unseen on the way, still in it (lying low) at the top
  assert.ok(s.cmd('spy').useAbility('use', s.get('w')));
  s.run(12, () => skip.at === 1);
  s.run(0.5);
  assert.equal(skip.at, 1);
  assert.ok(sap.insideStructure && Math.abs(sap.y - 6) < 0.01, 'crouching in the skip at the top: still below its sides');
});

test('BCD enclosed lift save / load mid-ride: the ride resumes with its riders and ends on the far stop', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 10, z: 30 }, { role: 'spy', x: 40, z: 40 }],
    interactables: [SKIP, { kind: 'winch', id: 'w', x: 40, z: 42, targets: ['skip'] }] });
  const skip = s.get('skip');
  s.cmd('spy').useAbility('use', s.get('w'));
  s.run(6, () => skip.ride && skip.ride.t < 5);
  const d = skip.serialize();
  assert.ok(d.ride && d.ride.riders.length === 1 && d.ride.T === 8);
  skip.ride = null;
  skip.deserialize(d);
  s.run(10, () => skip.at === 1);
  assert.equal(skip.at, 1, 'the restored ride arrived');
  assert.ok(Math.abs(s.cmd('greenberet').y - 6) < 0.01);
});

test('BCD documents: any commando takes them with the hand (an objective item, no kit slot); guests cannot; BCD-only data', () => {
  const s = bcdSim({ commandos: [{ role: 'sniper', x: 10, z: 10 }, { role: 'tonino', x: 14, z: 10 }],
    interactables: [{ kind: 'documents', id: 'papers', label: 'Bearing archive', x: 11.5, z: 10 }] });
  const sn = s.cmd('sniper'), papers = s.get('papers');
  assert.equal(papers.interactKind, 'documents');
  assert.notEqual(papers.canUse(s.cmd('tonino')), true, 'guests carry nothing');
  assert.equal(sn.useAbility('hand', { x: papers.x, z: papers.z }), true);
  s.run(4, () => !!papers.takenBy);
  assert.equal(papers.takenBy, sn.id);
  assert.deepEqual(sn.documents, ['papers']);
  assert.equal(s.count('documents:taken'), 1);
  assert.ok(!sn.inventory.has?.('documents') && !(sn.inventory.get?.('documents') > 0), 'no knapsack slot');
  const bel = validateMission({ id: 'x', size: [20, 20], interactables: [{ kind: 'documents', id: 'p', x: 5, z: 5 }] });
  assert.ok(bel.warnings.some((w) => /documents.*BCD/.test(w)), 'BEL warns: BCD-only kind');
});

test('BCD documents inside a building: the hand walks in by the entry, takes them, walks out; a script can hand them to an enemy and drop them', () => {
  const s = bcdSim({ commandos: [{ role: 'driver', x: 20, z: 17 }],
    structures: [{ id: 'office', type: 'house', x: 20, z: 10, w: 6, d: 6, h: 4, fixed: true, entry: { path: [[20, 14.6], [20, 12.6]], at: [20, 9.6] } }],
    interactables: [{ kind: 'documents', id: 'papers', x: 20, z: 9.6, inside: 'office' }] });
  const dr = s.cmd('driver'), papers = s.get('papers');
  assert.equal(s.world.grid.walkableAt(20, 9.6), false, 'they lie inside the walls');
  assert.equal(dr.useAbility('hand', { x: papers.x, z: papers.z }), true);
  s.run(20, () => !!papers.takenBy && !dr.scripted);
  assert.equal(papers.takenBy, dr.id, 'taken inside');
  assert.ok(dr.z > 12 && !dr.insideStructure, `and he is out again (${dr.x.toFixed(1)}, ${dr.z.toFixed(1)})`);
  // a script's errand: an enemy takes another set and drops it where he falls
  const t = bcdSim({ enemies: [post('chief', 30, 30)], interactables: [{ kind: 'documents', id: 'p2', x: 31, z: 30 }] });
  const p2 = t.get('p2');
  assert.ok(p2.takeBy(t.get('chief')));
  assert.equal(p2.canUse({ role: 'greenberet' }), 'Nothing there.');
  p2.dropAt(35, 32);
  assert.equal(p2.takenBy, null);
  assert.equal(p2.canUse({ role: 'greenberet' }), true, 'dropped papers can be taken');
  assert.ok(Math.hypot(p2.x - 35, p2.z - 32) < 1e-6);
});
