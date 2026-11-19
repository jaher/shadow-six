/**
 * Procedural Naples kit (LIGHTS OUT e02 "Curfew", Quartiere Scirocco, 1943): the old town's tufa houses, a palazzo,
 * a baroque church and its campanile, retaining walls with balustrades, stepped lanes, the aqueduct's stair-head.
 * Everything is sized from the mission's gameplay boxes, so the art never moves a cell; geometry goes into the shared
 * castle-kit `Geo` accumulator (one merged mesh per material per region, box-projected library textures, a tone /
 * grime field in the vertex colours) with Naples materials registered next to the castle's.
 *
 * Look (docs/expansion/e02.md §13): yellow tufa render (#c9a75a, ochre and rose variants), grey piperno for plinths,
 * portals and quoins, green louvred shutters, cast-iron balconies, flat roof terraces behind parapets or low tiled
 * hips, basalt setts underfoot. Node (unit tests): plain colours, no textures (castle-kit).
 * @module art/naples-kit
 */
import * as THREE from 'three';
import { Geo, CASTLE_SETS } from './castle-kit.js';
import { rng, seedOf } from './dressing.js';

/** Naples materials: [library set, tint, flat colour, metres per tile, normal strength] (castle-kit CASTLE_SETS). */
export const NAPLES_SETS = {
  np_tufa: ['plaster_rough', 0xd8b878, 0xc9a75a, 2.2, 0.9], // yellow tufa render
  np_tufaO: ['plaster_rough', 0xc99c62, 0xa8824a, 2.2, 0.9], // dirty ochre
  np_tufaR: ['plaster_rough', 0xc99a82, 0xb08068, 2.2, 0.9], // faded rose
  np_tufaW: ['plaster_limewash', 0xdfd2b2, 0xc8bc9e, 2.4, 0.7], // cream limewash
  np_tufaB: ['ashlar_limestone', 0xc4a462, 0xa48850, 1.9, 1.3], // bare tufa ashlar: retaining walls, the stair-head
  np_piperno: ['ashlar', 0x86888c, 0x595a5c, 1.6, 1.1], // grey volcanic stone: plinths, portals, quoins, steps
  np_basalt: ['setts_granite', 0x6a6b70, 0x2a2b2e, 1.8, 1.2], // basalt setts underfoot
  np_tile: ['roof_terracotta', 0xc89070, 0x8a4a34, 2.6, 1.0],
  np_screed: ['screed_lime', 0xbdb2a0, 0x8a8170, 2.6, 0.6], // flat roof terraces
  np_shutter: ['wood_paint', 0x6e9a72, 0x2f4f3a, 1.0, 0.9], // green louvred shutters
  np_shutterB: ['wood_paint', 0x8a6a48, 0x4a3524, 1.0, 0.9], // brown shutters
  np_door: ['door_planks', 0x7a5a40, 0x3a2818, 1.4, 1.0],
  np_iron: ['cast_iron', 0x4e4e4c, 0x262626, 0.8, 0.6],
  np_glass: ['glass_dirty', 0x3c464c, 0x1c2226, 1.0, 0.4],
  np_marble: ['limestone_smooth', 0xe8e2d4, 0xbdb6a6, 1.4, 0.6], // stucco trims, balusters
  np_majY: ['limestone_smooth', 0xf0c83a, 0xc8a020, 0.6, 0.5], // majolica tiles (glazed yellow)
  np_majG: ['limestone_smooth', 0x3f9468, 0x2a6a48, 0.6, 0.5], // and green
  np_cloth: ['tent_canvas', 0xf0ece0, 0xd8d2c4, 1.5, 0.3], // washing
  np_clothB: ['tent_canvas', 0x9ab0c8, 0x6a8098, 1.5, 0.3],
  np_timber: ['timber_beam', 0x9a8670, 0x4f4034, 1.5, 1.0],
  np_sack: ['burlap_bag', 0xcfc2a0, 0x8a7d5f, 0.8, 1.1],
  np_paint: ['steel_painted', 0x8a8f7e, 0x5d6253, 1.5, 0.7], // field grey
  np_tramO: ['wood_paint', 0xd8b050, 0xa88030, 1.6, 0.6], // the tram's ochre
  np_tramG: ['wood_paint', 0x5a7a5a, 0x2e4a34, 1.6, 0.6], // and its green
  np_char: ['plaster_rough', 0x3a3430, 0x1e1a18, 1.2, 1.2], // soot and char
  np_rust: ['rust_heavy', 0x8a6048, 0x5a3a28, 1.2, 1.0],
};
Object.assign(CASTLE_SETS, NAPLES_SETS);

export const WALLS = ['np_tufa', 'np_tufaO', 'np_tufaR', 'np_tufaW'];
const GROUND_FLOOR = 4.2, STOREY = 3.3;

// ---------------------------------------------------------------- frames
/** The four faces of an axis-aligned rect {x0, z0, x1, z1}: origin a, tangent t, outward n, length L. */
export function faces(r) {
  return [
    { side: 'N', a: [r.x0, r.z0], t: [1, 0], n: [0, -1], L: r.x1 - r.x0 },
    { side: 'S', a: [r.x0, r.z1], t: [1, 0], n: [0, 1], L: r.x1 - r.x0 },
    { side: 'W', a: [r.x0, r.z0], t: [0, 1], n: [-1, 0], L: r.z1 - r.z0 },
    { side: 'E', a: [r.x1, r.z0], t: [0, 1], n: [1, 0], L: r.z1 - r.z0 },
  ];
}
export const at = (f, u, w) => [f.a[0] + f.t[0] * u + f.n[0] * w, f.a[1] + f.t[1] * u + f.n[1] * w];
const rotOf = (f) => Math.atan2(f.t[1], f.t[0]);
/** Box on face f: along u0..u1, out of the wall w0..w1, y0..y1. */
export function fbox(G, mat, f, u0, u1, w0, w1, y0, y1, tone = 1) {
  if (u1 - u0 < 1e-3 || w1 - w0 < 1e-3 || y1 - y0 < 1e-3) return;
  const [cx, cz] = at(f, (u0 + u1) / 2, (w0 + w1) / 2);
  G.box(mat, cx, (y0 + y1) / 2, cz, u1 - u0, y1 - y0, w1 - w0, rotOf(f), tone);
}

/**
 * A box from a to b (world [x, y, z]): `width` across (horizontal, perpendicular to a→b), `thick` along the up
 * vector perpendicular to a→b — a sloping cornice, a stair stringer, a rail. Corners in Geo.box's order (right-handed
 * frame: ex along, ey up, ez = ex × ey), so its faces wind outward.
 */
export function slab3(G, mat, a, b, width, thick, tone = 1) {
  const ex = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const L = ex.length();
  if (L < 1e-4) return;
  ex.divideScalar(L);
  const ey = new THREE.Vector3(0, 1, 0).addScaledVector(ex, -ex.y);
  if (ey.lengthSq() < 1e-6) ey.set(1, 0, 0);
  ey.normalize();
  const ez = new THREE.Vector3().crossVectors(ex, ey);
  const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], hx = L / 2, hz = width / 2;
  const P = (lx, ly, lz) => [c[0] + ex.x * lx + ey.x * ly + ez.x * lz, c[1] + ex.y * lx + ey.y * ly + ez.y * lz, c[2] + ex.z * lx + ey.z * ly + ez.z * lz];
  const y0 = -thick / 2, y1 = thick / 2;
  G.hexa(mat, [P(-hx, y0, -hz), P(-hx, y0, hz), P(hx, y0, hz), P(hx, y0, -hz), P(-hx, y1, -hz), P(-hx, y1, hz), P(hx, y1, hz), P(hx, y1, -hz)], tone);
}

/** A ring in the vertical plane facing along ±x at (x, cy, cz): radii r0..r1, `depth` thick, `seg` segments (an oculus). */
export function ringX(G, mat, x, cy, cz, r0, r1, depth, seg = 12, tone = 1) {
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2, rm = (r0 + r1) / 2;
    // (every other segment 2 cm deeper: consecutive ones overlap at their ends, their faces in one plane)
    slab3(G, mat, [x, cy + Math.sin(a0) * rm, cz + Math.cos(a0) * rm], [x, cy + Math.sin(a1) * rm, cz + Math.cos(a1) * rm], depth + (k % 2) * 0.02, r1 - r0, tone);
  }
}

