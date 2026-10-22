/**
 * STUB — owned by foundation/MISSIONS (see docs/ARCHITECTURE.md). Sandbox test map (60 × 60 m):
 * a river (north–south) crossed by one bridge, a walled enemy compound east of the river with a
 * barracks, a destructible fuel tank (destroy objective) and a hut; a house, a wire fence, sandbags,
 * trees and crates on the west bank. Three commandos (Green Beret, Sniper, Sapper) start in the SW;
 * extraction zone in the NW. Five enemies: a rotating bridge sentry, a patrol, a fuel-tank guard,
 * an officer and a west-bank patrol. Used by tests (keep positions stable).
 *
 * Art pass (setting: occupied Flanders, 1942 — a Wehrmacht fuel depot walled in brick beside a Flemish lift bridge):
 * library assets on the gameplay footprints (Flemish brick farmhouse, German plank barrack hut, tarred shed), the
 * depot's brick yard wall (art/depot-walls.js), Belgian pave and a concrete yard (visual pavements), street furniture
 * and set dressing kept off the solution's and the patrols' ways (tests/unit/art-m00.test.mjs).
 *
 * Loadouts follow BEL (src/items.js): Green Beret knife + pistol (+ decoy, shovel); Sniper rifle with
 * 5 rounds + pistol (and the mission's 6-dose first-aid kit — no Driver/Spy deployed, so the Sniper
 * carries it); Sapper pistol + bear trap + 2 time bombs + 2 grenades + wire cutters (mission-specific).
 */

const H = Math.PI / 2;
const deg = (d) => (d * Math.PI) / 180;

