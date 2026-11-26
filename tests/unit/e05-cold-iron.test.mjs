/**
 * LIGHTS OUT e05 "Cold Iron" (docs/expansion/e05.md §15 acceptance), on the real mission (headless build, the mission
 * script installed by the set-piece director's first tick):
 *  - the radio casemate's iron door (`door: 'enemy'`): a commando's use is refused, a puppet opens it;
 *  - Grethe is out of play (and ignored) until a commando is within 3 m of her chair, then playable; o2 done;
 *  - her small talk holds a soldier (gr1) and is refused on a Gestapo man (negative control);
 *  - the adjutant's tunic (hanger) makes the Spy an officer: it passes a sentry (oq1) and fails before the Gestapo (g1);
 *  - the bridge rises on the puppet keeper's use of the switch; on the fort's alarm the camp's squads stop at the outer
 *    bank while it is up (negative control: with the bridge down they cross into the yard);
 *  - the keeper lowers the bridge again after `relowerAfter` s unless he is bound;
 *  - the burn script fails the mission on RFORT with the index on the desk and the Kriminalrat free, and does nothing
 *    with him bound; the index taken by a commando completes o1.
 */
import { test, assert } from './lib.mjs';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { recognises } from '../../src/ai/bcd-ranks.js';
import { canSee } from '../../src/ai/perception.js';
import { getMission } from '../../src/missions/index.js';
import { restoreWorld } from '../../src/save.js';
import { Entity } from '../../src/entities/entity.js';
import { knockOut, cuff } from '../../src/ai/bcd-enemy.js';

/** The e05 world, its script installed (first tick), an event log and a few helpers. */
function e05(difficulty = 'hard', { keep = null } = {}) {
  const s = headlessMission('e05', { difficulty });
  // (a mechanism test isolates its men: everybody not in `keep` leaves the map before the first tick)
  if (keep) for (const e of [...s.world.enemies]) if (!keep.includes(e.tag ?? e.id)) s.world.remove(e);
  s.world.flushRemovals();
  const sim = wrap(s);
  sim.run(0.1);
  return sim;
}

/**
 * A quick load in the game's order (save.js restore): the mission rebuilt from its definition, the snapshot restored
 * into it, then the set-piece director's first tick hands the saved script state back and re-runs the script.
 */
function quickLoad(sim, difficulty = 'hard') {
  const snap = JSON.parse(JSON.stringify({ ...sim.w.serialize(), nextId: Entity.nextId }));
  const alarm = sim.w.alarm.serialize?.();
  const s = headlessMission('e05', { difficulty });
  restoreWorld(s.world, snap);
  if (alarm) s.world.alarm.deserialize?.(alarm);
  const b = wrap(s);
  b.run(0.05);
  return b;
}

function wrap(s) {
  const w = s.world, log = [];
  const emit = w.events.emit.bind(w.events);
  w.events.emit = (name, p) => { log.push({ name, p, t: w.time }); return emit(name, p); };
  const sim = {
    s, w, log,
    get: (id) => w.enemies.find((e) => (e.tag ?? e.id) === id) || w.interactables.find((i) => (i.tag ?? i.id) === id) || null,
    cmd: (role) => w.commandos.find((c) => c.role === role),
    run(sec, until = null) { const n = Math.round(sec / s.dt); for (let k = 0; k < n; k++) { s.step(); if (until && until()) return true; } return false; },
    put(u, x, z, h = u.heading) { u.stop?.(); u.setPosition(x, z, h); u.heading = h; },
    count: (name, f = () => true) => log.filter((e) => e.name === name && f(e.p)).length,
    obj: (id) => w.objectives.find((o) => o.id === id),
  };
  return sim;
}

/** Knock `e` out and cuff him with the Green Beret standing behind him; optionally take him on strings. */
function cuffBehind(sim, e, puppet = false) {
  const gb = sim.cmd('greenberet');
  sim.put(gb, e.x - Math.cos(e.heading) * 1.0, e.z - Math.sin(e.heading) * 1.0, e.heading);
  assert.equal(gb.useAbility('knockoutFist', e), true, 'fist order');
  sim.run(5, () => !!e.ko && !gb.currentAction && !gb.pendingAbility);
  assert.ok(e.ko, `${e.tag} knocked out`);
  assert.equal(gb.useAbility('handcuff', e), true, 'cuffs order');
  sim.run(6, () => e.ko === 'bound' && !gb.currentAction && !gb.pendingAbility);
  assert.equal(e.ko, 'bound', `${e.tag} cuffed`);
  if (puppet) {
    assert.equal(gb.useAbility('puppet', e), true, 'puppet order');
    sim.run(0.2);
    assert.ok(e.puppetOf === gb, `${e.tag} on the strings`);
  }
  return gb;
}

test('e05 registers in LIGHTS OUT slot 5 and validates on Easy (30 men) and Hard (37)', () => {
  const def = getMission('e05');
  assert.equal(def.campaign, 'BCD');
  assert.equal(def.number, 5);
  assert.equal(headlessMission('e05', { difficulty: 'hard' }).world.enemies.length, 37, 'Hard: 37 men');
  assert.equal(headlessMission('e05', { difficulty: 'easy' }).world.enemies.length, 30, 'Easy: 30 men');
});

test('e05 Hard tightening (design §12): the black coats look into the yard 15 s at each corner, the puppet halts 6 s, r_w glances in at his south end', () => {
  const route = (diff, id) => headlessMission('e05', { difficulty: diff }).world.enemies.find((e) => (e.tag ?? e.id) === id).route;
  const waits = (r) => r.filter((p) => p.wait > 0).map((p) => p.wait);
  assert.deepEqual(waits(route('hard', 'g4')), [15, 15, 15, 15], 'g4: 15 s at each corner');
  assert.deepEqual(waits(route('hard', 'g5')), [15, 15, 15, 15], 'g5: 15 s at each corner');
  assert.deepEqual(waits(route('hard', 'y2')), [6, 6], 'y2: 6 s at each end of his beat');
  const rw = route('hard', 'r_w');
  // (`look` is the code's heading, 0 = E, 90 = S; the yard lies east of him: x 36–76 against his 31.5)
  const south = rw[rw.length - 1], fx = Math.cos((south.look * Math.PI) / 180), fz = Math.sin((south.look * Math.PI) / 180);
  assert.ok(fx > 0.9, `r_w's south-end look faces into the yard, east (facing ${fx.toFixed(2)}, ${fz.toFixed(2)})`);
  assert.ok(fz > 0 && fz < 0.45, `east-south-east, the design's compass 100° (facing z ${fz.toFixed(2)})`);
  assert.equal(rw[0].look, 180, 'and out over the moat at his north end');
  // Easy keeps the base beats (× 2.5 pauses)
  assert.deepEqual(waits(route('easy', 'g4')), [25, 25, 25, 25], 'Easy g4: 10 s × 2.5');
  assert.deepEqual(waits(route('easy', 'y2')), [25, 30], 'Easy y2: 10 / 12 s × 2.5');
});

