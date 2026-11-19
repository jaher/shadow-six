/**
 * LIGHTS OUT e01 "Dry Stone": a full stealth solution, played only with player orders (docs/expansion/e01.md §11).
 * Driver API: tools/solutions/driver.mjs; sneaking helpers: tools/solutions/sneak.mjs. Reference run headless:
 *   node tools/solutions/run-headless.mjs e01            (E01_DIFF=easy for the Easy data)
 * in the game: tests/e01-solution.test.mjs. Walkthrough: e01.walkthrough.mjs.
 *
 * Every knock-out is from behind, unwitnessed, and every man knocked out is cuffed where no comrade will see him lie
 * (a bound man seen is freed and both shout). Wins with every objective done, 0 detections and 0 exposures (the
 * driver's exposure watch): the only alarm is the coupling hut's charge going up after the lorry has left the gate.
 */
import { sneak, clearFor, unwitnessed, bodySeen, predict, walking } from './sneak.mjs';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { mirrorOf, ghostOn } from './ghost.mjs';

const DBG = !!globalThis.process?.env?.E01DBG || !!globalThis.__M3DBG;

/** The man as the guards see him standing (a blow, a stand-up). */
const bare = (u) => ({ x: u.x, z: u.z, y: u.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });
const near = (a, x, z, r) => Math.hypot(a.x - x, a.z - z) <= r;

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

let dbgN = 0;
function dbg(D, why, label) { if (DBG && dbgN++ % 60 === 0) D.log(`DBG ${D.t.toFixed(1)} ${label}: [${why.join(' ')}]`); return false; }

const KO_ID = { greenberet: 'knockoutFist', driver: 'knockoutClub' };

/**
 * `role` knocks `victim` out from behind once `ready()` holds, he is within `reach`, the victim's cone will not hold
 * him standing for `ahead` s, nobody else sees the blow (nor him walking in), and the man down will lie unseen for
 * `quiet` s (`later`: men who will be down by then). The Green Beret then cuffs him at once (`cuff`).
 */
async function knockOut(D, role, victim, { ready = () => true, reach = 2.6, ahead = 1.8, quiet = 30, later = [], maxSec = 240, cuff = role === 'greenberet', standUp = false, label = '' } = {}) {
  const u = D.c(role), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  later = later.map((t) => (typeof t === 'string' ? D.get(t) : t));
  await D.until(() => {
    why.length = 0;
    if (!ready()) return dbg(D, ['not ready'], `ko ${victim.tag}`);
    if (Math.hypot(victim.x - u.x, victim.z - u.z) > reach) return dbg(D, [`far ${Math.hypot(victim.x - u.x, victim.z - u.z).toFixed(1)}`], `ko ${victim.tag}`);
    const me = bare(u);
    if (eyesOn(D, victim, me, ahead)) return dbg(D, ['victim looks'], `ko ${victim.tag}`);
    if (!unwitnessed(D, victim, me, { ahead, strict: true, why })) return dbg(D, why, `ko ${victim.tag}`);
    if (!clearFor(D, [[u.x, u.z], [(u.x + victim.x) / 2, (u.z + victim.z) / 2], [victim.x, victim.z]], ahead + 0.6, { mode: 'walk', except: [victim], why })) return dbg(D, why, `ko ${victim.tag}`);
    const finders = bodySeen(D, victim.x, victim.z, quiet, { except: [victim, ...later] });
    if (finders.length) return dbg(D, [`body seen by ${finders.join(',')}`], `ko ${victim.tag}`);
    return true;
  }, maxSec, `knock out ${victim.tag}${label ? ' ' + label : ''}`);
  if (standUp) await D.stance(role, 'stand'); // (up only now: lying there he was out of every eye)
  D.ability(role, KO_ID[role], victim);
  await D.until(() => victim.ko === 'stunned' || !victim.alive || victim.brain?.state === 'COMBAT', 10, `${victim.tag} out cold`);
  if (victim.ko !== 'stunned') throw new Error(`${victim.tag} was not knocked out (${victim.brain?.state})`);
  await D.idle(role, 5);
  if (cuff) await cuffMan(D, victim);
}

