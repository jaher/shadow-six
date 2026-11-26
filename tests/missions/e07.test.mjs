/**
 * LIGHTS OUT e07 "White Out" (docs/expansion/e07.md §15): the contract and validation; the container's knapsacks
 * (each restores its own man's kit, and only his); the ski patrol reads a trail in the snow (negative control: no
 * trail, no tracking); the cornice charge buries the gallery and closes the north road (o3), and the bowser blown in the
 * tunnel bore does the same, but not outside it; the Feldwebel smashes the type plates on the hotel's alarm and the
 * mission is lost, never with the Feldwebel bound or the plates taken; Vering goes to ground behind the hotel and stays
 * there; the cable car is shot down under the summit alarm while the flak crew lives, and reaches the ridge with the
 * crew dead. Run with the unit suite: node tests/unit/run.mjs e07
 */
import { test, assert } from '../unit/lib.mjs';
import { getMission, CAMPAIGNS } from '../../src/missions/index.js';
import { validateMission, applyVariant } from '../../src/missions/schema.js';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { findPath } from '../../src/world/pathfinding.js';
import { knockOut, cuff } from '../../src/ai/bcd-enemy.js';
import { e07Of, CORNICE_AT, VERING_HIDE, SMASH_AT, CAR_LOW, TUNNEL, PASS_LOCK_FAIL, passChargesLeft } from '../../src/missions/scripts/e07.js';
import { CONFIG } from '../../src/config.js';

const DT = CONFIG.sim.dt;
const sim = (diff = 'hard') => {
  const s = headlessMission('e07', diff === 'easy' ? { difficulty: 'easy' } : {});
  const w = s.world;
  for (let k = 0; k < 12; k++) s.step(); // (the set-pieces install on the first ticks)
  return { ...s, w, run(sec, until = null) { for (let k = 0, n = Math.round(sec / DT); k < n; k++) { s.step(); if (until?.()) return true; } return false; },
    get: (id) => w.enemies.find((e) => e.tag === id || e.id === id) || w.byId(id), c: (r) => w.commandos.find((c) => c.role === r),
    it: (id) => w.interactables.find((i) => (i.tag ?? i.id) === id), obj: (id) => w.objectives.find((o) => o.id === id) };
};
const place = (u, x, z) => { u.setPosition?.(x, z) ?? Object.assign(u, { x, z }); u.y = 0; };
const RHOT = (w) => w.alarm.fireEvent('RHOT', { zoneId: 'z_hotel', cause: 'test', x: 64, z: 120 });
const RSUM = (w) => w.alarm.fireEvent('RSUM', { zoneId: 'z_summit', cause: 'test', x: 110, z: 40 });
const inPoly = (poly, x, z) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};

test('e07: registered in LIGHTS OUT slot 7; validates with no errors or warnings on Easy and Hard; 41 / 48 enemies', () => {
  const m = getMission('e07');
  assert.ok(m && CAMPAIGNS.BCD.includes(m) && m.number === 7 && m.campaign === 'BCD');
  for (const [d, n] of [['easy', 41], ['hard', 48]]) {
    const v = applyVariant(m, d), r = validateMission(v);
    assert.deepEqual(r.errors, [], d);
    assert.deepEqual(r.warnings, [], d);
    assert.equal(v.enemies.length, n, `${d}: ${v.enemies.length} enemies`);
  }
});

test('e07 knapsacks: each restores its own man\'s kit (o1 the Sapper\'s charges, o1b the Driver\'s rifle), and only his', () => {
  const s = sim(), sap = s.it('knap_sap'), drv = s.it('knap_drv');
  const [sa, dr, gb] = ['sapper', 'driver', 'greenberet'].map(s.c);
  assert.equal(sap.canUse(dr), 'Not my kit.');
  assert.equal(sap.canUse(gb), 'Not my kit.');
  assert.equal(drv.canUse(sa), 'Not my kit.');
  assert.ok(!sa.has('remoteBomb') && !sa.has('detonator'), 'the Sapper lands without his charges');
  assert.ok(!dr.has('leeEnfield'), 'the Driver lands without his rifle');
  assert.equal(sap.canUse(sa), true);
  sap.interact(sa);
  s.run(0.5);
  assert.ok(sa.has('remoteBomb') && sa.has('detonator') && sa.has('wireCutters'), 'the Sapper has his kit back');
  assert.ok(s.obj('o1').done && !s.obj('o1b').done, 'o1 only');
  assert.equal(sap.canUse(sa), 'Empty.');
  drv.interact(dr);
  s.run(0.5);
  assert.ok(dr.has('leeEnfield'), 'the Driver has his rifle');
  assert.ok(s.obj('o1b').done, 'o1b');
});

