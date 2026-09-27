/**
 * Art integration 2 step 4 — mission loading: hud.startMission fronts the load with the loading screen, whose brass
 * rule follows the real progress (Game.loadMission 'mission:progress', monotonic, ends at 1, bytes counted), then the
 * briefing opens. `?preset=low` asks for the 512 terrain strips and 512 building textures, and does not preload the
 * destroyed variants' LOD0.
 */
export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game.game;
    const ps = [];
    const off = G.events.on('mission:progress', (e) => ps.push([e.p, e.stage, e.bytes]));
    const run = G.hud.startMission('m01');
    let screen = false, bar = null;
    for (let i = 0; i < 400 && !screen; i++) {
      await new Promise((ok) => setTimeout(ok, 10));
      screen = !!document.querySelector('.mk-loading');
    }
    await new Promise((ok) => setTimeout(ok, 400));
    bar = document.querySelector('.mk-loadbar .pct')?.textContent || null;
    await run;
    off();
    return {
      screen, bar, n: ps.length, last: ps[ps.length - 1], stages: [...new Set(ps.map((p) => p[1]))],
      mono: ps.every((p, i) => i === 0 || p[0] >= ps[i - 1][0]),
      state: G.state, briefing: !!document.querySelector('.ui-briefing'), loadingGone: !document.querySelector('.mk-loading'),
      lastLoad: G.lastLoad,
    };
  });
  t.log(JSON.stringify({ ...r, stages: r.stages.join(',') }));
  t(r.screen, 'loading screen shows for a normal mission start');
  t(/LOADING \d+%/.test(r.bar || ''), 'percent label');
  t(r.n >= 7 && r.mono, 'progress events, monotonic');
  t.equal(r.last?.[0], 1);
  t(['buildings', 'characters', 'terrain', 'units', 'done'].every((s) => r.stages.includes(s)), 'every stage reported');
  t.equal(r.state, 'briefing');
  t(r.briefing && r.loadingGone, 'briefing opens after the loading screen closes');
  t(r.lastLoad?.bytes > 1e6 && r.lastLoad.files > 20, 'bytes counted from Resource Timing');

  // ---- ?preset=low: 512 terrain strips + 512 building textures, no LOD0 building GLBs
  const low = await t.harness.newPage();
  const urls = [];
  low.on('request', (q) => urls.push(new URL(q.url()).pathname));
  await low.goto(`${t.harness.url}/index.html?test=1&preset=low`);
  await low.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
  const lowLoad = await low.evaluate(async () => { await window.__game.loadMission('m01'); return window.__game.game.lastLoad; });
  const lowErrs = t.harness.errors(low);
  await low.close();
  t.equal(lowErrs.length, 0, 'low page: no errors ' + lowErrs.slice(0, 3).join(' | '));
  const bld = urls.filter((u) => /\/models\/(buildings|bridges)\/.+\.glb$/.test(u));
  t.log(JSON.stringify({ lowMB: +(lowLoad.bytes / 1e6).toFixed(1), highMB: +(r.lastLoad.bytes / 1e6).toFixed(1), bld: bld.length }));
  t(urls.some((u) => /terrain\/snow_albedo_512\.webp$/.test(u)) && !urls.some((u) => /terrain\/snow_albedo\.webp$/.test(u)), 'low: 512 terrain strips');
  t(urls.some((u) => /textures\/lib\/512\//.test(u)) && !urls.some((u) => /textures\/lib\/1k\/(?!camo_netting)/.test(u)), 'low: 512 building textures');
  // placed buildings still attach LOD0 (door nodes live there); the preload skips it for the destroyed variants
  const lod0 = bld.filter((u) => !/_lod[12]\.glb$/.test(u));
  t(bld.some((u) => /_lod1\.glb$/.test(u)) && !lod0.some((u) => /\/barracks_[a-d]+d_snow\.glb$/.test(u)), 'low: no LOD0 preload of destroyed variants ' + lod0.join(' '));
  t(lowLoad.bytes < r.lastLoad.bytes * 0.8, 'low downloads less');
}

