/**
 * M05 "Blind Justice" (the radar above Herdla): a full stealth solution, played only with player orders.
 * Driver API: tools/solutions/driver.mjs; sneaking helpers: tools/solutions/sneak.mjs. Reference run, in the real
 * game: node tools/solutions/run-browser.mjs m05 (also tests/m05-solution.test.mjs). Walkthrough: m05.walkthrough.mjs.
 *
 * Route B of the dossier (docs/missions/m05.md §12). The Green Beret knifes e4 behind the start house. The Spy crawls
 * the valley rim behind e3's back to the clothesline behind e8, takes the uniform and injects e8, then holds the camp
 * patrol in talk while the Green Beret crawls the same way round the rim, S through the camp behind the patrol's back
 * and along the foot of the massif. The Spy walks to the lower station in uniform and rides the cable car up past the
 * lift guards (an officer riding the lift raises no eyebrows); on the summit he injects e14, e15, e16 and e17 one by
 * one, then holds Patrol 18 in talk at the north end of its beat. The Green Beret climbs the east cliff behind Patrol
 * 19's back, carries drum b2 into the middle of the summit and climbs into the autogyro. The Spy lets the patrol go on
 * to the south end of its beat, beside drum b1 at the barracks, and shoots b1: the barracks goes up, and the patrol
 * with it (o2); then b2, which wrecks the radar (o1). The one officer who gets out of the ruins goes from body to
 * body; the Spy, in uniform, walks to the autogyro, climbs in when the officer is out of sight, and it lifts off (o3).
 *
 * Wins with every objective done, 0 detections and 0 exposures (the driver's exposure watch), headless and in the
 * browser. The only alarm is the one the first blast sounds: on this map every explosion is heard everywhere and the
 * whole map is one alarm zone, and only a drum's blast brings down the radar. Before it nobody finds a body, follows
 * tracks or searches.
 */
import { CONFIG } from '../../src/config.js';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { sneak, clearFor, routeClear, unwitnessed, bodySeen, viewersOf, walking, predict } from './sneak.mjs';

const DBG = !!(globalThis.process?.env?.M05DBG || globalThis.__M3DBG);
/** (dev) stop the run right after this checkpoint id */
const STOP = globalThis.process?.env?.M05STOP;
const dbg = (D, s) => { if (DBG) D.log(`DBG ${D.t.toFixed(1)} ${s}`); };

/** crawl to (x, z) on a space-time plan (he waits only where nobody looks) */
async function crawl(D, role, x, z, o = {}) {
  await cautious(D, () => sneak(D, x, z, { mode: 'crawl', role, box: 10, label: `${role} → (${x},${z})`, ...o }));
}

/** run `fn` with the planners' cautious walker model: a walker turning at the end of his beat sweeps his eyes across */
async function cautious(D, fn) {
  const w = D.world, prev = w.sneakTurns;
  w.sneakTurns = true;
  try { return await fn(); } finally { w.sneakTurns = prev; }
}

/** The way a man ordered from `from` to each of `pts` in turn really walks (the game's path for each leg), memoised. */
const _ways = new Map();
function carryWay(D, role, from, pts) {
  const key = `${role}|${from.map((v) => Math.round(v * 2)).join(',')}|${pts.flat().join(',')}`;
  let out = _ways.get(key);
  if (out) return out;
  out = [];
  let at = from;
  for (const [x, z] of pts) {
    const p = D.world.findPath(at[0], at[1], x, z, { role }) || [{ x, z }];
    for (const n of p) out.push([n.x, n.z]);
    at = [x, z];
  }
  if (_ways.size > 64) _ways.clear();
  _ways.set(key, out);
  return out;
}

/**
 * A silent kill and the body carried away (as M11): `role` ('greenberet' knife, 'spy' syringe) kills `tag` once nobody
 * sees the blow, the body or the killer, and the carry to `stash` stays unseen too; `stash` may list several places
 * (the first nobody will see a body lying in for ten minutes).
 */
