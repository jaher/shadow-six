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
 *
 * And the rails in view (user 2026-10-29, the tall street buildings that hid the tracks set back): no building hides
 * rail heads from the default camera (pitch 40, yaw 15; viewHidden with the library models' drawn walls and roofs,
 * report: rail-report.mjs --view) beyond the narrow view allowances kept on purpose (VIEW_ALLOW; the mission's
 * `railView` tag says why where the structure stands).
 */
import { test, assert, near } from './lib.mjs';
import { MISSIONS } from '../../src/missions/index.js';
import { loadGrid } from './mission-check.mjs';
import { vehicleDef } from '../../src/entities/vehicle.js';
import { normalizeMission } from '../../src/missions/schema.js';
import { railClearance, railLines, railBeds, trackCentreline, bedHalf, CLEAR, onRailsReason, railAllowance, crossingOnly, viewHidden } from '../../src/missions/rail-clearance.js';
import { Run, bedArcs, restStations, buildWireRun, Parts, wireTypeOf } from '../../src/art/wire-obstacles.js';
import { missionWire } from '../../src/art/wire-missions.js';
import { drawnPlans, drawnSolids } from './rail-drawn.mjs';

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

// ------------------------------------------------------------------------------------------------ rails in view

test('rails in view: the default camera hides what stands between it and the rails (prisms and a gable roof)', () => {
  // a straight E-W line at z 0; the camera looks north-north-west (yaw 15) 40° down: a top at height h hides the
  // ground 1.19 h behind it along the view, 1.15 h square to this line (h·cot 40°·cos 15°)
  const def = { id: 'tview', structures: [{ id: 'line', type: 'rail_track', points: [[-40, 0], [40, 0]] }] };
  const box = (z0, h) => ({ type: 'house', def: { id: 'b', type: 'house', x: 0, z: z0 + 4, w: 10, d: 8, h },
    footprints: [{ shape: 'rect', x: 0, z: z0 + 4, w: 10, d: 8, rot: 0, block: 2 }] });
  const hid = (b, o) => viewHidden(def, new Map([['b', b]]), o).find((v) => v.rail === 'line')?.hidden ?? 0;
  assert.ok(hid(box(4, 9)) >= 20, 'a 9 m block whose face stands 4 m S of the line hides both rails along its length');
  assert.equal(hid(box(12, 9)), 0, 'its face 12 m back (1.15 × 9 = 10.4 m < 12 − 0.72): the rails show');
  assert.equal(hid(box(-12, 9)), 0, 'beyond the line (the far side from the camera) it hides nothing of it');
  assert.ok(hid(box(4, 9), { yawDeg: 0 }) >= 20 && hid(box(12, 9), { pitchDeg: 25 }) > 0, 'other views: yaw 0, a lower pitch reaches further');
  // a gabled house: walls to its 3.3 m eaves, the ridge 9 m high along its 10 m axis, 4 m behind its face
  const gable = (z0) => {
    const P = [[-5, z0], [5, z0], [5, z0 + 8], [-5, z0 + 8]];
    return new Map([['b', [{ poly: P, y0: 0, top: 3.3 }, { poly: P, eave: 3.3, ridge: 9, kind: 'gable' }]]]);
  };
  const hidG = (z0) => viewHidden(def, new Map([['b', box(z0, 9)]]), { solids: gable(z0) }).find((v) => v.rail === 'line')?.hidden ?? 0;
  assert.ok(hidG(6) >= 10, 'its ridge (10 m back, 10.4 m reach) hides the rails');
  assert.equal(hidG(8), 0, 'set back 2 m more, ridge and eaves both draw short of the near rail');
  assert.ok(hidG(8) < hid(box(8, 9)), 'a roof hides less than a block of its full height');
});

/** Rail heads hidden below this (m, both rails, 0.5 m samples) are noise: a post's sliver, the static model's slack. */
const VIEW_TOL = 2;
/**
 * The only structures allowed to hide rail heads from the default camera, each to at most `max` m of rail head (what
 * viewHidden measures now + 1 m) on its `rail`, and why (its mission's `railView` tag says so where it stands: a tag
 * alone allows nothing); an entry no longer needed must go (they stay narrow). Calibrated against the render
 * (tools/layout/rail-view-probe.mjs: rays from both rail heads through every drawn mesh): every building and tall
 * structure it finds hiding a rail is caught here; it also sees what this check leaves out (trees, low walls, the
 * crossing booms), and the static model over-reads a few (M4's gutted ruin, M7's crane leg and U-boat, crate piles).
 */
