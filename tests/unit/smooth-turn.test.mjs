/**
 * SHADOW SIX smooth turn (enemy-brain _turnTo / _turnStep, CONFIG.ai.turn; view side art/turn-step.js): a guard who
 * hears running steps (or a shot, a bark, "Halt!", a lure…) turns round on the spot at an eased, steady rate instead
 * of BEL's one-tick snap; the cone turns with him, so he only sees what it actually sweeps over. Headless sims on the
 * exact 60 Hz / 20 Hz time base.
 */
import * as THREE from 'three';
import { test, assert, near } from './lib.mjs';
import { makeWorld, addEnemy, addCommando, run, first, DT } from './ai-harness.mjs';
import { CONFIG } from '../../src/config.js';
import { angleDiff, angleTo } from '../../src/core/math.js';
import { coneAt, pointInCone } from '../../src/ai/perception.js';
import { turnStep, STEP } from '../../src/art/turn-step.js';
import { BoneGuard } from '../../src/art/pose-blend.js';

const DEG = Math.PI / 180;
const TC = CONFIG.ai.turn;
const RATE = CONFIG.ai.bodyTurnDeg * DEG; // cruise (rad/s)
const ACC = TC.accel * DEG;
// a sentry at (30, 30) looking east (+x), head fixed (no sweep)
const SENTRY = { id: 'g', soldierType: 'sentry', x: 30, z: 30, heading: 0, post: { heading: 0, sweep: 0 } };

/** Emit a noise and record the guard's heading every step until his turn is over (≤ secs). */
function turnTrace(w, e, x, z, kind = 'footsteps', secs = 2.5) {
  w.emitNoise(x, z, 10, kind, null, kind === 'footsteps' ? 1 : undefined);
  const hs = [e.heading];
  const cones = [coneAt(e).heading];
  for (let i = 0; i < Math.round(secs / DT); i++) {
    run(w, DT);
    hs.push(e.heading);
    cones.push(coneAt(e).heading);
    if (!e.brain.turn && i > 2) break;
  }
  return { hs, cones, steps: hs.slice(1).map((h, k) => angleDiff(hs[k], h)) };
}

test('smooth turn: a sentry turns round to steps behind him — eases in, cruises at 180°/s, brakes onto the bearing; 180° in ≈ 1.15 s, never a snap', () => {
  const w = makeWorld({ size: [60, 60], enemies: [SENTRY] });
  const g = w.enemies[0];
  run(w, 0.2);
  const { hs, steps } = turnTrace(w, g, 24, 30); // straight behind (bearing π)
  near(hs[0], 0, 1e-12, 'the noise itself turns nothing');
  const dur = steps.length * DT;
  assert.ok(dur >= 1.05 && dur <= 1.25, `180° about-turn in ${dur.toFixed(3)} s`);
  near(Math.abs(g.heading), Math.PI, 1e-9, 'on the bearing at the end');
  const sgn = Math.sign(steps[Math.floor(steps.length / 2)]);
  assert.ok(steps.every((d) => d * sgn >= -1e-12), 'one way round, no overshoot');
  const max = Math.max(...steps.map(Math.abs));
  assert.ok(max <= RATE * DT + 1e-9, `never faster than bodyTurnDeg (${(max / DT / DEG).toFixed(1)}°/s)`);
  near(max / DT, RATE, 1e-6, 'cruises at 180°/s');
  assert.ok(Math.abs(steps[0]) <= ACC * DT * DT + 1e-9, `eases in (${(steps[0] / DT / DEG).toFixed(1)}°/s on the first step)`);
  for (let k = 1; k < steps.length - 1; k++) assert.ok(Math.abs(Math.abs(steps[k]) - Math.abs(steps[k - 1])) <= ACC * DT * DT + 1e-9, `step ${k}: speed changes by ≤ accel·dt`);
  const tail = steps.slice(-12, -1).map((d) => Math.abs(d) / DT / DEG);
  assert.ok(tail.every((v, k) => !k || v <= tail[k - 1] + 1e-9) && tail.at(-1) < 60, `eases out (${tail.map((v) => v.toFixed(0)).join(' ')}°/s over his last 0.2 s)`);
  // in between: a steady sweep, e.g. a quarter / half / three quarters of the way at sensible times
  const at = (frac) => steps.findIndex((_, k) => Math.abs(hs[k + 1]) >= frac * Math.PI) * DT;
  assert.ok(at(0.25) > 0.2 && at(0.5) > 0.45 && at(0.75) > 0.7 && at(0.75) < dur, `quarter ${at(0.25).toFixed(2)} / half ${at(0.5).toFixed(2)} / ¾ ${at(0.75).toFixed(2)} s`);
  // shorter turns are quicker: 90° ≈ 0.65 s, 45° ≈ 0.4 s
  for (const [deg, lo, hi] of [[90, 0.55, 0.75], [45, 0.32, 0.48]]) {
    const w2 = makeWorld({ size: [60, 60], enemies: [SENTRY] });
    const g2 = w2.enemies[0];
    run(w2, 0.2);
    const t = turnTrace(w2, g2, 30 + 6 * Math.cos(deg * DEG), 30 + 6 * Math.sin(deg * DEG));
    const d2 = t.steps.length * DT;
    assert.ok(d2 >= lo && d2 <= hi, `${deg}° in ${d2.toFixed(3)} s`);
    near(g2.heading, deg * DEG, 1e-9);
  }
});

