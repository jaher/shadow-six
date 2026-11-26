/**
 * LIGHTS OUT e03 "Winter Quarters": a full stealth solution, played only with player orders (docs/expansion/e03.md
 * §11). Driver API: tools/solutions/driver.mjs; sneaking helpers: tools/solutions/sneak.mjs. Reference run headless:
 *   node tools/solutions/run-headless.mjs e03            (--easy for the Easy data)
 * in the game: tests/e03-solution.test.mjs. Walkthrough: e03.walkthrough.mjs.
 *
 * Every knock-out is from behind and unwitnessed, every man knocked out is cuffed and carried where no cone ever
 * reaches (a bound man seen is freed and both shout), and no commando is ever inside a live cone (the driver's
 * exposure watch). The only alarm is the main mast coming down, fired by radio from the ferry at the far bank.
 */
import { sneak, clearFor, clearForGen, unwitnessed, bodySeen, bodySeenGen, predict, walking } from './sneak.mjs';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { predictEnemy } from './driver.mjs';
import { recognises } from '../../src/ai/bcd-ranks.js';
import { mirrorOf, ghostOn } from './ghost.mjs';
import { E03 } from '../../src/missions/expansion/e03-layout.js';

const E03K = { KERB: E03.KERB, KERB_LOOK: E03.ZK_LOOP[0].look };

const DBG = !!globalThis.process?.env?.E03DBG;

/** The man as the guards see him standing (a blow, a stand-up). */
const bare = (u) => ({ x: u.x, z: u.z, y: u.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });
const near = (a, x, z, r) => Math.hypot(a.x - x, a.z - z) <= r;
const tagOf = (v) => (typeof v === 'string' ? v : v.tag);

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

/** Does `e` — his body as it stands, his head's sweep as it will run — see a man standing at `p` in the next `ahead` s? */
function seesNow(D, e, p, ahead = 1.0) {
  const man = bare(p);
  for (let t = 0; t <= ahead + 1e-6; t += 0.1) if (canSee(e, man, D.world, { cone: coneAt(e, D.world.time + t) }) !== 'none') return true;
  return false;
}

let dbgN = 0;
const DBG_EVERY = +(globalThis.process?.env?.E03DBG_EVERY || 120);
function dbg(D, why, label) { if (DBG && dbgN++ % DBG_EVERY === 0) D.log(`DBG ${D.t.toFixed(1)} ${label}: [${why.join(' ')}]`); return false; }

const KO_ID = { greenberet: 'knockoutFist', spy: 'knockoutChloroform', driver: 'knockoutClub' };

/**
 * `role` knocks `victim` out from behind once `ready()` holds, he is within `reach`, the victim's cone will not hold
 * him for `ahead` s, nobody else sees the blow (nor him walking in), and the man down will lie unseen for `quiet` s
 * (`later`: men who will be down by then). With `cuff`, the knocker (GB / Spy) cuffs him at once.
 */
async function knockOut(D, role, victim, { ready = () => true, reach = 2.6, ahead = 1.8, quiet = 20, later = [], maxSec = 300, cuff = true, via = null, label = '', ignore = [] } = {}) {
  // (`ignore`: men whose look-ahead is wrong now — one held facing the Spy by his talk: their present cone is checked instead)
  const u = D.c(role), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t));
  await D.until(() => {
    why.length = 0;
    if (!ready()) return dbg(D, ['not ready', `${victim.tag}@(${victim.x.toFixed(1)},${victim.z.toFixed(1)}) ${victim.brain?.state} ri${victim.brain?.routeIndex} atW${victim.brain?.atWait ? 1 : 0} wT${(victim.brain?.waitT ?? 0).toFixed(1)} ko=${victim.ko}`], `ko ${victim.tag}`);
    if (Math.hypot(victim.x - u.x, victim.z - u.z) > reach) return dbg(D, [`far ${Math.hypot(victim.x - u.x, victim.z - u.z).toFixed(1)}`], `ko ${victim.tag}`);
    const me = bare(u);
    if (eyesOn(D, victim, me, ahead)) return dbg(D, ['victim looks'], `ko ${victim.tag}`);
    if (!unwitnessed(D, victim, me, { ahead, strict: true, why, except: ignore })) return dbg(D, why, `ko ${victim.tag}`);
    for (const e of ignore) if (canSee(e, me, D.world) !== 'none' || canSee(e, { x: victim.x, z: victim.z, y: victim.y || 0, kind: 'body' }, D.world) !== 'none') return dbg(D, [`${e.tag} looks now`], `ko ${victim.tag}`);
    const pts = via ? [[u.x, u.z], ...via, [victim.x, victim.z]] : [[u.x, u.z], [(u.x + victim.x) / 2, (u.z + victim.z) / 2], [victim.x, victim.z]];
    if (!clearFor(D, pts, ahead + 0.6 + (via ? via.length * 1.5 : 0), { mode: 'walk', except: [victim, ...ignore], why })) return dbg(D, why, `ko ${victim.tag}`);
    const finders = bodySeen(D, victim.x, victim.z, quiet, { except: [victim, ...later, ...ignore] });
    if (finders.length) return dbg(D, [`body seen by ${finders.join(',')}`], `ko ${victim.tag}`);
    return true;
  }, maxSec, `knock out ${victim.tag}${label ? ' ' + label : ''}`);
  D.ability(role, KO_ID[role], victim);
  await D.until(() => victim.ko === 'stunned' || !victim.alive || victim.brain?.state === 'COMBAT', 10, `${victim.tag} out cold`);
  if (victim.ko !== 'stunned') throw new Error(`${victim.tag} was not knocked out (${victim.brain?.state})`);
  await D.idle(role, 5);
  if (cuff) await cuffMan(D, role, victim, { ignore });
}

/** `role` (GB or Spy) cuffs the stunned `victim` (1.5 s, a suspicious act: unwitnessed). */
async function cuffMan(D, role, victim, { maxSec = 25, ignore = [] } = {}) {
  const u = D.c(role), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  await D.until(() => {
    why.length = 0;
    if (victim.ko !== 'stunned') throw new Error(`${victim.tag} no longer stunned (${victim.ko})`);
    if (Math.hypot(victim.x - u.x, victim.z - u.z) > 3.5) { if (!u.path && !u.isMoving) D.order(role, { type: 'move', x: victim.x, z: victim.z }); return false; }
    if (!unwitnessed(D, victim, bare(u), { ahead: 2.2, strict: true, why, except: ignore })) return dbg(D, why, `cuff ${victim.tag}`);
    return true;
  }, maxSec, `cuff ${victim.tag}`);
  D.ability(role, 'handcuff', victim);
  await D.until(() => victim.ko === 'bound', 8, `${victim.tag} cuffed`);
  await D.idle(role, 5);
}

/** The Spy takes `victim`'s uniform with the hanger (2 s, a suspicious act: unwitnessed) and puts it on (U). */
async function hangerAndDress(D, victim, { dress = true, maxSec = 40 } = {}) {
  const spy = D.c('spy'), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  await D.until(() => {
    why.length = 0;
    if (Math.hypot(victim.x - spy.x, victim.z - spy.z) > 3.5) { if (!spy.path && !spy.isMoving) D.order('spy', { type: 'move', x: victim.x, z: victim.z }); return false; }
    if (!unwitnessed(D, victim, bare(spy), { ahead: 2.6, strict: true, why })) return dbg(D, why, `hanger ${victim.tag}`);
    return true;
  }, maxSec, `hanger ${victim.tag}`);
  D.ability('spy', 'hanger', victim);
  await D.until(() => victim.uniformTaken, 8, `${victim.tag}'s uniform taken`);
  await D.idle('spy', 5);
  if (dress) await dressSpy(D);
}

