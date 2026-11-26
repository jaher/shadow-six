/**
 * LIGHTS OUT e06 "Thin Ice" (docs/expansion/e06.md): registration and data, the ice and the open water, and the
 * build brief's acceptance tests (§15): the push stops at the quay edge with the span up and goes over with it down;
 * the wagon drops at z 46 and o1 completes; the span master raises the span again after 60 s (Easy 120 s) unless he
 * is out or cuffed; the shunting engine pulls the wagon inland on the berth's alarm with its driver free and never with
 * him bound; a rifle round detonates a mine; o2 is the searchlight crew; a fishing family's death or Grethe's fails.
 * Run with the unit suite: node tests/unit/run.mjs e06
 */
import { test, assert } from '../unit/lib.mjs';
import { readFileSync } from 'node:fs';
import { getMission, MISSIONS } from '../../src/missions/index.js';
import { normalizeMission } from '../../src/missions/schema.js';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { knockOut, cuff, takePuppet } from '../../src/ai/bcd-enemy.js';
import { E06, shuntDelay, reraiseDelay } from '../../src/missions/scripts/e06.js';
import { Input } from '../../src/engine/input.js';

const M = () => getMission('e06');
/** The e06 world headless, Hard unless `easy`; `keep`: only these enemy ids (the rest of the garrison stays home). */
function e06(keep = null, easy = false, extra = {}) {
  const s = headlessMission('e06', { patch: (d) => ({ ...d, ...(easy ? { difficulty: 'easy' } : null), ...(keep ? { enemies: d.enemies.filter((e) => keep.includes(e.id)) } : null), ...extra }) });
  const w = s.world;
  const run = (sec, until = null) => { for (let k = 0, n = Math.round(sec / s.dt); k < n; k++) { s.step(); if (until && until()) return true; } return false; };
  return { s, w, run, cmd: (role) => w.commandos.find((c) => c.role === role), get: (id) => w.byId(id) };
}

test('e06: registered in slot 6 of LIGHTS OUT; strict schema for Easy and Hard; 33 / 41 enemies, 8 civilians, 14 / 22 mines', () => {
  const def = M();
  assert.ok(def && def.campaign === 'BCD' && def.number === 6 && def.title === 'Thin Ice');
  assert.ok(MISSIONS.includes(def));
  const src = readFileSync(new URL('../../src/missions/expansion/index.js', import.meta.url), 'utf8');
  assert.ok(/\/\/ e06\nimport '\.\/e06_thin_ice\.js';\n/.test(src), 'one import line directly under the // e06 marker');
  const mod = readFileSync(new URL('../../src/missions/expansion/e06_thin_ice.js', import.meta.url), 'utf8');
  const imports = [...mod.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports.filter((p) => !['./registry.js', '../schema.js', '../scripts/e06.js', '../../art/e06-dressing.js'].includes(p)), [], 'imports only the registry, the schema and its own scripts / art');
  for (const [d, n, mines, par] of [['easy', 33, 14, 1440], ['hard', 41, 22, 1320]]) {
    const m = normalizeMission(def, { strict: true, difficulty: d });
    assert.equal(m.enemies.filter((e) => e.soldierType !== 'pow').length, n, `${d} roster`);
    assert.equal(m.enemies.filter((e) => e.soldierType === 'pow').length, 8, `${d} fishing families`);
    assert.equal(m.interactables.filter((i) => i.kind === 'seaMine').length, mines, `${d} mines`);
    assert.equal(m.par.time, par);
  }
  assert.equal(normalizeMission(def, { difficulty: 'easy', quiet: true }).enemies.find((e) => e.id === 'q2').route.vel, 0.8, 'Easy: routes at 0.8');
});