test('smooth turn: shots, barks, "Halt!", alarm shouts and lures turn a post-holder the same way (no snap); the lure still flags enemy:noise-turn', () => {
  for (const kind of ['pistol', 'rifle', 'bark', 'halt', 'alarmShout', 'explosion', 'decoy', 'phone', 'horn']) {
    const w = makeWorld({ size: [60, 60], enemies: [{ ...SENTRY, flags: { holdsPost: true } }] });
    const g = w.enemies[0];
    run(w, 0.2);
    const turns = [];
    w.events.on('enemy:noise-turn', (p) => turns.push(p));
    const { steps } = turnTrace(w, g, 30, 36, kind); // 90° to his right
    const max = Math.max(...steps.map(Math.abs));
    assert.ok(max <= RATE * DT + 1e-9 && steps.length > 20, `${kind}: smooth (${steps.length} steps, max ${(max / DT / DEG).toFixed(0)}°/s)`);
    near(g.heading, Math.PI / 2, 1e-9, kind);
    assert.equal(turns.length, ['decoy', 'phone', 'horn'].includes(kind) ? 1 : 0, `${kind}: noise-turn flag`);
  }
});

test('smooth turn: the cone turns with him — continuous, no jump; the head sweep stops for the turn and fades back in, centred on the noise', () => {
  // a sweeping sentry (±50°, 5 s): the noise comes when his head is well off-centre
  const w = makeWorld({ size: [60, 60], enemies: [{ id: 'g', soldierType: 'sentry', x: 30, z: 30, heading: 0, post: { heading: 0 } }] });
  const g = w.enemies[0];
  let k0 = 0;
  run(w, 4, () => Math.abs(angleDiff(g.heading, coneAt(g).heading)) > 40 * DEG && ++k0 > 0);
  const off0 = angleDiff(g.heading, coneAt(g).heading);
  assert.ok(Math.abs(off0) > 40 * DEG, `head swept ${(off0 / DEG).toFixed(0)}° off when the noise comes`);
  const cones = [coneAt(g).heading];
  w.emitNoise(24, 31, 10, 'footsteps', null, 1); // behind him
  cones.push(coneAt(g).heading);
  for (let i = 0; i < Math.round(3.5 / DT); i++) { run(w, DT); cones.push(coneAt(g).heading); }
  const jumps = cones.slice(1).map((h, k) => Math.abs(angleDiff(cones[k], h)) / DEG);
  near(jumps[0], 0, 1e-9, 'hearing it moves no cone');
  const maxJ = Math.max(...jumps);
  // body ≤ 3°/step + head carry ≤ headRate·dt + sweep fade/swing ≈ 2°: a snap would be 100°+
  assert.ok(maxJ <= (RATE / DEG + TC.headRate) * DT + 2.5, `cone moves ≤ ${maxJ.toFixed(2)}° a step`);
  near(g.heading, angleTo(30, 30, 24, 31), 1e-9, 'faces the step');
  assert.equal(g.sweepW, 1, 'the sweep is back in full');
  assert.ok(g.sweepActive && g.brain.noiseTurnT > 0, 'sweeping round the noise bearing for the noise hold');
  assert.equal(g.headCarry || 0, 0, 'no head carry left');
  // an investigator looking round (head ±90°) who hears a step: the same, no jump
  const w2 = makeWorld({ size: [60, 60], enemies: [{ id: 'p', soldierType: 'soldier', x: 30, z: 30, heading: 0 }] });
  const p = w2.enemies[0];
  w2.emitNoise(36, 30, 10, 'footsteps', null, 1);
  run(w2, 8, () => p.brain.phase === 'look' && Math.abs(p.headOffset) > 60 * DEG);
  assert.equal(p.brain.phase, 'look');
  const c2 = [coneAt(p).heading];
  w2.emitNoise(p.x - 4, p.z - 3, 10, 'footsteps', null, 1);
  c2.push(coneAt(p).heading);
  assert.equal(p.brain.phase, 'turn');
  for (let i = 0; i < 90; i++) { run(w2, DT); c2.push(coneAt(p).heading); }
  const j2 = Math.max(...c2.slice(1).map((h, k) => Math.abs(angleDiff(c2[k], h)) / DEG));
  assert.ok(j2 <= (RATE / DEG + TC.headRate) * DT + 1, `look-round head comes round with the body (≤ ${j2.toFixed(2)}° a step)`);
});

