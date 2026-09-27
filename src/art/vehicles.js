/**
 * STUB — owned by ART (see docs/ARCHITECTURE.md). Placeholder vehicle models built from boxes and
 * cylinders, authored facing +Z (like humanoids; use headingToRotY). BEL vehicle roster: truck,
 * staff car, motorcycle (sidecar), Panzer tanks, SdKfz 231 armoured car, patrol boat, inflatable boat
 * (the Marine's raft), plane, and static fuel truck. Replaced by glTF models later, same interface.
 * @module art/vehicles
 */

import * as THREE from 'three';
import { getMaterial } from './materials.js';

/** Dimensions (w across, l along +Z, h) and look per vehicle type. */
export const VEHICLE_MODELS = {
  truck: { w: 2.3, l: 6.5, h: 2.8, mat: 'olivePaint', cab: 0.3 },
  fuel_truck: { w: 2.3, l: 6.5, h: 2.6, mat: 'greyPaint', cab: 0.3, tank: true },
  car: { w: 1.8, l: 4.4, h: 1.5, mat: 'greyPaint', cab: 0.5 },
  motorcycle: { w: 1.6, l: 2.2, h: 1.1, mat: 'greyPaint' },
  tank: { w: 2.9, l: 5.5, h: 2.4, mat: 'greyPaint', turret: true },
  armoredcar: { w: 2.2, l: 5.8, h: 2.3, mat: 'greyPaint', turret: true },
  patrolboat: { w: 3, l: 10, h: 2.2, mat: 'greyPaint', boat: true },
  raft: { w: 1.4, l: 3, h: 0.5, mat: 'black', boat: true },
  plane: { w: 12, l: 9, h: 3, mat: 'greyPaint' },
};

function part(geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, getMaterial(mat));
  m.position.set(x, y, z);
  m.userData.mat = mat;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * @param {string} vehicleType key of VEHICLE_MODELS (unknown → truck)
 * @returns {{root: THREE.Group, turret: THREE.Object3D|null, dims: object, update: (dt:number, vehicle?:object) => void,
 *   setTurretHeading: (localRad:number) => void, setDestroyed: (on:boolean) => void, dispose: () => void}}
 */
export function createVehicleModel(vehicleType = 'truck') {
  const d = VEHICLE_MODELS[vehicleType] || VEHICLE_MODELS.truck;
  const root = new THREE.Group();
  root.name = `vehicle:${vehicleType}`;
  const body = new THREE.Group();
  root.add(body);
  let turret = null, gunPivot = null, gun = null;
  const wheels = [];
  if (vehicleType === 'plane') {
    body.add(part(new THREE.BoxGeometry(1.6, 1.6, d.l), d.mat, 0, 1.4, 0));
    body.add(part(new THREE.BoxGeometry(d.w, 0.2, 2), d.mat, 0, 1.5, 0.8));
    body.add(part(new THREE.BoxGeometry(0.2, 1.6, 1.2), d.mat, 0, 2.4, -d.l / 2 + 0.6));
  } else if (d.boat) {
    body.add(part(new THREE.BoxGeometry(d.w, d.h * 0.5, d.l), d.mat, 0, d.h * 0.25, 0));
    body.add(part(new THREE.ConeGeometry(d.w / 2, d.w, 4), d.mat, 0, d.h * 0.25, d.l / 2 + d.w / 2 - 0.2));
    body.children[1].rotation.x = Math.PI / 2;
    if (vehicleType === 'patrolboat') body.add(part(new THREE.BoxGeometry(1.8, 1.4, 2.5), d.mat, 0, d.h * 0.5 + 0.7, -0.5));
  } else if (vehicleType === 'motorcycle') {
    body.add(part(new THREE.BoxGeometry(0.4, 0.6, d.l), d.mat, -0.3, 0.6, 0));
    body.add(part(new THREE.BoxGeometry(0.7, 0.5, 1.4), d.mat, 0.45, 0.5, -0.1)); // sidecar
  } else {
    const hullH = d.turret ? d.h * 0.5 : d.h * 0.45;
    body.add(part(new THREE.BoxGeometry(d.w, hullH, d.l), d.mat, 0, 0.4 + hullH / 2, 0));
    if (d.cab != null && !d.turret) {
      const cabL = d.l * d.cab;
      body.add(part(new THREE.BoxGeometry(d.w * 0.95, d.h * 0.45, cabL), d.mat, 0, 0.4 + hullH + d.h * 0.22, d.l / 2 - cabL / 2));
      if (vehicleType === 'truck') body.add(part(new THREE.BoxGeometry(d.w, d.h * 0.5, d.l * 0.62), 'canvas', 0, 0.4 + hullH + d.h * 0.25, -d.l * 0.18));
      if (d.tank) {
        const tk = part(new THREE.CylinderGeometry(d.w * 0.45, d.w * 0.45, d.l * 0.6, 14), d.mat, 0, 0.4 + hullH + d.w * 0.4, -d.l * 0.15);
        tk.rotation.x = Math.PI / 2;
        body.add(tk);
      }
    }
    if (d.turret) {
      turret = new THREE.Group();
      turret.position.set(0, 0.4 + hullH, vehicleType === 'tank' ? -0.2 : 0);
      turret.add(part(new THREE.BoxGeometry(d.w * 0.65, d.h * 0.35, d.l * 0.35), d.mat, 0, d.h * 0.17, 0));
      const barrel = part(new THREE.CylinderGeometry(0.07, 0.08, d.l * 0.5, 8), 'metal', 0, 0, d.l * 0.35);
      barrel.rotation.x = Math.PI / 2;
      gunPivot = new THREE.Group(); gunPivot.name = 'gunPivot'; gunPivot.position.y = d.h * 0.2; // elevation (placement rule d)
      gunPivot.add(barrel);
      turret.add(gunPivot);
      body.add(turret);
      // barrel reach / height + the turret housing (half length / width, roof) for the traverse rule (placement d)
      gun = { len: d.l * 0.6, h: 0.4 + hullH + d.h * 0.2, hl: d.l * 0.175, hw: d.w * 0.325, top: 0.4 + hullH + d.h * 0.35 };
    }
    const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const sz of [-0.35, 0.35]) for (const sx of [-1, 1]) {
      const wh = part(wheelGeo, 'black', sx * (d.w / 2 - 0.1), 0.4, sz * d.l);
      wheels.push(wh);
      body.add(wh);
    }
  }
  let destroyed = false;
  return {
    root,
    turret,
    dims: d,
    update(dt, vehicle) {
      const v = vehicle?.speed ?? 0;
      for (const w of wheels) w.rotation.x += (v * dt) / 0.4;
      if (d.boat && !destroyed) body.position.y = Math.sin((vehicle?.world?.time ?? 0) * 1.7) * 0.05;
    },
    // localRad = world turret heading − hull heading; rotation.y runs the other way (headingToRotY = π/2 − h)
    setTurretHeading(localRad) { if (turret) turret.rotation.y = -localRad; },
    gun,
    setGunLift(a) { if (gunPivot) gunPivot.rotation.x = -(Number.isFinite(a) ? a : 0); },
    setDestroyed(on) {
      destroyed = !!on;
      root.traverse((o) => { if (o.isMesh) o.material = getMaterial(on ? 'crater' : o.userData.mat || d.mat); });
      body.rotation.z = on ? 0.08 : 0;
    },
    dispose() { root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); },
  };
}

export default createVehicleModel;
