/**
 * LIGHTS OUT e06 "Thin Ice" (Fährhafen Lütjenbrook): a full stealth solution, played only with player orders
 * (docs/expansion/e06.md §11, as built). Driver API: tools/solutions/driver.mjs; sneaking helpers:
 * tools/solutions/sneak.mjs. Headless:
 *   node tools/solutions/run-headless.mjs e06 [--easy] [--until X]
 * Reference run in the real game: tests/e06-solution.test.mjs. Walkthrough: e06.walkthrough.mjs.
 *
 * Every knock-out is from behind and unwitnessed, every man knocked out is cuffed (a bound man seen is freed and both
 * shout), and no commando is ever inside a live cone (the driver's exposure watch). Wins with every objective done,
 * 0 detections and 0 exposures, on Hard and on Easy.
 */
import { sneak, routeClear, clearFor, unwitnessed, bodySeen, predict, walking } from './sneak.mjs';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { mirrorOf, ghostOn } from './ghost.mjs';

const DBG = !!globalThis.process?.env?.E06DBG;
/** (dev) stop the run right after this checkpoint id */
const STOP = globalThis.process?.env?.E06STOP;

const TEAM = ['diver', 'sapper', 'driver', 'spy', 'grethe'];
/** The searchlight tower's ladder foot on the mole, by the channel (mission `ladders` lad_sl). */
const LADDER_FOOT = [97.95, 30.6], LADDER_TOP = [98.8, 30.6];
/** The spot `d` m behind man `e`'s back (opposite his heading). */
const behind = (e, d) => [e.x - Math.cos(e.heading) * d, e.z - Math.sin(e.heading) * d];
/** The man as the guards see him standing (a blow, a stand-up). */
const bare = (u) => ({ x: u.x, z: u.z, y: u.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });

let dbgN = 0;
function dbg(D, why, label) { if (DBG && dbgN++ % 120 === 0) D.log(`DBG ${D.t.toFixed(1)} ${label}: [${why.join(' ')}]`); return false; }

/** Does `e` (now and over the next `ahead` s, as predicted) have the man `man` in his cone? */
function eyesOn(D, e, man, ahead = 1.2) {
  const w = D.world, me = mirrorOf(e);
  for (let t = 0; t <= ahead + 1e-6; t += 0.2) {
    const q = walking(e) ? predict(e, t) : { x: e.x, z: e.z, heading: e.heading };
    const g = ghostOn(me); g.x = q.x; g.z = q.z; g.heading = q.heading;
    if (canSee(g, man, w, { cone: coneAt(g, w.time + t) }) !== 'none') return true;
  }
  return false;
}

/**
 * Run `fns` side by side until `done()` holds, and end on that very tick: the men still on their way stop where the
 * game leaves them (the win). The watcher parks first, so after every tick it looks before any other flow gives an
 * order; the moment it sees `done()` it throws, and the others end at their next order or tick — no tick after it
 * (a live walkthrough stops at the win: the scripted run must end there too).
 */
async function untilDone(D, done, maxSec, label, ...fns) {
  const END = new Error(`untilDone: ${label}`);
  try {
    await D.parallel(async () => { await D.until(done, maxSec, label); throw END; }, ...fns);
  } catch (e) { if (e !== END) throw e; }
}

const crawlTo = (D, role, x, z, o = {}) => sneak(D, x, z, { mode: 'crawl', role, horizon: 120, box: 10, ...o, label: o.label ?? `${role} → (${x},${z})` });
const walkTo = (D, role, x, z, o = {}) => sneak(D, x, z, { mode: 'walk', role, horizon: 120, box: 10, ...o, label: o.label ?? `${role} → (${x},${z})` });

/**
 * The Marine knifes `victim` once he is within reach, the victim's cone will not hold him for `ahead` s, nobody else
 * sees the blow, and the body will lie unseen for `quiet` s (`later`: men who will be down by then).
 */
async function knifeMan(D, victim, { reach = 1.8, ahead = 1.2, quiet = 60, later = [], maxSec = 120, label = '' } = {}) {
  const u = D.c('diver'), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t));
  await D.until(() => {
    why.length = 0;
    const d = Math.hypot(victim.x - u.x, victim.z - u.z);
    if (d > reach) return dbg(D, [`far ${d.toFixed(1)}`], `knife ${victim.tag}`);
    const me = bare(u);
    if (eyesOn(D, victim, me, ahead)) return dbg(D, ['victim looks'], `knife ${victim.tag}`);
    if (!unwitnessed(D, victim, me, { ahead, strict: true, why })) return dbg(D, why, `knife ${victim.tag}`);
    // (the body as it lies: a knifed man falls forward ~0.9 m — and a man who sees one of his own fall raises the alarm
    // at once, enemy-brain notifyKill — so both the spot he stands on and the one he falls on must stay unseen)
    const h = victim.heading ?? 0, fx = victim.x + Math.cos(h) * 0.9, fz = victim.z + Math.sin(h) * 0.9;
    const finders = [...new Set([...bodySeen(D, victim.x, victim.z, quiet, { except: [victim, ...later] }), ...bodySeen(D, fx, fz, quiet, { except: [victim, ...later] })])];
    if (finders.length) return dbg(D, [`body seen by ${finders.join(',')}`], `knife ${victim.tag}`);
    return true;
  }, maxSec, `knife ${victim.tag}${label ? ' ' + label : ''}`);
  D.ability('diver', 'knife', victim);
  await D.until(() => !victim.alive, 6, `${victim.tag} knifed`);
  await D.idle('diver', 5);
}

