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

import * as THREE from 'three';
import { LINK, B } from './grid.js';
import { placeholderHinted } from '../art/building-props.js';

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
  if (placeholderHinted(b.type, d)) return true; // placeholder-art swap: visual only, the mission's nav stays
  // the mission authors its own upper floor / roof (walkways, decks, roofWalk / roofY + parapets): keep that nav
  if (d.walkways?.length || d.deck || d.deckY != null || d.roofWalk != null || d.roofY != null) return true;
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
        grid.elev[k] = r.elev; grid.block[k] = B.NONE; grid.owner[k] = 0; grid.naturalElev[k] = 0;
      }
      raised.push(r);
      out.roofs++;
    }
    const end = (x, z, y) => { const p = snap(grid, x, z, y) || { x, z }; return { x: p.x, z: p.z, y }; };
    // an asset standing at the map edge (M7 harbour, M12 kasbah) may carry a ladder / climb foot beyond it: skip that link
    const inside = (p) => p.x >= 0 && p.z >= 0 && p.x < grid.width && p.z < grid.depth;
    for (const l of lib.ladders) {
      if (!(l.y >= MIN_RAISE)) continue;
      const a = end(l.a[0], l.a[1], 0), bTop = end(l.b[0], l.b[1], l.y);
      if (!inside(a) || !inside(bTop)) continue;
      grid.addLink(LINK.LADDER, a, bTop, { roles: null });
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
      const foot = end(mx + nx * 1.0, mz + nz * 1.0, 0), head = end(mx - nx * 1.0, mz - nz * 1.0, top);
      if (!inside(foot) || !inside(head)) continue;
      grid.addLink(LINK.CLIMB, foot, head, { roles: ['greenberet'] });
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
 * Hideout / garrison door points from the assets' main doors (enterable or garrison structures without a mission
 * `door`), kept only when within 4 m of the default point (else the mission layout wins and the mismatch is logged).
 * @returns {Map<string, number[]>} structure id → [x, z]
 */
