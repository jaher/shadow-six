/**
 * Footprints — gameplay side (design-spec §4.8). Owned by AI.
 *
 * Units emit 'footprint' {x, z, heading, t, owner, aiVisible, terrain, foot} every 0.75 m walked / 1.6 m run on
 * SNOW/SAND (and visual-only MUD). This tracker keeps the list: AI-visible prints live CONFIG.stealth.
 * footprint.life (90 s) for the AI; every print (enemy and MUD ones too) is kept for the same time for the
 * trail renderer, whose visual fades over the last `fade` (30) s. `foot` is what made it ('boot', or the animal:
 * footOf). AI-visible = an intruder's: only the player's side (a German's own prints and his guard dog's paw prints
 * never raise TRACKS), as before.
 *
 * Query hooks (render/trail layer, AI):
 *   world.ai.footprints.query(x, z, r)        → AI-visible live prints within r (kind 'footprint')
 *   world.ai.footprints.visible(t?)           → every live print with {alpha} for the trail renderer
 *   world.ai.footprints.trailFrom(print, maxGap) → next newer print of the same owner within maxGap
 *   world.ai.footprints.tracksNear(x, z, r)   → query() annotated with the ground's print `visibility`
 *     (world.terrain.printVisibility: material × age; docs/terrain-pipeline.md §4.4), faint ones dropped
 *   world.ai.footprints.version               → bumps on every add/expiry (renderer cache key)
 * @module ai/footprints
 */

import { CONFIG } from '../config.js';

const BUCKET = 8; // m

/**
 * What a unit's feet print (user: "Dog is leaving human footprints"): boots for men, the animal's own feet for the
 * guard dog and the BCD animals. The trail renderer (art/terrain.js stampWorld) stamps paw / bird prints for them, the
 * 'footprint' event and the stored prints carry it as `foot`.
 */
export const FOOT_OF = Object.freeze({ dog: 'dog', lion: 'lion', ostrich: 'ostrich', chicken: 'chicken' });
/** @returns {'boot'|'dog'|'lion'|'ostrich'|'chicken'} */
export function footOf(u) {
  return u?.foot ?? FOOT_OF[u?.soldierType] ?? 'boot';
}

export class Footprints {
  /** @param {import('../world/world.js').World} world */
  constructor(world) {
    this.world = world;
    /** @type {object[]} every print, oldest first */
    this.list = [];
    this.version = 0;
    this._hash = new Map();
    this._seq = 0;
  }

  _key(x, z) {
    return (Math.floor(x / BUCKET) + 4096) * 8192 + (Math.floor(z / BUCKET) + 4096);
  }

  /** Add a print from a 'footprint' event payload. @returns {object} the stored print */
  add(p, { keepId = false } = {}) {
    const id = keepId && Number.isFinite(p.id) ? p.id : ++this._seq;
    if (id > this._seq) this._seq = id;
    const fp = {
      kind: 'footprint', id, x: p.x, z: p.z, y: 0, heading: p.heading ?? 0, t: p.t ?? this.world.time,
      owner: p.owner ?? null, ownerId: p.owner?.id ?? p.ownerId ?? null, aiVisible: p.aiVisible !== false,
      terrain: p.terrain ?? null, foot: p.foot ?? 'boot',
    };
    this.list.push(fp);
    if (fp.aiVisible) {
      const k = this._key(fp.x, fp.z);
      let b = this._hash.get(k);
      if (!b) this._hash.set(k, (b = []));
      b.push(fp);
    }
    this.version++;
    return fp;
  }

  /** Drop expired prints (call once per step or lazily). */
  expire(now = this.world.time) {
    const life = CONFIG.stealth.footprint.life;
    let n = 0;
    while (n < this.list.length && now - this.list[n].t > life) n++;
    if (!n) return;
    const dead = this.list.splice(0, n);
    for (const fp of dead) {
      if (!fp.aiVisible) continue;
      const b = this._hash.get(this._key(fp.x, fp.z));
      const i = b ? b.indexOf(fp) : -1;
      if (i >= 0) b.splice(i, 1);
    }
    this.version++;
  }

  /** AI-visible live prints within r of (x, z). */
  query(x, z, r) {
    this.expire();
    const out = [], r2 = r * r;
    const i0 = Math.floor((x - r) / BUCKET), i1 = Math.floor((x + r) / BUCKET);
    const j0 = Math.floor((z - r) / BUCKET), j1 = Math.floor((z + r) / BUCKET);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const b = this._hash.get((i + 4096) * 8192 + (j + 4096));
        if (!b) continue;
        for (const fp of b) if ((fp.x - x) ** 2 + (fp.z - z) ** 2 <= r2) out.push(fp);
      }
    }
    return out;
  }

  /**
   * AI TRACKS query (§4.8 + docs/terrain-pipeline.md §4.4): the AI-visible live prints within r, each annotated
   * with `visibility` 0..1 read from the final terrain (print visibility of the material under it × exp(-age/τ)).
   * Prints whose visibility fell under CONFIG.stealth.footprint.minVisibility are dropped. Without a terrain
   * (unit tests, placeholder ground) every print has visibility 1, i.e. exactly query().
   */
  tracksNear(x, z, r, now = this.world.time) {
    const prints = this.query(x, z, r);
    const vis = this.world.terrain?.printVisibility;
    if (!vis) { for (const fp of prints) fp.visibility = 1; return prints; }
    const min = CONFIG.stealth.footprint.minVisibility ?? 0.15, out = [];
    for (const fp of prints) {
      fp.visibility = vis(fp.x, fp.z, Math.max(0, now - fp.t));
      if (fp.visibility >= min) out.push(fp);
    }
    return out;
  }

  /** Every live print with its display alpha (1 → 0 over the last `fade` seconds) for the trail layer. */
  visible(now = this.world.time) {
    this.expire(now);
    const F = CONFIG.stealth.footprint;
    return this.list.map((fp) => ({ ...fp, alpha: Math.max(0, Math.min(1, (F.life - (now - fp.t)) / F.fade)) }));
  }

  /** The next NEWER AI-visible print of the same owner within maxGap m of `fp` (TRACKS §4.6), or null. */
  trailFrom(fp, maxGap = CONFIG.stealth.footprint.trailFollow) {
    let best = null;
    for (const q of this.query(fp.x, fp.z, maxGap)) {
      if (q === fp || q.ownerId !== fp.ownerId || q.t <= fp.t) continue;
      if (!best || q.t < best.t) best = q;
    }
    return best;
  }

  /** A live print by id (save/load: an enemy in TRACKS re-links the print it was walking to). */
  get(id) {
    return this.list.find((fp) => fp.id === id) || null;
  }

  serialize() {
    return this.list.map(({ owner, ...fp }) => fp); // eslint-disable-line no-unused-vars
  }

  /** Restore saved prints with their ids (owners re-linked by ownerId when `world` knows them). */
  deserialize(list) {
    this.list = [];
    this._hash.clear();
    this._seq = 0;
    for (const fp of list || []) this.add({ ...fp, owner: this.world?.byId?.(fp.ownerId) ?? null }, { keepId: true });
    this.version++;
  }
}
