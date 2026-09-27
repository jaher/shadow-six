/**
 * Terrain layer palettes per theater + CPU splat/height builders.
 * Layer order MUST match assets/layers.json (tools/pack_layers.py THEATERS).
 * @module terrain-b/terrain-layers
 */
import { fbm, vnoise } from './noise.js';

// Grid terrain codes (src/world/grid.js T.*)
export const TC = { GROUND: 0, ROAD: 1, SAND: 2, SNOW: 3, GRASS: 4, WATER: 5, SHALLOW: 6, MUD: 7 };

/**
 * Per-layer properties (8 layers):
 *  tile  – world metres per texture repeat
 *  soft  – trail deformation depth in metres (0 = hard)
 *  wet   – wet gloss response of ruts (mud puddles)
 *  snow  – snow-ness (sparkle, bluish SSS, crisp prints)
 *  grass – grass blade density factor (3D grass is spawned where this weight is high)
 */
export const PALETTES = {
  desert: {
    layers: ['sand', 'sand2', 'gravel', 'dirt', 'rock', 'road', 'grassdry', 'mud'],
    tile: [3.2, 4.5, 2.0, 2.5, 4.0, 3.0, 2.0, 2.5],
    soft: [0.07, 0.065, 0.01, 0.02, 0.0, 0.02, 0.02, 0.1],
    wet: [0, 0, 0, 0, 0, 0, 0, 1],
    snow: [0, 0, 0, 0, 0, 0, 0, 0],
    grass: [0, 0, 0, 0.05, 0, 0, 0.55, 0.1],
    // T-A graft: warm North-African sand tone (linear multipliers on the de-lit scans)
    tint: [[1.04, 0.9, 0.72], [1.02, 0.9, 0.74], [1.0, 0.94, 0.86], [1.3, 1.14, 0.95], [1.0, 0.93, 0.84], [1.0, 0.94, 0.88], [1, 1, 1], [1.45, 1.25, 1.0]],
    heightAmp: 0.35, heightScale: 22,
  },
  temperate: {
    layers: ['grass', 'grassdry', 'dirt', 'mud', 'gravel', 'road', 'leaves', 'wetsand'],
    tile: [2.2, 2.0, 2.5, 2.5, 2.0, 3.0, 2.5, 3.0],
    soft: [0.03, 0.03, 0.03, 0.11, 0.01, 0.025, 0.03, 0.06],
    wet: [0, 0, 0.1, 1, 0, 0.55, 0, 0.5],  // road 0.55: A's muddy road with puddles in the ruts
    snow: [0, 0, 0, 0, 0, 0, 0, 0],
    grass: [1, 0.8, 0.12, 0.05, 0, 0, 0.1, 0],
    tint: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [0.97, 0.94, 0.97], [1, 1, 1], [1, 1, 1]], // greyer-brown Normandy track
    heightAmp: 0.22, heightScale: 18,
  },
  snow: {
    layers: ['snow', 'snowold', 'snowpack', 'rock', 'ice', 'slush', 'grassdry', 'mud'], // ice/slush reuse the gravel/road maps
    tile: [4.5, 3.0, 2.2, 4.0, 5.0, 3.0, 2.0, 2.5],
    soft: [0.17, 0.13, 0.06, 0.0, 0.0, 0.05, 0.03, 0.1],
    wet: [0, 0, 0.15, 0, 0.3, 0.8, 0, 1],
    snow: [1, 0.9, 0.75, 0, 0.2, 0.3, 0, 0],
    ice: [0, 0, 0, 0, 1, 0, 0, 0],
    tint: [[1, 1, 1], [1.12, 1.11, 1.1], [1.05, 1.05, 1.05], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]],
    slush: [0, 0, 1, 0, 0, 1, 0, 0],
    grass: [0, 0.08, 0, 0, 0, 0, 0.5, 0],
    heightAmp: 0.3, heightScale: 14,
  },
};
PALETTES.coast = { ...PALETTES.temperate, sourceTheater: 'temperate' };
PALETTES.night = { ...PALETTES.temperate, sourceTheater: 'temperate' };

