/**
 * A desert landing ground's markings (M10 art pass 2, the El Agheila airfield): drawn as ONE soft-edged decal over a
 * raised shelf's top, where the terrain's own `road` paint lies under the shelf prism, unseen. It carries the rolled,
 * oil-darkened sand of the strip, the tyre tracks of the machines that use it (the transport's take-off run, the dive
 * bombers' taxi tracks to their stands, the lorries' track up from the ramp head), the whitewashed stones along the
 * strip's edges and the canvas landing T by the windsock. Flat at the walk height: no footprint, no block, no cast
 * shadow (it never touches the walk grid); one mesh, one material, one canvas texture.
 *
 * Roads-and-tracks r1: the rolled strip is a compacted band whose margins blur 2 m into the sand in wind-drawn streaks
 * (no ruled edge), its ends (the thresholds, where the machines touch down, brake, turn and run up) are rutted and
 * scuffed, and the whitewashed marker stones are real stones (one instanced draw, a child of the decal) sitting a few
 * centimetres into the sand, their shadows painted into the decal along the mission's sun (castShadow stays off: small
 * instances), so they no longer read as flat white discs hovering over the ground.
 *
 * spec: {area: {x0, x1, z0, z1}, y, strip: {z0, z1, x0?, x1?}, tracks: [{pts: [[x, z]…], gauge, w, a}],
 *        stones: {every, len}, landingT: {x, z, len, span, w}, stains: [[x, z, r, a]…], seed,
 *        margin? (m, default 2), sun? {az, el} (deg, default M10's 110 / 55)}
 * @module art/airstrip
 */
import * as THREE from 'three';

const HAS_DOM = typeof document !== 'undefined';
const PX = 16;          // canvas pixels per metre (a 0.35 m tyre track ≈ 5.6 px)
const MAX_W = 2048;

