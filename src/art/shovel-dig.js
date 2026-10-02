/**
 * The Green Beret's shovel, drawn (§3.4 shovel; visual only — the sim never reads any of it). Driven per rendered
 * frame from `unit.dig` (abilities/greenberet.js: phase 'dig' | 'buried' | 'rise' | 'out' | 'abort', t0, dur, x, z,
 * surface, heading) by `digFrame(unit, dt)` (Commando.renderUpdate):
 *
 *  - the man: a procedural overlay on his skeleton after the mixer (UnitModel `overlay` hook, BoneGuard-safe like the
 *    transport contact poses): from the idle pose, the spine bends and turns, the pelvis drops on planted feet
 *    (two-bone leg IK), the right hand holds the D-grip and the left hand the shaft (two-bone arm IK). DIG (2.0 s):
 *    from his idle stance, the shovel shows on his pack, he takes it and swings it down in front of him, three dig
 *    cycles (thrust the blade in, lever, lift, throw the spoil to his left), then he crouches and sinks into the
 *    hole. RISE (1.0 s + a 0.35 s tail in the 'out' phase): he pushes himself up out of the mound on the shovel and
 *    the rim, brushes the snow off, swings the shovel over his shoulder onto his pack, his arms come down and the
 *    shovel fades on his back.
 *  - the dig site (a group in the scene at the hole): nothing before the blade goes in, then the hole opening and
 *    widening, the spoil heap growing from nothing with each throw that lands (and
 *    covering him as he sinks: the mound he lies under), clods flying with each throw (+ a small 'dust_kick' spoil
 *    puff of the surface where they land), the mound bursting and collapsing as he rises, the disturbed patch fading out.
 *  - snow or sand colours from `dig.surface`.
 *
 * Everything is a pure function of the phase time (sim time since `dig.t0`, smoothed by the frame dt), so stepping
 * the game deterministically gives the same frames. Cost: a few IK solves per frame while he digs, one small group of
 * meshes per dig site (12 instanced clods), nothing once the patch has faded.
 * @module art/shovel-dig
 */
import * as THREE from 'three';
import { twoBoneIKPole, wpos } from './characters/commandos_a/ca_ik.js';
import { clipPose, capturePose, mixPose } from './pose-blend.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const ramp = (t, a, b) => smooth((t - a) / Math.max(1e-6, b - a));
const lerp = (a, b, k) => a + (b - a) * k;

/** Dig timeline (s, of the 2.0 s dig; scaled to dig.dur): reach for the shovel on the pack and swing it down, three cycles, sink. */
export const DIG = Object.freeze({ draw: 0.3, cycles: 3, sink: 1.5 });
/**
 * Rise timeline (fractions of the 1.0 s rise): push up out of the hole, brush off, stow the shovel (on the pack by
 * `stow`), then his arms come back to his idle pose over `stow`..`end` and the shovel fades on his back (by `faded`);
 * last, the idle base hands over to the mixer's own pose (by `gone`, once its cross-fade out of the action clip is
 * over). The tail (r > 1) runs in the sim's 'out' phase, so the rise never snaps at its last frame.
 */
export const RISE = Object.freeze({ push: 0.5, brush: 0.72, stow: 0.9, end: 1.1, faded: 1.25, gone: 1.35 });
/** Phase of a dig cycle at which the spoil leaves the blade, and the clods' flight time (s). */
export const THROW_U = 0.8;
const FLIGHT = 0.32;
/** Spoil heap (site-local, x = his left, z = his front) and the hole. */
const HEAP = new THREE.Vector3(0.78, 0, 0.32);
const HOLE = new THREE.Vector3(0, 0, 0.28);
const SINK = 1.7;          // m below the ground at the end of the dig (out of sight under the mound)
const SHAFT = 1.02;        // D-grip → blade tip, m
const LEFT_HAND = 0.46;    // left hand down the shaft from the grip, m
const COLORS = {
  snow: { top: 0xf1f4f8, side: 0xc4ceda, dark: 0x8e9cad, hole: 0x4f5c6c, clod: 0xe3e9f0 },
  sand: { top: 0xf6d394, side: 0xe9b870, dark: 0xc49250, hole: 0x7a5228, clod: 0xd8b070, crease: 0.2 }, // warm: reads as the desert sand, not grey
};

// ------------------------------------------------------------------ pose keys (root-local: x left, y up, z front)

/**
 * Dig cycle keys: G = right hand on the D-grip, T = blade tip; bend / twist (rad, forward / to his left), drop (m,
 * pelvis), roll (rad, blade turned over to tip the spoil out).
 */