const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = sat((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// fractal edge perturbation: added to every mask threshold so borders are ragged at 0.3–3 m scales (must-fix 4)
function edgeN(x, z, seed) {
  return (fbm(x / 2.3, z / 2.3, 3, seed + 41) - 0.5) * 0.22 + (vnoise(x * 1.7, z * 1.7, seed + 43) - 0.5) * 0.1;
}

/** Weight rules: grid code + world position → 8 weights (unnormalised). Masks are noise-warped (no round blobs). */
function rules(th, code, x, z, w, seed) {
  const e = edgeN(x, z, seed);
  const n1 = fbm(x / 16, z / 16, 4, seed + 1) + e;
  const n2 = fbm(x / 5, z / 5, 3, seed + 2) + e * 0.8;
  const n3 = fbm(x / 34, z / 34, 3, seed + 3) + e * 0.6;
  const streak = fbm(x / 22, z / 3.5, 3, seed + 4); // wind-aligned streaks (sand/snow)
  w.fill(0);
  if (th === 'desert') {
    if (code === TC.ROAD) { w[5] = 1; w[3] = 0.35 * smooth(0.45, 0.7, n2); w[2] = 0.25 * n1; w[0] = 0.35 * smooth(0.5, 0.75, streak); }
    else if (code === TC.GRASS) { w[6] = 1; w[1] = 0.5 * n2; w[0] = 0.3 * smooth(0.5, 0.7, n1); }
    else if (code === TC.MUD || code === TC.SHALLOW || code === TC.WATER) { w[7] = 1; w[3] = 0.3; }
    else if (code === TC.GROUND) { // hardpan: pale dirt + gravel lag with drifted sand tongues, rock only as rare outcrops
      w[3] = 0.35 + 0.25 * n2; w[1] = 0.6 + 0.3 * smooth(0.45, 0.7, streak); w[2] = 0.6 * smooth(0.45, 0.62, n1);
      w[0] = 0.45 * smooth(0.55, 0.75, n2 * 0.5 + streak * 0.5); w[4] = 0.5 * smooth(0.74, 0.8, n3);
    } else { // sand (default): dune sand, darker lag sand in troughs, scattered gravel lag, rare dirt
      w[0] = 0.6 + 0.6 * smooth(0.35, 0.6, n1); w[1] = 0.9 * smooth(0.52, 0.36, n1 * 0.6 + streak * 0.4);
      w[2] = 0.5 * smooth(0.66, 0.76, n2 * 0.6 + n3 * 0.4); w[4] = 0.6 * smooth(0.76, 0.82, n3 * 0.7 + n2 * 0.3);
      w[3] = 0.25 * smooth(0.58, 0.72, n2);
    }
  } else if (th === 'snow') { // layer 4 is ICE in this theater (uIce), layer 5 road = compacted slush (uSlush)
    if (code === TC.ROAD) { w[2] = 1; w[5] = 0.08 + 0.25 * smooth(0.5, 0.75, n2); w[1] = 0.35 * smooth(0.4, 0.7, streak); }
    else if (code === TC.GROUND) { w[0] = 0.8; w[1] = 0.45 * smooth(0.45, 0.7, streak); w[6] = 0.4 * smooth(0.55, 0.7, n2); w[3] = 0.25 * smooth(0.78, 0.84, n1); } // wind-scoured, grass tips poking
    else if (code === TC.GRASS) { w[1] = 0.8; w[6] = 0.6 * smooth(0.45, 0.65, n2); }
    else if (code === TC.WATER) { w[4] = 1; w[1] = 0.25 * smooth(0.55, 0.75, streak); }
    else if (code === TC.SHALLOW) { w[4] = 0.8; w[0] = 0.5 * smooth(0.45, 0.7, streak + e); }
    else if (code === TC.MUD) { w[7] = 1; w[2] = 0.4 * n2; }
    else { // snow
      // art review: old granular snow and rock kept to broad, rare patches — at 0.3–1 m scale they read as dirt
      // noise across every field and masked the footprints
      w[0] = 0.8 + 0.4 * n1; w[1] = 0.55 * smooth(0.56, 0.7, n1 * 0.6 + n2 * 0.4);
      w[3] = 0.6 * smooth(0.82, 0.88, n3 * 0.75 + n2 * 0.25); w[6] = 0.3 * smooth(0.72, 0.82, n2);
    }
  } else { // temperate / coast / night
    if (code === TC.ROAD) { w[5] = 1; w[2] = 0.5 * n2; w[3] = 0.45 * smooth(0.5, 0.68, n1); w[4] = 0.3 * smooth(0.55, 0.72, n2); }
    else if (code === TC.GROUND) { w[2] = 0.7; w[4] = 0.2 * smooth(0.6, 0.72, n2); w[1] = 0.8 * n1; w[0] = 0.5 * smooth(0.45, 0.65, n2); }
    else if (code === TC.SAND) { w[7] = 1; w[2] = 0.2 * n2; }
    else if (code === TC.MUD || code === TC.SHALLOW || code === TC.WATER) { w[3] = 1; w[2] = 0.3 * n2; w[1] = 0.25 * smooth(0.55, 0.7, n1); }
    else { // grass / default meadow
      w[0] = 0.75 + 0.5 * smooth(0.3, 0.6, n1); w[1] = 0.8 * smooth(0.55, 0.72, n1 * 0.5 + n3 * 0.5);
      w[2] = 0.35 * smooth(0.74, 0.84, n2 * 0.6 + n1 * 0.4); w[6] = 0;
    }
  }
}

/**
 * Build the splat weights (8 layers → 2 RGBA8 arrays) at `res` texels/m, box-blurred for soft borders.
 * Returns {res, w, h, a: Uint8Array(w*h*4), b: Uint8Array(w*h*4), f32: Float32Array(w*h*8)}.
 */
export function buildSplat(grid, theater, opts = {}) {
  const res = opts.splatRes || 4, seed = opts.seed || 7;
  const W = Math.ceil(grid.width * res), H = Math.ceil(grid.depth * res);
  const th = PALETTES[theater]?.sourceTheater || (PALETTES[theater] ? theater : 'temperate');
  let f = new Float32Array(W * H * 8);
  const w = new Float32Array(8), wb = new Float32Array(8);
  // must-fix 4/5: feathered, noise-thresholded masks. Blur a "not base ground" indicator over ~1.5 m and blend
  // patch/road rules into the theater's base rules by a noisy threshold of it -> ragged, height-blended borders.
  const base = th === 'desert' ? TC.SAND : th === 'snow' ? TC.SNOW : TC.GRASS;
  const isWet = (c) => c === TC.WATER || c === TC.SHALLOW;
  const ind = new Float32Array(grid.cols * grid.rows);
  for (let k = 0; k < ind.length; k++) ind[k] = grid.terrain[k] !== base ? 1 : 0;
  const fr = Math.max(1, Math.round((opts.featherM ?? 1.5) / grid.cell));
  const feather = boxBlur1(boxBlur1(ind, grid.cols, grid.rows, fr, 1), grid.cols, grid.rows, fr, grid.cols);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) / res, z = (j + 0.5) / res;
      // domain warp of the grid lookup: ragged road verges / patch borders instead of cell-aligned lines
      const wx = x + (fbm(x / 4, z / 4, 3, seed + 51) - 0.5) * 1.3 + (vnoise(x * 1.4, z * 1.4, seed + 52) - 0.5) * 0.45;
      const wz = z + (fbm(x / 4, z / 4, 3, seed + 53) - 0.5) * 1.3 + (vnoise(x * 1.4, z * 1.4, seed + 54) - 0.5) * 0.45;
      const ci = Math.min(grid.cols - 1, Math.max(0, Math.floor(wx / grid.cell))), cj = Math.min(grid.rows - 1, Math.max(0, Math.floor(wz / grid.cell)));
      const code = grid.terrain[cj * grid.cols + ci];
      rules(th, code, x, z, w, seed);
      if (th === 'snow' && isWet(code) && !opts.frozenWater) { // liquid water in winter: dark wet bed, not the ice layer
        w.fill(0); w[7] = 1; w[3] = code === TC.WATER ? 0.6 : 0.4 + 0.3 * smooth(0.4, 0.7, fbm(x / 5, z / 5, 3, seed + 2));
      }
      if (code !== base && !isWet(code)) {
        const t = smooth(0.25, 0.85, feather[cj * grid.cols + ci] + edgeN(x * 1.3, z * 1.3, seed + 5) * 2.2);
        if (t < 1) { rules(th, base, x, z, wb, seed); for (let k = 0; k < 8; k++) w[k] = wb[k] + (w[k] - wb[k]) * t; }
      }
      if (opts.paint) opts.paint(x, z, w); // mission hook: forest floor under trees, burnt patches…
      f.set(w, (j * W + i) * 8);
    }
  }
  f = blur8(f, W, H, Math.max(1, Math.round(res * (opts.splatBlur ?? 0.5))));
  const a = new Uint8Array(W * H * 4), b = new Uint8Array(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    let s = 0;
    for (let k = 0; k < 8; k++) s += f[p * 8 + k];
    s = s > 1e-5 ? 1 / s : 0;
    for (let k = 0; k < 8; k++) f[p * 8 + k] *= s;
    for (let k = 0; k < 4; k++) { a[p * 4 + k] = Math.round(f[p * 8 + k] * 255); b[p * 4 + k] = Math.round(f[p * 8 + 4 + k] * 255); }
  }
  return { res, w: W, h: H, a, b, f32: f, theater: th };
}

