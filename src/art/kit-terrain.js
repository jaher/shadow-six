/**
 * Placeholder-art pass: ground-level kit pieces with the shared PBR texture library (art/dressing.js sets) where the
 * audit (tools/audit/placeholder-audit.mjs) found flat-colour slabs —
 *   - railway track (`rail_track`): ballast bed, creosoted sleepers, steel rails (rusty sidings browner)
 *   - trench (`trench`): dug-out floor, earth parapets either side, a few sandbags and revetment stakes
 *   - shell crater (`crater`): scorched floor, thrown-up earth rim, clods and stones
 *   - mission terrain (M8 plateau, M10 shelf, M11 levels, M14 dunes): escarpment prisms with rock sides and a
 *     sand / gravel top, sloped ramps with a gravel track, wadi beds — replacing the flat-colour meshes of the
 *     mission scripts (same shapes and heights: the walk surfaces are unchanged)
 * World-scale UVs everywhere (tile metres per texture repeat). Plain colours in node (unit tests).
 * @module art/kit-terrain
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { dressingMaterial, boxUV, consolidate, rng, seedOf, boulderGeometry } from './dressing.js';
import { paintedMaterial, iceFloe, snowCrustMaterial } from './kit-props.js';

function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}
/** Scale a geometry's existing uv attribute (metres → repeats). */
function scaleUV(geo, k) {
  const uv = geo.attributes.uv;
  if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
  return geo;
}
const pts2 = (points) => points.map((p) => (Array.isArray(p) ? p : [p.x, p.z]));

// ------------------------------------------------------------------------------------------ railway track

/**
 * Track along a polyline (world points; the returned group is in world coords at y = 0): ballast trapezoid, sleepers
 * every 0.65 m, two rails at standard gauge. `rusty` sidings: browner rails, sparser ballast.
 */
