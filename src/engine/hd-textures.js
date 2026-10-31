/**
 * HD texture tiers (perf/download-speed-2): a character body GLB embeds its atlases at half size; the originals sit
 * next to it (`hd/<name>.jpg`, tools/perf/char_tex_tiers.py, run by tools/perf/glb_gzip.mjs) and replace the embedded
 * ones once the mission's loading screen has closed (engine/post-load.js), while the player reads the briefing.
 *
 * Why it loses nothing: before play the bodies draw at LOD1 / LOD2 (enemies below 120 px/m, commandos and guests below
 * 60 px/m — the game camera's zoom 1 is 40 px/m), where the GPU samples the atlas' half-size mip level or smaller; the
 * embedded copy IS that level (2 × 2 box filter of the original). The HD images are the original bytes: once in, every
 * body draws exactly as before. Textures feed no gameplay (knife contacts, solids, body rests read geometry only).
 *
 *   registerHdTexture(tex, url, {size})   // the GLTF plugin (engine/texture-memory.js keepEncodedImages), at parse time
 *   startHdTextures({renderer})           // Game, once: arms the upgrades (they run after each loading screen)
 *
 * Upgrades: the HD files of every registered texture still drawn are named to the early downloads (engine/
 * early-fetch.js, rank HD_RANK: behind the sounds and portraits, low fetch priority) in order — commandos, guests,
 * enemies; albedo, normal, ORM — then taken one at a time: decoded off the main thread (createImageBitmap), GPU-
 * compressed like the original (engine/gpu-compress.js, a small slice per task) when the texture was, and swapped
 * into the SAME Texture object (its GPU copy freed, the new one uploaded at once): every material and clone that
 * holds it sharpens together, no material is touched. One upgrade per idle period; a new mission load pauses them.
 * `?hdtex=0`: no smaller copies, no upgrades (the loaders take the full size, as before; the bodies keep the half-size
 * atlases their GLBs embed); `?hdtex=hold`: the smaller copies, never upgraded (A/B screenshots of the first seconds).
 * @module engine/hd-textures
 */

import * as THREE from 'three';
import { earlyFetch } from './early-fetch.js';
import { afterLoadScreen, isLoadScreenDown, loadGeneration } from './post-load.js';
import { compressTexture, gpuCompressor } from './gpu-compress.js';

const OFF = typeof location !== 'undefined' && /[?&]hdtex=0\b/.test(location.search);
/** `?hdtex=hold`: the smaller copies load as usual but are never replaced (A/B screenshots of what shows before). */
const HOLD = typeof location !== 'undefined' && /[?&]hdtex=hold\b/.test(location.search);
/** Are HD upgrades on? (`?hdtex=0`: off — loaders then take the full size at once, as before.) */
export const HD_TEXTURES = !OFF;
/** Early-download rank of the HD files (after 5: the spoken lines and talking clips the first minutes use). */
export const HD_RANK = 6;
/** GPU compressor slice while upgrades encode (ms of main thread per task; a load's: 10): briefing / while playing. */
const BRIEF_SLICE_MS = 3, PLAY_SLICE_MS = 2;
/** While the game is being played: at least this long between two upgrades, and only in an idle period. */
const PLAY_GAP_MS = 250;
/** While the game is being played: texels per GPU encode band (engine/gpu-compress.js encodeBand) — ~1.5-6 ms of GPU
 *  a task at the encoder tiers' cost; a whole 2048² atlas in one go held the frames behind it 60-100 ms. */
const PLAY_BAND_TEXELS = 1 << 18;
/** On a hidden view (the briefing's opaque first page): bands four times as large — ~6-25 ms of GPU each — so the
 *  first frames after it (the tour, play) wait for one band at most, not for a whole atlas still encoding (M12's
 *  walkthrough start: 166-200 ms frames when its cards took whole atlases). */
const STILL_BAND_TEXELS = 1 << 20;
/** HD files named to the early downloads ahead of the one being applied. */
const AHEAD = 6;

/** @type {Map<string, {url: string, size: number[]|null, order: number, rank: number[], texs: Set<THREE.Texture>, params: WeakMap<THREE.Texture, object>}>} */
const entries = new Map();
const owner = new WeakMap(); // Texture → its entry URL
let regOrder = 0;
let swapping = false;
let armed = false;
let running = null;
let kickQueued = false;
let renderer = null;
let playing = () => false; // is the game being played (Game: state 'playing')? the upgrades then go gently
let onScreen = null; // does a moving picture show (play; the briefing's tour over the live map)? encodes go in bands then
let active = () => true; // is a mission up (Game: a world)? the menus' diorama never upgrades (it draws blurred at 0.5x)
let deps = null; // test hooks: {fetch, decode, compress, idle}
export const hdTextureStats = { registered: 0, upgraded: 0, failed: 0, skipped: 0, bytes: 0, ms: 0, pending: 0 };
if (typeof globalThis !== 'undefined') globalThis.__ssHdTextures = hdTextureStats; // perf tools / tests read it

