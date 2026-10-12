/**
 * Render on demand (perf/render-efficiency): while an opaque menu layer covers the view (the menus' backdrop, its live
 * diorama off) the frame loop draws no GPU frames; the view draws again as soon as the menu closes. Explicit renders
 * (tests, the backdrop's frozen-frame grab) still draw.
 */
const key = (page, code) => page.evaluate((c) => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c, bubbles: true, cancelable: true }));
}, code);

/** Renderer frames drawn by the rAF loop over `ms` of real time. */
const framesOver = (page, ms) => page.evaluate(async (ms) => {
  const R = window.__game.game.renderer, f0 = R.frame;
  await new Promise((ok) => setTimeout(ok, ms));
  return R.frame - f0;
}, ms);

export default async function (page, t) {
  // front end: MAIN MENU over the backdrop (no world; the live diorama does not run in test mode)
  await page.evaluate(() => window.__game.game.hud.screens.openMain());
  const fe = await page.evaluate(() => { const b = window.__game.game.hud.backdrop; return { hidden: b.root.hidden, dio: !!b.dio, mode: b.mode }; });
  t.log('front end backdrop', JSON.stringify(fe));
  await framesOver(page, 200); // the first two covered frames still draw
  const feFrames = await framesOver(page, 600);
  t.ok(!fe.hidden && !fe.dio, 'menus backdrop shown, no live diorama');
  t.equal(feFrames, 0, 'no GPU frames under the front-end menus');
  await page.evaluate(() => { const hud = window.__game.game.hud; hud.kit.close(); hud.backdrop.setMode('off'); });
  t.ok((await framesOver(page, 500)) >= 2, 'menus closed: the loop draws again');

  // in a mission: frames run; the Esc menu (oxblood frozen frame) stops them; Esc again resumes them
  await page.evaluate(async () => { await window.__game.loadMission('m01'); window.__game.start(); window.__game.game.focusSquad?.(); });
  const playing = await framesOver(page, 500);
  t.ok(playing >= 2, `the mission view draws (${playing} frames in 0.5 s)`);
  await key(page, 'Escape');
  const st = await page.evaluate(() => ({ state: window.__game.game.state, mode: window.__game.game.hud.backdrop.mode, hidden: window.__game.game.hud.backdrop.root.hidden }));
  t.equal(st.state, 'paused', 'Esc menu pauses');
  t.equal(st.mode, 'mission', 'Esc menu on the frozen frame');
  await framesOver(page, 200);
  const covered = await framesOver(page, 600);
  t.equal(covered, 0, 'no GPU frames under the Esc menu');
  const explicit = await page.evaluate(() => { const R = window.__game.game.renderer, f0 = R.frame; window.__game.render(); return R.frame - f0; });
  t.equal(explicit, 1, 'an explicit render still draws');
  await key(page, 'Escape');
  t.equal(await page.evaluate(() => window.__game.game.state), 'playing', 'Esc resumes');
  const again = await framesOver(page, 500);
  t.ok(again >= 2, `the view draws again after the menu (${again} frames in 0.5 s)`);
}
