/**
 * Stairs and ladders (user requests 2026-10-07: "animate the commandos climbing and going down stairs properly",
 * "All commandos in all clothing and all situations walk/run climb and go down stairs well", "Both commandos and
 * enemy soldiers"):
 *  - world/stairs.js: every flight of the game is registered (M3 dam stairs, M2 plat_sw, the stair links of M6, M9,
 *    M12, M20) with the treads its mesh has;
 *  - art/stair-gait.js pure parts: footholds on one tread (no toe in a riser, no heel over the edge), swing levels,
 *    cadence (one or two treads a step), the support level continuous through a climb;
 *  - the sim (Unit._followPath, entities/stair-walk.js): the nosing line (no cell-by-cell height snaps on the dam
 *    stairs), straight up the flight, the stair pace (walk × 0.85, a careful jog ≤ 3 m/s and ≤ 7.5 treads a second),
 *    stair links walked (no mantle clip), a carrier may take them; ladders climbed along their line at the ladder pace,
 *    facing them.
 */
import { test, assert, near } from './lib.mjs';
import { loadGrid } from './mission-check.mjs';
import { getMission } from '../../src/missions/index.js';
import { Commando } from '../../src/entities/commando.js';
import { Entity } from '../../src/entities/entity.js';
import { stairTopAt, stairTreads } from '../../src/art/dam-stairs.js';
import { stairOf } from '../../src/art/access-platform.js';
import { STAIR_PACE, levelAt, levelSpan, lineAt, flightLocal, flightWorld } from '../../src/world/stairs.js';
import { footholdOnFlight, swingLevel, swingClear, cadenceFor, GAIT } from '../../src/art/stair-gait.js';
import { rungPairs } from '../../src/art/ladder-climb.js';
import { CONFIG } from '../../src/config.js';
import '../../src/abilities/index.js';

const grids = new Map();
const world = (id) => { if (!grids.has(id)) { Entity.nextId = 1; grids.set(id, loadGrid(getMission(id))); } return grids.get(id); };

test('stairs: every flight of the game is registered (M3 dam stairs, M2 plat_sw, the stair links of M6, M9, M12, M20)', () => {
  const n = (id) => world(id).world.stairs.flights;
  assert.deepEqual(n('m03').map((f) => f.kind), ['dam', 'dam']);
  assert.deepEqual(n('m02').map((f) => f.kind), ['platform']);
  for (const id of ['m06', 'm09', 'm12', 'm20']) {
    const want = getMission(id).ladders.filter((l) => l.kind === 'stairs').length;
    assert.equal(n(id).filter((f) => f.kind === 'link').length, want, `${id}: one flight per stair link`);
    assert.ok(n(id).every((f) => f.link && f.link.walk === 'stairs'), `${id}: tied to their links`);
  }
});

test('stairs: the M3 dam flights have the treads of the stair mesh (art/dam-stairs.js stairTopAt)', () => {
  const def = getMission('m03').structures.find((s) => s.ramps).ramps;
  world('m03').world.stairs.flights.forEach((f, i) => {
    const r = def[i], P = r.points, L = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]);
    const { N } = stairTreads(L, r.y0, r.y1, r.landing);
    assert.equal(f.risers.length, N, 'a riser up to each tread (the first from the ground)');
    for (let s = 0.01; s < L; s += 0.037) near(levelAt(f, s), stairTopAt(s, L, r.y0, r.y1, r.landing), 1e-6, `tread at s ${s.toFixed(2)}`);
    near(levelAt(f, -0.2), 0, 1e-9, 'the ground before the first riser');
    // the nosing line passes through every tread's front edge
    for (let k = 0; k < f.risers.length; k++) near(lineAt(f, f.risers[k]), f.levels[k + 1], 1e-6, `nosing ${k}`);
  });
});

test('stairs: the M2 plat_sw flight has the treads of the platform stair (art/access-platform.js)', () => {
  const [f] = world('m02').world.stairs.flights, p = getMission('m02').extras?.find?.((e) => e.id === 'plat_sw')
    || getMission('m02').props?.find?.((e) => e.id === 'plat_sw') || getMission('m02').structures.find((e) => e.id === 'plat_sw');
  const S = stairOf(p);
  assert.equal(f.risers.length, S.n);
  near(f.tread, S.tread, 1e-6); near(f.rise, S.rise, 1e-6);
  // the mesh's tread i (from the top) has its top at h − rise·i over local x ∈ [x0 + tread·(i−1), x0 + tread·i]
  for (let i = 1; i < S.n; i++) near(levelAt(f, S.run - S.tread * (i - 0.5)), S.h - S.rise * i, 1e-6, `tread ${i}`);
  near(levelAt(f, S.run + 0.2), S.h, 1e-9, 'the deck past the top riser');
});

