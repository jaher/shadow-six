/**
 * Palms (pass 2, docs/vegetation.md §3.3). Date palm: a tapered fibrous trunk ringed with leaf-base stubs ("boots"),
 * a crown of 18–30 pinnate fronds in phyllotaxis (young ones upright, old ones drooping), each frond a rachis tube
 * with 25–45 pairs of separate leaflet quads in a V section that shorten towards the tip, a skirt of dead brown
 * fronds hanging down the trunk (unless pruned), suckers at the foot and orange date bunches under the crown in
 * autumn. Canary palm: thick straight trunk, dense round crown of arching bright fronds.
 * @module terrain/palms
 */

/**
 * @param {{THREE:object, V:Function, tube:Function, LEAF_LAYERS:string[], BARK_LAYERS:string[]}} h
 */
export function makePalms(h) {
  const { V, tube, LEAF_LAYERS, BARK_LAYERS } = h;
  const lerp = (a, b, t) => a + (b - a) * t;
  const LEAF = LEAF_LAYERS.indexOf('palmleaf') * 2;

  /** One leaflet: a thin quad from base b along d, plane normal n (V fold carried by the texture normal). */
  function leaflet(acc, b, d, n, L, w, layer, info, tint, ao) {
    const side = V().crossVectors(n, d).normalize().multiplyScalar(w * 0.5);
    const tip = b.clone().addScaledVector(d, L);
    const e = [ao, n.y];
    const i0 = acc.vert(b.clone().sub(side), n, 0, 0, info(0), tint, e), i1 = acc.vert(b.clone().add(side), n, 1, 0, info(0), tint, e);
    const i2 = acc.vert(tip.clone().add(side), n, 1, 1, info(0.15), tint, e), i3 = acc.vert(tip.clone().sub(side), n, 0, 1, info(0.15), tint, e);
    acc.tri(i0, i1, i2); acc.tri(i0, i2, i3);
  }

  /**
   * A pinnate frond from p0: azimuth az, start elevation el (rad), length len. Rachis bends down with age/gravity.
   * @returns {THREE.Vector3[]} rachis points
   */
  function frond(bark, leaves, p0, az, el, len, o) {
    const { r, q, H, phase, f, dry, tint, leafTint, barkLayer } = o;
    const out = V(Math.cos(az), 0, Math.sin(az)), side = V(-Math.sin(az), 0, Math.cos(az));
    const S = Math.max(4, Math.round(7 * q.seg + 1));
    const pts = [p0.clone()], rads = [];
    let e = el;
    const p = p0.clone();
    // gentle arch (critic: fronds drooped near-vertically → cypress-like cones): ~25-40° of bend over the frond
    const sag = dry ? 0.02 : (0.035 + 0.025 * r()) * (o.arch ?? 1);
    for (let i = 0; i < S; i++) {
      const dir = out.clone().multiplyScalar(Math.cos(e)).add(V(0, Math.sin(e), 0));
      p.addScaledVector(dir, len / S);
      pts.push(p.clone());
      e -= sag * (1 + Math.max(0, Math.cos(e)));
    }
    for (let i = 0; i <= S; i++) rads.push(0.045 * (1 - 0.8 * i / S) * (len / 4));
    const wf = (pp) => [Math.pow(Math.max(0, pp.y) / H, 2), 0.3 + 0.7 * Math.min(1, pp.distanceTo(p0) / len), phase + f * 0.37];
    tube(bark, pts, rads, 3, barkLayer, wf, dry ? [tint[0] * 0.9, tint[1] * 0.8, tint[2] * 0.6] : [tint[0] * 0.8, tint[1] * 0.9, tint[2] * 0.6], 1);
    // leaflets: pairs along the rachis in a V (two ranks per side at slightly different angles)
    const nP = Math.round((dry ? 16 : 26 + 16 * r()) * Math.min(1, q.cards + 0.15));
    const layer = LEAF + (dry ? 1 : 0);
    for (let k = 0; k < nP; k++) {
      const t = 0.14 + 0.86 * (k + 0.5 * r()) / nP;
      const fi = t * S, i = Math.min(S - 1, Math.floor(fi));
      const b = pts[i].clone().lerp(pts[i + 1], fi - i);
      const rd = V().subVectors(pts[i + 1], pts[i]).normalize();
      const L = len * (dry ? 0.16 : 0.2) * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + 0.95 * t)), 0.6) * (t < 0.22 ? 0.5 : 1) * (0.85 + 0.3 * r());
      const w = L * 0.11 * (o.wide ?? 1);
      const flex = 0.3 + 0.7 * t;
      const info = (df) => [layer, Math.pow(Math.max(0, b.y) / H, 2), flex + df, phase + f * 0.37 + k * 0.21];
      for (const s of [-1, 1]) {
        const rank = r() < 0.5 ? 0 : 1;
        const vUp = (dry ? -0.2 : 0.55 + 0.25 * rank) + (r() - 0.5) * 0.25;   // V section: leaflets rise from the rachis
        const fw = 0.55 + 0.25 * r();                                           // and point forward along it
        const d = rd.clone().multiplyScalar(fw).addScaledVector(side, s * (1 - fw * 0.5)).add(V(0, vUp, 0)).normalize();
        const n = V().crossVectors(d, rd).multiplyScalar(s).normalize();
        if (n.y < 0) n.negate();
        n.y += 0.9; n.normalize();                                              // glossy blades catch the sky
        const sh = 0.85 + 0.3 * r();
        // glaucous grey-green (waxy bloom): lighter and bluer than a broadleaf, little crown darkening
        const lt = dry ? [sh, sh * 0.95, sh * 0.9] : [leafTint[0] * sh * 1.32, leafTint[1] * sh * 1.42, leafTint[2] * sh * 1.55];
        leaflet(leaves, b, d, n, L, w, layer, info, lt, dry ? 0.75 : lerp(0.92, 1, t));
      }
    }
    return pts;
  }

  /** Date / Canary palm into bark + leaves (local space). Returns crown points. */
  function genPalm(sp, r, H, q, bark, leaves, tint, leafTint, phase) {
    const barkLayer = BARK_LAYERS.indexOf('palm');
    const canary = sp.form === 'canary';
    const r0 = lerp(sp.r0[0], sp.r0[1], r());
    const seg = Math.max(6, Math.round(14 * q.seg));
    const a = r() * 6.28, lean = canary ? 0.03 * r() : 0.05 + 0.3 * r() * r();
    const d = V(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
    const p = V(0, -0.2, 0), pts = [], rads = [];
    const ring = 0.22 + 0.06 * r();                     // leaf-base rings every ~25 cm
    const rows = Math.max(seg * 3, Math.round((H / ring) * 3 * Math.min(1, q.seg + 0.2)));   // ≥ 3 rows per ring
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      pts.push(p.clone());
      const swell = 1 + 0.5 * Math.pow(Math.max(0, 1 - t * 6), 2);
      const ph = (t * H / ring) % 1, rings = 1 + 0.3 * Math.pow(ph, 2.2) - 0.06;   // sawtooth: each leaf base juts out at its top
      rads.push(r0 * swell * rings * (canary ? 1.1 - 0.15 * t : 1 - 0.18 * t) * (t > 0.92 ? 1.25 : 1));
      d.y += canary ? 0.0 : 0.012 * t; d.normalize();
      p.addScaledVector(d, H / rows);
    }
    tube(bark, pts, rads, Math.max(5, Math.round(9 * q.radial)), barkLayer, (pp) => [Math.pow(Math.max(0, pp.y) / H, 2), 0, phase], tint, 2);
    const top = pts[pts.length - 1];
    const o = { r, q, H, phase, tint, leafTint, barkLayer, arch: canary ? 1.3 : 1, wide: canary ? 1.3 : 1 };
    const crown = [];
    // boots: short stubs of cut / broken leaf bases spiralling round the upper trunk
    // date palm: the cut leaf bases cover the upper ~60 % of the trunk in a criss-cross (diamond) pattern of wedge
    // stubs; their lighter cut faces against the dark fibre are what read from the game camera
    const nBoot = Math.round((canary ? 10 : 70) * Math.min(1, q.cards + 0.2));
    for (let k = 0; k < nBoot; k++) {
      const t = 1 - (k / nBoot) * (canary ? 0.12 : 0.6), i = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
      const c = pts[i], az = k * 2.39996 + r() * 0.3, out = V(Math.cos(az), 0.75, Math.sin(az)).normalize();
      const rr = rads[i] * 0.85, L = 0.12 + 0.12 * r() * (canary ? 1.5 : 1);
      const lt = k % 3 === 0 ? 1.25 : 0.8;   // fresh cuts pale, weathered ones dark
      tube(bark, [c.clone().addScaledVector(out, rr * 0.5), c.clone().addScaledVector(out, rr + L)], [0.085, 0.05], 3, barkLayer,
        (pp) => [Math.pow(Math.max(0, pp.y) / H, 2), 0, phase], [tint[0] * 0.95 * lt, tint[1] * 0.82 * lt, tint[2] * 0.62 * lt], 1);
    }
    const nF = Math.round((canary ? 40 + r() * 16 : 24 + r() * 12) * Math.min(1, q.cards + 0.25));
    let az = r() * 6.28;
    for (let f = 0; f < nF; f++) {
      az += 2.39996 + (r() - 0.5) * 0.25;
      const age = f / nF;
      // a radial rosette: most fronds leave the crown 20-45° above horizontal, the youngest steeper, the oldest flat
      const el = lerp(1.15, canary ? -0.1 : 0.12, Math.pow(age, 0.85)) + (r() - 0.5) * 0.22;
      const len = (canary ? 4.2 + 1.2 * r() : 3 + 1.8 * r()) * (0.75 + 0.25 * H / sp.H[1]);
      crown.push(...frond(bark, leaves, top.clone().add(V(Math.cos(az) * r0 * 0.6, -0.1 * age, Math.sin(az) * r0 * 0.6)), az, el, len, { ...o, f, dry: false }));
    }
    // dead-frond skirt (unless pruned: town palms)
    const skirt = sp.pruned || r() < 0.25 ? 0 : Math.round((canary ? 3 : 5 + 9 * r()) * Math.min(1, q.cards + 0.3));
    for (let k = 0; k < skirt; k++) {
      az += 2.39996;
      frond(bark, leaves, top.clone().add(V(0, -0.3 - 0.5 * r(), 0)), az, -1.35 - 0.15 * r(), 2.2 + r(), { ...o, f: nF + k, dry: true });
    }
    // date bunches under the crown (Aug–Dec): stalk + a fat orange cluster
    // (the rolls are drawn whether or not the dates are ripe, so the season never reshapes the rest of the palm)
    const dRoll = r(), nb = 2 + ((r() * 4) | 0), reaches = [r(), r(), r(), r(), r()];
    if (sp.dates && dRoll < 0.85) {
      for (let k = 0; k < nb; k++) {
        const b0 = top.clone().add(V(Math.cos(az + k * 1.9) * r0, -0.2, Math.sin(az + k * 1.9) * r0));
        // the orange stalk arches out between the fronds and hangs the fruit clear of the trunk (visible from above)
        const ox = Math.cos(az + k * 1.9), oz = Math.sin(az + k * 1.9), reach = 1.1 + 0.5 * reaches[k];
        const b1 = b0.clone().add(V(ox * reach, 0.05, oz * reach)), b2 = b1.clone().add(V(ox * 0.25, -0.75, oz * 0.25));
        tube(bark, [b0, b0.clone().lerp(b1, 0.5).add(V(0, 0.18, 0)), b1], [0.035, 0.03, 0.025], 3, barkLayer, (pp) => [Math.pow(Math.max(0, pp.y) / H, 2), 0.3, phase], [1.6, 1.0, 0.3], 1);
        tube(bark, [b1, b1.clone().lerp(b2, 0.35), b2], [0.14, 0.24, 0.08], 6, barkLayer, (pp) => [Math.pow(Math.max(0, pp.y) / H, 2), 0.3, phase], [2.1, 0.85, 0.2], 1);
      }
    }
    // suckers: offshoots at the foot (oasis palms)
    if (!sp.pruned && r() < (sp.suckers ?? 0.6)) {
      const ns = 1 + ((r() * 3) | 0);
      for (let k = 0; k < ns; k++) {
        const sa = r() * 6.28, base = V(Math.cos(sa) * (r0 + 0.35), 0.1, Math.sin(sa) * (r0 + 0.35));
        const nf = 6 + ((r() * 5) | 0);
        for (let f = 0; f < nf; f++) frond(bark, leaves, base, sa + f * 2.39996, 0.9 - 0.12 * f + (r() - 0.5) * 0.3, 1 + 0.7 * r(), { ...o, f: 100 + f, dry: false });
      }
    }
    return crown;
  }

  return { genPalm, frond };
}
