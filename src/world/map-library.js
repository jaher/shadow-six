/**
 * Map-level use of the building library's sidecars (ART integration 2), called by map-builder once the structures
 * are built. Only structures whose visual came from the library (`b.library`, browser) take part; the grid-only
 * unit-test path never sees any of this.
 *  - nav: walkable roofs (raised `elev`), ladders (everyone) and climb edges (Green Beret) — unless the mission
 *    overrides (`mission.libraryNav === false`, structure `nav:false`, its own walkways/deck/deckY, watchtowers,
 *    or any mission ladder / climbLink ending on the structure)
 *  - doors: the hideout door of an `enterable` structure without an explicit `door` sits at the asset's main door;
 *    door nodes swing when units enter/leave or a gate opens
 *  - bridges: deck surfaces for the visual ground height (units walk on the arched deck) and pier obstacles for
 *    the water flow (world.waterObstacles → art/water.js)
 * @module world/map-library
 */

import { LINK, B } from './grid.js';

const MIN_RAISE = 1.5; // m — lower walkable sidecar surfaces (quays, porches) stay ground level

function inPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function bboxOf(fps, pad = 1) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const add = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
  for (const f of fps) {
    if (f.shape === 'rect') { const r = Math.hypot(f.w, f.d) / 2; add(f.x - r, f.z - r); add(f.x + r, f.z + r); }
    else if (f.shape === 'circle') { add(f.x - f.r, f.z - f.r); add(f.x + f.r, f.z + f.r); }
    else for (const [x, z] of f.points || []) add(x, z);
  }
  return { x0: x0 - pad, x1: x1 + pad, z0: z0 - pad, z1: z1 + pad };
}

/** Does the mission override the structure's own nav data? */
function navOverridden(b, mission) {
  const d = b.def;
  if (mission.libraryNav === false || d.nav === false || b.type === 'watchtower') return true;
  if (d.walkways?.length || d.deck || d.deckY != null) return true;
  const bb = bboxOf(b.footprints);
  const hit = (x, z) => x >= bb.x0 && x <= bb.x1 && z >= bb.z0 && z <= bb.z1;
  for (const l of mission.ladders || []) if (hit(l.x, l.z) || (l.top && hit(l.top[0], l.top[1]))) return true;
  for (const l of mission.climbLinks || []) if (hit(l.a[0], l.a[1]) || hit(l.b[0], l.b[1])) return true;
  return false;
}

/**
 * Walkable roofs, ladders and climb edges from the sidecars → grid elev + links.
 * @param {(grid, x, z, y) => ({x:number, z:number}|null)} snap map-builder snapToSurface
 * @returns {{roofs: number, ladders: number, climbs: number, structures: string[]}}
 */
export function applyLibraryNav(grid, built, mission, snap) {
  const out = { roofs: 0, ladders: 0, climbs: 0, structures: [] };
  const scratch = new grid.constructor(grid.width, grid.depth, grid.cell);
  for (const b of built) {
    const lib = b.library;
    if (!lib || navOverridden(b, mission)) continue;
    const reach = lib.ladders.some((l) => l.y >= MIN_RAISE) || lib.climbEdges.length > 0;
    const raised = [];
    for (const r of lib.roofs) {
      if (!r.walkable || !(r.elev >= MIN_RAISE) || !reach) continue;
      scratch.block.fill(0);
      scratch.fillPoly(r.points, 'block', B.HIGH, 0);
      for (let k = 0; k < grid.size; k++) {
        if (!scratch.block[k]) continue;
        grid.elev[k] = r.elev; grid.block[k] = B.NONE; grid.owner[k] = 0;
      }
      raised.push(r);
      out.roofs++;
    }
    const end = (x, z, y) => { const p = snap(grid, x, z, y) || { x, z }; return { x: p.x, z: p.z, y }; };
    for (const l of lib.ladders) {
      if (!(l.y >= MIN_RAISE)) continue;
      grid.addLink(LINK.LADDER, end(l.a[0], l.a[1], 0), end(l.b[0], l.b[1], l.y), { roles: null });
      out.ladders++;
    }
    for (const c of lib.climbEdges) {
      const mx = (c.a[0] + c.b[0]) / 2, mz = (c.a[1] + c.b[1]) / 2;
      const len = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]) || 1;
      let nx = -(c.b[1] - c.a[1]) / len, nz = (c.b[0] - c.a[0]) / len;
      const roof = raised.find((r) => inPoly(mx - nx * 0.8, mz - nz * 0.8, r.points) || inPoly(mx + nx * 0.8, mz + nz * 0.8, r.points));
      if (!roof) continue;
      if (inPoly(mx + nx * 0.8, mz + nz * 0.8, roof.points)) { nx = -nx; nz = -nz; } // n points outwards
      const top = c.top ?? c.y ?? roof.elev;
      grid.addLink(LINK.CLIMB, end(mx + nx * 1.0, mz + nz * 1.0, 0), end(mx - nx * 1.0, mz - nz * 1.0, top), { roles: ['greenberet'] });
      out.climbs++;
    }
    if (raised.length) out.structures.push(b.def.id ?? b.type);
  }
  if (out.roofs) grid.version++;
  return out;
}

