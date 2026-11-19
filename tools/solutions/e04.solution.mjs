/**
 * LIGHTS OUT e04 "Black Rain" (Puits Sainte-Barbe colliery): a full stealth solution, played only with player orders
 * (docs/expansion/e04.md §11, as built). Driver API: tools/solutions/driver.mjs; sneaking helpers:
 * tools/solutions/sneak.mjs. Headless:
 *   node tools/solutions/run-headless.mjs e04 [--easy] [--until X]
 * Reference run in the real game: tests/e04-solution.test.mjs. Walkthrough: e04.walkthrough.mjs.
 *
 * Every knock-out is from behind and unwitnessed, every man knocked out is cuffed (a bound man seen is freed and both
 * shout), and no commando is ever inside a live cone (the driver's exposure watch). Wins with every objective done,
 * 0 detections and 0 exposures, on Hard and on Easy.
 */
import { sneak, routeClear, clearFor, unwitnessed, bodySeen, predict, walking } from './sneak.mjs';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { mirrorOf, ghostOn } from './ghost.mjs';
import { shotSight } from '../../src/abilities/common.js';

const DBG = !!globalThis.process?.env?.E04DBG;
/** (dev) stop the run right after this checkpoint id */
const STOP = globalThis.process?.env?.E04STOP;

const ROLES = ['greenberet', 'driver', 'sapper', 'sniper'];
const train = (D) => D.world.vehicles.find((v) => v.vehicleType === 'train');
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

const KO_ID = { greenberet: 'knockoutFist', driver: 'knockoutClub' };

/**
 * `role` knocks `victim` out from behind once `ready()` holds, he is within `reach`, the victim's cone will not hold
 * him for `ahead` s, nobody else sees the blow, and the man down lies unseen for `quiet` s (`later`: men who will be
 * down by then). With `cuff`, the Green Beret cuffs him at once (the Driver's man is cuffed by `cuffer`).
 */
async function knockOut(D, role, victim, { ready = () => true, reach = 2.6, ahead = 1.8, quiet = 20, later = [], maxSec = 300, cuff = true, cuffer = 'greenberet', label = '' } = {}) {
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
    // (the walk in: nobody, the victim included, sees him on the way; at the victim's own spot only the others)
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
  if (cuff) await cuffMan(D, cuffer, victim);
}

/** The Green Beret cuffs the stunned `victim` (1.5 s, a suspicious act: unwitnessed). */
async function cuffMan(D, role, victim, { maxSec = 40 } = {}) {
  const u = D.c(role), why = [];
  if (typeof victim === 'string') victim = D.get(victim);
  await D.until(() => {
    why.length = 0;
    if (victim.ko !== 'stunned') throw new Error(`${victim.tag} no longer stunned (${victim.ko})`);
    if (Math.hypot(victim.x - u.x, victim.z - u.z) > 3.5) { if (!u.path && !u.isMoving) D.order(role, { type: 'move', x: victim.x, z: victim.z }); return false; }
    if (!unwitnessed(D, victim, bare(u), { ahead: 2.2, strict: true, why })) return dbg(D, why, `cuff ${victim.tag}`);
    return true;
  }, maxSec, `cuff ${victim.tag}`);
  D.ability(role, 'handcuff', victim);
  await D.until(() => victim.ko === 'bound', 8, `${victim.tag} cuffed`);
  await D.idle(role, 5);
}

