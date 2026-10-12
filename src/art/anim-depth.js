/**
 * Shadow depth material that runs a model's own vertex animation (birds, ducks, fish): the animation code is
 * injected at begin_vertex, so folded / flapping wings and swimming bodies cast matching shadows.
 * @module art/anim-depth
 */
import * as THREE from 'three';

/** @param {string} pars vertex declarations @param {string} main code that ends with `vec3 transformed = …;` */
export function animDepthMaterial(pars, main, uni, key) {
  const d = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  d.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = pars + sh.vertexShader.replace('#include <begin_vertex>', main);
  };
  d.customProgramCacheKey = () => key;
  return d;
}
