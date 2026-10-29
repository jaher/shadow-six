/**
 * No building on the rails (user 2026-10-28: "Make sure no buildings are on top of rails"): over every mission, no
 * building / structure / street-furniture footprint inside a rail corridor — the drawn track's ballast + 0.3 m, and on
 * a line a train, tram or mine cart runs, its hull's half-width + 0.5 m — and no tree, rock or cliff on the sleepers
 * (src/missions/rail-clearance.js; report: node tools/layout/rail-report.mjs). Rolling stock, the bridges that carry
 * a line, buffer stops and structures tagged `onRails` stand on rails by design.
 *
 * The one narrow allowance (user 2026-10-29, asked "buffer stops at the cut ends, or continuous rails with the wire
 * running over them?": "Continuous rails"): M4's barbed wire runs over the dead siding_a, the rails unbroken under it
 * (`onRails: { siding_a: … }` on the wire). It covers that wire over that track and nothing else — a building on any
 * track, a wire over any other track, a wire along the siding, a wire over a live train or tram line are all still
 * caught, and the wire's own posts (the knife rests' trestles) must stand clear of every track bed.
 */
import { test, assert, near } from './lib.mjs';
import { MISSIONS } from '../../src/missions/index.js';
import { loadGrid } from './mission-check.mjs';
import { vehicleDef } from '../../src/entities/vehicle.js';
import { normalizeMission } from '../../src/missions/schema.js';
import { railClearance, railLines, railBeds, trackCentreline, bedHalf, CLEAR, onRailsReason, railAllowance, crossingOnly } from '../../src/missions/rail-clearance.js';
import { Run, bedArcs, restStations, buildWireRun, Parts, wireTypeOf } from '../../src/art/wire-obstacles.js';
import { missionWire } from '../../src/art/wire-missions.js';
import { drawnPlans } from './rail-drawn.mjs';

const vehicleSize = (t) => { try { return vehicleDef(t)?.size ?? null; } catch { return null; } };
const fmt = (h) => `${h.id} (${h.type} ${h.variant}) ${h.dist.toFixed(2)} m from ${h.rail} (${h.kind}), needs ${h.need.toFixed(2)}`;

test('rails clear: the corridors (ballast + 0.3 m; a running hull + 0.5 m) and the drawn centre line', () => {
  assert.equal(bedHalf(2.4), 1.5);
  assert.equal(bedHalf(1.2), 1.3);
  const m16 = railLines(MISSIONS.find((m) => m.id === 'm16'), { vehicleSize });
  const track = m16.find((r) => r.kind === 'track'), run = m16.find((r) => r.kind === 'run');
  assert.equal(track.half, 1.5 + CLEAR.static);
  assert.equal(run.half, 1.7 + CLEAR.running, 'the train: 3.4 m hull');
  // the Catmull-Rom centre line passes through its points and welds 0.38 m past both ends (buildRailTrack)
  const L = trackCentreline([[0, 0], [10, 0], [20, 5]]);
  assert.ok(Math.hypot(L[0][0] + 0.38, L[0][1]) < 1e-2 && L.some(([x, z]) => Math.hypot(x - 10, z) < 0.2));
  assert.equal(onRailsReason({ type: 'train_car' }), 'rolling stock');
  assert.equal(onRailsReason({ type: 'crates', variant: 'buffer_stop' }), 'belongs on the track');
  assert.equal(onRailsReason({ type: 'crates', variant: 'vehicle_parked', vehicleArt: 'handcar' }), 'rolling stock');
  assert.equal(onRailsReason({ type: 'hut', variant: 'crossing_shack' }), null);
});

test('rails clear: no building, structure or street furniture on the rails, no tree or rock on the sleepers, in any mission', async () => {
  const bad = [], allowed = [];
  let lines = 0;
  for (const m of MISSIONS) {
    const { def, handle } = loadGrid(m);
    // (the library models as drawn too: a log cabin's eaves, a pier's T head reach well past their footprints)
    const drawn = railLines(def, { vehicleSize }).length ? await drawnPlans(def) : null;
    const r = railClearance(def, handle.structures, { vehicleSize, drawn });
    lines += r.rails.length;
    for (const h of r.hits) bad.push(`${m.id}: ${fmt(h)}`);
    for (const a of r.allowed) allowed.push(`${m.id}: ${a.id} over ${a.rail}`);
  }
  assert.ok(lines >= 15, `rail lines found (${lines})`);
  assert.deepEqual(bad, []);
  // the per-rail allowances of every mission: exactly this one crossing (a new one is a decision, made here)
  assert.deepEqual(allowed, ['m04: wire over siding_a']);
});

