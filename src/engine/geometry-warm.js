/**
 * Vertex buffers uploaded ahead, a few a frame: meshes that will be drawn soon but are not now. A structure's blast
 * reveals its ruin with every level of detail but the one it shows hidden — their buffers go to the GPU at the first
 * frame that draws them, all at once: M14's two casemate ruins' far levels, 31 MB in the frame the walkthrough's camera
 * pulled back from the third charge (~20 ms of bufferData). queueGeometryUpload(root) lines a subtree's meshes up;
 * Game.render runs uploadQueued() after its draw: each mesh is put through three's own upload (WebGLObjects.update —
 * what a render does for every object it sees) with a material that draws nothing, up to a byte budget a frame. The
 * picture is the same; only when the bytes travel changes.
 * @module engine/geometry-warm
 */
import * as THREE from 'three';

const Q = [];
let hidden = null, target = null;

/** Bytes of a geometry's attribute arrays and index. */
function geometryBytes(g) {
  let n = g.index?.array?.byteLength ?? 0;
  for (const k in g.attributes) n += g.attributes[k].array?.byteLength ?? 0;
  return n;
}

/** Line up the meshes of `root` (plain meshes: skinned and instanced ones have per-frame data of their own). */
export function queueGeometryUpload(root) {
  root?.traverse?.((o) => { if (o.isMesh && o.geometry && !o.isSkinnedMesh && !o.isInstancedMesh && !o.isBatchedMesh) Q.push(o); });
}

/** Drop the queue (mission unload: its meshes go with the world). */
export function clearGeometryUploads() { Q.length = 0; }

/** How many meshes wait. */
export function geometryUploadsPending() { return Q.length; }

/**
 * Upload queued meshes' buffers until `budget` bytes have gone this call (one mesh at least). A mesh whose geometry
 * was disposed meanwhile is skipped. @param {THREE.WebGLRenderer} renderer @param {THREE.Camera} camera
 * @returns {number} meshes uploaded
 */
export function uploadQueued(renderer, camera, budget = 3e6) {
  if (!Q.length || !renderer || !camera) return 0;
  hidden ||= new THREE.MeshBasicMaterial({ visible: false });
  target ||= new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const prev = renderer.getRenderTarget(), auto = renderer.autoClear, shadow = renderer.shadowMap.autoUpdate;
  let bytes = 0, n = 0;
  try {
    renderer.setRenderTarget(target);
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    while (Q.length && (n === 0 || bytes < budget)) {
      const m = Q.shift();
      const g = m.geometry;
      if (!g || !g.attributes?.position || g.userData?.disposed) continue;
      const s0 = m.material, s1 = m.visible, s2 = m.frustumCulled, s3 = m.matrixWorldAutoUpdate;
      m.material = hidden; m.visible = true; m.frustumCulled = false; m.matrixWorldAutoUpdate = false;
      try { renderer.render(m, camera); } finally { m.material = s0; m.visible = s1; m.frustumCulled = s2; m.matrixWorldAutoUpdate = s3; }
      bytes += geometryBytes(g); n++;
    }
  } finally {
    renderer.setRenderTarget(prev);
    renderer.autoClear = auto;
    renderer.shadowMap.autoUpdate = shadow;
  }
  return n;
}
