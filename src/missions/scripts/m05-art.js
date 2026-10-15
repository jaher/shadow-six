/**
 * M5 "Blind Justice" art pass (visual only; docs/missions/m05.md §4, §5): the granite massif as a real sloped rock face
 * (scree foot, steep fractured upper face with snow ledges, a climbing gully up the east face), the summit plateau and
 * the massif carried on past the N / E map edges, the valley drop's rock lip on the village side, and the props the
 * library has no model for (the village privy).
 * Nothing here touches the nav grid: the massif / plateau / valley footprints stay the mission's (cliff structures).
 * @module missions/scripts/m05-art
 */
import * as THREE from 'three';
import { dressingMaterial, fbm, boulderGeometry, seedOf } from '../../art/dressing.js';
import { addSnowCover } from '../../art/terrain/snowfx.js';
import { propSnowAmount, coverPropsWithSnow } from '../../art/terrain.js';

const lerp = (a, b, t) => a + (b - a) * t;

/** Resample a polyline to n + 1 points evenly spaced by arc length. */
export function resample(line, n) {
  const seg = [], acc = [0];
  for (let i = 1; i < line.length; i++) { const L = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]); seg.push(L); acc.push(acc[i - 1] + L); }
  const total = acc[acc.length - 1], out = [];
  for (let k = 0, i = 0; k <= n; k++) {
    const s = (total * k) / n;
    while (i < seg.length - 1 && acc[i + 1] < s) i++;
    const t = seg[i] ? (s - acc[i]) / seg[i] : 0;
    out.push([lerp(line[i][0], line[i + 1][0], t), lerp(line[i][1], line[i + 1][1], t)]);
  }
  return out;
}

/**
 * Height profile of the face over u ∈ [0, 1] (0 = foot on the field, 1 = the rim): a scree apron over the first third
 * that gains ~18 % of the height, then the steep upper face. Concave (under the straight foot→rim line), so the Green
 * Beret's climb line (a straight segment) runs outside the rock.
 */
export function faceProfile(u) {
  return u < 0.38 ? 0.16 * Math.pow(u / 0.38, 1.25) : 0.16 + 0.84 * Math.pow((u - 0.38) / 0.62, 0.78);
}

/**
 * The massif face between the rim polyline (at y = h) and the foot polyline (y = 0), lofted station by station.
 * The foot row stays exactly on the foot line (never bulging onto the walkable field), the rim row on the rim.
 * @param {number[][]} rim  [x, z] W → E along the plateau edge
 * @param {number[][]} foot [x, z] W → E along the massif's foot
 * @param {{h?:number, n?:number, rows?:number, gully?:number[], seed?:string}} [o] gully: [x, halfWidth, depth] of the
 *   climbing gully cut into the face
 */
