/**
 * Green Beret: Tiny (design-spec §3.4) — owned by ABILITIES. Knife: abilities/knife.js; carrying bodies and
 * barrels (and hiding a body under a barrel): the hand (abilities/shared.js).
 *   decoyDrop   Q  plant the acoustic decoy at his feet (0.8 s); the activator replaces it in the knapsack
 *   decoyToggle I  beeping on/off from anywhere; a decoy noise every 1.5 s while on (each pulse is a stimulus)
 *   shovel      F  SNOW/SAND only (M1–M11 kit): dig 2.0 s → buried (hidden); F / right-click rises in 1.0 s.
 *                  Witness rule: enemies whose cone held him during the dig keep seeing him (near band).
 *   climb       (axe cursor) click near a climbable edge (mission climb link): he walks to the base and climbs
 *                  (0.5 m/s); right-click mid-climb hangs. Cannot climb while carrying.
 * @module abilities/greenberet
 */

import * as THREE from 'three';
import { registerAbility } from './registry.js';
import { CONFIG } from '../config.js';
import { T } from '../world/grid.js';
import { timedTask, freeToAct } from './common.js';
import { Decoy } from './charges.js';
import { witnessesOf } from './system.js';

const A = CONFIG.abilities;

registerAbility({
  id: 'decoyDrop', label: 'Decoy', icon: '📻', hotkey: 'q', roles: ['greenberet'], item: 'decoy', targeting: 'self',
  order: 40, visibleToEnemies: true,
  canUse(c) {
    const f = freeToAct(c);
    if (f !== true) return f;
    if (c.stance === 'swim' || c.stance === 'dive') return 'Not in the water.';
    return true;
  },
  start(c, t, world) {
    c.playAction('plant', A.decoyPlant);
    return timedTask({ dur: A.decoyPlant, steps: [{ at: A.decoyPlant, fn: () => {
      if (!c.has('decoy')) return false;
      c.loseItem('decoy');
      c.decoy = world.add(new Decoy({ x: c.x + Math.cos(c.heading) * 0.4, z: c.z + Math.sin(c.heading) * 0.4, owner: c }));
      c.gainItem('decoyActivator', 1);
      return true;
    } }] });
  },
});

/** The decoy planted by `c`, if any. */
export function decoyOf(world, c) {
  if (c.decoy && !c.decoy.removed) return c.decoy;
  return world.interactables.find((d) => d.interactKind === 'decoy' && !d.removed && d.planter === c) || null;
}

registerAbility({
  id: 'decoyToggle', label: 'Decoy on/off', icon: '📶', hotkey: 'i', roles: ['greenberet'], item: 'decoyActivator', targeting: 'none',
  order: 41, visibleToEnemies: false, noiseRadius: CONFIG.stealth.noise.decoy.radius, noiseKind: 'decoy',
  canUse: (c, t, world) => (decoyOf(world, c) ? true : 'No decoy planted.'),
  start(c, t, world) {
    const d = decoyOf(world, c);
    d.setOn(!d.on);
    return null; // instant, by radio, from anywhere
  },
});

/** Burial mound decal (placeholder mesh; art may replace it). */
function mound(x, z, snow) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 6), new THREE.MeshStandardMaterial({ color: snow ? 0xe8ecef : 0xc8b27a, roughness: 1 }));
  m.scale.set(1, 0.18, 0.7);
  m.position.set(x, 0.02, z);
  m.name = 'mound';
  return m;
}

registerAbility({
  id: 'shovel', label: 'Shovel', icon: '⛏', hotkey: 'f', roles: ['greenberet'], item: 'shovel', targeting: 'self',
  order: 42, visibleToEnemies: true,
  canUse(c, t, world) {
    if (c.buried) return true; // rise
    const f = freeToAct(c);
    if (f !== true) return f;
    if (c.carrying) return 'Drop it first.';
    const g = world.groundAt(c.x, c.z);
    if (g.bridge || (g.terrainCode !== T.SNOW && g.terrainCode !== T.SAND)) return 'Only in snow or sand.';
    return true;
  },
  start(c, t, world) {
    if (c.buried) {
      c.playAction('use', A.rise);
      return timedTask({ dur: A.rise, steps: [{ at: A.rise, fn: () => {
        c.buried = false;
        c.state = 'active';
        c.witnesses = null;
        if (c.object3d) c.object3d.visible = true;
        if (c._mound) { world.scene?.remove(c._mound); c._mound = null; }
        return true;
      } }] });
    }
    const seen = new Set();
    const snow = world.groundAt(c.x, c.z).terrainCode === T.SNOW;
    c.playAction('use', A.dig);
    return timedTask({
      dur: A.dig,
      tick: () => { for (const e of witnessesOf(world, c)) seen.add(e); },
      steps: [{ at: A.dig, fn: () => {
        for (const e of witnessesOf(world, c)) seen.add(e);
        c.stop();
        c.setStance('stand');
        c.buried = true;
        c.state = 'hidden';
        c.witnesses = seen; // §3.4 witness rule (perception reads unit.witnesses)
        if (c.object3d) c.object3d.visible = false;
        c._mound = mound(c.x, c.z, snow);
        world.scene?.add(c._mound);
        return true;
      } }],
    });
  },
});

/** Nearest enabled climb link endpoint to (x, z) within 2.5 m that `role` may use: {link, from, to}. */
export function climbLinkNear(world, x, z, role = 'greenberet') {
  let best = null, bd = 2.5;
  for (const l of world.grid.links) {
    if (l.kind !== 'climb' || !world.grid.linkAllowed(l, role)) continue;
    for (const [p, q] of [[l.a, l.b], [l.b, l.a]]) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = { link: l, to: p, from: q }; }
    }
  }
  return best;
}

registerAbility({
  id: 'climb', label: 'Climb', icon: '🧗', hotkey: null, roles: ['greenberet'], targeting: 'point', cursor: 'axe',
  order: 43, visibleToEnemies: true, range: 1e9, // walking is the climb itself (path through the link)
  canUse(c, t, world) {
    const f = freeToAct(c);
    if (f !== true) return f;
    if (c.carrying) return "Can't climb while carrying.";
    if (!t || !climbLinkNear(world, t.x, t.z, c.role)) return 'Nothing to climb there.';
    return true;
  },
  start(c, t, world) {
    const hit = climbLinkNear(world, t.x, t.z, c.role);
    // the clicked end is the destination; walking there uses the link (Commando.speed: 0.5 m/s on the link)
    c.hanging = false;
    if (!c.moveTo(hit.to.x, hit.to.z)) return null;
    return null;
  },
});
