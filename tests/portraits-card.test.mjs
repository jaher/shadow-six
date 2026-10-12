/**
 * The pop-up speaker card (design-spec §6.3: topbar.speak, mirrored by the talking portraits) shows the speaker's face
 * from the first frame it is on screen to the last — never a blank card (M3 film review: "portrait popup sometimes
 * blank for a frame"). The card pops up on the bark itself, while its clip only comes on once play() has a decoded
 * frame (and fades in), fades out at the end of the line while the card lingers, and a line with no rendered clip
 * plays none: under the clip the card must show the photo still, not the clip host's dark fill. Checked frame by frame
 * (every animation frame while the card is displayed: a clip frame on screen, or the still under a see-through host)
 * for a recorded line, a second speaker taking the card mid-line and a line with no clip (reduced motion); plus the pixels of the card
 * in a screenshot taken as it pops up with its clip not started yet. Real HUD on M1 (GPU headless). Screenshot portraits-card.
 */
export const timeout = 120_000;

export default async function portraitsCard(page, t) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.keyboard.press('Shift'); // first gesture -> AudioContext
  const ok = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m01'); g.start(); g.setZoom(1);
    await G.audio.engine?.ready; await G.audio.preloading;
    const ready = await G.hud.portraitsReady;
    window.__pump = setInterval(() => { g.advance(1 / 60); G.render(1 / 60, 1); }, 16);
    const tp = G.hud.portraits, card = document.querySelector('.hud-speaker-card'), img = card.querySelector(':scope > img');
    /** what the card shows now: 'clip' (a decoded clip frame mostly faded in), 'still' (the photo under a see-through
     *  host), or 'blank' */
    const face = () => {
      const host = tp.card.host;
      const clip = [...host.querySelectorAll('video')].some((v) => v.classList.contains('on') && v.readyState >= 2 && +getComputedStyle(v).opacity >= 0.5);
      if (clip) return 'clip';
      const bg = getComputedStyle(host).backgroundColor, see = bg === 'transparent' || /^rgba\(.*,\s*0\)$/.test(bg);
      return see && img.complete && img.naturalWidth > 0 && +getComputedStyle(img).opacity > 0.5 ? 'still' : 'blank';
    };
    /** run `fire` (a bark), then sample the card every animation frame (before it is painted) until it hides */
    window.__watch = (fire, maxFrames = 400) => new Promise((done) => {
      const seen = [];
      let n = 0;
      const sample = () => { if (!card.hidden) seen.push(face()); };
      fire(G, G.world.commandos);
      sample(); // (the state the first frame with the card will be painted in, before any microtask)
      const f = () => {
        sample();
        if (++n < maxFrames && (!card.hidden || n < 5)) requestAnimationFrame(f); else done(seen);
      };
      requestAnimationFrame(f);
    });
    return { ready, card: !!card, men: G.world.commandos.map((c) => c.role) };
  });
  t.ok(ok.ready && ok.card, `talking portraits up on M1 (${ok.men.join(',')})`);
  const quiet = () => page.waitForFunction(() => document.querySelector('.hud-speaker-card').hidden && !window.__game.game.hud.portraits.talking, null, { timeout: 15000 });
  const run = async (label, fire, wantClip) => {
    await quiet();
    const seen = await page.evaluate((src) => window.__watch(new Function('G', 'men', src)), fire);
    const runs = seen.reduce((a, s) => { if (a.at(-1)?.[0] === s) a.at(-1)[1]++; else a.push([s, 1]); return a; }, []);
    t.log(`${label}: ${runs.map(([s, k]) => `${s}×${k}`).join(' ')}`);
    t.ok(seen.length > 3, `${label}: the card popped up (${seen.length} frames)`);
    t.equal(seen[0], seen[0] === 'clip' ? 'clip' : 'still', `${label}: its first frame shows the speaker (${seen[0]})`);
    t.equal(seen.filter((s) => s === 'blank').length, 0, `${label}: never blank`);
    // (whether the clip comes on before the card goes again depends on the decoder's pace: portraits.test checks the
    // card mirrors the line's clip; here it only must never leave the card blank)
    if (wantClip && !seen.includes('clip')) t.log(`${label}: (the clip did not come on before the card went)`);
    return seen;
  };
  // a recorded acknowledgement (the audio system stamps its take: the exact clip plays, mirrored on the card)
  await run('recorded line', `G.events.emit('bark', { unit: men[0], speaker: men[0].role, line: 'ack_move' });`, true);
  // another man takes the card mid-line
  await run('second speaker mid-line', `
    G.events.emit('bark', { unit: men[0], speaker: men[0].role, line: 'ack_move' });
    setTimeout(() => G.events.emit('bark', { unit: men[1], speaker: men[1].role, line: 'ack_move' }), 120);`, true);
  // a line that plays no clip (reduced motion: portraits keep their still) — the still, the whole time
  await page.evaluate(() => { window.__game.game.hud.kit.reducedMotion = true; });
  await run('line with no clip (reduced motion)', `G.events.emit('bark', { unit: men[1], speaker: men[1].role, line: 'ack_move' });`, false);
  await page.evaluate(() => { window.__game.game.hud.kit.reducedMotion = false; });

  // the pixels: the card as it pops up shows a face (the photo's detail), not a flat dark panel — taken while its clip
  // has not started yet (a slow decode, held back here: play() pending), the moment the film caught it blank
  await quiet();
  const box = await page.evaluate(() => new Promise((ok) => {
    const G = window.__game.game, u = G.world.commandos[0], card = document.querySelector('.hud-speaker-card');
    const tp = G.hud.portraits;
    for (const v of [tp.card.line, tp.slots.get(u)?.line]) if (v) v.play = () => new Promise(() => {});
    G.events.emit('bark', { unit: u, speaker: u.role, line: 'ack_move' });
    requestAnimationFrame(() => { const b = card.getBoundingClientRect(); ok({ x: b.x, y: b.y, w: b.width, h: b.height }); });
  }));
  const png = await page.screenshot({ clip: { x: box.x + 3, y: box.y + 3, width: box.w - 6, height: Math.round(box.h * 0.62) } });
  const px = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d');
    x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, bmp.width, bmp.height).data;
    let s = 0, s2 = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; s += l; s2 += l * l; n++; }
    const mean = s / n;
    return { mean: +mean.toFixed(1), sd: +Math.sqrt(Math.max(0, s2 / n - mean * mean)).toFixed(1) };
  }, png.toString('base64'));
  t.log(`card pixels as it pops up: mean ${px.mean}, sd ${px.sd}`);
  t.ok(px.sd > 30 && px.mean > 45, `the card shows a face as it pops up, not a dark panel (luma mean ${px.mean}, sd ${px.sd})`);
  await t.shot('portraits-card');
  await page.evaluate(() => {
    const G = window.__game.game, tp = G.hud.portraits;
    for (const v of [tp.card.line, ...[...tp.slots.values()].map((s) => s.line)]) delete v.play; // (HTMLMediaElement.prototype.play again)
    clearInterval(window.__pump);
  });
}