test('smooth turn: he sees only what the cone sweeps over — a runner who ducks out of sight in time is not seen (BEL\'s instant turn would catch him)', () => {
  const play = (instant) => {
    const save = { accel: TC.accel, rate: CONFIG.ai.bodyTurnDeg };
    if (instant) { TC.accel = 1e9; CONFIG.ai.bodyTurnDeg = 1e9; }
    try {
      const w = makeWorld({ size: [60, 60], enemies: [SENTRY] });
      const g = w.enemies[0];
      const c = addCommando(w, 'greenberet', 24, 34); // 7.2 m behind his left shoulder, in the open
      run(w, 0.2);
      let seenT = null, uncovered = 0;
      w.emitNoise(c.x, c.z, 10, 'footsteps', c, 1);
      const t0 = w.time;
      run(w, 2, () => {
        if (g.brain._seen.some((s) => s.unit === c)) {
          seenT ??= w.time - t0;
          if (!pointInCone(coneAt(g), c.x, c.z)) uncovered++;
        }
        if (w.time - t0 >= 0.45 && !c.hidden) c.hidden = true; // ducks into a doorway / goes to ground
        return false;
      });
      return { seenT, uncovered, h: g.heading, challenged: !!first(w, 'enemy:challenge') };
    } finally { TC.accel = save.accel; CONFIG.ai.bodyTurnDeg = save.rate; }
  };
  const smooth = play(false), snap = play(true);
  assert.equal(smooth.seenT, null, 'the smooth turn: not seen — gone before the cone came round');
  assert.ok(Math.abs(angleDiff(smooth.h, angleTo(30, 30, 24, 34))) < 1e-6, 'he did turn to the sound');
  assert.ok(snap.seenT != null && snap.seenT < 0.1, `an instant turn sees him at once (${snap.seenT})`);
  assert.equal(snap.uncovered, 0, 'seen only inside the cone');
  // and a runner who stays out in the open is seen the moment the cone reaches him, not before
  const w = makeWorld({ size: [60, 60], enemies: [SENTRY] });
  const g = w.enemies[0];
  const c = addCommando(w, 'greenberet', 24, 34);
  run(w, 0.2);
  w.emitNoise(c.x, c.z, 10, 'footsteps', c, 1);
  let first2 = null, coveredBefore = false;
  run(w, 2, () => {
    const inCone = !!pointInCone(coneAt(g), c.x, c.z);
    if (g.brain._seen.some((s) => s.unit === c)) { first2 ??= w.time; return true; }
    if (inCone) coveredBefore = true;
    return false;
  });
  assert.ok(first2 != null, 'seen once the cone reaches him');
  assert.ok(!coveredBefore, 'not a step later than the cone covered him');
  const reach = Math.abs(angleDiff(g.heading, angleTo(30, 30, 24, 34)));
  assert.ok(reach <= CONFIG.stealth.vision.soldier.fov * DEG / 2 + 0.06, `the cone edge reached him (${(reach / DEG).toFixed(1)}° off his heading)`);
});