/** Default hideout door point (as spawnMissionInteractables: south face at rot 0). */
function defaultDoor(s) {
  const rot = s.rot ?? 0, d = s.d ?? 6;
  return [s.x + Math.cos(rot + Math.PI / 2) * (d / 2 + 0.6), s.z + Math.sin(rot + Math.PI / 2) * (d / 2 + 0.6)];
}

/**
 * Hideout door points from the assets' main doors (enterable structures without a mission `door`), kept only when
 * within 4 m of the default point (else the mission layout wins and the mismatch is logged).
 * @returns {Map<string, number[]>} structure id → [x, z]
 */
export function libraryDoorPoints(built, log = []) {
  const out = new Map();
  for (const b of built) {
    const s = b.def, lib = b.library;
    if (!lib || !s.enterable || s.door || s.id == null || !lib.doors.length) continue;
    const d = lib.doors.find((q) => q.id === 'main') ?? lib.doors[0];
    const p = d.approach ?? { x: d.x, z: d.z };
    const def = defaultDoor(s);
    if (Math.hypot(p.x - def[0], p.z - def[1]) <= 4) out.set(s.id, [p.x, p.z]);
    else log.push(`door ${s.id}: asset door ${p.x.toFixed(1)},${p.z.toFixed(1)} far from the layout door ${def[0].toFixed(1)},${def[1].toFixed(1)} — layout kept`);
  }
  return out;
}

/**
 * Door nodes follow the game: a unit entering/leaving a hideout swings the main door open for a moment; gates and
 * doors with an open state follow it. @returns {{frame: (dt:number) => void, dispose: () => void}}
 */
export function wireLibraryDoors(world, built) {
  const byId = new Map();
  for (const b of built) {
    if (!b.library?.doors.length || b.def.id == null) continue;
    const main = b.library.doors.find((q) => q.id === 'main') ?? b.library.doors[0];
    const e = { lib: b.library, door: main.id, t: 0, target: 0, hold: 0 };
    byId.set(`${b.def.id}:door`, e); byId.set(String(b.def.id), e);
  }
  if (!byId.size || !world.events) return { frame() {}, dispose() {} };
  const off = world.events.on('door', (ev) => {
    const e = byId.get(String(ev?.id));
    if (!e) return;
    if (ev.unit) { e.target = 1; e.hold = 1.2; } else e.target = ev.open ? 1 : 0;
  });
  return {
    frame(dt) {
      for (const e of new Set(byId.values())) {
        if (e.hold > 0 && (e.hold -= dt) <= 0) e.target = 0;
        if (e.t === e.target) continue;
        e.t = e.target > e.t ? Math.min(e.target, e.t + dt * 1.6) : Math.max(e.target, e.t - dt * 1.6);
        e.lib.setDoorOpen(e.door, e.t);
      }
    },
    dispose() { off?.(); },
  };
}

