/**
 * Shader of the burst dam's torrent (render/dam-breach.js): ONE flow-aligned surface from the reservoir to the pool
 * plus the jet's two side walls, all drawn on the late FX layer. The pattern is advected in TRAVEL TIME (`flow.y` = the
 * seconds a parcel takes from the funnel's rim to that row, from the flow's own speed profile), so it crawls on the
 * reservoir, races through the slot and stretches down the fall like real water. Zones (`aux.x`):
 * - funnel  (-2 … -1, rim → mouth): the reservoir drawn towards the breach: converging flow lines (scum / slush
 *   streaks) and glints, the wind chop smoothed into a glassy slick near the mouth; fades out at the rim;
 * - slot    (-1 … 0, mouth → lip): fast glassy water, streamwise striations, the bright bend where the surface starts
 *   to drop, white water torn off the cheeks and round the hanging pier stubs, standing cross waves;
 * - lip     (≈ 0): the surface breaks up — a churning white band;
 * - nappe   (0 … 1, lip → landing; > 1 under the pool): a thick aerated column, streaked by the fall, glassy green
 *   windows in its core near the top, frayed edges shedding droplets, an opaque white crown where it lands;
 * - walls   (`aux.y` = 1): the jet's flanks, churned white water from its edge down into the pool.
 * `uMass` (0.6 … 1.4) = the discharge relative to the full head: more white water, more opaque.
 * @module render/dam-breach-glsl
 */
import * as THREE from 'three';

