/**
 * Material-aware GTAO (terrain-final must-fix 1): the stock GTAOPass draws its normal/depth prepass with ONE
 * override material (scene.overrideMaterial = MeshNormalMaterial), so alpha-tested foliage cards, wind-animated
 * grass and vertex-displaced meshes are written as solid, undisplaced quads -> black squares / dark fragments.
 *
 * This subclass swaps materials per object for the prepass instead:
 *   object.userData.aoMaterial   Material used in the AO prepass (must write packed view normals like
 *                                MeshNormalMaterial; same vertex animation as the colour material)
 *   material.userData.aoMaterial same, per material (shared by every mesh that uses it)
 *   object.userData.aoExclude    true -> not drawn into the AO buffers (e.g. dense grass, particles)
 *   automatic                    material.alphaTest > 0 with map/alphaMap -> cached cut-out MeshNormalMaterial
 *   everything else              the stock normalMaterial (no change in behaviour or cost)
 * @module engine/gtao-alpha
 */
import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

const CUTOUT_PARS = /* glsl */ `
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
`;
// r186's normal fragment already declares diffuseColor (opacity in .a): assign, never redeclare
const CUTOUT_MAIN = /* glsl */ `
	diffuseColor = vec4( 1.0 );
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
`;

/** Cut-out variant of MeshNormalMaterial that honours map/alphaMap alpha and alphaTest. */
export function makeCutoutNormalMaterial(src) {
  const m = new THREE.MeshNormalMaterial({ side: src.side, blending: THREE.NoBlending });
  m.map = src.map || null;
  m.alphaMap = src.alphaMap || null;
  m.alphaTest = src.alphaTest;
  m.displacementMap = src.displacementMap || null;
  m.displacementScale = src.displacementScale ?? 1;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <uv_pars_fragment>', '#include <uv_pars_fragment>\n' + CUTOUT_PARS)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + CUTOUT_MAIN);
  };
  m.customProgramCacheKey = () => 'gtao-cutout';
  return m;
}

export class AlphaAwareGTAOPass extends GTAOPass {
  constructor(...args) {
    super(...args);
    this._aoAuto = new WeakMap();
    this._swap = [];
  }

  /** @returns {THREE.Material|null|undefined} material for the prepass; null = exclude; undefined = stock */
  _aoPick(obj, mat) {
    if (!mat) return undefined;
    if (mat.userData?.aoMaterial) return mat.userData.aoMaterial;
    if (mat.alphaTest > 0 && (mat.map || mat.alphaMap)) {
      let m = this._aoAuto.get(mat);
      if (!m) { m = makeCutoutNormalMaterial(mat); this._aoAuto.set(mat, m); }
      m.map = mat.map || null; m.alphaMap = mat.alphaMap || null; m.alphaTest = mat.alphaTest; m.side = mat.side;
      return m;
    }
    return obj.isSkinnedMesh ? this._skinnedNormal() : this.normalMaterial;
  }

  /** Own normal material for skinned meshes: sharing one material between skinned and static meshes makes three
   *  recompute the program parameters at every switch (getProgram churn with dozens of characters). */
  _skinnedNormal() {
    if (!this._normalSkinned) this._normalSkinned = this.normalMaterial.clone();
    return this._normalSkinned;
  }

  _renderOverride(renderer, overrideMaterial, renderTarget, clearColor, clearAlpha) {
    if (overrideMaterial !== this.normalMaterial) return super._renderOverride(renderer, overrideMaterial, renderTarget, clearColor, clearAlpha);
    const swap = this._swap;
    swap.length = 0;
    this.scene.traverseVisible((o) => {
      if (!(o.isMesh || o.isInstancedMesh || o.isBatchedMesh || o.isSkinnedMesh)) return;
      const ud = o.userData;
      if (ud.aoExclude) { swap.push(o, o.material, 1); o.visible = false; return; }
      let m;
      if (ud.aoMaterial) m = ud.aoMaterial;
      else if (Array.isArray(o.material)) m = o.material.map((x) => this._aoPick(o, x) ?? this._aoPick(o, {}));
      else m = this._aoPick(o, o.material) ?? this._aoPick(o, {});
      swap.push(o, o.material, 0);
      o.material = m;
    });
    // same as GTAOPass._renderOverride but without scene.overrideMaterial
    renderer.getClearColor(this._originalClearColor);
    const originalClearAlpha = renderer.getClearAlpha();
    const originalAutoClear = renderer.autoClear;
    renderer.setRenderTarget(renderTarget);
    renderer.autoClear = false;
    renderer.setClearColor(clearColor);
    renderer.setClearAlpha(clearAlpha || 0.0);
    renderer.clear();
    const bg = this.scene.background, shadowAuto = renderer.shadowMap.autoUpdate;
    this.scene.background = null;
    renderer.shadowMap.autoUpdate = false;   // normals need no shadow maps (the main pass already rendered them this frame)
    renderer.render(this.scene, this.camera);
    renderer.shadowMap.autoUpdate = shadowAuto;
    this.scene.background = bg;
    renderer.autoClear = originalAutoClear;
    renderer.setClearColor(this._originalClearColor);
    renderer.setClearAlpha(originalClearAlpha);
    for (let i = swap.length - 3; i >= 0; i -= 3) {
      const o = swap[i];
      if (swap[i + 2]) o.visible = true; else o.material = swap[i + 1];
    }
    swap.length = 0;
  }

  dispose() {
    super.dispose();
  }
}