test('stair gait: every foothold puts the whole sole on one tread — no toe into the riser ahead, no heel past the nosing (dam, platform, M20 short treads)', () => {
  const flights = [world('m03').world.stairs.flights[0], world('m02').world.stairs.flights[0], ...world('m20').world.stairs.flights];
  let n = 0;
  for (const f of flights) {
    for (let sB = f.sFoot - 0.5; sB < f.sTop + 0.6; sB += 0.013) for (const dir of [1, -1, 0.8, -0.8]) {
      const { ds, k } = footholdOnFlight(f, sB, dir, 0.09, 0.21);
      const s = sB + ds, a = dir >= 0 ? -0.21 * dir : 0.09 * dir, b = dir >= 0 ? 0.09 * dir : -0.21 * dir;
      const lo = s + Math.min(a, b), hi = s + Math.max(a, b), [s0, s1] = levelSpan(f, k);
      assert.ok(hi <= s1 - GAIT.riser + 1e-9, `${f.id} s ${sB.toFixed(2)} dir ${dir}: sole end ${hi.toFixed(3)} not into the riser at ${s1.toFixed(3)}`);
      if (s1 - s0 >= hi - lo + GAIT.nosing + GAIT.riser) assert.ok(lo >= s0 - GAIT.nosing - 1e-9, `${f.id}: heel / toe over the nosing by ≤ ${GAIT.nosing} m`);
      assert.ok(Math.abs(ds) <= Math.max(0.2, f.tread), `${f.id}: moved at most a tread (${ds.toFixed(3)})`);
      n++;
    }
  }
  assert.ok(n > 2000);
});

test('stair gait: a swinging foot rises early going up (over the next nosing), clears its own nosing before reaching down', () => {
  const r = 0.2426;
  // up two treads: at its tread's height by GAIT.leadUp of the swing, the knee lifting it an extra GAIT.clearUp
  near(swingLevel(0, 2 * r, GAIT.leadUp), 2 * r, 1e-9);
  assert.ok(swingLevel(0, 2 * r, 0.3) > r, 'past the middle tread at a third of the swing');
  near(swingClear(2 * r, 0.5), GAIT.clearUp, 1e-9);
  // down: holds its height while it clears the nosing, then reaches down; no extra lift on the flat
  near(swingLevel(2 * r, 0, GAIT.holdDown), 2 * r, 1e-9);
  near(swingLevel(2 * r, 0, 1), 0, 1e-9);
  near(swingClear(0, 0.5), 0, 1e-9);
  // continuous and monotone
  for (const [a, b] of [[0, 0.49], [0.49, 0], [1, 1.4], [1.4, 1]]) {
    let prev = swingLevel(a, b, 0);
    for (let u = 0.01; u <= 1; u += 0.01) {
      const y = swingLevel(a, b, u);
      assert.ok(Math.abs(y - prev) < 0.05 && (b - a) * (y - prev) >= -1e-12, `${a}→${b} at ${u.toFixed(2)}`);
      prev = y;
    }
  }
});

test('stair gait: cadence — a step covers one tread at a patrol\'s pace, two at a commando\'s walk or a jog (scale clamped)', () => {
  assert.deepEqual(cadenceFor(0.91, 0.384, 1.9), { n: 2, k: 0.91 / 0.768 });  // a commando walking the dam stairs
  assert.deepEqual(cadenceFor(0.6, 0.384, 1.9), { n: 2, k: 0.6 / 0.768 });    // (a short-legged walk at that pace: two, unhurried)
  assert.deepEqual(cadenceFor(0.52, 0.384, 0.77), { n: 1, k: 0.52 / 0.384 }); // a German patrol walking them
  assert.deepEqual(cadenceFor(0.52, 0.29, 0.77), { n: 1, k: 0.52 / 0.29 });   // the same patrol on plat_sw's 29 cm treads
  assert.deepEqual(cadenceFor(1.6, 0.384, 3), { n: 2, k: 1.6 / 0.768 });      // a jog up the dam stairs: two at a time, quick steps
  assert.equal(cadenceFor(1.6, 0.29, 3).k, GAIT.kMax);                        // on plat_sw: as quick as it goes
  assert.deepEqual(cadenceFor(0.6, 0.384), { n: 1, k: 0.6 / 0.384 });         // (no speed: shortened rather than stretched)
  assert.deepEqual(cadenceFor(null, 0.3, 1), { n: 1, k: 1 });
});

