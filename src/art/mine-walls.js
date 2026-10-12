/**
 * M19 art pass (Oldenburg coal mine): two linear wall visuals the generic wall kit drew as plain boxes.
 *   - ruin_wall            broken field-stone walls of a demolished farmstead: coursed stones on a rubble core, a ragged
 *                          top that never drops below 70 % of the gameplay height (it is still the cover the mission
 *                          tuned), fallen stones at the foot within 0.45 m of the face, frost-killed weeds
 *   - whitewashed_concrete the base's whitewashed concrete block (the Green Beret's climb): board-marked concrete under
 *                          a flaking lime wash, a coal-grimed foot, a projecting cap, rust tears from two iron hooks
 * Both stay inside the gameplay footprint (a line `width` wide, no end caps) and return world-frame meshes.
 * @module art/mine-walls
 */
import * as THREE from 'three';
import { dressingMaterial, boxUV, consolidate } from './dressing.js';


function mesh(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

let M = null;
function mats() {
  if (M) return M;
  const tint = (name, c) => { const x = dressingMaterial(name).clone(); x.color = new THREE.Color(c); x.name = `${x.name}:m19`; return x; };
  M = { stone: dressingMaterial('fieldstone'), core: tint('rubble', 0x8a847a), white: tint('plasterWhite', 0xf4f1e8),
    raw: new THREE.MeshStandardMaterial({ color: 0x8e897e, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, name: 'm19:flake' }),
    foot: tint('concrete', 0x79756b), cap: tint('concrete', 0xb4b0a6),
    rust: new THREE.MeshStandardMaterial({ color: 0x6e3b22, roughness: 0.9, transparent: true, opacity: 0.55, depthWrite: false, name: 'm19:rust' }),
    soot: new THREE.MeshStandardMaterial({ color: 0x3a3732, roughness: 1, transparent: true, opacity: 0.35, depthWrite: false, name: 'm19:runoff' }),
    weed: new THREE.MeshStandardMaterial({ color: 0x7a7350, roughness: 1, side: THREE.DoubleSide, name: 'm19:weed' }) };
  return M;
}

/** A ragged flake outline (rw × rh half-extents) in the XY plane, facing +Z: a jittered ellipse, never a rectangle. */
function flakeShape(rw, rh, R) {
  const n = 11, sh = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, r = 0.62 + R() * 0.38;
    const x = Math.cos(a) * rw * r, y = Math.sin(a) * rh * r * (0.8 + 0.4 * Math.abs(Math.cos(a)));
    if (i) sh.lineTo(x, y); else sh.moveTo(x, y);
  }
  sh.closePath();
  return new THREE.ShapeGeometry(sh);
}

/** Local frame of one run: origin at a, x along the run, z across. */
function frame(ax, az, bx, bz) {
  const g = new THREE.Group();
  g.position.set(ax, 0, az);
  g.rotation.y = -Math.atan2(bz - az, bx - ax);
  return g;
}

/** Broken field-stone wall along a polyline (`o.h` gameplay height, `o.width`). */
export function ruinedStoneWall(points, o, R) {
  const m = mats(), root = new THREE.Group(); root.name = 'dressing:wall:ruin_stone';
  const h = o.h ?? 1.4, w = Math.max(0.5, o.width ?? 0.8), minF = 0.72;
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-3) continue;
    const g = frame(ax, az, bx, bz);
    const x0 = k === 0 ? 0 : -w / 2, x1 = k + 2 === points.length ? L : L + w / 2; // inner corners close up
    // the ragged top: a random walk with a few deep bites, never under minF·h
    const n = Math.max(4, Math.round((x1 - x0) / 0.5)), top = [];
    let cur = 0.9 + R() * 0.1;
    for (let i = 0; i <= n; i++) {
      cur += (R() - 0.5) * 0.16;
      if (R() < 0.08) cur -= 0.15;
      cur = Math.min(1.02, Math.max(minF, cur));
      top.push(cur * h);
    }
    // rubble core up to the lowest top (the wall's body), stones laid in courses over it up to the ragged line
    const coreH = Math.min(...top) - 0.05;
    const core = mesh(boxUV(new THREE.BoxGeometry(x1 - x0, coreH, w * 0.82), 1.4), m.core);
    core.position.set((x0 + x1) / 2, coreH / 2, 0);
    g.add(core);
    const CH = 0.24;
    for (let y = 0; y < h * 1.02; y += CH) {
      let x = x0 + (Math.round(y / CH) % 2 ? 0.2 : 0) * R();
      while (x < x1 - 0.05) {
        const len = Math.min(x1 - x, 0.38 + R() * 0.42);
        const i = Math.min(n, Math.max(0, Math.round(((x + len / 2 - x0) / (x1 - x0)) * n)));
        if (y + CH * 0.5 <= top[i]) {
          const hh = Math.min(CH * (0.85 + R() * 0.2), top[i] - y);
          for (const side of [-1, 1]) {
            if (y + hh < coreH && R() < 0.35) continue;   // the core shows between some face stones (mortar loss)
            const s = mesh(boxUV(new THREE.BoxGeometry(len - 0.04, hh, w * 0.24), 0.9), m.stone);
            s.position.set(x + len / 2, y + hh / 2, side * (w / 2 - w * 0.12 - R() * 0.03));
            s.rotation.set((R() - 0.5) * 0.06, (R() - 0.5) * 0.08, (R() - 0.5) * 0.05);
            g.add(s);
          }
          if (y + CH >= coreH) {                           // fill the top between the faces
            const f = mesh(boxUV(new THREE.BoxGeometry(len - 0.06, hh, w * 0.5), 0.9), m.stone);
            f.position.set(x + len / 2, y + hh / 2, (R() - 0.5) * 0.05);
            g.add(f);
          }
        }
        x += len;
      }
    }
    // fallen stones at the foot (inside 0.45 m of the face) and dead weeds
    const nf = Math.round((x1 - x0) * 1.6);
    for (let i = 0; i < nf; i++) {
      const sz = 0.18 + R() * 0.22, side = R() < 0.5 ? -1 : 1;
      const s = mesh(boxUV(new THREE.BoxGeometry(sz * 1.4, sz * 0.7, sz), 0.9), m.stone);
      s.position.set(x0 + R() * (x1 - x0), sz * 0.3, side * (w / 2 + 0.08 + R() * 0.3));
      s.rotation.set(R() * 0.5, R() * Math.PI, R() * 0.5);
      g.add(s);
    }
    for (let i = 0; i < Math.round((x1 - x0) * 0.8); i++) {
      const tuft = mesh(new THREE.ConeGeometry(0.12 + R() * 0.1, 0.35 + R() * 0.3, 5, 1, true), m.weed);
      tuft.position.set(x0 + R() * (x1 - x0), 0.2, (R() < 0.5 ? -1 : 1) * (w / 2 + 0.05 + R() * 0.15));
      tuft.castShadow = false;
      g.add(tuft);
    }
    root.add(g);
  }
  return consolidate(root);
}

