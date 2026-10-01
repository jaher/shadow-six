/**
 * Ambient birds rendering (step 4f): one InstancedMesh per species (gull, crow, mallard, eider), low-poly bodies
 * (~150 triangles) sized from the species span/length, two-panel wings (arm + hand) flapped on the GPU about the
 * shoulder and wrist with the hand lagging, wings folded back along the body when sitting, head pecking (crows).
 * Two baked plumages per species (aCol / aCol2: adult / first-winter gull, drake / duck mallard and eider, grey
 * hooded crow / black carrion crow) picked per instance. Pose values (flap phase, amplitude, fold, peck) come from
 * the CPU sim on sim time (frozen while paused). Crows and gulls have legs whose feet follow the sim's world-space
 * feet (iLeg0 / iLeg1, with the head-bob and look), so planted feet stay put on screen.
 * @module art/bird-model
 */
import * as THREE from 'three';
import { BIRD_SPECIES } from '../world/bird-sim.js';
import { legDims } from '../world/bird-ground.js';

const C = (h) => new THREE.Color(h).convertSRGBToLinear();

/** Plumage palettes: [adult/male, alternate] × part colours. */
const PLUMAGE = {
  gull: [{ body: 0xf2f2ee, back: 0x9ea7b0, tip: 0x17171a, bill: 0xd9b83a, head: 0xf4f4f0, tail: 0xf2f2ee, leg: 0xd6a296 },
    { body: 0xb4a898, back: 0x8c7c68, tip: 0x3a3028, bill: 0x2a2624, head: 0xc0b4a4, tail: 0x5a4e44, leg: 0xc49a8c }],
  crow: [{ body: 0x8d8e8c, back: 0x86888a, tip: 0x18181b, bill: 0x141416, head: 0x19191c, tail: 0x19191c, wing: 0x1c1c20, leg: 0x161618 },
    { body: 0x19191c, back: 0x1c1c20, tip: 0x121214, bill: 0x121214, head: 0x151518, tail: 0x151518, leg: 0x161618 }],
  mallard: [{ body: 0x9c9a92, back: 0x7a7266, tip: 0x5a544c, bill: 0xd4b43a, head: 0x1b4a2a, tail: 0x202020, breast: 0x6a3a24, spec: 0x2a3f8a },
    { body: 0x8c6c4c, back: 0x6e5238, tip: 0x4c3a2a, bill: 0xb07a3a, head: 0x7c6248, tail: 0x5a4432, spec: 0x2a3f8a }],
  eider: [{ body: 0x1c1c1e, back: 0xf0eee6, tip: 0x1a1a1c, bill: 0x9aa088, head: 0xf0eee6, tail: 0x1a1a1c, breast: 0xe8dcc8, cap: 0x141416 },
    { body: 0x7a5a3c, back: 0x6c4e34, tip: 0x3c2c1e, bill: 0x6a6a5a, head: 0x7c5c3e, tail: 0x4c3a28 }],
};

/**
 * Geometry in metres (+X forward, Y up, Z along the span). aWing = (span fraction 0..1 on wings / −1 head / 0 body,
 * side ±1, hand panel 0/1, shoulder distance from the axis).
 */
