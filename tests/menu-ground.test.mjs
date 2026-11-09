/**
 * Main-menu ground fight (src/ui/menu-ground.js, the director src/ui/menu-director.js; user: "Can we have rhe soldiers
 * fighting and maybe a tank crossing the bridge shooting"): test sessions never start it on their own; forced on the
 * river still it begins, its sprites in; a German behind the sandbag pit's wall is hidden below the wall's top by the
 * still's own depth (and nothing hides a man in the open); the tank is drawn; every report is quiet and muffled, the
 * tank's engine and tracks loop while it is there and stop when the fight ends (once the tank has left the frame) —
 * its field left as it stands, still, the director told, no new fight over it; the menu's rows keep ≥ 4.5:1 in the
 * fight's busiest frame; a new card, a mission load and leaving the front end
 * end it at once, and MENU BACKGROUND: STILL stands it down.
 */
export const timeout = 180_000;

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgb = (s) => { const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(s); return { r: +m[1], g: +m[2], b: +m[3] }; };

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

export default async function menuGround(page, t) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.evaluate(() => window.__game.game.hud.screens.openMain());
  await page.evaluate(() => { const b = window.__game.game.hud.backdrop; b.dioramaMission = () => ({ theater: 'temperate' }); b._still(); });
  await page.waitForFunction(() => window.__game.game.hud.backdrop.ready && window.__game.game.hud.backdrop.embossReady, null, { timeout: 20000 });
  await page.waitForTimeout(1300);
  const st0 = await page.evaluate(() => { const bd = window.__game.game.hud.backdrop, g = bd.ground, dr = bd.director;
    return { blocked: g.blocked, running: g.running, director: dr.running, loaded: Object.keys(g._sets).length, store: g.canvas.width * g.canvas.height }; });
  t(st0.blocked && !st0.running && !st0.director && st0.loaded === 0 && st0.store === 1, `a test session never starts the director or loads the fight (${JSON.stringify(st0)})`);
  // forced on the river still, with a stand-in audio that records the reports and the loops
  const f0 = await page.evaluate(async () => {
    const bd = window.__game.game.hud.backdrop, g = bd.ground;
    window.__sfx = []; window.__done = 0;
    g.o.audio = () => ({ unlocked: true, playSfx: (id, pos, o) => {
      const h = { id, o, gains: [], ended: false, stopped: false, setGain(v) { this.gains.push(v); }, stop() { this.stopped = this.ended = true; } };
      window.__sfx.push(h); return h; } });
    g.o.done = () => { window.__done++; };
    const ok = await g.fight(true, 1);
    const f = g._f;
    return { ok, variant: f?.p.variant, seen: f?.seen, box: f?.box, end: f?.end, atlas: !!g._sets.temperate?.atlas, why: g.why };
  });
  t(f0.ok && f0.atlas && f0.seen > 0.8 && f0.end >= 20, `forced on the river still it begins, its sprites in (${JSON.stringify(f0)})`);
  // the German behind the pit's S wall: the wall hides his legs; the commandos in the open are not cut
  const occ = await page.evaluate(async () => {
    const { soldierAt } = await import('/src/ui/ground-plan.js');
    const g = window.__game.game.hud.backdrop.ground, f = g._f, out = [];
    for (const t of [4, 6, 8]) {
      g.seek(t);
      for (const [i, s] of f.p.soldiers.entries()) {
        const m = f.masked.get(s);
        out.push({ t, i, side: s.side, look: s.look, act: soldierAt(s, t, f.end)?.act, drawn: !!m, clear: !!m?.clear, opaque: m?.opaque || 0, hidden: m?.hidden || 0 });
      }
      f.masked.clear();
    }
    return out;
  });
  // the two riflemen in the pit, up at the wall (one crouched in cover behind it is hidden whole: below)
  const pit = occ.filter((o) => (o.look === 'rf1' || o.look === 'rf2') && o.act !== 'cover' && o.opaque > 20);
  const ducked = occ.filter((o) => (o.look === 'rf1' || o.look === 'rf2') && o.act === 'cover' && o.opaque > 20);
  t(ducked.every((o) => o.hidden / o.opaque > 0.6), `a German crouched in the pit's cover is hidden by its wall (${JSON.stringify(ducked.slice(0, 2))})`);
  t(pit.length >= 2 && pit.every((o) => o.hidden / o.opaque > 0.12 && o.hidden / o.opaque < 0.8), `the sandbag wall hides the pit's Germans below its top (${JSON.stringify(pit.slice(0, 4))})`);
  const open = occ.filter((o) => o.side === 'ally' && o.drawn);
  t(open.length >= 3 && open.filter((o) => o.clear || o.hidden / o.opaque < 0.05).length >= 2, `nothing hides the commandos in the open field (${JSON.stringify(open.slice(0, 4))})`);
  const drawn = await page.evaluate(() => {
    const g = window.__game.game.hud.backdrop.ground, c = g.canvas;
    g.seek(8);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
    return n;
  });
  t(drawn > 400, `the men and the tank are drawn (${drawn} px)`);
  // the menu's rows and title on their real pixels in the fight's busiest frames (the tank gun's flash and smoke, the
  // shell's burst and its dust), labels hidden: the fight never takes them under 4.5:1, nor lowers them
  const sh0 = await page.evaluate(() => { const s = window.__game.game.hud.backdrop.ground._f.p.shells[0]; return s ? [s.t, s.flight] : null; });
  const busy = sh0 ? [sh0[0] + 0.05, sh0[0] + sh0[1] + 0.35, sh0[0] + sh0[1] + 1.6] : [8];
  const rows = await page.evaluate(() => [...document.querySelectorAll('.mk-host .mk-card .mk-list .mk-row .mk-label, .mk-host .mk-card .mk-title > span')].map((l) => {
    const r = l.getBoundingClientRect(), title = !!l.closest('.mk-title');
    return { label: l.textContent, title, color: getComputedStyle(title ? l.parentElement : l).color, rect: [r.x, r.y, r.width, r.height] }; }));
  const hide = (on) => page.evaluate((h) => document.querySelectorAll('.mk-host .mk-card .mk-label, .mk-host .mk-card .mk-title').forEach((l) => { l.style.visibility = h ? 'hidden' : ''; }), on);
  let crs = [];
  await hide(true);
  for (const tt of busy) {
    await page.evaluate((x) => window.__game.game.hud.backdrop.ground.seek(x), tt);
    const under = await pixels(page, rows.map((r) => r.rect));
    await page.evaluate(() => { window.__game.game.hud.backdrop.groundLayer.style.visibility = 'hidden'; });
    const bare = await pixels(page, rows.map((r) => r.rect));
    await page.evaluate(() => { window.__game.game.hud.backdrop.groundLayer.style.visibility = ''; });
    crs.push(...rows.map((r, i) => ({ t: tt, label: r.label, title: r.title, cr: contrast(rgb(r.color), under[i]), bare: contrast(rgb(r.color), bare[i]) })));
  }
  await hide(false);
  const lows = crs.filter((r) => !r.title).sort((a, b) => a.cr - b.cr), head = crs.filter((r) => r.title).sort((a, b) => a.cr - b.cr)[0];
  t(lows.length >= 6 && lows[0].cr >= 4.5, `menu rows ≥ 4.5:1 in the fight's busiest frames (lowest "${lows[0]?.label}" ${lows[0]?.cr.toFixed(2)}:1 at ${lows[0]?.t.toFixed(1)} s)`);
  t(!head || head.cr >= 3, `the large title ≥ 3:1 (${head?.cr.toFixed(2)}:1, as without the fight ${head?.bare.toFixed(2)}:1)`);
  t(crs.every((r) => r.cr >= r.bare - 0.05), `the fight's flashes, smoke and dust never lower the text's contrast (${crs.map((r) => (r.cr - r.bare).toFixed(3)).join(' ')})`);
  t.log?.(`ground fight seed 1 (variant ${f0.variant}): rows ≥ ${lows[0]?.cr.toFixed(2)}:1, title ${head?.cr.toFixed(2)}:1 in the gun's flash, the burst and its dust`);
  // its sounds on the clock: from just before the tank's first shot to the end
  const shot = await page.evaluate(() => window.__game.game.hud.backdrop.ground._f.p.shells[0].t);
  await page.evaluate((tt) => { const g = window.__game.game.hud.backdrop.ground; g.seek(tt); g.resume(); }, shot - 3);
  await page.waitForFunction((tt) => (window.__game.game.hud.backdrop.ground._f?.t ?? 99) > tt, shot + 1.6, { timeout: 15000, polling: 100 });
  await page.evaluate(() => { const g = window.__game.game.hud.backdrop.ground; const f = g._f; g.seek(f.end - 1.2); g.resume(); });
  await page.waitForFunction(() => window.__game.game.hud.backdrop.ground._f?.state === 'over', null, { timeout: 15000, polling: 100 });
  await page.waitForTimeout(300);
  const snd = await page.evaluate(async () => {
    const g = window.__game.game.hud.backdrop.ground, f = g._f, t = f.t;
    await new Promise((r) => setTimeout(r, 400));
    const again = await g.fight(false);                     // (an unforced fight over the field the last one left)
    return { sfx: window.__sfx.map((h) => ({ id: h.id, gain: h.o?.gain, muffle: !!h.o?.muffle, loop: !!h.o?.loop, max: Math.max(0, ...h.gains), stopped: h.stopped })),
      done: window.__done, store: g.canvas.width * g.canvas.height, still: f.t === t && g._f === f, again };
  });
  const ids = new Set(snd.sfx.map((s) => s.id)), loops = snd.sfx.filter((s) => s.loop), once = snd.sfx.filter((s) => !s.loop);
  t(['tank_cannon', 'explosion_far'].every((id) => ids.has(id)) && once.length >= 4, `the gun, the shell's crump and the small arms are heard (${[...ids].join(', ')})`);
  t(snd.sfx.every((s) => s.muffle) && once.every((s) => s.gain <= 0.15) && loops.every((s) => s.max <= 0.06), 'every report muffled and quiet, under the music');
  t(loops.length === 2 && loops.every((s) => s.stopped), `the tank's engine and tracks loop and stop with it (${JSON.stringify(loops)})`);
  t(snd.done === 1 && snd.store > 1 && snd.still && snd.again === false, `it ends with its field left as it stands — the dead down, the living at their posts, still (no frame loop) — the director told, no fight over it (${JSON.stringify({ done: snd.done, store: snd.store, still: snd.still, again: snd.again })})`);
  // a new card, a mission load, leaving the front end: a fight in flight ends at once; STILL stands it down
  const cut = await page.evaluate(async () => {
    const hud = window.__game.game.hud, bd = hud.backdrop, g = bd.ground, out = {};
    await g.fight(true, 2); g.seek(6);
    hud.menus.showOptions();
    out.card = { f: !!g._f, store: g.canvas.width * g.canvas.height };
    hud.screens.openMain();
    await g.fight(true, 3);
    hud.game.events.emit('mission:loading', {});
    out.load = { f: !!g._f, running: g.running };
    g.running = true; await g.fight(true, 4);
    bd.setMode('paper');
    out.paper = { f: !!g._f, running: g.running };
    bd.setMode('frontend');
    const mb = hud.options.menuBg; hud.options.menuBg = 'still'; g.running = false; g.start(); out.still = g.running; hud.options.menuBg = mb;
    return out;
  });
  t(!cut.card.f && cut.card.store === 1, `a new card ends the fight in flight (${JSON.stringify(cut.card)})`);
  t(!cut.load.f && !cut.load.running, 'a mission load stops it');
  t(!cut.paper.f && !cut.paper.running, 'leaving the front end stops it');
  t(cut.still === false, 'MENU BACKGROUND: STILL (and reduced motion) stands it down');
}