/** U: the Spy cycles to the uniform `want` (default: the last taken), out of every cone. */
async function dressSpy(D, want = null, { maxSec = 60 } = {}) {
  const spy = D.c('spy');
  const target = want ?? spy.wardrobe?.[spy.wardrobe.length - 1];
  for (let k = 0; k < 6 && !(spy.disguised && spy.uniformType === target); k++) {
    await D.until(() => clearFor(D, [[spy.x, spy.z]], 2.2, { mode: 'walk' }), maxSec, 'a quiet moment to change');
    D.ability('spy', 'uniform');
    await D.idle('spy', 4);
  }
  if (!(spy.disguised && spy.uniformType === target)) throw new Error(`the Spy could not put on the ${target} (${spy.uniformType})`);
}

/** `role` shoulders bound / dead `tag`, carries him along `pts` and puts him down at the last one, unseen. */
async function carryMan(D, role, tag, pts, { maxWait = 180, quiet = 600, label = '' } = {}) {
  // (`quiet`: how long the last spot must stay unseen; 0 = already chosen with dumpFor)
  const u = D.c(role), e = typeof tag === 'string' ? D.get(tag) : tag, why = [];
  const end = pts[pts.length - 1];
  if (u.stance !== 'crawl' && !clearFor(D, [[u.x, u.z], ...pts], 6, { mode: 'walk' })) await D.stance(role, 'crawl');
  await D.until(() => {
    why.length = 0;
    if (!clearFor(D, [[u.x, u.z], ...pts], 6, { mode: 'walk', why })) return dbg(D, why, `carry ${e.tag}`);
    const f = quiet > 0 ? bodySeen(D, end[0], end[1], quiet, { step: 1, except: [e] }) : [];
    if (f.length) return dbg(D, [`at the end seen by ${f.join(',')}`], `carry ${e.tag}`);
    return true;
  }, maxWait, `window to carry ${e.tag}${label ? ' ' + label : ''}`);
  await D.stance(role, 'stand');
  D.ability(role, 'hand', e);
  await D.until(() => u.carrying === e, 10, `${role} shoulders ${e.tag}`);
  for (const p of pts) await D.go(role, p[0], p[1], { tol: 0.5 });
  D.ability(role, 'drop');
  await D.until(() => !u.carrying, 5, `${e.tag} put down`);
  await D.idle(role);
}


/** The first spot of `cands` where a man down would lie unseen for `quiet` s (bodySeen), or null. */
function pickDump(D, cands, quiet = 400, except = []) {
  for (const c of cands) if (!bodySeen(D, c[0], c[1], quiet, { step: 1, except }).length) return c;
  return null;
}
/** pickDump as a generator (the same answer, for D.runSliced: a long look-ahead hands the replay's frame back). */
function* pickDumpGen(D, cands, quiet = 400, except = []) {
  for (const c of cands) if (!(yield* bodySeenGen(D, c[0], c[1], quiet, { step: 1, except })).length) return c;
  return null;
}
/** Wait (up to maxSec) for a dump among `cands` that stays unseen `quiet` s; returns it. */
async function dumpFor(D, cands, { quiet = 400, maxSec = 200, label = 'a dump', except = [] } = {}) {
  let spot = null;
  await D.until(() => !!(spot = pickDump(D, cands, quiet, except)), maxSec, label);
  return spot;
}

/** The first spot of `cands` where a man lying prone stays unseen for `dur` s. */
async function lairFor(D, cands, { dur = 120, maxSec = 300, label = 'a lair', step = dur > 60 ? 0.5 : 0.1 } = {}) {
  let spot = null, n = 0;
  // (a long look-ahead is costly: tried twice a second, at half-second steps)
  await D.until(() => (n++ % 30 === 0) && !!(spot = cands.find((c) => clearFor(D, [c], dur, { mode: 'crawl', step }))), maxSec, label);
  return spot;
}
const atHalt = (e, x, z, r = 0.8) => !!e?.brain?.atWait && Math.hypot(e.x - x, e.z - z) < r;

// never planned through: the camp's mud lanes (the patrol follows prints in them) and the lions' ring
const MUD = [
  [[5, 47.6], [47.6, 47.6], [47.6, 51.4], [5, 51.4]], // the north lane
  [[5, 64.6], [47.6, 64.6], [47.6, 68.4], [5, 68.4]], // the middle lane
  [[39.1, 41], [42.9, 41], [42.9, 87.6], [39.1, 87.6]], // the east lane
];
const RING_OUT = Array.from({ length: 16 }, (_, k) => [E03.RING[0] + 7.8 * Math.cos(k * Math.PI / 8), E03.RING[1] + 7.8 * Math.sin(k * Math.PI / 8)]);
const FORBID = [...MUD, RING_OUT];
const crawlTo = (D, role, x, z, o = {}) => sneak(D, x, z, { mode: 'crawl', role, horizon: 150, forbid: FORBID, ...o, label: o.label ?? `${role} → (${x},${z})` });
const walkTo = (D, role, x, z, o = {}) => sneak(D, x, z, { mode: 'walk', role, horizon: 120, forbid: FORBID, ...o, label: o.label ?? `${role} → (${x},${z})` });

/** The men who would see through the Spy's present uniform (lt, the Oberst, the Gestapo, the dogs…): only their cones matter. */
const recognisers = (D) => { const spy = D.c('spy'); return D.world.enemies.filter((e) => e.alive && !e.removed && e.vision && recognises(e, spy, D.world)); };
/** Everyone else (to leave out of a clearFor for the Spy in uniform). */
const fooled = (D) => { const r = new Set(recognisers(D)); return D.world.enemies.filter((e) => !r.has(e)); };
/** The Spy, in uniform, walks along `pts` once the men who would know him will not see the way for `dur` s. */
async function spyWalk(D, pts, { dur = null, maxSec = 300, label = 'the Spy walks', run = false } = {}) {
  const spy = D.c('spy'), why = [];
  if (!spy.disguised) throw new Error('spyWalk: the Spy is not in uniform');
  await D.stance('spy', 'stand');
  const len = pts.reduce((a, p, k) => a + Math.hypot(p[0] - (k ? pts[k - 1][0] : spy.x), p[1] - (k ? pts[k - 1][1] : spy.z)), 0);
  const T = dur ?? len / 2.0 + 2;
  await D.until(() => { why.length = 0; return clearFor(D, [[spy.x, spy.z], ...pts], T, { mode: 'walk', except: fooled(D), why }) || dbg(D, why, label); }, maxSec, label);
  for (const p of pts) await D.go('spy', p[0], p[1], { tol: 0.6, run });
}
/** Oberst Ansbach (and his two black coats) at the drawing room's French windows, their backs to the lawn, `left` s more. */
const ansbachIn = (D, left = 0) => { const a = D.get('ansbach'); return !!a && atHalt(a, ...E03.ANSBACH_IN, 1.2) && a.brain.waitT > left; };