test('e06: the sea and the basin are walkable ice; the channel, the lead and the slip are open water only the Marine enters', () => {
  const { w, cmd } = e06([]);
  const g = w.grid;
  for (const [x, z] of [[50, 10], [60, 45], [174, 45], [150, 20], [176, 6]]) assert.equal(g.walkableAt(x, z), true, `ice at (${x}, ${z})`);
  for (const [x, z] of [[90, 10], [92, 30], [133, 55], [168, 48]]) {
    assert.equal(g.walkableAt(x, z), false, `open water at (${x}, ${z})`);
    assert.equal(g.walkableAt(x, z, { swim: true }), true, `swimmable at (${x}, ${z})`);
  }
  const dr = cmd('driver'), ma = cmd('diver');
  assert.equal(w.findPath(84, 45, 96, 45, { role: 'driver' })?.some((p) => !g.walkableAt(p.x, p.z)) ?? false, false, 'a walker goes round the water');
  // §9: a man ordered onto the open water refuses in the mission's words; the Marine goes in
  const said = [];
  w.events.on('message', (p) => said.push(p.text));
  dr.x = 84; dr.z = 45; w.rebuildSpatial();
  assert.equal(dr.issue({ type: 'move', x: 92, z: 30 }), false, 'the Driver will not walk onto the channel');
  assert.ok(said.some((t) => /: The ice ends here\.$/.test(t)), `refused: ${JSON.stringify(said)}`);
  said.length = 0;
  assert.equal(dr.issue({ type: 'move', x: 140, z: 90 }), true, 'a walk on dry land is taken');
  assert.ok(!said.some((t) => /ice ends/.test(t)));
  const swim = w.findPath(84, 20, 96, 20, { role: 'diver', swim: true });
  assert.ok(swim && swim.length > 0, 'the Marine swims the channel');
  assert.ok(dr && ma);
  // the way out: from the berth quay along the basin's east edge, over the mole and between the frozen-in mines
  const p = w.findPath(176.8, 62, 176, 6, { role: 'driver' });
  assert.ok(p && p.length > 1, 'a way to the boats on foot');
  const mines = w.interactables.filter((i) => i.interactKind === 'seaMine');
  let near = Infinity;
  for (let k = 1; k < p.length; k++) {
    const a = p[k - 1], b = p[k], L = Math.hypot(b.x - a.x, b.z - a.z);
    for (let t = 0; t <= L; t += 0.25) {
      const x = a.x + ((b.x - a.x) * t) / (L || 1), z = a.z + ((b.z - a.z) * t) / (L || 1);
      for (const m of mines) near = Math.min(near, Math.hypot(x - m.x, z - m.z));
    }
  }
  assert.ok(near > 1.5, `the walk keeps clear of every mine (closest ${near.toFixed(2)} m)`);
});

