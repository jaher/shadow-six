/**
 * Solution driver: a scripted "player" for a mission. A solution is an async function of a driver D that only gives
 * player orders (move / run / stance / ability: knife, decoy, harpoon, use, enter/leave a vehicle…) and waits on things
 * a player can see on screen (unit positions, cones, objectives). The driver itself is engine-agnostic: give it a
 * World and a `step` that advances the game by one fixed tick —
 *   - headless (node):  headlessDriver('m03')                      (tools/solutions/headless.mjs)
 *   - in the browser:   makeDriver(game.world, { step: () => { g.step(); G.render(1 / 60, 1); } })
 * `step` may return a promise (e.g. to hand a frame to a capture loop); the driver awaits it.
 *   - live, in debug mode:  src/debug/solution-replay.js (the in-game SOLUTION replay: `aborted` stops it, `onOrder`
 *     tells it which commando acts so the camera can follow him)
 *
 * Helpers that look ahead (seers, clearAhead, whoSees) read the same §4.2 cone rules the AI uses
 * (src/ai/perception.js): the script watches the cones like a player does before moving a man.
 */
import { takeHeap, giveHeap, takeSet, giveSet } from './state-heap.mjs';
import { mirrorOf, ghostOn } from './ghost.mjs';
import { canSee, coneAt, pointInCone, targetClass, newCone } from '../../src/ai/perception.js';
import { viewerFor, canSeeVehicle } from '../../src/ai/vehicle-ai.js';
import { T } from '../../src/world/grid.js';
import { CONFIG } from '../../src/config.js';
import { compileDashGen, routeFor } from './dash.mjs';

const tagOf = (u) => u?.tag ?? u?.role ?? u?.id ?? '?';

/**
 * Where enemy `e` will be (and face) `t` s from now. A man on his route (IDLE / REINFORCE / RETURN with a route) is
 * walked along it — the rest of his current path, then waypoint to waypoint with each halt's wait and look (LOOP /
 * PINGPONG as the brain advances it). Anyone else walking keeps to his current path, then straight on.
 */
export function predictEnemy(e, t, depth = 0) {
  const b = e.brain, r = e.route;
  // a squad member follows his leader: the leader's prediction plus the member's present offset
  const lead = depth === 0 && b?._leader?.();
  if (lead && lead !== e && lead.alive && b.state !== 'DISTRACTED') {
    // (in file he reaches each turn and halt as far behind the leader as he walks now: his heading lags the same)
    const lag = Math.hypot(e.x - lead.x, e.z - lead.z) / (lead.speed ?? 1.0);
    const q = predictEnemy(lead, t, 1), ql = t > lag ? predictEnemy(lead, t - lag, 1) : { heading: e.heading };
    return { x: q.x + (e.x - lead.x), z: q.z + (e.z - lead.z), heading: ql.heading };
  }
  const sp = e.speed ?? 1.0;
  const onRoute = r && r.length > 1 && b && (b.state === 'IDLE' || b.state === 'REINFORCE' || b.state === 'RETURN') && !b.distractedBy;
  if (!onRoute) {
    // a man walking to a lure / a body / a noise stops where his path ends (an off-route walker does not walk on)
    if (e.isMoving || e.path) return alongPath(e, sp * t, b && b.state !== 'IDLE' && b.state !== 'REINFORCE' && b.state !== 'RETURN');
    return { x: e.x, z: e.z, heading: e.heading };
  }
  let x = e.x, z = e.z, h = e.heading, left = t;
  let i = b.routeIndex ?? 0, dir = b.routeDir ?? 1;
  const loop = (b._routeType || e.spawn?.route?.type || e.routeMode || 'PINGPONG').toUpperCase() === 'LOOP' || e.routeMode === 'loop';
  const loopStart = b._loopStart ?? 0;
  let waitLeft = b.atWait ? Math.max(0, b.waitT ?? 0) : 0;
  // (the next waypoint, halts as haltPose: written out in place — inner closures here allocated a context per call,
  // and this runs for every walker at every sample of every look-ahead)
  if (waitLeft > 0) {
    const wp = r[i];
    if (left <= waitLeft) return haltPose(wp, left + Math.max(0, (wp?.wait ?? 0) - waitLeft), x, z, h);
    if (wp?.look != null) h = (wp.look * Math.PI) / 180;
    left -= waitLeft;
    if (loop) i = i + 1 < r.length ? i + 1 : Math.min(loopStart, r.length - 1);
    else { if (i + dir >= r.length || i + dir < 0) dir *= -1; i += dir; }
  }
  for (let guard = 0; guard < 64; guard++) {
    const wp = r[i];
    const dx = wp.x - x, dz = wp.z - z, L = Math.hypot(dx, dz);
    if (L > 1e-6) {
      h = Math.atan2(dz, dx);
      if (left * sp <= L) return { x: x + (dx / L) * left * sp, z: z + (dz / L) * left * sp, heading: h };
      left -= L / sp; x = wp.x; z = wp.z;
    }
    if (wp.wait > 0) { if (left <= wp.wait) return haltPose(wp, left, x, z, h); if (wp.look != null) h = (wp.look * Math.PI) / 180; left -= wp.wait; }
    if (loop) i = i + 1 < r.length ? i + 1 : Math.min(loopStart, r.length - 1);
    else { if (i + dir >= r.length || i + dir < 0) dir *= -1; i += dir; }
  }
  return { x, z, heading: h };
}

/** At a halt he turns to its look over a couple of seconds (TURN): until then he still faces the way he came (`alt`). */
const HALT_TURN = 3;
function haltPose(wp, into, x, z, h) {
  return wp?.look != null ? { x, z, heading: (wp.look * Math.PI) / 180, alt: into <= HALT_TURN ? h : undefined } : { x, z, heading: h };
}

/**
 * Could walking enemy `e`, predicted at `q` (x, z, heading) at sim time `tAbs`, see `dummy`? Conservative: his head is
 * tried at the predicted heading and at both ends of his sweep (walking men glance about).
 */
const _seeOpt = { cone: null }, _seeCone = newCone(), _seeCone2 = newCone(); // (_seeCone2: clearAhead / routeClear's posted men)
function walkerSees(e, q, dummy, w, tAbs) {
  const amp = e.sweepAmp ?? e.vision?.sweep ?? 0; // radians (normalised vision data)
  // (no head reaches past the cone's longest far radius — perception.coneAt: a, or b = a·ratio for a wide ellipse)
  const v = e.vision, a0 = v?.far ?? v?.range, dx = dummy.x - q.x, dz = dummy.z - q.z;
  const reach = v?.elliptical ? a0 * Math.max(1, v.ellipseRatio ?? CONFIG.stealth.ellipseRatio) : a0;
  if (Number.isFinite(reach) && dx * dx + dz * dz > reach * reach * (1 + 1e-9) + 1e-9) return false;
  // (the same heads in the same order as `for (hd of [heading, alt?]) for (off of [0, ±amp/2, ±amp])`, without the
  // arrays: this runs for every walker, every sample of every look-ahead)
  const nh = q.alt != null ? 2 : 1, no = amp ? 5 : 1;
  const m = mirrorOf(e); // (his ghosts read his fields through a mirror, never through him: ghost.mjs)
  for (let ih = 0; ih < nh; ih++) {
    const hd = ih ? q.alt : q.heading;
    for (let io = 0; io < no; io++) {
      const off = io === 0 ? 0 : io === 1 ? amp / 2 : io === 2 ? -amp / 2 : io === 3 ? amp : -amp;
      const g = ghostOn(m);
      g.x = q.x; g.z = q.z; g.heading = hd; g.sweepActive = false; g.headOffset = off; // head turned `off` (elliptical far)
      const cone = coneAt(g, tAbs, _seeCone); // (one cone refilled: read only by the test below)
      _seeOpt.cone = cone;
      const seen = pointInCone(cone, dummy.x, dummy.z) && canSee(g, dummy, w, _seeOpt) !== 'none';
      _seeOpt.cone = null;
      if (seen) return true;
    }
  }
  return false;
}

/**
 * Could a planSneak search accept ANY goal state? A popped state (cell c, step k) ends the search when c is the goal
 * cell `s1` (or, on foot, any cell whose centre lies within 0.55 m of the target) and the cell stays unseen from k to
 * k + holdK; states run from k0 up to `kMax` (the last step a search can push). When no such cell is unseen for
 * holdK + 1 steps in a row anywhere in [k0, kMax + holdK], the search cannot succeed: it would expand states up to its
 * cap (300 000: ~9 s at M3's shed ramp, the moment the Spy takes e20 aside) and return null. `seen(c, k)` is the
 * planner's own memoised test (pure while it plans), so asking it first changes nothing the search finds.
 */
export function goalReachable(a) {
  const it = goalReachableGen(a);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}
/** goalReachable, yielding now and then (a sliced planner: see makeDriver `pause`). */
export function* goalReachableGen({ s1, tx, tz, W, H, x0, z0, cx, cz, k0, holdK, kMax, seen, raft }) {
  const goals = [s1];
  if (!raft) {
    const gi = Math.floor(tx) - x0, gj = Math.floor(tz) - z0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = gi + di, j = gj + dj;
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const c = j * W + i;
      if (c !== s1 && Math.hypot(cx(c) - tx, cz(c) - tz) <= 0.55) goals.push(c);
    }
  }
  const k1 = kMax + holdK;
  for (const c of goals) {
    let run = 0;
    for (let k = Math.max(0, k0); k <= k1; k++) {
      if ((k & 7) === 0) yield; // (a seen() asks every guard: a slice stays within PLAN_SLICE_MS)
      if (seen(c, k)) { run = 0; continue; }
      if (++run > holdK) return true; // unseen from k - holdK (≥ k0, ≤ kMax) to k
    }
  }
  return false;
}

const TAU = Math.PI * 2; // (as perception.js: seesAnyHeads works out a head's band exactly as pointInCone does)

/**
 * Does any head of `L` see `d`? `L`: one guard's heads at one eye — [viewer, cone, …], every viewer a ghost of the same
 * guard (ghost.mjs) at the same point, differing only by where its head looks (sneak.mjs walkerViews, a planner's
 * headViews) — asked of `see` (perception's canSee or a wrapper of it) as `pointInCone(cone, d) && see(viewer, d, w,
 * {cone}) !== 'none'` head by head. The same answer, asked once: the heads' cones differ only by heading and reach, and
 * once a head has the point in a band its class is seen in (a crawler: the near band), everything else `see` asks —
 * the guard, the eye, the sight line to the point — is the same for every head: that head's answer is the answer.
 * The bands are worked out exactly as pointInCone does (the same arithmetic); a list that is not one guard at one eye
 * is asked head by head.
 */