const KO_ID = { driver: 'knockoutClub', spy: 'knockoutChloroform' };

/**
 * `role` knocks `victim` out from behind once `ready()` holds, he is within `reach`, the victim's cone will not hold
 * him for `ahead` s, nobody else sees the blow, and the man down lies unseen for `quiet` s (`later`: men who will be
 * down by then).
 */
async function knockOut(D, role, victim, { ready = () => true, reach = 2.6, ahead = 1.8, quiet = 20, later = [], maxSec = 300, label = '', approach = 0 } = {}) {
  const u = D.c(role), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t)).filter(Boolean);
  let lastGo = -1;
  await D.until(() => {
    why.length = 0;
    if (!ready()) return dbg(D, ['not ready'], `ko ${victim.tag}`);
    if (Math.hypot(victim.x - u.x, victim.z - u.z) > reach) {
      // (`approach` m: close in behind him on his belly — the spot that far behind his back, refreshed each second)
      if (approach && D.t - lastGo > 1) { lastGo = D.t; const b = behind(victim, approach); D.order(role, { type: 'move', x: b[0], z: b[1] }); }
      return dbg(D, [`far ${Math.hypot(victim.x - u.x, victim.z - u.z).toFixed(1)}`], `ko ${victim.tag}`);
    }
    const me = bare(u);
    if (eyesOn(D, victim, me, ahead)) return dbg(D, ['victim looks'], `ko ${victim.tag}`);
    if (!unwitnessed(D, victim, me, { ahead, strict: true, why })) return dbg(D, why, `ko ${victim.tag}`);
    if (!clearFor(D, [[u.x, u.z], [(u.x * 2 + victim.x) / 3, (u.z * 2 + victim.z) / 3]], ahead + 0.6, { mode: 'walk', why })) return dbg(D, why, `ko ${victim.tag}`);
    if (!clearFor(D, [[(u.x + victim.x * 2) / 3, (u.z + victim.z * 2) / 3], [victim.x, victim.z]], ahead + 0.6, { mode: 'walk', except: [victim], why })) return dbg(D, why, `ko ${victim.tag}`);
    const finders = bodySeen(D, victim.x, victim.z, quiet, { except: [victim, ...later] });
    if (finders.length) return dbg(D, [`body seen by ${finders.join(',')}`], `ko ${victim.tag}`);
    return true;
  }, maxSec, `knock out ${victim.tag}${label ? ' ' + label : ''}`);
  D.ability(role, KO_ID[role], victim);
  await D.until(() => victim.ko === 'stunned' || !victim.alive || victim.brain?.state === 'COMBAT', 10, `${victim.tag} out cold`);
  if (victim.ko !== 'stunned') throw new Error(`${victim.tag} was not knocked out (${victim.brain?.state})`);
  await D.idle(role, 5);
}

/** The Spy cuffs the stunned `victim` (a suspicious act: unwitnessed); she comes up crawling if she is not there. */
async function cuffMan(D, victim, { maxSec = 60, later = [] } = {}) {
  const u = D.c('spy'), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t)).filter(Boolean);
  // (a man out cold wakes in 30 s: she is beside him already — the Spy comes up before the blow — or crawls straight over)
  if (Math.hypot(victim.x - u.x, victim.z - u.z) > 6) await crawlTo(D, 'spy', victim.x + 0.9, victim.z + 0.9, { label: `the Spy to ${victim.tag}`, tol: 0.9, horizon: 60 });
  await D.until(() => {
    why.length = 0;
    if (victim.ko !== 'stunned') throw new Error(`${victim.tag} no longer stunned (${victim.ko})`);
    if (Math.hypot(victim.x - u.x, victim.z - u.z) > 3.2) { if (!u.path && !u.isMoving) D.order('spy', { type: 'move', x: victim.x, z: victim.z }); return false; }
    if (!unwitnessed(D, victim, bare(u), { ahead: 2.2, strict: true, why })) return dbg(D, why, `cuff ${victim.tag}`);
    return true;
  }, maxSec, `cuff ${victim.tag}`);
  D.ability('spy', 'handcuff', victim);
  await D.until(() => victim.ko === 'bound', 8, `${victim.tag} cuffed`);
  await D.idle('spy', 5);
}

