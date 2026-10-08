/**
 * Shader of the burst dam's torrent (render/dam-breach.js): ONE flow-aligned surface from the reservoir to the river —
 * funnel, slot, column down the face, its foot and the river below — plus the column's side walls, on the late FX layer.
 * Nothing switches from one piece to the next: every term is a smooth function of the flow coordinates, so the joins
 * carry the same streaks, colour and foam straight through.
 * - Coordinates: `flow.x` across the flow (-1 … 1, the same lanes all the way: they converge into the gap and spread
 *   down the river), `flow.y` = TRAVEL TIME from the funnel's rim (s), `aux.x` = position along the flow (funnel -2 … -1,
 *   slot -1 … 0, column 0 … 1, river 1 + metres / 20), `aux.w` = the local surface speed (m/s).
 * - Motion: one pattern advected in travel time — octaves of noise in (across, τ − t), each weighted by how long its
 *   features are at the local speed (~1.5 m), so features keep a readable size everywhere and move at the local speed:
 *   crawling on the lake, racing through the gap, fastest down the face (free fall), slowing through the boil and down
 *   the river. A streak leaving the lip runs on down the column and out into the river.
 * - Look along the flow: the lake's flow lines and glassy slick, the slot's dark fast water torn white off the cheeks
 *   and the pier stubs, white water building over the brink, the column's white streaks over dark gaps with frayed
 *   edges and droplets, a churning boil at its foot (warped in place), then the river's foam veins thinning with distance
 *   and soft sides. `uMass` (0.5 … 1.5) = the discharge against the full head: more white water.
 * - `uFrontTau`: the water front (travel time reached) just after the blast and the flood front down the river.
 * @module render/dam-breach-glsl
 */
import * as THREE from 'three';

export const BREACH_VERT = /* glsl */`
attribute vec2 flow;   // x: across (-1 … 1), y: travel time from the funnel's rim (s)
attribute vec4 aux;    // x: position along the flow, y: 1 on the column's side walls, z: across the wall (0 edge … 1), w: speed (m/s)
varying vec2 vF; varying vec4 vA;
void main() {
  vF = flow; vA = aux;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`;

const NOISE = /* glsl */`
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm2(vec2 p) { return 0.6 * vnoise(p) + 0.4 * vnoise(p * 2.07 + 7.3); }
// the advected flow pattern: octaves along the flow k = 0.3 … 10 per second of travel time, each weighted by how close
// its feature length at the local speed (U / k) is to Lt m; lanes across at acf (and a finer, broken second scale)
float flowNoise(float ac, float eta, float U, float acf, float sd, float Lt) {
  float s = 0.0, w = 0.0, k = 0.3;
  for (int i = 0; i < 5; i++) {
    float l = log2(U / (k * Lt)), wi = exp(-l * l * 0.7);
    vec2 q = vec2(ac * acf + sd + float(i) * 7.13, eta * k + float(i) * 3.31);
    s += wi * (0.68 * vnoise(q) + 0.32 * vnoise(q * vec2(2.3, 1.7) + 4.1));
    w += wi; k *= 2.4;
  }
  return s / max(w, 1e-3);
}
`;

