/**
 * Map builder — owned by MISSIONS (schema-driven building; visuals are ART's placeholder props).
 * Builds a mission's static world from its normalized def (design-spec §7.3):
 *   1. base terrain + `terrain[]` features (rect | poly | path | circle)
 *   2. every structure via art/props.js `buildProp` (mesh + footprints), with schema-level footprint
 *      shaping: `points` polygons for area props (cliffs), `segments` for linear props with gaps, `ring`
 *      MG sandbag rings, rect footprints for round props given `w × d`, `deck:true` (dam crest → bridge)
 *   3. grid passes terrain → shore rim (`shoreShallowWidth`, deep water within that distance of land →
 *      SHALLOW) → bridge → block → elevation (`walkways`, watchtower decks: raised walkable surfaces)
 *   4. meshes + interactables (explosive targets, doors/gates, switches, ladders, pickups, extraction)
 *   5. off-grid links (`climbLinks`, `ladders`; endpoints snapped onto a walkable cell at their height)
 *   6. mission registries on the world: `world.zones` (+ `world.alarm.zones`), `world.barracks`,
 *      `world.jails`, `world.ladders`, `world.triplines`, `world.markers`
 * Units and vehicles are spawned by the Game, not here.
 * @module world/map-builder
 */

import * as THREE from 'three';
import { terrainCode, LINK, T, B } from './grid.js';
import { normalizeMission } from '../missions/schema.js';
import { buildProp, LINEAR_PROPS } from '../art/props.js';
import { buildTerrain, canBuildRealTerrain, TREE_TYPES, coverPropsWithSnow, setPropSnow, wireTrailRecords, buildMaskedWater } from '../art/terrain.js';
import { buildWater } from '../art/water.js';
import { buildWalkDeck, WALK_SHIFT, dressingMaterial } from '../art/dressing.js';
import { buildMissionWire } from '../art/wire-obstacles.js';
import * as WaterModule from '../art/water/index.js';
import { buildExtraProp, isExtraProp } from '../art/props-extra.js';
import { installSetpieces } from '../missions/setpieces.js';
import { Interactable, createInteractable, createPickup, createExtraction, spawnMissionInteractables } from '../entities/interactables.js';
import { tickBuildings, buildingLog } from '../art/building-props.js';
import { createWindFx } from '../render/wind-fx.js';
import { createAmbientLife } from '../render/ambient-life.js';
import { normalizeRoadNetwork, paintRoadGrid, RoadIndex, expandFurniture, FURNITURE_BLOCK } from './roads.js';
import { buildPavement } from '../art/pavement/index.js';
import { buildFurniture } from '../art/furniture/index.js';
import { createStreetLights } from '../render/street-lights.js';
import { resolveLighting } from '../engine/lighting.js';
import { createBuildingBatch } from '../art/building-library.js';
import { resolvePlacement, placeCat } from './placement.js';
import { planHull, planCells, finestMeshes, measureTop, deckField, lowSurfaces, overheadCells, standingCells } from './placement-visual.js';
import { applyLibraryNav, libraryDoorPoints, wireLibraryDoors, libraryDecks, calibrateDeck, libraryWaterObstacles } from './map-library.js';
import '../entities/bcd-interactables.js'; // registers the BCD mechanics' interactable kinds (docs/bcd-plan.md §1.10)

/** Grid owner ids for structures start here (entity ids stay far below). */
export const STRUCTURE_OWNER_BASE = 100000;

/** Write one footprint into the grid layer(s) it declares. `pass` = 'terrain' | 'bridge' | 'block'. */
export function applyFootprint(grid, fp, pass, owner = 0) {
  let layer, value;
  if (pass === 'terrain') { if (fp.terrain == null) return; layer = 'terrain'; value = fp.terrain; }
  else if (pass === 'bridge') { if (!fp.bridge) return; layer = 'bridge'; value = 1; }
  else { if (!fp.block) return; layer = 'block'; value = fp.block; }
  const own = pass === 'terrain' ? undefined : owner;
  switch (fp.shape) {
    case 'rect': grid.fillOrientedRect(fp.x, fp.z, fp.w, fp.d, fp.rot ?? 0, layer, value, own); break;
    case 'circle': grid.fillCircle(fp.x, fp.z, fp.r, layer, value, own); break;
    case 'poly': grid.fillPoly(fp.points, layer, value, own); break;
    case 'line': grid.fillLine(fp.points, fp.width, layer, value, own); break;
    default: console.warn('[map-builder] unknown footprint shape', fp.shape);
  }
}

/** Apply a mission `terrain[]` entry ({type:'rect'|'poly'|'path'|'circle', terrain, ...}). rect x,z = NW corner. */
function applyTerrainFeature(grid, t) {
  const code = terrainCode(t.terrain);
  if (t.type === 'rect') grid.fillRect(t.x, t.z, t.w, t.d, 'terrain', code);
  else if (t.type === 'poly') grid.fillPoly(t.points, 'terrain', code);
  else if (t.type === 'path') grid.fillLine(t.points, t.width ?? 3, 'terrain', code);
  else if (t.type === 'circle') grid.fillCircle(t.x, t.z, t.r, 'terrain', code);
}

const pts2 = (points) => points.map((p) => (Array.isArray(p) ? p : [p.x, p.z]));
/** Polygon centroid (vertex average — good enough to place a placeholder mesh). */
function centroid(points) {
  const p = pts2(points);
  return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
}

/**
 * Points of an MG sandbag ring: a 270° arc of radius r around (x, z), open behind the gunner (the
 * opening faces away from `rot`, the covered direction). Used as a `line` footprint.
 */
export function ringPoints(x, z, r, rot = 0, arcDeg = 270, n = 12) {
  const arc = (arcDeg * Math.PI) / 180, out = [];
  for (let k = 0; k <= n; k++) {
    const a = rot - arc / 2 + (arc * k) / n;
    out.push([x + Math.cos(a) * r, z + Math.sin(a) * r]);
  }
  return out;
}

/**
 * Build one structure def: calls buildProp and applies the schema-level footprint shaping.
 * @returns {{object3d: THREE.Object3D, footprints: object[], interactables?: object[]}}
 */
/** A mission structure that is an explosive fuel drum (§3.6 `barrel` class) → spawned as a Barrel entity. */
export function isExplosiveBarrel(s) {
  return !!s && s.type === 'barrels' && s.explosive === 'barrel';
}

export function buildStructure(s, ctx) {
  const r = buildStructureCore(s, ctx);
  // wall walks get a plank deck on posts, stopping at the wall's inner face (units never stand in the air);
  // a rock massif (`cliff`) is its own walking surface: its broken top carries the units, no deck
  if (s.walkways?.length && s.type !== 'cliff' && ctx.library !== false && !ctx.navOnly && r.object3d) {
    const strips = walkwayStrips(s);
    if (strips.length) {
      const deck = buildWalkDeck(strips); // world coords → into the structure's frame
      r.object3d.updateMatrixWorld(true);
      deck.applyMatrix4(r.object3d.matrixWorld.clone().invert());
      r.object3d.add(deck);
    }
  }
  return r;
}

