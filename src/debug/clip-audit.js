/**
 * Clipping / interpenetration audit (test mode: window.__game.clip, loaded lazily).
 *   collect(): every static render item of the loaded mission — structures (library buildings at LOD0, instanced
 *     repeats per instance, dressing, flags on their buildings), vegetation chunks (trunk / foliage), interactable
 *     props, optionally clutter stones — plus vehicles and characters (posed) as dynamic items.
 *   staticAudit(): spatial-grid broad phase → triangle-exact narrow phase (clip-geom.js) → rules (clip-rules.js).
 *   turretSweep(): every turret traversing its arc (emplacement `giro`, else 360°) against the statics.
 *   dynamicAudit(): runs the sim (patrols, vehicle routes, scripted commando moves near walls, a few bodies dropped
 *     next to walls) and samples characters / vehicles / guns against the statics.
 * Findings carry pair ids/types/categories, depth, contact length, volume, world point and box, allowed + reason.
 * @module debug/clip-audit
 */
import * as THREE from 'three';
import { geometryBVH, posedBVH, makePart, itemBox, measurePair } from './clip-geom.js';
import { categoryOf, classify, overlapKey, naturalPair, explicitAllow, GROUND_LAYER, THIN } from './clip-rules.js';
import { setCharacterView } from '../art/humanoid-real.js';
import { liftAt } from '../world/placement.js';
import { T } from '../world/grid.js';
import { isSolidHull, hullsNear, dynamicObstacles } from '../world/body-clearance.js';
import { SNOW_WADE, snowTris } from '../world/placement-visual.js';

const SKIP_NAME = /shadow|proxy|collider|collision|occluder|decal|selection|select_ring|ring_sel|vision|cone|marker|halo|glow|blob|water|impostor/i;

function meshOk(o) {
  if (o.userData?.clip === false || o.userData?.noClip) return false;
  if (SKIP_NAME.test(o.name || '')) return false;
  const mats = [].concat(o.material || []);
  if (!mats.length || mats.every((m) => m.visible === false || m.colorWrite === false)) return false;
  return true;
}

const _im = new THREE.Matrix4(), _mw = new THREE.Matrix4();

const WADED = new WeakMap(); // geometry → Map(height key → BVH record without its wadeable snow, or null)
/**
 * BVH record of a snow-covered mesh (the `_snow` library variants' drifts) without the snow lower than `wade` m over
 * `base` (world y of the structure's ground): a man wades through that snow or walks over it (world/placement-visual
 * SNOW_WADE), so feet, knees and wheels in it are no clipping; snow triangles crossing the wading depth are cut there.
 * Undefined when the mesh has no snow (use its own BVH); null when nothing is left.
 */
function wadedBVH(n, m, base, wade) {
  const snow = snowTris(n);
  if (!snow) return undefined;
  const e = m.elements, geo = n.geometry;
  const key = `${e[1].toFixed(4)},${e[5].toFixed(4)},${e[9].toFixed(4)},${(e[13] - base).toFixed(3)},${wade}`;
  let per = WADED.get(geo);
  if (!per) WADED.set(geo, (per = new Map()));
  if (per.has(key)) return per.get(key);
  const pos = geo.attributes.position, idx = geo.index, count = idx ? idx.count : pos.count;
  const h = (v) => e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13] - base - wade; // height over the wading depth (affine)
  const out = [], P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const push = (...vs) => { for (const v of vs) out.push(v.x, v.y, v.z); };
  for (let t = 0; t + 2 < count; t += 3) {
    for (let q = 0; q < 3; q++) P[q].fromBufferAttribute(pos, idx ? idx.getX(t + q) : t + q);
    if (!snow(t)) { push(...P); continue; }
    // the part of the triangle above the wading depth (Sutherland–Hodgman against h ≥ 0, winding kept)
    const poly = [];
    for (let q = 0; q < 3; q++) {
      const a = P[q], b = P[(q + 1) % 3], ha = h(a), hb = h(b);
      if (ha >= 0) poly.push(a.clone());
      if ((ha >= 0) !== (hb >= 0)) poly.push(a.clone().lerp(b, ha / (ha - hb)));
    }
    for (let q = 1; q + 1 < poly.length; q++) push(poly[0], poly[q], poly[q + 1]);
  }
  let rec = null;
  if (out.length >= 9) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    rec = geometryBVH(g);
  }
  per.set(key, rec);
  return rec;
}

/**
 * Mesh parts of a subtree (LOD0 of library assets, visible meshes only; skinned/morphed meshes posed).
 * @param {THREE.Object3D} root @param {{instance?: number, wade?: number}} [o] instance: only that InstancedMesh
 *   instance; wade: leave out snow lower than this over the structure's ground (`root`'s, an instance's own)
 */
export function partsOf(root, o = {}) {
  const parts = [];
  const rootY = root.matrixWorld.elements[13]; // (collectStatic has updated the scene's matrices)
  const visit = (n) => {
    if (n.userData?.clip === false) return;
    if (/^lod[12]$/.test(n.name) && n.parent?.children.some((c) => c.name === 'lod0')) return;
    if (!n.visible && n.name !== 'lod0') return;
    if (n.isMesh && meshOk(n)) {
      if (n.isInstancedMesh) {
        const rec0 = geometryBVH(n.geometry);
        const ks = o.instance != null ? [o.instance] : Array.from({ length: n.count }, (_, k) => k);
        for (const k of ks) {
          if (!rec0 || k >= n.count) continue;
          n.getMatrixAt(k, _im);
          _mw.multiplyMatrices(n.matrixWorld, _im);
          const w = o.wade ? wadedBVH(n, _mw, _mw.elements[13], o.wade) : undefined; // (an instance stands on its own ground)
          const rec = w === undefined ? rec0 : w;
          if (rec) parts.push(makePart(rec, _mw, { name: n.name }));
        }
      } else {
        const posed = n.isSkinnedMesh || (n.morphTargetInfluences?.length > 0);
        const w = !posed && o.wade ? wadedBVH(n, n.matrixWorld, rootY, o.wade) : undefined;
        const rec = w !== undefined ? w : posed ? posedBVH(n) : geometryBVH(n.geometry);
        if (rec) parts.push(makePart(rec, n.matrixWorld, { name: n.name }));
      }
    }
    for (const c of n.children) visit(c);
  };
  visit(root);
  return parts;
}

