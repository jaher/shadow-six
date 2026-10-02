/**
 * The plunge pool and tailwater below the dam (M3; render/dam-water.js): bakes the flow field of the pool and river
 * from the nav grid's water cells (render/dam-flow.js) and draws the moving water on top of the water surface —
 * aerated boil, roller, standing waves, foam streaks and bubbles carried by the current (render/dam-water-pool-glsl.js).
 *
 *   const pool = createDamPool(world, F, { sources, boilV, uniforms }); group.add(pool.mesh); pool.field.sample(u, v)
 * @module render/dam-water-pool
 */
import * as THREE from 'three';
import { bakeDamFlow } from './dam-flow.js';
import { POOL_VERT, POOL_FRAG } from './dam-water-pool-glsl.js';
import { createFoamField } from './dam-water-foam.js';

/** Bake domain in the dam frame (m): the foot of the face down to where the river leaves the view. */
export const POOL_DOMAIN = { u0: -22, v0: 1, nu: 80, nv: 80, h: 0.7 };
const TEX_BASE = new URL('../../assets/water/', import.meta.url).href;
let texCache = null;
function textures() {
  if (texCache) return texCache;
  const ld = new THREE.TextureLoader(), waits = [];
  const mk = (f) => {
    let t;
    waits.push(new Promise((ok) => { t = ld.load(TEX_BASE + f, ok, undefined, (e) => { console.error('[dam-water] texture', f, e); ok(); }); }));
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  };
  texCache = { lace: mk('foam2.png'), norm: mk('waternormals.jpg') };
  texCache.ready = Promise.all(waits).then(() => undefined);
  return texCache;
}

/**
 * Start loading the pool's lace / normal textures; resolves when both are decoded. The map load awaits it
 * (world/map-builder.js), so the pool's first frame never samples an empty texture (a blown-out white pool).
 */
export function loadDamPoolTextures() { return textures().ready; }

/**
 * @param {object} world  (grid: nav grid with terrain 5/6 = water)
 * @param {{v:Function, world:Function}} F  face sampler (dam-water-geom.js)
 * @param {{sources:object[], boilV:number, y:number, uniforms:object, domain?:object}} o
 */
/**
 * Mass sources of the pool (dam frame): the roller diving back under at the face, the boil where the plunging jet
 * comes back up, the jet's momentum carrying on downstream, the water entrained into the jet at its sides, and a
 * small boil at each flowing trickle's foot.
 * @param {number} mid  v of the face's foot at u = 0 (m)  @param {{u:number, v:number}[]} [trickles] feet of the trickles
 */
export function poolSources(mid, trickles = []) {
  return [
    { u: 0, v: mid + 0.35, ru: 3.0, rv: 0.45, q: -4, foam: 0.5, aer: 0.7 },
    { u: 0, v: mid + 1.6, ru: 2.6, rv: 0.9, q: 10, foam: 1, aer: 1 },
    { u: 0, v: mid + 3.8, ru: 2.8, rv: 1.6, q: 0, push: 2.5, foam: 0.35, aer: 0.45 },
    // the plunging jet entrains the water beside it (it dives into the jet and comes back up in the boil): the sides
    // are drawn in towards the plunge and the banks answer with a slow return current upstream — the side eddies
    { u: -4.4, v: mid + 3.2, ru: 1.5, rv: 2.6, q: -1.4, foam: 0, aer: 0 },
    { u: 4.4, v: mid + 3.2, ru: 1.5, rv: 2.6, q: -1.4, foam: 0, aer: 0 },
    ...trickles.map((t) => ({ u: t.u, v: t.v + 0.5, ru: 0.5, rv: 0.4, q: 0.6, foam: 0.3, aer: 0.35 })),
  ];
}

/**
 * Bake the pool's flow field: water = the nav grid's water/shallow cells downstream of the face's foot.
 * @param {{cols:number, rows:number, terrain:Uint8Array, cell?:number}} grid
 * @param {{v:(u:number, y:number)=>number|null, world:(u:number, v:number)=>number[]}} F face sampler (or an analytic stand-in)
 */