test('e07 ski patrol: the file leaves its loop to follow a trail of boot prints across the snow; no trail, no tracking', () => {
  const trail = []; // (east across the loop's south leg, then down the cliff's foot)
  for (let x = 80; x <= 103; x += 0.75) trail.push([x, 64]);
  for (let z = 64.75; z <= 84; z += 0.75) trail.push([103, z]);
  const runIt = (prints) => {
    const s = sim(), sk1 = s.get('sk1'), sa = s.c('sapper');
    // (laid as a man walks: each print a little newer than the one before)
    if (prints) trail.forEach(([x, z], i) => s.w.ai.footprints.add({ x, z, heading: 0, t: s.w.time - (trail.length - i) * 0.5, owner: sa, aiVisible: true, terrain: 'snow' }));
    let tracked = false, best = Infinity;
    s.run(150, () => {
      if (sk1.brain?.state === 'TRACKS') tracked = true;
      if (tracked) best = Math.min(best, Math.hypot(sk1.x - 103, sk1.z - 84));
      return tracked && best < 6;
    });
    return { tracked, best };
  };
  const a = runIt(true);
  assert.ok(a.tracked, 'the sergeant takes up the trail');
  assert.ok(a.best < 6, `he follows it down the cliff's foot (closest ${a.best.toFixed(1)} m from its end)`);
  const b = runIt(false);
  assert.ok(!b.tracked, 'without prints the file keeps its loop');
});

test('e07 cornice: a charge at its foot brings the slide down on the gallery: both mouths buried, o3 done', () => {
  const s = sim(), { w } = s, g = w.grid;
  const inside = [58, 35], roadN = [58, 12], roadS = [58, 58];
  assert.ok(findPath(g, ...inside, ...roadN) && findPath(g, ...inside, ...roadS), 'the road runs through the gallery before');
  const sp = s.c('spy'), dr = s.c('driver');
  place(sp, 66.5, 30); // (on the slope, in the slide)
  place(dr, 58, 35); // (inside the gallery)
  w.events.emit('explosion', { kind: 'bomb', x: CORNICE_AT[0], z: CORNICE_AT[1], r: 3, source: s.c('sapper') });
  s.run(1);
  assert.equal(e07Of(w).closed, 'cornice');
  assert.ok(s.obj('o3').done, 'o3 done');
  for (const [x, z] of [[58, 19], [58, 21], [58, 49], [58, 50]]) assert.equal(g.walkableAt(x, z), false, `the mouth at (${x}, ${z}) is rock`);
  assert.equal(findPath(g, ...inside, ...roadN), null, 'shut in: no way north');
  assert.equal(findPath(g, ...inside, ...roadS), null, 'shut in: no way south');
  assert.ok(!sp.alive, 'a man in the slide outside the gallery is killed');
  assert.ok(dr.alive, 'a man inside the gallery is shut in, alive');
});

