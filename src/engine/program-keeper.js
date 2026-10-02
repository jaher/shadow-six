/**
 * Warm shader pipeline across mission (re)loads. three.js frees a material's WebGL program when the last material
 * using it is disposed, so unloading a mission destroys every program and the next build compiles them all again
 * (~60 programs, ~0.3 s on a restart). `deferMaterialDisposal()` queues Material#dispose calls instead of running them;
 * the returned flush runs them after the next mission's first frame, by which time its materials have acquired the
 * same programs (three keys programs by their shader source), so only the programs nothing uses any more are freed.
 *
 *   const flush = deferMaterialDisposal();   // Game.unloadMission
 *   …build the next mission, render one frame…
 *   flush();                                  // Game.frame, first frame with nothing building
 * @module engine/program-keeper
 */
import * as THREE from 'three';

let held = null;
const realDispose = THREE.Material.prototype.dispose;

/** Start holding material disposals (idempotent while already holding). @returns {() => number} flush → count */
export function deferMaterialDisposal() {
  if (!held) {
    held = new Set();
    THREE.Material.prototype.dispose = function deferredDispose() { held.add(this); };
  }
  return flushMaterialDisposal;
}

/** Run every held dispose and stop holding. @returns {number} materials disposed */
export function flushMaterialDisposal() {
  if (!held) return 0;
  const list = held;
  held = null;
  THREE.Material.prototype.dispose = realDispose;
  for (const m of list) realDispose.call(m);
  return list.size;
}

/** Are material disposals being held? */
export function holdingMaterials() { return !!held; }
