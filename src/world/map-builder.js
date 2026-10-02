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
import { terrainCode, LINK, T, B, MAX_STEP } from './grid.js';
import { CONFIG } from '../config.js';
import { normalizeMission } from '../missions/schema.js';
import { buildProp, LINEAR_PROPS } from '../art/props.js';
import { edgeStructureRuns, edgeLineExtensions, edgeBuildingRows } from './edge-extend.js';
import { buildEdgeBuildings, edgeBuildingFlatLines } from '../art/edge-buildings.js';
import { extendPath } from './apron-field.js';
import { buildTerrain, canBuildRealTerrain, TREE_TYPES, coverPropsWithSnow, setPropSnow, wireTrailRecords, buildMaskedWater } from '../art/terrain.js';
import { buildWater, raisedWaterMasks } from '../art/water.js';
import { buildWalkDeck, WALK_SHIFT, dressingMaterial } from '../art/dressing.js';
import { buildDamStairs, stairTopAt } from '../art/dam-stairs.js';
import { createDamWater, hasDamWater, loadDamPoolTextures } from '../render/dam-water.js';
import { buildMissionWire } from '../art/wire-obstacles.js';
import * as WaterModule from '../art/water/index.js';
import { buildExtraProp, isExtraProp, isPlatformProp } from '../art/props-extra.js';
import { installSetpieces } from '../missions/setpieces.js';
import { Interactable, createInteractable, createPickup, createExtraction, spawnMissionInteractables } from '../entities/interactables.js';
import { tickBuildings, buildingLog, libraryHinted } from '../art/building-props.js';
import { wireFuelHooks } from '../art/fuel-hooks.js';
import { isFuelStructure } from '../art/fuel-tanks.js';
import { createWindFx } from '../render/wind-fx.js';
import { createAmbientLife } from '../render/ambient-life.js';
import { normalizeRoadNetwork, paintRoadGrid, RoadIndex, expandFurniture, FURNITURE_BLOCK, SURFACES } from './roads.js';
import { buildPavement } from '../art/pavement/index.js';
import { buildFurniture } from '../art/furniture/index.js';
import { createStreetLights } from '../render/street-lights.js';
import { resolveLighting } from '../engine/lighting.js';
import { createBuildingBatch } from '../art/building-library.js';
import { resolvePlacement, placeCat, RULES } from './placement.js';
import { convexHull } from './placement-geom.js';
import { gateLayout } from './breakables.js';
import { categoryOf } from '../debug/clip-rules.js';
import { setStaticSolids, removeStaticSolids, minAreaRect } from './body-clearance.js';
import { planHull, planCells, finestMeshes, measureTop, deckField, lowSurfaces, overheadCells, standingCells, dataKey } from './placement-visual.js';
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
  else if (t.type === 'path') grid.fillLine(t.points, t.widths ?? t.width ?? 3, 'terrain', code); // widths: per point
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
  // (a fuel deck block, M8, models its own grating deck: no plank deck over it, docs/fuel-tanks.md §5.2)
  if (s.walkways?.length && s.type !== 'cliff' && ctx.library !== false && !ctx.navOnly && r.object3d && !ownDeck(r.object3d)) {
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

/** Does a structure visual (library model) carry its own walkable deck (fuel tank farm grating)? */
function ownDeck(o) {
  let own = false;
  o.traverse((n) => { if (/^fuel_tank_farm/.test(n.userData?.libraryAsset || '')) own = true; });
  return own;
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
  const res = resolvePlacement(mission.structures || [], { shapeOf, isFree, vehicles: mission.vehicles, terrain: mission.terrain, items: mission.items, interactables: mission.interactables,
    links: { climbLinks: mission.climbLinks, ladders: mission.ladders } });
  const changed = new Set();
  res.structures.forEach((d, k) => {
    const o = (mission.structures || [])[k];
    if (d.visualRuns || d.visualWalkways || d.x !== o.x || d.z !== o.z) changed.add(k);
  });
  return { ...res, changed };
}

/**
 * Walk-only footprints (`navOnly: true`, e.g. a stair's open hand rail): their cells are nav blocks (grid.navStamp)
 * that stop walkers and vehicles but neither sight nor cover nor the physics statics.
 */
export function stampNavFootprints(world, built) {
  const grid = world.grid;
  let scratch = null;
  for (const b of built) {
    const fps = (b.footprints || []).filter((f) => f.navOnly);
    if (!fps.length) continue;
    scratch ||= new grid.constructor(grid.width, grid.depth, grid.cell);
    scratch.block.fill(0);
    for (const fp of fps) applyFootprint(scratch, { ...fp, block: B.HIGH }, 'block', 0);
    const cells = [];
    for (let k = 0; k < grid.size; k++) if (scratch.block[k] && !grid.elev[k]) cells.push(k);
    grid.navStamp(`navfp:${b.owner}`, cells);
  }
}

/**
 * Boom barrier in a wider wall opening (mission gate def `gap: [lo, hi]`, local metres along the gate line): nav-only
 * blocks (grid.navStamp, never cleared by raising the boom, no physics statics) over the pivot side (S gate post, pivot
 * post, counterweight), the fork rest post and the far gate post. The rest of [w/2, hi] is the pedestrian footway.
 */
export function stampBarrierGaps(world, built) {
  const grid = world.grid, c = grid.cell;
  for (const b of built) {
    const d = b.def;
    if (b.type !== 'gate' || !Array.isArray(d.gap)) continue;
    const w = d.w ?? 4, rot = d.rot ?? 0, tx = Math.cos(rot), tz = Math.sin(rot), cells = new Set();
    // the fork rest and the far post keep the body clearance (placement rule e, RULES.bodyNav) on the footway's side:
    // a walker's swinging arm passes them instead of brushing them (clip-2, M2 seed 11)
    const fw = gateLayout(d)?.footway, m = RULES.bodyNav;
    const rest = Math.max(w / 2 + 0.3, fw ? fw[0] + m : 0), far = Math.min(d.gap[1] - 0.32, fw ? fw[1] - m : Infinity);
    const rects = [[d.gap[0] - 0.1, -w / 2, 0.55], [w / 2 + 0.02, rest, 0.2 + (fw ? m : 0)], [far, d.gap[1] + 0.1, 0.55]];
    for (const [u0, u1, hv] of rects) {
      const R = Math.max(Math.abs(u0), Math.abs(u1)) + hv + c;
      const i0 = Math.max(0, Math.floor((d.x - R) / c)), i1 = Math.min(grid.cols - 1, Math.floor((d.x + R) / c));
      const j0 = Math.max(0, Math.floor((d.z - R) / c)), j1 = Math.min(grid.rows - 1, Math.floor((d.z + R) / c));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) * c - d.x, pz = (j + 0.5) * c - d.z, u = px * tx + pz * tz, v = -px * tz + pz * tx;
        if (u >= u0 && u <= u1 && Math.abs(v) <= hv) cells.add(j * grid.cols + i);
      }
    }
    grid.navStamp(`barrier:${b.owner}`, [...cells]);
  }
}

/**
 * Rule (e) body clearance (m): a cell is blocked when a visual comes this close to its centre, so a walker on the
 * nearest free cell centre keeps its shoulders and boots out of the post, curb or log end beside it (decks too:
 * their ends keep their way on through keepDeckAccess).
 */
export const VIS_NAV_MARGIN = RULES.bodyNav;

/** Placement categories whose visuals block walking beyond their footprints (rule e). */
const VIS_NAV_CATS = new Set(['building', 'tower', 'tent', 'ruins', 'prop', 'rocks', 'rocks_big', 'vehicle', 'emplacement', 'pole', 'sandbags', 'cliff']);

/**
 * Rule (e) nav clearance vs meshes: every cell whose centre lies under (or within VIS_NAV_MARGIN of) a
 * structure's visual at body height (0.3–1.8 m, enclosed interiors filled) and is still walkable ground becomes a
 * nav-only block (grid.navBlock: sight and cover unchanged). Door approaches, link / ladder ends keep a 0.9 m free disc. Cleared when the
 * structure is destroyed.
 * @returns {{cells: number, structures: number}}
 */
/** The mission's points whose ways the nav stamps keep open: spawns, posts, pickups, devices, exits. @returns {number[][]} */
/** Both ends of every stair / ramp on the grid (grid.addRamp: top a, foot b), [x, z] each. */
export const rampEnds = (grid) => (grid.ramps || []).flatMap((r) => [[r.ax, r.az], [r.bx, r.bz]]);

export function missionWayPoints(mission, interactables = []) {
  const out = [];
  const add = (x, z) => { if (Number.isFinite(x) && Number.isFinite(z)) out.push([x, z]); };
  for (const u of [...(mission.commandos || []), ...(mission.enemies || [])]) if (!u.vehicle && !u.elevated) add(u.x, u.z);
  for (const it of [...(mission.items || []), ...interactables]) add(it.x, it.z);
  for (const z of [mission.extraction, mission.rendezvous]) if (z) add(z.x, z.z);
  return out;
}

/** Keep radius (m) around a climb / ladder end: its own cell stays open, the wall beside it still blocks. */
const LINK_KEEP_R = 0.4;
/** Keep radius (m) around a real door's approach point (its cell; the steps beside it keep their clearance). */
const DOOR_KEEP_R = 0.5;
/**
 * Points the visual nav rules keep open: door approaches, garrison doors (a 0.9 m disc), climb / ladder ends
 * (LINK_KEEP_R). @returns {number[][]} [x, z, r?]
 */
