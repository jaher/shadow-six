/**
 * M7 "Chase of the Wolves" art pass 3: the lighthouse on the mole (missions/m07 `lighthouse`, r 2.5 × h 16) drawn as a
 * Norwegian coastal light (kystfyr) turned Kriegsmarine lookout, 7 February 1942: a coursed granite plinth under a
 * battered white-rendered tower with a red daymark band, three barred windows following the inner stair, a granite
 * stair curling up the east flank to the landing and the green door with its cast name plate, a corbelled gallery on
 * dressed-granite ogee consoles with an iron rail, a twelve-sided red cast-iron lantern room (24 panes, blackout screens
 * on the landward faces) round the lamp burning in the polar noon behind a dark prism lens in its brass cage — the lens
 * turns and each of its four bullseye panels flashes as it sweeps past the camera, with a glare — a verdigris cupola
 * whose red iron ribs run up under a wind-shaped snow cap (laid along the dome's normal, so no rib ever pierces it),
 * ventilator, lightning rod and vane; on the gallery the lookout's canvas windbreak, hooded instrument, field telephone
 * and his trodden arc; at the foot two paraffin drums and the snow banked in the stair's lee and along the flank. On the
 * mole (`buildLighthouseMole`, missions/m07 `ART.lighthouse`, installed by scripts/m07-art.js): the trodden path from
 * the patrol's turning point to the stair, the tarred signal mast with the storm cone at its head, the fog bell and the
 * SPERRGEBIET board, all in the art pass's own finishes.
 *
 * Visual only. The nav grid is measured on the visual (world/placement-visual.js), so the model is two consolidated
 * subgroups: `body` = exactly the old lathe surface (`BODY_PLINTH` + `BODY_WALL`, nav-measured: never change) and
 * `deco` = everything else, flagged `userData.clip = false` on every mesh and on the group, which every walker skips.
 * Footprint (r 2.5), B.HIGH, collision, nav and LOS are therefore the mission's and sim-trace m07 is identical to the
 * first pass. No lights, no per-frame JS: the lens turns and flashes in its shader (world/wind.js `uWindA.w`, sim time;
 * the camera's direction from the view matrix), the glare is a billboard whose own vertex shader computes the same flash
 * (collapsed to nothing between flashes), the trodden snow is a multiply-blended decal (it darkens the snow under it by
 * the same factor in sun and shade, feathered and printed with boots in its shader), and the weathering (streaks, rust,
 * the daymark band, the damp line, the dressed granite of the gallery) is a shader patch on the render and the stone.
 * Draw cost: one consolidated mesh per finish, and one depth-merge proxy (engine/depth-merge.js) draws every caster of
 * the deco in the shadow map and the AO prepass. Node-safe: the unit tests build both kits without a DOM (flat
 * materials, no shader compile).
 *
 * Frames: the tower kit's local frame is the structure's `placed(x, z, rot)` group (rot 0): origin on the ground at
 * the tower axis, +Y up, local +X = world +X (east), local +Z = world +Z (south, toward the mole tip and the camera).
 * θ is measured from +X toward +Z: a point at (r, θ, y) is (r cos θ, y, r sin θ); θ 0 = E, 90 = S (the camera's
 * side), 180 = W, 270 = N (toward the mole root and patrol p12). The wall's batter: rw(y) = 2.5 − 0.047945 (y − 1.4).
 * The snow preset's wind blows toward θ 20 (the tower's lee is the stair's flank).
 * @module art/lighthouse
 */
import * as THREE from 'three';
import { dressingMaterial, boxUV, consolidate, rng, seedOf } from './dressing.js';
import { paintedMaterial, fuelDrum, buildSignVariant } from './kit-props.js';
import { windowGlass } from './kit-buildings.js';
import { WIND_UNIFORMS } from '../world/wind.js';
import { addDepthMerge } from '../engine/depth-merge.js';

// ------------------------------------------------------------------------------------------ the measured body
/** The old lathe surface split at the chamfer top (the same triangles: the first pass's single lathe
 *  [[3.125,0],[3.125,1.2],[2.5,1.4],[1.8,16],[0,16]]). nav-measured: never change. */
export const BODY_PLINTH = [[3.125, 0], [3.125, 1.2], [2.5, 1.4]];
export const BODY_WALL = [[2.5, 1.4], [1.8, 16], [0, 16]];
/** Radius of the battered wall at height y (1.4 ≤ y ≤ 16). */
export const rw = (y) => 2.5 - 0.047945 * (y - 1.4);
/** The cupola's dome profile ([r, y] from the ogee's top down to the apex): the ribs follow it, the snow cap sits on it. */
const DOME = [[1.40, 19.47], [1.31, 19.68], [1.14, 19.92], [0.90, 20.13], [0.62, 20.30], [0.34, 20.42], [0.12, 20.49], [0, 20.50]];
const WIND_TH = 20;   // the snow preset's wind blows toward θ 20: drifts and the cap's heavier side
/**
 * The lens: the bullseye belt's middle `y`, the drum radius `r`, its turn (deg/s of sim time: one turn per 24 s), four
 * bullseye panels (a flash every 6 s at any bearing), the flash's sharpness (cos^k of the panel axis to the camera:
 * k 48 ≈ 1.5 s of glare), and the blackout screens' sector (θ, deg) the light never shows through.
 */
export const LENS = { y: 18.10, r: 0.40, turn: 15, panels: 4, sharp: 48, screens: [180, 330] };

// ------------------------------------------------------------------------------------------ helpers
const V2 = (r, y) => new THREE.Vector2(r, y);
const rad = (d) => (d * Math.PI) / 180;
const UP = new THREE.Vector3(0, 1, 0);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const f = (v, n = 4) => Number(v).toFixed(n);   // a GLSL float literal

function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}
/** Box with world-scale UVs centred at (x, y, z). */
function tbox(w, h, d, mat, x = 0, y = h / 2, z = 0, tile = 1.2) {
  const m = mesh(boxUV(new THREE.BoxGeometry(w, h, d).toNonIndexed(), tile), mat);
  m.position.set(x, y, z);
  return m;
}
/** Lathe with world-scale UVs (u round the circumference in metres / tile, v = height / tile); a sector when
 *  phiStart / phiLength are given. Profile rule (LatheGeometry normal = (dy, −dr)): write every profile so that
 *  vector points out of the solid: up the outer flank, inward across a top, outward across an underside. */
function tlathe(pts, seg, mat, tile = 2.2, phiStart = 0, phiLength = Math.PI * 2) {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => V2(r, y)), seg, phiStart, phiLength);
  const uv = g.attributes.uv, P = g.attributes.position;
  const rmax = Math.max(...pts.map((q) => q[0]));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * phiLength * rmax) / tile, P.getY(i) / tile);
  return mesh(g, mat);
}
/** A member of square section s from point a to point b ([x, y, z]). */
function beam(a, b, s, mat) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
  const m = mesh(boxUV(new THREE.BoxGeometry(s, L, s).toNonIndexed(), 1), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, B.clone().sub(A).normalize());
  return m;
}
/** Put `obj` at (r, θ°, y), `t` m along the tangent (toward increasing θ), its local +X radial (outward) and its
 *  local +Z tangential: boxes are therefore built as BoxGeometry(radial, height, tangential). */
function place(obj, r, th, y, t = 0) {
  const a = rad(th);
  obj.position.set(r * Math.cos(a) - t * Math.sin(a), y, r * Math.sin(a) + t * Math.cos(a));
  obj.rotation.y = -a;
  return obj;
}
/** A lathe sector from θ0° to θ1° (LatheGeometry's φ runs the other way round: φ = π/2 − θ). */
function sector(pts, seg, mat, th0, th1, tile = 2.2) {
  return tlathe(pts, seg, mat, tile, Math.PI / 2 - rad(th1), rad(th1 - th0));
}
/** Point (r, θ°, y) as [x, y, z]. */
const at = (r, th, y) => [r * Math.cos(rad(th)), y, r * Math.sin(rad(th))];
/** Height of the dome's surface at radius r (0 ≤ r ≤ 1.40). */
export function domeY(r) {
  for (let i = 1; i < DOME.length; i++) {
    const [r0, y0] = DOME[i - 1], [r1, y1] = DOME[i];
    if (r <= r0 && r >= r1) return y0 + ((r0 - r) / (r0 - r1)) * (y1 - y0);
  }
  return r > 1.40 ? DOME[0][1] : DOME[DOME.length - 1][1];
}
/** Outward unit normal [n_r, n_y] of a profile segment i (DOME[i] → DOME[i + 1]: r falls, y rises, so (dy, −dr)). */
function segNormal(i) {
  const [r0, y0] = DOME[i], [r1, y1] = DOME[i + 1], dr = r1 - r0, dy = y1 - y0, L = Math.hypot(dr, dy);
  return [dy / L, -dr / L];
}
/** Vertex normal of profile point i: the mean of its two segments' (the apex's is straight up). */
function vertNormal(i) {
  if (i >= DOME.length - 1) return [0, 1];
  const a = segNormal(Math.max(0, i - 1)), b = segNormal(i), x = a[0] + b[0], y = a[1] + b[1], L = Math.hypot(x, y);
  return [x / L, y / L];
}
/** Outward unit normal [n_r, n_y] of the dome at radius r, blended between the vertex normals (offsets along it are
 *  smooth: the cap and the ribs ride the dome at a constant normal distance, whatever its slope). */
