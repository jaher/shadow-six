/**
 * OPTIONS (docs/menus-art-direction.md S10 + amendment B6): BEL's top level — USER PROFILE NAME, SOUND VOLUME (the red
 * master slider), VIDEO OPTIONS, GAME PREFERENCES (the original three first: SUBMISSIVE / INDIFFERENT, VERBOSE /
 * LACONIC, COMMANDOS WARNING) — plus CONTROLS (key rebinding with conflict swap) and ACCESSIBILITY. Every sub-card has
 * the detail pane (typed description + DEFAULT), a brass dot on changed values and (R)ESET TO DEFAULTS; display
 * changes ask "KEEP THESE SETTINGS? 10…". Writes `hud.options` through `hud.setOption` (persisted in localStorage).
 * @module ui/options-panel
 */

import { KEY_BINDINGS, SHIFT_BINDINGS } from '../engine/input.js';
import { el } from './dom.js';
import { cap, keyName } from './menu-kit.js';
import { OPTION_DEFAULTS } from './ui-config.js';
import { CONFIG } from '../config.js';
import { clearCachedGameData } from '../engine/offline-cache.js';

/** bodies-design §D.3: the house-rule toggles a RULES preset sets. */
export const HOUSE_KEYS = ['dragBodies', 'buddyRescue', 'dropWhenShot', 'ragdollAllDeaths', 'physicsGameplay', 'runningNoise'];

/** The preset whose flags equal these options, else 'custom'. */
export function matchingPreset(o) {
  for (const [name, flags] of Object.entries(CONFIG.houseRules.presets)) if (HOUSE_KEYS.every((k) => o[k] === flags[k])) return name;
  return 'custom';
}

const PCT = (v) => String(Math.round(v * 100));
const ON = [true, false];

/** [key, label, kind, choices?] grouped by sub-card ('h' rows open a group). kind: 'vol' | 'bool' | 'pct' | [values] */
export const OPTION_ROWS = [
  ['h', 'SOUND'],
  ['volMaster', 'MASTER', 'vol'],
  ['volMusic', 'MUSIC', 'vol'],
  ['missionMusic', 'MISSION MUSIC', ['suspense', 'classic']],
  ['volSfx', 'EFFECTS', 'vol'],
  ['volVoice', 'VOICES', 'vol'],
  ['narration', 'NARRATION', 'bool'],
  ['volNarration', 'NARRATION VOLUME', 'vol'],
  ['nature', 'NATURE SOUNDS', 'bool'],
  ['volAmbience', 'AMBIENCE', 'vol'],
  ['subtitles', 'SUBTITLES', 'bool'],
  ['subSize', 'SUBTITLE SIZE', ['S', 'M', 'L']],
  ['subBand', 'SUBTITLE BACKGROUND', 'pct'],
  ['h', 'VIDEO OPTIONS'],
  ['preset', 'QUALITY', ['low', 'medium', 'high', 'ultra']],
  ['resScale', 'RESOLUTION SCALE', [0.5, 0.6, 0.7, 0.8, 0.9, 1]],
  ['uiScale', 'UI SCALE', [0, 1, 1.5, 2, 2.5, 3]],
  ['menuBg', 'MENU BACKGROUND', ['live', 'still']],
  ['grain', 'FILM GRAIN', 'bool'],
  ['brightness', 'BRIGHTNESS', 'pct'],
  ['fullscreen', 'FULL SCREEN', 'bool'],
  ['intro', 'INTRO', ['first', 'always', 'never']],
  ['h', 'GAME PREFERENCES'],
  ['halt', 'COMMANDOS', ['submissive', 'indifferent']],
  ['voice', 'COMMANDOS', ['verbose', 'laconic']],
  ['warnings', 'COMMANDOS WARNING', 'bool'],
  ['rule'],
  ['blood', 'BLOOD', 'bool'],
  ['censored', 'CENSORED MODE', 'bool'],
  ['insignia', 'INSIGNIA', ['historical', 'neutral']],
  ['activePause', 'ACTIVE PAUSE', 'bool'],
  ['coneAlertTint', 'CONE ALERT TINT', 'bool'],
  ['selectionRing', 'SELECTION RING', 'bool'],
  ['noiseRings', 'NOISE RINGS', 'bool'],
  ['edgeScroll', 'EDGE SCROLL', 'bool'],
  ['wheelZoom', 'WHEEL ZOOM', 'bool'],
  ['cameraAngle', 'CAMERA ANGLE', [0, 15, 45]],
  ['saveReminder', 'SAVE REMINDER', 'bool'],
  ['rule'],
  ['rulesPreset', 'RULES', ['shadowSix', 'classic1998', 'custom']],
  ['dragBodies', 'DRAG BODIES (ALL COMMANDOS)', 'bool'],
  ['buddyRescue', 'BUDDY RESCUE', 'bool'],
  ['dropWhenShot', 'DROP BODIES WHEN HIT', 'bool'],
  ['ragdollAllDeaths', 'BODIES SETTLE WITH PHYSICS', 'bool'],
  ['physicsGameplay', 'PHYSICS MOVES BODIES AND COVER', 'bool'],
  ['runningNoise', 'RUNNING IS HEARD', 'bool'],
  ['h', 'CONTROLS'],
  ['bindings', 'KEYBOARD', 'bindings'],
  ['h', 'ACCESSIBILITY'],
  ['textScale', 'TEXT SIZE', [0.9, 1, 1.1, 1.25, 1.5]],
  ['reducedMotion', 'REDUCED MOTION', ['system', 'on', 'off']],
  ['highContrast', 'HIGH CONTRAST', 'bool'],
  ['grain', 'FILM GRAIN AND VIGNETTE', 'bool'],
  ['subtitles', 'SUBTITLES', 'bool'],
  ['holdConfirm', 'HOLD TO CONFIRM', 'bool'],
  ['menuBg', 'MENU BACKGROUND', ['live', 'still']],
];