/** Spans [u0, u1] of face f whose outside (0.7 m out) is open (`ctx.open(x, z)`), sampled every 0.5 m. */
export function exposedSpans(f, ctx, out = 0.7) {
  const spans = [];
  let s0 = null;
  const n = Math.max(1, Math.round(f.L / 0.5));
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * f.L;
    const [x, z] = at(f, u, out);
    const open = ctx.open(x, z);
    if (open && s0 == null) s0 = u;
    if ((!open || i === n) && s0 != null) { const e = open ? u : u - f.L / n; if (e - s0 > 0.9) spans.push([s0, e]); s0 = null; }
  }
  return spans;
}

// ---------------------------------------------------------------- windows, doors, balconies
/**
 * A window on face f: glass flush, a stucco frame (sill, lintel with a little cornice, jambs), louvred shutters half
 * open (or closed), centred at u, sill at y. o: {w, h, shut, mat (shutter), frame, lit (collector for glow quads)}.
 */
export function windowAt(G, f, u, y, o = {}) {
  const w = o.w ?? 1.1, h = o.h ?? 2.0, R = o.R ?? Math.random, frame = o.frame ?? 'np_marble', sh = o.mat ?? 'np_shutter';
  const u0 = u - w / 2, u1 = u + w / 2;
  fbox(G, 'np_glass', f, u0, u1, 0.0, 0.03, y, y + h, 0.8 + R() * 0.25);
  // (sill: 2 cm deeper and 1.5 cm higher than a string course's face / top it may sit on — never in the same planes)
  fbox(G, frame, f, u0 - 0.14, u1 + 0.14, 0.0, 0.12, y - 0.12, y + 0.015, 0.95); // sill
  fbox(G, frame, f, u0 - 0.16, u1 + 0.16, 0.0, 0.12, y + h, y + h + 0.2, 1.0); // lintel
  // (jambs 0.09: proud of every shutter leaf's face, theirs or a neighbour window's folded over them, 0.07–0.08)
  fbox(G, frame, f, u0 - 0.12, u0, 0.0, 0.09, y, y + h, 0.97); // jambs
  fbox(G, frame, f, u1, u1 + 0.12, 0.0, 0.09, y, y + h, 0.97);
  const mode = o.shut ?? (R() < 0.35 ? 'shut' : R() < 0.5 ? 'half' : 'open');
  if (mode === 'shut') fbox(G, sh, f, u0 + 0.02, u1 - 0.02, 0.03, 0.08, y + 0.02, y + h - 0.02, 0.85 + R() * 0.2);
  else if (mode === 'half') {
    fbox(G, sh, f, u0 + 0.02, u + 0.02, 0.03, 0.08, y + 0.02, y + h - 0.02, 0.85 + R() * 0.2);
    fbox(G, sh, f, u1 + 0.13, u1 + 0.13 + w / 2, 0.02, 0.07, y + 0.02, y + h - 0.02, 0.85 + R() * 0.2);
  } else {
    fbox(G, sh, f, u0 - 0.13 - w / 2, u0 - 0.13, 0.02, 0.07, y + 0.02, y + h - 0.02, 0.85 + R() * 0.2);
    fbox(G, sh, f, u1 + 0.13, u1 + 0.13 + w / 2, 0.02, 0.07, y + 0.02, y + h - 0.02, 0.85 + R() * 0.2);
  }
  if (o.lit && mode !== 'open') o.lit.push({ f, u0: u0 + 0.1, u1: u1 - 0.1, y0: y + 0.15, y1: y + h - 0.2, w: 0.09 });
}

/** A cast-iron balcony on face f: piperno slab on brackets, railing of bars, centred at u, floor at y. */
export function balconyAt(G, f, u, y, o = {}) {
  const w = o.w ?? 1.7, d = o.d ?? 0.75, u0 = u - w / 2, u1 = u + w / 2, rail = 0.95;
  fbox(G, 'np_piperno', f, u0, u1, 0, d, y - 0.14, y, 0.95);
  for (const s of [u0 + 0.18, u1 - 0.18]) fbox(G, 'np_piperno', f, s - 0.08, s + 0.08, 0, d * 0.8, y - 0.42, y - 0.14, 0.9); // brackets
  fbox(G, 'np_iron', f, u0, u1, d - 0.05, d, y + rail - 0.05, y + rail, 0.9); // top rail
  fbox(G, 'np_iron', f, u0, u1, d - 0.05, d, y + 0.08, y + 0.12, 0.9); // bottom rail
  // (returns stop at the rails' back face; bars stop under the top rail, the side bars just inside the returns' ends:
  // no two irons share a face plane)
  for (const s of [u0, u1 - 0.05]) fbox(G, 'np_iron', f, s, s + 0.05, 0.05, d - 0.05, y + rail - 0.05, y + rail, 0.9); // returns
  for (const s of [u0, u1 - 0.05]) fbox(G, 'np_iron', f, s, s + 0.05, 0.05, d - 0.05, y + 0.08, y + 0.12, 0.9);
  const nb = Math.max(3, Math.round(w / 0.24));
  for (let i = 0; i <= nb; i++) { const s = u0 + 0.02 + ((w - 0.06) * i) / nb; fbox(G, 'np_iron', f, s, s + 0.025, d - 0.045, d - 0.02, y, y + rail - 0.05, 0.85); }
  for (const s of [0.3, 0.55]) for (const e of [u0 + 0.012, u1 - 0.037]) fbox(G, 'np_iron', f, e, e + 0.025, s, s + 0.025, y, y + rail - 0.05, 0.85);
  // a few pots on the slab (geraniums in terracotta), or the household's washing on a line along the rail
  if (o.pots) for (const k of [0.25, 0.75]) fbox(G, 'np_tile', f, u0 + w * k - 0.12, u0 + w * k + 0.12, 0.25, 0.49, y, y + 0.25, 0.9);
}

/** A ground-floor doorway on face f (a basso's door under a stone arch block), centred at u from ground y. */
export function doorAt(G, f, u, y, o = {}) {
  const w = o.w ?? 1.4, h = o.h ?? 2.7, u0 = u - w / 2, u1 = u + w / 2, R = o.R ?? Math.random;
  fbox(G, 'np_door', f, u0, u1, 0.0, 0.05, y, y + h, 0.75 + R() * 0.3);
  fbox(G, 'np_piperno', f, u0 - 0.28, u0, 0.0, 0.12, y, y + h + 0.1, 0.95);
  fbox(G, 'np_piperno', f, u1, u1 + 0.28, 0.0, 0.12, y, y + h + 0.1, 0.95);
  fbox(G, 'np_piperno', f, u0 - 0.32, u1 + 0.32, 0.0, 0.16, y + h, y + h + 0.42, 1.0);
  fbox(G, 'np_piperno', f, u0 - 0.1, u1 + 0.1, 0.0, 0.25, y, y + 0.12, 0.9); // threshold
}

/** A shop front: a rolled-down iron shutter in a piperno frame (blackout), a painted sign band above. */
export function shopAt(G, f, u, y, o = {}) {
  const w = o.w ?? 2.6, h = o.h ?? 3.0, u0 = u - w / 2, u1 = u + w / 2, R = o.R ?? Math.random;
  // (the shutter 15 mm proud of the house's plinth: its face was in the plinth's plane)
  fbox(G, 'np_rust', f, u0, u1, 0.0, 0.075, y, y + h, 0.8 + R() * 0.3);
  for (let k = 1; k < 12; k++) fbox(G, 'np_iron', f, u0, u1, 0.075, 0.095, y + (h * k) / 12 - 0.02, y + (h * k) / 12, 0.7); // slats
  // (the jambs stop under the sign band: their tops and outer sides were in the band's planes)
  fbox(G, 'np_piperno', f, u0 - 0.3, u0, 0.0, 0.14, y, y + h, 0.95);
  fbox(G, 'np_piperno', f, u1, u1 + 0.3, 0.0, 0.14, y, y + h, 0.95);
  fbox(G, 'np_marble', f, u0 - 0.3, u1 + 0.3, 0.0, 0.18, y + h, y + h + 0.6, 0.85 + R() * 0.2);
}

// ---------------------------------------------------------------- houses
/**
 * One tufa house: rect {x0, z0, x1, z1}, its top y1, standing on the level y0 (its walls go down to the lowest ground
 * round it: a face over a lower street gets its own lower storeys). ctx: {open(x, z), groundY(x, z), lit: []}.
 * o: {seed, mat, roof: 'flat'|'hip', shops, balconies, lod}.
 */
