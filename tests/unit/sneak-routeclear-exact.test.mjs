/**
 * sneak.mjs routeClear (the solutions' "would anyone see him on this way?" — every crawl hop's wait asks it each tick)
 * was made cheaper for the M16 perf pass: a viewer's mirror refreshed once for his looks, a post's out-of-reach points
 * and the points outside every heading he may face skipped once per point (not at each of the moments tried), the
 * dummies made once per point, walkerSees' head reaches worked out only for the heads that need them, headsOf without
 * temporary arrays. It must answer exactly what the old code answered — true / false and the same first sighting (the
 * `why` entry) — and walkerSees / staticSees likewise: the solutions decide on them, and a run must stay the same tick
 * for tick. Random worlds of posts (sweeping, turned aside, with post headings), walkers on beats (halted or under way,
 * with looks), a three-man file, cries and turns on and off; each question asked of the old copy
 * (fixtures/sneak-routeclear-ref.mjs) and of the live code, the clock moving on between batches.
 */
import { test, assert } from './lib.mjs';
import { routeClear, routeClearGen, walkerSees, staticSees, predict } from '../../tools/solutions/sneak.mjs';
import { refRouteClear, refWalkerSees, refStaticSees } from './fixtures/sneak-routeclear-ref.mjs';

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const frac = (x) => x - Math.floor(x);
/** A pure line of sight: blocked for some cell pairs (by a hash of the ends' cells and the target's height). */
const los = (x0, z0, x1, z1, o) => frac(Math.sin(Math.floor(x0 / 3) * 12.9898 + Math.floor(z0 / 3) * 78.233 + Math.floor(x1 / 2) * 37.719 + Math.floor(z1 / 2) * 4.581 + (o?.targetLow ? 9.1 : 0)) * 43758.5453) > 0.25;