async function kill(D, role, tag, stash, { strict = false, when = () => true, maxWait = 300, carry = true, label = tag, via = [], approach = null } = {}) {
  const e = D.get(tag), u = D.c(role);
  if (carry && Array.isArray(stash[0])) {
    const w = D.world, prev = w.sneakTurns;
    w.sneakTurns = true; // (a walker turning at the end of his beat sweeps his eyes across)
    try { stash = stash.find(([x, z]) => !bodySeen(D, x, z, 600, { step: 0.5, except: [e] }).length) ?? (() => { throw new Error(`${tag}: every stash is seen [${stash.map(([x, z]) => bodySeen(D, x, z, 600, { step: 0.5, except: [e] })).join(' | ')}]`); })(); }
    finally { w.sneakTurns = prev; }
  }
  const SP = CONFIG.units.carry ?? 1.6, PICK = CONFIG.abilities.carry?.pick ?? 1.0;
  const why = [];
  let next = 0;
  const upright = Object.create(u, { isLow: { value: false } });
  let nlog = 0, apNow = null;
  await D.until(() => {
    if (D.t < next) return false;
    next = D.t + 0.25;
    if (DBG && why.length && why[0] !== 'when' && D.t > nlog) { nlog = D.t + 1; dbg(D, `  ${tag} not yet: ${why.slice(0, 4).join(' ')}`); }
    why.length = 0;
    if (!when()) { why.push('when'); return false; }
    // (`approach`: he first walks these points up to the victim — unseen all the way, the victim's own cone included —
    // and strikes at the end: the checks below then hold for that moment)
    let ta = 0;
    if (approach) {
      apNow = typeof approach === 'function' ? approach() : approach;
      if (!apNow) { why.push('no approach'); return false; }
      const approach_ = apNow;
      const rise = u.stance === 'crawl' ? 0.6 : 0;
      let [x, z] = [u.x, u.z];
      ta = 0.2 + rise;
      for (const [px, pz] of approach_) { ta += Math.hypot(px - x, pz - z) / 2.0; x = px; z = pz; }
      for (const sp of [1.7, 2.4]) if (!routeClear(D, approach_, { mode: 'walk', from: [u.x, u.z], speed: sp, delay: 0.2 + rise, hold: 1.5, slack: 0.5, pad: 0.6, why })) return false;
      const q = { x, z, heading: e.heading };
      const at = { x: e.x, z: e.z };
      const posts = viewersOf(D.world).filter((v) => !walking(v));
      const killer = Object.create(u, { isLow: { value: false }, x: { value: q.x }, z: { value: q.z } });
      if (!unwitnessed(D, at, killer, { at: ta, ahead: 1.6, strict, why, except: [e] }) || !unwitnessed(D, at, killer, { at: ta, ahead: 1.6, strict: true, except: [e, ...posts], why })) { why.push('witness'); return false; }
      if (carry && !routeClear(D, carryWay(D, role, [e.x, e.z], [...via, stash]), { mode: 'walk', from: [e.x, e.z], speed: SP * 0.9, delay: ta + 2.4 + PICK, hold: 1.5, slack: 0.8, why, except: [e], keepWalker: 2 })) return false;
      return true;
    }
    const back = Math.abs(Math.atan2(Math.sin(Math.atan2(u.z - e.z, u.x - e.x) - e.heading), Math.cos(Math.atan2(u.z - e.z, u.x - e.x) - e.heading)));
    if (back < (95 * Math.PI) / 180 || canSee(e, upright, D.world, { ignoreDisguise: true }) !== 'none') { why.push('victim faces him'); return false; }
    const posts = viewersOf(D.world).filter((v) => !walking(v));
    if (!unwitnessed(D, e, upright, { ahead: 1.6, strict, why }) || !unwitnessed(D, e, upright, { ahead: 1.6, strict: true, except: posts, why })) { why.push('witness'); return false; }
    if (carry && !routeClear(D, carryWay(D, role, [e.x, e.z], [...via, stash]), { mode: 'walk', from: [e.x, e.z], speed: SP * 0.9, delay: 2.4 + PICK, hold: 1.5, slack: 0.8, why, except: [e], keepWalker: 2 })) return false;
    return true;
  }, maxWait, `a window to kill ${label}`).catch((err) => { throw new Error(`${err.message} [${why.join(' ')}]`); });
  dbg(D, `kill ${tag} by ${role} at (${e.x.toFixed(1)},${e.z.toFixed(1)})`);
  if (approach) {
    await D.stance(role, 'stand');
    for (const [x, z] of apNow) await D.go(role, x, z, { tol: 0.4, max: 20 });
  }
  D.ability(role, role === 'spy' ? 'syringe' : 'knife', e);
  await D.until(() => !e.alive, 8, `${tag} killed`);
  await D.idle(role, 6);
  if (!carry) return;
  D.ability(role, 'hand', e);
  await D.until(() => !!u.carrying, 6, `${role} lifts ${tag}`);
  const pts = [...via, stash];
  for (let k = 0; k < pts.length; k++) await D.go(role, pts[k][0], pts[k][1], { tol: k === pts.length - 1 ? 0.8 : 1.0, max: 60 });
  D.ability(role, 'drop');
  await D.until(() => !u.carrying && !u.currentAction, 6, `${role} puts ${tag} down`);
}


/** Distance from (x, z) to the segment a→b. */
function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
}

/**
 * Crawl (or walk / run) along `pts` (one straight run per point) once nobody would see him anywhere on the way, as the
 * cones are predicted while he passes (routeClear, at a slow and a quick crawl), nor at its end for `hold` s (as M16).
 */