function attached(o, scene) {
  for (let p = o; p; p = p.parent) if (p === scene) return true;
  return false;
}

function mkItem(base, parts) {
  if (!parts.length) return null;
  return { ...base, parts, box: itemBox(parts) };
}

/** Static items of the loaded mission. @param {{clutter?: boolean}} [o] */
export function collectStatic(game, o = {}) {
  const w = game.world, scene = game.renderer.scene;
  scene.updateMatrixWorld(true);
  const items = [], seen = new Set();
  const detached = [];
  for (const [key, s] of w.structures || []) {
    if (!s.object3d || s.def?.clip === false) continue;
    const cat = categoryOf(s.type, s.def);
    if (GROUND_LAYER.has(cat)) continue;
    if (!attached(s.object3d, scene)) { detached.push({ key, s, cat }); continue; }
    seen.add(s.object3d);
    // (snow drifts lower than SNOW_WADE are waded through, as in the nav: not a solid a body or a wheel may clip)
    const it = mkItem({ id: String(s.def?.id ?? key), type: s.type, cat, def: s.def, kind: 'structure' }, partsOf(s.object3d, { wade: SNOW_WADE }));
    if (it) items.push(it);
  }
  // instanced repeats (map-builder batchLibraryRepeats): one item per instance, matched back to its structure
  scene.traverse((g) => {
    if (!/^buildings:/.test(g.name)) return;
    const asset = g.name.slice(10), lod0 = g.children.find((c) => c.name === 'lod0');
    const first = lod0 && (() => { let m = null; lod0.traverse((n) => { if (!m && n.isInstancedMesh) m = n; }); return m; })();
    if (!first) return;
    const cands = detached.filter((d) => d.s.object3d.userData?.libraryAsset === asset);
    const pos = new THREE.Vector3();
    for (let k = 0; k < first.count; k++) {
      first.getMatrixAt(k, _im); pos.setFromMatrixPosition(_mw.multiplyMatrices(first.matrixWorld, _im));
      let best = null, bd = Infinity;
      for (const d of cands) {
        const dd = Math.hypot((d.s.def.x ?? 0) - pos.x, (d.s.def.z ?? 0) - pos.z);
        if (dd < bd) { bd = dd; best = d; }
      }
      const base = best && bd < 12
        ? { id: String(best.s.def?.id ?? best.key), type: best.s.type, cat: best.cat, def: best.s.def }
        : { id: `${asset}#${k}`, type: asset, cat: categoryOf(asset) };
      if (best && bd < 12) cands.splice(cands.indexOf(best), 1);
      const it = mkItem({ ...base, kind: 'instance' }, partsOf(lod0, { instance: k, wade: SNOW_WADE }));
      if (it) items.push(it);
    }
  });
  // vegetation chunks (terrain vegetation system): trunks and foliage cards, named after the chunk centre
  const veg = scene.getObjectByName('vegetationB');
  veg?.traverse((n) => {
    if (!n.isMesh || n.isInstancedMesh || !/^veg(Bark|Leaves)$/.test(n.name)) return;
    const cat = n.name === 'vegBark' ? 'trunk' : 'foliage';
    const parts = partsOf(n);
    const c = parts.length ? itemBox(parts).getCenter(new THREE.Vector3()) : null;
    const it = c && mkItem({ id: `${cat}@${Math.round(c.x)}_${Math.round(c.z)}`, type: n.name, cat, kind: 'vegetation' }, parts);
    if (it) items.push(it);
  });
  if (o.clutter) {
    scene.getObjectByName('grassB')?.traverse((n) => {
      if (!n.isInstancedMesh || n.name !== 'clutterStones') return;
      for (let k = 0; k < n.count; k++) {
        const it = mkItem({ id: `stone#${k}`, type: 'clutterStone', cat: 'clutter', kind: 'clutter' }, partsOf(n, { instance: k }));
        if (it) items.push(it);
      }
    });
  }
  // interactable props (pickups, drums, crates) not already drawn by a structure
  for (const e of w.entities) {
    if (e.kind !== 'interactable' || !e.object3d || seen.has(e.object3d) || !attached(e.object3d, scene)) continue;
    if (e.interactKind === 'extraction') continue;
    const type = e.interactKind || 'interactable';
    // (a prop the mission stands on a raised deck, e.g. M15's uniform rack on balcony B: `visualY` = its explicit height)
    const def = e.params?.visualY != null ? { y: e.params.visualY } : undefined;
    const it = mkItem({ id: String(e.tag ?? `${type}#${e.id}`), type, cat: categoryOf(type), kind: 'interactable', def }, partsOf(e.object3d));
    if (it) items.push(it);
  }
  return items;
}

/** Unit states whose body is intentionally inside/against something (driving, hidden, buried, swimming…). */
export const SKIP_UNIT = (u) => !!(u.vehicle || u.state === 'inVehicle' || u.hidden || u.buried || u.underwater || u.held || u.object3d?.visible === false);

