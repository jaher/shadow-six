/**
 * LIGHTS OUT e04 "Black Rain" (docs/expansion/e04.md): the contract and validation, the heap's levels (the exit is
 * reached only over the heap), the incline (winch-only; three men unseen in the skip; a commando working the winch
 * is seen by the rim sentry: the negative control of the puppet), the shaft script (fails the mission on the centre
 * alarm with the archive on the desk; nothing once o1 is done; the papers drop where the chief falls), the coal train
 * (kills on its track, screens while it passes). Run with the unit suite: node tests/unit/run.mjs e04
 */
import { test, assert } from '../unit/lib.mjs';
import { getMission, CAMPAIGNS } from '../../src/missions/index.js';
import { validateMission, applyVariant } from '../../src/missions/schema.js';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { findPath } from '../../src/world/pathfinding.js';
import { canSee } from '../../src/ai/perception.js';
import { knockOut, cuff } from '../../src/ai/bcd-enemy.js';
import { WINCH, INCLINE, EXIT, SHAFT, TOP } from '../../src/missions/expansion/e04_black_rain.js';
import { CONFIG } from '../../src/config.js';

const DT = CONFIG.sim.dt;
const sim = (diff = 'hard') => {
  const s = headlessMission('e04', diff === 'easy' ? { patch: (d) => ({ ...d, difficulty: 'easy' }) } : {});
  const w = s.world, log = [];
  w.events.on('e04:shaft', (p) => log.push(p.stage));
  for (let k = 0; k < 12; k++) s.step(); // (the mission script installs on the first ticks)
  return { ...s, w, log, run(sec, until = null) { for (let k = 0, n = Math.round(sec / DT); k < n; k++) { s.step(); if (until?.()) return true; } return false; },
    get: (id) => w.enemies.find((e) => e.tag === id || e.id === id) || w.byId(id), c: (r) => w.commandos.find((c) => c.role === r),
    it: (id) => w.interactables.find((i) => (i.tag ?? i.id) === id) };
};

test('e04: registered in LIGHTS OUT slot 4; validates with no errors or warnings on Easy and Hard; 27 / 34 enemies', () => {
  const m = getMission('e04');
  assert.ok(m && CAMPAIGNS.BCD.includes(m) && m.number === 4 && m.campaign === 'BCD');
  for (const [d, n] of [['easy', 27], ['hard', 34]]) {
    const v = applyVariant(m, d), r = validateMission(v);
    assert.deepEqual(r.errors, [], d);
    assert.deepEqual(r.warnings, [], d);
    assert.equal(v.enemies.length, n, `${d}: ${v.enemies.length} enemies`);
  }
});

test('e04 levels: the exit pocket is reached only over the heap (down the east path), never round it from the yard', () => {
  const { w } = sim();
  const g = w.grid, at = (x, z) => findPath(g, x, z, EXIT.x, EXIT.z);
  assert.equal(at(170, 66), null, 'from the yard by the incline foot');
  assert.equal(at(180, 15.6), null, 'from the strip under the north fence');
  assert.equal(at(196, 70), null, 'from the lagoon bank');
  assert.equal(findPath(g, 170, 66, 182, 44), null, 'nobody walks up the heap');
  assert.ok(at(182, 44), 'from the top, down the east path');
  for (const [x, z] of [[182, 44], [176.6, 48.2], [INCLINE.b[0], INCLINE.b[1]]]) assert.ok(Math.abs(g.elevAt(x, z) - 18) < 1e-6, `top at y 18 (${x}, ${z})`);
});

test('e04 incline: winch-only; three crouching men ride up unseen; a commando at the winch is seen by the rim sentry (the puppet\'s negative control)', () => {
  const s = sim(), { w } = s, skip = s.it('incline'), winch = s.it('incline_winch'), hp1 = s.get('hp1');
  const [gb, dr, sa, sn] = ['greenberet', 'driver', 'sapper', 'sniper'].map(s.c);
  assert.equal(skip.canUse(dr), 'The skip is worked from the winding house.');
  // three men in the skip at the foot, crouching
  [dr, sa, sn].forEach((u, k) => { u.setPosition?.(INCLINE.a[0] + (k - 1) * 0.5, INCLINE.a[1]) ?? Object.assign(u, { x: INCLINE.a[0] + (k - 1) * 0.5, z: INCLINE.a[1] }); u.y = 0; u.setStance('crouch'); u._stanceT = 0; });
  // the Green Beret works the winch himself: the rim sentry sees him there within a sweep or two
  gb.setPosition?.(WINCH[0], WINCH[1] + 1.6) ?? Object.assign(gb, { x: WINCH[0], z: WINCH[1] + 1.6 });
  gb.y = 0; gb.setStance('stand'); gb._stanceT = 0; // (the mission starts the team prone)
  let seenAtWinch = false;
  for (let k = 0; k < 12 / DT && !seenAtWinch; k++) { s.step(); if (canSee(hp1, gb, w) !== 'none') seenAtWinch = true; }
  assert.ok(seenAtWinch, 'the rim sentry sees a commando at the winch');
  // the ride: nobody alive sees the three men while the skip travels
  assert.ok(winch.interact(gb), 'the winch sends the skip');
  let seen = [];
  s.run(9, () => {
    if (!skip.ride) return true;
    for (const e of w.enemies) if (e.alive && e.vision) for (const u of [dr, sa, sn]) if (canSee(e, u, w) !== 'none') seen.push(`${e.tag}->${u.role}`);
    return false;
  });
  assert.deepEqual([...new Set(seen)], [], 'unseen in the skip');
  assert.equal(skip.at, 1, 'arrived at the top');
  for (const u of [dr, sa, sn]) assert.ok(Math.abs(u.y - 18) < 1e-6 && Math.hypot(u.x - INCLINE.b[0], u.z - INCLINE.b[1]) < 1.5, `${u.role} on the top`);
});

