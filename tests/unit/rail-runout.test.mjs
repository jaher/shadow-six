/**
 * 'once' trains leave the map whole (user 2026-10-28: "the train leaves fully the map, not stops at the edge and
 * disappears"): entities/rail-runout.js — the drawn consist comes in from, and runs out to, where nothing of it can be
 * seen at any camera the game allows; the sim train is untouched (its every tick the same with the run-in / run-out
 * drawn or not); the rails drawn past the edge are the ones it runs on (world/edge-extend.js railReach).
 */
import { readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { CONFIG } from '../../src/config.js';
import { World } from '../../src/world/world.js';
import { createVehicle } from '../../src/entities/vehicle.js';
import { MISSIONS } from '../../src/missions/index.js';
import { TRAIN_CONSIST, RUNOUT, hiddenReach, mapDistance, runoutGeometry, runoutPose } from '../../src/entities/rail-runout.js';
import { edgeStructureRuns } from '../../src/world/edge-extend.js';

const DT = CONFIG.sim.dt;
const ONCE = MISSIONS.flatMap((m) => (m.vehicles || []).filter((v) => Array.isArray(v.track) && (v.schedule?.mode ?? (v.vehicleType === 'train' ? 'once' : '')) === 'once').map((v) => ({ m, v })));

test('rail run-out: the drawn consist\'s extents are the sidecars\' (manifest train.consist, buffers touching)', () => {
  const man = JSON.parse(readFileSync(new URL('../../assets/models/vehicles/manifest.json', import.meta.url)));
  let z = 0, front = null, top = 0, half = 0;
  man.types.train.consist.forEach((name, i) => {
    const a = man.assets[name], v = a.variants[a.byTheater.temperate];
    const b = JSON.parse(readFileSync(new URL(`../../assets/models/vehicles/rail/${v}.json`, import.meta.url))).bbox;
    if (i) z -= b.max[2]; else front = b.max[2];
    z += b.min[2];
    top = Math.max(top, b.max[1]); half = Math.max(half, b.max[0]);
  });
  assert.ok(Math.abs(front - TRAIN_CONSIST.front) < 0.01, `front ${front}`);
  assert.ok(Math.abs(-z - TRAIN_CONSIST.rear) < 0.01, `rear ${-z}`);
  assert.ok(Math.abs(top - TRAIN_CONSIST.top) < 0.01 && Math.abs(half - TRAIN_CONSIST.half) < 0.01, `top ${top} half ${half}`);
  // nothing past the apron is ever in view; a top 4.55 m up leans in by h·cot(25°) at the flattest pitch
  assert.ok(Math.abs(hiddenReach() - (CONFIG.apron.width + 4.55 / Math.tan(RUNOUT.pitchMinDeg * Math.PI / 180) + RUNOUT.margin)) < 1e-9);
  assert.ok(ONCE.length >= 3 && ['m04', 'm16', 'm18'].every((id) => ONCE.some((o) => o.m.id === id)), ONCE.map((o) => o.m.id).join());
});

/** One train alone on its mission's map, ticked like the game (the vehicles, then world.time). */
function trainWorld(m, v) {
  const w = new World({ size: m.size });
  w.vehicleFactory = createVehicle;
  const train = w.spawnVehicle(v.vehicleType, { ...v });
  return { w, train, tick: () => { train.update(DT); w.time += DT; } };
}
/** The drawn consists this tick: [{slot, s}] — the entity's model (sim pose / run-in / run-out) and the twin's. */
function drawn(train) {
  const ro = train._runout, out = [];
  if (!ro) return out;
  if (train.railRunning) out.push({ slot: 'main', s: train.railS });
  else if (ro.st.lead) out.push({ slot: 'main', s: ro.st.lead.s });
  else if (!ro.ghost && ro.st.out) out.push({ slot: 'main', s: ro.st.out.s });
  if (ro.ghost && ro.st.out) out.push({ slot: 'ghost', s: ro.st.out.s });
  return out;
}
/** A point of the track polyline at parameter q (0..trackLen). */
function onTrack(train, q) {
  let k = 0;
  while (k < train.segLen.length - 1 && q > train.segLen[k]) { q -= train.segLen[k]; k++; }
  const a = train.track[k], b = train.track[k + 1], f = train.segLen[k] > 0 ? Math.min(1, q / train.segLen[k]) : 0;
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
}
/** The nearest point of the consist at track parameter s to the map rectangle (m). */
function consistGap(train, geo, s, W, D) {
  let best = Infinity;
  for (let a = -TRAIN_CONSIST.rear; a <= TRAIN_CONSIST.front + 1e-9; a += 0.5) {
    const q = s + a, p = q < 0 || q > train.trackLen ? runoutPose(geo, train.trackLen, q) : onTrack(train, q);
    best = Math.min(best, mapDistance(p.x, p.z, W, D));
  }
  return best;
}

for (const { m, v } of ONCE) {
  test(`rail run-out ${m.id} ${v.id}: whole consist past the visible edge when it appears and when it is hidden; the sim train unchanged`, () => {
    const [W, D] = m.size;
    const A = trainWorld(m, v), B = trainWorld(m, v);
    B.train._runout = null; // the bare sim train (no presenter)
    const reach = hiddenReach();
    const T = (v.schedule.delay ?? 10) + 3 * ((v.schedule.period ?? 60) + 60);
    // a drawn train goes on from one tick to the next where some drawn consist was within a tick's run of it (the
    // twin taking the run-out over from the entity's model at the hide is one train going on, not one hidden and
    // one appearing); one with none before it appears, one with none after it is hidden
    const step = 40 * DT; // (≤ 40 m/s: the fastest run-in)
    let prev = [], events = 0, swaps = 0;
    for (let k = 0; k < Math.round(T / DT); k++) {
      A.tick(); B.tick();
      const a = A.train, b = B.train;
      // the sim is the same tick for tick
      assert.ok(a.x === b.x && a.z === b.z && a.heading === b.heading && a.railS === b.railS && a.railT === b.railT
        && a.hiddenRail === b.hiddenRail && a.speed === b.speed, `${m.id} tick ${k}: sim state differs`);
      const geo = a._runout.geo, now = drawn(a);
      const judge = (s, what) => {
        const gap = consistGap(a, geo, s, W, D);
        assert.ok(gap >= reach - 0.2, `${m.id} a train ${what} at t=${A.w.time.toFixed(2)} (s ${s.toFixed(1)}) with its consist ${gap.toFixed(1)} m past the map (needs ${reach.toFixed(1)})`);
        events++;
      };
      if (k > 0) {
        for (const d of now) if (!prev.some((q) => Math.abs(q.s - d.s) <= step)) judge(d.s, 'appears');
        for (const q of prev) if (!now.some((d) => Math.abs(q.s - d.s) <= step)) judge(q.s, 'is hidden');
        for (const d of now) { const q = prev.find((p) => Math.abs(p.s - d.s) <= step); if (q && q.slot !== d.slot) swaps++; }
      }
      prev = now;
    }
    assert.ok(events >= 4, `${m.id}: ${events} appear / hide events`);
    if (A.train._runout.ghost) assert.ok(swaps >= 2, `${m.id}: the twin takes the run-out over (${swaps})`);
    assert.ok(A.train._runout.geo.leadIn > 100 && A.train._runout.geo.leadOut > 150, `${m.id} leads ${A.train._runout.geo.leadIn.toFixed(0)} / ${A.train._runout.geo.leadOut.toFixed(0)} m`);
  });
}

test('rail run-out: M4\'s train every 34 s gets a twin for the run-out (it outlasts the hidden spell); M16 / M18 do not', () => {
  const ghost = (id) => {
    const { m, v } = ONCE.find((o) => o.m.id === id);
    const { train, tick } = trainWorld(m, v);
    tick();
    return train._runout.ghost;
  };
  assert.equal(ghost('m04'), true);
  assert.equal(ghost('m16'), false);
  assert.equal(ghost('m18'), false);
});

test('rail run-out: the rails drawn past the edge run on along the train\'s track, as far as the view reaches', () => {
  for (const id of ['m04', 'm16', 'm18']) {
    const m = MISSIONS.find((q) => q.id === id), [W, D] = m.size;
    const train = m.vehicles.find((v) => v.vehicleType === 'train');
    const len = CONFIG.apron.width + 12;
    const runs = edgeStructureRuns(m.structures, W, D, len, { railReach: true, tracks: [train.track] }).filter((r) => r.def.type === 'rail_track');
    const geo = runoutGeometry(train.track, W, D);
    const T = train.track.map((p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : p));
    for (const [p, d] of [[T[0], { x: -geo.d0.x, z: -geo.d0.z }], [T[T.length - 1], geo.dn]]) {
      // the drawn run through this end of the track: along the track's end segment (≤ 5 cm off), reaching ≥ len square
      const r = runs.find((q) => Math.abs((q.points[0][0] - p.x) * d.z - (q.points[0][1] - p.z) * d.x) < 0.05);
      assert.ok(r, `${id}: a drawn rail run carries the track on past (${p.x}, ${p.z})`);
      const [a, b] = r.points, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      assert.ok(Math.abs(((b[0] - a[0]) / L) * d.z - ((b[1] - a[1]) / L) * d.x) < 1e-6, `${id}: along the track`);
      assert.ok(mapDistance(b[0], b[1], W, D) >= len - 1e-6, `${id}: reaches ${mapDistance(b[0], b[1], W, D).toFixed(1)} m past the map`);
    }
  }
});
