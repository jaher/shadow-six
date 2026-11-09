/**
 * Everyone keeps out of fires (world/fires.js; user 2026-11-08: "Enemies should not walk through the fire", then for the
 * player's men "Path around fire": "Auto-paths go around burning areas; clicking inside a fire stops him at its edge.
 * Same rule as enemies."): a burning footprint blocks paths while it burns and opens again when it is down to a
 * smoulder; a goal in the flames is planned to their edge on his side; a man standing where a fire catches steps out; a
 * man walking a path through the place re-plans round it. Deterministic; saved with the world.
 * Run: node tests/unit/run.mjs fire-avoid
 */
import { test, assert } from './lib.mjs';
import { makeWorld, addEnemy, addCommando, step, run, DT } from './ai-harness.mjs';
import { findPath } from '../../src/world/pathfinding.js';
import { FIRE, FIRE_MARGIN, SMOULDER_AT, blazeLevel, fireAt, firstFireOnPath, firesOfExplosion, flameWindow, inShape } from '../../src/world/fires.js';
import { blazeLevel as vfxBlazeLevel } from '../../src/render/vfx/blaze.js';
import { RESIDUAL_CUT } from '../../src/render/vfx/effects.js';
import { explode } from '../../src/entities/projectile.js';
import { World } from '../../src/world/world.js';

/** A fire of radius r (flames) at (x, z) that catches at `on` s and is out at `off` s from now. */
const ring = (w, x, z, r, on = 0.1, off = 30) => w.fires.add({ kind: 'test', shape: { x, z, a: r, b: r, rot: 0, m: FIRE_MARGIN }, on, off });
const burningOn = (w, p) => !!p && p.some((q, k) => k > 0 && firstFireOnPath(w.grid, p[k - 1].x, p[k - 1].z, [q]) !== null);
const pathLen = (p) => p.reduce((s, q, k) => s + (k ? Math.hypot(q.x - p[k - 1].x, q.z - p[k - 1].z) : 0), 0);

test('fire-avoid: a fire blocks an enemy\'s path while it burns, not before it catches nor after it is down to a smoulder', () => {
  const w = makeWorld({ size: [80, 80] });
  const e = addEnemy(w, { soldierType: 'soldier', x: 25, z: 40, heading: 0 });
  ring(w, 40, 40, 3, 0.5, 10);
  step(w);
  assert.equal(w.grid.fireCells, 0, 'not caught yet: nothing stamped');
  const p0 = e._planPath(55, 40);
  assert.ok(pathLen(p0) < 30.5, `straight on before it catches (${pathLen(p0).toFixed(1)} m)`);
  run(w, 0.6);
  assert.ok(w.grid.fireCells > 0 && fireAt(w.grid, 40, 40), 'caught: its cells are stamped');
  const p1 = e._planPath(55, 40);
  assert.ok(p1 && !burningOn(w, p1), 'while it burns his path goes round it');
  assert.ok(pathLen(p1) > pathLen(p0) + 1, `the way round is longer (${pathLen(p1).toFixed(1)} m)`);
  // the same search without the fire (a commando's): straight through, the caches keyed apart
  const bare = findPath(w.grid, 25, 40, 55, 40, { role: 'enemy' });
  assert.ok(burningOn(w, bare), 'a search without the fire layer goes straight through it');
  const again = findPath(w.grid, 25, 40, 55, 40, { role: 'enemy', fire: w.grid.fire });
  assert.ok(!burningOn(w, again), 'and one with it, asked right after, still goes round (no stale cache)');
  run(w, 10);
  assert.equal(w.grid.fireCells, 0, 'out: the cells are wiped');
  assert.equal(w.fires.list.length, 0, 'and the spent fire is dropped');
  const p2 = e._planPath(55, 40);
  assert.ok(Math.abs(pathLen(p2) - pathLen(p0)) < 1e-6, 'the way is open again');
});

