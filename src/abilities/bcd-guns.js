/**
 * BCD firearms and Natasha's kit (docs/bcd-plan.md §1.7, §1.8) — `campaigns: ['BCD']`, never under BEL:
 *   rifle     E  Driver's Lee-Enfield: 27 m hitscan, one shot kills, 0.6 s aim, 2.5 s bolt reload, pistol-loud
 *                (18 m); hidden count 50 (HUD shows ∞). CONFIG.weapons.leeEnfield.
 *   beretta   Q  Natasha's Beretta 1935: the BEL pistol's stats and rules.
 *   lipstick  D  Natasha: any rank but the Gestapo stares at her; his cone follows her until she leaves his far
 *                band, is attacked, or the player right-clicks her (ai/bcd-reactions.startLipstick).
 * The SMG keeps its BEL def; only its key moves to W through `rules.hotkeys` (§2).
 * @module abilities/bcd-guns
 */

import { registerAbility, ABILITIES } from './registry.js';
import { CONFIG, KILL } from '../config.js';
import { timedTask, freeToAct, inReach, bark } from './common.js';
import { fireBullet, shotClear } from './weapons.js';
import { startLipstick } from '../ai/bcd-reactions.js';
import { distractable } from '../ai/bcd-ranks.js';

const BCD = ['BCD'];
const LE = CONFIG.weapons.leeEnfield;

registerAbility({
  id: 'rifle', label: 'Lee-Enfield', icon: '🎯', hotkey: null, roles: ['driver'], item: 'leeEnfield',
  targeting: 'enemy', cursor: 'crosshair', order: 21, campaigns: BCD, ranged: true, range: LE.range,
  noiseRadius: LE.noise, noiseKind: 'pistol', visibleToEnemies: true,
  canUse(c, t, world) {
    if (!world.rules?.driverRifle) return 'Not in this campaign.';
    const f = c.state === 'inVehicle' ? 'Get out first.' : freeToAct(c);
    if (f !== true) return f;
    if (c.stance === 'swim' || c.stance === 'dive') return 'Not from the water.';
    if (!t || t.kind !== 'enemy' || !t.alive) return 'Pick an enemy.';
    if (t.covered || t.vehicle?.def?.armored) return "Can't hit him in there.";
    if (world.time < (c._rifleT ?? -1)) return 'Reloading.';
    return inReach(world, c, t, LE.range, true);
  },
  start(c, t, world) {
    c.playAction('aim', LE.aim);
    return timedTask({
      dur: LE.aim + 0.1,
      steps: [{ at: LE.aim, fn: () => {
        if (!t.alive || Math.hypot(t.x - c.x, t.z - c.z) > LE.range + 0.3 || !shotClear(world, c, t)) return false;
        if (!c.consume('leeEnfield')) { bark(world, c, 'cant_noammo'); return false; }
        c.faceTowards(t.x, t.z);
        c.playAction('shoot', 0.3);
        fireBullet(world, c, t, KILL, 'leeEnfield', 'rifle');
        world.emitNoise(c.x, c.z, LE.noise, 'pistol', c); // §1.7: as loud as the pistol
        c._rifleT = world.time + LE.reload; // bolt work
        return true;
      } }],
    });
  },
});

// Natasha's Beretta: the BEL pistol def, bound to her own item (the BEL pistol def is left untouched)
{
  const P = ABILITIES.pistol;
  registerAbility({
    ...P, id: 'beretta', label: 'Beretta 1935', hotkey: null, roles: ['natasha'], item: 'beretta', campaigns: BCD, group: 'pistol',
  });
}

registerAbility({
  id: 'lipstick', label: 'Lipstick', icon: '💄', hotkey: null, roles: ['natasha'], item: 'lipstick', targeting: 'enemy',
  cursor: 'talk', order: 12, campaigns: BCD, range: CONFIG.bcd.lipstick.range, visibleToEnemies: false,
  canUse(c, t, world) {
    if (!world.rules?.guests) return 'Not in this campaign.';
    const f = freeToAct(c);
    if (f !== true) return f;
    if (!t || t.kind !== 'enemy' || !t.alive || t.incapacitated) return 'Pick a soldier.';
    if (!distractable(t, world)) return 'He is not fooled.'; // Gestapo (§1.8), animals
    if (c.disguised === false) return 'My cover is blown.';
    if (t.brain?.isAware?.()) return 'He is on to us.';
    return true;
  },
  start(c, t, world) {
    return timedTask({ dur: 0.3, steps: [{ at: 0.3, fn: () => startLipstick(t, c, world) }] });
  },
});

// Guests' hand (§1.8: "the ordinary selection, move, crouch and hand controls"): the BEL hand def for Natasha
// and Skopje — they take cigarette packs from the ground and from bodies, never carry anything (items.canPickUp).
{
  const H = ABILITIES.hand;
  registerAbility({ ...H, id: 'handGuest', hotkey: null, roles: ['natasha', 'skopje'], campaigns: BCD });
}
