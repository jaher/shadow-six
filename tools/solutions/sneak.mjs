/**
 * Sneaking helpers for solution scripts (tools/solutions/*.solution.mjs), on top of the driver (driver.mjs): the way
 * a player times a dash between two sweeps. Engine-agnostic like the driver (node or the page); every look-ahead reads
 * the AI's own §4.2 rule (perception.canSee / coneAt) at a predicted moment:
 *   - predict(e, t)          where a guard will be and face t s from now (his route, halts and their looks, a squad
 *                            man's lag behind his leader, a man walking to a lure stops where his path ends);
 *   - planSneak(D, tx, tz, o) the fastest chain of 1 m cells to (tx, tz) that no cone covers while he is in it
 *                            (space-time A*: he waits only where nobody will look) — on foot ('crawl' / 'walk') or
 *                            aboard a boat ('boat': the men sitting in an open boat are seen in both bands);
 *   - sneak(D, tx, tz, o)    go there on such a plan, re-planning whenever he falls behind it;
 *   - clearFor(D, pts, dur)  nobody will see a man (or a boat) at these points for the next dur s;
 *   - bodySeen(D, x, z, dur) a body left at (x, z) would be seen within dur s (and by whom).
 * The planner is a port of the M3 raft planner (fix/boat-occupants-seen) made boat-agnostic (any open boat, the
 * Marine at the oars), so it runs on any mission with a raft or a rowboat.
 * @module tools/solutions/sneak
 */
import { takeHeap, giveHeap, takeSet, giveSet } from './state-heap.mjs';
import { mirrorOf, ghostOn, ghost, protoOf } from './ghost.mjs';
import { canSee as canSee0, coneAt, pointInCone, ellipseFar } from '../../src/ai/perception.js';
import { CONFIG } from '../../src/config.js';
import { T } from '../../src/world/grid.js';
import { viewerFor } from '../../src/ai/vehicle-ai.js';
import { goalReachableGen, seesAnyHeads } from './driver.mjs';
import { compileDashGen, routeFor } from './dash.mjs';

/** A dash compile run the sliced way when the driver can (D.runSliced: the live replay keeps its frames), else through. */
function runDash(D, it) {
  if (D.runSliced) return D.runSliced(it);
  for (;;) { const r = it.next(); if (r.done) return Promise.resolve(r.value); }
}

/** (tools/perf: every planSneak result handed to a checker, which plans it again with a reference copy) */
let __verify = null;
export function __setVerify(fn) { __verify = fn; }

const TAU = Math.PI * 2; // (as perception.js: walkerSees works out a head's cone exactly as pointInCone does)
const TURN = 3; // s: at a halt he turns to its look over a couple of seconds (until then he may face the way he came)

/** The guards whose cones count (alive, seeing, not knocked out, reacting). */
/**
 * canSee, and for a rowed boat's hull probe (dummyAt 'boat'): seen whenever it lies in the cone, any band, in the
 * line of sight (ai/director _rowedBoats → vehicle-ai canSeeVehicle), whoever sits in it.
 */
function canSee(e, d, w, o = {}) {
  const r = canSee0(e, d, w, o);
  if (r !== 'none' || !d?.hull) return r;
  const cone = o.cone ?? coneAt(e, w.time);
  if (!cone || !pointInCone(cone, d.x, d.z)) return 'none';
  return w.grid.lineOfSight(e.x, e.z, d.x, d.z, { viewerElevated: !!e.vision?.elevated, ownHull: e.ownHull }) ? 'far' : 'none';
}

/**
 * Run `fn` with the line-of-sight layer stamped without the vehicles that will not stay where they are (rail
 * vehicles on their schedule, anything under way or ordered somewhere): the planners look ahead, and a tram standing
 * between a guard and a man now may be gone when the guard looks. Restamped as the game has it afterwards.
 * (A rail vehicle's own path / goal are its track: it is a mover by its schedule, unless it stands `keep` s more.)
 */
export function withoutMovers(w, fn, { keep = 0 } = {}) {
  // (`keep` s: a rail vehicle standing at a stop that long yet still hides what is behind it)
  const stays = (v) => keep > 0 && (v.speed || 0) < 0.05 && (v.waitT || 0) >= keep;
  const movers = new Set((w.vehicles || []).filter((v) => (v.def?.rail && !stays(v)) || (!v.def?.rail && ((v.speed || 0) > 0.05 || v.goal || v.path))));
  if (!movers.size || !w.grid?.clearDynamic) return fn();
  w.grid.clearDynamic();
  for (const e of w.entities) if (!e.removed && e.stampOccluder && !movers.has(e)) e.stampOccluder(w.grid);
  try { return fn(); } finally { w.refreshDynamicOccluders(); }
}

export function viewersOf(w) {
  const out = w.enemies.filter((e) => e.alive && !e.removed && e.vision && !e.incapacitated && e.brain?.arch?.reacts !== false);
  // (`w.sneakVehicleEyes`, opt-in) an armed crewed vehicle with its own cone (M2's patrol boat: vehicle-ai spotCommando)
  // sees too: its eye (viewerFor) is a viewer, predicted along its route (predictVehicle)
  if (w.sneakVehicleEyes) for (const v of w.vehicles || []) if (v.vision && !v.removed && !v.destroyed && !v.driver && v.crewed && v.def?.weapons?.length) out.push(vehicleEye(v));
  return out;
}

/** A vehicle's eye as a viewer: the live proxy (vehicle-ai viewerFor) plus a tag and a stable id for the planners. */
function vehicleEye(v) {
  return Object.assign(Object.create(viewerFor(v)), { tag: v.tag ?? v.spawn?.id ?? `veh${v.id}`, id: `veh${v.id}`, vehEye: true, vehicle: v });
}

/**
 * Where vehicle `v` driving its route will be (and face) `t` s from now: the rest of its wait, then waypoint to
 * waypoint (its path, then the route on: PINGPONG / LOOP as its brain advances it), pivoting at its turn rate where the
 * route turns sharply, at its route speed, with each waypoint's wait. Approximate (no acceleration, bends taken on the
 * spot): about a metre off on a 2.5 m/s boat — callers pad.
 */
export function predictVehicle(v, t) {
  const b = v.brain, R = b?.route;
  const sp = v.maxSpeed || R?.speed || v.def?.slow || 2.5, rate = v.def?.turn || Math.PI / 4; // (def.turn: rad/s)
  let x = v.x, z = v.z, h = v.heading, left = t;
  const wt = Math.max(0, v.waitT || 0);
  if (left <= wt) return { x, z, heading: h };
  left -= wt;
  const queue = v.path ? v.path.slice(v.pathIndex ?? 0) : [];
  if (R && b?.state === 'route') {
    let dir = b.dir ?? 1;
    for (let k = 0; k < 4; k++) {
      if (R.type === 'PINGPONG') { dir = -dir; queue.push(...(dir > 0 ? R.points : [...R.points].reverse()).slice(1)); }
      else if (R.type === 'LOOP') queue.push(...R.points);
    }
  }
  for (const p of queue) {
    const dx = p.x - x, dz = p.z - z, L = Math.hypot(dx, dz);
    if (L > 1e-3) {
      const want = Math.atan2(dz, dx), dh = Math.atan2(Math.sin(want - h), Math.cos(want - h));
      const tt = Math.abs(dh) > 0.35 ? Math.abs(dh) / rate : 0;
      // (an about-turn may go either way round: `alt`, the other way)
      if (left <= tt) return { x, z, heading: h + Math.sign(dh) * rate * left, ...(Math.abs(dh) > 2.8 ? { alt: h - Math.sign(dh) * rate * left } : null) };
      left -= tt; h = want;
      if (left * sp <= L) return { x: x + (dx / L) * left * sp, z: z + (dz / L) * left * sp, heading: h };
      left -= L / sp; x = p.x; z = p.z;
    }
    if (p.wait > 0) { if (left <= p.wait) return { x, z, heading: h }; left -= p.wait; }
  }
  return { x, z, heading: h };
}

/** Metres left on a walking unit's current path. */
function pathLeft(u) {
  let L = 0, x = u.x, z = u.z;
  for (const p of u.path ? u.path.slice(u.pathIndex ?? 0) : []) { L += Math.hypot(p.x - x, p.z - z); x = p.x; z = p.z; }
  return L;
}

/** Where a walking unit will be after `dist` m along its current path (then straight on, or stopped at its end). */
function alongPath(u, dist, stopAtEnd = false) {
  let x = u.x, z = u.z, h = u.heading;
  const pts = u.path ? u.path.slice(u.pathIndex ?? 0) : [];
  for (const p of pts) {
    const dx = p.x - x, dz = p.z - z, L = Math.hypot(dx, dz);
    if (L < 1e-6) continue;
    h = Math.atan2(dz, dx);
    if (dist <= L) return { x: x + (dx / L) * dist, z: z + (dz / L) * dist, heading: h };
    dist -= L; x = p.x; z = p.z;
  }
  if (stopAtEnd) return { x, z, heading: h };
  return { x: x + Math.cos(h) * dist, z: z + Math.sin(h) * dist, heading: h };
}

/** the leader's predicted place, memoised per sim time (trailPoint walks back along it in small steps) */
const leadMemo = new WeakMap();
function leadAt(lead, s) {
  const now = lead.world?.time ?? 0;
  let m = leadMemo.get(lead);
  if (!m || m.now !== now) leadMemo.set(lead, (m = { now, at: new Map() }));
  const k = Math.round(s * 20);
  let q = m.at.get(k);
  if (!q) m.at.set(k, (q = k <= 0 ? { x: lead.x, z: lead.z, heading: lead.heading } : predict(lead, k / 20, 1)));
  return q;
}

/**
 * Where file man `e` will be `t` s from now (`w.sneakTrail`): his slot, rank × squadSpacing behind the leader along
 * the way the leader will have walked (his predicted beat, then the squad's recorded breadcrumbs), facing the way the
 * file walks there. Null when his rank is unknown.
 */