/** The whitewashed concrete block: L along the run × `width` across × h (no end caps, like its nav). */
export function whitewashedBlock(points, o, R) {
  const m = mats(), root = new THREE.Group(); root.name = 'dressing:wall:white_block';
  const h = o.h ?? 3, w = o.width ?? 0.5;
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-3) continue;
    const g = frame(ax, az, bx, bz);
    const body = mesh(boxUV(new THREE.BoxGeometry(L - 0.04, h - 0.12, w - 0.04), 2.2), m.white);
    body.position.set(L / 2, (h - 0.12) / 2, 0);
    const foot = mesh(boxUV(new THREE.BoxGeometry(L, 0.6, w), 1.6), m.foot);
    foot.position.set(L / 2, 0.3, 0);
    const cap = mesh(boxUV(new THREE.BoxGeometry(L + 0.12, 0.14, w + 0.12), 1.6), m.cap);
    cap.position.set(L / 2, h - 0.07, 0);
    g.add(body, foot, cap);
    // lime wash flaking off: a few irregular, softly ragged flakes of bare grey concrete laid flat on the faces (no
    // proud boxes: those caught the shadow map and read as black pixel blocks), mostly low down and near the corners
    const faces = [[0, 1, L], [0, -1, L], [1, 0, w], [-1, 0, w]];
    for (const [fx, fz, span] of faces) {
      const np = Math.max(fx ? 0 : 1, Math.round(span * 0.55));
      for (let i = 0; i < np; i++) {
        const rw = Math.min(span * 0.4, 0.2 + R() * 0.45), rh = 0.12 + R() * 0.3;
        const y = 0.66 + rh + Math.pow(R(), 1.5) * Math.max(0, h - 1.4 - 2 * rh);
        const edge = R() < 0.45 ? Math.sign(R() - 0.5) : 0;            // hug a corner, where the wash goes first
        const t = edge ? edge * (span / 2 - rw - 0.05) : (R() - 0.5) * (span - 2 * rw - 0.2);
        const p = new THREE.Mesh(flakeShape(rw, rh, R), m.raw);
        p.position.set(fx ? L / 2 + fx * (L / 2 - 0.012) : L / 2 + t, y, fz ? fz * (w / 2 - 0.012) : t);
        p.rotation.y = fx ? fx * Math.PI / 2 : fz > 0 ? 0 : Math.PI;
        p.receiveShadow = true;
        g.add(p);
      }
    }
    // run-off under the cap: soot-grey tears down every face from the cap's drip edge
    for (const [fx, fz, span] of faces) {
      for (let i = 0; i < Math.round(span * 0.9); i++) {
        const t = (R() - 0.5) * (span - 0.4), len = 0.5 + R() * 1.3;
        const s = new THREE.Mesh(new THREE.PlaneGeometry(0.12 + R() * 0.2, len), m.soot);
        s.position.set(fx ? L / 2 + fx * (L / 2 + 0.004) : L / 2 + t, h - 0.14 - len / 2, fz ? fz * (w / 2 + 0.004) : t);
        s.rotation.y = fx ? fx * Math.PI / 2 : fz > 0 ? 0 : Math.PI;
        g.add(s);
      }
    }
    // two iron hooks on the long faces with rust tears under them
    for (const side of [-1, 1]) {
      const x = L * (0.3 + R() * 0.4);
      const hook = mesh(new THREE.BoxGeometry(0.06, 0.06, 0.1), m.foot);
      hook.position.set(x, h - 0.6, side * (w / 2 + 0.03));
      const tear = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 1.3), m.rust);
      tear.position.set(x, h - 1.3, side * (w / 2 + 0.004));
      tear.rotation.y = side > 0 ? 0 : Math.PI;
      g.add(hook, tear);
    }
    root.add(g);
  }
  return consolidate(root);
}
