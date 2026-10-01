/** bodies-design §C.1–§C.5, §E: drag and shoulder carry under the SHADOW SIX house rules (and the 1998 contrast). */
import { test, assert, near } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { CONFIG } from '../../src/config.js';
import { angleDiff } from '../../src/core/math.js';
import { bcdSim, post } from './bcd-sim.mjs';

const SIX = ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy'];
const deadGuard = (s, id) => { const b = s.get(id); b.die('knife', null); return b; };

test('drag: every commando can drag under shadowSix (H → drag for non GB/Spy), guests cannot', () => {
  for (const role of SIX) {
    const s = makeSim({ commandos: [{ role, x: 10, z: 10 }], enemies: [guard('d', 11, 11)] }, { brains: false });
    const c = s.cmd(role), b = deadGuard(s, 'd');
    assert.ok(c.abilities.includes('drag'), `${role} has drag`);
    assert.ok(c.issue({ type: 'ability', id: role === 'greenberet' || role === 'spy' ? 'drag' : 'hand', target: b }), role);
    s.run(3, () => c.carrying === b);
    assert.equal(c.carrying, b, role);
    assert.equal(c.carryMode, 'drag', role);
    assert.equal(b.state, 'carried');
    assert.equal(b.carriedBy, c);
  }
  const g = makeSim({ commandos: [{ role: 'guest', x: 10, z: 10 }], enemies: [guard('d', 11, 11)] }, { brains: false });
  const guest = g.cmd('guest');
  assert.ok(!guest.abilities.includes('drag'));
  assert.equal(guest.issue({ type: 'ability', id: 'hand', target: deadGuard(g, 'd') }), false);
});

test('drag: GB/Spy H = shoulder carry (1.0 s), Shift+H (drag) = drag; the grab takes 1.0 s', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }], enemies: [guard('d', 11, 10)] }, { brains: false });
  const gb = s.cmd('greenberet'), b = deadGuard(s, 'd');
  assert.ok(gb.issue({ type: 'ability', id: 'hand', target: b }));
  s.run(0.95);
  assert.equal(gb.carrying, null, 'not before 1.0 s');
  s.run(0.3);
  assert.equal(gb.carryMode, 'shoulder');
  near(gb.speed, CONFIG.units.carry, 1e-9);
});

test('drag: 0.8 m/s, a run order walks, heads backwards, body 0.95 m behind on walkable ground, no links / swim', () => {
  const s = makeSim({ commandos: [{ role: 'sniper', x: 10, z: 10 }], enemies: [guard('d', 11, 10)] }, { brains: false });
  const c = s.cmd('sniper'), b = deadGuard(s, 'd');
  c.issue({ type: 'ability', id: 'hand', target: b });
  s.run(2, () => c.carrying === b);
  assert.ok(c.issue({ type: 'move', x: 30, z: 10, run: true }));
  assert.equal(c.moveMode, 'walk');
  near(c.speed, CONFIG.bodies.drag.speed, 1e-9);
  assert.equal(c.pathQuery().noLinks, true);
  assert.equal(c.pathQuery().swim, false);
  const x0 = c.x;
  s.run(5);
  near(c.x - x0, 4.0, 0.25); // 5 s at 0.8 m/s (a little turning at the start)
  assert.ok(Math.abs(angleDiff(c.heading, Math.PI)) < 0.05, `faces back along the path (${c.heading})`);
  const pathDir = { x: 1, z: 0 };
  near(b.x, c.x - CONFIG.bodies.drag.offset * pathDir.x, 0.02);
  near(b.z, c.z, 0.02);
  assert.ok(s.world.grid.walkableAt(b.x, b.z));
});

test('drag: no buildings, no vehicles, no other ability while dragging ("Drop it first.")', () => {
  const s = makeSim({ commandos: [{ role: 'driver', x: 10, z: 10 }], enemies: [guard('d', 11, 10), guard('e', 20, 20)], vehicles: [{ id: 't', vehicleType: 'truck', x: 20, z: 12 }] }, { brains: false });
  const c = s.cmd('driver'), b = deadGuard(s, 'd');
  c.issue({ type: 'ability', id: 'hand', target: b });
  s.run(2, () => c.carrying === b);
  assert.equal(c.issue({ type: 'ability', id: 'enterVehicle', target: s.get('t') }), false);
  assert.equal(c.issue({ type: 'ability', id: 'smg', target: s.get('e') }), false);
  assert.equal(c.issue({ type: 'stance', stance: 'crawl' }), false);
});