const NO_OPTS = Object.freeze({});
const _seeHO = { cone: null };
/** see(viewer, d, w, {cone}) with one options object refilled (see only reads it while it runs). */
function seeWith(see, viewer, d, w, cone) {
  _seeHO.cone = cone;
  try { return see(viewer, d, w, _seeHO); } finally { _seeHO.cone = null; }
}
export function seesAnyHeads(L, d, w, see) {
  let S = L._heads;
  if (S === undefined) S = L._heads = headsSummary(L);
  // (see's options: one object refilled — `see` only reads it while it runs; asked for every head of every look-ahead)
  if (!S) { for (let i = 0; i < L.length; i += 2) { const cone = L[i + 1]; if (pointInCone(cone, d.x, d.z) && seeWith(see, L[i], d, w, cone) !== 'none') return true; } return false; }
  const dx = d.x - S.x, dz = d.z - S.z, d2 = dx * dx + dz * dz;
  if (d2 > S.far2) return false; // (beyond every head's reach)
  const bear = d2 > 1e-12 ? Math.atan2(dz, dx) : 0;
  if (S.arc && d2 > 1e-12) {
    // (outside the arc every aperture lies in — tried a turn either way round — no head has the point in its cone)
    let b = bear - S.h0;
    b -= TAU * Math.round(b / TAU);
    const a0 = S.arc[0], a1 = S.arc[1], bp = b + TAU, bm = b - TAU;
    if (!(b >= a0 && b <= a1) && !(bp >= a0 && bp <= a1) && !(bm >= a0 && bm <= a1)) return false;
  }
  let cls;
  for (let i = 0; i < L.length; i += 2) {
    const cone = L[i + 1];
    if (!cone || d2 > cone.far * cone.far) continue;
    if (d2 > 1e-12) { let a = bear - cone.heading; a -= TAU * Math.round(a / TAU); if (Math.abs(a) > cone.halfFov) continue; }
    if (!(d2 <= cone.near * cone.near)) { if (cls === undefined) cls = targetClass(d, NO_OPTS, L[i]); if (cls === 'near') continue; } // (far band: not for a crawler)
    return seeWith(see, L[i], d, w, cone) !== 'none';
  }
  return false;
}
/** One guard at one eye? → {x, z, far2: the longest reach squared}; else null (seesAnyHeads asks head by head). */
function headsSummary(L) {
  let c0 = null, proto, far2 = 0, lo = 0, hi = 0, half = 0, arc = true;
  for (let i = 0; i < L.length; i += 2) {
    const g = L[i], c = L[i + 1];
    if (!c) continue;
    if (!c0) { c0 = c; proto = Object.getPrototypeOf(g); }
    else if (Object.getPrototypeOf(g) !== proto || c.x !== c0.x || c.z !== c0.z || c.y !== c0.y || c.vy !== c0.vy || c.elevated !== c0.elevated
      || c.overlooks !== c0.overlooks || c.overWalls !== c0.overWalls) return null;
    if (!Object.prototype.hasOwnProperty.call(g, 'x') || g.y !== proto.y) return null;
    far2 = Math.max(far2, c.far * c.far);
    // (the arc every head's aperture lies in, about the first head's heading: the heads' headings ± the widest aperture)
    let d = c.heading - c0.heading;
    d -= TAU * Math.round(d / TAU);
    if (!Number.isFinite(d) || !Number.isFinite(c.halfFov)) arc = false;
    else { if (d < lo) lo = d; if (d > hi) hi = d; if (c.halfFov > half) half = c.halfFov; }
  }
  if (!c0) return null;
  // (an arc of 2π or more, or a heading that is not a number: no arc test, every head is asked)
  const a0 = lo - half - 1e-6, a1 = hi + half + 1e-6;
  return { x: c0.x, z: c0.z, far2, h0: c0.heading, arc: arc && a1 - a0 < TAU - 1e-6 ? [a0, a1] : null };
}

/** Wall-clock ms a sliced plan runs before it hands the frame back (makeDriver `pause`). */
export const PLAN_SLICE_MS = 6;
/** Run a generator to its end (a plan's search, straight through). */
function runGen(it) { for (;;) { const r = it.next(); if (r.done) return r.value; } }