/** 1D box blur along rows (step 1) or columns (step = W) of a W×H field. */
function boxBlur1(src, W, H, r, step) {
  const out = new Float32Array(src.length);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let s = 0, n = 0;
    for (let d = -r; d <= r; d++) {
      const ii = step === 1 ? i + d : i, jj = step === 1 ? j : j + d;
      if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
      s += src[jj * W + ii]; n++;
    }
    out[j * W + i] = s / n;
  }
  return out;
}

function blur8(src, W, H, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const n = 2 * r + 1;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) for (let k = 0; k < 8; k++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += src[(j * W + Math.min(W - 1, Math.max(0, i + d))) * 8 + k];
    tmp[(j * W + i) * 8 + k] = s / n;
  }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) for (let k = 0; k < 8; k++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += tmp[(Math.min(H - 1, Math.max(0, j + d)) * W + i) * 8 + k];
    out[(j * W + i) * 8 + k] = s / n;
  }
  return out;
}

/** Sample splat weights (bilinear-free, nearest) at world x,z → Float32Array(8) view. */
export function splatAt(splat, x, z, out = new Float32Array(8)) {
  const i = Math.min(splat.w - 1, Math.max(0, Math.floor(x * splat.res)));
  const j = Math.min(splat.h - 1, Math.max(0, Math.floor(z * splat.res)));
  const o = (j * splat.w + i) * 8;
  for (let k = 0; k < 8; k++) out[k] = splat.f32[o + k];
  return out;
}

