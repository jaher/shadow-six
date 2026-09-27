/**
 * Clipping audit rules (pure, node-testable): what category a scene item belongs to, which contacts are intended
 * (ground layers, abutments, joints, stacked props…) and how an overlap is keyed for the checked-in baseline.
 * Data-driven so new content (missions 4-20, street furniture, pavement) is covered without code changes:
 *   - a structure def may carry `clipCategory` (override), `clipAllow: [id | type | category, …]` (explicit joins,
 *     e.g. a fence run attached to a gate post) or `clip: false` (never audited, e.g. a deliberately buried wreck)
 *   - any Object3D may carry `userData.clip = false` (skipped) or `userData.clipCategory`
 * @module debug/clip-rules
 */

/** Structure/entity type → audit category (first match wins; unknown types fall back by size). */
export const CATEGORY_RULES = [
  [/^(road|river|rail_track|trench|sea|lake|crater|moat|pavement|sidewalk|kerb|curb|decal|puddle|track|path|water.*|shore|snowdrift|grass.*)$/, 'ground'],
  [/^(wall|castle_wall|palisade|stockade|hedge_wall)$/, 'wall'],
  [/^(fence|barbed_wire|wire|wire_fence|railing|picket.*)$/, 'fence'],
  [/^(gate|lock_gate|water_gate|drawbridge)$/, 'gate'],
  [/^(watchtower|tower|guard_tower|lookout)$/, 'tower'],
  [/^(radio_mast|telegraph_pole|lamp_post|searchlight|sign|flagpole|pole|street_lamp|signpost)$/, 'pole'],
  [/^(bridge|rail_bridge|truss_bridge|mobile_bridge|dam|footbridge)$/, 'bridge'],
  [/^(pier|jetty|quay|dock|landing)$/, 'pier'],
  [/^(rocks|rock|boulder|boulders)$/, 'rocks'],
  [/^cliff$/, 'cliff'],
  [/^(tree|pine|palm|bush|shrub)$/, 'tree'],
  [/^(sandbags|sandbag)$/, 'sandbags'],
  [/^(tent|marquee)$/, 'tent'],
  [/^(ruins|rubble)$/, 'ruins'],
  [/^(plane|uboat|train_car|wreck|boat)$/, 'vehicle'],
  [/^(crates|crate|barrels|barrel|generator|fueltank|well|aa_gun|bench|hydrant|kiosk|mailbox|bin|cart|haystack|woodpile|pallet|table|clothesline)$/, 'prop'],
  [/^(barracks|house|hut|bunker|hangar|church|shed|garage|farm.*|warehouse|factory|hq|admin|station|chalet|villa|castle|lighthouse)$/, 'building'],
];

/** Categories never audited (they are the ground itself or painted onto it). */
export const GROUND_LAYER = new Set(['ground', 'terrain', 'water']);
/** Categories whose surfaces are one-sided cards/cloth/wire: depth is measured from the other item only. */
export const THIN = new Set(['foliage', 'flag', 'wire', 'fence']);
/** Linear categories whose runs may end against (join) another item. */
export const LINEAR = new Set(['wall', 'fence']);
/** Categories allowed to accept a joint at a linear run's end. */
export const JOINABLE = new Set(['wall', 'fence', 'gate', 'tower', 'pole', 'building', 'ruins', 'cliff', 'rocks', 'bridge']);
/** Distance (m) from a linear run's end within which a contact is a joint. */
export const JOINT_R = 1.25;

/** Natural / intended contact between two categories (order-free). */
const NATURAL = [
  ['rocks', 'rocks'], ['rocks', 'cliff'], ['cliff', 'cliff'], ['ruins', 'ruins'], ['ruins', 'rocks'],
  ['foliage', 'foliage'], ['trunk', 'foliage'], ['trunk', 'trunk'], ['foliage', 'rocks'], ['foliage', 'cliff'],
  ['bridge', 'rocks'], ['bridge', 'cliff'], ['bridge', 'pier'], ['bridge', 'bridge'], ['pier', 'rocks'], ['pier', 'pier'],
  ['sandbags', 'sandbags'], ['sandbags', 'emplacement'], ['prop', 'prop'], ['clutter', 'clutter'], ['clutter', 'rocks'],
  ['clutter', 'cliff'], ['clutter', 'foliage'], ['clutter', 'trunk'],
  ['character', 'foliage'], ['vehicle', 'foliage'], ['turret', 'foliage'], ['character', 'clutter'], ['vehicle', 'clutter'],
];
const NATURAL_SET = new Set(NATURAL.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));

/**
 * Category of a structure type (+ optional def for overrides/size fallback).
 * @param {string} type @param {object} [def]
 */
