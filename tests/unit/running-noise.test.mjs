/**
 * SHADOW SIX house rule `runningNoise` (design-spec §4.4 amendment, docs/bodies-design.md §0.3): a commando running
 * upright is heard by guards within a surface-dependent radius; walking, crawling, swimming and a disguised Spy stay
 * silent; CLASSIC 1998 keeps BEL's silent movement. Headless sims on the exact 60 Hz / 20 Hz time base.
 */
import * as THREE from 'three';
import { test, assert, near } from './lib.mjs';
import { makeWorld, addEnemy, addCommando, run, first } from './ai-harness.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { CONFIG } from '../../src/config.js';
import { T } from '../../src/world/grid.js';
import { angleDiff, angleTo } from '../../src/core/math.js';
import { hears } from '../../src/ai/perception.js';
import { stepSurface, runNoiseRadius, makesRunNoise } from '../../src/ai/running-noise.js';
import { resolveHouseRules, forcedRuleLines, houseFlags, restoreHouseRules } from '../../src/core/house-rules.js';
import { HOUSE_KEYS, matchingPreset, OPTION_ROWS, OPTION_HELP } from '../../src/ui/options-panel.js';
import { OPTION_DEFAULTS, loadOptions, OPTIONS_KEY } from '../../src/ui/ui-config.js';
import { applyElevation } from '../../src/world/map-builder.js';
import { loadGrid } from './mission-check.mjs';
import { getMission } from '../../src/missions/index.js';
import { NoiseRings, noiseRingShape, RING_GROW, RING_LIFE } from '../../src/render/noise-rings.js';
import { EVENT_NAMES } from '../../src/core/events.js';

const RN = CONFIG.stealth.runNoise;
const ZONE = { id: 'camp', poly: [[0, 0], [60, 0], [60, 60], [0, 60]], onSeen: 'RINT', onHeard: 'REXT' };
// a sentry at (30, 30) looking east (+x) with a fixed head: his back is the west side
const SENTRY = { id: 'g', soldierType: 'sentry', x: 30, z: 30, heading: 0, post: { heading: 0, sweep: 0 } };

function world(terrain = T.GROUND, extra = {}) {
  const w = makeWorld({ size: [60, 60], enemies: [SENTRY], ...extra });
  w.grid.fillRect(0, 0, 60, 60, 'terrain', terrain);
  return w;
}
const steps = (w) => { const a = []; w.events.on('noise', (n) => { if (n.kind === 'footsteps') a.push({ ...n, t: w.time }); }); return a; };
const facing = (e, x, z, tol = 0.2) => Math.abs(angleDiff(e.heading, angleTo(e.x, e.z, x, z))) < tol;

/** Run (or walk) along x = 30 − back, from z = 15 to z = 45, behind the sentry; returns the log. */
function passBehind(terrain, back, mode = 'run', setup = null) {
  const w = world(terrain);
  const g = w.enemies[0];
  const c = addCommando(w, 'greenberet', 30 - back, 15, Math.PI / 2);
  setup?.(w, c);
  const heard = steps(w);
  run(w, 0.2);
  c.moveTo(30 - back, 45, { run: mode === 'run' });
  return { w, g, c, heard };
}

test('running noise (a): a Green Beret running 8 m behind a sentry on a road is heard — he turns, says "Was war das?", "Halt!", no alarm yet', () => {
  const { w, g, c, heard } = passBehind(T.ROAD, 8);
  let turnT = null;
  run(w, 8, () => {
    if (turnT == null && Math.abs(g.heading) > 0.5) turnT = w.time;
    return g.brainState === 'CHALLENGE';
  });
  assert.ok(heard.length >= 1, 'steps emitted');
  assert.equal(heard[0].radius, RN.radius.road);
  assert.equal(heard[0].surface, 'road');
  assert.equal(heard[0].level, 1);
  const inRange = heard.find((n) => Math.hypot(n.x - g.x, n.z - g.z) <= n.radius);
  assert.ok(inRange, 'a step within the road radius');
  assert.ok(turnT != null && turnT - inRange.t < 0.6, `turned at once (${turnT} vs ${inRange.t})`);
  assert.ok(first(w, 'bark', (p) => p.unit === g && p.line === 'ger_suspicious'), '"Was war das?"');
  assert.equal(g.brainState, 'CHALLENGE', 'he sees the runner → "Halt!"');
  assert.equal(first(w, 'enemy:challenge')?.p.target, c);
  assert.equal(w.alarm.active, false, 'a challenge, not an alarm');
  assert.equal(w.alarm.zonesFired.length, 0);
});

test('running noise (b): sand muffles the steps (6 m) — 8 m behind: nothing heard; 4 m behind: heard', () => {
  const far = passBehind(T.SAND, 8);
  run(far.w, 7);
  assert.ok(far.heard.length >= 8 && far.heard.every((n) => n.surface === 'sand' && n.radius === RN.radius.sand));
  near(far.g.heading, 0, 1e-9, 'never turned');
  assert.equal(far.g.brainState, 'IDLE');
  const near4 = passBehind(T.SAND, 4);
  run(near4.w, 7, () => Math.abs(near4.g.heading) > 0.5);
  assert.ok(Math.abs(near4.g.heading) > 0.5, 'turned to the steps at 4 m');
});

