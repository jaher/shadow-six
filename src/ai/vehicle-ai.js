/**
 * Enemy vehicle behaviour — owned by VEHICLES (design-spec §3.7, §4.1 `crew`/`truckDriver`, §4.2 tank /
 * sdkfz / mg profiles, §4.3 tainted vehicles and unattended rafts, §7.5 M2 patrol boat, §7.1 M6/M9/M11).
 *
 * Per-vehicle brain (`createVehicleBrain(vehicle, spawn)`), chosen by `spawn.behavior` or inferred:
 *  - 'route'   : scripted straight-segment route `spawn.route` {type:'PINGPONG'|'LOOP'|'EXIT'|'STOPPED',
 *                speed? (m/s) | vel? (VEL units), fast?, points:[{x,z,wait}]} — patrol boat, SdKfz road
 *                patrol, tanker shuttle, courier cars. No A*: each leg is a straight drive.
 *  - 'standby' : parked armour (M9 Panzer IVs) that fires when a commando is seen (§7.1).
 *  - 'parked'  : nothing (empty / player vehicles; default without crew).
 * Emplacements manned by a linked mission Enemy (gunner) have no cone of their own: the gunner's drawn
 * cone is the only detection geometry and his brain fires (§4.2 'logic = display', §10.2).
 * Other crewed armed vehicles with a vision profile look with their own cone through the AI perception API
 * (`perception.canSee`, viewer = a proxy at the gun mount whose LOS ignores the own hull stamp) and
 * `PARAYDISPARA`: stop, turn the turret and fire (cannon ≥ 13.5 m, MG closer), resume the route
 * CONFIG.vehicles.loseTarget s after losing sight. They also attack tainted vehicles.
 *
 * World-level (installed lazily once per world, 20 Hz BEL tick): enemies on foot with a gun attack any
 * tainted vehicle they see until it is destroyed (§3.7), and fire at deployed rafts seen unattended (nobody of ours in sight beside them)
 * (no commando within 3 m) until they deflate (§4.3).
 * @module ai/vehicle-ai
 */

import { CONFIG, velToSpeed } from '../config.js';
import { canSee, coneAt, pointInCone } from './perception.js';
import { angleTo, angleDiff } from '../core/math.js';

const ROUTE_TYPES = ['PINGPONG', 'LOOP', 'EXIT', 'STOPPED'];

/** Normalise a vehicle route (array or {type, points}) → {type, speed, fast, points}. */
export function normalizeVehicleRoute(route, vehicle) {
  if (!route) return null;
  const pts = (Array.isArray(route) ? route : route.points || []).map((p) => ({ x: p.x, z: p.z, wait: p.wait || 0 }));
  if (!pts.length) return null;
  const type = Array.isArray(route) ? 'PINGPONG' : String(route.type || 'PINGPONG').toUpperCase();
  const fast = !!route.fast;
  const speed = route.speed ?? (route.vel != null ? velToSpeed(route.vel) : null) ?? (fast ? vehicle.def.fast : vehicle.def.slow);
  return { type: ROUTE_TYPES.includes(type) ? type : 'PINGPONG', speed, fast, points: pts };
}

/**
 * The mission Enemy who mans emplacement `vehicle` (linked gunner / crew), or null. Such a gun has no
 * cone of its own: it sees and fires only through that soldier's drawn cone (§4.2 'logic = display',
 * §10.2 'the drawn cone is the detection geometry').
 */
export function emplacementGunner(vehicle) {
  return vehicle?.vehicleKind === 'emplacement' ? vehicle.gunnerEnemy || null : null;
}

/**
 * Viewer for a vehicle's cone: the manning Enemy of an emplacement (his cone is the drawn one), else a
 * proxy at the gun mount — the hull centre, or `def.mount` m ahead of it along the look direction —
 * carrying `ownHull` so the vehicle's own OCLU stamp doesn't blind it (grid.lineOfSight ownHull). The
 * old hull-tip apex stretched every vehicle cone by half a hull length (M2 pboat: 28.8 → ~33 m and
 * the near band 14.4 → ~18.7 m, so no bank cover was usable; §7.5 "hide when the patrol boat passes").
 */