function trailPoint(e, lead, t) {
  const w = e.world, mates = e.brain?._mates?.(lead) || [], k = mates.indexOf(e);
  if (k < 0) return null;
  const want = (k + 1) * (CONFIG.ai?.squadSpacing ?? 1.2);
  const q = leadAt(lead, t);
  let acc = 0, prev = q;
  const hit = (p) => {
    const seg = Math.hypot(p.x - prev.x, p.z - prev.z);
    if (acc + seg < want) { acc += seg; prev = p; return null; }
    const f = seg > 0 ? (want - acc) / seg : 0;
    return { x: prev.x + (p.x - prev.x) * f, z: prev.z + (p.z - prev.z) * f, heading: seg > 1e-6 ? Math.atan2(prev.z - p.z, prev.x - p.x) : q.heading, halt: q.halt };
  };
  // back along the leader's predicted way to now (at most 30 s of it: a long halt of his only bunches the file up)
  for (let s = t - 0.1; s > Math.max(0, t - 30) - 1e-9; s -= 0.1) { const r = hit(leadAt(lead, s)); if (r) return r; }
  if (t > 30) return { x: prev.x, z: prev.z, heading: q.heading };
  const r0 = hit({ x: lead.x, z: lead.z }); if (r0) return r0;
  // then the breadcrumbs he has left (newest first)
  const sq = w?.ai?.squads?.get(e.squad.id);
  for (const p of sq?.trail || []) { const r = hit(p); if (r) return r; }
  return { x: prev.x - Math.cos(lead.heading) * (want - acc), z: prev.z - Math.sin(lead.heading) * (want - acc), heading: lead.heading };
}

/**
 * Per-walker records of this planner (his legs' ways, where he was seen halting), kept beside him, not on him: a field
 * first added to an enemy mid-walkthrough reshaped him (V8) and threw away the optimised code of everything that
 * handles units. Read as a field would be: a ghost of him (ghost.mjs: protoOf leads from his mirror to him) sees his
 * record until it gets its own.
 */
const LEGS = new WeakMap(), HALTS = new WeakMap();
const sideOf = (M, e) => { for (let o = e; o && typeof o === 'object'; o = protoOf(o)) if (M.has(o)) return M.get(o); return undefined; };

/**
 * Where enemy `e` will be (and face) `t` s from now. A man on his route (IDLE / REINFORCE / RETURN) is walked along it
 * — the rest of his current path, then waypoint to waypoint with each halt's wait and look (LOOP / PINGPONG as the
 * brain advances it); at a halt he may still face the way he came for its first seconds (`alt`). A squad member keeps
 * his offset to his leader and reaches each turn as far behind him as he walks now. Anyone else walking keeps to his
 * path and stops at its end (a lure, a body, a noise); a man standing still keeps his place and heading.
 */
/**
 * (`w.sneakPaths`) The way walker `e` takes to route point `i`: from route point `from` (null: from where he is now —
 * the rest of his present path when it ends there), as [[x, z]...] ending where the way ends (on the point, or as near
 * it as the nav lets him: where he halts), or null (straight). Legs
 * between route points are planned once per grid version (World.findPath with his own path query).
 */
function legWay(e, from, i) {
  const r = e.route, wp = r[i], w = e.world;
  if (from == null) {
    const P = e.path, end = P?.[P.length - 1];
    if (!P || !end || Math.hypot(end.x - wp.x, end.z - wp.z) > 1.2) return null;
    return P.slice(e.pathIndex ?? 0).map((p) => [p.x, p.z]);
  }
  const ver = w.grid?.version ?? 0;
  let L = sideOf(LEGS, e);
  if (!L || L.ver !== ver) LEGS.set(e, (L = { ver, m: new Map() }));
  const k = `${from}>${i}`;
  if (!L.m.has(k)) {
    const a = r[from], q = e.pathQuery?.() ?? {};
    // (`w.sneakOwnPaths`, opt-in: the way his own move order plans — Unit.planFrom: round the clearance masks of the
    // solids the game draws, which the plain search walks through: in the game M20's Patrol 57 went round a wagon)
    const p = w.sneakOwnPaths && typeof e.planFrom === 'function' ? e.planFrom(a.x, a.z, wp.x, wp.z) : w.findPath?.(a.x, a.z, wp.x, wp.z, q);
    // (ending where the way ends: a point the nav keeps him off — a mesh's clearance — he halts short of, WP_NEAR)
    L.m.set(k, p && p.length > 1 ? p.slice(1).map((n) => [n.x, n.z]) : null);
  }
  return L.m.get(k);
}

export function predict(e, t, depth = 0) {
  if (e.vehEye) { // a vehicle's eye: along its route, `mount` m ahead of its centre (viewerFor)
    const q = predictVehicle(e.vehicle, t), m = e.vehicle.def?.turret ? 0 : (e.vehicle.def?.mount || 0);
    return { x: q.x + Math.cos(q.heading) * m, z: q.z + Math.sin(q.heading) * m, heading: q.heading, alt: q.alt };
  }
  const b = e.brain, r = e.route;
  // (`w.sneakHeel`, opt-in) a dog heeling its living handler keeps 1.5 m behind him (enemy-brain _heel), not straight on
  const hd = e.world?.sneakHeel && e.spawn?.handler != null && depth < 2 ? e.world.byId?.(e.spawn.handler) : null;
  if (hd?.alive && b?.state === 'IDLE') {
    const q = predict(hd, t, depth + 1);
    return { x: q.x - Math.cos(q.heading) * 1.5, z: q.z - Math.sin(q.heading) * 1.5, heading: q.heading, alt: q.alt, halt: q.halt };
  }
  const lead = depth === 0 && b?._leader?.();
  // (`w.sneakTrail`, opt-in) a file man walks the leader's breadcrumbs (enemy-brain _followPoint): he will be his
  // rank × squadSpacing behind the leader ALONG the leader's way — round a corner too, where the present offset is off
  if (lead && lead !== e && lead.alive && b.state !== 'DISTRACTED' && b.state === lead.brain?.state && e.world?.sneakTrail
    && (e.squad?.columns || 1) === 1 && ['IDLE', 'REINFORCE', 'RETURN'].includes(b.state)) {
    const q = trailPoint(e, lead, t);
    if (q) return q;
  }
  if (lead && lead !== e && lead.alive && b.state !== 'DISTRACTED' && b.state === lead.brain?.state) {
    const lag = Math.hypot(e.x - lead.x, e.z - lead.z) / (lead.speed ?? 1.0);
    const q = predict(lead, t, 1), ql = t > lag ? predict(lead, t - lag, 1) : { heading: e.heading };
    // (`w.sneakFileHalt`, opt-in) a file man walking behind his walking leader looks ahead as the leader does (only at
    // a halt does his head sweep: walkerViews' amplitude follows the leader's halt flag, not the man's own sweep)
    return { x: q.x + (e.x - lead.x), z: q.z + (e.z - lead.z), heading: ql.heading, ...(e.world?.sneakFileHalt ? { halt: q.halt } : {}) };
  }
  const ROUTE_STATES = ['IDLE', 'REINFORCE', 'RETURN'];
  // a file whose leader is off his beat (drawn to a lure, searching...) holds round him: where he goes, they go
  if (lead && lead !== e && lead.alive && ROUTE_STATES.includes(b.state) && !ROUTE_STATES.includes(lead.brain?.state)) {
    if (e.isMoving || e.path) return alongPath(e, (e.speed ?? 1.0) * t, true); // still closing up on him
    const q = predict(lead, t, 1);
    return { x: q.x + (e.x - lead.x), z: q.z + (e.z - lead.z), heading: e.heading };
  }
  const sp = e.speed ?? 1.0;
  const onRoute = r && r.length > 1 && b && ROUTE_STATES.includes(b.state) && !b.distractedBy;
  // (`w.sneakReturnOn`) a man on his beat or round whose path leads elsewhere (a squad running to an alarm, a patrol
  // sent to a blast) follows that path, at his pace (running), and stops at its end
  if (onRoute && e.world?.sneakReturnOn && b.state !== 'RETURN' && (e.isMoving || e.path) && e.path?.length) {
    const end = e.path[e.path.length - 1], wp = r[b.routeIndex ?? 0];
    if (wp && Math.hypot(end.x - wp.x, end.z - wp.z) > 2) return alongPath(e, sp * t, true);
  }
  // walking back to his beat (RETURN) he follows his path to it first; then (`w.sneakReturnOn`) on along his beat
  let t0 = 0, p0 = null;
  if (b?.state === 'RETURN' && (e.isMoving || e.path)) {
    const Lp = pathLeft(e);
    if (!onRoute || !e.world?.sneakReturnOn || sp * t <= Lp) return alongPath(e, sp * t, true);
    p0 = alongPath(e, Lp, true); t0 = Lp / sp;
  }
  if (!onRoute) {
    if (e.isMoving || e.path) return alongPath(e, sp * t, b && b.state !== 'IDLE' && b.state !== 'REINFORCE' && b.state !== 'RETURN');
    return { x: e.x, z: e.z, heading: e.heading };
  }
  let x = p0?.x ?? e.x, z = p0?.z ?? e.z, h = p0?.heading ?? e.heading, left = t - t0;
  let i = b.routeIndex ?? 0, dir = b.routeDir ?? 1;
  const loop = (b._routeType || e.spawn?.route?.type || e.routeMode || 'PINGPONG').toUpperCase() === 'LOOP' || e.routeMode === 'loop';
  const loopStart = b._loopStart ?? 0;
  const waitLeft = b.atWait && !p0 ? Math.max(0, b.waitT ?? 0) : 0;
  const halt = (wp, into) => (wp?.look != null ? { x, z, heading: (wp.look * Math.PI) / 180, alt: into <= TURN ? h : undefined, halt: true } : { x, z, heading: h, halt: true });
  let prevWait = null;
  if (waitLeft > 0) {
    const wp = r[i];
    if (left <= waitLeft) return halt(wp, left + Math.max(0, (wp?.wait ?? 0) - waitLeft));
    if (wp?.look != null) h = (wp.look * Math.PI) / 180;
    left -= waitLeft; prevWait = i; i = nextIdx(i);
  }
  // (`w.sneakPaths`, opt-in) he walks each leg along the pathfinder's way (his present path on this one), not straight
  // from point to point: round the corners the game's nav makes him take (its mesh clearances in the browser)
  const paths = !!e.world?.sneakPaths;
  // (and halts where he was last seen halting at that point: the game's own planner may stop him a little short of it)
  if (paths && b.atWait && Math.hypot(e.x - r[b.routeIndex ?? 0].x, e.z - r[b.routeIndex ?? 0].z) < 1.5) { let hs = sideOf(HALTS, e); if (hs == null) HALTS.set(e, (hs = {})); hs[b.routeIndex ?? 0] = [e.x, e.z]; }
  let prev = null;
  for (let guard = 0; guard < 64; guard++) {
    const wp = r[i];
    const pts = paths ? legWay(e, guard === 0 ? prevWait : prev, i) : null;
    if (pts) {
      let h0 = h, tLeg = 0;
      for (const [px, pz] of pts) {
        const dx = px - x, dz = pz - z, L = Math.hypot(dx, dz);
        if (L <= 1e-6) continue;
        const hp = h; h = Math.atan2(dz, dx);
        if (tLeg > 0) h0 = hp; // (at a corner of the way he turns from the last stretch's heading)
        if (left * sp <= L) return { x: x + (dx / L) * left * sp, z: z + (dz / L) * left * sp, heading: h, halt: false, turnFrom: h0, turnT: left };
        left -= L / sp; tLeg += L / sp; x = px; z = pz;
      }
      const hs = sideOf(HALTS, e)?.[i];
      if (hs && Math.hypot(hs[0] - x, hs[1] - z) < 1.5) { x = hs[0]; z = hs[1]; }
    } else {
      const dx = wp.x - x, dz = wp.z - z, L = Math.hypot(dx, dz);
      if (L > 1e-6) {
        // (setting off on a leg he turns to it at his body's rate: `turnFrom`, `turnT` s into the leg — walkerSees)
        const h0 = h;
        h = Math.atan2(dz, dx);
        if (left * sp <= L) return { x: x + (dx / L) * left * sp, z: z + (dz / L) * left * sp, heading: h, halt: false, turnFrom: h0, turnT: left };
        left -= L / sp; x = wp.x; z = wp.z;
      }
    }
    prev = i;
    if (wp.wait > 0) { if (left <= wp.wait) return halt(wp, left); if (wp.look != null) h = (wp.look * Math.PI) / 180; left -= wp.wait; }
    i = nextIdx(i);
  }
  return { x, z, heading: h };
  function nextIdx(k) {
    if (loop) return k + 1 < r.length ? k + 1 : Math.min(loopStart, r.length - 1);
    if (k + dir >= r.length || k + dir < 0) dir *= -1;
    return k + dir;
  }
}

