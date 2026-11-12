/**
 * The library's ruined models dressed with the ruin kit (art/ruin-kit.js; user 2026-11-10: "Buildings in ruins should
 * look more realistic"): the bombed brick / stone shells (house_bombed_a, house_bombed_b: M4's farm ruins and ruined
 * house, M6's ruin_s, M7's ruins field, M15's bombed block), the Norwegian field-stone ruins and rubble (M1, M4), the
 * desert tower stub and mud arch (M10, M11) and the bombed log manors' upper floors (M6).
 *
 * The models stay as they are (their meshes are what the gameplay stamps measure); the dressing is a visual-only group
 * (`userData.clip = false`) under the building, in the model's own frame:
 *  - the broken wall heads, read off the model (`analyseRuin`: the wall material's top over every wall footprint of
 *    the sidecar): the kit rebuilds the notches of the modelled crenel-like steps as ragged broken courses, and lays
 *    loose bricks / stones on the heads — no row of square notches is left;
 *  - the fallen storeys: rubble mounds filling the shell (gameplay: the inside is closed-off low rubble), spills at
 *    the sidecar's rubble footprints, talus along the outside, loose units strewn round, weeds (temperate);
 *  - charred rafters leaning from a wall head into the rubble, joists across it (each end on the head or the mound);
 *  - soot: scorch decals above every window (found from the model's glass) and under the broken heads, grime at the
 *    foot, ash / dirt on the ground (not on snow).
 * Analysis is cached per asset (its finest loaded LOD, before the map build: preloadBuildings loads placed LOD0s).
 * @module art/ruin-dress
 */
import * as THREE from 'three';
import { RuinKit } from './ruin-kit.js';

/** Which library models are dressed, how: masonry kind, the wall material, soot, and the parts the recipe draws. */
export const GLB_RUINS = {
  house_bombed_b: { kind: 'brick', wall: /^kit:brick_red/, soot: 0.85, shell: true },
  house_bombed_a: { kind: 'stoneGrey', wall: /^kit:fieldstone_grey/, soot: 0.75, shell: true },
  ruin_fieldstone_no_a: { kind: 'stoneGrey', wall: /^kit:fieldstone_grey/, soot: 0.08, foot: true },
  ruin_fieldstone_no_b: { kind: 'stoneGrey', wall: /^kit:fieldstone_grey/, soot: 0.08, foot: true },
  ruin_fieldstone_no_c: { kind: 'stoneGrey', wall: /^kit:fieldstone_grey/, soot: 0.08, foot: true },
  rubble_fieldstone_low_no: { kind: 'stoneGrey', wall: /^kit:fieldstone_grey/, soot: 0.05, rubble: true },
  tower_stub_ms: { kind: 'rubbleStone', wall: /^kit:rubble_stone/, soot: 0.1, foot: true },
  arch_mud_ic: { kind: 'mud', wall: /^kit:(mudbrick|mud_render)/, soot: 0.05, foot: true },
  house_bombed_log_w: { kind: 'stoneGrey', wall: /^kit:log_hewn/, soot: 0.9, deck: true },
  house_bombed_log_ne: { kind: 'stoneGrey', wall: /^kit:log_hewn/, soot: 0.9, deck: true },
};
/** The recipe of an asset (its snow twin shares its base's). */
export function ruinRecipe(asset) {
  return GLB_RUINS[asset] ?? GLB_RUINS[String(asset).replace(/_snow$/, '')] ?? null;
}

const CELL = 0.1;
const CACHE = new Map();

/**
 * Read a ruined model: the wall material's highest point per 0.1 m cell (the model's frame), its glass (windows), and
 * the sidecar's wall rectangles with the broken head along each. Cached per asset.
 * @param {string} asset @param {THREE.Object3D} lod the model's finest loaded LOD (the building's `lods[i]`)
 * @param {object} meta its manifest entry (bbox, footprints) @param {RegExp} wallRx
 */
