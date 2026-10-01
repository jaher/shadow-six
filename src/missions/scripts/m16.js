/**
 * BEL Mission 16 "Stop Wildfire": mission-local helpers (docs/missions/m16.md §6.2, §10, §14). Owned by MISSIONS.
 *
 *  - `deck_underpass` set-piece: the bridge's cells over water (deck and its B.LOW side girders) become
 *    `grid.underpass`: a submerged diver passes under the spans, while the girders keep walkers and surface
 *    swimmers off the deck edges (no climbing on mid-span, no stepping off onto the island).
 *  - m16Tick(world) (per 20 Hz tick, idempotent, safe after a quick load):
 *      · engineers fire DETONATE only on ARRIVAL at their plunger (dossier §14 #1: the stock `_alarmRun` lets a
 *        stopped runner fire from wherever he stands after 0.5 s). A runner who has stopped short re-paths
 *        every second and stays in ALARM_RUN;
 *      · a vehicle parked over a plunger makes it unreachable: its sapper runs up to the hull and stands there,
 *        stuck, until he is killed ([DE][fd]: the Spy parks the lorry on the E-deck detonator);
 *      · the scripted drive-off (extraction adopts the lorry): the moment it starts (o1 done, all aboard) the
 *        lorry counts as gone (`drivenOff`: the win at boarding, dossier §10.2), and the straight [exit, leave]
 *        run the engine starts is replaced by a path-found one to the S road.
 * @module missions/scripts/m16
 */

import { T, B } from '../../world/grid.js';
import { SetPiece, registerSetpiece } from '../setpiece-base.js';

/** The three plungers (dossier §5.1, D_E moved onto the deck axis) and the four charges they fire. */
export const DETONATORS = {
  D_W: { x: 22.5, z: 77 },   // sapper e14, in the sandbag pit on the W bank below the bridge
  D_I: { x: 53.6, z: 87.5 }, // sappers e16 + e17, on the island by the hut
  D_E: { x: 85.5, z: 103.5 }, // sapper e15, on the roadway at the E end of the deck
};
export const CHARGES = [[45.9, 70.7], [57.6, 80.4], [69.4, 90.2], [83, 101.5]]; // piers P1–P3 + E abutment
export const SAPPERS = ['e14', 'e15', 'e16', 'e17'];
/** Arrival radius for a DETONATE (dossier §14 #1: ≤ 1.5 m; the brain's own test is 1.2 m). */
export const ARRIVE = 1.2;
/** A plunger counts as covered when it lies this far inside a hull (so the stuck man stays > ARRIVE away). */
const COVER_IN = 0.6;
/** He stops this close to the hull he cannot pass (tight against it: the Spy injects him in its shelter, [DE]). */
const STOP_AT = 0.7;

// ---------------------------------------------------------------- deck_underpass set-piece

/**
 * deck_underpass {structure: id}: flags the structure's cells over water (deck and side girders) as
 * `grid.underpass`, so a submerged diver passes under the spans (NavGrid.isWalkable opts.dive,
 * Commando.moveTo). The girders stay B.LOW for everyone else: a surface swimmer can neither climb onto the
 * deck mid-span nor drop off it, and cannot cross the bridge line without diving.
 */
class DeckUnderpass extends SetPiece {
  build(world) {
    const g = world.grid, rec = world.structures?.get?.(this.spec.structure);
    if (!g?.underpass || !rec) return;
    for (let k = 0; k < g.block.length; k++) {
      const t = g.terrain[k];
      if (g.owner[k] === rec.owner && (t === T.WATER || t === T.SHALLOW)) g.underpass[k] = 1;
    }
    // `gaps: [{x, z, r}]`: girder cells (B.LOW) of this structure inside r that stand on the bank or in the shallows
    // (never over deep water) are opened, so a man wading in the shallows can climb onto the bridgehead there
    // (M16 [DE]: the Marine climbs in along the E bank). Optional: M18 and older specs have none.
    let opened = 0;
    for (const gp of this.spec.gaps || []) {
      const c = g.cell, r = gp.r ?? 1.5;
      for (let j = Math.floor((gp.z - r) / c); j <= Math.floor((gp.z + r) / c); j++) {
        for (let i = Math.floor((gp.x - r) / c); i <= Math.floor((gp.x + r) / c); i++) {
          if (i < 0 || j < 0 || i >= g.cols || j >= g.rows || Math.hypot((i + 0.5) * c - gp.x, (j + 0.5) * c - gp.z) > r) continue;
          const k = j * g.cols + i;
          if (g.owner[k] !== rec.owner || g.block[k] !== B.LOW || g.terrain[k] === T.WATER) continue;
          g.block[k] = B.NONE; opened++;
        }
      }
    }
    if (opened) g.version++;
  }
}
registerSetpiece('deck_underpass', DeckUnderpass);

