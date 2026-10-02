// stance-pose.mjs [out.json] [all] : run the game headless, put the Green Beret into his idle stand and his low crawl
// (crawl_unarmed, moving), and write his skeleton's local pose (every bone: quaternion + position) - the EXACT in-game
// pose (clip + per-character prone fit + procedural passes). By default only the frames the icons use are kept
// (stand: idle; crawl: CRAWL_FRAME, one far knee drawn up mid-stroke); `all` keeps the 60 sampled crawl frames
// (2 ticks apart) for picking another one with STANCE_FC. human.py's stance shot bakes the frame into the decoded GLB.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const out = process.argv[2] || resolve(dirname(fileURLToPath(import.meta.url)), 'stance-pose.json');
const CRAWL_FRAME = 16, all = process.argv[3] === 'all';
const { startHarness } = await import(pathToFileURL(`${ROOT}/tests/harness.mjs`).href);
const h = await startHarness();
const page = await h.newPage({ width: 1280, height: 720 });
await h.openGame(page);
const res = await page.evaluate(async () => {
  const g = window.__game, G = g.game;
  await g.loadMission('m02'); g.start();
  const w = G.world;
  for (const e of w.enemies) if (e.brain) e.brain.frozen = true;
  const tick = (k) => { for (let i = 0; i < k; i++) { g.step(); G.render(1 / 60, 1); } };
  const gb = w.commandos.find((c) => c.role === 'greenberet');
  const inner = () => gb.model.real.inner;
  const r4 = (a) => a.map((x) => +x.toFixed(5));
  const snap = () => {
    gb.object3d.updateMatrixWorld(true); const B = inner().bones, o = {};
    for (const [n, b] of Object.entries(B)) o[n] = { q: r4(b.quaternion.toArray()), p: r4(b.position.toArray()) };
    return { clip: gb.model.clip, bones: o };
  };
  const res = {};
  gb.setStance('stand'); tick(90);
  res.stand = [snap()];
  gb.setStance('crawl'); tick(60);
  gb.moveTo(gb.x + 14, gb.z); tick(60);
  res.crawl = []; for (let i = 0; i < 60; i++) { tick(2); res.crawl.push(snap()); }
  return res;
});
if (!all) res.crawl = [res.crawl[CRAWL_FRAME]];
writeFileSync(out, JSON.stringify(res));
console.log('stand', res.stand[0].clip, 'crawl', res.crawl.map((f) => f.clip).join(','), Object.keys(res.stand[0].bones).length, 'bones ->', out);
await page.close(); await h.close();