test('running noise (c): walking right up behind a guard is silent — heading unchanged at 1 m; the walk-up knife kill still works', () => {
  const w = world(T.ROAD);
  const g = w.enemies[0];
  const c = addCommando(w, 'greenberet', 20, 30, 0);
  const heard = steps(w);
  c.moveTo(29, 30); // walk to 1 m behind his back
  run(w, 6, () => !c.path);
  near(Math.hypot(c.x - 29, c.z - 30), 0, 0.05);
  assert.equal(heard.length, 0, 'no footsteps noise');
  near(g.heading, 0, 1e-9, 'never turned');
  assert.equal(g.brainState, 'IDLE');
  // knife from behind, walking up (real brains)
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }], enemies: [guard('e1', 14, 10, 0)] });
  s.world.grid.fillRect(0, 0, 60, 60, 'terrain', T.ROAD);
  const gb = s.cmd('greenberet'), e = s.get('e1');
  assert.ok(gb.issue({ type: 'ability', id: 'knife', target: e }));
  s.run(4, () => !e.alive);
  assert.equal(e.alive, false);
  assert.equal(e.deathCause, 'knife');
  assert.equal(s.count('noise'), 0, 'walk-up and stab: silent');
  // running up to stab is heard: the guard turns to the runner before the stab lands
  const s2 = makeSim({ commandos: [{ role: 'greenberet', x: 4, z: 10 }], enemies: [guard('e2', 14, 10, 0)] });
  s2.world.grid.fillRect(0, 0, 60, 60, 'terrain', T.ROAD);
  const gb2 = s2.cmd('greenberet'), e2 = s2.get('e2');
  assert.ok(gb2.issue({ type: 'ability', id: 'knife', target: e2, run: true }));
  s2.run(0.6);
  assert.ok(s2.count('noise', (n) => n.kind === 'footsteps') >= 1, 'the run is heard');
  assert.ok(Math.abs(angleDiff(e2.heading, 0)) > 2, 'he faced the runner');
});

test('running noise (d): crawling, swimming and a disguised Spy running make no step noise', () => {
  const crawl = passBehind(T.ROAD, 4, 'run', (w, c) => c.setStance('crawl'));
  run(crawl.w, 8);
  assert.equal(crawl.c.moveMode, 'walk', 'a crawler cannot run');
  assert.equal(crawl.heard.length, 0);
  const spy = (() => {
    const w = world(T.ROAD);
    const c = addCommando(w, 'spy', 26, 15, Math.PI / 2);
    c.disguised = true;
    const heard = steps(w);
    c.moveTo(26, 45, { run: true });
    run(w, 7);
    return { w, c, heard };
  })();
  assert.ok(Math.hypot(spy.c.x - 26, spy.c.z - 45) < 0.1, 'he ran the whole way');
  assert.equal(spy.heard.length, 0, 'a German running past is no news');
  // a swimmer / diver and a man in a vehicle (stance or state) never qualify
  const w = world(T.ROAD);
  const c = addCommando(w, 'diver', 10, 10);
  c.moveTo(10, 20, { run: true });
  assert.equal(makesRunNoise(c, w), true);
  for (const st of ['swim', 'dive', 'crawl', 'crouch']) { c.stance = st; assert.equal(makesRunNoise(c, w), false, st); }
  c.stance = 'stand';
  c.state = 'inVehicle';
  assert.equal(makesRunNoise(c, w), false, 'in a vehicle');
  c.state = 'active';
  // enemies running never make step noise for each other
  const e = addEnemy(w, { id: 'r', soldierType: 'soldier', x: 40, z: 40, heading: 0 });
  e.moveTo(40, 55, { run: true });
  assert.equal(e.moveMode, 'run');
  assert.equal(makesRunNoise(e, w), false, 'enemy runner');
});

test('running noise (e): CLASSIC 1998 (house rule off) — the same road run makes no noise and the sentry never turns', () => {
  const { w, g, heard } = passBehind(T.ROAD, 8, 'run', (w) => { w.house.runningNoise = false; });
  run(w, 7);
  assert.equal(heard.length, 0);
  near(g.heading, 0, 1e-9);
  assert.equal(g.brainState, 'IDLE');
  // the preset itself
  const cw = makeWorld({ size: [60, 60] });
  cw.house = resolveHouseRules({ preset: 'classic1998' });
  assert.equal(cw.house.runningNoise, false);
});

