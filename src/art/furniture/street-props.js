/**
 * Street furniture other than lamps (step 3p): benches, bollards, Morris column, fences, period road signs, level
 * crossings, telegraph lines with sagging wind-swayed wires. Builders return per-material part lists in a local frame
 * (like lamps.js) so identical pieces are drawn instanced; signs / posters get a small canvas texture per text.
 * No swastikas or real insignia anywhere: German military signs are plain black-on-yellow unit boards.
 * @module art/furniture/street-props
 */
import * as THREE from 'three';

const V2 = (r, y) => new THREE.Vector2(r, y);
const lathe = (pts, seg = 12, y0 = 0) => new THREE.LatheGeometry(pts.map(([r, y]) => V2(r, y + y0)), seg);
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r0, r1, h, x, y, z, seg = 8) => new THREE.CylinderGeometry(r1, r0, h, seg).translate(x, y + h / 2, z);
const tube = (pts, r, seg = 12, rs = 5) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))), seg, r, rs, false);

/** Park / station bench: two cast-iron ends, five slats (seat + back), local X along the seat. */
function bench(P) {
  for (const x of [-0.85, 0.85]) {
    P.iron.push(tube([[x, 0, 0.22], [x, 0.42, 0.18], [x, 0.44, -0.22]], 0.022, 8), tube([[x, 0, -0.2], [x, 0.44, -0.2], [x, 0.85, -0.3]], 0.022, 8));
    P.iron.push(tube([[x, 0.62, -0.26], [x, 0.66, 0.1], [x, 0.5, 0.22]], 0.018, 8));
  }
  for (const z of [-0.12, 0, 0.12]) P.planks.push(box(1.9, 0.03, 0.1, 0, 0.46, z));
  for (const y of [0.6, 0.76]) P.planks.push(box(1.9, 0.1, 0.03, 0, y, -0.25 - (y - 0.6) * 0.25));
}

/** Morris column: base, drum with posters, cornice, zinc dome and finial. */
function morris(P) {
  P.iron.push(lathe([[0, 0], [0.66, 0], [0.66, 0.12], [0.6, 0.18], [0.6, 0.35]], 24));
  P.poster.push(new THREE.CylinderGeometry(0.57, 0.57, 2.3, 24, 1, true).translate(0, 1.5, 0));
  P.iron.push(lathe([[0.57, 0], [0.64, 0.06], [0.7, 0.16], [0.66, 0.22], [0.6, 0.22]], 24, 2.65));
  P.iron.push(lathe([[0.62, 0], [0.55, 0.2], [0.35, 0.45], [0.12, 0.6], [0.06, 0.66], [0.08, 0.72], [0.04, 0.82], [0, 0.86]], 20, 2.87));
}

/** Level crossing timbers + St Andrew's crosses + a striped barrier arm each side (local X along the road). */
function crossing(P, o) {
  const w = o.w ?? 6, g = o.gauge ?? 1.435;
  for (let k = -1; k <= 1; k += 2) P.timber.push(box(w, 0.05, 0.3, 0, 0.06, k * (g / 2 - 0.2)), box(w, 0.05, 0.25, 0, 0.06, k * (g / 2 + 0.2)));
  for (let x = -w / 2 + 0.15; x < w / 2; x += 0.32) P.timber.push(box(0.28, 0.045, g - 0.15, x, 0.06, 0));
  for (const s of [-1, 1]) {
    const px = s * (w / 2 + 1.2), pz = s * 2.6;
    P.white.push(cyl(0.05, 0.05, 2.2, px, 0, pz, 6));
    for (const a of [-0.6, 0.6]) {
      const b = box(1.1, 0.14, 0.02, px, 2.1, pz + 0.03).translate(-px, -2.1, -pz - 0.03).rotateZ(a).translate(px, 2.1, pz + 0.03);
      P.red.push(b);
    }
    P.white.push(box(0.3, 1.05, 0.3, -s * (w / 2 + 0.5), 0.52, s * 3.1));      // barrier post
    for (let k = 0; k < 6; k++) (k % 2 ? P.white : P.red).push(box(0.1, 0.1, (w + 0.6) / 6, -s * (w / 2 + 0.5), 1.0, s * 3.1 - s * ((k + 0.5) * (w + 0.6) / 6)));
  }
}

/**
 * Part lists for a furniture piece.
 * @param {string} type bench | bollard | morris_column | crossing | fence_post | … @param {object} [o] placement
 * @returns {{iron, planks, poster, timber, white, red, stone, wood: THREE.BufferGeometry[]}}
 */