const CYCLE = [
  { u: 0.00, G: [-0.20, 1.06, 0.22], T: [-0.04, 0.12, 0.78], bend: 0.30, twist: 0.00, drop: 0.08, roll: 0 },   // ready, blade over the spot
  { u: 0.22, G: [-0.16, 0.86, 0.38], T: [-0.03, -0.16, 0.72], bend: 0.46, twist: -0.05, drop: 0.14, roll: 0 },  // thrust: blade into the ground
  { u: 0.42, G: [-0.22, 0.78, 0.02], T: [-0.03, -0.08, 0.64], bend: 0.52, twist: -0.08, drop: 0.18, roll: 0 },  // lever: handle pulled back
  { u: 0.62, G: [-0.16, 0.98, 0.14], T: [0.08, 0.34, 0.70], bend: 0.34, twist: 0.12, drop: 0.12, roll: 0.1 },   // lift the load
  { u: 0.80, G: [-0.04, 1.10, 0.16], T: [0.62, 0.56, 0.46], bend: 0.18, twist: 0.55, drop: 0.06, roll: 1.9 },   // throw to his left
];
/** Shovel coming off the pack (start of the dig): grip behind the right shoulder, blade up behind his head. */
const DRAW = { G: [-0.22, 1.55, -0.12], T: [-0.10, 2.35, -0.35], bend: 0.05, twist: 0, drop: 0, roll: 0 };
/** The swing from the pack to the ground passes out in front of him (Bezier control: the blade never crosses his legs). */
const SWING = { G: [-0.34, 1.32, 0.22], T: [-0.40, 1.25, 1.25], bend: 0.12, twist: -0.05, drop: 0.02, roll: 0 };
/** Stowing after the rise: the blade swings forward and up before going over his shoulder (Bezier control). */
const STOW = { G: [-0.30, 1.30, 0.22], T: [-0.36, 1.65, 1.0], bend: 0.06, twist: -0.03, drop: 0.02, roll: 0 };
/** The shovel slung on his pack (no hand on it): grip at the right shoulder blade, blade up behind his head. */
export const PACK = Object.freeze({ G: [-0.16, 1.14, -0.2], T: [0.05, 2.05, -0.3] });
/** Sinking: shovel held across the chest, deep crouch. */
const HOLD = { G: [-0.22, 1.12, 0.30], T: [0.42, 0.55, 0.40], bend: 0.35, twist: 0.1, drop: 0.55, roll: 0 };

const v3 = (a) => (a.isVector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]));
function mixKey(a, b, k) {
  return { G: v3(a.G).lerp(v3(b.G), k), T: v3(a.T).lerp(v3(b.T), k), bend: lerp(a.bend, b.bend, k), twist: lerp(a.twist, b.twist, k),
    drop: lerp(a.drop, b.drop, k), roll: lerp(a.roll, b.roll, k) };
}
/** Quadratic Bezier between keys a → c through control b. */
const bezKey = (a, b, c, k) => mixKey(mixKey(a, b, k), mixKey(b, c, k), k);
/** Pose of a dig cycle at phase u (0..1, wraps): keys eased in and out (a beat on each). */
export function cycleKey(u) {
  u = ((u % 1) + 1) % 1;
  let i = CYCLE.length - 1;
  while (i > 0 && CYCLE[i].u > u) i--;
  const a = CYCLE[i], b = CYCLE[(i + 1) % CYCLE.length];
  const ub = i + 1 < CYCLE.length ? b.u : 1;
  return mixKey(a, b, smooth((u - a.u) / (ub - a.u)));
}

/**
 * Overlay state of the man for a dig / rise (/ the rise's 'out' tail) phase time. @returns {null | {w, G, T, bend,
 * twist, drop, roll, sink, show, alpha, slung, base, hands?: {r?: Vector3, l?: Vector3}, brush?: number}} (G / T /
 * hands root-local; sink m below the ground; w = weight of the dig pose over his idle pose, base = weight of that
 * idle-based pose over the mixer's (the action clip never shows); alpha = shovel opacity, slung = 0 in his hands … 1
 * on his pack)
 */