test('e06: any click on open water is refused in the mission\'s words — mid-channel from either bank, the lead, the slip; never a walk round to the far bank (verifier r2)', () => {
  const { w, cmd, get } = e06(['sp1']); // (the span sentry for the puppet; nothing is stepped: nobody sees anyone)
  const said = [];
  w.events.on('message', (p) => said.push(p.text));
  const dr = cmd('driver'), ma = cmd('diver');
  const len = (u) => { let L = 0, q = { x: u.x, z: u.z }; for (const p of u.path || []) { L += Math.hypot(p.x - q.x, p.z - q.z); q = p; } return L; };
  const order = (u, from, to) => {
    u.stop?.(); u.path = null; u.x = from[0]; u.z = from[1]; w.rebuildSpatial(); said.length = 0;
    return u.issue({ type: 'move', x: to[0], z: to[1] });
  };
  // (the verifier's probes: a click mid-channel from the west bank, from the east bank, near the west edge, in the
  // lead round the tug, in the slip under the raised span — each was taken, some as a walk of 138–148 m round the lead)
  for (const [from, to] of [[[78, 20], [92, 20]], [[100, 12], [88, 12]], [[78, 12], [90, 12]], [[78, 12], [86, 12]], [[100, 40], [92, 36]],
    [[84, 45], [92, 30]], [[110, 52], [120, 52]], [[140, 50], [133, 55]], [[160, 47], [168, 48]], [[126, 66], [120, 58]]]) {
    assert.equal(w.groundAt(to[0], to[1]).water, true, `(${to}) is open water`);
    assert.equal(order(dr, from, to), false, `the Driver at (${from}) will not walk onto the water at (${to})`);
    assert.ok(!dr.path?.length || dr.path.length <= 1, `no walk planned from (${from}) to (${to})`);
    assert.deepEqual([dr.x, dr.z], from, 'he stays where he stood');
    assert.deepEqual(said, ['Tread: The ice ends here.'], `refused in the mission's words: ${JSON.stringify(said)}`);
  }
  // the shallows along his own edge are ice he stands on: a click there walks him to the edge, a few steps
  for (const [from, to] of [[[78, 20], [83.4, 20]], [[100, 12], [96.2, 12]]]) {
    assert.equal(w.groundAt(to[0], to[1]).walkable, true, `(${to}) is the walkable edge`);
    assert.equal(order(dr, from, to), true, `a click on the edge at (${to}) is taken`);
    assert.ok(len(dr) < Math.hypot(to[0] - from[0], to[1] - from[1]) + 2, `a short walk to his own edge (${len(dr).toFixed(1)} m)`);
    assert.ok(!said.some((t) => /ice ends/.test(t)));
  }
  // dry land, and the Marine swims the channel
  assert.equal(order(dr, [78, 20], [60, 20]), true, 'a walk on the ice is taken');
  assert.equal(order(ma, [78, 20], [92, 20]), true, 'the Marine goes into the channel');
  assert.ok(!said.some((t) => /ice ends/.test(t)));
  // a soldier on puppet strings cannot swim either: the order onto the water is refused, in the same words
  const sp = cmd('spy'), e = get('sp1');
  e.x = 160; e.z = 47; sp.x = 161; sp.z = 48.5; w.rebuildSpatial();
  knockOut(e, sp, w); cuff(e, sp, w);
  assert.equal(takePuppet(e, sp, w), true, 'the Spy takes the sentry on strings');
  said.length = 0;
  assert.equal(sp.issue({ type: 'move', x: 168, z: 48 }), false, 'the puppet is not sent into the slip');
  assert.deepEqual(said, [`${sp.nickname}: The ice ends here.`]);
  assert.ok(!e.path?.length || e.path.length <= 1, 'no walk planned for the puppet');
});

