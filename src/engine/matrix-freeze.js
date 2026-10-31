/**
 * One world-matrix update for a burst of renders of the same scene. three's WebGLRenderer.render() updates the whole
 * scene's world matrices on every call while `scene.matrixWorldAutoUpdate` is on: a frame of the pipeline renders the
 * world scene 4-6 times (main pass, GTAO normals, x-ray, water mirror…), each a walk over every node of the map (M18:
 * 13.6k nodes, ~4-5 ms a walk at load). Game.render already updates them once per frame and turns the flag off for its
 * passes; the load's warm-up frames (art/vehicle-model.js warmVehicleArt, drawn a share of the scene per task, the
 * probe re-running a part until its programs are made) did not: ~900 whole-scene updates, ~3.5-4.5 s of the M18
 * load's main thread, most of each warm-up task.
 *
 * Nothing moves between the renders of such a burst (a warm-up draws what is there; its parts only hide drawables), so
 * the matrices the first update leaves are the ones every render would have computed again.
 * @module engine/matrix-freeze
 */

/**
 * Run `fn` (synchronous: renders of `scene`) with the scene's world matrices updated once first and the per-render
 * update off meanwhile; the flag is put back whatever happens. A scene already frozen (inside Game.render's window)
 * is left as it is: no extra update.
 * @template T @param {import('three').Object3D|null|undefined} scene @param {() => T} fn @returns {T}
 */
export function withSceneMatrices(scene, fn) {
  if (!scene || scene.matrixWorldAutoUpdate === false) return fn();
  scene.updateMatrixWorld();
  scene.matrixWorldAutoUpdate = false;
  try {
    return fn();
  } finally {
    scene.matrixWorldAutoUpdate = true;
  }
}
