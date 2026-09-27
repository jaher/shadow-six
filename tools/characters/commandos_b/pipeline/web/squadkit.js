// squadkit.js - squad-level variety on top of the enemies runtime (bible §5.2), no GLB rebuild needed.
//   const picks = assignSquadVariants(missionId, spawns, E.variantsByType);   // dissimilarity-scored neighbour rule
//   const h = await spawnSquadMember(E, missionId, spawn, picks.get(spawn.id), { mates });
// What it adds over enemykit.spawnEnemy:
//  * assignment: hard rule unchanged (no shared variant within 30 m / squad); within a squad heads are unique while the
//    16 archetypes last, and a forced repeat is placed on the MOST different man (other tone family, facial hair,
//    glasses, age, far from his twin); at most one scarred / heavily lined face per squad. Squads > 6 are split into
//    fire teams of 6 for the head rule (bible caps a squad at 6; bigger groups are several squads).
//  * body: height from N(1.74 m, 0.06) (clamped 1.62-1.88, scale vs the variant's built height), width 0.94-1.08.
//  * cloth: tunic and trousers tinted separately from issue batches (green / grey / brown-grey / faded feldgrau),
//    +-10 % value; helmet paint shade per man. Visible at 1x/2x game zoom (the old +-6 % was not).
//  * posture: idle clip per man (idle / look_around / fold_arms / weight-shift idle), phase + tempo offsets, and a
//    posture overlay that closes the UAL idle's wide stance and straightens the forward lean (feet re-grounded).
//  * face: the helmet no longer casts its shadow onto the face and a soft face fill lifts the eye sockets, so eyes
//    read as eyes (not holes) under the M35 brim at close zoom.
import * as THREE from 'three';
import { spawnEnemy } from '/chars/enemies/web/enemykit.js';
import { fnv1a, mulberry32 } from '/chars/pipeline/web/variety.js';
import { addExtras } from './squad_extras.js';
import { installPosture } from './squad_posture.js';
import { moustacheParams, MUST_DECL, MUST_FRAG, helmetMaterial } from './squad_face.js';

const TONE_FAMILY = { pale_pink: 0, fair: 0, fair_ruddy: 1, light_olive: 2, sunburnt: 1, weathered_tan: 2 };
const STRONG_MARK = (v) => !!v.scar;   // the cheek-scar decal sits in the same place on every scarred variant

// similarity of two variants (higher = more alike). Same variant is excluded before this is used.
export function similarity(a, b) {
  let s = 0;
  if (a.head === b.head) s += 60;
  if (a.tone === b.tone) s += 14; else if (TONE_FAMILY[a.tone] === TONE_FAMILY[b.tone]) s += 7;
  if (a.facialHair === b.facialHair) s += 10;
  if (a.glasses === b.glasses) s += 4;
  if (STRONG_MARK(a) && STRONG_MARK(b)) s += 80;           // same scar decal reads as a repeat
  if (Math.abs((a.lines || 0) - (b.lines || 0)) < 0.05) s += 4;
  return s;
}

export function assignSquadVariants(missionId, spawns, variantsByType, { radius = 30, team = 6, meta = {} } = {}) {
  const out = new Map(); const used = new Map(); const usedHead = new Map();
  const sorted = [...spawns].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const squadIdx = new Map(); const counter = {};
  for (const s of sorted) if (s.squad) { counter[s.squad] = (counter[s.squad] || 0) + 1; squadIdx.set(s.id, Math.floor((counter[s.squad] - 1) / team)); }
  const teamOf = (s) => s.squad ? `${s.squad}#${squadIdx.get(s.id)}` : null;
  for (const s of sorted) {
    const vs = (variantsByType[s.type] || []).map(v => ({ ...v, ...(meta[v.id] || {}) }));
    if (!vs.length) continue;
    const near = sorted.filter(o => o !== s && out.has(o.id) && ((o.squad && o.squad === s.squad) || Math.hypot(o.x - s.x, o.z - s.z) < radius));
    const r = mulberry32(fnv1a(`${missionId}:${s.id}`));
    let best = null, bestScore = Infinity;
    for (const v of vs) {
      let score = (used.get(v.id) || 0) * 3 + (usedHead.get(v.head) || 0) * 40 + r() * 0.5;   // spread the 16 heads evenly
      for (const o of near) {
        const w = out.get(o.id); if (w.id === v.id) { score += 1e6; continue; }
        const d = Math.hypot(o.x - s.x, o.z - s.z);
        const sameTeam = teamOf(o) && teamOf(o) === teamOf(s);
        const k = sameTeam ? 4 : 1 / (1 + d / 4);             // twins are tolerated only far apart, never in one team
        score += similarity(v, w) * k;
        if (sameTeam && v.head === w.head) score += 1e4;
        if (sameTeam && STRONG_MARK(v) && STRONG_MARK(w)) score += 1e4;   // at most one scarred face per fire team
      }
      if (score < bestScore) { bestScore = score; best = v; }
    }
    used.set(best.id, (used.get(best.id) || 0) + 1); if (s.squad) usedHead.set(best.head, (usedHead.get(best.head) || 0) + 1);
    out.set(s.id, best);
  }
  return out;
}

