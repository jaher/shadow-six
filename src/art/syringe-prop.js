/**
 * The Spy's syringe (lethal injection, abilities/spy.js): a 1940s 5 ml all-glass-and-metal hypodermic, modelled at
 * true size — a clear glass barrel with etched graduations and the dose inside (a pale yellow-green), nickel end caps
 * and finger flange, a Luer hub, a 30 mm steel needle with a bevelled point, and a plunger (rubber stopper, cross-ribbed
 * rod, thumb disc) that slides in as the thumb presses it (setSyringeFill). Held in a fist (needle out of the little
 * finger's side, the thumb on the disc), so the stroke is short: 37 mm. Replaces the weapons_b 'syringe' prop for
 * the commandos_b runtime (art/humanoid-real.js), so the same model is drawn for the classic jab too.
 *
 * Weapon space (as every prop of weapons.glb): +Z toward the needle point, origin = the grip (the middle of the barrel),
 * sockets 'syringe_grip_r' (origin), 'syringe_tip' (the needle point) and 'syringe_thumb' (the thumb disc's face, it
 * moves with the plunger).
 * @module art/syringe-prop
 */
import * as THREE from 'three';

/** Dimensions (m). */
export const SYRINGE = Object.freeze({
  r: 0.0075, barrel: 0.05,           // glass barrel (outer radius, length): -barrel/2 .. +barrel/2
  needle: 0.03, needleR: 0.0005,     // the needle beyond the hub
  hub: 0.011,                        // nozzle cap + Luer hub
  travel: 0.037,                     // plunger stroke from full to empty (the stopper home against the nozzle)
});
const B2 = SYRINGE.barrel / 2;
/** z of the needle point. */
export const TIP_Z = B2 + 0.004 + SYRINGE.hub + SYRINGE.needle;
/** z of the thumb disc's face when full (the plunger drawn out). */
export const THUMB_Z_FULL = -B2 - 0.004 - 0.044;

let MATS = null;
function mats() {
  if (MATS) return MATS;
  const std = (name, o) => Object.assign(new THREE.MeshStandardMaterial(o), { name });
  MATS = {
    glass: std('syringe_glass', { color: 0xe4f1f3, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.3, depthWrite: false }),
    rim: std('syringe_rim', { color: 0xdfeff0, roughness: 0.1, transparent: true, opacity: 0.55, depthWrite: false }),
    dose: std('syringe_dose', { color: 0xc9d27a, roughness: 0.15, transparent: true, opacity: 0.72, emissive: 0x1d2208 }),
    nickel: std('syringe_nickel', { color: 0xd0d0cc, roughness: 0.22, metalness: 0.95 }),
    steel: std('syringe_steel', { color: 0xe8e8ea, roughness: 0.12, metalness: 1.0 }),
    rubber: std('syringe_rubber', { color: 0x1b1b1b, roughness: 0.7 }),
    ink: std('syringe_ink', { color: 0x2a2a2a, roughness: 0.6 }),
  };
  return MATS;
}

const alongZ = (geo) => geo.rotateX(Math.PI / 2); // three's cylinders run along Y

