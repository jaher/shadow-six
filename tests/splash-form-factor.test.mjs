/**
 * Title splash on every form factor (user, 2026-11-08, on a foldable phone: "the first in the intro screen is shifted
 * away from the tank", and "I dont see the bombs on the phone but I do on the computer. The coordinates should adjust
 * to form factor"; src/ui/splash-plate.js):
 *  - the fire burns on the tank: the centroid of the fire layer's flame-coloured pixels lies inside the tank's
 *    plate-space box as the stage shows it, on phones both ways, foldables folded and unfolded, a tablet, 1:1, 21:9
 *    and the desktop — and after the stage changes shape under it (a fold opened: cover screen to inner screen);
 *  - a Spitfire pass bombs where it can be seen: at its first impact a burst and the formation are on screen.
 */
export const timeout = 420_000;

const SCREENS = [
  ['phone-portrait', { width: 390, height: 844 }, 3, true],
  ['phone-360', { width: 360, height: 800 }, 3, true],
  ['phone-landscape', { width: 844, height: 390 }, 3, true],
  ['fold-cover', { width: 344, height: 882 }, 3, true],
  ['fold-inner', { width: 884, height: 1104 }, 2, true],
  ['fold-inner-landscape', { width: 1104, height: 884 }, 2, true],
  ['tablet', { width: 820, height: 1180 }, 2, true],
  ['square', { width: 900, height: 900 }, 1, false],
  ['ultrawide', { width: 2520, height: 1080 }, 1, false],
  ['desktop', { width: 1920, height: 1080 }, 1, false],
];

/** The flame-coloured pixels of the fire layer alone (every other splash layer hidden): their centroid, stage px. */
async function fireCentroid(p) {
  await p.evaluate(() => {
    document.documentElement.classList.add('t-fx-only');
    const st = document.createElement('style');
    st.id = 't-fx-only';
    st.textContent = '.t-fx-only .bt-splash > :not(.bt-art), .t-fx-only .bt-art > :not(.fx), .t-fx-only .bt-art::after { visibility: hidden !important; }'
      + ' .t-fx-only .bt-art { background: #000 !important; }';
    document.head.appendChild(st);
  });
  await p.waitForTimeout(250);
  const png = await p.screenshot();
  await p.evaluate(() => { document.documentElement.classList.remove('t-fx-only'); document.getElementById('t-fx-only')?.remove(); });
  return p.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, k = img.width / innerWidth;
    let n = 0, sx = 0, sy = 0;
    for (let y = 0; y < c.height; y += 2) {
      for (let x = 0; x < c.width; x += 2) {
        const i = (y * c.width + x) * 4, r = d[i], gg = d[i + 1], bb = d[i + 2];
        if (r > 170 && r > bb + 90 && gg > 40) { n++; sx += x; sy += y; }   // flames: hot orange to white-yellow
      }
    }
    return n ? { n, x: sx / n / k, y: sy / n / k } : { n: 0 };
  }, png.toString('base64'));
}

async function checkFire(p, t, name) {
  const fit = await p.evaluate(() => window.shadowSix.hud.boot.fx?.fit?.() || null);
  t(fit, `${name}: the fire layer runs (WebGL2)`);
  if (!fit) return;
  const c = await fireCentroid(p);
  const [x0, y0, x1, y1] = fit.tank;
  t(c.n > 20, `${name}: flames drawn (${c.n} px)`);
  t(c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1,
    `${name}: the fire's centroid (${c.x?.toFixed(0)}, ${c.y?.toFixed(0)}) is on the tank [${fit.tank.map((v) => v.toFixed(0))}]`);
  t(c.x > 0 && c.x < fit.W && c.y > 0 && c.y < fit.H, `${name}: the fire is on screen`);
}

async function checkPass(p, t, name) {
  const started = await p.evaluate(() => { const pl = window.shadowSix.hud.boot.planes; if (!pl?.alive) return false; clearTimeout(pl._timer); pl.pass(); return !!pl._pass; });
  t(started, `${name}: a Spitfire pass flies`);
  if (!started) return;
  const hit = await p.waitForFunction(() => {
    const pl = window.shadowSix.hud.boot.planes;
    if (!pl?._pass || !pl._booms.length) return null;
    const c = pl.canvas.getBoundingClientRect(), lay = pl._lay, sx = c.width / lay.w, sy = c.height / lay.h;
    const on = ([x, y]) => x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight;
    const booms = pl._booms.map((b) => [c.left + b.x * sx, c.top + (b.y ?? lay.horizon) * sy]);
    const planes = pl._planesVp();
    return { booms: booms.filter(on).length, planes: planes.filter(on).length, of: planes.length, drops: lay.drops?.length || 0 };
  }, null, { timeout: 25000, polling: 30 }).then((r) => r.jsonValue(), () => null);
  t(hit, `${name}: the bombs burst within the pass`);
  if (!hit) return;
  t(hit.booms >= 1, `${name}: at the first impact a burst is on screen (${JSON.stringify(hit)})`);
  t(hit.planes >= 1, `${name}: at the first impact the formation is on screen (${hit.planes}/${hit.of} planes)`);
}

async function splashAt(t, viewport, dpr, touch) {
  const ctx = await t.harness.browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile: touch, hasTouch: touch });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('shadowsix.rotate.dismissed', '1'); } catch { /* */ } }); // no rotate hint over it
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await t.harness.openGame(p);
  await p.evaluate(() => window.shadowSix.hud.boot.showSplash({ ready: true }));
  await p.waitForFunction(() => { const s = document.querySelector('.bt-l.sky'), h = document.querySelector('.bt-l.hero'); return s?.complete && s.naturalWidth && h?.complete && h.naturalHeight; }, null, { timeout: 30000 });
  await p.evaluate(() => { const pl = window.shadowSix.hud.boot.planes; if (pl) clearTimeout(pl._timer); });
  await p.waitForTimeout(900);
  return { ctx, p, errs };
}

export default async function splashFormFactor(page, t) {
  for (const [name, viewport, dpr, touch] of SCREENS) {
    const { ctx, p, errs } = await splashAt(t, viewport, dpr, touch);
    try {
      await checkFire(p, t, name);
      await checkPass(p, t, name);
      if (name === 'phone-portrait' || name === 'fold-inner') await p.screenshot({ path: t.harness.shotPath(`splash-${name}.png`) });
      t(errs.length === 0, `${name}: no page errors ${errs.join('; ')}`);
    } finally {
      await ctx.close().catch(() => {});
    }
  }
  // a foldable opened mid-splash (no reload): the cover screen, then the inner screen — and folded again
  const { ctx, p, errs } = await splashAt(t, { width: 344, height: 882 }, 3, true);
  try {
    await checkFire(p, t, 'fold cover (before unfolding)');
    await p.setViewportSize({ width: 884, height: 1104 });
    await p.waitForTimeout(700);
    await checkFire(p, t, 'unfolded to the inner screen');
    await checkPass(p, t, 'unfolded to the inner screen');
    await p.setViewportSize({ width: 344, height: 882 });
    await p.waitForTimeout(700);
    await checkFire(p, t, 'folded back to the cover screen');
    t(errs.length === 0, `fold / unfold: no page errors ${errs.join('; ')}`);
  } finally {
    await ctx.close().catch(() => {});
  }
}
