/**
 * Save/load of the physics layer (bodies-design §A.10). Settled results live on the entities (`unit.bodyPose`) and in
 * the saved NavGrid (prop re-stamps); this module adds the moved props' transforms, the pending settles, and — only
 * while something still moves — a Rapier snapshot plus the handle → entity/bone maps, so the continuation after a load
 * is bit-identical to an uninterrupted run.
 * @module physics/persist
 */

import { NPARTS } from './ragdoll-template.js';

/** Uint8Array → base64 (chunked; works in node and browsers). */
export function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
/** base64 → Uint8Array. */
export function fromB64(b64) {
  const s = atob(b64), u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

/**
 * Tiny synchronous LZ77 (LZ4-style block: token = literal run + match length, 16-bit offsets) for the Rapier snapshot
 * (a heightfield and merged cuboids: long zero runs and repeated records, ~2× smaller). Saves stay synchronous.
 * Format: 4-byte little-endian raw length, then blocks.
 */
export function lzPack(src) {
  const n = src.length, out = new Uint8Array(n + (n >> 3) + 64), H = new Int32Array(1 << 16).fill(-1);
  let o = 4, anchor = 0, i = 0;
  out[0] = n & 255; out[1] = (n >> 8) & 255; out[2] = (n >> 16) & 255; out[3] = (n >>> 24) & 255;
  while (i + 4 <= n) {
    const h = (Math.imul(src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24), 2654435761) >>> 16) & 0xffff;
    const r = H[h]; H[h] = i;
    if (r >= 0 && i - r < 65536 && src[r] === src[i] && src[r + 1] === src[i + 1] && src[r + 2] === src[i + 2] && src[r + 3] === src[i + 3]) {
      let m = 4;
      while (i + m < n && src[r + m] === src[i + m]) m++;
      o = lzBlock(out, o, src, anchor, i, m, i - r);
      i += m; anchor = i;
    } else i++;
  }
  return out.subarray(0, lzBlock(out, o, src, anchor, n, 0, 0));
}

/** One block (literals src[a..b) + optional match) written at out[o]; returns the new write position (no closures:
 * see lzUnpack). */
function lzBlock(out, o, src, a, b, mlen, off) {
  const L = b - a, M = mlen ? mlen - 4 : 0;
  out[o++] = (Math.min(L, 15) << 4) | Math.min(M, 15);
  if (L >= 15) { let v = L - 15; while (v >= 255) { out[o++] = 255; v -= 255; } out[o++] = v; }
  for (let k = a; k < b; k++) out[o++] = src[k];
  if (!mlen) return o;
  out[o++] = off & 255; out[o++] = off >> 8;
  if (M >= 15) { let v = M - 15; while (v >= 255) { out[o++] = 255; v -= 255; } out[o++] = v; }
  return o;
}

/**
 * Inverse of lzPack. Written as one flat loop with no closure over the cursor: the closure version decoded wrongly
 * on its first (not yet optimised) runs in Chrome — a quick load then failed to restore the Rapier snapshot.
 */
export function lzUnpack(src) {
  const n = (src[0] | (src[1] << 8) | (src[2] << 16) | (src[3] << 24)) >>> 0, out = new Uint8Array(n), sn = src.length;
  let i = 4, o = 0;
  while (i < sn) {
    const t = src[i++];
    let L = t >>> 4;
    if (L === 15) { let b = 255; while (b === 255 && i < sn) { b = src[i++]; L += b; } }
    for (let k = 0; k < L; k++) out[o++] = src[i++];
    if (i >= sn) break;
    const off = src[i] | (src[i + 1] << 8); i += 2;
    let M = t & 15;
    if (M === 15) { let b = 255; while (b === 255 && i < sn) { b = src[i++]; M += b; } }
    M += 4;
    for (let k = 0; k < M; k++, o++) out[o] = out[o - off];
  }
  return out;
}