export function navKeepPoints(world, built) {
  const keep = [];
  // the assets' real doors: their approach cell (the way out of it is kept by keepWays); a layout's guessed door
  // side keeps the 0.9 m doorway disc
  for (const [, p] of world.structureDoors || []) keep.push([p[0], p[1], DOOR_KEEP_R]);
  for (const b of built) {
    for (const d of b.library?.doors || []) if (d.approach) keep.push([d.approach.x, d.approach.z, DOOR_KEEP_R]);
    // (the asset's real door when there is one: structureDoors above; else the layout's door side)
    if ((b.def.enterable || b.def.garrison) && !world.structureDoors?.has?.(b.def.id)) { const p = doorPoint(b.def); keep.push([p.x, p.z]); }
  }
  // link ends: the end's own spot (the climber's / ladder user's body), not the 0.9 m doorway disc
  for (const l of world.grid.links || []) { keep.push([l.a.x, l.a.z, LINK_KEEP_R]); keep.push([l.b.x, l.b.z, LINK_KEEP_R]); }
  return keep;
}

/** Head room (m) a walker needs under eaves, porch roofs and lintels (a standing figure is ~1.8 m). */
export const HEAD_ROOM = 1.9;

/**
 * Rule (e) head room: open cells under an overhang (grid.overLo: eaves, porch roofs, a tower cabin) lower than
 * HEAD_ROOM above the walking surface there (terrain + steps / skirts: world.groundY) are nav-blocked, so a walker
 * does not stand with his head in the roof. The cells holding a door approach or a link end stay open. Recomputed
 * when a structure is destroyed (its overhang goes).
 * @returns {{cells: number, off: Function|null}}
 */
export function stampHeadroom(world, built) {
  const grid = world.grid;
  if (!grid.overLo) return { cells: 0, off: null };
  const keep = new Set(navKeepPoints(world, built).map(([x, z]) => { const c = grid.worldToCell(x, z); return grid.inBounds(c.i, c.j) ? grid.idx(c.i, c.j) : -1; }));
  const stamp = () => {
    const gy = typeof world.groundY === 'function' ? world.groundY : null, out = new Set();
    for (let k = 0; k < grid.overLo.length; k++) {
      const lo = grid.overLo[k];
      if (lo === Infinity || keep.has(k) || grid.block[k] !== B.NONE) continue;
      const i = k % grid.cols, j = (k / grid.cols) | 0, c = grid.cellCenter(i, j);
      const y = Math.max(grid.elev[k], gy ? gy.call(world, c.x, c.z) : 0);
      if (lo - y < HEAD_ROOM) out.add(k);
    }
    grid.navStamp('headroom', out);
    return out.size;
  };
  const cells = stamp();
  const off = world.events?.on?.('structure:destroyed', () => stamp());
  return { cells, off: typeof off === 'function' ? off : null };
}

export function stampVisualNav(world, built, points = []) {
  const grid = world.grid, keep = navKeepPoints(world, built), lanes = new Set();
  // (a stair's graded run and the step onto it at either end stay open: its hand rails are walk-only footprints)
  const free = (x, z) => keep.some(([kx, kz, r = 0.9]) => Math.hypot(kx - x, kz - z) < r) || !!(grid.ramps && grid.nearRamp(x, z, 0.3));
  let cells = 0, n = 0;
  // the ways to keep: walkable pieces before the stamps, and the points they join
  const labels0 = walkPieces(grid), stamps = [];
  // (door approaches of the assets' real doors and link ends; a layout's guessed door side is no way point)
  const realDoors = [...(world.structureDoors?.values?.() || [])];
  for (const b of built) for (const d of b.library?.doors || []) if (d.approach) realDoors.push([d.approach.x, d.approach.z]);
  // (a stair's ends too: its foot must not be closed off by the rails and stringers beside it)
  const linkEnds = [...(grid.links || []).flatMap((l) => [[l.a.x, l.a.z], [l.b.x, l.b.z]]), ...rampEnds(grid)];
  const ways = [...realDoors, ...linkEnds, ...points].map(([x, z]) => { const c = grid.worldToCell(x, z); return [c.i, c.j]; });
  for (const b of built) {
    if (!b.object3d || TREE_TYPES.includes(b.type) || b.def.clip === false) continue;
    const cat = placeCat(b.def), deck = cat === 'bridge' || cat === 'pier';
    // walls: what the dressing adds around the nav line (end caps, buttresses, plank roofs, walk posts)
    if (LINEAR_PROPS.includes(b.type) && cat !== 'wall') continue;
    if (!VIS_NAV_CATS.has(cat) && !deck && cat !== 'wall') continue;
    // bridges / dams / piers: their walkable deck is nav already; what stands OFF the deck at body height (a
    // dam's arch, a parapet's end on the bank, a lift bridge's counterweight) blocks like any visual. Each deck end
    // (a cluster of landings: deck cells next to dry land) keeps its way on: when the stamp would close every
    // landing of an end, that end's lanes (1.5 m straight out of each landing) stay free.
    const pairs = [];
    if (deck) {
      const D = b.def, R = Math.ceil(2 * Math.max(D.w ?? 0, D.d ?? 0) / grid.cell) + 8, ci = grid.worldToCell(D.x ?? 0, D.z ?? 0);
      for (let j = Math.max(0, ci.j - R); j <= Math.min(grid.rows - 1, ci.j + R); j++) for (let i = Math.max(0, ci.i - R); i <= Math.min(grid.cols - 1, ci.i + R); i++) {
        if (!grid.bridge[grid.idx(i, j)]) continue;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (!grid.inBounds(ii, jj)) continue;
          const kk = grid.idx(ii, jj);
          // a landing is where the deck meets dry land (a shallow toe ledge along a dam's face is no way on)
          if (grid.bridge[kk] || grid.block[kk] !== B.NONE || grid.terrain[kk] === T.WATER || grid.terrain[kk] === T.SHALLOW) continue;
          const lane = [];
          for (let t = 1; t <= 3; t++) if (grid.inBounds(i + di * t, j + dj * t)) lane.push(grid.idx(i + di * t, j + dj * t));
          pairs.push({ i, j, lane });
          for (const k of lane) lanes.add(k);
        }
      }
    }
    const rects = planCells(b.object3d, { minY: 0.3, maxY: 1.8, cell: 0.25, close: deck || cat === 'wall' ? 0 : 3 });
    if (!rects) continue;
    // low parts (0.12–0.3 m: a ramp's side, a step's face, a plinth, a kerb): the ground beside them keeps the body
    // clearance too (a boot at the end of a stride would kick their face), but not their own tops (walked on)
    const lowRects = planCells(b.object3d, { minY: 0.12, maxY: 0.3, cell: 0.25, close: 0 }) || [];
    const tops = lowRects.length ? lowSurfaces(b.object3d, { maxY: 0.6, cell: 0.25, flat: 0.8 }) : null;
    const onTop = (x, z) => (tops.get(`${Math.floor(x / 0.25)},${Math.floor(z / 0.25)}`) ?? 0) >= 0.08;
    const deckTops = deck ? lowSurfaces(b.object3d, { maxY: 2.5, cell: 0.25, flat: 0.8 }) : null;
    const lowAt = (m) => {
      const out = new Set();
      for (const r of lowRects) {
        const x0 = r[0][0] - m, z0 = r[0][1] - m, x1 = r[2][0] + m, z1 = r[2][1] + m;
        const c0 = grid.worldToCell(x0, z0), c1 = grid.worldToCell(x1, z1);
        for (let j = Math.max(0, c0.j); j <= Math.min(grid.rows - 1, c1.j); j++) for (let i = Math.max(0, c0.i); i <= Math.min(grid.cols - 1, c1.i); i++) {
          const c = grid.cellCenter(i, j), k = grid.idx(i, j);
          if (c.x < x0 || c.x > x1 || c.z < z0 || c.z > z1) continue;
          // (not in a wade: a boot under the water line kicks no step face anyone sees — the M3 toe ledge stays open)
          if (grid.block[k] !== B.NONE || grid.bridge[k] || grid.elev[k] > 0 || grid.terrain[k] === T.WATER || grid.terrain[k] === T.SHALLOW || free(c.x, c.z) || onTop(c.x, c.z)) continue;
          out.add(k);
        }
      }
      return out;
    };
    const stampAt = (m, withCover = true) => {
      const out = new Set();
      for (const r of rects) {
        const x0 = r[0][0] - m, z0 = r[0][1] - m, x1 = r[2][0] + m, z1 = r[2][1] + m;
        const c0 = grid.worldToCell(x0, z0), c1 = grid.worldToCell(x1, z1);
        for (let j = Math.max(0, c0.j); j <= Math.min(grid.rows - 1, c1.j); j++) for (let i = Math.max(0, c0.i); i <= Math.min(grid.cols - 1, c1.i); i++) {
          const c = grid.cellCenter(i, j), k = grid.idx(i, j);
          if (c.x < x0 || c.x > x1 || c.z < z0 || c.z > z1) continue;
          if (grid.block[k] !== B.NONE || grid.bridge[k] || grid.elev[k] > 0 || grid.terrain[k] === T.WATER || free(c.x, c.z)) continue;
          out.add(k);
        }
      }
      // piers (dead ends into the water): swimmers keep the body clearance off the deck edge and the piles too (what
      // stands at the waterline, -0.6..0.6 m); a bridge's piles are left alone (the channel under it stays open)
      if (cat === 'pier') {
        const mw = m + 0.4; // a swimmer lies along his heading: his head and fins reach further than a walker's boots
        for (const r of planCells(b.object3d, { minY: -0.6, maxY: 0.6, cell: 0.25, close: 0 }) || []) {
          const x0 = r[0][0] - mw, z0 = r[0][1] - mw, x1 = r[2][0] + mw, z1 = r[2][1] + mw;
          const c0 = grid.worldToCell(x0, z0), c1 = grid.worldToCell(x1, z1);
          for (let j = Math.max(0, c0.j); j <= Math.min(grid.rows - 1, c1.j); j++) for (let i = Math.max(0, c0.i); i <= Math.min(grid.cols - 1, c1.i); i++) {
            const c = grid.cellCenter(i, j), k = grid.idx(i, j);
            if (c.x < x0 || c.x > x1 || c.z < z0 || c.z > z1) continue;
            if (grid.block[k] === B.NONE && !grid.bridge[k] && (grid.terrain[k] === T.WATER || grid.terrain[k] === T.SHALLOW) && !free(c.x, c.z)) out.add(k);
          }
        }
      }
      if (pairs.length) keepDeckAccess(pairs, out);
      // on a deck at ground level (a dam crest, a low bridge): parapets, lamp posts and end blocks standing over deck
      // cells (0.6-1.8 m: the deck surface itself is below) block the cells whose centre they cover, as long as the
      // deck still joins all its ends
      if (withCover && deck && pairs.length) for (const k of deckCover(grid, b.object3d, pairs, out, free, m)) out.add(k);
      // …and its open edges: a deck cell whose surface drops more than a step within the body clearance (a boot
      // over the edge of a pier on the bank, of a raised crest) — not its landings, flush with the ground
      if (withCover && deckTops) for (const k of deckEdges(grid, b.owner, deckTops, m, free, typeof world.groundY === 'function' ? (x, z) => world.groundY(x, z) : null)) out.add(k);
      return out;
    };
    // a deck keeps its way across (end to end over the deck and dry ground) and its ends: the full body clearance
    // where there is room, else half of it, else only what stands right there, else none
    const before = deck && pairs.length ? deckCrossing(grid, b.def, pairs, null) : null;
    const levels = [];
    for (const [m, cover] of [[VIS_NAV_MARGIN, true], [VIS_NAV_MARGIN / 2, true], [0, true], [VIS_NAV_MARGIN, false], [VIS_NAV_MARGIN / 2, false], [0, false]]) {
      if (!deck && !cover) break;
      if (levels.length && !cover) break; // (covers found: done)
      const o = stampAt(m, cover);
      if (before && !deckCrossingKept(before, deckCrossing(grid, b.def, pairs, o))) continue;
      levels.push(o);
    }
    // (a deck's way points: the landing nearest its axis at each end, the way on; side landings are no way)
    if (deck && pairs.length) for (const p of deckEndPoints(grid, b.def, pairs)) ways.push([p.i, p.j]);
    if (lowRects.length) {
      // (soft: the first to give way when a way is cut, down to none)
      const low = [lowAt(VIS_NAV_MARGIN), lowAt(VIS_NAV_MARGIN / 2), new Set()].filter((o, q, all) => q === all.length - 1 || o.size);
      if (low[0].size && (!before || deckCrossingKept(before, deckCrossing(grid, b.def, pairs, new Set([...low[0], ...(levels[0] || [])]))))) {
        const key = `low:${b.owner}`;
        stamps.push({ key, levels: low, soft: true });
        grid.navStamp(key, low[0]);
        cells += low[0].size;
      }
    }
    if (!levels.length || !levels[0].size) continue;
    const key = `vis:${b.owner}`;
    stamps.push({ key, levels: [...levels, new Set()] }); // (none: the last resort when what stands there cuts a way)
    grid.navStamp(key, levels[0]);
    cells += levels[0].size; n++;
  }
  // …and every way that was open between the mission's points (spawns, posts, pickups, devices, exits, doors, link
  // ends, deck landings) stays open: stamps around a cut are relaxed (half margin, then what stands right there, then
  // none) until it is open again
  const relaxed = keepWays(grid, labels0, ways, stamps);
  if (relaxed) cells = stamps.reduce((a, st) => a + stampCells(st).size, 0);
  const relaxedN = stamps.filter((st) => st.lv?.size && !st.soft).length;
  const off = world.events?.on?.('structure:destroyed', (e) => { if (e?.owner != null) { grid.navStamp(`vis:${e.owner}`, []); grid.navStamp(`low:${e.owner}`, []); } });
  return { cells, structures: n, lanes, relaxed: relaxedN, off: typeof off === 'function' ? off : null };
}

