/**
 * Gentle curves at path corners (playtest: "walk smoother"). A walker's progress stays on the string-pulled
 * polyline *track* (so route timing is exact); near a corner the drawn/actual position is the matching point on
 * a quadratic Bézier from `r` before the corner to `r` after it. The offset is a pure function of the track
 * position and the path — no state, nothing to save. Sharp turns (> 120°, an about turn) and ladder / climb
 * links are left square.
 */

const MAX_TURN_COS = -0.5; // cos 120°

/** Unit vector a→b and its length. */
function dir(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
  return l > 1e-6 ? { x: dx / l, z: dz / l, l } : null;
}

/**
 * Offset (track → curve) at track point (tx, tz) on leg `idx` of `path` (walking towards path[idx]), or null.
 * @param {{x:number,z:number,link?:object,steer?:boolean}[]} path
 * @param {number} idx current waypoint index
 * @param {{x:number,z:number}|null} from where the current leg started when idx === 0 (moveTo paths start at path[0])
 * @param {number} r0 corner radius (m) before the clamps (half of either leg, turn angle)
 */
export function cornerOffset(path, idx, from, tx, tz, r0) {
  const W = path[idx];
  if (!W || W.steer) return null;
  // approaching corner W (next leg W → path[idx + 1]) or leaving corner V = the leg's start (previous leg V0 → V)
  const dW = Math.hypot(W.x - tx, W.z - tz);
  const V = idx > 0 ? path[idx - 1] : null, V0 = idx > 1 ? path[idx - 2] : null;
  const cands = [];
  if (idx + 1 < path.length) cands.push({ A: idx > 0 ? path[idx - 1] : from, C: W, B: path[idx + 1], s: -dW });
  if (V && V0) cands.push({ A: V0, C: V, B: W, s: Math.hypot(tx - V.x, tz - V.z) });
  for (const c of cands) {
    if (!c.A || c.C.link || c.B.link || (c.A.link && c.s < 0)) continue;
    if ((c.C.y ?? 0) !== (c.B.y ?? 0) || (c.A.y ?? 0) !== (c.C.y ?? 0)) continue;
    const din = dir(c.A, c.C), dout = dir(c.C, c.B);
    if (!din || !dout) continue;
    const cos = din.x * dout.x + din.z * dout.z;
    if (cos < MAX_TURN_COS || cos > 0.9995) continue;
    // a tighter radius for a sharper turn (the apex slows less), never more than half of either leg
    const r = Math.min(r0 * (0.5 + 0.5 * cos + 0.25), din.l / 2, dout.l / 2);
    if (r < 0.05 || Math.abs(c.s) >= r) continue;
    const s = c.s + r, u = s / (2 * r); // 0 at the entry point, 1 at the exit point
    const E = { x: c.C.x - din.x * r, z: c.C.z - din.z * r }, X = { x: c.C.x + dout.x * r, z: c.C.z + dout.z * r };
    const bx = (1 - u) * (1 - u) * E.x + 2 * u * (1 - u) * c.C.x + u * u * X.x;
    const bz = (1 - u) * (1 - u) * E.z + 2 * u * (1 - u) * c.C.z + u * u * X.z;
    return { x: bx - tx, z: bz - tz };
  }
  return null;
}
