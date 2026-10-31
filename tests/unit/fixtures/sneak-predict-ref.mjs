/**
 * Reference copy of tools/solutions/sneak.mjs's look-ahead predictor as it was before the M15 perf pass (a walk of the
 * beat per call, trailPoint walking back step by step): the oracle tests/unit/sneak-predict-exact.test.mjs holds the
 * optimised predict to, number for number. Verbatim (only the imports and the export list differ).
 */
import { CONFIG } from '../../../src/config.js';
import { protoOf } from '../../../tools/solutions/ghost.mjs';
import { predictVehicle } from '../../../tools/solutions/sneak.mjs';

const TURN = 3; // s: at a halt he turns to its look over a couple of seconds (until then he may face the way he came)
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
  if (!q) m.at.set(k, (q = k <= 0 ? { x: lead.x, z: lead.z, heading: lead.heading } : predictRef(lead, k / 20, 1)));
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

export function predictRef(e, t, depth = 0) {
  if (e.vehEye) { // a vehicle's eye: along its route, `mount` m ahead of its centre (viewerFor)
    const q = predictVehicle(e.vehicle, t), m = e.vehicle.def?.turret ? 0 : (e.vehicle.def?.mount || 0);
    return { x: q.x + Math.cos(q.heading) * m, z: q.z + Math.sin(q.heading) * m, heading: q.heading, alt: q.alt };
  }
  const b = e.brain, r = e.route;
  // (`w.sneakHeel`, opt-in) a dog heeling its living handler keeps 1.5 m behind him (enemy-brain _heel), not straight on
  const hd = e.world?.sneakHeel && e.spawn?.handler != null && depth < 2 ? e.world.byId?.(e.spawn.handler) : null;
  if (hd?.alive && b?.state === 'IDLE') {
    const q = predictRef(hd, t, depth + 1);
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
    const q = predictRef(lead, t, 1), ql = t > lag ? predictRef(lead, t - lag, 1) : { heading: e.heading };
    // (`w.sneakFileHalt`, opt-in) a file man walking behind his walking leader looks ahead as the leader does (only at
    // a halt does his head sweep: walkerViews' amplitude follows the leader's halt flag, not the man's own sweep)
    return { x: q.x + (e.x - lead.x), z: q.z + (e.z - lead.z), heading: ql.heading, ...(e.world?.sneakFileHalt ? { halt: q.halt } : {}) };
  }
  const ROUTE_STATES = ['IDLE', 'REINFORCE', 'RETURN'];
  // a file whose leader is off his beat (drawn to a lure, searching...) holds round him: where he goes, they go
  if (lead && lead !== e && lead.alive && ROUTE_STATES.includes(b.state) && !ROUTE_STATES.includes(lead.brain?.state)) {
    if (e.isMoving || e.path) return alongPath(e, (e.speed ?? 1.0) * t, true); // still closing up on him
    const q = predictRef(lead, t, 1);
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
