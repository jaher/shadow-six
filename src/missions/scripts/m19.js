/**
 * BEL Mission 19 "Frustrate Retaliation": mission-local glue (docs/missions/m19.md §6.2, §9, §11, §14). Owned by
 * MISSIONS. Installed once by `mission.script` (after the set-pieces' lazy init; called again on a quick load):
 *
 *  - the team starts prone behind the rock mound (the spawn `stance` is not read by the engine);
 *  - the bridge charge [K scrapbook][P][DE]: a remote bomb within 4 m of mid-span drops 9 m of the trestle (its
 *    cells become river again, swimmable), kills anyone standing on that stretch (not a swimming Marine),
 *    damages the mine track (the cart stops short) and fires the N-bank event RN — never the base's siren;
 *  - the base's hearing (§14 #1): the engine hears every explosion map-wide, so `z_base.onHeard` is null and
 *    this replays it: a level ≥ 2 noise heard by a living man inside the base, or an explosion within 25 m of
 *    the base, sounds the siren (RINT). The caged dog's bark is such a noise [P "it will bark and alert"];
 *  - onNorthAlarm (trigger T3 on RN): the Panzer II drives out of its shed and every man on the N bank goes on
 *    alert for good (held each tick). The base hears nothing of it [P "an alarm, but across the river"];
 *  - the mine cart (harmless rail, which the engine never stops) turns back short of the fallen span.
 * The fallen span is read back from the grid (saved with the game), so a quick load keeps it.
 * @module missions/scripts/m19
 */

import * as THREE from 'three';
import { CONFIG } from '../../config.js';
import { B } from '../../world/grid.js';
import { canSee } from '../../ai/perception.js';
import { inPoly } from '../setpiece-base.js';

/** `z_base`: the palisade plus a 3–5 m margin (the white wall, the gate, the tower's foot). */
export const ZONE_BASE = [[96, 56], [106, 42], [112, 27], [151, 27], [151, 50], [144, 62], [138, 80], [124, 85], [104, 90], [96, 90]];
/** The rail trestle (dossier §5.2): centre, length, width, heading (degrees). */
export const BRIDGE = { x: 68.5, z: 55.25, w: 25.7, d: 3, rot: 26.6 };
export const BRIDGE_MID = { x: BRIDGE.x, z: BRIDGE.z };
const U = { x: Math.cos((BRIDGE.rot * Math.PI) / 180), z: Math.sin((BRIDGE.rot * Math.PI) / 180) };
const N = { x: -U.z, z: U.x };
const corner = (a, b) => [BRIDGE.x + U.x * a + N.x * b, BRIDGE.z + U.z * a + N.z * b];
/** The stretch that goes: 9 m of deck (±4.5 m along the axis), rails included (±2 m across). */
export const BRIDGE_CUT = [corner(-4.5, -2), corner(4.5, -2), corner(4.5, 2), corner(-4.5, 2)];
/** The N bank (the river's NW shore up to the N edge, closed along the map's W and N edges). */
export const NORTH_BANK = [[0, 82], [10, 75], [25, 68], [45, 65], [55, 60], [60, 52], [64, 46], [68, 40], [72, 36], [78, 32], [84, 28],
  [90, 25], [96, 20], [100, 16], [106, 10], [110, 4], [112, 0], [0, 0]];
export const northBank = (x, z) => inPoly(NORTH_BANK, x, z);

/** Distance from (x, z) to a polygon (0 inside). */
export function distToPoly(poly, x, z) {
  if (inPoly(poly, x, z)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

/** Has the bridge charge gone off? (read from the grid: the mid-span cell is no longer a bridge cell) */
export function bridgeDown(w) {
  const g = w.grid, i = Math.floor(BRIDGE.x / g.cell), j = Math.floor(BRIDGE.z / g.cell);
  return !g.bridge[g.idx(i, j)];
}

/** Draw the broken trestle: hide the whole deck mesh, add the two surviving stubs. */
function showBrokenBridge(w) {
  const s = w.structures?.get?.('bridge');
  if (!s?.object3d || s._m19Broken) return;
  s._m19Broken = true;
  s.object3d.visible = false;
  const parent = s.object3d.parent;
  if (!parent) return;
  const mat = new THREE.MeshStandardMaterial({ color: 0x5c4b3a, roughness: 0.9 });
  const len = BRIDGE.w / 2 - 4.5;
  for (const sgn of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.35, BRIDGE.d), mat);
    const c = BRIDGE.w / 4 + 2.25;
    m.position.set(BRIDGE.x + U.x * c * sgn, 0.45, BRIDGE.z + U.z * c * sgn);
    m.rotation.y = -(BRIDGE.rot * Math.PI) / 180;
    parent.add(m);
  }
}

