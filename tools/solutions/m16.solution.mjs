/**
 * M16 "Stop Wildfire" (the Maas bridge), played only with player orders. Driver API: tools/solutions/driver.mjs;
 * sneaking helpers: tools/solutions/sneak.mjs. Reference run, in the real game: node tools/solutions/run-browser.mjs m16
 * (also tests/m16-solution.test.mjs). Walkthrough: m16.walkthrough.mjs.
 *   A  the team crawls W along the N edge and down the river bank; the Spy goes on alone round the village and the
 *      fields to the clothesline on the E edge and takes the German uniform;
 *   B  in uniform he walks to the lorry, drives it up to the belt's gap and picks up the Sniper and the Marine;
 *   C  back down to the bridge: over the level crossing in e15's wake as he walks W, N of his road while he stands
 *      at the deck mouth, through the mouth's narrow N lane past him, along the deck to the main span, where it stops;
 *   D  the Sniper slips out and lies on the S walkway beside it;
 *   E  the Spy walks back over the bridge in uniform, down the W bank, and holds the W-bank sapper e14 in talk at
 *      his turn under the deck (his back to the river); the strike: the sentry e18, the island pair e16 and e17 and
 *      e14, four silent shots in a few seconds, none seen, no body found; then the fifth round for e15 at the E
 *      bridgehead as soon as he walks into the Sniper's line. The Sniper climbs into the lorry by the tailboard,
 *      the Spy walks back to the cab: win.
 * Nobody ever sees a commando (exposure watch), nothing is found and no siren sounds until all four sappers are dead.
 * AT MOST ONE ALARM, after objective o1, and by design: e15's whole beat is in plain view of e19, e21, e23, e24 and
 * Patrol 25 (his fall or his body is seen within a second or two wherever he falls in the Sniper's reach), so the last
 * sapper usually raises the siren, after the win's first half (o1) and before the boarding. The dossier allows it
 * (docs/missions/m16.md §9 "once all four are dead, an alarm is survivable", §12 Phase 5 "the alarm no longer
 * matters"); nobody ever sees a commando.
 */
import { routeClear, predict, walking, clearFor, walkerSees, staticSees, viewersOf } from './sneak.mjs';
import { ABILITIES } from '../../src/abilities/index.js';
import { arcStep } from '../../src/entities/vehicle-maneuver.js';
import { boardPoint } from '../../src/abilities/drive.js';
import { CONFIG } from '../../src/config.js';

const DBG = !!globalThis.process?.env?.M16DBG;
/** (debug) log why a wait goes on, now and then; always false */
let dbgN = 0;
function dbg(D, why, label) { if (DBG && dbgN++ % 100 === 0) D.log(`DBG ${D.t.toFixed(1)} ${label}: no [${why.join(' ')}]`); return false; }

/**
 * Crawl along `h.p` (one straight run per point) once nobody would see him anywhere on the way, as the cones are
 * predicted while he passes (routeClear, at a slow and a quick crawl), nor at its end for `hold` s; `far`: men who must
 * first be at least that far from its end (a patrol whose followers the prediction places loosely).
 */
async function crawlHop(D, role, h, { hold = 6, pad = 0.6, slack = 0.6, maxWait = 300, label = 'crawl', standAtEnd = false, exact = false, ready = null, mode = 'crawl' } = {}) {
  const u = D.c(role), pts = Array.isArray(h) ? h : h.p, far = h.far || {}, pd = h.pad ?? pad, end = pts[pts.length - 1];
  const why = [];
  await D.until(() => {
    why.length = 0;
    if (h.rail && !railFree(D, h.rail)) return dbg(D, ['the train'], label);
    if ((h.ready && !h.ready()) || (ready && !ready())) return dbg(D, ['not ready'], label);
    for (const [t, r] of Object.entries(far)) { const e = D.get(t); if (e?.alive && Math.hypot(e.x - end[0], e.z - end[1]) < r) return dbg(D, [`${t} near`], label); }
    // (`exact`: at his true crawl, 0.9 m/s, on open ground; else at a slow and a quick one)
    const run = (h.mode ?? mode) === 'run', walk = run || (h.mode ?? mode) === 'walk', md = walk ? 'walk' : 'crawl';
    const speeds = run ? [4.5] : walk ? [2.25] : exact ? [0.9] : [0.75, 1.0];
    // (running: his footsteps carry 12 m on the deck; nobody may be within earshot on the way)
    if (run) for (const e of D.world.enemies) if (e.alive && !e.removed && pts.some(([px, pz]) => segDist(e.x, e.z, u.x, u.z, px, pz) < 14)) return dbg(D, [`${e.tag} would hear`], label);
    const rise = walk && u.stance === 'crawl' ? 0.6 : 0;
    for (const v of speeds) if (!routeClear(D, pts, { mode: md, from: [u.x, u.z], speed: v, delay: 0.2 + rise, slack, why, pad: pd })) return dbg(D, why, label);
    let t = 0.2 + rise, [x, z] = [u.x, u.z];
    for (const [px, pz] of pts) { t += Math.hypot(px - x, pz - z) / speeds[0]; x = px; z = pz; }
    for (let k = 0; k <= hold; k += 0.5) if (!routeClear(D, [end], { mode: standAtEnd || walk ? 'walk' : 'crawl', from: end, delay: t + k, slack: 0, why, pad: pd })) return dbg(D, why, label);
    return true;
  }, maxWait, `${label} clear`).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
  const m = h.mode ?? mode;
  if (DBG) D.log(`DBG ${label}: go t=${D.t.toFixed(1)} → ${JSON.stringify(pts)}`);
  await D.stance(role, m === 'walk' || m === 'run' ? 'stand' : 'crawl');
  for (const [x, z] of pts) await D.go(role, x, z, { tol: 0.5, max: 120, run: m === 'run' });
}

/** Distance from (x, z) to the segment a→b. */
function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
}

/**
 * The team crawls one hop together in file: each man to the hop's end point, `trail[role]` m back along the way he
 * came, once nobody would see any of them on the way (crawlHop's test for each).
 */
async function crawlTeam(D, h, trail, { hold = 6, pad = 0.6, slack = 0.6, maxWait = 300 } = {}) {
  const pts = Array.isArray(h) ? h : h.p, far = h.far || {}, pd = h.pad ?? pad, end = pts[pts.length - 1];
  const roles = Object.keys(trail), lead = D.c(roles[0]), g = D.world.grid;
  const back = Math.atan2(lead.z - end[1], lead.x - end[0]);
  const goal = {};
  for (const r of roles) {
    let q = [end[0] + Math.cos(back) * trail[r], end[1] + Math.sin(back) * trail[r]];
    if (!g.walkableAt(q[0], q[1], { crawl: true })) q = end;
    goal[r] = q;
  }
  const route = (r) => [...pts.slice(0, -1), goal[r]];
  const why = [], label = `the team crawls to (${end})`;
  await D.until(() => {
    why.length = 0;
    if (h.rail && !railFree(D, h.rail)) return dbg(D, ['the train'], label);
    for (const [t, rr] of Object.entries(far)) { const e = D.get(t); if (e?.alive && Math.hypot(e.x - end[0], e.z - end[1]) < rr) return dbg(D, [`${t} near`], label); }
    for (const r of roles) {
      const u = D.c(r), rt = route(r), q = rt[rt.length - 1];
      for (const v of [0.75, 1.0]) if (!routeClear(D, rt, { mode: 'crawl', from: [u.x, u.z], speed: v, delay: 0.2, slack, why, pad: pd })) return dbg(D, why, label);
      let t = 0.2, [x, z] = [u.x, u.z];
      for (const [px, pz] of rt) { t += Math.hypot(px - x, pz - z) / 0.75; x = px; z = pz; }
      for (let k = 0; k <= hold; k += 0.5) if (!routeClear(D, [q], { mode: 'crawl', from: q, delay: t + k, slack: 0, why, pad: pd })) return dbg(D, why, label);
    }
    return true;
  }, maxWait, `${label} clear`).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
  // (each goes point by point: orders to all three, then wait for all three)
  const legs = Object.fromEntries(roles.map((r) => [r, route(r)]));
  for (let i = 0; i < pts.length; i++) {
    for (const r of roles) D.order(r, { type: 'move', x: legs[r][i][0], z: legs[r][i][1] });
    await D.until(() => roles.every((r) => { const u = D.c(r); return Math.hypot(u.x - legs[r][i][0], u.z - legs[r][i][1]) < 0.6 || (!u.path && !u.isMoving); }), 120, label);
  }
}

