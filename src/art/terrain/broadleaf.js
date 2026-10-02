/**
 * Broadleaf trees (pass 2, docs/vegetation.md §3.6): species architecture grown into a seeded, irregular crown
 * envelope. Every limb is aimed at the envelope and stops at it, so oaks spread, beeches make tall domes, poplars
 * columns, alders cones, acacias flat tables and willows weep (or stand pollarded with a knob of whips). Leaf
 * sprays (foliage.webp, tools/render/build_leaves.py) sit at the twig tips only, facing the sky (phototropism),
 * with shade gaps and a per-vertex crown AO (aExt.x). Leafless crowns carry fine twig sprays (a soft purple-brown
 * haze from the game camera) and, on young oaks and beeches, marcescent brown leaves. Optional ivy up the trunk.
 *
 * Built like conifers.js (feat/pine-needles): a factory that receives treegen's shared helpers, so it also runs in
 * the generation workers.
 * @module terrain/broadleaf
 */
/** Crown envelope profiles: horizontal radius (0..1) at relative crown height t (0 crown base .. 1 top). */
const PROFILE = {
  dome: (t) => Math.pow(Math.sin(Math.PI * Math.min(1, 0.14 + 0.86 * t)), 0.5),
  ovoid: (t) => Math.pow(Math.sin(Math.PI * Math.min(1, 0.04 + 0.96 * t)), 0.62) * (1 - 0.12 * t),
  oval: (t) => Math.pow(Math.sin(Math.PI * t), 0.8),
  column: (t) => Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + 0.94 * t)), 0.4) * (1 - 0.35 * t),
  cone: (t) => Math.min(1, t * 5) * Math.pow(1 - t, 0.8),
  umbrella: (t) => Math.min(1, 0.3 + t * 1.6) * (t > 0.8 ? Math.sqrt(Math.max(0, (1 - t) / 0.2)) : 1),
  round: (t) => Math.pow(Math.sin(Math.PI * t), 0.55),
};

/**
 * @param {{THREE:object, V:Function, UP:object, tube:Function, LEAF_LAYERS:string[], BARK_LAYERS:string[]}} h
 */
