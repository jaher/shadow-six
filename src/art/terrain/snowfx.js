/**
 * Snow effects: (1) top-facing snow accumulation shader patch usable on ANY MeshStandard/Physical material
 * (roofs, props, vehicles, trees); (2) falling + ground-blowing snow particles that follow the camera.
 * @module terrain-b/snowfx
 */
import * as THREE from 'three';
import { WIND_GLSL, WIND_UNIFORMS } from '../../world/wind.js';

export const SNOW_COVER_GLSL = /* glsl */ `
uniform float uSnowAmt;
uniform float uSnowBias;
varying vec3 vScWP;
varying vec3 vScWN;
float scHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float scNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(scHash(i), scHash(i + vec3(1, 0, 0)), f.x), mix(scHash(i + vec3(0, 1, 0)), scHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(scHash(i + vec3(0, 0, 1)), scHash(i + vec3(1, 0, 1)), f.x), mix(scHash(i + vec3(0, 1, 1)), scHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// amount 0..1: how much of the up-facing surface is covered; returns coverage
float snowCoverage(vec3 wN, vec3 wP, float amt) {
  float n = scNoise(wP * 1.7) * 0.55 + scNoise(wP * 7.3) * 0.3 + scNoise(wP * 23.0) * 0.15;
  float up = clamp(wN.y, -1.0, 1.0);
  return smoothstep(0.42, 0.62, up * (0.55 + 0.6 * amt) + (n - 0.5) * 0.55 + uSnowBias + amt * 0.25 - 0.1) * step(0.001, amt);
}
`;

/**
 * Patch a material so up-facing surfaces receive snow (keeps any existing onBeforeCompile).
 * @param {THREE.Material} material MeshStandardMaterial/MeshPhysicalMaterial
 * @param {{amount?:number, bias?:number}} [o]
 * @returns {{uniforms:{uSnowAmt:{value:number}, uSnowBias:{value:number}}}} set .uniforms.uSnowAmt.value to animate
 */
export function addSnowCover(material, o = {}) {
  const U = o.uniforms || { uSnowAmt: { value: o.amount ?? 1 }, uSnowBias: { value: o.bias ?? 0 } }; // o.uniforms: shared set
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(material, sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vScWP;\nvarying vec3 vScWN;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      {
        vec4 scp = vec4(transformed, 1.0); vec3 scn = objectNormal;
        #ifdef USE_INSTANCING
          scp = instanceMatrix * scp; scn = mat3(instanceMatrix) * scn;
        #endif
        #ifdef USE_BATCHING
          scp = batchingMatrix * scp; scn = mat3(batchingMatrix) * scn;
        #endif
        vScWP = (modelMatrix * scp).xyz; vScWN = normalize(mat3(modelMatrix) * scn);
      }`);
    sh.fragmentShader = SNOW_COVER_GLSL + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float scCov = snowCoverage(normalize(vScWN), vScWP, uSnowAmt);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.86, 0.93), scCov);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.62, scCov);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor *= 1.0 - scCov;`);
  };
  material.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|snowcover';
  material.needsUpdate = true;
  return { uniforms: U };
}

const FLAKE_VERT = WIND_GLSL + /* glsl */ `
uniform vec2 uOff;            // integrated mean wind displacement (m), step 4w
attribute vec4 aSeed;         // xyz in [0,1), w size/type random
uniform float uTime;
uniform vec3 uOrigin;         // box min corner (follows the camera target)
uniform vec3 uBox;            // box size
uniform vec2 uWindV;          // m/s
uniform float uPxPerM;
uniform float uGround;        // fraction of flakes that are ground-blowing drift
varying float vA;
void main() {
  float drift = step(aSeed.w, uGround);
  float fall = mix(0.9 + aSeed.w * 0.9, 0.12, drift);
  vec3 p = aSeed.xyz * uBox + vec3(uOff.x, 0.0, uOff.y) * mix(1.0, 1.35, drift) + vec3(0.0, -fall * uTime, 0.0);
  // gusts: local deviation from the mean wind swirls the flakes (bounded offset, no teleporting when it changes)
  vec4 wS = windSample(mod(p.xz - uOrigin.xz, uBox.xz) + uOrigin.xz);
  p.xz += (wS.xy - uWindA.xy * uWindA.z * uWindC.z) * (0.35 + 0.5 * drift);
  p.x += sin(uTime * (0.7 + aSeed.w) + aSeed.y * 40.0) * 0.35;
  p.z += cos(uTime * (0.6 + aSeed.w) + aSeed.x * 40.0) * 0.35;
  p = mod(p - uOrigin, uBox) + uOrigin;
  if (drift > 0.5) p.y = uOrigin.y + aSeed.y * 1.2 + 0.05 + sin(uTime * 3.0 + aSeed.x * 50.0) * 0.1;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = mix(0.018, 0.045, fract(aSeed.w * 13.7)) * mix(1.0, 0.7, drift);
  gl_PointSize = max(1.2, sz * uPxPerM);
  vA = mix(0.85, 0.35, drift) * clamp(sz * uPxPerM / 1.2, 0.35, 1.0);
}`;
const FLAKE_FRAG = /* glsl */ `
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.15, length(d)) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * 1.2, a);
}`;

