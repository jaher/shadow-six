/**
 * Burnt look of a blown-up structure that keeps its own model (user: "The Leopold train should look more realistic
 * when burning. It looks like a flat black rectangle"): every material of the wreck swapped for a CHARRED copy of
 * itself — its textures, normal map, vertex colours and baked AO kept, so edges, rivets, seams and grain still read —
 * which a fragment-shader layer burns according to how hot the fire was there:
 *  - steel: paint scorched brown-black in patches, blistered and peeled to bare grey metal, heat (temper) colours —
 *    straw, bronze, purple, blue — on the bare metal nearest the fire, rust-orange blooms, soot runs climbing from the
 *    fire, grey ash on the upward faces; soot matte, bare metal a little shiny (roughness / metalness per layer);
 *  - timber: browned, then alligatored charcoal with grey ash on the ridges;
 *  - masonry (stone, brick, concrete, plaster): soot stains climbing from the fire, heat-reddened near it;
 *  - canvas: charred black-brown; glass: smoked dark.
 * How hot: world-space HOT SPOTS (the blast point, the fire), registered when the structure is destroyed in one shared
 * table every charred material reads (`addCharSpots`): a charred material is cached per SOURCE material and shared by
 * every wreck drawing it — never a material per mesh, never one per blast — and a new wreck only writes a few floats.
 * Its programs are compiled at load (`charWarmClone`: a staged copy drawn by the loading screen's warm-up frame).
 * Deterministic: the patches are value noise over world space; nothing here is random.
 * @module art/wreck-char
 */

import * as THREE from 'three';

/** Hot spots at most (a mission's wrecks: the K5's fire takes 6, a building 2). */
export const CHAR_SPOTS = 24;

// the shared table: per spot A = (x, ground y, z, radius), B = (heat 0..1, centre height above the ground, upward
// stretch of the soot (< 1: it climbs), soot film 0..1); N spots in use. The uniform objects themselves are shared by
// every charred material's shader: writing a value here reaches them all at their next draw (no recompile).
const U = {
  a: { value: Array.from({ length: CHAR_SPOTS }, () => new THREE.Vector4(0, -1e4, 0, 1e-3)) },
  b: { value: Array.from({ length: CHAR_SPOTS }, () => new THREE.Vector4(0, 0, 1, 0)) },
  // C = (height of the structure above its ground, gutted 0..1: a burnt-out building — heat over its whole footprint,
  // heaviest up its walls and on its roof)
  c: { value: Array.from({ length: CHAR_SPOTS }, () => new THREE.Vector4(1, 0, 0, 0)) },
  n: { value: 0 },
};
let owner = null; // the world the table belongs to (a new mission starts it empty)

/** Empty the table (a mission load; tests). */
export function resetCharSpots(world = null) {
  owner = world;
  U.n.value = 0;
  for (const v of U.a.value) v.set(0, -1e4, 0, 1e-3);
  for (const v of U.b.value) v.set(0, 0, 1, 0);
  for (const v of U.c.value) v.set(1, 0, 0, 0);
}

/**
 * Register hot spots (world space) for `world`'s wrecks: [{x, y (ground), z, r, heat?, h? (centre above the ground),
 * up? (soot climb stretch), film?}]. Past CHAR_SPOTS the oldest spots are dropped (their wreck keeps a soot film only
 * from its own others). @returns {number} spots in use
 */
export function addCharSpots(world, spots) {
  if (owner !== world) resetCharSpots(world);
  for (const s of spots || []) {
    if (!Number.isFinite(s?.x) || !Number.isFinite(s?.z)) continue;
    if (U.n.value >= CHAR_SPOTS) { // drop the oldest
      U.a.value.push(U.a.value.shift()); U.b.value.push(U.b.value.shift()); U.c.value.push(U.c.value.shift()); U.n.value--;
    }
    const k = U.n.value++;
    U.a.value[k].set(s.x, s.y ?? 0, s.z, Math.max(0.5, s.r ?? 4));
    U.b.value[k].set(s.heat ?? 1, s.h ?? 1, s.up ?? 0.6, s.film ?? 0.5);
    U.c.value[k].set(Math.max(0.5, s.top ?? 1), s.gutted ?? 0, 0, 0);
  }
  return U.n.value;
}

/** The spots registered now (tests / look-dev). */
export function charSpots() {
  return U.a.value.slice(0, U.n.value).map((a, k) => ({ x: a.x, y: a.y, z: a.z, r: a.w, heat: U.b.value[k].x, h: U.b.value[k].y, up: U.b.value[k].z, film: U.b.value[k].w, top: U.c.value[k].x, gutted: U.c.value[k].y }));
}

