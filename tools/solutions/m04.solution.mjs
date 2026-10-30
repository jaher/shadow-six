/**
 * M4 "Restore Pride" (Stokkan), played only with player orders. Driver API: tools/solutions/driver.mjs; sneaking
 * helpers: tools/solutions/sneak.mjs. Reference run, in the real game: node tools/solutions/run-browser.mjs m04
 * (also tests/m04-solution.test.mjs). Walkthrough (debug video mode): m04.walkthrough.mjs.
 * Only the real game is the reference here: the plain headless sim (run-headless.mjs, meshes:false) builds its grid
 * without the drawn models (the ruined house, the gatehouses, the villa and the pier shed stand where the real game's
 * do not), so its run parts from the real one and stops in stage H (e59 never turns to the decoy behind the villa).
 */
import { shotClear } from '../../src/abilities/weapons.js';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { runNoiseRadius, stepSurface } from '../../src/ai/running-noise.js';
import { boardPoint } from '../../src/abilities/drive.js';
import { sneak, clearFor, routeClear, unwitnessed, bodySeen as bodySeen0, predict, viewersOf, walking, walkerSees, staticSees, withoutMovers, wheeling } from './sneak.mjs';
import { ghost, mirrorOf, ghostOn } from './ghost.mjs';

const DBG = !!(globalThis.process?.env?.M04DBG || globalThis.__M3DBG);
const dbg = (D, s) => { if (DBG) D.log(`DBG ${D.t.toFixed(1)} ${s}`); };
/** the walkers whose about-turns at their halts are looked out for (sneak.mjs turnHeadings): the ones that matter here */
let TURNS = false;
/** s: a halted walker's head is taken where his sweep puts it, ± this much time (sneak.mjs walkerViews) */
const HALT_EXACT = 0.3;

// ---------------------------------------------------------------- generic helpers

/**
 * Wait until `pred(why)` holds, tried every `every` s (the look-ahead is not free): the walkers' turns at their halts
 * swing their eyes across everything in between (sneakTurns), and a vehicle under way is no cover (withoutMovers).
 */
async function waitFor(D, pred, maxSec, label, every = 0.2, { turns = TURNS } = {}) {
  const why = [], stats = new Map(), tw0 = D.t;
  let next = -1;
  await D.until(() => {
    if (D.t + 1e-9 < next) return false;
    next = D.t + every;
    why.length = 0;
    const w = D.world, t0 = w.sneakTurns, h0 = w.sneakHaltExact;
    w.sneakTurns = turns;
    w.sneakHaltExact = HALT_EXACT; // (a halted man's head where his sweep puts it, ± that much time)
    let ok;
    try { ok = withoutMovers(w, () => pred(why)); } finally { w.sneakTurns = t0; w.sneakHaltExact = h0; }
    if (!ok && why[0]) { const k = why[0].replace(/[@(+].*$/, ''); stats.set(k, (stats.get(k) || 0) + 1); }
    const dl = globalThis.process?.env?.M04DBGLABEL ?? globalThis.__M04DBGLABEL;
    if (!ok && DBG && dl && label.includes(dl)) dbg(D, `${label}: ${why.slice(0, 6).join(' ')}`);
    return ok;
  }, maxSec, label)
    .catch((e) => { throw new Error(`${e.message} [${why.slice(0, 5).join(' ')}] {${[...stats].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}:${n}`).join(' ')}}`); });
  if (DBG && D.t - tw0 > 20) dbg(D, `waited ${(D.t - tw0).toFixed(1)} s: ${label} {${[...stats].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}:${n}`).join(' ')}}`);
}

/** Guards who would see a body left at (x, z) within `dur` s, the walkers' turns included (a body stays put). */
function bodySeen(D, x, z, dur, o = {}) {
  if (!o.shield) return bodySeen0(D, x, z, dur, o);
  // (as sneak.mjs bodySeen, skipping the moments something stands between them: `shield(e, x, z, t)`)
  const w = D.world, out = new Set(), d = { x, z, y: w.grid.elevAt?.(x, z) ?? 0, kind: 'body' }, except = o.except || [];
  for (const e of viewersOf(w)) {
    if (except.includes(e) || e.vehEye) continue;
    const moving = walking(e), far = (e.vision.far ?? 36) + 1;
    for (let t = 0; t <= dur; t += 0.25) {
      if (o.shield(e, x, z, t)) continue;
      if (moving) { const q = predict(e, t); if (Math.hypot(q.x - x, q.z - z) > far) continue; if (walkerSees(e, q, d, w, w.time + t)) { out.add(e.tag); break; } }
      else { if (Math.hypot(e.x - x, e.z - z) > far) break; if (staticSees(e, d, w, t)) { out.add(e.tag); break; } }
    }
  }
  return [...out];
}

/** The headings a squad man wheeling at `t` may face. */
function wheelHeadings(e, t) {
  const L = e.brain?._leader?.();
  if (L && L !== e && [0, -2, 2].some((o) => predict(L, Math.max(0, t + o)).halt)) return [0, 1, 2, 3, 4, 5, 6, 7].map((r) => (r * Math.PI) / 4);
  const a = predict(e, Math.max(0, t - 3)).heading, b = predict(e, t + 3).heading;
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)), out = [];
  for (const sg of Math.abs(d) > Math.PI - 0.3 ? [1, -1] : [Math.sign(d) || 1]) {
    const full = Math.sign(d) === sg ? Math.abs(d) : 2 * Math.PI - Math.abs(d);
    for (let k = 0; k <= full + 1e-6; k += 0.25) out.push(a + sg * k);
  }
  return out;
}

/**
 * Would anyone see a man at the timed spots `samples` ([x, z, y, t]: t s from now; `low` = prone), each tried `slack`
 * s early and late (walkers along their predicted beat with their turns, posts by their sweep)? Pushes who to `why`.
 */
function seenAt(D, samples, { slack = 0.75, why = null, except = [], only = null, keepWalker = 3, low = false, pad = 0.6, shield = null } = {}) {
  const w = D.world, t0 = w.sneakTurns;
  try {
    for (const e of viewersOf(w)) {
      if (except.includes(e) || (only && e !== only)) continue;
      const far = (e.vision?.far ?? 36) + 2, moving = walking(e);
      // (a post sweeping his head may swing his cone across a point within a tenth of a second: fine steps for him)
      const ostep = !moving && e.sweepActive ? 0.08 : 0.25;
      for (const [x, z, y, t] of samples) {
        for (let o = -slack; o <= slack + 1e-6; o += ostep) {
          const tt = Math.max(0, t + o);
          if (shield && shield(e, x, z, tt)) continue; // (something stands between them then: the train)
          const d = { x, z, y, isLow: low, isVisibleToEnemies: true, alive: true, kind: 'commando' };
          const nearer = (vx, vz) => { const L = Math.hypot(vx - x, vz - z); return pad && L > pad ? { ...d, x: x + ((vx - x) * pad) / L, z: z + ((vz - z) * pad) / L } : null; };
          let seen;
          if (moving) {
            const q = predict(e, tt), dd = Math.hypot(q.x - x, q.z - z);
            if (dd > far) continue;
            const d2 = nearer(q.x, q.z);
            seen = dd < keepWalker || walkerSees(e, q, d, w, w.time + tt) || (!!d2 && walkerSees(e, q, d2, w, w.time + tt))
              || (wheeling(e, tt) && wheelHeadings(e, tt).some((h) => walkerSees(e, { ...q, heading: h }, d, w, w.time + tt)));
          } else {
            if (Math.hypot(e.x - x, e.z - z) > far) continue;
            const d2 = nearer(e.x, e.z);
            seen = staticSees(e, d, w, tt) || (!!d2 && staticSees(e, d2, w, tt));
          }
          if (seen) { why?.push(`${e.tag}@(${x.toFixed(1)},${z.toFixed(1)})+${tt.toFixed(1)}`); return true; }
        }
      }
    }
    return false;
  } finally { w.sneakTurns = t0; }
}


/** timed spots along straight legs `pts` from `from` at `speed` m/s, from `t0` s: [[x, z, 0, t]…] (every 0.5 m) */
function timed(from, pts, speed, t0) {
  const out = [];
  let [x, z] = from, t = t0;
  out.push([x, z, 0, t]);
  for (const [px, pz] of pts) {
    const l = Math.hypot(px - x, pz - z), n = Math.max(1, Math.ceil(l / 0.5));
    for (let k = 1; k <= n; k++) out.push([x + ((px - x) * k) / n, z + ((pz - z) * k) / n, 0, t + (l * k) / n / speed]);
    t += l / speed; x = px; z = pz;
  }
  return out;
}
const legTime = (from, pts, speed) => { let L = 0, p = from; for (const q of pts) { L += Math.hypot(q[0] - p[0], q[1] - p[1]); p = q; } return L / speed; };
/** samples of a man holding still at (x, z) from t0 to t1 */
const hold = (x, z, t0, t1, step = 0.25) => { const out = []; for (let t = t0; t <= t1 + 1e-6; t += step) out.push([x, z, 0, t]); return out; };

/** crawl to (x, z) on a space-time plan (he waits only where nobody looks) */
async function crawl(D, role, x, z, o = {}) {
  await sneak(D, x, z, { mode: 'crawl', role, box: 8, label: `${role} → (${x},${z})`, ...o });
}

/**
 * Crawl along `pts` (a player's clicks) in one go, once nobody would see him anywhere on the way at a slow or a quick
 * crawl (the cones predicted as he passes, `pad` m nearer at the band edges) nor lying at its end for `hold` s.
 */
/** (`hold` under another name, for the helpers whose `hold` option shadows it) */
const holdPts = (...a) => hold(...a);
async function crawlRoute(D, role, pts, { hold = 4, pad = 0.6, slack = 0.6, maxWait = 600, label = '', ready = null, speeds = [0.75, 0.9], tol = 0.5, train = false } = {}) {
  const u = D.c(role), end = pts[pts.length - 1];
  await waitFor(D, (why) => {
    if (ready && !ready(why)) return false;
    for (const v of speeds) if (!routeClear(D, pts, { mode: 'crawl', from: [u.x, u.z], speed: v, delay: 0.1, slack, why, pad })) return false;
    const t = 0.1 + legTime([u.x, u.z], pts, speeds[0]);
    if (hold > 0 && !routeClear(D, [end], { mode: 'crawl', from: end, delay: t + hold / 2, slack: hold / 2 + slack, why, pad })) return false;
    if (train) {
      for (const v of [speeds[0] * 0.95, ...speeds.slice(1), 1.0]) {
        const way = timed([u.x, u.z], pts, v, 0.1), t1 = way.at(-1)[3];
        if (trainHits(D, [...way, ...holdPts(end[0], end[1], t1, t1 + (train === true ? 0 : train))], 0.8)) { why.push('train'); return false; }
      }
    }
    return true;
  }, maxWait, `${role} crawls to (${end})${label ? ' ' + label : ''}`);
  await D.stance(role, 'crawl');
  for (const [x, z] of pts) await D.go(role, x, z, { tol, max: 120 });
}

/**
 * Several men crawl their own legs at the same time (`legs`: [[role, pts]…]), once nobody would see any of them on
 * the way (a slow and a quick crawl) nor lying at the end for `hold` s.
 */
async function crawlTogether(D, legs, { hold = 4, pad = 0.6, slack = 0.6, maxWait = 600, label = '', speeds = [0.75, 0.9] } = {}) {
  await waitFor(D, (why) => {
    for (const [role, pts] of legs) {
      const u = D.c(role), end = pts[pts.length - 1];
      for (const v of speeds) if (!routeClear(D, pts, { mode: 'crawl', from: [u.x, u.z], speed: v, delay: 0.1, slack, why, pad })) return false;
      const t = 0.1 + legTime([u.x, u.z], pts, speeds[0]);
      if (hold > 0 && !routeClear(D, [end], { mode: 'crawl', from: end, delay: t + hold / 2, slack: hold / 2 + slack, why, pad })) return false;
    }
    return true;
  }, maxWait, `${legs.map(([r]) => r).join(' and ')} crawl${label ? ' ' + label : ''}`);
  for (const [role] of legs) await D.stance(role, 'crawl');
  await goTogether(D, legs, { tol: 0.5, max: 120 });
}

/**
 * (Crawl along `crawlFirst`, then) up (0.6 s), RUN along `pts` (4.5 m/s: his steps carry ~6 m on grass, so nobody may be
 * within `ear` m of the way as they will stand) and down at its end (0.5 s), once nobody would see him anywhere on the
 * way (lying, then standing: timed at a fast and a slow run) nor lying at its end for `hold` s.
 */
async function runDash(D, role, pts, { crawlFirst = [], rest = 4, slack = 0.5, pad = 0.4, maxWait = 600, label = '', ready = null, ear = 7.5 } = {}) {
  const u = D.c(role), end = pts[pts.length - 1];
  await waitFor(D, (why) => {
    if (ready && !ready(why)) return false;
    const c0 = [u.x, u.z], cEnd = crawlFirst.length ? crawlFirst[crawlFirst.length - 1] : c0;
    const tc = crawlFirst.length ? 0.1 + legTime(c0, crawlFirst, 0.85) : 0;
    if (crawlFirst.length && !routeClear(D, crawlFirst, { mode: 'crawl', from: c0, speed: 0.85, delay: 0.1, slack, why, pad })) return false;
    for (const v of [3.6, 4.5]) {
      const way = [...hold(cEnd[0], cEnd[1], tc, tc + 0.7), ...timed(cEnd, pts, v, tc + 0.7)];
      const tEnd = way.at(-1)[3];
      if (seenAt(D, [...way, ...hold(end[0], end[1], tEnd, tEnd + 0.6)], { slack, why, pad })) return false;
      // (his running steps: nobody within earshot of him as he passes)
      for (const e of viewersOf(D.world)) {
        if (Math.hypot(e.x - cEnd[0], e.z - cEnd[1]) > 40) continue;
        for (const [x, z, , t] of way) { const q = walking(e) ? predict(e, t) : e; if (Math.hypot(q.x - x, q.z - z) < ear) { why.push(`${e.tag} would hear`); return false; } }
      }
    }
    const t = tc + 0.7 + legTime(cEnd, pts, 3.6) + 0.6;
    if (rest > 0 && !routeClear(D, [end], { mode: 'crawl', from: end, delay: t + rest / 2, slack: rest / 2 + slack, why, pad })) return false;
    return true;
  }, maxWait, `${role} runs to (${end})${label ? ' ' + label : ''}`);
  if (crawlFirst.length) { await D.stance(role, 'crawl'); for (const [x, z] of crawlFirst) await D.go(role, x, z, { tol: 0.5, max: 30 }); }
  await D.stance(role, 'stand');
  for (const [x, z] of pts) {
    D.order(role, { type: 'move', x, z, run: true });
    await D.until(() => Math.hypot(u.x - x, u.z - z) < 0.8 || (!u.path && !u.isMoving), 30, `${role} runs`);
  }
  await D.stance(role, 'crawl');
}