/** Dynamic items: vehicles (hull + turret) and characters (posed), alive or dead. */
export function collectDynamic(game, o = {}) {
  const w = game.world, scene = game.renderer.scene, out = [];
  for (const e of w.entities) {
    if (!e.object3d || !attached(e.object3d, scene)) continue;
    if (o.near && !o.near(e)) continue; // cheap broad phase before posing a skinned body
    if (e.kind === 'vehicle' && o.vehicles !== false) {
      if (e.object3d.visible === false) continue;
      const cat = e.vehicleKind === 'emplacement' ? 'emplacement' : 'vehicle';
      const it = mkItem({ id: String(e.tag ?? `${e.vehicleType}#${e.id}`), type: e.vehicleType, cat, kind: 'vehicle', entity: e }, partsOf(e.object3d));
      if (it) out.push(it);
    } else if ((e.kind === 'commando' || e.kind === 'enemy' || e.kind === 'unit' || e.kind === 'animal') && o.units !== false) {
      if (SKIP_UNIT(e)) continue;
      const it = mkItem({ id: String(e.tag ?? `${e.kind}#${e.id}`), type: e.role || e.soldierType || e.kind, cat: 'character', kind: e.kind, entity: e,
        state: e.alive === false ? 'dead' : e.state }, partsOf(e.object3d));
      if (it) out.push(it);
    }
  }
  return out;
}

/** XZ spatial hash of item boxes for the broad phase. */
export class ItemGrid {
  constructor(items, cell = 8) {
    this.cell = cell; this.map = new Map(); this.items = items;
    items.forEach((it, i) => this._cells(it.box, (k) => { let a = this.map.get(k); if (!a) this.map.set(k, a = []); a.push(i); }));
  }
  _cells(b, fn) {
    const c = this.cell;
    for (let i = Math.floor(b.min.x / c); i <= Math.floor(b.max.x / c); i++)
      for (let j = Math.floor(b.min.z / c); j <= Math.floor(b.max.z / c); j++) fn(`${i},${j}`);
  }
  /** Indices of items whose boxes overlap `box`. */
  query(box) {
    const out = new Set();
    this._cells(box, (k) => { for (const i of this.map.get(k) || []) if (this.items[i].box.intersectsBox(box)) out.add(i); });
    return [...out];
  }
  /** Unordered candidate pairs [i, j] (i < j) with overlapping boxes. */
  pairs() {
    const seen = new Set(), out = [];
    for (const list of this.map.values()) for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const i = Math.min(list[a], list[b]), j = Math.max(list[a], list[b]), k = i * 1e6 + j;
      if (seen.has(k)) continue;
      seen.add(k);
      if (this.items[i].box.intersectsBox(this.items[j].box)) out.push([i, j]);
    }
    return out;
  }
}

const brief = (it) => ({ id: it.id, type: it.type, cat: it.cat, kind: it.kind, ...(it.state ? { state: it.state } : {}) });

/** Nearest tree structure id to a point (vegetation chunks report the tree they belong to). */
function nearestTree(game, p) {
  let best = null, bd = 4;
  for (const [key, s] of game.world.structures || []) {
    if (categoryOf(s.type, s.def) !== 'tree') continue;
    const d = Math.hypot((s.def.x ?? 0) - p.x, (s.def.z ?? 0) - p.z);
    if (d < bd) { bd = d; best = String(s.def.id ?? key); }
  }
  return best;
}

/** A character crewing / operating / riding a vehicle or gun (intended contact with it). */
export function crewOf(veh, unit) {
  if (!veh || !unit) return false;
  if (veh.tag != null && (veh.spawn?.gunner === unit.tag || unit.spawn?.emplacement === veh.tag || unit.spawn?.vehicle === veh.tag)) return true;
  return unit.vehicle === veh || veh.driver === unit || veh.operator === unit || !!veh.occupants?.includes(unit) || unit.operating === veh || unit.gun === veh
    || !!veh.crew?.some((c) => c.ref != null && (c.ref === unit.tag || c.ref === unit.id || c.ref === unit.spawnId));
}

/** Measure + classify one pair → finding or null. */
function judge(game, mission, A, B, o = {}) {
  if (A === B || (A.entity && A.entity === B.entity)) return null;
  if (A.entity && B.entity && (crewOf(A.entity, B.entity) || crewOf(B.entity, A.entity))) return null;
  if (!o.measureAllowed && (naturalPair(A.cat, B.cat) || explicitAllow(A, B))) return null;
  const m = measurePair(A, B, { thinA: THIN.has(A.cat), thinB: THIN.has(B.cat), maxDepth: o.maxDepth ?? 1.5 });
  if (!m) return null;
  const c = classify(A, B, m, { minDepth: o.minDepth ?? 0.02 });
  const a = brief(A), b = brief(B);
  for (const [x, X] of [[a, A], [b, B]]) if (X.kind === 'vegetation') { const t = nearestTree(game, m.point); if (t) { x.tree = t; x.id = `${t}~${X.cat}`; } }
  return { key: overlapKey(mission, a, b), a, b, ...m, allowed: c.allowed, reason: c.reason };
}

/**
 * Static audit of the loaded mission: every static item pair (and parked vehicles / spawned characters when
 * `entities`) → findings sorted by depth. @param {{clutter?:boolean, entities?:boolean, measureAllowed?:boolean}} [o]
 */
export function staticAudit(game, o = {}) {
  const t0 = performance.now();
  const mission = game.missionDef?.id ?? '?';
  refreshPoses(game);
  const items = collectStatic(game, o);
  const dyn = o.entities === false ? [] : collectDynamic(game, o);
  const all = [...items, ...dyn];
  const grid = new ItemGrid(all);
  const findings = [];
  let tested = 0;
  for (const [i, j] of grid.pairs()) {
    const A = all[i], B = all[j];
    if (A.kind !== 'structure' && A.kind !== 'instance' && A.kind === B.kind && A.kind !== 'interactable') {
      if (A.kind === 'vegetation' || A.kind === 'clutter') continue; // chunk/chunk and stone/stone
    }
    tested++;
    const f = judge(game, mission, A, B, o);
    if (f) findings.push(f);
  }
  findings.sort((x, y) => (x.allowed - y.allowed) || (y.depth - x.depth) || (y.contact - x.contact));
  const cats = {};
  for (const it of all) cats[it.cat] = (cats[it.cat] || 0) + 1;
  return { mission, items: all.length, categories: cats, pairsTested: tested, ms: Math.round(performance.now() - t0), findings };
}

