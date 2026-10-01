/**
 * Shared in-mission touch flow (touch-game-pixel7 / touch-game-iphone14): an emulated phone in landscape plays M00
 * with fingers only. TAP selects a commando and walks, DOUBLE TAP runs, ONE-FINGER DRAG pans (with momentum) and
 * never orders, TWO-FINGER PINCH zooms about the fingers' midpoint, the knife from the bag + a tap on a guard
 * orders the kill, LONG PRESS on a guard shows his cone, CANCEL and MENU work by tap; the mobile preset holds an
 * acceptable frame time. Multi-touch goes through CDP Input.dispatchTouchEvent (src/input/touch-game.js).
 */
import { join } from 'node:path';
import { DEVICES } from './touch-flow.mjs';
import { ROOT } from './harness.mjs';

const IGNORED = [/GPU stall due to ReadPixels/i, /GL Driver Message/i, /Automatic fallback to software WebGL/i];

/** Open ?test=1 on an emulated phone (landscape) and return helpers. */
export async function openPhone(t, name) {
  const dev = { ...DEVICES[name] };
  dev.viewport = { width: dev.viewport.height, height: dev.viewport.width };
  const ctx = await t.harness.browser.newContext(dev);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + (e.stack || e.message).slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errs.push('console.error: ' + m.text().slice(0, 400)); });
  page.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(`${t.harness.url}/index.html?test=1`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  /** One finger from a to b in `steps` moves, `ms` apart; `hold` ms still before lifting. */
  const drag = async (a, b, steps = 8, ms = 16, hold = 0) => {
    await touch('touchStart', [a]);
    for (let k = 1; k <= steps; k++) {
      await touch('touchMove', [[a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]]);
      if (ms) await page.waitForTimeout(ms);
    }
    if (hold) await page.waitForTimeout(hold);
    await touch('touchEnd', []);
  };
  /** Two fingers: from distance d0 to d1 about midpoint m (horizontal pair), midpoint moving by mv. */
  const pinch = async (m, d0, d1, steps = 8, mv = [0, 0]) => {
    const pts = (d, k) => [[m[0] + mv[0] * k - d / 2, m[1] + mv[1] * k], [m[0] + mv[0] * k + d / 2, m[1] + mv[1] * k]];
    await touch('touchStart', [pts(d0, 0)[0]]);
    await touch('touchStart', pts(d0, 0));
    for (let k = 1; k <= steps; k++) {
      await touch('touchMove', pts(d0 + ((d1 - d0) * k) / steps, k / steps));
      await page.waitForTimeout(16);
    }
    await touch('touchEnd', []);
  };
  const tapEl = async (sel) => {
    const box = await page.evaluate((s) => {
      const e = [...document.querySelectorAll(s)].find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !x.closest('[hidden]'); });
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, sel);
    t(box, `${name}: "${sel}" is on screen`);
    await page.touchscreen.tap(box.x, box.y);
  };
  /** docs/screenshots/touch-game-<n>.jpg at CSS-pixel size (≤ 1000 px wide). */
  const shot = (n) => page.screenshot({ path: join(ROOT, 'docs', 'screenshots', `touch-game-${n}.jpg`), type: 'jpeg', quality: 72, scale: 'css' });
  return { ctx, page, errs, touch, drag, pinch, tapEl, shot, vp: dev.viewport };
}