test('e05 Hard: r_w at his south halt really faces into the yard (his cone takes in its south-west quarter)', () => {
  const sim = e05('hard', { keep: ['r_w'] });
  const rw = sim.get('r_w'), end = rw.route[rw.route.length - 1];
  // north end first (8 s), 34 m along the walk; then 3 s into his halt to finish turning
  const there = () => Math.hypot(rw.x - end.x, rw.z - end.z) < 0.3;
  assert.ok(sim.run(70, there), `he reaches his south end (at ${rw.x.toFixed(1)}, ${rw.z.toFixed(1)})`);
  sim.run(3);
  assert.ok(Math.hypot(rw.x - end.x, rw.z - end.z) < 0.3, 'still halted there');
  const h = rw.heading + (rw.headOffset || 0), fx = Math.cos(h), fz = Math.sin(h);
  assert.ok(fx > 0.9, `facing east into the yard (${fx.toFixed(2)}, ${fz.toFixed(2)})`);
  // the yard's south-west quarter (the office, the guardroom, the parade's south side) inside his ±35° cone
  const off = (x, z) => { let d = Math.atan2(z - rw.z, x - rw.x) - h; d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.abs(d) * 180 / Math.PI; };
  for (const [x, z] of [[45, 84], [55, 82], [60, 88]]) assert.ok(off(x, z) < 35, `(${x}, ${z}) in his cone (${off(x, z).toFixed(0)}° off his heading)`);
  assert.ok(off(31.5, 120) > 35, 'not down the rampart to the SW bastion and the heath');
});

test('e05 iron door: a commando is refused ("Locked from their side."), the puppet opens it', () => {
  const sim = e05('hard', { keep: ['y2'] });
  const door = sim.get('iron_door'), y2 = sim.get('y2');
  assert.ok(door && door.interactKind === 'door' && !door.open, 'the iron door is shut');
  const gb = cuffBehind(sim, y2, false);
  sim.put(gb, 69, 82.4, -Math.PI / 2);
  assert.equal(door.canUse(gb), 'Locked from their side.');
  assert.equal(gb.useAbility('use', door), false, 'the use order is refused');
  sim.put(y2, 67.5, 83.8);
  assert.equal(gb.useAbility('puppet', y2), true);
  sim.run(0.2);
  assert.equal(gb.useAbility('puppet', door), true, 'the puppet is sent to the door');
  sim.run(8, () => door.open);
  assert.equal(door.open, true, 'the puppet opened it');
});

test('e05 Grethe: out of play and unseen in the office until a commando reaches her chair; then playable, o2 done', () => {
  const sim = e05('hard', { keep: ['g3'] });
  const gr = sim.cmd('grethe'), g3 = sim.get('g3'), gb = sim.cmd('greenberet');
  assert.equal(gr.state, 'jailed', 'held: out of play');
  assert.equal(canSee(g3, gr, sim.w), 'none', 'the sim ignores her');
  sim.put(gb, 45.6, 81.6);
  sim.run(1);
  assert.equal(gr.state, 'jailed', 'still held while nobody is within 3 m');
  assert.equal(sim.obj('o2').done, false);
  sim.put(gb, 43.6, 79.6);
  sim.run(0.5);
  assert.equal(gr.state, 'active', 'joined');
  assert.equal(sim.obj('o2').done, true, 'o2 done');
});

test('e05 small talk: holds the guardroom sentry gr1 (his head follows her), refused on a Gestapo man', () => {
  const sim = e05('hard', { keep: ['gr1', 'g1'] });
  const gr = sim.cmd('grethe'), gr1 = sim.get('gr1'), g1 = sim.get('g1');
  gr.state = 'active'; gr._joinsAt = null; // (joined)
  sim.put(gr, 56.8, 85.6, Math.PI);
  assert.equal(gr.useAbility('lipstick', gr1), true, 'small talk with gr1');
  sim.run(2);
  assert.equal(gr1.brain.state, 'LIPSTICK', 'he stops and talks');
  sim.put(gr, 50, 81.5);
  sim.run(1.5);
  const want = Math.atan2(gr.z - gr1.z, gr.x - gr1.x);
  const off = Math.abs(Math.atan2(Math.sin(gr1.heading - want), Math.cos(gr1.heading - want)));
  assert.ok(off < 0.35, `his head follows her (off by ${off.toFixed(2)} rad)`);
  sim.put(gr, 49.6, 74.8, 0);
  const r = gr.useAbility('lipstick', g1);
  assert.ok(r !== true || g1.brain.state !== 'LIPSTICK', 'a Gestapo man does not stop to talk');
  sim.run(1);
  assert.notEqual(g1.brain.state, 'LIPSTICK');
});

test('e05 the adjutant\'s tunic: the hanger gives the Spy an officer\'s uniform; it passes a sentry, not the Gestapo', () => {
  const sim = e05('hard', { keep: ['adj', 'oq1', 'g1'] });
  const adj = sim.get('adj'), spy = sim.cmd('spy'), g1 = sim.get('g1'), oq1 = sim.get('oq1');
  // (the two viewers stand aside, facing away, while the adjutant is taken: a witnessed knock-out is an alarm)
  sim.put(g1, 60, 80, 0); sim.put(oq1, 62, 76, 0);
  cuffBehind(sim, adj);
  sim.put(spy, adj.x + 0.9, adj.z);
  assert.equal(spy.useAbility('hanger', adj), true, 'hanger order');
  sim.run(3);
  assert.ok((spy.wardrobe || []).includes('officer'), `officer's tunic in the wardrobe (${spy.wardrobe})`);
  spy.disguised = true; spy.uniformType = 'officer';
  assert.equal(recognises(sim.get('oq1'), spy, sim.w), false, 'a sentry takes him for an officer');
  assert.equal(recognises(sim.get('g1'), spy, sim.w), true, 'the Gestapo see through it');
});

/** RFORT (the fort's alarm) from a point in the yard. */
const rfort = (sim) => sim.w.alarm.fireEvent('RFORT', { zoneId: 'z_fort', cause: 'test', x: 56, z: 70 });
const inYard = (e) => e.x > 36 && e.x < 76 && e.z > 50 && e.z < 90;

test('e05 bridge: the puppet keeper raises it; on RFORT the camp\'s squads stop at the outer bank (down: they cross)', () => {
  // negative control first: the bridge down, the squads reach the yard
  const a = e05('hard', { keep: [] });
  rfort(a);
  a.run(70);
  const squadA = a.w.enemies.filter((e) => e.spawn?.barracks === 'camp' || e.fromBarracks || /camp/.test(String(e.tag ?? e.id)));
  assert.ok(squadA.length >= 3, `the camp turned out (${squadA.length})`);
  assert.ok(squadA.some(inYard), 'bridge down: they cross into the yard');
  // the puppet keeper raises it
  const b = e05('hard', { keep: ['k1'] });
  const k1 = b.get('k1'), br = b.get('drawbridge'), sw = b.get('bridge_switch');
  const gb = cuffBehind(b, k1, true);
  assert.equal(br.raised, false, 'down at start');
  assert.equal(gb.useAbility('puppet', sw), true, 'the puppet is sent to the switch');
  b.run(10, () => br.raised && !(br.moving > 0));
  assert.equal(br.raised, true, 'the bridge is up');
  rfort(b);
  b.run(70);
  const squadB = b.w.enemies.filter((e) => e !== k1 && (e.spawn?.barracks === 'camp' || e.fromBarracks || /camp/.test(String(e.tag ?? e.id))));
  assert.ok(squadB.length >= 3, `the camp turned out (${squadB.length})`);
  assert.ok(!squadB.some(inYard), 'bridge up: nobody crossed');
  assert.ok(squadB.every((e) => e.z > 100.5 || e.x > 88 || e.z < 36), `they wait on the glacis side (${squadB.map((e) => `${e.x.toFixed(1)},${e.z.toFixed(1)}`).join(' ')})`);
});

