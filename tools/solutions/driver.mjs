/**
 * Solution driver: a scripted "player" for a mission. A solution is an async function of a driver D that only gives
 * player orders (move / run / stance / ability: knife, decoy, harpoon, use, enter/leave a vehicle…) and waits on things
 * a player can see on screen (unit positions, cones, objectives). The driver itself is engine-agnostic: give it a
 * World and a `step` that advances the game by one fixed tick —
 *   - headless (node):  headlessDriver('m03')                      (tools/solutions/headless.mjs)
 *   - in the browser:   makeDriver(game.world, { step: () => { g.step(); G.render(1 / 60, 1); } })
 * `step` may return a promise (e.g. to hand a frame to a capture loop); the driver awaits it.
 *
 * Helpers that look ahead (seers, clearAhead, whoSees) read the same §4.2 cone rules the AI uses
 * (src/ai/perception.js): the script watches the cones like a player does before moving a man.
 */
import { canSee, coneAt } from '../../src/ai/perception.js';

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
    const q = predictEnemy(lead, t, 1);
    return { x: q.x + (e.x - lead.x), z: q.z + (e.z - lead.z), heading: q.heading };
  }
  const sp = e.speed ?? 1.0;
  const onRoute = r && r.length > 1 && b && (b.state === 'IDLE' || b.state === 'REINFORCE' || b.state === 'RETURN') && !b.distractedBy;
  if (!onRoute) {
    if (e.isMoving || e.path) return alongPath(e, sp * t);
    return { x: e.x, z: e.z, heading: e.heading };
  }
  let x = e.x, z = e.z, h = e.heading, left = t;
  let i = b.routeIndex ?? 0, dir = b.routeDir ?? 1;
  const loop = (b._routeType || e.spawn?.route?.type || e.routeMode || 'PINGPONG').toUpperCase() === 'LOOP' || e.routeMode === 'loop';
  const loopStart = b._loopStart ?? 0;
  let waitLeft = b.atWait ? Math.max(0, b.waitT ?? 0) : 0;
  if (waitLeft > 0) { const wp = r[i]; if (wp?.look != null) h = (wp.look * Math.PI) / 180; if (left <= waitLeft) return { x, z, heading: h }; left -= waitLeft; i = nextIdx(i); }
  for (let guard = 0; guard < 64; guard++) {
    const wp = r[i];
    const dx = wp.x - x, dz = wp.z - z, L = Math.hypot(dx, dz);
    if (L > 1e-6) {
      h = Math.atan2(dz, dx);
      if (left * sp <= L) return { x: x + (dx / L) * left * sp, z: z + (dz / L) * left * sp, heading: h };
      left -= L / sp; x = wp.x; z = wp.z;
    }
    if (wp.wait > 0) { if (wp.look != null) h = (wp.look * Math.PI) / 180; if (left <= wp.wait) return { x, z, heading: h }; left -= wp.wait; }
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
  for (const off of amp ? [0, amp / 2, -amp / 2, amp, -amp] : [0]) {
    const g = Object.create(e);
    g.x = q.x; g.z = q.z; g.heading = q.heading; g.sweepActive = false; g.headOffset = off; // head turned `off` (elliptical far)
    if (canSee(g, dummy, w, { cone: coneAt(g, tAbs) }) !== 'none') return true;
  }
  return false;
}

/** Where a walking unit will be after `dist` m along its current path (then straight on), and his heading there. */
function alongPath(u, dist) {
  let x = u.x, z = u.z, h = u.heading;
  const pts = u.path ? u.path.slice(u.pathIndex ?? 0) : [];
  for (const p of pts) {
    const dx = p.x - x, dz = p.z - z, L = Math.hypot(dx, dz);
    if (L < 1e-6) continue;
    h = Math.atan2(dz, dx);
    if (dist <= L) return { x: x + (dx / L) * dist, z: z + (dz / L) * dist, heading: h };
    dist -= L; x = p.x; z = p.z;
  }
  return { x: x + Math.cos(h) * dist, z: z + Math.sin(h) * dist, heading: h };
}

/**
 * @param {import('../../src/world/world.js').World} world
 * @param {{step: () => (void|Promise<void>), dt?: number, log?: (s: string) => void, quiet?: boolean}} o
 */
