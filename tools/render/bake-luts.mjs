#!/usr/bin/env node
/**
 * Bake the per-theater grades of src/engine/grade.js to assets/luts/<id>.cube (17³, Resolve/Adobe format).
 * The engine bakes the same lattice at runtime; the .cube files are the hand-off for grading tools, and a
 * mission may point `lighting.lut` at an edited `.cube` instead of a grade id.
 *   node tools/render/bake-luts.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GRADES, gradeToCube } from '../../src/engine/grade.js';

const out = fileURLToPath(new URL('../../assets/luts/', import.meta.url));
mkdirSync(out, { recursive: true });
for (const [id, g] of Object.entries(GRADES)) {
  writeFileSync(out + id + '.cube', gradeToCube(g, 17, `SHADOW SIX ${id}`));
  console.log('wrote', `assets/luts/${id}.cube`);
}
