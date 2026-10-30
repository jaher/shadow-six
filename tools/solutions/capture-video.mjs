#!/usr/bin/env node
/**
 * Film a mission solution in the real game (headless GPU Chromium, ?test=1): JPEG frames + a timeline for the mix.
 *   node tools/solutions/capture-video.mjs m03 --out <dir> [--max-frames N] [--fps 30] [--size 1280x720]
 *     [--no-opening] [--opening-sec 17] [--dry]
 *
 * Pass 1 plays the solution logic-only (no frames, ~15 s) to learn WHEN things happen (kills, objectives,
 * checkpoints). Pass 2 reloads the mission and plays it again, this time drawing: every tick is Game.step(dt) and
 * a frame is rendered (Game.render(elapsed, 1), so the character models animate) and grabbed every N ticks, N set by
 * a speed director (fast-forward through waits, real time around the kills and blasts it knows from pass 1). The
 * camera follows the commando the script last gave an order (the raft when he is aboard), pulled to the kills and
 * blasts. The caption overlay (stage, step, clock, speed) is a DOM layer captured with the canvas.
 * The solution itself is unchanged: the same orders, the same waits; frames are taken from inside its `step`.
 * Any mission with a tools/solutions/<id>.solution.mjs can be filmed: tools/solutions/<id>.cut.mjs (titles, captions,
 * title / end cards, shots, windows, follows, timed notes) is optional — without it the stage titles and step captions come from the
 * mission's walkthrough file (<id>.walkthrough.mjs) or the solution's own stage / checkpoint names, and the cards are
 * built from the mission's briefing data.
 * Art opening (tools/solutions/film-opening.mjs): before the solution a slow pan over the places of the game's own
 * briefing tour (objectives, danger, extraction, the team's start) in a world of its own, stepped in real time and
 * discarded, under the mission's title card (≤ 20 s; --no-opening to skip). The solution then runs on a fresh load.
 * Sound: the game's own audio handlers (src/audio/event-map.js installHandlers) listen to the filmed run through a
 * recorder, so the timeline carries a cue sheet (what the game would have played, when, where) for mix-video.mjs.
 * Output: <out>/frames/000000.jpg…, <out>/timeline.json (frames: t, speed, card, camera; events with frame indices;
 * both passes' checkpoints, to check that drawing did not change the run; `mission` and `audio` for the mix).
 */
import { startHarness } from '../../tests/harness.mjs';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const id = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--dry', '--no-opening'].includes(args[i - 1])));
if (!id) { console.error('usage: capture-video.mjs <mission id, e.g. m01> --out <dir> [--no-opening] [--opening-sec 17] [--max-frames N] [--dry]'); process.exit(2); }
const OUT = opt('out', '/tmp/capture');
const FPS = +opt('fps', 30);
const [W, H] = opt('size', '1280x720').split('x').map(Number);
const MAX_FRAMES = +opt('max-frames', 0) || Infinity;
const DRY = args.includes('--dry'); // no frames: only the cut's timing (video length per stage), to tune the pacing
const OPENING_SEC = args.includes('--no-opening') ? 0 : +opt('opening-sec', 17); // the art opening's budget (s); 0 = none
const FR = join(OUT, 'frames');
const HERE = dirname(fileURLToPath(import.meta.url));
const HAS = { cut: existsSync(join(HERE, `${id}.cut.mjs`)), walkthrough: existsSync(join(HERE, `${id}.walkthrough.mjs`)) }; // (the optional files: imported only when there, so the page logs no 404)
rmSync(FR, { recursive: true, force: true });
mkdirSync(FR, { recursive: true });

const h = await startHarness({ viewport: { width: W, height: H } });
let result = null;
const frames = [];
let nFrames = 0;
try {
  const page = await h.newPage({ width: W, height: H });
  page.setDefaultTimeout(0);
  page.on('console', (m) => { const t = m.text(); if (/^(CHECKPOINT|==|CAP)/.test(t)) console.log(t); });
  // recordings stay clean: no debug corner (info HUD, DEBUG buttons) in a frame, whatever the URL carries
  await page.addInitScript(() => addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style');
    st.textContent = '#dbg-info,#dbg-btn,#dbg-sol-btn,#dbg-wt-btn{display:none!important}';
    document.head.appendChild(st);
  }));
  await h.openGame(page, '?test=1');
  const cdp = await page.context().newCDPSession(page);
  let tShot = 0;
  await page.exposeFunction('__capFrame', async (meta) => {
    if (nFrames >= MAX_FRAMES) return false;
    const t0 = Date.now();
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
    tShot += Date.now() - t0;
    writeFileSync(join(FR, String(nFrames).padStart(6, '0') + '.jpg'), Buffer.from(r.data, 'base64'));
    frames.push(meta);
    nFrames++;
    if (nFrames % 300 === 0) console.log(`CAP frame ${nFrames} t=${meta.t.toFixed(1)} speed=${meta.speed.toFixed(1)} (shot avg ${(tShot / nFrames).toFixed(0)} ms)`);
    return nFrames < MAX_FRAMES;
  });
  result = await page.evaluate(directorMain, { id, FPS, DRY, OPENING_SEC, HAS, MAX_FRAMES: Number.isFinite(MAX_FRAMES) ? MAX_FRAMES : 0 });
  if (DRY) { frames.push(...result.dryFrames); nFrames = frames.length; delete result.dryFrames; }
  result.errors = h.errors(page).slice(0, 20);
} finally {
  await h.close();
}
if (DRY) summarize();
writeFileSync(join(OUT, DRY ? 'timeline-dry.json' : 'timeline.json'), JSON.stringify({ id, fps: FPS, size: [W, H], frames, ...result }));
console.log(`frames ${nFrames}; pass1 ${result.pass1.state} t=${result.pass1.time.toFixed(1)}; pass2 ${result.pass2.state} t=${result.pass2.time.toFixed(1)} detections=${result.pass2.detections} error=${result.pass2.error}`);
console.log(`cone probe (every tick, every live cone): pass1 ${result.pass1.exposures.length} exposures, pass2 ${result.pass2.exposures.length}${[...result.pass1.exposures, ...result.pass2.exposures].slice(0, 6).map((x) => '\n  ' + x).join('')}`);