// ---------------------------------------------------------------- hull geometry

/** (x, z) in a vehicle's hull frame: along = heading axis, side = across. */
function local(v, x, z) {
  const dx = x - v.x, dz = z - v.z, c = Math.cos(v.heading || 0), s = Math.sin(v.heading || 0);
  return { along: dx * c + dz * s, side: -dx * s + dz * c };
}
const halfSize = (v) => { const sz = v.def?.size || [6, 2.4]; return { L: sz[0] / 2, W: sz[1] / 2 }; };

/** Distance from (x, z) to a vehicle's hull rectangle (0 inside). */
export function hullDistance(v, x, z) {
  const p = local(v, x, z), h = halfSize(v);
  const ax = Math.max(0, Math.abs(p.along) - h.L), sx = Math.max(0, Math.abs(p.side) - h.W);
  return Math.hypot(ax, sx);
}

/** The land vehicle whose hull covers the point (x, z), or null. Trains never park on a plunger. */
export function coveringVehicle(world, x, z) {
  for (const v of world.vehicles || []) {
    if (v.removed || v.def?.kind !== 'land') continue;
    const p = local(v, x, z), h = halfSize(v);
    if (Math.abs(p.along) <= h.L - COVER_IN && Math.abs(p.side) <= h.W - COVER_IN) return v;
  }
  return null;
}

// ---------------------------------------------------------------- per-tick glue

const DT = 0.05;

function tickEngineers(w) {
  for (const e of w.enemies || []) {
    if (!e.alive || e.removed || e.soldierType !== 'engineer') continue;
    const b = e.brain, g = b?.goal;
    if (!b || b.state !== 'ALARM_RUN' || !g || g.fired) continue;
    const blocker = coveringVehicle(w, g.x, g.z);
    if (blocker) {
      // stuck against the hull: he stands at arm's length and waits (the plunger is under the lorry)
      if (hullDistance(blocker, e.x, e.z) <= STOP_AT) { if (e.isMoving) e.stop(); b.pt = 0; continue; }
      if (!e.isMoving) { b.pt = 0; repath(b, g); }
      continue;
    }
    if (Math.hypot(g.x - e.x, g.z - e.z) > ARRIVE && !e.isMoving) { b.pt = 0; repath(b, g); }
  }
}

function repath(b, g) {
  b._m16Repath = (b._m16Repath ?? 0) - DT;
  if (b._m16Repath > 0) return;
  b._m16Repath = 1;
  b._go?.(g.x, g.z, g.speed);
}

/**
 * The drive-off starts (the engine's leave run: o1 done, everyone aboard). Dossier §10.2: the win is recorded
 * at boarding, wherever the lorry is, and never depends on the drive (M16 review: a path-found run into
 * alerted patrols blew the lorry up and lost a won mission). `drivenOff` latches `passedExit`, so o2 completes on
 * this tick's objective check; the drive itself, replaced by a path-found one to the S road exit, is scenery.
 */
function tickDriveOff(w) {
  const ex = w.mission?.extraction, v = ex && w.byId?.(ex.vehicleId);
  if (!v || v.destroyed || !v.path?.length || !ex.leave) return;
  const last = v.path[v.path.length - 1];
  if (v._m16Routed || Math.hypot(last.x - ex.leave.x, last.z - ex.leave.z) > 0.5) return;
  v._m16Routed = true;
  v.drivenOff = true;
  const road = w.findPath?.(v.x, v.z, ex.exit.x, ex.exit.z, { swim: false }) || [{ x: ex.exit.x, z: ex.exit.z }];
  v.followPath([...road.map((p) => ({ x: p.x, z: p.z })), { x: ex.leave.x, z: ex.leave.z }], { speed: ex.leave.speed });
}

/** Per-tick mission glue (trigger `tick`, once: false). */
export function m16Tick(world) {
  tickEngineers(world);
  tickDriveOff(world);
}

/** All four sappers dead (objective o1). */
export const sappersDead = (w) => SAPPERS.every((id) => { const u = w.byId?.(id); return !u || u.alive === false; });
