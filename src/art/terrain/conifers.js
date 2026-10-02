/**
 * Conifer crowns built from baked needle-spray cards (assets/terrain/needles.webp, tools/render/build_needles.py).
 *
 * - Norway spruce / silver fir (form 'spruce'): whorled branch tiers following a cone, lower branches sagging with
 *   up-turned tips; each branch carries arched spray cards (twig + side shoots + individual needles in the texture)
 *   and, on spruce, hanging 'comb' curtains underneath; short inter-whorl branches fill the tiers.
 * - Pines (form 'pine': Scots, stone/umbrella, Aleppo): a tall clear bole, upward-curving limbs that fork into
 *   twigs ending in pads of crossed needle tufts with a flatter cap card on top.
 * Every needle vertex carries aExt = (crown AO, signed snow catch): the AO darkens the crown interior and the
 * undersides, the snow catch (sky exposure × geometric normal y) puts snow loads on the TOP of tiers and pads only.
 * Same seed → same tree (all randomness comes from the tree's rng).
 * @module art/terrain/conifers
 */

/** Needle atlas layers (assets/terrain/needles.json). */
export const NEEDLE_LAYERS = ['spruce_0', 'spruce_1', 'spruce_curtain', 'spruce_top', 'scots_0', 'scots_1', 'stone_0', 'stone_1', 'scots_pad', 'stone_pad'];
const NL = (n) => NEEDLE_LAYERS.indexOf(n);

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/**
 * Walk-under clearance of one branch polyline (tree-local, y up from the ground): with `clear` {y, r} (or a list) the
 * branch ends at its last point before one that lies below `y` farther than `r` from the trunk axis.
 * @returns {number} segments kept (bp.length - 1 when untouched, 0 = drop the branch)
 */
export function clearBranch(bp, clear) {
  const last = bp.length - 1;
  if (!clear) return last;
  const list = Array.isArray(clear) ? clear : [clear];
  for (let i = 1; i <= last; i++) if (list.some((c) => bp[i].y < c.y && Math.hypot(bp[i].x, bp[i].z) > c.r)) return i - 1;
  return last;
}

/**
 * Clearance by lifting: a limb that breaks a floor (clearBranch) keeps its length, foliage and snow; every point after
 * the break that lies farther than `r` from the trunk axis is raised to the floor + `margin` (the wood hangs under
 * the spray line and has a radius: `margin` keeps the bark itself above the floor).
 * @param {{x:number, y:number, z:number}[]} bp branch polyline (tree-local) @param {object|object[]} clear {y, r} floors
 * @param {number} [margin]
 * @returns {{pts: object[], sN: number, lifted: boolean}} pts the polyline to build on (bp itself when untouched);
 *   sN = clearBranch(bp, clear): 0 = the limb is born under a floor beyond the trunk's reach (dropped)
 */
export function liftBranch(bp, clear, margin = 0) {
  const sN = clearBranch(bp, clear), last = bp.length - 1;
  if (sN === 0 || sN === last) return { pts: bp, sN, lifted: false };
  const list = Array.isArray(clear) ? clear : [clear];
  const pts = bp.map((p, i) => {
    if (i <= sN) return p;
    const rho = Math.hypot(p.x, p.z);
    let y = p.y;
    for (const c of list) if (rho > c.r && y < c.y + margin) y = c.y + margin;
    return y === p.y ? p : p.clone ? p.clone().setY(y) : { ...p, y };
  });
  return { pts, sN, lifted: true };
}