export function bakePool(grid, F, sources, o = {}) {
  const D = { ...POOL_DOMAIN, ...(o.domain || {}) }, cell = grid.cell || 0.5, foot = new Map();
  const footV = (u) => { const k = Math.round(u * 2) / 2; if (!foot.has(k)) foot.set(k, F.v(k, 0.15)); return foot.get(k); };
  const wet = (x, z) => { const i = Math.floor(x / cell), j = Math.floor(z / cell); if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) return false; const t = grid.terrain[j * grid.cols + i]; return t === 5 || t === 6; };
  const isWater = (u, v) => { const f = footV(u); if (f != null && v < f + 0.1) return false; const [x, z] = F.world(u, v); return wet(x, z); };
  const t0 = performance.now();
  const field = bakeDamFlow({ isWater, ...D, sources, steps: 200, speed: o.speed ?? 1.5,
    isOut: (u, v) => v > D.v0 + D.nv * D.h - 1.6 || (u > D.u0 + D.nu * D.h - 1.6 && v > 20) });
  field.ms = performance.now() - t0;
  return field;
}

/**
 * Separable Gaussian blur of a field over the water cells only (normalised by the water's own weight, so the banks
 * neither dim it nor receive any); sigmas in cells along u and v. Dry cells come out 0.
 */
export function blurMasked(src, mask, nu, nv, su, sv) {
  const kern = (s) => { const r = Math.ceil(s * 2.5), k = []; for (let d = -r; d <= r; d++) k.push(Math.exp(-0.5 * (d / s) ** 2)); return [r, k]; };
  const [ru, ku] = kern(su), [rv, kv] = kern(sv), n = nu * nv;
  const a = new Float32Array(n), w = new Float32Array(n), a2 = new Float32Array(n), w2 = new Float32Array(n), out = new Float32Array(n);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    let sa = 0, sw = 0;
    for (let d = -ru; d <= ru; d++) { const x = i + d; if (x < 0 || x >= nu) continue; const q = j * nu + x; if (!mask[q]) continue; sa += src[q] * ku[d + ru]; sw += ku[d + ru]; }
    a[j * nu + i] = sa; w[j * nu + i] = sw;
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    let sa = 0, sw = 0;
    for (let d = -rv; d <= rv; d++) { const y = j + d; if (y < 0 || y >= nv) continue; const q = y * nu + i; sa += a[q] * kv[d + rv]; sw += w[q] * kv[d + rv]; }
    a2[j * nu + i] = sa; w2[j * nu + i] = sw;
  }
  for (let k = 0; k < n; k++) out[k] = mask[k] && w2[k] > 1e-6 ? a2[k] / w2[k] : 0;
  return out;
}

