/**
 * Keyboard hotkey hints (docs/menus-art-direction.md contract item 4): walks every screen, dialog and overlay
 * (title, new user, main menu, new game, campaigns, mission select, password, options and its sub-pages, controls,
 * help, credits, load/save, quit confirmations, briefing, P pause card, in-game Esc menu, mission completed / failed /
 * not completed, debrief) and, for every VISIBLE `(X)` hint letter, presses X and asserts that something happens and
 * that it is the same thing a click on the hinted button does. Mission-ending / loading actions are stubbed to
 * record-only (in both paths) so each press is checked from the same screen.
 * Also: R resumes from the P pause card and from the in-game Esc menu (lower / upper case, CapsLock, both pause paths),
 * and keys a menu handles never reach the game (R is also the sniper rifle's key).
 */

/** In-page helpers (window.__hk). */
function installLib() {
  const G = () => window.__game.game;
  const STUBS = [['', 'startMission'], ['', 'restartMission'], ['', 'quickLoad'], ['', 'quitToTitle'], ['loading', 'quickLoad'],
    ['loading', 'startDirect'], ['loading', 'loadSlot'], ['debrief', '_copy'], ['boot', 'showSplash'], ['screens', 'continueCampaign']];
  const lib = {
    calls: [],
    actAt: -1e9,
    stub(on = true) {
      const hud = G().hud;
      for (const [o, m] of STUBS) {
        const obj = o ? hud[o] : hud;
        if (!obj) continue;
        if (on && !obj[`__hk_${m}`]) {
          obj[`__hk_${m}`] = obj[m];
          obj[m] = () => {
            // only calls the action under test made (a timer from an earlier press, e.g. QUIT's 1.8 s splash, is not)
            if (performance.now() - lib.actAt < 1000) lib.calls.push(`${o || 'hud'}.${m}`);
            return Promise.resolve(false);
          };
        } else if (!on && obj[`__hk_${m}`]) {
          obj[m] = obj[`__hk_${m}`];
          delete obj[`__hk_${m}`];
        }
      }
    },
    /** Every visible `(X)` hint: {letter, text, clickable}. */
    hints() {
      const out = [];
      for (const h of document.querySelectorAll('.mk-hk')) {
        if (!h.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        if (h.closest('.leaving, [hidden]')) continue;
        const owner = h.closest('button, [role="button"]');
        out.push({ letter: h.textContent.trim().toUpperCase(), text: (owner || h.parentElement).textContent.trim(), clickable: !!owner });
      }
      return out;
    },
    click(text, letter) {
      const h = [...document.querySelectorAll('.mk-hk')].find((x) => x.checkVisibility() && !x.closest('.leaving, [hidden]')
        && x.textContent.trim().toUpperCase() === letter && x.closest('button, [role="button"]')?.textContent.trim() === text);
      if (!h) return false;
      h.closest('button, [role="button"]').click();
      return true;
    },
    /** What the player can observe (plus the stubbed calls). */
    snap() {
      const g = G(), hud = g.hud, kit = hud.kit, top = kit.active ? kit.top : null;
      const card = document.querySelector('.mk-host .mk-card:not(.leaving)');
      return JSON.stringify({
        state: g.state,
        card: top ? `${top.spec.id || ''}|${top.spec.title || ''}` : null,
        depth: kit.active ? kit.stack.length : 0,
        note: (kit.active && card?.querySelector('.mk-note')?.textContent) || '',
        debrief: hud.debrief.active ? hud.debrief.stage : null,
        briefing: hud.briefing.active ? hud.briefing.part : 0,
        pauseCard: !hud.menus.pauseCard.hidden,
        targeting: g.input?.targeting ? String(g.input.targeting.id || g.input.targeting.ability?.id || 'armed') : null,
        selection: (g.input?.selection || []).map((c) => c.id ?? c.name).join(','),
        calls: lib.calls.slice(),
      });
    },
    /** Back to a neutral state: no card, no overlay, mission (if any) running. */
    reset() {
      const g = G(), hud = g.hud;
      lib.calls.length = 0;
      hud.kit._cancelHold?.();
      if (hud.debrief.active) hud.debrief.close();
      if (hud.kit.active) hud.kit.close();
      hud.menus.view = null;
      hud.menus._pausedByMenu = false;
      if (hud.world) {
        hud.backdrop?.setMode('off');
        if (g.state === 'paused') g.pause(false);
        if (g.state === 'won' || g.state === 'lost') g._setState('playing');
        g.input?.cancelTargeting?.();
      }
      hud.menus.sync();
    },
  };
  // timers an action schedules (QUIT's 1.8 s return to the splash…) must fire before the next screen is opened
  lib.pending = new Set();
  const st = window.setTimeout.bind(window), ct = window.clearTimeout.bind(window);
  window.setTimeout = (fn, ms, ...a) => {
    const track = performance.now() - lib.actAt < 1000;
    const id = st((...x) => { lib.pending.delete(id); if (typeof fn === 'function') fn(...x); }, ms, ...a);
    if (track) lib.pending.add(id);
    return id;
  };
  window.clearTimeout = (id) => { lib.pending.delete(id); ct(id); };
  window.__hk = lib;
}

/** Let the deferred effects of the last action play out (bounded). */
const drain = (page) => page.waitForFunction(() => window.__hk.pending.size === 0, null, { timeout: 4000 }).catch(() => {});

const press = (page, code, extra = {}) => page.evaluate(([c, x]) => {
  const k = c === 'Escape' ? 'Escape' : c === 'Enter' ? 'Enter' : c.startsWith('Arrow') ? c : c.replace(/^(Key|Digit)/, '');
  const key = x.shiftKey || x.caps ? k.toUpperCase() : k.toLowerCase();
  const init = { code: c, key: c.length > 4 && !/^(Key|Digit)/.test(c) ? c : key, bubbles: true, cancelable: true, ...x };
  const ev = new KeyboardEvent('keydown', init);
  if (x.caps) Object.defineProperty(ev, 'getModifierState', { value: (m) => m === 'CapsLock' });
  document.body.dispatchEvent(ev);
  document.body.dispatchEvent(new KeyboardEvent('keyup', init));
  window.__game.render();
}, [code, extra]);

const settle = (page, ms = 250) => page.waitForTimeout(ms);
const codeOf = (k) => (/[0-9]/.test(k) ? `Digit${k}` : `Key${k}`);

const HUD = 'window.__game.game.hud';
const OPT = "await import('./src/ui/options-panel.js')";
/** Activate the visible row whose label matches `re` on the top card (how a click / Enter opens a sub-page). */
const row = (re) => `${HUD}.kit.activate(${HUD}.kit.top.rows.findIndex((r) => ${re}.test(r.label || '')))`;

/** Front-end screens: [name, setup JS (async body), teardown JS?]. */
const FRONT = [
  ['title', `${HUD}.boot.__hk_showSplash.call(${HUD}.boot, { ready: true })`, `${HUD}.boot.hide()`],
  ['new user', `${HUD}.screens.enterName({ title: 'NEW USER' })`],
  ['main menu + LAST OPERATION', `const p = ${HUD}.profiles; if (!p.current) p.create('HOTKEY'); p.setLast({ missionId: 'm01', title: 'Baptism of Fire', n: 1 }); ${HUD}.screens.openMain()`],
  ['new game', `${HUD}.screens.openMain(); ${HUD}.screens.openNewGame()`],
  ['campaigns', `${HUD}.screens.openMain(); ${HUD}.screens.openCampaigns()`],
  ['behind enemy lines', `${HUD}.screens.openMain(); ${HUD}.screens.openBEL()`],
  ['start campaign confirm', `${HUD}.screens.openMain(); ${HUD}.screens.openBEL(); ${row('/START CAMPAIGN/')}`],
  ['mission select', `${HUD}.screens.openMain(); ${HUD}.screens.openBEL(); ${row('/MISSION SELECT/')}`],
  ['tutorials', `${HUD}.screens.openMain(); ${HUD}.screens.openTutorials()`],
  ['password', `${HUD}.screens.openMain(); ${HUD}.screens.openPassword()`],
  ['options', `${HUD}.screens.openMain(); ${HUD}.menus.showOptions()`],
  ['user profile', `${HUD}.screens.openMain(); ${HUD}.menus.showOptions(); ${row('/USER PROFILE/')}`],
  ...['SOUND', 'VIDEO OPTIONS', 'GAME PREFERENCES', 'ACCESSIBILITY'].flatMap((g) => [
    [`options / ${g}`, `${HUD}.screens.openMain(); ${HUD}.menus.showOptions(); (${OPT}).openGroup(${HUD}, '${g}')`],
    [`options / ${g} / reset confirm`, `${HUD}.screens.openMain(); ${HUD}.menus.showOptions(); (${OPT}).openGroup(${HUD}, '${g}'); ${row('/ESET TO DEFAULTS/')}`],
  ]),
  ['controls', `${HUD}.screens.openMain(); ${HUD}.menus.showOptions(); (${OPT}).openControls(${HUD})`],
  ['help', `${HUD}.screens.openMain(); ${HUD}.menus.showHelp()`],
  ['credits', `${HUD}.screens.openMain(); ${HUD}.screens.showCredits()`],
  ['load game', `${HUD}.screens.openMain(); ${HUD}.menus.showSlots('load')`],
  ['quit game confirm', `${HUD}.screens.openMain(); ${HUD}.screens.quit()`],
];

/** In-mission screens (m00 loaded and playing before each setup). */
const MISSION = [
  ['P pause card', 'window.__game.game.togglePause()'],
  ['in-game Esc menu', `${HUD}.menus.showEsc()`],
  ['Esc menu / new game', `${HUD}.menus.showEsc(); ${HUD}.screens.openNewGame()`],
  ['restart mission confirm', `${HUD}.menus.showEsc(); ${HUD}.screens.openNewGame(); ${row('/RESTART MISSION/')}`],
  ['Esc menu / options', `${HUD}.menus.showEsc(); ${HUD}.menus.showOptions()`],
  ['Esc menu / options / GAME PREFERENCES', `${HUD}.menus.showEsc(); ${HUD}.menus.showOptions(); (${OPT}).openGroup(${HUD}, 'GAME PREFERENCES')`],
  ['save game', `${HUD}.menus.showEsc(); ${HUD}.menus.showSlots('save')`],
  ['load game (mission)', `${HUD}.menus.showEsc(); ${HUD}.menus.showSlots('load')`],
  ['quit mission confirm', `${HUD}.menus.showEsc(); ${HUD}.screens.quit()`],
  ['mission completed card', `${HUD}.debrief.won({ password: 'ABCDE' })`],
  ['mission failed', `${HUD}.debrief.lost({ reason: 'all commandos dead' })`],
  ['mission failed + quick save', `${HUD}.game.quickSave?.(); ${HUD}.debrief.lost({ reason: 'all commandos dead' })`],
  ['mission not completed', `${HUD}.debrief.escapedEarly(() => {})`],
  ['debrief', `${HUD}.debrief.won({ password: 'ABCDE', merit: 1 }); ${HUD}.debrief.debrief(); ${HUD}.debrief._finish?.()`],
];

/** Open a screen from a neutral state (mission-starting / loading actions stay stubbed). */
async function open(page, setup) {
  await page.evaluate(() => { window.__hk.reset(); window.__hk.stub(true); });
  await page.evaluate(`(async () => { ${setup}; })()`);
  await page.evaluate(() => { window.__hk.calls.length = 0; window.__hk.actAt = -1e9; window.__game.render(); });
  await settle(page, 300);
}

/** Every visible (X) hint of one screen: the key does something, and the same thing as a click on the hint. */
async function checkScreen(page, t, name, setup, teardown) {
  await open(page, setup);
  const hints = await page.evaluate(() => window.__hk.hints());
  t.log(`${name}: ${hints.map((h) => `(${h.letter}) ${h.text}`).join(' · ') || 'no (X) hints'}`);
  const seen = new Set();
  for (const h of hints) {
    t.soft(!seen.has(h.letter), `${name}: two visible hints share (${h.letter})`);
    seen.add(h.letter);
    await open(page, setup);
    const before = await page.evaluate(() => window.__hk.snap());
    await page.evaluate(() => { window.__hk.actAt = performance.now(); });
    await press(page, codeOf(h.letter));
    await settle(page);
    const byKey = await page.evaluate(() => window.__hk.snap());
    await drain(page);
    t.soft(byKey !== before, `${name}: (${h.letter}) "${h.text}" does nothing`);
    if (!h.clickable) continue;
    await open(page, setup);
    if (!(await page.evaluate(([x, l]) => { window.__hk.actAt = performance.now(); return window.__hk.click(x, l); }, [h.text, h.letter]))) { t.soft(false, `${name}: hint "${h.text}" not found again`); continue; }
    await settle(page);
    const byClick = await page.evaluate(() => window.__hk.snap());
    await drain(page);
    t.soft(byKey === byClick, `${name}: (${h.letter}) differs from a click on "${h.text}": key ${byKey} / click ${byClick}`);
  }
  if (teardown) await page.evaluate(`(async () => { ${teardown}; })()`);
  return hints.length;
}

/** Load m00 for real and get to 'playing' through the briefing (Esc, Esc). */
async function toMission(page, t) {
  await page.evaluate(() => { window.__hk.reset(); window.__hk.stub(false); });
  await page.evaluate(async () => { await window.__game.game.hud.startMission('m00'); window.__game.render(); });
  t.equal(await page.evaluate(() => window.__game.game.state), 'briefing', 'm00 briefing');
}

const state = (page) => page.evaluate(() => window.__game.game.state);

/** R = (R)ESUME on both pause paths, every way R can arrive; never also the sniper rifle's R. */
async function resumeKeys(page, t) {
  // select the Sniper's role if m00 has one, so an R leaking through would arm the rifle
  await page.evaluate(() => {
    window.__hk.reset();
    window.__hk.stub(false);
    const g = window.__game.game, inp = g.input;
    const c = g.world.commandos.find((x) => x.alive && inp.abilitiesForCode?.('KeyR')?.length !== undefined && x.role === 'sniper') || g.world.commandos.find((x) => x.alive);
    inp.selectUnit(c);
  });
  const variants = [['r', {}], ['R (Shift)', { shiftKey: true }], ['R (CapsLock)', { caps: true }]];
  for (const [label, extra] of variants) {
    // P pause card
    await page.evaluate(() => window.__hk.reset());
    await press(page, 'KeyP');
    t.equal(await state(page), 'paused', `P pauses (${label})`);
    t(await page.evaluate(() => /\(R\)ESUME/.test(document.querySelector('.ui-paused .hint').textContent)), 'the pause card shows (R)ESUME');
    await press(page, 'KeyR', extra);
    t.equal(await state(page), 'playing', `${label} resumes from the P pause card`);
    t.equal(await page.evaluate(() => window.__game.game.input.targeting), null, `${label} on the pause card does not also arm an R ability`);
    // P, then Esc over the pause; Esc on its own
    for (const path of ['P then Esc', 'Esc']) {
      await page.evaluate(() => window.__hk.reset());
      if (path === 'P then Esc') await press(page, 'KeyP');
      await press(page, 'Escape');
      await settle(page, 250);
      const m = await page.evaluate(() => ({ s: window.__game.game.state, card: window.__game.game.hud.kit.top?.spec.id, hint: document.querySelector('.mk-host .mk-card:not(.leaving) .mk-hints')?.textContent || '' }));
      t(m.s === 'paused' && m.card === 'main', `${path} opens the in-game MAIN card (${JSON.stringify(m)})`);
      t(/\(R\)ESUME/.test(m.hint), `the in-game MAIN card hints (R)ESUME (${m.hint})`);
      await press(page, 'KeyR', extra);
      await settle(page, 250);
      const r = await page.evaluate(() => ({ s: window.__game.game.state, open: window.__game.game.hud.kit.active, card: !window.__game.game.hud.menus.pauseCard.hidden, tg: window.__game.game.input.targeting }));
      t(r.s === 'playing' && !r.open && !r.card, `${label} resumes from the Esc menu (${path}): ${JSON.stringify(r)}`);
      t.equal(r.tg, null, `${label} in the Esc menu does not also arm an R ability`);
    }
  }
  // held key: auto-repeat R must not resume then re-trigger anything
  await page.evaluate(() => window.__hk.reset());
  await press(page, 'KeyP');
  await press(page, 'KeyR', { repeat: true });
  t.equal(await state(page), 'paused', 'an auto-repeated R (held from play) does not resume');
  await press(page, 'KeyR');
  t.equal(await state(page), 'playing', 'a fresh R resumes');
}

/** Keys on an end-of-mission overlay belong to the overlay: an unbound key never reaches the game. */
async function overlaysSwallow(page, t) {
  for (const [name, setup] of MISSION.filter(([n]) => /mission (failed|not completed)/.test(n))) {
    await open(page, setup);
    const before = await page.evaluate(() => window.__hk.snap());
    for (const code of ['Digit2', 'Digit8', 'KeyR', 'KeyC', 'KeyS']) await press(page, code === 'KeyC' && /not completed/.test(name) ? 'KeyS' : code);
    await settle(page, 200);
    const after = await page.evaluate(() => window.__hk.snap());
    t.soft(after === before, `${name}: unbound keys reach the game: ${before} -> ${after}`);
  }
}

export const timeout = 240_000; // ~30 screens, each hint opened twice (key, click)

export default async function uiHotkeys(page, t) {
  const soft = [];
  t.soft = (cond, msg) => { if (!cond) soft.push(msg); };
  await page.evaluate(installLib);
  await page.evaluate(() => window.__hk.stub(true));
  let n = 0;
  for (const [name, setup, teardown] of FRONT) n += await checkScreen(page, t, name, setup, teardown);
  await settle(page, 2000); // QUIT GAME's (Y)ES returns to the (stubbed) splash after 1.8 s: let that timer pass first
  await toMission(page, t);
  t.equal(JSON.stringify(await page.evaluate(() => window.__hk.hints())), '[]', 'briefing part 1 has no (X) hints');
  await press(page, 'Escape');
  t.equal(JSON.stringify(await page.evaluate(() => window.__hk.hints())), '[]', 'briefing part 2 has no (X) hints');
  await press(page, 'Escape');
  t.equal(await state(page), 'playing', 'the briefing starts the mission');
  for (const [name, setup] of MISSION) n += await checkScreen(page, t, name, setup);
  t.log(`${n} visible (X) hints checked`);
  t(n >= 20, `at least 20 hints walked (${n})`);
  await resumeKeys(page, t);
  await overlaysSwallow(page, t);
  await page.evaluate(() => { window.__hk.reset(); window.__hk.stub(false); });
  t(!soft.length, `dead / mismatched hotkeys:\n  ${soft.join('\n  ')}`);
}
