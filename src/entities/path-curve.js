/**
 * Gentle curves at path corners (playtest: "walk smoother"). A walker's progress stays on the string-pulled
 * polyline *track* (so route timing is exact); near a corner the drawn/actual position is the matching point on
 * a quadratic Bézier from `r` before the corner to `r` after it. The offset is a pure function of the track
 * position and the path — no state, nothing to save. Sharp turns (> 120°, an about turn) and ladder / climb
 * links are left square.
 */

const MAX_TURN_COS = -0.5; // cos 120°

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
  // (the two candidates and their unit vectors as plain numbers: asked for every walker every step — the candidate
  // records, direction objects and curve ends were steady garbage; the same tests in the same order)
  const dW = Math.hypot(W.x - tx, W.z - tz);
  const V = idx > 0 ? path[idx - 1] : null, V0 = idx > 1 ? path[idx - 2] : null;
  for (let ci = 0; ci < 2; ci++) {
    let A, C, B, cs;
    if (ci === 0) { if (!(idx + 1 < path.length)) continue; A = idx > 0 ? path[idx - 1] : from; C = W; B = path[idx + 1]; cs = -dW; }
    else { if (!(V && V0)) continue; A = V0; C = V; B = W; cs = Math.hypot(tx - V.x, tz - V.z); }
    if (!A || C.link || B.link || (A.link && cs < 0)) continue;
    if ((C.y ?? 0) !== (B.y ?? 0) || (A.y ?? 0) !== (C.y ?? 0)) continue;
    const ix = C.x - A.x, iz = C.z - A.z, il = Math.hypot(ix, iz);
    if (!(il > 1e-6)) continue; // (dir(A, C) null)
    const ox = B.x - C.x, oz = B.z - C.z, ol = Math.hypot(ox, oz);
    if (!(ol > 1e-6)) continue; // (dir(C, B) null)
    const dinX = ix / il, dinZ = iz / il, doutX = ox / ol, doutZ = oz / ol;
    const cos = dinX * doutX + dinZ * doutZ;
    if (cos < MAX_TURN_COS || cos > 0.9995) continue;
    // a tighter radius for a sharper turn (the apex slows less), never more than half of either leg
    const r = Math.min(r0 * (0.5 + 0.5 * cos + 0.25), il / 2, ol / 2);
    if (r < 0.05 || Math.abs(cs) >= r) continue;
    const s = cs + r, u = s / (2 * r); // 0 at the entry point, 1 at the exit point
    const Ex = C.x - dinX * r, Ez = C.z - dinZ * r, Xx = C.x + doutX * r, Xz = C.z + doutZ * r;
    const bx = (1 - u) * (1 - u) * Ex + 2 * u * (1 - u) * C.x + u * u * Xx;
    const bz = (1 - u) * (1 - u) * Ez + 2 * u * (1 - u) * C.z + u * u * Xz;
    return { x: bx - tx, z: bz - tz };
  }
  return null;
}
