/**
 * Instant restart (engine/asset-cache.js session cache): once a mission has loaded, RESTART MISSION / quick load /
 * loading the same mission rebuild only the simulation and the scene instances — no asset request, no decode, no
 * shader recompile, no loading card — and repeated restarts do not grow GPU memory. Runs on the dev tree and on the
 * web build (SS_DIST=1).
 */
export default async function (page, t) {
  const assetReqs = [];
  page.on('request', (r) => { if (/\/(assets|vendor)\//.test(new URL(r.url()).pathname)) assetReqs.push(new URL(r.url()).pathname); });
  const first = await page.evaluate(async () => {
    const t0 = performance.now();
    await window.__game.loadMission('m01');
    window.__game.game.render(0.016, 1);
    return performance.now() - t0;
  });
  await page.waitForTimeout(2500); // audio pack / portraits of the first load finish downloading
  const runs = [];
  for (let k = 0; k < 3; k++) {
    const n0 = assetReqs.length;
    const r = await page.evaluate(async () => {
      const g = window.__game.game, R = g.renderer.renderer || g.renderer;
      const ids = new Set(R.info.programs.map((p) => p.id));
      const t0 = performance.now();
      await window.__game.loadMission('m01');
      const ms = performance.now() - t0;
      g.render(0.016, 1);
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))); // the frame loop flushes held materials
      return { ms, newPrograms: R.info.programs.filter((p) => !ids.has(p.id)).length, mem: { ...R.info.memory }, cache: window.__game.cache.stats() };
    });
    r.requests = assetReqs.slice(n0);
    runs.push(r);
    t.log(`restart ${k + 1}: ${r.ms.toFixed(0)} ms, ${r.requests.length} asset requests, ${r.newPrograms} new programs, geo ${r.mem.geometries} tex ${r.mem.textures}, cache ${r.cache.entries} entries ${(r.cache.bytes / 1e6).toFixed(0)} MB (${r.cache.hits} hits)`);
  }
  t.log(`first load ${first.toFixed(0)} ms`);
  const kinds = (l) => JSON.stringify(l.reduce((m, u) => ((m[u.split('.').pop()] = (m[u.split('.').pop()] || 0) + 1), m), {}));
  for (const [k, r] of runs.entries()) t.equal(r.requests.length, 0, `restart ${k + 1}: no asset request ${kinds(r.requests)} (${r.requests.slice(0, 4)})`);
  const best = Math.min(...runs.map((r) => r.ms));
  t(best < 1000, `restart under 1 s (${best.toFixed(0)} ms)`);
  t(runs.every((r) => r.ms < 2500), `every restart well under the cold load (${runs.map((r) => r.ms.toFixed(0))} ms)`);
  t(runs[2].newPrograms <= 2, `no shader recompiles on restart (${runs.map((r) => r.newPrograms)})`);
  const [a, , c] = runs;
  t(c.mem.geometries <= a.mem.geometries + 8 && c.mem.textures <= a.mem.textures + 4, `GPU memory stable across restarts (geo ${a.mem.geometries}→${c.mem.geometries}, tex ${a.mem.textures}→${c.mem.textures})`);

  // the player's RESTART MISSION (HUD path): no loading card, straight back to the briefing
  const ui = await page.evaluate(async () => {
    const g = window.__game.game, hud = g.hud;
    const t0 = performance.now();
    let card = false;
    const mo = new MutationObserver(() => { if (document.querySelector('.mk-loading')) card = true; });
    mo.observe(document.body, { childList: true, subtree: true });
    await hud.loading.restart();
    mo.disconnect();
    return { ms: performance.now() - t0, card, last: hud.loading.lastRun, state: g.state, briefing: !!document.querySelector('.ui-briefing') };
  });
  t.log(`HUD restart: ${ui.ms.toFixed(0)} ms, card ${ui.card}, ${JSON.stringify(ui.last)}, state ${ui.state}`);
  t(ui.last?.warm && !ui.card, 'warm restart shows no loading card');
  t.equal(ui.state, 'briefing');
  t(ui.briefing, 'the briefing opens again');
}