export default {
  id: 'm00',
  campaign: 'BEL', // ruleset → world.rules (CONFIG.rulesets.BEL)
  title: 'Sandbox',
  subtitle: 'Training ground — test map',
  theater: 'temperate',
  size: [60, 60],
  seed: 1234,
  briefing: {
    text: 'Cross the river, destroy the fuel depot inside the enemy compound and get the team back to the extraction point in the north-west.',
    objectivesSummary: 'Destroy the fuel depot. Reach the extraction point with every commando.',
  },
  baseTerrain: 'grass',
  terrain: [
    { type: 'path', terrain: 'road', points: [[0, 30], [36, 30]], width: 3 },
    { type: 'path', terrain: 'road', points: [[44, 30], [60, 30]], width: 3 },
    { type: 'rect', terrain: 'ground', x: 44, z: 4, w: 14, d: 50 },
    { type: 'path', terrain: 'shallow', points: [[40, 0], [40, 60]], width: 7 },
  ],
  structures: [
    // water strip + bridge (river footprint writes deep water; the bridge deck is walkable)
    { type: 'river', points: [[40, 0], [40, 60]], width: 5 },
    { type: 'bridge', id: 'bridge', x: 40, z: 30, rot: 0, w: 10, d: 3.5 },
    // enemy compound (east bank): walls with a gap on the west side at the road
    // (art pass: Flemish brick yard wall — pilasters, tarred plinth, blue-stone coping, wire brackets; gate piers at the road)
    { type: 'wall', variant: 'brick_depot_wire', points: [[45, 4], [58, 4], [58, 56], [45, 56], [45, 33]], gatePiers: [[45, 27], [45, 33]] },
    { type: 'wall', variant: 'brick_depot_wire', points: [[45, 27], [45, 4]], gatePiers: [[45, 27], [45, 33]] },
    // (x 52.5, 9.6 m: the W gable door's steps leave a two-cell way to the compound wall — at x 52 they stood 0.8 m
    // from it — and the E eaves stay clear of the E wall)
    // (art pass: a German RAD-type plank barrack hut, doors on both long sides; its flag on a pole by the W gable)
    { type: 'barracks', id: 'barracks1', x: 52.5, z: 11, rot: 0, w: 9.6, d: 6, reinforcementSpawn: true, asset: 'hut_timber_barrack_a',
      artOffset: [-0.45, 0] }, // (the model 0.45 m W: its E gable and eaves clear of the E wall)
    { type: 'fueltank', id: 'fuel_depot', x: 52, z: 38, destructible: true, hp: 100 },
    { type: 'hut', id: 'hut1', x: 53, z: 50, rot: 0, asset: 'shed_tarred_be' }, // (art pass: a tarred Flemish plank shed; z 50 keeps patrol_east's corner (55, 46) clear)
    { type: 'sandbags', x: 47.5, z: 25.5, rot: 0, w: 3 },
    { type: 'sandbags', x: 47.5, z: 34.5, rot: 0, w: 3 },
    { type: 'barrels', x: 55.76, z: 6.62 }, // clear of barracks1's steps (placement rule b)
    { type: 'crates', x: 47.5, z: 52 },
    // west bank
    { type: 'house', id: 'house1', x: 16, z: 14, rot: 0, asset: 'farmhouse_mosan_b' }, // (art pass: a Flemish brick farmhouse, M16 Maas kit)
    { type: 'fence', points: [[20, 40], [32, 40], [32, 50]] },
    { type: 'crates', x: 26, z: 22 },
    { type: 'sandbags', x: 30, z: 34, rot: H, w: 3 },
    { type: 'tree', x: 8, z: 36 },
    { type: 'tree', x: 24, z: 8 },
    { type: 'pine', x: 30, z: 14 },
    { type: 'bush', x: 12, z: 26 },
    { type: 'bush', x: 22.55, z: 32.53 }, // off the road (placement rule b)
    { type: 'rocks', x: 34, z: 54 },
    { type: 'lamp_post', x: 33.5, z: 32.4 }, // beside the bridge approach: off its ramp and the road (placement rule b)
    // ---- art pass dressing (off the solution's and the patrols' ways; what blocks is drawn and what is drawn blocks)
    // the farmhouse's firewood against its N wall, a handcart by its E gable, a pump well and a clothesline in the yard
    { id: 'logs_house', type: 'crates', variant: 'log_pile', asset: 'log_pile_stack', x: 15, z: 9.7, rot: 0, w: 3, d: 1.2, h: 1, block: 1, fixed: true },
    { id: 'cart_house', type: 'crates', variant: 'handcart', asset: 'handcart_wood', x: 21.4, z: 16.2, rot: deg(80), w: 1.9, d: 1.4, h: 1, block: 1, fixed: true },
    { id: 'well_yard', type: 'well', x: 22.5, z: 4, r: 0.8, fixed: true },
    { id: 'clothesline', type: 'wall', variant: 'clothesline_sheets', mat: 'canvas', points: [[13, 4.5], [18.5, 4.5]], h: 2, width: 0.3 },
    // a requisitioned Opel Blitz parked in the fenced paddock
    { id: 'lorry_paddock', type: 'crates', variant: 'parked_lorry', x: 26, z: 45.6, rot: deg(-8), w: 6.2, d: 2.3, h: 2.2, block: 2,
      vehicleArt: 'opel_blitz_cargo', fixed: true },
    // the garrison flag on its pole by the barracks' W gable
    { id: 'flag_barracks', type: 'sign', variant: 'flagpole_german', x: 47.2, z: 15.8, rot: 0, w: 0.3, d: 0.3, h: 6.5, block: 2, fixed: true },
    // the depot's drum dump on timber dunnage in the SE corner of the yard (art/fuel-drums.js)
    { id: 'drums_depot', type: 'crates', variant: 'fuel_drums', x: 56.5, z: 53.8, rot: deg(90), w: 3.2, d: 1.4, h: 1.6, block: 1, fixed: true },
  ],
  commandos: [
    { role: 'greenberet', x: 6, z: 52, heading: -H, inventory: { knife: 1, pistol: 1, decoy: 1, shovel: 1 } },
    { role: 'sniper', x: 9, z: 54, heading: -H, inventory: { sniperRifle: 5, pistol: 1 } },
    { role: 'sapper', x: 12, z: 52, heading: -H, inventory: { pistol: 1, bearTrap: 1, timeBomb: 2, grenade: 2, wireCutters: 1 } },
  ],
  enemies: [
    // rotating sentry at the east end of the bridge
    { id: 'sentry_bridge', soldierType: 'sentry', x: 47, z: 30, heading: Math.PI, post: { scan: [Math.PI, Math.PI - 0.9, Math.PI, Math.PI + 0.9], period: 4 } },
    // patrol inside the compound
    { id: 'patrol_east', soldierType: 'soldier', x: 49, z: 20, heading: H,
      route: [{ x: 49, z: 20, wait: 2 }, { x: 49, z: 46, wait: 2, look: 0 }, { x: 55, z: 46 }, { x: 55, z: 20 }] },
    // guard beside the fuel depot
    { id: 'guard_fuel', soldierType: 'soldier', x: 48.5, z: 38, heading: Math.PI },
    // officer outside the barracks
    { id: 'officer', soldierType: 'officer', x: 51, z: 17, heading: H },
    // west-bank patrol along the road (knife practice)
    { id: 'patrol_west', soldierType: 'soldier', x: 14, z: 27, heading: 0,
      route: [{ x: 14, z: 27, wait: 3, look: -90 }, { x: 30, z: 27, wait: 3, look: 0 }] },
  ],
  // art pass: Belgian pave on the road west of the bridge, the depot's concrete yard (visual only, grid false: nav and
  // footstep terrain stay as tuned); a telegraph line on the S verge, a fingerpost and a kilometre stone, the bridge's
  // load board, the depot's no-smoking board at the gate and a hooded lamp at the barracks door
  pavements: [
    { id: 'pave_road_w', surface: 'belgian', points: [[0, 28.6], [35.2, 28.6], [35.2, 31.4], [0, 31.4]], wear: 0.55, weeds: 0.5, cracks: 0.25, puddles: 0.15, edge: 'ragged', grid: false },
    { id: 'yard_road', surface: 'concrete', points: [[45.3, 28.4], [57.7, 28.4], [57.7, 31.6], [45.3, 31.6]], cracks: 0.5, weeds: 0.3, patches: 0.3, edge: 'ragged', grid: false },
    { id: 'yard_depot', surface: 'concrete', points: [[49.2, 34.6], [55.6, 34.6], [55.6, 41.4], [49.2, 41.4]], cracks: 0.5, weeds: 0.25, patches: 0.35, edge: 'ragged', grid: false },
  ],
  furniture: [
    { type: 'telegraph', points: [[1, 33], [12.5, 33], [24.5, 33]], spacing: 11.5, h: 6.5, wires: 2, block: false },
    { type: 'sign', variant: 'fingerpost', x: 3.5, z: 32.6, rot: deg(90), text: 'BRUGGE 14 km', block: false },
    { type: 'milestone', x: 17.5, z: 32.4, rot: deg(-90), text: 'N 9\nBRUGGE 15', block: false },
    { type: 'sign', variant: 'wehrmacht', x: 34.3, z: 27.3, rot: deg(-90), text: 'BRÜCKE\nHÖCHSTLAST 8 t', block: false },
    { type: 'sign', variant: 'wehrmacht', x: 44.3, z: 35.4, rot: deg(180), text: 'TREIBSTOFFLAGER\nRAUCHEN VERBOTEN!', block: false },
    { type: 'lamp', variant: 'wall_lamp', x: 53.6, z: 14.05, rot: deg(90), hooded: true, block: false },
  ],
  vehicles: [],
  items: [],
  objectives: [
    { id: 'destroy_fuel', text: 'Destroy the fuel depot', type: 'destroy', targets: ['fuel_depot'], required: true },
    { id: 'escape', text: 'Reach the extraction point with every commando', type: 'escape', required: true },
  ],
  extraction: { x: 6, z: 7, r: 3.5 },
  reinforcements: { spawnIds: ['barracks1'], waves: 1, perWave: 2, maxAlive: 8 },
  cameraStart: { x: 12, z: 46 },
  par: { time: 300, kills: 3 },
};