/** Deck strips of a structure's `walkways` with the wall band (its runs ± half width) cut out. */
export function walkwayStrips(s) {
  const runs = (s.segments || (s.points ? [s.points] : [])).map(pts2), hw = (s.width ?? 0.5) / 2 + 0.03, out = [];
  for (const w of s.visualWalkways || s.walkways || []) {
    const p = pts2(w.points), W = w.width ?? 1.2;
    for (let k = 0; k + 1 < p.length; k++) {
      const [ax, az] = p[k], [bx, bz] = p[k + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-6) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2;
      // across offset of the nearest wall segment (walks run along their wall)
      let best = null;
      for (const run of runs) for (let q = 0; q + 1 < run.length; q++) {
        const [cx, cz] = run[q], [dx, dz] = run[q + 1], l2 = (dx - cx) ** 2 + (dz - cz) ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((mx - cx) * (dx - cx) + (mz - cz) * (dz - cz)) / l2));
        const fx = cx + (dx - cx) * t, fz = cz + (dz - cz) * t, dist = Math.hypot(fx - mx, fz - mz);
        if (!best || dist < best.dist) best = { dist, off: (fx - mx) * nx + (fz - mz) * nz };
      }
      let lo = -W / 2, hi = W / 2;
      if (best && best.dist < W / 2 + hw) {
        // the palisade steps WALK_SHIFT away from the walk (dressing buildWall): the deck meets its rails
        const toward = Math.sign(-best.off) || 1, inner = hw - WALK_SHIFT + 0.07;
        const b0 = best.off - (toward < 0 ? inner : hw), b1 = best.off + (toward > 0 ? inner : hw);
        if (hi - b1 >= b0 - lo) lo = Math.max(lo, b1); else hi = Math.min(hi, b0);
      }
      if (hi - lo >= 0.3) out.push({ ax, az, bx, bz, off: (lo + hi) / 2, width: hi - lo, y: w.y });
    }
  }
  return out;
}

function buildStructureCore(s, ctx) {
  const { type, segments, visualRuns, placementDropped, visualWalkways, ...params } = s;
  // placement rules (world/placement.js): the visual run is cut / chained, the nav footprint keeps the authored line
  if (visualRuns && LINEAR_PROPS.includes(type)) {
    const nav = buildStructureCore({ ...params, type, ...(segments ? { segments } : {}) }, { ...ctx, library: false, navOnly: true });
    const group = new THREE.Group();
    group.name = `prop:${type}${params.id ? ':' + params.id : ''}`;
    for (const run of visualRuns) group.add(buildProp(type, { ...params, points: run }, ctx).object3d);
    return { object3d: group, footprints: nav.footprints, interactables: nav.interactables || [] };
  }
  // linear prop with gaps: one buildProp per segment, merged
  if (segments && LINEAR_PROPS.includes(type)) {
    const group = new THREE.Group();
    const footprints = [];
    for (const seg of segments) {
      const r = buildProp(type, { ...params, points: seg }, ctx);
      group.add(r.object3d);
      footprints.push(...r.footprints);
    }
    return { object3d: group, footprints, interactables: [] };
  }
  // area prop given as a polygon (cliffs, irregular ruins): mesh at the centroid, poly footprint
  const poly = !LINEAR_PROPS.includes(type) && Array.isArray(params.points) && params.points.length >= 3 ? pts2(params.points) : null;
  if (poly && params.x == null) [params.x, params.z] = centroid(poly);
  // walkable decks (dam crest) sit at ground level on this flat map: the placeholder mesh is the deck slab,
  // the structure's real height stays in the def (`h`) for FX/collapse
  // §7.7 types (villa, rail_bridge, lock_gate, v2_rocket …): placeholder builders in art/props-extra.js
  const r = (isExtraProp(type) ? buildExtraProp : buildProp)(type, params.deck ? { ...params, h: params.deckY ?? 0.6 } : params, ctx);
  let fps = r.footprints;
  const blockOf = (list) => list.find((f) => f.block)?.block ?? null;
  if (poly) {
    const block = params.block ?? blockOf(fps) ?? B.HIGH;
    fps = [...fps.filter((f) => !f.block), { shape: 'poly', points: poly, block }];
  } else if (params.ring) {
    const block = params.block ?? blockOf(fps) ?? B.LOW;
    fps = [...fps.filter((f) => !f.block), { shape: 'line', points: ringPoints(params.x, params.z, params.ring.r, params.rot ?? 0, params.ring.arc ?? 270), width: params.ring.width ?? 0.8, block }];
  } else if (params.w != null && params.d != null && fps.length && fps.every((f) => f.shape === 'circle')) {
    // round catalogue prop (rocks, …) given an explicit w × d: oriented rect footprint
    fps = fps.map((f) => ({ ...f, shape: 'rect', x: params.x, z: params.z, w: params.w, d: params.d, rot: params.rot ?? 0 }));
  }
  // thin blocking rects (gates, barriers) must stay ≥ 2 cells thick at any rotation, or diagonal ones leak
  fps = fps.map((f) => (f.block && f.shape === 'rect' && Math.min(f.w, f.d) < 2 * ctx.grid.cell
    ? (f.w < f.d ? { ...f, w: 2 * ctx.grid.cell } : { ...f, d: 2 * ctx.grid.cell }) : f));
  if (params.deck) {
    // walkable deck (dam crest): blocking footprints become bridge cells
    fps = fps.map((f) => (f.block ? { ...f, block: undefined, bridge: 1 } : f));
  }
  return { ...r, footprints: fps };
}

/**
 * Run the placement rules (world/placement.js) over a mission's first-pass build. Browser: solids use their visual
 * plan hulls (library sidecar meshes, dressing); grid-only: the data footprints.
 * @returns {ReturnType<typeof resolvePlacement> & {changed: Set<number>}}
 */
export function placeStructures(mission, first, { grid, meshes = false, realTerrain = false } = {}) {
  const hulls = new Map();
  const shapeOf = meshes ? (def, k, band) => {
    const r = first[k];
    if (!r?.object3d || TREE_TYPES.includes(def.type)) return null;
    const key = `${k}:${band}`;
    if (!hulls.has(key)) {
      if (band === 'low') hulls.set(key, planCells(r.object3d, { maxY: 1.8, cell: 0.25 }));
      else if (band.startsWith('body')) hulls.set(key, planCells(r.object3d, { minY: 0.3, maxY: +band.split(':')[1] || 1.8, cell: 0.25, fit: true }));
      else { const h = planHull(r.object3d); hulls.set(key, h ? [h] : null); }
    }
    return hulls.get(key);
  } : null;
  const W = grid.width, D = grid.depth;
  const wet = (x, z) => { const t = grid.terrainAt?.(x, z); return t === T.WATER || t === T.SHALLOW; };
  const isFree = (x, z, cat, pt) => x > 0.5 && z > 0.5 && x < W - 0.5 && z < D - 0.5 && (!wet(x, z) || wet(pt.x, pt.z));
  const res = resolvePlacement(mission.structures || [], { shapeOf, isFree, vehicles: mission.vehicles, terrain: mission.terrain, items: mission.items, interactables: mission.interactables });
  const changed = new Set();
  res.structures.forEach((d, k) => {
    const o = (mission.structures || [])[k];
    if (d.visualRuns || d.visualWalkways || d.x !== o.x || d.z !== o.z) changed.add(k);
  });
  return { ...res, changed };
}

/**
 * Rule (e) body clearance (m): a cell is blocked when a visual comes this close to its centre, so a walker on the
 * nearest free cell centre keeps its shoulders and boots out of the post, curb or log end beside it (half that
 * next to bridge / pier decks, whose approaches must stay open).
 */
export const VIS_NAV_MARGIN = 0.2;

/** Placement categories whose visuals block walking beyond their footprints (rule e). */
const VIS_NAV_CATS = new Set(['building', 'tower', 'tent', 'ruins', 'prop', 'rocks', 'rocks_big', 'vehicle', 'emplacement', 'pole', 'sandbags', 'cliff']);

/**
 * Rule (e) nav clearance vs meshes: every cell whose centre lies under (or within VIS_NAV_MARGIN of) a
 * structure's visual at body height (0.3–1.8 m, enclosed interiors filled) and is still walkable ground becomes a
 * nav-only block (grid.navBlock: sight and cover unchanged). Door approaches, link / ladder ends keep a 0.9 m free disc. Cleared when the
 * structure is destroyed.
 * @returns {{cells: number, structures: number}}
 */