test('e07 bowser: three rounds into it inside the tunnel bore seal the tunnel (o3); outside the bore it is only a fire', () => {
  const a = sim(), b = a.get('bowser');
  b.takeDamage(1, null, 'rifle'); b.takeDamage(1, null, 'rifle');
  assert.ok(!b.destroyed, 'two rounds are not enough');
  b.takeDamage(1, null, 'rifle');
  a.run(1);
  assert.ok(b.destroyed && !a.obj('o3').done && e07Of(a.w).closed == null, 'blown at its parking place: no o3');
  const s = sim(), { w } = s, bw = s.get('bowser'), g = w.grid, mid = (TUNNEL.x0 + TUNNEL.x1) / 2;
  const across = [TUNNEL.x0 + 0.6, mid, TUNNEL.x1 - 0.6];
  assert.ok(across.every((x) => g.walkableAt(x, 77)), 'the bore is open before');
  Object.assign(bw, { x: mid, z: 77 });
  for (let k = 0; k < 3; k++) bw.takeDamage(1, null, 'rifle');
  s.run(1);
  assert.equal(e07Of(w).closed, 'bowser');
  assert.ok(s.obj('o3').done, 'o3 done');
  assert.ok(across.every((x) => !g.walkableAt(x, 77) && !g.walkableAt(x, 74.5) && !g.walkableAt(x, 79.5)), 'the burning wreck seals the bore wall to wall');
});

test('e07 plates: on the hotel alarm the Feldwebel smashes them and the mission is lost; never with him bound in his lorry or the plates taken', () => {
  const s = sim(), pf1 = s.get('pf1');
  RHOT(s.w);
  s.run(180, () => !!s.w.scriptFail);
  assert.equal(s.w.scriptFail, 'THE PLATES ARE SCRAP. APRIL\'S KEYS ARE GONE.');
  assert.ok(Math.hypot(pf1.x - SMASH_AT[0], pf1.z - SMASH_AT[1]) < 2, 'at the anvil');
  // the Feldwebel bound first and put in the back of his lorry, where nobody cuts him loose
  const b = sim(), gb = b.c('greenberet'), f = b.get('pf1'), lorry = b.w.byId('lorry_press');
  knockOut(f, gb, b.w); cuff(f, gb, b.w);
  const seats = lorry.freeSeats();
  lorry.enter(f, seats[seats.length - 1]);
  assert.equal(f.vehicle, lorry, 'in the lorry');
  RHOT(b.w);
  b.run(120);
  assert.equal(b.w.scriptFail ?? null, null, 'bound: no smash');
  // the plates taken first
  const c = sim();
  c.it('plates_case').interact?.(c.c('spy')) ?? c.it('plates_case').onUse?.(c.c('spy'));
  assert.ok(c.obj('o2').done, 'o2 done when taken');
  RHOT(c.w);
  c.run(120);
  assert.equal(c.w.scriptFail ?? null, null, 'taken: nothing to smash');
});

test('e07 Vering: on the hotel alarm he leaves his desk for the woodshed corner behind the hotel and stays there', () => {
  const s = sim(), v = s.get('vering'), zone = s.w.mission.zones.find((z) => z.id === 'z_hotel').poly;
  RHOT(s.w);
  s.run(90, () => Math.hypot(v.x - VERING_HIDE[0], v.z - VERING_HIDE[1]) < 1.5);
  assert.ok(Math.hypot(v.x - VERING_HIDE[0], v.z - VERING_HIDE[1]) < 1.5, `at his hide (${v.x.toFixed(1)}, ${v.z.toFixed(1)})`);
  let left = false;
  s.run(120, () => { if (!inPoly(zone, v.x, v.z)) left = true; return left; });
  assert.ok(!left && v.alive && !v.removed, 'he never leaves the hotel grounds');
  assert.ok(Math.hypot(v.x - VERING_HIDE[0], v.z - VERING_HIDE[1]) < 3, 'still at his hide');
});

/** Everyone and the bound Major aboard the docked cabin, o1–o3 done: the car leaves. */
function board(s) {
  const { w } = s, car = w.byId('cablecar'), v = s.get('vering'), gb = s.c('greenberet');
  for (const id of ['o1', 'o2', 'o3']) s.obj(id).done = true;
  knockOut(v, gb, w); cuff(v, gb, w);
  place(v, CAR_LOW.x + 0.6, CAR_LOW.z);
  s.run(0.5);
  assert.ok(car.occupants?.includes(v), 'the Major berthed in the cabin');
  for (const c of w.commandos) car.enter(c);
  assert.ok(w.commandos.every((c) => c.vehicle === car), 'the team aboard');
  return car;
}

