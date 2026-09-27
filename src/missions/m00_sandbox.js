/**
 * STUB — owned by foundation/MISSIONS (see docs/ARCHITECTURE.md). Sandbox test map (60 × 60 m):
 * a river (north–south) crossed by one bridge, a walled enemy compound east of the river with a
 * barracks, a destructible fuel tank (destroy objective) and a hut; a house, a wire fence, sandbags,
 * trees and crates on the west bank. Three commandos (Green Beret, Sniper, Sapper) start in the SW;
 * extraction zone in the NW. Five enemies: a rotating bridge sentry, a patrol, a fuel-tank guard,
 * an officer and a west-bank patrol. Used by tests (keep positions stable).
 *
 * Loadouts follow BEL (src/items.js): Green Beret knife + pistol (+ decoy, shovel); Sniper rifle with
 * 5 rounds + pistol (and the mission's 6-dose first-aid kit — no Driver/Spy deployed, so the Sniper
 * carries it); Sapper pistol + bear trap + 2 time bombs + 2 grenades + wire cutters (mission-specific).
 */

const H = Math.PI / 2;

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
    { type: 'wall', points: [[45, 4], [58, 4], [58, 56], [45, 56], [45, 33]] },
    { type: 'wall', points: [[45, 27], [45, 4]] },
    { type: 'barracks', id: 'barracks1', x: 52, z: 11, rot: 0, w: 10, d: 6, reinforcementSpawn: true },
    { type: 'fueltank', id: 'fuel_depot', x: 52, z: 38, destructible: true, hp: 100 },
    { type: 'hut', id: 'hut1', x: 53, z: 49, rot: 0 },
    { type: 'sandbags', x: 47.5, z: 25.5, rot: 0, w: 3 },
    { type: 'sandbags', x: 47.5, z: 34.5, rot: 0, w: 3 },
    { type: 'barrels', x: 55.76, z: 6.62 }, // clear of barracks1's steps (placement rule b)
    { type: 'crates', x: 47.5, z: 52 },
    // west bank
    { type: 'house', id: 'house1', x: 16, z: 14, rot: 0 },
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