/** `role` shoulders bound / dead `tag`, carries him along `pts` and puts him down at the last one, unseen. */
async function carryMan(D, role, tag, pts, { maxWait = 180, quiet = 600, label = '', later = [] } = {}) {
  const u = D.c(role), e = typeof tag === 'string' ? D.get(tag) : tag, why = [];
  const end = pts[pts.length - 1];
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t)).filter(Boolean);
  await D.until(() => {
    why.length = 0;
    if (!clearFor(D, [[u.x, u.z], ...pts], 6, { mode: 'walk', why, except: later })) return dbg(D, why, `carry ${e.tag}`);
    const f = quiet > 0 ? bodySeen(D, end[0], end[1], quiet, { step: 1, except: [e, ...later] }) : [];
    if (f.length) return dbg(D, [`at the end seen by ${f.join(',')}`], `carry ${e.tag}`);
    return true;
  }, maxWait, `window to carry ${e.tag}${label ? ' ' + label : ''}`);
  await D.stance(role, 'stand');
  for (let k = 0; k < 3 && u.carrying !== e; k++) {
    D.ability(role, 'hand', e);
    await D.until(() => u.carrying === e || (!u.currentAction && !u.pendingAbility && !u.path && !u.isMoving && !((e.cigs ?? 0) > 0)), 10, `${role} at ${e.tag}`);
    await D.idle(role, 5);
  }
  if (u.carrying !== e) throw new Error(`${role} could not shoulder ${e.tag}`);
  for (const p of pts) await D.go(role, p[0], p[1], { tol: 0.5 });
  D.ability(role, 'drop');
  await D.until(() => !u.carrying, 5, `${e.tag} put down`);
  await D.idle(role);
}

/**
 * The walkable spot in the box [x0, z0]–[x1, z1] (0.5 m grid) nearest `from` where a man down would lie unseen for
 * `quiet` s (bodySeen: any viewer's full cone, both bands), or null.
 */
function findDump(D, [x0, z0, x1, z1], from, quiet = 300, except = []) {
  const g = D.world.grid, cells = [];
  for (let x = x0; x <= x1; x += 0.5) for (let z = z0; z <= z1; z += 0.5) if (g.walkableAt(x, z)) cells.push([x, z, Math.hypot(x - from[0], z - from[1])]);
  cells.sort((a, b) => a[2] - b[2]);
  for (const [x, z] of cells) if (!bodySeen(D, x, z, quiet, { step: 1, except }).length) return [x, z];
  return null;
}

/** Up (or down) a ladder: straight dashes off (a dash would cut across the tower's raised deck at ground level). */
async function climbLadder(D, role, foot, top) {
  const sd = D.straightDashes, u = D.c(role);
  D.straightDashes = false;
  try {
    await D.go(role, ...foot, { tol: 0.25, max: 30 });
    await D.go(role, ...top, { tol: 0.3, max: 40 });
  } finally { D.straightDashes = sd; }
  if (DBG) D.log(`DBG ladder ${role} at ${u.x.toFixed(2)},${u.z.toFixed(2)} y ${u.y}`);
}

/**
 * The village street's walker v2 (4,78) ↔ (46,78) looks south over the shore for 6 s at his west end (15 s on Easy):
 * the west shore below it and the street's west end are crossed only while he walks east, between x 8 and 30, his back
 * to them (the planner alone, timed to the tick, let him see the Marine there on Hard --delay 2400: verifier r1).
 */
const v2East = (D) => { const v = D.get('v2'); return !v?.alive || !!v.ko || (Math.cos(v.heading) > 0.7 && v.x > 8 && v.x < 30); };
const streetGate = (D, who) => D.until(() => v2East(D), 400, `${who}: v2 walking east along the village street`);

