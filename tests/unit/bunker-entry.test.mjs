/**
 * M3 review ("when placing the bomb in the bunker the commando should go inside"): the dam bunker (o1) falls only to
 * a charge set INSIDE it (marker `bunker_charge`); a Sapper planting at its entrance walks in through the trench and
 * the doorway, kneels and sets the charge on the floor inside, and walks back out — unseen inside by anyone but the
 * bunker's own crew in their cone. Planting outside the walls (the old NE-corner charge spot) no longer counts.
 */
import { test, assert } from './lib.mjs';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { applyExplosion } from '../../src/abilities/explosions.js';
import { canSee } from '../../src/ai/perception.js';

const bunkerOf = (w) => w.interactables.find((i) => (i.tag ?? i.id) === 'dam_bunker');
/** The bunker's centre (mission def) and a point `dx`, `dz` m off it (it moved W of the W stair: positions are relative). */
const centreOf = (it) => [it.params.structure.x, it.params.structure.z];
const off = (it, dx, dz) => [centreOf(it)[0] + dx, centreOf(it)[1] + dz];
const o1Done = (w) => w.objectives.find((o) => o.id === 'o1').done === true;

function setup() {
  const sim = headlessMission('m03');
  const w = sim.world, sap = w.commandos.find((c) => c.role === 'sapper');
  // keep the guards out of it: the test is about the plant, not a stealth run (the crew stays at his post)
  for (const e of w.enemies) if (e.id !== w.byId?.('e34')?.id && e.tag !== 'e34') { e.alive = false; e.removed = true; }
  const it = bunkerOf(w), entry = it.params.structure.entry;
  sap.setPosition(entry.path[0][0] + 0.3, entry.path[0][1] + 0.2);
  sap.y = 0;
  sap.gainItem('timeBomb', 2); // (in the mission he takes them from the station shed)
  return { sim, w, sap, it, entry };
}

test('m03: the dam bunker is bound to the bunker_charge marker inside it', () => {
  const { w, it, entry } = setup();
  assert.equal(it.marker, 'bunker_charge');
  const mk = w.markers.get('bunker_charge');
  assert.deepEqual([mk.x, mk.z], entry.charge);
  assert.ok(mk.r <= 1.2, `the marker is the room's floor, not the ground around the walls (r ${mk.r})`);
});

test('m03: a bomb at the old NE-corner charge spot (centre + (3.3, -2.8)) leaves the bunker standing', () => {
  const { w, it } = setup();
  const [cx, cz] = centreOf(it), [px, pz] = off(it, 3.3, -2.8);
  const a = Math.atan2(cz - pz, cx - px); // he faced the bunker centre; the charge went 0.4 m ahead of him
  applyExplosion(w, px + 0.4 * Math.cos(a), pz + 0.4 * Math.sin(a), 'bomb', null);
  assert.equal(it.destroyed, false);
});