// the layer arrays first (ground and trees: the most visible, and the heaviest upgrades — done while the briefing is read
// rather than in play), then commandos (in view at the start), the library maps (buildings, vehicles), enemies, guests;
// within a group colour, normals, the rest
const GROUP_RANK = [[/^(terrain|vegetation):/, -1], [/\/commandos\//, 0], [/\/textures\/(lib|pavement)\//, 1], [/\/enemies\//, 2], [/\/guests\//, 3]];
const SLOT_RANK = [[/_(albedo|diff|col|color)\.\w+$/, 0], [/_(normal|nor|nrm)\.\w+$/, 1]];
const rankOf = (url) => [GROUP_RANK.find(([re]) => re.test(url))?.[1] ?? 4, SLOT_RANK.find(([re]) => re.test(url))?.[1] ?? 2];

/** A texture was disposed by its owner (template freed): it is no longer upgraded. */
function onDispose(ev) {
  if (swapping) return;
  const t = ev.target, url = owner.get(t);
  t.removeEventListener('dispose', onDispose);
  owner.delete(t);
  const e = url && entries.get(url);
  if (!e) return;
  e.texs.delete(t);
  if (!e.texs.size) entries.delete(url);
}

/**
 * A texture whose image has an HD tier at `url` (absolute). Upload parameters the GPU compressor changes in place
 * (flip, premultiply, mip generation) are noted now, before it does. No-op with ?hdtex=0.
 * @param {THREE.Texture} tex @param {string} url @param {{size?: number[], onSwap?: (tex, oldSource) => void}} [o]
 *   size: the HD image's [w, h] (checked); onSwap: called once the texture holds the HD image (its owner's bookkeeping)
 */
export function registerHdTexture(tex, url, { size = null, onSwap = null } = {}) {
  if (OFF || !tex?.isTexture || !url) return;
  try { url = new URL(url, typeof location !== 'undefined' ? location.href : undefined).href; } catch { /* absolute already, or no page */ }
  if (owner.has(tex) || tex.userData?.hdUpgraded === url) return;
  let e = entries.get(url);
  if (!e) entries.set(url, (e = { url, size, order: regOrder++, rank: rankOf(url), texs: new Set(), params: new WeakMap() }));
  e.texs.add(tex);
  e.params.set(tex, { flipY: !!tex.flipY, premultiplyAlpha: !!tex.premultiplyAlpha, generateMipmaps: tex.isCompressedTexture ? (tex.mipmaps?.length ?? 0) > 1 : tex.generateMipmaps !== false, unpackAlignment: tex.unpackAlignment ?? 4, onSwap });
  owner.set(tex, url);
  tex.addEventListener('dispose', onDispose);
  hdTextureStats.registered++;
  hdTextureStats.pending = entries.size;
  if (armed) queueKick();
}

/** Run the upgrades once the loading screen is down (one queued call however many textures register meanwhile). */
function queueKick() {
  if (kickQueued) return;
  kickQueued = true;
  afterLoadScreen(() => { kickQueued = false; kick(); });
}

/**
 * A whole upgrade done by its owner (the terrain's layer arrays: `setTextureRes`), queued with the textures: `urls`
 * are named to the early downloads in their turn, then `run()` (its own loads are served from them) is awaited.
 * @param {string} key unique (also its rank: a URL-like key ranks like a texture URL) @param {{urls?: string[],
 *   run: () => Promise<any>, owner?: object}} job owner: an object whose 'dispose' event drops the job
 */
export function registerHdJob(key, { urls = [], run, owner = null } = {}) {
  if (OFF || !key || typeof run !== 'function') return;
  const old = entries.get(key);
  if (old && !old.job) return; // (a texture's URL of that name: left to it)
  // the latest registration of a job replaces a queued one: a job left by a load whose upgrades never ran (a reload or a
  // mission left during its briefing; tests that load without playing) kept its owner — the terrain, the whole previous
  // world — and the new terrain's own upgrade was never queued (the old job then ran for its disposed terrain: nothing)
  const e = { url: key, size: null, order: old ? old.order : regOrder++, rank: rankOf(key), texs: new Set(), params: new WeakMap(), job: { urls, run } };
  entries.set(key, e);
  owner?.addEventListener?.('dispose', () => { if (entries.get(key) === e) entries.delete(key); });
  hdTextureStats.registered++;
  hdTextureStats.pending = entries.size;
  if (armed) queueKick();
}

/** HD files still to apply, in upgrade order. */
export function pendingHdTextures() {
  return [...entries.values()].sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.order - b.order).map((e) => e.url);
}

/**
 * Arm the upgrades: from now on they run whenever the loading screen is down (engine/post-load.js).
 * @param {{renderer?: THREE.WebGLRenderer, playing?: () => boolean, active?: () => boolean, deps?: object}} [o]
 *   active: false while no mission is up (the menus: nothing upgrades; resumeHdTextures() after a load); renderer: uploads each
 *   upgraded texture at once (else at its next draw); playing: true while the game is played (the briefing / menus:
 *   false) — upgrades then wait PLAY_GAP_MS and an idle period between them, the compressor at PLAY_SLICE_MS;
 *   onScreen: true while the frames show a moving picture (default: playing) — the game played, but also the briefing's
 *   tour flying over the live map — the GPU encodes then go in bands of PLAY_BAND_TEXELS, one a frame (a whole atlas in
 *   one draw held the frames behind it 60-100 ms); a hidden view (the briefing's opaque first page) takes them in
 *   STILL_BAND_TEXELS bands;
 *   deps: test hooks {fetch(url) → Promise<Blob>, decode(blob, compressed) → Promise<image>,
 *   compress(tex, o) → Promise<tex>, idle() → Promise}
 */
export function startHdTextures(o = {}) {
  if (OFF || HOLD) return;
  renderer = o.renderer ?? renderer;
  if (o.playing) playing = o.playing;
  if (o.onScreen) onScreen = o.onScreen;
  if (o.active) active = o.active;
  if (o.deps) deps = o.deps;
  armed = true;
  queueKick();
}

/** Wait for every upgrade queued so far (tests, tools). */
export async function hdTexturesIdle() {
  while (running) await running;
}

/** A mission load finished: run what is queued once its loading screen is down (the diorama's registrations too). */
export function resumeHdTextures() {
  if (armed && entries.size) queueKick();
}

function kick() {
  if (running || !armed || !entries.size || !active()) return;
  running = run().finally(() => { running = null; });
}

const ric = (ms) => new Promise((ok) => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => ok(), { timeout: ms });
  else setTimeout(ok, 30);
});
/** Between two upgrades: an idle period; while the game is played, also PLAY_GAP_MS (the frames come first). */
async function idle() {
  if (deps?.idle) return deps.idle();
  if (!playing()) return ric(250);
  await new Promise((ok) => setTimeout(ok, PLAY_GAP_MS));
  return ric(1000);
}
/** The compressor's slice for the current state (a GPU compressor `c`). */
const sliceFor = (c, load) => {
  if (!c) return;
  c.sliceMs = Math.min(load, playing() ? PLAY_SLICE_MS : BRIEF_SLICE_MS);
  c.encodeBand = (onScreen ? onScreen() : playing()) ? PLAY_BAND_TEXELS : STILL_BAND_TEXELS;
};

