// charkit.js — SHADOW SIX runtime for pipeline characters (UAL skeleton, shared anims.glb, weapons.glb).
// Implements the ARCHITECTURE.md humanoid interface: setAnim(name,{loop,speed}), update(dt), setColors(opts), setDisguise(bool).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { groundClip, GROUND_CLIPS, footLift, STAND_CLIPS } from './ground.js';
import { twoBoneIK } from './weapons.js';

const loader = new GLTFLoader();
const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));

// ---------------- animation library ----------------
// anims.glb: UAL skeleton + all clips (already adapted: quaternion tracks + pelvis.position only), scene.userData.shadowSix.clips = meta
export async function loadAnimLibrary(url) {
  const g = await load(url);
  // FIX (rework): GLTFExporter writes scene userData on the child node 'Scene', not on gltf.scene -> search the tree
  let ud = g.scene.userData.shadowSix || null; if (!ud) g.scene.traverse(o => { if (!ud && o.userData && o.userData.shadowSix) ud = o.userData.shadowSix; });
  ud = ud || {};
  const meta = ud.clips || {};
  const clips = new Map();
  for (const c of g.animations) clips.set(c.name, c);
  const srcPelvisRest = ud.pelvisRest;
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
export const VARIANTS = { sprint: [['run_fast', 1e9]], walk: [['walk', 1.45], ['walk_fast', 1e9]], run: [['run_slow', 4.15], ['run', 4.95], ['run_fast', 1e9]] };
export const PRONE = new Set(['crawl', 'crawl_idle', 'die_prone', 'dead_prone']);
const _lv = new THREE.Vector3();
export function lowestVertex(mesh, boneRe = null, keep = null) {
  if (!mesh) return 0; mesh.updateMatrixWorld(true);
  const g = mesh.geometry, n = g.attributes.position.count, si = g.attributes.skinIndex, sw = g.attributes.skinWeight; let mn = 1e9;
  for (let i = 0; i < n; i++) {
    if (boneRe) { let bi = 0, bw = -1; for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > bw) { bw = sw.getComponent(i, k); bi = si.getComponent(i, k); } if (!boneRe.test(mesh.skeleton.bones[bi].name)) continue; }
    mesh.getVertexPosition(i, _lv); _lv.applyMatrix4(mesh.matrixWorld); if (keep && !keep(_lv)) continue; if (_lv.y < mn) mn = _lv.y;
  }
  return mn;
}
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
        let c = adaptClip(src, { srcPelvisRest: lib.srcPelvisRest, tgtPelvisRest, ratio });
        const m = lib.meta[name] || {};
        if (GROUND_CLIPS.has(name) || m.paths || m.ground) c = groundClip(tpl, c, m, ratio);   // per-character grounding (ground.js)
        else if (STAND_CLIPS.has(name)) c = footLift(tpl, c);   // guests r1: boots out of the ground when standing / walking
        tpl._clipCache.set(name, c);
      }
      return tpl._clipCache.get(name);
    },
    // speed: m/s ground speed for locomotion clips (foot-sliding fix) or plain timeScale via {timeScale}
    // speed: m/s ground speed for locomotion clips (foot-sliding fix) or plain timeScale via {timeScale}
    //  * speed picks the gait variant: walk -> walk | walk_fast ; run -> run_slow | run | run_fast (synth.js re-synthesis)
    //  * die/dead while prone (crawl) -> die_prone/dead_prone (no stand-up-then-fall)
    setAnim(name, { loop = true, speed = null, timeScale = 1, fade = 0.2 } = {}) {
      let cn = name;
      const V = VARIANTS[name];
      if (V && speed != null) { const hit = V.find(([c, mx]) => speed <= mx && lib.clips.has(c)); if (hit) cn = hit[0]; }
      if ((name === 'die' || name === 'dead') && h._prone && lib.clips.has(name + '_prone')) cn = name + '_prone';
      const c = h.clip(cn);
      if (!c) { console.warn('no clip', cn); return; }
      const a = mixer.clipAction(c);
      const m = lib.meta[cn] || {};
      let ts = timeScale;
      if (speed != null && m.groundSpeed) ts = speed / (m.groundSpeed * ratio);
      a.setEffectiveTimeScale(ts);
      h.anim = name; h.animClip = cn;
      if (cn === currentName) return a;
      h._prone = PRONE.has(cn);
      a.reset();
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      a.play();
      if (current && fade > 0) current.crossFadeTo(a, fade, false); else if (current) current.stop();
      current = a; currentName = cn;
      return a;
    },
    // seat alignment for sit/drive: put the buttocks (lowest trunk vertex under the hips) on `seat` (world point on the
    // seat cushion, centre); returns {err, pelvisY, feetY} so a vehicle can check pedals/floor. Call after setAnim+update.
    // opts.floorY (vehicle floor / footwell height): every frame the feet are lifted onto it by leg IK (knees rise),
    // so boots never sink through the floor of a low-seated vehicle; h.seatFeetErr reports what is left.
    sitOn(seat, { floorY = null } = {}) {
      h._floorY = floorY;
      if (floorY != null && !h._legHook) {
        h._legHook = true;
        const t = new THREE.Vector3(), b = new THREE.Vector3();
        const saved = new Map();   // leg bones the clip may not key: undo last frame's IK unless the mixer overwrote it
        h._post.push(() => {
          for (const [b, v] of saved) if (b.quaternion.equals(v.post)) b.quaternion.copy(v.pre);
          saved.clear();
          if (h._floorY == null || !/^(sit|drive)/.test(h.animClip || h.anim || '')) return;
          for (const s of ['l', 'r']) for (const n of ['thigh_', 'calf_', 'foot_']) saved.set(bones[n + s], { pre: bones[n + s].quaternion.clone() });
          root.updateMatrixWorld(true); let err = 0;
          for (const s of ['l', 'r']) {
            const ball = bones['ball_' + s], foot = bones['foot_' + s];
            const d = h._floorY + 0.015 - ball.getWorldPosition(b).y;
            if (d <= 0) continue;
            foot.getWorldPosition(t); t.y += d;
            err = Math.max(err, twoBoneIK(bones['thigh_' + s], bones['calf_' + s], foot, t));
            root.updateMatrixWorld(true);
          }
          h.seatFeetErr = err;
          for (const [b, v] of saved) v.post = b.quaternion.clone();
        });
      }
      root.updateMatrixWorld(true);
      const hl = bones.thigh_l.getWorldPosition(new THREE.Vector3()), hr = bones.thigh_r.getWorldPosition(new THREE.Vector3());
      const hip = hl.clone().lerp(hr, 0.5);
      const mesh = parts.LOD2 || parts.LOD1 || Object.values(parts).find(p => p.isSkinnedMesh);
      const by = lowestVertex(mesh, /^(pelvis|thigh_)/, (v) => Math.hypot(v.x - hip.x, v.z - hip.z) < 0.2);
      const back = new THREE.Vector3(0, 0, -0.04).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
      const d = seat.clone().sub(new THREE.Vector3(hip.x, by, hip.z).add(back));
      root.position.add(root.parent ? d.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(root.parent.matrixWorld).invert()) : d);
      root.updateMatrixWorld(true);
      const pel = bones.pelvis.getWorldPosition(new THREE.Vector3());
      const feetY = Math.min(bones.ball_l.getWorldPosition(new THREE.Vector3()).y, bones.ball_r.getWorldPosition(new THREE.Vector3()).y);
      const by2 = lowestVertex(mesh, /^(pelvis|thigh_)/, (v) => Math.hypot(v.x - hip.x - d.x, v.z - hip.z - d.z) < 0.2);
      return { err: Math.abs(by2 - seat.y), pelvisY: pel.y, feetY };
    },
    // fireman's carry (Spy / Green Beret ability): `victim` (another humanoid) plays 'carried' and rides folded over
    // the carrier's RIGHT shoulder - belly on the trapezius, torso and arms down the carrier's back, legs in front.
    // Re-placed every frame after the carrier's pose (works in carry_idle / carry_walk). dropBody() releases him.
    carryBody(victim, { lift = 0.1, pitch = -0.45, back = 0 } = {}) {
      h.carried = victim; h._carryOpt = { lift, pitch, back }; victim.setAnim('carried', { fade: 0 });
      if (victim.object.parent !== root.parent && root.parent) root.parent.add(victim.object);
      if (h._carryHook) return;
      h._carryHook = true;
      const S = new THREE.Vector3(), N = new THREE.Vector3(), P = new THREE.Vector3(), q = new THREE.Quaternion(), flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
      h._post.push((dt) => {
        const v = h.carried; if (!v) return;
        root.updateMatrixWorld(true);
        bones.upperarm_r.getWorldPosition(S); (bones.neck_01 || bones.Head).getWorldPosition(N);
        const co = h._carryOpt; S.lerp(N, 0.35); S.y += co.lift;
        S.add(new THREE.Vector3(0, 0, -co.back).applyQuaternion(root.getWorldQuaternion(q)));                                          // on top of the trapezius, between neck and shoulder
        v.object.quaternion.copy(root.getWorldQuaternion(q)).multiply(flip).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), co.pitch));   // facing backwards: his head down the carrier's back
        v.update(dt || 0); v.object.updateMatrixWorld(true);
        v.bones.pelvis.getWorldPosition(P);
        v.object.position.add(S.sub(P)); v.object.updateMatrixWorld(true);
      });
    },
    dropBody() { const v = h.carried; h.carried = null; return v; },
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
