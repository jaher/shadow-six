/**
 * Timber MG platform (watchtower variant `mg_platform`, M2 towers t1 / t2 after the original's open MG stands): four
 * splayed log legs on concrete pads, two tiers of plank X-bracing and girts, joists and a plank deck at `deckY`, a
 * sandbag parapet round the deck edge (open at the ladder), corner posts with a hand rail, a ladder up the back
 * (the `climbable` interactable's side, local +z), and an MG 34 on its Lafette 34 tripod laid over the front parapet
 * (local +x = the post heading; it traverses with the gunner kneeling behind it, render/mg-mount.js) with ammo boxes. Snow on top faces comes from the scene's prop snow cover.
 * Local frame: origin on the ground at the tower centre, deck top at y = deckY.
 * @module art/mg-platform
 */

import * as THREE from 'three';
import { dressingMaterial, buildSandbags } from './dressing.js';

let GUN = null, GUN_WOOD = null, AMMO = null;
const gunMat = () => (GUN ||= Object.assign(new THREE.MeshStandardMaterial({ color: 0x24231f, roughness: 0.42, metalness: 0.75 }), { name: 'mgp:gunmetal' }));
const woodMat = () => (GUN_WOOD ||= Object.assign(new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.6, metalness: 0 }), { name: 'mgp:stock' }));
const ammoMat = () => (AMMO ||= Object.assign(new THREE.MeshStandardMaterial({ color: 0x4a4d3c, roughness: 0.6, metalness: 0.45 }), { name: 'mgp:ammo' }));

function mk(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}

/** A beam (box) from a to b ([x, y, z]), cross-section sw × sh, its sh side kept as level as the beam allows. */
function beam(a, b, sw, sh, mat) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
  const m = mk(new THREE.BoxGeometry(sw, L, sh), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}
/** A round log from a to b (radii ra at a, rb at b). */
function log(a, b, ra, rb, mat) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
  const m = mk(new THREE.CylinderGeometry(rb, ra, L, 10), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

/**
 * MG 34 on a Lafette 34 tripod, muzzle along +x; origin on the floor under the tripod's front feet. ~1.2 m gun.
 * @param {number} lift height of the gun's bore above the floor
 */
export function buildMg34Tripod(lift = 0.95) {
  const g = new THREE.Group(); g.name = 'mg34-tripod';
  const G = gunMat(), y = lift;
  // tripod: two front legs splayed, one long rear leg, the cradle on top
  const head = [-0.05, y - 0.16, 0];
  for (const sz of [-1, 1]) g.add(log([0.26, 0.02, sz * 0.34], head, 0.018, 0.02, G));
  g.add(log([-0.4, 0.02, 0], head, 0.02, 0.022, G));   // the rear leg runs back under the kneeling gunner's knee
  g.add(mk(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 10), G).translateX(head[0]).translateY(head[1]));
  const cradle = mk(new THREE.BoxGeometry(0.42, 0.05, 0.08), G); cradle.position.set(0, y - 0.09, 0); g.add(cradle);
  // gun: receiver, feed cover, perforated barrel jacket, barrel + muzzle booster, butt stock, pistol grip, drum
  const rec = mk(new THREE.BoxGeometry(0.42, 0.075, 0.055), G); rec.position.set(0, y, 0); g.add(rec);
  const cover = mk(new THREE.BoxGeometry(0.2, 0.03, 0.07), G); cover.position.set(0.02, y + 0.05, 0); g.add(cover);
  const jacket = mk(new THREE.CylinderGeometry(0.026, 0.026, 0.42, 12), G); jacket.rotation.z = Math.PI / 2; jacket.position.set(0.42, y + 0.005, 0); g.add(jacket);
  for (let k = 0; k < 5; k++) { // jacket cooling slots (dark rings)
    const r = mk(new THREE.TorusGeometry(0.0262, 0.004, 4, 12), new THREE.MeshStandardMaterial({ color: 0x0c0c0b, roughness: 0.8 }), false);
    r.rotation.y = Math.PI / 2; r.position.set(0.28 + k * 0.07, y + 0.005, 0); g.add(r);
  }
  const bar = mk(new THREE.CylinderGeometry(0.011, 0.011, 0.14, 8), G); bar.rotation.z = Math.PI / 2; bar.position.set(0.7, y + 0.005, 0); g.add(bar);
  const muz = mk(new THREE.CylinderGeometry(0.02, 0.016, 0.07, 10), G); muz.rotation.z = Math.PI / 2; muz.position.set(0.79, y + 0.005, 0); g.add(muz);
  const sight = mk(new THREE.BoxGeometry(0.012, 0.05, 0.012), G); sight.position.set(0.6, y + 0.045, 0); g.add(sight);
  const stock = mk(new THREE.BoxGeometry(0.34, 0.07, 0.045), woodMat()); stock.position.set(-0.37, y - 0.025, 0); stock.rotation.z = 0.08; g.add(stock);
  const butt = mk(new THREE.BoxGeometry(0.05, 0.13, 0.05), woodMat()); butt.position.set(-0.55, y - 0.045, 0); g.add(butt);
  const grip = mk(new THREE.BoxGeometry(0.04, 0.11, 0.035), woodMat()); grip.position.set(-0.12, y - 0.08, 0); grip.rotation.z = -0.25; g.add(grip);
  const drum = mk(new THREE.CylinderGeometry(0.065, 0.065, 0.1, 14), ammoMat()); drum.rotation.x = Math.PI / 2; drum.position.set(0.04, y - 0.02, -0.09); g.add(drum);
  // the belt from the drum into the feed
  const belt = mk(new THREE.BoxGeometry(0.05, 0.012, 0.06), new THREE.MeshStandardMaterial({ color: 0x8a6a2a, roughness: 0.45, metalness: 0.6 }), false);
  belt.position.set(0.04, y + 0.02, -0.045); g.add(belt);
  return g;
}

