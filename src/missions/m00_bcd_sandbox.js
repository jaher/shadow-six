/**
 * BCD sandbox (docs/bcd-plan.md §3 step N13) — dev/test map for the Beyond the Call of Duty ruleset, NOT part of
 * the BCD campaign list (`dev: true`). One of every commando, both guests, one of every new unit and animal and
 * every world mechanic, laid out as test stations (120 × 95 m, keep positions stable — tests read them):
 *   A  knock-out row (z 10–14): GB / Driver / Spy each behind a sentry with his back turned
 *   B  lures (x 34–50, z 18–30): Sniper + a walker for stones; Sapper with packs + a post for cigarettes
 *   C  rifle range (x 70–100, z 15): Lee-Enfield targets at 25 m and 30 m
 *   D  zoo (z 42–60): lion pit, ostrich pen + gate, zookeeper, chickens; a dog; Gestapo + lieutenant; Natasha
 *   E  water and machines (z 62–92): canal with a drawbridge + switch, sea mines and a rowboat, a rail wagon, a
 *      fuel tank, a lift, the Driver's knapsack, Skopje (joins when reached), a POW yard with a snitch
 * Easy/Hard: one guard per variant (`only`), variant par times and Easy route speed / pauses.
 */

const H = Math.PI / 2;

export default {
  id: 'b00',
  campaign: 'BCD', // ruleset → world.rules (CONFIG.rulesets.BCD)
  dev: true, // dev-menu / tests only: never listed in CAMPAIGNS.BCD
  title: 'BCD Sandbox',
  subtitle: 'Expansion training ground — test map',
  theater: 'temperate',
  size: [120, 95],
  seed: 4321,
  briefing: {
    text: 'Expansion test stations: knock-outs and handcuffs, stones and cigarette packs, the puppet, the Spy\'s hanger and wardrobe, the Driver\'s Lee-Enfield, Natasha and Skopje, the zoo, sea mines, the drawbridge, pushable wagons and the lift.',
    objectivesSummary: 'Try every gadget. Reach the extraction point with every commando.',
  },
  baseTerrain: 'grass',
  terrain: [
    { type: 'rect', terrain: 'water', x: 5, z: 64, w: 20, d: 28 }, // canal
    { type: 'path', terrain: 'road', points: [[30, 70], [75, 70]], width: 2 }, // rail bed
    { type: 'circle', terrain: 'sand', x: 20, z: 50, r: 7 }, // lion pit
  ],
  structures: [
    { type: 'house', id: 'house_b', x: 112, z: 60, rot: 0 },
    { type: 'crates', x: 60, z: 30 },
    { type: 'fence', points: [[40, 45], [50, 45], [50, 55], [40, 55], [40, 46]] }, // ostrich pen (gate on the east side)
  ],
  commandos: [
    { role: 'greenberet', x: 8, z: 13, heading: -H },
    { role: 'driver', x: 14, z: 13, heading: -H },
    { role: 'spy', x: 20, z: 13, heading: -H },
    { role: 'sniper', x: 34, z: 20, heading: 0 },
    { role: 'sapper', x: 40, z: 32, heading: 0, inventory: { pistol: 1, bearTrap: 1, grenade: 2, cigarettes: 3 } },
    { role: 'diver', x: 30, z: 80, heading: Math.PI },
    { role: 'natasha', x: 100, z: 72, heading: 0 },
    { role: 'skopje', x: 104, z: 86, heading: 0, joinsAt: { x: 104, z: 86, r: 3 } },
  ],
  enemies: [
    // A: knock-out row (backs to the commandos)
    { id: 'ko_gb', soldierType: 'soldier', x: 8, z: 11, heading: -H, post: { heading: -H, sweep: 0 } },
    { id: 'ko_drv', soldierType: 'soldier', x: 14, z: 11, heading: -H, post: { heading: -H, sweep: 0 } },
    { id: 'ko_spy', soldierType: 'officer', x: 20, z: 11, heading: -H, post: { heading: -H, sweep: 0 } },
    // B: lures
    { id: 'stone_walker', soldierType: 'soldier', x: 46, z: 20, heading: 0, route: { type: 'PINGPONG', points: [{ x: 46, z: 20, wait: 3, look: 0 }, { x: 47, z: 20, wait: 3, look: 0 }] } },
    { id: 'pack_guard', soldierType: 'sentry', x: 50, z: 36, heading: -H, post: { heading: -H, sweep: 0 } },
    // C: rifle range (face east, away from the Driver's firing point at x 70)
    { id: 'range_25', soldierType: 'sentry', x: 95, z: 15, heading: 0, post: { heading: 0, sweep: 0 } },
    { id: 'range_30', soldierType: 'sentry', x: 100.5, z: 12, heading: 0, post: { heading: 0, sweep: 0 } },
    // D: zoo and specials
    { id: 'lion1', soldierType: 'lion', x: 20, z: 50, heading: 0, pen: { x: 20, z: 50, r: 7 } },
    { id: 'ostrich1', soldierType: 'ostrich', x: 45, z: 50, heading: 0, pen: { x: 45, z: 50, r: 4 }, penGate: 'pen_gate' },
    { id: 'zookeeper1', soldierType: 'zookeeper', x: 32, z: 58, heading: Math.PI, fleeTo: [30, 40], post: { heading: Math.PI, sweep: 0 } },
    { id: 'chicken1', soldierType: 'chicken', x: 62, z: 46, heading: 0 },
    { id: 'chicken2', soldierType: 'chicken', x: 63, z: 47, heading: 0 },
    { id: 'dog1', soldierType: 'dog', x: 76, z: 55, heading: -H, post: { heading: -H, sweep: 0 } },
    { id: 'gestapo1', soldierType: 'gestapo', x: 112, z: 45, heading: 0, post: { heading: 0, sweep: 0 } },
    { id: 'lieut1', soldierType: 'lieutenant', x: 104, z: 72, heading: 0, post: { heading: 0, sweep: 0 } },
    // E: POW yard
    { id: 'pow1', soldierType: 'pow', x: 45, z: 90, heading: 0 },
    { id: 'snitch1', soldierType: 'snitch', x: 55, z: 90, heading: 0, post: { heading: 0, sweep: 0 } },
    { id: 'yard_guard', soldierType: 'soldier', x: 70, z: 90, heading: Math.PI, post: { heading: Math.PI, sweep: 0 } },
    // Easy / Hard data variants
    { id: 'hard_extra', soldierType: 'sentry', x: 115, z: 5, heading: 0, only: 'hard' },
    { id: 'easy_extra', soldierType: 'sentry', x: 115, z: 25, heading: 0, only: 'easy' },
  ],
  vehicles: [
    { vehicleType: 'rowboat', id: 'boat1', x: 15, z: 88, heading: -H },
  ],
  interactables: [
    { kind: 'drawbridge', id: 'bridge1', x: 15, z: 76, rect: { x: 15, z: 76, w: 22, d: 3, rot: 0 } },
    { kind: 'drawbridgeSwitch', id: 'bridge_switch', x: 28, z: 74, targets: ['bridge1'] },
    { kind: 'seaMine', id: 'mine1', x: 15, z: 68 },
    { kind: 'seaMine', id: 'mine2', x: 10, z: 84 },
    { kind: 'pushable', id: 'wagon1', x: 45, z: 70, rail: [[35, 70], [72, 70]] },
    { kind: 'pushable', id: 'tank1', variant: 'tank', x: 62, z: 82 },
    { kind: 'lift', id: 'lift1', x: 82, z: 66, a: [81, 66], b: [81, 78] },
    { kind: 'knapsack', id: 'knap_drv', x: 90, z: 82, ownerRole: 'driver' },
    { kind: 'penGate', id: 'pen_gate', x: 50, z: 50 },
  ],
  objectives: [
    { id: 'escape', text: 'Reach the extraction point with every commando', type: 'escape', required: true },
  ],
  extraction: { x: 4, z: 40, r: 3.5 },
  cameraStart: { x: 20, z: 20 },
  par: { time: 900 },
  variants: {
    easy: { par: { time: 1000 }, routeSpeedMul: 0.8, pauseMul: 2.5 },
    hard: { par: { time: 900 } },
  },
};