export function manPose(phase, t, dur) {
  if (phase === 'dig') {
    const s = dur / 2, draw = DIG.draw * s, sink = DIG.sink * s, reach = 0.1 * s;
    // from his idle stance (not the action clip's first frame): the right hand reaches back over his shoulder while
    // the shovel shows on the pack; he takes it and swings it down in front of him to the first dig
    const w = ramp(t, 0, reach);
    let p;
    if (t < reach) p = mixKey(DRAW, DRAW, 0);
    else if (t < draw) p = bezKey(DRAW, SWING, cycleKey(0), smooth((t - reach) / (draw - reach)));
    else if (t < sink) p = cycleKey(((t - draw) / (sink - draw)) * DIG.cycles);
    else p = mixKey(cycleKey(0), HOLD, ramp(t, sink, sink + 0.18 * s));
    const sk = t > sink ? Math.pow(clamp((t - sink - 0.08 * s) / (dur - sink - 0.08 * s), 0, 1), 1.6) * SINK : 0;
    const alpha = ramp(t, 0, 0.06 * s), slung = 1 - ramp(t, 0.05 * s, 0.13 * s);
    return { w, ...p, sink: sk, show: alpha > 0.01, alpha, slung, base: 1 };
  }
  if (phase === 'out') { // the tail of the rise: arms back, shovel fading on his pack
    const r = 1 + t / (dur || 1);
    return r < RISE.gone ? manPose('rise', r * (dur || 1), dur || 1) : null;
  }
  if (phase === 'rise') {
    const r = clamp(t / dur, 0, RISE.gone);
    const up = 1 - Math.pow(1 - ramp(r, 0.02, RISE.push), 2); // fast out of the hole, easing at the top
    const sink = (1 - up) * 1.35;
    // push: the shovel planted at his right like a staff, the left hand on the rim; brush: the left hand sweeps the
    // right arm / chest; stow: the shovel swung up over the right shoulder onto the pack
    const plant = { G: [-0.30, 0.95 + sink * 0.0, 0.32], T: [-0.36, -0.05, 0.42], bend: 0.25, twist: 0, drop: 0.45, roll: 0 };
    const stand = { G: [-0.24, 1.0, 0.26], T: [-0.34, 0.02, 0.40], bend: 0.08, twist: -0.05, drop: 0.04, roll: 0 };
    let p;
    if (r < RISE.push) p = mixKey(plant, stand, ramp(r, 0.1, RISE.push));
    else if (r < RISE.brush) p = mixKey(stand, stand, 0);
    else p = bezKey(stand, STOW, DRAW, ramp(r, RISE.brush + 0.04, RISE.stow)); // swung forward, up and over the shoulder
    // hand targets on the rim / the brush-off sweep, root-local (the rim is at ground level: + sink)
    const hands = {};
    if (r < RISE.push + 0.06) hands.l = new THREE.Vector3(0.42, sink - 0.02, 0.18).lerp(new THREE.Vector3(0.3, 0.75, 0.2), ramp(r, RISE.push - 0.12, RISE.push + 0.06));
    else if (r < RISE.brush + 0.08) {
      const b = (r - RISE.push - 0.06) / (RISE.brush + 0.02 - RISE.push - 0.06);
      const sweep = 0.5 + 0.5 * Math.sin(b * Math.PI * 3); // three quick strokes
      hands.l = new THREE.Vector3(lerp(-0.05, -0.2, sweep), lerp(1.35, 1.05, sweep), 0.2);
    }
    // on the pack: the hand lets go, his arms blend back to his own pose (~0.2 s), the shovel fades on his back
    const w = 1 - ramp(r, RISE.stow + 0.02, RISE.end), alpha = 1 - ramp(r, 1.0, RISE.faded), slung = ramp(r, RISE.stow - 0.03, RISE.stow + 0.05);
    const base = 1 - ramp(r, RISE.faded - 0.1, RISE.gone);
    return { w, ...p, sink, show: alpha > 0.01, alpha, slung, base, hands, brush: r };
  }
  return null;
}

// ------------------------------------------------------------------ shovel prop

let SHOVEL_GEO = null;
/** Low-poly long-handled shovel: origin at the D-grip, shaft down −Y, blade face +Z, tip at y = −SHAFT. */
export function makeShovel() {
  if (!SHOVEL_GEO) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x7b5a35, roughness: 0.85 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x4b4f3c, roughness: 0.55, metalness: 0.45, side: THREE.DoubleSide });
    const shaft = new THREE.CylinderGeometry(0.019, 0.021, SHAFT - 0.26, 6, 1);
    shaft.translate(0, -(SHAFT - 0.26) / 2 - 0.03, 0);
    const grip = new THREE.TorusGeometry(0.05, 0.013, 4, 8, Math.PI);
    grip.rotateZ(Math.PI); grip.translate(0, 0.02, 0);
    const bar = new THREE.CylinderGeometry(0.012, 0.012, 0.1, 5); bar.rotateZ(Math.PI / 2); bar.translate(0, -0.03, 0);
    // blade: a dished spade (shoulders, rounded point), slightly cupped toward +Z
    const sh = new THREE.Shape();
    sh.moveTo(-0.115, 0); sh.lineTo(0.115, 0); sh.lineTo(0.12, -0.2); sh.quadraticCurveTo(0.09, -0.27, 0, -0.29);
    sh.quadraticCurveTo(-0.09, -0.27, -0.12, -0.2); sh.lineTo(-0.115, 0);
    const blade = new THREE.ShapeGeometry(sh, 3);
    const pos = blade.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); pos.setZ(i, 0.06 * (x / 0.12) * (x / 0.12)); }
    blade.computeVertexNormals();
    blade.translate(0, -(SHAFT - 0.29), 0);
    const socket = new THREE.CylinderGeometry(0.024, 0.03, 0.09, 6); socket.translate(0, -(SHAFT - 0.29) + 0.04, 0);
    SHOVEL_GEO = { wood, steel, shaft, grip, bar, blade, socket };
  }
  const G = SHOVEL_GEO;
  const g = new THREE.Group(); g.name = 'prop_shovel';
  const wood = G.wood.clone(), steel = G.steel.clone(); // own materials: this shovel fades on / off his pack
  for (const [geo, mat] of [[G.shaft, wood], [G.grip, wood], [G.bar, wood], [G.blade, steel], [G.socket, steel]]) {
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; g.add(m); // x-rayed with him (under a roof he still holds a shovel)
  }
  return g;
}

// ------------------------------------------------------------------ skeleton overlay

const _f = new THREE.Vector3(), _l = new THREE.Vector3(), _u = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const SPINE = [['spine_01', 0.4], ['spine_02', 0.35], ['spine_03', 0.25]];

/** Rotate bone b by `angle` about the WORLD axis `axis` (keeps its children's local frames). */
function turnWorld(b, axis, angle) {
  if (!b || Math.abs(angle) < 1e-5) return;
  b.parent.getWorldQuaternion(_q2);
  const local = _a.copy(axis).applyQuaternion(_q2.invert()).normalize();
  _q.setFromAxisAngle(local, angle);
  b.quaternion.premultiply(_q);
  b.updateMatrixWorld(true);
}