/** A chain of crawl hops (each a point, a polyline, or {p, far, pad}). */
async function crawlChain(D, role, hops, o = {}) {
  for (const h of hops) {
    const pts = Array.isArray(h) ? h : h.p, end = pts[pts.length - 1];
    await crawlHop(D, role, h, { ...o, label: `${role} crawls to (${end})` });
  }
}

/**
 * The train runs the line through the station every couple of minutes (it kills anyone on the rails and its hull
 * blocks a lorry). Will it stay clear of the stretch of line round (x, z) for the next `sec` seconds (no train, or
 * not there before then, as its timetable goes: it appears at the NE end, stops 12 s at the station, runs on SW)?
 * Without a point: is it out of sight (gone) for at least `sec` more seconds?
 */
function railFree(D, sec, at = null) {
  const t = D.world.vehicles.find((v) => v.vehicleType === 'train' && !v.removed);
  if (!t) return true;
  if (!at) return !t.railRunning && (t.railT ?? 0) > sec;
  // distance along the track of the point nearest (x, z)
  let s = 0, best = Infinity, sAt = 0;
  for (let k = 1; k < t.track.length; k++) {
    const a = t.track[k - 1], b = t.track[k], L = Math.hypot(b.x - a.x, b.z - a.z);
    const u = Math.max(0, Math.min(1, ((at[0] - a.x) * (b.x - a.x) + (at[1] - a.z) * (b.z - a.z)) / (L * L)));
    const d = Math.hypot(a.x + (b.x - a.x) * u - at[0], a.z + (b.z - a.z) * u - at[1]);
    if (d < best) { best = d; sAt = s + u * L; }
    s += L;
  }
  const v = t.schedule?.speed || 9, reach = 22; // (its 30 m hull and kill box either side of its centre)
  const stopAt = t.trackStops?.[0];
  const eta = (from) => { // seconds for the train centre at track distance `from` to come within `reach` of sAt
    if (from > sAt + reach) return Infinity; // (already past it)
    let d = Math.max(0, sAt - reach - from), tt = d / v;
    if (stopAt && from < stopAt.s && stopAt.s < sAt) tt += stopAt.wait;
    return tt;
  };
  if (!t.railRunning) return (t.railT ?? 0) + eta(0) > sec;
  const left = eta(t.railS ?? 0) - (t.waitT > 0 ? -t.waitT : 0);
  if (left === Infinity) return (t.railT ?? 0) >= 0 && (t.schedule?.period ?? 60) + eta(0) > sec; // (gone by: its next run)
  return left > sec;
}

// ---------------------------------------------------------------- the lorry
/** The lorry's hull poses along a drive order to (x, z) (its own multi-point turn, then the straight run) and the time
 *  it takes (maneuvering ~2 m/s, the run at 3 m/s, a pause at each change of gear): what the player sees it will do. */
function drivePlan(v, x, z, from = null, t0 = 0) {
  let plan;
  if (from) { // (planned from a pose it will reach: a stand-in hull put there for the planner, the lorry untouched)
    const ghost = Object.create(v);
    ghost.x = from.x; ghost.z = from.z; ghost.heading = from.h;
    plan = ghost._planDrive?.(x, z);
  } else plan = v._planDrive?.(x, z);
  if (!plan) return null;
  const poses = [];
  let p = from ? { ...from } : { x: v.x, z: v.z, h: v.heading }, T = t0;
  poses.push({ ...p, t: T });
  for (const l of plan.legs) {
    const n = Math.max(1, Math.ceil(l.len / 0.5));
    for (let i = 1; i <= n; i++) { p = arcStep(p.x, p.z, p.h, (l.dir * l.len) / n, l.k); T += l.len / n / (l.dir > 0 ? 2.4 : 1.6); poses.push({ ...p, t: T, rev: l.dir < 0 }); }
    T += 0.6;
  }
  const L = Math.hypot(x - p.x, z - p.z), n = Math.max(1, Math.ceil(L / 0.5)), h = Math.atan2(z - p.z, x - p.x);
  for (let i = 1; i <= n; i++) { T += L / n / 3; poses.push({ x: p.x + ((x - p.x) * i) / n, z: p.z + ((z - p.z) * i) / n, h, t: T }); }
  // (the straight run after the turn ends at the first thing in the way: `short` m before the point)
  const short = L > 0.5 ? L - v.straightReach(x, z, p.x, p.z) : 0;
  return { poses, T: T + 1.5, end: { x, z, h }, short };
}

/** The plans of a run of drive orders, each from where the last one ends (null when one cannot get there). */
function chainPlan(v, pts, why = null) {
  let from = null, t0 = 0;
  const all = { poses: [], T: 0 };
  for (const [px, pz] of pts) {
    const plan = drivePlan(v, px, pz, from, t0);
    if (!plan || plan.short > 0.6) { why?.push(`to (${px},${pz}): ${plan ? `${plan.short.toFixed(1)} m short` : 'no turn'}`); return null; }
    all.poses.push(...plan.poses); from = plan.end; t0 = all.T = plan.T;
  }
  return all;
}

/** Gap from (x, z) to a hull at pose p (0 inside). */
function hullGap(v, p, x, z) {
  const [L, W] = v.def?.size || [6.3, 2.4], dx = x - p.x, dz = z - p.z, c = Math.cos(p.h), s = Math.sin(p.h);
  return Math.hypot(Math.max(0, Math.abs(dx * c + dz * s) - L / 2), Math.max(0, Math.abs(-dx * s + dz * c) - W / 2));
}

/**
 * Nobody (on his feet, walking or posted) comes within `margin` m of the hull while it drives there — before, during
 * and after it passes (± `slack` s) — so nobody has to step out of its way (a man brushed aside by a commando's lorry
 * knows it: §3.7, the lorry would be shot up).
 */