/**
 * Clearance plan of one conifer limb (tree-local polyline) under the placement floors `clear` ({y, r[, wood]} or a list):
 *  - hard floors (placement pruneTree's `crownFloor` over a wall, rock, boat or vehicle lane): no part of the limb
 *    goes under; a limb sagging below is lifted onto the floor + `margin` with all its foliage (liftBranch), a limb born
 *    below it is dropped;
 *  - `wood` floors (walk-under, rule e: below head height beyond the trunk's footprint): only the WOOD keeps above it —
 *    the bark ends at the limb's last point before the break (clearBranch) — while the needles stay where they grew:
 *    walkers brush through needles as through a bush (clip-rules NATURAL character|foliage). Cutting the needles there
 *    too stripped every spruce of its lowest, widest, snow-laden tiers.
 * @returns {{pts: object[], drop: boolean, lifted: boolean, woodN: number}} pts: the polyline for needles and wood;
 *   drop: nothing of the limb is drawn; lifted: raised onto a hard floor; woodN: wood segments kept along pts
 */
export function limbClearance(bp, clear, margin = 0) {
  const list = !clear ? [] : Array.isArray(clear) ? clear : [clear];
  const hard = list.filter((c) => !c.wood);
  const { pts, sN, lifted } = liftBranch(bp, hard.length ? hard : null, margin);
  return { pts, drop: sN === 0, lifted, woodN: sN === 0 ? 0 : clearBranch(pts, list.length ? list : null) };
}

/**
 * Accumulator that keeps nothing. Limb parts the clearance removes are still generated into it, so the tree's random
 * stream (and with it every other limb, the lean and the yaw) is the same tree as without clearance.
 */
const SINK = { count: 0, p: [], n: [], vert: () => 0, tri: () => {} };

/**
 * @param {object} env {THREE, V, UP, tube, BARK_LAYERS}
 * @returns {{genSpruce:Function, genPine:Function, along:Function, trunk:Function, spray:Function, card:Function, shade:Function}}
 */