/**
 * Falling/blowing snow particles.
 * @param {object} ctx terrain ctx ({scene, W, D, windDir, opts}) @param {{snowFlakes:number}} Q
 */
export function createSnowFx(ctx, Q) {
  const { scene } = ctx;
  let pts = null;
  const U = {
    uTime: { value: 0 }, uOrigin: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(70, 22, 50) },
    uWindV: { value: new THREE.Vector2(ctx.windDir.x, ctx.windDir.y).multiplyScalar(ctx.opts.snowWind ?? 2.2) },
    uPxPerM: { value: 20 }, uGround: { value: 0.22 }, uOff: { value: new THREE.Vector2() }, ...WIND_UNIFORMS,
  };
  let lastWt = null;
  const mat = new THREE.ShaderMaterial({ vertexShader: FLAKE_VERT, fragmentShader: FLAKE_FRAG, uniforms: U, transparent: true, depthWrite: false });
  function build(n) {
    if (pts) { scene.remove(pts); pts.geometry.dispose(); }
    n = Math.round(n * (ctx.opts.snowfall ?? 1));
    const a = new Float32Array(n * 4);
    for (let i = 0; i < a.length; i++) a[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('aSeed', new THREE.BufferAttribute(a, 4));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    pts = new THREE.Points(g, mat);
    pts.frustumCulled = false; pts.renderOrder = 5; pts.name = 'snowfall';
    scene.add(pts);
  }
  build(Q.snowFlakes);
  const tgt = new THREE.Vector3(), dir = new THREE.Vector3();
  return {
    points: () => pts,
    update(dt, camera, time) {
      U.uTime.value = time;
      // step 4w: integrate the mean mission wind (sim time → frozen while paused); ground drift grows with the wind
      const A = WIND_UNIFORMS.uWindA.value, env = WIND_UNIFORMS.uWindC.value[2] || 1;
      const dw = lastWt == null ? 0 : Math.min(0.5, Math.max(0, A[3] - lastWt));
      lastWt = A[3];
      const sp = A[2] * env * (ctx.opts.snowWind ?? 1);
      U.uOff.value.x += A[0] * sp * dw; U.uOff.value.y += A[1] * sp * dw;
      U.uGround.value = 0.08 + 0.34 * Math.min(1, Math.max(0, (sp - 3) / 9));
      if (!camera) return;
      camera.getWorldDirection(dir);
      // ground point under the view centre
      const t = camera.position.y / Math.max(0.1, -dir.y);
      tgt.copy(camera.position).addScaledVector(dir, t);
      const B = U.uBox.value;
      U.uOrigin.value.set(tgt.x - B.x / 2, -0.5, tgt.z - B.z / 2);
      if (camera.isOrthographicCamera) U.uPxPerM.value = (ctx.gl.domElement.height / ((camera.top - camera.bottom) / camera.zoom));
      else U.uPxPerM.value = ctx.gl.domElement.height / (2 * t * Math.tan((camera.fov * Math.PI) / 360));
    },
    setQuality(Q2) { build(Q2.snowFlakes); },
    dispose() { if (pts) { scene.remove(pts); pts.geometry.dispose(); } mat.dispose(); },
  };
}
