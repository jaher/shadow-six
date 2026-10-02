/**
 * Shrubs, hedges and garden box (pass 2, docs/vegetation.md §3.4–3.5). Multi-stem woody frames (a fountain of stems
 * with side shoots) grown into a seeded envelope: a ragged dome for free shrubs (hazel, hawthorn, gorse), a layered
 * mass with a ragged top and a gappy, stemmy base for field hedges, a superellipsoid for clipped box, and a
 * wind-sheared wedge for coastal shrubs (low on the windward side, streaming downwind). Species leaf sprays sit at
 * the shoot tips and over the envelope shell, with crown AO (aExt.x) from the depth inside the mass. Leafless in
 * winter: twig sprays.
 * @module terrain/shrubs
 */

/**
 * @param {{THREE:object, V:Function, UP:object, tube:Function, LEAF_LAYERS:string[], BARK_LAYERS:string[],
 *   spray:Function, frame:Function, crownAO:Function}} h helpers (treegen + broadleaf.js)
 */
export function makeShrubs(h) {
  const { V, tube, LEAF_LAYERS, BARK_LAYERS, spray, frame, crownAO } = h;
  const lerp = (a, b, t) => a + (b - a) * t;
  const layerOf = (name, v) => (LEAF_LAYERS.indexOf(name) < 0 ? -1 : LEAF_LAYERS.indexOf(name) * 2 + v);

  /** Envelope: norm(p) = 1 on the surface. Shapes: dome | hedge | box | wedge (wind-sculpted, +x downwind). */
  function envelope(sp, r, H, R) {
    const el = sp.shape === 'box' ? 1 : 0.8 + 0.5 * r();
    const Rx = R * Math.sqrt(el), Rz = R / Math.sqrt(el);
    const harm = [2, 3, 5].map((k) => ({ k, a: (sp.shape === 'box' ? 0.02 : sp.shape === 'hedge' ? 0.12 : 0.22) / Math.sqrt(k) * (0.5 + r()), p: r() * 6.28 }));
    const yc = H * (sp.shape === 'box' ? 0.5 : 0.52), Ry = H * 0.5;
    const pw = sp.shape === 'box' ? 4 : sp.shape === 'hedge' ? 3 : 2;
    const norm = (p) => {
      let x = p.x, y = p.y - yc;
      if (sp.shape === 'wedge') { // windward side clipped low, crown streams downwind (+x)
        const s = Math.min(1, Math.max(0, (x / Rx + 1) / 2));
        y = p.y - yc * (0.45 + 0.75 * s);
        x -= (p.y / H) * Rx * 0.35;
      }
      let zz = p.z;
      if (sp.shape === 'vase') { const k = 0.4 + 0.6 * Math.min(1, Math.max(0, p.y / H)); x /= k; zz /= k; } // multi-stem fountain
      const az = Math.atan2(p.z, p.x);
      let m = 1;
      for (const q of harm) m += q.a * Math.sin(q.k * az + q.p + p.y * 1.7);
      if (sp.shape === 'hedge' && p.y > H * 0.7) m *= 1 + 0.12 * Math.sin(p.x * 3.1 + harm[0].p) * Math.sin(p.z * 2.3 + harm[1].p); // ragged top
      const v = Math.pow(Math.abs(x / Rx), pw) + Math.pow(Math.abs(zz / Rz), pw) + Math.pow(Math.abs(y / Ry), pw);
      return Math.pow(v, 1 / pw) / m;
    };
    const reach = (p, d, max) => {
      const q = p.clone(), st = Math.max(0.08, R * 0.06);
      for (let s = st; s < max; s += st) { q.copy(p).addScaledVector(d, s); if (q.y > 0.2 && norm(q) > 1) return s; }
      return max;
    };
    return { Rx, Rz, yc, Ry, norm, reach, yb: 0, top: H, off: V(0, 0, 0) };
  }

  /** Shrub / hedge / box into the bark + leaf accumulators (local space). Returns crown points. */
  function genShrub(sp, r, H, q, bark, leaves, tint, leafTint, phase) {
    const R = lerp(sp.R[0], sp.R[1], r());
    const env = envelope(sp, r, H, R);
    const barkLayer = BARK_LAYERS.indexOf(sp.bark);
    const bare = !sp.leaf && sp.bark !== 'burnt';
    const leafLayer = sp.leaf ? layerOf(sp.leaf, sp.leafV ?? ((r() * 2) | 0)) : bare ? layerOf('twig', sp.twig ?? 0) : -1;
    const l0 = leaves.count, crown = [];
    const wf = (lvl) => (p) => [Math.pow(Math.max(0, p.y) / H, 1.2) * 0.6, lvl * 0.3, phase + lvl];
    const sprayAt = (cp, d, sizeMul = 1) => {
      if (leafLayer < 0) return;
      const out = V(cp.x / env.Rx, (cp.y - env.yc) / env.Ry * 0.6 + 0.5, cp.z / env.Rz);
      out.lengthSq() > 1e-4 ? out.normalize() : out.set(0, 1, 0);
      const n = out.clone().add(V(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(bare ? 1.2 : 0.7)).normalize();
      const { up, right } = frame(d.clone().addScaledVector(out, 0.5).normalize(), n);
      const size = lerp(sp.leafSize[0], sp.leafSize[1], r()) * q.leafScale * sizeMul * (bare ? 1.15 : 1);
      const sh = 0.82 + 0.33 * r();
      const tn = bare ? [tint[0] * sh, tint[1] * sh, tint[2] * sh] : [leafTint[0] * sh, leafTint[1] * sh, leafTint[2] * sh];
      spray(leaves, cp.clone().addScaledVector(up, -size * 0.35), up, right, size, sp.sprayW ?? 1, leafLayer, [Math.pow(Math.max(0, cp.y) / H, 1.2) * 0.6, 1, phase + r() * 6.28], tn, 0.08);
      crown.push(cp);
    };
    // woody frame: a fountain of stems with side shoots, each aimed at the envelope
    const nS = Math.max(2, Math.round(lerp(sp.stems?.[0] ?? 4, sp.stems?.[1] ?? 8, r()) * Math.min(1, q.twigs + 0.25)));
    const rs = (sp.stemR ?? 0.035) * Math.sqrt(H / 2 + 0.3);
    for (let s = 0; s < nS; s++) {
      const a = (s / nS) * 6.28 + r() * 0.9, sprd = sp.shape === 'box' ? 0.5 : 0.35 + 0.6 * r();
      const base = V(Math.cos(a) * env.Rx * 0.25 * r(), -0.05, Math.sin(a) * env.Rz * 0.25 * r());
      const d = V(Math.cos(a) * sprd, 1, Math.sin(a) * sprd).normalize();
      const L = env.reach(base.clone().setY(0.25), d, H * 1.5) * (0.85 + 0.12 * r());
      const pts = [base], p = base.clone(), dd = d.clone();
      for (let i = 0; i < 3; i++) { dd.add(V((r() - 0.5) * 0.25, -0.06 * i * (sp.arch || 0), (r() - 0.5) * 0.25)).normalize(); p.addScaledVector(dd, L / 3); pts.push(p.clone()); }
      tube(bark, pts, [rs, rs * 0.75, rs * 0.5, rs * 0.25], 3, barkLayer, wf(0), tint, 1);
      // side shoots
      const nB = Math.round((sp.shoots ?? 4) * (0.7 + 0.6 * r()) * q.twigs);
      for (let b = 0; b < nB; b++) {
        const t = 0.3 + 0.65 * ((b + r()) / Math.max(1, nB));
        const fi = t * 3, i = Math.min(2, Math.floor(fi));
        const cp = pts[i].clone().lerp(pts[i + 1], fi - i);
        const bd = V().subVectors(pts[i + 1], pts[i]).normalize();
        const side = V(r() - 0.5, (r() - 0.3) * 0.6, r() - 0.5).normalize();
        const sd = bd.clone().multiplyScalar(0.5).add(side).normalize();
        const sl = Math.max(0.25, env.reach(cp, sd, R * 1.5) * (0.6 + 0.35 * r()));
        const e = cp.clone().addScaledVector(sd, sl);
        if (q.twigs >= 0.75) tube(bark, [cp, cp.clone().lerp(e, 0.5), e], [rs * 0.4, rs * 0.25, rs * 0.12], 3, barkLayer, wf(1), tint, 1);
        const nl = 1 + Math.round(1.5 * r() * q.cards);
        for (let k = 0; k < nl; k++) sprayAt(cp.clone().lerp(e, 0.55 + 0.45 * r()), sd);
      }
      sprayAt(pts[3], dd);
    }
    // shell: sprays over the envelope surface (density from sp.cards), facing out; the lower 20 % stays thin
    const nShell = Math.round((sp.cards ?? 60) * q.cards * (R / sp.R[1]) * Math.sqrt(H / sp.H[1]) * (bare ? 0.55 : 1));
    // sprays bunch into lobes (the shoot clusters of a real bush), with darker gaps between them
    const lobes = Array.from({ length: sp.shape === 'box' ? 1 : 5 + ((r() * 5) | 0) }, () => {
      const u = r() * 6.28, v = Math.acos(lerp(-0.2, 0.95, r()));
      return V(Math.cos(u) * Math.sin(v), Math.cos(v), Math.sin(u) * Math.sin(v));
    });
    const spread = sp.shape === 'box' ? 9 : sp.shape === 'hedge' ? 0.75 : 0.55;
    for (let k = 0, tries = 0; k < nShell && tries < nShell * 6; tries++) {
      let dir;
      if (sp.shape === 'box') { const u = r() * 6.28, v = Math.acos(lerp(-0.35, 1, r())); dir = V(Math.cos(u) * Math.sin(v), Math.cos(v), Math.sin(u) * Math.sin(v)); }
      else dir = lobes[(r() * lobes.length) | 0].clone().add(V(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(spread * 2)).normalize();
      if (dir.y < -0.35) continue;
      const c = V(0, env.yc * 0.8, 0);
      const s = env.reach(c, dir, Math.max(H, R) * 2) * (0.82 + 0.16 * r());
      const p = c.addScaledVector(dir, s);
      if (p.y < H * (sp.shape === 'hedge' ? 0.22 : 0.12) && r() < 0.8) continue;
      k++;
      sprayAt(p, V(dir.x, Math.abs(dir.y) + 0.3, dir.z).normalize(), 0.9);
    }
    crownAO(leaves, l0, env);
    return crown;
  }

  return { genShrub, envelope };
}
