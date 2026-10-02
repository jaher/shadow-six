/**
 * Carry legs: a commando carrying / dragging a body walks with his own carry / drag gait (the clip is chosen once,
 * not flipped walk ⇄ carry_walk every tick, which restarted the mixer and froze the legs), and the load's limbs swing
 * with each of his steps (art/carry-gait.js springs), settling when he stands still.
 */
import { test, assert } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { GAIT, gaitState, stepGait, gaitEnergy } from '../../src/art/carry-gait.js';

const range = (a) => Math.max(...a) - Math.min(...a);
const corr = (a, b) => {
  const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db || 1);
};
/** Walk `secs` at speed v (m/s) then stand `still` s; returns the per-frame limb angles. */
function walk(P, v, secs, still = 0, dt = 1 / 60) {
  const S = gaitState(), L = [], R = [], AL = [], AR = [];
  for (let i = 0; i < Math.round((secs + still) / dt); i++) {
    stepGait(S, i * dt < secs ? v * dt : 0, dt, P);
    L.push(S.l.a); R.push(S.r.a); AL.push(S.al.a); AR.push(S.ar.a);
  }
  return { S, L, R, AL, AR };
}

test('carry gait: walking swings the legs and arms step by step, in anti-phase', () => {
  for (const [mode, v] of [['shoulder', 1.6], ['drag', 0.8]]) {
    const P = GAIT[mode], { L, R, AL, AR } = walk(P, v, 4);
    const tail = (a) => a.slice(60);   // after the first second
    assert.ok(range(tail(L)) > 0.12 && range(tail(R)) > 0.12, `${mode}: legs swing (${range(tail(L)).toFixed(3)} rad)`);
    assert.ok(range(tail(AL)) > 0.05 && range(tail(AR)) > 0.05, `${mode}: arms swing`);
    assert.ok(corr(tail(L), tail(R)) < -0.3, `${mode}: the legs swing against each other (${corr(tail(L), tail(R)).toFixed(2)})`);
    for (const a of [...L, ...R, ...AL, ...AR]) assert.ok(Math.abs(a) <= P.max + 1e-9, `${mode}: clamped`);
  }
});

test('carry gait: the swing follows the step rate (faster walk = more cycles) and the speed (slower = smaller)', () => {
  const P = GAIT.shoulder, zc = (a) => { let n = 0; for (let i = 61; i < a.length; i++) if ((a[i - 1] < 0) !== (a[i] < 0)) n++; return n; };
  const slow = walk(P, 0.8, 5), fast = walk(P, 1.6, 5);
  assert.ok(zc(fast.L) > zc(slow.L) * 1.4, `zero crossings ${zc(fast.L)} vs ${zc(slow.L)}`);
  assert.ok(range(slow.L.slice(60)) < range(fast.L.slice(60)), 'a slow shuffle swings less');
  // the strikes come every half cycle of the travelled distance
  const S = gaitState(); let strikes = 0, h = S.half;
  for (let i = 0; i < 600; i++) { stepGait(S, 1.6 / 60, 1 / 60, P); if (S.half !== h) { strikes++; h = S.half; } }
  assert.equal(strikes, Math.floor(16 / (P.cycle / 2)));
});

test('carry gait: standing still the limbs settle (legs still), a teleport is not a step', () => {
  for (const mode of ['shoulder', 'drag']) {
    const { S, L } = walk(GAIT[mode], mode === 'drag' ? 0.8 : 1.6, 3, 2.5);
    assert.ok(gaitEnergy(S) < 0.005, `${mode}: settled (${gaitEnergy(S)})`);
    assert.ok(range(L.slice(-30)) < 0.005, `${mode}: no motion in the last half second (${range(L.slice(-30)).toFixed(4)})`);
  }
  const S = gaitState();
  stepGait(S, 25, 1 / 60, GAIT.shoulder);
  assert.equal(S.dist, 0);
  assert.equal(gaitEnergy(S), 0);
  const still = walk(GAIT.shoulder, 0, 3);
  assert.equal(Math.max(...still.L.map(Math.abs)), 0, 'never moved: never swings');
});

/** Spy on the gameplay animation names a unit sends to its model. */
function spy(u) {
  const log = [];
  const set = u.model.setAnim?.bind(u.model);
  u.model.setAnim = (n, o) => { log.push(n); return set?.(n, o); };
  return log;
}