export function createDamPool(world, F, o) {
  if (!world.grid?.terrain) return null;
  const field = bakePool(world.grid, F, o.sources, o);
  // the field as a half-float texture (rg current m/s, b foam, a aeration)
  const { nu, nv, h, u0, v0 } = field, data = new Uint16Array(nu * nv * 4), toH = THREE.DataUtils.toHalfFloat;
  // the drawn foam and aeration are blurred (wider across the stream than along it): advected without diffusion, the
  // baked boil ends on a straight line along the jet's flanks, where the real one frays out into the slack water
  const foamB = blurMasked(field.foam, field.mask, nu, nv, 3.2, 1.6), aerB = blurMasked(field.aer, field.mask, nu, nv, 3.2, 1.6);
  for (let k = 0; k < nu * nv; k++) { data[k * 4] = toH(field.vel[k * 2]); data[k * 4 + 1] = toH(field.vel[k * 2 + 1]); data[k * 4 + 2] = toH(foamB[k]); data[k * 4 + 3] = toH(aerB[k]); }
  // the foam and aeration reach 2 cells upstream past the water (still): the boil runs on under the curtains' feet and the
  // face, so the pool and the falling sheets overlap instead of meeting along a seam
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    if (field.mask[j * nu + i]) continue;
    let f = 0, ae = 0;
    for (let b = 1; b <= 2; b++) for (let a = -1; a <= 1; a++) {      // water just downstream: the face's foot, not a bank
      const x = i + a, y = j + b, q = y * nu + x;
      if (x < 0 || y < 0 || x >= nu || y >= nv || !field.mask[q]) continue;
      const w = b > 1 ? 0.6 : 0.9;
      f = Math.max(f, foamB[q] * w); ae = Math.max(ae, aerB[q] * w);
    }
    data[(j * nu + i) * 4 + 2] = toH(f); data[(j * nu + i) * 4 + 3] = toH(ae);
  }
  const tex = new THREE.DataTexture(data, nu, nv, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
  // mesh: the grid's cells within two cells of the water (corners shared), lying on the water surface
  const near = (i, j) => { for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) { const x = i + a, y = j + b; if (x >= 0 && y >= 0 && x < nu && y < nv && field.mask[y * nu + x]) return true; } return false; };
  const pos = [], dam = [], idx = [], vid = new Int32Array((nu + 1) * (nv + 1)).fill(-1);
  const vert = (i, j) => {
    const k = j * (nu + 1) + i;
    if (vid[k] < 0) { const u = u0 + i * h, v = v0 + j * h, [x, z] = F.world(u, v); vid[k] = pos.length / 3; pos.push(x, o.y, z); dam.push(u, v); }
    return vid[k];
  };
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) if (near(i, j)) {
    const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('dam', new THREE.Float32BufferAttribute(dam, 2));
  geo.setIndex(idx); geo.computeBoundingSphere();
  const T = textures(), U = o.uniforms, sheets = o.sheets || [-1, 1];
  // the persistent foam carried by the current (GPU; without a renderer: none, the foam texture stays black)
  const foam = o.gl ? createFoamField(o.gl, tex, field, { boilV: o.boilV, mid: o.mid ?? o.boilV - 1.6, sheets }) : null;
  const black = foam ? null : new THREE.DataTexture(new Uint8Array(4), 1, 1);
  if (black) black.needsUpdate = true;
  const mat = new THREE.ShaderMaterial({
    name: 'dam_pool', vertexShader: POOL_VERT, fragmentShader: POOL_FRAG, transparent: true, depthWrite: false, premultipliedAlpha: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    extensions: { derivatives: true },
    uniforms: {
      uTime: U.uTime, uLight: U.uLight, uFade: U.uFade, uNight: U.uNight, uSunI: U.uSunI, uSunDir: U.uSunDir, uSky: U.uSky,
      uFlow: { value: tex }, uFoamF: foam ? foam.texture : { value: black }, uStepT: foam ? foam.stepT : { value: 0 },
      uFoamDom: { value: foam ? new THREE.Vector4(foam.domain.x, foam.domain.y, 1 / foam.domain.z, 1 / foam.domain.w) : new THREE.Vector4(0, 0, 1, 1) },
      uMid: { value: o.mid ?? o.boilV - 1.6 }, uSheets: { value: new THREE.Vector4(sheets[0], sheets[1] ?? sheets[0], 0.75, 0) }, uLace: { value: T.lace }, uNorm: { value: T.norm },
      uDomain: { value: new THREE.Vector4(u0, v0, 1 / (nu * h), 1 / (nv * h)) }, uBoilV: { value: o.boilV }, uRot: { value: new THREE.Vector2(o.rot?.[0] ?? 1, o.rot?.[1] ?? 0) },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'dam-pool'; mesh.renderOrder = 2;
  return {
    mesh, field, tex, foam,
    /** Advance the foam field; `t` = the pool clock after this frame. */
    frame(dt, t) { foam?.frame(dt, t); },
    dispose() { geo.dispose(); mat.dispose(); tex.dispose(); foam?.dispose(); black?.dispose(); },
  };
}
