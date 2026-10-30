/**
 * Green Beret kit for solution scripts: knife (stab), lure-and-knife (lureStab), carry a body (carryBody), bury and
 * hop in the snow / sand (hop), pick the decoy up again (pickUpDecoy), and the cautious look-ahead they share — where
 * a guard will be and every way he may face (predict: halts with their turns and head sweeps, squads, lured men walking
 * back), whether a man (or a body) going along a way stays out of every cone (routeSafe, spotSafe), whether anyone sees
 * a man drop (killSeen). Taken from the M8 solution (tools/solutions/m08.solution.mjs, where it was written and tuned)
 * so other missions can use it; M8 keeps its own copy.
 * @module tools/solutions/gb-kit
 */
import { canSee, coneAt, pointInCone } from '../../src/ai/perception.js';
import { CONFIG } from '../../src/config.js';
import { ABILITIES } from '../../src/abilities/registry.js';
import { angleDiff } from '../../src/core/math.js';

/** shortest signed angle a→b (rad) */
const dAng = (a, b) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
/** headings sweeping from a to b (shortest way), every ~20° */
const arc = (a, b) => {
  // (the brain turns the short way, angleDiff: an exact about-turn goes round clockwise, +π. Only a near about-turn
  // whose sign the walk's rounding may flip goes round either way: both arcs)
  const d = angleDiff(a, b), n = Math.max(1, Math.ceil(Math.abs(d) / 0.35)), out = Array.from({ length: n + 1 }, (_, k) => a + (d * k) / n);
  const off = Math.abs(Math.abs(d) - Math.PI);
  if (off > 1e-6 && off < 0.05) { const d2 = d > 0 ? d - 2 * Math.PI : d + 2 * Math.PI; for (let k = 1; k < n; k++) out.push(a + (d2 * k) / n); }
  return out;
};
const WP_ARRIVE = 0.3; // m: a guard on his route reaches a waypoint this far short of it (enemy-brain _route)
const WP_SHORT = 0.5; // m: and may halt up to this much further back still (M8 e31 halted 0.7 m short at the bridge)
const TURN = 2.0; // s: a guard turning at a halt (or setting off from it) sweeps the arc between the two bearings
/**
 * Headings of a guard `tau` s into a turn from h to h2 (the brain's eased turn: about 180°/s, the short way, an exact
 * about-turn clockwise): where the body points then, ±0.35 rad for the easing, clipped to the arc; [h2] once done.
 */
function turnAt(h, h2, tau) {
  const d = angleDiff(h, h2), dur = Math.abs(d) / Math.PI + 0.2;
  if (tau >= dur + 0.25) return [h2];
  const sg = Math.sign(d) || 1, clip = (v) => Math.max(0, Math.min(Math.abs(d), v));
  const c = Math.PI * Math.max(0, tau - 0.1);
  const arc = [clip(c - 0.35), clip(c), clip(c + 0.35)];
  // (an about-turn, or near enough: which way he turns hangs on a hair of heading — either way round)
  if (Math.abs(d) > Math.PI - 0.25) return [...arc.map((v) => h + v), ...arc.map((v) => h - v)];
  return arc.map((v) => h + sg * v);
}

/**
 * Where enemy `e` will be `t` s from now and every heading he may face then: {x, z, hs: [...]}. A man on his route is
 * walked along it (halts with their waits and looks, LOOP / PINGPONG); in the first TURN s of a halt or of a leg he may
 * face anywhere on the arc he turns through. A man off his route (lure, noise, body) stops where his path ends. A squad
 * member follows his leader at his present offset.
 */
