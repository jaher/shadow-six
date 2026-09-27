// charkit.js — SHADOW SIX runtime for pipeline characters (UAL skeleton, shared anims.glb, weapons.glb).
// Implements the ARCHITECTURE.md humanoid interface: setAnim(name,{loop,speed}), update(dt), setColors(opts), setDisguise(bool).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));

// ---------------- animation library ----------------
// anims.glb: UAL skeleton + all clips (already adapted: quaternion tracks + pelvis.position only), scene.userData.shadowSix.clips = meta
export async function loadAnimLibrary(url) {
  const g = await load(url);
  const meta = (g.scene.userData.shadowSix || {}).clips || {};
  const clips = new Map();
  for (const c of g.animations) clips.set(c.name, c);
  const srcPelvisRest = (g.scene.userData.shadowSix || {}).pelvisRest;
  return { clips, meta, srcPelvisRest: srcPelvisRest ? new THREE.Vector3(...srcPelvisRest) : null, gltf: g };
}

// strip non-rotation tracks (except pelvis.position), rescale pelvis motion to the character's leg length
export function adaptClip(clip, { srcPelvisRest, tgtPelvisRest, ratio = 1, keepRootMotion = false } = {}) {
  const c = clip.clone();
  c.tracks = c.tracks.filter(t => {
    const i = t.name.lastIndexOf('.'); const node = t.name.slice(0, i), prop = t.name.slice(i + 1);
    if (prop === 'scale') return false;
    if (prop === 'position') {
      if (node === 'root') return keepRootMotion;
      if (node !== 'pelvis') return false;
      if (srcPelvisRest && tgtPelvisRest) {
        const v = t.values;
        for (let k = 0; k < v.length; k += 3) {
          v[k] = tgtPelvisRest.x + (v[k] - srcPelvisRest.x) * ratio;
          v[k + 1] = tgtPelvisRest.y + (v[k + 1] - srcPelvisRest.y) * ratio;
          v[k + 2] = tgtPelvisRest.z + (v[k + 2] - srcPelvisRest.z) * ratio;
        }
      }
    }
    return true;
  });
  return c;
}

// ---------------- character template ----------------
export async function loadCharacter(url) {
  const g = await load(url);
  const info = g.scene.userData.shadowSix || {};
  g.scene.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true; o.frustumCulled = false;
    if (o.geometry.attributes._mask) patchShading(o.material);
    else if (o.material.alphaTest > 0 || o.material.transparent) { o.castShadow = false; }
  });
  return { gltf: g, info, url, _clipCache: new Map() };
}

function bonesOf(root) { const m = {}; root.traverse(o => { if (o.isBone && !(o.name in m)) m[o.name] = o; }); return m; }

// LOD by on-screen scale (CSS px per metre of the orthographic game camera): >=60 LOD0, >=28 LOD1, else LOD2
export function lodFor(pxPerMetre) { return pxPerMetre >= 60 ? 'LOD0' : pxPerMetre >= 28 ? 'LOD1' : 'LOD2'; }

