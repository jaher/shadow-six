/**
 * The decoy's refracted air (render/decoy-waves.js has the waves' state): a post pass in the 'afterWorld' slot of the
 * composer — the world and the decals are in the read buffer, with the world's depth — that bends the picture behind each
 * spherical shell of a decoy's sound wave, and paints nothing: no added colour, no added brightness.
 *
 * Per frame with a wave on screen (no work at all otherwise): the read buffer's colour and depth are copied, inside the
 * waves' screen rectangle, into two small targets (colour, float depth — the depth texture cannot be sampled while it is the
 * buffer's own attachment); then ONE rectangle draw per decoy rewrites the pixels of its rectangle that a shell reaches:
 *
 *   pixel → its world point (the stashed depth, unprojected) → its distance d from the radio's middle in the view plane;
 *   each shell (radius r, soft thickness σ, strength): displacement = strength · exp(−((d − r)/σ)²) outward along the
 *   screen radius, scaled by how much of the world lies behind the shell's near surface (`gap` along the view ray:
 *   0 where the ground is met before the sphere is entered — the part of a sphere below / in front of the ground is
 *   not drawn — rising to 1 a metre behind it), so the bend is strongest along the dome's far rim and dies out where
 *   the shell meets the ground; the colour is the copy sampled at the shifted position (kept unshifted where that lands on
 *   something nearer than the shell: no smearing of a soldier standing in front).
 *
 * Programs: three small ShaderMaterials, drawn by the load's warm-up frame (`warm`: Game._warmFrame sets it, the draws
 * are tiny scissored ones), so nothing compiles while it plays. No per-frame allocation (scratch vectors, uniform values
 * set in place). Presentation only.
 * @module render/decoy-refraction
 */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';
const GAP = 0.4; // m of world behind a shell's near surface that gives the full bend
const MARGIN = 0.5; // m: the rectangle's room for the shift itself
const SHELLS = 6; // two pulses × three

const REFRACT_FS = /* glsl */`
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform vec2 uPx;          // uv per metre of view-plane shift: 0.5 × (projection xx, yy)
uniform vec3 uCentre;      // the radio's middle, view space
uniform vec2 uBand;        // view-plane radii (m) that hold a shell
uniform vec4 uRing[${SHELLS}];     // radius, softness, bend (m), phase
uniform float uAge;
uniform float uGap;
uniform float uLens;       // brightness change per unit of squeeze / stretch (a few %: zero-mean)

vec3 unproject( vec2 uv, float dz ) {
  vec4 p = uInvProj * vec4( uv * 2.0 - 1.0, dz * 2.0 - 1.0, 1.0 );
  return p.xyz / p.w;
}

void main() {
  vec3 p = unproject( vUv, texture2D( tDepth, vUv ).r );
  vec2 rel = p.xy - uCentre.xy;
  float d = length( rel );
  if ( d < uBand.x || d > uBand.y ) discard;
  float ang = atan( rel.y, rel.x );
  float shift = 0.0, strain = 0.0;
  for ( int i = 0; i < ${SHELLS}; i++ ) {
    vec4 s = uRing[ i ];
    if ( s.z <= 0.0 ) continue;
    float q = ( d - s.x ) / s.y;
    if ( abs( q ) > 3.0 ) continue;
    // the world behind the shell's near surface (the sphere's front, at this distance from its axis)
    float front = uCentre.z + sqrt( max( s.x * s.x - d * d, 0.0 ) );
    float behind = smoothstep( 0.0, uGap, front - p.z );
    // (a little waver along the front: the heat-haze shiver)
    float k = s.z * exp( -q * q ) * behind * ( 0.88 + 0.12 * sin( ang * 7.0 + uAge * 9.0 + s.w * 2.1 ) );
    shift += k;
    strain += -2.0 * q / s.y * k; // d shift / d d: > 0 the picture is stretched, < 0 squeezed
  }
  if ( shift < 0.002 ) discard;
  vec2 dir = rel / max( d, 1e-4 );
  // (outward, with a little swirl across it that drifts with the front: the shimmer of hot air)
  vec2 off = ( dir + vec2( -dir.y, dir.x ) * 0.25 * sin( d * 3.1 - uAge * 14.0 + ang * 3.0 ) ) * shift;
  vec2 uv2 = vUv - off * uPx;
  // something nearer than the shell is not bent: where the shifted sample lies on such a thing, keep the pixel's own
  vec3 p2 = unproject( uv2, texture2D( tDepth, uv2 ).r );
  float d2 = length( p2.xy - uCentre.xy );
  float front2 = uCentre.z + sqrt( max( uBand.y * uBand.y - d2 * d2, 0.0 ) );
  if ( p2.z > front2 + 0.2 ) uv2 = vUv;
  vec4 c = texture2D( tScene, uv2 );
  // (the squeeze and the stretch focus a little: the bent air's own light, zero-mean)
  c.rgb *= 1.0 - uLens * clamp( strain, -1.5, 1.5 );
  gl_FragColor = c;
}`;

