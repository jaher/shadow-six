/** AI rules beyond the §10.5 table: §4.5 arithmetic, §4.10 arrest/jail, §4.9 barracks, §4.3 kill seen, mg, tracks, perf. */
import { test, assert, near } from './lib.mjs';
import { makeWorld, addEnemy, addCommando, run, first, step } from './ai-harness.mjs';
import { perceive, ellipseFar, coneAt } from '../../src/ai/perception.js';
import { B } from '../../src/world/grid.js';
import { Interactable } from '../../src/entities/interactables.js';
import { applyExplosion } from '../../src/abilities/explosions.js';

const GUARD = { id: 'g', soldierType: 'sentry', x: 20, z: 40, heading: 0, post: { heading: 0, sweep: 0 } };

test('§4.2 ellipse: far(±50°) = 42% of far; near = far/2', () => {
  near(ellipseFar(36, (50 * Math.PI) / 180) / 36, 0.42, 0.01);
  const w = makeWorld({ enemies: [GUARD] });
  const c = coneAt(w.enemies[0]);
  near(c.far, 36, 1e-9); near(c.near, 18, 1e-9); near(c.halfFov, (35 * Math.PI) / 180, 1e-9);
});

test('§4.5 N arithmetic: walker +12/tick (floor(2·2.5²) − 1 decay), decay 1000 → < T in ~47.5 s', () => {
  const w = makeWorld({ enemies: [{ ...GUARD, nervousness: 1e6 }] }); // huge T: watch N grow without a challenge
  const g = w.enemies[0];
  const c = addCommando(w, 'greenberet', 40, 36);
  run(w, 0.5);
  c.moveTo(40, 60);
  const Ns = [];
  const off = w.onBelTick(() => Ns.push(g.nervousness));
  run(w, 0.5);
  off();
  const d = Ns.slice(2, 8).map((v, i, a) => (i ? v - a[i - 1] : null)).slice(1);
  assert.ok(d.every((x) => x === 11), `N grows by 12 − 1 per tick (${d})`);
  const w2 = makeWorld({ enemies: [GUARD] });
  w2.enemies[0].nervousness = 1000;
  run(w2, 47.45);
  assert.equal(w2.enemies[0].nervousness, 51);
  run(w2, 0.1);
  assert.ok(w2.enemies[0].nervousness < 50);
  assert.equal(w2.enemies[0].alertLevel, 1, 'alertLevel 1 while N > 0');
});

test('§4.5 within 2.25 m: N = 20·T at once → challenge even when frozen', () => {
  const w = makeWorld({ enemies: [GUARD] });
  const c = addCommando(w, 'greenberet', 22, 40);
  run(w, 0.2);
  assert.equal(w.enemies[0].nervousness >= 1000 || w.enemies[0].brainState !== 'IDLE', true);
  assert.ok(first(w, 'enemy:challenge', (p) => p.target === c));
});

function patrolWorld(jail) {
  return makeWorld({
    structures: [{ type: 'hut', id: 'stockade', x: 60, z: 60, w: 4, d: 4 }],
    jails: jail ? ['stockade'] : [],
    enemies: [{ id: 'sgt', soldierType: 'sergeant', x: 20, z: 40, heading: 0, squad: { id: 'p1', leader: 'sgt' }, vision: { sweep: 0 }, route: { type: 'STOPPED', points: [{ x: 20, z: 40 }] } }],
  });
}

test('§4.10 patrol + jail: challenge → ARREST → escorted at 1.8 m/s → jailed', () => {
  const w = patrolWorld(true);
  const s = w.enemies[0];
  const c = addCommando(w, 'sniper', 30, 38);
  w.events.on('enemy:challenge', () => c.stop());
  c.moveTo(30, 45);
  run(w, 2);
  assert.equal(s.brainState, 'ARREST');
  run(w, 60, () => c.state === 'jailed');
  assert.ok(first(w, 'unit:captured'), 'captured');
  assert.equal(c.state, 'jailed');
  assert.ok(first(w, 'unit:jailed'));
  assert.equal(first(w, 'shot'), null, 'no shots');
  assert.equal(c.held, false);
});

test('§4.5 patrol without jail → COMBAT; sentry → HOLD', () => {
  const w = patrolWorld(false);
  const c = addCommando(w, 'greenberet', 30, 38);
  w.events.on('enemy:challenge', () => c.stop());
  c.moveTo(30, 45);
  run(w, 1.5);
  assert.equal(w.enemies[0].brainState, 'COMBAT');
  assert.ok(first(w, 'enemy:challenge'), 'challenged first ("Halt!")');
});