export function makeBroadleaves(h) {
  const { THREE, V, UP, tube, LEAF_LAYERS, BARK_LAYERS } = h;
  const lerp = (a, b, t) => a + (b - a) * t;
  const layerOf = (name, v) => (LEAF_LAYERS.indexOf(name) < 0 ? -1 : LEAF_LAYERS.indexOf(name) * 2 + v);

  /** Leaf spray card with crown-AO ext; base at p, along `up`, plane spanned by up and `right`. */
  function spray(acc, p, up, right, size, width, layer, w, tint, droop = 0) {
    const r = right.clone().multiplyScalar(size * 0.5 * width);
    const u = up.clone().multiplyScalar(size);
    const n = V().crossVectors(right, up).normalize();
    if (n.y < 0) n.negate();
    const base = p.clone().addScaledVector(up, -size * 0.06);
    // two quads: the tip half bends down by `droop` (sprays sag under their own weight)
    const mid = base.clone().addScaledVector(u, 0.5);
    const tip = mid.clone().addScaledVector(u, 0.5).add(V(0, -size * droop, 0));
    const info = (f) => [layer, w[0], w[1] + f, w[2]];
    const a = acc.vert(base.clone().sub(r), n, 0, 0, info(0), tint), b = acc.vert(base.clone().add(r), n, 1, 0, info(0), tint);
    const c = acc.vert(mid.clone().add(r), n, 1, 0.5, info(0.25), tint), d = acc.vert(mid.clone().sub(r), n, 0, 0.5, info(0.25), tint);
    const e = acc.vert(tip.clone().add(r), n, 1, 1, info(0.5), tint), f = acc.vert(tip.clone().sub(r), n, 0, 1, info(0.5), tint);
    acc.tri(a, b, c); acc.tri(a, c, d); acc.tri(d, c, e); acc.tri(d, e, f);
  }

  /** Seeded crown envelope: profile × azimuthal lobes × a lean offset. */
  function envelope(sp, r, H) {
    const prof = PROFILE[sp.crown] || PROFILE.dome;
    const yb = H * lerp(sp.crownBase?.[0] ?? 0.3, sp.crownBase?.[1] ?? 0.4, r());
    const R = H * lerp(sp.wr?.[0] ?? 0.35, sp.wr?.[1] ?? 0.45, r());
    const harm = [1, 2, 3].map((k) => ({ k, a: (0.16 / k) * (0.5 + r()), p: r() * 6.28 }));
    const off = V((r() - 0.5) * R * 0.3, 0, (r() - 0.5) * R * 0.3);
    const top = H * (1 + (r() - 0.5) * 0.08);
    const rad = (y, az) => {
      const t = (y - yb) / Math.max(0.5, top - yb);
      if (t < 0 || t > 1) return 0;
      let m = 1;
      for (const q of harm) m += q.a * Math.sin(q.k * az + q.p + t * 2.1);
      return R * prof(t) * m;
    };
    /** normalised distance of p from the crown axis (1 = on the envelope); >1 outside */
    const norm = (p) => {
      const x = p.x - off.x * ((p.y - yb) / (top - yb)), z = p.z - off.z * ((p.y - yb) / (top - yb));
      const rr = rad(p.y, Math.atan2(z, x));
      return rr <= 0.01 ? 9 : Math.hypot(x, z) / rr;
    };
    /** distance from p along unit d to the envelope (marching) */
    const reach = (p, d, max) => {
      const q = p.clone(), st = Math.max(0.2, R * 0.05);
      for (let s = st; s < max; s += st) {
        q.copy(p).addScaledVector(d, s);
        if (q.y > top || (q.y > yb + 0.3 && norm(q) > 1)) return s;
      }
      return max;
    };
    return { yb, R, top, off, rad, norm, reach };
  }

  /** Fallen branch / windthrow limb for the forest floor: a tapered, bent bough lying half sunk in the litter with a
   * few forked side limbs, some propped up off the ground. Bark only (sp.bark 'dead'); returns no crown. */
  function genFallen(sp, r, H, q, bark, tint, phase) {
    const barkLayer = BARK_LAYERS.indexOf(sp.bark), r0 = lerp(sp.r0[0], sp.r0[1], r());
    const still = () => [0, 0, phase];
    const limb = (p0, d0, L, rr, lvl, arch = 0) => {
      const n = Math.max(3, Math.round((lvl ? 4 : 7) * q.seg)), pts = [], rads = [], p = p0.clone(), d = d0.clone();
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push(p.clone()); rads.push(Math.max(0.012, rr * (1 - 0.7 * t)));
        d.add(V(r() - 0.5, 0, r() - 0.5).multiplyScalar(0.18)).setY(0).normalize();
        p.addScaledVector(d, L / n);
        const tn = (i + 1) / n;
        if (!lvl) p.y = rr * (0.35 + 0.25 * tn);                     // the bough rests, half sunk, on the litter
        else p.y = Math.max(-0.03, p0.y * (1 - tn) + Math.sin(Math.PI * tn) * arch - 0.05 * tn); // limbs arch up and back down
      }
      tube(bark, pts, rads, Math.max(3, Math.round((lvl ? 4 : 6) * q.radial)), barkLayer, still, tint, 1);
      return pts;
    };
    const a = r() * 6.28, main = limb(V(0, r0 * 0.35, 0), V(Math.cos(a), 0, Math.sin(a)), H, r0, 0);
    const nS = 2 + ((r() * 3) | 0);
    for (let k = 0; k < nS; k++) {
      const t = 0.25 + 0.65 * (k + r()) / nS, i = Math.min(main.length - 2, Math.floor(t * (main.length - 1)));
      const along = V().subVectors(main[i + 1], main[i]).normalize(), side = V(-along.z, 0, along.x).multiplyScalar(k % 2 ? 1 : -1);
      const d = along.clone().multiplyScalar(0.6).add(side).normalize(), L = H * (0.2 + 0.25 * r());
      limb(main[i].clone().setY(main[i].y + r0 * 0.3), d, L, r0 * (0.35 + 0.2 * r()) * (1 - 0.5 * t), 1, L * (0.05 + 0.12 * r()));
    }
    soilGrade(bark, 0);
    return [];
  }

  /** Leafless architecture: the summer tip level forks once more into real twig tubes (4th / 5th order). */
  function bareLevels(lv) {
    const out = lv.map((L) => ({ ...L }));
    Object.assign(out[out.length - 1], { seg: 2, radial: 3, children: 3, start: 0.3, angle: 40, lenRatio: 0.55, radRatio: 0.6, gnarl: 0.3, tropism: 0.05 });
    out.push({ seg: 2, radial: 3, children: 0 });
    return out;
  }

  /** Card frame facing `n` with its long axis along the projection of `d` (twig direction). */
  function frame(d, n) {
    let up = d.clone().addScaledVector(n, -d.dot(n));
    if (up.lengthSq() < 1e-4) up = V().crossVectors(n, Math.abs(n.y) < 0.9 ? UP : V(1, 0, 0));
    up.normalize();
    return { up, right: V().crossVectors(up, n).normalize() };
  }

  /**
   * Broadleaf / bare / dead tree into the bark + leaf accumulators (local space, before treegen's placement).
   * sp: SPECIES entry (+ crown, crownBase, wr, weep, gap, twig, marc, ivy, pollard). Returns crown points.
   */
  function genBroadleaf(sp, r, H, q, bark, leaves, tint, leafTint, phase) {
    if (sp.pollard && r() < sp.pollard) return genPollard(sp, r, H, q, bark, leaves, tint, leafTint, phase);
    if (sp.fallen) return genFallen(sp, r, H, q, bark, tint, phase);
    const env = envelope(sp, r, H);
    const barkLayer = BARK_LAYERS.indexOf(sp.bark);
    const dead = sp.bark === 'dead' || sp.bark === 'burnt';
    const bare = !sp.leaf && !dead;
    // leafless: one more order of real twig tubes (the branch structure shows from the game camera; the twig sprays
    // only add the finest haze at the tips)
    const levels = bare ? bareLevels(sp.levels) : sp.levels;
    const leafLvl = sp.leafLevel ?? sp.levels.length - 2, summerLast = sp.levels.length - 1;
    const lv = (r() * 2) | 0;
    // apple_1 carries fruit: only from late summer (sp.fruit, veg-profile treeSeason)
    const leafLayer = sp.leaf ? layerOf(sp.leaf, sp.leaf === 'apple' && !sp.fruit ? 0 : lv) : bare ? layerOf('twig', sp.twig ?? 1) : -1;
    // marcescence: only some (young) oaks and beeches keep brown leaves, and only a fraction of a summer crown
    const brown = bare && sp.marc && sp.marcV != null && r() < (sp.marcTrees ?? 0.3) ? layerOf('brown', sp.marcV) : -1;
    const l0 = leaves.count, b0 = bark.count;
    const crownPts = [], trunk = { pts: null, rads: null };
    const windFn = (lvl) => (p) => [Math.pow(Math.max(0, p.y) / H, 1.5), lvl / levels.length, phase + lvl * 0.7];
    const lastLvl = levels.length - 1;
    const cardMul = q.cards;

    function branch(p0, dir, len, r0, lvl, azi0) {
      const L = levels[lvl];
      const seg = Math.max(2, Math.round(L.seg * q.seg));
      const pts = [], rads = [], dirs = [];
      const p = p0.clone(), d = dir.clone();
      const broken = sp.broken && lvl > 0 && r() < sp.broken ? 0.4 + 0.4 * r() : 1;
      for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        pts.push(p.clone()); dirs.push(d.clone());
        let rr = lerp(r0, r0 * (lvl === 0 ? 0.32 : 0.22), t);
        if (lvl === 0) rr *= 1 + (sp.flare || 0) * Math.pow(Math.max(0, 1 - t * 8), 3);
        rads.push(Math.max(bare && lvl >= 2 ? 0.011 : 0.006, rr)); // bare twigs: thin, but not sub-pixel dust
        if (i < seg) {
          d.add(V(r() - 0.5, (r() - 0.5) * 0.5, r() - 0.5).multiplyScalar(L.gnarl || 0));
          d.y += (L.tropism || 0) - (sp.weep || 0) * 0.22 * lvl * t;
          d.normalize();
          p.addScaledVector(d, (len * broken) / seg);
        }
      }
      if (lvl === 0) { trunk.pts = pts; trunk.rads = rads; }
      const radial = Math.max(3, Math.round(L.radial * q.radial));
      tube(bark, pts, rads, radial, barkLayer, windFn(lvl), tint, Math.max(1, Math.round((2 * Math.PI * r0) / 0.5)));
      if (broken < 1) return;
      const nC = L.children ? Math.max(1, Math.round(L.children * (0.75 + 0.5 * r()) * (lvl >= 2 ? q.twigs : 1))) : 0;
      // trunk: limbs start at the crown base (clear bole below)
      const t0 = lvl === 0 ? Math.max(L.start, Math.min(0.85, (env.yb * 0.92 - p0.y) / Math.max(1, len))) : L.start;
      let azi = azi0 + r() * 6.28;
      for (let c = 0; c < nC; c++) {
        const t = lerp(t0, 0.97, (c + 0.3 + 0.5 * r()) / nC);
        const fi = t * seg, i = Math.min(seg - 1, Math.floor(fi)), f = fi - i;
        const cp = pts[i].clone().lerp(pts[i + 1], f);
        const pd = dirs[i].clone().lerp(dirs[i + 1], f).normalize();
        azi += 2.4 + (r() - 0.5) * 0.6;
        const ax = V().crossVectors(pd, Math.abs(pd.y) < 0.9 ? UP : V(1, 0, 0)).normalize().applyAxisAngle(pd, azi);
        const cd = pd.clone().applyAxisAngle(ax, THREE.MathUtils.degToRad(L.angle * (0.75 + 0.5 * r())));
        const inside = env.norm(cp) < 1 || cp.y < env.yb;
        const room = inside ? env.reach(cp, cd, H) : 0.4 + 0.6 * r();
        const cap = len * L.lenRatio * (lvl === 0 ? 2.2 : 1.6);
        const clen = Math.max(0.35, Math.min(cap, room * (lvl === 0 ? 0.82 + 0.15 * r() : 0.55 + 0.4 * r())));
        const cr = lerp(r0, r0 * 0.3, t) * L.radRatio;
        branch(cp, cd, clen, cr, lvl + 1, azi);
      }
      if (bare) { bareSprays(pts, dirs, seg, lvl); return; }
      // sprays at the twig tips (outer part of the leaf-level branches); shade gaps drop whole branches
      if (leafLayer < 0 || lvl < leafLvl) return;
      if (r() < (sp.gap ?? 0.1)) return;
      const n = Math.max(1, Math.round(sp.leaves * cardMul * (0.7 + 0.6 * r()) * (lvl === lastLvl ? 1 : 0.6)));
      for (let k = 0; k < n; k++) {
        const t = lerp(sp.leafStart ?? 0.35, 1, Math.sqrt(r()));
        const fi = t * seg, i = Math.min(seg - 1, Math.floor(fi));
        const cp = pts[i].clone().lerp(pts[i + 1], fi - i);
        addSpray(cp, dirs[i], lvl);
      }
    }

    /** Leafless crown: a sparse twig spray at some twig tips; marcescent leaves (10-30 % of a summer crown) clumped on
     * the lower and inner branches of the summer leaf levels. */
    function bareSprays(pts, dirs, seg, lvl) {
      // twig-spray cards (a purple-brown haze on oak / beech / lime); birch has none: its fine pendulous twigs are the
      // tubes, and the dark spray tiles read as dead leaf balls on a February birch (critic)
      if (lvl === lastLvl && leafLayer >= 0 && r() < 0.5 * q.cards * (sp.twigSpray ?? 1)) addSpray(pts[seg], dirs[seg - 1], lvl, leafLayer);
      if (brown < 0 || lvl < leafLvl || lvl > summerLast) return;
      const n = sp.leaves * q.cards * sp.marc * (lvl === summerLast ? 1.1 : 0.7) * (0.5 + r());
      for (let k = 0, m = Math.floor(n + r()); k < m; k++) {
        const fi = lerp(0.25, 1, r()) * seg, i = Math.min(seg - 1, Math.floor(fi));
        const cp = pts[i].clone().lerp(pts[i + 1], fi - i);
        const hy = (cp.y - env.yb) / Math.max(0.5, env.top - env.yb);
        if (r() < hy * 1.3 + Math.max(0, env.norm(cp) - 0.7)) continue; // lower and inner crown
        addSpray(cp, dirs[i], lvl, brown);
      }
    }

    function addSpray(cp, d, lvl, layerIn) {
      const out = V(cp.x - env.off.x, 0, cp.z - env.off.z);
      out.lengthSq() > 1e-4 ? out.normalize() : out.set(1, 0, 0);
      const weep = sp.weep || 0;
      // phototropism: sprays face the sky and outward; weeping sprays hang
      const n = V(0, bare ? 0.5 : 1.0 - weep * 0.5, 0).addScaledVector(out, bare ? 0.9 : 0.55).add(V(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(bare ? 1.4 : 0.9)).normalize();
      const dd = d.clone().add(V(0, -weep * 1.6, 0)).addScaledVector(out, 0.3).normalize();
      const { up, right } = frame(dd, n);
      const layer = layerIn ?? leafLayer, marc = bare && layer === brown;
      const size = lerp(sp.leafSize[0], sp.leafSize[1], r()) * q.leafScale * (0.8 + 0.25 * H / sp.H[1]) * (bare ? (marc ? 0.68 : 0.7) : 1);
      const w = [Math.pow(Math.max(0, cp.y) / H, 1.5), 1, phase + r() * 6.28];
      const sh = 0.85 + 0.3 * r();
      const tnt = bare && !marc ? [tint[0] * sh, tint[1] * sh, tint[2] * sh] : [leafTint[0] * sh, leafTint[1] * sh, leafTint[2] * sh];
      spray(leaves, cp, up, right, size, sp.sprayW ?? 1, layer, w, tnt, weep ? 0.05 : 0.12 + 0.1 * r());
      crownPts.push(cp);
    }

    const stems = sp.stems ? sp.stems[0] + ((r() * (sp.stems[1] - sp.stems[0] + 1)) | 0) : 1;
    const r0 = lerp(sp.r0[0], sp.r0[1], r()) * (H / sp.H[1]) ** 0.6 / Math.sqrt(stems);
    const trunkLen = H * (sp.crown === 'column' || sp.crown === 'cone' ? 0.95 : sp.trunk ?? 0.72);
    for (let s = 0; s < stems; s++) {
      const a = r() * 6.28, lean = stems > 1 ? 0.3 + 0.2 * r() : (sp.lean ?? 0.05) * r();
      const dir = V(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
      branch(V(Math.cos(a) * 0.1 * (stems - 1), -0.15, Math.sin(a) * 0.1 * (stems - 1)), dir, trunkLen / (stems > 1 ? 1.1 : 1), r0, 0, r() * 6.28);
    }
    // root flare (big trees): short buttresses that swell out of the trunk foot and arch down into the soil within a
    // metre, curving all the way (no straight run over ~0.3 m), partly buried; graded into the soil colour below
    if (sp.roots && trunk.pts && !sp.pollard) {
      const nR = Math.round((4 + 2 * r()) * Math.min(1, q.radial + 0.2));
      for (let k = 0; k < nR; k++) {
        const a = (k / nR) * 6.28 + (r() - 0.5) * 0.7, o = V(Math.cos(a), 0, Math.sin(a)), side = V(-o.z, 0, o.x);
        const L = r0 * (1.4 + 1.2 * r()) + 0.2, bend = (r() - 0.5) * 0.5, h0 = r0 * (0.8 + 0.5 * r()) + 0.06;
        const pts = [], rads = [];
        for (let i = 0; i <= 5; i++) {
          const t = i / 5, d = r0 * 0.55 + L * t;
          // quarter-ellipse profile: steep off the trunk, flattening as it meets the ground, then diving under it
          const y = h0 * Math.pow(1 - t, 2.2) - 0.22 * t * t;
          pts.push(o.clone().multiplyScalar(d).addScaledVector(side, bend * L * t * t).setY(y));
          rads.push(r0 * lerp(0.5, 0.07, Math.pow(t, 0.8)));
        }
        tube(bark, pts, rads, 5, barkLayer, () => [0, 0, phase], tint, 1);
      }
    }
    soilGrade(bark, b0);
    // shell fill: sprays on the envelope surface near existing tips, so the canopy reads as a mass with sky holes
    if (sp.leaf && crownPts.length > 8) {
      const nFill = Math.round(crownPts.length * (sp.fill ?? 0.35) * q.cards);
      for (let k = 0; k < nFill; k++) {
        const a = crownPts[(r() * crownPts.length) | 0];
        if (env.norm(a) < 0.6) continue;
        const p = a.clone().add(V(r() - 0.5, (r() - 0.5) * 0.6, r() - 0.5).multiplyScalar(1.1));
        addSpray(p, V(p.x - env.off.x, 0.4, p.z - env.off.z).normalize(), lastLvl);
      }
    }
    crownAO(leaves, l0, env);
    if (sp.ivy && trunk.pts) ivy(trunk, r, H, leaves, leafTint, phase, env.yb); // after the crown AO: ivy faces the open air
    return crownPts;
  }

  /** Bark within ~0.45 m of the ground takes on a soil tone (root flare and trunk foot grade into the terrain). */
  function soilGrade(acc, from) {
    for (let i = from; i < acc.count; i++) {
      const y = acc.p[i * 3 + 1];
      if (y > 0.45) continue;
      const t = Math.max(0, Math.min(1, (y + 0.05) / 0.5)), k = 1 - 0.42 * (1 - t) * (1 - t);
      acc.tint[i * 3] *= k * 1.02; acc.tint[i * 3 + 1] *= k * 0.96; acc.tint[i * 3 + 2] *= k * 0.86;
    }
  }

  /** Per-vertex crown AO (aExt.x) from the depth inside the envelope and the height in the crown; aExt.y = n.y. */
  function crownAO(acc, from, env) {
    const p = V();
    for (let i = from; i < acc.count; i++) {
      p.fromArray(acc.p, i * 3);
      const d = Math.min(1, env.norm(p)), hy = Math.min(1, Math.max(0, (p.y - env.yb) / Math.max(0.5, env.top - env.yb)));
      acc.ext[i * 2] = Math.min(acc.ext[i * 2], Math.max(0.28, (0.22 + 0.85 * Math.pow(d, 1.5)) * (0.7 + 0.3 * hy)));
      acc.ext[i * 2 + 1] = acc.n[i * 3 + 1];
    }
  }

  /** Ivy: evergreen leaf cards spiralling up the trunk, hugging the bark (aExt AO dimmed). */
  function ivy(trunk, r, H, leaves, leafTint, phase, yb) {
    const layer = layerOf('ivy', (r() * 2) | 0);
    if (layer < 0) return;
    const { pts, rads } = trunk;
    const top = Math.min(pts[pts.length - 1].y, yb + 1.5) * (0.6 + 0.4 * r());
    let a = r() * 6.28;
    const tn = [0.95 * leafTint[0], 1.05 * leafTint[1], 0.95 * leafTint[2]];
    for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 0; k < 3; k++) {
        const f = (k + r()) / 3, p = pts[i].clone().lerp(pts[i + 1], f), rad = lerp(rads[i], rads[i + 1], f);
        if (p.y < 0.1 || p.y > top) continue;
        a += 0.8 + r() * 0.9;
        const out = V(Math.cos(a), 0, Math.sin(a));
        const up = V((r() - 0.5) * 0.5, 1, (r() - 0.5) * 0.5).addScaledVector(out, -0.05).normalize();
        const right = V().crossVectors(up, out).normalize();
        const size = 0.45 + 0.35 * r();
        spray(leaves, p.clone().addScaledVector(out, rad + 0.03), up, right, size, 1, layer, [Math.pow(p.y / H, 1.5) * 0.3, 0.2, phase + r() * 6.28], tn, 0.02);
      }
    }
  }

  /** Pollarded willow: a short trunk with a knobbly head and a crown of straight whips (river banks, Belgium). */
  function genPollard(sp, r, H, q, bark, leaves, tint, leafTint, phase) {
    const barkLayer = BARK_LAYERS.indexOf(sp.bark);
    const bare = !sp.leaf;
    const layer = sp.leaf ? layerOf(sp.leaf, (r() * 2) | 0) : layerOf('twig', 0);
    const l0 = leaves.count;
    const th = 2 + 1.3 * r(), r0 = lerp(sp.r0[0], sp.r0[1], r()) * 1.25;
    const lean = V((r() - 0.5) * 0.25, 1, (r() - 0.5) * 0.25).normalize();
    const pts = [], rads = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      pts.push(lean.clone().multiplyScalar(th * t).add(V((r() - 0.5) * 0.08, -0.15, (r() - 0.5) * 0.08)));
      rads.push(r0 * (1 + 0.6 * Math.pow(Math.max(0, 1 - t * 6), 3) + 0.45 * Math.pow(Math.max(0, t * 1.4 - 0.4), 2)));
    }
    tube(bark, pts, rads, Math.max(5, Math.round(9 * q.radial)), barkLayer, (p) => [Math.pow(Math.max(0, p.y) / H, 1.5), 0, phase], tint, 2);
    const head = pts[pts.length - 1];
    const crown = [];
    const nW = Math.round((18 + 14 * r()) * Math.min(1, q.twigs + 0.2));
    const wl = (H - th) * (0.8 + 0.2 * r());
    for (let k = 0; k < nW; k++) {
      const a = r() * 6.28, el = 0.25 + 0.65 * r();
      const d = V(Math.cos(a) * el, 1, Math.sin(a) * el).normalize();
      const p0 = head.clone().add(V(Math.cos(a) * r0, (r() - 0.3) * 0.3, Math.sin(a) * r0));
      const L = wl * (0.55 + 0.45 * r()), wp = [p0], wr = [0.035, 0.022, 0.012];
      const p = p0.clone(), dd = d.clone();
      for (let i = 0; i < 2; i++) { dd.y -= (sp.weep || 0) * 0.15 * i; dd.normalize(); p.addScaledVector(dd, L / 2); wp.push(p.clone()); }
      tube(bark, wp, wr, 3, barkLayer, (pp) => [Math.pow(Math.max(0, pp.y) / H, 1.5), 0.6, phase + k], tint, 1);
      const nl = bare ? (r() < 0.4 ? 1 : 0) : Math.max(1, Math.round(5 * q.cards * L / 2));
      for (let j = 0; j < nl; j++) {
        const t = 0.25 + 0.75 * r(), cp = wp[0].clone().lerp(wp[2], t);
        const n = V((r() - 0.5), 0.6, (r() - 0.5)).addScaledVector(V(Math.cos(a), 0, Math.sin(a)), 0.7).normalize();
        const { up, right } = frame(d, n);
        const sh = 0.85 + 0.3 * r();
        const tn = bare ? [tint[0] * sh, tint[1] * sh, tint[2] * sh] : [leafTint[0] * sh, leafTint[1] * sh, leafTint[2] * sh];
        spray(leaves, cp, up, right, lerp(sp.leafSize[0], sp.leafSize[1], r()) * q.leafScale, sp.sprayW ?? 1, layer, [Math.pow(cp.y / H, 1.5), 1, phase + r() * 6.28], tn, 0.15);
        crown.push(cp);
      }
    }
    const yb = th, top = H;
    crownAO(leaves, l0, { yb, top, norm: (p) => Math.min(1, 0.35 + Math.hypot(p.x - head.x, p.z - head.z) / Math.max(0.5, (p.y - th) * 0.7 + 0.5)) });
    return crown;
  }

  return { spray, envelope, frame, crownAO, genBroadleaf };
}

export { PROFILE };
