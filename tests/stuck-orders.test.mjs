/**
 * "I'm in the tutorial and it feels commandos can get stuck and not respond anymore to my go-to-location commands (they
 * can stand and crawl but they don't go where I tell them to go)" — user. The real game on the tutorial map (m00), driven
 * through the real input: mouse clicks and keys on the page, the bag's pistol icon, and on an emulated phone real taps
 * (CDP touch events, src/input/touch-game.js). After the pistol (G) is fired and its cursor left — Esc, the bag icon
 * again, the knife (X) and a kill, another man picked — a click / tap on the ground walks him (on master the drawn
 * pistol outlived its cursor and every later move click was silently refused); a crawler lying with his head at the
 * compound sandbags crawls off (the step guard undid every turn); then a soak of real clicks for every commando in both
 * stances with the pistol and stance keys between. A click must move the man or be refused with the game's message.
 * The Node soak (tests/unit/stuck-orders.test.mjs) covers many more seeds and M1 / M2.
 */
import { openPhone } from './touch-game-flow.mjs';

export const timeout = 420_000;

/** In-page helpers (window.__S): placing men, screen points, stepping, the order / message log. */
async function install(page) {
  await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m00');
    g.start();
    const w = G.world;
    for (const e of w.enemies) if (e.brain) e.brain.update = () => {}; // (the Germans stand where they are)
    w.debug = { ...(w.debug || {}), invulnerable: true, noDetect: true }; // (the ?debug inspection flags)
    g.setZoom(1);
    const log = { msgs: [], orders: [] };
    G.events.on('message', (m) => log.msgs.push({ id: m.unit?.id ?? null, text: m.text }));
    G.events.on('unit:order', (e) => log.orders.push({ id: e.unit.id, type: e.order.type }));
    const man = (role) => w.commandos.find((c) => c.role === role);
    window.__S = {
      log, man,
      enemy: (tag) => w.enemies.find((e) => e.tag === tag),
      step(n) { for (let i = 0; i < n; i++) g.step(); },
      /** put `role` at (x, z) facing h in `stance`, settled; the camera on him */
      place(role, x, z, h, stance = 'stand') {
        const c = man(role);
        w.commandos.forEach((u, k) => { if (u !== c) u.setPosition(4 + 3 * k, 56, 0); });
        c.issue({ type: 'stop' });
        if (c.armed) c.armed = null;
        c.setPosition(x, z, h);
        if (c.stance !== stance) { c.setStance(stance); c._stanceT = 0; }
        this.step(6);
        c.setPosition(x, z, h);
        this.step(1);
        return this.focus(x, z);
      },
      focus(x, z) { g.centerOn(x, z); G.render(1 / 60, 1); return true; },
      scr(x, z, y = 0) { const p = G.cameraController.worldToScreen(x, y, z); return { x: p.x, y: p.y }; },
      at(role) { const c = man(role); return { x: c.x, z: c.z, stance: c.stance, armed: c.armed, path: !!c.path, sel: c.selected, id: c.id, alive: c.alive }; },
      state() { return { targeting: G.input.targeting?.abilityId || null, sel: G.input.selection.map((c) => c.role) }; },
      key(role) { return `Digit${window.__game.CONFIG.units.selectOrder.indexOf(role) + 1}`; }, // the select keys 1–6
    };
  });
}

const S = (page, fn, ...a) => page.evaluate(([f, args]) => window.__S[f](...args), [fn, a]);

/** A real left click (pointer events on the canvas) at client (x, y); the next click is past the double-click window. */
async function click(page, p) {
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(380);
}

/** Select `role` by a real click on him (camera on him first). */
async function pick(page, role) {
  const a = await S(page, 'at', role);
  await S(page, 'focus', a.x, a.z);
  const p = await S(page, 'scr', a.x, a.z, a.stance === 'crawl' ? 0.25 : 0.9);
  if (!(await S(page, 'state')).sel.includes(role) || (await S(page, 'state')).sel.length !== 1) await click(page, p);
  return (await S(page, 'state')).sel;
}

/**
 * Click the ground at (x, z) (camera centred there) with `role` selected; step up to `secs` s or until he stops.
 * @returns {{took: boolean, said: string[], moved: number, dEnd: number, end: object}}
 */
