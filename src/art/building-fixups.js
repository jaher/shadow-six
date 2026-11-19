/**
 * Load-time fixes for known building-library asset issues (docs/PROGRESS.md open art issues), applied once per
 * loaded GLB scene by building-library.js (clones inherit them). Each fix is keyed by asset name (+ LOD).
 *  - dam_arch LOD2: decimation collapsed the gorge walls (one half as bright) → LOD2 dropped (DROP_LODS)
 *  - barracks_concrete_1st/_2st LOD2 (M14 art pass 2): the kit collapse left a roofless, shredded shell (seen at zoom
 *    < 0.4 and at zoom 0.5 on the low preset) → LOD2 dropped, LOD1 (1.8k / 4k tris) shows instead
 *  - *_snow assets with a turf roof (naust_b, log cabins, barn, fishing shed): the green turf showed through the
 *    snow → the turf faces take the asset's own snow material, their grass tufts dropped (dark spikes in the snow)
 *  - kit snow: its normal map at quarter strength (full strength lit each roof-snow UV tile apart: a checkerboard)
 *  - bunker nets: the desert/snow drapes were opaque hessian sheets → real alpha-tested camouflage netting
 *    (tinted to the theatre); the temperate net gets the same cut-out
 *  - desert palm-frond shades/thatch (kit:palm_frond_dz): exported without alphaMode MASK → the leaf cards drew as
 *    opaque black squares → alpha-tested (cut-out), double-sided
 *  - uboat_pen: Fangrost rib tops had their concrete stretched along 50 m ribs (striped) → object-space triplanar
 *  - chimneys: solid stacks / capped pots and stovepipes (snow-capped on the snow variants) → an open, sooty flue at
 *    every smoke anchor (art/chimney-flues.js)
 *  - coplanar parts (NUDGE_ASSETS; user 2026-11-18 "Make sure there is no z-fighting in the geometry"): sills, plinth
 *    bands, trims, boards exported flush with the walls / each other → the smaller part a few mm proud
 *    (art/coplanar-nudge.js; drawn geometry only)
 *  - round roofs (cones, domes: the log / stone towers, domed houses, bunker and pillbox caps, tank tops): 12-28 facet
 *    surfaces of revolution read as polygons from above → re-tessellated on the true circle (with the whole rings that
 *    continue them, a dome's bead), the analytic normal where the file is flat-shaded, the artist's own where it is
 *    smooth; a decimated LOD's cone gets its normals smoothed (art/round-roofs.js; user 2026-11-09 "Some round roofs
 *    look polygonal when seen from above")
 *  - coplanar faces (z-fighting: user 2026-11-18 "Make sure there is no z-fighting in the geometry"): sills flush with
 *    their window recess, plinth tops under sole plates, lintel undersides in brick soffits, doubled painted boards →
 *    the smaller face of each overlapping coplanar pair sits 6 mm proud (art/coplanar-split.js); the assets in
 *    COPLANAR_SPLIT (those tools/art/zfight.mjs found fighting: the LIGHTS OUT colliery's kit buildings)
 *  - coplanar parts (user 2026-11-18 "Make sure there is no z-fighting in the geometry"; tools/art/zfight.mjs): faces of
 *    two parts of one asset exported in the same plane, or a part's top flush with the ground, flickered → the part
 *    that shows draws a depth step nearer (its own polygonOffset material, as the ground decals do; ZFIGHT_NEAR)
 * @module art/building-fixups
 */

import * as THREE from 'three';
import { loadCompressedTexture } from '../engine/texture-memory.js';
import { openChimneyFlues } from './chimney-flues.js';
import { roundRoofs } from './round-roofs.js';
import { nudgeCoplanar } from './coplanar-nudge.js';
import { separateCoplanar } from './coplanar-split.js';

/**
 * Assets whose coplanar overlapping faces are separated at load (tools/art/zfight.mjs findings); `crossings`: also the
 * near-coplanar crossings (hut_brick_be's eave pier tops, 4 cm out of / 9.5 cm into the pitched sheet roof: the costlier
 * pass, only where needed; `reach`: how far through the other face a crossing may go).
 */
export const COPLANAR_SPLIT = new Map([
  ['hut_brick_be', { crossings: true, reach: 0.12, fixed: /corrugated/ }], ['station_rail_goods', {}], ['shed_tarred_be', {}], ['lock_control_shack', {}],
  ['garage_brick', {}], ['barracks_c', {}], ['guard_hut_b', {}], ['water_tower_legs_ms', {}],
]);