/** The Marine's part (stage A): down the channel under water, up the searchlight tower, out over the sea ice. */
async function marine(D) {
  const dv = D.c('diver');
    // west behind the houses, north along the shore past the net sheds, out onto the sea ice beyond the west mole
    await streetGate(D, 'the Marine');
    await crawlTo(D, 'diver', 2.0, 88, { label: 'the Marine west of the village' });
    await crawlTo(D, 'diver', 1.8, 33, { label: 'the Marine up the west shore' });
    await crawlTo(D, 'diver', 6, 14, { label: 'the Marine onto the sea ice' });
    D.checkpoint('A1 the Marine crawls round the village and out onto the sea ice behind the west mole');
    await crawlTo(D, 'diver', 81.6, 6, { label: 'the Marine east over the sea ice', horizon: 300, box: 14 });
    D.checkpoint('A2 the Marine at the ice edge of the ice-breaker\'s channel');
    // (into the shallows at the broken ice edge: the first shallow cell east of him — the edge wanders)
    let sx = 83.6;
    for (let x = 81.75; x < 86; x += 0.25) if (D.world.groundAt(x, 6).shallow) { sx = x + 0.2; break; }
    D.order('diver', { type: 'move', x: sx, z: 6 });
    await D.until(() => !dv.path && !dv.isMoving, 20, 'the Marine in the shallows');
    D.ability('diver', 'dive');
    await D.until(() => dv.underwater, 10, 'the Marine under water');
    await D.go('diver', 95.8, 30.4, { tol: 0.8, max: 120 });
    D.checkpoint('A3 the Marine dives and swims down the channel to the tower\'s foot');
    // out of the water at the tower's channel face (the tower hides him from the mole), gear off, up the ladder
    await D.until(() => clearFor(D, [[96.4, 30.4], LADDER_FOOT, [98.8, 30.6]], 10, { mode: 'walk' }), 300, 'nobody looking at the tower\'s channel face');
    await D.go('diver', 96.4, 30.4, { tol: 0.4, max: 30 });
    D.ability('diver', 'dive');
    await D.until(() => !dv.diving && !dv.underwater && !dv.currentAction, 8, 'the Marine\'s gear off');
    await D.stance('diver', 'stand');
    await D.go('diver', ...LADDER_FOOT, { tol: 0.3, max: 30 });
    if (DBG) D.log(`DBG foot x ${dv.x.toFixed(2)} z ${dv.z.toFixed(2)} y ${dv.y} swim ${dv.swimming} water ${dv.inWater} wade ${dv.wading} diving ${dv.diving} stance ${dv.stance}`);
    await climbLadder(D, 'diver', LADDER_FOOT, LADDER_TOP);
    if (DBG) D.log(`DBG deck? x ${dv.x.toFixed(2)} z ${dv.z.toFixed(2)} y ${dv.y} elev ${dv.elev} lvl ${dv.level} state ${dv.state} climb ${!!dv.climbing} path ${!!dv.path}`);
    await D.until(() => (dv.y || 0) > 5, 10, 'the Marine on the deck');
    D.checkpoint('A4 the Marine climbs the tower\'s ladder out of the water');
    // (Hard) the third man watches the basin: from his back first; then the two at the light, out to sea, one after
    // the other before either sees the first lying there
    const sl1 = D.get('sl1'), sl2 = D.get('sl2'), sl3 = D.get('sl3');
    if (sl3?.alive) {
      await D.go('diver', sl3.x - 0.8, sl3.z - 0.9, { tol: 0.3, max: 20 });
      await knifeMan(D, sl3, { reach: 1.6, quiet: 60, later: [sl1, sl2], label: 'watching the basin' });
    }
    await D.go('diver', sl1.x + 0.5, sl1.z + 1.0, { tol: 0.3, max: 20 });
    // (sl2 stands 1.8 m east of him: at the west end of his head's sweep he sees sl1's spot, and a man who sees one of
    // his own fall raises the alarm on the spot (enemy-brain notifyKill) — strike only when sl2's head stays turned away
    // from that spot until the Marine is on him too)
    await knifeMan(D, sl1, { reach: 1.6, ahead: 1.2, quiet: 2.6, label: 'at the light' });
    await D.go('diver', sl2.x - 0.4, sl2.z + 1.0, { tol: 0.3, max: 10 });
    await knifeMan(D, sl2, { reach: 1.8, ahead: 0.6, quiet: 60, maxSec: 8, label: 'at the light' });
    await D.until(() => D.world.objectives.find((o) => o.id === 'o2')?.done, 5, 'o2: the searchlight out');
    D.checkpoint('A5 the Marine knifes the searchlight crew on the deck: the searchlight tower is out (o2)');
    // back down the ladder to the mole's end, and east over the sea ice far beyond the mole walker's near band
    await climbLadder(D, 'diver', LADDER_TOP, LADDER_FOOT);
    D.checkpoint('A6 the Marine back down the ladder onto the mole\'s end');
    await crawlTo(D, 'diver', 104, 12, { label: 'the Marine off the mole\'s end onto the sea ice', horizon: 300, box: 10 });
    await crawlTo(D, 'diver', 164, 5, { label: 'the Marine to the ice edge by the boats', horizon: 400, box: 12 });
    D.checkpoint('A7 the Marine crawls away over the sea ice to lie near the boats at the ice edge');
}

/**
 * The water's edge round the lead kept at arm's length: an avoid circle on every wet (shallow / open) cell of the box
 * that touches dry ice. The planner's 1 m cells would otherwise run a crawler's line along the half-metre shallow band
 * at the broken ice edge, where a man cannot lie (Unit.setStance): he stopped there, unable to plan on, in the quay
 * walker's near band (verifier r1, Hard --delay 777).
 */
function wetEdge(D, [x0, z0, x1, z1], r = 0.9) {
  const w = D.world, out = [], wet = (x, z) => { const g = w.groundAt(x, z); return g.water || g.shallow || !g.walkable; };
  for (let x = x0 + 0.25; x <= x1; x += 0.5) for (let z = z0 + 0.25; z <= z1; z += 0.5) {
    if (!wet(x, z)) continue;
    if ([[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]].some(([a, b]) => !wet(x + a, z + b))) out.push([x, z, r]);
  }
  return out;
}
/** The strip south of the lead (between its broken edge and the quay): the crossing's look-ahead also allows for the
 *  quay walkers running ±10 s off their beat (q2 and the duty officer t1 step round each other on the quay front),
 *  and pads a walker's near band by 1.6 m (1 m let q2 see the Sapper at 18.0 m, the band's very edge, on Hard
 *  --delay 37: a crawler lies up to 0.7 m off his plan's cell centre). */
