/**
 * Touch / phone support for the menus and full-screen UI (in-mission finger gestures on the map live in
 * input/touch-game.js); adds the in-mission MENU and CANCEL buttons. Detects a touch-first device, keeps `html.mk-touch` in sync with the last pointer type, stops the
 * page itself from pinch / double-tap zooming or showing long-press callouts over the UI, and shows a dismissible
 * "rotate to landscape" hint on very narrow portrait screens (the game stays usable underneath).
 * @module ui/touch
 */

/** A phone / tablet whose primary pointer is a finger (no hover, coarse pointer). */
export function touchFirst(win = globalThis) {
  try {
    const mm = (q) => !!win.matchMedia?.(q).matches;
    if (mm('(hover: none) and (pointer: coarse)')) return true;
    return (win.navigator?.maxTouchPoints || 0) > 0 && !mm('(pointer: fine)');
  } catch {
    return false;
  }
}

/** Is the UI in touch mode right now (html.mk-touch, set by installTouch)? */
export function isTouchUI() {
  return typeof document !== 'undefined' && !!document.documentElement?.classList.contains('mk-touch');
}

/** Prompt wording for "continue" on the title splash. */
export function pressPrompt(touch) {
  return touch ? 'TAP TO CONTINUE' : 'PRESS ANY KEY OR CLICK';
}

/** Is this a very narrow portrait screen (a phone held upright)? */
export function narrowPortrait(w, h) {
  return h > w && w < 600;
}

const ROTATE_KEY = 'shadowsix.rotate.dismissed';

/**
 * Wire the document for touch. `hud.kit` gets device = 'touch' whenever a finger is used anywhere on the page.
 * @param {object} hud
 * @returns {{menu: HTMLElement, hint: HTMLElement, update: () => void, dispose: () => void}}
 */
export function installTouch(hud) {
  const doc = document, root = doc.documentElement;
  const offs = [];
  const on = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); offs.push(() => t.removeEventListener(type, fn, opt)); };
  const setTouch = (v) => {
    root.classList.toggle('mk-touch', v);
    if (v) hud.kit?._setDevice?.('touch');
  };
  if (touchFirst()) setTouch(true);
  on(window, 'pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') setTouch(true);
    else if (e.pointerType === 'mouse') root.classList.remove('mk-touch');
  }, { capture: true, passive: true });
  // iOS Safari ignores user-scalable=no: block its pinch gestures on the page (the game view does its own zoom)
  on(doc, 'gesturestart', (e) => e.preventDefault(), { passive: false });
  // two-finger pinch over the menus / HUD must not zoom the page
  on(doc, 'touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  // long-press callouts / the context menu over UI chrome (inputs keep theirs)
  on(doc, 'contextmenu', (e) => {
    if (root.classList.contains('mk-touch') && !/^(INPUT|TEXTAREA)$/.test(e.target?.tagName || '')) e.preventDefault();
  });
  // the rotate hint
  const hint = doc.createElement('div');
  hint.className = 'rot-hint';
  hint.hidden = true;
  hint.setAttribute('role', 'note');
  hint.innerHTML = '<div class="rot-box"><div class="rot-ico" aria-hidden="true"></div><p>SHADOW SIX plays best in <b>landscape</b>.</p>'
    + '<p class="sub">Turn your phone sideways.</p><button type="button" class="rot-ok">CONTINUE IN PORTRAIT</button></div>';
  (hud.root || doc.body).appendChild(hint);
  let dismissed = false;
  try { dismissed = sessionStorage.getItem(ROTATE_KEY) === '1'; } catch { /* private mode */ }
  const update = () => {
    hint.hidden = dismissed || !root.classList.contains('mk-touch') || !narrowPortrait(innerWidth, innerHeight);
  };
  const dismiss = (e) => {
    e?.stopPropagation();
    e?.preventDefault();
    dismissed = true;
    try { sessionStorage.setItem(ROTATE_KEY, '1'); } catch { /* private mode */ }
    update();
  };
  hint.addEventListener('click', dismiss);
  hint.addEventListener('pointerdown', (e) => e.stopPropagation());
  on(window, 'resize', update);
  on(window, 'orientationchange', update);
  on(window, 'pointerdown', () => setTimeout(update, 0), { capture: true, passive: true });
  update();
  // in a mission a finger has no Esc: a MENU button (top-right) opens the in-mission menu (pause / save / load / options)
  const menu = doc.createElement('button');
  menu.type = 'button';
  menu.className = 'touch-menu';
  menu.hidden = true;
  menu.setAttribute('aria-label', 'Menu');
  menu.innerHTML = '<i></i><i></i><i></i><span>MENU</span>';
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    if (hud.cursor?.mode) hud.cursor.setMode(null);
    hud.menus?.showEsc?.(); // exactly what Esc does in a mission
  });
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
  (hud.root || doc.body).appendChild(menu);
  // no right button on a phone: CANCEL puts the armed item / tool away, or cancels the men's context action
  // (drop the body, stand up from the snow, holster) — exactly a right-click (Input.rightClick)
  const cancel = doc.createElement('button');
  cancel.type = 'button';
  cancel.className = 'touch-cancel';
  cancel.hidden = true;
  cancel.setAttribute('aria-label', 'Cancel');
  cancel.innerHTML = '<b aria-hidden="true">\u2715</b><span>CANCEL</span>';
  cancel.addEventListener('click', (e) => {
    e.stopPropagation();
    if (hud.cursor?.mode) hud.cursor.setMode(null);
    else hud.game?.input?.rightClick?.();
  });
  cancel.addEventListener('pointerdown', (e) => e.stopPropagation());
  (hud.root || doc.body).appendChild(cancel);
  return {
    menu,
    cancel,
    hint,
    /** Per frame (HUD.update): the MENU button only while a mission is on screen with no card over it. */
    update() {
      const g = hud.game;
      const show = root.classList.contains('mk-touch') && !!g?.world && (g.state === 'playing' || g.state === 'paused')
        && !hud.kit?.active && !hud.briefing?.active && !hud.debrief?.active && !hud.boot?.active && !hud.loading?.active;
      if (menu.hidden === show) menu.hidden = !show;
      const inp = g?.input;
      const busy = show && !!inp && (!!inp.targeting || !!inp.mode || !!hud.cursor?.mode
        || inp.selection.some((c) => c.armed || c.carrying || c.buried));
      if (cancel.hidden === busy) cancel.hidden = !busy;
    },
    dispose() { offs.forEach((f) => f()); hint.remove(); menu.remove(); cancel.remove(); },
  };
}