function driveClear(D, v, plan, { margin = 2.5, slack = 3, why = null, memo = null, skip = null } = {}) {
  // (the hull, and the lorry's sensor box ahead of it: a man in that box steps aside, and knows who drives it, §3.7)
  const [bf, bt, bh] = CONFIG.vehicles.runoverBox, pad = 0.5, side = 1.0; // (the arcs it drives run ~1 m wide of the plan)
  const gap = (ps, x, z) => {
    // (backing, its box is behind it)
    const h = ps.rev ? ps.h + Math.PI : ps.h, dx = x - ps.x, dz = z - ps.z, c = Math.cos(h), s = Math.sin(h), al = dx * c + dz * s, ac = -dx * s + dz * c;
    if (al >= bf - pad && al <= bt + pad && Math.abs(ac) <= bh + side) return 0;
    return hullGap(v, ps, x, z);
  };
  // (the plan's bounding box, once: men who cannot come near it in its time are skipped)
  const bb = plan.bb || (plan.bb = plan.poses.reduce((b, p) => [Math.min(b[0], p.x), Math.min(b[1], p.z), Math.max(b[2], p.x), Math.max(b[3], p.z), Math.max(b[4], p.t)], [Infinity, Infinity, -Infinity, -Infinity, 0]));
  for (const e of D.world.enemies) {
    if (!e.alive || e.removed) continue;
    // (a crew inside a pillbox is behind its walls: no lorry can brush him)
    if (e.soldierType === 'crew') continue;
    if (skip?.(e)) continue;
    const moving = walking(e);
    const out = Math.hypot(Math.max(0, bb[0] - e.x, e.x - bb[2]), Math.max(0, bb[1] - e.z, e.z - bb[3]));
    if (out > 12 + margin + (moving ? 2 * (bb[4] + slack) : 0)) continue;
    for (const ps of plan.poses) {
      // (a man at his post: wider, the lorry's real arcs swing a metre or two off the planned ones)
      if (!moving) { if (gap(ps, e.x, e.z) < margin + 1.5 || hullGap(v, ps, e.x, e.z) < margin + 2.5) { why?.push(`${e.tag}@(${ps.x.toFixed(0)},${ps.z.toFixed(0)})`); return false; } continue; }
      for (let t = Math.max(0, ps.t - slack); t <= ps.t + slack; t += 0.5) {
        // (one prediction per man and quarter second, shared by every lineup looked at this tick)
        const tq = Math.round(t * 4), mk = memo && `${e.id}|${tq}`;
        let q = mk ? memo.get(mk) : null;
        if (!q) { q = predict(e, tq / 4); if (mk) memo.set(mk, q); }
        if (gap(ps, q.x, q.z) < margin) { why?.push(`${e.tag}~@(${ps.x.toFixed(0)},${ps.z.toFixed(0)})+${t.toFixed(1)}`); return false; }
      }
    }
  }
  return true;
}

/**
 * The Spy drives the lorry to (x, z) — once its whole way there stays clear of everyone (driveClear). `then`: more
 * points it drives on to at once, each leg ordered as the last one ends (their way checked from the start too).
 */
export async function drive(D, x, z, { maxWait = 300, label = null, margin = 2.5, slack = 3, ready = () => true, rail = 0, railAt = null, then = [], via = null, viaNow = false, viaOnly = false } = {}) {
  const v = D.world.byId('truck'), why = [];
  let pts = [[x, z], ...then];
  label = label || `the lorry to (${pts.map((p) => p.join(',')).join(')→(')})`;
  // (`via`: spots to line it up from first, when it cannot drive straight there from where it stands — a narrow gap;
  // `viaNow`: the first of them (quickest first) whose run is clear at the moment, looked at again as everyone moves)
  let lineups = null;
  if (via && (viaNow || !chainPlan(v, pts))) {
    // (the runs are planned once: the lorry stands still while it waits)
    // (a via entry is a spot or a list of spots)
    const vs = (c) => (Array.isArray(c[0]) ? c : [c]);
    lineups = via.map((c) => ({ c: vs(c), a: chainPlan(v, [...vs(c), ...pts]) })).filter((o) => o.a).sort((p, q) => p.a.T - q.a.T);
    if (viaNow && !viaOnly) { const a = chainPlan(v, pts); if (a) lineups.unshift({ c: [], a }); } // (straight there, when it can; `viaOnly`: never)
    else if (lineups.length) { pts = [...lineups[0].c, ...pts]; D.log(`${label}: lined up via (${lineups[0].c.join(')→(')})`); lineups = null; }
  }
  const base = pts;
  await D.until(() => {
    why.length = 0;
    if (!ready()) return dbg(D, ['not ready'], label);
    if (lineups?.length) {
      if (Math.round(D.world.time / D.dt) % 10) return false;
      const memo = new Map();
      for (const { c, a: all } of lineups) {
        if (all && driveClear(D, v, all, { margin, slack, memo }) && (!rail || railFree(D, railAt ? rail : Math.max(rail, all.T + 5), railAt))) { pts = [...c, ...base]; if (c.length) D.log(`${label}: lined up via (${c.join(')→(')})`); return true; }
      }
      if (DBG && dbgN % 100 === 0) { const cnt = {}; for (const { a: all } of lineups) { const w2 = []; if (!driveClear(D, v, all, { margin, slack, why: w2 })) { const k = w2[0] || 'rail'; cnt[k] = (cnt[k] || 0) + 1; } } const e15 = D.get("e15"); why.push(`${v.x.toFixed(1)},${v.z.toFixed(1)} h${Math.round(v.heading * 57.3)} ${lineups.length} e15(${e15.x.toFixed(1)},${e15.z.toFixed(1)} ${e15.brain?.state} path ${(e15.path || []).slice(e15.pathIndex || 0).map((p) => p.x.toFixed(0) + "," + p.z.toFixed(0)).join(" ")}) ${JSON.stringify(cnt)}`); }
      return dbg(D, ['no lineup clear', ...why], label);
    }
    const all = chainPlan(v, pts, why);
    if (!all) return dbg(D, why, label); // (a man standing in the line)
    if (rail && !railFree(D, railAt ? rail : Math.max(rail, all.T + 5), railAt)) { const tr = D.world.vehicles.find((x) => x.vehicleType === 'train'); return dbg(D, [`the train (${tr?.railRunning ? 'running' : 'away'} ${(tr?.railT ?? 0).toFixed(0)} s, ${tr?.x.toFixed(0)},${tr?.z.toFixed(0)} spd ${(tr?.speed ?? 0).toFixed(1)}; needs ${Math.max(rail, all.T + 5).toFixed(0)} s)`], label); }
    return driveClear(D, v, all, { margin, slack, why }) || dbg(D, why, label);
  }, maxWait, `${label} clear`).catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
  for (const [px, pz] of pts) {
    D.order('spy', { type: 'move', x: px, z: pz });
    const t0 = D.t;
    await D.until(() => D.t > t0 + 0.3 && !v.goal && (v.speed || 0) < 0.05, 120, label);
    if (Math.hypot(v.x - px, v.z - pz) > 1.5) {
      const near = [...D.world.enemies, ...D.world.commandos].filter((u) => u.alive && !u.vehicle && Math.hypot(u.x - v.x, u.z - v.z) < 9).map((u) => `${u.tag || u.role}(${u.x.toFixed(1)},${u.z.toFixed(1)})`);
      throw new Error(`${label}: stopped at (${v.x.toFixed(1)},${v.z.toFixed(1)}) h${Math.round((v.heading * 180) / Math.PI)} short of (${px},${pz}) near [${near.join(' ')}]`);
    }
    if (v.tainted) throw new Error(`${label}: the lorry tainted`);
  }
}

