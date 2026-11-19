/**
 * BCD captive stowing (docs/expansion/MECHANICS.md "Stow a captive"; LIGHTS OUT e01): a cuffed captive carried to an
 * enterable building's door is put inside with Use — hidden like a man in a hideout, never found by his comrades — and
 * the carrier stays outside. Under BEL a body never goes inside ("Can't take that inside.").
 */
import { test, assert } from './lib.mjs';
import { bcdSim, post } from './bcd-sim.mjs';
import { stowable } from '../../src/entities/interactables.js';

const HOUSE = { type: 'house', id: 'h1', x: 20, z: 30, rot: 0, w: 8, d: 6, h: 5, enterable: true };

/** GB fists, cuffs and shoulders guard `a` (who faces away), then walks to the house door and uses it. */
function cuffAndCarry(s, a) {
  const gb = s.cmd('greenberet');
  assert.equal(gb.useAbility('knockoutFist', a), true);
  s.run(1.2);
  assert.equal(a.ko, 'stunned');
  assert.equal(gb.useAbility('handcuff', a), true);
  s.run(2);
  assert.equal(a.ko, 'bound');
  assert.equal(gb.useAbility('hand', a), true);
  s.run(3, () => gb.carrying === a);
  assert.equal(gb.carrying, a, 'shouldered');
  return gb;
}

test('BCD stow: a cuffed captive carried to an enterable door goes inside (hidden, still cuffed); the carrier stays out', () => {
  const s = bcdSim({ structures: [HOUSE], commandos: [{ role: 'greenberet', x: 20, z: 21 }], enemies: [post('a', 20, 20, Math.PI)] });
  const a = s.get('a'), door = s.get('h1:door');
  assert.ok(door?.enterable, 'the house has its hideout door');
  const gb = cuffAndCarry(s, a);
  assert.equal(door.canUse(gb), true, 'the door takes a captive');
  assert.equal(gb.issue({ type: 'ability', id: 'use', target: door }), true, gb.lastRefusal?.text);
  s.run(20, () => a.hidden);
  assert.ok(a.hidden && a.state === 'hidden', `captive inside (${a.state})`);
  assert.equal(a.ko, 'bound', 'still cuffed');
  assert.equal(a.hideout, door);
  assert.ok(door.occupants.includes(a));
  assert.equal(gb.carrying, null, 'his hands are free');
  assert.ok(!gb.hidden && gb.state !== 'hidden', 'the Green Beret stays outside');
  assert.equal(s.count('load:dropped', (p) => p.how === 'stowed'), 1);
});

test('BCD stow: a comrade walking right past the door never finds the man inside (no free, no alarm)', () => {
  const s = bcdSim({ structures: [HOUSE], commandos: [{ role: 'greenberet', x: 20, z: 21 }], enemies: [post('a', 20, 20, Math.PI),
    { id: 'b', soldierType: 'soldier', x: 40, z: 38, heading: Math.PI, route: { type: 'PINGPONG', vel: 1.2, points: [{ x: 40, z: 38 }, { x: 4, z: 38 }] } }] });
  const a = s.get('a'), b = s.get('b'), door = s.get('h1:door');
  b.x = 70; b.z = 70; b.stop?.(); b.route = null; b.brain._routeType = 'STOPPED'; // out of the way while the GB works
  const gb = cuffAndCarry(s, a);
  gb.issue({ type: 'ability', id: 'use', target: door });
  s.run(20, () => a.hidden);
  assert.ok(a.hidden);
  gb.x = 75; gb.z = 5; gb.stop?.();
  // he walks past the door looking straight at it, then stands by it
  b.x = door.x + 6; b.z = door.z; b.heading = Math.PI; b.post = { x: b.x, z: b.z, heading: Math.PI, sweep: 0 };
  s.run(20);
  assert.equal(s.count('enemy:ko-found'), 0, 'nobody finds him');
  assert.equal(a.ko, 'bound');
  assert.ok(!s.alarmed(), 'no alarm');
});

test('BCD stow: only a cuffed man goes in — a stunned one, a body or a live commando do not; BEL never', () => {
  const s = bcdSim({ structures: [HOUSE], commandos: [{ role: 'greenberet', x: 20, z: 21 }], enemies: [post('a', 20, 20, Math.PI)] });
  const a = s.get('a'), w = s.world;
  const gb = s.cmd('greenberet');
  gb.useAbility('knockoutFist', a);
  s.run(1.2);
  assert.equal(stowable(a, w), false, 'stunned: not yet');
  a.ko = 'bound';
  assert.equal(stowable(a, w), true, 'cuffed');
  a.puppetOf = gb;
  assert.equal(stowable(a, w), false, 'on strings');
  a.puppetOf = null;
  assert.equal(stowable({ ...a, alive: false, kind: 'enemy', ko: 'bound' }, w), false, 'a dead man');
  assert.equal(stowable(gb, w), false, 'a commando');
  assert.equal(stowable(a, { rules: { handcuffs: false } }), false, 'BEL (no handcuffs)');
  const bel = bcdSim({ campaign: 'BEL', structures: [HOUSE], commandos: [{ role: 'greenberet', x: 20, z: 21 }], enemies: [post('c', 20, 20, Math.PI)] });
  const g2 = bel.cmd('greenberet'), c = bel.get('c'), door = bel.get('h1:door');
  c.die('knife', g2);
  g2.carrying = c; c.carriedBy = g2; c.state = 'carried';
  assert.equal(door.canUse(g2), "Can't take that inside.", 'BEL: a body never goes inside');
});

test('BCD stow: save / load keeps the captive inside, hidden and cuffed', () => {
  const s = bcdSim({ structures: [HOUSE], commandos: [{ role: 'greenberet', x: 20, z: 21 }], enemies: [post('a', 20, 20, Math.PI)] });
  const a = s.get('a'), door = s.get('h1:door');
  const gb = cuffAndCarry(s, a);
  gb.issue({ type: 'ability', id: 'use', target: door });
  s.run(20, () => a.hidden);
  const da = JSON.parse(JSON.stringify(a.serialize())), dd = JSON.parse(JSON.stringify(door.serialize()));
  a.hidden = false; a.state = 'active'; a.ko = null; a.hideout = null; door.occupants = [];
  a.deserialize(da);
  door.deserialize(dd);
  assert.ok(a.hidden && a.state === 'hidden', `state ${a.state}`);
  assert.equal(a.ko, 'bound');
  assert.equal(a.hideout, door);
  s.run(5);
  assert.equal(a.brain.state, 'BOUND');
  assert.ok(a.hidden, 'still inside after the load');
});