async function walk(page, role, x, z, secs = 8) {
  await pick(page, role);
  const a = await S(page, 'at', role);
  await S(page, 'focus', x, z);
  const n0 = await page.evaluate(() => [window.__S.log.orders.length, window.__S.log.msgs.length]);
  await click(page, await S(page, 'scr', x, z));
  return page.evaluate(([role, n0, a, secs]) => {
    const T = window.__S, c = T.man(role);
    T.step(1);
    const took = T.log.orders.slice(n0[0]).some((o) => o.id === c.id && o.type === 'move');
    const end = c.moveTarget ? { x: c.moveTarget.x, z: c.moveTarget.z } : null;
    let moved = 0;
    for (let k = 0; k < secs * 4 && c.path; k++) { T.step(15); moved = Math.max(moved, Math.hypot(c.x - a.x, c.z - a.z)); }
    const said = T.log.msgs.slice(n0[1]).filter((m) => m.id === c.id).map((m) => m.text);
    const dEnd = end ? Math.hypot(c.x - end.x, c.z - end.z) : NaN;
    if (c.path) c.issue({ type: 'stop' });
    return { took, said, moved: +moved.toFixed(2), dEnd: +dEnd.toFixed(2), end, now: { x: +c.x.toFixed(2), z: +c.z.toFixed(2) }, armed: c.armed };
  }, [role, n0, a, secs]);
}

/** G, then a real click on the enemy `tag`: a pistol shot (his HP restored after). @returns {boolean} drawn */
async function pistol(page, role, tag) {
  await pick(page, role);
  await page.keyboard.press('KeyG');
  const e = await page.evaluate((tag) => { const e = window.__S.enemy(tag); return { x: e.x, z: e.z }; }, tag);
  await S(page, 'focus', e.x, e.z);
  const p = await S(page, 'scr', e.x, e.z, 0.9);
  await click(page, p);
  const drawn = await page.evaluate(([role, tag]) => { const T = window.__S; T.step(60); const e = T.enemy(tag); e.hp = e.maxHp; return T.man(role).armed === 'pistol'; }, [role, tag]);
  if (!drawn) { await page.mouse.click(p.x, p.y, { button: 'right' }); await page.waitForTimeout(100); } // (out of reach: a right-click puts the cursor away)
  return drawn;
}