export function domeNormal(r) {
  for (let i = 1; i < DOME.length; i++) {
    const r0 = DOME[i - 1][0], r1 = DOME[i][0];
    if (r <= r0 && r >= r1) {
      const t = (r0 - r) / (r0 - r1), a = vertNormal(i - 1), b = vertNormal(i);
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, L = Math.hypot(x, y);
      return [x / L, y / L];
    }
  }
  return r > 1.40 ? vertNormal(0) : [0, 1];
}
/** The point at radius r on the dome pushed `d` m out along its normal, as [r, y]. */
const domeOff = (r, d) => { const [nr, ny] = domeNormal(r); return [r + nr * d, domeY(r) + ny * d]; };
/**
 * A snow bank against the plinth: a lathe sector from θ0 to θ1 of `prof` ([r, y] from the hidden inner edge inside
 * the plinth out to the rim, which lies under the ground), its reach and height feathered to nothing at both ends
 * (e(u) over the first quarter and the last 28 % of the arc), the reach wobbling round the arc, low ripples across
 * the wind on its top (so the snow texture's grain is not the only relief), the rim sunk. Fine tessellation (one
 * segment per ~1.5°) so the silhouette is a curve, not a polygon.
 */
function bank(R, th0, th1, prof, mat) {
  const seg = Math.max(12, Math.round((th1 - th0) / 1.5)), s1 = R() * 6.28, s2 = R() * 6.28, s3 = R() * 6.28;
  const m = sector(prof, seg, mat, th0, th1, 1.0), P = m.geometry.attributes.position, r0 = prof[0][0];
  const rimY = prof[prof.length - 1][1];
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), z = P.getZ(i), y = P.getY(i), r = Math.hypot(x, z), a = Math.atan2(z, x);
    const th = ((a / Math.PI) * 180 - th0 + 720) % 360, u = Math.min(1, th / (th1 - th0));
    const e = sstep(0, 0.25, u) * sstep(1, 0.72, u), k = 1 + 0.06 * Math.sin(3 * a + s1) + 0.04 * Math.sin(7 * a + s2);
    const rr = r0 + (r - r0) * (0.3 + 0.7 * e) * k, fr = Math.min(1, (rr - r0) / Math.max(1e-6, prof[prof.length - 1][0] - r0));
    let yy = y === rimY ? rimY : y * Math.pow(e, 0.9);
    if (y > 0.001 && y !== rimY) yy += 0.01 * e * Math.sin(rr * 9 + a * 4 + s3) * (1 - fr);
    P.setXYZ(i, rr * Math.cos(a), yy, rr * Math.sin(a));
  }
  m.geometry.computeVertexNormals();
  return m;
}
/**
 * A trodden ribbon along `pts` ([x, z] world) `up` m over Y(x, z), its width `width(s, L)` (s = distance along it),
 * sampled every 0.4 m; uv = (s in metres, across 0..1): the trodden decal's shader feathers its edges, wanders them and
 * prints the boots by that uv (consolidate keeps uv, not colour attributes).
 */
function troddenRibbon(pts, Y, mat, { width = () => 1.0, up = 0.03, name = 'trodden' } = {}) {
  const P = pts.map(([x, z]) => new THREE.Vector2(x, z)), cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + P[i].distanceTo(P[i - 1]));
  const L = cum[cum.length - 1];
  const along = (s) => {
    s = Math.max(0, Math.min(L, s));
    let i = 1; while (i < P.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return P[i - 1].clone().lerp(P[i], t);
  };
  const pos = [], uv = [], idx = [], n = Math.max(2, Math.ceil(L / 0.4) + 1);
  for (let k = 0; k < n; k++) {
    const s = (k / (n - 1)) * L, c = along(s), d = along(s + 0.2).sub(along(s - 0.2)).normalize();
    const w = width(s, L), nx = -d.y * w / 2, nz = d.x * w / 2;
    for (const side of [-1, 1]) {
      const x = c.x + nx * side, z = c.y + nz * side;
      pos.push(x, Y(x, z) + up, z); uv.push(s, side > 0 ? 1 : 0);
    }
    if (k) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const m = mesh(geo, mat, false); m.name = name;
  return m;
}

// ------------------------------------------------------------------------------------------ shaders
const LH_FRAG_PARS = /* glsl */ `
varying vec3 vLhP;
float lhHash(float i, float n) { return fract(sin(mod(i, n) * 127.1 + 7.3) * 43758.5453); }
// periodic 1-D value noise round the tower, n (integer) cells per turn
float lhNoise(float a, float n) {
  float t = (a + 3.14159265) / 6.2831853 * n; float i = floor(t), f = fract(t); f = f * f * (3.0 - 2.0 * f);
  return mix(lhHash(i, n), lhHash(i + 1.0, n), f);
}
// tangential distance (m) from the azimuth a0
float lhArc(float a, float a0, float r) { return abs(mod(a - a0 + 3.14159265, 6.2831853) - 3.14159265) * r; }
void lhWindow(float a, float r, float y, float th, float sy, inout float run, inout float bars) {
  float da = lhArc(a, th, r);
  run  += smoothstep(0.48, 0.10, da) * step(y, sy) * exp(-(sy - y) * 0.7);               // grime run ~2 m below the sill
  bars += smoothstep(0.05, 0.00, abs(da - 0.10)) * step(y, sy) * exp(-(sy - y) * 1.4);   // rust from the two bars
}
`;
// (object space = the tower frame: consolidate bakes the group transform; the kit group has none)
const LH_FRAG_MAIN = /* glsl */ `
{
  float lhR = length(vLhP.xz), lhA = atan(vLhP.z, vLhP.x), lhY = vLhP.y;
  float st  = smoothstep(0.50, 0.88, 0.6 * lhNoise(lhA, 67.0) + 0.4 * lhNoise(lhA, 23.0));        // narrow vertical streaks
  float src = 0.7 * step(lhY, 14.96) * exp(-(14.95 - lhY) * 0.28) + 0.3 * step(lhY, 8.9) * exp(-(8.9 - lhY) * 0.45); // sourced at the gallery underside and the band's lower edge
  float run = 0.0, bars = 0.0;
  lhWindow(lhA, lhR, lhY, 2.1817, 4.85, run, bars);   // W1 θ 125
  lhWindow(lhA, lhR, lhY, 0.6109, 9.55, run, bars);   // W2 θ 35
  lhWindow(lhA, lhR, lhY, 1.3963, 12.85, run, bars);  // W3 θ 80
  float grime = clamp(st * src + 0.9 * (0.35 + 0.65 * st) * run, 0.0, 1.0) * 0.7;
  float rust = 0.0;
#ifdef LH_STONE
  // the deck slab's nosing: faint rust runs below the 24 baluster feet (θ = 15° k), streaked down the drip, never a dot
  float bal = abs(fract(lhA / 0.2617994 + 0.5) - 0.5) * 0.2617994 * lhR;
  rust = smoothstep(0.035, 0.0, bal) * smoothstep(15.95, 16.12, lhY) * step(lhY, 16.2) * (0.12 + 0.18 * lhNoise(lhA, 97.0));
  // the consoles, the bed course and the deck (y 14.5+): dressed granite, lighter and a shade warmer than the coursed
  // plinth and the sills (the ashlar's own grain kept: its luminance, re-tinted)
  float lhDressed = smoothstep(14.42, 14.58, lhY);
  vec3 lhGranite = vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))) * vec3(1.10, 1.04, 0.95) * 1.38;
  diffuseColor.rgb = mix(diffuseColor.rgb, min(lhGranite, vec3(1.0)), 0.9 * lhDressed);
#endif
  rust += 0.9 * bars;
#ifndef LH_STONE
  float band = smoothstep(8.85, 8.95, lhY) - smoothstep(11.05, 11.15, lhY);                        // the red daymark, painted on the render
  float damp = smoothstep(3.2, 1.3, lhY) * step(1.35, lhY) * 0.22 * (0.6 + 0.4 * lhNoise(lhA, 11.0)); // salt-damp greening above the plinth
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.66, 0.23, 0.17), band);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.74, 0.80, 0.72), damp);
#endif
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.56, 0.58, 0.54), grime);
  diffuseColor.rgb  = mix(diffuseColor.rgb, vec3(0.30, 0.19, 0.12), clamp(rust, 0.0, 1.0) * 0.7);
}
`;
/** Weathering on the render / the stone: streaks sourced at the gallery and the band, grime and rust under the
 *  windows' sills and bars, faint rust runs under the baluster feet on the deck's nosing; on the render also the red
 *  band and the damp line. Chains the previous onBeforeCompile (anti-tiling) and extends customProgramCacheKey; the
 *  scene's snow pass chains after it. */
function weather(m, stone) {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    sh.vertexShader = 'varying vec3 vLhP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vLhP = transformed;');
    sh.fragmentShader = (stone ? '#define LH_STONE\n' : '') + LH_FRAG_PARS + sh.fragmentShader.replace('#include <color_fragment>', LH_FRAG_MAIN + '\n#include <color_fragment>');
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey() : '') + (stone ? '|lhweather3:stone' : '|lhweather3');
  m.needsUpdate = true;
}