/** What a material is made of, from its name (library kit / vehicle / dressing names), else its metalness. */
export function charKind(m) {
  const n = String(m?.name || '').toLowerCase();
  if (/snow|slush/.test(n)) return 'snow';
  if (/glass|window|lens|pane\b/.test(n)) return 'glass';
  if (/rubber|tyre|tire/.test(n)) return 'rubber';
  if (/pole|mast|warship|hull|ship|rail|rivet|steel|iron|metal|corrug|zinc|\btin\b|grating|armou?r|brass|copper|alu|gun|barrel|pipe|tank|veh:/.test(n)) return 'steel';
  if (/canvas|tarp|cloth|fabric|tent|zeltbahn|flag|banner|net\b/.test(n)) return 'fabric';
  if (/timber|wood|\blogs?\b|log_|plank|board|thatch|shingle|bark|creosote|crate|beam|joist|door|shutter/.test(n)) return 'wood';
  if (/stone|brick|concrete|plaster|render|stucco|mortar|tile|slate|cement|rock|masonry|sandbag|asphalt|tar|screed|loggia|arcade|ashlar/.test(n)) return 'masonry';
  if (/paint/.test(n)) return 'steel';
  // (a metalness map's material carries metalness 1 as the map's multiplier: no hint of what it is)
  return !m?.metalnessMap && (m?.metalness ?? 0) > 0.3 ? 'steel' : 'masonry';
}

const KIND_ID = { steel: 0, wood: 1, masonry: 2, fabric: 3, glass: 4, rubber: 5, snow: 6 };

// ---------------------------------------------------------------------------------------------------- shader

const VERT_HEAD = 'varying vec3 vCharW;';
// (worldpos_vertex's own world position — batching, instancing — computed whatever the defines)
const VERT_BODY = `{
  vec4 cw = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    cw = batchingMatrix * cw;
  #endif
  #ifdef USE_INSTANCING
    cw = instanceMatrix * cw;
  #endif
  vCharW = ( modelMatrix * cw ).xyz;
}`;

const FRAG_HEAD = `varying vec3 vCharW;
uniform vec4 uCharA[ ${CHAR_SPOTS} ];
uniform vec4 uCharB[ ${CHAR_SPOTS} ];
uniform vec4 uCharC[ ${CHAR_SPOTS} ];
uniform int uCharN;
float charHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float charNoise( vec3 x ) {
  vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( charHash( i ), charHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( charHash( i + vec3( 0, 1, 0 ) ), charHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( charHash( i + vec3( 0, 0, 1 ) ), charHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( charHash( i + vec3( 0, 1, 1 ) ), charHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
// heat (0..1: how hot the fire / blast was here) and the soot film (reaching further, climbing with the smoke)
void charField( vec3 wp, out float heat, out float film ) {
  heat = 0.0; film = 0.0;
  for ( int k = 0; k < ${CHAR_SPOTS}; k ++ ) {
    if ( k >= uCharN ) break;
    vec4 a = uCharA[ k ], b = uCharB[ k ];
    vec3 d = wp - vec3( a.x, a.y + b.y, a.z );
    d.y *= d.y > 0.0 ? b.z : 1.3;
    float q = length( d ) / a.w;
    float f = clamp( 1.0 - q, 0.0, 1.0 );
    heat = max( heat, b.x * f * f * ( 3.0 - 2.0 * f ) );
    float g = clamp( 1.0 - q * 0.42, 0.0, 1.0 );
    film = max( film, b.w * g * g );
    vec4 cc = uCharC[ k ];
    if ( cc.y > 0.0 ) {
      // gutted: burnt through its whole footprint, the upper walls and the roof worst (the fire went up through it)
      float fin = 1.0 - smoothstep( 0.75, 1.05, length( wp.xz - a.xz ) / ( a.w * 0.8 ) );
      float upr = smoothstep( 0.1, 0.85, ( wp.y - a.y ) / cc.x );
      heat = max( heat, cc.y * fin * ( 0.42 + 0.55 * upr ) );
      film = max( film, cc.y * fin * 0.95 );
    }
  }
}
// temper colours of bare steel by heat t (0..1): straw, bronze, purple, blue, then grey scale (dark: they are thin
// oxide films on a dull, sooty surface, not polished steel)
vec3 charTemper( float t ) {
  vec3 c = mix( vec3( 0.20, 0.19, 0.18 ), vec3( 0.30, 0.23, 0.11 ), smoothstep( 0.0, 0.2, t ) );
  c = mix( c, vec3( 0.24, 0.13, 0.06 ), smoothstep( 0.18, 0.38, t ) );
  c = mix( c, vec3( 0.15, 0.08, 0.16 ), smoothstep( 0.36, 0.56, t ) );
  c = mix( c, vec3( 0.07, 0.10, 0.22 ), smoothstep( 0.54, 0.74, t ) );
  return mix( c, vec3( 0.11, 0.12, 0.14 ), smoothstep( 0.72, 0.95, t ) );
}`