/** Is (x, z) inside polygon `poly` ([[x, z], …])? */
function inPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Where a walking unit will be after `dist` m along its current path (then straight on), and his heading there. */
function alongPath(u, dist, stopAtEnd = false) {
  let x = u.x, z = u.z, h = u.heading;
  // (the rest of his path walked in place: the same points in the same order as u.path.slice(pathIndex), no copy)
  const P = u.path, rel = P ? Math.trunc(u.pathIndex ?? 0) || 0 : 0, i0 = P ? (rel < 0 ? Math.max(P.length + rel, 0) : Math.min(rel, P.length)) : 0;
  for (let i = i0; P && i < P.length; i++) {
    const p = P[i];
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
 * @param {import('../../src/world/world.js').World} world
 * @param {{step: () => (void|Promise<void>), dt?: number, log?: (s: string) => void, quiet?: boolean,
 *   aborted?: () => boolean, onOrder?: (role: string, unit: object, order: object, meta?: {quiet?: boolean}) => void,
 *   onCheckpoint?: (cp: object) => void, onWait?: (label: string|null) => void, pause?: () => Promise<void>}} o
 *   aborted: once true, every tick and every order throws SolutionAborted (the replay was stopped: no order may
 *   reach the game after that, even from a solution's own try/catch); onOrder: after each accepted player order;
 *   onWait: what the solution is waiting for (an until's label, a sneak's gap in the cones), null when it goes on —
 *   video mode's AUTO shows it while it runs the wait fast (it changes nothing in the run);
 *   pause: () => Promise resolved on a later displayed frame with no tick in between (the live replay): sliced plans
 *   (planSneakAsync, sneak) hand the frame back with it.
 */
export function makeDriver(world, { step, dt = 1 / 60, log = console.log, quiet = false, watch = true, aborted = null, onOrder = null, onCheckpoint = null, onWait = null, pause = null, skipEscape = null } = {}) {
  const w = world;
  // a sliced plan hands the frame back every PLAN_SLICE_MS (`pause`: resolves on a later frame, no tick in between)
  const runGenAsync = async (it) => {
    let t0 = performance.now();
    for (;;) {
      const r = it.next();
      if (r.done) return r.value;
      if (pause && performance.now() - t0 > PLAN_SLICE_MS) { await pause(); halt(); t0 = performance.now(); }
    }
  };
  const events = [];
  const offs = [];
  const rec = (name, fmt) => offs.push(w.events.on(name, (p) => {
    const line = fmt(p);
    if (line == null) return;
    events.push({ t: w.time, name, line });
    if (!quiet) log(`  [${w.time.toFixed(1)}] ${name} ${line}`);
  }));
  rec('enemy:challenge', (p) => `${tagOf(p.enemy)} -> ${tagOf(p.target)} ${p.enemy?.x?.toFixed?.(1)},${p.enemy?.z?.toFixed?.(1)} h${((p.enemy?.heading * 180 / Math.PI + 360) % 360).toFixed(0)} target@${p.target?.x?.toFixed?.(1)},${p.target?.z?.toFixed?.(1)}`);
  rec('enemy:spotted', (p) => `${tagOf(p.enemy)} -> ${tagOf(p.target ?? p.unit)} from ${p.enemy?.x?.toFixed?.(1)},${p.enemy?.z?.toFixed?.(1)}`);
  rec('enemy:unmasked-spy', (p) => `${tagOf(p.enemy)} -> ${tagOf(p.spy)}`);
  rec('alarm:zone', (p) => `${p.zone?.id ?? p.zone} ${p.event}${p.cause ? ' (' + (p.cause.kind ?? p.cause.type ?? p.cause) + ')' : ''} at ${(+p.x).toFixed(1)},${(+p.z).toFixed(1)}`);
  rec('unit:killed', (p) => `${tagOf(p.unit)} by ${tagOf(p.by ?? p.killer ?? p.source)}`);
  rec('structure:destroyed', (p) => `${p.structure?.id ?? p.id ?? tagOf(p)}`);
  const who = (e) => e ? `${tagOf(e)}[${e.brain?.state}@${e.x?.toFixed(1)},${e.z?.toFixed(1)} h${((e.heading * 180 / Math.PI + 360) % 360).toFixed(0)} sw${e.sweepActive ? 1 : 0}]` : '?';
  rec('vehicle:tainted', (p) => `${tagOf(p.vehicle)} by ${who(p.by)}`);
  // (a mission's own script tainting a vehicle — M6's evacuation truck driven in hostile after the blast — names no
  // guard: nobody saw anything, so it is not a detection)
  offs.push(w.events.on('vehicle:tainted', (p) => { if (!p.by) { const e = events.at(-1); if (e?.name === 'vehicle:tainted') e.scripted = true; } }));
  // shots at a vehicle (a tainted one, or a used raft seen lying empty, §4.3)
  rec('shot', (p) => (p.target?.kind === 'vehicle' ? `${tagOf(p.shooter)} at ${p.target.vehicleType} ${tagOf(p.target)}` : null));
  rec('enemy:state', (p) => (p.to === 'COMBAT' || p.to === 'HOLD') ? `${tagOf(p.enemy)} ${p.from}->${p.to}` : null);
  rec('ability:refused', (p) => `${tagOf(p.unit)} ${p.id ?? p.ability ?? ''} ${p.reason ?? p.text ?? ''}`);
  // (not detections, but a clean solution leaves no body to be found and makes no footsteps anyone hears)
  rec('enemy:body-found', (p) => `${tagOf(p.enemy)} found ${tagOf(p.body?.unit ?? p.body)} at ${p.body?.x?.toFixed?.(1)},${p.body?.z?.toFixed?.(1)}`);
  rec('enemy:heard-steps', (p) => `${tagOf(p.enemy)} at ${(+p.x).toFixed(1)},${(+p.z).toFixed(1)}`);

  // Exposure watch (user, M3 2026-10-08: "make sure no commando goes inside the field of view of a solider before being
  // spotted. Even the raft boat in the light shaded field of view of a soldier makes the soldier see it"): after every
  // tick, every live commando is tried against every live cone with the AI's own rule (perception.canSee: band, stance,
  // disguise, buried, roof, LOS). A solution that wins unspotted must also never be SEEN — not even for a tick before a
  // guard's nervousness builds up: anything but 'none' is an exposure, recorded per guard and commando. Legitimately
  // unseen = what canSee rules out (a man crawling in the light band, the Spy in uniform, a buried GB, out of LOS).
  const exposures = new Map();
  let idleRafts = false; // (D.watchIdleRafts: an unused raft at its mission spawn counts too)
  let crewedRafts = false; // (D.watchCrewedRafts: a raft with a crew aboard counts by its hull too)
  let lastRaft = null; // (the raft last seen deployed: planSneak plans a packed raft's next leg with it, from `o.from`)
  const viewers = (out = []) => {
    for (const e of w.enemies) if (e.alive && !e.removed && e.vision && !e.incapacitated && e.brain?.arch?.reacts !== false) out.push(e);
    // armed enemy crews (tank, patrol boat) see with the vehicle's own cone (vehicle-ai spotCommando)
    for (const v of w.vehicles || []) if (v.vision && !v.removed && !v.driver && v.crewed && v.def?.weapons?.length) out.push(viewerFor(v));
    return out;
  };
  const note = (e, what, band, x0, z0) => {
    const tag = e.kind === 'vehicle-eye' ? tagOf(e.vehicle) : tagOf(e);
    const k = `${tag}|${what}`;
    let x = exposures.get(k);
    const d = Math.hypot(e.x - x0, e.z - z0);
    if (!x) exposures.set(k, x = { viewer: tag, target: what, band, from: w.time, to: w.time, ticks: 0, at: `(${x0.toFixed(1)},${z0.toFixed(1)}) d=${d.toFixed(1)}` });
    x.to = w.time; x.ticks++;
    if (band === 'near') x.band = 'near';
  };
  // (watchTick runs after every tick of a whole walkthrough: its lists, cone and options are kept and refilled — the
  // same men, in the same order, tried with the same rule)
  const _wcs = [], _wrafts = [], _wrowed = [], _wviewers = [], _wcone = newCone(), _wopt = { cone: null };
  const watchTick = () => {
    const cs = _wcs; cs.length = 0;
    for (let i = 0; i < w.commandos.length; i++) { const c = w.commandos[i]; if (c.alive) cs.push(c); }
    if (!cs.length) return;
    // a used raft lying empty is evidence too (§4.3): in any live cone with a clear line of sight, any band, it is seen
    // — whoever lies hidden beside it (under water, crawling unseen) does not make it innocent
    // — with `D.watchCrewedRafts()` so is a raft with a crew aboard, by its hull (the hull edge nearest the guard, as an
    // empty one; the men sit at its centre, so their own test alone misses the near tube); with `D.watchIdleRafts()`
    // also the team's raft still lying where the mission put it. (Both opt-in: solutions written before them — M3 —
    // are held to the crew's own test.)
    const rafts = _wrafts, rowed = _wrowed, vs = w.vehicles || [];
    rafts.length = 0; rowed.length = 0;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.def?.raft && !v.removed && !v.destroyed && (v.occupants?.length ? crewedRafts : (v.used || idleRafts))) rafts.push(v);
    }
    // a boat rowed by the team is seen by its hull (ai/director _rowedBoats: the hull edge nearest the guard in his cone)
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.def?.boat && !v.def.raft && !v.removed && !v.destroyed && v.driver?.faction === 'player') rowed.push(v);
    }
    const vw = viewers(_wviewers);
    for (let vi = 0; vi < vw.length; vi++) {
      const e = vw[vi];
      for (let i = 0; i < rafts.length; i++) { const v = rafts[i]; if (canSeeVehicle(e, v, w)) note(e, `${v.occupants?.length ? 'crewed' : v.used ? 'empty' : 'idle'} ${tagOf(v)}`, 'raft', v.x, v.z); }
      for (let i = 0; i < rowed.length; i++) { const v = rowed[i]; if (canSeeVehicle(e, v, w)) note(e, `${tagOf(v)} hull`, 'boat', v.x, v.z); }
      const cone = coneAt(e, w.time, _wcone);
      _wopt.cone = cone;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        const band = canSee(e, c, w, _wopt);
        if (band === 'none') continue;
        note(e, c.vehicle ? `${c.role} in ${tagOf(c.vehicle)}` : `${c.role} ${c.stance}`, band, c.x, c.z);
      }
    }
    _wopt.cone = null; vw.length = 0; rafts.length = 0; rowed.length = 0; cs.length = 0;
  };
  const halt = () => { if (aborted?.()) throw new SolutionAborted(); };
  // side tasks (D.meanwhile): checked every tick before it runs, each until it returns true
  const side = [];
  const runSide = () => { for (const f of side.slice()) if (f()) side.splice(side.indexOf(f), 1); };
  const tick = async () => { halt(); if (side.length) runSide(); const r = step(); if (r && typeof r.then === 'function') await r; halt(); if (watch) watchTick(); };
  const checkpoints = [];

  let noting = null; // (D.waitNote's label while it stands)
  const D = {
    world: w, events, checkpoints, dt, log,
    get t() { return w.time; },
    /** strict raft watch: the team's raft counts even before anyone has used it (lying at its mission spawn) */
    watchIdleRafts: () => { idleRafts = true; },
    /** strict raft watch: a crewed raft is seen by its hull (the near tube), not only by the men at its centre */
    watchCrewedRafts: () => { crewedRafts = true; },
    /** sneak on foot in straight, decisive dashes (dash.mjs compileDash) instead of the plan's cell clicks: opt-in */
    straightDashes: false,
    /** set by a solution around a section where two async flows of its own step the world in turn (M4's bridgehead
     * strike: the Sniper's last shot while the Green Beret and the Marine get away): the logic run steps each tick at
     * once, so the flows interleave tick by tick; a live replay (debug/solution-replay.js), whose paced step parks one
     * flow at a time to wait for a frame, ticks such a section unpaced too — else the flows interleave otherwise (or the
     * parked one is never woken) and the walkthrough parts from the tested run */
    unpaced: false,
    /** the player's ESC while the loaded escape vehicle drives off (§7.6, Game.skipExtraction): the drive-off skipped,
     * the escape done; false where the harness has no game to ask (`skipEscape` option) or nothing is driving off */
    skipEscape: () => !!skipEscape?.(),
    /** an enemy by tag (e1…e34, st_barr1#0.0.0…) */
    get: (t) => w.enemies.find((e) => e.tag === t || e.id === t) || w.byId?.(t),
    /** a commando by role (greenberet, diver, sapper, spy) */
    c: (r) => w.commandos.find((c) => c.role === r || c.tag === r),
    raft: () => { const r = w.vehicles.find((v) => v.vehicleType === 'raft' && !v.removed); if (r) lastRaft = r; return r; },
    /** where enemy `e` will be `t` s from now (predictEnemy: his route, halts and looks) */
    predict: (e, t) => predictEnemy(e, t),
    item: (id) => w.interactables.find((i) => i.tag === id || i.spawn?.id === id || i.switchId === id || i.def?.id === id),
    /** detections of a commando so far (the solution must keep this at 0) */
    detections: () => events.filter((e) => e.name === 'enemy:spotted' || e.name === 'enemy:challenge' || e.name === 'enemy:unmasked-spy' || (e.name === 'vehicle:tainted' && !e.scripted)).length,
    /** every time a commando, a used raft (empty or by its crewed hull) or a rowed boat was inside a live cone and SEEN (see watchTick) */
    exposures: () => [...exposures.values()],
    exposureReport: () => [...exposures.values()].map((x) => `${x.viewer} saw ${x.target} (${x.band}) ${x.ticks} ticks t=${x.from.toFixed(2)}–${x.to.toFixed(2)} first at ${x.at}`),
    failed() {
      const dead = w.commandos.find((c) => !c.alive);
      return dead ? `${dead.role} died` : null;
    },
    /** Tell video mode what the solution is waiting for (or null: it goes on) without a tick — a sneak whose man lies
     *  still between failed legs (sneak.mjs): AUTO runs such a wait fast, as it does an until's; changes nothing in the run */
    waitNote(label) { noting = label || null; onWait?.(noting); },
    async wait(sec) {
      const n = Math.round(sec / dt), said = sec >= 2 && !!onWait; // (a timer of 2 s or more is a wait too: video mode skips it)
      if (said) onWait(`a ${+sec.toFixed(1)} s pause`);
      try { for (let i = 0; i < n; i++) await tick(); } finally { if (said) onWait(null); }
    },
    async until(pred, maxSec = 120, label = '') {
      const n = Math.round(maxSec / dt);
      let said = false;
      try {
        for (let i = 0; i < n; i++) {
          if (pred()) return true;
          if (!said && label) { said = true; onWait?.(label); }
          await tick();
          const f = D.failed();
          if (f) throw new Error(`FAILED while waiting ${label}: ${f}`);
        }
      } finally { if (said) onWait?.(null); }
      throw new Error(`timeout ${maxSec}s waiting ${label}`);
    },
    /** until, for a predicate that may await (a sliced plan inside it): the same ticks, the same checks */
    async untilAsync(pred, maxSec = 120, label = '') {
      const n = Math.round(maxSec / dt);
      let said = false;
      try {
        for (let i = 0; i < n; i++) {
          if (await pred()) return true;
          if (!said && label) { said = true; onWait?.(label); }
          await tick();
          const f = D.failed();
          if (f) throw new Error(`FAILED while waiting ${label}: ${f}`);
        }
      } finally { if (said) onWait?.(null); }
      throw new Error(`timeout ${maxSec}s waiting ${label}`);
    },
    /** a player order (commando.issue); throws with the refusal text when the game refuses it */
    order(role, o) {
      halt();
      const u = D.c(role) || D.get(role);
      if (!u.issue(o)) {
        const tgt = o.target?.tag ?? o.target?.id ?? o.target;
        throw new Error(`order refused ${role} ${JSON.stringify({ ...o, target: tgt })}: ${JSON.stringify(u.lastRefusal?.text ?? null)}`);
      }
      // (an order given while a waitNote stands — a sneak's futile leg, planned again — is part of that wait: `quiet`)
      onOrder?.(role, u, o, noting ? { quiet: true } : undefined);
      return true;
    },
    ability(role, id, target) { return D.order(role, { type: 'ability', id, target: target ?? D.c(role) }); },
    /** wait until the man has finished what he is doing (knife, plant, pick-up…) */
    async idle(role, maxSec = 10) { const u = D.c(role); await D.until(() => !u.currentAction && !u.pendingAbility, maxSec, `${role} idle`); },
    /** stance order, retried while an action that cannot be interrupted finishes */
    async stance(role, st) {
      const u = D.c(role);
      if (u.stance === st) return true;
      for (let i = 0; i < 180; i++) {
        halt();
        if (u.issue({ type: 'stance', stance: st })) {
          onOrder?.(role, u, { type: 'stance', stance: st });
          for (let k = 0; k < 120 && (u._stanceT ?? 0) > 0; k++) await tick(); // the get-up / get-down itself
          return true;
        }
        await tick();
      }
      throw new Error(`stance ${st} refused for ${role}`);
    },
    /** move (walk / run / keep the current stance) and wait until he gets there */
    async go(role, x, z, { run = false, stance = null, tol = 0.6, max = 180 } = {}) {
      const u = D.c(role);
      if (stance && u.stance !== stance) {
        await D.stance(role, stance);
      }
      D.order(role, { type: 'move', x, z, run });
      const t0 = D.t;
      await D.until(() => Math.hypot(u.x - x, u.z - z) < tol || (!u.path && !u.isMoving && D.t > t0 + 0.5), max, `${role} -> (${x},${z})`);
      const d = Math.hypot(u.x - x, u.z - z);
      if (d > tol + 0.5) throw new Error(`${role} stopped at (${u.x.toFixed(2)},${u.z.toFixed(2)}), ${d.toFixed(2)} m short of (${x},${z})`);
    },
    async path(role, pts, o = {}) { for (const [x, z] of pts) await D.go(role, x, z, { tol: 0.6, max: 120, ...o }); },
    /** turn a man towards (x, z) the way a player does: a short step that way */
    async face(role, x, z, step = 0.35) {
      const u = D.c(role);
      const d = Math.hypot(x - u.x, z - u.z) || 1;
      D.order(role, { type: 'move', x: u.x + ((x - u.x) / d) * step, z: u.z + ((z - u.z) / d) * step });
      await D.until(() => !u.path && !u.isMoving, 5, `${role} faces (${x},${z})`);
    },
    /** row the raft (the Marine at the oars) to (x, z) and wait until it stops */
    async row(x, z, max = 90, { fast = false } = {}) {
      const raft = D.raft();
      D.order('diver', { type: 'move', x, z, run: fast }); // (fast: paddled hard, §3.7 fast speed)
      const t0 = D.t;
      await D.until(() => (Math.hypot(raft.x - x, raft.z - z) < 1.2 && (raft.speed || 0) < 0.1) || (D.t > t0 + 1 && !raft.goal && (raft.speed || 0) < 0.05), max, `raft -> (${x},${z})`);
      const d = Math.hypot(raft.x - x, raft.z - z);
      if (d > 2) throw new Error(`raft stopped at (${raft.x.toFixed(2)},${raft.z.toFixed(2)}), ${d.toFixed(2)} m from (${x},${z})`);
    },
    /** enemies that see a man at (x, z) right now (low = prone) */
    seers(x, z, low = true) {
      const dummy = { x, z, y: w.grid.elevAt?.(x, z) ?? 0, isLow: low, isVisibleToEnemies: true };
      return w.enemies.filter((e) => e.alive && !e.removed && e.vision && canSee(e, dummy, w) !== 'none').map((e) => e.tag);
    },
    /**
     * Will (x, z) stay unseen for the next `dur` s? Static enemies: their cones are predicted (the sweep is a function
     * of time). Walking ones: predicted along their heading (patrol legs are straight over a few seconds).
     */
    clearAhead(x, z, dur = 2, low = false, why = null, except = null, pad = 0, from = 0) { // (`from`: the window starts that many s from now; it still ends `dur` s from now)
      const dummy = { x, z, y: w.grid.elevAt?.(x, z) ?? 0, isLow: low, isVisibleToEnemies: true };
      for (const e of w.enemies) {
        if (!e.alive || e.removed || !e.vision || except?.includes?.(e)) continue;
        const d = Math.hypot(e.x - x, e.z - z), far = (e.vision.far ?? 36) + 1;
        if (e.isMoving || e.path || (e.route && e.route.length > 1 && !e.brain?.distractedBy)) {
          if (d > far + 3 * dur) continue;
          // walking: predicted along his current path (straight on past its end), at his speed
          const farE = e.vision.far ?? 36, edge = low ? (e.vision.near ?? farE / 2) : farE;
          for (let t = from; t <= dur + 1e-6; t += 0.1) {
            const q = predictEnemy(e, t);
            if (walkerSees(e, q, dummy, w, w.time + t)) { if (why) why.push(`${e.tag}~@+${t.toFixed(1)}`); return false; }
            // (a squad's man wheeling where the file turns: any heading, as in planSneak)
            const ha = predictEnemy(e, Math.max(0, t - 3)).heading, hb = predictEnemy(e, t + 3).heading;
            let dh = Math.abs(ha - hb) % (2 * Math.PI); if (dh > Math.PI) dh = 2 * Math.PI - dh;
            if (e.squad?.id != null && e.brain?._leader?.() !== e && dh > 1 && [0, 1, 2, 3, 4, 5, 6, 7].some((r) => walkerSees(e, { ...q, heading: (r * Math.PI) / 4 }, dummy, w, w.time + t))) { if (why) why.push(`${e.tag}~turn@+${t.toFixed(1)}`); return false; }
            // (`pad`: his pace drifts from the prediction — at the edge of the band that matters, `pad` m nearer must be
            // clear too)
            const dq = Math.hypot(q.x - x, q.z - z);
            if (pad > 0 && Math.abs(dq - edge) < pad + 0.5 && dq > pad) {
              const f = pad / dq, d2 = { ...dummy, x: x + (q.x - x) * f, z: z + (q.z - z) * f };
              if (walkerSees(e, q, d2, w, w.time + t)) { if (why) why.push(`${e.tag}~edge@+${t.toFixed(1)}`); return false; }
            }
          }
          continue;
        }
        if (d > far) continue;
        for (let t = from; t <= dur + 1e-6; t += 0.1) {
          if (seeWith(canSee, e, dummy, w, coneAt(e, w.time + t, _seeCone2)) !== 'none') { if (why) why.push(`${e.tag}@+${t.toFixed(1)}`); return false; }
        }
      }
      return true;
    },
    /**
     * Would a man moving along `pts` (from his position, at `speed` m/s, starting in `delay` s, pausing `pause` s at
     * each listed point) stay unseen? Cones are predicted as in clearAhead, at each sample's arrival time.
     */
    routeClear(role, pts, { speed = 0.9, low = true, delay = 0, pause = 0, step = 0.5, minDist = 6, why = null, from = null } = {}) {
      const u = D.c(role);
      const samples = [];
      let [x, z] = from ?? [u.x, u.z], t = delay; // (`from`: a later leg, from where an earlier one ends)
      samples.push([x, z, t]);
      for (const [px, pz, extra = 0] of pts) {
        const L = Math.hypot(px - x, pz - z), n = Math.max(1, Math.ceil(L / step));
        for (let k = 1; k <= n; k++) samples.push([x + ((px - x) * k) / n, z + ((pz - z) * k) / n, t + (L * k) / n / speed]);
        t += L / speed; x = px; z = pz;
        if (pause + extra > 0) { samples.push([x, z, t + (pause + extra) / 2]); t += pause + extra; samples.push([x, z, t]); }
      }
      // (one dummy refilled per sample, the samples walked by index: the same tests in the same order as a fresh
      // dummy per sample under `for (const [sx, sz, st] of samples)`, without that garbage — this runs every tick)
      const dummy = { x: 0, z: 0, y: 0, isLow: low, isVisibleToEnemies: true };
      for (const e of w.enemies) {
        if (!e.alive || e.removed || !e.vision) continue;
        const moving = e.isMoving || e.path || (e.route && e.route.length > 1), far = (e.vision.far ?? 36) + 1;
        for (let si = 0; si < samples.length; si++) {
          const S = samples[si], sx = S[0], sz = S[1], st = S[2];
          const q = moving ? predictEnemy(e, st) : { x: e.x, z: e.z, heading: e.heading };
          const dd = Math.hypot(q.x - sx, q.z - sz);
          if (dd > far) continue;
          if (dd < minDist && moving) { if (why) why.push(`${e.tag} close@(${sx.toFixed(1)},${sz.toFixed(1)})+${st.toFixed(1)}`); return false; } // too close to trust a cone
          dummy.x = sx; dummy.z = sz; dummy.y = w.grid.elevAt?.(sx, sz) ?? 0;
          const sees = moving ? walkerSees(e, q, dummy, w, w.time + st) : seeWith(canSee, e, dummy, w, coneAt(e, w.time + st, _seeCone2)) !== 'none';
          if (sees) { if (why) why.push(`${e.tag}@(${sx.toFixed(1)},${sz.toFixed(1)})+${st.toFixed(1)}`); return false; }
        }
      }
      return true;
    },
    /**
     * Would the raft rowed along `pts` (from where it lies, at its paddling speed, starting in `delay` s) stay unseen?
     * The men aboard sit in plain view (§4.2: an open boat hides nobody), low behind cover like a crouching man — the
     * same rule the AI reads (perception: open-boat occupants). As for a man on land, a guard notices only what MOVES
     * in his cone (§4.5 nervousness grows with the displacement), so the samples are the stretches under way, timed like
     * the raft drives (pivot on the spot at its turn rate, then straight off), each tried over `slack` s around its
     * moment. Cones are predicted as in routeClear; a walker within `minDist` m of the route at any moment fails it.
     */
    rowClear(pts, { delay = 0, slack = [-0.1, 0.25], step = 0.5, minDist = 6, why = null, fast = false, from = null, hold = 0, pad = 0, except = null } = {}) {
      // (`fast`: paddled at fast speed; `from` [x, z, heading]: a later leg, from where an earlier one ends; `hold` s:
      // the raft then lies at the last point that long, crewed; `pad` m: each sample also tried that much nearer each
      // guard and to either side, a margin at the edges of his cone; `except`: guards left out, e.g. a posted MG whose
      // sweep is checked apart with a tighter slack)
      const raft = D.raft(), sp = (fast ? raft.def?.fast : raft.def?.slow) || 2.5, rate = raft.def?.turn || Math.PI / 2;
      const samples = [];
      let [x, z, h] = from ?? [raft.x, raft.z, raft.heading], t = delay + 2 * dt; // the order lands next tick
      for (const [px, pz] of pts) {
        // §3.7 he pivots on the spot (not noticed), then paddles off straight, at full speed within half a second
        const want = Math.atan2(pz - z, px - x);
        let dh = Math.abs(((want - h + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        t += Math.max(0, dh - 0.05) / rate + 0.25;
        h = want;
        const L = Math.hypot(px - x, pz - z), n = Math.max(1, Math.ceil(L / step));
        for (let k = 0; k <= n; k++) for (let o = slack[0]; o <= slack[1] + 1e-6; o += 0.1) samples.push([x + ((px - x) * k) / n, z + ((pz - z) * k) / n, Math.max(0, t + o + (L * k) / n / sp)]);
        t += L / sp; x = px; z = pz;
      }
      for (let o = 0; o <= hold + 1e-6; o += 0.25) samples.push([x, z, t + o]);
      const boat = { isOpenBoat: true, def: { seated: true, occludes: false } };
      for (const e of w.enemies) {
        if (!e.alive || e.removed || !e.vision || except?.includes?.(e)) continue;
        const moving = e.isMoving || e.path || (e.route && e.route.length > 1), far = (e.vision.far ?? 36) + 1;
        for (const [sx, sz, st] of samples) {
          const q = moving ? predictEnemy(e, st) : { x: e.x, z: e.z, heading: e.heading };
          const dd = Math.hypot(q.x - sx, q.z - sz);
          if (dd > far) continue;
          if (dd < minDist && moving) { if (why) why.push(`${e.tag} close@(${sx.toFixed(1)},${sz.toFixed(1)})+${st.toFixed(1)}`); return false; }
          const dummy = { x: sx, z: sz, y: 0, state: 'inVehicle', vehicle: boat, isVisibleToEnemies: true, alive: true };
          // a patrol squad's man standing at a halt looks his own way (the prediction gives him his leader's heading)
          const still = moving && e.squad?.id != null && Math.hypot(q.x - e.x, q.z - e.z) < 1;
          const sees1 = (d) => moving ? walkerSees(e, q, d, w, w.time + st) || (still && walkerSees(e, { x: q.x, z: q.z, heading: e.heading }, d, w, w.time + st))
            : canSee(e, d, w, { cone: coneAt(e, w.time + st) }) !== 'none';
          // (`pad`: the hull and the men in it stand a little off its centre — tried `pad` m nearer and to either side too)
          const ux = (q.x - sx) / (dd || 1), uz = (q.z - sz) / (dd || 1);
          const sees = sees1(dummy) || (pad > 0 && dd > pad && [[ux, uz], [-uz, ux], [uz, -ux]].some(([ox, oz]) => sees1({ ...dummy, x: sx + ox * pad, z: sz + oz * pad })));
          if (sees) { if (why) why.push(`${e.tag}@(${sx.toFixed(1)},${sz.toFixed(1)})+${st.toFixed(1)}`); return false; }
        }
      }
      return true;
    },
    /** wait (up to maxSec) for a moment the raft can row `pts` unseen (rowClear), then row it leg by leg */
    async rowSafe(pts, { maxSec = 240, label = 'raft route' } = {}) {
      const why = [];
      await D.until(() => { why.length = 0; return D.rowClear(pts, { why }); }, maxSec, `${label} clear`)
        .catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
      for (const [x, z] of pts) await D.row(x, z);
    },
    /**
     * Row `pts` stop-and-go, like a player watching the cones: each leg is cut into hops of at most `hop` m; before
     * each hop the raft lies still (a still raft is not noticed beyond arm's reach, §4.5) until the hop is clear.
     */
    async rowHops(pts, { hop = 6, maxSec = 240, label = 'raft route' } = {}) {
      const raft = D.raft();
      let x = raft.x, z = raft.z;
      for (const [px, pz] of pts) {
        const n = Math.max(1, Math.ceil(Math.hypot(px - x, pz - z) / hop));
        for (let k = 1; k <= n; k++) await D.rowSafe([[x + ((px - x) * k) / n, z + ((pz - z) * k) / n]], { maxSec, label: `${label} → (${px},${pz}) ${k}/${n}` });
        x = px; z = pz;
      }
    },
    /**
     * Plan a raft route to (tx, tz) the way a player picks one by eye: the cheapest chain of 1 m water cells, each
     * costing more the longer the guards' cones (posted men, predicted over the next `look` s) sweep over it, then cut
     * into straight hops of at most `hop` m (the raft drives straight from click to click, §3.7). Returns the hop ends.
     */
    planRow(tx, tz, o = {}) {
      const { hop = 4, look = 10, weight = 40, box = 30, maxCov = 0.9 } = o;
      const raft = D.raft(), g = w.grid;
      const x0 = Math.floor(Math.min(raft.x, tx) - box), x1 = Math.ceil(Math.max(raft.x, tx) + box);
      const z0 = Math.floor(Math.min(raft.z, tz) - box), z1 = Math.ceil(Math.max(raft.z, tz) + box);
      const W = x1 - x0 + 1, H = z1 - z0 + 1, N = W * H;
      const ok = new Uint8Array(N), cost = new Float32Array(N).fill(-1);
      const boat = { isOpenBoat: true, def: { seated: true, occludes: false } };
      const posted = w.enemies.filter((e) => e.alive && !e.removed && e.vision && !(e.route && e.route.length > 1));
      const at = (i, j) => [x0 + i, z0 + j];
      const water = (x, z) => raft.passableAt(x, z) && raft.passableAt(x + 0.6, z) && raft.passableAt(x - 0.6, z) && raft.passableAt(x, z + 0.6) && raft.passableAt(x, z - 0.6);
      // gunners, crews and dogs fire on sight (§4.5): they notice a raft lying still too — never stop where they look
      const firesOnSight = (e) => !e.brain?.arch?.challenges || e.flags?.firesOnSight || e.brain?.combatReady;
      const cov = (k) => {
        if (cost[k] >= 0) return cost[k];
        const [x, z] = at(k % W, Math.floor(k / W));
        let seen = 0, n = 0;
        const near = posted.filter((e) => Math.hypot(e.x - x, e.z - z) < (e.vision.far ?? 36) + 1);
        for (let t = 0; t < look; t += 0.25) {
          n++;
          const d = { x, z, y: 0, state: 'inVehicle', vehicle: boat, isVisibleToEnemies: true, alive: true };
          const who = near.filter((e) => canSee(e, d, w, { cone: coneAt(e, w.time + t) }) !== 'none');
          if (who.some(firesOnSight)) return (cost[k] = 1);
          if (who.length) seen++;
        }
        return (cost[k] = seen / n);
      };
      // men on the move who fire on sight (anyone while the siren sounds, a guard still combat-ready): keep 20 m off them
      const hot = w.enemies.filter((e) => e.alive && !e.removed && e.vision && (e.route?.length > 1 || e.isMoving || e.path)
        && (firesOnSight(e) || w.alarm?.active));
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const [x, z] = at(i, j);
        ok[j * W + i] = water(x, z) && !hot.some((e) => Math.hypot(e.x - x, e.z - z) < 20) ? 1 : 0;
      }
      const idx = (x, z) => Math.round(z) - z0 >= 0 && Math.round(x) - x0 >= 0 && Math.round(x) - x0 < W && Math.round(z) - z0 < H ? (Math.round(z) - z0) * W + (Math.round(x) - x0) : -1;
      const s0 = idx(raft.x, raft.z), s1 = idx(tx, tz);
      ok[s0] = 1; ok[s1] = 1;
      const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
      dist[s0] = 0;
      const open = [s0];
      while (open.length) {
        let bi = 0;
        for (let q = 1; q < open.length; q++) if (dist[open[q]] < dist[open[bi]]) bi = q;
        const k = open[bi]; open[bi] = open[open.length - 1]; open.pop();
        if (done[k]) continue;
        done[k] = 1;
        if (k === s1) break;
        const i = k % W, j = Math.floor(k / W);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const nk = nj * W + ni;
          if (!ok[nk] || done[nk]) continue;
          const cv = cov(nk);
          if (cv > maxCov && nk !== s1) continue; // watched nearly all the time: no gap to slip through
          const c = dist[k] + Math.hypot(di, dj) * (1 + weight * cv);
          if (c < dist[nk]) { dist[nk] = c; prev[nk] = k; open.push(nk); }
        }
      }
      if (!done[s1]) throw new Error(`no water route to (${tx},${tz})`);
      const cells = [];
      for (let k = s1; k >= 0; k = prev[k]) cells.push(at(k % W, Math.floor(k / W)));
      cells.reverse();
      cells[cells.length - 1] = [tx, tz];
      if (o.cells) return cells;
      // straight hops: from each hop start, the furthest cell along the chain within `hop` m that the raft reaches straight
      const hops = [];
      let a = 0, sx = raft.x, sz = raft.z;
      while (a < cells.length - 1) {
        let b = a + 1;
        for (let c = a + 1; c < cells.length; c++) {
          const [cx, cz] = cells[c];
          if (Math.hypot(cx - sx, cz - sz) > hop) break;
          if (raft.straightReach(cx, cz, sx, sz) >= Math.hypot(cx - sx, cz - sz) - 0.3) b = c;
        }
        hops.push(cells[b]); [sx, sz] = cells[b]; a = b;
      }
      // no click closer than 1.5 m to the last one (a raft does not set off for an arm's length)
      const out = [];
      let px = raft.x, pz = raft.z;
      for (let k = 0; k < hops.length; k++) {
        const last = k === hops.length - 1, [hx, hz] = hops[k];
        if (!last && Math.hypot(hx - px, hz - pz) < 1.5) continue;
        if (last && out.length && Math.hypot(hx - px, hz - pz) < 1.5) out.pop();
        out.push(hops[k]); [px, pz] = hops[k];
      }
      return out;
    },
    /**
     * Row to (tx, tz) along the planned chain (planRow), stop-and-go like a player: the raft lies still (unnoticed)
     * and, each moment, clicks the furthest point of the chain 1.5–`hop` m ahead that it can reach straight and unseen
     * (rowClear) — a shorter hop fits a shorter gap between two sweeps.
     */
    async rowTo(tx, tz, { hop = 3.5, maxSec = 240, label = 'raft' } = {}) {
      const raft = D.raft(), cells = D.planRow(tx, tz, { cells: true });
      if (!quiet) log(`  row plan → (${tx},${tz}): ${cells.length} cells`);
      let at = 0;
      const t0 = D.t;
      while (Math.hypot(raft.x - tx, raft.z - tz) > 1.2) {
        let pick = -1;
        // the last stretch: straight in to the landing point, as a player clicks it
        if (Math.hypot(tx - raft.x, tz - raft.z) <= 8 && D.rowClear([[tx, tz]])) pick = cells.length - 1;
        for (let c = cells.length - 1; c > at && pick < 0; c--) {
          const [cx, cz] = cells[c], d = Math.hypot(cx - raft.x, cz - raft.z);
          if (d > hop || (d < 1.5 && c !== cells.length - 1)) continue;
          if (raft.straightReach(cx, cz) < Math.min(d - 0.3, 1.2)) continue; // (it may stop a little short: fine)
          if (D.rowClear([[cx, cz]])) { pick = c; break; }
        }
        if (pick < 0) {
          if (D.t - t0 > maxSec) {
            const why = [], nx = cells.slice(at + 1).find(([cx, cz]) => Math.hypot(cx - raft.x, cz - raft.z) >= 1.5) || [tx, tz];
            D.rowClear([nx], { why });
            throw new Error(`timeout ${maxSec}s: ${label} → (${tx},${tz}) stuck at (${raft.x.toFixed(1)},${raft.z.toFixed(1)}), next (${nx}) [${why.join(' ')}]`);
          }
          await D.wait(dt);
          const f = D.failed(); if (f) throw new Error(`FAILED rowing ${label}: ${f}`);
          continue;
        }
        if (!quiet && globalThis.process?.env?.ROWDBG) log(`    [${w.time.toFixed(2)}] hop (${raft.x.toFixed(1)},${raft.z.toFixed(1)}) → (${cells[pick]})`);
        try { await D.row(...cells[pick]); } catch (e) { if (!/raft stopped/.test(e.message)) throw e; }
        // progress = the chain cell nearest the raft now (it may have stopped short against the bank)
        let bi = at, bd = Infinity;
        for (let c = at; c < cells.length; c++) { const d = Math.hypot(cells[c][0] - raft.x, cells[c][1] - raft.z); if (d < bd) { bd = d; bi = c; } }
        at = Math.max(at, bi);
      }
    },
    /**
     * Space-time sneak plan (the way a player times a dash between two sweeps): the fastest chain of 1 m cells from
     * where the raft / man is to (tx, tz) that no cone will cover while he is in it — a cell is entered only when it
     * stays clear from `margin[0]` steps before to `margin[1]` steps after, and he WAITS only where nobody will look.
     * Cones are predicted with the AI's own rule: posted men by their sweep (coneAt at the future time), walkers along
     * their route (predictEnemy, every glance of the head: walkerSees) and never closer than `keepWalker` m. mode:
     * 'raft' (the men sitting in it, seen in both bands), 'crawl' (low: near band only), 'walk'.
     * @returns {Array<[number, number, number]>|null} [x, z, absolute time] per cell, or null (no way within `horizon` s)
     */
    planSneak(tx, tz, o = {}) { return runGen(D.planSneakGen(tx, tz, o)); },
    /**
     * planSneak sliced: the same search, handing the frame back (makeDriver `pause`) after every PLAN_SLICE_MS of it —
     * no tick runs meanwhile, so the world it reads stands still and the plan is the one planSneak returns. Without a
     * `pause` (headless, tests) it runs straight through.
     */
    planSneakAsync(tx, tz, o = {}) { return runGenAsync(D.planSneakGen(tx, tz, o)); },
    /** Run any generator the sliced way (sneak.mjs plans): hand the frame back every PLAN_SLICE_MS (`pause`). */
    runSliced(it) { return runGenAsync(it); },
    /**
     * A side task while the solution goes on with something else: `fn` is called every tick (before it runs) until it
     * returns true — a second man's orders timed by the world (the Spy who talks to a patrol the moment it halts while
     * the Sapper crawls off elsewhere), as a player gives orders to two men at once. `D.pending(fn)`: still running?
     */
    meanwhile(fn) { side.push(fn); return fn; },
    pending(fn) { return side.includes(fn); },
    /**
     * A drive order's turn plan made beforehand, sliced: the vehicle `role` drives plans its multi-point turn toward
     * (x, z) (Vehicle.planDriveGen) handing the frame back every PLAN_SLICE_MS with no tick in between, into the memo the
     * order reads — so the order, given next, finds the very plan it would have made at once (a cramped three-point
     * turn is ~100 ms of search: never in one frame of a live replay).
     */
    async drivePlan(role, x, z, { run = false } = {}) {
      const v = D.c(role)?.vehicle;
      if (!v?.planDriveGen || !v.arcDrive || v.driver !== D.c(role)) return;
      const fast = !!run || !!v.def.fastOnly;
      let n = 0;
      const it = v.planDriveGen(x, z, { pause: () => (++n & 31) === 0 });
      // (the order plans at the speed it is given: the memo is keyed by it)
      await runGenAsync({ next() { const f = v.fast; v.fast = fast; try { return it.next(); } finally { v.fast = f; } } });
    },
    /** planSneak's search as a generator (it yields every few hundred states). */
    * planSneakGen(tx, tz, o = {}) {
      const mode = o.mode || 'raft', raft = D.raft() ?? (o.from ? lastRaft : null), u = mode === 'raft' ? raft : D.c(o.role);
      if (!u) throw new Error(`planSneak: no ${mode === 'raft' ? 'raft' : o.role}`);
      const DT = o.dt ?? 0.2, [ma, mb] = o.margin ?? [2, 3], HS = Math.round((o.horizon ?? 180) / DT);
      const speed = o.speed ?? (mode === 'raft' ? (raft.def?.slow || 2.5) * 0.7 : mode === 'crawl' ? 0.9 * 0.85 : 2.25 * 0.85);
      const box = o.box ?? 18, keep = o.keep ?? 3, keepWalker = o.keepWalker ?? 7, walkerPad = o.walkerPad ?? (mode === 'raft' ? 2.5 : 0);
      const walkerSlack = o.walkerSlack ?? [0, -5, 5]; // steps (DT): ±1 s
      // margins at a band's edge: a posted man's (`edgePad` m) and a walker's for a crawler (`crawlPad` m)
      const edgePad = o.edgePad ?? 2, crawlPad = o.crawlPad ?? 3.5;
      const [ux, uz] = o.from ?? [u.x, u.z]; // (`from`: plan a later leg from where an earlier one ends)
      const x0 = Math.floor(Math.min(ux, tx) - box), z0 = Math.floor(Math.min(uz, tz) - box);
      const W = Math.ceil(Math.max(ux, tx) + box) - x0 + 1, H = Math.ceil(Math.max(uz, tz) + box) - z0 + 1;
      const cx = (c) => x0 + (c % W) + 0.5, cz = (c) => z0 + Math.floor(c / W) + 0.5;
      const cellOf = (x, z) => { const i = Math.floor(x) - x0, j = Math.floor(z) - z0; return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i; };
      const g = w.grid, now = w.time;
      const views = viewers().filter((e) => !o.ignore?.includes(e.tag)); // (`ignore`: tags left out, for debugging)
      const statics = [], walkers = [];
      // walkers: on the move, or on a route he walks (a man staring at a lure or talking to the Spy stands still)
      const ROUTE = new Set(['IDLE', 'REINFORCE', 'RETURN']);
      for (const e of views) ((e.kind !== 'vehicle-eye' && (e.isMoving || e.path || (e.route?.length > 1 && ROUTE.has(e.brain?.state) && !e.brain?.distractedBy))) ? walkers : statics).push(e);
      const boat = { isOpenBoat: true, def: { seated: true, occludes: false } };
      // a crawler also passes the holes cut low in a fence (grid crawlway: on the belly only)
      const walkOpt = { crawl: mode === 'crawl' };
      const passMemo = new Int8Array(W * H);
      const pass = (c) => {
        if (passMemo[c]) return passMemo[c] > 0;
        const x = cx(c), z = cz(c);
        let ok;
        if (mode === 'raft') ok = [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]].every(([a, b]) => raft.passableAt(x + a, z + b));
        else { const t = g.terrainAt(x, z); ok = g.walkableAt(x, z, walkOpt) && (o.wade || (t !== T.WATER && t !== T.SHALLOW)); }
        if (ok) ok = !statics.some((e) => Math.hypot(e.x - x, e.z - z) < keep) && !(o.avoid || []).some(([ax, az, r]) => Math.hypot(ax - x, az - z) < r)
          && !(o.forbid || []).some((poly) => inPoly(poly, x, z))
          && (mode === 'raft' || !w.commandos.some((m) => m !== u && m.alive && !m.vehicle && Math.hypot(m.x - x, m.z - z) < 1.2)); // his mates lie there
        passMemo[c] = ok ? 1 : -1;
        return ok;
      };
      // land: every 0.25 m along the step on a walkable cell, each within a step's height of the last (stairs, ledges)
      const edgeMemo = new Map();
      const edge = (a, b) => {
        const key = a < b ? a * W * H + b : b * W * H + a;
        let ok = edgeMemo.get(key);
        if (ok !== undefined) return ok;
        const ax = cx(a), az = cz(a), bx = cx(b), bz = cz(b), n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25);
        if (mode === 'raft') { ok = raft.straightReach(bx, bz, ax, az) >= Math.hypot(bx - ax, bz - az) - 0.05; edgeMemo.set(key, ok); return ok; }
        let pk = -1;
        ok = true;
        for (let s = 0; s <= n && ok; s++) {
          const x = ax + ((bx - ax) * s) / n, z = az + ((bz - az) * s) / n, i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
          if (!g.isWalkable(i, j, walkOpt)) { ok = o.wade ? g.walkableAt(x, z, { swim: false, crawl: walkOpt.crawl }) : false; if (!ok) break; }
          const k = g.idx(i, j);
          if (pk >= 0 && k !== pk && !g.canStep(pk, k)) ok = false;
          pk = k;
        }
        edgeMemo.set(key, ok);
        return ok;
      };
      const dummyAt = (x, z) => mode === 'raft' ? { x, z, y: 0, state: 'inVehicle', vehicle: boat, isVisibleToEnemies: true, alive: true }
        : { x, z, y: g.elevAt?.(x, z) ?? 0, isLow: mode === 'crawl', isVisibleToEnemies: true, alive: true, kind: 'commando' };
      // (memos: the planner reads a world that stands still while it plans — the tick waits for it — so every look-ahead
      // below is a pure function of its arguments and is worked out once: a walker's predicted place per step, a post's
      // cone per step, a walker's head positions and cones per step; a cell outside a cone's geometry is not seen by it,
      // so perception.canSee is asked only inside one. The same answers as asking afresh each time, a fraction the cost.)
      const qMemo = walkers.map(() => []), wheelMemo = walkers.map(() => []), viewMemo = walkers.map(() => new Map());
      // (each walker's ghosts read his fields through his mirror — ghost.mjs: never through him — refreshed once a plan)
      const mirrors = walkers.map(mirrorOf);
      const predAt = (wi, k) => { const a = qMemo[wi]; let q = a[k]; if (q === undefined) q = a[k] = predictEnemy(walkers[wi], k * DT); return q; };
      const wheels = (wi, k) => {
        // (a squad's man where the file turns a corner or about wheels round to his new place)
        const m = wheelMemo[wi]; let r = m[k];
        if (r === undefined) {
          const e = walkers[wi], a = predAt(wi, Math.max(0, k - 15)).heading, b = predAt(wi, k + 15).heading;
          let dh = Math.abs(a - b) % (2 * Math.PI); if (dh > Math.PI) dh = 2 * Math.PI - dh;
          r = m[k] = e.squad?.id != null && e.brain?._leader?.() !== e && dh > 1;
        }
        return r;
      };
      /** walkerSees' viewers at step kk: [g, cone, …] for each head it tries (heading `r`·45° when r ≥ 0), in its order */
      const headViews = (wi, kk, r) => {
        const m = viewMemo[wi], key = kk * 9 + r + 1;
        let L = m.get(key);
        if (!L) {
          const e = walkers[wi], q0 = predAt(wi, kk), q = r < 0 ? q0 : { ...q0, heading: (r * Math.PI) / 4 }, tAbs = now + kk * DT;
          const amp = e.sweepAmp ?? e.vision?.sweep ?? 0;
          L = [];
          for (const hd of q.alt != null ? [q.heading, q.alt] : [q.heading]) for (const off of amp ? [0, amp / 2, -amp / 2, amp, -amp] : [0]) {
            const v = ghostOn(mirrors[wi]);
            v.x = q.x; v.z = q.z; v.heading = hd; v.sweepActive = false; v.headOffset = off; // (as walkerSees)
            L.push(v, coneAt(v, tAbs));
          }
          m.set(key, L);
        }
        return L;
      };
      const seesAny = (L, d) => seesAnyHeads(L, d, w, canSee); // (one guard at one eye: walkerSees' heads, asked once)
      const sCones = statics.map(() => []);
      const sCone = (i, k) => { const a = sCones[i]; let c = a[k]; if (c === undefined) c = a[k] = coneAt(statics[i], now + k * DT); return c; };
      // (seen per (cell, step): 0 unknown, 1 unseen, 2 seen — a flat byte per state instead of a Map)
      const KS = HS + 256, seenMemo = new Uint8Array(W * H * KS);
      // (each viewer's reach, and a squared-distance pre-filter: only a point surely beyond it skips the exact hypot test)
      const sFar = statics.map((e) => e.vision?.far ?? 36), sReach2 = sFar.map((f) => (f + 1) * (f + 1) * (1 + 1e-9) + 1e-9);
      const wFar = walkers.map((e) => e.vision?.far ?? 36), wReach2 = wFar.map((f) => (f + walkerPad + 3) * (f + walkerPad + 3) * (1 + 1e-9) + 1e-9);
      // (the dummies and canSee's options refilled per question, not made: seen() is asked for every (cell, step) a
      // search touches — the same fields and values as dummyAt's, read only while canSee / seesAny run)
      const dS = dummyAt(0.5, 0.5), dS2 = dummyAt(0.5, 0.5), seeO = { cone: null };
      const dummyInto = (o, x, z) => { o.x = x; o.z = z; if (mode !== 'raft') o.y = g.elevAt?.(x, z) ?? 0; return o; };
      const seen = (c, k) => {
        const key = c * KS + k;
        const m = seenMemo[key]; if (m) return m === 2;
        const x = cx(c), z = cz(c), d = dummyInto(dS, x, z);
        let s = false;
        for (let i = 0; i < statics.length; i++) {
          const e = statics[i], ex = e.x - x, ez = e.z - z;
          if (ex * ex + ez * ez > sReach2[i]) continue; // (beyond far + 1)
          const dd = Math.hypot(ex, ez), far = sFar[i], near = e.vision?.near ?? far / 2;
          if (dd > far + 1) continue;
          const cone = sCone(i, k);
          seeO.cone = cone;
          if (pointInCone(cone, x, z) && canSee(e, d, w, seeO) !== 'none') { s = true; break; }
          // at the edge of the band that matters (a crawler: the near band; a raft or a standing man: the far one) the
          // unit's own path may wander a little: the cell 1 m nearer the guard must be clear too
          const edge = mode === 'crawl' ? near : far;
          if (dd > edge - edgePad && dd < edge + edgePad) {
            const f = edgePad / dd, d2 = dummyInto(dS2, x + (e.x - x) * f, z + (e.z - z) * f);
            if (pointInCone(cone, d2.x, d2.z) && canSee(e, d2, w, seeO) !== 'none') { s = true; break; }
          }
        }
        seeO.cone = null;
        if (!s) walk: for (let wi = 0; wi < walkers.length; wi++) {
          const e = walkers[wi];
          for (const dk of walkerSlack) {
            // a walker's pace and halts drift from the prediction: he is tried `walkerSlack` steps early and late too
            const kk = Math.max(0, k + dk), q = predAt(wi, kk), qx = q.x - x, qz = q.z - z;
            if (qx * qx + qz * qz > wReach2[wi]) continue; // (beyond far + walkerPad + 3)
            const dd = Math.hypot(qx, qz), far = wFar[wi];
            if (dd > far + walkerPad + 3) continue;
            if (dd < keepWalker || seesAny(headViews(wi, kk, -1), d)) { s = true; break walk; }
            // a man where his beat turns about (a halt, a corner) — a squad's man wheeling to his new place: any heading
            if (wheels(wi, kk)) { let any = false; for (let r = 0; r < 8 && !any; r++) any = seesAny(headViews(wi, kk, r), d); if (any) { s = true; break walk; } }
            // a walker's predicted place and pace are approximate: try the cell `walkerPad` m nearer to him as well (a
            // crawler: 1.5 m nearer when he is at the edge of the near band, the only one that sees a man lying down)
            // (a squad's man keeps only roughly to his leader's prediction plus his present offset: 2 m more for him)
            const near = e.vision?.near ?? far / 2, sq = e.squad?.id != null && mode === 'raft' ? 2 : 0;
            const pad = (walkerPad ? walkerPad + sq : 0) || (mode === 'crawl' && dd > near - 3 && dd < near + crawlPad + 0.5 ? crawlPad : 0);
            if (pad > 0 && dd > pad) {
              const f = pad / dd, d2 = dummyInto(dS2, x + (q.x - x) * f, z + (q.z - z) * f);
              if (seesAny(headViews(wi, kk, -1), d2)) { s = true; break walk; }
            }
          }
        }
        seenMemo[key] = s ? 2 : 1;
        return s;
      };
      const clear = o.blind ? () => true : (c, k0, k1) => { for (let k = Math.max(0, k0); k <= k1; k++) if (seen(c, k)) return false; return true; };
      const s0 = cellOf(ux, uz);
      let s1 = cellOf(tx, tz);
      if (s0 < 0 || s1 < 0) throw new Error(`planSneak: (${tx},${tz}) outside the box`);
      if (!pass(s1)) { // (a raft's landing click on the bank: the nearest cell it can lie in)
        let best = -1, bd = 2.6;
        for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
          const c = s1 + dj * W + di, d = Math.hypot(di, dj);
          if (c >= 0 && c < W * H && d < bd && pass(c)) { bd = d; best = c; }
        }
        if (best >= 0) { s1 = best; tx = cx(best); tz = cz(best); }
      }
      passMemo[s0] = 1; passMemo[s1] = 1;
      const hfun = o.shelter ? () => 0 : (c) => Math.hypot(cx(c) - tx, cz(c) - tz) / speed / DT;
      // A* on (cell, step): binary heap on f = step + h
      // (the open list and the reached states in typed arrays, reused plan after plan — state-heap.mjs: no [f, c, k]
      // array per push, no Map and Set of tens of thousands of entries to outlive the young generation; given back at
      // every return below)
      const heap = takeHeap(), prev = takeSet();
      const give = () => { giveHeap(heap); giveSet(prev); };
      const push = (f, c, k, from) => {
        const key = c * (HS + 256) + k;
        if (prev.has(key)) return; prev.set(key, from);
        heap.push(f, c, k);
      };
      const k0 = o.startDelay ? Math.round(o.startDelay / DT) : 0, holdK = Math.round((o.hold ?? 3) / DT);
      // (no goal state can ever be accepted: the search would only grind to its cap and fail — the same null, now)
      if (!o.shelter && !o.blind && !(yield* goalReachableGen({ s1, tx, tz, W, H, x0, z0, cx, cz, k0, holdK, seen, raft: mode === 'raft', kMax: Math.max(k0, HS - 1 + Math.max(1, Math.ceil(Math.SQRT2 / speed / DT))) }))) {
        if (o.why) o.why.push(`goal (${tx},${tz}) never unseen for ${(holdK * DT).toFixed(1)} s within the horizon`);
        if (o.stats) Object.assign(o.stats, { expanded: 0, found: false, pre: true, cells: W * H, HS });
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
        if ((n & 15) === 0) yield; // (each state asks seen() of its neighbours: often, so a slice stays within PLAN_SLICE_MS)
        // he may stay a while where he stops (`shelter`: any cell he can lie in unseen for `hold` s will do)
        // (a click on a cell edge: either cell touching it will do)
        const atGoal = o.shelter || c === s1 || (mode !== 'raft' && Math.hypot(cx(c) - tx, cz(c) - tz) <= 0.55);
        if (atGoal && (o.blind || clear(c, k, k + holdK))) { found = [c, k]; break; }
        if (k >= HS) continue;
        if (clear(c, k + 1 - ma, k + 1 + mb)) push(k + 1 + hfun(c), c, k + 1, key);
        const i = c % W, j = Math.floor(c / W);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const nc = nj * W + ni;
          if (!pass(nc)) continue;
          if (di && dj && (!pass(j * W + ni) || !pass(nj * W + i))) continue; // no corner cutting
          if (!edge(c, nc)) continue; // a step he can take (no drop off a stair's side) / a stretch the raft drives straight
          const steps = Math.max(1, Math.ceil((di && dj ? Math.SQRT2 : 1) / speed / DT));
          // (where he lies now he is already: a look coming his way soon must not pin him there, he crawls off at once)
          if ((!(c === s0 && k === k0) && !clear(c, k - ma, k + steps)) || !clear(nc, k - ma, k + steps + mb)) continue;
          push(k + steps + hfun(nc), nc, k + steps, key);
        }
      }
      if (o.stats) { // (debugging / tools/perf: how big the search was)
        let goalClear = 0;
        for (let k = k0; k <= HS + 2; k++) if (clear(s1, k, k + holdK)) goalClear++;
        Object.assign(o.stats, { expanded: n, maxN, found: !!found, heapLeft: heap.length, seen: seenMemo.reduce((a, v) => a + (v ? 1 : 0), 0), cells: W * H, HS, statics: statics.length, walkers: walkers.length, goalClear });
      }
      if (!found) {
        if (o.why) { let bc = s0, bd = Infinity; for (const key of prev.doneKeys()) { const c = Math.floor(key / (HS + 256)), d = Math.hypot(cx(c) - tx, cz(c) - tz); if (d < bd) { bd = d; bc = c; } } o.why.push(`closest (${cx(bc)},${cz(bc)}) ${bd.toFixed(1)} m, ${n} expanded`); }
        give();
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
      Object.defineProperty(out, 'ctx', { value: { seen: o.blind ? () => false : seen, pass, cellOf, DT, now, ma, mb, holdK, KS: HS + 256, mode }, enumerable: false });
      return out;
    },
    /**
     * Walk compiled legs (dash.mjs compileDash): each move clicked the moment the one before is all but done — he never
     * halts between two legs of a dash — and a halt only where a leg says wait. 'done' when he got to the last leg's end;
     * 'late' when he fell behind (a mate in the way, a refused click): the caller plans again from where he is.
     */
    async _walkLegs(legs, { role, u, tol = 0.4, slack = 0.5, label = '' }) {
      const stoppedU = () => !u.path && !u.isMoving;
      for (let li = 0; li < legs.length; li++) {
        const s = legs[li];
        if (s.wait) {
          if (D.t < s.until - 1e-6) { onWait?.(`${label || 'a man'}: a gap in the cones`); while (D.t < s.until - 1e-6) await tick(); onWait?.(null); }
          continue;
        }
        // (walking on from the leg before he may be a stride early: within the plan's margin before; a leg clicked as
        // planned, `strict`, at its planned moment)
        while (D.t < s.start - (li > 0 && !legs[li - 1].wait && !s.strict ? 0.15 : 1e-6)) await tick();
        try { D.order(role, { type: 'move', x: s.x, z: s.z }); } catch (e) {
          if (globalThis.process?.env?.SNEAKDBG) log(`    [${D.t.toFixed(2)}] legs: ${e.message}`);
          return 'late';
        }
        // (the next leg a move too: clicked when he is a couple of strides from this one's end, so he walks on into it)
        const next = legs[li + 1], chain = next && !next.wait && !next.strict && !s.strict;
        const near = chain ? Math.max(0.12, u.speed * dt * 3) : tol;
        const ts = D.t;
        while (Math.hypot(u.x - s.x, u.z - s.z) > near && D.t < s.end + slack + 1) {
          await tick();
          if (D.t > ts + 0.5 && stoppedU()) break;
        }
        const f = D.failed(); if (f) throw new Error(`FAILED sneaking ${label}: ${f}`);
        const d = Math.hypot(u.x - s.x, u.z - s.z);
        if (D.t > s.end + slack || d > Math.max(near, tol)) {
          if (globalThis.process?.env?.SNEAKDBG) log(`    [${D.t.toFixed(2)}] legs late: → (${s.x},${s.z}) end ${s.end.toFixed(2)}, at (${u.x.toFixed(2)},${u.z.toFixed(2)})`);
          return 'late';
        }
      }
      // (the last click's own arrival: he stops on it)
      const last = legs[legs.length - 1];
      for (let n = 0; n < 120 && !stoppedU(); n++) await tick();
      return Math.hypot(u.x - (last.x ?? u.x), u.z - (last.z ?? u.z)) <= tol + 0.1 ? 'done' : 'late';
    },
    /**
     * Go to (tx, tz) on a planSneak plan, like a player timing each dash: wait where the plan waits (somewhere no cone
     * reaches), click each straight run of cells at its planned moment, and plan again from where he is whenever he
     * falls behind the plan (a raft pivoting, a man rounding a stone). mode as planSneak ('raft' rows the raft).
     */
    async sneak(tx, tz, o = {}) {
      const mode = o.mode || 'raft', raft = D.raft(), u = mode === 'raft' ? raft : D.c(o.role);
      const tol = mode === 'raft' ? 0.9 : 0.4, slack = o.slack ?? (mode === 'raft' ? 0.8 : 0.5), t0 = D.t, maxWait = o.maxWait ?? 400;
      if (mode === 'crawl') await D.stance(o.role, 'crawl');
      if (mode === 'walk') await D.stance(o.role, 'stand');
      const go = (x, z) => mode === 'raft' ? D.order('diver', { type: 'move', x, z }) : D.order(o.role, { type: 'move', x, z });
      const stopped = () => mode === 'raft' ? (raft.speed || 0) < 0.1 && !raft.goal : !u.path && !u.isMoving;
      let plans = 0, fails = 0, gx = tx, gz = tz;
      while (Math.hypot(u.x - gx, u.z - gz) > tol) {
        if (D.t - t0 > maxWait) throw new Error(`sneak ${o.label || ''} → (${tx},${tz}): no way after ${maxWait}s, at (${u.x.toFixed(1)},${u.z.toFixed(1)})`);
        // (a raft still gliding: let it settle first, the plan starts from where it lies)
        if (!stopped()) { await D.wait(dt); continue; }
        const dbgWhy = globalThis.__M3DBG ? [] : undefined;
        let plan = await D.planSneakAsync(tx, tz, dbgWhy ? { ...o, why: dbgWhy } : o);
        plans++;
        if (dbgWhy && (plan || plans % 20 === 1)) log(`DBG ${D.t.toFixed(1)} sneak ${o.label || ''} → (${tx},${tz}) at (${u.x.toFixed(1)},${u.z.toFixed(1)}): ${plan ? `${plan.length} pts, there at ${plan[plan.length - 1][2].toFixed(1)}` : `none [${dbgWhy.join(' ')}]`}`);
        if (dbgWhy && !plan && plans % 20 === 1) { // who keeps the cells just past the closest one covered (each viewer alone)
          const m = /closest \(([-\d.]+),([-\d.]+)\)/.exec(dbgWhy.join(' '));
          if (m) {
            const cx0 = +m[1], cz0 = +m[2], L = Math.hypot(tx - cx0, tz - cz0) || 1, nx = cx0 + (tx - cx0) / L, nz = cz0 + (tz - cz0) / L;
            const tags = viewers().filter((e) => Math.hypot(e.x - nx, e.z - nz) < 45).map((e) => e.tag);
            const blk = tags.filter((t) => !D.planSneak(nx, nz, { ...o, from: [nx, nz], box: 2, hold: 20, horizon: 25, maxExpand: 50, ignore: tags.filter((q) => q !== t) }));
            const dm = { x: nx, z: nz, y: w.grid.elevAt?.(nx, nz) ?? 0, isLow: mode === 'crawl', isVisibleToEnemies: true, alive: true, kind: 'commando' };
            const now = viewers().filter((e) => canSee(e, dm, w) !== 'none').map((e) => `${e.tag}@${e.x.toFixed(0)},${e.z.toFixed(0)}h${Math.round(((e.heading * 180) / Math.PI + 360) % 360)}`);
            log(`DBG   next cell (${nx.toFixed(1)},${nz.toFixed(1)}) covered within 20 s by: ${blk.join(' ') || '(nobody alone)'}; seen now by: ${now.join(' ') || 'nobody'}; tags ${tags.join(' ')}`);
          }
        }
        if (!plan) {
          if (o.noWait) return false;
          // no way on yet: if where he lies will be looked at soon, he first crawls off to a spot nobody will look at
          // for a while (shelter), and waits there
          const sb = o.shelterBox ?? 6, sh = o.shelterHorizon ?? 30;
          const here = await D.planSneakAsync(u.x, u.z, { ...o, shelter: true, hold: o.shelterHold ?? 8, box: sb, horizon: sh, maxExpand: 60000 });
          if (here && here.length > 1) { await D.sneak(here[here.length - 1][0], here[here.length - 1][1], { ...o, hold: o.shelterHold ?? 8, label: `${o.label || ''} (shelter)`, noWait: true, box: sb, horizon: sh }); fails = 0; }
          // (where he lies stays unseen for the shelter hold: the longer no way opens, the less often he looks again)
          else await D.wait(o.retry ?? (here ? Math.min(0.5 + 0.25 * fails++, 2.5) : 0.5));
          continue;
        }
        fails = 0;
        [gx, gz] = plan[plan.length - 1]; // (snapped to a cell he can stop in)
        // on foot: the plan as the fewest straight legs he walks one after the other at his own pace, halting only where
        // he must wait for a gap in the cones (dash.mjs; user 2026-10-15: "making it more straight and decisive").
        // Opt-in per solution (D.straightDashes, or o.straight): the solutions not re-tuned for it click as before
        const dashWhy = globalThis.process?.env?.SNEAKDBG || globalThis.__SNEAKDBG ? [] : null;
        const legs = mode !== 'raft' && (o.straight ?? D.straightDashes) ? await runGenAsync(compileDashGen(plan, { speed: u.speed, route: routeFor(u), why: dashWhy, pad: (o.straight ?? D.straightDashes)?.pad })) : null;
        if (dashWhy?.length) log(`    [${D.t.toFixed(2)}] sneak ${o.label || ''}: plan clicked as planned (${dashWhy.join('; ')})`);
        if (legs) {
          const r = await D._walkLegs(legs, { role: o.role, u, tol, slack, label: o.label });
          if (r === 'done' && !legs.partial) break;
          if (r === 'done') continue; // (the legs end short of the goal: plan again from there)
          if (Math.hypot(u.x - gx, u.z - gz) < 0.9 && stopped() && plans > 3) break;
          try { D.order(o.role, { type: 'stop' }); } catch { /* already still */ }
          continue;
        }
        // runs: consecutive cells in one direction (at most `run` cells), waits between them
        const segs = [];
        let a = 0;
        while (a < plan.length - 1) {
          const [ax, az, at] = plan[a];
          if (Math.hypot(plan[a + 1][0] - ax, plan[a + 1][1] - az) < 1e-6) { // a wait
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
          if (s.wait) {
            if (D.t < s.until - 1e-6) { onWait?.(`${o.label || 'a man'}: a gap in the cones`); while (D.t < s.until - 1e-6) await tick(); onWait?.(null); }
            continue;
          }
          while (D.t < s.start - 1e-6) await tick();
          // (a leg end the raft has already reached — it glided onto or just past it — is not clicked: a player clicks
          // the next one, as for a click the raft cannot take; the M3 film flashed "can't get there in a straight line"
          // for that click, refused by the game then — it takes it now, as done, and stops there)
          try { if (mode === 'raft' && Math.hypot(raft.x - s.x, raft.z - s.z) < 0.5) throw new Error('there already'); go(s.x, s.z); } catch (e) {
            // (a raft against the bank cannot pivot that way: the next click further on, else back off the bank)
            if (globalThis.process?.env?.SNEAKDBG) log(`    [${D.t.toFixed(2)}] sneak: ${e.message}`);
            let ok = false;
            for (const q of segs.slice(segs.indexOf(s) + 1)) { if (q.wait || ok) continue; try { go(q.x, q.z); ok = true; } catch { /* next */ } }
            if (!ok && mode === 'raft') {
              const h = raft.heading;
              for (const dd of [-1.6, 1.6]) { if (ok) break; try { go(raft.x + Math.cos(h) * dd, raft.z + Math.sin(h) * dd); ok = true; } catch { /* other way */ } }
            }
            await tick();
            if (ok) { for (let n = 0; n < 90 && !stopped(); n++) await tick(); }
            late = true; break;
          }
          const ts = D.t;
          while (Math.hypot(u.x - s.x, u.z - s.z) > tol && D.t < s.end + slack + 1) {
            await tick();
            if (D.t > ts + 0.5 && stopped() && Math.hypot(u.x - s.x, u.z - s.z) > tol) break;
          }
          const f = D.failed(); if (f) throw new Error(`FAILED sneaking ${o.label || ''}: ${f}`);
          if (D.t > s.end + slack || Math.hypot(u.x - s.x, u.z - s.z) > tol) {
            if (globalThis.process?.env?.SNEAKDBG) log(`    [${D.t.toFixed(2)}] sneak late: seg → (${s.x},${s.z}) start ${s.start.toFixed(2)} end ${s.end.toFixed(2)}, at (${u.x.toFixed(2)},${u.z.toFixed(2)}) moving=${!stopped()}`);
            late = true; break;
          }
        }
        if (!late) break;
        // (he stopped a hand's breadth short of the goal — a wall, a mate — and the plan is done: close enough)
        if (Math.hypot(u.x - gx, u.z - gz) < 0.9 && stopped() && plans > 3) break;
        // hold here while we look again
        try { D.order(mode === 'raft' ? 'diver' : o.role, { type: 'stop' }); } catch { /* already still */ }
      }
      if (!quiet && globalThis.process?.env?.ROWDBG) log(`    sneak ${o.label || ''} → (${tx},${tz}) ${plans} plan(s) ${(D.t - t0).toFixed(1)} s`);
      return true;
    },
    /** wait until no cone covers a standing man at (x, z) — just after a sweep went past, or after `quiet` s unseen */
    async afterSweep(x, z, maxSec = 30, quiet = 3.0) {
      let seenT = -1; const t0 = D.t;
      await D.until(() => {
        if (D.seers(x, z, false).length) { seenT = D.t; return false; }
        return seenT > 0 ? D.t - seenT >= 0.05 : D.t - t0 >= quiet;
      }, maxSec, `sweep past (${x},${z})`);
    },
    checkpoint(name) {
      const o = Object.fromEntries(w.objectives.map((x) => [x.id, x.done]));
      const units = w.commandos.map((c) => `${c.role}(${c.x.toFixed(1)},${c.z.toFixed(1)}${c.vehicle ? ' in ' + tagOf(c.vehicle) : ''}${c.buried ? ' buried' : ''}${c.disguised ? ' D' : ''})`).join(' ');
      const cp = { name, t: +w.time.toFixed(2), objectives: o, alarm: !!w.alarm?.active, detections: D.detections(),
        units: Object.fromEntries(w.commandos.map((c) => [c.role, { x: +c.x.toFixed(2), z: +c.z.toFixed(2), vehicle: c.vehicle ? tagOf(c.vehicle) : null }])) };
      checkpoints.push(cp);
      onCheckpoint?.(cp);
      log(`CHECKPOINT ${name} t=${w.time.toFixed(1)} obj=${JSON.stringify(o)} alarm=${cp.alarm} detections=${cp.detections} ${units}`);
      return cp;
    },
    dispose() { for (const off of offs) off?.(); },
  };
  return D;
}

/** Thrown by every tick / order of a driver whose `aborted()` turned true (a stopped replay). */
export class SolutionAborted extends Error {
  constructor() { super('solution replay stopped'); this.name = 'SolutionAborted'; }
}