/** The Green Beret shoulders bound / dead `tag`, carries him along `pts` and puts him down at the last one, unseen. */
async function carryMan(D, tag, pts, { maxWait = 180, quiet = 600, label = '' } = {}) {
  const role = 'greenberet', u = D.c(role), e = typeof tag === 'string' ? D.get(tag) : tag, why = [];
  const end = pts[pts.length - 1];
  await D.until(() => {
    why.length = 0;
    if (!clearFor(D, [[u.x, u.z], ...pts], 6, { mode: 'walk', why })) return dbg(D, why, `carry ${e.tag}`);
    const f = quiet > 0 ? bodySeen(D, end[0], end[1], quiet, { step: 1, except: [e] }) : [];
    if (f.length) return dbg(D, [`at the end seen by ${f.join(',')}`], `carry ${e.tag}`);
    return true;
  }, maxWait, `window to carry ${e.tag}${label ? ' ' + label : ''}`);
  await D.stance(role, 'stand');
  // (BCD §1.5: the first hand on a man who still has his pack takes the pack; the next one shoulders him)
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

/** The first of `cands` that stays unseen for `dur` s (mode 'crawl': a man lying there), else the last one. */
function quietSpot(D, cands, dur = 120, mode = 'crawl') {
  for (const c of cands) if (clearFor(D, [c], dur, { mode, step: 0.5 })) return c;
  return null;
}

/**
 * The walkable spot in the box [x0, z0]–[x1, z1] (1 m grid) nearest `from` where a man down would lie unseen for `quiet`
 * s (bodySeen: any viewer's full cone, both bands), or null.
 */
function findDump(D, [x0, z0, x1, z1], from, quiet = 300, except = []) {
  const g = D.world.grid, cells = [];
  for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1) if (g.walkableAt(x, z)) cells.push([x, z, Math.hypot(x - from[0], z - from[1])]);
  cells.sort((a, b) => a[2] - b[2]);
  for (const [x, z] of cells) if (!bodySeen(D, x, z, quiet, { step: 1, except }).length) return [x, z];
  return null;
}

/** The coal train's tail is west of x (it runs west) or no train is out; the next one is a period away. */
function trainClearOf(D, x, gap = 3) {
  const t = train(D);
  if (!t || !t.railRunning) return true;
  const half = (t.def?.size?.[0] ?? 60) / 2;
  return t.x + half < x - gap;
}
/** Seconds until the next train's nose reaches x (Infinity while one runs west of x already, ∞ past its tail). */
function trainEta(D, x) {
  const t = train(D);
  if (!t) return Infinity;
  const S = t.schedule, half = (t.def?.size?.[0] ?? 60) / 2, sp = S?.speed ?? 9, x0 = t.track?.[0]?.x ?? 199.5;
  if (t.railRunning) return t.x - half > x ? (t.x - half - x) / sp : Infinity;
  return Math.max(0, (t.railT ?? 0)) + (x0 - half - x) / sp;
}

/** The rail strip of the main line (the coal train's kill box): never planned over once across. */
const RAIL_STRIP = [[-5, 7.6], [205, 7.6], [205, 16.4], [-5, 16.4]];
const NO_RAIL = [RAIL_STRIP];

/** Is the station chief away from his office door (walking to the baths, or at them)? */
const chiefAway = (D, far = 14) => { const lt = D.get('lt'); return !lt?.alive || !!lt.ko || Math.hypot(lt.x - 153.4, lt.z - 44.8) > far; };
/** The chief will not come within `r` m of the office front (155, 44) in the next `sec` s (his route, predicted). */
const chiefClear = (D, sec = 40, r = 22) => {
  const lt = D.get('lt');
  if (!lt?.alive || lt.ko) return true;
  for (let t = 0; t <= sec; t += 1) { const q = predict(lt, t); if (Math.hypot(q.x - 155, q.z - 44) < r) return false; }
  return true;
};
/** The chief is walking to the baths (away from the office for ~70 s more). */
const chiefLeaving = (D) => { const lt = D.get('lt'); return !!lt && lt.alive && !lt.ko && (lt.brain?.routeDir ?? 1) > 0 && lt.x < 150; };