export function predict(e, t, depth = 0) {
  const b = e.brain, r = e.route;
  const lead = depth === 0 && b?._leader?.();
  if (lead && lead !== e && lead.alive && b.state !== 'DISTRACTED') {
    const q = predict(lead, t, 1);
    const off = { x: e.x - lead.x, z: e.z - lead.z };
    if (!q.wait) {
      // (the leader wheeling onto a new leg — at the end of a halt, a corner: the file man behind him turns after his
      // own follow point, either way round, M7 p13b — every way)
      let spread = 0;
      for (const a of q.hs) for (const b2 of q.hs) spread = Math.max(spread, Math.abs(dAng(a, b2)));
      const ALL = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k * Math.PI) / 4);
      return { x: q.x + off.x, z: q.z + off.z, hs: spread > 1 ? [...q.hs, e.heading, ...ALL] : [...q.hs, e.heading] };
    }
    // at a halt where the next leg turns back past the file a file man steps up beside his leader, outside the turn
    // (enemy-brain _besidePoint), walking to that slot and then turning the way the leader looks (M7 p3b / p8b / p10b):
    // where that slot is and every way he faces on the step — the leader's arrival and next leg from his route
    const look = q.hs[q.hs.length - 1], arr = q.arr ?? lead.heading, d = { x: Math.cos(arr), z: Math.sin(arr) }, pl = { x: -d.z, z: d.x };
    const nx = q.next ? q.next.x - q.x : 0, nz = q.next ? q.next.z - q.z : 0, nl = Math.hypot(nx, nz) || 1;
    const turn = q.next ? (nx * d.x + nz * d.z) / nl : 1;
    const filePos = { x: q.x + off.x, z: q.z + off.z };
    if (turn > 0.5) return { x: filePos.x, z: filePos.z, hs: [...arc(arr, look), e.heading], wait: true, into: q.into, early: q.early };
    // (his place relative to the leader as they walked in: what he has now if they walk that same leg)
    const sameLeg = Math.abs(dAng(lead.heading, arr)) < 0.3 && (lead.isMoving || lead.path);
    const rx = sameLeg ? off.x : -d.x * 1.5, rz = sameLeg ? off.z : -d.z * 1.5;
    const back = Math.max(0.35, -(rx * d.x + rz * d.z)), lat = rx * pl.x + rz * pl.z;
    let pref = lat >= 0 ? 1 : -1;
    const single = (e.squad?.columns || 1) <= 1;
    if (single && q.next) { const sd = (nx * pl.x + nz * pl.z) / nl; if (Math.abs(sd) > 0.25) pref = sd > 0 ? -1 : 1; }
    const sides = sameLeg && Math.abs(lat) > 0.3 ? [pref] : [pref, -pref]; // (unsure which side he takes: both)
    const o = Math.max(1.0, Math.abs(lat)), slots = sides.map((sg) => ({ x: q.x + pl.x * sg * o - d.x * back, z: q.z + pl.z * sg * o - d.z * back }));
    const hs = [];
    const into = q.into ?? 0;
    for (const sl of slots) {
      const hb = Math.atan2(sl.z - filePos.z, sl.x - filePos.x);
      if (into < 1.7) hs.push(...arc(arr, hb), ...arc(hb, look));
    }
    hs.push(look, e.heading);
    return { x: slots[0].x, z: slots[0].z, hs, wait: true, into: q.into, early: q.early, alt: [...slots.slice(1), filePos] };
  }
  const sp = e.speed ?? 1.0;
  // a man staring at a lure under the mission's dwell cap (rules.decoyMaxDwell) stares on until it runs out, then goes
  // back (RETURN, at investigate pace) to the nearest waypoint of his beat and walks on along it
  const cap = (e.world ?? b?.world)?.mission?.rules?.decoyMaxDwell;
  if (cap != null && b?.state === 'DECOY' && b.phase === 'stare' && r?.length > 1 && depth < 2) {
    let stay = Math.max(0, cap - b.t) + 0.15;
    // (or, the lure switched off, until he gives up on it: giveUp s after he last heard it pulse)
    const lg = b.goal, src = lg?.source, DC = CONFIG.ai.decoy, lw = e.world ?? b.world;
    const off = src && (src.on === false || src.active === false || src.removed);
    if (off) stay = Math.min(stay, Math.max(0, (DC.giveUp ?? 5) - (lg.offT ?? 0) + (lg.offT > 0 ? 0 : Math.max(0, (DC.pulse ?? 1.5) + 0.25 - (lw.time - (lg.lastPulse ?? lw.time))))) + 0.15);
    if (t <= stay) return { x: e.x, z: e.z, hs: [e.heading], stare: true }; // (he stares straight at it: no head sweep)
    let hi = 0;
    r.forEach((p, k) => { if (Math.hypot(p.x - e.x, p.z - e.z) < Math.hypot(r[hi].x - e.x, r[hi].z - e.z)) hi = k; });
    const home = r[hi], vs = CONFIG.ai.investigate.speed ?? 1.8;
    let x = e.x, z = e.z, h = e.heading, left = t - stay - 0.3;
    if (left <= 0) return { x, z, hs: [h] };
    for (const p of legPath(e, x, z, home)) {
      const dx = p.x - x, dz = p.z - z, L = Math.hypot(dx, dz);
      if (L < 1e-6) continue;
      const h2 = Math.atan2(dz, dx);
      if (left * vs <= L) return { x: x + (dx / L) * left * vs, z: z + (dz / L) * left * vs, hs: Math.abs(dAng(h, h2)) > 0.2 ? [h, h2] : [h2], curved: true };
      left -= L / vs; x = p.x; z = p.z; h = h2;
    }
    const g = Object.create(e), gb = Object.create(b);
    for (const [k, v] of Object.entries({ x: home.x, z: home.z, heading: h, path: null, isMoving: false, brain: gb })) Object.defineProperty(g, k, { value: v, writable: true });
    Object.assign(gb, { state: 'IDLE', atWait: false, routeIndex: hi, distractedBy: null, _leader: () => null });
    return predict(g, left, 2);
  }
  const onRoute = r && r.length > 1 && b && (b.state === 'IDLE' || b.state === 'REINFORCE' || b.state === 'RETURN') && !b.distractedBy;
  if (!onRoute) {
    if (!(e.isMoving || e.path)) return { x: e.x, z: e.z, wait: true, hs: [e.heading] };
    let x = e.x, z = e.z, h = e.heading, dist = sp * t;
    for (const p of e.path.slice(e.pathIndex ?? 0)) {
      const dx = p.x - x, dz = p.z - z, L = Math.hypot(dx, dz);
      if (L < 1e-6) continue;
      const h2 = Math.atan2(dz, dx);
      if (dist <= L) return { x: x + (dx / L) * dist, z: z + (dz / L) * dist, hs: [h2, h] };
      dist -= L; x = p.x; z = p.z; h = h2;
    }
    return { x, z, hs: [h, e.heading] };
  }
  let x = e.x, z = e.z, h = e.heading, left = t, since = b.atWait ? 99 : 0; // since: s into the current leg
  let i = b.routeIndex ?? 0, dir = b.routeDir ?? 1;
  const loop = (b._routeType || e.spawn?.route?.type || e.routeMode || 'PINGPONG').toUpperCase() === 'LOOP' || e.routeMode === 'loop';
  const loopStart = b._loopStart ?? 0;
  const look = (wp) => (wp?.look != null ? (wp.look * Math.PI) / 180 : null);
  if (b.atWait) {
    const wp = r[i], waitLeft = Math.max(0, b.waitT ?? 0), into = (wp?.wait ?? 0) - waitLeft, lk = look(wp);
    if (left <= waitLeft) {
      const pv = r[loop ? (i - 1 + r.length) % r.length : Math.max(0, Math.min(r.length - 1, i - dir))];
      return { x, z, wait: true, into: into + left, early: into + left < 1.2, hs: lk == null ? [h] : turnAt(h, lk, into + left), arr: pv && pv !== wp ? Math.atan2(wp.z - pv.z, wp.x - pv.x) : h, next: peekNext(i) };
    }
    if (lk != null) h = lk;
    left -= waitLeft; i = nextIdx(i); since = 0; // (the next leg starts when the halt ends: he turns onto it then)
  }
  // (on his way to a waypoint he follows his planned path round whatever is in the way: walk that first)
  if (!b.atWait && e.path && (e.pathIndex ?? 0) < e.path.length) {
    for (const p of e.path.slice(e.pathIndex ?? 0)) {
      const dx = p.x - x, dz = p.z - z, L = Math.hypot(dx, dz);
      if (L < 1e-6) continue;
      const h2 = Math.atan2(dz, dx);
      if (left * sp <= L) return { x: x + (dx / L) * left * sp, z: z + (dz / L) * left * sp, hs: Math.abs(dAng(h, h2)) > 0.2 && t - left < TURN ? arc(h, h2) : [h2], curved: e.path.length - (e.pathIndex ?? 0) > 1 };
      left -= L / sp; x = p.x; z = p.z; h = h2;
    }
  }
  for (let guard = 0; guard < 64; guard++) {
    const wp = r[i];
    // (a later leg: the path he will plan round what is in the way, from where his last halt left him)
    // (the tick his halt ends he has no path yet: the one he is about to plan)
    const pts = guard === 0 && !b.atWait && e.path ? [wp] : legPath(e, x, z, wp);
    let tin0 = guard === 0 ? since : 0;
    // (the turn onto a leg goes on while he walks it: a first path point a few cm off does not end it)
    const hLeg = h; let tLeg = tin0;
    const legTurn = (h2, tt) => (Math.abs(dAng(hLeg, h2)) > 0.2 ? turnAt(hLeg, h2, tt) : []);
    for (const p of pts) {
      const dx = p.x - x, dz = p.z - z, L = Math.hypot(dx, dz);
      if (L < 1e-6) continue;
      const h2 = Math.atan2(dz, dx);
      if (left * sp <= L) {
        const tin = left + tin0;
        // (he halts a few decimetres short of a waypoint — the arrival tolerance — and starts his turn and his head sweep
        // there: the last half metre of a leg into a halt counts as the halt's start too)
        if (p === pts[pts.length - 1] && wp.wait > 0 && L - left * sp < 0.6) {
          const lk = look(wp);
          const at = Math.min(left * sp, Math.max(0, L - WP_ARRIVE)); // (he stops WP_ARRIVE short of it)
          const hx = x + (dx / L) * at, hz = z + (dz / L) * at;
          return { x: hx, z: hz, alt: [{ x: hx - (dx / L) * WP_SHORT, z: hz - (dz / L) * WP_SHORT }], wait: true, into: 0, early: true, hs: [h2, ...(lk == null ? [] : turnAt(h2, lk, 0.2))], arr: h2, next: peekNext(i) };
        }
        return { x: x + (dx / L) * left * sp, z: z + (dz / L) * left * sp, hs: [...(Math.abs(dAng(h, h2)) > 0.2 ? turnAt(h, h2, tin) : [h2]), ...legTurn(h2, tLeg + left)], curved: pts.length > 1 };
      }
      left -= L / sp; x = p.x; z = p.z; h = h2; tin0 = 0; tLeg += L / sp; // (he turns at each corner of his path too)
    }
    x = wp.x; z = wp.z;
    // (a halt is made where he first comes within WP_ARRIVE of the waypoint, short of it along his way in: the edge of
    // his cone there moves with him — M8 e19 halts at x 34.2 on the roof, not 34.5)
    if (wp.wait > 0 || wp.look != null) { x -= Math.cos(h) * WP_ARRIVE; z -= Math.sin(h) * WP_ARRIVE; }
    const lk = look(wp);
    if (wp.wait > 0) {
      // (or up to WP_SHORT further back: a guard bumping along a lane or round a man may stop short of that)
      if (left <= wp.wait) return { x, z, alt: [{ x: x - Math.cos(h) * WP_SHORT, z: z - Math.sin(h) * WP_SHORT }], wait: true, into: left, early: left < 1.2, hs: lk == null ? [h] : turnAt(h, lk, left), arr: h, next: peekNext(i) };
      if (lk != null) h = lk;
      left -= wp.wait;
    }
    i = nextIdx(i);
  }
  return { x, z, hs: [h] };
  function nextIdx(k) {
    if (loop) return k + 1 < r.length ? k + 1 : Math.min(loopStart, r.length - 1);
    if (k + dir >= r.length || k + dir < 0) dir *= -1;
    return k + dir;
  }
  /** the waypoint after `k` (no change to the walk's direction) */
  function peekNext(k) {
    if (loop) return r[k + 1 < r.length ? k + 1 : Math.min(loopStart, r.length - 1)];
    const dd = k + dir >= r.length || k + dir < 0 ? -dir : dir;
    return r[k + dd];
  }
}

