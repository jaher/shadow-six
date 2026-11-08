/**
 * Main-menu dogfight (src/ui/menu-dogfight.js; user: "Can we have a dog fight between airplanes after planes pass by
 * in the main menu"): test sessions never fight on their own and nothing is fetched before a pass; once a bombers'
 * pass is over (the section gone, its bursts down) the fight is armed, its sprites fetched, and it begins a moment
 * later; every frame of it (seeded: deterministic) keeps its planes in the visible sky, off the card's text, the hit
 * 109 alone going down behind the skyline; the menu text keeps ≥ 4.5:1 on its real pixels in the fight's worst frame;
 * the sounds are quiet and muffled (drone, MG bursts, dive whine) and all stop when it ends — cleanly, the layer freed;
 * a new card, a mission load or leaving the front end end it at once, and MENU BACKGROUND: STILL stands it down.
 */
export const timeout = 180_000;

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgb = (s) => { const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(s); return { r: +m[1], g: +m[2], b: +m[3] }; };

/** Mean colour of the page pixels inside each rect (CSS px), from a real screenshot. */
async function pixels(page, rects) {
  const png = (await page.screenshot({ type: 'png' })).toString('base64');
  return page.evaluate(async ([b64, rs]) => {
    const im = new Image(); im.src = `data:image/png;base64,${b64}`; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
    const k = im.width / innerWidth;
    return rs.map(([x, y, w, h]) => {
      const d = g.getImageData(Math.round(x * k), Math.round(y * k), Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))).data;
      let r = 0, gg = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      return { r: r / (d.length / 4), g: gg / (d.length / 4), b: b / (d.length / 4) };
    });
  }, [png, rects]);
}

