/**
 * Lighting data + pure helpers (design-spec §2.4, realism-pipeline §1.1.5 / §3.4).
 *
 * - THEATER_LIGHTING: per-theater defaults (sun always from the NW = screen upper-left, so shadows fall
 *   down-right as in BEL's baked lighting).
 * - HDRI: the vendored CC0 Poly Haven 1k HDRIs (assets/hdri/, credited in CREDITS.md) by preset id.
 * - resolveLighting(theater, mission.lighting): maps the mission-file keys
 *   { sunElevDeg, sunAzimuthDeg, kelvin, hdri, fog, lut, exposure } onto a renderer lighting object.
 * - analyzeHDR(tex): clamps texels > 24 in place (sun disc out of the PMREM → no double sun / fireflies)
 *   and measures the horizontal-plane sky irradiance used for the automatic fill level
 *   envIntensity = skyFrac/(1−skyFrac) · sunI · sin(el) / E_sky (realism §1.1.5 step 3).
 * No renderer state here (unit-testable in node).
 * @module engine/lighting
 */
import * as THREE from 'three';

/** Compass azimuth (deg) of the sun for every theater: north-west = screen upper-left at yaw 0. The sun stays tied to the
 * compass whatever the camera yaw: at the default +15° the east side walls that come into view are the shaded ones. */
export const SUN_AZIMUTH_NW = 315;

/**
 * Per-theater defaults. sunAzimuth: compass degrees the sun is IN (0 = N, 90 = E); sunElevation: degrees
 * above the horizon. hdri / lut: default preset ids. envSaturation / envWarmth: IBL grading (env-grade.js).
 */
export const THEATER_LIGHTING = {
  temperate: {
    sunAzimuth: SUN_AZIMUTH_NW, sunElevation: 40, kelvin: 5800, sunColor: 0xfff0dc, sunIntensity: 3.2,
    hemiSky: 0xbfd4ee, hemiGround: 0x5a5236, hemiIntensity: 0.25, envIntensity: 0.55, envSaturation: 0.6, envWarmth: 0.1,
    fog: { color: 0xaeb9bf, near: 60, far: 520 }, exposure: 1.0, hdri: 'clear_day', lut: 'temperate',
    sky: { turbidity: 3.5, rayleigh: 1.6, mieCoefficient: 0.004, mieDirectionalG: 0.8 },
  },
  coast: {
    sunAzimuth: SUN_AZIMUTH_NW, sunElevation: 40, kelvin: 6000, sunColor: 0xfff2e0, sunIntensity: 3.0,
    hemiSky: 0xb9d2f0, hemiGround: 0x4e5a52, hemiIntensity: 0.25, envIntensity: 0.6, envSaturation: 0.65, envWarmth: 0.1,
    fog: { color: 0xa9bccb, near: 50, far: 460 }, exposure: 1.0, hdri: 'clear_day', lut: 'coast',
    sky: { turbidity: 4, rayleigh: 1.8, mieCoefficient: 0.005, mieDirectionalG: 0.8 },
  },
  desert: {
    sunAzimuth: SUN_AZIMUTH_NW, sunElevation: 60, kelvin: 5200, sunColor: 0xfff0d2, sunIntensity: 3.9,
    hemiSky: 0xd2e2f6, hemiGround: 0x9c8158, hemiIntensity: 0.25, envIntensity: 0.6, envSaturation: 0.5, envWarmth: 0.2,
    fog: { color: 0xd8c9ab, near: 70, far: 600 }, exposure: 0.95, hdri: 'desert_noon', lut: 'desert',
    sky: { turbidity: 6, rayleigh: 1.2, mieCoefficient: 0.006, mieDirectionalG: 0.85 },
  },
  snow: {
    sunAzimuth: SUN_AZIMUTH_NW, sunElevation: 16, kelvin: 6000, sunColor: 0xfff2e6, sunIntensity: 2.6,
    hemiSky: 0xcfdcf2, hemiGround: 0xd9dfe8, hemiIntensity: 0.25, envIntensity: 0.7, envSaturation: 0.5, envWarmth: 0.3,
    fog: { color: 0xcfd8e2, near: 40, far: 380 }, exposure: 1.2, hdri: 'overcast_snow', lut: 'norway',
    sky: { turbidity: 2.5, rayleigh: 2.2, mieCoefficient: 0.004, mieDirectionalG: 0.75 },
  },
  night: {
    sunAzimuth: SUN_AZIMUTH_NW, sunElevation: 50, kelvin: 9000, sunColor: 0x9db4ff, sunIntensity: 0.35,
    hemiSky: 0x2a3a5c, hemiGround: 0x0f1014, hemiIntensity: 0.3, envIntensity: 0.4, envSaturation: 0.8, envWarmth: 0,
    fog: { color: 0x0c1018, near: 40, far: 320 }, exposure: 1.25, hdri: 'night', lut: 'night', night: true,
    sky: { turbidity: 1.5, rayleigh: 0.4, mieCoefficient: 0.002, mieDirectionalG: 0.7 },
  },
};