test('running noise (f): a commando who freezes outside 2.25 m is not challenged — the guard investigates, looks round and goes home', () => {
  const w = world(T.ROAD, { enemies: [{ id: 'p', soldierType: 'soldier', x: 30, z: 30, heading: 0 }] });
  const g = w.enemies[0];
  const c = addCommando(w, 'greenberet', 22, 18, Math.PI / 2);
  let froze = null;
  // he stops dead at the first step the guard hears; that BEL tick's stride is already behind him
  w.events.on('enemy:heard-steps', () => { if (!froze) { c.stop(); froze = w.time; } });
  c.moveTo(22, 45, { run: true });
  run(w, 3, () => froze != null);
  assert.ok(froze != null, 'heard');
  assert.equal(g.brainState, 'INVESTIGATE');
  assert.ok(facing(g, c.x, c.z, 0.6), 'he faces the sound');
  // a still man more than 2.25 m off scores no nervousness
  const d = Math.hypot(c.x - g.x, c.z - g.z);
  assert.ok(d > CONFIG.ai.nervousness.closeRange, `${d.toFixed(2)} m`);
  // walk him away (a crawl) so the investigator does not walk into him
  c.setStance('crawl');
  run(w, 0.7);
  c.moveTo(10, 50);
  run(w, 20, () => g.brainState === 'RETURN');
  assert.equal(first(w, 'enemy:challenge'), null, 'never challenged');
  assert.equal(g.brainState, 'RETURN', 'looked round, then home');
  assert.ok(first(w, 'bark', (p) => p.unit === g && p.line === 'ger_suspicious'));
  assert.equal(w.alarm.active, false);
});

test('running noise (g): steps every 0.5 s — alert boost once suspicion reaches 3, a SEARCH at 6; never alert 2, never an alarm or a zone onHeard', () => {
  const w = world(T.GROUND, { enemies: [{ id: 'p', soldierType: 'soldier', x: 30, z: 30, heading: 0 }], zones: [ZONE] });
  const g = w.enemies[0];
  const src = addCommando(w, 'greenberet', 2, 2); // the source (far, unseen)
  let maxAlert = 0, susp = 0, boostAt = null;
  const pts = [[24, 34], [24, 35], [23, 36], [23, 37], [22, 38], [22, 39], [22, 40], [22, 41]];
  pts.forEach(([x, z], k) => {
    const boosted = g.brain.alertT > 0;
    w.emitNoise(x, z, 10, 'footsteps', src, 1);
    susp = Math.max(0, susp - (k ? 0.5 * RN.susp.decay : 0)) + 1; // +1 a step, −decay/s
    near(g.brain.stepSusp, susp, 1e-9, `suspicion after step ${k + 1}`);
    assert.equal(g.alertLevel, 1, 'INVESTIGATE is alert 1');
    if (!boosted && g.brain.alertT > 0) boostAt = susp;
    assert.equal(g.brain.alertT > 0, susp >= RN.susp.alertAt || boosted, `alert boost at step ${k + 1}`);
    run(w, 0.5, () => { maxAlert = Math.max(maxAlert, g.alertLevel); return false; });
  });
  assert.ok(boostAt >= RN.susp.alertAt && boostAt < RN.susp.alertAt + 1);
  assert.ok(susp >= RN.susp.searchAt, `suspicion ${susp}`);
  assert.equal(g.brainState, 'INVESTIGATE');
  assert.equal(g.brain.goal.search, true, 'marked for a search');
  run(w, 15, () => { maxAlert = Math.max(maxAlert, g.alertLevel); return g.brainState !== 'INVESTIGATE'; });
  assert.equal(g.brainState, 'SEARCH', 'searches around the last step');
  run(w, 25, () => { maxAlert = Math.max(maxAlert, g.alertLevel); return g.brainState !== 'SEARCH'; });
  assert.equal(maxAlert, 1, 'alert level never 2');
  assert.equal(!!g.brain.combatReady, false);
  assert.equal(w.alarm.active, false);
  assert.equal(w.alarm.zonesFired.length, 0, 'level 1: no onHeard');
  // two steps then quiet: suspicion decays, no search
  const w2 = world(T.GROUND, { enemies: [{ id: 'q', soldierType: 'soldier', x: 30, z: 30, heading: 0 }] });
  const g2 = w2.enemies[0];
  w2.emitNoise(24, 34, 7.5, 'footsteps', src, 1);
  run(w2, 0.5);
  w2.emitNoise(24, 35, 7.5, 'footsteps', src, 1);
  run(w2, 15, () => g2.brainState !== 'INVESTIGATE');
  assert.equal(g2.brainState, 'RETURN');
});

test('running noise (h): the engineer and the general ignore steps — no detonator run, no DETONATE, no flight', () => {
  for (const soldierType of ['engineer', 'general']) {
    const w = makeWorld({ size: [60, 60], enemies: [{ id: 'x', soldierType, x: 30, z: 30, heading: 0, detonator: { x: 50, z: 50 } }] });
    const e = w.enemies[0];
    const devices = [];
    w.events.on('device', (p) => devices.push(p));
    let alarms = 0;
    const real = e.brain._scriptAlarm.bind(e.brain);
    e.brain._scriptAlarm = (x, z) => { alarms++; return real(x, z); };
    const c = addCommando(w, 'greenberet', 26, 15);
    c.moveTo(26, 45, { run: true });
    let heard = 0;
    w.events.on('noise', (n) => { if (n.kind === 'footsteps' && hears(e, n)) heard++; });
    run(w, 4);
    assert.ok(heard >= 1, `${soldierType} was in earshot`);
    assert.notEqual(e.brainState, 'ALARM_RUN', soldierType);
    assert.equal(first(w, 'enemy:state', (p) => p.enemy === e && p.to === 'ALARM_RUN'), null, soldierType);
    assert.equal(devices.length, 0, soldierType);
    assert.equal(alarms, 0, `${soldierType}: no scripted alarm`);
    // a real alarm noise still triggers his script (unchanged)
    w.emitNoise(e.x + 3, e.z, 18, 'pistol', null);
    assert.equal(alarms, 1, `${soldierType}: a shot still does`);
  }
});