test('e06: a group clicked on the ice by the open water: every man goes, none refused; clicked on the water: every walker refuses, the Marine swims (verifier r3)', () => {
  // (verifier r3: the refusal ran on each man's formation slot — a 2-man group clicked on the ice by the channel left the
  // Spy where he stood, 'The ice ends here.', his fixed slot 1.2 m east being on the water; 4 men likewise, either bank)
  const { w, cmd } = e06([]);
  const queue = [];
  const inp = new Input({ world: w, state: 'playing', enqueue: (fn) => queue.push(fn), events: w.events, options: {} }, null);
  const said = [];
  w.events.on('message', (p) => said.push(p.text));
  const len = (u) => { let L = 0, q = { x: u.x, z: u.z }; for (const p of u.path || []) { L += Math.hypot(p.x - q.x, p.z - q.z); q = p; } return L; };
  /** The real click path: select the men, Input.orderMove at the point, run the queued orders (Game.step's first job). */
  const group = (roles, from, at) => {
    const sel = roles.map(cmd);
    sel.forEach((c, i) => { c.stop?.(); c.path = null; c.x = from[i][0]; c.z = from[i][1]; });
    w.rebuildSpatial();
    inp.select(sel, { silent: true });
    said.length = 0;
    inp.orderMove(at[0], at[1]);
    for (const fn of queue.splice(0)) fn();
    return sel;
  };
  const west = [[74, 17], [74, 19], [74, 21], [74, 23]], east = [[104, 10], [104, 12], [104, 14], [104, 16]], south = [[118, 40], [120, 40], [122, 40]];
  assert.equal(w.groundAt(84.7, 20).water, true, 'a 2-man group clicked at (83.5, 20) has its ring slot (1.2 m east) on the channel');
  // 0.4–0.6 m inside the channel's edge (x 84 at z 20, x 96 at z 12) from either bank, and inside the lead's south edge
  for (const [roles, from, at] of [[['driver', 'spy'], west, [83.5, 20]], [['driver', 'spy'], west, [83.6, 20]], [['driver', 'spy', 'sapper', 'grethe'], west, [83.4, 20]],
    [['driver', 'spy', 'sapper', 'grethe'], west, [82.8, 20]], [['driver', 'spy', 'sapper', 'grethe'], east, [96.6, 12]], [['driver', 'spy', 'sapper'], south, [120, 48.5]]]) {
    assert.equal(w.groundAt(at[0], at[1]).walkable, true, `(${at}) is the ice`);
    const sel = group(roles, from, at);
    assert.deepEqual(said, [], `${roles.length} men at (${at}): nobody refused (${JSON.stringify(said)})`);
    for (const c of sel) {
      const end = c.path?.at(-1);
      assert.ok(end, `${c.role} goes (${roles.length} men at (${at}))`);
      assert.ok(Math.hypot(end.x - at[0], end.z - at[1]) <= 1.25, `${c.role} forms up by the click: (${end.x.toFixed(2)}, ${end.z.toFixed(2)})`);
      assert.equal(w.groundAt(end.x, end.z).water && !w.groundAt(end.x, end.z).walkable, false, `${c.role} stands on the ice`);
      assert.ok(len(c) < Math.hypot(at[0] - c.x, at[1] - c.z) + 4, `${c.role}: a short walk on his own side (${len(c).toFixed(1)} m)`);
    }
  }
  // on the open water — mid-channel, or 0.3 m over the edge with ring slots on the ice: every man who cannot swim
  // refuses in the mission's words and stays put (none walks to the edge); the Marine in the group goes in
  for (const [roles, at] of [[['driver', 'spy', 'sapper', 'diver'], [90, 20]], [['driver', 'spy', 'sapper'], [84.3, 20]]]) {
    const sel = group(roles, west, at);
    for (const c of sel) {
      if (c.canSwim) { assert.ok(c.path?.length > 1, 'the Marine swims out'); continue; }
      assert.ok(!c.path?.length || c.path.length <= 1, `${c.role} does not walk (click at (${at}))`);
      assert.ok(said.includes(`${c.nickname}: The ice ends here.`), `${c.role} refuses: ${JSON.stringify(said)}`);
    }
  }
});

test('e06: with the span up the push stops at the quay edge; lowered, the wagon goes off its end at z 46 and o1 is done', () => {
  const { w, run, cmd, get } = e06([]);
  const wag = get(E06.wagon), span = get(E06.span), dr = cmd('driver'), sp = cmd('spy');
  assert.equal(span.raised, true, 'raised at the start');
  dr.x = 168; dr.z = 103.7; w.rebuildSpatial();
  assert.equal(dr.useAbility('use', wag), true);
  run(80, () => wag.z < 62 && !wag.goal);
  assert.ok(Math.abs(wag.z - wag.size[0] / 2 - 56) < 0.3, `nose at the quay edge z 56 (wagon at ${wag.z.toFixed(2)})`);
  assert.equal(wag.destroyed, false);
  sp.x = 173.4; sp.z = 59.4; w.rebuildSpatial();
  assert.equal(sp.useAbility('use', get(E06.spanSwitch)), true, 'the switch in the span cabin');
  assert.ok(run(15, () => span.down), 'the span comes down');
  assert.equal(dr.useAbility('use', wag), true);
  assert.ok(run(30, () => wag.destroyed), 'over the end of the span');
  assert.ok(Math.abs(wag.z - 46) < 0.1);
  assert.equal(w.objectives.find((o) => o.id === 'o1').done, true, 'o1');
  assert.equal(w.scriptFail ?? null, null);
});

