/**
 * Period street lamps (step 3p, user: "did you make lamp posts?"). Each variant is built once from lathe / tube /
 * box primitives into per-material part lists and drawn instanced (art/furniture/index.js). Local frame: base on
 * the ground at the origin, arm / lantern reaching towards +X (the road), light position in `light`.
 *  - paris_single   French/Belgian cast-iron candelabra: fluted base, tapered column, ladder-rest crossbar, lantern
 *  - paris_double   two scrolled arms with lanterns
 *  - wall_bracket   scroll bracket on a wall with a lantern (origin = wall face at ground)
 *  - norway_wood    creosoted wooden pole, angled iron arm, enamel reflector shade + bulb, service wire loop
 *  - harbour        short quay lamp: stout iron post, globe lantern, mooring-style base
 *  - platform       railway platform lamp: iron column with swan-neck and enamel shade
 *  - floodlight     German military floodlights: tall wooden pole, two box floods angled down, cable
 *  - searchlight    60 cm searchlight drum on a pole with a railing platform
 *  - wall_lamp      enamel gooseneck wall lamp (origin = wall face at ground)
 * Modifiers (per placement): hooded (blackout slot hood: dim, downward), damaged (broken glass, unlit), lean (°).
 * @module art/furniture/lamps
 */
import * as THREE from 'three';

const V2 = (r, y) => new THREE.Vector2(r, y);
const lathe = (pts, seg = 12, y0 = 0) => new THREE.LatheGeometry(pts.map(([r, y]) => V2(r, y + y0)), seg);
const cyl = (r0, r1, h, x, y, z, seg = 8) => new THREE.CylinderGeometry(r1, r0, h, seg).translate(x, y + h / 2, z);
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const tube = (pts, r, seg = 16, rs = 6) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))), seg, r, rs, false);

/** Four-sided tapered lantern (frame + glass + cap + finial) centred at (x, y, z) — y = bottom of the glass. */
function lantern(P, x, y, z, s = 1, hooded = false) {
  const h = 0.55 * s, rb = 0.14 * s, rt = 0.24 * s;
  P.glass.push(new THREE.CylinderGeometry(rt * 0.93, rb * 0.93, h, 4, 1, true).rotateY(Math.PI / 4).translate(x, y + h / 2, z));
  for (let k = 0; k < 4; k++) {   // corner ribs
    const a = Math.PI / 4 + k * Math.PI / 2;
    const b = new THREE.Vector3(x + Math.cos(a) * rb, y, z + Math.sin(a) * rb), t = new THREE.Vector3(x + Math.cos(a) * rt, y + h, z + Math.sin(a) * rt);
    const g = new THREE.CylinderGeometry(0.012 * s, 0.012 * s, b.distanceTo(t), 4);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), t.clone().sub(b).normalize()));
    g.translate((b.x + t.x) / 2, (b.y + t.y) / 2, (b.z + t.z) / 2);
    P.iron.push(g);
  }
  P.iron.push(lathe([[0, 0], [rb * 1.1, 0], [rb * 1.05, -0.05 * s], [0.03 * s, -0.12 * s], [0, -0.14 * s]], 8, y).translate(x, 0, z));
  P.iron.push(lathe([[rt * 1.15, 0], [rt * 1.2, 0.03 * s], [rt * 0.7, 0.12 * s], [0.05 * s, 0.22 * s], [0.02 * s, 0.34 * s], [0.035 * s, 0.37 * s], [0, 0.4 * s]], 8, y + h).translate(x, 0, z));
  if (hooded) P.hood.push(new THREE.CylinderGeometry(rt * 1.25, rt * 1.05, h * 0.75, 4, 1, true).rotateY(Math.PI / 4).translate(x, y + h * 0.62, z));
  return { x, y: y + h * 0.45, z };
}

/** Enamel reflector shade (dish) with a bulb under it, hanging at (x, y, z). */
function shade(P, x, y, z, r = 0.24, hooded = false) {
  P.enamel.push(lathe([[0.02, 0.1], [0.05, 0.08], [r * 0.6, 0.02], [r, -0.06], [r * 1.02, -0.075]], 14, 0).translate(x, y, z));
  P.glass.push(new THREE.SphereGeometry(0.055, 10, 8).translate(x, y - 0.03, z));
  if (hooded) P.hood.push(new THREE.CylinderGeometry(r * 1.05, r * 1.08, 0.08, 14, 1, true).translate(x, y - 0.1, z));
  return { x, y: y - 0.05, z };
}