test('carry legs: the carrier keeps carry_walk / carry_idle (no walk ⇄ carry_walk flip each tick)', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }], enemies: [guard('d', 11, 10)] }, { brains: false });
  const gb = s.cmd('greenberet'), b = s.get('d');
  b.die('knife', null);
  assert.ok(gb.issue({ type: 'ability', id: 'hand', target: b }));
  s.run(2, () => gb.carrying === b);
  assert.equal(gb.carryMode, 'shoulder');
  s.run(0.3);
  const log = spy(gb);
  assert.ok(gb.issue({ type: 'move', x: 20, z: 10 }));
  s.run(2);
  assert.equal(gb._anim, 'carry_walk');
  assert.deepEqual([...new Set(log)], ['carry_walk'], `anims while walking: ${log.slice(0, 6).join(',')}… (${log.length})`);
  assert.ok(log.length <= 2, `set ${log.length} times in 2 s`);
  s.run(6, () => !gb.path); s.run(0.5);
  assert.equal(gb._anim, 'carry_idle');
  const n = log.length; s.run(1);
  assert.equal(log.length, n, 'standing: no more anim changes');
});

test('carry legs: the dragger keeps drag_walk / drag_idle (every role that drags)', () => {
  for (const role of ['sniper', 'driver', 'greenberet']) {
    const s = makeSim({ commandos: [{ role, x: 10, z: 10 }], enemies: [guard('d', 11, 10)] }, { brains: false });
    const c = s.cmd(role), b = s.get('d');
    b.die('knife', null);
    assert.ok(c.issue({ type: 'ability', id: role === 'greenberet' ? 'drag' : 'hand', target: b }), role);
    s.run(2, () => c.carrying === b);
    assert.equal(c.carryMode, 'drag', role);
    s.run(0.3);
    assert.equal(c._anim, 'drag_idle', role);
    const log = spy(c);
    c.issue({ type: 'move', x: 16, z: 10 });
    s.run(2);
    assert.equal(c._anim, 'drag_walk', role);
    assert.deepEqual([...new Set(log)], ['drag_walk'], `${role}: ${log.slice(0, 6).join(',')}`);
    // put down: back to the plain locomotion clips
    c.issue({ type: 'cancel' });
    s.run(3, () => !c.carrying); s.run(0.6);
    c.issue({ type: 'move', x: 22, z: 10 }); s.run(0.5);
    assert.equal(c._anim, 'walk', `${role} walks again once empty-handed`);
  }
});

test('carry legs: a downed buddy on the shoulder (an ally) — the carrier keeps carry_walk', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }, { role: 'sniper', x: 11, z: 10 }] }, { brains: false });
  const gb = s.cmd('greenberet'), sn = s.cmd('sniper');
  sn.takeDamage(sn.hp, null, 'shot');
  assert.ok(sn.alive && sn.downed, 'downed');
  assert.ok(gb.issue({ type: 'ability', id: 'hand', target: sn }), gb.lastRefusal?.text);
  s.run(2, () => gb.carrying === sn);
  assert.equal(gb.carryMode, 'shoulder');
  s.run(0.3);
  const log = spy(gb);
  gb.issue({ type: 'move', x: 20, z: 10 }); s.run(1.5);
  assert.equal(gb._anim, 'carry_walk');
  assert.deepEqual([...new Set(log)], ['carry_walk'], log.slice(0, 6).join(','));
});

// ---- the dragged man's heels (groundDraggedLegs): the 35° hold pitch tipped his legs ~0.45 m into the ground
import { Bone, Object3D, Vector3 } from 'three';
import { groundDraggedLegs, dragGroundWeight, DRAG_HEEL } from '../../src/art/transport-pose.js';

/** A pelvis at (0, 0.14, 0) with two straight legs (0.45 + 0.45 m) pointing back along -z, `pitch` rad below level. */
function dragRig(pitch, ground = () => 0) {
  const root = new Object3D(), S = {};
  for (const [s, x] of [['l', 0.1], ['r', -0.1]]) {
    const th = new Bone(), ca = new Bone(), ft = new Bone();
    th.position.set(x, 0.14, 0); root.add(th);
    th.add(ca); ca.position.set(0, -Math.sin(pitch) * 0.45, -Math.cos(pitch) * 0.45);
    ca.add(ft); ft.position.set(0, -Math.sin(pitch) * 0.45 - 0.02, -Math.cos(pitch) * 0.45); // a slight knee bend
    Object.assign(S, { ['thigh_' + s]: th, ['calf_' + s]: ca, ['foot_' + s]: ft });
  }
  root.updateMatrixWorld(true);
  const model = { real: { getSocket: (n) => S[n] } }, u = { y: 0, world: { groundY: ground } };
  const ankle = (s) => S['foot_' + s].getWorldPosition(new Vector3());
  return { model, u, ankle, S };
}