/**
 * The lorry onto the bridge from the bridgehead (C1) by DECK_RUN, one drive order per point as the last one ends. It
 * sets off the moment e15 leaves his E turn walking W (the first 4 s of his walk: it stays in his wake), with the
 * train away from the crossing and no walker near its way; it slips N of his road only once he is past the spot its
 * box sweeps (station 47.5-53.5), and runs on through the N lane of the mouth past him at once.
 */
async function deckRun(D) {
  const v = D.world.byId('truck'), e15 = D.get('e15'), why = [];
  const s15 = () => deckS(e15.x, e15.z);
  const westbound = () => e15.isMoving && Math.cos(e15.heading - (0.6912 + Math.PI)) > 0.8;
  // (posted men stay put: the run clears e21, e22 and e24 by 2 m and more; e15 is timed by what he does)
  const skip = (e) => e === e15 || !walking(e);
  const plan = chainPlan(v, DECK_RUN.slice(0, 3));
  await D.until(() => {
    why.length = 0;
    if (!e15.alive) throw new Error('the deck run: e15 dead');
    if (!(westbound() && s15() > 50.5 && s15() < 54.4)) return dbg(D, [`e15 s${s15().toFixed(1)} ${e15.isMoving ? 'walking' : 'standing'}`], 'the deck run');
    if (!railFree(D, 20, LEVEL_CROSSING)) return dbg(D, ['the train'], 'the deck run');
    return (plan ? driveClear(D, v, plan, { margin: 1, slack: 2, why, skip }) : true) || dbg(D, why, 'the deck run');
  }, 900, 'e15 walking away W from his E turn, the way clear').catch((e) => { throw new Error(`${e.message} [${why.slice(0, 3).join(' ')}]`); });
  D.log(`the deck run: e15 at station ${s15().toFixed(1)} walking W`);
  for (const [k, [x, z]] of DECK_RUN.entries()) {
    const label = `the lorry to (${x},${z})`;
    // (N of his road only once he is W of the strip its box sweeps on the way)
    if (k === 2) await D.until(() => !e15.alive || s15() < 47.5 || s15() > 53.5, 60, 'e15 past the strip N of his road');
    D.order('spy', { type: 'move', x, z });
    const t0 = D.t;
    await D.until(() => D.t > t0 + 0.3 && !v.goal && Math.abs(v.speed || 0) < 0.05, 120, label);
    if (Math.hypot(v.x - x, v.z - z) > 1.5) throw new Error(`${label}: stopped at (${v.x.toFixed(1)},${v.z.toFixed(1)}) h${Math.round((v.heading * 180) / Math.PI)}`);
    if (v.tainted) throw new Error(`${label}: the lorry tainted`);
  }
}

/** `role` crawls to the lorry's door and climbs in (on his feet for a moment: nobody may see him then). */
async function board(D, role, { maxWait = 300, hops = [], ready = null } = {}) {
  const u = D.c(role), v = D.world.byId('truck'), why = [];
  // (the door of the seat the game gives him: the free one nearest him, the wheel kept for the Spy)
  const door = boardPoint(v, u, v.seatFor(u));
  // (`hops`: the way to it, crawled hop by hop; the last one runs on to the door)
  const way = hops.length ? hops.map((h, k) => (k === hops.length - 1 ? { ...h, p: [...h.p, [door.x, door.z]] } : h)) : [[[door.x, door.z]]];
  // the last hop only when nobody would see a man standing at the door from now until a few seconds after he gets
  // there (he stands up to climb in: he must not lie by the lorry waiting for his moment)
  const last = way[way.length - 1], lastPts = Array.isArray(last) ? last : last.p;
  const legT = () => { let t = 0.5, [x, z] = [u.x, u.z]; for (const [px, pz] of lastPts) { t += Math.hypot(px - x, pz - z) / 0.75; x = px; z = pz; } return t; };
  const doorClear = () => clearFor(D, [[door.x, door.z]], legT() + 4, { mode: 'walk' });
  if (Math.hypot(door.x - u.x, door.z - u.z) > 0.8) {
    for (const [k, h] of way.entries()) {
      const end = k === way.length - 1, hh = Array.isArray(h) ? { p: h } : h;
      await crawlHop(D, role, end ? { ...hh, ready: () => (!hh.ready || hh.ready()) && doorClear() } : hh, { hold: 3, label: `${role} to the lorry`, ready });
      if (DBG) D.log(`DBG ${role} hop ${k} done t=${D.t.toFixed(1)} at (${u.x.toFixed(1)},${u.z.toFixed(1)})`);
    }
  }
  await D.until(() => { why.length = 0; return clearFor(D, [[u.x, u.z]], 3, { mode: 'walk', why }) || dbg(D, why, `${role} boards`); }, maxWait, `${role} boards unseen`);
  D.ability(role, 'enterVehicle', v);
  await D.until(() => u.vehicle === v, 30, `${role} aboard`);
}

// ---------------------------------------------------------------- the Sniper's strike
const SHOT_GAP = 1.2, AIM = 0.6; // (aim 0.6 s, the bolt 0.5 s: a shot every 1.2 s at most)

/**
 * The Sniper's strike from P, starting now: the men in `first` in the best order, one shot as soon as each can be
 * hit (bolt permitting), then `last` within `maxGap` s; nobody alive sees him kneel to fire, nobody alive (`last`
 * included, until he falls) sees any of `first` fall or lie dead (nor the bodies in `down`, [{x, z}]) before `last`
 * is hit, nor for `slack` s more (the patrols' followers are predicted loosely). `last`'s own body may be found at
 * once: by then the bridge is safe. What a player reads off the cones
 * before he commits. Returns {order, at: [abs times]} or null.
 */
/**
 * Where each walker really looks at the turns of his beat, as the Sniper has watched him do (tag → {route index:
 * heading°}): in the real game a man at the end of a jetty or a bank can face another way than his orders say.
 */
const LOOKS = new Map();
function observeLooks(D) {
  for (const e of D.world.enemies) {
    const b = e.brain, r = e.route;
    if (!e.alive || !b?.atWait || !(r?.length > 1) || b.state !== 'IDLE') continue;
    const wp = r[b.routeIndex ?? 0];
    if (!wp || (wp.wait ?? 0) - (b.waitT ?? 0) < 1.2) continue; // (he has stood there a while: done turning)
    let m = LOOKS.get(e.tag); if (!m) LOOKS.set(e.tag, m = {});
    m[b.routeIndex ?? 0] = (e.heading * 180) / Math.PI;
  }
}
/** The man as the planner sees him: his beat's looks as observed (a stand-in, nothing in the game is touched). */
function asSeen(e) {
  const m = e && LOOKS.get(e.tag);
  if (!m || !(e.route?.length > 1)) return e;
  const g = Object.create(e);
  g.route = e.route.map((wp, i) => (m[i] != null ? { ...wp, look: m[i] } : wp));
  g._looksSeen = e.route.every((_, i) => m[i] != null);
  return g;
}

