// Copied from scratchpad chars/commandos_b/pipeline/web/squad_face.js by tools/characters/consolidate/copy_runtime.py (imports/URLs rewritten; moved to src/art/characters in art integration 2). CC0 project code.
// squad_face.js - close-zoom face/helmet fixes applied at spawn time (no GLB rebuild).
//  * moustacheParams(geom, info): finds the baked moustache shell in the atlas mesh (cloth-class verts on the upper lip,
//    in rest space) and returns its extent; moustacheChunk() clips that shell to a smooth trimmed brush outline with a
//    hair-strand fringe (alpha dither) and strand shading, replacing the stair-stepped triangle outline and the flat
//    painted look. The shell also no longer receives the tunic tint (it is 'cloth' class in the bake mask).
//  * helmetMaterial(mesh, tint): M35 paint as a smooth procedural coat (+25 % of the baked detail) instead of the baked
//    dark, torn-edged band on the skirt; soft height AO toward the rim, dark liner on the inside faces.
import * as THREE from 'three';

const cache = new WeakMap();
export function moustacheParams(geom, info) {
  if (cache.has(geom)) return cache.get(geom);
  let out = null;
  const P = geom.attributes.position, M = geom.attributes._mask;
  if (P && M && info && info.eyeL) {
    const ey = info.eyeL[2], ez = -info.eyeL[1];
    let n = 0, top = -1, bot = 1, hw = 0;
    for (let i = 0; i < P.count; i++) {
      if (M.getY(i) < 0.5) continue;
      const x = P.getX(i), y = P.getY(i) - ey, z = P.getZ(i) - ez;
      if (z <= 0 || Math.abs(x) > 0.045 || y < -0.09 || y > -0.025) continue;
      n++; top = Math.max(top, y); bot = Math.min(bot, y); hw = Math.max(hw, Math.abs(x));
    }
    if (n > 40) out = new THREE.Vector4(ey, ez, top, bot);   // dy of shell top (under the nose) and bottom (mouth corners)
  }
  cache.set(geom, out);
  return out;
}

// GLSL: call after color_fragment; needs varying vS6P (rest-space position) and uniform vec4 s6Must and float s6MustOn
export const MUST_DECL = 'uniform vec4 s6Must; uniform float s6MustOn; varying vec3 vS6P;\n' +
  'float s6h(float x){ return fract(sin(x * 127.1) * 43758.5453); }\n';
export const MUST_FRAG = `
  float s6MustK = 0.0;
  if (s6MustOn > 0.5 && vS6Mask.y > 0.5) {
    vec3 q = vS6P - vec3(0.0, s6Must.x, s6Must.y);
    if (q.z > 0.0 && abs(q.x) < 0.046 && q.y < s6Must.z + 0.004 && q.y > s6Must.w - 0.006) {
      float top = s6Must.z, bot = s6Must.w;                      // shell extent (dy)
      float hgt = top - bot;
      float ax = abs(q.x);
      float t = clamp((q.y - bot) / hgt, 0.0, 1.0);
      // trimmed brush: full mouth width at the lip line, narrowing to the nostrils; rounded top shoulders;
      // the droop to the mouth corners ends in a short rounded tip instead of a bat-wing point
      float hwk = mix(0.031, 0.021, t * t);
      float topk = top - 0.004 - 0.010 * pow(ax / 0.03, 2.0);
      float botk = bot + 0.004 + 0.006 * smoothstep(0.012, 0.031, ax) - 0.004 * (1.0 - smoothstep(0.0, 0.02, ax));
      float d = min(min(hwk - ax, topk - q.y), q.y - botk);     // signed distance inside (m)
      // hair strands fan out from the philtrum and grow down: strand coordinate across, jitter along
      float ang = q.x / 0.03 * 0.55;
      float sc = q.x * cos(ang) - (q.y - top) * sin(ang);
      float id = floor(sc * 1500.0);
      float nz = s6h(id) * 0.75 + s6h(floor((q.y - top) * 900.0) + id * 3.1) * 0.25;
      float cover = clamp(d / 0.0045, 0.0, 1.0);
      if (cover < nz * 0.95 + 0.02) discard;
      s6MustK = 1.0;
      diffuseColor.rgb *= 0.8 + 0.5 * s6h(id + 17.0) - 0.15 * (1.0 - cover);
    }
  }`;

// The baked shell's inner (liner) surface pokes out through the flared skirt at the front/sides: seen as a dark,
// torn-edged band under the paint (back faces). Pull the inward-facing liner walls 9 mm toward the helmet axis
// (once per shared geometry) so the painted outer skirt is what shows.
function sinkLiner(geom) {
  if (geom.userData.s6liner) return geom.userData.s6liner; geom.computeBoundingBox();
  const bb = geom.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  const P = geom.attributes.position, N = geom.attributes.normal; let n = 0;
  for (let i = 0; i < P.count; i++) {
    const rx = P.getX(i) - cx, rz = P.getZ(i) - cz, nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i);
    const inward = nx * rx + nz * rz < 0 && Math.abs(ny) < 0.85;   // liner walls only, not the rim lip (normals down)
    if (!inward) continue;
    const rl = Math.hypot(rx, rz) || 1;                               // straight toward the helmet axis: keeps the rim line
    P.setXYZ(i, P.getX(i) - rx / rl * 0.006, P.getY(i), P.getZ(i) - rz / rl * 0.006); n++;
  }
  P.needsUpdate = true; geom.computeBoundingSphere(); geom.userData.s6liner = n;
  return n;
}

export function helmetMaterial(mesh, tint) {
  if ((globalThis.__args || {}).hgDbg !== 'nosink') sinkLiner(mesh.geometry);
  const base = mesh.userData.s6base || mesh.material; mesh.userData.s6base = base;
  const m = base.clone();
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  const paint = new THREE.Color(0x5a5d50).multiply(new THREE.Color(...tint));
  m.color.setRGB(1, 1, 1);
  const dbg = (globalThis.__args || {}).hgDbg;
  if (dbg === 'nonm') m.normalMap = null;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.s6Paint = { value: paint }; sh.uniforms.s6Rim = { value: new THREE.Vector2(bb.min.y, bb.max.y) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vS6P;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvS6P = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 s6Paint; uniform vec2 s6Rim; varying vec3 vS6P;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        { vec3 det = clamp(diffuseColor.rgb / max(s6Paint, vec3(1e-3)), 0.6, 1.4);
          float h = clamp((vS6P.y - s6Rim.x) / (s6Rim.y - s6Rim.x), 0.0, 1.0);
          float ao = mix(0.84, 1.0, smoothstep(0.0, 0.35, h));
          vec3 c = s6Paint * mix(vec3(1.0), det, 0.25) * ao;
          diffuseColor.rgb = gl_FrontFacing ? c : c * 0.88; }   // liner faces that still show are lit through the flipped normal like the shell`);
    if (dbg === 'nrm') sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight = normal * 0.5 + 0.5;\n#include <opaque_fragment>');
    if (dbg === 'ff') sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight = gl_FrontFacing ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 's6helmet';
  mesh.material = m;
}