/**
 * Walkable deck surfaces of library bridges (and piers/quays with a deck height), in world coords.
 * `heightAt(x, z)` = deck height along the bridge (deck_end at the ends, smooth ramp to deck_top), or null outside.
 */
export function libraryDecks(built) {
  const out = [];
  for (const b of built) {
    const br = b.library?.bridge;
    if (!br?.deck || br.deck.length < 3 || !(br.deck_top > 0.05)) continue;
    const sy = b.library.scale[1], top = br.deck_top * sy, endH = (br.deck_end ?? 0) * sy;
    const rot = b.def.rot ?? 0, c = Math.cos(rot), s = Math.sin(rot), x0 = b.def.x ?? 0, z0 = b.def.z ?? 0;
    // along-axis extent of the deck in the structure frame (local +X = bridge heading)
    const along = br.deck.map(([x, z]) => (x - x0) * c + (z - z0) * s);
    const lo = Math.min(...along), hi = Math.max(...along), half = (hi - lo) / 2, mid = (hi + lo) / 2;
    const ramp = Math.min(half * 0.45, Math.max(2, (br.approach?.length ?? 6) * b.library.scale[0]));
    const poly = br.deck;
    out.push({
      id: b.def.id ?? b.type, poly, top, lift: 0, root: b.library.object3d ?? null,
      heightAt(x, z) {
        if (!inPoly(x, z, poly)) return null;
        const u = Math.abs((x - x0) * c + (z - z0) * s - mid), k = Math.min(1, Math.max(0, (half - u) / ramp));
        return endH + (top - endH) * k * k * (3 - 2 * k) + this.lift;
      },
    });
  }
  return out;
}

/**
 * Match a deck's height to the planks actually modelled: the sidecar deck_top is the bare structure, but snow
 * variants carry a snow cap on the deck (~8-12 cm) and plank boards vary, so units and ground decals sat a few cm
 * under the rendered surface (selection ring hidden by the depth test). Casts rays down at a few points inside the
 * deck polygon against `deck.root` (loaded meshes) and sets `deck.lift` to the median offset of the hits that lie in
 * a plausible band just above the nominal height (railings, bollards and lamps are ignored).
 * @param {{poly:number[][], lift:number, root:THREE.Object3D|null, heightAt:Function}} deck
 * @param {typeof import('three')} THREE
 * @returns {boolean} true when enough of the deck was hit to decide (false: meshes not loaded yet, retry later)
 */
export function calibrateDeck(deck, THREE) {
  if (!deck.root) return false;
  const poly = deck.poly, n = poly.length;
  const cx = poly.reduce((a, p) => a + p[0], 0) / n, cz = poly.reduce((a, p) => a + p[1], 0) / n;
  const pts = [[cx, cz]];
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % n];
    pts.push([cx + (ax - cx) * 0.55, cz + (az - cz) * 0.55], [cx + ((ax + bx) / 2 - cx) * 0.55, cz + ((az + bz) / 2 - cz) * 0.55]);
  }
  deck.root.updateMatrixWorld(true);
  const rc = new THREE.Raycaster(), o = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0), d = [];
  const lift = deck.lift;
  deck.lift = 0;
  let hits = 0;
  for (const [x, z] of pts) {
    const h = deck.heightAt(x, z);
    if (h == null) continue;
    rc.set(o.set(x, h + 3, z), down);
    const all = rc.intersectObject(deck.root, true);
    if (all.length) hits++;
    const hit = all.find((q) => q.point.y > h - 0.06 && q.point.y < h + 0.25);
    if (hit) d.push(hit.point.y - h);
  }
  if (!hits) { deck.lift = lift; return false; }
  d.sort((a, b) => a - b);
  deck.lift = d.length >= 2 ? Math.max(0, d[(d.length - 1) >> 1]) : 0;
  return true;
}

/** Pier / bent / dolphin footprints of library bridges and quays → circular flow obstacles for the water. */
export function libraryWaterObstacles(built) {
  const out = [];
  for (const b of built) for (const p of b.library?.piers || []) out.push({ x: p.x, z: p.z, r: p.r, id: b.def.id ?? b.type });
  return out;
}
