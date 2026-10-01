/**
 * Pool layer (bodies-design §B.2–B.3): every pool is a 13 × 13 grid that follows the ground (merged into ONE mesh),
 * reading its 64 × 64 flow tile from a shared RGBA8 atlas (R liquid mm/4, G soaked, B snow halo, A ever wet).
 * Lit MeshStandardMaterial (sun, shadows, the sky environment): wet liquid is glossy with normals from the thickness
 * gradient and a meniscus, then dries from the thin edges inward into a matte crust; soaked ground is a dark matte
 * patch; on snow a vivid core with a feathered pink halo. Only changed tiles are uploaded (texSubImage).
 * @module render/blood/pools
 */
import * as THREE from 'three';
import { CONFIG } from '../../config.js';
import { surfaceCode } from './model.js';
import { BLOOD_GLSL, followTrails } from './glsl.js';

const G = 13;          // grid vertices per side
const TILES = 8;       // atlas tiles per side (64 pools)

export class PoolLayer {
  constructor(sys, scene, uniforms, follow = null) {
    this.sys = sys; this.scene = scene; this.U = uniforms;
    const n = CONFIG.blood.pool.n;
    this.n = n; this.size = n * TILES;
    this.data = new Uint8Array(this.size * this.size * 4);
    this.atlas = new THREE.DataTexture(this.data, this.size, this.size, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.atlas.minFilter = THREE.LinearFilter; this.atlas.magFilter = THREE.LinearFilter; this.atlas.generateMipmaps = false;
    this.atlas.colorSpace = THREE.NoColorSpace; this.atlas.needsUpdate = true;
    this.tile = new THREE.DataTexture(new Uint8Array(n * n * 4), n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.free = Array.from({ length: TILES * TILES }, (_, i) => i);
    this.slot = new Map(); // pool → tile index
    this.mesh = null; this.dirty = true;
    this.follow = follow;
    this.mat = this._material();
  }

  _material() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const U = this.U, atlas = this.atlas, texel = 1 / this.size;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, { uPoolAtlas: { value: atlas }, uPoolTexel: { value: texel } });
      followTrails(sh, this.follow);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aTile; attribute vec4 aPool; varying vec2 vPUv; varying vec2 vPTile; varying vec4 vPool;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPUv = uv; vPTile = aTile; vPool = aPool;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${BLOOD_GLSL}\nuniform sampler2D uPoolAtlas; uniform float uPoolTexel;
varying vec2 vPUv; varying vec2 vPTile; varying vec4 vPool;
float pH; float pWet; float pSoak; float pHalo; vec3 pNrm;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float tilesz = ${(this.n - 2).toFixed(1)} * uPoolTexel;
          vec2 uvA = vPTile + (vec2(1.0) + vPUv * ${(this.n - 2).toFixed(1)}) * uPoolTexel;
          vec4 m = texture2D(uPoolAtlas, uvA);
          float age = uBloodTime - vPool.x, sf = vPool.y;
          vec4 tone = bloodTone(age, sf);
          float h = m.r * 4.0, soak = m.g, halo = m.b;
          // grain-scale break-up of the edges (never a smooth disc)
          float nz = bNoise(vPUv * 48.0 + vPool.w) * 0.6 + bNoise(vPUv * 130.0 + vPool.w * 3.1) * 0.4;
          bool snowS = sf > 0.5 && sf < 1.5, hardS = sf > 4.5 && abs(sf - 8.0) > 0.5;
          float cl;
          if (hardS) {
            // a film on a sealed floor: surface tension rounds the outline (no grain break-up), a slightly blurred
            // thickness so the flow grid never shows as a jagged, fractal edge
            float hb = (h + (texture2D(uPoolAtlas, uvA + vec2(uPoolTexel, 0.0)).r + texture2D(uPoolAtlas, uvA - vec2(uPoolTexel, 0.0)).r
              + texture2D(uPoolAtlas, uvA + vec2(0.0, uPoolTexel)).r + texture2D(uPoolAtlas, uvA - vec2(0.0, uPoolTexel)).r) * 4.0) / 5.0;
            cl = smoothstep(0.08, 0.3, mix(h, hb, 0.75) + (bNoise(vPUv * 9.0 + vPool.w) - 0.5) * 0.05);
          } else cl = smoothstep(0.06, 0.32, h + (nz - 0.5) * 0.18);
          float ageK = snowS ? smoothstep(45.0, 720.0, age) : 0.0;   // snow: the pool keeps changing for minutes
          // soaked edge: crisp but ragged (capillary fingers along the grain on snow)
          float lo0 = bNoise(vPUv * 11.0 + vPool.w * 0.7);
          vec2 gu = mat2(0.8, 0.6, -0.6, 0.8) * vPUv;                               // snow grain direction
          float fib = bNoise(gu * vec2(95.0, 16.0) + vPool.w) * 0.65 + bNoise(gu * vec2(210.0, 40.0)) * 0.35;
          float cs = snowS ? smoothstep(0.05, 0.12, soak + (nz - 0.5) * 0.12 + (lo0 - 0.5) * 0.1 + (fib - 0.5) * 0.12)
                           : smoothstep(0.03, 0.3, soak + (nz - 0.5) * 0.12);
          float lo = bNoise(vPUv * 7.0 + vPool.w * 1.7);                               // lobed, feathered halo outline
          // the pink halo keeps wicking outward through the crystals for minutes, feathered along the grain
          float ch = smoothstep(0.004, 0.11 - 0.06 * ageK, halo * (0.45 + 0.7 * lo) * (0.75 + 0.5 * nz) * (1.0 + 0.8 * ageK * fib));
          // drying: an evaporation depth sweeps up from 0 — thin edges dry first, thick centres stay wet longest
          float dryK = 1.0 - tone.a;
          float evap = 4.2 * dryK;
          pWet = cl * smoothstep(evap, evap + 0.35, h) * (1.0 - step(0.999, dryK));
          vec3 liquid = tone.rgb * mix(1.0, 0.42, clamp(h / 3.0, 0.0, 1.0));           // thicker = darker (Beer–Lambert)
          float crust = (1.0 - pWet) * cl;
          liquid *= 1.0 - crust * 0.25 * (1.0 - smoothstep(0.4, 1.4, h));              // a darker ring where the edge dried
          vec3 soaked;
          if (sf > 0.5 && sf < 1.5) {                                                   // snow: a vivid, saturated core
            // pink where it is diluted at the fringe, crimson where the snow is wet through, dark clots where saturated;
            // sparkle grains stay a touch lighter
            float grain = bNoise(vPUv * 260.0 + vPool.w);
            soaked = mix(uBHalo, uBSnow * 1.2, smoothstep(0.04, 0.22, soak));
            soaked *= mix(1.0, 0.42, smoothstep(0.3, 0.85, soak)) * mix(0.86, 1.1, grain);
            // minutes later: the core clots darker maroon, capillary fingers stand out, the melt dip shades the centre
            soaked = mix(soaked, uBDark * mix(1.5, 0.9, smoothstep(0.3, 0.9, soak)), ageK * 0.55 * smoothstep(0.15, 0.5, soak));
            soaked *= 1.0 - ageK * 0.18 * smoothstep(0.4, 0.95, soak) - ageK * 0.12 * (fib - 0.5);
          } else soaked = tone.rgb * mix(0.85, 0.5, soak);
          vec3 haloC = uBHalo;
          float wL = cl, wS = cs * (1.0 - cl), wH = ch * (1.0 - max(cl, cs));
          float alpha = max(max(cl, cs * (snowS ? 0.97 : 0.93)), ch * 0.55);
          vec3 col = (liquid * wL + soaked * wS + haloC * wH) / max(wL + wS + wH, 1e-3);
          // the tile border fades (a pool that met the tile edge never shows a straight cut)
          vec2 e = min(vPUv, 1.0 - vPUv);
          alpha *= smoothstep(0.0, 0.06, min(e.x, e.y));
          if (alpha < 0.004) discard;
          diffuseColor = vec4(col, alpha * opacity);
          // thickness gradient → a meniscus normal (world space: tile axes rotated by the pool angle)
          float hx = texture2D(uPoolAtlas, uvA + vec2(uPoolTexel, 0.0)).r - texture2D(uPoolAtlas, uvA - vec2(uPoolTexel, 0.0)).r;
          float hy = texture2D(uPoolAtlas, uvA + vec2(0.0, uPoolTexel)).r - texture2D(uPoolAtlas, uvA - vec2(0.0, uPoolTexel)).r;
          float c = cos(vPool.z), s = sin(vPool.z);
          vec2 g = vec2(hx, hy) * 2.2;
          pNrm = normalize(vec3(-(g.x * c - g.y * s), 1.0, -(g.x * s + g.y * c)));
          pH = h; pSoak = cs; pHalo = ch;
        }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          // wet film 0.06 → dry crust 0.75; soaked ground matte (a short sheen on absorbent soil)
          roughnessFactor = mix(mix(0.82, 0.75, pWet), 0.06 + 0.1 * (1.0 - pWet), pWet);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          normal = normalize(mix(normal, (viewMatrix * vec4(pNrm, 0.0)).xyz, pWet * 0.85));`);
    };
    m.customProgramCacheKey = () => 's6blood-pool';
    return m;
  }

  add(p) {
    if (this.slot.has(p) || !this.free.length) return;
    this.slot.set(p, this.free.shift());
    this.dirty = true;
  }

  remove(p) {
    const s = this.slot.get(p);
    if (s == null) return;
    this.slot.delete(p); this.free.push(s);
    this.dirty = true;
  }

  /** Upload pool p's tile (after its sim stepped; zeros before its first step, so a reused slot starts clean). */
  upload(p, gl) {
    const s = this.slot.get(p);
    if (s == null) return;
    const n = this.n, tx = (s % TILES) * n, ty = Math.floor(s / TILES) * n;
    if (gl?.copyTextureToTexture) {
      const d = this.tile.image.data;
      if (p.sim) p.sim.writeTile(d); else d.fill(0);
      gl.copyTextureToTexture(this.tile, this.atlas, null, new THREE.Vector3(tx, ty, 0));
    } else {
      if (p.sim) p.sim.writeTile(this.data, this.size, ty * this.size + tx);
      this.atlas.needsUpdate = true;
    }
  }

  /** Rebuild the merged mesh (pools added / removed). Vertices follow the ground (+1.2 cm). */
  rebuild(gy) {
    this.dirty = false;
    const pools = [...this.slot.keys()], nv = G * G;
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    if (!pools.length) return;
    const pos = new Float32Array(pools.length * nv * 3), uv = new Float32Array(pools.length * nv * 2);
    const tile = new Float32Array(pools.length * nv * 2), pa = new Float32Array(pools.length * nv * 4), idx = [];
    pools.forEach((p, k) => {
      const s = this.slot.get(p), L = CONFIG.blood.pool.cell * Math.max(1, Math.sqrt((p.volume + (p.back || 0)) / 1.0)) * this.n;
      const c = Math.cos(p.rot), sn = Math.sin(p.rot), t0 = this.sys.time - p.age, sf = surfaceCode(p.surface), seed = (p.seed % 997) * 0.37;
      for (let j = 0; j < G; j++) {
        for (let i = 0; i < G; i++) {
          const u = i / (G - 1), v = j / (G - 1), lx = (u - 0.5) * L, ly = (v - 0.5) * L;
          const x = p.x + lx * c - ly * sn, z = p.z + lx * sn + ly * c, q = k * nv + j * G + i;
          pos.set([x, gy(x, z) + 0.012, z], q * 3); uv.set([u, v], q * 2);
          tile.set([(s % TILES) / TILES, Math.floor(s / TILES) / TILES], q * 2);
          pa.set([t0, sf, p.rot, seed], q * 4);
        }
      }
      for (let j = 0; j < G - 1; j++) for (let i = 0; i < G - 1; i++) { const a = k * nv + j * G + i; idx.push(a, a + G, a + 1, a + 1, a + G, a + G + 1); }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aTile', new THREE.BufferAttribute(tile, 2));
    geo.setAttribute('aPool', new THREE.BufferAttribute(pa, 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'blood-pools'; this.mesh.frustumCulled = false; this.mesh.renderOrder = 3; this.mesh.receiveShadow = true;
    this.mesh.userData.noXray = true; this.mesh.userData.aoExclude = true;
    this.mesh.visible = !this._off;
    this.scene.add(this.mesh);
  }

  set visible(v) { this._off = !v; if (this.mesh) this.mesh.visible = v; }

  dispose() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    this.mat.dispose(); this.atlas.dispose(); this.tile.dispose();
  }
}