test('e05 keeper: lowers the bridge again after relowerAfter (Hard 60 s) when free; stunned, once he comes round; bound, never; o4 needs him bound', () => {
  const sim = e05('hard', { keep: ['k1'] });
  const k1 = sim.get('k1'), br = sim.get('drawbridge'), sw = sim.get('bridge_switch');
  sw.interact(sim.cmd('greenberet')); // (a commando at the switch: the Spy's variant, design §11)
  sim.run(6);
  assert.equal(br.raised, true, 'up');
  assert.equal(sim.obj('o4').done, false, 'o4 not done while the keeper can lower it');
  sim.run(50);
  assert.equal(br.raised, true, 'still up before 60 s');
  sim.run(20, () => !br.raised);
  assert.equal(br.raised, false, 'the keeper lowered it');
  assert.equal(sim.w._e05.relowered, 1, 'once');
  // bound, he never does
  const b = e05('hard', { keep: ['k1'] });
  cuffBehind(b, b.get('k1'));
  b.get('bridge_switch').interact(b.cmd('greenberet'));
  b.run(6);
  assert.equal(b.get('drawbridge').raised, true);
  assert.equal(b.obj('o4').done, true, 'o4: up, and the keeper bound');
  b.run(140);
  assert.equal(b.get('drawbridge').raised, true, 'still up');
  // knocked out but not cuffed, he only waits: he comes round and lowers it the moment he can ("See to him");
  // o4 never holds meanwhile (verify round 2: the docs said a stun stopped him)
  const c = e05('hard', { keep: ['k1'] });
  const ck = c.get('k1'), cbr = c.get('drawbridge');
  c.get('bridge_switch').interact(c.cmd('greenberet'));
  c.run(7, () => cbr.raised && !(cbr.moving > 0));
  const tUp = c.w.time;
  c.run(40);
  const gb = c.cmd('greenberet');
  c.put(gb, ck.x - Math.cos(ck.heading), ck.z - Math.sin(ck.heading), ck.heading);
  assert.equal(gb.useAbility('knockoutFist', ck), true, 'fist order');
  c.run(5, () => !!ck.ko && !gb.currentAction && !gb.pendingAbility);
  assert.equal(ck.ko, 'stunned', 'out cold, not cuffed');
  c.put(gb, 40, 75);
  c.run(25);
  assert.equal(cbr.raised, true, 'still up while he is out (past his 60 s)');
  assert.equal(c.obj('o4').done, false, 'o4 open: a stunned keeper can still lower it');
  c.run(120, () => !cbr.raised);
  assert.equal(cbr.raised, false, 'awake again, he lowered it');
  assert.ok(c.w.time - tUp > 60, `later than his 60 s (${(c.w.time - tUp).toFixed(1)} s after the span rose)`);
});

test('e05 burn script: RFORT with the index on the desk and g3 free → lost; g3 bound → nothing; taking the index → o1', () => {
  const a = e05('hard', { keep: ['g3'] });
  rfort(a);
  a.run(150, () => !!a.w.scriptFail);
  assert.equal(a.w.scriptFail, 'THE CARD INDEX IS BURNING ON HAMMERØ.', 'the index burned');
  // g3 bound: the script has no actor
  const b = e05('hard', { keep: ['g3'] });
  cuffBehind(b, b.get('g3'));
  rfort(b);
  b.run(150);
  assert.equal(b.w.scriptFail ?? null, null, 'nothing burns');
  // the index taken (o1)
  const c = e05('hard', { keep: [] });
  const spy = c.cmd('spy'), idx = c.get('index');
  c.put(spy, idx.x + 0.8, idx.z + 0.6);
  assert.equal(spy.useAbility('hand', idx), true, 'pick-up order');
  c.run(4, () => c.obj('o1').done);
  assert.equal(c.obj('o1').done, true, 'o1 done');
  assert.ok((spy.inventory.get('documents') ?? 0) >= 1, 'the papers in his kit');
});

test('e05 hoist: worked from the stop nearer the man (the top as well as the bottom); everyone on the cage rides', () => {
  const a = e05('hard', { keep: [] });
  const lift = a.get('hoist'), gb = a.cmd('greenberet'), spy = a.cmd('spy');
  // (the cage up at the hoist house, two men round its top stop)
  lift.at = 1;
  const top = lift.stops[1], bottom = lift.stops[0];
  a.put(gb, top.x + 0.6, top.z - 0.4);
  a.put(spy, top.x - 0.7, top.z + 0.3);
  const p = lift.approachFrom(gb);
  assert.deepEqual([p.x, p.z], [top.x, top.z], 'a man at the top works it from the top stop');
  assert.deepEqual(Object.values(lift.approachFrom({ x: bottom.x + 1, z: bottom.z })).slice(0, 2), [bottom.x, bottom.z], 'and one at the bottom from the bottom');
  assert.equal(gb.useAbility('use', lift), true, 'use order at the top');
  a.run(20, () => lift.at === 0 && !lift.ride);
  assert.equal(lift.at, 0, 'the cage went down');
  for (const u of [gb, spy]) assert.ok(Math.hypot(u.x - bottom.x, u.z - bottom.z) < 1.6, `${u.role} rode down with it`);
});

test('e05 sight lines: the parade stores stack hides the office door from the quarters door (negative control: beside it)', () => {
  const a = e05('hard', { keep: ['oq1'] });
  const oq1 = a.get('oq1');
  const man = (x, z) => ({ x, z, y: 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });
  const look = (x, z) => { oq1.heading = Math.atan2(z - oq1.z, x - oq1.x); oq1.headOffset = 0; oq1.sweepActive = false; };
  // the office door, 23 m off behind the stack: never, his eyes straight at it
  look(48.6, 79.1);
  assert.equal(canSee(oq1, man(48.6, 79.1), a.w), 'none', 'the office door is hidden by the stack');
  // a man out on the parade beside the stack, the same distance: seen
  look(57.5, 82.5);
  assert.notEqual(canSee(oq1, man(57.5, 82.5), a.w), 'none', 'the open parade is in his eye (negative control)');
});

test('e05 art: the tall stores stacks are drawn on their sight-blocking boxes (inside the footprint, up to their height), deterministic', async () => {
  const { tallStores } = await import('../../src/art/e05-dressing.js');
  const { Geo } = await import('../../src/art/castle-kit.js');
  const stacks = getMission('e05').structures.filter((s) => s.variant === 'stores_tall');
  assert.equal(stacks.length, 3, 'three stacks (lane, courtyard, parade)');
  const bounds = (s) => {
    const G = new Geo(s.id), mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    tallStores(G, s);
    let tris = 0;
    for (const [, A] of G.parts) {
      tris += A.pos.length / 9;
      for (let k = 0; k < A.pos.length; k += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], A.pos[k + a]); mx[a] = Math.max(mx[a], A.pos[k + a]); }
    }
    return { mn, mx, tris, mats: [...G.parts.keys()].sort().join() };
  };
  for (const s of stacks) {
    const b = bounds(s), slack = 0.045; // (the lashings run 4 cm off the drape)
    assert.ok(b.mn[0] >= s.x - s.w / 2 - slack && b.mx[0] <= s.x + s.w / 2 + slack, `${s.id}: x inside the footprint`);
    assert.ok(b.mn[2] >= s.z - s.d / 2 - slack && b.mx[2] <= s.z + s.d / 2 + slack, `${s.id}: z inside the footprint`);
    assert.ok(b.mn[1] >= -1e-6, `${s.id}: nothing under the ground`);
    assert.ok(b.mx[1] >= s.h * 0.92, `${s.id}: drawn up to its sight-blocking height (${b.mx[1].toFixed(2)} of ${s.h})`);
    assert.ok(b.mats.includes('tarp') && b.mats.includes('boards'), `${s.id}: crates under a tarpaulin (${b.mats})`);
    assert.ok(b.tris < 2000, `${s.id}: ${b.tris} triangles`);
    assert.deepEqual(bounds(s), b, `${s.id}: the same stack every load`);
  }
});