/** Stage 1: phone + M00, tap select / tap walk / double-tap run. @returns the shared context for the next stages */
async function tapStage(t, name) {
  const tag = name.replace(/\s+/g, '').toLowerCase();
  const P = await openPhone(t, name);
  const { page, drag, pinch, tapEl, shot } = P;
  try {
    // M00 with the fuel guard on open ground west of the Green Beret (as tests/knife.test.mjs)
    const boot = await page.evaluate(async () => {
      const g = window.__game, G = g.game;
      await g.loadMission('m00');
      const w = G.world;
      for (const e of [...w.enemies]) if (e.tag !== 'guard_fuel') w.remove(e);
      const guard = w.enemies[0];
      guard.setPosition(16, 46, Math.PI);
      Object.assign(guard.post, { x: 16, z: 46, heading: Math.PI, scan: null });
      const gb = w.commandos.find((c) => c.role === 'greenberet');
      gb.setPosition(24, 46, Math.PI);
      g.start();
      g.setZoom(1);
      g.centerOn(24, 46);
      G.input.deselectAll();
      window.__orders = [];
      G.events.on('unit:order', ({ unit, order }) => window.__orders.push({ id: unit.id, role: unit.role, type: order.type, id2: order.id || null, run: !!order.run }));
      g.render();
      return { touch: document.documentElement.classList.contains('mk-touch'), preset: G.renderer.presetName, dpr: G.renderer.renderer.getPixelRatio(), devDpr: devicePixelRatio, gpu: G.renderer.stats?.()?.gpu || null };
    });
    t.log(tag, JSON.stringify(boot));
    t(boot.touch, `${tag}: touch mode`);
    t(boot.preset === 'medium' || boot.preset === 'low', `${tag}: a phone boots on a mobile preset (${boot.preset})`);
    t(boot.dpr <= 2 && boot.dpr < boot.devDpr, `${tag}: DPR capped (${boot.dpr} of ${boot.devDpr})`);
    const S = () => page.evaluate(() => {
      const G = window.__game.game, cam = G.cameraController, w = G.world;
      const gb = w.commandos.find((c) => c.role === 'greenberet'), guard = w.enemies[0];
      const scr = (e, y = 0.5) => cam.worldToScreen(e.x, y, e.z);
      return { gb: scr(gb), guard: scr(guard, 0.9), sel: G.input.selection.map((c) => c.role), orders: window.__orders.slice(), target: { x: cam.target.x, z: cam.target.z }, zoom: cam.zoom, targeting: G.input.targeting?.abilityId || null, state: G.state, cone: !!guard.coneVisible };
    });
    const tick = (s = 0.05) => page.evaluate((d) => { window.__game.advance(d); window.__game.render(); }, s);

    // --- TAP a commando selects him
    let s = await S();
    await page.touchscreen.tap(s.gb.x, s.gb.y);
    await tick();
    s = await S();
    t.equal(s.sel.join(), 'greenberet', `${tag}: tap on the Green Beret selects him`);
    await page.waitForTimeout(450); // past the double-tap window
    // --- TAP the ground walks (east of him, away from the guard)
    const ground = { x: s.gb.x + 70, y: s.gb.y + 20 };
    await page.touchscreen.tap(ground.x, ground.y);
    await tick();
    s = await S();
    const walk = s.orders.filter((o) => o.type === 'move');
    t(walk.length === 1 && !walk[0].run, `${tag}: tap on the ground walks (${JSON.stringify(s.orders)})`);
    await page.waitForTimeout(450);
    // --- DOUBLE TAP runs
    await page.touchscreen.tap(ground.x + 40, ground.y);
    await page.waitForTimeout(60);
    await page.touchscreen.tap(ground.x + 46, ground.y + 4); // a finger lands a few px off: still a double tap
    await tick();
    s = await S();
    const mv = s.orders.filter((o) => o.type === 'move');
    t(mv.length === 3 && !mv[1].run && mv[2].run, `${tag}: double tap runs (${JSON.stringify(mv)})`);
    await shot(`${tag}-tap-walk`);
    await page.waitForTimeout(450);
    return { t, P, S, tick, tag, page, drag, pinch, tapEl, shot };
  } catch (e) {
    await P.ctx.close().catch(() => {});
    throw e;
  }
}

const groundAt = (page, x, y) => page.evaluate(([px, py]) => {
  const g = window.__game.game.cameraController.screenToGround(px, py);
  return g && { x: g.x, z: g.z };
}, [x, y]);