/** The Green Beret cuffs the stunned `victim` (1.5 s, a suspicious act: unwitnessed). */
async function cuffMan(D, victim, { maxSec = 25 } = {}) {
  const gb = D.c('greenberet'), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  await D.until(() => {
    why.length = 0;
    if (victim.ko !== 'stunned') throw new Error(`${victim.tag} no longer stunned (${victim.ko})`);
    const me = bare(gb);
    if (Math.hypot(victim.x - gb.x, victim.z - gb.z) > 3.5) { if (!gb.path && !gb.isMoving) D.order('greenberet', { type: 'move', x: victim.x, z: victim.z }); return false; }
    if (!unwitnessed(D, victim, me, { ahead: 2.2, strict: true, why })) return dbg(D, why, `cuff ${victim.tag}`);
    return true;
  }, maxSec, `cuff ${victim.tag}`);
  D.ability('greenberet', 'handcuff', victim);
  await D.until(() => victim.ko === 'bound', 8, `${victim.tag} cuffed`);
  await D.idle('greenberet', 5);
}

/** The Green Beret shoulders bound `tag`, carries him along `pts` and puts him down at the last one, unseen. */
async function carryMan(D, tag, pts, { maxWait = 120, quiet = 300, label = '' } = {}) {
  const gb = D.c('greenberet'), e = typeof tag === 'string' ? D.get(tag) : tag, why = [];
  const end = pts[pts.length - 1];
  await D.until(() => {
    why.length = 0;
    if (!clearFor(D, [[gb.x, gb.z], ...pts], 6, { mode: 'walk', why })) return dbg(D, why, `carry ${e.tag}`);
    const f = bodySeen(D, end[0], end[1], quiet, { step: 1 });
    if (f.length) return dbg(D, [`at the end seen by ${f.join(',')}`], `carry ${e.tag}`);
    return true;
  }, maxWait, `window to carry ${e.tag}${label ? ' ' + label : ''}`);
  await D.stance('greenberet', 'stand');
  D.ability('greenberet', 'hand', e);
  await D.until(() => gb.carrying === e, 10, `GB shoulders ${e.tag}`);
  for (const p of pts) await D.go('greenberet', p[0], p[1], { tol: 0.5 });
  D.ability('greenberet', 'drop');
  await D.until(() => !gb.carrying, 5, `${e.tag} put down`);
  await D.idle('greenberet');
}

/** A stone thrown by `role` at (x, z) (Y): the guards within 4 m of where it lands look at it. */
async function stoneAt(D, role, x, z) {
  D.order(role, { type: 'ability', id: 'stone', target: { x, z } });
  await D.idle(role, 6);
}

const crawlTo = (D, role, x, z, o = {}) => sneak(D, x, z, { mode: 'crawl', role, horizon: 90, ...o, label: o.label ?? `${role} → (${x},${z})` });
const walkTo = (D, role, x, z, o = {}) => sneak(D, x, z, { mode: 'walk', role, horizon: 60, ...o, label: o.label ?? `${role} → (${x},${z})` });

/** Is enemy `e` standing at his route halt (x, z) (within `r`), turned to its look? */
const atHalt = (e, x, z, r = 0.7) => near(e, x, z, r) && !!e.brain?.atWait;

/** The Green Beret shoulders bound `victim` and puts him inside the enterable building `door` ('<structure>:door'). */
async function stowMan(D, victim, door, { maxWait = 120, label = '', clear = 7, after = null } = {}) {
  const gb = D.c('greenberet'), e = typeof victim === 'string' ? D.get(victim) : victim, why = [];
  const d = D.world.interactables.find((i) => i.tag === door || i.id === door);
  if (!d) throw new Error(`no door ${door}`);
  await D.until(() => {
    why.length = 0;
    if (!clearFor(D, [[gb.x, gb.z], [e.x, e.z], [d.x, d.z]], clear, { mode: 'walk', why })) return dbg(D, why, `stow ${e.tag}`);
    return true;
  }, maxWait, `window to carry ${e.tag} into ${door}${label ? ' ' + label : ''}`);
  await D.stance('greenberet', 'stand');
  D.ability('greenberet', 'hand', e);
  await D.until(() => gb.carrying === e, 10, `GB shoulders ${e.tag}`);
  D.order('greenberet', { type: 'ability', id: 'use', target: d });
  await D.until(() => e.hidden, 20, `${e.tag} put inside ${door}`);
  await D.idle('greenberet');
  // (`after`: down at once and into the lee he waits in)
  if (after) { await D.stance('greenberet', 'crawl'); await D.go('greenberet', after[0], after[1], { tol: 0.5 }); }
}

