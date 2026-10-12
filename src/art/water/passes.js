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
    // a submerged diver (WaterSystem.setSubmerged) where he is the nearest surface: his depth goes 1 m further back,
    // so the water surface is drawn over all of him — a fin or the tank poking out of 25 cm shallows included
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: FSQ_VS,
      fragmentShader: `varying vec2 vUv; uniform sampler2D tColor, tDepth, tMask; uniform float maskOn, camNear, camFar, ortho;
        float viewZ(float d){ return ortho > 0.5 ? -(camNear + d*(camFar - camNear)) : (camNear*camFar)/((camFar - camNear)*d - camFar); }
        float depthOf(float z){ return ortho > 0.5 ? (-z - camNear)/(camFar - camNear) : ((camNear + z)*camFar)/((camFar - camNear)*z); }
        void main(){
          gl_FragColor = texture2D(tColor, vUv);
          float d = texture2D(tDepth, vUv).r;
          if (maskOn > 0.5 && d < 1.0) {
            float m = texture2D(tMask, vUv).r;
            if (m < 1.0 && abs(viewZ(m) - viewZ(d)) < 0.06) d = clamp(depthOf(viewZ(d) - 1.0), 0.0, 1.0);
          }
          gl_FragDepth = d; }`,
      uniforms: { tColor: { value: null }, tDepth: { value: null }, tMask: { value: null }, maskOn: { value: 0 }, camNear: { value: 0.1 },
        camFar: { value: 1000 }, ortho: { value: 1 } }, depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true }));
  }
  depthTexture(readBuffer) { return this.stash ? this.stash.texture : readBuffer.depthTexture; }
  render(renderer, writeBuffer, readBuffer) {
    const s = this.system, u = this.copy.material.uniforms;
    const depth = this.depthTexture(readBuffer);
    u.tColor.value = readBuffer.texture; u.tDepth.value = depth;
    const mask = depth && s.frames > 0 && s.renderSubmergedMask ? s.renderSubmergedMask(renderer, readBuffer) : null;
    u.tMask.value = mask; u.maskOn.value = mask ? 1 : 0;
    if (mask) { const c = s.camera; u.camNear.value = c.near; u.camFar.value = c.far; u.ortho.value = c.isOrthographicCamera ? 1 : 0; }
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
    // the scan also notes which top-level groups hold FX objects or lights: the render walks only those (and the
    // roots'), not every node of the scene; a new top-level object triggers a rescan
    const tops = (this._tops ||= new Set());
    if (this._tick++ % 30 === 0 || this.scene.children.length !== this._kids) {
      this._has = false;
      this._kids = this.scene.children.length;
      tops.clear();
      for (const top of this.scene.children) top.traverse((o) => { if (o.isLight) { o.layers.enable(this.layer); tops.add(top); } else if (isFx(o)) { this._has = true; tops.add(top); } });
    }
    let has = this._has;
    if (!has && this.roots) for (const r of this.roots) { r.traverseVisible((o) => { if (!has && isFx(o)) has = true; }); if (has) break; }
    if (!has) return;
    const keep = (this._keep ||= new Set()), hid = (this._hid ||= []);
    keep.clear(); hid.length = 0;
    for (const r of this.roots || []) { let t = r; while (t?.parent && t.parent !== this.scene) t = t.parent; if (t?.parent === this.scene) keep.add(t); }
    for (const top of this.scene.children) if (top.visible && !tops.has(top) && !keep.has(top)) { top.visible = false; hid.push(top); }
    const c = this.camera;
    this.cam = this.cam && this.cam.type === c.type ? this.cam : c.clone();
    this.cam.copy(c); this.cam.layers.set(this.layer);
    const r = renderer, ac = r.autoClear, sa = r.shadowMap.autoUpdate, bg = this.scene.background;
    r.autoClear = false; r.shadowMap.autoUpdate = false; this.scene.background = null;
    r.setRenderTarget(this.renderToScreen ? null : readBuffer);
    try { r.render(this.scene, this.cam); } finally { for (const top of hid) top.visible = true; hid.length = 0; }
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
