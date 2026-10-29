/**
 * No building on the rails (user 2026-10-28: "Make sure no buildings are on top of rails"): over every mission, no
 * building / structure / street-furniture footprint inside a rail corridor — the drawn track's ballast + 0.3 m, and on
 * a line a train, tram or mine cart runs, its hull's half-width + 0.5 m — and no tree, rock or cliff on the sleepers
 * (src/missions/rail-clearance.js; report: node tools/layout/rail-report.mjs). Rolling stock, the bridges that carry
 * a line, buffer stops and structures tagged `onRails` stand on rails by design.
 */
import { test, assert } from './lib.mjs';
import { MISSIONS } from '../../src/missions/index.js';
import { loadGrid } from './mission-check.mjs';
import { vehicleDef } from '../../src/entities/vehicle.js';
import { railClearance, railLines, trackCentreline, bedHalf, CLEAR, onRailsReason } from '../../src/missions/rail-clearance.js';
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
  const bad = [];
  let lines = 0;
  for (const m of MISSIONS) {
    const { def, handle } = loadGrid(m);
    // (the library models as drawn too: a log cabin's eaves, a pier's T head reach well past their footprints)
    const drawn = railLines(def, { vehicleSize }).length ? await drawnPlans(def) : null;
    const r = railClearance(def, handle.structures, { vehicleSize, drawn });
    lines += r.rails.length;
    for (const h of r.hits) bad.push(`${m.id}: ${fmt(h)}`);
  }
  assert.ok(lines >= 15, `rail lines found (${lines})`);
  assert.deepEqual(bad, []);
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