export function stampVisualNav(world, built) {
  const grid = world.grid, keep = [], lanes = new Set();
  for (const [, p] of world.structureDoors || []) keep.push(p);
  for (const b of built) {
    for (const d of b.library?.doors || []) if (d.approach) keep.push([d.approach.x, d.approach.z]);
    if (b.def.enterable || b.def.garrison) { const p = doorPoint(b.def); keep.push([p.x, p.z]); }
  }
  for (const l of grid.links || []) { keep.push([l.a.x, l.a.z]); keep.push([l.b.x, l.b.z]); }
  const free = (x, z) => keep.some(([kx, kz]) => Math.hypot(kx - x, kz - z) < 0.9);
  let cells = 0, n = 0;
  for (const b of built) {
    if (!b.object3d || TREE_TYPES.includes(b.type) || b.def.clip === false) continue;
    const cat = placeCat(b.def), deck = cat === 'bridge' || cat === 'pier';
    // walls: what the dressing adds around the nav line (end caps, buttresses, plank roofs, walk posts)
    if (LINEAR_PROPS.includes(b.type) && cat !== 'wall') continue;
    if (!VIS_NAV_CATS.has(cat) && !deck && cat !== 'wall') continue;
    // bridges / dams / piers: their walkable deck is nav already; what stands OFF the deck at body height (a
    // dam's arch, a lift bridge's counterweight) blocks, except within 1 m of the deck (approaches, abutments)
    // the approach lanes in line with the deck (its width, 3 m past each end) stay free
    const D = b.def, dc = Math.cos(D.rot ?? 0), ds = Math.sin(D.rot ?? 0);
    // …and 1.5 m around every landing (a deck cell next to walkable land), wherever a curved deck really ends
    const landings = [];
    if (deck) {
      const R = Math.ceil(2 * Math.max(D.w ?? 0, D.d ?? 0) / grid.cell) + 8, ci = grid.worldToCell(D.x ?? 0, D.z ?? 0);
      for (let j = Math.max(0, ci.j - R); j <= Math.min(grid.rows - 1, ci.j + R); j++) for (let i = Math.max(0, ci.i - R); i <= Math.min(grid.cols - 1, ci.i + R); i++) {
        if (!grid.bridge[grid.idx(i, j)]) continue;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (!grid.inBounds(ii, jj)) continue;
          const kk = grid.idx(ii, jj);
          // a landing is where the deck meets dry land (a shallow toe ledge along a dam's face is no way on)
          if (!grid.bridge[kk] && grid.block[kk] === B.NONE && grid.terrain[kk] !== T.WATER && grid.terrain[kk] !== T.SHALLOW) for (let t = 1; t <= 3; t++) landings.push(`${i + di * t},${j + dj * t}`);
        }
      }
    }
    const lane = new Set(landings); // 1.5 m straight out of each landing: the way on / off the deck
    for (const key of lane) { const [i, j] = key.split(',').map(Number); if (grid.inBounds(i, j)) lanes.add(grid.idx(i, j)); }
    const nearDeck = deck ? (i, j) => {
      if (lane.has(`${i},${j}`)) return true;
      const p = grid.cellCenter(i, j);
      if (D.w == null || D.d == null) return false;
      const dx = p.x - D.x, dz = p.z - D.z, u = dx * dc + dz * ds, v = -dx * ds + dz * dc;
      return Math.abs(v) <= D.d / 2 + 0.3 && Math.abs(u) <= D.w / 2 + 3;
    } : null;
    const rects = planCells(b.object3d, { minY: 0.3, maxY: 1.8, cell: 0.25, close: deck || cat === 'wall' ? 0 : 3 });
    if (!rects) continue;
    const out = new Set(), m = deck ? VIS_NAV_MARGIN / 2 : VIS_NAV_MARGIN;
    for (const r of rects) {
      const x0 = r[0][0] - m, z0 = r[0][1] - m, x1 = r[2][0] + m, z1 = r[2][1] + m;
      const c0 = grid.worldToCell(x0, z0), c1 = grid.worldToCell(x1, z1);
      for (let j = Math.max(0, c0.j); j <= Math.min(grid.rows - 1, c1.j); j++) for (let i = Math.max(0, c0.i); i <= Math.min(grid.cols - 1, c1.i); i++) {
        const c = grid.cellCenter(i, j), k = grid.idx(i, j);
        if (c.x < x0 || c.x > x1 || c.z < z0 || c.z > z1) continue;
        if (grid.block[k] !== B.NONE || grid.bridge[k] || grid.elev[k] > 0 || grid.terrain[k] === T.WATER || free(c.x, c.z)) continue;
        if (nearDeck && nearDeck(i, j)) continue;
        out.add(k);
      }
    }
    if (!out.size) continue;
    grid.navStamp(`vis:${b.owner}`, out);
    cells += out.size; n++;
  }
  const off = world.events?.on?.('structure:destroyed', (e) => { if (e?.owner != null) grid.navStamp(`vis:${e.owner}`, []); });
  return { cells, structures: n, lanes, off: typeof off === 'function' ? off : null };
}

/** Placement categories whose base the terrain levels (rule b seating). */
const FLAT_CATS = new Set(['building', 'tent', 'tower', 'ruins', 'prop', 'sandbags', 'emplacement', 'pole']);

/**
 * Rule (b) seating: the ground under a prop's / building's visual base (below 0.6 m, one cell around) is levelled
 * by the terrain (grid.flatExtra → buildFlatMask), so a well, a crate or a lift on a slope neither hangs over a
 * dip nor sinks into a bump; footprint cells alone miss the part of the visual that overhangs them. Interactable
 * props (pickups, drums, devices) included. Structures with an authored `y` keep their ground.
 * @returns {number} cells levelled
 */
export function stampFlatBase(world, built, extra = []) {
  const grid = world.grid, roots = [];
  for (const b of built) {
    if (!b.object3d || TREE_TYPES.includes(b.type) || LINEAR_PROPS.includes(b.type) || b.def.clip === false || b.def.y != null) continue;
    if (FLAT_CATS.has(placeCat(b.def))) roots.push(b.object3d);
  }
  for (const e of extra) if (e?.object3d && !e.float) roots.push(e.object3d);
  if (!roots.length) return 0;
  const flat = grid.flatExtra || (grid.flatExtra = new Uint8Array(grid.cols * grid.rows)), c = grid.cell;
  let n = 0;
  for (const r of roots) {
    const rects = planCells(r, { maxY: 0.6, cell: 0.25, close: 0 });
    for (const q of rects || []) {
      const c0 = grid.worldToCell(q[0][0] - c, q[0][1] - c), c1 = grid.worldToCell(q[2][0] + c, q[2][1] + c);
      for (let j = Math.max(0, c0.j); j <= Math.min(grid.rows - 1, c1.j); j++) for (let i = Math.max(0, c0.i); i <= Math.min(grid.cols - 1, c1.i); i++) {
        const k = grid.idx(i, j);
        if (!flat[k]) { flat[k] = 1; n++; }
      }
    }
  }
  return n;
}

/**
 * Rules (d/e) overhead clearance: what structure visuals put above body height over OPEN cells (eaves, porch and
 * lean-to roofs, balconies, a tower's cabin) → grid.overStamp. Vehicles taller than the lowest point there don't
 * drive in (Vehicle.passableAt) and gun arcs treat it as an obstacle at its height (placement.turretArc). Trees
 * (soft canopies) and decks (boats pass under bridges) are left out. Cleared when the structure is destroyed.
 * @returns {{cells: number, structures: number, off: Function|null}}
 */