async function hop(D, role, pts, { hold = 6, pad = 0.6, slack = 0.6, maxWait = 300, label = `${role} → (${pts.at(-1)})`, standAtEnd = false, ready = null, mode = 'crawl' } = {}) {
  const u = D.c(role), end = pts[pts.length - 1];
  const why = [];
  let next = 0;
  await D.until(() => {
    if (D.t < next) return false;
    next = D.t + 0.1;
    why.length = 0;
    if (ready && !ready()) { why.push('not ready'); return false; }
    const run = mode === 'run', walk = run || mode === 'walk', md = walk ? 'walk' : 'crawl';
    const speeds = run ? [4.5] : walk ? [2.25] : [0.75, 1.0];
    if (run) for (const e of D.world.enemies) if (e.alive && !e.removed && pts.some(([px, pz]) => segDist(e.x, e.z, u.x, u.z, px, pz) < 14)) { why.push(`${e.tag} would hear`); return false; }
    const rise = walk && u.stance === 'crawl' ? 0.6 : !walk && u.stance !== 'crawl' ? 0.5 : 0;
    for (const v of speeds) if (!routeClear(D, pts, { mode: md, from: [u.x, u.z], speed: v, delay: 0.2 + rise, slack, why, pad })) { if (DBG && ready) dbg(D, `${label}: ready, route not clear at ${v}: ${why.slice(0, 3).join(' ')}`); return false; }
    let t = 0.2 + rise, [x, z] = [u.x, u.z];
    for (const [px, pz] of pts) { t += Math.hypot(px - x, pz - z) / speeds[0]; x = px; z = pz; }
    for (let k = 0; k <= hold; k += 0.5) if (!routeClear(D, [end], { mode: standAtEnd || walk ? 'walk' : 'crawl', from: end, delay: t + k, slack: 0, why, pad })) { if (DBG && ready) dbg(D, `${label}: ready, end not clear at +${(t + k).toFixed(1)}: ${why.slice(0, 3).join(' ')}`); return false; }
    return true;
  }, maxWait, `${label} clear`).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
  dbg(D, `${label}: go`);
  await D.stance(role, mode === 'walk' || mode === 'run' ? 'stand' : 'crawl');
  for (const [x, z] of pts) await D.go(role, x, z, { tol: 0.5, max: 120, run: mode === 'run' });
}

/**
 * The first living enemy who sees `u` as a man, his uniform aside (a disguised Spy drawing or firing a pistol), now or
 * over the next `ahead` s (walkers as predicted, posts with their sweep), or null. `except`: men who do not count.
 */
function eyesOn(D, u, { ahead = 1.2, except = [] } = {}) {
  const w = D.world, man = Object.create(u, { disguised: { value: false } });
  for (const e of w.enemies) {
    if (!e.alive || e.removed || !e.vision || e.incapacitated || except.includes(e)) continue;
    for (let t = 0; t <= ahead + 1e-6; t += 0.2) {
      const q = walking(e) ? predict(e, t) : { x: e.x, z: e.z, heading: e.heading };
      const g = Object.create(e, { x: { value: q.x }, z: { value: q.z }, heading: { value: q.heading } });
      if (canSee(g, man, w, { cone: coneAt(g, w.time + t) }) !== 'none') return e;
    }
  }
  return null;
}

/** A clear line of sight from `e` standing at `q` to a man standing at (x, z) (his cone turned straight at him). */
function lineOfSight(D, e, q, x, z, brg) {
  const g = Object.create(e, { x: { value: q.x }, z: { value: q.z }, heading: { value: brg }, sweepActive: { value: false }, headOffset: { value: 0 }, headCarry: { value: 0 } });
  return canSee(g, { x, z, y: 0, isLow: false, kind: 'commando', alive: true, isVisibleToEnemies: true }, D.world) !== 'none';
}

/**
 * No walker of `tags` (alive) can see a man standing where `track` puts him ([[t, x, z]…], t in s from now; or a list of
 * points he stands at throughout `dur` s), whatever way the walker's head turns: his body as predicted (every 0.25 s; at
 * a halt also the way he came), his head anywhere within its sweep (a halt's look, ±50°; walking, a few degrees), his
 * cone's aperture round it and its reach that way (§4.2: the reach is the ellipse's along the head's turn), and a clear
 * line of sight. A check that does not trust the phase of a walker's look at a halt or at a turn, a squad man's above all.
 */
/** Every walker and patrol man on the map (alive, on a beat): for walkersAway. */
const WALKERS = (D) => D.world.enemies.filter((e) => e.alive && !e.removed && (e.route?.length ?? 0) > 1).map((e) => e.tag);