test('e05 iron door: from inside the casemate it opens to a commando (nobody is shut in); from the yard only to its own', () => {
  const sim = e05('hard', { keep: [] });
  const door = sim.get('iron_door'), gb = sim.cmd('greenberet');
  assert.ok(!door.open, 'shut');
  sim.put(gb, 69, 82.4, -Math.PI / 2); // in the passage, the yard side
  assert.equal(door.canUse(gb), 'Locked from their side.', 'refused from the yard');
  sim.put(gb, 69, 79.6, Math.PI / 2); // in the casemate's hall
  assert.equal(door.canUse(gb), true, 'from inside it opens');
  assert.equal(gb.useAbility('use', door), true, 'use order from inside');
  sim.run(4, () => door.open);
  assert.equal(door.open, true, 'opened from inside');
  gb.moveTo(60, 75);
  sim.run(30, () => Math.hypot(gb.x - 60, gb.z - 75) < 0.6);
  assert.ok(Math.hypot(gb.x - 60, gb.z - 75) < 0.6, `out into the yard (${gb.x.toFixed(1)}, ${gb.z.toFixed(1)})`);
  // an open leaf is pulled to from the yard side as well
  sim.put(gb, 69, 82.4, -Math.PI / 2);
  assert.equal(door.canUse(gb), true, 'an open door is shut from either side');
});

test('e05 o4: done while the span is up with its keeper bound; the span brought down again opens it, raised again closes it', () => {
  const sim = e05('hard', { keep: ['k1'] });
  const br = sim.get('drawbridge'), sw = sim.get('bridge_switch'), gb = cuffBehind(sim, sim.get('k1'));
  sw.interact(gb);
  sim.run(7);
  assert.equal(br.raised, true, 'up');
  assert.equal(sim.obj('o4').done, true, 'o4: up, the keeper bound');
  sw.interact(gb);
  sim.run(0.2);
  assert.equal(sim.obj('o4').done, false, 'the span coming down: the camp can walk in again, o4 open');
  sim.run(7);
  assert.equal(br.raised, false, 'down');
  assert.equal(sim.obj('o4').done, false, 'down: o4 open');
  sw.interact(gb);
  sim.run(7);
  assert.equal(sim.obj('o4').done, true, 'up again: o4 done again');
});

test('e05 burn: a knock-out only pauses it (the index falls where he falls; awake, he takes it up again and burns it); cuffed, it ends', () => {
  const a = e05('hard', { keep: ['g3'] });
  const g3 = a.get('g3'), gb = a.cmd('greenberet');
  rfort(a);
  a.run(150, () => a.w._e05.g3Index);
  assert.equal(a.w._e05.g3Index, true, 'he has swept the index off the desk');
  a.run(1.5);
  knockOut(g3, gb, a.w);
  a.run(0.2);
  const loose = a.get('index');
  assert.ok(loose && !loose.removed && loose.count > 0, 'the index lies on the floor');
  assert.ok(Math.hypot(loose.x - g3.x, loose.z - g3.z) < 0.5, 'where he fell');
  assert.equal(a.w._e05.burn.done, false, 'the burn is not over');
  assert.equal(a.w._e05.burn.paused, true, 'it waits for him');
  let picked = false;
  a.run(240, () => { if (a.w._e05.g3Index) picked = true; return !!a.w.scriptFail; });
  assert.ok(picked, 'awake again, he picked it up');
  assert.equal(a.w.scriptFail, 'THE CARD INDEX IS BURNING ON HAMMERØ.', 'and burned it');
  // knocked out before the alarm: the script waits for him to come round (it does not end)
  const c = e05('hard', { keep: ['g3'] });
  knockOut(c.get('g3'), c.cmd('greenberet'), c.w);
  rfort(c);
  c.run(1);
  assert.equal(c.w._e05.burn.done, false, 'stunned at the alarm: the script waits');
  c.run(240, () => !!c.w.scriptFail);
  assert.equal(c.w.scriptFail, 'THE CARD INDEX IS BURNING ON HAMMERØ.', 'woken, he burns it');
  // cuffed with it on him: it lies where he fell, the script ends, nothing burns
  const b = e05('hard', { keep: ['g3'] });
  const g3b = b.get('g3'), gbb = b.cmd('greenberet');
  rfort(b);
  b.run(150, () => b.w._e05.g3Index);
  knockOut(g3b, gbb, b.w);
  cuff(g3b, gbb, b.w);
  b.run(150);
  assert.equal(b.w.scriptFail ?? null, null, 'nothing burns');
  assert.equal(b.w._e05.burn.done, true, 'the script is over');
  const idx = b.get('index');
  assert.ok(idx && !idx.removed && idx.count > 0, 'the index lies there to be taken');
  const spy = b.cmd('spy');
  b.put(spy, idx.x + 0.8, idx.z + 0.4);
  assert.equal(spy.useAbility('hand', idx), true, 'pick-up order');
  b.run(5, () => b.obj('o1').done);
  assert.equal(b.obj('o1').done, true, 'o1 done with the loose index');
});

test('e05 quick load: the burn, a loose index and the keeper\'s clock come back as they were (game order: rebuild, restore, script)', () => {
  // the index in the Kriminalrat's hands on his way to the stove: after the load he goes on and burns it, as without one
  const ctl = e05('hard', { keep: ['g3'] });
  rfort(ctl);
  ctl.run(150, () => ctl.w._e05.g3Index);
  ctl.run(2);
  const t0 = ctl.w.time;
  const a = quickLoad(ctl);
  assert.equal(a.w._e05.g3Index, true, 'still in his hands after the load');
  assert.equal(a.w._e05.burn?.started, true, 'the burn goes on');
  assert.equal(a.get('index'), null, 'no index on the desk');
  a.run(200, () => !!a.w.scriptFail);
  ctl.run(200, () => !!ctl.w.scriptFail);
  assert.equal(a.w.scriptFail, 'THE CARD INDEX IS BURNING ON HAMMERØ.', 'burned after the load');
  assert.equal(ctl.w.scriptFail, 'THE CARD INDEX IS BURNING ON HAMMERØ.', 'burned without one (control)');
  assert.ok(Math.abs((a.w.time - t0) - (ctl.w.time - t0)) < 2, `the same time to the fire (${(a.w.time - t0).toFixed(1)} s vs ${(ctl.w.time - t0).toFixed(1)} s)`);
  // a loose index (he was knocked out with it): laid where it lay after the load, and taken it is o1
  const b0 = e05('hard', { keep: ['g3'] });
  rfort(b0);
  b0.run(150, () => b0.w._e05.g3Index);
  b0.run(1.5);
  knockOut(b0.get('g3'), b0.cmd('greenberet'), b0.w);
  b0.run(0.2);
  const at = [b0.get('index').x, b0.get('index').z];
  const b = quickLoad(b0);
  const idx = b.get('index');
  assert.ok(idx && !idx.removed && idx.count > 0, 'the loose index is there after the load');
  assert.ok(Math.hypot(idx.x - at[0], idx.z - at[1]) < 0.05, 'where it lay');
  const spy = b.cmd('spy');
  b.put(spy, idx.x + 0.8, idx.z + 0.4);
  assert.equal(spy.useAbility('hand', idx), true, 'pick-up order');
  b.run(5, () => b.obj('o1').done);
  assert.equal(b.obj('o1').done, true, 'o1 done');
  // the keeper's clock: saved 50 s after the span rose, he lowers it ~10 s (+ his walk) after the load, not 60
  const k0 = e05('hard', { keep: ['k1'] });
  const br0 = k0.get('drawbridge');
  k0.get('bridge_switch').interact(k0.cmd('greenberet'));
  k0.run(7, () => br0.raised && !(br0.moving > 0));
  k0.run(50);
  const k = quickLoad(k0);
  const br = k.get('drawbridge'), tl = k.w.time;
  assert.equal(br.raised, true, 'up after the load');
  k.run(60, () => !br.raised);
  assert.equal(br.raised, false, 'lowered');
  assert.ok(k.w.time - tl < 25, `the keeper's clock kept running (lowered ${(k.w.time - tl).toFixed(1)} s after the load)`);
});