export function analyseRuin(asset, lod, meta, wallRx) {
  if (CACHE.has(asset)) return CACHE.get(asset);
  const bb = meta.bbox, x0 = bb.min[0] - 0.2, z0 = bb.min[2] - 0.2;
  const nx = Math.ceil((bb.max[0] - x0 + 0.2) / CELL) + 1, nz = Math.ceil((bb.max[2] - z0 + 0.2) / CELL) + 1;
  const H = new Float32Array(nx * nz).fill(-Infinity), F = new Float32Array(nx * nz).fill(-Infinity), wallMat = { color: null };
  const floorRx = /^kit:(deck_planks|floor_checker|boards_weathered)/;
  const glass = [];
  lod.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(lod.matrixWorld).invert(), rel = new THREE.Matrix4();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  let T = H;
  const put = (x, y, z) => {
    const i = Math.floor((x - x0) / CELL), j = Math.floor((z - z0) / CELL);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return;
    const k = j * nx + i;
    if (y > T[k]) T[k] = y;
  };
  lod.traverse((m) => {
    if (!m.isMesh || !m.geometry?.attributes?.position) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const isWall = (mt) => wallRx.test(mt?.name || ''), isGlass = (mt) => /glass/i.test(mt?.name || ''), isFloor = (mt) => floorRx.test(mt?.name || '');
    if (!mats.some(isWall) && !mats.some(isGlass) && !mats.some(isFloor)) return;
    rel.multiplyMatrices(inv, m.matrixWorld);
    const g = m.geometry, P = g.attributes.position, idx = g.index;
    const groups = g.groups?.length ? g.groups : [{ start: 0, count: idx ? idx.count : P.count, materialIndex: 0 }];
    for (const gr of groups) {
      const mt = mats[gr.materialIndex ?? 0] || mats[0];
      const wall = isWall(mt), gl = isGlass(mt), fl = isFloor(mt);
      if (!wall && !gl && !fl) continue;
      T = fl && !wall ? F : H;
      if (wall && !wallMat.color && mt.color) wallMat.color = mt.color.clone();
      for (let t = gr.start; t + 2 < gr.start + gr.count; t += 3) {
        const ia = idx ? idx.getX(t) : t, ib = idx ? idx.getX(t + 1) : t + 1, ic = idx ? idx.getX(t + 2) : t + 2;
        a.fromBufferAttribute(P, ia).applyMatrix4(rel); b.fromBufferAttribute(P, ib).applyMatrix4(rel); c.fromBufferAttribute(P, ic).applyMatrix4(rel);
        if (gl) { glass.push([(a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3]); continue; }
        if (T === F && Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) < 1e-6) continue; // (a floor's edge faces)
        // edges always; the inside of a flat-ish triangle too (a head's top quad)
        for (const [p, q] of [[a, b], [b, c], [c, a]]) {
          const n = Math.max(1, Math.ceil(p.distanceTo(q) / (CELL * 0.5)));
          for (let s = 0; s <= n; s++) put(p.x + (q.x - p.x) * s / n, p.y + (q.y - p.y) * s / n, p.z + (q.z - p.z) * s / n);
        }
        nrm.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
        const area = nrm.length() / 2;
        if (area > 1e-6 && Math.abs(nrm.y) / (2 * area) > 0.5) {
          const n = Math.min(60, Math.ceil(Math.sqrt(area) / (CELL * 0.5)));
          for (let i = 0; i <= n; i++) for (let j = 0; i + j <= n; j++) {
            const u = i / n, v = j / n;
            put(a.x + e1.x * u + e2.x * v, a.y + e1.y * u + e2.y * v, a.z + e1.z * u + e2.z * v);
          }
        }
      }
    }
  });
  const at = (x, z) => { const i = Math.floor((x - x0) / CELL), j = Math.floor((z - z0) / CELL); return i < 0 || j < 0 || i >= nx || j >= nz ? -Infinity : H[j * nx + i]; };
  const floorAt = (x, z) => { const i = Math.floor((x - x0) / CELL), j = Math.floor((z - z0) / CELL); return i < 0 || j < 0 || i >= nx || j >= nz ? -Infinity : F[j * nx + i]; };
  // the surviving storeys: floor cells over 1.5 m, in patches (a sample of their cells, for debris)
  const floors = [];
  for (let j = 0; j < nz; j += 6) for (let i = 0; i < nx; i += 6) { const y = F[j * nx + i]; if (y > 1.5) floors.push([x0 + (i + 0.5) * CELL, y, z0 + (j + 0.5) * CELL]); }
  // the sidecar's wall rectangles: axis, thickness, the head along the axis (max over the cells across it)
  const walls = [];
  for (const f of meta.footprints || []) {
    if (f.kind !== 'wall' || f.block !== 'HIGH' || f.points?.length !== 4) continue;
    const p = f.points, e0 = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), e3 = Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]);
    const long = e0 >= e3, L = Math.max(e0, e3), t = Math.min(e0, e3);
    if (L < 0.6) continue;
    const cx = p.reduce((s, q) => s + q[0], 0) / 4, cz = p.reduce((s, q) => s + q[1], 0) / 4;
    const [qa, qb] = long ? [p[0], p[1]] : [p[1], p[2]];
    const tx = (qb[0] - qa[0]) / L, tz = (qb[1] - qa[1]) / L, nxv = -tz, nzv = tx;
    const n = Math.max(2, Math.round(L / CELL)), top = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const u = -L / 2 + (k + 0.5) * L / n;
      let m = -Infinity;
      for (let v = -t / 2 + 0.05; v <= t / 2 - 0.05 + 1e-6; v += CELL * 0.8) m = Math.max(m, at(cx + tx * u + nxv * v, cz + tz * u + nzv * v));
      top[k] = m;
    }
    walls.push({ cx, cz, tx, tz, nx: nxv, nz: nzv, L, t, top, du: L / n });
  }
  // (a model whose sidecar has no wall strips — a log manor's whole 'building' block: its outline's edges, 0.5 m thick)
  if (!walls.length) for (const f of meta.footprints || []) {
    if (f.kind !== 'building' || !(f.points?.length >= 3)) continue;
    const p = f.points, n0 = p.length, cxp = p.reduce((s2, q) => s2 + q[0], 0) / n0, czp = p.reduce((s2, q) => s2 + q[1], 0) / n0;
    for (let k = 0; k < n0; k++) {
      const [ax, az] = p[k], [bx, bz] = p[(k + 1) % n0], L = Math.hypot(bx - ax, bz - az);
      if (L < 2) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      let nxv = -tz, nzv = tx;
      if ((cxp - (ax + bx) / 2) * nxv + (czp - (az + bz) / 2) * nzv < 0) { nxv = -nxv; nzv = -nzv; } // (towards the inside)
      const t = 0.5, cx = (ax + bx) / 2 + nxv * t / 2, cz = (az + bz) / 2 + nzv * t / 2;
      const n = Math.max(2, Math.round(L / CELL)), top = new Float32Array(n);
      for (let q = 0; q < n; q++) {
        const u = -L / 2 + (q + 0.5) * L / n;
        let m = -Infinity;
        for (let v = -t / 2 + 0.05; v <= t / 2 - 0.05 + 1e-6; v += CELL * 0.8) m = Math.max(m, at(cx + tx * u + nxv * v, cz + tz * u + nzv * v));
        top[q] = m;
      }
      walls.push({ cx, cz, tx, tz, nx: nxv, nz: nzv, L, t, top, du: L / n, edge: true });
    }
    break;
  }
  // windows: the glass triangles' centres clustered on a 0.8 m grid (each window's middle)
  const win = new Map();
  for (const g of glass) {
    const k = `${Math.round(g[0] / 0.8)},${Math.round(g[1] / 0.8)},${Math.round(g[2] / 0.8)}`;
    const w = win.get(k) || [0, 0, 0, 0];
    w[0] += g[0]; w[1] += g[1]; w[2] += g[2]; w[3]++; win.set(k, w);
  }
  // (a window straddling the grid lands in several cells: cells closer than a window's width merge into one)
  const cl = [...win.values()].map((w) => [w[0], w[1], w[2], w[3]]);
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < cl.length && !merged; i++) for (let j = i + 1; j < cl.length; j++) {
      const a = cl[i], b = cl[j];
      if (Math.hypot(a[0] / a[3] - b[0] / b[3], a[2] / a[3] - b[2] / b[3]) < 1.0 && Math.abs(a[1] / a[3] - b[1] / b[3]) < 1.0) {
        for (let k = 0; k < 4; k++) a[k] += b[k];
        cl.splice(j, 1); merged = true; break;
      }
    }
  }
  const windows = cl.map((w) => [w[0] / w[3], w[1] / w[3], w[2] / w[3]]);
  const out = { at, floorAt, floors, walls, windows, color: wallMat.color, bbox: bb };
  CACHE.set(asset, out);
  return out;
}