/**
 * GLSL (vertex, main): the lens's turn and the camera's horizontal direction in the drum's own (unturned) frame.
 * `lnM` turns the drum (uWindA.w = sim time, s); viewMatrix's third row is the camera's +Z (toward the viewer) in world
 * space — exact for the orthographic game camera, and the bearing for any other; mat3(modelMatrix) is the kit's rotation
 * (and uniform scale), so its transpose brings that direction into the kit's frame (`lnCo`) and lnMᵀ into the drum's
 * (`lnCam`).
 */
const LN_VERT = /* glsl */ `
  float lnT = uWindA.w * ${f(rad(LENS.turn), 7)};
  mat2 lnM = mat2(cos(lnT), -sin(lnT), sin(lnT), cos(lnT));
  vec3 lnCw = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec3 lnCo = transpose(mat3(modelMatrix)) * lnCw;
  vec2 lnCam = normalize(transpose(lnM) * normalize(lnCo.xz + vec2(1e-5, 0.0)));
`;
const PANEL = (2 * Math.PI) / LENS.panels;
/**
 * GLSL (fragment, after emissivemap_fragment): the lamp seen through the lens. vLnP is the drum point in its own frame,
 * vLnCam the camera's direction there. Between flashes the drum is dark glass: the bullseye belt (y 17.94–18.26) shows
 * only its concentric prism edges catching the lamp (thin amber rings round each panel's axis) and the lamp itself as a
 * small hot core where the drum faces the viewer; the refracting prism rings above and below carry a bright lip each
 * (6 cm pitch). Each point belongs to the panel whose axis is nearest: when that axis sweeps past the camera the whole
 * panel (belt and its prisms) blazes white — the flash.
 */
const LN_FRAG = /* glsl */ `
{
  float lnA = atan(vLnP.z, vLnP.x);
  float lnK = floor(lnA / ${f(PANEL, 7)} + 0.5) * ${f(PANEL, 7)};
  float lnFlash = pow(max(dot(vec2(cos(lnK), sin(lnK)), vLnCam), 0.0), ${f(LENS.sharp, 1)});
  float lnFace = dot(normalize(vLnP.xz + vec2(1e-5, 0.0)), vLnCam);
  float lnY = vLnP.y;
  float lnBelt = smoothstep(17.925, 17.955, lnY) * (1.0 - smoothstep(18.245, 18.275, lnY));
  float lnRing = fract((lnY - 17.62) / 0.06);
  float lnHl = smoothstep(0.45, 0.82, lnRing) * (1.0 - smoothstep(0.86, 1.0, lnRing)) * (1.0 - lnBelt) * step(17.62, lnY) * step(lnY, 18.58);
  float lnRr = length(vec2((lnA - lnK) * ${f(LENS.r, 3)}, (lnY - ${f(LENS.y, 3)}) * 1.15));
  // the bullseye's concentric prisms: only their edges catch the lamp (thin bright rings), dark glass between
  float lnRings = lnBelt * smoothstep(0.80, 0.97, 0.5 + 0.5 * cos(lnRr * 80.0)) * (1.0 - 0.5 * smoothstep(0.10, 0.22, lnRr));
  float lnSeen = smoothstep(0.0, 1.0, lnFace);
  // the lamp seen straight through the lens: a small hot core where the drum faces the camera, at the belt's middle
  float lnCore = smoothstep(0.93, 0.995, lnFace) * exp(-pow((lnY - ${f(LENS.y, 3)}) / 0.09, 2.0));
  // between flashes: dark green-black glass, the lamp a hot amber core, the bullseye's rings and the prism lips
  // catching it; the flash: the whole panel blazes white
  totalEmissiveRadiance = vec3(1.0, 0.62, 0.28) * (0.012 * lnSeen + 0.45 * lnRings * lnSeen + 2.2 * lnCore)
    + vec3(1.0, 0.82, 0.58) * lnHl * (0.04 + 0.30 * lnSeen)
    + vec3(1.0, 0.92, 0.78) * lnFlash * (5.5 * lnBelt + (1.0 - lnBelt) * (1.1 + 2.6 * lnHl));
}
`;
/** The lens drum turns about the tower axis (one turn per 24 s of sim time) and the lamp burns inside it (LN_FRAG):
 *  the pattern is painted in the drum's own frame and carried round by the vertex turn, so the panels sweep. */
function lensShader(m) {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    Object.assign(sh.uniforms, { uWindA: WIND_UNIFORMS.uWindA });
    sh.vertexShader = 'uniform vec4 uWindA;\nvarying vec3 vLnP;\nvarying vec2 vLnCam;\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${LN_VERT}\n  objectNormal.xz = lnM * objectNormal.xz;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLnP = position; vLnCam = lnCam; transformed.xz = lnM * transformed.xz;');
    sh.fragmentShader = 'varying vec3 vLnP;\nvarying vec2 vLnCam;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${LN_FRAG}`);
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|lhlens5';
  m.needsUpdate = true;
}
/**
 * The glare: a quad at the lens centre (kit frame (0, LENS.y, 0); its corners ±0.5) turned to face the camera, 1.8 m
 * toward it (so the lantern's own posts and eave do not clip it), about a constant screen size (11 % of the view's
 * half-height, never under 0.5 m), drawn additively: a hot core, a soft halo and four rays, all × the flash of the panel
 * nearest the camera (the lens's own formula, max over the panels) × the open sector (none through the blackout
 * screens). Between flashes the quad collapses to its centre: no fragments.
 */
function flareShader(m) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uWindA: WIND_UNIFORMS.uWindA });
    const [s0, s1] = LENS.screens, open = 360 - (s1 - s0);
    sh.vertexShader = 'uniform vec4 uWindA;\nvarying vec2 vFlUv;\nvarying float vFlI;\n' + sh.vertexShader.replace('#include <project_vertex>', `
  ${LN_VERT}
  vec2 flCo = normalize(lnCo.xz + vec2(1e-5, 0.0));
  float flOpen = mod(degrees(atan(flCo.y, flCo.x)) - ${f(s1, 1)} + 720.0, 360.0);
  float flVis = smoothstep(0.0, 15.0, flOpen) * (1.0 - smoothstep(${f(open - 15, 1)}, ${f(open, 1)}, flOpen));
  vFlI = pow(max(abs(lnCam.x), abs(lnCam.y)), ${f(LENS.sharp, 1)}) * flVis;
  vFlUv = position.xy - vec2(0.0, ${f(LENS.y, 3)});
  vec4 mvPosition = modelViewMatrix * vec4(0.0, ${f(LENS.y, 3)}, 0.0, 1.0);
  float flPx = isOrthographic ? 1.0 : -mvPosition.z;
  float flR = max(0.22 * flPx / projectionMatrix[1][1], 0.5);
  mvPosition.z += 1.8;
  mvPosition.xy += vFlUv * 2.0 * flR * step(0.004, vFlI);
  gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = 'varying vec2 vFlUv;\nvarying float vFlI;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
  vec2 flQ = vFlUv * 2.0; float flRr = dot(flQ, flQ);
  float flRays = (exp(-abs(flQ.y) * 60.0) + exp(-abs(flQ.x) * 60.0)) * exp(-flRr * 2.2);
  float flI = vFlI * (3.2 * exp(-flRr * 70.0) + 0.5 * exp(-flRr * 7.0) + 0.85 * flRays) * (1.0 - smoothstep(0.75, 1.0, sqrt(flRr)));
  gl_FragColor = vec4(vec3(1.0, 0.87, 0.64) * flI, 1.0);`);
  };
  m.customProgramCacheKey = () => '|lhflare';
  m.needsUpdate = true;
}
/**
 * Trodden snow (the path on the mole, the lookout's arc on the gallery): a multiply decal (art/vehicle-model's scorch
 * and the VFX ground decals: it darkens whatever snow is under it by the same factor in sun and shade, so the snow's own
 * grain shows through). By the ribbon's uv (s metres along, 0..1 across): the edges feather over a quarter of the width
 * and wander, broad patches of compaction, and boot prints — a walker's staggered left and right and a second, wider
 * pair a half pace on. TD.depth / TD.print: the compaction's and the prints' share of the darkening, in the linear
 * frame before tone mapping (the snow sits on the tone curve's shoulder: 0.20 read only ~5 % on screen); calibrated on
 * the M7 mole from the game camera at zoom 1–2 to ~15–18 % under the snow beside it, a light grey-blue, not a band.
 * Far off the prints average out, as a mipmap would: where a print spans only a few pixels (`fwidth` of the uv in
 * metres, zoom ≲ 1) they fade to their mean coverage across the band (`TD.printMean` over its middle), so the path
 * keeps its tone without reading as a dotted scribble; from zoom ~2 the boot prints are whole.
 * A uniform per finish (`TD_UNIFORM` the mole's path, `TD_ARC_UNIFORM` the gallery arc), so a probe can sweep them
 * without a recompile; the two finishes share one program.
 */