export const STAGES = [
  ['A', 'The verge: east along the main line behind the hedges', async (D) => {
    // four men crawl east along the grass verge north of the line, out of the near band of every cone in the yard
    const spots = { greenberet: [158.4, 5.4], sapper: [156.6, 6.2], driver: [154.8, 5.0], sniper: [153.2, 6.0] };
    await D.parallel(...ROLES.map((r) => () => sneak(D, spots[r][0], spots[r][1], { mode: 'crawl', role: r, label: `${r} along the verge`, forbid: NO_RAIL, box: 8, horizon: 300 })));
    D.checkpoint('A1 the team on the verge opposite the sidings\' east end');
  }],
  ['B', 'The main line: behind the coal train, the Sapper cuts the fence', async (D) => {
    const why = [];
    // right behind a train (the next is a period away): over the rails to the fence; the Sapper cuts it; all through
    await D.until(() => {
      why.length = 0;
      if (!trainClearOf(D, 150) || trainEta(D, 162) < 45) return false;
      return routeClear(D, [[156.6, 13.4]], { mode: 'crawl', from: [D.c('sapper').x, D.c('sapper').z], speed: 0.75, hold: 6, slack: 0.6, why }) || dbg(D, why, 'over the line');
    }, 400, 'the coal train past, nobody looking at the fence');
    const near = { greenberet: [158.2, 11.0], driver: [155.0, 11.0], sniper: [153.8, 11.4] };
    D.order('sapper', { type: 'move', x: 156.6, z: 13.4 });
    for (const r of ['greenberet', 'driver', 'sniper']) D.order(r, { type: 'move', x: near[r][0], z: near[r][1] });
    await D.until(() => Math.hypot(D.c('sapper').x - 156.6, D.c('sapper').z - 13.4) < 0.5 && !D.c('sapper').isMoving, 30, 'the Sapper at the fence');
    D.ability('sapper', 'cutters', { x: 156.6, z: 14.6 });
    await D.idle('sapper', 10);
    const through = { greenberet: [158.6, 16.4], sapper: [156.6, 16.6], driver: [155.0, 16.6], sniper: [153.8, 16.4] };
    for (const r of ROLES) D.order(r, { type: 'move', x: through[r][0], z: through[r][1] });
    await D.until(() => ROLES.every((r) => Math.hypot(D.c(r).x - through[r][0], D.c(r).z - through[r][1]) < 0.6), 40, 'the team through the cut');
    D.checkpoint('B1 over the line behind the coal train and through the fence');
  }],
  ['C', 'The Driver\'s rifle: the aerial-lead walker at his east end', async (D) => {
    const dr = D.c('driver'), lr2 = D.get('lr2'), why = [];
    await sneak(D, 160.2, 17.2, { mode: 'crawl', role: 'driver', label: 'the Driver past the buffer stop', box: 6 });
    // lr2 halts at the lamp room's north-east corner (158, 28.6) and looks east, 12 m from the Driver: one round when
    // the chief is at the baths (his door looks north over that spot) and nobody but lr2 sees the Driver kneel
    await D.until(() => {
      why.length = 0;
      if (!lr2.alive) return true;
      if (lr2.x < 157 || Math.hypot(lr2.x - dr.x, lr2.z - dr.z) > 25.5 || !shotSight(D.world, dr, lr2, true)) return false;
      if (!clearFor(D, [[dr.x, dr.z]], 3, { mode: 'walk', except: [lr2], why })) return dbg(D, why, 'rifle');
      const p = walking(lr2) ? predict(lr2, 0.8) : lr2;
      if (bodySeen(D, p.x, p.z, 600, { step: 1, except: [lr2] }).length) return dbg(D, ['body'], 'rifle');
      return true;
    }, 400, 'lr2 past the lamp room\'s middle, nobody to see him fall');
    D.ability('driver', 'rifle', lr2);
    await D.until(() => !lr2.alive, 6, 'lr2 down');
    await D.idle('driver', 5);
    await D.stance('driver', 'crawl');
    D.checkpoint('C1 one round from the Lee-Enfield: lr2 down behind the office, out of the chief\'s sight');
  }],
  ['D', 'The office: the door sentry, the bearing archive', async (D) => {
    const gb = D.c('greenberet'), of1 = D.get('of1');
    // along the office's east wall to its front, behind the door sentry (he faces south over the lorries)
    await sneak(D, 159.4, 32.6, { mode: 'crawl', role: 'greenberet', label: 'GB to the office\'s north-east corner', box: 8 });
    await D.until(() => chiefClear(D, 45), 300, 'the chief well away from his office');
    await sneak(D, 158.6, 42.8, { mode: 'crawl', role: 'greenberet', label: 'GB down the office\'s east side', box: 6 });
    await sneak(D, 155.6, 43.6, { mode: 'crawl', role: 'greenberet', label: 'GB beside the door sentry', box: 5, keepWalker: 0, except: [of1] });
    await knockOut(D, 'greenberet', of1, { ready: () => chiefClear(D, 30), reach: 3.4, quiet: 30, label: 'at the office door', maxSec: 60 });
    D.checkpoint('D1 of1 out cold and cuffed at the office door');
    await carryMan(D, of1, [[158.4, 43.4], [159.0, 36], [156.4, 31.6]], { maxWait: 90, quiet: 600, label: 'behind the office' });
    D.checkpoint('D2 of1 behind the office');
    const doc = D.item('archive');
    await D.until(() => chiefClear(D, 20) && clearFor(D, [[gb.x, gb.z], [158.4, 43.4], [154, 43.6]], 4, { mode: 'walk' }), 200, 'the office door quiet');
    D.ability('greenberet', 'hand', doc);
    await D.until(() => D.world.objectives.find((o) => o.id === 'o1')?.done, 30, 'the archive taken');
    await D.idle('greenberet', 10);
    D.checkpoint('D3 the bearing archive is ours (o1)');
  }],
  ['E', 'The chief at his door from behind, then the sentry between the lorries', async (D) => {
    const gb = D.c('greenberet'), tl1 = D.get('tl1'), lt = D.get('lt');
    // off the office step at once: the GB lies in the yard south-east of the door, out of the chief's near band as he
    // comes back from the baths, and behind him once he stands at his door looking at the office
    const lair = quietSpot(D, [[163, 54], [162.6, 51], [163.4, 57], [161.4, 55.4], [160.4, 58.4]], 150) ?? [163, 54];
    if (DBG) D.log(`DBG lair ${lair}`);
    await sneak(D, lair[0], lair[1], { mode: 'crawl', role: 'greenberet', label: 'GB to the yard south-east of the office', box: 8 });
    await D.until(() => !lt.alive || lt.ko || (Math.hypot(lt.x - 153.4, lt.z - 44.8) < 0.8 && lt.brain?.atWait), 300, 'the chief back at his door');
    if (lt.alive && !lt.ko) {
      await sneak(D, 154.6, 47.4, { mode: 'crawl', role: 'greenberet', label: 'GB behind the chief', box: 6, keepWalker: 0, except: [lt] });
      await knockOut(D, 'greenberet', lt, { reach: 4.6, quiet: 12, label: 'at his door', maxSec: 50 });
      const dump = findDump(D, [149, 22, 163, 34], [158, 34], 300, [lt]);
      if (DBG) D.log(`DBG lt dump ${dump}`);
      if (!dump) throw new Error('no quiet spot behind the office for the chief');
      await carryMan(D, lt, [[158.6, 43.6], [159.2, 36], dump], { maxWait: 60, quiet: 0, label: 'behind the office' });
    }
    D.checkpoint('E1 the station chief out cold and cuffed at his door');
    // tl1 looks west along the baths: from behind (north-east), between the lorries
    await sneak(D, 145.0, 54.4, { mode: 'crawl', role: 'greenberet', label: 'GB behind tl1', box: 6 });
    await knockOut(D, 'greenberet', tl1, { reach: 4.6, quiet: 12, label: 'between the lorries', maxSec: 120 });
    const dump = findDump(D, [130, 44, 162, 62], [143, 55], 300, [tl1]);
    if (DBG) D.log(`DBG tl1 dump ${dump}`);
    if (!dump) throw new Error('no quiet spot near the lorries for tl1');
    await carryMan(D, tl1, [dump], { maxWait: 60, quiet: 0, label: 'out of sight' });
    await D.stance('greenberet', 'crawl');
    D.checkpoint('E2 tl1 out cold and cuffed between the lorries');
  }],
  ['F', 'Two remote charges on the DF lorries', async (D) => {
    const sa = D.c('sapper');
    await sneak(D, 159.4, 32.6, { mode: 'crawl', role: 'sapper', label: 'Sapper to the office\'s north-east corner', box: 8 });
    await sneak(D, 158.8, 44.0, { mode: 'crawl', role: 'sapper', label: 'Sapper down the office\'s east side', box: 6 });
    for (const [x, z, v] of [[145.4, 52.9, 'lorry_b'], [140.6, 52.9, 'lorry_a']]) {
      await sneak(D, x, z, { mode: 'crawl', role: 'sapper', label: `Sapper to ${v}`, box: 8 });
      await D.until(() => clearFor(D, [[sa.x, sa.z]], 4.5, { mode: 'walk' }), 120, `a quiet moment at ${v}`);
      D.ability('sapper', 'remoteBomb');
      await D.idle('sapper', 8);
      await D.stance('sapper', 'crawl');
    }
    D.checkpoint('F1 remote charges on both DF lorries');
  }],
  ['G', 'The spoil wagon: a wall that walks along the tramway', async (D) => {
    const wag = D.item('wag_p2'), gb = D.c('greenberet');
    // the team waits out of every cone near the lorries (the Driver and the Sniper come down the office's east side
    // from the fence); then the GB pushes the wagon east along the tramway and the others crawl in its lee
    const hold = (cands) => quietSpot(D, cands, 60) ?? cands[0];
    const spots = {
      greenberet: hold([[144.6, 54.6], [143.6, 52.4], [141.4, 51.6]]),
      sapper: hold([[141.6, 54.4], [142.8, 52.0], [144.6, 51.2]]),
    };
    await D.parallel(
      async () => { await sneak(D, 159.4, 32.6, { mode: 'crawl', role: 'driver', label: 'Driver to the office corner', box: 8 }); await sneak(D, 158.8, 44.0, { mode: 'crawl', role: 'driver', label: 'Driver down the office side', box: 6 }); await sneak(D, 146.4, 51.4, { mode: 'crawl', role: 'driver', label: 'Driver to the lorries', box: 8 }); },
      async () => { await D.wait(6); await sneak(D, 159.4, 32.6, { mode: 'crawl', role: 'sniper', label: 'Sniper to the office corner', box: 8 }); await sneak(D, 158.8, 44.0, { mode: 'crawl', role: 'sniper', label: 'Sniper down the office side', box: 6 }); await sneak(D, 148.6, 51.6, { mode: 'crawl', role: 'sniper', label: 'Sniper to the lorries', box: 8 }); },
      () => sneak(D, ...spots.sapper, { mode: 'crawl', role: 'sapper', label: 'Sapper by the lorries', box: 6 }),
      () => sneak(D, ...spots.greenberet, { mode: 'crawl', role: 'greenberet', label: 'GB by the lorries', box: 6 }),
    );
    D.checkpoint('G1 the team gathered by the lorries');
    // the lee: the crawlers' lane along the wagon's north side; the pusher at its west end
    const x0 = wag.x, x1 = 161.2, lane = { driver: 1.4, sapper: 0, sniper: -1.4 }, why = [];
    // the slurry pair walk west (backs to the tramway) or stand at their west end looking west for the next 40 s
    const awayWest = (e) => {
      if (!e?.alive || e.ko) return true;
      for (let t = 0; t <= 32; t += 1) {
        const q = predict(e, t);
        if (q.x <= 105 || Math.cos(q.heading) <= -0.7) continue; // walking west / at the west end: his back to us
        if (q.x >= 137.4 && Math.sin(q.heading) >= 0.7) continue; // at the east end looking out over the lagoon
        return false;
      }
      return true;
    };
    const slurry = [D.get('y1'), D.get('y2')].filter(Boolean);
    const ok = () => {
      why.length = 0;
      if (!slurry.every(awayWest)) return dbg(D, ['slurry pair', ...slurry.map((e) => `${e.tag}:${e.x.toFixed(0)},${e.z.toFixed(0)},h${(e.heading * 57.3).toFixed(0)},${e.brain?.state}`)], 'push');
      const ex = x0 - 2.9, pts = [[ex, 68]]; for (let x = ex; x <= ex + (x1 - x0) + 0.01; x += 1.5) pts.push([x, 68]);
      if (!routeClear(D, [[ex, 68]], { mode: 'walk', from: [gb.x, gb.z], speed: 1.8, hold: 1, slack: 0.6, why, except: slurry })) return dbg(D, why, 'to the wagon');
      if (!routeClear(D, pts, { mode: 'walk', from: [ex, 68], speed: 0.8, delay: 9, hold: 1, slack: 0.6, why, except: slurry })) return dbg(D, why, 'push');
      for (const r of ['driver', 'sapper', 'sniper']) {
        const u = D.c(r), lx = x0 + lane[r], lpts = [[lx, 66.1]]; for (let x = lx; x <= lx + (x1 - x0) + 0.01; x += 1.5) lpts.push([x, 66.1]);
        if (!routeClear(D, lpts, { mode: 'crawl', from: [u.x, u.z], speed: 0.75, hold: 1, slack: 0.6, why, except: slurry })) return dbg(D, why, `lee ${r}`);
      }
      return true;
    };
    await D.until(ok, 300, 'nobody looking at the wagon or its lee');
    for (const r of ['driver', 'sapper', 'sniper']) D.order(r, { type: 'move', x: x0 + lane[r], z: 66.1 });
    await D.stance('greenberet', 'stand');
    await D.go('greenberet', x0 - 2.9, 68, { tol: 0.4 });
    D.ability('greenberet', 'use', wag);
    await D.until(() => !!wag.goal, 5, 'the wagon rolling');
    while (wag.goal && wag.x < x1) {
      for (const r of ['driver', 'sapper', 'sniper']) { const u = D.c(r), tx = Math.min(wag.x + lane[r] + 0.6, x1 + lane[r]); if (Math.abs(u.x - tx) > 0.9 && !u.path) D.order(r, { type: 'move', x: tx, z: 66.1 }); }
      await D.wait(0.5);
    }
    D.order('greenberet', { type: 'stance', stance: 'crawl' });
    await D.wait(1);
    D.checkpoint('G2 the wagon pushed east to the winding house\'s yard, the team in its lee');
  }],
  ['H', 'The winding house: the winchman in the south door, then the corner sentry', async (D) => {
    const wh1 = D.get('wh1'), w1 = D.get('w1');
    // the GB waits behind the house's west end (the house hides him from the winchman's whole walk); the others come
    // along the tramway to the house's south-west
    await D.parallel(
      () => sneak(D, 168.8, 61.4, { mode: 'crawl', role: 'greenberet', label: 'GB behind the winding house', box: 8 }),
      () => sneak(D, 168.4, 59.6, { mode: 'crawl', role: 'sapper', label: 'Sapper behind the winding house', box: 8 }),
      () => sneak(D, 167.2, 60.4, { mode: 'crawl', role: 'driver', label: 'Driver behind the winding house', box: 8 }),
      () => sneak(D, 167.6, 61.9, { mode: 'crawl', role: 'sniper', label: 'Sniper behind the winding house', box: 8 }),
    );
    // the winchman steps from his drum into the house's south door (looking in at the door): from behind
    await D.until(() => Math.hypot(w1.x - 173.4, w1.z - 66.6) < 0.6 && w1.brain?.atWait, 200, 'the winchman in the south door');
    await D.stance('greenberet', 'stand');
    await knockOut(D, 'greenberet', w1, { reach: 7.5, quiet: 30, later: [wh1], label: 'in the south door', maxSec: 10 });
    D.checkpoint('H1 the winchman out cold and cuffed in the house\'s south door');
    // the corner sentry looks east over the incline foot: from behind, along the wall
    await knockOut(D, 'greenberet', wh1, { reach: 4.6, quiet: 60, label: 'at the house\'s corner', maxSec: 60 });
    D.checkpoint('H2 the corner sentry out cold and cuffed');
  }],
  ['I', 'The incline: three men in the skip, the winchman on strings at his drum', async (D) => {
    const w1 = D.get('w1'), skip = D.item('incline'), winch = D.item('incline_winch');
    const foot = skip.stops[0], seat = { driver: [-0.5, -0.3], sapper: [0.5, -0.1], sniper: [0, 0.6] };
    if (DBG) { D.log(`DBG foot ${foot.x},${foot.z},${foot.y} seers low ${D.seers(foot.x, foot.z, true)} high ${D.seers(foot.x, foot.z, false)} hp1 ${D.get('hp1').heading}`); }
    // the riders crawl into the skip at the foot (beyond the rim sentry's near band: lying low they are unseen, and the
    // skip's sides hide them); the GB crawls south-east of the winch, in sight of both the door and the drum
    await D.parallel(
      ...['driver', 'sapper', 'sniper'].map((r) => () => sneak(D, foot.x + seat[r][0], foot.z + seat[r][1], { mode: 'crawl', role: r, label: `${r} into the skip`, box: 8, tol: 0.35, crawlPad: 0.8, edgePad: 0.8 })),
      () => sneak(D, 179.6, 70.6, { mode: 'crawl', role: 'greenberet', label: 'GB south of the winch', box: 8, crawlPad: 0.8, edgePad: 0.8 }),
    );
    D.checkpoint('I1 three men lying in the skip at the incline foot; the GB south of the winch');
    // R on the winchman: he stands in his doorway, walks to his drum (the rim sentry sees a winchman) and works it
    D.ability('greenberet', 'puppet', w1);
    await D.until(() => w1.puppetOf === D.c('greenberet'), 5, 'the winchman on strings');
    D.ability('greenberet', 'puppet', winch);
    await D.until(() => !!skip.ride, 30, 'the skip moving');
    await D.until(() => skip.at === 1 && !skip.ride, 20, 'the skip at the top');
    D.checkpoint('I2 the winchman on strings sends the skip up the heap with three men in it');
    // the puppet walks back into his doorway, in the house's shadow, and sits there cuffed
    D.order('greenberet', { type: 'move', x: 173.4, z: 66.6 });
    await D.until(() => Math.hypot(w1.x - 173.4, w1.z - 66.6) < 0.8, 20, 'the winchman back in his doorway');
    D.ability('greenberet', 'puppet', w1);
    await D.until(() => !w1.puppetOf, 5, 'the winchman let go');
  }],
  ['J', 'The top: the rim sentry from the skip, the gully, the DF hut', async (D) => {
    const dr = D.c('driver'), hp1 = D.get('hp1'), df1 = D.get('df1');
    // the Driver steps out of the skip behind the rim sentry (he looks down south-east at the winch) and coshes him
    await D.stance('driver', 'stand');
    await knockOut(D, 'driver', hp1, { reach: 6, quiet: 30, cuff: false, label: 'on the rim', maxSec: 60 });
    D.checkpoint('J1 the rim sentry out cold');
    // the GB climbs the gully (the rim sentry no longer looks down it) and cuffs him; the Driver takes the DF operator
    await D.parallel(
      async () => {
        await sneak(D, 186.4, 61.4, { mode: 'walk', role: 'greenberet', label: 'GB to the gully', box: 8 });
        D.order('greenberet', { type: 'move', x: 186.5, z: 48.4 });
        await D.until(() => (D.c('greenberet').y || 0) > 17 && !D.c('greenberet').isMoving, 40, 'GB up the gully');
        await cuffMan(D, 'greenberet', hp1, { maxSec: 30 });
      },
      async () => {
        await D.until(() => hp1.ko === 'bound' || (hp1.koT ?? 30) < 6, 40, 'the rim sentry bound (or about to wake)');
        if (hp1.ko !== 'bound') await knockOut(D, 'driver', hp1, { reach: 6, quiet: 10, cuff: false, label: 'again', maxSec: 20 });
      },
    );
    D.checkpoint('J2 the GB up the gully; the rim sentry cuffed');
    await sneak(D, 182.2, 43.4, { mode: 'walk', role: 'driver', label: 'Driver behind the DF operator', box: 6, keepWalker: 0 });
    await knockOut(D, 'driver', df1, { reach: 6, quiet: 60, cuffer: 'greenberet', label: 'at the DF hut', maxSec: 90 });
    D.checkpoint('J3 the DF operator out cold and cuffed');
    // (Hard) the hut's corner sentry looks east over the far path, the north rim sentry over the north foot: from behind
    const df2 = D.get('df2'), hp2 = D.get('hp2');
    if (df2?.alive && !df2.ko) {
      await sneak(D, 183.0, 41.6, { mode: 'walk', role: 'driver', label: 'Driver behind the hut\'s corner sentry', box: 6, keepWalker: 0 });
      await knockOut(D, 'driver', df2, { reach: 6, quiet: 60, cuffer: 'greenberet', label: 'at the hut\'s corner', maxSec: 60 });
    }
    if (hp2?.alive && !hp2.ko) {
      await D.go('driver', 184.4, 43.8, { tol: 0.8 });
      await sneak(D, 178.2, 43.0, { mode: 'walk', role: 'driver', label: 'Driver round the DF hut', box: 10, keepWalker: 0 });
      await sneak(D, 177.0, 35.4, { mode: 'walk', role: 'driver', label: 'Driver behind the north rim sentry', box: 10, keepWalker: 0 });
      await knockOut(D, 'driver', hp2, { reach: 6, quiet: 60, cuffer: 'greenberet', label: 'on the north rim', maxSec: 60 });
    }
    // the third remote charge on the DF hut
    await sneak(D, 179.4, 40.6, { mode: 'walk', role: 'sapper', label: 'Sapper to the DF hut', box: 8 });
    D.ability('sapper', 'remoteBomb');
    await D.idle('sapper', 8);
    D.checkpoint('J4 a remote charge on the DF hut');
  }],
  ['K', 'Down the far side; the Sapper fires the three charges', async (D) => {
    // down the switchback on the heap's far side to its last leg, short of the woods (the exit zone): there the Sapper
    // fires; then everyone walks out (into the zone before the objectives are done, the game would ask to escape early)
    const pathTop = [191.3, 43.0], foot = { greenberet: [196.4, 39.6], driver: [196.0, 38.0], sapper: [196.8, 37.2], sniper: [196.2, 36.0] };
    const pocket = { greenberet: [197.4, 44.6], driver: [195.9, 46.8], sapper: [198.7, 47.2], sniper: [197.2, 48.5] };
    await D.parallel(...ROLES.map((r) => async () => {
      await D.stance(r, 'stand');
      await D.go(r, ...pathTop, { tol: 0.8 });
      await D.go(r, 191.3, 27.4, { tol: 0.8 });
      await D.go(r, 196.5, 27.6, { tol: 0.8 });
      await D.go(r, ...foot[r], { tol: 0.8 });
    }));
    D.checkpoint('K1 the team down the heap\'s far side, at the edge of the woods');
    // one press, one charge (the detonator fires the charges in the order they were set): the lorries, then the hut
    for (let k = 0; k < 3 && !['o2', 'o3'].every((id) => D.world.objectives.find((o) => o.id === id)?.done); k++) {
      D.ability('sapper', 'detonate');
      await D.wait(1.2);
    }
    await D.until(() => ['o2', 'o3'].every((id) => D.world.objectives.find((o) => o.id === id)?.done), 10, 'the lorries and the DF hut blown');
    D.checkpoint('K2 the Sapper fires: both DF lorries and the DF hut go up');
    await D.parallel(...ROLES.map((r) => () => D.go(r, ...pocket[r], { tol: 1.0 })));
    await D.until(() => D.world.objectives.find((o) => o.id === 'o4')?.done || D.world.missionOver, 30, 'out into the woods');
  }],
];

export async function solve(D, ctx = {}) {
  const w = D.world;
  if (STOP) { const cp = D.checkpoint; D.checkpoint = (name) => { cp(name); if (name.split(' ')[0] === STOP) throw new Error(`STOP at ${STOP}`); }; }
  D.straightDashes = true;
  w.sneakTurns = true;
  const failed0 = D.failed.bind(D);
  D.failed = () => failed0() || (w.commandos.find((c) => c.downed) ? `${w.commandos.find((c) => c.downed).role} down` : null);
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
}