/**
 * Write the dig / rise pose on the model's bones and place the shovel. @returns {boolean} pose changed
 * @param {import('./unit-model.js').UnitModel} m
 */
export function applyDigPose(m, P, shovel, guard) {
  const B = m.real?.inner?.bones;
  if (!B || !B.pelvis || !B.hand_r || !B.hand_l) return false;
  // the body group (sunk below the root while he goes into / comes out of the hole) is the frame of the keys
  const root = m._body?.() || m.root;
  m.root.updateMatrixWorld(true);
  const base = P.base ?? 1, w = P.w ?? 1;
  const pre = base < 0.999 ? capturePose(m) : null; // the mixer's pose (his walk / idle after the rise)
  const idle = clipPose(m, 'idle', 0);
  if (idle) mixPose(m, idle, 1, guard);
  for (const k in B) guard?.touch(B[k]);
  const still = w < 0.999 ? capturePose(m) : null;  // idle, before the dig pose
  m.root.updateMatrixWorld(true);
  root.getWorldQuaternion(_q);
  _f.set(0, 0, 1).applyQuaternion(_q); _l.set(1, 0, 0).applyQuaternion(_q); _u.set(0, 1, 0).applyQuaternion(_q);
  const local = (v) => root.localToWorld(v.clone());

  // pelvis drop on planted feet
  const feet = ['l', 'r'].map((s) => ({ s, p: wpos(B['foot_' + s]), q: B['foot_' + s].getWorldQuaternion(new THREE.Quaternion()) }));
  if (P.drop > 1e-3) {
    const pel = B.pelvis, par = pel.parent;
    const wp = wpos(pel).addScaledVector(_u, -P.drop).addScaledVector(_f, -P.drop * 0.25);
    pel.position.copy(par.worldToLocal(wp));
    pel.updateMatrixWorld(true);
    for (const { s, p, q } of feet) {
      const th = B['thigh_' + s], ca = B['calf_' + s], fo = B['foot_' + s];
      if (!th || !ca || !fo) continue;
      const pole = wpos(ca).addScaledVector(_f, 0.6).addScaledVector(_l, s === 'l' ? 0.15 : -0.15);
      twoBoneIKPole(th, ca, fo, p, pole, q);
    }
  }
  // spine: bend forward (about his right-hand axis) and turn toward the throw
  const bendAxis = _b.copy(_l).negate(); // forward bend = rotation about −left (right-hand rule: +Z toward −Y)
  for (const [n, k] of SPINE) {
    const b = B[n]; if (!b) continue;
    turnWorld(b, bendAxis, -P.bend * k);
    turnWorld(b, _u, P.twist * k);
  }
  if (B.neck_01) turnWorld(B.neck_01, bendAxis, -0.25 * P.bend);

  // shovel: the right hand takes the D-grip as near as the arm reaches, the shaft aims at the blade target
  const G = local(P.G), T = local(P.T);
  const shR = wpos(B.upperarm_r);
  twoBoneIKPole(B.upperarm_r, B.lowerarm_r, B.hand_r, G, shR.clone().addScaledVector(_l, -0.5).addScaledVector(_u, -0.6).addScaledVector(_f, -0.2));
  const palm = wpos(B.hand_r).lerp(wpos(B.middle_01_r || B.hand_r), 0.5);
  const dir = T.clone().sub(palm).normalize();
  if (shovel) {
    shovel.visible = !!P.show;
    // shovel frame: −Y along the shaft (grip → tip), +Z (blade face) toward his front / up, rolled for the throw;
    // in his hands (grip in the palm) or slung on his pack (PACK), blended by P.slung
    const frame = (from, d, roll, out) => {
      const y = d.clone().negate();
      const zHint = _a.copy(_f).addScaledVector(_u, 0.4).normalize();
      let z = zHint.clone().addScaledVector(y, -zHint.dot(y)).normalize();
      if (roll) z.applyAxisAngle(y, roll);
      const x = new THREE.Vector3().crossVectors(y, z).normalize();
      z = new THREE.Vector3().crossVectors(x, y).normalize();
      return out.makeBasis(x, y, z).setPosition(from);
    };
    frame(palm.clone().addScaledVector(dir, -0.02), dir, P.roll, _m);
    const slung = clamp(P.slung ?? 0, 0, 1);
    if (slung > 1e-3) {
      const pg = local(v3(PACK.G)), pd = local(v3(PACK.T)).sub(pg).normalize();
      const pm = frame(pg, pd, 0, new THREE.Matrix4());
      const hp = new THREE.Vector3(), hq = new THREE.Quaternion(), pp = new THREE.Vector3(), pq = new THREE.Quaternion(), sc = new THREE.Vector3();
      _m.decompose(hp, hq, sc); pm.decompose(pp, pq, sc);
      _m.compose(hp.lerp(pp, slung), hq.slerp(pq, slung), sc.set(1, 1, 1));
    }
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    _m.premultiply(inv);
    _m.decompose(shovel.position, shovel.quaternion, shovel.scale);
    shovel.updateMatrixWorld(true);
    // fading on / off his pack (per-shovel materials)
    const a = clamp(P.alpha ?? 1, 0, 1);
    for (const o of shovel.children) {
      const mt = o.material; if (!mt) continue;
      if (mt.opacity !== a) { mt.opacity = a; const tr = a < 0.999; if (mt.transparent !== tr) { mt.transparent = tr; mt.needsUpdate = true; } mt.depthWrite = !tr; }
    }
    shovel.traverse((o) => { if (o.isMesh) o.castShadow = a > 0.5; });
  }
  // left hand: on the shaft, or the rim / brush-off target while rising
  const lt = P.hands?.l ? local(P.hands.l) : palm.clone().addScaledVector(dir, LEFT_HAND);
  const shL = wpos(B.upperarm_l);
  twoBoneIKPole(B.upperarm_l, B.lowerarm_l, B.hand_l, lt, shL.clone().addScaledVector(_l, 0.5).addScaledVector(_u, -0.6).addScaledVector(_f, -0.2));
  if (B.Head && B.neck_01) turnWorld(B.Head, bendAxis, -0.15 * P.bend);
  if (still) mixPose(m, still, 1 - w, guard);
  if (pre) mixPose(m, pre, 1 - base, guard);
  return true;
}