/** Walkable pieces of the grid for a walker (4-connected = 8-connected without corner cutting): label per cell, 0 = closed. */
export function walkPieces(grid) {
  const lab = new Int32Array(grid.cols * grid.rows);
  let n = 0;
  for (let j0 = 0; j0 < grid.rows; j0++) for (let i0 = 0; i0 < grid.cols; i0++) {
    const k0 = j0 * grid.cols + i0;
    if (lab[k0] || !grid.isWalkable(i0, j0)) continue;
    const id = ++n, st = [k0];
    lab[k0] = id;
    while (st.length) {
      const k = st.pop(), i = k % grid.cols, j = (k / grid.cols) | 0;
      if (i > 0 && !lab[k - 1] && grid.isWalkable(i - 1, j)) { lab[k - 1] = id; st.push(k - 1); }
      if (i < grid.cols - 1 && !lab[k + 1] && grid.isWalkable(i + 1, j)) { lab[k + 1] = id; st.push(k + 1); }
      if (j > 0 && !lab[k - grid.cols] && grid.isWalkable(i, j - 1)) { lab[k - grid.cols] = id; st.push(k - grid.cols); }
      if (j < grid.rows - 1 && !lab[k + grid.cols] && grid.isWalkable(i, j + 1)) { lab[k + grid.cols] = id; st.push(k + grid.cols); }
    }
  }
  return lab;
}

/**
 * Rule (e) ways: points ([i, j] cells) that were in one walkable piece (labels0) and are still open must still be in
 * one piece after the stamps. Where a way was cut, the stamps' cells within 1 m of the cut-off piece (the smaller
 * side) step down a level (stamps[].levels: nested cell sets from the full margin down to none; `soft` ones, low parts,
 * first) and the check runs again: gameplay ways come before clearance, only where they need it.
 * @returns {number} stamp steps taken
 */
/** A keepWays stamp's cells now: each cell of its first level while it is still in the level it stepped down to. */
export function stampCells(st) {
  const out = new Set();
  for (const k of st.levels[0]) { const l = st.lv?.get(k) ?? 0; if (st.levels[l].has(k)) out.add(k); }
  return out;
}

export function keepWays(grid, labels0, ways, stamps) {
  let steps = 0;
  for (let round = 0; round < 16; round++) {
    const lab = walkPieces(grid), rep = new Map(), cut = [];
    for (const [i, j] of ways) {
      if (!grid.inBounds(i, j)) continue;
      const k = grid.idx(i, j), a = labels0[k], b = lab[k];
      if (!a || !b) continue;
      if (!rep.has(a)) rep.set(a, { b, i, j });
      else if (rep.get(a).b !== b) cut.push([rep.get(a), { i, j }]);
    }
    if (!cut.length) return steps;
    // the stamps give way where they make the cut: their cells with both sides of a cut within 1.5 m (else, for a
    // wider barrier, those within 1 m of the cut-off piece, the smaller side) step down a level; the rest of each
    // stamp keeps its clearance
    const size = new Map();
    for (const v of lab) if (v) size.set(v, (size.get(v) || 0) + 1);
    const sides = cut.map(([p, q]) => [lab[grid.idx(p.i, p.j)], lab[grid.idx(q.i, q.j)]]);
    const pocket = new Set(sides.map(([a, b]) => (size.get(a) <= size.get(b) ? a : b)));
    const near = (k, R, test) => {
      const i = k % grid.cols, j = (k / grid.cols) | 0, seen = new Set();
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) if (grid.inBounds(i + di, j + dj)) { const v = lab[grid.idx(i + di, j + dj)]; if (v) seen.add(v); }
      return test(seen);
    };
    const between = (k) => near(k, 3, (seen) => sides.some(([a, b]) => seen.has(a) && seen.has(b)));
    const rim = (k) => near(k, 2, (seen) => [...seen].some((v) => pocket.has(v)));
    let hems = between;
    if (!stamps.some((st) => [...stampCells(st)].some((k) => grid.terrain[k] !== T.WATER && between(k)))) hems = rim;
    let moved = 0;
    for (const soft of [true, false]) { // low parts give way first
      for (const st of stamps) {
        if (!!st.soft !== soft) continue;
        st.lv ??= new Map();
        const cur = stampCells(st), last = st.levels.length - 1;
        let changed = false;
        for (const k of cur) {
          const l = st.lv.get(k) ?? 0;
          if (l >= last || grid.terrain[k] === T.WATER || !hems(k)) continue; // (deep water: no walker's way)
          st.lv.set(k, l + 1); changed = true;
        }
        if (!changed) continue;
        grid.navStamp(st.key, stampCells(st));
        moved++; steps++;
      }
      if (moved) break;
    }
    if (!moved) return steps;
  }
  return steps;
}

