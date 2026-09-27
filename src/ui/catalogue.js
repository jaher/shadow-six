/**
 * Display catalogue of the BEL campaign (design-spec §7.1) for the mission-select and briefing screens.
 * Gameplay data lives in the mission defs (MISSIONS team); this is only what the menus show before a mission
 * is authored: number, title, place, date, a rough map position for the briefing's Europe map, and a short
 * historical context written by us (never copied from the original game).
 * @module ui/catalogue
 */

/** [n, title, place, date, lat, lon, context] */
const ROWS = [
  [1, 'Baptism of Fire', 'Sola, near Stavanger, Norway', 'Feb 20, 1941', 58.9, 5.6, 'Norway has been occupied for ten months. A relay station on the coast carries German signals traffic between the airfields. Knock it out and the Luftwaffe loses its ears for the spring.'],
  [2, 'A Quiet Blow-Up', 'Stamsund, Lofoten, Norway', 'Mar 1, 1941', 68.1, 13.8, 'The Lofoten fish-oil plants and the fuel stored beside them keep the occupation fed and moving. A small team goes in ahead of the main raid.'],
  [3, 'Reverse Engineering', 'Sysendam, Eidfjord, Norway', 'Mar 4, 1941', 60.4, 7.3, 'Power from the Sysen dam feeds industry the Reich depends on. Its surveillance bunker and the dam itself must go down together.'],
  [4, 'Restore Pride', 'Stokkan, near Trondheim, Norway', 'Mar 10, 1941', 63.4, 10.4, 'A regional headquarters in a requisitioned villa coordinates the hunt for the resistance. Destroying it will buy the partisans months.'],
  [5, 'Blind Justice', 'Herdla, Norway', 'May 2, 1941', 60.6, 4.95, 'A radar on the island summit watches the North Sea approaches. Blind it and the convoys can pass.'],
  [6, 'Menace of the Leopold', 'Masi, Norway', 'May 10, 1941', 69.4, 23.7, 'A railway gun shells the northern valleys from a camp in the tundra. It must never fire again.'],
  [7, 'Chase of the Wolves', 'Arendal, Norway', 'Feb 7, 1942', 58.5, 8.8, 'Two U-boats are resting in their pens at Arendal between patrols. Every day they stay afloat costs Atlantic shipping dearly.'],
  [8, 'Pyrotechnics', 'Tell el Eisa, Egypt', 'Oct 19, 1942', 30.85, 28.9, 'Days before the Alamein offensive, a forward fuel dump could keep the Afrika Korps rolling. Set it alight.'],
  [9, 'A Courtesy Call', 'Bab el Qattara, Egypt', 'Oct 20, 1942', 30.2, 28.0, 'A desert command post directs the southern flank. Its communications, stores and bunker are the targets.'],
  [10, 'Operation Icarus', 'El Agheila, Libya', 'Nov 14, 1942', 30.3, 19.2, 'A captured airman holds knowledge the enemy wants. Free him and destroy the bomb store at the airfield.'],
  [11, 'In the Soup', 'Maradah, Libya', 'Dec 3, 1942', 29.2, 19.2, 'Drilling rigs in the oasis are the Axis gamble for local fuel. Put all four out of action.'],
  [12, 'Up on the Roof', 'Tunis, Tunisia', 'Mar 15, 1943', 36.8, 10.2, 'Our informer has been taken. The rooftops of the old city are the only way to reach him.'],
  [13, 'David and Goliath', 'Le Havre, France', 'May 15, 1944', 49.5, 0.1, 'A battleship in the Le Havre locks threatens the invasion fleet. A midget submarine is waiting for a crew.'],
  [14, 'D-Day Kick Off', 'La Rivière, Normandy, France', 'May 25, 1944', 49.33, -0.5, 'Four coastal guns cover the beach where the landings will come ashore. They must be silent before the fleet arrives.'],
  [15, 'The End of the Butcher', 'Compiègne, France', 'Aug 26, 1944', 49.4, 2.8, 'A notorious SS commander is preparing his escape from the town. He must not leave it.'],
  [16, 'Stop Wildfire', 'Maas bridge, Liège, Belgium', 'Sep 4, 1944', 50.6, 5.6, 'Engineers have wired the Maas bridge to blow ahead of the Allied advance. Their detonators must never be reached.'],
  [17, 'Before Dawn', 'Riquewihr, near Colmar, France', 'Nov 28, 1944', 48.1, 7.3, 'Five men of the resistance face execution at first light. Get them out before dawn.'],
  [18, 'The Force of Circumstance', 'Maas bridge, Liège, Belgium', 'Dec 16, 1944', 50.6, 5.6, 'The counter-offensive has begun and the bridge we saved now carries enemy armour. This time it has to fall.'],
  [19, 'Frustrate Retaliation', 'Oldenburg, Germany', 'Jan 12, 1945', 53.1, 8.2, 'Rockets are being readied at a mine near Oldenburg. Destroy the V2s and their launch pads.'],
  [20, 'Operation Valhalla', 'Gundelfingen castle, near Freiburg, Germany', 'Feb 11, 1945', 48.0, 7.85, 'The last great raid: a castle headquarters guarding two V2s. All six men go in together.'],
];

