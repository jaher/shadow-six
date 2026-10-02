/**
 * Green Beret shovel, seen and used (user: "When green beret uses shovel show how he is shoveling, I have trouble
 * taking him out of the hole when I want to come out"). M1 snow, deterministic stepping (advance + render at 1/60):
 *
 *  DESKTOP 1280x720, zoom 2.5 — F: the shovel comes into both hands and digs three cycles (the blade goes into the
 *  snow and is thrown up to his left, the shovel travels on screen, the pixels around him change from beat to beat),
 *  clods fly with each throw and the spoil heap grows, he sinks into the hole and a raised mound (clearly darker /
 *  lighter than the flat snow around it) covers him; he is never drawn as an x-ray silhouette underground. A click
 *  on the mound selects him (a second click keeps him selected) without rising him; one click on the ground digs
 *  him out (visible from the first frame, rising from below the ground) and walks him there. Right-click rises too.
 *
 *  PHONE (Pixel 7 landscape) — a tap on the bag's shovel digs; the bag then shows the shovel as DIG OUT and the CANCEL
 *  button reads DIG OUT; a tap on the mound selects him; one tap on the ground brings him out and walks him there;
 *  the DIG OUT bag slot and the DIG OUT button each rise him with one tap.
 *
 * Frames: tests/out/shovel-dig-<desktop|phone>-<dig|rise>-NN.png (crops around him, every 0.1 s).
 */
import { mkdirSync } from 'node:fs';
import { openPhone } from './touch-game-flow.mjs';

export const timeout = 240_000;

/** In-page helpers: deterministic stepping, the GB's dig state, blade tip, crops read back from the canvas. */
function installHelpers() {
  const g = window.__game, G = g.game, R = G.renderer;
  const w = G.world, gb = w.commandos.find((c) => c.role === 'greenberet');
  const gl = R.renderer.getContext();
  const crops = new Map();
  const toBuf = (x, y, z) => {
    const s = G.cameraController.worldToScreen(x, y, z), rect = R.domElement.getBoundingClientRect(), k = gl.drawingBufferWidth / R.domElement.clientWidth;
    return [Math.round((s.x - rect.left) * k), Math.round(gl.drawingBufferHeight - (s.y - rect.top) * k), k];
  };
  window.__S = {
    step(n) { for (let i = 0; i < n; i++) { g.advance(1 / 60); G.render(1 / 60, 1); } },
    /** crop (half size `h` CSS px) around a world point, read right after a render, kept under `key`; returns mean luminance */
    grab(key, x, y, z, h = 40) {
      G.render(0, 1);
      const [fx, fy, k] = toBuf(x, y, z), H = Math.round(h * k), W = 2 * H;
      R.renderer.setRenderTarget(null);
      const px = new Uint8Array(W * W * 4);
      gl.readPixels(fx - H, fy - H, W, W, gl.RGBA, gl.UNSIGNED_BYTE, px);
      crops.set(key, px);
      let s = 0; for (let i = 0; i < px.length; i += 4) s += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      return s / (px.length / 4);
    },
    /** mean absolute RGB difference of two crops (same size) */
    diff(a, b) {
      const A = crops.get(a), B = crops.get(b);
      if (!A || !B || A.length !== B.length) return -1;
      let s = 0; for (let i = 0; i < A.length; i += 4) s += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
      return s / (A.length / 4) / 3;
    },
    probe() {
      const V = gb._digVis, sh = V?.shovel, site = V?.site;
      const tip = sh?.parent && sh.visible ? sh.localToWorld(new sh.position.constructor(0, -1.0, 0)) : null;
      const gy = w.groundY ? w.groundY(gb.x, gb.z) : 0;
      const scr = (x, y, z) => { const s = G.cameraController.worldToScreen(x, y, z); return { x: s.x, y: s.y }; };
      return {
        t: w.time, phase: gb.dig?.phase ?? null, act: gb.currentActionId, buried: gb.buried, sel: gb.selected, vis: gb.object3d.visible,
        x: gb.x, z: gb.z, path: !!gb.path, run: gb.moveMode === 'run', clip: gb.model?.clip, overlay: !!gb.model?.overlay,
        rootDy: gb.object3d.position.y - gy - (gb.y || 0) + (gb.model?._body?.()?.position.y ?? 0), inGround: !!gb.inGround,
        xray: (G.renderer.xrayTargets?.() || []).includes(gb.object3d),
        shovel: !!(sh && sh.visible && sh.parent), tip: tip ? { y: tip.y - gy, s: scr(tip.x, tip.y, tip.z) } : null,
        clods: site?.clods.count ?? 0, heapH: site ? site.heap.scale.y : 0, heapVis: !!site?.heap.visible,
        scr: scr(gb.x, 0.9, gb.z), mound: scr(gb.dig?.x ?? gb.x, 0.15, gb.dig?.z ?? gb.z),
      };
    },
  };
  return { gb: { x: gb.x, z: gb.z } };
}