// ------------------------------------------------------------------------------------------------ M4: the wire over the dead siding

const m4Raw = () => MISSIONS.find((m) => m.id === 'm04');
const wireDef = (id, points, onRails) => ({ id, type: 'fence', variant: 'wire_on_stakes', h: 1.4, width: 0.6, points, ...(onRails ? { onRails } : {}) });
/** A 12 m wire across a rail line at its k-th sample, square to it. */
const acrossLine = (line, k, half = 6) => {
  const a = line[k - 2], b = line[k + 2], t = [b[0] - a[0], b[1] - a[1]], m = Math.hypot(...t), n = [t[1] / m, -t[0] / m], c = line[k];
  return [[c[0] + n[0] * half, c[1] + n[1] * half], [c[0] - n[0] * half, c[1] - n[1] * half]];
};

test('rails clear: M4 siding_a is one unbroken track, the wire runs over it ("Continuous rails"): the one allowance, and nothing else is let through', () => {
  const m4 = m4Raw(), siding = m4.structures.find((s) => s.id === 'siding_a'), wire = m4.structures.find((s) => s.id === 'wire');
  assert.ok(Array.isArray(siding.points) && siding.points.length === 8 && !siding.segments, 'siding_a: one run of 8 points, not cut under the wire');
  const lines = railLines(m4, { vehicleSize }), L = (id, i = 0) => lines.filter((r) => r.id === id)[i].line;
  assert.equal(lines.filter((r) => r.id === 'siding_a').length, 1, 'one continuous line');
  assert.deepEqual(Object.keys(wire.onRails), ['siding_a'], 'the tag names the dead siding only');
  assert.match(wire.onRails.siding_a, /Continuous rails/, 'and carries the user\'s answer');
  assert.equal(onRailsReason(wire), null, 'a per-rail tag does not exempt the wire from every rail');
  // the real crossing is one clean pass; a wire along the siding, or ending on it, is not
  const sidA = L('siding_a'), sidB = L('siding_b'), main0 = L('rail_main', 0), rA = lines.find((r) => r.id === 'siding_a');
  assert.ok(crossingOnly(wire, rA), 'the M4 wire crosses siding_a once, cleanly');
  assert.ok(!crossingOnly(wireDef('along', sidA.filter((_, i) => i > 300 && i < 380 && i % 8 === 0)), rA), 'along the track: no');
  assert.ok(!crossingOnly(wireDef('ends', [[...sidA[200]], [sidA[200][0] + 5, sidA[200][1] - 5]]), rA), 'a run ending on the track: no');
  // mutations of M4, all built together: what the allowance must not let through
  const extra = [
    { id: 'x_hut', type: 'hut', variant: 'shack', x: sidA[250][0], z: sidA[250][1], rot: 0, w: 3, d: 3, h: 3 },
    { id: 'x_hut_tag', type: 'hut', variant: 'shack', x: sidA[60][0], z: sidA[60][1], rot: 0, w: 3, d: 3, h: 3, onRails: { siding_a: 'a building is not a crossing' } },
    wireDef('x_wire_a', acrossLine(sidA, 200), { siding_a: 'the same crossing, tagged' }),
    wireDef('x_wire_b', acrossLine(sidB, 80), { siding_a: 'the other siding is not named' }),
    wireDef('x_wire_untagged', acrossLine(sidA, 120)),
    wireDef('x_wire_along', sidA.filter((_, i) => i > 300 && i < 380 && i % 8 === 0), { siding_a: 'lying along the track' }),
    wireDef('x_wire_main', acrossLine(main0, 100), { rail_main: 'x', siding_a: 'x', train: 'x' }),
  ];
  const { def, handle } = loadGrid({ ...m4, structures: [...m4.structures, ...extra] });
  const r = railClearance(def, handle.structures, { vehicleSize });
  const hit = (id, rail) => r.hits.some((h) => h.id === id && h.rail === rail), ok = (id, rail) => r.allowed.some((h) => h.id === id && h.rail === rail);
  assert.ok(ok('wire', 'siding_a') && !r.hits.some((h) => h.id === 'wire'), 'M4 wire over siding_a: allowed');
  assert.ok(ok('x_wire_a', 'siding_a') && !r.hits.some((h) => h.id === 'x_wire_a'), 'a wire tagged for siding_a, across it: allowed (the same kind of crossing)');
  assert.ok(hit('x_hut', 'siding_a'), 'a building on siding_a: caught');
  assert.ok(hit('x_hut_tag', 'siding_a'), 'a building carrying the tag: still caught');
  assert.ok(hit('x_wire_b', 'siding_b'), 'the tag does not open siding_b');
  assert.ok(hit('x_wire_untagged', 'siding_a'), 'an untagged wire across siding_a: caught');
  assert.ok(hit('x_wire_along', 'siding_a'), 'a wire along siding_a: caught');
  assert.ok(hit('x_wire_main', 'train'), 'a wire over the live main line: caught (the train\'s corridor), whatever it is tagged with');
  assert.deepEqual(r.allowed.map((a) => a.id).sort(), ['wire', 'x_wire_a', 'x_wire_main'], 'only the tagged wires over a named dead track (and the rail_main drawn under the train: its run still hits)');
  // a wire over a live tram line: its own line is never allowed, tag or not
  const m15 = MISSIONS.find((m) => m.id === 'm15'), tram = railLines(m15, { vehicleSize }).find((q) => q.id === 'tram_track');
  const g15 = loadGrid({ ...m15, structures: [...m15.structures, wireDef('x_wire_tram', acrossLine(tram.line, 3), { tram_track: 'x', tram: 'x' })] });
  const r15 = railClearance(g15.def, g15.handle.structures, { vehicleSize });
  assert.ok(r15.hits.some((h) => h.id === 'x_wire_tram' && h.kind === 'tram'), 'a wire over a tram line: caught');
  assert.ok(!r15.allowed.length, 'M15: nothing allowed');
});