/** @type {{n:number, id:string, title:string, place:string, date:string, lat:number, lon:number, context:string, campaign:'BEL'}[]} */
export const BEL_CATALOGUE = ROWS.map(([n, title, place, date, lat, lon, context]) => ({
  n, id: `m${String(n).padStart(2, '0')}`, title, place, date, lat, lon, context, campaign: 'BEL',
}));

/** Catalogue entry for a mission def or id (matches `mNN` ids, then titles). */
export function catalogueEntry(defOrId) {
  const id = typeof defOrId === 'string' ? defOrId : defOrId?.id;
  const title = typeof defOrId === 'object' ? defOrId?.title : null;
  return BEL_CATALOGUE.find((c) => c.id === id) || (title && BEL_CATALOGUE.find((c) => c.title === title)) || null;
}

/** Campaign tabs for mission select (BCD is locked: built later, ARCHITECTURE "Campaigns & rulesets"). */
export const CAMPAIGN_TABS = [
  { id: 'BEL', label: 'Behind Enemy Lines', locked: false },
  { id: 'BCD', label: 'Beyond the Call of Duty', locked: true, note: 'Coming later' },
];

/** Enemy tooltip labels (§6.4 examples). */
export const ENEMY_LABELS = {
  soldier: 'SOLDIER', officer: 'SERGEANT', sentry: 'SENTRY', sniper: 'SNIPER', mg: 'MACHINE GUNNER',
  tankcrew: 'TANK CREW', driver: 'DRIVER', sapper: 'ENGINEER', general: 'GENERAL', dog: 'DOG',
};

/** Vehicle / structure tooltip labels. */
export const THING_LABELS = {
  truck: 'TRUCK', fuel_truck: 'FUEL TRUCK', car: 'CAR', motorcycle: 'MOTORCYCLE', tank: 'TANK', armoredcar: 'ARMOURED CAR',
  patrolboat: 'PATROL BOAT', raft: 'RAFT', plane: 'AIRCRAFT', mgNest: 'MG NEST', cannon: 'CANNON',
  barrel: 'EXPLOSIVE BARREL', fuelTank: 'FUEL TANK', fuel_tank: 'FUEL TANK', barracks: 'GARRISON', jail: 'PRISON', prison: 'PRISON',
  bunker: 'BUNKER', door: 'DOOR', pickup: 'SUPPLIES', explosiveTarget: 'TARGET', climbable: 'CLIMBABLE', switch: 'SWITCH',
  extraction: 'ESCAPE', house: 'HOUSE', hut: 'HUT',
};

export const ROLE_NAMES = {
  greenberet: 'Green Beret', sniper: 'Sniper', diver: 'Marine', sapper: 'Sapper', driver: 'Driver', spy: 'Spy',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Display form of a mission date (design-spec §6.6 part 1: "Feb 20, 1941"). Parses the authored ISO
 * 'YYYY-MM-DD' by hand so the result never depends on the viewer's locale or time zone; anything else
 * (already-formatted text, empty) passes through unchanged.
 * @param {string} [iso]
 * @returns {string}
 */
export function formatMissionDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim());
  if (!m || +m[2] < 1 || +m[2] > 12) return iso || '';
  return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
}
