/**
 * Street lighting at night (PROGRESS step 3p): lamp glass glows (emissive → HDR bloom), every lit lamp throws an
 * additive light pool on the ground (one instanced draw), and a FIXED pool of real PointLights (count per preset,
 * created once per mission → no shader recompiles) follows the lamps nearest the view centre so characters,
 * walls and props walking under a lamp are lit for real. Blackout-hooded lamps are dim, blue-ish and tight.
 * Daytime: glass off, no pools, no lights.
 * @module render/street-lights
 */
import * as THREE from 'three';
import { furnitureMaterial } from '../art/furniture/index.js';

/** Real point lights per render preset. */
export const LIGHTS_PER_PRESET = { low: 0, medium: 3, high: 6, ultra: 8 };
/** Real-light gain on the lamp's nominal intensity. Review P3: 6 was tuned against a night HDRI that kept the day sun
 *  (lighting.js now gives moonlit missions the night rig); at 6 a 13 m lamp lit a whole square like daylight. */
export const LAMP_GAIN = 2.2;

let POOL_TEX = null;
function poolTexture() {
  if (POOL_TEX) return POOL_TEX;
  const N = 128, d = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N * 2 - 1, y = (j + 0.5) / N * 2 - 1, r = Math.sqrt(x * x + y * y);
    const v = Math.max(0, 1 - r) ** 1.6 * (1 - 0.25 * Math.max(0, 1 - r * 6));   // inverse-square-ish falloff, soft core
    const k = (j * N + i) * 4; d[k] = d[k + 1] = d[k + 2] = Math.round(255 * Math.min(1, v)); d[k + 3] = 255;
  }
  POOL_TEX = new THREE.DataTexture(d, N, N); POOL_TEX.needsUpdate = true; POOL_TEX.magFilter = POOL_TEX.minFilter = THREE.LinearFilter;
  return POOL_TEX;
}

/**
 * @param {THREE.Scene} scene @param {object[]} emitters buildFurniture().emitters
 * @param {{night:boolean, preset?:string, groundAt?:Function}} o
 */
export function createStreetLights(scene, emitters, o = {}) {
  const night = !!o.night, lit = night ? emitters.filter((e) => e.lit) : [];
  furnitureMaterial('glass').emissiveIntensity = night ? 2.6 : 0; // review P3: 6 clipped to a cold white under the night grade
  furnitureMaterial('glassDim').emissiveIntensity = night ? 2.2 : 0;
  const group = new THREE.Group(); group.name = 'street-lights';
  let pools = null;
  if (lit.length) {
    const mk = (warm) => new THREE.MeshBasicMaterial({ map: poolTexture(), color: warm, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: true });
    const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const mat = mk(new THREE.Color(1.0, 0.72, 0.42).multiplyScalar(0.22));
    pools = new THREE.InstancedMesh(geo, mat, lit.length);
    const m = new THREE.Object3D(), c = new THREE.Color();
    lit.forEach((e, i) => {
      const fwd = e.kind === 'flood' ? 5.5 : e.kind === 'search' ? 0 : 0;
      const px = e.x + Math.cos(e.rot) * fwd, pz = e.z + Math.sin(e.rot) * fwd;
      const gy = o.groundAt ? o.groundAt(px, pz) : e.ground;
      m.position.set(px, gy + 0.06, pz); m.rotation.set(0, -e.rot, 0);
      m.scale.set(e.pool * (e.kind === 'flood' ? 1.5 : 1), 1, e.pool);
      m.updateMatrix(); pools.setMatrixAt(i, m.matrix);
      c.set(e.color).multiplyScalar(e.hooded ? 0.35 : e.kind === 'flood' ? 1.6 : 1);
      if (e.hooded) c.lerp(new THREE.Color(0.55, 0.65, 1.0), 0.5);
      pools.setColorAt(i, c);
    });
    pools.userData.aoExclude = true; pools.renderOrder = 4; pools.frustumCulled = false; pools.name = 'street-lights:pools';
    group.add(pools);
  }
  const K = night && lit.length ? Math.min(lit.length, LIGHTS_PER_PRESET[o.preset] ?? 4) : 0;
  const lights = [];
  for (let k = 0; k < K; k++) {
    const L = new THREE.PointLight(0xffa24c, 0, 12, 2);
    L.castShadow = false; L.userData.slot = -1;
    lights.push(L); group.add(L);
  }
  scene?.add(group);
  const ray = new THREE.Vector3(), tmp = [];
  const stats = { lit: lit.length, lights: K, assigned: 0 };
  return {
    group, stats, lights, night,
    /** Per displayed frame: the K lamps nearest the view centre get the real lights (smooth hand-over). */
    frame(dt, camera) {
      if (!K || !camera) return;
      camera.getWorldDirection(ray);
      const t = ray.y < -1e-3 ? -camera.position.y / ray.y : 0;
      const cx = camera.position.x + ray.x * t, cz = camera.position.z + ray.z * t;
      tmp.length = 0;
      for (let i = 0; i < lit.length; i++) tmp.push([(lit[i].x - cx) ** 2 + (lit[i].z - cz) ** 2, i]);
      tmp.sort((a, b) => a[0] - b[0]);
      const want = new Set(tmp.slice(0, K).map((q) => q[1]));
      const free = lights.filter((L) => !want.has(L.userData.slot));
      for (const L of lights) if (want.has(L.userData.slot)) want.delete(L.userData.slot);
      for (const i of want) { const L = free.shift(); if (!L) break; L.userData.slot = i; L.userData.fade = 0; }
      const a = Math.min(1, (dt || 0.016) * 4);
      stats.assigned = 0;
      for (const L of lights) {
        const e = lit[L.userData.slot];
        if (!e) { L.intensity = 0; continue; }
        L.userData.fade += (1 - L.userData.fade) * a;
        L.position.set(e.x, e.y - 0.15, e.z); L.color.set(e.color); L.distance = e.range;
        L.intensity = e.intensity * LAMP_GAIN * L.userData.fade;
        stats.assigned++;
      }
    },
    dispose() {
      group.removeFromParent();
      pools?.geometry.dispose(); pools?.material.dispose();
      furnitureMaterial('glass').emissiveIntensity = 0; furnitureMaterial('glassDim').emissiveIntensity = 0;
    },
  };
}