test('§4.3 kill seen: sawKill, COMBAT against the killer, zone alarm', () => {
  const w = makeWorld({ enemies: [GUARD, { id: 'v', soldierType: 'soldier', x: 35, z: 40, heading: Math.PI }], zones: [{ id: 'z', poly: [[0, 0], [80, 0], [80, 80], [0, 80]], onSeen: 'RINT' }] });
  const c = addCommando(w, 'greenberet', 36, 40.5);
  c.hidden = true; // the killer himself is not seen: the kill is (victim in the cone)
  run(w, 0.1);
  w.enemies[1].die('knife', c);
  run(w, 0.1);
  const g = w.enemies[0];
  assert.equal(g.sawKill, true);
  assert.equal(g.brainState, 'COMBAT');
  assert.equal(g.target, c);
  assert.equal(w.alarm.zonesFired[0].event, 'RINT');
});

test('§4.1 mg fires on sight (no nervousness), bursts of 100-damage rounds; traverse ±giro/2', () => {
  const w = makeWorld({ enemies: [{ id: 'mg', soldierType: 'mg', x: 20, z: 40, heading: 0, giro: 90, post: { heading: 0, sweep: 0 } }] });
  const c = addCommando(w, 'greenberet', 35, 42); // frozen, 15 m ahead
  run(w, 1.2);
  const mg = w.enemies[0];
  assert.equal(first(w, 'enemy:state').p.to, 'COMBAT', 'straight to COMBAT');
  assert.equal(first(w, 'enemy:challenge'), null, 'no challenge');
  assert.ok(!c.alive || c.hp <= 100, `mg rounds hit (hp ${c.hp})`);
  assert.equal(mg.brain._traverseOk(Math.PI), false);
  assert.equal(mg.brain._traverseOk(0.7), true);
});

test('§4.8 tracks: a followsTracks guard sees prints in its near band → TRACKS to the newest → RETURN', () => {
  const w = makeWorld({ enemies: [{ id: 'p', soldierType: 'soldier', x: 20, z: 40, heading: 0, vision: { sweep: 0 }, route: { type: 'STOPPED', points: [{ x: 20, z: 40 }] } }] });
  const e = w.enemies[0];
  const c = addCommando(w, 'greenberet', 70, 70);
  for (let k = 0; k < 8; k++) w.ai.footprints.add({ x: 30 + k * 1.5, z: 40 + k * 1.2, heading: 0, t: k * 0.5, owner: c, aiVisible: true });
  w.ai.footprints.add({ x: 28, z: 40, heading: 0, t: 0, owner: e, aiVisible: false }); // enemy/MUD prints: visual only
  run(w, 0.2);
  assert.equal(e.brainState, 'TRACKS');
  run(w, 20, () => e.brainState === 'RETURN');
  assert.equal(e.brainState, 'RETURN');
  assert.ok(Math.hypot(e.x - (30 + 7 * 1.5), e.z - (40 + 7 * 1.2)) < 1.2, 'followed the trail to its newest print');
  assert.equal(w.ai.footprints.visible().length, 9, 'trail renderer query hook');
});

test('§4.9 barracks: RINT releases the squad (2.7 m/s exit, loop), regenerates 20 s after it dies, pool runs out', () => {
  const w = makeWorld({
    structures: [{ type: 'barracks', id: 'b1', x: 60, z: 20, w: 8, d: 6, reinforcementSpawn: true }],
    barracks: { b1: { pool: 5, squads: [{ event: 'RINT', size: 3, exitRoute: [[60, 26], [50, 30]], loop: [[50, 30], [40, 30], [40, 40]] }] } },
  });
  w.alarm.fireEvent('RINT', { cause: 'test', x: 1, z: 1 });
  assert.equal(w.enemies.length, 3);
  assert.deepEqual(w.enemies.map((e) => e.soldierType), ['sergeant', 'trooper', 'trooper']);
  assert.ok(first(w, 'reinforcements'));
  run(w, 0.5);
  assert.ok(w.enemies.every((e) => e.brainState === 'REINFORCE'));
  near(w.enemies[0].speed, 2.7, 1e-6, 'exit route speed');
  run(w, 12);
  assert.ok(Math.hypot(w.enemies[0].x - 50, w.enemies[0].z - 30) < 12, 'left along the exit route');
  for (const e of [...w.enemies]) e.die('shot', null);
  run(w, 19.5);
  assert.equal(w.enemies.filter((e) => e.alive).length, 0);
  run(w, 1);
  assert.equal(w.enemies.filter((e) => e.alive).length, 2, 'rebuilt from the remaining pool (5 − 3)');
  for (const e of w.enemies) if (e.alive) e.die('shot', null);
  run(w, 25);
  assert.equal(w.enemies.filter((e) => e.alive).length, 0, 'pool empty');
});