export const BREACH_VERT = /* glsl */`
attribute vec2 flow;   // x: across (-1 … 1), y: travel time from the funnel's rim (s)
attribute vec3 aux;    // x: zone coordinate, y: 1 on the jet's side walls, z: down the wall (0 top … 1 bottom)
varying vec2 vF; varying vec3 vA; varying vec3 vW;
void main() {
  vF = flow; vA = aux;
  vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const NOISE = /* glsl */`
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float fbm2(vec2 p) { return 0.6 * vnoise(p) + 0.4 * vnoise(p * 2.07 + 7.3); }
`;

export const BREACH_FRAG = /* glsl */`
uniform float uTime, uAmt, uLight, uNight, uFront, uMass, uSeed, uBend;
uniform vec3 uSky;
varying vec2 vF; varying vec3 vA; varying vec3 vW;
${NOISE}
void main() {
  float z = vA.x, ac = vF.x, tau = vF.y, eta = tau - uTime, aa = abs(ac);
  // (linear values, tone-mapped afterwards: \`lake\` matches the reservoir's surface on screen)
  vec3 lake = vec3(0.026, 0.062, 0.105), glass = vec3(0.016, 0.04, 0.06), sheen = vec3(0.2, 0.26, 0.32);
  vec3 white = vec3(0.9, 0.94, 0.97), trough = vec3(0.2, 0.26, 0.3), grey = vec3(0.4, 0.46, 0.5);
  vec3 col; float a;
  if (vA.y > 0.5) {
    // the jet's flanks: churned white water carried out and down, in the shade of the column, soft along the top
    float d = vA.z;
    float n = fbm(vec2(ac * 3.0 + eta * 6.0 + uSeed, d * 2.0 - uTime * 1.5)), n2 = vnoise(vec2(eta * 22.0 + ac, d * 4.0 - uTime * 4.0));
    col = mix(trough * 0.8, white, smoothstep(0.3, 0.72, 0.6 * n + 0.4 * n2)) * mix(0.72, 0.5, d);
    a = 0.95 * smoothstep(0.02, 0.22, d + 0.15 * (n - 0.5)) * smoothstep(-0.05, 0.2, z);
  } else if (z < -1.0) {
    // FUNNEL on the reservoir: flow lines along the streamlines, converging on the mouth and racing in, the chop
    // smoothed into a dark glassy slick near it; fades out at the rim
    float fr = clamp(-1.0 - z, 0.0, 1.0);                        // 0 at the mouth … 1 at the rim
    // (the lines meander where the water is slow, out on the lake, and are pulled straight as it speeds up)
    float acw = ac + 0.12 * fr * (fbm2(vec2(ac * 3.0 + uSeed, eta * 0.12)) - 0.5);
    float sn = vnoise(vec2(acw * 16.0 + uSeed, eta * 0.07)), sn2 = vnoise(vec2(acw * 31.0 + uSeed * 1.9, eta * 0.12 + 3.0));
    float dash = smoothstep(0.4, 0.85, vnoise(vec2(ac * 6.0 + 2.0, eta * 1.1)));
    float ln = max(smoothstep(0.05, 0.0, abs(sn - 0.5)), 0.6 * smoothstep(0.035, 0.0, abs(sn2 - 0.5))) * dash;
    float slick = 1.0 - smoothstep(0.0, 0.45, fr);
    float gl = smoothstep(0.7, 0.92, vnoise(vec2(ac * 20.0 + uSeed, eta * 0.5))) * slick;   // long glossy streaks
    col = mix(lake, glass, 0.65 * slick) + sheen * gl * 0.3;
    col = mix(col, vec3(0.32, 0.39, 0.45), ln * (0.2 + 0.4 * (1.0 - fr)));
    a = (0.97 * pow(1.0 - fr, 1.5) + 0.5 * ln + 0.15 * gl) * smoothstep(1.0, 0.6, fr) * smoothstep(1.0, 0.8, aa);
  } else if (z < 0.0) {
    // SLOT: the slick races through the gap, bends down past where the reservoir's own water ends and tears into white
    // water off the cheeks and round the pier stubs hanging into it
    float zs = z + 1.0, after = smoothstep(uBend - 0.05, uBend + 0.35, zs);
    float stri = fbm(vec2(ac * 9.0 + uSeed, eta * 0.7));
    float gl = smoothstep(0.7, 0.92, vnoise(vec2(ac * 20.0 + uSeed, eta * 0.5)));   // (the funnel's glossy streaks, on)
    col = mix(glass, glass * 0.7, after) * (0.85 + 0.3 * stri) + sheen * gl * mix(0.3, 0.45, after);
    col += sheen * 0.3 * exp(-pow((zs - uBend) / 0.06, 2.0));    // the sheen line where the surface bends over
    float n = fbm(vec2(ac * 7.0 + uSeed, eta * 2.2)), cl = fbm(vec2(ac * 15.0 + uSeed * 1.3, eta * 5.0));
    // (white water torn off the cheeks and either side of the central pier stub from where they meet the current,
    // foam streaks drawn out along the flow between them)
    float cheek = smoothstep(0.62, 0.95, aa + 0.3 * (n - 0.5)) * mix(0.55, 1.0, smoothstep(uBend - 0.2, 0.75, zs)) * smoothstep(0.1, 0.3, zs);
    float pillow = smoothstep(0.24, 0.05, aa + 0.08 * (n - 0.5)) * exp(-pow((zs - 0.21) / 0.05, 2.0));
    float wake = smoothstep(0.14 + 0.5 * max(zs - 0.22, 0.0), 0.02, aa + 0.15 * (n - 0.5)) * smoothstep(0.2, 0.3, zs);
    float fs = smoothstep(0.05, 0.0, abs(vnoise(vec2(ac * 22.0 + uSeed, eta * 0.25)) - 0.5)) * smoothstep(0.4, 0.8, vnoise(vec2(ac * 7.0, eta * 1.6)));
    col = mix(col, grey, 0.6 * fs * smoothstep(0.05, 0.3, zs));
    float side = smoothstep(0.24, 0.04, abs(aa - 0.77) + 0.12 * (n - 0.5)) * smoothstep(0.6, 0.74, zs);
    float torn = smoothstep(0.55, 0.8, n + 0.5 * smoothstep(uBend + 0.08, 0.9, zs)) * after;   // the drop tears it up
    float aer = clamp(max(max(cheek, max(pillow, wake)), max(side, torn)), 0.0, 1.0) * (0.6 + 0.4 * uMass);
    aer *= smoothstep(0.2, 0.55, cl + 0.4 * aer);
    col = mix(col, mix(grey, white, smoothstep(0.3, 0.7, cl)), aer);
    a = 1.0;
  } else {
    // NAPPE: the column leaving the lip — aerated white water streaked by the fall over grey troughs, glassy windows in
    // its core near the top, frayed edges shedding droplets, a white crown where it lands
    float st = 1.0 + 3.0 * z;                                     // how far the fall has stretched the features
    float streak = fbm(vec2(ac * 13.0 + uSeed, eta * 0.9 / st));
    float clump = fbm(vec2(ac * 5.0 + uSeed * 1.7, eta * 3.5 / sqrt(st))) + 0.35 * (vnoise(vec2(ac * 40.0 + uSeed, eta * 10.0 / st)) - 0.5);
    col = mix(trough * 0.8, white, smoothstep(0.3, 0.64 - 0.05 * uMass, 0.65 * streak + 0.35 * clump));
    float win = (1.0 - smoothstep(0.05, 0.3 + 0.15 * uMass, z)) * smoothstep(0.56, 0.74, fbm(vec2(ac * 6.0 + uSeed, eta * 0.8 / st)));
    col = mix(col, glass + sheen * 0.3 * fbm2(vec2(ac * 8.0, eta * 1.6)), win * 0.7);
    col *= mix(1.0, 0.82, smoothstep(0.3, 0.85, z));             // the lower column in its own spray's shade
    float crown = smoothstep(0.84, 0.98, z + 0.12 * (fbm(vec2(ac * 7.0 + uSeed, eta * 2.0)) - 0.5));
    col = mix(col, white, crown);
    float fray = fbm(vec2(ac * 5.0 + uSeed, eta * 3.1)), ew = 0.09 + 0.16 * smoothstep(0.0, 0.6, z) + 0.08 * fray;
    float fing = fbm(vec2(ac * 10.0 + uSeed, eta * 4.0 / sqrt(st)));
    float edge = smoothstep(0.3 * ew, ew, 1.0 - aa + 0.35 * (fing - 0.45) * smoothstep(0.05, 0.4, z));
    vec2 dg = vec2(ac * 24.0 + uSeed, eta * 30.0), di = floor(dg);
    float drop = step(0.75, h21(di + uSeed)) * (1.0 - smoothstep(0.12, 0.32, length((fract(dg) - 0.5) * vec2(1.0, 0.7))));
    drop *= step(1.0 - aa, ew * 1.3) * (1.0 - edge) * smoothstep(0.05, 0.3, z);
    a = max(edge * mix(0.97, 1.0, crown), drop * 0.85);
    col = mix(col, vec3(0.88, 0.92, 0.95), drop * (1.0 - edge));
  }
  // the lip: the surface breaks up into a churning white band either side of the edge
  if (vA.y < 0.5 && z > -0.25 && z < 0.3) {
    float churn = fbm(vec2(ac * 11.0 + uTime * 0.6, eta * 8.0));
    float lip = exp(-pow((z - 0.1 * (fbm2(vec2(ac * 6.0 + uSeed, uTime * 0.8)) - 0.5)) / 0.08, 2.0));   // (a ragged edge)
    col = mix(col, white * (0.86 + 0.14 * churn), lip * smoothstep(0.3, 0.55, churn + 0.15 + 0.1 * uMass));
  }
  // the water front racing from the mouth to the pool just after the blast (the funnel starts moving at once)
  if (z > -1.0) a *= smoothstep(uFront + 0.04, uFront - 0.12, z);
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
      uAmt: { value: 0 }, uFront: { value: -1 }, uMass: { value: 1 }, uSeed: { value: o.seed ?? 4.2 }, uBend: { value: 0.3 },
    },
  });
  m.userData.shared = false;
  return m;
}