test('carry-legs: a dragged man\'s buried heels are swung up onto the ground, however deep', () => {
  for (const pitch of [0.2, 0.6, 0.9]) {
    const { model, u, ankle } = dragRig(pitch);
    assert.ok(ankle('l').y < -0.05, `buried before (${ankle('l').y.toFixed(2)})`);
    for (let i = 0; i < 3; i++) groundDraggedLegs(model, u, 1 / 60);
    for (const s of ['l', 'r']) {
      const a = ankle(s);
      assert.ok(Math.abs(a.y - DRAG_HEEL) < 0.01, `pitch ${pitch}: ankle ${s} at ${a.y.toFixed(3)} m`);
      assert.ok(a.z < -0.75, `the leg still trails behind (${a.z.toFixed(2)})`);
    }
  }
});

test('carry-legs: dragged heels follow a rise at once and settle into a dip', () => {
  let h = 0;
  const { model, u, ankle } = dragRig(0.6, () => h);
  groundDraggedLegs(model, u, 1 / 60);
  h = 0.1; // a bump under the heels: lifted the same frame
  groundDraggedLegs(model, u, 1 / 60);
  assert.ok(ankle('l').y >= 0.1 + DRAG_HEEL - 0.01, `on the bump (${ankle('l').y.toFixed(3)})`);
  h = -0.1; // a dip: the heels lag, then settle
  groundDraggedLegs(model, u, 1 / 60);
  const y1 = ankle('l').y;
  assert.ok(y1 > 0.1, `lags behind the dip (${y1.toFixed(3)})`);
  for (let i = 0; i < 90; i++) groundDraggedLegs(model, u, 1 / 60);
  assert.ok(Math.abs(ankle('l').y - (-0.1 + DRAG_HEEL)) < 0.02, `settled (${ankle('l').y.toFixed(3)})`);
});

test('carry-legs: heel grounding eases in / out of the drag without a jump', () => {
  assert.equal(dragGroundWeight({ kind: 'hold', from: 'drag', k: 1 }), 1);
  assert.equal(dragGroundWeight({ kind: 'hold', from: 'shoulder', k: 1 }), 0);
  for (const kind of ['grab', 'toDrag']) {
    assert.equal(dragGroundWeight({ kind, k: 0 }), 0, kind);
    assert.equal(dragGroundWeight({ kind, k: 1 }), 1, kind);
  }
  for (const kind of ['release', 'toShoulder']) {
    assert.equal(dragGroundWeight({ kind, k: 0 }), 1, kind);
    assert.equal(dragGroundWeight({ kind, k: 1 }), 0, kind);
  }
  assert.equal(dragGroundWeight({ kind: 'lift', k: 0.5 }), 0);
});

test('carry-legs: a half-weighted transition never puts a heel under the ground', () => {
  const { model, u, ankle } = dragRig(0.9);
  groundDraggedLegs(model, u, 1 / 60, null, 0.3);
  assert.ok(ankle('l').y > DRAG_HEEL * 0.5 - 0.01, `${ankle('l').y.toFixed(3)}`);
});

test('carry-legs: lowered from the shoulder into a drag, the heels aim at the ground, not the shoulder height', () => {
  // toDrag: the load's own y is still the carry height (1.2 m) — the ground level is the transporter's (ey = 0)
  const { model, u, ankle } = dragRig(0.6);
  u.y = 1.2;
  for (let i = 0; i < 3; i++) groundDraggedLegs(model, u, 1 / 60, null, 0.8, 0);
  for (const s of ['l', 'r']) assert.ok(ankle(s).y < 0.3, `ankle ${s} kicked up to ${ankle(s).y.toFixed(3)} m`);
  for (const s of ['l', 'r']) assert.ok(ankle(s).y > -0.01, `ankle ${s} under the snow (${ankle(s).y.toFixed(3)})`);
});

test('carry-legs: through the rest of a transition (weight 0) an ankle is lifted out of the snow, a lying one is left', () => {
  const { model, u, ankle } = dragRig(0.6);
  assert.ok(ankle('l').y < -0.3);
  groundDraggedLegs(model, u, 1 / 60, null, 0);
  for (const s of ['l', 'r']) assert.ok(ankle(s).y > -0.011 && ankle(s).y < 0.03, `ankle ${s} at ${ankle(s).y.toFixed(3)}`);
  const flat = dragRig(-0.15); // legs lying above the ground: untouched
  const before = flat.ankle('l').clone();
  groundDraggedLegs(flat.model, flat.u, 1 / 60, null, 0);
  assert.ok(flat.ankle('l').distanceTo(before) < 1e-6);
});
