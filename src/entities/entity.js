/**
 * Entity — base class of everything that lives in the World (units, vehicles, projectiles,
 * interactables, props). Holds the simulation transform; `object3d` is the render proxy.
 *
 * Render interpolation: the Game calls `savePrev()` at the start of every tick and
 * `syncTransform(alpha)` every frame, so motion is smooth at any display refresh rate.
 * @module entities/entity
 */

import { headingToRotY, lerpAngle } from '../core/math.js';

export class Entity {
  /** Next numeric id. Reset to 1 by the Game on every mission load (deterministic ids for saves). */
  static nextId = 1;

  /**
   * @param {object} [opts]
   * @param {string} [opts.kind] 'commando'|'enemy'|'vehicle'|'projectile'|'interactable'|'prop'
   * @param {number} [opts.x]
   * @param {number} [opts.z]
   * @param {number} [opts.y]
   * @param {number} [opts.heading] radians (0 = east, π/2 = south)
   * @param {string} [opts.tag] mission-data id (e.g. 'e_officer'); world.byId() accepts it
   */
  constructor({ kind = 'prop', x = 0, z = 0, y = 0, heading = 0, tag = null } = {}) {
    this.id = Entity.nextId++;
    this.kind = kind;
    this.tag = tag;
    /** @type {import('../world/world.js').World|null} */
    this.world = null;
    this.x = x;
    this.z = z;
    this.y = y;
    this.heading = heading;
    this.alive = true;
    this.removed = false;
    /** @type {import('three').Object3D|null} */
    this.object3d = null;
    this.prevX = x;
    this.prevZ = z;
    this.prevY = y;
    this.prevHeading = heading;
  }

  /** Simulation update (fixed step). */
  update(dt) {} // eslint-disable-line no-unused-vars

  /** Remember the pre-tick transform for render interpolation. */
  savePrev() {
    this.prevX = this.x;
    this.prevZ = this.z;
    this.prevY = this.y;
    this.prevHeading = this.heading;
  }

  /** Snap the interpolation history (after teleports / loads). */
  snap() {
    this.savePrev();
    this.syncTransform(1);
  }

  /**
   * Copy the (interpolated) simulation transform to object3d.
   * @param {number} [alpha=1] 0 = previous tick, 1 = current tick
   */
  syncTransform(alpha = 1) {
    const o = this.object3d;
    if (!o) return;
    const a = alpha;
    const x = this.prevX + (this.x - this.prevX) * a, z = this.prevZ + (this.z - this.prevZ) * a;
    // visual ground relief (final terrain undulation; 0 over water and flat under structures): meshes only
    const gy = this.world?.groundY ? this.world.groundY(x, z) : 0;
    o.position.set(x, this.prevY + (this.y - this.prevY) * a + gy, z);
    o.rotation.y = headingToRotY(lerpAngle(this.prevHeading, this.heading, a));
  }

  /** Teleport (no interpolation smear). */
  setPosition(x, z, heading = this.heading) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.snap();
  }

  /** Release GPU resources owned by this entity. */
  dispose() {
    const o = this.object3d;
    if (!o) return;
    o.traverse?.((c) => {
      if (c.geometry && !c.geometry.userData?.shared) c.geometry.dispose();
      const mats = Array.isArray(c.material) ? c.material : c.material ? [c.material] : [];
      for (const m of mats) if (!m.userData?.shared) m.dispose();
    });
  }

  /** Plain JSON snapshot (extend in subclasses: `return { ...super.serialize(), … }`). */
  serialize() {
    return { id: this.id, tag: this.tag, kind: this.kind, x: this.x, z: this.z, y: this.y, heading: this.heading, alive: this.alive };
  }

  /** Restore from serialize() output. */
  deserialize(d) {
    this.x = d.x;
    this.z = d.z;
    this.y = d.y ?? 0;
    this.heading = d.heading;
    this.alive = d.alive;
    this.snap();
  }
}
