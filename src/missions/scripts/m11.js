/**
 * BEL Mission 11 "In the Soup": mission-local helpers (docs/missions/m11.md §4, §6, §9, §10, §13). Owned by MISSIONS.
 *
 *  - Three raised levels with `walkways` strips (map-builder has no area elev, D3; the M5/M8/M10 method): the
 *    N plateau and the HQ plateau (y 6), the SE mesa (y 4); the W road climbs to the plateau on stepped ramps.
 *  - heardLocal (D1): a zone flagged `heardLocal` fires its `onHeard` event only for noises whose SOURCE lies
 *    inside its poly (engine: ai/alarm.js), so the camp's barrels never empty the central bunker (Prima's Phase 2).
 *  - Explosion pull (D2): the mission's `explosionPull` = EXPLOSION_PULL (45) m (engine: abilities/explosions.js),
 *    so only the men within earshot walk to a blast (Prima's Phase 2 responders), not every investigator on the map.
 *  - Elevated driving (D3/D9): land vehicles refuse raised cells (vehicle.passableAt). The two half-tracks get a
 *    per-instance passableAt that accepts raised walkable cells when the step from the hull's current height is
 *    gentle (ramps), never a cliff edge; their `y` follows the ground. The M10 script does the same for the Ju 52.
 *  - rigsImpossible(): §10.2 `t_n_impossible` — a standing N rig with no fuel left that could still reach it.
 *  - Visuals (browser only): prisms for the plateaus, mesa and rock masses, ramp slabs, the crater pool, the
 *    tunnel portals; plateau/mesa props lifted; rubble in the S portal once the tunnel falls.
 * @module missions/scripts/m11
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainRamp, terrainRampChain, terrainPrism } from '../../art/kit-terrain.js';
import { dressingMaterial, boxUV, boulderGeometry } from '../../art/dressing.js';
import { paintedMaterial } from '../../art/kit-props.js';
import { libraryVisual } from '../../art/building-props.js';
import { plateauWalkways, rectPoly } from './m05.js';
import { segmentHoles, rampWalkways } from './m08.js';

export { rectPoly, segmentHoles, rampWalkways };

export const PLATEAU_Y = 6;
export const MESA_Y = 4;
export const ROOF_Y = 3.5;
/** The half-tracks allowed to climb the W road / drive the plateau and the bore. */
export const CLIMBERS = ['ht_ours', 'ht_n'];

/** A raised area as walkway strips at height `y` minus the holes (props standing on it keep their block). */
export function levelStrips(poly, holes, y) {
  return plateauWalkways(poly, holes, y);
}

// ------------------------------------------------------------------ D1 heardLocal, D2 explosion pull

/**
 * §13 D2: an explosion pulls the investigating men within this many metres (not the whole map): the mission's
 * `explosionPull` (engine: abilities/explosions.js). D1 `heardLocal` zones are the engine's too (ai/alarm.js):
 * both hold from the very first step after a quick load (a runtime patch installed by the lazy script did not).
 */
export const EXPLOSION_PULL = 45;

// ------------------------------------------------------------------ D3/D9 elevated driving

/**
 * Fix round 2: the outer corner of each bend between two ramp legs was bare ground (y 0), so a 2.2 m hull
 * driving a leg to its end stalled with one nose corner over the gap. One flat pad per joint at the joint's
 * height fills the outer wedge: a strip from the joint along the outer bisector to the miter point.
 * @param {{a:number[], b:number[], width:number}[]} ramps consecutive legs (leg k's `b` is leg k+1's `a`)
 * @returns {{a:number[], b:number[], width:number, y:number}[]} pads (a, b as [x, z])
 */
