/**
 * BEL Mission 20 "Operation Valhalla": mission-local glue (docs/missions/m20.md §4, §6.1, §14). Owned by MISSIONS.
 * Installed once by `mission.script` (after the set-pieces' lazy init; called again on a quick load):
 *
 *  - the team starts prone behind its two rocks (the spawn `stance` is not read by the engine);
 *  - visuals (browser only): the castle's raised levels (`cliff` structures with walkways, ids `t_*`) are drawn as
 *    stone prisms, their placeholder meshes hidden; structures carrying `baseY` (the château, its wing, the stair
 *    block, the terrace Flak, guns, crates and searchlights) are lifted onto their level; every `ladders[]` entry
 *    gets a simple mesh: a stone flight (`kind: 'stairs'`), a timber plank over an arch (`kind: 'plank'`) or a
 *    ladder; the N court's two army wagons (`train_car` props) get a wagon mesh in place of the prop builder's
 *    hut. Everything is read from `world.mission`, so this module holds no layout of its own. With the art pass on
 *    (M20_ART) the prisms, flights, ladders and wagons are left to scripts/m20-art.js (detailed masonry, art/castle-kit.js).
 *  - the anti-tank gun (§6.2, §14 E5/E7): its linked gunner e55 is out of knife and syringe reach (`elevated`, set
 *    here: the engine does not read it from the spawn), and while he lives the gun fires its cannon at the Panzer III
 *    once a commando at its controls moves it and he sees it (a linked emplacement gunner's brain
 *    only fires his personal weapon, which does nothing to armour). He holds fire while the Driver only sits in
 *    it: the first move draws the shot. One shell destroys the tank (T6 fails);
 * The mission's rules (roof rule off, the S-corner alarm, the charge guard) live in the mission def.
 * @module missions/scripts/m20
 */

import * as THREE from 'three';
import { canSee } from '../../ai/perception.js';
import { buildM20Art } from './m20-art.js';

const STONE_TOP = 0x8a8472, STONE_SIDE = 0x6f6a5a;
/** Detailed castle art (m20-art.js) in place of the plain level prisms. */
const M20_ART = true;

/** An extruded polygon from y 0 to `h` (top and side materials). */
function prism(poly, h, top = STONE_TOP, side = STONE_SIDE) {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  geo.rotateX(Math.PI / 2); // shape (x, z) → world (x, ·, z); extrusion along −y
  geo.translate(0, h, 0);
  const m = new THREE.Mesh(geo, [new THREE.MeshStandardMaterial({ color: top, roughness: 0.95 }), new THREE.MeshStandardMaterial({ color: side, roughness: 1 })]);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** A box spanning a to b (world points with y), `w` wide and `t` thick. */
function span(a, b, w, t, color) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz) || 0.01;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, t, L), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  m.lookAt(b.x, b.y, b.z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Stair flights, planks and ladders for every `ladders[]` entry. */
function linkMeshes(root, ladders) {
  for (const l of ladders || []) {
    const a = { x: l.x, y: l.y ?? 0, z: l.z }, b = { x: l.top[0], y: l.top[2] ?? 0, z: l.top[1] };
    if (M20_ART && l.kind !== 'plank') continue; // stone flights and timber ladders: m20-art.js
    if (l.kind === 'stairs') {
      const flight = span(a, b, 1.8, 0.5, 0x7d7766);
      root.add(flight);
      // a solid wedge under the flight so it reads as masonry
      const low = Math.min(a.y, b.y);
      if (Math.abs(b.y - a.y) > 0.5) root.add(span({ ...a, y: (a.y + low) / 2 }, { ...b, y: (b.y + low) / 2 }, 1.7, Math.abs(b.y - a.y) / 2, 0x6f6a5a));
    } else if (l.kind === 'plank') root.add(span({ ...a, y: a.y - 0.1 }, { ...b, y: b.y - 0.1 }, 1.4, 0.2, 0x5b4a36));
    else {
      for (const s of [-0.25, 0.25]) {
        const off = { x: Math.cos((l.heading ?? 0) + Math.PI / 2) * s, z: Math.sin((l.heading ?? 0) + Math.PI / 2) * s };
        root.add(span({ x: a.x + off.x, y: a.y, z: a.z + off.z }, { x: b.x + off.x, y: b.y, z: b.z + off.z }, 0.06, 0.06, 0x4a3b2a));
      }
    }
  }
}

/**
 * A horse-drawn army wagon (the N court's `train_car` props, which the prop builder draws as huts): a plank bed on
 * four spoked-looking wheels, a drawbar and, for `covered_*` variants, a canvas hood. Sized from the def.
 */
export function wagonMesh(def) {
  const g = new THREE.Group();
  const L = def.w ?? 5, W = def.d ?? 2.5, H = def.h ?? 2.5;
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 });
  const bedY = 0.9, bed = new THREE.Mesh(new THREE.BoxGeometry(L * 0.8, 0.5, W * 0.85), wood);
  bed.position.set(0, bedY, 0); g.add(bed);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 14), wood);
    wh.rotation.x = Math.PI / 2; wh.position.set(sx * L * 0.28, 0.55, sz * W * 0.45); g.add(wh);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(L * 0.3, 0.1, 0.12), wood);
  bar.position.set(L * 0.52, 0.7, 0); g.add(bar);
  if (/covered/.test(def.variant || '')) {
    const geo = new THREE.CylinderGeometry(W * 0.42, W * 0.42, L * 0.75, 16, 1, false, 0, Math.PI);
    geo.rotateZ(Math.PI / 2); // axis along the wagon (local X), the half-shell on top (+Y)
    const hood = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: /shells/.test(def.variant) ? 0x6b6a4f : 0x8a8466, roughness: 1, side: THREE.DoubleSide }));
    hood.position.set(0, bedY + 0.25, 0); hood.scale.set(1, Math.max(0.6, (H - bedY - 0.25) / (W * 0.42)), 1); g.add(hood);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(def.x, 0, def.z);
  g.rotation.y = -(def.rot ?? 0);
  g.name = `m20:wagon:${def.id}`;
  return g;
}