function world(r) {
  const byId = new Map();
  const w = { time: 0, enemies: [], vehicles: [], entities: [], interactables: [], ai: { squads: new Map() }, mission: { rules: {} },
    grid: { version: 1, elevAt: (x, z) => (frac(Math.sin(Math.floor(x) * 3.1 + Math.floor(z) * 7.7) * 99) < 0.1 ? 0.6 : 0), lineOfSight: los },
    byId: (id) => byId.get(id) };
  if (r() < 0.5) w.sneakSweepSteps = r() < 0.5 ? 4 : 2;
  if (r() < 0.3) w.sneakHaltExact = 0.4;
  if (r() < 0.4) w.sneakTurns = true;
  if (r() < 0.3) w.sneakCries = [{ t: 0, x: 30 + r() * 40, z: 30 + r() * 40, r: 25 }];
  w._add = (e) => { e.id = e.id ?? `u${byId.size + 1}`; byId.set(e.id, e); w.enemies.push(e); w.entities.push(e); return e; };
  return w;
}
const vision = (r) => ({ far: 30 + r() * 10, fov: 1.2 + r() * 0.8, elliptical: r() < 0.5, ellipseRatio: 0.55, near: 12, eyeHeight: 1.6, sweep: r() < 0.6 ? 0.5 + r() * 0.5 : 0, period: 4 + r() * 4, phase: r() * 3 });
function brainOf(e, r, R) {
  return { state: 'IDLE', routeIndex: Math.floor(r() * (R?.length || 1)), routeDir: r() < 0.5 ? 1 : -1, _routeType: r() < 0.5 ? 'LOOP' : 'PINGPONG', _loopStart: 0, atWait: false, waitT: 0, _leader: () => null };
}
function post(w, r, tag) {
  const e = { tag, world: w, alive: true, removed: false, incapacitated: false, x: 20 + r() * 60, z: 20 + r() * 60, y: 0, heading: r() * 6.28 - 3.14, vision: vision(r), speed: 1 };
  e.sweepActive = !!e.vision.sweep && r() < 0.8; e.sweepAmp = e.vision.sweep; e.headOffset = r() < 0.3 ? (r() - 0.5) * 0.6 : 0; e.headCarry = 0;
  e.brain = brainOf(e, r, null);
  if (r() < 0.5) { e.post = { heading: e.heading + (r() < 0.5 ? 0 : (r() - 0.5) * 2) }; if (r() < 0.3) e.brain.noiseTurnT = 2; }
  return w._add(e);
}
function walker(w, r, tag, R = null) {
  R ??= Array.from({ length: 3 + Math.floor(r() * 3) }, () => ({ x: 15 + r() * 70, z: 15 + r() * 70, ...(r() < 0.6 ? { wait: 1 + r() * 12, ...(r() < 0.6 ? { look: Math.round(r() * 360 - 180) } : {}) } : {}) }));
  const e = { tag, world: w, alive: true, removed: false, incapacitated: false, route: R, vision: vision(r), speed: 0.9 + r() * 0.8, y: 0, sweepActive: false, headOffset: 0, headCarry: 0, path: null, pathIndex: 0 };
  e.sweepAmp = e.vision.sweep;
  e.brain = brainOf(e, r, R);
  const wp = R[e.brain.routeIndex];
  if (wp.wait && r() < 0.5) { e.x = wp.x; e.z = wp.z; e.heading = r() * 6.28 - 3.14; e.brain.atWait = true; e.brain.waitT = r() * wp.wait; e.isMoving = false; }
  else { e.x = wp.x + (r() - 0.5) * 30; e.z = wp.z + (r() - 0.5) * 30; e.heading = Math.atan2(wp.z - e.z, wp.x - e.x); e.isMoving = true; }
  return w._add(e);
}
/** A three-man file: a walking leader and two men keeping their offset to him (predict's squad branch; wheeling). */
function file(w, r, k) {
  const lead = walker(w, r, `f${k}a`), id = `sq${k}`, men = [lead];
  lead.squad = { id };
  for (let i = 1; i <= 2; i++) {
    const m = walker(w, r, `f${k}${'abc'[i]}`, lead.route);
    m.x = lead.x - Math.cos(lead.heading) * 1.5 * i; m.z = lead.z - Math.sin(lead.heading) * 1.5 * i; m.heading = lead.heading;
    m.isMoving = lead.isMoving; m.brain.atWait = false; m.squad = { id }; m.brain._leader = () => lead; men.push(m);
  }
  lead.brain._leader = () => lead;
  w.ai.squads.set(id, { members: new Set(men) });
}
/** Move everyone on a little and the clock with them (the questions of the next batch see a new moment). */
function advance(w, r) {
  const dt = 0.25 + r() * 2;
  w.time += dt;
  for (const e of w.enemies) {
    if (e.isMoving) { e.x += Math.cos(e.heading) * e.speed * dt; e.z += Math.sin(e.heading) * e.speed * dt; }
    if (!e.route) { if (r() < 0.3) e.heading += (r() - 0.5) * 0.8; continue; }
    if (e.brain.atWait) e.brain.waitT = Math.max(0, e.brain.waitT - dt);
  }
}
const modes = ['crawl', 'walk', 'crawl', 'boat'];
function question(r, w, viewers) {
  const from = [15 + r() * 70, 15 + r() * 70], pts = [];
  for (let k = 0, n = 1 + Math.floor(r() * 3); k < n; k++) pts.push([from[0] + (r() - 0.5) * 40, from[1] + (r() - 0.5) * 40]);
  const o = { mode: modes[Math.floor(r() * modes.length)], from, speed: r() < 0.5 ? undefined : 0.7 + r() * 1.5, delay: r() * 3, step: 0.75,
    slack: [0, 0.5, 0.6, 1, 1.2][Math.floor(r() * 5)], slackRate: r() < 0.2 ? 0.05 : 0, hold: r() < 0.4 ? Math.floor(r() * 12) / 2 : 0,
    keepWalker: r() < 0.5 ? 4 : 0, pad: [0, 0.6, 1.5][Math.floor(r() * 3)], wheel: r() < 0.8 };
  if (r() < 0.2) o.except = [viewers[Math.floor(r() * viewers.length)]];
  return [pts, o];
}