/**
 * A deck's way across (stampVisualNav): its landings ({i, j} deck cells next to dry land) near each end of its long
 * axis (`def` x, z, rot, w: the outer 2 m), labelled by piece of deck + dry ground (4-connected, within 12 m of the
 * deck; wading along a dam's toe ledge or a ford does not count), with `extra` cells blocked on top of the grid's.
 * @returns {{a: number, b: number, linked: boolean}} open landings at each end, and whether the ends are joined
 */
export function deckCrossing(grid, def, pairs, extra = null) {
  const c = Math.cos(def.rot ?? 0), s = Math.sin(def.rot ?? 0), half = (def.w ?? 0) / 2;
  const u = (p) => { const q = grid.cellCenter(p.i, p.j); return (q.x - (def.x ?? 0)) * c + (q.z - (def.z ?? 0)) * s; };
  const A = pairs.filter((p) => u(p) < -half + 2), B = pairs.filter((p) => u(p) > half - 2);
  let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
  for (const p of pairs) { i0 = Math.min(i0, p.i); j0 = Math.min(j0, p.j); i1 = Math.max(i1, p.i); j1 = Math.max(j1, p.j); }
  const pad = Math.ceil(12 / grid.cell);
  i0 = Math.max(0, i0 - pad); j0 = Math.max(0, j0 - pad); i1 = Math.min(grid.cols - 1, i1 + pad); j1 = Math.min(grid.rows - 1, j1 + pad);
  const open = (i, j) => {
    if (i < i0 || i > i1 || j < j0 || j > j1 || !grid.isWalkable(i, j)) return false;
    const k = grid.idx(i, j);
    if (extra && extra.has(k)) return false;
    return grid.bridge[k] || (grid.terrain[k] !== T.WATER && grid.terrain[k] !== T.SHALLOW);
  };
  const openA = A.filter((p) => open(p.i, p.j)), openB = B.filter((p) => open(p.i, p.j));
  let linked = false;
  if (openA.length && openB.length) {
    const seen = new Set(), st = [];
    for (const p of openA) { const k = grid.idx(p.i, p.j); if (!seen.has(k)) { seen.add(k); st.push([p.i, p.j]); } }
    const goal = new Set(openB.map((p) => grid.idx(p.i, p.j)));
    while (st.length && !linked) {
      const [i, j] = st.pop();
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (!open(ii, jj)) continue;
        const k = grid.idx(ii, jj);
        if (seen.has(k)) continue;
        if (goal.has(k)) { linked = true; break; }
        seen.add(k); st.push([ii, jj]);
      }
    }
  }
  return { a: openA.length, b: openB.length, linked };
}

/** The landing nearest the deck's axis at each end of it (outer 4 m; none at a pier's head over the water). @returns {object[]} */
export function deckEndPoints(grid, def, pairs) {
  const c = Math.cos(def.rot ?? 0), s = Math.sin(def.rot ?? 0), half = (def.w ?? 0) / 2, out = [];
  const uv = (p) => { const q = grid.cellCenter(p.i, p.j), dx = q.x - (def.x ?? 0), dz = q.z - (def.z ?? 0); return [dx * c + dz * s, -dx * s + dz * c]; };
  for (const side of [-1, 1]) {
    let best = null, bv = Infinity;
    for (const p of pairs) { const [u, v] = uv(p); if (u * side > half - 4 && Math.abs(v) < bv) { bv = Math.abs(v); best = p; } }
    if (best) out.push(best);
  }
  return out;
}

/** Does a stamp keep a deck's way across (deckCrossing before / after)? Each end keeps a landing, a crossing stays one. */
export function deckCrossingKept(before, after) {
  return (!before.a || after.a > 0) && (!before.b || after.b > 0) && (!before.linked || after.linked);
}

/** Landings grouped into deck ends (landings within 2 cells of each other). @returns {object[][]} */
export function deckEnds(pairs) {
  const end = pairs.map((_, k) => k);
  const root = (k) => { while (end[k] !== k) k = end[k] = end[end[k]]; return k; };
  for (let a = 0; a < pairs.length; a++) for (let b = a + 1; b < pairs.length; b++) {
    if (Math.abs(pairs[a].i - pairs[b].i) <= 2 && Math.abs(pairs[a].j - pairs[b].j) <= 2) end[root(a)] = root(b);
  }
  const ends = new Map();
  for (let k = 0; k < pairs.length; k++) { const r = root(k); if (!ends.has(r)) ends.set(r, []); ends.get(r).push(pairs[k]); }
  return [...ends.values()];
}

/**
 * Deck ends stay reachable (stampVisualNav): landings ({i, j} deck cell, `lane` land cells straight out) are grouped
 * into ends (landings within 2 cells of each other); an end whose every first lane cell is in `out` gets all its
 * lanes back.
 */
export function keepDeckAccess(pairs, out) {
  let reopened = 0;
  for (const list of deckEnds(pairs)) {
    if (list.some((p) => p.lane.length && !out.has(p.lane[0]))) continue;
    for (const p of list) for (const k of p.lane) if (out.delete(k)) reopened++;
  }
  return reopened;
}

/**
 * Open edges of a deck (stampVisualNav): its bridge cells (grid.owner `owner`) whose walking surface (`tops`: the
 * deck visual's flat surfaces by 0.25 m cell) drops more than STEP_EDGE within `m` + 0.1 m of the cell centre, to
 * the ground (`ground`: the terrain height) or the water, or to a lower part. Landings flush with the ground are not
 * edges.
 * @returns {number[]}
 */
const STEP_EDGE = 0.15;
export function deckEdges(grid, owner, tops, m, free = () => false, ground = null) {
  const out = [], r = m + 0.1, q = 0.25;
  const top = (x, z) => tops.get(`${Math.floor(x / q)},${Math.floor(z / q)}`);
  for (let k = 0; k < grid.bridge.length; k++) {
    if (!grid.bridge[k] || grid.owner?.[k] !== owner || grid.navBlock[k]) continue;
    const c = grid.cellCenter(k % grid.cols, (k / grid.cols) | 0), t = top(c.x, c.z);
    if (t === undefined || free(c.x, c.z)) continue;
    for (let a = 0; a < 8; a++) {
      const x = c.x + Math.cos(a * Math.PI / 4) * r, z = c.z + Math.sin(a * Math.PI / 4) * r;
      const s = top(x, z), i = Math.floor(x / grid.cell), j = Math.floor(z / grid.cell);
      const lower = s ?? Math.max(grid.inBounds(i, j) ? grid.elev[grid.idx(i, j)] : 0, ground ? ground(x, z) ?? 0 : 0);
      if (t - lower > STEP_EDGE) { out.push(k); break; }
    }
  }
  return out;
}

/**
 * Deck cells (grid.bridge, walking level below 0.3 m) whose centre lies within `maxM` of the deck's own visual at
 * 0.6-1.8 m (parapets, lamp posts, end blocks the measured deck field missed). The caller keeps the deck's way across
 * (stampVisualNav: deckCrossing).
 * @returns {number[]} cell indices
 */
