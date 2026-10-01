/**
 * Set-piece base class + shared helpers (see setpieces.js). Owned by MISSIONS.
 * @module missions/setpiece-base
 */

import { Entity } from '../entities/entity.js';

/** type → SetPiece subclass. */
export const SETPIECE_TYPES = {};

/** Register a set-piece type (backwards-compatible extension point). */
export function registerSetpiece(type, cls) {
  SETPIECE_TYPES[type] = cls;
  return cls;
}

/** Point-in-polygon ([[x,z],...] or [{x,z}]). */
export function inPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    const ax = a.x ?? a[0], az = a.z ?? a[1], bx = b.x ?? b[0], bz = b.z ?? b[1];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

/** Area test for a spec shape: {poly} | {x,z,r} | {rect:{x,z,w,d}} (axis-aligned, min corner). */
export function inArea(a, x, z) {
  if (!a) return false;
  if (a.poly) return inPoly(a.poly, x, z);
  if (a.rect) return x >= a.rect.x && x <= a.rect.x + a.rect.w && z >= a.rect.z && z <= a.rect.z + a.rect.d;
  if (a.r != null) return Math.hypot(x - a.x, z - a.z) <= a.r;
  return false;
}

export const P = (p) => (p == null ? null : Array.isArray(p) ? { x: p[0], z: p[1], y: p[2] ?? 0 } : { x: p.x, z: p.z, y: p.y ?? 0 });

/** Base class: override init() (lazy, once), tick(dt20), save()/load(state). */
export class SetPiece extends Entity {
  constructor(spec) {
    const c = P(spec.at || spec) || { x: 0, z: 0 };
    super({ kind: 'setpiece', x: c.x ?? 0, z: c.z ?? 0, tag: spec.id ?? null });
    this.type = spec.type;
    this.spec = spec;
    this.inited = false;
  }
  /** The director (world.setpieces). */
  get director() { return this.world?.setpieces; }
  /** Map-build time (deterministic entity ids): create devices, write static grid cells. */
  build(world, opts) {} // eslint-disable-line no-unused-vars
  /** First 20 Hz tick (units and vehicles exist): resolve ids, initial state. */
  init() {}
  tick(dt) {} // eslint-disable-line no-unused-vars
  save() { return {}; }
  load(s) {} // eslint-disable-line no-unused-vars
  syncTransform() {}
  // a save taken before the director's first tick after a load still carries the loaded state (not build defaults)
  serialize() { return { ...super.serialize(), sp: this._pendingLoad ?? this.save(), inited: this.inited }; }
  deserialize(d) {
    super.deserialize(d);
    this._pendingLoad = d.sp || {};
  }
  /** Emit a message / event helper. */
  say(text, kind = 'info') { this.world?.events.emit('message', { text, kind }); }
}

