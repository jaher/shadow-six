/**
 * The Sapper's demolition charges (design-spec §3.4), modelled as a WWII British commando would set them (user
 * 2026-10-08 "The explosive looks like a circle, make it look realistic"; the knapsack icons, tools/blender/icons/models/
 * boxes.py, are the reference): a bundle of two canvas-wrapped slabs of plastic explosive (Nobel 808) tied with webbing,
 * an aluminium detonator with its red cap pushed into the top slab, and
 *   time   — a brass pocket-watch delay strapped on top, cream dial and a red hand, red and black leads to the detonator;
 *   remote — an olive-drab receiver box (bakelite knob, red pilot lamp, nickel telescopic aerial) wired to the detonator.
 * About 0.31 × 0.18 m, 0.11 m high (×CHARGE_SCALE; the aerial 0.29 m more); ≈ 400 triangles from geometries and materials shared by
 * every charge (`userData.shared`: Entity.dispose keeps them). Local frame: +z = the long side, detonator end first
 * (an entity model faces +z: the planter's heading), y up, base on y = 0.
 *   `tick({time, fuse, fuse0, detonating})` — the armed cue, from SIM time (deterministic captures): the watch hand sweeps
 *     once round the dial over the fuse and the dial face flashes at each tick (2 Hz → 4 Hz, as the bomb_tick loop); the
 *     receiver's pilot lamp winks once a second, and burns steady once the detonator has fired it (0.2 s radio delay).
 *   `chargeWeapon(kind)` — the same model as a commandos_b clip-bound hand prop (plant / take_charge), `grip_r` socket.
 * @module art/demolition-charge
 */

import * as THREE from 'three';

/** Slab bundle size (m, before CHARGE_SCALE): long side, width, the two slabs' heights. */
export const CHARGE_SIZE = Object.freeze({ L: 0.26, W: 0.15, H1: 0.045, H2: 0.04 });
const TOP = CHARGE_SIZE.H1 + CHARGE_SIZE.H2; // top of the upper slab
/** The model is drawn ×1.2: a 0.31 m bundle, at the top of the 25–35 cm a real charge of this kind ran to, so it reads. */
export const CHARGE_SCALE = 1.2;

const M = {};
/** Shared materials (muted khaki paper, hemp, brass, steel, olive drab). */
function mats() {
  if (M.paper) return M;
  const S = (o) => new THREE.MeshStandardMaterial(o);
  // olive-khaki canvas-wrapped slabs (dark enough to read on snow and sand), pale webbing ties that stripe them
  M.paper = S({ color: 0x6f6743, roughness: 0.8, name: 'charge:canvas' });
  M.paper2 = S({ color: 0x625b3b, roughness: 0.82, name: 'charge:canvas2' });
  M.cord = S({ color: 0xb8a97e, roughness: 0.9, name: 'charge:webbing' });
  M.brass = S({ color: 0xb08a3a, roughness: 0.35, metalness: 0.85, name: 'charge:brass' });
  M.dial = S({ color: 0xece2c6, roughness: 0.5, emissive: 0xfff2c8, emissiveIntensity: 0.08, name: 'charge:dial' });
  M.dialLit = S({ color: 0xf6eed6, roughness: 0.5, emissive: 0xfff2c8, emissiveIntensity: 0.9, name: 'charge:dial_lit' });
  M.hand = S({ color: 0x8e1b12, roughness: 0.5, name: 'charge:hand' });
  M.alu = S({ color: 0xb4b4b0, roughness: 0.35, metalness: 0.8, name: 'charge:alu' });
  M.red = S({ color: 0x9e1a12, roughness: 0.5, name: 'charge:red' });
  M.black = S({ color: 0x1c1a18, roughness: 0.45, name: 'charge:black' });
  M.od = S({ color: 0x4d5136, roughness: 0.7, metalness: 0.2, name: 'charge:olive_drab' });
  M.nickel = S({ color: 0xa9aaa6, roughness: 0.25, metalness: 0.9, name: 'charge:nickel' });
  M.lampOff = S({ color: 0x4a120c, roughness: 0.4, name: 'charge:lamp_off' });
  M.lampOn = new THREE.MeshBasicMaterial({ color: 0xff4a28, name: 'charge:lamp_on' });
  for (const m of Object.values(M)) m.userData.shared = true;
  return M;
}