export function deckCover(grid, root, pairs, out, free = () => false, maxM = VIS_NAV_MARGIN) {
  const rects = planCells(root, { minY: 0.6, maxY: 1.8, cell: 0.25, close: 0 });
  if (!rects?.length) return [];
  const coverAt = (m) => {
    const cover = new Set();
    for (const r of rects) {
      const c0 = grid.worldToCell(r[0][0] - m, r[0][1] - m), c1 = grid.worldToCell(r[2][0] + m, r[2][1] + m);
      for (let j = Math.max(0, c0.j); j <= Math.min(grid.rows - 1, c1.j); j++) for (let i = Math.max(0, c0.i); i <= Math.min(grid.cols - 1, c1.i); i++) {
        const c = grid.cellCenter(i, j), k = grid.idx(i, j);
        // the body clearance as off the deck: a cell whose centre is within m of a post or a railing
        if (c.x < r[0][0] - m - 1e-6 || c.x > r[2][0] + m + 1e-6 || c.z < r[0][1] - m - 1e-6 || c.z > r[2][1] + m + 1e-6) continue;
        if (!grid.bridge[k] || grid.elev[k] >= 0.3 || grid.navBlock[k] || free(c.x, c.z)) continue;
        cover.add(k);
      }
    }
    return cover;
  };
  // (the deck's way across is checked by the caller, stampVisualNav: deckCrossing)
  return [...coverAt(maxM)];
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
export function stampTreeBranches(world, root, trees = null) {
  const grid = world.grid, out = new Map();
  if (!grid || !root) return 0;
  // visual-only vegetation (farmland hedges and orchards, forest understorey: art/terrain/bocage.js, forest-fill.js)
  // never changes gameplay: its branches do not stamp gun-arc cells unless a mission tree's crown is there too
  const vis = (trees || []).filter((t) => t.visual), solid = (trees || []).filter((t) => !t.visual);
  const under = (list, x, z) => list.some((t) => Math.abs(t.x - x) < 9 && Math.hypot(t.x - x, t.z - z) < (t.crownRadius ?? 4) + 0.75);
  const raw = new Map();
  root.traverse((n) => { if (n.isMesh && !n.isInstancedMesh && n.name === 'vegBark') overheadCells(n, { minY: 1.2, maxY: 6, cell: grid.cell }, raw); });
  for (const [key, r] of raw) {
    const [i, j] = key.split(',').map(Number);
    if (!grid.inBounds(i, j)) continue;
    const k = grid.idx(i, j);
    if (grid.block[k] !== B.NONE) continue; // the trunk's own footprint
    if (vis.length) { const c = grid.cellCenter(i, j); if (under(vis, c.x, c.z) && !under(solid, c.x, c.z)) continue; }
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
  // identity of `surf` for the session memo: the elevation grid + the ground sampled every 2 m
  const surfKey = dataKey((hs) => {
    hs.num(grid.cell); hs.num(grid.cols); hs.num(grid.rows); hs.floats(grid.elev);
    if (gy) for (let z = 0.5; z < grid.depth; z += 2) for (let x = 0.5; x < grid.width; x += 2) hs.num(gy.call(world, x, z));
  });
  let cells = 0;
  for (const b of built) {
    if (!b.object3d || TREE_TYPES.includes(b.type) || b.def.clip === false || b.type === 'road' || b.type === 'river') continue;
    const set = standingCells(b.object3d, surf, { lo: 0.15, hi: 1.2, cell: h, maxY: maxElev + 2, surfKey });
    if (!set.size) continue;
    grid.solidStamp(`solid:${b.owner}`, set);
    cells += set.size;
  }
  const off = world.events?.on?.('structure:destroyed', (e) => { if (e?.owner != null) grid.solidStamp(`solid:${e.owner}`, []); });
  return { cells, off: typeof off === 'function' ? off : null };
}

/**
 * Rule (e) on raised walks (wall walks, tower and MG-post decks: cells with elev > 0.3): a walk cell whose centre is
 * within VIS_NAV_MARGIN of a standing part (grid.solid: stakes, a parapet, a railing rising 0.15–1.2 m above the walk)
 * is nav-blocked, so a defender keeps his body out of the stakes. A raised piece is only narrowed while it stays in one
 * piece with all its keep points (ladder / climb ends, door approaches, unit posts), which stay open: where the full
 * margin would split it, half of it, else only the cells the stakes stand in.
 * @param {number[][]} keep [x, z] points
 * @returns {number} cells blocked
 */
export function stampWalkClearance(world, keep = []) {
  const grid = world.grid, q = grid.cell / 2, Q = grid.cols * 2;
  if (!grid.solid) return 0;
  // (raised decks too — a dam crest, a high bridge: deckCover only sees decks at ground level; not a stair's graded
  // cells, whose hand rails are walk-only footprints already and whose diagonal run a cell less would cut)
  const onRamp = (k) => !!grid.ramps && grid.nearRamp((k % grid.cols + 0.5) * grid.cell, (((k / grid.cols) | 0) + 0.5) * grid.cell, 0);
  const raised = (k) => grid.elev[k] > 0.3 && grid.block[k] === B.NONE && !grid.navBlock[k] && !onRamp(k);
  const keepK = new Set(keep.map(([x, z]) => { const c = grid.worldToCell(x, z); return grid.inBounds(c.i, c.j) ? grid.idx(c.i, c.j) : -1; }));
  const near = (k, m) => {
    const i = k % grid.cols, j = (k / grid.cols) | 0, c = grid.cellCenter(i, j);
    for (let qj = Math.floor((c.z - m) / q); qj <= Math.floor((c.z + m) / q); qj++) for (let qi = Math.floor((c.x - m) / q); qi <= Math.floor((c.x + m) / q); qi++) {
      if (qi < 0 || qj < 0 || qi >= Q || qj >= grid.rows * 2 || !grid.solid[qj * Q + qi]) continue;
      const dx = Math.max(qi * q - c.x, 0, c.x - (qi + 1) * q), dz = Math.max(qj * q - c.z, 0, c.z - (qj + 1) * q);
      if (Math.hypot(dx, dz) <= m) return true;
    }
    return false;
  };
  const comp = (seed, ok) => { // 4-connected piece of cells passing ok()
    const set = new Set([seed]), st = [seed];
    while (st.length) {
      const k = st.pop(), i = k % grid.cols, j = (k / grid.cols) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!grid.inBounds(i + di, j + dj)) continue;
        const kk = grid.idx(i + di, j + dj);
        if (!set.has(kk) && ok(kk)) { set.add(kk); st.push(kk); }
      }
    }
    return set;
  };
  const out = new Set(), seen = new Set();
  for (let k = 0; k < grid.elev.length; k++) {
    if (seen.has(k) || !raised(k)) continue;
    const piece = comp(k, raised);
    for (const kk of piece) seen.add(kk);
    // its ways off (a stair's foot, a ramp onto the ground beside it: a walkable neighbour outside the piece within a
    // step) are kept like the keep points: a stair between railings never closes
    const exits = new Set();
    for (const kk of piece) {
      const i = kk % grid.cols, j = (kk / grid.cols) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!grid.inBounds(i + di, j + dj)) continue;
        const nb = grid.idx(i + di, j + dj);
        if (!piece.has(nb) && grid.block[nb] === B.NONE && !grid.navBlock[nb] && Math.abs(grid.elev[nb] - grid.elev[kk]) <= MAX_STEP) { exits.add(kk); break; }
      }
    }
    const keeps = (kk) => keepK.has(kk) || exits.has(kk);
    // the full body clearance where the walk is wide enough, else less (a narrow walk still loses the cells its
    // stakes stand in), else nothing: the walk never splits
    for (const m of [VIS_NAV_MARGIN, VIS_NAV_MARGIN / 2, 0]) {
      const shut = new Set([...piece].filter((kk) => !keeps(kk) && near(kk, m)));
      if (!shut.size) break;
      if (shut.size === piece.size) continue;
      const rest = [...piece].filter((kk) => !shut.has(kk)), must = rest.filter(keeps);
      const left = comp(must[0] ?? rest[0], (kk) => piece.has(kk) && !shut.has(kk));
      if (left.size !== rest.length) continue; // it would split the walk
      for (const kk of shut) out.add(kk);
      break;
    }
  }
  if (out.size) grid.navStamp('walk:clear', out);
  return out.size;
}

/**
 * How far (m) a man's limbs reach past his body shape (world/body-clearance.js BODY) beside a thin tall post (gate posts):
 * a runner's arms and rifle at chest height, a crawler's drawn-up knee.
 */
const ARM_REACH = 0.2;

/** Audit categories whose visuals are solid bodies men never cross (world/body-clearance.js static solids). */
const BODY_SOLID_CATS = new Set(['prop', 'rocks', 'vehicle', 'emplacement', 'sandbags']);
/** …of those, the ones kept as their real (non-convex) outline: a sandbag line may bend round a gun pit. */
const BODY_SOLID_OUTLINE = new Set(['sandbags']);

/**
 * Body clearance (world/body-clearance.js): every solid prop's visual at body height (0.15–1.6 m over the ground
 * under it: crates, fuel tanks, carts, rocks, wrecked planes…) → one oriented rect (min-area rect of its plan hull)
 * the whole body of a man — a crawler's head and legs too — keeps clear of; sandbag lines → one rect per bag (their
 * instanced meshes) plus the row rectangles (0.25 m, in their own frame) of any plain mesh, up to 1.2 m, so the pit
 * behind a bent line stays open. Re-run when library meshes load; a destroyed structure's rects are dropped.
 * @returns {{count: number, off: Function|null}}
 */