/** Pose every character at LOD0 without frustum throttling and refresh world matrices (dt: animation step). */
export function refreshPoses(game, dt = 0) {
  const w = game.world;
  if (!w) return;
  try { setCharacterView({ camera: false, pxPerMetre: 400 }); } catch { /* library absent: placeholders */ }
  for (const e of w.entities) { e.syncTransform?.(1); e.renderUpdate?.(Math.max(dt, 1e-3)); } // dt>0: the model re-applies visibility
  const scene = game.renderer.scene;
  scene.updateMatrixWorld(true);
  for (const e of w.entities) e.object3d?.updateMatrixWorld?.(true);
}

/** Keep the worst finding per key (plus first time, count, worst time/angle). */
function keepWorst(map, f, extra = {}) {
  const prev = map.get(f.key);
  if (!prev) { map.set(f.key, { ...f, ...extra, firstT: extra.t ?? null, count: 1 }); return; }
  prev.count++;
  if (f.depth > prev.depth || (f.depth === prev.depth && f.contact > prev.contact)) Object.assign(prev, f, extra, { firstT: prev.firstT, count: prev.count });
}

/**
 * Turret / gun traverse audit: every vehicle or emplacement with a turret node sweeps its arc (`giro` around the
 * post heading for emplacements, else 360°) in `step`° increments against the static items.
 */
