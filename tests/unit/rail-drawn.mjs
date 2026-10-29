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

/**
 * How the building library draws a structure (art/building-props.js libraryVisual): its picked asset, the quarter turn
 * and the fit scale (sx, sy, sz), or null when the library does not draw it.
 */
function libraryFit(M, s, def) {
  if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.z) || s.assetPart) return null;
  const pk = pickAsset(s.type, s, { theater: def.theater || 'temperate', missionId: def.id });
  const a = pk && M.assets[pk.name];
  if (!a) return null;
  const turn = s.artTurn === 0 || s.artTurn === 1 ? s.artTurn : pk.turn;
  const ew = turn ? pk.ext.d : pk.ext.w, ed = turn ? pk.ext.w : pk.ext.d;
  const w = s.w ?? (s.r != null ? s.r * 2 : null), d = s.d ?? (s.r != null ? s.r * 2 : null);
  const [fx, fz] = artFillOf(s);
  const rawX = w ? (w * fx) / ew : 1, rawZ = d ? (d * fz) / ed : 1;
  const deckY = s.deckY ?? (s.type === 'watchtower' ? s.h : null);
  const doorsH = (a.doors || []).filter((dd) => dd.kind !== 'gate' && dd.height < 3.2).map((dd) => dd.height);
  let sx, sy, sz;
  if (SPAN_FIT.test(s.type) || (pk.ext.deckY && deckY)) {
    sx = clamp(rawX, 0.55, 1.8); sz = clamp(rawZ, 0.55, 1.8);
    sy = pk.ext.deckY && deckY ? clamp(deckY / pk.ext.deckY, 0.7, 1.4) : clamp(Math.sqrt(sx * sz), 0.8, 1.25);
  } else ({ sx, sy, sz } = fitScale(rawX, rawZ, doorsH.length ? Math.max(...doorsH) : 0));
  return { pk, a, turn, sx, sy, sz };
}

/** Map structure id → [{poly}] for the mission's library-drawn structures. */
export async function drawnPlans(def) {
  const M = buildingManifest(), out = new Map();
  await useManifest(M, def.id);
  try {
    (def.structures || []).forEach((s, i) => {
      const f = libraryFit(M, s, def);
      if (!f) return;
      const { pk, a, turn, sx, sz } = f;
      // its sidecar's footprint and roof outlines (else its bbox)
      const outlines = [...(a.footprints || []), ...(a.roofs || [])].filter((q) => Array.isArray(q.points) && q.points.length >= 3)
        .map((q) => ({ pts: q.points, natural: /rubble|debris/.test(q.kind ?? '') }));
      const b = a.bbox;
      if (!outlines.length && b) outlines.push({ pts: [[b.min[0], b.min[2]], [b.max[0], b.min[2]], [b.max[0], b.max[2]], [b.min[0], b.max[2]]], natural: false });
      if (!outlines.length) return;
      // (the plan check keeps the footprint fit's plain scale: doors do not change sx / sz)
      out.set(s.id ?? `${s.type}#${i}`, outlines.map((q) => ({ ...drawnPoly(s, q.pts, pk.ext, turn, sx, sz), natural: q.natural })));
    });
  } finally { await useManifest(null); }
  return out;
}

/** Roof kinds drawn as a flat slab: a roof (its parapet up to the model's height on the main one) or a floor / balcony. */
const FLAT_ROOF = /^(flat|deck|floor|gallery|balcony|terrace)$/;
const ROOF_SLAB = /^(flat|deck)$/;

/**
 * The drawn solids of a mission's library-drawn structures, for the default-camera view check (rail-clearance.js
 * viewHidden): Map structure id → [{poly, y0, top}] wall prisms and [{poly, eave, ridge, kind}] roofs, in world space
 * and metres. From the sidecar: the walls (footprints) stand to the eaves (`roofElev`); a gable / hip roof rises from
 * its outline at its `elev` to a ridge along the outline's long axis — the main roof (the highest eaves) to the model's
 * full height (bbox, chimneys included: conservative), a lower one at a 50° pitch; a flat roof is a slab at its `elev`
 * + 1 m of parapet (the main one's to the model's height), a floor or balcony a slab + 0.3 m; without roofs, the
 * footprints stand to the full height. Heights × the fit's sy, + the visual's `elev`. An approximation (chimneys
 * off the ridge, dormers and broken walls are not modelled): tests/unit/rails-clear.test.mjs allows for it.
 */
export async function drawnSolids(def) {
  const M = buildingManifest(), out = new Map();
  await useManifest(M, def.id);
  try {
    (def.structures || []).forEach((s, i) => {
      const f = libraryFit(M, s, def);
      if (!f) return;
      const { pk, a, turn, sx, sy, sz } = f;
      const y0 = s.elev ?? 0, H = (a.height ?? a.bbox?.max?.[1] ?? 0) * sy;
      const P = (pts) => drawnPoly(s, pts, pk.ext, turn, sx, sz).poly;
      const roofs = (a.roofs || []).filter((r) => Array.isArray(r.points) && r.points.length >= 3 && Number.isFinite(r.elev));
      const pitched = roofs.filter((r) => !FLAT_ROOF.test(r.kind ?? ''));
      const top = Math.max(0, ...roofs.map((r) => r.elev));
      const mainPitched = pitched.length ? Math.max(...pitched.map((r) => r.elev)) : null;
      const solids = [];
      let walls = (a.footprints || []).filter((q) => Array.isArray(q.points) && q.points.length >= 3);
      if (!walls.length && a.bbox) { const b = a.bbox; walls = [{ points: [[b.min[0], b.min[2]], [b.max[0], b.min[2]], [b.max[0], b.max[2]], [b.min[0], b.max[2]]] }]; }
      // (pitched roofs: the walls stop at the eaves; only slabs, the top one over half the model's height: the walls stop
      // there — a flat-roofed block, a gutted shell's top floor; else — a tower, a mansard block that lists only a
      // balcony — the walls stand to the full height)
      const slabTop = !pitched.length && roofs.length > 0 && top * sy > 0.5 * H;
      const flatMain = slabTop && roofs.some((r) => r.elev === top && ROOF_SLAB.test(r.kind ?? ''));
      const wallTop = pitched.length ? (a.roofElev ?? mainPitched) * sy : slabTop ? top * sy : H;
      for (const q of walls) solids.push({ poly: P(q.points), y0, top: y0 + wallTop });
      for (const r of roofs) {
        const e = r.elev * sy;
        // (a flat roof: 1 m of parapet, the main one's to the model's height; a floor or balcony: its slab and railing)
        if (FLAT_ROOF.test(r.kind ?? '')) { solids.push({ poly: P(r.points), y0, top: y0 + (flatMain && r.elev === top ? H : e + (ROOF_SLAB.test(r.kind ?? '') ? 1 : 0.3)) }); continue; }
        const span = Math.min(...edgeLens(P(r.points)));
        const ridge = r.elev === mainPitched ? H : Math.min(H, e + 0.6 * span);
        solids.push({ poly: P(r.points), eave: y0 + e, ridge: y0 + Math.max(e + 0.1, ridge), kind: r.kind === 'hip' ? 'hip' : 'gable' });
      }
      out.set(s.id ?? `${s.type}#${i}`, solids);
    });
  } finally { await useManifest(null); }
  return out;
}

/** The lengths of a 4-point outline's two sides (else its bbox sides). */
function edgeLens(poly) {
  if (poly.length === 4) return [Math.hypot(poly[1][0] - poly[0][0], poly[1][1] - poly[0][1]), Math.hypot(poly[2][0] - poly[1][0], poly[2][1] - poly[1][1])];
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)];
}
