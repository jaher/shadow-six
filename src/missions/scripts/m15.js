/**
 * BEL Mission 15 "The End of the Butcher": mission-local glue (docs/missions/m15.md §8.6, §10, §11, §14).
 * Owned by MISSIONS. Everything here is per-mission; the engine is not touched.
 *
 *  - The general's flight (dossier §8.6, §14 E1/E2). The stock `general` script runs to the NEAREST staff car at
 *    ANY heard noise. M15 needs: (a) only a real alarm (RINT), a shot or an explosion (noise level >= 2, never an
 *    "accident") starts him running; (b) `cars` is a PRIORITY list: the yard car first, reached THROUGH the house
 *    (garden door -> 5 s inside -> main door -> the yard), which needs the HQ standing and the yard car intact;
 *    otherwise the curb car through the garden gate; (c) GENERAL_ESCAPED fires only when he actually reaches the
 *    car (the stock run fires wherever a stopped runner stands after 0.5 s, see scripts/m16.js). The brain is
 *    parked in ALARM_RUN with `goal.fired` set (its own run is then inert) and m15Tick steers him.
 *  - The HQ demolition point (dossier §5.1, §14 E3/E6): `hq` is bomb-only for the engine; a `barrel`/`bomb` class
 *    blast within 6.75 m of its NE corner destroys it here. An accident blast (the tram hitting the tanker)
 *    destroys it SILENTLY: an `accident` explosion event (FX only), no noise, so no alarm (the stock destroy() is always noisy).
 *  - The drive-off: the van, once everyone is aboard after o1 + o2, path-finds to the NW road instead of the
 *    engine's straight [exit, leave] run (it starts in the cemetery, behind a fence).
 * @module missions/scripts/m15
 */

import { CONFIG } from '../../config.js';

/** The HQ's demolition point (the N block's NE corner by the rear door) and its reach (the barrel damage ring). */
export const HQ_POINT = { x: 72.4, z: 49.2 };
export const HQ_REACH = 6.75;
/** The general's doors: the garden door (W face) and the main door (E face, onto the car yard). */
export const GARDEN_DOOR = { x: 54.3, z: 59.8 };
export const MAIN_DOOR = { x: 71.7, z: 58.5 };
/** Seconds he takes to cross the house (about 17 m at a run, stairs and corridors). */
export const HOUSE_TIME = 5;
/** Car priority (dossier §8.6, §13 #12). */
export const CAR_PRIORITY = ['car_yard', 'car_curb'];
/** He has "reached his car" within this distance of its hull. */
export const ARRIVE = 1.5;
/** The garden (inside its wall) for the "which side of the house is he on" test. */
export const GARDEN = [[45, 39], [58, 42.5], [59.1, 45.6], [53.4, 66.8], [48.7, 66.7], [47.3, 72], [36, 69.5]];
export const GENERAL = 'schleper';
/** The cemetery (inside its railing): the van's berth. */
export const CEMETERY = [[46, 0], [81, 0], [81, 31], [51, 23.7], [47.3, 22.8], [41.2, 21]];
const DT = 0.05;

// ---------------------------------------------------------------- geometry

export function inPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from (x, z) to a vehicle's hull rectangle (0 inside). */
export function hullDistance(v, x, z) {
  const dx = x - v.x, dz = z - v.z, c = Math.cos(v.heading || 0), s = Math.sin(v.heading || 0);
  const sz = v.def?.size || [4.5, 1.8];
  const ax = Math.max(0, Math.abs(dx * c + dz * s) - sz[0] / 2), sx = Math.max(0, Math.abs(-dx * s + dz * c) - sz[1] / 2);
  return Math.hypot(ax, sx);
}

const hqStanding = (w) => { const h = w.byId?.('hq'); return !!h && !h.destroyed; };
const usableCar = (w, id) => { const v = w.byId?.(id); return v && !v.destroyed && !v.removed ? v : null; };

/**
 * The car he runs for from (x, z) (dossier §8.6): the first of CAR_PRIORITY that is intact and reachable.
 * From the garden the yard car is reached only through the house (HQ standing); the curb car by the gate.
 * @returns {{car: any, viaHouse: boolean}|null}
 */
export function chooseCar(w, x, z) {
  const fromGarden = inPoly(GARDEN, x, z);
  for (const id of CAR_PRIORITY) {
    const v = usableCar(w, id);
    if (!v) continue;
    if (id === 'car_yard' && fromGarden) {
      if (hqStanding(w)) return { car: v, viaHouse: true };
      continue; // the house is burning: the yard route is cut
    }
    return { car: v, viaHouse: false };
  }
  return null;
}

// ---------------------------------------------------------------- the flight

function setVisible(e, on) { if (e.object3d) e.object3d.visible = on; e.m15Inside = !on; }

