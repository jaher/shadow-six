/**
 * The drawn plans of a mission's library visuals, for the rail clearance check (src/missions/rail-clearance.js
 * drawnPoly): each structure the building library draws, as art/building-props.js libraryVisual places it — its
 * sidecar's footprint and roof outlines (walls, eaves, annexes, a pier's T head), centred on the model's body, turned,
 * fitted to the footprint. Node
 * only (reads the manifests); not a *.test.mjs file (tests/unit/rails-clear.test.mjs, tools/layout/rail-report.mjs).
 */
import { readFileSync } from 'node:fs';
import { useManifest, pickAsset, fitScale, artFillOf } from '../../src/art/building-props.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { drawnPoly } from '../../src/missions/rail-clearance.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
let MERGED = null;
/** The building manifest with every add-on merged (as the game loads it). */
export function buildingManifest() {
  if (MERGED) return MERGED;
  const m = JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
  for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`))));
  return (MERGED = m);
}

const SPAN_FIT = /^(bridge|dam|pier|rail_bridge|truss_bridge|mobile_bridge|wall|fence|gate|castle_wall|moat|lock_gate|water_gate)$/;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Map structure id → [{poly}] for the mission's library-drawn structures. */
export async function drawnPlans(def) {
  const M = buildingManifest(), out = new Map();
  await useManifest(M, def.id);
  try {
    (def.structures || []).forEach((s, i) => {
      if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.z) || s.assetPart) return;
      const pk = pickAsset(s.type, s, { theater: def.theater || 'temperate', missionId: def.id });
      const a = pk && M.assets[pk.name];
      if (!a) return;
      // its sidecar's footprint and roof outlines (else its bbox)
      const outlines = [...(a.footprints || []), ...(a.roofs || [])].filter((f) => Array.isArray(f.points) && f.points.length >= 3)
        .map((f) => ({ pts: f.points, natural: /rubble|debris/.test(f.kind ?? '') }));
      const b = a.bbox;
      if (!outlines.length && b) outlines.push({ pts: [[b.min[0], b.min[2]], [b.max[0], b.min[2]], [b.max[0], b.max[2]], [b.min[0], b.max[2]]], natural: false });
      if (!outlines.length) return;
      const turn = s.artTurn === 0 || s.artTurn === 1 ? s.artTurn : pk.turn;
      const ew = turn ? pk.ext.d : pk.ext.w, ed = turn ? pk.ext.w : pk.ext.d;
      const w = s.w ?? (s.r != null ? s.r * 2 : null), d = s.d ?? (s.r != null ? s.r * 2 : null);
      const [fx, fz] = artFillOf(s);
      const rawX = w ? (w * fx) / ew : 1, rawZ = d ? (d * fz) / ed : 1;
      let sx, sz;
      if (SPAN_FIT.test(s.type)) { sx = clamp(rawX, 0.55, 1.8); sz = clamp(rawZ, 0.55, 1.8); } else ({ sx, sz } = fitScale(rawX, rawZ, 0));
      out.set(s.id ?? `${s.type}#${i}`, outlines.map((q) => ({ ...drawnPoly(s, q.pts, pk.ext, turn, sx, sz), natural: q.natural })));
    });
  } finally { await useManifest(null); }
  return out;
}
