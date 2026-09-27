// Engine glue for src/engine/renderer.js through its official post hooks (docs/vfx-pipeline.md §6.1):
//  - the persistent FxPass is inserted by the 'fx' slot: after 'afterAO' (water surface + late FX layer), before
//    sanitize/bloom/OutputPass on every preset, so HDR fire feeds bloom + tone mapping and smoke draws over rivers;
//    the pass is `keepAlive` (the engine disposes every pass on a rebuild; only vfx.dispose() really frees it);
//  - shared scene depth, `renderer.fxDepth`:
//      water in the chain   → the read buffer's DepthTexture (WaterPass restores world depth + writes the surface)
//      GTAO, no water       → GTAO's own depth texture (the ping-pong depth is stale after GTAO's swap)
//      no AO, no water      → a DepthTexture on the composer ping-pong targets (read from the RenderPass target)
//  - VFX quality follows the engine preset (vfx.setQuality(presetName)).
// Fallback for an engine without addPostHook: wrap _buildComposer (legacy lab path).
import * as THREE from 'three';

function ensureDepthTextures(composer) {
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
    if (rt.depthTexture) continue;
    rt.depthTexture = new THREE.DepthTexture(rt.width, rt.height, THREE.UnsignedIntType);
    rt.depthTexture.name = 'engine-fxDepth';
    rt.dispose(); // re-create the framebuffer with the depth attachment on next use
  }
}
const isWaterPass = (p) => !!p && (p.constructor?.name === 'WaterPass' || !!p.system?.waterScene);

export function attachToEngine(eng, vfx) {
  vfx.pass.keepAlive = true;
  const install = (composer, passes) => {
    const water = composer.passes.some(isWaterPass);
    if (!passes.ao || water) ensureDepthTextures(composer);
    const sz = eng.renderer.getDrawingBufferSize(new THREE.Vector2());
    vfx.pass.setSize(sz.x, sz.y);
    passes.vfx = vfx.pass;
    vfx.camera = eng.camera;
    vfx.depthProvider = (readBuffer) => (water ? readBuffer.depthTexture : passes.ao ? passes.ao.depthTexture : readBuffer.depthTexture) ?? null;
    vfx.setQuality(eng.presetName);
    return vfx.pass;
  };
  Object.defineProperty(eng, 'fxDepth', { configurable: true, get: () => vfx.pass._lastDepth ?? null });
  if (vfx.decals && eng.decalScene && vfx.decals.scene !== eng.decalScene) vfx.setDecalScene(eng.decalScene);
  if (typeof eng.addPostHook === 'function' && eng.postHooks?.fx) {
    vfx.hookMode = 'official';
    const off = eng.addPostHook('fx', (composer, passes) => install(composer, passes));
    return () => { off(); delete eng.fxDepth; };
  }
  // legacy engine: re-insert before bloom ?? output after every rebuild
  vfx.hookMode = 'shim';
  const origBuild = eng._buildComposer.bind(eng);
  eng._buildComposer = () => {
    if (eng.composer) { const i = eng.composer.passes.indexOf(vfx.pass); if (i >= 0) eng.composer.passes.splice(i, 1); }
    origBuild();
    const c = eng.composer, p = eng.passes;
    if (!c) return;
    const idx = c.passes.indexOf(p.bloom ?? p.output);
    c.insertPass(install(c, p), idx < 0 ? c.passes.length : idx);
  };
  if (eng.composer) eng._buildComposer();
  return () => { eng._buildComposer = origBuild; const i = eng.composer?.passes.indexOf(vfx.pass) ?? -1; if (i >= 0) eng.composer.passes.splice(i, 1); delete eng.fxDepth; };
}