/** several men each along his own clicks at once (each click given as he reaches the one before) */
async function goTogether(D, legs, { tol = 0.6, max = 60, run = false } = {}) {
  const st = legs.map(([role, pts]) => ({ u: D.c(role), role, pts, i: -1 }));
  const t0 = D.t;
  for (;;) {
    let all = true;
    for (const s of st) {
      if (s.i >= s.pts.length) continue;
      const p = s.pts[s.i];
      if (s.i < 0 || Math.hypot(s.u.x - p[0], s.u.z - p[1]) < tol || (!s.u.path && !s.u.isMoving && D.t > t0 + 0.3)) {
        s.i++;
        if (s.i < s.pts.length) D.order(s.role, { type: 'move', x: s.pts[s.i][0], z: s.pts[s.i][1], run });
      }
      if (s.i < s.pts.length) all = false;
    }
    if (all) return;
    if (D.t - t0 > max) throw new Error(`goTogether: ${st.map((s) => `${s.role} ${s.i}/${s.pts.length}`).join(' ')}`);
    await D.wait(D.dt);
  }
}

/**
 * Walk along `pts` in one go once nobody would see him anywhere on the way (standing, at an unhurried walk) nor
 * standing at its end for `hold` s; `train`: and the train will not reach him on the way.
 */
async function walkRoute(D, role, pts, { rest = 2, pad = 0.5, slack = 0.6, maxWait = 600, label = '', train = false } = {}) {
  const u = D.c(role), end = pts[pts.length - 1];
  await waitFor(D, (why) => {
    const up = u.stance === 'stand' ? 0 : 0.7;
    for (const v of [1.9, 2.3]) {
      const way = [...hold(u.x, u.z, 0, up), ...timed([u.x, u.z], pts, v, up)], t1 = way.at(-1)[3];
      if (seenAt(D, [...way, ...hold(end[0], end[1], t1, t1 + rest)], { slack, why, pad })) return false;
      if (train && trainHits(D, [...way, ...hold(end[0], end[1], t1, t1 + (train === true ? 0 : train))], 0.8)) { why.push('train'); return false; }
    }
    return true;
  }, maxWait, `${role} walks to (${end})${label ? ' ' + label : ''}`);
  await D.stance(role, 'stand');
  for (const [x, z] of pts) await D.go(role, x, z, { tol: 0.6, max: 60 });
}

/** shoulder (GB) or drag (anyone else) body `e` to (x, z) along `via` and let go */
async function carryTo(D, role, e, [x, z], via = []) {
  const u = D.c(role);
  await D.idle(role);
  D.ability(role, 'hand', e);
  await D.until(() => u.carrying === e, 20, `grab ${e.tag}`);
  for (const [px, pz] of via) { try { await D.go(role, px, pz, { tol: 0.7, max: 60 }); } catch (err) { if (!/short of/.test(err.message) || Math.hypot(u.x - px, u.z - pz) > 2.5) throw err; } }
  try { await D.go(role, x, z, { tol: 0.5, max: 60 }); } catch (err) { if (!/short of/.test(err.message) || Math.hypot(u.x - x, u.z - z) > 1.6) throw err; }
  D.ability(role, 'drop');
  await D.until(() => !u.carrying, 5, `let go of ${e.tag}`);
  await D.idle(role);
}

/**
 * The Green Beret (lying at `stage`, behind `victim`) knifes him and shoulders the body to `hide` along `via`, once
 * nothing can go wrong from start to finish as the cones are predicted: his crawl in (0.9 m/s), the 0.6 s he takes to
 * get up at arm's length and the stab (the victim must not see him then either), the fall (nobody else sees it), the
 * lift and the walk with the body (1.6 m/s), the drop; and nobody sees the body where it is left for `stashFor` s.
 * For a post (he stands where he stands) the crawl-in is the knife order's own; a walker is caught from behind on foot.
 */
async function strike(D, victim, { role = 'greenberet', hide = null, via = [], stashFor = 120, ready = () => true, maxSec = 600, walker = false, reach = 1.0, speed = 2.0, maxT = 14, label = '', shield = null, onGo = null, pad = 0.6 } = {}) {
  const u = D.c(role);
  await waitFor(D, (why) => {
    if (!victim.alive) return true;
    if (!ready(victim, why)) { why.push('not-ready'); return false; }
    let tHit = null, q = null, way = null;
    if (!walker) {
      // crawls straight in to a metre from him, gets up (0.6 s), steps in and stabs (0.5 s)
      q = { x: victim.x, z: victim.z, heading: victim.heading };
      const L = Math.hypot(q.x - u.x, q.z - u.z), dx = (q.x - u.x) / L, dz = (q.z - u.z) / L;
      const up = [q.x - dx * (reach + 0.2), q.z - dz * (reach + 0.2)];
      const tUp = Math.max(0, L - reach - 0.2) / 0.9;
      tHit = tUp + 0.6 + 0.5;
      if (seenAt(D, timed([u.x, u.z], [up], 0.9, 0), { low: true, slack: 0.5, why, shield })) return false;
      way = [...hold(up[0], up[1], tUp, tHit)];
    } else {
      // gets up (0.6 s), walks straight to a step behind him as he walks on, stabs
      for (let t = 1.0; t <= maxT; t += 0.2) {
        const p = predict(victim, t);
        const back = [p.x - Math.cos(p.heading) * reach, p.z - Math.sin(p.heading) * reach];
        if (0.6 + Math.hypot(back[0] - u.x, back[1] - u.z) / speed <= t) { tHit = t + 0.5; q = p; way = [...hold(u.x, u.z, 0, 0.6), ...timed([u.x, u.z], [back], speed, 0.6), ...hold(back[0], back[1], t, tHit)]; break; }
      }
      if (tHit == null) { why.push('cannot catch him'); return false; }
      // (he must not see the man coming up behind him)
      if (seenAt(D, way.filter((r) => Math.hypot(r[0] - q.x, r[1] - q.z) > reach + 0.4), { slack: 0.4, why, keepWalker: 0, only: victim })) return false;
    }
    // standing: the strike (everyone but the victim), then the lift and the carry with the body (hidden while carried)
    const pick = [q.x, q.z], tLift = tHit + 0.4 + 1.0;
    const dest = hide ?? pick;
    const carry = hide ? timed(pick, [...via, dest], 1.6, tLift) : [];
    const tEnd = (carry.at(-1)?.[3] ?? tHit) + 0.8;
    if (seenAt(D, [...way, ...hold(pick[0], pick[1], tHit, tLift), ...carry, ...hold(dest[0], dest[1], tEnd - 0.8, tEnd)], { slack: 0.6, why, except: [victim], shield, pad })) return false;
    // the fall and the body on the ground until he has it on his shoulder
    if (bodySeen(D, pick[0], pick[1], tLift + 0.5, { except: [victim], shield }).length) { why.push('fall seen'); return false; }
    if (seenAt(D, hold(pick[0], pick[1], tHit - 0.3, tHit + 0.6), { slack: 0.3, why, except: [victim], shield })) { why.push('falling man seen'); return false; }
    if (!ready(victim, why, { tEnd })) return false;
    const bs = bodySeen(D, dest[0], dest[1], tEnd + stashFor, { except: [victim] });
    if (bs.length) { why.push(`body seen by ${bs.join(',')}`); return false; }
    return true;
  }, maxSec, `${role} strikes ${victim.tag}${label ? ' ' + label : ''}`);
  if (!victim.alive) return;
  if (onGo) await onGo();
  if (walker) {
    await D.stance(role, 'stand');
    const t0 = D.t;
    while (victim.alive && Math.hypot(victim.x - u.x, victim.z - u.z) > reach + 0.6) {
      if (D.t - t0 > maxT + 4) throw new Error(`${role} never caught up with ${victim.tag}`);
      D.order(role, { type: 'move', x: victim.x - Math.cos(victim.heading) * reach, z: victim.z - Math.sin(victim.heading) * reach });
      await D.wait(0.2);
    }
  }
  if (victim.alive) D.ability(role, 'knife', victim);
  await D.until(() => !victim.alive, 15, `${victim.tag} knifed`);
  await D.idle(role, 5);
  if (hide) await carryTo(D, role, victim, hide, via);
  await D.stance(role, 'crawl');
}

/** Could the Sniper (lying where he is) drop `victim` now: in range and in line, the train not in the way, kneeling
 * unseen (his mark included) for the shot, and nobody seeing the man fall? */
