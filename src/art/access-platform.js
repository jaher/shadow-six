/**
 * Timber access platform with a stair (extra prop type `timber_platform`; M2 `plat_sw`, after the original's open
 * scaffold inside the river wall): a plank landing at `h` on four posts with joists, knee braces and a hand rail on
 * its open sides, and a straight stair (two stringers, plank treads, hand rails both sides, or the open side only with
 * `stair.outerRail: false` as M2 uses it) running down from one
 * end. Gameplay: the landing is a raised walkable deck (`elev` footprint) and the stair a graded strip of `elev`
 * footprints (≤ MAX_STEP between neighbouring cells), so units walk up and down it; the stair's open side is a
 * walk-only rail line (navOnly). Local frame as props.js (local +X = heading, +Z = heading + 90°), origin at the landing centre.
 * Params: w (along x), d (along z), h (deck top), stair {w, run, z, railSide, outerRail} leaving the +x edge toward +x,
 * rails: which landing edges carry a rail ('-x', '+z', '-z', '+x').
 * @module art/access-platform
 */

import * as THREE from 'three';
import { dressingMaterial } from './dressing.js';

function mk(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}
/** Box from a to b ([x, y, z]) with cross-section sw (local x of the box) × sh (local z). */
function beam(a, b, sw, sh, mat) {
  const A = new THREE.Vector3(...a), B3 = new THREE.Vector3(...b), L = A.distanceTo(B3);
  const m = mk(new THREE.BoxGeometry(sw, L, sh), mat);
  m.position.copy(A).add(B3).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B3.clone().sub(A).normalize());
  return m;
}

/** Stair geometry shared by the mesh and the footprints. */
export function stairOf(p) {
  const s = p.stair || {}, w = p.w ?? 2.2, h = p.h ?? 2.2;
  const run = s.run ?? h / 0.68, x0 = w / 2, n = Math.max(3, Math.round(h / 0.2));
  return { x0, x1: x0 + run, run, z: s.z ?? 0, w: s.w ?? 1.0, n, rise: h / n, tread: run / n, h };
}

/** The platform mesh in its local frame. */
export function buildAccessPlatform(p) {
  const w = p.w ?? 2.2, d = p.d ?? 1.4, h = p.h ?? 2.2, hw = w / 2, hd = d / 2, S = stairOf(p);
  const g = new THREE.Group(); g.name = 'access-platform';
  const planks = dressingMaterial('planks'), tar = dressingMaterial('logsTarred'), conc = dressingMaterial('concrete');
  // posts on concrete pads, a bearer each side, joists, deck planks (top at h)
  const posts = [[-hw + 0.1, -hd + 0.1], [hw - 0.1, -hd + 0.1], [-hw + 0.1, hd - 0.1], [hw - 0.1, hd - 0.1]];
  for (const [x, z] of posts) {
    g.add(beam([x, 0, z], [x, h - 0.06, z], 0.15, 0.15, tar));
    const pad = mk(new THREE.BoxGeometry(0.34, 0.16, 0.34), conc); pad.position.set(x, 0.05, z); g.add(pad);
  }
  for (const z of [-hd + 0.1, hd - 0.1]) { const b = mk(new THREE.BoxGeometry(w, 0.18, 0.12), tar); b.position.set(0, h - 0.2, z); g.add(b); }
  for (let k = 0; k <= 3; k++) { const j = mk(new THREE.BoxGeometry(0.1, 0.12, d), tar); j.position.set(-hw + 0.1 + (w - 0.2) * k / 3, h - 0.11, 0); g.add(j); }
  const n = Math.max(3, Math.round(w / 0.2)), pw = w / n;
  for (let i = 0; i < n; i++) { const pl = mk(new THREE.BoxGeometry(pw - 0.012, 0.045, d), planks); pl.position.set(-hw + pw * (i + 0.5), h - 0.0225, 0); g.add(pl); }
  // knee braces from the posts to the bearers (both faces along x), a cross brace on the short faces
  for (const [x, z] of posts) g.add(beam([x, h - 1.0, z], [x - Math.sign(x) * 0.7, h - 0.25, z], 0.08, 0.08, tar));
  for (const x of [-hw + 0.1, hw - 0.1]) g.add(beam([x, 0.3, -hd + 0.1], [x, h - 0.3, hd - 0.1], 0.06, 0.14, planks));
  // hand rails (posts + top and mid rails) on the requested landing edges; the stair mouth stays open
  const railY = h + 1.0, rails = p.rails || ['-z'];
  const rail = (a, b) => {
    for (const q of [a, b]) g.add(beam([q[0], h, q[1]], [q[0], railY + 0.04, q[1]], 0.08, 0.08, tar));
    g.add(beam([a[0], railY, a[1]], [b[0], railY, b[1]], 0.07, 0.05, planks));
    g.add(beam([a[0], h + 0.5, a[1]], [b[0], h + 0.5, b[1]], 0.05, 0.04, planks));
  };
  const E = { '-z': [[-hw + 0.04, -hd + 0.04], [hw - 0.04, -hd + 0.04]], '+z': [[-hw + 0.04, hd - 0.04], [hw - 0.04, hd - 0.04]],
    '-x': [[-hw + 0.04, -hd + 0.04], [-hw + 0.04, hd - 0.04]], '+x': [[hw - 0.04, -hd + 0.04], [hw - 0.04, hd - 0.04]] };
  for (const e of rails) if (E[e]) {
    let [a, b] = E[e];
    if (e === '-z' && S.z - S.w / 2 <= -hd + 0.1) b = [S.x0 - 0.05, b[1]]; // meets the stair rail
    if (e === '+z' && S.z + S.w / 2 >= hd - 0.1) b = [S.x0 - 0.05, b[1]];
    rail(a, b);
  }
  // the stair: two stringers, treads (rails below)
  const zs = [S.z - S.w / 2 + 0.04, S.z + S.w / 2 - 0.04];
  for (const z of zs) g.add(beam([S.x1 + 0.05, 0, z], [S.x0, h - 0.02, z], 0.24, 0.05, tar));
  for (let i = 1; i <= S.n; i++) {
    const y = h - S.rise * i, x = S.x0 + S.tread * (i - 0.5);
    if (y < 0.05) continue;
    const t = mk(new THREE.BoxGeometry(S.tread + 0.03, 0.04, S.w - 0.02), planks); t.position.set(x, y - 0.02, S.z); g.add(t);
  }
  // hand rails: both sides, or only the open side (`stair.outerRail: false`, a stair along a wall walk: the walk's
  // edge is its other side)
  const side = p.stair?.railSide ?? -1, railZ = p.stair?.outerRail === false ? zs.filter((z) => Math.sign(z - S.z) === side) : zs;
  for (const z of railZ) {
    g.add(beam([S.x1 - 0.1, 0, z], [S.x1 - 0.1, 1.0, z], 0.07, 0.07, tar));
    g.add(beam([S.x1 - 0.1, 0.98, z], [S.x0 + 0.05, h + 0.98, z], 0.06, 0.05, planks));
    g.add(beam([(S.x0 + S.x1) / 2, h / 2, z], [(S.x0 + S.x1) / 2, h / 2 + 0.98, z], 0.06, 0.06, tar));
  }
  return g;
}

