/**
 * Procedural German field guns for the M20 art pass (art/castle-kit Geo, field-grey paint): the 2 cm Flakvierling 38
 * (four barrels on a cruciform carriage with outriggers and jacks, armoured shield, magazines, seat) emplaced on the
 * ground or in a round masonry ring on a rampart, and a towed light field gun (split trail, spoked steel wheels,
 * shield, recoil cylinder). Visual only: the mission's footprints stay the gameplay ones.
 * @module art/field-guns
 */
import { Geo, localFrame, segBox, segFrame, clipConvex, flatPoly, ccw, offsetPoly } from './castle-kit.js';

/** Tube from a to b ([x, y, z]), radius r0 → r1, `seg` sides (no caps). */
export function tube(G, mat, a, b, r0, r1 = r0, seg = 8, tone = 1) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d) || 1e-6, t = d.map((v) => v / L);
  const up = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]];
  const ul = Math.hypot(...u); u = u.map((v) => v / ul);
  const v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
  const ring = (p, r, k) => { const c = Math.cos((k / seg) * Math.PI * 2), s = Math.sin((k / seg) * Math.PI * 2); return [p[0] + (u[0] * c + v[0] * s) * r, p[1] + (u[1] * c + v[1] * s) * r, p[2] + (u[2] * c + v[2] * s) * r]; };
  for (let k = 0; k < seg; k++) G.quad(mat, ring(a, r0, k), ring(a, r0, k + 1), ring(b, r1, k + 1), ring(b, r1, k), tone);
}

/** 2 cm Flakvierling 38 on its cruciform carriage at (x, y, z), heading `rot`, barrels elevated `elev` rad. */
export function flakvierling(G, x, y, z, rot = 0, elev = 0.5) {
  const F = localFrame(x, z, rot);
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {                       // cruciform base + outriggers + jacks
    const Fa = localFrame(x, z, rot + a + Math.PI / 4);
    segBox(G, 'paint', Fa, 0.3, 2.1, -0.12, 0.12, y + 0.18, y + 0.42, 0.9);
    const [jx, jz] = Fa.at(2.0, 0);
    G.cyl('paint', jx, y, jz, 0.18, 0.12, 0.42, 8, 0.75);
  }
  G.cyl('paint', x, y + 0.3, z, 0.75, 0.75, 0.25, 14, 0.85);                         // traverse ring
  G.cyl('paint', x, y + 0.55, z, 0.55, 0.5, 0.35, 12, 0.95);
  // cradle: two pairs of barrels, the mount in the middle, the shield in front
  const pivot = [x, y + 1.15, z], [fx, fz] = [F.t[0], F.t[1]], [sx, sz] = [F.n[0], F.n[1]];
  const ce = Math.cos(elev), se = Math.sin(elev);
  segBox(G, 'paint', F, -0.35, 0.35, -0.55, 0.55, y + 0.85, y + 1.35, 0.9);
  for (const side of [-1, 1]) for (const up of [-0.17, 0.17]) {
    const o = [pivot[0] + sx * side * 0.42, pivot[1] + up, pivot[2] + sz * side * 0.42];
    const back = [o[0] - fx * 0.7 * ce, o[1] - 0.7 * se, o[2] - fz * 0.7 * ce];
    const muzzle = [o[0] + fx * 2.0 * ce, o[1] + 2.0 * se, o[2] + fz * 2.0 * ce];
    tube(G, 'paint', back, o, 0.09, 0.09, 6, 0.8);                                   // receiver
    tube(G, 'iron', o, muzzle, 0.035, 0.03, 6, 0.45);                                // barrel
    tube(G, 'iron', muzzle, [muzzle[0] + fx * 0.18 * ce, muzzle[1] + 0.18 * se, muzzle[2] + fz * 0.18 * ce], 0.05, 0.05, 6, 0.4);
    G.box('paint', o[0] - fx * 0.2 + sx * side * 0.12, o[1] - 0.18, o[2] - fz * 0.2 + sz * side * 0.12, 0.12, 0.3, 0.08, rot, 0.7); // magazine
  }
  for (const side of [-1, 1]) {                                                       // the shield: two angled wings
    const Fs = localFrame(x + fx * 0.55 + sx * side * 0.55, z + fz * 0.55 + sz * side * 0.55, rot + side * 0.35);
    segBox(G, 'paint', Fs, -0.03, 0.03, -0.6, 0.6, y + 0.55, y + 1.65, 0.85);
  }
  segBox(G, 'paint', F, -0.85, -0.55, -0.22, 0.22, y + 0.7, y + 0.8, 0.8);            // gunner's seat
  segBox(G, 'iron', F, -0.2, 0.1, -0.06, 0.06, y + 1.45, y + 1.75, 0.5);               // sight
}