/**
 * A cry (`w.sneakCries`: [{t: sim time, x, z, r}]): every man within earshot turns to it from then on, the short way
 * round (both ways for an about-turn), his eyes sweeping whatever lies between: the headings to try for him.
 */
function cryHeadings(q, w, tAbs) {
  const out = [];
  for (const c of w.sneakCries || []) {
    if (tAbs < c.t || Math.hypot(q.x - c.x, q.z - c.z) > c.r) continue;
    const to = Math.atan2(c.z - q.z, c.x - q.x), d = Math.atan2(Math.sin(to - q.heading), Math.cos(to - q.heading)), ad = Math.abs(d);
    for (const sg of ad > Math.PI - 0.3 ? [1, -1] : [Math.sign(d) || 1]) {
      const full = Math.sign(d) === sg ? ad : 2 * Math.PI - ad;
      for (let a = 0.2; a < full; a += 0.2) out.push(q.heading + sg * a);
    }
    out.push(to);
  }
  return out;
}

/** An enemy's body turns at units.enemyTurnRate (rad/s), the short way round. */
const TURN_RATE = CONFIG.units?.enemyTurnRate ?? Math.PI;
/**
 * The headings a walker setting off on a new leg may face while he turns to it (`q.turnFrom` → q.heading, `q.turnT` s
 * into the leg, ± 0.4 s of timing): from a halt facing away he swings his eyes across everything in between (e31 turning
 * north at the east end of his beat; e39 south at the west end of his). Both ways round for an about-turn. Opt-in
 * (`w.sneakTurns`: true for everyone, or a Set of the guards' tags it applies to): the stages planned without it were
 * proven with it off.
 */
function turnHeadings(q, w = null) {
  if (q.turnFrom == null) return [];
  const d = Math.atan2(Math.sin(q.heading - q.turnFrom), Math.cos(q.heading - q.turnFrom)), ad = Math.abs(d);
  if (ad < 0.15 || q.turnT > ad / TURN_RATE + 0.4) return [];
  const out = [], a0 = Math.max(0, q.turnT - 0.4) * TURN_RATE, a1 = (q.turnT + 0.4) * TURN_RATE;
  // (a body turns the short way round; within `w.sneakTurnTie` rad of an about-turn (default 0.1) either way is tried)
  for (const sg of ad > Math.PI - (w?.sneakTurnTie ?? 0.1) ? [1, -1] : [Math.sign(d)]) {
    const full = Math.sign(d) === sg ? ad : 2 * Math.PI - ad;
    for (let a = a0; a <= Math.min(full, a1) + 1e-6; a += 0.2) out.push(q.turnFrom + sg * a);
  }
  return out;
}

/**
 * Could walking enemy `e`, predicted at `q` (x, z, heading[, alt]) at sim time `tAbs`, see `dummy`? Conservative: his
 * head is tried at the predicted heading and at both ends of his sweep (and at the heading he came with, at a halt).
 */
export function walkerSees(e, q, dummy, w, tAbs) {
  const v = e.vision, a = v ? v.far ?? v.range : NaN, ratio = v?.ellipseRatio === undefined ? CONFIG.stealth.ellipseRatio : v.ellipseRatio;
  if (e.vehEye || !(a > 0) || (v.elliptical && !(ratio > 0))) return seesAny(walkerViews(e, q, w, tAbs), dummy, w);
  // (the same heads in the same order as walkerViews, each built — a viewer copy and its cone — only when the point lies
  // in its cone, that cone's reach and aperture worked out first exactly as coneAt / pointInCone do for that head: most
  // heads face elsewhere, and building every one was most of a look-ahead's time — M12's "way to the car", ~5 ms a tick)
  const dx = dummy.x - q.x, dz = dummy.z - q.z, d2 = dx * dx + dz * dz;
  // (past the longest reach any head has — an elliptical far a·b/√((b cos θ)² + (a sin θ)²) is at most max(a, b), give or
  // take its rounding — no head's cone holds the point)
  const R = (v.elliptical ? Math.max(a, a * ratio) : a) * (1 + 1e-9);
  if (d2 > R * R) return false;
  const { hds, offs } = headsOf(e, q, w, tAbs);
  const half = v.fov / 2, bear = d2 > 1e-12 ? Math.atan2(dz, dx) : 0;
  const far2 = offs.map((off) => { const f = v.elliptical ? ellipseFar(a, (off || 0) + 0, v.ellipseRatio) : a; return f * f; });
  let maxOff = 0;
  for (const off of offs) maxOff = Math.max(maxOff, Math.abs((off || 0) + 0));
  const lim = half + maxOff + 1e-6;
  let m = null; // (his mirror, refreshed at the first head that needs a ghost: ghost.mjs)
  for (const hd of hds) {
    // (a body heading whose every head offset leaves the point outside the aperture: none of its heads can see it)
    if (d2 > 1e-12) { let an = bear - hd; an -= TAU * Math.round(an / TAU); if (Math.abs(an) > lim) continue; } // (NaN: tried, as pointInCone would)
    for (let k = 0; k < offs.length; k++) {
      if (d2 > far2[k]) continue;
      const off = offs[k];
      if (d2 > 1e-12) {
        let an = bear - (hd + ((off || 0) + 0));
        an -= TAU * Math.round(an / TAU);
        if (Math.abs(an) > half) continue;
      }
      const g = ghostOn(m ??= mirrorOf(e));
      g.x = q.x; g.z = q.z; g.heading = hd; g.sweepActive = false; g.headOffset = off; g.headCarry = 0;
      const cone = coneAt(g, tAbs);
      if (pointInCone(cone, dummy.x, dummy.z) && canSee(g, dummy, w, { cone }) !== 'none') return true;
    }
  }
  return false;
}

/**
 * The heads walkerSees tries for walking enemy `e` predicted at `q` at time `tAbs`, in its order: [viewer, cone, …]
 * (they do not depend on the target, so a planner works them out once per guard and moment). Rules as walkerSees:
 * a vehicle's eye at its predicted heading ± a little; a halted man under `w.sneakHaltExact` where his sweep puts his
 * head; anyone else at the predicted heading and both ends of his sweep (and at a halt the heading he came with).
 */
export function walkerViews(e, q, w, tAbs, m = mirrorOf(e)) {
  const L = [];
  L._oneEye = true; // (seesAny: one guard at one eye)
  const add = (hd, off, sweepless) => {
    const g = ghostOn(m);
    g.x = q.x; g.z = q.z; g.heading = hd;
    if (sweepless) { g.sweepActive = false; g.headOffset = off; g.headCarry = 0; }
    L.push(g, coneAt(g, tAbs));
  };
  if (e.vehEye) { // a vehicle's eye sweeps on its own clock (phase known): its predicted heading, ± a little
    for (const hd of q.alt != null ? [q.heading, q.alt] : [q.heading]) for (const dh of [0, 0.15, -0.15]) add(hd + dh, 0, false);
    return L;
  }
  const { hds, offs } = headsOf(e, q, w, tAbs);
  for (const hd of hds) for (const off of offs) add(hd, off, true);
  return L;
}

/**
 * The sweepless heads walkerViews tries for a man on foot: every body heading of `hds` with every head offset of `offs`
 * (in that order: heading by heading).
 */
function headsOf(e, q, w, tAbs) {
  // a man walking his beat looks straight ahead (the brain sweeps his head only at a halt: patrolWatch); one walking
  // anywhere else, or halted, is tried at both ends of his sweep too (walking men glance about). With
  // `w.sneakHaltExact` (s) a halted man's head is where his sweep puts it at tAbs (its phase is his own and the clock's),
  // ± that much time
  const pw = CONFIG.stealth.vision.patrolWatch;
  if (q.halt && w.sneakHaltExact != null && pw && e.vision) {
    const A = (pw.sweep * Math.PI) / 180, P = pw.period, ph = e.vision.phase || 0, dt = w.sneakHaltExact;
    const offs = [0, -dt, dt, -dt / 2, dt / 2].map((tau) => A * Math.sin((2 * Math.PI * (tAbs + tau + ph)) / P));
    return { hds: [q.heading, ...(q.alt != null ? [q.alt] : []), ...cryHeadings(q, w, tAbs)], offs };
  }
  const amp = (q.halt === false ? (w.sneakWalkAmp ?? 0.25) : (q.halt ? (CONFIG.stealth.vision.patrolWatch?.sweep ?? 50) * Math.PI / 180 : e.sweepAmp ?? e.vision?.sweep ?? 0))
    + (w.sneakMargin ?? 0);
  // (`w.sneakSweepSteps`, opt-in: the head tried at that many even steps each side of the heading, not just half and
  // full sweep — an elliptical cone's near band is longest straight ahead, so a man between two tried heads may be
  // in it while neither tried cone reaches him)
  const n = w.sneakSweepSteps ?? 2, offs = [0];
  if (amp) for (let k = 1; k <= n; k++) offs.push((amp * k) / n, (-amp * k) / n);
  return { hds: [q.heading, ...(q.alt != null ? [q.alt] : []), ...((w.sneakTurns === true || w.sneakTurns?.has?.(e.tag)) ? turnHeadings(q, w) : []), ...cryHeadings(q, w, tAbs)], offs };
}