const G = {};
/** Shared geometries (built once). */
function geos() {
  if (G.slab1) return G;
  const { L, W, H1, H2 } = CHARGE_SIZE;
  G.slab1 = new THREE.BoxGeometry(L, H1, W).translate(0, H1 / 2, 0);
  G.slab2 = new THREE.BoxGeometry(L - 0.012, H2, W - 0.008).translate(0, H1 + H2 / 2, 0);
  G.tie = new THREE.BoxGeometry(0.012, TOP + 0.005, W + 0.006).translate(0, (TOP + 0.005) / 2 - 0.001, 0);
  // brass pocket-watch delay: case, dial, red hand (pivot at the dial's centre, pointing +x), the crown
  G.watch = new THREE.CylinderGeometry(0.047, 0.049, 0.02, 16).translate(0, 0.01, 0);
  G.dial = new THREE.CylinderGeometry(0.04, 0.04, 0.002, 16).translate(0, 0.021, 0);
  G.hand = new THREE.BoxGeometry(0.034, 0.002, 0.005).translate(0.015, 0.0235, 0);
  G.crown = new THREE.CylinderGeometry(0.007, 0.007, 0.012, 8).rotateZ(Math.PI / 2).translate(0.054, 0.01, 0);
  // detonator: aluminium tube, red end cap (axis +y, base at 0)
  G.det = new THREE.CylinderGeometry(0.0065, 0.0065, 0.05, 8).translate(0, 0.025, 0);
  G.detCap = new THREE.CylinderGeometry(0.0075, 0.0075, 0.01, 8).translate(0, 0.053, 0);
  // receiver: olive box, bakelite knob, pilot lamp, aerial base + three telescoping tubes + tip ball
  G.rx = new THREE.BoxGeometry(0.085, 0.05, 0.068).translate(0, 0.025, 0);
  G.knob = new THREE.CylinderGeometry(0.009, 0.009, 0.008, 10).translate(-0.022, 0.054, 0.012);
  G.lamp = new THREE.SphereGeometry(0.0085, 8, 5).translate(0.004, 0.052, -0.016);
  G.antBase = new THREE.CylinderGeometry(0.006, 0.006, 0.012, 8).translate(0, 0.006, 0);
  G.ant = new THREE.CylinderGeometry(0.0022, 0.0034, 0.24, 6).translate(0, 0.012 + 0.12, 0);
  G.antTip = new THREE.SphereGeometry(0.005, 6, 4).translate(0, 0.255, 0);
  for (const g of Object.values(G)) g.userData.shared = true;
  return G;
}

/** A lead (thin tube along points) — per charge kind, shared too. */
const LEADS = {};
function lead(key, pts, mat) {
  if (!LEADS[key]) {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    LEADS[key] = new THREE.TubeGeometry(curve, 8, 0.0028, 3, false);
    LEADS[key].userData.shared = true;
  }
  return new THREE.Mesh(LEADS[key], mat);
}

const mesh = (g, m, name, shadow = true) => {
  const o = new THREE.Mesh(g, m);
  o.name = name;
  o.castShadow = shadow;
  o.receiveShadow = true;
  return o;
};

/**
 * Build one charge.
 * @param {'time'|'remote'} kind
 * @param {{prop?: boolean}} [o] prop: the hand-prop variant (no shadow casting, nothing animates)
 * @returns {THREE.Group} with userData.charge = {kind, tick(state)}
 */