export function libraryDoorPoints(built, log = []) {
  const out = new Map();
  for (const b of built) {
    const s = b.def, lib = b.library;
    if (!lib || !(s.enterable || s.garrison) || s.door || s.id == null || !lib.doors.length) continue; // (garrison: its doorway stays open, rule e)
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
const PANE_MATS = new Map();
/** The glass material with a per-vertex 'aBroken' flag: a broken pane draws as a dark, empty frame. */
function paneMaterial(m) {
  if (PANE_MATS.has(m)) return PANE_MATS.get(m);
  const c = m.clone();
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey?.bind(m);
  c.onBeforeCompile = (sh, r) => {
    prev?.call(c, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aBroken; varying float vBroken;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBroken = aBroken;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vBroken;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nif (vBroken > 0.5) diffuseColor = vec4(0.035, 0.038, 0.042, 1.0);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (vBroken > 0.5) roughnessFactor = 0.9;');
  };
  c.customProgramCacheKey = () => `${key ? key() : ''}|pane`;
  PANE_MATS.set(m, c);
  return c;
}

/**
 * Window panes of a glass mesh: its connected islands (vertices merged by position), each with its world centre,
 * outward normal and radius. Gives the mesh its own geometry copy with a zeroed 'aBroken' attribute and the pane
 * material. @returns {{c: THREE.Vector3, n: THREE.Vector3|null, r: number, verts: number[]}[]}
 */
export function paneIslands(mesh) {
  const g0 = mesh.geometry, pos = g0?.getAttribute('position');
  if (!pos) return [];
  const g = g0.clone(); mesh.geometry = g;
  const n = pos.count, par = new Int32Array(n).map((_, i) => i);
  const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) par[b] = a; };
  const key = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 1e3)},${Math.round(pos.getY(i) * 1e3)},${Math.round(pos.getZ(i) * 1e3)}`;
    if (key.has(k)) join(key.get(k), i); else key.set(k, i);
  }
  const idx = g.getIndex();
  const tri = (t) => (idx ? [idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2)] : [t * 3, t * 3 + 1, t * 3 + 2]);
  const nt = idx ? idx.count / 3 : n / 3;
  for (let t = 0; t < nt; t++) { const [a, b, c] = tri(t); join(a, b); join(a, c); }
  const groups = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  g.setAttribute('aBroken', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
  mesh.material = Array.isArray(mesh.material) ? mesh.material.map(paneMaterial) : paneMaterial(mesh.material);
  const nrm = g.getAttribute('normal'), mw = mesh.matrixWorld, nm = new THREE.Matrix3().getNormalMatrix(mw), v = new THREE.Vector3();
  const out = [];
  for (const verts of groups.values()) {
    const c = new THREE.Vector3();
    for (const i of verts) c.add(v.fromBufferAttribute(pos, i));
    c.multiplyScalar(1 / verts.length);
    let r = 0;
    for (const i of verts) r = Math.max(r, v.fromBufferAttribute(pos, i).distanceTo(c));
    c.applyMatrix4(mw);
    const nn = nrm ? new THREE.Vector3().fromBufferAttribute(nrm, verts[0]).applyMatrix3(nm).normalize() : null;
    out.push({ c, n: nn, r: r * mw.getMaxScaleOnAxis(), verts });
  }
  return out;
}
export function wireLibraryDoors(world, built) {
  const byId = new Map();
  for (const b of built) {
    if (!b.library?.doors.length || b.def.id == null) continue;
    const main = b.library.doors.find((q) => q.id === 'main') ?? b.library.doors[0];
    const e = { lib: b.library, door: main.id, t: 0, target: 0, hold: 0, x: b.def.x ?? 0, z: b.def.z ?? 0, blast: null };
    byId.set(`${b.def.id}:door`, e); byId.set(String(b.def.id), e);
  }
  // window glass of every library building (not instanced repeats): blown out PANE BY PANE by a close blast (§A.8):
  // each glass mesh is split into its connected islands (one per window pane), a per-vertex 'broken' flag turns a
  // pane into a dark, empty frame (one draw call per mesh as before)
  const panes = [];
  for (const b of built) {
    const root = b.library?.object3d;
    if (!root || b.def.x == null) continue;
    const bid = String(b.def.id ?? `${b.type}@${b.def.x},${b.def.z}`);
    const meshes = [];
    root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && /glass/i.test((Array.isArray(o.material) ? o.material[0] : o.material)?.name || '')) meshes.push(o); });
    root.updateMatrixWorld(true);
    meshes.forEach((m, mi) => {
      for (const [k, isl] of paneIslands(m).entries()) {
        panes.push({ id: `${bid}#${mi}:${k}`, x: isl.c.x, z: isl.c.z, y: isl.c.y, n: isl.n, r: isl.r, mesh: m, verts: isl.verts, broken: false, delay: -1 });
      }
    });
  }
  world.brokenPanes = world.brokenPanes || [];
  if ((!byId.size && !panes.length) || !world.events) return { frame() {}, dispose() {} };
  const off = world.events.on('door', (ev) => {
    const e = byId.get(String(ev?.id));
    if (!e) return;
    if (ev.unit) { e.target = 1; e.hold = 1.2; } else e.target = ev.open ? 1 : 0;
  });
  // bodies-design §A.8: a blast front swings the doors of nearby buildings open (damped hinge, overshoot, left ajar);
  // visual only — the gameplay door / hideout state never changes
  const breakPane = (p) => {
    p.broken = true;
    const a = p.mesh.geometry.getAttribute('aBroken');
    for (const v of p.verts) a.array[v] = 1;
    a.needsUpdate = true;
    if (!world.brokenPanes.includes(p.id)) world.brokenPanes.push(p.id);
  };
  const offBlast = world.events.on('blast:front', (ev) => {
    for (const p of panes) {
      if (p.broken) continue;
      const dx = p.x - ev.x, dz = p.z - ev.z, d = Math.hypot(dx, dz);
      // a pane facing away from the blast (on the far wall) is shielded by the building: shorter reach
      const facing = p.n && d > 1e-3 ? (p.n.x * dx + p.n.z * dz) / d : -1;
      const r = Math.max(0, d - p.r);
      if (r > 1.8 * ev.Rk * (facing > 0.3 ? 0.55 : 1)) continue;
      if (ev.restore) breakPane(p); else { p.delay = r / 340; p.bx = ev.x; p.bz = ev.z; }
    }
    for (const e of new Set(byId.values())) {
      const r = Math.hypot(e.x - ev.x, e.z - ev.z);
      if (r > 1.5 * ev.Rk + 3) continue;
      const rest = 0.35 + 0.2 * (Math.abs(e.x * 0.37 + e.z * 0.61) % 1);
      if (ev.restore) { e.t = e.target = e.ajar = rest; e.blast = null; e.lib.setDoorOpen(e.door, rest); continue; }   // loaded save
      e.blast = { delay: r / 340, v: 4 + 6 * Math.max(0, 1 - r / (1.5 * ev.Rk + 3)), rest };
    }
  });
  return {
    frame(dt) {
      for (const p of panes) {
        if (p.broken || p.delay < 0 || (p.delay -= dt) > 0) continue;
        breakPane(p);
        // shards out of this pane (a small burst per window)
        world.fx?.spawn?.('glass_shards', p.x, p.z, { y: p.y, scale: Math.min(1, 0.35 + p.r) });
      }
      for (const e of new Set(byId.values())) {
        if (e.blast) {
          const B = e.blast;
          if ((B.delay -= dt) > 0) continue;
          B.v += ((B.rest - e.t) * 30 - B.v * 3.2) * dt;   // damped hinge spring
          e.t = Math.min(1, Math.max(0, e.t + B.v * dt));
          e.lib.setDoorOpen(e.door, e.t);
          if (Math.abs(B.v) < 0.01 && Math.abs(e.t - B.rest) < 0.01) { e.target = e.t; e.blast = null; e.ajar = B.rest; }
          continue;
        }
        if (e.hold > 0 && (e.hold -= dt) <= 0) e.target = e.ajar ?? 0;
        if (e.t === e.target) continue;
        e.t = e.target > e.t ? Math.min(e.target, e.t + dt * 1.6) : Math.max(e.target, e.t - dt * 1.6);
        e.lib.setDoorOpen(e.door, e.t);
      }
    },
    // the per-mesh geometry copies made by paneIslands are ours (a building owned by an entity leaves the scene
    // before the map unload disposes what is left in it)
    dispose() { off?.(); offBlast?.(); for (const m of new Set(panes.map((p) => p.mesh))) m.geometry?.dispose(); },
  };
}