test('§4.9 no exit leg (exitRoute [] or one point at the door, M3): door → first loop waypoint at 2.7 m/s, then loop at 1.8', () => {
  for (const exitRoute of [[], [[60, 24]]]) {
    const w = makeWorld({
      structures: [{ type: 'barracks', id: 'b1', x: 60, z: 20, w: 8, d: 6 }],
      barracks: { b1: { pool: 3, squads: [{ event: 'RCAMP', size: 1, exitRoute, loop: [[50, 30], [40, 30], [40, 40]] }] } },
    });
    w.alarm.fireEvent('RCAMP', { cause: 'test', x: 1, z: 1 });
    const e = w.enemies[0];
    run(w, 0.5);
    assert.equal(e.brainState, 'REINFORCE');
    near(e.speed, 2.7, 1e-6, `exit leg speed (exitRoute ${JSON.stringify(exitRoute)})`);
    run(w, 20, () => Math.hypot(e.x - 50, e.z - 30) < 0.5);
    run(w, 1);
    near(e.speed, 1.8, 1e-6, 'loop speed after reaching the first loop waypoint');
    run(w, 30, () => Math.hypot(e.x - 40, e.z - 40) < 0.5);
    run(w, 30, () => Math.hypot(e.x - 50, e.z - 30) < 0.5);
    run(w, 0.5);
    near(e.speed, 1.8, 1e-6, 'the looped return leg stays at 1.8 m/s');
  }
});

test('§4.9/§7.5 a bomb that razes a garrison releases no squad from it (its own blast raises RINT first)', () => {
  const w = makeWorld({
    zones: [{ id: 'z', poly: [[0, 0], [80, 0], [80, 80], [0, 80]], onSeen: 'RINT', onHeard: 'RINT' }],
    structures: [{ type: 'barracks', id: 'b1', x: 60, z: 20, w: 8, d: 6 }, { type: 'barracks', id: 'b2', x: 20, z: 60, w: 8, d: 6 }],
    barracks: { b1: { pool: 5, squads: [{ event: 'RINT', size: 3 }] }, b2: { pool: 4, squads: [{ event: 'RINT', size: 2 }] } },
  });
  w.add(new Interactable({ interactKind: 'explosiveTarget', tag: 'b1', x: 60, z: 20, radius: 4 }));
  w.add(new Interactable({ interactKind: 'door', tag: 'b2', x: 20, z: 64, destructible: true }));
  w.interactables.at(-1).destroyed = true; // a blown door shares the tag but does not raze b2
  w.rebuildSpatial();
  applyExplosion(w, 64, 20, 'bomb', null); // E-corner charge: razes b1, its noise fires RINT
  assert.ok(w.alarm.active, 'the blast raised the alarm');
  assert.ok(w.alarm.barracks.b1.destroyed, 'b1 razed');
  const reinf = w.log.filter((l) => l.type === 'reinforcements').map((l) => l.p.barracksId);
  assert.deepEqual(reinf, ['b2'], 'only the intact garrison turns out');
  assert.equal(w.enemies.length, 2);
  w.alarm.fireEvent('RINT', { cause: 'test' });
  assert.equal(w.enemies.length, 2, 'a later RINT releases nothing from the ruin');
});

test('perf: perception for 60 enemies < 1 ms per step', () => {
  const w = makeWorld({ size: [200, 200] });
  for (let k = 0; k < 20; k++) w.grid.fillRect(10 + k * 9, 30 + (k % 5) * 30, 3, 8, 'block', B.HIGH);
  for (let k = 0; k < 60; k++) addEnemy(w, { soldierType: 'sentry', x: 5 + (k % 10) * 19, z: 8 + Math.floor(k / 10) * 31, heading: k });
  for (let k = 0; k < 6; k++) addCommando(w, 'greenberet', 20 + k * 30, 100 + k * 5);
  for (let k = 0; k < 200; k++) w.ai.footprints.add({ x: (k * 7) % 200, z: (k * 13) % 200, t: 0, owner: w.commandos[0], aiVisible: true });
  w.rebuildSpatial();
  const N = 300;
  let t0 = performance.now();
  for (let s = 0; s < N; s++) { w.time += 1 / 60; for (const e of w.enemies) perceive(e, w, { prints: true }); }
  const per = (performance.now() - t0) / N;
  t0 = performance.now();
  for (let s = 0; s < 120; s++) step(w);
  const full = (performance.now() - t0) / 120;
  console.log(`       perception ${per.toFixed(3)} ms/step, full sim step ${full.toFixed(3)} ms (60 enemies)`);
  assert.ok(per < 1.0, `perception ${per.toFixed(3)} ms`);
});