function strikePlan(D, P, first, last, { down = [], maxGap = 8, midGap = 2.5, firstAt = 0, slack = 6, why = null, maxNodes = 3000, hold = false, then = null } = {}) {
  const no = (k) => { if (why) why[k] = (why[k] || 0) + 1; };
  const w = D.world, now = w.time, V = viewersOf(w).map(asSeen), sn = D.c('sniper');
  const S = first.map((t) => asSeen(D.get(t))).filter((e) => e?.alive), L = asSeen(D.get(last));
  if (!L?.alive) return null;
  // (not before his bolt is back: the first shot waits for it)
  firstAt = Math.max(firstAt, Math.ceil(Math.max(0, (sn._boltT ?? -1) - now) * 10) / 10 + (sn.currentAction || sn.pendingAbility ? 0.6 : 0));
  const kneel = { x: P[0], z: P[1], y: sn.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando' };
  const sees = (e, d, t) => (walking(e) ? walkerSees(e, predict(e, t), d, w, now + t) : staticSees(e, d, w, t));
  const r1 = (t) => Math.round(t * 10) / 10;
  const qm = new Map(); const qAt = (v, t) => { t = r1(t); const k = `${v.tag}|${t}`; let q = qm.get(k); if (!q) qm.set(k, q = walking(v) ? predict(v, t) : { x: v.x, z: v.z }); return q; };
  const near = (e, x, z, t, r) => { const q = qAt(e, t); return Math.hypot(q.x - x, q.z - z) <= r; };
  // (with a pad: also 0.7 m nearer each man — an engineer who glimpses him at the very edge of his cone runs at once)
  const padded = (e, t) => { const q = qAt(e, t), d = Math.hypot(q.x - P[0], q.z - P[1]) || 1; return { ...kneel, x: P[0] + ((q.x - P[0]) / d) * 0.7, z: P[1] + ((q.z - P[1]) / d) * 0.7 }; };
  // (a walker's pace and head drift more: his head ±0.5 rad, the man 1.5 m nearer — an engineer who glimpses him runs)
  // (at a turn of his beat — waiting there, or turning round within ±2.5 s — where he looks is anyone's guess: any way)
  const atTurn = (e, t) => { if (e._looksSeen) return false; const a = predict(e, Math.max(0, t - 2.5)), b = predict(e, t + 2.5), q = predict(e, t); let dh = Math.abs(a.heading - b.heading) % (2 * Math.PI); if (dh > Math.PI) dh = 2 * Math.PI - dh; return dh > 1 || Math.hypot(a.x - q.x, a.z - q.z) < 0.3 || Math.hypot(b.x - q.x, b.z - q.z) < 0.3; };
  const regroup = (e, t) => { const L = e.squad && e.brain?._leader?.(); if (!L || !L.alive) return false; for (let k = 0; k <= 5; k++) if (atTurn(L, Math.max(0, t - k))) return true; return false; };
  const walkerGlimpse = (e, t) => {
    const pe = predict(e, t), d = padded(e, t), dd = { ...d, x: P[0] + (d.x - P[0]) * (1.5 / 0.7), z: P[1] + (d.z - P[1]) * (1.5 / 0.7) };
    const hs = atTurn(e, t) ? [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k * Math.PI) / 4) : [-0.5, 0, 0.5].map((o) => pe.heading + o);
    return hs.some((h) => [kneel, dd].some((m) => walkerSees(e, { ...pe, heading: h }, m, w, now + t)));
  };
  const km = new Map(); const kneelSeers = (t) => { t = r1(t); let r = km.get(t); if (!r) km.set(t, r = V.filter((e) => near(e, P[0], P[1], t, (e.vision?.far ?? 36) + 2.5) && (sees(e, kneel, t) || sees(e, padded(e, t), t) || (walking(e) && walkerGlimpse(e, t)))).map((e) => e.tag)); return r; };
  const shm = new Map(); const shootable = (v, t) => {
    t = r1(t); const k = `${v.tag}|${t}`; if (shm.has(k)) return shm.get(k);
    const q = qAt(v, t); let ok = Math.hypot(q.x - P[0], q.z - P[1]) <= 44;
    if (ok) { const f = Object.create(v); f.x = q.x; f.z = q.z; const g = Object.create(sn); g.x = P[0]; g.z = P[1]; g.vehicle = null; g.state = 'active'; g.currentAction = null; g.pendingAbility = null; g._boltT = -1; ok = ABILITIES.sniper.canUse(g, f, w) === true; }
    shm.set(k, ok); return ok;
  };
  // (does anyone alive then see the body at q, from t1 to t2? a walker's head may lag his turn: ±0.6 rad tried too)
  const bm = new Map(); const found = (q, t1, t2, death, self = null) => {
    for (const e of V) {
      if (e.tag === self) continue;
      // (from a little before: the moment he falls is known to a tick or two, and a sweeping head covers ground fast)
      for (let t = r1(Math.max(0, t1 - 0.2)); t <= t2 + 1e-6; t = r1(t + 0.1)) {
        if (death.has(e.tag) && t >= death.get(e.tag)) break;
        if (!near(e, q.x, q.z, t, (e.vision?.far ?? 36) + 1.5)) continue;
        const k = `${e.tag}|${q.x.toFixed(1)},${q.z.toFixed(1)}|${t}|${t - t1 < 1}`; let r = bm.get(k);
        if (r === undefined) {
          const body = { x: q.x, z: q.z, y: q.y || 0, kind: 'body', falling: t - t1 < 1 };
          // (a patrol's men are placed loosely round their leader and glance about: their heads ±1.2 rad; while he
          // halts at a turn of the beat, and for a few seconds after, as they close up again, anywhere)
          const offs = e.squad ? [-1.2, -0.6, 0.6, 1.2] : [-0.6, 0.6];
          r = sees(e, body, t) || ((walking(e) || e.squad) && (atTurn(e, t) || regroup(e, t) ? [0, 1, 2, 3, 4, 5, 6, 7].map((q) => (q * Math.PI) / 4) : offs.map((o) => predict(e, t).heading + o)).some((h) => walkerSees(e, { ...predict(e, t), heading: h }, body, w, now + t)));
          bm.set(k, r);
        }
        if (r) return e.tag;
      }
    }
    return null;
  };
  let kneelBy = null;
  const kneelOk = (ts, death) => { for (let t = Math.max(0, ts - 0.1); t <= ts + AIM + 0.2 + 1e-6; t += 0.1) { const s = kneelSeers(t).find((tag) => !death.has(tag) || t <= death.get(tag) + 1e-6); if (s) { kneelBy = s; return false; } } return true; };
  // a search over who next and when (each man's first few clean moments, the bodies checked as the plan grows)
  const bodyQ = new Map();
  const unfound = (death, upto) => {
    for (const [tag, td] of death) {
      if (tag === L.tag && !hold) continue;
      let q = bodyQ.get(tag); if (!q) bodyQ.set(tag, q = qAt([...S, L].find((v) => v.tag === tag), td));
      const who = found(q, td, upto, death, tag); if (who) { no(`found by ${who}`); return false; }
    }
    for (const b of down) { const who = found(b, 0, upto, death, b.tag ?? null); if (who) { no(`found by ${who}`); return false; } }
    return true;
  };
  let nodes = 0;
  const moments = (v, t, lim, death, n) => {
    const out = []; let inRange = false;
    for (let u = t; u <= lim + 1e-6 && out.length < n; u = r1(u + 0.1)) {
      // (his line to the man from the aim to a little past the shot: a walker's predicted pace drifts)
      if (!shootable(v, u) || !shootable(v, u + AIM - 0.2) || !shootable(v, u + AIM) || !shootable(v, u + AIM + 0.4)) continue;
      inRange = true; death.set(v.tag, u + AIM);
      // (nobody alive then may see him kneel for it, the man himself included, until he falls)
      if (kneelOk(u, death)) { out.push(u); u = r1(u + 0.9); }
      death.delete(v.tag);
    }
    if (!out.length) no(inRange ? `kneel for ${v.tag} (${kneelBy})` : `range ${v.tag}`);
    return out;
  };
  const dfs = (rest, t, death, order, at, k) => {
    if (++nodes > maxNodes) return null;
    if (!rest.length) {
      for (const u of moments(L, t, t + maxGap, death, 3)) {
        death.set(L.tag, u + AIM);
        // (`then`: the next man's first clean moment in his line, `after` to `after + within` s on: every body unfound
        // till then — `hold`: the last one's too)
        let next = null;
        if (then) {
          const N = asSeen(D.get(then.tag));
          for (let v = r1(u + AIM + then.after); v <= u + AIM + then.after + then.within + 1e-6 && N?.alive; v = r1(v + 0.2)) {
            if (shootable(N, v) && shootable(N, v + AIM) && shootable(N, v + AIM + 0.4) && shootable(N, v + 1.5)) { next = v; break; }
          }
          if (next == null) { no(`no ${then.tag}`); death.delete(L.tag); continue; }
        }
        if (unfound(death, (next ?? u) + AIM + slack)) return { order: [...order, L.tag], at: [...at, now + u], end: u + AIM, next: next != null ? now + next : null };
        death.delete(L.tag);
      }
      return null;
    }
    for (const v of rest) {
      for (const u of moments(v, t, k === 0 ? t : t + midGap, death, 3)) {
        death.set(v.tag, u + AIM);
        if (why && k + 1 > (why._depth || 0)) { why._depth = k + 1; why._deep = `${[...order, v.tag]}`; }
        if (unfound(death, u + AIM)) { const r = dfs(rest.filter((x) => x !== v), u + SHOT_GAP, death, [...order, v.tag], [...at, now + u], k + 1); if (r) return r; }
        death.delete(v.tag);
      }
    }
    return null;
  };
  return dfs(S, firstAt, new Map(), [], [], 0);
}