const rng = (seed) => { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/** Points every `step` m along a polyline (Catmull-Rom through its points), with the unit tangent. */
export function sampleTrack(pts, step = 1) {
  const out = [];
  const P = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out.map((p, i) => {
    const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { x: p[0], z: p[1], tx: (b[0] - a[0]) / l, tz: (b[1] - a[1]) / l };
  });
}

/** Paint the markings on a 2D canvas context (world → canvas: (x − x0)·sx, (z − z0)·sz). */
function paint(g, spec, sx, sz) {
  const { area, strip, stones, landingT, stains = [] } = spec;
  const tracks = [...(spec.tracks || [])];
  const R = rng(spec.seed ?? 1942);
  const X = (x) => (x - area.x0) * sx, Z = (z) => (z - area.z0) * sz;
  // 1. the rolled strip: a darker, greyer compacted band; its margins blur 2 m into the sand in streaks drawn out along the
  //    wind (sand tongues reaching in, compacted fingers reaching out), never a ruled or a cut-paper edge
  const sx0 = strip.x0 ?? area.x0, sx1 = strip.x1 ?? area.x1, top = [], bot = [], M = spec.margin ?? 2;
  for (let x = sx0; x <= sx1 + 1e-6; x += 2) {
    top.push([x, strip.z0 + (R() - 0.5) * 0.7]);
    bot.push([x, strip.z1 + (R() - 0.5) * 0.7]);
  }
  const band = (grow, fill) => {
    g.beginPath();
    top.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z - grow)) : g.moveTo(X(x), Z(z - grow))));
    for (let i = bot.length - 1; i >= 0; i--) g.lineTo(X(bot[i][0]), Z(bot[i][1] + grow));
    g.closePath(); g.fillStyle = fill; g.fill();
  };
  g.save(); g.filter = `blur(${Math.round(0.9 * sz)}px)`;
  band(M + 0.8, 'rgba(218, 200, 162, 0.12)'); // the graded windrows of blown sand along both edges
  band(M * 0.5, 'rgba(110, 96, 74, 0.14)');
  band(-M * 0.25, 'rgba(98, 86, 68, 0.3)');    // the rolled strip itself: greyer, oil-darkened
  g.restore();
  // the wind-blurred margins: elongated streaks (3-9 m along the wind, 0.2-0.8 m across) scattered over a 2 m band either
  // side of each edge, dark (compacted) inside, pale (loose sand) outside, fading with the distance from the edge
  const streak = (x, z, len, wd, rgba) => {
    g.fillStyle = rgba; g.beginPath(); g.ellipse(X(x), Z(z), len * 0.5 * sx, wd * 0.5 * sz, (R() - 0.5) * 0.08, 0, 6.2832); g.fill();
  };
  g.save(); g.filter = `blur(${Math.max(1, Math.round(0.25 * sz))}px)`;
  for (const [edge, out] of [[strip.z0, -1], [strip.z1, 1]]) {
    for (let k = 0, n = Math.round((sx1 - sx0) * 2.2); k < n; k++) {
      const x = sx0 + R() * (sx1 - sx0), t = (R() * 2 - 1) * M, z = edge + out * t;   // t > 0: outside the strip
      const fade = 1 - Math.abs(t) / M, len = 3 + R() * 6, wd = 0.2 + R() * 0.6;
      if (t > 0) streak(x, z, len, wd, `rgba(222, 204, 168, ${(0.16 * fade).toFixed(3)})`);
      else streak(x, z, len, wd, `rgba(92, 80, 62, ${(0.14 * fade).toFixed(3)})`);
    }
  }
  g.restore();
  // mottling: rolled patches, old oil, blown sand
  const blob = (x, z, r, rgba) => {
    const gr = g.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), r * sx);
    gr.addColorStop(0, rgba); gr.addColorStop(1, rgba.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = gr; g.beginPath(); g.ellipse(X(x), Z(z), r * sx, r * sz * (0.6 + 0.4 * R()), R() * 3, 0, 6.2832); g.fill();
  };
  for (let k = 0; k < 260; k++) {
    const x = sx0 + R() * (sx1 - sx0), z = strip.z0 + R() * (strip.z1 - strip.z0), r = 1 + R() * 4;
    blob(x, z, r, R() < 0.55 ? `rgba(70, 58, 42, ${(0.05 + R() * 0.08).toFixed(3)})` : `rgba(206, 186, 146, ${(0.05 + R() * 0.07).toFixed(3)})`);
  }
  // 1b. the thresholds: where the machines touch down, brake, swing round and run up, the strip's ends are rutted —
  //     braids of tyre tracks in pairs, a few turning arcs and scuffed rubber
  for (const th of thresholds(spec)) for (const t of th) tracks.push(t);
  // 2. tyre tracks: each wheel a darker, slightly wobbling line; older ones fainter
  for (const t of tracks) {
    const S = sampleTrack(t.pts, 0.8), half = (t.gauge ?? 0) / 2, ph = R() * 10;
    for (const side of half ? [-1, 1] : [0]) {
      g.beginPath();
      S.forEach((p, i) => {
        const wob = 0.05 * Math.sin(i * 0.37 + ph + side) + 0.03 * Math.sin(i * 1.3 + ph * 2);
        const o = side * half + wob, x = p.x - p.tz * o, z = p.z + p.tx * o;
        i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z));
      });
      g.lineWidth = Math.max(1.5, (t.w ?? 0.35) * sz); g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = `rgba(66, 53, 38, ${t.a ?? 0.3})`; g.stroke();
    }
  }
  // 3. the whitewashed stones' ground: each stone (a real one: stoneMesh) pressed a little into the sand, a dark contact
  //    ring round its foot and its shadow cast along the sun (painted: the stones cast none of their own), lime splashes
  const sun = spec.sun || { az: 110, el: 55 };
  const az = (sun.az * Math.PI) / 180, k = 1 / Math.tan((sun.el * Math.PI) / 180);
  const shx = -Math.sin(az), shz = Math.cos(az);                     // the shadow points away from the sun (compass az)
  for (const st of stonePlacements(spec)) {
    const L = st.h * k;
    g.save(); g.filter = `blur(${Math.max(1, Math.round(0.05 * sx))}px)`;
    g.fillStyle = 'rgba(48, 38, 28, 0.5)';                           // the cast shadow, from the foot outward
    g.beginPath(); g.ellipse(X(st.x + shx * (L * 0.5 + st.r * 0.25)), Z(st.z + shz * (L * 0.5 + st.r * 0.25)), (st.r + L * 0.5) * sx, st.r * 0.85 * sz,
      Math.atan2(shz, shx), 0, 6.2832); g.fill();
    g.fillStyle = 'rgba(60, 48, 34, 0.55)';                           // contact: the sand dug in round the foot
    g.beginPath(); g.ellipse(X(st.x), Z(st.z), st.r * 1.12 * sx, st.r * 1.0 * sz, st.rot, 0, 6.2832); g.fill();
    g.restore();
    if (R() < 0.35) { g.fillStyle = `rgba(232, 228, 214, ${(0.25 + R() * 0.25).toFixed(2)})`; g.beginPath(); g.ellipse(X(st.x + (R() - 0.5) * 0.5), Z(st.z + (R() - 0.5) * 0.5), 0.06 * sx, 0.05 * sz, 0, 0, 6.2832); g.fill(); }
  }
  // 4. the landing T (canvas panels pegged flat): the stem along the landing run, the bar at its upwind (W) end
  if (landingT) {
    const { x, z, len, span, w } = landingT;
    const panel = (ax, az, bx, bz) => {
      g.fillStyle = 'rgba(70, 58, 42, 0.28)'; g.fillRect(X(ax) + 2, Z(az) + 2, (bx - ax) * sx, (bz - az) * sz);
      g.fillStyle = 'rgba(238, 234, 222, 0.96)'; g.fillRect(X(ax), Z(az), (bx - ax) * sx, (bz - az) * sz);
    };
    panel(x, z - w / 2, x + len, z + w / 2);
    panel(x - w, z - span / 2, x, z + span / 2);
  }
  // 5. oil and fuel stains under the engines and at the bowser's stand
  for (const [x, z, r, a] of stains) {
    for (let k = 0; k < 3; k++) blob(x + (R() - 0.5) * r * 0.6, z + (R() - 0.5) * r * 0.6, r * (0.5 + R() * 0.5), `rgba(48, 38, 28, ${(a ?? 0.25) * (0.6 + R() * 0.4)})`);
  }
}