test('stair gait: the support level of a climb (the lower foothold, a swinging foot at the height it passes) rises tread by tread without a jump', () => {
  // two feet alternating two treads a step up the dam stairs: stance 0.3 s, swing 0.35 s
  const r = 0.2426, T = 0.65, dt = 1 / 60;
  const footAt = (side, t) => { // [level, swinging?]
    const ph = ((t / T) + (side ? 0.5 : 0)) % 1, n = Math.floor((t / T) + (side ? 0.5 : 0));
    const lvl = (m) => (2 * m + (side ? 1 : 0)) * r;
    if (ph < 0.46) return lvl(n);
    return swingLevel(lvl(n), lvl(n + 1), (ph - 0.46) / 0.54);
  };
  let prev = null, max = 0;
  for (let t = 0; t < 6; t += dt) {
    const y = Math.min(footAt(0, t), footAt(1, t));
    if (prev != null) max = Math.max(max, Math.abs(y - prev));
    prev = y;
  }
  assert.ok(max < 0.1, `largest change per 60 Hz frame ${max.toFixed(3)} m (a riser is ${r} m; two a step)`);
  assert.ok(prev > 15 * r, 'climbed two treads a step');
});

/** Walk a commando from `from` to `to` (flight coordinates) on flight 0 of a mission; per-tick trace. */
function walkFlight(id, from, to, { run = false, role = 'greenberet', k = 0 } = {}) {
  const { world: w } = world(id), f = w.stairs.flights[k];
  for (const c of [...w.commandos]) w.remove(c);
  w.flushRemovals?.();
  const a = flightWorld(f, from, 0), b = flightWorld(f, to, 0);
  const c = w.add(new Commando({ role, x: a.x, z: a.z }));
  c.y = lineAt(f, from);
  const ok = c.moveTo(b.x, b.z, { run });
  const tr = [];
  for (let i = 0; i < 60 * 40 && c.path; i++) { c.update(1 / 60); tr.push({ y: c.y, ...flightLocal(f, c.x, c.z), v2: Math.hypot(c.vx, c.vz) }); }
  w.remove(c); w.flushRemovals?.();
  return { ok, tr, f, arrived: !c.path };
}

test('stairs sim: a walker climbs the M3 dam stairs on its nosing line — no cell-by-cell height snap, straight up the flight', () => {
  for (const [from, to] of [[0.3, 11.6], [11.6, 0.3]]) {
    const { ok, tr, f, arrived } = walkFlight('m03', from, to);
    assert.ok(ok && arrived, `walked ${from} → ${to}`);
    let jump = 0, off = 0;
    for (let i = 1; i < tr.length; i++) jump = Math.max(jump, Math.abs(tr[i].y - tr[i - 1].y));
    for (const p of tr) if (p.s > 0.5 && p.s < f.sTop - 0.3) { off = Math.max(off, Math.abs(p.y - lineAt(f, p.s))); }
    assert.ok(jump < 0.03, `largest height change in a tick ${jump.toFixed(3)} m (was a cell's 0.24-0.49 m)`);
    assert.ok(off < 0.01, `on the nosing line (${off.toFixed(3)})`);
    // no zigzag across the stair: the path runs nearly straight up it
    const vs = tr.filter((p) => p.s > 1 && p.s < f.sTop - 1).map((p) => p.v);
    assert.ok(Math.max(...vs) - Math.min(...vs) < 0.45, `stays in a lane up the stair (v ${Math.min(...vs).toFixed(2)}..${Math.max(...vs).toFixed(2)})`);
  }
});

test('stairs sim: the stair pace — a walk is a little slower, a run is a careful jog (≤ 3 m/s, ≤ 7.5 treads a second)', () => {
  const mid = (tr, f) => tr.filter((p) => p.s > 2 && p.s < f.sTop - 2).map((p) => p.v2);
  const w = walkFlight('m03', 0.3, 11.6), r = walkFlight('m03', 0.3, 11.6, { run: true });
  const vw = Math.max(...mid(w.tr, w.f)), vr = Math.max(...mid(r.tr, r.f));
  near(vw, CONFIG.units.walk * STAIR_PACE.walk, 0.05, 'walking pace on the stairs');
  near(vr, Math.min(STAIR_PACE.runMax, STAIR_PACE.jog * r.f.tread), 0.05, 'the Green Beret\'s run (5.4 m/s) is a jog on the dam (2.9 m/s: 7.5 of its treads a second)');
});