const C = { net: null, netNor: null };

function libTex(base, file, srgb) {
  const t = loadCompressedTexture(`${base}textures/lib/1k/${file}`); // BC7 / ASTC (engine/gpu-compress.js)
  t.flipY = false; // glTF convention (the GLB UVs)
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const meshesOf = (root) => { const out = []; root.traverse((o) => { if (o.isMesh) out.push(o); }); return out; };
const matsOf = (o) => (Array.isArray(o.material) ? o.material : [o.material]);
const setMat = (o, fn) => { o.material = Array.isArray(o.material) ? o.material.map(fn) : fn(o.material); };

/**
 * Coplanar parts drawn a depth step nearer, by asset: the material names (any LOD) whose meshes win where they share a
 * plane with another part, or lie flush with the ground (each mesh gets its own clone; the shared library material
 * stays as it was).
 *  - guard_hut_b: the painted sentry box's striped boards and their tarred backing share the shelf's top and underside
 *  - comms_hut_antenna_bq: the door's stone threshold and timber sill lie with their tops flush with the ground
 */
export const ZFIGHT_NEAR = {
  guard_hut_b: [/^kit:wood_paint$/],
  comms_hut_antenna_bq: [/^kit:ashlar$/, /^kit:timber_beam$/],
};
export function fixCoplanarParts(root, name) {
  const rxs = ZFIGHT_NEAR[name];
  if (!rxs) return 0;
  const clones = new Map();
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    setMat(o, (m) => {
      if (!m || !rxs.some((rx) => rx.test(m.name || ''))) return m;
      if (!clones.has(m)) {
        const c = m.clone();
        c.polygonOffset = true; c.polygonOffsetFactor = -1; c.polygonOffsetUnits = -2;
        clones.set(m, c);
      }
      n++;
      return clones.get(m);
    });
  });
  return n;
}

/**
 * LODs that are not used: the dam's LOD2 decimation collapsed the gorge walls (one wall faces away from the sun →
 * half as bright, crude slabs) → the dam stays on LOD1 when zoomed out.
 */
export const DROP_LODS = { dam_arch: [2], dam_arch_snow: [2], dam_arch_destroyed: [2], barracks_concrete_1st: [2], barracks_concrete_2st: [2] };

/**
 * Assets whose coplanar parts are nudged apart at load (art/coplanar-nudge.js; user 2026-11-18 "Make sure there is no
 * z-fighting in the geometry"): those tools/art/zfight.mjs found fighting — sills flush in their recesses, plinth bands
 * and trims flush with the walls, corner boards across band trims, ridge / barge trims on the roofs, doubled boards —
 * in M3 and M12, with the other theatre's twin of each (the LIGHTS OUT colliery's buildings are COPLANAR_SPLIT's: one
 * mechanism per asset). Render only (gameplay measures the authored geometry; the dam's deck lift too:
 * world/map-library.js calibrateDeck casts on it).
 */
export const NUDGE_ASSETS = new Set([
  'barracks_c_snow', 'barracks_b', 'barracks_b_snow', 'barn_a', 'barn_a_snow', 'house_timber_b', 'house_timber_b_snow', 'house_timber_c',
  'house_timber_c_snow', 'log_cabin_a', 'log_cabin_a_snow', 'log_cabin_b', 'log_cabin_b_snow', 'stabbur_no', 'stabbur_no_snow',
  'hq_colonial_tunis', 'warehouse_harbour_tunis', 'minaret_tunis', 'house_flat_white_a', 'house_flat_white_b',
  'house_flat_white_c', 'drum_stack_ms', 'crate_stack_ms_c', 'crate_stack_ms_d', 'dam_arch', 'dam_arch_snow',
]);

/**
 * Drop the grass tufts from a turf primitive (M5 art review: on the snow variants they poked through the roof snow
 * as clusters of dark spikes): the tufts are small separate pieces (< 40 vertices, < 0.6 m across) beside the turf
 * slab itself, which stays. Returns the number of pieces removed.
 */