/**
 * Signals between the flows (they run side by side: D.parallel in solve): the game time each was given at, null until
 * then. A flow hears one on the tick after it was given (`heard`), never on the same one: within a tick the flows go
 * in the order they last parked, and that order is not the same in a logic run and in a live replay (its sliced plans
 * let the flows park in another order at the start) — a flow resumed after the one that gave the word heard it a tick
 * earlier than one resumed before it, and the live walkthrough parted from the tested run (the Driver at t = 902.6).
 */
const SIG = { plant: null, planted: null, board: null, sapperIn: null };
const give = (D, k) => { SIG[k] = D.t; };
const heard = (D, k) => SIG[k] != null && D.t > SIG[k] + 1e-6;

async function boardLorry(D, role, { maxWait = 120 } = {}) {
  const u = D.c(role), v = D.world.vehicles.find((q) => (q.tag ?? q.id) === 'lorry'), why = [];
  await D.until(() => {
    why.length = 0;
    return clearFor(D, [[u.x, u.z], [v.x, v.z]], 4, { mode: 'walk', why }) || dbg(D, why, `${role} boards`);
  }, maxWait, `${role}: a moment to climb into the lorry unseen`);
  D.order(role, { type: 'ability', id: 'enterVehicle', target: v });
  await D.until(() => u.vehicle === v, 20, `${role} in the lorry`);
}