// ------------------------------------------------------------------ dig site (scene)

let CLOD_GEO = null, RING_TEX = null;
const HEAP_GEO = {};
/** A lumpy dome (unit radius / height) with baked colours: lighter crest, darker flanks and furrows. */
function heapGeometry(surface) {
  if (HEAP_GEO[surface]) return HEAP_GEO[surface];
  const C = COLORS[surface] || COLORS.snow, top = new THREE.Color(C.top), side = new THREE.Color(C.side), dark = new THREE.Color(C.dark);
  const g = new THREE.SphereGeometry(1, 20, 9, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color();
  // spade-loads heaped up: irregular lumps (gaussian bumps at fixed pseudo-random spots), shaded crests and creases
  const lumps = [];
  for (let k = 0; k < 14; k++) {
    const a = k * 2.399, r = 0.15 + 0.62 * ((k * 0.618) % 1);
    lumps.push([Math.cos(a) * r, Math.sin(a) * r, 0.18 + 0.2 * ((k * 0.371) % 1), 0.05 + 0.05 * ((k * 0.733) % 1)]);
  }
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let n = 0;
    for (const [lx, lz, a, s2] of lumps) n += a * Math.exp(-((x - lx) ** 2 + (z - lz) ** 2) / s2);
    n = Math.min(n, 0.6) + 0.03 * Math.sin(x * 17.1 + z * 9.3);
    const k = 1 + 0.12 * n;
    p.setXYZ(i, x * k, y * (0.72 + 0.5 * n) * (1.2 - 0.25 * y), z * k); // a rounded, lumpy dome (no peak)
    const shade = clamp(0.15 + 0.55 * y + 1.1 * n, 0, 1);
    col.copy(side).lerp(top, shade);
    if (n < 0.12 && y > 0.05) col.lerp(dark, C.crease ?? 0.35); // creases between the loads
    c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.computeVertexNormals();
  return (HEAP_GEO[surface] = g);
}
function ringTexture() {
  if (RING_TEX) return RING_TEX;
  const S = 64, data = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const dx = (i + 0.5) / S * 2 - 1, dy = (j + 0.5) / S * 2 - 1, r = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx), wob = 0.08 * Math.sin(a * 7) + 0.05 * Math.sin(a * 13 + 1);
    const alpha = clamp((1 - r + wob) / 0.3, 0, 1) * 0.92;
    const o = (j * S + i) * 4; data[o] = data[o + 1] = data[o + 2] = Math.round(alpha * 255); data[o + 3] = 255; // alphaMap reads green
  }
  RING_TEX = new THREE.DataTexture(data, S, S); RING_TEX.needsUpdate = true; RING_TEX.magFilter = THREE.LinearFilter; RING_TEX.minFilter = THREE.LinearFilter;
  return RING_TEX;
}

/** Spoil heap height (m) after `landed` throws have come down (0 before the first). */
const heapHeight = (landed) => 0.075 * landed + 0.07 * Math.min(landed, 1);
/** Deterministic 0..1 hash. */
const hash = (i, k) => { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s); };
const CLODS_PER_THROW = 7;