// the hall's south door and the lawn in front of it
const LAIR_T1 = [70.2, 56.6]; // behind the sergeant at the lawn road's bend (he looks east over the lawn)
const SPY_WALL = [70.6, 33.2]; // the hall's south wall west of the door: the chief at his table cannot see it
const SPY_WAIT = [71, 63]; // by the big top's north side: out of the chief's walk, the dogs' and the Oberst's sight
const STRINGS = [74, 42.5]; // the controller lying in the grass: the sergeant's post and the doorway both in reach and in sight
const DOORWAY = [79.4, 31.0]; // just inside the south door's west half, behind hd1
const PUPPET_IN = [80.6, 32.1]; // the sergeant's spot in the door's east half, beside the Spy and within talking reach of hd1
const PUPPET_WALK = [[73.4, 46.4], [75.2, 40.4], [81.4, 35.4]]; // his walk to the door, round the hay cart's west end
const SPY_ASIDE = [78.9, 29.9]; // a step aside: the Spy's talk breaks off
const STRIKE_HD1 = [79.3, 35.4]; // behind hd1, on the lawn side
const CORNER = [[100.7, 34.4], [100.7, 36.8]]; // outside the hall's south-east corner: no cone reaches it
const HIDE = [[73.8, 31.05], [73.8, 29.95]]; // behind the jumps stacked inside the S door: the two bodies (a man standing
// here is also out of the dogs' sight through the west door)
const LIE_SPY = [72.2, 30.95], LIE_GB = [72.2, 29.85]; // the Spy and the Green Beret, lying beyond them (out of the chief's sight)
const SAP_LIE = [71.0, 30.4]; // the Sapper's place behind the jumps
const SAP_BANK = [[27, 98.4], [25, 98.6], [29, 98.2], [23, 98.8], [27, 97.4]]; // the Sapper's first hop east along the bank
const MAR_BANK = [[19, 98.8], [21, 98.6], [17, 99], [20, 97.6]]; // the Marine's
const SAP_BALES = [[49, 87], [47.4, 89], [49.2, 88.4], [47.6, 87.2]]; // the Sapper's wait beside the hay bales (the Spy's nook is (49, 85))
const MARINE_REEDS = [[38.4, 98.6], [37.2, 98.4], [36.0, 98.8], [39.4, 99.0]]; // the reeds W of the landing's steps
const EAST_IN = [98.2, 21.8]; // inside the hall by the east door, out of hd2's sight (he looks into the field)
const SPARES = [[98.4, 9.2], [99.2, 10.2], [98.0, 8.6]]; // behind the radio spares in the hall's NE corner: out of the operators' sight
const DOOR_E_IN = [99.4, 20.6]; // lying in the east doorway
const MAST_SPOT = [127.4, 15.4]; // the main mast's foot (the charge's marker, south side)
const BOARD = [[43.4, 99.4], [44.6, 99.4], [43.4, 98.4], [44.6, 98.4]]; // on the landing stage, by the ferry
/**
 * Will any of the camp patrol be on the east lane's south end or at its south-east corner (looking down the lane at the
 * landing and the river) in the next `dur` s?
 */
function patrolNearLanding(D, dur) {
  for (const tag of ['p1a', 'p1b', 'p1c']) {
    const p = D.get(tag);
    if (!p?.alive) continue;
    if (p.x > 36 && p.z > 50) return true;
    for (let t = 0; t <= dur; t += 0.25) { const q = predictEnemy(p, t); if (q.x > 36 && q.z > 50) return true; }
  }
  return false;
}

/**
 * How long until the mast field's walker can look through the hall's east doorway (on his walk back west he faces
 * it, and from 35 m in he sees into the hall's east end)? 0 when he can now.
 */
function m1Blind(D) {
  const m = D.get('m1'), b = m?.brain;
  if (!m?.alive || m.ko) return 1e9;
  const v = m.speed || 1, ri = b?.routeIndex ?? 0, halt = (i) => m.route?.[i]?.wait ?? 6;
  const back = 5 / v; // from the east end, 5 m of his walk west before the door is within 36 m
  if (ri === 1 && !b.atWait) return (140 - m.x) / v + halt(1) + back; // walking east
  if (ri === 1 && b.atWait) return b.waitT + back; // at the east end, looking out east
  if (ri === 0 && b.atWait) return b.waitT + 32 / v + halt(1) + back; // at the west end, looking north
  return m.x > 135 ? (m.x - 135) / v : 0; // walking west
}

/**
 * Is there a moment between `t0` and `t1` s from now when the field's walker will be blind to the east doorway for at
 * least `need` s (m1Blind, as it will read then)? His PINGPONG between (108, 10) and (140, 10), its halts and his pace
 * stepped forward from his present phase.
 */
function m1BlindWithin(D, t0, t1, need) {
  const m = D.get('m1'), b = m?.brain;
  if (!m?.alive || m.ko) return true;
  if (!(t1 >= t0)) return false;
  const v = m.speed || 1, wW = m.route?.[0]?.wait ?? 6, wE = m.route?.[1]?.wait ?? 6, L = 32 / v, back = 5 / v;
  // phases: 0 walking east, 1 halt at the east end, 2 walking west, 3 halt at the west end; `left`: s to the phase's end
  let ph, left;
  const ri = b?.routeIndex ?? 0;
  if (ri === 1 && !b.atWait) { ph = 0; left = (140 - m.x) / v; }
  else if (ri === 1) { ph = 1; left = b.waitT; }
  else if (!b?.atWait) { ph = 2; left = (m.x - 108) / v; }
  else { ph = 3; left = b.waitT; }
  const blind = () => (ph === 0 ? left + wE + back : ph === 1 ? left + back : ph === 3 ? left + L + wE + back : Math.max(0, left - 27 / v));
  const DUR = [L, wE, L, wW];
  for (let t = 0; t <= t1; t += 0.5) {
    if (t >= t0 && blind() > need) return true;
    left -= 0.5;
    while (left <= 0) { ph = (ph + 1) % 4; left += DUR[ph]; }
  }
  return false;
}

const BINDER_IN = [[77.6, 27.2], [88, 28], [93.2, 27.4]], BINDER_OUT = [[88, 28], [77.6, 27.2], [74.4, 29.6], LIE_SPY];
/** The Spy's walk down the hall to the chief's table and back to the jumps: nobody who would know the coat sees it. */
const binderClear = (D) => { const spy = D.c('spy'); return clearFor(D, [[spy.x, spy.z], ...BINDER_IN, ...BINDER_OUT], 28, { mode: 'walk', except: fooled(D) }); };
/** The Spy walks down the hall behind the operators' backs, takes the key-table binder and comes back behind the jumps. */
async function binderRun(D, [taken, back]) {
  const binder = D.item('binder');
  await D.stance('spy', 'stand');
  for (const p of BINDER_IN) await D.go('spy', p[0], p[1], { tol: 0.6 });
  D.ability('spy', 'hand', binder);
  await D.until(() => D.world.objectives.find((o) => o.id === 'o1')?.done, 10, 'the binder in hand');
  taken();
  for (const p of BINDER_OUT) await D.go('spy', p[0], p[1], { tol: 0.6 });
  await D.stance('spy', 'crawl');
  back();
}

/**
 * Will the gate walker (d1: down the road along the hall's west side and back) see the sergeant's post at the lawn
 * road's bend — a man standing at his back — in the next `dur` s? (walking south he looks down the road at it)
 */
