/**
 * MUSIC CUE SELECTION (design-spec §9.1) — pure helpers: which cue plays on which screen / for which mission.
 * The BEL album structure: a menu theme, one campaign theme per theater (Norway, North Africa, Normandy, Rhine,
 * Final Assault, End of WWII) on the campaign map, three briefing loops, the tutorial theme, a start stinger per
 * theater, three success / three unsuccessful stingers, the exit stinger and the credits. The in-mission suspense
 * score is music-director.js (MISSION_CHAIN + mission_alert).
 * @module audio/music-cues
 */

/** BEL chapters by mission number (catalogue §7.1): theme on the campaign map + start stinger. */
export const CHAPTERS = Object.freeze([
  Object.freeze({ id: 'norway', from: 1, to: 7, theme: 'campaign_norway', start: 'start_1', label: 'Norway' }),
  Object.freeze({ id: 'africa', from: 8, to: 12, theme: 'campaign_africa', start: 'start_2', label: 'North Africa' }),
  Object.freeze({ id: 'normandy', from: 13, to: 15, theme: 'campaign_normandy', start: 'start_3', label: 'Normandy' }),
  Object.freeze({ id: 'rhine', from: 16, to: 18, theme: 'campaign_rhine', start: 'start_4', label: 'The Rhine' }),
  Object.freeze({ id: 'reich', from: 19, to: 20, theme: 'campaign_reich', start: 'start_5', label: 'Final Assault' }),
]);
/** Fallback chapter from a mission's terrain theater (BCD / unnumbered maps). */
const THEATER_CHAPTER = Object.freeze({ snow: 'norway', fjord: 'norway', desert: 'africa', coast: 'normandy',
  summer: 'normandy', temperate: 'rhine', urban: 'reich' });
/** Covert / generic start stinger (tutorial sandbox, unknown maps). */
export const GENERIC_START = 'start_6';
/** Cues that play once and then hand over to another bed (no loop points). */
export const ONCE_THEN = Object.freeze({ credits: 'menu', campaign_end: 'credits' }); // STYLE §2.5: end → credits → menu
/** Crossfade between beds (s): the outgoing bed fades over XFADE_OUT, the new one in over XFADE_IN. */
export const XFADE_OUT = 2.0;
export const XFADE_IN = 1.5;

/** Campaign number of a mission def / id ('m07' → 7, 'm00' → 0); null when the id carries no number. */
export function missionNumber(m) {
  const id = typeof m === 'string' || typeof m === 'number' ? String(m) : m?.id;
  if (m && typeof m === 'object' && Number.isFinite(m.n)) return m.n;
  const mm = /^m(\d+)$/i.exec(String(id ?? '').trim());
  return mm ? parseInt(mm[1], 10) : null;
}

/** Chapter record of a mission (number first, then theater); null for the sandbox / nothing. */
export function chapterOf(m) {
  const n = missionNumber(m);
  if (n === 0) return null; // tutorial sandbox
  if (n != null) { const c = CHAPTERS.find((ch) => n >= ch.from && n <= ch.to); if (c) return c; }
  const t = m && typeof m === 'object' ? m.theater : null;
  return CHAPTERS.find((ch) => ch.id === THEATER_CHAPTER[t]) || null;
}

/** Campaign-map theme for a mission (the focused / next one); Norway when nothing is known. */
export function campaignTheme(m) { return (chapterOf(m) || CHAPTERS[0]).theme; }

/** Start stinger for a mission: its theater's stinger, the covert one for the sandbox and unknown maps. */
export function startCueFor(m, rand = Math.random) {
  if (!m) return `start_${1 + Math.floor(rand() * 6)}`;
  return chapterOf(m)?.start || GENERIC_START;
}

/** Briefing loop for a mission: the three briefings rotate through the campaign (STYLE §2.5: M1 → 1, M2 → 2, M3 → 3, M4 → 1, …; sandbox → 1). */
export function briefingCueFor(m) {
  const n = missionNumber(m) || 0;
  return `briefing_${n > 0 ? 1 + ((n - 1) % 3) : 1}`;
}

/** Success / unsuccessful stinger (random pick of three). */
export function endStinger(won, rand = Math.random) {
  return `${won ? 'success' : 'fail'}_${1 + Math.floor(rand() * 3)}`;
}

/**
 * Music cue for a game / flow state (§9.1). Returns a cue id, null = silence, undefined = keep the current request
 * (the mission select picks its own theme from the focused pin; in-mission states belong to the director).
 */
export function cueForState(state, mission = null) {
  switch (state) {
    case 'title': case 'menu': return 'menu';
    case 'briefing': return briefingCueFor(mission);
    case 'epilogue': return 'campaign_end';
    case 'debrief': return null; // silent after the end stinger (BEL)
    default: return undefined;
  }
}

/** Cue requested by a UI screen name (front-end screens that are not flow states). */
export function cueForScreen(screen, mission = null) {
  switch (screen) {
    case 'title': case 'main': case 'options': case 'load': case 'save': case 'help': case 'password': return 'menu';
    case 'select': case 'map': return campaignTheme(mission);
    case 'tutorials': return 'tutorial';
    case 'credits': return 'credits';
    case 'briefing': return briefingCueFor(mission);
    case 'epilogue': return 'campaign_end';
    default: return undefined;
  }
}
