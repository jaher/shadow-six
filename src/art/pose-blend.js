/**
 * Skeleton pose helpers for the body-transport visuals (docs/bodies-design.md §C.10): static poses sampled from a
 * kit's clips, captured live poses, weighted blends written straight onto the bones, and a BoneGuard that keeps
 * direct bone writes compatible with THREE's AnimationMixer without touching its private buffers.
 *
 * THREE's PropertyMixer only writes a bone when its blended value changed since the previous frame. A pose written
 * directly on the bones would therefore stick after the override stops (a still clip never rewrites it). The guard
 * remembers each bone's value just before the first override of a frame and puts it back before the next mixer
 * update, so the mixer always compares against what it really wrote.
 *
 *   const g = new BoneGuard();  g.restore();  R.update(dt);  g.touch(bone); bone.quaternion.copy(...)
 *   clipPose(model, 'carried', 0)        // {q: Map<bone name, Quaternion>, pelvis: Vector3|null}, cached per clip
 *   capturePose(model)                   // the live local pose (every bone of the kit)
 *   writePose(model, [{pose, w}, ...])   // normalised weighted blend (slerp chain) onto the bones, through the guard
 * @module art/pose-blend
 */
import { Quaternion, Vector3 } from 'three';

/** Records bone values before direct writes and restores them before the next mixer update. */
export class BoneGuard {
  constructor() { this.m = new Map(); }
  /** Call before writing `o.quaternion` / `o.position` directly (once per frame is enough; repeats are free). */
  touch(o) {
    if (!this.m.has(o)) this.m.set(o, { q: o.quaternion.clone(), p: o.position.clone() });
  }
  /** Put every touched bone back to its pre-override value (call right before the mixer update). */
  restore() {
    if (!this.m.size) return false;
    for (const [o, v] of this.m) { o.quaternion.copy(v.q); o.position.copy(v.p); }
    this.m.clear();
    return true;
  }
  get size() { return this.m.size; }
}

const CACHE = new WeakMap();

/** Bones dictionary of a real model's current body (name → Bone), or null. */
export function bonesOf(model) {
  const h = model?.real?.inner;
  return h?.bones || null;
}

/**
 * Static pose of clip `name` at time `t` (s; a fraction of the clip when `frac`) for this model's kit. Cached per
 * adapted clip. @returns {{q: Map<string, Quaternion>, pelvis: Vector3|null}|null}
 */
export function clipPose(model, name, t = 0, frac = false) {
  const h = model?.real?.inner;
  if (!h?.clip) return null;
  const n = (h.clipAlias && h.clipAlias[name]) || name;
  const clip = h.clip(n);
  if (!clip) return null;
  let per = CACHE.get(clip);
  if (!per) CACHE.set(clip, (per = new Map()));
  const time = Math.min(clip.duration, Math.max(0, frac ? t * clip.duration : t));
  const key = time.toFixed(3);
  if (per.has(key)) return per.get(key);
  const pose = { q: new Map(), pelvis: null };
  for (const tr of clip.tracks) {
    const dot = tr.name.lastIndexOf('.');
    const bone = tr.name.slice(0, dot), prop = tr.name.slice(dot + 1);
    if (prop !== 'quaternion' && !(prop === 'position' && /^pelvis$/i.test(bone))) continue;
    const v = tr.createInterpolant().evaluate(time);
    if (prop === 'quaternion') pose.q.set(bone, new Quaternion(v[0], v[1], v[2], v[3]).normalize());
    else pose.pelvis = new Vector3(v[0], v[1], v[2]);
  }
  per.set(key, pose);
  return pose;
}

/** The live local pose of every bone of the model (a copy). */
export function capturePose(model) {
  const B = bonesOf(model);
  if (!B) return null;
  const pose = { q: new Map(), pelvis: null };
  for (const k in B) {
    pose.q.set(k, B[k].quaternion.clone());
    if (/^pelvis$/i.test(k)) pose.pelvis = B[k].position.clone();
  }
  return pose;
}

const _q = new Quaternion(), _v = new Vector3();

/**
 * Write the normalised weighted blend of `list` ({pose, w}) onto the model's bones. Bones missing from a pose keep
 * the blend so far; bones in no pose are left alone. `guard` records the pre-write values.
 * @returns {boolean} wrote
 */
export function writePose(model, list, guard = null) {
  const B = bonesOf(model);
  const L = list.filter((e) => e.pose && e.w > 1e-4);
  if (!B || !L.length) return false;
  for (const k in B) {
    const b = B[k];
    let acc = 0, have = false;
    for (const { pose, w } of L) {
      const q = pose.q.get(k);
      if (!q) continue;
      acc += w;
      if (!have) { _q.copy(q); have = true; } else _q.slerp(q, w / acc);
    }
    if (!have) continue;
    guard?.touch(b);
    b.quaternion.copy(_q);
    if (/^pelvis$/i.test(k)) {
      let pa = 0, ph = false;
      for (const { pose, w } of L) {
        if (!pose.pelvis) continue;
        pa += w;
        if (!ph) { _v.copy(pose.pelvis); ph = true; } else _v.lerp(pose.pelvis, w / pa);
      }
      if (ph) b.position.copy(_v);
    }
  }
  return true;
}

/**
 * Pull the live pose towards `pose` by weight `w` (0 = leave it, 1 = exactly `pose`): a blend-out from a pose the
 * body had (a transport hold) into what the mixer plays now.
 */
export function mixPose(model, pose, w, guard = null) {
  const B = bonesOf(model);
  if (!B || !pose || w <= 1e-4) return false;
  for (const k in B) {
    const q = pose.q.get(k);
    if (!q) continue;
    const b = B[k];
    guard?.touch(b);
    b.quaternion.slerp(q, Math.min(1, w));
    if (pose.pelvis && /^pelvis$/i.test(k)) b.position.lerp(pose.pelvis, Math.min(1, w));
  }
  return true;
}

/**
 * Guard for a pose written only when it changes (a settled ragdoll): remembers the mixer's value under each written
 * bone (refreshed whenever the mixer wrote since our last write) and restores it on `release()`.
 */
export class StickyGuard {
  constructor() { this.m = new Map(); }
  before(o) {
    const r = this.m.get(o);
    if (r && o.quaternion.equals(r.oq) && o.position.equals(r.op)) return; // the mixer did not write since: keep
    if (r) { r.q.copy(o.quaternion); r.p.copy(o.position); } else this.m.set(o, { q: o.quaternion.clone(), p: o.position.clone(), oq: new Quaternion(), op: new Vector3() });
  }
  after(o) { const r = this.m.get(o); if (r) { r.oq.copy(o.quaternion); r.op.copy(o.position); } }
  release() {
    for (const [o, r] of this.m) if (o.quaternion.equals(r.oq) && o.position.equals(r.op)) { o.quaternion.copy(r.q); o.position.copy(r.p); }
    this.m.clear();
  }
}