test('fire-avoid: an investigator whose goal is in the flames walks up to their edge on his side and stops there', () => {
  const w = makeWorld({ size: [80, 80] });
  const e = addEnemy(w, { soldierType: 'soldier', x: 20, z: 41, heading: 0, flags: { investigates: true } });
  ring(w, 40, 40, 3, 0.1, 60);
  run(w, 0.3);
  e.brain._startInvestigate(40, 40);
  let worst = Infinity;
  run(w, 25, () => { const d = Math.hypot(e.x - 40, e.z - 40); worst = Math.min(worst, d); return e.brain.phase === 'look'; });
  assert.equal(e.brain.phase, 'look', 'he arrives and looks round');
  const R = 3 + FIRE_MARGIN, d = Math.hypot(e.x - 40, e.z - 40);
  assert.ok(!fireAt(w.grid, e.x, e.z), `he stands outside the fire (${e.x.toFixed(2)}, ${e.z.toFixed(2)})`);
  assert.ok(worst >= R - 0.5, `never inside its footprint (closest ${worst.toFixed(2)} m from its centre, footprint ${R} m)`);
  assert.ok(d <= R + 1.5, `he stopped at its edge (${d.toFixed(2)} m from the centre)`);
  assert.ok(e.x < 40, 'on his side of it');
  assert.ok(!e.isMoving, 'and looks from there');
});

test('fire-avoid: a guard standing where a fire catches steps out of it; one walking a path into it re-plans round it', () => {
  const w = makeWorld({ size: [80, 80] });
  const post = addEnemy(w, { soldierType: 'sentry', x: 40, z: 40, heading: 0, post: { heading: 0 } });
  const walker = addEnemy(w, { soldierType: 'soldier', x: 20, z: 60, heading: 0, route: { type: 'PINGPONG', points: [{ x: 20, z: 60 }, { x: 60, z: 60, wait: 30 }] } });
  run(w, 2);
  assert.ok(walker.isMoving && walker.x > 20.5, 'the walker sets off east along z = 60 on his beat');
  ring(w, 40, 40, 2.5, 0.1, 60); // (under the post)
  ring(w, 45, 60, 2.5, 0.1, 60); // (across the walker's way)
  let inPost = 0, inWalk = 0;
  run(w, 70, () => { if (fireAt(w.grid, post.x, post.z)) inPost++; if (fireAt(w.grid, walker.x, walker.z)) inWalk++; return Math.hypot(walker.x - 60, walker.z - 60) < 0.5; });
  assert.ok(!fireAt(w.grid, post.x, post.z), `the post guard is out of it (${post.x.toFixed(2)}, ${post.z.toFixed(2)})`);
  assert.ok(inPost * DT < 2.5, `out within a couple of seconds (${(inPost * DT).toFixed(2)} s in it)`);
  assert.equal(inWalk, 0, 'the walker never sets foot in the fire on his way');
  assert.ok(Math.hypot(walker.x - 60, walker.z - 60) < 1, `and gets where he was going (${walker.x.toFixed(2)}, ${walker.z.toFixed(2)})`);
});

test('fire-avoid: a commando\'s path goes round a fire; an order into it stops him at its edge on his side', () => {
  const w = makeWorld({ size: [80, 80] });
  const c = addCommando(w, 'greenberet', 25, 40);
  const p0 = c._planPath(55, 40);
  ring(w, 40, 40, 3, 0.1, 60);
  run(w, 0.3);
  assert.ok(w.grid.fireCells > 0);
  assert.equal(c.pathQuery().fire, w.grid.fire, 'the fire layer in his query while it burns');
  const p1 = c._planPath(55, 40);
  assert.ok(!burningOn(w, p1) && pathLen(p1) > pathLen(p0) + 1, `his way goes round it (${pathLen(p0).toFixed(1)} -> ${pathLen(p1).toFixed(1)} m)`);
  // a click in the middle of the fire: he walks up to its edge, on his side, and stops
  assert.ok(c.moveTo(40, 40), 'the order is taken');
  let inside = 0;
  run(w, 20, () => { if (fireAt(w.grid, c.x, c.z)) inside++; return !c.isMoving; });
  const d = Math.hypot(c.x - 40, c.z - 40);
  assert.equal(inside, 0, 'never on a burning cell');
  assert.ok(!c.isMoving && d <= 3 + FIRE_MARGIN + 1.5 && c.x < 40, `stopped at its edge on his side (${c.x.toFixed(2)}, ${c.z.toFixed(2)}, ${d.toFixed(2)} m from its centre)`);
});

