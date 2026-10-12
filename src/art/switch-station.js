/**
 * A mission switch's station, drawn (world/switch-station.js; user 2026-10-12: "in mission 3 there should be small
 * station with a lever to deactivate the electricity from the fence. Right now the spy pulls a lever in the void").
 *
 * The model: a small board-formed concrete switch kiosk (Schaltkiosk) on a buried plinth, its roof a concrete slab with
 * a drip edge, as the German power stations of the time put beside a fence feed —
 *  - a riveted field-grey steel door with three hinges, a handle, a padlock hasp, louvred vents and the enamel
 *    "Hochspannung – Lebensgefahr" plate (red lightning arrow);
 *  - beside it the cast-iron operating housing, its EIN / AUS quadrant on the side and the big hand lever: a signal-red
 *    arm with a black crossbar grip, pivoting on a boss (up = on, pulled down and out = off);
 *  - on the roof a two-pole disconnector: brown-glazed post insulators on a galvanised frame, copper knife blades
 *    (closed: lying in their jaws; open: standing up) worked from the lever by a rod and a crank on their shaft;
 *  - the feed from the transformer yard up a conduit on one side, the fence line down a conduit on the other and away
 *    under the ground (toward the fence, behind the kiosk in M3).
 * Top-facing snow comes from the scene's prop snow cover (it stands under propsRoot), shadows like every kit prop.
 *
 * The pass (Game.render, after the Spy's): every station's lever and blades follow its switch — at rest at its state's
 * stop; during a 'use' of it on the action clock (the throw ending as the switch flips); a pull broken off springs back.
 * The operator's left fist closes round the crossbar and follows it (two-bone arm IK through each model's BoneGuard,
 * the torso leaning in as the grip goes low), the right arm hangs, the eyes on the grip; sparks at the blades as the
 * contacts break. Deterministic: a function of the switch, the user's action clock and the interpolated sim time.
 * @module art/switch-station
 */
import * as THREE from 'three';
import { dressingMaterial, consolidate, boxUV } from './dressing.js';
import { paintedMaterial } from './kit-props.js';
import { gripPoint, palmSign, curlFingers } from './boat-crew.js';
import { crouch, turnWorld } from './door-hand.js';
import { wpos, wquat, handQuat, twoBoneIKPole } from './characters/commandos_a/ca_ik.js';
import { clipPose, mixPose } from './pose-blend.js';
import { realBody, finish } from './knife-kill.js';
import { STATION, PULL, leverRest, leverAt } from '../world/switch-station.js';

const HAS_DOM = typeof document !== 'undefined';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const ramp = (t, a, b) => smooth((t - a) / Math.max(1e-6, b - a));

/**
 * Roof disconnector (local v: the hinge at the feed's side, the jaw toward the fence's): blade length, open angle (rad,
 * the free end up), the poles' u, the insulators' height.
 */
export const BLADES = Object.freeze({ len: 0.42, open: 1.2, hinge: 0.22, jaw: -0.2, phases: [-0.17, 0.17], ins: 0.27, frame: 0.07 });
/** Crossbar grip (m along the pivot axis, centred on the lever plane) and where the fist takes it (toward the operator). */
export const GRIP_BAR = Object.freeze({ half: 0.065, r: 0.019, hand: -0.03 });

// ------------------------------------------------------------------ materials

