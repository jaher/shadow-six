/**
 * A desert camp's worn ground (M9 art pass 2, Bab el Qattara: the dossier's "darker hardpan inside the walls, heavily
 * rutted with tyre tracks; tank ruts from the shed to the E gate and the inner gap"): drawn as ONE soft-edged decal over
 * the camp, as art/airstrip.js draws M10's landing ground. It carries the compacted lanes the traffic wears into the
 * sand, the Panzers' track ruts (two cleated bands per tank, a little sand pushed up along their outer edges), the
 * lorries' tyre tracks, drag marks and the oil and fuel stains where engines stand. Draped just above the drawn ground and
 * the paving: no footprint, no block, no cast shadow (it never touches the walk grid); one mesh, one material, one canvas
 * texture, freed with its geometry when the map unloads.
 *
 * spec: {area: {x0, x1, z0, z1}, y, px?, seed?, lanes: [{pts, w, a}], tracks: [{pts, kind: 'track'|'tyre'|'drag', gauge,
 *        w, a}], stains: [[x, z, r, a]]}
 *
 * Roads-and-tracks r1 (world/line-extras.js `campRuts`, matched by the spec's seed): the compacted lanes are masked out
 * where a road already runs (the splat's own road paint carries the lane tone there: no second, offset band with its own
 * straight edges), and the hardpan between the lanes gets a low-alpha scuff — trampled blotches, tyre-scrub arcs, boot
 * scuffs — in patches over the yard, so it is never uniformly clean between the ruts.
 * @module art/camp-ruts
 */
import * as THREE from 'three';
import { sampleTrack } from './airstrip.js';
import { LINE_EXTRAS } from '../world/line-extras.js';

/** The line extras' camp-ruts options for a decal spec (keyed by its seed), or null. */
export function campRutsExtras(spec) {
  if (!spec || spec.seed == null) return null;
  for (const id in LINE_EXTRAS) { const c = LINE_EXTRAS[id]?.campRuts; if (c && c.seed === spec.seed) return c; }
  return null;
}

const inPoly = (x, z, P) => {
  let ins = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i], [xj, zj] = P[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
};

/**
 * The scuff patches over the hardpan (deterministic): [{x, z, r, marks: [...]}]. Each patch: a trampled blotch, a few
 * tyre-scrub arcs and boot scuffs. Patches avoid the masked road corridors.
 */
export function scuffPatches(spec, ex = campRutsExtras(spec)) {
  const sc = ex?.scuff;
  if (!sc?.poly?.length) return [];
  const R = rng((spec.seed ?? 1942) ^ 0x5c0ff), out = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of sc.poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const n = sc.patches ?? 40, onRoad = (x, z) => (ex.mask || []).some((m) => polyDist(x, z, m.pts) < m.w / 2 + 2);
  for (let k = 0, tries = 0; k < n && tries < n * 30; tries++) {
    const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
    if (!inPoly(x, z, sc.poly) || onRoad(x, z)) continue;
    const r = 1.2 + R() * 1.4, marks = [];
    const arcs = 1 + Math.floor(R() * 3);
    for (let a = 0; a < arcs; a++) {
      const h0 = R() * 6.283, bend = (R() - 0.5) * 1.2, len = 1.2 + R() * 1.8, cx = x + (R() - 0.5) * r * 0.8, cz = z + (R() - 0.5) * r * 0.8;
      const pts = [];
      for (let t = 0; t <= 6; t++) { const u = t / 6 - 0.5, h = h0 + bend * u; pts.push([cx + Math.cos(h) * len * u, cz + Math.sin(h) * len * u]); }
      marks.push({ kind: 'arc', pts, w: 0.18 + R() * 0.14, a: 0.05 + R() * 0.05 });
    }
    const boots = 3 + Math.floor(R() * 6);
    for (let b = 0; b < boots; b++) marks.push({ kind: 'boot', x: x + (R() - 0.5) * r * 1.2, z: z + (R() - 0.5) * r * 1.2, rot: R() * 6.283, a: 0.05 + R() * 0.05 });
    out.push({ x, z, r, a: (sc.a ?? 0.1) * (0.6 + 0.6 * R()), dark: R() < 0.7, marks });
    k++;
  }
  return out;
}