/** One-line helpers (item-sub) and the detail pane's typed description. */
export const OPTION_HELP = {
  volMaster: 'Every sound in the game.', volMusic: 'Orchestral score and stingers.',
  missionMusic: 'SUSPENSE: a quiet orchestral score under every mission that rises when the alarm sounds. CLASSIC 1998: no music during missions, only the start and end stingers.', volSfx: 'Weapons, engines, footsteps and alarms.',
  volVoice: 'Your men and the enemy.', narration: 'A 1940s newsreel announcer reads the briefing before each mission; the words appear as he reads them. N switches it in the briefing.', volNarration: 'The briefing announcer.', nature: 'Wind, surf, birds and crickets under the action.', volAmbience: 'Volume of the wind, water, birds and distant guns.', subtitles: 'Show what is said, with the speaker\'s name.',
  subSize: 'Size of the subtitle text.', subBand: 'Darkness of the band behind subtitles.',
  preset: 'Shadows, water, grass and post-processing. Lower it on older hardware.', resScale: 'Render at a fraction of the screen resolution for speed.',
  uiScale: 'Size of the in-mission interface. AUTO follows the window height.', menuBg: 'LIVE shows the moving diorama behind the menus; STILL a painted frame.',
  grain: 'The film grain and vignette over menus and briefings.', brightness: 'Raise until the calibration emblem is barely visible.',
  fullscreen: 'Use the whole screen.', intro: 'When to play the opening ident and newsreel.',
  halt: 'SUBMISSIVE: a man held at gunpoint stops obeying you. INDIFFERENT: he still obeys your orders.',
  voice: 'VERBOSE: your men acknowledge every order. LACONIC: only the lines that matter.',
  warnings: 'Your men call out when they are spotted.', blood: 'Blood effects on wounds and bodies.', censored: 'Replaces gore and harsh language.',
  insignia: 'HISTORICAL: enemy flagpoles fly the German national flag of 1935–45, as in the war. NEUTRAL: a field-grey banner with a cross. Vehicle crosses are the same in both.',
  activePause: 'Give orders while the game is paused. Off is faithful to 1998.', coneAlertTint: 'Vision cones tint as a guard grows suspicious.',
  selectionRing: 'A ring under each selected man.', noiseRings: 'A faint ring spreads from a running commando\'s feet to show how far the guards hear his steps (RUNNING IS HEARD rule).', edgeScroll: 'Scroll the map when the mouse touches the screen edge.',
  wheelZoom: 'Zoom with the mouse wheel.',
  cameraAngle: 'CLASSIC looks straight up the map as in 1998. TILTED turns the view slightly so buildings show a side. ISOMETRIC turns it to a diagonal.', saveReminder: 'A gentle reminder when you have not saved for a while.',
  rulesPreset: 'SHADOW SIX: any commando can drag a body, a man at 0 health is downed and can be rescued, a carrier drops his load when hit, guards hear a man running near them. CLASSIC 1998: exactly the 1998 rules — only the Green Beret and the Spy move bodies, any death fails the mission, and movement is silent. Applies from the next mission start or load.',
  dragBodies: 'Any commando can drag a body, slowly and walking backwards. Not in the 1998 original.',
  buddyRescue: 'A commando at 0 health is downed for 60 s instead of dying. Drag or carry him to safety and revive him with the first aid kit. Not in the 1998 original.',
  dropWhenShot: 'A man carrying or dragging a body drops it when he is hit. Not in the 1998 original.',
  ragdollAllDeaths: 'Every death ends in a short physical settle on the ground.',
  physicsGameplay: 'Where a thrown body comes to rest and where a toppled crate lands count for the guards, paths and cover. Off: bodies and cover stay where they were, as in 1998. Not in the 1998 original.',
  runningNoise: 'Guards hear a commando running nearby, louder on roads, decks and floors, quieter on grass, sand and mud. Walking and crawling stay silent. Not in the 1998 original.',
  bindings: 'Rebind the keyboard controls.', textScale: 'Size of all menu text.', reducedMotion: 'Replace slides, page turns and camera moves with fades.',
  highContrast: 'Brighter idle items, darker backgrounds, no grain, outlined focus.', holdConfirm: 'Hold (Y)ES to confirm quitting, overwriting or deleting.',
};