export function buildHouse(G, r, y1, ctx, o = {}) {
  const R = rng(seedOf(o.seed ?? `${r.x0},${r.z0}`));
  const mat = o.mat ?? WALLS[Math.floor(R() * WALLS.length)];
  const sh = R() < 0.82 ? 'np_shutter' : 'np_shutterB';
  const F = faces(r);
  // the lowest ground round the house: its walls start there
  let yb = Infinity;
  for (const f of F) for (const k of [0.15, 0.5, 0.85]) { const [x, z] = at(f, f.L * k, 0.8); yb = Math.min(yb, ctx.groundY(x, z)); }
  if (!Number.isFinite(yb)) yb = 0;
  G.box(mat, (r.x0 + r.x1) / 2, (yb + y1) / 2, (r.z0 + r.z1) / 2, r.x1 - r.x0, y1 - yb, r.z1 - r.z0, 0, 0.92 + R() * 0.16);
  for (const f of F) {
    const spans = exposedSpans(f, ctx);
    if (!spans.length) continue;
    for (const [s0, s1] of spans) {
      const [mx, mz] = at(f, (s0 + s1) / 2, 0.8), yg = ctx.groundY(mx, mz);
      // plinth, string courses at the floor lines, the cornice
      fbox(G, 'np_piperno', f, s0, s1, 0, 0.06, yg, yg + 0.75, 0.95);
      const floors = Math.max(0, Math.floor((y1 - yg - GROUND_FLOOR - 0.8) / STOREY) + 1);
      for (let k = 0; k < floors; k++) {
        const fy = yg + GROUND_FLOOR + k * STOREY;
        if (fy > y1 - 1.6) break;
        fbox(G, 'np_marble', f, s0, s1, 0, 0.1, fy - 0.1, fy + 0.06, 0.9);
      }
      // (the W / E faces' cornice 12 mm under the N / S faces': where two meet over a corner their tops never coincide)
      // (and every other house of a block 3 cm deeper and 6 mm lower: neighbours' cornices run on over each other's)
      const odd = (o.k ?? 0) % 2, cy = (f.side === 'W' || f.side === 'E' ? -0.012 : 0) - odd * 0.006, cd = odd * 0.03;
      // (it runs on round a corner, not on along a neighbour's front: there it lay in the neighbour's cornice planes)
      const e0 = s0 < 0.05 && !ctx.open(...at(f, -0.6, -0.6)) ? 0 : 1, e1 = s1 > f.L - 0.05 && !ctx.open(...at(f, f.L + 0.6, -0.6)) ? 0 : 1;
      fbox(G, 'np_marble', f, s0 - 0.25 * e0, s1 + 0.25 * e1, 0, 0.32 + cd, y1 - 0.45 + cy, y1 - 0.15 + cy, 0.95);
      fbox(G, 'np_marble', f, s0 - 0.3 * e0, s1 + 0.3 * e1, 0, 0.42 + cd, y1 - 0.15 + cy, y1 + cy, 1.0);
      if (o.lod) continue;
      // bays every ~3 m
      const L = s1 - s0, nb = Math.max(1, Math.floor((L - 0.6) / 2.9)), step = L / nb;
      for (let b = 0; b < nb; b++) {
        const u = s0 + step * (b + 0.5);
        // ground floor: doors, shop shutters on a wide street, small barred windows
        const gk = R();
        if (o.shops && gk < 0.45 && step > 3.0) shopAt(G, f, u, yg, { R, w: Math.min(2.6, step - 0.7) });
        else if (gk < 0.75) doorAt(G, f, u, yg, { R });
        else windowAt(G, f, u, yg + 1.5, { R, w: 0.9, h: 1.4, mat: sh, shut: 'shut' });
        for (let k = 0; k < floors; k++) {
          const fy = yg + GROUND_FLOOR + k * STOREY;
          if (fy > y1 - 2.4) break;
          const balc = (o.balconies ?? 0.4) > R() && fy < y1 - 3;
          if (balc) {
            windowAt(G, f, u, fy + 0.06, { R, w: 1.05, h: 2.35, mat: sh, lit: ctx.lit && R() < 0.05 ? ctx.lit : null });
            balconyAt(G, f, u, fy, { w: Math.min(1.9, step - 0.5), pots: R() < 0.4 });
          } else windowAt(G, f, u, fy + 0.85, { R, w: 1.05, h: 1.75, mat: sh, lit: ctx.lit && R() < 0.04 ? ctx.lit : null });
        }
      }
    }
  }
  // roof
  if ((o.roof ?? (R() < 0.7 ? 'flat' : 'hip')) === 'flat') flatRoof(G, r, y1, R, mat, o);
  else hipRoof(G, r, y1, R);
  return mat;
}

/**
 * A flat roof terrace, lived on: screed patched where it was mended, a parapet of uneven height (a coping on it, a
 * bite out of it here and there), a stair-hut, water tanks, chimney stacks on the parapet, and the terrace's life —
 * a washing line with the week's sheets, pots of herbs along the parapet, crates and a broken chair, a cane pergola.
 * Every roof draws its own lot from its seed: no two alike.
 */
