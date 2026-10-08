/**
 * Ground-cover placement (docs/vegetation.md §3.0 "placement is ecological, not uniform", §3.1, §3.7). Pure: no THREE.
 *  - Grass: jittered candidates thinned by a cellular clump field (tufts gather in clumps with gaps between them) and
 *    the splat grass weight with a ragged verge; the archetype comes from per-species drifts (low-frequency noise
 *    per archetype), so neighbouring tufts tend to share a species and nothing repeats on a grid.
 *  - Dryness per tuft: season + dry splat + field-scale patches + verge, minus wetness near water.
 *  - Reeds: dense, sharp-edged stands on the water band (land 0–2.4 m from the shore and the shallows), outliers.
 *    Nothing else grows in the water: sward and crop tufts keep GROUND_SHORE_MARGIN m of dry land (world/veg-shore.js).
 *  - Marram: clumps on coast sand above the tide line. Drinn: sparse tussocks on open desert sand.
 * Output per 16 m chunk: { cx, cz, lists: { [archetype]: number[] } } with 10 floats per instance
 * (x, y, z, rot, hScale, wScale, colourRand, type, rank, dryness); rank is set after a per-list shuffle so any
 * prefix is a uniform subset (density LOD).
 * @module terrain-b/grass-place
 */
import { rng, fbm, vnoise } from './noise.js';
import { GT, pickWeighted } from './veg-profile.js';
import { onDryLand, GROUND_SHORE_MARGIN } from '../../world/veg-shore.js';

