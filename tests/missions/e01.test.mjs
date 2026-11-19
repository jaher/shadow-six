/**
 * LIGHTS OUT e01 "Dry Stone" (docs/expansion/e01.md): registration and data, then the design's acceptance list (§15)
 * on the headless mission (tools/solutions/headless.mjs: the game's map, units, alarm, set-pieces and objectives):
 *   - the hamlet is the practice area: a forager who wakes raises no zone alarm;
 *   - a man lying behind a dry-stone field wall is hidden from the checkpoint walker; standing, he is not;
 *   - the burn script fails the mission on RMAS with the case on the table, and does nothing once the Hauptmann is
 *     cuffed or the tables are taken;
 *   - a cuffed captive aboard the lorry counts for `deliver` only once the lorry has left by the north road;
 *   - the untainted lorry passes the cistern sentry (ct1, Hard); a tainted one is fired on.
 * The whole plan (0 detections, 0 exposures, the hut blowing after the lorry has left) is the solution's test
 * (tests/e01-solution.test.mjs, headless: tools/solutions/run-headless.mjs e01 [--easy]).
 * Run with the unit suite: node tests/unit/run.mjs e01
 */
import { test, assert } from '../unit/lib.mjs';
import { MISSIONS, CAMPAIGNS, getMission } from '../../src/missions/index.js';
import { validateMission, normalizeMission } from '../../src/missions/schema.js';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { knockOut, cuff } from '../../src/ai/bcd-enemy.js';
import { canSee } from '../../src/ai/perception.js';
import { CONFIG } from '../../src/config.js';
import { MAS } from '../../src/missions/expansion/e01_dry_stone.js';

const M = () => getMission('e01');
const ids = (diff) => normalizeMission(M(), { quiet: true, difficulty: diff }).enemies.map((e) => e.id);
const run = (s, secs, until = null) => { for (let k = 0, n = Math.round(secs / s.dt); k < n; k++) { s.step(); if (until?.()) return true; } return false; };
const log = (w, name) => { const out = []; w.events.on(name, (p) => out.push({ t: w.time, p })); return out; };

test('e01: registered in LIGHTS OUT (BCD), validates with no errors or warnings; 14 men on Easy, 21 on Hard', () => {
  const m = M();
  assert.ok(m && MISSIONS.includes(m) && CAMPAIGNS.BCD.includes(m));
  assert.equal(m.campaign, 'BCD');
  const v = validateMission(m);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
  assert.deepEqual(m.size, [120, 140]);
  assert.deepEqual(m.commandos.map((c) => c.role), ['greenberet', 'driver', 'sapper']);
  assert.deepEqual(ids('easy'), ['f1', 'f2', 'cp1', 'cp2', 'm1', 'g1', 'g2', 'y1', 'st1', 'w1', 'lt1', 'op1', 'hptm', 'drv1']);
  const hard = ids('hard');
  assert.equal(hard.length, 21);
  for (const id of ['ct1', 'm2', 'y2', 'k1', 'p1a', 'p1b', 'p1c']) assert.ok(hard.includes(id), `${id} on Hard`);
  assert.deepEqual(m.objectives.map((o) => o.type), ['deliver', 'script', 'destroy', 'escape']);
  // the heat haze: every man's eyes carry less far (the per-spawn vision override)
  for (const e of normalizeMission(m, { quiet: true }).enemies) assert.equal(e.vision?.far, 28, `${e.id} hazed`);
});