export const STAGES = [
  ['A', 'The grove', async (D) => {
    // the three lie down among the olives (the hamlet's two foragers are a field away; nobody else looks this way)
    for (const r of ['greenberet', 'driver', 'sapper']) await D.stance(r, 'crawl');
    D.checkpoint('A0 the team lies down in the olive grove');
  }],
  ['B', 'The foragers', async (D) => {
    const f1 = D.get('f1'), f2 = D.get('f2');
    // the Green Beret crawls out by the grove wall's north gate to the chapel's blind west side; the Driver along the
    // north side of the hamlet and down the lane by t1 into the jazzo, the high-walled sheepfold nobody can see into
    // (the jazzo and the trulli keep the whole hamlet out of the checkpoint's sight: the practice area)
    await D.parallel(
      async () => {
        for (const [x, z] of [[30.5, 104.5], [33.2, 96.1], [37.5, 96.0], [40.5, 97.2]]) await crawlTo(D, 'greenberet', x, z, { label: `the Green Beret → (${x},${z})` });
      },
      async () => {
        for (const [x, z] of [[30.5, 101.5], [33.2, 95.8], [38.5, 91.6], [47.5, 91.2], [56.5, 94.4], [61.5, 97.4], [61.6, 102.2], [64.4, 102.6], [64.2, 104.2]]) {
          await crawlTo(D, 'driver', x, z, { label: `the Driver → (${x},${z})` });
        }
      },
    );
    D.checkpoint('B1 the Green Beret crawls to the chapel\'s west side, the Driver into the jazzo');
    // f2 faces south over the road into the piazza: a stone east of him turns his head, the Green Beret fists him from
    // behind, cuffs him and puts him inside the chapel he guards
    await D.until(() => !eyesOn(D, f1, bare(D.c('greenberet')), 6), 120, 'f1 looking away from the chapel');
    await stoneAt(D, 'greenberet', 49.5, 101.5);
    await knockOut(D, 'greenberet', f2, { reach: 6, label: 'looking at the stone' });
    await stowMan(D, f2, 'chapel:door', { label: '(the chapel)' });
    D.checkpoint('B2 a stone turns f2\'s head; the Green Beret fists him, cuffs him and puts him in the chapel');
    // at t1's door f1 faces north, into the doorway: the Driver steps out of the jazzo's gate behind him and coshes him;
    // the Green Beret runs over from the chapel, cuffs him and puts him in t1
    await D.until(() => atHalt(f1, 57.4, 104.6), 180, 'f1 at t1\'s door');
    await D.stance('driver', 'stand');
    await D.go('driver', 64.7, 106.7, { tol: 0.5 }); // (out by the breach in the jazzo's south wall, behind his back)
    await knockOut(D, 'driver', f1, { ready: () => atHalt(f1, 57.4, 104.6), reach: 9, cuff: false, label: 'at t1\'s door' });
    await cuffMan(D, f1);
    await stowMan(D, f1, 't1:door', { label: '(the trullo he was robbing)' });
    D.checkpoint('B3 the Driver coshes f1 at the doorway he loots; the Green Beret cuffs him and puts him inside t1');
  }],
  ['C', 'The checkpoint', async (D) => {
    const cp1 = D.get('cp1'), cp2 = D.get('cp2');
    // out of the hamlet by the lane past t1 and along the jazzo's north wall: cp1 faces down the road at the hamlet's
    // corner, the field at his back; cp2 walks the road between the boom and the farm's gate
    // (one after the other through the lane between t1 and the jazzo: it is a man wide)
    for (const [x, z] of [[61.6, 102.0], [60.6, 95.2], [61.6, 90.6], [64.6, 88.6], [67.8, 90.6]]) await crawlTo(D, 'driver', x, z, { label: `the Driver → (${x},${z})` });
    for (const [x, z] of [[61.6, 101.0], [61.4, 95.6], [62.6, 91.4], [66.8, 90.4], [69.8, 92.4]]) await crawlTo(D, 'greenberet', x, z, { label: `the Green Beret → (${x},${z})` });
    D.checkpoint('C1 the Green Beret and the Driver crawl out of the hamlet and along the field wall behind the checkpoint');
    // cp1: when cp2 has his back to the boom, the Green Beret fists him from the field, cuffs him and puts him inside
    // the sentry box beside him
    await knockOut(D, 'greenberet', cp1, { reach: 9, quiet: 14, ahead: 12, standUp: true, label: 'at the boom' });
    await stowMan(D, cp1, 'sentry_box:door', { label: '(the sentry box)', clear: 3, after: [76.6, 100.7] });
    D.checkpoint('C2 the Green Beret fists cp1 from behind, cuffs him and puts him in his own sentry box');
    // cp2 walks the road between the boom and the farm's gate; at its gate end he looks down the outbound road. The
    // Green Beret crawls across the field behind his beat to the casedda by the compound's corner, fists him from
    // behind at that end, cuffs him and puts him inside the casedda
    // (round the field behind cp2's beat: west below the jazzo, up the field's west side through the field gate, along
    // the foot of the compound's south-west corner)
    for (const [x, z] of [[73.2, 101.6], [68.8, 101.6], [66.6, 96.0], [66.4, 89.6], [65.4, 86.6], [65.6, 80.4], [66.6, 75.3], [73.9, 75.2], [76.8, 77.0], [80.2, 77.2]]) {
      await crawlTo(D, 'greenberet', x, z, { keepWalker: 4, label: `the Green Beret → (${x},${z})` });
    }
    D.checkpoint('C3 the Green Beret crawls across the field behind cp2\'s beat to the casedda at the compound\'s corner');
    await knockOut(D, 'greenberet', cp2, { ready: () => atHalt(cp2, 85.4, 81.0, 1.0), reach: 7, ahead: 10, quiet: 14, standUp: true, label: 'at the gate end of his beat' });
    await stowMan(D, cp2, 'casedda:door', { label: '(the casedda)', clear: 6, after: [76.6, 77.2] });
    D.checkpoint('C4 the Green Beret fists cp2 at the end of his beat, cuffs him and puts him in the casedda');
  }],
  ['E', 'The gate', async (D) => {
    const g1 = D.get('g1');
    // g1 stands outside the arch watching the road east of the checkpoint: the Green Beret comes along the foot of
    // the compound wall from the casedda behind his back, across the arch's mouth when nobody in the yard looks out
    // through it, fists him, cuffs him and carries him back into the casedda
    await D.stance('greenberet', 'crawl');
    await crawlTo(D, 'greenberet', 84.6, 77.1, { keepWalker: 4, label: 'the Green Beret along the wall to the arch' });
    await crawlTo(D, 'greenberet', 90.6, 77.2, { keepWalker: 4, label: 'the Green Beret across the arch\'s mouth behind g1' });
    D.checkpoint('E1 the Green Beret crawls along the wall\'s foot and across the arch\'s mouth behind g1');
    await knockOut(D, 'greenberet', g1, { reach: 4, ahead: 6, quiet: 14, label: 'outside the arch' });
    await stowMan(D, g1, 'casedda:door', { label: '(the casedda)', clear: 10, after: [80.6, 77.2] });
    D.checkpoint('E2 the Green Beret fists g1, cuffs him and carries him back into the casedda');
  }],
  ['F', 'The yard walkers', async (D) => {
    // y1 walks round the yard. At its south-west corner he halts looking west at the stables, the arch three paces
    // behind him: the Green Beret, lying at the foot of the wall beside the arch, gets up, steps in, fists him, cuffs
    // him and carries him out to the casedda
    const y1 = D.get('y1');
    await crawlTo(D, 'greenberet', 82.6, 77.2, { keepWalker: 4, label: 'the Green Beret beside the arch' });
    D.checkpoint('F1 the Green Beret lies at the foot of the wall beside the arch');
    await knockOut(D, 'greenberet', y1, { ready: () => atHalt(y1, 86, 72.6, 1.0), reach: 6.5, ahead: 12, quiet: 18, later: [], maxSec: 300, standUp: true, label: 'at the yard\'s south-west corner' });
    await stowMan(D, y1, 'casedda:door', { label: '(the casedda)', clear: 9, after: [82.6, 77.2] });
    D.checkpoint('F2 the Green Beret fists y1 at the yard\'s south-west corner and carries him to the casedda');
  }],
  ['G', 'The stable sentry', async (D) => {
    const st1 = D.get('st1');
    // with the walkers gone only st1, at the stables door, looks across the yard (east, at the officers' wing): the
    // Green Beret comes in under the arch and up the stables' wall from his blind south side, fists him, cuffs him and
    // carries him out to the casedda
    await D.stance('greenberet', 'crawl');
    for (const [x, z] of [[86.8, 74.6], [87.2, 70.6], [86.0, 65.8]]) await crawlTo(D, 'greenberet', x, z, { keepWalker: 4, label: `the Green Beret → (${x},${z})` });
    D.checkpoint('G1 the Green Beret crawls in under the arch and up the stables\' wall behind st1');
    await knockOut(D, 'greenberet', st1, { reach: 5, ahead: 16, quiet: 20, maxSec: 400, standUp: true, label: 'at the stables door' });
    await stowMan(D, st1, 'casedda:door', { label: '(the casedda)', clear: 12, after: [82.6, 77.2] });
    D.checkpoint('G2 the Green Beret fists st1, cuffs him and carries him out to the casedda');
    const y2 = D.get('y2');
    if (y2?.alive) {
      // (Hard) y2 walks the house front; at its west end he halts looking north at the house, the stables' wall three
      // paces behind him: the Green Beret, lying there since st1, gets up behind him, fists him and cuffs him where he
      // falls (nobody passes within sight of that corner any more)
      await crawlTo(D, 'greenberet', 86.2, 62.4, { keepWalker: 4, label: 'the Green Beret along the stables\' wall' });
      D.checkpoint('G3 the Green Beret lies at the stables\' door, below the west end of y2\'s beat');
      await knockOut(D, 'greenberet', y2, { ready: () => atHalt(y2, 86.6, 57.6, 1.0), reach: 6, ahead: 6, quiet: 60, standUp: true, label: 'at the west end of the house front' });
      await D.stance('greenberet', 'crawl');
      D.checkpoint('G4 the Green Beret fists y2 at the end of his beat and leaves him cuffed by the stables');
    }
  }],
  ['H', 'The radio room', async (D) => {
    const lt1 = D.get('lt1'), op1 = D.get('op1'), hptm = D.get('hptm'), gb = D.c('greenberet');
    const wing = D.world.interactables.find((i) => i.tag === 'officers_wing:door');
    // lt1 walks between the officers' wing door and the radio room. While he is in the radio room the Green Beret
    // crosses the yard's south side and slips into the wing by its door, beside the lorry
    await crawlTo(D, 'greenberet', 99.6, 74.4, { keepWalker: 4, label: 'the Green Beret along the yard\'s south wall' });
    await D.until(() => atHalt(lt1, 104.2, 51.0, 1.5), 240, 'lt1 in the radio room');
    await D.stance('greenberet', 'stand');
    D.order('greenberet', { type: 'ability', id: 'use', target: wing });
    await D.until(() => gb.hidden, 30, 'the Green Beret inside the officers\' wing');
    D.checkpoint('H1 while lt1 is in the radio room the Green Beret slips into the officers\' wing');
    // lt1 comes back to the wing's door, then walks back to the radio room; while he stands at his table there the
    // Green Beret comes out, walks in behind him and fists him, Steinmetz and the operator (all three face their
    // tables), cuffs them and takes the key tables
    await D.until(() => atHalt(lt1, 101.8, 64.5, 1.5), 240, 'lt1 at the wing\'s door');
    await D.until(() => atHalt(lt1, 104.2, 51.0, 1.5), 120, 'lt1 back in the radio room');
    give(D, 'plant'); // (the raid starts: the Sapper sets the long fuse now, it blows after the lorry has left the gate)
    D.order('greenberet', { type: 'exit' }); // (out of the hideout)
    await D.until(() => !gb.hidden, 10, 'the Green Beret out of the wing');
    await knockOut(D, 'greenberet', lt1, { ready: () => atHalt(lt1, 104.2, 51.0, 1.5), reach: 16, ahead: 2, quiet: 12, later: [hptm, op1], label: 'in the radio room' });
    await knockOut(D, 'greenberet', hptm, { reach: 8, ahead: 2, quiet: 12, later: [op1], label: 'at his map table' });
    await knockOut(D, 'greenberet', op1, { reach: 8, ahead: 2, quiet: 12, label: 'at his set' });
    const tables = D.world.interactables.find((i) => i.tag === 'tables_case');
    D.order('greenberet', { type: 'ability', id: 'use', target: tables });
    await D.until(() => D.world.objectives.find((o) => o.id === 'o2')?.done, 20, 'the key tables taken');
    D.checkpoint('H2 the Green Beret follows lt1 into the radio room: lt1, Steinmetz and the operator out cold and cuffed; the key tables taken');
    // Steinmetz on his shoulder, out of the radio room and down the officers' wing to the lorry
    const lorry = D.world.vehicles.find((v) => (v.tag ?? v.id) === 'lorry');
    D.ability('greenberet', 'hand', hptm);
    await D.until(() => gb.carrying === hptm, 10, 'the Green Beret shoulders Steinmetz');
    await D.go('greenberet', 100.8, 61.2, { tol: 0.6 });
    D.ability('greenberet', 'enterVehicle', lorry);
    await D.until(() => hptm.vehicle === lorry, 30, 'Steinmetz in the lorry');
    await D.idle('greenberet');
    await boardLorry(D, 'greenberet');
    D.checkpoint('H3 the Green Beret carries Steinmetz to the lorry, puts him in the back and climbs in');
  }],
  ['I', 'The lorry', async (D) => {
    const lorry = D.world.vehicles.find((v) => (v.tag ?? v.id) === 'lorry'), dr = D.c('driver');
    // the Driver in at the wheel; the Sapper in the back; out by the arch, east along the wall and north past the
    // cistern: an unmarked German lorry, nobody stops it
    give(D, 'board');
    await D.until(() => dr.vehicle === lorry, 600, 'the Driver at the wheel');
    await D.until(() => heard(D, 'sapperIn'), 600, 'the Sapper in the back');
    D.checkpoint('I1 everyone aboard: the Driver at the wheel, the Sapper and the Green Beret in the back with Steinmetz');
    const patrol = ['p1a', 'p1b', 'p1c'].map((t) => D.get(t)).filter((e) => e?.alive);
    for (const to of [[97.0, 58.0], [89.0, 66.0], [88.0, 79.8], [89.4, 84.6], [97.0, 84.0], [106.0, 79.4], [113.4, 71.4], [114.2, 40.0], [114.2, 14.5]]) {
      // (Hard: up the east road only while the patrol walks the north side away from it — men stepping out of a
      // lorry's way see who drives it)
      if (to[0] === 113.4 && patrol.length) {
        await D.until(() => patrol.every((e) => e.z < 42 && e.x < 100 && Math.cos(e.heading) < 0), 400, 'the patrol away along the north side');
      }
      await D.drivePlan('driver', to[0], to[1]);
      const t0 = D.t;
      D.order('driver', { type: 'move', x: to[0], z: to[1] });
      await D.until(() => !lorry.goal && (lorry.speed || 0) < 0.05 && D.t > t0 + 0.3, 90, `the lorry → (${to})`);
      if (DBG) D.log(`DBG lorry at (${lorry.x.toFixed(1)},${lorry.z.toFixed(1)}) h${(lorry.heading * 180 / Math.PI).toFixed(0)} after → (${to})`);
    }
    D.checkpoint('I2 the lorry rolls out under the arch, east along the wall and north past the cistern tower');
    await D.until(() => D.world.objectives.find((o) => o.id === 'o3')?.done, 400, 'the coupling hut blows');
    D.checkpoint('I3 the charge on the coupling hut goes up behind them');
    D.order('driver', { type: 'move', x: 114.2, z: 1.0 });
    await D.until(() => D.world.objectives.every((o) => o.done), 60, 'out by the north road');
    D.checkpoint('I4 the lorry leaves by the north road: mission complete');
  }],
];

