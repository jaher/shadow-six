/**
 * Clothing stains (bodies-design §B.4): up to 8 wound slots per unit, drawn by the character's own material. Every
 * stained unit shares ONE patched clone per original (kit) material — the slots reach the shader through the mesh's
 * onBeforeRender (uniform values swapped per draw) — so 60 stained men cost a handful of materials, not hundreds.
 * A slot lives in BIND SPACE (the mesh's rest pose): its centre is the wound point taken back through its bone's
 * skinning matrices once, and the shader measures from the vertex's bind position, so the stain stays on the cloth it
 * soaked (an arm swinging past a chest wound is never painted). It spreads from ~2 cm to its radius over 30 s along the
 * fabric (albedo luminance + bind-space noise), darkens with age like the pools, and wet cloth is glossier for 2 min.
 * @module render/blood/stains
 */
import * as THREE from 'three';
import { CONFIG } from '../../config.js';
import { BLOOD_GLSL } from './glsl.js';

const MAXS = 8;
const _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), _v = new THREE.Vector3(), _p = new THREE.Vector3();

/**
 * Bind-space centre and radius scale of a wound point `wp` (world) riding on bone `b` of skinned mesh `sm`. three's
 * skinning: world = M · BMI · Bw · Binv · BM · p, where an 'attached' mesh keeps BMI = M⁻¹ (so world = Bw·Binv·BM·p)
 * and a 'detached' one BMI = BM⁻¹.  ⇒  p = BM⁻¹ · Binv⁻¹ · Bw⁻¹ · (attached ? world : BM · M⁻¹ · world).
 */
export function toBindSpace(sm, b, wp) {
  const sk = sm?.skeleton, bi = sk ? sk.bones.indexOf(b) : -1;
  if (bi < 0) return null;
  _m.copy(b.matrixWorld).invert();
  if (sm.bindMode === 'detached') _m.multiply(sm.bindMatrix).multiply(_t.copy(sm.matrixWorld).invert());
  _m.premultiply(_t.copy(sk.boneInverses[bi]).invert()).premultiply(_t.copy(sm.bindMatrix).invert());
  return { p: wp.clone().applyMatrix4(_m), k: _m.getMaxScaleOnAxis() };
}

