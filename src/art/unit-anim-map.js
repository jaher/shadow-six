/**
 * Gameplay → character-library mapping (pure data + functions, no three.js): which clip plays for a gameplay
 * animation name (docs/ARCHITECTURE.md model contract), which weapon prop a commando holds for an action, which enemy
 * look a spawn gets per theater, which guest body a guest role uses. Used by art/unit-model.js; unit-tested in node.
 * @module art/unit-anim-map
 */

/** Clip candidates (first one the character has wins) per gameplay name, for humans. */
const HUMAN = {
  idle: ['idle'], walk: ['walk'], run: ['run'], crawl_idle: ['crawl_idle'], crawl: ['crawl'], swim: ['swim', 'swim_idle'],
  dive: ['dive', 'swim'], aim: ['aim'], shoot: ['shoot'], stab: ['stab'], throw: ['throw'], punch: ['punch'],
  plant: ['plant'], climb: ['climb'], carry_idle: ['carry_idle'], carry_walk: ['carry_walk'], die: ['die'], dead: ['dead'],
  surrender: ['surrender', 'handsup_held'], salute: ['salute'], look_around: ['look_around', 'idle'], use: ['use'],
};
/** Dogs (dogkit clips: idle walk sniff_walk trot run sniff bark attack die dead sit). */
const DOG = {
  idle: ['idle'], walk: ['walk'], run: ['run'], crawl: ['sniff_walk'], crawl_idle: ['sit'], aim: ['bark'], shoot: ['bark'],
  punch: ['attack'], stab: ['attack'], die: ['die'], dead: ['dead'], look_around: ['sniff'], use: ['sniff'],
};
/** Locomotion names whose playback rate follows the unit's ground speed (feet planted). */
export const LOCOMOTION = new Set(['walk', 'run', 'crawl', 'swim', 'dive', 'carry_walk']);

const LONG = new Set(['kar98k', 'no4_sniper', 'harpoon_gun', 'mg34', 'mg42']);
const SMG = new Set(['thompson', 'mp40']);
const PISTOLS = new Set(['colt1911', 'walther_p38', 'luger']);
/** Carry class of a weapon prop: long | smg | pistol | knife | none (docs/crawl-animation.md §3.5). */
export function weaponClass(name) {
  return LONG.has(name) ? 'long' : SMG.has(name) ? 'smg' : PISTOLS.has(name) ? 'pistol' : name === 'knife' ? 'knife' : 'none';
}
/**
 * Prone clip candidates (stance 'crawl'): the low crawl / prone idle per carry class (a pistol stays holstered, so
 * pistol carriers crawl unarmed), prone aim and shoot per weapon, prone death.
 */
function proneAnim(name, wc, c) {
  const gun = wc === 'long' || wc === 'smg';
  switch (name) {
    case 'crawl': return gun ? ['crawl'] : wc === 'knife' ? ['crawl_knife', 'crawl_unarmed', 'crawl'] : ['crawl_unarmed', 'crawl'];
    case 'crawl_idle': case 'idle': case 'look_around': return gun ? ['crawl_idle'] : ['crawl_idle_unarmed', 'crawl_idle'];
    case 'aim': return wc === 'pistol' ? ['prone_pistol_aim', 'crawl_idle_unarmed', 'crawl_idle'] : gun ? ['prone_aim', 'crawl_idle'] : ['crawl_idle_unarmed', 'crawl_idle'];
    case 'shoot':
      if (wc === 'pistol') return ['prone_pistol_shoot', 'prone_pistol_aim', 'crawl_idle'];
      if (wc === 'smg') return ['prone_shoot_smg', 'prone_aim', 'crawl_idle'];
      return gun ? ['prone_shoot', 'prone_aim', 'crawl_idle'] : ['crawl_idle_unarmed', 'crawl_idle'];
    case 'die': return ['die_prone', 'die'];
    case 'dead': return ['dead_prone', 'dead'];
    default: return null;
  }
}

/**
 * Clip candidates for a gameplay animation.
 * @param {string} name gameplay name (ARCHITECTURE contract)
 * @param {{dog?:boolean, faction?:string, role?:string, actionId?:string|null, stance?:string, carried?:boolean,
 *   weapon?:string|null, weaponClass?:string}} [c] weapon: prop in hand (prone clips follow its carry class)
 * @returns {string[]} ordered candidates; the caller plays the first the character has (else 'idle')
 */