/** Cast-iron candelabra column: fluted base, tapered shaft, collar, lamplighter's ladder rest. */
function parisColumn(P) {
  P.iron.push(lathe([[0, 0], [0.24, 0], [0.24, 0.08], [0.2, 0.12], [0.2, 0.5], [0.15, 0.62], [0.12, 0.66], [0.13, 0.75], [0.085, 0.82]], 16));
  P.iron.push(cyl(0.085, 0.06, 2.9, 0, 0.82, 0, 10));
  P.iron.push(lathe([[0.06, 0], [0.09, 0.05], [0.09, 0.1], [0.05, 0.16]], 10, 3.72));
  P.iron.push(box(0.62, 0.035, 0.035, 0, 3.55, 0), cyl(0.018, 0.018, 0.12, -0.29, 3.43, 0, 5), cyl(0.018, 0.018, 0.12, 0.29, 3.43, 0, 5));
}

const BUILDERS = {
  paris_single(P, o) {
    parisColumn(P);
    return lantern(P, 0, 3.94, 0, 1, o.hooded);
  },
  paris_double(P, o) {
    parisColumn(P);
    const L = [];
    for (const sx of [-1, 1]) {
      P.iron.push(tube([[0, 3.7, 0], [sx * 0.35, 3.95, 0], [sx * 0.7, 3.9, 0], [sx * 0.8, 3.72, 0]], 0.03, 14));
      P.iron.push(tube([[sx * 0.1, 3.4, 0], [sx * 0.3, 3.55, 0], [sx * 0.42, 3.8, 0]], 0.018, 8));
      L.push(lantern(P, sx * 0.8, 3.14, 0, 0.9, o.hooded));
    }
    return { ...L[1], extra: L[0] };
  },
  wall_bracket(P, o) {
    P.iron.push(box(0.05, 0.4, 0.14, 0.025, 3.1, 0));
    P.iron.push(tube([[0.05, 3.25, 0], [0.4, 3.3, 0], [0.62, 3.2, 0]], 0.025, 10), tube([[0.05, 2.95, 0], [0.25, 3.02, 0], [0.4, 3.28, 0]], 0.015, 8));
    return lantern(P, 0.62, 2.62, 0, 0.8, o.hooded);
  },
  norway_wood(P, o) {
    P.wood.push(cyl(0.12, 0.09, 6.8, 0, -0.4, 0, 9));
    P.iron.push(tube([[0.05, 5.6, 0], [0.8, 5.75, 0], [1.4, 5.62, 0]], 0.025, 10), tube([[0.08, 5.1, 0], [0.5, 5.4, 0], [0.9, 5.7, 0]], 0.015, 8));
    P.iron.push(cyl(0.012, 0.012, 0.18, 1.4, 5.46, 0, 5));
    P.wire.push(tube([[0.06, 6.2, 0.05], [0.4, 5.9, 0.08], [1.2, 5.8, 0.02], [1.4, 5.66, 0]], 0.008, 12, 4));
    return shade(P, 1.4, 5.45, 0, 0.26, o.hooded);
  },
  harbour(P, o) {
    P.iron.push(lathe([[0, 0], [0.22, 0], [0.2, 0.1], [0.13, 0.2], [0.11, 0.9], [0.14, 1.0], [0.08, 1.1]], 14));
    P.iron.push(cyl(0.08, 0.06, 2.2, 0, 1.1, 0, 10), box(0.5, 0.03, 0.03, 0, 3.0, 0));
    P.iron.push(lathe([[0.06, 0], [0.1, 0.04], [0.08, 0.1]], 10, 3.3));
    P.glass.push(new THREE.SphereGeometry(0.2, 14, 10).translate(0, 3.58, 0));
    P.iron.push(lathe([[0.12, 0], [0.1, 0.05], [0.03, 0.1], [0, 0.12]], 10, 3.76));
    if (o.hooded) P.hood.push(new THREE.SphereGeometry(0.215, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 3.6, 0));
    return { x: 0, y: 3.58, z: 0 };
  },
  platform(P, o) {
    P.iron.push(lathe([[0, 0], [0.16, 0], [0.15, 0.08], [0.09, 0.2], [0.07, 0.3]], 12));
    P.iron.push(cyl(0.07, 0.055, 3.1, 0, 0.3, 0, 10));
    P.iron.push(tube([[0, 3.35, 0], [0.05, 3.7, 0], [0.35, 3.85, 0], [0.62, 3.7, 0], [0.66, 3.55, 0]], 0.028, 14));
    return shade(P, 0.66, 3.5, 0, 0.3, o.hooded);
  },
  floodlight(P, o) {
    P.wood.push(cyl(0.13, 0.1, 7.6, 0, -0.4, 0, 9));
    P.wood.push(box(1.3, 0.12, 0.12, 0.1, 6.7, 0));
    const L = [];
    for (const sz of [-0.42, 0.42]) {
      P.iron.push(box(0.34, 0.3, 0.26, 0.35, 6.95, sz));
      P.glass.push(box(0.02, 0.24, 0.2, 0.53, 6.93, sz));
      P.iron.push(box(0.04, 0.2, 0.04, 0.35, 6.76, sz));
      L.push({ x: 0.6, y: 6.9, z: sz });
    }
    P.wire.push(tube([[0.12, 6.6, 0], [0.2, 4, 0.05], [0.13, 1.2, 0.02]], 0.012, 8, 4));
    return { ...L[0], extra: L[1], kind: 'flood' };
  },
  searchlight(P) {
    P.wood.push(cyl(0.16, 0.12, 6.0, 0, -0.4, 0, 9));
    P.iron.push(box(1.4, 0.06, 1.4, 0, 5.6, 0));
    for (const [x, z] of [[-0.68, -0.68], [0.68, -0.68], [0.68, 0.68], [-0.68, 0.68]]) P.iron.push(cyl(0.015, 0.015, 0.9, x, 5.63, z, 4));
    P.iron.push(box(1.4, 0.03, 0.03, 0, 6.45, 0.68), box(1.4, 0.03, 0.03, 0, 6.45, -0.68), box(0.03, 0.03, 1.4, 0.68, 6.45, 0), box(0.03, 0.03, 1.4, -0.68, 6.45, 0));
    P.iron.push(new THREE.CylinderGeometry(0.34, 0.34, 0.62, 16, 1, false).rotateZ(Math.PI / 2 - 0.25).translate(0.1, 6.2, 0));
    P.iron.push(box(0.1, 0.5, 0.5, -0.05, 5.9, 0));
    P.glass.push(new THREE.CircleGeometry(0.3, 16).rotateY(Math.PI / 2).rotateZ(-0.25).translate(0.41, 6.28, 0));
    return { x: 0.45, y: 6.28, z: 0, kind: 'search' };
  },
  wall_lamp(P, o) {
    P.iron.push(box(0.04, 0.2, 0.12, 0.02, 2.9, 0), tube([[0.03, 2.9, 0], [0.2, 3.05, 0], [0.4, 2.95, 0], [0.45, 2.8, 0]], 0.018, 10));
    return shade(P, 0.45, 2.78, 0, 0.2, o.hooded);
  },
};

