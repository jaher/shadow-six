/**
 * LIGHTS OUT e06 "Thin Ice": a quick save made after the sealed wagon went off the end of the link-span, loaded again
 * (verifier r2: the load drew the wagon back, charred, standing on the end of the lowered span over the water). The
 * solution (tools/solutions/e06.solution.mjs) is played on Hard to checkpoint F1 — the wagon in the harbour — and 3 s on;
 * then quickSave / quickLoad. Before and after the load, and 5 s after it: the wagon is dropped and destroyed, its skin
 * ('e06:skin:wag_n') is not drawn anywhere (nor its placeholder), and nothing of it is burnt.
 */
export const timeout = 1_200_000;

const look = (page) => page.evaluate(() => {
  const g = window.__game, G = g.game, w = G.world;
  const p = w.interactables.find((i) => (i.tag ?? i.id) === 'wag_n');
  let skin = null;
  w.scene?.traverse?.((o) => { if (o.name === 'e06:skin:wag_n') skin = o; });
  const shown = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
  // every mesh of the wagon — its skin and the pushable's own placeholder — that the renderer would draw
  const drawn = [];
  for (const root of [skin, p?.object3d]) root?.traverse?.((m) => { if (m.isMesh && shown(m)) drawn.push(m.name || m.type); });
  let charred = !!p?.object3d?.userData?.charred;
  skin?.traverse?.((m) => { if (m.material?.userData?.charred || m.userData?.charred) charred = true; });
  return { t: w.time, dropped: !!p?.dropped, destroyed: !!p?.destroyed, skin: !!skin, drawn: drawn.length, charred, objective: w.objectives.find((o) => o.id === 'o1')?.done };
});

export default async function e06Saveload(page, t) {
  page.setDefaultTimeout(1_200_000);
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, dt = g.CONFIG.sim.dt;
    G.difficulty = 'hard';
    await g.loadMission('e06'); g.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/e06.solution.mjs');
    const STOP = { stop: true };
    const D = makeDriver(G.world, { step: () => { G.step(dt); }, dt, quiet: true, log: () => {}, onCheckpoint: (cp) => { if (cp.name.split(' ')[0] === 'F1') throw STOP; } });
    let err = null;
    try { await solve(D, {}); } catch (e) { if (e !== STOP) err = String(e?.message || e); }
    for (let i = 0; i < Math.round(3 / dt); i++) G.step(dt);
    D.dispose?.();
    return { err, state: G.state };
  });
  t.log(`solution to F1: ${JSON.stringify(r)}`);
  t.equal(r.err, null, 'the solution ran to checkpoint F1');
  const frame = () => page.evaluate(() => { const g = window.__game; g.setZoom(1.6); g.centerOn(168, 50); g.game.render(0, 1); g.game.render(0, 1); });
  await frame();
  const before = await look(page);
  t.log(`before the save: ${JSON.stringify(before)}`);
  t(before.dropped && before.destroyed && before.objective, 'the wagon went off the span (o1 done)');
  t.equal(before.drawn, 0, 'the sunk wagon is not drawn before the save');
  const saved = await page.evaluate(() => window.__game.quickSave());
  const loaded = await page.evaluate(async () => { const ok = await window.__game.quickLoad(); if (window.__game.game.state !== 'playing') window.__game.start(); return ok; });
  t(saved && loaded, 'quick save and load');
  await frame();
  const after = await look(page);
  t.log(`after the load: ${JSON.stringify(after)}`);
  await t.shot('e06-saveload-after-drop');
  t(after.dropped && after.destroyed && after.objective, 'still dropped and destroyed after the load (o1 done)');
  t(after.skin, 'the mission\'s wagon skin is built');
  t.equal(after.drawn, 0, 'the wagon is not drawn back on the span after the load');
  t(!after.charred, 'nothing of it burnt where it went over');
  await page.evaluate(() => { const g = window.__game, G = g.game, dt = g.CONFIG.sim.dt; for (let i = 0; i < Math.round(5 / dt); i++) G.step(dt); });
  await frame();
  const later = await look(page);
  t.log(`5 s after the load: ${JSON.stringify(later)}`);
  t.equal(later.drawn, 0, 'still not drawn 5 s after the load');
}