function walkersAway(D, tags, track, dur = 0, { haltSweep = 55, walkSweep = 8 } = {}) {
  const V = CONFIG.stealth.vision.soldier, a = V.far, b = a * (CONFIG.stealth.ellipseRatio ?? 1 / 3), half = (V.fov / 2) * Math.PI / 180;
  const farAt = (th) => (a * b) / Math.sqrt((b * Math.cos(th)) ** 2 + (a * Math.sin(th)) ** 2);
  const pts = track[0]?.length === 3 ? null : track, T = pts ? dur : track[track.length - 1][0];
  const at = (s) => { if (pts) return pts; let k = 0; while (k < track.length - 1 && track[k + 1][0] <= s) k++; return [[track[k][1], track[k][2]]]; };
  for (const t of tags) {
    const e = D.get(t);
    if (!e?.alive) continue;
    for (let s = 0; s <= T + 1e-6; s += 0.25) {
      const q = walking(e) ? predict(e, s) : { x: e.x, z: e.z, heading: e.heading };
      const q2 = walking(e) ? predict(e, s + 0.25) : q;
      const S = ((Math.hypot(q2.x - q.x, q2.z - q.z) < 0.05 ? haltSweep : walkSweep) * Math.PI) / 180;
      for (const [x, z] of at(s)) {
        const d = Math.hypot(x - q.x, z - q.z);
        if (d > a + 1) continue;
        const brg = Math.atan2(z - q.z, x - q.x);
        for (const h of q.alt != null ? [q.heading, q.alt] : [q.heading]) {
          const th = Math.max(0, Math.abs(Math.atan2(Math.sin(brg - h), Math.cos(brg - h))) - half); // (the least head turn that brings it in)
          if (th <= S && d <= farAt(th) + 1 && lineOfSight(D, e, q, x, z, brg)) return false;
        }
      }
    }
  }
  return true;
}

/** A man's track in time: `hold0` s at `pts[0]`, then along the rest at `speed` m/s, then `hold1` s at the end. */
function track(pts, speed, hold0 = 0, hold1 = 0) {
  const out = [[0, ...pts[0]]];
  let t = hold0, [x, z] = pts[0];
  out.push([t, x, z]);
  for (const [px, pz] of pts.slice(1)) {
    const L = Math.hypot(px - x, pz - z), n = Math.max(1, Math.ceil(L / (speed * 0.25)));
    for (let k = 1; k <= n; k++) out.push([t + (k * L) / (n * speed), x + ((px - x) * k) / n, z + ((pz - z) * k) / n]);
    t += L / speed; x = px; z = pz;
  }
  out.push([t + hold1, x, z]);
  return out;
}

/**
 * The rim strip E of the start house, between the valley drop and e3's lane: from its W end, which e3 never sees, to the
 * pines beyond his reach. e3 halts at the lane's E end looking E along it, and walking back E he sees it ahead: a man
 * crawls it in one go, setting off the moment e3 turns back W at that end (he walks away, halts at the W end looking
 * S, and is still far off when he comes back E).
 */
const STRIP = [[36, 20.6], [40.2, 22.2], [44.5, 23.8], [51.5, 29.5]];
async function crossStrip(D, role) {
  const e3 = D.get('e3');
  await crawl(D, role, 33, 18, { box: 6 });
  await hop(D, role, STRIP, { hold: 4, maxWait: 240, label: `${role} along the rim strip`,
    ready: () => !e3.alive || (!e3.brain?.atWait && Math.hypot(e3.x - 31.7, e3.z - 31.1) < 3 && Math.cos(e3.heading) < -0.5) });
}

/**
 * A side task (D.meanwhile): the Spy walks to `spot` and, the moment the patrol of `tag` (its sergeant) halts at `end`
 * of its beat, talks to him: the whole file stands facing him. `then()` runs at that moment (its checkpoint).
 * `held()`: talking now.
 */
function talkTo(D, tag, spot, end, then) {
  const spy = D.c('spy'), e = D.get(tag);
  let talking = false, sent = D.t;
  D.order('spy', { type: 'move', x: spot[0], z: spot[1] });
  D.meanwhile(() => {
    if (talking) return true;
    const there = Math.hypot(spy.x - spot[0], spy.z - spot[1]) < 1.2;
    if (!there && !spy.path && !spy.isMoving && D.t > sent + 1) { D.order('spy', { type: 'move', x: spot[0], z: spot[1] }); sent = D.t; }
    if (there && e.brain?.atWait && Math.hypot(e.x - end[0], e.z - end[1]) < 1) {
      D.ability('spy', 'distract', e); talking = true;
      then();
    }
    return talking;
  });
  return { held: () => talking && e.brain?.state === 'DISTRACTED' };
}
/** The Green Beret's way S through the camp, W of the woodshed and the headquarters, and E below the tents. */
const CAMP = [[47, 47.5], [43.2, 52], [42.3, 57.5], [44.5, 63.8], [50, 67.2], [58, 67]];

