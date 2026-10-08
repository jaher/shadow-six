/**
 * Debug mode (`?debug`): pure helpers, no DOM. URL parsing, the remembered inspection options, the level
 * select's grouping/order of missionList(), and the mission-def transform the options imply (all commandos,
 * time-of-day / wind override). The overlay, quick keys and info HUD live in debug/debug-mode.js.
 * design-spec "Debug mode"; README "Debug mode".
 * @module debug/debug-options
 */

/** localStorage key of the remembered options. */
export const STORAGE_KEY = 'shadowsix.debug.options';

export const TIME_SCALES = Object.freeze([0.5, 1, 2, 4]);
/** Time-of-day overrides → mission `lighting` keys (engine/lighting.js resolveLighting). 'mission' = as authored. */
export const TIME_OF_DAY = Object.freeze({
  mission: null,
  dawn: { sunElevDeg: 14, sunAzimuthDeg: 110, kelvin: 3800 },
  noon: { sunElevDeg: 62, kelvin: 5800 },
  dusk: { sunElevDeg: 12, sunAzimuthDeg: 250, kelvin: 3100 },
  overcast: { sunElevDeg: 35, kelvin: 6800, hdri: 'overcast', fog: 140 },
});
/** Wind overrides → mission `weather.wind.preset` (world/wind.js WIND_PRESETS). 'mission' = as authored. */
export const WEATHER = Object.freeze(['mission', 'calm', 'temperate', 'coast', 'fjord', 'snow', 'desert', 'urban']);

export const DEFAULT_OPTIONS = Object.freeze({
  skipBriefing: true,
  allCommandos: false,
  invulnerable: false,
  noDetect: false,
  cones: false,
  freeCamera: false,
  timeScale: 1,
  timeOfDay: 'mission',
  weather: 'mission',
  infoHud: true,
});

/** Roles "all commandos available" adds when missing, per ruleset (BCD guests join by script, Natasha is free). */
export const ALL_ROLES = Object.freeze({
  BEL: ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy'],
  BCD: ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy', 'natasha'],
});

/**
 * Is debug mode on for this query string? `?debug`, `?debug=1`, `?debug=cones`, any value except 0/false/off.
 * @param {string|URLSearchParams} search
 * @returns {{enabled: boolean, value: string|null, cones: boolean, mission: string|null}}
 */
export function parseDebugParams(search) {
  const p = search instanceof URLSearchParams ? search : new URLSearchParams(search || '');
  const has = p.has('debug');
  const value = has ? p.get('debug') : null;
  const enabled = has && !/^(0|false|off|no)$/i.test(value || '');
  const parts = (value || '').toLowerCase().split(/[,+ ]/).filter(Boolean);
  return { enabled, value, cones: enabled && parts.includes('cones'), mission: p.get('mission') || null, walkthrough: p.get('walkthrough') || null };
}

/** Coerce stored / partial options onto DEFAULT_OPTIONS (unknown keys dropped, bad values reset). */
export function normalizeOptions(o) {
  const out = { ...DEFAULT_OPTIONS };
  if (!o || typeof o !== 'object') return out;
  for (const k of Object.keys(DEFAULT_OPTIONS)) {
    if (!(k in o)) continue;
    const d = DEFAULT_OPTIONS[k], v = o[k];
    if (typeof d === 'boolean') out[k] = !!v;
    else if (k === 'timeScale') out[k] = TIME_SCALES.includes(+v) ? +v : d;
    else if (k === 'timeOfDay') out[k] = v in TIME_OF_DAY ? v : d;
    else if (k === 'weather') out[k] = WEATHER.includes(v) ? v : d;
  }
  return out;
}

/** Remembered options (try/catch: storage may be blocked). `forced` (e.g. {cones: true} from ?debug=cones) wins. */
export function loadOptions(storage, forced = {}) {
  let saved = null;
  try { saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null'); } catch { saved = null; }
  return normalizeOptions({ ...(saved || {}), ...forced });
}

export function saveOptions(storage, o) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(normalizeOptions(o))); return true; } catch { return false; }
}

/** Next value of a cycling option (timeScale / timeOfDay / weather). */
export function cycleOption(o, key, dir = 1) {
  const list = key === 'timeScale' ? TIME_SCALES : key === 'timeOfDay' ? Object.keys(TIME_OF_DAY) : key === 'weather' ? WEATHER : null;
  if (!list) return o[key];
  const i = list.indexOf(o[key]);
  return list[(((i < 0 ? 0 : i) + dir) % list.length + list.length) % list.length];
}