test('smooth turn: an MG gunner turns inside his traverse, round through its arc (never through the back), and stops at its edge', () => {
  const w = makeWorld({ size: [60, 60], enemies: [{ id: 'mg', soldierType: 'mg', x: 30, z: 30, heading: 130 * DEG, post: { heading: 0, sweep: 0, giro: 270 } }] });
  const e = w.enemies[0];
  e.post.heading = 0;
  run(w, 0.2);
  const inArc = (h) => Math.abs(angleDiff(0, h)) <= 135 * DEG + 1e-6;
  // −130° is 100° away through the back (outside the ±135° traverse) but 260° round through the arc
  const t = turnTrace(w, e, 30 + 6 * Math.cos(-130 * DEG), 30 + 6 * Math.sin(-130 * DEG), 'pistol', 4);
  assert.ok(t.hs.every(inArc), 'every heading inside the traverse');
  assert.ok(t.steps.every((d) => d <= 1e-12), 'turned clockwise through 0°');
  near(e.heading, -130 * DEG, 1e-9);
  // straight behind (180°): clamped to the edge of the traverse
  const w2 = makeWorld({ size: [60, 60], enemies: [{ id: 'mg', soldierType: 'mg', x: 30, z: 30, heading: 0, post: { heading: 0, sweep: 0, giro: 90 } }] });
  const m2 = w2.enemies[0];
  const t2 = turnTrace(w2, m2, 24, 30.01, 'pistol');
  assert.ok(t2.hs.every((h) => Math.abs(h) <= 45 * DEG + 1e-6));
  near(Math.abs(m2.heading), 45 * DEG, 1e-6, 'at the edge of his 90° traverse');
});

test('smooth turn: a save mid-turn loads the same turn — heading, cone, sweep weight and head carry tick for tick', () => {
  const SW = { id: 'g', soldierType: 'sentry', x: 30, z: 30, heading: 0, post: { heading: 0 } }; // sweeping head
  const a = makeWorld({ size: [60, 60], enemies: [SW] });
  const ga = a.enemies[0];
  run(a, 1.3);
  a.emitNoise(24, 31, 10, 'footsteps', null, 1);
  run(a, 0.4);
  assert.ok(ga.brain.turn && Math.abs(ga.brain.turn.w) > 1, 'mid-turn, at speed');
  assert.ok(Math.abs(ga.headCarry) > 1e-3, 'with a head carry');
  const d = JSON.parse(JSON.stringify(ga.serialize()));
  assert.ok(d.brain.turn && d.sweepW === 0 && d.headCarry !== 0, 'turn state saved');
  const b = makeWorld({ size: [60, 60], enemies: [SW] });
  b.time = a.time; b.tick = a.tick;
  const gb = b.enemies[0];
  gb.deserialize(d);
  const rec = (w, e) => { const out = []; for (let i = 0; i < 150; i++) { run(w, DT); out.push([e.heading, coneAt(e).heading, e.sweepW, e.headCarry, e.brain.turn?.w ?? null]); } return out; };
  assert.deepEqual(rec(b, gb), rec(a, ga), 'identical continuation');
  assert.equal(ga.brain.turn, null);
});