/** Emplaced towed Flakvierling with ammunition boxes (aa_gun variant flak38_quad_towed). */
export function buildFlakTowed(o) {
  const G = new Geo(o.seed ?? `${o.x},${o.z}`), F = localFrame(o.x, o.z, o.rot ?? 0), y = o.y0 ?? 0;
  flakvierling(G, o.x, y, o.z, (o.rot ?? 0) + (o.aim ?? -0.6), 0.55);
  for (const [u, w] of [[-1.9, 1.2], [-1.9, 1.65], [-1.5, 1.42]]) segBox(G, 'paint', F, u - 0.3, u + 0.3, w - 0.17, w + 0.17, y, y + 0.28, 0.75);
  return G.build(o.name || 'flak', { ground: y });
}

/** Round masonry Flak emplacement on a rampart (flak variant flak38_quad_round_emplacement): ring wall + gun. */
export function buildFlakEmplacement(o) {
  const G = new Geo(o.seed ?? `${o.x},${o.z}`), r = o.r ?? 2.2, y = o.y0 ?? 0, x = o.x, z = o.z, h = o.h ?? 1;
  G.cyl('ashlar', x, y - 0.1, z, r + 0.45, r + 0.45, h + 0.1, 20, 1, { caps: false });
  G.cyl('ashlar', x, y - 0.1, z, r, r, h + 0.1, 20, 0.8, { caps: false });
  for (let k = 0; k < 20; k++) {                                                      // coping ring (top of the wall)
    const a0 = (k / 20) * Math.PI * 2, a1 = ((k + 1) / 20) * Math.PI * 2, P = (a, rr) => [x + Math.cos(a) * rr, y + h + 0.08, z + Math.sin(a) * rr];
    G.quad('dressed', P(a0, r - 0.05), P(a1, r - 0.05), P(a1, r + 0.5), P(a0, r + 0.5), 1.05);
  }
  G.cyl('flags', x, y, z, r, r, 0.03, 20, 0.9);
  flakvierling(G, x, y + 0.03, z, (o.rot ?? 0) + (o.aim ?? -1.0), 0.75);
  const F = localFrame(x, z, o.rot ?? 0);
  for (const u of [-1.3, -0.9]) segBox(G, 'paint', F, u - 0.18, u + 0.18, 1.2, 1.55, y + 0.03, y + 0.3, 0.75);
  return G.build(o.name || 'flak_emplacement', { ground: y });
}

