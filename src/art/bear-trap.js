/**
 * The Sapper's bear trap (design-spec §3.3), modelled as a real long-spring jaw trap (user 2026-10-07 "the trap needs
 * to look more realistic, now it looks like a circle"): a cross bar with the round pan and its dog in the middle, two
 * serrated steel jaws hinged on the bar ends, a leaf spring on each side whose eye rides the jaw ends, a chain from the
 * bar to a ring stake driven into the ground.
 *   set   — jaws open flat, springs pressed down, half sunk in the theater's ground (snow / sand / earth): a scuffed
 *           mound covers the bar, the springs and the chain, only the jaw rims and teeth show through;
 *   sprung — jaws stand up shut, teeth interlocked, springs open, the cover kicked off.
 * `setSprung(t)` blends 0 (set) → 1 (sprung); `setGround(theater)` tints the cover. Trap length ≈ 0.95 m, jaw spread
 * 0.36 m (trigger radius 0.5 m, CONFIG.abilities.trap). Local frame: bar along x, jaws open towards ±z, y up.
 * @module art/bear-trap
 */

import * as THREE from 'three';

const R = 0.18; // jaw radius (m)
const JAW_Y = 0.03; // hinge height over the ground
const TEETH = 9; // per jaw
const GROUND = {
  snow: { color: 0xeef1f5, rough: 0.95 },
  desert: { color: 0xc9b089, rough: 1 },
  coast: { color: 0xb7a98c, rough: 1 },
  temperate: { color: 0x5b4b36, rough: 1 },
};

const M = {};
function mats() {
  if (M.steel) return M;
  M.steel = new THREE.MeshStandardMaterial({ color: 0x4a4744, roughness: 0.55, metalness: 0.75, name: 'trap:steel' });
  M.rust = new THREE.MeshStandardMaterial({ color: 0x5a3e2c, roughness: 0.85, metalness: 0.35, name: 'trap:rust' });
  M.teeth = new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.4, metalness: 0.85, name: 'trap:teeth' });
  M.wood = new THREE.MeshStandardMaterial({ color: 0x5e4630, roughness: 0.9, name: 'trap:stake' });
  for (const m of Object.values(M)) m.userData.shared = true;
  return M;
}

/** Half ring (θ 0..π) in the xz-plane on z ≥ 0 side, as a tube of radius `tube`. */
function halfRing(r, tube) {
  const g = new THREE.TorusGeometry(r, tube, 6, 20, Math.PI);
  g.rotateX(Math.PI / 2); // torus lies in xy → xz (θ from +x towards +z): the arc on +z
  return g;
}

/** One jaw: the serrated half ring, its teeth pointing up (+y local) — they face the other jaw once shut. */
function makeJaw(side) {
  const m = mats();
  const jaw = new THREE.Group();
  jaw.name = side > 0 ? 'trap_jaw_a' : 'trap_jaw_b';
  const rim = new THREE.Mesh(halfRing(R, 0.014), m.steel);
  rim.scale.z = side;
  rim.castShadow = true;
  jaw.add(rim);
  // a flat inner lip (the toothed plate) and the teeth
  const tg = new THREE.ConeGeometry(0.016, 0.045, 4);
  tg.translate(0, 0.0225, 0);
  tg.rotateZ(0.35); // raked inwards (local +x = radially out once turned to its place on the jaw)
  for (let k = 0; k < TEETH; k++) {
    const th = (Math.PI * (k + 0.5)) / TEETH;
    const t = new THREE.Mesh(tg, m.teeth);
    // alternate the teeth half a pitch inwards / outwards so the two jaws interlock when shut
    const rr = R - 0.004 + (k % 2 ? 0.006 : -0.002) * side;
    t.position.set(Math.cos(th) * rr, 0.006, Math.sin(th) * rr * side);
    t.rotation.y = -th * side; // local +x radially outwards
    t.castShadow = true;
    jaw.add(t);
  }
  return jaw;
}

