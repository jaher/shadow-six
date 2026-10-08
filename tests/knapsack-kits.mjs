/**
 * Every knapsack a player can see (tests/unit/knapsack-layout.test.mjs, tests/knapsack-layout.test.mjs): each commando's
 * starting kit in every mission (BEL M1–M20, the sandboxes, the BCD sandbox; the BEL first-aid rule as game.js
 * _spawnUnits applies it), the kits a mission changes in play (the Spy in a uniform, the Sapper's remote bombs armed,
 * the Green Beret's decoy out, charges taken back, a buried Green Beret's DIG OUT shovel), the BCD role kits with every
 * BCD item, the largest counts, and every pair selected together (the knapsack shows what both carry).
 */
import { MISSIONS } from '../src/missions/index.js';
import { normalizeMission } from '../src/missions/schema.js';
import { spawnInventory, firstAidCarrier, defaultInventory, FIRST_AID_DOSES, BCD_KIT, FIXED_KIT } from '../src/items.js';

/** @typedef {{role: string, inv: Record<string, number>, state?: object}} KitUnit */
/** @typedef {{name: string, campaign: string, units: KitUnit[]}} Kit */

const key = (k) => `${k.campaign}|${k.units.map((u) => `${u.role}:${JSON.stringify(Object.entries(u.inv).sort())}:${JSON.stringify(u.state || {})}`).join('+')}`;

/** @returns {Kit[]} distinct kits, single men first, then pairs */
export function knapsackKits({ pairs = true } = {}) {
  const out = new Map();
  const add = (k) => { if (k.units.every((u) => Object.keys(u.inv).length) && !out.has(key(k))) out.set(key(k), k); };
  const missions = [];
  for (const raw of MISSIONS) {
    let def;
    try { def = normalizeMission(raw); } catch { continue; }
    const campaign = def.campaign || 'BEL';
    const roles = (def.commandos || []).map((c) => c.role);
    const medic = firstAidCarrier(roles);
    const men = [];
    for (const s of def.commandos || []) {
      let inv = s.inventory ? { ...s.inventory } : undefined;
      if (s.role === medic && inv?.firstAid === undefined && def.firstAid !== false) inv = { ...(inv || defaultInventory(s.role)), firstAid: FIRST_AID_DOSES };
      const u = { role: s.role, inv: spawnInventory(s.role, inv, campaign) };
      men.push(u);
      add({ name: `${def.id} ${s.role}`, campaign, units: [u] });
    }
    missions.push({ id: def.id, campaign, men });
  }
  const singles = [...out.values()];
  // in play: the Spy in a German uniform, the Sapper's charges back in the bag (+1), remote bombs armed (detonator),
  // the decoy on the ground (activator), a buried Green Beret (DIG OUT shovel)
  for (const k of singles) {
    const u = k.units[0], inv = u.inv;
    if (u.role === 'spy') add({ name: `${k.name} + uniform`, campaign: k.campaign, units: [{ ...u, inv: { ...inv, uniform: 1 }, state: { disguised: true } }] });
    if (inv.timeBomb) add({ name: `${k.name} + charge taken back`, campaign: k.campaign, units: [{ ...u, inv: { ...inv, timeBomb: inv.timeBomb + 1 } }] });
    if (inv.remoteBomb) add({ name: `${k.name} remote armed`, campaign: k.campaign, units: [{ ...u, state: { remoteArmed: 1 } }] });
    if (inv.decoy) add({ name: `${k.name} decoy out`, campaign: k.campaign, units: [{ ...u, state: { decoyPlaced: true } }] });
    if (inv.shovel) add({ name: `${k.name} buried`, campaign: k.campaign, units: [{ ...u, state: { buried: true } }] });
  }
  // BCD role kits with every BCD item a man can be handed (bcd-plan §1.5-§1.8), and the largest counts
  const bcd = { cigarettes: 3, knuckles: 1, blackjack: 1, chloroform: 1, climbAxe: 1 };
  for (const role of Object.keys(FIXED_KIT)) {
    add({ name: `BCD ${role} full`, campaign: 'BCD', units: [{ role, inv: spawnInventory(role, { ...FIXED_KIT[role], ...BCD_KIT[role], ...bcd }, 'BCD') }] });
  }
  add({ name: 'BCD natasha', campaign: 'BCD', units: [{ role: 'natasha', inv: spawnInventory('natasha', { ...BCD_KIT.natasha }, 'BCD') }] });
  add({ name: 'sniper 12 rounds + first aid', campaign: 'BEL', units: [{ role: 'sniper', inv: { pistol: 1, sniperRifle: 12, firstAid: 6 } }] });
  add({ name: 'sapper 8 grenades 8 charges', campaign: 'BEL', units: [{ role: 'sapper', inv: { pistol: 1, bearTrap: 1, grenade: 8, timeBomb: 8, wireCutters: 1 } }] });
  add({ name: 'sapper 8 remote', campaign: 'BEL', units: [{ role: 'sapper', inv: { pistol: 1, bearTrap: 1, grenade: 8, remoteBomb: 8, detonator: 1 } }] });
  add({ name: 'driver 120 smg + first aid', campaign: 'BEL', units: [{ role: 'driver', inv: { pistol: 1, smg: 120, firstAid: 6 } }] });
  // the kit of the close-up the report came from (docs: icons-hd iPhone sheet): six items, the rounds under the rifle
  add({ name: 'reported close-up kit', campaign: 'BEL', units: [{ role: 'greenberet', inv: { knife: 1, pistol: 1, decoy: 1, shovel: 1, grenade: 3, sniperRifle: 5 } }] });
  add({ name: 'diver all kit', campaign: 'BEL', units: [{ role: 'diver', inv: { knife: 1, harpoon: 1, pistol: 1, divingGear: 1, inflatableBoat: 1 } }] });
  if (pairs) {
    for (const m of missions) {
      for (let a = 0; a < m.men.length; a++) for (let b = a + 1; b < m.men.length; b++) {
        add({ name: `${m.id} ${m.men[a].role}+${m.men[b].role}`, campaign: m.campaign, units: [m.men[a], m.men[b]] });
      }
    }
  }
  return [...out.values()];
}
