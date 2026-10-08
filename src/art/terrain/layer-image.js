/**
 * Decode a layer-strip image into a THREE.DataArrayTexture. Strips are square tiles laid out row-major in a grid:
 * one column (1024 x 8192 = 8 layers) or, for images past WebP's 16383 px limit, several (2K arrays: 4096 x 8192,
 * 2 x 4 tiles of 2048). `tile` defaults to the image width (the classic single-column strip).
 * @module art/terrain/layer-image
 */

import * as THREE from 'three';
import { releaseDataAfterUpload } from '../../engine/texture-memory.js';

/** Load an image element (rejects on a 404 / decode error). */
export function loadImage(url) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.decoding = 'async';
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('load ' + url));
    i.src = url;
  });
}

/**
 * @param {string} url
 * @param {{tile?: number, srgb?: boolean, anisotropy?: number, wrap?: THREE.Wrapping, release?: boolean}} [o] release
 *   (default true): drop the pixel array after the first upload
 * @returns {Promise<THREE.DataArrayTexture>}
 */
export async function loadLayerArray(url, o = {}) {
  const img = await loadImage(url);
  const W = img.width, H = img.height;
  const tile = Math.min(o.tile || W, W);
  const cols = Math.max(1, Math.round(W / tile)), rows = Math.max(1, Math.round(H / tile));
  const n = cols * rows;
  const cv = document.createElement('canvas');
  cv.width = tile; cv.height = tile * n;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  if (cols === 1) cx.drawImage(img, 0, 0);
  else for (let i = 0; i < n; i++) cx.drawImage(img, (i % cols) * tile, Math.floor(i / cols) * tile, tile, tile, 0, i * tile, tile, tile);
  const t = new THREE.DataArrayTexture(new Uint8Array(cx.getImageData(0, 0, tile, tile * n).data.buffer), tile, tile, n);
  cv.width = cv.height = 1; // release the canvas backing store now
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = o.wrap ?? THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = o.anisotropy ?? 4;
  t.colorSpace = o.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  // the array is only read by the upload: drop it then (the session cache keeps the GPU copy for restarts); a restored
  // WebGL context decodes the strip again (engine/texture-memory.js)
  if (o.release !== false) releaseDataAfterUpload(t, () => loadLayerArray(url, { ...o, release: false }));
  return t;
}