/** A wall rectangle as a kit segment (for talus / scatter / drift): along its axis from one end to the other. */
const segOf = (w, side = 0) => {
  const ax = w.cx - w.tx * w.L / 2 + w.nx * side, az = w.cz - w.tz * w.L / 2 + w.nz * side;
  return { ax, az, bx: ax + w.tx * w.L, bz: az + w.tz * w.L, L: w.L, Lw: w.L, eA: 0, tx: w.tx, tz: w.tz, nx: w.nx, nz: w.nz, t: w.t, cols: [], s0: 0 };
};

/**
 * The visual-only dressing of one placed ruined model (its building group's frame). null when the asset has no recipe
 * or no loaded mesh. @param {{asset: string, meta: object, lods: (THREE.Object3D|null)[]}} b createBuilding's result
 * @param {{id?: string, theater?: string, detail?: number}} o
 * @returns {THREE.Group|null}
 */
export function dressRuin(b, o = {}) {
  const rec = ruinRecipe(b.asset);
  const lod = b.lods?.find(Boolean);
  if (!rec || !lod) return null;
  const A = analyseRuin(b.asset, lod, b.meta, rec.wall);
  const kit = new RuinKit({ kind: rec.kind, theater: o.theater, id: `${b.asset}:${o.id ?? ''}`, soot: rec.soot, detail: o.detail ?? 1,
    tint: A.color ? [A.color.r * 1.0, A.color.g * 1.0, A.color.b * 1.0] : undefined, skin: null });
  const R = kit.R, snow = o.theater === 'snow', bb = A.bbox;
  kit.supports.push((x, z) => Math.max(0, A.at(x, z), A.floorAt(x, z)));
  if (rec.deck) return dressDeck(kit, A, b, o);
  // ---- the broken heads: every notch of the modelled steps rebuilt as ragged courses, loose units on top
  for (const w of A.walls) crestRebuild(kit, w);
  // ---- the fallen storeys inside a shell, the spills, the talus outside
  const xs = A.walls.flatMap((w) => [w.cx - Math.abs(w.tx) * w.L / 2 - Math.abs(w.nx) * w.t / 2, w.cx + Math.abs(w.tx) * w.L / 2 + Math.abs(w.nx) * w.t / 2]);
  const zs = A.walls.flatMap((w) => [w.cz - Math.abs(w.tz) * w.L / 2 - Math.abs(w.nz) * w.t / 2, w.cz + Math.abs(w.tz) * w.L / 2 + Math.abs(w.nz) * w.t / 2]);
  // (no wall strips — a rubble heap: the model's box)
  const ox0 = xs.length ? Math.min(...xs) : bb.min[0], ox1 = xs.length ? Math.max(...xs) : bb.max[0];
  const oz0 = zs.length ? Math.min(...zs) : bb.min[2], oz1 = zs.length ? Math.max(...zs) : bb.max[2];
  const cx = (ox0 + ox1) / 2, cz = (oz0 + oz1) / 2;
  const outer = A.walls.filter((w) => w.L > 2.5);
  if (rec.shell && outer.length) {
    const t = Math.min(...outer.map((w) => w.t)), iw = ox1 - ox0 - 2 * t, id = oz1 - oz0 - 2 * t;
    // the heap of the fallen storeys: one broad mound off-centre, two leaning on the walls
    kit.mound({ x: cx + (R() - 0.5) * iw * 0.15, z: cz + (R() - 0.5) * id * 0.15, w: iw * 1.02, d: id * 1.02, h: 1.3 + R() * 0.6, rot: (R() - 0.5) * 0.2, density: 5, flat: 0.45 });
    for (let k = 0; k < 2; k++) kit.mound({ x: cx + (R() - 0.5) * iw * 0.5, z: cz + (R() - 0.5) * id * 0.5, w: iw * (0.35 + R() * 0.2), d: id * (0.35 + R() * 0.2), h: 1.6 + R() * 0.7, rot: R() * 3, density: 6 });
    // debris heaped on the surviving floors (and the beams lying on them)
    const fl = A.floors.filter(() => R() < 0.35).slice(0, 8);
    for (const [fx, fy, fz] of fl) {
      kit.mound({ x: fx, z: fz, y0: fy - 0.02, w: 1.2 + R() * 1.4, d: 1.0 + R() * 1.1, h: 0.3 + R() * 0.4, rot: R() * 3, density: 8 });
      // a charred joist or two lying across the floor near the heap
      if (R() < 0.7) {
        const a0 = R() * 6.28, L = 1.4 + R() * 1.6, px = fx + (R() - 0.5) * 1.2, pz = fz + (R() - 0.5) * 1.2;
        const ax = px - Math.cos(a0) * L / 2, az = pz - Math.sin(a0) * L / 2, bx = px + Math.cos(a0) * L / 2, bz = pz + Math.sin(a0) * L / 2;
        const ya = kit.supportAt(ax, az), yb = kit.supportAt(bx, bz);
        if (Math.abs(ya - fy) < 0.6 && Math.abs(yb - fy) < 0.6) kit.beam([ax, ya, az], [bx, yb, bz], 0.13, 0.17, { kind: 'joist' });
      }
    }
    for (let k = 0; k < 2; k++) {
      const w = outer[Math.floor(R() * outer.length)], side = Math.sign((cx - w.cx) * w.nx + (cz - w.cz) * w.nz) || 1;
      kit.talus(segOf(w), side, w.L * (0.1 + R() * 0.3), w.L * (0.55 + R() * 0.35), 1.1 + R() * 0.5, 1.6);
    }
    // charred rafters: from a wall head down into the heap; joists across it
    for (let k = 0; k < 4; k++) {
      const w = outer[Math.floor(R() * outer.length)], side = Math.sign((cx - w.cx) * w.nx + (cz - w.cz) * w.nz) || 1;
      const ku = Math.floor(R() * w.top.length), u = -w.L / 2 + (ku + 0.5) * w.du, y = w.top[ku];
      if (!(y > 1.5)) continue;
      const hx = w.cx + w.tx * u + w.nx * side * (w.t * 0.1), hz = w.cz + w.tz * u + w.nz * side * (w.t * 0.1);
      const reach = 1.8 + R() * 2.2, du = (R() - 0.5) * 1.6;
      const fx = hx + w.nx * side * reach + w.tx * du, fz = hz + w.nz * side * reach + w.tz * du;
      kit.beam([hx, kit.supportAt(hx, hz), hz], [fx, kit.supportAt(fx, fz), fz], 0.15, 0.2, { kind: 'rafter' });
    }
    for (let k = 0; k < 2; k++) {
      const a0 = R() * 6.28, L = 1.6 + R() * 1.6, px = cx + (R() - 0.5) * iw * 0.5, pz = cz + (R() - 0.5) * id * 0.5;
      const ax = px - Math.cos(a0) * L / 2, az = pz - Math.sin(a0) * L / 2, bx = px + Math.cos(a0) * L / 2, bz = pz + Math.sin(a0) * L / 2;
      kit.beam([ax, kit.supportAt(ax, az), az], [bx, kit.supportAt(bx, bz), bz], 0.13, 0.18, { kind: 'joist' });
    }
  }
  // the sidecar's rubble spills (low footprints outside the shell): mounds on them
  for (const f of b.meta.footprints || []) {
    if (!/^(rubble|breach)$/.test(f.kind) || !f.points?.length) continue;
    const px = f.points.map((q) => q[0]), pz = f.points.map((q) => q[1]);
    const w = Math.max(...px) - Math.min(...px), d = Math.max(...pz) - Math.min(...pz);
    kit.mound({ x: (Math.max(...px) + Math.min(...px)) / 2, z: (Math.max(...pz) + Math.min(...pz)) / 2, w: w * 1.05, d: d * 1.05, h: f.kind === 'breach' ? 0.55 : 0.5 + R() * 0.35, rot: 0, density: 6 });
  }
  // talus along the outside and loose units strewn round, sand on the lee side in the desert
  for (const w of outer.length ? outer : A.walls) {
    const side = rec.shell ? (Math.sign((w.cx - cx) * w.nx + (w.cz - cz) * w.nz) || 1) : (R() < 0.5 ? 1 : -1);
    const s = segOf(w);
    const n = 1 + Math.floor(w.L / (rec.foot ? 2.4 : 4));
    for (let k = 0; k < n; k++) {
      const u = R() * w.L, ww = 0.8 + R() * 1.6;
      kit.talus(s, side, Math.max(0, u - ww / 2), Math.min(w.L, u + ww / 2), (rec.foot ? 0.32 : 0.25) + R() * 0.3, 0.9);
      // (a free-standing wall: its plinth half buried in fallen stones and drift on both sides)
      if (rec.foot) kit.talus(s, -side, Math.max(0, u - ww / 2.5), Math.min(w.L, u + ww / 2.5), 0.3 + R() * 0.25, 0.8);
    }
    kit.scatter([s], w.L * (rec.shell ? 2.2 : rec.foot ? 4.5 : 1.6), 0.1, rec.shell ? 2.6 : 1.8, rec.shell ? side : 0);
    if (rec.foot) for (const sd of [1, -1]) kit.faceStreaks({ ...s, cols: w.top.length ? [...w.top].map((y, k) => ({ u0: k * w.du, u1: (k + 1) * w.du, eA: y, eB: y })) : [] }, sd, Math.round(w.L / 2));
    if (o.theater === 'desert') { const u = R() * w.L; kit.drift(s, side, Math.max(0, u - 1.5), Math.min(w.L, u + 1.5), 0.25, 1.0); }
  }
  if (rec.rubble) {
    const w = bb.max[0] - bb.min[0], d = bb.max[2] - bb.min[2];
    for (let k = 0; k < 3; k++) kit.mound({ x: cx + (R() - 0.5) * w, z: cz + (R() - 0.5) * d, w: 0.8 + R() * 0.9, d: 0.6 + R() * 0.7, h: 0.18 + R() * 0.15, rot: R() * 3, density: 7 });
    kit.scatter([segOf({ cx, cz, tx: 1, tz: 0, nx: 0, nz: 1, L: w, t: d })], w * 4, 0.1, 1.4);
  }
  // soot: scorch above each window (outside and in), streaks under the broken heads; grime at the foot
  if (rec.soot > 0.3) {
    for (const p of A.windows) {
      const w = nearestWall(A.walls, p[0], p[2]);
      if (!w) continue;
      for (const sd of [1, -1]) {
        const off = w.t / 2 + 0.03, n = [w.nx * sd, 0, w.nz * sd];
        const px = p[0], pz = p[2];
        const v = (p[0] - w.cx) * w.nx + (p[2] - w.cz) * w.nz; // the glass's own offset in the wall
        kit.decal('decals_rgba', 'soot', [px + w.nx * (sd * off - v), p[1] + 0.95 + R() * 0.2, pz + w.nz * (sd * off - v)], n, 1.4 + R() * 0.4, 1.7 + R() * 0.4, [0.22, 0.2, 0.19]);
      }
    }
    for (const w of A.walls) {
      for (let k = 0; k < Math.max(1, Math.round(w.L / 2.8)); k++) {
        const ku = Math.floor(R() * w.top.length), u = -w.L / 2 + (ku + 0.5) * w.du, y = w.top[ku];
        if (!(y > 1.6)) continue;
        const sd = R() < 0.5 ? 1 : -1, off = w.t / 2 + 0.03;
        kit.decal('decals_rgba', R() < 0.5 ? 'streak_long' : 'soot', [w.cx + w.tx * u + w.nx * sd * off, y - 0.75, w.cz + w.tz * u + w.nz * sd * off], [w.nx * sd, 0, w.nz * sd], 1.2 + R() * 1.2, 1.6, [0.25, 0.23, 0.22]);
      }
    }
  }
  if (!snow) for (let k = 0; k < (rec.shell ? 4 : 2); k++) {
    // just outside the walls (the rim of the footprint in that direction + a pace or two)
    const a0 = R() * 6.28, ca = Math.abs(Math.cos(a0)) || 1e-6, sa = Math.abs(Math.sin(a0)) || 1e-6;
    const rim = Math.min((ox1 - ox0) / 2 / ca, (oz1 - oz0) / 2 / sa), r0 = (rec.shell ? rim : 0.6) + 0.5 + R() * 1.1;
    const gx = cx + Math.cos(a0) * r0, gz = cz + Math.sin(a0) * r0, sz = 1.6 + R() * 1.0;
    kit.decal('decals_rgba', R() < 0.5 ? 'dirt_splash' : 'stain_blotch', [gx, 0.03, gz], [0, 1, 0], sz, sz, [0.75, 0.72, 0.68], [Math.cos(a0), 0, Math.sin(a0)]);
  }
  // weeds in the rubble (temperate)
  const pts = [];
  for (const m of kit.mounds) pts.push([m.x + (R() - 0.5) * m.w * 0.8, m.z + (R() - 0.5) * m.d * 0.8]);
  kit.weeds(pts, pts.length * 3);
  const g = kit.build(`ruin-dress:${b.asset}:${o.id ?? ''}`);
  g.userData.ruinDress = b.asset;
  return g;
}

