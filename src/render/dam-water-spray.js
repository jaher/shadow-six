/**
 * Spray and mist at the foot of the dam (render/dam-water.js), fully on the GPU: every particle is a stateless
 * billboard whose position is a closed-form function of (seed, time) — no per-frame CPU work besides a few uniforms.
 * Everything comes from the two spillway sheets' plunges only (the trickles are far too small to throw spray), so it
 * stays within ~5 m of them:
 * - impact cloud: big soft camera-facing puffs of white spray, 1-3 m tall, standing in front of the face along each
 *   sheet's impact line, pulsing and torn, drifting downwind — they hide the pool's contact line with the face;
 * - spray: fat short-lived clumps of white water and fine droplets thrown up and out on ballistic arcs, drawn as
 *   motion-blurred streaks along their on-screen velocity (fast, rising and falling: never read as the drifting snow);
 * - mist: a low veil hugging the face's foot either side of the plunge (dims the face and the walls' bases) and puffs
 *   rising off the boil and drifting downstream with the mission wind (world.wind), growing and thinning.
 * Droplets never shrink below ~1.5 px (their alpha is scaled down instead), so they do not sparkle when the camera pans.
 * @module render/dam-water-spray
 */
import * as THREE from 'three';

const VERT = /* glsl */`
attribute vec4 aSeed;   // random 0..1
attribute vec4 aSrc;    // xyz origin (world), w strength 0..1
uniform float uTime, uViewH, uMode;   // 0 spray, 1 mist, 2 impact cloud
uniform vec2 uDown, uWind; // world xz: downstream unit vector; smoothed wind (m/s)
varying vec2 vQ; varying float vA, vC; varying vec4 vS;
void main() {
  vQ = position.xy; vS = aSeed; vC = 0.0;
  vec2 side = vec2(-uDown.y, uDown.x);
  vec3 p = aSrc.xyz, vel = vec3(0.0); float size, a, life, t, age, stretch = 1.0;
  if (uMode > 1.5) {
    // impact cloud: a puff born at the impact line (spread over the sheet's width), swelling and rising slowly,
    // pushed out in front of the face and downwind; its alpha pulses with the plunge
    life = mix(1.4, 2.6, aSeed.y); t = fract(uTime / life + aSeed.x); age = t * life;
    p.xz += side * (aSeed.z - 0.5) * 1.6 + uDown * (0.25 + age * mix(0.5, 1.1, aSeed.w)) + uWind * 0.35 * age;
    p.y += mix(0.2, 0.9, aSeed.w) + age * mix(0.25, 0.6, aSeed.z);
    size = mix(1.1, 2.4, aSeed.w) * (0.55 + 0.6 * t);
    stretch = mix(1.0, 1.5, aSeed.z);                              // taller than wide
    a = mix(0.55, 0.85, aSeed.z) * aSrc.w * smoothstep(0.0, 0.12, t) * (1.0 - t) * (0.75 + 0.25 * sin(uTime * 7.3 + aSeed.x * 40.0));
    vC = 2.0;
  } else if (uMode > 0.5) {
    life = mix(5.0, 9.0, aSeed.y); t = fract(uTime / life + aSeed.x); age = t * life;
    if (aSeed.w < 0.5) {
      // the low veil along the face's foot either side of the plunge: hangs there, drifting out slowly
      p.xz += side * (aSeed.z - 0.5) * 11.0 + uDown * (0.3 + age * 0.12) + uWind * 0.15 * age;
      p.y += 0.3 + 0.9 * aSeed.w + age * 0.06;
      size = mix(2.6, 4.2, aSeed.z) * (1.0 + 0.5 * t);
      a = 0.06 * aSrc.w * smoothstep(0.0, 0.25, t) * (1.0 - t) * (1.0 - 0.5 * abs(aSeed.z - 0.5) * 2.0);
    } else {
      vec2 drift = uDown * mix(0.4, 1.0, aSeed.z) + side * (aSeed.w - 0.5) * 0.6 + uWind * 0.3;
      p.xz += drift * age + side * (aSeed.w - 0.5) * 2.5;
      p.y += 0.25 + age * mix(0.25, 0.55, aSeed.z) * aSrc.w;
      size = mix(2.0, 3.2, aSeed.w) * (1.0 + 1.5 * t) * (0.6 + 0.4 * aSrc.w);
      a = mix(0.05, 0.1, aSeed.z) * aSrc.w * smoothstep(0.0, 0.18, t) * (1.0 - t) * (1.0 - t);
    }
  } else {
    // fat, short-lived clumps of white water thrown off the impact line; fine droplets flung up and out on arcs
    vC = step(0.55, aSeed.w);
    life = vC > 0.5 ? mix(0.35, 0.8, aSeed.y) : mix(0.5, 1.1, aSeed.y);
    t = fract(uTime / life + aSeed.x); age = t * life;
    float g = vC > 0.5 ? 0.55 : 1.0;                       // clumps break into drag-held spray
    vec3 v0 = vC > 0.5 ? vec3(0.0, mix(0.8, 2.2, aSeed.z), 0.0) : vec3(0.0, mix(2.6, 5.2, aSeed.z), 0.0);
    v0.xz += vC > 0.5 ? uDown * mix(0.2, 1.2, aSeed.y) + side * (aSeed.w - 0.5) * 1.5 : uDown * mix(1.0, 3.2, aSeed.y) + side * (aSeed.w - 0.3) * 3.0;
    p.xz += side * (aSeed.z - 0.5) * 1.2;
    p += v0 * age + vec3(uWind.x, 0.0, uWind.y) * 0.25 * age * age;
    p.y -= 4.9 * age * age * g;
    vel = v0 + vec3(uWind.x, 0.0, uWind.y) * 0.5 * age - vec3(0.0, 9.81 * age * g, 0.0);
    size = vC > 0.5 ? mix(0.3, 0.6, aSeed.y) * (0.7 + 0.8 * t) : mix(0.04, 0.08, aSeed.y);
    a = (vC > 0.5 ? 0.42 * pow(1.0 - t, 1.5) : 0.7 * (1.0 - t * t)) * aSrc.w * smoothstep(-0.05, 0.1, p.y - aSrc.y);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float px = 2.0 / (projectionMatrix[1][1] * uViewH);       // metres per pixel (orthographic)
  float s2 = max(size, 1.6 * px);
  // a droplet is a motion-blurred streak along its on-screen velocity (~1/30 s of travel, up to 6x its width)
  vec2 sv = (modelViewMatrix * vec4(vel, 0.0)).xy; float blur = vC > 0.5 ? 0.0 : length(sv) / 30.0;
  vec2 ax = blur > s2 ? sv / length(sv) : vec2(0.0, 1.0); float sl = vC > 0.5 ? s2 * stretch : clamp(blur, s2, 6.0 * s2);
  vA = a * (size * size * stretch) / (s2 * sl);
  // (x axis = ax turned clockwise: a right-handed basis, so the quad stays front-facing; mirrored, it was culled)
  mv.xy += vec2(ax.y, -ax.x) * position.x * s2 + ax * position.y * sl;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
uniform float uLight, uFade, uNight, uMode, uTime;
varying vec2 vQ; varying float vA, vC; varying vec4 vS;
float h12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), f.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  float r = length(vQ) * 2.0;
  if (r > 1.0) discard;
  float a;
  vec3 c = vec3(0.97, 0.98, 1.0);
  if (vC > 1.5) {
    // impact cloud: a soft torn puff, churning (two octaves of noise scrolling up through it), densest low down
    vec2 q = vQ * 3.2 + vS.xy * 17.0;
    float n = vn(q + vec2(0.0, -uTime * 1.6)) * 0.6 + vn(q * 2.3 + vec2(1.7, -uTime * 2.9)) * 0.4;
    a = vA * smoothstep(1.0, 0.25, r + 0.45 * (n - 0.5)) * smoothstep(0.2, 0.65, n + 0.35 * (1.0 - r)) * (1.0 - 0.3 * (vQ.y + 0.5));
  } else if (uMode > 0.5 || vC > 0.5) {
    // soft puff / torn clump with a lumpy edge (no round blobs)
    float ang = atan(vQ.y, vQ.x), lump = 0.75 + 0.12 * sin(ang * 3.0 + vS.x * 20.0) + 0.1 * sin(ang * 5.0 + vS.y * 30.0);
    a = vA * smoothstep(lump, lump * (uMode > 0.5 ? 0.2 : 0.55), r);
  } else { a = vA * smoothstep(1.0, 0.35, r); c = vec3(0.86, 0.9, 0.93); }   // droplet: a translucent grey-blue streak
  c *= uLight * mix(1.0, 0.55, uNight);
  gl_FragColor = vec4(c * a * uFade, a * uFade);
}`;

