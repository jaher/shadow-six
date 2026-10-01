/**
 * 3D instanced grass tufts (density from the splat 'grass' weights), wind, trampling from the trail RT,
 * shadows (custom depth material), zoom-aware blade widening + density LOD, frustum-culled 8 m chunks.
 * Also spawns ground clutter (clutter.js).
 * @module terrain-b/grass
 */
import * as THREE from 'three';
import { WIND_UNIFORMS } from '../../world/wind.js';
import { GRASS_PARS, GRASS_NORMAL, GRASS_BEGIN, GRASS_BEGIN_DEPTH, GRASS_COLOR } from './grass-glsl.js';
import { rng, fbm } from './noise.js';
const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
import { splatAt } from './terrain-layers.js';
import { createClutter } from './clutter.js';

/** Tuft of `n` curved blades; attributes position, normal, aBlade (t, side, lateral dir). */
export function tuftGeometry(n = 9, seed = 1, o = {}) {
  const r = rng(seed);
  const SEG = o.seg || 4;
  const pos = [], nor = [], bl = [], idx = [];
  for (let b = 0; b < n; b++) {
    const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * (o.radius ?? 0.09);
    const bx = Math.cos(a) * rad, bz = Math.sin(a) * rad;
    const h = (o.hMin ?? 0.22) + r() * ((o.hMax ?? 0.5) - (o.hMin ?? 0.22));
    const w = (o.wMin ?? 0.006) + r() * (o.wVar ?? 0.008);
    const lean = (o.lean ?? 0.35) * (0.4 + r());       // outward lean (m at tip per m height)
    const face = a + (r() - 0.5) * 1.2;                  // blade facing
    const lx = Math.cos(face + Math.PI / 2), lz = Math.sin(face + Math.PI / 2);
    const dx = Math.cos(a), dz = Math.sin(a);
    const base = pos.length / 3;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const cx = bx + dx * lean * h * t * t, cz = bz + dz * lean * h * t * t;
      const y = h * (t - 0.15 * lean * t * t);
      const ww = w * (1 - t * 0.85);
      const nx = Math.cos(face), nz = Math.sin(face);
      if (s < SEG) {
        pos.push(cx - lx * ww, y, cz - lz * ww, cx + lx * ww, y, cz + lz * ww);
        nor.push(nx, 0.3, nz, nx, 0.3, nz);
        bl.push(t, -1, lx, lz, t, 1, lx, lz);
      } else {
        pos.push(cx, y, cz); nor.push(nx, 0.3, nz); bl.push(1, 0, lx, lz);
      }
    }
    for (let s = 0; s < SEG - 1; s++) {
      const i = base + s * 2;
      idx.push(i, i + 1, i + 3, i, i + 3, i + 2);
    }
    const i = base + (SEG - 1) * 2;
    idx.push(i, i + 1, i + 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(bl, 4));
  g.setIndex(idx);
  return g;
}