/**
 * Walkable deck surfaces of library bridges (and piers/quays with a deck height), in world coords.
 * `heightAt(x, z)` = deck height along the bridge (deck_end at the ends, smooth ramp to deck_top), or null outside.
 */
export function libraryDecks(built, o = {}) {
  const out = [];
  for (let b of built) {
    let br = b.library?.bridge;
    if (!br?.deck || br.deck.length < 3 || !(br.deck_top > 0.05)) {
      // a library bridge / pier without sidecar deck data: its gameplay rect is the deck, measured on the visual
      const d = b.def, isDeck = b.library && (/bridge|pier|jetty|dam/.test(b.type) || d.deck) && d.w != null && d.d != null;
      if (!isDeck || !o.measure) continue;
      const c = Math.cos(d.rot ?? 0), s = Math.sin(d.rot ?? 0), hw = d.w / 2, hd = d.d / 2;
      br = { deck: [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [d.x + u * c - v * s, d.z + u * s + v * c]), deck_top: 1.2, deck_end: 0 };
      b = { ...b, library: { ...b.library, scale: [1, 1, 1] } };
    }
    const sy = b.library.scale[1], top = br.deck_top * sy, endH = (br.deck_end ?? 0) * sy;
    const rot = b.def.rot ?? 0, c = Math.cos(rot), s = Math.sin(rot), x0 = b.def.x ?? 0, z0 = b.def.z ?? 0;
    // along-axis extent of the deck in the structure frame (local +X = bridge heading)
    const along = br.deck.map(([x, z]) => (x - x0) * c + (z - z0) * s);
    const lo = Math.min(...along), hi = Math.max(...along), half = (hi - lo) / 2, mid = (hi + lo) / 2;
    const ramp = Math.min(half * 0.45, Math.max(2, (br.approach?.length ?? 6) * b.library.scale[0]));
    // measured decks cover the whole walkable nav rect (the sidecar deck can stop short of the crest's ends)
    const d = b.def, rect = o.measure && d.w != null && d.d != null
      ? [[-d.w / 2, -d.d / 2], [d.w / 2, -d.d / 2], [d.w / 2, d.d / 2], [-d.w / 2, d.d / 2]].map(([u, v]) => [x0 + u * c - v * s, z0 + u * s + v * c]) : null;
    const polyArea = (p) => Math.abs(p.reduce((t, q, k) => { const r = p[(k + 1) % p.length]; return t + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;
    // a curved crest (a dam's arch: the asset's crest_poly) is the deck itself
    const poly = br.crest?.length >= 3 ? br.crest : rect && polyArea(rect) > polyArea(br.deck) ? rect : br.deck;
    const analytic = (x, z) => {
      const u = Math.abs((x - x0) * c + (z - z0) * s - mid), k = Math.min(1, Math.max(0, (half - u) / ramp));
      return endH + (top - endH) * k * k * (3 - 2 * k);
    };
    // browser: the walking surface measured on the visual (placement rule e: nobody wades through a deck)
    // a raised deck (`elev`, M3 dam crest): the visual stands `elev` higher and units already stand at grid elev
    // there, so the measured surface is taken relative to it
    const lift0 = b.def.elev > 0 ? b.def.elev : 0;
    const field0 = o.measure ? o.measure(b, poly, rot, top + lift0) : null;
    const field = field0 && lift0 ? { heightAt: (x, z) => { const h = field0.heightAt(x, z); return h == null ? h : h - lift0; }, parapet: (x, z) => field0.parapet(x, z) } : field0;
    out.push({
      id: b.def.id ?? b.type, poly, top, owner: b.owner, measured: !!field, lift: 0, root: b.library.object3d ?? null,
      heightAt(x, z) {
        // measured field (placement rule e) or the analytic ramp, plus the plank / snow-cap lift (calibrateDeck)
        const h = field ? field.heightAt(x, z) : inPoly(x, z, poly) ? analytic(x, z) : null;
        return h == null ? null : h + this.lift;
      },
      parapet: (x, z) => !!field && field.parapet(x, z),
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