test('routeClear / walkerSees / staticSees: the same answers as the old code, number for number', () => {
  let n = 0, seen = 0, clear = 0, ws = 0, wsYes = 0, ss = 0, ssYes = 0, sliced = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed * 7919), w = world(r), D = { world: w };
    for (let i = 0; i < 4; i++) post(w, r, `p${i}`);
    for (let i = 0; i < 4; i++) walker(w, r, `w${i}`);
    file(w, r, 1);
    for (let batch = 0; batch < 6; batch++) {
      for (let k = 0; k < 6; k++) {
        const [pts, o] = question(r, w, w.enemies);
        const whyA = [], whyB = [];
        const a = refRouteClear(D, pts, { ...o, why: whyA }), b = routeClear(D, pts, { ...o, why: whyB });
        if (b !== a || whyB.join() !== whyA.join()) {
          assert.fail(`seed ${seed} batch ${batch} q ${k}: ${b} [${whyB}] vs old ${a} [${whyA}] for ${JSON.stringify({ ...o, except: o.except?.map((e) => e.tag) })} ${JSON.stringify(pts)}`);
        }
        n++; if (a) clear++; else seen++;
        // (the generator driven one yield at a time: the same answer)
        if (k % 3 === 0) {
          const it = routeClearGen(D, pts, { ...o, why: [] });
          let s; do { s = it.next(); sliced++; } while (!s.done);
          if (s.value !== a) assert.fail(`seed ${seed}: sliced ${s.value} vs ${a}`);
        }
      }
      // walkerSees and staticSees asked directly, each guard at a few moments and points
      for (const e of w.enemies) {
        for (let k = 0; k < 8; k++) {
          const t = r() * 20, d = { x: e.x + (r() - 0.5) * 70, z: e.z + (r() - 0.5) * 70, y: 0, isLow: r() < 0.5, isVisibleToEnemies: true, alive: true, kind: 'commando' };
          if (e.route) {
            const q = predict(e, t), A = refWalkerSees(e, q, d, w, w.time + t), B = walkerSees(e, q, d, w, w.time + t);
            if (B !== A) assert.fail(`seed ${seed}: walkerSees ${e.tag} +${t.toFixed(2)}: ${B} vs old ${A}`);
            ws++; if (A) wsYes++;
          } else {
            const A = refStaticSees(e, d, w, t), B = staticSees(e, d, w, t);
            if (B !== A) assert.fail(`seed ${seed}: staticSees ${e.tag} +${t.toFixed(2)}: ${B} vs old ${A}`);
            ss++; if (A) ssYes++;
          }
        }
      }
      advance(w, r);
    }
  }
  // (both answers well represented: the comparison means something)
  assert.ok(seen > 200 && clear > 50, `routeClear answers: ${seen} seen, ${clear} clear of ${n}`);
  assert.ok(wsYes > 50 && ws - wsYes > 50 && ssYes > 50 && ss - ssYes > 50, `walkerSees ${wsYes}/${ws} yes, staticSees ${ssYes}/${ss} yes`);
  assert.ok(sliced > n, `sliced steps ${sliced}`);
});

test('routeClear: a walker whose whole beat lies out of reach of a point is skipped there only when every look would be', () => {
  // (one walker or one file on a bare plain, every sight line open, the way laid round the edge of their reach: the
  // looks that decide lie at the edge of the beat's box — where it stands now, the points of its beat, a file man's
  // offset from his leader — and the answer must still be the old code's)
  let n = 0, seen = 0, edge = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const r = rng(seed * 104729), w = world(r), D = { world: w };
    delete w.sneakCries; delete w.sneakTurns;
    w.grid.lineOfSight = () => true;
    // (wide cones, some all round: whether a point is seen then turns on how near he comes to it — where he stands now,
    // the points of his beat, a file man's place off his leader's beat: the edges of the box reachBox draws)
    const fov = r() < 0.5 ? 2.4 : 6.2;
    let men;
    if (r() < 0.5) { const e = walker(w, r, 'w0'); e.vision.elliptical = false; e.vision.fov = fov; men = [e]; if (r() < 0.5) { e.x += (r() - 0.5) * 30; e.z += (r() - 0.5) * 30; } }
    else {
      file(w, r, 1); men = w.enemies;
      for (const m of men.slice(1)) { m.x += (r() - 0.5) * 16; m.z += (r() - 0.5) * 16; }
      for (const m of men) { m.vision.elliptical = false; m.vision.fov = fov; }
      if (r() < 0.5) men[0].vision = null; // (a blind leader: only his men see — and they are where he goes, offset)
    }
    // a way past the edge of one man's reach: its points ~far from a point of his beat, from where he stands now, or (a
    // file man) from a point of his beat shifted by his place behind his leader
    const eyes = men.filter((m) => m.vision), e = eyes[Math.floor(r() * eyes.length)], far = e.vision.far + 1, lead = men[0], pick = r();
    const W = e.route[Math.floor(r() * e.route.length)];
    const P = pick < 0.34 ? W : pick < 0.67 ? { x: e.x, z: e.z } : { x: W.x + (e.x - lead.x), z: W.z + (e.z - lead.z) };
    const a = r() * 6.283, d0 = far + (r() - 0.5) * 8;
    const from = [P.x + Math.cos(a) * d0, P.z + Math.sin(a) * d0], pts = [[from[0] + (r() - 0.5) * 12, from[1] + (r() - 0.5) * 12]];
    const o = { mode: r() < 0.5 ? 'crawl' : 'walk', from, delay: r() * 2, slack: 0.5, pad: r() < 0.5 ? 0.6 : 0, keepWalker: 0, hold: r() < 0.3 ? 3 : 0 };
    for (let k = 0; k < 4; k++) {
      const whyA = [], whyB = [];
      const A = refRouteClear(D, pts, { ...o, why: whyA }), B = routeClear(D, pts, { ...o, why: whyB });
      if (B !== A || whyB.join() !== whyA.join()) assert.fail(`seed ${seed} k ${k}: ${B} [${whyB}] vs old ${A} [${whyA}]`);
      n++; if (!A) { seen++; if (Math.abs(Math.hypot(from[0] - P.x, from[1] - P.z) - far) < 6) edge++; }
      advance(w, r);
    }
  }
  assert.ok(seen > 100 && n - seen > 100 && edge > 30, `${seen} seen of ${n} (${edge} at the edge of reach)`);
});

