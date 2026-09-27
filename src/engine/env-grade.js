/**
 * Environment grading (terrain-final must-fix 2). Clear-sky HDRIs and the procedural Sky are strongly blue;
 * as diffuse IBL that turns sand grey, foliage teal and snow cyan. Instead of per-material desaturation hacks
 * (T-A's applyAmbientBalance) the renderer grades the environment ONCE before PMREM filtering:
 *   saturation  0..1  chroma kept (1 = unchanged)
 *   warmth     -1..1  white-balance shift toward the sun colour (0 = none)
 * Specular reflections keep their brightness; only the chroma of the ambient is tamed.
 * @module engine/env-grade
 */
import * as THREE from 'three';

const GRADE_GLSL = /* glsl */ `
vec3 envGrade(vec3 c, float sat, float warm) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, sat);
  c *= mix(vec3(1.0), vec3(1.06, 1.0, 0.9), warm);
  return c;
}
`;

/** Grade an equirect HDR into a new HalfFloat equirect render target (caller disposes it after PMREM). */
export function gradeEquirect(renderer, tex, saturation = 1, warmth = 0) {
  const img = tex.image || {};
  const w = Math.min(img.width || 1024, 2048), h = Math.max(1, Math.round(w / 2));
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, colorSpace: THREE.LinearSRGBColorSpace });
  const mat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: tex }, uSat: { value: saturation }, uWarm: { value: warmth } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tSrc; uniform float uSat; uniform float uWarm; varying vec2 vUv;
${GRADE_GLSL}
void main(){ gl_FragColor = vec4(envGrade(texture2D(tSrc, vUv).rgb, uSat, uWarm), 1.0); }`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const prev = renderer.getRenderTarget();
  const prevXr = renderer.xr.enabled;
  renderer.xr.enabled = false;
  renderer.setRenderTarget(rt);
  renderer.render(scene, new THREE.Camera());
  renderer.setRenderTarget(prev);
  renderer.xr.enabled = prevXr;
  quad.geometry.dispose(); mat.dispose();
  rt.texture.mapping = THREE.EquirectangularReflectionMapping;
  return rt;
}

/** Patch a three Sky material so its output is graded the same way (used for the procedural-sky fallback). */
export function gradeSkyMaterial(mat, saturation = 1, warmth = 0) {
  if (saturation === 1 && !warmth) return;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSat = { value: saturation };
    sh.uniforms.uWarm = { value: warmth };
    sh.fragmentShader = 'uniform float uSat;\nuniform float uWarm;\n' + GRADE_GLSL + sh.fragmentShader
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = envGrade(gl_FragColor.rgb, uSat, uWarm);\n#include <tonemapping_fragment>');
  };
}
