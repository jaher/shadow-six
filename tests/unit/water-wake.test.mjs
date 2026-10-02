// Boat wakes (src/art/water.js WakeTracker._boat): Kelvin V arms, wash, speed-scaled bow wave, paddle strokes,
// current drift, turn slew and a quiet stationary state — pure logic over a recording sink.
import { test, assert } from './lib.mjs';
import { WakeTracker, KELVIN_TAN, boatProfile } from '../../src/art/water.js';
import { rowPeriod, catchOffset, ROW } from '../../src/art/oars.js';

const RAFT = { kind: 'boat', model: 'raft', size: [2.6, 1.3], raft: true };
const PATROL = { kind: 'boat', model: 'patrolboat', size: [8, 2.6], weapons: ['mg'] };
function rig(flow = null) {
  const sink = { d: [], c: [], disturb(...a) { this.d.push(a); }, crest(...a) { this.c.push(a); } };
  const w = new WakeTracker(sink, () => true, null, flow ? () => flow : null);
  return { sink, w };
}
/** Run a boat along +x at speed v (m/s) for t seconds (30 fps). */
function run(w, b, v, t, step = (bb, dt) => { bb.x += v * dt; }) {
  for (let f = 0; f < Math.round(t * 30); f++) { step(b, 1 / 30); w.update([b], 1 / 30); }
}

test('wake: the Kelvin V — crest lines on both sides, spreading at tan(19.47°) behind the bow', () => {
  const { sink, w } = rig();
  const b = { kind: 'vehicle', def: RAFT, x: 0, z: 0, alive: true };
  w.update([b], 1 / 30);
  run(w, b, 4, 2.5);
  const recent = sink.c.slice(-60);
  assert.ok(recent.some((c) => c[1] > 0.8) && recent.some((c) => c[1] < -0.8), 'crest dabs on both sides of the track');
  const bow = b.x + 1.3;
  for (const c of recent) {
    const back = bow - c[0], half = Math.abs(c[1]);
    assert.ok(back > -0.5, `crests trail the bow (${back.toFixed(2)} m)`);
    assert.ok(half <= back * KELVIN_TAN + 1.2, `inside the Kelvin wedge (${half.toFixed(2)} at ${back.toFixed(2)} m back)`);
  }
  const far = recent.filter((c) => bow - c[0] > 6);
  assert.ok(far.length && far.every((c) => Math.abs(c[1]) > 1.5), 'far down the arms the crests have spread wide');
  assert.ok(recent.some((c) => c[5] !== c[0] || c[6] !== c[1]), 'arms drawn as capsules between neighbouring crests');
  assert.ok(sink.d.some((d) => d[0] < b.x - 1 && Math.abs(d[1]) < 0.5 && d[4] > 0.1), 'foam wash trails astern');
});

test('wake: the bow wave grows with speed; rowed craft stroke on alternating sides, powered craft do not', () => {
  const bowAt = (def, v) => {
    const { sink, w } = rig(); const b = { kind: 'vehicle', def, x: 0, z: 0, alive: true };
    w.update([b], 1 / 30); run(w, b, v, 1.5);
    const len = def.size[0];
    return Math.max(...sink.d.filter((d) => d[0] > b.x + len * 0.4 && d[2] < 0).map((d) => -d[2]));
  };
  assert.ok(bowAt(RAFT, 4) > bowAt(RAFT, 1.5) * 1.8, 'v² bow wave');
  assert.equal(boatProfile(RAFT).rowed, true);
  assert.equal(boatProfile({ kind: 'boat', model: 'raft', size: [3.6, 1.5] }).rowed, true, 'rowboat');
  assert.equal(boatProfile(PATROL).rowed, false);
  assert.equal(boatProfile({ kind: 'boat', model: 'raft', weapons: ['torpedo'] }).rowed, false, 'mini-sub');
  const strokes = (def) => {
    const { sink, w } = rig(); const b = { kind: 'vehicle', def, x: 0, z: 0, alive: true };
    w.update([b], 1 / 30); run(w, b, 3, 4);
    return sink.d.filter((d) => d[2] === 0.02 && d[3] === 0.5);
  };
  const s = strokes(RAFT);
  assert.ok(s.length >= 3, `paddle strokes (${s.length})`);
  assert.ok(s.some((d) => d[1] > 0.5) && s.some((d) => d[1] < -0.5), 'both sides');
  assert.equal(strokes(PATROL).length, 0, 'no paddles on the patrol boat');
});

