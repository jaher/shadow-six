/**
 * Chess-style selection pulse (render/ring-pulse.js; user: "make the ring animate like in the 3d chess game when
 * selecting a character"). M1 snow, zoom 2, commando hidden (ring pixels only) and AO off. The selection's clock is
 * stubbed so frames land at exact times after the selection: at t = 0 the ring is wide and bright, at t = 0.9 s it
 * has contracted (centre line ≈ 0.49 m vs ≈ 0.59 m) and dimmed; at t = 1.2 s it snaps back to the t = 0 frame.
 * Then the live real-time clock with the game PAUSED still animates it, and reduced motion freezes it.
 * Saves docs/screenshots/ring-pulse-strip.jpg: 8 frames, one every 0.15 s after selecting.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TESTS_DIR } from './harness.mjs';

export default async function ringPulse(page, t) {
  const res = await page.evaluate(async () => {
    const g = window.__game, G = g.game, R = G.renderer, S = G.selection;
    await g.loadMission('m01'); g.start();
    const w = G.world, c = w.commandos[0];
    for (const e of w.enemies) e.brain && (e.brain.frozen = true);
    c.path = null;
    g.setZoom(2);
    g.centerOn(c.x, c.z);
    const ao = R.passes.ao, aoOn = ao?.enabled;
    if (ao) ao.enabled = false;
    const gl = R.renderer.getContext(), rect = R.domElement.getBoundingClientRect();
    const k = gl.drawingBufferWidth / R.domElement.clientWidth;
    const toBuf = (x, y, z) => { const s = G.cameraController.worldToScreen(x, y, z); return [Math.round((s.x - rect.left) * k), Math.round(gl.drawingBufferHeight - (s.y - rect.top) * k)]; };
    const o3 = c.object3d.position;
    const [fx, fy] = toBuf(o3.x, o3.y, o3.z);
    const H = Math.round(60 * k), W = 2 * H, x0 = fx - H, y0 = fy - H;
    const grab = () => { R.renderer.setRenderTarget(null); const px = new Uint8Array(W * W * 4); gl.readPixels(x0, y0, W, W, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    // strip: crop around the feet (soldier visible) drawn right after each render (same task → buffer intact)
    const strip = document.createElement('canvas'), cw = Math.round(120 * k), ch = Math.round(200 * k);
    strip.width = cw * 8; strip.height = ch;
    const sctx = strip.getContext('2d');
    const snap = (i) => sctx.drawImage(R.domElement, fx - cw / 2, gl.drawingBufferHeight - fy - ch + Math.round(45 * k), cw, ch, i * cw, 0, cw, ch);

    let fake = 1000;
    const realClock = S.clock;
    S.clock = () => fake;
    G.input.deselectAll();
    for (let i = 0; i < 3; i++) G.render(0, 1);
    // strip (soldier visible)
    G.input.select([c]);
    for (let i = 0; i < 8; i++) { fake = 1000 + i * 0.15; if (i === 0) G.render(0, 1); G.render(0, 1); snap(i); }
    // profiles: soldier hidden, ring vs no-ring along 8 ground rays from the feet
    c.object3d.visible = false;
    G.input.deselectAll(); G.render(0, 1);
    const base = grab();
    const profile = (px) => {
      let sw = 0, swr = 0, peak = 0;
      for (let a = 0; a < 8; a++) {
        const ang = a * Math.PI / 4;
        for (let r = 0.2; r <= 0.85; r += 0.01) {
          const [x, y] = toBuf(o3.x + Math.cos(ang) * r, o3.y, o3.z + Math.sin(ang) * r);
          if (x < x0 || x >= x0 + W || y < y0 || y >= y0 + W) continue;
          const i = ((y - y0) * W + (x - x0)) * 4;
          const d = Math.abs(px[i] - base[i]) + Math.abs(px[i + 1] - base[i + 1]) + Math.abs(px[i + 2] - base[i + 2]);
          sw += d; swr += d * r; peak = Math.max(peak, d);
        }
      }
      return { radius: +(swr / Math.max(1, sw)).toFixed(3), peak, mass: Math.round(sw) };
    };
    fake = 2000;
    G.input.select([c]); G.render(0, 1); // registers the selection at t = 2000
    const at = (dt) => { fake = 2000 + dt; G.render(0, 1); return { dt, ...profile(grab()) }; };
    const p0 = at(0), p9 = at(0.9), p12 = at(1.2);
    // live clock, game paused: the pulse is UI feedback and keeps animating in real time
    S.clock = realClock;
    g.pause(true);
    G.input.deselectAll(); G.render(0, 1);
    G.input.select([c]); G.render(0, 1);
    const l0 = profile(grab()), pausedState = G.state;
    await new Promise((r) => setTimeout(r, 700));
    G.render(0, 1);
    const l1 = profile(grab());
    // reduced motion: resting ring, no change over time
    const opts = G.options, rm = opts.reducedMotion;
    opts.reducedMotion = 'on';
    G.render(0, 1); const r0 = profile(grab());
    await new Promise((r) => setTimeout(r, 400));
    G.render(0, 1); const r1 = profile(grab());
    opts.reducedMotion = rm;
    g.pause(false);
    c.object3d.visible = true;
    if (ao) ao.enabled = aoOn;
    return { p0, p9, p12, l0, l1, r0, r1, strip: strip.toDataURL('image/jpeg', 0.85), paused: pausedState };
  });
  const { strip, ...m } = res;
  t.log(JSON.stringify(m));
  const { p0, p9, p12, l0, l1, r0, r1 } = m;
  t(p0.mass > 500 && p9.mass > 500, `ring drawn at both times (${p0.mass}, ${p9.mass})`);
  t(p0.radius > p9.radius + 0.05, `ring contracts after selection: centre ${p0.radius} m at 0 s → ${p9.radius} m at 0.9 s`);
  t(p0.radius > 0.52 && p0.radius < 0.66 && p9.radius > 0.42 && p9.radius < 0.56, `radii near the chess formula (≈0.59 / ≈0.49 m): ${p0.radius}, ${p9.radius}`);
  t(p0.peak > p9.peak, `ring dims as it contracts (peak Δ ${p0.peak} → ${p9.peak})`);
  t(Math.abs(p12.radius - p0.radius) < 0.02 && Math.abs(p12.peak - p0.peak) < 15, `snaps back after the 1.2 s cycle (${p12.radius}/${p12.peak} vs ${p0.radius}/${p0.peak})`);
  t(m.paused === 'paused', `game paused during the live check (${m.paused})`);
  t(Math.abs(l1.radius - l0.radius) > 0.03, `real-time pulse animates while paused (${l0.radius} → ${l1.radius} m)`);
  t(Math.abs(r1.radius - r0.radius) < 0.005 && r0.radius < 0.52, `reduced motion: static resting ring (${r0.radius}, ${r1.radius} m)`);
  const out = join(TESTS_DIR, '..', 'docs', 'screenshots', 'ring-pulse-strip.jpg');
  writeFileSync(out, Buffer.from(strip.split(',')[1], 'base64'));
  t.log(`strip → ${out}`);
}