/** Stage 2: one-finger drag pans 1:1 (no order), a flick coasts, two fingers pinch-zoom about their midpoint. */
async function panZoomStage(c) {
  const { t, P, S, tag, page, drag, pinch, shot } = c;
  const { width: W, height: H } = P.vp;
  let s = await S();
  const n0 = s.orders.length, sel0 = s.sel.join();
  // --- slow drag (held still before lifting: no coast): the ground under the finger follows it
  const A = [W * 0.5, H * 0.55], B = [W * 0.5 - 120, H * 0.55 - 60];
  const g0 = await groundAt(page, ...A);
  await drag(A, B, 10, 16, 160);
  const g1 = await groundAt(page, ...B);
  s = await S();
  const d = Math.hypot(g1.x - g0.x, g1.z - g0.z);
  t.log(tag, 'pan', JSON.stringify({ g0, g1, d }));
  t(d < 0.35, `${tag}: one-finger drag moves the map with the finger (${d.toFixed(2)} m off)`);
  t.equal(s.orders.length, n0, `${tag}: dragging the map gives no order`);
  t.equal(s.sel.join(), sel0, `${tag}: dragging keeps the selection`);
  // --- flick: the map coasts after the finger lifts, then stops
  await drag([W * 0.7, H * 0.5], [W * 0.7 - 160, H * 0.5], 6, 12, 0);
  const coast = await page.evaluate(() => {
    const G = window.__game.game, cam = G.cameraController, out = [];
    for (let i = 0; i < 90; i++) { G.render(1 / 60, 1); out.push(cam.target.x); }
    return { a: out[0], b: out[20], end: out[89], prevEnd: out[80], v: { ...G.input.touch.velocity } };
  });
  t.log(tag, 'coast', JSON.stringify(coast));
  t(Math.abs(coast.b - coast.a) > 0.2, `${tag}: a flick coasts (${(coast.b - coast.a).toFixed(2)} m in 20 frames)`);
  t(coast.v.x === 0 && Math.abs(coast.end - coast.prevEnd) < 1e-6, `${tag}: the coast stops`);
  s = await S();
  t.equal(s.orders.length, n0, `${tag}: a flick gives no order`);
  // --- pinch out (spread = zoom in) about a midpoint: the ground under it stays put
  await page.evaluate(() => { window.__game.setZoom(1); window.__game.centerOn(30, 46); });
  const M = [W * 0.42, H * 0.5];
  const m0 = await groundAt(page, ...M);
  await pinch(M, 100, 160);
  s = await S();
  const m1 = await groundAt(page, ...M);
  const dm = Math.hypot(m1.x - m0.x, m1.z - m0.z);
  t.log(tag, 'pinch out', JSON.stringify({ zoom: s.zoom, dm }));
  t(Math.abs(s.zoom - 1.6) < 0.06, `${tag}: spreading two fingers zooms in (zoom ${s.zoom.toFixed(3)}, want 1.6)`);
  t(dm < 0.3, `${tag}: pinch zoom keeps the ground under the fingers' midpoint (${dm.toFixed(2)} m)`);
  await shot(`${tag}-pinch-in`);
  // --- pinch in (fingers closer = zoom out)
  await pinch(M, 200, 100);
  s = await S();
  const m2 = await groundAt(page, ...M);
  t(Math.abs(s.zoom - 0.8) < 0.05, `${tag}: pinching zooms out (zoom ${s.zoom.toFixed(3)}, want 0.8)`);
  t(Math.hypot(m2.x - m0.x, m2.z - m0.z) < 0.3, `${tag}: zoom out about the midpoint too`);
  await shot(`${tag}-pinch-out`);
  // --- two fingers moving together pan
  const k0 = await groundAt(page, ...M);
  await pinch(M, 120, 120, 8, [80, 0]);
  const k1 = await groundAt(page, M[0] + 80, M[1]);
  t(Math.hypot(k1.x - k0.x, k1.z - k0.z) < 0.35, `${tag}: a two-finger drag pans with the fingers`);
  s = await S();
  t.equal(s.orders.length, n0, `${tag}: pinching gives no order`);
  t.equal(s.sel.join(), sel0, `${tag}: pinching keeps the selection`);
  await page.evaluate(() => { window.__game.setZoom(1); window.__game.centerOn(22, 46); window.__game.render(); });
}