test('e07 cable car: under the summit alarm the flak shoots it down while its crew lives; with the crew dead it reaches the ridge', () => {
  const a = sim(), car = board(a);
  RSUM(a.w);
  a.run(120, () => !!a.w.scriptFail);
  assert.equal(a.w.scriptFail, 'THE FLAK HAS SHOT DOWN THE CABLE CAR.');
  assert.ok(car.destroyed && a.w.commandos.every((c) => !c.alive), 'the car and everyone in it lost');
  const b = sim();
  for (const id of ['fk1', 'fk2']) b.get(id).die?.('test', null);
  const car2 = board(b);
  RSUM(b.w);
  b.run(150, () => (car2.railS ?? 0) >= (car2.trackLen ?? Infinity) - 1e-3 || !!b.w.scriptFail);
  assert.equal(b.w.scriptFail ?? null, null, 'no loss');
  assert.ok(!car2.destroyed && (car2.railS ?? 0) >= (car2.trackLen ?? Infinity) - 1e-3, 'the car at the ridge station');
  assert.ok(e07Of(b.w).rsum, 'the summit alarm was up all the way');
});

// ------------------------------------------------------------------ the Driver's rifle at the north mouth

test('e07 rifle: one round from north of the spur kills ps3 at the north mouth and nobody hears it; the spur hides him from (82,66); the body lies in g2\'s view', () => {
  for (const diff of ['easy', 'hard']) {
    const s = sim(diff), { w } = s, dr = s.c('driver'), ps3 = s.get('ps3'), sk1 = s.get('sk1'), g2 = s.get('g2');
    s.it('knap_drv').interact(dr);
    s.run(0.5);
    dr.setStance('crawl');
    s.run(1);
    const refusal = (x, z) => { place(dr, x, z); return dr.issue({ type: 'ability', id: 'rifle', target: ps3 }) ? true : dr.lastRefusal?.text; };
    assert.equal(refusal(82, 66), 'Out of range.', `${diff}: the design's (82,66) is 27.4 m off`);
    assert.equal(refusal(79, 66), 'No line of sight.', `${diff}: south of z 62 the spur's shoulder hides the mouth`);
    // north of the spur, with the ski patrol away at its far corner (it walks this slope: the shot is timed by it)
    assert.ok(s.run(200, () => Math.hypot(sk1.x - 76, sk1.z - 30) < 2), 'the ski patrol at its north-west corner');
    place(dr, 80, 60);
    const near = w.enemies.filter((e) => e.alive && e !== ps3 && Math.hypot(e.x - 80, e.z - 60) <= CONFIG.weapons.leeEnfield.noise);
    assert.deepEqual(near.map((e) => e.tag), [], `${diff}: nobody within the shot's ${CONFIG.weapons.leeEnfield.noise} m`);
    const heard = [];
    w.events.on('alarm:zone', (p) => { if (p.cause === 'heard') heard.push(w.time); });
    assert.equal(refusal(80, 60), true, `${diff}: in reach from (80,60)`);
    const t0 = w.time;
    assert.ok(s.run(3, () => !ps3.alive), `${diff}: one round kills ps3`);
    s.run(1.5);
    assert.deepEqual(heard.filter((t) => t - t0 < 1.5), [], `${diff}: nobody heard the shot`);
    // (the loud insurance, not a quiet kill: at his south turn g2 looks out of the gallery onto the mouth)
    assert.ok(g2.sawKill, `${diff}: g2 sees him fall`);
  }
});

// ------------------------------------------------------------------ the soft-lock guard

