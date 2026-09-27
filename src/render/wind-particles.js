/**
 * Wind-borne debris (step 4w): dry leaves tumbling and hopping along the ground (temperate / urban), sand streaks
 * snaking low over the desert floor, spindrift ribbons over snow and spray flecks on the coast — one instanced draw,
 * stateless on the GPU: every particle lives in a box around the view centre, advected by the INTEGRATED mean
 * mission wind (CPU, sim time → frozen while paused) plus the local gust deviation, and fades in only where the
 * WindField is strong enough to lift it (gust fronts visibly carry a wave of leaves/sand across the screen).
 * @module render/wind-particles
 */
import * as THREE from 'three';
import { WIND_GLSL, WIND_UNIFORMS } from '../world/wind.js';

/** Look per `blow` type: count per preset, size (m), colours, lift threshold (m/s), hop height, streak stretch. */
export const BLOW = {
  leaves: { n: { low: 400, medium: 900, high: 1400, ultra: 2000 }, size: [0.07, 0.12], cols: [0xa8803c, 0xc09a48, 0x8a6030, 0xa89a50], lift: 3.5, hop: 0.9, stretch: 1, rough: 0.9 },
  sand: { n: { low: 900, medium: 1800, high: 3000, ultra: 4200 }, size: [0.03, 0.05], cols: [0xc9a878, 0xd8bc8c, 0xb89868], lift: 4.5, hop: 0.35, stretch: 9, rough: 1 },
  snow: { n: { low: 600, medium: 1200, high: 2000, ultra: 2800 }, size: [0.03, 0.05], cols: [0xf2f5fa, 0xe6ecf4], lift: 5, hop: 0.5, stretch: 7, rough: 0.6 },
  spray: { n: { low: 200, medium: 400, high: 700, ultra: 1000 }, size: [0.02, 0.035], cols: [0xe8f0f2], lift: 8, hop: 1.2, stretch: 3, rough: 0.3 },
};

const PARS = WIND_GLSL + /* glsl */ `
attribute vec4 aSeed;      // x, z in [0,1), phase, size
attribute vec3 aCol;
uniform vec3 uOrigin; uniform vec3 uBox; uniform vec2 uOff; uniform float uLift, uHop, uStretch, uTimeW;
varying vec3 vPCol; varying float vPA;
`;
const MAIN = /* glsl */ `
float ph = aSeed.z * 6.2831;
vec2 q = aSeed.xy * uBox.xz + uOff * (0.75 + 0.5 * fract(aSeed.z * 7.13));
q = mod(q - uOrigin.xz, uBox.xz) + uOrigin.xz;
vec4 wS = windSample(q);
float sp = length(wS.xy);
vec2 wd = sp > 1e-3 ? wS.xy / sp : uWindA.xy;
q += (wS.xy - uWindA.xy * uWindA.z * uWindC.z) * 0.4;                  // gust swirl (bounded)
float lift = smoothstep(uLift, uLift * 1.9, sp);                          // only strong wind / gusts lift debris
float hop = abs(sin(uTimeW * (2.0 + 1.3 * fract(aSeed.z * 3.1)) + ph)) * uHop * (0.25 + lift);
vec3 c = vec3(q.x, uOrigin.y + 0.12 + hop, q.y);
// tumbling quad (leaves) or a ribbon stretched along the wind (sand, spindrift, spray)
float a = uTimeW * (3.0 + 5.0 * fract(aSeed.z * 5.7)) * (0.3 + lift) + ph;
vec3 ax = uStretch > 1.5 ? vec3(wd.x, 0.0, wd.y) * (1.0 + (uStretch - 1.0) * lift) : vec3(cos(a), 0.35 * sin(a * 0.7), sin(a));
vec3 ay = uStretch > 1.5 ? vec3(0.0, 1.0, 0.0) * 0.6 : normalize(cross(ax, vec3(sin(ph), 0.8, cos(ph))));
float s = aSeed.w;
vec3 wpT = c + ax * position.x * s + ay * position.y * s;
vec3 objectNormal = normalize(cross(ax, ay)); if (objectNormal.y < 0.0) objectNormal = -objectNormal;
vPCol = aCol;
vPA = lift * smoothstep(0.0, 0.08, min(min(q.x - uOrigin.x, uOrigin.x + uBox.x - q.x), min(q.y - uOrigin.z, uOrigin.z + uBox.z - q.y)) / uBox.x);
`;

/**
 * @param {THREE.Object3D} scene @param {string|null} blow BLOW key (WindField preset `blow`) @param {string} [preset]
 * @returns {{mesh:THREE.Mesh, update:(camera:THREE.Camera, groundY?:number)=>void, dispose:()=>void}|null}
 */
export function createWindParticles(scene, blow, preset = 'high') {
  const B = BLOW[blow];
  if (!B) return null;
  const n = B.n[preset] ?? B.n.high;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  let s = 12345;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const seed = new Float32Array(n * 4), col = new Float32Array(n * 3), cc = new THREE.Color();
  for (let i = 0; i < n; i++) {
    seed.set([r(), r(), r(), B.size[0] + (B.size[1] - B.size[0]) * r()], i * 4);
    cc.setHex(B.cols[(r() * B.cols.length) | 0]).convertSRGBToLinear().multiplyScalar(0.8 + 0.4 * r());
    col.set([cc.r, cc.g, cc.b], i * 3);
  }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  g.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));
  g.instanceCount = n;
  const U = {
    ...WIND_UNIFORMS, uOrigin: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(64, 1, 44) }, uOff: { value: new THREE.Vector2() },
    uLift: { value: B.lift }, uHop: { value: B.hop }, uStretch: { value: B.stretch }, uTimeW: { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({ roughness: B.rough, metalness: 0, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    // normals are needed before begin_vertex (defaultnormal_vertex): build the whole particle at beginnormal_vertex
    sh.vertexShader = PARS + sh.vertexShader.replace('#include <beginnormal_vertex>', MAIN).replace('#include <begin_vertex>', 'vec3 transformed = wpT;');
    sh.fragmentShader = 'varying vec3 vPCol; varying float vPA;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vPCol; diffuseColor.a *= vPA; if (vPA < 0.01) discard;');
  };
  mat.customProgramCacheKey = () => 'windParticles1';
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.name = 'windParticles'; mesh.renderOrder = 4;
  scene.add(mesh);
  const dir = new THREE.Vector3(), tgt = new THREE.Vector3();
  let lastT = null;
  return {
    mesh, blow, count: n,
    /** Per displayed frame: follow the view centre, integrate the mean wind over sim time. */
    update(camera, groundY = 0) {
      const A = WIND_UNIFORMS.uWindA.value, env = WIND_UNIFORMS.uWindC.value[2] || 1;
      const dt = lastT == null ? 0 : Math.min(0.5, Math.max(0, A[3] - lastT));
      lastT = A[3];
      U.uOff.value.x += A[0] * A[2] * env * dt; U.uOff.value.y += A[1] * A[2] * env * dt;
      U.uTimeW.value = A[3];
      if (!camera) return;
      camera.getWorldDirection(dir);
      const k = camera.position.y / Math.max(0.1, -dir.y);
      tgt.copy(camera.position).addScaledVector(dir, k);
      const Bx = U.uBox.value;
      U.uOrigin.value.set(tgt.x - Bx.x / 2, groundY, tgt.z - Bx.z / 2);
      mesh.visible = A[2] * (1 + 1.5 * WIND_UNIFORMS.uWindB.value[0]) > B.lift; // gust peaks can lift it (never in a calm)
    },
    dispose() { scene.remove(mesh); g.dispose(); mat.dispose(); },
  };
}