export default async function menuDogfight(page, t) {
  await page.evaluate(() => window.__game.game.hud.screens.openMain());
  await page.waitForFunction(() => window.__game.game.hud.backdrop.ready && window.__game.game.hud.backdrop.embossReady, null, { timeout: 20000 });
  const st0 = await page.evaluate(() => { const d = window.__game.game.hud.backdrop.dogfight;
    return { blocked: d.blocked, running: d.running, fetched: !!d._img, store: d.canvas.width * d.canvas.height }; });
  t(st0.blocked && !st0.running && !st0.fetched && st0.store === 1, `a test session never fights on its own, nor fetches its sprites (${JSON.stringify(st0)})`);
  // a pass stepped to its end: the fight is armed once it is over, and begins a moment later (seed 7, the bounce)
  await page.evaluate(() => window.__game.game.hud.backdrop.bombers._load());
  await page.waitForFunction(() => window.__game.game.hud.backdrop.bombers._ready, null, { timeout: 20000 });
  const armed = await page.evaluate(() => {
    const bd = window.__game.game.hud.backdrop, b = bd.bombers, d = bd.dogfight;
    window.__ev = []; window.__sfx = [];
    b.o.audio = () => null;
    d.running = true;
    const after = d.after.bind(d), fight = d.fight.bind(d);
    d.after = () => { window.__ev.push({ after: true, over: !!b._pass?.over, bombs: b._bombs.length }); after(300); };
    d.fight = (force, seed, name) => fight(force, seed ?? 7, name ?? 'bounce');
    d.o.audio = () => ({ unlocked: true, playSfx: (id, pos, o) => {
      const h = { id, o, gains: [], ended: false, stopped: false, panNode: null, src: { playbackRate: { value: o?.rate ?? 1 } },
        setGain(g) { this.gains.push(g); }, stop() { this.stopped = this.ended = true; } };
      window.__sfx.push(h); return h; } });
    b.running = true; b.pass(true);
    const early = window.__ev.length;
    for (let i = 0; i < 600 && b._pass && !b._pass.over; i++) b._step(0.05);
    return { early, ev: window.__ev.slice() };
  });
  t(armed.early === 0 && armed.ev.length === 1 && armed.ev[0].over && armed.ev[0].bombs === 0, `the fight is armed when the pass is over, not before (${JSON.stringify(armed)})`);
  await page.waitForFunction(() => !!window.__game.game.hud.backdrop.dogfight._f, null, { timeout: 20000, polling: 100 });
  const f0 = await page.evaluate(() => { const d = window.__game.game.hud.backdrop.dogfight, f = d._f;
    return { name: f.p.name, seed: f.p.seed, t: f.t, end: f.end, kill: f.kill, gone: f.gone, at: f.at, box: f.box,
      fetched: /fighters\.webp$/.test(d._img?.src || '') && d._ready }; });
  t(f0.name === 'bounce' && f0.seed === 7 && f0.fetched && f0.end - f0.t >= 15 && f0.end - f0.t <= 32, `the fight begins after the pass, its sprites fetched then (${JSON.stringify(f0)})`);
  // every frame: planes in the visible sky, off the card's text (and drawn there), the hit 109 alone going down
  const sweep = await page.evaluate(async () => {
    const P = await import('/src/ui/dogfight-plan.js');
    const bd = window.__game.game.hud.backdrop, d = bd.dogfight, f = d._f, cr = bd.planes.getBoundingClientRect();
    const W = bd.planes.clientWidth, H = bd.planes.clientHeight, vx = (x) => cr.left + x * cr.width / W, vy = (y) => cr.top + y * cr.height / H;
    const text = bd._textRects(), bad = [], g = d.canvas.getContext('2d');
    let shown = 0, drawn = 0, worst = { t: f.t, d: Infinity };
    for (let t = Math.ceil(f.t * 2) / 2; t < f.p.dur; t += 0.5) {
      d.seek(t);
      for (const { q, i } of f.planes) {
        const v = P.view(q, f.at, t), e = 0.5 * v.len;
        if (v.x < -e || v.x > W + e || v.y < -e || v.y > H + e || v.r < P.FADE[0]) continue;
        const x = vx(v.x), y = vy(v.y), down = f.kill && i === f.kill.g && t > f.kill.t + 0.6;
        if (v.y + 0.4 * e > f.skyAt(v.x)) { if (!down) bad.push(`plane ${i} under the skyline at ${t}`); continue; }
        if (text.some((r) => x + e > r.left && x - e < r.right && y + e > r.top && y - e < r.bottom)) bad.push(`plane ${i} over the text at ${t}`);
        shown++;
        const px = Math.round((v.x - f.box.x) * f.dpr), py = Math.round((v.y - f.box.y) * f.dpr), m = Math.max(2, Math.round(e * f.dpr));
        const a = g.getImageData(Math.max(0, px - m), Math.max(0, py - m), 2 * m, 2 * m).data;
        let n = 0; for (let k = 3; k < a.length; k += 4) if (a[k] > 40) n++;
        if (n > 4) drawn++;
        const dist = Math.min(...text.map((r) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom))));
        if (dist < worst.d) worst = { t, d: dist };
      }
    }
    return { bad, shown, drawn, worst };
  });
  t(sweep.bad.length === 0, `every plane stays in the visible sky, off the card's text (${sweep.bad.slice(0, 4).join('; ') || 'none out'})`);
  t(sweep.shown > 60 && sweep.drawn >= 0.9 * sweep.shown, `the planes are drawn where they fly (${sweep.drawn}/${sweep.shown} samples)`);
  // the menu text on its real pixels in the fight's worst frame (the planes nearest it), labels hidden
  await page.evaluate((tt) => window.__game.game.hud.backdrop.dogfight.seek(tt), sweep.worst.t);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.mk-host .mk-card .mk-list .mk-row .mk-label, .mk-host .mk-card .mk-title > span')].map((l) => {
    const r = l.getBoundingClientRect(), title = !!l.closest('.mk-title');
    return { label: l.textContent, title, color: getComputedStyle(title ? l.parentElement : l).color, rect: [r.x, r.y, r.width, r.height] }; }));
  const hide = (on) => page.evaluate((h) => document.querySelectorAll('.mk-host .mk-card .mk-label, .mk-host .mk-card .mk-title').forEach((l) => { l.style.visibility = h ? 'hidden' : ''; }), on);
  await hide(true);
  const under = await pixels(page, rows.map((r) => r.rect));
  await page.evaluate(() => { window.__game.game.hud.backdrop.fight.style.visibility = 'hidden'; });
  const bare = await pixels(page, rows.map((r) => r.rect));
  await page.evaluate(() => { window.__game.game.hud.backdrop.fight.style.visibility = ''; });
  await hide(false);
  const crs = rows.map((r, i) => ({ label: r.label, title: r.title, cr: contrast(rgb(r.color), under[i]), bare: contrast(rgb(r.color), bare[i]) }));
  const lows = crs.filter((r) => !r.title).sort((a, b) => a.cr - b.cr), head = crs.find((r) => r.title);
  t(lows.length >= 6 && lows[0].cr >= 4.5, `menu rows ≥ 4.5:1 in the fight's worst frame (t ${sweep.worst.t} s, ${sweep.worst.d.toFixed(0)} px from the text): lowest "${lows[0].label}" ${lows[0].cr.toFixed(2)}:1`);
  t(crs.every((r) => r.cr >= r.bare - 0.05), `the planes and smoke never lower the text's contrast (${crs.map((r) => (r.cr - r.bare).toFixed(3)).join(' ')})`);
  t(!head || head.cr >= 3, `the large title ≥ 3:1 (${head && head.cr.toFixed(2)}:1, as without the fight ${head && head.bare.toFixed(2)}:1)`);
  t.log(`fight ${f0.name}/${f0.seed}: ${sweep.drawn}/${sweep.shown} plane samples drawn in open sky; worst frame ${sweep.worst.t} s (${sweep.worst.d.toFixed(0)} px from the text): rows ≥ ${lows[0].cr.toFixed(2)}:1, title ${head?.cr.toFixed(2)}:1`);
  // its sounds on the clock: the drone, each burst's muffled rattle, the dive whine — and all of it gone at the end
  const tb = f0.kill.t - 1.6;
  await page.evaluate((tt) => { const d = window.__game.game.hud.backdrop.dogfight; d.seek(tt); d.resume(); }, tb);
  await page.waitForFunction((k) => window.__game.game.hud.backdrop.dogfight._f?.t > k + 1.6, f0.kill.t, { timeout: 15000, polling: 100 });
  await page.evaluate((e) => { const d = window.__game.game.hud.backdrop.dogfight; d.seek(e - 1.5); d.resume(); }, f0.end);
  await page.waitForFunction(() => !window.__game.game.hud.backdrop.dogfight._f, null, { timeout: 15000, polling: 100 });
  const snd = await page.evaluate(() => { const d = window.__game.game.hud.backdrop.dogfight;
    return { sfx: window.__sfx.map((h) => ({ id: h.id, gain: h.o?.gain, muffle: !!h.o?.muffle, loop: !!h.o?.loop, max: Math.max(0, ...h.gains), stopped: h.stopped })),
      store: d.canvas.width * d.canvas.height, running: d.running }; });
  const drone = snd.sfx.find((s) => s.id === 'plane_engine' && s.loop), mg = snd.sfx.filter((s) => s.id === 'mg_burst'), loops = snd.sfx.filter((s) => s.loop);
  t(drone && drone.muffle && drone.max > 0 && drone.max <= 0.05, `a quiet, muffled engine drone (${JSON.stringify(drone)})`);
  t(mg.length >= 1 && mg.every((s) => s.muffle && s.gain <= 0.15), `very muffled MG bursts (${mg.length})`);
  t(loops.length >= 2 && loops.every((s) => s.stopped), `the drone and the dive whine stop when it ends (${JSON.stringify(loops)})`);
  t(snd.store === 1 && snd.running, `it ends cleanly: the layer freed, the next one armed (${JSON.stringify(snd)})`);
  // a new card, a mission load, leaving the front end: a fight in flight ends at once; STILL stands it down
  const cut = await page.evaluate(async () => {
    const hud = window.__game.game.hud, bd = hud.backdrop, d = bd.dogfight, out = {};
    await d.fight(true, 3, 'headon'); d.seek(8);
    hud.menus.showOptions();
    out.card = { f: !!d._f, store: d.canvas.width * d.canvas.height, stopped: window.__sfx.slice(-3).every((h) => !h.loop || h.stopped) };
    hud.screens.openMain();
    await d.fight(true, 3, 'scissors');
    hud.game.events.emit('mission:loading', {});
    out.load = { f: !!d._f, running: d.running };
    d.running = true; await d.fight(true, 4, 'bounce');
    bd.setMode('paper');
    out.paper = { f: !!d._f, running: d.running };
    bd.setMode('frontend');
    const mb = hud.options.menuBg; hud.options.menuBg = 'still'; d.running = false; d.start(); out.still = d.running; hud.options.menuBg = mb;
    return out;
  });
  t(!cut.card.f && cut.card.store === 1 && cut.card.stopped, `a new card ends the fight in flight (${JSON.stringify(cut.card)})`);
  t(!cut.load.f && !cut.load.running, 'a mission load stops it all');
  t(!cut.paper.f && !cut.paper.running, 'leaving the front end stops it');
  t(cut.still === false, 'MENU BACKGROUND: STILL (and reduced motion) stands it down');
}
