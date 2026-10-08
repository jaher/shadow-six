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
import { canSee, coneAt } from '../../src/ai/perception.js';
import { viewerFor, canSeeVehicle } from '../../src/ai/vehicle-ai.js';
import { T } from '../../src/world/grid.js';

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
  // (at a halt he turns to its look over a couple of seconds: until then he still faces the way he came)
  const TURN = 3;
  // (a halt's look: he faces it — and in its first seconds may still face the way he came: `alt`)
  const halt = (wp, into) => (wp?.look != null ? { x, z, heading: (wp.look * Math.PI) / 180, alt: into <= TURN ? h : undefined } : { x, z, heading: h });
  if (waitLeft > 0) { const wp = r[i]; if (left <= waitLeft) return halt(wp, left + Math.max(0, (wp?.wait ?? 0) - waitLeft)); if (wp?.look != null) h = (wp.look * Math.PI) / 180; left -= waitLeft; i = nextIdx(i); }
  for (let guard = 0; guard < 64; guard++) {
    const wp = r[i];
    const dx = wp.x - x, dz = wp.z - z, L = Math.hypot(dx, dz);
    if (L > 1e-6) {
      h = Math.atan2(dz, dx);
      if (left * sp <= L) return { x: x + (dx / L) * left * sp, z: z + (dz / L) * left * sp, heading: h };
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
 * Could walking enemy `e`, predicted at `q` (x, z, heading) at sim time `tAbs`, see `dummy`? Conservative: his head is
 * tried at the predicted heading and at both ends of his sweep (walking men glance about).
 */
function walkerSees(e, q, dummy, w, tAbs) {
  const amp = e.sweepAmp ?? e.vision?.sweep ?? 0; // radians (normalised vision data)
  for (const hd of q.alt != null ? [q.heading, q.alt] : [q.heading]) for (const off of amp ? [0, amp / 2, -amp / 2, amp, -amp] : [0]) {
    const g = Object.create(e);
    g.x = q.x; g.z = q.z; g.heading = hd; g.sweepActive = false; g.headOffset = off; // head turned `off` (elliptical far)
    if (canSee(g, dummy, w, { cone: coneAt(g, tAbs) }) !== 'none') return true;
  }
  return false;
}

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
 * @param {import('../../src/world/world.js').World} world
 * @param {{step: () => (void|Promise<void>), dt?: number, log?: (s: string) => void, quiet?: boolean,
 *   aborted?: () => boolean, onOrder?: (role: string, unit: object, order: object) => void,
 *   onCheckpoint?: (cp: object) => void}} o
 *   aborted: once true, every tick and every order throws SolutionAborted (the replay was stopped: no order may
 *   reach the game after that, even from a solution's own try/catch); onOrder: after each accepted player order.
 */
export function makeDriver(world, { step, dt = 1 / 60, log = console.log, quiet = false, watch = true, aborted = null, onOrder = null, onCheckpoint = null } = {}) {
  const w = world;
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
  // shots at a vehicle (a tainted one, or a used raft seen lying empty, §4.3)
  rec('shot', (p) => (p.target?.kind === 'vehicle' ? `${tagOf(p.shooter)} at ${p.target.vehicleType} ${tagOf(p.target)}` : null));
  rec('enemy:state', (p) => (p.to === 'COMBAT' || p.to === 'HOLD') ? `${tagOf(p.enemy)} ${p.from}->${p.to}` : null);
  rec('ability:refused', (p) => `${tagOf(p.unit)} ${p.id ?? p.ability ?? ''} ${p.reason ?? p.text ?? ''}`);

  // Exposure watch (user, M3 2026-10-08: "make sure no commando goes inside the field of view of a solider before being
  // spotted. Even the raft boat in the light shaded field of view of a soldier makes the soldier see it"): after every
  // tick, every live commando is tried against every live cone with the AI's own rule (perception.canSee: band, stance,
  // disguise, buried, roof, LOS). A solution that wins unspotted must also never be SEEN — not even for a tick before a
  // guard's nervousness builds up: anything but 'none' is an exposure, recorded per guard and commando. Legitimately
  // unseen = what canSee rules out (a man crawling in the light band, the Spy in uniform, a buried GB, out of LOS).
  const exposures = new Map();
  let lastRaft = null; // (the raft last seen deployed: planSneak plans a packed raft's next leg with it, from `o.from`)
  const viewers = () => {
    const out = [];
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
  const watchTick = () => {
    const cs = w.commandos.filter((c) => c.alive);
    if (!cs.length) return;
    // a used raft lying empty is evidence too (§4.3): in any live cone with a clear line of sight, any band, it is seen
    // — whoever lies hidden beside it (under water, crawling unseen) does not make it innocent
    const rafts = (w.vehicles || []).filter((v) => v.def?.raft && v.used && !v.removed && !v.destroyed && !v.occupants?.length);
    for (const e of viewers()) {
      for (const v of rafts) if (canSeeVehicle(e, v, w)) note(e, `empty ${tagOf(v)}`, 'raft', v.x, v.z);
      const cone = coneAt(e, w.time);
      for (const c of cs) {
        const band = canSee(e, c, w, { cone });
        if (band === 'none') continue;
        note(e, c.vehicle ? `${c.role} in ${tagOf(c.vehicle)}` : `${c.role} ${c.stance}`, band, c.x, c.z);
      }
    }
  };
  const halt = () => { if (aborted?.()) throw new SolutionAborted(); };
  const tick = async () => { halt(); const r = step(); if (r && typeof r.then === 'function') await r; halt(); if (watch) watchTick(); };
  const checkpoints = [];

  const D = {
    world: w, events, checkpoints, dt, log,
    get t() { return w.time; },
    /** an enemy by tag (e1…e34, st_barr1#0.0.0…) */
    get: (t) => w.enemies.find((e) => e.tag === t || e.id === t) || w.byId?.(t),
    /** a commando by role (greenberet, diver, sapper, spy) */
    c: (r) => w.commandos.find((c) => c.role === r || c.tag === r),
    raft: () => { const r = w.vehicles.find((v) => v.vehicleType === 'raft' && !v.removed); if (r) lastRaft = r; return r; },
    /** where enemy `e` will be `t` s from now (predictEnemy: his route, halts and looks) */
    predict: (e, t) => predictEnemy(e, t),
    item: (id) => w.interactables.find((i) => i.tag === id || i.spawn?.id === id || i.switchId === id || i.def?.id === id),
    /** detections of a commando so far (the solution must keep this at 0) */
    detections: () => events.filter((e) => e.name === 'enemy:spotted' || e.name === 'enemy:challenge' || e.name === 'enemy:unmasked-spy' || e.name === 'vehicle:tainted').length,
    /** every time a commando (or the raft's crew, or a used raft lying empty) was inside a live cone and SEEN (see watchTick) */
    exposures: () => [...exposures.values()],
    exposureReport: () => [...exposures.values()].map((x) => `${x.viewer} saw ${x.target} (${x.band}) ${x.ticks} ticks t=${x.from.toFixed(2)}–${x.to.toFixed(2)} first at ${x.at}`),
    failed() {
      const dead = w.commandos.find((c) => !c.alive);
      return dead ? `${dead.role} died` : null;
    },
    async wait(sec) { const n = Math.round(sec / dt); for (let i = 0; i < n; i++) await tick(); },
    async until(pred, maxSec = 120, label = '') {
      const n = Math.round(maxSec / dt);
      for (let i = 0; i < n; i++) {
        if (pred()) return true;
        await tick();
        const f = D.failed();
        if (f) throw new Error(`FAILED while waiting ${label}: ${f}`);
      }
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
      onOrder?.(role, u, o);
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
    async row(x, z, max = 90) {
      const raft = D.raft();
      D.order('diver', { type: 'move', x, z });
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
    clearAhead(x, z, dur = 2, low = false, why = null, except = null, pad = 0, from = 0) { // (`from`: the window starts that many s from now)
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
          if (canSee(e, dummy, w, { cone: coneAt(e, w.time + t) }) !== 'none') { if (why) why.push(`${e.tag}@+${t.toFixed(1)}`); return false; }
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
      for (const e of w.enemies) {
        if (!e.alive || e.removed || !e.vision) continue;
        const moving = e.isMoving || e.path || (e.route && e.route.length > 1), far = (e.vision.far ?? 36) + 1;
        for (const [sx, sz, st] of samples) {
          const q = moving ? predictEnemy(e, st) : { x: e.x, z: e.z, heading: e.heading };
          const dd = Math.hypot(q.x - sx, q.z - sz);
          if (dd > far) continue;
          if (dd < minDist && moving) { if (why) why.push(`${e.tag} close@(${sx.toFixed(1)},${sz.toFixed(1)})+${st.toFixed(1)}`); return false; } // too close to trust a cone
          const dummy = { x: sx, z: sz, y: w.grid.elevAt?.(sx, sz) ?? 0, isLow: low, isVisibleToEnemies: true };
          const sees = moving ? walkerSees(e, q, dummy, w, w.time + st) : canSee(e, dummy, w, { cone: coneAt(e, w.time + st) }) !== 'none';
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
    rowClear(pts, { delay = 0, slack = [-0.1, 0.25], step = 0.5, minDist = 6, why = null } = {}) {
      const raft = D.raft(), sp = raft.def?.slow || 2.5, rate = raft.def?.turn || Math.PI / 2;
      const samples = [];
      let x = raft.x, z = raft.z, h = raft.heading, t = delay + 2 * dt; // the order lands next tick
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
      const boat = { isOpenBoat: true, def: { seated: true, occludes: false } };
      for (const e of w.enemies) {
        if (!e.alive || e.removed || !e.vision) continue;
        const moving = e.isMoving || e.path || (e.route && e.route.length > 1), far = (e.vision.far ?? 36) + 1;
        for (const [sx, sz, st] of samples) {
          const q = moving ? predictEnemy(e, st) : { x: e.x, z: e.z, heading: e.heading };
          const dd = Math.hypot(q.x - sx, q.z - sz);
          if (dd > far) continue;
          if (dd < minDist && moving) { if (why) why.push(`${e.tag} close@(${sx.toFixed(1)},${sz.toFixed(1)})+${st.toFixed(1)}`); return false; }
          const dummy = { x: sx, z: sz, y: 0, state: 'inVehicle', vehicle: boat, isVisibleToEnemies: true, alive: true };
          // a patrol squad's man standing at a halt looks his own way (the prediction gives him his leader's heading)
          const still = moving && e.squad?.id != null && Math.hypot(q.x - e.x, q.z - e.z) < 1;
          const sees = moving ? walkerSees(e, q, dummy, w, w.time + st) || (still && walkerSees(e, { x: q.x, z: q.z, heading: e.heading }, dummy, w, w.time + st))
            : canSee(e, dummy, w, { cone: coneAt(e, w.time + st) }) !== 'none';
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
    planSneak(tx, tz, o = {}) {
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
      const qMemo = new Map();
      const wheelMemo = new Map();
      const wheels = (e, k) => {
        // (a squad's man where the file turns a corner or about wheels round to his new place)
        const key = `${e.id}|${k}`; let r = wheelMemo.get(key);
        if (r === undefined) {
          const a = predAt(e, Math.max(0, k - 15)).heading, b = predAt(e, k + 15).heading;
          let dh = Math.abs(a - b) % (2 * Math.PI); if (dh > Math.PI) dh = 2 * Math.PI - dh;
          wheelMemo.set(key, r = e.squad?.id != null && e.brain?._leader?.() !== e && dh > 1);
        }
        return r;
      };
      const predAt = (e, k) => { const key = `${e.id}|${k}`; let q = qMemo.get(key); if (!q) qMemo.set(key, q = predictEnemy(e, k * DT)); return q; };
      const seenMemo = new Map();
      const seen = (c, k) => {
        const key = c * (HS + 256) + k;
        const m = seenMemo.get(key); if (m !== undefined) return m;
        const x = cx(c), z = cz(c), d = dummyAt(x, z);
        let s = false;
        for (const e of statics) {
          const dd = Math.hypot(e.x - x, e.z - z), far = e.vision?.far ?? 36, near = e.vision?.near ?? far / 2;
          if (dd > far + 1) continue;
          const cone = coneAt(e, now + k * DT);
          if (canSee(e, d, w, { cone }) !== 'none') { s = true; break; }
          // at the edge of the band that matters (a crawler: the near band; a raft or a standing man: the far one) the
          // unit's own path may wander a little: the cell 1 m nearer the guard must be clear too
          const edge = mode === 'crawl' ? near : far;
          if (dd > edge - edgePad && dd < edge + edgePad) {
            const f = edgePad / dd, d2 = dummyAt(x + (e.x - x) * f, z + (e.z - z) * f);
            if (canSee(e, d2, w, { cone }) !== 'none') { s = true; break; }
          }
        }
        if (!s) for (const e of walkers) for (const dk of walkerSlack) {
          // a walker's pace and halts drift from the prediction: he is tried `walkerSlack` steps early and late too
          const kk = Math.max(0, k + dk), q = predAt(e, kk), dd = Math.hypot(q.x - x, q.z - z), far = e.vision?.far ?? 36;
          if (dd > far + walkerPad + 3) continue;
          if (dd < keepWalker || walkerSees(e, q, d, w, now + kk * DT)) { s = true; break; }
          // a man where his beat turns about (a halt, a corner) — a squad's man wheeling to his new place: any heading
          if (wheels(e, kk) && [0, 1, 2, 3, 4, 5, 6, 7].some((r) => walkerSees(e, { ...q, heading: (r * Math.PI) / 4 }, d, w, now + kk * DT))) { s = true; break; }
          // a walker's predicted place and pace are approximate: try the cell `walkerPad` m nearer to him as well (a
          // crawler: 1.5 m nearer when he is at the edge of the near band, the only one that sees a man lying down)
          // (a squad's man keeps only roughly to his leader's prediction plus his present offset: 2 m more for him)
          const near = e.vision?.near ?? far / 2, sq = e.squad?.id != null && mode === 'raft' ? 2 : 0;
          const pad = (walkerPad ? walkerPad + sq : 0) || (mode === 'crawl' && dd > near - 3 && dd < near + crawlPad + 0.5 ? crawlPad : 0);
          if (pad > 0 && dd > pad) {
            const f = pad / dd, d2 = dummyAt(x + (q.x - x) * f, z + (q.z - z) * f);
            if (walkerSees(e, q, d2, w, now + kk * DT)) { s = true; break; }
          }
          if (s) break;
        }
        seenMemo.set(key, s);
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
        let plan = D.planSneak(tx, tz, dbgWhy ? { ...o, why: dbgWhy } : o);
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
          const here = D.planSneak(u.x, u.z, { ...o, shelter: true, hold: o.shelterHold ?? 8, box: sb, horizon: sh, maxExpand: 60000 });
          if (here && here.length > 1) { await D.sneak(here[here.length - 1][0], here[here.length - 1][1], { ...o, hold: o.shelterHold ?? 8, label: `${o.label || ''} (shelter)`, noWait: true, box: sb, horizon: sh }); fails = 0; }
          // (where he lies stays unseen for the shelter hold: the longer no way opens, the less often he looks again)
          else await D.wait(o.retry ?? (here ? Math.min(0.5 + 0.25 * fails++, 2.5) : 0.5));
          continue;
        }
        fails = 0;
        [gx, gz] = plan[plan.length - 1]; // (snapped to a cell he can stop in)
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
          if (s.wait) { while (D.t < s.until - 1e-6) await tick(); continue; }
          while (D.t < s.start - 1e-6) await tick();
          try { go(s.x, s.z); } catch (e) {
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
