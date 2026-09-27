/**
 * Caustics from the FFT slope map by the area-ratio method: each surface texel refracts the (vertical)
 * sun ray through Snell (n = 1/1.333) onto a bed at `focus` metres; intensity = source area / the area
 * of the refracted texel footprint (inverse Jacobian determinant of the mapping). Output tiles with the
 * FFT patch, r = intensity (mean ~1), mip-mapped so deep/far beds blur naturally.
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D nrm; uniform float texel, cell, focus, slopeScale;
vec2 off(vec2 uv){
  vec2 s = texture2D(nrm, uv).rg*slopeScale;
  vec3 n = normalize(vec3(-s.x, 1.0, -s.y));
  vec3 t = refract(vec3(0.0,-1.0,0.0), n, 0.75);
  return t.xz/max(-t.y, 0.2)*focus;
}
void main(){
  // 3x3 super-sampled Jacobian → less aliasing
  float I = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 uv = vUv + vec2(float(i), float(j))*texel*0.5;
    vec2 dx = (off(uv+vec2(texel,0.)) - off(uv-vec2(texel,0.)))/(2.0*cell);
    vec2 dz = (off(uv+vec2(0.,texel)) - off(uv-vec2(0.,texel)))/(2.0*cell);
    float J = (1.0+dx.x)*(1.0+dz.y) - dx.y*dz.x;
    I += 1.0/max(abs(J), 0.08);
  }
  I /= 9.0;
  gl_FragColor = vec4(min(I, 5.0), 0.0, 0.0, 1.0);
}`;

export class Caustics {
  constructor(renderer, ocean, { resolution = 512, focus = 1.6, slopeScale = 0.5 } = {}) {
    this.renderer = renderer; this.ocean = ocean;
    this.target = new THREE.WebGLRenderTarget(resolution, resolution, { type: THREE.HalfFloatType, depthBuffer: false,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
    this.mat = new THREE.ShaderMaterial({ vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }`,
      fragmentShader: FS, depthTest: false, depthWrite: false,
      uniforms: { nrm: { value: null }, texel: { value: 1 / resolution }, cell: { value: ocean.patch / resolution },
        focus: { value: focus }, slopeScale: { value: slopeScale } } });
    this.quad = new FullScreenQuad(this.mat);
    this.texture = this.target.texture;
  }
  update() {
    const r = this.renderer, p = r.getRenderTarget();
    this.mat.uniforms.nrm.value = this.ocean.normalTexture;
    r.setRenderTarget(this.target); this.quad.render(r); r.setRenderTarget(p);
  }
  dispose() { this.target.dispose(); this.mat.dispose(); this.quad.dispose(); }
}