export function propParts(type, o = {}) {
  const P = { iron: [], planks: [], poster: [], timber: [], white: [], red: [], stone: [], wood: [], sign: [] };
  if (type === 'bench') bench(P);
  else if (type === 'morris_column') morris(P);
  else if (type === 'crossing') crossing(P, o);
  else if (type === 'bollard') P.iron.push(lathe([[0, 0], [0.11, 0], [0.1, 0.1], [0.085, 0.75], [0.1, 0.8], [0.09, 0.86], [0.05, 0.9], [0, 0.91]], 14));
  else if (type === 'milestone') {
    P.white.push(box(0.4, 0.6, 0.22, 0, 0.3, 0), new THREE.CylinderGeometry(0.2, 0.2, 0.22, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, 0.6, 0));
    P.red.push(new THREE.CylinderGeometry(0.205, 0.205, 0.225, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 0.7, 1).translate(0, 0.66, 0));
    P.sign.push(new THREE.PlaneGeometry(0.34, 0.3).translate(0, 0.33, 0.112));
  } else if (type === 'sign') {
    const v = o.variant || 'plate';
    if (v === 'andreaskreuz') {
      P.white.push(cyl(0.05, 0.05, 2.3, 0, 0, 0, 6));
      for (const a of [-0.6, 0.6]) P.red.push(box(1.1, 0.14, 0.02, 0, 0, 0.04).rotateZ(a).translate(0, 2.15, 0));
    } else if (v === 'fingerpost') {
      P.wood.push(box(0.1, 2.6, 0.1, 0, 1.3, 0));
      P.sign.push(box(0.9, 0.16, 0.02, 0.5, 2.3, 0.06), box(0.9, 0.16, 0.02, -0.4, 2.05, 0.06));
    } else {
      P.wood.push(box(0.08, 2.2, 0.08, 0, 1.1, 0));
      P.sign.push(box(0.7, 0.45, 0.02, 0, 2.0, 0.05));
    }
  }
  return P;
}

// ------------------------------------------------------------------------------------------ canvas textures

const CANVAS = new Map();
/** Canvas texture: sign text (black on yellow Wehrmacht board / blue enamel plate / white milestone) or posters. */
export function signTexture(kind, text = '') {
  const key = kind + '|' + text;
  if (CANVAS.has(key) || typeof document === 'undefined') return CANVAS.get(key) || null;
  const c = document.createElement('canvas');
  c.width = 256; c.height = kind === 'poster' ? 512 : 128;
  const g = c.getContext('2d');
  if (kind === 'poster') {
    const cols = ['#c9b58a', '#8a3b2c', '#d8cfb8', '#34506b', '#b8863a', '#e3dcc6', '#5b6b45'];
    const words = ['CINÉMA', 'CONCERT', 'AVIS', 'THÉÂTRE', 'CIRQUE', 'BAL', 'OPÉRA'];
    g.fillStyle = '#7d7462'; g.fillRect(0, 0, 256, 512);
    let y = 0, k = 0;
    while (y < 512) {
      let x = 0; const h = 90 + ((k * 37) % 60);
      while (x < 256) {
        const w = 60 + ((k * 53) % 80);
        g.fillStyle = cols[k % cols.length]; g.fillRect(x + 2, y + 2, w - 4, h - 4);
        g.fillStyle = k % 3 ? '#2a241c' : '#f1e8d0'; g.font = `bold ${16 + (k % 3) * 4}px serif`; g.fillText(words[k % words.length], x + 6, y + 26);
        g.fillRect(x + 6, y + 36, w - 16, 3); g.fillRect(x + 6, y + 46, w - 24, 3);
        x += w; k++;
      }
      y += h;
    }
  } else {
    const [bg, fg] = kind === 'wehrmacht' ? ['#d9b92e', '#111'] : kind === 'milestone' ? ['#efece2', '#b0271f'] : ['#1f3d7a', '#f2f2f2'];
    g.fillStyle = bg; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(5, 5, 246, 118);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = String(text).split('\n');
    lines.forEach((l, i) => { g.font = `bold ${lines.length > 1 ? 34 : 44}px sans-serif`; g.fillText(l, 128, 64 + (i - (lines.length - 1) / 2) * 40); });
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (kind === 'poster') { t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1); }
  CANVAS.set(key, t);
  return t;
}

// ------------------------------------------------------------------------------------------ overhead wires

/**
 * Sagging catenary wires between fixing points (pairs of world points) as thin tubes with an aSway weight
 * (sin π t along each span) for the shared wind sway shader (art/cloth-wind.js applySway).
 * @param {{a:number[], b:number[]}[]} spans @param {{sag?:number, r?:number, seg?:number}} [o]
 */