/**
 * Vendored HDRIs (all Poly Haven CC0, 1k). skyFrac = share of horizontal irradiance from the sky (the rest from
 * the analytic sun): ~0.2 clear (≈4:1 sun:sky), ~0.5 overcast. sunScale scales the DirectionalLight for
 * overcast skies; shadowSoft multiplies the PCF radius.
 */
export const HDRI = {
  overcast_snow: { url: 'hdri/snowy_park_01_1k.hdr', name: 'Snowy Park 01', authors: 'Oliksiy Yakovlyev', skyFrac: 0.38, sunScale: 0.9, shadowSoft: 1.5 },
  overcast_snow_alt: { url: 'hdri/snow_field_puresky_1k.hdr', name: 'Snow Field (Pure Sky)', authors: 'Jarod Guest, Sergej Majboroda', skyFrac: 0.42, sunScale: 0.75, shadowSoft: 1.5 },
  desert_noon: { url: 'hdri/goegap_1k.hdr', name: 'Goegap', authors: 'Greg Zaal', skyFrac: 0.17, sunScale: 1, shadowSoft: 1 },
  clear_day: { url: 'hdri/kloofendal_43d_clear_puresky_1k.hdr', name: 'Kloofendal 43d Clear (Pure Sky)', authors: 'Greg Zaal', skyFrac: 0.22, sunScale: 1, shadowSoft: 1 },
  overcast_temperate: { url: 'hdri/overcast_soil_puresky_1k.hdr', name: 'Overcast Soil (Pure Sky)', authors: 'Jarod Guest, Sergej Majboroda', skyFrac: 0.5, sunScale: 0.6, shadowSoft: 1.8 },
  golden_hour: { url: 'hdri/spruit_sunrise_1k.hdr', name: 'Spruit Sunrise', authors: 'Greg Zaal', skyFrac: 0.3, sunScale: 0.9, shadowSoft: 1.2 },
  dusk: { url: 'hdri/qwantani_dusk_2_puresky_1k.hdr', name: 'Qwantani Dusk 2 (Pure Sky)', authors: 'Greg Zaal, Jarod Guest', skyFrac: 0.4, sunScale: 0.6, shadowSoft: 1.4 },
  night: { url: 'hdri/moonlit_golf_1k.hdr', name: 'Moonlit Golf', authors: 'Greg Zaal', skyFrac: 0.5, sunScale: 1, shadowSoft: 1.3, night: true },
};

/** Short names used in mission files → preset id (a function gets the theater name). */
export const HDRI_ALIASES = {
  overcast: (theater) => (theater === 'snow' ? 'overcast_snow' : 'overcast_temperate'),
  clear: 'clear_day', sunny: 'clear_day', desert: 'desert_noon', noon: (t) => (t === 'desert' ? 'desert_noon' : 'clear_day'),
  dawn: 'golden_hour', golden: 'golden_hour', sunrise: 'golden_hour', moon: 'night', moonlit: 'night',
};