/** The bridge charge: drop the mid-span, drown whoever stands on it, damage the track, fire RN. */
export function blowBridge(w, source = null) {
  if (bridgeDown(w)) return false;
  const g = w.grid;
  g.fillPoly(BRIDGE_CUT, 'bridge', 0);
  g.fillPoly(BRIDGE_CUT, 'block', 0);
  g.version++;
  for (const u of [...(w.commandos || []), ...(w.enemies || [])]) {
    if (!u.alive || u.removed || u.state === 'inVehicle') continue;
    if (u.role === 'diver' && (u.stance === 'swim' || u.stance === 'dive')) continue;
    if (inPoly(BRIDGE_CUT, u.x, u.z)) u.takeDamage?.(1e5, source?.owner ?? null, 'explosion');
  }
  for (const v of w.vehicles || []) {
    if (v.removed || v.destroyed || !inPoly(BRIDGE_CUT, v.x, v.z)) continue;
    for (const u of [...(v.occupants || [])]) u.takeDamage?.(1e5, null, 'explosion');
    v.destroy?.(null, 'explosion');
  }
  const rail = w.setpieces?.get?.('mine_rail');
  if (rail?._addBlock && !rail.blocks.some((b) => Math.hypot(b.x - BRIDGE.x, b.z - BRIDGE.z) < 3)) {
    rail._addBlock({ x: BRIDGE.x, z: BRIDGE.z, r: 5, active: true });
  }
  showBrokenBridge(w);
  w.events.emit('structure:destroyed', { id: 'bridge', type: 'collapse', owner: 0 });
  w.events.emit('message', { text: 'The bridge is down. The north bank is cut off.', kind: 'info' });
  w.alarm?.fireEvent('RN', { zoneId: 'z_n', cause: 'explosion', x: BRIDGE.x, z: BRIDGE.z });
  return true;
}

/** Has the N-bank event RN fired? (the alarm's zone log is saved with the game) */
export const northAlarmed = (w) => !!w.alarm?.zonesFired?.some((f) => f.event === 'RN');

/** Every man on the N bank stays on alert (level 2) once RN has fired; the base hears nothing of it. */
function holdNorthAlert(w) {
  for (const e of w.enemies || []) {
    if (!e.alive || e.removed || !e.brain || !northBank(e.x, e.z)) continue;
    if ((e.brain.alertT || 0) < 2 || e.brain.alertBoost < 2) {
      e.brain.alertT = Math.max(e.brain.alertT || 0, 2);
      e.brain.alertBoost = 2;
      e.brain._updateAlert?.();
    }
  }
}

/** T3 (RN): the Panzer II drives out of the shed and hunts; the N bank goes on alert. No siren. */
export function onNorthAlarm(w) {
  const tk = w.byId?.('tk1');
  if (tk && !tk.destroyed && !tk.driver && !tk._m19Out) {
    tk._m19Out = true;
    tk.followPath([{ x: 28, z: 28 }, { x: 31, z: 38 }], { speed: 3 });
  }
  holdNorthAlert(w);
}

/**
 * The mine cart is harmless rail (the engine never stops it at damaged track): once the span is gone it turns
 * back 3 m short of the break and shuttles on its own side (railS grows from the SE yard towards the mine).
 */
function holdCart(w) {
  const v = w.byId?.('cart');
  if (!v || v.destroyed || v.removed) return;
  const t = (v.x - BRIDGE.x) * U.x + (v.z - BRIDGE.z) * U.z;
  if (Math.abs(t) > 7.5 || Math.abs((v.x - BRIDGE.x) * N.x + (v.z - BRIDGE.z) * N.z) > 3) return;
  if ((t > 0 && v.railDir > 0) || (t < 0 && v.railDir < 0)) { v.railDir = -v.railDir; v.speed = 0; v.waitT = 3; }
}

/**
 * The plank palisade is 3 m of boards: nobody sees through it either way (B.HIGH, not the see-through wire
 * B.FENCE), so the guards inside never see the shore, the boat or a man outside. A bullet at a barrel still goes
 * through (`shotThrough`: the Sniper sets off the barrels by the rockets through the fence [ooc][fd]).
 * Re-stamped on every install, so a save from before the change loads the same way.
 * @returns {number} cells sealed
 */
export function sealPalisade(w) {
  const g = w.grid, owners = new Set();
  for (const s of w.structures?.values?.() || []) if (s?.def?.variant === 'palisade_plank' && s.owner) owners.add(s.owner);
  let n = 0;
  if (!g || !owners.size) return n;
  for (let k = 0; k < g.block.length; k++) if (g.block[k] === B.FENCE && owners.has(g.owner[k])) { g.block[k] = B.HIGH; n++; }
  if (n) g.version++;
  return n;
}

