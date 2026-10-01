/**
 * UI constants (design-spec §5.3, §6) and persistent player options (§6.8). CONFIG has no `ui` group, so the
 * HUD's reference-pixel layout, timings and option defaults live here (owned by UI).
 * All sizes are BEL reference px (640×480 layout) and get multiplied by `uiScale`.
 * @module ui/ui-config
 */

import { CONFIG } from '../config.js';

export const UI = {
  refHeight: 480, // §6: uiScale = clamp(floor(innerHeight / 480 × 2) / 2, 1, 3)
  scaleMin: 1,
  scaleMax: 3,
  topBar: { height: 45, pitch: 65, frameW: 62, frameH: 44, face: 40, hpSlot: [9, 37], hpFill: [6, 34], shadow: 'rgb(17,15,11)' },
  hpColor: 'rgb(104,0,0)',
  icons: { postureProne: [40, 41], postureStand: [40, 41], help: [24, 41], camera: [48, 41], eye: [52, 41], lamp: [26, 41] }, // one 41-px slot height
  strap: 36, // right column strap width
  notebook: { closed: [33, 206], open: [183, 215], openDelay: 0.25, closeDelay: 0.4, corner: [23, 22] },
  hand: [50, 65],
  knapsack: [112, 149],
  speakerCard: [96, 72],
  speakerLinger: 0.5, // s after the line (§6.3)
  tooltipDelay: 0.8, // s (§5.2, §6.4)
  messageTime: 4, // s (§6.5)
  flashSeenHz: 0, // steady blue glow (§6.2)
  flashHeldHz: 4, // red flash (§6.2)
  warningTTL: 0.6, // s an event-driven warning stays lit without a refresh
  eyeBlinkHz: 2, // §5.3
  lampHz: 2, // §6.1 siren lamp
  moveMarkerTime: 0.6, // §5.3 twin-star sparkle
  cursorSize: 32,
  scopeSize: 88,
  briefingSlide: 6, // s crossfade (§6.6)
  briefingStop: 4.5, // s per Colonel tour stop (§6.6 part 2)
  briefingZoom: 0.5, // camera zoom factor for the tour
  barkCharsPerSec: 14, // subtitle duration estimate when a bark carries no duration
  barkMin: 1.6,
  saveSlots: 10, // §6.8 / §8.4
};

/** §6: uiScale from the window height (user override wins when > 0). */
export function computeUiScale(innerHeight, override = 0) {
  if (override > 0) return Math.min(UI.scaleMax, Math.max(0.5, override));
  const s = Math.floor((innerHeight / UI.refHeight) * 2) / 2;
  return Math.min(UI.scaleMax, Math.max(UI.scaleMin, s));
}

/** §6.8 option defaults. Other systems read `game.options` (installed by the HUD). */
export const OPTION_DEFAULTS = {
  volMaster: 0.8,
  volSfx: 1,
  volVoice: 1,
  volMusic: 0.7,
  halt: 'indifferent', // 'submissive' | 'indifferent' (§4.5 / §6.8)
  voice: 'verbose', // 'verbose' | 'laconic' (§6.3)
  warnings: true, // "Commando warnings" (§6.2)
  preset: 'high', // low | medium | high | ultra
  uiScale: 0, // 0 = auto
  blood: true,
  censored: false,
  subtitles: true, // bark subtitles (§6.5)
  activePause: false, // ⚑ §6.8
  coneAlertTint: true,
  edgeScroll: true,
  wheelZoom: true,
  cameraAngle: CONFIG.camera.yawDeg, // camera yaw (deg): 0 classic BEL / 15 tilted / 45 isometric
  selectionRing: true, // §6.1 ⚑
  nature: true, // §9.2 ambience
  // docs/menus-art-direction.md S10 / §1.9 (menus, video, accessibility, controls)
  subSize: 'M', // subtitle size S / M / L
  subBand: 0.6, // subtitle background band opacity 0–0.8
  resScale: 1, // render resolution scale 0.5–1
  menuBg: 'live', // 'live' | 'still' (B1 / B1s)
  grain: true, // film grain and vignette
  brightness: 0.5, // 0–1, 0.5 = neutral
  fullscreen: false,
  intro: 'first', // 'first' | 'always' | 'never'
  saveReminder: false,
  textScale: 1, // 0.9–1.5
  reducedMotion: 'system', // 'system' | 'on' | 'off' (also: no explosion camera shake, render/fx.js)
  highContrast: false,
  holdConfirm: false, // hold-to-confirm for destructive actions
  bindings: {}, // action → [KeyboardEvent.code] overrides of engine/input.js KEY_BINDINGS
  // bodies-design §D.3 RULES (house rules, applied at the next mission start or load; core/house-rules.js)
  rulesPreset: 'shadowSix', // 'shadowSix' | 'classic1998' | 'custom' (set when a toggle differs from the preset)
  dragBodies: true,
  buddyRescue: true,
  dropWhenShot: true,
  ragdollAllDeaths: true,
  physicsGameplay: true,
};

export const OPTIONS_KEY = 'shadowsix.options.v1';

export function loadOptions(storage = globalThis.localStorage) {
  let saved = {};
  try {
    saved = JSON.parse(storage?.getItem(OPTIONS_KEY) || '{}') || {};
  } catch {
    saved = {};
  }
  const out = { ...OPTION_DEFAULTS };
  for (const k of Object.keys(OPTION_DEFAULTS)) if (k in saved && typeof saved[k] === typeof OPTION_DEFAULTS[k]) out[k] = saved[k];
  return out;
}

export function saveOptions(opts, storage = globalThis.localStorage) {
  try {
    storage?.setItem(OPTIONS_KEY, JSON.stringify(opts));
  } catch {
    /* private mode: options live for the session only */
  }
}
