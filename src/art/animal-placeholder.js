/**
 * Placeholder quadruped / bird meshes for the BCD animals (docs/bcd-plan.md §1.9, §4: "NOW placeholder").
 * Same model interface as art/humanoid.js ({root, setAnim, update, setColors, setDisguise, dispose}) so the
 * Unit class drives it unchanged. The LATER art step replaces these one for one.
 * @module art/animal-placeholder
 */

import * as THREE from 'three';

const LOOK = {
  lion: { color: 0xb88a3e, len: 1.9, h: 0.9, w: 0.6, head: 0.42, mane: 0x6a4420 },
  ostrich: { color: 0x2a2622, len: 0.9, h: 1.2, w: 0.6, head: 0.18, neck: 0.9 },
  chicken: { color: 0xe8e0d0, len: 0.35, h: 0.25, w: 0.25, head: 0.12 },
};

/**
 * @param {'lion'|'ostrich'|'chicken'} kind
 * @param {{color?: number}} [o]
 */
export function createAnimal(kind, o = {}) {
  const L = LOOK[kind] || LOOK.lion;
  const mat = new THREE.MeshStandardMaterial({ color: o.color ?? L.color, roughness: 0.9 });
  const root = new THREE.Group();
  root.name = `animal:${kind}`;
  const pivot = new THREE.Group();
  root.add(pivot);
  const body = new THREE.Mesh(new THREE.BoxGeometry(L.len, L.h * 0.5, L.w), mat);
  body.position.y = L.h * 0.75;
  body.castShadow = true;
  pivot.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(L.head, L.head, L.head), mat);
  head.position.set(L.len / 2 + L.head / 2, L.h * 0.75 + (L.neck || 0), 0);
  pivot.add(head);
  if (L.mane) {
    const mane = new THREE.Mesh(new THREE.SphereGeometry(L.head * 0.9, 8, 6), new THREE.MeshStandardMaterial({ color: L.mane, roughness: 1 }));
    mane.position.copy(head.position).x -= L.head * 0.3;
    pivot.add(mane);
  }
  const legGeo = new THREE.BoxGeometry(0.08, L.h * 0.5, 0.08);
  for (const [sx, sz] of kind === 'lion' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [[0, 1], [0, -1]]) {
    const leg = new THREE.Mesh(legGeo, mat);
    leg.position.set(sx * L.len * 0.4, L.h * 0.25, sz * L.w * 0.3);
    pivot.add(leg);
  }
  const model = {
    root, anim: 'idle', animTime: 0,
    setAnim(name) { this.anim = name; this.animTime = 0; },
    update(dt) {
      this.animTime += dt;
      const a = this.anim;
      const dead = a === 'dead' || a === 'die';
      pivot.rotation.x = dead ? Math.PI / 2 - 0.1 : 0;
      body.position.y = L.h * 0.75 + (a === 'run' || a === 'walk' ? Math.abs(Math.sin(this.animTime * 9)) * 0.05 : 0);
    },
    setColors(c = {}) { if (c.body != null) mat.color.set(c.body); },
    setDisguise() {},
    dispose() { root.traverse((m) => { if (m.isMesh) m.geometry.dispose(); }); mat.dispose(); },
  };
  model.update(0);
  return model;
}

export default createAnimal;