/** A long leaf spring on one side (sx = ±1): two leaves from the jaw end out to the bent tail, the eye on the jaws. */
function makeSpring(sx) {
  const m = mats();
  const g = new THREE.Group();
  g.name = sx > 0 ? 'trap_spring_e' : 'trap_spring_w';
  const L = 0.3;
  const lower = new THREE.Mesh(new THREE.BoxGeometry(L, 0.01, 0.055), m.steel);
  lower.position.set(sx * (R + L / 2 - 0.01), 0.006, 0);
  lower.castShadow = true;
  const upper = new THREE.Group(); // pivots at the tail: lifts as the spring opens
  upper.name = 'trap_leaf';
  upper.position.set(sx * (R + L - 0.01), 0.012, 0);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(L - 0.02, 0.01, 0.05), m.steel);
  leaf.position.set(-sx * (L / 2 - 0.01), 0.004, 0);
  leaf.castShadow = true;
  upper.add(leaf);
  // the bent tail joining the two leaves
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.006, 5, 8, Math.PI), m.steel);
  tail.rotation.z = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
  tail.position.set(sx * (R + L - 0.005), 0.012, 0);
  // the eye: a flat loop round both jaw ends at the hinge
  const eye = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 5, 12), m.steel);
  eye.rotation.y = Math.PI / 2;
  eye.position.set(sx * (R + 0.012), JAW_Y, 0);
  eye.name = 'trap_eye';
  g.add(lower, upper, tail, eye);
  g.userData.upper = upper;
  g.userData.eye = eye;
  return g;
}

/** Chain (alternating oval links) from (x0, z0) to (x1, z1) a hair over the ground, and the ring stake at the end. */
function makeChain(x0, z0, x1, z1) {
  const m = mats();
  const g = new THREE.Group();
  g.name = 'trap_chain';
  const n = 7, link = new THREE.TorusGeometry(0.018, 0.0045, 4, 10);
  link.scale(1.6, 1, 1);
  const a = Math.atan2(z1 - z0, x1 - x0);
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    const l = new THREE.Mesh(link, m.rust);
    l.position.set(x0 + (x1 - x0) * t, 0.008 + 0.004 * Math.sin(t * 9), z0 + (z1 - z0) * t);
    l.rotation.set(k % 2 ? Math.PI / 2 : 0.25, -a, 0, 'YXZ');
    l.castShadow = true;
    g.add(l);
  }
  const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.008, 0.16, 6), m.wood);
  stake.position.set(x1, 0.03, z1);
  stake.rotation.z = 0.25;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 4, 10), m.rust);
  ring.position.set(x1 + 0.02, 0.1, z1);
  ring.rotation.y = a;
  g.add(stake, ring);
  return g;
}

/** Ground cover (snow / sand / earth) over the bar, springs and chain: a scuffed low mound + loose clumps. */
function makeCover() {
  const g = new THREE.Group();
  g.name = 'trap_cover';
  const mat = new THREE.MeshStandardMaterial({ color: GROUND.snow.color, roughness: GROUND.snow.rough, name: 'trap:cover' });
  const mound = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  mound.scale.set(0.46, 0.03, 0.27); // top at 3 cm: the jaw rims (3–4.4 cm), the pan and the teeth (to 7 cm) show through
  // scuffed, not a turned dish: every vertex jittered (fixed pattern), the rim sunk into the ground
  const mp = mound.geometry.attributes.position;
  for (let i = 0; i < mp.count; i++) {
    const x = mp.getX(i), y = mp.getY(i), z = mp.getZ(i), n = Math.sin(x * 9.1 + z * 4.3) * 0.5 + Math.sin(x * 3.7 - z * 11.9) * 0.5;
    mp.setXYZ(i, x * (1 + 0.16 * n), y * (0.75 + 0.45 * Math.abs(n)) - 0.15 * (1 - y), z * (1 + 0.16 * Math.sin(z * 7 + x * 5)));
  }
  mound.geometry.computeVertexNormals();
  mound.receiveShadow = true;
  mound.name = 'trap_mound';
  g.add(mound);
  const clump = new THREE.SphereGeometry(1, 7, 5);
  // loose clumps over the springs and across the jaw rims: the ring never reads as a clean circle
  const spots = [[0.32, 0.08, 0.06], [-0.36, -0.06, 0.05], [0.42, -0.1, 0.04], [0.15, 0.13, 0.05], [-0.17, -0.07, 0.045], [-0.06, 0.18, 0.04], [0.09, -0.17, 0.05], [-0.2, 0.25, 0.035]];
  for (const [x, z, r] of spots) {
    const c = new THREE.Mesh(clump, mat);
    c.position.set(x, 0.026, z);
    c.scale.set(r, r * 0.55, r * 0.8);
    c.receiveShadow = true;
    g.add(c);
  }
  g.userData.mat = mat;
  return g;
}