function snipeOk(D, victim, why) {
  const sn = D.c('sniper');
  const kneeling = () => ({ x: sn.x, z: sn.z, y: sn.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' });
  if (D.world.time < (sn._boltT ?? -1) || sn.currentAction || sn.pendingAbility) { why.push('busy'); return false; }
  if (Math.hypot(victim.x - sn.x, victim.z - sn.z) > 44.5) { why.push('range'); return false; }
  if (!shotClear(D.world, sn, victim, true)) { why.push('no line'); return false; }
  // (the train running between them would take the bullet: the line of fire clear of it while he aims)
  const line = []; for (let k = 1; k < 10; k++) for (const t of [0, 0.4, 0.8]) line.push([sn.x + ((victim.x - sn.x) * k) / 10, sn.z + ((victim.z - sn.z) * k) / 10, 0, t]);
  if (trainHits(D, line, 0.3)) { why.push('train in the way'); return false; }
  // (kneeling for the shot: nobody may see him, his mark included, until the bullet is off; he kneels where he lies)
  if (seenAt(D, hold(sn.x, sn.z, 0, 0.9, 0.15), { slack: 0.3, why, pad: 0 })) return false;
  return unwitnessed(D, victim, kneeling(), { ahead: 0.8, why, strict: true });
}

/**
 * The Sniper, lying where he is, drops `victim` once snipeOk holds and `extra(why)` holds (what must stay unseen
 * afterwards: the body, a man going for it).
 */
async function snipe(D, victim, { ready = () => true, extra = null, maxSec = 600, every = 0.2 } = {}) {
  const sn = D.c('sniper');
  await waitFor(D, (why) => {
    if (!victim.alive) return true;
    if (!ready(victim, why)) { why.push('not-ready'); return false; }
    if (!snipeOk(D, victim, why)) return false;
    return !extra || extra(why);
  }, maxSec, `snipe ${victim.tag}`, every);
  if (!victim.alive) return;
  const off = DBG ? D.world.events.on('shot', (p) => dbg(D, `shot ${p.shooter?.role ?? p.shooter?.tag} -> ${p.target?.tag ?? p.target?.kind} ${p.weapon ?? ''}`)) : null;
  D.ability('sniper', 'sniper', victim);
  const t0 = D.t;
  await D.until(() => !victim.alive || (D.t > t0 + 0.3 && !sn.currentAction && !sn.pendingAbility), 4, `${victim.tag} shot`);
  off?.();
  if (victim.alive) throw new Error(`snipe ${victim.tag}: missed (sniper at ${sn.x.toFixed(2)},${sn.z.toFixed(2)} ${sn.stance} ${JSON.stringify(sn.lastRefusal?.text ?? null)})`);
  await D.until(() => !sn.currentAction, 2, 'sniper down');
}


/**
 * The Marine (lying within 8.7 m of `victim`, in line) gets up and harpoons him — silent — once nobody would see him
 * up for the throw, nor the man fall, nor his body where it falls for `stashFor` s; `others(why)`: what else must hold.
 */
async function harpoonShot(D, victim, { stashFor = 30, maxSec = 600, others = null } = {}) {
  const mar = D.c('diver');
  await waitFor(D, (why) => {
    if (!victim.alive) return true;
    if (Math.hypot(victim.x - mar.x, victim.z - mar.z) > 8.7) { why.push('range'); return false; }
    // up (0.6 s), the throw (0.4 s), down again (0.5 s)
    if (seenAt(D, hold(mar.x, mar.z, 0, 1.7, 0.15), { slack: 0.3, why, pad: 0.3 })) return false;
    if (seenAt(D, hold(victim.x, victim.z, 0.7, 1.6), { slack: 0.3, why, except: [victim] })) { why.push('falling man seen'); return false; }
    const bs = bodySeen(D, victim.x, victim.z, stashFor, { except: [victim] });
    if (bs.length) { why.push(`body seen by ${bs.join(',')}`); return false; }
    return !others || others(why);
  }, maxSec, `the Marine harpoons ${victim.tag}`);
  if (!victim.alive) return;
  await D.stance('diver', 'stand');
  D.ability('diver', 'harpoon', victim);
  await D.until(() => !victim.alive, 3, `${victim.tag} harpooned`);
  await D.idle('diver', 3);
  await D.stance('diver', 'crawl');
}


// ---------------------------------------------------------------- the train
const trainOf = (D) => D.world.vehicles.find((v) => v.vehicleType === 'train' && !v.removed);
/**
 * Would the train's kill box (−31.5…+16 m along its centre, ±3.4 m across) reach any of the timed spots
 * [x, z, ·, t] (t s from now, ± `m` s)? Its run is scheduled: it appears at the north-east edge, runs the line at its
 * speed and is gone `period` s; stopped (a vehicle on the line ahead), it stays where it stands.
 */
function trainHits(D, samples, m = 0.8, o_wide = null) {
  const tr = trainOf(D);
  if (!tr) return false;
  const S = tr.schedule, L = tr.trackLen, [from, to, half] = tr.killBox, v = S.speed;
  const a = tr.track[0], b = tr.track[tr.track.length - 1], ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
  // the centre's distance along the line `t` s from now (null: off the map)
  const sAt = (t) => {
    if (tr.railRunning && (tr.speed || 0) < 0.01 && tr.waitT <= 0 && t > 0) return tr.railS; // stopped by a vehicle
    let s0 = tr.railRunning ? tr.railS : null, tt = t;
    if (!tr.railRunning) { if (tt < tr.railT) return null; tt -= tr.railT; s0 = 0; }
    for (;;) {
      const run = (L - s0) / v;
      if (tt <= run) return s0 + v * tt;
      tt -= run;
      if (tt < S.period) return null;
      tt -= S.period; s0 = 0;
    }
  };
  for (const [x, z, , t] of samples) {
    const along = (x - a.x) * ux + (z - a.z) * uz, across = Math.abs(-(x - a.x) * uz + (z - a.z) * ux);
    if (across > half + (o_wide ?? 0.4)) continue;
    for (let o = -m; o <= m + 1e-6; o += 0.2) {
      const sc = sAt(Math.max(0, t + o));
      if (sc != null && along >= sc + from - 1 && along <= sc + to + 1) return true;
    }
  }
  return false;
}
/** Where the train's centre will be `t` s from now ({x, z, h}), or null (off the map): as trainHits predicts it. */
function trainCentreAt(D, t) {
  const tr = trainOf(D);
  if (!tr) return null;
  const S = tr.schedule, L = tr.trackLen, v = S.speed, a = tr.track[0], b = tr.track[tr.track.length - 1];
  let s;
  if (tr.railRunning && (tr.speed || 0) < 0.01 && !(tr.waitT > 0) && t > 0) s = tr.railS;
  else {
    let s0 = tr.railRunning ? tr.railS : null, tt = t;
    if (!tr.railRunning) { if (tt < tr.railT) return null; tt -= tr.railT; s0 = 0; }
    for (;;) { const run = (L - s0) / v; if (tt <= run) { s = s0 + v * tt; break; } tt -= run; if (tt < S.period) return null; tt -= S.period; s0 = 0; }
  }
  return { x: a.x + ((b.x - a.x) * s) / L, z: a.z + ((b.z - a.z) * s) / L, h: Math.atan2(b.z - a.z, b.x - a.x) };
}
/** Will the train's hull stand between viewer `e` and (x, z) `t` s from now (its 30 × 3.4 m body crossing the line)? */
function trainShields(D, e, x, z, t) {
  const c = trainCentreAt(D, t);
  if (!c) return false;
  const tr = trainOf(D), [L, W] = tr.def.size, cs = Math.cos(c.h), sn = Math.sin(c.h);
  const loc = (px, pz) => [(px - c.x) * cs + (pz - c.z) * sn, -(px - c.x) * sn + (pz - c.z) * cs];
  const [ax, az] = loc(e.x, e.z), [bx, bz] = loc(x, z);
  // segment a→b against the box |u| ≤ L/2 − 1, |v| ≤ W/2 (slab clipping)
  let t0 = 0, t1 = 1;
  for (const [p, d, lim] of [[ax, bx - ax, L / 2 - 1], [az, bz - az, W / 2]]) {
    if (Math.abs(d) < 1e-9) { if (Math.abs(p) > lim) return false; continue; }
    let ta = (-lim - p) / d, tb = (lim - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/** the rubble's south-west corner (the Marine: e2 8 m off, never in his sweep) and the Green Beret beside it; the way
 * round the rubble's south and west sides into the lee with e2's body; the Marine's way into the next notch */
const MAR_SW = [19.6, 146.6], GB_SW = [18.3, 147.8];
/** through the yard's south once e1, e2, e3 are gone, to the centre grove's west edge */
const YARD = [[40, 150], [46, 147], [52, 146], [55, 140], [57, 135], [60, 131], [62, 128]];
/** where each lies beyond the gap: in the lee of the rim rocks and along the rim towards the bridge (nobody looks) */
const GAP_SPOTS = { greenberet: [84.5, 130.5], sniper: [84, 128.4], driver: [86.5, 132.3], diver: [85.6, 129.6], sapper: [83.2, 132.6] };


/** e12's back (the Green Beret's stage) and where his body lies hidden in the trees */
const E12_STAGE = [63.4, 137.3], E12_HIDE = [63.5, 136.1];
/** the band past the wire's gap, now that nobody watches it */
const BAND = [[66, 130], [70, 131], [76, 131.5], [80, 131.5]];
/** where each man lies along the gorge rim by the bridge (nobody looks there) */
const RIM_SPOTS = {
  sniper: { at: [83, 131] }, sapper: { at: [85.6, 129.6] }, driver: { at: [86.6, 132.4] },
  diver: { via: [[89, 135.4], [92.5, 137.2]], at: [94.4, 138.6] }, greenberet: { via: [[89, 135.4], [92.5, 137.2], [95.3, 139.2], [96.1, 139.5]], at: [96.2, 140.2] },
};
/** the Sniper's kneeling spots for the bridge gunner and the courier (nobody sees a man there, in range of each) */
const SNIPE_E20 = [84, 128], SNIPE_E19 = [84.6, 128.1], SNIPE_E26 = [83, 131];
/** the deck: south-west end, the point the Driver crawls to before he gets up, the north-east end, off the line */
const DECK_IN = [95.3, 142.9], DECK_SW = [96.8, 143.8], DECK_UP = [100.9, 141.4], DECK_NE = [121.6, 121.0], NE_OFF = [120.5, 115.8];
/** the courier's motorcycle */
const motoOf = (D) => D.world.vehicles.find((v) => v.vehicleType === 'motorcycle');
/** `role` gets into vehicle `v` (tried again if his way there was blocked) */
async function board(D, role, v, { tries = 3, max = 40 } = {}) {
  const u = D.c(role);
  for (let k = 0; k < tries && u.vehicle !== v; k++) {
    await D.stance(role, 'stand');
    D.ability(role, 'enterVehicle', v);
    await D.until(() => u.vehicle === v || (!u.currentAction && !u.pendingAbility && D.t > 0), max, `${role} onto the ${v.vehicleType}`);
    if (u.vehicle !== v) await D.wait(0.5);
  }
  if (u.vehicle !== v) throw new Error(`${role} could not get onto the ${v.vehicleType}`);
}
/** the Driver drives `v` to (x, z) (ordered again if it pulls up short) */
async function drive(D, v, x, z, { max = 90, tol = 4 } = {}) {
  const t0 = D.t;
  let last = null;
  for (let k = 0; ; k++) {
    const t1 = D.t;
    D.order('driver', { type: 'move', x, z, run: true });
    let lastLog = D.t;
    await D.until(() => { if (DBG && D.t - lastLog >= 0.5) { lastLog = D.t; dbg(D, `moto (${v.x.toFixed(1)},${v.z.toFixed(1)}) h ${(v.heading * 57.3).toFixed(0)} spd ${(v.speed || 0).toFixed(1)} goal ${v.goal ? `${v.goal.x?.toFixed?.(1)},${v.goal.z?.toFixed?.(1)}` : '-'} path ${v.path?.length ?? 0}`); } return Math.hypot(v.x - x, v.z - z) < 1.5 || (!v.goal && (v.speed || 0) < 0.05 && D.t > t1 + 0.5); }, max, `${v.vehicleType} to (${x},${z})`)
      .catch((e) => {
        const near = [...D.world.enemies, ...D.world.commandos].filter((u) => u.alive && u !== D.c('driver') && Math.hypot(u.x - v.x, u.z - v.z) < 8).map((u) => `${u.tag ?? u.role}(${u.x.toFixed(1)},${u.z.toFixed(1)})`);
        throw new Error(`${e.message} [at (${v.x.toFixed(1)},${v.z.toFixed(1)}) goal ${!!v.goal} path ${v.path?.length ?? 0} blocked ${v.blockedT ?? '-'} near ${near.join(' ')}]`);
      });
    if (Math.hypot(v.x - x, v.z - z) < tol) return;
    // pulled up short again where it stopped before: its straight line from here clips something (§3.7 — it stops at
    // the first blocking cell), so the next click is a hop beside that line which the hull reaches in full, then on
    const same = last && Math.hypot(v.x - last[0], v.z - last[1]) < 0.4;
    last = [v.x, v.z];
    if (same && k < 5) {
      const hp = hopToward(v, x, z);
      dbg(D, `${v.vehicleType} stalled at (${v.x.toFixed(1)},${v.z.toFixed(1)}): hop ${hp ? hp.map((q) => q.toFixed(1)) : 'none'}`);
      if (hp) {
        const t2 = D.t;
        D.order('driver', { type: 'move', x: hp[0], z: hp[1], run: true });
        await D.until(() => Math.hypot(v.x - hp[0], v.z - hp[1]) < 0.8 || (!v.goal && (v.speed || 0) < 0.05 && D.t > t2 + 0.5), 20, `${v.vehicleType} hops to (${hp})`);
      }
    }
    if (k >= 5 || D.t - t0 > max) {
      const near = [...D.world.enemies, ...D.world.commandos, ...D.world.vehicles].filter((u) => u !== v && u.alive !== false && !u.removed && Math.hypot(u.x - v.x, u.z - v.z) < 9).map((u) => `${u.tag ?? u.role ?? u.vehicleType}(${u.x.toFixed(1)},${u.z.toFixed(1)})`);
      throw new Error(`the ${v.vehicleType} pulled up short of (${x},${z}) at (${v.x.toFixed(1)},${v.z.toFixed(1)}) h ${(v.heading * 57.3).toFixed(0)} [near ${near.join(' ')}]`);
    }
    if (DBG) {
      const h = Math.atan2(z - v.z, x - v.x), g = D.world.grid, why = [];
      for (const [px, pz] of v._nosePoints(v.x + Math.cos(h) * 0.5, v.z + Math.sin(h) * 0.5, h)) {
        if (v.passableAt(px, pz)) continue;
        const c = g.worldToCell(px, pz), k = g.idx(c.i, c.j), hull = D.world.vehicles.find((o) => o !== v && o._inHull?.(px, pz, 0.1));
        why.push(`(${px.toFixed(1)},${pz.toFixed(1)}) blk${g.block[k]} nav${g.navBlock[k]}${g.hullBlocked?.(k) ? 'H' : ''} over${g.overLo?.[k] < Infinity ? g.overLo[k].toFixed(1) : '-'}${hull ? ' hull ' + (hull.tag ?? hull.vehicleType) : ''}`);
      }
      dbg(D, `${v.vehicleType} pulled up short of (${x},${z}) at (${v.x.toFixed(1)},${v.z.toFixed(1)}): again [${why.slice(0, 4).join(' ')}]`);
    }
  }
}
/**
 * A point beside the straight line from the hull to (x, z) that the hull reaches in full and from which the line on to
 * (x, z) is clear (a player's next click when a click stops short at a corner), or null.
 */
function hopToward(v, x, z) {
  const L = Math.hypot(x - v.x, z - v.z), ux = (x - v.x) / L, uz = (z - v.z) / L;
  for (const f of [0.35, 0.55, 0.2]) {
    for (const o of [0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4]) {
      const px = v.x + ux * L * f - uz * o, pz = v.z + uz * L * f + ux * o;
      const a = Math.hypot(px - v.x, pz - v.z), b = Math.hypot(x - px, z - pz);
      if (a < 1.5 || !v.canDriveTo(px, pz)) continue;
      if (v.straightReach(px, pz) >= a - 0.3 && v.straightReach(x, z, px, pz) >= b - 0.3) return [+px.toFixed(2), +pz.toFixed(2)];
    }
  }
  return null;
}
/** the RAF air-drop crate, and the Driver's way to it round the gun pit and the forests */
const crateOf = (D) => D.world.interactables.find((i) => i.interactKind === 'crate');
const TO_CRATE = [[133.5, 99.5], [135.5, 86], [139.5, 77.5], [152, 80], [160, 62], [182, 56], [187, 46], [187, 32], [182.5, 37]];
/** the pier shed's door (a hideout: whoever goes in is out of everyone's sight) */
const shedDoor = (D) => D.world.interactables.find((i) => i.interactKind === 'door' && i.enterable && /shed_pier/.test(i.tag ?? i.id ?? ''));
/** where the motorcycle stands at the bridge head (off the line, out of everyone's sight), and by the pier shed */
const P_BH = [131.2, 127.4], P_SHED = [56.5, 48.5];
/** (the last stretch to the bridge head swings east round the men lying there) */
const BH_IN = [[140, 113.5], [138, 123.5], P_BH];
/** the Driver's ways: crate → bridge head, bridge head → crate, bridge head → shed, shed → bridge head, crate → shed */
const CRATE_TO_BH = [[186, 46], [182, 56], [160, 62], [152, 80], [139.5, 77.5], [135.5, 86], [133.5, 99.5], ...BH_IN];
const BH_TO_CRATE = [[138, 123.5], [140, 113.5], [133.5, 99.5], [135.5, 86], [139.5, 77.5], [152, 80], [160, 62], [182, 56], [187, 46], [187, 32], [182.5, 37]];
/** where the motorcycle waits off the road short of the outer gate (out of the lorry's way), and on from there */
const W_GATE = [113, 74.5];
/**
 * The outer gate's passage between the drawn gatehouses gh_a / gh_b is the road's line (x − z = 46, heading 45°): a
 * straight leg through it must run along that line (§3.7: a click whose line clips a gatehouse stops the hull there).
 * GATE_OUT lies on it just past the gatehouses, (94.8, 48.6) is the arch gap on it, (97.4, 51.4) just inside the gate.
 */
const GATE_OUT = [106.2, 60.2];
const GATE_TO_SHED = [[109.4, 63.9], [97.4, 51.4], [94.8, 48.6], [90.8, 44.7], [80, 47], [68.5, 43.2], [63.5, 42.5], [60.5, 48.7], P_SHED];
const VILLA_N_TO_SHED = [[83.6, 20.9], [84, 29], [88.5, 37], [90.8, 44.7], [80, 47], [68.5, 43.2], [63.5, 42.5], [60.5, 48.7], P_SHED];
/** into the corridor between the yard walls (nobody looks there), and from there through the arch to the shed */
const GATE_TO_CORRIDOR = [[109.4, 63.9], [103.5, 59.5], [100, 55.5], [92, 58], [85, 64], [79.5, 69.5], [77.6, 71.6]];
/** (waiting up the corridor out of the lured man's way), and from the corridor round the villa to its north side */
const CORRIDOR_WAIT = [[85, 64], [92, 57.5]];
/** the corridor's blind south-west end, where e54's body lies */
const HIDE_E54 = [76.6, 72.0], CORRIDOR_MID = [83.5, 65.5];
const CORRIDOR_TO_VILLA_N = [[92, 57.5], [96.5, 51.8], [94.8, 48.6], [90.8, 44.7], [88.5, 37], [84, 29], [83.6, 20.9], [67.5, 20.9]];
const CORRIDOR_TO_SHED = [[85, 64], [92, 57.5], [96.5, 51.8], [94.8, 48.6], [90.8, 44.7], [80, 47], [68.5, 43.2], [63.5, 42.5], [60.5, 48.7], P_SHED];
const BH_TO_GATE = [[138, 123.5], [140, 113.5], [133.5, 99.5], [132, 80], [122, 77], W_GATE];
const CRATE_TO_GATE = [[186, 46], [182, 56], [160, 62], [143.3, 59.1], [132.5, 63.8], [122, 74], W_GATE];
const SHED_TO_BH = [[63.5, 42.5], [68.5, 43.2], [80, 47], [90.8, 44.7], [94.8, 48.6], GATE_OUT, [109.4, 63.9], [115.2, 68.3], [121.7, 70.2], [127.4, 68.4], [132, 80], [133.5, 99.5], ...BH_IN];

/**
 * Where the supply lorry will be `t` s from now: along its round (~8 m/s), standing ~15 s at each stop (the driver's
 * errands at the shack and the villa, the turn at the map edge). null when there is no lorry left.
 */
function truckAt(D, t) {
  const tr = D.world.vehicles.find((v) => v.vehicleType === 'truck' && !v.destroyed && !v.removed);
  if (!tr) return null;
  if (!tr.path) return { x: tr.x, z: tr.z };
  const P = tr.path, n = P.length;
  let x = tr.x, z = tr.z, tt = t, k = tr.pathIndex, wait = tr.waitT > 0 ? tr.waitT : 0;
  for (let i = 0; i < 4 * n; i++) {
    if (wait > 0) { if (tt <= wait) return { x, z }; tt -= wait; wait = 0; }
    const p = P[k % n], L = Math.hypot(p.x - x, p.z - z), dt = L / 8;
    if (tt <= dt) return dt > 0 ? { x: x + ((p.x - x) * tt) / dt, z: z + ((p.z - z) * tt) / dt } : { x, z };
    tt -= dt; x = p.x; z = p.z; wait = p.wait > 0 ? Math.max(p.wait, 15) : 0; k++;
  }
  return { x, z };
}
/**
 * Who would walk into the motorcycle's way (its front sensor box: a man there at speed is run over, slower he steps
 * aside and knows it for ours) driving along `pts` from `from` at ~`speed` m/s: a walker predicted within `r` m of it
 * (± 1.5 s), a man standing still within 2.8 m. The tag, or null. (Guards too far from the whole way to reach it in time are skipped.)
 */
function inTheWay(D, pts, from, speed = 7, r = 4.5, except = [], t0 = 0.4) {
  const way = timed(from, pts, speed, t0);
  // (the supply lorry on its round: never within 8 m of the way, ± 3 s)
  for (let k = 0; k < way.length; k += 4) {
    const [x, z, , t] = way[k];
    for (const o of [-3, -1.5, 0, 1.5, 3]) { const q = truckAt(D, Math.max(0, t + o)); if (q && Math.hypot(q.x - x, q.z - z) < 8) return 'the lorry'; }
  }
  const T = way.at(-1)[3] + 2;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of way) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (const e of viewersOf(D.world)) {
    if (e.vehEye || except.includes(e)) continue;
    const mv = walking(e), m = r + (mv ? 2.8 * T : 0);
    if (e.x < x0 - m || e.x > x1 + m || e.z < z0 - m || e.z > z1 + m) continue;
    for (let k = 0; k < way.length; k += 2) {
      const [x, z, , t] = way[k];
      if (!mv) { if (Math.hypot(e.x - x, e.z - z) < Math.min(r, 2.8)) return e.tag; continue; }
      for (const o of [-1.5, 0, 1.5]) { const q = predict(e, Math.max(0, t + o)); if (Math.hypot(q.x - x, q.z - z) < r) return e.tag; }
    }
  }
  return null;
}
/**
 * The Driver runs `victim` down along `pts` (at full speed in the front box he dies at once, silently; the driver is
 * out of sight), once nobody else would be in the way and nobody would see him fall
 */
async function runOver(D, victim, pts, { maxWait = 300, on = false } = {}) {
  const moto = motoOf(D);
  await waitFor(D, (why) => {
    const tag = inTheWay(D, pts, [moto.x, moto.z], 7, 4.5, [victim]);
    if (tag) { why.push(`${tag}@in the way`); return false; }
    const fall = bodySeen(D, victim.x, victim.z, 5, { except: [victim] });
    if (fall.length) { why.push(`${fall[0]}@sees ${victim.tag} fall`); return false; }
    return true;
  }, maxWait, `the Driver runs ${victim.tag} down`, 0.25);
  // (`on`: he drives the whole way, not stopping where the man fell)
  for (const p of pts) { await drive(D, moto, ...p).catch((e) => { if (victim.alive) throw e; }); if (!victim.alive && !on) break; }
  await D.until(() => !victim.alive, 5, `${victim.tag} run down`);
  await D.until(() => !moto.goal && (moto.speed || 0) < 0.05, 15, 'the motorcycle stops');
}
/** the Driver drives the motorcycle along `pts` once nobody will be in its way */
async function driveRoute(D, pts, { label = 'the motorcycle', maxWait = 300, r = 4.5 } = {}) {
  const moto = motoOf(D);
  await waitFor(D, (why) => {
    const tag = inTheWay(D, pts, [moto.x, moto.z], 7, r);
    if (tag) { why.push(`${tag}@in the way`); return false; }
    return true;
  }, maxWait, `${label}: the way clear`, 0.25);
  for (const p of pts) {
    // (over the main line between two trains, from a stop off it: the train halts at a vehicle on its track, and its
    // hull in the way stops the motorcycle dead)
    const s0 = moto.x + moto.z - 242.6, s1 = p[0] + p[1] - 242.6;
    if (s0 * s1 < 0 || Math.abs(s1) < 5) {
      await waitFor(D, (why) => {
        for (const v of [5, 10]) if (trainHits(D, timed([moto.x, moto.z], [p], v, 0.8), 1.2)) { const tr = trainOf(D); why.push(`train@(${tr.x.toFixed(0)},${tr.z.toFixed(0)}) run ${tr.railRunning} spd ${tr.speed} moto (${moto.x.toFixed(1)},${moto.z.toFixed(1)})->(${p})`); return false; }
        return true;
      }, 120, `${label}: over the line between two trains`, 0.1);
    }
    await drive(D, moto, ...p, { tol: p === P_SHED ? 2 : 4 });
  }
}
/** points round the motorcycle where a man steps off (or on) */
const motoRing = (moto, r = 1.6) => [[moto.x, moto.z], ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => [moto.x + r * Math.cos(k * Math.PI / 4), moto.z + r * Math.sin(k * Math.PI / 4)])];
/**
 * `role` gets off the motorcycle once nobody would see him standing by it (and at `extra`) for `dur` s, or (`then`:
 * timed samples from the moment he is off) along what he does next
 */
async function getOff(D, role, { dur = 2.5, extra = [], then = null, label = '', slack = 0.3 } = {}) {
  const u = D.c(role), moto = motoOf(D);
  // (where he will stand: his seat's side of the hull, as the game puts him there)
  const ex = moto._exitPoint?.(undefined, undefined, false, u, moto.seatOf?.(u));
  const off = ex ? [[ex.x, ex.z], [(ex.x + moto.x) / 2, (ex.z + moto.z) / 2]] : motoRing(moto);
  const spots = [...off, ...extra];
  const samples = then ? [...off.flatMap(([x, z]) => hold(x, z, 0, 0.9, 0.15)), ...then(0.6, ex ? [ex.x, ex.z] : [moto.x, moto.z])] : spots.flatMap(([x, z]) => hold(x, z, 0, dur, 0.25));
  await waitFor(D, (why) => !seenAt(D, samples, { slack, why, pad: 0.3 }), 300, `${role} gets off${label ? ' ' + label : ''}`, 0.2, { turns: true });
  D.ability(role, 'leaveVehicle');
  await D.until(() => !u.vehicle, 5, `${role} off the motorcycle`);
}
/** `role`, lying near the motorcycle, crawls to its side and gets on when nobody would see him stand up there */
async function getOn(D, role) {
  const u = D.c(role), moto = motoOf(D), bp = boardPoint(moto, u);
  if (Math.hypot(u.x - bp.x, u.z - bp.z) > 0.7) await crawlRoute(D, role, [[bp.x, bp.z]], { label: 'to the motorcycle', hold: 2 });
  const bp2 = boardPoint(moto, u);
  // (a walker far off is given a wider margin, in time and in reach: where he will be and look is the least certain)
  const stand = [...hold(u.x, u.z, 0, 3.5), ...hold(bp2.x, bp2.z, 0, 3.5), ...hold(moto.x, moto.z, 0, 3.5)];
  await waitFor(D, (why) => !seenAt(D, stand, { slack: 1.2, why, pad: 0.6 })
    && !viewersOf(D.world).some((e) => e.route?.length > 1 && Math.hypot(e.x - u.x, e.z - u.z) > 26 && seenAt(D, stand, { slack: 2.5, why, pad: 2.5, only: e })), 300, `${role} gets on unseen`, 0.1, { turns: true });
  await board(D, role, moto);
}
/** the Driver rides from wherever he is (`way` to the stop short of the outer gate) on to the shed, the last stretch
 * (gate, arch, the yard) checked again from that stop */
async function toShed(D, way = BH_TO_GATE) {
  await driveRoute(D, way, { label: 'to the outer gate' });
  await driveRoute(D, GATE_TO_SHED, { label: 'to the pier shed' });
}
/** where the three lie by the pier shed's west wall (no one ever sees a man lying there) */
// (all ≥ 1.8 m north of the motorcycle's line into its stop P_SHED: its run-over box, ±1.35 m, kills friends too)
const LIE = { greenberet: [53.6, 46.6], sniper: [55.5, 46.4], diver: [53.7, 46.3] };
/**
 * `role` gets off the motorcycle by the pier shed, gets down at once and crawls to his spot by the shed wall: once
 * nobody would see him standing by the motorcycle (getting off and down) nor crawling there
 */
async function dropAt(D, role, spot = LIE[role], via0 = []) {
  const u = D.c(role), moto = motoOf(D);
  const ex = moto._exitPoint?.(undefined, undefined, false, u, moto.seatOf?.(u)) ?? { x: moto.x, z: moto.z };
  // (round the woodpile's south side from where he steps off: no way point east of him to crawl back for)
  const via = via0.filter(([x]) => x < ex.x + 0.2);
  const e57 = D.get('e57');
  await waitFor(D, (why) => {
    // (the forecourt walker e57 turns on the spot at both ends of his beat, sweeping the shed's corner: only while he
    // walks off north-east, his back to it, with the turn at that end still seconds away)
    if (e57?.alive && !(Math.cos(e57.heading) > 0.3 && Math.sin(e57.heading) < -0.3 && e57.x < 75.6 && !e57.brain?.atWait)) { why.push('e57 not walking off'); return false; }
    if (seenAt(D, hold(ex.x, ex.z, 0, 0.8, 0.1), { slack: 0.2, why, pad: 0.1 })) return false;
    const way = timed([ex.x, ex.z], [...via, spot], 0.8, 0.8), t1 = way.at(-1)[3];
    // (the first stretch, in the near band's edge of the forecourt walker e57, with a wider margin)
    if (seenAt(D, way.filter((q) => Math.hypot(q[0] - ex.x, q[1] - ex.z) < 4), { slack: 0.8, why, pad: 1.3, low: true })) return false;
    return !seenAt(D, [...way, ...hold(spot[0], spot[1], t1, t1 + 30, 0.5)], { slack: 0.4, why, pad: 0.4, low: true });
  }, 400, `${role} gets off by the shed`, 0.2);
  D.ability(role, 'leaveVehicle');
  await D.until(() => !u.vehicle, 5, `${role} off the motorcycle`);
  await D.stance(role, 'crawl');
  for (const p of [...via, spot]) await D.go(role, ...p, { tol: 0.4, max: 40 });
}
const LS_SPOT = { greenberet: [34.2, 76.2], diver: [37.9, 76.1], sniper: [35.6, 76.3], driver: [34.3, 74.9], sapper: [37.9, 74.8] };
/** the motorcycle's way to the villa steps (round the statue's south side), where the Sapper sets the charge, and on */
/** the lorry's stop at the villa, where its driver gets out for his errand to the villa door */
const STOP_B = [87.8, 31.3];
/** s: the Sapper gets on at the bridge head this long before the lorry is due at the villa (getting on, the ride in) */
const SAPPER_LEAD = 60;
/** when the lorry will next stand at its stop by the villa, s from now (Infinity: not within 4 minutes) */
function lorryToVillaIn(D) {
  for (let t = 0; t <= 240; t += 1) { const q = truckAt(D, t); if (q && Math.hypot(q.x - STOP_B[0], q.z - STOP_B[1]) < 2.5) return t; }
  return Infinity;
}
/**
 * Will the lorry driver e49 be at the villa steps on his errand (out of the lorry at its stop by the villa, walking to
 * the door, waiting there 5 s, walking back) within the charge's reach `tB` s from now? (m04 script: world.m04.errand)
 */
function lorryDriverInTheBlast(D, tB, [px, pz]) {
  const e49 = D.get('e49'), S = D.world.m04;
  if (!e49?.alive) return true;
  if (!S?.errand || e49.vehicle) return false;
  for (const dt of [-0.5, 0, 0.5]) { const q = predict(e49, tB + dt); if (Math.hypot(q.x - px, q.z - pz) > 5.5) return false; }
  return true;
}
/**
 * The plant at the villa steps, tried now (`P`: the motorcycle, where the Sapper steps off, where he sets the charge, where
 * the motorcycle waits for the blast): when the Driver can pull away (s from now), or null — the Sapper unseen stepping
 * off, setting it and back on; e53 at the far end of his loop when it goes up; nobody but the lorry driver in its reach,
 * and he at the villa door; the way out clear.
 */
function plantWindow(D, { moto, ex, plantAt, near, waitAt }, why) {
  const e53 = D.get('e53');
  let depart = null;
  const go = near ? [] : timed([ex.x, ex.z], [plantAt], 1.9, 0.3), t1 = near ? 0.4 : go.at(-1)[3], tBlast = t1 + 1.0 + 7.5;
  const back = near ? [] : timed(plantAt, [[ex.x, ex.z]], 1.9, t1 + 1.2), t2 = near ? t1 + 1.2 : back.at(-1)[3];
  // (when it goes up the stair-head walker e53 must be on the far, north-east end of his loop: the siren sends him on
  // north-east, his back to the shed and the men by it)
  const q53 = predict(e53, tBlast), q53b = predict(e53, tBlast + 1.0);
  if (!(q53.x > 60.2 && q53.z < 54.6 && q53b.x > 59.8)) { why.push('e53@not at the far end of his loop then'); return null; }
  if (seenAt(D, [...hold(ex.x, ex.z, 0, 0.4), ...go, ...hold(plantAt[0], plantAt[1], t1, t1 + 1.2), ...back, ...hold(ex.x, ex.z, t2, t2 + 0.7)], { slack: 0.25, why, pad: 0.3 })) return null;
  // (nobody within the blast's reach when it goes up: a man killed by it is a kill seen)
  for (const e of viewersOf(D.world)) {
    for (const dt of [-1.5, 0, 1.5]) { const q = walking(e) ? predict(e, tBlast + dt) : e; if (Math.hypot(q.x - plantAt[0], q.z - plantAt[1]) < 7.3) { why.push(`${e.tag}@too near the charge`); return null; } }
  }
  // (and the lorry driver e49 at the villa door on his errand: he dies in the blast, and the statue guard e58 turns
  // to his body and searches east — away from the pier shed — instead of looking back at the strip by it)
  if (!lorryDriverInTheBlast(D, tBlast, plantAt)) { why.push('e49@not at the villa door then'); return null; }
  // (the way round the villa clear of every walker and of the lorry once he is back on: setting off at once, or a few
  // seconds later — out of the blast's reach in time)
  depart = null;
  // (3 m and more off the forecourt walker's beat: the front box is ±1.35 m)
  const clearIn = 1.2 + legTime([moto.x, moto.z], [waitAt], 8); // (out of the blast's reach)
  // (its front box reaches 5.4 m on past where it stops: nobody within 2.2 m of that either)
  const L = Math.hypot(waitAt[0] - moto.x, waitAt[1] - moto.z), box = [waitAt[0] + ((waitAt[0] - moto.x) * 5.4) / L, waitAt[1] + ((waitAt[1] - moto.z) * 5.4) / L];
  for (let d = 0; t2 + 1.0 + d + clearIn + 0.6 <= tBlast && depart == null; d += 0.5) if (!inTheWay(D, [waitAt, box], [moto.x, moto.z], 7, 2.2, [], t2 + 1.0 + d)) depart = t2 + 1.0 + d;
  if (depart == null) { why.push('e57@in the way out'); return null; }
  return depart;
}
const GATE_TO_STEPS = [[109.4, 63.9], [97.4, 51.4], [94.8, 48.6], [90.8, 44.7], [89.6, 37], [86.5, 35.6], [82.0, 36.6]];
/** the charge goes within 3 m of the steps' marker (mission `villa_steps`, r 3) */
const STEPS_MARK = [80.5, 36.0];
/** off west along the villa's front, out of the blast's reach and short of the forecourt walker's west end, where the
 * motorcycle waits for the blast; then on to the pier shed */
const STEPS_TO_BACK = [[74.4, 36.4]];
const PLANT_AT = [80.2, 34.4];
/** a side task: the Driver rides the motorcycle along `pts` (each ordered when it is within 1.5 m of the last one or has
 * stopped), to a stop at the last; the task's function */
function rideAlong(D, pts) {
  const v = motoOf(D);
  let k = -1, sent = -1, tries = 0;
  return D.meanwhile(() => {
    const p = pts[k];
    const stopped = !v.goal && (v.speed || 0) < 0.05 && D.t > sent + 0.5;
    if (k < 0 || (k < pts.length - 1 && (Math.hypot(v.x - p[0], v.z - p[1]) < 1.5 || stopped))) {
      k++;
      try { D.order('driver', { type: 'move', x: pts[k][0], z: pts[k][1], run: true }); sent = D.t; } catch { k--; }
      return false;
    }
    if (k === pts.length - 1 && stopped && Math.hypot(v.x - p[0], v.z - p[1]) > 2 && tries++ < 4) { try { D.order('driver', { type: 'move', x: p[0], z: p[1], run: true }); sent = D.t; } catch { /* refused: ends here */ } return false; }
    return k === pts.length - 1 && stopped;
  });
}
const objective = (D, id) => D.world.objectives.find((q) => q.id === id)?.done;
/** where the Sapper waits at the bridge head (out of the motorcycle's way) */
const SAPPER_WAIT = [134, 118];
/** where each man lies beyond the bridge head (nobody looks there) */
const NE_SPOTS = { greenberet: [130, 121], diver: [132, 119.5], sniper: [133.5, 121], sapper: [131.5, 122.5], driver: [134, 118] };
/** the deck run for the others: from the bridge's foot to short of the far end, then crawling off the line */
const DECK_DASH = [[97.6, 144.8], [109.5, 133.0], [118.2, 124.2]], DECK_OFF = [[121.6, 120.8], [126.4, 121.4], [128.5, 121.6]];
async function deckDash(D, role, far) {
  const u = D.c(role);
  const plan = (t0) => {
    const up = u.stance === 'stand' ? 0 : 0.7, run = timed([u.x, u.z], DECK_DASH, 4.2, t0 + up), t1 = run.at(-1)[3] + 0.6;
    const crawl = timed(DECK_DASH.at(-1), DECK_OFF, 0.82, t1);
    return { stand: [...hold(u.x, u.z, t0, t0 + up), ...run], crawl };
  };
  await waitFor(D, (why) => {
    const { stand, crawl } = plan(0.1);
    if (trainHits(D, [...stand, ...crawl], 0.8)) { why.push('train'); return false; }
    if (seenAt(D, stand, { slack: 0.5, why, pad: 0.4 })) return false;
    return !seenAt(D, crawl, { slack: 0.5, why, pad: 0.3, low: true });
  }, 600, `${role} runs over the deck`, 0.1);
  await D.stance(role, 'stand');
  for (const [x, z] of DECK_DASH) { D.order(role, { type: 'move', x, z, run: true }); await D.until(() => Math.hypot(u.x - x, u.z - z) < 0.8 || (!u.path && !u.isMoving), 20, `${role} runs`); }
  await D.stance(role, 'crawl');
  for (const [x, z] of [...DECK_OFF, far]) await D.go(role, x, z, { tol: 0.5, max: 30 });
}
/** the Green Beret's run over the deck: from out of the courier's reach at the bridge's foot to the far end */
const GB_DECK_START = [99.6, 150.2], GB_DECK_RUN = [[98, 147], [97.6, 144.8], [109.5, 133], [121.2, 121.2]];
/** where the courier's body goes (on the deck, 4 m from his post: the girders hide whatever lies on it) */
const E26_DECK = [119.8, 121.0];
/**
 * The Green Beret's whole way, `t0` s from now: up and over the deck (gbDeckRun), to the courier's body, the lift, the
 * carry onto the deck, the drop, and off the line to lie down at NE_OFF; `land`: everything after the deck run.
 */
function courierPlan(gb, e26, t0) {
  const run = gbDeckRun(gb, t0), tA = run.at(-1)[3];
  const to = timed(GB_DECK_RUN.at(-1), [[e26.x, e26.z]], 2.2, tA), t1 = to.at(-1)[3];
  const carry = timed([e26.x, e26.z], [E26_DECK], 1.5, t1 + 1.4), t2 = carry.at(-1)[3];
  // (down on the deck beside the body, 0.5 s, and crawling off the line: nobody on the far bank sees a man lying)
  const off = timed(E26_DECK, [NE_OFF], 0.85, t2 + 1.3), t3 = off.at(-1)[3];
  return { run, land: [...to, ...hold(e26.x, e26.z, t1, t1 + 1.4), ...carry, ...hold(E26_DECK[0], E26_DECK[1], t2, t2 + 1.3)], off, tLift: t1 + 1.4, tEnd: t3 };
}
/** timed spots of the Green Beret's run over the deck (up 0.7 s, 5 m/s), `t0` s from now */
function gbDeckRun(u, t0) { return [...hold(u.x, u.z, t0, t0 + 0.7), ...timed([u.x, u.z], GB_DECK_RUN, 5.0, t0 + 0.7)]; }
/** timed spots of the Driver's way over the deck (crawl to DECK_UP, up, run on) from where he lies, `t0` s from now */
function deckRunSamples(u, t0) {
  const tc = t0 + legTime([u.x, u.z], [DECK_IN, DECK_SW, DECK_UP], 0.85);
  return [...timed([u.x, u.z], [DECK_IN, DECK_SW, DECK_UP], 0.85, t0), ...hold(DECK_UP[0], DECK_UP[1], tc, tc + 0.7), ...timed(DECK_UP, [DECK_NE, NE_OFF], 3.8, tc + 0.7)];
}

/**
 * The bridge's foot: e19 on the snowfield, the gunner e20 in his nest and Patrol 19 (five in file) round them. The
 * moment the file's tail turns south-east past the nest (backs to the bridge), the Sniper drops e19, e20 and the file's
 * last two (e25, e24), each unseen by anyone left; the Green Beret and the Marine crawl past the nest onto the snowfield,
 * get up behind the file and take the other three from the back (knife, harpoon) before its head turns west and could
 * look back over the snowfield. Nobody is left who could find a body or follow their tracks in the snow.
 */
async function bridgeheadStrike(D, { onShots = null } = {}) {
  const gb = D.c('greenberet'), mar = D.c('diver');
  const [e19, e20, e21, e22, e23, e24, e25] = ['e19', 'e20', 'e21', 'e22', 'e23', 'e24', 'e25'].map((t) => D.get(t));
  await waitFor(D, (why) => {
    // the whole file past the nest, on its way east / south-east
    if (![e21, e25].every((m) => m.alive && m.x > 101.8 && m.z < 159 && predict(m, 1).x > m.x + 0.3)) { why.push('p9 not past the nest'); return false; }
    // (soon enough to catch the rest before the leader turns at the far corner and looks back: 20 s from the nest)
    if (e25.x > 104.5) { why.push('too late'); return false; }
    if (!snipeOk(D, e19, why)) return false;
    // (and the two at the bridge's foot can be up and away within a few seconds of the gunner's fall)
    if (!bhRunWindow(D, 2.3, 4, why)) return false;
    return true;
  }, 1200, 'Patrol 19 past the nest', 0.1);
  dbg(D, `bridgehead strike: e25 ${e25.x.toFixed(1)},${e25.z.toFixed(1)}`);
  for (const e of [e19, e20]) await snipe(D, e, { maxSec: 3, every: 0.05 });
  // the Green Beret and the Marine up and running over the bridge's foot onto the snowfield, after the file, as soon
  // as the courier at the far end is not looking at the bridge's foot (and no train comes)
  // (two flows of ours step the world in turn here: a live replay ticks them unpaced — driver.mjs `unpaced`)
  D.unpaced = true;
  try {
    const runners = (async () => {
      await waitFor(D, (why) => bhRunWindow(D, 0, 0, why), 5, 'the bridge\'s foot unwatched', 0.05);
      await goTogether(D, [['greenberet', BH_CRAWL0], ['diver', MAR_CRAWL0]]);
      D.order('greenberet', { type: 'stance', stance: 'stand' }); D.order('diver', { type: 'stance', stance: 'stand' });
      await D.wait(0.7);
      await goTogether(D, [['greenberet', BH_RUN], ['diver', MAR_RUN]], { run: true });
    })();
    await snipe(D, e25, { maxSec: 3, every: 0.05 });
    // (the runners are the only flow stepping the world from here: a drawn run may pace its frames again — the film draws none
    // inside an unpaced stretch, so this is where its footage of the strike picks up)
    D.unpaced = false;
    await runners;
  } finally { D.unpaced = false; }
  onShots?.();
  // after the file from behind: the Green Beret knifes, the Marine spears the next one ahead
  const file = [e24, e23, e22, e21];
  const t0 = D.t;
  while (file.some((e) => e.alive)) {
    if (D.t - t0 > 40) throw new Error('the file got away');
    const alive = file.filter((e) => e.alive), tail = alive[0];
    const dG = Math.hypot(tail.x - gb.x, tail.z - gb.z);
    if (!gb.currentAction && !gb.pendingAbility) {
      if (dG < 1.8) { try { D.ability('greenberet', 'knife', tail); } catch { /* next tick */ } }
      else D.order('greenberet', { type: 'move', x: tail.x - Math.cos(tail.heading) * 0.8, z: tail.z - Math.sin(tail.heading) * 0.8, run: dG > 9 });
    }
    // the Marine: the one the Green Beret is not on, within 8.5 m
    const mt = alive.find((e) => e !== tail || alive.length === 1) ?? tail;
    const dM = Math.hypot(mt.x - mar.x, mt.z - mar.z);
    if (!mar.currentAction && !mar.pendingAbility) {
      if (dM < 8.3 && D.t >= (mar._harpoonT ?? -1) && (gb.currentAction || !tail.alive || mt === tail)) { try { D.ability('diver', 'harpoon', mt); } catch { /* next tick */ } }
      else D.order('diver', { type: 'move', x: mt.x - Math.cos(mt.heading) * 6, z: mt.z - Math.sin(mt.heading) * 6, run: dM > 11 });
    }
    await D.wait(0.1);
  }
  await D.idle('greenberet', 4); await D.idle('diver', 4);
  await D.stance('greenberet', 'crawl'); await D.stance('diver', 'crawl');
}

/** Can the Green Beret and the Marine get up and run from the bridge's foot onto the snowfield, setting off at some
 * moment from `a` to `a + span` s from now, unseen (the courier e26 at the far end watches the bridge's foot), clear of
 * the train? */
function bhRunWindow(D, a, span, why) {
  const gb = D.c('greenberet'), mar = D.c('diver'), skip = ['e19', 'e20', 'e25'].map((t) => D.get(t));
  for (let d = a; d <= a + span + 1e-6; d += 0.25) {
    let ok = true;
    for (const u of [gb, mar]) {
      // (crawling over the bridge's foot, out of the courier's reach, then up and running)
      const crawl = timed([u.x, u.z], BH_CRAWL0, 0.82, d), tc = crawl.at(-1)[3] + 0.3, c0 = BH_CRAWL0.at(-1);
      const way = [...hold(c0[0], c0[1], tc, tc + 0.7), ...timed(c0, BH_RUN, 4.4, tc + 0.7)];
      if (seenAt(D, crawl, { slack: 0.4, why, except: skip, low: true, pad: 0.2 }) || seenAt(D, way, { slack: 0.35, why, except: skip, pad: 0.3 }) || trainHits(D, [...crawl, ...way], 1.0)) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/** running from the bridge's foot round the gunner's nest onto the snowfield */
const BH_CRAWL0 = [[94.6, 141.7], [94.45, 143.0]], BH_RUN = [[94.9, 146.4], [96.6, 148.2], [101, 150.5]];
/** (the Marine's own way out of the pocket behind the Green Beret: the wing walls of the bridge's foot leave one gap) */
const MAR_CRAWL0 = [[94.0, 140.8], [93.6, 142.9]], MAR_RUN = [[94.3, 146.8], [95.6, 149.0]];


/** where the Green Beret plants his decoy in the wire gap, and where he lies while e17 comes to it */
const DECOY_AT = [85.4, 131.6], G_WAIT = [90, 138];
/** the decoy `c` has planted (abilities/greenberet.js decoyOf) */
const decoyOf = (D, c) => (c.decoy && !c.decoy.removed ? c.decoy : D.world.interactables.find((d) => d.interactKind === 'decoy' && !d.removed && d.planter === c) || null);
/** a point `d` m behind a man (opposite his heading) */
const behindOf = (e, d) => [+(e.x - Math.cos(e.heading) * d).toFixed(2), +(e.z - Math.sin(e.heading) * d).toFixed(2)];
/** pick up an item lying on the ground (hand) */
async function pickUp(D, role, it) {
  D.ability(role, 'hand', it);
  await D.until(() => it.removed || !D.world.interactables.includes(it), 20, `${role} picks up`);
  await D.idle(role);
}

/**
 * From the rim west of the gap into it, while e17 walks south: crawl to the run's start the moment he has turned
 * south at his north end, then up and run when nobody looks (e10's sweep from across the yard), down in the gap.
 */
async function intoGap(D, role, spot) {
  const e17 = D.get('e17');
  const south = () => !e17.alive || (e17.z < 137.5 && predict(e17, 1).z > e17.z + 0.3);
  await crawlRoute(D, role, [[71.5, 122], [73.5, 124]], { hold: 0, slack: 0.4, pad: 0.4, label: 'to the run', ready: (why) => south() || (why.push('e17 not turned south'), false) });
  await runDash(D, role, [[78, 126.5], [82.5, 129.5], [84.5, 130.5]], { slack: 0.25, pad: 0.25, maxWait: 8, label: 'into the gap' });
  if (Math.hypot(spot[0] - 84.5, spot[1] - 130.5) > 0.5) await D.go(role, spot[0], spot[1], { stance: 'crawl', tol: 0.5 });
}

// ---------------------------------------------------------------- J: after the blast, down to the boat
// (the siren: e53 walks off north-east from the far end of his loop to the blast, his back to the shed; e57 and e58
// search round the villa steps facing away; only the pier guard e56 looks at the strip, the stair head and the stair,
// and the MG crew e55 sweeps his gun's arc over the shed's east side now and then. So: e56 dies first, then each man
// runs down the moment nobody would see or hear him)
/** the motorcycle's way from where it waited for the blast to north-east of the woodpile (clear of the men's way round
 * the shed), and on, once they are past, round the shed's east side to the stair head (the riders get off there, out of
 * the MG crew e55's arc and hearing, hidden from the villa by the shed) */
const MOTO_STAGE = [[66, 38.6], [63.5, 42.5]];
const MOTO_DOWN = [[61.8, 47.0], [61.6, 52.4], [60.6, 56.4], [52.6, 56.4]];
/** the way down from the strip north of the pier shed (the only one): through the slot between the woodpile and the
 * shed, round the shed's east and south sides to the stair head, down the stair and along the pier deck to the ladder
 * (for the look-ahead: each man is given one order, to his spot on the landing stage) */
const WAY_DOWN = [[56.0, 48.2], [58.9, 48.6], [58.8, 53.8], [58.6, 54.6], [55.5, 54.9], [52.5, 55.4], [49.8, 56.8], [44.8, 59.3], [40.8, 63.3], [40.6, 66.2]];
const STAIR_HEAD = [49.8, 56.8];
/** (from the motorcycle by the stair head) */
const RIDERS_DOWN = [STAIR_HEAD, ...WAY_DOWN.slice(7)];
/** (m/s: a little under their running speed) */
const RUN_SPEED = { greenberet: 5.0, driver: 5.0 };
/** `role`'s run along `pts` from (x, z), timed from t0 s (× `slow`): [x, z, 0, t, running] every 0.5 m */
function runTimed(role, [x, z], pts, t0, slow = 1) {
  const out = [[x, z, 0, t0, false]];
  let t = t0;
  for (const p of pts) {
    const sp = (RUN_SPEED[role] ?? 4.2) * slow, l = Math.hypot(p[0] - x, p[1] - z), n = Math.max(1, Math.ceil(l / 0.5));
    for (let k = 1; k <= n; k++) out.push([x + ((p[0] - x) * k) / n, z + ((p[1] - z) * k) / n, 0, t + (l * k) / n / sp, true]);
    t += l / sp; [x, z] = p;
  }
  return out;
}
/** s: a guard's head sweep fades back in over this long once a turn is done (CONFIG.ai.turn.sweepIn) */
const SWEEP_IN = 1.0;
/** viewers seen turning lately (heading changed within the last 0.4 s): tag → { t, dir } (trackTurns) */
const TURNING = new Map();
/** a side task: note who is turning (a man still turning sweeps his cone across everything on his way round) */
function trackTurns(D, until) {
  const prev = new Map();
  return D.meanwhile(() => {
    for (const e of viewersOf(D.world)) {
      const h0 = prev.get(e);
      if (h0 != null) { const dh = Math.atan2(Math.sin(e.heading - h0), Math.cos(e.heading - h0)); if (Math.abs(dh) > 0.004) TURNING.set(e, { t: D.t, dir: Math.sign(dh) }); }
      prev.set(e, e.heading);
    }
    return until();
  });
}
/**
 * After the blast nobody stands at his post any more: the men searching round the villa, the MG crew turned to the
 * blast. Would anyone see a man at the timed spots [x, z, ·, t] — each as he faces now, his head's sweep timed (a post's
 * cone at t: perception.coneAt), a walker where he walks? (sneak.mjs seenAt tries a turned post's own heading too: the
 * search keeps them round for ~20 s.) `low`: crawling.
 */
function seenAfterBlast(D, samples, { low = false, slack = 0.15, why = null, except = [] } = {}) {
  const w = D.world;
  for (const e of viewersOf(w)) {
    if (except.includes(e)) continue;
    const far = (e.vision?.far ?? 36) + 2, mv = walking(e);
    const tg = !mv && e.brain?.turn ? e.brain._turnGoal?.() : null;
    // (a man turning: every heading up to 60 degrees on round his way)
    const tn = !mv && TURNING.get(e), fan = tn && D.t - tn.t < 0.4 ? Array.from({ length: 7 }, (_, k) => e.heading + tn.dir * k * 0.175) : [];
    const hs = [e.heading, ...(tg != null ? [tg] : []), ...fan];
    let me = null; // (his ghosts read him through a mirror, made at the first: ghost.mjs)
    for (const [x, z, , t] of samples) {
      for (const o of [-slack, 0, slack]) {
        const tt = Math.max(0, t + o), q = mv ? predict(e, tt) : e;
        if (Math.hypot(q.x - x, q.z - z) > far) continue;
        const d = { x, z, y: w.groundY?.(x, z) ?? 0, isLow: low, isVisibleToEnemies: true, alive: true, kind: 'commando' };
        const seen = mv ? walkerSees(e, q, d, w, w.time + tt)
          : hs.some((h) => {
            // (his head's sweep fades back in over 1 s after a turn: by then it swings its whole width again)
            const g = ghostOn(me ??= mirrorOf(e)); g.heading = h; if (e.sweepActive) g.sweepW = Math.min(1, (e.sweepW ?? 1) + tt / SWEEP_IN);
            return canSee(g, d, w, { cone: coneAt(g, w.time + tt) }) !== 'none';
          });
        if (seen) { why?.push(`${e.tag}@(${x.toFixed(1)},${z.toFixed(1)})+${tt.toFixed(1)}`); return true; }
      }
    }
  }
  return false;
}
/** would anyone hear a man running at the timed spots (the running ones: [x, z, ·, t, true]) — within his steps' reach */
function heardAfterBlast(D, samples, why = null) {
  const w = D.world;
  for (const e of w.enemies) {
    if (!e.alive || e.removed) continue;
    const mv = walking(e);
    for (const [x, z, , t, run] of samples) {
      if (!run) continue;
      const q = mv ? predict(e, t) : e, r = runNoiseRadius(w, stepSurface(w, x, z)) + 0.5;
      if (Math.hypot(q.x - x, q.z - z) < r) { why?.push(`${e.tag}@hears (${x.toFixed(1)},${z.toFixed(1)})+${t.toFixed(1)}`); return true; }
    }
  }
  return false;
}
/**
 * The way `role` will run from (fx, fz) to `spot` — the path his order will plan, standing (Unit.planFrom on a standing
 * copy of him: nothing about him changes) — up on the plateau, to the stair head; `pts` when there is no plan.
 */
function runWay(D, role, [fx, fz], spot, pts) {
  const u = D.c(role), g = ghost(u); // (through his mirror, never him: ghost.mjs)
  g.stance = 'stand';
  const p = g.planFrom?.(fx, fz, spot[0], spot[1]);
  if (!p?.length) return pts;
  const out = [];
  for (const q of p) { out.push([q.x, q.z]); if (Math.hypot(q.x - STAIR_HEAD[0], q.z - STAIR_HEAD[1]) < 1.5 || (q.x < STAIR_HEAD[0] && q.z > STAIR_HEAD[1] - 1)) break; }
  return out;
}
/** would nobody see or hear `role` get up at (fx, fz) and run the way his order to `spot` takes (`pts` its shape), up on
 * the plateau (slower than planned too: a man running round corners and past his mates loses time) */
function runClear(D, role, spot, pts, why, from = null) {
  const u = D.c(role), f = from ?? [u.x, u.z], way = runWay(D, role, f, spot, pts);
  for (const slow of [1, 0.8]) {
    const s = [...hold(f[0], f[1], 0, 0.7, 0.1), ...runTimed(role, f, way, 0.7, slow)];
    if (seenAfterBlast(D, s, { why }) || heardAfterBlast(D, s, why)) return false;
  }
  return true;
}
/**
 * A side task: `role` gets up and runs down to `spot` on the landing stage (by way of `pts`, then the ladder), once
 * `after()` holds and nobody would see or hear him on the first `plateau` legs of `pts` (up on the plateau; the stair
 * and the pier below lie out of their sight); the task's function.
 */
function runDown(D, role, pts, spot, { plateau = 7, after = () => true, label = '' } = {}) {
  const u = D.c(role);
  let k = -2, nextTry = 0, lastWhy = '';
  return D.meanwhile(() => {
    if (k === -2) {
      if (D.t < nextTry || !after()) return false;
      nextTry = D.t + 0.1;
      const why = [];
      if (!runClear(D, role, spot, pts.slice(0, plateau), why)) { if (why[0] !== lastWhy) dbg(D, `${role} waits${label}: ${why.slice(0, 3).join(' ')}`); lastWhy = why[0]; return false; }
      dbg(D, `${role} goes down${label}`);
      if (u.stance !== 'stand') u.issue({ type: 'stance', stance: 'stand' });
      k = -1;
    }
    // (one order down to his spot on the landing stage: round the shed, down the stair, the pier, the ladder)
    if (k < 0) { try { D.order(role, { type: 'move', x: spot[0], z: spot[1], run: true }); k = 0; } catch { /* next tick */ } return false; }
    // (there he lies down: from the plateau the landing stage lies in the far end of their sight)
    if (Math.hypot(u.x - spot[0], u.z - spot[1]) < 0.6) { if (u.stance !== 'crawl') u.issue({ type: 'stance', stance: 'crawl' }); return true; }
    if (!u.path && !u.isMoving && !u.currentAction && !u._ladder && !u._climb) { try { D.order(role, { type: 'move', x: spot[0], z: spot[1], run: true }); } catch { /* next tick */ } }
    return false;
  });
}
/** after the blast (nobody at his post): the Sniper, lying where he is, kneels and drops `victim` the moment nobody (the
 * victim included) would see him kneel until the shot is off */
async function snipeAfterBlast(D, victim, { maxSec = 12 } = {}) {
  const sn = D.c('sniper');
  await waitFor(D, (why) => {
    if (!victim.alive) return true;
    if (D.world.time < (sn._boltT ?? -1) || sn.currentAction || sn.pendingAbility) { why.push('busy'); return false; }
    if (Math.hypot(victim.x - sn.x, victim.z - sn.z) > 44) { why.push(`${victim.tag}@range`); return false; }
    if (!shotClear(D.world, sn, victim, true)) { why.push(`${victim.tag}@no line`); return false; }
    return !seenAfterBlast(D, hold(sn.x, sn.z, 0, 1.1, 0.05), { why, slack: 0.1 });
  }, maxSec, `the Sniper drops ${victim.tag}`, 0.05);
  if (!victim.alive) return;
  D.ability('sniper', 'sniper', victim);
  await D.until(() => !victim.alive, 4, `${victim.tag} shot`);
  await D.idle('sniper');
}

/** after the blast: the Sniper drops e56 (then `onShot`); all five down the pier stair to the landing stage */
async function downToTheBoat(D, { onShot = null } = {}) {
  const moto = motoOf(D), e56 = D.get('e56');
  if (DBG) { // (who looks where after the blast, and where the men are)
    const t0 = D.t, tags = ['e53', 'e55', 'e57', 'e58', 'e59', 'e13'];
    let next = t0;
    D.meanwhile(() => {
      if (D.t < next) return D.t > t0 + 60;
      next += 0.5;
      dbg(D, 'TRACE ' + tags.map((t) => { const e = D.get(t); return e?.alive ? `${t}(${e.x.toFixed(1)},${e.z.toFixed(1)} h${Math.round(((e.heading * 57.3) % 360 + 360) % 360)} ${e.brain?.state ?? ''})` : `${t}-`; }).join(' ')
        + ` moto(${moto.x.toFixed(1)},${moto.z.toFixed(1)}) ` + D.world.commandos.map((c) => `${c.role.slice(0, 2)}(${c.x.toFixed(1)},${c.z.toFixed(1)}${c._ladder ? 'L' : ''}${c.stance === 'crawl' ? 'c' : ''})`).join(' '));
      return false;
    });
  }
  // the motorcycle off to north-east of the woodpile, out of the way (e53 walks off north-east, his back to it)
  const stage = rideAlong(D, MOTO_STAGE);
  let down = false;
  trackTurns(D, () => down);
  // (the blast turns heads: the first second, nobody moves)
  await D.wait(1.0);
  if (e56?.alive) await snipeAfterBlast(D, e56);
  onShot?.();
  // one after another they run round the shed and down, each when nobody would see him: the MG crew e55 sweeps his
  // gun's arc over the shed's east side now and then; the Green Beret, ready first, goes at once
  const tJ4 = D.t;
  const tasks = ['greenberet', 'diver', 'sniper'].map((r, k) => runDown(D, r, WAY_DOWN, LS_SPOT[r], { after: () => D.t > tJ4 + 0.5 * k }));
  await D.until(() => !D.pending(stage), 20, 'the motorcycle by the woodpile');
  // once the three are past the shed's south side, the Driver rides on round the shed to the stair head
  const past = (r) => { const u = D.c(r); return !u.alive || u.x < 52.2 || u.z > 58.5; };
  await D.until(() => ['greenberet', 'diver', 'sniper'].every(past), 40, 'the three past the shed');
  await waitFor(D, (why) => { const tag = inTheWay(D, MOTO_DOWN, [moto.x, moto.z], 7, 4.5); if (tag) why.push(`${tag}@in the way`); return !tag; }, 20, 'the way to the stair head clear', 0.1);
  const ride = rideAlong(D, MOTO_DOWN);
  await D.until(() => !D.pending(ride), 20, 'the motorcycle at the stair head');
  // the Driver and the Sapper off together, unseen, and down the stair
  const exits = ['driver', 'sapper'].map((r) => { const u = D.c(r); return moto._exitPoint?.(undefined, undefined, false, u, moto.seatOf?.(u)) ?? { x: moto.x, z: moto.z }; });
  await waitFor(D, (why) => ['driver', 'sapper'].every((r, k) => !seenAfterBlast(D, hold(exits[k].x, exits[k].z, 0, 1.0, 0.1), { why })
    && runClear(D, r, LS_SPOT[r], RIDERS_DOWN.slice(0, 2), why, [exits[k].x, exits[k].z])), 30, 'the riders get off by the stair head', 0.1);
  for (const r of ['driver', 'sapper']) D.ability(r, 'leaveVehicle');
  await D.until(() => !D.c('driver').vehicle && !D.c('sapper').vehicle, 5, 'the riders off the motorcycle');
  for (const r of ['driver', 'sapper']) tasks.push(runDown(D, r, RIDERS_DOWN, LS_SPOT[r], { plateau: 2 }));
  await D.until(() => tasks.every((f) => !D.pending(f)), 60, 'everyone down the pier stair');
  down = true;
}

/** all aboard at once while e13 across the water looks away from the boat (the boat hides the landing stage from him,
 * not the men on its deck): they stand up first, hidden from him by the hull (nobody up on the plateau looking), and
 * step aboard in one of his sweep's gaps (about a second) */
async function allAboard(D) {
  const boat = D.world.vehicles.find((v) => v.vehicleType === 'patrolboat');
  const ROLES = ['greenberet', 'sniper', 'diver', 'driver', 'sapper'];
  const standing = (t1) => ROLES.flatMap((r) => { const u = D.c(r); return hold(u.x, u.z, 0, t1, 0.15); });
  const boatSeen = (why, t0, t1) => {
    const d = { x: boat.x, z: boat.z, y: 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando', state: 'inVehicle', vehicle: boat };
    for (const e of viewersOf(D.world)) {
      if (Math.hypot(e.x - boat.x, e.z - boat.z) > (e.vision?.far ?? 36) + 6) continue;
      for (let t = t0; t <= t1 + 1e-6; t += 0.05) {
        const q = walking(e) ? predict(e, t) : e;
        if (walking(e) ? walkerSees(e, q, d, D.world, D.world.time + t) : staticSees(e, d, D.world, t)) { why.push(`${e.tag}@sees the boat +${t.toFixed(1)}`); return true; }
      }
    }
    return false;
  };
  // (on their feet by the hull: nobody up on the plateau would see them for the next few seconds)
  await waitFor(D, (why) => !seenAfterBlast(D, standing(4), { why }), 60, 'nobody on the plateau looking at the landing stage', 0.1);
  for (const r of ROLES) if (D.c(r).stance !== 'stand') D.c(r).issue({ type: 'stance', stance: 'stand' });
  await D.wait(0.8); // (getting up takes 0.6 s)
  await waitFor(D, (why) => !boatSeen(why, 0, 1.3) && !seenAfterBlast(D, standing(1.3), { why }), 20, 'e13 across the water looking away from the boat', 0.05);
  for (const r of ROLES) D.ability(r, 'enterVehicle', boat);
  await D.until(() => D.world.commandos.every((c) => c.vehicle === boat), 5, 'everyone aboard');
}

export const STAGES = [
  ['A', 'The yard south: e2, e1, e3', async (D) => {
    D.checkpoint('A0 the team lies in the start grove');
    const e1 = D.get('e1'), e2 = D.get('e2'), e3 = D.get('e3');
    // the Marine and the Green Beret crawl to the rubble's south-west corner: the ruined house hides it from e4 and e5,
    // e2's sweep never reaches round the rubble, and only e3, at the west end of his round, ever looks there
    await crawlTogether(D, [['diver', [[9, 156.5], [15.5, 148.4], MAR_SW]], ['greenberet', [[7.5, 157.6], [13.8, 150.2], GB_SW]]], { label: 'to the rubble' });
    D.checkpoint('A1 the Marine and the Green Beret at the rubble\'s corner');
    // with e3 walking away down the yard's west side, the Marine gets up and harpoons e2 from 8 m: silent
    await harpoonShot(D, e2, { stashFor: 30 });
    D.checkpoint('A2 e2 harpooned');
    // e1 looks south over the yard, his back to the house: the Green Beret gets up and walks straight up behind him
    // (walking is silent) and knifes him
    await strike(D, e1, { walker: true, maxT: 14, stashFor: 12, pad: 0.2 });
    D.checkpoint('A3 e1 knifed');
    // and on after e3, who walks east along the bottom of the yard with his back to them: knifed from behind. Nobody
    // else ever looks at the yard's south, where the three bodies lie
    await strike(D, e3, { walker: true, maxT: 24, stashFor: 300 });
    await D.stance('greenberet', 'crawl');
    D.checkpoint('A4 e3 knifed: the yard south is clear');
  }],
  ['B', 'The wire gap: e17', async (D) => {
    // the Green Beret through the yard (nobody looks there any more) to the gorge rim west of the wire's only gap
    await crawlRoute(D, 'greenberet', [...YARD, [65, 124], [67.5, 121.8], [68.8, 119.8]], { label: 'the yard' });
    D.checkpoint('B1 the Green Beret on the gorge rim');
    // e17 walks up and down beyond the wire and halts at its north end looking over the gap: while he walks south
    // the Green Beret runs along the rim into the gap (too far to crawl before he turns back, too far for anyone to hear)
    await intoGap(D, 'greenberet', GAP_SPOTS.greenberet);
    D.checkpoint('B2 the Green Beret in the wire gap');
    // in the gap he plants his decoy, crawls off along the rim and switches it on when e17 halts at the north end:
    // e17 walks over and stares at it, his back to the rocks; the Green Beret creeps round behind him and knifes him
    const gb = D.c('greenberet'), e17 = D.get('e17');
    await D.go('greenberet', DECOY_AT[0], DECOY_AT[1], { stance: 'crawl', tol: 0.4 });
    await D.face('greenberet', DECOY_AT[0] + 1, DECOY_AT[1]);
    D.ability('greenberet', 'decoyDrop');
    await D.until(() => !!decoyOf(D, gb), 5, 'decoy planted');
    await D.idle('greenberet');
    await crawlRoute(D, 'greenberet', [[87, 133.6], G_WAIT], { hold: 3, label: 'off the decoy' });
    D.checkpoint('B3 the decoy planted in the gap');
    await D.until(() => e17.brain?.atWait && e17.z < 136.5, 120, 'e17 halts at the north end');
    D.ability('greenberet', 'decoyToggle');
    await D.until(() => e17.brain?.state === 'DECOY' && e17.brain?.phase === 'stare', 30, 'e17 stares at the decoy');
    D.checkpoint('B4 e17 stares at the decoy');
    dbg(D, `e17 stares from (${e17.x.toFixed(2)},${e17.z.toFixed(2)}) h${(e17.heading * 180 / Math.PI).toFixed(0)}; behind ${behindOf(e17, 1.6)}`);
    await crawlRoute(D, 'greenberet', [[87, 133.5], [85.6, 133.4], behindOf(e17, 1.6)], { hold: 1, label: 'behind e17' });
    await strike(D, e17, { stashFor: 300 });
    D.checkpoint('B5 e17 knifed at the decoy');
    D.ability('greenberet', 'decoyToggle');
    await D.until(() => !decoyOf(D, gb)?.on, 3, 'decoy off');
    await pickUp(D, 'greenberet', decoyOf(D, gb));
    await D.stance('greenberet', 'crawl');
    D.checkpoint('B6 the Green Beret has his decoy back');
  }],
  ['C', 'The centre grove: e12', async (D) => {
    // e12 watches the wire from the centre grove's east edge, and e19 (across the wire) watches him: while the train
    // runs past between them, the Green Beret, back through the gap, knifes e12 from behind and lays him in the trees
    const e12 = D.get('e12'), e19 = D.get('e19');
    await crawlRoute(D, 'greenberet', [[80, 131.5], [76, 131.5], [70, 131], [66, 132.6], E12_STAGE], { label: 'to e12' });
    await strike(D, e12, { hide: E12_HIDE, stashFor: 300, shield: (e, x, z, t) => e === e19 && trainShields(D, e, x, z, t) });
    D.checkpoint('C1 e12 knifed in the centre grove');
    await crawlRoute(D, 'greenberet', [[66, 132.6], [70, 131], [76, 131.5], [80, 131.5]], { label: 'back to the gap' });
  }],
  ['D', 'Over the railway bridge', async (D) => {
    // the others follow through the yard and the gap (nobody looks there now), each to his place along the rim
    for (const r of ['sniper', 'driver', 'diver', 'sapper']) {
      // (the Marine from the rubble's corner, the others from the start grove)
      await crawlRoute(D, r, r === 'diver' ? [[24, 152.5], [30, 152]] : [[8, 160], [14, 153.5], [24, 152.5], [30, 152]], { label: 'the yard' });
      await crawlRoute(D, r, YARD, { label: 'the yard' });
      await crawlRoute(D, r, BAND, { label: 'the gap' });
      await crawlRoute(D, r, [...(RIM_SPOTS[r].via || []), RIM_SPOTS[r].at], { label: 'the rim', pad: 0.3 });
    }
    await crawlRoute(D, 'greenberet', [[86, 133.4], ...RIM_SPOTS.greenberet.via, RIM_SPOTS.greenberet.at], { label: 'along the rim', pad: 0.3 });
    D.checkpoint('D1 the team along the gorge rim by the bridge');
    // the bridge gunner e20 looks down the deck and e19 over the bridge's foot; Patrol 19 walks its round past both.
    // As the file turns east past the nest (backs to it), the Sniper drops e20 and e19; the Green Beret runs over,
    // carries e19 into the sandbag ring and lays both bodies where its walls hide them from the snowfield
    await crawlRoute(D, 'sniper', [SNIPE_E19], { hold: 2, label: 'to his rest', tol: 0.2 });
    await bridgeheadStrike(D, { onShots: () => D.checkpoint('D2a the Sniper drops e19, the gunner e20 and the file\'s last man') });
    D.checkpoint('D2 the bridge\'s foot is clear: Patrol 19, e19 and the gunner e20 down');
    // the Green Beret back to the bridge's foot (nobody left to read his tracks in the snow), out of the courier's reach
    const gb = D.c('greenberet'), e26 = D.get('e26');
    await D.stance('greenberet', 'stand');
    for (const p of [[110, 158], [104, 153], GB_DECK_START]) await D.go('greenberet', p[0], p[1], { tol: 0.6, max: 40 });
    await D.stance('greenberet', 'crawl');
    // the courier e26 at the far end looks along the deck: the Sniper drops him (his last round) the moment the Green
    // Beret can run over behind the train, and before anyone on the far bank looks at the body
    await crawlRoute(D, 'sniper', [SNIPE_E26], { hold: 2, label: 'to his rest', tol: 0.3 });
    // (the whole of it planned at the shot: over the deck clear of the train, the body onto the deck and himself off
    // the line, unseen standing by the far bank's patrols, and the body unseen until he has it)
    let goAt = null;
    const courierOk = (why) => {
      let go = null;
      for (let t0 = 1.2; t0 <= 6 && go == null; t0 += 0.2) { const p = courierPlan(gb, e26, t0); if (!trainHits(D, [...p.run, ...p.land, ...p.off], 0.8)) go = t0; }
      if (go == null) { why.push('train'); return false; }
      const p = courierPlan(gb, e26, go);
      if (seenAt(D, p.run, { slack: 0.4, why, except: [e26], pad: 0.3 })) return false;
      if (seenAt(D, p.land, { slack: 0.6, why, except: [e26], pad: 0.4 })) return false;
      if (seenAt(D, p.off, { slack: 0.6, why, except: [e26], pad: 0.3, low: true })) return false;
      if (bodySeen(D, e26.x, e26.z, p.tLift + 1.0, { except: [e26] }).length) { why.push('e26 body seen'); return false; }
      goAt = D.t + go;
      return true;
    };
    await snipe(D, e26, { extra: (why) => courierOk(why) });
    D.checkpoint('D3 the Sniper drops the courier e26');
    // (he sets off on the moment planned at the shot)
    if (goAt > D.t + D.dt) await D.wait(goAt - D.t);
    await D.stance('greenberet', 'stand');
    for (const p of GB_DECK_RUN) { D.order('greenberet', { type: 'move', x: p[0], z: p[1], run: true }); await D.until(() => Math.hypot(gb.x - p[0], gb.z - p[1]) < 0.8 || (!gb.path && !gb.isMoving), 20, 'GB runs over'); }
    D.checkpoint('D4 the Green Beret runs over the bridge');
    // the courier's body onto the deck (the girders hide anything lying on it), then off the line and down
    await carryTo(D, 'greenberet', e26, E26_DECK);
    await D.stance('greenberet', 'crawl');
    await D.go('greenberet', ...NE_OFF, { tol: 0.6, max: 20 });
    D.checkpoint('D5 the courier hidden on the deck');
  }],
  ['E', 'Over the bridge', async (D) => {
    // nobody watches the bridge's foot or the deck any more: the others walk over it one by one between two trains
    // and lie down beyond the bridge head, out of everyone's sight
    for (const r of ['diver', 'sniper', 'sapper', 'driver']) {
      const u = D.c(r), far = NE_SPOTS[r];
      const toFoot = r === 'diver' ? [[110, 158], [104, 153], [99.6, 150.2]] : [[89, 135.4], [92.5, 137.2], [95.6, 140.6]];
      await walkRoute(D, r, toFoot, { label: 'to the bridge' });
      // (running over the deck between two trains, down short of its far end, crawling off the line out of sight)
      await deckDash(D, r, far);
    }
    // (the Green Beret, lying by the courier's post, crawls round the bridge head off the line too)
    await crawlRoute(D, 'greenberet', [[121.8, 118.6], [124.8, 119.4], [126.4, 121.4], NE_SPOTS.greenberet], { label: 'off the bridge head', train: true });
    D.checkpoint('E1 the team over the bridge');
  }],
  ['F', 'The courier\'s motorcycle', async (D) => {
    // the courier's motorcycle stands at the bridge head: the Driver and the Sapper walk to it between two trains (no
    // one looks there now) and get on; nobody sees a man riding it, and nobody saw them get on: it is just a motorcycle
    const moto = motoOf(D);
    for (const r of ['driver', 'sapper']) {
      const u = D.c(r), bp = boardPoint(moto, u);
      await crawlRoute(D, r, [[bp.x, bp.z]], { label: 'to the motorcycle', train: 12, hold: 2 });
      await waitFor(D, (why) => {
        if (trainHits(D, hold(u.x, u.z, 0, 3), 0.8)) { why.push('train'); return false; }
        const stand = [...hold(u.x, u.z, 0, 3.5), ...hold(moto.x, moto.z, 0, 3.5)];
        return !seenAt(D, stand, { slack: 0.8, why, pad: 0.6 })
          && !viewersOf(D.world).some((e) => e.route?.length > 1 && Math.hypot(e.x - u.x, e.z - u.z) > 22 && seenAt(D, stand, { slack: 2.5, why, pad: 2.5, only: e }));
      }, 300, `${r} gets on unseen`, 0.1, { turns: true });
      await board(D, r, moto);
    }
    D.checkpoint('F1 the Driver and the Sapper on the courier\'s motorcycle');
  }],
  ['G', 'The air-drop', async (D) => {
    // the Driver rides round the gun pit and the forests to the air-drop crate (nobody sees who rides it; he keeps
    // out of everyone's way); the Sapper gets off when nobody looks there, takes the charge and gets back on
    const moto = motoOf(D), sp = D.c('sapper'), crate = crateOf(D);
    for (const p of TO_CRATE) await drive(D, moto, ...p);
    // (he steps off on the forest side, 2 m from the crate: in sight of nobody but the forest patrol and e42, now and then)
    const spots = [[moto.x - 1.4, moto.z + 0.2], [crate.x, crate.z + 1.2], [crate.x + 0.6, crate.z + 1.0]];
    await waitFor(D, (why) => !seenAt(D, spots.flatMap(([x, z]) => hold(x, z, 0, 9, 0.25)), { slack: 0.5, why, pad: 0.3 }), 600, 'the crate unwatched', 0.2);
    D.ability('sapper', 'leaveVehicle');
    await D.until(() => !sp.vehicle, 5, 'the Sapper off');
    D.ability('sapper', 'hand', crate);
    await D.until(() => (sp.inventory?.get?.('timeBomb') ?? 0) > 0, 15, 'the Sapper has the charge');
    await board(D, 'sapper', moto);
    D.checkpoint('G1 the Sapper takes the charge from the air-drop');
  }],
  ['H', 'The decoy', async (D) => {
    // back at the bridge head the Sapper gets off and lies down where he lay; the Green Beret gets on
    const moto = motoOf(D), gb = D.c('greenberet'), e54 = D.get('e54'), e59 = D.get('e59');
    await driveRoute(D, CRATE_TO_BH, { label: 'back to the bridge head' });
    await getOff(D, 'sapper', { label: 'at the bridge head' });
    await crawlRoute(D, 'sapper', [SAPPER_WAIT], { label: 'to the Driver\'s old spot', hold: 2 });
    await getOn(D, 'greenberet');
    D.checkpoint('H1 the Sapper waits at the bridge head; the Green Beret gets on');
    // through the outer gate into the corridor between the walls (nobody looks there): the Green Beret gets off,
    // plants his decoy against the yard wall, 11 m behind the gunner's mate e54 at the cliff edge, and gets back on
    await driveRoute(D, BH_TO_GATE, { label: 'to the outer gate' });
    await driveRoute(D, GATE_TO_CORRIDOR, { label: 'into the corridor' });
    await getOff(D, 'greenberet', { dur: 4, label: 'in the corridor' });
    await D.stance('greenberet', 'stand');
    D.ability('greenberet', 'decoyDrop');
    await D.until(() => !!decoyOf(D, gb), 5, 'decoy planted');
    await D.idle('greenberet');
    await board(D, 'greenberet', moto);
    D.checkpoint('H2 the Green Beret plants his decoy in the corridor behind the yard wall');
    // back up the corridor towards the gate; the decoy on: e54 leaves his post, walks round through the arch and
    // stares at it; the Driver runs him down there, in the corridor, where nobody ever looks
    await driveRoute(D, CORRIDOR_WAIT, { label: 'up the corridor' });
    D.ability('greenberet', 'decoyToggle');
    await D.until(() => e54.brain?.state === 'DECOY' && e54.brain?.phase === 'stare', 90, 'e54 stares at the decoy');
    D.checkpoint('H3 the decoy on: e54 leaves the cliff edge for it');
    // (through him and on, bending south into the corridor's blind end: Patrol 7 looks down the corridor from its far
    // end, and down there it is out of its reach)
    await runOver(D, e54, [[e54.x + 6.4, e54.z - 6.4], [e54.x, e54.z], [e54.x - 1.0, e54.z + 4.0]], { on: true });
    D.checkpoint('H4 the Driver runs e54 down in the corridor');
    // the Green Beret switches the decoy off, gets off in the corridor's blind end and takes the decoy back (e54 lies
    // where he fell, beyond Patrol 7's reach; laid at the blind end too if anyone else could see him there)
    D.ability('greenberet', 'decoyToggle');
    {
      const dec = decoyOf(D, gb), ex = moto._exitPoint?.(undefined, undefined, false, gb, moto.seatOf?.(gb)) ?? { x: moto.x, z: moto.z };
      const dk = dec ? [dec.x, dec.z] : [ex.x, ex.z];
      const way = (t0) => {
        const w1 = timed([ex.x, ex.z], [dk], 2.2, t0 + 1.0), t1 = w1.at(-1)[3];
        const w2 = timed(dk, [[moto.x, moto.z]], 2.2, t1 + 1.2), t2 = w2.at(-1)[3];
        return [...hold(ex.x, ex.z, t0, t0 + 1.0), ...w1, ...hold(dk[0], dk[1], t1, t1 + 1.2), ...w2, ...hold(moto.x, moto.z, t2, t2 + 1.5)];
      };
      // (a patrol far off is given a wider margin, in time and in reach: where it will be and look is the least certain)
      await waitFor(D, (why) => !seenAt(D, way(0.2), { slack: 1.0, why, pad: 0.5 })
        && !viewersOf(D.world).some((e) => e.route?.length > 1 && Math.hypot(e.x - moto.x, e.z - moto.z) > 26 && seenAt(D, way(0.2), { slack: 2.5, why, pad: 1.5, only: e })), 300, 'nobody looking down the corridor', 0.2);
    }
    D.ability('greenberet', 'leaveVehicle');
    await D.until(() => !gb.vehicle, 5, 'greenberet off the motorcycle');
    await D.stance('greenberet', 'stand');
    if (bodySeen(D, e54.x, e54.z, 400, { except: [e54] }).length) await carryTo(D, 'greenberet', e54, HIDE_E54);
    await pickUp(D, 'greenberet', decoyOf(D, gb));
    await board(D, 'greenberet', moto);
    D.checkpoint('H5 the Green Beret takes his decoy back');
    // out of the corridor, through the arch and round the villa to its north side (the villa hides it from the yard):
    // he plants the decoy 12 m behind the lawn guard e59 and switches it on: e59 stares at the villa's back wall
    await driveRoute(D, CORRIDOR_TO_VILLA_N, { label: 'round the villa' });
    await getOff(D, 'greenberet', { dur: 5, slack: 0.8, label: 'behind the villa' });
    await D.stance('greenberet', 'stand');
    D.ability('greenberet', 'decoyDrop');
    await D.until(() => !!decoyOf(D, gb), 5, 'decoy planted');
    await D.idle('greenberet');
    await board(D, 'greenberet', moto);
    await driveRoute(D, VILLA_N_TO_SHED, { label: 'to the pier shed' });
    D.ability('greenberet', 'decoyToggle');
    await D.until(() => e59.brain?.noiseTurnT > 0 || e59.brain?.state === 'DECOY', 20, 'e59 turns to the decoy');
    await D.wait(1.5);
    D.checkpoint('H6 the decoy behind the villa: e59 turns his back on the pier shed');
  }],
  ['I', 'By the pier shed', async (D) => {
    // the Green Beret gets off north of the pier shed when nobody looks there and lies by the cliff edge (nobody ever sees
    // a man lying there); then the Driver fetches the Sniper (by way of the air-drop for three rounds) and the Marine, who
    // lie down there too, and last the Sapper
    const moto = motoOf(D), sn = D.c('sniper'), crate = crateOf(D);
    await dropAt(D, 'greenberet');
    D.checkpoint('I1 the Green Beret lies by the pier shed');
    await driveRoute(D, SHED_TO_BH, { label: 'back to the bridge head' });
    await getOn(D, 'sniper');
    await driveRoute(D, BH_TO_CRATE, { label: 'to the air-drop' });
    const rounds = sn.inventory?.get?.('sniperRifle') ?? 0;
    await getOff(D, 'sniper', { dur: 9, extra: [[crate.x, crate.z + 1.2], [crate.x + 0.6, crate.z + 1.0]], label: 'at the air-drop' });
    D.ability('sniper', 'hand', crate);
    await D.until(() => (sn.inventory?.get?.('sniperRifle') ?? 0) > rounds, 15, 'the Sniper has his rounds');
    await board(D, 'sniper', moto);
    D.checkpoint('I2 the Sniper takes three rounds from the air-drop');
    await toShed(D, CRATE_TO_GATE);
    await dropAt(D, 'sniper');
    D.checkpoint('I3 the Sniper lies by the pier shed');
    await driveRoute(D, SHED_TO_BH, { label: 'back to the bridge head' });
    await getOn(D, 'diver');
    await toShed(D);
    await dropAt(D, 'diver');
    D.checkpoint('I4 the Marine lies by the pier shed');
    // the Driver rides back by way of the air-drop for his own machine pistol; then he fetches the Sapper from the
    // bridge head in time for the lorry's next round in to the villa (its driver's errand at the villa door is when the
    // charge must go up: see stage J)
    const drv = D.c('driver'), bursts = drv.inventory?.get?.('smg') ?? 0;
    await driveRoute(D, SHED_TO_BH, { label: 'back to the bridge head' });
    await driveRoute(D, BH_TO_CRATE, { label: 'to the air-drop' });
    await getOff(D, 'driver', { dur: 9, extra: [[crate.x, crate.z + 1.2], [crate.x + 0.6, crate.z + 1.0]], label: 'at the air-drop' });
    D.ability('driver', 'hand', crate);
    await D.until(() => (drv.inventory?.get?.('smg') ?? 0) > bursts, 15, 'the Driver has his machine pistol');
    await board(D, 'driver', moto);
    D.checkpoint('I5 the Driver takes his machine pistol from the air-drop');
    await driveRoute(D, CRATE_TO_BH, { label: 'back to the bridge head' });
    await waitFor(D, (why) => { const t = lorryToVillaIn(D); if (t > SAPPER_LEAD) why.push(`lorry@at the villa in ${t.toFixed(0)} s`); return t <= SAPPER_LEAD; }, 300, 'the lorry due at the villa', 0.5);
    await getOn(D, 'sapper');
    D.checkpoint('I6 the Sapper back on the motorcycle');
  }],
  ['J', 'The headquarters', async (D) => {
    // the Driver rides the Sapper through the gate and the arch, round the statue to the foot of the villa steps
    const moto = motoOf(D), sp = D.c('sapper'), sn = D.c('sniper');
    const e53 = D.get('e53'), e55 = D.get('e55'), e56 = D.get('e56');
    await driveRoute(D, BH_TO_GATE, { label: 'to the outer gate' });
    await driveRoute(D, GATE_TO_STEPS.slice(0, -1), { label: 'to the villa steps' });
    await drive(D, moto, ...GATE_TO_STEPS.at(-1), { tol: 1.6 });
    D.checkpoint('J1 the motorcycle at the villa steps');
    // he steps off by the steps (within the charge's reach of them), sets the charge (a 7.5 s fuse) where he stands and is
    // back on at once, and the Driver pulls away west along the villa's front, round to the back of it
    const ex = moto._exitPoint?.(undefined, undefined, false, sp, moto.seatOf?.(sp)) ?? { x: moto.x, z: moto.z };
    // (where he sets it: the nearest point to where he steps off within 2.6 m of the steps' mark and out of the blast's
    // reach of the statue guard e58 — a man the blast kills is a kill seen)
    const e58 = D.get('e58');
    let plantAt = null;
    for (let r = 0; r <= 2.6 + 1e-6 && !plantAt; r += 0.2) {
      for (let a = 0; a < 32 && !plantAt; a++) {
        const p = [ex.x + r * Math.cos((a * Math.PI) / 16), ex.z + r * Math.sin((a * Math.PI) / 16)];
        if (Math.hypot(p[0] - STEPS_MARK[0], p[1] - STEPS_MARK[1]) <= 2.6 && (!e58?.alive || Math.hypot(p[0] - e58.x, p[1] - e58.z) >= 7.5) && D.world.grid.walkableAt(...p)) plantAt = p;
      }
    }
    if (!plantAt) plantAt = PLANT_AT;
    const near = Math.hypot(plantAt[0] - ex.x, plantAt[1] - ex.z) < 0.3;
    // (where it waits for the blast: west along the villa's front out of the charge's reach, a straight run from here)
    const WAIT_SPOTS = [[74.4, 36.4], [73.8, 37.2], [74.6, 38.4], [75.4, 39.4], [73.4, 35.6]];
    const waitAt = WAIT_SPOTS.find(([x, z]) => Math.hypot(x - plantAt[0], z - plantAt[1]) >= 7.3 && moto.canDriveTo(x, z)
      && moto.straightReach(x, z) >= Math.hypot(x - moto.x, z - moto.z) - 0.3) ?? STEPS_TO_BACK[0];
    dbg(D, `steps: waits for the blast at (${waitAt})`);
    dbg(D, `steps: moto (${moto.x.toFixed(1)},${moto.z.toFixed(1)}) exit (${ex.x.toFixed(1)},${ex.z.toFixed(1)}) plants at (${plantAt[0].toFixed(1)},${plantAt[1].toFixed(1)})`);
    let depart = null;
    await waitFor(D, (why) => (depart = plantWindow(D, { moto, ex, plantAt, near, waitAt }, why)) != null, 600, 'the Sapper at the villa steps unseen', 0.1, { turns: true });
    depart += D.t;
    D.ability('sapper', 'leaveVehicle');
    await D.until(() => !sp.vehicle, 3, 'the Sapper off');
    if (!near) await D.go('sapper', ...plantAt, { tol: 0.3, max: 8 });
    D.ability('sapper', 'timeBomb');
    await D.until(() => (sp.inventory.get('timeBomb') ?? 0) === 0 && !sp.currentAction, 5, 'the charge set');
    await board(D, 'sapper', moto);
    D.checkpoint('J2 the Sapper sets the charge on the villa steps');
    if (depart > D.t) await D.wait(depart - D.t);
    await drive(D, moto, ...waitAt, { tol: 2.0 }); // (handed over within 1.5 m: it rolls on to the point and stops there)
    await D.until(() => objective(D, 'o1'), 20, 'the villa blown');
    D.checkpoint('J3 the headquarters goes up');
    // the siren: e53 walks off north-east to the blast, every eye on the villa: the Sniper drops the pier guard e56 and
    // everybody runs down the pier stair to the landing stage, the Driver and the Sapper by way of the motorcycle
    await downToTheBoat(D, { onShot: () => D.checkpoint('J4 the Sniper drops the pier guard e56') });
    D.checkpoint('J5 everyone on the landing stage by the patrol boat');
    await allAboard(D);
    D.checkpoint('J6 everyone aboard the patrol boat');
    // away it goes: the escape drive-off skipped (ESC, §7.6) — or, where nothing can press it, sailed to the end (~16 s)
    await D.until(() => D.skipEscape() || objective(D, 'o3'), 25, 'the boat away');
    await D.until(() => objective(D, 'o3'), 2, 'the escape done');
  }],
];

export async function solve(D, ctx = {}) {
  // (the user's "longer trajectories rather than zig-zagging in small trajectories": every leg here is a hand-placed
  // straight click — crawlRoute / D.go / one run order — so the planner's straight dashes (dash.mjs) change nothing;
  // opted in for any sneak() leg to come; tools/solutions/trail.mjs m04 measures it)
  D.straightDashes = true;
  D.world.sneakStillStatic = true; // (sneak.mjs walking: a post back on his spot with a stale path is a post)
  D.world.sneakLures = true; // (sneak.mjs postHeadings: a post held round by a pulsing decoy keeps facing it)
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}
/** (development probes: tools/solutions/.m04p) */
export const _dev = { downToTheBoat, allAboard, plantWindow, seenAtX: (...a) => seenAt(...a), inTheWayX: (...a) => inTheWay(...a), STEPS_TO_BACK, STEPS_MARK, seenAt, hold, shedDoor, motoOf, driveRoute, inTheWay, truckAt, CRATE_TO_GATE, GATE_TO_SHED, CORRIDOR_TO_SHED, SHED_TO_BH, BH_TO_GATE, crateOf, drive, TO_CRATE, trainHits, deckRunSamples, timed, hold, trainShields, trainCentreAt };
