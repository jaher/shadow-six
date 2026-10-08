/**
 * Demolition charge set INSIDE a bunker (M3 review: "when placing the bomb in the bunker the commando should go
 * inside"). A bunker structure def may carry `entry: {path: [[x, z], …], charge: [x, z]}` — `path` runs from the
 * ground outside its entrance (path[0]) through the entrance trench to the doorway (last point), `charge` is the
 * spot inside where the charge goes (a demolition `marker` there makes it the only spot that counts). A Sapper
 * who plants a time / remote bomb anywhere next to the bunker (within NEAR_WALLS of its walls) first walks round, in
 * his stance, to path[0] (the ability's `selfApproach`, Commando._updatePending); within ENTRY_REACH of path[0] he
 * stands up if he is lying, walks in along the path
 * (the grid's roof cells are not his floor: he is moved by this task at ground level, `Unit.scripted`), kneels and
 * sets the charge at `charge`, and walks back out to path[0]. Past path[`face`] (default: the entrance face, the
 * last-but-one point; M3: the gap into the walled entrance trench) he is behind concrete: only the bunker's own crew
 * can see him there, in their cone (perception `insideStructure`).
 * Entry points are mission data (not the library model's door) so a grid-only run (tools/solutions headless) and the
 * browser game behave the same.
 * @module abilities/bunker-entry
 */

import { CONFIG } from '../config.js';
import { timedTask } from './common.js';

/** m: how close to the outer end of the entry path the Sapper must be for the charge to go inside. */
export const ENTRY_REACH = 1.6;
/**
 * m: a Sapper who plants within this distance of a bunker's walls (its footprint) first walks (crawls, in his
 * stance) round to the outer end of its entry path and then goes in: a charge set beside the walls would be wasted
 * (the demolition marker is on the floor inside), so any plant next to the bunker means "blow up the bunker".
 */
export const NEAR_WALLS = 3.0;
/** m/s: his pace through the trench and the doorway (a careful walk, a little below the 2.25 m/s march). */
export const ENTRY_SPEED = 2.0;
/**
 * m from the bunker's footprint: closer, he is in the covered end of the entrance passage (under the roof's overhang,
 * behind the baffle) or inside, out of the camera's sight — x-rayed whole (see `apply`). M3 captures: still partly in
 * view at 1.1 m, wholly hidden from 0.97 m.
 */
const COVERED = 1.0;
/** s: kneeling down before the charge is set / getting up after it (around the plant clip). */
const KNEEL = 0.35;
/** m: he kneels this far short of the charge point, facing it. */
const KNEEL_OFF = 0.45;

/** The entry def of bunker interactable `it` (structure def `entry`), or null. */
export function entryOf(it) {
  const e = it?.params?.structure?.entry;
  return e && Array.isArray(e.path) && e.path.length >= 1 && Array.isArray(e.charge) ? e : null;
}

/**
 * An intact bunker whose entrance `c` stands at (within ENTRY_REACH of its entry path's outer end, on the ground).
 * @returns {{it: any, entry: object}|null}
 */
export function bunkerEntryNear(world, c) {
  if (!world || (c.y || 0) > 0.6 || c.vehicle) return null;
  let best = null, bd = ENTRY_REACH;
  for (const it of world.interactables || []) {
    if (!it.bunker || it.destroyed || it.removed) continue;
    const e = entryOf(it);
    if (!e) continue;
    const d = Math.hypot(c.x - e.path[0][0], c.z - e.path[0][1]);
    if (d <= bd) { bd = d; best = { it, entry: e }; }
  }
  return best;
}

/** m from the walls of the footprint (w × d, rotated `rot`) of bunker structure `it` to (x, z); <0 inside. */
export function wallDist(it, x, z) {
  const S = it?.params?.structure || {};
  const cx = S.x ?? it.x, cz = S.z ?? it.z, r = S.rot ?? 0;
  const hw = (S.w ?? 2 * (it.radius || 2)) / 2, hd = (S.d ?? S.w ?? 2 * (it.radius || 2)) / 2;
  const dx = x - cx, dz = z - cz, c = Math.cos(r), s = Math.sin(r);
  // local frame (world/placement-geom rectPoly: w along heading `rot`, d across)
  const lx = Math.abs(c * dx + s * dz) - hw, lz = Math.abs(-s * dx + c * dz) - hd;
  return lx > 0 || lz > 0 ? Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) : Math.max(lx, lz);
}

/**
 * An intact bunker with an `entry` whose walls `c` stands next to (within NEAR_WALLS) — the walk-up point for a bomb
 * planted there (Commando._updatePending: `approachPoint`): the outer end of its entry path. Null elsewhere.
 * @returns {{x: number, z: number, it: any}|null}
 */