export function birdGeometry(sp) {
  const S = BIRD_SPECIES[sp], L = S.len, half = S.span / 2, P = [], N = [], W = [], C1 = [], C2 = [], I = [];
  const pal = PLUMAGE[sp];
  const push = (x, y, z, nx, ny, nz, w, part) => {
    P.push(x, y, z); N.push(nx, ny, nz); W.push(...w);
    const a = C(pal[0][part] ?? pal[0].body), b = C(pal[1][part] ?? pal[1].body);
    C1.push(a.r, a.g, a.b); C2.push(b.r, b.g, b.b);
    return P.length / 3 - 1;
  };
  // body: spindle of rings along X, part colour by ring position and height
  const duck = sp === 'mallard' || sp === 'eider', ry = L * (duck ? 0.17 : 0.12), rz = L * (duck ? 0.19 : 0.12), R = 7, SEG = 7;
  const x0 = -L * 0.38, x1 = L * 0.3;
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG, x = x0 + (x1 - x0) * t, pr = Math.pow(Math.sin(Math.PI * (0.08 + 0.84 * t)), 0.6);
    for (let j = 0; j < R; j++) {
      const a = (j / R) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const part = c > 0.35 ? 'back' : t > 0.7 && c < 0.3 ? (pal[0].breast ? 'breast' : 'body') : 'body';
      push(x, c * ry * pr, s * rz * pr, 0, c, s, [0, 0, 0, 0], part);
    }
  }
  for (let i = 0; i < SEG; i++) for (let j = 0; j < R; j++) {
    const a = i * R + j, b = i * R + (j + 1) % R;
    I.push(a, b, a + R, b, b + R, a + R);
  }
  const tri = (pts, part, w = [0, 0, 0, 0], n = [0, 1, 0]) => {
    const b0 = P.length / 3;
    pts.forEach((q, k) => push(q[0], q[1], q[2], n[0], n[1], n[2], Array.isArray(w[0]) ? w[k] : w, Array.isArray(part) ? part[k] : part));
    for (let k = 1; k + 1 < pts.length; k++) I.push(b0, b0 + k, b0 + k + 1);
  };
  // head (a small diamond) + bill; aWing.x = −1 marks the head for pecking
  const hr = L * (duck ? 0.095 : 0.085), hx = x1 + hr * (duck ? 0.35 : 0.6), hy = ry * (duck ? 1.05 : 0.5), H = [-1, 0, 0, 0];
  const hp = [[hx + hr, hy, 0], [hx, hy + hr, 0], [hx - hr, hy, 0], [hx, hy - hr * 0.8, 0], [hx, hy, hr * 0.8], [hx, hy, -hr * 0.8]];
  const hc = pal[0].cap ? ['head', 'cap', 'head', 'head', 'head', 'head'] : 'head';
  for (const [a, b, c] of [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4], [1, 0, 5], [2, 1, 5], [3, 2, 5], [0, 3, 5]]) tri([hp[a], hp[b], hp[c]], Array.isArray(hc) ? [hc[a], hc[b], hc[c]] : hc, H);
  const bl = L * (sp === 'gull' ? 0.1 : sp === 'crow' ? 0.11 : 0.12), bw = L * (duck ? 0.04 : 0.022);
  tri([[hx + hr * 0.8, hy + bw, -bw], [hx + hr * 0.8 + bl, hy - bw * 0.3, 0], [hx + hr * 0.8, hy + bw, bw]], 'bill', H);
  tri([[hx + hr * 0.8, hy - bw, 0], [hx + hr * 0.8 + bl, hy - bw * 0.3, 0], [hx + hr * 0.8, hy + bw, -bw]], 'bill', H);
  tri([[hx + hr * 0.8, hy + bw, bw], [hx + hr * 0.8 + bl, hy - bw * 0.3, 0], [hx + hr * 0.8, hy - bw, 0]], 'bill', H);
  // tail fan
  const tl = L * (sp === 'crow' ? 0.3 : duck ? 0.14 : 0.2);
  tri([[x0 + L * 0.06, ry * 0.2, -rz * 0.5], [x0 + L * 0.06, ry * 0.2, rz * 0.5], [x0 - tl, ry * 0.25, rz * 0.7], [x0 - tl, ry * 0.25, -rz * 0.7]], 'tail');
  // wings: arm panel (shoulder → wrist) and hand panel (wrist → tip, swept back), both sides
  const root = rz * 0.7, wrist = half * 0.45, cr = L * (sp === 'gull' ? 0.32 : 0.36), xs = L * 0.08;
  for (const sd of [-1, 1]) {
    const wA = (f, hand) => [f, sd, hand, root];
    const wing = pal[0].wing ? 'wing' : 'back', tip = 'tip';
    tri([[xs, ry * 0.3, sd * root], [xs + L * 0.02, ry * 0.3, sd * wrist], [xs - cr * 0.85, ry * 0.3, sd * wrist], [xs - cr, ry * 0.3, sd * root]],
      [wing, wing, pal[0].spec ? 'spec' : wing, wing], [wA(0, 0), wA((wrist - root) / (half - root), 0), wA((wrist - root) / (half - root), 0), wA(0, 0)]);
    const f1 = (wrist - root) / (half - root);
    tri([[xs + L * 0.02, ry * 0.3, sd * wrist], [xs - cr * 0.55, ry * 0.3, sd * half], [xs - cr * 0.85, ry * 0.3, sd * wrist]],
      [wing, tip, tip], [wA(f1, 1), wA(1, 1), wA(f1, 1)]);
  }
  // legs (gulls, crows): hip → foot as two crossed thin quads + a toe wedge; aWing = (−2, side, 0 hip … 1 foot, 0).
  // The foot end is displaced per instance (iLeg0 / iLeg1: foot offset from its rest point, body frame).
  if (pal[0].leg) {
    const G = legDims(S), w = L * 0.014, t = G.toe;
    for (const sd of [1, -1]) {
      const hx2 = G.hipX, z = sd * G.zr, yH = G.hipY, yF = -G.stand, A = (u) => [-2, sd, u, 0];
      tri([[hx2 - w, yH, z], [hx2 + w, yH, z], [hx2 + w, yF, z], [hx2 - w, yF, z]], 'leg', [A(0), A(0), A(1), A(1)], [0, 0, sd]);
      tri([[hx2, yH, z - w], [hx2, yH, z + w], [hx2, yF, z + w], [hx2, yF, z - w]], 'leg', [A(0), A(0), A(1), A(1)], [1, 0, 0]);
      tri([[hx2 - t * 0.45, yF + 0.004, z], [hx2 + t, yF + 0.004, z + t * 0.4], [hx2 + t, yF + 0.004, z - t * 0.4]], 'leg', A(1));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 4));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(C1, 3));
  g.setAttribute('aCol2', new THREE.Float32BufferAttribute(C2, 3));
  g.setIndex(I);
  g.userData = { wrist, root, half };
  return g;
}