export function rampJointPads(ramps) {
  const pads = [];
  for (let k = 0; k + 1 < ramps.length; k++) {
    const r1 = ramps[k], r2 = ramps[k + 1];
    const [jx, jz, jy] = r1.b;
    const unit = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
    const d1 = unit(jx - r1.a[0], jz - r1.a[1]), d2 = unit(r2.b[0] - jx, r2.b[1] - jz);
    const turn = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(turn) < 0.05) continue; // straight joint: no gap
    const s = turn > 0 ? -1 : 1; // the outer side is opposite the turn
    const n1 = [-d1[1] * s, d1[0] * s], n2 = [-d2[1] * s, d2[0] * s];
    const m = unit(n1[0] + n2[0], n1[1] + n2[1]);
    const half = Math.min(r1.width, r2.width) / 2;
    const reach = half / Math.max(0.5, m[0] * n1[0] + m[1] * n1[1]) + 0.3; // to the miter point
    const r = (v) => +v.toFixed(2);
    pads.push({ a: [r(jx - m[0] * 0.5), r(jz - m[1] * 0.5)], b: [r(jx + m[0] * reach), r(jz + m[1] * reach)], width: +(half * 1.4).toFixed(2), y: jy });
  }
  return pads;
}

/** Largest height change a hull accepts between its current height and a probe `dist` m away (ramps ≤ 0.3/m). */
const stepLimit = (dist) => 0.8 + 0.35 * dist;

/** Let a land vehicle climb ramps and drive raised walkable cells (never off a cliff edge). */
export function patchClimber(v, world) {
  if (!v || v._m11Climber) return;
  v._m11Climber = true;
  const orig = v.passableAt.bind(v);
  v.passableAt = (x, z) => {
    const g = world.grid;
    const { i, j } = g.worldToCell(x, z);
    if (!g.inBounds(i, j)) return orig(x, z);
    const y = g.elev[g.idx(i, j)] || 0;
    const here = v.y || 0;
    if (Math.abs(y - here) > stepLimit(Math.hypot(x - v.x, z - v.z))) return false;
    if (y <= 0.3) return orig(x, z);
    // raised cell: same rules as the ground (block, other hulls) minus the elevation refusal
    const k = g.idx(i, j);
    if (g.block[k] !== 0) return false;
    for (const o of world.vehicles || []) {
      if (o === v || o.removed || o.hiddenRail || (o.destroyed && o.wreckBaked)) continue;
      if (o._inHull?.(x, z, 0.1)) return false;
    }
    return true;
  };
}

/** Per-tick glue (idempotent: survives a quick load). */
export function m11Tick(world) {
  const g = world.grid;
  for (const id of CLIMBERS) {
    const v = world.byId?.(id);
    if (!v || v.removed) continue;
    patchClimber(v, world);
    if (!v.destroyed && g) v.y = g.elevAt(v.x, v.z) || 0;
  }
}

// ------------------------------------------------------------------ §10.2 t_n_impossible

const gone = (e) => !e || e.removed || e.destroyed || e.exploded || e.alive === false;

/**
 * The two quarry rigs can only burn by fuel (nobody can enter the pit), set off from the ridge: a pistol round
 * into brl_q3 (the only drum in pistol reach; its blast carries brl_q1/q2 and, at W_mid, the tanker), the
 * half-track's MG (the tanker, tank_q2: the only gun that reaches the tanker's route and the tanks), or the
 * Sapper's grenade (rig_ne itself or brl_q3). Lost when a standing N rig has no source left that can still
 * be set off: the half-track counts while it stands with the Driver alive, a pistol while anyone lives.
 */
export function rigsImpossible(world) {
  const by = (id) => world.byId?.(id);
  const live = (world.commandos || []).filter((c) => c.alive !== false && !c.removed);
  const sapper = live.find((c) => c.role === 'sapper');
  const grenade = (sapper?.inventory?.get?.('grenade') ?? sapper?.inventory?.grenade ?? 0) > 0;
  const ht = by('ht_ours');
  const mg = !gone(ht) && live.some((c) => c.role === 'driver');
  const pistol = live.length > 0;
  const tanker = !gone(by('tanker'));
  const brl3 = !gone(by('brl_q3'));
  const drums = ['brl_q1', 'brl_q2', 'brl_q3'].some((id) => !gone(by(id)));
  // the tanker burns to the MG, or to brl_q3's blast (pistol / grenade) while it waits at W_mid
  const tankerLit = tanker && (mg || (brl3 && (pistol || grenade)));
  const nw = !gone(by('rig_nw')) && !(tankerLit || (mg && !gone(by('tank_q2'))));
  const ne = !gone(by('rig_ne')) && !(tankerLit || grenade || (brl3 && pistol) || (mg && drums));
  return nw || ne;
}

