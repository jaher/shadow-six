/**
 * Ground-cover archetype meshes (docs/vegetation.md §3.1, §3.7): 10 seeded tuft shapes for the instanced grass system
 * instead of two. Every archetype is real 3D (curved blades, cupped forb leaves, seed panicles, reed stems with leaf
 * ribbons and plumes), shares one vertex layout and one material:
 *   position, normal, aBlade (t root→tip used for wind + shading, side -1/0/1 for sub-pixel widening, lateral xz),
 *   aPart (0 blade / leaf, 1 seed head / plume / awn).
 * @module terrain-b/grass-arch
 */
import * as THREE from 'three';
import { rng } from './noise.js';
import { GT } from './veg-profile.js';

/** Vertex/index accumulator. */
function makeBuf() { return { pos: [], nor: [], bl: [], part: [], idx: [] }; }

/**
 * Append one curved blade. Root at (bx, 0, bz), leaning out along angle `a`; centre line
 * c(t) = root + out·lean·h·t² , y(t) = h·(t − droop·t²) (+ y0). Width tapers to a point.
 * `tOff/tScl` remap the wind parameter (leaves on a reed stem bend with the stem).
 */
function blade(B, o) {
  const { bx, bz, a, h, w, lean = 0.3, droop = 0, face = a, seg = 4, y0 = 0, tOff = 0, tScl = 1, part = 0, taper = 0.85 } = o;
  const dx = Math.cos(a), dz = Math.sin(a);
  const lx = Math.cos(face + Math.PI / 2), lz = Math.sin(face + Math.PI / 2);
  const nx = Math.cos(face), nz = Math.sin(face);
  const base = B.pos.length / 3;
  for (let s = 0; s <= seg; s++) {
    const t = s / seg, tw = tOff + t * tScl;
    const cx = bx + dx * lean * h * t * t, cz = bz + dz * lean * h * t * t;
    const y = y0 + h * (t - droop * t * t);
    // normal: the blade face bent outward from the tuft centre and up (a tuft shades as one volume)
    const nX = nx * 0.55 + dx * 0.45, nZ = nz * 0.55 + dz * 0.45;
    if (s < seg) {
      const ww = w * (1 - t * taper);
      B.pos.push(cx - lx * ww, y, cz - lz * ww, cx + lx * ww, y, cz + lz * ww);
      B.nor.push(nX, 0.35, nZ, nX, 0.35, nZ);
      B.bl.push(tw, -1, lx, lz, tw, 1, lx, lz);
      B.part.push(part, part);
    } else {
      B.pos.push(cx, y, cz); B.nor.push(nX, 0.35, nZ); B.bl.push(tw, 0, lx, lz); B.part.push(part);
    }
  }
  for (let s = 0; s < seg - 1; s++) { const i = base + s * 2; B.idx.push(i, i + 1, i + 3, i, i + 3, i + 2); }
  const i = base + (seg - 1) * 2; B.idx.push(i, i + 1, i + 2);
  // returns the tip so seed heads can hang from it
  return { x: bx + dx * lean * h, z: bz + dz * lean * h, y: y0 + h * (1 - droop), dx, dz };
}

/** Small triangle (seed spikelet / plume barb / awn) hanging from p in direction (dx, dy, dz). */
function barb(B, p, d, len, w, t, part = 1) {
  const base = B.pos.length / 3;
  const lx = -d[2], lz = d[0], ll = Math.hypot(lx, lz) || 1;
  B.pos.push(p[0] - lx / ll * w, p[1], p[2] - lz / ll * w, p[0] + lx / ll * w, p[1], p[2] + lz / ll * w,
    p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len);
  for (let k = 0; k < 3; k++) { B.nor.push(d[0] * 0.3, 0.8, d[2] * 0.3); B.bl.push(t, 0, lx / ll, lz / ll); B.part.push(part); }
  B.idx.push(base, base + 1, base + 2);
}

/** Cupped, ovate leaf (forbs: plantain, clover, dock seedlings): 3 rows × 3 columns, edges raised, rising `elev`. */
function leaf(B, o) {
  const { a, L, W, elev, curl = 0.3, cup = 0.35, y0 = 0.004 } = o;
  const ca = Math.cos(a), sa = Math.sin(a), base = B.pos.length / 3;
  const rows = [0, 0.35, 0.7, 1];
  for (const u of rows) {
    const wu = W * Math.sin(Math.PI * Math.min(1, u * 0.95 + 0.05)) * (u < 1 ? 1 : 0);
    const along = L * u * Math.cos(elev), up = y0 + L * u * Math.sin(elev) - curl * L * u * u;
    for (const v of [-1, 0, 1]) {
      const lat = v * wu, lift = Math.abs(v) * wu * cup;
      B.pos.push(ca * along - sa * lat, up + lift, sa * along + ca * lat);
      B.nor.push(ca * 0.25 - sa * v * 0.3, 1, sa * 0.25 + ca * v * 0.3);
      B.bl.push(u * 0.6, 0, -sa, ca); B.part.push(0);
    }
  }
  for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < 2; c++) {
    const i = base + r * 3 + c;
    B.idx.push(i, i + 3, i + 1, i + 1, i + 3, i + 4);
  }
}