const MATS = new Map();
function mat(key, make) {
  if (!MATS.has(key)) MATS.set(key, make());
  return MATS.get(key);
}
const M = {
  concrete: () => dressingMaterial('concrete'),
  slab: () => dressingMaterial('plinth'),
  door: () => paintedMaterial('steel', 0x56604d),
  frame: () => paintedMaterial('steel', 0x464e40),
  iron: () => dressingMaterial('castIron'),
  galv: () => dressingMaterial('galv'),
  red: () => paintedMaterial('steel', 0xa1261c),
  grip: () => mat('grip', () => new THREE.MeshStandardMaterial({ color: 0x17140f, roughness: 0.42, metalness: 0.05, name: 'station:bakelite' })),
  porcelain: () => mat('porcelain', () => new THREE.MeshStandardMaterial({ color: 0x5b3a27, roughness: 0.3, metalness: 0, name: 'station:porcelain' })),
  copper: () => mat('copper', () => new THREE.MeshStandardMaterial({ color: 0x9a6440, roughness: 0.42, metalness: 0.75, name: 'station:copper' })),
  cable: () => mat('cable', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.65, metalness: 0.05, name: 'station:cable' })),
  white: () => paintedMaterial('steel', 0xd9d4c4),
  zaun: () => mat('zaun', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.1, name: 'station:zaun-plate' });
    if (HAS_DOM) m.map = textTexture('ZAUN', 128, 40); else m.color.set(0xe3ddcc);
    return m;
  }),
  plate: () => mat('plate', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0.1, name: 'station:hv-plate' });
    if (HAS_DOM) m.map = warningTexture(); else m.color.set(0xe8e1cc);
    return m;
  }),
};