export function turretSweep(game, o = {}) {
  const mission = game.missionDef?.id ?? '?';
  const statics = o.statics || collectStatic(game, o);
  const grid = new ItemGrid(statics);
  const step = ((o.step ?? 10) * Math.PI) / 180, found = new Map();
  let turrets = 0;
  for (const e of o.only ? [o.only] : game.world.entities) {
    const tur = e.kind === 'vehicle' && !e.destroyed && e.model?.turret;
    if (!tur || !e.model.setTurretHeading) continue;
    turrets++;
    const g = e.giro != null ? (e.giro * Math.PI) / 180 : 2 * Math.PI;
    const from = e.giro != null ? e.postHeading - g / 2 : 0, n = Math.max(1, Math.round(g / step));
    const saved = e.turretHeading;
    // with the placement rules (default) the sweep only visits the gun's open arc, barrel lifted as in play;
    // `raw` sweeps everything (detector check)
    const arc = o.raw ? null : e.gunArc?.();
    for (let k = 0; k <= n; k++) {
      const a = from + (g * k) / n;
      const lift = arc ? liftAt(arc, a) : 0;
      if (lift === Infinity) continue;
      e.model.setGunLift?.(lift);
      e.model.setTurretHeading(a - e.heading);
      e.object3d.updateMatrixWorld(true);
      const T = mkItem({ id: `${e.tag ?? `${e.vehicleType}#${e.id}`}:turret`, type: e.vehicleType, cat: 'turret', kind: 'turret', entity: e }, partsOf(tur));
      if (!T) continue;
      for (const i of grid.query(T.box)) {
        const f = judge(game, mission, T, statics[i], { minDepth: o.minDepth ?? 0.05 });
        if (f && !f.allowed) keepWorst(found, f, { angleDeg: Math.round((((a * 180) / Math.PI) % 360 + 360) % 360) });
      }
    }
    e.model.setTurretHeading(saved - e.heading);
    e.model.setGunLift?.(arc ? liftAt(arc, saved) : 0);
    e.object3d.updateMatrixWorld(true);
  }
  return { mission, turrets, findings: [...found.values()].sort((x, y) => y.depth - x.depth) };
}

const PROBE_NEAR = new Set(['wall', 'fence', 'gate', 'building', 'tower', 'tent', 'ruins', 'pole', 'sandbags']);
/**
 * Turret probe (content the missions don't have yet: tanks next to cabins, armoured cars along a fence): each
 * probe vehicle type is parked where it could really drive (the whole hull passable, Vehicle.passableAt: nav
 * blocks, visual blocks, overhead eaves) as close as possible beside every wall / fence / building side, and its
 * gun swept over its open arc (turretSweep). o: {types = ['panzer2', 'sdkfz'], maxSpots = 60, gap = 4 m}
 * @returns {{spots: number, tests: number, findings: object[]}}
 */
export function turretProbe(game, o = {}) {
  const w = game.world, types = o.types || ['panzer2', 'sdkfz'];
  const statics = collectStatic(game, { clutter: false });
  const spots = [];
  for (const it of statics) {
    if (!PROBE_NEAR.has(it.cat)) continue;
    const b = it.box, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const along = nx ? b.max.z - b.min.z : b.max.x - b.min.x, k = Math.max(1, Math.round(along / (o.gap ?? 4)));
      for (let q = 0; q < k; q++) {
        const t = (q + 0.5) / k - 0.5;
        const x = nx ? (nx > 0 ? b.max.x : b.min.x) : cx + t * along, z = nz ? (nz > 0 ? b.max.z : b.min.z) : cz + t * along;
        spots.push({ near: it.id, x, z, nx, nz });
      }
    }
  }
  const pick = spots.length > (o.maxSpots ?? 60) ? spots.filter((_, i) => i % Math.ceil(spots.length / (o.maxSpots ?? 60)) === 0) : spots;
  const found = new Map();
  let tests = 0;
  for (const type of types) {
    let v;
    try { v = w.spawnVehicle(type, { x: pick[0]?.x ?? 1, z: pick[0]?.z ?? 1, heading: 0 }); } catch { continue; }
    const [L, W] = v.def.size;
    const hullOK = (x, z, h) => {
      const c = Math.cos(h), s = Math.sin(h);
      const nu = Math.ceil(L / 0.4), nq = Math.ceil(W / 0.4); // ≤ 0.4 m apart: no post slips between samples
      for (let a = 0; a <= nu; a++) for (let b = 0; b <= nq; b++) {
        const u = a / nu - 0.5, q = b / nq - 0.5;
        if (!v.passableAt(x + c * u * L - s * q * W, z + s * u * L + c * q * W)) return false;
      }
      return true;
    };
    for (const sp of pick) {
      const h = sp.nx ? Math.PI / 2 : 0; // hull parallel to that side
      let at = null;
      for (let d = W / 2 + 0.2; d <= W / 2 + 4; d += 0.25) {
        const x = sp.x + sp.nx * d, z = sp.z + sp.nz * d;
        if (hullOK(x, z, h)) { at = { x, z }; break; }
      }
      if (!at) continue;
      v.x = at.x; v.z = at.z; v.heading = h; v.turretHeading = h; v._arcKey = null; v._turretKeep = null;
      v.syncTransform?.(1); v.object3d?.updateMatrixWorld(true);
      tests++;
      const r = turretSweep(game, { statics, only: v, step: o.step ?? 10 });
      for (const f of r.findings) keepWorst(found, { ...f, key: `${f.key}@${sp.near}` }, { probe: type, near: sp.near, at: { x: +at.x.toFixed(2), z: +at.z.toFixed(2) } });
    }
    w.remove(v);
  }
  return { spots: pick.length, tests, findings: [...found.values()].sort((x, y) => y.depth - x.depth) };
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Classification aid for a dynamic finding: the entity's pose / path / nav context at its worst moment. */
function diagOf(game, e) {
  const g = game.world.grid, r2 = (v) => (v == null || !Number.isFinite(v) ? v : Math.round(v * 100) / 100);
  const d = { y: r2(e.object3d?.position.y ?? e.y), elev: r2(g.elevAt?.(e.x, e.z)), heading: Math.round((e.heading ?? 0) * 180 / Math.PI),
    stance: e.stance, anim: e._anim ?? null, moving: !!e.path, alive: e.alive !== false };
  if (e.path) { const wp = e.path[e.pathIndex]; d.wp = wp ? [r2(wp.x), r2(wp.z)] : null; d.goal = e.moveTarget ? [r2(e.moveTarget.x), r2(e.moveTarget.z)] : null; }
  const i = Math.floor(e.x / g.cell), j = Math.floor(e.z / g.cell);
  if (i >= 0 && j >= 0 && i < g.cols && j < g.rows) { const k = j * g.cols + i; d.cell = { block: g.block[k], nav: g.navBlock[k], walk: g.isWalkable?.(i, j) }; }
  return d;
}

const WALLISH = new Set(['building', 'wall', 'fence', 'gate', 'tower', 'pole', 'tent', 'prop', 'sandbags', 'ruins', 'bridge', 'pier', 'vehicle']);

/**
 * Dynamic audit, in chunks so each page.evaluate stays short:
 *   begin(o) → run(seconds) … → end() → {findings, samples, t}
 * o: {sample = 0.5 s, moveEvery = 12 s, killAt = [60, 120] s, seed, minDepth = 0.05, unitGap = 0.6 m}
 * end() also lists unit-vs-unit overlaps (`unitOverlaps`, standing men closer than unitGap, worst per pair).
 */
export function dynamicAudit(game) {
  const S = { hits: [], t: 0, samples: 0, found: new Map(), units: new Map(), statics: null, grid: null, o: null, r: null, nextMove: 0, kills: [], notes: [] };
  const w = () => game.world;
  const moveCommandos = () => {
    const targets = S.statics.filter((it) => WALLISH.has(it.cat));
    // every solid a body must keep out of (world/body-clearance.js): vehicle hulls and wrecks, drums, pushables,
    // crates, fuel tanks, rocks, plane / boat props
    const hulls = [...dynamicObstacles(w()), ...(w().bodySolids?.list || []).filter((o) => !o.gone).map((o) => o.R)];
    if (!targets.length && !hulls.length) return;
    for (const c of w().commandos) {
      if (!c.alive || c.vehicle || c.state === 'inVehicle') continue;
      // half the moves (all without walls): stand / crouch / crawl to a spot at, under or across a solid
      if (hulls.length && (!targets.length || S.r() < 0.5)) {
        const R = hulls[Math.floor(S.r() * hulls.length)], a = S.r() * 2 * Math.PI, rr = S.r() * 1.2;
        const lx = Math.cos(a) * ((R.r ?? R.hl) + rr), lz = Math.sin(a) * ((R.r ?? R.hw) + rr), ch = Math.cos(R.h || 0), sh = Math.sin(R.h || 0);
        c.setStance?.(['stand', 'crouch', 'crawl'][Math.floor(S.r() * 3)]);
        c.issue?.({ type: 'move', x: R.x + lx * ch - lz * sh, z: R.z + lx * sh + lz * ch, run: S.r() < 0.3 });
        continue;
      }
      if (!targets.length) continue;
      for (let tries = 0; tries < 5; tries++) {
        const it = targets[Math.floor(S.r() * targets.length)], b = it.box;
        const side = Math.floor(S.r() * 4), u = S.r(), pad = 0.35;
        const x = side === 0 ? b.min.x - pad : side === 1 ? b.max.x + pad : b.min.x + u * (b.max.x - b.min.x);
        const z = side === 2 ? b.min.z - pad : side === 3 ? b.max.z + pad : b.min.z + u * (b.max.z - b.min.z);
        if (c.issue?.({ type: 'move', x, z, run: S.r() < 0.4 })) break;
      }
    }
  };
  const killNearWalls = () => {
    const walls = S.statics.filter((it) => it.cat === 'wall' || it.cat === 'building' || it.cat === 'fence');
    const cand = w().enemies.filter((e) => e.alive && !e.vehicle).map((e) => {
      let d = Infinity;
      for (const it of walls) d = Math.min(d, Math.max(it.box.min.x - e.x, 0, e.x - it.box.max.x) + Math.max(it.box.min.z - e.z, 0, e.z - it.box.max.z));
      return { e, d };
    }).filter((c) => c.d < 2.5).sort((a, b) => a.d - b.d).slice(0, 2);
    for (const { e } of cand) { e.die?.('audit', null); S.kills.push({ id: e.tag ?? e.id, t: S.t, x: +e.x.toFixed(2), z: +e.z.toFixed(2) }); }
  };
  const sample = () => {
    refreshPoses(game, S.o.sample);
    const mission = game.missionDef?.id ?? '?';
    const box = new THREE.Box3();
    const near = (e) => { // entity's rough bounds (before posing a skinned body) must touch a static item
      const r = e.kind === 'vehicle' ? Math.max(...(e.def?.size || [6, 3])) * 0.75 + 1 : 1.3, y = e.object3d?.position.y ?? e.y ?? 0;
      box.min.set(e.x - r, y - 1, e.z - r); box.max.set(e.x + r, y + (e.kind === 'vehicle' ? 5 : 2.6), e.z + r);
      return S.grid.query(box).length > 0;
    };
    for (const D of collectDynamic(game, { near })) {
      for (const i of S.grid.query(D.box)) {
        const f = judge(game, mission, D, S.statics[i], { minDepth: S.o.minDepth });
        if (f && !f.allowed && f.depth > S.o.minDepth) {
          const e = D.entity;
          const prev = S.found.get(f.key)?.depth ?? 0;
          keepWorst(S.found, f, { t: +S.t.toFixed(2), at: { x: +e.x.toFixed(2), z: +e.z.toFixed(2) }, unitState: D.state ?? e.state ?? null, speed: +(e.speed ?? 0).toFixed(2),
            diag: diagOf(game, e) });
          if (f.depth > prev * 1.25 + 0.02) S.hits.push({ key: f.key, depth: f.depth, point: f.point, box: f.box, t: +S.t.toFixed(2) });
        }
      }
    }
    // unit vs unit (playtest: "without crossing each other"): two standing men closer than `unitGap` centre to
    // centre are inside each other; worst per pair (dead / downed / carried / swimming men are excluded, as in
    // the avoidance rules)
    const U = [...w().commandos, ...w().enemies].filter((u) => u.alive && !u.removed && !u.buried && !u.underwater
      && !['downed', 'swim', 'dive'].includes(u.stance) && !['dead', 'inVehicle', 'carried', 'jailed', 'hidden'].includes(u.state));
    for (let i = 0; i < U.length; i++) for (let j = i + 1; j < U.length; j++) {
      const a = U[i], b = U[j];
      if (Math.abs((a.y || 0) - (b.y || 0)) > 1) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d >= S.o.unitGap) continue;
      const ka = String(a.tag ?? a.id), kb = String(b.tag ?? b.id), key = `${mission}|unit:${ka < kb ? ka + '|' + kb : kb + '|' + ka}`;
      const f = S.units.get(key);
      if (!f || d < f.dist) S.units.set(key, { key, a: ka, b: kb, dist: +d.toFixed(3), t: +S.t.toFixed(2), at: { x: +a.x.toFixed(2), z: +a.z.toFixed(2) },
        moving: [!!a.path, !!b.path], states: [a.brain?.state ?? a.state, b.brain?.state ?? b.state], n: (f?.n ?? 0) + 1 });
      else f.n++;
    }
    // characters (standing, crouched, lying, dead) against vehicle hulls, mesh against mesh (docs/clipping-audit.md)
    vehicleBodies(game, mission, (f, e) => {
      keepWorst(S.found, f, { t: +S.t.toFixed(2), at: { x: +e.x.toFixed(2), z: +e.z.toFixed(2) }, unitState: e.state ?? null, stance: e.stance ?? null, speed: +(e.speed ?? 0).toFixed(2) });
    }, S.o.minDepth);
    S.samples++;
  };
  return {
    begin(o = {}) {
      S.o = { sample: 0.5, moveEvery: 12, killAt: [60, 120], seed: 7, minDepth: 0.05, unitGap: 0.6, ...o };
      S.r = rng(S.o.seed);
      if (game.state !== 'playing') game.start();
      // the commandos are the audit's actors: shots and blasts must not end the run (instance-level patch, audit only)
      for (const c of game.world.commandos) { c.takeDamage = () => 0; c.die = () => false; }
      S.statics = collectStatic(game, { clutter: false });
      S.grid = new ItemGrid(S.statics);
      return { statics: S.statics.length, state: game.state };
    },
    run(seconds) {
      const end = S.t + seconds;
      while (S.t < end - 1e-6) {
        if (game.state !== 'playing') { S.notes.push(`sim stopped at ${S.t.toFixed(1)} s (state ${game.state}${game.pendingEnd ? ', ' + JSON.stringify(game.pendingEnd).slice(0, 120) : ''})`); break; }
        if (S.t >= S.nextMove) { moveCommandos(); S.nextMove += S.o.moveEvery; }
        while (S.o.killAt.length && S.t >= S.o.killAt[0]) { S.o.killAt.shift(); killNearWalls(); }
        game.advance(S.o.sample);
        S.t += S.o.sample;
        sample();
      }
      const hits = S.hits.splice(0); // findings that got markedly worse in this call (crop candidates)
      return { t: S.t, samples: S.samples, found: S.found.size, state: game.state, hits };
    },
    end() {
      return { mission: game.missionDef?.id ?? '?', t: S.t, samples: S.samples, kills: S.kills, notes: S.notes,
        findings: [...S.found.values()].sort((x, y) => y.depth - x.depth),
        unitOverlaps: [...S.units.values()].sort((x, y) => x.dist - y.dist) };
    },
  };
}

/**
 * Characters against solid vehicle hulls (world/body-clearance.js isSolidHull): every man on foot, alive or dead,
 * whose rough box reaches a hull is posed and measured mesh against mesh; crews and a man run over (he lies where
 * the wheels caught him) are skipped. `report(finding, unit)` gets each unintended overlap deeper than `minDepth`.
 * @returns {number} overlaps reported
 */
export function vehicleBodies(game, mission, report, minDepth = 0.05) {
  const w = game.world;
  if (!(w.vehicles || []).some((v) => isSolidHull(v))) return 0;
  const vehs = collectDynamic(game, { units: false, near: (v) => isSolidHull(v) });
  if (!vehs.length) return 0;
  const men = collectDynamic(game, { vehicles: false, near: (u) => !(u.alive === false && /^(runover|train)$/.test(u.deathCause || ''))
    && hullsNear(w, u.x, u.z, 1.3).length > 0 });
  let n = 0;
  for (const M of men) for (const V of vehs) {
    if (!M.box.intersectsBox(V.box)) continue;
    const f = judge(game, mission, M, V, { minDepth });
    if (f && !f.allowed && f.depth > minDepth) { f.kind = 'body-vehicle'; report(f, M.entity); n++; }
  }
  return n;
}

/**
 * One entity (unit / vehicle, by tag or id) posed now against the static items: its unintended overlaps deeper
 * than `minDepth` (default 0.02 m), worst first. Probes and tests (a body after its death clip, a parked tank).
 */
export function entityAudit(game, tag, o = {}) {
  refreshPoses(game, o.dt ?? 0);
  const mission = game.missionDef?.id ?? '?';
  const e = game.world.entities.find((x) => String(x.tag) === String(tag) || String(x.id) === String(tag));
  if (!e) return { found: false, findings: [] };
  const statics = o.statics || collectStatic(game, { clutter: false }), grid = new ItemGrid(statics), out = [];
  for (const D of collectDynamic(game, { near: (x) => x === e })) {
    for (const i of grid.query(D.box)) {
      const f = judge(game, mission, D, statics[i], { minDepth: o.minDepth ?? 0.02 });
      if (f && !f.allowed && f.depth > (o.minDepth ?? 0.02)) out.push(f);
    }
  }
  return { found: true, x: e.x, z: e.z, heading: e.heading, findings: out.sort((p, q) => q.depth - p.depth) };
}

/**
 * Floating / buried props (placement rule b): structures and interactable props standing on the ground whose
 * flat bottom (the vertices within 4 cm of the lowest) has a point more than `tol` (0.05 m) above the ground right
 * under it (a crate or a well hanging over a dip), or sinks deeper than `bury` (0.5 m) into it.
 * Skips bridges / piers / decks, linear runs, trees, water and anything declared `y` (placed on purpose).
 */
export function floatingAudit(game, o = {}) {
  // the terrain's own surface (world.groundY also carries the props' steps and decks, i.e. the props themselves)
  const tol = o.tol ?? 0.05, bury = o.bury ?? 0.5, w = game.world, gy = w.terrain?.groundY ?? w.groundY, out = [];
  if (typeof gy !== 'function') return { tested: 0, findings: out };
  const ground = (x, z) => gy.call(w.terrain?.groundY ? w.terrain : w, x, z);
  const grid = w.grid, wetNear = (x, z) => { // within 1 m of water / shallows (banks are carved there)
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const t = grid?.terrainAt?.(x + dx, z + dz); if (t === T.WATER || t === T.SHALLOW) return true; }
    return false;
  };
  const SKIPC = new Set(['bridge', 'pier', 'wall', 'fence', 'tree', 'trunk', 'foliage', 'water', 'road', 'cliff', 'flag']);
  let tested = 0;
  for (const it of collectStatic(game, { clutter: false })) {
    const d = it.def || {};
    if ((!it.def && it.kind !== 'interactable') || d.points || d.segments || d.y != null || d.float || SKIPC.has(it.cat) || it.kind === 'vegetation') continue;
    const b = it.box;
    if (b.max.x - b.min.x > 14 || b.max.z - b.min.z > 14) continue; // large buildings sit on a levelled pad
    // the visual's flat bottom (vertices within 4 cm of the lowest): the worst gap between it and the ground
    // right under it (the downhill corner hanging over a slope) and the deepest point buried under a bump
    let lo = Infinity;
    for (const p of it.parts) {
      const pos = p.geo.attributes.position;
      for (let i = 0; i < pos.count; i++) { _v.fromBufferAttribute(pos, i).applyMatrix4(p.matrix); if (_v.y < lo) lo = _v.y; }
    }
    if (!Number.isFinite(lo)) continue;
    tested++;
    let gap = -Infinity, sunk = -Infinity, gx = 0, gz = 0;
    for (const p of it.parts) {
      const pos = p.geo.attributes.position, stepV = Math.max(1, Math.floor(pos.count / 6000));
      for (let i = 0; i < pos.count; i += stepV) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(p.matrix);
        if (_v.y > lo + 0.04 || wetNear(_v.x, _v.z)) continue; // the flat bottom; over water / a carved bank: intended
        const g = ground(_v.x, _v.z);
        if (_v.y - g > gap) { gap = _v.y - g; gx = _v.x; gz = _v.z; }
        if (g - _v.y > sunk) sunk = g - _v.y;
      }
    }
    const r3 = (v) => Math.round(v * 1000) / 1000;
    if (gap > tol) out.push({ id: it.id, type: it.type, cat: it.cat, kind: 'floating', gap: r3(gap), x: r3(gx), z: r3(gz) });
    else if (sunk > bury) out.push({ id: it.id, type: it.type, cat: it.cat, kind: 'buried', gap: r3(sunk), x: r3(gx), z: r3(gz) });
  }
  return { tested, findings: out.sort((p, q) => q.gap - p.gap) };
}

