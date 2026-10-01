/**
 * Dev map (not in the campaign index): every barbed-wire obstacle type side by side (docs/barbed-wire.md §4), used
 * by tools/perf/wireshot.mjs and tests/barbed-wire.test.mjs. Re-theme with {...gallery, theater:'desert'|'coast'}.
 * 64 × 56 m. North row (z 8–20): field fence, double apron, knife rests, concertina, triple concertina.
 * Middle row (z 26–38): hedgehog belt, low entanglement, reinforced concertina, prison cage. South: an electric
 * chain-link fence with a transformer cage, and a stone wall with a bracket coping and an adobe wall with a coil.
 */
const D = Math.PI / 180;

export default {
  id: 'wiregal',
  title: 'Wire gallery',
  theater: 'snow',
  size: [64, 56],
  seed: 5,
  baseTerrain: 'ground',
  lighting: { sunElevDeg: 30, sunAzimuthDeg: 315 },
  structures: [
    { id: 'g_field', type: 'fence', variant: 'wire', h: 1.5, points: [[4, 6], [4, 20]], cuttable: true },
    { id: 'g_apron', type: 'fence', variant: 'wire_on_stakes', h: 1.2, width: 1.0, points: [[11, 6], [11, 20]] },
    { id: 'g_knife', type: 'fence', variant: 'knife_rest_wood', h: 1.2, width: 0.8, points: [[19, 6], [19, 20]] },
    { id: 'g_coil', type: 'fence', variant: 'concertina', h: 0.8, points: [[26, 6], [26, 20]] },
    { id: 'g_triple', type: 'fence', variant: 'concertina_hedgehog', h: 1.5, width: 1.6, points: [[33, 6], [33, 20]] },
    { id: 'g_belt', type: 'fence', variant: 'czech_hedgehog_wire', h: 1.4, width: 1.2, points: [[42, 6], [42, 20]] },
    { id: 'g_low', type: 'fence', variant: 'low_entanglement', h: 0.2, width: 1.2, points: [[49, 6], [49, 20]] },
    { id: 'g_reinf', type: 'fence', variant: 'concertina', h: 0.8, reinforced: true, points: [[56, 6], [56, 20]] },
    { id: 'g_cage', type: 'fence', variant: 'wire_cage', h: 2.4, points: [[4, 28], [12, 28], [12, 36], [4, 36], [4, 28.6]] },
    { id: 'g_elec', type: 'fence', variant: 'electric', h: 2.5, powered: true, cuttable: true, points: [[18, 26], [36, 26], [36, 40]] },
    { id: 'g_tcage', type: 'fence', variant: 'square', h: 2.2, sparks: true, points: [[22, 30], [27, 30], [27, 35], [22, 35], [22, 30]] },
    { id: 'g_stone', type: 'wall', variant: 'wall_stone_zigzag', wire: 'coping_bracket', h: 1.6, width: 0.6, points: [[42, 30], [58, 30]] },
    { id: 'g_adobe', type: 'wall', variant: 'mudbrick_wire', wire: 'coping_concertina', h: 2.0, width: 0.6, points: [[42, 40], [58, 40]] },
    { id: 'g_pal', type: 'wall', variant: 'palisade_wire', h: 3.0, width: 0.5, points: [[6, 48], [30, 48]] },
  ],
  commandos: [{ role: 'sapper', x: 7, z: 13, heading: 0, inventory: { wireCutters: 1, pistol: 1 } }],
  enemies: [],
  objectives: [],
  zones: [],
};
