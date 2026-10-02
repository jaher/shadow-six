/**
 * Dev map (not in the campaign index): the fuel-tank family placed with the feat/missions defs of M8, M11, M13 and
 * M17 (copied verbatim, only translated into one 110 × 90 m yard) so the family can be loaded, reviewed and blown up
 * before those missions merge. Used by tests/fuel-tanks-missions.test.mjs. Re-theme per zone: tankYard('desert') etc.
 *   M8  (NW): tank_b 9 × 7 and tank_a 8.5 × 6.3 deck blocks with their walkways (deck y 4.5), ladders and a deck
 *             guard; drums_w1 / drums_w2 drum dumps (barrels `oil_tanks_vertical`, w × d, h 2.2).
 *   M13 (NE): fuel_1 12 × 4.5 × 5 and fuel_2 11 × 4.5 × 5, rot −10°, 5 m apart.
 *   M17 (SW): fuel_tank 5 × 3 × 6 (elevated, block 2) at rot 0.35; VALVE 3.5 m along its −u.
 *   M11 (SE): the yard trio tank_w1-3 (fueltank) and the quarry pair tank_q1/q2 (explosive `barrels`), r 1.75 h 7.
 */
const deg = (d) => (d * Math.PI) / 180;
const TANK_DECK_Y = 4.5;

const fuelTank = (id, x, z, w, d) => ({ id, type: 'fueltank', variant: 'fuel_tank_horizontal', label: 'Fuel tank', x, z, rot: 0, w, d, h: TANK_DECK_Y,
  destructible: true, destroyedBy: ['explosion'], hp: 100,
  walkways: [{ id: `${id}_deck`, points: [[x - w / 2 + 0.25, z], [x + w / 2 - 0.25, z]], width: d, y: TANK_DECK_Y }] });
const qTank = (id, x, z) => ({ id, type: 'barrels', variant: 'oil_tanks_vertical', label: 'Oil tank', x, z, rot: 0, r: 1.75, h: 7,
  explosive: 'barrel', carriable: false, destructible: true, hp: 1 });
const wTank = (id, x, z) => ({ id, type: 'fueltank', variant: 'oil_tanks_vertical', label: 'Oil tank', x, z, rot: 0, r: 1.75, h: 7, mat: 'whitePaint',
  destructible: true, destroyedBy: ['explosion'], hp: 100 });

/** M17: the elevated pair and its valve point (3.5 m along −u from the tank centre). */
export const M17 = { x: 26, z: 66, rot: 0.35 };
export const VALVE = { x: M17.x - 3.5 * Math.cos(M17.rot), z: M17.z - 3.5 * Math.sin(M17.rot) };

/** Zone centres (camera targets for the review shots). */
export const ZONES = { m08: [24, 22], m13: [78, 22], m17: [M17.x, M17.z], m11: [78, 58], m11q: [95, 72] };

export function tankYard(theater = 'desert') {
  return {
    id: 'tankyard',
    title: 'Fuel tank yard',
    campaign: 'BEL',
    dev: true,
    theater,
    size: [110, 90],
    seed: 5,
    baseTerrain: theater === 'snow' ? 'snow' : theater === 'desert' ? 'sand' : 'grass',
    structures: [
      // M8 (feat/missions m08_pyrotechnics: TANK_B (58.5, 72.5), TANK_A (67.7, 65.5) → −34.5, −50.5)
      fuelTank('tank_b', 24, 22, 9, 7),
      fuelTank('tank_a', 33.2, 15, 8.5, 6.3),
      { id: 'drums_w1', type: 'barrels', variant: 'oil_tanks_vertical', x: 6, z: 36, rot: 0, w: 6.5, d: 7.5, h: 2.2, block: 2 },
      { id: 'drums_w2', type: 'barrels', variant: 'oil_tanks_vertical', x: 12.5, z: 31.75, rot: 0, w: 3.5, d: 7, h: 2.2, block: 2 },
      // M13 (feat/missions m13_david_and_goliath: fuel_1 (76, 33.5), fuel_2 (77.5, 38.5))
      { id: 'fuel_1', type: 'fueltank', variant: 'fuel_tank_horizontal', label: 'Fuel tank', x: 76, z: 18.5, rot: deg(-10), w: 12, d: 4.5, h: 5, destructible: true, bombOnly: false, hp: 100 },
      { id: 'fuel_2', type: 'fueltank', variant: 'fuel_tank_horizontal', label: 'Fuel tank', x: 77.5, z: 23.5, rot: deg(-10), w: 11, d: 4.5, h: 5, destructible: true, bombOnly: false, hp: 100 },
      // M17 (feat/missions m17_before_dawn: camp('fuel_tank', 'fueltank', 'fuel_tank_elevated', C(33.7, 25), 5, 3, 6, {block: 2}))
      { id: 'fuel_tank', type: 'fueltank', variant: 'fuel_tank_elevated', label: 'Fuel tanks', x: M17.x, z: M17.z, rot: M17.rot, w: 5, d: 3, h: 6, block: 2,
        destructible: true, hp: 100 },
      // M11 (feat/missions m11_in_the_soup: tank_w1-3 (16, 87) (22, 82) (28, 76) → +56, −24; q1/q2 (68, 35) (73.5, 29.8) → +24, +40)
      wTank('tank_w1', 72, 63), wTank('tank_w2', 78, 58), wTank('tank_w3', 84, 52),
      qTank('tank_q1', 92, 75), qTank('tank_q2', 97.5, 69.8),
    ],
    ladders: [
      { id: 'ladder_b', x: 26, z: 26.5, y: 0, top: [26, 24.8, TANK_DECK_Y], raised: false, heading: deg(270) },
      { id: 'ladder_a', x: 36, z: 19, y: 0, top: [36, 17.5, TANK_DECK_Y], raised: false, heading: deg(270) },
    ],
    commandos: [
      { role: 'sapper', x: 24, z: 30, heading: deg(270), inventory: { pistol: 1, timeBomb: 3, grenade: 2 } },
      { role: 'greenberet', x: 50, z: 45, heading: deg(270), inventory: { knife: 1, pistol: 1 } },
    ],
    enemies: [
      { id: 'deck_guard', soldierType: 'soldier', x: 22, z: 21, heading: deg(90) },
      { id: 'yard_guard', soldierType: 'soldier', x: 18, z: 30, heading: deg(0) },
      { id: 'quay_guard', soldierType: 'soldier', x: 70, z: 28, heading: deg(0) },
    ],
    objectives: [{ id: 'o1', text: 'Destroy the M8 tanks', type: 'destroy', targets: ['tank_a', 'tank_b'], required: true }],
    briefing: { text: 'Dev map: the fuel-tank family.' },
  };
}

export default tankYard('desert');
