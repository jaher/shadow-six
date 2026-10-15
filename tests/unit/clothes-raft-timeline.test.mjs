/**
 * Phase timelines of the Spy's clothesline take and the Marine's raft (user 2026-10-14: "Also animate better how the spy
 * grabs the clothes, how the marine very quickly deflated and folds the raft. Also when the raft is inflated it should
 * be very clear it gets inflated."): abilities/raft-actions.js, abilities/spy-actions.js DRESS, art/spy-actions.js VD,
 * and the action clock the walkthrough director reads (abilities/common.js actionClock).
 */
import { test, assert, near } from './lib.mjs';
import { CONFIG } from '../../src/config.js';
import { RAFT, CHAMBERS, chamberLevel, bounceAt, hullVolume, raftTimes, pushRaftAct } from '../../src/abilities/raft-actions.js';
import { DRESS, dressTimes, dressAt } from '../../src/abilities/spy-actions.js';
import { timedTask, actionClock, phaseOf } from '../../src/abilities/common.js';
import { VD, VDL } from '../../src/art/spy-actions.js';

const contiguous = (phases, dur, label) => {
  assert.ok(phases.length >= 4, `${label}: phases`);
  assert.equal(phases[0][1], 0, `${label}: from 0`);
  for (let i = 0; i < phases.length; i++) {
    const [n, a, b] = phases[i];
    assert.ok(b > a, `${label}: ${n} has length (${a}–${b})`);
    if (i) near(a, phases[i - 1][2], 1e-9, `${label}: ${n} follows ${phases[i - 1][0]}`);
  }
  near(phases[phases.length - 1][2], dur, 1e-9, `${label}: to the end`);
};

test('raft deploy: 4.0 s, kneel → spread → unfold → cord → inflate → close, the hiss at the cord, full before the end', () => {
  const T = raftTimes('deploy'), D = RAFT.deploy;
  near(T.dur, CONFIG.abilities.raftDeploy, 1e-9, 'CONFIG raftDeploy');
  near(T.dur, 4.0, 1e-9, 'inflating takes 4.0 s (was 2.0)');
  contiguous(T.phases, T.dur, 'deploy');
  assert.deepEqual(T.phases.map((p) => p[0]), ['kneel', 'spread', 'unfold', 'cord', 'inflate', 'close']);
  assert.ok(D.pull > D.unfold[0] && D.pull < D.inflate[1], 'the cord pulled once the sheet lies flat');
  const inflating = D.full - D.pull;
  assert.ok(inflating >= 1.8 && inflating <= 3.0, `the hull fills over ~2–3 s (${inflating.toFixed(2)} s)`);
  assert.ok(D.full < T.dur - 0.3, 'full (and bounced) before he gets up');
});

test('raft deploy: the chambers fill one after the other from the stern valve, the volume rises monotonically to full', () => {
  const D = RAFT.deploy;
  for (let k = 0; k < CHAMBERS.length; k++) {
    assert.equal(chamberLevel(k, D.pull - 0.01), 0, `${CHAMBERS[k].name} flat before the cord`);
    near(chamberLevel(k, D.full + 0.01), 1, 1e-9, `${CHAMBERS[k].name} full at ${D.full} s`);
  }
  // staggered: at any moment the stern is at least as full as the sides, the sides as the thwart
  for (let t = D.pull; t <= D.full; t += 0.05) {
    const [st, r, l, th] = [0, 1, 2, 3].map((k) => chamberLevel(k, t));
    assert.ok(st >= r - 1e-9 && r >= l - 1e-9 && l >= th - 1e-9, `chamber order at ${t.toFixed(2)} s (${[st, r, l, th].map((x) => x.toFixed(2))})`);
  }
  const t25 = D.pull + 0.25 * (D.full - D.pull);
  assert.ok(chamberLevel(0, t25) > 0.2 && chamberLevel(3, t25) === 0, 'early on: the stern filling, the thwart still flat');
  let prev = -1;
  for (let t = D.pull - 0.2; t <= D.full + 0.2; t += 1 / 60) {
    const v = hullVolume(t);
    assert.ok(v >= prev - 1e-12, `volume monotonic at ${t.toFixed(3)} s (${v} < ${prev})`);
    prev = v;
  }
  near(hullVolume(D.full), 1, 1e-9, 'full');
  assert.equal(hullVolume(D.pull), 0, 'flat at the cord');
  // the bounce: only once full, small, gone by the close
  assert.equal(bounceAt(D.full - 0.2), 0);
  assert.ok(Math.max(...Array.from({ length: 30 }, (_, i) => Math.abs(bounceAt(D.bounce[0] + i * 0.015)))) > 0.01, 'a slight bounce');
  assert.ok(Math.max(...Array.from({ length: 30 }, (_, i) => Math.abs(bounceAt(D.bounce[0] + i * 0.015)))) < 0.06, '…only slight');
  assert.equal(bounceAt(D.bounce[1] + 0.01), 0);
});

