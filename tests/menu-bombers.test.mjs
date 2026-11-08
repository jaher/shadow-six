/**
 * Main-menu flyover (src/ui/menu-bombers.js; user: "Option 1", then "Main menu stills needs work, more realistic
 * please airplanes dont look good there"): over the front end's theatre still a section of daylight Spitfires crosses
 * the sky band at the scene's scale, drops its pairs on a far-ground patch whose bursts clear the card's text and, a
 * moment after each burst, plays the muffled distant boom through the game's audio (quiet, low-passed, pitched a
 * little differently each time). A new card ends a pass in flight; a mission load or leaving the front end stops it
 * all at once — no pass, no smoke, no boom still pending — and test sessions never arm passes on their own.
 */
export default async function menuBombers(page, t) {
  await page.evaluate(() => window.__game.game.hud.screens.openMain());
  const B = 'window.__game.game.hud.backdrop.bombers';
  const st0 = await page.evaluate(`({ blocked: ${B}.blocked, running: ${B}.running, mode: window.__game.game.hud.backdrop.mode })`);
  t(st0.blocked && !st0.running, `a test session never arms passes on its own (${JSON.stringify(st0)})`);
  await page.waitForFunction(() => window.__game.game.hud.backdrop.ready, null, { timeout: 20000 });
  await page.evaluate(`${B}._load()`);
  await page.waitForFunction(() => window.__game.game.hud.backdrop.bombers._ready, null, { timeout: 20000 });
  // a pass with a stand-in audio that records the booms
  const lay = await page.evaluate(() => {
    const b = window.__game.game.hud.backdrop.bombers;
    window.__booms = [];
    b.o.audio = () => ({ unlocked: true, playSfx: (id, pos, o) => { window.__booms.push({ id, o, at: performance.now() }); return {}; } });
    b.running = true;
    b.pass(true);
    const l = b._lay;
    return { L: l.L, pxm: l.pxm, k: l.k, zone: l.zone, targets: l.targets.length, dir: l.dir, w: l.w };
  });
  t(lay.zone && lay.targets === 3, `the section targets a far-ground patch, one point per bomber (${JSON.stringify(lay)})`);
  t(Math.abs(lay.L - 9.47 * lay.zone.pxm * lay.k) < 0.5, `the Spitfires fly at the scene's scale over their patch (${lay.L.toFixed(1)} px long)`);
  await page.waitForFunction(() => window.__game.game.hud.backdrop.bombers._booms.length >= 3, null, { timeout: 20000, polling: 100 });
  const drawn = await page.evaluate(() => {
    const c = window.__game.game.hud.backdrop.planes, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
    return n;
  });
  t(drawn > 500, `the formation and its bursts are drawn in the backdrop's scene (${drawn} px)`);
  const clear = await page.evaluate(() => {
    const bd = window.__game.game.hud.backdrop, b = bd.bombers, R = b._lay.R, m = 0.035 * b._lay.w;
    const text = bd._textRects();
    return { n: text.length, bad: b._booms.filter((x) => text.some((r) => x.x + 5 * R > r.left - m && x.x - 5 * R < r.right + m && x.y - 9 * R < r.bottom + m && x.y + 1.5 * R > r.top - m)).length };
  });
  t(clear.n > 3 && clear.bad === 0, `every burst clears the card's text (${JSON.stringify(clear)})`);
  await page.waitForFunction(() => window.__booms.length >= 2, null, { timeout: 8000, polling: 100 });
  const booms = await page.evaluate(() => window.__booms.slice());
  t(booms.every((x) => x.id === 'explosion_far' && x.o.muffle && x.o.gain <= 0.4), `muffled, quiet distant booms (${JSON.stringify(booms[0])})`);
  t(new Set(booms.map((x) => x.o.rate.toFixed(3))).size > 1, 'each boom pitched a little differently');
  // a new card ends the pass in flight at once (its pending booms too); the passes stay armed
  const st3 = await page.evaluate(() => {
    const hud = window.__game.game.hud, b = hud.backdrop.bombers;
    const before = !!b._pass;
    hud.menus.showOptions();
    return { before, pass: !!b._pass, sounds: b._sounds.length, smoke: b._booms.length, running: b.running, store: b.canvas.width * b.canvas.height };
  });
  t(st3.before && !st3.pass && st3.sounds === 0 && st3.smoke === 0 && st3.running && st3.store === 1, `a new card ends the pass in flight (${JSON.stringify(st3)})`);
  await page.evaluate(() => window.__game.game.hud.screens.openMain());
  // a mission load stops everything at once, the pending booms included
  await page.evaluate(() => { const b = window.__game.game.hud.backdrop.bombers; b.running = true; b.pass(true); });
  await page.waitForFunction(() => window.__game.game.hud.backdrop.bombers._booms.length >= 1, null, { timeout: 20000, polling: 100 });
  const st1 = await page.evaluate(() => {
    const g = window.__game.game, b = g.hud.backdrop.bombers, pending = b._sounds.length;
    g.events.emit('mission:loading', {});
    const c = g.hud.backdrop.planes, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return { pending, pass: !!b._pass, sounds: b._sounds.length, smoke: b._booms.length, running: b.running, px: n, heard: window.__booms.length };
  });
  t(!st1.pass && st1.sounds === 0 && st1.smoke === 0 && !st1.running && st1.px === 0, `mission load stops the flyover at once (${JSON.stringify(st1)})`);
  await page.waitForTimeout(2600);
  const heard = await page.evaluate(() => window.__booms.length);
  t.equal(heard, st1.heard, 'no boom is heard after the menu has gone');
  // leaving the frontend (paper backdrop) also stops a pass in flight
  await page.evaluate(() => { const b = window.__game.game.hud.backdrop.bombers; b.running = true; b.pass(true); });
  await page.waitForFunction(() => !!window.__game.game.hud.backdrop.bombers._pass, null, { timeout: 5000 });
  const st2 = await page.evaluate(() => { const bd = window.__game.game.hud.backdrop; bd.setMode('paper'); return { pass: !!bd.bombers._pass, running: bd.bombers.running }; });
  t(!st2.pass && !st2.running, 'leaving the frontend backdrop stops the flyover');
}
