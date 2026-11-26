/**
 * LIGHTS OUT e07 "White Out": the map's ground snow laid on the snow that stands up off the ground — the ledge pillows
 * on the ridge face, the drift and the sluff fans at its foot, the snow plastered on the rock's toe. The ground material
 * (art/terrain/terrain.js terrainMaterial: master's snow) reads its layers, its noise and its glints on world x/z, the
 * ground's own plane: on a steep face that projection stretches down the slope (the fur of the snow smeared into flat
 * grey streaks, a pillow's front a featureless band). This variant reads them on the surface's own coordinates
 * instead — the `uv` the kit lays on those meshes (e07-kit faceSnow: metres along the snow's section and along the face,
 * equal to world x/z where the snow lies flat on the ground, so the two meet with no seam) — with the tangent frame taken
 * from those coordinates (the screen-space derivatives of the position and the uv), so the snow's relief and its
 * sastrugi lie along the surface. The splat (which layer: snow) and the trails (prints, ruts) are still read where the
 * point stands (world x/z): the snow keeps the ground's look and what the walkers leave on it. And where it stands steep
 * in the wall's shade its light wraps round towards the sun (snow is translucent): the same tone as the snowfield.
 * Each corner carries its own light terms besides (the `aE07` attribute the kit lays: [ao, shade, wrap] — its sky
 * occlusion, a bluish darkening of its albedo, how far its light wraps; [1, 0, 1] is the snow as the ground draws it): a
 * ledge pillow's lit top over its shaded lip and underside, each pillow its own tone, the drift's foot coming into the
 * steep snow's light by turns, a clod's underside in its own shade. Every mesh drawn with this material carries it.
 * Visual only; its own program (key `terrainB|e07unfold`), built and warmed with the art (groundMaterialOnRidge).
 * @module art/e07-snow
 */
import { terrainMaterial } from './terrain/terrain.js';

/** The ground material's anchors this variant rewrites (art/terrain/terrain-glsl.js FRAG_MAIN / VERT_*). */
export const UNFOLD_ANCHORS = {
  tuv: 'vec2 tuv = (vWPos.xz - uOrigin) * uMap.zw;',
  p: 'vec2 p = vec2(vWPos.x, -vWPos.z);',
  frame: 'vec3 Tg = normalize(vec3(1.0, 0.0, 0.0) - Ng * Ng.x);\nvec3 Bg = cross(Ng, Tg);',
  sastrugi: 'nW = normalize(nW - vec3(gw.x, 0.0, gw.y) * snowF);',
  out: 'vec3 tbNw = nW;',
  albedo: 'diffuseColor.rgb = albT;',
  world: 'vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
};

/**
 * Rewrite a compiled ground shader (the terrain material's onBeforeCompile output) to read its look on the unfolded
 * coordinates: `vUnf` = uv × `tile` (the castle kit's uv is metres / the finish's tile). Throws when an anchor is missing
 * (master's ground shader changed: the variant has to follow it — tests/unit/e07-snow.test.mjs checks the anchors).
 * @param {{vertexShader:string, fragmentShader:string}} sh @param {number} tile @returns {typeof sh}
 */