const VIEW_ALLOW = {
  m04: {
    shack_x: { rail: 'rail_main', max: 5.5, why: 'the crossing keeper\'s shack by the level crossing (moved off the line 10-28): e41\'s post, the lorry driver\'s errands and the Green Beret\'s hide are built round it; its roof hides ~3 m of the near rail' },
    ruin_house: { rail: 'siding_a', max: 3.5, why: 'the static model stands the bombed shell\'s walls to its top floor; drawn, its broken walls leave the dead siding in view' },
  },
  m07: {
    gantry_post_3: { rail: 'slip_rails', max: 4, why: 'the slipway gantry straddles the slip rails by design' },
    gantry_post_4: { rail: 'slip_rails', max: 3.5, why: 'the slipway gantry straddles the slip rails by design' },
  },
  m19: { crane: { rail: 'rail_se', max: 8, why: 'the yard crane at the SE spur\'s end, by design' } },
};

test('rails in view: no building hides the rails from the default camera (pitch 40, yaw 15) beyond its allowance, in any mission', async () => {
  const bad = [], used = new Set();
  let lines = 0;
  for (const m of MISSIONS) {
    const { def, handle } = loadGrid(m);
    if (!railLines(def, { vehicleSize }).some((r) => r.kind !== 'run')) continue;
    const hits = viewHidden(def, handle.structures, { vehicleSize, solids: await drawnSolids(def) });
    lines++;
    for (const v of hits) {
      const a = VIEW_ALLOW[m.id]?.[v.id];
      if (v.hidden < VIEW_TOL && !v.tag) continue;
      if (a && a.rail === v.rail) used.add(`${m.id}/${v.id}`);
      const at = `${m.id}: ${v.id} (${v.type}, ${v.h} m) hides ${v.hidden} m of ${v.rail}'s rail heads (s ${v.s.join('–')})`;
      if (!a || a.rail !== v.rail) { if (v.hidden >= VIEW_TOL) bad.push(`${at}${v.tag ? ` [tagged: ${v.tag}]` : ''} — set it back from the line (rail-report.mjs --view)`); }
      else if (v.hidden > a.max) bad.push(`${at}, more than its allowance ${a.max} m (${a.why})`);
    }
  }
  for (const [mid, o] of Object.entries(VIEW_ALLOW)) for (const id of Object.keys(o)) if (!used.has(`${mid}/${id}`)) bad.push(`${mid}: ${id} no longer hides its rails — remove its allowance`);
  assert.ok(lines >= 8, `missions with rails (${lines})`);
  assert.deepEqual(bad, []);
});

test('rails in view: the houses set back on 2026-10-29 stay clear (M16 / M18 house_road)', async () => {
  for (const id of ['m16', 'm18']) {
    const { def, handle } = loadGrid(MISSIONS.find((m) => m.id === id));
    const hits = viewHidden(def, new Map([['house_road', handle.structures.get('house_road')]]), { vehicleSize, solids: await drawnSolids(def) });
    assert.deepEqual(hits.map((v) => `${v.id} ${v.hidden} m`), [], `${id}: house_road hides no rail head`);
    // (it stood 4.15 m off the line's axis and hid 13.5 m of it: now 7.7 m)
    const r = railLines(def, { vehicleSize }).find((q) => q.id === 'rail_main');
    const f = railClearance(def, new Map([['house_road', handle.structures.get('house_road')]]), { vehicleSize, near: 10 }).hits.find((h) => h.id === 'house_road' && h.rail === r.id);
    assert.ok(f && f.dist >= 7.5, `${id}: house_road ${f?.dist} m off the rail_main axis`);
  }
});

test('rails in view: M15\'s tram street set back on 2026-10-29 stays clear (the corner block, roof R, the HQ and its communs)', async () => {
  // (user 10-29 "M15, move the buildings": the three hid ~95 m of rail head as drawn — corner_block 33.5, corner_roof 30,
  // hq 32 by tools/layout/rail-view-probe.mjs — and are 9 m back from the street now, their S faces where they were)
  const { def, handle } = loadGrid(MISSIONS.find((m) => m.id === 'm15'));
  const ids = ['corner_block', 'corner_roof', 'corner_turret', 'corner_garden_wall', 'hq', 'hq_communs', 'hq_wing'];
  const hits = viewHidden(def, new Map(ids.map((id) => [id, handle.structures.get(id)])), { vehicleSize, solids: await drawnSolids(def) });
  assert.deepEqual(hits.map((v) => `${v.id} ${v.hidden} m`), [], 'nothing on the tram street\'s S side hides a rail head');
  const f = railClearance(def, new Map(ids.map((id) => [id, handle.structures.get(id)])), { vehicleSize, near: 30 }).hits.filter((h) => h.rail === 'tram_track');
  const at = (id) => Math.min(...f.filter((h) => h.id === id).map((h) => h.dist));
  assert.ok(at('corner_block') >= 17.5 && at('corner_roof') >= 17.5, `the block's N faces ${at('corner_block')} / ${at('corner_roof')} m off the tram's axis (were 10.3)`);
  assert.ok(at('hq') >= 12.5, `the house ${at('hq')} m off it (was 4.5)`);
  // (the communs keep the street line and the demolition point; low enough to hide nothing: walls 3 m under a pitched roof)
  assert.ok(at('hq_communs') <= 5 && def.structures.find((s) => s.id === 'hq_communs').h <= 3.3, 'the communs on the street, one storey');
});