/** Counts of findings by "catA/catB" pair (unintended only unless `all`). */
export function countByCategory(findings, all = false) {
  const out = {};
  for (const f of findings) {
    if (f.allowed && !all) continue;
    const k = [f.a.cat, f.b.cat].sort().join('/');
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/**
 * Test-mode API (window.__game.clip): JSON-safe results for tools/audit/clipping.mjs and tests/clipping.test.mjs.
 * @param {import('../game.js').Game} game
 */
export function createClipApi(game) {
  const markers = [];
  let dyn = null;
  const strip = (r) => JSON.parse(JSON.stringify(r));
  return {
    static: (o = {}) => strip(staticAudit(game, o)),
    turrets: (o = {}) => strip(turretSweep(game, o)),
    dynamicBegin(o = {}) { dyn = dynamicAudit(game); return dyn.begin(o); },
    dynamicRun: (s = 10) => dyn.run(s),
    dynamicEnd() { const r = strip(dyn.end()); dyn = null; return r; },
    countByCategory,
    /** Characters × vehicle hulls posed now (mesh vs mesh): unintended overlaps deeper than minDepth, worst first. */
    vehicleBodies(o = {}) {
      refreshPoses(game, o.dt ?? 0);
      const out = [];
      vehicleBodies(game, game.missionDef?.id ?? '?', (f, e) => out.push({ ...f, unit: String(e.tag ?? e.id), stance: e.stance, alive: e.alive }), o.minDepth ?? 0.02);
      return strip(out.sort((a, b) => b.depth - a.depth));
    },
    fit: (o = {}) => fitReport(game, o),
    entity: (tag, o = {}) => strip(entityAudit(game, tag, o)),
    floating: (o = {}) => strip(floatingAudit(game, o)),
    turretProbe: (o = {}) => strip(turretProbe(game, o)),
    /** Red wire box around a finding (for crops); returns the marker count. */
    mark(box, color = 0xff2020) {
      const b = new THREE.Box3(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max)).expandByScalar(0.08);
      const h = new THREE.Box3Helper(b, color);
      h.material.depthTest = false; h.material.transparent = true; h.renderOrder = 999;
      game.renderer.scene.add(h); markers.push(h);
      return markers.length;
    },
    /** Render at 2× zoom centred on `p` and return a JPEG data URL of the canvas centre (w × h CSS px; HUD excluded). */
    snap(p, w = 640, h = 400, quality = 0.72) {
      const api = window.__game;
      api.setZoom(2); api.centerOn(p.x, p.z); game.render(0, 1);
      const src = game.renderer.renderer.domElement, k = src.width / src.clientWidth;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(src, (src.width - w * k) / 2, (src.height - h * k) / 2 - 20 * k, w * k, h * k, 0, 0, w, h);
      return c.toDataURL('image/jpeg', quality);
    },
    clearMarks() { for (const h of markers.splice(0)) { h.removeFromParent(); h.geometry.dispose(); h.material.dispose(); } },
  };
}

const _v = new THREE.Vector3();
/**
 * Visual fit vs gameplay footprint (rule c): per structure item with a rect/circle footprint (`w × d` or `r`), the
 * visual's extents in the structure's own frame (x along rot, z across), split into `base` (vertices below
 * `baseY` m: walls, legs, plinths) and `full` (eaves, roofs, flags). Overhang = max extent beyond the footprint
 * half-size (m, ≥ 0 means the visual sticks out).
 * @returns {{id:string, type:string, cat:string, w:number, d:number, base:number, full:number, sides:number[]}[]}
 */
export function fitReport(game, o = {}) {
  const baseY = o.baseY ?? 1.0;
  const out = [];
  for (const it of collectStatic(game)) {
    const d = it.def;
    if (!d || d.x == null || d.points || d.segments) continue;
    const w = d.w ?? (d.r != null ? d.r * 2 : null), dd = d.d ?? (d.r != null ? d.r * 2 : null);
    if (!w || !dd) continue;
    const c = Math.cos(d.rot ?? 0), s = Math.sin(d.rot ?? 0), gy = d.y ?? 0;
    const ext = { base: [0, 0, 0, 0], full: [0, 0, 0, 0] }; // -x +x -z +z beyond the half sizes
    for (const p of it.parts) {
      const pos = p.geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(p.matrix);
        const dx = _v.x - d.x, dz = _v.z - d.z;
        const lx = dx * c + dz * s, lz = -dx * s + dz * c; // world → structure frame (rot about +y, x→z positive)
        const o4 = [-lx - w / 2, lx - w / 2, -lz - dd / 2, lz - dd / 2];
        for (let k = 0; k < 4; k++) {
          if (o4[k] > ext.full[k]) ext.full[k] = o4[k];
          if (_v.y - gy < baseY && o4[k] > ext.base[k]) ext.base[k] = o4[k];
        }
      }
    }
    const r2 = (v) => Math.round(v * 100) / 100;
    out.push({ id: it.id, type: it.type, cat: it.cat, w, d: dd, base: r2(Math.max(...ext.base)), full: r2(Math.max(...ext.full)), sides: ext.full.map(r2), baseSides: ext.base.map(r2) });
  }
  return out;
}