test('e06: the span master raises the span 60 s after it came down (Easy 120 s); never while he is out or cuffed', () => {
  for (const easy of [false, true]) {
    const { w, run, get } = e06(['k1'], easy);
    const span = get(E06.span), k1 = get('k1');
    span.toggle(); run(6);
    assert.equal(span.down, true);
    const delay = reraiseDelay(w);
    assert.equal(delay, easy ? 120 : 60);
    run(delay - 2);
    assert.equal(span.down, true, `still down after ${delay - 2} s`);
    assert.ok(run(4, () => span.raised), `raised again at ${delay} s (${easy ? 'Easy' : 'Hard'})`);
  }
  // knocked out: not while he is out (30 s), raised once he comes round; cuffed: never
  const a = e06(['k1']);
  const spanA = a.get(E06.span), k1a = a.get('k1');
  spanA.toggle(); a.run(6);
  a.run(45);
  knockOut(k1a, null, a.w);
  a.run(20);
  assert.equal(spanA.down, true, 'out cold past his 60 s: the span stays down');
  assert.ok(a.run(15, () => spanA.raised), 'come round, he raises it');
  const b = e06(['k1']);
  const spanB = b.get(E06.span), k1b = b.get('k1');
  spanB.toggle(); b.run(6);
  knockOut(k1b, null, b.w); cuff(k1b, null, b.w);
  b.run(300);
  assert.equal(spanB.down, true, 'cuffed: it never goes up');
});

test('e06: the berth\'s alarm with the engine driver free: the engine pulls out, couples and takes the wagon inland (mission lost)', () => {
  const { w, run, get } = e06(['sh1']);
  const sh = get(E06.shunter), wag = get(E06.wagon);
  w.alarm.raise('z_berth', 'seen', 168, 90);
  run(shuntDelay(w) - 1);
  assert.equal(sh.hauling, false, 'not before its delay (Hard 10 s)');
  assert.ok(run(3, () => sh.hauling), 'pulling out');
  assert.ok(run(30, () => wag.hauling), 'coupled to the sealed wagon');
  assert.ok(run(30, () => !!w.scriptFail), 'gone inland');
  assert.equal(w.scriptFail, 'THE WAGON HAS GONE INLAND.');
  assert.ok(wag.z > E06.inlandZ);
});

test('e06: the berth\'s alarm with the engine driver cuffed (or the wagon already in the harbour): the wagon stays', () => {
  // the whole garrison and roster, as the reference solution leaves the berth at D3: the escort, the engine's sentry and
  // its driver cuffed where they stood, the team far away. The berth's squad comes down the yard and cuts them loose —
  // the driver too — but cuffing him disarmed the engine for good (§9: the once trigger `shunter_disarmed`)
  const { w, run, get } = e06();
  const sh = get(E06.shunter), wag = get(E06.wagon), sh1 = get('sh1');
  run(0.5);
  for (const id of ['sh1', 'sh2', 'e1', 'e2']) { knockOut(get(id), null, w); cuff(get(id), null, w); }
  run(0.5);
  assert.ok(w.events && w.setpieces?.tstate?.fired, 'the trigger bookkeeping is there');
  for (const c of w.commandos) { c.stop?.(); c.path = null; c.x = 2; c.z = 116; }
  w.rebuildSpatial?.();
  w.alarm.raise('z_berth', 'seen', 168, 80);
  let freed = null;
  for (let k = 0; k < 400 && !w.scriptFail; k++) { run(1); if (freed == null && !sh1.ko && sh1.alive) freed = w.time; }
  assert.ok(freed != null, 'the berth\'s squad cut the engine driver loose (the case the latch is for)');
  assert.equal(w.scriptFail ?? null, null, `nothing fails (${w.scriptFail})`);
  assert.equal(sh.hauling, false);
  assert.ok(Math.abs(sh.z - sh.params.z) < 1e-6 && Math.abs(wag.z - wag.params.z) < 1e-6, 'neither moved');
  // Easy: 30 s; with the wagon gone the engine leaves alone and nothing fails
  const E = e06(['sh1'], true);
  const sh2 = E.get(E06.shunter), wag2 = E.get(E06.wagon);
  wag2.destroyed = wag2.dropped = true;
  E.w.alarm.raise('z_berth', 'seen', 168, 90);
  E.run(28);
  assert.equal(sh2.hauling, false, 'Easy: not before 30 s');
  assert.ok(E.run(4, () => sh2.hauling), 'leaves alone');
  E.run(30);
  assert.equal(E.w.scriptFail ?? null, null);
});