/** Does any of walkerViews' heads see `d`? (a point outside a cone's geometry is never seen by it: canSee not asked)
 * `m` (optional): every cone inflated by inflateCone(cone, m). */
export function seesAny(L, d, w, m = null) {
  if (L._oneEye && !m) return seesAnyHeads(L, d, w, canSee); // (walkerViews' heads: one guard at one eye, asked once)
  for (let i = 0; i < L.length; i += 2) { const cone = m ? inflateCone(L[i + 1], m) : L[i + 1]; if (pointInCone(cone, d.x, d.z) && canSee(L[i], d, w, { cone }) !== 'none') return true; }
  return false;
}

/**
 * A cone widened by `m` = [deg, metres] (half-aperture + deg, both bands + metres): planners sample the cones every
 * 0.1–0.2 s, and a fast sweep's edge (an elliptical band shrinking as the head swings out) crosses a spot in a tick or
 * two between samples; the widened cone covers what the real one sweeps over meanwhile.
 */
export function inflateCone(cone, m) {
  if (!cone || !m) return cone;
  return { ...cone, halfFov: cone.halfFov + (m[0] * Math.PI) / 180, near: cone.near + m[1], far: cone.far + m[1] };
}

/** A guard on the move, or one with a route he walks (a man staring at a lure stands still). */
const lastMoved = new WeakMap();
export function walking(e) {
  if (e.vehEye) return true;
  const b = e.brain, now = e.world?.time ?? 0;
  if (e.isMoving || e.path || b?.atWait || !lastMoved.has(e)) lastMoved.set(e, now);
  // (opt-in `w.sneakStillStatic`: a posted man (no beat) standing still on his post again — back from a look, a few
  // steps off his spot, a stale path left over — is a post: his own sweep, not a walker's glances)
  if (e.world?.sneakStillStatic && !e.isMoving && !(e.route?.length > 1) && b?.state === 'IDLE') return false;
  if (e.isMoving || e.path) return true;
  // a file man standing by his leader while the leader is off the beat (at a lure...): he stands, his cone is his own
  const lead = b?._leader?.();
  if (lead && lead !== e && lead.alive && !['IDLE', 'REINFORCE', 'RETURN'].includes(lead.brain?.state)) return false;
  // standing still with no path and no halt on his beat: stuck (a man held up at a wire's end): he stands, as he is
  if (b && !b.atWait && now - lastMoved.get(e) > 3) return false;
  return !!(e.route?.length > 1 && ['IDLE', 'REINFORCE', 'RETURN'].includes(b?.state) && !b?.distractedBy);
}

/**
 * A post turned aside (by a noise, a lure, a turn under way) may swing back to his post meanwhile, or on to where he is
 * turning: the headings to try for him (just his own when he stands square to his post).
 */
export function postHeadings(e) {
  const ph = e.post?.heading;
  if (ph == null) return null;
  // (opt-in `w.sneakLures`: a post turned to a decoy still pulsing within his hearing keeps facing it — each pulse
  // holds him round for another 8 s; he turns back only once it stops)
  if (e.world?.sneakLures && e.brain?.noiseTurnT > 0 && !e.brain?.turn
    && e.world.interactables?.some((d) => d.interactKind === 'decoy' && d.on && !d.removed && Math.hypot(d.x - e.x, d.z - e.z) <= 13.5)) return [e.heading];
  const tg = e.brain?.turn ? e.brain._turnGoal?.() : null;
  const off = Math.abs(Math.atan2(Math.sin(e.heading - ph), Math.cos(e.heading - ph)));
  if (tg == null && !(e.brain?.noiseTurnT > 0) && off <= 0.1) return null;
  const mid = (a, b) => Math.atan2(Math.sin(a) + Math.sin(b), Math.cos(a) + Math.cos(b));
  return [e.heading, ph, mid(e.heading, ph), ...(tg != null ? [tg, mid(e.heading, tg)] : [])];
}

/** canSee for a standing (not walking) viewer at time t, every heading a turned post may face. */
export function staticSees(e, d, w, t) {
  // (past the longest reach his cone has at any head offset — see walkerSees — no heading of his sees the point)
  const v = e.vision, a = v ? v.far ?? v.range : NaN, ratio = v?.ellipseRatio === undefined ? CONFIG.stealth.ellipseRatio : v.ellipseRatio;
  const ch = cryHeadings(e, w, w.time + t), hs = postHeadings(e);
  if (a > 0 && (!v.elliptical || ratio > 0)) {
    const R = (v.elliptical ? Math.max(a, a * ratio) : a) * (1 + 1e-9), dx = d.x - e.x, dz = d.z - e.z, d2 = dx * dx + dz * dz;
    if (d2 > R * R) return false;
    // (nor when no heading he may face — his post's, a turn's, a cry's — brings the point within his aperture, however
    // his head sweeps: the cone's heading is that heading + his head offset ± his sweep's amplitude)
    const half = v.fov / 2, base = (e.headOffset || 0) + (e.headCarry || 0);
    const sw = e.sweepActive ? Math.abs((e.sweepW ?? 1) * (e.sweepAmp ?? v.sweep ?? 0)) : 0;
    if (d2 > 1e-12 && Number.isFinite(half + base + sw)) {
      const bear = Math.atan2(dz, dx), lim = half + sw + 1e-6;
      const within = (h, l) => { let an = bear - h; an -= TAU * Math.round(an / TAU); return !(Math.abs(an) > l); }; // (NaN: within, as pointInCone)
      if (!ch.some((h) => within(h, half + 1e-6)) && !(hs ? hs.some((h) => within(h + base, lim)) : within(e.heading + base, lim))) return false;
    }
  }
  const m = ch.length || hs ? mirrorOf(e) : null; // (his ghosts read him through a mirror: ghost.mjs)
  if (ch.length && ch.some((h) => { const g = ghostOn(m); g.heading = h; g.sweepActive = false; g.headOffset = 0; g.headCarry = 0; return canSee(g, d, w, { cone: coneAt(g, w.time + t) }) !== 'none'; })) return true;
  if (!hs) return canSee(e, d, w, { cone: coneAt(e, w.time + t) }) !== 'none';
  return hs.some((h) => { const g = ghostOn(m); g.heading = h; return canSee(g, d, w, { cone: coneAt(g, w.time + t) }) !== 'none'; });
}

/** A deck over water (a pier, a moored hull's deck, a bridge): dry footing for a man, whatever the terrain under it. */
function onDeck(g, x, z) { const { i, j } = g.worldToCell(x, z); return g.inBounds(i, j) && !!g.bridge?.[g.idx(i, j)]; }

/** Target dummies: a man ('crawl' low, 'walk'/'stand' upright), a boat (open, the men seated in it), a body. */
export function dummyAt(w, mode, x, z) {
  if (mode === 'boat') return { x, z, y: 0, state: 'inVehicle', vehicle: { isOpenBoat: true, def: { seated: true, occludes: false } }, isVisibleToEnemies: true, alive: true, hull: true };
  if (mode === 'body') return { x, z, y: w.grid.elevAt?.(x, z) ?? 0, kind: 'body' };
  return { x, z, y: w.grid.elevAt?.(x, z) ?? 0, isLow: mode === 'crawl', isVisibleToEnemies: true, alive: true, kind: 'commando' };
}

/** Half the boat's length + a margin: a guard sees a rowed boat by its hull edge nearest him (ai/director _rowedBoats). */
export const HULL = 2.1;
/** The target dummy for viewer position (vx, vz): a boat's is its hull edge nearest the viewer. */
function dummyFor(w, mode, x, z, vx, vz) {
  if (mode !== 'boat') return dummyAt(w, mode, x, z);
  const d = Math.hypot(vx - x, vz - z) || 1, f = Math.min(HULL, d * 0.5) / d;
  return dummyAt(w, mode, x + (vx - x) * f, z + (vz - z) * f);
}

/** A band-edge probe keeps the height of the point it stands for (a step nearer, not up on a roof edge). */
function padded(d, y0) { if (d.state !== 'inVehicle') d.y = y0; return d; }

/** Is a squad man wheeling round at time step `t` (his leader's heading turns > 1 rad within ±3 s)? */
export function wheeling(e, t) {
  if (e.squad?.id == null || e.brain?._leader?.() === e) return false;
  // (`w.sneakPaths`) at the leader's halt the file men step up beside him (enemy-brain _besidePoint), facing any way
  const L = e.brain?._leader?.();
  if (e.world?.sneakPaths && L && L !== e && L.alive && [0, -2, 2].some((o) => predict(L, Math.max(0, t + o)).halt)) return true;
  const a = predict(e, Math.max(0, t - 3)).heading, b = predict(e, t + 3).heading;
  let dh = Math.abs(a - b) % (2 * Math.PI); if (dh > Math.PI) dh = 2 * Math.PI - dh;
  return dh > 1;
}

/**
 * Will nobody see a man (mode 'crawl' / 'walk'), a boat ('boat') or a body ('body') at any of `pts` during the next
 * `dur` s? Posted men by their predicted sweep, walkers along their predicted beat (every glance of the head), squad
 * men wheeling round at a turn at any heading. `except`: guards left out (the victim of a kill); `why`: who sees.
 */
export function clearFor(D, pts, dur = 2, { mode = 'walk', except = null, why = null, step = 0.1, keepWalker = 0 } = {}) {
  const w = D.world;
  for (const e of viewersOf(w)) {
    if (except?.includes?.(e)) continue;
    const far = (e.vision.far ?? 36) + 1;
    const moving = walking(e);
    for (const [x, z] of pts) {
      if (Math.hypot(e.x - x, e.z - z) > far + (mode === 'boat' ? HULL : 0) + (moving ? (e.vehEye ? 3 : 1.2) * dur + 2 : 0)) continue;
      for (let t = 0; t <= dur + 1e-6; t += step) {
        let seen;
        if (moving) {
          const q = predict(e, t), d = dummyFor(w, mode, x, z, q.x, q.z);
          seen = (keepWalker && Math.hypot(q.x - x, q.z - z) < keepWalker) || walkerSees(e, q, d, w, w.time + t)
            || (wheeling(e, t) && [0, 1, 2, 3, 4, 5, 6, 7].some((r) => walkerSees(e, { ...q, heading: (r * Math.PI) / 4 }, d, w, w.time + t)));
        } else seen = staticSees(e, dummyFor(w, mode, x, z, e.x, e.z), w, t);
        if (seen) { if (why) why.push(`${e.tag}${moving ? '~' : ''}@+${t.toFixed(1)}(${x.toFixed(1)},${z.toFixed(1)})`); return false; }
      }
    }
  }
  return true;
}