/**
 * How a gunner works the platform MG (render/mg-mount.js): the mount's origin is the kneeling gunner's root (the unit
 * position), the tripod stands `off` m ahead of him along his facing, the bore is `bore` m above the deck and the muzzle
 * `muzzle` m ahead of him — the flash and tracer start there.
 */
export const MG_MOUNT = { off: 0.62, bore: 1.0, muzzle: 0.62 + 0.825 };

/**
 * The crewed MG: tripod + gun turned as one about the gunner (who kneels behind the butt), with IK markers for his
 * hands — `grip` (pistol grip, right hand) and `support` (top of the butt stock, left hand). Muzzle along +x.
 */
export function buildMgMount() {
  const g = new THREE.Group(); g.name = 'mg34-mount';
  const gun = buildMg34Tripod(MG_MOUNT.bore); gun.position.x = MG_MOUNT.off; g.add(gun);
  const y = MG_MOUNT.bore, mark = (name, x, yy) => { const o = new THREE.Object3D(); o.name = name; o.position.set(MG_MOUNT.off + x, yy, 0); g.add(o); };
  mark('grip', -0.12, y - 0.075); mark('support', -0.4, y + 0.0);
  g.userData.mount = MG_MOUNT;
  // the gunner's hands grip it and his knee sits by the rear leg (intended contact, like a driver in his cab): the clip
  // audit leaves the crewed gun out; its traverse clears the parapet by construction (front feet 0.88 m from the
  // centre against the bags' inner face at 1.12 m, the bore 0.1 m over their top)
  g.userData.clip = false;
  return g;
}

/** Patronenkasten 34: a steel ammo box with a carry handle. */
function ammoBox() {
  const g = new THREE.Group();
  g.add(mk(new THREE.BoxGeometry(0.27, 0.16, 0.1), ammoMat()).translateY(0.08));
  const h = mk(new THREE.TorusGeometry(0.035, 0.006, 4, 10, Math.PI), gunMat(), false); h.position.set(0, 0.16, 0); g.add(h);
  return g;
}

/**
 * The open timber MG platform. @param {{w?:number, d?:number, h?:number, deckY?:number, id?:string}} p
 * @returns {THREE.Group}
 */
