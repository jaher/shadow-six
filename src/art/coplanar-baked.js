/**
 * Baked coplanar separation for library buildings, applied to ONE placed instance (user 2026-11-18: "Make sure there is
 * no z-fighting in the geometry"; tools/art/zfight.mjs).
 *
 * art/coplanar-split.js separates a GLB's coplanar overlapping faces at load — on the main thread, every LOD, and for
 * every mission that places the asset (it runs on the shared template). For a heavy asset (a half-timbered house: 0.8 s
 * for its LOD0) that froze the loading screen for seconds, and it changed the asset for the base missions too. So the
 * same separation is worked out OFFLINE (tools/art/bake-coplanar.mjs: the asset's LODs loaded in node with the load's
 * own fixups, then art/coplanar-split.js's passes) and stored as a PLAN per asset — for every LOD, which triangles of
 * which mesh move by how much (assets/models/buildings/coplanar/<asset>.json) — and a mission opts its own instances in:
 * applyBakedCoplanar(world, [{id, asset}]) clones the moved meshes' geometries of those instances only (every LOD,
 * now and as later LODs attach) and moves the triangles: a few milliseconds, the template and every other mission's
 * copy untouched.
 *
 * Each LOD's plan carries a fingerprint of the geometry it was baked on (mesh names, index and vertex counts, a hash of
 * the raw positions): a rebuilt GLB no longer matches and its plan is skipped (with a warning) rather than moving the
 * wrong triangles; tests/unit/coplanar-baked.test.mjs fails until it is baked again.
 *
 * Render only: the moved faces are the drawn ones; gameplay measured the authored geometry when the map was built.
 * A building's depth-pass proxy (engine/depth-merge.js) sees the swapped geometry and falls back to the members' own
 * draws in those passes — exactly the unmerged behaviour.
 * @module art/coplanar-baked
 */
import * as THREE from 'three';
import { liftTriangles } from './coplanar-split.js';
import { remergeDepthGroup } from '../engine/depth-merge.js';

/** Offsets are stored in units of 0.1 mm (integers). */
export const PLAN_UNIT = 1e-4;

/**
 * The bake's options per asset (tools/art/bake-coplanar.mjs reads them): `stages`, run in order, each
 * art/coplanar-split.js separateCoplanar options plus `only` (a material-name pattern: the pass sees only meshes with
 * such a material — the snow's doubled layers among themselves first) and `fixedRx` (a material-name pattern that
 * never moves: what lies flush with it goes under it — the snow look is frozen).
 */
const SNOW_TWIN = [
  { only: '^kit:snow', gap: 0.005, crossings: true, reach: 0.006 },
  { only: '^kit:snow', pieces: true, lift: 0.003, near: 0.002, reach: 0.01 },
  { fixedRx: '^kit:snow', gap: 0.004, crossings: true, reach: 0.02 },
];
export const BAKE_OPTS = {
  // (LIGHTS OUT e06's harbour village: the brick church, the half-timbered houses — formerly COPLANAR_SPLIT at load)
  church_village_b: { stages: [{}] },
  house_halftimber_a: { stages: [{ crossings: true, reach: 0.06 }] },
  house_halftimber_c: { stages: [{ crossings: true, reach: 0.06 }] },
  house_halftimber_e: { stages: [{ crossings: true, reach: 0.06 }] },
  // the snow twins (net sheds, the naval barracks): doubled snow layers set apart among themselves, then two caps
  // sculpted on one sill (each its own piece of the merged snow mesh, their tops within a mm or two) set a few mm apart
  // whole, then every other part flush with the snow goes under it (the snow stays where the sculptor laid it, to
  // millimetres); doubled roof / board faces apart
  fishing_shed_a_snow: { stages: SNOW_TWIN },
  fishing_shed_b_snow: { stages: SNOW_TWIN },
  barracks_a_snow: { stages: SNOW_TWIN },
};

/** The meshes of a LOD scene in traversal order, each with its key (name and occurrence) — the plan's addresses. */
export function planMeshes(root) {
  const seen = new Map(), out = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.geometry?.getAttribute('position')) return;
    const n = seen.get(o.name) || 0;
    seen.set(o.name, n + 1);
    out.push({ o, key: `${o.name}#${n}` });
  });
  return out;
}

/** Raw component array and stride/offset of an attribute (interleaved or not). */
function rawOf(A) {
  return A.isInterleavedBufferAttribute ? { arr: A.data.array, st: A.data.stride, of: A.offset } : { arr: A.array, st: A.itemSize, of: 0 };
}

/** Fingerprint of one mesh's geometry: index / vertex counts and an FNV hash of up to 4096 raw position samples. */
export function meshPrint(g) {
  const P = g.getAttribute('position'), I = g.index, { arr, st, of } = rawOf(P);
  let h = 2166136261 >>> 0;
  const mix = (v) => { h ^= v & 0xffff; h = Math.imul(h, 16777619) >>> 0; h ^= (v >>> 16) & 0xffff; h = Math.imul(h, 16777619) >>> 0; };
  const n = P.count, step = Math.max(1, Math.floor(n / 1365));
  const f32 = arr instanceof Float32Array ? new Uint32Array(arr.buffer, arr.byteOffset, arr.length) : null;
  for (let i = 0; i < n; i += step) for (let c = 0; c < 3; c++) { const k = i * st + of + c; mix(f32 ? f32[k] : arr[k] | 0); }
  return `${I ? I.count : 0}/${n}/${h.toString(16)}`;
}