// ------------------------------------------------------------------ visuals (browser only)

/** Plateau / mesa (walkable top: wind-blown sand) or rock mass (bare rock top) over an eroded ochre rock face. art2
 * pass: the kit's PBR sets (art/kit-terrain.js, as M8 / M10 / M14), not the old procedural ripple / strata maps. */
function prism(points, h, rocky = false) {
  return terrainPrism(points, h, { top: rocky ? 'rockOchre' : 'sand', side: 'rockOchre' });
}

/** A white vertical oil-field tank (r, h): shell with weld rings, shallow cone roof, caged ladder, concrete plinth. */
function oilTankMesh(r, h) {
  const grp = new THREE.Group();
  // placeholder-art pass: textured paint / steel / concrete PBR sets (was flat colours)
  const paint = paintedMaterial('steel', 0xe4ded0), dark = dressingMaterial('castIron'), stain = paintedMaterial('steel', 0x3a3128);
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.35, r + 0.45, 0.35, 24), dressingMaterial('concrete'));
  plinth.position.y = 0.17; grp.add(plinth);
  const shellGeo = new THREE.CylinderGeometry(r, r, h, 28), suv = shellGeo.attributes.uv;
  for (let i = 0; i < suv.count; i++) suv.setXY(i, suv.getX(i) * (2 * Math.PI * r) / 2.5, suv.getY(i) * h / 2.5); // metres / 2.5 m
  const shell = new THREE.Mesh(shellGeo, paint);
  shell.position.y = 0.35 + h / 2; grp.add(shell);
  for (let k = 1; k < 4; k++) { // weld seams
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.02, 0.035, 4, 28), dark);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.35 + (h * k) / 4; grp.add(ring);
  }
  const drip = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.01, r + 0.01, 0.9, 28, 1, true), stain); // oil run at the foot
  drip.position.y = 0.8; grp.add(drip);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(r + 0.08, 0.7, 28), paint);
  roof.position.y = 0.35 + h + 0.35; grp.add(roof);
  for (const s of [-0.22, 0.22]) { // ladder rails up the E side
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), dark);
    rail.position.set(r + 0.12, 0.35 + h / 2, s); grp.add(rail);
  }
  for (let y = 0.8; y < h; y += 0.45) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.44), dark);
    rung.position.set(r + 0.12, 0.35 + y, 0); grp.add(rung);
  }
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return grp;
}

/** A sloped road slab from a → b ([x, z, y]), `width` wide. */
function rampMesh(a, b, width, color) {
  return terrainRamp(a, b, width, { top: 'gravel', side: 'sandstone' }); // placeholder-art pass (art/kit-terrain.js)
}

/** Arched masonry face of a tunnel portal at (x, z) facing `rot` (rad), opening 5 × 4.5 m, standing on y. */
function portalMesh(x, z, rot, y) {
  const grp = new THREE.Group();
  const mat = dressingMaterial('ashlar'); // placeholder-art pass: dressed-stone portal (was a flat colour)
  for (const s of [-1, 1]) {
    const jamb = new THREE.Mesh(boxUV(new THREE.BoxGeometry(2.2, 6, 1.2).toNonIndexed(), 1.5), mat);
    jamb.position.set(s * 3.6, 3, 0);
    grp.add(jamb);
  }
  const lintel = new THREE.Mesh(boxUV(new THREE.BoxGeometry(9.4, 1.6, 1.2).toNonIndexed(), 1.5), mat);
  lintel.position.set(0, 5.3, 0);
  grp.add(lintel);
  const dark = new THREE.Mesh(new THREE.PlaneGeometry(5, 4.5), paintedMaterial('rock', 0x0e0c0a)); // the tunnel's dark bore
  dark.position.set(0, 2.25, -0.7);
  grp.add(dark);
  grp.position.set(x, y, z);
  grp.rotation.y = -rot + Math.PI / 2; // local +z faces out along `rot`
  for (const c of grp.children) { c.castShadow = true; c.receiveShadow = true; }
  return grp;
}

