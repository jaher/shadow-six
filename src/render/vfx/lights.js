// Shared pool of FX point lights (one set for ALL effects). Fixed count, created before the first
// shader compile, so effects coming and going never change the light count (no recompiles).
// Each frame the strongest requests win; the same data feeds the particle shaders (uLightPos/Col)
// so fire lights its own smoke, the ground and nearby soldiers.
import * as THREE from 'three';

export const NLIGHTS = 6;

export class LightPool {
  constructor(scene, uniforms, n = NLIGHTS) {
    this.scene = scene; this.u = uniforms; this.reqs = []; this.lights = [];
    for (let i = 0; i < n; i++) {
      const L = new THREE.PointLight(0xff8a3a, 0, 30, 2); L.name = 'vfx-light-' + i; L.castShadow = false;
      scene.add(L); this.lights.push(L);
    }
    this._live = [];
  }
  /** req: {pos:Vector3, color:Color, radius, dur, fn(age)->candela, t0} */
  add(req) { this.reqs.push(req); return req; }
  update(t) {
    const live = this._live; live.length = 0;
    for (const q of this.reqs) {
      const age = t - q.t0; if (age > q.dur || q.stopped) { q.dead = true; continue; }
      if (age < 0) continue;
      const I = q.fn(age); if (I > 0.01) live.push([I, q]);
    }
    if (this.reqs.some((q) => q.dead)) this.reqs = this.reqs.filter((q) => !q.dead);
    live.sort((a, b) => b[0] - a[0]);
    const P = this.u.uLightPos.value, C = this.u.uLightCol.value;
    for (let i = 0; i < this.lights.length; i++) {
      const L = this.lights[i];
      if (i < live.length) {
        const [I, q] = live[i];
        L.position.copy(q.pos); L.color.copy(q.color); L.intensity = I; L.distance = q.radius * 2.5;
        P[i].set(q.pos.x, q.pos.y, q.pos.z, q.radius * 0.6);
        C[i].set(q.color.r, q.color.g, q.color.b).multiplyScalar(Math.min(I, 2000) * 0.0022);
      } else { L.intensity = 0; P[i].set(0, -1000, 0, 1); C[i].set(0, 0, 0); }
    }
  }
  clear() { this.reqs = []; this.update(0); }
  dispose() { for (const L of this.lights) { this.scene.remove(L); L.dispose?.(); } this.lights = []; }
}