export function massifFace(rim, foot, o = {}) {
  const h = o.h ?? 16, n = o.n ?? 140, rows = o.rows ?? 26, seed = seedOf(o.seed ?? 'm05:massif') & 0xffff;
  const R = resample(rim, n), F = resample(foot, n);
  const pos = [], uv = [], idx = [];
  let arc = 0;
  for (let i = 0; i <= n; i++) {
    if (i) arc += Math.hypot(R[i][0] - R[i - 1][0], R[i][1] - R[i - 1][1]) * 0.5 + Math.hypot(F[i][0] - F[i - 1][0], F[i][1] - F[i - 1][1]) * 0.5;
    const [fx, fz] = F[i], [rx, rz] = R[i];
    const run = Math.hypot(rx - fx, rz - fz) || 1, dx = (rx - fx) / run, dz = (rz - fz) / run; // into the rock (plan)
    let slope = 0;
    for (let r = 0; r <= rows; r++) {
      const u = r / rows, env = Math.sin(Math.PI * u);              // no displacement on the foot and rim rows
      let x = lerp(fx, rx, u), z = lerp(fz, rz, u), y = h * faceProfile(u);
      // fracture columns (plan, along the run) + strata benches (each ~2.2 m band leans back: snow ledges)
      const col = fbm(x * 0.21 + z * 0.06, y * 0.05, z * 0.21 - x * 0.04, seed, 4);
      const fine = fbm(x * 1.05, y * 0.8, z * 1.05, seed + 7, 2);
      const band = (y / 2.2) % 1;
      let d = (1.5 * col + 0.3 * fine) * env + (u > 0.36 && u < 0.97 ? 0.55 * (band - 0.5) : 0);
      if (o.gully) { const [gx, gw, gd] = o.gully; d += gd * Math.exp(-(((x - gx) / gw) ** 2)) * env; }
      d = Math.max(-0.9 * env, d);                                      // outward bulges stay small
      d = Math.min((1 - u) * run - 0.05 * env, Math.max(-u * run + 0.05 * env, d)); // never past the rim or the foot
      x += dx * d; z += dz * d;
      if (r > 0 && r < rows) y += 0.25 * fine * env;
      const pr = pos.length / 3 - 1;
      if (r) slope += Math.hypot(x - pos[pr * 3], y - pos[pr * 3 + 1], z - pos[pr * 3 + 2]);
      pos.push(x, y, z); uv.push(arc / 4, slope / 4);
    }
    slope = 0;
  }
  const W = rows + 1;
  for (let i = 0; i < n; i++) for (let r = 0; r < rows; r++) {
    const a = i * W + r, b = (i + 1) * W + r;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // the loft winds one way or the other depending on the lines' order: face the normals outward (towards the field)
  const nrm = geo.getAttribute('normal'), mid = Math.floor(n / 2) * W + Math.floor(rows / 2);
  const out = [F[n >> 1][0] - R[n >> 1][0], F[n >> 1][1] - R[n >> 1][1]];
  if (nrm.getX(mid) * out[0] + nrm.getZ(mid) * out[1] < 0) { geo.setIndex(idx.map((_, k) => idx[k - (k % 3) + [0, 2, 1][k % 3]])); geo.computeVertexNormals(); }
  const mat = dressingMaterial('graniteFace');
  if (!mat.userData.snowCover && mat.isMeshStandardMaterial) {
    // snow on the ledges and the scree only (up-facing beyond ~45°): the steep granite stays bare
    addSnowCover(mat, { uniforms: { uSnowAmt: propSnowAmount(), uSnowBias: { value: -0.3 } } });
    mat.userData.snowCover = true;
  }
  const m = new THREE.Mesh(geo, mat);
  m.name = 'm05:massif_face'; m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Scree boulders on the massif's apron (inside the foot line: the field stays clear). */
export function screeBoulders(rim, foot, o = {}) {
  const g = new THREE.Group(); g.name = 'm05:scree';
  const n = o.count ?? 60, h = o.h ?? 16, R = resample(rim, n), F = resample(foot, n);
  let s = seedOf(o.seed ?? 'm05:scree') >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i <= n; i++) {
    const r = 0.35 + rnd() * rnd() * 1.1, run = Math.hypot(R[i][0] - F[i][0], R[i][1] - F[i][1]) || 1;
    const u = Math.min(0.3, (r + 0.3) / run + rnd() * 0.22);
    const x = lerp(F[i][0], R[i][0], u), z = lerp(F[i][1], R[i][1], u), y = h * faceProfile(u);
    const b = new THREE.Mesh(boulderGeometry(r, r * (0.55 + rnd() * 0.3), r * (0.7 + rnd() * 0.5), Math.floor(rnd() * 1e9), 2),
      dressingMaterial(rnd() < 0.6 ? 'rockDark' : 'rock'));
    b.position.set(x, y - r * 0.25, z); b.rotation.y = rnd() * 6.28;
    b.castShadow = true; b.receiveShadow = true;
    g.add(b);
  }
  return g;
}

const inPoly = (x, z, pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};

/**
 * The valley's rim lip on the village side: granite outcrops and slabs breaking through the snow along the top of the
 * carved bank, with fallen blocks part-way down, so the 14 m drop reads as an edge from the default camera. Every block
 * stands inside the carve outline (the blocked `valley_rim` cliff), never on the walkable village ground.
 * @param {number[][]} edge  the rim polyline (on the carve outline)
 * @param {number[][]} outline the carve polygon
 * @param {(x:number, z:number) => number} ground terrain height (the carve field)
 * @param {{count?:number, seed?:string, avoid?:number[][]}} [o] avoid: [x, z, r] trunks the blocks keep clear of
 */
export function rimLip(edge, outline, ground, o = {}) {
  const g = new THREE.Group(); g.name = 'm05:valley_lip';
  const n = o.count ?? 90, E = resample(edge, n);
  let s = seedOf(o.seed ?? 'm05:lip') >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const avoid = o.avoid || [];
  const add = (x, z, r, flat, mat) => {
    if (!inPoly(x, z, outline) || avoid.some(([ax, az, ar]) => Math.hypot(ax - x, az - z) < ar + r)) return;
    const b = new THREE.Mesh(boulderGeometry(r, r * flat, r * (0.6 + rnd() * 0.5), Math.floor(rnd() * 1e9), 2), dressingMaterial(mat));
    b.position.set(x, ground(x, z) - r * flat * 0.3, z); b.rotation.set((rnd() - 0.5) * 0.5, rnd() * 6.28, (rnd() - 0.5) * 0.5);
    b.castShadow = true; b.receiveShadow = true;
    g.add(b);
  };
  for (let i = 0; i <= n; i++) {
    const a = E[Math.max(0, i - 1)], b = E[Math.min(n, i + 1)];
    let nx = -(b[1] - a[1]), nz = b[0] - a[0];
    const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
    if (!inPoly(E[i][0] + nx, E[i][1] + nz, outline)) { nx = -nx; nz = -nz; } // into the valley
    // the lip: granite crags breaking out of the bank top right at the edge (their dark flanks show from above)
    if (rnd() < 0.85) { const r = 0.7 + rnd() * 1.0, t = 0.35 + r * 0.55 + rnd() * 0.3; add(E[i][0] + nx * t, E[i][1] + nz * t, r, 0.85 + rnd() * 0.5, 'graniteFace'); } // (snow on its tops only)
    // blocks fallen down the bank face
    if (rnd() < 0.5) { const r = 0.5 + rnd() * 0.9, t = 2.4 + rnd() * 3.2; add(E[i][0] + nx * t, E[i][1] + nz * t, r, 0.7 + rnd() * 0.3, 'rockDark'); }
  }
  return g;
}

/** Hide a structure's placeholder meshes and hang a procedural visual (built in world coordinates) under it. */
export function swapVisual(world, id, visual) {
  const o = world.structures?.get?.(id)?.object3d;
  if (!o || !visual) return false;
  for (const c of o.children) c.visible = false;
  o.visible = true;
  o.updateMatrixWorld(true);
  visual.applyMatrix4(o.matrixWorld.clone().invert());
  visual.name = `m05art:${id}`;
  o.add(visual);
  o.userData.m05Art = true;
  return true;
}

/**
 * The village privy (the library has no Norwegian one; the Oldenburg privy is M19's own): a plank box with a mono-pitch
 * roof and a stone step, from the castle kit's privy builder.
 * @param {object} world
 * @param {string[]} ids the privy structures (variant `outhouse_plank`: no library pick, building-props VARIANT_HINTS)
 */
export async function buildPrivies(world, ids) {
  if (!ids?.length) return 0;
  const { buildOuthouse } = await import('../../art/castle-kit.js');
  let n = 0;
  for (const id of ids) {
    const s = world.structures?.get?.(id)?.def;
    if (!s) continue;
    const v = buildOuthouse({ x: s.x, z: s.z, rot: s.rot ?? 0, w: s.w, d: s.d, seed: s.id });
    coverPropsWithSnow(v, propSnowAmount().value || 1); // built after the scene's prop snow pass: give its roof the same snow
    if (swapVisual(world, s.id, v)) n++;
  }
  return n;
}