test('avoidance: a mate whose step aside is planned onto his own spot says no, and the man boxed in walks on through', () => {
  // e05 under jitter (seed 6): the Green Beret back from laying the adjutant in the Gestapo office, boxed in between
  // g3 cuffed on his feet and the Spy by the wall. The Spy's step aside was planned onto his own spot (the free spot was
  // beyond his body clearance: the planner's stand-in was his own cell); taken for a yield, it reset the Green Beret's
  // ghost timer (1.5 s) every second (the Spy's yield pause) and he marked time for 180 s. Here the walker is the Spy
  // and the mate the Green Beret (who cuffed g3, so g3 is no obstacle to him), the stand-in pinned by a plan that ends
  // where the mate stands: the yield must say no and the walker get through
  const sim = e05('hard', { keep: ['g3'] });
  const g3 = sim.get('g3');
  const gb = cuffBehind(sim, g3), spy = sim.cmd('spy'), g = sim.w.grid;
  // open parade: a straight walk east, the cuffed man 0.6 m north of it and the mate 0.6 m south
  const A = [49.5, 81.0], B = [57.5, 81.0];
  assert.ok(g.walkableLine(A[0], A[1], B[0], B[1]), 'the walk is open ground');
  sim.put(g3, 53.5, 80.4, Math.PI / 2);
  sim.put(gb, 53.5, 81.6, -Math.PI / 2);
  sim.put(spy, ...A, 0);
  sim.run(0.3);
  gb.moveTo = function () { const p = { x: this.x, z: this.z }; this.path = [p, { ...p }]; this.pathIndex = 1; this.moveTarget = this.path[1]; return true; };
  assert.equal(spy.issue({ type: 'move', x: B[0], z: B[1] }), true, 'move order');
  let held = 0;
  const arrived = () => Math.hypot(spy.x - B[0], spy.z - B[1]) < 0.4;
  sim.run(15, () => { if (spy._blockT > 0) held++; return arrived(); });
  assert.ok(held > 0, 'he was boxed in (the wait this test is about)');
  assert.ok(arrived(), `he got through (at ${spy.x.toFixed(2)}, ${spy.z.toFixed(2)})`);
  assert.ok(!gb.path, 'the mate is left standing, not on a walk to nowhere');
  assert.equal(gb._yieldFor(spy), false, 'a step aside planned onto his own spot is no yield');
});

test('e05 heath (review r3): a heather clump is a ragged crowd of sprig cards and crown mats, never a dome', async () => {
  const { heatherClump, heatherHue, heathPlan, tileUV, HEATHER_VARIANTS, ATLAS_COLS, ATLAS_ROWS } = await import('../../src/art/e05-heath.js');
  // the atlas: every tile's rect inside the texture, no two overlapping
  const rects = Array.from({ length: ATLAS_COLS * ATLAS_ROWS }, (_, t) => tileUV(t));
  for (const [u0, v0, u1, v1] of rects) assert.ok(u0 >= 0 && v0 >= 0 && u1 <= 1 && v1 <= 1 && u1 > u0 && v1 > v0, 'tile inside the atlas');
  for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
    const [A, B] = [rects[a], rects[b]];
    assert.ok(A[2] <= B[0] || B[2] <= A[0] || A[3] <= B[1] || B[3] <= A[1], `tiles ${a} and ${b} apart`);
  }
  for (let v = 0; v < HEATHER_VARIANTS; v++) {
    const c = heatherClump(v);
    assert.deepEqual(c, heatherClump(v), 'deterministic');
    // nothing but cards (quads with an alpha-cut tile each): no surface of its own
    assert.equal(c.pos.length / 3, c.cards * 4); assert.equal(c.idx.length, c.cards * 6); assert.equal(c.tiles.length, c.cards);
    assert.ok(c.cards >= 45, `variant ${v}: ${c.cards} cards`);
    const crowns = c.tiles.filter((t) => t >= 4).length;
    assert.ok(crowns >= 3 && crowns <= 5, `variant ${v}: ${crowns} crown mats`);
    assert.ok(new Set(c.tiles.filter((t) => t < 4)).size >= 3, `variant ${v}: sprigs of several kinds`);
    // a ragged top: the cards' tips stand at very different heights
    const tops = [], lows = [], rim = new Array(12).fill(0);
    for (let k = 0; k < c.cards; k++) {
      const ys = [0, 1, 2, 3].map((q) => c.pos[(k * 4 + q) * 3 + 1]);
      tops.push(Math.max(...ys)); lows.push(Math.min(...ys));
      if (c.tiles[k] < 4) { // (an upright sprig: its root, the middle of its bottom edge)
        const x = (c.pos[k * 12] + c.pos[k * 12 + 3]) / 2, z = (c.pos[k * 12 + 2] + c.pos[k * 12 + 5]) / 2;
        const sec = Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * 12) % 12;
        rim[sec] = Math.max(rim[sec], Math.hypot(x, z));
      }
    }
    const mean = tops.reduce((a, b) => a + b) / tops.length, sd = Math.sqrt(tops.reduce((a, b) => a + (b - mean) ** 2, 0) / tops.length);
    assert.ok(sd / mean > 0.2, `variant ${v}: top heights vary (sd/mean ${(sd / mean).toFixed(2)})`);
    // a lobed footprint with bays: the roots reach much further round one side than another (not a disc)
    assert.ok(Math.min(...rim) / Math.max(...rim) < 0.7, `variant ${v}: lobed outline (${(Math.min(...rim) / Math.max(...rim)).toFixed(2)})`);
    assert.ok(c.height > 0.6 && c.height < 1.2 && c.reach > 1 && c.reach < 1.6, `variant ${v}: unit size (${c.height.toFixed(2)} × ${c.reach.toFixed(2)})`);
    assert.ok(Math.min(...lows) > -0.3, 'roots and mats sunk a little, no deeper');
    for (let i = 0; i < c.nor.length; i += 3) assert.ok(Math.abs(Math.hypot(c.nor[i], c.nor[i + 1], c.nor[i + 2]) - 1) < 1e-6, 'unit normals');
  }
  // the cast: a field over the heath in [0, 1] spanning rust to grey-green; the plan carries it and the variants lean with it
  const hs = []; for (let i = 0; i < 2000; i++) hs.push(heatherHue((i * 0.37) % 60, (i * 1.13) % 60));
  assert.ok(Math.min(...hs) >= 0 && Math.max(...hs) <= 1 && Math.max(...hs) - Math.min(...hs) > 0.6, 'hue spans the palette');
  const cell = 0.5, cols = 120, rows = 120, plan = heathPlan({ cols, rows, cell, terrain: new Uint8Array(cols * rows) }).filter((p) => p.kind === 'heather');
  assert.ok(plan.every((p) => p.hue >= 0 && p.hue <= 1), 'every clump has its cast');
  const meanHue = (v) => { const l = plan.filter((p) => p.v === v); return l.reduce((a, p) => a + p.hue, 0) / l.length; };
  assert.ok(meanHue(1) > meanHue(2) + 0.2, `grey-green clumps where the cast is green (${meanHue(1).toFixed(2)} vs ${meanHue(2).toFixed(2)})`);
});