/** Distance from (x, z) to a polyline. */
function polyDist(x, z, P) {
  let d = Infinity;
  for (let i = 0; i + 1 < P.length; i++) {
    const [ax, az] = P[i], [bx, bz] = P[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    d = Math.min(d, Math.hypot(x - ax - dx * u, z - az - dz * u));
  }
  return d;
}

const HAS_DOM = typeof document !== 'undefined';
const MAX_W = 2048;

const rng = (seed) => { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/** Offset polyline: the samples of `pts` shifted `o` m to the left of the travel direction, with a gentle wobble. */
function offsetLine(S, o, wobble, ph) {
  return S.map((p, i) => {
    const wob = wobble * (Math.sin(i * 0.37 + ph) + 0.6 * Math.sin(i * 1.3 + ph * 2));
    return [p.x - p.tz * (o + wob), p.z + p.tx * (o + wob)];
  });
}

/** Paint the marks on a 2D canvas context (world → canvas: (x − x0)·sx, (z − z0)·sz). */
export function paintCampRuts(g, spec, sx, sz) {
  const { area, lanes = [], tracks = [], stains = [] } = spec;
  const R = rng(spec.seed ?? 1942);
  const X = (x) => (x - area.x0) * sx, Z = (z) => (z - area.z0) * sz;
  const stroke = (line, w, style, dash = null) => {
    g.beginPath();
    line.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
    g.lineWidth = Math.max(1.2, w * sx); g.lineCap = dash ? 'butt' : 'round'; g.lineJoin = 'round';
    g.setLineDash(dash ? dash.map((d) => d * sx) : []); g.strokeStyle = style; g.stroke();
  };
  const blob = (x, z, r, rgba) => {
    const gr = g.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), r * sx);
    gr.addColorStop(0, rgba); gr.addColorStop(1, rgba.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = gr; g.beginPath(); g.ellipse(X(x), Z(z), r * sx, r * sz * (0.6 + 0.4 * R()), R() * 3, 0, 6.2832); g.fill();
  };
  // 1. compacted lanes: the sand packed darker and greyer where the traffic runs, feathered by nested strokes (no canvas
  //    filter: a blur pass over the whole canvas per stroke cost ~20 ms each at load), with mottling
  for (const l of lanes) {
    const S = sampleTrack(l.pts, 1.5), line = S.map((p) => [p.x, p.z]);
    stroke(line, l.w + 2.4, `rgba(214, 196, 158, ${(0.18 * l.a).toFixed(3)})`); // loose sand thrown off the lane
    for (const [dw, k] of [[1.2, 0.2], [0.6, 0.25], [0, 0.3], [-0.7, 0.3], [-1.4, 0.3]]) stroke(line, Math.max(0.4, l.w + dw), `rgba(104, 90, 70, ${(k * l.a).toFixed(3)})`);
    for (let k = 0; k < S.length; k += 2) {
      const p = S[k], o = (R() - 0.5) * l.w * 0.8;
      blob(p.x - p.tz * o, p.z + p.tx * o, 0.8 + R() * 1.8, R() < 0.6 ? `rgba(78, 64, 46, ${(0.05 + R() * 0.06).toFixed(3)})` : `rgba(206, 188, 150, ${(0.05 + R() * 0.05).toFixed(3)})`);
    }
  }
  // 1b. scuff over the hardpan between the lanes (line extras): trampled blotches, tyre-scrub arcs, boot scuffs
  const ex = campRutsExtras(spec);
  for (const p of scuffPatches(spec, ex)) {
    blob(p.x, p.z, p.r, p.dark ? `rgba(92, 78, 58, ${p.a.toFixed(3)})` : `rgba(214, 198, 164, ${(p.a * 0.8).toFixed(3)})`);
    for (const m of p.marks) {
      if (m.kind === 'arc') stroke(m.pts, m.w, `rgba(84, 70, 52, ${m.a.toFixed(3)})`);
      else { g.save(); g.translate(X(m.x), Z(m.z)); g.rotate(m.rot); g.fillStyle = `rgba(80, 66, 48, ${m.a.toFixed(3)})`; g.beginPath(); g.ellipse(0, 0, 0.15 * sx, 0.06 * sz, 0, 0, 6.2832); g.fill(); g.restore(); }
    }
  }
  // 1c. where a road already runs, the lanes (and scuffs) are taken out again: the splat's road paint is the lane there
  //     (feathered: three nested strokes, each removing part of what is left)
  if (ex?.mask?.length) {
    g.save();
    g.globalCompositeOperation = 'destination-out';
    for (const m of ex.mask) {
      const line = sampleTrack(m.pts, 1).map((p) => [p.x, p.z]);
      for (const [dw, k] of [[2.2, 0.3], [1.1, 0.5], [0, 1]]) stroke(line, m.w + dw, `rgba(0, 0, 0, ${k})`);
    }
    g.restore();
  }
  // 2. tracks: tank ruts (cleated bands), lorry tyres (a wobbling line per wheel), drag marks (a soft scuffed band)
  for (const t of tracks) {
    const S = sampleTrack(t.pts, 0.6), half = (t.gauge ?? 0) / 2, ph = R() * 10, a = t.a ?? 0.3;
    for (const side of half ? [-1, 1] : [0]) {
      if (t.kind === 'track') {
        const w = t.w ?? 0.4, mid = offsetLine(S, side * half, 0.025, ph + side);
        stroke(offsetLine(S, side * (half + w / 2 + 0.1), 0.03, ph + side), 0.14, `rgba(222, 204, 166, ${(0.5 * a).toFixed(3)})`); // pushed-up sand
        stroke(mid, w, `rgba(82, 66, 47, ${(0.62 * a).toFixed(3)})`);
        stroke(mid, w * 0.86, `rgba(56, 45, 32, ${a})`, [0.17, 0.19]); // the track links' cleats
      } else if (t.kind === 'drag') {
        const line = offsetLine(S, side * half, 0.06, ph + side);
        stroke(line, (t.w ?? 0.6) + 0.3, `rgba(92, 76, 56, ${(0.4 * a).toFixed(3)})`);
        stroke(line, t.w ?? 0.6, `rgba(92, 76, 56, ${(0.7 * a).toFixed(3)})`);
      } else {
        stroke(offsetLine(S, side * half, 0.05, ph + side), t.w ?? 0.3, `rgba(66, 53, 38, ${a})`);
      }
    }
  }
  // 3. oil and fuel: dark soaked patches with a faint rainbow-less sheen ring
  for (const [x, z, r, a] of stains) {
    for (let k = 0; k < 3; k++) blob(x + (R() - 0.5) * r * 0.6, z + (R() - 0.5) * r * 0.6, r * (0.5 + R() * 0.5), `rgba(40, 32, 24, ${((a ?? 0.3) * (0.6 + R() * 0.4)).toFixed(3)})`);
    for (let k = 0; k < 4; k++) blob(x + (R() - 0.5) * r * 1.8, z + (R() - 0.5) * r * 1.8, r * (0.12 + R() * 0.2), `rgba(34, 27, 20, ${((a ?? 0.3) * 0.9).toFixed(3)})`); // drips
  }
}

/**
 * Which cells of a `step` m grid over the area carry paint: worked out from the spec itself (every lane, track and stain
 * stamped with its painted half-width, the blur and a cell of margin), so the canvas is never read back (a GPU canvas'
 * readback stalled the load for ~120 ms). Returns {cell: Uint8Array (row-major, nx × nz), nx, nz, step}.
 */
export function coverCells(spec, step = 1) {
  const { x0, x1, z0, z1 } = spec.area, nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step);
  const cell = new Uint8Array(nx * nz);
  const stamp = (x, z, r) => {
    const i0 = Math.max(0, Math.floor((x - r - x0) / step)), i1 = Math.min(nx - 1, Math.floor((x + r - x0) / step));
    const j0 = Math.max(0, Math.floor((z - r - z0) / step)), j1 = Math.min(nz - 1, Math.floor((z + r - z0) / step));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cell[j * nx + i] = 1;
  };
  for (const l of spec.lanes || []) for (const p of sampleTrack(l.pts, step / 2)) stamp(p.x, p.z, (l.w + 1.6) / 2 + 1 + step / 2);
  for (const t of spec.tracks || []) for (const p of sampleTrack(t.pts, step / 2)) stamp(p.x, p.z, (t.gauge ?? 0) / 2 + (t.w ?? 0.4) / 2 + 0.4 + step / 2);
  for (const [x, z, r] of spec.stains || []) stamp(x, z, r * 1.5 + step / 2);
  for (const p of scuffPatches(spec)) {
    stamp(p.x, p.z, p.r * 1.15 + step / 2);
    for (const m of p.marks) if (m.kind === 'arc') { for (const [x, z] of m.pts) stamp(x, z, m.w / 2 + 0.3 + step / 2); } else stamp(m.x, m.z, 0.3 + step / 2);
  }
  return { cell, nx, nz, step };
}