/** --dry: video seconds per checkpoint step and the speeds used */
function summarize() {
  const cps = result.pass2.checkpoints;
  let prev = { name: 'start', t: 0 };
  for (const c of [...cps, { name: 'end', t: 1e9 }]) {
    const fr = frames.filter((f) => f.t >= prev.t && f.t < c.t && f.speed > 0);
    console.log(`${prev.name.split(' ')[0].padEnd(5)}-> ${c.name.split(' ')[0].padEnd(4)} video ${(fr.length / FPS).toFixed(1).padStart(5)} s, max ${Math.max(0, ...fr.map((f) => f.speed)).toFixed(1)}x`);
    prev = c;
  }
  console.log(`total ${(frames.length / FPS).toFixed(1)} s`);
}

/* ------------------------------------------------------------------ in the page */
async function directorMain({ id, FPS, DRY, OPENING_SEC, HAS, MAX_FRAMES }) {
  const G = window.__game, g = G.game, dt = G.CONFIG.sim.dt;
  const { makeDriver } = await import('/tools/solutions/driver.mjs');
  const { solve } = await import(`/tools/solutions/${id}.solution.mjs`);
  const { boardPoint } = await import('/src/abilities/drive.js');
  const CUT = HAS.cut ? await import(`/tools/solutions/${id}.cut.mjs`) : {}; // (optional: a mission without a cut uses the generic director)
  const WT = HAS.walkthrough ? (await import(`/tools/solutions/${id}.walkthrough.mjs`)).WALKTHROUGH || null : null; // (optional: chapters / step texts)
  const { tourStops } = await import('/src/ui/tour.js');
  const { planOpening, openingAt, cardAlpha } = await import('/tools/solutions/film-opening.mjs');
  const { captionPlan, captionQueue } = await import('/tools/solutions/film-captions.mjs'); // (which step text is up when: a cut's by checkpoint, else the walkthrough's, one step ahead)
  const { standHeight } = await import('/tools/solutions/film-camera.mjs'); // (the ground the view is centred on: a deck's height, not the terrain relief's)
  const { installHandlers } = await import('/src/audio/event-map.js');
  const { ScopeShow } = await import('/src/debug/walkthrough-scope.js');
  const { ambienceFor } = await import('/src/audio/manifest.js');
  const { startCueFor, missionNumber } = await import('/src/audio/music-cues.js');
  // stage titles / step captions: the cut's, else the walkthrough's (chapter title; a step's first sentence), else the solution's own names
  const wtChapter = new Map((WT?.chapters || []).map((c) => [String(c.id), c]));
  const TITLES = new Proxy(CUT.TITLES || {}, { get: (o, k) => o[k] ?? (wtChapter.has(String(k)) ? `${k} · ${wtChapter.get(String(k)).title}` : undefined) });

  /** listeners shared by both passes: kills (with where), objectives done */
  const watch = (w, sink) => {
    const offs = [];
    offs.push(w.events.on('unit:killed', (p) => { const b = p.by ?? p.killer ?? p.source; sink.push({ t: w.time, kind: 'kill', tag: p.unit?.tag, who: p.unit?.kind, by: b?.role ?? b?.tag, x: p.unit?.x, y: p.unit?.y ?? 0, z: p.unit?.z }); }));
    offs.push(w.events.on('explosion', (p) => { if (Number.isFinite(p?.x) && Number.isFinite(p?.z)) sink.push({ t: w.time, kind: 'blast', what: p.kind, x: p.x, y: standHeight(w, p.x, p.z), z: p.z }); }));
    return () => offs.forEach((o) => o?.());
  };
  const objectivesDone = (w, seen, sink) => {
    for (const o of w.objectives) if (o.done && !seen.has(o.id)) { seen.add(o.id); sink.push({ t: w.time, kind: 'objective', id: o.id }); }
  };

  /**
   * The cue sheet: the game's own audio handlers (installHandlers) run on a recorder instead of the audio engine, so
   * every sound the game would make for this run is written down — one-shots {t, id, x, z, g, rate}, loops {loop, on},
   * automatic-fire bursts, bomb ticks, the siren, and the threat the score follows (enemy states, deaths, the alarm).
   * mix-video.mjs turns it into sound with the game's own tables (spatialize, SFX gains, the sfx manifest).
   */
  const recordCues = (w) => {
    const cues = [], threat = [], pend = [];
    const r1 = (v) => Math.round(v * 10) / 10;
    const P = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.z) ? { x: r1(p.x), z: r1(p.z) } : {});
    const loops = new Map(), bursts = new Map();
    class BombMap extends Map { // the real audio ticks a time bomb from `bombs` (audio.js _tickBombs): 2 Hz speeding to 4 Hz over the fuse
      set(k, v) { cues.push({ t: w.time, id: 'bomb_tick', loop: String(k), on: 1, fuse: v?.fuse ?? 10, ...P(v?.bomb) }); return super.set(k, v); }
      delete(k) { if (this.has(k)) cues.push({ t: w.time, id: 'bomb_tick', loop: String(k), on: 0 }); return super.delete(k); }
    }
    const a = {
      options: { natureSounds: true, subtitles: false }, world: w, ambience: [], bombs: new BombMap(), lastStepEvent: -1e9,
      now: () => w.time, simNow: () => w.time, engine: { files: { has: () => true } }, // (has: the automatic-fire bursts below)
      playSfx(id, p, o = {}) { cues.push({ t: w.time, id, ...P(p), ...(o.gain != null ? { g: +o.gain.toFixed(2) } : {}), ...(o.rate ? { rate: +o.rate.toFixed(2) } : {}), ...(o.bus ? { bus: o.bus } : {}) }); return null; },
      startLoop(key, id, p, o = {}) {
        const cur = loops.get(key);
        if (cur === id) { if (o.rate) cues.push({ t: w.time, id, loop: key, on: 2, rate: +o.rate.toFixed(2) }); return; }
        if (cur) cues.push({ t: w.time, id: cur, loop: key, on: 0 });
        loops.set(key, id);
        cues.push({ t: w.time, id, loop: key, on: 1, ...P(p), ...(o.gain != null ? { g: +o.gain.toFixed(2) } : {}), ...(o.rate ? { rate: +o.rate.toFixed(2) } : {}) });
      },
      stopLoop(key) { const id = loops.get(key); if (id) { cues.push({ t: w.time, id, loop: key, on: 0 }); loops.delete(key); } },
      burst(key, id, p) { // one sustained take per shooter while its rounds keep coming, 0.3 s of tail after the last (audio.js burst)
        const b = bursts.get(key);
        if (!b) cues.push({ t: w.time, id, loop: `burst:${key}`, on: 1, ...P(p) });
        bursts.set(key, { id, until: w.time + 0.3 });
      },
      after(sec, fn) { pend.push({ at: w.time + sec, fn }); },
      say: () => null, _bark() {},
      _sirenStart(e) { cues.push({ t: w.time, siren: 1, ...P(e) }); }, _sirenStop() { cues.push({ t: w.time, siren: 0 }); },
    };
    const key = (u) => u?.id ?? u?.tag ?? u;
    const offs = installHandlers(a, { on: (t, fn) => w.events.on(t, fn) });
    // what the score's alert layer follows (audio.js wire): enemy states, enemy deaths, the alarm
    offs.push(w.events.on('enemy:state', (e) => threat.push({ t: w.time, k: String(key(e.enemy)), to: e.to })));
    offs.push(w.events.on('unit:killed', (e) => { if (e.unit?.kind === 'enemy') threat.push({ t: w.time, k: String(key(e.unit)), drop: 1 }); }));
    offs.push(w.events.on('structure:destroyed', (e) => cues.push({ t: w.time, destroyed: String(e.id ?? e.structure?.id ?? '') }))); // (ends a positional ambience layer `until` it: M3's waterfall)
    let alarm = false;
    return {
      cues, threat,
      pump() { // after every tick: due timers (a.after), burst tails, the alarm flag
        for (let i = 0; i < pend.length;) { if (pend[i].at <= w.time) { const f = pend.splice(i, 1)[0]; try { f.fn(); } catch { /* ignore */ } } else i++; }
        for (const [k, b] of bursts) if (w.time > b.until) { cues.push({ t: b.until, id: b.id, loop: `burst:${k}`, on: 0 }); bursts.delete(k); }
        const on = !!w.alarm?.active;
        if (on !== alarm) { alarm = on; threat.push({ t: w.time, alarm: on ? 1 : 0 }); }
      },
      dispose() { offs.forEach((o) => o?.()); },
    };
  };

  // ---------------------------------------------------------------- pass 1: logic only, learn the timeline
  await G.loadMission(id);
  G.start();
  g.stop(); // (?test=1: the page's own rAF loop still draws, with real dt, while a frame is awaited — it ran the animations ~3x fast)
  const ev1 = [], seen1 = new Set(), stages1 = [];
  let w = g.world;
  const off1 = watch(w, ev1);
  let beat1 = 0; // (a line every 5 game minutes: a long pass 1 is not silent)
  const D1 = makeDriver(w, { step: () => { g.step(dt); objectivesDone(w, seen1, ev1); if (w.time - beat1 >= 300) { beat1 = w.time; console.log(`CAP pass 1 t=${w.time.toFixed(0)}`); } }, dt, quiet: true, log: () => {} });
  let err1 = null;
  try { await solve(D1, { boardPoint, onStage: (s) => stages1.push({ id: s, t: D1.t }) }); } catch (e) { err1 = String(e?.message || e); }
  for (let i = 0; i < 600 && g.state === 'playing'; i++) g.step(dt);
  off1(); D1.dispose();
  const pass1 = { error: err1, state: g.state, time: w.time, detections: D1.detections(), exposures: D1.exposureReport(), checkpoints: D1.checkpoints.map((c) => ({ name: c.name, t: c.t })), events: ev1, stages: stages1 };
  console.log(`== pass 1: ${pass1.state} t=${pass1.time.toFixed(1)} detections=${pass1.detections} error=${err1}`);

  // ---------------------------------------------------------------- the cut: speed windows and camera shots (game time)
  const cp = (k) => pass1.checkpoints.find((c) => c.name.startsWith(k + ' '))?.t;
  const objT = (o) => ev1.find((e) => e.kind === 'objective' && e.id === o)?.t;
  const windows = []; // { t0, t1, speed }
  const shots = [];   // { t0, t1, x, y, z, zoom }
  for (const e of ev1.filter((e) => e.kind === 'kill')) {
    windows.push({ t0: e.t - 2.5, t1: e.t + 2, speed: 1.25 });
    shots.push({ t0: e.t - 3, t1: e.t + 1.5, x: e.x, y: e.y, z: e.z, zoom: 0.8 });
  }
  // blasts (the first of a cluster within 4 s) and objectives done: real time, the camera on the blast — without a cut the
  // film would run through its own climax at fast-forward
  let lastBlast = -1e9;
  for (const e of ev1.filter((e) => e.kind === 'blast')) {
    if (e.t - lastBlast < 4) continue;
    lastBlast = e.t;
    windows.push({ t0: e.t - 3, t1: e.t + 6, speed: 1 });
    shots.push({ t0: e.t - 3.5, t1: e.t + 5, x: e.x, y: e.y, z: e.z, zoom: 0.6, prio: 1 });
  }
  for (const e of ev1.filter((e) => e.kind === 'objective')) windows.push({ t0: e.t - 2, t1: e.t + 4, speed: 1 });
  for (const s of CUT.shots?.(cp, objT) ?? []) shots.push(s);
  for (const s of CUT.windows?.(cp, objT) ?? []) windows.push(s);
  const follows = CUT.follows?.(cp, objT) ?? []; // { t0, t1, role, zoom }: the camera stays on that man (not the last one ordered)
  const notes = CUT.notes?.(cp, objT) ?? [];     // { t0, t1, text }: a caption for a stretch (game time), in place of the step caption — the step captions only change at checkpoints

  // ---------------------------------------------------------------- shared pieces of the opening and of pass 2
  /** the film camera of the world just loaded: the view may go 20 m past the map's scroll limits, so a man at the map's edge
   * (M3's plateau) can still be framed in the middle of the picture (the land beyond the edge is drawn) */
  const filmCamera = () => {
    const cam = g.cameraController;
    if (cam.bounds) { const b = cam.bounds; b.minX -= 20; b.minZ -= 20; b.maxX += 20; b.maxZ += 20; }
    const look = (x, y, z) => { // centre a point at height y (orthographic view: shift along the view by y·cot(pitch))
      const a = cam.azimuth || 0, cot = 1 / Math.tan(cam.elevation);
      cam.centerOn(x - y * cot * Math.sin(a), z - y * cot * Math.cos(a));
    };
    return { cam, pitch0: (cam.elevation * 180) / Math.PI, look };
  };
  /** the caption layers: stage + step text (bottom left), clock + speed badge, full-screen card */
  const mkOverlay = () => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:99999;pointer-events:none;font:600 17px/1.35 Georgia,serif;color:#f3ead2;'
      + 'text-shadow:0 1px 3px #000,0 0 8px #000;max-width:820px;background:rgba(20,16,10,.5);padding:7px 12px 8px;border-radius:4px';
    ov.innerHTML = '<div id="capStage" style="font-size:20px;letter-spacing:.3px"></div><div id="capStep" style="font-weight:400;font-style:italic;opacity:.95"></div>';
    const badge = document.createElement('div');
    badge.style.cssText = 'position:fixed;right:178px;bottom:18px;z-index:99999;pointer-events:none;font:600 16px/1 ui-monospace,Menlo,monospace;color:#f3ead2;'
      + 'text-shadow:0 1px 3px #000;background:rgba(20,16,10,.55);padding:7px 10px;border-radius:4px';
    const card = document.createElement('div');
    card.style.cssText = 'position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;flex-direction:column;'
      + 'background:rgba(10,10,12,.72);color:#f3ead2;font-family:Georgia,serif;text-align:center;text-shadow:0 2px 6px #000';
    document.body.append(ov, badge, card);
    return { ov, badge, card, $: (q) => ov.querySelector(q), remove: () => { ov.remove(); badge.remove(); card.remove(); } };
  };
  const esc = (v) => String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  /** the title card: the cut's, else built from the mission's briefing data */
  const titleCard = (def) => {
    if (CUT.TITLE_CARD) return CUT.TITLE_CARD;
    const n = missionNumber(def), sub = def.subtitle || [def.place, def.date].filter(Boolean).join(' · ');
    const title = `${n ? `Mission ${n} · ` : ''}${esc(def.title || id)}`;
    const never = pass1.detections === 0 && !pass1.exposures.length;
    return `<div style="font-size:22px;letter-spacing:6px;opacity:.85">SHADOW SIX</div>
      <div style="font-size:${title.length > 36 ? 44 : 52}px;margin:10px 0 6px;max-width:1150px">${title}</div>
      ${sub ? `<div style="font-size:22px;font-style:italic;opacity:.9">${esc(sub)}</div>` : ''}
      ${def.briefing?.objectivesSummary ? `<div style="font-size:20px;margin-top:14px;opacity:.9;max-width:1000px">${esc(def.briefing.objectivesSummary)}</div>` : ''}
      <div style="font-size:18px;margin-top:26px;opacity:.85">Full solution · player orders only${never ? ' · never spotted' : ''}</div>`;
  };
  /** the end card: the cut's, else the objectives and the run's numbers */
  const endCard = (w, D, ev) => {
    if (CUT.END_CARD) return CUT.END_CARD(w, D);
    const t = w.time, mm = Math.floor(t / 60), ss = Math.floor(t % 60), won = g.state === 'won';
    const kills = ev.filter((e) => e.kind === 'kill' && e.who === 'enemy').length;
    const team = w.commandos.filter((c) => c.role !== 'guest'), alive = team.filter((c) => c.alive).length;
    const obj = w.objectives.filter((o) => o.done || !o.hidden).map((o) => `<div>${o.done ? '✔' : '✘'} ${esc(o.text)}</div>`).join('');
    return `<div style="font-size:50px;margin-bottom:12px">${won ? 'Mission complete' : 'Mission ' + esc(g.state)}</div>
      <div style="font-size:21px;line-height:1.6">${obj}</div>
      <div style="font-size:19px;margin-top:20px;opacity:.9">Game time ${mm}:${String(ss).padStart(2, '0')} · detections: ${D.detections()} · enemies killed: ${kills} · ${alive === team.length ? (team.length === 1 ? 'the commando' : `all ${team.length} commandos`) + ' alive' : `${alive} of ${team.length} commandos alive`}</div>`;
  };
  const dryFrames = [];
  const grab = async (meta) => { // one frame of the opening: drawn and handed to the capture (or counted, --dry)
    if (DRY) { dryFrames.push(meta); return true; }
    return window.__capFrame(meta);
  };

  // ---------------------------------------------------------------- the art opening: a pan over the briefing's places, in a world of its own
  let opening = null; // {dur, stops, frames}
  if (OPENING_SEC > 0) {
    await G.loadMission(id);
    G.start();
    g.stop();
    const w0 = g.world, def0 = w0.mission || {}, { cam, pitch0, look } = filmCamera();
    const gb0 = w0.commandos.find((c) => c.role === 'greenberet') ?? w0.commandos.find((c) => c.alive) ?? w0.commandos[0];
    let plan = { dur: 0 };
    try { plan = planOpening(tourStops(w0, def0), { start: gb0 ? { x: gb0.x, z: gb0.z } : null, budget: OPENING_SEC }); } catch (e) { console.log(`== opening skipped: ${e?.message || e}`); } // (the film then opens on the title card alone)
    if (plan.dur > 0) {
      const mk = mkOverlay();
      mk.badge.style.display = 'none';
      mk.ov.style.display = 'none';
      mk.ov.style.zIndex = '100001'; // (the place names sit over the title card's dimming)
      mk.card.innerHTML = titleCard(def0);
      mk.card.style.background = 'rgba(10,10,12,.58)';
      mk.card.style.display = 'flex';
      const vdt = 1 / FPS, tpf = Math.max(1, Math.round(vdt / dt)); // the world runs in real time under the pan (patrols walk, water flows)
      let pitchO = pitch0, n = 0;
      for (let f = 0; f < Math.round(plan.dur * FPS); f++) {
        const t = f * vdt, c = openingAt(plan, t), a = cardAlpha(plan, t);
        const gy = standHeight(w0, c.x, c.z);
        pitchO += ((CUT.pitchAt?.(c.x, c.z) ?? pitch0) - pitchO) * (1 - Math.exp(-vdt / 0.6)); // (M3's steeper view over the plateau)
        cam.elevation = (pitchO * Math.PI) / 180;
        cam.setZoom(c.zoom, true);
        look(c.x, gy, c.z);
        mk.card.style.opacity = String(a);
        mk.card.style.display = a > 0 ? 'flex' : 'none';
        mk.ov.style.display = c.label && a < 1 ? '' : 'none';
        mk.$('#capStage').textContent = c.label;
        for (let k = 0; k < tpf; k++) g.step(dt);
        if (!DRY) g.render(vdt, 1);
        const camMeta = { cx: Math.round(cam.target.x * 10) / 10, cz: Math.round(cam.target.z * 10) / 10, vw: Math.round((cam.width / cam.pxPerMeter()) * 10) / 10 };
        if (!(await grab({ t: 0, speed: 0, card: a > 0 ? 'title' : 'open', ...camMeta }))) { mk.remove(); throw new Error('CAPTURE_LIMIT'); }
        n++;
      }
      mk.remove();
      opening = { dur: plan.dur, stops: plan.stops, frames: n };
      console.log(`== opening: ${plan.dur.toFixed(1)} s, ${plan.stops.map((s) => s.kind).join(' > ')}`);
    }
  }

  // ---------------------------------------------------------------- pass 2: the same run, filmed
  await G.loadMission(id);
  G.start();
  g.stop(); // (?test=1: the page's own rAF loop still draws, with real dt, while a frame is awaited — it ran the animations ~3x fast)
  w = g.world;
  const ev2 = [], seen2 = new Set();
  const off2 = watch(w, ev2);
  const rec = recordCues(w);
  const { cam, pitch0, look } = filmCamera();
  let pitch = pitch0;
  const { ov, badge, card, $ } = mkOverlay();
  let stepText = '', stepUntil = 0; // (a cut's captions: up at the checkpoint, for a while)
  const capPlan = captionPlan({ names: pass1.checkpoints.map((c) => c.name), cutCaptions: CUT.CAPTIONS, steps: WT?.steps });
  const capQ = captionQueue(), stepCaption = () => (capPlan.lead ? capQ.text : stepText); // (without a cut's captions: up when its step begins, each one read before the next replaces it)
  let cpDone = 0; // (checkpoints reached in pass 2)

  // camera focus: the commando last given an order (his vehicle when aboard)
  let focusUnit = null, focusSince = -1e9, pending = null;
  let camX = null, camZ = null, camY = 0, zoom = 0.7;
  const pickFocus = (u) => { if (!u) return; pending = u; };
  const D = makeDriver(w, {
    dt, quiet: true, log: () => {},
    step: async () => {
      g.step(dt);
      rec.pump();
      objectivesDone(w, seen2, ev2);
      return tick();
    },
  });
  // The Sniper's scope before every sniper shot (the user's standing request, 2026-10-22: "we should see the sniper scope moving
  // around before sniper hits target"): the game's own scope show (debug/walkthrough-scope.js) on the film's clock. The scope comes
  // up off the man, searches round him, finds him and settles; the film slows to the pace that lands the shot at the end of the
  // show (down to 0.15×, with frames between ticks), the recoil, the scope comes down; the run itself is untouched.
  const pace = { turbo: false, speed: 1, boost: 1, budget: 0 };
  const scope = ScopeShow.wanted(w) ? new ScopeShow({ world: w, game: g, pacer: pace, speedSetting: 'auto', stopped: false, paused: false, simDt: dt, _held: () => false, step: null }) : null;
  scope?.attach();
  const order0 = D.order;
  // the camera follows where a man is sent (moves, abilities on something else), not stance changes, stops or a
  // decoy switched by radio
  D.order = (role, o) => {
    const r = order0(role, o), u = D.c(role) || D.get(role);
    if (o?.type === 'move' || (o?.type === 'ability' && o.target && o.target !== u)) pickFocus(u);
    scope?.order(u, o);
    return r;
  };

  const pass1End = pass1.time;
  const inWin = (t) => windows.filter((x) => t >= x.t0 && t <= x.t1);
  const shotAt = (t) => shots.filter((s) => t >= s.t0 && t <= s.t1).sort((a, b) => (b.prio ?? 0) - (a.prio ?? 0))[0];
  // what the commandos are doing, from how they actually moved over the last half second of game time (a man
  // holding a guard in conversation, dug in or waiting for a gap is still): 'walk' (someone walks, runs, rows),
  // 'crawl' (only crawling), null (everyone waits)
  const last = new Map();
  let motion = null, motionT = -1;
  const sense = () => {
    if (w.time - motionT < 0.5) return motion;
    let walk = false, crawl = false;
    for (const c of w.commandos) {
      if (!c.alive) continue;
      const p = c.vehicle || c, q = last.get(c);
      if (q && Math.hypot(p.x - q.x, p.z - q.z) > 0.12 * (w.time - motionT)) {
        if (!c.vehicle && c.stance === 'crawl') crawl = true; else walk = true;
      }
      last.set(c, { x: p.x, z: p.z });
    }
    motionT = w.time;
    return (motion = walk ? 'walk' : crawl ? 'crawl' : null);
  };
  const CRUISE = { walk: 4, crawl: 8, idle: 16 };
  // fast-forward target: real time around the marked moments, 4x while someone walks or rows, 8x while only
  // crawling men move, 16x while everyone waits (32x once the wait has run over 16 s of film)
  let idleSince = null; // film time since everyone has been waiting
  const wantSpeed = (t) => {
    const ws = inWin(t);
    const m = sense();
    if (m) idleSince = null; else if (idleSince == null) idleSince = videoT;
    if (ws.length) return Math.min(...ws.map((x) => x.speed));
    // ease into a coming window: never more than 2x its speed per 2 s ahead
    let s = CRUISE[m || 'idle'];
    if (!m) s *= Math.min(2, 1 + Math.max(0, videoT - idleSince - 8) / 8); // (a wait that drags on goes faster still, up to 32×: no long quiet stretch)
    for (const x of windows) if (x.t0 > t && x.t0 - t < 6) s = Math.min(s, x.speed * (1 + (x.t0 - t)));
    return s;
  };
  let speed = 4, acc = 0, lastRenderT = 0, videoT = 0, frameNo = 0, stopped = false;
  const vdt = 1 / FPS;

  async function frame(extra = {}) {
    const t = w.time;
    if (scope) { pace.speed = speed; pace.boost = 1; scope.frame(vdt); } // (the show's clock is the film's: one frame a frame)
    const scoping = !!(scope?.on && scope.seg?.target && Number.isFinite(scope.seg.target.x));
    // camera
    const s = scoping ? null : shotAt(t);
    const fw = follows.find((f) => t >= f.t0 && t <= f.t1);
    if (pending && pending !== focusUnit && videoT - focusSince > 3.5) { focusUnit = pending; focusSince = videoT; pending = null; if (focusUnit?.role) G.select(focusUnit.role); }
    let tx, ty, tz, tzoom = 0.7;
    if (s) { tx = s.x; ty = s.y ?? standHeight(w, s.x, s.z); tz = s.z; tzoom = s.zoom ?? 0.7; } // (no y: on the ground there)
    else if (fw && D.c(fw.role)) { const u = D.c(fw.role), f = u.vehicle || u; tx = f.x; ty = f.y ?? 0; tz = f.z; tzoom = fw.zoom ?? 0.8; }
    else if (scoping) { const g0 = scope.seg.target; tx = g0.x; ty = g0.y ?? 0; tz = g0.z; tzoom = 1; } // (the man in the glass, close enough for the lens)
    else if (focusUnit) { const f = focusUnit.vehicle || focusUnit; tx = f.x; ty = f.y ?? 0; tz = f.z; tzoom = focusUnit.vehicle ? 0.62 : focusUnit.stance === 'crawl' || focusUnit.buried ? 0.8 : 0.7; }
    else { const h = D.c('greenberet') ?? w.commandos.find((c) => c.alive) ?? w.commandos[0]; tx = h.x; ty = h.y ?? 0; tz = h.z; } // (nobody ordered yet: the team's first man)
    if (camX == null || Math.hypot(tx - camX, tz - camZ) > 55) { camX = tx; camZ = tz; camY = ty; zoom = tzoom; }
    else {
      const k = 1 - Math.exp(-vdt / 0.7);
      camX += (tx - camX) * k; camZ += (tz - camZ) * k; camY += (ty - camY) * k; zoom += (tzoom - zoom) * (1 - Math.exp(-vdt / 0.8));
    }
    // film camera: a steeper pitch where the game's 40° view hides men behind a tall cliff (CUT.pitchAt)
    const tp = CUT.pitchAt?.(camX, camZ) ?? pitch0;
    pitch += (tp - pitch) * (1 - Math.exp(-vdt / 0.6));
    cam.elevation = (pitch * Math.PI) / 180;
    cam.setZoom(zoom, true);
    look(camX, camY, camZ);
    // the player's pointer: over the next victim for the 3 s before a kill (the eye cursor over a soldier, user
    // 2026-10-07), parked off the view otherwise
    const cur = g.hud?.cursor;
    if (cur?.setAim) {
      const k = scoping ? null : ev1.find((e) => e.kind === 'kill' && e.by !== 'sniper' && t >= e.t - 3 && t <= e.t - 0.4); // (a sniper's victim has the scope instead)
      const v = k && D.get(k.tag);
      const p = v?.alive !== false && v ? cam.worldToScreen?.(v.x, (v.y || 0) + 1.0, v.z) : null;
      if (p?.visible !== false && p) cur.setAim(p.x, p.y, true); else cur.setAim(-1, -1, false);
    }
    // captions
    if (capPlan.lead) capQ.tick(videoT); else if (t > stepUntil) stepText = '';
    const note = notes.find((n) => t >= n.t0 && t <= n.t1);
    $('#capStep').textContent = note ? note.text : stepCaption();
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
    badge.textContent = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}  ${speed < 0.8 ? '▶ ½×' : speed < 1.6 ? '▶ 1×' : '▶▶ ' + Math.round(speed) + '×'}`;
    let more = true;
    // (the listener of the mix: where the view is centred and how wide it is, in metres)
    const meta = { t, speed, cx: Math.round(cam.target.x * 10) / 10, cz: Math.round(cam.target.z * 10) / 10, vw: Math.round((cam.width / cam.pxPerMeter()) * 10) / 10, ...extra };
    if (DRY) dryFrames.push(meta);
    else {
      // (the scope's slow motion — under a tick a frame: the world moves on by the frame's share of a tick, interpolated between the last two)
      const slow = scoping && (speed * vdt) / dt < 1;
      g.render(slow ? speed * vdt : Math.max(0, t - lastRenderT), slow ? Math.min(1, Math.max(0, 1 - acc)) : 1);
      more = await window.__capFrame(meta);
    }
    lastRenderT = t;
    videoT += vdt; frameNo++;
    if (!more) { stopped = true; throw new Error('CAPTURE_LIMIT'); }
  }
  async function tick() {
    const cap = scope?.on && scope.capNow != null ? scope.capNow : null; // (the pace that lands the sniper's shot at the end of the scope show)
    if (cap != null && speed > cap) speed = Math.max(cap, 0.15); // (the show cuts the pace at once: the shot lands where it must)
    const target = cap != null ? Math.min(wantSpeed(w.time), cap) : wantSpeed(w.time);
    // ramp (log space) so the fast-forward never jerks; slowing down is quicker than speeding up
    const k = target < speed ? 0.25 : 0.06;
    acc += 1;
    let ticksPerFrame = (speed * (1 / FPS)) / dt;
    // (a frame is due every `ticksPerFrame` ticks; with the scope up that is less than one: several frames a tick)
    while (acc + 1e-9 >= ticksPerFrame) {
      acc -= ticksPerFrame;
      speed = Math.exp(Math.log(speed) + (Math.log(target) - Math.log(speed)) * k);
      if (cap != null) speed = Math.min(speed, cap);
      if (speed < (cap != null ? 0.15 : 0.5)) speed = cap != null ? 0.15 : 0.5; // (slow motion down to half speed; the scope's down to 0.15)
      await frame();
      if (cap == null) break; // (one frame a tick unless the scope is up)
      ticksPerFrame = (speed * (1 / FPS)) / dt;
    }
  }
  async function hold(sec, extra = {}) { // frames without stepping (title / end cards)
    for (let i = 0; i < Math.round(sec * FPS); i++) {
      $('#capStep').textContent = stepCaption();
      if (DRY) { dryFrames.push({ t: w.time, speed: 0, ...extra }); continue; }
      g.render(0, 1);
      const more = await window.__capFrame({ t: w.time, speed: 0, ...extra });
      if (!more) { stopped = true; throw new Error('CAPTURE_LIMIT'); }
    }
  }
  const showCard = (html) => { card.innerHTML = html; card.style.display = html ? 'flex' : 'none'; };

  let err2 = null;
  try {
    // title card over the opening view
    // (the opening view on the Green Beret, or the first live man of a team without one: M15, M16)
    const gb = D.c('greenberet') ?? w.commandos.find((c) => c.alive) ?? w.commandos[0];
    pitch = CUT.pitchAt?.(gb.x, gb.z) ?? pitch0;
    cam.elevation = (pitch * Math.PI) / 180;
    cam.setZoom(0.7, true);
    look(gb.x, gb.y ?? 0, gb.z); camX = gb.x; camZ = gb.z; camY = gb.y ?? 0;
    G.select(gb.role);
    ov.style.display = 'none'; badge.style.display = 'none';
    if (!opening) { // (with the art opening the title card has already been over the pan)
      showCard(titleCard(w.mission || {}));
      await hold(4.5, { card: 'title' });
      showCard('');
    }
    ov.style.display = ''; badge.style.display = '';
    const D_checkpoint = D.checkpoint;
    D.checkpoint = (name) => {
      const r = D_checkpoint(name);
      cpDone++;
      if (capPlan.lead) capQ.due(capPlan.at(cpDone), videoT); // (the step that begins now)
      else { stepText = capPlan.textOf(name); stepUntil = w.time + 14 * Math.max(1, speed / 2); }
      ev2.push({ t: w.time, kind: 'checkpoint', name }); return r; };
    await solve(D, {
      boardPoint,
      onStage: (s, title) => { $('#capStage').textContent = TITLES[s] ?? `${s}. ${title}`; if (capPlan.lead) capQ.due(capPlan.at(cpDone), videoT); ev2.push({ t: w.time, kind: 'stage', id: s }); },
    });
    // the game's own end check (win), filmed in real time
    for (let i = 0; i < 600 && g.state === 'playing'; i++) { g.step(dt); rec.pump(); objectivesDone(w, seen2, ev2); await tick(); }
    ev2.push({ t: w.time, kind: 'end', state: g.state });
    for (let i = 0; i < 1.5 * FPS; i++) await frame();
    ov.style.display = 'none'; badge.style.display = 'none';
    for (let i = 0; i < 2.5 * FPS; i++) await frame(); // the game's own win screen
    card.style.background = 'rgb(14,13,12)'; // the summary card hides the win screen's text
    showCard(endCard(w, D, ev2));
    await hold(5, { card: 'end' });
  } catch (e) { err2 = String(e?.message || e); }
  scope?.detach();
  off2(); D.dispose(); rec.dispose();
  // what the mix needs to know of the mission: its start stinger, the theatre's ambience layers (the game's own tables)
  const def2 = w.mission || {};
  const mission = {
    id, n: missionNumber(def2), title: def2.title, subtitle: def2.subtitle, theater: def2.theater, size: def2.size, team: w.commandos.length,
    night: !!def2.night || (def2.lighting?.sunElevDeg ?? 30) < 0, startCue: startCueFor(def2), ambience: ambienceFor(def2), yaw: cam.azimuth,
  };
  return {
    mission, opening, audio: { cues: rec.cues, threat: rec.threat },
    pass1,
    pass2: { error: stopped ? 'stopped at --max-frames' : err2, state: g.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(), checkpoints: D.checkpoints.map((c) => ({ name: c.name, t: c.t })), events: ev2, driverEvents: D.events },
    cut: { windows, shots, follows, notes },
    ...(DRY ? { dryFrames } : {}),
  };
}