test('routeClear: a file man is seen where his leader\'s way, shifted by his place, takes him — outside his own beat\'s box', () => {
  // (a blind leader walking (40,50) <-> (60,50); his man 12 m off him diagonally, an all-round cone of 20 m: ten seconds on
  // he stands at (72,62), 10 m past every point of the beat and past where he stands now; a point 19 m beyond is his)
  let cases = 0;
  for (const [ox, oz, dx, dz] of [[12, 12, 1, 0], [-12, 12, 0, 1], [12, -12, 1, -0.2], [-12, -12, -0.3, -1]]) {
    const w = world(rng(1)), D = { world: w };
    delete w.sneakCries; delete w.sneakTurns; delete w.sneakHaltExact; delete w.sneakSweepSteps;
    w.grid.lineOfSight = () => true;
    const R = [{ x: 60, z: 50 }, { x: 40, z: 50 }];
    const mk = (tag, x, z) => w._add({ tag, world: w, alive: true, removed: false, incapacitated: false, route: R, speed: 1, x, z, y: 0, heading: 0, isMoving: true, path: null, pathIndex: 0,
      sweepActive: false, headOffset: 0, headCarry: 0, squad: { id: 'sq' },
      vision: { far: 20, fov: 6.2, elliptical: false, near: 8, eyeHeight: 1.6, sweep: 0, period: 4, phase: 0 } });
    const lead = mk('lead', 50, 50), man = mk('man', 50 + ox, 50 + oz);
    lead.vision = null;
    for (const m of [lead, man]) m.brain = { state: 'IDLE', routeIndex: 0, routeDir: 1, _routeType: 'PINGPONG', _loopStart: 0, atWait: false, waitT: 0, _leader: () => lead };
    w.ai.squads.set('sq', { members: new Set([lead, man]) });
    // where he is at +10 s: the leader at (60,50), he at (60+ox, 50+oz); the point 19 m on from there, outward
    const L = Math.hypot(dx, dz), px = 60 + ox + (dx / L) * 19, pz = 50 + oz + (dz / L) * 19;
    const q = predict(man, 10);
    assert.ok(Math.hypot(q.x - (60 + ox), q.z - (50 + oz)) < 0.05, `he is where his leader's way takes him: (${q.x.toFixed(2)},${q.z.toFixed(2)})`);
    const o = { mode: 'walk', from: [px, pz], delay: 10, slack: 0.5, pad: 0, keepWalker: 0 };
    const whyA = [], whyB = [];
    const A = refRouteClear(D, [[px, pz]], { ...o, why: whyA }), B = routeClear(D, [[px, pz]], { ...o, why: whyB });
    assert.equal(A, false, `the old code sees him at (${px.toFixed(1)},${pz.toFixed(1)})`);
    assert.equal(B, A, `seen from his place off the beat: ${whyB} vs old ${whyA}`);
    assert.equal(whyB.join(), whyA.join());
    cases++;
  }
  assert.equal(cases, 4);
});