// close-zoom shading (realism-pipeline §1.4): wrap/SSS tint on skin, sheen rim on cloth, driven by the per-vertex
// _mask attribute (x = skin, y = cloth). One shared patch per material; cheap enough to keep on at every zoom.
export function patchShading(material, { skinWrap = 0.35, sheen = 0.22 } = {}) {
  if (material.userData.s6patched) return material;
  material.userData.s6patched = true;
  material.onBeforeCompile = (sh) => {
    sh.uniforms.s6Wrap = { value: skinWrap }; sh.uniforms.s6Sheen = { value: sheen };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 _mask;\nvarying vec2 vS6Mask;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvS6Mask = _mask.xy;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float s6Wrap; uniform float s6Sheen; varying vec2 vS6Mask;')
      .replace('#include <opaque_fragment>', `
        {
          vec3 V = normalize(vViewPosition);
          float fres = pow(1.0 - saturate(dot(normal, V)), 3.0);
          // skin: light bleeding through thin tissue (reddish wrap) + softer terminator
          outgoingLight += vS6Mask.x * s6Wrap * diffuseColor.rgb * vec3(0.55, 0.16, 0.10) * (0.35 + 0.65 * fres);
          // cloth: fibre sheen at grazing angles (velvety wool)
          outgoingLight += vS6Mask.y * s6Sheen * fres * (diffuseColor.rgb * 0.6 + 0.08);
        }
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 's6shade';
  return material;
}

// ---------------- humanoid instance ----------------
export function createHumanoid(tpl, lib, { lod = 'LOD0', disguise = null } = {}) {
  const root = SkeletonUtils.clone(tpl.gltf.scene);
  const bones = bonesOf(root);
  const parts = {}; root.traverse(o => { if (o.isMesh) parts[o.name] = o; });
  // disguise: a second character GLB built from the IDENTICAL body spec (same face, same skeleton rest pose), e.g. the Spy
  // as a German officer. Its skinned meshes are re-bound to THIS skeleton (bones matched by name) and toggled by setDisguise.
  if (disguise) {
    const dsc = disguise.gltf.scene; dsc.updateMatrixWorld(true);
    dsc.traverse(o => {
      if (!o.isSkinnedMesh) return;
      const host = Object.values(parts).find(p => p.isSkinnedMesh);
      const sk = new THREE.Skeleton(o.skeleton.bones.map(b => bones[b.name]), o.skeleton.boneInverses);
      const m = new THREE.SkinnedMesh(o.geometry, o.material);
      m.name = 'disguise:' + o.name; m.castShadow = o.castShadow; m.receiveShadow = o.receiveShadow; m.frustumCulled = false;
      host.parent.add(m); m.bind(sk, o.bindMatrix.clone()); m.visible = false;
      parts[m.name] = m;
    });
  }
  const mixer = new THREE.AnimationMixer(root);
  const info = tpl.info;
  const tgtPelvisRest = info.pelvisRest ? new THREE.Vector3(...info.pelvisRest) : null;
  const ratio = info.pelvisRatio || 1;
  let current = null, currentName = null;
  const h = {
    object: root, bones, parts, mixer, info,
    clip(name) {
      if (!tpl._clipCache.has(name)) {
        const src = lib.clips.get(name);
        if (!src) return null;
        tpl._clipCache.set(name, adaptClip(src, { srcPelvisRest: lib.srcPelvisRest, tgtPelvisRest, ratio }));
      }
      return tpl._clipCache.get(name);
    },
    // speed: m/s ground speed for locomotion clips (foot-sliding fix) or plain timeScale via {timeScale}
    setAnim(name, { loop = true, speed = null, timeScale = 1, fade = 0.2 } = {}) {
      const c = h.clip(name);
      if (!c) { console.warn('no clip', name); return; }
      const a = mixer.clipAction(c);
      const m = lib.meta[name] || {};
      let ts = timeScale;
      if (speed != null && m.groundSpeed) ts = speed / (m.groundSpeed * ratio);
      a.setEffectiveTimeScale(ts);
      if (name === currentName) return a;
      a.reset();
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      a.play();
      if (current && fade > 0) current.crossFadeTo(a, fade, false); else if (current) current.stop();
      current = a; currentName = name;
      return a;
    },
    update(dt) { mixer.update(dt); for (const f of h._post) f(dt); },
    _post: [],
    autoLOD(pxPerMetre) { h.setLOD(lodFor(pxPerMetre)); },
    _lod: lod, _disg: false, _hg: true,
    setLOD(name) {
      h._lod = name;
      for (const [n, m] of Object.entries(parts)) {
        const d = n.startsWith('disguise:'); const base = d ? n.slice(9) : n; const active = d === h._disg;
        if (/^LOD\d/.test(base.split('_')[0])) m.visible = active && base.startsWith(name);
        else if (base.startsWith('headgear')) m.visible = active && h._hg;
      }
    },
    show(part, v) { if (part === 'headgear') { h._hg = v; h.setLOD(h._lod); return; } for (const [n, m] of Object.entries(parts)) if (n.includes(part)) m.visible = v; },
    setColors(opts = {}) { /* per-instance tint: {skin, cloth} multiply colours on a cloned material */
      root.traverse(o => { if (o.isMesh && opts.tint) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(...opts.tint)); } });
    },
    hasDisguise: !!disguise,
    setDisguise(on) { h._disg = !!on && !!disguise; h.setLOD(h._lod); },
  };
  h.setLOD(lod);
  return h;
}