/** A white enamel plate with black stencil text. */
function textTexture(text, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#e6e0cf'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#1a1a1a'; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4);
  g.fillStyle = '#161616'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold ${Math.round(h * 0.62)}px sans-serif`; g.fillText(text, w / 2, h / 2 + 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** "Hochspannung – Lebensgefahr": cream enamel, black border and text, the red lightning arrow (DIN 40008), a few chips. */
function warningTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#ebe4cf'; g.fillRect(0, 0, 256, 192);
  g.strokeStyle = '#151515'; g.lineWidth = 9; g.strokeRect(6, 6, 244, 180);
  g.fillStyle = '#b3201a';                              // the Blitzpfeil, top to bottom-left, the head down
  g.beginPath();
  g.moveTo(150, 18); g.lineTo(104, 74); g.lineTo(132, 74); g.lineTo(96, 116); g.lineTo(108, 116); g.lineTo(84, 140);
  g.lineTo(130, 104); g.lineTo(116, 104); g.lineTo(150, 64); g.lineTo(122, 64); g.lineTo(162, 18); g.closePath(); g.fill();
  g.fillStyle = '#151515'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 25px sans-serif'; g.fillText('HOCHSPANNUNG', 128, 152);
  g.font = 'bold 20px sans-serif'; g.fillText('LEBENSGEFAHR', 128, 174);
  g.fillStyle = 'rgba(40,36,30,0.85)';                 // enamel chips (rusty dark)
  for (const [x, y, r] of [[18, 22, 4], [238, 168, 5], [30, 176, 3], [222, 26, 3], [190, 120, 2]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ geometry helpers (local frame: X = u out of the front, Y up, Z = v)

function mesh(geo, material, shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}
/** Box spanning [u0,u1] × [y0,y1] × [v0,v1], world-scale UVs. */
function box(g, material, u0, u1, y0, y1, v0, v1, tile = 1.2) {
  const geo = boxUV(new THREE.BoxGeometry(u1 - u0, y1 - y0, v1 - v0).toNonIndexed(), tile);
  const m = mesh(geo, material);
  m.position.set((u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2);
  g.add(m);
  return m;
}
/** Cylinder from a to b ([u, y, v]), radius r0 → r1. */
function rod(g, material, a, b, r0, r1 = r0, seg = 10, shadow = true) {
  const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), d = Bv.clone().sub(A), L = d.length();
  const geo = new THREE.CylinderGeometry(r1, r0, L, seg);
  const m = mesh(geo, material, shadow);
  m.position.copy(A).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.add(m);
  return m;
}
/** A brown-glazed post insulator standing at (u, y, v): steel base, three sheds, the cap with its terminal. */
function insulator(g, u, y, v) {
  const H = BLADES.ins;
  rod(g, M.galv(), [u, y, v], [u, y + 0.04, v], 0.045, 0.04, 10);
  rod(g, M.porcelain(), [u, y + 0.04, v], [u, y + H - 0.04, v], 0.032, 0.028, 10);
  for (let k = 0; k < 3; k++) {
    const sy = y + 0.07 + k * 0.055;
    rod(g, M.porcelain(), [u, sy, v], [u, sy + 0.018, v], 0.068 - k * 0.006, 0.05 - k * 0.004, 12);
  }
  rod(g, M.galv(), [u, y + H - 0.04, v], [u, y + H, v], 0.036, 0.036, 10);
}

/**
 * Build the station of layout L (world/switch-station.js stationLayout) at its world spot. @returns {{group:
 * THREE.Group, lever: THREE.Object3D, blades: THREE.Object3D[] (one group, both poles), setLever:(theta:number)=>void, theta:number,
 * grip:(out?:THREE.Vector3)=>THREE.Vector3, gripAxis:(out?:THREE.Vector3)=>THREE.Vector3}}
 */
export function buildSwitchStation(L, { name = 'switch-station' } = {}) {
  const S = STATION, d2 = S.d / 2, w2 = S.w / 2, H = S.h;
  const g = new THREE.Group();
  g.name = name;
  const stat = new THREE.Group();
  stat.name = `${name}:body`;
  g.add(stat);
  // plinth (buried 0.25 m: the ground may dip under it) and the body
  box(stat, M.slab(), -d2 - S.plinth, d2 + S.plinth, -0.25, 0.1, -w2 - S.plinth, w2 + S.plinth, 1.0);
  box(stat, M.concrete(), -d2, d2, 0.1, H, -w2, w2, 1.1);
  // roof slab with its drip edge, slightly proud at the front
  box(stat, M.slab(), -d2 - 0.08, d2 + 0.12, H, H + 0.1, -w2 - 0.08, w2 + 0.08, 1.0);
  box(stat, M.slab(), -d2 - 0.06, d2 + 0.1, H + 0.1, H + 0.13, -w2 - 0.06, w2 + 0.06, 1.0);
  // ---- the door (−v half of the front): frame, plate, hinges, handle, hasp and padlock, louvres, the HV plate
  const fu = d2;                                           // front face
  const dv0 = -w2 + 0.08, dv1 = -0.05, dy0 = 0.22, dy1 = 1.84;
  box(stat, M.frame(), fu, fu + 0.02, dy0 - 0.04, dy1 + 0.04, dv0 - 0.04, dv1 + 0.04, 0.8);
  box(stat, M.door(), fu + 0.02, fu + 0.045, dy0, dy1, dv0, dv1, 0.9);
  for (const y of [dy0 + 0.14, (dy0 + dy1) / 2, dy1 - 0.14]) rod(stat, M.iron(), [fu + 0.05, y - 0.07, dv0 - 0.01], [fu + 0.05, y + 0.07, dv0 - 0.01], 0.016, 0.016, 8);
  box(stat, M.iron(), fu + 0.045, fu + 0.07, 0.98, 1.16, dv1 - 0.075, dv1 - 0.05, 0.4);        // handle
  box(stat, M.iron(), fu + 0.045, fu + 0.06, 1.2, 1.24, dv1 - 0.1, dv1 + 0.03, 0.4);          // hasp
  box(stat, paintedMaterial('steel', 0x8a7a3a), fu + 0.06, fu + 0.085, 1.15, 1.21, dv1 - 0.03, dv1 + 0.01, 0.3); // brass padlock
  for (const [y0, n] of [[0.36, 4], [1.56, 3]]) {          // louvres
    for (let k = 0; k < n; k++) {
      const y = y0 + k * 0.05;
      const sl = box(stat, M.frame(), fu + 0.045, fu + 0.07, y, y + 0.022, dv0 + 0.12, dv1 - 0.12, 0.6);
      sl.rotation.z = 0.5;
    }
  }
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.225), M.plate());
  plate.position.set(fu + 0.047, 1.3, (dv0 + dv1) / 2);
  plate.rotation.y = Math.PI / 2;
  plate.receiveShadow = true;
  stat.add(plate);
  // enamel plate over the operating housing: what it switches ("ZAUN")
  box(stat, M.frame(), fu, fu + 0.008, 1.49, 1.59, S.house.v0 + 0.01, S.house.v1 - 0.01, 0.3);
  const np = new THREE.Mesh(new THREE.PlaneGeometry(S.house.v1 - S.house.v0 - 0.04, 0.08), M.zaun());
  np.position.set(fu + 0.009, 1.54, (S.house.v0 + S.house.v1) / 2);
  np.rotation.y = Math.PI / 2;
  np.receiveShadow = true;
  stat.add(np);
  // ---- the operating housing, its EIN / AUS quadrant and the lever boss
  const Hs = S.house, P = S.pivot;
  box(stat, M.iron(), fu, fu + Hs.out, Hs.y0, Hs.y1, Hs.v0, Hs.v1, 0.5);
  box(stat, M.iron(), fu, fu + Hs.out + 0.015, Hs.y1, Hs.y1 + 0.03, Hs.v0 - 0.015, Hs.v1 + 0.015, 0.5);  // lid
  for (const v of [Hs.v0 + 0.06, Hs.v1 - 0.06]) box(stat, M.iron(), fu + Hs.out, fu + Hs.out + 0.012, Hs.y0 + 0.04, Hs.y1 - 0.04, v - 0.008, v + 0.008, 0.3); // ribs
  box(stat, M.frame(), P.u - 0.15, P.u + 0.15, P.y - 0.17, P.y + 0.17, Hs.v1, Hs.v1 + 0.008, 0.5);  // quadrant plate
  const tab = (theta, material) => {                       // EIN (white) at the on stop, AUS (red) at the off stop
    const r = 0.13, u = P.u + Math.sin(theta) * r, y = P.y + Math.cos(theta) * r;
    box(stat, material, u - 0.025, u + 0.025, y - 0.025, y + 0.025, Hs.v1 + 0.008, Hs.v1 + 0.012, 0.2);
  };
  tab(S.on, M.white()); tab(S.off, M.red());
  rod(stat, M.iron(), [P.u, P.y, Hs.v1], [P.u, P.y, P.v - 0.02], 0.045, 0.045, 14);   // boss
  // ---- roof disconnector: a galvanised frame, the hinge and jaw post insulators of each pole, the operating shaft
  // across the hinges with its crank over the front edge, the rod down to the housing
  const R = H + 0.13, B = BLADES, ry = R + B.frame * 0.5, top = ry + B.ins;
  for (const u of B.phases) box(stat, M.galv(), u - 0.03, u + 0.03, R, ry, B.jaw - 0.07, B.hinge + 0.07, 0.6);
  for (const v of [B.jaw, B.hinge]) box(stat, M.galv(), B.phases[0] - 0.03, B.phases[1] + 0.03, R, ry, v - 0.025, v + 0.025, 0.6);
  for (const u of B.phases) { insulator(stat, u, ry, B.hinge); insulator(stat, u, ry, B.jaw); }
  for (const u of B.phases) for (const du of [-0.022, 0.022]) box(stat, M.copper(), u + du - 0.004, u + du + 0.004, top, top + 0.06, B.jaw - 0.03, B.jaw + 0.04, 0.2); // jaws
  const shaftY = ry + 0.1, sv = B.hinge + 0.075, crankU = fu + 0.17;
  rod(stat, M.galv(), [B.phases[0] - 0.05, shaftY, sv], [crankU, shaftY, sv], 0.012, 0.012, 8);                 // shaft
  for (const u of B.phases) rod(stat, M.galv(), [u, shaftY, sv], [u, top + 0.03, B.hinge + 0.01], 0.008, 0.008, 6); // its arms to the blades
  rod(stat, M.galv(), [crankU, shaftY, sv], [crankU, shaftY - 0.09, sv + 0.06], 0.013, 0.013, 8);              // crank
  rod(stat, M.galv(), [crankU, Hs.y1 + 0.03, sv + 0.06], [crankU, shaftY - 0.09, sv + 0.06], 0.011, 0.011, 8);  // operating rod
  // ---- cables and conduits: the feed up the +v side to the hinges, the fence line from the jaws down the −v side and
  // away under the ground (toward the fence)
  const conduit = (u, side) => {
    const v = side * (w2 + 0.035);
    rod(stat, M.galv(), [u, 0.05, v], [u, H - 0.05, v], 0.022, 0.022, 10);
    rod(stat, M.galv(), [u, H - 0.05, v], [u, H + 0.03, v], 0.028, 0.026, 10);                                     // weather head
    rod(stat, M.galv(), [u, 0.05, v], [u, -0.25, v + side * 0.28], 0.022, 0.022, 10);                               // into the ground
    for (const y of [0.55, 1.3]) box(stat, M.galv(), u - 0.03, u + 0.03, y, y + 0.025, side > 0 ? w2 : v - 0.03, side > 0 ? v + 0.03 : -w2, 0.3); // saddles
  };
  const lead = (a, b, sag = 0.05) => {                     // a cable drooping from a to b
    const pts = [];
    for (let k = 0; k <= 6; k++) { const t = k / 6; pts.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * Math.sin(Math.PI * t), a[2] + (b[2] - a[2]) * t)); }
    stat.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.01, 6, false), M.cable()));
  };
  for (const u of B.phases) {
    conduit(u, 1); conduit(u, -1);
    lead([u, top + 0.01, B.hinge + 0.03], [u, H + 0.03, w2 + 0.035], 0.04);
    lead([u, top + 0.01, B.jaw - 0.03], [u, H + 0.03, -w2 - 0.035], 0.04);
  }
  consolidate(stat);
  // ---- moving parts: the lever (red arm, black crossbar grip) and the two knife blades
  const lever = new THREE.Group();
  lever.name = `${name}:lever`;
  lever.position.set(P.u, P.y, P.v);
  rod(lever, M.iron(), [0, 0, -0.035], [0, 0, 0.035], 0.03, 0.03, 12);                       // hub
  box(lever, M.red(), -0.016, 0.016, -0.02, S.arm, -0.012, 0.012, 0.3);
  rod(lever, M.red(), [0, S.arm - 0.01, 0], [0, S.arm + 0.015, 0], 0.022, 0.022, 10);           // the arm's end boss
  rod(lever, M.grip(), [0, S.arm + 0.01, -GRIP_BAR.half], [0, S.arm + 0.01, GRIP_BAR.half], GRIP_BAR.r, GRIP_BAR.r, 12);
  for (const s of [-1, 1]) {
    const k = new THREE.Mesh(new THREE.SphereGeometry(GRIP_BAR.r * 1.15, 10, 8), M.grip());
    k.position.set(0, S.arm + 0.01, s * GRIP_BAR.half); k.castShadow = true; lever.add(k);
  }
  g.add(lever);
  // the two blades turn together on the operating shaft's line (along u, through both hinges): one group
  const blade = new THREE.Group();
  blade.name = `${name}:blades`;
  blade.position.set(0, top + 0.035, B.hinge);                                                // hinged at the feed end
  for (const u of B.phases) {
    for (const du of [-0.012, 0.012]) box(blade, M.copper(), u + du - 0.004, u + du + 0.004, -0.018, 0.018, -B.len, 0.02, 0.2);
    rod(blade, M.galv(), [u - 0.03, 0, 0], [u + 0.03, 0, 0], 0.016, 0.016, 8);                // hinge pin
    rod(blade, M.porcelain(), [u, 0, -B.len * 0.55], [u, 0.11, -B.len * 0.55], 0.013, 0.013, 8); // the hook eye (porcelain rod)
  }
  consolidate(blade);
  consolidate(lever);
  g.add(blade);
  const blades = [blade];
  g.position.set(L.x, 0, L.z);
  g.rotation.y = -L.rot;
  const vis = {
    group: g, lever, blades, theta: NaN,
    /** Lever angle (rad from up toward the front); the blades open with it. */
    setLever(theta) {
      if (theta === vis.theta) return;
      vis.theta = theta;
      lever.rotation.z = -theta;
      const k = clamp((theta - S.on) / (S.off - S.on), 0, 1);
      for (const b of blades) b.rotation.x = B.open * smooth(k);   // the free (jaw) end rises
      lever.updateMatrixWorld(true);
      for (const b of blades) b.updateMatrixWorld(true);
    },
    /** World point on the crossbar where the operator's fist goes. */
    grip(out = new THREE.Vector3()) { lever.updateWorldMatrix(true, false); return out.set(0, S.arm + 0.01, GRIP_BAR.hand).applyMatrix4(lever.matrixWorld); },
    /** World direction of the crossbar (the pivot axis, +v). */
    gripAxis(out = new THREE.Vector3()) { lever.updateWorldMatrix(true, false); return out.set(0, 0, 1).transformDirection(lever.matrixWorld); },
    /** World direction of the lever arm (pivot → grip). */
    armDir(out = new THREE.Vector3()) { lever.updateWorldMatrix(true, false); return out.set(0, 1, 0).transformDirection(lever.matrixWorld); },
    /** World points at the blades' free ends (sparks). */
    jaws() { blade.updateWorldMatrix(true, false); return B.phases.map((u) => new THREE.Vector3(u, 0, -B.len).applyMatrix4(blade.matrixWorld)); },
  };
  vis.setLever(S.on);
  return vis;
}

// ------------------------------------------------------------------ the pass

/**
 * Pose every switch station's lever (and its operator's hand) for this frame. world.switchStations: [{sw, L, vis}]
 * (world/map-builder.js). @param {object} world @param {number} [alpha] sim interpolation @param {number} [simDt]
 */
export function switchStationsFrame(world, alpha = 1, simDt = 1 / 60) {
  const list = world?.switchStations;
  if (!list?.length) return;
  const now = world.time - (1 - clamp(alpha, 0, 1)) * simDt;
  for (const S of list) {
    if (!S.vis) continue;
    try { stationFrame(world, S, now, alpha, simDt); } catch (e) { console.warn('[switch-station]', e?.stack || e); }
  }
}

/** The commando whose 'use' action is on this switch now, or null. */
function userOf(world, sw) {
  for (const c of world.commandos || []) if (c.currentActionId === 'use' && c.currentActionTarget === sw && c.currentAction && c.alive !== false) return c;
  return null;
}

function stationFrame(world, S, now, alpha, simDt) {
  const sw = S.sw, st = (S.st ||= {}), vis = S.vis;
  const user = userOf(world, sw);
  let theta = leverRest(sw.on), w = 0, tAct = 0;
  if (user) {
    const task = user.currentAction;
    if (st.task !== task) Object.assign(st, { task, unit: user, on0: sw.on, end: null, sparked: false, dur: sw.activationTime || 1 });
    tAct = Math.max(0, (task.t ?? 0) - (1 - clamp(alpha, 0, 1)) * simDt - (task.leverDelay || 0));
    theta = leverAt(st.on0, tAct, st.dur);
    w = ramp(tAct, PULL.reach[0], PULL.reach[1] * 0.75 * st.dur);
    st.last = theta;
  } else if (st.task) {
    if (st.end == null) { st.end = now; st.from = st.last ?? theta; st.done = sw.on !== st.on0; }
    const e = now - st.end;
    // done: the lever at its new stop; broken off: back to its stop
    theta = st.done ? leverRest(sw.on) : st.from + (leverRest(sw.on) - st.from) * smooth(e / PULL.back);
    const u = st.unit, walking = !!(u?.path || u?.isMoving);
    if (walking && st.walkAt == null) st.walkAt = e;
    w = (1 - ramp(e, 0, PULL.out)) * (st.walkAt != null ? 1 - ramp(e, st.walkAt, st.walkAt + 0.12) : 1);
    if (e > Math.max(PULL.out, PULL.back) + 0.05) { Object.assign(st, { task: null, unit: null, end: null, walkAt: null }); w = 0; }
  }
  vis.setLever(theta);
  // sparks: the contacts break (opening) / make (closing) under load
  if (st.task && !st.sparked) {
    const k = Math.abs(theta - leverRest(st.on0)) / Math.abs(STATION.off - STATION.on);
    if (st.on0 ? k > 0.12 : k > 0.9) {
      st.sparked = true;
      if (world.fx?.spawn) for (const p of vis.jaws()) world.fx.spawn('sparks', p.x, p.z, { y: p.y });
    }
  }
  const u = st.unit;
  if (u && w > 1e-3 && (u.stance ?? 'stand') === 'stand') handOnLever(u, vis, w, st);
}

/** The operator's left fist on the crossbar (arm IK), leaning in as far as the grip asks, the eyes on it. */
function handOnLever(u, vis, w, st) {
  const m = u.model;
  if (!realBody(m)) return;
  const B = m.real.inner.bones, root = m.root, guard = m._guard;
  for (const k of Object.keys(B)) if (/^(spine_0[123]|neck_01|Head|clavicle_|upperarm_|lowerarm_|hand_|index_|middle_|ring_|pinky_|thumb_|pelvis|thigh_|calf_|foot_)/.test(k)) guard?.touch(B[k]);
  root.updateWorldMatrix(true, true);
  // the hands off the use clip: his idle arms, the lever arm then laid on the grip
  const idle = clipPose(m, 'idle', 0);
  if (idle) mixPose(m, idle, w, guard);
  root.updateWorldMatrix(true, true);
  const q = new THREE.Quaternion();
  root.getWorldQuaternion(q);
  const F = { f: new THREE.Vector3(0, 0, 1).applyQuaternion(q).setY(0).normalize(), l: new THREE.Vector3(1, 0, 0).applyQuaternion(q).setY(0).normalize(), u: new THREE.Vector3(0, 1, 0) };
  const g = vis.grip(), a = vis.gripAxis();
  // an overhand grip: the palm toward the kiosk with the lever up (the fingers over the top of the crossbar), turning
  // down onto it as it comes down (the fingers forward over its far side), whichever way it is thrown
  const k = clamp((vis.theta - STATION.on) / (STATION.off - STATION.on), 0, 1), phi = 0.12 + 1.15 * smooth(k);
  const down = new THREE.Vector3(0, -1, 0);
  const pn = F.f.clone().multiplyScalar(Math.cos(phi)).addScaledVector(down, Math.sin(phi)).normalize();
  const fdHint = F.u.clone().multiplyScalar(Math.cos(phi)).addScaledVector(F.f, Math.sin(phi));
  const sh = B.upperarm_l.getWorldPosition(new THREE.Vector3());
  const pole = sh.clone().addScaledVector(F.l, 0.45).addScaledVector(F.u, -0.55).addScaledVector(F.f, -0.15);
  // the grip low in front of him (the lever coming down): lean in, then bend the knees, as far as the stretched arm
  // falls short of it (× the overlay weight); a grip at or over his shoulder is reached standing straight
  const reach = armLen(B) * 0.9, shoulder = () => B.upperarm_l.getWorldPosition(new THREE.Vector3());
  const short = () => shoulder().distanceTo(g) - reach;
  let lean = 0, drop = 0;
  if (g.y < sh.y) {
    for (let it = 0; it < 4 && short() > 0.004 && lean < 0.45 * w; it++) {
      const hgt = Math.max(0.3, shoulder().y - B.spine_01.getWorldPosition(new THREE.Vector3()).y);
      const ang = Math.min(0.45 * w - lean, Math.asin(clamp((short() * 1.2 + 0.004) / hgt, 0, 1)));
      if (ang <= 1e-4) break;
      bend(B, F, ang, g); lean += ang;
    }
    for (let it = 0; it < 2 && g.y < sh.y - 0.3 && short() > 0.004 && drop < 0.15 * w; it++) {
      const dd = Math.min(0.15 * w - drop, short() + 0.005);
      crouch(B, dd, F.f, guard); drop += dd;
    }
  }
  st.lean = lean; st.drop = drop;
  st.err = fistOn(B, 'l', g, a, pn, fdHint, pole, w);
  // the eyes on the grip
  const head = B.Head.getWorldPosition(new THREE.Vector3()), dv = g.clone().sub(head);
  const yaw = Math.atan2(dv.dot(F.l), dv.dot(F.f)), pitch = Math.atan2(-dv.y, Math.hypot(dv.dot(F.l), dv.dot(F.f)));
  const y = clamp(yaw, -0.9, 0.9) * w * 0.7, p = clamp(pitch, -0.5, 0.8) * w * 0.7;
  turnWorld(B.neck_01, F.u, 0.4 * y); turnWorld(B.Head, F.u, 0.6 * y);
  turnWorld(B.neck_01, F.l, 0.4 * p); turnWorld(B.Head, F.l, 0.6 * p);
  finish(m);
}

/**
 * Fist `s` round a bar at world point g along `a`, the palm facing `pn` (made ⟂ a), the fingers across the bar toward
 * `fdHint`; elbow toward `pole`; w < 1 blends from the pose under it (art/boat-crew.js gripBar, the fingers' side
 * given). @returns {number} grip error (m)
 */
function fistOn(B, s, g, a, pn, fdHint, pole, w = 1) {
  const hand = B['hand_' + s], ps = palmSign(B)[s];
  const n = pn.clone().addScaledVector(a, -pn.dot(a)).normalize();
  const fd = new THREE.Vector3().crossVectors(n, a).normalize();
  if (fd.dot(fdHint) < 0) fd.negate();
  let q = handQuat(B, s, ps, fd, n);
  if (w < 0.999) q = wquat(hand).slerp(q, w);
  const tgt = w < 0.999 ? gripPoint(B, s).lerp(g, w) : g.clone();
  for (let i = 0; i < 2; i++) {
    const off = gripPoint(B, s).sub(wpos(hand)).applyQuaternion(wquat(hand).invert()).applyQuaternion(q);
    twoBoneIKPole(B['upperarm_' + s], B['lowerarm_' + s], hand, tgt.clone().sub(off), pole, q);
  }
  curlFingers(B, s, w, tgt, a);
  return gripPoint(B, s).distanceTo(tgt);
}

/** Upper arm + forearm + hand to the grip point (m), left arm. */
function armLen(B) {
  const a = B.upperarm_l.getWorldPosition(new THREE.Vector3()), b = B.lowerarm_l.getWorldPosition(new THREE.Vector3()), c = B.hand_l.getWorldPosition(new THREE.Vector3());
  return a.distanceTo(b) + b.distanceTo(c) + c.distanceTo(gripPoint(B, 'l'));
}

/** Bend the spine forward by `ang` (rad) toward world point g. */
function bend(B, F, ang, g) {
  const d = g.clone().sub(B.pelvis.getWorldPosition(new THREE.Vector3())).setY(0);
  if (d.lengthSq() < 1e-6) d.copy(F.f);
  d.normalize();
  const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), d).normalize();
  for (const [n, k] of [['spine_01', 0.4], ['spine_02', 0.35], ['spine_03', 0.25]]) turnWorld(B[n], axis, ang * k);
  turnWorld(B.neck_01, axis, -ang * 0.4);
}

/**
 * Measurements for tests and tools: the lever angle, the grip and the blades' tips (world), and — while a commando
 * works it — his left fist's grip point and its distance to the crossbar. @returns {object|null}
 */
export function stationMetrics(world, id) {
  const S = (world?.switchStations || []).find((s) => (s.sw.tag ?? s.sw.id) === id || s.sw === id);
  if (!S?.vis) return null;
  const g = S.vis.grip(), u = S.st?.unit, B = u?.model?.real?.inner?.bones;
  const fist = B?.hand_l ? gripPoint(B, 'l') : null;
  return {
    theta: S.vis.theta, on: S.sw.on, grip: g.toArray(), jaws: S.vis.jaws().map((p) => p.toArray()),
    unit: u?.tag ?? u?.id ?? null, fist: fist?.toArray() ?? null, fistToGrip: fist ? fist.distanceTo(g) : null,
    lean: S.st?.lean ?? 0, drop: S.st?.drop ?? 0, err: S.st?.err ?? null,
  };
}