test('drag: right-click releases in 0.6 s, the body lies where he was dragged (load:dropped gentle)', () => {
  const s = makeSim({ commandos: [{ role: 'sapper', x: 10, z: 10 }], enemies: [guard('d', 11, 10)] }, { brains: false });
  const c = s.cmd('sapper'), b = deadGuard(s, 'd');
  c.issue({ type: 'ability', id: 'hand', target: b });
  s.run(2, () => c.carrying === b);
  c.issue({ type: 'move', x: 20, z: 10 });
  s.run(3);
  const at = { x: b.x, z: b.z };
  const drops = [];
  s.world.events.on('load:dropped', (p) => drops.push(p));
  assert.ok(c.issue({ type: 'cancel' }));
  s.run(0.55);
  assert.equal(c.carrying, b, 'still holding at 0.55 s');
  s.run(0.1);
  assert.equal(c.carrying, null);
  assert.equal(b.state, 'dead');
  assert.equal(c.carryMode, null);
  near(b.x, at.x, 0.05); near(b.z, at.z, 0.05);
  assert.equal(drops[0]?.how, 'gentle');
});

test('drag ↔ shoulder: H as GB lifts in 1.0 s; as the Sniper it is refused with the reason; Shift+H lowers in 0.8 s', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }, { role: 'sniper', x: 10, z: 20 }], enemies: [guard('d', 11, 10), guard('d2', 11, 20)] }, { brains: false });
  const gb = s.cmd('greenberet'), sn = s.cmd('sniper');
  gb.issue({ type: 'ability', id: 'drag', target: deadGuard(s, 'd') });
  sn.issue({ type: 'ability', id: 'hand', target: deadGuard(s, 'd2') });
  s.run(2, () => gb.carrying && sn.carrying);
  assert.equal(gb.carryMode, 'drag');
  assert.ok(gb.issue({ type: 'ability', id: 'carryToggle', target: gb }));
  s.run(0.95);
  assert.equal(gb.carryMode, 'drag');
  s.run(0.1);
  assert.equal(gb.carryMode, 'shoulder');
  assert.equal(sn.issue({ type: 'ability', id: 'carryToggle', target: sn }), false);
  assert.equal(sn.lastRefusal.text, 'Only the Green Beret and the Spy can shoulder a man.');
  assert.ok(gb.issue({ type: 'ability', id: 'carryToggle', target: gb }));
  s.run(0.75);
  assert.equal(gb.carryMode, 'shoulder');
  s.run(0.1);
  assert.equal(gb.carryMode, 'drag');
  assert.equal(gb.carrying.state, 'carried');
});

test('drop when shot: with dropWhenShot the load falls at once; under the 1998 rules he keeps it', () => {
  for (const on of [true, false]) {
    const s = makeSim({ houseRules: { dropWhenShot: on }, commandos: [{ role: 'greenberet', x: 10, z: 10 }], enemies: [guard('d', 11, 10), guard('e', 20, 10)] }, { brains: false });
    const gb = s.cmd('greenberet'), b = deadGuard(s, 'd');
    gb.issue({ type: 'ability', id: 'hand', target: b });
    s.run(2, () => gb.carrying === b);
    const drops = [];
    s.world.events.on('load:dropped', (p) => drops.push(p));
    gb.takeDamage(30, s.get('e'), 'shot');
    assert.equal(!!gb.carrying, !on, `dropWhenShot ${on}`);
    if (on) { assert.equal(drops[0].how, 'shot'); assert.equal(b.state, 'dead'); assert.ok(b.x < gb.x, 'knocked off away from the shooter'); }
  }
});