test('running noise (i): a post-holder faces the steps for the noise hold; an MG gunner only within his traverse; a route walker investigates', () => {
  const w = world(T.ROAD);
  const g = w.enemies[0];
  w.emitNoise(24, 34, 10, 'footsteps', null, 1);
  assert.ok(facing(g, 24, 34, 1e-6), 'faces the step');
  near(g.brain.noiseTurnT, CONFIG.ai.noiseTurnHold, 1e-9);
  assert.equal(first(w, 'enemy:state', (p) => p.enemy === g), null, 'stays at his post');
  const mg = addEnemy(w, { id: 'mg', soldierType: 'mg', x: 40, z: 10, heading: 0, post: { heading: 0, sweep: 0, giro: 90 } });
  w.emitNoise(34, 10, 10, 'footsteps', null, 1); // straight behind him
  near(Math.abs(angleDiff(mg.heading, 0)), Math.PI / 4, 1e-6, 'turned to the edge of his 90° traverse');
  const turns = [];
  const w2 = world(T.ROAD, { enemies: [{ id: 'r', soldierType: 'soldier', x: 30, z: 30, heading: 0, route: [{ x: 30, z: 30 }, { x: 50, z: 30 }] }] });
  w2.events.on('enemy:noise-turn', (p) => turns.push(p));
  const r = w2.enemies[0];
  run(w2, 0.5);
  w2.emitNoise(r.x - 6, r.z + 2, 10, 'footsteps', null, 1);
  assert.equal(r.brainState, 'INVESTIGATE');
  assert.equal(r.brain.goal.steps, true);
  assert.ok(facing(r, r.x - 6 + 0.0, r.z + 2, 0.05), 'faces the sound at once');
  assert.equal(turns.length, 1);
  assert.equal(turns[0].kind, 'footsteps');
  // a newer step retargets him (throttled re-path)
  run(w2, 0.8);
  const nx = r.x - 5, nz = r.z + 5;
  w2.emitNoise(nx, nz, 10, 'footsteps', null, 1);
  assert.equal(r.brain.goal.x, nx);
  assert.equal(r.brain.goal.z, nz);
  assert.ok(facing(r, nx, nz, 1e-6));
});

test('running noise (i2): a patrol — the leader investigates the steps and the squad follows him', () => {
  const route = { points: [{ x: 30, z: 30 }, { x: 50, z: 30 }] };
  const w = world(T.ROAD, { enemies: [
    { id: 'sgt', soldierType: 'sergeant', x: 30, z: 30, heading: 0, squad: { id: 'p1', leader: 'sgt' }, route },
    { id: 'pv', soldierType: 'soldier', x: 28.8, z: 30, heading: 0, squad: { id: 'p1', leader: 'sgt' }, route },
  ] });
  const [sgt, pv] = w.enemies;
  run(w, 0.3);
  w.emitNoise(pv.x - 5, pv.z + 3, 10, 'footsteps', null, 1);
  assert.equal(sgt.brainState, 'INVESTIGATE', 'the leader investigates');
  assert.equal(sgt.brain.goal.steps, true);
  assert.notEqual(pv.brainState, 'INVESTIGATE', 'the member defers to him');
  const d0 = Math.hypot(pv.x - sgt.x, pv.z - sgt.z);
  run(w, 3);
  assert.ok(Math.hypot(pv.x - sgt.x, pv.z - sgt.z) < d0 + 2.5, 'the squad keeps with him');
});

test('running noise (j): step surfaces and radii — bridge deck, raised floor, road, shallows, ground, grass, snow', () => {
  const w = makeWorld({ size: [60, 60] });
  const g = w.grid;
  g.fillRect(0, 0, 10, 60, 'terrain', T.ROAD);
  g.fillRect(10, 0, 10, 60, 'terrain', T.SHALLOW);
  g.fillRect(20, 0, 10, 60, 'terrain', T.GRASS);
  g.fillRect(30, 0, 10, 60, 'terrain', T.SNOW);
  g.fillRect(40, 0, 5, 60, 'terrain', T.SAND);
  g.fillRect(45, 0, 5, 60, 'terrain', T.MUD);
  g.fillRect(50, 0, 10, 60, 'terrain', T.WATER);
  g.fillRect(0, 50, 60, 4, 'bridge', 1);
  for (let j = 40; j < 44; j++) for (let i = 0; i < 8; i++) g.elev[g.idx(i, j)] = 2.5; // a roof at x 0–4, z 20–22
  const cases = [[5, 5, 'road'], [15, 5, 'shallow'], [25, 5, 'grass'], [35, 5, 'snow'], [42, 5, 'sand'], [47, 5, 'mud'],
    [55, 5, 'water'], [15, 52, 'deck'], [2, 21, 'floor']];
  for (const [x, z, s] of cases) assert.equal(stepSurface(w, x, z), s, `${x},${z}`);
  const w2 = makeWorld({ size: [60, 60] });
  assert.equal(stepSurface(w2, 30, 30), 'ground');
  assert.equal(stepSurface(w2, -5, 30), 'ground', 'off the map');
  const want = { deck: 12, floor: 12, road: 10, shallow: 9, ground: 7.5, snow: 7.5, grass: 6, sand: 6, mud: 6 };
  for (const [s, r] of Object.entries(want)) assert.equal(runNoiseRadius(w, s), r, s);
  for (const r of Object.values(RN.radius)) assert.ok(r < CONFIG.stealth.vision.soldier.near, 'inside the near band');
  w.rules = { ...w.rules, enemyHearingMul: 1.5 };
  assert.equal(runNoiseRadius(w, 'road'), 15, '× rules.enemyHearingMul');
  // a run over the roof is a hard floor and loud
  assert.equal(CONFIG.stealth.noise.footsteps.level, 1);
});