export function flatRoof(G, r, y, R, mat = 'np_tufa', o = {}) {
  const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  G.box('np_screed', cx, y + 0.04, cz, w - 0.1, 0.08, d - 0.1, 0, 0.9 + R() * 0.15);
  // mended patches of screed and laid tiles, each its own tone (the slab never reads as one sheet)
  const np = 4 + Math.floor(R() * 5), laid = [];
  for (let k = 0; k < np; k++) {
    const pw = 0.6 + R() * Math.min(3.5, w * 0.45), pd = 0.6 + R() * Math.min(3.5, d * 0.45);
    const px = r.x0 + 0.5 + pw / 2 + R() * Math.max(0.01, w - pw - 1), pz = r.z0 + 0.5 + pd / 2 + R() * Math.max(0.01, d - pd - 1);
    const tiled = R() < 0.14;
    R(); // (was a random lift: each patch now lies on its own layer, 4 mm over any patch it overlaps — two at the same
    // height, or a millimetre apart, flickered)
    const pr = Math.hypot(pw, pd) / 2;
    let L = 0;
    while (laid.some((q) => q.L === L && Math.hypot(q.x - px, q.z - pz) < q.r + pr)) L++;
    laid.push({ x: px, z: pz, r: pr, L });
    G.box(tiled ? 'np_tile' : 'np_screed', px, y + 0.09 + L * 0.004, pz, pw, 0.02, pd, (R() - 0.5) * 0.12, tiled ? 0.55 + R() * 0.25 : 0.55 + R() * 0.6);
  }
  // damp: dark streaks where the rain stands along the parapet's foot
  for (const f of faces(r)) if (R() < 0.6) {
    const u0 = R() * f.L * 0.5, u1 = Math.min(f.L, u0 + 1 + R() * f.L * 0.5);
    // (between the side parapets' inner faces: an end on the wall's outer plane lay in a side parapet's outer face)
    const st = f.side === 'N' || f.side === 'S' ? 0.088 : 0.084; // (two sides' streaks cross in a corner: not at one height)
    fbox(G, 'np_char', f, Math.max(0.34, u0), Math.min(f.L - 0.34, u1), -0.32 - 0.3 - R() * 0.5, -0.325, y + 0.08, y + st, 0.35 + R() * 0.25); // (under every patch's top)
  }
  // the parapet: each side its own height, some with a bite out of the coping (a terrace people lie on in play — noHut —
  // keeps a whole parapet of one height: what hides a man there must look as if it does)
  for (const f of faces(r)) {
    const ph = o.noHut ? 0.85 : 0.7 + R() * 0.35;
    const bite = !o.noHut && f.L > 4 && R() < 0.35 ? [0.8 + R() * (f.L - 2.6), 0.6 + R() * 0.8] : null;
    const runs = bite ? [[0, bite[0]], [bite[0] + bite[1], f.L]] : [[0, f.L]];
    // (the N / S runs own the corners: a W / E run stops short of them, its parapet at their inner face and its coping
    // at their coping's — two runs overlapping on a corner put faces in one plane, the outer and the end, or the tops)
    const ns = f.side === 'N' || f.side === 'S';
    for (const [u0, u1] of runs) {
      const a0 = !ns && u0 === 0, a1 = !ns && u1 === f.L;
      fbox(G, mat, f, u0 + (a0 ? 0.32 : 0), u1 - (a1 ? 0.32 : 0), -0.32, 0, y, y + ph, 0.9 + R() * 0.1);
      fbox(G, 'np_marble', f, u0 === 0 ? (ns ? -0.05 : 0.38) : u0, u1 === f.L ? (ns ? f.L + 0.05 : f.L - 0.38) : u1, -0.38, 0.06, y + ph, y + ph + 0.1, 0.82 + R() * 0.12);
    }
    if (bite) fbox(G, mat, f, bite[0], bite[0] + bite[1], -0.32, 0, y, y + ph * (0.35 + R() * 0.3), 0.8);
    // chimney stacks standing on the parapet
    if (!o.noHut && f.L > 3 && R() < 0.4) {
      const u = 0.6 + R() * (f.L - 1.2), [x, z] = at(f, u, -0.3);
      const ch = 0.9 + R() * 0.9;
      G.box(mat, x, y + ph + ch / 2, z, 0.55, ch, 0.55, 0, 0.85);
      G.box('np_tile', x, y + ph + ch + 0.06, z, 0.75, 0.12, 0.75, 0, 0.8);
      G.box('np_char', x, y + ph + ch + 0.02, z, 0.3, 0.06, 0.3, 0, 0.9);
    }
  }
  if (o.noHut) return;
  const free = (m) => [r.x0 + m + R() * Math.max(0.01, w - 2 * m), r.z0 + m + R() * Math.max(0.01, d - 2 * m)];
  if (w > 4.5 && d > 4.5 && R() < 0.75) {
    const hx = r.x0 + 1.4 + R() * (w - 4.2), hz = r.z0 + 1.4 + R() * (d - 4.2);
    G.box(mat, hx + 0.9, y + 1.15, hz + 0.9, 1.8, 2.3, 1.8, 0, 0.95);
    G.box('np_screed', hx + 0.9, y + 2.35, hz + 0.9, 2.0, 0.12, 2.0, 0, 0.9);
    G.box('np_door', hx + 0.9, y + 1.0, hz - 0.01, 0.8, 1.9, 0.04, 0, 0.8);
  }
  // water tanks, one or two
  for (let k = 0, n = R() < 0.55 ? 1 + (R() < 0.3 ? 1 : 0) : 0; k < n; k++) {
    const [tx, tz] = free(1);
    const rt = 0.45 + R() * 0.2;
    G.cyl(R() < 0.5 ? 'np_paint' : 'np_rust', tx, y + 0.1, tz, rt, rt, 1.0 + R() * 0.3, 10, 0.75);
    G.cyl('np_paint', tx, y + 1.2, tz, rt + 0.02, 0.1, 0.18, 10, 0.7);
  }
  // the washing: two poles, a line, the sheets and shirts on it
  if (w > 3 && d > 3 && R() < 0.5) {
    const along = w >= d, L = (along ? w : d) - 1.4, [ax, az] = free(0.7);
    const a = along ? [r.x0 + 0.7, az] : [ax, r.z0 + 0.7], b = along ? [r.x0 + 0.7 + L, az] : [ax, r.z0 + 0.7 + L];
    for (const q of [a, b]) G.box('np_timber', q[0], y + 1.0, q[1], 0.07, 1.9, 0.07, 0, 0.8);
    G.box('np_iron', (a[0] + b[0]) / 2, y + 1.9, (a[1] + b[1]) / 2, along ? L : 0.016, 0.02, along ? 0.016 : L, 0, 0.7); // (thinner than a sheet on it)
    const n = 2 + Math.floor(R() * 4);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5 + (R() - 0.5) * 0.4) / n, hx = a[0] + (b[0] - a[0]) * t, hz = a[1] + (b[1] - a[1]) * t;
      const cw = 0.45 + R() * 0.8, ch = 0.4 + R() * 0.6;
      const off = ((k % 3) - 1) * 0.03; // (neighbours hang either side of the line: overlapping sheets in one plane flicker)
      G.box(R() < 0.6 ? 'np_cloth' : 'np_clothB', hx + (along ? 0 : off), y + 1.9 - ch / 2, hz + (along ? off : 0), along ? cw : 0.02, ch, along ? 0.02 : cw, (R() - 0.5) * 0.06, 0.75 + R() * 0.3);
    }
  }
  // pots of herbs and geraniums along the parapet
  if (R() < 0.55) {
    const f = faces(r)[Math.floor(R() * 4)], n = 2 + Math.floor(R() * 5);
    for (let k = 0; k < n; k++) {
      const u = 0.5 + R() * Math.max(0.1, f.L - 1), [x, z] = at(f, u, -0.65), ps = 0.18 + R() * 0.14;
      G.cyl('np_tile', x, y + 0.08, z, ps, ps * 0.8, ps * 1.6, 7, 0.75 + R() * 0.25);
      G.box('np_majG', x, y + 0.1 + ps * 1.7, z, ps * 1.6, ps * 0.9, ps * 1.6, R(), 0.45 + R() * 0.25);
    }
  }
  // crates, a sack, a broken chair
  if (R() < 0.45) {
    const [x, z] = free(0.9);
    G.box('np_timber', x, y + 0.3, z, 0.6, 0.45, 0.45, R() * 3, 0.65 + R() * 0.3);
    if (R() < 0.6) G.box('np_sack', x + 0.5, y + 0.2, z + 0.3, 0.5, 0.3, 0.35, R() * 3, 0.8);
    if (R() < 0.4) { G.box('np_timber', x - 0.6, y + 0.5, z, 0.42, 0.05, 0.42, 0.3, 0.6); G.box('np_timber', x - 0.6, y + 0.25, z + 0.18, 0.4, 0.5, 0.04, 0.3, 0.6); }
  }
  // a cane pergola over a corner, a dry vine on it
  if (w > 5 && d > 5 && R() < 0.22) {
    const sx = R() < 0.5 ? r.x0 + 0.6 : r.x1 - 3.1, sz = R() < 0.5 ? r.z0 + 0.6 : r.z1 - 3.1;
    for (const [dx, dz] of [[0, 0], [2.5, 0], [0, 2.5], [2.5, 2.5]]) G.box('np_timber', sx + dx, y + 1.1, sz + dz, 0.08, 2.2, 0.08, 0, 0.7);
    for (let k = 0; k < 6; k++) G.box('np_timber', sx + 1.25, y + 2.22, sz + k * 0.5, 2.7, 0.04, 0.05, 0, 0.75);
    G.box('np_majG', sx + 1.25, y + 2.3, sz + 1.25, 2.2, 0.08, 1.6, 0.4, 0.35);
  }
}

/**
 * Wear on the paving (render only): patches of re-laid setts and of piperno slabs, each its own tone; sunk setts dark
 * with the damp; paper blown about (leaflets, a torn notice); grit and a broken tile. Only where `ctx.open(x, z)` and
 * `keep(x, z)` agree (no house, no stair, no prop).
 */
export function groundWear(G, ctx, R, { x0, z0, x1, z1, y, n = 60, keep = () => true }) {
  const pick = () => {
    for (let k = 0; k < 12; k++) {
      const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
      if (ctx.open(x, z) && keep(x, z)) return [x, z];
    }
    return null;
  };
  // each piece of wear lies on its own layer, 4 mm over the one under it: the lowest layer no piece it overlaps (bounding
  // circles) already holds — two pieces flush on one plane, or 1 mm apart, flickered against each other
  const placed = [];
  const layer = (x, z, r) => {
    let L = 0;
    while (placed.some((p) => p.L === L && Math.hypot(p.x - x, p.z - z) < p.r + r + 0.05)) L++;
    placed.push({ x, z, r, L });
    return y + 0.008 + L * 0.004;
  };
  for (let i = 0; i < n; i++) {
    const p = pick();
    if (!p) continue;
    const [x, z] = p, kind = R();
    if (kind < 0.42) {
      // a patch of re-laid setts or of slabs, its own tone
      const slab = R() < 0.3, pw = 0.7 + R() * 2.4, pd = 0.6 + R() * 1.6, rot = R() * Math.PI, tone = slab ? 0.5 + R() * 0.3 : 0.72 + R() * 0.48;
      const top = layer(x, z, Math.hypot(pw, pd) / 2);
      G.box(slab ? 'np_piperno' : 'np_basalt', x, top - 0.006, z, pw, 0.012, pd, rot, tone);
    } else if (kind < 0.68) {
      // setts sunk and dark with the damp that stands in them: a few round lobes run together
      for (let k = 0, nl = 2 + Math.floor(R() * 3); k < nl; k++) {
        const rr = 0.25 + R() * 0.5, lx = x + (R() - 0.5) * 0.9, lz = z + (R() - 0.5) * 0.9;
        G.cyl('np_basalt', lx, layer(lx, lz, rr) - 0.006, lz, rr, rr, 0.006, 10, 0.55 + R() * 0.15);
      }
    } else if (kind < 0.87) {
      // paper: leaflets, a torn notice
      for (let k = 0, np = 1 + Math.floor(R() * 4); k < np; k++) {
        const px = x + (R() - 0.5) * 1.3, pz = z + (R() - 0.5) * 1.3;
        G.box('np_cloth', px, layer(px, pz, 0.19) - 0.002, pz, 0.21, 0.004, 0.3, R() * Math.PI, 0.55 + R() * 0.4);
      }
    } else {
      // grit, a lump of tufa, a broken tile
      for (let k = 0, ng = 3 + Math.floor(R() * 5); k < ng; k++) {
        const q = 0.06 + R() * 0.14;
        G.box(R() < 0.6 ? 'np_tufaB' : 'np_tile', x + (R() - 0.5) * 0.8, y + q * 0.3, z + (R() - 0.5) * 0.8, q, q * 0.6, q * 1.3, R() * Math.PI, 0.7 + R() * 0.3);
      }
    }
  }
}