test('smooth turn: a route walker stops, turns on the spot, walks over, looks round — then his patrol route resumes', () => {
  const route = [{ x: 30, z: 30 }, { x: 50, z: 30 }];
  const w = makeWorld({ size: [60, 60], enemies: [{ id: 'r', soldierType: 'soldier', x: 30, z: 30, heading: 0, route }] });
  const r = w.enemies[0];
  run(w, 1);
  assert.ok(r.isMoving && r.x > 30.5, 'walking his route');
  const p0 = { x: r.x, z: r.z };
  w.emitNoise(r.x - 6, r.z + 3, 10, 'footsteps', null, 1);
  assert.equal(r.brainState, 'INVESTIGATE');
  assert.equal(r.brain.phase, 'turn');
  let moved = 0;
  run(w, 1.5, () => { if (r.brain.phase === 'turn') moved = Math.max(moved, Math.hypot(r.x - p0.x, r.z - p0.z)); return !r.brain.turn; });
  assert.ok(moved < 1e-6, `turned on the spot (${moved.toFixed(3)} m)`);
  assert.equal(r.brain.phase, 'go', 'then sets off');
  run(w, 20, () => r.brainState === 'RETURN');
  assert.equal(r.brainState, 'RETURN');
  run(w, 20, () => r.brainState === 'IDLE');
  assert.equal(r.brainState, 'IDLE', 'back on his route');
  const x0 = r.x;
  run(w, 4);
  assert.ok(r.isMoving && Math.abs(r.x - x0) > 2, 'patrolling again');
  assert.equal(r.brain.turn, null);
});

test('smooth turn: a decoy draws a walker — he turns round to it first, then walks to it; a post-holder\'s turn back to his post heading is eased too', () => {
  const w = makeWorld({ size: [60, 60], enemies: [{ id: 'v', soldierType: 'soldier', x: 30, z: 30, heading: 0, flags: { investigates: true } }] });
  const v = w.enemies[0];
  run(w, 0.3);
  w.emitNoise(22, 30, 13.5, 'decoy', null);
  assert.equal(v.brainState, 'DECOY');
  assert.equal(v.brain.phase, 'turn');
  const p0 = { x: v.x, z: v.z };
  const hs = [v.heading];
  let moved = 0;
  run(w, 1.5, () => { hs.push(v.heading); if (v.brain.phase === 'turn') moved = Math.max(moved, Math.hypot(v.x - p0.x, v.z - p0.z)); return !v.brain.turn; });
  near(moved, 0, 1e-6, 'turned on the spot');
  assert.ok(hs.slice(1).every((h, k) => Math.abs(angleDiff(hs[k], h)) <= RATE * DT + 1e-9), 'smoothly');
  run(w, 0.3);
  assert.equal(v.brain.phase, 'go');
  assert.ok(v.isMoving, 'walks to the lure');
  // a post-holder's noise hold ends: back to his post heading at the eased rate
  const w2 = makeWorld({ size: [60, 60], enemies: [{ ...SENTRY, flags: { holdsPost: true } }] });
  const g = w2.enemies[0];
  run(w2, 0.2);
  w2.emitNoise(30, 36, 10, 'pistol', null);
  run(w2, CONFIG.ai.noiseTurnHold - 0.2);
  near(g.heading, Math.PI / 2, 1e-9, 'still on the noise at the end of the hold');
  run(w2, 0.2, () => !!g.brain.turn);
  const back = [g.heading];
  run(w2, 1.5, () => { back.push(g.heading); return Math.abs(g.heading) < 1e-9 && !g.brain.turn; });
  const st = back.slice(1).map((h, k) => Math.abs(angleDiff(back[k], h)));
  near(g.heading, 0, 1e-9, 'back on his post heading');
  assert.ok(st[0] <= ACC * DT * DT + 1e-9 && Math.max(...st) <= RATE * DT + 1e-9, 'eased, ≤ 180°/s');
});