test('stairs sim: M20 stair links are walked (their nosing line, no climbing clip), also with a man on the shoulder', () => {
  const { world: w, grid } = world('m20');
  const f = w.stairs.flights.find((q) => q.kind === 'link' && q.rise > 0.15);
  const L = f.link;
  for (const c of [...w.commandos]) w.remove(c);
  w.flushRemovals?.();
  const c = w.add(new Commando({ role: 'greenberet', x: L.a.x, z: L.a.z }));
  c.y = L.a.y;
  assert.ok(c.moveTo(L.b.x, L.b.z), 'path over the stair link');
  const wp = c.path.find((p) => p.link);
  assert.equal(wp?.link?.walk, 'stairs');
  let off = 0, anims = new Set(), jump = 0, prev = c.y;
  for (let i = 0; i < 60 * 30 && c.path; i++) {
    c.update(1 / 60); anims.add(c._anim); jump = Math.max(jump, Math.abs(c.y - prev)); prev = c.y;
    if (c.path?.[c.pathIndex]?.link) { const { s } = flightLocal(f, c.x, c.z); if (s > 0.3 && s < f.sTop - 0.3) off = Math.max(off, Math.abs(c.y - lineAt(f, s))); }
  }
  assert.ok(!c.path, 'arrived'); near(c.y, L.b.y, 0.05, 'at the top');
  assert.ok(!anims.has('climb') && !anims.has('ladder'), `walked, not climbed (${[...anims]})`);
  assert.ok(off < 0.05 && jump < 0.1, `on the flight's nosing line (${off.toFixed(3)}, jump ${jump.toFixed(3)})`);
  // §3.4 no climbing with a load — but a stair link is walked: the planner keeps it for a carrier
  const q = { ...c.pathQuery(), noLinks: true };
  const p = w.findPath(L.b.x, L.b.z, L.a.x, L.a.z, q);
  assert.ok(p && p.some((x) => x.link?.walk === 'stairs') || p?.length, 'a carrier still has a way (the stair link)');
  assert.ok(!grid.links.filter((l) => !l.walk).some((l) => p?.some((x) => x.link?.id === l.id)), 'no ladder for him');
  w.remove(c); w.flushRemovals?.();
});

test('ladders: climbed along the ladder (its foot → its top) at the ladder pace, facing it; down backwards, still facing it', () => {
  const { world: w, grid } = world('m19');
  const L = grid.links.find((l) => l.kind === 'ladder' && !l.walk);
  for (const c of [...w.commandos]) w.remove(c);
  w.flushRemovals?.();
  const c = w.add(new Commando({ role: 'greenberet', x: L.a.x, z: L.a.z - 1.2 }));
  const face = Math.atan2(L.b.z - L.a.z, L.b.x - L.a.x), len = Math.hypot(L.b.x - L.a.x, L.b.y - L.a.y, L.b.z - L.a.z);
  for (const [goal, up] of [[{ x: L.b.x, z: L.b.z + 0.4 }, true], [{ x: L.a.x, z: L.a.z - 1.2 }, false]]) {
    assert.ok(c.moveTo(goal.x, goal.z), 'path over the ladder');
    let t = 0, prevY = c.y, mono = true, facing = true, offLine = 0, anims = new Set();
    for (let i = 0; i < 60 * 30 && c.path; i++) {
      c.update(1 / 60);
      if (!c._ladder) continue;
      t += 1 / 60; anims.add(c._anim);
      if (up ? c.y < prevY - 1e-9 : c.y > prevY + 1e-9) mono = false;
      prevY = c.y;
      const d = Math.atan2(Math.sin(c.heading - face), Math.cos(c.heading - face));
      if (t > 1.2 && Math.abs(d) > 0.1) facing = false;
      // on the ladder's line: the height goes with the distance along it
      const along = ((c.x - L.a.x) * (L.b.x - L.a.x) + (c.z - L.a.z) * (L.b.z - L.a.z)) / ((L.b.x - L.a.x) ** 2 + (L.b.z - L.a.z) ** 2);
      offLine = Math.max(offLine, Math.abs(c.y - (L.a.y + (L.b.y - L.a.y) * along)));
    }
    assert.ok(!c.path, 'arrived');
    assert.ok(mono, `${up ? 'up' : 'down'}: the height only ${up ? 'rises' : 'falls'} (no slide, no snap)`);
    near(t, len / CONFIG.abilities.ladderSpeed, 0.1, `${up ? 'up' : 'down'}: the ladder's length at ${CONFIG.abilities.ladderSpeed} m/s`);
    assert.ok(facing, 'facing the ladder all the way (down: backing down it)');
    assert.ok(offLine < 0.02, `along the ladder's line (${offLine.toFixed(3)})`);
    assert.ok(anims.has('ladder') && !anims.has('climb'), `the ladder climb, not the wall mantle (${[...anims]})`);
  }
  w.remove(c); w.flushRemovals?.();
});