/** Towed light field gun (aa_gun variant towed_field_gun): split trail, two steel disc wheels, shield, barrel. */
export function buildFieldGun(o) {
  const G = new Geo(o.seed ?? `${o.x},${o.z}`), rot = o.rot ?? 0, F = localFrame(o.x, o.z, rot), y = o.y0 ?? 0;
  for (const side of [-1, 1]) {                                                       // the split trail, opened
    const Ft = localFrame(o.x, o.z, rot + Math.PI + side * 0.32);
    segBox(G, 'paint', Ft, 0.2, 2.4, -0.09, 0.09, y + 0.2, y + 0.45, 0.85);
    const [ex, ez] = Ft.at(2.35, 0);
    G.box('paint', ex, y + 0.12, ez, 0.4, 0.24, 0.3, rot, 0.75);
  }
  segBox(G, 'paint', F, -0.2, 0.2, -0.75, 0.75, y + 0.55, y + 0.75, 0.9);              // axle tree
  for (const side of [-1, 1]) {
    const [wx, wz] = F.at(0, side * 0.82);
    tube(G, 'rubber', [wx - F.n[0] * 0.07, y + 0.6, wz - F.n[1] * 0.07], [wx + F.n[0] * 0.07, y + 0.6, wz + F.n[1] * 0.07], 0.6, 0.6, 14, 0.7);
    tube(G, 'paint', [wx - F.n[0] * 0.08, y + 0.6, wz - F.n[1] * 0.08], [wx + F.n[0] * 0.08, y + 0.6, wz + F.n[1] * 0.08], 0.42, 0.42, 12, 0.85);
  }
  segBox(G, 'paint', F, 0.25, 0.3, -0.7, 0.7, y + 0.45, y + 1.45, 0.85);               // shield
  const b0 = F.at(-0.6, 0), b1 = F.at(1.9, 0);
  tube(G, 'paint', [b0[0], y + 1.0, b0[1]], [b1[0], y + 1.06, b1[1]], 0.07, 0.06, 8, 0.8);
  tube(G, 'paint', [b0[0], y + 0.86, b0[1]], [F.at(0.6, 0)[0], y + 0.88, F.at(0.6, 0)[1]], 0.08, 0.08, 8, 0.75);
  return G.build(o.name || 'field_gun', { ground: y });
}

// ---------------------------------------------------------------- firing range
/** Target frame: two posts, a board with a black man-silhouette, a sandbag base. Faces −u (the firing line). */
export function buildTargetFrame(o) {
  const G = new Geo(o.seed ?? `${o.x},${o.z}`), F = localFrame(o.x, o.z, o.rot ?? 0), H = o.h ?? 1.8, W2 = (o.w ?? 1) / 2;
  for (const s of [-1, 1]) segBox(G, 'timber', F, -0.05, 0.05, s * (W2 + 0.05) - 0.05, s * (W2 + 0.05) + 0.05, 0, H, 0.75);
  segBox(G, 'boards', F, -0.03, 0.02, -W2, W2, H * 0.4, H, 1.25);
  const sil = (a0, a1, w0, w1, y0, y1) => segBox(G, 'iron', F, a0, a1, w0, w1, y0, y1, 0.12);
  sil(-0.05, -0.03, -0.32, 0.32, H * 0.42, H * 0.72);                                // torso
  sil(-0.05, -0.03, -0.12, 0.12, H * 0.72, H * 0.78);                                // neck
  sil(-0.05, -0.03, -0.16, 0.16, H * 0.78, H * 0.93);                                // head
  sil(-0.055, -0.035, -0.06, 0.06, H * 0.55, H * 0.6);                               // ring hit zone (paper patch)
  for (let k = 0; k < 5; k++) segBox(G, 'boards', F, 0.05 + (k % 2) * 0.05, 0.4, -0.55 + k * 0.22, -0.33 + k * 0.22, 0, 0.18 + (k % 2) * 0.12, 0.6);
  return G.build(o.name || 'target', { ground: 0 });
}

/** Bullet stop along a polyline: a timber crib (posts, plank faces) filled with earth, sandbags along the top. */
export function buildBulletStop(points, o = {}) {
  const G = new Geo(o.seed ?? points.flat().join(',')), H = o.h ?? 2.2, T2 = (o.width ?? 0.8) / 2;
  for (let k = 0; k + 1 < points.length; k++) {
    const [a, b] = [points[k], points[k + 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]), F = localFrame(a[0], a[1], Math.atan2(b[1] - a[1], b[0] - a[0]));
    segBox(G, 'rubble', F, 0, L, -T2 + 0.05, T2 - 0.05, 0, H - 0.1, 0.6);           // the earth core (shows at the ends)
    for (const s of [-1, 1]) {
      for (let y = 0; y < H - 0.25; y += 0.26) segBox(G, 'planks', F, -0.05, L + 0.05, s * T2 - 0.03, s * T2 + 0.03, y, y + 0.24, 0.75 + ((y * 7) % 1) * 0.2);
      for (let u = 0; u <= L + 0.01; u += Math.max(1, L / Math.ceil(L / 1.3))) segBox(G, 'timber', F, u - 0.08, u + 0.08, s * (T2 + 0.06) - 0.08, s * (T2 + 0.06) + 0.08, 0, H + 0.1, 0.7);
    }
    for (let u = 0.2; u < L; u += 0.62) segBox(G, 'canvas', F, u - 0.3, u + 0.28, -T2 - 0.05, T2 + 0.05, H - 0.1, H + 0.12, 0.62 + ((u * 3) % 1) * 0.15);
  }
  return G.build(o.name || 'bullet_stop', { ground: 0 });
}