test('running noise (k): ~one step per 2.7 m (the first after 1.35 m), deterministic; the suspicion survives save/load', () => {
  const once = () => {
    const w = world(T.GROUND, { enemies: [] });
    const c = addCommando(w, 'greenberet', 10, 10, Math.PI / 2);
    const heard = steps(w);
    c.moveTo(10, 37, { run: true }); // 27 m
    run(w, 8);
    return heard.map((n) => [+n.x.toFixed(6), +n.z.toFixed(6), n.t]);
  };
  const a = once(), b = once();
  assert.equal(a.length, 10, `${a.length} steps over 27 m`);
  near(a[0][1] - 10, RN.step * RN.startFrac, 0.1, 'first step after 1.35 m');
  near(a[1][1] - a[0][1], RN.step, 0.1);
  assert.deepEqual(a, b, 'deterministic');
  // a stop resets the counter: a 1.4 m dash is still heard
  const w = world(T.GROUND, { enemies: [] });
  const c = addCommando(w, 'greenberet', 10, 10, Math.PI / 2);
  const heard = steps(w);
  c.moveTo(10, 11.4, { run: true });
  run(w, 1);
  assert.equal(heard.length, 1, 'short dash heard');
  c.moveTo(10, 12.6, { run: true });
  run(w, 1);
  assert.equal(heard.length, 1, 'the counter restarted at 1.35 m: 1.2 m is not enough');
  // save / load mid-INVESTIGATE
  const ws = world(T.GROUND, { enemies: [{ id: 'p', soldierType: 'soldier', x: 30, z: 30, heading: 0 }] });
  const gp = ws.enemies[0];
  ws.emitNoise(24, 34, 7.5, 'footsteps', null, 1);
  run(ws, 0.3);
  ws.emitNoise(24, 35, 7.5, 'footsteps', null, 1);
  const d = gp.brain.serialize();
  assert.equal(d.state, 'INVESTIGATE');
  assert.equal(d.goal.steps, true);
  const wl = world(T.GROUND, { enemies: [{ id: 'p', soldierType: 'soldier', x: 30, z: 30, heading: 0 }] });
  wl.time = ws.time;
  const gl = wl.enemies[0];
  gl.brain.deserialize(JSON.parse(JSON.stringify(d)));
  near(gl.brain.stepSusp, gp.brain.stepSusp, 1e-12);
  assert.equal(gl.brain.stepT, gp.brain.stepT);
  assert.equal(gl.brain._stepBarkT, gp.brain._stepBarkT);
  near(gl.brain._stepSuspNow(), gp.brain._stepSuspNow(), 1e-12);
});

test('running noise (l): a dog hears steps as a man does (dogMul 1: he skips "Halt!"); a tank crewman inside hears none; an emplacement gunner does', () => {
  const w = makeWorld({ size: [60, 60] });
  const dog = addEnemy(w, { id: 'd', soldierType: 'dog', x: 30, z: 30, heading: 0 });
  const man = addEnemy(w, { id: 'm', soldierType: 'soldier', x: 30, z: 30, heading: 0 });
  assert.equal(RN.dogMul, 1);
  const n = { x: 30 + 7.5 * 0.95, z: 30, radius: 7.5, kind: 'footsteps', level: 1, source: null };
  assert.equal(hears(dog, n), true, 'dog at 0.95 R');
  assert.equal(hears(man, n), true, 'man at 0.95 R');
  assert.equal(hears(dog, { ...n, x: 30 + 7.5 * 1.05 }), false, 'dog past R');
  assert.equal(hears(dog, { ...n, x: 30 + 7.5 * 1.05, kind: 'pistol' }), false, 'other kinds unchanged');
  const near2 = { ...n, x: 32 };
  man.state = 'inVehicle';
  man.vehicle = { vehicleKind: 'land' };
  assert.equal(hears(man, near2), false, 'inside a tank');
  assert.equal(hears(man, { ...near2, kind: 'pistol' }), true, 'still hears shots');
  man.vehicle = { vehicleKind: 'emplacement' };
  assert.equal(hears(man, near2), true, 'manning a gun');
});