export const BREACH_FRAG = /* glsl */`
uniform float uTime, uAmt, uLight, uNight, uFrontTau, uMass, uSeed, uBend;
uniform vec3 uSky;
varying vec2 vF; varying vec4 vA;
${NOISE}
void main() {
  float z = vA.x, U = max(vA.w, 0.25), ac = vF.x, aa = abs(ac), tau = vF.y, eta = tau - uTime, wall = vA.y;
  float dRiv = max(0.0, (z - 1.0) * 20.0);                       // metres down the river from the column's foot
  // where we are (smooth weights, never a switch)
  float lake = 1.0 - smoothstep(-1.3, -1.0, z);                   // the funnel on the reservoir
  float fr = clamp(-1.0 - z, 0.0, 1.0);                          // 0 at the mouth … 1 at the funnel's rim
  float colW = smoothstep(-0.08, 0.2, z) * (1.0 - smoothstep(0.9, 1.25, z)); // the falling column
  float riv = smoothstep(1.0, 1.3, z);                            // the river's surface
  float Lt = mix(1.6, 4.5, riv);                                   // features ~1.6 m long, drawn out to ~4.5 m down the river
  // (down the river the lanes meander as the flood spreads: the warp rides the current too)
  float acm = ac + riv * 0.22 * (fbm2(vec2(ac * 2.2 + 4.0, eta * 0.45)) - 0.5);
  float P = flowNoise(acm, eta, U, 11.0, uSeed, Lt);               // lanes and streaks
  float Q = flowNoise(acm * 2.6 + 0.37, eta + 1.7, U, 11.0, uSeed + 11.0, Lt * 0.55); // finer, shorter detail
  // aeration along the flow: none on the lake, the slot tears up past its bend, white water building over the brink,
  // the most at the foot, clearing down the river with distance
  float A = 0.5 * smoothstep(uBend - 0.05, -0.05, z) + 0.38 * smoothstep(-0.12, 0.18, z) + 0.12 * smoothstep(0.7, 0.98, z);
  A *= mix(1.0, 0.26 + 0.74 * exp(-dRiv / 8.0), step(1.0, z));
  A *= mix(1.0, 0.82 + 0.18 * uMass, smoothstep(-1.0, -0.6, z));
  // the slot's own white water: torn off the cheeks, piled against the central pier stub's upstream face and trailing
  // behind it and the side stubs; it hands over to the column's aeration before the lip
  float zs = z + 1.0, slotF = smoothstep(-1.1, -0.95, z) * (1.0 - smoothstep(-0.14, 0.04, z));
  float n = fbm2(vec2(ac * 7.0 + uSeed, eta * 2.2));
  float cheek = smoothstep(0.62, 0.95, aa + 0.3 * (n - 0.5)) * mix(0.55, 1.0, smoothstep(uBend + 0.8, 0.75, zs)) * smoothstep(0.1, 0.3, zs);
  float pillow = smoothstep(0.24, 0.05, aa + 0.08 * (n - 0.5)) * exp(-pow((zs - 0.21) / 0.05, 2.0));
  float wake = smoothstep(0.14 + 0.5 * max(zs - 0.22, 0.0), 0.02, aa + 0.15 * (n - 0.5)) * smoothstep(0.2, 0.3, zs);
  float side = smoothstep(0.24, 0.04, abs(aa - 0.77) + 0.12 * (n - 0.5)) * smoothstep(0.6, 0.74, zs);
  float feat = max(max(cheek, pillow), max(wake, side)) * slotF * (0.6 + 0.4 * uMass);
  // white water: streaks (a share A of the surface, over dark gaps) on the slot and the column; thin flow lines on the
  // lake; a churning boil (cells warped in place, fast) where the column lands, giving way to the river's marbled foam
  // (veins, rafts where it survives) — all blended smoothly through the gap's mouth and the boil
  float streak = smoothstep(1.0 - A - 0.13, 1.0 - A + 0.13, 0.72 * P + 0.28 * Q);
  float rg = 1.0 - abs(2.0 * P - 1.0);
  float lines = smoothstep(0.93, 0.995, 0.85 * rg + 0.15 * Q) * mix(0.75, 1.0, smoothstep(0.3, 0.7, fbm2(vec2(ac * 3.0 + 2.0, eta * 0.5))));
  vec2 bq = vec2(ac * 5.0, eta * 2.8);
  float bn = fbm2(bq + 1.4 * vec2(fbm2(bq * 0.8 + uTime * 0.9), fbm2(bq * 0.7 - uTime * 0.75 + 3.0)) + uTime * vec2(0.25, -0.4));
  float boilW = smoothstep(0.2, 0.44, bn + 0.35 * (A - 0.6));
  float rq = 1.0 - abs(2.0 * Q - 1.0);
  float raft = smoothstep(0.36, 0.62, flowNoise(ac * 0.4 + 2.0, eta + 5.0, U, 3.0, uSeed + 3.0, Lt * 2.0));
  float veins = max(smoothstep(0.82, 0.97, rg), 0.7 * smoothstep(0.86, 0.98, rq)) * mix(raft, 1.0, exp(-dRiv / 6.0));
  float wht = mix(mix(streak, boilW, smoothstep(0.85, 1.05, z)), veins, smoothstep(1.3, 1.75, z));
  wht = mix(wht, lines, lake);
  wht = max(wht, feat * smoothstep(0.25, 0.55, Q + 0.35 * feat));
  // colours (linear; tone-mapped afterwards: \`lake\` matches the reservoir's surface on screen)
  vec3 lakeC = vec3(0.026, 0.062, 0.105), glass = vec3(0.016, 0.04, 0.06), sheen = vec3(0.2, 0.26, 0.32);
  vec3 whiteC = vec3(0.92, 0.95, 0.98), grey = vec3(0.36, 0.42, 0.47);
  float gloss = smoothstep(0.6, 0.9, P) * (1.0 - A) * (1.0 - riv);   // long glossy streaks on the smooth fast water
  // (in the boil and down the river the shading's detail is churned foam, not the column's streak lanes)
  float Dn = mix(Q, fbm2(vec2(acm * 14.0 + uSeed, eta * 2.0)), smoothstep(0.85, 1.1, z));
  vec3 base = mix(lakeC, glass, smoothstep(-1.6, -1.05, z)) * (0.85 + 0.3 * Dn) + sheen * gloss * 0.35;
  vec3 col = mix(base, mix(grey, whiteC, smoothstep(0.3, 0.75, Dn)), wht);
  col *= mix(1.0, 0.86, smoothstep(0.35, 0.95, z) * (1.0 - riv));     // the lower column in its own spray's shade
  // opacity: the funnel fades out onto the lake; the slot and the column are solid water; the river shows foam and an
  // aerated veil over the river's own water
  float aLake = pow(1.0 - fr, 1.5) * smoothstep(1.0, 0.6, fr);
  float aBody = mix(1.0, aLake, step(z, -1.0));
  aBody = max(aBody, wht * 0.85 * smoothstep(1.0, 0.8, fr) * lake);
  float aRiv = clamp(max(wht, A * (0.22 + 0.4 * fbm2(vec2(ac * 2.0, eta * 0.4)))), 0.0, 1.0);   // + the milky aerated veil
  float a = mix(aBody, aRiv, riv);
  // edges: the funnel's sides by the dam, the column's frayed edges (fingers, droplets), the river's soft banks
  a *= mix(1.0, smoothstep(1.0, 0.8, aa), lake);
  float fray = fbm2(vec2(ac * 5.0 + uSeed, eta * 3.1)), ew = max(1e-3, (0.07 + 0.12 * smoothstep(0.05, 0.6, z) + 0.06 * fray) * colW);
  float fing = fbm2(vec2(ac * 10.0 + uSeed, eta * 4.0));
  float edge = smoothstep(0.3 * ew, ew, 1.0 - aa + 0.3 * (fing - 0.45) * colW);
  vec2 dg = vec2(ac * 24.0 + uSeed, eta * 30.0), di = floor(dg);
  float drop = step(0.75, h21(di + uSeed)) * (1.0 - smoothstep(0.12, 0.32, length((fract(dg) - 0.5) * vec2(1.0, 0.7))));
  drop *= step(1.0 - aa, ew * 1.3) * (1.0 - edge) * colW;
  float bank = smoothstep(0.0, 0.38 + 0.15 * (fbm2(vec2(sign(ac) * 3.0 + eta * 0.2, 1.0)) - 0.5), 1.0 - aa);
  a *= mix(1.0, bank, riv);
  a = mix(a, max(a * edge, drop * 0.85), wall > 0.5 ? 0.0 : colW);
  col = mix(col, vec3(0.88, 0.92, 0.95), drop * (1.0 - edge) * colW);
  // the column's side walls: the same water seen from the side, in shade, soft where they meet the top
  if (wall > 0.5) { col *= 0.6; a = 0.95 * smoothstep(0.02, 0.3, vA.z + 0.15 * (fray - 0.5)) * smoothstep(-0.02, 0.15, z); }
  // the water front: from the gap's mouth just after the blast, and the flood front running down the river
  if (z > -1.0) a *= smoothstep(-0.15, 0.35, uFrontTau - tau + 0.4 * (P - 0.5));
  gl_FragColor = vec4(col * uLight * mix(1.0, 0.6, uNight), clamp(a, 0.0, 1.0) * uAmt);
}`;

/**
 * @param {object} shared uniforms shared with the dam water (uTime, uLight; damLight's uNight, uSky)
 * @param {{seed?:number}} [o]
 */
export function breachMaterial(shared, o = {}) {
  const m = new THREE.ShaderMaterial({
    name: 'dam_breach_flow', vertexShader: BREACH_VERT, fragmentShader: BREACH_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uTime: shared.uTime, uLight: shared.uLight, uNight: shared.uNight, uSky: shared.uSky,
      uAmt: { value: 0 }, uFrontTau: { value: -1 }, uMass: { value: 1 }, uSeed: { value: o.seed ?? 4.2 }, uBend: { value: -0.4 },
    },
  });
  m.userData.shared = false;
  return m;
}
