#!/usr/bin/env node
/**
 * Film the Spy + truck scene in the m00 sandbox (headless Chromium, ?test=1), for the user clip
 * (2026-10-21: "when the spy goes into the truck and it has the nazi clothes, it should jump in with
 * those clothes"). The Spy stands by a truck in plain clothes with the uniform in her kit, boards,
 * sits a beat, steps out and walks off. Same script on a pristine tree films the BEFORE.
 *   node tools/solutions/film-spytruck.mjs --out <dir>
 * Driven from Node in small page calls (no long evaluate): setup is kicked off in the page and polled;
 * each frame is 2 sim ticks + a render, screenshotted from Node via CDP. Output: <dir>/frames/*.jpg, 30 fps.
 */
import { startHarness } from '../../tests/harness.mjs';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', '/tmp/spytruck-film');
const W = 1280, H = 720;
const PRESET = opt('preset', ''); // '' = the game's default pipeline (a named preset washes the test-mode cone overlay solid)
const MAXF = +(opt('maxf', 0) || 400);
const FR = join(OUT, 'frames');
rmSync(FR, { recursive: true, force: true });
mkdirSync(FR, { recursive: true });

const h = await startHarness({ swiftshader: true, viewport: { width: W, height: H } });
let nFrames = 0, result = null;
try {
  const page = await h.newPage({ width: W, height: H });
  page.setDefaultTimeout(0);
  await page.addInitScript(() => addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style');
    st.textContent = '#dbg-info,#dbg-btn,#dbg-sol-btn,#dbg-wt-btn{display:none!important}';
    document.head.appendChild(st);
  }));
  await h.openGame(page, '?test=1');
  const cdp = await page.context().newCDPSession(page);

  // ---- setup: kicked off in the page, polled from here (loadMission outlasts one evaluate timeout)
  await page.evaluate((PRESET) => {
    window.__scene = { done: false, error: null };
    (async () => {
      try {
        const G = window.__game, g = G.game;
        await G.loadMission('m00');
        G.start();
        g.stop(); // (?test=1: the page's own rAF loop still draws, with real dt, while a frame is awaited — it ran the animations ~3x fast)
        const w = g.world;
        const { Commando } = await import('/src/entities/commando.js');
        const truck = w.spawnVehicle('truck', { x: 18, z: 27, heading: 0 });
        const spy = w.add(new Commando({ role: 'spy', x: 14.2, z: 29.6, heading: 0.5 }));
        spy.gainItem('uniform', 1); // the clothes, in her kit — not on
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:99999;pointer-events:none;font:600 19px/1.35 Georgia,serif;color:#f3ead2;'
          + 'text-shadow:0 1px 3px #000,0 0 8px #000;background:rgba(20,16,10,.55);padding:8px 13px;border-radius:4px';
        ov.id = 'capStep';
        ov.textContent = '1 · The Spy, in plain clothes — the German uniform is in her kit';
        document.body.append(ov);
        if (PRESET) G.setPreset(PRESET);
        G.centerOn(18.5, 28.5);
        G.setZoom(0.85);
        window.__scene = { done: true, error: null, truck, spy, t0: w.time };
      } catch (e) { window.__scene = { done: true, error: String(e?.stack || e) }; }
    })();
  }, PRESET);
  await page.waitForFunction(() => window.__scene?.done, null, { timeout: 300000 });
  const setupErr = await page.evaluate(() => window.__scene.error);
  if (setupErr) throw new Error('scene setup: ' + setupErr);

  const snap = () => page.evaluate(() => {
    const s = window.__scene, w = window.__game.game.world;
    return { t: w.time - s.t0, state: s.spy.state, busy: !!s.spy.currentAction, disguised: s.spy.disguised, alive: s.spy.alive };
  });
  const act = (fn) => page.evaluate(fn);
  const say = (text) => page.evaluate((t) => { document.getElementById('capStep').textContent = t; }, text);
  // (3 ticks, then a render over the same 3 ticks: the page's rAF loop is stopped, so this render is what animates the models)
  const stepFrame = () => page.evaluate(() => { const G = window.__game; G.step(); G.step(); G.step(); G.game.render(3 * G.CONFIG.sim.dt, 1); });

  // ---- the scene, directed from here (3 ticks per frame = 20 fps)
  const out = { disguisedInTruck: null, disguisedAfterExit: null, hasUniformAfter: null };
  let phase = 0, exitAt = 0, walkAt = 0, endAt = 0;
  try {
    for (let f = 0; f < MAXF; f++) {
      const s = await snap();
      if (phase === 0 && s.t >= 1.2) { phase = 1; await say('2 · She gets into the truck'); await act(() => { const s2 = window.__scene; s2.spy.issue({ type: 'ability', id: 'enterVehicle', target: s2.truck }); }); }
      else if (phase === 1 && s.state === 'inVehicle') { phase = 2; out.disguisedInTruck = s.disguised; exitAt = s.t + 1.0; }
      else if (phase === 2 && s.t >= exitAt) { phase = 3; await say('3 · She steps out'); await act(() => { const s2 = window.__scene; s2.spy.issue({ type: 'ability', id: 'leaveVehicle', target: s2.spy }); }); }
      else if (phase === 3 && s.state === 'active' && !s.busy) { phase = 4; out.disguisedAfterExit = s.disguised; out.hasUniformAfter = await page.evaluate(() => window.__scene.spy.has('uniform')); walkAt = s.t + 0.6; }
      else if (phase === 4 && s.t >= walkAt) { phase = 5; await act(() => { window.__scene.spy.issue({ type: 'move', x: 9.5, z: 34.5 }); }); endAt = s.t + 3.0; }
      else if (phase === 5 && s.t >= endAt) break;
      await stepFrame();
      const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
      writeFileSync(join(FR, String(nFrames).padStart(6, '0') + '.jpg'), Buffer.from(r.data, 'base64'));
      nFrames++;
      if (nFrames % 20 === 0) console.log(`frame ${nFrames} phase ${phase} t=${s.t.toFixed(1)}`);
    }
    out.alive = (await snap()).alive;
  } catch (e) {
    console.log('FILM STOPPED EARLY:', String(e?.message || e).slice(0, 200), 'page errors:', JSON.stringify(h.errors(page).slice(0, 5)));
    out.stoppedEarly = true;
  }
  result = out;
  console.log('SCENE', JSON.stringify(result));
} finally {
  await h.close();
}
console.log(`frames ${nFrames} (${(nFrames / 20).toFixed(1)} s at 20 fps) -> ${FR}`);