const DISPLAY = new Set(['fullscreen', 'resScale']);

export function formatOption(key, v) {
  if (typeof v === 'boolean') return v ? 'ON' : 'OFF';
  if (key === 'uiScale') return v ? `${v}×` : 'AUTO';
  if (key === 'resScale' || key === 'textScale' || key === 'subBand' || key === 'brightness') return `${Math.round(v * 100)}%`;
  if (key === 'cameraAngle') return `${{ 0: 'CLASSIC', 15: 'TILTED', 45: 'ISOMETRIC' }[v] || 'CUSTOM'} ${v}°`;
  if (key === 'missionMusic') return v === 'classic' ? 'CLASSIC 1998 (NONE)' : 'SUSPENSE';
  if (key === 'intro') return v === 'first' ? 'FIRST RUN' : String(v).toUpperCase();
  if (key === 'rulesPreset') return CONFIG.houseRules.labels[v] || String(v).toUpperCase();
  return String(v).toUpperCase();
}

/** Build the kit row for option `key`. */
function optionRow(hud, key, label, kind) {
  const o = hud.options;
  const def = OPTION_DEFAULTS[key];
  const base = { id: key, label, sub: OPTION_HELP[key], def, help: OPTION_HELP[key] };
  if (kind === 'vol' || kind === 'pct') {
    const sample = { volSfx: () => hud.game.audio?.playSfx?.('pistol_shot'), volVoice: () => hud.game.audio?.playSfx?.('dog_bark'), volMusic: () => hud.sound.play('bell'), volMaster: () => hud.sound.play('select'),
      volAmbience: () => hud.game.audio?.playSfx?.('wind_gust', null, { gain: 5, dedupe: 0.5 }) }[key]; // a gust, raised to footstep level
    return { ...base, kind: 'slider', min: 0, max: key === 'subBand' ? 0.8 : 1, get: () => o[key], set: (v) => hud.setOption(key, v, { quiet: true }), sample, format: PCT };
  }
  const choices = kind === 'bool' ? ON : kind;
  if (key === 'halt' || key === 'voice') { // BEL's wording: the value is the row ("SUBMISSIVE COMMANDOS")
    base.labelFn = () => `${formatOption(key, o[key])} COMMANDOS`;
    base.label = base.labelFn();
    base.defFormat = (v) => formatOption(key, v);
    base.valueless = true;
  }
  return {
    ...base, kind: 'toggle', choices, get: () => o[key], format: (v) => (base.valueless ? '' : formatOption(key, v)),
    set: (v) => (DISPLAY.has(key) ? keepSettings(hud, key, v) : key === 'rulesPreset' || HOUSE_KEYS.includes(key) ? setRule(hud, key, v) : hud.setOption(key, v, { quiet: true })),
  };
}