// Box-Muller normal from a seeded uniform source
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
// issue batches: green-grey, standard, brown-grey, faded/washed, dark slate, olive (field-grey varied a lot by maker/wear)
const BATCH = [[0.84, 1.02, 0.86], [1.0, 1.0, 1.0], [1.16, 1.0, 0.8], [1.22, 1.22, 1.14], [0.78, 0.82, 0.88], [1.05, 1.1, 0.8]];
export function squadJitter(missionId, spawnId, builtHeight = 1.74) {
  const r = mulberry32(fnv1a(`${missionId}:${spawnId}:sq`));
  const height = Math.min(1.88, Math.max(1.62, 1.74 + 0.06 * gauss(r)));
  const heightScale = Math.min(1.08, Math.max(0.92, height / builtHeight));
  const widthScale = 0.94 + r() * 0.14;
  const val = () => 0.86 + r() * 0.28;
  const tb = BATCH[Math.floor(r() * BATCH.length)], v1 = val();
  const pb = r() < 0.45 ? tb : BATCH[Math.floor(r() * BATCH.length)], v2 = val();
  const tunic = tb.map(c => c * v1), trousers = pb.map(c => c * v2 * 0.97);
  const hv = 0.78 + r() * 0.34, hg = 0.97 + r() * 0.07;
  const helmet = [hv * (0.98 + r() * 0.04), hv * hg, hv * (0.95 + r() * 0.05)];
  // head proportions (bone scale; helmet, glasses and facial hair are skinned to Head so their fit is kept): twins of one
  // archetype read as different men (broad vs narrow, long vs short skull), not brothers
  const headScale = [0.95 + r() * 0.1, 0.97 + r() * 0.07, 0.97 + r() * 0.06];
  return { height, heightScale, widthScale, tunic, trousers, helmet, headScale, seed: fnv1a(`${missionId}:${spawnId}:x`) };
}

function squadMaterial(mesh, j, beltY, headU, info) {
  const must = info && info.enemy && info.enemy.facialHair === 'moustache' ? moustacheParams(mesh.geometry, info) : null;
  const base = mesh.userData.s6base || mesh.material; mesh.userData.s6base = base;
  const m = base.clone(); const prev = base.onBeforeCompile;
  m.onBeforeCompile = (sh, rr) => {
    prev && prev.call(base, sh, rr);
    if (sh.uniforms.s6Cloth) sh.uniforms.s6Cloth.value.setRGB(1, 1, 1);   // enemykit's +-6 % replaced below
    sh.uniforms.s6Tunic = { value: new THREE.Color(...j.tunic) }; sh.uniforms.s6Trousers = { value: new THREE.Color(...j.trousers) };
    sh.uniforms.s6Split = { value: beltY - 0.2 }; sh.uniforms.s6Head = headU;
    sh.uniforms.s6Must = { value: must || new THREE.Vector4() }; sh.uniforms.s6MustOn = { value: must ? 1 : 0 };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vS6Y; varying vec3 vS6W; varying vec3 vS6P;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvS6Y = position.y; vS6P = position;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvS6W = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 s6Tunic; uniform vec3 s6Trousers; uniform float s6Split; uniform vec4 s6Head; varying float vS6Y; varying vec3 vS6W;\n' + MUST_DECL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${MUST_FRAG}
        diffuseColor.rgb *= mix(vec3(1.0), mix(s6Trousers, s6Tunic, smoothstep(s6Split - 0.03, s6Split + 0.03, vS6Y)), vS6Mask.y * (1.0 - s6MustK));`)
      .replace('#include <opaque_fragment>', `{ float fd = length(vS6W - s6Head.xyz) / s6Head.w;   // face fill (key-light rig): lifts eye sockets under the brim
          outgoingLight += diffuseColor.rgb * 0.22 * (1.0 - smoothstep(0.55, 1.0, fd)); }
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 's6squad2';
  mesh.material = m;
}

export async function spawnSquadMember(E, missionId, spawn, variant, { posture = true, extras = true } = {}) {
  const h = await spawnEnemy(E, missionId, spawn, variant);
  const info = (await E.templates.get(variant.id)).info;
  const j = squadJitter(missionId, spawn.id, info.heightM || 1.74);
  h.object.scale.set(j.heightScale * j.widthScale, j.heightScale, j.heightScale * (1 + (j.widthScale - 1) * 0.6));
  const headU = { value: new THREE.Vector4(0, 0, 0, 0.16 * j.heightScale) };
  const beltY = info.beltZ || (info.sockets || {}).beltZ || 1.05;
  h.object.traverse(o => {
    if (!o.isMesh) return;
    if (o.name === 'headgear') { o.castShadow = false; if ((info.headgear || {}).type === 'm35') helmetMaterial(o, j.helmet); else { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(...j.helmet)); } return; }
    if (o.isSkinnedMesh && o.geometry.attributes._mask) squadMaterial(o, j, beltY, headU, info);
  });
  const hp = new THREE.Vector3(), fwd = new THREE.Vector3();
  if (h.bones.Head) h._post.push(() => h.bones.Head.scale.set(...j.headScale));
  h._post.push(() => {   // face-fill centre: in front of the eyes, so the fill falls on the face, not the nape
    h.bones.Head.getWorldPosition(hp); fwd.set(0, 0, 1).applyQuaternion(h.object.quaternion);
    headU.value.set(hp.x + fwd.x * 0.1, hp.y + 0.07 * j.heightScale, hp.z + fwd.z * 0.1, 0.16 * j.heightScale);
  });
  if (extras) addExtras(h, j, info);
  if (posture) installPosture(h, j);
  h.squadJitter = j;
  return h;
}