/**
 * The thresholds' ruts (deterministic): per end of the strip, braids of tyre-track pairs (the Ju 52's 5.4 m and the
 * Stukas' 3.1 m main gear) running 14-30 m in from the end at slight angles, and a turning arc or two.
 * @returns {{pts:number[][], gauge:number, w:number, a:number}[][]}
 */
export function thresholds(spec) {
  const { area, strip } = spec;
  if (!strip) return [];
  const R = rng((spec.seed ?? 1942) ^ 0x7e5d), sx0 = strip.x0 ?? area.x0, sx1 = strip.x1 ?? area.x1, out = [];
  const zc = (strip.z0 + strip.z1) / 2, half = (strip.z1 - strip.z0) / 2;
  for (const [end, dir] of [[sx0, 1], [sx1, -1]]) {
    const set = [];
    for (let k = 0; k < 9; k++) {
      const gauge = R() < 0.55 ? 5.4 : 3.1, z0 = zc + (R() - 0.5) * half * 1.3, len = 14 + R() * 16, ang = (R() - 0.5) * 0.06;
      const x0 = end + dir * R() * 3, pts = [];
      for (let t = 0; t <= 4; t++) { const u = (t / 4) * len; pts.push([x0 + dir * u, z0 + Math.sin(ang) * u + (R() - 0.5) * 0.08]); }
      set.push({ pts, gauge, w: 0.34 + R() * 0.12, a: 0.12 + R() * 0.12 });
    }
    for (let k = 0; k < 2; k++) {   // a machine swung round at the end: an arc of one wheel pair
      // (the whole arc inside the strip: its centre at least a radius in from the end and the sides — a clamped arc
      //  would run on as a ruled line along the strip's edge)
      const r = 5 + R() * 4, cx = end + dir * (r + 1.5 + R() * 5), zr = Math.max(0, half - r * 0.7 - 1);
      const cz = zc + (R() - 0.5) * 2 * Math.min(zr, half * 0.5), a0 = R() * 6.283, sweep = 1.6 + R() * 0.6, pts = [];
      for (let t = 0; t <= 8; t++) { const a = a0 + (t / 8) * sweep; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r * 0.7]); }
      set.push({ pts, gauge: 3.1, w: 0.36, a: 0.14 });
    }
    out.push(set);
  }
  return out;
}

/**
 * Where the whitewashed marker stones lie (deterministic): a short row of 4-6 every `stones.every` m along both edges of
 * the strip. Each: {x, z, r (m), h (m), rot}.
 */
export function stonePlacements(spec) {
  const { area, strip, stones } = spec;
  if (!stones || !strip) return [];
  const R = rng((spec.seed ?? 1942) ^ 0x51a7e), sx0 = strip.x0 ?? area.x0, sx1 = strip.x1 ?? area.x1, out = [];
  for (let x = sx0 + stones.every / 2; x < sx1; x += stones.every) {
    for (const z of [strip.z0, strip.z1]) {
      const n = 4 + Math.floor(R() * 3);
      for (let k = 0; k < n; k++) {
        const r = 0.13 + R() * 0.08;
        out.push({ x: x + (k - (n - 1) / 2) * (stones.len / n) + (R() - 0.5) * 0.18, z: z + (R() - 0.5) * 0.3, r, h: r * (0.75 + R() * 0.4), rot: R() * 6.283 });
      }
    }
  }
  return out;
}