/** Stage 3: portraits, long press (cone), the eye tool, the knife from the bag + CANCEL, then knife the guard, MENU. */
async function hudStage(c) {
  const { t, S, tick, tag, page, tapEl, shot } = c;
  const flush = () => page.evaluate(() => window.__game.render());
  // --- portraits select by tap
  await tapEl('.hud-portrait[data-role="sniper"]');
  await tick();
  t.equal((await S()).sel.join(), 'sniper', `${tag}: tap on a portrait selects that man`);
  await page.waitForTimeout(400);
  await tapEl('.hud-portrait[data-role="greenberet"]');
  await tick();
  t.equal((await S()).sel.join(), 'greenberet', `${tag}: tap on the Green Beret's portrait`);
  await page.evaluate(() => { window.__game.centerOn(20, 46); window.__game.render(); });
  // --- long press on the guard: his vision cone (no order, no deselect)
  let s = await S();
  const n0 = s.orders.length;
  await c.P.touch('touchStart', [[s.guard.x, s.guard.y]]);
  await page.waitForTimeout(650);
  await flush(); // the per-frame touch update fires the long press
  await c.P.touch('touchEnd', []);
  await tick();
  s = await S();
  t(s.cone, `${tag}: long press on a guard shows his vision cone`);
  t.equal(s.orders.length, n0, `${tag}: a long press gives no order`);
  t.equal(s.sel.join(), 'greenberet', `${tag}: a long press keeps the selection`);
  await shot(`${tag}-longpress-cone`);
  // --- the eye tool by tap: tap the eye, tap the guard → cone off; CANCEL leaves the tool
  await tapEl('.hud-eye');
  await flush();
  t(await page.evaluate(() => window.__game.game.hud.cursor.mode === 'eye'), `${tag}: the eye tool arms by tap`);
  await page.waitForTimeout(400);
  await page.touchscreen.tap(s.guard.x, s.guard.y);
  await tick();
  t(!(await S()).cone, `${tag}: eye tool + tap on the guard toggles his cone`);
  await flush();
  await tapEl('.touch-cancel');
  t(await page.evaluate(() => !window.__game.game.hud.cursor.mode), `${tag}: CANCEL puts the eye tool away`);
  // --- knife from the bag; CANCEL puts it away; knife again + tap on the guard = the knife order
  await tapEl('.item[data-item="knife"]');
  await flush();
  t.equal((await S()).targeting, 'knife', `${tag}: the knife arms from the bag by tap`);
  t(await page.evaluate(() => !document.querySelector('.touch-cancel').hidden), `${tag}: CANCEL shows while an item is armed`);
  await shot(`${tag}-knife-armed`);
  await tapEl('.touch-cancel');
  await flush();
  t.equal((await S()).targeting, null, `${tag}: CANCEL disarms the knife`);
  await page.waitForTimeout(400);
  await tapEl('.item[data-item="knife"]');
  await flush();
  // a drag with the knife armed still only pans
  const { width: W, height: H } = c.P.vp;
  await c.drag([W * 0.3, H * 0.75], [W * 0.3 + 40, H * 0.75], 6, 12, 120);
  s = await S();
  t.equal(s.targeting, 'knife', `${tag}: panning keeps the knife armed`);
  t.equal(s.orders.length, n0, `${tag}: panning with the knife armed gives no order`);
  await page.waitForTimeout(400);
  await page.touchscreen.tap(s.guard.x, s.guard.y);
  await tick();
  s = await S();
  const kn = s.orders.filter((o) => o.type === 'ability' && o.id2 === 'knife');
  t(kn.length === 1, `${tag}: knife + tap on the guard orders the kill (${JSON.stringify(s.orders.slice(n0))})`);
  const kill = await page.evaluate(() => {
    const g = window.__game, guard = g.game.world.enemies[0];
    for (let i = 0; i < 200 && guard.alive; i++) g.advance(0.1);
    g.render();
    return { dead: !guard.alive };
  });
  t.log(tag, 'knife', JSON.stringify(kill));
  t(kill.dead, `${tag}: the Green Beret knifes the guard`);
  await shot(`${tag}-knifed`);
  // --- MENU by tap pauses; BACK resumes
  await flush();
  await tapEl('.touch-menu');
  await page.waitForFunction(() => document.querySelector('.mk-host .mk-card:not(.leaving)')?.dataset.card === 'main', null, { timeout: 5000 });
  t.equal((await S()).state, 'paused', `${tag}: MENU pauses the mission`);
  await page.waitForTimeout(300);
  await tapEl('.mk-host .mk-card:not(.leaving) .mk-touchbtn.back');
  await page.waitForFunction(() => window.__game.game.state === 'playing' && !window.__game.game.hud.kit.active, null, { timeout: 5000 });
}

/** Stage 4: the frame time at the mobile preset. */
async function perfStage(c) {
  const { t, tag, page } = c;
  const b = await page.evaluate(() => window.__game.bench(60));
  t.log(tag, 'bench', JSON.stringify({ preset: b.preset, wall: b.wallMedian, p95: b.wallP95, gpu: b.gpuMedian, size: b.size, pr: b.pixelRatio }));
  t(b.wallMedian < 33, `${tag}: ≥ 30 fps at the ${b.preset} preset (median ${b.wallMedian} ms)`);
}

/** The whole in-mission touch flow on one device (landscape). */
export async function playFlow(t, name) {
  const c = await tapStage(t, name);
  try {
    await panZoomStage(c);
    await hudStage(c);
    await perfStage(c);
    t(!c.P.errs.length, `${c.tag}: no page errors (${c.P.errs.slice(0, 3).join(' | ')})`);
  } finally {
    await c.P.ctx.close().catch(() => {});
  }
}
