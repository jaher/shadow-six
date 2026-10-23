/**
 * Runtime switches for render / pacing optimisations that must be measured against the path they replace on the same
 * page (tools/perf/ab-toggle.mjs flips them every few seconds while the walkthrough plays: both sides see the same
 * load, the same views). Every switch defaults to the shipped behaviour; flipping one never changes the simulation.
 * `window.__perf` in the browser.
 * @module engine/perf-flags
 */
export const PERF = {
  /** AUTO / video mode: a frame's ticks fit in what its draw leaves of the vsync slot (walkthrough _adaptTicks). */
  adaptiveTicks: true,
  /** Sparse grass chunks of one archetype drawn as one merged mesh (art/terrain/grass.js); off = one draw per chunk. */
  grassMerge: true,
  /** InstancedMeshes sharing a material with plain meshes draw with its own variant (engine/program-variants.js
   *  splitInstancedMaterials); off = the shared material, its program re-derived at every switch. */
  instancedVariants: true,
};

if (typeof window !== 'undefined') window.__perf = PERF;
