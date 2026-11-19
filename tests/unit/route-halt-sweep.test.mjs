/**
 * A route point's own head sweep at its halt (`sweep`, degrees each side; src/ai/enemy-brain.js _route): a walker
 * halted there swings his head that much instead of the patrol watch's ±50° (CONFIG.stealth.vision.patrolWatch). A
 * route point without it behaves as before; the schema keeps the field only where a mission sets it (every BEL route
 * normalises exactly as it did). LIGHTS OUT e01 uses it for the forager who loots a doorway and the checkpoint walker.
 */
import { test, assert } from './lib.mjs';
import { bcdSim } from './bcd-sim.mjs';
import { normalizeMission } from '../../src/missions/schema.js';
import { CONFIG } from '../../src/config.js';
import { MISSIONS } from '../../src/missions/index.js';

const DEG = Math.PI / 180;
/** A walker on a two-point beat; the first point holds 8 s looking south with the given sweep (undefined: none set). */
function walker(sweep) {
  const pts = [{ x: 20, z: 20, wait: 8, look: 90, ...(sweep !== undefined ? { sweep } : {}) }, { x: 30, z: 20, wait: 0 }];
  return { id: 'w', soldierType: 'soldier', x: 20, z: 20, heading: Math.PI / 2, route: { type: 'PINGPONG', vel: 1.0, points: pts } };
}
/** The head offsets (rad) the man shows over his first halt. */
function headSwing(sweep) {
  const s = bcdSim({ enemies: [walker(sweep)] });
  const e = s.get('w');
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < 6 / CONFIG.sim.dt; k++) {
    s.step();
    if (!e.brain.atWait || e.brain.routeIndex !== 0) continue;
    const off = e.sweepActive ? (e.sweepAmp ?? e.vision.sweep) : 0;
    lo = Math.min(lo, -off); hi = Math.max(hi, off);
  }
  return { lo, hi, amp: e.sweepAmp };
}

test('route halt sweep: a point\'s own `sweep` sets the head swing at that halt; none keeps the patrol watch', () => {
  const pw = CONFIG.stealth.vision.patrolWatch.sweep;
  const dflt = headSwing(undefined), narrow = headSwing(10), still = headSwing(0);
  assert.ok(Math.abs(dflt.hi - pw * DEG) < 1e-9, `default halt swings ±${pw}° (${(dflt.hi / DEG).toFixed(1)})`);
  assert.ok(Math.abs(narrow.hi - 10 * DEG) < 1e-9, `sweep 10 swings ±10° (${(narrow.hi / DEG).toFixed(1)})`);
  assert.equal(still.hi, 0, 'sweep 0: his head stays on the look');
});

test('route halt sweep: the schema keeps `sweep` only where it is set; every shipped BEL route is unchanged', () => {
  const m = normalizeMission({ id: 'rt', size: [40, 40], enemies: [walker(12), { ...walker(undefined), id: 'v' }] }, { quiet: true });
  assert.equal(m.enemies[0].route.points[0].sweep, 12);
  assert.ok(!('sweep' in m.enemies[1].route.points[0]), 'no field when none is set');
  for (const def of MISSIONS.filter((d) => d.campaign !== 'BCD')) {
    for (const e of normalizeMission(def, { quiet: true }).enemies) {
      for (const p of e.route?.points ?? []) assert.ok(!('sweep' in p), `${def.id} ${e.id}: no halt sweep in a BEL route`);
    }
  }
});