/** A convex polygon (world [x, y, z] points) as a triangle fan wound so its normal faces `out` ([x, y, z]). */
export function facePoly(G, mat, pts, out, tone = 1) {
  const [a, b, c] = pts, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const p = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0 ? pts.slice().reverse() : pts;
  for (let i = 1; i + 1 < p.length; i++) G.tri(mat, p[0], p[i], p[i + 1], tone);
}

/** A low hipped roof of terracotta pantiles (pitch ~22°), eaves 0.35 m out. */
export function hipRoof(G, r, y, R) {
  const o = 0.35, x0 = r.x0 - o, x1 = r.x1 + o, z0 = r.z0 - o, z1 = r.z1 + o, w = x1 - x0, d = z1 - z0;
  const h = Math.min(w, d) * 0.5 * Math.tan((22 * Math.PI) / 180), t = R() * 0.1 + 0.92;
  const along = w >= d, half = Math.min(w, d) / 2;
  const a = along ? [x0 + half, (z0 + z1) / 2] : [(x0 + x1) / 2, z0 + half], b = along ? [x1 - half, (z0 + z1) / 2] : [(x0 + x1) / 2, z1 - half];
  const A = [a[0], y + h, a[1]], B = [b[0], y + h, b[1]];
  const c00 = [x0, y, z0], c10 = [x1, y, z0], c11 = [x1, y, z1], c01 = [x0, y, z1];
  if (along) {
    facePoly(G, 'np_tile', [c00, c10, B, A], [0, 1, -1], t); facePoly(G, 'np_tile', [c11, c01, A, B], [0, 1, 1], t);
    facePoly(G, 'np_tile', [c01, c00, A], [-1, 1, 0], t); facePoly(G, 'np_tile', [c10, c11, B], [1, 1, 0], t);
  } else {
    facePoly(G, 'np_tile', [c00, c01, B, A], [-1, 1, 0], t); facePoly(G, 'np_tile', [c11, c10, A, B], [1, 1, 0], t);
    facePoly(G, 'np_tile', [c10, c00, A], [0, 1, -1], t); facePoly(G, 'np_tile', [c01, c11, B], [0, 1, 1], t);
  }
  // the eaves' soffit and a ridge of capping tiles
  // (the soffit inside the cornices' overhang and under their tops — the cornice (0.42 out, its top at the eaves) hid its
  // band anyway; flush with them its faces lay in the cornices' planes)
  G.box('np_tile', (x0 + x1) / 2, y - 0.16, (z0 + z1) / 2, w - 0.12, 0.1, d - 0.12, 0, 0.7);
  const L = Math.hypot(B[0] - A[0], B[2] - A[2]);
  if (L > 0.2) G.box('np_tile', (A[0] + B[0]) / 2, y + h + 0.06, (A[2] + B[2]) / 2, L + 0.2, 0.14, 0.24, Math.atan2(B[2] - A[2], B[0] - A[0]), 0.85);
}

/**
 * A block of houses: rect split along its long side into houses 6–10 m wide, each with its own height (top0 minus up
 * to `drop` m), render, roof. o: {seed, drop, shops, lod, roof}.
 */
export function buildBlock(G, r, top, ctx, o = {}) {
  const R = rng(seedOf(o.seed ?? `${r.x0},${r.z0},blk`));
  const w = r.x1 - r.x0, d = r.z1 - r.z0, along = w >= d;
  // a deep block is two rows back to back (front and back houses), each split along the street into houses 6–10 m
  const deep = (along ? d : w) > 15;
  const rows = deep ? [[0, 0.5 + (R() - 0.5) * 0.15], [null, 1]] : [[0, 1]];
  if (deep) rows[1][0] = rows[0][1];
  let prevMat = null, k = 0;
  for (const [f0, f1] of rows) {
    const cuts = [0], L = along ? w : d;
    while (L - cuts[cuts.length - 1] > 11) cuts.push(cuts[cuts.length - 1] + 6 + R() * 4);
    cuts.push(L);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i], b = cuts[i + 1];
      const h = along ? { x0: r.x0 + a, x1: r.x0 + b, z0: r.z0 + d * f0, z1: r.z0 + d * f1 } : { x0: r.x0 + w * f0, x1: r.x0 + w * f1, z0: r.z0 + a, z1: r.z0 + b };
      let mat = WALLS[Math.floor(R() * WALLS.length)];
      if (mat === prevMat) mat = WALLS[(WALLS.indexOf(mat) + 1) % WALLS.length];
      prevMat = mat;
      const y = top - (o.drop ?? 1.4) * R() - (deep && f0 > 0 ? R() * 1.5 : 0);
      buildHouse(G, h, y, ctx, { ...o, seed: `${o.seed ?? ''}:${k}`, k: k++, mat });
    }
  }
}

// ---------------------------------------------------------------- the palazzo
/**
 * A palazzo wing: rusticated piperno ground floor, piano nobile with balconies under pediments, attic windows, a deep
 * cornice. r: rect, y0: its level, y1: top. o: {seed, courtyard: side facing the courtyard ('N'|'S'|'E'|'W'), portals}.
 */
export function buildPalazzoWing(G, r, y0, y1, ctx, o = {}) {
  const R = rng(seedOf(o.seed ?? `${r.x0},${r.z0},pal`));
  // (its top 6 mm under y1: between the N / S cornices' tops (y1) and the W / E ones' (y1 - 12 mm) that overlap it)
  G.box('np_tufaO', (r.x0 + r.x1) / 2, (y0 + y1 - 0.006) / 2 - 2, (r.z0 + r.z1) / 2, r.x1 - r.x0, y1 - 0.006 - y0 + 4, r.z1 - r.z0, 0, 0.95);
  for (const f of faces(r)) {
    const spans = exposedSpans(f, ctx);
    // (the W / E faces' courses, band, quoins and cornice 12 mm under the N / S faces': where two faces meet in an inner
    // corner (the courtyard's) or a cornice runs on over a corner, their tops never coincide)
    const cy = f.side === 'W' || f.side === 'E' ? -0.012 : 0;
    for (const [s0, s1] of spans) {
      const [mx, mz] = at(f, (s0 + s1) / 2, 0.8), yg = ctx.groundY(mx, mz) + cy;
      // rustication: piperno courses with deep joints up to the first floor
      const top = yg + 4.6;
      for (let y = yg, k = 0; y < top - 0.05; y += 0.58, k++) fbox(G, 'np_piperno', f, s0, s1, 0, 0.14, y + 0.04, Math.min(top, y + 0.56), 0.86 + (k % 2) * 0.1);
      fbox(G, 'np_marble', f, s0 - 0.1, s1 + 0.1, 0, 0.22, top, top + 0.22, 0.95);
      // quoins up the corners
      // (0.11 proud: an open shutter leaf (0.07) folded back over a quoin lies well behind its face)
      for (const e of [s0, s1 - 0.6]) for (let y = top + 0.22, k = 0; y < y1 - 1.2; y += 0.7, k++) fbox(G, 'np_piperno', f, e + (k % 2 ? 0.1 : 0), e + 0.6 - (k % 2 ? 0 : 0.1), 0, 0.11, y, y + 0.62, 0.9);
      fbox(G, 'np_marble', f, s0 - 0.35, s1 + 0.35, 0, 0.5, y1 - 0.6 + cy, y1 - 0.2 + cy, 0.95);
      fbox(G, 'np_marble', f, s0 - 0.45, s1 + 0.45, 0, 0.65, y1 - 0.2 + cy, y1 + cy, 1.0);
      if (o.lod) continue;
      const L = s1 - s0, nb = Math.max(1, Math.floor((L - 1) / 3.4)), step = L / nb;
      for (let b = 0; b < nb; b++) {
        const u = s0 + step * (b + 0.5);
        if (!(o.skip?.(f.side, u))) windowAt(G, f, u, yg + 1.8, { R, w: 1.0, h: 1.5, mat: 'np_iron', frame: 'np_piperno', shut: 'shut' }); // barred ground-floor lights
        // piano nobile: French windows on balconies under pediments
        const pn = top + 0.3;
        windowAt(G, f, u, pn + 0.1, { R, w: 1.2, h: 2.7, frame: 'np_marble', lit: ctx.lit && R() < 0.06 ? ctx.lit : null });
        balconyAt(G, f, u, pn, { w: 1.9, d: 0.8, pots: R() < 0.3 });
        fbox(G, 'np_marble', f, u - 0.95, u + 0.95, 0, 0.22, pn + 3.05, pn + 3.2, 0.95);
        fbox(G, 'np_marble', f, u - 0.75, u + 0.75, 0, 0.18, pn + 3.2, pn + 3.42, 0.9);
        // second floor and the attic
        if (pn + 4.0 + 2.2 < y1 - 1) windowAt(G, f, u, pn + 4.3, { R, w: 1.1, h: 2.0, frame: 'np_marble' });
        if (pn + 7.6 + 1.2 < y1 - 0.5) windowAt(G, f, u, pn + 7.7, { R, w: 0.9, h: 1.0, frame: 'np_marble' });
      }
    }
  }
  // flat roof behind a balustraded parapet
  G.box('np_screed', (r.x0 + r.x1) / 2, y1 + 0.04, (r.z0 + r.z1) / 2, r.x1 - r.x0 - 0.1, 0.08, r.z1 - r.z0 - 0.1, 0, 0.9);
  // (two runs that meet on a corner meet at its inset point: each ran on 0.25 m past the other, their plinths and rails
  // overlapping out there in one plane)
  const F = faces(r), par = Object.fromEntries(F.map((f) => [f.side, !!(exposedSpans(f, ctx).length || o.allParapets)]));
  const meets = { N: ['W', 'E'], S: ['W', 'E'], W: ['N', 'S'], E: ['N', 'S'] };
  for (const f of F) {
    if (!par[f.side]) continue;
    const [p0, p1] = meets[f.side];
    balustrade(G, at(f, par[p0] ? 0.25 : 0, -0.25), at(f, f.L - (par[p1] ? 0.25 : 0), -0.25), y1, { h: 0.95, mat: 'np_tufaO' });
  }
}