/** A plain standard material on a dressing set's maps with vertex colours (a dressing material's clone loses the
 * anti-tiling hook its program expects, and its vertex colours went unseen). Made per world build (not memoised: the
 * dressing maps are scoped to the loaded mission). */
function vertexColourMaterial(set, name) {
  const b = dressingMaterial(set);
  return new THREE.MeshStandardMaterial({ name, color: b.color, map: b.map ?? null, normalMap: b.normalMap ?? null,
    normalScale: b.normalScale, roughness: 1, metalness: 0, vertexColors: true });
}

/** A flat polygon (world x, z) at height y, facing up, UVs in metres / `tile`. */
function flatPoly(poly, y, tile = 2.5) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z))));
  g.rotateX(-Math.PI / 2); // shape (x, −z) → world (x, ·, z), the face up (a +π/2 turn faced it down: culled, unseen)
  g.translate(0, y, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile);
  return g;
}

/** `poly` densified to ~`step` m and pushed out from its centroid by `grow` m (± `jag` m of seeded raggedness). */
function raggedRing(poly, grow, jag, step, seed, keepOut = []) {
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  let k = seed;
  const rnd = () => ((k = (k * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length], n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
    for (let j = 0; j < n; j++) {
      const x = ax + ((bx - ax) * j) / n, z = az + ((bz - az) * j) / n, d = Math.hypot(x - cx, z - cz) || 1;
      let g = grow + (rnd() - 0.5) * 2 * jag;
      if (g > 0 && keepOut.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1)) g = 0; // a prop stands on the lip there
      out.push([x + ((x - cx) / d) * g, z + ((z - cz) / d) * g]);
    }
  }
  return out;
}

/** The oil crater (dossier §5.1 T13): a blown well's pool of crude with a dull sheen inside a low oil-soaked berm
 * (dark at the pool, sand at its foot), slumped dark rocks on its lip and the wellhead's bent casing stub standing
 * out of the crude. Visual only (the crater is B.LOW, not walkable, in the grid already); `keepOut` rects [x0, z0, x1,
 * z1] keep the berm off props standing on the lip (drums_y). */
