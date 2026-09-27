#!/usr/bin/env node
/**
 * Copies the three.js addons SHADOW SIX uses from node_modules/three/examples/jsm into vendor/addons,
 * following every relative import transitively so the vendored tree is self-contained.
 *
 * Usage: node tools/vendor-addons.mjs
 * Add new entry points to ENTRIES below and re-run. Binary decoder libs (draco/basis) are copied whole.
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'node_modules/three/examples/jsm');
const DST = join(ROOT, 'vendor/addons');

export const ENTRIES = [
  'loaders/GLTFLoader.js', 'loaders/HDRLoader.js', 'loaders/RGBELoader.js', 'loaders/EXRLoader.js',
  'loaders/KTX2Loader.js', 'loaders/DRACOLoader.js', 'loaders/LUTCubeLoader.js',
  'libs/meshopt_decoder.module.js', 'libs/stats.module.js',
  'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/ShaderPass.js',
  'postprocessing/OutputPass.js', 'postprocessing/GTAOPass.js', 'postprocessing/SSAOPass.js',
  'postprocessing/UnrealBloomPass.js', 'postprocessing/SMAAPass.js', 'postprocessing/TAARenderPass.js',
  'postprocessing/SSAARenderPass.js', 'postprocessing/FXAAPass.js', 'postprocessing/Pass.js',
  'postprocessing/MaskPass.js', 'postprocessing/LUTPass.js', 'postprocessing/ClearPass.js',
  'shaders/FXAAShader.js', 'shaders/VignetteShader.js', 'shaders/GammaCorrectionShader.js',
  'csm/CSM.js', 'csm/CSMHelper.js', 'csm/CSMFrustum.js', 'csm/CSMShader.js',
  'objects/Water.js', 'objects/Sky.js', 'objects/Reflector.js',
  'geometries/DecalGeometry.js',
  'lines/Line2.js', 'lines/LineGeometry.js', 'lines/LineMaterial.js', 'lines/LineSegments2.js', 'lines/LineSegmentsGeometry.js',
  'utils/BufferGeometryUtils.js', 'utils/SkeletonUtils.js',
  'math/SimplexNoise.js', 'environments/RoomEnvironment.js',
];
const WHOLE_DIRS = ['libs/draco', 'libs/basis'];

const IMPORT_RE = /(?:import|export)\s*(?:[^'"]*?\sfrom\s*)?['"](\.{1,2}\/[^'"]+)['"]/g;
const seen = new Set();

function visit(rel) {
  if (seen.has(rel)) return;
  seen.add(rel);
  const src = join(SRC, rel);
  if (!existsSync(src)) throw new Error(`missing addon ${rel}`);
  const text = readFileSync(src, 'utf8');
  mkdirSync(dirname(join(DST, rel)), { recursive: true });
  writeFileSync(join(DST, rel), text);
  for (const m of text.matchAll(IMPORT_RE)) {
    visit(relative(SRC, resolve(dirname(src), m[1])));
  }
  // Bare 'three/…' specifiers outside JSDoc comments would need an import-map entry.
  const bare = [...text.matchAll(/^(?!\s*\*).*from\s*['"](three\/[^'"]+)['"]/gm)].map((m) => m[1]);
  if (bare.length) console.warn(`WARN ${rel} imports ${bare.join(', ')} (needs import-map entry)`);
}

ENTRIES.forEach(visit);
for (const d of WHOLE_DIRS) cpSync(join(SRC, d), join(DST, d), { recursive: true });
console.log(`vendored ${seen.size} modules + ${WHOLE_DIRS.join(', ')} into vendor/addons`);