export function buildRailTrack(points, { width = 2.4, rusty = false } = {}) {
  const raw = pts2(points), cp = [];
  for (const q of raw) if (!cp.length || Math.hypot(q[0] - cp[cp.length - 1][0], q[1] - cp[cp.length - 1][1]) > 1e-6) cp.push(q);
  const g = new THREE.Group(); g.name = 'kit:rail_track';
  if (cp.length < 2) return g;
  const gauge = 1.435, top = 0.03, bw = Math.max(2.6, width + 0.6);   // low bed: rail heads at 0.16 m
  // Interpolating centripetal Catmull-Rom through every centreline point, resampled by arc length.
  // A 0.18 m chord keeps even the tight junction curve faceting below screenshot visibility.
  const curve = new THREE.CatmullRomCurve3(cp.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const L = curve.getLength(); if (!(L > 1e-3)) return g;
  const divisions = Math.max(16, Math.ceil(L / 0.18)), samples = curve.getSpacedPoints(divisions);
  const frames = samples.map((v, i) => {
    const a = samples[Math.max(0, i - 1)], b = samples[Math.min(samples.length - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z; const m = Math.hypot(tx, tz) || 1; tx /= m; tz /= m;
    return { x: v.x, z: v.z, tx, tz };
  });
  // Short tangent extensions weld adjoining track ribbons through shared joints instead of butt gaps.
  const joint = 0.38, first = frames[0], last = frames[frames.length - 1];
  const ribbonFrames = [{ x: first.x - first.tx * joint, z: first.z - first.tz * joint, tx: first.tx, tz: first.tz },
    ...frames, { x: last.x + last.tx * joint, z: last.z + last.tz * joint, tx: last.tx, tz: last.tz }];
  const ribbon = (profile) => {
    const pos = [], uv = [];
    const vert = (f, a, y) => [f.x + f.tz * a, y, f.z - f.tx * a];
    for (let i = 0; i + 1 < ribbonFrames.length; i++) for (let j = 0; j + 1 < profile.length; j++) {
      const A = vert(ribbonFrames[i], profile[j][0], profile[j][1]), B = vert(ribbonFrames[i], profile[j + 1][0], profile[j + 1][1]);
      const C = vert(ribbonFrames[i + 1], profile[j + 1][0], profile[j + 1][1]), D = vert(ribbonFrames[i + 1], profile[j][0], profile[j][1]);
      for (const v of [A, D, C, A, C, B]) { pos.push(...v); uv.push(0, 0); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    return geo;
  };
  const bal = [boxUV(ribbon([[-bw / 2, 0], [-bw / 2 + 0.3, top], [bw / 2 - 0.3, top], [bw / 2, 0]]), 1.6)], sl = [], rl = [];
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s1 = new THREE.Vector3(1, 1, 1);
  for (let d = 0.3; d < L; d += 0.65) {
    const u = Math.min(1, d / L), pt = curve.getPointAt(u), tn = curve.getTangentAt(u);
    q.setFromAxisAngle(up, -Math.atan2(tn.z, tn.x));
    const geo = new THREE.BoxGeometry(0.24, 0.08, 2.5).toNonIndexed();
    geo.applyMatrix4(M.compose(new THREE.Vector3(pt.x, 0.04, pt.z), q, s1));
    sl.push(boxUV(geo, 0.8));
  }
  for (const s of [-1, 1]) {
    const oc = s * gauge / 2;
    for (const [w, y0, y1] of [[0.12, 0.08, 0.096], [0.03, 0.096, 0.141], [0.065, 0.135, 0.16]])
      rl.push(boxUV(ribbon([[oc - w / 2, y0], [oc - w / 2, y1], [oc + w / 2, y1], [oc + w / 2, y0]]), 1.2));
  }
  const strip = (list) => { for (const q2 of list) for (const a of Object.keys(q2.attributes)) if (!['position', 'normal', 'uv'].includes(a)) q2.deleteAttribute(a); return mergeGeometries(list, false); };
  if (bal.length) g.add(mesh(strip(bal), rusty ? dressingMaterial('gravel') : dressingMaterial('ballast'), false));
  if (sl.length) g.add(mesh(strip(sl), dressingMaterial('creosote')));
  if (rl.length) g.add(mesh(strip(rl), rusty ? paintedMaterial('steel', 0x6b4a36) : paintedMaterial('castIron', 0x8a8780)));
  return g;
}

// ------------------------------------------------------------------------------------------ trench

/** Trench along a polyline (world coords): dark dug floor, earth parapets both sides, sandbags, revetment stakes. */
export function buildTrench(points, { width = 1.6, theater = 'temperate', id = 'trench', ruined = false } = {}) {
  const pts = pts2(points), g = new THREE.Group(); g.name = 'kit:trench';
  const R = rng(seedOf(id)), earth = theater === 'desert' ? 'sand' : theater === 'snow' ? 'mud' : 'mud';
  const floor = [], berm = [], stakes = [];
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s1 = new THREE.Vector3(1, 1, 1);
  const bags = [];
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-3) continue;
    const yaw = -Math.atan2(bz - az, bx - ax), mx = (ax + bx) / 2, mz = (az + bz) / 2;
    q.setFromAxisAngle(up, yaw);
    const place = (geo, lx, ly, lz, rx = 0) => { if (rx) geo.rotateX(rx); return geo.applyMatrix4(M.compose(new THREE.Vector3(mx, 0, mz).add(new THREE.Vector3(lx, ly, lz).applyQuaternion(q)), q, s1)); };
    floor.push(boxUV(place(new THREE.BoxGeometry(L + width * 0.5, 0.04, width).toNonIndexed(), 0, 0.02, 0), 1.5));
    for (const s of [-1, 1]) {
      // parapet: a low rounded earth mound outside the walkable width (spoil thrown up from the dig)
      const shape = new THREE.Shape([new THREE.Vector2(-0.55, 0), new THREE.Vector2(0.55, 0), new THREE.Vector2(0.2, ruined ? 0.22 : 0.34), new THREE.Vector2(-0.25, ruined ? 0.25 : 0.38)]);
      const pr = new THREE.ExtrudeGeometry(shape, { depth: L + 0.4, bevelEnabled: false, curveSegments: 1 });
      pr.translate(0, 0, -(L + 0.4) / 2); pr.rotateY(Math.PI / 2);
      berm.push(boxUV(place(pr, 0, 0, s * (width / 2 + 0.55)), 1.5));
      for (let t = 0.4; t < L; t += 1.1 + R() * 0.5) if (R() < (ruined ? 0.35 : 0.7)) stakes.push(boxUV(place(new THREE.BoxGeometry(0.07, 0.55, 0.07).toNonIndexed(), -L / 2 + t, 0.2, s * (width / 2 + 0.05)), 0.6));
      if (s > 0) for (let t = 0.3; t < L; t += 0.6) if (R() < (ruined ? 0.3 : 0.6)) bags.push([mx, mz, yaw, -L / 2 + t, width / 2 + 0.25]);
    }
  }
  const strip = (list) => { for (const q2 of list) for (const a of Object.keys(q2.attributes)) if (!['position', 'normal', 'uv'].includes(a)) q2.deleteAttribute(a); return mergeGeometries(list, false); };
  if (floor.length) g.add(mesh(strip(floor), paintedMaterial(earth, 0x8a7a68), false));
  if (berm.length) g.add(mesh(strip(berm), dressingMaterial(earth)));
  if (stakes.length) g.add(mesh(strip(stakes), dressingMaterial('beam')));
  if (bags.length) {
    const bag = new THREE.SphereGeometry(0.5, 10, 6); const P = bag.attributes.position;
    for (let i = 0; i < P.count; i++) P.setXYZ(i, P.getX(i) * 0.58, Math.max(-0.075, Math.min(0.075, P.getY(i) * 0.2)), P.getZ(i) * 0.34);
    bag.computeVertexNormals();
    const inst = new THREE.InstancedMesh(bag, dressingMaterial('burlap'), bags.length * 2);
    let n = 0;
    for (const [mx, mz, yaw, lx, lz] of bags) for (let c = 0; c < 2; c++) {
      const c0 = Math.cos(yaw), s0 = Math.sin(yaw);
      const x = mx + lx * c0 + lz * s0, z = mz - lx * s0 + lz * c0;
      q.setFromAxisAngle(up, yaw + (R() - 0.5) * 0.3);
      inst.setMatrixAt(n++, M.compose(new THREE.Vector3(x, 0.32 + c * 0.14, z), q, s1));
    }
    inst.castShadow = inst.receiveShadow = true; inst.computeBoundingSphere();
    g.add(inst);
  }
  return g;
}

// ------------------------------------------------------------------------------------------ crater

/** Shell / bomb crater (local frame): scorched floor, a thrown-up earth rim, clods and stones. */
export function buildCraterKit(p, theater = 'temperate') {
  const r = p.r ?? 3, g = new THREE.Group(); g.name = 'kit:crater';
  const R = rng(seedOf(p.id ?? `${p.x},${p.z}`)), rocky = /rock/.test(String(p.variant || ''));
  const earth = theater === 'desert' ? 'sand' : 'mud';
  const prof = [[r * 0.05, 0.03], [r * 0.5, 0.05], [r * 0.72, 0.16], [r * 0.86, 0.32], [r * 0.95, 0.3], [r * 1.08, 0.12], [r * 1.25, 0.0]];
  const geo = new THREE.LatheGeometry(prof.map(([a, y]) => new THREE.Vector2(a, y)), 36, 0, Math.PI * 2);
  const P = geo.attributes.position;
  for (let i = 0; i < P.count; i++) { // ragged rim: radial + height noise
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), a = Math.atan2(z, x), n = 1 + 0.08 * Math.sin(a * 5 + 1.3) + 0.05 * Math.sin(a * 11 + 0.4);
    P.setXYZ(i, x * n, y * (0.8 + 0.4 * (0.5 + 0.5 * Math.sin(a * 7 + 2.1))), z * n);
  }
  geo.computeVertexNormals();
  // scorched floor fading out to the thrown-up rim: per-vertex darkening by distance from the centre
  const flat = boxUV(geo.toNonIndexed(), 1.8), FP = flat.attributes.position, col = new Float32Array(FP.count * 3);
  for (let i = 0; i < FP.count; i++) {
    const t = Math.min(1, Math.hypot(FP.getX(i), FP.getZ(i)) / (r * 0.95)), k = 0.42 + 0.58 * t * t;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const bowl = mesh(flat, craterMaterial(earth), false); // added after consolidate (it keeps its colour attribute)
  const n = Math.round(r * (rocky ? 6 : 3));
  for (let k = 0; k < n; k++) {
    const s = 0.1 + R() * (rocky ? 0.35 : 0.18), a = R() * 6.28, d = r * (0.8 + R() * 0.7);
    const b = mesh(boulderGeometry(s, s * 0.6, s * 0.8, Math.floor(R() * 1e9), 2), dressingMaterial(rocky ? 'rockDark' : earth));
    b.position.set(Math.cos(a) * d, 0.02, Math.sin(a) * d); b.rotation.y = R() * 6.3;
    g.add(b);
  }
  consolidate(g);
  g.add(bowl);
  return g;
}

const CRATER_MATS = new Map();
function craterMaterial(set) {
  if (!CRATER_MATS.has(set)) { const m = dressingMaterial(set).clone(); m.vertexColors = true; m.name = `kit:crater:${set}`; CRATER_MATS.set(set, m); }
  return CRATER_MATS.get(set);
}

// ------------------------------------------------------------------------------------------ mission terrain

/** Escarpment / plateau prism of polygon `points` (world x, z), top at y0 + h: rock / sandstone sides, sand top. */
export function terrainPrism(points, h, { y0 = 0, top = 'sand', side = 'sandstone', tile = 3 } = {}) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  geo.rotateX(Math.PI / 2); // shape (x, z) → world (x, ·, z); extrusion along −y
  geo.translate(0, y0 + h, 0);
  scaleUV(geo, 1 / tile);
  const m = new THREE.Mesh(geo, [dressingMaterial(top), dressingMaterial(side)]);
  m.castShadow = true; m.receiveShadow = true; m.name = 'kit:terrain_prism';
  return m;
}

/** Sloped ramp a → b ([x, z, y]), `width` wide: a gravel track on top, an earth / rock wedge under it to the ground. */
export function terrainRamp(a, b, width, { top = 'gravel', side = 'sandstone' } = {}) {
  const [ax, az, ay] = a, [bx, bz, by] = b;
  const len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len * (width / 2), nz = (bx - ax) / len * (width / 2);
  const lift = 0.03;   // over the ground / escarpment top it meets (no z-fighting)
  const T = [[ax + nx, ay + lift, az + nz], [ax - nx, ay + lift, az - nz], [bx - nx, by + lift, bz - nz], [bx + nx, by + lift, bz + nz]];
  const pos = [], uv = [];
  const quad = (p0, p1, p2, p3, uvs) => { for (const [i, p] of [[0, p0], [1, p1], [2, p2], [0, p0], [2, p2], [3, p3]]) { pos.push(...p); uv.push(...uvs[i]); } };
  const tile = 2.5, W = width / tile, Lt = len / tile;
  quad(T[0], T[1], T[2], T[3], [[0, 0], [W, 0], [W, Lt], [0, Lt]]);
  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  topGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  topGeo.computeVertexNormals();
  const g = new THREE.Group(); g.name = 'kit:ramp';
  const tm = new THREE.Mesh(topGeo, dressingMaterial(top)); tm.receiveShadow = true; g.add(tm);
  // side walls down to the ground (the low end is open: it meets the ground)
  const sp = [], su = [];
  const wall = (p, q2) => {
    const L = Math.hypot(q2[0] - p[0], q2[2] - p[2]) / tile;
    for (const [v, w2] of [[[p[0], 0, p[2]], [0, 0]], [[q2[0], 0, q2[2]], [L, 0]], [q2, [L, q2[1] / tile]], [[p[0], 0, p[2]], [0, 0]], [q2, [L, q2[1] / tile]], [p, [0, p[1] / tile]]]) { sp.push(...v); su.push(...w2); }
  };
  wall(T[1], T[2]); wall(T[3], T[0]);
  if (Math.max(ay, by) > 0.05) wall(ay > by ? T[0] : T[2], ay > by ? T[1] : T[3]);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
  sg.computeVertexNormals();
  const sm2 = new THREE.Mesh(sg, sideDouble(side)); sm2.castShadow = true; sm2.receiveShadow = true;
  g.add(sm2);
  return g;
}
/**
 * A chain of joined ramps (each `{a:[x,z,y], b:[x,z,y], width}`, `b` of one = `a` of the next, e.g. M11's switchback up
 * the escarpment) as ONE road: mitred edges at every bend, a landing at each joint wide enough for the joint pads
 * (`pads`: the walkways' `{a, b, width, y}` rectangles round the outer corner), and dry-stone retaining walls with a
 * slight batter down to the ground along both sides — no slabs crossing each other at the joints. The low end is
 * open (it meets the ground), the high end is closed.
 */
export function terrainRampChain(ramps, { top = 'gravel', side = 'fieldstone', pads = [], tile = 2.5, batter = 0.12 } = {}) {
  const n = ramps.length, P = [ramps[0].a, ...ramps.map((r) => r.b)];
  const dirs = ramps.map((r) => { const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; });
  const L = [], R = [];                      // left / right edge outlines (x, z, y), joints may add landing points
  const nrm = (d) => [-d[1], d[0]];           // left normal
  for (let k = 0; k <= n; k++) {
    const y = P[k][2] + 0.03, hw = (ramps[Math.min(k, n - 1)].width) / 2;
    if (k === 0 || k === n) {
      const d = dirs[k === 0 ? 0 : n - 1], q = nrm(d);
      L.push([P[k][0] + q[0] * hw, P[k][1] + q[1] * hw, y]); R.push([P[k][0] - q[0] * hw, P[k][1] - q[1] * hw, y]);
      continue;
    }
    const d1 = dirs[k - 1], d2 = dirs[k], n1 = nrm(d1), n2 = nrm(d2);
    const m = [n1[0] + n2[0], n1[1] + n2[1]], ml = Math.hypot(m[0], m[1]) || 1, mu = [m[0] / ml, m[1] / ml];
    const cosh = Math.max(0.45, mu[0] * n1[0] + mu[1] * n1[1]), reach = hw / cosh;
    const turnLeft = d1[0] * d2[1] - d1[1] * d2[0] > 0;   // inner side = the side the road turns to
    const inner = [P[k][0] + (turnLeft ? 1 : -1) * mu[0] * reach, P[k][1] + (turnLeft ? 1 : -1) * mu[1] * reach, y];
    // outer side: the two edge ends and, between them, a landing out to the joint pad
    const s = turnLeft ? -1 : 1, e1 = [P[k][0] + s * n1[0] * hw, P[k][1] + s * n1[1] * hw, y], e2 = [P[k][0] + s * n2[0] * hw, P[k][1] + s * n2[1] * hw, y];
    const pad = pads.find((q) => Math.hypot(q.a[0] - P[k][0], q.a[1] - P[k][1]) < hw + 1);
    let outer = [e1, [P[k][0] + s * mu[0] * reach, P[k][1] + s * mu[1] * reach, y], e2];
    if (pad) {
      const px = pad.b[0] - P[k][0], pz = pad.b[1] - P[k][1], pl = Math.hypot(px, pz) || 1, ux = px / pl, uz = pz / pl, w2 = pad.width / 2 + 0.15;
      const far = pl + 0.15, c1 = [P[k][0] + ux * far - uz * w2, P[k][1] + uz * far + ux * w2, y], c2 = [P[k][0] + ux * far + uz * w2, P[k][1] + uz * far - ux * w2, y];
      const near = (c) => Math.hypot(c[0] - e1[0], c[1] - e1[1]);
      outer = near(c1) < near(c2) ? [e1, c1, c2, e2] : [e1, c2, c1, e2];
    }
    if (turnLeft) { L.push(inner); R.push(...outer); } else { R.push(inner); L.push(...outer); }
  }
  // top: fan each section between consecutive left / right outline points (the outlines advance together)
  const pos = [], uv = [], add = (p) => { pos.push(p[0], p[2], p[1]); uv.push(p[0] / tile, p[1] / tile); };
  const triUp = (a, b, c) => { const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); if (cr > 0) { add(a); add(c); add(b); } else { add(a); add(b); add(c); } };
  let i = 0, j = 0;
  // walk both outlines by accumulated length fraction (robust for the extra landing points)
  const cum = (A) => { const c = [0]; for (let k = 1; k < A.length; k++) c.push(c[k - 1] + Math.hypot(A[k][0] - A[k - 1][0], A[k][1] - A[k - 1][1])); const T = c[c.length - 1] || 1; return c.map((v) => v / T); };
  const cl = cum(L), cr = cum(R);
  while (i < L.length - 1 || j < R.length - 1) {
    if (j >= R.length - 1 || (i < L.length - 1 && cl[i + 1] <= cr[j + 1])) { triUp(L[i], L[i + 1], R[j]); i++; } else { triUp(L[i], R[j + 1], R[j]); j++; }
  }
  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  topGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  topGeo.computeVertexNormals();
  const g = new THREE.Group(); g.name = 'kit:ramp_chain';
  const tm = new THREE.Mesh(topGeo, dressingMaterial(top)); tm.receiveShadow = true; g.add(tm);
  // retaining walls: each outline down to the ground, battered outward; the high end closed
  const sp = [], su = [];
  const wall = (A, out) => {
    let run = 0;
    for (let k = 0; k + 1 < A.length; k++) {
      const p = A[k], q = A[k + 1], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-4 || (p[2] < 0.06 && q[2] < 0.06)) { run += len; continue; }
      const ex = (q[1] - p[1]) / len * out, ez = -(q[0] - p[0]) / len * out;
      const bp = [p[0] + ex * batter * p[2], 0, p[1] + ez * batter * p[2]], bq = [q[0] + ex * batter * q[2], 0, q[1] + ez * batter * q[2]];
      const tp = [p[0], p[2], p[1]], tq = [q[0], q[2], q[1]], u0 = run / tile, u1 = (run + len) / tile;
      for (const [v, w] of [[bp, [u0, 0]], [bq, [u1, 0]], [tq, [u1, q[2] / tile]], [bp, [u0, 0]], [tq, [u1, q[2] / tile]], [tp, [u0, p[2] / tile]]]) { sp.push(...v); su.push(...w); }
      run += len;
    }
  };
  wall(L, -1); wall(R, 1);
  const hiL = L[L.length - 1], hiR = R[R.length - 1];
  if (Math.max(hiL[2], hiR[2]) > 0.06) wall([hiL, hiR], 1);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
  sg.computeVertexNormals();
  const sm = new THREE.Mesh(sg, sideDouble(side)); sm.castShadow = true; sm.receiveShadow = true;
  g.add(sm);
  return g;
}

