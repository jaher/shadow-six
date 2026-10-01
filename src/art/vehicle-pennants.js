/**
 * Cloth pennants on vehicles (vehicle integration, ambient step): the patrol boat's masthead commissioning pennant
 * (its library 'pennant' anchor; plain, spec §10.6: no ensign) and, when a mission spawn asks for it
 * (`pennant: true`), a staff car's small command flag on a staff over the right front wing.
 * Both are the shared Verlet cloth of art/cloth.js (ticked with every flag by art/flags.js tickFlags from the mission
 * WindField) and feel the APPARENT wind: the vehicle's own motion is subtracted from the wind, so a pennant streams
 * aft when the boat runs into a calm and hangs limp on a halted car on a still day.
 * @module art/vehicle-pennants
 */
import * as THREE from 'three';
import { VerletCloth, registerCloth, CLOTHS } from './cloth.js';
import { flagTexture } from './flags.js';

let MAT = null;
function materials() {
  if (MAT) return MAT;
  MAT = {
    pennant: new THREE.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.9, side: THREE.DoubleSide }),
    flag: new THREE.MeshStandardMaterial({ map: flagTexture() || null, color: flagTexture() ? 0xffffff : 0x5e6456, roughness: 0.9, side: THREE.DoubleSide }),
    staff: new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.4, metalness: 0.6 }),
  };
  for (const m of Object.values(MAT)) m.userData.shared = true;
  return MAT;
}

/**
 * A cloth strip: hoist edge at x = 0 (pinned), top at y = 0, flying towards +x; `taper` narrows the fly end.
 * @returns {{mesh: THREE.Mesh, entry: object}} entry = its CLOTHS record (carries `vel`)
 */
function clothStrip(w, h, seg, mat, taper = 0) {
  const geo = new THREE.PlaneGeometry(w, h, seg[0], seg[1]);
  geo.translate(w / 2, -h / 2, 0);
  if (taper) {
    const P = geo.attributes.position;
    for (let i = 0; i < P.count; i++) { const x = P.getX(i); P.setY(i, P.getY(i) * (1 - taper * (x / w)) - (h * taper * (x / w)) / 2); }
    geo.computeVertexNormals();
  }
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -h / 2, 0), Math.hypot(w, h) + 0.2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'pennant_cloth'; mesh.castShadow = true;
  const cloth = new VerletCloth(geo.attributes, { nx: seg[0] + 1, ny: seg[1] + 1, pinned: (i) => i === 0, density: 0.12 });
  registerCloth(mesh, cloth);
  const entry = CLOTHS[CLOTHS.length - 1];
  entry.vel = { x: 0, z: 0 };
  return { mesh, entry };
}

/**
 * Add a vehicle's pennants (after its visual is ready).
 * @param {object} vis createVehicleVisual handle (meta, emitters, lights, object3d)
 * @param {{pennant?: boolean|string}} [spawn] mission spawn
 * @returns {{list: THREE.Object3D[], setVelocity: (vx: number, vz: number) => void, dispose: () => void}|null}
 */
export function addPennants(vis, spawn = {}) {
  const M = materials(), list = [], entries = [];
  // masthead pennant at the library anchor, streaming aft at rest (flag +x → model -z)
  for (const e of (vis.emitters || []).filter((q) => q.kind === 'pennant')) {
    const g = new THREE.Group(); g.name = 'pennant';
    const { mesh, entry } = clothStrip(1.3, 0.16, [14, 2], M.pennant, 0.85);
    g.add(mesh); g.rotation.y = Math.PI / 2;
    g.position.set(...(e.pos || [0, 2, 0]));
    vis.object3d.add(g); list.push(g); entries.push(entry);
  }
  // staff car command flag on the right front wing (model -x = vehicle right), over the headlamp
  if (spawn.pennant) {
    const hl = (vis.meta?.lights || []).find((L) => /head/.test(L.kind || '') && L.pos?.[0] < 0) || (vis.meta?.lights || []).find((L) => /head/.test(L.kind || ''));
    const base = hl?.pos ? [Math.min(-0.3, hl.pos[0]), hl.pos[1] + 0.12, hl.pos[2] - 0.08] : [-0.6, 1.1, 1.8];
    const g = new THREE.Group(); g.name = 'pennant:staff';
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.009, 0.5, 6), M.staff);
    staff.position.y = 0.25; staff.castShadow = true;
    const { mesh, entry } = clothStrip(0.3, 0.2, [6, 4], M.flag);
    mesh.position.set(0.008, 0.49, 0);
    g.add(staff, mesh); g.rotation.y = Math.PI / 2;
    g.position.set(...base);
    vis.object3d.add(g); list.push(g); entries.push(entry);
  }
  if (!list.length) return null;
  return {
    list,
    /** World velocity (m/s) of the vehicle: subtracted from the wind the cloth feels. */
    setVelocity(vx, vz) { for (const e of entries) { e.vel.x = vx; e.vel.z = vz; } },
    dispose() {
      for (const g of list) { g.removeFromParent(); g.traverse((o) => o.geometry?.dispose()); }
      for (const e of entries) { const k = CLOTHS.indexOf(e); if (k >= 0) CLOTHS.splice(k, 1); }
    },
  };
}
