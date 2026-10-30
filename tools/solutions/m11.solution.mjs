/**
 * M11 "In the Soup" (Maradah oil field): a full stealth solution, played only with player orders (the driver,
 * tools/solutions/driver.mjs; the space-time sneak planner, tools/solutions/sneak.mjs).
 *
 * Two rules shape it: a man two metres above or below a guard is out of his sight (the roof rule: the plateau, the
 * ridge, the bunker roof and the mesa never see the ground, nor the ground them), and the men inside a vehicle are
 * never seen — a vehicle is only suspect when somebody saw a man climb into it. So the team rides the half-track.
 *
 * The Spy, in a German officer's uniform from the start, does the killing nobody may see: the gate sentry e_g1 (A),
 * the four men of the east valley round the half-track — the walker e21, the Gatling gunner e22 (left in his sandbag
 * ring, where no one sees a body), the post e23 and the arch sentry e24 (B) — each from behind when no one else looks,
 * each carried where no one will look (a disguised man leaves no tracks; a Green Beret carrying a body over the sand
 * would leave a trail for the patrols to follow). Then he talks to the yard patrol's sergeant at its southern halt: the
 * whole file stands facing him while the Driver crawls the yard's north road — behind the back of the yard walker e29
 * while he walks south — and the arch to the half-track, and climbs in (C). While the Spy waits for the patrol to come
 * round to its halt, the Sapper crawls in through gate 1 behind its back and sets a remote bomb under the yard rig (two
 * men at once: the Spy's talk is a side task, D.meanwhile). The half-track fetches the other three at the foot of the
 * west road (D), climbs it the way it faces — no turning round on the cramped forecourt — to the tunnel mouth, where
 * the Sapper sets the second bomb, turns round on the open plateau and comes back down (E); then takes the Sapper to
 * the valley rig (a remote bomb, set prone from the rear doors) and out again, and the Spy leaves the patrol and climbs
 * in (F). Up the west road again onto the ridge over the quarry: when the fuel truck stops between the two quarry rigs
 * the Driver fires the hull gun into it from his seat (both rigs fall), and the Sapper fires his three charges from his
 * (the yard rig, the tunnel: nothing from the north can follow, the valley rig) (G). Back along the plateau and out by
 * the west road (H). The half-track drives flat out (double-click) except on the west road's ramps, leg by leg as far
 * as the way stays clear of everyone on foot.
 *
 * Kills (all silent, bodies never found before the blasts): e_g1, e21, e22, e23, e24 (the Spy's syringe).
 * Items: three remote bombs, the half-track and its gun. Alarms: only the blasts' own (every explosion trips its zone:
 * the rigs can only be blown up) — the hull gun's burst and the five explosions within two seconds, then away.
 */
import { CONFIG } from '../../src/config.js';
import { ABILITIES } from '../../src/abilities/registry.js';
import { explosionDestroysStructure } from '../../src/abilities/explosions.js';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { viewerFor } from '../../src/ai/vehicle-ai.js';
import { predictEnemy } from './driver.mjs';
import { sneak, clearFor, routeClear, unwitnessed, bodySeen, viewersOf, walking } from './sneak.mjs';
import { mirrorOf } from './ghost.mjs';

const DBG = !!(globalThis.process?.env?.M11DBG || globalThis.__M3DBG);
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