test('e05 heath (review r3): the clumps throw their shadows at the presets whose grass casts, and follow a preset switch', async () => {
  const { buildHeath, heathCastsShadow } = await import('../../src/art/e05-heath.js');
  const { TERRAIN_QUALITY } = await import('../../src/art/terrain/terrain.js');
  for (const q of Object.keys(TERRAIN_QUALITY)) {
    assert.equal(heathCastsShadow({ terrain: { quality: q } }), !!TERRAIN_QUALITY[q].shadowsGrass, `${q}: as the grass`);
  }
  assert.equal(heathCastsShadow({ terrain: { quality: 'high' } }), true, 'high casts');
  assert.equal(heathCastsShadow({ terrain: { quality: 'low' } }), false, 'low does not');
  assert.equal(heathCastsShadow({}), false, 'no terrain (placeholder): none');
  const cols = 60, rows = 60;
  let quality = 'high';
  const w = { grid: { cols, rows, cell: 0.5, terrain: new Uint8Array(cols * rows) }, terrain: { get quality() { return quality; } }, mission: { terrain: [] } };
  const meshes = [];
  buildHeath(w).traverse((o) => { if (o.isInstancedMesh) meshes.push(o); });
  assert.ok(meshes.length >= 4, `${meshes.length} instanced sets`);
  assert.ok(meshes.every((m) => m.castShadow === true && m.receiveShadow === true), 'high: every set casts and receives');
  quality = 'medium';
  assert.ok(meshes.every((m) => m.castShadow === false), 'switched to medium: none casts');
  quality = 'ultra';
  assert.ok(meshes.every((m) => m.castShadow === true), 'switched to ultra: they cast again');
});

test('e05 art data (review r3): the moat — no rock prisms under the masonry, faces to the bed, reflections on their walls; the MG ring on the mole', async () => {
  const { default: def } = await import('../../src/missions/expansion/e05_cold_iron.js');
  const { buildTerrace } = await import('../../src/art/castle-kit.js');
  const { waterBodyDescriptors } = await import('../../src/art/water.js');
  const { waterBodiesFromGrid } = await import('../../src/art/water/index.js');
  const { ringPoints } = await import('../../src/world/map-builder.js');
  const S = (id) => def.structures.find((s) => s.id === id);
  // the rampart bands and the bastions: gameplay as before (block, level, walks), drawn by the art alone
  for (const id of ['ramp_n', 'ramp_w', 'ramp_e', 'ramp_sw', 'ramp_se', 'b_nw', 'b_ne', 'b_se', 'b_sw']) {
    const s = S(id);
    assert.ok(s && s.type === 'cliff' && s.visual === false, `${id}: no prism of its own`);
    assert.ok(s.block === 2 && s.h === 6 && s.walkways?.length, `${id}: block, level and walks kept`);
  }
  // the facing runs down to the moat bed with footY; the default foot is unchanged for every other terrace
  const poly = [[0, 0], [20, 0], [20, 6], [0, 6]];
  const minY = (g) => { let m = Infinity; g.updateMatrixWorld(true); g.traverse((o) => { if (o.isMesh && /field_granite|rubble/.test(o.material.name)) { const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) m = Math.min(m, p.getY(i)); } }); return m; };
  const deep = buildTerrace(poly, 6, { seed: 'r3', side: 'field_granite', footY: -1.6 }), plain = buildTerrace(poly, 6, { seed: 'r3', side: 'field_granite' });
  assert.ok(Math.abs(minY(deep) + 1.6) < 1e-6, `face and plinth to the bed (${minY(deep)})`);
  assert.ok(Math.abs(minY(plain) + 0.4) < 1e-6, `default foot unchanged (${minY(plain)})`);
  // the planar reflection unbiased on e05's water only (a mission opt-in: the base missions' bodies as before)
  const cols = 40, rows = 30, terrain = new Uint8Array(cols * rows);
  for (let j = 5; j < 25; j++) for (let i = 5; i < 35; i++) terrain[j * cols + i] = 5;
  const g = { cols, rows, cell: 0.5, terrain, width: cols * 0.5, depth: rows * 0.5 };
  const mine = waterBodyDescriptors(g, def, 'coast', waterBodiesFromGrid);
  assert.ok(mine.length && mine.every((d) => d.reflUnbias === true), 'e05: reflUnbias on every body');
  const plainW = waterBodyDescriptors(g, { water: { velocity: 0, turbulence: 0.5 } }, 'coast', waterBodiesFromGrid);
  assert.ok(plainW.length && plainW.every((d) => d.reflUnbias === undefined), 'without the opt-in: as before');
  // the MG ring round mg_mole's tripod: closed to the south over the mouth, its open back to the mole's root, inside
  // the deck (x 103.4–108, the end at z 152), visual only (no footprint, no measured nav stamp)
  const ring = S('mg_mole_ring'), gun = def.vehicles?.find((v) => v.id === 'mg_mole_gun') || { x: 105.2, z: 151 };
  assert.ok(ring && ring.type === 'sandbags' && ring.variant === 'mg_ring', 'the ring');
  assert.ok(Math.hypot(ring.x - gun.x, ring.z - gun.z) < 0.6, 'round the gun');
  assert.ok(Math.abs(ring.rot - Math.PI / 2) < 1e-9 && (ring.ring.arc ?? 270) === 270, 'closed to the south, open to the north');
  assert.ok(ring.block === 0 && ring.clip === false, 'visual only');
  const half = (ring.ring.width ?? 0.8) / 2;
  for (const [x, z] of ringPoints(ring.x, ring.z, ring.ring.r, ring.rot, ring.ring.arc ?? 270)) {
    assert.ok(x - half > 103.4 && x + half < 108 && z + 0.25 < 152.05, `bag course at (${x.toFixed(2)}, ${z.toFixed(2)}) on the deck`);
  }
  // hq4's south turn stays outside the bags (the open back faces him)
  const hq4 = def.enemies.find((e) => e.id === 'hq4'), end = hq4.route.points.at(-1);
  assert.ok(Math.hypot(end.x - ring.x, end.z - ring.z) > ring.ring.r + 0.4, 'hq4 turns short of the ring');
});