// after normal_fragment_maps: diffuseColor (map × colour × vertex colour), roughnessFactor, metalnessFactor and the
// final view-space `normal` are all known, the lighting has not read them yet; the AO map still applies afterwards
const FRAG_BODY = `{
  float heat, film;
  charField( vCharW, heat, film );
  film = max( film, 0.3 ); // (it is a wreck: it was in the fire's smoke wherever it stands)
  vec3 p = vCharW;
  float n1 = charNoise( p * 0.8 + 3.1 );            // ~1.2 m: the fire's uneven reach
  float n2 = charNoise( p * 2.3 + 7.7 );            // ~0.4 m
  float n3 = charNoise( p * 7.1 + 1.3 );            // ~0.14 m grain
  float runs = charNoise( vec3( p.x * 3.5, p.y * 0.45, p.z * 3.5 ) + 11.0 );   // soot runs, stretched upward
  float h = clamp( heat + ( n1 - 0.5 ) * 0.35 + ( n2 - 0.5 ) * 0.12, 0.0, 1.0 );
  vec3 nW = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );                // view → world
  float up = smoothstep( 0.55, 0.9, nW.y );
  vec3 base = diffuseColor.rgb;
#ifdef CHAR_SNOW
  // the snow on it (art/terrain/snowfx.js addSnowCover) melted by the fire into grey-black slush and ash
  base = mix( base, vec3( 0.07, 0.065, 0.06 ) * ( 0.7 + 0.6 * n3 ), scCov * smoothstep( 0.0, 0.2, h + film * 0.6 ) );
#endif
  float L = dot( base, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 c = base; float rough = roughnessFactor, metal = metalnessFactor;
#if CHAR_KIND != 0
  // the whole of it grimed by the fire: darkened, its colours dulled (steel keeps its paint until the heat takes it)
  base = mix( base, vec3( dot( base, vec3( 0.2126, 0.7152, 0.0722 ) ) ), 0.4 ) * 0.78;
  c = base;
#endif
  // soot: a film over the whole wreck, heaviest round the fire and climbing in runs above it — burnt off again where
  // it was hottest (a clean burn leaves the bare, scaled steel)
  float soot = clamp( film * ( 0.5 + 0.7 * runs ) + h * 0.3, 0.0, 1.0 ) * ( 1.0 - 0.65 * smoothstep( 0.55, 0.9, h ) );
#if CHAR_KIND == 0
  // steel. Warm: the paint scorched — browned, darkened — and blistered, grey primer / bare steel showing in flecks.
  float sc = smoothstep( 0.04, 0.38, h );
  float burnt = smoothstep( 0.3, 0.62, h + ( n2 - 0.5 ) * 0.18 );     // the paint burnt off
  float black = 0.75 * smoothstep( 0.8, 1.0, h + ( n1 - 0.5 ) * 0.2 ) * smoothstep( 0.35, 0.6, n2 ); // black char, in patches
  vec3 paint = base * mix( vec3( 1.0 ), vec3( 0.55, 0.42, 0.31 ), sc );
  float blister = smoothstep( 0.66, 0.71, n3 * 0.75 + n2 * 0.25 ) * sc * ( 1.0 - burnt );
  paint = mix( paint, vec3( 0.05, 0.045, 0.04 ) * ( 0.8 + 0.4 * n1 ), blister * 0.8 );
  // hot: fire-scaled steel going to rust — brown, grainy — heat tints (straw, bronze, purple, blue) in the odd flake
  // at the edge of the hottest zone, and black char where it was hottest
  vec3 scaleC = mix( vec3( 0.075, 0.034, 0.016 ), vec3( 0.21, 0.092, 0.038 ), smoothstep( 0.2, 0.85, n3 * 0.6 + n2 * 0.4 ) );
  scaleC *= 0.75 + 0.5 * n1; // (fire scale grey-brown to rust: uneven over the plates)
  // (heat tints in patches over the band short of the hottest char)
  float tint = smoothstep( 0.55, 0.65, h ) * ( 1.0 - smoothstep( 0.8, 0.92, h ) ) * smoothstep( 0.55, 0.75, n2 * 0.6 + n3 * 0.4 );
  scaleC = mix( scaleC, charTemper( clamp( ( h - 0.5 ) / 0.35 + ( n1 - 0.5 ) * 0.5, 0.0, 1.0 ) ) * 0.7, tint * 0.35 );
  float flake = smoothstep( 0.7, 0.73, n3 * 0.8 + n2 * 0.2 ) * smoothstep( 0.4, 0.55, h ) * ( 1.0 - smoothstep( 0.8, 0.95, h ) );
  scaleC = mix( scaleC, charTemper( clamp( ( h - 0.45 ) / 0.45 + ( n1 - 0.5 ) * 0.4, 0.0, 1.0 ) ) * 0.7, flake * 0.8 );
  vec3 charC = vec3( 0.016, 0.014, 0.012 ) * ( 0.8 + 0.4 * n3 ) + base * 0.15;
  c = mix( paint, mix( scaleC, charC, black ), burnt );
  // soot over it all, mottled where it burnt
  float mott = smoothstep( 0.4, 0.75, n2 * 0.55 + runs * 0.45 );
  c *= 1.0 - clamp( soot * 0.7 + mott * 0.35 * burnt, 0.0, 0.85 ) * mix( 1.0, 0.6, smoothstep( 0.0, 0.3, L ) );
  rough = mix( mix( rough, 0.8, sc ), mix( 0.9, 0.97, black ), burnt );
  rough = mix( rough, 0.55 + 0.15 * n3, flake * burnt );
  metal = mix( mix( metal, 0.0, sc ), 0.12 * flake, burnt );
#elif CHAR_KIND == 1
  // timber: browned, then charcoal — alligatored, grey ash on the ridges
  c = mix( base, base * vec3( 0.42, 0.28, 0.18 ), smoothstep( 0.05, 0.3, h ) );
  float burnt = smoothstep( 0.28, 0.55, h );
  float ridge = smoothstep( 0.55, 0.85, charNoise( p * vec3( 9.0, 14.0, 9.0 ) ) ) * ( 0.5 + 0.5 * n2 );
  c = mix( c, mix( vec3( 0.014, 0.012, 0.011 ), vec3( 0.075, 0.07, 0.065 ), ridge * 0.6 ) + base * 0.1, burnt );
  rough = mix( rough, 1.0, smoothstep( 0.05, 0.3, h ) ); metal = 0.0;
  c *= 1.0 - soot * 0.6 * mix( 0.75, 0.45, smoothstep( 0.0, 0.3, L ) );
#elif CHAR_KIND == 2
  // masonry: heat-reddened near the fire, soot-stained, blackest round the blast
  c = mix( base, base * vec3( 1.02, 0.86, 0.74 ), smoothstep( 0.4, 0.8, h ) * 0.5 );
  // soot-black, a lighter streak or patch of the old surface showing through here and there (not at the hottest)
  vec3 sootC = mix( base * 0.03 + vec3( 0.011, 0.01, 0.009 ) * ( 0.7 + 0.6 * n3 ), base * 0.24,
    smoothstep( 0.58, 0.85, runs * 0.55 + n1 * 0.45 ) * ( 1.0 - smoothstep( 0.82, 1.0, h ) ) );
  c = mix( c, sootC, smoothstep( 0.3, 0.72, h ) * ( 0.82 + 0.18 * n2 ) );
  rough = mix( rough, 0.97, smoothstep( 0.3, 0.7, h ) );
  c *= 1.0 - soot * 0.85 * mix( 0.75, 0.45, smoothstep( 0.0, 0.3, L ) );
#elif CHAR_KIND == 3
  // canvas: charred black-brown, the cooler edges scorched brown
  c = mix( base, base * vec3( 0.45, 0.32, 0.2 ), smoothstep( 0.04, 0.25, h ) );
  c = mix( c, vec3( 0.022, 0.018, 0.015 ) * ( 0.8 + 0.4 * n3 ), smoothstep( 0.22, 0.5, h ) );
  rough = 1.0; metal = 0.0;
  c *= 1.0 - soot * 0.7;
#elif CHAR_KIND == 4
  // glass: smoked dark, then gone — a black, gutted opening
  c = base * mix( 0.5, 0.04, smoothstep( 0.1, 0.45, h ) );
  rough = mix( rough, 0.6, smoothstep( 0.2, 0.6, h ) );
#elif CHAR_KIND == 6
  // a snow cover of its own: melted to grey-black slush and ash
  c = mix( base, vec3( 0.07, 0.065, 0.06 ) * ( 0.7 + 0.6 * n3 ), smoothstep( 0.0, 0.25, h + film * 0.6 ) );
  rough = mix( rough, 0.9, smoothstep( 0.0, 0.25, h + film * 0.6 ) ); metal = 0.0;
#else
  // rubber and the rest: burnt to black
  c = mix( base, vec3( 0.012, 0.011, 0.010 ), smoothstep( 0.1, 0.4, h ) );
  rough = mix( rough, 0.95, smoothstep( 0.1, 0.4, h ) ); metal = 0.0;
  c *= 1.0 - soot * 0.6;
#endif
  rough = mix( rough, 1.0, soot * 0.5 ); metal *= 1.0 - soot * 0.6;
  // grey ash settled on the upward faces of the hot zone, in grains
  // (fine grains, faint: a dusting, not flecks)
  float ash = up * smoothstep( 0.55, 0.9, h ) * smoothstep( 0.5, 0.8, charNoise( p * 11.0 + 5.3 ) * 0.7 + n3 * 0.3 );
  c = mix( c, max( c, vec3( 0.12, 0.115, 0.108 ) * ( 0.85 + 0.3 * n2 ) ), ash * 0.45 );
  rough = mix( rough, 1.0, ash ); metal *= 1.0 - ash;
  diffuseColor.rgb = c;
  roughnessFactor = clamp( rough, 0.04, 1.0 );
  metalnessFactor = clamp( metal, 0.0, 1.0 );
}`;