/** The wall rectangle nearest (x, z) within 1 m of its line (or null). */
function nearestWall(walls, x, z) {
  let best = null, bd = 1;
  for (const w of walls) {
    const u = (x - w.cx) * w.tx + (z - w.cz) * w.tz, v = (x - w.cx) * w.nx + (z - w.cz) * w.nz;
    if (Math.abs(u) > w.L / 2 + 0.2) continue;
    if (Math.abs(v) < bd) { bd = Math.abs(v); best = w; }
  }
  return best;
}

/**
 * One wall's broken head: the modelled steps' notches (runs lower than both neighbours) refilled with ragged courses
 * from the notch floor (a V of broken masonry between the higher steps), a course or two of loose masonry on some of
 * the high steps; the kit's columns cut both into its units, loose units on top.
 */
function crestRebuild(kit, w) {
  const R = kit.R, top = w.top, n = top.length, course = kit.style.course, unit = kit.style.unit;
  // runs of (near) equal head height
  const runs = [];
  for (let k = 0; k < n;) {
    let e = k + 1;
    while (e < n && Math.abs(top[e] - top[k]) < 0.06) e++;
    if (Number.isFinite(top[k])) runs.push({ k0: k, k1: e, y: top[k] });
    k = e;
  }
  const uOf = (k) => -w.L / 2 + k * w.du;
  const P = (u, v, y) => [w.cx + w.tx * u + w.nx * v, y, w.cz + w.tz * u + w.nz * v];
  const yaw = Math.atan2(-w.tz, w.tx);
  for (let r = 0; r < runs.length; r++) {
    const q = runs[r], prev = runs[r - 1], next = runs[r + 1];
    const len = (q.k1 - q.k0) * w.du;
    if (len < 0.15 || q.y < 0.6) continue;
    const hiL = prev && prev.y > q.y ? prev.y : null, hiR = next && next.y > q.y ? next.y : null;
    const u0 = uOf(q.k0), u1 = uOf(q.k1), um = (u0 + u1) / 2;
    // a notch: the fallen masonry heaped in it — a rubble mound on the notch floor, highest against the taller step(s)
    const depth = Math.max(hiL != null ? hiL - q.y : 0, hiR != null ? hiR - q.y : 0);
    // (stone — big courses: the notch rebuilt as broken courses stepping down from each taller step, a V of
    // irregular steps a course high, so no square box step is left)
    if (depth > 0.15 && course >= 0.15 && len > 0.3) {
      const yl = hiL ?? q.y, yr = hiR ?? q.y, mid = q.y + R() * 0.25 * depth, cm = 0.3 + R() * 0.4;
      const profile = (k, Lw) => ({ lo: q.y - 0.02, hi: Math.max(yl, yr), bites: [],
        top: (u) => { const f = u / Lw; return f < cm ? yl - (yl - mid) * Math.pow(f / cm, 0.7) - course * 0.5 : mid + (yr - mid) * Math.pow((f - cm) / (1 - cm), 1.4) - course * 0.5; } });
      const a = P(u0 - 0.02, 0, 0), b = P(u1 + 0.02, 0, 0);
      kit.wallRun([[a[0], a[2]], [b[0], b[2]]], { h: Math.max(yl, yr), width: w.t + 0.05, base0: q.y - 0.02, profile, ends: ['flush', 'flush'], crestUnits: 1.6, skin: 0 });
    }
    if (depth > 0.15) {
      const lean = hiL != null && (hiR == null || R() < 0.5) ? -1 : 1, shift = lean * len * (0.12 + R() * 0.12);
      const [mx, , mz] = P(um + shift, 0, 0);
      // (low: a broken head is a ragged litter of bricks and mortar, not a dome — the risers' bonding steps give it height)
      kit.mound({ x: mx, z: mz, y0: q.y - 0.03, w: len + 0.2, d: w.t + 0.1, h: Math.min(0.22, depth * 0.3), rot: Math.atan2(w.tz, w.tx), density: 26 });
    }
    // the riser edges of the taller step: broken bonding — bricks stepping back course by course, some loose
    for (const [edgeU, hi, dir] of [[u0, hiL, 1], [u1, hiR, -1]]) {
      if (hi == null || hi - q.y < 0.15) continue;
      const steps = Math.min(5, Math.floor((hi - q.y) / course));
      for (let c = 0; c < steps; c++) {
        if (R() < 0.25) continue;
        const y = hi - (c + 0.5) * course, reach = (c + 1) * unit[0] * 0.38 * (0.6 + R() * 0.8);
        if (reach > len * 0.9) break;
        const v = (R() - 0.5) * w.t * 0.5, [x, , z] = P(edgeU + dir * (reach / 2), v, 0);
        kit.unit(x, y, z, [Math.min(reach, unit[0] * (1 + R())), course * 0.95, w.t * (0.45 + R() * 0.5)], yaw + (R() - 0.5) * 0.08, 0, 0, kit.unitColour(0.25, 0.2), 0.12);
      }
    }
    // loose units lying on the head, a few hanging over its edge
    const nl = Math.round(len * (1.2 + R() * 1.2) * kit.detail);
    for (let k = 0; k < nl; k++) {
      const u = u0 + R() * len, v = (R() - 0.5) * w.t * 1.1, sz = kit.unitSize(R() < 0.4 ? 0.5 : 1);
      const [x, , z] = P(u, v, 0);
      kit.unit(x, kit.supportAt(x, z) + sz[1] * 0.4, z, sz, R() * 6.3, (R() - 0.5) * 0.5, (R() - 0.5) * 0.5, kit.unitColour(0.4));
    }
  }
}