test('fire-avoid: a commando standing where a fire catches steps out of it; one walking into a new fire goes round', () => {
  const w = makeWorld({ size: [80, 80] });
  const a = addCommando(w, 'sniper', 40, 40), b = addCommando(w, 'sapper', 20, 60);
  run(w, 0.2);
  assert.ok(b.moveTo(60, 60), 'the Sapper sets off east along z = 60');
  run(w, 1);
  ring(w, 40, 40, 2.5, 0.1, 60); // (under the Sniper)
  ring(w, 45, 60, 2.5, 0.1, 60); // (across the Sapper's way)
  let inA = 0, inB = 0;
  run(w, 30, () => { if (fireAt(w.grid, a.x, a.z)) inA++; if (fireAt(w.grid, b.x, b.z)) inB++; return Math.hypot(b.x - 60, b.z - 60) < 0.5 && !a.isMoving; });
  assert.ok(!fireAt(w.grid, a.x, a.z) && inA * DT < 2.5, `the Sniper is out of it at once (${(inA * DT).toFixed(2)} s in it; at ${a.x.toFixed(2)}, ${a.z.toFixed(2)})`);
  assert.equal(inB, 0, 'the Sapper never sets foot in the fire on his way');
  assert.ok(Math.hypot(b.x - 60, b.z - 60) < 0.5, `and gets where he was sent (${b.x.toFixed(2)}, ${b.z.toFixed(2)})`);
});

test('fire-avoid: deterministic — the same fires, the same runs (two worlds, every tick)', () => {
  const play = () => {
    const w = makeWorld({ size: [80, 80] }, { seed: 7 });
    const es = [addEnemy(w, { soldierType: 'soldier', x: 20, z: 41, heading: 0, flags: { investigates: true } }),
      addEnemy(w, { soldierType: 'soldier', x: 60, z: 30, heading: 0, flags: { investigates: true } }),
      addEnemy(w, { soldierType: 'sentry', x: 41, z: 39, heading: 0, post: { heading: 0 } }),
      addCommando(w, 'greenberet', 39, 41), addCommando(w, 'spy', 10, 70)];
    explode(w, 40, 40, 'bomb', null, {});
    run(w, 0.5);
    es[4].moveTo(42, 39); // (a click into the burning ground)
    const trace = [];
    run(w, 20, () => { trace.push(es.map((e) => `${e.x.toFixed(6)},${e.z.toFixed(6)},${e.brain?.state ?? e.state}`).join('|'), w.grid.fireVersion); return false; });
    return trace.join(';');
  };
  const a = play(), b = play();
  assert.ok(a.length > 1000);
  assert.equal(a, b, 'identical traces');
});

test('fire-avoid: a bomb\'s burning ground counts from its catch to its smoulder (the VFX residual fire\'s own times)', () => {
  const w = makeWorld({ size: [80, 80] });
  const t0 = w.time;
  explode(w, 40, 40, 'bomb', null, {});
  const f = w.fires.list.find((q) => q.kind === 'ground');
  assert.ok(f, 'a ground fire is registered');
  assert.equal(w.grid.fireCells, 0, 'nothing stamped in the blast\'s own tick');
  const R = FIRE.residual;
  assert.ok(Math.abs(f.off - t0 - (RESIDUAL_CUT + (R.end - R.cut) * SMOULDER_AT)) < 1e-9, 'out at the residual fire\'s smoulder');
  // the VFX curve: level 0.12 (smoulder) right at that moment
  const lv = blazeLevel(R.ramp, R.end - R.cut, R.hold)(f.off - t0 - RESIDUAL_CUT);
  assert.ok(Math.abs(lv - 0.12) < 1e-6, `smoulder level there (${lv})`);
  assert.equal(vfxBlazeLevel, blazeLevel, 'the VFX draws with the sim\'s curve');
  step(w);
  run(w, f.on - t0 + 0.05);
  assert.ok(fireAt(w.grid, 40, 40), 'stamped once caught');
  run(w, f.off - w.time + 0.05);
  assert.ok(!fireAt(w.grid, 40, 40), 'wiped at its smoulder');
});