export default async function stuckOrders(page, t) {
  await install(page);
  const tag = 'patrol_west'; // (14, 27) on the west-bank road
  const E = await page.evaluate((tag) => { const e = window.__S.enemy(tag); return { x: e.x, z: e.z }; }, tag);

  // ---- 1. the pistol's cursor left every way a player leaves it: a click on the ground walks him
  for (const how of ['Escape', 'bag', 'otherMan', 'knife']) {
    await S(page, 'place', 'greenberet', E.x + 8, E.z + 2, Math.PI);
    t(await pistol(page, 'greenberet', tag), `${how}: G + a click on the German: the pistol is drawn and fired`);
    if (how === 'Escape') await page.keyboard.press('Escape');
    else if (how === 'bag') await page.click('.hud-knapsack [data-item="pistol"]');
    else if (how === 'otherMan') { // (a click on a man would fire at him: the select keys, as a player does)
      await page.keyboard.press(await S(page, 'key', 'sniper'));
      await page.keyboard.press(await S(page, 'key', 'greenberet'));
    }
    else {
      // X (the knife), a double click on the German: the Green Beret runs in and stabs him (on master: never walked again)
      await page.keyboard.press('KeyX');
      const p = await S(page, 'scr', E.x, E.z, 0.9);
      await page.mouse.click(p.x, p.y); await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(380);
      const dead = await page.evaluate((tag) => {
        const T = window.__S, e = T.enemy(tag), c = T.man('greenberet'), G = window.__game.game;
        const info = { targeting: G.input.targeting?.abilityId || null, pending: c.pendingAbility?.def?.id || null, act: c.currentActionId, e: [e.x, e.z, e.state, e.hp], c: [c.x, c.z] };
        for (let k = 0; k < 40 && e.alive; k++) T.step(30);
        T.step(90);
        return { dead: !e.alive, info, msgs: T.log.msgs.slice(-4) };
      }, tag);
      t(dead.dead, `knife: the German is down (${JSON.stringify(dead)})`);
    }
    t.equal((await S(page, 'state')).targeting, null, `${how}: no item cursor up`);
    const a = await S(page, 'at', 'greenberet');
    const r = await walk(page, 'greenberet', a.x + 2, a.z + 6);
    t(r.took && r.moved > 3 && r.dEnd < 1.2, `${how}: a click on the ground walks him there (${JSON.stringify(r)})`);
    t.equal(r.armed, null, `${how}: the pistol is holstered`);
  }

  // ---- 2. a crawler lying with his head at the compound sandbags (the step guard undid every turn toward the east)
  await S(page, 'place', 'sapper', 47.369, 24.099, 2.476, 'crawl');
  const sb = await walk(page, 'sapper', 50.47, 24.2, 12);
  t(sb.took && sb.dEnd < 1.2, `sandbags: the crawler turns off them and crawls east (${JSON.stringify(sb)})`);

  // ---- 3. soak: real clicks for every man, both stances (C / S keys), the pistol + Esc now and then
  let seed = 7;
  const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const bad = [], counts = {};
  const starts = { greenberet: [10, 46], sniper: [22, 44], sapper: [30, 20] };
  for (const role of ['greenberet', 'sniper', 'sapper']) {
    await S(page, 'place', role, ...starts[role], 0);
    for (let k = 0; k < 6; k++) {
      await pick(page, role);
      if (k === 2 || k === 4) await page.keyboard.press(k === 2 ? 'KeyC' : 'KeyS'); // (mid-animation: no wait)
      if (k === 3 && await pistol(page, role, tag)) await page.keyboard.press('Escape');
      const a = await S(page, 'at', role);
      const x = Math.min(58, Math.max(2, a.x + (R() - 0.5) * 16)), z = Math.min(58, Math.max(2, a.z + (R() - 0.5) * 16));
      const r = await walk(page, role, x, z, a.stance === 'crawl' ? 22 : 10);
      const kind = !r.took ? (r.said.length ? 'refused' : 'silent') : r.dEnd <= 1.2 ? 'arrived' : r.moved < 0.3 ? (r.said.length ? 'blocked' : 'stuck') : 'short';
      counts[kind] = (counts[kind] || 0) + 1;
      if (kind === 'silent' || kind === 'stuck') bad.push({ role, k, kind, stance: a.stance, from: [+a.x.toFixed(2), +a.z.toFixed(2)], to: [+x.toFixed(2), +z.toFixed(2)], ...r });
    }
  }
  t.log('soak', JSON.stringify(counts));
  t.equal(bad.length, 0, `no click ignored, no order taken with the man never moving (${JSON.stringify(counts)}): ${JSON.stringify(bad)}`);
  t((counts.arrived || 0) >= 12, `most clicks walked the man there (${JSON.stringify(counts)})`);

  // ---- 4. touch: an emulated phone, real taps — the pistol from the bag, a shot, the bag icon again, a tap on the ground
  const P = await openPhone(t, 'Pixel 7');
  try {
    const pg = P.page;
    await install(pg);
    await S(pg, 'place', 'greenberet', E.x + 8, E.z + 2, Math.PI);
    const tap = async (p) => { await pg.touchscreen.tap(p.x, p.y); await pg.waitForTimeout(420); };
    let a = await S(pg, 'at', 'greenberet');
    if (!(await S(pg, 'state')).sel.includes('greenberet')) await tap(await S(pg, 'scr', a.x, a.z, 0.9));
    t.equal((await S(pg, 'state')).sel.join(), 'greenberet', 'touch: a tap selects the Green Beret');
    await P.tapEl('.hud-knapsack [data-item="pistol"]');
    t.equal((await S(pg, 'state')).targeting, 'pistol', 'touch: the bag\'s pistol arms the cursor');
    await S(pg, 'focus', E.x, E.z);
    await tap(await S(pg, 'scr', E.x, E.z, 0.9));
    const drawn = await pg.evaluate(([tag]) => { const T = window.__S; T.step(60); const e = T.enemy(tag); e.hp = e.maxHp; return T.man('greenberet').armed; }, [tag]);
    t.equal(drawn, 'pistol', 'touch: a tap on the German fires');
    await P.tapEl('.hud-knapsack [data-item="pistol"]'); // the bag icon again: the cursor goes
    t.equal((await S(pg, 'state')).targeting, null, 'touch: the bag icon again puts the cursor away');
    a = await S(pg, 'at', 'greenberet');
    await S(pg, 'focus', a.x + 2, a.z + 6);
    const n0 = await pg.evaluate(() => window.__S.log.orders.length);
    await tap(await S(pg, 'scr', a.x + 2, a.z + 6));
    const r = await pg.evaluate(([n0, a]) => {
      const T = window.__S, c = T.man('greenberet');
      T.step(1);
      const took = T.log.orders.slice(n0).some((o) => o.id === c.id && o.type === 'move');
      for (let k = 0; k < 40 && c.path; k++) T.step(15);
      return { took, moved: +Math.hypot(c.x - a.x, c.z - a.z).toFixed(2), armed: c.armed };
    }, [n0, a]);
    t(r.took && r.moved > 3, `touch: a tap on the ground walks him (${JSON.stringify(r)})`);
    t(!P.errs.length, `touch: no page errors (${P.errs.slice(0, 3).join(' | ')})`);
  } finally {
    await P.ctx.close();
  }
}