test('e07 pass lock: the one charge fired off the cornice with the bowser burnt outside the bore fails the mission 0.5 s on; either left, nothing fails', () => {
  /** Nobody about but the Major at his desk (only the charge and the bowser decide); the Sapper has his pack back. */
  const quiet = () => {
    const s = sim(), sap = s.c('sapper');
    for (const e of [...s.w.enemies]) if ((e.tag ?? e.id) !== 'vering') s.w.remove(e);
    s.it('knap_sap').interact(sap);
    s.run(0.5);
    assert.equal(sap.inventory.get('remoteBomb'), 1, 'the Sapper\'s one charge');
    return { s, w: s.w, sap };
  };
  /** The Sapper sets his charge at (x, z) on the snowfield, stands well off and fires it; returns the blast time. */
  const fireOff = (s, sap, x = 95, z = 68) => {
    place(sap, x, z);
    assert.ok(sap.issue({ type: 'ability', id: 'remoteBomb' }), `set (${sap.lastRefusal?.text ?? ''})`);
    assert.ok(s.run(5, () => s.w.interactables.some((i) => i.interactKind === 'bomb' && i.placed)), 'set');
    assert.equal(passChargesLeft(s.w), 1, 'set on the snow it still counts');
    place(sap, x, z + 16);
    let t = null;
    s.w.events.on('bomb:exploded', () => { t ??= s.w.time; });
    assert.ok(sap.issue({ type: 'ability', id: 'detonate' }), 'fired');
    assert.ok(s.run(3, () => t != null), 'it goes off');
    assert.ok(sap.alive, 'the Sapper stood clear');
    return t;
  };
  const burnBowser = (s) => { const b = s.get('bowser'); for (let k = 0; k < 3; k++) b.takeDamage(1, null, 'rifle'); assert.ok(b.destroyed); };
  { // the bowser first (at its parking place: only a fire), then the charge off the cornice → fail 0.5 s after the blast
    const { s, w, sap } = quiet();
    burnBowser(s);
    s.run(5);
    assert.equal(w.scriptFail ?? null, null, 'the charge still in hand: nothing fails');
    const t = fireOff(s, sap);
    assert.equal(w.scriptFail ?? null, null, 'not at once');
    assert.ok(s.run(2, () => !!w.scriptFail), 'the mission fails');
    assert.equal(w.scriptFail, PASS_LOCK_FAIL);
    assert.ok(w.time - t >= 0.45 && w.time - t <= 0.65, `0.5 s after the blast (${(w.time - t).toFixed(2)})`);
    assert.ok(!s.obj('o3').done && e07Of(w).closed == null, 'the pass open');
  }
  { // the charge first, then the bowser outside the bore → fail 0.5 s after the bowser
    const { s, w, sap } = quiet();
    fireOff(s, sap);
    s.run(5);
    assert.equal(w.scriptFail ?? null, null, 'the bowser still whole: nothing fails');
    assert.equal(passChargesLeft(w), 0);
    const t = w.time;
    burnBowser(s);
    assert.ok(s.run(2, () => !!w.scriptFail), 'the mission fails');
    assert.equal(w.scriptFail, PASS_LOCK_FAIL);
    assert.ok(w.time - t >= 0.45 && w.time - t <= 0.65, `0.5 s after the bowser (${(w.time - t).toFixed(2)})`);
  }
  { // negative control: the bowser burnt in the bore closes the pass (o3), then the charge fired anywhere: no fail
    const { s, w, sap } = quiet(), b = s.get('bowser');
    Object.assign(b, { x: (TUNNEL.x0 + TUNNEL.x1) / 2, z: 77 });
    burnBowser(s);
    s.run(1);
    assert.ok(s.obj('o3').done, 'o3 done');
    fireOff(s, sap);
    s.run(10);
    assert.equal(w.scriptFail ?? null, null, 'no fail');
  }
  { // negative control: the charge at the cornice's foot brings it down, then the bowser burns outside: no fail
    const { s, w, sap } = quiet();
    w.events.emit('explosion', { kind: 'bomb', x: CORNICE_AT[0], z: CORNICE_AT[1], r: 3, source: sap });
    sap.inventory.set('remoteBomb', 0); // (as if it had been that charge)
    s.run(1);
    assert.ok(s.obj('o3').done, 'o3 done');
    burnBowser(s);
    s.run(10);
    assert.equal(w.scriptFail ?? null, null, 'no fail');
  }
  { // the counter: the charge in the pack on the snow, then in the Sapper's kit
    const s = sim(), w = s.w;
    assert.equal(passChargesLeft(w), 1, 'in the container\'s pack');
    s.it('knap_sap').interact(s.c('sapper'));
    s.run(0.5);
    assert.equal(passChargesLeft(w), 1, 'in his kit');
    s.c('sapper').inventory.set('remoteBomb', 0);
    assert.equal(passChargesLeft(w), 0);
    assert.equal(e07Of(w).checkPassLock(), false, 'the bowser whole: nothing to guard');
    assert.equal(w.scriptFail ?? null, null);
  }
});

