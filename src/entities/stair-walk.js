/**
 * The sim side of stairs and ladders (user request 2026-10-07: "animate the commandos climbing and going down stairs
 * properly"), for Unit._followPath:
 *  - pace: a man on a flight of stairs (world/stairs.js) goes a little slower — walking × STAIR_PACE.walk, a run is a
 *    careful jog (× STAIR_PACE.run, ≤ STAIR_PACE.runMax and ≤ STAIR_PACE.jog treads a second: no faster than legs take
 *    the flight's treads two at a time), crawling × STAIR_PACE.crawl — eased in over the first and last half metre of the
 *    flight (a pure function of where he is: replays and loads stay deterministic);
 *  - stair links (`ladders[]` kind 'stairs', walked): his height is the flight's nosing line; planks: the straight
 *    line between the link's ends;
 *  - ladders: up / down the ladder's line from its foot to its top (the link's ends) at CONFIG.abilities.ladderSpeed
 *    along it, always facing the ladder (art/ladder-climb.js shows the hands and feet on its rungs).
 * @module entities/stair-walk
 */
import { CONFIG } from '../config.js';
import { STAIR_PACE, flightLocal, lineAt } from '../world/stairs.js';

const LOW = new Set(['crawl', 'downed']);
const smooth = (u) => { const t = Math.min(1, Math.max(0, u)); return t * t * (3 - 2 * t); };

/** The flight a unit walks on now ({f, s, v} of StairField.flightAt; `pad` m past its ends, `side` m beside it), or null. */
export function unitFlight(u, pad = 0, side = 0.15) {
  const F = u.world?.grid?.flights;
  if (!F?.size) return null;
  const wp = u.path?.[u.pathIndex];
  const link = wp?.link?.walk === 'stairs' ? wp.link.id : null;
  return F.flightAt(u.x, u.z, u.y ?? 0, { pad, side, link });
}

/**
 * Speed (m/s) of a unit on a flight of stairs for his speed `v` off them (`v` itself off them): walking × STAIR_PACE.walk,
 * running × STAIR_PACE.run but no faster than STAIR_PACE.runMax (a careful jog: two treads a stride), crawling ×
 * STAIR_PACE.crawl, eased over the first / last 0.5 m of the flight. Swimmers and men in a vehicle are never on stairs.
 */
export function stairSpeed(u, v) {
  const st = u.stance;
  if (st === 'swim' || st === 'dive' || u.vehicle) return v;
  const at = unitFlight(u, 0.5);
  if (!at) return v;
  const { f, s } = at;
  const k = smooth(Math.min(s - (f.sFoot - 0.5), f.sTop + 0.5 - s) / 0.5);
  const on = LOW.has(st) ? v * STAIR_PACE.crawl
    : u.moveMode === 'run' ? Math.min(v * STAIR_PACE.run, STAIR_PACE.runMax, STAIR_PACE.jog * f.tread) : v * STAIR_PACE.walk;
  return v + (on - v) * k;
}

/** Is the unit on the run of a flight of stairs (its treads, ± 0.3 m)? */
export function onStairRun(u) {
  const at = unitFlight(u, 0.3);
  return !!at && at.s > at.f.sFoot - 0.3 && at.s < at.f.sTop + 0.3;
}

/**
 * Height of a man walking a walked link (`wp.link.walk`: a stair link's nosing line, a plank's straight line between
 * its ends) at (x, z), or null when the current waypoint is not one.
 */
export function linkWalkY(u, wp) {
  const lk = wp?.link;
  if (!lk?.walk) return null;
  const g = u.world?.grid;
  if (lk.walk === 'stairs') {
    const f = g?.flights?.ofLink(lk.id);
    if (f) return lineAt(f, flightLocal(f, u.x, u.z).s);
  }
  const L = g?.links?.find((l) => l.id === lk.id);
  if (!L) return null;
  const dx = L.b.x - L.a.x, dz = L.b.z - L.a.z, l2 = dx * dx + dz * dz;
  const t = l2 > 1e-9 ? Math.min(1, Math.max(0, ((u.x - L.a.x) * dx + (u.z - L.a.z) * dz) / l2)) : 0;
  return L.a.y + (L.b.y - L.a.y) * t;
}

/** Is this waypoint a ladder to climb (a ladder link, not a walked one)? */
export const isLadderLeg = (wp) => wp?.link?.kind === 'ladder' && !wp.link.walk;

/**
 * Track of a ladder leg from where the unit stands to the waypoint (the link's other end): its foot and top, the
 * facing (horizontal, foot → top; the link's heading when the ladder is plumb), the 3-D length, going up or down.
 * @returns {{wp:object, from:{x,z,y}, to:{x,z,y}, foot:{x,z,y}, top:{x,z,y}, fx:number, fz:number, len:number, up:boolean, s:number, link:object|null}}
 */
export function ladderTrack(u, wp) {
  const g = u.world?.grid, L = g?.links?.find((l) => l.id === wp.link.id) || null;
  const to = { x: wp.x, z: wp.z, y: wp.y ?? 0 };
  // (from the link's other end when the unit stands at it — the path's previous waypoint — else from where he is)
  let from = { x: u.x, z: u.z, y: u.y ?? 0 };
  if (L) {
    const other = Math.hypot(L.a.x - to.x, L.a.z - to.z) < Math.hypot(L.b.x - to.x, L.b.z - to.z) ? L.b : L.a;
    if (Math.hypot(other.x - u.x, other.z - u.z) < 0.6) from = { x: other.x, z: other.z, y: other.y ?? 0 };
  }
  const up = to.y >= from.y, foot = up ? from : to, top = up ? to : from;
  let fx = top.x - foot.x, fz = top.z - foot.z, h = Math.hypot(fx, fz);
  if (h < 0.05) { const a = L?.heading ?? u.heading ?? 0; fx = Math.cos(a); fz = Math.sin(a); h = 1; }
  fx /= h; fz /= h;
  const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  return { wp, from, to, foot, top, fx, fz, len, up, s: 0, link: L };
}

/** Climbing speed on a ladder (m/s along it): §3.2 everyone climbs ladders at CONFIG.abilities.ladderSpeed. */
export const ladderSpeed = (u) => CONFIG.abilities.ladderSpeed * (u.speedMul ?? 1);

/**
 * Does a path (from where the unit stands) run onto a flight of stairs' run (within its width, past its first / before
 * its last half-metre)? A flight he already stands on does not count (he may leave it).
 */
export function pathOnStairs(u, path) {
  const F = u.world?.grid?.flights;
  if (!F?.size || !path?.length) return false;
  const on = (x, z) => {
    for (const f of F.near(x, z, 0)) {
      if (f.link) continue;
      const { s, v } = flightLocal(f, x, z);
      if (Math.abs(v) <= f.w / 2 && s > f.sFoot + 0.3 && s < f.sTop - 0.3) return f;
    }
    return null;
  };
  const here = on(u.x, u.z);
  let ax = u.x, az = u.z;
  for (const p of path) {
    if (p.link) { ax = p.x; az = p.z; continue; }
    const n = Math.max(1, Math.ceil(Math.hypot(p.x - ax, p.z - az) / 0.25));
    for (let q = 1; q <= n; q++) { const f = on(ax + ((p.x - ax) * q) / n, az + ((p.z - az) * q) / n); if (f && f !== here) return true; }
    ax = p.x; az = p.z;
  }
  return false;
}