/**
 * Gameplay footprints (world): the landing deck at h; the stair as overlapping slices whose `elev` falls with the
 * treads; a walk-only rail line along the stair's open side (`stair.railSide` −1: −z, +1: +z), past its edge, so
 * walkers step on at the foot only.
 */
export function accessPlatformFootprints(p, x, z, rot) {
  const w = p.w ?? 2.2, d = p.d ?? 1.4, h = p.h ?? 2.2, S = stairOf(p), c = Math.cos(rot), s = Math.sin(rot);
  const L2W = (lx, lz) => [x + lx * c - lz * s, z + lx * s + lz * c];
  // `ramp` (world/map-builder.js → grid.addRamp): walkers on the stair follow the line of its nosings, top → foot
  const [ax, az] = L2W(S.x0, S.z), [bx, bz] = L2W(S.x1, S.z);
  // (`stairs`: its treads, for world/stairs.js: a riser every `tread` m from the foot, `n` of them up to the deck)
  const out = [{ shape: 'rect', x, z, w, d, rot, elev: h, ramp: { ax, az, bx, bz, w: S.w, ya: h, yb: 0, stairs: { n: S.n, tread: S.tread } } }];
  for (let u = 0.12; u < S.run; u += 0.2) {
    const [cx, cz] = L2W(S.x0 + u, S.z), e = +(h * (1 - u / S.run)).toFixed(3);
    if (e < 0.12) break;
    out.push({ shape: 'rect', x: cx, z: cz, w: 0.3, d: S.w, rot, elev: e });
  }
  if (p.stairRail !== false) {
    const side = p.stair?.railSide ?? -1, zr = S.z + side * (S.w / 2 + 0.3);
    const a = L2W(S.x0 + 0.6, zr), b = L2W(S.x1 - 0.4, zr);
    out.push({ shape: 'line', points: [a, b], width: 0.3, navOnly: true }); // an open rail: walk-only, see-through
    // …and beside the rail's foot post (S.x1 − 0.1, on the stair's edge): the cells there are kept open as the stair
    // foot's step-on (nav: near the ramp), so a man coming from the rail side cut onto the stair through the post
    // (clipping audit, M2 seed 7: a runner up plat_sw's stair from the camp side) — walk-only too: he steps on at the foot
    const zf = S.z + side * (S.w / 2 + 0.12), f0 = L2W(S.x1 - 0.4, zf), f1 = L2W(S.x1 + 0.35, zf);
    out.push({ shape: 'line', points: [f0, f1], width: 0.3, navOnly: true });
  }
  return out;
}