async function bootM1(page, zoom) {
  await page.evaluate(async (zoom) => {
    const g = window.__game, G = g.game;
    await g.loadMission('m01'); g.start(); await G.mapHandle?.ready;
    const w = G.world, gb = w.commandos.find((c) => c.role === 'greenberet');
    for (const e of w.enemies) if (e.brain) e.brain.frozen = true;
    G.input.select([gb]);
    g.setZoom(zoom); g.centerOn(gb.x, gb.z);
  }, zoom);
  await page.evaluate(installHelpers);
  await page.evaluate(() => window.__S.step(20));
}

const P = (page) => page.evaluate(() => window.__S.probe());
const step = (page, n) => page.evaluate((n) => window.__S.step(n), n);

/** Step the dig (F already given) frame by frame: crops every 0.1 s, probes, assertions on the motion. */
async function watchDig(page, t, tag, outDir, shots = true) {
  const rows = [];
  for (let f = 0; f < 21; f++) {
    await step(page, 6);
    const p = await P(page);
    rows.push(p);
    if (shots) await page.screenshot({ path: `${outDir}/shovel-dig-${tag}-dig-${String(f).padStart(2, '0')}.png`, clip: { x: Math.round(p.scr.x - 170), y: Math.round(p.scr.y - 150), width: 340, height: 280 } });
  }
  const digging = rows.filter((r) => r.phase === 'dig');
  t(digging.length >= 18, `${tag}: digging for ~2 s (${digging.length} frames)`);
  t(digging.every((r) => r.overlay && r.clip === 'dig'), `${tag}: the dig clip + the shovel overlay play (clip ${digging[3]?.clip})`);
  const held = digging.filter((r) => r.shovel && r.tip);
  t(held.length >= digging.length - 1, `${tag}: the shovel is in his hands while he digs (${held.length}/${digging.length})`);
  const tipYs = held.map((r) => r.tip.y), sy = held.map((r) => r.tip.s.y), sx = held.map((r) => r.tip.s.x);
  t(Math.min(...tipYs) < -0.02, `${tag}: the blade goes into the snow (min tip ${Math.min(...tipYs).toFixed(2)} m)`);
  t(Math.max(...tipYs.slice(2)) > 0.35, `${tag}: and is lifted / thrown (max tip ${Math.max(...tipYs.slice(2)).toFixed(2)} m)`);
  const travel = Math.hypot(Math.max(...sx) - Math.min(...sx), Math.max(...sy) - Math.min(...sy));
  t(travel > 40, `${tag}: the blade travels on screen (${travel.toFixed(0)} px)`);
  // three throws: the tip rises above 0.35 m three separate times
  let throws = 0, up = false;
  for (const y of tipYs) { if (!up && y > 0.35) { throws++; up = true; } else if (up && y < 0.1) up = false; }
  t(throws >= 2, `${tag}: repeated dig cycles (${throws} throws seen at 0.1 s sampling)`);
  t(rows.some((r) => r.clods > 0), `${tag}: clods of spoil fly (max ${Math.max(...rows.map((r) => r.clods))})`);
  const hh = digging.map((r) => r.heapH);
  t(!rows[0].heapVis && rows[0].clods === 0, `${tag}: no spoil heap before the first load is thrown (at ${rows[0].t.toFixed(2)} s: heap ${rows[0].heapVis ? 'shown' : 'none'})`);
  t(hh[hh.length - 1] > hh[2] + 0.1, `${tag}: the heap grows (${hh[2].toFixed(2)} → ${hh[hh.length - 1].toFixed(2)})`);
  const sunk = digging.filter((r) => r.rootDy < -0.5);
  t(sunk.length >= 1 && sunk.every((r) => !r.xray), `${tag}: he sinks into the hole (${sunk.length} frames, min ${Math.min(...digging.map((r) => r.rootDy)).toFixed(2)} m), never x-rayed underground`);
  t.log(tag, 'dig', JSON.stringify({ frames: digging.length, held: held.length, minTip: +Math.min(...tipYs).toFixed(2), maxTip: +Math.max(...tipYs).toFixed(2),
    travelPx: Math.round(travel), throws, maxClods: Math.max(...rows.map((r) => r.clods)), heap: [+hh[2].toFixed(2), +hh[hh.length - 1].toFixed(2)],
    sinkMin: +Math.min(...digging.map((r) => r.rootDy)).toFixed(2) }));
  const last = rows[rows.length - 1];
  t(last.buried && last.phase === 'buried' && !last.vis && last.heapVis && last.heapH > 0.3, `${tag}: buried under a raised mound (h ${last.heapH.toFixed(2)})`);
  return rows;
}

