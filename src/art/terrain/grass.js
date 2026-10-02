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
import { createScrub } from './scrub.js';
import { archetypeGeometry } from './grass-arch.js';
import { placeGround, STRIDE } from './grass-place.js';
import { GRASS_TYPES, GT, vegetationProfile, pickWeighted } from './veg-profile.js';

/**
 * Per-archetype colours (linear, pre-light) for the season: lush root/tip, dry root/tip, seed head / plume, and the
 * wind bend amplitude (m at the tip; stiffness class, docs/vegetation.md §3.0). Index = GT[name].
 */
const LUSH = {
  meadow: [[0.04, 0.062, 0.02], [0.19, 0.215, 0.07]], straw: [[0.075, 0.06, 0.03], [0.19, 0.15, 0.075]],
  forb: [[0.035, 0.068, 0.022], [0.1, 0.16, 0.045]], snowpoke: [[0.1, 0.085, 0.05], [0.22, 0.18, 0.1]],
  seedhead: [[0.045, 0.064, 0.022], [0.2, 0.21, 0.08]], tussock: [[0.04, 0.058, 0.024], [0.16, 0.18, 0.065]],
  flopped: [[0.07, 0.055, 0.03], [0.16, 0.12, 0.065]], marram: [[0.06, 0.075, 0.06], [0.2, 0.25, 0.21]], // glaucous blue-green (dry: straw)
  reed: [[0.05, 0.075, 0.028], [0.17, 0.2, 0.07]], drinn: [[0.11, 0.1, 0.06], [0.27, 0.22, 0.13]],
  wheat: [[0.06, 0.08, 0.025], [0.3, 0.24, 0.09]], stubble: [[0.12, 0.1, 0.05], [0.3, 0.25, 0.13]],
};
const DRY = { root: [0.075, 0.06, 0.03], tip: [0.2, 0.155, 0.075] };
const HEAD = { seedhead: [0.14, 0.105, 0.06], reed: [0.105, 0.078, 0.068], marram: [0.26, 0.23, 0.15], drinn: [0.42, 0.38, 0.3], wheat: [0.42, 0.32, 0.12] };
const AMP = { meadow: 0.28, straw: 0.28, forb: 0.05, snowpoke: 0.1, seedhead: 0.38, tussock: 0.24, flopped: 0.14, marram: 0.42, reed: 0.75, drinn: 0.3, wheat: 0.3, stubble: 0.02 };

/** Fill the colour / amplitude uniform arrays for a vegetation profile. */
export function grassPalette(prof) {
  const v = (a) => new THREE.Vector3(...a);
  const out = { uGRoot: [], uGTip: [], uDRoot: [], uDTip: [], uGHead: [], uGAmp: [] };
  for (const name of GRASS_TYPES) {
    const [r, t] = LUSH[name];
    const dryK = name === 'forb' ? 0.55 : 1;
    // winter / thaw straw is paler buff than late-summer hay (bleached by frost and rain)
    const dTip = prof.dry > 0.75 ? [0.26, 0.21, 0.12] : DRY.tip;
    const dR = r.map((c, i) => c + (DRY.root[i] - c) * dryK), dT = t.map((c, i) => c + (dTip[i] - c) * dryK);
    // winter reeds: buff stems, grey plumes (docs §3.7)
    const head = name === 'reed' && prof.dry > 0.6 ? [0.3, 0.28, 0.25] : name === 'seedhead' && prof.season === 'spring' ? [0.12, 0.11, 0.07] : (HEAD[name] || t);
    out.uGRoot.push(v(r)); out.uGTip.push(v(t)); out.uDRoot.push(v(dR)); out.uDTip.push(v(dT)); out.uGHead.push(v(head));
    out.uGAmp.push(AMP[name]);
  }
  return out;
}

export function grassMaterials(U) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
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
        // blades are waxy but thin: a weak sheen tinted by the blade colour, not a white specular glint
        vec3 tint = 0.45 + 0.55 * vGCol / max(max(vGCol.r, vGCol.g), 1e-3);
        reflectedLight.directSpecular *= 0.3 * tint; reflectedLight.indirectSpecular *= 0.5 * tint;
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