function patch(orig, U) {
  const m = orig.clone();
  const prev = orig.onBeforeCompile, prevKey = orig.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStainW; varying vec3 vStainB;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvStainW = (modelMatrix * vec4(transformed, 1.0)).xyz; vStainB = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${BLOOD_GLSL}
uniform vec4 uStainPos[${MAXS}]; uniform vec4 uStainP[${MAXS}]; uniform int uStainN;
varying vec3 vStainW; varying vec3 vStainB; float stWet;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float st = 0.0, ag = 1e9; stWet = 0.0;
        float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        float nz = bNoise(vStainB.xz * 55.0 + vStainB.y * 31.0) * 0.6 + bNoise(vStainB.xy * 140.0) * 0.4;
        for (int i = 0; i < ${MAXS}; i++) {
          if (i >= uStainN) break;
          vec4 P = uStainPos[i], Q = uStainP[i];
          float r = P.w * (0.7 + 0.55 * nz) * (0.85 + 0.6 * clamp(lum * 3.0, 0.0, 1.0));   // capillary: fabric weave + albedo
          float s = (1.0 - smoothstep(r * 0.45, r, distance(vStainB, P.xyz))) * (Q.y > 1.5 ? 0.5 : 1.0);
          if (s > 0.0) { st = max(st, s); ag = min(ag, Q.x); }
        }
        if (st > 0.0) {
          vec4 tone = bloodTone(ag, 0.0);
          // thin fringe: vivid red soaked into the weave; the saturated centre: dark, drying toward brown
          vec3 bc = mix(uBSnow * 1.3, tone.rgb * 0.8, smoothstep(0.35, 1.0, st));
          diffuseColor.rgb = mix(diffuseColor.rgb, bc, st * 0.9);
          stWet = st * clamp(1.0 - ag / ${CONFIG.blood.stain.wetFor.toFixed(1)}, 0.0, 1.0);
        }
      }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.28, stWet);');
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey.call(orig) : ''}|s6stain`;
  m.userData.s6stain = true;
  return m;
}

/** Per-draw hook: point the shared material's stain uniforms at this unit's slots. */
function stainHook(e, prev) {
  return function (renderer, scene, camera, geometry, material, group) {
    prev?.call(this, renderer, scene, camera, geometry, material, group);
    const U = material?.userData?.s6U;
    if (!U) return;
    U.uStainPos.value = e.P; U.uStainP.value = e.Q; U.uStainN.value = e.n;
    material.uniformsNeedUpdate = true;
  };
}

export class StainLayer {
  constructor(sys, uniforms) {
    this.sys = sys; this.U0 = uniforms;
    /** unit id → {u, P: Vector4[], Q: Vector4[], n, list, meshes: [mesh, prev onBeforeRender, orig material][]} */
    this.units = new Map();
    /** original material → shared patched clone (its uniforms in userData.s6U) */
    this.shared = new Map();
  }

  _patched(m) {
    let c = this.shared.get(m);
    if (!c) {
      const V = () => Array.from({ length: MAXS }, () => new THREE.Vector4());
      const U = { ...this.U0, uStainPos: { value: V() }, uStainP: { value: V() }, uStainN: { value: 0 } };
      c = patch(m, U); c.userData.s6U = U;
      this.shared.set(m, c);
    }
    return c;
  }

  /**
   * Swap the patched clones onto these units' meshes (no hooks) and return the undo — for a compile pass only
   * (BloodSystem.warm): the first stain otherwise re-links every kit shader in the middle of the fight.
   */
  preview(units) {
    const undo = [];
    for (const u of units) {
      if (this.units.has(u.id)) continue;
      u.model?.root?.traverse?.((o) => {
        if (!o.isMesh || !o.material || o.userData?.weapon) return;
        const swap = (m) => (!m || m.userData?.s6stain || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) ? m : this._patched(m));
        undo.push([o, o.material, o.visible]);
        o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
      });
    }
    return () => { for (const [o, m] of undo) o.material = m; };
  }

  changed(u, list) {
    let e = this.units.get(u.id);
    if (!e) {
      const root = u.model?.root;
      if (!root) return;
      e = { u, P: Array.from({ length: MAXS }, () => new THREE.Vector4()), Q: Array.from({ length: MAXS }, () => new THREE.Vector4()), n: 0, list, meshes: [], sm: null };
      root.traverse((o) => {
        if (!o.isMesh || !o.material || o.userData?.weapon) return;
        if (o.isSkinnedMesh && (!e.sm || /^LOD0$/.test(o.name))) e.sm = o; // the body mesh (all share one skeleton)
        const swap = (m) => (!m || m.userData?.s6stain || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) ? m : this._patched(m));
        const orig = o.material;
        o.material = Array.isArray(orig) ? orig.map(swap) : swap(orig);
        e.meshes.push([o, o.onBeforeRender, orig]);
        o.onBeforeRender = stainHook(e, o.onBeforeRender);
      });
      this.units.set(u.id, e);
    }
    e.list = list;
    for (const s of list) if (s._u !== u.id) { s._bind = null; s._u = u.id; }
  }

  /** Per frame: bind the new slots once (from the current pose), then radius by age. */
  frame(time) {
    const S = CONFIG.blood.stain;
    for (const e of this.units.values()) {
      const u = e.u, R = u.model?.real, list = e.list || [];
      let n = 0;
      for (const s of list) {
        if (n >= MAXS) break;
        if (!s._bind) {
          const b = R?.getSocket?.(s.bone);
          if (!b?.matrixWorld || !e.sm) continue;
          const h = u.heading || 0, c = Math.cos(h), sn = Math.sin(h);
          b.getWorldPosition(_p);
          _v.set(_p.x + s.off[0] * c - s.off[2] * sn, _p.y + s.off[1], _p.z + s.off[0] * sn + s.off[2] * c);
          s._bind = toBindSpace(e.sm, b, _v);
          if (!s._bind) continue;
        }
        const age = Math.max(0, time - s.t0);
        const r = S.start + (s.radius - S.start) * (1 - Math.exp(-3 * age / S.grow));
        e.P[n].set(s._bind.p.x, s._bind.p.y, s._bind.p.z, r * s._bind.k);
        e.Q[n].set(age, s.kind === 'spray' ? 2 : s.kind === 'exit' ? 1 : 0, 0, 0);
        n++;
      }
      e.n = n;
    }
  }

  clear() {
    for (const e of this.units.values()) {
      e.n = 0;
      for (const [o, prev, orig] of e.meshes) { o.onBeforeRender = prev || THREE.Object3D.prototype.onBeforeRender; o.material = orig; }
    }
    this.units.clear();
    for (const m of this.shared.values()) m.dispose();
    this.shared.clear();
  }

  dispose() { this.clear(); }
}