// ------------------------------------------------------------------ the cabin waits, and says so

test('e07 cabin: everyone and the Major aboard while the pack, the plates or the pass are still to do — it stays and says what it waits for, once per change', () => {
  const s = sim(), { w } = s, car = w.byId('cablecar'), v = s.get('vering'), gb = s.c('greenberet');
  const said = [];
  w.events.on('message', (m) => { if (/stays at its berth/.test(m.text)) said.push(m.text); });
  s.obj('o1').done = true;
  knockOut(v, gb, w); cuff(v, gb, w);
  place(v, CAR_LOW.x + 0.6, CAR_LOW.z);
  s.run(0.5);
  assert.ok(car.occupants?.includes(v), 'the Major in the cabin');
  const [first, ...rest] = w.commandos;
  for (const c of rest) car.enter(c);
  s.run(5);
  assert.deepEqual(said, [], 'negative control: one man still out, not a word');
  car.enter(first);
  s.run(5);
  assert.deepEqual(said, ['The cabin stays at its berth: the type plates are still on the press lorry and the pass is still open.']);
  s.run(20);
  assert.equal(said.length, 1, 'said once, not every tick');
  assert.ok(!car.railRunning && (car.railS ?? 0) <= 1e-6, 'the cabin at its berth');
  s.obj('o2').done = true;
  s.run(1);
  assert.deepEqual(said.slice(1), ['The cabin stays at its berth: the pass is still open.'], 'a new list, said anew');
  s.obj('o3').done = true;
  assert.ok(s.run(30, () => (car.railS ?? 0) > 1), 'all done: the cabin leaves');
  assert.equal(said.length, 2, 'and leaves without a word');
});


// ------------------------------------------------------------------ a quick load with the Major berthed

import { restoreWorld } from '../../src/save.js';
import { Entity } from '../../src/entities/entity.js';

test('e07 load: the Major berthed in the docked cabin is aboard again at once after a quick load, and his line is not said twice', () => {
  // (verifier r3: right after restoreWorld he lay bound beside the cabin, its occupants empty — they came back at the
  // cabin's own first update, after the set-piece's tick had put him aboard a second time and said the line again)
  const TRUSSED = /trussed like a sack of flour/;
  const fresh = () => { Entity.nextId = 1; return sim(); };
  const A = fresh(), wa = A.w, va = A.get('vering'), gb = A.c('greenberet');
  const saidA = [];
  wa.events.on('message', (m) => { if (TRUSSED.test(m.text)) saidA.push(wa.time); });
  knockOut(va, gb, wa); cuff(va, gb, wa);
  place(va, CAR_LOW.x + 0.6, CAR_LOW.z);
  A.run(0.5);
  assert.equal(saidA.length, 1, 'positive control: berthed in a running game, the line is said once');
  assert.ok(wa.byId('cablecar').occupants.includes(va), 'the Major aboard');
  const S = JSON.parse(JSON.stringify({ ...wa.serialize(), nextId: Entity.nextId, ai: wa.ai?.serialize?.() ?? null }));
  const AL = JSON.parse(JSON.stringify(wa.alarm.serialize()));
  const B = fresh(), wb = B.w;
  restoreWorld(wb, S);
  wb.alarm.deserialize(AL);
  const car = wb.byId('cablecar'), vb = B.get('vering');
  assert.ok(car.occupants.includes(vb) && vb.vehicle === car && vb.state === 'inVehicle', `aboard before any tick (${vb.state}, ${car.occupants.length} aboard)`);
  const saidB = [];
  wb.events.on('message', (m) => { if (TRUSSED.test(m.text)) saidB.push(wb.time); });
  B.run(5);
  assert.deepEqual(saidB, [], 'the line is not said again after the load');
  assert.deepEqual(car.occupants.map((u) => u.id), [vb.id], 'aboard once, as saved');
});