function oilCrater(poly, keepOut = [], gy = () => 0) {
  const grp = new THREE.Group(); grp.name = 'm11:oil_crater';
  const R0 = raggedRing(poly, -0.3, 0.25, 1.0, 37), R1 = raggedRing(poly, 0.35, 0.25, 1.0, 23, keepOut), R2 = raggedRing(poly, 1.3, 0.45, 1.0, 11, keepOut);
  // draped on the undulating ground (Terrain.groundY): the crude's level clears the highest ground inside the pool
  let top = -Infinity;
  const xs = R0.map((p) => p[0]), zs = R0.map((p) => p[1]);
  const inPool = (x, z) => { let c = false; for (let i = 0, j = R0.length - 1; i < R0.length; j = i++) { const [xi, zi] = R0[i], [xj, zj] = R0[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 1) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 1) if (inPool(x, z)) top = Math.max(top, gy(x, z));
  for (const [x, z] of R0) top = Math.max(top, gy(x, z));
  const crudeY = top + 0.05;
  const pos = [], col = [], uv = [], idx = [], n = R0.length;
  for (const [ring, lift, c] of [[R0, null, 0.03], [R1, 0.24, 0.12], [R2, 0.02, 1.0]]) {
    for (const [x, z] of ring) {
      const y = lift == null ? crudeY + 0.005 : Math.max(gy(x, z) + lift, lift > 0.1 ? crudeY + 0.15 : -Infinity);
      pos.push(x, y, z); col.push(c, c * 0.95, c * 0.9); uv.push(x / 3, z / 3);
    }
  }
  for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) {
    const a = r * n + i, b = r * n + ((i + 1) % n), c = a + n, d = b + n;
    idx.push(a, b, c, b, d, c);
  }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  bg.setIndex(idx); bg.computeVertexNormals();
  if (bg.attributes.normal.getY(0) < 0) { bg.setIndex(idx.map((_, k) => idx[k - (k % 3) + [0, 2, 1][k % 3]])); bg.computeVertexNormals(); } // face up
  const berm = new THREE.Mesh(bg, vertexColourMaterial('sand', 'm11:crater_berm'));
  const crude = new THREE.Mesh(flatPoly(R0, crudeY, 7), paintedMaterial('mud', 0x1c1712, { roughness: 0.14, metalness: 0.2 }));
  for (const m of [berm, crude]) { m.receiveShadow = true; grp.add(m); }
  // slumped rocks on the lip, merged into one draw
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  const rocks = [];
  for (let i = 0; i < 9; i++) {
    const [px, pz] = poly[(i * 5) % poly.length], t = 0.08 + ((i * 37) % 10) / 100, r = 0.35 + ((i * 53) % 7) * 0.09;
    const g = boulderGeometry(r, r * 0.55, r * 0.8, 1101 + i * 31, 2);
    const bx = px + (cx - px) * t + ((i * 13) % 5 - 2) * 0.5, bz = pz + (cz - pz) * t + ((i * 7) % 5 - 2) * 0.4;
    g.translate(bx, crudeY + r * 0.1, bz);
    rocks.push(g);
  }
  const rk = new THREE.Mesh(mergeGeometries(rocks.map((g) => (g.index ? g.toNonIndexed() : g))), dressingMaterial('rockDark'));
  rk.castShadow = true; rk.receiveShadow = true; grp.add(rk);
  // the wellhead: a bent casing stub with a flange and a broken valve wheel, NE of the pool's middle
  const iron = dressingMaterial('castIron'), parts = [];
  const pipe = new THREE.CylinderGeometry(0.17, 0.17, 1.6, 12); pipe.rotateZ(0.32); pipe.translate(0.25, 0.7, 0); parts.push(pipe);
  const fl = new THREE.CylinderGeometry(0.3, 0.3, 0.08, 14); fl.rotateZ(0.32); fl.translate(0.5, 1.45, 0); parts.push(fl);
  const wheel = new THREE.TorusGeometry(0.26, 0.03, 5, 14); wheel.rotateY(0.9); wheel.translate(0.62, 1.62, 0.1); parts.push(wheel);
  const collar = new THREE.CylinderGeometry(0.42, 0.5, 0.25, 14); collar.translate(0, 0.08, 0); parts.push(collar);
  const wh = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))), iron);
  wh.position.set(cx + 1.5, crudeY - 0.05, cz - 1); wh.rotation.y = 0.6; wh.castShadow = true;
  grp.add(wh);
  return grp;
}

/** A dirt track along `points` ([x, z]), `width` wide, at height y (the plateau / ridge / HQ roads: the mission's
 * `terrain` paths lie on the ground under the raised levels, unseen): wheel-worn sand darker than the plateau top, two
 * ruts, 0.7 m verges fading into the plateau's sand. Mitred joins, world UVs (x / 3, z / 3, as the prism tops). */