export class DigSite {
  /** @param {{x:number, z:number, surface:string, heading:number}} dig @param {number} groundY */
  constructor(dig, groundY) {
    const C = COLORS[dig.surface] || COLORS.snow;
    this.colors = C;
    const g = this.group = new THREE.Group();
    g.name = 'dig-site';
    g.position.set(dig.x, groundY, dig.z);
    g.rotation.y = Math.PI / 2 - (dig.heading || 0);
    // disturbed ground: a soft darker ring decal (wider than the mound), the hole, the heap
    this.ringMat = new THREE.MeshStandardMaterial({ color: C.dark, roughness: 1, transparent: true, depthWrite: false, alphaMap: ringTexture(),
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, opacity: 0.55 });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.set(HEAP.x * 0.35, 0.012, 0.2); this.ring.receiveShadow = true;
    this.holeMat = new THREE.MeshStandardMaterial({ color: C.hole, roughness: 1, transparent: true, depthWrite: false, alphaMap: ringTexture(),
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.hole = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), this.holeMat); // soft-edged (radial alpha)
    this.hole.rotation.x = -Math.PI / 2; this.hole.position.set(HOLE.x, 0.016, HOLE.z); this.hole.receiveShadow = true;
    this.heapMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, transparent: true });
    this.heap = new THREE.Mesh(heapGeometry(dig.surface), this.heapMat);
    this.heap.castShadow = true; this.heap.receiveShadow = true;
    CLOD_GEO ||= new THREE.DodecahedronGeometry(0.055, 0);
    this.clodMat = new THREE.MeshStandardMaterial({ color: C.clod, roughness: 0.9 });
    this.clods = new THREE.InstancedMesh(CLOD_GEO, this.clodMat, 12 + CLODS_PER_THROW * 3);
    this.clods.castShadow = true; this.clods.frustumCulled = false; this.clods.count = 0;
    g.add(this.ring, this.hole, this.heap, this.clods);
    for (const o of [this.ring, this.hole, this.heap, this.clods]) o.userData.noXray = true;
    this.puffs = 0; this.done = false;
  }

  /** Blade-tip release point of throw k (site-local). */
  static throwFrom() { return v3(CYCLE[4].T); }

  /**
   * Show the site for phase / time (s since the phase began). @param {(x, z) => void} [puff] dust puff at a
   * site-local point (once per landing). @returns {boolean} still showing
   */
  update(phase, t, dur, puff = null) {
    const s = (dur || 2) / 2;
    const draw = DIG.draw * s, sinkT = DIG.sink * s, P = (sinkT - draw) / DIG.cycles;
    // throws so far (landed), clods in the air
    let heapH = 0, heapR = 0.25, holeR = 0.18, hx = HEAP.x, hz = HEAP.z, alpha = 1, ringA = 0.55;
    let clodN = 0;
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), pos = new THREE.Vector3();
    const throwAt = (k) => draw + (k + THROW_U) * P;
    if (phase === 'dig' || phase === 'abort' || phase === 'buried') {
      const tt = phase === 'dig' ? t : phase === 'buried' ? 1e9 : this._abortFrom ?? t;
      let landed = 0;
      for (let k = 0; k < DIG.cycles; k++) landed += ramp(tt, throwAt(k) + FLIGHT - 0.05, throwAt(k) + FLIGHT + 0.15);
      // nothing before the blade goes in: the hole opens with the first thrust, the disturbed ring spreads as the
      // first load is thrown, the heap is only what has landed (none before the first throw comes down)
      const open = ramp(tt, draw + 0.1 * P, draw + 0.3 * P);
      holeR = open * (0.3 + 0.1 * landed + (phase === 'dig' ? 0.15 * ramp(tt, sinkT, dur) : 0.15));
      ringA *= ramp(tt, draw + 0.1 * P, throwAt(0) + FLIGHT + 0.1);
      const h0 = heapHeight(landed), r0 = lerp(0.12, 0.3, Math.min(landed, 1)) + 0.1 * landed;
      // as he sinks, the spoil goes back over him: the heap slides onto the hole and becomes the mound
      const coverT = sinkT + 0.15 * s;
      const cover = phase === 'buried' ? 1 : phase === 'dig' ? ramp(tt, coverT, dur) : 0;
      hx = lerp(HEAP.x, 0, cover); hz = lerp(HEAP.z, 0.05, cover); // the mound centred on him (his pick spot)
      heapH = lerp(h0, 0.36, cover); heapR = lerp(r0, 0.43, cover); // his selection ring stays visible round it
      // clods in the air, then lying on the heap: they ride on the heap as it slides over him (same offset from its
      // centre, scaled with it) and sink into it while it does, so none is left hanging where the heap was
      if (phase === 'dig') {
        const rs = heapR / Math.max(0.05, r0), hs = heapH / Math.max(0.02, h0);
        const into = 1 - ramp(tt, coverT, coverT + 0.6 * (dur - coverT));
        for (let k = 0; k < DIG.cycles; k++) {
          const t0 = throwAt(k), land = t0 + FLIGHT;
          if (tt < t0 || tt >= land + 0.45 || into <= 0.01) continue;
          const from = DigSite.throwFrom(), hk = heapHeight(Math.min(landed, k + 1));
          for (let i = 0; i < CLODS_PER_THROW; i++) {
            const dt = tt - t0 - hash(i, k) * 0.05;
            if (dt < 0) continue;
            const ox = (hash(i, k + 7) - 0.5) * 0.5, oz = (hash(i, k + 3) - 0.5) * 0.55;
            const to = new THREE.Vector3(hx + ox * rs, (0.04 + 0.7 * hk) * Math.min(1, hs), hz + oz * rs);
            const fl = FLIGHT * (0.85 + 0.3 * hash(i, k + 11));
            const a = Math.min(dt, fl) / fl;
            pos.lerpVectors(from, to, a); pos.y += 4.9 * fl * fl * a * (1 - a) * 0.9; // ballistic arc
            const fade = (dt > fl ? 1 - ramp(dt - fl, 0.2, 0.4) : 1) * into;
            if (fade <= 0.01) continue;
            const sc = (0.6 + 0.8 * hash(i, k + 5)) * fade;
            Q.setFromEuler(new THREE.Euler(dt * 9 + i, dt * 7 + k, 0));
            M.compose(pos, Q, S.set(sc, sc * 0.8, sc));
            this.clods.setMatrixAt(clodN++, M);
          }
          if (puff && tt >= land && this.puffs <= k) { this.puffs = k + 1; puff(HEAP.x, HEAP.z); }
        }
      }
      if (phase === 'abort') { alpha = 1 - ramp(t, 0, dur || 0.4); ringA *= alpha; }
    } else if (phase === 'rise' || phase === 'out') {
      // the mound bursts as he pushes up, collapses to a flat patch, the patch fades
      const r = phase === 'rise' ? clamp(t / (dur || 1), 0, 1) : 1;
      const k = ramp(r, 0.05, 0.55);
      hx = lerp(0, 0.05, k); hz = lerp(0.05, 0.3, k);
      heapH = lerp(0.36, 0.05, k); heapR = lerp(0.43, 0.75, k); holeR = lerp(0.4, 0.5, k);
      if (phase === 'rise') {
        // each clod flies a full arc back to the ground (0.15 + 2.6t - 4.9t² = 0.03 at t ≈ 0.57 s), then fades
        // where it landed; each one fades out on its own, so none is cut off mid-air
        for (let i = 0; i < 10; i++) {
          const dt = t - hash(i, 41) * 0.08;
          if (dt <= 0) continue;
          const a = hash(i, 43) * Math.PI * 2, sp = 0.9 + hash(i, 47) * 0.9, fl = 0.57;
          if (dt > fl + 0.25) continue;
          const tt = Math.min(dt, fl);
          pos.set(HOLE.x + Math.cos(a) * (0.25 + sp * tt), Math.max(0.03, 0.15 + 2.6 * tt - 4.9 * tt * tt), HOLE.z + Math.sin(a) * (0.25 + sp * tt));
          const sc = 0.8 * (1 - ramp(dt - fl, 0, 0.25));
          M.compose(pos, Q.setFromEuler(new THREE.Euler(dt * 8 + i, dt * 6, 0)), S.set(sc, sc * 0.8, sc));
          this.clods.setMatrixAt(clodN++, M);
        }
      }
      if (phase === 'out') { alpha = 1 - ramp(t, 0.5, 3.5); ringA *= alpha; }
    }
    this.clods.count = clodN;
    if (clodN) this.clods.instanceMatrix.needsUpdate = true;
    this.heap.position.set(hx, -0.02, hz);
    this.heap.scale.set(heapR, Math.max(0.01, heapH), heapR * 1.12);
    this.heap.visible = heapH > 0.012 && alpha > 0.01;
    this.hole.scale.setScalar(holeR);
    this.hole.visible = alpha > 0.01 && holeR > 0.02 && (phase === 'dig' || phase === 'abort' || phase === 'rise');
    this.ring.visible = ringA > 0.005;
    this.heapMat.opacity = alpha; this.holeMat.opacity = alpha * 0.9; this.ringMat.opacity = ringA;
    // a flat patch (as he climbs out, then fading) writes no depth: the selection ring decal (drawn after the world,
    // depth-tested) shows over it instead of being hidden under it
    this.heapMat.depthWrite = alpha > 0.98 && heapH > 0.12;
    return alpha > 0.01;
  }

  dispose() {
    this.group.removeFromParent();
    this.ringMat.dispose(); this.holeMat.dispose(); this.heapMat.dispose(); this.clodMat.dispose();
    this.ring.geometry.dispose(); this.hole.geometry.dispose(); this.clods.dispose();
  }
}

