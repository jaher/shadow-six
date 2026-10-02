/**
 * Nothing on the briefing screen shakes (the user's report: "when it's doing the briefing the screen vibrates
 * sometimes"). Every frame, the positions of what is on screen are sampled and none may reverse direction by more
 * than a hair: a reversal from one frame to the next is a vibration.
 *  - Part 1 (M7, the longest text), at 1280 x 720 and on touch phones held upright (390 x 664) and sideways
 *    (750 x 340): the narrator's lines are stepped through while the text column scrolls each one into view
 *    (one way only), the layout holds still, and the slides turn — the photo dissolving out keeps its Ken Burns frame
 *    (it used to snap back to scale 1 mid-fade) and the film-gate flash no longer jogs the frame.
 *  - Part 2, the Colonel's tour (M7 on the three screens, M13), driven frame by frame with an uneven frame time like a
 *    busy phone's: the camera flies to each stop in one direction per axis, arrives on the stop's own framing (the
 *    stop midway between the letterbox bars, where the map edge allows) and holds still there; no user scrolling can
 *    fight it while it flies. The old per-frame ease (centerOn of
 *    cur + (stop − cur)·2.5·dt) never settled: centerOn frames a point below the HUD bar, so each frame chased the stop
 *    from a target shifted up-screen, and its resting place moved with the frame time — the map shook by tens of px.
 */

export const timeout = 240_000;

/** Count reversals in a series with a dead band: a turn counts once it has come back more than `eps`. */
function reversals(vals, eps) {
  let dir = 0, ext = vals[0], piv = vals[0], n = 0, max = 0;
  for (const v of vals) {
    if (dir === 0) {
      if (v - piv > eps) { dir = 1; ext = v; } else if (piv - v > eps) { dir = -1; ext = v; }
    } else if (dir > 0) {
      if (v > ext) ext = v;
      else if (ext - v > eps) { n++; max = Math.max(max, ext - v); dir = -1; ext = v; }
    } else if (v < ext) ext = v;
    else if (v - ext > eps) { n++; max = Math.max(max, v - ext); dir = 1; ext = v; }
  }
  return { n, max };
}

/** Split per-frame samples {k: value|null} into runs of consecutive frames per key and count their reversals. */
function shakes(frames, eps) {
  const runs = new Map();
  const out = [];
  const flush = (k) => {
    const r = runs.get(k);
    if (r && r.length > 2) { const q = reversals(r, eps); if (q.n) out.push({ k, ...q, max: +q.max.toFixed(2) }); }
    runs.delete(k);
  };
  const keys = new Set(frames.flatMap((f) => Object.keys(f)));
  for (const f of frames) {
    for (const k of keys) {
      const v = f[k];
      if (v == null || !Number.isFinite(v)) flush(k);
      else { if (!runs.has(k)) runs.set(k, []); runs.get(k).push(v); }
    }
  }
  for (const k of [...runs.keys()]) flush(k);
  return out;
}

