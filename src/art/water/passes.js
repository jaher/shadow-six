/**
 * Post-chain passes of the water system and the engine hook.
 *
 * Chain with the official hook (renderer.addPostHook, see engine/renderer-water-slot.patch):
 *   RenderPass(world) → decals → [afterWorld: DepthStashPass] → GTAO → [afterAO: WaterPass, LateFxPass] → bloom → output → AA
 *
 * - DepthStashPass copies the world depth (incl. alpha-tested foliage, excl. decals) into a float target right
 *   after the world render, so the water can be composited AFTER ambient occlusion: GTAO never sees the water
 *   (no AO darkening of the surface above the bed) and the bed under the water still gets its AO.
 * - WaterPass: copy the AO'd colour + restore the stashed depth into the write buffer, then draw the water scene
 *   depth-tested against the world (soldiers wading, piers, hulls occlude it correctly) sampling colour/depth.
 * - LateFxPass: objects on FX_LAYER only (particles, smoke, muzzle flashes, spray) are rendered after the water
 *   so they are not painted over by it, depth-tested against world+water, no AO, still bloomed/tone mapped.
 */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** Layer for late transparent effects (particles/smoke/flashes): `obj.layers.set(FX_LAYER)`. */
export const FX_LAYER = 11;

const FSQ_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

export class DepthStashPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, format: THREE.RedFormat, depthBuffer: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: FSQ_VS, depthTest: false, depthWrite: false,
      uniforms: { tDepth: { value: null } },
      fragmentShader: `varying vec2 vUv; uniform sampler2D tDepth; void main(){ gl_FragColor = vec4(texture2D(tDepth, vUv).r, 0., 0., 1.); }` }));
  }
  get texture() { return this.rt.texture; }
  setSize(w, h) { this.rt.setSize(w, h); }
  render(renderer, writeBuffer, readBuffer) {
    if (!readBuffer.depthTexture) return;
    if (this.rt.width !== readBuffer.width || this.rt.height !== readBuffer.height) this.rt.setSize(readBuffer.width, readBuffer.height);
    this.quad.material.uniforms.tDepth.value = readBuffer.depthTexture;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt); this.quad.render(renderer); renderer.setRenderTarget(prev);
  }
  dispose() { this.rt.dispose(); this.quad.material.dispose(); this.quad.dispose(); }
}

export class WaterPass extends Pass {
  /** @param {object} system WaterSystem  @param {DepthStashPass|null} stash (null → use readBuffer.depthTexture) */
  constructor(system, stash = null) {
    super();
    this.system = system; this.stash = stash;
    this.needsSwap = true;
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: FSQ_VS,
      fragmentShader: `varying vec2 vUv; uniform sampler2D tColor, tDepth;
        void main(){ gl_FragColor = texture2D(tColor, vUv); gl_FragDepth = texture2D(tDepth, vUv).r; }`,
      uniforms: { tColor: { value: null }, tDepth: { value: null } }, depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true }));
  }
  depthTexture(readBuffer) { return this.stash ? this.stash.texture : readBuffer.depthTexture; }
  render(renderer, writeBuffer, readBuffer) {
    const s = this.system, u = this.copy.material.uniforms;
    const depth = this.depthTexture(readBuffer);
    u.tColor.value = readBuffer.texture; u.tDepth.value = depth;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    const ac = renderer.autoClear; renderer.autoClear = false;
    renderer.clear(true, true, false);
    this.copy.render(renderer);
    if (depth && s.waterScene.children.length && s.frames > 0) { // not before the first update() (inputs unset)
      s._frameUniforms(readBuffer, depth);
      renderer.render(s.waterScene, s.camera);
    }
    renderer.autoClear = ac;
  }
  dispose() { this.copy.material.dispose(); this.copy.dispose(); }
}

/** Draws scene objects that live only on FX_LAYER, after the water, into the same colour+depth buffer. */
export class LateFxPass extends Pass {
  constructor(scene, camera, layer = FX_LAYER) {
    super();
    this.scene = scene; this.camera = camera; this.layer = layer;
    this.needsSwap = false; this.cam = null; this._tick = 0; this._has = false; this.roots = null;
  }
  render(renderer, writeBuffer, readBuffer) {
    // re-scan every 30 frames: lights must be visible on the FX layer too, and skip the pass when nothing is there
    // `roots` (optional array of Object3D, e.g. the FX root): scanned every frame, so a new effect draws at once
    const isFx = (o) => o.layers.isEnabled(this.layer) && (o.isMesh || o.isPoints || o.isSprite || o.isLine);
    if (this._tick++ % 30 === 0) {
      this._has = false;
      this.scene.traverse((o) => { if (o.isLight) o.layers.enable(this.layer); else if (isFx(o)) this._has = true; });
    }
    let has = this._has;
    if (!has && this.roots) for (const r of this.roots) { r.traverseVisible((o) => { if (!has && isFx(o)) has = true; }); if (has) break; }
    if (!has) return;
    const c = this.camera;
    this.cam = this.cam && this.cam.type === c.type ? this.cam : c.clone();
    this.cam.copy(c); this.cam.layers.set(this.layer);
    const r = renderer, ac = r.autoClear, sa = r.shadowMap.autoUpdate, bg = this.scene.background;
    r.autoClear = false; r.shadowMap.autoUpdate = false; this.scene.background = null;
    r.setRenderTarget(this.renderToScreen ? null : readBuffer);
    r.render(this.scene, this.cam);
    r.autoClear = ac; r.shadowMap.autoUpdate = sa; this.scene.background = bg;
  }
}

/** Give the composer's ping-pong targets depth textures (needed by DepthStash/Water passes). */
export function ensureDepthTextures(composer) {
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
    if (!rt.depthTexture) {
      rt.depthTexture = new THREE.DepthTexture(rt.width, rt.height);
      rt.depthTexture.type = THREE.UnsignedIntType;
      rt.dispose();
    }
  }
}