export function viewerFor(vehicle) {
  const g = emplacementGunner(vehicle);
  if (g) return g;
  const h = vehicle.def.turret ? vehicle.turretHeading : vehicle.heading;
  const r = vehicle.vehicleKind === 'emplacement' ? 0 : (vehicle.def.mount || 0);
  const p = vehicle.proxy || (vehicle.proxy = { kind: 'vehicle-eye', alive: true, ownHull: {} });
  p.x = vehicle.x + Math.cos(h) * r;
  p.z = vehicle.z + Math.sin(h) * r;
  p.y = vehicle.y || 0;
  p.heading = h;
  p.vision = vehicle.vision;
  p.sweepActive = vehicle.sweepActive;
  p.headOffset = vehicle.headOffset || 0;
  p.world = vehicle.world;
  p.alive = !vehicle.destroyed;
  p.vehicle = vehicle;
  const o = p.ownHull;
  o.x = vehicle.x; o.z = vehicle.z; o.w = vehicle.def.size[0]; o.d = vehicle.def.size[1]; o.heading = vehicle.heading;
  return p;
}

/** Can `viewer` (enemy or proxy) see vehicle `v`? Cone on the nearest hull point + LOS to its edge. */
export function canSeeVehicle(viewer, v, world) {
  if (!viewer.vision || v.destroyed || v.hiddenRail || v.removed) return false;
  const edge = v.muzzleToward(viewer.x, viewer.z);
  const cone = coneAt(viewer, world.time);
  if (!cone || !pointInCone(cone, edge.x, edge.z)) return false;
  return world.grid.lineOfSight(viewer.x, viewer.z, edge.x, edge.z, { viewerElevated: !!viewer.vision.elevated, ownHull: viewer.ownHull });
}

/** Nearest commando `vehicle` can see right now (through its proxy cone), or null. */
function spotCommando(vehicle, world) {
  const eye = viewerFor(vehicle);
  let best = null, bd = Infinity;
  for (const c of world.commandos) {
    if (!c.alive || (c.vehicle && !c.vehicle.isOpenBoat)) continue; // men in an open boat are in plain view (§4.2)
    if (canSee(eye, c, world) === 'none') continue;
    const d = Math.hypot(c.x - vehicle.x, c.z - vehicle.z);
    if (d < bd) { bd = d; best = c; }
  }
  if (best) return best;
  for (const v of world.vehicles) {
    if (v === vehicle || !v.tainted || v.destroyed) continue;
    if (canSeeVehicle(eye, v, world)) return v;
  }
  return null;
}

/**
 * Per-vehicle brain. States: 'parked' | 'route' | 'standby' | 'attack' | 'done'.
 * @param {import('../entities/vehicle.js').Vehicle} vehicle @param {object} spawn
 */