export function dropTurfTufts(geo, scale = 1) {
  const P = geo.getAttribute('position'), I = geo.index;
  if (!P || !I) return 0;
  const par = new Int32Array(P.count).map((_, i) => i);
  const f = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const weld = new Map();
  for (let i = 0; i < P.count; i++) {
    const k = `${P.getX(i)},${P.getY(i)},${P.getZ(i)}`, j = weld.get(k);
    if (j === undefined) weld.set(k, i); else par[f(i)] = f(j);
  }
  for (let t = 0; t < I.count; t += 3) { const a = f(I.getX(t)); par[f(I.getX(t + 1))] = a; par[f(I.getX(t + 2))] = f(a); }
  const C = new Map();
  for (let i = 0; i < P.count; i++) {
    const r = f(i); let c = C.get(r);
    if (!c) C.set(r, c = { n: 0, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
    c.n++; const x = P.getX(i), z = P.getZ(i);
    if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (z < c.z0) c.z0 = z; if (z > c.z1) c.z1 = z;
  }
  const tuft = new Set();
  for (const [r, c] of C) if (c.n < 40 && Math.max(c.x1 - c.x0, c.z1 - c.z0) * scale < 0.6) tuft.add(r);
  if (!tuft.size || tuft.size === C.size) return 0;   // never strip a turf made only of small pieces
  const keep = [];
  for (let t = 0; t < I.count; t += 3) if (!tuft.has(f(I.getX(t)))) keep.push(I.getX(t), I.getX(t + 1), I.getX(t + 2));
  geo.setIndex(keep);
  return tuft.size;
}

/** Turf faces of a snow variant → the snow material of the same asset (their grass tufts dropped). */
function fixSnowTurf(root) {
  let snow = null;
  for (const o of meshesOf(root)) for (const m of matsOf(o)) if (!snow && /^kit:snow(~|$)/.test(m.name)) snow = m;
  if (!snow) return 0;
  let n = 0;
  root.updateMatrixWorld?.(true);
  for (const o of meshesOf(root)) {
    if (matsOf(o).some((m) => /turf_grass/.test(m.name)) && !Array.isArray(o.material)) dropTurfTufts(o.geometry, o.matrixWorld.getMaxScaleOnAxis());
    setMat(o, (m) => (/turf_grass/.test(m.name) ? (n++, snow) : m));
  }
  return n;
}

/**
 * The kit snow's normal map at full strength lit every roof-snow UV tile differently (M5 art review: a checkerboard
 * of tiles on the cabin roofs at zoom 2+) → a soft quarter-strength relief. Once per material (they may be shared).
 */
export const SNOW_NORMAL_SCALE = 0.25;
function fixSnowNormals(root) {
  let n = 0;
  for (const o of meshesOf(root)) for (const m of matsOf(o)) {
    if (!/^kit:snow(~|$)/.test(m.name) || !m.normalMap || m.userData.snowNormalFix) continue;
    m.normalScale.multiplyScalar(SNOW_NORMAL_SCALE); m.userData.snowNormalFix = true; n++;
  }
  return n;
}

/** Opaque hessian/net drapes → alpha-cut camouflage netting tinted like the drape. */
function fixBunkerNet(root, base, name) {
  C.net ??= libTex(base, 'camo_netting_diff.png', true);
  C.netNor ??= libTex(base, 'camo_netting_nor.jpg', false);
  const snow = /_snow/.test(name), drape = /^bunker_(desert|snow)$/.test(name), cache = new Map();
  let n = 0;
  for (const o of meshesOf(root)) {
    setMat(o, (m) => {
      if (!/kit:camo_netting/.test(m.name) && !(drape && /kit:hessian/.test(m.name))) return m;
      if (!cache.has(m)) {
        const tint = m.color.clone();
        if (snow) tint.lerp(new THREE.Color(0xe9ecee), 0.75); // winter nets: white-washed garnish
        const nm = new THREE.MeshStandardMaterial({
          name: `${m.name}#net`, color: tint, map: C.net, normalMap: C.netNor, normalScale: new THREE.Vector2(0.8, 0.8),
          roughness: 0.95, metalness: 0, alphaTest: 0.42, side: THREE.DoubleSide, aoMap: m.aoMap ?? null,
        });
        if (m.map) { nm.map = C.net.clone(); nm.map.repeat.copy(m.map.repeat); nm.map.offset.copy(m.map.offset); nm.map.channel = m.map.channel; nm.map.needsUpdate = true; }
        cache.set(m, nm);
      }
      n++;
      return cache.get(m);
    });
    o.castShadow = true;
  }
  return n;
}

/** Palm-frond leaf cards: the RGBA albedo carries the cut-out but the GLB material is OPAQUE → alpha test in place. */
export function fixPalmFrond(root) {
  let n = 0;
  const done = new Set();
  for (const o of meshesOf(root)) {
    for (const m of matsOf(o)) {
      if (!/kit:palm_frond/.test(m.name) || !m.map || done.has(m)) continue;
      done.add(m);
      m.alphaTest = 0.5;
      m.transparent = false;
      m.side = THREE.DoubleSide;
      m.needsUpdate = true;
      n++;
    }
  }
  return n;
}

/** Concrete of the U-boat pen: object-space triplanar albedo/ARM (world space, 2.5 m tiles) instead of the stretched rib UVs. */
function fixUboatConcrete(root) {
  const cache = new Map();
  let n = 0;
  for (const o of meshesOf(root)) {
    setMat(o, (m) => {
      if (!/kit:concrete_(formwork|slab|bunker)/.test(m.name) || !m.map) return m;
      if (!cache.has(m)) {
        const t = m.clone();
        t.name = `${m.name}#tri`;
        t.normalScale = new THREE.Vector2(0.35, 0.35);
        t.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTriPos; varying vec3 vTriNrm;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vTriNrm = mat3(modelMatrix) * objectNormal;');
          const tri = 'vec4 triSample(sampler2D s){ vec3 w=pow(abs(normalize(vTriNrm)),vec3(4.0)); w/=w.x+w.y+w.z+1e-5; vec3 p=vTriPos*0.4; return texture2D(s,p.zy)*w.x+texture2D(s,p.xz)*w.y+texture2D(s,p.xy)*w.z; }\nfloat triHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat triNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(triHash(i),triHash(i+vec2(1,0)),f.x),mix(triHash(i+vec2(0,1)),triHash(i+vec2(1,1)),f.x),f.y); }';
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vTriPos; varying vec3 vTriNrm;\n${tri}`)
            .replace('#include <map_fragment>', 'diffuseColor *= triSample(map);\n{ float m = triNoise(vTriPos.xz * 0.09) * 0.6 + triNoise(vTriPos.xz * 0.31 + 7.0) * 0.4; diffuseColor.rgb *= 0.72 + 0.4 * m; }')
            .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness;\n#ifdef USE_ROUGHNESSMAP\nroughnessFactor *= triSample(roughnessMap).g;\n#endif');
        };
        t.customProgramCacheKey = () => 'uboat_tri_v2';
        cache.set(m, t);
      }
      n++;
      return cache.get(m);
    });
  }
  return n;
}

/**
 * Apply the fixes that match `name` / `lod` to a freshly loaded scene.
 * @param {object} [meta] the asset's manifest entry (its anchors: chimney flues)
 * @returns {string[]} applied fix ids (for logs/tests)
 */
export function applyAssetFixups(root, name, lod, base = 'assets/', meta = null) {
  const out = [];
  // first: the flues cut the asset's own geometry (its turf → snow swap and materials do not matter to them)
  if (meta?.anchors?.length && openChimneyFlues(root, meta.anchors, { name, lod }).length) out.push('chimney-flues');
  if (/_snow$/.test(name) && fixSnowTurf(root)) out.push('snow-turf');
  if (fixSnowNormals(root)) out.push('snow-normals'); // every asset with kit snow (snow variants, snowy ruins)
  if (fixBunkerNet(root, base, name)) out.push('camo-net'); // every kit camo net; the desert/snow bunker hessian drapes
  if (fixPalmFrond(root)) out.push('palm-frond-cutout'); // every desert asset with frond shades/thatch
  if (/^uboat_pen/.test(name) && fixUboatConcrete(root)) out.push('uboat-triplanar');
  if (NUDGE_ASSETS.has(name)) { const r = nudgeCoplanar(root, { ground: true }); if (r.moved || r.doubled) out.push('coplanar-nudge'); } // after the turf → snow swap
  if (roundRoofs(root, lod)) out.push('round-roofs'); // every cone / dome of every asset (its own LOD's tolerance)
  if (COPLANAR_SPLIT.has(name) && separateCoplanar(root, { crossings: false, ...COPLANAR_SPLIT.get(name) }).moved) out.push('coplanar-split'); // last: on the final faces
  if (fixCoplanarParts(root, name)) out.push('coplanar-near');
  return out;
}