/** §D.3: a preset sets its four toggles; a toggle that departs from every preset makes the preset CUSTOM. */
function setRule(hud, key, v) {
  if (key === 'rulesPreset') {
    hud.setOption('rulesPreset', v, { quiet: true });
    const flags = CONFIG.houseRules.presets[v];
    if (flags) for (const k of HOUSE_KEYS) hud.setOption(k, flags[k], { quiet: true });
  } else {
    hud.setOption(key, v, { quiet: true });
    hud.setOption('rulesPreset', matchingPreset(hud.options), { quiet: true });
  }
  hud.kit?.refresh?.();
}

/** Rows of the sub-card `group`. */
export function groupRows(group) {
  const out = [];
  let g = null;
  for (const r of OPTION_ROWS) {
    if (r[0] === 'h') g = r[1];
    else if (g === group) out.push(r);
  }
  return out;
}

function detail(r, pane) {
  if (!r.help && r.def === undefined) return false;
  el('div', 'desc', pane, r.help || '');
  if (r.id === 'brightness') pane.insertAdjacentHTML('beforeend', '<img class="mk-calib" src="assets/ui/emblem.svg" alt="">');
  if (r.def !== undefined && r.kind === 'toggle') el('div', 'def', pane, `DEFAULT: ${(r.defFormat || r.format)(r.def)}`);
  if (r.def !== undefined && r.kind === 'slider') el('div', 'def', pane, `DEFAULT: ${PCT(r.def)}`);
  return true;
}

/** A sub-card (SOUND / VIDEO OPTIONS / GAME PREFERENCES / ACCESSIBILITY). */
export function openGroup(hud, group) {
  const kit = hud.kit;
  const rows = groupRows(group).map(([k, l, kind]) => (k === 'rule' ? { kind: 'rule' } : optionRow(hud, k, l, kind)));
  rows.push({ kind: 'rule' }, { label: '(R)ESET TO DEFAULTS', onSelect: () => resetGroup(hud, group) }, { label: 'EXIT', onSelect: () => kit.pop() });
  kit.open({
    id: `opt-${group}`, title: group, bg: hud.world ? 'mission' : 'frontend', className: 'mk-options mk-optsub', rows, detail, colw: 420,
    hints: [['Enter', 'SELECT'], ['ArrowLeft', 'CHANGE', (k) => k.key({ code: 'ArrowRight', synthetic: true })], ['Escape', 'BACK']],
  });
}

async function resetGroup(hud, group) {
  const ok = await hud.kit.confirm({ id: 'reset', title: 'RESET', lines: [`RESET ${group} TO DEFAULTS?`] });
  if (!ok) return;
  for (const [k] of groupRows(group)) if (k !== 'fullscreen' && k !== 'rule') hud.setOption(k, OPTION_DEFAULTS[k], { quiet: true });
  hud.kit.refresh();
}

/** Display changes: apply, then "KEEP THESE SETTINGS? 10…" with an automatic revert (B6). */
async function keepSettings(hud, key, v) {
  const old = hud.options[key];
  hud.setOption(key, v, { quiet: true });
  const kit = hud.kit;
  let n = 10, timer = 0;
  const p = kit.confirm({ id: 'keep', title: 'VIDEO OPTIONS', lines: [{ text: 'KEEP THESE SETTINGS?', cls: 'cream' }, `REVERTING IN ${n}…`], hold: false });
  timer = setInterval(() => {
    n--;
    const line = kit.card?.querySelectorAll('.mk-lines p')[1];
    if (line) line.textContent = `REVERTING IN ${n}…`;
    if (n <= 0) {
      clearInterval(timer);
      kit.key({ code: 'KeyN', synthetic: true });
    }
  }, 1000);
  const keep = await p;
  clearInterval(timer);
  if (!keep) hud.setOption(key, old, { quiet: true });
  kit.refresh();
}