const VPARS = /* glsl */ `
attribute vec4 aWing; attribute vec3 aCol, aCol2; attribute vec4 iPose, iLeg0, iLeg1; attribute float iPlum;
uniform float uWrist, uWingY; uniform vec2 uNeck; uniform vec4 uBody;
varying vec3 vBCol;
vec2 bRot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(v.x * c - v.y * s, v.x * s + v.y * c); }
`;
// flap about the shoulder (arm) and the wrist (hand lags ~50°), fold back along the flank, head peck
const VMAIN = /* glsl */ `
vec3 bp = position; vec3 objectNormal = normal;
if (aWing.x < -1.5) {                                        // legs: the foot end follows the planted / swinging foot
  bp += (aWing.y > 0.0 ? iLeg0.xyz : iLeg1.xyz) * aWing.z;
} else if (aWing.y != 0.0) {
  float sd = aWing.y, o = bp.z * sd - aWing.w, wr = uWrist - aWing.w, fold = iPose.z;
  float a1 = iPose.y * 0.95 * sin(iPose.x) + 0.12 * (1.0 - fold), a2 = iPose.y * 0.55 * sin(iPose.x - 0.9);
  vec2 q = vec2(o, bp.y - uWingY);
  if (aWing.z > 0.5) { vec2 h = bRot(vec2(q.x - wr, q.y), a2); q = vec2(wr + h.x, h.y); }
  q = bRot(q, a1);
  bp.x -= fold * max(q.x, 0.0) * 0.52;                      // folded: primaries swept back to just past the tail
  q.x = mix(q.x, 0.012 + q.x * 0.06, fold);                   // … lying along the flank
  bp.y = uWingY + q.y + fold * uWingY * 1.5;
  bp.z = sd * (aWing.w + q.x);
  // folded: keep the wing on the body's back as it tapers to the tail (no dark stick floating above the rump)
  float bt = clamp((bp.x - uBody.x) / (uBody.y - uBody.x), 0.0, 1.0), pr = pow(sin(3.14159 * (0.08 + 0.84 * bt)), 0.6);
  bp.y = mix(bp.y, uBody.z * 0.78 * pr + 0.004, fold);
  bp.z = mix(bp.z, sd * (uBody.w * 0.64 * pr + 0.004 + q.x * 0.25), fold);
  float an = a1 + a2 * aWing.z;
  objectNormal = vec3(0.0, cos(an), -sd * sin(an));
} else if (aWing.x < -0.5) {                                 // head: look round (about the neck), peck, bob
  vec2 hz = bRot(vec2(bp.x - uNeck.x, bp.z), iLeg1.w);
  bp.x = uNeck.x + hz.x; bp.z = hz.y;
  vec2 hq = bRot(bp.xy - uNeck, -iPose.w * 0.9);
  bp.xy = uNeck + hq; bp.x += iLeg0.w;
}
vBCol = mix(aCol, aCol2, iPlum);
`;