/** The plan's fingerprint of a LOD scene: every mesh's key and print. */
export function lodPrint(root) {
  return planMeshes(root).map(({ o, key }) => `${key}:${meshPrint(o.geometry)}`).join('|');
}

/**
 * Apply one LOD's plan to that LOD's scene (a placed instance's clone): the moved meshes get geometries of their own.
 * @returns {number} triangles moved (0 when the fingerprint does not match: nothing changed)
 */
export function applyLodPlan(root, lp, { name = '?', warn = console.warn } = {}) {
  if (!lp || !lp.meshes?.length) return 0;
  if (lp.print && lodPrint(root) !== lp.print) { warn?.(`[coplanar-baked] ${name} lod${lp.lod}: the geometry is not the one baked (re-run tools/art/bake-coplanar.mjs ${name}): skipped`); return 0; }
  const list = planMeshes(root), byKey = new Map(list.map((m) => [m.key, m.o]));
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  let moved = 0;
  const proxies = new Set();
  for (const mp of lp.meshes) {
    const o = byKey.get(mp.key);
    if (!o) continue;
    const moves = new Map();
    for (const r of mp.tris) {
      const t = r[0];
      const v = (k) => new THREE.Vector3(r[k] * PLAN_UNIT, r[k + 1] * PLAN_UNIT, r[k + 2] * PLAN_UNIT);
      moves.set(t, r.length >= 10 ? [v(1), v(4), v(7)] : v(1));
    }
    if (!moves.size) continue;
    o.geometry = o.geometry.clone(); // (this instance's own copy: the template and every other copy stay as they are)
    o.geometry.userData = { ...(o.geometry.userData || {}), coplanarBaked: true };
    const M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    liftTriangles(o, M, moves);
    o.geometry.computeBoundingBox();
    o.geometry.computeBoundingSphere();
    moved += moves.size;
    // (its group's merged stand-in in the depth passes — engine/depth-merge.js — no longer matches its geometry)
    const g = o.userData.depthGroup;
    if (g !== undefined && o.parent) for (const c of o.parent.children) if (c.isDepthProxy && c.userData.depthGroup === g) proxies.add(c);
  }
  // the shadow map's and the AO prepass's stand-ins merged again from the moved meshes, on this instance
  for (const p of proxies) remergeDepthGroup(p);
  return moved;
}

const PLANS = new Map(); // asset → Promise<plan|null>
/** Fetch an asset's baked plan (assets/models/buildings/coplanar/<asset>.json), once. */
export function loadCoplanarPlan(asset, base = 'assets/') {
  if (!PLANS.has(asset)) {
    PLANS.set(asset, (typeof fetch === 'function' ? fetch(`${base}models/buildings/coplanar/${asset}.json`) : Promise.reject(new Error('no fetch')))
      .then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return PLANS.get(asset);
}

/** The building groups a placed instance draws (art/building-library.js createBuilding: `building:<asset>:<id>`). */
export function instanceGroups(scene, asset, id) {
  const want = `building:${asset}:${id}`, out = [];
  scene?.traverse((o) => { if (o.name === want) out.push(o); });
  return out;
}

/**
 * Apply the baked plans to a mission's own instances: [{id, asset}] (the structure's id and its library asset). Every
 * LOD attached now, and every LOD attached later (the library's onLodAttached hook). Resolves to a report
 * {applied: [{id, lod, moved}], missing: [...]}.
 */
export async function applyBakedCoplanar(world, instances, { base = 'assets/', warn = console.warn } = {}) {
  const report = { applied: [], missing: [] };
  const scene = world?.scene;
  if (!scene) return report;
  for (const { id, asset } of instances) {
    const plan = await loadCoplanarPlan(asset, base);
    if (!plan) { report.missing.push(`${id}:${asset} (no plan)`); continue; }
    const groups = instanceGroups(scene, asset, id);
    if (!groups.length) { report.missing.push(`${id}:${asset} (not placed)`); continue; }
    for (const g of groups) {
      const done = new WeakSet();
      const fit = (i, lodObj) => {
        if (!lodObj || done.has(lodObj)) return;
        done.add(lodObj);
        const lp = plan.lods?.find((q) => q.lod === i);
        const moved = applyLodPlan(lodObj, lp, { name: asset, warn });
        report.applied.push({ id, lod: i, moved });
      };
      for (const c of g.children) { const m = /^lod(\d)$/.exec(c.name); if (m) fit(+m[1], c); }
      const prev = g.userData.onLodAttached;
      g.userData.onLodAttached = (i, o) => { prev?.(i, o); fit(i, o); };
    }
  }
  return report;
}
