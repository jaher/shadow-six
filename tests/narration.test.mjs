/**
 * The newsreel narrator in the briefing (docs/narration.md), driven silently on the shipped M1 timeline: the title card,
 * then the wartime background (a typed dispatch on screen), then the paragraphs; the voice waits for the music intro,
 * the words appear as they are read, the slides turn with the lines, Space skips a line, N / the speaker button switch
 * it off, Esc goes to the Colonel's tour and stops it. Test mode never plays it by itself.
 * The tour is then heard for real (audio unlocked, `forceVoice`): each caption is the narrator's recorded clip, the
 * camera holds on a stop until he has read it, the music stays ducked, the browser's speech synthesis is never used,
 * and muting leaves the captions to run on alone.
 * Portrait phones (390 x 844 and 390 x 664, touch UI): the text column scrolls above the fixed PREV / NEXT / CONTINUE
 * row, so its last paragraph clears that row once scrolled to, and every line he reads is scrolled fully into view
 * above it, with nothing of the column ever drawn under the row.
 */

export const timeout = 240_000; // the tour runs in real time

/**
 * M7 has the longest part-1 text: on a phone held upright it runs well past one screen. The test page itself becomes
 * the phone (its size, and a finger's first touch, which turns on the touch UI as on a real phone), so it needs no
 * second cold page load, and part 1 opens on M7's text alone; each size then reflows that same briefing.
 */
export async function portraitPhone(page, t, sizes) {
  const vp0 = page.viewportSize();
  try {
    await page.setViewportSize(sizes[0]);
    await page.evaluate(async () => {
      window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
      const { MISSIONS } = await import('./src/missions/index.js');
      const b = window.__game.game.hud.briefing;
      b.forceVoice = false; // silent again: the lines are stepped by hand
      b.open(MISSIONS.find((d) => d.id === 'm07')); // part 1 needs only the mission's text (no map load)
    });
    for (const vp of sizes) {
      const tag = `portrait ${vp.width}x${vp.height}`;
      await page.setViewportSize(vp);
      const r = await page.evaluate(async () => {
        const b = window.__game.game.hud.briefing;
        const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
        const root = document.querySelector('.ui-briefing');
        const box = root.querySelector('.brbox');
        const rowTop = () => Math.min(...[...root.querySelectorAll('.skip, .br-hints')].map((e) => e.getBoundingClientRect())
          .filter((q) => q.height > 0).map((q) => q.top));
        const rect = (e) => { const q = e.getBoundingClientRect(); return { top: Math.round(q.top), bot: Math.round(q.bottom) }; };
        b.stopNarration();
        await sleep(900); // the paragraphs fade in (and the new size settles)
        const o = { part: b.part, touch: document.documentElement.classList.contains('mk-touch'), rowTop: Math.round(rowTop()), box: rect(box),
          content: box.scrollHeight };
        const ps = [...root.querySelectorAll('.text p')];
        const last = ps[ps.length - 1];
        box.scrollTop = box.scrollHeight;
        await sleep(250);
        o.last = { ...rect(last), rowTop: Math.round(rowTop()), boxBot: Math.round(box.getBoundingClientRect().bottom) };
        box.scrollTop = 0;
        await sleep(250);
        const man = await (await fetch('assets/audio/narration/manifest.json')).json();
        const lines = man.missions.m07.lines;
        b.startNarration({ lines });
        for (let k = 0; k < 36; k++) b.update(0.05); // past the music intro: the title card
        o.lines = [];
        o.under = 0; // frames in which the scrolling column reached under the row
        for (let i = 0; i < lines.length; i++) {
          const id = b.narrationState().id, el = root.querySelector('.speaking');
          const inView = () => {
            const q = el.getBoundingClientRect(), bb = box.getBoundingClientRect();
            return q.top >= bb.top - 0.5 && q.bottom <= bb.bottom + 0.5 && q.bottom <= rowTop();
          };
          // the smooth scroll may take a moment to start (seconds on a busy GPU): watch every frame, for up to 6 s,
          // until the line is in view and still
          let still = 0, prev = null;
          for (const t0 = performance.now(); performance.now() - t0 < 6000 && still < 6;) {
            await new Promise((ok) => requestAnimationFrame(ok));
            if (box.getBoundingClientRect().bottom > rowTop() + 0.5) o.under++;
            const q = rect(el);
            still = inView() && prev && q.top === prev.top ? still + 1 : 0;
            prev = q;
          }
          o.lines.push({ id, ...rect(el), rowTop: Math.round(rowTop()), ok: inView() });
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })); // the next line
        }
        b.stopNarration();
        return o;
      });
      await page.screenshot({ path: t.harness.shotPath(`narration-portrait-${vp.width}x${vp.height}.png`) });
      t.log(`${tag}: ${JSON.stringify(r)}`);
      t(r.part === 1 && r.touch && r.content > r.rowTop + 40, `${tag}: a touch phone on the briefing, the M7 text runs past the bottom row (${r.content} px tall)`);
      t(r.box.bot <= r.rowTop, `${tag}: the text column ends above the bottom row (${r.box.bot} <= ${r.rowTop})`);
      t(r.last.bot <= r.last.rowTop && r.last.bot <= r.last.boxBot && r.last.top >= 0,
        `${tag}: scrolled to the end, the last paragraph is fully above the bottom row (${r.last.top}-${r.last.bot}, row at ${r.last.rowTop})`);
      t(r.lines.length >= 4 && r.lines.every((l) => l.ok),
        `${tag}: every line he reads is scrolled fully into view above the row: ${JSON.stringify(r.lines.filter((l) => !l.ok))}`);
      t.equal(r.under, 0, `${tag}: nothing of the text column is ever drawn under the bottom row`);
    }
  } finally {
    if (vp0) await page.setViewportSize(vp0);
  }
}