export const LAMP_VARIANTS = Object.freeze(Object.keys(BUILDERS));

/** Default light per variant: colour (tungsten ≈ 2400–2700 K, pre-saturated: the night grade takes ~40 % of the
 *  chroma away and the warm-lamp / cold-moon contrast is the look; carbon arc floods whiter), intensity (cd-ish scale), range (m), ground pool radius. */
export const LAMP_LIGHT = {
  paris_single: { color: 0xffa24c, intensity: 6, range: 12, pool: 5 }, paris_double: { color: 0xffa24c, intensity: 9, range: 13, pool: 6 },
  wall_bracket: { color: 0xffa24c, intensity: 5, range: 10, pool: 4 }, norway_wood: { color: 0xffaa58, intensity: 7, range: 13, pool: 5.5 },
  harbour: { color: 0xffa650, intensity: 6, range: 12, pool: 5 }, platform: { color: 0xffac5c, intensity: 6, range: 11, pool: 4.5 },
  floodlight: { color: 0xffe2bc, intensity: 18, range: 24, pool: 10 }, searchlight: { color: 0xeef3ff, intensity: 40, range: 40, pool: 3 },
  wall_lamp: { color: 0xffa650, intensity: 4, range: 9, pool: 3.5 },
};

/**
 * Part lists for a lamp variant: {iron, glass, wood, enamel, hood, wire: BufferGeometry[]} + light position(s).
 * @param {string} variant @param {{hooded?:boolean}} [o]
 */
export function lampParts(variant, o = {}) {
  const P = { iron: [], glass: [], wood: [], enamel: [], hood: [], wire: [] };
  const light = (BUILDERS[variant] || BUILDERS.paris_single)(P, o);
  return { parts: P, light };
}
