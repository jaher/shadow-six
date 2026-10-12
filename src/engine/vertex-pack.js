/**
 * Compact vertex attributes that draw the same (perf/gpu-memory): values in [−1, 1] (unit normals, AO, snow catch) as
 * normalized Int16 — steps of 1/32767 — and colours as half floats rounded to nearest (0.05 % steps).
 *
 * 3-vector data is padded to 4 components (8 bytes a vertex, w = 0): there is no 3-component 16-bit vertex format in
 * D3D11, and Metal wants 4-byte strides, so ANGLE (Chrome / Edge on Windows, Safari and Chrome on macOS / iOS) and
 * Vulkan drivers without the format convert such an attribute into a second, padded buffer — more memory, not less.
 * Shaders keep declaring `vec3`: the fourth component is simply not read.
 * No import of three: the tree generator also runs in a module Worker (no import map there) — the attribute helpers
 * take the three namespace.
 * @module engine/vertex-pack
 */

/**
 * Values in [−1, 1] as normalized Int16, `size` components a vertex stored in `stride` (≥ size; the rest 0).
 * @param {ArrayLike<number>} v @param {number} [size] @param {number} [stride]
 * @returns {Int16Array|null} null when a value lies outside [−1, 1] (keep the floats: nothing is ever clamped)
 */
export function snorm16(v, size = 1, stride = size) {
  for (let i = 0; i < v.length; i++) if (!(v[i] >= -1 && v[i] <= 1)) return null;
  const n = v.length / size, o = new Int16Array(n * stride);
  for (let k = 0; k < n; k++) for (let c = 0; c < size; c++) o[k * stride + c] = Math.round(v[k * size + c] * 32767);
  return o;
}

const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
/** IEEE binary16 bits of v, rounded to nearest even (three's DataUtils.toHalfFloat truncates: twice the error). */
export function toHalf(v) {
  F32[0] = v;
  const x = U32[0], sign = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112;
  let m = x & 0x7fffff;
  if (e >= 31) return sign | 0x7bff; // past the half range: the largest half
  if (e <= 0) { // subnormal half
    if (e < -10) return sign;
    m |= 0x800000;
    const sh = 14 - e, h = m >>> sh, rest = m & ((1 << sh) - 1), halfway = 1 << (sh - 1);
    return sign | (h + (rest > halfway || (rest === halfway && (h & 1)) ? 1 : 0));
  }
  let h = sign | (e << 10) | (m >>> 13);
  const rest = m & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && (h & 1))) h++; // a carry rolls into the exponent, as it should
  return h;
}

/** Half floats (Uint16Array of IEEE binary16 bits), `size` components a vertex stored in `stride` (the rest 0). */
export function half16(v, size = 1, stride = size) {
  const n = v.length / size, o = new Uint16Array(n * stride);
  for (let k = 0; k < n; k++) for (let c = 0; c < size; c++) o[k * stride + c] = toHalf(v[k * size + c]);
  return o;
}

/**
 * Attribute over a packed array: Int16 → normalized, Uint16 → half float, Float32 as it is; `count` vertices (the
 * item size follows the array's stride). The array is attached, not copied (Float16BufferAttribute's constructor copies).
 */
export function packedAttribute(THREE, arr, count) {
  const size = Math.round(arr.length / count);
  if (arr instanceof Int16Array) return new THREE.BufferAttribute(arr, size, true);
  if (arr instanceof Uint16Array) {
    const at = new THREE.Float16BufferAttribute(new Uint16Array(size), size);
    at.array = arr; at.count = count;
    return at;
  }
  return new THREE.BufferAttribute(arr, size);
}

/**
 * Replace a geometry's Float32 normals by normalized Int16 × 4 (8 instead of 12 bytes a vertex). Once the surface is
 * final: three's computeVertexNormals accumulates unnormalized sums into an existing attribute (they would clamp) —
 * delete the attribute before computing them again. @returns {boolean} done
 */
export function packNormals(THREE, geo) {
  const n = geo?.attributes?.normal;
  if (!n || n.isInterleavedBufferAttribute || n.normalized || !(n.array instanceof Float32Array) || n.itemSize !== 3) return false;
  const a = snorm16(n.array, 3, 4);
  if (!a) return false;
  geo.setAttribute('normal', new THREE.BufferAttribute(a, 4, true));
  return true;
}