/** Pixel rectangle of a view-plane disc (centre, radius m) for an orthographic camera: [x0, y0, x1, y1] in a w × h target, clamped (x1 ≤ x0 or y1 ≤ y0: off screen). */
export function discRect(cam, vx, vy, rad, w, h, out) {
  const e = cam.projectionMatrix.elements;
  const nx = e[0] * vx + e[12], ny = e[5] * vy + e[13], ex = Math.abs(e[0]) * rad, ey = Math.abs(e[5]) * rad;
  out[0] = Math.max(0, Math.floor((nx - ex) * 0.5 * w + 0.5 * w));
  out[1] = Math.max(0, Math.floor((ny - ey) * 0.5 * h + 0.5 * h));
  out[2] = Math.min(w, Math.ceil((nx + ex) * 0.5 * w + 0.5 * w));
  out[3] = Math.min(h, Math.ceil((ny + ey) * 0.5 * h + 0.5 * h));
  return out;
}

export class RefractionPass extends Pass {
  /** @param {{camera: THREE.Camera}} eng the engine Renderer (its current camera) @param {import('./decoy-waves.js').DecoyWaves} waves */
  constructor(eng, waves) {
    super();
    this.eng = eng;
    this.waves = waves;
    this.needsSwap = false; // draws into the read buffer itself
    /** Game._warmFrame sets it for the load's warm-up frames: every program is drawn once, tiny. */
    this.warm = false;
    this.colorRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.depthRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, format: THREE.RedFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const mat = (fragmentShader, uniforms) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false, transparent: false });
    this.copyColor = new FullScreenQuad(mat('varying vec2 vUv; uniform sampler2D tColor; void main() { gl_FragColor = texture2D( tColor, vUv ); }', { tColor: { value: null } }));
    this.copyDepth = new FullScreenQuad(mat('varying vec2 vUv; uniform sampler2D tDepth; void main() { gl_FragColor = vec4( texture2D( tDepth, vUv ).r, 0.0, 0.0, 1.0 ); }', { tDepth: { value: null } }));
    this.refract = new FullScreenQuad(mat(REFRACT_FS, {
      tScene: { value: null }, tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uPx: { value: new THREE.Vector2() },
      uCentre: { value: new THREE.Vector3() }, uBand: { value: new THREE.Vector2() },
      uRing: { value: Array.from({ length: SHELLS }, () => new THREE.Vector4()) }, uAge: { value: 0 }, uGap: { value: GAP }, uLens: { value: 0.06 },
    }));
    /** Draws this frame: 2 copies + one per decoy (tests / the report). */
    this.draws = 0;
    this._v = new THREE.Vector3();
    this._rect = [0, 0, 0, 0];
    this._union = [0, 0, 0, 0];
    this.gain = 1; // tests: 0 draws nothing
    this.lens = 0.06; // tests / tuning: the focusing shade (0: none)
  }

  setSize(w, h) {
    this.colorRT.setSize(w, h);
    this.depthRT.setSize(w, h);
  }

  /** Quad `q` into `target`, only inside the pixel rectangle `r` ([x0, y0, x1, y1]). */
  _draw(renderer, q, target, r) {
    target.scissor.set(r[0], r[1], Math.max(1, r[2] - r[0]), Math.max(1, r[3] - r[1]));
    target.scissorTest = true;
    renderer.setRenderTarget(target);
    q.render(renderer);
    target.scissorTest = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    const W = this.waves, cam = this.eng?.camera, warm = this.warm;
    this.draws = 0;
    const n = warm ? 0 : W?.drawn.length || 0;
    if (!cam || !readBuffer.depthTexture || !(n || warm) || !(this.gain > 0)) return;
    const w = readBuffer.width, h = readBuffer.height;
    if (this.colorRT.width !== w || this.colorRT.height !== h) this.setSize(w, h);
    const ortho = cam.projectionMatrix.elements[15] === 1, U = this.refract.material.uniforms, E = cam.projectionMatrix.elements;
    const un = this._union, rc = this._rect;
    if (warm) { un[0] = un[1] = 0; un[2] = un[3] = Math.min(4, w, h); } else { un[0] = w; un[1] = h; un[2] = un[3] = 0; }
    for (let i = 0; i < n; i++) {
      const s = W.drawn[i];
      this._v.set(s.cx, s.cy, s.cz).applyMatrix4(cam.matrixWorldInverse);
      if (ortho) discRect(cam, this._v.x, this._v.y, s.hi + MARGIN, w, h, rc); else { rc[0] = rc[1] = 0; rc[2] = w; rc[3] = h; }
      if (rc[2] <= rc[0] || rc[3] <= rc[1]) continue; // (off screen)
      un[0] = Math.min(un[0], rc[0]); un[1] = Math.min(un[1], rc[1]); un[2] = Math.max(un[2], rc[2]); un[3] = Math.max(un[3], rc[3]);
    }
    if (!(un[2] > un[0] && un[3] > un[1])) return;
    const prevTarget = renderer.getRenderTarget(), ac = renderer.autoClear;
    renderer.autoClear = false;
    // the colour and the depth of the world behind the waves
    this.copyColor.material.uniforms.tColor.value = readBuffer.texture;
    this._draw(renderer, this.copyColor, this.colorRT, un);
    this.copyDepth.material.uniforms.tDepth.value = readBuffer.depthTexture;
    this._draw(renderer, this.copyDepth, this.depthRT, un);
    this.draws = 2;
    U.tScene.value = this.colorRT.texture;
    U.tDepth.value = this.depthRT.texture;
    U.uInvProj.value.copy(cam.projectionMatrixInverse);
    U.uPx.value.set(0.5 * E[0], 0.5 * E[5]);
    U.uLens.value = this.lens;
    if (warm) { // (every program drawn once: a shell on the middle of the screen, a few pixels)
      U.uCentre.value.set(0, 0, -50); U.uBand.value.set(0, 1e3); U.uAge.value = 0;
      for (let k = 0; k < SHELLS; k++) U.uRing.value[k].set(5, 1, 0.2, k);
      this._draw(renderer, this.refract, readBuffer, un);
      this.draws++;
    } else {
      for (let i = 0; i < n; i++) {
        const s = W.drawn[i];
        this._v.set(s.cx, s.cy, s.cz).applyMatrix4(cam.matrixWorldInverse);
        U.uCentre.value.copy(this._v);
        U.uBand.value.set(s.lo, s.hi);
        U.uAge.value = s.age;
        for (let k = 0; k < SHELLS; k++) U.uRing.value[k].set(s.rings[k * 4], s.rings[k * 4 + 1], s.rings[k * 4 + 2] * this.gain, s.rings[k * 4 + 3]);
        if (ortho) discRect(cam, this._v.x, this._v.y, s.hi + MARGIN, w, h, rc); else { rc[0] = rc[1] = 0; rc[2] = w; rc[3] = h; }
        if (rc[2] <= rc[0] || rc[3] <= rc[1]) continue;
        this._draw(renderer, this.refract, readBuffer, rc);
        this.draws++;
      }
    }
    renderer.autoClear = ac;
    renderer.setRenderTarget(prevTarget);
  }

  dispose() {
    this.colorRT.dispose();
    this.depthRT.dispose();
    for (const q of [this.copyColor, this.copyDepth, this.refract]) { q.material.dispose(); q.dispose(); }
  }
}