/**
 * Would a man (mode 'crawl' / 'walk') or a boat ('boat') going along `pts` from `from` (default: where he is) at
 * `speed` m/s, setting off in `delay` s, stay unseen? Each sample is tried at the moment he passes it (± `slack` s).
 * `wheel: false` drops the squad men's any-heading turn at the corners of their rounds (for a caller that has checked
 * how a given squad really turns).
 */
export function routeClear(D, pts, o = {}) {
  const it = routeClearGen(D, pts, o);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}

/** routeClear as a generator (the same answer; it yields every few looks: a sliced wait hands the frame back). */
export function* routeClearGen(D, pts, { mode = 'walk', from, speed, delay = 0, step = 0.75, slack = 0.5, slackRate = 0, hold = 0, why = null, except = null, keepWalker = 4, pad = 0, hint = null, wheel = true } = {}) {
  const w = D.world;
  const sp = speed ?? (mode === 'boat' ? 2.5 : mode === 'crawl' ? 0.9 : 1.5);
  let [x, z] = from ?? (() => { throw new Error('routeClear: from'); })();
  let t = delay;
  const samples = [[x, z, t]];
  for (const [px, pz] of pts) {
    const L = Math.hypot(px - x, pz - z), n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) samples.push([x + ((px - x) * k) / n, z + ((pz - z) * k) / n, t + (L * k) / n / sp]);
    t += L / sp; x = px; z = pz;
  }
  // (`hold` s: he lies on at the end of the way that long, waiting for what comes next)
  for (let h = 0.5; h <= hold + 1e-6; h += 0.5) samples.push([x, z, t + h]);
  /** Where viewer `e` sees him (the `why` entry), or null. */
  let looks = 0;
  const seenBy = function* seenBy(e, moving) {
    const far = (e.vision.far ?? 36) + 1;
    // (a post sweeping his head may swing his cone across a point within half a second: finer steps for him)
    const ostep = Math.min(!moving && e.sweepActive ? 0.15 : 0.5, Math.max(0.1, slack));
    for (const [sx, sz, st] of samples) {
      // (`slackRate`: the farther ahead, the less sure the timing: slack + slackRate s per s ahead)
      const sl = slack + slackRate * st;
      for (let o = -sl; o <= sl + 1e-6; o += ostep) {
        if ((++looks & 15) === 0) yield;
        const tt = Math.max(0, st + o), hull = mode === 'boat' ? HULL : 0;
        let seen;
        // (`pad`: a man at the very edge of a band may be a step nearer than planned: the point `pad` m nearer too)
        const near = (vx, vz) => { const d = Math.hypot(vx - sx, vz - sz); return pad && d > pad ? [sx + ((vx - sx) * pad) / d, sz + ((vz - sz) * pad) / d] : null; };
        if (moving) {
          const q = predict(e, tt), dd = Math.hypot(q.x - sx, q.z - sz);
          if (dd > far + hull + pad) continue;
          const p2 = near(q.x, q.z);
          seen = dd < keepWalker || walkerSees(e, q, dummyFor(w, mode, sx, sz, q.x, q.z), w, w.time + tt)
            || (p2 && walkerSees(e, q, padded(dummyFor(w, mode, p2[0], p2[1], q.x, q.z), w.grid.elevAt?.(sx, sz) ?? 0), w, w.time + tt))
            // a squad man wheeling round at a corner of its round may face any way
            || (wheel && wheeling(e, tt) && [0, 1, 2, 3, 4, 5, 6, 7].some((r) => walkerSees(e, { ...q, heading: (r * Math.PI) / 4 }, dummyFor(w, mode, sx, sz, q.x, q.z), w, w.time + tt)));
        } else {
          if (Math.hypot(e.x - sx, e.z - sz) > far + hull + pad) continue;
          const p2 = near(e.x, e.z);
          seen = staticSees(e, dummyFor(w, mode, sx, sz, e.x, e.z), w, tt)
            || (!!p2 && staticSees(e, padded(dummyFor(w, mode, p2[0], p2[1], e.x, e.z), w.grid.elevAt?.(sx, sz) ?? 0), w, tt));
        }
        if (seen) return `${e.tag}@(${sx.toFixed(1)},${sz.toFixed(1)})+${tt.toFixed(1)}`;
      }
    }
    return null;
  };
  if (!hint) {
    for (const e of viewersOf(w)) {
      if (except?.includes?.(e)) continue;
      const r = yield* seenBy(e, walking(e));
      if (r) { why?.push(r); return false; }
    }
    return true;
  }
  // `hint` ({e}: kept by the caller from one call to the next): the guard who saw him last time is asked first — a wait
  // for a gap re-asks the same question every tick, and its answer is the same whoever is asked first (every guard is
  // looked at — walking(): his last-moved time — before any is asked, so that bookkeeping does not depend on who saw).
  // A tick of M12's "way to the car" was a full pass over every guard but the one who sees, ~4 ms.
  const views = viewersOf(w).filter((e) => !except?.includes?.(e)), moving = new Map();
  for (const e of views) moving.set(e, walking(e));
  if (w.sneakPaths) for (const e of views) if (moving.get(e)) predict(e, 0); // (and where each walker halts: predict's halt record)
  if (hint.e && moving.has(hint.e)) { const r = yield* seenBy(hint.e, moving.get(hint.e)); if (r) { why?.push(r); return false; } }
  for (const e of views) {
    if (e === hint.e) continue;
    const r = yield* seenBy(e, moving.get(e));
    if (r) { hint.e = e; why?.push(r); return false; }
  }
  return true;
}

/**
 * Would killing `victim` now go unseen? Nobody else sees him fall (the §4.3 kill check: a body, falling, full cone) or
 * sees the killer, now and `ahead` s from now (the blow lands a moment after the order).
 */
export function unwitnessed(D, victim, killer, { ahead = 0.4, at = 0, why = null, except = [], strict = false } = {}) {
  const w = D.world;
  for (const e of viewersOf(w)) {
    if (e === victim || except.includes(e)) continue;
    if (Math.hypot(e.x - victim.x, e.z - victim.z) > (e.vision.far ?? 36) + 2 && Math.hypot(e.x - killer.x, e.z - killer.z) > (e.vision.far ?? 36) + 2) continue;
    // (`strict`: every 0.2 s, and a walker's head tried at every glance he may give: walkerSees)
    const ts = strict ? Array.from({ length: Math.ceil(ahead / 0.2) + 1 }, (_, k) => at + Math.min(ahead, k * 0.2)) : [at, at + ahead / 2, at + ahead];
    for (const t of ts) {
      const mv = walking(e), q = mv ? predict(e, t) : { x: e.x, z: e.z, heading: e.heading };
      const body = { x: victim.x, z: victim.z, y: victim.y || 0, kind: 'body', falling: true };
      // (`strict`: a post turned aside by a noise may swing back to his post meanwhile: both headings, and half-way)
      const ph = e.post?.heading, tg = strict && !mv && e.brain?.turn ? e.brain._turnGoal?.() : null;
      const turned = strict && !mv && ph != null && (tg != null || e.brain?.noiseTurnT > 0 || Math.abs(Math.atan2(Math.sin(e.heading - ph), Math.cos(e.heading - ph))) > 0.1);
      const mid = (a, b) => Math.atan2(Math.sin(a) + Math.sin(b), Math.cos(a) + Math.cos(b));
      const heads = turned ? [q.heading, ph, mid(q.heading, ph), ...(tg != null ? [tg, mid(q.heading, tg)] : [])] : [q.heading];
      const me = mirrorOf(e); // (his ghosts read him through a mirror: ghost.mjs)
      const seenBy = heads.some((h) => {
        const g = ghostOn(me); g.x = q.x; g.z = q.z; g.heading = h;
        const cone = coneAt(g, w.time + t);
        return canSee(g, body, w, { cone }) !== 'none' || (killer.alive !== false && canSee(g, killer, w, { cone, ignoreDisguise: true }) !== 'none');
      });
      if (seenBy || (strict && mv && (walkerSees(e, q, body, w, w.time + t) || (killer.alive !== false && walkerSees(e, q, killer, w, w.time + t))))) {
        if (why) why.push(`${e.tag}+${t.toFixed(1)}`);
        return false;
      }
    }
  }
  return true;
}

/** Guards that would see a body left at (x, z) within `dur` s (sampled every `step` s); [] = safe. */
export function bodySeen(D, x, z, dur = 120, { step = 0.5, except = [] } = {}) {
  const w = D.world, out = new Set();
  const d = dummyAt(w, 'body', x, z);
  for (const e of viewersOf(w)) {
    if (except.includes(e) || e.vehEye) continue; // (a vehicle's eye looks for men only: vehicle-ai spotCommando)
    const moving = walking(e), far = (e.vision.far ?? 36) + 1;
    for (let t = 0; t <= dur; t += step) {
      if (moving) { const q = predict(e, t); if (Math.hypot(q.x - x, q.z - z) > far) continue; if (walkerSees(e, q, d, w, w.time + t)) { out.add(e.tag); break; } }
      else {
        if (Math.hypot(e.x - x, e.z - z) > far) break;
        if (canSee(e, d, w, { cone: coneAt(e, w.time + t) }) !== 'none') { out.add(e.tag); break; }
        const gc = glanceCone(e, t); // (`w.sneakGlances`: a paired sentry turning to his partner)
        if (gc && pointInCone(gc, x, z) && canSee(e, d, w, { cone: gc }) !== 'none') { out.add(e.tag); break; }
      }
    }
  }
  return [...out];
}

/**
 * (opt-in `w.sneakGlances`) §4.6 partner glance: a sentry with a partner turns to him for CONFIG.ai.partnerGlance.dur s
 * every `.every` s (enemy-brain _partnerGlance; its countdown is brain.glanceT). His cone `t` s from now while he glances
 * (± `pad` s: the turn there and back), else null.
 */