/**
 * The draped geometry over the covered cells: each vertex lifted `lift` m over the highest drawn ground within half a
 * cell of it, so the decal rides the sand's mounds and ripples (the terrain is not flat: ±0.5 m nebkhas under the scrub)
 * instead of sinking under them. UVs map the world onto the canvas (u = x, v = 1 at z0, the CanvasTexture's flipY).
 */
export function drapedGeometry(area, heightAt, cover, lift = 0.07) {
  const { x0, x1, z0, z1 } = area, W = x1 - x0, D = z1 - z0, { cell, nx, nz, step } = cover;
  const vid = new Int32Array((nx + 1) * (nz + 1)).fill(-1), pos = [], uv = [], idx = [];
  const vert = (i, j) => {
    const k = j * (nx + 1) + i;
    if (vid[k] >= 0) return vid[k];
    const x = Math.min(x1, x0 + i * step), z = Math.min(z1, z0 + j * step), r = step / 2;
    let h = -Infinity;
    for (const [dx, dz] of [[0, 0], [-r, -r], [r, -r], [-r, r], [r, r], [0, -r], [0, r], [-r, 0], [r, 0]]) h = Math.max(h, heightAt(x + dx, z + dz) || 0);
    vid[k] = pos.length / 3; pos.push(x, h + lift, z); uv.push((x - x0) / W, 1 - (z - z0) / D);
    return vid[k];
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (!cell[j * nx + i]) continue;
    const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The decal mesh (THREE.Mesh, `kit:camp-ruts`). In the browser it is draped on the drawn ground (`heightAt`, the
 * terrain's surfaceAt) over the covered cells only; in node (no canvas) it is a flat plane at `spec.y` with a plain
 * transparent material so the layout can be checked.
 */
export function buildCampRuts(spec, heightAt = null) {
  const { x0, x1, z0, z1 } = spec.area, W = x1 - x0, D = z1 - z0;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, opacity: HAS_DOM ? 1 : 0 });
  mat.name = 'kit:camp-ruts';
  let geo;
  if (HAS_DOM) {
    const px = spec.px ?? 12, cw = Math.min(MAX_W, Math.round(W * px)), ch = Math.round(cw * D / W);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    paintCampRuts(cv.getContext('2d'), spec, cw / W, ch / D);
    geo = drapedGeometry(spec.area, heightAt || (() => spec.y), coverCells(spec, 1), heightAt ? 0.07 : 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.name = 'camp-ruts';
    mat.map = tex;
    geo.addEventListener('dispose', () => { tex.dispose(); mat.dispose(); }); // the map's unload disposes geometries only
  } else {
    geo = new THREE.PlaneGeometry(W, D);
    geo.rotateX(-Math.PI / 2);                        // plane (x, y) → world (x, ·, −y): uv v = 1 at z0 (canvas row 0)
    geo.translate(x0 + W / 2, spec.y, z0 + D / 2);
  }
  const m = new THREE.Mesh(geo, mat);
  m.name = 'kit:camp-ruts';
  m.receiveShadow = true; m.castShadow = false;
  m.renderOrder = -1;
  m.userData.aoExclude = true;                        // a flat decal: nothing for the AO prepass
  m.userData.campRuts = { area: spec.area };
  return m;
}
