/**
 * M20 layout audit (castle pass, user 2026-11-10: "Make sure all buildings are well located inside the castle and dont
 * intersect paths"): every building and large prop of the castle — the bailey's buildings, the chapel and the church, the
 * guardhouse, the sentry boxes, the parked vehicles, the V2 trailers, guns, wagons, sandbags, the range's pieces, the
 * occupation layer's ground props — against
 *  - its ward: inside the curtain ring (the castle) or outside the moat (the field: the gates' approaches, the forest
 *    edge), never over water, never straddling a wall, a gatehouse or the moat;
 *  - the walls: a believable lane between a building and a curtain's inner face (body ≥ 1.2 m, eaves ≥ 0.75 m) and
 *    off the gatehouses (≥ 0.6 m);
 *  - each other: no two overlap (eaves included);
 *  - every path, buffered by half its width: the roads and lanes (terrain paths), stairs, ladders and planks with their
 *    landings, the gate passages, the Panzer III's way out (its hull ± 0.15 m along the drive as recorded), and every
 *    ground patrol and walker route as authored (0.9 m wide);
 *  - doors: each opens onto open ground (not into a wall, a building or water).
 * A building's ground footprint is its body (walls, buttresses, annexes, steps): paths are tested against it; its eaves
 * may overhang a lane's edge (they are 1.9 m up and more). Intended joins are listed in LAYOUT_JOINS with their reason.
 * Used by tests/unit/m20-castle.test.mjs (the layout test) and commandos-shots/m20castle/tools/layout-audit.mjs (plots).
 */

/** Intended joins: [item, other (an item id, a wall id or a path id), reason]. Nothing else may touch. */
export const LAYOUT_JOINS = [
  ['blk_n', 'stairs S_n', 'the N stair tower houses the N range\'s stair: S_n climbs inside it'],
  ['h_w2', 'cw_sw', 'the smithy is built against the SW curtain: its W gable stands on the curtain\'s inner face (no verge over it)'],
  ['h_s3', 'h_tur', 'the steward\'s house and its round stair turret, built into its E gable: one building'],
];

/** The curtain's centre line round the castle (walls, gatehouses, the N range's back, the crag's faces), closed. */
export const RING = [[33, 91], [52.3, 110.3], [57, 114], [61.5, 117.5], [99, 128], [112, 117.8], [116, 114], [119.8, 110.3], [139, 97], [139, 83.6], [139, 50], [134, 46], [106, 20.2], [108, 14], [38, 14], [40, 10], [4, 10], [4, 78.5], [22, 79.5], [22, 91]];

/** The Panzer III's way out as the game drives it (the solution's run, simplified to 0.25 m): its hull 2.9 m wide. */
export const TANK_WAY = [[83, 37], [79.7, 38.6], [75.7, 39.2], [73.5, 40.7], [72.1, 47.8], [71.8, 56.2], [72.0, 73.0], [73.5, 80.0], [73.8, 88.2], [73.0, 89.3], [66.8, 94.1], [67.2, 100.2], [67.2, 102.8], [66.8, 103.8], [59.4, 107.2], [63.0, 106.2], [62.6, 107.4], [59.7, 107.3], [58.1, 106.6], [58.4, 107.8], [53.6, 127.2], [50.7, 134.3], [48.2, 135.6], [45.1, 135.4], [31.8, 142.1], [16.1, 147.5], [9.3, 151.1]];
export const TANK_HALF = 1.45 + 0.15;

/** Items standing outside the castle (the field) on purpose. */
const FIELD = /^(logs_ne\d|gbox_sw|gbox_se|kr_|cw_s[ew]_)/;