export const TD = { depth: 0.5, print: 0.22, arcDepth: 0.62, arcPrint: 0.28, printMean: 0.13, farKeep: 0.3 };
export const TD_UNIFORM = { value: new THREE.Vector2(TD.depth, TD.print) };
/** The gallery arc's own strength: the deck's snow sits higher on the tone curve, in full sun (same program). */
export const TD_ARC_UNIFORM = { value: new THREE.Vector2(TD.arcDepth, TD.arcPrint) };
const TD_PARS = /* glsl */ `
uniform vec2 uTd;
varying vec2 vTdUv;
float tdHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tdNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tdHash(i), tdHash(i + vec2(1.0, 0.0)), f.x), mix(tdHash(i + vec2(0.0, 1.0)), tdHash(i + vec2(1.0, 1.0)), f.x), f.y); }
`;
const TD_MAIN = /* glsl */ `
{
  float tdS = vTdUv.x, tdX = vTdUv.y;
  float tdN1 = tdNoise(vec2(tdS * 0.9 + 3.1, tdX * 1.3));
  float tdN2 = tdNoise(vec2(tdS * 3.3, tdX * 3.6 + 7.0));
  float tdE = min(tdX, 1.0 - tdX) * 2.0 + (tdN1 - 0.5) * 0.45;
  float tdMask = smoothstep(0.02, 0.62, tdE);
  float tdPr = 0.0;
  for (int w = 0; w < 2; w++) {
    float ph = float(w) * 0.19, off = w == 0 ? 0.12 : 0.23;
    float c0 = floor((tdS + ph) / 0.37);
    for (int k = -1; k <= 1; k++) {
      float c = c0 + float(k), h = tdHash(vec2(c, float(w) * 7.0 + 1.0));
      float sc = (c + 0.5) * 0.37 - ph + (h - 0.5) * 0.08;
      float xc = 0.5 + (mod(c, 2.0) * 2.0 - 1.0) * off + (h - 0.5) * 0.06;
      vec2 q = vec2((tdX - xc) / 0.075, (tdS - sc) / 0.15);
      tdPr = max(tdPr, (1.0 - smoothstep(0.5, 1.0, length(q))) * (0.55 + 0.45 * h) * (w == 0 ? 1.0 : 0.7));
    }
  }
  // far off (a 15 x 30 cm print under ~5 px: metres per pixel past ~2.5 cm) the prints fade to their mean coverage
  // across the band (they walk its middle: ~${TD.printMean} over |x - 0.5| < 0.28, none at the edges)
  float tdFine = 1.0 - smoothstep(0.022, 0.045, max(fwidth(tdS), fwidth(tdX)));
  float tdPrMean = ${f(TD.printMean, 3)} * (1.0 - smoothstep(0.24, 0.32, abs(tdX - 0.5)));
  tdPr = mix(tdPrMean, tdPr, ${f(TD.farKeep, 2)} + ${f(1 - TD.farKeep, 2)} * tdFine);
  float tdD = min(0.85, tdMask * (uTd.x * (0.72 + 0.4 * tdN2) + uTd.y * tdPr));
  gl_FragColor = vec4(vec3(1.0) - tdD * vec3(1.0, 0.95, 0.80), 1.0);
}
`;
function troddenShader(m, uniform = TD_UNIFORM) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTd = uniform;
    sh.vertexShader = 'varying vec2 vTdUv;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vTdUv = uv;');
    sh.fragmentShader = TD_PARS + sh.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${TD_MAIN}`);
  };
  m.userData.tdUniform = uniform;   // (probes sweep the strength live)
  m.customProgramCacheKey = () => '|lhtrodden4';
  m.needsUpdate = true;
}

// ------------------------------------------------------------------------------------------ materials
let CACHE = null;
/** The kit's finishes, cached per mission scope (the dressing materials are scoped: a new scope gets fresh clones). */
export function lighthouseMaterials() {
  const base = dressingMaterial('plasterWhite');
  if (CACHE && CACHE.base === base.uuid) return CACHE;
  const render = base.clone(); render.color.setHex(0xfaf8f2); render.name = 'kit:lighthouse_render'; delete render.userData.snowCover; weather(render, false);
  const stone = dressingMaterial('ashlar').clone(); stone.color.setHex(0x7a8085); stone.name = 'kit:lighthouse_stone'; delete stone.userData.snowCover; weather(stone, true);
  // the prism lens: dark green-black glass (sky in its reflections, next to no diffuse) lit from inside by its shader
  const lens = new THREE.MeshStandardMaterial({ color: 0x13201f, roughness: 0.14, metalness: 0.85, envMapIntensity: 1.4, emissive: 0xffc890, emissiveIntensity: 1, name: 'kit:lighthouse_lens' });
  lens.userData.snowCover = true; lensShader(lens);
  const flare = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, name: 'kit:lighthouse_flare' });
  flare.userData.snowCover = true; flare.userData.lhOverlay = { renderOrder: 4, xray: false, cullRadius: 3.5 }; flareShader(flare);
  // trodden snow: a multiply decal over the snow (no lighting, no fog: a factor), drawn before the other transparents
  const trodden = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false, fog: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, name: 'kit:lighthouse_trodden' });
  trodden.userData.snowCover = true; trodden.userData.lhOverlay = { renderOrder: -1, xray: false }; troddenShader(trodden);
  const troddenArc = trodden.clone(); troddenArc.name = 'kit:lighthouse_trodden_arc';
  troddenArc.userData = { snowCover: true, lhOverlay: { renderOrder: -1, xray: false } }; troddenShader(troddenArc, TD_ARC_UNIFORM);
  // the storm cone: black-painted canvas; the scene's snow pass leaves it alone (a white cone read as a lampshade)
  const cone = paintedMaterial('canvas', 0x1e1c1a); cone.userData.snowCover = true;
  // the cupola and the lantern room's ironwork take explicit snow (cap, lips): the scene's pass leaves them alone, so
  // the verdigris dome and the red ribs show under the cap whatever was loaded before
  const verdigris = paintedMaterial('steel', 0x5c9a7e, { roughness: 0.85 }); verdigris.userData.snowCover = true;
  const red = paintedMaterial('steel', 0x9a2f22); red.userData.snowCover = true;
  const brass = paintedMaterial('galv', 0xb08a46, { roughness: 0.38 }); brass.userData.snowCover = true;   // the lens cage, the name plate
  const glass = new THREE.MeshStandardMaterial({ color: 0x6d808a, transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.1, envMapIntensity: 0.75, side: THREE.DoubleSide, depthWrite: false, name: 'kit:lantern_glass' });
  glass.userData.lhOverlay = { xray: true };   // (out of the AO prepass: the lantern's inside takes its AO, not the glass)
  // one finish per look: the blackout screens, the lantern's lining, the lookout's canvas windbreak and instrument hood,
  // the rope coil on the drums and the plate's field are all the same dark canvas (one draw)
  CACHE = {
    base: base.uuid, render, stone, lens, flare, trodden, troddenArc, cone, verdigris, red, brass, glass,
    iron: dressingMaterial('castIron'),
    // (double-sided thin canvas; its shadow side matched to the solid finishes' so it joins their depth proxy)
    screen: paintedMaterial('canvas', 0x26272a, { side: THREE.DoubleSide, shadowSide: THREE.BackSide }),
    pane: windowGlass(),
    door: paintedMaterial('weatherboard', 0x2f5a44),
    planks: dressingMaterial('planks'),
    snow: dressingMaterial('snow'),
  };
  return CACHE;
}
/**
 * After a consolidate: the merged meshes of the overlay finishes (`material.userData.lhOverlay`: the trodden decal, the
 * glare, the lantern glass) leave the AO prepass (and, unless `xray`, the x-ray pass), take their draw order and
 * cast / receive no shadow; the glare's bounds grow to what its billboard draws. Exported for scripts/m07-art.js (the
 * mole's path is consolidated into the pass's root).
 * @param {THREE.Object3D} root
 */
export function markOverlays(root) {
  root.traverse((o) => {
    const ov = o.isMesh && o.material?.userData?.lhOverlay;
    if (!ov) return;
    o.userData.aoExclude = true;
    if (!ov.xray) o.userData.noXray = true;
    if (ov.renderOrder !== undefined) o.renderOrder = ov.renderOrder;
    o.castShadow = false; o.receiveShadow = false;
    if (ov.cullRadius) { o.geometry.computeBoundingSphere(); o.geometry.boundingSphere.radius = Math.max(o.geometry.boundingSphere.radius, ov.cullRadius); }
  });
  return root;
}
/** Shadow casters: every opaque finish (consolidate keys on castShadow: one merged mesh per material). They cost no
 *  extra draw for it: `addDepthMerge` gives the deco ONE proxy that draws all of them in the sun's shadow map and in
 *  the GTAO prepass (engine/depth-merge.js), so those passes take one draw for the whole kit instead of one per finish.
 *  The lens (its vertex shader turns it), the glare, the trodden decal and the lantern glass cast nothing. */
function castRule(g, M) {
  const none = new Set([M.lens, M.flare, M.trodden, M.troddenArc, M.glass]);
  g.traverse((o) => { if (o.isMesh) o.castShadow = !none.has(o.material) && !o.material.transparent; });
}

// ------------------------------------------------------------------------------------------ the tower
/**
 * The lighthouse kit (props-extra `lighthouse`): Group 'kit:lighthouse' of `body` (measured) and `deco` (clip: false).
 * Written for r 2.5 / h 16 (any other size is scaled: k = r / 2.5 across, h / 16 up).
 * @param {{r?: number, h?: number}} p
 */
export function buildLighthouse(p = {}) {
  const r = p.r ?? 2.5, h = p.h ?? 16, M = lighthouseMaterials();
  const g = new THREE.Group(); g.name = 'kit:lighthouse';
  // --- body: the old lathe, vertex for vertex (nav-measured: never change)
  const body = new THREE.Group(); body.name = 'kit:lighthouse';
  body.add(tlathe(BODY_PLINTH, 24, M.stone, 1.2));     // coursed granite plinth
  body.add(tlathe(BODY_WALL, 24, M.render, 2.2));      // the rendered wall; its top disc hides under the deck slab
  consolidate(body);
  // --- deco: everything else
  const deco = new THREE.Group(); deco.name = 'kit:lighthouse:deco';
  plinthDressing(deco, M);
  doorAndLanding(deco, M);
  stair(deco, M);
  windows(deco, M);
  gallery(deco, M);
  lanternRoom(deco, M);
  cupola(deco, M);
  lensAndPedestal(deco, M);
  footDressing(deco, M);
  lookout(deco, M);
  castRule(deco, M);
  consolidate(deco);
  markOverlays(deco);
  deco.traverse((o) => { if (o.isMesh) o.userData.clip = false; }); // (after consolidate: it makes fresh meshes)
  deco.userData.clip = false;
  addDepthMerge(deco);   // the casters' shadow-map and AO-prepass draws: one proxy (a mesh only inside those passes)
  g.add(body, deco);
  if (Math.abs(r - 2.5) > 1e-6 || h !== 16) g.scale.set(r / 2.5, h / 16, r / 2.5);
  return g;
}

/** Cap nosing on the plinth and the snow wedge on its chamfer (left off over the landing). */
function plinthDressing(g, M) {
  g.add(tlathe([[3.125, 1.10], [3.20, 1.12], [3.20, 1.20], [3.125, 1.22]], 24, M.stone, 1.2));
  g.add(sector([[3.14, 1.24], [3.12, 1.30], [2.95, 1.42], [2.62, 1.47], [2.52, 1.40]], 22, M.snow, 96, 424, 2.2));
  g.add(tlathe([[2.368, 4.15], [2.436, 4.19], [2.433, 4.24], [2.362, 4.27]], 24, M.stone, 1.2)); // string course over the door head
}

/** Landing slab, the door (θ 80) with its strap hinges and ring handle, the granite surround, the cast name plate
 *  (a black field in a raised brass border, raised brass lettering) and the bracket lamp over the door. */
function doorAndLanding(g, M) {
  const D = 80;
  g.add(place(tbox(1.225, 0.25, 1.6, M.stone), 2.9625, D, 1.295));                    // landing (y 1.17–1.42, r 2.35–3.575)
  g.add(place(tbox(0.06, 2.1, 1.0, M.door, 0, 0, 0, 1.0), 2.46, D, 2.47));            // the leaf (sill 1.42, head 3.52)
  for (const y of [1.75, 2.45, 3.15]) g.add(place(tbox(0.015, 0.04, 0.45, M.iron), 2.50, D, y, -0.27)); // strap hinges
  const ring = mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12), M.iron);
  place(ring, 2.51, D, 2.45, 0.35); ring.rotation.y += Math.PI / 2; g.add(ring);     // ring handle, in the wall plane
  for (const s of [-1, 1]) g.add(place(tbox(0.12, 2.35, 0.20, M.stone), 2.47, D, 2.595, s * 0.60)); // jambs
  g.add(place(tbox(0.13, 0.30, 1.50, M.stone), 2.426, D, 3.67));                      // lintel (y 3.52–3.82)
  g.add(place(tbox(0.16, 0.42, 0.26, M.stone), 2.421, D, 3.70));                      // keystone
  // the name plate beside the door (θ 103, wall r 2.442 at y 2.6): a black cast field 2.5 cm proud, its border a
  // raised brass frame with a bevel (an outer and an inner step), three raised lines of lettering
  const N = 103;
  g.add(place(tbox(0.025, 0.25, 0.37, M.screen, 0, 0, 0, 0.6), 2.4545, N, 2.60));
  for (const [dy, w, th, rr] of [[-0.115, 0.37, 0.02, 2.471], [0.115, 0.37, 0.02, 2.471]]) g.add(place(tbox(0.016, th, w, M.brass, 0, 0, 0, 0.6), rr, N, 2.60 + dy));
  for (const dt of [-0.175, 0.175]) g.add(place(tbox(0.016, 0.25, 0.02, M.brass, 0, 0, 0, 0.6), 2.471, N, 2.60, dt));
  for (const dy of [-0.095, 0.095]) g.add(place(tbox(0.008, 0.008, 0.31, M.brass, 0, 0, 0, 0.6), 2.469, N, 2.60 + dy)); // the bevel's inner step
  for (const dt of [-0.155, 0.155]) g.add(place(tbox(0.008, 0.19, 0.008, M.brass, 0, 0, 0, 0.6), 2.469, N, 2.60, dt));
  for (const [dy, w] of [[0.045, 0.24], [0.0, 0.17], [-0.045, 0.21]]) g.add(place(tbox(0.01, 0.018, w, M.brass, 0, 0, 0, 0.6), 2.4705, N, 2.60 + dy));
  // bracket lamp: arm, brace, the lantern body with its edge rods, cap and ring (unlit by day)
  g.add(place(tbox(0.42, 0.03, 0.03, M.iron), 2.529, D, 4.55));
  g.add(beam(at(2.32, D, 4.30), at(2.72, D, 4.53), 0.025, M.iron));
  g.add(place(tbox(0.20, 0.28, 0.20, M.pane, 0, 0, 0, 0.6), 2.67, D, 4.39));
  for (const [u, v] of [[-0.10, -0.10], [0.10, -0.10], [0.10, 0.10], [-0.10, 0.10]]) g.add(place(tbox(0.02, 0.28, 0.02, M.iron), 2.67 + u, D, 4.39, v));
  const cap = mesh(new THREE.ConeGeometry(0.16, 0.12, 4), M.iron); place(cap, 2.67, D, 4.59); g.add(cap);
  const loop = mesh(new THREE.TorusGeometry(0.04, 0.008, 5, 10), M.iron); place(loop, 2.67, D, 4.69); g.add(loop);
}

/** Eight granite steps curling up the east flank (θ 0 → 70) to the landing, with an iron handrail outside. */
function stair(g, M) {
  for (let k = 0; k < 8; k++) {
    const hk = (k + 1) * 0.1775;
    g.add(place(tbox(0.495, hk, 0.70, M.stone), 3.3275, 10 * k, hk / 2));            // r 3.08–3.575, the inner face buried 0.045
  }
  const posts = [[0, 0.1775], [20, 0.5325], [40, 0.8875], [60, 1.2425], [76, 1.42], [92, 1.42]].map(([th, y0]) => [th, y0, y0 + 0.95]); // on every other tread, two on the landing
  for (const [th, y0, y1] of posts) g.add(place(tbox(0.04, y1 - y0, 0.04, M.iron), 3.52, th, (y0 + y1) / 2));
  for (let i = 0; i + 1 < posts.length; i++) g.add(beam(at(3.52, posts[i][0], posts[i][2]), at(3.52, posts[i + 1][0], posts[i + 1][2]), 0.04, M.iron));
  g.add(beam(at(3.52, 92, 2.37), at(2.5, 92, 2.37), 0.04, M.iron));                  // return to the wall
}

/** Three barred windows, opening 0.55 × 0.90, following the inner stair: W1 θ 125 / 5.3, W2 θ 35 / 10.0 (inside the
 *  band), W3 θ 80 / 13.3 (on the door axis, under the consoles). Sills and lintels proud; the rust and grime under
 *  them is the weathering shader's (the same θ / sill heights). */
function windows(g, M) {
  for (const [th, yc] of [[125, 5.3], [35, 10.0], [80, 13.3]]) {
    g.add(place(tbox(0.17, 0.12, 0.80, M.stone), rw(yc - 0.51) + 0.055, th, yc - 0.51));   // sill, proud 0.14
    g.add(place(tbox(0.12, 0.16, 0.80, M.stone), rw(yc + 0.53) + 0.03, th, yc + 0.53));    // lintel
    for (const s of [-1, 1]) g.add(place(tbox(0.10, 0.90, 0.10, M.stone), rw(yc) + 0.02, th, yc, s * 0.325)); // jambs
    g.add(place(tbox(0.04, 0.90, 0.55, M.pane, 0, 0, 0, 0.6), rw(yc) - 0.01, th, yc));
    for (const s of [-1, 1]) g.add(place(tbox(0.025, 0.90, 0.025, M.iron), rw(yc) + 0.0425, th, yc, s * 0.10));
    g.add(place(tbox(0.025, 0.025, 0.55, M.iron), rw(yc) + 0.0425, th, yc));
  }
}

/** The console's side profile (x radial out from the wall, y down from the bed course): a 10 cm square head under the
 *  bed course, then an ogee (cyma) sweeping back to the wall at −1.16 — convex shoulder, concave toe — and a 6 cm
 *  fillet where it dies into the wall. */
export const CONSOLE = [[0, 0], [0.72, 0], [0.72, -0.10], ...Array.from({ length: 9 }, (_, i) => {
  const t = (i + 1) / 10, s = t * t * (3 - 2 * t);
  return [0.72 * (1 - s) + 0.04 * s, -0.10 - 1.0 * t];
}), [0.04, -1.10], [0, -1.16]];
/** The corbelled gallery: 16 dressed-granite ogee consoles under a bed course under the deck slab, the iron railing
 *  with its snow line, the snow cushion on the deck with the lookout's trodden arc. */
function gallery(g, M) {
  // the wall at y 15.75 is r 1.81: the consoles' backs (r 1.78) are let 3 cm into it
  const shape = new THREE.Shape(CONSOLE.map(([x, y]) => V2(x, y)));
  for (let k = 0; k < 16; k++) {
    const geo = boxUV(new THREE.ExtrudeGeometry(shape, { depth: 0.24, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, -0.12), 1.2);
    g.add(place(mesh(geo, M.stone), 1.78, 22.5 * k, 15.75));                           // r 1.78–2.50 at y 15.75, toe at 14.59
  }
  g.add(tlathe([[1.80, 15.75], [2.44, 15.80], [2.44, 15.95]], 32, M.stone, 1.2));                                   // bed course
  g.add(tlathe([[2.44, 15.95], [2.66, 15.98], [2.68, 16.10], [2.65, 16.25], [0, 16.25]], 32, M.stone, 1.2));       // deck slab, rounded nosing with a drip
  // railing
  for (let k = 0; k < 24; k++) g.add(place(tbox(0.05, 0.95, 0.05, M.iron), 2.52, 15 * k, 16.725));
  for (const [tube, y] of [[0.035, 17.20], [0.02, 16.75], [0.03, 16.31]]) {
    const t = mesh(new THREE.TorusGeometry(2.52, tube, 5, 48).rotateX(Math.PI / 2), M.iron); t.position.y = y; g.add(t);
  }
  const line = mesh(new THREE.TorusGeometry(2.52, 0.03, 4, 48).rotateX(Math.PI / 2), M.snow);                      // the snow line on the handrail
  line.position.y = 17.235; line.scale.y = 0.7; g.add(line);
  // snow cushion: untrodden (θ 115 → 365), lowered under the arc (θ 5 → 115), the lookout's trodden arc on it
  g.add(sector([[2.48, 16.25], [2.45, 16.30], [2.30, 16.36], [1.90, 16.37], [1.50, 16.33], [1.42, 16.25]], 24, M.snow, 115, 365));
  g.add(sector([[2.48, 16.25], [2.44, 16.29], [2.36, 16.31], [1.55, 16.31], [1.47, 16.29], [1.42, 16.25]], 12, M.snow, 5, 115));
  const arc = []; for (let th = 8; th <= 112; th += 4) arc.push([1.95 * Math.cos(rad(th)), 1.95 * Math.sin(rad(th))]);
  g.add(troddenRibbon(arc, () => 16.31, M.troddenArc, { width: (s, L) => (0.74 - 0.2 * Math.pow(Math.abs(2 * s / L - 1), 3)) * (1 + 0.08 * Math.sin(s * 2.1)), up: 0.012, name: 'kit:lighthouse:arc' }));
}

/** The lantern room: iron floor, red murette with base and top rings, the lantern door (face θ 15), 24 panes of glass
 *  with red astragals and transom, the cornice, snow lips, and the blackout screens inside the five landward faces. */
function lanternRoom(g, M) {
  const floor = mesh(new THREE.CylinderGeometry(1.30, 1.30, 0.12, 12), M.iron); floor.position.y = 16.31; g.add(floor);
  const mur = mesh(new THREE.CylinderGeometry(1.32, 1.32, 0.78, 12, 1, true), M.red); mur.position.y = 16.76; g.add(mur);
  const lining = mesh(new THREE.CylinderGeometry(1.29, 1.29, 0.78, 12, 1, true), M.screen); lining.position.y = 16.76; g.add(lining); // its dark inside (double-sided)
  g.add(tlathe([[1.32, 16.25], [1.40, 16.25], [1.40, 16.37], [1.32, 16.37]], 12, M.red, 1.2));   // base ring
  g.add(tlathe([[1.30, 17.10], [1.40, 17.10], [1.40, 17.17], [1.30, 17.17]], 12, M.red, 1.2));   // top ring
  g.add(place(tbox(0.03, 0.72, 0.55, M.iron), 1.29, 15, 16.76));                                 // lantern door
  g.add(place(tbox(0.02, 0.12, 0.02, M.iron), 1.31, 15, 16.90, 0.20));
  const glass = mesh(new THREE.CylinderGeometry(1.30, 1.30, 1.85, 12, 1, true), M.glass); glass.position.y = 18.075; g.add(glass);
  for (let k = 0; k < 12; k++) {
    g.add(place(tbox(0.06, 1.85, 0.06, M.red), 1.32, 30 * k, 18.075));                 // corner posts
    g.add(place(tbox(0.05, 0.05, 0.673, M.red), 1.286, 15 + 30 * k, 18.07));           // the transom
  }
  g.add(tlathe([[1.30, 19.00], [1.44, 19.06], [1.46, 19.20], [1.42, 19.25]], 12, M.red, 1.2));   // cornice
  g.add(tlathe([[1.36, 19.25], [1.46, 19.25], [1.44, 19.31], [1.37, 19.32]], 12, M.snow, 2.2));  // snow lip on it
  g.add(tlathe([[1.30, 17.17], [1.41, 17.17], [1.39, 17.23], [1.33, 17.24]], 12, M.snow, 2.2));  // snow lip on the murette
  // blackout screens (θ 180–330, hung inside the glass): the light shows only seaward, the dark back makes the lens read
  const [s0, s1] = LENS.screens;
  const screens = mesh(new THREE.CylinderGeometry(1.22, 1.22, 1.75, 5, 1, true, Math.PI / 2 - rad(s1), rad(s1 - s0)), M.screen);
  screens.position.y = 18.075; g.add(screens);
}

/**
 * The cupola's ribs and snow cap. A rib (0.05 square, `RIB.s`) rides the dome with its centre line `RIB.off` m out along
 * the dome's normal, so its section spans −0.005 … +0.045 off the copper: a hair sunk, never coplanar, never standing
 * off. Each climbs from the ogee's top to `RIB.end` × the cap's rim radius at its azimuth and so ends under the cap's
 * body. The cap is laid along the dome's normal (not up the y axis: on the dome's 55° shoulder a vertical 8 cm is only
 * 4.6 cm of snow): `CAP.body` all over the body, twice the rib's 0.045, `CAP.crown` more at the apex, a rounded lip over
 * the last `CAP.lip` of the rim radius, the rim itself sunk into the copper.
 */
export const RIB = { s: 0.05, off: 0.02, end: 0.86 };
export const CAP = { body: 0.09, crown: 0.14, lip: 0.08 };

/** The verdigris cupola (ogee sweep at its base) with its twelve red iron ribs (on the lantern's posts) running up under
 *  the wind-shaped snow cap, the cap, ventilator, lightning rod and vane. */
function cupola(g, M) {
  g.add(tlathe([[1.40, 19.25], [1.43, 19.33], ...DOME], 24, M.verdigris, 1.2));
  for (let k = 0; k < 12; k++) {
    const th = 30 * k, rEnd = Math.max(0.75, RIB.end * capRim(rad(th)));
    const rs = [...DOME.map(([r]) => r).filter((r) => r > rEnd + 0.03), rEnd];
    for (let i = 0; i + 1 < rs.length; i++) {
      // each piece runs 1 cm past both its ends (the joints overlap instead of gaping at the profile's bends)
      const [ra, ya] = domeOff(rs[i], RIB.off), [rb, yb] = domeOff(rs[i + 1], RIB.off);
      const A = new THREE.Vector3(...at(ra, th, ya)), B = new THREE.Vector3(...at(rb, th, yb)), d = B.clone().sub(A).normalize().multiplyScalar(0.01);
      g.add(beam(A.sub(i ? d : d.clone().multiplyScalar(0)).toArray(), B.add(d).toArray(), RIB.s, M.red));
    }
  }
  g.add(snowCap(M.snow));
  const neck = mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.30, 10), M.iron); neck.position.y = 20.85; g.add(neck);
  const ball = mesh(new THREE.SphereGeometry(0.24, 14, 10), M.iron); ball.position.y = 21.22; g.add(ball);
  const vcap = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.10, 8), M.iron); vcap.position.y = 21.49; g.add(vcap);
  const rod = mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 6), M.iron); rod.position.y = 22.0; g.add(rod);
  const tip = mesh(new THREE.ConeGeometry(0.03, 0.10, 6), M.iron); tip.position.y = 22.55; g.add(tip);
  // weather vane: four cardinal arms with end balls, the arrow pointing into the wind
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const arm = mesh(new THREE.BoxGeometry(x ? 0.5 : 0.025, 0.025, z ? 0.5 : 0.025), M.iron); arm.position.set(x * 0.35, 21.75, z * 0.35); g.add(arm);
    const b = mesh(new THREE.SphereGeometry(0.045, 8, 6), M.iron); b.position.set(x * 0.6, 21.75, z * 0.6); g.add(b);
  }
  const arrow = new THREE.Group(); arrow.position.y = 22.0; arrow.rotation.y = -rad(WIND_TH + 180);
  arrow.add(mesh(new THREE.BoxGeometry(0.70, 0.03, 0.03), M.iron));
  const head = mesh(new THREE.ExtrudeGeometry(new THREE.Shape([V2(0.35, 0.07), V2(0.35, -0.07), V2(0.53, 0)]), { depth: 0.02, bevelEnabled: false }).translate(0, 0, -0.01), M.iron);
  arrow.add(head);
  const tail = mesh(new THREE.BoxGeometry(0.24, 0.16, 0.02), M.iron); tail.position.x = -0.40; arrow.add(tail);
  g.add(arrow);
}

/** The cap's rim radius at azimuth a (rad): three- and five-lobed wander round r 1.12 (0.97–1.27), heavier on the lee
 *  side (θ 20), so the copper shows a deeper skirt to windward. */
export const capRim = (a) => 1.12 * (1 + 0.05 * Math.sin(3 * a + 0.6) + 0.03 * Math.sin(5 * a - 1.1) + 0.05 * Math.cos(a - rad(WIND_TH)));
/** The cap's thickness along the dome's normal at the fraction fr of its rim radius (see RIB / CAP). */
export const capThick = (fr) => (fr <= 1 - CAP.lip ? CAP.body + CAP.crown * Math.pow(1 - fr * fr, 1.3)
  : fr < 1 ? CAP.body * Math.pow((1 - fr) / CAP.lip, 0.7) : -0.012);
/**
 * The snow cap on the dome: a skin of 96 segments × 13 rings laid `capThick` out along the dome's normal, its rim
 * wandering with `capRim`, its body wind-wobbled by ±1.2 cm (never under the ribs' 4.5 cm). Where a rib runs under the
 * body the snow swells 1.4 cm over a broad band (the rib's line under it), faded in from the lip and out toward the
 * crown. The seam's two columns share their normals and the apex one normal (no shading line, no pinched crown), and
 * the snow's grain is laid on from above (uv = x, z: continuous all round — an angular u jumped by 2πr / tile at the
 * seam and drew a crease down the cap's east side).
 */
function snowCap(mat) {
  const SEG = 96, RINGS = [0, 0.2, 0.4, 0.6, 0.75, 0.84, 0.9, 0.93, 0.955, 0.975, 0.99, 0.997, 1.0], pos = [], uv = [], idx = [];
  for (let i = 0; i < RINGS.length; i++) for (let j = 0; j <= SEG; j++) {
    const a = (j / SEG) * Math.PI * 2, fr = RINGS[i], r = Math.min(1.38, fr * capRim(a));
    const dk = Math.abs(((a / rad(30)) % 1 + 1) % 1 - 0.5) * 2;                          // 0 between ribs .. 1 over a rib
    const ridge = 0.014 * Math.pow(Math.max(0, (dk - 0.45) / 0.55), 2) * sstep(0.5, 0.7, fr) * sstep(0.92, 0.84, fr);
    const wob = (0.008 * Math.sin(5 * a + 2.1) + 0.004 * Math.sin(11 * a - 0.4)) * sstep(0.1, 0.4, fr) * sstep(0.92, 0.8, fr);
    const [rr, yy] = domeOff(r, capThick(fr) + ridge + wob), x = rr * Math.cos(a), z = rr * Math.sin(a);
    pos.push(x, yy, z); uv.push(x / 2.2, z / 2.2);
  }
  for (let i = 0; i + 1 < RINGS.length; i++) for (let j = 0; j < SEG; j++) {
    const a = i * (SEG + 1) + j, b = a + SEG + 1;
    if (i === 0) idx.push(a, b + 1, b); else idx.push(a, b + 1, b, a, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const N = geo.attributes.normal;
  for (let j = 0; j <= SEG; j++) N.setXYZ(j, 0, 1, 0);                                  // the crown
  for (let i = 1; i < RINGS.length; i++) {                                               // the seam (a = 0 and 2π)
    const a0 = i * (SEG + 1), a1 = a0 + SEG, x = N.getX(a0) + N.getX(a1), y = N.getY(a0) + N.getY(a1), z = N.getZ(a0) + N.getZ(a1), L = Math.hypot(x, y, z) || 1;
    N.setXYZ(a0, x / L, y / L, z / L); N.setXYZ(a1, x / L, y / L, z / L);
  }
  return mesh(geo, mat);
}

/** The iron pedestal with its clockwork case, and the lens: a brass base plate, the dark prism drum (its own
 *  material, alone and centred on the axis: the shader turns it in place; sawtooth prism rings above and below the
 *  bullseye belt at r 0.40, y 17.94–18.26), its brass cage (eight bars, two belt rings, the top plate) and the glare. */
function lensAndPedestal(g, M) {
  const cyl = (rt, rb, hh, seg, y) => { const m = mesh(new THREE.CylinderGeometry(rt, rb, hh, seg), M.iron); m.position.y = y; return m; };
  g.add(cyl(0.42, 0.42, 0.08, 16, 16.41), cyl(0.28, 0.28, 1.05, 12, 16.975), cyl(0.34, 0.34, 0.10, 16, 17.55));
  const box = mesh(new THREE.BoxGeometry(0.30, 0.25, 0.20), M.iron); box.position.set(0.40, 16.725, 0); g.add(box);
  g.add(tlathe([[0.26, 17.56], [0.46, 17.56], [0.46, 17.62], [0.26, 17.62]], 24, M.brass, 1));                  // base plate
  g.add(tlathe([[0.30, 17.62], [0.36, 17.66], [0.30, 17.72], [0.37, 17.78], [0.31, 17.84], [0.38, 17.90], [0.40, 17.94], [0.40, 18.26], [0.38, 18.30], [0.31, 18.36], [0.37, 18.42], [0.30, 18.48], [0.36, 18.54], [0.30, 18.58], [0, 18.58]], 24, M.lens, 1));
  for (let k = 0; k < 8; k++) g.add(place(tbox(0.034, 1.0, 0.034, M.brass, 0, 0, 0, 0.6), 0.428, 22.5 + 45 * k, 18.12)); // cage bars
  for (const y of [17.94, 18.26]) { const t = mesh(new THREE.TorusGeometry(0.43, 0.018, 6, 32).rotateX(Math.PI / 2), M.brass); t.position.y = y; g.add(t); } // belt rings
  g.add(tlathe([[0, 18.58], [0.36, 18.58], [0.36, 18.63], [0.10, 18.63], [0.10, 18.70], [0, 18.70]], 24, M.brass, 1)); // top plate with its boss
  const flare = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), M.flare); flare.position.y = LENS.y; flare.castShadow = false; g.add(flare);
}

/** At the foot: the snow banked in the stair's lee (θ −12 → 82: steps 1–3 buried under 0.6 m, the tongue 1.4 m out)
 *  and a lower bank along the camera's flank between the plinth and the path (θ 95 → 200), two paraffin drums with
 *  a rope coil against the plinth below the landing. */
function footDressing(g, M) {
  const R = rng(seedOf('m07lighthouse'));
  g.add(bank(R, -12, 82, [[2.9, 0.62], [3.5, 0.60], [3.64, 0.55], [3.85, 0.44], [4.1, 0.29], [4.35, 0.14], [4.55, 0.05], [4.7, 0.0], [4.8, -0.045]], M.snow));
  g.add(bank(R, 95, 200, [[2.9, 0.30], [3.2, 0.29], [3.38, 0.23], [3.55, 0.13], [3.68, 0.04], [3.74, 0.0], [3.8, -0.045]], M.snow));
  for (const [th, ry] of [[100, 0.4], [112, -1.1]]) { const d = fuelDrum(0x4f4c47); d.material = M.iron; place(d, th === 100 ? 3.46 : 3.45, th, 0); d.rotation.y += ry; g.add(d); }
  const coil = mesh(new THREE.TorusGeometry(0.20, 0.05, 6, 14).rotateX(Math.PI / 2), M.screen); place(coil, 3.46, 100, 0.93); g.add(coil);
}

/** The Kriegsmarine lookout on the gallery: a canvas windbreak lashed to the rail on the windward side (θ 215 / 238),
 *  the hooded observation instrument on its tripod, the field telephone on the murette with its cable to the lantern
 *  door. */
function lookout(g, M) {
  for (const th of [215, 238]) {
    g.add(place(tbox(0.025, 0.95, 0.92, M.screen, 0, 0, 0, 1.2), 2.47, th, 16.78));
    for (const y of [16.32, 17.22]) g.add(place(tbox(0.035, 0.04, 0.94, M.iron), 2.45, th, y));
  }
  const [cx, , cz] = at(1.95, 228, 0);
  for (let k = 0; k < 3; k++) {
    const a = rad(228 + 120 * k);
    g.add(beam([cx + 0.35 * Math.cos(a), 16.37, cz + 0.35 * Math.sin(a)], [cx, 17.55, cz], 0.035, M.iron));
  }
  const hood = mesh(new THREE.BoxGeometry(0.42, 0.22, 0.20), M.screen); hood.position.set(cx, 17.68, cz); hood.rotation.y = -rad(300); g.add(hood); // looking out over the windbreak
  g.add(place(tbox(0.12, 0.30, 0.26, M.iron), 1.35, 250, 16.90));                     // field telephone on the murette
  g.add(beam(at(1.33, 250, 16.75), at(1.33, 250, 16.40), 0.03, M.iron));               // its cable: down the murette,
  for (const [a, b] of [[250, 295], [295, 340], [340, 25]]) g.add(beam(at(1.40, a, 16.40), at(1.40, b, 16.40), 0.03, M.iron)); // along its foot to the door
}

// ------------------------------------------------------------------------------------------ on the mole
/** The mole path's width at s of L m: 1 m with a slow and a quick wander (±16 %), drawn in from 0.45 over its first
 *  2 m (it leaves the patrol's beat) and narrowing to 0.6 over its last 3 m at the stair foot. */
export const pathWidth = (s, L) => (0.45 + 0.55 * sstep(0, 2, s)) * (L - s < 3 ? 1.0 - 0.4 * (1 - (L - s) / 3) : 1.0) * (1 + 0.1 * Math.sin(s * 0.9 + 0.5) + 0.06 * Math.sin(s * 2.3 + 1.7));
/**
 * The mole's dressing round the light (missions/m07 `ART.lighthouse`; world coordinates, every piece standing on
 * `groundY(x, z)`; in the m07art root, never measured): the trodden path (the multiply decal), the tarred signal mast
 * with the north storm cone hoisted to its head above the yard (a gale from a northerly quarter), the fog bell in its
 * gabled frame, the SPERRGEBIET board facing the patrol's approach. Everything is in the pass's own finishes (`mats`:
 * stone, iron, timber), so it merges into the coping's draws: the mast, its round yard, the halyards, the bell frame,
 * its plank hood and pull rope and the board's posts are the pass's creosoted timber; the cone, the hoops, the cast
 * fog bell and the fittings its iron. Only the decal, the black storm cone and the board's painted face add a draw
 * (one each: their casters' shadow-map and AO draws go to the root's depth proxy). Call `markOverlays` on
 * the root after consolidating it (the decal leaves the AO prepass).
 * @param {{mast?: number[], bell?: number[], sign?: number[], signFaces?: number[], path?: number[][]}} spec
 * @param {{groundY?: (x: number, z: number) => number, mats?: {stone?: THREE.Material, iron?: THREE.Material, timber?: THREE.Material}}} o
 */
export function buildLighthouseMole(spec = {}, o = {}) {
  const M = lighthouseMaterials(), Y = o.groundY ?? (() => 0), mats = o.mats || {};
  const stone = mats.stone ?? M.stone, iron = mats.iron ?? M.iron, timber = mats.timber ?? M.planks;
  const g = new THREE.Group(); g.name = 'm07art:lighthouse';
  if (spec.path?.length > 1) g.add(troddenRibbon(spec.path, Y, M.trodden, { width: pathWidth, up: 0.03, name: 'm07art:lighthouse:path' }));
  if (spec.mast) {
    const [x, z] = spec.mast, m = new THREE.Group(); m.position.set(x, Y(x, z), z);
    m.add(tbox(0.8, 0.45, 0.8, stone, 0, 0.225, 0, 1.2));
    m.add(tlathe([[0.10, 0], [0.06, 9.0], [0, 9.0]], 8, timber, 2.4));                                        // tarred mast
    for (const y of [0.5, 4.5, 6.9]) { const b = mesh(new THREE.TorusGeometry(0.10, 0.014, 4, 10).rotateX(Math.PI / 2), iron); b.position.y = y; m.add(b); } // iron hoops
    const truck = mesh(new THREE.SphereGeometry(0.07, 8, 6), iron); truck.position.y = 9.05; m.add(truck);
    // the yard: a round spar across the wind (θ 115), thickest at the mast, its grain along it (a lathe laid flat)
    const yard = tlathe([[0, -1.2], [0.03, -1.2], [0.045, -0.5], [0.05, 0], [0.045, 0.5], [0.03, 1.2], [0, 1.2]], 8, timber, 2.4);
    yard.rotation.set(0, -rad(115), Math.PI / 2); yard.position.y = 7.0; m.add(yard);
    const yx = Math.cos(rad(115)), yz = Math.sin(rad(115)), cx = Math.cos(rad(25)), cz = Math.sin(rad(25));
    for (const s of [-1, 1]) { const blk = mesh(new THREE.SphereGeometry(0.035, 6, 4), iron); blk.position.set(s * 1.12 * yx, 6.96, s * 1.12 * yz); m.add(blk); } // yard-arm blocks
    // the storm cone, apex up, hoisted to the masthead above the yard on its own halyard, hanging beside the mast
    // (its rim 0.43 m off the axis, clear of the 7 cm spar): a black canvas cone on its iron hoop, its own finish (the
    // pass's iron takes the scene's snow, and a white cone reads as a lampshade)
    const off = 0.43, ox = off * cx, oz = off * cz;
    const cone = mesh(new THREE.ConeGeometry(0.36, 0.80, 14), M.cone); cone.position.set(ox, 8.12, oz); m.add(cone);
    const hoop = mesh(new THREE.TorusGeometry(0.36, 0.016, 4, 14).rotateX(Math.PI / 2), iron); hoop.position.set(ox, 7.73, oz); m.add(hoop);
    const sheave = mesh(new THREE.SphereGeometry(0.035, 6, 4), iron); sheave.position.set(0.1 * cx, 8.86, 0.1 * cz); m.add(sheave);
    m.add(beam([0.1 * cx, 8.86, 0.1 * cz], [ox, 8.52, oz], 0.018, timber));                                   // tarred halyard over the masthead sheave,
    m.add(beam([ox, 7.72, oz], [0.12 * cx, 1.6, 0.12 * cz], 0.018, timber));                                  // down from the hoop to the cleat
    const cleat = tbox(0.12, 0.04, 0.04, iron, 0.12 * cx, 1.6, 0.12 * cz, 0.6); cleat.rotation.y = -rad(25); m.add(cleat);
    g.add(m);
  }
  if (spec.bell) {
    const [x, z] = spec.bell, b = new THREE.Group(); b.position.set(x, Y(x, z), z);
    for (const s of [-1, 1]) b.add(tbox(0.14, 2.30, 0.14, timber, s * 0.6, 1.15, 0, 1.2));
    b.add(tbox(1.5, 0.14, 0.14, timber, 0, 2.17, 0, 1.2));
    for (const s of [-1, 1]) { const p = tbox(1.5, 0.03, 0.70, timber, 0, 2.36, s * 0.309, 1.2); p.rotation.x = s * 0.4887; b.add(p); } // plank gable hood: ridge 2.52, eaves 2.20
    const bell = tlathe([[0, 0], [0.20, 0], [0.23, 0.04], [0.20, 0.12], [0.17, 0.24], [0.12, 0.32], [0.06, 0.36], [0, 0.37]], 16, iron, 1); bell.position.y = 1.63; b.add(bell); // cast-iron fog bell
    const eye = mesh(new THREE.TorusGeometry(0.03, 0.01, 4, 8), iron); eye.position.y = 2.05; b.add(eye);
    const clapper = mesh(new THREE.SphereGeometry(0.03, 8, 6), iron); clapper.position.y = 1.66; b.add(clapper);
    b.add(beam([0, 1.66, 0], [0, 1.15, 0], 0.024, timber));                                                    // the pull rope (tarred)
    b.add(beam([0, 1.15, 0], [0.50, 1.15, 0], 0.024, timber));
    b.add(tbox(0.10, 0.03, 0.03, iron, 0.51, 1.15, 0, 0.6));
    g.add(b);
  }
  if (spec.sign) {
    const [x, z] = spec.sign, [fx, fz] = spec.signFaces ?? [x, z - 1];
    const s = buildSignVariant({ id: 'lh_sperr', variant: 'verboten', x: 0, z: 0 });
    s.traverse((q) => { if (q.isMesh && !/^kit:sign/.test(q.material?.name || '')) q.material = timber; }); // its posts and backing: the pass's timber
    s.position.set(x, Y(x, z), z); s.rotation.y = Math.atan2(fx - x, fz - z);
    g.add(s);
  }
  return g;
}