async function watchRise(page, t, tag, outDir, shots = true) {
  const rows = [];
  for (let f = 0; f < 11; f++) {
    await step(page, 6);
    const p = await P(page);
    rows.push(p);
    if (shots) await page.screenshot({ path: `${outDir}/shovel-dig-${tag}-rise-${String(f).padStart(2, '0')}.png`, clip: { x: Math.round(p.scr.x - 170), y: Math.round(p.scr.y - 150), width: 340, height: 280 } });
  }
  const rising = rows.filter((r) => r.phase === 'rise');
  t(rising.length >= 8 && rising.every((r) => r.vis), `${tag}: the rise is drawn from its first frame (${rising.length} frames visible)`);
  t(rising[0].rootDy < -0.4 && rising[rising.length - 1].rootDy > -0.05, `${tag}: he comes up out of the ground (${rising[0].rootDy.toFixed(2)} → ${rising[rising.length - 1].rootDy.toFixed(2)} m)`);
  t(rising.some((r) => r.shovel), `${tag}: shovel in hand while he climbs out / stows it`);
  return rows;
}

export default async function shovelDig(page, t) {
  const outDir = t.harness.shotPath('').replace(/\/$/, '');
  mkdirSync(outDir, { recursive: true });
  // the procedural overlay must never throw (unit-model drops it with a warning: he'd snap out of the dig pose)
  const ovWarn = [];
  page.on('console', (m) => { if (m.text().includes('[unit-model] overlay')) ovWarn.push(m.text().slice(0, 200)); });
  // ---------------------------------------------------------------- desktop
  await page.setViewportSize({ width: 1280, height: 720 });
  await bootM1(page, 2.5);
  const p0 = await P(page);
  t(p0.sel && !p0.buried, 'desktop: GB selected on the M1 snow');
  await page.evaluate(({ x, z }) => { window.__S.grab('ground', x, 0.15, z, 36); window.__S.grab('wide0', x, 0.8, z, 70); }, p0);
  await page.keyboard.press('KeyF');
  // beats of the first cycle for a pixel check: thrust (blade in) vs throw (blade up at his left)
  await watchDig(page, t, 'desktop', outDir);
  const pb = await P(page);
  const ld = await page.evaluate(({ x, z }) => { window.__S.grab('mound', x, 0.15, z, 36); return window.__S.diff('ground', 'mound'); }, { x: pb.x, z: pb.z });
  t.log('desktop: mound vs flat snow |Δ|', ld.toFixed(1));
  t(ld > 6, `desktop: the mound stands out from the flat snow (mean |Δ| ${ld.toFixed(1)} levels)`);
  // the mound picks him: deselect, click it (0.45 m off his centre), click again
  await page.evaluate(() => window.__game.game.input.deselectAll());
  const m1 = await P(page);
  await page.mouse.click(m1.mound.x + 18, m1.mound.y + 6);
  await step(page, 2);
  let q = await P(page);
  t(q.sel && q.buried, `desktop: a click on the mound selects him, still buried (sel ${q.sel}, buried ${q.buried})`);
  await page.mouse.click(m1.mound.x - 10, m1.mound.y);
  await step(page, 30);
  q = await P(page);
  t(q.sel && q.buried && !q.act, 'desktop: a second click keeps him selected and does not rise him');
  // one click on the ground: digs out, then walks there
  const dest = await page.evaluate(({ x, z }) => { const s = window.__game.game.cameraController.worldToScreen(x + 3, 0, z + 1.5); return { x: s.x, y: s.y, wx: x + 3, wz: z + 1.5 }; }, q);
  await page.mouse.click(dest.x, dest.y);
  await step(page, 1);
  q = await P(page);
  t(q.act === 'shovel' && q.phase === 'rise' && q.vis, 'desktop: one ground click starts the rise (visible at once)');
  await watchRise(page, t, 'desktop', outDir);
  q = await P(page);
  t(!q.buried && q.path, 'desktop: out of the hole and walking');
  await step(page, 30);
  t(ovWarn.length === 0, `desktop: the dig / rise overlay ran without an error (${ovWarn[0] || 'none'})`);
  for (let k = 0; k < 40 && q.path; k++) { await step(page, 15); q = await P(page); }
  t(Math.hypot(q.x - dest.wx, q.z - dest.wz) < 0.6, `desktop: walked to the clicked point (${Math.hypot(q.x - dest.wx, q.z - dest.wz).toFixed(2)} m off)`);
  // pixel motion: a second dig, crops at the thrust and the throw of cycle 2
  await page.keyboard.press('KeyF');
  await step(page, 1);
  const pd = await P(page);
  const beat = async (n, key) => { await step(page, n); return page.evaluate(({ x, z, key }) => window.__S.grab(key, x, 0.8, z, 70), { x: pd.x, z: pd.z, key }); };
  await beat(Math.round((0.2 + 0.433 * 1.22) * 60) - 1, 'thrust');
  await beat(Math.round(0.433 * 0.58 * 60), 'throw');
  const md = await page.evaluate(() => window.__S.diff('thrust', 'throw'));
  t.log('desktop: thrust vs throw |Δ|', md.toFixed(1));
  t(md > 3, `desktop: the picture around him changes between the thrust and the throw (mean |Δ| ${md.toFixed(1)})`);
  await step(page, 90);
  q = await P(page);
  t(q.buried, 'desktop: buried again');
  await page.mouse.click(640, 360, { button: 'right' });
  await step(page, 64);
  q = await P(page);
  t(!q.buried && !q.path, 'desktop: right-click rises him, standing');

  // ---------------------------------------------------------------- phone
  const ph = await openPhone(t, 'Pixel 7');
  const { page: pp, tapEl, errs } = ph;
  try {
    await bootM1(pp, 2);
    await pp.evaluate(() => window.__game.game.input.deselectAll());
    await step(pp, 2);
    let r = await P(pp);
    await pp.touchscreen.tap(r.scr.x, r.scr.y);
    await step(pp, 2);
    r = await P(pp);
    t(r.sel, 'phone: a tap selects the Green Beret');
    await tapEl('.hud-knapsack .item[data-item="shovel"]');
    await step(pp, 1);
    r = await P(pp);
    t(r.act === 'shovel' && r.phase === 'dig', 'phone: a tap on the bag shovel digs');
    await watchDig(pp, t, 'phone', outDir);
    const ui = await pp.evaluate(() => {
      const it = document.querySelector('.hud-knapsack .item.rise'), c = document.querySelector('.touch-cancel');
      return { rise: it?.dataset.rise ?? null, tag: it?.querySelector('.rise-tag')?.textContent ?? null, others: document.querySelectorAll('.hud-knapsack .item.disabled').length,
        cancel: c && !c.hidden ? c.textContent.trim() : null };
    });
    t(ui.rise === 'ready' && ui.tag === 'DIG OUT', `phone: the bag's shovel slot reads DIG OUT (${JSON.stringify(ui)})`);
    t(/DIG OUT/.test(ui.cancel || ''), `phone: the CANCEL button reads DIG OUT (${ui.cancel})`);
    await ph.shot('shovel-buried');
    // the mound picks him
    await pp.evaluate(() => window.__game.game.input.deselectAll());
    await step(pp, 2);
    r = await P(pp);
    await pp.touchscreen.tap(r.mound.x + 10, r.mound.y + 4);
    await step(pp, 2);
    r = await P(pp);
    t(r.sel && r.buried, 'phone: a tap on the mound selects him (still buried)');
    // one tap on the ground: out and walking
    const dst = await pp.evaluate(({ x, z }) => { const s = window.__game.game.cameraController.worldToScreen(x - 3, 0, z + 1); return { x: s.x, y: s.y, wx: x - 3, wz: z + 1 }; }, r);
    await pp.waitForTimeout(400); // not a double tap with the mound tap
    await pp.touchscreen.tap(dst.x, dst.y);
    await step(pp, 1);
    r = await P(pp);
    t(r.act === 'shovel' && r.phase === 'rise' && r.vis, 'phone: one tap on the ground starts the rise');
    await watchRise(pp, t, 'phone', outDir);
    r = await P(pp);
    t(!r.buried && r.path, 'phone: out and walking');
    for (let k = 0; k < 40 && r.path; k++) { await step(pp, 15); r = await P(pp); }
    t(Math.hypot(r.x - dst.wx, r.z - dst.wz) < 0.6, 'phone: walked to the tapped point');
    // the DIG OUT slot, then the DIG OUT button, each rise him with one tap
    for (const how of ['.hud-knapsack .item.rise', '.touch-cancel']) {
      await tapEl('.hud-knapsack .item[data-item="shovel"]');
      await step(pp, 130);
      r = await P(pp);
      t(r.buried, `phone: buried again (before ${how})`);
      await tapEl(how);
      await step(pp, 64);
      r = await P(pp);
      t(!r.buried && !r.path, `phone: one tap on ${how} rises him`);
    }
    t(!errs.length, `phone: no page errors (${errs.slice(0, 3).join(' | ')})`);
  } finally {
    await ph.ctx.close();
  }
}