/** In the page: step M7's narration line by line (Space) and sample the screen every frame. */
async function partOne(page) {
  return page.evaluate(async () => {
    const b = window.__game.game.hud.briefing;
    const root = document.querySelector('.ui-briefing');
    const raf = () => new Promise((ok) => requestAnimationFrame(ok));
    const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
    const man = await (await fetch('assets/audio/narration/manifest.json')).json();
    const lines = man.missions.m07.lines;
    b.stopNarration();
    const text = root.querySelector('.text'), box = root.querySelector('.brbox');
    text.scrollTop = 0;
    box.scrollTop = 0;
    await sleep(900); // the paragraphs fade in
    b.startNarration({ lines });
    for (let k = 0; k < 36; k++) b.update(0.05); // past the music intro: the title card
    const frames = [];
    const snaps = []; // the photo going out: its transform just before and just after the page turn
    const tf = (e) => { const m = new DOMMatrix(getComputedStyle(e).transform === 'none' ? undefined : getComputedStyle(e).transform); return m; };
    const sample = () => {
      const f = { textTop: text.scrollTop, boxTop: box.scrollTop, rootTop: root.scrollTop, doc: document.scrollingElement.scrollTop };
      for (const [n, sel] of [['slides', '.slides'], ['title', '.title'], ['text', '.text'], ['hints', '.br-hints'], ['narr', '.narr']]) {
        const e = root.querySelector(sel), q = e?.getBoundingClientRect();
        if (q && q.height) { f[`${n}.y`] = q.top; f[`${n}.x`] = q.left; f[`${n}.h`] = q.height; }
      }
      root.querySelectorAll('.slide').forEach((s, i) => {
        if (+getComputedStyle(s).opacity < 0.02) return; // not seen: cannot be seen to move
        const se = tf(s), img = s.querySelector('img, svg');
        f[`slide${i}.x`] = se.e; // the frame itself (the film-gate flash used to jog it)
        f[`slide${i}.y`] = se.f;
        if (img) { // the Ken Burns: the photo's drawn box inside the frame
          const q = img.getBoundingClientRect(), fr = s.getBoundingClientRect();
          f[`photo${i}.w`] = q.width;
          f[`photo${i}.x`] = q.left - fr.left;
          f[`photo${i}.y`] = q.top - fr.top;
        }
      });
      frames.push(f);
    };
    let reads = 0;
    for (let i = 0; i < lines.length; i++) {
      const t0 = performance.now();
      while (performance.now() - t0 < 1400) { await raf(); sample(); }
      // the photo on screen is well into its Ken Burns when the page turns (as after a few seconds of a real line)
      const on = root.querySelector('.slide.on'), img = on?.querySelector('img, svg');
      const kb = img?.getAnimations().find((a) => /br-kb/.test(a.animationName));
      if (kb) kb.currentTime = 4200;
      await raf();
      sample();
      const before = img && tf(img).a;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })); // his next line
      const after = img && tf(img).a;
      if (img) snaps.push({ before: +before.toFixed(5), after: +after.toFixed(5) });
      reads++;
    }
    const t0 = performance.now();
    while (performance.now() - t0 < 900) { await raf(); sample(); }
    b.stopNarration();
    return { frames, snaps, reads, scrolled: Math.max(text.scrollTop, box.scrollTop) };
  });
}

/** In the page: the Colonel's tour, frame by frame with an uneven frame time; per frame the camera and the stop on screen. */
async function tour(page) {
  return page.evaluate(async () => {
    const G = window.__game.game, b = G.hud.briefing, rig = G.cameraRig;
    G.stop(); // the frames below are the only ones
    try {
      b.next(); // → part 2
      const o = { stops: b.stops.length, frames: [], arrive: [] };
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const dts = [1 / 60, 1 / 60, 1 / 30, 1 / 60, 1 / 20, 1 / 120, 1 / 30, 1 / 60, 1 / 15];
      rig.setPointer(2, Math.round(rig.canvasH / 2), true, true); // the mouse resting on the left screen edge
      for (let i = 0; i < b.stops.length; i++) {
        if (i) b.gotoStop(i);
        const s = b.stops[i];
        let t = 0;
        const seg = [];
        while (t < 3.2) { // the longest fly (2.2 s) and a hold, under the stop's own pace (4.5 s)
          const dt = dts[Math.floor(rnd() * dts.length)];
          t += dt;
          G.frame(dt);
          const cc = G.cameraController, ppm = cc.pxPerMeter();
          const p = cc.worldToScreen(s.x, 0, s.z);
          seg.push({ camX: cc.target.x * ppm, camZ: cc.target.z * ppm, stopX: p.x, stopY: p.y, t });
        }
        const cc = G.cameraController, a = b._tourAim(cc, s), f = cc.focusTarget(a.x, a.z);
        const last = seg[seg.length - 1], hold = seg.filter((q) => q.t > 2.4);
        // the strip of map between the letterbox bars (their layout boxes: the bars slide in by transform)
        const root = document.querySelector('.ui-briefing'), top = root.querySelector('.bar.top'), bot = root.querySelector('.bar.bottom');
        const strip = [top.offsetTop + top.offsetHeight, bot.offsetTop];
        o.arrive.push({ kind: s.kind, off: +Math.hypot(cc.target.x - f.x, cc.target.z - f.z).toFixed(3),
          heldPx: +Math.max(...hold.map((q) => Math.hypot(q.camX - last.camX, q.camZ - last.camZ))).toFixed(2), locked: rig.panLocked,
          y: Math.round(last.stopY), x: Math.round(last.stopX), strip, w: innerWidth,
          seen: last.stopY > strip[0] && last.stopY < strip[1] && last.stopX > 0 && last.stopX < innerWidth });
        o.frames.push(seg.map(({ t, ...q }) => q));
      }
      rig.setPointer(0, 0, false, false);
      b.close(); // (finish() would also start the mission)
      G.frame(1 / 60);
      o.lockedAfter = rig.panLocked;
      return o;
    } finally {
      G.run();
    }
  });
}