/** Campaign number of a mission def: `def.number`, else the digits of an `mNN` id (null for sandboxes / others). */
export function missionNumber(def) {
  if (Number.isFinite(def?.number)) return def.number;
  const m = /^m(\d+)$/.exec(def?.id || '');
  return m && +m[1] > 0 ? +m[1] : null;
}

/** Level-select group of a def: 'BEL' | 'BCD' | 'TEST' (sandboxes, `dev: true` maps, unnumbered BEL maps). */
export function groupOf(def) {
  if (def?.dev) return 'TEST';
  const c = def?.campaign || 'BEL';
  if (c === 'BCD') return 'BCD';
  return missionNumber(def) ? 'BEL' : 'TEST';
}

export const GROUPS = Object.freeze([
  { id: 'BEL', label: 'Behind Enemy Lines' },
  { id: 'BCD', label: 'Beyond the Call of Duty' },
  { id: 'TEST', label: 'Sandbox / test maps' },
]);

/**
 * Every mission of `list` (missionList(), any order) grouped for the level select: BEL by campaign number,
 * BCD and test maps in list order. Empty groups are dropped.
 * @param {object[]} list mission defs
 * @returns {{id: string, label: string, missions: {id: string, n: number|null, title: string, subtitle: string, theater: string, campaign: string}[]}[]}
 */
export function groupMissions(list) {
  const rows = (Array.isArray(list) ? list : []).filter((d) => d && d.id).map((d, i) => ({
    id: d.id, n: missionNumber(d), title: d.title || d.id, subtitle: d.subtitle || '', theater: d.theater || 'temperate',
    campaign: d.campaign || 'BEL', group: groupOf(d), i,
  }));
  return GROUPS.map((g) => {
    const ms = rows.filter((r) => r.group === g.id);
    if (g.id === 'BEL') ms.sort((a, b) => a.n - b.n || a.i - b.i);
    return { ...g, missions: ms.map(({ group, i, ...r }) => r) };
  }).filter((g) => g.missions.length);
}

/** Flat level order (PageDown / PageUp): the level select's order, group after group. */
export function levelOrder(list) {
  return groupMissions(list).flatMap((g) => g.missions.map((m) => m.id));
}

/** The level `dir` steps (+1 next / −1 previous, wrapping) from `id` in levelOrder; the first one for an unknown id. */
export function neighbourLevel(list, id, dir = 1) {
  const order = levelOrder(list);
  if (!order.length) return null;
  const i = order.indexOf(id);
  if (i < 0) return order[dir < 0 ? order.length - 1 : 0];
  return order[(((i + dir) % order.length) + order.length) % order.length];
}

/**
 * The mission def as the debug options want it (a shallow copy; the def itself is never mutated):
 * allCommandos adds every missing role of the ruleset beside the first commando; timeOfDay / weather
 * override `lighting` / `weather.wind.preset`. Returns `def` unchanged when nothing applies.
 */
export function transformDef(def, o) {
  if (!def || !o) return def;
  let out = def;
  const copy = () => (out === def ? (out = { ...def }) : out);
  if (o.allCommandos) {
    const have = new Set((def.commandos || []).map((c) => c.role));
    const roles = ALL_ROLES[def.campaign === 'BCD' ? 'BCD' : 'BEL'].filter((r) => !have.has(r));
    if (roles.length) {
      const c0 = (def.commandos || [])[0] || def.cameraStart || { x: (def.size?.[0] || 40) / 2, z: (def.size?.[1] || 40) / 2 };
      const add = roles.map((role, k) => {
        const a = (k / roles.length) * Math.PI * 2;
        return { role, x: c0.x + Math.cos(a) * 1.6, z: c0.z + Math.sin(a) * 1.6, heading: c0.heading || 0 };
      });
      copy().commandos = [...(def.commandos || []), ...add];
    }
  }
  const tod = TIME_OF_DAY[o.timeOfDay];
  if (tod) copy().lighting = { ...(def.lighting || {}), ...tod };
  if (o.weather && o.weather !== 'mission') {
    const w = def.weather || {};
    copy().weather = { ...w, wind: { ...(w.wind || {}), preset: o.weather } };
  }
  return out;
}