/**
 * Build the trap. @param {{theater?: string, heading?: number}} [o]
 * @returns {THREE.Group} with userData.setSprung(t 0..1), userData.setGround(theater), userData.sprung (last t)
 */
export function makeBearTrap(o = {}) {
  const m = mats();
  const root = new THREE.Group();
  root.name = 'bear_trap';
  const body = new THREE.Group();
  body.name = 'trap_body';
  body.rotation.y = o.heading ?? 0;
  root.add(body);
  // cross bar (the jaws' hinge axle) and the pan with its dog
  const bar = new THREE.Mesh(new THREE.BoxGeometry(2 * R + 0.06, 0.012, 0.03), m.steel);
  bar.position.y = 0.012;
  const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.006, 16), m.rust);
  pan.position.y = 0.032; // the pan sits up in the middle of the open jaws
  pan.name = 'trap_pan';
  const dog = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.11), m.steel);
  dog.position.set(0.04, 0.037, 0.05);
  dog.rotation.y = 0.3;
  for (const p of [bar, pan, dog]) p.castShadow = true;
  body.add(bar, pan, dog);
  // jaws on the hinge axle (x axis at JAW_Y)
  const hinge = new THREE.Group();
  hinge.position.y = JAW_Y;
  const ja = makeJaw(1), jb = makeJaw(-1);
  hinge.add(ja, jb);
  body.add(hinge);
  const se = makeSpring(1), sw = makeSpring(-1);
  body.add(se, sw);
  body.add(makeChain(-(R + 0.3), 0.01, -(R + 0.42), 0.26)); // from the west spring's tail to the stake
  const cover = makeCover();
  root.add(cover);
  const U = root.userData;
  U.jaws = [ja, jb];
  U.springs = [se, sw];
  U.cover = cover;
  U.setSprung = (t) => {
    t = Math.max(0, Math.min(1, t));
    U.sprung = t;
    const a = (Math.PI / 2) * (1 - (1 - t) ** 3) * 0.97; // ease-out snap; shut a hair short of vertical (teeth meet)
    ja.rotation.x = -a; ja.position.z = 0.006 * t;
    jb.rotation.x = a; jb.position.z = -0.006 * t;
    for (const s of U.springs) {
      const sx = s === se ? 1 : -1;
      s.userData.upper.rotation.z = sx * 0.28 * t; // the upper leaf springs open
      s.userData.eye.position.set(sx * (R + 0.012 - 0.025 * t), JAW_Y + 0.035 * t, 0); // the eye rides up the jaw heels
    }
    cover.visible = t < 0.5; // kicked off when it snaps
    pan.position.y = 0.032 - 0.012 * t;
  };
  U.setGround = (theater) => {
    const gnd = GROUND[theater] || GROUND.temperate;
    cover.userData.mat.color.setHex(gnd.color);
    cover.userData.mat.roughness = gnd.rough;
    U.theater = theater;
  };
  U.setGround(o.theater || 'snow');
  U.setSprung(0);
  return root;
}

/** Sizes for tests: jaw radius / hinge height / teeth per jaw. */
export const BEAR_TRAP = { R, JAW_Y, TEETH };