test('running noise (m): house rule — SHADOW SIX on, CLASSIC 1998 off, a player override is CUSTOM, a mission may force it; options toggle', () => {
  assert.ok(houseFlags().includes('runningNoise'));
  assert.equal(resolveHouseRules({ preset: 'shadowSix' }).runningNoise, true);
  assert.equal(resolveHouseRules({ preset: 'classic1998' }).runningNoise, false);
  assert.equal(resolveHouseRules().runningNoise, true, 'default');
  const o = resolveHouseRules({ options: { rulesPreset: 'shadowSix', runningNoise: false } });
  assert.equal(o.runningNoise, false);
  assert.equal(o.preset, 'custom');
  const f = resolveHouseRules({ mission: { houseRules: { runningNoise: false } } });
  assert.equal(f.runningNoise, false, 'forced off');
  assert.deepEqual(forcedRuleLines({ houseRules: { runningNoise: false } }), ['The guards cannot hear a man running.']);
  assert.deepEqual(forcedRuleLines({ houseRules: { runningNoise: true } }), ['The guards hear a man running near them.']);
  assert.equal(restoreHouseRules({ runningNoise: false }, resolveHouseRules()).runningNoise, false, 'a save restores it');
  assert.ok(HOUSE_KEYS.includes('runningNoise'));
  assert.equal(OPTION_DEFAULTS.runningNoise, true);
  assert.equal(OPTION_DEFAULTS.noiseRings, true);
  assert.equal(matchingPreset({ ...CONFIG.houseRules.presets.shadowSix }), 'shadowSix');
  assert.equal(matchingPreset({ ...CONFIG.houseRules.presets.shadowSix, runningNoise: false }), 'custom');
  assert.equal(matchingPreset({ ...CONFIG.houseRules.presets.classic1998 }), 'classic1998');
  const row = OPTION_ROWS.find((r) => r[0] === 'runningNoise');
  assert.deepEqual(row, ['runningNoise', 'RUNNING IS HEARD', 'bool']);
  assert.ok(/Walking and crawling stay silent/.test(OPTION_HELP.runningNoise));
  assert.ok(OPTION_ROWS.find((r) => r[0] === 'noiseRings') && OPTION_HELP.noiseRings);
  assert.ok(EVENT_NAMES.includes('enemy:heard-steps'));
});

test('running noise: noise rings grow to the hearing radius over 0.6 s, fade by 0.9 s; only for player steps; off by option', () => {
  const s0 = noiseRingShape(0, 10), s1 = noiseRingShape(RING_GROW, 10), s2 = noiseRingShape(RING_LIFE, 10);
  assert.ok(s0.r < 0.5 && s0.alpha > 0.15);
  near(s1.r, 10, 1e-9);
  assert.ok(s1.alpha > 0 && s1.alpha < s0.alpha);
  assert.equal(s2.alpha, 0);
  const w = world(T.ROAD, { enemies: [] });
  w.game = { options: { noiseRings: true } };
  const group = new THREE.Group();
  const rings = new NoiseRings(group);
  rings.attach(w);
  const c = addCommando(w, 'greenberet', 10, 10, Math.PI / 2);
  c.moveTo(10, 20, { run: true });
  run(w, 0.3);
  assert.equal(rings.active, 1, 'a ring at the first step');
  rings.update(0.3);
  const m = rings.rings[0].mesh;
  assert.ok(m.visible && m.material.opacity > 0);
  rings.update(1);
  assert.equal(rings.active, 0, 'gone after its life');
  w.emitNoise(10, 10, 10, 'footsteps', addEnemy(w, { id: 'e', soldierType: 'soldier', x: 40, z: 40 }), 1);
  assert.equal(rings.active, 0, 'not for enemy steps');
  w.game.options.noiseRings = false;
  run(w, 2);
  assert.equal(rings.active, 0, 'option off');
  rings.dispose();
  assert.equal(group.children.length, 0);
});

test('running noise (n): a raised cliff plateau or road ramp reads its terrain (snow 7.5 m), a roof or wall walk is a floor (12 m)', () => {
  const w = makeWorld({ size: [60, 60] });
  const g = w.grid;
  g.fillRect(0, 0, 60, 60, 'terrain', T.SNOW);
  g.fillRect(40, 0, 20, 60, 'terrain', T.ROAD);
  const walk = (points, y, width = 4) => ({ walkways: [{ points, width, y }] });
  applyElevation(g, [
    { type: 'cliff', owner: 1, def: walk([[2, 10], [20, 10]], 16), footprints: [] }, // the M5 summit plateau method
    { type: 'road', owner: 2, def: walk([[42, 10], [58, 10]], 3), footprints: [] }, // a ramp
    { type: 'hut', owner: 3, def: walk([[2, 30], [20, 30]], 3), footprints: [] }, // a roof terrace
    { type: 'wall', owner: 4, def: walk([[2, 40], [20, 40]], 2.5, 1.2), footprints: [] }, // a wall walk
  ]);
  assert.ok(g.elevAt(10, 10) > 15 && g.elevAt(10, 30) > 2, 'raised');
  assert.equal(stepSurface(w, 10, 10), 'snow', 'raised snow is snow');
  assert.equal(runNoiseRadius(w, stepSurface(w, 10, 10)), 7.5);
  assert.equal(stepSurface(w, 50, 10), 'road', 'a raised road ramp is road');
  assert.equal(stepSurface(w, 10, 30), 'floor', 'a roof terrace is a floor');
  assert.equal(stepSurface(w, 10, 40), 'floor', 'a wall walk is a floor');
  // a built floor raised later over the plateau (a hut on the summit) is a floor again
  applyElevation(g, [{ type: 'hut', owner: 5, def: walk([[8, 10], [12, 10]], 19, 2), footprints: [] }]);
  assert.equal(stepSurface(w, 10, 10), 'floor');
  assert.equal(stepSurface(w, 4, 10), 'snow');
});

