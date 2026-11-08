/**
 * Loading-card stills (S14) and the B1s theatre backdrops: every mission of the campaign has its own baked still
 * (tools/ui/bake_mission_stills.mjs), every theatre a backdrop still; the card's photo chain is the mission's still,
 * then its theatre's; each file exists, is a WebP of the right size and stays inside the byte budget.
 */
import { readFileSync, statSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { MISSIONS } from '../../src/missions/index.js';
import { LOADING_STILLS, STILL_THEATERS, loadingPhotos, theaterStillURL } from '../../src/ui/menu-model.js';

const ROOT = new URL('../../', import.meta.url);
/** WebP canvas size from the VP8 / VP8L / VP8X header. */
function webpSize(file) {
  const b = readFileSync(file);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WEBP');
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (kind === 'VP8L') { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
  return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]; // VP8 (lossy)
}

test('loading stills: every BEL mission has its own still, 1260×1000, ≤ 160 KB', () => {
  for (const def of MISSIONS.filter((m) => m.campaign === 'BEL' || m.id === 'm00')) {
    assert.ok(LOADING_STILLS.has(def.id), `${def.id} listed`);
    const url = loadingPhotos(def.id, def.theater)[0];
    assert.equal(url, `assets/ui/loading/${def.id}.webp`);
    const file = new URL(url, ROOT);
    assert.deepEqual(webpSize(file), [1260, 1000], `${def.id} size`);
    assert.ok(statSync(file).size <= 160 * 1024, `${def.id} ${(statSync(file).size / 1024).toFixed(0)} KB`);
  }
});

test('loading stills: the chain falls back to the theatre still; no request for a mission without one', () => {
  assert.deepEqual(loadingPhotos('m03', 'snow'), ['assets/ui/loading/m03.webp', 'assets/ui/diorama/snow.webp']);
  assert.deepEqual(loadingPhotos('b00', 'temperate'), ['assets/ui/diorama/temperate.webp'], 'BCD sandbox: no still of its own');
  assert.deepEqual(loadingPhotos(null, 'night'), ['assets/ui/diorama/temperate.webp'], 'unknown theatre → temperate');
  for (const th of ['snow', 'temperate', 'desert', 'coast']) assert.ok(STILL_THEATERS.includes(th), th);
  for (const def of MISSIONS) assert.ok(STILL_THEATERS.includes(def.theater), `${def.id}: ${def.theater} has a backdrop still`);
});

test('loading stills: every theatre backdrop still exists, 1920×1080, ≤ 240 KB', () => {
  for (const th of STILL_THEATERS) {
    const file = new URL(theaterStillURL(th), ROOT);
    assert.deepEqual(webpSize(file), [1920, 1080], `${th} size`);
    assert.ok(statSync(file).size <= 240 * 1024, `${th} ${(statSync(file).size / 1024).toFixed(0)} KB`);
  }
});