/** Grass panicle: spikelets along the top of a stem tip, nodding outward (seed heads, drinn awns). */
function panicle(B, tip, h, n, len, r, droopy = 0.6) {
  for (let k = 0; k < n; k++) {
    const f = k / n, y = tip.y - f * h * 0.22;
    const ang = r() * Math.PI * 2;
    const d = [Math.cos(ang) * 0.6 + tip.dx * 0.5, -droopy * (0.3 + 0.7 * r()), Math.sin(ang) * 0.6 + tip.dz * 0.5];
    const dl = Math.hypot(...d); d[0] /= dl; d[1] /= dl; d[2] /= dl;
    barb(B, [tip.x - tip.dx * f * 0.02, y, tip.z - tip.dz * f * 0.02], d, len * (0.6 + 0.6 * r()), len * 0.22, 1 - f * 0.22);
  }
}

export { makeBuf, blade, barb, leaf, panicle };

/** A tuft of `n` grass blades around the origin. */
function tuft(B, r, n, o) {
  for (let b = 0; b < n; b++) {
    const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * (o.radius ?? 0.09);
    const h = o.hMin + r() * (o.hMax - o.hMin);
    blade(B, {
      bx: Math.cos(a) * rad, bz: Math.sin(a) * rad, a, h, w: (o.wMin ?? 0.006) + r() * (o.wVar ?? 0.008),
      lean: (o.lean ?? 0.35) * (0.4 + r()), droop: (o.droop ?? 0) * (0.5 + r()), face: a + (r() - 0.5) * 1.2, seg: o.seg ?? 4,
    });
  }
}

/**
 * Archetype builders: (B, r, blades) → fills B. `blades` is the preset blade budget (5 low … 10 ultra).
 * Heights in metres before the per-instance scale.
 */
