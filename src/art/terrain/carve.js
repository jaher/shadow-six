/**
 * Dry terrain carves (M8 art pass): wadis, gullies and dry ditches cut into the heightfield, so a dry riverbed reads
 * as a real cut with eroded banks and the trestle over it stands on its bed instead of a painted brown floor.
 * Mission data: `carves: [{ id, points, depth, bank?, floor?, inset? }]` (map metres; the polygon is the outline of the
 * non-walkable cells, the cut's rim starts `inset` metres inside it, so no walkable cell's mesh vertex sinks).
 * The carve is visual only: the polygons are non-walkable (`ravine` cliffs) or bridged (the deck carries its own
 * walk height), so the nav grid never sees it. The same field feeds the map's terrain mesh and the apron past the
 * edge (an edge-crossing gully carries on out at the depth it had at the edge, apron.js).
 * @module art/terrain/carve
 */

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function inPoly(x, z, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function edgeDist(x, z, pts, open) {
  let d = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if (open && open[i]) continue; // an edge on the map boundary: the gully runs on past it, no bank
    const [ax, az] = pts[j], [bx, bz] = pts[i], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    d = Math.min(d, Math.hypot(x - ax - dx * u, z - az - dz * u));
  }
  return d;
}

/** Cheap deterministic value noise in [-1, 1] (banks and bed wobble). */
function wob(x, z, s) {
  const n = Math.sin(x * 0.71 * s + z * 0.29 * s) * 0.55 + Math.sin(x * 0.23 * s - z * 0.67 * s + 1.7) * 0.3 + Math.sin(x * 1.9 * s + z * 1.3 * s) * 0.15;
  return n;
}

/**
 * Build the carve field.
 * @param {{points:number[][], depth?:number, bank?:number, floor?:number, id?:string}[]} carves
 * @param {{W:number, D:number}} [map] map size: points outside it sample the edge (the gully runs on off-map)
 * @returns {{at:(x:number,z:number)=>number, key:string, carves:object[]}|null} at() <= 0 (m below the ground)
 */
export function carveField(carves, map = null) {
  const list = (carves || []).filter((c) => Array.isArray(c?.points) && c.points.length >= 3).map((c) => {
    const xs = c.points.map((p) => p[0]), zs = c.points.map((p) => p[1]);
    // edges lying on the map boundary (both ends on the same edge line) are open ends of the cut
    const on = (a, b) => map && ((a[0] <= 0.01 && b[0] <= 0.01) || (a[1] <= 0.01 && b[1] <= 0.01) || (a[0] >= map.W - 0.01 && b[0] >= map.W - 0.01) || (a[1] >= map.D - 0.01 && b[1] >= map.D - 0.01));
    const open = c.points.map((p, i) => on(c.points[(i + c.points.length - 1) % c.points.length], p));
    return { pts: c.points, open, depth: c.depth ?? 2.5, bank: c.bank ?? 1.6, floor: c.floor ?? 0.12, inset: c.inset ?? 0,
      box: [Math.min(...xs) - 0.5, Math.min(...zs) - 0.5, Math.max(...xs) + 0.5, Math.max(...zs) + 0.5] };
  });
  if (!list.length) return null;
  const one = (x, z) => {
    let y = 0;
    for (const c of list) {
      const [x0, z0, x1, z1] = c.box;
      if (x < x0 || x > x1 || z < z0 || z > z1 || !inPoly(x, z, c.pts)) continue;
      const e = edgeDist(x, z, c.pts, c.open) - c.inset; // the rim begins `inset` m inside the outline
      if (e <= 0) continue;
      // eroded bank: the cut's width wanders ±35 %, a little rim slump before the steep face, a gravel bed with bars
      const bank = c.bank * (1 + 0.35 * wob(x, z, 0.35));
      const t = ss(0.05, Math.max(0.4, bank), e);
      const bed = c.floor * wob(x, z, 0.9) + 0.06 * wob(z, x, 2.3);
      const d = -c.depth * (t * 0.92 + 0.08 * ss(0, 0.35, e)) + bed * t;
      if (d < y) y = d;
    }
    return y;
  };
  const at = map ? (x, z) => one(Math.min(map.W - 0.01, Math.max(0.01, x)), Math.min(map.D - 0.01, Math.max(0.01, z))) : one;
  const key = list.map((c) => `${c.depth}:${c.bank}:${c.floor}:${c.inset}:${c.pts.flat().join(',')}`).join('|');
  return { at, key, carves: list };
}

/** The mission's carve field (null when it has none). */
export function missionCarves(mission) {
  if (!mission?.carves?.length) return null;
  const [W, D] = mission.size || [0, 0];
  return carveField(mission.carves, W && D ? { W, D } : null);
}

/**
 * Splat painter for the carves (terrain-layers.js `paint` hook): eroded rock on the banks, a pale gravel bed with
 * darker sand runnels on the floor. `layers` = the theater palette's layer names.
 * @returns {((x:number, z:number, w:Float32Array|number[]) => void)|undefined}
 */
export function carvePainter(field, layers) {
  if (!field) return undefined;
  const L = (n) => layers.indexOf(n);
  const iRock = L('rock'), iGravel = L('gravel'), iSand2 = L('sand2'), iDirt = L('dirt');
  if (iRock < 0 || iGravel < 0) return undefined;
  const maxD = Math.max(...field.carves.map((c) => c.depth));
  const tgt = new Float32Array(layers.length);
  return (x, z, w) => {
    const d = -field.at(x, z);
    if (d < 0.05) return;
    const f = Math.min(1, d / maxD);
    const bank = Math.max(0, Math.min(1, f / 0.35)) * Math.max(0, Math.min(1, (0.93 - f) / 0.2)); // the steep face
    const bed = Math.max(0, Math.min(1, (f - 0.78) / 0.15));
    const runnel = 0.5 + 0.5 * Math.sin(x * 0.9 + Math.sin(z * 0.37) * 2.4 + z * 0.21);
    tgt.fill(0);
    tgt[iRock] = bank;
    tgt[iGravel] = bed * (0.75 - 0.35 * runnel) + (1 - bank - bed) * 0.4;
    if (iSand2 >= 0) tgt[iSand2] = bed * 0.35 * runnel + (1 - bank - bed) * 0.3;
    if (iDirt >= 0) tgt[iDirt] = (1 - bank - bed) * 0.3 + bank * 0.15;
    let s = 0; for (let k = 0; k < tgt.length; k++) s += tgt[k];
    const a = Math.min(1, d / 0.45);
    for (let k = 0; k < w.length; k++) w[k] = w[k] * (1 - a) + (s > 0 ? tgt[k] / s : 0) * a;
  };
}