async function run() {
  const gen = loadGeneration();
  const c = gpuCompressor();
  const slice = c?.sliceMs;
  try {
    const order = pendingHdTextures();
    for (let i = 0; i < order.length; i++) {
      if (!isLoadScreenDown() || gen !== loadGeneration() || !active()) break; // a new load: the link and the GPU are its
      // background downloads a few files ahead of the one being applied, in this order (no-op with ?earlyfetch=0);
      // a load that starts meanwhile finds at most these few still named
      if (i % AHEAD === 0) earlyFetch(order.slice(i, i + 2 * AHEAD).flatMap((u) => entries.get(u)?.job ? entries.get(u).job.urls : [u]), { rank: HD_RANK });
      const url = order[i];
      sliceFor(c, slice);
      const e = entries.get(url);
      if (!e) { hdTextureStats.skipped++; continue; }
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      try {
        await upgrade(e);
      } catch (err) {
        hdTextureStats.failed++;
        entries.delete(url);
        for (const t of e.texs) { t.removeEventListener('dispose', onDispose); owner.delete(t); }
        console.warn('[hd-textures] kept the embedded size:', url, err?.message || err);
      }
      // (the band is this upgrade's: a mission load queued meanwhile encodes in one go, at the load's pace)
      if (c) c.encodeBand = 0;
      hdTextureStats.ms += (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      hdTextureStats.pending = entries.size;
      await idle();
    }
  } finally {
    if (c && slice != null) c.sliceMs = slice;
    if (c) c.encodeBand = 0;
  }
  if (entries.size && active()) setTimeout(queueKick, 0); // registered meanwhile, or paused by a new load: on with them after it
}

async function fetchBlob(url) {
  if (deps?.fetch) return deps.fetch(url);
  const res = await fetch(url, { priority: 'low', credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

/**
 * Decoded image for an upload, the way the texture's own loader made it: a glTF map (no flip) → an ImageBitmap for the
 * compressor (as engine/texture-memory.js EncodedBitmapLoader); otherwise a decoded <img> (a flipped map from a
 * TextureLoader: the compressor turns it into a bitmap with the upload's flags, three uploads it as it did).
 */
async function decode(blob, bitmap) {
  if (deps?.decode) return deps.decode(blob, bitmap);
  if (bitmap && typeof createImageBitmap === 'function') return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const img = new Image();
  img.decoding = 'async';
  const u = URL.createObjectURL(blob);
  try {
    img.src = u;
    await img.decode();
  } finally {
    URL.revokeObjectURL(u);
  }
  return img;
}

async function upgrade(e) {
  if (e.job) { entries.delete(e.url); await e.job.run(); hdTextureStats.upgraded++; return; }
  const blob = await fetchBlob(e.url);
  hdTextureStats.bytes += blob.size || 0;
  for (const tex of [...e.texs]) {
    if (!e.texs.has(tex)) continue; // disposed while the file downloaded
    const p = e.params.get(tex), old = tex.source;
    const compressed = !!tex.isCompressedTexture, bitmap = compressed && !p.flipY;
    const img = await decode(blob, bitmap);
    if (!e.texs.has(tex)) { img.close?.(); continue; }
    if (e.size && (img.width !== e.size[0] || img.height !== e.size[1])) throw new Error(`HD image ${img.width}x${img.height}, expected ${e.size}`);
    if (compressed) {
      const tmp = new THREE.Texture(img);
      tmp.colorSpace = tex.colorSpace;
      tmp.flipY = p.flipY; tmp.premultiplyAlpha = p.premultiplyAlpha; tmp.unpackAlignment = p.unpackAlignment;
      tmp.generateMipmaps = p.generateMipmaps; tmp.minFilter = tex.minFilter; tmp.magFilter = tex.magFilter;
      if (tex.userData?.compressWeights) tmp.userData.compressWeights = tex.userData.compressWeights;
      const reload = () => (bitmap ? createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) : Promise.resolve(img));
      const out = await (deps?.compress ? deps.compress(tmp, { reload }) : compressTexture(tmp, { reload }));
      if (!out?.isCompressedTexture) { img.close?.(); throw new Error('the HD image could not be compressed like its base'); }
      if (!e.texs.has(tex)) continue;
      swapIn(tex, () => { tex.source = out.source; tex.mipmaps = out.mipmaps; tex.format = out.format; });
    } else {
      swapIn(tex, () => { tex.source = new THREE.TextureSource(img); });
    }
    e.texs.delete(tex);
    tex.removeEventListener('dispose', onDispose);
    owner.delete(tex);
    tex.userData.hdUpgraded = e.url; // (a cached texture met again by a later load is not registered again)
    try { p.onSwap?.(tex, old); } catch (err) { console.warn('[hd-textures] onSwap', err?.message || err); }
    hdTextureStats.upgraded++;
  }
  if (!e.texs.size) entries.delete(e.url);
}

/** Free `tex`'s GPU copy, give it its new image(s), upload it now (else at its next draw). */
function swapIn(tex, assign) {
  swapping = true;
  try { tex.dispose(); } finally { swapping = false; }
  assign();
  tex.needsUpdate = true;
  try { renderer?.initTexture?.(tex); } catch (err) { console.warn('[hd-textures] upload', err?.message || err); }
}

/** The pause between two upgrades (a job with several steps takes it between them). */
export const hdPause = () => idle();

/** Upload a texture now (a job's in-place swap: the cost lands in the paced upgrade, not in a later frame). */
export function uploadNow(tex) {
  try { renderer?.initTexture?.(tex); } catch (err) { console.warn('[hd-textures] upload', err?.message || err); }
}

/** Forget every registration (tests). */
export function resetHdTextures() {
  for (const e of entries.values()) for (const t of e.texs) { t.removeEventListener('dispose', onDispose); owner.delete(t); }
  entries.clear();
  armed = false; renderer = null; deps = null; regOrder = 0; kickQueued = false; playing = () => false; onScreen = null; active = () => true;
  for (const k of Object.keys(hdTextureStats)) hdTextureStats[k] = 0;
}