const CHUNK = 16; // 16 m chunks × archetypes present (≈ the old 8 m × 2 draw count); LOD fades per instance
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
    uLodV: { value: new THREE.Vector4(W / 2, D / 2, 1e4, 1) }, uFrost: { value: 0 },
  };
  // docs/vegetation.md §3.0: season / mix from the mission date and place (veg-profile.js)
  const prof = ctx.veg || vegetationProfile(ctx.opts.mission || null, ctx.theater, ctx.src);
  ctx.veg = prof;
  const pal = grassPalette(prof);
  for (const k in pal) U[k] = { value: pal[k] };
  U.uFrost.value = prof.frost;
  const { mat, depth } = grassMaterials(U);
  let geos = [], meshes = [], clutter = null, scrub = null;
  const w8 = new Float32Array(8);
  const excl = ctx.opts.exclude || null; // step 3p: no tufts through hard pavement
  /** Apron grass (addApron): {splat, ox, oz, heightAt, band} — tufts continue past the map edge and thin out. */
  let apron = null;
  const grassW = (x, z) => {
    if (excl && excl(x, z)) return { g: 0, dry: 0, snowPoke: 0, excluded: true };
    if (apron && (x < 0 || z < 0 || x > W || z > D)) splatAt(apron.splat, x - apron.ox, z - apron.oz, w8);
    else splatAt(splat, x, z, w8);
    let g = 0, dry = 0, snowPoke = 0;
    for (let k = 0; k < 8; k++) {
      g += w8[k] * P.grass[k];
      const n = P.layers[k];
      if (n === 'grassdry') dry += w8[k];
      if (n === 'snowold') snowPoke += w8[k];
    }
    return { g, dry: dry / Math.max(1e-3, g), snowPoke };
  };

  // environment for the pure placement (grass-place.js): water band, coast / desert sand, tall-plant clearance
  const sandIdx = ['sand', 'sand2', 'wetsand'].map((n) => P.layers.indexOf(n)).filter((i) => i >= 0);
  const grid = ctx.grid;
  const tallOK = grid ? (x, z) => { // reeds / marram / drinn never grow through decks, walls, structures
    const i0 = Math.floor(x / grid.cell), j0 = Math.floor(z / grid.cell);
    for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) {
      if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) continue;
      const k = j * grid.cols + i;
      if (grid.block[k] || grid.bridge[k] || grid.owner[k] || grid.elev[k] > 0 || grid.underpass?.[k]) return false;
    }
    return true;
  } : undefined;
  const env = {
    W, D, heightAt, grassW, tallOK, waterSD: ctx.waterSD, deepSD: ctx.deepSD, fields: ctx.opts.fields, // bocage.js crop fields
    sandW: (x, z) => { if (excl && excl(x, z)) return 0; splatAt(splat, x, z, w8); let s = 0; for (const i of sandIdx) s += w8[i]; return s; },
  };

  /** Drop the chunks of the map (`apronOnly` false) or only the apron ring's. */
  function clear(apronOnly) {
    const keep = [];
    for (const m of meshes) {
      if (apronOnly && !m.userData.apron) { keep.push(m); continue; }
      group.remove(m); m.geometry.dispose();
    }
    meshes = keep; geos = keep.map((m) => m.geometry);
  }

  /** The apron ring (addApron): whole chunks past each map edge out to the grass band, tufts thinning out. */
  function apronChunks() {
    if (!apron) return [];
    const B = Math.ceil(apron.band * 1.3 / CHUNK) * CHUNK, o = [];
    const segs = (L) => {
      const s = [];
      for (let v = -B; v < 0; v += CHUNK) s.push([v, v + CHUNK, false]);
      for (let v = 0; v < L; v += CHUNK) s.push([v, Math.min(L, v + CHUNK), true]);
      for (let v = L; v < L + B; v += CHUNK) s.push([v, v + CHUNK, false]);
      return s;
    };
    for (const [cz, z1, zin] of segs(D)) for (const [cx, x1, xin] of segs(W)) if (!(xin && zin)) o.push([cx, cz, x1, z1]);
    return o;
  }
  const apronKeep = (px, pz) => {
    const qx = Math.min(W, Math.max(0, px)), qz = Math.min(D, Math.max(0, pz)), d = Math.hypot(px - qx, pz - qz);
    if (d <= 0 || d > apron.band * 1.3) return 0;
    return 1 - smoothstep(apron.band * 0.3, apron.band, d + (fbm(px / 9, pz / 9, 3, 77) - 0.5) * apron.band * 0.6);
  };

  function build(q, apronOnly = false) {
    clear(apronOnly);
    const protos = {};
    const proto = (name) => (protos[name] ||= archetypeGeometry(name, q.grassBlades, 11));
    const perM2 = 9 * q.grassDensity * (ctx.opts.grassDensity ?? 1);
    const po = { perM2, chunk: CHUNK, seed: 1234, reedDensity: q.grassDensity, wind: { x: ctx.windDir.x, z: ctx.windDir.y } };
    const chunks = q.grassDensity > 0 && !apronOnly ? placeGround(env, prof, po) : [];
    // apron (own stream, so the map's tufts are the same with or without it): the same sward, thinning past the edge
    const aEnv = apron && q.grassDensity > 0 ? { ...env, fields: null, heightAt: apron.heightAt, tallOK: () => false,
      grassW: (x, z) => { const k = apronKeep(x, z); if (k <= 0.02) return { g: 0, dry: 0, excluded: true }; const g = grassW(x, z); return { ...g, g: g.g * k }; } } : null;
    for (const c of aEnv ? placeGround(aEnv, prof, { ...po, seed: 4321, macro: false, chunks: apronChunks() }) : []) chunks.push({ ...c, apron: true });
    for (const { cx, cz, lists, apron: out } of chunks) for (const name in lists) {
      const arr = lists[name], n = arr.length / STRIDE;
      const g = proto(name).clone();
      const a = new Float32Array(n * 4), b = new Float32Array(n * 4), e = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < 4; c++) { a[i * 4 + c] = arr[i * STRIDE + c]; b[i * 4 + c] = arr[i * STRIDE + 4 + c]; }
        e[i * 2] = arr[i * STRIDE + 8]; e[i * 2 + 1] = arr[i * STRIDE + 9];
      }
      g.setAttribute('iOff', new THREE.InstancedBufferAttribute(a, 4));
      g.setAttribute('iScl', new THREE.InstancedBufferAttribute(b, 4));
      g.setAttribute('iExt', new THREE.InstancedBufferAttribute(e, 2));
      g.instanceCount = n;
      const top = name === 'reed' ? 3.4 : name === 'marram' || name === 'drinn' ? 1.6 : 1.2;
      let y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) { const y = a[i * 4 + 1]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      g.boundingBox = new THREE.Box3(new THREE.Vector3(cx - 1, y0 - 0.5, cz - 1), new THREE.Vector3(cx + CHUNK + 1, y1 + top, cz + CHUNK + 1));
      if (out) { g.boundingBox.min.y -= 1.5; g.boundingBox.max.y += 1.5; } // apron relief: a margin for its height field
      g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
      const m = new THREE.Mesh(g, mat);
      m.name = 'grass:' + name;
      m.userData.n = n; m.userData.c = [cx + CHUNK / 2, cz + CHUNK / 2]; m.userData.archetype = name; m.userData.apron = !!out;
      m.customDepthMaterial = depth;
      m.castShadow = !!q.shadowsGrass || name === 'reed';
      m.userData.aoExclude = true; // grass self-occlusion is in the blade colour; keeps it out of the GTAO prepass
      m.receiveShadow = true;
      group.add(m); geos.push(g); meshes.push(m);
    }
    Object.values(protos).forEach((g) => g.dispose());
    if (apronOnly) return;
    clutter?.dispose(); scrub?.dispose();
    clutter = createClutter(ctx, q, group, U);
    scrub = prof.scrub || ctx.scrubPlan?.length ? createScrub(ctx, q, group, U) : null;
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
        U.uLodV.value.set(vcx, vcz, Math.max(halfW, 1), frac);
        let tris = 0;
        for (const m of meshes) {
          // nearest point of the chunk to the view centre: the shader fades by each instance's own distance
          const dx = Math.max(0, Math.abs(m.userData.c[0] - vcx) - CHUNK / 2), dz = Math.max(0, Math.abs(m.userData.c[1] - vcz) - CHUNK / 2);
          const f = frac * (Math.hypot(dx, dz) / Math.max(halfW, 1) > 0.92 ? 0.7 : 1);
          m.geometry.instanceCount = Math.max(1, Math.min(m.userData.n, Math.ceil(m.userData.n * f)));
          tris += m.geometry.instanceCount;
        }
        this.drawnInstances = tris;
        const sun = (ctx._sun ||= ctx.sun || ctx.scene.getObjectByProperty('isDirectionalLight', true));
        if (sun) {
          _v.copy(sun.position).sub(sun.target.position).normalize().transformDirection(camera.matrixWorldInverse);
          U.uSunV.value.copy(_v); U.uSunI.value = sun.intensity;
        }
      }
      clutter?.update?.(dt, time); scrub?.update?.(dt, time);
    },
    setQuality(q) { if (q !== curQ) { curQ = q; build(q); } },
    /**
     * Continue the tufts past the map edges over the scenery apron (art/apron.js), thinning out over `band` m:
     * @param {{splat:object, ox:number, oz:number, heightAt:(x:number,z:number)=>number, band:number}} a the apron's
     *   splat (grid origin ox/oz, world m) and height field; null removes them.
     */
    setApron(a) { apron = a && a.band > 0 ? a : null; build(curQ, true); },
    /** Instances in the apron chunks (stats / tests). */
    get apronInstances() { return meshes.reduce((s, m) => s + (m.userData.apron ? m.userData.n : 0), 0); },
    dispose() {
      apron = null; clear(false);
      clutter?.dispose(); scrub?.dispose(); clutter = scrub = null;
      scene.remove(group); mat.dispose(); depth.dispose();
    },
    get profile() { return prof; },
    get scrub() { return scrub; },
  };
}