test('e06: a rifle round sets off a frozen-in mine (an explosion: the moles\' alarm among the zones that hear it)', () => {
  const { w, run } = e06(['wm1']);
  const mine = w.interactables.find((i) => i.interactKind === 'seaMine');
  mine.takeDamage(80, null, 'leeEnfield');
  run(0.5);
  assert.equal(mine.exploded, true);
  assert.ok(w.alarm.zonesFired.some((f) => f.event === 'RM'), `RM fired (${w.alarm.zonesFired.map((f) => f.event).join(',')})`);
});

test('e06: o2 is the searchlight crew dead or cuffed (sl3 too on Hard); the light swings onto the basin on the moles\' alarm', () => {
  const { w, run, get } = e06(['sl1', 'sl2', 'sl3']);
  const o2 = () => w.objectives.find((o) => o.id === 'o2');
  w.alarm.raise('z_mole', 'seen', 60, 30);
  run(1);
  assert.equal(get('sl1').post.heading, E06.basinHeading, 'the light turns to the basin');
  get('sl1').die('knife', null); run(1);
  knockOut(get('sl2'), null, w); cuff(get('sl2'), null, w); run(1);
  assert.equal(o2().done, false, 'sl3 still stands (Hard)');
  get('sl3').die('knife', null); run(1);
  assert.equal(o2().done, true);
  const E = e06(['sl1', 'sl2', 'sl3'], true);
  assert.equal(E.get('sl3'), null, 'no sl3 on Easy');
  E.get('sl1').die('knife', null); E.get('sl2').die('knife', null); E.run(1);
  assert.equal(E.w.objectives.find((o) => o.id === 'o2').done, true, 'Easy: the two at the light');
});

test('e06: a fishing family\'s death or Grethe\'s fails the mission', () => {
  const a = e06(['f1']);
  a.run(0.2); // (the triggers listen from the first tick)
  a.get('f1').die('pistol', a.cmd('driver')); a.run(0.5);
  assert.equal(a.w.scriptFail, "A FISHERMAN'S CHILD IS DEAD. THAT IS NOT WHO WE ARE.");
  const b = e06([]);
  b.run(0.2);
  b.cmd('grethe').die('rifle', null); b.run(0.5);
  assert.ok(/GRETHE/.test(b.w.scriptFail || ''), b.w.scriptFail);
});

// ---------------------------------------------------------------- quick load while the berth's squad is out
import { restoreWorld } from '../../src/save.js';
import { Entity } from '../../src/entities/entity.js';

test('e06: a quick load while the berth\'s squad is out keeps all three men on their way (they come back with their squad)', () => {
  // (verifier r1: after a load mid-haul two of the three came back as lone men and stood at the barracks door)
  const fresh = () => { Entity.nextId = 1; return e06(); };
  const A = fresh();
  A.run(0.5);
  A.w.alarm.raise('z_berth', 'seen', 168, 80);
  A.run(12);
  const men = A.w.enemies.filter((e) => /^barracks#/.test(e.tag ?? '') && e.alive);
  assert.equal(men.length, 3, 'the berth\'s squad is out');
  const S = JSON.parse(JSON.stringify({ ...A.w.serialize(), nextId: Entity.nextId, ai: A.w.ai?.serialize?.() ?? null }));
  const AL = JSON.parse(JSON.stringify(A.w.alarm.serialize()));
  const B = fresh();
  restoreWorld(B.w, S);
  B.w.alarm.deserialize(AL);
  for (const m of men) {
    const b = B.w.byId(m.id);
    assert.ok(b && b.squad?.id === m.squad?.id, `${m.tag} back in his squad (${b?.squad?.id})`);
    assert.equal(b.brain.state, m.brain.state, `${m.tag} ${m.brain.state}`);
  }
  A.run(30); B.run(30);
  for (const m of men) {
    const b = B.w.byId(m.id);
    assert.ok(Math.hypot(b.x - m.x, b.z - m.z) < 0.5, `${m.tag}: (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) after the load, (${m.x.toFixed(1)}, ${m.z.toFixed(1)}) without it`);
  }
});