// ---------------------------------------------------------------- geometry
export const rect = (x, z, w, d, rot = 0) => { const c = Math.cos(rot), s = Math.sin(rot); return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [x + u * c - v * s, z + u * s + v * c]); };
const frameRect = (s, u0, u1, w0, w1) => { const c = Math.cos(s.rot ?? 0), n = Math.sin(s.rot ?? 0); return [[u0, w0], [u1, w0], [u1, w1], [u0, w1]].map(([u, w]) => [s.x + u * c - w * n, s.z + u * n + w * c]); };
const circle = (x, z, r, k = 16) => Array.from({ length: k }, (_, i) => [x + r * Math.cos((i / k) * 2 * Math.PI), z + r * Math.sin((i / k) * 2 * Math.PI)]);
export const inPoly = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, zi] = p[i], [xj, zj] = p[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
export const segD = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)); return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz); };
const polyD = (x, z, p) => { let d = Infinity; for (let i = 0; i < p.length; i++) d = Math.min(d, segD(x, z, p[i], p[(i + 1) % p.length])); return inPoly(x, z, p) ? -d : d; };
export const band = (pts, w) => pts.slice(0, -1).map((p, k) => { const q = pts[k + 1]; return rect((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, Math.hypot(q[0] - p[0], q[1] - p[1]), w, Math.atan2(q[1] - p[1], q[0] - p[0])); });
/** Sample points inside polygons (every `st` m) and along their outlines. */
function samples(polys, st = 0.2) {
  const out = [];
  for (const p of polys) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of p) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    for (let x = x0 + st / 2; x < x1; x += st) for (let z = z0 + st / 2; z < z1; z += st) if (inPoly(x, z, p)) out.push([x, z]);
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-9) { out.push([a[0], a[1]]); continue; } // (a repeated vertex)
      for (let t = 0; t <= L; t += st) out.push([a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L]);
    }
  }
  return out;
}
const inAny = (x, z, polys) => polys.some((q) => inPoly(x, z, q));
const bboxOf = (polys) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const p of polys) for (const [x, z] of p) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); } return [x0, z0, x1, z1]; };
const boxesMeet = (a, b, pad = 0) => a[0] - pad <= b[2] && b[0] - pad <= a[2] && a[1] - pad <= b[3] && b[1] - pad <= a[3];

// ---------------------------------------------------------------- the audit
/**
 * @param {object} m the mission (getMission('m20'))
 * @param {{BAILEY_PLAN: object, churchFootprint: Function, occupationFootprints: Function}} art
 * @param {{joins?: Array}} [o] the intended joins (default LAYOUT_JOINS; [] shows every contact)
 * @returns {{items: object[], paths: object[], ring: number[][], walls: object[], gates: object[], water: number[][][]}}
 */