/** CONTROLS (S10): KEYBOARD / GAMEPAD tabs, rebinding with conflict swap, X resets a row, RESET ALL. */
export function openControls(hud, tab = 'kb') {
  const kit = hud.kit;
  const binds = () => ({ ...KEY_BINDINGS, ...(hud.options.bindings || {}) });
  let listening = null;
  const rows = [];
  // 'n / N' position counter under the scrolling binding list
  const count = (r, k) => {
    const n = k.card?.querySelector('.mk-count');
    const binds = k.top.rows.filter((x) => x.kind === 'bind');
    const i = binds.indexOf(r);
    if (n) n.textContent = i >= 0 ? `${i + 1} / ${binds.length}` : '';
  };
  if (tab === 'kb') {
    for (const action of Object.keys(KEY_BINDINGS)) {
      rows.push({ kind: 'bind', id: action, label: actionLabel(action), value: (SHIFT_BINDINGS.has(action) ? 'SHIFT+' : '') + keyName(binds()[action]?.[0]), onSelect: (r) => startListen(r), onFocus: count });
    }
    rows.push({ kind: 'rule' }, { label: 'RESET ALL', onSelect: () => resetAll() });
  } else {
    for (const [btn, what] of [['A', 'SELECT / ACTION'], ['B', 'BACK / CANCEL'], ['X', 'CONTEXT: DELETE, RESET'], ['Y', 'DETAILS'], ['LB / RB', 'TABS AND PAGES'], ['LT / RT', 'PAGE UP / DOWN'], ['START', 'MENU'], ['VIEW', 'BRIEFING NOTES'], ['D-PAD / STICK', 'MOVE']]) {
      rows.push({ kind: 'bind', label: what, value: btn, disabled: true, reason: 'THE STANDARD GAMEPAD LAYOUT IS FIXED', onFocus: count });
    }
  }
  rows.push({ label: 'EXIT', onSelect: () => kit.pop() });
  const set = (action, codes) => hud.setOption('bindings', { ...(hud.options.bindings || {}), [action]: codes }, { quiet: true });
  const startListen = (r) => {
    listening = r;
    const b = kit.top.els[kit.top.focus];
    b.classList.add('listening');
    b.querySelector('.mk-bindcap').textContent = '…';
    kit.note('PRESS A KEY…  (ESC CANCELS)');
  };
  const resetAll = async () => {
    if (await kit.confirm({ id: 'resetbinds', title: 'CONTROLS', lines: ['RESET ALL KEY BINDINGS?'] })) {
      hud.setOption('bindings', {}, { quiet: true });
      kit.refresh();
    }
  };
  kit.open({
    id: `controls-${tab}`, title: 'CONTROLS', bg: hud.world ? 'mission' : 'frontend', className: 'mk-options mk-controls', rows, colw: 280,
    render: (box) => {
      const t = el('div', 'mk-tabs', box);
      t.setAttribute('role', 'tablist');
      el('span', 'mk-count', box).setAttribute('aria-hidden', 'true');
      el('div', 'mk-ctlpanel', box); // the local plate the bindings sit on
      for (const [id, l] of [['kb', 'KEYBOARD'], ['pad', 'GAMEPAD']]) {
        const b = el('button', `mk-tabbtn ${id === tab ? 'on' : ''}`, t, l);
        b.type = 'button';
        b.tabIndex = -1;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(id === tab));
        b.addEventListener('click', (e) => { e.stopPropagation(); if (id !== tab) { kit.pop(); openControls(hud, id); } });
      }
    },
    onTab: () => { kit.pop(); openControls(hud, tab === 'kb' ? 'pad' : 'kb'); },
    onContext: (r) => {
      if (!r.id || tab !== 'kb') return;
      const b = { ...(hud.options.bindings || {}) };
      delete b[r.id];
      hud.setOption('bindings', b, { quiet: true });
      kit.refresh();
    },
    hints: [['Enter', 'REBIND'], ['KeyX', 'RESET'], ['BracketLeft', 'TABS'], ['Escape', 'BACK']],
    onKey: (e) => {
      if (!listening) return false;
      const r = listening;
      listening = null;
      if (e.code === 'Escape') { kit.refresh(); return true; }
      const other = Object.entries(binds()).find(([a, codes]) => a !== r.id && codes.includes(e.code));
      if (!other) {
        set(r.id, [e.code]);
        kit.sound.play('toggle');
        kit.refresh();
        return true;
      }
      const ix = kit.top.rows.findIndex((x) => x.id === other[0]);
      kit.top.els[ix]?.classList.add('conflict');
      kit.confirm({ id: 'swap', title: 'CONTROLS', lines: [`ALSO USED BY: ${actionLabel(other[0])} — SWAP?`], hold: false }).then((yes) => {
        if (yes) {
          const mine = binds()[r.id];
          hud.setOption('bindings', { ...(hud.options.bindings || {}), [r.id]: [e.code], [other[0]]: mine }, { quiet: true });
        }
        kit.refresh();
      });
      return true;
    },
  });
}