/** Materials / meshes of a wreck that burn away rather than char: flag cloths, banners. */
const BURNT_AWAY = /flag_?cloth|flag:cloth|banner/i;

const CACHE = new WeakMap(), CACHE2 = new WeakMap(); // source → its charred copy (one-sided / two-sided)
const CHARRED = new WeakSet();

/** Is this one of the charred copies? */
export const isCharred = (m) => CHARRED.has(m);

/**
 * The charred copy of material `src` (cached: one per source material, shared by every wreck that draws it).
 * Standard / physical materials get the burnt shader; any other kind a darkened plain copy. Never disposed with a
 * wreck (`userData.shared`); it holds no resource of its own beyond its source's textures.
 * @param {THREE.Material} src @returns {THREE.Material}
 */
export function charMaterial(src, o = {}) {
  if (!src?.isMaterial || CHARRED.has(src)) return src;
  // (`double`: a holed ruin's — art/char-ruin.js — its inside showing through the gaps; transparent ones stay one-sided)
  const dbl = !!o.double && src.side === THREE.FrontSide && !src.transparent;
  const cache = dbl ? CACHE2 : CACHE;
  let m = cache.get(src);
  if (m) return m;
  m = src.clone();
  m.name = `${src.name || 'mat'}#char`;
  if (dbl) m.side = THREE.DoubleSide;
  m.userData = { ...src.userData, shared: true, charOf: src.uuid };
  if (m.emissive) m.emissiveIntensity = 0; // (no lit windows in a burnt-out shell)
  if (m.isMeshStandardMaterial) {
    const kind = charKind(src), id = KIND_ID[kind] ?? 5;
    const prev = src.onBeforeCompile, prevKey = src.customProgramCacheKey?.call(src) ?? '';
    m.onBeforeCompile = (sh, r) => {
      if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(m, sh, r);
      sh.uniforms.uCharA = U.a; sh.uniforms.uCharB = U.b; sh.uniforms.uCharC = U.c; sh.uniforms.uCharN = U.n;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
        .replace('#include <worldpos_vertex>', `${VERT_BODY}\n#include <worldpos_vertex>`);
      const snow = src.userData?.snowCover && /\bscCov\b/.test(sh.fragmentShader) ? '#define CHAR_SNOW 1\n' : '';
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#define CHAR_KIND ${id}\n${snow}#include <common>\n${FRAG_HEAD}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_BODY}`);
    };
    m.customProgramCacheKey = () => `${prevKey}|char1:${id}${src.userData?.snowCover ? 's' : ''}`;
  } else if (m.color) {
    m.color.multiplyScalar(0.18);
  }
  CHARRED.add(m);
  cache.set(src, m);
  return m;
}