export const deg = (h) => ((h * 180) / Math.PI + 360) % 360;

/** The path enemy `e` would plan from (x, z) to waypoint `wp` (cached per guard and leg; straight if none). */
function legPath(e, x, z, wp) {
  const c = (e._legPaths ??= new Map()), k = `${x.toFixed(1)},${z.toFixed(1)}>${wp.x},${wp.z}`;
  if (!c.has(k)) {
    let p = null;
    try { const g = Object.create(e); g.x = x; g.z = z; p = g._planPath?.(wp.x, wp.z); } catch { p = null; }
    c.set(k, p?.length ? p.map((q) => ({ x: q.x, z: q.z })) : [wp]);
  }
  return c.get(k);
}

/**
 * Exposure watch (user 2026-10-08: no commando inside a live cone without being spotted): after every tick every live
 * commando is tried against every live cone with the AI's own rule (perception.canSee). The driver's own watch is used
 * when it has one (D.exposures); otherwise this one wraps D.until / D.wait (every tick of the solution runs through them).
 */
export function installWatch(D) {
  if (D.exposures) return;
  const w = D.world, exposures = new Map();
  const check = () => {
    const cs = w.commandos.filter((c) => c.alive);
    for (const e of w.enemies) {
      if (!e.alive || e.removed || !e.vision || e.incapacitated || e.brain?.arch?.reacts === false) continue;
      const cone = coneAt(e, w.time);
      for (const c of cs) {
        const band = canSee(e, c, w, { cone });
        if (band === 'none') continue;
        const what = c.vehicle ? `${c.role} in ${c.vehicle.tag ?? c.vehicle.id}` : `${c.role} ${c.stance}`;
        const k = `${e.tag}|${what}`;
        let x = exposures.get(k);
        if (!x) exposures.set(k, x = { viewer: e.tag, target: what, band, from: w.time, to: w.time, ticks: 0, at: `(${c.x.toFixed(1)},${c.z.toFixed(1)}) d=${Math.hypot(e.x - c.x, e.z - c.z).toFixed(1)}` });
        x.to = w.time; x.ticks++;
        if (band === 'near') x.band = 'near';
      }
    }
  };
  const until = D.until;
  let last = -1;
  D.until = (pred, maxSec, label) => until((() => { if (w.tick !== last) { last = w.tick; check(); } return pred(); }), maxSec, label);
  D.wait = async (sec) => { const end = w.time + sec - 1e-6; await D.until(() => w.time >= end, sec + 5, 'wait'); };
  D.exposures = () => [...exposures.values()];
  D.exposureReport = () => [...exposures.values()].map((x) => `${x.viewer} saw ${x.target} (${x.band}) ${x.ticks} ticks t=${x.from.toFixed(2)}–${x.to.toFixed(2)} first at ${x.at}`);
}

// ------------------------------------------------------------------------------------------------ helpers

/** Will enemy `e` move in the next seconds (walking now, or on his beat)? A man staring at a lure or holding a post stands. */
export const walker = (e) => !!(e.isMoving || e.path || (e.route?.length > 1 && ['IDLE', 'RETURN', 'REINFORCE'].includes(e.brain?.state) && !e.brain?.distractedBy)
  // (and a man staring at a lure under a dwell cap: he will walk back, predict() knows when)
  || (e.route?.length > 1 && e.brain?.state === 'DECOY' && e.brain.phase === 'stare' && (e.world ?? e.brain.world)?.mission?.rules?.decoyMaxDwell != null));