test('raft pack: in his kit at raftPack (2.0 s, as before), folded and shouldered by 3.6 s; the volume falls monotonically', () => {
  const T = raftTimes('pack'), P = RAFT.pack;
  near(T.gone, CONFIG.abilities.raftPack, 1e-9, 'the raft leaves the sim at raftPack');
  near(T.gone, 2.0, 1e-9, '2.0 s, as before');
  near(T.dur, CONFIG.abilities.raftPack + CONFIG.abilities.raftFold, 1e-9, 'pack + fold');
  assert.ok(T.dur >= 3 && T.dur <= 4, `a visible 3–4 s sequence (${T.dur} s)`);
  contiguous(T.phases, T.dur, 'pack');
  assert.deepEqual(T.phases.map((p) => p[0]), ['kneel', 'valve', 'deflate', 'drag', 'fold', 'gather', 'shoulder']);
  assert.ok(P.flat <= T.gone, 'flat before the raft leaves the sim');
  let prev = 2;
  for (let t = 0; t <= T.dur; t += 1 / 60) {
    const v = hullVolume(t, true);
    assert.ok(v <= prev + 1e-12, `volume falls monotonically at ${t.toFixed(3)} s`);
    prev = v;
  }
  near(hullVolume(P.open - 0.01, true), 1, 1e-9, 'full until the valve opens');
  near(hullVolume(P.flat + 0.01, true), 0, 1e-9, 'flat by the drag');
  assert.ok(P.fold[0] >= P.flat && P.gather[0] >= P.fold[0] && P.shoulder[1] <= T.dur + 1e-9, 'fold, gather, shoulder in order');
});

test('raft records: one per Marine, a new one supersedes the last; undrawn ones dropped (headless)', () => {
  const w = {}, a = { id: 1 }, b = { id: 2 };
  pushRaftAct(w, { kind: 'inflate', a });
  pushRaftAct(w, { kind: 'inflate', a: b });
  const r2 = pushRaftAct(w, { kind: 'pack', a });
  assert.equal(w.raftActs.length, 2);
  assert.ok(w.raftActs.includes(r2) && !w.raftActs.some((r) => r.a === a && r !== r2));
  const drawn = { kind: 'pack', a: b, vis: {} };
  w.raftActs.push(drawn);
  pushRaftAct(w, { kind: 'inflate', a: b });
  assert.ok(drawn.superseded && w.raftActs.includes(drawn), 'a drawn record stays (flagged) for the art pass to wind up');
});

test('spy clothesline take: 2–3 s to take it (was 1.05), beats in order inside it, the side-step between the garments', () => {
  assert.ok(DRESS.take >= 2 && DRESS.take <= 3, `take ${DRESS.take} s`);
  const seq = [VD.reach[0], VD.grab, ...VD.pegs, VD.lift[1], VD.drape[0], VD.drape[1], VD.capGrab, VD.capHand, VD.tGrab, ...VD.tPegs, VD.tPull[1], VD.tDrape[1]];
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] >= seq[i - 1], `beat ${i} in order (${seq[i - 1]} → ${seq[i]})`);
  assert.ok(VD.tDrape[1] <= DRESS.take + 1e-9, 'everything on her arm by the take');
  assert.ok(VD.capGrab > DRESS.sideStep[0] && VD.capGrab < DRESS.sideStep[1], 'the cap lifted off on the side-step');
  assert.ok(DRESS.sideStep[0] >= VD.drape[1] - 0.05 && DRESS.sideStep[1] <= VD.tGrab, 'the side-step after the tunic, before the trousers');
  // the whole M3 action: take + step + dressing
  const take = { x: 0, z: 0.42, h: -Math.PI / 2, side: 1, b: { x: 0.92, z: 0.42, h: -Math.PI / 2 } }, cover = { x: 1.5, z: 0.42, h: -Math.PI / 2 };
  const T = dressTimes('line', cover, take);
  near(T.take, DRESS.take, 1e-9);
  near(T.step, Math.max(DRESS.step[0], Math.min(DRESS.step[1], 0.58 / DRESS.stepSpeed)), 1e-9, 'the step from in front of the trousers');
  near(T.swap - T.d0, DRESS.line.swap, 1e-9);
  near(T.dur - T.d0, DRESS.line.end, 1e-9);
  near(VDL.end, DRESS.line.end, 1e-9, 'art dressing beats end with the sim');
  // her path: settle into the tunic spot, side-step to the trousers, step to the cover — continuous
  const rec = { plan: { from: { x: -0.3, z: 0.7, h: -1.2 }, take, cover }, T };   // (walked up to within the 'use' range, 0.45 m)
  let last = dressAt(rec, 0);
  for (let t = 1 / 60; t <= T.dur; t += 1 / 60) {
    const p = dressAt(rec, t);
    assert.ok(Math.hypot(p.x - last.x, p.z - last.z) < 0.06, `no jump at ${t.toFixed(3)} s`);
    last = p;
  }
  const at = (t) => dressAt(rec, t);
  near(at(DRESS.settle).x, take.x, 1e-9, 'in front of the tunic');
  near(at(DRESS.sideStep[1]).x, take.b.x, 1e-9, 'in front of the trousers');
  near(at(T.take + T.step).x, cover.x, 1e-9, 'behind the laundry');
});

test('action clock: id, elapsed / total / remaining, phase, present (the walkthrough director reads it)', () => {
  const u = { currentActionId: 'raft', currentAction: timedTask({ dur: 4, phases: raftTimes('deploy').phases, present: true }) };
  assert.equal(actionClock({}), null);
  let c = actionClock(u);
  assert.deepEqual({ ...c }, { id: 'raft', t: 0, dur: 4, left: 4, phase: 'kneel', present: true });
  for (let i = 0; i < 84; i++) u.currentAction.update(1 / 60);
  c = actionClock(u);
  near(c.t, 1.4, 1e-9); near(c.left, 2.6, 1e-9);
  assert.equal(c.phase, 'cord');
  assert.equal(actionClock(u), c, 'one object per unit, refreshed in place');
  assert.equal(phaseOf(raftTimes('deploy').phases, 3.0), 'inflate');
  const plain = { currentActionId: 'knife', currentAction: timedTask({ dur: 0.9 }) };
  assert.deepEqual({ ...actionClock(plain) }, { id: 'knife', t: 0, dur: 0.9, left: 0.9, phase: null, present: false });
});