export function unfoldShader(sh, tile) {
  const need = (src, a, what) => { if (!src.includes(a)) throw new Error(`e07 unfolded snow: the ground shader has no ${what} anchor`); };
  need(sh.vertexShader, UNFOLD_ANCHORS.world, 'world position');
  for (const k of ['tuv', 'p', 'frame', 'sastrugi', 'out', 'albedo']) need(sh.fragmentShader, UNFOLD_ANCHORS[k], k);
  sh.vertexShader = 'varying vec2 vUnf;\nattribute vec3 aE07;\nvarying vec3 vE07;\n'
    + sh.vertexShader.replace(UNFOLD_ANCHORS.world, `${UNFOLD_ANCHORS.world}\nvUnf = uv * ${tile.toFixed(6)};\nvE07 = aE07;`);
  let f = sh.fragmentShader;
  // (the splat and trail lookups stay on the point's world x/z: set aside, then every other world x/z read moves)
  f = f.replace(UNFOLD_ANCHORS.tuv, '@@TUV@@');
  f = f.replace(UNFOLD_ANCHORS.p, 'vec2 p = vec2(vUnf.x, -vUnf.y);');
  f = f.split('vWPos.xz').join('vUnf');
  f = f.replace('@@TUV@@', UNFOLD_ANCHORS.tuv);
  // the tangent frame along the unfolded coordinates (p.x and p.y's directions on the surface: on flat ground +x and -z,
  // the ground's own frame), from the screen-space derivatives; the geometric normal's frame where they vanish
  f = f.replace(UNFOLD_ANCHORS.frame, `vec3 Tg, Bg;
{
  vec3 dqx = dFdx(vWPos), dqy = dFdy(vWPos);
  vec3 c2 = cross(dqy, Ng), c1 = cross(Ng, dqx);
  vec3 t = c2 * pdx.x + c1 * pdy.x, b = c2 * pdx.y + c1 * pdy.y;
  float m = max(dot(t, t), dot(b, b));
  if (m > 1e-24) { float k = inversesqrt(m); Tg = t * k; Bg = b * k; }
  else { Tg = normalize(abs(Ng.y) < 0.95 ? cross(vec3(0.0, 1.0, 0.0), Ng) : vec3(1.0, 0.0, 0.0) - Ng * Ng.x); Bg = cross(Ng, Tg); }
}`);
  // (the sastrugi's gradient is in the unfolded x/z: along the frame, not along world x/z)
  f = f.replace(UNFOLD_ANCHORS.sastrugi, 'nW = normalize(nW - (Tg * gw.x - Bg * gw.y) * snowF);');
  // steep snow in the wall's shade (a fan's slope, a pillow's front, the snow plastered on the toe: they face west, the
  // morning sun is behind the ridge): its light wrapped round towards the sun as it is through snow — translucent, lit
  // from the snowfield in front. The broad normal is turned towards the sun until it takes most of the light a level
  // snowfield takes (85 % of the way from its own, × the surface's own wrap term: the kit's `aE07` light terms — a
  // pillow's top and underside keep their own light, its front is a little wrapped; the drift's foot comes into it by
  // turns), and the surface's detail (the snow's grain, its sastrugi: the full normal less the broad one) is laid back
  // on the turned normal, a little stronger, so it still plays in that light. Nothing changes where it lies within 6° of
  // level (the aprons meet the ground's own shading). Then the surface's own sky occlusion (the kit's ao term: a
  // pillow's lip and underside in its own shade, a clod's underside against the snow) on the ground's own AO
  f = f.replace(UNFOLD_ANCHORS.out, `{
  vec3 sL = normalize(uSunDirW);
  float sC = dot(Ng, sL), sS = uE07Wrap * vE07.z * (1.0 - smoothstep(0.95, 0.995, Ng.y)), sT = mix(sC, max(sL.y, 0.0), sS);
  if (sT > sC + 1e-4) {
    float sK = max(0.0, -sC + sT * sqrt(max(0.0, 1.0 - sC * sC) / max(1e-4, 1.0 - sT * sT)));
    vec3 sN = normalize(Ng + sL * sK);
    nW = normalize(sN + (nW - Ng) * (1.0 + 0.8 * sS + 1.2 * sS * (1.0 - smoothstep(0.1, 0.5, abs(Ng.y)))));
  }
  tbAO *= vE07.x;
}
${UNFOLD_ANCHORS.out}`);
  // (and on steep snow a faint grain of its own in the albedo, a few centimetres to a few decimetres across: the wrapped
  // light turns the surface's relief less than the low sun does on the level snowfield; then the surface's own shade
  // term: a bluish darkening — the wind scoop's tint carried up the drift's foot, a pillow's own tone — or, below 0, a
  // shade lighter)
  f = f.replace(UNFOLD_ANCHORS.albedo, `albT *= 1.0 + uE07Wrap * vE07.z * (1.0 - smoothstep(0.7, 0.97, Ng.y)) * (0.14 * (tbNz(vUnf, 0.9).g - 0.5) + 0.1 * (tbNz(vUnf + 0.37, 0.31).b - 0.5));
albT *= vec3(1.0 - 0.9 * vE07.y, 1.0 - 0.68 * vE07.y, 1.0 - 0.32 * vE07.y);
${UNFOLD_ANCHORS.albedo}`);
  sh.fragmentShader = 'varying vec2 vUnf;\nvarying vec3 vE07;\nuniform float uE07Wrap;\n' + f;
  return sh;
}

/**
 * The ground material over the unfolded coordinates: the terrain's uniforms (shared: the same splat, trails, sun), its
 * own program. `tile`: the uv's metres per unit (castle-kit CASTLE_SETS[finish][3]); `wrap` 0…1: how far steep snow's
 * light is wrapped towards a level snowfield's (the chunks of debris less, so their faces still turn from the light).
 * @param {object} U the terrain's uniforms (world.terrain.terrain.uniforms) @param {number} tile @param {number} [wrap]
 */
export function unfoldedGroundMaterial(U, tile, wrap = 0.85) {
  const m = terrainMaterial(U, 'terrainB|e07unfold'), W = { value: wrap };
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => { base.call(m, sh, r); sh.uniforms.uE07Wrap = W; unfoldShader(sh, tile); };
  m.userData.wrap = W;
  m.name = 'e07:unfolded_snow';
  return m;
}