/** Could enemy `e` (or his predicted self `q` at sim time `tAbs`) see `dummy`? A walker's head is tried across his sweep. */
export function sees(e, q, dummy, w, tAbs, moving, fan = false) {
  if (!moving) return canSee(e, dummy, w, { cone: coneAt(e, tAbs) }) !== 'none';
  // (a walker on a leg looks straight ahead; at a halt his head sweeps ±50° every 2.5 s: any offset, CONFIG patrolWatch)
  // (on a leg his heading follows a path planned round things in the way, which may bend from the predicted one: a few
  // degrees either side)
  // (at a halt his head sweeps on the world clock, perception.sweepOffset: where it points at that moment, or still
  // centred while the sweep fades back in after his turn)
  const PW = CONFIG.stealth.vision.patrolWatch ?? { sweep: 50, period: 2.5 };
  // (the sweep runs on the world clock but his turn into the halt need not land where predicted: early in a halt the
  // head where the sweep is then, give or take 0.4 s)
  const swAt = (dt) => ((PW.sweep * Math.PI) / 180) * Math.sin((2 * Math.PI * (tAbs + dt + (e.vision?.phase || 0))) / PW.period);
  const J = q.curved ? 0.21 : 0.07;
  // (only in the first second of a halt: later the sweep is where the world clock says, ±0.1 s — the checks sample time
  // on a 0.1 s grid at best, and the far edge of a swept cone may touch a spot for only a tick or two at the sweep's end)
  // (`fan`: at a halt, anywhere his head may sweep — the moment a man stands up is checked against all of it)
  const FAN = fan && q.wait ? Array.from({ length: 11 }, (_, i) => ((PW.sweep * Math.PI) / 180) * (i / 5 - 1)) : null;
  // (and on a leg, a path bent round something in the real game: up to 20° either way)
  const LEG = fan ? [0, 0.17, -0.17, 0.35, -0.35] : [0, J, -J];
  // (a man staring at a lure holds his head on it: no sweep, no bend)
  for (const pos of q.alt ? [q, ...q.alt] : [q]) for (const hd of q.hs) for (const off of q.stare ? [0] : FAN ?? (q.wait ? (q.early ? [0, swAt(-0.4), swAt(0), swAt(0.4)] : [0, swAt(-0.1), swAt(0), swAt(0.1)]) : LEG)) {
    const g = Object.create(e);
    g.x = pos.x; g.z = pos.z; g.heading = hd; g.sweepActive = false; g.headOffset = off;
    if (canSee(g, dummy, w, { cone: coneAt(g, tAbs) }) !== 'none') return true;
  }
  return false;
}

/**
 * The cautious version of D.routeClear: would a man going along `pts` from `from` (default where he is) at `speed`
 * stay unseen? Every sample is tried over a slack window of time around its moment and also `pad` m nearer to each
 * viewer (his pace and the guards' drift from the prediction), and for `hold` s at the end. `standLast`: he stands
 * up for the last that many metres and the hold (a knife approach). `except`: tags ignored; `victim`: the man he
 * goes for (his cone counts, but not his nearness). Returns true, or false with the reasons pushed on `why`.
 */
/** routeSafe0, timed into `globalThis.__routeSafeStats` when a probe sets it up ({n, sum, max}) */
export function routeSafe(D, role, pts, o) {
  const st = globalThis.__routeSafeStats;
  if (!st) return routeSafe0(D, role, pts, o);
  const t0 = performance.now(), r = routeSafe0(D, role, pts, o), dt = performance.now() - t0;
  st.n++; st.sum += dt; if (dt > st.max) { st.max = dt; st.at = D.t; st.len = pts?.length ?? 0; }
  return r;
}

function routeSafe0(D, role, pts, o) { const g = routeSafeGen(D, role, pts, o); for (;;) { const r = g.next(); if (r.done) return r.value; } }

/**
 * routeSafe as a sliced job (a generator: it yields between guards and every few samples, so the live replay can hand
 * the frame back — driver runSliced; `yield*` it from a sliced check). Same arguments, same answer.
 */
export function* routeSafeGen(D, role, pts, { speed = 0.9, low = true, delay = 0.2, step = 0.3, pad = 1.5, slack = [-0.6, 1.2], hold = 0, minDist = 5,
  except = [], victim = null, standLast = 0, from = null, why = null, all = false, body = false, expand = true, lat = 0, fan = false } = {}) {
  const w = D.world, u = D.c(role);
  // (the way his feet will really go: each leg as the path planner lays it)
  if (expand && pts.length) pts = planned(D, role, pts, from ?? [u.x, u.z]);
  const samples = [];
  let [x, z] = from ?? [u.x, u.z], t = delay;
  let total = 0;
  { let px0 = x, pz0 = z; for (const [px, pz] of pts) { total += Math.hypot(px - px0, pz - pz0); px0 = px; pz0 = pz; } }
  let run = 0;
  samples.push([x, z, t, low && (standLast <= 0 || total > standLast)]);
  for (const [px, pz, pause = 0] of pts) {
    const L = Math.hypot(px - x, pz - z), n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) samples.push([x + ((px - x) * k) / n, z + ((pz - z) * k) / n, t + (L * k) / n / speed, low && (standLast <= 0 || run + (L * k) / n < total - standLast)]);
    t += L / speed; x = px; z = pz; run += L;
    for (let h = 0.5; h <= pause + 1e-6; h += 0.5) samples.push([x, z, t + h, low]);
    t += pause;
  }
  for (let h = 0.5; h <= hold + 1e-6; h += 0.5) samples.push([x, z, t + h, low && standLast <= 0]);
  let bad = false; // (`all`: debugging, every viewer that fails it is listed in `why`)
  // (the samples' box and last moment: a guard who cannot come within his far range of the box by then is left out)
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity, tEnd = 0;
  for (const [sx, sz, st] of samples) { if (sx < bx0) bx0 = sx; if (sx > bx1) bx1 = sx; if (sz < bz0) bz0 = sz; if (sz > bz1) bz1 = sz; if (st > tEnd) tEnd = st; }
  tEnd += Math.max(0, slack[1]);
  viewers: for (const e of w.enemies) {
    if (!e.alive || e.removed || !e.vision || except.includes(e.tag) || e.incapacitated) continue;
    yield;
    const moving = walker(e);
    const far = (e.vision.far ?? 36) + 2, isV = Array.isArray(victim) ? victim.includes(e.tag) : e.tag === victim;
    {
      const ox = Math.max(bx0 - e.x, 0, e.x - bx1), oz = Math.max(bz0 - e.z, 0, e.z - bz1);
      const reach = far + pad + minDist + (moving ? 2.2 * (tEnd + 1) + 2 : 0);
      if (ox * ox + oz * oz > reach * reach) continue;
    }
    // (a posted man's sweep is a known function of time: only the commando's own timing is uncertain, ±0.3 s; a
    // walker's pace and turns drift from the prediction: the full slack)
    const [s0, s1] = moving ? slack : [Math.max(slack[0], -0.6), Math.min(slack[1], 0.6)];
    let si = 0;
    for (const [sx, sz, st, slow] of samples) {
      if ((++si & 15) === 0) yield;
      for (let o = s0; o <= s1 + 1e-6; o += moving ? 0.3 : 0.05) { // (a post's sweep: densely, its cone may touch a spot only for an instant)
        const tt = Math.max(0, st + o);
        const q = moving ? predict(e, tt) : { x: e.x, z: e.z, hs: [e.heading] };
        const dd = Math.hypot(q.x - sx, q.z - sz);
        if (dd > far + pad) continue;
        // (a man staring at a lure does not walk into anyone)
        if (moving && !isV && dd < minDist && !q.stare) { why?.push(`${e.tag} close@(${sx.toFixed(1)},${sz.toFixed(1)})+${st.toFixed(1)}`); if (all) { bad = true; continue viewers; } return false; }
        const y = w.grid.elevAt?.(sx, sz) ?? 0;
        const pts2 = [[sx, sz]];
        if (!isV && pad > 0 && dd > pad + 0.5) pts2.push([sx + ((q.x - sx) * pad) / dd, sz + ((q.z - sz) * pad) / dd]);
        // (`lat`: also that far either side across his line of sight — the man's real track may wander off the planned
        // one where the edge of what a viewer sees is ragged, e.g. looking down from a rim)
        if (lat > 0 && dd > 0.5) {
          const ux = (q.z - sz) / dd, uz = -(q.x - sx) / dd;
          pts2.push([sx + ux * lat, sz + uz * lat], [sx - ux * lat, sz - uz * lat]);
          // (and the ground between him and the `pad` point too, every 0.25 m: the seen ground may be a thin band there)
          for (let k = 0.25; k < pad; k += 0.25) if (dd > k + 0.5) pts2.push([sx + ((q.x - sx) * k) / dd, sz + ((q.z - sz) * k) / dd]);
        }
        for (const [px, pz] of pts2) {
          // (`body`: a corpse lying there — seen in both bands, but low behind cover and under a raised edge)
          const dummy = body ? { kind: 'body', x: px, z: pz, y } : { x: px, z: pz, y, isLow: slow, isVisibleToEnemies: true };
          if (sees(e, q, dummy, w, w.time + tt, moving, fan && !slow)) { why?.push(`${e.tag}@(${sx.toFixed(1)},${sz.toFixed(1)})${slow ? '' : 'S'}+${st.toFixed(1)}`); if (all) { bad = true; continue viewers; } return false; }
        }
      }
    }
  }
  return !bad;
}

