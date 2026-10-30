#!/usr/bin/env node
/**
 * The browser's mesh-derived walking stamps for one mission, cached for the headless sim (tools/solutions/headless.mjs).
 *   node tools/solutions/navcache.mjs m07
 *
 * In the game, buildMap also stamps what the drawn models occupy beyond their gameplay footprints (map-builder rule
 * (e): nav-only blocks round huts, walls, crates, hulls…), measured from the meshes once they load; the headless sim
 * builds without meshes, so its men walk where the game's cannot (an M7 solution walked round the dock gate hut on a
 * way the game has closed). This plays the mission's first ticks in the real game (headless GPU Chromium), diffs its
 * grid against the headless build and writes the difference to tools/solutions/navcache/<id>.json (run-length cells),
 * with a fingerprint of the headless build it applies to: headlessMission() applies it when the fingerprint still
 * matches (a mission or art change makes it stale: re-run this).
 */
import { startHarness } from '../../tests/harness.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    const gr = G.game.world.grid;
    const solid = [];
    if (gr.solid) for (let k = 0; k < gr.solid.length; k++) if (gr.solid[k]) solid.push(k);
    // (the other mesh-measured layers: crawlers' steps, the visuals' measured tops and levelled bases, the owners)
    const sparse = (a) => { const o = []; if (a) for (let k = 0; k < a.length; k++) if (a[k]) o.push([k, Math.round(a[k] * 1000) / 1000]); return o; };
    return { cols: gr.cols, rows: gr.rows, navBlock: Array.from(gr.navBlock, (v) => (v ? 1 : 0)), block: Array.from(gr.block), solid,
      layers: { crawlStep: sparse(gr.crawlStep), blockTop: sparse(gr.blockTop), flatExtra: sparse(gr.flatExtra) }, owner: Array.from(gr.owner) };
  }, id);
  if (b.cols !== g.cols || b.rows !== g.rows) throw new Error(`grid size differs: browser ${b.cols}x${b.rows}, headless ${g.cols}x${g.rows}`);
  // cells the browser closes to walking that the headless build leaves open, as [start, length] runs
  const nav = [];
  for (let k = 0; k < b.navBlock.length; k++) {
    if (!b.navBlock[k] || g.navBlock[k]) continue;
    const last = nav[nav.length - 1];
    if (last && last[0] + last[1] === k) last[1]++; else nav.push([k, 1]);
  }
  // …and the cells the browser keeps open that the headless build closes (its stamps relaxed to keep a way open)
  const clear = [];
  for (let k = 0; k < b.navBlock.length; k++) {
    if (b.navBlock[k] || !g.navBlock[k]) continue;
    const last = clear[clear.length - 1];
    if (last && last[0] + last[1] === k) last[1]++; else clear.push([k, 1]);
  }
  const block = [];
  for (let k = 0; k < b.block.length; k++) if (b.block[k] !== g.block[k]) block.push([k, b.block[k]]);
  // …and the standing visuals at quarter-cell resolution (a man making no headway stands rather than stride into one)
  const solid = [];
  for (const k of b.solid) { if (g.solid?.[k]) continue; const last = solid[solid.length - 1]; if (last && last[0] + last[1] === k) last[1]++; else solid.push([k, 1]); }
  const owner = [];
  for (let k = 0; k < b.owner.length; k++) if (b.owner[k] !== g.owner[k]) owner.push([k, b.owner[k]]);
  out = { mission: id, fingerprint: gridPrint(g), cols: g.cols, rows: g.rows, nav, clear, block, solid, layers: b.layers, owner };
  mkdirSync(join(here, 'navcache'), { recursive: true });
  writeFileSync(join(here, 'navcache', `${id}.json`), JSON.stringify(out));
  console.log(`${id}: ${nav.reduce((a, r) => a + r[1], 0)} nav cells in ${nav.length} runs, ${clear.reduce((a, r) => a + r[1], 0)} cleared, ${block.length} block cells, ${solid.reduce((a, r) => a + r[1], 0)} solid quarter cells → tools/solutions/navcache/${id}.json`);
} finally {
  await h.close();
}
process.exit(out ? 0 : 1);