export function stampOverhead(world, built) {
  const grid = world.grid;
  let cells = 0, n = 0;
  for (const b of built) {
    if (!b.object3d || TREE_TYPES.includes(b.type) || b.def.clip === false) continue;
    const cat = placeCat(b.def);
    if (cat === 'bridge' || cat === 'pier' || cat === 'flag') continue;
    const raw = overheadCells(b.object3d, { minY: 1.8, maxY: 12, cell: grid.cell });
    const out = new Map();
    for (const [key, r] of raw) {
      const [i, j] = key.split(',').map(Number);
      if (!grid.inBounds(i, j)) continue;
      const k = grid.idx(i, j);
      if (grid.block[k] !== B.NONE || grid.elev[k] > 0.3) continue; // footprints and raised decks: their own rules
      out.set(k, [+r[0].toFixed(2), +r[1].toFixed(2)]);
    }
    // footprint cells: the visual's real top there (a rock or a palisade taller than its data `h`) for gun arcs
    for (const [key, r] of overheadCells(b.object3d, { minY: 0.2, maxY: 30, cell: grid.cell })) {
      const [i, j] = key.split(',').map(Number);
      if (!grid.inBounds(i, j)) continue;
      const k = grid.idx(i, j);
      if (grid.block[k] === B.NONE) continue;
      if (!grid.blockTop) grid.blockTop = new Float32Array(grid.cols * grid.rows);
      if (r[1] > grid.blockTop[k]) grid.blockTop[k] = r[1];
    }
    if (!out.size) continue;
    grid.overStamp(`over:${b.owner}`, out);
    cells += out.size; n++;
  }
  const off = world.events?.on?.('structure:destroyed', (e) => { if (e?.owner != null) grid.overStamp(`over:${e.owner}`, new Map()); });
  return { cells, structures: n, off: typeof off === 'function' ? off : null };
}

/**
 * Rule (d) tree branches: the vegetation system's bark (merged per chunk, built asynchronously) above body height
 * over open cells → a soft overhead stamp (grid.softLo): gun barrels and turret housings keep out of low boughs,
 * hulls and walkers brush through them. Re-stamped whenever called (quality changes regenerate the trees).
 * @returns {number} cells stamped
 */
export function stampTreeBranches(world, root) {
  const grid = world.grid, out = new Map();
  if (!grid || !root) return 0;
  const raw = new Map();
  root.traverse((n) => { if (n.isMesh && !n.isInstancedMesh && n.name === 'vegBark') overheadCells(n, { minY: 1.2, maxY: 6, cell: grid.cell }, raw); });
  for (const [key, r] of raw) {
    const [i, j] = key.split(',').map(Number);
    if (!grid.inBounds(i, j)) continue;
    const k = grid.idx(i, j);
    if (grid.block[k] !== B.NONE) continue; // the trunk's own footprint
    out.set(k, [+r[0].toFixed(2), +r[1].toFixed(2)]);
  }
  grid.overStamp('over:trees', out, true);
  return out.size;
}

/**
 * Rule (e) bodies: every structure's standing parts (0.15–1.2 m above the local walking surface: ground, deck or
 * wall walk) → grid.solidStamp at quarter-cell resolution. A dying unit's body turns / slides clear of them
 * (placement fallHeading / settleBody) even where the nav grid has no block: palisade stakes beside a wall walk,
 * a bridge railing. Cleared when the structure is destroyed.
 * @returns {{cells: number, off: Function|null}}
 */
export function stampStanding(world, built) {
  const grid = world.grid, h = grid.cell / 2, cache = new Map();
  let maxElev = 0;
  for (let k = 0; k < grid.elev.length; k++) if (grid.elev[k] > maxElev) maxElev = grid.elev[k];
  const gy = typeof world.groundY === 'function' ? world.groundY : null;
  const surf = (x, z) => {
    const key = Math.floor(x / h) * 100003 + Math.floor(z / h);
    let v = cache.get(key);
    if (v === undefined) {
      const i = Math.floor(x / grid.cell), j = Math.floor(z / grid.cell);
      const e = grid.inBounds(i, j) ? grid.elev[grid.idx(i, j)] : 0;
      v = Math.max(e, gy ? gy.call(world, x, z) : 0);
      cache.set(key, v);
    }
    return v;
  };
  let cells = 0;
  for (const b of built) {
    if (!b.object3d || TREE_TYPES.includes(b.type) || b.def.clip === false || b.type === 'road' || b.type === 'river') continue;
    const set = standingCells(b.object3d, surf, { lo: 0.15, hi: 1.2, cell: h, maxY: maxElev + 2 });
    if (!set.size) continue;
    grid.solidStamp(`solid:${b.owner}`, set);
    cells += set.size;
  }
  const off = world.events?.on?.('structure:destroyed', (e) => { if (e?.owner != null) grid.solidStamp(`solid:${e.owner}`, []); });
  return { cells, off: typeof off === 'function' ? off : null };
}

/** Measured floor height of a watchtower deck (median of 5 raycasts around its centre), or undefined. */
export function deckSurface(b) {
  const d = b.def, y0 = d.deckY ?? d.h ?? 5.5, meshes = finestMeshes(b.object3d);
  const ys = [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]
    .map(([u, v]) => measureTop(b.object3d, (d.x ?? 0) + u, (d.z ?? 0) + v, y0 - 0.6, y0 + 0.8, meshes)).filter((v) => v != null).sort((p, q) => p - q);
  return ys.length ? +ys[ys.length >> 1].toFixed(3) : undefined;
}

/** Feet footprint for the low-surface ground height (centre + 4 points FOOT_R m out; placement rule e). */
const FOOT_R = 0.18;
const FOOT_OFFS = [[0, 0], [FOOT_R, 0], [-FOOT_R, 0], [0, FOOT_R], [0, -FOOT_R]];

/** Is (x, z) on a bridge cell of the nav grid? */
function onBridgeCell(grid, x, z) {
  const i = Math.floor(x / grid.cell), j = Math.floor(z / grid.cell);
  return i >= 0 && j >= 0 && i < grid.cols && j < grid.rows && grid.bridge[j * grid.cols + i] === 1;
}

/** Library assets repeated ≥ this many times as static scenery are drawn instanced. */
export const INSTANCE_MIN = 3;

/**
 * Static repeats of one library asset (no flag, not destructible/enterable/gate, no door wiring) → one
 * InstancedMesh per mesh and LOD (building-library createBuildingBatch), fitted with each structure's matrix.
 * @returns {Promise[]} batch handles
 */
export function batchLibraryRepeats(libBuilt, parent, log = []) {
  const groups = new Map();
  for (const b of libBuilt) {
    const d = b.def;
    if (d.flag || d.destructible || d.enterable || d.garrison || b.type === 'gate' || d.nav === true) continue;
    if (!groups.has(b.library.asset)) groups.set(b.library.asset, []);
    groups.get(b.library.asset).push(b);
  }
  const out = [];
  for (const [asset, list] of groups) {
    if (list.length < INSTANCE_MIN) continue;
    const placements = list.map((b) => ({ matrix: b.library.matrix }));
    for (const b of list) b.library.dispose(); // the batch draws them
    out.push(createBuildingBatch(asset, placements).then((h) => { parent.add(h.object3d); return h; }).catch((e) => { console.warn('[map-builder] batch', asset, e); return null; }));
    log.push(`instanced ${asset} ×${list.length}`);
  }
  return out;
}

/**
 * Shore pass (§7.3 `shoreShallowWidth`): deep-water cells within `width` metres of a land cell become
 * SHALLOW (wadeable). Map edges are not land. Chamfer distance transform over the grid (O(cells)).
 * @returns {number} cells converted
 */
export function applyShoreShallows(grid, width) {
  if (!(width > 0)) return 0;
  const { cols, rows, terrain } = grid;
  const INF = 1e9, D1 = 1, D2 = Math.SQRT2;
  const dist = new Float32Array(cols * rows);
  for (let k = 0; k < dist.length; k++) dist[k] = terrain[k] === T.WATER ? INF : 0;
  const relax = (k, i, j, di, dj, w) => {
    const ii = i + di, jj = j + dj;
    if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) return;
    const v = dist[jj * cols + ii] + w;
    if (v < dist[k]) dist[k] = v;
  };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = j * cols + i;
    if (!dist[k]) continue;
    relax(k, i, j, -1, 0, D1); relax(k, i, j, 0, -1, D1); relax(k, i, j, -1, -1, D2); relax(k, i, j, 1, -1, D2);
  }
  for (let j = rows - 1; j >= 0; j--) for (let i = cols - 1; i >= 0; i--) {
    const k = j * cols + i;
    if (!dist[k]) continue;
    relax(k, i, j, 1, 0, D1); relax(k, i, j, 0, 1, D1); relax(k, i, j, 1, 1, D2); relax(k, i, j, -1, 1, D2);
  }
  const lim = width / grid.cell;
  let n = 0;
  for (let k = 0; k < dist.length; k++) if (terrain[k] === T.WATER && dist[k] <= lim) { terrain[k] = T.SHALLOW; n++; }
  return n;
}

