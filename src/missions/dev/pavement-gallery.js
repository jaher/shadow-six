/**
 * Dev map (not in the campaign index): every step-3p surface and street-furniture type side by side, used by
 * tools/perf/paveshot.mjs and tests/p3-pavement.test.mjs. Re-theme with {...gallery, theater:'snow'|'desert'}.
 * 110 × 90 m: a harbour basin along the south edge with a granite quay; a setts main street with blackout-painted
 * kerbs, flag sidewalks and an embedded tram line; a tar-macadam road with a dashed centre line, cracks, patches,
 * manholes and a shell crater; a Belgian-block lane with weedy ragged edges; a fan-pavé square; a herringbone
 * brick yard; a concrete apron; soft gravel / dirt / mud tracks.
 */
const D = Math.PI / 180;

export default {
  id: 'pave',
  title: 'Pavement gallery',
  theater: 'temperate',
  size: [110, 90],
  seed: 3,
  baseTerrain: 'grass',
  lighting: { sunElevDeg: 34, sunAzimuthDeg: 300, kelvin: 5600 },
  terrain: [
    { type: 'rect', terrain: 'water', x: 0, z: 80, w: 110, d: 10 },
    { type: 'rect', terrain: 'ground', x: 70, z: 0, w: 40, d: 34 },
  ],
  roads: [
    { id: 'main', surface: 'setts', points: [[0, 40], [40, 40], [70, 44], [110, 44]], width: 8, markings: null,
      kerb: { paint: 'blackout' }, sidewalk: { w: 2.5 }, rails: { tracks: 1 }, wear: 0.7, weeds: 0.2, puddles: 0.35,
      lamps: { variant: 'paris_single', spacing: 18, side: 'alternate' } },
    { id: 'tarmac', surface: 'asphalt', points: [[55, 0], [55, 18], [53, 35]], width: 6.5, markings: 'dashed', cracks: 0.65,
      patches: 0.35, manholes: 14, craters: [[55.5, 10, 2.2]], puddles: 0.4,
      lamps: { variant: 'paris_single', hooded: true, spacing: 16, side: 'right' } },
    { id: 'lane', surface: 'belgian', points: [[20, 0], [22, 17], [19, 35.5]], width: 4.5, weeds: 0.8, wear: 0.4 },
    { id: 'gravel', surface: 'gravel', points: [[70, 58], [85, 62], [110, 60]], width: 4, lamps: { variant: 'norway_wood', spacing: 20, side: 'left' } },
    { id: 'dirt', surface: 'dirt', points: [[52, 49], [60, 62], [58, 76]], width: 3.5 },
    { id: 'mud', surface: 'mud', points: [[85, 49], [95, 70], [108, 76]], width: 3.5 },
  ],
  pavements: [
    { id: 'quay', surface: 'quay', x: 0, z: 70, w: 70, d: 10, raise: 0.45, quay: { edges: [2], bollards: 10, railing: 2.4 } },
    { id: 'square', surface: 'pave_fan', x: 25, z: 50, w: 20, d: 16, kerb: true, weeds: 0.25 },
    { id: 'yard', surface: 'brick_herringbone', x: 4, z: 50, w: 16, d: 16, weeds: 0.5, angle: 0 },
    { id: 'apron', surface: 'concrete', x: 74, z: 4, w: 32, d: 26, cracks: 0.5, weeds: 0.6, patches: 0.2, craters: [[98, 22, 2.5]] },
    { id: 'plaza', surface: 'flags', x: 30, z: 4, w: 14, d: 20, raise: 0.15 },
  ],
  furniture: [
    { type: 'morris_column', x: 35, z: 58 },
    { type: 'lamp', variant: 'paris_double', x: 29, z: 54, rot: 0 }, { type: 'lamp', variant: 'paris_double', x: 41, z: 62, rot: Math.PI },
    { type: 'bench', x: 31, z: 64.5, rot: Math.PI }, { type: 'bench', x: 39, z: 51.5, rot: 0 },
    ...[8, 26, 44, 62].map((x) => ({ type: 'lamp', variant: 'harbour', x, z: 73, rot: Math.PI / 2 })),
    { type: 'lamp', variant: 'harbour', x: 17, z: 73.5, damaged: true, lean: 9, rot: Math.PI / 2 },
    ...[2, 5, 8].map((k) => ({ type: 'bollard', x: 44 + k * 0.9, z: 47.8 })),
    { type: 'floodlight', x: 75, z: 5, rot: 45 * D }, { type: 'floodlight', x: 105, z: 29, rot: -135 * D },
    { type: 'searchlight_pole', x: 105.5, z: 4.5, rot: 135 * D },
    { type: 'lamp', variant: 'platform', x: 47, z: 21, rot: 0 }, { type: 'lamp', variant: 'wall_lamp', x: 44.2, z: 12, rot: 0 },
    { type: 'sign', variant: 'fingerpost', x: 49, z: 36.5, rot: 0, text: 'ROUEN 14 km' },
    { type: 'sign', variant: 'plate', x: 60, z: 36.5, rot: Math.PI, text: 'DIEPPE\n38 km' },
    { type: 'sign', variant: 'andreaskreuz', x: 51.4, z: 27.8, rot: 0 },
    { type: 'milestone', x: 50.8, z: 2, rot: 0, text: 'N 27\n6 km' },
    { type: 'crossing', x: 55, z: 25, rot: 90 * D, w: 6.5 },
    { type: 'telegraph', points: [[0, 86], [60, 86], [110, 84]], spacing: 30, h: 7 },
    { type: 'fence', variant: 'picket', points: [[4, 67.5], [20, 67.5]] }, { type: 'fence', variant: 'railing', points: [[24, 67.5], [46, 67.5]] },
    { type: 'fence', variant: 'wire', points: [[72, 2], [108, 2], [108, 31]] },
  ],
  structures: [{ type: 'rail_track', points: [[44, 25], [110, 25]] }],
  commandos: [{ role: 'greenberet', x: 48, z: 48, heading: -90 * D, inventory: { knife: 1, pistol: 1 } }],
  enemies: [],
  objectives: [],
  zones: [],
};