export function makeConifers(env) {
  const { THREE, V, UP, tube, BARK_LAYERS } = env;

  /** Point and unit direction at fraction f (0..1, extrapolated past the tip) of a polyline. */
  function along(pts, f) {
    const n = pts.length - 1, x = clamp(f, 0, 1.3) * n, i = Math.min(n - 1, Math.floor(x)), u = x - i;
    const d = V().subVectors(pts[i + 1], pts[i]);
    return { p: pts[i].clone().addScaledVector(d, u), d: d.normalize() };
  }

  /** Trunk tube with wander; returns {pts, rads, at(y) → centre offset}. */
  function trunk(sp, r, H, q, bark, tint, phase, sway, r0, top = 1) {
    const pts = [], rads = [];
    const seg = Math.max(4, Math.round(12 * q.seg));
    const la = r() * 6.28, lean = (sp.lean ?? 0.02) * r();
    let x = 0, z = 0;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      pts.push(V(x, t * H * top - 0.15, z));
      rads.push(Math.max(0.02, r0 * (1 - t * (top < 1 ? 0.5 : 0.92)) * (1 + (sp.flare || 0) * Math.pow(Math.max(0, 1 - t * 10), 3))));
      x += (r() - 0.5) * 0.08 + Math.cos(la) * lean * H / seg; z += (r() - 0.5) * 0.08 + Math.sin(la) * lean * H / seg;
    }
    tube(bark, pts, rads, Math.max(4, Math.round(8 * q.radial)), BARK_LAYERS.indexOf(sp.bark), (p) => [sway(p.y), 0, phase], tint, 2);
    const at = (y) => { const f = clamp(y / (H * top), 0, 1) * seg, i = Math.min(seg - 1, Math.floor(f)); return pts[i].clone().lerp(pts[i + 1], f - i); };
    const radAt = (y) => rads[Math.min(seg, Math.round(clamp(y / (H * top), 0, 1) * seg))];
    return { pts, rads, at, radAt };
  }

  /**
   * Arched spray card along `path` from f0 to f1: 3 rows × 3 columns, centre on the branch, edges dropped by
   * `arch` (snow sits on the convex top), rolled by `roll`. info(p) → [layer, sway, flex, phase]; ext(p, nGeom).
   */
  function spray(acc, path, f0, f1, W, arch, roll, layer, info, tint, ext, curtain = 0) {
    const rows = [], nr = curtain ? 2 : 3;   // a narrow curtain strip needs no middle row
    for (let k = 0; k < nr; k++) {
      const f = lerp(f0, f1, k / (nr - 1)), { p, d } = along(path, f);
      let s = V().crossVectors(d, UP);
      if (s.lengthSq() < 1e-4) s.set(1, 0, 0);
      s.normalize().applyAxisAngle(d, roll);
      const nUp = V().crossVectors(s, d).normalize();
      if (nUp.y < 0) { nUp.negate(); s.negate(); }
      const row = [];
      if (!curtain) {
        const slope = (2 * arch) / Math.max(0.2, W);
        for (const c of [-1, 0, 1]) {
          const q = p.clone().addScaledVector(s, (c * W) / 2).addScaledVector(nUp, -arch * Math.abs(c));
          const n = nUp.clone().addScaledVector(s, c * slope).normalize();
          row.push(acc.vert(q, n, (c + 1) / 2, k / (nr - 1), info(q), tint, ext(q, n)));
        }
      } else {             // hanging comb: u=0 on the branch, u=1 hangs down and out to side `curtain` (±1)
        const hd = V(0, -1, 0).addScaledVector(s, curtain * 0.28).normalize();   // hangs under the limb, inside the crown
        const top = p.clone().addScaledVector(s, curtain * W * 0.12).addScaledVector(nUp, -0.04);
        const n = V().crossVectors(hd, d).normalize();
        if (n.dot(s) * curtain < 0) n.negate();
        for (const c of [0, 1]) {
          const q = top.clone().addScaledVector(hd, c * W);
          row.push(acc.vert(q, n, c, k / (nr - 1), info(q), tint, ext(q, n)));
        }
      }
      rows.push(row);
    }
    const nc = rows[0].length - 1;
    for (let k = 0; k < nr - 1; k++) for (let c = 0; c < nc; c++) {
      const a = rows[k][c], b = rows[k][c + 1], cc = rows[k + 1][c], dd = rows[k + 1][c + 1];
      acc.tri(a, b, dd); acc.tri(a, dd, cc);
    }
  }

  /** Flat-ish card (pine tufts and caps): base at p, growing along `up`. */
  function card(acc, p, up, right, size, layer, info, tint, ext, width = 1) {
    const rr = right.clone().multiplyScalar(size * 0.5 * width), u = up.clone().multiplyScalar(size);
    const n = V().crossVectors(right, up).normalize();
    const base = p.clone().addScaledVector(up, -size * 0.06);
    const q = [base.clone().sub(rr), base.clone().add(rr), base.clone().add(rr).add(u), base.clone().sub(rr).add(u)];
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const id = q.map((x, i) => acc.vert(x, n, uv[i][0], uv[i][1], info(x), tint, ext(x, n)));
    acc.tri(id[0], id[1], id[2]); acc.tri(id[0], id[2], id[3]);
  }

  const shade = (t, s, yel = 0) => [t[0] * s * (1 + 0.25 * yel), t[1] * s * (1 + 0.08 * yel), t[2] * s * (1 - 0.35 * yel)];

  /** Norway spruce / silver fir. `nd` receives the needle cards; returns crown points. */
  function genSpruce(sp, r, H, q, bark, nd, tint, leafTint, phase) {
    const sway = (y) => Math.pow(Math.max(0, y) / H, 1.5);
    const r0 = lerp(sp.r0[0], sp.r0[1], r()) * (H / sp.H[1]) ** 0.7;
    const T = trunk(sp, r, H, q, bark, tint, phase, sway, r0);
    const crown = [];
    const width = Math.min(sp.width * H * (0.85 + 0.3 * r()), (sp.maxWidth ?? Infinity) - 0.6);
    const cb = sp.crownBase, gap = sp.tier ?? 0.42;
    const prof = (tt) => width * Math.pow(Math.max(0, 1 - tt), 0.88) + 0.22;   // cone radius at crown fraction tt
    const nW = Math.max(4, Math.round((H * (1 - cb)) / gap));
    const dTT = gap / (H * (1 - cb));
    const foliage = sp.leaf !== null;
    // spray scale: a small tree has more, smaller sprays (a few tree-sized cards read as cardboard)
    const sc = clamp(H / 10, 0.38, 1), qs = q.cards < 0.6 ? 1.3 : 1;   // qs: fewer, longer sprays at the low preset
    // per-vertex AO (radial depth in the tier + tiers above) and snow catch (sky exposure × geometric normal y)
    const extAt = (tt, aoMul) => (p, n) => {
      const c = T.at(p.y), rho = Math.hypot(p.x - c.x, p.z - c.z);
      const fr = rho / prof(tt);
      const ao = (0.6 + 0.4 * sstep(0.05, 0.95, fr)) * (0.86 + 0.14 * Math.min(1, tt * 1.4 + 0.25)) * aoMul;
      const cover = prof(Math.min(1, tt + dTT * 1.2));
      const expo = clamp((rho - cover * 0.8) / 0.45 + 0.4, 0.3, 1);
      return [ao, expo * n.y];
    };
    function branch(c0, a, len, tt, elev, phB, small) {
      const s3 = 4, d = V(Math.cos(a), elev, Math.sin(a)).normalize(), p = c0.clone();
      const bp = [p.clone()];
      for (let i = 0; i < s3; i++) {
        const f = i / (s3 - 1);
        d.y -= (sp.sag ?? 0.16) * (1 - tt) * (1 - f * 0.6);                  // gravity: old low limbs hang
        if (f > 0.5) d.y += (sp.upturn ?? 0) * (1 - tt) * (f - 0.4);          // Norway spruce tips turn up
        d.x += (r() - 0.5) * 0.12; d.z += (r() - 0.5) * 0.12; d.normalize();
        p.addScaledVector(d, len / s3); bp.push(p.clone());
      }
      const rb = Math.max(0.012, T.radAt(c0.y) * (small ? 0.18 : 0.3));
      // clearance (placement hint `clear`, limbClearance): below head height the limb's wood ends at the trunk's
      // footprint while its sprays stay; over an obstacle's floor the whole limb is lifted (margin: the bark hangs
      // rb·1.6 + 0.02 under the spray line with radius ≤ rb) or, born under it, dropped
      const L = limbClearance(bp, sp.clear, rb * 2.6 + 0.05), path = L.pts, ndk = L.drop ? SINK : nd;
      const flexAt = (pp) => 0.2 + 0.8 * clamp(Math.hypot(pp.x - c0.x, pp.z - c0.z) / Math.max(0.5, len), 0, 1);
      // the limb ends under its outer spray (a bare snow-capped stick past the needles read as a white line)
      // and hangs just below the spray's centre line, so the sprays (not a snow-capped stick) carry the snow
      const bt = (small || q.seg < 0.6 ? [0, 1, 2] : [0, 2, 3]).filter((i) => i <= L.woodN).map((i) => path[i]).map((x, i) => (i ? x.clone().add(V(0, -rb * 1.6 - 0.02, 0)) : x));
      if (bt.length >= 2) tube(bark, bt, bt.map((_, i) => Math.max(0.008, rb * (1 - i / (s3 + 1)))), 3, BARK_LAYERS.indexOf(sp.bark), (pp) => [sway(pp.y), flexAt(pp) * 0.6, phB], tint, 1);
      if (!foliage) return;
      const info = (layer) => (pp) => [layer, sway(pp.y), flexAt(pp), phB];
      const nS = Math.max(1, Math.round(len / ((0.9 + 0.3 * r()) * sc * qs)));
      for (let k = 0; k < nS; k++) {
        const f0 = Math.max(small ? 0.05 : 0.14, k / nS - 0.1), f1 = (k + 1) / nS + (k === nS - 1 ? 0.12 : 0.08);
        const L = (f1 - f0) * len;
        const W = L * (0.95 + 0.3 * r()) * (sp.sprayW ?? 1);
        const outer = k === nS - 1;
        const layer = tt > 0.86 ? NL('spruce_top') : NL('spruce_0') + (r() < 0.5 ? 0 : 1);
        const sh = (0.86 + 0.24 * r()) * (outer ? 1.06 : 0.9 + 0.06 * k);
        const tn = shade(leafTint, sh, !outer && r() < 0.18 ? 0.5 + 0.5 * r() : 0);
        // every spray, the outer one too: it runs past the tip (f1 up to 1.12) and carries the snow load
        spray(ndk, path, f0, f1, W, W * (0.1 + 0.14 * (1 - tt)), (r() - 0.5) * 0.5, layer, info(layer), tn, extAt(tt, 1));
        if (!L.drop) crown.push(along(path, (f0 + f1) / 2).p);
      }
      // hanging comb curtains under the longer limbs (both sides), darker and unexposed; none under a limb lifted
      // over an obstacle (they would hang onto it)
      if (!small && len > 0.9 && H > 6 && q.cards >= 0.6 && r() < (sp.curtain ?? 0) * Math.min(1, q.cards)) {
        const ck = L.lifted ? SINK : ndk;
        for (const side of [-1, 1]) {
          if (r() < 0.25) continue;
          const f0 = 0.25 + 0.15 * r(), f1 = Math.min(1.05, f0 + 0.45 + 0.35 * r());
          const hang = (0.3 + 0.35 * r()) * (0.6 + 0.6 * (1 - tt)) * Math.min(1.2, len / 1.6) * sc;
          // broken into narrow strips with gaps and their own drop (one wide comb read as a flat dark plane)
          const nst = Math.max(1, Math.round(((f1 - f0) * len) / 0.55));
          for (let k = 0; k < nst; k++) {
            const a0 = f0 + ((f1 - f0) * k) / nst, a1 = a0 + ((f1 - f0) / nst) * (0.72 + 0.2 * r());
            spray(ck, path, a0, a1, hang * (0.75 + 0.45 * r()), 0, (r() - 0.5) * 0.4, NL('spruce_curtain'), info(NL('spruce_curtain')), shade(leafTint, 0.9 + 0.14 * r()),
              (pp, n) => [extAt(tt, 0.92)(pp, n)[0], 0], side);   // whole comb per strip: a v sub-range cut the hanging twigs with straight edges
          }
        }
      }
    }
    for (let w = 0; w < nW; w++) {
      const t = cb + (1 - cb) * ((w + 0.35 + 0.3 * r()) / nW), tt = (t - cb) / (1 - cb);
      if (tt > 0.97) break;
      const y = t * H, c0 = T.at(y);
      const nb = Math.max(3, sp.whorl + ((r() * 3) | 0) - 1);
      const a0 = w * 2.39996 + r() * 0.6;
      for (let b = 0; b < nb; b++) {
        if (r() < 0.08) continue;                                          // a missing limb: irregular tiers
        const a = a0 + (b / nb) * 6.2832 + (r() - 0.5) * 0.7;
        const len = prof(tt) * (0.78 + 0.4 * r());
        branch(c0, a, len, tt, lerp(sp.droop, 0.62, tt * tt) + (r() - 0.5) * 0.18, phase + r() * 6.28, false);
      }
      // inter-whorl twigs: spruce fills the space between tiers
      const ni = q.cards < 0.6 ? 0 : Math.round((0.5 + 1.5 * r()) * q.cards);
      for (let k = 0; k < ni; k++) {
        const y2 = y + gap * (0.35 + 0.3 * r()), tt2 = Math.min(1, tt + dTT * 0.5);
        if (tt2 > 0.95) break;
        branch(T.at(y2), r() * 6.28, prof(tt2) * (0.45 + 0.25 * r()), tt2, lerp(sp.droop, 0.62, tt2 * tt2) + 0.1, phase + r() * 6.28, true);
      }
    }
    // leader: the spire above the last whorl
    if (foliage) {
      const top = T.pts[T.pts.length - 1], sz = Math.min(1.8, 0.12 * H + 0.4);
      const infoTop = (pp) => [NL('spruce_top'), 1, 0.6, phase];
      for (let k = 0; k < 3; k++) {
        const ang = (k / 3) * Math.PI + r() * 0.3;
        card(nd, top.clone().add(V(0, -sz * 0.85, 0)), V((r() - 0.5) * 0.12, 1, (r() - 0.5) * 0.12).normalize(), V(Math.cos(ang), 0, Math.sin(ang)), sz,
          NL('spruce_top'), infoTop, shade(leafTint, 1.05), (p, n) => [1, 0.45 * Math.abs(n.y) + 0.25], 0.55);
      }
      crown.push(top.clone());
    }
    return crown;
  }

  /** Pines: Scots (rounded, layered pads), stone/umbrella (forked, flat-topped), Aleppo (open, irregular). */
  function genPine(sp, r, H, q, bark, nd, tint, leafTint, phase) {
    const sway = (y) => Math.pow(Math.max(0, y) / H, 1.5);
    const r0 = lerp(sp.r0[0], sp.r0[1], r()) * (H / sp.H[1]) ** 0.7;
    const forks = sp.fork ? sp.fork[0] + ((r() * (sp.fork[1] - sp.fork[0] + 1)) | 0) : 1;
    const cb = clamp(sp.crownBase * (0.9 + 0.2 * r()), 0.2, 0.85);
    const T = trunk(sp, r, H, q, bark, tint, phase, sway, r0, forks > 1 ? cb + 0.04 : 1);
    const width = Math.min(sp.width * H * (0.85 + 0.3 * r()), (sp.maxWidth ?? Infinity) - 0.4);
    const umb = sp.umbrella ?? 0, padSz = (sp.pad ?? 0.55) * (0.9 + 0.2 * r());
    const prof = (tt) => width * lerp((0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, 0.15 + tt))) * (1 - 0.65 * tt ** 3),
      (0.4 + 0.6 * Math.sqrt(tt)) * (tt > 0.88 ? Math.max(0.2, 1 - (tt - 0.88) * 5) : 1), umb);
    const L0 = NL(sp.needle + '_0'), foliage = sp.leaf !== null;
    const crown = [], barkL = BARK_LAYERS.indexOf(sp.bark);
    // leaders the limbs grow from: the bole above the crown base, or the forked stems of an umbrella pine
    const leaders = [];
    if (forks > 1) {
      const base = T.pts[T.pts.length - 1];
      for (let k = 0; k < forks; k++) {
        const a = (k / forks) * 6.28 + r() * 0.8, d = V(Math.cos(a) * (0.45 + 0.25 * r()), 1, Math.sin(a) * (0.45 + 0.25 * r())).normalize();
        const pts = [base.clone()], p = base.clone(), len = H * (1 - cb) * (0.85 + 0.1 * r());
        for (let i = 0; i < 5; i++) { d.y -= 0.06; d.normalize(); p.addScaledVector(d, len / 5); pts.push(p.clone()); }
        tube(bark, pts, pts.map((_, i) => Math.max(0.03, r0 * 0.6 * (1 - i / 6))), Math.max(4, Math.round(6 * q.radial)), barkL, (pp) => [sway(pp.y), 0.1, phase], tint, 2);
        leaders.push(pts);
      }
    } else leaders.push(T.pts);
    const crownTop = H, crownLo = cb * H;
    const extFor = (pc, pr) => (p, n) => {
      const hf = clamp((p.y - crownLo) / Math.max(1, crownTop - crownLo), 0, 1);
      const din = Math.min(1, p.distanceTo(pc) / Math.max(0.2, pr));
      const rho = Math.hypot(p.x, p.z) / Math.max(0.5, prof(hf));
      const ao = (0.62 + 0.38 * sstep(0.1, 0.9, rho)) * (0.8 + 0.2 * hf) * (0.78 + 0.22 * din);   // open pine crowns: light gets in
      return [ao, (0.35 + 0.4 * hf) * n.y];   // pine pads hold less snow than spruce shelves (no cotton-wool crowns)
    };
    function pad(P, o, flex, phB, acc = nd) {
      const v0 = acc.count;
      const pr = padSz * (0.9 + 0.4 * r()), padTint = 0.85 + 0.25 * r(), nT = Math.max(4, Math.round((9 + 5 * r()) * q.cards));
      const info = (layer) => (pp) => [layer, sway(pp.y), flex, phB];
      const ext = extFor(P, pr);
      // the tufts hold little snow (white flecks on every tuft read as separate leaves); the pad cap carries the load
      const extT = (p, n) => { const e = ext(p, n); return [e[0], e[1] * 0.45]; };
      for (let k = 0; k < nT; k++) {
        const off = V(r() - 0.5, (r() - 0.5) * 0.35, r() - 0.5).multiplyScalar(pr * 0.85);
        // tufts radiate out of the pad (a pom-pom of needle brushes) with their faces turned to the sky, so from
        // the high camera a pad reads as a starburst of needles, not as a heap of separately lit leaves
        const dir = o.clone().multiplyScalar(0.35).add(V(0, 0.55 + 0.3 * r(), 0)).addScaledVector(off.clone().setY(0), 2.2 / pr)
          .add(V(r() - 0.5, (r() - 0.5) * 0.6, r() - 0.5).multiplyScalar(0.4)).normalize();
        const right = V().crossVectors(dir, UP).addScaledVector(V(r() - 0.5, r() - 0.5, r() - 0.5), 0.6);
        if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
        right.normalize();
        const layer = L0 + (r() < 0.5 ? 0 : 1);
        const sz = padSz * (0.62 + 0.36 * r());   // the brush fills the outer ~half of its card (bare twig base)
        card(acc, P.clone().add(off).addScaledVector(dir, -sz * 0.3), dir, right, sz, layer, info(layer), shade(leafTint, padTint * (0.93 + 0.14 * r()), r() < 0.1 ? 0.5 : 0), extT, 1.05);
      }
      const LP = NL(sp.needle + '_pad');
      for (let k = 0; k < 1; k++) {                                              // cap: needle cushion seen from above (snow shelf)
        const a = r() * 6.28, up = V(Math.cos(a), 0.15 + 0.25 * r(), Math.sin(a)).normalize();
        let right = V().crossVectors(up, UP).normalize();
        if (V().crossVectors(right, up).y < 0) right.negate();
        const sz = pr * (1.1 + 0.3 * r());
        card(acc, P.clone().add(V((r() - 0.5) * pr * 0.5, pr * (0.12 + 0.2 * k), (r() - 0.5) * pr * 0.5)).addScaledVector(up, -sz * 0.5), up, right, sz, LP, info(LP), shade(leafTint, padTint * (1.02 + 0.08 * r())), ext, 1);
      }
      // pad-level normals: the tufts of one pad shade as one lumpy cushion (lit top, shaded flanks), not as
      // separate cards (individually lit tufts read as big leaves from the game camera)
      const t = V(), n = V();
      for (let i = v0; i < acc.count; i++) {
        t.fromArray(acc.p, i * 3).sub(P).add(V(0, pr * 0.6, 0)).normalize();
        n.fromArray(acc.n, i * 3);
        if (n.dot(t) < 0) n.negate();
        n.lerp(t, 0.75).normalize().toArray(acc.n, i * 3);
      }
      if (acc !== SINK) crown.push(P.clone());
    }
    for (const Ld of leaders) {
      const y0 = Math.max(crownLo, Ld[0].y), y1 = Ld[Ld.length - 1].y;
      const nW = Math.max(2, Math.round((y1 - y0) / (sp.tier ?? 0.7)));
      for (let w = 0; w < nW; w++) {
        const y = y0 + (y1 - y0) * ((w + 0.3 + 0.4 * r()) / nW), tt = clamp((y - crownLo) / (crownTop - crownLo), 0, 1);
        const fL = (y - Ld[0].y) / Math.max(0.1, y1 - Ld[0].y), c0 = along(Ld, fL).p;
        const nb = Math.max(1, Math.round(((sp.limbs ?? 4) + r() * 2 - 1) / Math.sqrt(forks)));
        for (let b = 0; b < nb; b++) {
          if (r() < 0.15) continue;
          const a = (w * nb + b) * 2.39996 + r() * 0.8, out = V(Math.cos(a), 0, Math.sin(a));
          const len = Math.max(0.35, (prof(tt) - Math.hypot(c0.x, c0.z) * 0.6) * (0.7 + 0.5 * r()));
          // umbrella: every limb climbs to the canopy level and arches out under it (flat top, open bole below)
          const eUmb = clamp((H * (0.9 + 0.06 * r()) - y) / len + 0.2, -0.2, 2.5);
          const d = out.clone().setY(lerp(lerp(0.1, 0.9, tt), eUmb, umb) + (r() - 0.5) * 0.3).normalize();
          const bp = [c0.clone()], p = c0.clone();
          for (let i = 0; i < 4; i++) { d.y += lerp(0.12, -0.1, umb); d.x += (r() - 0.5) * 0.25; d.z += (r() - 0.5) * 0.25; d.normalize(); p.addScaledVector(d, len / 4); bp.push(p.clone()); }
          const phB = phase + r() * 6.28, rb = Math.max(0.016, T.radAt(Math.min(y, H * 0.95)) * 0.4);
          // clearance (placement hint `clear`, limbClearance): below head height the wood ends at the trunk's footprint
          // (pads stay); over an obstacle's floor the limb is lifted (margin: its bark radius) or, born under it, dropped.
          // Dropped parts are generated into the sink: the rest of the tree keeps its random stream.
          const L = limbClearance(bp, sp.clear, rb + 0.05), path = L.pts, acc = L.drop ? SINK : nd;
          // limb LOD: 2 / 3 / 4 tube segments at low / medium / high (most of a low-preset Scots pine's tris were limbs)
          const lb = q.seg < 0.6 ? [0, 2, 4] : q.seg < 0.9 ? [0, 1, 3, 4] : [0, 1, 2, 3, 4];
          const lk = lb.filter((i) => i <= L.woodN);
          if (lk.length >= 2) tube(bark, lk.map((i) => path[i]), lk.map((i) => Math.max(0.01, rb * (1 - i / 5))), 3, barkL, (pp) => [sway(pp.y), 0.4, phB], tint, 1);
          if (!foliage) continue;
          pad(path[4].clone().addScaledVector(d, padSz * 0.2), out, 1, phB, acc);
          const nt = Math.round((0.6 + 1.4 * r()) * Math.min(1.2, len / 1.2) * (q.twigs ?? 1));
          for (let k = 0; k < nt; k++) {
            const ft = 0.45 + 0.4 * r(), { p: tp, d: td } = along(path, ft);
            const sd = td.clone().applyAxisAngle(UP, (r() < 0.5 ? -1 : 1) * (0.6 + 0.5 * r())).setY(td.y + 0.3).normalize();
            const tl = 0.3 + 0.4 * r();
            const te = tp.clone().addScaledVector(sd, tl);
            tube(ft * 4 <= L.woodN ? bark : SINK, [tp, te], [rb * 0.5, 0.008], 3, barkL, (pp) => [sway(pp.y), 0.6, phB], tint, 1);   // twig wood past the cut: none
            pad(te, V(sd.x, 0, sd.z).normalize(), 0.85, phB, acc);
          }
        }
      }
      if (foliage) pad(Ld[Ld.length - 1].clone().add(V(0, padSz * 0.2, 0)), V(r() - 0.5, 0, r() - 0.5).normalize(), 0.7, phase);  // leader top
    }
    return crown;
  }

  return { genSpruce, genPine, along, trunk, spray, card, shade };
}
