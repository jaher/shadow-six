/**
 * The Green Beret's acoustic decoy (design-spec §3.4), modelled as the vintage portable box radio of its
 * knapsack icon (tools/blender/icons/models/boxes.py `decoy()` — brown leatherette case, a big round
 * speaker grille, knob, toggle and whip aerial), not the plain olive cylinder it was planted as before.
 *
 * Dimensions (metres; converted from the Blender model's mm):
 *   case 0.110 (x) x 0.120 (y) x 0.070 (z), centre y = 0.060
 *   top trim 0.112 x 0.004 x 0.072 at y = 0.118
 *   speaker cloth disc r = 0.038 on the +z face, centre y = 0.056
 *   bezel torus r = 0.039, tube 0.0035 at z = 0.0365
 *   grille rings r = 0.012 / 0.021 / 0.030, tube 0.0016 at z = 0.037
 *   centre cap r = 0.006 at z = 0.0375
 *   top knob r = 0.009 at (-0.030, 0.125, -0.010), washer r = 0.011 at y = 0.1205
 *   toggle switch at (0.022, ~0.124, +0.006), lever length 0.022
 *   whip aerial base r = 0.005 at (0.040, 0.125, -0.022), whip to y ~ 0.234
 *
 * Local frame (three.js): x right, y up, z FRONT. The speaker faces +z.
 * The base sits on y = 0. Everything is built at real size, then the whole
 * group is scaled by DECOY_SCALE = 1.5 (the project oversizes small props so
 * they read at gameplay camera distance).
 *
 * API:
 *   export const DECOY_SCALE = 1.5;
 *   export function makeDecoy() -> THREE.Group   // group.name === 'decoy'
 *   group.userData.decoy = { setOn(on) }         // flips the toggle lever
 *                                                // OFF = +25 deg (front), ON = -25 deg (back)
 *
 * @module art/decoy
 */

import * as THREE from 'three';

export const DECOY_SCALE = 1.5;

// ---------------------------------------------------------------------------
// Shared materials (lazy singleton). Entity.dispose keeps shared materials.
// ---------------------------------------------------------------------------
const M = {};
function mats() {
  if (M.case) return M;
  M.case = new THREE.MeshStandardMaterial({
    name: 'decoy:case',
    color: 0x8a6844,
    roughness: 0.75,
    metalness: 0.0,
  });
  M.nickel = new THREE.MeshStandardMaterial({
    name: 'decoy:nickel',
    color: 0xa9aaa6,
    roughness: 0.3,
    metalness: 0.9,
  });
  M.cloth = new THREE.MeshStandardMaterial({
    name: 'decoy:cloth',
    color: 0xb0a58e,
    roughness: 0.95,
    metalness: 0.0,
  });
  M.grille = new THREE.MeshStandardMaterial({
    name: 'decoy:grille',
    color: 0x8f9096,
    roughness: 0.35,
    metalness: 0.85,
  });
  M.bakelite = new THREE.MeshStandardMaterial({
    name: 'decoy:bakelite',
    color: 0x1c1a18,
    roughness: 0.35,
    metalness: 0.0,
  });
  for (const m of Object.values(M)) m.userData.shared = true;
  return M;
}

// ---------------------------------------------------------------------------
// Shared geometries (lazy singleton). Entity.dispose keeps shared geometries.
// ---------------------------------------------------------------------------
const G = {};
function geos() {
  if (G.case) return G;

  G.case = new THREE.BoxGeometry(0.110, 0.120, 0.070);
  G.trim = new THREE.BoxGeometry(0.112, 0.004, 0.072);

  // Speaker disc: cylinder whose axis is z (rotate x by 90 deg).
  G.clothDisc = new THREE.CylinderGeometry(0.038, 0.038, 0.003, 40);

  // Bezel + concentric grille rings (tori already lie in the xy plane).
  G.bezel = new THREE.TorusGeometry(0.039, 0.0035, 10, 48);
  G.grille0 = new THREE.TorusGeometry(0.012, 0.0016, 6, 36);
  G.grille1 = new THREE.TorusGeometry(0.021, 0.0016, 6, 36);
  G.grille2 = new THREE.TorusGeometry(0.030, 0.0016, 6, 36);

  G.cap = new THREE.CylinderGeometry(0.006, 0.006, 0.002, 16);

  G.knob = new THREE.CylinderGeometry(0.009, 0.009, 0.010, 24);
  G.washer = new THREE.CylinderGeometry(0.011, 0.011, 0.0015, 20);

  G.nut = new THREE.CylinderGeometry(0.004, 0.004, 0.004, 6);
  G.lever = new THREE.CylinderGeometry(0.0016, 0.0016, 0.022, 5);

  G.aerialBase = new THREE.CylinderGeometry(0.005, 0.005, 0.010, 6);

  const whipCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.040, 0.128, -0.022),
    new THREE.Vector3(0.046, 0.180, -0.026),
    new THREE.Vector3(0.058, 0.232, -0.034),
  ]);
  G.whip = new THREE.TubeGeometry(whipCurve, 16, 0.0028, 6, false);

  G.tip = new THREE.SphereGeometry(0.0035, 12, 10);

  for (const g of Object.values(G)) g.userData.shared = true;
  return G;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------