export function stampBodySolids(world, built, groundAt = null) {
  const list = [];
  for (const b of built) {
    if (!b.object3d || TREE_TYPES.includes(b.type) || LINEAR_PROPS.includes(b.type) || b.def.clip === false) continue;
    if (!BODY_SOLID_CATS.has(categoryOf(b.type, b.def)) || isPlatformProp(b.type)) continue; // a platform is walked on (nav + climb links)
    if (world.bodySolidsGone?.has(b.owner)) continue;
    const gy = groundAt ? groundAt(b.def.x ?? 0, b.def.z ?? 0) : 0;
    // (`top`: its height over the ground, for a shouldered rifle: placement.weaponRoom)
    const top = new THREE.Box3().setFromObject(b.object3d).max.y - gy;
    if (BODY_SOLID_OUTLINE.has(categoryOf(b.type, b.def))) {
      for (const R of instanceRects(b.object3d, 0.15, 1.2, gy)) list.push({ owner: b.owner, R: { ...R, top } });
      for (const q of planCells(b.object3d, { minY: 0.15, maxY: 1.2, groundY: gy, cell: 0.25, close: 0, fit: true }) || []) {
        const [p0, p1, , p3] = q, hl = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 2, hw = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) / 2;
        if (hl > 0.01 && hw > 0.01) list.push({ owner: b.owner, R: { x: (q[0][0] + q[2][0]) / 2, z: (q[0][1] + q[2][1]) / 2, h: Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), hl, hw, top } });
      }
      continue;
    }
    const hull = planHull(b.object3d, { minY: 0.15, maxY: 1.6, groundY: gy });
    const R = hull && minAreaRect(hull);
    if (R) list.push({ owner: b.owner, R: { ...R, top } });
  }
  // a gate's fixed posts (world/breakables.js gateLayout: a boom barrier's pivot post, fork rest and log gate posts beside
  // its footway) are solid bodies too: a man standing or aiming in the footway keeps his body off them (clip-2, M2)
  for (const b of built) {
    if (b.type !== 'gate' || b.def.clip === false) continue; // (the posts stand on when the gate is smashed: own owner key)
    const d = b.def, L = gateLayout(d);
    if (!L?.pieces) continue;
    const rot = d.rot ?? 0, tx = Math.cos(rot), tz = Math.sin(rot);
    // (a boom's fork rest holds the pole's tip, which reaches a little past it: the rest's solid covers the tip)
    const tip = L.kind === 'boom' ? Math.max(...L.pieces.filter((p) => p.kind === 'pole').map((p) => p.c[0] + p.h[0])) : null;
    for (const p of L.pieces) {
      if (p.kind !== 'post' || !(p.h[0] > 0.01 && p.h[2] > 0.01)) continue;
      let u0 = p.c[0] - p.h[0], u1 = p.c[0] + p.h[0], top = p.c[1] + p.h[1];
      if (p.id === 'post1' && tip != null) { u1 = Math.max(u1, tip); top = Math.max(top, L.pivot[1] + 0.07); }
      // (+ ARM_REACH: a post up to a man's hips or higher, where his swinging hands, arms and rifle reach past his body)
      const u = (u0 + u1) / 2, v = p.c[2], m = top > 0.9 ? ARM_REACH : 0;
      list.push({ owner: `${b.owner}:posts`, R: { x: (d.x ?? 0) + u * tx - v * tz, z: (d.z ?? 0) + u * tz + v * tx, h: rot, hl: (u1 - u0) / 2 + m, hw: p.h[2] + m, top } });
    }
  }
  setStaticSolids(world, list);
  if (world._bodySolidsOff) return { count: list.length, off: null };
  const gone = world.bodySolidsGone || (world.bodySolidsGone = new Set());
  const off = world.events?.on?.('structure:destroyed', (e) => { if (e?.owner != null) { gone.add(e.owner); removeStaticSolids(world, e.owner); } });
  world._bodySolidsOff = typeof off === 'function' ? off : () => {};
  return { count: list.length, off: world._bodySolidsOff };
}

/**
 * Oriented plan rects (body-clearance obstacles) of every instance of the instanced meshes under `root` that reaches
 * into the height band [minY, maxY] over `gy` (one per sandbag of a dressing line; planCells skips instanced meshes).
 */
function instanceRects(root, minY, maxY, gy) {
  const out = [], im = new THREE.Matrix4(), m = new THREE.Matrix4(), v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((n) => {
    if (!n.isInstancedMesh || !n.visible || n.userData?.clip === false || !n.geometry) return;
    if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
    const bb = n.geometry.boundingBox;
    for (let q = 0; q < n.count; q++) {
      n.getMatrixAt(q, im); m.multiplyMatrices(n.matrixWorld, im);
      const pts = [];
      let y0 = Infinity, y1 = -Infinity;
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
        v.set(x, y, z).applyMatrix4(m);
        pts.push([v.x, v.z]); y0 = Math.min(y0, v.y - gy); y1 = Math.max(y1, v.y - gy);
      }
      if (y1 < minY || y0 > maxY) continue;
      const R = minAreaRect(convexHull(pts));
      if (R) out.push(R);
    }
  });
  return out;
}

/** Measured floor height of a watchtower deck (median of 5 raycasts around its centre), or undefined. */
export function deckSurface(b) {
  const d = b.def, y0 = d.deckY ?? d.h ?? 5.5, meshes = finestMeshes(b.object3d);
  const ys = [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]
    .map(([u, v]) => measureTop(b.object3d, (d.x ?? 0) + u, (d.z ?? 0) + v, y0 - 0.6, y0 + 0.8, meshes)).filter((v) => v != null).sort((p, q) => p - q);
  return ys.length ? +ys[ys.length >> 1].toFixed(3) : undefined;
}

/**
 * Feet footprint for the low-surface ground height (placement rule e): centre + two rings (0.1 m, FOOT_R) at full
 * height, + 8 points a stride (STRIDE_R) out that count STRIDE_DROP lower — stepping off a deck end, a plinth or a
 * kerb the body comes down in two steps, so the trailing boot does not swing through the step's face.
 */
const FOOT_R = 0.18, STRIDE_R = 0.36, STRIDE_DROP = 0.12;
/** Highest deck / span edge (m above the ground) the feet ring steps onto; higher is a roof or a deck overhead. */
const STEP_MAX = 0.45;
/**
 * Stride drop for a step `s` m high: the full drop for a step of STEP_FULL or more, less for a low lip (a 3 cm board
 * end, a kerb), so the leading toe clears a lip lower than the drop instead of sliding into its face.
 */
const STEP_FULL = 0.25;
const lipDrop = (s, drop) => drop * Math.min(1, Math.max(0, s) / STEP_FULL);
const ring = (r, drop) => Array.from({ length: 8 }, (_, k) => [Math.cos(k * Math.PI / 4) * r, Math.sin(k * Math.PI / 4) * r, drop]);
// (a half-stride ring between: the leading boot reaches the step face before the body is a full stride from it)
// (the soles: 8 points at 0.1 m and at FOOT_R at full height, so a stair's next step in front of the shins counts)
const FOOT_OFFS = [[0, 0, 0], ...ring(0.1, 0), ...ring(FOOT_R + 0.02, 0),
  ...ring((FOOT_R + STRIDE_R) / 2, STRIDE_DROP / 2), ...ring(STRIDE_R, STRIDE_DROP)];

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
    for (const b of list) { b.library.dispose(); b.batched = true; } // the batch draws them (their nav stamps stay)
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