/**
 * D.go, but a stop up to 1.5 m short of the spot (a barrel or a man in the way the planner went round differently)
 * is accepted: he lies (or digs in) there instead of standing up in the open to try again.
 */
export async function goLoose(D, role, x, z, tol = 0.35) {
  try { await D.go(role, x, z, { tol }); } catch (err) {
    const u = D.c(role), d = Math.hypot(u.x - x, u.z - z);
    if (!/stopped at/.test(err.message) || d > 1.5) throw err;
    D.log(`  (${role} stopped ${d.toFixed(2)} m short of (${x},${z}): stays there)`);
  }
}

/**
 * The way `role` will really go along `pts` from (x, z): each leg as his path planner lays it (round walls, barrels,
 * racks), so the window checks follow his feet. A point's pause / callback stays on it.
 */
export function planned(D, role, pts, from = null) {
  const u = D.c(role), out = [];
  let [x, z] = from ?? [u.x, u.z];
  for (const p of pts) {
    let path = null;
    try { const g = Object.create(u); g.x = x; g.z = z; path = g._planPath?.(p[0], p[1]); } catch { path = null; }
    if (path?.length > 1) for (const q of path.slice(1, -1)) if (Math.hypot(q.x - x, q.z - z) > 0.05) out.push([q.x, q.z]);
    out.push(p);
    [x, z] = p;
  }
  return out;
}

/**
 * Wait (up to maxWait) until `role` can go the whole way along `pts` unseen and lie (or stand) at its end for `stay` s
 * (routeSafe), then go — without stopping: the end of a sneak is where he may have to wait for the next window, so it
 * must be a spot nobody overlooks for a while.
 */
export async function sneakRoute(D, role, pts, { low = true, speed = null, maxWait = 300, stay = 4, delay = 0.3, run = false, when = null, minDist = 5, pad = 1.5, slack = undefined, lat = 0 } = {}) {
  const u = D.c(role);
  if (low && u.stance !== 'crawl') await D.stance(role, 'crawl');
  // (from a crawl he stands up only once the window opens: the getting up is part of the exposure checked)
  const getUp = () => (!low && u.stance !== 'stand' ? (CONFIG.units.stanceUp ?? 0.6) + 0.1 : 0);
  const sp = speed ?? (low ? 0.9 : run ? (role === 'greenberet' ? 5.4 : 4.5) : u.carrying ? 1.6 : 2.25);
  const why = [], whys = [];
  const way = planned(D, role, pts);
  let next = 0;
  await D.until(() => {
    if (D.t < next) return false;
    next = D.t + 0.25;
    if (why.length) { whys.push(`${D.t.toFixed(1)}:${why.join(' ')}`); if (whys.length > 5) whys.shift(); }
    why.length = 0;
    const g = getUp();
    return (!when || when()) && routeSafe(D, role, g ? [[u.x, u.z, g], ...way] : way, { low, speed: sp, delay, hold: stay, why, minDist, pad, slack, lat });
  }, maxWait, `${role} sneaks to (${pts[pts.length - 1]})`).catch((e) => { throw new Error(`${e.message} [${whys.join(' | ')}]`); });
  if (!low && u.stance !== 'stand') await D.stance(role, 'stand');
  let prev = [u.x, u.z];
  for (const p of pts) {
    try { await D.go(role, p[0], p[1], { tol: 0.35, run }); } catch (err) {
      // (stopped short — a man or a barrel in the way the planner went round otherwise: once more from where he is; and
      // if a crawler's long body is caught turning against something, back to where the leg began and on again)
      if (!/stopped at/.test(err.message) || Math.hypot(u.x - p[0], u.z - p[1]) > 3) throw err;
      try { await D.go(role, p[0], p[1], { tol: 0.35, run }); } catch (err2) {
        if (!/stopped at/.test(err2.message)) throw err2;
        D.log(`DBG ${role} stuck at (${u.x.toFixed(2)},${u.z.toFixed(2)}) on the way to (${p[0]},${p[1]}): back to (${prev[0].toFixed(2)},${prev[1].toFixed(2)}) and on`);
        await D.go(role, prev[0], prev[1], { tol: 0.35, run });
        await D.go(role, p[0], p[1], { tol: 0.35, run });
      }
    }
    prev = [p[0], p[1]];
    if (p[3]) await p[3]();
  }
}

/**
 * An approach to a WALKING man from behind: along `via`, then on to the point 1 m behind where he will be by the time
 * the GB (at `speed`, after `getUp` s) gets there — so the stab check plans the kill where it will happen.
 */