/** A balustrade from a to b (world [x, z]) on level y: plinth, turned balusters every ~0.28 m (lathed boxes), handrail. */
export function balustrade(G, a, b, y, o = {}) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 0.3) return;
  const rot = Math.atan2(b[1] - a[1], b[0] - a[0]), cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2, h = o.h ?? 1.05, t = o.t ?? 0.32;
  const mat = o.mat ?? 'np_tufaB', bal = o.bal ?? 'np_marble';
  G.box(mat, cx, y + 0.09, cz, L, 0.18, t, rot, 0.95);
  G.box(bal, cx, y + h - 0.07, cz, L + 0.04, 0.14, t + 0.08, rot, 1.0);
  const n = Math.max(2, Math.round(L / (o.pitch ?? 0.3))), dx = (b[0] - a[0]) / n, dz = (b[1] - a[1]) / n;
  const by = y + 0.18, bh = h - 0.32, np0 = Math.max(1, Math.round(L / 3)), clear = Math.max(0.36, t + 0.1) / 2 + 0.09;
  for (let i = 0; i < n; i++) {
    const s = (L * (i + 0.5)) / n; // (none where a pier stands: half inside it, a face in its plane)
    if (Math.abs(s - Math.round(s / (L / np0)) * (L / np0)) < clear) continue;
    const x = a[0] + dx * (i + 0.5), z = a[1] + dz * (i + 0.5);
    G.box(bal, x, by + bh * 0.2, z, 0.12, bh * 0.4, 0.12, rot, 0.95);
    G.box(bal, x, by + bh * 0.62, z, 0.17, bh * 0.44, 0.17, rot, 0.9);
    G.box(bal, x, by + bh * 0.92, z, 0.11, bh * 0.16, 0.11, rot, 0.95);
  }
  // piers every ~3 m: 4 cm over the handrail, at least as wide as it, one per spot (two runs meeting at a corner share
  // it: their rails' and plinths' ends lie inside it) — a pier flush with the rail, or two piers on one corner, put
  // faces in one plane
  const np = Math.max(1, Math.round(L / 3)), seen = (G._balPiers ||= []), pl = Math.max(0.36, t + 0.1);
  for (let i = 0; i <= np; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / np, z = a[1] + ((b[1] - a[1]) * i) / np;
    if (seen.some((q) => Math.hypot(q[0] - x, q[1] - z) < 0.45 && Math.abs(q[2] - y) < 0.5)) continue;
    seen.push([x, z, y]);
    G.box(mat, x, y + (h + 0.04) / 2, z, pl, h + 0.04, t + 0.1, rot, 0.95);
  }
}

// ---------------------------------------------------------------- the church and its campanile
/**
 * The baroque church: rect r (facade on its west side, `facade` x), nave and side aisles, transept, a drum and a
 * majolica dome over the crossing with its lantern, a tiled nave roof, the facade in two orders of piperno pilasters on
 * yellow stucco with a broken pediment and a round window, steps to the portal. y0 its level, h the eaves over it.
 */