/** Drum b2's spot in the middle of the summit (dropped from 0.6 m south of it): 8.7 m from the dish's centre, so its
 *  blast (6.75 m) reaches the dish's footprint (r 3.75); 13.6 m from b1 (the two never set each other off). */
const DRUM_X = [90.5, 39];
/** Where the Spy shoots from: 12.5 m from b1 and 7.4 m from b2 (beyond both blasts' 6.75 m, within the pistol's
 *  13.5 m), NW of the barracks, behind Patrol 18 as it halts at b1 looking south. */
const SHOT = [85, 44];

export const STAGES = [
  ['A', 'The start house sentry', async (D) => {
    // e4 keeps watch E over the only way along the valley rim, from his post off the start house's NE corner. The Green
    // Beret crawls round the N side of the kennel and the handcart (low cover between him and e4) to the open strip
    // N of e4, which his sweep never reaches, then stands and comes up behind him
    // (all from his post as the game placed it: the house's drawn model sets him off its corner)
    const e4 = D.get('e4'), [ex, ez] = [e4.x, e4.z];
    await crawl(D, 'greenberet', 31, 15.2, { box: 8 });
    await crawl(D, 'greenberet', ex + 0.7, ez - 4.4, { box: 6 });
    D.checkpoint('A1 greenberet crawls round the kennel to the strip north of e4');
    // (the strike from 1 m behind him, W, where the house's corner leaves room to get round him; else from his N side)
    const behind = D.world.groundAt(ex - 1.6, ez).walkable ? [ex - 1, ez - 0.2] : [ex + 0.6, ez - 1];
    await kill(D, 'greenberet', 'e4', [[27, 14.5], [24, 13.5]], { approach: [[ex + 0.7, ez - 2], behind] });
    D.checkpoint('A2 greenberet knifes e4');
  }],
  ['B', 'The uniform on the clothesline', async (D) => {
    const sp = D.c('spy');
    // e8 guards the clothesline from 5 m SW of it, looking SE over the lower camp: the line is behind his back. The
    // Spy crawls E along the foot of the valley rim and down through the rim grove to it
    await crawl(D, 'spy', 31, 15.2, { box: 8 });
    await crossStrip(D, 'spy');
    await crawl(D, 'spy', 50.5, 39.5, { box: 6, maxWait: 300 });
    // (lying, right up to the laundry: on his feet before the uniform is on, every step would print an intruder's boots)
    await crawl(D, 'spy', 52.6, 41.4, { box: 4, maxWait: 120 });
    D.checkpoint('B1 spy crawls through the rim grove behind e8');
    const line = D.item('uniform_line');
    // (he gets up, unpegs it and dresses behind the laundry: some 4.5 s standing, while nobody looks this way — e3 at
    // the E end of his lane looks straight up the field at it)
    const why = [];
    const spots = [[51.3, 41.5], [sp.x, sp.z], [(sp.x + 51.3) / 2, (sp.z + 41.5) / 2]].flatMap(([x, z]) => [[x, z], [x - 0.8, z], [x, z + 0.8], [x - 0.6, z + 0.6]]);
    // (and every walker in reach — e3 in his lane, the camp patrol by the stone house, e5 by h3 — facing well away)
    await cautious(D, () => D.until(() => { why.length = 0; return walkersAway(D, WALKERS(D), spots, 7) && clearFor(D, spots, 7, { mode: 'walk', why, step: 0.2 }); }, 300, 'nobody sees the Spy at the line'))
      .catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3)}]`); });
    await D.stance('spy', 'stand');
    D.ability('spy', 'use', line);
    await D.until(() => sp.disguised, 10, 'the Spy in uniform');
    await D.idle('spy', 6);
    D.checkpoint('B2 spy takes the uniform off the line');
    // e8 still guards the line, looking SE over the camp: the only way S past the headquarters (its E side is shut by
    // the massif). In uniform the Spy walks up behind him, injects him and lays him in the narrow gap between the
    // woodshed and the headquarters, where no beat or post looks
    // (e3 in his lane, the camp patrol and e5 by h3 overlook the spot from 13-36 m: facing well away the whole time)
    const E8_WAY = [[48, 46.5], [48.9, 48.5], [49.8, 50.8], [50.8, 53.6]];
    await kill(D, 'spy', 'e8', [[50.8, 53.6], [49.5, 51.5]], { when: () => walkersAway(D, WALKERS(D), track(E8_WAY, 1.3, 5, 2)) });
    D.checkpoint('B3 spy injects e8 and hides him by the woodshed');
  }],
  ['C', 'Through the camp', async (D) => {
    // the camp patrol (pma, pmb) walks from the stone house's yard down to house h4's lane: its beat crosses the only way
    // S through the camp, W of the woodshed and the headquarters. The Spy, in uniform, walks to the N end of its beat and
    // talks to its sergeant the moment it halts there: the pair stands facing him, N, backs to the camp
    const talk = talkTo(D, 'pma', [35, 45.6], [35, 49], () => D.checkpoint('C1 spy talks to the camp patrol at the north end of its beat'));
    // meanwhile the Green Beret crawls the Spy's way round the valley rim and through the pines to the edge of the camp
    await crawl(D, 'greenberet', 31, 15.2, { box: 8 }); // (the Spy's way: in the game's nav the rim strip opens from here)
    await crossStrip(D, 'greenberet');
    await crawl(D, 'greenberet', 53.5, 36, { box: 8, maxWait: 300 });
    D.checkpoint('C2 greenberet crawls round the rim to the edge of the camp');
    // then S through the camp behind the patrol's back and E below the tents along the foot of the massif
    await D.until(talk.held, 120, 'the Spy talking to the camp patrol');
    await hop(D, 'greenberet', CAMP, { hold: 6, maxWait: 300, label: 'greenberet through the camp', ready: talk.held });
    for (const [x, z] of [[64, 70.5], [73.5, 76], [77.5, 81]]) await crawl(D, 'greenberet', x, z, { box: 8, maxWait: 300 });
    D.checkpoint('C3 greenberet crawls through the camp and along the foot of the massif');
    D.order('spy', { type: 'cancel' });
    await D.until(() => D.get('pma').brain?.state !== 'DISTRACTED', 5, 'the talk over');
    D.checkpoint('C4 spy lets the camp patrol go');
  }],
  ['D', 'Up the cable car', async (D) => {
    const sp = D.c('spy'), cab = D.world.byId('cablecar');
    // in uniform the Spy walks openly down through the lower camp to the cable car (an officer riding the lift raises
    // no eyebrows) and rides it to the summit
    await D.go('spy', 42.5, 93.5, { max: 200, tol: 1.0 });
    D.ability('spy', 'enterVehicle', cab);
    await D.until(() => sp.vehicle === cab, 20, 'the Spy in the cabin');
    D.checkpoint('D1 spy boards the cable car');
    await D.until(() => cab.railS >= cab.trackLen - 1e-3 && !cab.railRunning || (cab.railS >= cab.trackLen - 1e-3 && (cab.speed || 0) < 0.05), 60, 'the cabin at the top');
    D.checkpoint('D2 spy rides up to the summit');
    // e14 paces the top station's platform: he gets out behind e14's back
    const e14 = D.get('e14');
    await D.until(() => clearFor(D, [[64.5, 51.5], [cab.x, cab.z]], 3, { mode: 'walk' }), 200, 'nobody looks at the cabin door');
    D.ability('spy', 'leaveVehicle');
    await D.until(() => !sp.vehicle && !sp.currentAction, 10, 'the Spy out of the cabin');
    D.checkpoint('D3 spy steps out at the top station');
  }],
  ['E', 'The summit guards', async (D) => {
    // e14 paces the top station's platform and halts at its W end looking out over the valley: the Spy comes up
    // behind him there and lays him behind the far W end of the station
    const e14 = D.get('e14');
    await kill(D, 'spy', 'e14', [[61.6, 45], [62, 42.5], [64.6, 39.5]], { when: () => e14.brain?.atWait && Math.hypot(e14.x - 63.7, e14.z - 48.2) < 1 });
    D.checkpoint('E1 spy injects e14');
    // e15 watches the E cliff, where the Green Beret will climb: the Spy strolls over behind him and lays him in the
    // lee of the barracks' far end, where no beat or post ever looks
    await D.go('spy', 96.3, 62.3, { max: 120, tol: 0.8 });
    await kill(D, 'spy', 'e15', [[104.5, 56.5], [105, 58]]);
    D.checkpoint('E2 spy injects e15, the cliff watcher');
    // e16 stands W of the barracks looking W over the drums and the summit: from behind, while Patrol 18 is away N
    await D.go('spy', 96.2, 47.2, { max: 60, tol: 0.8 });
    await kill(D, 'spy', 'e16', [[105, 55.5], [104, 57.8]]);
    D.checkpoint('E3 spy injects e16 by the barracks');
    // e17 walks past the radar; at the E end of his beat he halts looking S: from behind, and against the back wall of the operators' hut
    const e17 = D.get('e17');
    await D.go('spy', 104.5, 19.5, { max: 90, tol: 0.8 });
    await kill(D, 'spy', 'e17', [[103.7, 29.6], [103.7, 30.5]], { when: () => e17.brain?.atWait && Math.hypot(e17.x - 104.7, e17.z - 23) < 1 });
    D.checkpoint('E4 spy injects e17 by the radar');
  }],
  ['F', 'Patrol 18 and the east cliff', async (D) => {
    // the Spy walks over to the N end of Patrol 18's beat and, the moment it halts there, talks to its sergeant: the
    // whole file stands facing him, N, its back to everything the Green Beret will do on the summit
    const talk = talkTo(D, 'p18a', [84, 5.2], [84, 8], () => D.checkpoint('F1 spy talks to Patrol 18 at the north end of its beat'));
    await D.until(talk.held, 300, 'the Spy talking to Patrol 18');
    // Patrol 19 ends its beat right below the cliff, halting there looking N at the climb. Once it has turned back and
    // walks away down its track, the Green Beret crawls along the foot to the climb, clear of the mines that flank the
    // patrol's beaten track (the only mine-free line), and climbs while their backs are turned: on the rock face, some
    // 40 s up it and over the top, he is in plain view
    const p19 = ['p19a', 'p19b', 'p19c', 'p19d'].map((t) => D.get(t)), END = [98, 94], gb = D.c('greenberet');
    const MINES = [[94, 91], [91, 99], [103, 97], [86, 109], [95, 108]].map(([x, z]) => [x, z, 1.8]); // (a mine goes off within 0.7 m)
    const off = (q) => Math.hypot(q.x - END[0], q.z - END[1]);
    await D.until(() => p19.every((e) => !e.brain?.atWait && off(e) > 5 && off(D.predict(e, 20)) > off(e) + 8), 300, 'Patrol 19 walking away from the cliff');
    await crawl(D, 'greenberet', 91.5, 88.3, { box: 6, maxWait: 120, avoid: MINES });
    // (the last stretch N, straight at the climb: standing up facing the rock he starts it at once, no step or turn on
    // the snow at its foot — prints there would still be fresh when the patrol is back)
    await crawl(D, 'greenberet', 100, 92, { box: 6, maxWait: 120, avoid: MINES });
    await crawl(D, 'greenberet', 100, 90.5, { box: 3, maxWait: 60, avoid: MINES });
    D.checkpoint('F2 greenberet at the foot of the east cliff');
    let next = 0;
    await D.until(() => { if (D.t < next) return false; next = D.t + 0.5; return clearFor(D, [[100, 90.5], [100.1, 89]], 40, { mode: 'walk', step: 1 }); }, 200, 'nobody sees the cliff face');
    await D.stance('greenberet', 'stand');
    D.ability('greenberet', 'climb', { x: 101, z: 69.5 });
    await D.until(() => Math.hypot(gb.x - 101, gb.z - 69.5) < 0.8 && !gb.path, 120, 'the Green Beret up the cliff');
    D.checkpoint('F3 greenberet climbs the east cliff');
  }],
  ['G', 'A fuel drum in the middle of the summit', async (D) => {
    // Patrol 18 stands facing the Spy at the N end of its beat, its back to the whole summit. The Green Beret crawls
    // over to the fuel drums on the S rim (a man lying down leaves no tracks in the snow), shoulders b2 and carries it N
    // up the middle of the summit to DRUM_X, near enough the dish and out of b1's reach. Then he crawls to the autogyro
    // and climbs in
    const gb = D.c('greenberet'), drum = D.item('b2'), gyro = D.world.byId('autogyro');
    const why = [];
    await crawl(D, 'greenberet', 86, 56.4, { box: 6, maxWait: 120 });
    await D.stance('greenberet', 'stand');
    D.ability('greenberet', 'hand', drum);
    await D.until(() => gb.carrying === drum, 10, 'drum shouldered');
    D.checkpoint('G1 greenberet shoulders fuel drum b2');
    const CARRY = [[DRUM_X[0], 46], [DRUM_X[0], DRUM_X[1] + 0.6]];
    await D.until(() => { why.length = 0; return routeClear(D, CARRY, { mode: 'walk', from: [gb.x, gb.z], speed: 1.3, delay: 0.3, hold: 2, why, pad: 0.5 }); }, 120, 'the carry clear')
      .catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3)}]`); });
    for (const [x, z] of CARRY) await D.go('greenberet', x, z, { tol: 0.3, max: 60 });
    D.ability('greenberet', 'drop');
    await D.until(() => !gb.carrying && !gb.currentAction, 10, 'drum down');
    const [rd, b1d] = [Math.hypot(drum.x - 94, drum.z - 31), Math.hypot(drum.x - 94.7, drum.z - 51.9)];
    if (rd > 9.8 || b1d < 7.5) throw new Error(`drum b2 down at (${drum.x.toFixed(2)},${drum.z.toFixed(2)}): ${rd.toFixed(2)} m from the dish, ${b1d.toFixed(2)} m from b1`);
    D.checkpoint('G2 greenberet sets the drum down in the middle of the summit');
    await crawl(D, 'greenberet', 81, 26.5, { box: 6, maxWait: 120 });
    await D.stance('greenberet', 'stand');
    D.ability('greenberet', 'enterVehicle', gyro);
    await D.until(() => gb.vehicle === gyro, 20, 'the Green Beret in the autogyro');
    D.checkpoint('G3 greenberet climbs into the autogyro');
  }],
  ['H', 'The barracks, the radar and the escape', async (D) => {
    // The Spy ends the talk: Patrol 18 goes on down its beat to its S end, beside drum b1 at the barracks wall. He walks
    // ahead of it (in uniform nobody minds him) to SHOT, NW of the barracks, and stands there; the patrol walks past him
    // and halts at b1 looking S. With every back turned he draws and shoots the drum: the barracks goes up, and the
    // patrol with it. Every explosion on this map is heard everywhere: the alarm sounds — the only one, and nothing but
    // a drum's blast brings down the radar
    const w = D.world, spy = D.c('spy'), gyro = w.byId('autogyro'), b1 = D.item('b1'), drum = D.item('b2');
    const p18 = ['p18a', 'p18b', 'p18c'].map((t) => D.get(t));
    const done = (id) => !!w.objectives.find((o) => o.id === id)?.done;
    D.order('spy', { type: 'cancel' });
    await D.until(() => p18.every((e) => e.brain?.state !== 'DISTRACTED'), 5, 'the talk over');
    D.checkpoint('H1 spy lets Patrol 18 go on down its beat');
    await D.go('spy', SHOT[0], SHOT[1], { tol: 0.4, max: 60 });
    D.checkpoint('H2 spy waits NW of the barracks for Patrol 18');
    let next = 0;
    const at = (e, b, r) => Math.hypot(e.x - b.x, e.z - b.z) < r;
    await D.until(() => { if (D.t < next) return false; next = D.t + 0.1; return p18.every((e) => e.alive && at(e, b1, 4.5)) && !eyesOn(D, spy, { ahead: 1.5 }); }, 200, 'Patrol 18 halted at drum b1, backs turned');
    D.ability('spy', 'pistol', b1);
    await D.until(() => done('o2'), 5, 'the barracks razed');
    // at once, pistol still in hand, he shoots drum b2 too: its blast wrecks the radar (nobody is left alive near it)
    D.ability('spy', 'pistol', drum);
    await D.until(() => done('o1'), 5, 'the radar destroyed');
    D.checkpoint('H3 spy shoots drums b1 and b2: the barracks goes up with Patrol 18, then the radar');
    // one officer gets out of the ruins a moment later: he goes from body to body, the patrol's by the ruins, then the
    // two at the barracks' far end the ruins no longer hide. In uniform, his pistol away, the Spy walks off to the
    // autogyro: only climbing in would give him away, so he waits by it until the officer is out of sight range (a man
    // searching looks every way: no glance of his can be foretold)
    D.order('spy', { type: 'cancel' });
    const DOOR = [79.6, 27.2];
    D.order('spy', { type: 'move', x: DOOR[0], z: DOOR[1] });
    let off = null;
    await D.until(() => !!(off = D.get('g3_officer')), 10, 'the officer out of the ruins');
    D.checkpoint('H4 an officer gets out of the ruins; the Spy walks off to the autogyro');
    await D.until(() => Math.hypot(spy.x - DOOR[0], spy.z - DOOR[1]) < 0.5 || (!spy.path && !spy.isMoving), 30, 'the Spy by the autogyro');
    next = 0;
    const FAR = CONFIG.stealth.vision.soldier.far + 1;
    await D.until(() => { if (D.t < next) return false; next = D.t + 0.1; return (!off.alive || Math.hypot(off.x - spy.x, off.z - spy.z) > FAR) && !eyesOn(D, spy, { ahead: 1.5, except: [off] }); }, 150, 'the officer out of sight range');
    D.ability('spy', 'enterVehicle', gyro);
    await D.until(() => spy.vehicle === gyro, 20, 'the Spy in the autogyro');
    D.checkpoint('H5 spy climbs into the autogyro: it lifts off');
    await D.until(() => w.objectives.every((o) => o.done || !o.required), 60, 'the escape');
  }],
];

export async function solve(D, ctx = {}) {
  if (STOP) { const cp = D.checkpoint.bind(D); D.checkpoint = (name) => { cp(name); if (name.split(' ')[0] === STOP) throw new Error(`STOP at ${STOP}`); }; }
  // every sneak on foot in straight, decisive dashes (dash.mjs; user 2026-10-15: "making it more straight and decisive")
  D.straightDashes = true;
  for (const [id, title, fn] of STAGES) {
    if (ctx.until && id > ctx.until) break;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
  }
  return D.checkpoints;
}