/** @returns {string|null} HDRI preset id for a mission/theater hdri name (null = procedural sky). */
export function resolveHdriId(name, theater) {
  if (name === false || name === 'none' || name === 'sky') return null;
  if (!name) return null;
  if (HDRI[name]) return name;
  const a = HDRI_ALIASES[name];
  if (a) return typeof a === 'function' ? a(theater) : a;
  return null;
}

/**
 * Black-body colour temperature → normalised RGB (max channel 1), sRGB primaries (Tanner Helland fit).
 * @param {number} kelvin 1000..40000
 * @returns {THREE.Color} in the working (linear) colour space
 */
export function kelvinToColor(kelvin) {
  const t = THREE.MathUtils.clamp(kelvin, 1000, 40000) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v) => THREE.MathUtils.clamp(v, 0, 255) / 255;
  const col = new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
  const m = Math.max(col.r, col.g, col.b) || 1;
  return col.multiplyScalar(1 / m);
}

/**
 * Merge a theater's defaults with a mission's `lighting` block (schema: { sunElevDeg, sunAzimuthDeg, kelvin,
 * hdri, fog, lut, exposure, envIntensity, sunIntensity }; null/undefined fields keep the theater default).
 * `fog`: null/undefined = theater default, false = off, number = visibility (m): haze is ~10 % at the
 * view centre and grows toward the top of the screen, object = {color, near, far} verbatim.
 * Renderer-native keys (sunAzimuth, sunElevation, …) are accepted too, so old overrides keep working.
 * @param {string|object} theater theater name or a full lighting object
 * @param {object|null} [ml] mission.lighting
 */
export function resolveLighting(theater, ml = null) {
  const name = typeof theater === 'string' ? theater : theater?.theaterName || 'custom';
  const base = typeof theater === 'string' ? THEATER_LIGHTING[theater] || THEATER_LIGHTING.temperate : theater;
  const m = ml || {};
  const L = { ...base, theaterName: THEATER_LIGHTING[name] ? name : base.theaterName || 'temperate' };
  // renderer-native overrides first, then the mission-file keys (which win)
  for (const k of ['sunAzimuth', 'sunElevation', 'sunColor', 'sunIntensity', 'hemiSky', 'hemiGround', 'hemiIntensity',
    'envIntensity', 'envSaturation', 'envWarmth', 'exposure', 'sky', 'skyFrac', 'night']) {
    if (m[k] !== undefined && m[k] !== null) L[k] = m[k];
  }
  if (Number.isFinite(m.sunElevDeg)) L.sunElevation = m.sunElevDeg;
  if (Number.isFinite(m.sunAzimuthDeg)) L.sunAzimuth = m.sunAzimuthDeg;
  if (Number.isFinite(m.kelvin)) L.kelvin = m.kelvin;
  if (Number.isFinite(m.kelvin) || m.sunColor === undefined) L.sunColor = kelvinToColor(L.kelvin ?? 5800).getHex();
  if (m.hdri !== undefined && m.hdri !== null) L.hdri = m.hdri;
  if (m.lut !== undefined && m.lut !== null) L.lut = m.lut;
  if (m.fog === false) L.fog = null;
  else if (Number.isFinite(m.fog)) L.fog = { color: base.fog?.color ?? 0xb0b8c0, near: 0, far: 4 * m.fog };
  else if (m.fog && typeof m.fog === 'object') L.fog = { ...base.fog, ...m.fog };
  L.hdriId = resolveHdriId(L.hdri, L.theaterName);
  const H = L.hdriId ? HDRI[L.hdriId] : null;
  L.hdriUrl = H?.url || null;
  L.skyFrac = m.skyFrac ?? H?.skyFrac ?? 0.22;
  L.shadowSoft = m.shadowSoft ?? H?.shadowSoft ?? 1;
  if (H && m.sunIntensity == null) L.sunIntensity = (base.sunIntensity ?? 3) * (H.sunScale ?? 1);
  if (H?.night) L.night = true;
  // review P3: a night HDRI (hdri 'night' / 'moon' / 'moonlit') on a DAY theater used to keep that theater's full-
  // strength warm sun, hemisphere, exposure and fog → a sepia "day" with lamp pools that never read. Unless the mission
  // overrides a key, a moonlit mission now takes the night rig (cold dim moon, dark sky fill, night fog/LUT).
  if (L.night && name !== 'night') {
    const N = THEATER_LIGHTING.night;
    for (const k of ['sunIntensity', 'hemiSky', 'hemiGround', 'hemiIntensity', 'envIntensity', 'envSaturation', 'envWarmth', 'exposure', 'sky']) {
      if (m[k] == null) L[k] = N[k];
    }
    if (!Number.isFinite(m.kelvin) && m.sunColor == null) { L.kelvin = N.kelvin; L.sunColor = N.sunColor; }
    if (m.fog == null) L.fog = { ...N.fog };
    if (m.lut == null) L.lut = N.lut;
  }
  L.autoEnv = m.envIntensity == null && !L.night; // envIntensity from the HDRI's measured sky irradiance
  return L;
}