/** @param {import('./world-physics.js').PhysicsWorld} pw */
export function serializePhysics(pw) {
  const moving = pw.moving();
  return {
    tier: pw.tier,
    pending: pw.pendingSettle.map((p) => ({ id: p.unit.id, at: p.at, prone: p.prone })),
    props: pw.props.serialize(),
    gates: pw.gates?.serialize?.() ?? null, // gate smash debris (physics/debris.js)
    ...(moving ? {
      snapshot: 'lz:' + toB64(lzPack(pw.rw.takeSnapshot())),
      ragdolls: pw.ragdolls.map((rd) => ({
        id: rd.unit.id, mode: rd.mode, prone: rd.prone, ...(rd.drape ? { drape: true } : null), anchor: rd.anchor, spawnQ: Array.from(rd.spawnQ), spawnPelvis: rd.spawnPelvis,
        t: rd.t, t0: rd.t0 ?? 0, still: rd.still, calm: !!rd.calm, calmT: rd.calmT ?? 0, calmAt: rd.calmAt ?? null, prevPose: rd.prevPose ? Array.from(rd.prevPose) : null, blast: rd.blast ?? null, bodies: rd.bodies.map((b) => b.handle), joints: rd.joints.map((j) => j.handle),
      })),
      active: pw.props.active.map((it) => ({ key: it.key, t: it.t, still: it.still })),
      handles: pw.props.items.map((it) => it.body.handle),
      capsules: [...(pw.capsules || new Map())].map(([u, b]) => [u.id, b.handle]),
    } : null),
  };
}

/**
 * Restore into a freshly built PhysicsWorld (statics + dormant props already created the same way as when saved).
 * @param {import('./world-physics.js').PhysicsWorld} pw @param {object} data serializePhysics() output
 */
export function restorePhysics(pw, data) {
  if (!data) return;
  const w = pw.world;
  pw.pendingSettle = (data.pending || []).map((p) => ({ unit: w.byId(p.id), at: p.at, prone: !!p.prone })).filter((p) => p.unit);
  const byKey = new Map(pw.props.items.map((it) => [it.key, it]));
  if (data.snapshot) {
    const R = pw.R;
    const raw = data.snapshot.startsWith('lz:') ? lzUnpack(fromB64(data.snapshot.slice(3))) : fromB64(data.snapshot);
    const rw = R.World.restoreSnapshot(raw);
    if (!rw) throw new Error('[physics] snapshot restore failed');
    try { pw.rw.free(); } catch { /* ignore */ }
    pw.rw = rw;
    pw.props.items.forEach((it, i) => { it.body = rw.getRigidBody(data.handles?.[i] ?? it.body.handle); });
    pw.capsules = new Map((data.capsules || []).map(([id, h]) => [w.byId(id), rw.getRigidBody(h)]).filter(([u, b]) => u && b));
    pw.ragdolls = (data.ragdolls || []).map((r) => {
      const unit = w.byId(r.id);
      const rd = {
        unit, mode: r.mode, prone: r.prone, drape: !!r.drape, anchor: r.anchor, spawnQ: Float64Array.from(r.spawnQ), spawnPelvis: r.spawnPelvis,
        t: r.t, t0: r.t0 ?? 0, still: r.still, calm: !!r.calm, calmT: r.calmT ?? 0, calmAt: r.calmAt ?? undefined, prevPose: r.prevPose ? Float64Array.from(r.prevPose) : undefined, blast: r.blast, bodies: r.bodies.map((h) => rw.getRigidBody(h)), joints: r.joints.map((h) => rw.getImpulseJoint(h)),
        pose: new Float64Array(NPARTS * 7), done: false,
      };
      if (unit) unit._rd = rd;
      return rd;
    }).filter((rd) => rd.unit);
    for (const rd of pw.ragdolls) {
      for (let i = 0; i < NPARTS; i++) {
        const b = rd.bodies[i], t = b.translation(), q = b.rotation();
        rd.pose.set([t.x, t.y, t.z, q.x, q.y, q.z, q.w], i * 7);
      }
    }
    pw.props.active = (data.active || []).map((a) => { const it = byKey.get(a.key); if (it) { it.t = a.t; it.still = a.still; } return it; }).filter(Boolean);
  }
  pw.gates?.restore?.(data.gates, !!data.snapshot);
  // moved props: settled transform (fixed bodies; the grid re-stamp came back with the saved NavGrid)
  for (const s of data.props || []) {
    const it = byKey.get(s.key);
    if (!it) continue;
    it.moved = true; it.pose = s.pose; it.stamp = s.stamp ?? null;
    if (!data.snapshot) {
      it.body.setTranslation({ x: s.pose[0], y: s.pose[1], z: s.pose[2] }, false);
      it.body.setRotation({ x: s.pose[3], y: s.pose[4], z: s.pose[5], w: s.pose[6] }, false);
    }
  }
}