test('m03: the Sapper walks into the bunker, sets the charge inside and comes back out; the bunker goes up (o1)', () => {
  const { sim, w, sap, it, entry } = setup();
  // the gunner looks out of his slit over the trench: in the mission a decoy SE of the bunker turns him away first
  const e34 = w.enemies.find((e) => e.tag === 'e34' || e.spawn?.id === 'e34');
  e34.heading = Math.PI / 4;
  if (e34.post) e34.post.heading = Math.PI / 4;
  assert.ok(sap.issue({ type: 'ability', id: 'timeBomb', target: sap }), sap.lastRefusal?.text);
  let wasInside = false, maxIn = 0, bombAt = null, bombY = null, plantedInside = false, seenOutsiders = 0;
  // a sentry on the river bank NE of the bunker looking straight at the room (the roof cells are no wall to the grid)
  const outsider = { alive: true, faction: 'enemy', x: entry.path[0][0] + 3, z: entry.path[0][1] - 3, y: 0 };
  const look = (u) => canSee(outsider, u, w, { cone: { x: outsider.x, z: outsider.z, heading: Math.atan2(u.z - outsider.z, u.x - outsider.x), halfFov: 0.5, near: 30, far: 40, y: 1.7 } });
  let controlSeen = 0;
  for (let i = 0; i < 60 * 30 && !it.destroyed; i++) {
    sim.step();
    if (sap.insideStructure) {
      wasInside = true;
      maxIn = Math.max(maxIn, Math.hypot(sap.x - entry.path[0][0], sap.z - entry.path[0][1]));
      assert.ok(Math.abs(sap.y) < 0.05, `inside he is on the floor, not on the roof (y ${sap.y})`);
    }
    const b = w.interactables.find((q) => q.interactKind === 'bomb' && !q.exploded);
    if (b && !bombAt) { bombAt = [b.x, b.z]; bombY = b.y; plantedInside = !!sap.insideStructure; }
    if (!sap.currentAction && bombAt && Math.hypot(sap.x - entry.path[0][0], sap.z - entry.path[0][1]) < 0.2) {
      // out again: walk him clear of the blast
      sap.issue({ type: 'move', x: 30, z: 38, run: true });
    }
    if (sap.insideStructure) {
      if (look(sap) !== 'none') seenOutsiders++;
      const was = sap.insideStructure; sap.insideStructure = null;
      if (look(sap) !== 'none') controlSeen++; // (the same spot, were he not inside)
      sap.insideStructure = was;
    }
  }
  assert.ok(wasInside, 'he went inside');
  assert.ok(maxIn > 4, `he went all the way through the trench and the doorway (${maxIn.toFixed(2)} m)`);
  assert.ok(bombAt, 'a charge was set');
  assert.ok(plantedInside, 'the charge was set while he was inside');
  assert.ok(Math.hypot(bombAt[0] - entry.charge[0], bombAt[1] - entry.charge[1]) < 0.05, `the charge sits on the marker (${bombAt})`);
  assert.ok(Math.abs(bombY) < 0.05, 'on the floor');
  assert.ok(controlSeen > 0, 'control: in the open at those spots the sentry would see him');
  assert.equal(seenOutsiders, 0, 'nobody outside sees him through the concrete');
  assert.ok(it.destroyed, 'the bunker went up');
  sim.step();
  assert.ok(o1Done(w), 'o1 done');
  assert.ok(sap.alive, 'he got out in time');
  assert.equal(sap.scripted ?? null, null);
  assert.equal(sap.insideStructure ?? null, null);
});

test('m03: planting away from the entrance is the plain at-his-feet plant', () => {
  const { sim, w, sap } = setup();
  sap.setPosition(26, 40);
  assert.ok(sap.issue({ type: 'ability', id: 'timeBomb', target: sap }));
  let inside = false;
  for (let i = 0; i < 90; i++) { sim.step(); if (sap.insideStructure) inside = true; }
  const b = w.interactables.find((q) => q.interactKind === 'bomb');
  assert.ok(b && Math.hypot(b.x - 26, b.z - 40) < 0.6);
  assert.equal(inside, false);
});

test('m03: the bunker crew sees a man inside only in his own cone', () => {
  const { w, sap, it, entry } = setup();
  const e34 = w.enemies.find((e) => e.tag === 'e34' || e.spawn?.id === 'e34');
  sap.setPosition(...entry.charge); sap.insideStructure = it;
  e34.heading = Math.atan2(entry.charge[1] - e34.z, entry.charge[0] - e34.x);
  if (e34.post) e34.post.heading = e34.heading;
  const facing = canSee(e34, sap, w, { cone: { x: e34.x, z: e34.z, heading: e34.heading, halfFov: 0.35, near: 18, far: 36, y: 1.6 } });
  const away = canSee(e34, sap, w, { cone: { x: e34.x, z: e34.z, heading: e34.heading + Math.PI, halfFov: 0.35, near: 18, far: 36, y: 1.6 } });
  assert.notEqual(facing, 'none');
  assert.equal(away, 'none');
});

