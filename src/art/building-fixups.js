/**
 * Load-time fixes for known building-library asset issues (docs/PROGRESS.md open art issues), applied once per
 * loaded GLB scene by building-library.js (clones inherit them). Each fix is keyed by asset name (+ LOD).
 *  - dam_arch LOD2: decimation collapsed the gorge walls (one half as bright) → LOD2 dropped (DROP_LODS)
 *  - *_snow assets with a turf roof (naust_b, log cabins, barn, fishing shed): the green turf showed through the
 *    snow → the turf faces take the asset's own snow material
 *  - bunker nets: the desert/snow drapes were opaque hessian sheets → real alpha-tested camouflage netting
 *    (tinted to the theatre); the temperate net gets the same cut-out
 *  - uboat_pen: Fangrost rib tops had their concrete stretched along 50 m ribs (striped) → object-space triplanar
 * @module art/building-fixups
 */

import * as THREE from 'three';

const C = { net: null, netNor: null };

function libTex(base, file, srgb) {
  const t = new THREE.TextureLoader().load(`${base}textures/lib/1k/${file}`);
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
 * LODs that are not used: the dam's LOD2 decimation collapsed the gorge walls (one wall faces away from the sun →
 * half as bright, crude slabs) → the dam stays on LOD1 when zoomed out.
 */
export const DROP_LODS = { dam_arch: [2], dam_arch_snow: [2], dam_arch_destroyed: [2] };

/** Turf faces of a snow variant → the snow material of the same asset. */
function fixSnowTurf(root) {
  let snow = null;
  for (const o of meshesOf(root)) for (const m of matsOf(o)) if (!snow && /^kit:snow(~|$)/.test(m.name)) snow = m;
  if (!snow) return 0;
  let n = 0;
  for (const o of meshesOf(root)) setMat(o, (m) => (/turf_grass/.test(m.name) ? (n++, snow) : m));
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
 * @returns {string[]} applied fix ids (for logs/tests)
 */
export function applyAssetFixups(root, name, lod, base = 'assets/') {
  const out = [];
  if (/_snow$/.test(name) && fixSnowTurf(root)) out.push('snow-turf');
  if (fixBunkerNet(root, base, name)) out.push('camo-net'); // every kit camo net; the desert/snow bunker hessian drapes
  if (/^uboat_pen/.test(name) && fixUboatConcrete(root)) out.push('uboat-triplanar');
  return out;
}