export function wireGeometry(spans, o = {}) {
  const pos = [], sway = [], idx = [];
  const r = o.r ?? 0.009, seg = o.seg ?? 10, rs = 3;
  for (const { a, b } of spans) {
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]), sag = o.sag ?? Math.min(0.9, 0.0022 * L * L + 0.08);
    const pts = [];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t, Math.sin(Math.PI * t)]);
    }
    const base = pos.length / 3;
    for (let k = 0; k <= seg; k++) {
      const p = pts[k], q = pts[Math.min(seg, k + 1)], pp = pts[Math.max(0, k - 1)];
      const d = new THREE.Vector3(q[0] - pp[0], q[1] - pp[1], q[2] - pp[2]).normalize();
      const n1 = new THREE.Vector3(0, 1, 0).cross(d).normalize(), n2 = d.clone().cross(n1);
      for (let j = 0; j < rs; j++) {
        const an = (j / rs) * Math.PI * 2, c = Math.cos(an) * r, s = Math.sin(an) * r;
        pos.push(p[0] + n1.x * c + n2.x * s, p[1] + n1.y * c + n2.y * s, p[2] + n1.z * c + n2.z * s);
        sway.push(p[3] * Math.min(1, L / 25));
      }
    }
    for (let k = 0; k < seg; k++) for (let j = 0; j < rs; j++) {
      const i0 = base + k * rs + j, i1 = base + k * rs + (j + 1) % rs;
      idx.push(i0, i0 + rs, i1, i1, i0 + rs, i1 + rs);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Fence along a polyline (world coords, base heights from `y(x, z)`): picket (painted timber), railing (cast-iron
 * bars with spear heads), rail (rustic post-and-rail), wire (posts + wind-swayed strands).
 * @returns {{[material:string]: THREE.BufferGeometry[]}} parts in world space
 */
export function fenceParts(points, variant = 'picket', h = 1.1, y = () => 0) {
  const P = { planks: [], iron: [], wood: [], white: [], wire: [] };
  const post = (x, z, rot, gy) => {
    if (variant === 'railing') P.iron.push(new THREE.BoxGeometry(0.06, h + 0.1, 0.06).translate(x, gy + (h + 0.1) / 2, z));
    else (variant === 'picket' ? P.white : P.wood).push(new THREE.BoxGeometry(0.1, h + 0.12, 0.1).rotateY(-rot).translate(x, gy + (h + 0.12) / 2 - 0.02, z));
  };
  for (let k = 0; k < points.length - 1; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1], L = Math.hypot(bx - ax, bz - az), rot = Math.atan2(bz - az, bx - ax);
    const n = Math.max(1, Math.round(L / 2.2));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      const y0 = y(x0, z0), y1 = y(x1, z1), len = L / n, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, my = (y0 + y1) / 2;
      post(x0, z0, rot, y0);
      if (variant === 'wire') {
        for (const hh of [0.35, 0.7, 1.05]) P.wire.push({ a: [x0, y0 + hh, z0], b: [x1, y1 + hh, z1] });
        continue;
      }
      const rails = variant === 'railing' ? [0.12, h - 0.12] : variant === 'picket' ? [0.3, h - 0.25] : [0.4, h - 0.2];
      for (const ry of rails) {
        const g = new THREE.BoxGeometry(len, variant === 'railing' ? 0.03 : 0.08, variant === 'railing' ? 0.03 : 0.04).rotateY(-rot).translate(mx, my + ry, mz);
        (variant === 'railing' ? P.iron : variant === 'picket' ? P.white : P.wood).push(g);
      }
      if (variant === 'picket' || variant === 'railing') {
        const step = variant === 'picket' ? 0.14 : 0.13, m = Math.max(1, Math.floor(len / step));
        for (let j = 1; j < m; j++) {
          const t = j / m, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, gy = y0 + (y1 - y0) * t;
          if (variant === 'picket') P.white.push(new THREE.BoxGeometry(0.08, h - 0.05, 0.02).rotateY(-rot).translate(x, gy + (h - 0.05) / 2, z));
          else {
            P.iron.push(new THREE.CylinderGeometry(0.01, 0.01, h, 4).translate(x, gy + h / 2, z));
            P.iron.push(new THREE.ConeGeometry(0.025, 0.09, 4).translate(x, gy + h + 0.04, z));
          }
        }
      }
    }
    if (k === points.length - 2) post(bx, bz, rot, y(bx, bz));
  }
  return P;
}
