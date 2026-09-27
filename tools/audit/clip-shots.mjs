#!/usr/bin/env node
/**
 * Before/after crops for docs/clipping-audit.md (GPU headless, the browser test harness): for every shot in a JSON
 * list [{mission, name, x, z, box?: {min, max}}], load the mission, outline the box (green) and save the same 2×-zoom
 * 640×400 crop the audit takes (docs/screenshots/<name>.jpg). The "before" crops are the audit's own
 * (clip-<mission>-<kind><n>.jpg of the commit being compared against).
 *
 *   node tools/audit/clip-shots.mjs docs/clipping/shots.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const shots = JSON.parse(readFileSync(resolve(ROOT, process.argv[2] || 'docs/clipping/shots.json'), 'utf8'));
const VIEW = { width: 1280, height: 720 };
const h = await startHarness({ viewport: VIEW });
try {
  const byMission = new Map();
  for (const s of shots) { if (!byMission.has(s.mission)) byMission.set(s.mission, []); byMission.get(s.mission).push(s); }
  for (const [mission, list] of byMission) {
    const page = await h.newPage(VIEW);
    await h.openGame(page);
    await page.evaluate((m) => window.__game.loadMission(m), mission);
    await page.evaluate(() => window.__game.clipAudit());
    for (const s of list) {
      const url = await page.evaluate(({ s }) => {
        const c = window.__game.clip;
        c.clearMarks();
        if (s.box) c.mark(s.box, 0x20d040);
        const u = c.snap({ x: s.x, y: 0, z: s.z }, 640, 400);
        c.clearMarks();
        return u;
      }, { s });
      const file = join(ROOT, 'docs/screenshots', `${s.name}.jpg`);
      writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
      console.log(`${mission}: ${s.name}.jpg`);
    }
    await page.close();
  }
} finally {
  await h.close();
}
