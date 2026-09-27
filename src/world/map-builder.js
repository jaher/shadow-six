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
import * as WaterModule from '../art/water/index.js';
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
  const { type, segments, ...params } = s;
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
  const r = buildProp(type, params.deck ? { ...params, h: params.deckY ?? 0.6 } : params, ctx);
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
  const raise = (fp, y) => {
    scratch.block.fill(0);
    applyFootprint(scratch, { ...fp, block: B.HIGH }, 'block', 0);
    for (let k = 0; k < grid.size; k++) {
      if (!scratch.block[k]) continue;
      grid.elev[k] = y; grid.block[k] = B.NONE; grid.owner[k] = 0; n++;
    }
  };
  for (const b of built) {
    for (const w of b.def.walkways || []) raise({ shape: 'line', points: pts2(w.points), width: w.width ?? 1.2 }, w.y);
    if (b.type === 'watchtower') {
      const d = b.def;
      raise({ shape: 'rect', x: d.x, z: d.z, w: d.w ?? 3, d: d.d ?? 3, rot: d.rot ?? 0 }, d.deckY ?? d.h ?? 5.5);
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
  const built = [], drums = [];
  (mission.structures || []).forEach((s, k) => {
    if (isExplosiveBarrel(s)) { drums.push({ def: s, owner: STRUCTURE_OWNER_BASE + k }); return; }
    const r = buildStructure(s, { theater, grid, world, missionId: mission.id });
    built.push({ def: s, type: s.type, owner: STRUCTURE_OWNER_BASE + k, ...r });
  });
  // 3. grid passes: terrain (all) → shore rim → bridges → blocks → raised surfaces
  for (const b of built) for (const fp of b.footprints) applyFootprint(grid, fp, 'terrain', b.owner);
  applyShoreShallows(grid, mission.shoreShallowWidth);
  for (const pass of ['bridge', 'block']) {
    for (const b of built) for (const fp of b.footprints) applyFootprint(grid, fp, pass, b.owner);
  }
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
        ? { bombOnly: !!b.def.bombOnly, destroyedBy: b.def.destroyedBy ?? null, explosive: b.def.explosive ?? null, carriable: !!b.def.carriable }
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

  // 6. mission registries (consumed by AI alarm/brain, abilities, objectives)
  registerMission(world, mission, structures);

  // 7. ground + water from the finished grid
  let terrain = null, unwire = null, pavedGroundY = null;
  if (meshes) {
    const trees = realTerrain ? built.filter((b) => TREE_TYPES.includes(b.type)).map((b) => b.def) : [];
    // real terrain: the water system (src/art/water) owns the surface → buildTerrain returns water: null
    terrain = buildTerrain(grid, theater, realTerrain ? { renderer: opts.renderer, mission, trees, ownWater: true, roads } : {});
    world.scene?.add(terrain.ground);
    if (terrain.water) world.scene?.add(terrain.water);
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
  const decks = libraryDecks(libBuilt);
  let deckGroundY = null;
  if (decks.length) {
    const base = world.groundY;
    deckGroundY = (x, z) => {
      for (const d of decks) { const h = d.heightAt(x, z); if (h != null && onBridgeCell(grid, x, z)) return h; }
      return typeof base === 'function' ? base.call(world, x, z) : 0;
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
    ready: Promise.all([Promise.resolve(terrain?.ready).then(buildPavementNow).then(buildWaterNow).then(() => water?.system.texturesReady), libReady]).then(() => { lifeReady = true; }),
    /** Per displayed frame: trails, grass/snow/tree animation, preset follow; water sim + reflections (before render). */
    frame(dt, camera) {
      terrain?.frame?.(dt, camera, world); water?.frame(dt, camera);
      if (pavement && pavement.quality !== terrain?.quality) { pavement.quality = terrain.quality; pavement.setQuality(terrain.quality); }
      streetLights?.frame(dt, camera); tickBuildings(dt, camera, world.wind ?? null); doors.frame(dt);
      if (windFx === undefined) windFx = opts.meshes === false ? null : createWindFx(world, realTerrain ? opts.renderer : null); // step 4w
      windFx?.frame(dt, camera);
      // step 4f: fish under the water, gulls / crows / ducks (after the water's bed capture: never baked into it)
      if (life === undefined && lifeReady && !gone) life = opts.meshes === false || !realTerrain ? null : createAmbientLife(world, opts.renderer);
      life?.frame(dt, camera);
    },
    get windFx() { return windFx; },
    get pavement() { return pavement; },
    get furniture() { return furniture; },
    get streetLights() { return streetLights; },
    get life() { return life; },
    dispose() {
      gone = true;
      windFx?.dispose(); windFx = null;
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