test('rails clear: railAllowance: per rail id, drawn tracks only, wall / fence / wire polylines only', () => {
  const rail = (id, kind, line) => ({ id, kind, half: 1.8, line });
  const line = Array.from({ length: 41 }, (_, i) => [i * 0.5, 0]);   // a straight track along x
  const cross = wireDef('w', [[10, -6], [10, 6]]);
  assert.equal(railAllowance({ ...cross, onRails: { s: 'why' } }, rail('s', 'track', line)), 'why');
  assert.equal(railAllowance({ ...cross, onRails: { s: 'why' } }, rail('t', 'track', line)), null, 'another id');
  assert.equal(railAllowance({ ...cross, onRails: { s: 'why' } }, rail('s', 'run', line)), null, 'a line a vehicle runs on');
  assert.equal(railAllowance({ ...cross, onRails: { s: 'why' } }, rail('s', 'tram', line)), null, 'a tram line');
  assert.equal(railAllowance({ ...cross, onRails: { s: 'why' } }, rail('s', 'road', line)), null, 'a road\'s rails');
  assert.equal(railAllowance({ ...cross, onRails: 'by design' }, rail('s', 'track', line)), null, 'a string tag is the whole-structure kind (onRailsReason)');
  assert.equal(railAllowance({ type: 'hut', x: 10, z: 0, w: 3, d: 3, onRails: { s: 'why' } }, rail('s', 'track', line)), null, 'a building');
  assert.equal(railAllowance({ ...cross, onRails: { s: '' } }, rail('s', 'track', line)), null, 'a reason is required');
  assert.ok(crossingOnly(wireDef('c45', [[8, -4], [12, 4]]), rail('s', 'track', line)), 'a steep diagonal is a crossing');
  assert.ok(!crossingOnly(wireDef('c20', [[0, -3], [10, 0.4], [20, 3]]), rail('s', 'track', line)), 'a shallow one runs along the bed');
  assert.ok(!crossingOnly(wireDef('twice', [[8, -4], [10, 4], [12, -4]]), rail('s', 'track', line)), 'twice is two crossings');
  assert.ok(!crossingOnly(wireDef('touch', [[10, -4], [10, -1]]), rail('s', 'track', line)), 'a run that stops in the bed');
});