export function categoryOf(type, def = null) {
  if (def?.clipCategory) return def.clipCategory;
  const t = String(type || '').toLowerCase();
  for (const [re, cat] of CATEGORY_RULES) if (re.test(t)) return cat;
  const w = def?.w ?? (def?.r != null ? def.r * 2 : 0), d = def?.d ?? (def?.r != null ? def.r * 2 : 0);
  return w * d >= 12 ? 'building' : 'prop';
}

/** Is a contact between two categories natural (never reported as unintended)? */
export function naturalPair(ca, cb) {
  return NATURAL_SET.has(`${ca}|${cb}`);
}

const ids = (it) => [it.id, it.type, it.cat].filter((v) => v != null).map(String);
/** Explicit join through either def's `clipAllow` list (ids, types or categories of the other item). */
export function explicitAllow(a, b) {
  const la = a.def?.clipAllow || a.clipAllow || [], lb = b.def?.clipAllow || b.clipAllow || [];
  const ib = ids(b), ia = ids(a);
  return la.some((x) => ib.includes(String(x))) || lb.some((x) => ia.includes(String(x)));
}

/** Endpoints [[x, z], …] of a linear item's runs (def.points or def.segments), world metres. */
export function runEnds(def) {
  if (!def) return [];
  const toXZ = (p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.z]);
  const runs = def.segments ? def.segments : def.points ? [def.points] : [];
  const out = [];
  for (const r of runs) if (r?.length >= 2) out.push(toXZ(r[0]), toXZ(r[r.length - 1]));
  return out;
}

/**
 * A contact at `p` ({x, z}) is a joint: near a linear item's run end, against a joinable item, and compact (the
 * contact box, when given as {min, max} arrays, spans ≤ 2·r + 0.5 m horizontally — a run passing through is no joint).
 */
export function isJoint(a, b, p, r = JOINT_R, box = null) {
  if (box && Math.max(box.max[0] - box.min[0], box.max[2] - box.min[2]) > 2 * r + 0.5) return false;
  const near = (lin, other) => LINEAR.has(lin.cat) && JOINABLE.has(other.cat)
    && runEnds(lin.def).some(([x, z]) => Math.hypot(x - p.x, z - p.z) <= r);
  return near(a, b) || near(b, a);
}

/**
 * Classify one measured overlap: {allowed: bool, reason: string|null}. Order of checks: explicit join,
 * natural pair, joint, resting contact (touching, not penetrating).
 * @param {{cat:string, id?:string, type?:string, def?:object}} a @param {typeof a} b
 * @param {{point:{x:number,y:number,z:number}, depth:number, contact:number}} m measurement
 * @param {{minDepth?: number}} [o] minDepth: shallower overlaps are resting contacts (default 2 cm)
 */
export function classify(a, b, m, o = {}) {
  const minDepth = o.minDepth ?? 0.02;
  if (explicitAllow(a, b)) return { allowed: true, reason: 'clipAllow' };
  if (naturalPair(a.cat, b.cat)) return { allowed: true, reason: `natural ${a.cat}/${b.cat}` };
  if (isJoint(a, b, m.point, JOINT_R, m.box)) return { allowed: true, reason: 'joint' };
  if (!(m.depth > minDepth) && !(m.contact > 0.5)) return { allowed: true, reason: 'resting contact' };
  // standing / resting ON a surface: shallow and flat (feet on a deck, a drum on a slab), whatever the contact length
  if (m.depth <= 0.03 && m.box && m.box.max[1] - m.box.min[1] <= 0.12) return { allowed: true, reason: 'resting on a surface' };
  return { allowed: false, reason: null };
}

/** Stable baseline key of an overlap (mission + ordered pair of item ids). */
export function overlapKey(mission, a, b) {
  const [x, y] = [String(a.id), String(b.id)].sort();
  return `${mission}:${x}|${y}`;
}

/**
 * Split findings against a baseline {keys: string[]} → {fresh, accepted, gone}. `fresh` = unintended overlaps not
 * in the baseline (a test fails on these), `gone` = baseline keys no longer found (fixed; prune them).
 */
export function diffBaseline(findings, baseline, mission = null) {
  const keys = new Set(baseline?.keys || []);
  const seen = new Set();
  const fresh = [], accepted = [];
  for (const f of findings) {
    if (f.allowed) continue;
    seen.add(f.key);
    (keys.has(f.key) ? accepted : fresh).push(f);
  }
  const gone = [...keys].filter((k) => (!mission || k.startsWith(mission + ':')) && !seen.has(k));
  return { fresh, accepted, gone };
}