const STRIP_SLACK = [0, -10, -5, 5, 10], STRIP_PAD = 1.6;

/** The Sapper's part (stage A): round the village and over the basin ice, under the crane, to lie on the basin's east half. */
async function sapperOver(D) {
  await D.until(() => D.c('spy').x > 20 && D.c('spy').z < 50, 900, 'the Spy out on the basin ice');
  // (he lies at the village's west edge beyond the near band of the street walker's halt there — he looks south up the
  // shore for 6 s, 15 s on Easy — and goes on up the shore once the walker has turned back east)
  await crawlTo(D, 'sapper', 1.6, 96.6, { label: 'the Sapper west of the village' });
  await streetGate(D, 'the Sapper');
  await crawlTo(D, 'sapper', 3.0, 35.5, { label: 'the Sapper up the west shore', horizon: 200 });
  await crawlTo(D, 'sapper', 19, 43, { label: 'the Sapper onto the basin ice', horizon: 300 });
  await crawlTo(D, 'sapper', 90, 44.5, { label: 'the Sapper east over the basin ice', horizon: 400, box: 14 });
  await crawlTo(D, 'sapper', 138.4, 41.8, { label: 'the Sapper under the crane onto the basin\'s east half', horizon: 500, box: 24,
    walkerPad: STRIP_PAD, avoid: wetEdge(D, [96, 44, 142, 66]), walkerSlack: STRIP_SLACK });
  D.checkpoint('A8 the Sapper crawls over the basin ice and under the crane to lie on the basin\'s east half');
}

/** The Driver's, the Spy's and Grethe's part of stage A: round the village and over the basin ice to the lead; Grethe
 *  walks the quay openly to the crane. */
async function teamOver(D) {
    let driverOnIce = false;
    const legs = (r, delay) => async () => {
      const o = r === 'spy' ? 1.5 : 0;
      await D.wait(delay);
      if (r === 'spy') await D.until(() => driverOnIce, 400, 'the Driver out on the ice');
      await streetGate(D, r);
      await crawlTo(D, r, 2.0 + o, 88, { label: `${r} west of the village` });
      await crawlTo(D, r, 2.0 + o, 34 - o, { label: `${r} up the west shore`, horizon: 200 });
      await crawlTo(D, r, 19, 41 + o, { label: `${r} onto the basin ice`, horizon: 300 });
      if (r === 'driver') { await crawlTo(D, r, 32, 45, { label: 'the Driver away from the shore', horizon: 200 }); driverOnIce = true; }
      await crawlTo(D, r, 92, 46 + o, { label: `${r} east over the basin ice`, horizon: 400, box: 14 });
    };
    // Grethe, a signals auxiliary going on shift, walks the village street and the quay to the crane, where she stops the
    // crane sentry with a question: he turns his back on the quay's edge
    const grethe = async () => {
      await walkTo(D, 'grethe', 44, 77, { label: 'Grethe down the village street', horizon: 120, keepWalker: 0 });
      await D.go('grethe', 48, 73.5, { tol: 0.6 });
      await D.go('grethe', 104, 72.2, { tol: 0.8, max: 120 });
      await D.go('grethe', 152.5, 66.8, { tol: 0.6, max: 120 });
    };
    await D.parallel(legs('driver', 0), legs('spy', 6), grethe);
    D.checkpoint('A9 the Driver and the Spy crawl over the basin ice to the ice-breaker\'s lead; Grethe walks the quay to the crane');
}

/** Then under the crane along the quay's foot and out over the basin's east half. */
async function underCrane(D) {
    // along the quay's foot under the crane (its sentry looks down the quay road), then out over the basin's east half to
    // lie well beyond the span sentry's near band
    const avoid = wetEdge(D, [96, 44, 142, 66]);
    for (const [r, end] of [['driver', [145, 40.5]], ['spy', [142.6, 41.6]]]) {
      await crawlTo(D, r, ...end, { label: `${r} past the crane onto the basin's east half`, horizon: 500, box: 24, walkerPad: STRIP_PAD, avoid, walkerSlack: STRIP_SLACK });
    }
    D.checkpoint('A10 the Driver and the Spy crawl under the crane along the quay\'s foot and out over the basin\'s east half');
}