test('e01: the hamlet is the practice area — a forager seen falling, or waking and shouting, raises no zone alarm', () => {
  const s = headlessMission('e01');
  const w = s.world, f1 = w.byId('f1'), f2 = w.byId('f2'), gb = w.commandos.find((c) => c.role === 'greenberet');
  assert.equal(w.alarm.zoneAt(f1.x, f1.z), null, 'f1 walks outside every zone');
  assert.equal(w.alarm.zoneAt(f2.x, f2.z), null, 'f2 stands outside every zone');
  const zones = log(w, 'alarm:zone'), shouts = log(w, 'noise');
  // f2 sees his comrade drop: he shouts (heard at the checkpoint, 32 m off) and comes over to rouse him
  knockOut(f1, gb, w);
  run(s, 20, () => !f1.ko);
  assert.equal(f1.ko, null, 'f2 roused him');
  // with f2 cuffed, f1 knocked out again wakes on his own and shouts
  knockOut(f2, gb, w); assert.ok(cuff(f2, gb, w));
  knockOut(f1, gb, w);
  assert.ok(run(s, CONFIG.bcd.koDuration + 20, () => !f1.ko), 'he wakes');
  run(s, 20);
  assert.ok(shouts.some((n) => (n.p.level ?? 0) >= CONFIG.stealth.zoneHeardLevel), 'there was shouting');
  assert.deepEqual(zones.map((z) => `${z.p.zone}:${z.p.event}`), [], 'no zone fired (z_road hears only the road: heardLocal)');
  assert.equal(w.alarm.siren.active, false, 'no siren');
});

test('e01: a man lying behind the checkpoint field wall is hidden from cp2 at the boom end of his beat; standing, he is seen', () => {
  const s = headlessMission('e01');
  const w = s.world, cp2 = w.byId('cp2'), gb = w.commandos.find((c) => c.role === 'greenberet');
  // cp2's south halt (77.6, 87.2); the field wall wl_cp runs (66.6, 87.7) → (72.0, 92.2) between him and the man
  const P = { x: 68.8, z: 90.6 }, Q = { x: 74.3, z: 84.4 }; // behind the wall · in the open, about as far from him
  const eye = (to) => ({ x: 77.6, z: 87.2, heading: Math.atan2(to.z - 87.2, to.x - 77.6), vision: cp2.vision, faction: 'enemy' });
  const look = (at, stance) => { gb.setPosition(at.x, at.z); gb.setStance(stance); gb._stanceT = 0; w.rebuildSpatial(); return canSee(eye(at), gb, w); };
  assert.equal(look(P, 'crawl'), 'none', 'lying behind the wall: hidden');
  assert.notEqual(look(P, 'stand'), 'none', 'standing behind it: seen');
  assert.notEqual(look(Q, 'crawl'), 'none', 'lying in the open at the same range: seen (near band)');
});

test('e01: the burn script — on RMAS with the case on the table Steinmetz walks to the stove and the tables burn: the mission fails', () => {
  const s = headlessMission('e01');
  const w = s.world, hptm = w.byId('hptm'), ev = w.setpieces.get('tables');
  const burns = log(w, 'bcd:evidence');
  run(s, 1);
  w.alarm.fireEvent('RMAS', { zoneId: 'z_mas', cause: 'seen', x: 95, z: 60 });
  const failed = run(s, 120, () => !!w.scriptFail);
  assert.ok(failed, `the tables burned (phase ${ev.phase}, burned ${ev.burned.toFixed(1)} s)`);
  assert.equal(w.scriptFail, 'THE KEY TABLES ARE ASH.');
  assert.equal(ev.phase, 'ash');
  assert.ok(burns.some((b) => b.p.burning === 'walk') && burns.some((b) => b.p.burning === 'burn'), 'he walked to the stove and burned them');
  assert.ok(Math.hypot(hptm.x - MAS.stove[0], hptm.z - MAS.stove[1]) < 1.7, `at the stove (${hptm.x.toFixed(1)}, ${hptm.z.toFixed(1)})`);
});