export function makeCharge(kind = 'time', { prop = false } = {}) {
  const m = mats(), g = geos();
  const top = new THREE.Group();
  top.name = kind === 'time' ? 'time_charge' : 'remote_charge';
  top.scale.setScalar(CHARGE_SCALE);
  // (the parts are laid out along x; turned so that the long side runs along +z, the way an entity faces)
  const root = new THREE.Group();
  root.name = 'charge_body';
  root.rotation.y = -Math.PI / 2;
  top.add(root);
  const sh = !prop;
  // the two slabs, the upper one set a little askew (tied by hand), and the two hemp ties round both
  root.add(mesh(g.slab1, m.paper, 'slab_a', sh));
  const s2 = mesh(g.slab2, m.paper2, 'slab_b', sh);
  s2.rotation.y = 0.04;
  root.add(s2);
  for (const x of [-0.075, 0.075]) { const t = mesh(g.tie, m.cord, 'tie', sh); t.position.x = x; root.add(t); }
  // detonator pushed into the top slab near its +x end, leaning out
  const det = new THREE.Group();
  det.name = 'detonator';
  det.position.set(0.098, TOP - 0.018, 0.02);
  det.rotation.z = -0.7;
  det.add(mesh(g.det, m.alu, 'det_tube', sh), mesh(g.detCap, m.red, 'det_cap', sh));
  root.add(det);
  const state = { kind, hand: null, dial: null, lamp: null };
  if (kind === 'time') {
    const w = new THREE.Group();
    w.name = 'watch';
    w.position.set(-0.05, TOP, -0.005);
    w.add(mesh(g.watch, m.brass, 'watch_case', sh), mesh(g.crown, m.brass, 'watch_crown', false));
    const dial = mesh(g.dial, m.dial, 'watch_dial', false);
    const hand = mesh(g.hand, m.hand, 'watch_hand', false);
    hand.rotation.y = Math.PI / 2; // 12 o'clock (towards -z)
    w.add(dial, hand);
    root.add(w);
    state.hand = hand; state.dial = dial;
    root.add(lead('t_red', [[-0.02, TOP + 0.012, -0.03], [0.02, TOP + 0.03, -0.045], [0.07, TOP + 0.03, -0.01], [0.105, TOP + 0.02, 0.016]], m.red));
    root.add(lead('t_blk', [[-0.02, TOP + 0.012, 0.025], [0.02, TOP + 0.032, 0.05], [0.07, TOP + 0.034, 0.04], [0.108, TOP + 0.021, 0.024]], m.black));
  } else {
    const rx = new THREE.Group();
    rx.name = 'receiver';
    rx.position.set(-0.05, TOP, 0);
    rx.add(mesh(g.rx, m.od, 'rx_box', sh), mesh(g.knob, m.black, 'rx_knob', false));
    const off = mesh(g.lamp, m.lampOff, 'rx_lamp', false);
    rx.add(off);
    const ant = new THREE.Group();
    ant.name = 'aerial';
    ant.position.set(0.026, 0.05, 0.02);
    ant.rotation.z = -0.12; ant.rotation.x = 0.08;
    ant.add(mesh(g.antBase, m.nickel, 'aerial_base', false), mesh(g.ant, m.nickel, 'aerial_rod', sh), mesh(g.antTip, m.nickel, 'aerial_tip', false));
    rx.add(ant);
    root.add(rx);
    state.lamp = off;
    root.add(lead('r_red', [[-0.008, TOP + 0.02, -0.034], [0.03, TOP + 0.03, -0.045], [0.08, TOP + 0.028, -0.01], [0.105, TOP + 0.02, 0.016]], m.red));
    root.add(lead('r_blk', [[-0.008, TOP + 0.02, 0.034], [0.03, TOP + 0.034, 0.05], [0.08, TOP + 0.032, 0.04], [0.108, TOP + 0.021, 0.024]], m.black));
  }
  top.userData.charge = {
    kind,
    /**
     * The armed cue from sim time. @param {{time:number, fuse?:number, fuse0?:number, detonating?:boolean}} s
     * @returns {{hand?: number, lit: boolean}} what it shows (tests)
     */
    tick(s = {}) {
      if (prop) return { lit: false };
      if (kind === 'time') {
        const F = Math.max(1e-3, s.fuse0 ?? 10), e = Math.min(F, Math.max(0, F - (Number.isFinite(s.fuse) ? s.fuse : F)));
        const a = (e / F) * Math.PI * 2;
        state.hand.rotation.y = Math.PI / 2 - a; // clockwise seen from above, from 12 o'clock
        // ticks at 2 Hz speeding to 4 Hz over the fuse (audio _tickBombs): phase ∫(2 + 2t/F) dt = 2t + t²/F
        const ph = 2 * e + (e * e) / F;
        const lit = e > 0 && ph - Math.floor(ph) < 0.2;
        state.dial.material = lit ? m.dialLit : m.dial;
        return { hand: a, lit };
      }
      const lit = !!s.detonating || ((s.time ?? 0) % 1) < 0.14;
      state.lamp.material = lit ? m.lampOn : m.lampOff;
      return { lit };
    },
  };
  return top;
}