// (the Sapper's and the Driver's flows run alongside the stages — D.parallel in solve — and come after them here, so
// the walkthrough's steps follow the checkpoints' source order: the stages' first, then the two flows')
/**
 * The Sapper's own way, alongside everything else: out of the grove by its north gate, up the west fields to the
 * threshing floor's north-west corner, a hole cut in its wire, and down behind the coupling hut (its door sentry and
 * m1 both look south, the hut between them and him). He sets the long-fused charge when the main flow says so (the
 * team at the farm's gate: the blast must come after the lorry has left it), and waits out of sight.
 */
async function sapperFlow(D) {
  const sa = D.c('sapper');
  for (const [x, z] of [[15.0, 112.0], [15.0, 89.0], [15.0, 84.0], [22.0, 80.0], [24.0, 62.0], [34.0, 46.0], [41.6, 38.6]]) {
    await crawlTo(D, 'sapper', x, z, { label: `the Sapper → (${x},${z})` });
  }
  D.checkpoint('S1 the Sapper crawls up the west fields to the threshing floor\'s wire');
  D.order('sapper', { type: 'ability', id: 'cutters', target: { x: 44.0, z: 38.6 } });
  await D.until(() => !sa.currentAction && !sa.pendingAbility && D.world.time > 0, 30, 'the Sapper cuts the wire');
  await D.idle('sapper', 10);
  await crawlTo(D, 'sapper', 47.0, 38.4, { label: 'the Sapper through the hole' });
  await crawlTo(D, 'sapper', 57.6, 38.6, { label: 'the Sapper behind the coupling hut' });
  D.checkpoint('S2 the Sapper cuts a hole in the wire and lies behind the coupling hut');
  await D.until(() => heard(D, 'plant'), 1500, 'the word to set the charge');
  await D.stance('sapper', 'stand');
  let armed = false;
  const off = D.world.events.on('bomb:armed', (p) => { if (p.unit === sa) armed = true; });
  D.ability('sapper', 'timeBomb');
  await D.until(() => armed, 10, 'the time bomb armed');
  off?.();
  await D.idle('sapper', 6);
  await D.stance('sapper', 'crawl');
  give(D, 'planted');
  D.checkpoint('S3 the Sapper sets the long-fused charge on the coupling hut');
  // out by a second hole in the floor's east wire, down the strip between it and the farm's wall, along the wall's
  // foot to the arch and in, to the lorry's back
  await crawlTo(D, 'sapper', 70.6, 38.0, { label: 'the Sapper to the floor\'s north-east corner' });
  if (DBG) D.log(`DBG S4 at the corner t=${D.t.toFixed(1)} sapper (${sa.x.toFixed(2)},${sa.z.toFixed(2)})`);
  D.order('sapper', { type: 'ability', id: 'cutters', target: { x: 72.0, z: 40.0 } });
  await D.until(() => !sa.currentAction && !sa.pendingAbility, 30, 'the Sapper cuts the east wire');
  await D.idle('sapper', 10);
  if (DBG) D.log(`DBG S4 cut t=${D.t.toFixed(1)} sapper (${sa.x.toFixed(2)},${sa.z.toFixed(2)}) refusal=${sa.lastRefusal?.text ?? '-'} walk(72.4,40)=${D.world.grid.walkableAt(72.4, 40.0)} walk(73,40.5)=${D.world.grid.walkableAt(73.0, 40.5)}`);
  // (to the hole's mouth first, found in the live grid: the cut panel and the spot it leaves him at differ by a pace
  // between the game and the headless sim, and the planner cannot start from a prone body lying in the fence line)
  const g = D.world.grid, open = [];
  for (let z = 38.5; z <= 42.01; z += 0.25) if (g.walkableAt(71.6, z) && g.walkableAt(72.0, z)) open.push(z);
  const hz = open.length ? open.reduce((a, b) => a + b, 0) / open.length : 40.0;
  D.order('sapper', { type: 'move', x: 71.0, z: hz });
  await D.until(() => !sa.path && !sa.isMoving, 20, 'the Sapper at the hole\'s mouth');
  if (DBG) D.log(`DBG S4 hole z=${hz.toFixed(2)} [${open.join(' ')}] t=${D.t.toFixed(1)} sapper (${sa.x.toFixed(2)},${sa.z.toFixed(2)})`);
  for (const [x, z] of [[73.8, 41.0], [74.0, 74.6], [80.6, 77.2], [84.0, 77.2]]) {
    await crawlTo(D, 'sapper', x, z, { label: `the Sapper → (${x},${z})` });
    if (DBG) D.log(`DBG S4 → (${x},${z}) t=${D.t.toFixed(1)} sapper (${sa.x.toFixed(2)},${sa.z.toFixed(2)})`);
  }
  D.checkpoint('S4 the Sapper crawls out of the floor by a second hole and down to the farm\'s gate');
  await D.until(() => heard(D, 'board'), 900, 'the word to board');
  await crawlTo(D, 'sapper', 94.2, 66.4, { keepWalker: 4, label: 'the Sapper into the yard to the lorry\'s tail' });
  await boardLorry(D, 'sapper');
  give(D, 'sapperIn');
  D.checkpoint('S5 the Sapper climbs into the back of the lorry');
}