/** 60 cm searchlight (Flakscheinwerfer-style) on a fork mount and a round pedestal, aimed along rot/elev. */
export function buildSearchlight(o) {
  const G = new Geo(o.seed ?? `${o.x},${o.z}`), y = o.y0 ?? 0, x = o.x, z = o.z, rot = o.rot ?? 0, el = o.elev ?? 0.25;
  const F = localFrame(x, z, rot);
  G.cyl('paint', x, y, z, 0.42, 0.32, 0.2, 12, 0.75);
  G.cyl('paint', x, y + 0.2, z, 0.12, 0.12, 0.65, 8, 0.8);
  for (const s of [-1, 1]) segBox(G, 'paint', F, -0.08, 0.08, s * 0.42 - 0.04, s * 0.42 + 0.04, y + 0.8, y + 1.35, 0.8);
  segBox(G, 'paint', F, -0.1, 0.1, -0.46, 0.46, y + 0.78, y + 0.88, 0.8);
  const c = [x, y + 1.25, z], d = [Math.cos(el) * F.t[0], Math.sin(el), Math.cos(el) * F.t[1]];
  const P = (k) => [c[0] + d[0] * k, c[1] + d[1] * k, c[2] + d[2] * k];
  tube(G, 'paint', P(-0.35), P(0.3), 0.36, 0.38, 14, 0.85);
  tube(G, 'paint', P(-0.5), P(-0.35), 0.2, 0.36, 12, 0.7);
  tube(G, 'dressed', P(0.3), P(0.33), 0.38, 0.0, 14, 1.8);                              // the glass front (pale)
  return G.build(o.name || 'searchlight', { ground: y });
}

/**
 * The firing range's marker berm (Anzeigerdeckung): a low earth bank in a timber revetment (posts, horizontal
 * planks), turfed top with frost, a row of sandbags along each long edge, numbered marker boards on posts. Rect
 * {x, z, rot, w, d, h}; `cuts` [[a, b, halfWidth]]: lines (e.g. a bullet stop running through it) the berm stops
 * short of on both sides, so the two parts end against that wall instead of passing through it.
 */