export function glanceCone(e, t, pad = 0.6) {
  const w = e.world, b = e.brain, G = CONFIG.ai?.partnerGlance;
  if (!w?.sneakGlances || !e.partner || !b || b.glanceT == null || !G || b.state !== 'IDLE') return null;
  const p = w.byId?.(e.partner);
  if (!p || !p.alive) return null;
  const cyc = G.every + G.dur;
  // the next glance starts at glanceT (≤ 0: one is on now, it started -glanceT s ago)
  let s0 = b.glanceT;
  let rel = t - s0;
  rel -= Math.floor(rel / cyc) * cyc; // time since the latest glance start (0 ≤ rel < cyc), once t ≥ s0
  if (t < s0 - pad) return null;
  if (!(rel <= G.dur + pad || rel >= cyc - pad)) return null;
  const g = ghost(e);
  g.heading = Math.atan2(p.z - e.z, p.x - e.x); g.sweepActive = false; g.headOffset = 0; g.headCarry = 0;
  return coneAt(g, w.time + t);
}

/**
 * When would a body left at (x, z) raise the alarm, at the earliest (s from now; Infinity: not within `horizon`)? A man
 * holding a post kneels where he stands and cries out ~2 s after he sees it; one on his feet walks over to it first.
 */
/**
 * When the cry would go up over a body left at (x, z) (s from now; Infinity: not within `horizon`), and where from: the
 * finder kneels by it (a post where he stands, anyone else walks to it first), {t, x, z, tag}.
 */
export function alarmEtaInfo(D, x, z, horizon = 30, { step = 0.5, except = [] } = {}) {
  const w = D.world, d = dummyAt(w, 'body', x, z);
  let best = { t: Infinity, x, z, tag: null };
  for (const e of viewersOf(w)) {
    if (except.includes(e) || e.vehEye) continue;
    const moving = walking(e), far = (e.vision.far ?? 36) + 1, post = e.flags?.holdsPost || !e.flags?.investigates;
    for (let t = 0; t <= Math.min(horizon, best.t); t += step) {
      let seen = false, q = null;
      if (moving) { q = predict(e, t); if (Math.hypot(q.x - x, q.z - z) <= far) seen = walkerSees(e, q, d, w, w.time + t); }
      else { if (Math.hypot(e.x - x, e.z - z) > far) break; seen = canSee(e, d, w, { cone: coneAt(e, w.time + t) }) !== 'none'; }
      if (seen) {
        const at = q ?? e, eta = t + 2.2 + (post ? 0 : Math.hypot(at.x - x, at.z - z) / 1.8);
        if (eta < best.t) best = { t: eta, x: post ? at.x : x, z: post ? at.z : z, tag: e.tag };
        break;
      }
    }
  }
  return best;
}
export function alarmEta(D, x, z, horizon = 30, o = {}) { return alarmEtaInfo(D, x, z, horizon, o).t; }

/** Is (x, z) inside polygon `poly` ([[x, z], …])? */
function inPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** The open boat the team rows (the first player boat on the map: raft, rowboat). */
export function teamBoat(w) {
  return (w.vehicles || []).find((v) => !v.removed && !v.destroyed && v.isBoat && !v.crewed && !v.def?.enclosed && v.vehicleType !== 'patrolboat');
}

/**
 * Space-time sneak plan: the fastest chain of 1 m cells from where the man (or the boat) is to (tx, tz) that no cone
 * covers while he is in it — a cell is entered only when it stays clear from `margin[0]` steps before to `margin[1]`
 * after, and he WAITS only where nobody will look. Posted men by their sweep at the future time, walkers along their
 * predicted beat (every glance: walkerSees), never closer than `keepWalker` m (`keepFrom` {tag: r}: than r m to those
 * men). mode: 'boat' (rowed by the Marine),
 * 'crawl' (near band only), 'walk'.
 * @returns {Array<[number, number, number]>|null} [x, z, absolute time] per cell, or null (no way within `horizon` s)
 */
export function planSneak(D, tx, tz, o = {}) {
  const it = planSneakGen(D, tx, tz, o);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}

/** planSneak sliced: the live replay hands the frame back between slices (driver `runSliced`); straight through else. */
export function planSneakAsync(D, tx, tz, o = {}) {
  return D.runSliced ? D.runSliced(planSneakGen(D, tx, tz, o)) : Promise.resolve(planSneak(D, tx, tz, o));
}