/**
 * The caged dog (`quietBody`): Prima's Sniper shoots it through the pen rails before anyone climbs in. Its death
 * is a witnessed kill only for a guard who sees the shooter, and its body alarms nobody (perception bodiesOf).
 */
function quietDogKills(w) {
  for (const e of w.enemies || []) {
    const b = e.brain;
    if (!b || b._m19Quiet || typeof b.notifyKill !== 'function') continue;
    b._m19Quiet = true;
    const orig = b.notifyKill.bind(b);
    b.notifyKill = (victim, killer, ...rest) => {
      if (victim?.spawn?.quietBody && !(killer?.alive && canSee(e, killer, w, { ignoreDisguise: true }) !== 'none')) return false;
      return orig(victim, killer, ...rest);
    };
  }
}

/** The base garrisons' squads walk back in this long (s) after the siren stops, if nothing else holds them. */
export const SQUAD_HOME_AFTER = 120;
const HOME_BARRACKS = ['barr_n', 'barr_s'];

/**
 * After the alarm (§4.9 squads loop for good in the engine): once the siren has been off SQUAD_HOME_AFTER s, each
 * base squad whose men are all back on their loop (not fighting, searching or investigating) walks to its
 * barracks door and goes in; the men return to the pool and the next siren sends them out again.
 */
function squadsHome(w) {
  const a = w.alarm;
  if (!a?.barracks) return;
  if (a.active) { w._m19Calm = null; return; }
  if (w._m19Calm == null) w._m19Calm = w.time;
  if (w.time - w._m19Calm < SQUAD_HOME_AFTER) return;
  for (const id of HOME_BARRACKS) {
    const b = a.barracks[id];
    if (!b || b.destroyed) continue;
    for (const s of b.squads) {
      if (!s.released || !s.members?.length || s.regenT != null) continue;
      const live = s.members.filter((e) => e.alive && !e.removed);
      if (!live.length) continue;
      if (live.some((e) => !e._m19Home && e.brain?.state !== 'REINFORCE')) continue; // still busy
      const door = a._barracksDoor(b);
      for (const e of live) if (!e._m19Home) { e._m19Home = true; e.brain?.reinforce?.([door], [door]); }
      // the squad goes in together once its leader is at the door (the others follow in file, a few metres back)
      const atDoor = (e) => Math.hypot(e.x - door.x, e.z - door.z);
      if (!live.some((e) => atDoor(e) < 1.5) || live.some((e) => atDoor(e) > 6 || e.brain?.state !== 'REINFORCE')) continue;
      for (const e of live) { w.removeLater(e); b.pool++; }
      s.released = false;
      s.members = [];
      s.gen = (s.gen ?? 0) + 1;
    }
  }
}

/** A noise the base's sentries hear (level ≥ zoneHeardLevel, a living man inside `z_base` within its radius). */
function baseHears(w, n) {
  // the caged dog's bark is a level-2 cue the guards come to look at, not the siren [K "they'll come to
  // investigate nothing, so the alarm won't sound"]
  if ((n.level ?? 0) < CONFIG.stealth.zoneHeardLevel || n.kind === 'explosion' || n.kind === 'bark') return false;
  return (w.enemies || []).some((e) => e.alive && !e.removed && e !== n.source && e.soldierType !== 'dog'
    && inPoly(ZONE_BASE, e.x, e.z) && Math.hypot(e.x - n.x, e.z - n.z) <= (n.radius ?? 0));
}

/** mission.script: installed once per world (a quick load re-runs it on the rebuilt world). */
export function m19Script(w) {
  if ((w.time ?? 0) < 0.5) for (const c of w.commandos || []) if (c.alive !== false && c.stance === 'stand') c.setStance?.('crawl');
  if (bridgeDown(w)) showBrokenBridge(w);
  sealPalisade(w);
  quietDogKills(w);
  w.onBelTick(() => {
    if (northAlarmed(w)) holdNorthAlert(w);
    if (bridgeDown(w)) holdCart(w);
    quietDogKills(w);
    squadsHome(w);
  });
  w.listen('explosion', (e) => {
    if (e.kind === 'bomb' && Math.hypot(e.x - BRIDGE.x, e.z - BRIDGE.z) <= 4) blowBridge(w, e.source);
    if (!e.accident && distToPoly(ZONE_BASE, e.x, e.z) <= 25) w.alarm?.raise('z_base', 'explosion', e.x, e.z, { sensor: 'seen' });
  });
  w.listen('noise', (n) => {
    if (baseHears(w, n)) w.alarm?.raise('z_base', 'heard', n.x, n.z, { sensor: 'seen' });
  });
}
