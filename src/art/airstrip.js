/**
 * A desert landing ground's markings (M10 art pass 2, the El Agheila airfield): drawn as ONE soft-edged decal over a
 * raised shelf's top, where the terrain's own `road` paint lies under the shelf prism, unseen. It carries the rolled,
 * oil-darkened sand of the strip, the tyre tracks of the machines that use it (the transport's take-off run, the dive
 * bombers' taxi tracks to their stands, the lorries' track up from the ramp head), the whitewashed stones along the
 * strip's edges and the canvas landing T by the windsock. Flat at the walk height: no footprint, no block, no cast
 * shadow (it never touches the walk grid); one mesh, one material, one canvas texture.
 *
 * spec: {area: {x0, x1, z0, z1}, y, strip: {z0, z1, x0?, x1?}, tracks: [{pts: [[x, z]…], gauge, w, a}],
 *        stones: {every, len}, landingT: {x, z, len, span, w}, stains: [[x, z, r, a]…], seed}
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
  const { area, strip, tracks = [], stones, landingT, stains = [] } = spec;
  const R = rng(spec.seed ?? 1942);
  const X = (x) => (x - area.x0) * sx, Z = (z) => (z - area.z0) * sz;
  // 1. the rolled strip: a darker, greyer band with ragged, feathered edges
  const sx0 = strip.x0 ?? area.x0, sx1 = strip.x1 ?? area.x1, top = [], bot = [];
  for (let x = sx0; x <= sx1 + 1e-6; x += 2) {
    top.push([x, strip.z0 + (R() - 0.5) * 1.1]);
    bot.push([x, strip.z1 + (R() - 0.5) * 1.1]);
  }
  const band = (grow, fill) => {
    g.beginPath();
    top.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z - grow)) : g.moveTo(X(x), Z(z - grow))));
    for (let i = bot.length - 1; i >= 0; i--) g.lineTo(X(bot[i][0]), Z(bot[i][1] + grow));
    g.closePath(); g.fillStyle = fill; g.fill();
  };
  g.save(); g.filter = `blur(${Math.round(0.6 * sz)}px)`;
  band(2.6, 'rgba(218, 200, 162, 0.16)');   // the graded windrows of blown sand along both edges
  band(1.0, 'rgba(110, 96, 74, 0.2)');
  band(0, 'rgba(98, 86, 68, 0.36)');          // the rolled strip itself: greyer, oil-darkened
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
  // 3. whitewashed stones along both edges of the strip: a short row of 4–6 stones every `every` m
  if (stones) {
    for (let x = sx0 + stones.every / 2; x < sx1; x += stones.every) {
      for (const z of [strip.z0, strip.z1]) {
        const n = 4 + Math.floor(R() * 3);
        for (let k = 0; k < n; k++) {
          const px = x + (k - (n - 1) / 2) * (stones.len / n) + (R() - 0.5) * 0.15, pz = z + (R() - 0.5) * 0.25, r = 0.16 + R() * 0.1;
          g.fillStyle = 'rgba(80, 66, 48, 0.35)'; g.beginPath(); g.ellipse(X(px + 0.08), Z(pz + 0.1), r * sx, r * 0.8 * sz, 0, 0, 6.2832); g.fill();
          g.fillStyle = `rgba(${236 - Math.floor(R() * 14)}, ${232 - Math.floor(R() * 14)}, ${220 - Math.floor(R() * 14)}, 0.95)`;
          g.beginPath(); g.ellipse(X(px), Z(pz), r * sx, r * 0.75 * sz, R() * 3, 0, 6.2832); g.fill();
        }
      }
    }
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
 * The decal mesh (THREE.Mesh, `kit:airstrip`), lying at `spec.y` over spec.area. In node (no canvas) it keeps a plain
 * transparent material so the layout can be checked.
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
  return m;
}