export function buildChurch(G, r, y0, h, o = {}) {
  const x0 = r.x0, x1 = r.x1, z0 = r.z0, z1 = r.z1, cz = (z0 + z1) / 2, W = z1 - z0;
  const eave = y0 + h;
  // nave + aisles (one mass), its west wall carries the facade
  G.box('np_tufa', (x0 + 1 + x1) / 2, (eave + 0) / 2, cz, x1 - x0 - 1, eave, W, 0, 0.96);
  // nave roof (pitched, along x) with tiles
  const ridge = eave + 3.2;
  const A = [x0 + 1, ridge, cz], B = [x1, ridge, cz];
  G.quad('np_tile', [x0 + 1, eave, z0 - 0.3], A, B, [x1, eave, z0 - 0.3], 0.95);
  G.quad('np_tile', [x1, eave, z1 + 0.3], B, A, [x0 + 1, eave, z1 + 0.3], 0.95);
  G.tri('np_tufa', [x1, eave, z0 - 0.3], B, [x1, eave, z1 + 0.3], 0.95);
  // cornice along the eaves
  for (const z of [z0, z1]) G.box('np_marble', (x0 + 1 + x1) / 2, eave - 0.215, z, x1 - x0 - 1 + 0.04, 0.4, 0.7, 0, 0.95); // (15 mm under the nave's top, 2 cm past its end walls)
  // tall arched windows down the sides, pilasters between
  for (const [z, s] of [[z0, -1], [z1, 1]]) {
    for (let x = x0 + 3; x < x1 - 1.5; x += 3.6) {
      G.box('np_glass', x, y0 + 7.2, z + s * 0.02, 1.2, 3.6, 0.05, 0, 0.8);
      G.box('np_marble', x, y0 + 9.2, z + s * 0.08, 1.6, 0.35, 0.18, 0, 0.95);
      G.box('np_marble', x, y0 + 5.3, z + s * 0.08, 1.5, 0.18, 0.2, 0, 0.9);
      G.box('np_piperno', x + 1.8, y0 + h / 2, z + s * 0.1, 0.55, h - 0.6, 0.22, 0, 0.9);
    }
    G.box('np_piperno', (x0 + x1) / 2, y0 + 0.4, z + s * 0.08, x1 - x0 + 0.04, 0.8, 0.18, 0, 0.9); // (2 cm past the ends: not in the end walls' planes)
  }
  // the dome over the crossing (east third): drum with windows, majolica cap in yellow and green bands, lantern
  const dx = x0 + (x1 - x0) * 0.66, dr = Math.min(W * 0.32, 5.2), dy = ridge - 0.6;
  G.cyl('np_tufa', dx, dy, cz, dr + 0.3, dr + 0.3, 3.4, 20, 0.95);
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; G.box('np_glass', dx + Math.cos(a) * (dr + 0.32), dy + 1.7, cz + Math.sin(a) * (dr + 0.32), 0.7, 1.6, 0.05, a + Math.PI / 2, 0.85); }
  G.cyl('np_marble', dx, dy + 3.4, cz, dr + 0.55, dr + 0.55, 0.35, 20, 0.95);
  const rings = 7;
  for (let k = 0; k < rings; k++) {
    const p0 = (k / rings) * (Math.PI / 2), p1 = ((k + 1) / rings) * (Math.PI / 2);
    G.cyl(k % 2 ? 'np_majG' : 'np_majY', dx, dy + 3.75 + Math.sin(p0) * dr * 0.95, cz, Math.cos(p0) * dr, Math.cos(p1) * dr, (Math.sin(p1) - Math.sin(p0)) * dr * 0.95, 20, 1, { caps: false });
  }
  const ly = dy + 3.75 + dr * 0.95;
  G.cyl('np_marble', dx, ly - 0.1, cz, 0.9, 0.9, 1.6, 10, 0.95);
  G.cyl('np_majY', dx, ly + 1.5, cz, 1.05, 0.05, 1.2, 10, 1);
  G.cyl('np_iron', dx, ly + 2.7, cz, 0.05, 0.05, 1.1, 4, 0.8);
  G.box('np_iron', dx, ly + 3.5, cz, 0.05, 0.05, 0.6, 0, 0.8);
  // the facade (west, at x0 + 1): two orders, broken pediment, oculus, the portal; steps at its foot
  const fx = x0 + 1, top1 = y0 + 8.2, top2 = eave + 4.2;
  G.box('np_tufa', fx - 0.25, (y0 + top2) / 2, cz, 0.5, top2 - y0, W - 2.4, 0, 1.0);
  for (const s of [-1, 1]) G.box('np_tufa', fx - 0.25, (y0 + top1) / 2, cz + s * (W / 2 - 0.6), 0.5, top1 - y0, 1.2, 0, 1.0);
  for (const zz of [-W / 2 + 0.9, -W / 2 + 4.2, -2.2, 2.2, W / 2 - 4.2, W / 2 - 0.9]) {
    G.box('np_piperno', fx - 0.55, (y0 + top1) / 2, cz + zz, 0.3, top1 - y0, 0.85, 0, 0.92);
    G.box('np_piperno', fx - 0.62, y0 + 0.5, cz + zz, 0.42, 1.0, 1.05, 0, 0.88);
  }
  G.box('np_marble', fx - 0.6, top1 + 0.25, cz, 0.7, 0.5, W - 0.4, 0, 0.98); // entablature
  for (const zz of [-2.2, 2.2, -5.2, 5.2]) if (Math.abs(zz) < W / 2 - 3.5) G.box('np_piperno', fx - 0.5, (top1 + 0.5 + top2 - 1.6) / 2, cz + zz, 0.3, top2 - 1.6 - top1 - 0.5, 0.75, 0, 0.92);
  // upper order's volutes (stepped) and the broken pediment
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) G.box('np_tufa', fx - 0.3, top1 + 0.5 + k * 0.7, cz + s * (W / 2 - 3.6 - k * 0.6), 0.45, 0.7, 2.2 - k * 0.45, 0, 0.98);
  const py = top2 - 1.6;
  for (const s of [-1, 1]) slab3(G, 'np_marble', [fx - 0.7, py, cz + s * 5.4], [fx - 0.7, py + 1.6, cz + s * 1.1], 1.0, 0.36, 0.95);
  G.box('np_marble', fx - 0.62, top2 - 1.2, cz, 0.3, 2.2, 1.2, 0, 1.0); // the cartouche between the pediment's ends
  G.cyl('np_marble', fx - 0.55, top2 - 0.05, cz, 0.18, 0.05, 0.6, 6, 1); // a finial
  // oculus and portal
  ringX(G, 'np_marble', fx - 0.62, top1 + 2.6, cz, 0.8, 1.15, 0.3, 14, 0.95);
  G.box('np_glass', fx - 0.62, top1 + 2.6, cz, 0.06, 1.6, 1.6, 0, 0.8);
  G.box('np_door', fx - 0.52, y0 + 0.45 + 2.0, cz, 0.08, 4.0, 2.4, 0, 0.8);
  G.box('np_marble', fx - 0.62, y0 + 4.75, cz, 0.3, 0.6, 3.6, 0, 1.0);
  for (const s of [-1, 1]) G.box('np_marble', fx - 0.6, y0 + 2.45, cz + s * 1.45, 0.25, 4.0, 0.5, 0, 0.95);
  // steps up to the portal (inside the church's own footprint)
  for (let k = 0; k < 3; k++) G.box('np_piperno', x0 + 0.17 + k * 0.28, y0 + 0.075 + k * 0.15, cz, 0.34 + (2 - k) * 0, 0.15 + k * 0.3, 6 - k * 0.8, 0, 0.9);
}

/**
 * The campanile: tufa shaft with piperno quoins and string courses, the belfry stage with an arched opening each side,
 * the walkable deck (the Sniper's perch) behind a low balustrade, the bell on an iron frame; iron rungs up one face
 * (the gameplay ladder: o.ladder [x, z], o.face 'N' | 'E' | 'S' | 'W', default north), its head a gap in the
 * balustrade. r: rect, y0 its level, deck y.
 */
export function buildCampanile(G, r, y0, deck, o = {}) {
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, w = r.x1 - r.x0, d = r.z1 - r.z0;
  G.box('np_tufa', cx, (y0 - 0.5 + deck - 0.1) / 2, cz, w, deck - 0.1 - y0 + 0.5, d, 0, 0.96); // (its top inside the deck slab, not in its plane)
  for (let y = y0 + 4.5; y < deck - 1; y += 4.2) G.box('np_marble', cx, y, cz, w + 0.2, 0.22, d + 0.2, 0, 0.92);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) for (let y = y0, k = 0; y < deck - 0.4; y += 0.7, k++) {
    G.box('np_piperno', cx + sx * (w / 2 - 0.25 + (k % 2) * 0.05), y + 0.32, cz + sz * (d / 2 - 0.25 + ((k + 1) % 2) * 0.05), 0.55, 0.62, 0.55, 0, 0.9);
  }
  // belfry openings (dark arches) on four sides under the deck
  for (const f of faces(r)) {
    const u = f.L / 2;
    fbox(G, 'np_glass', f, u - 0.75, u + 0.75, 0, 0.03, deck - 4.0, deck - 1.0, 0.45);
    fbox(G, 'np_marble', f, u - 0.95, u + 0.95, 0, 0.14, deck - 1.0, deck - 0.75, 0.95);
    fbox(G, 'np_marble', f, u - 0.95, u - 0.75, 0, 0.12, deck - 4.0, deck - 1.0, 0.92);
    fbox(G, 'np_marble', f, u + 0.75, u + 0.95, 0, 0.12, deck - 4.0, deck - 1.0, 0.92);
  }
  // the deck: flags, a cornice, the balustrade round it, the bell on its frame in the middle
  G.box('np_piperno', cx, deck - 0.12, cz, w + 0.5, 0.24, d + 0.5, 0, 0.95);
  const e = 0.2, a = [r.x0 - e, r.z0 - e], b = [r.x1 + e, r.z0 - e], c = [r.x1 + e, r.z1 + e], dd = [r.x0 - e, r.z1 + e];
  // (the ladder's head: a 1.1 m gap in the balustrade over the rungs, on the ladder's face)
  const face = o.face ?? 'N', lu = face === 'N' || face === 'S' ? (o.ladder?.[0] ?? cx) : (o.ladder?.[1] ?? cz);
  const BAL = { h: 0.95, t: 0.22, mat: 'np_tufaB', pitch: 0.26 };
  const sides = { N: [a, b], E: [b, c], S: [c, dd], W: [dd, a] };
  for (const [k, [p0, p1]] of Object.entries(sides)) {
    if (k !== face) { balustrade(G, p0, p1, deck, BAL); continue; }
    const ax = k === 'N' || k === 'S' ? 0 : 1, lo = Math.min(p0[ax], p1[ax]), hi = Math.max(p0[ax], p1[ax]);
    const at = (v) => (ax === 0 ? [v, p0[1]] : [p0[0], v]);
    balustrade(G, at(lo), at(lu - 0.55), deck, BAL);
    balustrade(G, at(lu + 0.55), at(hi), deck, BAL);
  }
  // bell frame on the south side of the deck (clear of the Sniper's spot and of the ladder head)
  const bz = r.z1 - 0.55;
  for (const s of [-1, 1]) G.box('np_iron', cx + s * 0.75, deck + 1.0, bz, 0.08, 2.0, 0.08, 0, 0.8);
  G.box('np_iron', cx, deck + 2.0, bz, 1.6, 0.1, 0.1, 0, 0.8);
  G.cyl('np_rust', cx, deck + 1.05, bz, 0.42, 0.18, 0.75, 12, 0.9);
  // the iron rungs up the ladder's face (a pair of rails, a rung every 0.32 m), stood off the wall on brackets
  const F = faces(r).find((f) => f.side === face), lf = face === 'N' || face === 'S' ? lu - r.x0 : lu - r.z0;
  for (let y = y0 + 0.4; y < deck + 0.2; y += 0.32) fbox(G, 'np_iron', F, lf - 0.25, lf + 0.25, 0.16, 0.2, y - 0.02, y + 0.02, 0.8);
  for (const s of [-1, 1]) fbox(G, 'np_iron', F, lf + s * 0.27 - 0.025, lf + s * 0.27 + 0.025, 0.17, 0.22, y0, deck + 1, 0.75);
  for (let y = y0 + 1.2; y < deck; y += 2.4) for (const s of [-1, 1]) fbox(G, 'np_iron', F, lf + s * 0.27 - 0.02, lf + s * 0.27 + 0.02, 0, 0.18, y - 0.02, y + 0.02, 0.7);
}