function park(b, e) {
  // the stock ALARM_RUN with an already-fired goal does nothing: m15Tick steers him
  if (b.state !== 'ALARM_RUN') b._set?.('ALARM_RUN', 'run');
  b.goal = { x: e.x, z: e.z, fired: true, speed: CONFIG.ai.chaseSpeed, event: 'GENERAL_ESCAPED', route: null };
}

function plan(w, e, st) {
  const pick = chooseCar(w, e.x, e.z);
  st.car = pick?.car?.tag ?? pick?.car?.id ?? null;
  st.phase = !pick ? 'stranded' : pick.viaHouse ? 'toDoor' : 'toCar';
  st.repath = 0;
}

/** Start his run (patched in for the brain's `_scriptAlarm`: RINT via onAlarm, or a real noise via hear). */
export function startFlight(w, e) {
  const b = e?.brain;
  if (!b || !e.alive || b._m15?.active) return;
  b._m15 = { active: true, phase: 'stranded', car: null, t: 0, repath: 0 };
  e.stop?.(); // drop the garden walk at once
  park(b, e);
  b._look?.(0);
  plan(w, e, b._m15);
  w.events?.emit('message', { text: 'Schleper is running for his car!', kind: 'warn' });
}

/** Patch the general's brain once (again after a quick load: brains are rebuilt). */
function patch(w, e) {
  const b = e.brain;
  if (!b || b._m15Patched) return;
  b._m15Patched = true;
  const hear = b.hear.bind(b);
  // §14 E2: footsteps, engines and the tram do not frighten him; a shot, a blast or the alarm do
  b.hear = (n) => { if ((n?.level ?? 1) < 2 || (n?.kind === 'explosion' && n.accident)) return; hear(n); };
  b._scriptAlarm = () => startFlight(w, e);
  if (b.state === 'ALARM_RUN' && !b._m15) startFlight(w, e); // restored mid-run
}

function steer(b, e, x, z, st) {
  st.repath -= DT;
  if (e.isMoving || st.repath > 0) return;
  st.repath = 1;
  b._go?.(x, z, CONFIG.ai.chaseSpeed);
}

function escape(w, e, car, st) {
  st.phase = 'gone';
  e.stop?.();
  w.alarm?.fireEvent?.('GENERAL_ESCAPED', { zoneId: 'z_town', cause: 'general', x: e.x, z: e.z });
  if (car.canEnter?.(e) === true) car.enter(e);
}

function tickGeneral(w) {
  const e = w.byId?.(GENERAL);
  if (!e || e.removed) return;
  if (!e.alive) { if (e.m15Inside) setVisible(e, true); return; }
  patch(w, e);
  const b = e.brain, st = b?._m15;
  if (!st?.active || st.phase === 'gone') return;
  park(b, e);
  b.pt = 0;
  if (st.phase === 'inside') {
    if (!hqStanding(w)) { setVisible(e, true); e.takeDamage?.(1e5, null, 'explosion'); return; } // caught in the house
    st.t -= DT;
    if (st.t > 0) return;
    const out = usableCar(w, 'car_yard') ? MAIN_DOOR : GARDEN_DOOR;
    e.setPosition?.(out.x, out.z); e.x = out.x; e.z = out.z;
    setVisible(e, true);
    if (out === MAIN_DOOR) { st.phase = 'toCar'; st.car = 'car_yard'; st.repath = 0; } else plan(w, e, st);
    return;
  }
  if (st.phase === 'toDoor') {
    if (!hqStanding(w) || !usableCar(w, 'car_yard')) return plan(w, e, st);
    if (Math.hypot(e.x - GARDEN_DOOR.x, e.z - GARDEN_DOOR.z) <= ARRIVE) {
      e.stop?.(); st.phase = 'inside'; st.t = HOUSE_TIME; setVisible(e, false);
      return;
    }
    return steer(b, e, GARDEN_DOOR.x, GARDEN_DOOR.z, st);
  }
  if (st.phase === 'toCar') {
    const car = usableCar(w, st.car);
    if (!car) return plan(w, e, st);
    if (hullDistance(car, e.x, e.z) <= ARRIVE) return escape(w, e, car, st);
    return steer(b, e, car.x, car.z, st);
  }
  // stranded: both cars gone; he stays put and re-checks now and then
  st.t -= DT;
  if (st.t <= 0) { st.t = 2; plan(w, e, st); if (st.phase === 'stranded') e.stop?.(); }
}

// ---------------------------------------------------------------- the HQ

/** A blast of class `kind` at (x, z) that reaches the demolition point (dossier §5.1). */
export const reachesHQ = (p) => (p?.kind === 'barrel' || p?.kind === 'bomb') && Math.hypot(p.x - HQ_POINT.x, p.z - HQ_POINT.z) <= HQ_REACH;