/** The Sniper (prone at P) fires at `tag` (he kneels for the shot), and waits for the bolt. */
async function shoot(D, tag) {
  const sn = D.c('sniper'), v = D.get(tag);
  await D.until(() => D.world.time >= (sn._boltT ?? -1) && !sn.currentAction && !sn.pendingAbility, 3, 'the bolt');
  if (DBG) { const q = predict(v, 0); D.log(`DBG shoot ${tag} t=${D.world.time.toFixed(2)} at (${v.x.toFixed(2)},${v.z.toFixed(2)}) pred (${q.x.toFixed(2)},${q.z.toFixed(2)}) sn (${sn.x.toFixed(2)},${sn.z.toFixed(2)},${sn.stance}) canUse ${ABILITIES.sniper.canUse(sn, v, D.world)}`); }
  D.ability('sniper', 'sniper', v);
  await D.until(() => !v.alive || (!sn.currentAction && !sn.pendingAbility), 3, `${tag} shot`);
  if (v.alive) throw new Error(`the strike: ${tag} missed`);
}

// ---------------------------------------------------------------- places
/**
 * The long way round to the clothesline (the house block shuts the E edge at the grey townhouse; the way through the
 * village is watched all the time): W along the N edge of the map, S down the river bank inside the hedgehog belt,
 * out through its gap at (131,75), over the NE road W of the fields hut, along the hollow between the hut's sentry and
 * the fields patrol, E across the empty SE field and up the E edge. Every stop is a spot nobody looks at.
 */
const CORRIDOR = [
  [[184, 14]], [[172, 17]], [[160, 19]], [[150, 22]], [[142, 32]], [[140, 44]], [[141, 52]], [[140, 60]], [[137, 66]],
  [[134, 70.5]], [[131.5, 74.5]], [[133, 78]], { p: [[136, 88], [140, 100]], rail: 40 }, [[144, 104]], [[150, 110]], // (over the line)
  { p: [[147, 116], [152, 119.5], [157, 120.3]], far: { e13: 40 }, pad: 1.0 }, // (the fields patrol well away W)
  { p: [[162, 118], [164.5, 119]], pad: 1.0 }, // (a stop > 19 m from the walker e10's S turn: his near band is 18 m)
  [[170, 124]], [[172, 130]], [[182, 136]], [[192, 135]],
];
const SE_CORNER = { spy: [198, 128] };
/** The team crawls together as far as the river bank inside the belt (CORRIDOR up to (141,52)): the Sniper and the
 *  Marine trail the Spy in file, this far behind him, and stay behind (141,52) (out of e37's sight). */
const TRAIL = { spy: 0, sniper: 2.5, diver: 4.5 };
/** Where he waits for the dash: 19 m and more from the turn of Patrol 11 at the block's SE corner (a crawler is seen only inside 18 m). */
const SPY_EDGE = [[199, 123.5]];
const LORRY_WALK = [100, 141];
/** Back from the pickup to the bridgehead: it turns round S of the belt (over the railway). */
const FROM_PICKUP = [[148, 93], [135, 117.5], [116.2, 125.8]];
/** A point given in bridge coordinates: `s` m along the deck axis from the middle of the main span (58.6,81.25) toward
 *  the E bank (heading 39.6°), `lat` m off it (+ toward the pillbox side, S). */
const DECK = (s, lat) => { const c = Math.cos(0.6912), n = Math.sin(0.6912); return [+(58.6 + s * c - lat * n).toFixed(2), +(81.25 + s * n + lat * c).toFixed(2)]; };
const deckS = (x, z) => (x - 58.6) * Math.cos(0.6912) + (z - 81.25) * Math.sin(0.6912);
const LEVEL_CROSSING = [104, 119];
/**
 * Onto the bridge. The deck's E mouth (station 42-44) has three posts: the truss's end posts and one on the axis,
 * which leave a lane 2 m N of the axis just wide enough for the lorry, and a wider one 1.3 m S of it. e15 paces the
 * road from station 44.4 (the mouth, his W turn) to 54.7 (his E turn, in the level crossing's gap between the boom
 * posts) 1.1 m S of the axis: the S lane is his road, so the lorry takes the N one. It goes in right behind him: as
 * soon as he sets off W from his E turn it crosses the line through the gap (DECK_RUN[0..1], in his wake), slips
 * N of his road while he stands at his W turn (DECK_RUN[2]: its box never comes within a metre of his line) and on
 * through the N lane past him (1.9 m clear of him) onto the deck (DECK_RUN[3]).
 */
const DECK_RUN = [DECK(68, 1.8), DECK(57, 1), DECK(49.5, -1.8), DECK(30, -1.5)];
/** Where the lorry stops on the bridge (1.5 m S of the axis, 3 m W of the firing spot: clear of his lines to the
 *  targets) and the Sniper's firing spot (S walkway, deck station 46). The lorry faces W there: the drive-off after the
 *  win finds its own way. */
const PARK = [55.3, 80.5];
/** e14's turn at the E end of his beat (by the foot of the deck), and where the Spy waits for him: just N of it,
 *  under the bridge, so that when e14 turns to talk to the Spy he has his back to the river. NEXT15: from the Sniper's
 *  last shot on the W side to his shot at e15, at the soonest (the bolt). */
const E14_TURN = [38, 72.5];
const HIDE = [37.4, 71.3];
const NEXT15 = 1.2;
const FIRE = [58.7, 86.3];
/** The lorry's run N: E along the S road, up the NE road, off it W of the walker e7's turn, over the railway, to the belt's gap at (131,75):
 *  its tailboard 7 m from the gap, where the Sniper and the Marine lie on the far side. */