export function createVehicleBrain(vehicle, spawn = {}) {
  const route = normalizeVehicleRoute(spawn.route, vehicle);
  const behavior = spawn.behavior || (route && route.type !== 'STOPPED' ? 'route' : vehicle.crew.length && vehicle.def.weapons?.length ? 'standby' : 'parked');
  const b = {
    behavior,
    state: behavior,
    route,
    dir: 1,
    target: null,
    lostT: 0,
    started: false,

    update(dt) {
      const w = vehicle.world;
      if (!w || vehicle.destroyed) return;
      installVehicleAI(w);
      if (vehicle.driver) { if (b.state !== 'parked') b.state = 'parked'; return; } // a commando took it
      if (!vehicle.crewed) return;
      // a manned emplacement: the gunner's own brain sees (his drawn cone) and fires — no hidden second cone
      if (emplacementGunner(vehicle)) {
        if (vehicle.vision) { vehicle.vision = null; vehicle.sweepActive = false; }
        if (b.state === 'attack') { b.state = b.resume || behavior; b.target = null; }
        return;
      }
      // `spawn.dormantUntilAlarm` (dossier D1 'dormant'): the crew sleep — no perception, no fire — until any
      // alarm zone has fired (world.alarm.zonesFired is saved, so this holds from the first step after a load)
      if (spawn.dormantUntilAlarm && !w.alarm?.zonesFired?.length) { vehicle.sweepActive = false; return; }
      // eyes: sweep phase is seeded like enemies (§4.2)
      if (vehicle.vision && !b.seeded) { b.seeded = true; vehicle.vision.phase = w.rng?.next ? w.rng.next() * (vehicle.vision.period || 1) : 0; }
      const armed = !!vehicle.def.weapons?.length && !!vehicle.vision;
      if (b._targetId != null) { b.target = b.target || w.byId?.(b._targetId) || null; b._targetId = null; }
      const seen = armed ? spotCommando(vehicle, w) : null;
      if (seen) {
        if (seen !== b.target || b.state !== 'attack') b.spot(seen);
        b.target = seen;
        b.lostT = 0;
        if (b.state !== 'attack') { b.resume = b.state; b.state = 'attack'; vehicle.speed = 0; vehicle.goal = null; }
      }
      if (b.state === 'attack') {
        if (b.aimT > 0) b.aimT -= dt; // §4.6 COMBAT aim time, as a foot MG
        if (b.target) b.eyesOn(b.target);
        if (!seen) {
          b.lostT += dt;
          if (b.lostT >= CONFIG.vehicles.loseTarget || !b.target || b.target.alive === false || b.target.destroyed) {
            b.state = b.resume || behavior;
            b.target = null;
            b.eyesFree();
            if (b.state === 'route') b.resumeLeg();
          }
          return;
        }
        if (b.aimT > 0) return;
        vehicle.fireAt(seen);
        return;
      }
      if (b.state === 'route' && !b.started) b.startLeg(false);
    },

    /**
     * §4.5 fire-on-sight units (mg, armoured vehicle, patrol boat) never challenge, but a new target is
     * flagged like any sighting: enemy:spotted (enemy = the vehicle) + the portrait flash (ui:warning), the crew's zone onSeen,
     * and the 0.5 s COMBAT aim before the first burst (replay round 2, M2 pboat).
     */
    spot(t) {
      const w = vehicle.world;
      b.aimT = CONFIG.ai.aim;
      const gunner = vehicle.crew?.find?.((c) => c.alive !== false) ?? null;
      const commando = t.kind === 'commando' ? t : null;
      if (commando) {
        // The vehicle is the sighting unit (its cone saw him; the crew ride parked off the map), so `enemy` carries
        // the same shape as an infantry sighting: x/z/tag (+ vehicleType) — replay round 3, M2 pboat '?(-1,-1)'.
        w.events.emit('enemy:spotted', { enemy: vehicle, target: commando, vehicle, gunner, vehicleType: vehicle.vehicleType ?? null });
        w.events.emit('ui:warning', { unit: commando, kind: 'seen' });
      }
      const br = gunner?.brain;
      if (br?._raiseZone) br._raiseZone('seen', t.x, t.z);
      else if (w.alarm) {
        const zn = w.alarm.zoneAt(vehicle.x, vehicle.z);
        if (zn) w.alarm.raise(zn.id, 'seen', t.x, t.z, { sensor: 'seen' });
      }
    },

    /** COMBAT look (§4.6 `_look(0)`): no sweep, the gun and the cone stay on the target (within traverse). */
    eyesOn(t) {
      const h = angleTo(vehicle.x, vehicle.z, t.x, t.z);
      if (vehicle.canTraverse && !vehicle.canTraverse(h)) return;
      vehicle.sweepActive = false;
      if (vehicle.def.turret) { vehicle.turretHeading = h; vehicle.headOffset = 0; } else vehicle.headOffset = angleDiff(vehicle.heading, h);
    },
    /** Back on patrol / standby: the cone sweeps about the hull (turret) heading again. */
    eyesFree() {
      vehicle.sweepActive = !!vehicle.vision;
      vehicle.headOffset = 0;
    },

    /** (Re)start the current leg of the route from the nearest point in the current direction. */
    startLeg(resume) {
      const R = b.route;
      if (!R) return;
      b.started = true;
      let pts = b.dir > 0 ? R.points : [...R.points].reverse();
      if (resume) {
        let k = 0, bd = Infinity;
        pts.forEach((p, i) => { const d = Math.hypot(p.x - vehicle.x, p.z - vehicle.z); if (d < bd) { bd = d; k = i; } });
        pts = pts.slice(k);
      }
      vehicle.followPath(pts, { fast: R.fast, speed: R.speed });
    },

    /**
     * Resume the route after an attack: the leg the vehicle was on, toward the waypoint it was heading
     * for (its remaining wait, if it was waiting there, still runs) — not back to the nearest point.
     */
    resumeLeg() {
      const R = b.route;
      if (!R) return;
      const p = vehicle.path?.[vehicle.pathIndex];
      if (!p) { b.startLeg(true); return; }
      b.started = true;
      vehicle.fast = !!R.fast;
      vehicle.maxSpeed = R.speed ?? vehicle.maxSpeed;
      vehicle.goal = { x: p.x, z: p.z, strict: false };
    },

    /** Vehicle reached the end of its path (entities/vehicle.js). */
    onRouteEnd() {
      const R = b.route;
      if (!R || b.state !== 'route') return;
      if (R.type === 'PINGPONG') { b.dir = -b.dir; const pts = b.dir > 0 ? R.points : [...R.points].reverse(); vehicle.followPath(pts.slice(1), { fast: R.fast, speed: R.speed }); }
      else if (R.type === 'LOOP') vehicle.followPath(R.points, { fast: R.fast, speed: R.speed });
      else if (R.type === 'EXIT') { b.state = 'done'; vehicle.world?.events.emit('vehicle:stop', { vehicle }); vehicle.exited = true; vehicle.world?.removeLater(vehicle); }
    },

    serialize() {
      return {
        state: b.state, dir: b.dir, started: b.started, pathIndex: vehicle.pathIndex, resume: b.resume ?? null,
        lostT: b.lostT, target: b.target?.id ?? null, seeded: !!b.seeded, phase: vehicle.vision?.phase ?? null, aimT: b.aimT ?? 0,
      };
    },
    /** @param {object} d @param {boolean} [exact] the vehicle restored its exact drive state (path/waypoint/wait) */
    deserialize(d, exact = false) {
      if (!d) return;
      b.state = d.state ?? b.state;
      b.dir = d.dir ?? 1;
      b.resume = d.resume ?? undefined;
      b.lostT = d.lostT ?? 0;
      b.aimT = d.aimT ?? 0;
      b.target = null;
      b._targetId = d.target ?? null; // re-linked on the next update (units may load after the vehicle)
      if (d.seeded != null) {
        b.seeded = !!d.seeded;
        if (vehicle.vision && d.phase != null) vehicle.vision.phase = d.phase;
      }
      if (exact) { b.started = !!d.started; return; }
      // legacy save without drive state: re-plan from the nearest route point
      b.started = false;
      if (b.state === 'route') b.startLeg(true);
    },
  };
  return b;
}