export function auditLayout(m, art, { joins = LAYOUT_JOINS } = {}) {
  const ST = 0.2, A = ST * ST;
  const walls = m.structures.filter((s) => s.type === 'castle_wall' && s.points).map((s) => ({ id: s.id, pts: s.points, half: (s.width ?? 4) / 2 }));
  const gates = m.structures.filter((s) => s.type === 'castle_gate').map((s) => ({ id: s.id, poly: rect(s.x, s.z, s.w, s.d, s.rot ?? 0), s }));
  // gate passages: the arch through each gatehouse (inner gate: w/3; twin-tower gates 4.5 m), 2 m beyond each face
  const passages = gates.map(({ s }) => { const half = /inner/.test(s.variant) ? s.w / 6 : 2.25; return { id: `${s.id} passage`, poly: frameRect(s, -half, half, -s.d / 2 - 2, s.d / 2 + 2) }; });
  const water = m.terrain.filter((t) => t.terrain === 'water');
  const wet = (x, z) => water.some((t) => (t.type === 'poly' && inPoly(x, z, t.points)) || (t.type === 'path' && band(t.points, t.width).some((p) => inPoly(x, z, p))) || (t.type === 'rect' && x >= t.x && x <= t.x + t.w && z >= t.z && z <= t.z + t.d) || (t.type === 'circle' && Math.hypot(x - t.x, z - t.z) <= t.r));

  // ---- paths
  const paths = [];
  for (const t of m.terrain.filter((q) => q.type === 'path' && q.terrain === 'road')) paths.push({ id: `road ${t.points[0].join(',')}`, kind: 'road', polys: band(t.points, t.width), line: t.points, half: t.width / 2 });
  for (const l of m.ladders || []) {
    const a = [l.x, l.z], b = [l.top[0], l.top[1]], w = l.kind === 'stairs' ? 2.0 : l.kind === 'plank' ? 1.6 : 1.0;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, e = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    paths.push({ id: `${l.kind ?? 'ladder'} ${l.id}`, kind: 'link', polys: band([[a[0] - e[0] * 1.5, a[1] - e[1] * 1.5], [b[0] + e[0] * 1.5, b[1] + e[1] * 1.5]], w), line: [a, b], half: w / 2 });
  }
  for (const p of passages) paths.push({ id: p.id, kind: 'gate', polys: [p.poly] });
  paths.push({ id: 'the Panzer III\'s way out', kind: 'tank', polys: band(TANK_WAY, TANK_HALF * 2), line: TANK_WAY, half: TANK_HALF });
  for (const e of m.enemies.filter((q) => q.route?.points?.length >= 2)) {
    if ((e.y ?? 0) > 0.5) continue; // (wall walks and terraces: their routes run along masonry, not the ground's ways)
    if (e.squad && e.squad.leader !== e.id) continue;
    const pts = e.route.points.map((p) => [p.x, p.z]);
    if (e.route.type === 'LOOP') pts.push(pts[0]);
    paths.push({ id: `route ${e.id}`, kind: 'route', polys: band(pts, 0.9), line: pts, half: 0.45 });
  }
  for (const p of paths) p.box = bboxOf(p.polys);

  // ---- the items
  const plan = art.BAILEY_PLAN, items = [];
  for (const s of m.structures) {
    const t = s.type, v = s.variant || '';
    // (raised props stand on their level, off the ground's ways; the church and the stair block on the NE terrace are
    // buildings there: audited with its stairs' feet and heads)
    if ((s.baseY > 0 && !/^(church|blk_ne)$/.test(s.id)) || /^(cliff|castle_wall|castle_gate|pine|rocks|bridge|water_gate|lever|searchlight|lamp_post|telegraph_pole|sign)$/.test(t)) continue;
    if (/^(bartizan_s|turret|n_range|hq|hq_wing)$/.test(s.id)) continue; // (the castle's own masonry)
    const big = /^(house|hut|barracks|v2_rocket|train_car|aa_gun|flak|firing_range|well|watchtower)$/.test(t) || (t === 'crates' && (s.w ?? 0) * (s.d ?? 0) >= 2)
      || t === 'sandbags' || (t === 'fence' && /bullet_stop/.test(v));
    if (!big) continue;
    let fp;
    if (s.points) fp = band(s.points, s.width ?? 0.8);
    else if (s.w != null && s.d != null) fp = [rect(s.x, s.z, s.w, s.d, s.rot ?? 0)];
    else if (s.r != null) fp = [circle(s.x, s.z, s.r)];
    if (!fp) continue;
    const p = plan[s.id];
    let body = fp, drawn = fp, doors = [], kind = t;
    if (p) {
      const u1 = Math.max(p.u1, p.annex ?? -Infinity), oh = p.oh ?? (p.kind === 'chapel' ? 0.3 : 0.45);
      body = [frameRect(s, p.u0, u1, p.w0, p.w1)];
      if (p.buttress) body.push(frameRect(s, p.buttress[0], p.buttress[1], p.w0 - p.buttress[2], p.w1 + p.buttress[2]));
      drawn = [frameRect(s, p.u0 - (p.wallEnd === 'W' ? 0 : oh), u1 + (p.wallEnd === 'E' ? 0 : oh), p.w0 - oh, p.w1 + oh), ...body.slice(1)];
      doors = (p.doors || []).map(([f, u]) => { const w = f === 'S' ? p.w1 + 1.5 : p.w0 - 1.5, c = Math.cos(s.rot ?? 0), n = Math.sin(s.rot ?? 0); return [s.x + u * c - w * n, s.z + u * n + w * c]; });
      kind = p.kind;
    } else if (s.id === 'church') {
      body = art.churchFootprint(s).map((f) => f.poly);
      drawn = body;
      kind = 'church';
      // its W portal: down the steps onto its lane
      const st = art.churchFootprint(s).find((f) => f.id === 'steps').poly;
      doors = [[(st[0][0] + st[3][0]) / 2 + (st[0][0] - st[1][0]) * 1.2, (st[0][1] + st[3][1]) / 2 + (st[0][1] - st[1][1]) * 1.2]];
    }
    items.push({ id: s.id, kind, label: s.label || v, fp, body, drawn, doors, ward: FIELD.test(s.id) ? 'field' : 'castle', ye: p?.ye });
  }
  for (const o of art.occupationFootprints(m)) items.push({ id: o.id, kind: o.kind, label: o.kind, fp: [o.poly], body: [o.poly], drawn: [o.poly], doors: [], ward: FIELD.test(o.id) ? 'field' : 'castle' });
  for (const it of items) { it.box = bboxOf(it.drawn); it.pts = samples(it.body, ST); it.dpts = samples(it.drawn, ST); }

  // ---- checks
  const joined = (a, b) => joins.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const wallFace = (x, z, W) => { let d = Infinity; for (let k = 0; k + 1 < W.pts.length; k++) d = Math.min(d, segD(x, z, W.pts[k], W.pts[k + 1])); return d - W.half; };
  for (const it of items) {
    const issues = [];
    const add = (check, other, area, detail) => { if (other && joined(it.id, other)) return; issues.push({ check, other, area, detail }); };
    // 1. the ward
    const outside = it.pts.filter(([x, z]) => !inPoly(x, z, RING)).length, inside = it.pts.length - outside;
    if (it.ward === 'castle' && outside) add('ward', null, outside * A, `${(outside * A).toFixed(1)} m² outside the curtain ring`);
    if (it.ward === 'field' && inside) add('ward', null, inside * A, `${(inside * A).toFixed(1)} m² inside the curtain ring (a field piece)`);
    const wetN = it.pts.filter(([x, z]) => wet(x, z)).length;
    if (wetN) add('moat', null, wetN * A, `${(wetN * A).toFixed(1)} m² over water`);
    // 2. the walls and the gatehouses
    for (const W of walls) {
      const body = Math.min(...it.pts.map(([x, z]) => wallFace(x, z, W))), eaves = Math.min(...it.dpts.map(([x, z]) => wallFace(x, z, W)));
      if (body < 1.2 || eaves < 0.75) add('setback', W.id, 0, `${body.toFixed(2)} m (eaves ${eaves.toFixed(2)} m) from ${W.id}'s face (lane ≥ 1.2 m, eaves ≥ 0.75 m)`);
    }
    for (const g of gates) {
      if (!boxesMeet(it.box, bboxOf([g.poly]), 1)) continue;
      const d = Math.min(...it.dpts.map(([x, z]) => polyD(x, z, g.poly)));
      if (d < 0.6) add('gatehouse', g.id, 0, `${d.toFixed(2)} m from ${g.id}`);
    }
    // 3. the other items (eaves included)
    for (const o of items) {
      if (o === it || !boxesMeet(it.box, o.box)) continue;
      const n = it.dpts.filter(([x, z]) => inAny(x, z, o.drawn)).length;
      if (n * A > 0.05) add('overlap', o.id, n * A, `${(n * A).toFixed(2)} m² with ${o.id}`);
    }
    // 4. the paths (the body: the ground footprint)
    for (const pa of paths) {
      if (!boxesMeet(it.box, pa.box)) continue;
      const n = it.pts.filter(([x, z]) => inAny(x, z, pa.polys)).length;
      if (n * A > 0.05) add(pa.kind, pa.id, n * A, `${(n * A).toFixed(2)} m² of ${pa.id}`);
    }
    // 5. doors onto open ground
    for (const [dx, dz] of it.doors) {
      const blocked = items.some((o) => o !== it && inAny(dx, dz, o.body)) || wet(dx, dz) || walls.some((W) => wallFace(dx, dz, W) < 0) || !inPoly(dx, dz, RING);
      if (blocked) add('door', null, 0, `door at (${dx.toFixed(1)}, ${dz.toFixed(1)}) opens onto no lane`);
    }
    it.issues = issues;
  }
  return {
    items: items.map(({ id, kind, label, fp, body, drawn, doors, ward, issues }) => ({ id, kind, label, fp, body, drawn, doors, ward, issues })),
    paths: paths.map(({ id, kind, polys }) => ({ id, kind, polys })), ring: RING, walls, gates: gates.map((g) => ({ id: g.id, poly: g.poly })),
    water: water.map((t) => (t.type === 'poly' ? [t.points] : t.type === 'path' ? band(t.points, t.width) : t.type === 'rect' ? [[[t.x, t.z], [t.x + t.w, t.z], [t.x + t.w, t.z + t.d], [t.x, t.z + t.d]]] : [circle(t.x, t.z, t.r)])),
  };
}