test('smooth turn: "Halt!" — the cone swings onto the commando at aimRate and stays on him while the body comes round under it (no body snap)', () => {
  const w = makeWorld({ size: [60, 60], enemies: [{ id: 'g', soldierType: 'soldier', x: 30, z: 30, heading: 0, post: { heading: 0, sweep: 0 } }] });
  const g = w.enemies[0];
  const c = addCommando(w, 'greenberet', 30 + 8 * Math.cos(30 * DEG), 30 + 8 * Math.sin(30 * DEG)); // 30° off, in his cone
  run(w, 0.2);
  g.brain._enterChallenge(c);
  assert.equal(g.brainState, 'CHALLENGE');
  near(g.heading, 0, 1e-12, 'no body snap');
  near(coneAt(g).heading, 0, 1e-9, 'the cone where it was');
  const b = angleTo(g.x, g.z, c.x, c.z);
  const hs = [g.heading], cs = [coneAt(g).heading];
  for (let i = 0; i < 45; i++) { run(w, DT); hs.push(g.heading); cs.push(coneAt(g).heading); }
  const onT = cs.findIndex((h) => Math.abs(angleDiff(h, b)) < 1e-9) * DT;
  assert.ok(onT > 0 && onT <= b / (TC.aimRate * DEG) + 2 * DT, `cone on him after ${onT.toFixed(3)} s`);
  assert.ok(cs.slice(Math.round(onT / DT)).every((h) => Math.abs(angleDiff(h, b)) < 1e-9), 'and stays on him');
  assert.ok(hs.slice(1).every((h, k) => Math.abs(angleDiff(hs[k], h)) <= RATE * DT + 1e-9), 'the body turns smoothly');
  near(g.heading, b, 1e-9, 'the body faces him');
  near(g.headOffset, 0, 1e-9, 'head straight again');
  assert.ok(pointInCone(coneAt(g), c.x, c.z), 'he has him covered');
});

// ------------------------------------------------------------ view side: art/turn-step.js

/** A minimal two-legged skeleton behind the UnitModel fields turnStep reads. */
function fakeMan() {
  const root = new THREE.Object3D();
  const obj = new THREE.Object3D();
  root.add(obj);
  const pelvis = new THREE.Bone(); pelvis.position.set(0, 1.0, 0); obj.add(pelvis);
  const B = { pelvis };
  for (const [s, x] of [['l', 0.11], ['r', -0.11]]) { // knees a little bent, as in a standing idle
    const thigh = new THREE.Bone(); thigh.position.set(x, -0.04, 0); pelvis.add(thigh);
    const calf = new THREE.Bone(); calf.position.set(0, -0.46, 0.08); thigh.add(calf);
    const foot = new THREE.Bone(); foot.position.set(0, -0.46, -0.08); calf.add(foot);
    Object.assign(B, { ['thigh_' + s]: thigh, ['calf_' + s]: calf, ['foot_' + s]: foot });
  }
  const neck = new THREE.Bone(); neck.position.set(0, 0.55, 0); pelvis.add(neck);
  const head = new THREE.Bone(); head.position.set(0, 0.1, 0); neck.add(head);
  Object.assign(B, { neck_01: neck, Head: head });
  root.updateMatrixWorld(true);
  return { root, real: { inner: { bones: B, object: obj } }, unit: { alive: true, stance: 'stand', state: 'active' }, opts: { faction: 'enemy' }, anim: 'idle', player: false, dog: false, _guard: new BoneGuard() };
}
const footAt = (m, s) => m.real.inner.bones['foot_' + s].getWorldPosition(new THREE.Vector3());
const yawOf = (o) => new THREE.Euler().setFromQuaternion(o.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;

test('turn-step (view): a turning German keeps each foot planted, steps it round when it twists out of his stance (feet in turn, lifted), head leading; squares up and lets go when he stops', () => {
  const m = fakeMan();
  const dt = 1 / 60;
  const frame = (dyaw) => { m._guard.restore(); m.root.rotation.y += dyaw; m.root.updateMatrixWorld(true); return turnStep(m, dt, m._guard); };
  for (let i = 0; i < 5; i++) assert.equal(frame(0), false, 'standing still: the clip pose, untouched');
  // a 180° eased turn (the brain's profile), then 1 s standing
  const w = { w: 0, h: 0 };
  const steps = [], was = { l: false, r: false };
  let maxSlip = 0, maxLift = 0, headLead = 0, lastStep = null;
  for (let i = 0; i < 150; i++) {
    const left = Math.PI - w.h, want = Math.min(RATE, Math.sqrt(2 * ACC * TC.brake * Math.max(0, left)));
    w.w += Math.max(-ACC * dt, Math.min(ACC * dt, want - w.w));
    const d = Math.min(w.w * dt, Math.max(0, left));
    w.h += d;
    const before = { l: footAt(m, 'l'), r: footAt(m, 'r') };
    frame(d);
    const st = m._turnStep;
    if (st.step && st.step.s !== lastStep) steps.push(st.step.s);
    lastStep = st.step?.s ?? null;
    for (const s of ['l', 'r']) {
      const p = footAt(m, s), now = !!st.feet && !(st.step && st.step.s === s); // planted this frame
      if (now && was[s]) maxSlip = Math.max(maxSlip, Math.hypot(p.x - before[s].x, p.z - before[s].z)); // (same plant as last frame)
      if (st.step?.s === s) maxLift = Math.max(maxLift, p.y - 0.04);
      was[s] = now;
    }
    if (st.feet && i < 60) headLead = Math.max(headLead, Math.abs(angleDiff(yawOf(m.root), yawOf(m.real.inner.bones.Head))));
  }
  assert.ok(steps.length >= 3 && steps.length <= 8, `${steps.length} steps for an about-turn (${steps.join('')})`);
  assert.ok(steps.every((s, k) => !k || s !== steps[k - 1]), 'the feet take turns');
  assert.ok(maxSlip < 2e-3, `a planted foot stays put (slips ${(maxSlip * 1000).toFixed(2)} mm)`);
  assert.ok(maxLift > 0.03 && maxLift <= STEP.lift + 0.01, `a stepping foot lifts (${(maxLift * 100).toFixed(1)} cm)`);
  assert.ok(headLead > 5 * DEG && headLead <= STEP.headMax + 1e-3, `the head leads the turn (${(headLead / DEG).toFixed(1)}°)`);
  // standing again: squared up, the clip has his feet (feet where the rest pose puts them under the turned body)
  for (let i = 0; i < 90; i++) frame(0);
  assert.equal(m._turnStep.feet, null, 'let go');
  assert.equal(frame(0), false);
  const want = (x) => new THREE.Vector3(x, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), m.root.rotation.y);
  for (const [s, x] of [['l', 0.11], ['r', -0.11]]) {
    const p = footAt(m, s), q = want(x);
    assert.ok(Math.hypot(p.x - q.x, p.z - q.z) < 0.02, `${s} foot back in the stance`);
  }
  // walking or lying down: never
  m.anim = 'walk';
  assert.equal(frame(0.05), false, 'walking: the walk clip has the feet');
  m.anim = 'idle'; m.unit.stance = 'crawl';
  assert.equal(frame(0.05), false, 'prone: prone-ground.js turns him');
});

