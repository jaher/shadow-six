/**
 * The rest of what the game measures on the drawn art that the headless sim (tools/solutions/headless.mjs) lacks, next
 * to the grid (grid-snap.mjs): the body solids men path round (world.bodySolids), the water obstacles, the library
 * buildings' real doors, and the small moves the placement rules over the drawn shapes make to structures and
 * interactables (a tower 0.1–0.2 m over, its ladder with it). Read in the browser (browserExtras), diffed against the
 * mesh-less build in node (diffExtras), laid over a headless world (applyExtras).
 */
import { plain } from '../../src/debug/gameplay-fingerprint.js';
import { setStaticSolids } from '../../src/world/body-clearance.js';

const structPlain = (s) => plain({ owner: s.owner, type: s.type, cat: s.cat, def: s.def, top: s.top, h: s.h, footprints: s.footprints }, 5);
const strList = (w) => [...(w.structures?.values?.() || [])];

/** (browser) the browser world's own values, for diffExtras. */
export function browserExtras(w) {
  return {
    bodySolids: (w.bodySolids?.list || []).map((o) => ({ owner: o.owner, R: JSON.parse(JSON.stringify(o.R)), gone: !!o.gone })),
    waterObstacles: JSON.parse(JSON.stringify(w.waterObstacles || [])),
    structureDoors: [...(w.structureDoors || [])].map(([k, v]) => [k, [...v]]),
    interactables: w.interactables.map((i) => plain(i)),
    structures: strList(w).map(structPlain),
    // (the measured size of each vehicle's drawn model: its hull rectangle, world/body-clearance.js hullRect, is the larger of that and def.size)
    vehicleDims: (w.vehicles || []).map((v) => (v.model?.dims ? JSON.parse(JSON.stringify(v.model.dims)) : null)),
  };
}

/** (node) what the headless world `w` needs to be the browser's: bodySolids, waterObstacles, doors, and [path, value] patches. */
export function diffExtras(w, b) {
  const patches = (hl, br, p, out) => {
    if (JSON.stringify(hl) === JSON.stringify(br)) return;
    if (hl && br && typeof hl === 'object' && typeof br === 'object') { for (const k of new Set([...Object.keys(hl), ...Object.keys(br)])) patches(hl[k], br[k], p.concat(k), out); return; }
    if (typeof br === 'number' && typeof hl === 'number' && !p.includes('visualRuns')) out.push([p, br]);
  };
  const out = { bodySolids: b.bodySolids, waterObstacles: b.waterObstacles, structureDoors: b.structureDoors, vehicleDims: b.vehicleDims, interactables: [], structures: [] };
  w.interactables.forEach((it, i) => { const o = []; patches(plain(it), b.interactables[i], [], o); if (o.length) out.interactables.push([i, o]); });
  strList(w).forEach((s, i) => { const o = []; patches(structPlain(s), b.structures[i], [], o); if (o.length) out.structures.push([i, o]); });
  return out;
}

const setPath = (obj, path, v) => {
  let o = obj;
  for (let k = 0; k < path.length - 1; k++) { o = o?.[path[k]]; if (o == null || typeof o !== 'object') return; }
  const last = path[path.length - 1];
  if (o && typeof o[last] === 'number') o[last] = v;
};

/**
 * A copy of a mission definition's structures that this world owns: the patches of applyExtras change structure
 * defs in place (the structures and the interactables hold the very same objects), which must not reach the
 * definition every other world built from the mission shares.
 */
export function ownStructures(mission) {
  const deep = (v) => (Array.isArray(v) ? v.map(deep) : v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
  return { ...mission, structures: (mission.structures || []).map(deep) };
}

/** (node) lay the extras on headless world `w`. */
export function applyExtras(w, x) {
  if (x.bodySolids?.length) {
    setStaticSolids(w, x.bodySolids);
    (w.bodySolids.list.forEach((o, k) => { o.gone = x.bodySolids[k].gone; }));
  }
  if (x.waterObstacles?.length) w.waterObstacles = x.waterObstacles;
  if (x.structureDoors?.length) w.structureDoors = new Map(x.structureDoors);
  for (const [i, ps] of x.interactables || []) for (const [p, v] of ps) setPath(w.interactables[i], p, v);
  const st = strList(w);
  for (const [i, ps] of x.structures || []) for (const [p, v] of ps) setPath(st[i], p, v);
}

/** (node) the measured model dims of the vehicles, once they are spawned (headless vehicles have a placeholder model). */
export function applyVehicleDims(w, x) {
  (x?.vehicleDims || []).forEach((d, i) => { const v = w.vehicles[i]; if (d && v?.model) v.model.dims = d; });
}