export const ARCHETYPES = {
  meadow: (B, r, n) => tuft(B, r, n, { hMin: 0.16, hMax: 0.44, lean: 0.35 }),
  straw: (B, r, n) => tuft(B, r, Math.max(4, n - 2), { hMin: 0.2, hMax: 0.52, lean: 0.55, droop: 0.12, wMin: 0.005 }),
  tussock: (B, r, n) => tuft(B, r, Math.round(n * 1.5), { hMin: 0.22, hMax: 0.58, lean: 0.55, droop: 0.18, radius: 0.06, wMin: 0.007, wVar: 0.006 }),
  flopped: (B, r, n) => tuft(B, r, n, { hMin: 0.22, hMax: 0.5, lean: 0.95, droop: 0.55, wMin: 0.005, radius: 0.07 }),
  snowpoke: (B, r, n) => tuft(B, r, Math.max(4, n - 3), { hMin: 0.1, hMax: 0.3, lean: 0.25, wMin: 0.004, wVar: 0.004, radius: 0.06 }),
  seedhead(B, r, n) {
    tuft(B, r, Math.max(3, n - 4), { hMin: 0.14, hMax: 0.34, lean: 0.45, droop: 0.1 });
    const stems = 2 + ((r() * 2) | 0);
    for (let k = 0; k < stems; k++) {
      const a = r() * Math.PI * 2, h = 0.5 + 0.32 * r();
      const tip = blade(B, { bx: Math.cos(a) * 0.03, bz: Math.sin(a) * 0.03, a, h, w: 0.0022, lean: 0.12 + 0.12 * r(), droop: 0.05, seg: 5, taper: 0.4 });
      panicle(B, tip, h, 7, 0.035, r, 0.7);
    }
  },
  forb(B, r) {
    const n = 5 + ((r() * 4) | 0), big = 0.75 + 0.5 * r();
    for (let k = 0; k < n; k++) {
      leaf(B, { a: (k / n) * 6.283 + r() * 0.6, L: (0.07 + 0.08 * r()) * big, W: (0.018 + 0.014 * r()) * big, elev: 0.55 + 0.5 * r(), curl: 0.12 + 0.2 * r() });
    }
    // a couple of upright inner leaves (rosette heart)
    for (let k = 0; k < 2; k++) leaf(B, { a: r() * 6.283, L: 0.08 * big, W: 0.012 * big, elev: 1.2, curl: 0.1 });
  },
  // marram tussock (critic round 1): many rolled, stiff blades fanning and arching out of a dense 0.4-0.6 m base
  marram: (B, r, n) => tuft(B, r, Math.round(n * 6), { hMin: 0.5, hMax: 1.1, lean: 0.85, droop: 0.38, radius: 0.24, wMin: 0.012, wVar: 0.007, seg: 5 }),
  drinn(B, r, n) {
    tuft(B, r, Math.round(n * 2), { hMin: 0.3, hMax: 0.8, lean: 0.75, droop: 0.2, radius: 0.1, wMin: 0.003, wVar: 0.0025, seg: 5 });
    for (let k = 0; k < 3; k++) { // feathery awned heads above the fountain
      const a = r() * Math.PI * 2, h = 0.7 + 0.3 * r();
      const tip = blade(B, { bx: Math.cos(a) * 0.04, bz: Math.sin(a) * 0.04, a, h, w: 0.002, lean: 0.25, droop: 0.08, seg: 5, taper: 0.4 });
      panicle(B, tip, h, 6, 0.06, r, 0.9);
    }
  },
  // farmland (bocage.js fields): a drill-row clump of ripe wheat (upright stalks, nodding ears) and cut stubble
  wheat(B, r) {
    const stalks = 7 + ((r() * 4) | 0);
    for (let k = 0; k < stalks; k++) {
      const a = r() * Math.PI * 2, rad = 0.05 * Math.sqrt(r()), h = 0.78 + 0.22 * r();
      const tip = blade(B, { bx: Math.cos(a) * rad, bz: Math.sin(a) * rad, a, h, w: 0.004, lean: 0.06 + 0.06 * r(), droop: 0.03, seg: 5, taper: 0.6 });
      panicle(B, tip, h, 5, 0.075, r, 0.25);
      blade(B, { bx: Math.cos(a) * rad, bz: Math.sin(a) * rad, y0: h * 0.35, a: a + 1.5, h: 0.22, w: 0.008, lean: 1.1, droop: 0.6, seg: 3, tOff: 0.35, tScl: 0.3 });
    }
  },
  stubble: (B, r, n) => {
    tuft(B, r, Math.round(n * 1.6), { hMin: 0.07, hMax: 0.15, lean: 0.12, radius: 0.08, wMin: 0.004, wVar: 0.002, seg: 2 });
    tuft(B, r, 3, { hMin: 0.18, hMax: 0.3, lean: 1.1, droop: 0.7, radius: 0.12, wMin: 0.004, wVar: 0.003, seg: 3 }); // loose straw
  },
  reed(B, r) {
    const stems = 3 + ((r() * 3) | 0);
    for (let k = 0; k < stems; k++) {
      const a = r() * Math.PI * 2, rad = 0.04 + 0.12 * r(), h = 1.6 + 1.0 * r();
      const bx = Math.cos(a) * rad, bz = Math.sin(a) * rad, lean = 0.03 + 0.05 * r();
      const tip = blade(B, { bx, bz, a, h, w: 0.0065, lean, seg: 6, taper: 0.45 });
      const leaves = 4 + ((r() * 3) | 0);
      for (let l = 0; l < leaves; l++) { // alternate leaf ribbons, arching out and drooping
        const tl = 0.18 + 0.6 * (l / leaves) + 0.05 * r(), la = a + (l % 2 ? Math.PI : 0) + (r() - 0.5) * 1.2;
        const sx = bx + Math.cos(a) * lean * h * tl * tl, sz = bz + Math.sin(a) * lean * h * tl * tl;
        blade(B, { bx: sx, bz: sz, y0: h * tl, a: la, h: 0.3 + 0.18 * r(), w: 0.011, lean: 1.4, droop: 0.75, seg: 3, tOff: tl, tScl: 0.25 });
      }
      // plume: a nodding, feathery panicle leaning to one side
      const side = a + (r() - 0.5);
      const pt = { ...tip, dx: Math.cos(side), dz: Math.sin(side) };
      panicle(B, pt, h, 9, 0.16, r, 0.75);
    }
  },
};

/** Build the InstancedBufferGeometry for an archetype (seeded, deterministic). */
export function archetypeGeometry(name, blades = 9, seed = 1) {
  const B = makeBuf();
  ARCHETYPES[name](B, rng(seed + 97 * (GT[name] ?? 0)), blades);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(B.bl, 4));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(B.part, 1));
  g.setIndex(B.idx);
  g.userData.archetype = name;
  return g;
}