/** A lumpy whitewashed field stone (unit size, its foot at y 0): an icosphere pushed about, flattened, lime-white on top
 *  with a dirtier, sand-stained foot (vertex colours). */
function stoneGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 1), P = geo.attributes.position, col = new Float32Array(P.count * 3);
  const R = rng(7741);
  const seen = new Map();
  for (let i = 0; i < P.count; i++) {
    const key = `${P.getX(i).toFixed(3)},${P.getY(i).toFixed(3)},${P.getZ(i).toFixed(3)}`;
    let f = seen.get(key);
    if (f == null) { f = 0.82 + R() * 0.3; seen.set(key, f); }
    const y = P.getY(i);
    P.setXYZ(i, P.getX(i) * f, (y > 0 ? y * 0.95 : y * 0.35) * f + 0.32, P.getZ(i) * f * 0.85);
    const lime = 0.6 + 0.4 * Math.min(1, Math.max(0, (y + 0.4) / 0.9)), dirt = 1 - lime;
    col[i * 3] = 0.9 * lime + 0.5 * dirt; col[i * 3 + 1] = 0.89 * lime + 0.43 * dirt; col[i * 3 + 2] = 0.84 * lime + 0.33 * dirt;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/** The marker stones: ONE instanced mesh (`kit:airstrip-stones`), relative to the decal's centre, no cast shadow. */
export function stoneMesh(spec) {
  const list = stonePlacements(spec);
  if (!list.length) return null;
  const { x0, x1, z0, z1 } = spec.area, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const geo = stoneGeometry();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  mat.name = 'kit:airstrip-stones';
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3(), M = new THREE.Matrix4();
  const tint = new THREE.Color(), R = rng((spec.seed ?? 1942) ^ 0x2b0b);
  list.forEach((st, i) => {
    e.set((R() - 0.5) * 0.25, st.rot, (R() - 0.5) * 0.25); q.setFromEuler(e);
    sc.set(st.r, st.h / 1.25, st.r * (0.85 + R() * 0.3));
    p.set(st.x - cx, 0.008 - 0.035, st.z - cz);                     // (the decal lies 8 mm under the shelf top) a few cm in
    M.compose(p, q, sc); m.setMatrixAt(i, M);
    const v = 0.9 + R() * 0.12; tint.setRGB(v, v * (0.98 + R() * 0.03), v * (0.94 + R() * 0.05)); m.setColorAt(i, tint);
  });
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.computeBoundingSphere?.();
  m.name = 'kit:airstrip-stones';
  m.castShadow = false; m.receiveShadow = true;
  m.userData.aoExclude = true;                         // tiny stones: nothing for the AO prepass (one draw in all)
  geo.addEventListener('dispose', () => mat.dispose());
  return m;
}

/**
 * The decal mesh (THREE.Mesh, `kit:airstrip`), lying at `spec.y` over spec.area, with the marker stones as its one child
 * (an instanced mesh). In node (no canvas) it keeps a plain transparent material so the layout can be checked.
 */
export function buildAirstrip(spec) {
  const { x0, x1, z0, z1 } = spec.area, W = x1 - x0, D = z1 - z0;
  const geo = new THREE.PlaneGeometry(W, D);
  geo.rotateX(-Math.PI / 2);                         // plane (x, y) → world (x, ·, −y): uv v = 1 at z0 (canvas row 0)
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, opacity: HAS_DOM ? 1 : 0 });
  mat.name = 'kit:airstrip';
  if (HAS_DOM) {
    const cw = Math.min(MAX_W, Math.round(W * PX)), ch = Math.round(cw * D / W);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d');
    paint(g, spec, cw / W, ch / D);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.name = 'airstrip';
    mat.map = tex;
  }
  // the map's unload disposes geometries only: the canvas (M10: 1904 × 760, 7.4 MB with mips) goes with the plane
  geo.addEventListener('dispose', () => { mat.map?.dispose(); mat.dispose(); });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x0 + W / 2, spec.y, z0 + D / 2);
  m.name = 'kit:airstrip';
  m.receiveShadow = true; m.castShadow = false;
  m.renderOrder = -1;
  m.userData.aoExclude = true;                        // a flat decal: nothing for the AO prepass
  m.userData.airstrip = { area: spec.area, strip: spec.strip };
  const stonesMesh = stoneMesh(spec);
  if (stonesMesh) { m.add(stonesMesh); geo.addEventListener('dispose', () => stonesMesh.geometry.dispose()); }
  return m;
}