export default async function narration(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, hud = G.hud, b = hud.briefing;
    await hud.startMission('m01');
    g.render();
    const out = {};
    const root = document.querySelector('.ui-briefing');
    const ps = () => [...root.querySelectorAll('.text p')];
    // a word is out when it has .on (the CSS fades it in) or once the narration is over (.narrating removed)
    const shown = (p) => (root.classList.contains('narrating') ? p.querySelectorAll('.w.on').length : p.querySelectorAll('.w').length);
    out.auto = b.narrationState().active; // manualTick: no voice unless asked
    const man = await (await fetch('assets/audio/narration/manifest.json')).json();
    const lines = man.missions.m01.lines;
    out.ids = lines.map((l) => l.id);
    out.textsMatch = lines.filter((l) => l.id !== 'head').every((l, i) => ps()[i].textContent === l.text);
    // the wartime background (briefing.historical): shown as a typed dispatch under the place line, before the paragraphs
    const disp = root.querySelector('.text .dispatch'), hp = disp?.querySelector('p.hist');
    const cs = hp && getComputedStyle(hp);
    out.hist = { text: hp?.textContent, def: G.missionDef?.briefing?.historical, clip: lines.find((l) => l.id === 'hist')?.text,
      first: ps()[0] === hp, afterPlace: disp?.previousElementSibling?.classList.contains('place'), h: hp?.getBoundingClientRect().height || 0,
      font: cs?.fontFamily || '', rubric: disp?.querySelector('.rubric')?.textContent };
    out.btn = root.querySelector('.narr')?.getAttribute('aria-label');
    out.started = b.startNarration({ lines });
    out.narrating = root.classList.contains('narrating');
    out.hiddenAtStart = ps().every((p) => shown(p) === 0);
    const step = (s) => { for (let k = 0; k < Math.round(s / 0.05); k++) b.update(0.05); };
    step(1.0);
    out.beforeLead = b.narrationState();
    step(0.7);
    out.head = { ...b.narrationState(), slide: b.slide, titleSpeaking: root.querySelector('.title').classList.contains('speaking') };
    step(lines[0].duration + 0.5); // → the background
    out.p0 = { ...b.narrationState(), slide: b.slide, speaking: ps()[0].classList.contains('speaking') };
    step(lines[1].duration * 0.5);
    const n0 = ps()[0].querySelectorAll('.w').length;
    out.half = { shown: shown(ps()[0]), of: n0, p1: shown(ps()[1]) };
    step(lines[1].duration * 0.5 + 0.5); // → p0
    out.p1 = { ...b.narrationState(), slide: b.slide, p0all: shown(ps()[0]) === n0, p0speaking: ps()[0].classList.contains('speaking') };
    // the slides wait for the narrator (no 6 s auto-rotation while he reads a long line)
    const s1 = b.slide;
    step(Math.min(6.5, lines[2].duration - 0.3));
    out.slideHeld = b.slide === s1 && b.narrationState().line === 2;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })); // skip → p1
    out.skip = { ...b.narrationState(), slide: b.slide };
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })); // → p2
    out.skip2 = { ...b.narrationState(), slide: b.slide };
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })); // past the end
    out.end = { ...b.narrationState(), narrating: root.classList.contains('narrating'), allShown: ps().every((p) => shown(p) === p.querySelectorAll('.w').length) };
    out.textAfter = ps().map((p) => p.textContent).join('|') === lines.filter((l) => l.id !== 'head').map((l) => l.text).join('|');
    // N switches the narrator off (and the option persists), the speaker button back on
    b.startNarration({ lines });
    step(2);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN', key: 'n', bubbles: true }));
    out.off = { opt: hud.options.narration, state: b.narrationState().active, label: root.querySelector('.narr').getAttribute('aria-label'), narrating: root.classList.contains('narrating') };
    root.querySelector('.narr').click();
    out.on = { opt: hud.options.narration, label: root.querySelector('.narr').getAttribute('aria-label') };
    // Esc (a real key press below) → the Colonel's tour; the narration stops there
    b.startNarration({ lines });
    step(2);
    out.beforeEsc = b.narrationState().started;
    return out;
  });
  await page.keyboard.press('Shift'); // the first gesture unlocks the audio
  await page.evaluate(() => {
    const b = window.__game.game.hud.briefing;
    b.forceVoice = true; // hear the real clips in test mode
    // any use of the browser's own voice is counted (there must be none)
    const calls = (window.__ssCalls = { speak: 0, utter: 0 });
    if (window.speechSynthesis) window.speechSynthesis.speak = () => { calls.speak++; };
    window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance() { calls.utter++; };
  });
  await page.keyboard.press('Escape');
  r.tour = await page.evaluate(async () => {
    const G = window.__game.game, b = G.hud.briefing, a = G.audio, nar = a.narrator;
    const o = { part: b.part, narr: b.narrationState().active, stops: b.stops?.length, unlocked: a.unlocked, ctx: a.engine?.ctx?.state };
    const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
    // run the tour in real time (the clips play on the audio clock): 50 ms steps; `rt` is the wall clock (a loaded
    // machine stretches the steps, the audio does not wait)
    const log = [];
    const t0 = performance.now();
    let t = 0;
    const run = async (secs, until) => {
      for (const end = t + secs; t < end; t += 0.05) {
        await sleep(50);
        b.update(0.05);
        a._musicTick();
        const v = b.tourVoiceState();
        log.push({ t, rt: (performance.now() - t0) / 1000, stop: b.stopIx, playing: v.playing, text: v.text, sub: b.sub.textContent, duck: a.musicDir.ducked, session: nar.session });
        if (until?.()) return true;
      }
      return false;
    };
    await run(6, () => b.tourVoiceState().playing);
    const first = log.find((e) => e.playing);
    o.first = first && { t: first.t, rt: first.rt, stop: first.stop, text: first.text, sub: first.sub, stopText: b.stops[0].text, duck: first.duck };
    o.clip = nar.tourLine(b.stops[0].text);
    o.bufDur = nar.cur?.src?.buffer?.duration;
    // stop 0 is held until his line is over (+ the pause), then the camera moves on and he reads stop 1
    await run(25, () => b.stopIx === 1 && b.tourVoiceState().playing);
    const adv = log.find((e) => e.stop === 1);
    const lastPlaying0 = [...log].reverse().find((e) => e.stop === 0 && e.playing);
    o.advance = adv && { t: adv.t, rt: adv.rt, lastPlaying0: lastPlaying0?.rt, text1: b.tourVoiceState().text, stop1: b.stops[1]?.text, sub1: b.sub.textContent };
    o.duckAll = log.filter((e) => e.t > (first?.t ?? 0) + 0.3).every((e) => e.duck && e.session);
    // N: the narrator off on the tour too (the caption stays), back on reads the current caption again
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN', key: 'n', bubbles: true }));
    o.nOff = { opt: G.hud.options.narration, voice: b.tourVoiceState().active, sub: b.sub.textContent, session: nar.session };
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN', key: 'n', bubbles: true }));
    o.nOn = { opt: G.hud.options.narration, voice: b.tourVoiceState().active, text: b.tourVoiceState().text };
    // muted: the voice stops at once, the caption stays and the tour runs on at the text pace
    a.setMuted(true);
    b.update(0.05);
    o.muted = { voice: b.tourVoiceState().active, sub: b.sub.textContent, session: nar.session, stop: b.stopIx };
    for (let k = 0; k < 140; k++) b.update(0.05); // 7 s > the text pace of a caption
    o.mutedNext = { stop: b.stopIx, voice: b.tourVoiceState().active };
    a.setMuted(false);
    o.ss = { ...window.__ssCalls };
    b.finish();
    o.after = { part: b.part, session: nar.session, ducking: nar.ducking };
    return o;
  });
  t.log(JSON.stringify(r));
  t.equal(r.auto, false, 'test mode: no narration by itself');
  t.equal(JSON.stringify(r.ids), JSON.stringify(['head', 'hist', 'p0', 'p1', 'p2']), 'M1: title card + background + 3 paragraphs');
  t(r.textsMatch, 'the narrated text is the on-screen text');
  t(r.hist.text && r.hist.text === r.hist.def && r.hist.text === r.hist.clip, 'the background (briefing.historical) is on screen and is what he reads');
  t(r.hist.first && r.hist.afterPlace && r.hist.h > 20, `background shown as a dispatch under the place line (${Math.round(r.hist.h)} px)`);
  t(/Special Elite/.test(r.hist.font) && r.hist.rubric === 'Background', `typed dispatch (${r.hist.font})`);
  t.equal(r.btn, 'Narration: On', 'speaker button, on by default');
  t(r.started && r.narrating, 'narration starts');
  t(r.hiddenAtStart, 'the paragraphs wait for the voice');
  t(r.beforeLead.active && !r.beforeLead.started, 'the voice waits for the music intro');
  t(r.head.started && r.head.id === 'head' && r.head.slide === 0 && r.head.titleSpeaking, 'title card first, on slide 1');
  t(r.p0.id === 'hist' && r.p0.slide === 1 && r.p0.speaking, 'the background right after the title card, with slide 2');
  t(r.half.shown > 2 && r.half.shown < r.half.of && r.half.p1 === 0, `words appear as they are read (${r.half.shown}/${r.half.of})`);
  t(r.p1.id === 'p0' && r.p1.slide === 2 && r.p1.p0all && !r.p1.p0speaking, 'next line: map slide, the background complete');
  t(r.slideHeld, 'slides wait for the narrator');
  t(r.skip.id === 'p1' && r.skip.slide === 3, 'Space skips to the next line and page');
  t(r.skip2.id === 'p2' && r.skip2.slide === 0, 'and again (the slides wrap)');
  t(!r.end.active && !r.end.narrating && r.end.allShown, 'past the last line: narration over, all text shown');
  t(r.textAfter, 'text unchanged by the word spans');
  t(r.off.opt === false && !r.off.state && r.off.label === 'Narration: Off' && !r.off.narrating, 'N: narration off');
  t(r.on.opt === true && r.on.label === 'Narration: On', 'speaker button: narration on');
  t(r.beforeEsc, 'narrating when Esc is pressed');
  const tr = r.tour;
  t(tr.part === 2 && !tr.narr && tr.stops > 0, 'Esc: the Colonel\'s tour, narration stopped');
  t(tr.unlocked && tr.first, `the narrator reads the tour (audio ${tr.ctx})`);
  t(tr.first?.stop === 0 && tr.first.text === tr.first.stopText && tr.first.sub === tr.first.stopText, 'stop 1: his clip is the caption on screen');
  t(tr.clip && Math.abs((tr.bufDur ?? 0) - tr.clip.duration) < 0.1, `playing the recorded tour clip (${tr.bufDur?.toFixed(2)} s)`);
  t(tr.first?.t <= 0.6, `he speaks as the camera sets off (${tr.first?.t.toFixed(2)} s)`);
  // wall clock: his clip started at first.rt (to within a step) and the stop moved on after it ended plus the pause
  t(tr.advance && tr.advance.rt >= tr.first.rt + tr.clip.duration - 0.25 && tr.advance.lastPlaying0 >= tr.first.rt + tr.clip.duration - 0.6,
    `the camera holds on the stop until he has read it (moved at ${tr.advance?.rt.toFixed(2)} s, clip from ${tr.first?.rt.toFixed(2)} s for ${tr.clip?.duration} s)`);
  t(tr.advance?.text1 === tr.advance?.stop1 && tr.advance?.sub1 === tr.advance?.stop1, 'stop 2: the next caption, read by him');
  t(tr.duckAll, 'the music stays ducked through the tour, between captions too');
  t(tr.nOff.opt === false && !tr.nOff.voice && tr.nOff.sub && !tr.nOff.session, 'N on the tour: narrator off, caption stays, music back up');
  t(tr.nOn.opt === true && tr.nOn.voice && tr.nOn.text === tr.advance?.stop1, 'N again: he reads the current caption');
  t(!tr.muted.voice && tr.muted.sub && !tr.muted.session, 'muted: the voice stops, the caption stays');
  t(tr.mutedNext.stop > tr.muted.stop && !tr.mutedNext.voice, 'muted: the tour runs on with text alone');
  t(tr.ss.speak === 0 && tr.ss.utter === 0, `no browser speech synthesis (${JSON.stringify(tr.ss)})`);
  t(tr.after.part === 0 && !tr.after.session && !tr.after.ducking, 'mission start: the voice is gone and the music comes back');
  await portraitPhone(page, t, [{ width: 390, height: 844 }, { width: 390, height: 664 }]);
}
