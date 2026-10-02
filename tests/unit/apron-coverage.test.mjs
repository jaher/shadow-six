/**
 * Every playable map gets the "never see the map boundary" GPU check (user request 2026-09-30): each mission in
 * MISSIONS needs its one-line tests/edges-void-<id>.test.mjs (see tests/edges-void-lib.mjs). Missions added later
 * (M4–M20) fail here until their file exists.
 */
import { test, assert } from './lib.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MISSIONS } from '../../src/missions/index.js';

test('every mission has its edges-void GPU test', () => {
  const missing = MISSIONS.map((m) => m.id).filter((id) => !existsSync(fileURLToPath(new URL(`../edges-void-${id}.test.mjs`, import.meta.url))));
  assert.deepEqual(missing, [], `add tests/edges-void-<id>.test.mjs for: ${missing.join(', ')}`);
});