test('ladders: a new order halfway up is taken from the ladder\'s end (no hanging in mid-air)', () => {
  const { world: w, grid } = world('m19');
  const L = grid.links.find((l) => l.kind === 'ladder' && !l.walk);
  for (const c of [...w.commandos]) w.remove(c);
  w.flushRemovals?.();
  const c = w.add(new Commando({ role: 'greenberet', x: L.a.x, z: L.a.z - 1.2 }));
  c.moveTo(L.b.x, L.b.z + 0.4);
  for (let i = 0; i < 60 * 30 && !(c._ladder && c.y > 2); i++) c.update(1 / 60);
  assert.ok(c._ladder && c.y > 2, 'halfway up');
  assert.ok(c.moveTo(L.a.x + 2, L.a.z - 2), 'a new order');
  assert.equal(c.path[0], c._ladder.wp, 'the ladder first');
  c.stop();
  assert.ok(c.path && c._ladder, 'a stop halfway up climbs on to its end');
  for (let i = 0; i < 60 * 30 && c.path; i++) c.update(1 / 60);
  near(c.y, L.b.y, 0.01, 'at the top, not in mid-air');
  w.remove(c); w.flushRemovals?.();
});

test('ladder climb: hands and feet take turns, two rungs a move — the right foot with the left hand, then the other pair', () => {
  let prev = rungPairs(0);
  assert.deepEqual(prev, { a: 0, b: 0 });
  for (let q = 0.05; q <= 6; q += 0.05) {
    const p = rungPairs(q), da = p.a - prev.a, db = p.b - prev.b;
    const ph = q % 2;
    if (ph > 0.02 && ph < 0.98) assert.ok(Math.abs(db) < 1e-9, `pair B holds while A moves (q ${q.toFixed(2)})`);
    if (ph > 1.02 && ph < 1.98) assert.ok(Math.abs(da) < 1e-9, `pair A holds while B moves (q ${q.toFixed(2)})`);
    assert.ok(da >= -1e-9 && db >= -1e-9 && da < 0.2 && db < 0.2, 'up, smoothly');
    prev = p;
  }
  near(rungPairs(4).a, 4, 1e-9); near(rungPairs(4).b, 4, 1e-9);
});

test('stairs: a man is not dragged up a flight (the move is refused with a message); on the shoulder he is carried up it', async () => {
  const { makeSim, guard } = await import('./abilsim.mjs');
  const def = getMission('m03');
  const f0 = world('m03').world.stairs.flights[0], a = flightWorld(f0, -1.5, 0), b = flightWorld(f0, -1.5, 0.9), top = flightWorld(f0, f0.sTop + 1, 0);
  for (const [role, mode] of [['sniper', 'drag'], ['greenberet', 'shoulder']]) {
    Entity.nextId = 1;
    const s = makeSim({ ...def, commandos: [{ role, x: a.x, z: a.z }], enemies: [guard('d', b.x, b.z)] }, { brains: false });
    const c = s.cmd(role), body = s.get('d');
    body.die('knife', null);
    const msgs = [];
    s.world.events.on('message', (m) => msgs.push(m.text));
    assert.ok(c.issue({ type: 'ability', id: 'hand', target: body }), `${role} takes the body`);
    s.run(3, () => c.carrying === body && !c.carryTransition && !c.pendingAbility);
    assert.equal(c.carryMode, mode, role);
    const ok = c.issue({ type: 'move', x: top.x, z: top.z });
    if (mode === 'drag') {
      assert.equal(ok, false, 'the drag up the stairs is refused');
      assert.ok(msgs.some((t) => /drag a man on the stairs/.test(t)), `told why (${msgs})`);
      assert.ok(c.issue({ type: 'move', x: a.x + 1, z: a.z }), 'dragging on the flat is still fine');
    } else {
      assert.ok(ok, 'carried up the stairs on the shoulder');
      s.run(25, () => !c.path);
      assert.ok(c.y > 7, `up on the crest with him (${c.y.toFixed(2)})`);
      assert.equal(c.carrying, body);
    }
  }
});