/**
 * The way a man ordered from `from` to each of `pts` in turn really walks (the game's path for each leg), as points;
 * memoised per start cell (a post's victim lies where he stood: the same way at every look).
 */
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
 * A silent kill and the body carried away: `role` ('greenberet' knife, 'spy' syringe) kills `tag` once nobody sees the
 * blow, the body or the killer (unwitnessed, as a standing man: the Spy's uniform does not cover the act) and the carry
 * from the body to `stash` stays unseen too (routeClear, a standing man at carrying pace); the body lies at `stash`
 * where nobody will see it (checked beforehand: bodySeen).
 * `wait`: the spot the killer waits at, in reach (he is there already when null); `when`: an extra condition.
 */
async function kill(D, role, tag, stash, { strict = false, when = () => true, maxWait = 300, carry = true, label = tag, via = [] } = {}) {
  const e = D.get(tag), u = D.c(role);
  // (several places offered: the first nobody will see a body lying in for the next ten minutes)
  if (carry && Array.isArray(stash[0])) stash = stash.find(([x, z]) => !bodySeen(D, x, z, 600, { step: 1, except: [e] }).length) ?? stash[0];
  const SP = CONFIG.units.carry ?? 1.6, PICK = CONFIG.abilities.carry?.pick ?? 1.0;
  const why = [];
  let next = 0, nlog = 0;
  // (he strikes standing, whatever he lies or crawls like now: the check takes him upright — a ghost made at each try,
  // reading him as he is then, through his mirror: ghost.mjs)
  let upright = null;
  await D.until(() => {
    if (D.t < next) return false;
    next = D.t + 0.25;
    why.length = 0;
    if (!when()) { why.push('when'); if (DBG && D.t > nlog) { nlog = D.t + 2; dbg(D, `  ${tag} not yet: at (${e.x.toFixed(1)},${e.z.toFixed(1)}) ${e.brain?.state} atWait=${e.brain?.atWait} waitT=${e.brain?.waitT?.toFixed?.(1)}`); } return false; }
    // (and from behind: the victim himself must not see the act coming — a man who sees the Spy draw the needle unmasks him)
    upright = Object.create(mirrorOf(u), { isLow: { value: false } });
    const back = Math.abs(Math.atan2(Math.sin(Math.atan2(u.z - e.z, u.x - e.x) - e.heading), Math.cos(Math.atan2(u.z - e.z, u.x - e.x) - e.heading)));
    if (back < (95 * Math.PI) / 180 || canSee(e, upright, D.world, { ignoreDisguise: true }) !== 'none') { why.push('victim faces him'); if (DBG && D.t > nlog) { nlog = D.t + 1; dbg(D, `  ${tag}: faces him (back ${(back * 57.3).toFixed(0)}°, killer at ${u.x.toFixed(1)},${u.z.toFixed(1)})`); } return false; }
    // (walkers glance about as they go: tried with every glance of the head — strict; posts by their own sweep)
    const posts = viewersOf(D.world).filter((v) => !walking(v));
    if (!unwitnessed(D, e, upright, { ahead: 1.6, strict, why }) || !unwitnessed(D, e, upright, { ahead: 1.6, strict: true, except: posts, why })) { why.push('witness'); if (DBG && D.t > nlog) { nlog = D.t + 1; const g = D.get(why[0].split('+')[0]); dbg(D, `  ${tag} witness ${why[0]} killerSeen=${canSee(g, u, D.world, { ignoreDisguise: true })} body=${canSee(g, { x: e.x, z: e.z, y: 0, kind: 'body', falling: true }, D.world)} spy@${u.x.toFixed(1)},${u.z.toFixed(1)} g h${Math.round(g.heading * 57.3)}`); } return false; }
    // (the carry checked along the way his feet will really go: the game's path round walls and houses)
    if (carry && !routeClear(D, carryWay(D, role, [e.x, e.z], [...via, stash]), { mode: 'walk', from: [e.x, e.z], speed: SP * 0.9, delay: 2.4 + PICK, hold: 1.5, slack: 0.8, why, except: [e], keepWalker: 2 })) { if (DBG && D.t > nlog) { nlog = D.t + 1; dbg(D, `  ${tag}: carry seen ${why.join(' ')}`); } return false; }
    return true;
  }, maxWait, `a window to kill ${label}`).catch((err) => { throw new Error(`${err.message} [${why.join(' ')}]`); });
  dbg(D, `kill ${tag} by ${role} at (${e.x.toFixed(1)},${e.z.toFixed(1)})`);
  if (DBG && carry) dbg(D, `  ${tag}'s body at (${stash}) would be seen within 10 min by [${bodySeen(D, stash[0], stash[1], 600, { except: [e] })}]`);
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


/** the half-track's legs west through the arch (straight through the gap from its east side) and out of gate 1 (square
 *  to the wall) to the foot of the west road */
/** the Sapper's way on foot to the yard rig: in through gate 1, down the inside of the yard's west wall */
const RIG_W_WAY = [[24.5, 59.5], [31.5, 84.2]];
let sapperHome = null; // (his way back out, a side task while the Driver crosses the yard)

const ARCH_W = [[78, 77], [73.6, 69.6], [62.4, 74.1], [50, 70]];
const GATE_OUT = [[35, 62], [29, 61], [22, 55.5], [17.5, 57]];

/** clearFor a few guards at a time, yielding between them (driver runSliced: the live replay hands the frame back) */
function* clearForGen(D, pts, dur, { per = 3, ...o } = {}) {
  const views = viewersOf(D.world);
  for (let i = 0; i < views.length; i += per) {
    const chunk = views.slice(i, i + per), except = views.filter((v) => !chunk.includes(v));
    if (!clearFor(D, pts, dur, { ...o, except })) return false;
    yield;
  }
  return true;
}

/** the team's half-track (the vacant SdKfz 251 in the E valley) */
const ht = (D) => D.world.vehicles.find((v) => v.tag === 'ht_ours');

/**
 * Will nobody on foot come near the half-track driven along `pts` from where it stands (`speed` m/s, ± `slack` s)? A
 * man that the hull or its front sensor box reaches steps aside and knows it for ours (§3.7: it would be shot up), so
 * every guard stays `r` m clear of its predicted way. `why` gets who does not.
 */
function driveClear(D, pts, { speed = 1.7, slack = 4, r = 7.5, rPost = 4.5, why = null, delay = 0, hold = 0, ways = null } = {}) {
  const v = ht(D);
  let x = v.x, z = v.z, t = delay;
  const samples = [[x, z, t]];
  for (const [px, pz, slow] of pts) {
    const L = Math.hypot(px - x, pz - z), n = Math.max(1, Math.ceil(L / 1)), sp = slow ? Math.min(speed, 1.7) : speed;
    for (let k = 1; k <= n; k++) samples.push([x + ((px - x) * k) / n, z + ((pz - z) * k) / n, t + (L * k) / n / sp]);
    t += L / sp + 1.5; x = px; z = pz; // (+1.5 s a turn at each corner)
  }
  // (`hold`: it stops there and waits up to that long for the next stretch to clear — nobody may come near it meanwhile)
  for (let k = 1; k <= hold; k++) samples.push([x, z, t + k]);
  t += hold;
  const g = D.world.grid, T = Math.ceil(t + slack) + 1;
  for (const e of viewersOf(D.world)) {
    if (e.vehEye) continue;
    const mv = walking(e), rr = mv ? r : rPost;
    // (his way predicted once, a point a second: the samples below read it — not a prediction per sample and offset)
    let way = null;
    for (const [sx, sz, st] of samples) {
      if (Math.hypot(e.x - sx, e.z - sz) > rr + 3 * (st + slack) + 2) continue;
      // (a man up on a roof or a plateau is never in the way of a hull down here)
      if (Math.abs((e.y || 0) - (g.elevAt?.(sx, sz) ?? 0)) > 1.5) continue;
      if (mv && !way) {
        // (`ways`: predictions shared by several checks made at the same moment)
        way = ways?.get(e) || [];
        for (let k = way.length; k <= T; k++) way.push(predictEnemy(e, k));
        ways?.set(e, way);
      }
      for (let o = -slack; o <= slack + 1e-6; o += 1) {
        const q = mv ? way[Math.min(T, Math.max(0, Math.round(st + o)))] : e;
        if (Math.hypot(q.x - sx, q.z - sz) < rr) { why?.push(`${e.tag}@(${sx.toFixed(0)},${sz.toFixed(0)})+${st.toFixed(0)}`); return false; }
      }
    }
  }
  return true;
}

/**
 * drive the half-track (the Driver at the wheel) through `pts`, leg by leg: the whole way at once when it stays clear of
 * everyone on foot; else as far as it does, to a stop where it may stand and wait (nobody comes near it for `hold` s),
 * then on (a patrol walking the same road: it follows at a distance instead of waiting at the start for the whole road)
 */
const FAST = !globalThis.process?.env?.M11SLOW; // (double-click: the half-track at full speed)
async function drive(D, pts, { maxWait = 300, label = 'the half-track', check = true, done = () => false, hold = 25, fast = FAST, ...o } = {}) {
  const v = ht(D), why = [];
  if (fast) o.speed ??= 3.6; // (its pace with the turns at the corners: 5 m/s flat out on the straights)
  for (let k = 0; k < pts.length;) {
    let j = pts.length - 1, next = 0;
    if (check) {
      await D.until(() => {
        if (D.t < next) return false;
        next = D.t + 0.25; why.length = 0;
        const ways = new Map();
        for (j = pts.length - 1; j >= k; j--) if (driveClear(D, pts.slice(k, j + 1), { ...o, ways, why: j === pts.length - 1 ? why : null, hold: j < pts.length - 1 ? hold : 0 })) return true;
        return false;
      }, maxWait, `a clear way for ${label}`).catch((err) => { throw new Error(`${err.message} [${why.join(' ')}]`); });
      dbg(D, `drive: legs ${k}..${j} of ${pts.length} (${pts[j]})`);
    }
    for (; k <= j; k++) {
      const [x, z, slow] = pts[k];
      if (done()) return;
      // (one straight order per leg, as a player clicks; a hull that turns on the spot first may end a little short: the
      // same click again)
      for (let n = 0; n < 3 && Math.hypot(v.x - x, v.z - z) > 1; n++) {
        const t0 = D.t;
        // (flat out where the hull may go flat out: a ramp's bend it takes at a crawl — the game refuses the fast order)
        // (the plan made sliced first, so the check and the order find it made)
        let run = false;
        if (fast && !slow) { await D.drivePlan('driver', x, z, { run: true }); const f = v.fast; v.fast = true; try { run = v.canDriveTo(x, z); } finally { v.fast = f; } }
        if (!run) await D.drivePlan('driver', x, z);
        D.order('driver', { type: 'move', x, z, ...(run ? { run: true } : null) });
        await D.until(() => done() || (!v.goal && (v.speed || 0) < 0.05 && D.t > t0 + 0.3), 90, `${label} → (${x},${z})`);
        if (done()) return;
      }
      if (Math.hypot(v.x - x, v.z - z) > 2.5) throw new Error(`${label} stopped at (${v.x.toFixed(1)},${v.z.toFixed(1)}), short of (${x},${z})`);
    }
  }
  await D.until(() => (v.speed || 0) < 0.05, 10, `${label} stops`);
}

/**
 * Will no armed enemy vehicle standing still (the N half-track's gunner on the HQ plateau, looking out over the quarry
 * and the ridge with a sweeping cone) see a standing man at `pts` in the next `dur` s? Its sweep is a function of time.
 */
function eyesClear(D, pts, dur) {
  const w = D.world;
  for (const v of w.vehicles) {
    if (!v.vision || v.removed || v.destroyed || v.driver || !v.crewed || !v.def?.weapons?.length) continue;
    const e = viewerFor(v);
    for (const [x, z] of pts) {
      const d = { x, z, y: w.grid.elevAt?.(x, z) ?? 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' };
      for (let t = 0; t <= dur + 1e-6; t += 0.1) if (canSee(e, d, w, { cone: coneAt(e, w.time + t) }) !== 'none') return false;
    }
  }
  return true;
}

/** `roles` board the half-track (each from where he stands: nobody may see a man climb in, §4.3) */
async function board(D, roles, { maxWait = 120 } = {}) {
  const v = ht(D);
  for (const r of roles) {
    const u = D.c(r);
    if (u.vehicle === v) continue;
    let next = 0;
    await D.until(() => { if (D.t < next) return false; next = D.t + 0.25; return clearFor(D, [[u.x, u.z], [v.x, v.z]], 4, { mode: 'walk' }); }, maxWait, `${r} may climb in unseen`);
    D.ability(r, 'enterVehicle', v);
    await D.until(() => u.vehicle === v, 20, `${r} aboard`);
  }
}

/**
 * The Sapper gets out of the half-track, crawls to `at`, sets a remote bomb there and crawls back in. He leaves only
 * when the door and the crawl stay out of every cone (the planner times the crawl: sneak).
 */
async function sapperBomb(D, at, label, crawlOpts = {}, via = [], target = null) {
  const v = ht(D), sp = D.c('sapper'), n0 = sp.inventory.get('remoteBomb') ?? 0;
  // (where he will step out: the rear doors) — he goes when nobody will see him get out, and nobody will come near
  // enough to see a man lying anywhere on his way for the next 40 s (out, there, the charge, back)
  const ep = v._exitPoint(undefined, undefined, false, sp, v.seatOf(sp)), door = ep ? [ep.x, ep.z] : [v.x, v.z];
  let next = 0;
  await D.untilAsync(async () => {
    if (D.t < next) return false;
    next = D.t + 0.25;
    // (the long look-ahead a few guards at a time, handing the frame back between them: a sliced check, as the planner)
    return clearFor(D, [door, [v.x, v.z]], 4, { mode: 'walk' }) && await D.runSliced(clearForGen(D, [door, ...via, at], 40, { mode: 'crawl', step: 0.25 }));
  }, 600, `the sapper may get out unseen (${label})`);
  D.ability('sapper', 'leaveVehicle');
  await D.until(() => !sp.vehicle && !sp.currentAction, 8, 'sapper out');
  await D.stance('sapper', 'crawl');
  // (round the hull first where it stands in the way: the planner's cells know nothing of a parked vehicle)
  for (const [x, z] of via) await crawl(D, 'sapper', x, z, { box: 8, maxWait: 300, ...crawlOpts });
  // (a charge within ~6 m of a rig's centre brings it down: if the last metre is blocked, where he lies will do)
  const near = () => target && Math.hypot(sp.x - target[0], sp.z - target[1]) < 6;
  if (Math.hypot(sp.x - at[0], sp.z - at[1]) > 1) {
    await crawl(D, 'sapper', at[0], at[1], { box: 8, maxWait: near() ? 20 : 300, ...crawlOpts }).catch((err) => { if (!near()) throw err; });
  }
  D.ability('sapper', 'remoteBomb');
  await D.until(() => (sp.inventory.get('remoteBomb') ?? 0) === n0 - 1 && !sp.currentAction, 15, `bomb set (${label})`);
  // (back the way he came, flat, to the doors he got out of: he gets up only to climb in)
  // (the doors' own spot can sit in the hull's clearance: near enough, he climbs in from where he lies)
  for (const [x, z] of [...via].reverse()) await crawl(D, 'sapper', x, z, { box: 8, maxWait: 60, ...crawlOpts }).catch(() => {});
  if (Math.hypot(sp.x - door[0], sp.z - door[1]) > 2.5) await crawl(D, 'sapper', door[0], door[1], { box: 8, maxWait: 30, ...crawlOpts }).catch(() => {});
  await board(D, ['sapper']);
}

export const STAGES = [
  ['A', 'Gate 1', async (D) => {
    // the gate sentry e_g1 looks into the yard, his back to the gate. The Spy, in a German officer's uniform from the
    // start, walks up behind him (a disguised man leaves no tracks anyone reads: a Green Beret carrying a body out
    // through the sand would leave a trail for the yard patrol to follow), and carries him out of the gate
    await D.go('spy', 21.5, 58.8, { max: 120 });
    await D.go('spy', 25.6, 61.6, { max: 30, tol: 1.2 });
    D.checkpoint('A1 spy behind the gate sentry e_g1');
    await kill(D, 'spy', 'e_g1', [12.5, 62.5], { via: [[24.2, 59.6], [19, 59.5]] });
    D.checkpoint('A2 spy kills e_g1 and carries him out of the gate');
  }],
  ['B', 'Into the east valley', async (D) => {
    // (meanwhile the Driver crawls up behind the west wall by gate 1, where nobody in the yard can see him)
    await D.stance('driver', 'crawl');
    D.order('driver', { type: 'move', x: 20, z: 59.5 });
    // on through the yard and the arch into the east valley: nobody looks twice at an officer
    await D.go('spy', 25, 58, { max: 120 });
    await D.go('spy', 62, 74, { max: 120 });
    await D.go('spy', 78, 77, { max: 60 });
    await D.go('spy', 86.2, 98.1, { max: 60, tol: 1.2 });
    D.checkpoint('B1 spy waits at the south end of e21 beat');
    const e21 = D.get('e21');
    await kill(D, 'spy', 'e21', [95, 97], { when: () => Math.hypot(e21.x - 87.5, e21.z - 97.5) < 2 && e21.brain?.atWait });
    D.checkpoint('B2 spy kills e21');
    await D.go('spy', 78.8, 88.6, { max: 60, tol: 1.2 });
    // (he dies in his sandbag ring: a body lying inside it is hidden from everyone below)
    await kill(D, 'spy', 'e22', null, { carry: false });
    dbg(D, `e22's body at (${D.get('e22').x.toFixed(2)},${D.get('e22').z.toFixed(2)}) seen by [${bodySeen(D, D.get('e22').x, D.get('e22').z, 300)}]`);
    D.checkpoint('B3 spy kills the gatling gunner e22');
    await D.go('spy', 82.3, 72.3, { max: 60, tol: 1.2 });
    // (round the east end of the house by the half-track: e24 at the arch looks west, his back to that side)
    await kill(D, 'spy', 'e23', [84.5, 62.5], { via: [[87.5, 72.5]] });
    D.checkpoint('B4 spy kills e23');
    await D.go('spy', 72, 73.6, { max: 60, tol: 1.2 });
    await kill(D, 'spy', 'e24', [69, 63]);
    D.checkpoint('B5 spy kills e24');
  }],
  ['C', 'The Driver crosses the yard', async (D) => {
    // the yard patrol (Patrol 28) loops the whole yard: the Spy stops it at its southern halt and talks to the
    // sergeant, the whole file turned to him, facing south, for as long as the Driver needs to cross the north road
    const s28 = D.get('s28');
    // (the Green Beret and the Sniper walk over to the foot of the west road, where the half-track will pick them up)
    for (const [r, x, z] of [['greenberet', 12.4, 62.4], ['sniper', 13.8, 63.2]]) D.order(r, { type: 'move', x, z });
    // (he stands west of its halt: the file faces west, away from the north road's east end and the arch) — and talks
    // the moment it halts there, while the Sapper is busy elsewhere (a side task: two men at once, as a player plays)
    const SPOT = [54.6, 92.3], spy = D.c('spy');
    D.order('spy', { type: 'move', x: SPOT[0], z: SPOT[1] });
    // (not while the Sapper is still on his way in: the file frozen at its halt would face his last metres to the rig —
    // the planner times his crawl round the patrol walking its round; the next halt will do then)
    let talking = false, sent = D.t, sapperGoing = true;
    D.meanwhile(() => {
      if (talking) return true;
      const there = Math.hypot(spy.x - SPOT[0], spy.z - SPOT[1]) < 1.2;
      if (!there && !spy.path && !spy.isMoving && D.t > sent + 1) { D.order('spy', { type: 'move', x: SPOT[0], z: SPOT[1] }); sent = D.t; }
      if (there && !sapperGoing && s28.brain?.atWait && Math.hypot(s28.x - 56, s28.z - 92) < 0.8) { D.ability('spy', 'distract', s28); talking = true; }
      return talking;
    });
    // meanwhile the Sapper crawls in through gate 1 and down the yard's west side to the yard rig, sets a remote bomb
    // under it and crawls back out (timed by the planner round the yard patrol's round)
    await D.stance('sapper', 'crawl');
    for (const [x, z] of RIG_W_WAY) await crawl(D, 'sapper', x, z, { box: 12, maxWait: 300 });
    { const sp = D.c('sapper'), n0 = sp.inventory.get('remoteBomb') ?? 0;
      D.ability('sapper', 'remoteBomb');
      await D.until(() => (sp.inventory.get('remoteBomb') ?? 0) === n0 - 1 && !sp.currentAction, 15, 'bomb set (rig_w)'); }
    sapperGoing = false;
    D.checkpoint('C1 sapper sets a bomb under rig_w');
    // back out to the foot of the west road: on the planner's timing while the patrol still walks its round; once the
    // Spy holds it, straight back (the frozen file faces west, he crawls beyond its near band) while the Driver goes
    const back = [...RIG_W_WAY].reverse().slice(1).concat([[13.6, 61.4]]);
    // (the patrol about to halt by the Spy, and nobody to see the Sapper lying where he is meanwhile: he waits for it)
    { const sp = D.c('sapper');
      // (within a minute: his way back on the planner's timing takes about as long, and the Driver can only go then)
      const soon = () => { for (let k = 0; k <= 60; k++) { const q = D.predict(s28, k); if (Math.hypot(q.x - 56, q.z - 92) < 1) return k; } return -1; };
      const k = talking ? 0 : soon();
      if (!talking && k >= 0 && await D.runSliced(clearForGen(D, [[sp.x, sp.z]], k + 4, { mode: 'crawl', per: 1, step: 0.25 }))) await D.until(() => talking, k + 4, 'patrol 28 at its southern halt').catch(() => {}); }
    if (!talking) for (const [x, z] of back) await crawl(D, 'sapper', x, z, { box: 12, maxWait: 300 });
    await D.until(() => talking && s28.brain?.state === 'DISTRACTED', 300, 'patrol 28 at its southern halt, the Spy talking');
    D.checkpoint('C2 spy holds patrol 28 in talk');
    const sp = D.c('sapper');
    let leg = back.findIndex(([x, z]) => Math.hypot(sp.x - x, sp.z - z) < 1.2) + 1, gone = -1;
    sapperHome = D.meanwhile(() => {
      if (leg >= back.length) return true;
      const [x, z] = back[leg];
      if (Math.hypot(sp.x - x, sp.z - z) < 1.2) { leg++; gone = -1; return leg >= back.length; }
      if (gone < 0 || (!sp.path && !sp.isMoving && D.t > gone + 1)) { D.order('sapper', { type: 'move', x, z }); gone = D.t; }
      return false;
    });
    // the yard walker e29 paces the middle road, across the Driver's way: the Driver waits out of his reach (he turns
    // about at the north end of his beat, sweeping his eyes over the road) and crosses behind his back while he walks
    // south, timed by the planner
    const e29 = D.get('e29');
    for (const [x, z] of [[24.5, 59.5], [35.5, 66]]) await crawl(D, 'driver', x, z, { box: 12, maxWait: 600 });
    await D.until(() => !e29.brain?.atWait && Math.sin(e29.heading) > 0.9 && e29.z < 76, 120, 'e29 walking off south');
    for (const [x, z] of [[66, 73], [76, 74], [87, 75]]) {
      await crawl(D, 'driver', x, z, { box: 12, maxWait: 600 });
      dbg(D, `driver at (${x},${z})`);
    }
    D.checkpoint('C3 driver at the half-track');
    await board(D, ['driver']);
    D.checkpoint('C4 driver takes the half-track');
  }],
  ['D', 'The half-track fetches the team', async (D) => {
    // through the arch and along the yard's north road while the patrol listens to the Spy, out through gate 1
    // (each gap straight through its middle: the arch from its east side, gate 1 square to the wall)
    await drive(D, ARCH_W.concat(GATE_OUT));
    D.checkpoint('D1 the half-track at the start');
    await D.until(() => !D.pending(sapperHome), 120, 'the sapper back at the foot of the west road');
    // the Green Beret, the Sapper and the Sniper, waiting by the foot of the west road, climb in (nobody sees the forecourt)
    await board(D, ['sapper', 'greenberet', 'sniper']);
    D.checkpoint('D2 three more aboard');
  }],
  ['E', 'The tunnel', async (D) => {
    // on up the west road (the way it faces: no turning round on the cramped forecourt) onto the plateau and round to
    // the tunnel's south portal, between the rounds of the plateau patrol
    await drive(D, [[8, 56.5, 1], [4.5, 51.5, 1], [4, 48, 1], [4, 44.5, 1], [12, 42, 1], [22, 38], [35, 35], [44, 38], [53.5, 36]]);
    D.checkpoint('E1 the half-track at the tunnel');
    // (the walker on the HQ plateau, e_hq1, looks across the corner of the quarry at the portal from the west end of his
    // beat: the Sapper keeps out of his reach whichever way he faces)
    await sapperBomb(D, [51.3, 32.6], 'the tunnel', { keepFrom: { e_hq1: 19.5 } });
    D.checkpoint('E2 sapper sets the second bomb in the tunnel mouth');
    // turned round on the open plateau and back down the west road to gate 1
    await drive(D, [[44, 38], [35, 35], [22, 38], [12, 42, 1], [4, 44.5, 1], [4, 48, 1], [4.5, 51.5, 1], [8, 56.5, 1], [17.5, 57]]);
    D.checkpoint('E3 the half-track back down at gate 1');
  }],
  ['F', 'Charges for the yard rigs', async (D) => {
    await drive(D, [[22, 55.5], [29, 61], [36, 71], [50, 71], [62.4, 74.1], [73.6, 69.6], [78, 77], [89, 77]]);
    D.checkpoint('F1 the half-track beside rig_e');
    await sapperBomb(D, [90.8, 80.2], 'rig_e', {}, [[87.5, 79.6]], [95, 81.5]);
    D.checkpoint('F2 sapper sets a bomb under rig_e');
    await drive(D, ARCH_W.concat(GATE_OUT));
    D.checkpoint('F3 the half-track back at gate 1');
    // the Spy leaves the sergeant to his round and walks back out through gate 1 to the half-track
    await D.go('spy', 25, 58, { max: 120, tol: 1.2 });
    await D.go('spy', 20.5, 58.5, { max: 30, tol: 1.2 });
    await board(D, ['spy']);
    D.checkpoint('F4 the spy climbs in: all five aboard');
  }],
  ['G', 'Fireworks', async (D) => {
    // up the west road again and round onto the ridge over the quarry
    await drive(D, [[8, 56.5, 1], [4.5, 51.5, 1], [4, 48, 1], [4, 44.5, 1], [12, 42, 1], [22, 38], [35, 35], [44, 38], [50, 45]]);
    await drive(D, [[53, 52], [57.5, 54.5], [62, 55.5], [65, 56]]);
    D.checkpoint('G1 the half-track on the ridge');
    // the fuel truck shuttles in the quarry and stops for 4 s between the two rigs (W_mid): a burst into it then takes
    // both. The Driver fires the half-track's hull gun down into the pit from his seat: nobody gets out up here, where
    // the plateau patrol, the ridge walker, the men across the quarry and the N half-track's gunner all look.
    const tk = D.world.vehicles.find((q) => q.tag === 'tanker');
    // (any stop where its blast reaches both rigs will do: its halt between them, or wherever it stands in the lane
    // between them while it manoeuvres)
    const both = () => ['rig_nw', 'rig_ne'].every((id) => { const r = D.world.byId(id); return explosionDestroysStructure('barrel', r, Math.hypot(r.x - tk.x, r.z - tk.z), { world: D.world, x: tk.x, z: tk.z }); });
    const ready = () => (tk.speed || 0) < 0.05 && both() && ABILITIES.vehicleFire.canUse(D.c('driver'), tk, D.world) === true;
    let tlog = 0;
    await D.until(() => {
      if (DBG && D.t > tlog) { tlog = D.t + 5; dbg(D, `tanker (${tk.x.toFixed(1)},${tk.z.toFixed(1)}) v${(tk.speed || 0).toFixed(1)} w${(tk.waitT || 0).toFixed(1)} both=${both()} mg=${ABILITIES.vehicleFire.canUse(D.c('driver'), tk, D.world)}`); }
      return ready();
    }, 120, 'the fuel truck halted between the quarry rigs');
    D.ability('driver', 'vehicleFire', tk);
    await D.until(() => tk.destroyed, 6, 'the fuel truck blows');
    D.checkpoint('G2 the driver fires the hull gun into the fuel truck: both quarry rigs go up');
    // the Sapper, from his seat: one press per charge, oldest first (rig_w, the tunnel — nothing from the north can come
    // through it now — and rig_e)
    for (let k = 0; k < 3; k++) { D.ability('sapper', 'detonate'); await D.wait(0.4); }
    await D.until(() => D.world.objectives.find((o) => o.id === 'o_rigs')?.done, 10, 'all four rigs down');
    D.checkpoint('G3 sapper fires his three charges: the yard rigs burn and the tunnel caves in');
  }],
  ['H', 'Out by the west road', async (D) => {
    const out = () => D.world.objectives.find((o) => o.id === 'o_escape')?.done || D.world.game?.state === 'won';
    // (backing off the ridge's west end, then the plateau road; leg by leg, each clear of anyone on foot — the plateau
    // patrol, roused by the blasts, may come running)
    const legs = [[60, 55.3], [53, 52], [50, 45], [44, 38.5], [35, 35], [22, 38], [12, 42, 1], [4, 44.5, 1], [2, 41, 1]];
    for (let k = 0; k < legs.length && !out(); k++) await drive(D, [legs[k]], { done: out, maxWait: 120, slack: 2 });
    await D.until(out, 30, 'the escape');
    D.checkpoint('H1 the half-track leaves by the west road');
  }],
];

export async function solve(D, ctx = {}) {
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}
