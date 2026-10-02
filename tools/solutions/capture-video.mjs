#!/usr/bin/env node
/**
 * Film a mission solution in the real game (headless GPU Chromium, ?test=1): JPEG frames + a timeline for the mix.
 *   node tools/solutions/capture-video.mjs m03 --out <dir> [--max-frames N] [--fps 30] [--size 1280x720]
 *
 * Pass 1 plays the solution logic-only (no frames, ~15 s) to learn WHEN things happen (kills, objectives,
 * checkpoints). Pass 2 reloads the mission and plays it again, this time drawing: every tick is Game.step(dt) and
 * a frame is rendered (Game.render(elapsed, 1), so the character models animate) and grabbed every N ticks, N set by
 * a speed director (fast-forward through waits, real time around the kills and blasts it knows from pass 1). The
 * camera follows the commando the script last gave an order (the raft when he is aboard), pulled to the kills and
 * blasts. The caption overlay (stage, step, clock, speed) is a DOM layer captured with the canvas.
 * The solution itself is unchanged: the same orders, the same waits; frames are taken from inside its `step`.
 * Output: <out>/frames/000000.jpg…, <out>/timeline.json (frames: t, speed; events with frame indices; both passes'
 * checkpoints, to check that drawing did not change the run).
 */
import { startHarness } from '../../tests/harness.mjs';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const id = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || 'm03';
const OUT = opt('out', '/tmp/capture');
const FPS = +opt('fps', 30);
const [W, H] = opt('size', '1280x720').split('x').map(Number);
const MAX_FRAMES = +opt('max-frames', 0) || Infinity;
const DRY = args.includes('--dry'); // no frames: only the cut's timing (video length per stage), to tune the pacing
const FR = join(OUT, 'frames');
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
  result = await page.evaluate(directorMain, { id, FPS, DRY, MAX_FRAMES: Number.isFinite(MAX_FRAMES) ? MAX_FRAMES : 0 });
  if (DRY) { frames.push(...result.dryFrames); nFrames = frames.length; delete result.dryFrames; }
  result.errors = h.errors(page).slice(0, 20);
} finally {
  await h.close();
}
if (DRY) summarize();
writeFileSync(join(OUT, DRY ? 'timeline-dry.json' : 'timeline.json'), JSON.stringify({ id, fps: FPS, size: [W, H], frames, ...result }, null, 1));
console.log(`frames ${nFrames}; pass1 ${result.pass1.state} t=${result.pass1.time.toFixed(1)}; pass2 ${result.pass2.state} t=${result.pass2.time.toFixed(1)} detections=${result.pass2.detections} error=${result.pass2.error}`);

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
async function directorMain({ id, FPS, DRY, MAX_FRAMES }) {
  const G = window.__game, g = G.game, dt = G.CONFIG.sim.dt;
  const { makeDriver } = await import('/tools/solutions/driver.mjs');
  const { solve } = await import(`/tools/solutions/${id}.solution.mjs`);
  const { boardPoint } = await import('/src/abilities/drive.js');
  const CUT = await import(`/tools/solutions/${id}.cut.mjs`).catch(() => ({}));
  const TITLES = CUT.TITLES || {}, CAPTIONS = CUT.CAPTIONS || {};

  /** listeners shared by both passes: kills (with where), objectives done */
  const watch = (w, sink) => {
    const offs = [];
    offs.push(w.events.on('unit:killed', (p) => sink.push({ t: w.time, kind: 'kill', tag: p.unit?.tag, x: p.unit?.x, y: p.unit?.y ?? 0, z: p.unit?.z })));
    return () => offs.forEach((o) => o?.());
  };
  const objectivesDone = (w, seen, sink) => {
    for (const o of w.objectives) if (o.done && !seen.has(o.id)) { seen.add(o.id); sink.push({ t: w.time, kind: 'objective', id: o.id }); }
  };

  // ---------------------------------------------------------------- pass 1: logic only, learn the timeline
  await G.loadMission(id);
  G.start();
  const ev1 = [], seen1 = new Set(), stages1 = [];
  let w = g.world;
  const off1 = watch(w, ev1);
  const D1 = makeDriver(w, { step: () => { g.step(dt); objectivesDone(w, seen1, ev1); }, dt, quiet: true, log: () => {} });
  let err1 = null;
  try { await solve(D1, { boardPoint, onStage: (s) => stages1.push({ id: s, t: D1.t }) }); } catch (e) { err1 = String(e?.message || e); }
  for (let i = 0; i < 600 && g.state === 'playing'; i++) g.step(dt);
  off1(); D1.dispose();
  const pass1 = { error: err1, state: g.state, time: w.time, detections: D1.detections(), checkpoints: D1.checkpoints.map((c) => ({ name: c.name, t: c.t })), events: ev1, stages: stages1 };
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
  for (const s of CUT.shots?.(cp, objT) ?? []) shots.push(s);
  for (const s of CUT.windows?.(cp, objT) ?? []) windows.push(s);

  // ---------------------------------------------------------------- pass 2: the same run, filmed
  await G.loadMission(id);
  G.start();
  w = g.world;
  const ev2 = [], seen2 = new Set();
  const off2 = watch(w, ev2);
  const cam = g.cameraController;
  // film camera only: let the view go 20 m past the map's scroll limits, so a man at the map's edge (the plateau)
  // can still be framed in the middle of the picture (the land beyond the edge is drawn)
  if (cam.bounds) { const b = cam.bounds; b.minX -= 20; b.minZ -= 20; b.maxX += 20; b.maxZ += 20; }
  const pitch0 = (cam.elevation * 180) / Math.PI;
  let pitch = pitch0;
  const look = (x, y, z) => { // centre a point at height y (orthographic view: shift along the view by y·cot(pitch))
    const a = cam.azimuth || 0, cot = 1 / Math.tan(cam.elevation);
    cam.centerOn(x - y * cot * Math.sin(a), z - y * cot * Math.cos(a));
  };

  // overlay
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
  const $ = (q) => ov.querySelector(q);
  let stepText = '', stepUntil = 0;

  // camera focus: the commando last given an order (his vehicle when aboard)
  let focusUnit = null, focusSince = -1e9, pending = null;
  let camX = null, camZ = null, camY = 0, zoom = 0.7;
  const pickFocus = (u) => { if (!u) return; pending = u; };
  const D = makeDriver(w, {
    dt, quiet: true, log: () => {},
    step: async () => {
      g.step(dt);
      objectivesDone(w, seen2, ev2);
      return tick();
    },
  });
  const order0 = D.order;
  // the camera follows where a man is sent (moves, abilities on something else), not stance changes, stops or a
  // decoy switched by radio
  D.order = (role, o) => {
    const r = order0(role, o), u = D.c(role) || D.get(role);
    if (o?.type === 'move' || (o?.type === 'ability' && o.target && o.target !== u)) pickFocus(u);
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
  // crawling men move, 16x while everyone waits
  const wantSpeed = (t) => {
    const ws = inWin(t);
    const m = sense();
    if (ws.length) return Math.min(...ws.map((x) => x.speed));
    // ease into a coming window: never more than 2x its speed per 2 s ahead
    let s = CRUISE[m || 'idle'];
    for (const x of windows) if (x.t0 > t && x.t0 - t < 6) s = Math.min(s, x.speed * (1 + (x.t0 - t)));
    return s;
  };
  const dryFrames = [];
  let speed = 4, acc = 0, lastRenderT = 0, videoT = 0, frameNo = 0, stopped = false;
  const vdt = 1 / FPS;

  async function frame(extra = {}) {
    const t = w.time;
    // camera
    const s = shotAt(t);
    if (pending && pending !== focusUnit && videoT - focusSince > 3.5) { focusUnit = pending; focusSince = videoT; pending = null; if (focusUnit?.role) G.select(focusUnit.role); }
    let tx, ty, tz, tzoom = 0.7;
    if (s) { tx = s.x; ty = s.y ?? w.groundY?.(s.x, s.z) ?? 0; tz = s.z; tzoom = s.zoom ?? 0.7; } // (no y: on the ground there)
    else if (focusUnit) { const f = focusUnit.vehicle || focusUnit; tx = f.x; ty = f.y ?? 0; tz = f.z; tzoom = focusUnit.vehicle ? 0.62 : focusUnit.stance === 'crawl' || focusUnit.buried ? 0.8 : 0.7; }
    else { tx = 104; ty = 0; tz = 10; }
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
    // captions
    if (t > stepUntil) stepText = '';
    $('#capStep').textContent = stepText;
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
    badge.textContent = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}  ${speed < 0.8 ? '▶ ½×' : speed < 1.6 ? '▶ 1×' : '▶▶ ' + Math.round(speed) + '×'}`;
    let more = true;
    if (DRY) dryFrames.push({ t, speed, ...extra });
    else {
      g.render(Math.max(0, t - lastRenderT), 1);
      more = await window.__capFrame({ t, speed, ...extra });
    }
    lastRenderT = t;
    videoT += vdt; frameNo++;
    if (!more) { stopped = true; throw new Error('CAPTURE_LIMIT'); }
  }
  async function tick() {
    const target = wantSpeed(w.time);
    // ramp (log space) so the fast-forward never jerks; slowing down is quicker than speeding up
    const k = target < speed ? 0.25 : 0.06;
    acc += 1;
    const ticksPerFrame = (speed * (1 / FPS)) / dt;
    if (acc + 1e-9 >= ticksPerFrame) {
      acc -= ticksPerFrame;
      speed = Math.exp(Math.log(speed) + (Math.log(target) - Math.log(speed)) * k);
      if (speed < 0.5) speed = 0.5; // (slow motion down to half speed)
      await frame();
    }
  }
  async function hold(sec, extra = {}) { // frames without stepping (title / end cards)
    for (let i = 0; i < Math.round(sec * FPS); i++) {
      $('#capStep').textContent = stepText;
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
    const gb = D.c('greenberet');
    pitch = CUT.pitchAt?.(gb.x, gb.z) ?? pitch0;
    cam.elevation = (pitch * Math.PI) / 180;
    cam.setZoom(0.7, true);
    look(gb.x, gb.y ?? 0, gb.z); camX = gb.x; camZ = gb.z; camY = gb.y ?? 0;
    G.select('greenberet');
    ov.style.display = 'none'; badge.style.display = 'none';
    showCard(CUT.TITLE_CARD || `<div style="font-size:42px">${id}</div>`);
    await hold(4.5, { card: 'title' });
    showCard(''); ov.style.display = ''; badge.style.display = '';
    const D_checkpoint = D.checkpoint;
    D.checkpoint = (name) => { const r = D_checkpoint(name); const k = name.split(' ')[0]; stepText = CAPTIONS[k] ?? name.replace(/^\S+\s/, ''); stepUntil = w.time + 14 * Math.max(1, speed / 2); ev2.push({ t: w.time, kind: 'checkpoint', name }); return r; };
    await solve(D, {
      boardPoint,
      onStage: (s, title) => { $('#capStage').textContent = TITLES[s] ?? `${s}. ${title}`; ev2.push({ t: w.time, kind: 'stage', id: s }); },
    });
    // the game's own end check (win), filmed in real time
    for (let i = 0; i < 600 && g.state === 'playing'; i++) { g.step(dt); objectivesDone(w, seen2, ev2); await tick(); }
    ev2.push({ t: w.time, kind: 'end', state: g.state });
    for (let i = 0; i < 1.5 * FPS; i++) await frame();
    ov.style.display = 'none'; badge.style.display = 'none';
    for (let i = 0; i < 2.5 * FPS; i++) await frame(); // the game's own win screen
    card.style.background = 'rgb(14,13,12)'; // the summary card hides the win screen's text
    showCard(CUT.END_CARD?.(w, D) || `<div style="font-size:40px">${g.state}</div>`);
    await hold(5, { card: 'end' });
  } catch (e) { err2 = String(e?.message || e); }
  off2(); D.dispose();
  // frame index of each event: the first frame at or after its time
  return {
    pass1,
    pass2: { error: stopped ? 'stopped at --max-frames' : err2, state: g.state, time: w.time, detections: D.detections(), checkpoints: D.checkpoints.map((c) => ({ name: c.name, t: c.t })), events: ev2, driverEvents: D.events },
    cut: { windows, shots },
    ...(DRY ? { dryFrames } : {}),
  };
}