export function buildRangeBerm(o) {
  const G = new Geo(o.seed ?? 'berm'), H = o.h ?? 1.2, F = localFrame(o.x, o.z, o.rot ?? 0), R = G.R;
  const hw = o.w / 2, hd = o.d / 2;
  let pieces = [ccw([F.at(-hw, -hd), F.at(hw, -hd), F.at(hw, hd), F.at(-hw, hd)])];
  for (const [a, b, half] of o.cuts || []) {
    const S = segFrame(a, b, null), big = 1e3;
    const side = (s) => ccw([S.at(-big, s * half), S.at(big, s * half), S.at(big, s * big), S.at(-big, s * big)]);
    pieces = pieces.flatMap((p) => [clipConvex(p, side(1)), clipConvex(p, side(-1))]).filter((p) => p.length >= 3);
  }
  for (const p of pieces) {
    G.prism('rubble', p, 0, H - 0.3, 0.55, { top: false });                       // earth core (shows between posts)
    // turfed earth mound: a skirt rising from the revetment's top to a crown 0.35 m higher (reads as a bank, not a pit)
    const crown = offsetPoly(p, -Math.min(0.9, 0.3 * Math.min(...p.map((q, i) => Math.hypot(p[(i + 1) % p.length][0] - q[0], p[(i + 1) % p.length][1] - q[1]))))), yc = H + 0.05;
    for (let i = 0; i < p.length; i++) {
      const j = (i + 1) % p.length, a = p[i], b = p[j], c = crown[j], d = crown[i];
      G.quad('moss', [a[0], H - 0.3, a[1]], [d[0], yc, d[1]], [c[0], yc, c[1]], [b[0], H - 0.3, b[1]], 1.0 + R() * 0.1);
    }
    flatPoly(G, 'moss', crown, yc, 1.05);
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], E = segFrame(a, b, null), L = E.L;
      if (L < 0.4) continue;
      // an edge on a cut abuts the wall running through: no revetment of its own there
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if ((o.cuts || []).some(([ca, cb, half]) => { const S = segFrame(ca, cb, null); return Math.abs(Math.abs((mx - ca[0]) * S.n[0] + (mz - ca[1]) * S.n[1]) - half) < 0.05; })) continue;
      for (let y = 0; y < H - 0.32; y += 0.22) segBox(G, 'boards', E, 0, L, 0.0, 0.05, y, y + 0.2, 0.8 + R() * 0.2);
      for (let u = 0.1; u < L; u += Math.max(0.9, L / Math.ceil(L / 1.4))) segBox(G, 'timber', E, u - 0.07, u + 0.07, 0.05, 0.17, -0.1, H - 0.18, 0.65 + R() * 0.15);
      const clear = (q) => (o.cuts || []).every(([ca, cb, half]) => { const S = segFrame(ca, cb, null); return Math.abs((q[0] - ca[0]) * S.n[0] + (q[1] - ca[1]) * S.n[1]) >= half; });
      if (L > 2.5) for (let u = 0.35; u < L - 0.3; u += 0.6) {
        if (![E.at(u - 0.28, -0.42), E.at(u + 0.27, -0.42), E.at(u - 0.28, 0), E.at(u + 0.27, 0)].every(clear)) continue; // sandbags stop at the wall
        segBox(G, 'canvas', E, u - 0.28, u + 0.27, -0.42, -0.04, H - 0.3, H - 0.3 + 0.15 + R() * 0.04, 0.6 + R() * 0.18);
      }
    }
  }
  // marker boards on posts (numbers in black on white), along the berm's back edge
  const nb = Math.max(2, Math.round(o.w / 4));
  for (let k = 0; k < nb; k++) {
    const u = -hw + (k + 0.5) * (o.w / nb), [x, z] = F.at(u, -hd + 0.6);
    if ((o.cuts || []).some(([a, b, half]) => { const S = segFrame(a, b, null); const dx = x - a[0], dz = z - a[1]; return Math.abs(dx * S.n[0] + dz * S.n[1]) < half + 0.4; })) continue;
    G.box('timber', x, H + 0.15, z, 0.08, 0.9, 0.08, o.rot ?? 0, 0.7);
    G.box('dressed', x, H + 0.55, z, 0.55, 0.42, 0.04, o.rot ?? 0, 1.35);
    G.box('iron', x, H + 0.55, z + 0.025, 0.12, 0.26, 0.01, o.rot ?? 0, 0.35);
  }
  return G.build(o.name || 'range_berm', { ground: 0 });
}

/**
 * The range's water-gate lever (M20 §7.1): a cast-iron sluice headstock on a concrete plinth — column, gearbox with a
 * pitched lid and a stencilled plate, a long hand lever with a signal-red grip, a conduit to the wall — and, beside
 * it, an iron lamp post with a bracket and a caged lamp housing. Returns {group, lamp: [x, y, z]} (the flashing red
 * glass itself is the set-piece device's lamp, moved into the housing so its blink keeps working).
 */