/** Instanced birds of one species (cap instances). */
export function createBirdMesh(sp, cap, o = {}) {
  const g = birdGeometry(sp), U = g.userData, S = BIRD_SPECIES[sp];
  const pose = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4), plum = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
  pose.setUsage(THREE.DynamicDrawUsage);
  const leg0 = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4), leg1 = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
  leg0.setUsage(THREE.DynamicDrawUsage); leg1.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iPose', pose); g.setAttribute('iPlum', plum); g.setAttribute('iLeg0', leg0); g.setAttribute('iLeg1', leg1);
  const duck = sp === 'mallard' || sp === 'eider';
  const uni = { uWrist: { value: U.wrist }, uWingY: { value: S.len * 0.04 }, uNeck: { value: new THREE.Vector2(S.len * 0.3, S.len * 0.05) },
    uBody: { value: new THREE.Vector4(-S.len * 0.38, S.len * 0.3, S.len * (duck ? 0.17 : 0.12), S.len * (duck ? 0.19 : 0.12)) } }; // body spindle x0, x1, half-height, half-width
  const m = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = VPARS + sh.vertexShader.replace('#include <beginnormal_vertex>', VMAIN).replace('#include <begin_vertex>', 'vec3 transformed = bp;');
    sh.fragmentShader = 'varying vec3 vBCol;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vBCol;');
  };
  m.customProgramCacheKey = () => 'bird4';
  const mesh = new THREE.InstancedMesh(g, m, cap);
  mesh.customDepthMaterial = animDepthMaterial(VPARS, VMAIN + 'vec3 transformed = bp;', uni, 'birdDepth4'); // folded wings cast folded shadows
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0; mesh.frustumCulled = false; mesh.name = `bird_${sp}`;
  mesh.castShadow = o.shadows !== false; mesh.receiveShadow = false;
  mesh.userData.waterIgnore = true; mesh.userData.dynamic = true; mesh.userData.ambientLife = 'bird';
  return { mesh, pose, plum, leg0, leg1, cap, sp, G: S && legDims(S) };
}

/** Shadow depth material that runs the same vertex animation (injected at begin_vertex; no normals needed). */
export function animDepthMaterial(pars, main, uni, key) {
  const d = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  d.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = pars + sh.vertexShader.replace('#include <begin_vertex>', main);
  };
  d.customProgramCacheKey = () => key;
  return d;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YZX'), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _v = new THREE.Vector3();

/**
 * Foot i's offset from its rest point in the body frame (what the leg vertices add at the foot end): the world foot
 * position from the sim brought into the body frame, so planted feet stay put however the body pitches and rolls.
 * Fully tucked feet (in flight) use the fixed tucked pose so banking never swings them out.
 */
function footOffset(b, G, i, out, o) {
  const f = b.feet[i], sd = i ? -1 : 1, t = b.tuck || 0;
  _v.set(f.x - _p.x, f.y - _p.y, f.z - _p.z).applyQuaternion(_qi);
  _v.x -= G.hipX; _v.y += G.stand; _v.z -= sd * G.zr;
  const k = t > 0.7 ? Math.min(1, (t - 0.7) / 0.3) : 0;
  out[o] = _v.x + (-G.leg * 0.7 - _v.x) * k; out[o + 1] = _v.y + (G.leg * 0.85 - _v.y) * k; out[o + 2] = _v.z + (-sd * G.zr * 0.4 - _v.z) * k;
}

/** Write the visible birds into the instance buffers; returns the count. */
export function writeBirds(h, birds, inView) {
  let n = 0;
  const A = h.pose.array, Pl = h.plum.array, L0 = h.leg0?.array, L1 = h.leg1?.array;
  for (const b of birds) {
    if (n >= h.cap) break;
    if (inView && !inView(b.x, b.z, b.y)) continue;
    const dab = b.dab || 0;
    _e.set(b.bank + (b.sway || 0), -b.yaw, b.pitch - dab * 1.1);
    _q.setFromEuler(_e);
    _p.set(b.x, b.y + (b.st === 'swim' || b.st === 'float' ? 0.02 - dab * 0.05 : 0) + (!b.G && (b.st === 'perched' || b.st === 'ground') ? b.S.len * 0.14 : 0), b.z);
    _m.compose(_p, _q, _s);
    h.mesh.setMatrixAt(n, _m);
    A[n * 4] = b.ph; A[n * 4 + 1] = b.amp; A[n * 4 + 2] = b.fold; A[n * 4 + 3] = b.peck || 0;
    Pl[n] = b.pref < (b.sp === 'crow' ? 0 : 0.35) ? 1 : 0;
    if (L0) {
      if (b.G && b.feet) { _qi.copy(_q).invert(); footOffset(b, b.G, 0, L0, n * 4); footOffset(b, b.G, 1, L1, n * 4); }
      else { L0.fill(0, n * 4, n * 4 + 3); L1.fill(0, n * 4, n * 4 + 3); }
      L0[n * 4 + 3] = b.bob || 0; L1[n * 4 + 3] = b.look || 0;
    }
    n++;
  }
  h.mesh.count = n;
  if (n) { h.mesh.instanceMatrix.needsUpdate = true; h.pose.needsUpdate = true; h.plum.needsUpdate = true; if (L0) { h.leg0.needsUpdate = true; h.leg1.needsUpdate = true; } }
  return n;
}