/** Build one syringe (a fresh group: its plunger moves per instance). */
export function buildSyringe() {
  const M = mats(), S = SYRINGE, g = new THREE.Group();
  g.name = 'syringe';
  // glass barrel: the tube, its thick rims, the etched scale (11 ticks, every 5th longer) and the dose inside
  const tube = new THREE.Mesh(alongZ(new THREE.CylinderGeometry(S.r, S.r, S.barrel, 22, 1, true)), M.glass);
  tube.renderOrder = 2; tube.name = 'syringe_barrel';
  const rimF = new THREE.Mesh(new THREE.TorusGeometry(S.r - 0.0006, 0.0009, 6, 22), M.rim); // a ring about +Z
  rimF.position.z = B2 - 0.001;
  const rimB = rimF.clone(); rimB.position.z = -B2 + 0.001;
  const ticks = [];
  for (let k = 0; k <= 10; k++) {
    const long = k % 5 === 0, t = new THREE.BoxGeometry(long ? 0.0062 : 0.0036, 0.0004, 0.0006);
    t.translate(0, S.r + 0.0001, B2 - 0.005 - k * 0.0037);
    ticks.push(t);
  }
  const scale = new THREE.Mesh(merge(ticks), M.ink); scale.name = 'syringe_scale';
  const dose = new THREE.Mesh(alongZ(new THREE.CylinderGeometry(S.r - 0.0012, S.r - 0.0012, 1, 18)), M.dose);
  dose.name = 'syringe_dose'; dose.renderOrder = 1;
  // nickel: the nozzle cap and Luer hub at the front, the back cap with the finger flange
  const capF = new THREE.Mesh(alongZ(new THREE.CylinderGeometry(S.r + 0.0006, S.r + 0.0006, 0.004, 20)), M.nickel);
  capF.position.z = B2 + 0.002;
  const nozzle = new THREE.Mesh(alongZ(new THREE.CylinderGeometry(0.0021, 0.0042, S.hub - 0.003, 14)), M.nickel);
  nozzle.position.z = B2 + 0.004 + (S.hub - 0.003) / 2;
  const hub = new THREE.Mesh(alongZ(new THREE.CylinderGeometry(0.0016, 0.0024, 0.003, 10)), M.nickel);
  hub.position.z = B2 + 0.004 + S.hub - 0.0015;
  const needle = new THREE.Mesh(alongZ(new THREE.CylinderGeometry(S.needleR, S.needleR, S.needle - 0.003, 8)), M.steel);
  needle.position.z = B2 + 0.004 + S.hub + (S.needle - 0.003) / 2; needle.name = 'syringe_needle';
  const bevel = new THREE.Mesh(alongZ(new THREE.ConeGeometry(S.needleR, 0.003, 8)), M.steel);
  bevel.position.z = TIP_Z - 0.0015; bevel.name = 'syringe_bevel';
  const capB = new THREE.Mesh(alongZ(new THREE.CylinderGeometry(S.r + 0.0006, S.r + 0.0006, 0.004, 20)), M.nickel);
  capB.position.z = -B2 - 0.002;
  const flange = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.0028, 0.012), M.nickel);
  flange.position.z = -B2 - 0.002; flange.name = 'syringe_flange';
  for (const s of [-1, 1]) { // rolled flange ends (finger rests)
    const end = new THREE.Mesh(alongZ(new THREE.CylinderGeometry(0.0025, 0.0025, 0.012, 8)), M.nickel);
    end.position.set(s * 0.019, 0, 0);
    flange.add(end);
  }
  // plunger (drawn out = full): rubber stopper inside the barrel, a cross-ribbed rod out the back, the thumb disc
  const plunger = new THREE.Group(); plunger.name = 'syringe_plunger';
  const stopper = new THREE.Mesh(alongZ(new THREE.CylinderGeometry(S.r - 0.0011, S.r - 0.0011, 0.006, 18)), M.rubber);
  stopper.position.z = -B2 + 0.006 + 0.003;
  const z0 = -B2 + 0.006, z1 = THUMB_Z_FULL + 0.0025, rodL = z0 - z1; // stopper's back face to the disc
  const rib1 = new THREE.Mesh(new THREE.BoxGeometry(0.0062, 0.0014, rodL), M.nickel);
  const rib2 = new THREE.Mesh(new THREE.BoxGeometry(0.0014, 0.0062, rodL), M.nickel);
  rib1.position.z = rib2.position.z = (z0 + z1) / 2;
  const disc = new THREE.Mesh(alongZ(new THREE.CylinderGeometry(0.0095, 0.0095, 0.0025, 20)), M.nickel);
  disc.position.z = THUMB_Z_FULL + 0.00125;
  plunger.add(stopper, rib1, rib2, disc);
  const sock = (name, z) => { const o = new THREE.Object3D(); o.name = name; o.position.z = z; return o; };
  const thumb = sock('syringe_thumb', THUMB_Z_FULL); plunger.add(thumb);
  g.add(tube, rimF, rimB, scale, dose, capF, nozzle, hub, needle, bevel, capB, flange, plunger, sock('syringe_grip_r', 0), sock('syringe_tip', TIP_Z));
  g.traverse((o) => { if (o.isMesh) { o.castShadow = o.material !== M.glass && o.material !== M.rim; o.receiveShadow = false; } });
  setSyringeFill(g, 1);
  return g;
}

/**
 * Plunger position: 1 = full (drawn out), 0 = empty (pressed home). Works on any clone (finds its parts by name).
 * @param {THREE.Object3D} g @param {number} k
 */
export function setSyringeFill(g, k) {
  k = Math.min(1, Math.max(0, k));
  const S = SYRINGE, p = g.getObjectByName('syringe_plunger'), d = g.getObjectByName('syringe_dose');
  const push = (1 - k) * S.travel;
  if (p) p.position.z = push;
  if (d) {   // the dose between the stopper's face and the nozzle
    const z0 = -B2 + 0.012 + push, z1 = B2 - 0.001, len = Math.max(1e-4, z1 - z0);
    d.scale.set(1, 1, len); d.position.z = (z0 + z1) / 2; d.visible = len > 6e-4;
  }
  g.userData.fill = k;
}

function merge(list) {
  let n = 0, ni = 0;
  for (const q of list) { n += q.attributes.position.count; ni += q.index.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), idx = new Uint16Array(ni);
  let o = 0, oi = 0;
  for (const q of list) {
    pos.set(q.attributes.position.array, o * 3); nor.set(q.attributes.normal.array, o * 3);
    for (let k = 0; k < q.index.count; k++) idx[oi + k] = q.index.array[k] + o;
    o += q.attributes.position.count; oi += q.index.count;
    q.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

/** The weapons-library entry for the commandos_b runtime (`equip` clones `root` and finds its sockets by name). */
export function syringeWeapon() {
  const root = buildSyringe();
  const sockets = {};
  root.traverse((c) => { const m = c.name.match(/(grip_r|tip)$/); if (m && c !== root) sockets[m[1]] = c; });
  return { root, sockets };
}