export function makeDriver(world, { step, dt = 1 / 60, log = console.log, quiet = false } = {}) {
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
  rec('enemy:spotted', (p) => `${tagOf(p.enemy)} -> ${tagOf(p.target ?? p.unit)}`);
  rec('enemy:unmasked-spy', (p) => `${tagOf(p.enemy)} -> ${tagOf(p.spy)}`);
  rec('alarm:zone', (p) => `${p.zone?.id ?? p.zone} ${p.event}`);
  rec('unit:killed', (p) => `${tagOf(p.unit)} by ${tagOf(p.by ?? p.killer ?? p.source)}`);
  rec('structure:destroyed', (p) => `${p.structure?.id ?? p.id ?? tagOf(p)}`);
  const who = (e) => e ? `${tagOf(e)}[${e.brain?.state}@${e.x?.toFixed(1)},${e.z?.toFixed(1)} h${((e.heading * 180 / Math.PI + 360) % 360).toFixed(0)} sw${e.sweepActive ? 1 : 0}]` : '?';
  rec('vehicle:tainted', (p) => `${tagOf(p.vehicle)} by ${who(p.by)}`);
  rec('enemy:state', (p) => (p.to === 'COMBAT' || p.to === 'HOLD') ? `${tagOf(p.enemy)} ${p.from}->${p.to}` : null);
  rec('ability:refused', (p) => `${tagOf(p.unit)} ${p.id ?? p.ability ?? ''} ${p.reason ?? p.text ?? ''}`);

  const tick = async () => { const r = step(); if (r && typeof r.then === 'function') await r; };
  const checkpoints = [];

  const D = {
    world: w, events, checkpoints, dt, log,
    get t() { return w.time; },
    /** an enemy by tag (e1…e34, st_barr1#0.0.0…) */
    get: (t) => w.enemies.find((e) => e.tag === t || e.id === t) || w.byId?.(t),
    /** a commando by role (greenberet, diver, sapper, spy) */
    c: (r) => w.commandos.find((c) => c.role === r || c.tag === r),
    raft: () => w.vehicles.find((v) => v.vehicleType === 'raft' && !v.removed),
    item: (id) => w.interactables.find((i) => i.tag === id || i.spawn?.id === id || i.switchId === id || i.def?.id === id),
    /** detections of a commando so far (the solution must keep this at 0) */
    detections: () => events.filter((e) => e.name === 'enemy:spotted' || e.name === 'enemy:challenge' || e.name === 'enemy:unmasked-spy' || e.name === 'vehicle:tainted').length,
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
      const u = D.c(role) || D.get(role);
      if (!u.issue(o)) {
        const tgt = o.target?.tag ?? o.target?.id ?? o.target;
        throw new Error(`order refused ${role} ${JSON.stringify({ ...o, target: tgt })}: ${JSON.stringify(u.lastRefusal?.text ?? null)}`);
      }
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
        if (u.issue({ type: 'stance', stance: st })) {
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
    clearAhead(x, z, dur = 2, low = false, why = null) {
      const dummy = { x, z, y: w.grid.elevAt?.(x, z) ?? 0, isLow: low, isVisibleToEnemies: true };
      for (const e of w.enemies) {
        if (!e.alive || e.removed || !e.vision) continue;
        const d = Math.hypot(e.x - x, e.z - z), far = (e.vision.far ?? 36) + 1;
        if (e.isMoving || e.path || (e.route && e.route.length > 1 && !e.brain?.distractedBy)) {
          if (d > far + 3 * dur) continue;
          // walking: predicted along his current path (straight on past its end), at his speed
          for (let t = 0; t <= dur + 1e-6; t += 0.1) {
            if (walkerSees(e, predictEnemy(e, t), dummy, w, w.time + t)) { if (why) why.push(`${e.tag}~@+${t.toFixed(1)}`); return false; }
          }
          continue;
        }
        if (d > far) continue;
        for (let t = 0; t <= dur + 1e-6; t += 0.1) {
          if (canSee(e, dummy, w, { cone: coneAt(e, w.time + t) }) !== 'none') { if (why) why.push(`${e.tag}@+${t.toFixed(1)}`); return false; }
        }
      }
      return true;
    },
    /**
     * Would a man moving along `pts` (from his position, at `speed` m/s, starting in `delay` s, pausing `pause` s at
     * each listed point) stay unseen? Cones are predicted as in clearAhead, at each sample's arrival time.
     */
    routeClear(role, pts, { speed = 0.9, low = true, delay = 0, pause = 0, step = 0.5, minDist = 6, why = null } = {}) {
      const u = D.c(role);
      const samples = [];
      let x = u.x, z = u.z, t = delay;
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
      log(`CHECKPOINT ${name} t=${w.time.toFixed(1)} obj=${JSON.stringify(o)} alarm=${cp.alarm} detections=${cp.detections} ${units}`);
      return cp;
    },
    dispose() { for (const off of offs) off?.(); },
  };
  return D;
}

/** Driver over a headless copy of mission `id` (node only). */
export async function headlessDriver(id, o = {}) {
  const { headlessMission } = await import('./headless.mjs');
  const s = headlessMission(id);
  const D = makeDriver(s.world, { step: s.step, dt: s.dt, ...o });
  D.sim = s;
  return D;
}