const TO_PICKUP = [[116, 137.5], [135, 117.5], [145, 96], [132, 80]]; // ((145,96)→(132,80) crosses the line; it stops 8 m clear of it, the train runs by)
const LINE_DASH = [[199, 108], [196.5, 100.5]];
/** The gap in the hedgehog belt (bank side, land side). */
const GAP = [{ p: [[143, 56]], pad: 1.5 }, { p: [[137, 66], [134, 70.5], [131.5, 74.5], [133, 78]], pad: 1.2 }];

export const STAGES = [
  ['A', 'The uniform on the clothesline', async (D) => {
    D.checkpoint('A0 the team prone in the NE wood');
    // the morning train comes down the line from the NE, stops at the station and runs on SW: it kills anyone on the
    // rails, so the Spy waits in the wood until it has gone by (it runs once)
    const train = D.world.vehicles.find((v) => v.vehicleType === 'train');
    await D.until(() => !train || train.removed || train.x < 130, 120, 'the train gone by');
    D.checkpoint('A1 the train gone by');
    // all three crawl W along the N edge of the map and down the river bank inside the hedgehog belt (nobody looks there)
    for (const h of CORRIDOR.slice(0, 7)) await crawlTeam(D, h, TRAIL);
    D.checkpoint('A2 the team on the river bank, inside the belt');
    // the Sniper and the Marine wait there for the lorry; the Spy goes on alone, out through the belt's gap
    await crawlChain(D, 'spy', CORRIDOR.slice(7));
    D.checkpoint('A3 the Spy in the empty SE field');
    await crawlChain(D, 'spy', [[SE_CORNER.spy], ...SPY_EDGE.map((p) => [p])]);
    // the dash to the clothesline: Patrol 11 and the walker e10 both away from it, long enough for him to crawl up,
    // stand and take the uniform off the line (getting up and unpegging it take some 3.5 s); he drops flat at once
    // and crawls back down the E edge
    await crawlHop(D, 'spy', LINE_DASH, { hold: 5, standAtEnd: true, exact: true, maxWait: 1200, label: 'the Spy to the clothesline' });
    const sp = D.c('spy'), line = D.item('uniform_line'), hasUniform = () => (sp.inventory?.get?.('uniform') ?? 0) > 0;
    await D.stance('spy', 'stand');
    D.ability('spy', 'use', line);
    await D.until(() => hasUniform() || sp.disguised, 8, 'the uniform off the line');
    await D.stance('spy', 'crawl');
    D.checkpoint('A4 the Spy takes the uniform off the line');
    await crawlChain(D, 'spy', [[[199, 108], SPY_EDGE[0]], [SE_CORNER.spy]], { exact: true });
    // he puts it on where nobody can see him stand
    if (!sp.disguised) {
      const why = [];
      await D.until(() => { why.length = 0; return clearFor(D, [[sp.x, sp.z]], 5, { mode: 'walk', why }) || dbg(D, why, 'dress'); }, 300, 'nobody sees the Spy dress');
      await D.stance('spy', 'stand');
      D.ability('spy', 'uniform');
      await D.until(() => sp.disguised, 8, 'the Spy in uniform');
      await D.idle('spy', 5);
    }
    D.checkpoint('A5 the Spy in German uniform');
  }],
  ['B', 'The lorry', async (D) => {
    const sp = D.c('spy'), v = D.world.byId('truck');
    // in uniform he walks openly across the fields to the lorry by the S road and climbs in (an officer taking a lorry)
    await D.stance('spy', 'stand');
    await D.go('spy', ...LORRY_WALK, { tol: 0.8, max: 200 });
    D.ability('spy', 'enterVehicle', v);
    await D.until(() => sp.vehicle === v, 30, 'the Spy at the wheel');
    D.checkpoint('B1 the Spy takes the lorry');
    // straight on E past Patrol 25's beat, then up the NE road and off it, over the railway
    await drive(D, ...TO_PICKUP[0], { then: TO_PICKUP.slice(1, 2) });
    await drive(D, ...TO_PICKUP[2], { rail: 20, then: TO_PICKUP.slice(3) });
    D.checkpoint('B2 the lorry by the gap in the belt');
    // the Sniper and the Marine crawl through the gap: the Sniper climbs into the cab by its right-hand door, the Marine
    // goes along the lorry's flank to the tailboard
    // (the lorry's doors are in sight of two walkers' turns: e23's NE turn by the bridge road, 17 m from the tailboard,
    // and e7's SW turn on the NE road, 15-18 m off, both looking this way while they wait there. Each man waits just
    // outside their sight at the end of the gap, and crawls the last metres to his door as e23 sets off SW and e7 walks
    // away NE: neither can be back for half a minute)
    const e23 = D.get('e23'), e7 = D.get('e7');
    const leaving = (e, [x, z], r, dx, dz) => !e?.alive || (Math.hypot(e.x - x, e.z - z) > r && e.isMoving && Math.cos(e.heading) * dx > 0.3 && Math.sin(e.heading) * dz > 0.3);
    const away = () => leaving(e23, [122.3, 93.2], 2, -1, 1) && leaving(e7, [150, 86], 3, 1, -1);
    await board(D, 'sniper', { hops: [...GAP, { p: [], ready: away }] });
    await board(D, 'diver', { hops: [...GAP, { p: [], ready: away }] });
    D.checkpoint('B3 the Sniper and the Marine aboard');
  }],
  ['C', 'Onto the bridge', async (D) => {
    // back the way it came, over the railway, to the bridgehead
    const lorry = D.world.byId('truck'), bh = FROM_PICKUP[FROM_PICKUP.length - 1];
    if (Math.hypot(lorry.x - bh[0], lorry.z - bh[1]) > 2) await drive(D, ...FROM_PICKUP[0], { rail: 20, then: FROM_PICKUP.slice(1) }); // (dev: a snapshot there)
    D.checkpoint('C1 the lorry at the bridgehead');
    // onto the deck in e15's wake: over the line as he walks away W, N of his road while he stands at his W turn, and
    // on through the N lane of the mouth past him (DECK_RUN)
    await deckRun(D);
    D.checkpoint('C2 the lorry on the bridge');
    // on along the deck to the main span, where it stops just W of the Sniper's firing spot (clear of his lines)
    await drive(D, ...PARK, { margin: 1.5 });
    D.checkpoint('C3 the lorry stops in the middle of the main span');
  }],
  ['D', 'Into position', async (D) => {
    const sn = D.c('sniper');
    // the Sniper slips out and lies on the S walkway: from there the island, the W bank sapper, the sentry by his
    // plunger and the end of e15's beat are all within his 45 m
    D.ability('sniper', 'leaveVehicle');
    await D.until(() => !sn.vehicle && !sn.currentAction, 10, 'the Sniper out');
    D.checkpoint('D1 the Sniper out of the lorry');
    await crawlHop(D, 'sniper', [FIRE], { hold: 8, label: 'the Sniper to the walkway' });
    D.checkpoint('D2 the Sniper prone on the S walkway');
  }],
  ['E', 'The strike', async (D) => {
    const sp = D.c('spy'), sn = D.c('sniper'), e14 = D.get('e14'), v = D.world.byId('truck');
    // the Spy (in uniform: nobody looks twice at an officer) gets out and walks back over the bridge, off its W end
    // and down the bank to the foot of the deck, where the W-bank sapper e14 turns at the E end of his beat
    if (!(e14.brain?.state === 'DISTRACTED' && sp.currentAction)) { // (dev: a snapshot taken while the Spy holds him)
      D.ability('spy', 'leaveVehicle');
      await D.until(() => !sp.vehicle && !sp.currentAction, 10, 'the Spy out');
      await D.go('spy', ...HIDE, { tol: 0.4, max: 200 });
      D.checkpoint('E1 the Spy under the bridge on the W bank');
      // he waits for e14 to come up to his turn and chats him up: he turns his back on the river, the island and the
      // bridge (he looks N at the Spy) and stands there as long as the Spy talks
      await D.until(() => e14.alive && Math.hypot(e14.x - E14_TURN[0], e14.z - E14_TURN[1]) < 0.6 && !e14.isMoving, 300, 'e14 at his turn by the bridge');
      D.ability('spy', 'distract', e14);
      const facing = () => { const d = Math.atan2(sp.z - e14.z, sp.x - e14.x) - e14.heading; return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) < 0.15; };
      await D.until(() => e14.brain?.state === 'DISTRACTED' && facing(), 10, 'e14 talks to the Spy');
      D.checkpoint('E2 the Spy holds e14 with his back to the river');
    }
    if (D.stopBeforeVolley) return; // (dev: a snapshot here)
    // The Sniper picks his moment, reading the cones as they are now: the sentry e18 by the W plunger (he sweeps the
    // island every couple of seconds), the island pair e16 and e17 and e14, held by the Spy with his back to all of it;
    // one shot after the other, each when nobody alive sees him kneel to fire, sees a man fall or finds a body; and
    // e15, the last, when he comes into the Sniper's line at the W end of his beat (within 40 s): every body must lie
    // unseen till then. Five shots: the rifle's five rounds.
    // (e14 last — held, he is there to be shot whenever — or e17 last, at the E end of his jetty)
    const plans = [[['e18', 'e16', 'e17'], 'e14'], [['e18', 'e16', 'e14'], 'e17']];
    const at = [sn.x, sn.z];
    const opts = (o = {}) => ({ hold: true, then: { tag: 'e15', after: NEXT15, within: 40 }, slack: 2, ...o });
    let plan = null, lastWhy = D.world.time;
    const why = {};
    await D.until(() => {
      observeLooks(D);
      if (Math.round(D.world.time / D.dt) % 5) return false;
      if (e14.brain?.state !== 'DISTRACTED') throw new Error('the strike: e14 no longer held');
      for (const [first, last] of plans) if ((plan = strikePlan(D, at, first, last, opts({ why })))) return true;
      if (DBG && D.world.time - lastWhy > 30) { lastWhy = D.world.time; D.log(`DBG ${D.world.time.toFixed(0)} strike: deepest ${why._deep} | ${Object.entries(why).filter(([k]) => k[0] !== '_').sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' ')}`); for (const k in why) delete why[k]; }
      return false;
    }, 3000, 'a moment for the strike');
    D.log(`strike at t=${D.world.time.toFixed(1)}: ${plan.order} at ${plan.at.map((t) => t.toFixed(1))}, e15 at ${plan.next?.toFixed(1)}`);
    const last = plan.order[plan.order.length - 1];
    for (let k = 0; k < plan.order.length; k++) {
      // (before each shot after the first, the rest is looked at again from where everyone is now)
      if (k > 0) {
        let p2 = null;
        const rest = plan.order.slice(k, -1);
        await D.until(() => (observeLooks(D), p2 = strikePlan(D, at, rest, last, opts({ slack: 1 }))) || D.world.time >= plan.at[k] - 1e-6, 30, 'the next shot');
        if (p2) plan = { ...plan, order: [...plan.order.slice(0, k), ...p2.order], at: [...plan.at.slice(0, k), ...p2.at], next: p2.next };
        else D.log(`strike: no better moment for ${plan.order[k]}; he fires as planned`);
      }
      const tag = plan.order[k], u = D.get(tag);
      await D.until(() => D.world.time >= plan.at[k] - 1e-6 && ABILITIES.sniper.canUse(sn, u, D.world) === true, 30, `the shot at ${tag}`);
      await shoot(D, tag);
      D.log(`strike: shot ${k + 1} at ${tag} t=${D.world.time.toFixed(1)}`);
      if (k === 0) D.checkpoint('E3 the Sniper\'s first shot');
    }
    D.checkpoint('E4 e18, the island pair and e14 dead: three plungers safe');
    // the Spy walks back up onto the bridge to the lorry at once (in uniform nobody looks twice at him)
    const door = boardPoint(v, sp, v.seatFor(sp));
    D.order('spy', { type: 'move', x: door.x, z: door.z });
    // last, e15 at the W end of his beat: his beat is watched from every side, so his body is found at once and the
    // siren goes — by then all four are dead and the bridge is safe (dossier §9, §12 Phase 5: "the alarm no longer
    // matters"); the Sniper is 5 m from the lorry
    let p15 = null;
    const why15 = {}, e15 = D.get('e15');
    let lastWhy15 = D.world.time;
    await D.until(() => {
      observeLooks(D);
      // (should a body be found first, he runs for his plunger at the deck's E end, 34 m from the Sniper: he fires
      // the moment he has him in his sights)
      if (e15.brain?.state === 'ALARM_RUN' && ABILITIES.sniper.canUse(sn, e15, D.world) === true) { p15 = { at: [D.world.time] }; D.log(`strike: e15 runs for his plunger t=${D.world.time.toFixed(1)}`); return true; }
      if ((p15 = strikePlan(D, at, [], 'e15', { slack: 0.5, why: why15 }))) return true;
      if (DBG && D.world.time - lastWhy15 > 3) { lastWhy15 = D.world.time; const e = D.get('e15'); D.log(`DBG ${D.world.time.toFixed(1)} e15 (${e.x.toFixed(1)},${e.z.toFixed(1)}): ${Object.entries(why15).filter(([k]) => k[0] !== '_').map(([k, n]) => `${k}:${n}`).join(' ')}`); for (const k in why15) delete why15[k]; }
      return false;
    }, 60, 'e15 in the Sniper\'s line');
    await D.until(() => D.world.time >= p15.at[0] - 1e-6 && ABILITIES.sniper.canUse(sn, D.get('e15'), D.world) === true, 30, 'the shot at e15');
    await shoot(D, 'e15');
    D.checkpoint('E5 the Sniper shoots e15 at the bridgehead: all four sappers dead');
    await board(D, 'sniper', { maxWait: 30 });
    D.checkpoint('E6 the Sniper back in the lorry');
    await D.until(() => Math.hypot(sp.x - door.x, sp.z - door.z) < 0.8 || (!sp.isMoving && !sp.path), 60, 'the Spy at the lorry');
    D.ability('spy', 'enterVehicle', v);
    await D.until(() => sp.vehicle === v, 20, 'the Spy at the wheel');
    await D.until(() => D.world.objectives.every((o) => o.done), 10, 'the escape (o2)');
    D.checkpoint('E7 the Spy back at the wheel: mission complete');
  }],
];

export async function solve(D, ctx = {}) {
  LOOKS.clear();
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}
export const _strikePlan = (...a) => strikePlan(...a);
export const _dev = { observeLooks: (D) => observeLooks(D), chainPlan: (...a) => chainPlan(...a), driveClear: (...a) => driveClear(...a), railFree: (...a) => railFree(...a), DECK_RUN, LEVEL_CROSSING, deckS };