test('running noise (o): real maps — M5 summit snow, M8 raised ground and M11 raised sand are not floors; M8 start-yard dash is out of the guards\' range', () => {
  const share = (id) => {
    const { world: w, grid: g, def } = loadGrid(getMission(id));
    const c = { floor: 0, snow: 0, sand: 0, ground: 0 };
    for (let k = 0; k < g.size; k++) {
      const i = k % g.cols, j = (k - i) / g.cols;
      if (!(g.elev[k] > 0.05) || !g.isWalkable(i, j)) continue;
      const s = stepSurface(w, (i + 0.5) * g.cell, (j + 0.5) * g.cell);
      c[s] = (c[s] || 0) + 1;
    }
    return { c, w, def };
  };
  const m5 = share('m05');
  assert.ok(m5.c.snow > 5000 && m5.c.floor < 100, `M5 raised: ${JSON.stringify(m5.c)}`);
  const m8 = share('m08');
  assert.ok(m8.c.ground > 5000 && m8.c.floor < 0.15 * m8.c.ground, `M8 raised: ${JSON.stringify(m8.c)}`);
  for (const s of m8.def.commandos) assert.equal(stepSurface(m8.w, s.x, s.z), 'ground', `M8 start ${s.role} on raised ground`);
  const m11 = share('m11');
  assert.ok(m11.c.sand > 5000 && m11.c.floor < 0.1 * m11.c.sand, `M11 raised: ${JSON.stringify(m11.c)}`);
});

test('running noise (p): running 5 m behind the tail of a 4-man patrol is heard even when the leader is out of the step radius', () => {
  const route = { points: [{ x: 34, z: 30 }, { x: 58, z: 30 }] };
  const sq = { id: 'p1', leader: 'sgt' };
  const w = world(T.GRASS, { enemies: [
    { id: 'sgt', soldierType: 'sergeant', x: 34, z: 30, heading: 0, squad: sq, route },
    ...[1, 2, 3].map((k) => ({ id: `pv${k}`, soldierType: 'soldier', x: 34 - 1.2 * k, z: 30, heading: 0, squad: sq, route })),
  ] });
  const sgt = w.enemies[0], tail = w.enemies[3];
  const heard = steps(w);
  const c = addCommando(w, 'greenberet', tail.x - 5, 22, Math.PI / 2);
  c.moveTo(tail.x - 5, 38, { run: true });
  let tailHeard = false;
  run(w, 4, () => {
    if (heard.some((n) => Math.hypot(n.x - tail.x, n.z - tail.z) <= n.radius && Math.hypot(n.x - sgt.x, n.z - sgt.z) > n.radius)) tailHeard = true;
    return sgt.brainState === 'INVESTIGATE';
  });
  assert.ok(tailHeard || sgt.brainState === 'INVESTIGATE', 'a step only the tail man could hear');
  assert.equal(sgt.brainState, 'INVESTIGATE', 'the leader turns the squad to it');
  assert.equal(sgt.brain.goal.steps, true);
  // other noises keep the leader's own range check
  const w2 = world(T.GRASS, { enemies: [
    { id: 'sgt', soldierType: 'sergeant', x: 34, z: 30, heading: 0, squad: sq, route },
    { id: 'pv', soldierType: 'soldier', x: 30, z: 30, heading: 0, squad: sq, route },
  ] });
  run(w2, 0.2);
  w2.emitNoise(25, 30, 6, 'bark', null, 1);
  assert.notEqual(w2.enemies[0].brainState, 'INVESTIGATE');
});

test('running noise (q): steps are heard over their 3D distance — a guard on a roof 8 m up', () => {
  const w = makeWorld({ size: [60, 60] });
  const up = addEnemy(w, { id: 'r', soldierType: 'soldier', x: 30, z: 30, heading: 0, y: 8 });
  const n = { x: 37, z: 30, y: 0, radius: 10, kind: 'footsteps', level: 1, source: null };
  assert.equal(hears(up, n), false, '7 m across, 8 m down: 10.6 m');
  assert.equal(hears(up, { ...n, y: 8 }), true, 'on his roof');
  assert.equal(hears(up, { ...n, x: 35 }), true, '5 m across, 8 m down: 9.4 m');
  assert.equal(hears(up, { ...n, kind: 'shot', level: 2 }), true, 'other noises unchanged (flat)');
  const low = addEnemy(w, { id: 'l', soldierType: 'soldier', x: 30, z: 50, heading: 0 });
  for (let j = 98; j < 102; j++) for (let i = 58; i < 62; i++) w.grid.elev[w.grid.idx(i, j)] = 8; // standing on a raised cell, y unset
  assert.equal(hears(low, { ...n, z: 50 }), false, 'his height comes from the grid');
});