/** Destroy the HQ: silently after an accident (no noise: no alarm), the stock noisy way otherwise. */
export function destroyHQ(w, p = {}) {
  const hq = w.byId?.('hq');
  if (!hq || hq.destroyed) return false;
  if (p.accident) {
    hq._applyDestroyedState?.();
    if (!hq.destroyed) { hq.destroyed = true; hq.alive = false; }
    // the blast and the fire on the building (render/fx.js, audio) with `accident` set: the alarm ignores it
    // (alarm.js §4.9 exception) and no noise is emitted, so nobody hears it
    w.events?.emit('explosion', { x: hq.x, z: hq.z, radius: Math.max(4, (hq.radius || 0) * 2), kind: 'structure', source: hq, accident: true });
    w.events?.emit('structure:destroyed', { id: 'hq', type: hq.interactKind, owner: hq.owner, accident: true });
    // one message only: the mission trigger on structure:destroyed announces it
  } else hq.destroy?.(p.source ?? null, p.kind || 'explosion');
  ruinWing(w);
  return true;
}

/**
 * The S wing goes with the N block (look only: its footprint stays). Derived from the serialized `hq.destroyed`,
 * so m15Tick re-applies it after a quick load (idempotent).
 */
export function ruinWing(w) {
  const wing = w.structures?.get?.('hq_wing')?.object3d;
  if (!wing || wing.userData.m15Ruined) return false;
  wing.userData.m15Ruined = true;
  wing.scale.y = 0.35;
  // the same burnt material the N block got from _applyDestroyedState
  let burnt = null;
  w.byId?.('hq')?.object3d?.traverse?.((o) => { if (!burnt && o.isMesh) burnt = o.material; });
  if (burnt) wing.traverse?.((o) => { if (o.isMesh) o.material = burnt; });
  return true;
}

// ---------------------------------------------------------------- the drive-off

/** Replace the engine's straight drive-off by a path-found one to the NW road (once per drive). */
function tickDriveOff(w) {
  const ex = w.mission?.extraction, v = ex && w.byId?.(ex.vehicleId);
  if (!v || v.destroyed || !v.path?.length || !ex.leave) return;
  const last = v.path[v.path.length - 1];
  if (v._m15Routed || Math.hypot(last.x - ex.leave.x, last.z - ex.leave.z) > 0.5) return;
  v._m15Routed = true;
  // from its cemetery berth it takes the street waypoints (a grid path hugs the walls: a 2 m-wide van snags on
  // lamp posts and corners); from anywhere else it path-finds to the exit
  const pts = ex.route && inPoly(CEMETERY, v.x, v.z)
    ? [...ex.route.map(([x, z]) => ({ x, z })), { x: ex.exit.x, z: ex.exit.z }]
    : (w.findPath?.(v.x, v.z, ex.exit.x, ex.exit.z, { swim: false }) || [{ x: ex.exit.x, z: ex.exit.z }]).map((q) => ({ x: q.x, z: q.z }));
  v.followPath([...pts, { x: ex.leave.x, z: ex.leave.z }], { speed: ex.leave.speed });
}

/**
 * The ruin keeps smouldering (render only, via world.fx): a smoke plume and the odd tongue of fire over the
 * N block and the wing every ~1.2 s, so the wrecked HQ reads as a ruin in the overview. Not saved: driven
 * by world.time, so it resumes after a quick load. @returns {number} effects spawned this call
 */
export function smoulderHQ(w) {
  const fx = w.fx;
  if (!fx?.spawn) return 0;
  const t = w.time || 0;
  if (t < (w._m15SmokeT ?? -1)) return 0;
  w._m15SmokeT = t + 1.2;
  const k = (w._m15SmokeN = (w._m15SmokeN || 0) + 1);
  const hq = w.byId?.('hq'), wing = w.structures?.get?.('hq_wing');
  const pts = [hq, wing?.def].filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.z));
  let n = 0;
  for (const [i, p] of pts.entries()) {
    const jx = Math.sin(k * 2.3 + i) * 3, jz = Math.cos(k * 1.7 + i) * 2;
    fx.spawn('smoke', p.x + jx, p.z + jz, { life: 7 }); n++;
    if ((k + i) % 3 === 0) { fx.spawn('fire', p.x - jz, p.z + jx, { life: 4 }); n++; }
  }
  return n;
}

/** Per-tick mission glue (trigger `tick`, once: false). Idempotent, safe after a quick load. */
export function m15Tick(world) {
  if (world.byId?.('hq')?.destroyed) { ruinWing(world); smoulderHQ(world); } // after a quick load too
  tickGeneral(world);
  tickDriveOff(world);
}
