/**
 * Boot: WebGL check → Game → preload assets (loading screen) → title screen.
 * URL params: ?test=1 (manual ticking + window.__game), ?mission=<id> (skip title), ?preset=low|medium|high|ultra.
 * @module main
 */

import { Game, missionList } from './game.js';
import { assets } from './engine/assets.js';
import { installTestApi } from './debug/test-api.js';
import { hasQuickSave } from './save.js';

const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const $ = (id) => document.getElementById(id);

function webglOk() {
  // No probe context here: a throwaway context triggers CONTEXT_LOST warnings when collected.
  return typeof window.WebGL2RenderingContext === 'function';
}

function setLoading(p, text) {
  const fill = $('loading-fill');
  if (fill) fill.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
  if (text && $('loading-text')) $('loading-text').textContent = text;
}

function showScreen(id) {
  for (const el of document.querySelectorAll('#app > .screen')) el.hidden = el.id !== id;
}

function button(label, sub, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (sub) {
    const s = document.createElement('span');
    s.className = 'sub';
    s.textContent = sub;
    b.appendChild(s);
  }
  b.addEventListener('click', onClick);
  return b;
}

/** Minimal briefing overlay, used only when the HUD does not render its own (hud.showsBriefing). */
function fallbackBriefing(game, def) {
  let el = $('briefing-fallback');
  if (!el) {
    el = document.createElement('section');
    el.id = 'briefing-fallback';
    el.className = 'screen';
    $('app').appendChild(el);
  }
  el.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'title-box';
  const h = document.createElement('h2');
  h.className = 'brand';
  h.textContent = def.title || def.id;
  const p = document.createElement('p');
  p.className = 'tagline';
  p.textContent = def.briefing?.text || def.subtitle || '';
  const nav = document.createElement('nav');
  nav.className = 'title-menu';
  nav.appendChild(
    button('Begin mission', null, () => {
      el.hidden = true;
      game.start();
      game.renderer.domElement.focus();
    }),
  );
  box.append(h, p, nav);
  el.appendChild(box);
  el.hidden = false;
}

async function startMission(game, id) {
  showScreen('none');
  try {
    await game.loadMission(id);
  } catch (err) {
    console.error('[main] mission load failed', err);
    showScreen('title');
    return;
  }
  if (!game.hud?.showsBriefing) fallbackBriefing(game, game.missionDef);
}

function buildTitle(game) {
  const menu = $('title-menu');
  if (!menu) return;
  if (game.hud?.buildTitle?.(menu)) return; // UI owns the title menu (design-spec §6.8)
  menu.innerHTML = '';
  const list = missionList();
  const campaign = list.filter((m) => !/^m00/.test(m.id));
  if (campaign.length) menu.appendChild(button('New campaign', campaign[0].title, () => startMission(game, campaign[0].id)));
  if (hasQuickSave()) menu.appendChild(button('Continue', 'Load quicksave', async () => {
    showScreen('none');
    if (!(await game.quickLoad())) showScreen('title');
  }));
  for (const m of list) menu.appendChild(button(m.title || m.id, m.subtitle || m.id, () => startMission(game, m.id)));
}

async function boot() {
  if (!webglOk()) {
    setLoading(0, 'WebGL 2 is required.');
    return;
  }
  const game = new Game($('view'), {
    manualTick: TEST,
    preset: params.get('preset') || undefined,
    preserveDrawingBuffer: TEST,
    hudRoot: $('hud'),
  });
  window.shadowSix = game;
  if (TEST) installTestApi(game);

  // docs/menus-art-direction.md S01/S03: the HUD boot plays the disclaimer + ident while assets preload, then the
  // title splash's brass rule shows the rest of the preload and turns into PRESS ANY KEY.
  const boot = !TEST && !params.get('mission') ? game.hud?.boot : null;
  if (boot) {
    showScreen('none');
    boot.start();
  }
  const progress = (p, text) => {
    setLoading(p, text);
    boot?.progress(p);
  };
  progress(0.05, 'Loading assets…');
  try {
    await assets.preload(undefined, (n, total, ref) => progress(0.05 + 0.9 * (total ? n / total : 1), ref ? `Loading ${ref.split(':')[1]}…` : null));
  } catch (err) {
    console.warn('[main] asset preload incomplete', err);
  }
  progress(1, 'Ready');

  game.events.on('game:state', ({ to }) => {
    if (to === 'title') {
      buildTitle(game);
      showScreen('title');
    }
  });
  game.run();

  const mission = params.get('mission');
  if (TEST) {
    showScreen('none');
    window.__gameReady = true;
  } else if (mission) {
    await startMission(game, mission);
  } else if (boot) {
    buildTitle(game);
    boot.ready = true;
    if (boot.phase === 'splash') boot.setReady();
  } else {
    buildTitle(game);
    showScreen('title');
  }
  document.body.dataset.ready = '1';
}

boot().catch((err) => {
  console.error('[main] boot failed', err);
  setLoading(0, `Failed to start: ${err.message}`);
});