test('rails clear: the wire\'s own posts — the knife rests\' trestles in M4 — stand clear of every track bed, in every mission', () => {
  const BALLAST = (r) => r.half - CLEAR.static;   // the drawn bed's half-width
  const segD = (px, pz, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz || 1e-12))); return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t); };
  const bedDist = (x, z, r) => { let d = Infinity; for (let k = 0; k + 1 < r.line.length; k++) d = Math.min(d, segD(x, z, r.line[k], r.line[k + 1])); return d; };
  /** The as-drawn ground-standing parts (posts, legs, pickets, stakes; ground at 0), the run built knowing `beds`: the
   *  nearest of them to the edge of any of `check`'s beds (< 0 = standing on one). */
  const feet = (def, s, run, i, beds, check = beds) => {
    const type = wireTypeOf(s, { missionId: def.id }), P = new Parts();
    buildWireRun(type, run, { ...s, ...(missionWire(s, def.id) || {}) }, { parts: P, rails: beds, theater: def.theater, runKey: `${s.id}#${i}` });
    let worst = Infinity, n = 0;
    for (const mats of P.inst.values()) for (const M of mats) {
      const e = M.elements;
      if (e[13] > 0.3) continue;   // a beam up on its trestles, a coil's crest: over the bed by design
      n++;
      for (const r of check) worst = Math.min(worst, bedDist(e[12], e[14], r) - BALLAST(r));
    }
    return { worst, n, P };
  };
  const bad = [];
  let runs = 0;
  for (const m of MISSIONS) {
    const def = normalizeMission(m, { quiet: true }), beds = railBeds(def);
    if (!beds.length) continue;
    for (const s of def.structures) {
      if (s.type !== 'fence' || !wireTypeOf(s, { missionId: def.id })) continue;
      (s.segments ?? (s.points ? [s.points] : [])).forEach((run, i) => {
        const f = feet(def, s, run, i, beds);
        runs++;
        if (f.worst < 0) bad.push(`${m.id}: ${s.id}#${i}: a post ${(-f.worst).toFixed(2)} m inside a track bed`);
      });
    }
  }
  assert.ok(runs >= 5, `wire runs checked in missions with rails (${runs})`);
  assert.deepEqual(bad, []);
  // M4's wire over siding_a: the posts stand either side of the bed (>= 0.1 m clear of the ballast, 0.3 m by design), the
  // strands pass over the rail heads (0.16 m); without the beds the same recipe stands its trestles on the track
  const def = normalizeMission(m4Raw(), { quiet: true }), wire = def.structures.find((s) => s.id === 'wire'), beds = railBeds(def);
  const sid = beds.find((r) => r.id === 'siding_a');
  const withBeds = feet(def, wire, wire.points, 0, beds), without = feet(def, wire, wire.points, 0, [], beds);
  assert.ok(withBeds.worst >= 0.1, `posts clear of the siding's ballast (${withBeds.worst.toFixed(2)} m)`);
  assert.ok(withBeds.n === without.n, 'the same posts: none added or lost');
  assert.ok(without.worst < 0, `control: built without the beds a trestle stands on the track (${without.worst.toFixed(2)} m)`);
  // (the rails' heads are 0.16 m: strands over the bed's rails, |across| < 1 m, hang higher than 0.2 m)
  const lowest = (P) => { let low = Infinity; for (const it of P.items) for (const q of it.path) if (bedDist(q[0], q[2], sid) < 1.0) low = Math.min(low, q[1]); return low; };
  assert.ok(lowest(withBeds.P) >= 0.2, `strands over the rails clear their heads (lowest ${lowest(withBeds.P).toFixed(2)} m over the bed)`);
  assert.ok(lowest(without.P) < 0.2, 'control: the plain recipe has a strand through the rails');
});

test('rails clear: railBeds: the drawn rail_track beds (centre line + ballast + 0.3 m) a wire\'s posts keep out of', () => {
  const beds = railBeds(normalizeMission(m4Raw(), { quiet: true }));
  assert.deepEqual(beds.map((b) => b.id), ['rail_main', 'rail_main', 'siding_a', 'siding_b'], 'M4: the main line (two runs) and the two sidings; not the train\'s run line');
  for (const b of beds) near(b.half, 1.8, 1e-9, `${b.id} half`);
});

test('rails clear: the cases fixed on 2026-10-28 stay fixed (M4 crossing shack and box, M16 platform, M7 gantry)', () => {
  const near = (id, sid, rid) => {
    const { def, handle } = loadGrid(MISSIONS.find((m) => m.id === id));
    const r = railClearance(def, new Map([[sid, handle.structures.get(sid)]]), { vehicleSize, near: 10 });
    return Math.min(...r.hits.filter((h) => h.rail === rid).map((h) => h.dist));
  };
  assert.ok(near('m04', 'shack_x', 'train') >= 2.2, 'the crossing shack off the main line');
  assert.ok(near('m04', 'crossing_box', 'train') >= 2.2, 'the control box off the main line');
  assert.ok(near('m16', 'platform', 'train') >= 2.2, 'the M16 platform clear of the train');
  assert.ok(near('m18', 'platform', 'train') >= 2.2, 'the M18 platform clear of the train');
  assert.ok(near('m07', 'gantry_post_3', 'slip_rails') >= 1.8, 'the gantry posts beside the slip rails');
});
