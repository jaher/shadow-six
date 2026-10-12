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
import { canSee as canSee0, coneAt, pointInCone } from '../../src/ai/perception.js';
import { CONFIG } from '../../src/config.js';
import { T } from '../../src/world/grid.js';

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

export function viewersOf(w) {
  return w.enemies.filter((e) => e.alive && !e.removed && e.vision && !e.incapacitated && e.brain?.arch?.reacts !== false);
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

/**
 * Where enemy `e` will be (and face) `t` s from now. A man on his route (IDLE / REINFORCE / RETURN) is walked along it
 * — the rest of his current path, then waypoint to waypoint with each halt's wait and look (LOOP / PINGPONG as the
 * brain advances it); at a halt he may still face the way he came for its first seconds (`alt`). A squad member keeps
 * his offset to his leader and reaches each turn as far behind him as he walks now. Anyone else walking keeps to his
 * path and stops at its end (a lure, a body, a noise); a man standing still keeps his place and heading.
 */
export function predict(e, t, depth = 0) {
  const b = e.brain, r = e.route;
  const lead = depth === 0 && b?._leader?.();
  if (lead && lead !== e && lead.alive && b.state !== 'DISTRACTED' && b.state === lead.brain?.state) {
    const lag = Math.hypot(e.x - lead.x, e.z - lead.z) / (lead.speed ?? 1.0);
    const q = predict(lead, t, 1), ql = t > lag ? predict(lead, t - lag, 1) : { heading: e.heading };
    return { x: q.x + (e.x - lead.x), z: q.z + (e.z - lead.z), heading: ql.heading };
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
  if (waitLeft > 0) {
    const wp = r[i];
    if (left <= waitLeft) return halt(wp, left + Math.max(0, (wp?.wait ?? 0) - waitLeft));
    if (wp?.look != null) h = (wp.look * Math.PI) / 180;
    left -= waitLeft; i = nextIdx(i);
  }
  for (let guard = 0; guard < 64; guard++) {
    const wp = r[i];
    const dx = wp.x - x, dz = wp.z - z, L = Math.hypot(dx, dz);
    if (L > 1e-6) {
      // (setting off on a leg he turns to it at his body's rate: `turnFrom`, `turnT` s into the leg — walkerSees)
      const h0 = h;
      h = Math.atan2(dz, dx);
      if (left * sp <= L) return { x: x + (dx / L) * left * sp, z: z + (dz / L) * left * sp, heading: h, halt: false, turnFrom: h0, turnT: left };
      left -= L / sp; x = wp.x; z = wp.z;
    }
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
 * (`w.sneakTurns`): the stages planned without it were proven with it off.
 */
function turnHeadings(q) {
  if (q.turnFrom == null) return [];
  const d = Math.atan2(Math.sin(q.heading - q.turnFrom), Math.cos(q.heading - q.turnFrom)), ad = Math.abs(d);
  if (ad < 0.15 || q.turnT > ad / TURN_RATE + 0.4) return [];
  const out = [], a0 = Math.max(0, q.turnT - 0.4) * TURN_RATE, a1 = (q.turnT + 0.4) * TURN_RATE;
  for (const sg of ad > Math.PI - 0.1 ? [1, -1] : [Math.sign(d)]) {
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
  // a man walking his beat looks straight ahead (the brain sweeps his head only at a halt: patrolWatch); one walking
  // anywhere else, or halted, is tried at both ends of his sweep too (walking men glance about). With
  // `w.sneakHaltExact` (s) a halted man's head is where his sweep puts it at tAbs (its phase is his own and the clock's),
  // ± that much time
  const pw = CONFIG.stealth.vision.patrolWatch;
  if (q.halt && w.sneakHaltExact != null && pw && e.vision) {
    const A = (pw.sweep * Math.PI) / 180, P = pw.period, ph = e.vision.phase || 0, dt = w.sneakHaltExact;
    const offs = [0, -dt, dt, -dt / 2, dt / 2].map((tau) => A * Math.sin((2 * Math.PI * (tAbs + tau + ph)) / P));
    for (const hd of [q.heading, ...(q.alt != null ? [q.alt] : []), ...cryHeadings(q, w, tAbs)]) for (const off of offs) {
      const g = Object.create(e);
      g.x = q.x; g.z = q.z; g.heading = hd; g.sweepActive = false; g.headOffset = off; g.headCarry = 0;
      if (canSee(g, dummy, w, { cone: coneAt(g, tAbs) }) !== 'none') return true;
    }
    return false;
  }
  const amp = (q.halt === false ? (w.sneakWalkAmp ?? 0.25) : (q.halt ? (CONFIG.stealth.vision.patrolWatch?.sweep ?? 50) * Math.PI / 180 : e.sweepAmp ?? e.vision?.sweep ?? 0))
    + (w.sneakMargin ?? 0);
  for (const hd of [q.heading, ...(q.alt != null ? [q.alt] : []), ...(w.sneakTurns ? turnHeadings(q) : []), ...cryHeadings(q, w, tAbs)]) for (const off of amp ? [0, amp / 2, -amp / 2, amp, -amp] : [0]) {
    const g = Object.create(e);
    g.x = q.x; g.z = q.z; g.heading = hd; g.sweepActive = false; g.headOffset = off; g.headCarry = 0;
    if (canSee(g, dummy, w, { cone: coneAt(g, tAbs) }) !== 'none') return true;
  }
  return false;
}

/** A guard on the move, or one with a route he walks (a man staring at a lure stands still). */
const lastMoved = new WeakMap();
export function walking(e) {
  const b = e.brain, now = e.world?.time ?? 0;
  if (e.isMoving || e.path || b?.atWait || !lastMoved.has(e)) lastMoved.set(e, now);
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
  const tg = e.brain?.turn ? e.brain._turnGoal?.() : null;
  const off = Math.abs(Math.atan2(Math.sin(e.heading - ph), Math.cos(e.heading - ph)));
  if (tg == null && !(e.brain?.noiseTurnT > 0) && off <= 0.1) return null;
  const mid = (a, b) => Math.atan2(Math.sin(a) + Math.sin(b), Math.cos(a) + Math.cos(b));
  return [e.heading, ph, mid(e.heading, ph), ...(tg != null ? [tg, mid(e.heading, tg)] : [])];
}

/** canSee for a standing (not walking) viewer at time t, every heading a turned post may face. */
export function staticSees(e, d, w, t) {
  const ch = cryHeadings(e, w, w.time + t);
  if (ch.length && ch.some((h) => { const g = Object.create(e); g.heading = h; g.sweepActive = false; g.headOffset = 0; g.headCarry = 0; return canSee(g, d, w, { cone: coneAt(g, w.time + t) }) !== 'none'; })) return true;
  const hs = postHeadings(e);
  if (!hs) return canSee(e, d, w, { cone: coneAt(e, w.time + t) }) !== 'none';
  return hs.some((h) => { const g = Object.create(e); g.heading = h; return canSee(g, d, w, { cone: coneAt(g, w.time + t) }) !== 'none'; });
}

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
      if (Math.hypot(e.x - x, e.z - z) > far + (mode === 'boat' ? HULL : 0) + (moving ? 1.2 * dur + 2 : 0)) continue;
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
 */
export function routeClear(D, pts, { mode = 'walk', from, speed, delay = 0, step = 0.75, slack = 0.5, why = null, except = null, keepWalker = 4, pad = 0 } = {}) {
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
  for (const e of viewersOf(w)) {
    if (except?.includes?.(e)) continue;
    const far = (e.vision.far ?? 36) + 1, moving = walking(e);
    // (a post sweeping his head may swing his cone across a point within half a second: finer steps for him)
    const ostep = Math.min(!moving && e.sweepActive ? 0.15 : 0.5, Math.max(0.1, slack));
    for (const [sx, sz, st] of samples) {
      for (let o = -slack; o <= slack + 1e-6; o += ostep) {
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
            || (wheeling(e, tt) && [0, 1, 2, 3, 4, 5, 6, 7].some((r) => walkerSees(e, { ...q, heading: (r * Math.PI) / 4 }, dummyFor(w, mode, sx, sz, q.x, q.z), w, w.time + tt)));
        } else {
          if (Math.hypot(e.x - sx, e.z - sz) > far + hull + pad) continue;
          const p2 = near(e.x, e.z);
          seen = staticSees(e, dummyFor(w, mode, sx, sz, e.x, e.z), w, tt)
            || (!!p2 && staticSees(e, padded(dummyFor(w, mode, p2[0], p2[1], e.x, e.z), w.grid.elevAt?.(sx, sz) ?? 0), w, tt));
        }
        if (seen) { if (why) why.push(`${e.tag}@(${sx.toFixed(1)},${sz.toFixed(1)})+${tt.toFixed(1)}`); return false; }
      }
    }
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
      const seenBy = heads.some((h) => {
        const g = Object.create(e); g.x = q.x; g.z = q.z; g.heading = h;
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
    if (except.includes(e)) continue;
    const moving = walking(e), far = (e.vision.far ?? 36) + 1;
    for (let t = 0; t <= dur; t += step) {
      if (moving) { const q = predict(e, t); if (Math.hypot(q.x - x, q.z - z) > far) continue; if (walkerSees(e, q, d, w, w.time + t)) { out.add(e.tag); break; } }
      else { if (Math.hypot(e.x - x, e.z - z) > far) break; if (canSee(e, d, w, { cone: coneAt(e, w.time + t) }) !== 'none') { out.add(e.tag); break; } }
    }
  }
  return [...out];
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
    if (except.includes(e)) continue;
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

/** The open boat the team rows (the first player boat on the map: raft, rowboat). */
export function teamBoat(w) {
  return (w.vehicles || []).find((v) => !v.removed && !v.destroyed && v.isBoat && !v.crewed && !v.def?.enclosed && v.vehicleType !== 'patrolboat');
}

/**
 * Space-time sneak plan: the fastest chain of 1 m cells from where the man (or the boat) is to (tx, tz) that no cone
 * covers while he is in it — a cell is entered only when it stays clear from `margin[0]` steps before to `margin[1]`
 * after, and he WAITS only where nobody will look. Posted men by their sweep at the future time, walkers along their
 * predicted beat (every glance: walkerSees), never closer than `keepWalker` m. mode: 'boat' (rowed by the Marine),
 * 'crawl' (near band only), 'walk'.
 * @returns {Array<[number, number, number]>|null} [x, z, absolute time] per cell, or null (no way within `horizon` s)
 */
export function planSneak(D, tx, tz, o = {}) {
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
    else { const t = g.terrainAt(x, z); ok = g.walkableAt(x, z, walkOpt) && (o.wade || (t !== T.WATER && t !== T.SHALLOW)); }
    if (ok) ok = !statics.some((e) => Math.hypot(e.x - x, e.z - z) < keep) && !(o.avoid || []).some(([ax, az, r]) => Math.hypot(ax - x, az - z) < r)
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
  const qMemo = new Map(), wheelMemo = new Map();
  const predAt = (e, k) => { const key = `${e.id}|${k}`; let q = qMemo.get(key); if (!q) qMemo.set(key, q = predict(e, k * DT)); return q; };
  const wheels = (e, k) => { const key = `${e.id}|${k}`; let r = wheelMemo.get(key); if (r === undefined) wheelMemo.set(key, r = wheeling(e, k * DT)); return r; };
  const seenMemo = new Map();
  const seen = (c, k) => {
    const key = c * (HS + 256) + k;
    const m = seenMemo.get(key); if (m !== undefined) return m;
    const x = cx(c), z = cz(c), hull = mode === 'boat' ? HULL : 0;
    let s = false;
    for (const e of statics) {
      const dd = Math.hypot(e.x - x, e.z - z), far = e.vision?.far ?? 36, near = e.vision?.near ?? far / 2;
      if (dd > far + 1 + hull) continue;
      const cone = coneAt(e, now + k * DT), d = dummyFor(w, mode, x, z, e.x, e.z);
      if (canSee(e, d, w, { cone }) !== 'none') { s = true; break; }
      // at the edge of the band that matters the unit's own path may wander a little: the cell `edgePad` m nearer too
      const bandEdge = mode === 'crawl' ? near : far;
      if (dd > bandEdge - edgePad && dd < bandEdge + edgePad) {
        const f = edgePad / dd, d2 = dummyAt(w, mode, x + (e.x - x) * f, z + (e.z - z) * f);
        if (canSee(e, d2, w, { cone }) !== 'none') { s = true; break; }
      }
    }
    if (!s) for (const e of walkers) for (const dk of walkerSlack) {
      const kk = Math.max(0, k + dk), q = predAt(e, kk), dd = Math.hypot(q.x - x, q.z - z), far = e.vision?.far ?? 36;
      if (dd > far + walkerPad + 3 + hull) continue;
      const d = dummyFor(w, mode, x, z, q.x, q.z);
      if (dd < keepWalker || walkerSees(e, q, d, w, now + kk * DT)) { s = true; break; }
      if (wheels(e, kk) && [0, 1, 2, 3, 4, 5, 6, 7].some((r) => walkerSees(e, { ...q, heading: (r * Math.PI) / 4 }, d, w, now + kk * DT))) { s = true; break; }
      const near = e.vision?.near ?? far / 2, sq = e.squad?.id != null && mode === 'boat' ? 2 : 0;
      const pad = (walkerPad ? walkerPad + sq : 0) || (mode === 'crawl' && dd > near - 3 && dd < near + crawlPad + 0.5 ? crawlPad : 0);
      if (pad > 0 && dd > pad) {
        const f = pad / dd, d2 = dummyAt(w, mode, x + (q.x - x) * f, z + (q.z - z) * f);
        if (walkerSees(e, q, d2, w, now + kk * DT)) { s = true; break; }
      }
    }
    seenMemo.set(key, s);
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
  const heap = [], prev = new Map(), done = new Set();
  const push = (f, c, k, from) => {
    const key = c * (HS + 256) + k;
    if (prev.has(key)) return; prev.set(key, from);
    heap.push([f, c, k]); let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
    return top;
  };
  const k0 = o.startDelay ? Math.round(o.startDelay / DT) : 0, holdK = Math.round((o.hold ?? 3) / DT);
  push(k0 + hfun(s0), s0, k0, -1);
  let found = null, n = 0;
  const maxN = o.maxExpand ?? 300000;
  while (heap.length && n < maxN) {
    const [, c, k] = pop();
    const key = c * (HS + 256) + k;
    if (done.has(key)) continue;
    done.add(key); n++;
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
      if ((!(c === s0 && k === k0) && !clear(c, k - ma, k + steps)) || !clear(nc, k - ma, k + steps + mb)) continue;
      push(k + steps + hfun(nc), nc, k + steps, key);
    }
  }
  if (!found) {
    if (o.why) { let bc = s0, bd = Infinity; for (const key of done) { const c = Math.floor(key / (HS + 256)), d = Math.hypot(cx(c) - tx, cz(c) - tz); if (d < bd) { bd = d; bc = c; } } o.why.push(`closest (${cx(bc)},${cz(bc)}) ${bd.toFixed(1)} m, ${n} expanded`); }
    return null;
  }
  const out = [];
  for (let key = found[0] * (HS + 256) + found[1]; key >= 0; key = prev.get(key)) {
    const c = Math.floor(key / (HS + 256)), k = key % (HS + 256);
    out.push([cx(c), cz(c), now + k * DT]);
  }
  out.reverse();
  out[0][0] = ux; out[0][1] = uz;
  if (!o.shelter) { out[out.length - 1][0] = tx; out[out.length - 1][1] = tz; }
  return out;
}

/**
 * Go to (tx, tz) on a planSneak plan, like a player timing each dash: wait where the plan waits, click each straight
 * run of cells at its planned moment, and plan again from where he is whenever he falls behind. mode as planSneak
 * ('boat' rows the boat: the order goes to the Marine at the oars).
 */
export async function sneak(D, tx, tz, o = {}) {
  const w = D.world, mode = o.mode || 'boat', boat = mode === 'boat' ? (o.boat || teamBoat(w)) : null, u = boat || D.c(o.role);
  const tol = o.tol ?? (mode === 'boat' ? 0.9 : 0.4), slack = o.slack ?? (mode === 'boat' ? 0.8 : 0.5), t0 = D.t, maxWait = o.maxWait ?? 400;
  if (mode === 'crawl') await D.stance(o.role, 'crawl');
  if (mode === 'walk') await D.stance(o.role, 'stand');
  const who = mode === 'boat' ? 'diver' : o.role;
  const go = (x, z) => D.order(who, { type: 'move', x, z });
  const stopped = () => mode === 'boat' ? (boat.speed || 0) < 0.1 && !boat.goal : !u.path && !u.isMoving;
  let plans = 0, fails = 0, gx = tx, gz = tz;
  while (Math.hypot(u.x - gx, u.z - gz) > tol) {
    if (D.t - t0 > maxWait) {
      const why = []; planSneak(D, tx, tz, { ...o, why });
      throw new Error(`sneak ${o.label || ''} → (${tx},${tz}): no way after ${maxWait}s, at (${u.x.toFixed(1)},${u.z.toFixed(1)}) [${why.join(' ')}]`);
    }
    if (!stopped()) { await D.wait(D.dt); continue; }
    const plan = planSneak(D, tx, tz, o);
    plans++;
    if (!plan) {
      if (o.noWait) return false;
      const sb = o.shelterBox ?? 6, sh = o.shelterHorizon ?? 30;
      const here = planSneak(D, u.x, u.z, { ...o, shelter: true, hold: o.shelterHold ?? 8, box: sb, horizon: sh, maxExpand: 60000 });
      if (here && here.length > 1) { await sneak(D, here[here.length - 1][0], here[here.length - 1][1], { ...o, hold: o.shelterHold ?? 8, label: `${o.label || ''} (shelter)`, noWait: true, box: sb, horizon: sh }); fails = 0; }
      else await D.wait(o.retry ?? (here ? Math.min(0.5 + 0.25 * fails++, 2.5) : 0.5));
      continue;
    }
    fails = 0;
    [gx, gz] = plan[plan.length - 1];
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
    for (const s of segs) {
      if (s.wait) { while (D.t < s.until - 1e-6) await D.wait(D.dt); continue; }
      while (D.t < s.start - 1e-6) await D.wait(D.dt);
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
    if (!late) break;
    if (Math.hypot(u.x - gx, u.z - gz) < 0.9 && stopped() && plans > 3) break;
    try { D.order(who, { type: 'stop' }); } catch { /* already still */ }
  }
  return true;
}