export function makeDecoy() {
  const m = mats();
  const g = geos();

  const group = new THREE.Group();
  group.name = 'decoy';

  // --- Case ---------------------------------------------------------------
  const caseMesh = new THREE.Mesh(g.case, m.case);
  caseMesh.position.set(0, 0.060, 0);
  group.add(caseMesh);

  // --- Top trim -----------------------------------------------------------
  const trim = new THREE.Mesh(g.trim, m.nickel);
  trim.position.set(0, 0.118, 0);
  group.add(trim);

  // --- Speaker cloth disc -------------------------------------------------
  const cloth = new THREE.Mesh(g.clothDisc, m.cloth);
  cloth.rotation.x = Math.PI / 2;
  cloth.position.set(0, 0.056, 0.0335); // front surface at z ~ 0.035
  group.add(cloth);

  // --- Bezel --------------------------------------------------------------
  const bezel = new THREE.Mesh(g.bezel, m.nickel);
  bezel.position.set(0, 0.056, 0.0365);
  group.add(bezel);

  // --- Concentric grille rings -------------------------------------------
  const grilleGeos = [g.grille0, g.grille1, g.grille2];
  for (const gg of grilleGeos) {
    const ring = new THREE.Mesh(gg, m.grille);
    ring.position.set(0, 0.056, 0.037);
    group.add(ring);
  }

  // --- Centre cap ---------------------------------------------------------
  const cap = new THREE.Mesh(g.cap, m.grille);
  cap.rotation.x = Math.PI / 2;
  cap.position.set(0, 0.056, 0.0375);
  group.add(cap);

  // --- Knob + washer ------------------------------------------------------
  const washer = new THREE.Mesh(g.washer, m.nickel);
  washer.position.set(-0.030, 0.1205, -0.010);
  group.add(washer);

  const knob = new THREE.Mesh(g.knob, m.bakelite);
  knob.position.set(-0.030, 0.125, -0.010);
  group.add(knob);

  // --- Toggle switch ------------------------------------------------------
  const nut = new THREE.Mesh(g.nut, m.nickel);
  nut.position.set(0.022, 0.122, 0.006);
  group.add(nut);

  const toggle = new THREE.Group();
  toggle.name = 'decoy_toggle';
  toggle.position.set(0.022, 0.124, 0.006); // pivot at the top of the nut

  const lever = new THREE.Mesh(g.lever, m.nickel);
  lever.position.set(0, 0.011, 0); // extends upward from the pivot
  toggle.add(lever);

  // OFF: tilted 25 deg towards the front (+z).
  toggle.rotation.x = THREE.MathUtils.degToRad(25);
  group.add(toggle);

  // --- Whip aerial --------------------------------------------------------
  const aerialBase = new THREE.Mesh(g.aerialBase, m.nickel);
  aerialBase.position.set(0.040, 0.125, -0.022);
  group.add(aerialBase);

  const whip = new THREE.Mesh(g.whip, m.nickel);
  group.add(whip); // curve points are already in local space

  const tip = new THREE.Mesh(g.tip, m.nickel);
  tip.position.set(0.0585, 0.234, -0.0345);
  tip.scale.y = 0.8;
  group.add(tip);

  // --- Shadows ------------------------------------------------------------
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });

  // --- API ----------------------------------------------------------------
  const OFF_TILT = THREE.MathUtils.degToRad(25);
  const ON_TILT = -OFF_TILT;
  group.userData.decoy = {
    setOn(on) {
      toggle.rotation.x = on ? ON_TILT : OFF_TILT;
    },
  };

  // Oversize the whole prop for gameplay-camera readability.
  group.scale.setScalar(DECOY_SCALE);

  return group;
}