const DOUBLE = new Map();
function sideDouble(set) {
  if (!DOUBLE.has(set)) { const m = dressingMaterial(set).clone(); m.side = THREE.DoubleSide; m.name = `kit:${set}:double`; DOUBLE.set(set, m); }
  return DOUBLE.get(set);
}

/** Flat wadi / stream bed polygon (world x, z) at y: dark gravel with world UVs. */
export function terrainBed(poly, y = 0.03, set = 'gravel') {
  const geo = new THREE.ShapeGeometry(new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, z))));
  scaleUV(geo, 1 / 2.5);
  const m = new THREE.Mesh(geo, paintedMaterial(set, 0x9a8a74));
  m.rotation.x = Math.PI / 2; m.position.y = y; m.receiveShadow = true; m.name = 'kit:bed';
  m.material.side = THREE.DoubleSide;
  return m;
}

/**
 * Rocky gorge / ravine (`ravine` extra, kind 'gap', local frame, w along X, d across): broken rock slopes falling from
 * a boulder rim to a dark scree floor — the ground mesh stays at y = 0, so the depth is suggested from above.
 */
export function buildGorge(p) {
  const w = p.w ?? 20, d = p.d ?? 6, g = new THREE.Group(); g.name = 'kit:gorge';
  const R = rng(seedOf(p.id ?? 'gorge')), rim = 0.9, fx = w / 2 - 0.2, fz = Math.max(0.6, d * 0.18);
  const pos = [], uv = [];
  const tri = (a, b, c) => { for (const v of [a, b, c]) { pos.push(...v); uv.push(v[0] / 2.5, (v[2] + v[1]) / 2.5); } };
  const quad = (a, b, c, e) => { tri(a, b, c); tri(a, c, e); };
  const W2 = w / 2, D2 = d / 2;
  // long slopes (jagged rim heights), short end slopes
  const n = Math.max(4, Math.round(w / 1.5));
  for (const s of [-1, 1]) for (let k = 0; k < n; k++) {
    const x0 = -W2 + (w * k) / n, x1 = -W2 + (w * (k + 1)) / n, h0 = rim * (0.7 + 0.5 * R()), h1 = rim * (0.7 + 0.5 * R());
    const a = [x0, h0, s * D2], b = [x1, h1, s * D2], c = [Math.min(fx, Math.max(-fx, x1)), 0.04, s * fz], e = [Math.min(fx, Math.max(-fx, x0)), 0.04, s * fz];
    if (s > 0) quad(a, e, c, b); else quad(a, b, c, e);
  }
  for (const s of [-1, 1]) { if (s > 0) quad([W2, rim, -D2], [fx, 0.04, -fz], [fx, 0.04, fz], [W2, rim, D2]); else quad([-W2, rim, -D2], [-W2, rim, D2], [-fx, 0.04, fz], [-fx, 0.04, -fz]); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const slopes = mesh(geo, paintedMaterial('rock', 0x8a847a)); slopes.material.side = THREE.DoubleSide; g.add(slopes);
  g.add(mesh(scaleUV(new THREE.PlaneGeometry(2 * fx, 2 * fz).rotateX(-Math.PI / 2).translate(0, 0.04, 0), 1 / 2.5), paintedMaterial('rockDark', 0x3a3632), false));
  for (const s of [-1, 1]) for (let x = -W2; x < W2; x += 1.1 + R() * 0.8) {
    const r = 0.3 + R() * 0.45;
    const b = mesh(boulderGeometry(r, r * (0.6 + R() * 0.5), r * 0.8, Math.floor(R() * 1e9), 2), dressingMaterial(R() < 0.5 ? 'rock' : 'rockDark'));
    b.position.set(x, 0, s * (D2 + 0.2 + R() * 0.4)); b.rotation.y = R() * 6.3; g.add(b);
  }
  return consolidate(g);
}

/**
 * M4 art pass (Stokkan): the steel lattice pony-truss girders of the fjord trestle (`rail_trestle_steel`): riveted
 * chords, double-intersecting lattice diagonals and verticals at every panel point, inclined end posts, U-frame knee
 * braces on cross-girders cantilevered past the deck (a pony truss has no overhead bracing). The girders stand
 * outside the mission's 4 m deck, clear of the train's loading gauge (±2.0 m). Under them, dressed granite piers at
 * the mission's `pillars` (world points, here in the local frame): coursed ashlar shafts from the inlet bed, a dark
 * wet band and a ring of pack ice at the waterline, pointed cutwaters with sloped copings up- and downstream; granite
 * abutment wings at both ends.
 */
function buildLatticeSpans(g, p, w, d, tb, steel) {
  const ashlar = paintedMaterial('ashlar', 0x8a8c88), cope = paintedMaterial('ashlar', 0xa9a8a1), wet = paintedMaterial('ashlar', 0x454a48);
  const rivet = paintedMaterial('steel', 0x3c3f38);
  const H = 1.9, y0 = 0.36, y1 = y0 + H, half = w / 2 - 0.15, zg = d / 2 + 0.32, WL = -0.1;
  const R = rng(seedOf(p.id ?? 'lattice'));
  const beam = (ax, ay, bx, by, z, t, mat = steel) => {
    const L = Math.hypot(bx - ax, by - ay), m = tb(L, t, t * 0.8, mat, (ax + bx) / 2, (ay + by) / 2, z, 0.8);
    m.rotation.z = Math.atan2(by - ay, bx - ax); return m;
  };
  const c = Math.cos(p.rot ?? 0), sn = Math.sin(p.rot ?? 0);
  const piers = (p.pillars || []).map(([px, pz]) => (px - (p.x ?? 0)) * c + (pz - (p.z ?? 0)) * sn);
  const panels = Math.max(4, Math.round((2 * half) / 2.2)), pw = (2 * half - 2 * 1.4) / panels;
  for (let i = 0; i <= panels; i++) {                                         // cross-girders under the deck
    const x = -half + 1.4 + i * pw;
    if (piers.some((lx) => Math.abs(lx - x) < 1.25)) continue;                // the pier coping carries the deck there
    tb(0.2, 0.2, 2 * zg + 0.9, steel, x, 0.18, 0, 0.8);
    for (const s of [-1, 1]) {                                                // U-frame knee brace
      const za = s * (zg + 0.42), zb = s * (zg + 0.1), ya = 0.22, yb = 1.3;
      const kb = tb(0.08, Math.hypot(zb - za, yb - ya), 0.1, steel, x, (ya + yb) / 2, (za + zb) / 2, 0.6);
      kb.rotation.x = Math.atan2(zb - za, yb - ya);
    }
  }
  for (const s of [-1, 1]) {
    const z = s * zg;
    tb(2 * half, 0.32, 0.24, steel, 0, y0 + 0.02, z, 0.8);                     // bottom chord
    tb(2 * half - 2.8, 0.22, 0.3, steel, 0, y1, z, 0.8);                      // top chord
    tb(2 * half - 2.8, 0.03, 0.34, rivet, 0, y1 + 0.12, z, 0.8);              // cover plate
    beam(-half, y0 + 0.1, -half + 1.4, y1, z, 0.24);                          // inclined end posts
    beam(half, y0 + 0.1, half - 1.4, y1, z, 0.24);
    for (let i = 0; i <= panels; i++) {
      const x = -half + 1.4 + i * pw;
      tb(0.1, H - 0.1, 0.18, steel, x, (y0 + y1) / 2, z, 0.6);                  // verticals
      if (i < panels) {                                                       // double lattice
        beam(x, y0 + 0.1, x + pw, y1 - 0.08, z, 0.09);
        beam(x, y1 - 0.08, x + pw, y0 + 0.1, z, 0.09);
      }
    }
    for (let x = -half + 0.6; x < half - 0.5; x += 0.55) tb(0.05, 0.05, 0.27, rivet, x, y0 + 0.2, z, 0.5);  // rivet heads
  }
  // granite piers: shaft from the bed, wet band under the deck, coping (deck bearing); up- and downstream a pointed
  // starling carried up past the bearing as a pier head of coursed ashlar (ashlarCutwater), pack ice round its nose
  for (const lx of piers) {
    tb(2.2, 1.31, 2 * zg + 0.5, ashlar, lx, -0.6, 0, 1.1);                     // y -1.25 .. 0.06
    tb(2.26, 0.19, 2 * zg + 0.56, wet, lx, WL - 0.025, 0, 1.1);                // wet, weed-dark band at the waterline
    tb(2.5, 0.12, 2 * zg + 0.8, cope, lx, 0.06, 0, 1.0);                       // coping (deck bearing)
    for (const s of [-1, 1]) {
      const cw = ashlarCutwater(R, 1.1, 1.35, WL);
      cw.position.set(lx, 0, s * (zg + 0.25)); cw.rotation.y = s < 0 ? Math.PI : 0; g.add(cw);
      for (let k = 0; k < 4; k++) {                                            // pack ice jammed against the cutwater
        const a = (k / 3 - 0.5) * 2.2, r = 1.3 + R() * 0.45, hz = zg + 0.25 + Math.cos(a) * r;
        g.add(iceFloe(R, lx + Math.sin(a) * r * 1.25, s * hz, 0.4 + R() * 0.3, 0.32 + R() * 0.25, WL + 0.1, 0.16, { tilt: 0.12, shade: false }));
      }
    }
  }
  for (const e of [-1, 1]) for (const s of [-1, 1]) tb(1.8, 0.9, 0.9, ashlar, e * (w / 2 - 0.6), -0.23, s * (zg + 0.05), 1.1);
}

/**
 * M4 fix round 2: one pointed starling of dressed granite (local frame: back face on the pier at z = 0, nose at +z,
 * half-width hw, length L): a dark mortar core from the bed; above the waterline WL four 0.27 m courses of separate,
 * slightly proud ashlar blocks laid along both faces in broken bond, with a long/short quoin at the nose, the lowest
 * course dark and wet; a projecting granite coping course and a hipped cap under a white snow crust. The blocks are
 * geometry, so the coursing reads under the deck's shadow at the default zoom.
 */
function ashlarCutwater(R, hw, L, WL) {
  const g = new THREE.Group();
  const stones = [0xd6d2c9, 0xc0bcb3, 0xe2ddd3, 0xccc5b8].map((c) => paintedMaterial('graniteFace', c));   // rock-faced
  const wet = paintedMaterial('graniteFace', 0x5c625f), core = paintedMaterial('graniteFace', 0x4e4f4b), cope = paintedMaterial('graniteFace', 0xdcd8ce);
  const ch = 0.27, y0 = WL - 0.12, n = 4, yt = y0 + n * ch, Lf = Math.hypot(hw, L);
  const add = (geo, mat) => { const m = mesh(geo, mat); g.add(m); return m; };
  add(cutwaterGeometry(hw - 0.03, L - 0.05, -1.25, yt, 0, 'body'), core);
  for (let k = 0; k < n; k++) {
    const yb = y0 + k * ch, h = ch - 0.03, f = (k % 2 ? 0.3 : 0.2) + 0.02;    // quoin: alternate long / short
    add(cutwaterGeometry(hw * f + 0.03, L * f + 0.03, yb, yb + h, 0, 'body').translate(0, 0, L * (1 - f)), k === 0 ? wet : stones[k % 4]);
    for (const sx of [-1, 1]) {
      const ux = -sx * hw / Lf, uz = L / Lf, nx = sx * L / Lf, nz = hw / Lf;   // along the face (back -> nose), outward
      const end = Lf * (1 - f) - 0.02;
      let t = 0.04 + (k % 2) * 0.24 * R();
      if (t > 0.06) {                                                         // short closer at the back
        const m = add(boxUV(new THREE.BoxGeometry(t - 0.035, h, 0.24).toNonIndexed(), 1.1), k === 0 ? wet : stones[(k + 1) % 4]);
        m.position.set(sx * hw + ux * t / 2 - nx * 0.095, yb + h / 2, uz * t / 2 - nz * 0.095); m.rotation.y = -Math.atan2(uz, ux);
      }
      while (t < end - 0.1) {
        const l = Math.min(0.42 + R() * 0.24, end - t);
        const mat = k === 0 ? wet : stones[Math.floor(R() * 4)];
        const m = add(boxUV(new THREE.BoxGeometry(l - 0.035, h, 0.24).toNonIndexed(), 1.1), mat);
        const c = t + l / 2;
        m.position.set(sx * hw + ux * c - nx * 0.095, yb + h / 2, uz * c - nz * 0.095); m.rotation.y = -Math.atan2(uz, ux);
        t += l;
      }
    }
  }
  add(cutwaterGeometry(hw + 0.07, L + 0.1, yt, yt + 0.11, 0, 'body'), cope);   // projecting coping course
  const cap = cutwaterGeometry(hw - 0.02, L - 0.03, yt + 0.11, yt + 0.11, 0.12, 'cap'), ty = yt + 0.23;   // shallow weathering
  add(cap, cope);
  // the snow crust: the cap shrunk about its apex (on the cap's planes), lifted 3 cm, so the dressed coping edge
  // shows round it; it takes no shadow, like the pack ice and the floes round the pier
  const crust = cap.clone().translate(0, -ty, 0.05).scale(0.8, 0.8, 0.8).translate(0, ty + 0.03, -0.05);
  add(crust, snowCrustMaterial()).receiveShadow = false;
  return g;
}

/** A pointed pier cutwater (starling) local to the pier face at z = 0, pointing +z: a triangular prism of half-width
 * hw and length L from yb to yt, under a sloped coping that falls from `rise` above yt at the face to yt at the nose
 * (`part`: 'all', 'body' = the prism only, 'cap' = the coping only, lifted by `lift`). */
function cutwaterGeometry(hw, L, yb, yt, rise, part = 'all', lift = 0) {
  const parts = [];
  if (part !== 'cap') {
    const sh = new THREE.Shape([new THREE.Vector2(-hw, 0), new THREE.Vector2(hw, 0), new THREE.Vector2(0, -L)]);
    const body = new THREE.ExtrudeGeometry(sh, { depth: yt - yb, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, yb, 0);
    body.deleteAttribute('normal');
    const bu = body.attributes.uv; for (let i = 0; i < bu.count; i++) bu.setXY(i, bu.getX(i) / 1.1, bu.getY(i) / 1.1);
    parts.push(body.index ? body.toNonIndexed() : body);
  }
  if (part !== 'body') {
    const y = yt + lift, A = [-hw - 0.1, y, -0.05], B = [hw + 0.1, y, -0.05], N = [0, y, L + 0.12], T = [0, y + rise, -0.05];
    const P = [...A, ...N, ...T, ...T, ...N, ...B, ...A, ...T, ...B];
    const cap = new THREE.BufferGeometry();
    cap.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    const uv = []; for (let i = 0; i < P.length; i += 3) uv.push(P[i] / 1.1, (P[i + 2] + P[i + 1]) / 1.1);
    cap.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    parts.push(cap);
  }
  const geo = parts.length > 1 ? mergeGeometries(parts, false) : parts[0];
  geo.computeVertexNormals();
  return geo;
}

/**
 * Railway bridge deck (`rail_bridge` extra, kind 'deck', local frame, w along X): plate girders either side, a timber
 * deck with sleepers and rails on top, steel (or timber) trestle bents below every 6 m.
 */
export function buildRailBridge(p) {
  const w = p.w ?? 40, d = p.d ?? 4, h = p.h ?? 6, steelV = /steel|truss/.test(String(p.variant || ''));
  const g = new THREE.Group(); g.name = 'kit:rail_bridge';
  const steel = paintedMaterial('steel', 0x4e5248), beam = dressingMaterial('beam');
  const tb = (bw, bh, bd, mat, x, y, z, tile = 1.5) => { const m = mesh(boxUV(new THREE.BoxGeometry(bw, bh, bd).toNonIndexed(), tile), mat); m.position.set(x, y, z); g.add(m); return m; };
  tb(w, 0.12, d, dressingMaterial('planks'), 0, 0.34, 0);
  const lattice = /lattice|trestle_steel/.test(String(p.variant || ''));
  if (lattice) buildLatticeSpans(g, p, w, d, tb, steel);
  for (const s of lattice ? [] : [-1, 1]) {
    tb(w, 1.1, 0.06, steel, 0, -0.2, s * (d / 2 - 0.1));          // plate girder web
    tb(w, 0.06, 0.4, steel, 0, 0.33, s * (d / 2 - 0.1));          // top flange
    tb(w, 0.06, 0.4, steel, 0, -0.75, s * (d / 2 - 0.1));         // bottom flange
    for (let x = -w / 2 + 0.5; x < w / 2; x += 1.5) tb(0.05, 1.1, 0.14, steel, x, -0.2, s * (d / 2 - 0.05), 0.6); // stiffeners
    tb(w, 0.06, 0.06, dressingMaterial('castIron'), 0, 1.25, s * (d / 2 - 0.05), 0.6);   // hand rail
    for (let x = -w / 2; x <= w / 2; x += 2) tb(0.06, 0.85, 0.06, dressingMaterial('castIron'), x, 0.82, s * (d / 2 - 0.05), 0.6);
  }
  // a mine trestle (M19) carries its rusty track ON the planks (sleepers spiked to the deck), like the line either side
  const mine = /mine/.test(String(p.variant || ''));
  const track = buildRailTrack([[-w / 2, 0], [w / 2, 0]], { width: Math.min(2.4, d - 0.6), rusty: mine });
  track.position.y = mine ? 0.4 : 0.3; track.children[0].visible = false; // no ballast on a bridge deck
  g.add(track);
  if (h > 1 && !lattice) for (let x = -w / 2 + 3; x < w / 2; x += 6) {
    for (const s of [-1, 1]) { const leg = tb(steelV ? 0.3 : 0.4, h, steelV ? 0.3 : 0.4, steelV ? steel : beam, x, -0.8 - h / 2, s * (d / 2 - 0.3), 1.2); leg.rotation.x = s * 0.06; }
    const xb = tb(0.15, Math.hypot(h, d), 0.15, steelV ? steel : beam, x, -0.8 - h / 2, 0, 1.2); xb.rotation.x = Math.atan2(d, h);
  }
  return g;
}