test('m03: a save made while the Sapper is inside the bunker resumes the walk-in / charge / walk-out', () => {
  const { sim, w, sap, it, entry } = setup();
  const e34 = w.enemies.find((e) => e.tag === 'e34' || e.spawn?.id === 'e34');
  e34.heading = Math.PI / 4;
  if (e34.post) e34.post.heading = Math.PI / 4;
  assert.ok(sap.issue({ type: 'ability', id: 'timeBomb', target: sap }));
  for (let i = 0; i < 600 && !sap.insideStructure; i++) sim.step();
  for (let i = 0; i < 30; i++) sim.step(); // well inside, not planted yet
  assert.ok(sap.insideStructure && !w.interactables.some((q) => q.interactKind === 'bomb'));
  const d = sap.serialize();
  assert.equal(d.action?.id, 'timeBomb');
  sap.deserialize(d);
  assert.ok(sap.resumeSavedAction(), 'the charge task resumes');
  let planted = null, out = false;
  for (let i = 0; i < 60 * 20 && !it.destroyed; i++) {
    sim.step();
    const b = w.interactables.find((q) => q.interactKind === 'bomb' && !q.exploded);
    if (b && !planted) planted = [b.x, b.z];
    if (planted && !sap.currentAction && !out) { out = true; sap.issue({ type: 'move', x: 30, z: 38, run: true }); }
  }
  assert.ok(planted && Math.hypot(planted[0] - entry.charge[0], planted[1] - entry.charge[1]) < 0.05, 'charge set inside after the load');
  assert.ok(out, 'he came out');
  assert.ok(it.destroyed, 'the bunker went up');
  assert.ok(sap.alive, 'he got clear');
});

test('m03: a bomb planted anywhere next to the bunker walls: he goes round to the entrance and in; it goes up', () => {
  // the verifier's ring: walkable spots hugging the bunker all the way round (M3 gives two time bombs: none wasted)
  for (let deg = 0; deg < 360; deg += 45) {
    const { sim, w, sap, it } = setup();
    const e34 = w.enemies.find((e) => e.tag === 'e34' || e.spawn?.id === 'e34');
    e34.alive = false; e34.removed = true; // (the walk-up is in front of his slit: the test is the route, not stealth)
    const [cx, cz] = centreOf(it), a = (deg * Math.PI) / 180, R = deg % 90 ? 4.0 : 3.2, x = cx + R * Math.cos(a), z = cz + R * Math.sin(a);
    sap.setPosition(x, z); sap.y = 0;
    sap.heading = Math.atan2(cz - z, cx - x);
    assert.ok(sap.issue({ type: 'ability', id: 'timeBomb', target: sap }), `${deg}°: ${sap.lastRefusal?.text}`);
    let inside = false;
    for (let i = 0; i < 60 * 40 && !it.destroyed; i++) {
      sim.step();
      if (sap.insideStructure) inside = true;
      if (!sap.currentAction && !sap.pendingAbility && w.interactables.some((q) => q.interactKind === 'bomb')) sap.setPosition(30, 36);
    }
    assert.ok(inside, `${deg}° (${x.toFixed(1)}, ${z.toFixed(1)}): he went inside`);
    assert.ok(it.destroyed, `${deg}°: the bunker went up`);
  }
});

test('m03: a charge that would have reached the bunker but is not inside says so (never a silent waste)', () => {
  const { w, it } = setup();
  const msgs = [];
  w.events.on('message', (m) => msgs.push(m.text));
  applyExplosion(w, ...off(it, 3.3, -2.6), 'bomb', null);
  assert.equal(it.destroyed, false);
  assert.ok(msgs.some((t) => /bunker still stands.*inside/i.test(t)), msgs.join(' | '));
});