const hash = (n) => { const x = Math.sin(n * 91.345 + 47.853) * 43758.5453; return x - Math.floor(x); };

/**
 * @param {{x:number, z:number, y:number, s:number}[]} src emitters (world; s = strength 0..1): the sheets' impact line
 * @param {[number, number]} down world xz downstream unit vector
 * @param {object} U shared uniforms (uTime, uLight, uFade, uNight)
 * @param {{spray?:number, mist?:number, cloud?:number}} [n] particle counts
 */
export function createDamSpray(src, down, U, n = {}) {
  const wind = { value: new THREE.Vector2() }, viewH = { value: 720 }, tot = src.reduce((a, q) => a + q.s, 0) || 1;
  const make = (count, mode) => {
    const quad = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
    g.setIndex(quad.index); g.setAttribute('position', quad.getAttribute('position'));
    const seed = new Float32Array(count * 4), at = new Float32Array(count * 4);
    for (let k = 0; k < count; k++) {
      for (let c = 0; c < 4; c++) seed[k * 4 + c] = hash(k * 4.17 + c * 1.31 + mode * 50);
      let r = hash(k * 7.7 + mode * 3) * tot, s = src[0];
      for (const q of src) { r -= q.s; if (r <= 0) { s = q; break; } }
      at.set([s.x, s.y, s.z, s.s], k * 4);
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.setAttribute('aSrc', new THREE.InstancedBufferAttribute(at, 4));
    g.instanceCount = count;
    quad.dispose();
    const m = new THREE.ShaderMaterial({
      name: ['dam_spray', 'dam_mist', 'dam_impact_cloud'][mode], vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      premultipliedAlpha: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { uTime: U.uTime, uLight: U.uLight, uFade: U.uFade, uNight: U.uNight, uViewH: viewH, uWind: wind,
        uDown: { value: new THREE.Vector2(down[0], down[1]) }, uMode: { value: mode } },
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false; mesh.name = ['dam-spray', 'dam-mist', 'dam-impact-cloud'][mode]; mesh.renderOrder = [4, 5, 4][mode];
    mesh.onBeforeRender = (r) => { viewH.value = r.getDrawingBufferSize(_v2).y || 720; };
    return mesh;
  };
  const meshes = [make(n.spray ?? 380, 0), make(n.mist ?? 64, 1), make(n.cloud ?? 44, 2)];
  return {
    meshes,
    /** Ease the drift towards the current wind (m/s, world xz). */
    setWind(x, z, dt) { const k = 1 - Math.exp(-dt / 2.5); wind.value.x += (x - wind.value.x) * k; wind.value.y += (z - wind.value.y) * k; },
    dispose() { for (const m of meshes) { m.geometry.dispose(); m.material.dispose(); } },
  };
}
const _v2 = new THREE.Vector2();