test('e04 shaft: on the centre alarm the chief takes the archive to the shaft and the mission is lost', () => {
  const s = sim();
  s.w.alarm.fireEvent('RC', { zoneId: 'z_centre', cause: 'test', x: 140, z: 50 });
  s.run(240, () => !!s.w.scriptFail);
  assert.equal(s.w.scriptFail, 'THE ARCHIVE IS AT THE BOTTOM OF SAINTE-BARBE.');
  assert.deepEqual(s.log, ['office', 'shaft', 'ring', 'down']);
  assert.ok(Math.hypot(s.get('lt').x - SHAFT[0], s.get('lt').z - SHAFT[1]) < 2.2, 'he is at the collar');
});

test('e04 shaft: nothing once o1 is done; the papers drop where the chief falls on his way', () => {
  const a = sim();
  const o1 = a.w.objectives.find((o) => o.id === 'o1');
  a.it('archive').interact(a.c('sniper')); // a commando has the papers
  assert.ok(o1.done, 'o1 done when a commando takes the archive');
  a.w.alarm.fireEvent('RC', { zoneId: 'z_centre', cause: 'test', x: 140, z: 50 });
  a.run(120);
  assert.equal(a.w.scriptFail ?? null, null, 'no loss');
  assert.deepEqual(a.log, []);
  const b = sim(), lt = b.get('lt'), ar = b.it('archive');
  b.w.alarm.fireEvent('RC', { zoneId: 'z_centre', cause: 'test', x: 140, z: 50 });
  b.run(180, () => b.log.includes('shaft'));
  assert.equal(ar.takenBy, lt.id, 'he carries it');
  b.run(3);
  knockOut(lt, b.c('greenberet'), b.w); cuff(lt, b.c('greenberet'), b.w);
  b.run(1);
  assert.equal(ar.takenBy, null, 'dropped');
  assert.ok(Math.hypot(ar.x - lt.x, ar.z - lt.z) < 0.01, 'where he fell');
  assert.equal(ar.canUse(b.c('greenberet')), true);
  b.run(60);
  assert.equal(b.w.scriptFail ?? null, null);
});

test('e04 coal train: it kills a man on its track and screens what is behind it while it passes', () => {
  const s = sim(), { w } = s, train = w.vehicles.find((v) => v.vehicleType === 'train');
  const sn = s.c('sniper');
  Object.assign(sn, { x: 100, z: 12 }); sn.y = 0;
  const gb = s.c('greenberet');
  Object.assign(gb, { x: 100, z: 16 }); gb.y = 0;
  const viewer = { x: 100, z: 6, y: 0, heading: Math.PI / 2, vision: { fov: 70, near: 18, far: 36, sweep: 0, period: 5 }, alive: true };
  assert.notEqual(canSee(viewer, gb, w), 'none', 'seen across the empty line');
  let screened = false;
  s.run(60, () => { if (train.railRunning && Math.abs(train.x - 100) < 6) { w.rebuildSpatial(); w.refreshDynamicOccluders(); if (canSee(viewer, gb, w) === 'none') screened = true; } return !sn.alive && screened; });
  assert.ok(!sn.alive, 'the man on the track is dead');
  assert.ok(screened, 'the passing train hides the man behind it');
});

test('e04 top: the DF hut is a bomb-only target standing on the heap; the incline and the gully land on the top', () => {
  const { w } = sim();
  const hut = w.interactables.find((i) => (i.tag ?? i.id) === 'df_hut');
  assert.ok(hut?.bombOnly, 'bomb only');
  const g = w.grid;
  assert.equal(g.walkableAt(182, 37.5), false, 'its footprint stays solid on the top');
  const link = (w.links || g.links || []).find?.((l) => l.id === 'gully') ?? null;
  assert.ok(link || (w.mission.climbLinks || []).some((l) => l.id === 'gully'), 'the gully climb exists');
  assert.ok(TOP.length >= 5);
});