/**
 * The thrown grenade (§3.4 E): a Mills bomb (No. 36) — the segmented olive cast-iron egg, its steel striker lever down
 * one side and the base plug — drawn ×1.6 so it reads in the air at the game camera (it was a 9 cm ball). ≈ 110 tris.
 */
export function makeMillsBomb() {
  const m = mats();
  if (!G.mills) {
    G.mills = new THREE.SphereGeometry(0.03, 8, 6).scale(1, 1.32, 1);
    G.millsGroove = new THREE.CylinderGeometry(0.0305, 0.0305, 0.006, 8);
    G.millsLever = new THREE.BoxGeometry(0.008, 0.07, 0.014).translate(0.031, 0.006, 0);
    G.millsPlug = new THREE.CylinderGeometry(0.011, 0.012, 0.012, 8).translate(0, -0.042, 0);
    for (const k of ['mills', 'millsGroove', 'millsLever', 'millsPlug']) G[k].userData.shared = true;
    M.iron = new THREE.MeshStandardMaterial({ color: 0x4b5232, roughness: 0.8, metalness: 0.3, name: 'mills:iron' });
    M.iron.userData.shared = true;
  }
  const root = new THREE.Group();
  root.name = 'mills_bomb';
  root.add(mesh(G.mills, M.iron, 'mills_body'));
  for (const y of [-0.014, 0.014]) { const r = mesh(G.millsGroove, m.black, 'mills_groove', false); r.position.y = y; root.add(r); }
  root.add(mesh(G.millsLever, m.nickel, 'mills_lever', false), mesh(G.millsPlug, m.brass, 'mills_plug', false));
  root.scale.setScalar(1.6);
  return root;
}

/** Triangles in a model (tests / budget). */
export function triangleCount(obj) {
  let n = 0;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return n;
}

/**
 * The weapons-library entry for the commandos_b runtime (`equipProp` clones `root` and finds its sockets by name): the
 * same charge in his right hand during the plant and the take (art/characters/commandos_b/weapons.js PROPS), held by the
 * near long edge of the bundle (`grip_r`), slabs flat on his palm.
 */
export function chargeWeapon(kind = 'time') {
  const root = new THREE.Group();
  root.name = `${kind}_bomb_prop`;
  const c = makeCharge(kind, { prop: true });
  // the palm under the bundle's middle, the bundle reaching ahead along the forearm (+z) and lying across it (x)
  c.rotation.y = Math.PI / 2;
  c.position.set(0, -0.01, 0.05);
  root.add(c);
  const grip = new THREE.Object3D();
  grip.name = 'grip_r';
  root.add(grip);
  return { root, sockets: { grip_r: grip } };
}