/** planSneak's search as a generator (it yields every few hundred states). */
export function* planSneakGen(D, tx, tz, o = {}) {
  const t0v = __verify ? performance.now() : 0;
  const w = D.world, mode = o.mode || 'boat', boat = mode === 'boat' ? (o.boat || teamBoat(w)) : null, u = boat || D.c(o.role);
  if (!u) throw new Error(`planSneak: no ${mode === 'boat' ? 'boat' : o.role}`);
  const DT = o.dt ?? 0.2, [ma, mb] = o.margin ?? [2, 3], HS = Math.round((o.horizon ?? 180) / DT);
  const boatSpeed = CONFIG.vehicles?.[boat?.def?.speed]?.slow ?? 2.5;
  const speed = o.speed ?? (mode === 'boat' ? boatSpeed * 0.7 : mode === 'crawl' ? 0.9 * 0.85 : 2.25 * 0.85);
  const box = o.box ?? 18, keep = o.keep ?? 3, keepWalker = o.keepWalker ?? 7, walkerPad = o.walkerPad ?? (mode === 'boat' ? 2.5 : 0);
  const walkerSlack = o.walkerSlack ?? [0, -5, 5];
  const edgePad = o.edgePad ?? 2, crawlPad = o.crawlPad ?? 3.5;
  const [ux, uz] = o.from ?? [u.x, u.z];
  const x0 = Math.floor(Math.min(ux, tx) - box), z0 = Math.floor(Math.min(uz, tz) - box);
  const W = Math.ceil(Math.max(ux, tx) + box) - x0 + 1, H = Math.ceil(Math.max(uz, tz) + box) - z0 + 1;
  const cx = (c) => x0 + (c % W) + 0.5, cz = (c) => z0 + Math.floor(c / W) + 0.5;
  const cellOf = (x, z) => { const i = Math.floor(x) - x0, j = Math.floor(z) - z0; return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i; };
  const g = w.grid, now = w.time;
  const views = viewersOf(w).filter((e) => !o.ignore?.includes(e.tag));
  const statics = [], walkers = [];
  for (const e of views) (walking(e) ? walkers : statics).push(e);
  const walkOpt = { crawl: mode === 'crawl' };
  const passMemo = new Int8Array(W * H);
  const mates = w.commandos.filter((m) => m !== u && m.alive && !m.vehicle);
  const pass = (c) => {
    if (passMemo[c]) return passMemo[c] > 0;
    const x = cx(c), z = cz(c);
    let ok;
    if (mode === 'boat') ok = [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]].every(([a, b]) => boat.passableAt(x + a, z + b));
    else { const t = g.terrainAt(x, z); ok = g.walkableAt(x, z, walkOpt) && (o.wade || (t !== T.WATER && t !== T.SHALLOW) || onDeck(g, x, z)); }
    if (ok) ok = !statics.some((e) => Math.hypot(e.x - x, e.z - z) < keep) && !(o.avoid || []).some(([ax, az, r]) => Math.hypot(ax - x, az - z) < r)
      && !(o.forbid || []).some((poly) => inPoly(poly, x, z)) // (`forbid`: polygons [[x, z], …] never entered, as driver.planSneak)
      && (mode === 'boat' || !mates.some((m) => Math.hypot(m.x - x, m.z - z) < 1.2));
    passMemo[c] = ok ? 1 : -1;
    return ok;
  };
  const edgeMemo = new Map();
  const edge = (a, b) => {
    const key = a < b ? a * W * H + b : b * W * H + a;
    let ok = edgeMemo.get(key);
    if (ok !== undefined) return ok;
    const ax = cx(a), az = cz(a), bx = cx(b), bz = cz(b), n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25);
    if (mode === 'boat') { ok = boat.straightReach(bx, bz, ax, az) >= Math.hypot(bx - ax, bz - az) - 0.05; edgeMemo.set(key, ok); return ok; }
    let pk = -1;
    ok = true;
    for (let s = 0; s <= n && ok; s++) {
      const x = ax + ((bx - ax) * s) / n, z = az + ((bz - az) * s) / n, i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
      if (!g.isWalkable(i, j, walkOpt)) { ok = false; break; }
      const k = g.idx(i, j);
      if (pk >= 0 && k !== pk && !g.canStep(pk, k)) ok = false;
      pk = k;
    }
    edgeMemo.set(key, ok);
    return ok;
  };
  // (memos — the world stands still while he plans: a walker's predicted place per step, a post's cone per step, the
  // answer per (cell, step) as a byte; a point outside a cone's geometry is not seen by it, so canSee is asked only
  // inside one. The same answers as asking afresh, a fraction of the cost.)
  const wIdx = new Map(walkers.map((e, i) => [e, i])), qMemo = walkers.map(() => []), wheelMemo = walkers.map(() => []);
  const predAt = (e, k) => { const a = qMemo[wIdx.get(e)]; let q = a[k]; if (q === undefined) q = a[k] = predict(e, k * DT); return q; };
  const wheels = (e, k) => { const a = wheelMemo[wIdx.get(e)]; let r = a[k]; if (r === undefined) r = a[k] = wheeling(e, k * DT); return r; };
  // (`o.subSteps` n, opt-in: a post's cone is also tried n − 1 times between two steps — a fast sweep's band edge crosses
  // a spot in a tick or two, between the samples; k is then a fractional step; the cell itself only, not edgePad nearer)
  const SUB = Math.max(1, o.subSteps ?? 1);
  const sCones = statics.map(() => []);
  const sCone = (i, k) => { const a = sCones[i], j = Math.round(k * SUB); let c = a[j]; if (c === undefined) c = a[j] = coneAt(statics[i], now + k * DT); return c; };
  const viewMemo = walkers.map(() => new Map());
  // (each walker's ghosts read his fields through his mirror — ghost.mjs: never through him — refreshed once a plan)
  const wMirror = walkers.map(mirrorOf);
  /** walkerViews of walker e at step kk (heading r·45° when r ≥ 0, as the wheeling check tries it) */
  const headViews = (e, kk, r) => {
    const wi = wIdx.get(e), m = viewMemo[wi], key = kk * 9 + r + 1;
    let L = m.get(key);
    if (!L) { const q = predAt(e, kk); m.set(key, L = walkerViews(e, r < 0 ? q : { ...q, heading: (r * Math.PI) / 4 }, w, now + kk * DT, wMirror[wi])); }
    return L;
  };
  const KS = HS + 256, seenMemo = new Uint8Array(W * H * KS);
  // (which posts can reach a cell at all — the same test as below, `dd > far + 1 + hull`, once per cell instead of once
  // per cell and step: the posts stand still while he plans — and, per walker and block of 32 steps, the box his
  // predicted places keep to: a cell beyond his reach of that box is out of his reach at every step of the block)
  const hullR = mode === 'boat' ? HULL : 0, sCand = new Array(W * H);
  const statCand = (c) => {
    let L = sCand[c];
    if (L) return L;
    const x = cx(c), z = cz(c);
    L = [];
    for (let i = 0; i < statics.length; i++) { const e = statics[i], far = e.vision?.far ?? 36; if (!(Math.hypot(e.x - x, e.z - z) > far + 1 + hullR)) L.push(i); }
    return (sCand[c] = L);
  };
  const BLK = 32, dkMin = Math.min(...walkerSlack), dkMax = Math.max(...walkerSlack), wBox = walkers.map(() => []);
  const wReach = walkers.map((e) => (e.vision?.far ?? 36) + walkerPad + 3 + hullR + 1e-6);
  const boxOf = (wi, b) => {
    let B = wBox[wi][b];
    if (B) return B;
    const e = walkers[wi];
    B = [Infinity, -Infinity, Infinity, -Infinity];
    for (let kk = b * BLK; kk < (b + 1) * BLK; kk++) { const q = predAt(e, kk); if (!(q.x >= B[0])) B[0] = q.x; if (!(q.x <= B[1])) B[1] = q.x; if (!(q.z >= B[2])) B[2] = q.z; if (!(q.z <= B[3])) B[3] = q.z; }
    return (wBox[wi][b] = B);
  };
  /** Can walker `wi` reach cell (x, z) at any step `k + dk` of walkerSlack? (false: every dk would be skipped below) */
  const walkerNear = (wi, k, x, z) => {
    const R = wReach[wi];
    for (let b = Math.floor(Math.max(0, k + dkMin) / BLK), b1 = Math.floor(Math.max(0, k + dkMax) / BLK); b <= b1; b++) {
      const B = boxOf(wi, b);
      if (!(x < B[0] - R || x > B[1] + R || z < B[2] - R || z > B[3] + R)) return true;
    }
    return false;
  };
  let work = 0; // (cells × steps worked out afresh since the last yield: a slice is so many of them, not so many states)
  const seen = (c, k) => {
    const key = c * KS + k;
    const m = seenMemo[key]; if (m) return m === 2;
    work++;
    const x = cx(c), z = cz(c), hull = mode === 'boat' ? HULL : 0;
    let s = false;
    for (const i of statCand(c)) {
      if (s) break;
      const e = statics[i];
      const dd = Math.hypot(e.x - x, e.z - z), far = e.vision?.far ?? 36, near = e.vision?.near ?? far / 2;
      for (let sub = 0; sub < SUB; sub++) {
        const ks = k + sub / SUB;
        const cone = o.coneMargin ? inflateCone(sCone(i, ks), o.coneMargin) : sCone(i, ks), d = dummyFor(w, mode, x, z, e.x, e.z);
        // (`o.postMargin` [deg, m], opt-in: posts' cones only widened, for the cell itself — he is between two cell
        // centres as he moves on, a fraction of a metre aside)
        const pc = o.postMargin ? inflateCone(cone, o.postMargin) : cone;
        if (pointInCone(pc, d.x, d.z) && canSee(e, d, w, { cone: pc }) !== 'none') { s = true; break; }
        // at the edge of the band that matters the unit's own path may wander a little: the cell `edgePad` m nearer too
        const bandEdge = mode === 'crawl' ? near : far;
        if (sub === 0 && dd > bandEdge - edgePad && dd < bandEdge + edgePad) {
          const f = edgePad / dd, d2 = dummyAt(w, mode, x + (e.x - x) * f, z + (e.z - z) * f);
          if (pointInCone(cone, d2.x, d2.z) && canSee(e, d2, w, { cone }) !== 'none') { s = true; break; }
        }
      }
    }
    if (!s) walk: for (let wi = 0; wi < walkers.length; wi++) for (const dk of walkerSlack) {
      const e = walkers[wi];
      if (dk === walkerSlack[0] && !walkerNear(wi, k, x, z)) break; // (out of his reach at every dk: on to the next)
      const kk = Math.max(0, k + dk), q = predAt(e, kk), dd = Math.hypot(q.x - x, q.z - z), far = e.vision?.far ?? 36;
      if (dd > far + walkerPad + 3 + hull) continue;
      const d = dummyFor(w, mode, x, z, q.x, q.z);
      // (`o.keepFrom`: {tag: r} — never within r m of these men, whichever way they face: a patrol file whose men
      // fall out of step and swing round at its turns is not predicted well enough to slip past its cones)
      if (dd < keepWalker || (o.keepFrom?.[e.tag] && dd < o.keepFrom[e.tag]) || seesAny(headViews(e, kk, -1), d, w, o.coneMargin)) { s = true; break walk; }
      if (wheels(e, kk) && [0, 1, 2, 3, 4, 5, 6, 7].some((r) => seesAny(headViews(e, kk, r), d, w, o.coneMargin))) { s = true; break walk; }
      const near = e.vision?.near ?? far / 2, sq = e.squad?.id != null && mode === 'boat' ? 2 : 0;
      const pad = (walkerPad ? walkerPad + sq : 0) || (mode === 'crawl' && dd > near - 3 && dd < near + crawlPad + 0.5 ? crawlPad : 0);
      if (pad > 0 && dd > pad) {
        const f = pad / dd, d2 = dummyAt(w, mode, x + (q.x - x) * f, z + (q.z - z) * f);
        if (seesAny(headViews(e, kk, -1), d2, w)) { s = true; break walk; }
      }
    }
    seenMemo[key] = s ? 2 : 1;
    return s;
  };
  const clear = (c, k0, k1) => { for (let k = Math.max(0, k0); k <= k1; k++) if (seen(c, k)) return false; return true; };
  const s0 = cellOf(ux, uz);
  let s1 = cellOf(tx, tz);
  if (s0 < 0 || s1 < 0) throw new Error(`planSneak: (${tx},${tz}) outside the box`);
  if (!pass(s1)) { // (a boat's landing click on the bank: the nearest cell it can lie in)
    let best = -1, bd = 2.6;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
      const c = s1 + dj * W + di, d = Math.hypot(di, dj);
      if (c >= 0 && c < W * H && d < bd && pass(c)) { bd = d; best = c; }
    }
    if (best >= 0) { s1 = best; tx = cx(best); tz = cz(best); }
  }
  passMemo[s0] = 1; passMemo[s1] = 1;
  const hfun = o.shelter ? () => 0 : (c) => Math.hypot(cx(c) - tx, cz(c) - tz) / speed / DT;
  // (the open list and the reached states in typed arrays, reused plan after plan — state-heap.mjs: no [f, c, k] array
  // per push, no Map and Set of tens of thousands of entries to outlive the young generation; given back at every return)
  const heap = takeHeap(), prev = takeSet();
  const give = () => { giveHeap(heap); giveSet(prev); };
  const push = (f, c, k, from) => {
    const key = c * (HS + 256) + k;
    if (prev.has(key)) return; prev.set(key, from);
    heap.push(f, c, k);
  };
  const k0 = o.startDelay ? Math.round(o.startDelay / DT) : 0, holdK = Math.round((o.hold ?? 3) / DT);
  // (no goal state can ever be accepted — every cell he may stop at stays watched within every `hold` window up to the
  // last step a search can reach: it would only grind to its cap and fail. The same null, now: driver.mjs goalReachable)
  if (!o.shelter && !(yield* goalReachableGen({ s1, tx, tz, W, H, x0, z0, cx, cz, k0, holdK, seen, raft: mode === 'boat', kMax: Math.max(k0, HS - 1 + Math.max(1, Math.ceil(Math.SQRT2 / speed / DT))) }))) {
    if (o.why) o.why.push(`goal (${tx},${tz}) never unseen for ${(holdK * DT).toFixed(1)} s within the horizon`);
    __verify?.(D, tx, tz, o, null, performance.now() - t0v);
    give();
    return null;
  }
  push(k0 + hfun(s0), s0, k0, -1);
  let found = null, n = 0;
  const maxN = o.maxExpand ?? 300000;
  while (heap.length && n < maxN) {
    heap.pop();
    const c = heap.topC, k = heap.topK;
    const key = c * (HS + 256) + k;
    if (prev.isDone(key)) continue;
    prev.markDone(key); n++;
    // (each state asks seen() of its neighbours, and fresh cells × steps cost more: a slice stays within PLAN_SLICE_MS)
    if ((n & 15) === 0 || work >= 16) { work = 0; yield; }
    const atGoal = o.shelter || c === s1 || (mode !== 'boat' && Math.hypot(cx(c) - tx, cz(c) - tz) <= 0.55);
    if (atGoal && clear(c, k, k + holdK) && (!o.goalOk || o.goalOk(cx(c), cz(c), now + k * DT))) { found = [c, k]; break; }
    if (k >= HS) continue;
    if (clear(c, k + 1 - ma, k + 1 + mb)) push(k + 1 + hfun(c), c, k + 1, key);
    const i = c % W, j = Math.floor(c / W);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nc = nj * W + ni;
      if (!pass(nc)) continue;
      if (di && dj && (!pass(j * W + ni) || !pass(nj * W + i))) continue;
      if (!edge(c, nc)) continue;
      const steps = Math.max(1, Math.ceil((di && dj ? Math.SQRT2 : 1) / speed / DT));
      if ((!(c === s0 && k === k0) && !clear(c, k - ma, k + steps)) || !clear(nc, k - ma, k + steps + mb)) { if (work >= 16) { work = 0; yield; } continue; }
      push(k + steps + hfun(nc), nc, k + steps, key);
      if (work >= 16) { work = 0; yield; }
    }
  }
  if (!found) {
    if (o.why) { let bc = s0, bd = Infinity; for (const key of prev.doneKeys()) { const c = Math.floor(key / (HS + 256)), d = Math.hypot(cx(c) - tx, cz(c) - tz); if (d < bd) { bd = d; bc = c; } } o.why.push(`closest (${cx(bc)},${cz(bc)}) ${bd.toFixed(1)} m, ${n} expanded`); }
    give();
    __verify?.(D, tx, tz, o, null, performance.now() - t0v);
    return null;
  }
  const out = [];
  for (let key = found[0] * (HS + 256) + found[1]; key >= 0; key = prev.get(key)) {
    const c = Math.floor(key / (HS + 256)), k = key % (HS + 256);
    out.push([cx(c), cz(c), now + k * DT]);
  }
  give();
  out.reverse();
  out[0][0] = ux; out[0][1] = uz;
  if (!o.shelter) { out[out.length - 1][0] = tx; out[out.length - 1][1] = tz; }
  // (what the dash compiler re-checks a straighter, quicker way with: the same memoised cones, cells and margins)
  Object.defineProperty(out, 'ctx', { value: { seen, pass, cellOf, DT, now, ma, mb, holdK, KS, mode, goalOk: o.goalOk || null }, enumerable: false });
  __verify?.(D, tx, tz, o, out, performance.now() - t0v);
  return out;
}