test('running noise (r): CLASSIC 1998 options saved before runningNoise existed stay CLASSIC 1998 (silent movement)', () => {
  const store = (o) => ({ getItem: (k) => (k === OPTIONS_KEY ? JSON.stringify(o) : null) });
  const C = CONFIG.houseRules.presets.classic1998;
  const { runningNoise: _, ...oldClassic } = C;
  const o = loadOptions(store({ rulesPreset: 'classic1998', ...oldClassic }));
  assert.equal(o.runningNoise, false);
  const h = resolveHouseRules({ options: o });
  assert.equal(h.preset, 'classic1998');
  assert.equal(h.runningNoise, false);
  const s6 = loadOptions(store({ rulesPreset: 'shadowSix', dragBodies: true }));
  assert.equal(s6.runningNoise, true);
  assert.equal(resolveHouseRules({ options: s6 }).preset, 'shadowSix');
  assert.equal(loadOptions(store({ rulesPreset: 'classic1998', ...oldClassic, runningNoise: true })).runningNoise, true, 'a saved choice wins');
  assert.equal(loadOptions(store({})).runningNoise, true, 'new player: SHADOW SIX');
});

test('running noise (s): a save mid-run keeps the step counter — the loaded run makes the same steps', () => {
  const start = () => {
    const w = world(T.GROUND, { enemies: [] });
    const c = addCommando(w, 'greenberet', 10, 10, Math.PI / 2);
    return { w, c, heard: steps(w) };
  };
  const a = start();
  a.c.moveTo(10, 40, { run: true });
  run(a.w, 1.7);
  assert.ok(a.c._runNoiseD > 0.2, `mid-step (${a.c._runNoiseD})`);
  const d = JSON.parse(JSON.stringify(a.c.serialize()));
  assert.equal(d.runNoiseD, a.c._runNoiseD);
  const b = start();
  b.w.time = a.w.time;
  b.c.deserialize(d);
  assert.equal(b.c._runNoiseD, a.c._runNoiseD);
  assert.equal(b.c._footstepT, a.c._footstepT);
  const n0 = a.heard.length;
  run(a.w, 3);
  run(b.w, 3);
  const fmt = (l) => l.map((n) => [+n.x.toFixed(6), +n.z.toFixed(6)]);
  assert.ok(a.heard.length - n0 >= 3);
  assert.deepEqual(fmt(b.heard), fmt(a.heard.slice(n0)));
});

test('running noise (t): one step counts once — a 4-man patrol that all hear it raises the leader\'s suspicion by 1, not 4', () => {
  const sq = { id: 'S', leader: 'p0', columns: 1 };
  const enemies = [0, 1, 2, 3].map((k) => ({ id: `p${k}`, soldierType: k ? 'trooper' : 'sergeant', x: 30 - 1.5 * k, z: 30, heading: 0,
    squad: sq, route: [[30 - 1.5 * k, 30], [50, 30]] }));
  const w = world(T.GROUND, { enemies });
  const lead = w.enemies[0];
  const heardEv = [];
  w.events.on('enemy:heard-steps', (p) => heardEv.push({ e: p.enemy, susp: p.susp, t: w.time }));
  const nz = [];
  w.events.on('noise', (n) => { if (n.kind === 'footsteps') nz.push(n); });
  run(w, 0.2);
  // one step right behind the file, inside every man's radius
  w.emitNoise(24, 31, RN.radius.ground, 'footsteps', null, 1, { surface: 'ground', y: 0 });
  assert.ok(w.enemies.every((e) => hears(e, nz[0])), 'all four hear it');
  assert.equal(heardEv.length, 1, `heard-steps once (${heardEv.length})`);
  assert.equal(heardEv[0].e, lead, 'by the leader');
  near(lead.brain.stepSusp, 1, 1e-9, 'suspicion 1 after one step');
  assert.ok(!(lead.alertLevel >= 1) || lead.brain.alertT <= 0 || lead.brain.stepSusp < RN.susp.alertAt, 'not alert on the first step');
  // the next step counts again
  w.emitNoise(24, 32, RN.radius.ground, 'footsteps', null, 1, { surface: 'ground', y: 0 });
  assert.equal(heardEv.length, 2);
  near(lead.brain.stepSusp, 2, 0.05, 'suspicion 2 after two steps');
});

test('running noise (u): snow crunches — running 6–7 m behind a sentry on snow is heard; sand stays quieter', () => {
  for (const back of [6, 7]) {
    const p = passBehind(T.SNOW, back);
    run(p.w, 7, () => Math.abs(p.g.heading) > 0.5);
    assert.ok(p.heard.length >= 1 && p.heard.every((n) => n.surface === 'snow' && n.radius === 7.5), 'snow steps 7.5 m');
    assert.ok(Math.abs(p.g.heading) > 0.5, `turned to the steps on snow at ${back} m`);
  }
  assert.ok(RN.radius.sand < RN.radius.snow && RN.radius.mud < RN.radius.snow);
});
