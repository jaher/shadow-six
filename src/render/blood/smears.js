/**
 * Drag smears (bodies-design §B.5): a world-space ribbon that follows the terrain behind a bleeding body being dragged
 * (or a downed man crawling). Segments live in a fixed ring (the budget in metres, oldest first) inside ONE mesh;
 * each appended segment updates only its own vertex range. Streaky along the drag, broken where the bleed is weak,
 * glossy while wet, and on snow a vivid core bleeding into a pink halo.
 * @module render/blood/smears
 */
import * as THREE from 'three';
import { BLOOD_GLSL, followTrails } from './glsl.js';

const MAXSEG = 5200, VPS = 6; // segments (400 m / 0.08 m), vertices per segment (2 ends × 3 across)

export class SmearLayer {
  constructor(sys, scene, uniforms, follow = null) {
    this.sys = sys; this.scene = scene;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(MAXSEG * VPS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aS = new THREE.BufferAttribute(new Float32Array(MAXSEG * VPS * 4), 4).setUsage(THREE.DynamicDrawUsage);   // v, odo, intensity, t0
    this.aF = new THREE.BufferAttribute(new Float32Array(MAXSEG * VPS * 2), 2).setUsage(THREE.DynamicDrawUsage);   // sf, core fraction
    g.setAttribute('position', this.pos); g.setAttribute('aS', this.aS); g.setAttribute('aF', this.aF);
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(MAXSEG * VPS * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    const idx = new Uint32Array(MAXSEG * 12);
    for (let s = 0; s < MAXSEG; s++) {
      const b = s * VPS; // 0,1,2 = start L,C,R; 3,4,5 = end L,C,R
      idx.set([b, b + 3, b + 1, b + 1, b + 3, b + 4, b + 1, b + 4, b + 2, b + 2, b + 4, b + 5], s * 12);
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      followTrails(sh, follow);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aS; attribute vec2 aF; varying vec4 vS; varying vec2 vF;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvS = aS; vF = aF;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${BLOOD_GLSL}\nvarying vec4 vS; varying vec2 vF; float sWet;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float v = vS.x, u = vS.y, I = vS.z, age = uBloodTime - vS.w, sf = vF.x, cf = vF.y;
          vec4 tone = bloodTone(age, sf);
          // the wet cloth meanders inside the ribbon and leaves combed streaks: thin lanes along the drag (fabric folds,
          // the belt, the heels of the hands), each fading in and out, torn edges, dry skips where the cloth lifted
          float wv = v + (bNoise(vec2(u * 0.55, 3.0)) - 0.5) * 0.5;
          float av = abs(wv) / cf;
          float lanes = bNoise(vec2(u * 0.35, wv * 11.0)) * 0.55 + bNoise(vec2(u * 1.3, wv * 31.0)) * 0.3 + bNoise(vec2(u * 6.0, wv * 70.0)) * 0.15;
          float streak = smoothstep(0.32, 0.78, lanes);
          float edgeN = (bNoise(vec2(u * 3.5, wv > 0.0 ? 1.0 : 5.0)) - 0.5) * 0.6 + (bNoise(vec2(u * 17.0, wv * 3.0)) - 0.5) * 0.25;
          float core = 1.0 - smoothstep(0.35 + edgeN, 0.9 + edgeN * 0.5, av);
          float gap = smoothstep(0.2, 0.55, I * 0.8 + bNoise(vec2(u * 0.9, 7.0)) * 0.45 + bNoise(vec2(u * 4.0, 11.0)) * 0.15 - 0.1); // skips, more as the bleed weakens
          float a = core * gap * mix(0.12, 1.0, streak) * mix(0.5, 1.0, I);
          vec3 col = tone.rgb * mix(0.62, 1.12, streak);
          if (sf > 0.5 && sf < 1.5) {                           // snow: soaked vivid core + feathered pink halo
            float halo = (1.0 - smoothstep(0.5, 1.0 / cf, av + (bNoise(vec2(u * 2.2, v * 5.0)) - 0.5) * 0.4)) * I * gap;
            col = mix(uBHalo, uBSnow * mix(0.85, 1.15, streak), clamp(a * 1.6, 0.0, 1.0));
            a = max(a, halo * 0.45);
          }
          if (a < 0.01) discard;
          float keep = (sf < 0.5 || (sf > 1.5 && sf < 3.5)) ? exp(-age / 40.0) : (sf > 0.5 && sf < 1.5) ? 0.5 * exp(-age / 150.0) : 1.0;
          sWet = tone.a * keep * core;
          diffuseColor = vec4(col, a * 0.92 * opacity);
        }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          // a film on hard floors is glossy; on soil / grass / snow the blood coats grains and blades (satin at most)
          roughnessFactor = mix(0.8, (vF.x < 0.5 || (vF.x > 0.5 && vF.x < 4.5)) ? 0.42 : 0.12, sWet);`);
    };
    m.customProgramCacheKey = () => 's6blood-smear';
    this.mat = m;
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.name = 'blood-smears'; this.mesh.frustumCulled = false; this.mesh.renderOrder = 3; this.mesh.receiveShadow = true;
    this.mesh.userData.noXray = true; this.mesh.userData.aoExclude = true;
    scene.add(this.mesh);
    this._on = true; this.mesh.visible = false; // not drawn (nor compiled) until the first segment
    this.slot = new Map(); this.next = 0; this.used = 0; this.odo = 0;
  }

  add(s) {
    const i = this.next; this.next = (this.next + 1) % MAXSEG; this.used = Math.min(MAXSEG, this.used + 1);
    for (const [k, v] of this.slot) if (v === i) { this.slot.delete(k); break; }
    this.slot.set(s, i);
    this._write(i, s);
    this.mesh.geometry.setDrawRange(0, this.used * 12);
    this._sync();
  }

  /** Oldest segments left the budget: hide them (zero-area). */
  drop(list) {
    for (const s of list) {
      const i = this.slot.get(s);
      if (i == null) continue;
      this.slot.delete(s);
      const p = this.pos.array; p.fill(0, i * VPS * 3, (i + 1) * VPS * 3);
      this.pos.addUpdateRange(i * VPS * 3, VPS * 3); this.pos.needsUpdate = true;
    }
  }

  _write(i, s) {
    const dx = s.x1 - s.x0, dz = s.z1 - s.z0, L = Math.hypot(dx, dz) || 1e-3;
    const rx = -dz / L, rz = dx / L, snow = s.sf === 1, W = s.w * (snow ? 1.9 : 1) / 2, cf = snow ? 1 / 1.9 : 1;
    const odo0 = this.odo; this.odo += L;
    const P = this.pos.array, S = this.aS.array, F = this.aF.array, b = i * VPS;
    const ends = [[s.x0, s.z0, odo0], [s.x1, s.z1, this.odo]];
    ends.forEach(([x, z, u], e) => {
      for (let a = 0; a < 3; a++) {
        const v = a - 1, px = x + rx * W * v, pz = z + rz * W * v, q = b + e * 3 + a;
        P.set([px, this.sys._floorY(px, pz) + 0.011, pz], q * 3);
        S.set([v, u, s.i, s.t0], q * 4);
        F.set([s.sf, cf], q * 2);
      }
    });
    for (const [attr, n] of [[this.pos, 3], [this.aS, 4], [this.aF, 2]]) { attr.addUpdateRange(b * n, VPS * n); attr.needsUpdate = true; }
  }

  set visible(v) { this._on = v; this._sync(); }
  _sync() { this.mesh.visible = this._on && this.used > 0; }
  clear() { this.slot.clear(); this.next = 0; this.used = 0; this.mesh.geometry.setDrawRange(0, 0); this._sync(); }
  dispose() { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mat.dispose(); }
}
