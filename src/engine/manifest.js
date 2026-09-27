/**
 * Asset manifest — ids → files under assets/. Loaded by engine/assets.js (with a loading screen).
 *
 * Owners APPEND entries (ART: textures/models/hdri, AUDIO: audio). Keep ids stable; code refers to
 * assets by id only. Every file must be CC0/redistributable and credited in CREDITS.md.
 * A JS module (not JSON) so a missing manifest never produces a 404 in the console.
 *
 * Entry shapes:
 *   textures: { id: { url, colorSpace?: 'srgb'|'linear', repeat?: [u, v], anisotropy?: number, preload?: bool } }
 *   models:   { id: { url, preload?: bool } }                      // .glb / .gltf (Draco/KTX2/meshopt ok)
 *   hdr:      { id: { url, preload?: bool } }                      // equirect .hdr / .exr
 *   audio:    { id: { url, preload?: bool } }                      // .ogg / .mp3 / .wav
 *   groups:   { groupName: [ 'textures:id', 'models:id', … ] }     // e.g. per theater / per mission
 * @module engine/manifest
 */

export const MANIFEST = {
  version: 1,
  base: 'assets/',
  textures: {},
  models: {},
  // CC0 Poly Haven 1k HDRIs (CREDITS.md); ids = engine/lighting.js HDRI presets, picked by mission lighting.hdri
  hdr: {
    overcast_snow: { url: 'hdri/snowy_park_01_1k.hdr' },
    overcast_snow_alt: { url: 'hdri/snow_field_puresky_1k.hdr' },
    desert_noon: { url: 'hdri/goegap_1k.hdr' },
    clear_day: { url: 'hdri/kloofendal_43d_clear_puresky_1k.hdr' },
    overcast_temperate: { url: 'hdri/overcast_soil_puresky_1k.hdr' },
    golden_hour: { url: 'hdri/spruit_sunrise_1k.hdr' },
    dusk: { url: 'hdri/qwantani_dusk_2_puresky_1k.hdr' },
    night: { url: 'hdri/moonlit_golf_1k.hdr' },
  },
  audio: {},
  groups: {},
};

export default MANIFEST;