test('turn-step (view): a man eased aside while standing (Unit._nudge, 0.6 m/s) steps after his body, planted feet do not glide — commandos too (M3 video "all soldiers should walk in all configurations")', () => {
  for (const faction of ['enemy', 'player']) {
    const m = fakeMan();
    m.opts.faction = faction; m.player = faction === 'player';
    const dt = 1 / 60;
    const frame = (dx) => { m._guard.restore(); m.root.position.x += dx; m.root.updateMatrixWorld(true); return turnStep(m, dt, m._guard); };
    for (let i = 0; i < 5; i++) frame(0);
    // 0.6 s eased off sideways at 0.6 m/s (36 cm), then standing
    let slide = 0, steps = 0, last = null;
    const was = { l: false, r: false };
    for (let i = 0; i < 36; i++) {
      const before = { l: footAt(m, 'l'), r: footAt(m, 'r') };
      frame(0.6 * dt);
      const st = m._turnStep;
      if (st.step && st.step.s !== last) steps++;
      last = st.step?.s ?? null;
      for (const s of ['l', 'r']) {
        const p = footAt(m, s), now = !!st.feet && !(st.step && st.step.s === s);
        if (now && was[s]) slide += Math.hypot(p.x - before[s].x, p.z - before[s].z);
        was[s] = now;
      }
    }
    assert.ok(m._turnStep.feet, `${faction}: the feet are planted while he is eased aside`);
    assert.ok(steps >= 2, `${faction}: he steps after his body (${steps} steps for 36 cm)`);
    assert.ok(slide < 0.01, `${faction}: planted feet stay put (${(slide * 1000).toFixed(1)} mm slid)`);
    for (let i = 0; i < 90; i++) frame(0);
    assert.equal(m._turnStep.feet, null, `${faction}: squared up and let go when he stands`);
  }
});