test('e05 art data (review r2): the heath gathers in drifts clear of paths and keep-outs; the relief bumps are opt-in', async () => {
  const { heathPlan, driftField } = await import('../../src/art/e05-heath.js');
  const { bumpField } = await import('../../src/art/terrain/terrain-layers.js');
  // a bare 60 × 60 m heath with a 4 m road across it and an excluded rect
  const cell = 0.5, cols = 120, rows = 120, terrain = new Uint8Array(cols * rows);
  const plan = heathPlan({ cols, rows, cell, terrain }, { paths: [{ points: [[0, 30], [60, 30]], width: 4 }], exclude: [[40, 40, 60, 60]] });
  assert.ok(plan.length > 300, `${plan.length} clumps`);
  assert.equal(plan.filter((p) => Math.abs(p.z - 30) < 2.9).length, 0, 'none on the road or its margin');
  assert.equal(plan.filter((p) => p.x >= 40 && p.z >= 40).length, 0, 'none in the excluded rect');
  assert.deepEqual(heathPlan({ cols, rows, cell, terrain }).slice(0, 20), heathPlan({ cols, rows, cell, terrain }).slice(0, 20), 'deterministic');
  // drifts with gaps: plenty of 3 m cells hold no clump at all, the occupied ones hold several (clusters, not a carpet)
  const occ = new Map();
  for (const p of plan) { const k = `${Math.floor(p.x / 3)},${Math.floor(p.z / 3)}`; occ.set(k, (occ.get(k) || 0) + 1); }
  const cells = 20 * 20 - 7 * 7 - 20 * 2;
  assert.ok(occ.size < cells * 0.75, `bare gaps: ${occ.size} of ~${cells} cells occupied`);
  assert.ok(plan.length / occ.size > 2, `clustered: ${(plan.length / occ.size).toFixed(1)} a cell`);
  assert.ok(Math.max(...plan.map((p) => p.s)) / Math.min(...plan.map((p) => p.s)) > 2.5, 'sizes vary');
  assert.ok(driftField(5, 5, 7.5, 1) >= 0 && driftField(5, 5, 7.5, 1) <= 1, 'drift field in [0, 1]');
  // relief: none without data; a knoll peaks at its h, a hollow dips, both vanish at their reach
  assert.equal(bumpField(undefined), null); assert.equal(bumpField([]), null);
  const f = bumpField([{ x: 10, z: 10, r: 5, h: 2 }, { x: 30, z: 10, r: 4, h: -0.5 }]);
  assert.ok(Math.abs(f(10, 10) - 2) < 1e-9 && Math.abs(f(30, 10) + 0.5) < 1e-9, 'peaks');
  assert.equal(f(15.01, 10), 0); assert.equal(f(20, 20), 0);
  assert.ok(f(12.5, 10) > 0.9 && f(12.5, 10) < 1.1, `half-way ${f(12.5, 10)}`);
  const { default: def } = await import('../../src/missions/expansion/e05_cold_iron.js');
  assert.ok(def.groundRelief.length >= 12 && def.groundRelief.every((b) => b.r > 3 && Math.abs(b.h) <= 2.5), 'e05 has its landforms');
  assert.ok(def.pavements?.some((a) => a.id === 'quay_harbour' && a.grid === false && a.surface === 'quay'), 'the quays are paved, visual only');
  assert.ok(def.furniture?.every((f2) => f2.block === false), 'the quay furniture blocks nothing');
});

test('e05 solution (verify r4): the office\'s north-east corner — where the door guards are laid while the Kriminalrat is out on his round and the Green Beret waits for him — stays out of his eyes from his way back in at the door to the last moment he can be struck at his desk; the men laid there keep the avoidance clearance apart; a man just outside the corner, toward the doorway or along the north wall, he sees (negative controls)', async () => {
  const { OFFICE } = await import('../../tools/solutions/e05.solution.mjs');
  const { CONFIG } = await import('../../src/config.js');
  // (the game's mesh-measured world, as the solution plays it: tools/solutions/navcache/e05.json)
  const s = headlessMission('e05', { difficulty: 'hard', navCache: true });
  for (const e of [...s.world.enemies]) if ((e.tag ?? e.id) !== 'g3') s.world.remove(e);
  s.world.flushRemovals();
  const sim = wrap(s);
  sim.run(0.1);
  const g3 = sim.get('g3'), b = g3.brain, w = sim.w;
  // the last leg of his round: 7 m north of the office door, walking in (the door, then his desk)
  sim.put(g3, 48.5, 72, Math.PI / 2);
  b.atWait = false; b.waitT = 0; b.routeIndex = g3.route.length - 1;
  const man = ([x, z]) => ({ x, z, y: 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });
  const body = ([x, z]) => ({ x, z, y: 0, kind: 'body' });
  const spots = { 'north guard (NE_CORNER)': body(OFFICE.NE_CORNER), 'south guard (G2_DUMP)': body(OFFICE.G2_DUMP), 'the Green Beret (GB_POCKET)': man(OFFICE.GB_POCKET) };
  // (just outside the corner his own cone leaves him, on its two edges: toward the doorway's line, along the north wall)
  const controls = [man([45.0, 77.5]), man([43.75, 75.75])], ctl = [0, 0];
  const seen = {};
  let sat = false, k = 0;
  for (; k < Math.round(120 / s.dt); k++) {
    sim.run(s.dt);
    const atDesk = b.atWait && Math.hypot(g3.x - OFFICE.DESK[0], g3.z - OFFICE.DESK[1]) < 0.8;
    if (atDesk) sat = true;
    if (sat && (!atDesk || (b.waitT ?? 0) <= 4)) break; // (atDesk in the solution: the strike needs more than 4 s left)
    for (const [name, t] of Object.entries(spots)) if (canSee(g3, t, w) !== 'none') seen[name] = (seen[name] ?? 0) + 1;
    controls.forEach((c, i) => { if (canSee(g3, c, w) !== 'none') ctl[i]++; });
  }
  assert.ok(sat, 'he walked in and sat down at his desk');
  assert.ok(k * s.dt > 40, `his walk in and his halt were watched (${(k * s.dt).toFixed(1)} s)`);
  assert.deepEqual(seen, {}, 'nothing in the corner seen (ticks per spot)');
  assert.ok(ctl[0] > 0, 'negative control: a man standing at (45.0, 77.5), toward the doorway, is seen');
  assert.ok(ctl[1] > 0, 'negative control: a man standing at (43.75, 75.75), along the north wall, is seen');
  // a man down keeps the living units.avoid.clear off: each spot can be stood on with the others' men laid
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]), clear = CONFIG.units.avoid.clear;
  assert.ok(d(OFFICE.NE_CORNER, OFFICE.G2_DUMP) > clear + 0.1, `the two guards ${d(OFFICE.NE_CORNER, OFFICE.G2_DUMP).toFixed(2)} m apart`);
  assert.ok(d(OFFICE.GB_POCKET, OFFICE.NE_CORNER) > clear + 0.05 && d(OFFICE.GB_POCKET, OFFICE.G2_DUMP) > clear + 0.05, 'the Green Beret\'s spot clear of both');
});

