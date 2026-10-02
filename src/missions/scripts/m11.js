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
import { terrainRamp, terrainRampChain } from '../../art/kit-terrain.js';
import { dressingMaterial, boxUV, boulderGeometry } from '../../art/dressing.js';
import { paintedMaterial } from '../../art/kit-props.js';
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

/** Seeded procedural texture (DataTexture: works without a canvas): `strata` = banded rock face, else wind-rippled sand. */
function desertTexture(strata, seed) {
  const n = 256, data = new Uint8Array(n * n * 4);
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const bands = Array.from({ length: 24 }, () => 0.82 + rnd() * 0.3);
  const noise = Float32Array.from({ length: 64 * 64 }, () => rnd());
  const vn = (x, y) => { // value noise on a 64-cell lattice (tiling)
    const xi = Math.floor(x) & 63, yi = Math.floor(y) & 63, fx = x - Math.floor(x), fy = y - Math.floor(y);
    const q = (i, j) => noise[((j & 63) << 6) | (i & 63)];
    const a = q(xi, yi) + (q(xi + 1, yi) - q(xi, yi)) * fx, b = q(xi, yi + 1) + (q(xi + 1, yi + 1) - q(xi, yi + 1)) * fx;
    return a + (b - a) * fy;
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const big = vn(x / 32, y / 32), fine = vn(x / 4, y / 4);
    const v = strata
      ? bands[Math.floor((y + big * 18) / (n / 24)) % 24] * (0.78 + 0.22 * fine) * (0.9 + 0.1 * big)
      : (0.9 + 0.06 * Math.sin((x + big * 40) * 0.35)) * (0.86 + 0.14 * fine) * (0.94 + 0.12 * big);
    const c = Math.max(0, Math.min(255, Math.round(v * 225)));
    data.set([c, c, c, 255], (y * n + x) * 4);
  }
  const t = new THREE.DataTexture(data, n, n);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 12, 1 / 12); // ExtrudeGeometry UVs are in metres: one tile per 12 m
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
let _tex = null;
const textures = () => (_tex ||= { sand: desertTexture(false, 1101), rock: desertTexture(true, 1942) });

function prism(points, h, top, side, y0 = 0) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // shape (x, z) → world (x, ·, z); extrusion along −y
  g.translate(0, y0 + h, 0);
  const tx = textures();
  const m = new THREE.Mesh(g, [new THREE.MeshStandardMaterial({ color: top, map: tx.sand, roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: side, map: tx.rock, roughness: 1 })]);
  m.castShadow = true; m.receiveShadow = true;
  return m;
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

/** Terrain prisms, ramps, crater, portals; lifted props; placeholder cliff meshes hidden. */
export function buildVisuals(world, spec) {
  if (!world.scene || world._m11Visuals) return;
  world._m11Visuals = true;
  const root = new THREE.Group();
  root.name = 'm11:terrain';
  for (const l of spec.levels || []) root.add(prism(l.poly, l.y - 0.02, l.top ?? 0x9c8461, l.side ?? 0x7a6448));
  for (const r of spec.rocks || []) root.add(prism(r.poly, r.h, 0x86705a, 0x6d5a45));
  // the switchback up the escarpment: one mitred road with landings over the joint pads and retaining walls
  // (separate slabs crossed each other in blocky wedges at the joints)
  const R = spec.ramps || [];
  const chained = R.length > 1 && R.every((r, k) => k === 0 || (r.a[0] === R[k - 1].b[0] && r.a[1] === R[k - 1].b[1]));
  if (chained) root.add(terrainRampChain(R, { top: 'gravel', side: 'sandstone', pads: spec.rampPads || [] }));
  else {
    for (const p of spec.rampPads || []) root.add(rampMesh([...p.a, p.y - 0.01], [...p.b, p.y - 0.01], p.width, 0x8a7657));
    for (const r of R) root.add(rampMesh(r.a, r.b, r.width, 0x8a7657));
  }
  if (spec.crater) {
    const pool = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(spec.crater.map(([x, z]) => new THREE.Vector2(x, z)))),
      paintedMaterial('mud', 0x1a1610, { roughness: 0.18, metalness: 0.25 })); // crude oil over the crater mud (textured, glossy)
    pool.rotation.x = Math.PI / 2; pool.position.y = 0.04;
    root.add(pool);
  }
  for (const p of spec.portals || []) root.add(portalMesh(p.x, p.z, p.rot, p.y));
  world.scene.add(root);
  // the quarry's explosive process tanks are Barrel entities (the schema's only explosive): dress them as the
  // white vertical oil tanks they are (the drum mesh goes; the tank goes with the entity when it blows)
  for (const id of spec.tanks || []) {
    const b = world.byId?.(id);
    if (!b?.object3d || b.object3d.userData.m11Tank) continue;
    b.object3d.clear();
    b.object3d.add(oilTankMesh(1.75, 7));
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

/** mission.script(world, director): visuals + first glue pass (the per-tick glue is a `tick` trigger). */
export function m11Script(spec) {
  return (world) => {
    buildVisuals(world, spec);
    m11Tick(world);
  };
}