export function actionLabel(a) {
  return a.replace(/([A-Z])/g, ' $1').replace(/(\d)/, ' $1').toUpperCase().replace('VIEWS', 'VIEWS ').replace(/\s+/g, ' ').trim();
}

/** OPTIONS top level (BEL order). */
export function buildOptions(hud) {
  const kit = hud.kit, o = hud.options;
  const rows = [
    { label: 'USER PROFILE NAME', id: 'profile', value: hud.profiles?.current || '—', onSelect: () => profileCard(hud) },
    { kind: 'slider', id: 'volMaster', label: 'SOUND VOLUME', cls: 'stack', min: 0, max: 1, get: () => o.volMaster, set: (v) => hud.setOption('volMaster', v, { quiet: true }), sample: () => hud.sound.play('select'), format: PCT, onSelect: () => openGroup(hud, 'SOUND'), sub: '↵ / Y: ALL CHANNELS' },
    { label: 'VIDEO OPTIONS', onSelect: () => openGroup(hud, 'VIDEO OPTIONS') },
    { label: 'GAME PREFERENCES', onSelect: () => openGroup(hud, 'GAME PREFERENCES') },
    { kind: 'rule' },
    { label: 'CONTROLS', onSelect: () => openControls(hud) },
    { label: 'ACCESSIBILITY', onSelect: () => openGroup(hud, 'ACCESSIBILITY') },
    { label: 'CLEAR CACHED GAME DATA', id: 'clearcache', onSelect: () => clearCache(hud) },
    { label: 'EXIT', onSelect: () => kit.back() },
  ];
  kit.open({
    id: 'options', title: 'OPTIONS', bg: hud.world ? 'mission' : 'frontend', className: 'mk-options', rows, colw: 300,
    keys: { KeyY: () => openGroup(hud, 'SOUND') },
    onBack: () => { kit.pop(); if (!kit.active) hud.menus.close(true); },
  });
}

/** CLEAR CACHED GAME DATA: the downloaded assets (service worker cache) + the in-memory cache, after a confirm. */
async function clearCache(hud) {
  const ok = await hud.kit.confirm({ id: 'clearcache', title: 'CACHED GAME DATA', lines: ['DELETE THE DOWNLOADED GAME DATA?', 'MISSIONS DOWNLOAD AGAIN WHEN NEXT PLAYED.'] });
  if (!ok) return false;
  await clearCachedGameData({ keepMission: hud.world ? hud.game.missionDef?.id ?? null : null }).catch(() => 0);
  hud.message?.('CACHED GAME DATA CLEARED.', 'info');
  return true;
}

/** USER PROFILE NAME → the S04 profile card: rename, switch or new user. */
function profileCard(hud) {
  const kit = hud.kit, s = hud.screens;
  kit.open({
    id: 'profile', title: 'USER PROFILE', bg: hud.world ? 'mission' : 'frontend',
    rows: [
      { label: 'RENAME', value: hud.profiles.current || '—', onSelect: () => s.enterName({ title: 'USER PROFILE', rename: true, onDone: () => { kit.pop(); kit.refresh(); } }) },
      { label: 'SWITCH USER', disabled: hud.profiles.list.length < 2, reason: 'ONLY ONE SOLDIER ENLISTED', onSelect: () => s.selectUser(() => kit.refresh()) },
      { label: 'NEW USER', onSelect: () => s.enterName({ title: 'NEW USER', onDone: () => { kit.pop(); kit.refresh(); } }) },
      { label: 'EXIT', onSelect: () => kit.pop() },
    ],
  });
}

export { cap };
