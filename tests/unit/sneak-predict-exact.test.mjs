/**
 * sneak.mjs predict (the solutions' look-ahead: where a guard will be and face t s from now) was made cheaper for the
 * M15 perf pass — each guard's beat laid out once per sim time (routeOf), the file men's walk back along their leader's
 * way on per-tick tables (leadPt / leadSeg), their rank without arrays (mateIndex) — and must answer exactly what the
 * old code answered: the solutions decide on it, and a run must stay the same tick for tick. Here both are asked the same
 * questions in the same order over random beats (loops, ping-pong, halts with looks, paths per leg or straight, a man
 * halted or under way, back to his beat), five-man files behind a walking or halted leader (a flipped file, breadcrumbs),
 * the clock moving on between batches, and every answer must be the same number for number.
 */
import { test, assert } from './lib.mjs';
import { predict } from '../../tools/solutions/sneak.mjs';
import { predictRef } from './fixtures/sneak-predict-ref.mjs';

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** A world: grid version, squads, a findPath laying a leg as 1-3 kinked stretches (the pathfinder's corners). */
function world(r, o = {}) {
  const w = { time: 0, grid: { version: 1 }, ai: { squads: new Map() }, sneakPaths: !!o.paths, sneakTrail: !!o.trail, sneakReturnOn: !!o.returnOn };
  // (a pure function of the ends, as the real one is for a grid version: both predictors' memos ask it)
  w.findPath = (x0, z0, x1, z1) => {
    const h = rng(Math.floor(x0 * 977 + z0 * 131 + x1 * 37 + z1 * 7) >>> 0), n = 1 + Math.floor(h() * 3), out = [{ x: x0, z: z0 }];
    for (let k = 1; k < n; k++) { const f = k / n; out.push({ x: x0 + (x1 - x0) * f + (h() - 0.5) * 3, z: z0 + (z1 - z0) * f + (h() - 0.5) * 3 }); }
    out.push({ x: x1, z: z1 });
    return out;
  };
  return w;
}

function route(r, n) {
  const pts = [];
  let x = r() * 60, z = r() * 60;
  for (let i = 0; i < n; i++) {
    x += (r() - 0.5) * 30; z += (r() - 0.5) * 30;
    const wp = { x, z };
    if (r() < 0.6) wp.wait = r() < 0.2 ? 0.05 + r() * 0.2 : 1 + r() * 25;
    if (wp.wait && r() < 0.7) wp.look = Math.round(r() * 360 - 180);
    pts.push(wp);
  }
  return pts;
}

/** A guard on his beat: under way between two points, or halted at one (`atWait`, waitT left), or walking back. */
function guard(r, w, R, { state = 'IDLE', squad = null } = {}) {
  const loop = r() < 0.5, i = Math.floor(r() * R.length), wp = R[i];
  const e = { world: w, route: R, speed: 0.8 + r() * 1.2, squad, spawn: {}, alive: true, removed: false, isMoving: false, path: null, pathIndex: 0 };
  e.pathQuery = () => ({});
  e.brain = { state, routeIndex: i, routeDir: r() < 0.5 ? 1 : -1, _routeType: loop ? 'LOOP' : 'PINGPONG', _loopStart: 0, atWait: false, waitT: 0,
    _leader: () => null,
    _mates(lead) { const sq = w.ai.squads.get(e.squad.id); const out = [...sq.members].filter((m) => m.alive && m !== lead && !m.removed); return sq.flip ? out.reverse() : out; } };
  if (wp.wait > 0 && r() < 0.5) {
    // halted at point i (exactly on it, or a step short: the halt record)
    e.x = wp.x + (r() < 0.5 ? 0 : (r() - 0.5)); e.z = wp.z + (r() < 0.5 ? 0 : (r() - 0.5));
    e.heading = r() * 6.28 - 3.14; e.brain.atWait = true; e.brain.waitT = r() * wp.wait;
  } else {
    // walking to point i from somewhere short of it, his present path ending on it (or no path: straight)
    e.x = wp.x + (r() - 0.5) * 20; e.z = wp.z + (r() - 0.5) * 20; e.heading = Math.atan2(wp.z - e.z, wp.x - e.x);
    e.isMoving = true;
    if (r() < 0.7) { e.path = w.findPath(e.x, e.z, wp.x, wp.z).slice(1); e.pathIndex = 0; }
  }
  if (state === 'RETURN') { e.isMoving = true; e.path = [{ x: e.x + 5, z: e.z - 3 }, { x: wp.x + 0.5, z: wp.z }]; e.pathIndex = 0; }
  return e;
}

/** A leader and his file of `n` (squad record with breadcrumbs; flipped or not). */
function file(r, w, R, n, id) {
  const sq = { id, members: new Set(), flip: r() < 0.3, trail: [] };
  w.ai.squads.set(id, sq);
  const lead = guard(r, w, R, { squad: { id, columns: 1 } });
  sq.members.add(lead);
  for (let k = 0; k < 6; k++) sq.trail.push({ x: lead.x - k * 0.7 * Math.cos(lead.heading), z: lead.z - k * 0.7 * Math.sin(lead.heading) });
  const men = [];
  for (let k = 0; k < n; k++) {
    const m = guard(r, w, R, { squad: { id, columns: 1 } });
    m.x = lead.x - (k + 1) * 1.2 * Math.cos(lead.heading); m.z = lead.z - (k + 1) * 1.2 * Math.sin(lead.heading);
    m.brain.state = lead.brain.state; m.brain._leader = () => lead;
    if (k === 2 && r() < 0.3) m.alive = false; // (a dead man drops out of the file)
    sq.members.add(m); men.push(m);
  }
  lead.brain._leader = () => lead;
  return { lead, men };
}

const SAME = (a, b) => (a === b) || (Number.isNaN(a) && Number.isNaN(b));
function same(p, q, what) {
  for (const k of new Set([...Object.keys(p), ...Object.keys(q)])) {
    if (!SAME(p[k], q[k])) throw new Error(`${what}: ${k} ${p[k]} vs ${q[k]} (${JSON.stringify(p)} vs ${JSON.stringify(q)})`);
  }
}

/** Ask both predictors the same questions in the same order (each keeps its own memos and halt records). */
function compare(r, w, guards, label) {
  let n = 0;
  for (let batch = 0; batch < 6; batch++) {
    const ts = [0, 1e-9, 0.05, 0.1, 30, 30.000001, 29.95];
    for (let k = 0; k < 40; k++) ts.push(r() * 95);
    for (let k = 0; k < 10; k++) ts.push(ts[Math.floor(r() * ts.length)]); // (the same look twice: the memos)
    for (const t of ts) for (const e of guards) { same(predict(e, t), predictRef(e, t), `${label} b${batch} ${e.tag} t=${t}`); n++; }
    w.time += 0.2; // (the next check: a new sim time, every memo afresh)
    if (r() < 0.3) w.grid.version++;
  }
  return n;
}

test('predict: the same answers as before, number for number (lone walkers, halts, loops / ping-pong, paths or straight)', () => {
  let n = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const r = rng(seed), w = world(r, { paths: seed % 2 === 0, returnOn: seed % 3 === 0 });
    const R = route(r, 2 + Math.floor(r() * 6));
    const guards = [];
    for (let k = 0; k < 4; k++) { const g = guard(r, w, R, { state: k === 3 && seed % 4 === 0 ? 'RETURN' : 'IDLE', squad: { id: `s${seed}_${k}` } }); g.tag = `g${k}`; guards.push(g); }
    for (const g of guards) w.ai.squads.set(g.squad.id, { id: g.squad.id, members: new Set([g]), flip: false, trail: [] });
    n += compare(r, w, guards, `seed ${seed}`);
  }
  assert.ok(n > 50000, `${n} answers compared`);
});

test('predict: five-man files (sneakTrail) behind a walking or halted leader, flipped, a dead man, breadcrumbs', () => {
  let n = 0;
  for (let seed = 101; seed <= 160; seed++) {
    const r = rng(seed), w = world(r, { paths: seed % 2 === 0, trail: true });
    const R = route(r, 2 + Math.floor(r() * 5));
    const { lead, men } = file(r, w, R, 4, `f${seed}`);
    lead.tag = 'lead'; men.forEach((m, k) => { m.tag = `m${k}`; });
    n += compare(r, w, [lead, ...men], `seed ${seed}`);
  }
  assert.ok(n > 50000, `${n} answers compared`);
});
