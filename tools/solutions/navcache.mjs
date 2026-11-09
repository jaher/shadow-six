#!/usr/bin/env node
/**
 * The game's mesh-measured world for one mission, cached for the headless sim (tools/solutions/headless.mjs).
 *   node tools/solutions/navcache.mjs m07        (CHROME=<a GPU chrome> as for any browser tool)
 *
 * The headless sim builds the map without meshes; the game measures a good deal on its drawn art, and a headless man
 * that walked, saw or fell on the mesh-less build left the game's run within seconds (M3, M4, M13, M17, M19 never won
 * headless). This loads the mission in the real game (headless GPU Chromium), and writes to
 * tools/solutions/navcache/<id>.json what the game has that the headless build lacks:
 *   - the whole NavGrid (grid-snap.mjs: every layer, stamp tables, links) — nav stamps, visibility, hulls, overhead, tops;
 *   - where the placement rules put every unit at load (the spawn spots);
 *   - the body solids men path round, water obstacles, doors, the measured vehicle dims, small structure moves (world-snap.mjs);
 *   - the ground relief the physics reads (groundY / lyingY: the terrain's 0.25 m lattice + residuals) and the print
 *     visibility by ground material (what the guards' track-following reads);
 * with a fingerprint of the headless build it applies to: headlessMission() applies it when the fingerprint still
 * matches (a mission or art change makes it stale: re-run this). Headless physics (Rapier) runs only over a cached mission.
 * tools/solutions/headless-diff.mjs plays a solution in both and shows where they first part.
 */
import { startHarness } from '../../tests/harness.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffExtras } from './world-snap.mjs';
import { headlessMission, gridPrint } from './headless.mjs';

const id = process.argv[2] || 'm07';
const here = dirname(fileURLToPath(import.meta.url));
const s = headlessMission(id, { navCache: false });
const g = s.world.grid;
const h = await startHarness();
let out = null;
try {
  const page = await h.newPage({ width: 640, height: 360 });
  page.setDefaultTimeout(0);
  await h.openGame(page, '?test=1');
  const b = await page.evaluate(async (mid) => {
    const G = window.__game;
    await G.loadMission(mid); G.start();
    const { exportGrid, exportGround } = await import('/tools/solutions/grid-snap.mjs');
    const { browserExtras } = await import('/tools/solutions/world-snap.mjs');
    const w = G.game.world, gr = w.grid;
    return { cols: gr.cols, rows: gr.rows, grid: await exportGrid(gr), extras: browserExtras(w), ground: await exportGround(w),
      spawns: { commandos: w.commandos.map((u) => [u.x, u.z, u.y]), enemies: w.enemies.map((u) => [u.x, u.z, u.y]) } };
  }, id);
  if (b.cols !== g.cols || b.rows !== g.rows) throw new Error(`grid size differs: browser ${b.cols}x${b.rows}, headless ${g.cols}x${g.rows}`);
  out = { mission: id, fingerprint: gridPrint(g), cols: g.cols, rows: g.rows, grid: b.grid, spawns: b.spawns, ground: b.ground, extras: diffExtras(s.world, b.extras) };
  mkdirSync(join(here, 'navcache'), { recursive: true });
  writeFileSync(join(here, 'navcache', `${id}.json`), JSON.stringify(out));
  console.log(`${id}: whole grid snapshot (${Object.keys(b.grid.arrays).length} layers, ${b.grid.links.length} links) → tools/solutions/navcache/${id}.json`);
} finally {
  await h.close();
}
process.exit(out ? 0 : 1);
