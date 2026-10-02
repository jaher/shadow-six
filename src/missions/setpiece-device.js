/**
 * Generic hand-operated device for set-pieces (MISSIONS): an Interactable of interactKind 'device' that the
 * shared 'use' ability (Hand / lever cursor) operates. Behaviour comes from hooks passed by the owning
 * set-piece: `onUse(commando, device) → bool|void`, `canUseFn(commando, device) → true|reason`.
 * Emits `device {id, sfx, x, z, on}` on every use (audio, AI "door seen used"). Placeholder mesh: a post
 * with a lever box (optional `light: true` adds a red lamp; `blink` makes it flash, §7.1 M20).
 * @module missions/setpiece-device
 */

import * as THREE from 'three';
import { dressingMaterial } from '../art/dressing.js';
import { Interactable, ACTIVATABLE } from '../entities/interactables.js';

ACTIVATABLE.add('device');

function deviceMesh(x, z, light) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.3, 0.25), dressingMaterial('creosote'));
  post.position.y = 0.65;
  g.add(post);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.35, 0.3), dressingMaterial('steel'));
  box.position.y = 1.2;
  g.add(box);
  let lamp = null;
  if (light) {
    lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshStandardMaterial({ color: 0x551010, emissive: 0xff2010, emissiveIntensity: 1 }));
    lamp.position.y = 1.55;
    g.add(lamp);
  }
  g.userData.lamp = lamp;
  return g;
}

export class Device extends Interactable {
  /**
   * @param {object} o {x, z, id?, label?, sfx?, activation?, roles?, on?, light?, blink?, onUse?, canUseFn?, meshes?}
   */
  constructor(o) {
    super({ ...o, interactKind: 'device', object3d: o.meshes === false ? null : deviceMesh(o.x, o.z, o.light || o.blink) });
    this.label = o.label ?? 'Device';
    this.blink = !!o.blink;
    this._blinkT = 0;
  }
  get displayName() { return this.label; }
  canUse(c) {
    if (this.destroyed || this.removed) return 'Nothing there.';
    if (this.roles && !this.roles.includes(c?.role)) return "Can't use that.";
    return this.params.canUseFn ? this.params.canUseFn(c, this) : true;
  }
  interact(c) {
    const r = this.params.onUse ? this.params.onUse(c, this) : undefined;
    if (r === false) return false;
    this.world?.events.emit('device', { id: this.tag ?? this.id, sfx: this.params.sfx || 'switch_throw', x: this.x, z: this.z, on: this.on });
    return true;
  }
  update(dt) {
    if (!this.blink) return;
    this._blinkT += dt;
    const lamp = this.object3d?.userData.lamp;
    if (lamp) lamp.material.emissiveIntensity = Math.floor(this._blinkT * 2) % 2 ? 0.1 : 1.5;
  }
}

/** Create + add a device for a set-piece. */
export function addDevice(world, o) {
  const d = new Device({ meshes: !!world.scene && world._spMeshes !== false, ...o });
  world.add(d);
  return d;
}