/** Structure types whose `walkways` raise natural ground, not a built floor (grid.naturalElev). */
const NATURAL_LEVELS = new Set(['cliff', 'road']);

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
  const raise = (fp, y, keepLinesOf = null, natural = 0) => {
    scratch.block.fill(0);
    applyFootprint(scratch, { ...fp, block: B.HIGH }, 'block', 0);
    for (let k = 0; k < grid.size; k++) {
      if (!scratch.block[k]) continue;
      grid.naturalElev[k] = natural;
      if (keepLinesOf != null && grid.block[k] && grid.owner[k] !== keepLinesOf && lineOwners.has(grid.owner[k])) { grid.elev[k] = y; n++; continue; }
      grid.elev[k] = y; grid.block[k] = B.NONE; grid.owner[k] = 0; n++;
    }
  };
  for (const b of built) {
    // a cliff's plateau / terrace or a road ramp is raised ground (its terrain code holds); anything else is a built floor
    const natural = NATURAL_LEVELS.has(b.type) ? 1 : 0;
    for (const w of b.def.walkways || []) raise({ shape: 'line', points: pts2(w.points), width: w.width ?? 1.2 }, w.y, b.owner, natural);
    // a raised deck (dam crest, `deck` + `elev`): its bridge cells stand at `elev`, keeping their owner (removeCrest)
    if (b.def.deck && b.def.elev > 0) {
      // `walkY`: the deck's walking surface (the asset's snow-covered deck stands a little over its lifted origin)
      const y = b.def.walkY ?? b.def.elev;
      for (let k = 0; k < grid.size; k++) if (grid.owner[k] === b.owner && grid.bridge[k]) { grid.elev[k] = y; n++; }
    }
    // `ramps: [{points:[bottom, …, top], width?, y0, y1}]`: stairs whose cells climb linearly along the polyline
    for (const r of b.def.ramps || []) n += raiseRamp(grid, scratch, pts2(r.points), r.width ?? 1.6, r.y0 ?? 0, r.y1, r.landing);
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

/**
 * One ramp/stair of `applyElevation`: every cell under the polyline band (width w) gets the top of the stair tread at
 * its arc-length position along the line (art/dam-stairs stairTopAt: y0 at the first point … y1 at the last, the
 * visual treads' own heights); block cleared, owner 0.
 */
function raiseRamp(grid, scratch, pts, w, y0, y1, landing) {
  scratch.block.fill(0);
  applyFootprint(scratch, { shape: 'line', points: pts, width: w, block: B.HIGH }, 'block', 0);
  const segs = [];
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
    segs.push({ ax, az, bx, bz, L, s0: total }); total += L;
  }
  if (!(total > 0)) return 0;
  let n = 0;
  for (let k = 0; k < grid.size; k++) {
    if (!scratch.block[k]) continue;
    const x = (k % grid.cols + 0.5) * grid.cell, z = (Math.floor(k / grid.cols) + 0.5) * grid.cell;
    let best = Infinity, s = 0;
    for (const g of segs) {
      const t = g.L ? Math.max(0, Math.min(1, ((x - g.ax) * (g.bx - g.ax) + (z - g.az) * (g.bz - g.az)) / (g.L * g.L))) : 0;
      const d = Math.hypot(g.ax + (g.bx - g.ax) * t - x, g.az + (g.bz - g.az) * t - z);
      if (d < best) { best = d; s = g.s0 + t * g.L; }
    }
    grid.elev[k] = Math.max(grid.elev[k], stairTopAt(s, total, y0, y1, landing)); grid.block[k] = B.NONE; grid.owner[k] = 0; n++;
  }
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
  // a road that leaves the map is laid on past the edge (as world/apron-field.js carries it over the apron), so its
  // end cap never cuts the carriageway short on the boundary where it crosses at a slant
  const edgeOn = mission.apron?.extend !== false;
  const pastEdge = (P, widths, hw, near) => (edgeOn ? extendPath(P, widths, grid.width, grid.depth, near, hw + 4) : { points: P, widths });
  for (const t of mission.terrain || []) {
    if (t.type !== 'path' || t.terrain !== 'road' || !(t.points?.length > 1)) { applyTerrainFeature(grid, t); continue; }
    const hw = Math.max(...[].concat(t.widths ?? t.width ?? 3)) / 2, e = pastEdge(t.points, t.widths, hw, hw + 2);
    applyTerrainFeature(grid, { ...t, points: e.points, ...(e.widths ? { widths: e.widths } : {}) });
  }
  // 1b. step 3p road network: roads / pavements → grid codes; one spatial index for surface / raise queries
  const roadNet = normalizeRoadNetwork(mission);
  // (soft roads without street lamps: the lamps are spaced from the road's start)
  for (const r of roadNet.roads) if (!SURFACES[r.surface]?.hard && !r.lamps) r.points = pastEdge(r.points, null, r.width / 2, r.type === 'path' ? r.width / 2 + 2 : 1.5).points;
  paintRoadGrid(grid, roadNet, terrainCode);
  const roads = new RoadIndex(roadNet, grid.width, grid.depth);
  world.roads = roads;

  // 2. build every structure (meshes + footprints)
  // explosive fuel drums (`barrels` + explosive:'barrel') are dynamic Barrel entities (§3.4 carry, §3.6 barrel
  // class), not static props: no footprint (they can be carried away), spawned in step 4
  const ctx = { theater, grid, world, missionId: mission.id, apronWidth: mission.apron?.width ?? CONFIG.apron.width };
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
  // walkable decks follow the asset's own crest (a dam's arch curves away from the data rect at its ends): nobody
  // walks on air beside it or through its parapet (placement rule e)
  for (const b of built) {
    const crest = b.library?.bridge?.crest;
    if (crest?.length >= 3 && b.footprints.some((f) => f.bridge)) b.footprints = [...b.footprints.filter((f) => !f.bridge), { shape: 'poly', points: crest, bridge: 1 }];
  }
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
  // raised water (terrain features with a `level`, the M3 reservoir held up by its dam): its surface stands metres
  // over the ground level units walk and swim at, so nobody wades or swims in it (nav-only: sight is unchanged)
  const raisedCells = [];
  for (const r of raisedWaterMasks(grid, mission)) for (let k = 0; k < r.mask.length; k++) if (r.mask[k]) raisedCells.push(k);
  if (raisedCells.length) grid.navStamp('raised-water', raisedCells);
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
    // crest stairs of a raised dam (`ramps`): their own world-space meshes, outside the structure (they outlive its
    // destruction and stay out of its visual nav stamp)
    if (meshes && b.def.ramps?.length) propsRoot.add(buildDamStairs(b.def.ramps));
  }
  for (const d of drums) {
    const s = d.def;
    // an explosive process column (M11 quarry tanks: `barrels` + `oil_tanks_vertical`, r 1.75 h 7) bursts like a drum
    // but looks and stands like the fuel family's column: its library model (+ pipe run), a HIGH round footprint, and
    // a wreck left standing when it goes up (docs/fuel-tanks.md §5.4)
    const column = isFuelStructure(s) && s.r != null;
    const colVis = column && meshes && ctx.library !== false ? buildStructure(s, ctx) : null;
    if (column) grid.fillCircle(s.x, s.z, s.r, 'block', B.HIGH, d.owner);
    const barrel = addIt(createInteractable({
      interactKind: 'barrel', id: s.id ?? null, x: s.x, z: s.z, variant: s.variant ?? null, hp: s.hp ?? 1,
      carriable: s.carriable !== false && !column, explosive: 'barrel', structure: s, owner: d.owner,
      ...(colVis?.object3d ? { object3d: colVis.object3d, keepWreck: true } : {}),
    }, { meshes }));
    structures.set(s.id ?? `barrels#${d.owner - STRUCTURE_OWNER_BASE}`, { type: s.type, def: s, owner: d.owner, object3d: barrel.object3d, footprints: [], entity: barrel });
  }
  if (meshes) wireFuelHooks(world);                      // M17 valve wheel / spout pour (art/fuel-hooks.js)
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

  // 5b'. a boom barrier set in a wider wall opening (def.gap): the pivot side and the gate / fork posts stay blocked to
  // walkers whether the boom is up or down; the footway beside the fork rest stays open (pedestrians walk round)
  stampBarrierGaps(world, built);
  stampNavFootprints(world, built);
  for (const b of built) for (const f of b.footprints || []) if (f.ramp) grid.addRamp(f.ramp);   // stairs: sloped walker height

  // 5c. placement rule (e): what the visuals occupy outside their gameplay footprints blocks walking (browser)
  let visNavOff = null, deckLanes = null;
  if (meshes) {
    const vn = stampVisualNav(world, built, missionWayPoints(mission, interactables));
    visNavOff = vn.off; deckLanes = vn.lanes;
    if (vn.cells) libLog.push(`visual nav: ${vn.cells} cells blocked (${vn.structures} structures${vn.relaxed ? `, ${vn.relaxed} relaxed to keep ways open` : ''})`);
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

  // 6c. linear structures (walls, fences, wire, rails) that end on a map edge carry on over the scenery apron instead
  // of stopping on the boundary line; visual only, the nav grid keeps the mission's runs (world/edge-extend.js)
  const edgeRuns = realTerrain && mission.apron?.extend !== false
    ? edgeStructureRuns(mission.structures, grid.width, grid.depth, (mission.apron?.width ?? CONFIG.apron.width) + 12) : [];
  if (edgeRuns.length) {
    const g = new THREE.Group();
    g.name = 'props:edgeRuns';
    for (const r of edgeRuns) {
      const { type, segments, visualRuns, placementDropped, visualWalkways, walkways, ...params } = r.def;
      try { g.add(buildProp(type, { ...params, id: r.id, points: r.points }, ctx).object3d); } catch (e) { console.warn('[map-builder] edge run', r.id, e); }
    }
    propsRoot.add(g);
  }
  // 6d. a street of flat-roofed houses ending flush on a map edge (M12 house_e1..e3) carries on as a town past it
  const edgeHouses = realTerrain && mission.apron?.extend !== false
    ? edgeBuildingRows(mission.structures, grid.width, grid.depth, { library: (s) => libraryHinted(s.type, s) }) : [];
  if (edgeHouses.length && meshes) {
    const m = buildEdgeBuildings(edgeHouses);
    if (m) propsRoot.add(m);
  }
  // 7. ground + water from the finished grid
  let terrain = null, unwire = null, pavedGroundY = null, wire = null;
  if (meshes) {
    // point trees only: a forest AREA (tree type + `points`, e.g. M4/M20 'forest' footprints) has no x/z of its own
    const trees = realTerrain ? built.filter((b) => TREE_TYPES.includes(b.type) && Number.isFinite(b.def?.x) && Number.isFinite(b.def?.z)).map((b) => b.def) : [];
    // forest AREAS are drawn too (art/terrain/forest-fill.js): a seeded wood inside the polygon, footprint unchanged
    const forests = realTerrain ? built.filter((b) => TREE_TYPES.includes(b.type) && Array.isArray(b.def?.points)).map((b) => b.def) : [];
    // real terrain: the water system (src/art/water) owns the surface → buildTerrain returns water: null
    // placeholder ground takes the mission's `groundPalette` (e.g. 'frost', M18 §2.4); real terrain keeps the theater
    terrain = buildTerrain(grid, realTerrain ? theater : (mission.groundPalette || theater), realTerrain ? { renderer: opts.renderer, mission, trees, forests, ownWater: true, roads,
      edgeLines: [...edgeRuns.map((r) => ({ points: r.points, hw: (r.def.width ?? 0.5) / 2 + 0.6 })), ...edgeBuildingFlatLines(edgeHouses)] } : {});
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
  // placement rule (e): feet stand on the low surfaces of the visuals (steps, ramps, porch boards, snow skirts)
  const SURF_CELL = 0.2, surf = meshes ? new Map() : null;
  if (surf) {
    for (const b of built) {
      if (!b.object3d || TREE_TYPES.includes(b.type) || LINEAR_PROPS.includes(b.type) || b.def.clip === false) continue;
      lowSurfaces(b.object3d, { maxY: 0.8, cell: SURF_CELL }, surf); // (up to a door sill: the top step of a porch)
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
    const wetAt = (x, z) => { const t = grid.terrainAt?.(x, z); return t === T.WATER || t === T.SHALLOW; };
    // numeric sample keys (the feet ring looks up ~20 samples per call)
    const numKeys = (m) => { if (!m?.size) return null; const o = new Map(); for (const [k, v] of m) { const c = k.indexOf(','); o.set(+k.slice(0, c) * 131072 + +k.slice(c + 1), v); } return o; };
    const surfN = numKeys(surf), laneN = numKeys(laneSurf);
    const onDeckCell = (px, pz) => { const i = Math.floor(px / grid.cell), j = Math.floor(pz / grid.cell); return grid.inBounds(i, j) && grid.bridge[grid.idx(i, j)]; };
    // over a raised walk (a dam crest, stair treads, a tower deck: grid elev > 0) the grid height already is the
    // surface the feet stand on; the low surfaces / relief below it only count where they rise above it
    deckGroundY = (x, z) => {
      const e = grid.elevAt(x, z), y = groundBelowDeck(x, z);
      return e > 0.05 ? Math.max(0, y - e) : y;
    };
    const groundBelowDeck = (x, z) => {
      // on a deck (a bridge, a dam crest, a lowered drawbridge span: world.surfaces[i].heightAt → y or null) the
      // feet stand on it, and still step onto a kerb or a sill on it (the ring below)
      let g = null, onDeck = false;
      if (onBridgeCell(grid, x, z)) {
        for (const d of decks) { const h = d.heightAt(x, z); if (h != null) { g = h; break; } }
        if (g == null) for (const s of world.surfaces || []) { const h = s.heightAt(x, z); if (h != null) { g = h; break; } }
        onDeck = g != null;
      }
      if (g == null) g = typeof base === 'function' ? base.call(world, x, z) : 0;
      // the highest low surface under the feet (centre ± FOOT_R): a boot steps up onto a kerb, plinth or snow
      // skirt instead of pushing into its side while the body's centre is still below
      let sy, dry = null;
      const movable = world.surfaces?.length ? world.surfaces : null;
      for (const [dx, dz, drop] of FOOT_OFFS) {
        const px = x + dx, pz = z + dz, key = Math.floor(px / SURF_CELL) * 131072 + Math.floor(pz / SURF_CELL);
        const onLane = laneN && (onDeck || deckLanes.has(grid.idx(Math.floor(px / grid.cell), Math.floor(pz / grid.cell))));
        const v0 = onLane && laneN.has(key) ? laneN.get(key) : surfN ? surfN.get(key) : undefined;
        // (on a deck: only what rises above the deck counts, STEP_MAX at most: not the bank below or a parapet)
        const v = v0 === undefined || (onDeck && (v0 < g || v0 - g > STEP_MAX)) ? undefined : v0 - lipDrop(v0 - g, drop);
        if (v !== undefined && (sy === undefined || v > sy)) sy = v;
        // a deck / span edge beside a dry walker (a drawbridge end, a bridge's side): a step, not a roof overhead
        if (!onDeck && (dx || dz) && (decks.length || movable) && onDeckCell(px, pz)) {
          for (const list of [decks, movable]) for (const d of list || []) {
            const h = d.heightAt(px, pz);
            if (h == null || h - g > STEP_MAX) continue;
            const hv = h - lipDrop(h - g, drop);
            if (hv > g && (sy === undefined || hv > sy) && (dry ??= !wetAt(x, z))) sy = hv;
          }
        }
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
  const stampBodies = (list = built) => {
    const pieces = walkPieces(grid), hr = stampHeadroom(world, built);
    // (never at the price of a way between the mission's points: a lane under low eaves stays a lane)
    if (hr.cells) {
      const st = { key: 'headroom', levels: [new Set(grid._navStamps.get('headroom') || []), new Set()], soft: true };
      const ways = [...(world.structureDoors?.values?.() || []), ...(grid.links || []).flatMap((l) => [[l.a.x, l.a.z], [l.b.x, l.b.z]]), ...rampEnds(grid), ...missionWayPoints(mission, interactables)];
      if (keepWays(grid, pieces, ways.map(([x, z]) => { const c = grid.worldToCell(x, z); return [c.i, c.j]; }), [st])) libLog.push(`head room: ${st.lv.size} cells opened (a way under low eaves)`);
    }
    if (hr.off) { const a = visNavOff; visNavOff = () => { a?.(); hr.off(); }; }
    if (hr.cells) libLog.push(`head room: ${hr.cells} cells under low eaves blocked`);
    const t0 = performance.now(), st = stampStanding(world, list);
    if (st.off) { const a = visNavOff; visNavOff = () => { a?.(); st.off(); }; }
    if (st.cells) libLog.push(`standing visuals: ${st.cells} quarter cells (${Math.round(performance.now() - t0)} ms)`);
    const spawns = [...(mission.enemies || []), ...(mission.commandos || [])].filter((u) => u.x != null).map((u) => [u.x, u.z]);
    const wc = stampWalkClearance(world, [...navKeepPoints(world, built), ...spawns]);
    if (wc) libLog.push(`raised walks: ${wc} cells beside stakes / railings blocked`);
  };
  if (meshes) {
    stampBodies(wire?.standing ? [...built, wire.standing] : built);
    // body clearance: solid props men never cross (world/body-clearance.js), again once library meshes are in
    const solidGround = terrain?.groundY ? (x, z) => terrain.groundY(x, z) : null;
    const bs = stampBodySolids(world, built, solidGround);
    if (bs.off) { const a = visNavOff; visNavOff = () => { a?.(); bs.off(); }; }
    libLog.push(`body solids: ${bs.count}`);
    if (built.some((b) => b.library && BODY_SOLID_CATS.has(categoryOf(b.type, b.def)))) {
      Promise.all(built.filter((b) => b.library).map((b) => b.library.ready)).then(() => { if (!gone) stampBodySolids(world, built, solidGround); }, () => {});
    }
  }
  // repeats → instanced batches, only now: every visual measurement above (low surfaces under the feet, standing
  // visuals, head room) reads the repeats' own meshes, which the batch disposes (clip-2: M3 cabins' porch boards)
  const batches = meshes ? batchLibraryRepeats(libBuilt, propsRoot, libLog) : [];
  world.waterObstacles = libraryWaterObstacles(libBuilt);
  const doors = wireLibraryDoors(world, libBuilt);
  world.buildingLog = libLog;
  if (libLog.length) console.info(`[map-builder] ${mission.id}: ${libBuilt.length} library buildings\n  ${libLog.join('\n  ')}`);
  const libReady = Promise.all([...libBuilt.map((b) => b.library.ready), ...batches]).then(() => undefined);
  // the nav stamps follow the visuals: a library building whose meshes were still loading when the map was built (a
  // slow machine, a preload past its budget) stamped nothing, so every visual stamp is measured again once all are in
  // (no mesh yet, or no finest level of detail yet: the stamps measure LOD0)
  const meshless = meshes ? libBuilt.filter((b) => { if (b.batched) return false; let n = 0, l0 = false; b.object3d?.traverse((o) => { if (o.isMesh) n++; if (o.name === 'lod0') l0 = true; }); return !n || !l0; }) : [];
  if (meshless.length) {
    libLog.push(`${meshless.length} library buildings still loading: visual nav stamps again when they are in`);
    libReady.then(() => {
      // (only those: the others keep their stamps; a batched repeat is drawn by its batch, its stamps stay)
      const late = meshless.filter((b) => !b.batched);
      if (gone || !late.length) return;
      for (const b of late) { grid.navStamp(`vis:${b.owner}`, []); grid.navStamp(`low:${b.owner}`, []); }
      grid.navStamp('headroom', []); grid.navStamp('walk:clear', []);
      stampVisualNav(world, late, missionWayPoints(mission, interactables));
      stampOverhead(world, late);
      stampBodies(late);
      grid.version++;
    }, () => {});
  }
  // 8. water (real terrain only): built once the carved ground is ready — the bed capture renders it from above
  let water = null, fallbackWater = null, gone = false, windFx, life, damWater, lifeReady = false, pavement = null, furniture = null, streetLights = null;
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
      // telegraph lines that end on a map edge run on over the apron (visual poles + wires, world/edge-extend.js)
      let furnVis = furn;
      if (mission.apron?.extend !== false) {
        const len = (mission.apron?.width ?? CONFIG.apron.width) + 12, lines = [];
        for (const f of roadNet.furniture) {
          if (f.type !== 'telegraph' || !Array.isArray(f.points)) continue;
          for (const e of edgeLineExtensions(f.points, grid.width, grid.depth, len)) {
            // the run's first pole is the line's own end pole: not drawn twice, only its insulators are wired
            for (const l of expandFurniture({ roads: [], furniture: [{ ...f, points: e, block: false }] }).lines) lines.push({ ...l, ghostFirst: true });
          }
        }
        if (lines.length) furnVis = { ...furn, lines: [...furn.lines, ...lines] };
      }
      if (furnVis.items.length || poles.some((q) => q.def.wireTo)) {
        furniture = buildFurniture(furnVis, { groundAt, poles });
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
      water = buildWater(opts.renderer, world, grid, mission, theater, { module: WaterModule, terrain: terrain?.terrain?.mesh, apron: terrain?.apron, shore: terrain?.shore });
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
    ready: Promise.all([Promise.resolve(terrain?.ready).then(() => { if (!gone && meshes && terrain?.ground) stampTreeBranches(world, terrain.ground, terrain.vegetation?.trees); }).then(buildPavementNow).then(buildWaterNow).then(() => water?.system.texturesReady), Promise.resolve(terrain?.ready).then(() => terrain?.apronReady), libReady,
      // the dam pool's lace / normal textures (render/dam-water-pool.js): decoded before the first frame draws the pool
      meshes && realTerrain && hasDamWater(structures) ? loadDamPoolTextures() : null]).then(() => { lifeReady = true; }),
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
      // water down the M3 dam (render/dam-water.js): built with the life layer, after the water's bed capture
      if (damWater === undefined && lifeReady && !gone) {
        damWater = opts.meshes === false || !realTerrain ? null : createDamWater(world, structures, opts.renderer);
        if (damWater) world.scene?.add(damWater.group);
      }
      damWater?.frame(dt);
    },
    get damWater() { return damWater; },
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
      damWater?.dispose(); damWater = null;
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
