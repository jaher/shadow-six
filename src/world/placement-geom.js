/**
 * 2D (XZ plan) geometry for the placement rules (world/placement.js): polygons as [[x, z], …], circles, polylines.
 * Pure, no three.js — node-testable.
 * @module world/placement-geom
 */

/** Oriented rect (centre x, z; w along heading `rot`, d across) → 4 corners, inflated by `m` on every side. */
export function rectPoly(x, z, w, d, rot = 0, m = 0) {
  const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2 + m, hd = d / 2 + m;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [x + u * c - v * s, z + u * s + v * c]);
}

/** Circle → regular n-gon circumscribing it (so the polygon always contains the circle). */
export function circlePoly(x, z, r, n = 12) {
  const R = r / Math.cos(Math.PI / n), out = [];
  for (let k = 0; k < n; k++) { const a = (2 * Math.PI * k) / n; out.push([x + Math.cos(a) * R, z + Math.sin(a) * R]); }
  return out;
}

/** Even-odd point-in-polygon. */
export function inPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from (x, z) to segment a-b, and the closest point's parameter t. */
export function segDist(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)) : 0;
  return { d: Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z), t };
}

/** Signed distance from (x, z) to a polygon's boundary: negative inside. */
export function polyDist(x, z, pts) {
  let d = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) d = Math.min(d, segDist(x, z, pts[j], pts[i]).d);
  return inPoly(x, z, pts) ? -d : d;
}

/** Distance from (x, z) to a polyline. */
export function lineDist(x, z, pts) {
  let d = Infinity;
  for (let k = 0; k + 1 < pts.length; k++) d = Math.min(d, segDist(x, z, pts[k], pts[k + 1]).d);
  return pts.length === 1 ? Math.hypot(x - pts[0][0], z - pts[0][1]) : d;
}

/** Parameters t ∈ (0, 1) where segment a-b crosses the polygon's edges. */
function crossings(a, b, pts) {
  const out = [];
  const rx = b[0] - a[0], rz = b[1] - a[1];
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const p = pts[j], q = pts[i], sx = q[0] - p[0], sz = q[1] - p[1];
    const den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p[0] - a[0]) * sz - (p[1] - a[1]) * sx) / den, u = ((p[0] - a[0]) * rz - (p[1] - a[1]) * rx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) out.push(t);
  }
  return out;
}

/** Sub-intervals [t0, t1] of segment a-b lying inside the (simple, possibly concave) polygon. */
export function insideIntervals(a, b, pts) {
  const ts = [0, ...crossings(a, b, pts).sort((u, v) => u - v), 1];
  const out = [];
  for (let k = 0; k + 1 < ts.length; k++) {
    const t0 = ts[k], t1 = ts[k + 1];
    if (t1 - t0 < 1e-9) continue;
    const tm = (t0 + t1) / 2;
    if (!inPoly(a[0] + (b[0] - a[0]) * tm, a[1] + (b[1] - a[1]) * tm, pts)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - t0) < 1e-9) last[1] = t1; else out.push([t0, t1]);
  }
  return out;
}

/** Merge overlapping [t0, t1] intervals. */
export function mergeIntervals(list) {
  const s = list.slice().sort((u, v) => u[0] - v[0]), out = [];
  for (const iv of s) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], iv[1]); else out.push([...iv]);
  }
  return out;
}

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;

/**
 * Cut a polyline where it runs inside any of `polys`: returns the remaining runs (each ≥ 2 points and at least
 * `minLen` m long). A run that never enters a polygon comes back unchanged (same points).
 */