export function chaseApproach(D, e, via, { speed = 2.25, getUp = 0.7, behindBy = 1.0 } = {}) {
  const gb = D.c('greenberet');
  const len = via.reduce((a, p) => [a[0] + Math.hypot(p[0] - a[1][0], p[1] - a[1][1]), p], [0, [gb.x, gb.z]])[0];
  const from = via.length ? via[via.length - 1] : [gb.x, gb.z];
  let T = getUp + len / speed, pt = from;
  for (let k = 0; k < 4; k++) {
    const q = predict(e, T), h = q.hs[0];
    pt = [q.x - Math.cos(h) * behindBy, q.z - Math.sin(h) * behindBy];
    T = getUp + (len + Math.hypot(pt[0] - from[0], pt[1] - from[1])) / speed;
  }
  return [...via, pt];
}

/** the point `d` m behind enemy `e` (opposite his heading) */
export const behind = (e, d = 1) => [e.x - Math.cos(e.heading) * d, e.z - Math.sin(e.heading) * d];
/** the point `d` m off enemy `e`'s side, `off` rad round from his heading (a knife from there is a frontal kill: he turns
 * to the blade and falls back away from it, not forward onto what he was looking at) */
export const beside = (e, off, d = 1) => [e.x + Math.cos(e.heading + off) * d, e.z + Math.sin(e.heading + off) * d];

/**
 * A burrow hop: the GB (buried, or lying) rises if buried, crawls along `pts` and digs himself in at the last one
 * (sand), all in one window: the rising (he stands up out of the mound, then drops flat), the crawl and the dig must
 * stay out of every cone. Buried, nobody sees him (only the men who watched him dig, and nobody does).
 */
export async function hop(D, pts, { maxWait = 300, pad = 0.5, minDist = 3, when = null, bury = true, slack = [-0.3, 0.9], fan = false } = {}) {
  const gb = D.c('greenberet');
  const RISE = CONFIG.abilities.rise ?? 1.0, UP = RISE + (CONFIG.units.stanceDown ?? 0.5) + 0.3, DIG = (CONFIG.abilities.dig ?? 2.0) + 0.6;
  const why = [], whys = [];
  const way = planned(D, 'greenberet', pts);
  let next = 0;
  await D.until(() => {
    if (D.t < next) return false;
    next = D.t + 0.25;
    if (why.length) { whys.push(`${D.t.toFixed(1)}:${why.join(' ')}`); if (whys.length > 5) whys.shift(); }
    why.length = 0;
    if (when && !when()) return false;
    const up = gb.buried ? UP : 0;
    // (he is still under the sand for the rise itself, CONFIG.abilities.rise s; then he stands until he drops flat)
    // (our own timing is exact and the walkers' predictions good to half a metre: a tight slack for the moment he stands)
    if (up && !routeSafe(D, 'greenberet', [], { from: [gb.x, gb.z], low: false, hold: up - RISE, delay: RISE, pad, minDist, why, slack: [Math.min(-0.5, slack[0]), Math.max(0.9, slack[1])], fan })) return false;
    return routeSafe(D, 'greenberet', way, { delay: up + 0.2, hold: bury ? DIG : 3, pad, minDist, why, standLast: -1, slack });
  }, maxWait, `GB hops to (${pts[pts.length - 1]})`).catch((e) => { throw new Error(`${e.message} [${whys.join(' | ')}]`); });
  if (gb.buried) {
    D.ability('greenberet', 'shovel');
    await D.until(() => !gb.buried && !gb.currentAction, 5, 'GB out of the sand');
  }
  if (gb.stance !== 'crawl') await D.stance('greenberet', 'crawl');
  for (const p of pts) { await goLoose(D, 'greenberet', p[0], p[1]); if (p[3]) await p[3](); }
  if (bury) {
    const can = ABILITIES.shovel?.canUse?.(gb, gb, D.world);
    if (can !== true) D.log(`  (shovel refused at (${gb.x.toFixed(2)},${gb.z.toFixed(2)}): ${can})`);
    D.ability('greenberet', 'shovel');
    await D.until(() => gb.buried, 5, 'GB dug in');
  }
}

/** the GB picks his decoy up again (it must be off) */
export async function pickUpDecoy(D, { maxWait = 120, pad = 1.5, when = () => true } = {}) {
  const gb = D.c('greenberet'), dc = gb.decoy;
  if (dc?.on) D.ability('greenberet', 'decoyToggle');
  // (he gets up for it, and bends over it: a moment nobody may look there)
  const why = [];
  await D.until(() => { why.length = 0; return when() && routeSafe(D, 'greenberet', [[gb.x, gb.z, 0.7]], { low: false, hold: 2.5, pad, minDist: 3, why }); }, maxWait, 'window to pick the decoy up')
    .catch((err) => { throw new Error(`${err.message} [${why.join(' ')}]`); });
  await D.stance('greenberet', 'stand');
  D.ability('greenberet', 'hand', dc);
  await D.until(() => gb.has('decoy'), 30, 'decoy picked up');
  await D.stance('greenberet', 'crawl');
}

/**
 * Would anyone (but `except`) see enemy `e` drop dead `dt` s from now? A kill is witnessed by every man whose cone
 * holds the falling victim (EnemyBrain.notifyKill: full cone, the raised-edge rule waits until he lies).
 */
export function killSeen(D, e, dt, { except = [], why = null, slack = [-0.3, 0.6] } = {}) {
  const w = D.world;
  const q0 = walker(e) ? predict(e, dt) : e;
  // (where he will fall, give or take: a halt short of its waypoint, the prediction's drift — a line of sight that
  // grazes an edge flips over a few decimetres)
  const spots = [[q0.x, q0.z], [e.x, e.z], [q0.x + 0.4, q0.z], [q0.x - 0.4, q0.z], [q0.x, q0.z + 0.4], [q0.x, q0.z - 0.4]];
  for (const [sx, sz] of spots) if (killSeenAt(D, e, dt, sx, sz, { except, why, slack })) return true;
  return false;
}
function killSeenAt(D, e, dt, sx, sz, { except, why, slack }) {
  const w = D.world;
  const dummy = { kind: 'body', falling: true, x: sx, z: sz, y: e.y || 0 };
  for (const o of w.enemies) {
    if (o === e || !o.alive || o.removed || !o.vision || except.includes(o.tag) || o.incapacitated) continue;
    if (Math.hypot(o.x - dummy.x, o.z - dummy.z) > (o.vision.far ?? 36) + 12) continue;
    const moving = walker(o);
    for (let sl = slack[0]; sl <= slack[1] + 1e-6; sl += 0.15) {
      const tt = Math.max(0, dt + sl);
      const q = moving ? predict(o, tt) : { x: o.x, z: o.z, hs: [o.heading] };
      if (sees(o, q, dummy, w, w.time + tt, moving)) { why?.push(`${o.tag} sees ${e.tag} fall`); return true; }
    }
  }
  return false;
}

