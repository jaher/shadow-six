/**
 * LIGHTS OUT e02 "Curfew": mission-local glue (docs/expansion/e02.md §9). Owned by MISSIONS. Installed once by
 * `mission.script` (after the set-pieces' lazy init; again on a quick load):
 *
 *  - the bearings log (o1): a hand-operated device on the DF van's tailboard; taking it completes o1;
 *  - the van's flight (§9): when the palazzo sounds its alarm (event RHQ) while o1 is not done and the van's driver
 *    (vdrv) is alive, awake, not cuffed and not on strings, he climbs into the cab and the van starts `vanStart` s later
 *    (Hard 8, Easy 20); it rolls through the rear carriage gate, up the ramp to Via Alta and east off the map. Crossing
 *    x = 99 with the log aboard fails the mission. A driver who is out cold, cuffed or dead by then: "The van has no
 *    driver." and nothing moves. A vehicle may not drive on a raised level (Vehicle.passableAt), so the van is moved
 *    along its path by this script, its height following the ground (the courtyard y 4, the ramp, Via Alta y 8);
 *  - the searchlight (o2): its crew c4 dead or cuffed puts the beam out (the art's beam, the light's intensity);
 *  - the generator's lever darkens the gate floodlights (cosmetic) and says so.
 * Visuals (browser only) are the art pass's: art/naples-kit.js through `e02Script.visuals`.
 * @module missions/scripts/e02
 */
import { addDevice } from '../setpiece-device.js';
import { runSliced, runSync } from '../../engine/slice.js';
import { buildE02ArtG } from '../../art/e02-art.js';

/** The van's flight path: the courtyard → the androne and the rear gate → the ramp → Via Alta east → off the map. */
export const VAN_PATH = [[24, 60], [24, 47], [24, 43], [24, 25.5], [25.5, 21.6], [30, 20.6], [99, 20.6], [108, 20.6]];
export const VAN_FAIL = 'THE DIRECTION-FINDERS HAVE MOVED ON.';
export const VAN_SPEED = 7;
/** The log on the van's tailboard; the generator's lever (== e02_curfew.js LOG_AT / GEN_LEVER). */
export const LOG_AT = { x: 24, z: 63.6 }, GEN_LEVER = { x: 18.2, z: 51.4 };

const objective = (w, id) => (w.objectives || []).find((o) => o.id === id) || null;
const done = (w, id) => !!objective(w, id)?.done;
function setDone(w, id) {
  const o = objective(w, id);
  if (!o || o.done) return false;
  o.done = true; o.hidden = false;
  w.events.emit('objective:update', { objective: o });
  return true;
}
const say = (w, text, kind = 'info') => w.events.emit('message', { text, kind });

/** Is the van's driver free to drive (alive, awake, not cuffed, not on strings, not carried)? */
export function driverFree(e) {
  return !!e && e.alive !== false && !e.removed && !e.ko && !e.puppetOf && !e.carriedBy && e.state !== 'carried';
}

/** The searchlight's crew is out of the fight: dead, or cuffed (a stunned man would wake and switch it on again). */
export function crewOut(e) {
  return !e || e.alive === false || e.removed || e.ko === 'bound' || !!e.puppetOf;
}

/** Point and heading `s` m along the polyline. */
export function alongPath(pts, s) {
  let left = Math.max(0, s);
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
    if (left <= L || i + 2 === pts.length) {
      const t = L ? Math.min(1, left / L) : 1;
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, heading: Math.atan2(bz - az, bx - ax), end: i + 2 === pts.length && left >= L };
    }
    left -= L;
  }
  const [x, z] = pts[pts.length - 1];
  return { x, z, heading: 0, end: true };
}

/** Arc length of the point of the path nearest (x, z) (a quick load resumes a flight in progress). */
function nearestS(pts, x, z) {
  let best = Infinity, bs = 0, acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az) || 1e-6;
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (L * L)));
    const d = Math.hypot(ax + (bx - ax) * t - x, az + (bz - az) * t - z);
    if (d < best) { best = d; bs = acc + t * L; }
    acc += L;
  }
  return { s: bs, d: best };
}