export function buildLeverBox(o) {
  const G = new Geo(o.seed ?? 'lever'), rot = o.rot ?? 0, F = localFrame(o.x, o.z, rot);
  const P = (u, w, y) => { const [x, z] = F.at(u, w); return [x, y, z]; };
  const at = (u, w) => F.at(u, w);
  segBox(G, 'dressed', F, -0.55, 0.55, -0.4, 0.4, -0.05, 0.22, 0.82);                // concrete plinth
  segBox(G, 'dressed', F, -0.6, 0.6, -0.45, 0.45, -0.05, 0.05, 0.7);
  for (const [u, w] of [[-0.45, -0.3], [0.45, -0.3], [-0.45, 0.3], [0.45, 0.3]]) { const [x, z] = at(u, w); G.cyl('iron', x, 0.22, z, 0.035, 0.035, 0.05, 6, 0.5); } // hold-down bolts
  { const [x, z] = at(0, 0); G.cyl('paint', x, 0.22, z, 0.2, 0.15, 0.12, 12, 0.7); G.cyl('paint', x, 0.34, z, 0.13, 0.12, 0.72, 12, 0.78); }
  segBox(G, 'paint', F, -0.3, 0.3, -0.22, 0.22, 1.02, 1.42, 0.8);                    // gearbox
  segBox(G, 'paint', F, -0.33, 0.33, -0.25, 0.25, 1.42, 1.47, 0.72);
  G.box('paint', ...P(0, 0, 1.53), 0.62, 0.12, 0.46, rot, 0.75, 0.3);                // pitched lid
  segBox(G, 'dressed', F, -0.18, 0.18, 0.22, 0.235, 1.12, 1.32, 1.35);               // stencilled plate (front)
  segBox(G, 'signal', F, -0.12, 0.12, 0.236, 0.242, 1.27, 1.3, 1.0);                 // red band on the plate
  // hand lever: pivot on the E cheek, raised (gate shut) — iron bar, red grip
  const piv = P(0.34, 0, 1.25), tip = P(0.42, 0.2, 2.15);
  tube(G, 'iron', P(0.3, 0, 1.25), P(0.4, 0, 1.25), 0.07, 0.07, 10, 0.6);
  tube(G, 'iron', piv, tip, 0.035, 0.03, 8, 0.55);
  tube(G, 'signal', tip, P(0.43, 0.22, 2.42), 0.045, 0.045, 8, 0.95);
  tube(G, 'iron', P(0.36, 0, 1.12), P(0.36, 0.0, 0.95), 0.04, 0.04, 6, 0.5);         // quadrant stop
  // conduit: down the column and away toward the wall (+u)
  tube(G, 'iron', P(-0.22, -0.18, 1.1), P(-0.22, -0.18, 0.22), 0.025, 0.025, 6, 0.55);
  tube(G, 'iron', P(-0.22, -0.18, 0.22), P(-0.22, -0.6, 0.05), 0.025, 0.025, 6, 0.55);
  // lamp post with bracket and caged housing (the red glass is the device's lamp)
  const lp = [-0.75, -0.35], top = 2.35;
  { const [x, z] = at(...lp); G.cyl('paint', x, -0.05, z, 0.11, 0.09, 0.3, 8, 0.7); G.cyl('paint', x, 0.25, z, 0.05, 0.045, top - 0.25, 8, 0.75); }
  tube(G, 'paint', P(lp[0], lp[1], top - 0.05), P(lp[0] + 0.35, lp[1], top - 0.05), 0.025, 0.025, 6, 0.75);
  const lx = lp[0] + 0.35;
  { const [x, z] = at(lx, lp[1]);
    G.cyl('paint', x, top - 0.1, z, 0.1, 0.13, 0.06, 10, 0.7);                      // hood
    G.cyl('paint', x, top - 0.04, z, 0.13, 0.03, 0.08, 10, 0.72);
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.4; tube(G, 'iron', [x + Math.cos(a) * 0.11, top - 0.42, z + Math.sin(a) * 0.11], [x + Math.cos(a) * 0.11, top - 0.1, z + Math.sin(a) * 0.11], 0.012, 0.012, 4, 0.5); }
    G.cyl('paint', x, top - 0.46, z, 0.12, 0.12, 0.05, 10, 0.7); }
  const [lampX, lampZ] = at(lx, lp[1]);
  return { group: G.build(o.name || 'lever_box', { ground: 0 }), lamp: [lampX, top - 0.26, lampZ] };
}