/**
 * Burn a model in place: every mesh under `root` draws its materials' charred copies (sprites, lines and points are
 * left alone). A library model's levels of detail attached later (`userData.onLodAttached`) are burnt as they come.
 * @param {THREE.Object3D} root @returns {number} meshes swapped
 */
export function charObject(root, o = {}) {
  if (!root) return 0;
  const ch = (m) => charMaterial(m, o);
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || o.userData?.noChar) return;
    // (a flag or banner over it burnt away with it)
    if ([].concat(o.material).some((m) => BURNT_AWAY.test(m?.name || '')) || BURNT_AWAY.test(o.name || '')) { o.visible = false; return; }
    o.material = Array.isArray(o.material) ? o.material.map(ch) : ch(o.material);
    n++;
  });
  if (!root.userData.charLod) {
    root.userData.charLod = true;
    const prev = root.userData.onLodAttached;
    root.userData.onLodAttached = (...args) => { prev?.(...args); charObject(root, o); };
  }
  return n;
}

/**
 * A copy of `root`'s meshes (sharing their geometries, every level of detail, hidden or not) drawing the charred
 * materials, where they stand — for the loading screen's warm-up frame, so the charred programs are linked before any
 * blast (art/building-props.js stages its ruins the same way). Flat: one group of plain / instanced meshes at their
 * world transforms (no Object3D.clone: it deep-copies userData, which a library model fills with live references).
 * Throw it away after. @returns {THREE.Group|null}
 */