const T1_BACK = [72.1, 55.2]; // where the Green Beret stands to fist the sergeant
function d1SeesBend(D, dur) {
  const d1 = D.get('d1');
  if (!d1?.alive || d1.ko) return false;
  return eyesOn(D, d1, bare({ x: T1_BACK[0], z: T1_BACK[1] }), dur) || eyesOn(D, d1, bare({ x: E03.T1[0], z: E03.T1[1] }), dur);
}

/** The chief is walking home from the villa or sits at his table (not on his way out, not at the veranda). */
function chiefHomeward(D) {
  const b = D.get('lt')?.brain;
  if (!b) return true;
  const ri = b.routeIndex ?? 0;
  return (ri === 0 && !!b.atWait) || ((b.routeDir ?? 1) < 0 && !(ri === 4 && b.atWait));
}

/** The chief is at the veranda with under `left` s of his report to go (or already walking home): time to clear off. */
function ltTurning(D, left) {
  const lt = D.get('lt'), b = lt?.brain;
  if (!lt?.alive || !b) return false;
  const ri = b.routeIndex ?? 0;
  if ((b.routeDir ?? 1) < 0 && !(ri === 0 && b.atWait)) return true; // walking home (at the table he is not)
  return ri === 4 && !!b.atWait && b.waitT < left;
}

/**
 * Will the camp patrol come along the north lane's east end (it looks east up the lawn road there: the sergeant's post
 * is in its view) in the next `dur` s? (its turn south at the corner is where a look-ahead is least sure of him)
 */
function patrolOnNorthLane(D, dur) {
  const p = D.get('p1a');
  if (!p?.alive) return false;
  for (let t = 0; t <= dur; t += 0.25) {
    const q = predictEnemy(p, t);
    if (q.x > 33 && q.z < 46) return true;
  }
  return p.x > 33 && p.z < 46;
}

/**
 * The chief is out on the lawn walking to the villa, past the door, or reporting at the veranda — and stays so for
 * `need` s (the halt there is 30 s; on the way back he faces the door from the lawn path).
 */
function ltAway(D, need) {
  const lt = D.get('lt');
  if (!lt?.alive) return true;
  const b = lt.brain;
  // route: 0 table · 1 (80,29.5) · 2 (80,36) · 3 (93,50) · 4 veranda foot; out = dir +1
  const ri = b.routeIndex ?? 0, out = (b.routeDir ?? 1) > 0;
  const past = (out && ri >= 3 && lt.z > 37.5) || (ri === 4 && b.atWait);
  if (!past) return false;
  // time left before he turns back from the veranda: the rest of the walk out + the halt there
  const left = ri === 4 && b.atWait ? b.waitT : Math.hypot(lt.x - E03.VERANDA_FOOT[0], lt.z - E03.VERANDA_FOOT[1]) / (lt.speed || 1) + (lt.route?.[4]?.wait ?? 30);
  return left >= need;
}

// ------------------------------------------------------------------ the others move up meanwhile
/**
 * While the Spy waits on the trainer's round and the chief's, the Sapper and the Marine move up from the willows a hop
 * at a time, as a player moves his other men while one waits: the next hop (stage B lists them) goes once the play
 * has been quiet (no order) for PACE_QUIET s and the lair at its end will stay unseen for its `dur` s. A stage that
 * needs one of them takes him over (`claim`): his hops not yet made he makes at once.
 */
const PACE_QUIET = 85;
/** The first of `cands` where a man lying prone stays unseen for `dur` s (sliced: a long look-ahead hands the frame back). */
async function lairNow(D, cands, dur) {
  for (const c of cands) if (await D.runSliced(clearForGen(D, [c], dur, { mode: 'crawl', step: 0.5 }))) return c;
  return null;
}
async function pacer(D, pace) {
  let n = 0;
  while (!pace.done) {
    const h = pace.hops[0];
    let spot = null;
    await D.untilAsync(async () => {
      if (pace.done || pace.hops[0] !== h) return true;
      if (!h || D.t - pace.lastOrderT < PACE_QUIET || n++ % 10) return false;
      return !!(spot = await lairNow(D, h.cands, h.dur));
    }, 1e5, '');
    if (pace.done) return;
    if (!h || pace.hops[0] !== h || !spot) continue;
    pace.hops.shift();
    pace.busy = h.role;
    try { await hop(D, h, spot); } finally { pace.busy = null; }
  }
}
/** A stage takes `role` over from the pacer: his hop under way ends first, the ones not yet made he makes now. */
async function claim(D, role) {
  const pace = D.pace;
  if (!pace) return;
  await D.until(() => pace.busy !== role, 600, `the ${role} at his place`);
  const mine = pace.hops.filter((h) => h.role === role);
  pace.hops = pace.hops.filter((h) => h.role !== role);
  for (const h of mine) await hop(D, h, await lairFor(D, h.cands, { dur: h.dur, maxSec: 900, label: h.label }));
}
/** The pacer stops (every hop made or taken over): it leaves its wait at the next tick. */
function endPacer(D) {
  const pace = D.pace;
  if (!pace) return;
  if (pace.hops.length || pace.busy) throw new Error(`endPacer: hops still to make (${pace.hops.map((h) => h.label).join(', ')}${pace.busy ? `; ${pace.busy} on his way` : ''})`);
  pace.done = true;
}
/** One hop: the crawl to `spot`, and its checkpoint (`h.cp`). */
async function hop(D, h, spot) {
  await crawlTo(D, h.role, ...spot, { label: h.label });
  h.cp();
}