/** Will enemy `o` see `dummy` (a perception target) at any time from `t0` to `t1` s from now? */
export function seenBy(D, o, dummy, t0, t1, step = 0.2) {
  if (!o.alive || o.removed || !o.vision) return false;
  const moving = walker(o);
  // (a posted man's sweep may graze a spot for a tick or two only: every 0.025 s, the cheap cone test first)
  if (!moving) {
    for (let tt = Math.max(0, t0); tt <= t1 + 1e-6; tt += 0.025) {
      const cone = coneAt(o, D.world.time + tt);
      if (pointInCone(cone, dummy.x, dummy.z) && canSee(o, dummy, D.world, { cone }) !== 'none') return true;
    }
    return false;
  }
  for (let tt = Math.max(0, t0); tt <= t1 + 1e-6; tt += step) {
    const q = moving ? predict(o, tt) : { x: o.x, z: o.z, hs: [o.heading] };
    if (sees(o, q, dummy, D.world, D.world.time + tt, moving)) return true;
  }
  return false;
}

/** Will a body (or a standing man) at (x, z) stay out of every cone for the next `dur` s (in `delay` s)? */
export function spotSafe(D, x, z, dur, { except = [], delay = 0, pad = 1, why = null, body = false } = {}) {
  return routeSafe(D, 'greenberet', [], { from: [x, z], low: false, hold: dur, delay, pad, except, why, minDist: 3, body });
}

/** The GB shoulders the body of `tag`, carries it along `pts` (standing, unseen) and puts it down at the last one. */
export async function carryBody(D, tag, pts, { maxWait = 120, check = true, pad = 1.5, pre = [], slack = undefined, fan = false, when = () => true } = {}) {
  const gb = D.c('greenberet'), e = D.get(tag);
  if (check && gb.stance !== 'stand') {
    // (a crawl to the body along `pre`, then he gets up, shoulders the man and walks off with him: one window for the lot)
    const why = [];
    // (the crawl's time along the way his feet will really go: the planner's path, round walls and through gaps)
    const prePath = pre.length ? planned(D, 'greenberet', pre, [gb.x, gb.z]) : [];
    const tPre = prePath.reduce((a, p) => [a[0] + Math.hypot(p[0] - a[1][0], p[1] - a[1][1]), p], [0, [gb.x, gb.z]])[0] / 0.9;
    const at = pre.length ? pre[pre.length - 1] : [gb.x, gb.z];
    await D.until(() => { why.length = 0;
      if (!when()) { why.push('when'); return false; }
      return (!pre.length || routeSafe(D, 'greenberet', pre, { delay: 0.3, hold: 0, pad, minDist: 3, except: [tag], why, slack }))
        && routeSafe(D, 'greenberet', [[at[0], at[1], 3.0], ...pts], { from: at, low: false, speed: 1.5, delay: 0.3 + tPre, hold: 1, pad, minDist: 3, except: [tag], why, slack, fan })
        // (he may have the man on his shoulder well inside those 3 s: the walk off from a quick pick-up too)
        && routeSafe(D, 'greenberet', [[at[0], at[1], 1.0], ...pts], { from: at, low: false, speed: 1.5, delay: 0.3 + tPre, hold: 0, pad, minDist: 3, except: [tag], why, slack, fan }); },
      maxWait, `window to carry ${tag}`).catch((err) => { throw new Error(`${err.message} [${why.join(' ')}]`); });
    for (const p of pre) await D.go('greenberet', p[0], p[1], { tol: 0.35 });
    await D.stance('greenberet', 'stand');
    D.ability('greenberet', 'hand', e);
    await D.until(() => gb.carrying === e, 10, `GB shoulders ${tag}`);
    for (const p of pts) await D.go('greenberet', p[0], p[1], { tol: 0.4 });
    D.ability('greenberet', 'drop');
    await D.until(() => !gb.carrying, 5, `${tag} put down`);
    await D.idle('greenberet');
    await D.stance('greenberet', 'crawl');
    return;
  }
  await D.stance('greenberet', 'stand');
  D.ability('greenberet', 'hand', e);
  await D.until(() => gb.carrying === e, 10, `GB shoulders ${tag}`);
  if (check) await sneakRoute(D, 'greenberet', pts, { low: false, speed: 1.5, maxWait });
  else for (const p of pts) await D.go('greenberet', p[0], p[1], { tol: 0.4 });
  D.ability('greenberet', 'drop');
  await D.until(() => !gb.carrying, 5, `${tag} put down`);
  await D.idle('greenberet');
  await D.stance('greenberet', 'crawl');
}

/**
 * Knife `tag`: the GB crawls along `approach` (its last point within reach of where the victim will be) and stands up
 * to stab — but only once the whole approach, the stand-up and the stab are out of every cone (the victim's too) and
 * the body will lie unseen for `bodyFor` s (until it is carried off), and `when()` holds.
 */