export function grassMaterials(U) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = GRASS_PARS + sh.vertexShader
      .replace('#include <beginnormal_vertex>', GRASS_NORMAL)
      .replace('#include <begin_vertex>', GRASS_BEGIN);
    sh.fragmentShader = 'varying vec3 vGCol;\nvarying float vGT;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', GRASS_COLOR)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal); nonPerturbedNormal = normal;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // cheap translucency: light through thin blades from behind
        float tl = max(dot(normalize(uSunV), -normalize(vViewPosition)), 0.0);
        reflectedLight.directDiffuse += vGCol * vec3(1.0, 1.1, 0.6) * uSunI * 0.05 * vGT * (0.3 + 0.7 * tl);`);
    sh.fragmentShader = 'uniform vec3 uSunV;\nuniform float uSunI;\n' + sh.fragmentShader;
  };
  mat.customProgramCacheKey = () => 'grassB';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = GRASS_PARS + sh.vertexShader.replace('#include <begin_vertex>', GRASS_BEGIN_DEPTH);
  };
  depth.customProgramCacheKey = () => 'grassBdepth';
  return { mat, depth };
}

const CHUNK = 8;
const BLANK_MASK = (() => { const t = new THREE.DataTexture(new Uint8Array(4), 1, 1); t.needsUpdate = true; return t; })();

/**
 * @param {object} ctx terrain context (grid, splat, P palette, heightAt, trails, windDir, tNoise, W, D, opts)
 * @param {object} Q quality preset (grassDensity, grassBlades, clutter, shadowsGrass)
 */
export function createGrass(ctx, Q) {
  const { scene, splat, P, heightAt, trails, W, D } = ctx;
  const group = new THREE.Group();
  group.name = 'grassB';
  scene.add(group);
  const U = {
    ...WIND_UNIFORMS, // step 4w shared wind (world/wind.js); uWind/uWindStr kept: legacy dir + a 0..1 multiplier
    uTime: { value: 0 }, uWind: { value: ctx.windDir.clone() }, uWindStr: { value: ctx.opts.windStrength ?? 1 },
    tTrail: { value: trails.texture }, tFlatG: { value: trails.flatTexture }, tNoiseG: { value: ctx.tNoise },
    uMapG: { value: new THREE.Vector4(W, D, 1 / W, 1 / D) }, uMinW: { value: 0.02 }, uLodW: { value: 1 },
    uSunV: { value: new THREE.Vector3(0, 1, 0) }, uSunI: { value: 3 },
    tBloodG: { value: BLANK_MASK }, // set by render/blood (grass blades soaked red-brown where blood lies)
  };
  const { mat, depth } = grassMaterials(U);
  let geos = [], meshes = [], clutter = null;
  const w8 = new Float32Array(8);
  const excl = ctx.opts.exclude || null; // step 3p: no tufts through hard pavement
  const grassW = (x, z) => {
    if (excl && excl(x, z)) return { g: 0, dry: 0, snowPoke: 0, excluded: true };
    splatAt(splat, x, z, w8);
    let g = 0, dry = 0, snowPoke = 0;
    for (let k = 0; k < 8; k++) {
      g += w8[k] * P.grass[k];
      const n = P.layers[k];
      if (n === 'grassdry') dry += w8[k];
      if (n === 'snowold') snowPoke += w8[k];
    }
    return { g, dry: dry / Math.max(1e-3, g), snowPoke };
  };

  function build(q) {
    for (const m of meshes) group.remove(m);
    geos.forEach((g) => g.dispose());
    geos = []; meshes = [];
    const blades = q.grassBlades;
    const base = tuftGeometry(blades, 11, { hMin: 0.18, hMax: 0.46 });
    const baseDry = tuftGeometry(Math.max(4, blades - 2), 12, { hMin: 0.2, hMax: 0.55, lean: 0.55, wMin: 0.005 });
    const perM2 = 9 * q.grassDensity * (ctx.opts.grassDensity ?? 1);
    const r = rng(1234);
    for (let cz = 0; cz < D; cz += CHUNK) for (let cx = 0; cx < W; cx += CHUNK) {
      const inst = [[], []]; // per base geometry: [x,y,z,rot, h,w,col,type]
      const cell = 1 / Math.sqrt(perM2);
      for (let z = cz; z < Math.min(D, cz + CHUNK); z += cell) for (let x = cx; x < Math.min(W, cx + CHUNK); x += cell) {
        const px = x + r() * cell, pz = z + r() * cell;
        const gw = grassW(px, pz);
        if (gw.excluded) continue;
        // must-fix 5: ragged verge — noise-jittered density threshold, shorter/flattened/drier tufts at the edge
        const ge = gw.g + (fbm(px / 2.8, pz / 2.8, 3, 71) - 0.5) * 0.6 + (fbm(px / 0.9, pz / 0.9, 2, 73) - 0.5) * 0.3 + (r() - 0.5) * 0.15;
        if (r() > smoothstep(0.12, 0.7, ge)) continue;
        const edge = 1 - smoothstep(0.2, 0.85, ge);
        const dry = r() < Math.max(gw.dry, edge * 0.45);
        const clump = 0.55 + 0.9 * r() * r();
        const type = dry ? 1 : (r() < 0.04 ? 2 : 0);
        const hs = (type === 2 ? 1.5 : 1) * clump * (0.75 + 0.5 * gw.g) * (1 - 0.5 * edge);
        inst[dry ? 1 : 0].push(px, heightAt(px, pz) - 0.01, pz, r() * 6.283, hs, 1, r(), type);
      }
      inst.forEach((arr, k) => {
        if (!arr.length) return;
        const g = (k ? baseDry : base).clone();
        const n = arr.length / 8;
        for (let i = n - 1; i > 0; i--) { // shuffle so any prefix is a uniform subset (density LOD = instanceCount)
          const j = Math.floor(r() * (i + 1));
          for (let c = 0; c < 8; c++) { const t = arr[i * 8 + c]; arr[i * 8 + c] = arr[j * 8 + c]; arr[j * 8 + c] = t; }
        }
        const a = new Float32Array(n * 4), b = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) { for (let c = 0; c < 4; c++) { a[i * 4 + c] = arr[i * 8 + c]; b[i * 4 + c] = arr[i * 8 + 4 + c]; } }
        g.setAttribute('iOff', new THREE.InstancedBufferAttribute(a, 4));
        g.setAttribute('iScl', new THREE.InstancedBufferAttribute(b, 4));
        g.instanceCount = n;
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx + CHUNK / 2, 0.3, cz + CHUNK / 2), CHUNK * 0.75 + 0.6);
        g.boundingBox = new THREE.Box3(new THREE.Vector3(cx - 0.5, -1, cz - 0.5), new THREE.Vector3(cx + CHUNK + 0.5, 1.2, cz + CHUNK + 0.5));
        const m = new THREE.Mesh(g, mat);
        m.userData.n = n; m.userData.c = [cx + CHUNK / 2, cz + CHUNK / 2];
        m.customDepthMaterial = depth;
        m.castShadow = !!q.shadowsGrass;
        m.userData.aoExclude = true; // grass self-occlusion is in the blade colour; keeps it out of the GTAO prepass
        m.receiveShadow = true;
        group.add(m); geos.push(g); meshes.push(m);
      });
    }
    base.dispose(); baseDry.dispose();
    clutter?.dispose();
    clutter = createClutter(ctx, q, group, U);
  }
  let curQ = Q;
  build(Q);
  const _v = new THREE.Vector3(), _t = new THREE.Vector3();
  return {
    group, uniforms: U,
    get instanceCount() { return meshes.reduce((s, m) => s + m.geometry.instanceCount, 0); },
    get totalInstances() { return meshes.reduce((s, m) => s + m.userData.n, 0); },
    update(dt, camera, time) {
      U.uTime.value = time;
      U.tTrail.value = trails.texture;
      if (camera) {
        // world metres per pixel → minimum blade width (≈1.1 px)
        const h = (camera.top - camera.bottom) / camera.zoom;
        const px = h / (ctx.gl.domElement.height || 1080);
        U.uMinW.value = px * 1.1;
        // must-fix 9: zoom + distance density LOD (coverage kept by widening blades), ultra capped in TERRAIN_QUALITY
        const pxPerM = 1 / px, frac = Math.min(1, Math.max(0.4, pxPerM / 55));
        U.uLodW.value = 1 / Math.sqrt(frac);
        const halfW = (camera.right - camera.left) / camera.zoom / 2;
        _t.set(0, 0, -1).applyQuaternion(camera.quaternion);
        const k = _t.y < -1e-3 ? -camera.position.y / _t.y : 0; // view centre on the ground plane
        const vcx = camera.position.x + _t.x * k, vcz = camera.position.z + _t.z * k;
        let tris = 0;
        for (const m of meshes) {
          const d = Math.hypot(m.userData.c[0] - vcx, m.userData.c[1] - vcz) / Math.max(halfW, 1);
          const f = frac * (d > 0.85 ? 0.7 : 1);
          m.geometry.instanceCount = Math.max(1, Math.round(m.userData.n * f));
          tris += m.geometry.instanceCount;
        }
        this.drawnInstances = tris;
        const sun = (ctx._sun ||= ctx.sun || ctx.scene.getObjectByProperty('isDirectionalLight', true));
        if (sun) {
          _v.copy(sun.position).sub(sun.target.position).normalize().transformDirection(camera.matrixWorldInverse);
          U.uSunV.value.copy(_v); U.uSunI.value = sun.intensity;
        }
      }
      clutter?.update?.(dt, time);
    },
    setQuality(q) { if (q !== curQ) { curQ = q; build(q); } },
    dispose() { build({ grassDensity: 0, grassBlades: 1 }); clutter?.dispose(); scene.remove(group); mat.dispose(); depth.dispose(); },
  };
}