test('wake: the rowboat\'s oars catch together — a ring each side at the blades, one stroke per row period of its speed, the clock running through display frames without a sim tick', () => {
  const ROWBOAT = { kind: 'boat', model: 'raft', size: [3.6, 1.5] };
  assert.equal(boatProfile(ROWBOAT).oars, true, 'rowboat: oars');
  assert.equal(boatProfile(RAFT).oars, false, 'raft: a paddle');
  const { sink, w } = rig();
  const b = { kind: 'vehicle', def: ROWBOAT, x: 0, z: 0, alive: true };
  w.update([b], 1 / 30);
  // 2.5 m/s, ticked at 60 Hz but displayed at 120 Hz (every other display frame has no sim step)
  const rings = [], us = [];
  for (let f = 0; f < 120 * 8; f++) {
    if (f % 2 === 0) b.x += 2.5 / 60;
    const before = sink.d.length;
    w.update([b], 1 / 120);
    for (const d of sink.d.slice(before)) if (d[2] === 0.02 && d[3] === 0.5) rings.push({ f, x: d[0] - b.x, z: d[1] });
    us.push(w.strokeOf(b));
  }
  const c = catchOffset();
  assert.ok(rings.length >= 8, `catch rings (${rings.length})`);
  const byF = new Map(); for (const r of rings) byF.set(r.f, [...(byF.get(r.f) || []), r]);
  for (const [, rs] of byF) {
    assert.equal(rs.length, 2, 'both blades at once');
    assert.ok(rs.some((r) => r.z > 1.5) && rs.some((r) => r.z < -1.5), 'one each side, out at the blades');
    for (const r of rs) { assert.ok(Math.abs(Math.abs(r.z) - c.side) < 0.01, 'at the oars\' reach'); assert.ok(Math.abs(r.x - c.fwd) < 0.1, 'forward of midships'); }
  }
  const fs = [...byF.keys()], gaps = fs.slice(1).map((f, i) => (f - fs[i]) / 120);
  const per = rowPeriod(2.5);
  for (const g of gaps.slice(2)) assert.ok(Math.abs(g - per) < 0.05, `one stroke per ${per.toFixed(2)} s (${g.toFixed(2)})`);
  const s = us[us.length - 1];
  assert.ok(s.oars && s.moving && s.u >= 0 && s.u < 1 && Math.abs(s.period - per) < 0.05, 'the oarsman reads the phase of the stroke');
  // the swirl each blade leaves where it came out, after the drive
  assert.ok(sink.d.some((d) => d[2] === -0.01 && d[3] === 0.4), 'release swirls');
  // stopped: the clock stops (not reset) after a moment
  for (let f = 0; f < 60; f++) w.update([b], 1 / 60);
  assert.equal(w.strokeOf(b).moving, false);
  assert.ok(ROW.drive > 0.3);
});

test('wake: crests drift with the current; a turn slews the wash outward; at rest the water goes quiet', () => {
  const { sink, w } = rig([0, 0.8]);
  const b = { kind: 'vehicle', def: RAFT, x: 0, z: 0, alive: true };
  w.update([b], 1 / 30); run(w, b, 4, 2);
  const arms = w.state.get(b).arms.flat();
  const mean = arms.reduce((a, c) => a + c.z, 0) / arms.length;
  assert.ok(mean > 0.3, `arms carried downstream by the current (mean z ${mean.toFixed(2)})`);
  // a left turn (CCW in x/z) — wash lands on the outside (right of the track, −z side relative to the turn)
  const t = rig(); const r = { kind: 'vehicle', def: RAFT, x: 0, z: 0, alive: true }; let a = 0;
  t.w.update([r], 1 / 30);
  run(t.w, r, 4, 1.2, (bb, dt) => { a += 1.2 * dt; bb.x += Math.cos(a) * 4 * dt; bb.z += Math.sin(a) * 4 * dt; });
  const n0 = t.sink.d.length; run(t.w, r, 4, 0.5, (bb, dt) => { a += 1.2 * dt; bb.x += Math.cos(a) * 4 * dt; bb.z += Math.sin(a) * 4 * dt; });
  const wash = t.sink.d.slice(n0).filter((d) => d[4] > 0.1 && d[2] === -0.005 * Math.min(1.6, 0.35 + t.w.state.get(r).v / 3.2));
  const side = wash.map((d) => { const dx = d[0] - r.x, dz = d[1] - r.z; return -Math.sin(a) * dx + Math.cos(a) * dz; }); // + = left
  assert.ok(wash.length && side.reduce((s2, v) => s2 + v, 0) / side.length < 0, 'wash slewed to the outside of the turn');
  // stop: the arms run out and fade, then only a faint foamless lap every few seconds
  run(w, b, 0, 4);
  const n1 = sink.d.length, c1 = sink.c.length;
  run(w, b, 0, 6);
  const quiet = sink.d.slice(n1);
  assert.equal(sink.c.length, c1, 'no crest dabs once the wake has faded');
  assert.ok(quiet.length >= 1 && quiet.length <= 3, `a lap or two (${quiet.length})`);
  assert.ok(quiet.every((d) => d[4] === 0 && Math.abs(d[2]) < 0.01), 'quiet: no foam, tiny rings');
});