/**
 * D.wait(sec) told to video mode as a wait (`label`: AUTO runs it fast under a "⏩ waiting" tag — D.wait tells it only
 * from 2 s): the same number of ticks, round(sec / dt).
 */
export async function waitTold(D, sec, label) {
  // (by the clock, not by the condition's calls: a solution may try its waits' conditions less often than every tick —
  // M20 every tenth of a second — and a count of calls then ran six times too long, past the wait's own timeout)
  const end = D.t + Math.round(sec / D.dt) * D.dt - 1e-6;
  await D.until(() => D.t >= end, sec + 1, label);
}

/**
 * Go to (tx, tz) on a planSneak plan, like a player timing each dash: wait where the plan waits, click each straight
 * run of cells at its planned moment, and plan again from where he is whenever he falls behind. mode as planSneak
 * ('boat' rows the boat: the order goes to the Marine at the oars).
 */
export async function sneak(D, tx, tz, o = {}) {
  const ctx = globalThis.__trailCtx; // (tools/solutions/trail-rec.mjs: which helper gave an order)
  ctx?.push('sneak');
  try { return await sneak0(D, tx, tz, o); } finally { ctx?.pop(); }
}
async function sneak0(D, tx, tz, o) {
  const w = D.world, mode = o.mode || 'boat', boat = mode === 'boat' ? (o.boat || teamBoat(w)) : null, u = boat || D.c(o.role);
  const tol = o.tol ?? (mode === 'boat' ? 0.9 : 0.4), slack = o.slack ?? (mode === 'boat' ? 0.8 : 0.5), t0 = D.t, maxWait = o.maxWait ?? 400;
  if (mode === 'crawl') await D.stance(o.role, 'crawl');
  if (mode === 'walk') await D.stance(o.role, 'stand');
  const who = mode === 'boat' ? 'diver' : o.role;
  const go = (x, z) => D.order(who, { type: 'move', x, z });
  const stopped = () => mode === 'boat' ? (boat.speed || 0) < 0.1 && !boat.goal : !u.path && !u.isMoving;
  let plans = 0, fails = 0, gx = tx, gz = tz, noted = false;
  try {
    while (Math.hypot(u.x - gx, u.z - gz) > tol) {
      if (D.t - t0 > maxWait) {
        const why = []; planSneak(D, tx, tz, { ...o, why });
        throw new Error(`sneak ${o.label || ''} → (${tx},${tz}): no way after ${maxWait}s, at (${u.x.toFixed(1)},${u.z.toFixed(1)}) [${why.join(' ')}]`);
      }
      if (!stopped()) { await D.wait(D.dt); continue; }
      const plan = await planSneakAsync(D, tx, tz, o);
      plans++;
      if (!plan) {
        if (o.noWait) return false;
        const sb = o.shelterBox ?? 6, sh = o.shelterHorizon ?? 30;
        let here = await planSneakAsync(D, u.x, u.z, { ...o, shelter: true, hold: o.shelterHold ?? 8, box: sb, horizon: sh, maxExpand: 60000 });
        // (`w.sneakFlee`, opt-in: no shelter near him and where he lies seen within seconds — a patrol coming his way — then
        // one twice as far, held for less long, rather than lying on: in the game Patrol 57 walked onto a man who had
        // nowhere left to go)
        let fled = null;
        if (!here && w.sneakFlee && !(await (D.runSliced ? D.runSliced(routeClearGen(D, [], { mode, from: [u.x, u.z], hold: 4, slack: 0.3 })) : routeClear(D, [], { mode, from: [u.x, u.z], hold: 4, slack: 0.3 })))) {
          fled = { box: sb * 2, hold: 3 };
          here = await planSneakAsync(D, u.x, u.z, { ...o, shelter: true, hold: fled.hold, box: fled.box, horizon: sh, maxExpand: 150000 });
        }
        if (here && here.length > 1) { await sneak(D, here[here.length - 1][0], here[here.length - 1][1], { ...o, hold: fled?.hold ?? o.shelterHold ?? 8, label: `${o.label || ''} (shelter)`, noWait: true, box: fled?.box ?? sb, horizon: sh }); fails = 0; }
        else await waitTold(D, o.retry ?? (here ? Math.min(0.5 + 0.25 * fails++, 2.5) : 0.5), `${o.label || 'a man'}: a gap in the cones`);
        continue;
      }
      fails = 0;
      [gx, gz] = plan[plan.length - 1];
      // on foot: the plan as the fewest straight legs he walks one after the other at his own pace, halting only where
      // he must wait for a gap in the cones (dash.mjs; user 2026-10-15: "making it more straight and decisive")
      // (opt-in per solution: D.straightDashes, or o.straight)
      const legs = mode !== 'boat' && (o.straight ?? D.straightDashes) && D._walkLegs ? await runDash(D, compileDashGen(plan, { speed: u.speed, route: routeFor(u), pad: (o.straight ?? D.straightDashes)?.pad })) : null;
      if (legs) {
        const r = await D._walkLegs(legs, { role: o.role, u, tol, slack, label: o.label });
        if (r === 'done' && !legs.partial) break;
        if (r === 'done') continue; // (the legs end short of the goal: plan again from there)
        if (Math.hypot(u.x - gx, u.z - gz) < 0.9 && stopped() && plans > 3) break;
        try { D.order(who, { type: 'stop' }); } catch { /* already still */ }
        continue;
      }
      const segs = [];
      let a = 0;
      while (a < plan.length - 1) {
        const [ax, az, at] = plan[a];
        if (Math.hypot(plan[a + 1][0] - ax, plan[a + 1][1] - az) < 1e-6) {
          let b = a + 1; while (b < plan.length - 1 && Math.hypot(plan[b + 1][0] - ax, plan[b + 1][1] - az) < 1e-6) b++;
          segs.push({ wait: true, until: plan[b][2] }); a = b; continue;
        }
        const dx = Math.sign(plan[a + 1][0] - ax), dz = Math.sign(plan[a + 1][1] - az);
        let b = a + 1;
        while (b < plan.length - 1 && b - a < (o.run ?? 4)) {
          const [bx, bz] = plan[b], [nx, nz] = plan[b + 1];
          if (Math.hypot(nx - bx, nz - bz) < 1e-6 || Math.sign(nx - bx) !== dx || Math.sign(nz - bz) !== dz) break;
          b++;
        }
        segs.push({ x: plan[b][0], z: plan[b][1], start: at, end: plan[b][2] });
        a = b;
      }
      let late = false;
      const p0x = u.x, p0z = u.z;
      for (const s of segs) {
        if (s.wait) {
          // (lying or standing still for a gap in the cones: told to video mode as a wait — AUTO runs it fast under a
          // "⏩ waiting" tag, as it does the straight dashes' waits (D._walkLegs) — the same ticks either way)
          // (`w.sneakRecheck` s, opt-in: a long wait is looked at again that often — the walkers as they walk now, not as
          // they were foreseen when he planned (in the game a patrol's way round a wagon came onto a man waiting): seen
          // there before the wait is out, he plans afresh)
          const re = w.sneakRecheck;
          let stale = false;
          while (D.t < s.until - 1e-6) {
            const stop = re ? Math.min(s.until, D.t + re) : s.until;
            if (stop - D.t >= 0.5) await D.until(() => D.t >= stop - 1e-6, stop - D.t + 1, `${o.label || 'a man'}: a gap in the cones`);
            else while (D.t < stop - 1e-6) await D.wait(D.dt);
            if (re && s.until - D.t > 0.3) {
              const hold = s.until - D.t + 1;
              const ok = await (D.runSliced ? D.runSliced(routeClearGen(D, [], { mode, from: [u.x, u.z], hold, slack: 0.3, except: o.except })) : routeClear(D, [], { mode, from: [u.x, u.z], hold, slack: 0.3, except: o.except }));
              if (!ok) { stale = true; break; }
            }
          }
          if (stale) { late = true; break; }
          continue;
        }
        if (s.start - D.t >= 0.5) await D.until(() => D.t >= s.start - 1e-6, s.start - D.t + 1, `${o.label || 'a man'}: a gap in the cones`);
        else while (D.t < s.start - 1e-6) await D.wait(D.dt);
        try { go(s.x, s.z); } catch {
          let ok = false;
          for (const q of segs.slice(segs.indexOf(s) + 1)) { if (q.wait || ok) continue; try { go(q.x, q.z); ok = true; } catch { /* next */ } }
          if (!ok && mode === 'boat') {
            const h = boat.heading;
            for (const dd of [-1.6, 1.6]) { if (ok) break; try { go(boat.x + Math.cos(h) * dd, boat.z + Math.sin(h) * dd); ok = true; } catch { /* other way */ } }
          }
          await D.wait(D.dt);
          if (ok) { for (let n = 0; n < 90 && !stopped(); n++) await D.wait(D.dt); }
          late = true; break;
        }
        const ts = D.t;
        while (Math.hypot(u.x - s.x, u.z - s.z) > tol && D.t < s.end + slack + 1) {
          await D.wait(D.dt);
          if (D.t > ts + 0.5 && stopped() && Math.hypot(u.x - s.x, u.z - s.z) > tol) break;
        }
        const f = D.failed(); if (f) throw new Error(`FAILED sneaking ${o.label || ''}: ${f}`);
        if (D.t > s.end + slack || Math.hypot(u.x - s.x, u.z - s.z) > tol) { late = true; break; }
      }
      // (a plan whose legs got him nowhere — a cell the game will not take him to, by a parked hull — is planned again
      // until the guards' places give another: he lies still meanwhile, a wait for video mode; no tick changes)
      const still = Math.hypot(u.x - p0x, u.z - p0z) < 0.2;
      if (late && still) { D.waitNote?.(`${o.label || 'a man'}: a gap in the cones`); noted = true; } // (again: an until in between said null)
      else if (noted) { D.waitNote?.(null); noted = false; }
      if (!late) break;
      if (Math.hypot(u.x - gx, u.z - gz) < 0.9 && stopped() && plans > 3) break;
      try { D.order(who, { type: 'stop' }); } catch { /* already still */ }
    }
    return true;
  } finally { if (noted) D.waitNote?.(null); }
}
