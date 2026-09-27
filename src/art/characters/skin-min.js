/**
 * Fast lowest-point query for skinned meshes (ground curves / clip grounding).
 *
 * Same maths as THREE.SkinnedMesh.getVertexPosition + applyMatrix4(matrixWorld), but only the world Y is needed, so
 * per pose each bone reduces to one 4-float row: row1(mesh.matrixWorld · bindMatrixInverse · bone.matrixWorld ·
 * boneInverse); each vertex is then Σ w · (row · bindMatrix·p). Bind-space positions, indices and weights are unpacked
 * once per geometry (handles quantized / interleaved attributes). ~15× faster than the generic per-vertex path, which
 * cost 12–19 ms per clip and caused 30–80 ms hitches when a squad switched to a new clip (die, run, aim) in combat.
 * Meshes with morph targets fall back to the generic path.
 */
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _pre = new THREE.Matrix4(), _v = new THREE.Vector3();

function unpack(mesh) {
  const g = mesh.geometry;
  const bm = mesh.bindMatrix.elements;
  if (g.userData._s6skin && g.userData._s6skin.bm === bm.join()) return g.userData._s6skin;
  const P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, n = P.count;
  const pos = new Float32Array(n * 4), idx = new Uint16Array(n * 4), wt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    pos[i * 4] = bm[0] * x + bm[4] * y + bm[8] * z + bm[12];
    pos[i * 4 + 1] = bm[1] * x + bm[5] * y + bm[9] * z + bm[13];
    pos[i * 4 + 2] = bm[2] * x + bm[6] * y + bm[10] * z + bm[14];
    pos[i * 4 + 3] = bm[3] * x + bm[7] * y + bm[11] * z + bm[15];
    for (let k = 0; k < 4; k++) { idx[i * 4 + k] = SI.getComponent(i, k); wt[i * 4 + k] = SW.getComponent(i, k); }
  }
  return (g.userData._s6skin = { bm: bm.join(), pos, idx, wt, n });
}

/**
 * Lowest world Y of a skinned mesh in its current pose (call after updateMatrixWorld).
 * @param {THREE.SkinnedMesh} mesh
 * @param {{stride?: number, list?: ArrayLike<number>|null}} [o] every `stride`-th vertex, or only the indices in `list`
 */
export function skinnedMinY(mesh, { stride = 1, list = null } = {}) {
  if (!mesh.isSkinnedMesh || mesh.geometry.morphAttributes?.position?.length) return genericMinY(mesh, stride, list);
  const S = unpack(mesh), bones = mesh.skeleton.bones, inv = mesh.skeleton.boneInverses, nb = bones.length;
  const rows = mesh._s6rows && mesh._s6rows.length === nb * 4 ? mesh._s6rows : (mesh._s6rows = new Float32Array(nb * 4));
  _pre.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
  for (let b = 0; b < nb; b++) {
    _m.multiplyMatrices(_pre, bones[b] ? bones[b].matrixWorld : _m.identity()).multiply(inv[b]);
    const e = _m.elements; rows[b * 4] = e[1]; rows[b * 4 + 1] = e[5]; rows[b * 4 + 2] = e[9]; rows[b * 4 + 3] = e[13];
  }
  const { pos, idx, wt } = S;
  let mn = Infinity;
  const one = (i) => {
    const o = i * 4, x = pos[o], y = pos[o + 1], z = pos[o + 2], w = pos[o + 3];
    let s = 0;
    for (let k = 0; k < 4; k++) {
      const ww = wt[o + k]; if (ww === 0) continue;
      const r = idx[o + k] * 4;
      s += ww * (rows[r] * x + rows[r + 1] * y + rows[r + 2] * z + rows[r + 3] * w);
    }
    if (s < mn) mn = s;
  };
  if (list) for (let j = 0; j < list.length; j++) one(list[j]);
  else for (let i = 0; i < S.n; i += stride) one(i);
  return mn;
}

function genericMinY(mesh, stride, list) {
  let mn = Infinity;
  const one = (i) => { mesh.getVertexPosition(i, _v); _v.applyMatrix4(mesh.matrixWorld); if (_v.y < mn) mn = _v.y; };
  if (list) for (let j = 0; j < list.length; j++) one(list[j]);
  else for (let i = 0, n = mesh.geometry.attributes.position.count; i < n; i += stride) one(i);
  return mn;
}
