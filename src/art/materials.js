/**
 * STUB — owned by ART. Placeholder PBR material palette (flat colours + a shared procedural
 * grain texture for subtle variation). The realism pipeline replaces these with CC0 texture sets
 * (docs/realism-pipeline.md) behind the same `getMaterial(name)` API.
 * All returned materials are shared (userData.shared = true) — clone before mutating.
 * @module art/materials
 */

import * as THREE from 'three';

/** name → {color, roughness, metalness, …MeshStandardMaterial params} */
export const PALETTE = {
  plaster: { color: 0xb8ad97, roughness: 0.92 },
  plasterDark: { color: 0x9a8f7a, roughness: 0.92 },
  brick: { color: 0x8a5a44, roughness: 0.9 },
  roofTile: { color: 0x7a4632, roughness: 0.8 },
  roofTin: { color: 0x6c716c, roughness: 0.55, metalness: 0.55 },
  roofTar: { color: 0x3a3a36, roughness: 0.85 },
  wood: { color: 0x7a5c3a, roughness: 0.85 },
  woodDark: { color: 0x4d3a26, roughness: 0.85 },
  planks: { color: 0x8b6b45, roughness: 0.88 },
  concrete: { color: 0x8e8d86, roughness: 0.95 },
  stone: { color: 0x8c8577, roughness: 0.95 },
  rock: { color: 0x7a746a, roughness: 0.97 },
  sandbag: { color: 0xa39168, roughness: 0.97 },
  canvas: { color: 0x6b6b4b, roughness: 0.95 },
  metal: { color: 0x51564f, roughness: 0.5, metalness: 0.7 },
  metalRust: { color: 0x6e4a33, roughness: 0.75, metalness: 0.4 },
  olivePaint: { color: 0x4b5431, roughness: 0.6, metalness: 0.3 },
  greyPaint: { color: 0x5d625c, roughness: 0.6, metalness: 0.3 },
  fuelRed: { color: 0x7d2b20, roughness: 0.55, metalness: 0.35 },
  tankCream: { color: 0xc4bba3, roughness: 0.55, metalness: 0.2 },
  glass: { color: 0x1c2428, roughness: 0.1, metalness: 0.2 },
  foliage: { color: 0x3c5a2a, roughness: 0.9 },
  foliageDark: { color: 0x2c4420, roughness: 0.9 },
  pineNeedles: { color: 0x2b4028, roughness: 0.9 },
  palmLeaf: { color: 0x4f6b2c, roughness: 0.85 },
  bark: { color: 0x4d3b2a, roughness: 0.95 },
  wire: { color: 0x5b5b55, roughness: 0.4, metalness: 0.8 },
  rail: { color: 0x5a524a, roughness: 0.45, metalness: 0.8 },
  sleeper: { color: 0x4a3b2c, roughness: 0.9 },
  dirt: { color: 0x5b4a36, roughness: 1 },
  mud: { color: 0x3f3426, roughness: 0.9 },
  crater: { color: 0x2e2820, roughness: 1 },
  flagRed: { color: 0x8c1f1a, roughness: 0.8, side: THREE.DoubleSide },
  lampGlow: { color: 0xfff2c8, emissive: 0xffe2a0, emissiveIntensity: 2, roughness: 0.4 },
  black: { color: 0x151515, roughness: 0.7 },
};

let _grain = null;

/**
 * Shared tiling grain texture (luminance noise around 1.0) that breaks up flat colours.
 * @returns {THREE.Texture}
 */
export function grainTexture() {
  if (_grain) return _grain;
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < size * size; k++) {
    const v = 205 + Math.floor(rnd() * 50);
    data.set([v, v, v, 255], k * 4);
  }
  _grain = new THREE.DataTexture(data, size, size);
  _grain.wrapS = _grain.wrapT = THREE.RepeatWrapping;
  _grain.magFilter = THREE.LinearFilter;
  _grain.minFilter = THREE.LinearMipmapLinearFilter;
  _grain.generateMipmaps = true;
  _grain.colorSpace = THREE.SRGBColorSpace;
  _grain.needsUpdate = true;
  return _grain;
}

const _cache = new Map();

/**
 * Shared material by palette name (unknown names → neutral grey, with a console.warn once).
 * @param {string} name
 * @returns {THREE.MeshStandardMaterial}
 */
export function getMaterial(name) {
  let m = _cache.get(name);
  if (m) return m;
  const spec = PALETTE[name];
  if (!spec) console.warn(`[materials] unknown material "${name}"`);
  const { color, ...rest } = spec || { color: 0x888888, roughness: 0.9 };
  m = new THREE.MeshStandardMaterial({ color, map: rest.emissive ? null : grainTexture(), ...rest });
  m.name = name;
  m.userData.shared = true;
  _cache.set(name, m);
  return m;
}

/**
 * A shared material with a custom colour (for team colours, variants). Cached by name+colour.
 * @returns {THREE.MeshStandardMaterial}
 */
export function tintedMaterial(name, color) {
  const key = `${name}#${color}`;
  let m = _cache.get(key);
  if (m) return m;
  m = getMaterial(name).clone();
  m.color.set(color);
  m.userData.shared = true;
  _cache.set(key, m);
  return m;
}
