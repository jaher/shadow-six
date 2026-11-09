/**
 * The knapsack as one object (user 2026-11-08: "Make the backpack with items in the lower right corner during the game
 * similar to the original, not a flat backpack with icons", "Backpack doesn't look nice, look at original", "Items should
 * be in 3d hanging from backpack"). At 1080p every commando's pack draws the rucksack render (kit/pack) with each of his
 * items as a decoded, non-empty pre-lit layer hanging on it; a disabled item hangs greyed and dimmed (measured from the
 * screen: less colour and less light than the same item enabled) and keeps its reason tooltip; hover lifts an item and
 * the armed tool stays raised; Tab swaps to the mirrored renders (kit/pack.left); the occupant view is his photo alone.
 * Close-ups → tests/out/knapsack-pack-<case>.png.
 */
import { join } from 'node:path';
import { TESTS_DIR } from './harness.mjs';
import { KITS, kitUp } from './ui-icons-lib.mjs';

export const timeout = 240_000;

/** Every image on the pack: loaded, from the manifest, with visible pixels (alpha read back from the decoded file). */
async function packImages(page) {
  return page.evaluate(async () => {
    const out = [];
    const opaque = async (img) => {
      const im = new Image();
      im.src = img.currentSrc || img.src;
      await im.decode();
      const cv = document.createElement('canvas');
      cv.width = im.naturalWidth; cv.height = im.naturalHeight;
      const ctx = cv.getContext('2d');
      ctx.drawImage(im, 0, 0);
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
      return n / (cv.width * cv.height);
    };
    const art = document.querySelector('.hud-knapsack > img.packart');
    out.push({ what: 'pack', icon: art?.dataset.icon || '', ok: !!art && art.complete && art.naturalWidth > 0, fill: art ? await opaque(art) : 0 });
    for (const b of document.querySelectorAll('.hud-knapsack .item')) {
      const img = b.querySelector(':scope > img.ico');
      out.push({ what: b.dataset.item, icon: img?.dataset.icon || '', ok: !!img && img.complete && img.naturalWidth > 0, fill: img ? await opaque(img) : 0,
        disabled: b.classList.contains('disabled'), aria: b.getAttribute('aria-disabled'), tip: b.dataset.tip || '', filter: img ? getComputedStyle(img).filter : '' });
    }
    return out;
  });
}

/** Mean luminance and chroma (0..255) on screen of the opaque pixels of the render `sel` (an <img>): a screenshot of its
 *  box, masked by the image's own alpha drawn at the same size (the pack around it does not count). */
async function tone(page, sel) {
  const png = await page.locator(sel).screenshot();
  return page.evaluate(async ([b64, s]) => {
    const img = document.querySelector(s);
    const im = new Image();
    im.src = `data:image/png;base64,${b64}`;
    await im.decode();
    const W = im.naturalWidth, H = im.naturalHeight;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.drawImage(im, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;
    const art = new Image();
    art.src = img.currentSrc || img.src;
    await art.decode();
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(art, 0, 0, W, H);
    const a = ctx.getImageData(0, 0, W, H).data;
    let L = 0, C = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (a[i + 3] < 220) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      L += 0.2126 * r + 0.7152 * g + 0.0722 * b; C += Math.max(r, g, b) - Math.min(r, g, b); n++;
    }
    return { L: L / Math.max(1, n), C: C / Math.max(1, n), n };
  }, [png.toString('base64'), sel]);
}

const transformOf = (page, sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).transform, sel);