/**
 * Measure an equirect HDR (DataTexture from HDRLoader, half or full float) and clamp its brightest texels in
 * place. Idempotent; cached on tex.userData.hdrAnalysis.
 * @returns {{E0:number, E1:number, sunLum:number, sunElevDeg:number, sunAzU:number, clamped:number}}
 *   E0/E1: horizontal-plane irradiance of the whole map / of the clamped sky.
 */
export function analyzeHDR(tex, clampMax = 24) {
  if (tex?.userData?.hdrAnalysis) return tex.userData.hdrAnalysis;
  const img = tex?.image;
  if (!img?.data || !img.width || !img.height) return null;
  const { data, width, height } = img;
  const st = Math.round(data.length / (width * height));
  const half = data instanceof Uint16Array;
  const f = half ? THREE.DataUtils.fromHalfFloat : (v) => v;
  const h = half ? THREE.DataUtils.toHalfFloat : (v) => v;
  let best = 0, bi = 0, clamped = 0, E0 = 0, E1 = 0;
  const dA = (2 * Math.PI / width) * (Math.PI / height);
  for (let y = 0; y < height; y++) {
    const lat = (0.5 - (y + 0.5) / height) * Math.PI;
    const wgt = lat > 0 ? Math.sin(lat) * Math.cos(lat) * dA : 0; // cosine-weighted solid angle, horizontal receiver
    for (let x = 0; x < width; x++) {
      const i = y * width + x, o = i * st;
      const r = f(data[o]), g = f(data[o + 1]), b = f(data[o + 2]);
      let L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (!(L >= 0)) { data[o] = data[o + 1] = data[o + 2] = h(0); L = 0; } // NaN guard at the source
      if (L > best) { best = L; bi = i; }
      E0 += L * wgt;
      if (L > clampMax) {
        const k = clampMax / L;
        data[o] = h(r * k); data[o + 1] = h(g * k); data[o + 2] = h(b * k);
        clamped++;
        L = clampMax;
      }
      E1 += L * wgt;
    }
  }
  tex.needsUpdate = true;
  const px = bi % width, py = Math.floor(bi / width);
  const a = { E0, E1, sunLum: best, sunElevDeg: (0.5 - (py + 0.5) / height) * 180, sunAzU: (px + 0.5) / width, clamped };
  tex.userData.hdrAnalysis = a;
  return a;
}

/**
 * Automatic sky fill (realism §1.1.5 step 3): sky share `skyFrac` of the ground irradiance.
 * @param {{sunIntensity:number, sunElevation:number, skyFrac?:number}} L @param {{E1:number}} a
 */
export function autoEnvIntensity(L, a) {
  if (!a || !(a.E1 > 1e-4)) return L.envIntensity ?? 0.5;
  const sf = THREE.MathUtils.clamp(L.skyFrac ?? 0.22, 0.02, 0.9);
  const sunH = (L.sunIntensity ?? 3) * Math.max(0.05, Math.sin(THREE.MathUtils.degToRad(L.sunElevation ?? 40)));
  return THREE.MathUtils.clamp((sf / (1 - sf)) * sunH / a.E1, 0.05, 3);
}