export const STRIDE = 10;
const ss = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Integer hash → [0,1). */
function h2(i, j, s) {
  let h = (i * 374761393 + j * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Cellular clump field: 1 at clump centres falling to 0 in the gaps between them. `scale` m per cell; each cell
 * holds one clump with its own radius (0.25–0.52 of a cell), so clumps differ in size and gaps open between them.
 */
export function clumpField(x, z, scale = 1.3, seed = 5) {
  const fx = x / scale, fz = z / scale, i0 = Math.floor(fx), j0 = Math.floor(fz);
  let best = 0;
  for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) {
    const px = i + h2(i, j, seed), pz = j + h2(i, j, seed + 1), rad = 0.25 + 0.27 * h2(i, j, seed + 2);
    const d = Math.hypot(fx - px, fz - pz) / rad;
    if (d < 1) best = Math.max(best, 1 - d * d);
  }
  return best;
}

/** Point in polygon (even-odd). */
function inPoly2(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Species drift for archetype k: 0.05 … ~2.2, smooth over 11–27 m (reads as patches from the zoom-0.5 camera). */
function drift(k, x, z) {
  const sc = 11 + (k * 5.3) % 16;
  return 0.05 + 2.15 * ss(0.4, 0.64, fbm(x / sc + k * 17.3, z / sc - k * 11.1, 2, 300 + k));
}

/**
 * Meadow macro fields (critic: no 10–40 m variation from the zoom-0.5 camera): mown / grazed vs unmown swards
 * (height), dry patches (colour), thin vs dense ground, trodden bare patches. Pure, smooth, deterministic.
 * @returns {{h:number, dry:number, dens:number, trod:boolean}}
 */
export function meadowMacro(x, z) {
  const mow = ss(0.36, 0.64, fbm(x / 31, z / 31, 2, 901));
  const dry = (fbm(x / 17 + 3.1, z / 17, 2, 903) - 0.5) * 0.9;
  const dens = ss(0.22, 0.72, fbm(x / 13, z / 13, 2, 905));
  const trod = clumpField(x, z, 21, 907) > 0.82;
  return { h: 0.42 + 1.0 * mow, dry, dens: 0.35 + 0.8 * dens, trod };
}

/**
 * @param {object} env {W, D, grassW(x,z)→{g, dry, excluded}, heightAt, waterSD?(x,z) (>0 in water), deepSD?,
 *   sandW?(x,z) 0..1 open sand weight, tallOK?(x,z) no structure / deck / wall here}
 * @param {object} prof veg-profile
 * @param {{perM2:number, chunk?:number, seed?:number}} o
 */
export function placeGround(env, prof, o) {
  const { W, D, grassW, heightAt } = env, wet = env.waterSD || null;
  const CH = o.chunk || 16, r = rng(o.seed || 1234), out = [];
  // crop fields (bocage.js farmland): wheat / stubble polygons with their drill direction
  const crops = (env.fields || []).filter((f) => f.kind === 'wheat' || f.kind === 'stubble').map((f) => {
    const xs = f.poly.map((p) => p[0]), zs = f.poly.map((p) => p[1]);
    return { ...f, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  });
  const cropAt = (x, z) => crops.some((f) => x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1 && inPoly2(x, z, f.poly));
  const wl = Math.hypot(o.wind?.x ?? 1, o.wind?.z ?? 0.25), wx = (o.wind?.x ?? 1) / wl, wz = (o.wind?.z ?? 0.25) / wl; // marram streaks
  const mixKeys = Object.keys(prof.mix || {});
  const cell = o.perM2 > 0 ? Math.sqrt(2.35 / o.perM2) : 0; // clump spacing: ≈ 0.51 m at 9 /m² (≈ 8.5 tufts /m² kept)
  const tall = env.tallOK || (() => true);
  // species table as arrays (hot loop); straw is always available as the verge / dry-splat fallback
  const keys = mixKeys.slice(); if (keys.length && !keys.includes('straw') && prof.src !== 'snow') keys.push('straw');
  if (prof.src === 'snow' && keys.length && !keys.includes('straw')) keys.push('straw');
  const nk = keys.length, mixW = keys.map((k) => prof.mix[k] ?? 0), wv = new Float64Array(nk);
  const keyIsFlat = keys.map((k) => k === 'meadow' || nk === 1), iStraw = keys.indexOf('straw'), iTus = keys.indexOf('tussock');
  const iFlop = keys.indexOf('flopped'), iForb = keys.indexOf('forb'), iSeed = keys.indexOf('seedhead');
  const temperate = prof.src !== 'desert' && prof.src !== 'snow' && nk > 1;
  const macro = temperate && o.macro !== false, winter = temperate && (prof.season === 'winter' || prof.season === 'thaw' || prof.dry >= 0.6);
  const lat = new Float32Array((CH / 2 + 1) ** 2 * (nk + 1));
  // the map's chunks, or an explicit list (the apron ring past the map edges: [cx, cz, x1, z1])
  const chunkList = o.chunks || [];
  if (!o.chunks) for (let cz = 0; cz < D; cz += CH) for (let cx = 0; cx < W; cx += CH) chunkList.push([cx, cz, Math.min(W, cx + CH), Math.min(D, cz + CH)]);
  for (const [cx, cz, x1, z1] of chunkList) {
    const lists = {};
    const push = (name, x, z, h, dry) => {
      const rot = r() * 6.283, cr = r();
      // the sward and the crops never grow in the water (world/veg-shore.js): the river / lake bed's mud and dry-grass
      // splat planted tufts under it; reeds stand in the shallows on purpose (their random draws are still taken, so
      // the rest of the chunk keeps its layout)
      if (name !== 'reed' && wet && !onDryLand(wet, x, z, GROUND_SHORE_MARGIN)) return;
      (lists[name] || (lists[name] = [])).push(x, heightAt(x, z) - 0.01, z, rot, h, 1, cr, GT[name], 0, clamp01(dry));
    };
    // Neyman–Scott clumps: clump centres on a jittered grid, 2–6 tufts each scattered ~0.1–0.3 m around the centre,
    // mostly one species per clump (a tussock is one plant); bare gaps open between clumps
    if (cell > 0 && nk) {
      // smooth fields (species drifts ≥ 6 m, dryness patches 17 m) on a 2 m lattice per chunk, bilinear lookups
      const LN = CH / 2 + 1;
      let latReady = false;
      const fillLattice = () => { latReady = true; for (let j = 0; j < LN; j++) for (let i = 0; i < LN; i++) {
        const lx = cx + i * 2, lz = cz + j * 2, o2 = (j * LN + i) * (nk + 1);
        for (let k = 0; k < nk; k++) lat[o2 + k] = keyIsFlat[k] ? 1 : drift(k, lx, lz);
        lat[o2 + nk] = fbm(lx / 17, lz / 17, 2, 77) - 0.5;
      } };
      const field = (x, z, k) => {
        const fx = Math.min(LN - 1.001, Math.max(0, (x - cx) / 2)), fz = Math.min(LN - 1.001, Math.max(0, (z - cz) / 2));
        const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, s0 = nk + 1, o0 = (j * LN + i) * s0 + k;
        return (lat[o0] * (1 - tx) + lat[o0 + s0] * tx) * (1 - tz) + (lat[o0 + LN * s0] * (1 - tx) + lat[o0 + LN * s0 + s0] * tx) * tz;
      };
      for (let z = cz; z < z1; z += cell) for (let x = cx; x < x1; x += cell) {
        const qx = x + r() * cell, qz = z + r() * cell;
        if (crops.length && cropAt(qx, qz)) continue;          // a crop field replaces the sward (rows below)
        const gC = grassW(qx, qz);
        if (gC.excluded || gC.g <= 0.02) continue;            // no sward here (sand, snow, paving): skip the clump
        if (!latReady) fillLattice();                         // smooth fields only for chunks with a sward
        // Poisson-in-patches (critic: near-uniform clump spacing read as polka dots): 2-6 m patches of dense sward
        // with bigger, fuller clumps, thin ground between them
        const pat = ss(0.3, 0.72, fbm(qx / 4.2, qz / 4.2, 2, 431) * 0.7 + clumpField(qx, qz, 2.3, 433) * 0.45);
        if (r() > 0.38 + 0.9 * pat) continue;
        const big = clumpField(qx, qz, 4.1, 9);               // field-scale: denser swards and thinner patches
        const mac = macro ? meadowMacro(qx, qz) : null;
        if (mac && (mac.trod ? r() < 0.88 : r() > mac.dens)) continue; // trodden bare patches, thin ground
        // winter / thaw: the dead sward lies in matted, flopped mats with thinner ground between (not even dots)
        const mat = winter ? clumpField(qx, qz, 3.4, 17) : 0;
        if (winter && mat < 0.12 && r() < 0.75) continue;
        const k = 2 + Math.floor(r() * (3 + 2 * big)) + Math.round(pat * 4.5) + (winter ? Math.round(mat * 4) : 0), spread = 0.1 + 0.2 * r() + mat * 0.15 + pat * 0.1;
        const sdC = env.waterSD ? env.waterSD(qx, qz) : -99, wetC = ss(-6, -0.6, sdC);
        let sum = 0;
        for (let i = 0; i < nk; i++) {
          let v = mixW[i] * field(qx, qz, i);
          if (i === iTus && wetC > 0.3) v *= 1 + wetC;          // rushes / tussocks by the water
          if (i === iStraw) v += (gC.dry || 0) * 0.8;
          wv[i] = v; sum += v;
        }
        if (sum <= 0) continue;
        const pick = () => { let t = r() * sum; for (let i = 0; i < nk; i++) { t -= wv[i]; if (t <= 0) return keys[i]; } return keys[nk - 1]; };
        const species = winter && iFlop >= 0 && mat > 0.45 && r() < 0.75 ? 'flopped' : pick();
        const clumpH = (0.6 + 0.8 * r() * r()) * (0.85 + 0.3 * big) * (mac ? mac.h : 1) * (winter ? 1 - 0.3 * mat : 1);
        const dryC = prof.dry + field(qx, qz, nk) * 0.55 - wetC * 0.35 + (mac ? mac.dry * (1 - prof.dry * 0.6) : 0);
        const geC = (fbm(qx / 2.8, qz / 2.8, 3, 71) - 0.5) * 0.6; // verge noise (smooth at 2.8 m: per clump)
        for (let t = 0; t < k; t++) {
          const a = r() * 6.283, d = spread * Math.sqrt(-2 * Math.log(1 - r() * 0.95)) * 0.6;
          const px = qx + Math.cos(a) * d, pz = qz + Math.sin(a) * d;
          if (px < cx - 1 || pz < cz - 1 || px >= x1 + 1 || pz >= z1 + 1 || (!o.chunks && (px < 0 || pz < 0 || px >= W || pz >= D))) continue;
          const gw = grassW(px, pz);
          if (gw.excluded || gw.g <= 0.01) continue;
          // ragged verge (must-fix 5): noise-jittered density threshold, shorter / drier tufts at the edge
          const ge = gw.g + geC + (vnoise(px / 0.9, pz / 0.9, 73) - 0.5) * 0.3 + (r() - 0.5) * 0.15;
          if (r() > ss(0.12, 0.7, ge) * (0.55 + 0.45 * big)) continue;
          const edge = 1 - ss(0.2, 0.85, ge);
          let name = r() < 0.78 ? species : pick();
          if (edge > 0.4 && iStraw >= 0 && r() < edge * 0.5) name = 'straw';
          // unmown herb strips: the verge band and the strip along walls / fences grow taller forbs and seed heads
          const herb = macro && ((edge > 0.12 && edge < 0.45) || (gw.g > 0.5 && !tall(px, pz)));
          if (herb && r() < 0.4) name = r() < 0.5 && iForb >= 0 ? 'forb' : iSeed >= 0 ? 'seedhead' : name;
          const dry = dryC + gw.dry * 0.4 + edge * 0.3 + (r() - 0.5) * 0.2;
          const hs = 1.2 * (prof.height ?? 1) * clumpH * (0.8 + 0.4 * r()) * (1 - 0.3 * d / 0.4) * (0.75 + 0.5 * Math.min(1, gw.g)) * (herb ? 1.3 : 1 - 0.5 * edge) * (1 + 0.3 * wetC);
          push(name, px, pz, hs, dry);
        }
      }
    }
    // crop fields (bocage.js): drill rows along the field, a clump every ~0.4 m, rows 0.5 m apart; ragged headland
    for (const f of crops) {
      if (f.x1 < cx || f.x0 > x1 || f.z1 < cz || f.z0 > z1) continue;
      const [ax, az] = f.along, rowStep = 0.5, step = f.kind === 'wheat' ? 0.38 : 0.45;
      for (let z = Math.max(cz, f.z0); z < Math.min(z1, f.z1); z += step) for (let x = Math.max(cx, f.x0); x < Math.min(x1, f.x1); x += step) {
        const v = -x * az + z * ax, vr = Math.round(v / rowStep) * rowStep, j = (r() - 0.5) * 0.12;   // snap to the drill row
        const px = x + j * ax - (vr - v) * az, pz = z + j * az + (vr - v) * ax;
        if (!inPoly2(px, pz, f.poly) || grassW(px, pz).excluded) continue;
        const thin = fbm(px / 9, pz / 9, 2, 717);                                                   // lodged / thin patches
        if (r() > 0.55 + 0.45 * ss(0.3, 0.6, thin)) continue;
        push(f.kind, px, pz, (0.85 + 0.25 * r()) * (0.85 + 0.3 * thin), f.kind === 'wheat' ? 0.55 + 0.35 * r() : 0.8 + 0.15 * r());
      }
    }
    // reeds: sharp-edged stands on the water band, a few outliers (docs §3.7)
    if (prof.reeds && env.waterSD && env.waterSD(cx + CH / 2, cz + CH / 2) > -CH) {
      const rc = 0.42 / Math.sqrt(Math.max(0.35, o.reedDensity ?? 1));
      for (let z = cz; z < z1; z += rc) for (let x = cx; x < x1; x += rc) {
        const px = x + r() * rc, pz = z + r() * rc, sd = env.waterSD(px, pz);
        if (sd < -2.4 || sd > 1.4 || (env.deepSD && env.deepSD(px, pz) > -0.4)) continue;
        const band = ss(-2.4, -0.9, sd) * (1 - ss(0.8, 1.4, sd));
        const stand = fbm(px / 9, pz / 9, 3, 501) + (vnoise(px * 1.3, pz * 1.3, 503) - 0.5) * 0.06;
        if (r() > band * (ss(0.44, 0.5, stand) + 0.05)) continue;
        if (grassW(px, pz).excluded || !tall(px, pz)) continue;
        if (env.sandW && [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]].some(([dx, dz]) => env.sandW(px + dx, pz + dz) > 0.4)) continue; // muddy banks, not a beach
        const hs = (0.8 + 0.3 * r()) * (0.75 + 0.35 * ss(0.44, 0.62, stand)) * (prof.season === 'thaw' ? 0.7 : 1);
        push('reed', px, pz, hs, prof.dry > 0.6 ? 0.85 + 0.1 * r() : prof.dry * 0.5 + (r() - 0.5) * 0.15);
      }
    }
    // marram: clumps on coast sand above the tide line; drinn: sparse tussocks on open desert sand
    const extra = prof.dunes ? { name: 'marram', c: 1.7, sc: 5.5, k: 1.0 } : prof.src === 'desert' ? { name: 'drinn', c: 2.0, sc: 6, k: 0.3 } : null;
    if (extra && env.sandW) for (let z = cz; z < z1; z += extra.c) for (let x = cx; x < x1; x += extra.c) {
      const px = x + r() * extra.c, pz = z + r() * extra.c;
      const sw = env.sandW(px, pz);
      if (sw < 0.35) continue;
      const sd = env.waterSD ? env.waterSD(px, pz) : -99;
      if (sd > -2.5) continue; // not on the wet strand
      if (extra.name === 'marram') {
        // marram (critic: an even dot pattern): dense tussocks on the dune crests and along wind-aligned streaks,
        // bare sand in the swales between; tussock size follows the crest
        const h0 = heightAt(px, pz), rim = (heightAt(px + 3, pz) + heightAt(px - 3, pz) + heightAt(px, pz + 3) + heightAt(px, pz - 3)) / 4;
        const crest = ss(-0.03, 0.09, h0 - rim) * 0.55 + fbm(px / 13, pz / 13, 2, 611) * 0.45;
        const streak = fbm((px * wx + pz * wz) / 26, (pz * wx - px * wz) / 4.5, 2, 613);   // long along the wind
        const dune = ss(0.3, 0.6, crest * 0.6 + streak * 0.4);
        if (r() > dune * clumpField(px, pz, extra.sc, 13) * 1.8 * ss(0.35, 0.7, sw) * ss(-2.5, -5, sd)) continue;
        if (grassW(px, pz).excluded || !tall(px, pz)) continue;
        // a tussock colony: 2–7 overlapping tussocks round the accepted point (bigger and more on the crests)
        const nT = 3 + Math.floor(r() * (2 + 9 * dune)), spread = 0.6 + 0.6 * dune;
        for (let t = 0; t < nT; t++) {
          const a = r() * 6.283, d = spread * Math.sqrt(r()) * (t ? 1 : 0), tx = px + Math.cos(a) * d, tz = pz + Math.sin(a) * d;
          const hs = (0.62 + 0.5 * dune) * (0.7 + 0.5 * r());
          push('marram', tx, tz, hs, 0.15 + 0.5 * r() * r() + 0.25 * (1 - dune));
        }
        continue;
      }
      const patch = ss(0.4, 0.66, fbm(px / 11, pz / 11, 3, 611)) * clumpField(px, pz, extra.sc, 13);
      if (r() > patch * extra.k * ss(0.35, 0.7, sw) * ss(-2.5, -5, sd)) continue;
      if (grassW(px, pz).excluded || !tall(px, pz)) continue;
      push(extra.name, px, pz, 0.75 + 0.5 * r(), 0.75 + 0.2 * r());
    }
    // shuffle each list (any prefix = uniform subset) and write the rank
    for (const name in lists) {
      const a = lists[name], n = a.length / STRIDE;
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        for (let c = 0; c < STRIDE; c++) { const t = a[i * STRIDE + c]; a[i * STRIDE + c] = a[j * STRIDE + c]; a[j * STRIDE + c] = t; }
      }
      for (let i = 0; i < n; i++) a[i * STRIDE + 8] = (i + 0.5) / n;
    }
    if (Object.keys(lists).length) out.push({ cx, cz, lists });
  }
  return out;
}