// ---------------------------------------------------------------- world-level: infantry vs vehicles

/** Weapons that can shoot at a vehicle (the dog can't). */
const GUNS = new Set(['rifle', 'luger', 'pistol', 'mp40', 'mg', 'smg']);

/**
 * Install (once per world) the 20 Hz rule "every enemy who sees a tainted vehicle attacks it until it is
 * destroyed" (§3.7) and "a deployed raft seen unattended is shot until it deflates" (§4.3).
 * Enemies already fighting a commando (their `target` is a living commando) keep to it.
 */
export function installVehicleAI(world) {
  if (!world || world._vehicleAI || typeof world.onBelTick !== 'function') return;
  const cd = new Map();
  world._vehicleAI = { off: world.onBelTick((dt20) => tick(world, dt20, cd)), cd };
}

/** A deployed (used) raft with nobody aboard: suspicious unless `viewer` sees a man of ours beside it (§4.3). */
function emptyUsedRaft(v) {
  return !!v.def.raft && !!v.used && !v.destroyed && !v.occupants.length;
}
/**
 * Is the empty raft `v` unattended for `viewer`? Attended = a commando within 3 m whom this viewer can see. A man he
 * cannot see (under water beside it, buried, crawling unseen in the light band, behind a rock) attends nothing: to
 * him the raft lies there alone ("even the raft in the light shaded field of view makes the soldier see it").
 */