export default async function knapsackPack(page0, t) {
  const h = t.harness;
  const page = await h.newPage({ width: 1920, height: 1080 });
  try {
    await h.openGame(page);
    await page.evaluate(async () => {
      const g = window.__game;
      await g.loadMission('m00');
      g.start();
      g.render();
      await g.game.hud.iconsReady;
    });
    const shot = async (name) => {
      const b = await page.locator('.hud-knapsack').boundingBox();
      await page.screenshot({ path: join(TESTS_DIR, 'out', `knapsack-pack-${name}.png`), clip: { x: b.x - 6, y: b.y - 6, width: b.width + 12, height: b.height + 6 } });
    };
    // each role's own kit lies in the open pack, every item a real render with visible pixels
    for (const [role, inv] of KITS.slice(0, 6)) {
      await kitUp(page, role, inv);
      const imgs = await packImages(page);
      const pack = imgs[0], items = imgs.slice(1);
      t(pack.ok && pack.icon === 'kit/pack' && pack.fill > 0.35, `${role}: the rucksack render is drawn (${JSON.stringify(pack)})`);
      t.equal(items.length, Object.keys(inv).length, `${role}: one item per kit entry`);
      for (const it of items) {
        t(it.ok && it.icon.startsWith('kit/'), `${role} ${it.what}: drawn from a decoded kit layer (${it.icon})`);
        t(it.fill > 0.04, `${role} ${it.what}: the layer has visible pixels (${(it.fill * 100).toFixed(1)} % opaque)`);
        if (!it.disabled) t(it.filter === 'none', `${role} ${it.what}: an available item is drawn as rendered (filter ${it.filter})`);
      }
      await shot(role);
    }
    // counts that are not units are stencilled on the kit (no badge): the Driver's 20 bursts on his magazine pouch, his
    // first-aid doses on the pouch
    const drv = KITS.find(([r]) => r === 'driver');
    await kitUp(page, 'driver', drv[1]);
    const st = await page.evaluate(() => {
      const box = document.querySelector('.hud-knapsack').getBoundingClientRect();
      return { tags: document.querySelectorAll('.hud-knapsack .count.tag').length, st: [...document.querySelectorAll('.hud-knapsack .count.stencil')].map((c) => {
        const r = c.getBoundingClientRect();
        return { item: c.closest('.item').dataset.item, text: c.textContent, h: r.height, inside: r.left >= box.left - 2 && r.right <= box.right + 2 && r.top >= box.top - 2 && r.bottom <= box.bottom + 2 };
      }) };
    });
    t(!st.tags, `no count badges (${st.tags})`);
    const smgSt = st.st.find((c) => c.item === 'smg'), aidSt = st.st.find((c) => c.item === 'firstAid');
    t(smgSt?.text === String(drv[1].smg) && aidSt?.text === String(drv[1].firstAid), `bursts and doses stencilled on the kit (${JSON.stringify(st.st)})`);
    t(st.st.every((c) => c.inside && c.h >= 14), `the stencils sit on the knapsack, legible (${JSON.stringify(st.st)})`);
    await shot('stencils');
    // disabled: the Spy's uniform while he wears it, the Marine's boat and diving gear on dry land (m00)
    const spy = KITS.find(([r]) => r === 'spy');
    await kitUp(page, 'spy', spy[1]);
    await page.mouse.move(900, 500);
    const on = await tone(page, '.hud-knapsack .item[data-item="uniform"] > img.ico');
    await page.evaluate(async () => {
      const g = window.__game, hud = g.game.hud;
      g.game.world.commandos[0].disguised = true;
      hud.knapsack.sig = '';
      hud.update(0.01);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await Promise.all([...document.querySelectorAll('.hud-knapsack img')].map((i) => i.decode().catch(() => null)));
    });
    const imgs = await packImages(page);
    const uni = imgs.find((i) => i.what === 'uniform');
    t(uni.disabled && uni.aria === 'true', 'spy in uniform: the uniform is disabled');
    t(/ALREADY IN UNIFORM/.test(uni.tip), `the disabled reason stays on the tooltip (${uni.tip})`);
    t(/grayscale/.test(uni.filter) && /brightness\(0\.[0-6]/.test(uni.filter), `the disabled item is greyed and dimmed (${uni.filter})`);
    t(uni.ok && uni.fill > 0.08, 'the disabled item is still drawn in the pack');
    const off = await tone(page, '.hud-knapsack .item[data-item="uniform"] > img.ico');
    t(on.n > 200 && off.n > 200 && off.L < on.L * 0.8 && off.C < on.C * 0.6, `on screen it is darker and greyer than enabled (L ${on.L.toFixed(1)} → ${off.L.toFixed(1)}, C ${on.C.toFixed(1)} → ${off.C.toFixed(1)})`);
    await shot('disabled-spy');
    const diver = KITS.find(([r]) => r === 'diver');
    await kitUp(page, 'diver', diver[1]);
    const dv = await packImages(page);
    const boat = dv.find((i) => i.what === 'inflatableBoat');
    t(boat.disabled && /SHALLOW WATER/.test(boat.tip) && /grayscale/.test(boat.filter), `marine on dry land: the boat lies disabled (${boat.tip})`);
    t(dv.filter((i) => i.what !== 'pack' && !i.disabled).every((i) => i.filter === 'none'), 'marine: his usable kit is not dimmed');
    // hover lifts an item off the pack floor; the armed tool stays raised
    await kitUp(page, 'greenberet', KITS[0][1]);
    await page.mouse.move(900, 500);
    t.equal(await transformOf(page, '.hud-knapsack .item[data-item="pistol"] > img.ico'), 'none', 'at rest the pistol lies flat');
    await page.locator('.hud-knapsack .item[data-item="pistol"]').hover();
    await page.waitForTimeout(250);
    t((await transformOf(page, '.hud-knapsack .item[data-item="pistol"] > img.ico')) !== 'none', 'hover lifts the pistol');
    await shot('hover');
    await page.mouse.move(900, 500);
    const armed = await page.evaluate(async () => {
      const g = window.__game.game, hud = g.hud;
      const b = document.querySelector('.hud-knapsack .item[data-item="knife"]');
      b.click();
      hud.update(0.01);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const k = document.querySelector('.hud-knapsack .item[data-item="knife"]');
      return { armed: k.classList.contains('armed'), tf: getComputedStyle(k.querySelector(':scope > img.ico')).transform, tgt: g.input?.targeting?.abilityId || '' };
    });
    await page.waitForTimeout(250);
    t(armed.armed && armed.tf !== 'none', `the armed knife stays raised (${JSON.stringify(armed)})`);
    await shot('armed');
    await page.evaluate(() => window.__game.game.input?.cancelTargeting?.());
    // Tab: the pack moves left and shows its mirrored render, lit from the same side
    const left = await page.evaluate(async () => {
      const hud = window.__game.game.hud;
      hud.knapsack.swapSide();
      const a = document.querySelector('.hud-knapsack > img.packart');
      await a.decode().catch(() => null);
      const r = document.querySelector('.hud-knapsack').getBoundingClientRect();
      const out = { icon: a.dataset.icon, ok: a.complete && a.naturalWidth > 0, x: r.left, items: document.querySelectorAll('.hud-knapsack .item').length };
      return out;
    });
    t(left.x < 200 && left.ok && left.items > 0, `Tab moves the pack left (${JSON.stringify(left)})`);
    const hasLeft = await page.evaluate(async () => !!(await import('./src/ui/icon-art.js')).iconEntry('kit/pack.left'));
    if (hasLeft) t.equal(left.icon, 'kit/pack.left', 'the left pack uses its mirrored render');
    await shot('left');
    const back = await page.evaluate(() => { const hud = window.__game.game.hud; hud.knapsack.swapSide(); return document.querySelector('.hud-knapsack > img.packart').dataset.icon; });
    t.equal(back, 'kit/pack', 'Tab again: back to the right-hand render');
    // occupant view: only his photo lies in the pack
    const occ = await page.evaluate(async () => {
      const g = window.__game, hud = g.game.hud, c = g.game.world.commandos[0];
      c.hidden = true; c.state = 'hidden';
      hud.knapsack.sig = '';
      hud.update(0.01);
      const img = document.querySelector('.hud-knapsack .occupant img');
      await img?.decode().catch(() => null);
      const o = { mode: hud.knapsack.view?.mode, items: document.querySelectorAll('.hud-knapsack .item').length, photo: !!img && img.complete && img.naturalWidth > 0,
        tip: document.querySelector('.hud-knapsack .occupant')?.dataset.tip || '' };
      return o;
    });
    t(occ.mode === 'occupant' && occ.items === 0 && occ.photo && /GET OUT/.test(occ.tip), `occupant view: his photo alone (${JSON.stringify(occ)})`);
    await shot('occupant');
    await page.evaluate(() => { const c = window.__game.game.world.commandos[0]; c.hidden = false; c.state = 'idle'; });
    t(!h.errors(page).length, `page clean (${h.errors(page).slice(0, 3).join(' | ')})`);
  } finally {
    await page.close();
  }
}