export function mapAnim(name, c = {}) {
  if (c.dog) return DOG[name] || ['idle'];
  if (c.carried && (name === 'dead' || name === 'die')) return ['carried', 'dead'];
  const a = c.actionId || null;
  const prone = c.stance === 'crawl';
  if (prone) { const p = proneAnim(name, c.weaponClass || weaponClass(c.weapon), c); if (p) return p; }
  switch (name) {
    case 'die': return ['die'];
    case 'dead': return ['dead'];
    case 'stab': return a === 'syringe' ? ['syringe', 'stab'] : ['stab'];
    case 'plant': return a === 'trap' ? ['set_trap', 'plant'] : a === 'decoyDrop' ? ['pickup', 'plant'] : ['plant'];
    case 'shoot': return c.role === 'sniper' && a === 'sniper' ? ['kneel_shoot', 'shoot'] : ['shoot'];
    case 'use':
      if (c.faction === 'enemy') return ['crouch_idle', 'use'];   // body check kneel (enemy-brain 'kneel' phase)
      if (a === 'shovel') return ['dig', 'bury', 'use'];
      if (a === 'uniform') return ['change_clothes', 'use'];
      if (a === 'cutters') return ['cut_wire', 'use'];
      if (a === 'enterVehicle' || a === 'leaveVehicle') return ['open', 'use'];
      if (a === 'detonate') return ['detonate', 'use'];
      return ['use'];
    default: return HUMAN[name] || [name, 'idle'];
  }
}

/** The pistol each commando draws (BEL: every commando carries one). */
const PISTOL = { spy: 'walther_p38', sapper: 'walther_p38', default: 'colt1911' };
/** Weapon a commando carries when no action asks for another (humanoid-real DEFAULT_WEAPON keys by character). */
export const CARRY_WEAPON = { greenberet: 'colt1911', sniper: 'no4_sniper', diver: 'harpoon_gun', sapper: 'walther_p38',
  driver: 'thompson', spy: 'walther_p38', guest: null };

/**
 * Weapon prop in hand for a commando action (null = keep the carry weapon; false = hands empty).
 * @param {string} role
 * @param {string|null} actionId abilities registry id
 * @returns {string|null|false}
 */
export function actionWeapon(role, actionId) {
  switch (actionId) {
    case 'knife': return 'knife';
    case 'syringe': return 'syringe';
    case 'pistol': return PISTOL[role] || PISTOL.default;
    case 'sniper': return 'no4_sniper';
    case 'smg': return 'thompson';
    case 'harpoon': return 'harpoon_gun';
    case 'grenade': case 'timeBomb': case 'remoteBomb': case 'trap': case 'cutters': case 'shovel': case 'uniform':
    case 'firstAid': case 'decoyDrop': case 'detonate': return false;   // clip-bound props (commandos_b) or empty hands
    default: return null;
  }
}

/** fnv1a 32-bit (same as the character pipeline's variety.js). */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

const LINE = new Set(['soldier', 'sentry', 'rifleman', 'tutorial']);
/**
 * Enemy look (manifest enemyTypes key or alias) for a mission spawn: desert line troops wear the Afrika Korps drill;
 * snow maps dress about half of the line troops in greatcoats / snow smocks (bible §5: Norway winter troops).
 * @param {{id?:string, soldierType?:string}} spawn
 * @param {string} theater mission theater ('temperate' | 'snow' | 'desert' | …)
 * @param {string|number} missionId
 */
export function lookType(spawn, theater, missionId) {
  const t = spawn.soldierType || 'soldier';
  if (!LINE.has(t)) return t;
  if (theater === 'desert') return 'afrika';
  if (theater === 'snow' || theater === 'winter') return fnv1a(`${missionId}:${spawn.id}:coat`) % 100 < 50 ? 'winter' : t;
  return t;
}

const GUESTS = ['mcrae', 'informer', 'gilbert', 'civ_tram_driver', 'prisoner_worker', 'prisoner_clerk', 'prisoner_farmhand', 'prisoner_oldman'];
const PRISONERS = GUESTS.filter((g) => g.startsWith('prisoner_'));
/**
 * Guest body for a guest id (McRae, the Informer, Gilbert, the tram driver; any other → one of the 4 prisoners, seeded).
 * @param {string|null} guestId
 */
export function guestCharacter(guestId) {
  const g = String(guestId || '').toLowerCase();
  const hit = GUESTS.find((k) => g === k || g.includes(k.replace('civ_', '').replace('prisoner_', '')));
  if (hit && !PRISONERS.includes(hit)) return hit;
  if (/tram/.test(g)) return 'civ_tram_driver';
  return hit || PRISONERS[fnv1a(g) % PRISONERS.length];
}

/** Mission number from a mission id ('m08' → 8, 'm12_x' → 12); 0 when none. */
export function missionNumber(id) {
  const m = String(id ?? '').match(/(\d+)/);
  return m ? +m[1] : 0;
}