export async function stab(D, tag, { approach = [], low = true, when = () => true, bodyFor = 8, bodyAt = null, carry = null, maxWait = 300, pad = 1.5, also = null, fan = false, late = 0, onGo = null, minDist = 5, tight = false } = {}) {
  // (`tight`: the kill is timed to a short halt to the second — the rise and the knife checked with half the slack)
  // (`onGo`: an order given the moment the window opens, before the approach — e.g. out of the building he hides in)
  // (`late`: s a player's slower clicks may add to the approach — the walkers' cones checked that much later too)
  // (`fan`: a standing approach / carry is checked against every way a halted man's head may sweep)
  const e = D.get(tag), gb = D.c('greenberet');
  const speed = low ? 0.9 : 2.25;
  // (buried: he rises out of the sand first — still under it for the rise itself, then standing until he drops flat)
  const RISE = CONFIG.abilities.rise ?? 1.0, UP = gb.buried ? RISE + (CONFIG.units.stanceDown ?? 0.5) + 0.3 : 0;
  // (from a crawl he stands up only once the window opens: the getting up is part of the exposure checked)
  const getUp = !low && (gb.buried || gb.stance !== 'stand') ? (CONFIG.units.stanceUp ?? 0.5) + 0.1 : 0;
  // (`approach` may be a function: worked out afresh at every look, e.g. a point behind a walking man)
  const apF = typeof approach === 'function' ? approach : () => approach;
  let route = [];
  const why = [], whys = [];
  let next = 0;
  const ok = () => {
    if (D.t < next) return false;
    next = D.t + 0.25; // (a player glances at the cones a few times a second)
    if (why.length) { whys.push(`${D.t.toFixed(1)}:${why.join(' ')}`); if (whys.length > 6) whys.shift(); }
    why.length = 0;
    if (!when()) { why.push('when'); return false; }
    approach = apF();
    if (!approach) { why.push('approach'); return false; }
    // (no approach given and he is not in reach yet: the knife order itself takes him in — crawling, standing up at the
    // last metre — so the check plans that crawl too, to 0.9 m short of the man)
    if (!approach.length) {
      const q = walker(e) ? predict(e, 2) : e, d = Math.hypot(gb.x - q.x, gb.z - q.z);
      if (d > 1.3) approach = [[q.x + ((gb.x - q.x) / d) * 0.9, q.z + ((gb.z - q.z) / d) * 0.9]];
    }
    route = getUp ? [[gb.x, gb.z, getUp], ...approach] : approach;
    // (timed along the way his feet will really go: the planner's path round walls and through gaps)
    const T = (approach.length ? planned(D, 'greenberet', approach).reduce((a, p) => [a[0] + Math.hypot(p[0] - a[1][0], p[1] - a[1][1]), p], [0, [gb.x, gb.z]])[0] / speed + getUp : getUp) + UP;
    if (UP && !routeSafe(D, 'greenberet', [], { from: [gb.x, gb.z], low: false, hold: UP - RISE, delay: RISE, pad: 0.5, minDist: Math.min(3, minDist), victim: tag, why, slack: tight ? [-0.15, 0.3] : [-0.3, 0.6] })) return false;
    if (!routeSafe(D, 'greenberet', route, { low, speed, victim: tag, standLast: low ? 0.6 : 0, hold: tight ? 0.8 : 1.2, why, pad, delay: 0.2 + UP, fan, minDist, slack: tight ? [-0.3, 0.6 + late] : [-0.6, 1.2 + late] })) return false;
    const q = walker(e) ? predict(e, T + 1) : e;
    // where he will lie: pitched forward (knifed from behind) or pushed back off the blade (from the front / side)
    const last = approach.length ? approach[approach.length - 1] : [gb.x, gb.z];
    const hq = walker(e) ? q.hs[0] : e.heading;
    const fromBehind = -(Math.cos(hq) * (last[0] - q.x) + Math.sin(hq) * (last[1] - q.z)) / (Math.hypot(last[0] - q.x, last[1] - q.z) || 1) >= Math.cos(70 * Math.PI / 180);
    const away = Math.atan2(q.z - last[1], q.x - last[0]);
    const at = bodyAt ?? (fromBehind ? [q.x + Math.cos(hq) * 0.85, q.z + Math.sin(hq) * 0.85] : [q.x + Math.cos(away) * 0.7, q.z + Math.sin(away) * 0.7]);
    if (!spotSafe(D, q.x, q.z, 1.5 + late, { except: [tag], delay: T, why })) return false;
    // (he stands where the knife reaches the man, not at the end of the approach, and stays up there over the body
    // until he has it on his shoulder)
    { const d = Math.hypot(last[0] - q.x, last[1] - q.z) || 1, kx = q.x + ((last[0] - q.x) / d) * 0.9, kz = q.z + ((last[1] - q.z) / d) * 0.9;
      if (!spotSafe(D, kx, kz, (carry ? 2.6 : 0) + 1.5 + late, { except: [tag], delay: Math.max(0, T - 0.5), why, pad: 0.5 })) return false; }
    // (and nobody sees him drop: a falling man is seen in a full cone, over a raised edge too)
    if (killSeen(D, e, T + 0.4, { why, slack: [-0.4, 0.8] })) return false;
    if (!spotSafe(D, at[0], at[1], carry ? 3 : bodyFor, { except: [tag], delay: T, why, body: true })) return false;
    // (and the carry off: shouldered 2.2 s after he gets there, walked off standing)
    if (carry && !routeSafe(D, 'greenberet', carry, { from: at, low: false, speed: 1.5, delay: T + 2.4, hold: 1, except: [tag], why, fan })) return false;
    // (the knife and the pick-up may go quicker: the walk off a second earlier too)
    if (carry && !routeSafe(D, 'greenberet', carry, { from: at, low: false, speed: 1.5, delay: T + 1.4, hold: 0, except: [tag], why, fan })) return false;
    // (`also(tEnd, why)`: what comes next must fit too — tEnd: s from now that the body is put down (or he lies by it))
    const tEnd = carry ? T + 2.4 + carry.reduce((a, p) => [a[0] + Math.hypot(p[0] - a[1][0], p[1] - a[1][1]), p], [0, at])[0] / 1.5 + 1.2 : T + 1.5;
    return !also || also(tEnd, why);
  };
  await D.until(ok, maxWait, `window to knife ${tag}`).catch((err) => { throw new Error(`${err.message} [${whys.join(' | ')}]`); });
  if (onGo) await onGo();
  if (gb.buried) { D.ability('greenberet', 'shovel'); await D.until(() => !gb.buried && !gb.currentAction, 5, 'GB out of the sand'); if (low) await D.stance('greenberet', 'crawl'); }
  if (!low) await D.stance('greenberet', 'stand');
  // (the last step may end a little short — the man himself in the way: the knife order takes him the rest)
  for (let i = 0; i < approach.length; i++) {
    if (i === approach.length - 1) await goLoose(D, 'greenberet', approach[i][0], approach[i][1], 0.2);
    else await D.go('greenberet', approach[i][0], approach[i][1], { tol: 0.4 });
  }
  D.ability('greenberet', 'knife', e);
  await D.until(() => !e.alive, 30, `${tag} knifed`);
  await D.idle('greenberet');
  if (carry) await carryBody(D, tag, carry, { check: false });
  return e;
}

/** The Sniper shoots `tag` from (x, z) (prone): he crawls there from where he lies when the spot stays out of every
 * cone for `dur` s, and fires. */
/**
 * The knife for a man drawn to the GB's decoy (it lies where he will stare at it): switched on, `stab` while he stares;
 * if no window opens before he gives up (the mission's dwell cap), off again, and when he is back on his beat, on
 * again (after `retrigger`, e.g. waiting for him to come into earshot) — up to `tries` times.
 */
export async function lureStab(D, tag, opts, { tries = 6, settle = 6, retrigger = null } = {}) {
  const gb = D.c('greenberet'), e = D.get(tag);
  const staring = () => e.alive && e.brain.state === 'DECOY' && e.brain.phase === 'stare';
  for (let k = 0; ; k++) {
    if (!gb.decoy?.on) D.ability('greenberet', 'decoyToggle');
    await D.until(staring, 90, `${tag} stares at the decoy`);
    try { return await stab(D, tag, { ...opts, when: () => staring() && (opts.when?.() ?? true) }); } catch (err) {
      if (k + 1 >= tries || !/^timeout/.test(err.message)) throw err;
      D.log(`  (${tag}: no window while he stared, lured again: ${err.message.slice(0, 120)})`);
      if (gb.decoy?.on) D.ability('greenberet', 'decoyToggle');
      await D.until(() => !staring() && e.brain.state === 'IDLE' && !e.brain.distractedBy, 200, `${tag} back on his beat`);
      await D.wait(settle);
      if (retrigger) await retrigger();
    }
  }
}