export const STAGES = [
  ['A', 'The Marine down the channel to the searchlight tower; the others over the basin ice', async (D) => {
    await D.parallel(() => marine(D), () => sapperOver(D), async () => { await teamOver(D); await underCrane(D); });
  }],
  ['B', 'The span cabin: the door sentry, the span master, the span comes down', async (D) => {
    const k1 = D.get('k1'), b1 = D.get('b1'), sw = D.item('span_switch'), span = D.item('span');
    // round the slip's north end — well beyond the span sentry's near band (he looks north over the slip), timed with the
    // east mole's walker — and down the berth's east edge behind the door sentry (he looks south along it); one after the
    // other, so that neither waits in the other's way
    const round = async (r, end, label) => {
      await crawlTo(D, r, 151.5, 37.6, { label: `${label} out from the quay's foot`, horizon: 200, box: 8 });
      await crawlTo(D, r, 176.4, 37.6, { label: `${label} north of the slip`, horizon: 300, box: 6 });
      await crawlTo(D, r, ...end, { label: `${label} round the slip`, horizon: 200, box: 8 });
    };
    await D.parallel(
      async () => { await round('driver', [178.8, 42], 'the Driver'); await crawlTo(D, 'driver', 178.7, 56.3, { label: 'the Driver behind the door sentry', horizon: 200, box: 8 }); },
      async () => {
        await D.until(() => D.c('driver').x > 166, 900, 'the Driver past the slip');
        await round('spy', [177.0, 41], 'the Spy');
        await crawlTo(D, 'spy', 177.5, 55.8, { label: 'the Spy beside the Driver', horizon: 200, box: 8 });
      },
    );
    if (DBG) D.log(`DBG b1 at ${b1.x.toFixed(2)},${b1.z.toFixed(2)} driver ${D.c('driver').x.toFixed(2)},${D.c('driver').z.toFixed(2)}`);
    // (when the berth track's walker has turned south: the door is in his view from the track's middle)
    await knockOut(D, 'driver', b1, { reach: 3.4, quiet: 14, later: [k1], label: 'at the cabin door' });
    await cuffMan(D, b1, { later: [k1] });
    await carryMan(D, 'driver', b1, [[177.6, 58.6], [176.3, 59.9]], { maxWait: 10, quiet: 0, later: [k1], label: 'in at the cabin door' });
    D.checkpoint('B1 the Driver coshes the cabin\'s door sentry from behind; the Spy cuffs him and he is carried inside');
    // in at the door behind the span master (he looks out of his window at the span)
    await D.stance('spy', 'stand');
    await D.go('spy', 176.4, 58.6, { tol: 0.3 });
    await knockOut(D, 'spy', k1, { reach: 2.2, quiet: 900, label: 'at his window' });
    await cuffMan(D, k1);
    D.checkpoint('B2 the Spy slips in at the door behind the span master: chloroform, cuffs');
    // the door sentry on strings: he gets up, walks in to the switch and lowers the span
    D.ability('driver', 'puppet', b1);
    await D.until(() => b1.puppetOf === D.c('driver'), 5, 'the door sentry on strings');
    D.ability('driver', 'puppet', sw);
    await D.until(() => span.moving > 0 || span.down, 30, 'the span coming down');
    await D.until(() => span.down, 10, 'the span down');
    D.checkpoint('B3 on strings, the door sentry walks in to the switch and lowers the link-span');
  }],
  ['C', 'Grethe\'s small talk: the berth track\'s walker and the span sentry', async (D) => {
    const b1 = D.get('b1'), e3 = D.get('e3'), sp1 = D.get('sp1'), gr = D.c('grethe');
    D.ability('driver', 'puppet', b1); // (let go: he sits cuffed inside by the switch)
    await D.until(() => !b1.puppetOf, 5, 'the door sentry let go');
    // Grethe on the quay south-west of the track's end; when e3 comes up to it she asks him the way: he turns to her
    await D.go('grethe', 163.2, 64.6, { tol: 0.5, max: 60 });
    await D.until(() => Math.hypot(e3.x - 168, e3.z - 64) < 1.5, 120, 'e3 at the north end of his beat');
    D.ability('grethe', 'lipstick', e3);
    await D.until(() => !!e3.brain?.lipstickBy, 10, 'e3 talking to Grethe');
    // the Driver out of the cabin's door (the Spy first, out of his way) and round its south side on his belly
    await D.go('spy', 178.4, 57.0, { tol: 0.4 });
    await D.go('driver', 178.3, 59.2, { tol: 0.4 });
    await crawlTo(D, 'driver', 177.9, 61.8, { label: 'the Driver round the cabin\'s corner', horizon: 40, box: 5 });
    await crawlTo(D, 'driver', 171.4, 63.2, { label: 'the Driver behind e3', horizon: 40, box: 6 });
    // the Spy after him round the corner, to lie against the cabin's south wall a few steps from e3 (a man out cold
    // wakes in 30 s: she must be there to cuff him at once)
    await D.go('spy', 178.3, 59.2, { tol: 0.4 });
    await crawlTo(D, 'spy', 177.6, 61.7, { label: 'the Spy round the cabin\'s corner', horizon: 40, box: 5 });
    await crawlTo(D, 'spy', 173.6, 62.3, { label: 'the Spy against the cabin\'s south wall', horizon: 40, box: 6 });
    await knockOut(D, 'driver', e3, { reach: 2.6, quiet: 30, later: [sp1], label: 'talking to Grethe', approach: 1.6 });
    await cuffMan(D, e3, { later: [sp1] });
    // off the rails (a man lying on the track would stop the wagon), against the cabin's south wall
    await carryMan(D, 'driver', e3, [[173.6, 62.0]], { maxWait: 30, quiet: 0, later: [sp1], label: 'off the track' });
    D.checkpoint('C1 Grethe asks the berth track\'s walker the way; the Driver coshes him from behind, the Spy cuffs him');
    // then the span sentry: she walks over, asks him for a light; he turns his back on the berth
    await D.go('grethe', 160.6, 61.2, { tol: 0.5, max: 30 });
    D.ability('grethe', 'lipstick', sp1);
    await D.until(() => !!sp1.brain?.lipstickBy, 10, 'sp1 talking to Grethe');
    // (the Spy on her belly behind him at the same time: a man out cold wakes in 30 s)
    await D.parallel(() => D.go('driver', 165.0, 58.8, { tol: 0.4, max: 30 }),
      () => crawlTo(D, 'spy', 165.8, 56.2, { label: 'the Spy behind the span sentry', horizon: 40, box: 6 }));
    await knockOut(D, 'driver', sp1, { reach: 2.6, quiet: 60, label: 'talking to Grethe', approach: 1.6 });
    await cuffMan(D, sp1);
    D.checkpoint('C2 then the span sentry, talking to Grethe: coshed from behind, cuffed');
  }],
  ['D', 'The escort, the Spy\'s sergeant tunic, the shunting engine\'s crew', async (D) => {
    const e1 = D.get('e1'), e2 = D.get('e2'), sh2 = D.get('sh2'), sh1 = D.get('sh1'), spy = D.c('spy');
    // down the berth track to the sealed wagon's north end (the escort look out from its sides)
    await crawlTo(D, 'driver', 166.2, 92.4, { label: 'the Driver down the berth track to the wagon', horizon: 200, box: 8 });
    await crawlTo(D, 'spy', 168.6, 90.6, { label: 'the Spy down the berth track', horizon: 200, box: 8 });
    await D.go('driver', 165.6, 94.4, { tol: 0.3 });
    await knockOut(D, 'driver', e1, { reach: 2.4, quiet: 30, later: [e2], label: 'at the wagon\'s west side' });
    D.order('spy', { type: 'move', x: 165.8, z: 93.8 });
    await cuffMan(D, e1, { later: [e2] });
    D.ability('spy', 'hanger', e1);
    await D.until(() => e1.uniformTaken, 8, 'e1\'s tunic taken');
    await D.idle('spy', 4);
    D.ability('spy', 'uniform');
    await D.until(() => spy.uniformType === 'sergeant', 6, 'the Spy in the Feldgendarm\'s tunic');
    await D.idle('spy', 4);
    D.checkpoint('D1 the Driver coshes the Feldgendarm at the wagon\'s west side; the Spy cuffs him and takes his sergeant\'s tunic');
    await D.go('driver', 168.0, 92.2, { tol: 0.4 });
    await D.go('driver', 170.4, 96.8, { tol: 0.3 });
    await knockOut(D, 'driver', e2, { reach: 2.6, quiet: 30, label: 'at the wagon\'s east side', approach: 1.4 });
    D.order('spy', { type: 'move', x: 170.4, z: 97.4 });
    await cuffMan(D, e2);
    D.checkpoint('D2 the second Feldgendarm from behind at the wagon\'s east side: coshed, cuffed');
    // the shunting engine: its sentry looks south down the track; its driver dozes in the cab
    const round = [[169.6, 92.4], [166.4, 92.2], [165.5, 97.6]];
    await D.parallel(
      async () => { for (const [x, z] of [...round, [165.4, 101.8]]) await D.go('driver', x, z, { tol: 0.4 }); },
      async () => { await D.wait(1.5); for (const [x, z] of [...round, [165.6, 100.2]]) await D.go('spy', x, z, { tol: 0.5 }); },
    );
    await knockOut(D, 'driver', sh2, { reach: 2.6, quiet: 30, label: 'beside the engine', approach: 1.4 });
    await cuffMan(D, sh2);
    await D.go('spy', sh1.x - 0.4, sh1.z - 1.2, { tol: 0.4 });
    await knockOut(D, 'spy', sh1, { reach: 2.4, quiet: 30, label: 'asleep in his cab', approach: 1.2 });
    await cuffMan(D, sh1);
    D.checkpoint('D3 the engine\'s sentry coshed from behind; the Spy chloroforms the dozing engine driver and cuffs him: the engine cannot pull out');
  }],
  ['E', 'The push: over the lowered link-span and off its end', async (D) => {
    const wag = D.item('wag_n'), dr = D.c('driver');
    await D.go('driver', 167.4, 104.9, { tol: 0.4 });
    D.ability('driver', 'use', wag);
    await D.until(() => !!wag.goal || wag.dropped, 6, 'the wagon rolling');
    D.checkpoint('E1 the Driver puts his shoulder to the sealed wagon and pushes it north up the berth track');
    let lastLog = 0;
    await D.until(() => {
      if (DBG && D.t - lastLog > 5) { lastLog = D.t; D.log(`DBG wagon ${wag.x.toFixed(1)},${wag.z.toFixed(1)} goal ${JSON.stringify(wag.goal)} pusher ${wag.pusher?.role} driver ${dr.x.toFixed(1)},${dr.z.toFixed(1)} ${dr.currentAction?.id ?? ''}`); }
      return wag.dropped || D.world.objectives.find((o) => o.id === 'o1')?.done;
    }, 120, 'the wagon over the end of the span');
    await D.until(() => D.world.objectives.find((o) => o.id === 'o1')?.done, 10, 'o1');
    D.checkpoint('E2 the wagon rolls over the lowered link-span and off its end into the harbour (o1)');
    if (DBG) D.log(`DBG driver at ${dr.x.toFixed(1)},${dr.z.toFixed(1)}`);
  }],
  ['F', 'Out over the sea ice: over the east mole and between the frozen-in mines to the boats', async (D) => {
    // the Driver from the span's end, the Spy (a Feldgendarm sergeant now) and Grethe up the berth's east edge, the
    // Sapper from the basin's east half; all over the east mole east of its walker's beat and out over the sea ice
    const EXIT_PTS = { driver: [173.6, 10.6], spy: [176.2, 11.2], grethe: [178.4, 10.2], sapper: [174.2, 7.8], diver: [171.6, 6.2] };
    await D.parallel(
      async () => { await crawlTo(D, 'driver', 168.2, 39, { label: 'the Driver off the span\'s end', horizon: 120, box: 8 }); await crawlTo(D, 'driver', 177.2, 34.2, { label: 'the Driver to the mole', horizon: 200, box: 10 }); await crawlTo(D, 'driver', 176.8, 21.2, { label: 'the Driver over the mole', horizon: 200, box: 8 }); },
      async () => { await walkTo(D, 'spy', 178.4, 64, { label: 'the Spy up the berth', disguise: 'sergeant', horizon: 200, box: 10 }); await walkTo(D, 'spy', 179.0, 36, { label: 'the Spy up the berth\'s east edge', disguise: 'sergeant', horizon: 200, box: 8 }); await crawlTo(D, 'spy', 178.6, 23.6, { label: 'the Spy over the mole', horizon: 200, box: 8 }); },
      async () => { await D.go('grethe', 177.6, 64.6, { tol: 0.6, max: 60 }); await D.go('grethe', 179.2, 40, { tol: 0.6, max: 60 }); await D.go('grethe', 179.6, 26.2, { tol: 0.6, max: 60 }); },
      async () => { await crawlTo(D, 'sapper', 175.4, 35.4, { label: 'the Sapper round the slip to the mole', horizon: 300, box: 12 }); await crawlTo(D, 'sapper', 174.8, 23.4, { label: 'the Sapper over the mole', horizon: 200, box: 8 }); },
    );
    D.checkpoint('F1 the team over the east mole onto the sea ice');
    // (the last man into the boats' zone wins the game: the stage ends on that tick, the others' crawls cut short)
    const won = () => D.world.objectives.find((o) => o.id === 'o3')?.done || D.world.missionOver;
    await untilDone(D, won, 400, 'everyone at the boats',
      ...['driver', 'spy', 'sapper', 'diver'].map((r) => () => crawlTo(D, r, ...EXIT_PTS[r], { label: `${r} between the mines to the boats`, horizon: 200, box: 10 })),
      () => D.go('grethe', ...EXIT_PTS.grethe, { tol: 0.8, max: 60 }));
    D.checkpoint('F2 everyone at the boats at the ice edge: mission complete');
  }],
];

export async function solve(D, ctx = {}) {
  const w = D.world;
  if (STOP) { const cp = D.checkpoint; D.checkpoint = (name) => { cp(name); if (name.split(' ')[0] === STOP) throw new Error(`STOP at ${STOP}`); }; }
  D.straightDashes = true;
  w.sneakTurns = true;
  if (DBG) w.events.on('noise', (n) => { if (n.radius >= 4) D.log(`DBG noise ${n.kind} r ${n.radius} lvl ${n.level} at ${(+n.x).toFixed(1)},${(+n.z).toFixed(1)} src ${n.source?.tag ?? n.source?.role ?? n.source?.kind ?? '?'}`); });
  const failed0 = D.failed.bind(D);
  D.failed = () => failed0() || (w.commandos.find((c) => c.downed) ? `${w.commandos.find((c) => c.downed).role} down` : null);
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}

export { TEAM };