test('e01: the burn script does nothing while the Hauptmann is cuffed (only a comrade freeing him starts it), nor once the tables are taken', () => {
  for (const how of ['cuffed', 'taken']) {
    const s = headlessMission('e01');
    const w = s.world, hptm = w.byId('hptm'), ev = w.setpieces.get('tables'), gb = w.commandos.find((c) => c.role === 'greenberet');
    const burns = log(w, 'bcd:evidence'), freed = log(w, 'enemy:freed');
    run(s, 1);
    if (how === 'cuffed') {
      // the radio room's three, as the plan takes them: the lieutenant, the operator and Steinmetz all cuffed
      for (const id of ['lt1', 'op1', 'hptm']) { const e = w.byId(id); knockOut(e, gb, w); assert.ok(cuff(e, gb, w), `${id} cuffed`); }
    } else assert.ok(ev.take(gb), 'the tables taken');
    const t0 = w.time;
    w.alarm.fireEvent('RMAS', { zoneId: 'z_mas', cause: 'seen', x: 95, z: 60 });
    run(s, 90, () => !!w.scriptFail);
    const freedAt = freed.find((f) => f.p.enemy === hptm)?.t ?? Infinity;
    const burning = burns.filter((b) => b.p.burning);
    assert.ok(burning.every((b) => b.t >= freedAt), `${how}: no burn while he is cuffed (freed at ${freedAt}, burns at ${burning.map((b) => b.t.toFixed(1))})`);
    if (how === 'taken') {
      assert.deepEqual(burning, [], 'taken: never a burn');
      assert.equal(w.scriptFail ?? null, null, 'taken: no fail');
      assert.equal(w.objectives.find((o) => o.id === 'o2').done, true, 'o2 done by the take');
    } else if (freedAt === Infinity) {
      assert.equal(w.scriptFail ?? null, null, 'cuffed and nobody to free him: no fail');
      assert.equal(ev.phase, 'idle');
      assert.ok(w.time - t0 > 89, 'for the whole 90 s');
    }
  }
});

/** The lorry put on the north road below the cistern, heading north, the Driver at the wheel (`taint`: marked first). */
function lorryOnNorthRoad(s, { taint = false, z = 44 } = {}) {
  const w = s.world, lorry = w.byId('lorry'), dr = w.commandos.find((c) => c.role === 'driver');
  lorry.setPosition(114.2, z); lorry.heading = -Math.PI / 2;
  dr.setPosition(116.2, z + 1); w.rebuildSpatial();
  assert.ok(lorry.enter(dr), 'the Driver gets in');
  assert.equal(lorry.tainted, false, 'nobody saw him get in');
  if (taint) lorry.taint();
  return { w, lorry, dr };
}

test('e01: a cuffed Steinmetz aboard the lorry counts for o1 only once it has left by the north road', () => {
  const s = headlessMission('e01');
  const { w, lorry } = lorryOnNorthRoad(s, { z: 20 });
  const hptm = w.byId('hptm'), gb = w.commandos.find((c) => c.role === 'greenberet');
  knockOut(hptm, gb, w); assert.ok(cuff(hptm, gb, w));
  const seats = lorry.freeSeats();
  lorry.enter(hptm, seats[seats.length - 1]);
  assert.equal(hptm.vehicle, lorry);
  run(s, 1);
  const o1 = w.objectives.find((o) => o.id === 'o1');
  assert.equal(o1.done, false, 'aboard, not yet away');
  assert.ok(lorry.driveTo(114.2, 1.0, false), 'drive out by the north road');
  run(s, 30, () => o1.done);
  assert.equal(o1.done, true, `delivered once the lorry left (at ${lorry.x.toFixed(1)}, ${lorry.z.toFixed(1)})`);
  assert.equal(hptm.ko, 'bound', 'still cuffed');
});

test('e01 (Hard): the untainted lorry drives past the cistern sentry untouched; a tainted one is fired on', () => {
  for (const taint of [false, true]) {
    const s = headlessMission('e01', { difficulty: 'hard' });
    const { w, lorry } = lorryOnNorthRoad(s, { taint });
    const ct1 = w.byId('ct1');
    assert.ok(ct1 && ct1.y >= 7, 'ct1 on the cistern top');
    const spotted = log(w, 'enemy:spotted');
    assert.ok(lorry.driveTo(114.2, 8, false), 'slow, up the north road past the cistern');
    run(s, 40, () => taint && lorry.hits > 0);
    if (!taint) {
      assert.equal(lorry.hits, 0, 'nobody fired');
      assert.equal(lorry.tainted, false);
      assert.deepEqual(spotted.map((x) => x.p.enemy?.tag ?? x.p.enemy?.id), [], 'nobody spotted anyone');
    } else {
      assert.ok(lorry.hits > 0, `the marked lorry is fired on (${lorry.hits} hits)`);
    }
  }
});