// ------------------------------------------------------------------ per-frame driver

/**
 * Heading (sim convention: 0 = +x, π/2 = +z) he digs at: side-on to a camera of azimuth `az` (rad; screen right is
 * (cos az, −sin az)), on the side nearest his own heading, turned 25° toward the camera.
 */
export function digFacing(heading, az) {
  const rx = Math.cos(az), rz = -Math.sin(az), cx = Math.sin(az), cz = Math.cos(az);
  const sgn = rx * Math.cos(heading) + rz * Math.sin(heading) >= 0 ? 1 : -1;
  const k = Math.cos(0.44), j = Math.sin(0.44);
  return Math.atan2(rz * sgn * k + cz * j, rx * sgn * k + cx * j);
}

/**
 * Per rendered frame (Commando.renderUpdate, before the model update): dig site, sink offset, the skeleton overlay
 * hook. Visual state lives in `unit._digVis`.
 */
export function digFrame(u, dt) {
  const d = u.dig, w = u.world, m = u.model;
  let V = u._digVis;
  // overlay off: his own weapon comes back to his hand only now (not while the shovel is still on his pack)
  const unhook = () => { if (m?.overlay) { m.overlay = null; m._weaponFor?.(m._ctx()); } };
  const stop = () => { // nothing to draw: overlay off, shovel away, body back on the ground
    unhook();
    const b = m?.real ? m._body?.() : null;
    if (b && b.position.y !== 0) b.position.y = 0;
    V?.shovel?.removeFromParent();
    if (V?.site) { V.site.dispose(); V.site = null; }
    u.inGround = false;
  };
  if (!d) {
    if (V) { stop(); V.shovel?.traverse((o) => { if (o.isMesh) o.material.dispose(); }); u._digVis = null; }
    return;
  }
  const stamp = `${d.phase}@${d.t0}`;
  if (V?.idle === stamp) return; // this phase is fully drawn (patch faded): nothing per frame
  if (!V) V = u._digVis = { key: null, site: null, shovel: null, sink: 0, idle: null, lastDigT: 0 };
  // one site per dig (a loaded save with him buried gets one too); 'out' / 'abort' only finish the site they had
  const key = `${d.x.toFixed(2)},${d.z.toFixed(2)}`;
  if (key !== V.key || (d.phase === 'dig' && V.digT0 !== d.t0)) {
    if (V.site) { V.site.dispose(); V.site = null; }
    V.key = key; V.digT0 = d.phase === 'dig' ? d.t0 : null;
  }
  // he digs side-on to the camera (turned a little toward it), so the shovel's motion reads in the default view
  // whatever way he faced (view only: the sim heading is not touched; he turns back as he finishes rising)
  if (V.facingFor !== V.key) { V.facing = digFacing(u.heading, w?.game?.cameraController?.azimuth ?? 0); V.facingFor = V.key; }
  const scene = w?.scene;
  if (!V.site && scene && (d.phase === 'dig' || d.phase === 'buried' || d.phase === 'rise')) {
    const gy = w.groundY ? w.groundY(d.x, d.z) || 0 : 0;
    V.site = new DigSite({ ...d, heading: V.facing }, gy + (u.y || 0));
    scene.add(V.site.group);
  }
  // phase time: sim time since t0 (frames between two sim ticks keep the tick's value: deterministic stepping).
  // A dig / rise whose action ended without its last step (killed, knocked down) is drawn as cancelled / done.
  const now = w?.time ?? 0;
  let phase = d.phase, t = Math.max(0, now - d.t0), dur = d.dur;
  if ((phase === 'dig' || phase === 'rise') && (u.currentActionId !== 'shovel' || !u.alive)) {
    V.cut ??= now;
    phase = phase === 'dig' ? 'abort' : 'out'; t = now - V.cut; dur = phase === 'abort' ? 0.4 : 1;
  } else V.cut = null;
  if (phase === 'dig') V.lastDigT = t;
  if (V.site) {
    if (phase === 'abort' && V.site._abortFrom == null) V.site._abortFrom = V.lastDigT;
    const fx = w?.fx;
    const puff = fx ? (x, z) => {
      const p = V.site.group.localToWorld(new THREE.Vector3(x, 0, z));
      fx.spawn('dust_kick', p.x, p.z, { surface: d.surface, spoil: true }); // a little puff of the spoil, not a bullet's dust
    } : null;
    if (!V.site.update(phase, t, dur, puff)) { V.site.dispose(); V.site = null; }
  }
  // the man
  const P = u.alive && !u.downed ? manPose(phase, t, dur) : null;
  // walking off straight after the rise (a move order given while buried): his legs go to the walk at once
  if (P && phase === 'out' && u.path) P.base = Math.min(P.base, 1 - ramp(t, 0, 0.2));
  const body = m?.real ? m._body?.() : null;
  if (P && m?.real) {
    V.shovel ||= makeShovel();
    if (V.shovel.parent !== (body || m.root)) (body || m.root).add(V.shovel);
    V.pose = P;
    if (!m.overlay) { m.overlay = (mm, _dt, guard) => applyDigPose(mm, V.pose, V.shovel, guard); m._weaponFor?.(m._ctx()); }
  } else {
    unhook();
    if (V.shovel) V.shovel.visible = false;
  }
  // turning back to his own heading: over the last 40% of the rise and the first 0.5 s out (≈0.9 s, no quick spin
  // as the shovel goes onto his pack); a move order given while buried turns him to his path in 0.25 s
  const riseT = phase === 'rise' ? t : phase === 'out' && d.phase === 'out' ? (d.dur || 1) + t : null;
  let tf = phase === 'dig' ? ramp(t, 0, 0.18 * (dur || 2) / 2) : phase === 'buried' ? 1 : 0;
  if (riseT != null) {
    const rd = phase === 'rise' ? dur || 1 : d.dur || 1;
    tf = 1 - ramp(riseT, 0.6 * rd, rd + 0.5);
    if (phase === 'out' && u.path) tf *= 1 - ramp(t, 0, 0.25);
  }
  if (u.object3d && tf > 0.001) {
    const h = Math.PI / 2 - u.object3d.rotation.y;
    let dh = ((V.facing - h) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    u.object3d.rotation.y = Math.PI / 2 - (h + dh * tf);
  }
  // sinking into the hole / rising out of it: the body goes below the ground (the terrain hides it), never x-rayed
  // (the body group goes down, not the unit's root: the selection ring and the shadow-free ground stay where he is)
  V.sink = P ? P.sink : 0;
  u.inGround = V.sink > 0.15;
  if (body) { if (V.sink > 0 || body.position.y !== 0) body.position.y = -V.sink; }
  else if (V.sink > 0 && u.object3d) u.object3d.position.y -= V.sink;
  if (!P && !V.site && tf <= 0.001 && (phase === 'out' || phase === 'abort')) { stop(); V.idle = stamp; }
}