test('fire-avoid: structure fires mirror the VFX burning wreck (M6 Leopold: 30 x 5 m gun, 45°)', () => {
  const src = { interactKind: 'structure', params: { structure: { id: 'leopold', type: 'railway_gun', x: 110, z: 66, rot: Math.PI / 4, w: 30, d: 5, h: 6 } } };
  const fs = firesOfExplosion({ x: 110, z: 66, radius: 30, kind: 'structure', source: src });
  const s = fs.find((f) => f.kind === 'structure');
  assert.ok(s, 'it burns');
  const S = FIRE.structure;
  assert.ok(Math.abs(s.shape.a - Math.min(30, S.max) * S.k * S.kx) < 1e-9 && Math.abs(s.shape.b - 5 * S.k * S.kz) < 1e-9, 'the flames\' ellipse of the VFX');
  const win = flameWindow(S.ramp, S.burn);
  assert.ok(Math.abs(s.on - S.ramp / 3) < 1e-9 && Math.abs(s.off - S.burn * SMOULDER_AT) < 1e-9, `on ${s.on}, off ${s.off}`);
  assert.deepEqual([s.on, s.off], [win.on, win.off]);
  // along the gun (45°) the flames reach farther than across it
  assert.ok(inShape(s.shape, 110 + Math.cos(Math.PI / 4) * 3.5, 66 + Math.sin(Math.PI / 4) * 3.5));
  assert.ok(!inShape(s.shape, 110 - Math.sin(Math.PI / 4) * 3.5, 66 + Math.cos(Math.PI / 4) * 3.5));
  // walls and sandbags do not burn (their blast's burning ground does)
  assert.deepEqual(firesOfExplosion({ x: 10, z: 10, radius: 4, kind: 'structure', source: { params: { structure: { type: 'wall' } } } }).map((f) => f.kind), ['ground']);
  // a rack of drums burns on (M8's store); a lone drum only its spill
  assert.deepEqual(firesOfExplosion({ x: 5, z: 5, kind: 'barrel', source: { interactKind: 'barrel', params: { variant: 'oil_rack' } } }).map((f) => f.kind), ['spill', 'rack']);
  assert.deepEqual(firesOfExplosion({ x: 5, z: 5, kind: 'barrel', source: { interactKind: 'barrel', params: {} } }).map((f) => f.kind), ['spill']);
  assert.deepEqual(firesOfExplosion({ x: 5, z: 5, kind: 'grenade' }), []);
});

test('fire-avoid: saved and loaded, the fires burn on (stamped again) and go out on time', () => {
  const w = makeWorld({ size: [80, 80] });
  ring(w, 40, 40, 3, 0.1, 5);
  run(w, 1);
  const cells = w.grid.fireCells, S = w.fires.serialize();
  assert.ok(cells > 0);
  const w2 = new World({ size: [80, 80], mission: w.mission });
  w2.time = w.time;
  w2.fires.deserialize(JSON.parse(JSON.stringify(S)));
  assert.equal(w2.grid.fireCells, cells, 'the same cells burn after the load');
  w2.time += 4.5;
  w2.refreshDynamicOccluders();
  assert.equal(w2.grid.fireCells, 0, 'and go out when they should');
});

test('fire-avoid: no fire, no change — an enemy plans exactly as before', () => {
  const w = makeWorld({ size: [80, 80] });
  const e = addEnemy(w, { soldierType: 'soldier', x: 25, z: 40, heading: 0 });
  run(w, 0.2);
  assert.equal(e.pathQuery().fire, undefined, 'no fire layer in the query while nothing burns');
  const p = e._planPath(55, 47), q = findPath(w.grid, e.track.x, e.track.z, 55, 47, { role: 'enemy', swim: e.canSwim });
  assert.deepEqual(p, q);
});

test('fire-avoid: a fire that is out before he gets there does not stop him; one put out on his way neither', () => {
  for (const early of [false, true]) {
    const w = makeWorld({ size: [80, 80] });
    const e = addEnemy(w, { soldierType: 'soldier', x: 8, z: 41, heading: 0, flags: { investigates: true } });
    run(w, 0.2);
    e.brain._startInvestigate(40, 40);
    run(w, 0.5);
    assert.ok(e.isMoving, 'off to the noise');
    // a short fire (a drum's spill: out long before he walks the 30 m), or a long one the game puts out on his way
    const f = ring(w, 40, 40, 3, 0.1, early ? 300 : 3);
    run(w, 0.3);
    const end = e.moveTarget && Math.hypot(e.moveTarget.x - 40, e.moveTarget.z - 40);
    if (early) {
      assert.ok(end > 3, `a long fire: his walk now ends at its edge (${end?.toFixed(2)} m off)`);
      run(w, 4);
      f.off = w.time; // (put out)
    } else assert.ok(end < 1, `a short one: he walks on as before (${end?.toFixed(2)} m off)`);
    run(w, 40, () => e.brain.phase === 'look');
    assert.ok(Math.hypot(e.x - 40, e.z - 40) < 2.5, `${early ? 'put out on his way' : 'out before he got there'}: he walked on to the noise itself (${e.x.toFixed(2)}, ${e.z.toFixed(2)})`);
  }
});
