/**
 * Plumb rock faces beside built work, as drawn (art/dressing.js buildCliff `abut`): where a massif closes on concrete
 * the face stands plumb on the segment, set back `set` m, and only ever recessed further by the rock's noise. The nav
 * grid holds the massif by its cells (a cell is blocked when its centre is inside the outline), so a cell beside such a
 * face can be half rock and still open: a rifle held out over it was never seen to touch the rock (placement.weaponRoom
 * reads grid.block) and went up to 0.15 m into it — M3's E stair, whose rock stands on the tread edge, clipping audit
 * seed 11 (e6 aiming across the stair). These faces are exact, so a shouldered barrel keeps off them to the centimetre
 * (Unit._keepWeaponRoom).
 *
 * Pure geometry, no three.js. A face: {ax, az, bx, bz, ux, uz (along), nx, nz (into the rock), len, set, top}.
 * @module world/rock-faces
 */

/** How deep (m) into the rock a face counts (a barrel never reaches further). */
const DEPTH = 2;
/** Height (m, over the massif's base) a face counts up to: its top and the rolling cap above it. */
const CAP = 1.5;

/** No face near: one shared, frozen empty list (rockFacesNear's answer almost everywhere). */
export const NO_FACES = Object.freeze([]);

/**
 * The plumb faces of a mission's structures: every `abut` segment [a, b, set?] of a cliff, `a`/`b` world [x, z] points
 * on its `points` outline (the rock lies on the outline's inner side).
 * @param {object[]} defs structure defs (mission.structures)
 * @returns {object[]}
 */
export function rockFacesOf(defs) {
  const out = [];
  for (const d of defs || []) {
    if (d?.type !== 'cliff' || !d.abut?.length || !(d.points?.length >= 3)) continue;
    const P = d.points.map((q) => (Array.isArray(q) ? q : [q.x, q.z]));
    let area = 0;
    for (let i = 0; i < P.length; i++) { const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length]; area += ax * bz - bx * az; }
    // (buildCliff: CCW in (x, z) → the outward normal is (dz, -dx), the rock lies on the other side: (-dz, dx); CW the reverse)
    const k = area > 0 ? 1 : -1;
    for (const [a, b, set] of d.abut) {
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      if (!(len > 1e-6)) continue;
      const ux = dx / len, uz = dz / len;
      out.push({ id: d.id ?? null, ax: a[0], az: a[1], bx: b[0], bz: b[1], ux, uz, nx: -k * uz, nz: k * ux, len, set: set || 0, top: (d.h ?? 6) + CAP });
    }
  }
  return out;
}

/**
 * Faces within `reach` m of (x, z), from `world.rockFaces` — one shared empty list when none is (asked of every man
 * who aims; read-only).
 */
export function rockFacesNear(world, x, z, reach) {
  const F = world?.rockFaces;
  if (!F?.length) return NO_FACES;
  let out = NO_FACES;
  for (let i = 0; i < F.length; i++) {
    const f = F[i], t = Math.max(0, Math.min(f.len, (x - f.ax) * f.ux + (z - f.az) * f.uz));
    const dx = x - (f.ax + f.ux * t), dz = z - (f.az + f.uz * t);
    if (dx * dx + dz * dz > reach * reach) continue;
    if (out === NO_FACES) out = [];
    out.push(f);
  }
  return out;
}

/**
 * Is the point (x, z) at height `y` inside a face's rock, or within `margin` m of its face on the open side (along
 * the face and a hand's breadth past its ends)?
 */
export function inRockFace(faces, x, z, y = 0, margin = 0) {
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    if (y >= f.top) continue;
    const px = x - f.ax, pz = z - f.az, t = px * f.ux + pz * f.uz;
    if (t < -0.1 || t > f.len + 0.1) continue;
    const d = px * f.nx + pz * f.nz; // into the rock, from the outline
    if (d > f.set - margin && d < f.set + DEPTH) return true;
  }
  return false;
}