test('BCD: a dragged knock-out who wakes is dropped at once; a cuffed man stays bound while dragged', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 20, z: 21 }], enemies: [post('a', 20, 20, Math.PI)] });
  const gb = s.cmd('greenberet'), e = s.get('a');
  gb.useAbility('knockoutFist', e);
  s.run(1.5);
  assert.equal(e.ko, 'stunned');
  assert.ok(gb.useAbility('drag', e), gb.lastRefusal?.text);
  s.run(2, () => gb.carrying === e);
  assert.equal(gb.carryMode, 'drag');
  s.run(CONFIG.bcd.koDuration);
  assert.equal(e.ko, null, 'woke');
  assert.equal(gb.carrying, null);
  assert.equal(gb.carryMode, null);
  assert.equal(e.carriedBy, null);
  const t = bcdSim({ commandos: [{ role: 'greenberet', x: 20, z: 21 }], enemies: [post('a', 20, 20, Math.PI)] });
  const g2 = t.cmd('greenberet'), e2 = t.get('a');
  g2.useAbility('knockoutFist', e2); t.run(1.2);
  g2.useAbility('handcuff', e2); t.run(2);
  assert.equal(e2.ko, 'bound');
  assert.ok(g2.useAbility('drag', e2), g2.lastRefusal?.text);
  t.run(2, () => g2.carrying === e2);
  g2.issue({ type: 'move', x: 30, z: 30 });
  t.run(40);
  assert.equal(e2.ko, 'bound');
  assert.equal(g2.carrying, e2);
  g2.issue({ type: 'cancel' }); t.run(1);
  assert.equal(e2.ko, 'bound', 'still bound when put down');
  assert.equal(e2.carriedBy, null);
});

/** A sniper dragging the dead guard 'd' at (10, 10), facing +x; returns {s, c, b}. */
function dragging() {
  const s = makeSim({ commandos: [{ role: 'sniper', x: 10, z: 10 }], enemies: [guard('d', 11, 10)] }, { brains: false });
  const c = s.cmd('sniper'), b = deadGuard(s, 'd');
  c.issue({ type: 'ability', id: 'hand', target: b });
  s.run(2, () => c.carrying === b);
  s.run(0.5);
  return { s, c, b };
}

test('drag tow: turning in place does not swing the body around him (trailing link, eased yaw)', () => {
  const { c, b } = dragging();
  const x0 = b.x, z0 = b.z, dt = 1 / 60;
  let maxStep = 0, maxYawStep = 0;
  for (let i = 0; i < 60; i++) { // 180° at the 180°/s cap
    const px = b.x, pz = b.z, ph = b.heading;
    c.heading += Math.PI * dt;
    c._updateCarried(dt);
    maxStep = Math.max(maxStep, Math.hypot(b.x - px, b.z - pz));
    maxYawStep = Math.max(maxYawStep, Math.abs(angleDiff(b.heading, ph)));
  }
  assert.ok(maxStep < 0.03, `pelvis step ${maxStep.toFixed(3)} m/tick (a rigid 0.95 m arm moves 0.05)`);
  assert.ok(maxYawStep < 0.06, `yaw step ${maxYawStep.toFixed(3)} rad/tick`);
  assert.ok(Math.hypot(b.x - x0, b.z - z0) < 1.2, 'he is pulled round, not flung to the far side');
  const h = c.dragHands(), D = CONFIG.bodies.drag;
  assert.ok(Math.hypot(b.x - c.x, b.z - c.z) >= 0.3, 'never under the dragger');
  assert.ok(Math.hypot(b.x - h.x, b.z - h.z) <= D.offset - D.reach + 0.2, 'still in his hands');
});

test('drag tow: the body follows the travelled path round a corner; never through a fence or off a raised edge', () => {
  const { s, c, b } = dragging();
  const g = s.world.grid;
  // a fence line just ahead of him: the link may not cross it
  g.fillRect(11.4, 5, 0.5, 10, 'block', 3);
  for (let i = 0; i < 30; i++) { c.heading = (i / 30) * 0.8 - 0.4; c._updateCarried(1 / 60); }
  assert.ok(b.x < 11.4, `stays on his side of the fence (${b.x.toFixed(2)})`);
  assert.ok(g.walkableLine(c.x, c.z, b.x, b.z), 'clear line from the dragger');
  assert.ok(Math.hypot(b.x - c.x, b.z - c.z) >= 0.3, 'never on top of the dragger');
  // a raised platform edge: he backs onto a 3 m deck, the body never hangs below the edge
  const t = dragging();
  const G = t.s.world.grid;
  for (let j = 0; j < G.rows; j++) for (let i = 0; i < G.cols; i++) if ((i + 0.5) * G.cell < 9.5) G.elev[G.idx(i, j)] = 3;
  t.c.moveTo(5, 10);
  for (let k = 0; k < 300; k++) {
    t.s.step();
    const e = G.elevAt(t.c.x, t.c.z), eb = G.elevAt(t.b.x, t.b.z);
    assert.ok(Math.abs(e - eb) <= 0.6, `same level as the dragger (${e} vs ${eb})`);
  }
});