export function charWarmClone(root, opt = {}) {
  if (!root) return null;
  root.updateWorldMatrix(true, true);
  const g = new THREE.Group();
  g.name = `char-warm:${root.name || ''}`;
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.userData?.noChar || BURNT_AWAY.test(o.name || '') || [].concat(o.material).some((m) => BURNT_AWAY.test(m?.name || ''))) return;
    const mat = Array.isArray(o.material) ? o.material.map((m) => charMaterial(m, opt)) : charMaterial(o.material, opt);
    let c;
    if (o.isInstancedMesh) { c = new THREE.InstancedMesh(o.geometry, mat, Math.max(1, o.count)); c.instanceMatrix = o.instanceMatrix; if (o.instanceColor) c.instanceColor = o.instanceColor; c.count = o.count; }
    else c = new THREE.Mesh(o.geometry, mat);
    o.matrixWorld.decompose(c.position, c.quaternion, c.scale);
    c.castShadow = o.castShadow; c.receiveShadow = o.receiveShadow;
    c.frustumCulled = false;
    g.add(c);
  });
  return g.children.length ? g : null;
}

/**
 * Hot spots for a structure without a modelled wreck: its blast point and its fire (centre), from its footprint.
 * @param {{x: number, z: number, w?: number, d?: number, r?: number, h?: number, rot?: number}} s structure (world)
 * @param {number} gy ground height @param {string} [id] structure id (the off-centre seat of the second spot)
 */
export function structureSpots(s, gy, id = '') {
  const w = s.w ?? (s.r ?? 2) * 2, d = s.d ?? (s.r ?? 2) * 2, h = Math.max(1.5, s.h ?? 3);
  // (it burned through: the heat reaches its far corners and its roof, the soot film beyond)
  const R = Math.max(3, 0.65 * Math.hypot(w, d) + 0.5 * h);
  // a second seat of the fire off the centre (seeded by the id): the soot is never a perfect target
  let k = 2166136261;
  for (const ch of String(id)) { k ^= ch.charCodeAt(0); k = Math.imul(k, 16777619); }
  const u = ((k >>> 0) % 1000) / 1000 - 0.5, v = ((k >>> 10) % 1000) / 1000 - 0.5, rot = s.rot ?? 0;
  const ox = u * w * 0.6, oz = v * d * 0.6;
  return [
    { x: s.x, y: gy, z: s.z, r: R, heat: 1, h: Math.min(h * 0.45, 4), up: 0.5, film: 0.8, top: h, gutted: s.gutted ?? 1 },
    { x: s.x + ox * Math.cos(rot) - oz * Math.sin(rot), y: gy, z: s.z + ox * Math.sin(rot) + oz * Math.cos(rot), r: R * 0.6, heat: 0.9, h: Math.min(h * 0.75, 6), up: 0.5, film: 0.5 },
  ];
}