// ------------------------------------------------------------------ the stages
export const STAGES = [
  ['A', 'The landing sentry', async (D) => {
    const r1 = D.get('r1');
    for (const r of ['greenberet', 'spy', 'sapper', 'diver']) await D.stance(r, 'crawl');
    D.checkpoint('A0 the team lies down among the willows');
    // the Green Beret crawls east along the bank to r1's back (he looks east along the towpath); the Spy behind him
    await crawlTo(D, 'greenberet', r1.x - 3.2, r1.z + 1.4, { label: 'the Green Beret along the bank to r1' });
    await crawlTo(D, 'spy', r1.x - 6.5, r1.z + 2.4, { label: 'the Spy behind him' });
    D.checkpoint('A1 the Green Beret and the Spy crawl along the bank behind r1');
    // the whole job (blow, cuffs, hanger, the carry west) wants the landing unwatched for ~50 s: the camp patrol
    // looks down the east lane at it only while it walks south, so go as it turns west along the south lane
    // (the camp patrol's south-west corner looks down the west lane: no line of sight from there to the dump)
    const CORNER = [[7.5, 66.5], [8.9, 66.7], [10.2, 67.4], [7, 60], [6.6, 72]];
    const hidden = (c) => CORNER.every(([x, z]) => !D.world.grid.lineOfSight(x, z, c[0], c[1]));
    const WILLOWS = [[13, 99], [15, 99], [11, 99], [9, 99], [5, 99], [3, 99], [1.4, 97.4], [11, 97], [15, 97], [9, 97.2]].filter(hidden);
    const willow = await dumpFor(D, WILLOWS, { quiet: 900, maxSec: 400, label: 'a hidden spot in the willows', except: [r1] });
    const job = [[r1.x, r1.z], [r1.x - 3, r1.z + 1.5], [38, 96.5], [28, 97], [18, 96.5], willow];
    await D.until(() => clearFor(D, job, 50, { mode: 'walk', except: [r1] }), 400, 'a long quiet spell at the landing');
    await knockOut(D, 'greenberet', r1, { reach: 4.2, quiet: 50, label: 'at the landing' });
    D.checkpoint('A2 the Green Beret fists r1 from behind and cuffs him');
    await hangerAndDress(D, r1, { dress: false });
    D.checkpoint('A3 the Spy takes r1\'s tunic with the hanger');
    await D.stance('spy', 'crawl');
    await D.parallel(
      () => crawlTo(D, 'spy', 8, 91.5, { label: 'the Spy back into the willows' }),
      async () => {
        await carryMan(D, 'greenberet', r1, [[36, 96.6], [24, 96.8], [12, 95.8], willow], { maxWait: 120, quiet: 0, label: 'into the willows' });
        await D.stance('greenberet', 'crawl');
      },
    );
    D.checkpoint('A4 the Green Beret carries r1 into the willows; the Spy crawls back');
  }],
  ['B', 'The manager and the trainer', async (D) => {
    const mgr = D.get('mgr'), zk = D.get('zk');
    // the manager (the snitch) halts 10 s at the south-west corner of his round, looking east down the lane. The Green
    // Beret lies behind the last wagon (it hides him from the manager walking down the west lane), rounds its west end
    // behind him and fists him; the strip south of the last row is a place nobody ever looks
    const lair = [11.2, 83.2];
    await crawlTo(D, 'greenberet', ...lair, { label: 'the Green Beret behind the last wagon' });
    D.checkpoint('B1 the Green Beret crawls behind the last wagon of the camp');
    const CORNER = [[7.5, 66.5], [8.9, 66.7], [10.2, 67.4], [7, 60], [6.6, 72]];
    const STRIP = [[11, 85.4], [13.4, 86.2], [9, 86], [15.5, 85.4], [19, 85.6], [7.2, 85.2]].filter((c) => CORNER.every(([x, z]) => !D.world.grid.lineOfSight(x, z, c[0], c[1])));
    // the trainer stands at the ring's south-west kerb with his back to the camp while the lions work (40 s, then his
    // round of the paddock, the menagerie tent and his wagon: about five minutes). The Spy lies under the canvas's
    // south half, where nobody looks, crawls up behind him and chloroforms him, carries him back under the canvas and
    // takes his grey coat there
    const KERB = E03K.KERB, back = E03K.KERB_LOOK + 180;
    const STRIKE = [KERB[0] + 2.1 * Math.cos(back * Math.PI / 180), KERB[1] + 2.1 * Math.sin(back * Math.PI / 180)];
    const CANVAS = [[57, 85], [55, 85], [59, 85], [57, 87], [55, 87], [59, 87], [55, 83], [53, 85], [57, 83]];
    const crawler = (x, z) => ({ x, z, y: 0, isLow: true, isVisibleToEnemies: true, alive: true, kind: 'commando' });
    await D.parallel(
      async () => {
        await knockOut(D, 'greenberet', mgr, { ready: () => atHalt(mgr, 9.5, 76.6) && !!pickDump(D, STRIP, 900, [mgr]), reach: 9, quiet: 30, maxSec: 700, via: [[8, 82], [8.2, 78.2]], label: 'at his south-west halt' });
        D.checkpoint('B2 the Green Beret fists the manager at his halt and cuffs him');
        const lee = await dumpFor(D, STRIP, { quiet: 900, maxSec: 60, label: 'a lee for the manager', except: [mgr] });
        await carryMan(D, 'greenberet', mgr, [[8, 82], lee], { maxWait: 90, quiet: 0, label: 'behind the last wagon' });
        await D.stance('greenberet', 'crawl');
        D.checkpoint('B3 the Green Beret carries him behind the last wagon row');
      },
      // (meanwhile the Spy crawls east behind the wagons to the hay bales at the big top's west edge, ready for the
      // trainer's next turn at the ring: he comes back to the kerb from the camp looking south-east, over the
      // canvas's south half — the bales are where neither his walk-in nor anyone else ever looks)
      async () => {
        const nook = await lairFor(D, [[49, 85], [49, 87], [49, 83.4], [47.4, 89]], { dur: 60, maxSec: 300, label: 'a lair by the hay bales' });
        await crawlTo(D, 'spy', ...nook, { label: 'the Spy under the big top\'s canvas' });
        D.checkpoint('B4 the Spy crawls to the canvas\'s west edge, south of the ring');
        const VIA = [(nook[0] + STRIKE[0]) / 2, (nook[1] + STRIKE[1]) / 2];
        // (the cheap checks first, the long look-aheads sliced: the same verdict every tick, and in the live replay no
        // tick waits on more than one slice of it — video-perf's driver-gap bound)
        await D.untilAsync(async () => {
          if (!(atHalt(zk, ...KERB, 1.0) && zk.brain.waitT > 16)) return DBG && atHalt(zk, ...KERB, 1.0) ? dbg(D, [`zk at the kerb wT${zk.brain.waitT.toFixed(1)}`], 'trainer window') : false;
          if (eyesOn(D, zk, crawler(...VIA), 10) || eyesOn(D, zk, crawler(...STRIKE), 10)) return dbg(D, ['zk looks'], 'trainer window');
          await D.breathe();
          const f = await D.runSliced(bodySeenGen(D, zk.x, zk.z, 16, { except: [zk] }));
          if (f.length) return dbg(D, [`kerb seen by ${f.join(',')}`], 'trainer window');
          const why = [];
          if (!(await D.runSliced(clearForGen(D, [nook, VIA, STRIKE], 12, { mode: 'crawl', except: [zk], why })))) return dbg(D, ['path', ...why], 'trainer window');
          if (!(await D.runSliced(clearForGen(D, [STRIKE, CANVAS[0]], 24, { mode: 'walk', except: [zk], why })))) return dbg(D, ['carry path', ...why], 'trainer window');
          if (!(await D.runSliced(pickDumpGen(D, CANVAS, 900, [zk])))) return dbg(D, ['no dump'], 'trainer window');
          return true;
        }, 900, 'the trainer at the kerb, the camp looking elsewhere');
        await D.go('spy', ...STRIKE, { tol: 0.5 });
        await knockOut(D, 'spy', zk, { reach: 3.2, quiet: 12, maxSec: 20, label: 'at the ring kerb' });
        D.checkpoint('B5 the Spy chloroforms the trainer at the kerb and cuffs him');
        const den = await dumpFor(D, CANVAS, { quiet: 900, maxSec: 10, label: 'a place under the canvas for the trainer', except: [zk] });
        await carryMan(D, 'spy', zk, [den], { maxWait: 10, quiet: 0, label: 'under the canvas' });
        D.checkpoint('B6 the Spy carries the trainer back under the canvas');
        await hangerAndDress(D, zk, { dress: false });
        await D.stance('spy', 'crawl');
        D.checkpoint('B7 the Spy takes the trainer\'s grey coat');
      },
      // meanwhile the Sapper and the Marine move up from the willows, a hop at a time while the others wait (the
      // pacer: the next hop when the play has been quiet a while; F and G take them over if a hop is still to make)
      async () => {
        D.pace?.hops.push(
          { role: 'sapper', cands: SAP_BANK, dur: 300, label: 'the Sapper east along the bank', cp: () => D.checkpoint('B8 meanwhile the Sapper crawls east along the bank from the willows') },
          { role: 'diver', cands: MAR_BANK, dur: 300, label: 'the Marine east along the bank', cp: () => D.checkpoint('B9 the Marine follows him along the bank') },
          { role: 'sapper', cands: SAP_BALES, dur: 300, label: 'the Sapper to the hay bales', cp: () => D.checkpoint('B10 the Sapper crawls on to the hay bales at the big top\'s west edge') },
          { role: 'diver', cands: MARINE_REEDS, dur: 600, label: 'the Marine into the reeds by the landing', cp: () => D.checkpoint('B11 the Marine crawls on into the reeds beside the ferry landing') },
        );
      },
    );
  }],
  ['C', 'To the lawn', async (D) => {
    // the Spy puts on the trainer's grey coat — privates and sergeants take him for the circus's man — and walks round
    // the big top's north side to wait by it
    await dressSpy(D, 'zookeeper');
    D.checkpoint('C1 the Spy puts on the trainer\'s coat');
    await spyWalk(D, [[60, 66], [64, 66.5], SPY_WAIT], { label: 'the Spy to the big top\'s north side' });
    D.checkpoint('C2 the Spy, in the coat, walks round the big top to its north side');
  }],
  ['D', 'The door sentry and the strings', async (D) => {
    const t1 = D.get('t1'), hd1 = D.get('hd1'), spy = D.c('spy'), gb = D.c('greenberet');
    // while the chief sits at his table (the hall's wall between them), the Spy walks to the south wall beside the door;
    // the window is the chief's walk out to the villa with the camp patrol away from the north lane — if the patrol
    // spoils it, the Spy is back by the big top before the chief turns home, and tries the next round
    const lt = D.get('lt');
    for (let round = 0; ; round++) {
      if (round > 6) throw new Error('no window at the door');
      // the Green Beret crawls from the camp's south strip round the big top to the lawn road's bend, behind the
      // sergeant posted there (t1 looks east over the lawn), when the chief walks home from the villa: his minute at
      // the table and his walk out are still to come. (By the big top's north-west side: the last stretch comes at
      // the sergeant from behind his left shoulder, where his sweep never reaches — from due south it does.)
      if (!near(gb, ...LAIR_T1, 1.0)) {
        await D.until(() => chiefHomeward(D), 3000, 'the chief walking home from the villa');
        await crawlTo(D, 'greenberet', 60, 64, { label: 'the Green Beret round the big top' });
        await crawlTo(D, 'greenberet', ...LAIR_T1, { label: 'the Green Beret behind the sergeant' });
        D.checkpoint('D1 the Green Beret crawls round the big top to the sergeant\'s back');
      }
      // (the Spy walks over in the last 45 s of the chief's minute at his table: no need to stand at the wall longer)
      await D.until(() => atHalt(lt, ...E03.TABLE_STAND, 1.2) && lt.brain.waitT > 12 && lt.brain.waitT < 45, 1200, 'the chief at his table');
      await D.go('spy', ...SPY_WALL, { tol: 0.5 });
      let open = false;
      // (and the gate walker not about to come down the road looking at the bend: the blow would have to wait for him,
      // and the whole job must be done before the chief walks home past the door)
      await D.until(() => (open = ltAway(D, 54) && !patrolOnNorthLane(D, 40) && !d1SeesBend(D, 24)) || ltTurning(D, 16), 400, 'the chief out to the villa, the camp patrol in the camp');
      if (open) break;
      await D.go('spy', ...SPY_WAIT, { tol: 0.6 });
    }
    D.checkpoint('D2 the chief walks out to the villa to report');
    // the Spy steps into the doorway behind hd1 and talks to him: hd1 turns round, his back to the lawn
    await D.go('spy', ...DOORWAY, { tol: 0.4 });
    D.ability('spy', 'distract', hd1);
    await D.until(() => hd1.brain?.distractedBy === spy, 10, 'hd1 turns to the Spy');
    D.checkpoint('D3 the Spy talks to the door sentry from the doorway: he turns his back on the lawn');
    // the Green Beret comes out of the grass at the sergeant's back: one blow, the cuffs
    await knockOut(D, 'greenberet', t1, { ready: () => hd1.brain?.distractedBy === spy && !patrolOnNorthLane(D, 26), reach: 9, ahead: 1.2, quiet: 22, maxSec: 45, label: 'behind the sergeant', ignore: [hd1] });
    D.checkpoint('D4 the Green Beret fists t1 from behind and cuffs him');
    // he lies down by the hall's south wall and takes the sergeant on strings: t1 stands up and walks into the doorway
    await D.stance('greenberet', 'crawl');
    await D.go('greenberet', ...STRINGS, { tol: 0.4 });
    D.ability('greenberet', 'puppet', t1);
    await D.until(() => t1.puppetOf === gb, 5, 't1 on strings');
    // (round the hay cart's west end: the cart must never come between him and the man holding the strings)
    for (const p of [...PUPPET_WALK, PUPPET_IN]) {
      D.order('greenberet', { type: 'move', x: p[0], z: p[1], run: true });
      await D.until(() => Math.hypot(t1.x - p[0], t1.z - p[1]) < 0.8 || (!t1.isMoving && !t1.path), 30, 't1 walks on strings');
      if (Math.hypot(t1.x - p[0], t1.z - p[1]) > 1.2) throw new Error(`the puppet stopped at (${t1.x.toFixed(1)},${t1.z.toFixed(1)}) short of (${p})`);
    }
    D.checkpoint('D5 on strings, the sergeant walks across the lawn and into the doorway');
    // the Spy steps aside (his talk breaks off) and in the same moment the sergeant talks to hd1: hd1 never turns
    // back to the lawn (two orders in one breath: no tick between them)
    D.order('spy', { type: 'move', x: SPY_ASIDE[0], z: SPY_ASIDE[1] });
    D.ability('greenberet', 'puppetDistract', hd1);
    await D.until(() => hd1.brain?.distractedBy === t1, 10, 'hd1 turns to the puppet');
    await D.until(() => !spy.isMoving && !spy.path, 10, 'the Spy aside');
    D.checkpoint('D6 the sergeant on strings takes over the talk: hd1 faces the hall, talking to his sergeant');
    await D.go('spy', ...STRIKE_HD1, { tol: 0.4 });
    await knockOut(D, 'spy', hd1, { reach: 3, ahead: 1.2, quiet: 6, maxSec: 20, label: 'from the lawn side' });
    D.checkpoint('D7 the Spy chloroforms hd1 from behind and cuffs him');
    // the Green Beret lets the sergeant sit down; both men are carried a few paces into the hall, behind the jumps
    // stacked against the wall by the door: the chief's table, the door and the lawn all lose sight of them there
    D.ability('greenberet', 'puppet', t1);
    await D.until(() => !t1.puppetOf && t1.ko === 'bound', 5, 't1 released');
    await D.parallel(
      () => carryMan(D, 'spy', hd1, [[79.4, 30.6], [77.2, 28.7], [74.2, 29.5], HIDE[0]], { maxWait: 20, quiet: 0, label: 'hd1 behind the jumps' }),
      async () => {
        await D.until(() => clearFor(D, [[gb.x, gb.z], [77.6, 37], [80.4, 33.4]], 8, { mode: 'walk' }), 30, 'the Green Beret up to the door');
        await D.stance('greenberet', 'stand');
        await D.go('greenberet', 79.6, 33.6, { tol: 0.6 });
        await carryMan(D, 'greenberet', t1, [[79.8, 30.4], [77.4, 28.4], HIDE[1]], { maxWait: 30, quiet: 0, label: 't1 behind the jumps' });
      },
    );
    D.checkpoint('D8 hd1 and the sergeant are carried into the hall behind the jumps by the door');
  }],
  ['E', 'The key tables', async (D) => {
    // the Green Beret lies down beyond t1, on the north side of the two bodies. If the chief is still out at the villa,
    // the Spy walks on down the hall behind the operators' backs to the table, takes the binder and comes back to lie
    // down beyond hd1, on the south side (nobody else here knows the coat); if the chief is already walking home, the
    // Spy lies down there at once and the binder waits until the chief has been dealt with (F). (Each lies on his own
    // side: two crawls through the 1.1 m between the bodies at once crossed there and stopped each other.)
    await D.parallel(
      async () => { await D.stance('greenberet', 'crawl'); await D.go('greenberet', ...LIE_GB, { tol: 0.4 }); },
      async () => {
        const cps = [
          () => D.checkpoint('E1 the Spy walks down the hall behind the operators and takes the key-table binder from the chief\'s table'),
          () => D.checkpoint('E2 back behind the jumps with it: the chief can no longer drop it down the well'),
        ];
        let now = false;
        await D.until(() => (now = binderClear(D)) || !ltAway(D, 0), 4, '');
        if (now) { await binderRun(D, cps); return; }
        await D.stance('spy', 'crawl');
        await D.go('spy', ...LIE_SPY, { tol: 0.4 });
        D.binderLater = cps;
        D.checkpoint('E3 the chief is walking home already: the Spy lies down behind the jumps, and the binder waits for him to be dealt with');
      },
    );
  }],
  ['F', 'The main mast', async (D) => {
    const hd2 = D.get('hd2'), lt = D.get('lt'), m1 = D.get('m1'), gb = D.c('greenberet');
    let chiefDown = false, fieldClear = false, binderDone = !D.binderLater;
    await D.parallel(
      async () => {
        // with the binder gone the chief no longer matters to the well, but from his table he would see the hall's
        // east half worked. When he sits down again (facing the door, his back to the receivers) the Green Beret
        // crawls out of the jumps' shadow (lying, he is too far for the chief's eyes), stands where the chief's look never
        // reaches and walks along behind the operators' backs to the middle of the hall north of the table: a place the
        // mast field's walker cannot see through the east doorway. There he waits for the walker to turn his back on the
        // doorway — the table and the last steps to it are in his view — and takes the chief from behind.
        const BEHIND_LT = [[72.6, 22.2], [80, 20.8], [88, 20.6]];
        const OUT_OF_SHADOW = [[72.6, 27.6], BEHIND_LT[0]];
        const BLOW = 22; // s the walker must have his back to the doorway: the last steps, the blow, the cuffs, the carry out of his view
        await D.until(() => atHalt(lt, ...E03.TABLE_STAND, 1.2) && lt.brain.waitT > 38
          && m1BlindWithin(D, 20, lt.brain.waitT - 12, BLOW)
          && clearFor(D, [[gb.x, gb.z], ...OUT_OF_SHADOW], 12, { mode: 'crawl' })
          && clearFor(D, BEHIND_LT, 24, { mode: 'walk', except: [lt] }) && BEHIND_LT.every((p) => !eyesOn(D, lt, bare({ x: p[0], z: p[1] }), 24)), 1500, 'the chief back at his table');
        for (const p of OUT_OF_SHADOW) await D.go('greenberet', p[0], p[1], { tol: 0.5 });
        await D.stance('greenberet', 'stand');
        for (const p of BEHIND_LT.slice(1)) await D.go('greenberet', p[0], p[1], { tol: 0.5 });
        D.checkpoint('F1 the chief back at his table: the Green Beret crawls out of the jumps\' shadow and walks up behind the operators\' backs');
        await knockOut(D, 'greenberet', lt, { ready: () => m1Blind(D) > BLOW, reach: 7, ahead: 1.6, quiet: 12, maxSec: 60, label: 'at his table' });
        D.checkpoint('F2 the field\'s walker turns his back on the east door: the Green Beret takes the chief from behind, one blow, the cuffs');
        // (north first, out of the walker's view through the doorway, then to the radio spares in the NE corner)
        await carryMan(D, 'greenberet', lt, [[92.2, 21.2], [94.2, 15.8], [98.0, 12.4], SPARES[0]], { maxWait: 20, quiet: 0, label: 'the chief behind the radio spares' });
        chiefDown = true;
        D.checkpoint('F3 he carries him behind the radio spares in the hall\'s north-east corner');
        // hd2 at the east door looks into the mast field, his back to the hall
        // (he waits lying behind the spares while the field's walker comes west: from his walk he sees into the doorway)
        await D.stance('greenberet', 'crawl');
        await D.until(() => m1Blind(D) > 36 && clearFor(D, [[gb.x, gb.z], [99.2, 14], EAST_IN], 8, { mode: 'walk', except: [hd2] }), 600, 'the field walker heading east');
        await D.stance('greenberet', 'stand');
        await D.go('greenberet', 99.2, 14, { tol: 0.5 });
        await D.go('greenberet', ...EAST_IN, { tol: 0.5 });
        await knockOut(D, 'greenberet', hd2, { ready: () => m1Blind(D) > 22, reach: 4, ahead: 1.6, quiet: 14, maxSec: 20, label: 'at the east door' });
        await carryMan(D, 'greenberet', hd2, [[99.2, 19.6], [99.2, 14], SPARES[1]], { maxWait: 20, quiet: 0, label: 'hd2 behind the radio spares' });
        D.checkpoint('F4 hd2 at the east door: the blow from the doorway at his back, and the corner behind the spares');
        // the field's walker: the Green Beret waits in the doorway, follows him out as he turns east, and takes him
        await D.stance('greenberet', 'crawl');
        await D.go('greenberet', ...DOOR_E_IN, { tol: 0.4 });
        // (he leaves the doorway as the walker halts at the field's west end looking north, and closes on his back)
        // (and only once he has turned to look north: as he halts his head sweeps back over the doorway while his body
        // turns — standing up then, he is seen)
        const LOOK_N = ((m1.route?.[0]?.look ?? 270) * Math.PI) / 180;
        await D.until(() => (m1.brain?.routeIndex ?? 0) === 0 && m1.brain?.atWait && m1.brain.waitT > (m1.route?.[0]?.wait ?? 6) - 3
          && Math.abs(Math.atan2(Math.sin(m1.heading - LOOK_N), Math.cos(m1.heading - LOOK_N))) < 0.12 && !seesNow(D, m1, gb, 1.5), 600, 'the field walker at its west end');
        await D.stance('greenberet', 'stand');
        await D.until(() => {
          const d = Math.hypot(m1.x - gb.x, m1.z - gb.z);
          if (d < 2.4) return true;
          const h = m1.heading, bx = m1.x - Math.cos(h) * 1.6 + Math.sin(h) * 0.6, bz = m1.z - Math.sin(h) * 1.6 - Math.cos(h) * 0.6;
          if (m1.brain?.atWait) { if (!gb.path && !gb.isMoving) D.order('greenberet', { type: 'move', x: m1.x + 1.0, z: m1.z + 2.0 }); }
          else if (D.t - (gb._follow ?? -9) > 0.4) { gb._follow = D.t; D.order('greenberet', { type: 'move', x: bx, z: bz }); }
          return false;
        }, 40, 'the Green Beret on the walker\'s heels');
        await knockOut(D, 'greenberet', m1, { reach: 3.2, ahead: 1.2, quiet: 20, maxSec: 10, label: 'in the mast field' });
        // (with him gone the field's north end is nobody's: he can stay where he fell if nobody will see him there)
        const FIELD = [[m1.x, m1.z], [106, 8], [105.4, 12], [107.5, 7.2]];
        const lie = await dumpFor(D, FIELD, { quiet: 600, maxSec: 30, label: 'a place in the field\'s corner', except: [m1] });
        if (Math.hypot(lie[0] - m1.x, lie[1] - m1.z) > 0.5) await carryMan(D, 'greenberet', m1, [lie], { maxWait: 30, quiet: 0, label: 'm1 into the field\'s corner' });
        fieldClear = true;
        await D.stance('greenberet', 'crawl');
        await D.go('greenberet', ...DOOR_E_IN, { tol: 0.6 });
        D.checkpoint('F5 the field\'s walker: followed out of the door as he turns east, and taken from behind');
      },
      // the Sapper: from the hay bales round the big top, up the lawn and in at the south door to the jumps; when the
      // chief is down, along the hall to its east door (out of hd2's sight: he looks into the field); when the field is
      // clear, through its gate to the main mast with the remote charge, and back
      async () => {
        await claim(D, 'sapper');
        await crawlTo(D, 'sapper', ...SAP_LIE, { label: 'the Sapper up the lawn and into the hall' });
        D.checkpoint('F6 the Sapper crawls from the hay bales round the big top and up the lawn into the riding hall, behind the jumps');
        await D.until(() => chiefDown && binderDone, 900, 'the chief down');
        await crawlTo(D, 'sapper', ...EAST_IN, { label: 'the Sapper down the hall' });
        await D.until(() => fieldClear, 900, 'the mast field clear');
        await crawlTo(D, 'sapper', ...MAST_SPOT, { label: 'the Sapper to the main mast' });
        D.ability('sapper', 'remoteBomb');
        await D.until(() => D.world.interactables.some((i) => i.interactKind === 'bomb' && i.placed), 10, 'the charge set');
        await D.idle('sapper', 5);
        D.checkpoint('F7 the Sapper sets the remote charge at the main mast\'s foot');
        await crawlTo(D, 'sapper', ...EAST_IN, { label: 'the Sapper back to the hall' });
        D.checkpoint('F8 the Sapper crawls back into the hall');
      },
      // (the binder, if it waited: once the chief is down the hall has nobody left who knows the coat)
      async () => {
        if (binderDone) return;
        await D.until(() => chiefDown && binderClear(D), 900, 'the chief down: the binder');
        await binderRun(D, D.binderLater);
        binderDone = true;
      },
    );
  }],
  ['G', 'Over the Elbe', async (D) => {
    const ferry = D.world.byId('ferry');
    // everyone back to the landing: the Green Beret and the Sapper down the lawn and along the bank, the Spy in his
    // coat, the Marine from the willows; aboard, the Marine hauls the punt along its cable
    // (out by the south door and down the lawn's west half, under the canvas's south edge, then along the bank)
    const out = async (role, k) => {
      await D.stance(role, 'crawl');
      await crawlTo(D, role, 78.6, 38.6, { label: `the ${role} out of the south door` });
      await crawlTo(D, role, 74.5, 86.5, { label: `the ${role} down the lawn` });
      await crawlTo(D, role, ...BOARD[k], { label: `the ${role} to the landing` });
    };
    await D.parallel(
      () => out('greenberet', 0),
      () => out('sapper', 1),
      () => out('spy', 2),
      async () => {
        await claim(D, 'diver');
        // (the pacer has nobody left to move up: it ends here, on a tick the stages wait on anyway. Left to the end of
        // the run, its last wait stepped the world once more after the win — the scripted run must end where the game does)
        endPacer(D);
        await crawlTo(D, 'diver', ...BOARD[3], { label: 'the Marine out of the reeds onto the landing' });
      },
    );
    D.checkpoint('G1 the four meet at the ferry landing');
    // the camp patrol looks down the east lane at the landing as it comes south: board and cross while it walks the
    // camp's far side (the crewed punt in the water is seen as well as a man standing)
    const CROSS = [...BOARD, [44, 103.6], [44, 107.5], [44, 111.5], E03.EXIT];
    await D.until(() => !patrolNearLanding(D, 30) && clearFor(D, CROSS, 24, { mode: 'walk' }), 400, 'the landing and the river unwatched');
    for (const r of ['diver', 'greenberet', 'sapper', 'spy']) D.ability(r, 'enterVehicle', ferry);
    await D.until(() => D.world.commandos.every((c) => c.vehicle === ferry), 20, 'all aboard');
    D.checkpoint('G2 all four aboard the rope ferry');
    D.order('diver', { type: 'move', x: E03.CABLE[1][0], z: E03.CABLE[1][1] });
    // (mid-river, a few strokes short of the far bank: the charge must be off before the punt lands, or the landing
    // counts as running away with the mast still standing)
    await D.until(() => Math.hypot(ferry.x - E03.EXIT[0], ferry.z - E03.EXIT[1]) < 7.2, 60, 'mid-river');
    D.checkpoint('G3 the Marine hauls the punt across the Elbe');
    D.ability('sapper', 'detonate');
    await D.until(() => D.world.objectives.find((o) => o.id === 'o2')?.done, 10, 'the main mast down');
    D.checkpoint('G4 from mid-river the Sapper fires the charge: the main mast comes down across the hall');
    await D.until(() => D.world.objectives.every((o) => !o.required || o.done), 20, 'mission complete');
  }],
];