function unattendedFor(viewer, v, world) {
  const R = CONFIG.ai.raftUnattended ?? 3;
  return !world.commandos.some((c) => c.alive && Math.hypot(c.x - v.x, c.z - v.z) <= R && canSee(viewer, c, world, { ignoreDisguise: true }) !== 'none');
}

function tick(world, dt, cd) {
  const targets = world.vehicles.filter((v) => !v.removed && !v.destroyed && (v.tainted || emptyUsedRaft(v)));
  if (!targets.length) return;
  for (const e of world.enemies) {
    if (!e.alive || !e.vision || !GUNS.has(e.weapon) || e.held || ['stunned', 'bound', 'dead', 'captured'].includes(e.state)) continue;
    // an artillery gunner at his emplacement fires its gun through his own brain (_gunnerLook → _combat, §4.1),
    // never a hand weapon, and only inside his gun's traverse (replay m07: g22 plinked the rowboat with a rifle)
    if (e.brain?.arch?.script === 'gunner' && e.brain._emplacement?.()) continue;
    const t0 = e.target;
    if (t0 && t0.kind === 'commando' && t0.alive) continue;
    // one path owns each attack: a brain already in COMBAT against a vehicle (boarding seen, gunner) fires
    // through its own _fire at the weapon cadence; keep our cooldown in step so a hand-off doesn't double up
    const br = e.brain;
    if (br?.state === 'COMBAT' && br.target?.kind === 'vehicle' && !br.target.destroyed) { cd.set(e, Math.max(0, br.fireT || 0)); continue; }
    let left = (cd.get(e) || 0) - dt;
    cd.set(e, left);
    const wd = CONFIG.weapons[e.weapon];
    const shootable = (x) => canSeeVehicle(e, x, world) && (x.tainted || unattendedFor(e, x, world));
    const v = (t0 && targets.includes(t0) && shootable(t0)) ? t0 : targets.find(shootable);
    if (!v) { if (t0 && t0.kind === 'vehicle' && t0.destroyed) e.target = null; continue; }
    const d = Math.hypot(v.x - e.x, v.z - e.z) - Math.min(...v.def.size) / 2;
    e.target = v;
    e.heading = angleTo(e.x, e.z, v.x, v.z);
    if (d > (wd.range || 18) || left > 0) continue;
    cd.set(e, wd.cadence ?? wd.reload ?? 1);
    const edge = v.muzzleToward(e.x, e.z);
    const rounds = wd.rounds || 1;
    for (let k = 0; k < rounds && !v.destroyed; k++) v.bulletHit(e, e.weapon);
    world.events.emit('shot', { from: { x: e.x, z: e.z }, to: edge, shooter: e, target: v, hit: true, weapon: e.weapon });
    world.emitNoise(e.x, e.z, wd.noise || 18, wd.noiseKind || 'rifle', e);
    if (v.destroyed && e.target === v) e.target = null;
  }
}

export default createVehicleBrain;
