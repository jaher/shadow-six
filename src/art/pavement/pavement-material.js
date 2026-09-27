/**
 * Pavement materials (step 3p): one MeshStandardMaterial per road / area sharing ONE program (same cache key) and
 * the surface's texture set (assets/textures/pavement/{1k,512}: diff, nor, ard = AO / roughness / height).
 * @module art/pavement/pavement-material
 */
import * as THREE from 'three';
import { SURFACES } from '../../world/roads.js';
import { injectPavement } from './pavement-glsl.js';

const HAS_DOM = typeof document !== 'undefined';
const BASE = new URL('../../../assets/textures/pavement/', import.meta.url).href;
const TILE = { setts: 2.4, belgian: 2.0, pave_fan: 2.5, brick: 1.8, flags: 2.24, asphalt: 2.2, asphalt_cracked: 3.0, concrete: 4.5, grate: 0.5 };
/** POM steps per render preset. */
export const POM_STEPS = { low: 0, medium: 8, high: 14, ultra: 24 };

/** Theatre colours: joint dirt, trail film, weeds. */
export const THEATER_PAVE = {
  temperate: { dirt: [0.24, 0.21, 0.17], film: [0.2, 0.15, 0.1], weed: [0.2, 0.27, 0.08], wet: 0.12, snow: 0 },
  coast: { dirt: [0.3, 0.28, 0.24], film: [0.25, 0.22, 0.17], weed: [0.22, 0.27, 0.1], wet: 0.25, snow: 0 },
  night: { dirt: [0.24, 0.21, 0.17], film: [0.2, 0.15, 0.1], weed: [0.2, 0.27, 0.08], wet: 0.3, snow: 0 },
  snow: { dirt: [0.42, 0.43, 0.45], film: [0.33, 0.34, 0.36], weed: [0.34, 0.29, 0.19], wet: 0.2, snow: 0.6 },
  desert: { dirt: [0.62, 0.5, 0.35], film: [0.66, 0.55, 0.4], weed: [0.42, 0.38, 0.2], wet: 0, snow: 0 },
};

const TEX = new Map();
function tex(set, map, tier) {
  const url = `${BASE}${tier}/${set}_${map}.jpg`;
  if (!TEX.has(url)) {
    const t = new THREE.TextureLoader().load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (map === 'diff') t.colorSpace = THREE.SRGBColorSpace;
    TEX.set(url, t);
  }
  return TEX.get(url);
}

/** Texture tier for a render preset ('low' → 512). */
export const tierOf = (quality) => (quality === 'low' ? '512' : '1k');

/**
 * Material for one road / area.
 * @param {string} surface SURFACES key (hard) @param {object} o {theater, quality, wear, cracks, patches, weeds,
 *   puddles, ragged, trail:{texture, width, depth}|null, weather:{snow?, wet?}}
 */
export function pavementMaterial(surface, o = {}) {
  const S = SURFACES[surface] || SURFACES.setts, set = S.tex || 'setts';
  const th = THEATER_PAVE[o.theater] || THEATER_PAVE.temperate;
  if (!HAS_DOM) return new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.9, name: `pavement:${surface}` });
  const tier = tierOf(o.quality);
  const asphaltLike = /asphalt|concrete/.test(set);
  const U = {
    tPvDiff: { value: tex(set, 'diff', tier) }, tPvNor: { value: tex(set, 'nor', tier) }, tPvArd: { value: tex(set, 'ard', tier) },
    tPvTrail: { value: o.trail?.texture ?? null },
    uPvMap: { value: new THREE.Vector4(o.trail?.width ?? 1, o.trail?.depth ?? 1, o.trail?.texture ? 1 : 0, S.normal ?? 1.0) },
    uPvTex: { value: new THREE.Vector4(1 / ((TILE[set] || 2) * (S.tileScale || 1)), S.pom ?? 0.03, POM_STEPS[o.quality] ?? 8, asphaltLike ? 1 : 0) },
    uPvTint: { value: new THREE.Color(...(o.tint || S.tint || [1, 1, 1])) },
    uPvDirt: { value: new THREE.Color(...th.dirt) }, uPvFilm: { value: new THREE.Color(...th.film) }, uPvWeed: { value: new THREE.Color(...th.weed) },
    uPvWear: { value: new THREE.Vector4(o.wear ?? 0.5, o.cracks ?? S.cracks ?? 0.2, o.patches ?? 0, o.weeds ?? 0.3) },
    uPvWeather: { value: new THREE.Vector4(o.weather?.snow ?? th.snow, o.weather?.wet ?? th.wet, o.puddles ?? 0.3, o.film ?? 1) },
    uPvSlab: { value: new THREE.Vector4(S.slab?.[0] ?? 0, S.slab?.[1] ?? 0, 0.018, S.bond ? 1 : 0) },
    uPvSat: { value: S.sat ?? 1 },
    uPvKind: { value: new THREE.Vector4(o.ragged ? 1 : 0, asphaltLike ? 1 : 0, asphaltLike ? 0 : 1, 1) },
  };
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.name = `pavement:${surface}`;
  m.userData.pavement = U;
  injectPavement(m, U);
  return m;
}

/** Follow a render preset: POM steps + texture tier (swaps maps in place; one program for every preset). */
export function setPavementQuality(mat, quality) {
  const U = mat?.userData?.pavement;
  if (!U) return;
  U.uPvTex.value.z = POM_STEPS[quality] ?? 8;
  const tier = tierOf(quality), set = /pavement:(\w+)/.exec(mat.name)?.[1];
  const S = SURFACES[set];
  if (!S?.tex) return;
  U.tPvDiff.value = tex(S.tex, 'diff', tier); U.tPvNor.value = tex(S.tex, 'nor', tier); U.tPvArd.value = tex(S.tex, 'ard', tier);
}