export async function solve(D, ctx = {}) {
  const w = D.world;
  D.straightDashes = true;
  w.sneakTurns = true;
  if (DBG) w.events.on('enemy:state', (p) => { const t = p.enemy?.tag; if (/^p1|^c2|^d1|^lt$|^m1$|^m2$|^hd2$/.test(t || '')) D.log(`STATE ${D.t.toFixed(1)} ${t} ${p.from}->${p.to} at (${p.enemy.x.toFixed(1)},${p.enemy.z.toFixed(1)})`); });
  const failed0 = D.failed.bind(D);
  D.failed = () => failed0() || (w.commandos.find((c) => c.downed) ? `${w.commandos.find((c) => c.downed).role} down` : null);
  // (the last order's time, for the pacer: every order and stance change the solution gives)
  const pace = (D.pace = { hops: [], busy: null, done: false, lastOrderT: D.t });
  const order0 = D.order, stance0 = D.stance;
  D.order = (...a) => { const r = order0(...a); pace.lastOrderT = D.t; return r; };
  D.stance = async (...a) => { const r = await stance0(...a); pace.lastOrderT = D.t; return r; };
  await D.parallel(
    async () => {
      try {
        for (const [id, title, fn] of STAGES) {
          if (ctx.from && id < ctx.from) continue;
          ctx.onStage?.(id, title, D.t);
          await fn(D, ctx);
          if (ctx.until && id >= ctx.until) break;
        }
      } finally { pace.done = true; }
    },
    () => pacer(D, pace),
  );
  return D.checkpoints;
}