/**
 * Elevation pass (§10.2 raised walkable areas): writes `grid.elev` and clears the block on
 *  - `walkways: [{id?, points, width?, y}]` of any structure (wall walks: a raised strip over the wall line)
 *  - watchtower decks (`deckY` or `h`): the footprint becomes a raised deck, reachable only by links
 * Raised cells are not connected to the ground (|Δelev| > MAX_STEP) and block ground-level sight.
 * @returns {number} cells raised
 */
export function applyElevation(grid, built) {
  let n = 0;
  const scratch = new grid.constructor(grid.width, grid.depth, grid.cell);
  // a wall / fence / wire line standing on a raised plateau or ramp (walkways of ANOTHER structure: M10 wire belt on
  // the shelf, M11 ridge wall, M12 platform arcades) keeps blocking up there: its cells are raised, not cleared
  const LINES = new Set(['wall', 'fence', 'barbed_wire', 'wire', 'wire_fence', 'palisade', 'sandbag_line', 'railing']);
  const lineOwners = new Set(built.filter((b) => LINES.has(b.type) && (b.def.points || b.def.segments) && !b.def.walkways?.length).map((b) => b.owner));
  const raise = (fp, y, keepLinesOf = null) => {
    scratch.block.fill(0);
    applyFootprint(scratch, { ...fp, block: B.HIGH }, 'block', 0);
    for (let k = 0; k < grid.size; k++) {
      if (!scratch.block[k]) continue;
      if (keepLinesOf != null && grid.block[k] && grid.owner[k] !== keepLinesOf && lineOwners.has(grid.owner[k])) { grid.elev[k] = y; n++; continue; }
      grid.elev[k] = y; grid.block[k] = B.NONE; grid.owner[k] = 0; n++;
    }
  };
  for (const b of built) {
    for (const w of b.def.walkways || []) raise({ shape: 'line', points: pts2(w.points), width: w.width ?? 1.2 }, w.y, b.owner);
    // walkable roofs / decks declared by a footprint (`elev` m, props-extra flat roofs, rail bridge decks)
    for (const fp of b.footprints || []) if (fp.elev > 0) raise(fp, fp.elev);
    if (b.type === 'watchtower') {
      const d = b.def;
      raise({ shape: 'rect', x: d.x, z: d.z, w: d.w ?? 3, d: d.d ?? 3, rot: d.rot ?? 0 }, b.deckSurfaceY ?? d.deckY ?? d.h ?? 5.5);
    }
  }
  if (n) grid.version++;
  return n;
}

/** Standing point in front of a structure's door (local direction `door` rad from `rot`; default: +90° = south face at rot 0). */
export function doorPoint(def) {
  const rot = def.rot ?? 0;
  const side = def.door ?? Math.PI / 2;
  const across = Math.abs(Math.sin(side)) > 0.5;
  const reach = ((across ? def.d : def.w) ?? (def.r ? def.r * 2 : 4)) / 2 + 1;
  return { x: (def.x ?? 0) + Math.cos(rot + side) * reach, z: (def.z ?? 0) + Math.sin(rot + side) * reach };
}

/**
 * Build the static map for `mission` into `world` (grid, scene meshes, interactables, registries).
 * @param {import('./world.js').World} world
 * @param {object} mission mission definition (docs/ARCHITECTURE.md § Missions + design-spec §7.3)
 * @param {{theater?: string, meshes?: boolean, renderer?: object}} [opts] meshes:false → grid only (fast unit tests);
 *   renderer (engine Renderer) → final splat terrain, grass, trails and seeded unique trees (art/terrain.js)
 * @returns {{propsRoot: THREE.Group, terrain: object|null, structures: Map<string, object>, interactables: Interactable[], links: object[],
 *   ready: Promise<void>, frame: (dt:number, camera?:THREE.Camera) => void, dispose: () => void}}
 */
