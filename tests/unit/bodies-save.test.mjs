/** bodies-design §D.1, §E: carryMode, transitions, the downed timer and the house rules round-trip; old saves load. */
import { test, assert, near } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { restoreWorld, restorePhysicsLayer } from '../../src/save.js';
import { Entity } from '../../src/entities/entity.js';

const DEF = { commandos: [{ role: 'greenberet', x: 10, z: 10 }, { role: 'sniper', x: 10, z: 20 }, { role: 'driver', x: 20, z: 30 }], enemies: [guard('d', 11, 10), guard('d2', 11, 20)] };
const fresh = (def = DEF) => { Entity.nextId = 1; return makeSim(def, { brains: false }); };

function reload(s, strip = null, def = DEF) {
  const snap = JSON.parse(JSON.stringify({ world: s.world.serialize(), house: { ...s.world.house } }));
  if (strip) strip(snap);
  const t = fresh(def);
  restoreWorld(t.world, snap.world);
  restorePhysicsLayer(t.world, snap);
  return t;
}

test('save: carryMode (drag + shoulder), a lift in progress is resumed, the downed timer, house rules', () => {
  const s = fresh();
  const gb = s.cmd('greenberet'), sn = s.cmd('sniper'), dr = s.cmd('driver');
  s.get('d').die('knife', null); s.get('d2').die('knife', null);
  gb.issue({ type: 'ability', id: 'drag', target: s.get('d') });
  sn.issue({ type: 'ability', id: 'hand', target: s.get('d2') });
  s.run(2, () => gb.carrying && sn.carrying);
  gb.issue({ type: 'ability', id: 'carryToggle', target: gb });
  s.run(0.5);
  assert.equal(gb.carryTransition?.kind, 'toShoulder');
  dr.takeDamage(dr.hp, null, 'shot');
  s.run(1 / 60);
  s.world.house.dropWhenShot = false; // a CUSTOM layer the save must keep
  const t = reload(s);
  const [g2, s2, d2] = [t.cmd('greenberet'), t.cmd('sniper'), t.cmd('driver')];
  assert.equal(g2.carrying?.id, s.get('d').id);
  assert.equal(g2.carryMode, 'drag', 'the lift resumes from the drag');
  assert.equal(g2.carryTransition?.kind, 'toShoulder');
  near(g2.carryTransition.t, gb.carryTransition.t, 1e-9);
  assert.equal(g2.currentActionId, 'carryToggle');
  assert.equal(s2.carryMode, 'drag');
  assert.equal(t.get('d2').state, 'carried');
  assert.equal(t.get('d2').carriedBy, s2);
  assert.ok(d2.downed);
  near(d2.downed.t, dr.downed.t, 1e-9);
  assert.equal(d2.state, 'downed');
  assert.equal(t.world.house.dropWhenShot, false);
  assert.ok(s2.abilities.includes('drag') && s2.abilities.includes('drop'));
  t.run(dr.downed.t + 0.1);
  assert.equal(d2.alive, false, 'the bleed-out resumes');
  assert.equal(g2.carryMode, 'shoulder', 'the lift finished');
});

test('save: an old save with a lift in progress (no resumable action) resolves it to its end state', () => {
  const s = fresh();
  const gb = s.cmd('greenberet');
  s.get('d').die('knife', null);
  gb.issue({ type: 'ability', id: 'drag', target: s.get('d') });
  s.run(2, () => gb.carrying);
  gb.issue({ type: 'ability', id: 'carryToggle', target: gb });
  s.run(0.5);
  const t = reload(s, (snap) => { for (const e of snap.world.entities) delete e.action; });
  assert.equal(t.cmd('greenberet').carryMode, 'shoulder');
});

/** Positions / state of the transport after a save → load at `cut` s vs the uninterrupted run (§0.2 determinism). */
function continuity(order, cut, more) {
  const run = (s) => {
    const gb = s.cmd('greenberet'), sn = s.cmd('sniper');
    return () => [gb.x, gb.z, gb.heading, gb.carryMode, gb.carrying?.id ?? null, s.get('d').x, s.get('d').z, s.get('d').heading,
      sn.x, sn.z, sn.carrying?.id ?? null, s.get('d2').x, s.get('d2').z, s.get('d2').state];
  };
  const a = fresh(), b = fresh();
  for (const s of [a, b]) { s.get('d').die('knife', null); s.get('d2').die('knife', null); order(s); }
  a.run(cut); b.run(cut);
  const c = reload(b);
  a.run(more); c.run(more);
  assert.deepEqual(run(c)(), run(a)());
}

test('save: mid-grab, mid-drag, mid-lift, mid-put-down: load and continue = the uninterrupted run', () => {
  const grab = (s) => {
    s.cmd('greenberet').issue({ type: 'ability', id: 'drag', target: s.get('d') });
    s.cmd('sniper').issue({ type: 'ability', id: 'hand', target: s.get('d2') });
  };
  continuity(grab, 0.4, 3); // mid-grab (1.0 s)
  const drag = (s) => { grab(s); s.run(2); s.cmd('greenberet').moveTo(6, 13); s.cmd('sniper').moveTo(14, 24); };
  continuity(drag, 1.3, 4); // mid-drag, turning
  const lift = (s) => { drag(s); s.run(1); s.cmd('greenberet').issue({ type: 'ability', id: 'carryToggle', target: s.cmd('greenberet') }); };
  continuity(lift, 0.45, 2); // mid-lift
  const down = (s) => { lift(s); s.run(1.5); s.cmd('greenberet').issue({ type: 'cancel' }); s.cmd('sniper').issue({ type: 'cancel' }); };
  continuity(down, 0.3, 2); // mid-put-down / release
});

test('save: an old save without the new fields loads; a body carried by a non-GB/Spy becomes a drag', () => {
  const s = fresh();
  const sn = s.cmd('sniper');
  s.get('d2').die('knife', null);
  sn.issue({ type: 'ability', id: 'hand', target: s.get('d2') });
  s.run(2, () => sn.carrying);
  const t = reload(s, (snap) => {
    delete snap.house;
    for (const e of snap.world.entities) { delete e.carryMode; delete e.carryTransition; delete e.downed; }
  });
  const s2 = t.cmd('sniper');
  assert.equal(s2.carryMode, 'drag');
  assert.equal(t.world.house.preset, 'shadowSix', 'the current preset');
});

test('save: a revive in progress is resumed with its remaining time; the dose is spent only at the end', () => {
  const def = { commandos: [{ role: 'sniper', x: 10, z: 10, inventory: { firstAid: 6 } }, { role: 'spy', x: 11, z: 10 }], firstAid: false };
  const s = fresh(def);
  const sn = s.cmd('sniper'), spy = s.cmd('spy');
  spy.takeDamage(spy.hp, null, 'shot');
  sn.issue({ type: 'ability', id: 'firstAid', target: spy });
  s.run(2);
  const t = reload(s, null, def);
  assert.ok(t.cmd('spy').downed);
  assert.equal(t.cmd('sniper').inventory.get('firstAid'), 6, 'the dose was not spent');
  assert.equal(t.cmd('sniper').currentActionId, 'firstAid', 'resumed');
  t.run(1.9);
  assert.ok(t.cmd('spy').downed, 'not before the remaining 2.0 s');
  t.run(0.2);
  assert.equal(t.cmd('spy').downed, null);
  assert.equal(t.cmd('sniper').inventory.get('firstAid'), 5);
});