// ---------------------------------------------------------------- levels, steps, walls
/**
 * A raised level slab: paved top at y over polygon `poly` (CCW or not), retaining walls of bare tufa ashlar with a
 * piperno coping on the edges listed in `walls` ([[a, b], …], down to y - drop).
 */
export function buildSlab(G, poly, y, o = {}) {
  G.prism(o.top ?? 'np_basalt', poly, y - (o.drop ?? y), y, 1, { top: true, sides: false });
  for (const [a, b] of o.walls || []) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), rot = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L, s = o.outSign ?? 1;
    // (the wall 3 cm behind the edge line: a house's face standing on that line is not in its plane; the coping covers it)
    const cx = (a[0] + b[0]) / 2 + nx * 0.23 * s, cz = (a[1] + b[1]) / 2 + nz * 0.23 * s;
    const kx = (a[0] + b[0]) / 2 + nx * 0.2 * s, kz = (a[1] + b[1]) / 2 + nz * 0.2 * s;
    G.box('np_tufaB', cx, (y - (o.drop ?? y)) / 2 + (y - 0.25) / 2, cz, L, o.drop ?? y, 0.4, rot, 0.92);
    G.box('np_piperno', kx, y - 0.09, kz, L + 0.1, 0.24, 0.55, rot, 0.95); // (3 cm proud of the paving it overlaps)
  }
}

/** A straight flight of steps from (a, y0) up to (b, y1): piperno nosings on tufa risers, width w, optional cheeks. */
export function buildSteps(G, a, b, y0, y1, w, o = {}) {
  const run = Math.hypot(b[0] - a[0], b[1] - a[1]), rise = y1 - y0, n = Math.max(2, Math.round(Math.abs(rise) / (o.riser ?? 0.17)));
  const tx = (b[0] - a[0]) / run, tz = (b[1] - a[1]) / run, rot = Math.atan2(tz, tx), tr = run / n;
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * tr, top = y0 + (rise * (i + 1)) / n, x = a[0] + tx * s, z = a[1] + tz * s;
    G.box(o.body ?? 'np_tufaB', x, (Math.min(y0, y1) - 0.2 + top - 0.06) / 2, z, tr, top - 0.06 - Math.min(y0, y1) + 0.2, w, rot, 0.9); // (one tread long: neighbours overlapped, sides in one plane)
    G.box(o.tread ?? 'np_piperno', x - tx * 0.02, top - 0.03, z - tz * 0.02, tr + 0.04, 0.06, w, rot, 0.88 + ((i * 7) % 5) * 0.03);
  }
  if (o.cheeks) for (const sd of [-1, 1]) {
    const px = -tz * sd * (w / 2 + 0.2), pz = tx * sd * (w / 2 + 0.2);
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) * tr, top = y0 + (rise * (i + 1)) / n;
      G.box('np_tufaB', a[0] + tx * s + px, (Math.min(y0, y1) + top + o.cheeks) / 2, a[1] + tz * s + pz, tr, top + o.cheeks - Math.min(y0, y1), 0.4, rot, 0.92);
    }
  }
}

/** A plain masonry wall along a → b: tufa with a piperno coping, h tall from y. */
export function buildWall(G, a, b, y, h, t = 0.5, o = {}) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), rot = Math.atan2(b[1] - a[1], b[0] - a[0]);
  G.box(o.mat ?? 'np_tufaO', (a[0] + b[0]) / 2, y + h / 2, (a[1] + b[1]) / 2, L, h, t, rot, 0.92);
  G.box('np_piperno', (a[0] + b[0]) / 2, y + h + 0.06 + (o.copingDy ?? 0), (a[1] + b[1]) / 2, L + 0.1, 0.12, t + 0.12, rot, 0.95);
}

/**
 * The aqueduct's stair-head: a vaulted tufa portal over steps going down into the dark (the Bolla aqueduct's
 * cisterns under the old town), rect r on level y, its mouth on the south side.
 */
export function buildStairhead(G, r, y, o = {}) {
  const cx = (r.x0 + r.x1) / 2, w = r.x1 - r.x0, d = r.z1 - r.z0, mouth = r.z1, h = o.h ?? 5;
  // side walls and back mass
  G.box('np_tufaB', r.x0 + 0.6, y + h / 2, (r.z0 + r.z1) / 2, 1.2, h, d, 0, 0.9);
  G.box('np_tufaB', r.x1 - 0.6, y + h / 2, (r.z0 + r.z1) / 2, 1.2, h, d, 0, 0.9);
  G.box('np_tufaB', cx, y + h / 2, r.z0 + 0.6, w - 2.4, h, 1.2, 0, 0.88); // (between the side walls: the corners were in both)
  // the barrel vault over the mouth (segments) and its piperno archivolt
  const R = (w - 2.4) / 2, ay = y + 2.4, seg = 10;
  for (let k = 0; k < seg; k++) {
    const a0 = Math.PI - (k / seg) * Math.PI, a1 = Math.PI - ((k + 1) / seg) * Math.PI;
    const x0 = cx + Math.cos(a0) * R, y0 = ay + Math.sin(a0) * R, x1 = cx + Math.cos(a1) * R, y1 = ay + Math.sin(a1) * R;
    G.hexa('np_piperno', [[x0, y0, mouth - 0.6], [x0, y0, mouth + 0.05], [x1, y1, mouth + 0.05], [x1, y1, mouth - 0.6],
      [x0 + Math.cos(a0) * 0.45, y0 + Math.sin(a0) * 0.45, mouth - 0.6], [x0 + Math.cos(a0) * 0.45, y0 + Math.sin(a0) * 0.45, mouth + 0.05],
      [x1 + Math.cos(a1) * 0.45, y1 + Math.sin(a1) * 0.45, mouth + 0.05], [x1 + Math.cos(a1) * 0.45, y1 + Math.sin(a1) * 0.45, mouth - 0.6]], 0.9);
  }
  G.box('np_tufaB', cx, y + (ay + R + 0.45 + h) / 2 - y, mouth - 0.3, w, h - (ay + R + 0.45 - y), 0.6, 0, 0.9);
  G.box('np_marble', cx, y + h + 0.1, (r.z0 + r.z1) / 2, w + 0.2, 0.2, d + 0.2, 0, 0.9);
  // the dark stair going down under the vault and the black of the cistern beyond
  for (let k = 0; k < 6; k++) G.box('np_piperno', cx, y - 0.15 - k * 0.22, mouth - 0.9 - k * 0.32, w - 2.6, 0.08, 0.32, 0, 0.6 - k * 0.07);
  G.box('np_glass', cx, y + 1.2, r.z0 + 1.25, w - 2.5, 2.6, 0.05, 0, 0.15);
  // a carved plaque over the arch
  G.box('np_marble', cx, ay + R + 1.1, mouth + 0.05, 1.6, 0.6, 0.08, 0, 0.95);
}

/** Merge glow quads ({f, u0, u1, y0, y1, w} on faces, or world boxes {x, y, z, sx, sy, sz}) into one emissive mesh. */
export function glowMesh(items, color = 0xffa850, intensity = 1.2, name = 'naples:glow') {
  if (!items.length) return null;
  const pos = [];
  const quad = (p) => pos.push(...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]);
  for (const it of items) {
    if (it.f) {
      const P = (u, y) => { const [x, z] = at(it.f, u, it.w ?? 0.06); return [x, y, z]; };
      // the light shows through the louvres: thin horizontal slits across the closed shutter
      const n = 5;
      for (let k = 0; k < n; k++) {
        const y0 = it.y0 + ((it.y1 - it.y0) * (k + 0.35)) / n, y1 = y0 + (it.y1 - it.y0) / n * 0.22;
        const a = P(it.u0, y0), b = P(it.u1, y0), c = P(it.u1, y1), d = P(it.u0, y1);
        // both windings (seen from outside whatever the face's handedness)
        quad([a, b, c, d]); quad([d, c, b, a]);
      }
    } else {
      const { x, y, z, sx = 0.05, sy = 0.08, sz = 0.05 } = it;
      const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
      g.translate(x, y, z);
      pos.push(...g.attributes.position.array);
      g.dispose();
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x201810, emissive: color, emissiveIntensity: intensity, roughness: 0.9 }));
  m.name = name;
  m.castShadow = false; m.receiveShadow = false;
  return m;
}

export { Geo };