/** Build the castle's level prisms, lift the terrace props and draw the links (idempotent per world). */
export function buildCastleVisuals(w) {
  if (!w.scene || w._m20Visuals) return;
  w._m20Visuals = true;
  const m = w.mission || {};
  const root = new THREE.Group();
  root.name = 'm20:castle';
  for (const s of m.structures || []) {
    if (s.type !== 'cliff' || !/^t_/.test(s.id || '')) continue;
    if (!M20_ART) root.add(prism(s.points, s.h - 0.02)); // the art pass (m20-art.js) draws the masonry
    const o = w.structures?.get?.(s.id)?.object3d;
    if (o) o.visible = false;
  }
  linkMeshes(root, m.ladders);
  for (const s of m.structures || []) {
    if (s.type !== 'train_car') continue;
    if (!M20_ART) root.add(wagonMesh(s)); // the art pass draws army field wagons (castle-kit buildFieldWagon)
    const o = w.structures?.get?.(s.id)?.object3d;
    if (o) o.visible = false;
  }
  w.scene.add(root);
  for (const s of m.structures || []) {
    if (!(s.baseY > 0)) continue;
    const o = w.structures?.get?.(s.id)?.object3d;
    if (o) liftOnto(o, s.baseY);
  }
  buildM20Art(w);
}

/**
 * Lift a structure visual onto its level (once). The map builder hangs a timber deck (`dressing:walkway`) on a
 * structure with `walkways` at the walkway's WORLD height, before this lift: lifted with the model it would float
 * `baseY` above the walk (the HQ roof ledge: a plank deck at y 33 on 20 m posts over the y-20 roof). A lifted
 * structure is a library model that carries its own walk surface, so the deck is dropped.
 */
export function liftOnto(o, baseY) {
  if (o.userData.m20Lifted) return;
  o.userData.m20Lifted = true;
  for (const c of [...o.children]) if (c.name === 'dressing:walkway') o.remove(c);
  o.position.y += baseY;
}

/** s: the AT gunner's reaction once the manned tank first moves. */
export const AT_REACTION = 1.0;

/**
 * The AT gun's cannon on the Panzer III while its gunner lives (per 20 Hz tick): it opens up once the tank,
 * manned, first moves (turns or drives), as in the original; boarding alone, even in his sight, draws no fire.
 * @returns {boolean} fired
 */
export function atGunTick(w) {
  const gun = w.byId?.('atgun'), tank = w.byId?.('pz3');
  if (!gun || gun.destroyed || !tank || tank.destroyed) return false;
  if (tank.operator && (tank.goal || Math.abs(tank.speed || 0) > 0.05)) tank._m20Moved = true; // turning or driving
  const g = gun.gunnerEnemy;
  // the engine's gunner brain fires on a manned or tainted vehicle at once: until the first move keep him
  // aiming (his aim timer held at the gun's reaction time, so the shell comes ~1 s after the tank moves off)
  if (!tank._m20Moved && g?.brain && g.alive !== false) g.brain.aimT = Math.max(g.brain.aimT || 0, AT_REACTION);
  if (!tank.operator || !tank._m20Moved) return false; // a boarding he saw (taint) waits for the first move too
  if (!g || g.alive === false || canSee(g, tank, w, { dynamic: false }) === 'none') return false;
  return gun.fireAt(tank) === true;
}

/** mission.script: installed once per world (a quick load re-runs it on the rebuilt world). */
export function m20Script(w) {
  if ((w.time ?? 0) < 0.5) for (const c of w.commandos || []) if (c.alive !== false && c.stance === 'stand') c.setStance?.('crawl');
  const e55 = w.byId?.('e55');
  if (e55) e55.elevated = true; // §14 E5: knife and syringe refuse the gunner in his emplacement
  buildCastleVisuals(w);
  w.onBelTick(() => atGunTick(w));
}