/** Undulation height (m) — subtle, anisotropic drifts for snow/desert. Water cells are sunk separately. */
export function undulation(theater, x, z, seed = 7) {
  const P = PALETTES[theater] || PALETTES.temperate;
  const s = P.heightScale;
  let h = (fbm(x / s, z / s, 4, seed + 11) - 0.5) * 2 * P.heightAmp;
  // art review: under the low Norwegian sun (~19°) straight, regular drift ridges read as giant light/dark
  // stripes across the whole map at the game camera. Snow drifts are domain-warped (curving, broken crests)
  // and kept shallow; the fine wind texture is left to the shader's sastrugi normals.
  const snow = theater === 'snow';
  if (snow) { // T-A drifts: ridges across the wind (wind from +X), warped so crests curve and break up
    const wx = x + (fbm(x / 26, z / 26, 2, seed + 31) - 0.5) * 18, wz = z + (fbm(x / 26 + 7.3, z / 26 + 2.1, 2, seed + 33) - 0.5) * 18;
    const u = wx * 0.9 + wz * 0.35, v = wz * 0.9 - wx * 0.35;
    const ridge = 1 - Math.abs(2 * vnoise(u * 0.07, v * 0.04, seed + 13) - 1);
    h += (ridge * ridge - 0.35) * 0.3 * fbm(x * 0.02, z * 0.02, 2, seed + 21);
  }
  if (snow || theater === 'desert') {
    // wind drifts / dune ripples: stretched noise across the wind (wind from +x)
    const r = vnoise(x / (s * 0.35), z / (s * 1.6), seed + 12);
    h += (r - 0.5) * P.heightAmp * (snow ? 0.35 : 0.9);
  }
  return h;
}

/**
 * Game integration: per-grid-cell flatten factor (0 = full undulation, 1 = flat) so structures, raised decks,
 * bridges and shores sit on level ground and units never float or sink. Blocked / bridge / raised / water cells
 * and the cells under prop bases (grid.flatExtra, map-builder stampFlatBase) are 1, roads `road`; the field is
 * box-blurred over `radius` metres and re-maxed so footprints stay fully flat.
 * @param {{cols:number, rows:number, cell:number, terrain:Uint8Array, block:Uint8Array, bridge:Uint8Array, elev:Float32Array}} grid
 * @param {{radius?:number, road?:number}} [o]
 * @returns {Float32Array}
 */
export function buildFlatMask(grid, o = {}) {
  const { cols, rows } = grid, n = cols * rows, road = o.road ?? 0.5;
  const src = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const c = grid.terrain[k];
    src[k] = grid.block[k] || grid.bridge?.[k] || grid.elev?.[k] || grid.flatExtra?.[k] || c === TC.WATER || c === TC.SHALLOW ? 1 : c === TC.ROAD ? road : 0;
  }
  const r = Math.max(1, Math.round((o.radius ?? 2.5) / grid.cell));
  const b = boxBlur1(boxBlur1(src, cols, rows, r, 1), cols, rows, r, cols);
  for (let k = 0; k < n; k++) b[k] = Math.max(src[k], Math.min(1, b[k] * 2.2));
  return b;
}