export function bunkerApproach(world, c) {
  if (!world || (c.y || 0) > 0.6 || c.vehicle) return null;
  let best = null, bd = NEAR_WALLS;
  for (const it of world.interactables || []) {
    if (!it.bunker || it.destroyed || it.removed) continue;
    const e = entryOf(it);
    if (!e) continue;
    const d = wallDist(it, c.x, c.z);
    if (d <= bd || Math.hypot(c.x - e.path[0][0], c.z - e.path[0][1]) <= ENTRY_REACH) {
      bd = Math.min(bd, d);
      best = { x: e.path[0][0], z: e.path[0][1], it };
    }
  }
  return best;
}

/** Polyline helpers: cumulative lengths and the point / heading at distance s. */
function route(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const len = cum[cum.length - 1];
  const at = (s) => {
    s = Math.max(0, Math.min(len, s));
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    const a = pts[i - 1], b = pts[i], L = cum[i] - cum[i - 1] || 1, u = (s - cum[i - 1]) / L;
    return { x: a[0] + (b[0] - a[0]) * u, z: a[1] + (b[1] - a[1]) * u, heading: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  };
  return { len, cum, at };
}

/**
 * The go-in-and-plant task. `place(x, z)` creates the charge (the caller's bomb factory; false = failed).
 * `t0` / `data`: resumed after a load (the same route from the saved start point).
 * @returns {object} a timedTask
 */
export function entryTask(c, world, it, entry, place, { t0 = 0, data = null } = {}) {
  const start = data?.start ?? [c.x, c.z];
  const stand = data ? data.stand ?? 0 : c.stance === 'stand' ? 0 : CONFIG.units.stanceUp;
  if (!data && c.stance !== 'stand') c.setStance('stand');
  // in: from where he stands to the outer end, through the trench to the doorway, then to his kneeling spot
  const [cx, cz] = entry.charge, door = entry.path[entry.path.length - 1];
  const dx = cx - door[0], dz = cz - door[1], dl = Math.hypot(dx, dz) || 1;
  const kneel = [cx - (dx / dl) * KNEEL_OFF, cz - (dz / dl) * KNEEL_OFF];
  const inPts = [start, ...entry.path, kneel];
  const R = route(inPts);
  const faceIdx = Math.min(inPts.length - 2, 1 + (entry.face ?? Math.max(0, entry.path.length - 2))); // past it: inside
  const sFace = R.cum[faceIdx];
  const plant = CONFIG.weapons.timeBomb.plant;
  const tIn0 = stand, tIn1 = tIn0 + R.len / ENTRY_SPEED;
  const tPlant = tIn1 + KNEEL + plant; // the charge is set here
  const tOut0 = tPlant + KNEEL;
  // out: back along the same way to the outer end of the path (not to where he started)
  const outLen = R.len - R.cum[1];
  const tOut1 = tOut0 + outLen / ENTRY_SPEED;
  let planted = !!data?.planted;
  const pose = (t) => {
    if (t < tIn0) return { s: 0, moving: false, fwd: true };
    if (t < tIn1) return { s: (t - tIn0) * ENTRY_SPEED, moving: true, fwd: true };
    if (t < tOut0) return { s: R.len, moving: false, fwd: true };
    if (t < tOut1) return { s: R.len - (t - tOut0) * ENTRY_SPEED, moving: true, fwd: false };
    return { s: R.cum[1], moving: false, fwd: false };
  };
  const apply = (t) => {
    const p = pose(t), q = R.at(p.s);
    c.x = q.x; c.z = q.z; c.y = 0;
    if (p.moving) c.heading = p.fwd ? q.heading : q.heading + Math.PI;
    else if (t >= tIn1 && t < tOut0) c.heading = Math.atan2(cz - q.z, cx - q.x);
    // in the open-topped entrance trench (past the gap, short of its covered end) the baffle walls and the roof edge
    // hide only bits of him: no x-ray silhouette there (it showed as loose green bits on the roof edge); in the covered
    // passage and the room it is his whole body
    c.scripted = { moving: p.moving, noXray: p.s > sFace - 0.6 && wallDist(it, q.x, q.z) > COVERED };
    const inside = p.s > sFace + 1e-6;
    if (inside !== !!c.insideStructure) c.insideStructure = inside ? it : null;
  };
  const end = () => {
    c.scripted = null; c.insideStructure = null; c.y = 0;
  };
  let playedKneel = t0 >= tIn1;
  apply(t0);
  const task = timedTask({
    dur: tOut1, t0, interruptible: false,
    steps: [{ at: tPlant, fn: () => { if (planted) return true; planted = true; return place(cx, cz); } }],
    tick: (dt, t) => {
      if (!c.alive || it.destroyed) { end(); return 'failed'; }
      apply(t);
      if (!playedKneel && t >= tIn1) { playedKneel = true; c.playAction('plant', KNEEL * 2 + plant); }
      return 'running';
    },
    onEnd: end,
    onCancel: end,
    save: () => ({ bunker: it.tag ?? it.id, start, stand, planted }),
  });
  task.keepsState = false;
  return task;
}
