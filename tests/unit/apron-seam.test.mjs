/**
 * Map / apron seam (user request 2026-09-30 "make the edges of the shore more smooth and less polygonal"; verifier:
 * banks jogged, notched or turned 90 deg where they crossed a map edge): wherever a bank crosses a map edge, its
 * contours down the slope — on the map's 0.25 m mesh inside, the apron mesh (art/apron.js) outside — run as one smooth
 * curve through the seam, with no step, notch or corner (tests/shore-seam-metric.mjs; the GPU edges-void tests run the
 * same metric on the real meshes). The old extruded seam band measured 19–71 deg here.
 */
import { test, assert } from './lib.mjs';
import { loadGrid } from './mission-check.mjs';
import { getMission } from '../../src/missions/index.js';
import { CONFIG } from '../../src/config.js';
import { buildApronField } from '../../src/world/apron-field.js';
import { buildShoreField } from '../../src/world/shore-field.js';
import { apronHeights, apronGeometry } from '../../src/art/apron.js';
import { carveDepth, WATER_DEPTH, ICE_DEPTH } from '../../src/art/terrain/terrain.js';
import { PALETTES, undulation } from '../../src/art/terrain/terrain-layers.js';
import { meshSurface, seamTurns } from '../shore-seam-metric.mjs';

/** The map terrain as createTerrain builds it (0.25 m lattice, bilinear) over the shore field; no flat mask. */
function mapTerrain(def, shore, W, D, theater) {
  const P = PALETTES[theater] || PALETTES.temperate, src = P.sourceTheater || (PALETTES[theater] ? theater : 'temperate');
  const frozen = src === 'snow' && !!def.water?.frozen, depths = frozen ? ICE_DEPTH : WATER_DEPTH, seg = 4, cache = new Map();
  const vh = (i, j) => {
    const k = j * 100000 + i;
    let y = cache.get(k);
    if (y === undefined) {
      const x = i / seg, z = j / seg;
      y = undulation(src, x, z, 7);
      const sdW = shore.wetAt(x, z);
      if (sdW > -0.4) {
        const wmin = carveDepth(sdW, shore.deepAt(x, z), depths), w = Math.min(1, (sdW + 0.4) / 0.4);
        y = y * (1 - w) + (frozen ? wmin + y * 0.02 : Math.min(y * 0.3, 0) + wmin) * w;
      }
      cache.set(k, y);
    }
    return y;
  };
  const heightAt = (x, z) => {
    const fx = Math.min(W * seg - 1e-3, Math.max(0, x * seg)), fz = Math.min(D * seg - 1e-3, Math.max(0, z * seg));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    return (vh(i, j) * (1 - tx) + vh(i + 1, j) * tx) * (1 - tz) + (vh(i, j + 1) * (1 - tx) + vh(i + 1, j + 1) * tx) * tz;
  };
  return { src, seed: 7, frozen, heightAt };
}

/** Every bank crossing a map edge of mission `id` (the game's field, apron and a stub of the map's mesh). */
export function seamCrossings(id) {
  const ctx = loadGrid(getMission(id)), def = ctx.def, ap = buildApronField(ctx.grid, def);
  const shore = buildShoreField(ap.grid, def, { ox: ap.ox, oz: ap.oz, feats: ap.feats, W: ap.W, D: ap.D });
  const W = ap.W, D = ap.D, t = mapTerrain(def, shore, W, D, def.theater);
  const H = apronHeights(ap, t, CONFIG.apron, shore);
  const geo = apronGeometry(ap, H.heightAt, t.heightAt, CONFIG.apron.cell, H.fineAt);
  const near = (x, z) => { const qx = Math.min(W, Math.max(0, x)), qz = Math.min(D, Math.max(0, z)); return Math.hypot(x - qx, z - qz) < 8; };
  const mesh = meshSurface(geo.attributes.position.array, geo.index.array, (x, z) => near(x, z) && !(x > 0.5 && x < W - 0.5 && z > 0.5 && z < D - 0.5));
  // drawn ground: the map mesh inside the map (it covers the apron's under-map strip), the apron mesh outside
  const G = (x, z) => (x >= 0 && x <= W && z >= 0 && z <= D ? t.heightAt(x, z) : mesh(x, z));
  const out = [];
  if (t.frozen) return { out, t, G, shore, H };
  out.push(...seamTurns(W, D, G, shore.wetAt, WATER_DEPTH[6]));
  return { out, t, G, shore, H };
}

test('every shore crossing a map edge stays one smooth curve through the map / apron seam (M1, M2, M3)', () => {
  for (const id of ['m01', 'm02', 'm03']) {
    const { out } = seamCrossings(id);
    assert.ok(out.length >= 3, `${id}: bank crossings found on the map edges (${out.length})`);
    const bad = out.filter((c) => c.turn > 25);
    assert.deepEqual(bad.map((c) => `${c.at} ${c.turn.toFixed(0)} deg`), [], `${id}: banks turn <= 25 deg per 0.5 m across the seam (a jog / notch / corner: 35-70)`);
  }
});
