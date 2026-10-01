/**
 * BEL Mission 13 "David and Goliath": mission-local helpers (docs/missions/m13.md §4.2, §6, §10, §11). Owned by MISSIONS.
 *
 *  - `quay_edge` set-piece (dossier §14 E1): the granite quay faces are one-way walls. A B.FENCE line (blocks feet
 *    and swimmers, never sight or torpedoes) runs round every quay outline, with gaps at the five slipways, the
 *    sub-pontoon gangway and the GB's climb point. So the Marine climbs out only at a ramp, and nobody walks
 *    off a quay into the water.
 *  - m13Tick(world) (per 20 Hz tick, idempotent, so it survives a quick load):
 *      · the Marine's inflatable carries the whole team here (dossier D9, `raftSeats: 5`);
 *      · the Panzer II waits blind in its garage until the dock's alarm (tank depot §4.9): its cone opens on RINT;
 *      · once the alarm is up and it has driven out of the garage, it hunts the mini-sub: cannon or MG whenever it
 *        has a clear line (static walls AND parked vehicles block; a truck across the garage door keeps it in, T4).
 *      (Before the alarm the vehicle AI keeps it dormant too, `dormantUntilAlarm`, so a quick load never opens its eyes.)
 *  - Small queries for the triggers: torpedo hits on the hull aft of the bow zone, torpedoes left/in flight.
 * @module missions/scripts/m13
 */

import { B } from '../../world/grid.js';
import { SetPiece, registerSetpiece } from '../setpiece-base.js';
import { makeVision } from '../../entities/enemy.js';

/** The battleship (dossier §5.1): bow W, bow tip at x 16; hull z 12–28 (S side 3 m off the N quay face). */
export const SHIP = { id: 'bismarck2', x: 71, z: 20, w: 110, d: 16, bowX: 16 };
/** Where a torpedo must strike (dossier §10.1, D3): the forward hull, bow tip to x 28 on the S side. */
export const BOW_HIT = { id: 'bow_hit', x: 21, z: 28, r: 7 };
export const RAFT_SEATS = 5;
export const TANK_HUNT_RANGE = 45;
/** The brick garage's footprint (+0.5 m): the tank hunts the sub only once it has driven out of it (dossier §6.1 T4). */
export const GARAGE = { x0: 74.5, x1: 85.5, z0: 91.5, z1: 103.5 };
export const inGarage = (v) => v.x > GARAGE.x0 && v.x < GARAGE.x1 && v.z > GARAGE.z0 && v.z < GARAGE.z1;

/** True when (x, z) lies on/against the battleship's hull footprint (the map clips its stern). */
export function onHull(x, z, margin = 1) {
  return x >= SHIP.bowX - margin && z >= SHIP.z - SHIP.d / 2 - margin && z <= SHIP.z + SHIP.d / 2 + margin;
}
/** A torpedo hit on the hull outside the bow zone ("the armour held", T8). */
export function aftHit(p) {
  return p?.weapon === 'torpedo' && onHull(p.x, p.z) && Math.hypot(p.x - BOW_HIT.x, p.z - BOW_HIT.z) > BOW_HIT.r;
}
/** Torpedoes still aboard the sub plus those running. */
export function torpedoesLeft(world) {
  const sub = world.byId?.('sub');
  const aboard = sub && !sub.destroyed ? sub.torpedoes ?? 0 : 0;
  const running = (world.projectiles || []).filter((p) => p.projKind === 'torpedo' && p.alive !== false && !p.removed).length;
  return aboard + running;
}
const shipAfloat = (world) => { const o = (world.objectives || []).find((q) => q.id === 'o_ship'); return !(o && o.done); };
/** Soft-lock guard (T7): no torpedo aboard or running and the battleship still afloat. */
export function outOfTorpedoes(world) {
  return shipAfloat(world) && !!world.byId?.('sub') && torpedoesLeft(world) === 0;
}
export { shipAfloat };

// ---------------------------------------------------------------- quay_edge set-piece

/**
 * quay_edge {rings:[[[x,z]…]…] (closed outlines), lines?:[[[x,z]…]…] (open), gaps:[{x,z,w,d}] (NW corner + size),
 * width?=1}. Writes B.FENCE into free cells along every outline, then frees the gap rects again.
 */
class QuayEdge extends SetPiece {
  build(world) {
    const g = world.grid, width = this.spec.width ?? 1;
    const paths = [...(this.spec.rings || []).map((r) => [...r, r[0]]), ...(this.spec.lines || [])];
    const c = g.cell;
    const inGap = (x, z) => (this.spec.gaps || []).some((q) => x >= q.x && x <= q.x + q.w && z >= q.z && z <= q.z + q.d);
    // stamp into a scratch mask first so existing blocks (walls, cliffs, crates) are never overwritten
    const before = Uint8Array.from(g.block);
    for (const p of paths) g.fillLine(p, width, 'block', B.FENCE);
    for (let k = 0; k < g.block.length; k++) {
      if (g.block[k] !== B.FENCE || before[k] === B.FENCE) continue;
      const i = k % g.cols, j = (k - i) / g.cols;
      if (before[k] !== B.NONE) g.block[k] = before[k];
      else if (inGap((i + 0.5) * c, (j + 0.5) * c)) g.block[k] = B.NONE;
      else if (g.bridge[k]) g.block[k] = B.NONE; // pier decks (the sub pontoon) stay walkable
    }
  }
}
registerSetpiece('quay_edge', QuayEdge);

// ---------------------------------------------------------------- per-tick glue

const tankVision = new WeakMap();
const alarmed = (w) => !!w.alarm?.zonesFired?.some((f) => f.event === 'RINT');

function tickTank(w) {
  const tank = w.byId?.('pz2');
  if (!tank || tank.destroyed) return;
  if (!tankVision.has(tank)) tankVision.set(tank, tank.vision || makeVision('tank', tank.spawn || {}));
  const up = alarmed(w);
  // blind in the depot until the alarm (nobody inside looks out of the door)
  if (!up) { if (tank.vision) { tank.vision = null; tank.sweepActive = false; } return; }
  if (!tank.vision && tank.crewed) { tank.vision = tankVision.get(tank); tank.sweepActive = true; }
  // the hunt: the sub is its first target once it can see it
  const sub = w.byId?.('sub');
  if (!sub || sub.destroyed || !tank.crewed) return;
  // first its alarm drive out of the door; still inside (or shut in by the truck) it only fires at what it sees
  if (inGarage(tank)) return;
  const d = Math.hypot(sub.x - tank.x, sub.z - tank.z);
  if (d > TANK_HUNT_RANGE) return;
  const hull = { x: tank.x, z: tank.z, w: tank.def.size[0], d: tank.def.size[1], heading: tank.heading };
  if (!w.grid.lineOfSight(tank.x, tank.z, sub.x, sub.z, { dynamic: true, ownHull: hull })) return;
  tank.fireAt(sub);
}

function tickRaft(w) {
  for (const v of w.vehicles || []) {
    if (v.vehicleType === 'raft' && !v.destroyed && v.def.seats < RAFT_SEATS) v.def.seats = RAFT_SEATS;
  }
}

/** Per-tick mission glue (trigger `tick`, once: false). */
export function m13Tick(world) {
  tickRaft(world);
  tickTank(world);
}