/** The van's state machine (per 20 Hz tick). `st` lives on the van (`_e02`). */
export function vanTick(w, dir, dt) {
  const v = w.byId?.('van_df');
  if (!v || v.destroyed || v.removed) return;
  const st = (v._e02 ||= { phase: 'parked', s: 0, speed: 0, startAt: null });
  if (st.phase === 'armed') {
    if (w.time < st.startAt) return;
    const drv = w.byId?.('vdrv');
    if (!driverFree(drv) || done(w, 'o1')) { st.phase = 'parked'; say(w, 'The van has no driver.'); return; }
    // he climbs into the cab: the log goes with the van
    st.phase = 'driving';
    w.removeLater?.(drv);
    const log = w.byId?.('df_log');
    if (log && !log.removed) { log.alive = false; w.removeLater?.(log); }
    say(w, 'The DF van is leaving with the bearings log!', 'warn');
  }
  if (st.phase !== 'driving') return;
  st.speed = Math.min(VAN_SPEED, st.speed + 2.5 * dt);
  st.s += st.speed * dt;
  const path = w.mission?.vanPath || VAN_PATH;
  const p = alongPath(path, st.s);
  v.x = p.x; v.z = p.z; v.heading = p.heading;
  v.y = Math.max(w.grid?.elevAt?.(p.x, p.z) ?? 0, v._groundAt ? v._groundAt(p.x, p.z) : 0);
  v.speed = st.speed;
  v.object3d?.position.set(v.x, v.y, v.z);
  if (v.object3d) v.object3d.rotation.y = -v.heading;
  if (p.x >= 99 && !done(w, 'o1') && !st.failed) { st.failed = true; dir?.fail?.(VAN_FAIL); }
  if (p.end) { st.phase = 'gone'; v.drivenOff = true; }
}

/** RHQ: arm the van's flight when its driver is free and the log still aboard (the trigger's `when` + `run`). */
export function vanAlarm(w) {
  const v = w.byId?.('van_df');
  if (!v || done(w, 'o1')) return false;
  const st = (v._e02 ||= { phase: 'parked', s: 0, speed: 0, startAt: null });
  if (st.phase !== 'parked') return false;
  if (!driverFree(w.byId?.('vdrv'))) { say(w, 'The van has no driver.'); return false; }
  st.phase = 'armed';
  st.startAt = w.time + (w.mission?.vanStart ?? 8);
  say(w, 'The van\'s engine coughs into life in the courtyard.', 'warn');
  return true;
}

/** The bearings log on the tailboard: take it (o1). */
function installLog(w) {
  if (done(w, 'o1') || w.byId?.('df_log')) return;
  const v = w.byId?.('van_df');
  if (v?._e02 && v._e02.phase !== 'parked' && v._e02.phase !== 'armed') return; // it left with the van
  addDevice(w, {
    id: 'df_log', tag: 'df_log', x: LOG_AT.x, z: LOG_AT.z, label: 'Bearings log', sfx: 'pickup', activation: 0.8,
    roles: ['greenberet', 'sniper', 'spy'],
    onUse: (c, d) => {
      if (!setDone(w, 'o1')) return false;
      say(w, `${c.nickname || 'Commando'}: I have the bearings log.`, 'objective');
      d.alive = false;
      w.removeLater?.(d);
      return true;
    },
  });
}

/** The generator's lever: the gate floodlights go out (cosmetic; the art keeps the lights, at 0 intensity). */
function installGenerator(w) {
  if (w.byId?.('gen_lever')) return;
  addDevice(w, {
    id: 'gen_lever', tag: 'gen_lever', x: GEN_LEVER.x, z: GEN_LEVER.z, label: 'Generator', sfx: 'switch_throw', activation: 1.5,
    roles: ['greenberet', 'sniper', 'spy'],
    onUse: (c, d) => {
      d.on = !d.on;
      w._e02Dark = !!d.on;
      say(w, w._e02Dark ? 'The courtyard goes dark.' : 'The floodlights come back on.');
      return true;
    },
  });
}

/** o2 when the searchlight's crew is out; the beam dies with him (art: e02:beam). */
export function searchlightTick(w) {
  if (done(w, 'o2')) return;
  if (!crewOut(w.byId?.('c4'))) return;
  setDone(w, 'o2');
  w._e02BeamOff = true;
  say(w, 'The searchlight on the palazzo roof goes out.', 'objective');
}

/** mission.script: installed once per world (a quick load re-runs it on the rebuilt world). */
export function e02Script(w, dir) {
  installLog(w);
  installGenerator(w);
  // a flight in progress when the game was saved: the van stands off its parking place, on its path
  const v = w.byId?.('van_df');
  if (v && !v._e02) {
    const n = nearestS(w.mission?.vanPath || VAN_PATH, v.x, v.z);
    if (n.s > 1.5 && n.d < 1.5) v._e02 = { phase: 'driving', s: n.s, speed: VAN_SPEED, startAt: null };
  }
  if (done(w, 'o2')) w._e02BeamOff = true;
  if (!w._e02Ticks) {
    w._e02Ticks = true;
    w.onBelTick((dt) => { vanTick(w, dir, dt); searchlightTick(w); });
    w.listen('alarm:zone', (p) => { if (p?.event === 'RHQ') vanAlarm(w); });
  }
  if (w.scene) runSync(buildE02ArtG(w));
}
// the quarter's meshes alone (the art pass, its textures): built by Game as the load ends (sliced), found built by the
// script
e02Script.visuals = (w) => runSliced(buildE02ArtG(w));
