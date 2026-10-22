/**
 * M8 "Pyrotechnics" (Tell el Eisa): a full stealth solution, played only with player orders.
 * Driver API: tools/solutions/driver.mjs. Reference run, in the real game: node tools/solutions/run-browser.mjs m08
 * (also tests/m08-solution.test.mjs). Walkthrough (debug VIDEO MODE): m08.walkthrough.mjs.
 *
 * Outline (Green Beret + Sniper, 6 rifle rounds, the GB's knife and decoy, no alarm until the blast):
 *  A–C   the start yard and the plateau's N edge: e1 sniped, e9 knifed in his lane;
 *  Ci–M  the courtyard and the rim walkers: e11, e7, e5 (decoy), e8 (decoy), e6 (decoy + rifle);
 *  D–I   the 210 mm gun crew e10/e29, the Gatling gunner e32, the road guards e30/e31 (decoy), back up and W;
 *  Ma–Mc the W plateau: e2, e3, e4, the road guards e12/e13 over the W ramp (from a prone spot right behind each);
 *  N–P   the Sniper down to the road N of the store, the GB down the supply track and W along the plateau's foot in
 *        the sand;
 *  Q     the decoy N of the wire draws the store walkers e24/e25 out; from ~40 m (his rifle reaches 45 m, their eyes
 *        36 m) the Sniper shoots the roof guard e19 and the tank guards e26/e27 one by one, as a plan clears with no
 *        kneel, fall or body seen (shootSeq); the GB round the end of the wire into the store, under the lures;
 *  R–U   barrels laid for one chain: b10 to the reservoir, e28 knifed and hidden under b6, b7 between the tanks;
 *  V–W   the GB out of the store and E to the bridge, into the sand;
 *  X     the Sniper's last round from the far bank into b10: racks, tanks and reservoir go up (the only alarm), the
 *        jeep comes, both climb in when no one looks at their door.
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
    return { x: q.x + (e.x - lead.x), z: q.z + (e.z - lead.z), hs: [...q.hs, e.heading] };
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
    if (left <= waitLeft) return { x, z, wait: true, early: into + left < 1.2, hs: lk == null ? [h] : turnAt(h, lk, into + left) };
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
          return { x: hx, z: hz, alt: [{ x: hx - (dx / L) * WP_SHORT, z: hz - (dz / L) * WP_SHORT }], wait: true, early: true, hs: [h2, ...(lk == null ? [] : turnAt(h2, lk, 0.2))] };
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
      if (left <= wp.wait) return { x, z, alt: [{ x: x - Math.cos(h) * WP_SHORT, z: z - Math.sin(h) * WP_SHORT }], wait: true, early: left < 1.2, hs: lk == null ? [h] : turnAt(h, lk, left) };
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
}

const deg = (h) => ((h * 180) / Math.PI + 360) % 360;

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
export function routeSafe(D, role, pts, { speed = 0.9, low = true, delay = 0.2, step = 0.3, pad = 1.5, slack = [-0.6, 1.2], hold = 0, minDist = 5,
  except = [], victim = null, standLast = 0, from = null, why = null, all = globalThis.process?.env?.WHYALL, body = false, expand = true, lat = 0, fan = false } = {}) {
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
  viewers: for (const e of w.enemies) {
    if (!e.alive || e.removed || !e.vision || except.includes(e.tag) || e.incapacitated) continue;
    const moving = walker(e);
    const far = (e.vision.far ?? 36) + 2, isV = e.tag === victim;
    // (a posted man's sweep is a known function of time: only the commando's own timing is uncertain, ±0.3 s; a
    // walker's pace and turns drift from the prediction: the full slack)
    const [s0, s1] = moving ? slack : [Math.max(slack[0], -0.6), Math.min(slack[1], 0.6)];
    for (const [sx, sz, st, slow] of samples) {
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
async function goLoose(D, role, x, z, tol = 0.35) {
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
function planned(D, role, pts, from = null) {
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
async function sneak(D, role, pts, { low = true, speed = null, maxWait = 300, stay = 4, delay = 0.3, run = false, when = null, minDist = 5, pad = 1.5, slack = undefined, lat = 0 } = {}) {
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
    if (why.length) { whys.push(`${D.t.toFixed(1)}:${why.join(' ')}`); if (whys.length > 5) whys.shift(); if (globalThis.process?.env?.WHY) D.log(`  why sneak: ${whys[whys.length - 1]}`); }
    why.length = 0;
    const g = getUp();
    return (!when || when()) && routeSafe(D, role, g ? [[u.x, u.z, g], ...way] : way, { low, speed: sp, delay, hold: stay, why, minDist, pad, slack, lat });
  }, maxWait, `${role} sneaks to (${pts[pts.length - 1]})`).catch((e) => { throw new Error(`${e.message} [${whys.join(' | ')}]`); });
  if (globalThis.process?.env?.SNEAKLOG) D.log(`  SNEAK ${role} at ${D.t.toFixed(2)} from (${u.x.toFixed(1)},${u.z.toFixed(1)}) to ${JSON.stringify(pts)}`);
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
function chaseApproach(D, e, via, { speed = 2.25, getUp = 0.7, behindBy = 1.0 } = {}) {
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
const behind = (e, d = 1) => [e.x - Math.cos(e.heading) * d, e.z - Math.sin(e.heading) * d];
/** the point `d` m off enemy `e`'s side, `off` rad round from his heading (a knife from there is a frontal kill: he turns
 * to the blade and falls back away from it, not forward onto what he was looking at) */
const beside = (e, off, d = 1) => [e.x + Math.cos(e.heading + off) * d, e.z + Math.sin(e.heading + off) * d];

/**
 * A burrow hop: the GB (buried, or lying) rises if buried, crawls along `pts` and digs himself in at the last one
 * (sand), all in one window: the rising (he stands up out of the mound, then drops flat), the crawl and the dig must
 * stay out of every cone. Buried, nobody sees him (only the men who watched him dig, and nobody does).
 */
