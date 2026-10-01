/**
 * Gameplay feedback of a ragdoll (bodies-design §A.4): while in flight the body is perceived at its pelvis; once
 * settled the pose is baked on the unit (`unit.bodyPose`, `unit.settled`) and its gameplay position becomes the
 * pelvis projected to the ground, nudged to walkable ground and never inside a building; deep water sinks it.
 * @module physics/feedback
 */

import { CONFIG } from '../config.js';
import { groundAt } from './statics.js';

/** Gameplay (x, z) of ragdoll rd: the anchor moved by the pelvis displacement since spawn, clamped to the map. */
function pelvisXZ(pw, rd) {
  const w = pw.world, p = rd.pose;
  const x = rd.anchor.x + (p[0] - rd.spawnPelvis.x), z = rd.anchor.z + (p[2] - rd.spawnPelvis.z);
  return { x: Math.min(w.width - 0.01, Math.max(0.01, x)), z: Math.min(w.depth - 0.01, Math.max(0.01, z)) };
}

/** Per step while simulating: the AI sees the body where it is now (§A.4 "while in flight"). */
export function trackInFlight(pw, rd) {
  if (pw.world.house?.physicsGameplay === false) return; // 1998 rules: the body stays where he died
  const u = rd.unit, q = pelvisXZ(pw, rd);
  u.x = q.x; u.z = q.z;
}

/**
 * Bake a settled ragdoll into the unit and move its gameplay position.
 * @param {object} pw PhysicsWorld @param {object} rd ragdoll @param {object} rec poseRecord(rd)
 */
export function settleFeedback(pw, rd, rec) {
  const w = pw.world, g = w.grid, u = rd.unit, C = CONFIG.physics.ragdoll;
  if (w.house?.physicsGameplay === false) { // 1998 rules: the pose is drawn, the gameplay spot stays the death spot
    rec.n = [0, 0]; rec.tn = Math.round(w.time * 1e4) / 1e4;
    u.bodyPose = rec; u.settled = true;
    w.events.emit('body:settled', { unit: u, x: u.x, y: u.y, z: u.z, pose: rec });
    return;
  }
  let { x, z } = pelvisXZ(pw, rd);
  let nx = 0, nz = 0;
  const i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
  if (g.isWater(i, j)) {
    u.sunk = true;   // deep water: removed from perception like a drowned man
  } else if (!g.isWalkable(i, j)) {
    const n = g.nearestWalkable(x, z, C.nudge) || g.nearestWalkable(x, z, C.nudgeFar);
    if (n) { nx = n.x - x; nz = n.z - z; x = n.x; z = n.z; } else {
      // never inside a building: no walkable cell near where he came to rest → the spot where he died (walkable)
      nx = rd.anchor.x - x; nz = rd.anchor.z - z; x = rd.anchor.x; z = rd.anchor.z;
    }
  }
  u.x = x; u.z = z;
  // on a roof / platform when the pelvis lies at its surface height, else the ground
  const elev = g.elevAt(x, z);
  const pelvisY = rd.pose[1] - groundAt(w, x, z);
  u.y = elev > 0 && Math.abs(pelvisY - elev) < 0.7 ? elev : 0;
  rec.n = [Math.round(nx * 1e4) / 1e4, Math.round(nz * 1e4) / 1e4];
  rec.tn = Math.round(w.time * 1e4) / 1e4;
  u.bodyPose = rec;
  u.settled = true;
  u.savePrev?.();
  w.events.emit('body:settled', { unit: u, x: u.x, y: u.y, z: u.z, pose: rec });
}