test('§4.8 regression: a commando walking on SNOW emits footprints into world.ai.footprints (MUD visual-only, GRASS none)', async () => {
  const { T } = await import('../../src/world/grid.js');
  const walk = (code) => {
    const w = makeWorld({});
    w.grid.terrain.fill(code);
    const c = addCommando(w, 'driver', 20, 40);
    const evs = [];
    w.events.on('footprint', (p) => evs.push(p));
    c.moveTo(30, 40);
    run(w, 8);
    return { w, c, evs };
  };
  const s = walk(T.SNOW);
  assert.ok(s.c.x > 29, `walked 10 m (x=${s.c.x.toFixed(2)})`);
  assert.ok(s.evs.length >= 10, `footprint events on snow (${s.evs.length})`);
  assert.equal(s.evs[0].terrain, 'snow', 'payload keeps the terrain name (audio stepSfx)');
  assert.ok(s.w.ai.footprints.list.length >= 10, `stored in world.ai.footprints (${s.w.ai.footprints.list.length})`);
  assert.ok(s.w.ai.footprints.visible().length >= 10 && s.evs.every((e) => e.aiVisible), 'AI-visible on snow');
  const sand = walk(T.SAND);
  assert.ok(sand.evs.length >= 10 && sand.evs.every((e) => e.aiVisible), 'sand prints AI-visible');
  const mud = walk(T.MUD);
  assert.ok(mud.evs.length >= 10 && mud.evs.every((e) => !e.aiVisible), 'MUD prints are visual only');
  assert.equal(walk(T.GROUND).evs.length, 0, 'no prints on plain ground');
});

test('§4.5 sawBody bonus is +max(1,T/25) once per tick, not once per seen commando', () => {
  const deltas = (n) => {
    const w = makeWorld({ enemies: [GUARD] });
    const g = w.enemies[0];
    g.sawBody = true;
    const cs = [addCommando(w, 'greenberet', 40, 36)];
    if (n > 1) cs.push(addCommando(w, 'sniper', 40, 44));
    const Ns = [];
    const off = w.onBelTick(() => Ns.push(g.nervousness));
    run(w, 1.2);
    off();
    assert.ok(cs.every((c) => g.brain._seen.some((s) => s.unit === c)), 'all commandos seen');
    return Ns.slice(6, 16).map((v, i, a) => (i ? v - a[i - 1] : null)).slice(1);
  };
  const one = deltas(1), two = deltas(2);
  assert.ok(one.every((x) => x === 1), `1 seen: +2 − 1 decay per tick (${one})`);
  assert.ok(two.every((x) => x === 1), `2 seen: still +2 − 1 decay per tick (${two})`);
});

test('§4.5 per-spawn T: close commando → N = 20·T (not a fixed 1000); cap 20·T; decays below T in (20T−T)/20 s', () => {
  const w = makeWorld({ enemies: [{ ...GUARD, nervousness: 100 }] });
  const g = w.enemies[0];
  assert.equal(g.nervThreshold, 100);
  addCommando(w, 'greenberet', 22, 40); // 2 m away: close-range rule
  let peak = 0;
  const off = w.onBelTick(() => { peak = Math.max(peak, g.nervousness); });
  run(w, 0.2);
  off();
  assert.equal(peak, 2000, `N jumps to 20·T = 2000 (got ${peak})`);
  // Lingering alert: 2000 decays 1/tick → below T=100 after 1901 ticks = 95.05 s.
  const w2 = makeWorld({ enemies: [{ ...GUARD, nervousness: 100 }] });
  const g2 = w2.enemies[0];
  g2.nervousness = 2000;
  run(w2, 0.05);
  assert.equal(g2.nervousness, 1999, 'not clamped to 1000');
  run(w2, 94.9);
  assert.ok(g2.nervousness >= 100, `still ≥ T just before 95 s (${g2.nervousness})`);
  run(w2, 0.2);
  assert.ok(g2.nervousness < 100, `below T after ~95 s (${g2.nervousness})`);
});