/** `role` climbs into the lorry (unseen: a man seen boarding taints it). */
/**
 * The Driver's way to the wheel once the yard is clear: from the field wall's end round the field behind the road to
 * the casedda, in under the arch and along the yard's south wall to the lorry's cab.
 */
async function driverFlow(D) {
  await D.until(() => heard(D, 'plant'), 2400, 'the yard cleared');
  for (const [x, z] of [[66.4, 89.6], [65.4, 86.6], [65.6, 80.4], [66.6, 75.3], [73.9, 75.2], [80.6, 77.2], [84.2, 77.3]]) {
    await crawlTo(D, 'driver', x, z, { keepWalker: 4, label: `the Driver → (${x},${z})` });
  }
  D.checkpoint('D1 the Driver crawls round behind the road to the farm\'s gate');
  await D.until(() => heard(D, 'board'), 900, 'the word to board');
  await crawlTo(D, 'driver', 92.6, 69.4, { keepWalker: 4, label: 'the Driver to the lorry\'s cab' });
  await boardLorry(D, 'driver');
  D.checkpoint('D2 the Driver climbs in at the wheel');
}

export async function solve(D, ctx = {}) {
  const w = D.world;
  D.straightDashes = true;
  w.sneakTurns = true;
  w.sneakWalkAmp = 0.05; // (a walker's head stays on his way: enemy-brain _route looks straight ahead between halts)
  const failed0 = D.failed.bind(D);
  D.failed = () => failed0() || (w.commandos.find((c) => c.downed) ? `${w.commandos.find((c) => c.downed).role} down` : null);
  SIG.plant = null; SIG.planted = null; SIG.board = null; SIG.sapperIn = null;
  const main = async () => {
    for (const [id, title, fn] of STAGES) {
      if (ctx.from && id < ctx.from) continue;
      ctx.onStage?.(id, title, D.t);
      await fn(D, ctx);
      if (ctx.until && id >= ctx.until) break;
    }
  };
  await D.parallel(main, () => sapperFlow(D), () => driverFlow(D));
  return D.checkpoints;
}