async function hop(D, pts, { maxWait = 300, pad = 0.5, minDist = 3, when = null, bury = true, slack = [-0.3, 0.9], fan = false } = {}) {
  const gb = D.c('greenberet');
  const RISE = CONFIG.abilities.rise ?? 1.0, UP = RISE + (CONFIG.units.stanceDown ?? 0.5) + 0.3, DIG = (CONFIG.abilities.dig ?? 2.0) + 0.6;
  const why = [], whys = [];
  const way = planned(D, 'greenberet', pts);
  let next = 0;
  await D.until(() => {
    if (D.t < next) return false;
    next = D.t + 0.25;
    if (why.length) { whys.push(`${D.t.toFixed(1)}:${why.join(' ')}`); if (whys.length > 5) whys.shift(); if (globalThis.process?.env?.WHY) D.log(`  why hop: ${whys[whys.length - 1]}`); }
    why.length = 0;
    if (when && !when()) return false;
    const up = gb.buried ? UP : 0;
    // (he is still under the sand for the rise itself, CONFIG.abilities.rise s; then he stands until he drops flat)
    // (our own timing is exact and the walkers' predictions good to half a metre: a tight slack for the moment he stands)
    if (up && !routeSafe(D, 'greenberet', [], { from: [gb.x, gb.z], low: false, hold: up - RISE, delay: RISE, pad, minDist, why, slack: [Math.min(-0.5, slack[0]), Math.max(0.9, slack[1])], fan })) return false;
    return routeSafe(D, 'greenberet', way, { delay: up + 0.2, hold: bury ? DIG : 3, pad, minDist, why, standLast: -1, slack });
  }, maxWait, `GB hops to (${pts[pts.length - 1]})`).catch((e) => { throw new Error(`${e.message} [${whys.join(' | ')}]`); });
  const HD = globalThis.process?.env?.HOPDBG;
  if (HD) for (const t of HD.split(',')) { const o = D.get(t); const ps = []; for (let tt = 0.5; tt <= 3.01; tt += 0.5) { const q = predict(o, tt); ps.push(`+${tt}:(${q.x.toFixed(1)},${q.z.toFixed(1)})${q.wait ? 'W' : ''}h${q.hs.map((h) => deg(h).toFixed(0)).join('/')}`); } D.log(`  HOP at ${D.t.toFixed(2)} ${t} now (${o.x.toFixed(1)},${o.z.toFixed(1)}) h${deg(o.heading).toFixed(0)} ${o.brain.state} ri${o.brain.routeIndex} w${o.brain.atWait} ${ps.join(' ')}`); }
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
async function pickUpDecoy(D, { maxWait = 120, pad = 1.5, when = () => true } = {}) {
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
async function carryBody(D, tag, pts, { maxWait = 120, check = true, pad = 1.5, pre = [], slack = undefined, fan = false, when = () => true } = {}) {
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
  if (check) await sneak(D, 'greenberet', pts, { low: false, speed: 1.5, maxWait });
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
async function stab(D, tag, { approach = [], low = true, when = () => true, bodyFor = 8, bodyAt = null, carry = null, maxWait = 300, pad = 1.5, also = null, fan = false, late = 0 } = {}) {
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
  let route = [], lastT = 0;
  const why = [], whys = [];
  let next = 0;
  const ok = () => {
    if (D.t < next) return false;
    next = D.t + 0.25; // (a player glances at the cones a few times a second)
    if (why.length) { whys.push(`${D.t.toFixed(1)}:${why.join(' ')}`); if (whys.length > 6) whys.shift(); if (globalThis.process?.env?.WHY) D.log(`  why ${tag}: ${whys[whys.length - 1]}`); }
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
    lastT = T;
    if (UP && !routeSafe(D, 'greenberet', [], { from: [gb.x, gb.z], low: false, hold: UP - RISE, delay: RISE, pad: 0.5, minDist: 3, victim: tag, why, slack: [-0.3, 0.6] })) return false;
    if (!routeSafe(D, 'greenberet', route, { low, speed, victim: tag, standLast: low ? 0.6 : 0, hold: 1.2, why, pad, delay: 0.2 + UP, fan, slack: [-0.6, 1.2 + late] })) return false;
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
  if (globalThis.process?.env?.WHY) D.log(`  window to knife ${tag} at ${D.t.toFixed(2)} T=${lastT.toFixed(2)}`);
  const SD = globalThis.process?.env?.SEESDBG;
  if (SD) { const [t, x, z] = SD.split(','); const o = D.get(t); for (let tt = +(globalThis.process?.env?.SEES0 ?? 5); tt <= +(globalThis.process?.env?.SEES1 ?? 9) + 0.01; tt += 0.25) { const q = walker(o) ? predict(o, tt) : { x: o.x, z: o.z, hs: [o.heading] }; const dm = { x: +x, z: +z, y: 0, isLow: false, isVisibleToEnemies: true };
    D.log(`  SEES ${t} +${tt.toFixed(2)} q=(${q.x.toFixed(2)},${q.z.toFixed(2)})${q.wait ? 'W' : ''} hs=${q.hs.map((h) => deg(h).toFixed(0)).join('/')} sees=${sees(o, q, dm, D.world, D.world.time + tt, walker(o))}`); } }
  if (SD) { const o = D.get(SD.split(',')[0]), gbx = D.c('greenberet'); const f = () => { D.log(`  REAL ${o.tag} ${D.t.toFixed(2)} (${o.x.toFixed(2)},${o.z.toFixed(2)}) h${deg(o.heading).toFixed(0)} ho${((o.headOffset ?? 0) * 180 / Math.PI).toFixed(0)} sw${o.sweepActive} atWait${o.brain.atWait} | gb (${gbx.x.toFixed(2)},${gbx.z.toFixed(2)}) y=${(gbx.y ?? 0).toFixed(2)} elev=${(D.world.grid.elevAt?.(gbx.x, gbx.z) ?? 0).toFixed(2)} st=${gbx.stance} low=${gbx.isLow} real=${canSee(o, gbx, D.world)} dummy=${canSee(o, { x: gbx.x, z: gbx.z, y: D.world.grid.elevAt?.(gbx.x, gbx.z) ?? 0, isLow: gbx.isLow, isVisibleToEnemies: true }, D.world)}`); }; const u = D.until; let n = 0; D.until = (p, ...a) => u(() => { if (D.t > n) { n = D.t + 0.2; if (D.t < D.world.time + 99) f(); } return p(); }, ...a); setTimeout(() => {}, 0); }
  const PL = globalThis.process?.env?.PREDLOG;
  if (PL) for (const t of PL.split(',')) { const o = D.get(t); const ps = []; for (let tt = 0; tt <= 12; tt += 1) { const q = predict(o, tt); ps.push(`+${tt}:(${q.x.toFixed(1)},${q.z.toFixed(1)})${q.wait ? 'W' : ''}h${q.hs.map((h) => deg(h).toFixed(0)).join('/')}`); } D.log(`  PRED ${t} at ${D.t.toFixed(2)} ${o.brain.state} ri${o.brain.routeIndex} ${ps.join(' ')}`); }
  if (gb.buried) { D.ability('greenberet', 'shovel'); await D.until(() => !gb.buried && !gb.currentAction, 5, 'GB out of the sand'); if (low) await D.stance('greenberet', 'crawl'); }
  if (!low) await D.stance('greenberet', 'stand');
  // (the last step may end a little short — the man himself in the way: the knife order takes him the rest)
  for (let i = 0; i < approach.length; i++) {
    if (i === approach.length - 1) await goLoose(D, 'greenberet', approach[i][0], approach[i][1], 0.2);
    else await D.go('greenberet', approach[i][0], approach[i][1], { tol: 0.4 });
  }
  D.ability('greenberet', 'knife', e);
  await D.until(() => !e.alive, 30, `${tag} knifed`);
  if (globalThis.process?.env?.WHY) D.log(`  ${tag} down at ${D.t.toFixed(2)}`);
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
async function lureStab(D, tag, opts, { tries = 6, settle = 6, retrigger = null } = {}) {
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

async function snipe(D, tag, [x, z], { dur = 2.5, maxWait = 120, when = () => true, body = 0, bodyPad = 1, lat = 0, idle = true } = {}) {
  const sn = D.c('sniper'), e = D.get(tag);
  if (sn.stance !== 'crawl') await D.stance('sniper', 'crawl');
  const why = [];
  // (`body`: and where he falls stays out of every cone for that many s)
  const inSights = () => Math.hypot(sn.x - x, sn.z - z) > 0.5 || ABILITIES.sniper.canUse(sn, e, D.world) === true;
  const whys = [];
  await D.until(() => {
    why.length = 0;
    // (§3.4 he kneels to fire: from the aim to the shot, 0.7 s, he counts as a standing man — the victim included)
    const tReach = Math.hypot(sn.x - x, sn.z - z) / 0.9 + 0.3;
    const ok = (when() || (why.push('when'), false)) && (inSights() || (why.push('sights'), false)) && D.clearAhead(x, z, dur, true, why) && routeSafe(D, 'sniper', [[x, z]], { hold: dur, why, victim: tag, lat })
      && routeSafe(D, 'sniper', [], { from: [x, z], low: false, delay: tReach, hold: 1.0, pad: 0.5, why, victim: tag, slack: [-0.3, 0.6] })
      && !killSeen(D, e, 0.8, { why })
      && (!body || spotSafe(D, e.x, e.z, body, { except: [tag], delay: 0.8, why, body: true, pad: bodyPad }));
    if (why.length) { whys.push(`${D.t.toFixed(1)}:${why.join(' ')}`); if (whys.length > 5) whys.shift(); if (globalThis.process?.env?.WHY && why[0] !== 'when') D.log(`  why ${tag}: ${whys[whys.length - 1]}`); }
    return ok;
  }, maxWait, `window to snipe ${tag}`)
    .catch((err) => { throw new Error(`${err.message} [${whys.join(' | ')}]`); });
  await D.go('sniper', x, z, { tol: 0.3 });
  // (a crawl that stops a few cm off the spot can leave a wall's edge in the line: on to the spot itself)
  if (ABILITIES.sniper.canUse(sn, e, D.world) !== true) await D.go('sniper', x, z, { tol: 0.08 });
  D.ability('sniper', 'sniper', e);
  await D.until(() => !e.alive, 5, `${tag} sniped`);
  // (`idle: false`: the others need not wait for him to work the bolt and lie down again)
  if (idle) await D.idle('sniper');
}

/**
 * The Sniper, prone at (x, z), shoots `tags` one after the other (aim 0.6 s, bolt 0.5 s each) once he has them all in
 * his sights, nobody sees him lying there, and `bodiesOk(t0)` says the bodies will lie unseen.
 */


/**
 * The Sniper at `spot` shoots every man of `tags`, one at a time, in whichever order and at whatever moments (on a
 * 0.5 s grid up to `H` s ahead, a bolt's 1.1 s apart at least) a plan clears: every kneel to fire unseen (a standing
 * man from the aim to the shot, §3.4), every fall unseen, each man in his sights, and every body unseen — by the men
 * still to be shot until their own shots, by everyone else for good. The first shot goes when a whole plan clears;
 * each later one when the rest of a plan clears again from there (the guards' drift from the prediction).
 */
async function shootSeq(D, spot, tags, { maxWait = 600, tick = null, H = 15, why: whyOut = null, robust = 1 } = {}) {
  const sn = D.c('sniper'), w = D.world, AIM = 0.6, STEP = 1.1;
  const inSights = (e, dt) => {
    const q = walker(e) ? predict(e, dt) : e, g = Object.create(e);
    for (const [k, v] of Object.entries({ x: q.x, z: q.z })) Object.defineProperty(g, k, { value: v, writable: true });
    return ABILITIES.sniper.canUse(sn, g, w) === true;
  };
  // (in his sights when the order goes and when the round goes off; a walker either side of that moment too: his line
  // of sight to the spot may come and go as he passes things)
  const shotOk = (t, at, dead, why) => {
    const e = D.get(t), ta = at + AIM + 0.1;
    if (!((at >= 0.3 || ABILITIES.sniper.canUse(sn, e, w) === true) && inSights(e, ta) && (!walker(e) || (inSights(e, ta - 0.4) && inSights(e, ta + 0.4))))) { why?.push(`${t} nosight`); return false; }
    if (killSeen(D, e, ta, { why, except: dead })) return false;
    return routeSafe(D, 'sniper', [], { from: spot, low: false, delay: Math.max(0, at - 0.2), hold: 1.5, pad: 0.5, except: dead, victim: t, slack: [-0.6, 1.0], why });
  };
  const fallAt = (t, at) => { const e = D.get(t), f = at + AIM + 0.1, q = walker(e) ? predict(e, f) : e; return { kind: 'body', x: q.x, z: q.z, y: e.y || 0, f, tag: t }; };
  // (the bodies down so far unseen until `at`: by the men still alive then, and by everyone not to be shot)
  const bodiesOk = (bodies, alive, at, why) => bodies.every((b) => {
    const t1 = at + AIM + 0.1;
    for (const k of alive) if (seenBy(D, D.get(k), b, Math.max(0, b.f), t1, 0.25)) { why?.push(`${k} sees ${b.tag}'s body`); return false; }
    return spotSafe(D, b.x, b.z, Math.max(0.5, t1 - Math.max(0, b.f) + 2), { except: tags, delay: Math.max(0, b.f), why, body: true, pad: 0.3 });
  });
  // a plan for the men of `left` (the first shot at once): [[tag, at], ...] or null
  const plan = (left, dead, bodies, why, tMin = 0, first = true) => {
    if (!left.length) return [];
    const times = first ? [0] : []; if (!first) for (let t = tMin; t <= H + 1e-6; t += 0.5) times.push(t);
    for (const at of times) for (const v of left) {
      const rest = left.filter((t) => t !== v);
      if (!shotOk(v, at, dead, why)) continue;
      if (!bodiesOk(bodies, left, at, why)) continue;
      const tail = plan(rest, [...dead, v], [...bodies, fallAt(v, at)], why, at + STEP, false);
      if (tail) return [[v, at], ...tail];
    }
    return null;
  };
  const shoot = async (t) => {
    await D.until(() => D.t >= (sn._boltT ?? 0) && !sn.currentAction, 3, 'bolt worked');
    const e = D.get(t);
    if (ABILITIES.sniper.canUse(sn, e, w) !== true) throw new Error(`FATAL ${t} out of the Sniper's sights at ${D.t.toFixed(1)}`);
    D.ability('sniper', 'sniper', e);
    await D.until(() => !e.alive, 3, `${t} shot`);
  };
  // (how many half-second slots for the shot after the first of plan `p0`, each with a whole plan after it)
  const slots = (p0, bs) => {
    const [v, at0] = p0[0], rest = left.filter((t) => t !== v), bodies2 = [...bs, fallAt(v, at0)];
    let n = 0;
    for (let at = at0 + STEP; at <= H + 1e-6; at += 0.5) for (const u of rest) {
      if (!shotOk(u, at, [v]) || !bodiesOk(bodies2, rest, at)) continue;
      if (plan(rest.filter((x) => x !== u), [v, u], [...bodies2, fallAt(u, at)], null, at + STEP, false)) { n++; break; }
    }
    return n;
  };
  const dead = [], bodies = [], shots = [];
  let left = [...tags];
  while (left.length) {
    const whys = []; let next = 0, p = null, nextLog = D.t + 30;
    // (after the first shot he waits on for the next moment as long as the bodies down so far stay unseen — the men he
    // has still to shoot drift from the plan made at the first shot)
    const t0 = D.t, wait = maxWait;
    let doomed = null;
    await D.until(() => {
      tick?.();
      if (D.t < next) return false;
      next = D.t + 0.2; // (a player glances at the cones a few times a second)
      const why = [], bs = bodies.map((b) => ({ ...b, f: b.abs - D.t }));
      p = plan(left, dead, bs, why);
      // (the first shot commits him: only when the next has room — a second shot possible at `robust` different half
      // seconds at least, not one knife-edge moment the guards' drift from the prediction may close)
      if (p && !dead.length && robust > 1 && left.length > 1 && slots(p, bs) < robust) { why.push('tight'); p = null; }
      if (!p && bs.length) { const w2 = []; if (!bodiesOk(bs, left, 0, w2)) { doomed = w2.join(' ') + ` at ${D.t.toFixed(2)}`; return true; } }
      if (!p && why.length) { whys.push(`${D.t.toFixed(1)}:${why.slice(0, 4).join(' ')}`); if (whys.length > 5) whys.shift(); }
      if (globalThis.process?.env?.WHY && D.t > nextLog) { nextLog = D.t + 30; D.log(`  shootSeq ${D.t.toFixed(0)}: ${whys.slice(-2).join(' | ').slice(0, 300)}`); }
      return !!p;
    }, wait, `a moment to shoot ${left.join(', ')}`).catch((err) => { throw new Error(`${dead.length ? 'FATAL ' : ''}${err.message} [${whys.join(' | ')}]`); });
    if (doomed) throw new Error(`FATAL no moment to shoot ${left.join(', ')} before a body is seen (${doomed}) [${whys.join(' | ')}]`);
    const [v] = p[0];
    if (!dead.length) whyOut?.push(p.map(([t, at]) => `${t}@+${at}`).join(' '));
    D.log(`  shootSeq ${D.t.toFixed(1)}: ${p.map(([t, at]) => `${t}@+${at}`).join(' ')}`);
    const PQ = globalThis.process?.env?.PREDQ;
    if (PQ && !dead.length) { const b = fallAt(p[0][0], 0); for (const k of left) { if (k === p[0][0]) continue; let first = null; for (let tt = b.f; tt <= 20; tt += 0.05) if (seenBy(D, D.get(k), b, tt, tt, 1)) { first = tt; break; } D.log(`  BODYSEEN ${k} sees ${p[0][0]}'s body first at +${first?.toFixed(2)} (walker ${walker(D.get(k))})`); } }
    if (PQ) for (const t of PQ.split(',')) { const o = D.get(t); const ps = []; for (let tt = 0; tt <= 12; tt += 1) { const q = predict(o, tt); ps.push(`+${tt}:(${q.x.toFixed(1)},${q.z.toFixed(1)})${q.wait ? 'W' : ''}h${q.hs.map((h) => deg(h).toFixed(0)).join('/')}`); } D.log(`  PRED ${t} at ${D.t.toFixed(2)} ${o.brain.state} ri${o.brain.routeIndex} ${ps.join(' ')}`); }
    await shoot(v).catch((err) => { throw new Error(`FATAL ${err.message}`); });
    const e = D.get(v);
    if (globalThis.process?.env?.PREDQ) { const fa = fallAt(v, 0); D.log(`  BODY ${v} at (${e.x.toFixed(2)},${e.z.toFixed(2)}) predicted (${fa.x.toFixed(2)},${fa.z.toFixed(2)})`); }
    dead.push(v); bodies.push({ kind: 'body', x: e.x, z: e.z, y: e.y || 0, abs: D.t, tag: v }); shots.push(`${v}@${(D.t - t0).toFixed(1)}`);
    left = left.filter((t) => t !== v);
  }
  await D.idle('sniper');
  return shots;
}


/**
 * The GB climbs a cliff (a climb link) to `to` and digs in at the end of `then` (crawled from its foot), in one window:
 * on the face he counts as a standing man (CLIMB s at the link's pace), then a crawler, then the dig.
 */
async function climb(D, to, then, { maxWait = 300, pad = 0.5, CLIMB = 10 } = {}) {
  const gb = D.c('greenberet'), why = [], whys = [];
  let nx = 0;
  await D.until(() => {
    if (D.t < nx) return false;
    nx = D.t + 0.25;
    if (why.length) { whys.push(`${D.t.toFixed(1)}:${why.join(' ')}`); if (whys.length > 5) whys.shift(); if (globalThis.process?.env?.WHY) D.log(`  why climb: ${whys[whys.length - 1]}`); }
    why.length = 0;
    return routeSafe(D, 'greenberet', [to], { low: false, speed: Math.hypot(to[0] - gb.x, to[1] - gb.z) / CLIMB, delay: 0.3, pad, minDist: 3, why })
      && routeSafe(D, 'greenberet', then, { from: to, delay: 0.3 + CLIMB, hold: (CONFIG.abilities.dig ?? 2.0) + 0.6, pad, minDist: 3, why });
  }, maxWait, `window to climb to (${to})`).catch((err) => { throw new Error(`${err.message} [${whys.join(' | ')}]`); });
  D.ability('greenberet', 'climb', { x: to[0], z: to[1] });
  await D.until(() => Math.hypot(gb.x - to[0], gb.z - to[1]) < 0.6 && !gb.path, 40, 'GB down the climb');
  for (const p of then) await D.go('greenberet', p[0], p[1], { tol: 0.35 });
  D.ability('greenberet', 'shovel');
  await D.until(() => gb.buried, 5, 'GB dug in');
}

/**
 * The GB moves loose barrel `id` to `to`: out of the sand if he is buried, a crawl along `pre` to it, up, the pick-up,
 * the carry (standing, 1.6 m/s), the drop, flat again and a crawl along `post`, dug in at its end if `bury` — all in one
 * window (`when` must hold too).
 */
async function carryBarrel(D, id, to, { pre = [], post = [], bury = true, maxWait = 300, pad = 0.5, when = null, onBody = null } = {}) {
  const gb = D.c('greenberet'), w = D.world;
  const b = w.interactables.find((i) => (i.tag ?? i.spawn?.id) === id);
  const why = [], whys = [];
  let nx = 0;
  await D.until(() => {
    if (D.t < nx) return false;
    nx = D.t + 0.25;
    if (why.length) { whys.push(`${D.t.toFixed(1)}:${why.join(' ')}`); if (whys.length > 5) whys.shift(); if (globalThis.process?.env?.WHY) D.log(`  why barrel ${id}: ${whys[whys.length - 1]}`); }
    why.length = 0;
    if (when && !when()) { why.push('when'); return false; }
    return barrelPlan(D, b, to, { pre, post, bury, pad, why }) != null;
  }, maxWait, `window to move ${id}`).catch((e) => { throw new Error(`${e.message} [${whys.join(' | ')}]`); });
  await doBarrel(D, b, to, { pre, post, bury, onBody });
  return b;
}

/**
 * The barrel run's window check: from the GB where he is (or `from`, at `t0` s from now; `buried` there or not), out
 * of the sand, a crawl along `pre` (or a walk, `walkPre`) to barrel `b`, up, the pick-up, the carry (standing, 1.6 m/s),
 * the drop, flat again and a crawl along `post`, dug in at its end if `bury`. Returns the time (s from now) it is all
 * done, or null (reasons on `why`). `except`: guards left out (dead by then).
 */
function barrelPlan(D, b, to, { pre = [], post = [], bury = true, pad = 0.5, why = null, from = null, t0 = 0, buried = null, except = [], walkPre = false, late = 0, lag = 0 } = {}) {
  // (`late`: s he may be behind the plan when it starts; `lag`: s more each move order may add, a player's clicks — the
  // cones are checked that much later too, phase by phase)
  const sl = (k) => [-0.6, 1.2 + late + lag * k];
  const gb = D.c('greenberet');
  const RISE = CONFIG.abilities.rise ?? 1.0, UP = RISE + (CONFIG.units.stanceDown ?? 0.5) + 0.3, DIG = (CONFIG.abilities.dig ?? 2.0) + 0.6;
  // (the drum in his arms: carryBarrel, slower than a man on the shoulder, and he turns round with it before he walks off)
  const C = CONFIG.abilities.carry ?? { pick: 1.0, drop: 0.8 }, SP = CONFIG.units.carryBarrel ?? CONFIG.units.carry ?? 1.6;
  const len = (pts, f) => pts.reduce((a, p) => [a[0] + Math.hypot(p[0] - a[1][0], p[1] - a[1][1]), p], [0, f])[0];
  const start = from ?? [gb.x, gb.z], isBuried = buried ?? gb.buried;
  const up = isBuried ? UP : 0, at = [b.x, b.z];
  const o = { pad, minDist: 3, why, except };
  if (up && !routeSafe(D, 'greenberet', [], { ...o, from: start, low: false, hold: up - RISE, delay: t0 + RISE, slack: [-0.3, 0.6 + late] })) return null;
  const preSp = walkPre ? 2.25 : 0.9;
  const t1 = t0 + up + 0.2 + len(pre, start) / preSp + (walkPre ? (CONFIG.units.stanceUp ?? 0.6) : 0);
  if (!routeSafe(D, 'greenberet', walkPre ? [[start[0], start[1], CONFIG.units.stanceUp ?? 0.6], ...pre] : pre, { ...o, from: start, delay: t0 + up + 0.2, hold: 0, low: !walkPre, speed: preSp, standLast: walkPre ? 0 : -1, slack: sl(pre.length) })) return null;
  // up, the pick-up, the carry and the drop, standing
  const hold1 = (walkPre ? 0 : (CONFIG.units.stanceUp ?? 0.6)) + C.pick + 0.3 + 0.6; // (+ his turn round with it)
  if (!routeSafe(D, 'greenberet', [], { ...o, from: at, low: false, delay: t1, hold: hold1, slack: sl(pre.length) })) return null;
  if (!routeSafe(D, 'greenberet', [to], { ...o, from: at, low: false, speed: SP, delay: t1 + hold1, hold: C.drop + 0.6, slack: sl(pre.length + 1) })) return null;
  const t2 = t1 + hold1 + Math.hypot(to[0] - at[0], to[1] - at[1]) / SP + C.drop + 0.6;
  if (!routeSafe(D, 'greenberet', post, { ...o, from: to, delay: t2, hold: bury ? DIG : 2, standLast: -1, slack: sl(pre.length + 1 + post.length) })) return null;
  return t2 + len(post, to) / 0.9 + (bury ? DIG : 2);
}

/** Carry it out (barrelPlan's moves): `onBody` — put it down on that body (it hides him) instead of on the sand. */
async function doBarrel(D, b, to, { pre = [], post = [], bury = true, onBody = null, walkPre = false } = {}) {
  const gb = D.c('greenberet');
  if (gb.buried) { D.ability('greenberet', 'shovel'); await D.until(() => !gb.buried && !gb.currentAction, 5, 'GB out of the sand'); }
  if (walkPre) await D.stance('greenberet', 'stand');
  else if (gb.stance !== 'crawl') await D.stance('greenberet', 'crawl');
  for (const p of pre) await D.go('greenberet', p[0], p[1], { tol: 0.6 });
  await D.stance('greenberet', 'stand');
  D.ability('greenberet', 'hand', b);
  await D.until(() => gb.carrying === b, 10, `GB picks up ${b.tag}`);
  await D.go('greenberet', to[0], to[1], { tol: onBody ? 0.6 : 0.2 });
  if (onBody) {
    D.ability('greenberet', 'hand', onBody);
    await D.until(() => !gb.carrying && onBody.hiddenUnderBarrel, 5, `${b.tag} put down on ${onBody.tag}`);
  } else {
    D.ability('greenberet', 'drop');
    await D.until(() => !gb.carrying, 5, `${b.tag} put down`);
  }
  await D.idle('greenberet');
  await D.stance('greenberet', 'crawl');
  for (const p of post) await goLoose(D, 'greenberet', p[0], p[1]);
  if (bury) { D.ability('greenberet', 'shovel'); await D.until(() => gb.buried, 5, 'GB dug in'); }
}

/**
 * With the decoy lying N of the wire's W end: switch it on when the store's walkers e24 and e25 will both hear it, wait
 * until they stare at it (outside the wire, their backs to it), run `job(until)` (it must be done by `until`, a sim time;
 * it returns true when it got done), switch the decoy off and wait until both are back on their beats and deaf to lures no
 * more. Repeats (up to `tries`) until `job` gets done. Returns how many lures it took.
 */
async function underLure(D, job, { tries = 30, label = 'lure' } = {}) {
  const e24 = D.get('e24'), e25 = D.get('e25');
  const staring = (e) => e.alive && e.brain.state === 'DECOY' && e.brain.phase === 'stare';
  const back = (e) => !e.alive || (e.brain.state === 'IDLE' && !e.brain.distractedBy);
  for (let k = 1; k <= tries; k++) {
    // (every third try a lap of e24's beat is let go by: the other men's beats come round to other moments of the lure)
    const gate = () => back(e24) && back(e25) && e24.isMoving && Math.cos(e24.heading) < -0.8 && e24.x < 53 && e24.x > 50 && e25.x < 46;
    if (k % 3 === 0) { await D.until(gate, 400, 'e24 past'); await D.wait(8); }
    await D.until(gate, 400, `e24 coming W along the wire (${label})`);
    D.ability('greenberet', 'decoyToggle');
    await D.until(() => staring(e24) && staring(e25), 60, 'e24 and e25 at the decoy');
    let ok = false;
    // (they stare until the mission's dwell cap, rules.decoyMaxDwell, runs out for the first of them)
    const cap = D.world.mission?.rules?.decoyMaxDwell ?? 75;
    // (and walk back round the end of the wire, out of sight of the store for some 8 s more: the moves are checked against
    // that walk, predict())
    const until = D.t + Math.min(...[e24, e25].filter((e) => e.alive).map((e) => cap - e.brain.t)) + 8;
    try { ok = await job(until); } catch (err) { D.log(`  (${label}: not this time: ${err.message.slice(0, 140)})`); }
    D.ability('greenberet', 'decoyToggle');
    await D.until(() => back(e24) && back(e25), 120, 'e24 and e25 back on their beats');
    await D.wait(21); // (a lure broken off is ignored for 20 s)
    if (ok) return k;
  }
  throw new Error(`${label}: never done`);
}

/** The Sniper's spot on the road N of the depot: both tank walkways in his sights, out of every cone (prone). */
const SNIPER_P1 = [64.5, 35.5];
// the Sniper's spot for the elevated guards: ~40 m from the roof and the near tank (his rifle reaches 45 m, their eyes 36 m)
const SPQ = [64, 32];

export const STAGES = [
  ['A', 'The start yard: e1 north of the wall', async (D) => {
    D.checkpoint('A0 start');
    // e1 stands N of the yard's N wall (rw1) facing W. The Sniper, lying in the yard where the opening between rw1 and
    // rw2 gives him a line of fire, kneels and shoots him while e1's head is swung NW, away from the yard — as e9, at
    // the far end of the plateau's N edge, sets off E: walking back W he would see the body down the edge
    const e9 = D.get('e9'), gb = D.c('greenberet');
    // the GB crawls to the yard's W gap first, behind rw1 (e1 cannot see him there): the walk out to the body after the
    // shot is short then. The body must be off e9's line down the edge before he walks back W, and e5 glances at the edge
    // from his beat: the shot goes only when the whole walk out, the pick-up and the carry fit too — with a player's
    // slowness on every order (up to 0.6 s each: the late end of every check reaches 3 s further)
    await sneak(D, 'greenberet', [[2.0, 9.0], [1.2, 8.3]], { minDist: 1, stay: 2, pad: 0.5 });
    const OUT = [[0.6, 7.0], [1.2, 3.4], [9.4, 2.6]], CARRY = [[8.6, 2.0], [7.5, 1.4]], PICK = 2.5, LATE = [-0.6, 3.0];
    const len = (from, pts) => pts.reduce((a, p) => [a[0] + Math.hypot(p[0] - a[1][0], p[1] - a[1][1]), p], [0, from])[0];
    const outOk = (d0, why) => {
      const up = gb.stance !== 'stand' ? (CONFIG.units.stanceUp ?? 0.6) + 0.1 : 0;
      const tAt = d0 + up + len([gb.x, gb.z], planned(D, 'greenberet', OUT)) / 2.25;
      return routeSafe(D, 'greenberet', [[gb.x, gb.z, up], ...OUT], { low: false, speed: 2.25, delay: d0, hold: PICK, minDist: 1, pad: 0.5, slack: LATE, except: ['e1'], why })
        && routeSafe(D, 'greenberet', CARRY, { from: OUT[OUT.length - 1], low: false, speed: 1.5, delay: tAt + PICK, hold: 3, minDist: 1, pad: 0.5, slack: LATE, except: ['e1'], why });
    };
    let nextOut = 0, lastOut = false;
    const outThrottled = (d0) => { if (D.t >= nextOut) { nextOut = D.t + 0.25; const why = []; lastOut = outOk(d0, why); if (globalThis.process?.env?.ADBG) D.log(`  outOk ${D.t.toFixed(2)} ${lastOut} ${why.join(' ')}`); } return lastOut; };
    // (the shot: his crawl to the spot, then ~1.2 s from the order to the fall)
    const sn = D.c('sniper'), tShot = () => Math.hypot(sn.x - 8.0, sn.z - 11.0) / 0.9 + 0.3 + 1.2;
    await snipe(D, 'e1', [8.0, 11.0], { lat: 0.7, maxWait: 900, idle: false, when: () => e9.isMoving && Math.cos(e9.heading) > 0.9 && e9.x < 46.5 && outThrottled(tShot()) }); // (the opening's line of sight is narrow: a margin either side of his crawl)
    D.checkpoint('A1 e1 sniped');
    if (globalThis.process?.env?.ADBG) D.log(`  e1 down at ${D.t.toFixed(2)}`);
    // the GB walks out through the W gap to the body (nobody looks along the yard's N wall now, e9's back is turned),
    // shoulders it and carries it a few metres W, out of e9's line down the edge
    { const why = [];
      await D.until(() => { why.length = 0; return outOk(0.3, why); }, 6, 'window to fetch e1')
        .catch((err) => { throw new Error(`${err.message} [${why.join(' ')}]`); }); }
    await D.stance('greenberet', 'stand');
    for (const p of OUT) await D.go('greenberet', p[0], p[1], { tol: 0.35 });
    await carryBody(D, 'e1', CARRY, { check: false }); // (a spot neither e9 down the edge nor e5 from his beat sees)
    await D.stance('greenberet', 'crawl');
    D.checkpoint('A2 e1\'s body out of e9\'s sight');
    await D.idle('sniper');
    await sneak(D, 'sniper', [[2.5, 9.5]], { minDist: 1, stay: 2, pad: 0.5 }); // (back to the W side of the yard)
  }],
  ['B', 'The north edge of the plateau', async (D) => {
    // both crawl out through the gap and E along the plateau's N edge, behind the ruins' N walls (only e11 and e5 glance
    // up the gap between rw7 and rw10: the dash past it is timed on their cones)
    await sneak(D, 'greenberet', [[0.6, 6.6], [1.2, 3.0], [12, 2.0], [22, 2.0]]);
    D.checkpoint('B1 GB behind rw7');
  }],
  ['C', 'The NE ruins: e9 in his walled lane', async (D) => {
    const e9 = D.get('e9');
    // e9 walks the lane between rw13 and rw11 (walled N and S) and sees the whole N edge W of it on his way back W:
    // the GB walks past (standing: 25 m in the time e9 walks E and halts) while e9 goes E, then crawls on N of rw13
    const goingE = () => e9.isMoving && Math.cos(e9.heading) > 0.9 && e9.x < 46.5;
    await sneak(D, 'greenberet', [[30, 2.0], [38, 2.2], [46.5, 2.6]], { low: false, when: goingE, stay: 2 });
    await sneak(D, 'greenberet', [[52, 2.6], [57, 2.6]], { minDist: 1 });
    // when he sets off back W from his E end, the GB crawls round rw13's E end into the lane (on his feet there the
    // road guard e30 below would see him past the wall's end), gets up behind him — rw14 hides him from below now —
    // and catches him up with the knife
    const goingW = () => e9.isMoving && Math.cos(e9.heading) < -0.9 && e9.x < 55.8 && e9.x > 54;
    await sneak(D, 'greenberet', [[58.6, 4.4], [57.3, 6.9]], { minDist: 1, stay: 1, pad: 0.5, when: goingW, maxWait: 200 });
    await stab(D, 'e9', { low: false, approach: () => chaseApproach(D, e9, []), maxWait: 20, pad: 0.5 });
    D.checkpoint('C1 e9 knifed');
  }],
  ['Ci', 'Back W along the N edge to the courtyard', async (D) => {
    // out of e9's lane round rw13's E end (lying down: on his feet the road guard e30 below sees him past the wall's
    // end) and W along the N edge, behind the N wall of the courtyard where e11 walks his loop. The gun pit waits: the
    // rim walker e8 sees it from the E end of his beat, so the courtyard and the rim come first
    await D.stance('greenberet', 'crawl');
    await sneak(D, 'greenberet', [[57.3, 6.9], [58.6, 4.4], [57, 2.6], [52, 2.6], [46.5, 2.6], [40, 2.4], [35, 4.5], [34.5, 6.3]], { minDist: 1, stay: 3, pad: 0.5, maxWait: 300 });
    D.checkpoint('Ci1 GB behind the courtyard wall');
  }],
  ['J', 'The courtyard: e11 and e7', async (D) => {
    const e11 = D.get('e11'), e7 = D.get('e7');
    // e11 walks a loop in the walled courtyard behind e7's post: when he sets off E along its N wall, the GB comes round
    // the wall's W end behind him and knifes him at the halt at its E end (a body in there is out of every cone)
    const goingE = () => e11.isMoving && Math.cos(e11.heading) > 0.9 && e11.x > 33.2 && e11.x < 34.6;
    // (his body goes out of the courtyard, behind its N wall: the decoy will bring e5 in there)
    await stab(D, 'e11', { low: false, approach: [[32.4, 7.8], [32.6, 10.6]], when: goingE, maxWait: 120, pad: 0.5,
      carry: [[32.6, 10.4], [31.9, 8.2], [33.6, 6.6]] });
    await D.stance('greenberet', 'crawl');
    D.checkpoint('J1 e11 knifed in the courtyard');
    // e7 stands at the courtyard's S opening looking SE over the depot: from behind
    await stab(D, 'e7', { approach: [[35.5, 14], [36.4, 17.1]], maxWait: 120, pad: 0.5, late: 1.2 });
    await D.stance('greenberet', 'crawl');
    D.checkpoint('J2 e7 knifed at his post');
  }],
  ['K', 'The decoy in the courtyard: e5', async (D) => {
    const gb = D.c('greenberet'), e5 = D.get('e5'), e6 = D.get('e6'), e8 = D.get('e8');
    // the decoy in the courtyard's N part, just under its N wall: in earshot of e5 (W of rw9) and of e8 only at his
    // beat's W end (e6 below the rim never hears it); the GB waits behind the wall's W end
    const DC = [35, 11];
    await sneak(D, 'greenberet', [[32.6, 10.4], [35, 10.4]], { minDist: 1, stay: 1, pad: 0.5 });
    await D.face('greenberet', 35, 12);
    D.ability('greenberet', 'decoyDrop');
    await D.until(() => !gb.has('decoy'), 5, 'decoy down');
    await sneak(D, 'greenberet', [[32.6, 10.4], [31.4, 8.4], [33.2, 7.2]], { minDist: 1, stay: 2, pad: 0.5 });
    D.checkpoint('K1 decoy down in the courtyard');
    // switched on while e8 walks E, away out of earshot (he is back in it 20 s later)
    const d = (e) => Math.hypot(e.x - DC[0], e.z - DC[1]);
    const ear = CONFIG.ai.decoy.radius ?? 13.5;
    const staring = (e) => e.alive && e.brain.state === 'DECOY' && e.brain.phase === 'stare';
    // (on until he is knifed — switched off, he stares only 5 s more, and may turn round as the GB comes up — but no
    // longer than e8 stays out of earshot: if no window opens by then, off, and again when e5 is back on his beat)
    for (let k = 0; ; k++) {
      await D.until(() => d(e5) < ear - 1 && e8.isMoving && Math.cos(e8.heading) > 0.9 && e8.x > 46.5 && e8.x < 50 && d(e6) > ear + 0.5, 300, 'e5 in earshot, e8 walking off E');
      D.ability('greenberet', 'decoyToggle');
      await D.until(() => staring(e5), 40, 'e5 stares at the decoy');
      if (k === 0) D.checkpoint('K2 e5 at the decoy');
      const until = D.t + 12;
      try {
        // round the wall's W end, up behind him; his body goes behind the wall with e11's
        await stab(D, 'e5', { low: false, approach: [[31.6, 8.0], [e5.x - 0.9, e5.z - 0.6]], when: () => staring(e5) && d(e8) > ear + 1 && D.t < until, maxWait: 12, pad: 0.5,
          carry: [[31.4, 8.6], [32.6, 7.0]] });
        if (gb.decoy?.on) D.ability('greenberet', 'decoyToggle');
        break;
      } catch (err) {
        if (k >= 15 || !/^timeout/.test(err.message)) throw err;
        D.log(`  (e5: no window this time: ${err.message.slice(0, 120)})`);
        if (gb.decoy?.on) D.ability('greenberet', 'decoyToggle');
        await D.until(() => e5.brain.state === 'IDLE' && !e5.brain.distractedBy, 200, 'e5 back on his beat');
        await D.wait(21); // (a lure broken off is ignored for 20 s)
      }
    }
    await D.stance('greenberet', 'crawl');
    D.checkpoint('K3 e5 knifed at the decoy');
    for (const e of [e6, e8]) if (e.brain.state === 'DECOY') D.log(`  NOTE ${e.tag} lured too (${e.brain.state}/${e.brain.phase})`);
    await sneak(D, 'greenberet', [[31.4, 8.6], [33.4, 10.4], [34.6, 10.6]], { minDist: 1, stay: 1, pad: 0.5 });
    await pickUpDecoy(D, { pad: 0.5 });
    await sneak(D, 'greenberet', [[32.6, 10.4], [31.4, 8.4], [33.8, 7.0]], { minDist: 1, stay: 2, pad: 0.5 });
  }],
  ['L', 'The Sniper comes over to the courtyard', async (D) => {
    // out of the start yard by the W gap and E along the lane N of the ruins (nobody left up there) to behind the
    // courtyard's N wall
    await sneak(D, 'sniper', [[0.6, 6.6], [1.2, 3.0], [12, 2.0], [22, 2.0], [30, 2.0], [35, 4.5], [38, 5.0]], { minDist: 1, stay: 3, pad: 0.5 }); // (E of the bodies, out of the GB's way and well behind the wall)
    D.checkpoint('L1 Sniper behind the courtyard wall');
  }],
  ['M', 'The rim walkers: e8 and e6', async (D) => {
    const e6 = D.get('e6'), e8 = D.get('e8'), e7 = D.get('e7'), gb = D.c('greenberet');
    // (the road guards e30 and e31 below look up at the rim: a man shot on it is seen to fall. Both rim walkers are drawn
    // off it into the courtyard instead, one at a time)
    // e7's body first, from the courtyard opening to behind the N wall with the others (e8 comes in that way)
    await sneak(D, 'greenberet', [[32.6, 10.4], [35, 15], [e7.x - 0.3, e7.z - 0.8]], { minDist: 1, stay: 2, pad: 0.5, maxWait: 300 });
    // (in the opening a standing man is in sight of the depot below: not while either store walker halts at the N side
    // of his beat looking up this way, nor turns there — the far edge of their cones reaches the opening)
    const e24 = D.get('e24'), e25 = D.get('e25');
    const upLook = () => Math.hypot(e25.x - 50, e25.z - 44.5) < 7 || Math.hypot(e24.x - 58, e24.z - 45) < 7;
    await carryBody(D, 'e7', [[35, 15], [32.6, 10.4], [31.4, 8.4], [33.4, 7.6]], { pad: 0.5, maxWait: 300, fan: true, when: () => !upLook() });
    await D.stance('greenberet', 'crawl');
    D.checkpoint('M1 e7\'s body behind the courtyard wall');
    // the decoy under the courtyard's N wall again: switched on while e8 halts at the W end of his beat (in earshot) and
    // e6 is out of it; e8 walks in through the opening and stares at it, his back to the opening
    // (in the courtyard's NE corner: staring at it from the S he has the W end of the wall, where the GB comes round,
    // well out of the side of his eye)
    const DC = [37, 10.6], ear = CONFIG.ai.decoy.radius ?? 13.5, d = (e) => Math.hypot(e.x - DC[0], e.z - DC[1]);
    await sneak(D, 'greenberet', [[32.6, 10.4], [37, 10.0]], { minDist: 1, stay: 1, pad: 0.5 });
    await D.face('greenberet', 37, 12);
    D.ability('greenberet', 'decoyDrop');
    await D.until(() => !gb.has('decoy'), 5, 'decoy down');
    await sneak(D, 'greenberet', [[32.6, 10.4], [31.4, 8.4], [33.2, 7.2]], { minDist: 1, stay: 2, pad: 0.5 });
    const staring = (e) => e.alive && e.brain.state === 'DECOY' && e.brain.phase === 'stare';
    await D.until(() => d(e8) < ear - 0.5 && e8.brain.atWait && d(e6) > ear + 0.5, 300, 'e8 at the W end of his beat, e6 out of earshot');
    D.ability('greenberet', 'decoyToggle');
    await D.until(() => staring(e8), 40, 'e8 stares at the decoy');
    D.checkpoint('M2 e8 at the decoy');
    // the decoy stays on while he stares (switched off he gives up in a few seconds, too soon for a player's walk round
    // the wall) — but off at once if e6 is about to come into earshot (the next 16 s: the knife and the carry), and once
    // e8's body is behind the wall
    const e6far = () => { for (let t = 0; t <= 16; t += 1) { const q = walker(e6) ? predict(e6, t) : e6; if (Math.hypot(q.x - DC[0], q.z - DC[1]) < ear + 0.5) return false; } return true; };
    const offDecoy = () => { if (gb.decoy?.on) D.ability('greenberet', 'decoyToggle'); };
    // round the wall's W end, up behind him (behind his left shoulder); his body goes behind the wall with the others
    const back = () => { const h = e8.heading - 2.3; return [[31.6, 8.0], [32.6, 10.4], [e8.x + Math.cos(h) * 1.0, e8.z + Math.sin(h) * 1.0]]; };
    await stab(D, 'e8', { low: false, approach: back, when: () => { if (!e6far()) offDecoy(); return staring(e8); }, maxWait: 20, pad: 0.5,
      carry: [[32.6, 10.4], [31.4, 8.6], [32.0, 6.6]] });
    offDecoy();
    await D.stance('greenberet', 'crawl');
    D.checkpoint('M3 e8 knifed at the decoy');
    await sneak(D, 'greenberet', [[31.4, 8.6], [33.4, 10.4], [36.6, 10.3]], { minDist: 1, stay: 1, pad: 0.5 });
    await pickUpDecoy(D, { pad: 0.5 });
    // e6 last, lured off the rim to the decoy just inside the courtyard opening, where the Sniper (E of the wall's S end)
    // shoots him
    // (the Sniper waits close in under the E face of the courtyard wall, out of e6's sight however he turns at the E end)
    const SPW = [40.1, 19.6], SP6 = [39.8, 22.6], DC6 = [36.5, 20.8];
    await sneak(D, 'greenberet', [[35, 15], [DC6[0], DC6[1] - 0.5]], { minDist: 1, stay: 1.5, pad: 0.5, maxWait: 120 });
    await D.face('greenberet', DC6[0], DC6[1] + 2);
    D.ability('greenberet', 'decoyDrop');
    await D.until(() => !gb.has('decoy'), 5, 'decoy down');
    await sneak(D, 'greenberet', [[35, 15], [32.6, 10.4], [31.4, 8.4], [33.4, 7.0]], { minDist: 1, stay: 2, pad: 0.5, maxWait: 120 });
    await sneak(D, 'sniper', [[35, 4.5], [31.6, 7.4], [32.6, 10.4], [34, 14], [36.3, 19.6], [37.6, 21.9], [38.4, 23.2], [39.9, 22.9], [41.6, 19.6], SPW], { minDist: 1, stay: 4, pad: 0.5, maxWait: 300 }); // (into the spot from the N, as a man lying down fits it)
    D.checkpoint('M4 decoy down in the courtyard opening');
    // switched on while e6 halts at the E end looking S: he turns round (by the W) and steps off the rim to it; it stays on
    await D.until(() => e6.brain.atWait && e6.x > 36.5, 120, 'e6 at the E end of the rim');
    D.ability('greenberet', 'decoyToggle');
    await D.until(() => staring(e6), 30, 'e6 stares at the decoy');
    D.checkpoint('M5 e6 at the decoy');
    // he stares N into the courtyard: the Sniper crawls up E of the wall's end and shoots him (the body lies out of sight)
    await sneak(D, 'sniper', [SP6], { minDist: 1, stay: 3, pad: 0.5, maxWait: 30 });
    await snipe(D, 'e6', SP6, { maxWait: 30, body: 30, bodyPad: 0.3, when: () => staring(e6) });
    D.ability('greenberet', 'decoyToggle');
    D.checkpoint('M6 e6 shot at the decoy');
    await sneak(D, 'greenberet', [[31.4, 8.4], [32.6, 10.4], [35, 15], [DC6[0], DC6[1] - 0.6]], { minDist: 1, stay: 1.5, pad: 0.5, maxWait: 60 });
    await pickUpDecoy(D, { pad: 0.5 });
    await sneak(D, 'sniper', [SPW, [41.6, 19.6]], { minDist: 1, stay: 2, pad: 0.5 });
    D.checkpoint('M7 the decoy picked up again');
  }],
  ['D', 'The 210 mm gun: e10 and e29', async (D) => {
    // round rw14's E end behind the gun guard e10 (he faces S over the depot) and the gunner e29 (he faces E): both
    // from behind, each stand-up timed on e30's sweep down on the road (he sees the gun pit from below)
    // (a man lying up here is hidden from the depot below by the edge: only the stand-up and the stab are timed)
    await sneak(D, 'greenberet', [[32.6, 10.4], [31.4, 8.4], [33.8, 6.0], [35, 4.5], [40, 2.4], [46.5, 2.6], [52, 2.6], [57, 2.6], [57.2, 7.4], [58.9, 9.2], [59.6, 11.7]], { minDist: 1, stay: 3, pad: 0.5, maxWait: 300 });
    // (the bodies lie where they fall: a body up here is hidden from the depot below by the edge, and with the rim
    // walkers dead nobody on the plateau is left to see them — the gunner only once his own cone checks clear)
    await stab(D, 'e10', { maxWait: 600, bodyFor: 30 });
    D.checkpoint('D1 e10 knifed');
    await D.stance('greenberet', 'crawl');
    await stab(D, 'e29', { approach: [[61.4, 14.4]], maxWait: 600, bodyFor: 30 });
    D.checkpoint('D2 e29 knifed');
    await D.stance('greenberet', 'crawl');
  }],
  ['F', 'Down the supply track: the Gatling gunner e32', async (D) => {
    const gb = D.c('greenberet');
    // out of the pit round its parapet's E end, down the supply track (ramp_ne) to the ground E of the plateau: the
    // corner N of the Gatling pit, behind its gunner e32 (he sweeps S and W over the road and the bridge)
    await D.stance('greenberet', 'crawl');
    await D.go('greenberet', 66.4, 14.9, { tol: 0.3 });
    // (the top of the track, which the rim walker e8 overlooks as he walks E, while he walks W; then the foot of it,
    // which the bridge walker e31 sees as he comes W)
    await sneak(D, 'greenberet', [[67.8, 16.3], [67.6, 19.5], [68, 23.5], [69.3, 25.3], [71.3, 27.6], [71.9, 26.5]], { minDist: 1, stay: 3, pad: 0.5 });
    // N along the lane W of the pit's sandbag ring, then E N of the pit. The lane between the track's side and the bags
    // is one body wide, along x 72.55 only: he turns into it S of its mouth, where there is room, and crawls straight up
    // it (a man lying down is longer than the lane is wide: turning in it, or off that line, he sticks against the bags)
    await sneak(D, 'greenberet', [[72.0, 27.9], [72.55, 27.9], [72.55, 24.0], [72.4, 23.3], [75, 22.5]], { minDist: 1, stay: 3, pad: 0.5 });
    D.checkpoint('F1 GB down the supply track, N of the Gatling');
    // into the Gatling pit by its open E side, behind the gunner
    await stab(D, 'e32', { approach: [[77.6, 21.5], [77.4, 25.2]], bodyFor: 30, maxWait: 120 });
    await D.stance('greenberet', 'crawl');
    D.checkpoint('F2 e32 knifed in his pit');
  }],
  ['G', 'The decoy in the NE corner: the road guard e30', async (D) => {
    const gb = D.c('greenberet'), e30 = D.get('e30');
    // the decoy at the N end of the ground below the NE face, in earshot of the road guard e30 only; the GB lies in the
    // Gatling pit (its sandbags hide a man lying down) while e30 walks past it
    // (out by the pit's E side on his feet — lying down he can stick in the one-man lane between the bags and the
    // plateau's foot — then down again)
    await sneak(D, 'greenberet', [[77.5, 24.6], [77.7, 22.6]], { low: false, minDist: 1, stay: 1, pad: 0.5 });
    await D.stance('greenberet', 'crawl');
    await sneak(D, 'greenberet', [[74.5, 17.2]], { minDist: 1, stay: 2, pad: 0.5 });
    await D.face('greenberet', 73.8, 16.2);
    D.ability('greenberet', 'decoyDrop');
    await D.until(() => !gb.has('decoy'), 5, 'decoy down');
    await sneak(D, 'greenberet', [[77.3, 22], [77.3, 25.3], [76.2, 25.6]], { minDist: 1, stay: 2, pad: 0.5 });
    D.checkpoint('G1 decoy down below the NE face');
    D.ability('greenberet', 'decoyToggle');
    const staring = (e) => e.brain.state === 'DECOY' && e.brain.phase === 'stare';
    await D.until(() => staring(e30), 60, 'e30 stares at the decoy');
    D.checkpoint('G2 e30 walks round to the decoy');
    // out of the pit by its open E side, up behind him; the body goes into the pit beside the gunner's, where the
    // sandbags hide it from the road (e31 comes up past the pit's E side in a while)
    // (not while the bridge walker e31 is at or coming to the W end of his beat, 10 m from the pit: the turn he makes
    // there, an about-turn either way round, sweeps over it)
    const e31 = D.get('e31'), e31far = () => e31.x > 84 || (e31.x > 80 && Math.cos(e31.heading) > 0.5);
    await lureStab(D, 'e30', { approach: [[77.3, 25.3], [76.5, 21.5]], carry: [[77.3, 22], [77.4, 24.6], [76.4, 25.0], [75.2, 26.3]], maxWait: 60, pad: 0.5, when: e31far }, { tries: 25 });
    D.checkpoint('G3 e30 knifed, his body in the Gatling pit');
    // (out of the pit by its E opening on his feet — a man lying down cannot turn round inside the ring — then down)
    await sneak(D, 'greenberet', [[76.7, 25.1], [77.5, 24.2]], { low: false, minDist: 1, stay: 1, pad: 0.5 });
    await D.stance('greenberet', 'crawl');
    await sneak(D, 'greenberet', [[75, 18]], { minDist: 1, stay: 2, pad: 0.5 });
    await pickUpDecoy(D, { pad: 0.5, maxWait: 300, when: e31far });
  }],
  ['H', 'The decoy N of the Gatling pit: the bridge walker e31', async (D) => {
    const gb = D.c('greenberet'), e31 = D.get('e31');
    // the decoy N of the Gatling pit's open E side, just in earshot of the bridge's W end; the GB lies in the pit. e31
    // comes round the pit's W side to it and stares at it facing E: the GB comes out behind his right shoulder
    const DC = [77.3, 21.0];
    await sneak(D, 'greenberet', [[77.3, 21.9]], { minDist: 1, stay: 2, pad: 0.5 });
    await D.face('greenberet', DC[0], DC[1]);
    D.ability('greenberet', 'decoyDrop');
    await D.until(() => !gb.has('decoy'), 5, 'decoy down');
    await sneak(D, 'greenberet', [[77.3, 24.3], [77.3, 25.3], [76.2, 25.6], [75.8, 25.7]], { minDist: 1, stay: 2, pad: 0.5 });
    D.checkpoint('H1 decoy down N of the Gatling pit');
    // switched on as e31 comes back W along the road to the bridge's W end
    const comingW = () => D.until(() => e31.isMoving && Math.cos(e31.heading) < -0.9 && e31.x < 78, 200, 'e31 coming W to the end of the bridge');
    await comingW();
    D.ability('greenberet', 'decoyToggle');
    const staring = (e) => e.brain.state === 'DECOY' && e.brain.phase === 'stare';
    await D.until(() => staring(e31), 60, 'e31 stares at the decoy');
    D.checkpoint('H2 e31 at the decoy');
    // (behind his right shoulder, out of the pit by its E opening; his body goes into the pit's lee by e30's)
    const back = () => { const h = e31.heading + 2.3; return [[77.3, 24.3], [e31.x + Math.cos(h) * 1.0, e31.z + Math.sin(h) * 1.0]]; };
    // (not while e24 halts at the N end of his loop in the depot, looking N: the far edge of his sweep reaches the pit's E
    // side, and where exactly he stops there — a little short of his waypoint — decides it)
    const e24 = D.get('e24'), e24halt = () => Math.hypot(e24.x - 58, e24.z - 45) < 2.5;
    await lureStab(D, 'e31', { low: false, approach: back, when: () => !e24halt(), carry: [[77.3, 23.8], [77.4, 25.0]], maxWait: 50, pad: 0.5, fan: true }, { retrigger: comingW, tries: 25 });
    D.checkpoint('H3 e31 knifed, his body by the Gatling pit');
    await sneak(D, 'greenberet', [[77.6, 22.4]], { low: false, minDist: 1, stay: 1, pad: 0.5 }); // (on his feet up the lane, as before)
    await D.stance('greenberet', 'crawl');
    await pickUpDecoy(D, { pad: 0.5 });
  }],
  ['I', 'The GB goes back up and W along the N edge', async (D) => {
    // up the supply track again (the rim walker e8 overlooks its top as he walks E), through the gun pit and W along
    // the N edge, behind the N wall of the courtyard where e11 walks his loop
    // (round the pit and up the track in one go, from N of the pit where nobody sees a man lying down: no stop on the
    // way, where e8 on the rim looks down now and then and the edge of what he sees down there is ragged)
    await sneak(D, 'greenberet', [[72.6, 23.2], [71.9, 24.0], [72.6, 25.6], [72.6, 27.0], [71.7, 27.6], [70.6, 26.6], [69.3, 25.3], [68, 23.5], [67.6, 19.5], [67.8, 16.3], [66.4, 14.9]], { minDist: 1, stay: 2, pad: 1.0, lat: 0.7, maxWait: 600 });
    await sneak(D, 'greenberet', [[64, 9.5], [60.5, 8.5], [57.2, 7.4], [57, 2.6], [52, 2.6], [46.5, 2.6], [40, 2.4], [35, 4.5], [34.5, 6.3]], { minDist: 1, stay: 3, pad: 0.5 });
    D.checkpoint('I1 GB behind the courtyard wall');
  }],
  ['Ma', 'The W plateau: e2 and e3', async (D) => {
    const e2 = D.get('e2'), e3 = D.get('e3');
    // out of the courtyard by the W end of its N wall and W along the lane N of the ruins: e2 stands W of rw9 looking S
    // over the plateau; the GB comes up behind him (nobody looks N up here)
    // (his corner is walled N and E: the way in is from the W, through the start yard)
    await sneak(D, 'greenberet', [[32.6, 10.4], [31.4, 8.4], [28, 3.4], [12, 2.6], [1.2, 3.0], [0.6, 6.6], [3, 8.6], [9, 8]], { minDist: 1, stay: 3, pad: 0.5, maxWait: 300 });
    await sneak(D, 'greenberet', [[14, 6.8], [18.4, 6.6]], { minDist: 1, stay: 3, pad: 0.5, maxWait: 300 });
    await stab(D, 'e2', { approach: [[e2.x - 0.95, e2.z - 0.3]], maxWait: 120, pad: 0.5 });
    await D.stance('greenberet', 'crawl');
    D.checkpoint('Ma1 e2 knifed');
    // e3 by the truck yard, looking S over the start yard's S side: from behind too
    // (his corner is walled N and W: round by the E, behind the wall E of him, and along the inside of his N wall)
    // (in one go: no stop at the corner by the road guards' ground, which e4 sweeps from the S end of his beat)
    await sneak(D, 'greenberet', [[25.8, 19.8], [25.3, 21.3], [18.3, 23.3], [17, 21.6], [16.8, 18]], { minDist: 1, stay: 3, pad: 0.5, maxWait: 300 });
    await stab(D, 'e3', { approach: [[12, 17.6], [e3.x + 0.9, e3.z - 0.6]], maxWait: 120, pad: 0.5 });
    await D.stance('greenberet', 'crawl');
    D.checkpoint('Ma2 e3 knifed');
  }],
  ['Mb', 'The W plateau: e4', async (D) => {
    const e4 = D.get('e4');
    // e4 walks between the low wall W of e3's corner and the road guards; at its NW end he halts looking S: the GB
    // comes along the inside of the low wall behind him
    // (he waits N of the low wall's NW end, where the wall hides him from the whole beat — just W of the wall's end e4
    // would see him walking up to his halt — and comes round the end on his feet when e4 halts there)
    await sneak(D, 'greenberet', [[12, 17.6], [6, 19.6], [4.0, 20.6]], { minDist: 1, stay: 3, pad: 0.5, maxWait: 300 });
    await stab(D, 'e4', { low: false, approach: [[3.2, 21.2], [e4.route[0].x - 0.4, e4.route[0].z - 0.8]], when: () => e4.brain.atWait && e4.brain.routeIndex === 0, maxWait: 200, pad: 0.5 });
    await D.stance('greenberet', 'crawl');
    D.checkpoint('Mb1 e4 knifed');
  }],
  ['Mc', 'The road guards e12 and e13', async (D) => {
    const e12 = D.get('e12'), e13 = D.get('e13');
    // the two guards over the W cut look S down it and over the camp. e12 first (e13's sweep never reaches him), from
    // behind; then e13, from behind
    await sneak(D, 'greenberet', [[6.6, 22.2], [10, 25.4], [15.4, 25.8]], { minDist: 1, stay: 3, pad: 0.5, maxWait: 300 });
    // (their bodies go back from the rim, out of the roof guard e19's reach)
    // (lying right behind him first — a man lying up here is never seen, one standing about half the time — so the
    // moment on his feet is short)
    await sneak(D, 'greenberet', [[16.5, 26.4]], { minDist: 1, stay: 2, pad: 0.5, maxWait: 300 });
    await stab(D, 'e12', { approach: [[e12.x - 0.3, e12.z - 1.0]], maxWait: 600, pad: 0.5, carry: [[16.6, 25.6], [16, 23.6]] });
    await D.stance('greenberet', 'crawl');
    D.checkpoint('Mc1 e12 knifed');
    // (first right up behind him lying down — nobody sees a man lying there, not even from the camp below — so that the
    // moment on his feet is short and soon: a man standing up here is seen from below about half the time)
    await sneak(D, 'greenberet', [[13.6, 28.2], [12.6, 28.7]], { minDist: 1, stay: 2, pad: 0.5, maxWait: 300 });
    await stab(D, 'e13', { approach: [[e13.x + 0.2, e13.z - 1.0]], maxWait: 600, pad: 0.5, carry: [[11.4, 28], [10, 25.8]] });
    await D.stance('greenberet', 'crawl');
    D.checkpoint('Mc2 e13 knifed');
  }],
  ['N', 'The Sniper goes down to the road', async (D) => {
    // E along the rim (the dead walkers' beat; a man lying up here is out of sight from the depot below), round the gun
    // pit, down the supply track and W along the road N of the depot's wire, to a spot that has the store in sight
    await sneak(D, 'sniper', [[44.5, 19.2], [50, 19], [56, 18.6], [62, 18.4], [66.4, 17.6]], { minDist: 1, stay: 3, pad: 0.5, maxWait: 300 });
    await sneak(D, 'sniper', [[67.8, 19.5], [68, 23.5], [69.3, 25.3], [71.3, 27.6]], { minDist: 1, stay: 3, pad: 0.5, maxWait: 300 });
    D.checkpoint('N1 Sniper at the foot of the supply track');
    await sneak(D, 'sniper', [[71.5, 31], [68, 34], SNIPER_P1], { minDist: 1, stay: 6, pad: 1.0, maxWait: 300 });
    D.checkpoint('N2 Sniper on the road N of the store');
  }],
  ['O', 'The GB goes down the supply track', async (D) => {
    // the Sniper's way: E along the rim, round the gun pit and down the supply track to the foot of the plateau, where he
    // digs himself into the sand
    await sneak(D, 'greenberet', [[19.8, 26.3], [33.8, 25.8], [39.9, 22.9], [44.5, 19.2], [50, 19], [56, 18.6], [62, 18.4], [66.4, 17.6]], { minDist: 1, stay: 3, pad: 0.5, maxWait: 300 });
    await sneak(D, 'greenberet', [[67.8, 19.5], [68, 23.5], [69.3, 25.3], [70.6, 27.4]], { minDist: 1, stay: 3, pad: 0.5, maxWait: 300 });
    await hop(D, [[69.2, 28.6]], { maxWait: 60 });
    D.checkpoint('O1 GB dug in at the foot of the supply track');
  }],
  ['P', 'The GB burrows W to the end of the wire', async (D) => {
    // W along the foot of the plateau in hops (rise, crawl, dig in), across the road: buried, nobody sees him; each hop
    // is made while no cone will hold him
    const hops = [[63, 28.2], [57, 28], [51, 28.2], [47, 27.6]];
    // (not while e24 halts at the N point of his loop, (58,45), looking N over the wire at the plateau's foot: his
    // head and his turn as he sets off again sweep that ground)
    const e24 = D.get('e24'), N24 = [58, 45];
    const e24off = () => { for (let tt = 0; tt <= 13; tt += 0.5) { const q = predict(e24, tt); if (Math.hypot(q.x - N24[0], q.z - N24[1]) < 2.5) return false; } return true; };
    for (const p of hops) await hop(D, [p], { maxWait: 300, slack: [-0.6, 1.5], when: e24off, fan: true });
    D.checkpoint('P2 GB at the road\'s edge');
  }],
  ['Q', 'The decoy N of the wire: the elevated guards, and into the store', async (D) => {
    const gb = D.c('greenberet'), sn = D.c('sniper'), e24 = D.get('e24'), e25 = D.get('e25'), w = D.world;
    // the decoy goes down N of the wire's W end; the GB digs in E of it. Switched on, it draws the store's two walkers
    // e25 and e24 out round the end of the wire: they stare at it, their backs to the wire, for up to 75 s
    const DC = [36.5, 39.8], WAIT = [40, 44], SPV = [57, 36.5];
    const drop = async () => { await D.face('greenberet', DC[0], DC[1]); D.ability('greenberet', 'decoyDrop'); await D.until(() => !gb.has('decoy'), 5, 'decoy down'); };
    // (first into the sand just E of the spot, then out, a short crawl, the decoy down, and into the sand E of it)
    await hop(D, [[44.5, 33], [38.6, 40.2]], { maxWait: 900 });
    await hop(D, [[38.0, 40.3, 2.2, drop], WAIT], { maxWait: 900 });
    D.checkpoint('Q1 decoy down N of the wire\'s W end');
    const staring = (e) => e.alive && e.brain.state === 'DECOY' && e.brain.phase === 'stare';
    const back = (e) => !e.alive || (e.brain.state === 'IDLE' && !e.brain.distractedBy);
    const comingW = () => back(e24) && back(e25) && e24.isMoving && Math.cos(e24.heading) < -0.8 && e24.x < 53 && e24.x > 50 && e25.x < 46;
    // the elevated guards first. The Sniper crawls a few metres N of his hide to SPQ, where the roof guard e19 and both
    // tank guards e26, e27 are in his sights but too far off (~40 m: his rifle reaches 45, their eyes 36) to see him
    // kneel to fire; lying there nobody sees him at all. Each of the three would see another fall or lie dead, and the
    // camp below sees a man fall from up there: he shoots them one at a time, in whatever order fits (shootSeq), each
    // shot only when his kneel to fire, that man's fall and the body will all go unseen. He waits there for that, while
    // the GB keeps luring the store's walkers e24 and e25 out to the decoy (staring at it, their backs to the road, they
    // see no kneeling man there and no fall)
    let shot = false, inside = false, east = false;
    {
      let on = false, tOn = 0, q2 = false;
      const lure = () => {
        if (!on) { if (comingW()) { D.ability('greenberet', 'decoyToggle'); on = true; tOn = D.t; } return; }
        if (!q2 && staring(e24) && staring(e25)) { q2 = true; D.checkpoint('Q2 e24 and e25 out at the decoy'); }
        // (they stare 75 s at most from the moment they heard it: off as that runs out, so that they walk back then —
        // and not drawn again 20 s later — rather than 5 s after a switch-off at some other moment)
        const done = (e) => !e.alive || e.brain.state !== 'DECOY' || e.brain.t > (w.mission?.rules?.decoyMaxDwell ?? 75) - 0.5;
        if ((D.t > tOn + 8 && done(e24) && done(e25)) || D.t > tOn + 120) { D.ability('greenberet', 'decoyToggle'); on = false; }
      };
      await sneak(D, 'sniper', [SPQ], { minDist: 1, stay: 2, pad: 0.5, maxWait: 600 });
      const planned0 = [];
      const shots = await shootSeq(D, SPQ, ['e19', 'e26', 'e27'], { maxWait: 9000, tick: lure, why: planned0, H: 18, robust: 2 });
      D.log(`  elevated guards: ${shots.join(' ')} (planned ${planned0.join(' ')})`);
      shot = true;
      D.checkpoint('Q3 the tank guards and the roof guard shot');
      if (on) {
        D.ability('greenberet', 'decoyToggle');
        await D.until(() => back(e24) && back(e25), 120, 'e24 and e25 back on their beats');
        await D.wait(21); // (a lure broken off is ignored for 20 s)
      }
      await sneak(D, 'sniper', [SNIPER_P1], { minDist: 1, stay: 4, pad: 0.5, maxWait: 600 });
    }
    for (let cycle = 0; cycle < 60 && !east; cycle++) {
      await D.until(() => back(e24) && back(e25) && e24.isMoving && Math.cos(e24.heading) < -0.8 && e24.x < 53 && e24.x > 50 && e25.x < 46, 400, 'e24 coming W along the wire');
      D.ability('greenberet', 'decoyToggle');
      await D.until(() => staring(e24) && staring(e25), 60, 'e24 and e25 at the decoy');
      const until = D.t + 50; // (they stare 75 s at most from the moment they heard it)
      if (shot && !inside && D.t < until - 5) {
        // round the end of the wire behind them and E along its inside, where nobody else looks, into the sand
        try {
          await hop(D, [[36, 46.6], [33.4, 47.8], [31.6, 48.6], [30.3, 50.6], [31.8, 52], [34.5, 49.8], [38.2, 48.6]], { maxWait: Math.max(1, until - D.t - 30) });
          inside = true;
          D.checkpoint('Q4 GB round the end of the wire, dug in inside');
        } catch (err) { D.log(`  (no way in this time: ${err.message.slice(0, 120)})`); }
      } else if (inside && D.t < until - 5) {
        // (another time they are out:) on E along the inside of the wire, past the store's N side to the reservoir
        try {
          await hop(D, [[42, 46.4], [46, 44.4], [50.5, 42.4], [56, 40.8], [62, 41.6]], { maxWait: Math.max(1, until - D.t - 34) });
          east = true;
        } catch (err) { D.log(`  (not on E this time: ${err.message.slice(0, 120)})`); }
      }
      D.ability('greenberet', 'decoyToggle');
      await D.until(() => back(e24) && back(e25), 120, 'e24 and e25 back on their beats');
      await D.wait(21); // (a lure broken off is ignored for 20 s)
    }
    if (!east) throw new Error('Q: no way into the store');
    D.checkpoint('Q5 GB dug in by the reservoir, inside the wire');
  }],
  ['R', 'The barrels: the reservoir', async (D) => {
    const gb = D.c('greenberet'), e24 = D.get('e24'), e25 = D.get('e25');
    const staring = (e) => e.alive && e.brain.state === 'DECOY' && e.brain.phase === 'stare';
    const back = (e) => !e.alive || (e.brain.state === 'IDLE' && !e.brain.distractedBy);
    // the decoy (still N of the wire's W end) draws the two walkers out again; meanwhile the GB carries b10, the last
    // barrel of the store's NE corner, 4 m E: within reach of the reservoir and still in the store's chain (via b5)
    let done = false;
    for (let cycle = 0; cycle < 30 && !done; cycle++) {
      await D.until(() => back(e24) && back(e25) && e24.isMoving && Math.cos(e24.heading) < -0.8 && e24.x < 53 && e24.x > 50 && e25.x < 46, 400, 'e24 coming W along the wire');
      D.ability('greenberet', 'decoyToggle');
      await D.until(() => staring(e24) && staring(e25), 60, 'e24 and e25 at the decoy');
      const until = D.t + 50;
      try {
        await carryBarrel(D, 'b10', [60.7, 46.5], { pre: [[60, 44], [57.2, 44.9]], post: [[62, 41.6]], maxWait: Math.max(1, until - D.t - 20) });
        done = true;
      } catch (err) { D.log(`  (b10 not this time: ${err.message.slice(0, 140)})`); }
      D.ability('greenberet', 'decoyToggle');
      await D.until(() => back(e24) && back(e25), 120, 'e24 and e25 back on their beats');
      await D.wait(21);
    }
    if (!done) throw new Error('R: b10 never moved');
    D.checkpoint('R1 b10 by the reservoir');
  }],
  ['S', 'Into the store, by the racks', async (D) => {
    // under another lure, through the store to the racks' SE side
    await underLure(D, async (until) => { await hop(D, [[56.3, 51.8], [56.3, 53.3], [53.8, 55.6]], { maxWait: Math.max(1, until - D.t - 24) }); return true; }, { label: 'into the store' });
    D.checkpoint('S1 GB by the racks');
  }],
  ['T', 'The store\'s last walker e28', async (D) => {
    const gb = D.c('greenberet'), e28 = D.get('e28');
    const b6 = D.world.interactables.find((i) => (i.tag ?? i.spawn?.id) === 'b6');
    // e28 walks the S side of the store and halts at its E end looking E at the fuel tanks. Under lures the GB digs in
    // just NW of that halt; under the next he crawls up behind e28 there, knifes him, carries the body to b6 by the
    // fourth rack and puts the barrel down on it (a barrel hides a body; b6 stays in the store's chain): his boot prints
    // in the sand lead there, and to nothing more
    const WAITP = [54.4, 64.6], DROP = [54.6, 58.2];
    await underLure(D, async (until) => { await hop(D, [[55.6, 55.0], [56.3, 56.4], [56.3, 57.8]], { maxWait: Math.max(1, until - D.t - 20) }); return true; }, { label: 'round b6' });
    await underLure(D, async (until) => { await hop(D, [[55.4, 60.5], [54.6, 62.8], WAITP], { maxWait: Math.max(1, until - D.t - 20) }); return true; }, { label: 'by e28\'s E halt', tries: 30 });
    D.checkpoint('T1 GB dug in by e28\'s E halt');
    // (he digs in SE of the barrel: lying any nearer it, he could not turn away from it again)
    const POST = [[56.3, 57.8], [56.9, 58.6]];
    await underLure(D, async (until) => {
      const comingE = () => e28.isMoving && Math.cos(e28.heading) > 0.9 && e28.x > 50.5 && e28.x < 55.6;
      const also = (tEnd, why) => {
        // (a player's clicks: up to 0.6 s each — the knife's approach and the carry's two legs before it, then its own)
        const done = barrelPlan(D, b6, DROP, { pre: [[54.2, 57.8]], post: POST, from: DROP, t0: tEnd, buried: false, except: ['e28'], walkPre: true, why, late: 1.8, lag: 0.6 });
        if (done == null) return false;
        if (!spotSafe(D, DROP[0], DROP[1], done - tEnd - 3 + 1.8 + 0.6 * 4, { except: ['e28'], delay: tEnd, why, body: true, pad: 0.5 })) return false;
        if (D.t + done > until) { why.push('late'); return false; }
        return true;
      };
      await stab(D, 'e28', { low: true, approach: [[55.0, 65.6]], when: comingE, maxWait: Math.max(1, until - D.t - 25), pad: 0.5, carry: [[56.6, 61.0], DROP], also, late: 0.6 });
      D.checkpoint('T2 e28 knifed at his E halt');
      await doBarrel(D, b6, [e28.x, e28.z], { pre: [[54.2, 57.8]], post: POST, onBody: e28, walkPre: true });
      return true;
    }, { label: 'e28', tries: 40 });
    D.checkpoint('T3 b6 on e28\'s body');
  }],
  ['U', 'A barrel between the fuel tanks', async (D) => {
    // b7, by the third rack, goes 9 m E between the two fuel tanks: in reach of both and still in the store's chain (via
    // b6). Under another lure the GB crawls W past b6 to it, carries it over and digs in beside it
    // (not while the barracks walker e21 halts at the E end of his beat, (49.5,79), during the carry: his head sweeps
    // there graze the carry's E end at the far edge of his cone)
    const e21 = D.get('e21'), HALT = [49.5, 79];
    const e21away = () => { for (let tt = 4; tt <= 20; tt += 0.5) { const q = predict(e21, tt); if (Math.hypot(q.x - HALT[0], q.z - HALT[1]) < 1.5) return false; } return true; };
    await underLure(D, async (until) => { await carryBarrel(D, 'b7', [58, 61.8], { pre: [[56.7, 59.8], [55.4, 60.5], [50.2, 60.4]], post: [[57.0, 60.0]], pad: 1.0, when: e21away, maxWait: Math.max(1, until - D.t - 30) }); return true; }, { label: 'b7', tries: 20 });
    D.checkpoint('U1 b7 between the fuel tanks');
  }],
  ['V', 'Out of the store', async (D) => {
    // the way in, backwards, a hop at a time under the lures: N past b6 and b5 to the wire, W along its inside, round
    // its W end behind the two lured walkers and back to the spot E of the decoy
    const out = (leg, label) => underLure(D, async (until) => { await hop(D, leg, { maxWait: Math.max(1, until - D.t - 20) }); return true; }, { label, tries: 20 });
    await out([[56.8, 52.3], [56.3, 51.8]], 'V1');
    D.checkpoint('V1 GB N of the racks');
    await out([[56.3, 47.3], [56, 40.8]], 'V2');
    D.checkpoint('V2 GB at the wire');
    await out([[50.5, 42.4], [46, 44.4], [42, 46.4]], 'V3');
    D.checkpoint('V3 GB W along the inside of the wire');
    await out([[38.2, 48.6]], 'V4');
    D.checkpoint('V4 GB by the W end of the wire');
    await out([[34.5, 49.8], [31.8, 52], [30.3, 50.6], [31.6, 48.6], [33.4, 47.8], [36, 46.6], [40, 44]], 'V5');
    D.checkpoint('V5 GB round the end of the wire, outside');
  }],
  ['W', 'The GB goes E to the bridge', async (D) => {
    // across the road to the foot of the plateau in one crawl (the way he came, backwards), E along it in hops, over the bridge and into the sand
    // on its far side, where the jeep will stop
    // (the first hops only once the store's walkers are back on their beats: turning away from the decoy at the end of
    // a lure, a man's cone sweeps the ground beside it)
    const e24 = D.get('e24'), e25 = D.get('e25');
    // (nor while e25's halt at the E end of his beat is about to end: his about-turn there sweeps the road's edge
    // N of the wire, sooner than predicted at times)
    const turnSoon = (e) => { for (let tt = 0; tt <= 4; tt += 0.25) if (predict(e, tt).wait && !predict(e, tt + 0.5).wait) return true; return false; };
    const beats = () => [e24, e25].every((e) => !e.alive || (e.brain.state === 'IDLE' && !e.brain.distractedBy)) && !turnSoon(e25);
    for (const [k, leg] of [[[38.6, 40.2], [44.5, 33], [47.3, 27.6]], [[51, 28.2]], [[57, 28]], [[63, 28.2]], [[69.2, 28.6]]].entries()) await hop(D, leg, { maxWait: 900, pad: 1.0, slack: [-0.6, 1.5], when: k < 3 ? beats : null });
    D.checkpoint('W1 GB at the foot of the supply track');
    await hop(D, [[72.6, 31.2], [78, 33], [90, 33], [97, 33], [99.5, 35]], { maxWait: 900 });
    D.checkpoint('W2 GB dug in beyond the bridge');
  }],
  ['X', 'The fuse: one rifle shot from the far bank, and the jeep', async (D, ctx = {}) => {
    const sn = D.c('sniper'), gb = D.c('greenberet'), w = D.world;
    const b10 = w.interactables.find((i) => (i.tag ?? i.spawn?.id) === 'b10');
    // the Sniper's last rifle round: from the far bank, a few metres from where the jeep will stop, b10 by the reservoir
    // is in his sights (37 m). He crawls E along the road and over the bridge first (lying down he is seen only close
    // by), so that once the depot goes up nobody has to cross the open road in front of the garrison
    const FIRE = [97, 22.5];
    await sneak(D, 'sniper', [[68, 34], [72.6, 31.2]], { minDist: 1, stay: 3, pad: 1.0, maxWait: 900 });
    await sneak(D, 'sniper', [[78, 33], [86, 33]], { minDist: 1, stay: 3, pad: 1.0, maxWait: 900 });
    await sneak(D, 'sniper', [[92, 33], [97.5, 31.8], [97.3, 28], [97.2, 25], FIRE], { minDist: 1, stay: 3, pad: 1.0, maxWait: 900 });
    D.checkpoint('X1 Sniper on the far bank, b10 in his sights');
    // (kneeling to fire he counts as a standing man: a moment nobody looks)
    await D.until(() => ABILITIES.sniper.canUse(sn, b10, w) === true && routeSafe(D, 'sniper', [], { low: false, hold: 2, pad: 0.5 }), 600, 'a quiet moment to fire');
    D.ability('sniper', 'sniper', b10);
    await D.until(() => w.objectives.filter((o) => ['o1', 'o2', 'o3'].includes(o.id)).every((o) => o.done), 20, 'the depot burns');
    D.checkpoint('X2 the depot goes up');
    await D.idle('sniper');
    await D.stance('sniper', 'crawl');
    const jeep = () => w.vehicles.find((v) => (v.tag ?? v.id) === 'jeep' || v.spawn?.id === 'jeep');
    await D.until(() => !!jeep(), 30, 'the jeep comes');
    if (gb.buried) { D.ability('greenberet', 'shovel'); await D.until(() => !gb.buried && !gb.currentAction, 5, 'GB out of the sand'); }
    await D.stance('greenberet', 'crawl');
    await D.go('greenberet', 100.6, 31.7, { tol: 0.5 }); // (by its E door, lying down)
    await D.until(() => jeep() && (jeep().speed ?? 0) < 0.3 && Math.hypot(jeep().x - 98.5, jeep().z - 31) < 2, 60, 'the jeep at the bridge');
    D.checkpoint('X3 the jeep stops at the bridge');
    // (one door each, at once: the GB the first seat's, on the jeep's E side, the Sniper the second's, on its W side —
    // ordered together, both would make for the first seat's door, and the second man then walks round the jeep in
    // the sight of the garrison coming up the road from the blast)
    // (a man climbing in counts as a standing man for that moment: each climbs in when nobody, the garrison coming up
    // the road from the blast included, looks at his door)
    const unseenUp = (role) => routeSafe(D, role, [], { low: false, hold: 1.0, pad: 0.5, minDist: 0 });
    await D.until(() => unseenUp('greenberet'), 60, 'GB climbs in unseen');
    D.ability('greenberet', 'enterVehicle', jeep());
    const door = ctx.boardPoint ? ctx.boardPoint(jeep(), sn, 1) : null;
    if (door && Math.hypot(sn.x - door.x, sn.z - door.z) > 1.2) await D.go('sniper', door.x, door.z, { tol: 0.6 }).catch(() => {});
    await D.until(() => !!gb.vehicle, 10, 'GB aboard'); // (his click on the jeep now takes the second seat, by his door)
    await D.until(() => unseenUp('sniper'), 60, 'Sniper climbs in unseen');
    D.ability('sniper', 'enterVehicle', jeep());
    await D.until(() => gb.vehicle && sn.vehicle, 30, 'both aboard');
    D.checkpoint('X4 both aboard the jeep');
    await D.until(() => w.objectives.find((o) => o.id === 'o4')?.done, 60, 'away N');
  }],
];

/**
 * Play the whole mission. `ctx.until`: stop after that stage; `ctx.from`: start at that stage (development only, on a
 * world restored from a save made after the stage before it).
 */
export async function solve(D, ctx = {}) {
  installWatch(D);
  const tr = globalThis.process?.env?.TRACE;
  if (tr) { // (debugging: log the named units every 0.2 s from TRACE_FROM s)
    const tags = tr.split(','), from = +(globalThis.process.env.TRACE_FROM ?? 0);
    let nx = 0;
    const until = D.until;
    D.until = (pred, ...a) => until(() => {
      if (D.t >= from && D.t >= nx) {
        nx = D.t + 0.2;
        D.log(`TR ${D.t.toFixed(1)} ` + tags.map((t) => { const e = D.get(t) || D.c(t); return e ? `${t} ${e.brain?.state ?? e.stance}/${e.brain?.phase ?? ''} ${e.x.toFixed(1)},${e.z.toFixed(1)} h${deg(e.heading).toFixed(0)}${e.alive ? '' : ' X'}` : t; }).join(' | '));
      }
      return pred();
    }, ...a);
  }
  const idx = (id) => { const i = STAGES.findIndex((s) => s[0] === id); if (i < 0) throw new Error(`no stage ${id}`); return i; };
  const from = ctx.from ? idx(ctx.from) : 0, until = ctx.until ? idx(ctx.until) : STAGES.length - 1;
  for (let i = from; i <= until; i++) { // (from/until: development, resuming a saved run)
    const [id, title, fn] = STAGES[i];
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
  }
  return D.checkpoints;
}