export function clipPolyline(points, polys, minLen = 0.3) {
  const runs = [];
  let cur = [points[0]];
  let cut = false;
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k], b = points[k + 1];
    const ivs = mergeIntervals((typeof polys === 'function' ? polys(a, b) : polys).flatMap((p) => insideIntervals(a, b, p)));
    let t = 0;
    for (const [t0, t1] of ivs) {
      cut = true;
      if (t0 > t) cur.push(lerp(a, b, t0));
      if (cur.length >= 2) runs.push(cur);
      cur = t1 < 1 ? [lerp(a, b, t1)] : [];
      t = t1;
    }
    if (t < 1) { if (!cur.length) cur = [lerp(a, b, t)]; cur.push(b); }
  }
  if (cur.length >= 2) runs.push(cur);
  if (!cut) return [points];
  const len = (r) => r.reduce((s, p, k) => (k ? s + Math.hypot(p[0] - r[k - 1][0], p[1] - r[k - 1][1]) : 0), 0);
  return runs.map((r) => r.filter((p, k) => !k || !same(p, r[k - 1]))).filter((r) => r.length >= 2 && len(r) >= minLen);
}

/**
 * Cut shape of solid `pts` for the segment a→b of a run of half-width `hw` whose drawn ends overhang its end points
 * by `cap`: the solid swept ±hw across the segment and ±cap along it (where the run's drawn body would overlap
 * it). Unlike a round `hw` inflation, a run whose ends are flush (cap 0: palisade stakes, fence posts) meets a gate
 * or post standing in line with it end-to-end instead of `hw` short. Non-convex shapes fall back to the round
 * inflation by max(hw, cap).
 */
export function sweepPoly(pts, a, b, hw, cap = 0) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  const area = Math.abs(polyArea(pts));
  if (L < 1e-9 || Math.abs(Math.abs(polyArea(convexHull(pts))) - area) > 1e-6 * Math.max(1, area)) return inflatePoly(pts, Math.max(hw, cap));
  const tx = dx / L, tz = dz / L, nx = -tz * hw, nz = tx * hw, cx = tx * cap, cz = tz * cap;
  return convexHull(pts.flatMap(([x, z]) => [[x + nx + cx, z + nz + cz], [x + nx - cx, z + nz - cz], [x - nx + cx, z - nz + cz], [x - nx - cx, z - nz - cz]]));
}

/** Polyline → capsule-ish polygon list (one oriented rect per segment, half-width `hw`). */
export function linePolys(points, hw) {
  const out = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-9) continue;
    out.push(rectPoly((ax + bx) / 2, (az + bz) / 2, L + 2 * hw, 2 * hw, Math.atan2(bz - az, bx - ax)));
  }
  return out;
}

/** Axis-aligned bounds of a polygon list: [x0, z0, x1, z1]. */
export function boundsOf(polys) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of polys) for (const [x, z] of p) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return [x0, z0, x1, z1];
}

/** Do two polygons overlap (area, not only touch)? Separating-axis for convex, edge-crossing + containment otherwise. */
export function polysOverlap(a, b) {
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) if (crossings(a[j], a[i], b).length) return true;
  return inPoly(a[0][0], a[0][1], b) || inPoly(b[0][0], b[0][1], a);
}

/** Signed area (positive = counter-clockwise in x/z). */
export function polyArea(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return s / 2;
}

/** Offset a (convex or mildly concave) polygon outwards by `m` metres (mitre joins, capped at 3 m). */
export function inflatePoly(pts, m) {
  if (!m) return pts.map((p) => [...p]);
  const n = pts.length, ccw = polyArea(pts) > 0 ? 1 : -1, out = [];
  const normal = (p, q) => { const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1; return [ccw * dz / L, -ccw * dx / L]; };
  for (let k = 0; k < n; k++) {
    const p = pts[(k + n - 1) % n], c = pts[k], q = pts[(k + 1) % n];
    const n1 = normal(p, c), n2 = normal(c, q);
    let bx = n1[0] + n2[0], bz = n1[1] + n2[1];
    const bl = Math.hypot(bx, bz);
    if (bl < 1e-9) { bx = n1[0]; bz = n1[1]; } else { bx /= bl; bz /= bl; }
    const cos = Math.max(0.33, bx * n1[0] + bz * n1[1]);
    out.push([c[0] + bx * m / cos, c[1] + bz * m / cos]);
  }
  return out;
}

/** Centroid (vertex average). */
export function centroidOf(pts) {
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

/** Convex hull (monotone chain) of a point set. */
export function convexHull(points) {
  const p = points.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let k = p.length - 1; k >= 0; k--) { const q = p[k]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