export function buildMap(world, mission, opts = {}) {
  mission = normalizeMission(mission); // design-spec §7.3 (idempotent)
  const grid = world.grid;
  const theater = opts.theater || mission.theater || 'temperate';
  const meshes = opts.meshes !== false;
  // final terrain: tree structures keep their grid footprints (fixed occluders) but are drawn by the vegetation system
  const realTerrain = meshes && canBuildRealTerrain(opts.renderer);
  // 1. base terrain + features
  grid.terrain.fill(terrainCode(mission.baseTerrain || 'ground'));
  for (const t of mission.terrain || []) applyTerrainFeature(grid, t);
  // 1b. step 3p road network: roads / pavements → grid codes; one spatial index for surface / raise queries
  const roadNet = normalizeRoadNetwork(mission);
  paintRoadGrid(grid, roadNet, terrainCode);
  const roads = new RoadIndex(roadNet, grid.width, grid.depth);
  world.roads = roads;

  // 2. build every structure (meshes + footprints)
  // explosive fuel drums (`barrels` + explosive:'barrel') are dynamic Barrel entities (§3.4 carry, §3.6 barrel
  // class), not static props: no footprint (they can be carried away), spawned in step 4
  const ctx = { theater, grid, world, missionId: mission.id };
  const first = (mission.structures || []).map((s) => (isExplosiveBarrel(s) ? null : buildStructure(s, ctx)));
  // terrain of every structure first (rivers, lakes): the placement rules keep scenery out of the water
  first.forEach((r, k) => { if (r) for (const fp of r.footprints) applyFootprint(grid, fp, 'terrain', STRUCTURE_OWNER_BASE + k); });
  applyShoreShallows(grid, mission.shoreShallowWidth);
  // 2b. placement rules (world/placement.js): runs cut at solids, towers off fence lines, scenery out of solids
  const placement = placeStructures(mission, first, { grid, meshes, realTerrain });
  if (placement.log.length && meshes) console.info(`[placement] ${mission.id}:\n  ${placement.log.join("\n  ")}`);
  world.placement = placement;
  mission = { ...mission, structures: placement.structures, items: placement.items, interactables: placement.interactables };
  const built = [], drums = [];
  mission.structures.forEach((s, k) => {
    if (isExplosiveBarrel(s)) { drums.push({ def: s, owner: STRUCTURE_OWNER_BASE + k }); return; }
    if (s.placementDropped) { first[k]?.library?.dispose(); return; }
    let r = first[k];
    if (placement.changed.has(k)) { r.library?.dispose(); r = buildStructure(s, ctx); }
    built.push({ def: s, type: s.type, owner: STRUCTURE_OWNER_BASE + k, ...r });
  });
  // 3. grid passes: terrain (above) → shore rim (above) → bridges → blocks → raised surfaces
  for (const pass of ['bridge', 'block']) {
    for (const b of built) for (const fp of b.footprints) applyFootprint(grid, fp, pass, b.owner);
  }
  // raised decks stand where the visual's floor really is (the fitted asset's planks sit a few cm off deckY)
  if (meshes) for (const b of built) if (b.type === 'watchtower' && b.object3d) b.deckSurfaceY = deckSurface(b);
  // step 3p street furniture: posts block their nav cell (movement only, sight passes: B.FENCE), the Morris column is solid
  const furn = expandFurniture(roadNet);
  for (const it of furn.items) {
    const r = it.block === false ? 0 : (typeof it.block === 'number' ? it.block : FURNITURE_BLOCK[it.kind] ?? 0);
    if (r > 0 && it.x != null) grid.fillCircle(it.x, it.z, Math.max(0.3, r), 'block', it.kind === 'morris_column' ? B.HIGH : B.FENCE);
  }
  applyElevation(grid, built);
  // building-library sidecars (browser): walkable roofs, ladders, climb edges where the mission does not override
  const libLog = buildingLog();
  const libNav = applyLibraryNav(grid, built, mission, snapToSurface);
  if (libNav.roofs || libNav.ladders || libNav.climbs) libLog.push(`nav: ${libNav.roofs} roofs, ${libNav.ladders} ladders, ${libNav.climbs} climb edges (${libNav.structures.join(', ')})`);
  // measured decks (placement rule e): walking level from the visual; railings / parapets / lamp posts / end blocks
  // over the deck cells are nav-only blocks
  const decks = libraryDecks(built.filter((b) => b.library), meshes ? { measure: (b, poly, rot, top) => deckField(b.object3d, poly, rot, top + 2.5, { pad: 1.5 }) } : {});
  for (const d of decks) {
    if (!d.measured) continue;
    const cells = [];
    const [x0, z0, x1, z1] = [Math.min(...d.poly.map((p) => p[0])), Math.min(...d.poly.map((p) => p[1])), Math.max(...d.poly.map((p) => p[0])), Math.max(...d.poly.map((p) => p[1]))];
    const c0 = grid.worldToCell(x0 - 1.5, z0 - 1.5), c1 = grid.worldToCell(x1 + 1.5, z1 + 1.5);
    for (let j = Math.max(0, c0.j); j <= Math.min(grid.rows - 1, c1.j); j++) for (let i = Math.max(0, c0.i); i <= Math.min(grid.cols - 1, c1.i); i++) {
      const p = grid.cellCenter(i, j), k = grid.idx(i, j);
      if (grid.bridge[k] && d.parapet(p.x, p.z)) cells.push(k);
    }
    if (cells.length) grid.navStamp(`deck:${d.owner}`, cells);
    if (cells.length) libLog.push(`deck ${d.id}: ${cells.length} railing/parapet cells blocked`);
  }
  grid.version++;

  // 4. meshes + interactables
  const propsRoot = new THREE.Group();
  propsRoot.name = 'props';
  const structures = new Map();
  const interactables = [];
  const addIt = (it) => { world.add(it); interactables.push(it); return it; };
  for (const b of built) {
    let ownedByEntity = false;
    for (const spec of b.interactables || []) {
      const tagged = spec.interactKind === 'explosiveTarget' || spec.interactKind === 'door';
      // library doors/gates animate their own door nodes (map-library wireLibraryDoors): never hide the building
      const obj = tagged && !(spec.interactKind === 'door' && b.library) ? b.object3d : null;
      if (obj) ownedByEntity = true;
      const extra = spec.interactKind === 'explosiveTarget'
        ? { bombOnly: !!(b.def.bombOnly ?? spec.bombOnly), destroyedBy: b.def.destroyedBy ?? null, explosive: b.def.explosive ?? null, carriable: !!b.def.carriable }
        : {};
      const it = addIt(new Interactable({ ...spec, ...extra, structure: b.def, owner: b.owner, object3d: meshes ? obj : null, tag: tagged ? b.def.id ?? null : null }));
      if (spec.interactKind === 'door' && b.def.open) it.setOpen(true); // gates that start open (M3 gate_w)
    }
    // switches carried by a structure (e.g. M3 fence switch on the admin building)
    for (const sw of b.def.switches || []) {
      // `on` = the controlled fence is powered: `powers:true` maps the switch state straight onto
      // world.fencePower (ABILITIES' Interactable switch semantics; `targets` = the ids it controls)
      const targets = sw.targets ?? (sw.controls != null ? [].concat(sw.controls) : []);
      addIt(new Interactable({ interactKind: 'switch', x: sw.x, z: sw.z, id: sw.id, tag: sw.id, on: sw.on ?? true, powers: sw.powers ?? true, controls: sw.controls ?? null, targets, activation: sw.activation ?? 1.0, roles: sw.roles ?? null }));
    }
    if (!ownedByEntity && meshes && !(realTerrain && TREE_TYPES.includes(b.type))) propsRoot.add(b.object3d);
    structures.set(b.def.id ?? `${b.type}#${b.owner - STRUCTURE_OWNER_BASE}`, { type: b.type, def: b.def, owner: b.owner, object3d: b.object3d, footprints: b.footprints });
  }
  for (const d of drums) {
    const s = d.def;
    const barrel = addIt(createInteractable({
      interactKind: 'barrel', id: s.id ?? null, x: s.x, z: s.z, variant: s.variant ?? null, hp: s.hp ?? 1,
      carriable: s.carriable !== false, explosive: 'barrel', structure: s, owner: d.owner,
    }, { meshes }));
    structures.set(s.id ?? `barrels#${d.owner - STRUCTURE_OWNER_BASE}`, { type: s.type, def: s, owner: d.owner, object3d: barrel.object3d, footprints: [], entity: barrel });
  }
  for (const it of mission.items || []) {
    // §3.4 a uniform declared as a clothesline item is the clothesline device (use, 1.5 s, dressed at once),
    // never a generic Hand pickup
    if (it.itemId === 'uniform' && it.variant === 'clothesline') {
      addIt(createInteractable({ interactKind: 'clothesline', id: it.id ?? null, x: it.x, z: it.z }, { meshes }));
      continue;
    }
    const p = createPickup(it.itemId, it.x, it.z, it.count ?? 1);
    if (it.id) p.tag = it.id;
    if (it.variant) p.params.variant = it.variant;
    addIt(p);
  }
  const ex = mission.extraction;
  if (ex && ex.r != null) {
    const e = addIt(createExtraction(ex.x, ex.z, ex.r));
    if (!world.extraction) world.extraction = e;
  }

  // 5. off-grid pathfinding links (§7.3 climbLinks / ladders → NavGrid.addLink, §10.2); ends snapped
  const links = addMissionLinks(grid, mission, { snap: true, records: true });
  world.ladders = links.filter((l) => l.kind === LINK.LADDER).map((l) => ({ id: l.def.id ?? `ladder${l.link.id}`, linkId: l.link.id, raised: !!l.def.raised, x: l.link.a.x, z: l.link.a.z, top: l.link.b, def: l.def }));
  world.structureDoors = libraryDoorPoints(built, libLog); // hideout doors at the assets' main doors
  // 5b. ABILITIES interactables: mission.interactables[], enterable-building doors, raised ladders (lowered
  // from the top, driven by world.ladders), fence power
  interactables.push(...spawnMissionInteractables(world, mission, { meshes }));

  // 5c. placement rule (e): what the visuals occupy outside their gameplay footprints blocks walking (browser)
  let visNavOff = null, deckLanes = null;
  if (meshes) {
    const vn = stampVisualNav(world, built);
    visNavOff = vn.off; deckLanes = vn.lanes;
    if (vn.cells) libLog.push(`visual nav: ${vn.cells} cells blocked (${vn.structures} structures)`);
    const fl = stampFlatBase(world, built, interactables);
    if (fl) libLog.push(`levelled: ${fl} cells under prop bases`);
    const ov = stampOverhead(world, built);
    if (ov.off) { const a = visNavOff; visNavOff = () => { a?.(); ov.off(); }; }
    if (ov.cells) libLog.push(`overhead: ${ov.cells} cells (${ov.structures} structures)`);
  }

  // 6. mission registries (consumed by AI alarm/brain, abilities, objectives)
  registerMission(world, mission, structures);
  // 6b. set-piece mechanics + data triggers + alarm-fail scripts (M4-M20, src/missions/setpieces.js)
  world.structures = structures;
  installSetpieces(world, mission, { meshes });

  // 7. ground + water from the finished grid
  let terrain = null, unwire = null, pavedGroundY = null, wire = null;
  if (meshes) {
    // point trees only: a forest AREA (tree type + `points`, e.g. M4/M20 'forest' footprints) has no x/z of its own
    const trees = realTerrain ? built.filter((b) => TREE_TYPES.includes(b.type) && Number.isFinite(b.def?.x) && Number.isFinite(b.def?.z)).map((b) => b.def) : [];
    // real terrain: the water system (src/art/water) owns the surface → buildTerrain returns water: null
    // placeholder ground takes the mission's `groundPalette` (e.g. 'frost', M18 §2.4); real terrain keeps the theater
    terrain = buildTerrain(grid, realTerrain ? theater : (mission.groundPalette || theater), realTerrain ? { renderer: opts.renderer, mission, trees, ownWater: true, roads } : {});
    world.scene?.add(terrain.ground);
    if (terrain.water) world.scene?.add(terrain.water);
    wire = buildMissionWire(propsRoot, { terrain, theater, mission, world, renderer: opts.renderer, material: dressingMaterial, night: theater === 'night' || !!mission.lighting?.night });
    world.scene?.add(propsRoot);
    if (realTerrain) {
      // top-facing snow on props (shared uniform: cached materials reused by a later non-snow mission get 0)
      const snowAmt = theater === 'snow' ? 1 : (mission.lighting?.snow ?? 0);
      if (snowAmt > 0) coverPropsWithSnow(propsRoot, snowAmt); else setPropSnow(0);
      world.groundY = terrain.groundY; // entity meshes follow the undulating ground (Entity.syncTransform)
      // step 3p: sidewalks, raised quays and platforms lift the walkers standing on them
      if (roadNet.roads.some((r) => r.kerb) || roadNet.areas.some((a) => a.raise > 0 || a.kerb)) {
        const baseY = terrain.groundY;
        pavedGroundY = (x, z) => baseY(x, z) + roads.raiseAt(x, z);
        world.groundY = pavedGroundY;
      }
      unwire = wireTrailRecords(world.events, terrain);
    }
  }
  world.terrain = terrain;
  world.structures = structures;
  // library buildings: repeats → instanced batches, bridge decks → visual ground height, piers → water obstacles
  const libBuilt = built.filter((b) => b.library);
  const batches = meshes ? batchLibraryRepeats(libBuilt, propsRoot, libLog) : [];
  // placement rule (e): feet stand on the low surfaces of the visuals (steps, ramps, porch boards, snow skirts)
  const SURF_CELL = 0.2, surf = meshes ? new Map() : null;
  if (surf) {
    for (const b of built) {
      if (!b.object3d || TREE_TYPES.includes(b.type) || LINEAR_PROPS.includes(b.type) || b.def.clip === false) continue;
      lowSurfaces(b.object3d, { maxY: 0.6, cell: SURF_CELL }, surf);
    }
    if (surf.size) libLog.push(`low surfaces: ${surf.size} samples`);
  }
  // deck landings: the way on / off a bridge or dam follows its abutment's top (up to 2 m on this flat ground)
  const laneSurf = meshes && deckLanes?.size ? new Map() : null;
  if (laneSurf) for (const b of built) {
    const cat = placeCat(b.def);
    if (b.object3d && (cat === 'bridge' || cat === 'pier')) lowSurfaces(b.object3d, { maxY: 2.0, cell: SURF_CELL, flat: 0.8 }, laneSurf);
  }
  let deckGroundY = null;
  if (decks.length || surf?.size || laneSurf?.size || world.surfaces?.length) {
    const base = world.groundY;
    deckGroundY = (x, z) => {
      for (const d of decks) { const h = d.heightAt(x, z); if (h != null && onBridgeCell(grid, x, z)) return h; }
      // movable walkable surfaces (a lowered drawbridge span): world.surfaces[i].heightAt → y or null
      for (const s of world.surfaces || []) { const h = s.heightAt(x, z); if (h != null && onBridgeCell(grid, x, z)) return h; }
      const g = typeof base === 'function' ? base.call(world, x, z) : 0;
      // the highest low surface under the feet (centre ± FOOT_R): a boot steps up onto a kerb, plinth or snow
      // skirt instead of pushing into its side while the body's centre is still below
      let sy;
      for (const [dx, dz] of FOOT_OFFS) {
        const px = x + dx, pz = z + dz, key = `${Math.floor(px / SURF_CELL)},${Math.floor(pz / SURF_CELL)}`;
        const onLane = laneSurf && deckLanes.has(grid.idx(Math.floor(px / grid.cell), Math.floor(pz / grid.cell)));
        const v = onLane && laneSurf.has(key) ? laneSurf.get(key) : surf?.size ? surf.get(key) : undefined;
        if (v !== undefined && (sy === undefined || v > sy)) sy = v;
      }
      return sy !== undefined && sy > g ? sy : g;
    };
    world.groundY = deckGroundY;
    // modelled plank / snow-cap height (deck_top is the bare structure): measured once the meshes are in
    if (meshes) {
      for (const d of decks) {
        const b = libBuilt.find((q) => q.library.object3d === d.root);
        let tries = 0;
        const cal = () => { if (!gone && !calibrateDeck(d, THREE) && ++tries < 6) setTimeout(cal, 1000); };
        Promise.resolve(b?.library.ready).then(cal, () => {});
      }
    }
  }
  // placement rule (e) bodies: standing visuals over any walking surface (after the deck-aware ground is known)
  if (meshes) {
    const t0 = performance.now(), st = stampStanding(world, wire?.standing ? [...built, wire.standing] : built);
    if (st.off) { const a = visNavOff; visNavOff = () => { a?.(); st.off(); }; }
    if (st.cells) libLog.push(`standing visuals: ${st.cells} quarter cells (${Math.round(performance.now() - t0)} ms)`);
  }
  world.waterObstacles = libraryWaterObstacles(libBuilt);
  const doors = wireLibraryDoors(world, libBuilt);
  world.buildingLog = libLog;
  if (libLog.length) console.info(`[map-builder] ${mission.id}: ${libBuilt.length} library buildings\n  ${libLog.join('\n  ')}`);
  const libReady = Promise.all([...libBuilt.map((b) => b.library.ready), ...batches]).then(() => undefined);
  // 8. water (real terrain only): built once the carved ground is ready — the bed capture renders it from above
  let water = null, fallbackWater = null, gone = false, windFx, life, lifeReady = false, pavement = null, furniture = null, streetLights = null;
  // 7b. step 3p pavement meshes on the finished (carved, flattened) ground: hard roads, sidewalks, kerbs, quays
  const buildPavementNow = () => {
    if (gone || !realTerrain || !terrain) return;
    try {
      const inner = terrain.terrain;
      pavement = buildPavement(roadNet, {
        heightAt: terrain.heightAt, theater, quality: terrain.quality,
        trail: inner?.trails?.rtDef ? { texture: inner.trails.rtDef.texture, width: grid.width, depth: grid.depth } : null,
        weather: mission.weather?.rain ? { wet: 0.85 } : null,
      });
      pavement.quality = terrain.quality;
      if (pavement.group.children.length) world.scene?.add(pavement.group);
    } catch (e) { console.error('[pavement] build failed', e); pavement = null; }
    try {
      const groundAt = (x, z) => (typeof world.groundY === 'function' ? world.groundY.call(world, x, z) : 0);
      const poles = [...structures.values()].filter((q) => q.type === 'telegraph_pole' && q.def.wireTo !== undefined);
      if (furn.items.length || poles.some((q) => q.def.wireTo)) {
        furniture = buildFurniture(furn, { groundAt, poles });
        world.scene?.add(furniture.group);
        if (theater === 'snow' || mission.lighting?.snow) coverPropsWithSnow(furniture.group, theater === 'snow' ? 1 : mission.lighting.snow);
        let night = false;
        try { night = !!resolveLighting(theater, mission.lighting)?.night; } catch { night = theater === 'night'; }
        streetLights = createStreetLights(world.scene, furniture.emitters, { night, preset: terrain.quality, groundAt });
      }
    } catch (e) { console.error('[furniture] build failed', e); furniture = null; }
  };
  const buildWaterNow = () => {
    if (gone || !realTerrain) return;
    try {
      water = buildWater(opts.renderer, world, grid, mission, theater, { module: WaterModule, terrain: terrain?.terrain?.mesh });
    } catch (e) {
      console.error('[water] build failed, using the flat placeholder', e);
      water = null;
      fallbackWater = buildMaskedWater(grid, theater);
      if (fallbackWater) world.scene?.add(fallbackWater);
    }
    world.water = water;
  };
  const handle = {
    propsRoot, terrain, structures, interactables, links,
    get water() { return water; },
    /** Resolves when the ground textures, grass, trees and water are built (placeholder / grid-only: at once). */
    ready: Promise.all([Promise.resolve(terrain?.ready).then(() => { if (!gone && meshes && terrain?.ground) stampTreeBranches(world, terrain.ground); }).then(buildPavementNow).then(buildWaterNow).then(() => water?.system.texturesReady), libReady]).then(() => { lifeReady = true; }),
    /** Per displayed frame: trails, grass/snow/tree animation, preset follow; water sim + reflections (before render). */
    frame(dt, camera) {
      terrain?.frame?.(dt, camera, world); water?.frame(dt, camera);
      if (pavement && pavement.quality !== terrain?.quality) { pavement.quality = terrain.quality; pavement.setQuality(terrain.quality); }
      streetLights?.frame(dt, camera); tickBuildings(dt, camera, world.wind ?? null); doors.frame(dt);
      if (windFx === undefined) windFx = opts.meshes === false ? null : createWindFx(world, realTerrain ? opts.renderer : null); // step 4w
      windFx?.frame(dt, camera); wire?.update(dt);
      // step 4f: fish under the water, gulls / crows / ducks (after the water's bed capture: never baked into it)
      if (life === undefined && lifeReady && !gone) life = opts.meshes === false || !realTerrain ? null : createAmbientLife(world, opts.renderer);
      life?.frame(dt, camera);
    },
    get windFx() { return windFx; },
    get wire() { return wire; },
    get pavement() { return pavement; },
    get furniture() { return furniture; },
    get streetLights() { return streetLights; },
    get life() { return life; },
    dispose() {
      gone = true;
      visNavOff?.();
      windFx?.dispose(); windFx = null;
      wire?.dispose(); wire = null;
      life?.dispose(); life = null;
      pavement?.dispose(); pavement = null;
      streetLights?.dispose(); streetLights = null;
      furniture?.dispose(); furniture = null;
      if (world.roads === roads) world.roads = null;
      if (water) { water.dispose(); water = null; if (world.water) world.water = null; }
      if (fallbackWater) { world.scene?.remove(fallbackWater); fallbackWater.geometry.dispose(); fallbackWater.material.dispose(); fallbackWater = null; }
      unwire?.();
      doors.dispose();
      for (const b of libBuilt) b.library.dispose(); // this map's library instances only (menu diorama vs mission)
      for (const b of batches) b.then?.((h) => h?.dispose());
      world.waterObstacles = null;
      if (world.groundY === terrain?.groundY || (deckGroundY && world.groundY === deckGroundY) || (pavedGroundY && world.groundY === pavedGroundY)) world.groundY = null;
      world.scene?.remove(propsRoot);
      if (terrain) { world.scene?.remove(terrain.ground); if (terrain.water) world.scene?.remove(terrain.water); terrain.dispose(); }
      propsRoot.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    },
  };
  return handle;
}