test('e05 art (verify r4): a bastion\'s rubble plinth is one ring mitred at every corner — a ray from the moat at any bearing meets its face, never a slit between two edges\' boxes (negative control: the boxes, still the default, leave one at every corner); its top course rises and dips', async () => {
  const THREE = await import('three');
  const { buildTerrace } = await import('../../src/art/castle-kit.js');
  // a bastion as e05 draws it: a 16-sided drum of r 5, its walk at 6.01, faced down to the moat's bed
  const n = 16, R = 5, cx = 32, cz = 94;
  const poly = Array.from({ length: n }, (_, k) => [cx + Math.cos((k / n) * Math.PI * 2) * R, cz + Math.sin((k / n) * Math.PI * 2) * R]);
  const o = { seed: 'b_sw', side: 'field_granite', top: 'turf_top', batter: 0.35, spouts: false, footY: -1.6 };
  const ring = buildTerrace(poly, 6.01, { ...o, mitre: true }), boxes = buildTerrace(poly, 6.01, o);
  // horizontal rays at 0.2 m (above the water, under the plinth's top) from 3 m out, every 0.25° (half a step off the
  // corners' bearings, so no ray runs exactly down a seam)
  const probe = (g) => {
    g.updateMatrixWorld(true);
    const rc = new THREE.Raycaster(), out = [];
    for (let k = 0; k < 1440; k++) {
      const a = ((k + 0.5) / 1440) * Math.PI * 2;
      rc.set(new THREE.Vector3(cx + Math.cos(a) * (R + 3), 0.2, cz + Math.sin(a) * (R + 3)), new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a)));
      const h = rc.intersectObject(g, true)[0];
      out.push(h ? { r: Math.hypot(h.point.x - cx, h.point.z - cz), mat: h.object.material.name } : null);
    }
    return out;
  };
  // the plinth's face stands ~0.38 m (± 0.04) out from the drum's outline: 4.9–5.0 m out to the edges and the corners
  const onFace = (h) => h && h.mat === 'castle:rubble' && h.r > 5.15 && h.r < 5.6;
  const ringHits = probe(ring), boxHits = probe(boxes);
  const missed = ringHits.map((h, k) => (onFace(h) ? null : `${((k + 0.5) / 4).toFixed(2)}°: ${h ? `${h.mat} r ${h.r.toFixed(2)}` : 'nothing'}`)).filter(Boolean);
  assert.deepEqual(missed, [], 'the mitred ring: every ray meets the plinth\'s face');
  const slits = boxHits.filter((h) => !onFace(h)).length;
  assert.ok(slits >= n * 3, `negative control: the boxes leave a slit at every corner (${slits} of 1440 rays pass into one)`);
  // the top course: a few cm up and down from corner to corner, about the boxes' 0.55
  const tops = new Set();
  ring.traverse((m) => { if (m.isMesh && m.material.name === 'castle:rubble') { const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) tops.add(p.getY(i).toFixed(3)); } });
  const ys = [...tops].map(Number);
  assert.ok(Math.min(...ys) > 0.45 && Math.max(...ys) < 0.6 && Math.max(...ys) - Math.min(...ys) > 0.04, `top course ${Math.min(...ys).toFixed(3)}–${Math.max(...ys).toFixed(3)}`);
});

test('e05 solution (verify r5): a door judged open — the look-ahead with the hoist house\'s door open (perception `passOwners`, sneak.mjs `w.sneakOpen`) sees what the open door really shows: the black coat at the wall walk\'s SE corner looks into the house; shut, nothing; another door\'s owner opens nothing (negative control); and a use order stops the man where doorSpot says, the door turning inside doorStep\'s window', async () => {
  const { DOORS } = await import('../../tools/solutions/e05.solution.mjs');
  const { clearFor } = await import('../../tools/solutions/sneak.mjs');
  // (the game's mesh-measured world, as the solution plays it: tools/solutions/navcache/e05.json)
  const s = headlessMission('e05', { difficulty: 'hard', navCache: true });
  for (const e of [...s.world.enemies]) if ((e.tag ?? e.id) !== 'g4') s.world.remove(e);
  s.world.flushRemovals();
  const sim = wrap(s);
  sim.run(0.1);
  const w = sim.w, g4 = sim.get('g4'), door = sim.get('hoist_door'), west = sim.get('hoist_door_w');
  const D = { world: w, item: (id) => sim.get(id) };
  // g4 on his round to the SE corner, halted there looking south-west over the yard (Hard: 15 s)
  assert.ok(sim.run(400, () => g4.brain?.atWait && Math.hypot(g4.x - 79, g4.z - 93) < 1 && (g4.brain.waitT ?? 0) < 13), 'g4 halted at the SE corner');
  const man = ([x, z]) => ({ x, z, y: 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });
  // the spot the door is worked from, the Green Beret's place by the jambs, the back corner a man is laid in; and a spot
  // off the doorway's lines (the Spy's, by the west door) that the open door does not show either (control)
  const inside = { spot: [68.26, 87.44], jamb: [68.17, 86.48], drop: [65.4, 86.5] }, off = [65.9, 88.3];
  const own = new Set([door.owner]), other = new Set([west.owner]);
  const reallyOpen = (p) => { door.setOpen(true, true); try { return canSee(g4, man(p), w); } finally { door.setOpen(false, true); } };
  for (const [name, p] of Object.entries(inside)) {
    assert.equal(canSee(g4, man(p), w), 'none', `${name}: the shut door hides it`);
    const open = reallyOpen(p);
    assert.notEqual(open, 'none', `${name}: the open door shows it`);
    assert.equal(canSee(g4, man(p), w, { passOwners: own }), open, `${name}: judged open, as the open door`);
    assert.equal(canSee(g4, man(p), w, { passOwners: other }), 'none', `${name}: the west door's owner opens nothing here (negative control)`);
  }
  assert.equal(canSee(g4, man(off), w, { passOwners: own }), 'none', 'off the doorway\'s lines: hidden, open or shut');
  // the planners' look (sneak.mjs): a man at the spot unseen for the next 2 s with the door shut, seen with it judged open
  assert.equal(clearFor(D, [inside.spot], 2, { mode: 'walk' }), true, 'clearFor, shut');
  assert.equal(DOORS.withOpen(D, ['hoist_door'], () => clearFor(D, [inside.spot], 2, { mode: 'walk' })), false, 'clearFor, judged open');
  assert.equal(w.sneakOpen, undefined, 'the look leaves no door judged open behind it');
  assert.equal(door.open, false, 'nor opens the real one');
  // doorSpot / doorStep against the engine: the Green Beret lying by the jambs, a use order on the door
  const gb = sim.cmd('greenberet');
  sim.put(gb, 68.17, 86.48, 0);
  gb.setStance('crawl');
  sim.run(1);
  const ds = DOORS.doorStep(D, gb, 'hoist_door'), t0 = w.time;
  gb.setStance('stand');
  sim.run(2, () => gb.stance === 'stand' && !(gb._stanceT > 0));
  assert.equal(gb.useAbility('use', door), true, 'use order');
  let stop = null;
  sim.run(4, () => { if (!stop && gb.currentActionId === 'use') stop = [gb.x, gb.z]; return door.open; });
  assert.ok(stop && Math.hypot(stop[0] - ds.spot[0], stop[1] - ds.spot[1]) < 0.1, `stopped at (${stop?.map((v) => v.toFixed(2))}), doorSpot (${ds.spot.map((v) => v.toFixed(2))})`);
  const turned = w.time - t0;
  assert.ok(door.open && turned >= ds.at[0] - 0.05 && turned <= ds.at[1], `the door turned ${turned.toFixed(2)} s on, doorStep [${ds.at.map((v) => v.toFixed(2))}]`);
});