function checkPartOne(t, tag, r) {
  const bad = shakes(r.frames, 0.25);
  t.log(`${tag} part 1: ${r.frames.length} frames, ${r.reads} lines, scrolled ${Math.round(r.scrolled)} px, reversals ${JSON.stringify(bad)}`);
  t(r.frames.length > 100 && r.reads >= 5, `${tag}: the narrator's lines were stepped through (${r.reads})`);
  t.equal(JSON.stringify(bad), '[]', `${tag}: nothing on the part-1 screen reverses direction (scroll, column, title, slides, photos)`);
  const snapped = r.snaps.filter((q) => Math.abs(q.before - q.after) > 1e-4);
  t.equal(JSON.stringify(snapped), '[]', `${tag}: the photo dissolving out holds its Ken Burns frame`);
}

function checkTour(t, tag, r) {
  const bad = r.frames.map((seg, i) => ({ i, s: shakes(seg, 0.5) })).filter((q) => q.s.length);
  t.log(`${tag} tour: ${r.stops} stops, arrive ${JSON.stringify(r.arrive)}, reversals ${JSON.stringify(bad)}`);
  t(r.stops >= 3, `${tag}: a tour with stops (${r.stops})`);
  t.equal(JSON.stringify(bad), '[]', `${tag}: the tour camera and the stop on screen never reverse direction (uneven frame time)`);
  t(r.arrive.every((a) => a.off < 0.05), `${tag}: the camera arrives on each stop's framing: ${JSON.stringify(r.arrive.map((a) => a.off))} m off`);
  t(r.arrive.every((a) => a.seen), `${tag}: each stop ends up on the map between the letterbox bars: ${JSON.stringify(r.arrive.filter((a) => !a.seen))}`);
  t(r.arrive.every((a) => a.heldPx < 0.5), `${tag}: and holds still there: ${JSON.stringify(r.arrive.map((a) => a.heldPx))} px`);
  t(r.arrive.every((a) => a.locked) && !r.lockedAfter, `${tag}: no user scrolling while the tour flies (back after)`);
}

export default async function briefingSteady(page, t) {
  // desktop: M7 loaded for real (part 1, then its tour)
  await page.evaluate(async () => {
    const hud = window.__game.game.hud;
    await hud.startMission('m07');
    window.__game.render();
  });
  checkPartOne(t, '1280x720', await partOne(page));
  checkTour(t, '1280x720 m07', await tour(page));
  // phones (touch UI), upright and sideways: part 1 of the same mission, then its tour
  const vp0 = page.viewportSize();
  try {
    for (const vp of [{ width: 390, height: 664 }, { width: 750, height: 340 }]) {
      await page.setViewportSize(vp);
      await page.evaluate(async () => {
        window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
        const { MISSIONS } = await import('./src/missions/index.js');
        window.__game.game.hud.briefing.open(MISSIONS.find((d) => d.id === 'm07'));
      });
      const tag = `${vp.width}x${vp.height}`;
      checkPartOne(t, tag, await partOne(page));
      checkTour(t, `${tag} m07`, await tour(page));
    }
  } finally {
    if (vp0) await page.setViewportSize(vp0);
  }
  // a second map (M13), desktop: its tour
  await page.evaluate(async () => {
    const hud = window.__game.game.hud;
    await hud.startMission('m13');
    window.__game.render();
  });
  checkTour(t, '1280x720 m13', await tour(page));
}