export function buildMgPlatform(p) {
  const w = p.w ?? 3, d = p.d ?? 3, Y = p.deckY ?? p.h ?? 5.5, hw = w / 2, hd = d / 2;
  const root = new THREE.Group(); root.name = 'mg-platform';
  const logs = dressingMaterial('logs'), tar = dressingMaterial('logsTarred'), planks = dressingMaterial('planks'), conc = dressingMaterial('concrete');
  // legs: splayed logs from the footprint corners in to the deck frame
  const foot = (sx, sz) => [sx * (hw - 0.14), 0, sz * (hd - 0.14)], top = (sx, sz) => [sx * (hw - 0.34), Y - 0.2, sz * (hd - 0.34)];
  const at = (sx, sz, y) => { const a = foot(sx, sz), b = top(sx, sz), t = y / b[1]; return [a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t]; };
  const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of C) {
    root.add(log(foot(sx, sz), top(sx, sz), 0.12, 0.1, logs));
    const pad = mk(new THREE.BoxGeometry(0.46, 0.22, 0.46), conc); pad.position.set(foot(sx, sz)[0], 0.07, foot(sx, sz)[2]); root.add(pad);
  }
  // girts at three heights, plank X-braces in the two tiers between them (on the outer faces)
  const tiers = [0.4, Y * 0.5, Y - 0.42];
  for (let f = 0; f < 4; f++) {
    const [ax, az] = C[f], [bx, bz] = C[(f + 1) % 4], nx = (ax + bx) / 2, nz = (az + bz) / 2; // face normal (±1, 0) / (0, ±1)
    const out = (q, o) => [q[0] + nx * o, q[1], q[2] + nz * o];
    for (const y of tiers) root.add(beam(out(at(ax, az, y), 0.1), out(at(bx, bz, y), 0.1), 0.1, 0.16, tar));
    for (let t = 0; t + 1 < tiers.length; t++) {
      const y0 = tiers[t] + 0.08, y1 = tiers[t + 1] - 0.08;
      root.add(beam(out(at(ax, az, y0), 0.17), out(at(bx, bz, y1), 0.17), 0.04, 0.15, planks));
      root.add(beam(out(at(bx, bz, y0), 0.21), out(at(ax, az, y1), 0.21), 0.04, 0.15, planks));
    }
  }
  // deck frame: two bearers on the leg heads, three joists across them, the plank deck (top at Y) overhanging a little
  for (const sx of [-1, 1]) { const b = mk(new THREE.BoxGeometry(0.18, 0.2, d - 0.3), tar); b.position.set(sx * (hw - 0.34), Y - 0.3, 0); root.add(b); }
  for (const z of [-(hd - 0.3), 0, hd - 0.3]) { const j = mk(new THREE.BoxGeometry(w - 0.1, 0.15, 0.12), tar); j.position.set(0, Y - 0.125, z); root.add(j); }
  const n = Math.round(w / 0.2), pw = w / n;
  for (let i = 0; i < n; i++) {
    const pl = mk(new THREE.BoxGeometry(pw - 0.012, 0.05, d - 0.04 * ((i * 7) % 3)), planks);
    pl.position.set(-hw + pw * (i + 0.5), Y - 0.025, 0.02 * ((i * 5) % 3 - 1)); root.add(pl);
  }
  // sandbag parapet round the deck edge, 0.8 m, open at the ladder (local +z, x ∈ [−0.42, 0.42])
  const bags = (len, x, z, yaw, id) => { const s = buildSandbags({ w: len, h: 0.8, id: `${p.id ?? 'mgp'}:${id}` }); s.position.set(x, Y, z); s.rotation.y = yaw; root.add(s); };
  const ins = 0.22, L = w - 2 * ins;
  bags(L, hw - ins, 0, Math.PI / 2, 'front');
  bags(L - 0.34, -(hw - ins), 0, Math.PI / 2, 'back');
  bags(L - 0.34, 0, -(hd - ins), 0, 'left');
  const gap = 0.42, seg = (hw - ins - 0.17) - gap;
  for (const s of [-1, 1]) bags(seg, s * (gap + seg / 2), hd - ins, 0, `right${s}`);
  // corner posts + hand rail above the bags
  const rail = Y + 1.08;
  for (const [sx, sz] of C) root.add(beam([sx * (hw - 0.06), Y - 0.05, sz * (hd - 0.06)], [sx * (hw - 0.06), rail + 0.06, sz * (hd - 0.06)], 0.11, 0.11, tar));
  for (let f = 0; f < 4; f++) {
    const [ax, az] = C[f], [bx, bz] = C[(f + 1) % 4], A = [ax * (hw - 0.06), rail, az * (hd - 0.06)], B = [bx * (hw - 0.06), rail, bz * (hd - 0.06)];
    if (az === 1 && bz === 1) { // the ladder side: rail stops either side of the opening
      root.add(beam(A, [gap * Math.sign(ax), rail, A[2]], 0.07, 0.06, planks));
      root.add(beam([gap * Math.sign(bx), rail, B[2]], B, 0.07, 0.06, planks));
    } else root.add(beam(A, B, 0.07, 0.06, planks));
  }
  // ladder up the back: two rails from the ground to above the deck edge, rungs every 0.3 m
  const lz0 = hd + 0.55, lz1 = hd + 0.04, ltop = Y + 0.95;
  for (const sx of [-0.24, 0.24]) root.add(beam([sx, 0, lz0], [sx, ltop, lz1 - (lz0 - lz1) * (0.95 / Y)], 0.06, 0.09, logs));
  for (let y = 0.3; y < Y - 0.05; y += 0.3) { const z = lz0 + (lz1 - lz0) * (y / Y); root.add(beam([-0.24, y, z], [0.24, y, z], 0.035, 0.035, tar)); }
  // the MG 34 on its tripod (bore over the bags), turned with the gunner who kneels behind it at the deck centre
  // (render/mg-mount.js follows his heading; it stays where he last laid it when he is gone), ammo boxes, a barrel case
  const mg = buildMgMount(); mg.position.set(0, Y, 0); root.add(mg);
  for (const [x, z, a] of [[-(hw - 0.56), 0.5, 0.3], [-(hw - 0.72), 0.86, 1.4], [-(hw - 0.62), -(hd - 0.62), 0.1]]) { const b = ammoBox(); b.position.set(x, Y, z); b.rotation.y = a; root.add(b); }
  const tube = mk(new THREE.CylinderGeometry(0.045, 0.045, 0.7, 10), ammoMat()); tube.rotation.z = Math.PI / 2; tube.rotation.y = 0.2; tube.position.set(-0.55, Y + 0.05, -(hd - 0.55)); root.add(tube);
  root.userData.deckY = Y;
  return root;
}