/**
 * Publish the §7.3 mission tables on the world:
 *  - `world.zones` (and `world.alarm.zones` when the alarm was built without them)
 *  - `world.barracks` Map id → {id, x, z, door, pool, alive, squads, jail}  (garrison release, §4.9)
 *  - `world.jails` [{id, x, z, door}]   (§4.10 capture: prisoners are walked to the door)
 *  - `world.triplines`, `world.markers` (demolition markers, e.g. M3 `dam_charge`)
 */
export function registerMission(world, mission, structures) {
  world.zones = mission.zones.map((z) => ({ ...z }));
  if (world.alarm && Array.isArray(world.alarm.zones) && !world.alarm.zones.length && world.zones.length) {
    world.alarm.zones = world.zones.map((z) => ({ onSeen: null, onHeard: null, ...z }));
  }
  const where = (id) => {
    const s = structures.get(id)?.def;
    return s ? { x: s.x ?? 0, z: s.z ?? 0, door: doorPoint(s) } : null;
  };
  world.jails = mission.jails.map((id) => ({ id, ...(where(id) || { x: 0, z: 0, door: null }) }));
  world.barracks = new Map(Object.entries(mission.barracks).map(([id, b]) => [id, {
    id, ...(where(id) || { x: 0, z: 0, door: null }), pool: b.pool, alive: b.pool,
    squads: b.squads.map((s) => ({ ...s, released: false })), jail: mission.jails.includes(id),
  }]));
  world.triplines = mission.triplines.map((t) => ({ ...t, fired: false }));
  world.markers = new Map((mission.markers || []).map((m) => [m.id, { ...m }]));
  // demolition markers (§7.6 M3 `dam_charge`): an explosiveTarget named by a marker (its structure def's
  // `marker`, or a destroy objective's `marker` over it) only falls to a bomb within the marker's `r`
  for (const it of world.interactables || []) {
    if (it.interactKind !== 'explosiveTarget' || it.marker) continue;
    const id = it.params?.structure?.id ?? it.tag;
    const obj = (mission.objectives || []).find((o) => o.marker && (o.targets || []).includes(id));
    const mk = it.params?.structure?.marker ?? obj?.marker ?? null;
    if (mk && world.markers.has(mk)) it.marker = mk;
  }
}