const TRACK_SECTION = [[-0.5, 0.7, 1], [-0.5, 0, 0.62], [-0.3, 0, 0.42], [-0.18, 0, 0.55], [0, 0, 0.62], [0.18, 0, 0.55], [0.3, 0, 0.42], [0.5, 0, 0.62], [0.5, 0.7, 1]]; // (linear vertex colours)
/** Chaikin corner-cutting (ends kept): the tracks' polyline corners become curves. */
function smoothTrack(points, passes = 2) {
  let P = points;
  for (let n = 0; n < passes; n++) {
    const Q = [P[0]];
    for (let i = 0; i < P.length - 1; i++) {
      const [ax, az] = P[i], [bx, bz] = P[i + 1];
      if (i > 0) Q.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25]);
      if (i < P.length - 2) Q.push([ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    Q.push(P[P.length - 1]);
    P = Q;
  }
  return P;
}
/** One strip of a track's cross-section (`from`..`to` of TRACK_SECTION) along `points`. */
function trackStrip(points, width, y, from, to) {
  const pos = [], uv = [], col = [], idx = [], sec = TRACK_SECTION.slice(from, to + 1), S = sec.length;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz, nz = dx;
    let k = 1;
    if (i > 0 && i < points.length - 1) { // mitre: the half-width along the bisector's normal
      const ux = p[0] - a[0], uz = p[1] - a[1], ul = Math.hypot(ux, uz) || 1;
      k = 1 / Math.max(0.5, nx * (-uz / ul) + nz * (ux / ul));
    }
    for (const [f, verge, c] of sec) {
      const o = (f * width + Math.sign(f) * verge) * k, x = p[0] + nx * o, z = p[1] + nz * o;
      pos.push(x, y, z); uv.push(x / 3, z / 3); col.push(c, c * 0.97, c * 0.93);
    }
    if (i > 0) for (let j = 0; j < S - 1; j++) { const q = (i - 1) * S + j, r = q + S; idx.push(q, r, q + 1, q + 1, r, r + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) { g.setIndex(idx.map((_, k) => idx[k - (k % 3) + [0, 2, 1][k % 3]])); g.computeVertexNormals(); } // face up
  return g;
}
/**
 * The tracks as layers (one geometry): every soft verge first, then each track's worn bed a little higher than the
 * one before, so where tracks join or cross nothing z-fights (a verge never paints over a rut).
 */
function trackNetwork(tracks) {
  const last = TRACK_SECTION.length - 1, geos = [];
  const lines = tracks.map((t) => ({ ...t, pts: smoothTrack(t.points) }));
  for (const t of lines) { geos.push(trackStrip(t.pts, t.width, t.y, 0, 1), trackStrip(t.pts, t.width, t.y, last - 1, last)); }
  lines.forEach((t, k) => geos.push(trackStrip(t.pts, t.width, t.y + 0.02 + 0.012 * k, 1, last - 1)));
  return mergeGeometries(geos);
}

/** Terrain prisms, ramps, crater, portals; lifted props; placeholder cliff meshes hidden. */
export function buildVisuals(world, spec) {
  if (!world.scene || world._m11Visuals) return;
  world._m11Visuals = true;
  const root = new THREE.Group();
  root.name = 'm11:terrain';
  for (const l of spec.levels || []) root.add(prism(l.poly, l.y - 0.02));
  for (const r of spec.rocks || []) root.add(prism(r.poly, r.h, true));
  // the switchback up the escarpment: one mitred road with landings over the joint pads and retaining walls
  // (separate slabs crossed each other in blocky wedges at the joints)
  const R = spec.ramps || [];
  const chained = R.length > 1 && R.every((r, k) => k === 0 || (r.a[0] === R[k - 1].b[0] && r.a[1] === R[k - 1].b[1]));
  if (chained) root.add(terrainRampChain(R, { top: 'gravel', side: 'sandstone', pads: spec.rampPads || [] }));
  else {
    for (const p of spec.rampPads || []) root.add(rampMesh([...p.a, p.y - 0.01], [...p.b, p.y - 0.01], p.width, 0x8a7657));
    for (const r of R) root.add(rampMesh(r.a, r.b, r.width, 0x8a7657));
  }
  if (spec.crater) root.add(oilCrater(spec.crater, spec.craterKeepOut, (x, z) => (typeof world.groundY === 'function' ? world.groundY(x, z) : 0) || 0));
  // art2 pass: the dirt roads over the raised levels (ramp head → S portal loop, the ridge, the HQ plateau)
  if (spec.tracks?.length) { // one draw for all of them
    const m = new THREE.Mesh(trackNetwork(spec.tracks.map((t) => ({ ...t, y: t.y + 0.03 }))),
      vertexColourMaterial('sand', 'm11:track'));
    m.receiveShadow = true; m.name = 'm11:tracks'; root.add(m);
  }
  // the portals: the library's sandstone faces (M11 art pass, `tunnel_portal_ms`, lifted by spec.lift) when they
  // loaded; else this procedural arch, and the placeholder slab hides
  for (const p of spec.portals || []) {
    const o = p.id ? world.structures?.get(p.id)?.object3d : null;
    if (o?.getObjectByName?.('fit')) continue;
    if (o) o.visible = false;
    root.add(portalMesh(p.x, p.z, p.rot, p.y));
  }
  world.scene.add(root);
  // the quarry's explosive process tanks are Barrel entities (the schema's only explosive): dress them as the
  // white vertical oil tanks they are (the drum mesh goes; the tank goes with the entity when it blows)
  for (const id of spec.tanks || []) {
    const b = world.byId?.(id);
    // (drawn as the library's process tank already — the mission def's `asset`, map-builder's column — with its nav)
    if (!b?.object3d || b.object3d.userData.m11Tank || b.object3d.userData.libraryAsset) continue;
    b.object3d.clear();
    // M11 art pass: the library's process tank (`oil_tank_process_ms`); the procedural tank when it is not loaded
    const lib = libraryVisual('fueltank', { id, asset: 'oil_tank_process_ms', x: 0, z: 0, rot: 0, r: 1.75 }, { theater: 'desert', missionId: 'm11' });
    b.object3d.add(lib?.object3d ?? oilTankMesh(1.75, 7));
    b.object3d.userData.m11Tank = true;
  }
  // the yard's inert tanks (static structures) get the same dress
  for (const id of spec.yardTanks || []) {
    const o = world.structures?.get(id)?.object3d;
    if (!o || o.userData.m11Tank) continue;
    o.userData.m11Tank = true;
    for (const c of [...o.children]) o.remove(c);
    o.add(oilTankMesh(1.75, 7));
  }
  for (const id of spec.hide || []) { const o = world.structures?.get(id)?.object3d; if (o) o.visible = false; }
  for (const [id, y] of spec.lift || []) {
    const o = world.structures?.get(id)?.object3d;
    if (o && !o.userData.m11Lifted) { o.userData.m11Lifted = true; o.position.y += y; }
  }
}

/** Rubble filling the S portal once the tunnel has fallen (visual; the cells are blocked by the set-piece). */
export function tunnelRubble(world, at) {
  if (!world.scene || world._m11Rubble) return;
  world._m11Rubble = true;
  const mat = dressingMaterial('rock'); // placeholder-art pass: fractured boulders (were flat-colour dodecahedra)
  const grp = new THREE.Group();
  for (let k = 0; k < 9; k++) {
    const r = 0.9 + (k % 3) * 0.5;
    const m = new THREE.Mesh(boulderGeometry(r, r * 0.8, r * 0.9, 311 + k * 17, 3), mat);
    m.position.set(at[0] + ((k * 37) % 7) - 3, PLATEAU_Y + r * 0.6, at[1] + ((k * 53) % 5) - 2.5);
    m.castShadow = true;
    grp.add(m);
  }
  world.scene.add(grp);
}

/**
 * mission.script(world, director): visuals + first glue pass (the per-tick glue is a `tick` trigger). `.visuals`: the
 * scenery alone, which Game builds as the load ends (its textures resident, its programs linked); the first tick's
 * call then finds it built.
 */
export function m11Script(spec) {
  const script = (world) => {
    buildVisuals(world, spec);
    m11Tick(world);
  };
  script.visuals = (world) => buildVisuals(world, spec);
  return script;
}