/**
 * A bombed log manor's walkable upper floor (M6): charred planks and beam ends lying flat on the deck, ash and scorch
 * on the floor, soot up the inside of the log walls, debris along the walls' feet (the walks keep clear: nothing on
 * the deck stands over a hand high).
 */
function dressDeck(kit, A, b, o) {
  const R = kit.R, roof = (b.meta.roofs || []).find((r) => r.walkable !== false) || b.meta.roofs?.[0];
  const deckY = roof?.elev ?? 3.2;
  const pts = roof?.points || [];
  if (pts.length >= 3) {
    const xs = pts.map((q) => q[0]), zs = pts.map((q) => q[1]);
    const x0 = Math.min(...xs) + 1, x1 = Math.max(...xs) - 1, z0 = Math.min(...zs) + 1, z1 = Math.max(...zs) - 1;
    // ash and scorch patches over the floor, charred boards lying flat, a few beam ends
    for (let k = 0; k < Math.round((x1 - x0) * (z1 - z0) / 18); k++) {
      const gx = x0 + R() * (x1 - x0), gz = z0 + R() * (z1 - z0), a0 = R() * 6.28;
      kit.decal('decals_dz_rgba', R() < 0.5 ? 'scorch_a' : 'scorch_b', [gx, deckY + 0.02, gz], [0, 1, 0], 2.2 + R() * 2.8, 2.2 + R() * 2.8, [0.16, 0.14, 0.13], [Math.cos(a0), 0, Math.sin(a0)]);
      if (R() < 0.4) kit.decal('decals_dz_rgba', 'ash', [gx + (R() - 0.5), deckY + 0.025, gz + (R() - 0.5)], [0, 1, 0], 1.2 + R(), 1.2 + R(), [0.5, 0.48, 0.46], [Math.sin(a0), 0, Math.cos(a0)]);
    }
    // charred boards and low drifts of burnt debris across the floor (a hand high at most: the walks stay walkable)
    for (let k = 0; k < Math.round((x1 - x0) * (z1 - z0) / 26); k++) {
      const gx = x0 + R() * (x1 - x0), gz = z0 + R() * (z1 - z0), a0 = R() * 6.28, len = 0.9 + R() * 1.5;
      kit.beam([gx, deckY + 0.005, gz], [gx + Math.cos(a0) * len, deckY + 0.005, gz + Math.sin(a0) * len], 0.16 + R() * 0.12, 0.045, { kind: 'board' });
      if (R() < 0.45) kit.mound({ x: gx + (R() - 0.5), z: gz + (R() - 0.5), y0: deckY - 0.01, w: 0.8 + R() * 1.2, d: 0.6 + R() * 0.8, h: 0.08 + R() * 0.1, rot: a0, density: 5 });
    }
    // debris along the walls' feet on the deck: boards and beam ends flat (under a hand high)
    const along = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
    for (const [ax, az, bx, bz] of along) {
      const L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L;
      for (let k = 0; k < Math.round(L / 2); k++) {
        if (R() < 0.25) continue;
        const u = R() * L, inset = -0.3 + R() * 0.5, len = 1.0 + R() * 1.6, yaw = Math.atan2(tz, tx) + (R() - 0.5) * 0.7;
        const px = ax + tx * u - tz * inset, pz = az + tz * u + tx * inset;
        const ex = px + Math.cos(yaw) * len, ez = pz + Math.sin(yaw) * len;
        kit.beam([px, deckY + 0.005, pz], [ex, deckY + 0.005, ez], 0.18 + R() * 0.1, 0.05, { kind: 'board' });
        // a low heap of charred debris against the wall here and there (a hand high: the walks stay clear)
        if (R() < 0.35) kit.mound({ x: px - tz * 0.2, z: pz + tx * 0.2, y0: deckY - 0.01, w: 1.0 + R() * 1.2, d: 0.7, h: 0.18 + R() * 0.12, rot: Math.atan2(tz, tx), density: 8 });
      }
    }
  }
  // charred log ends sticking up out of the broken heads (resting in the notches of the logs below)
  for (const w of A.walls) for (let k = 0; k < Math.round(w.L / 2.5); k++) {
    const ku = Math.floor(R() * w.top.length), u = -w.L / 2 + (ku + 0.5) * w.du, y = w.top[ku];
    if (!(y > deckY + 0.3)) continue;
    const px = w.cx + w.tx * u, pz = w.cz + w.tz * u, len = 0.6 + R() * 0.9, lean = (R() - 0.5) * 0.6;
    kit.beam([px, y, pz], [px + w.nx * lean + w.tx * (R() - 0.5) * 0.3, y + len, pz + w.nz * lean], 0.16, 0.16, { kind: 'stub' });
  }
  // soot up the log walls (inside and out) under their broken heads
  for (const w of A.walls) for (let k = 0; k < Math.max(1, Math.round(w.L / 1.8)); k++) {
    const ku = Math.floor(R() * w.top.length), u = -w.L / 2 + (ku + 0.5) * w.du, y = w.top[ku];
    if (!(y > deckY + 0.6)) continue;
    const sd = R() < 0.5 ? 1 : -1, off = w.t / 2 + 0.04;
    kit.decal('decals_rgba', R() < 0.5 ? 'soot' : 'streak_long', [w.cx + w.tx * u + w.nx * sd * off, y - 0.7, w.cz + w.tz * u + w.nz * sd * off], [w.nx * sd, 0, w.nz * sd], 1.6 + R(), 1.5, [0.18, 0.16, 0.15]);
  }
  const g = kit.build(`ruin-dress:${b.asset}:${o.id ?? ''}`);
  g.userData.ruinDress = b.asset;
  return g;
}