/**
 * Nearest walkable cell centre to (x, z) whose surface height matches `y` (±MAX_STEP-ish 0.6 m), within
 * `maxDist` m; the point itself when it already qualifies; null when none.
 */
export function snapToSurface(grid, x, z, y = 0, maxDist = 2.5) {
  const c = grid.cell, ci = Math.floor(x / c), cj = Math.floor(z / c);
  const ok = (i, j) => grid.inBounds(i, j) && grid.isWalkable(i, j) && Math.abs(grid.elev[grid.idx(i, j)] - y) <= 0.6;
  if (ok(ci, cj)) return { x, z };
  const R = Math.ceil(maxDist / c);
  let best = null, bd = Infinity;
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
    if (!ok(ci + di, cj + dj)) continue;
    const p = grid.cellCenter(ci + di, cj + dj), d = Math.hypot(p.x - x, p.z - z);
    if (d < bd && d <= maxDist) { bd = d; best = p; }
  }
  return best ? { x: best.x, z: best.z } : null;
}

/**
 * Feed a normalized mission's `climbLinks` (GB-only by default) and `ladders` (everyone; `raised`
 * ladders start disabled) into the grid as off-grid links. Link ids: climbLinks 1..n, ladders after.
 * @param {{snap?: boolean, records?: boolean}} [o] snap: move each endpoint onto the nearest walkable
 *   cell at its height (authoring tolerance: wall lines are rasterized); records: return
 *   [{kind, link, def}] instead of the count
 * @returns {number|{kind:string, link:object, def:object}[]} links added
 */
export function addMissionLinks(grid, mission, o = {}) {
  const out = [];
  const end = ([x, z, y]) => {
    const p = o.snap ? snapToSurface(grid, x, z, y ?? 0) || { x, z } : { x, z };
    return { x: p.x, z: p.z, y: y ?? 0 };
  };
  for (const l of mission.climbLinks || []) {
    const link = grid.addLink(LINK.CLIMB, end(l.a), end(l.b), { roles: l.roles ?? ['greenberet'] });
    out.push({ kind: LINK.CLIMB, link, def: l });
  }
  for (const l of mission.ladders || []) {
    const link = grid.addLink(LINK.LADDER, end([l.x, l.z, l.y ?? 0]), end(l.top), { roles: l.roles ?? null, enabled: !l.raised });
    out.push({ kind: LINK.LADDER, link, def: l });
  }
  return o.records ? out : out.length;
}

export default buildMap;
