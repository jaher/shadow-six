/**
 * Wind ambience law (user report 2026-10-02: "The wind sound is too intense as if in a terror movie, can you make it
 * more subtle"). The wind beds are soft broadband air (tools/audio/procedural_beds.py `wind_*`: no howling resonance,
 * no swell out of silence) set 13–17 dB under the in-mission music bed (manifest.js AMBIENCE). Here: how they follow the
 * mission WindField (world/wind.js) — a few dB, slowly — and when the gust whoosh may play (rarely, softly).
 *
 * The old law, k = min(1.9, 0.3 + speed / 9 + gust / 2), swung the bed from ×0.6 to ×1.9 (−4…+5.6 dB) within a second
 * as each gust front crossed the view, on top of a recording that already rose 60 dB out of silence: moaning swells.
 * @module audio/wind-bed
 */

/** Bed automation around the AMBIENCE level (dB). */
export const WIND_BED = Object.freeze({
  dbPerSpeed: 4, // dB per unit of (wind speed / the mission's typical speed − 1)
  lullDb: -2.5, // a lull takes the bed down at most this far…
  gustDb: 2.5, // …and the strongest front (or a desert dust devil at the view) up at most this far
  tauUp: 2.5, // s: a stronger spell builds over a few seconds (no sharp swell)
  tauDown: 4.5, // s: and dies away more slowly still
  stepDb: 0.1, // dB of change before the bed's gain is touched again
});

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Target bed offset (dB) for a WindField sample at the listener. The field's slow envelope averages 0.8 of the preset
 * speed, so "typical" = 0.8 × speed reads 0 dB.
 * @param {{speed:number}} sample WindField.sample() output
 * @param {{speed:number}} [preset] WindField.p (resolveWind)
 */
export function windBedTargetDb(sample, preset) {
  const typical = Math.max(0.5, 0.8 * (preset?.speed ?? 5));
  const r = (Number.isFinite(sample?.speed) ? sample.speed : typical) / typical;
  return clamp(WIND_BED.dbPerSpeed * (r - 1), WIND_BED.lullDb, WIND_BED.gustDb);
}

/** One step of the asymmetric one-pole smoother (dB domain): rises with tauUp, falls with tauDown. */
export function smoothWindDb(prev, target, dt) {
  if (!Number.isFinite(prev)) return target;
  const tau = target > prev ? WIND_BED.tauUp : WIND_BED.tauDown;
  return prev + (target - prev) * (1 - Math.exp(-clamp(dt, 0, 1) / tau));
}

/** Gust whoosh ('wind:gust' at the view centre, render/wind-fx.js): only strong fronts, at most one per `gap` s. */
export const GUST = Object.freeze({
  minGust: 0.45, // front intensity (gustiness-scaled) below which no whoosh plays (wind-fx emits from 0.38)
  gap: 45, // s between two whooshes
  gainMin: 0.6, // × the manifest gain for a front at minGust…
  gainMax: 1, // …up to this for the strongest fronts (gust ≥ minGust + 0.5)
});

/**
 * Gain for a gust whoosh, or 0 when it must not play (weak front, or too soon after the last one).
 * @param {{gust?:number}} e the 'wind:gust' event @param {number} now s @param {number} [last] s of the last whoosh
 */
export function gustWhooshGain(e, now, last = -Infinity) {
  const g = e?.gust ?? 0;
  if (!(g >= GUST.minGust) || now - last < GUST.gap) return 0;
  return GUST.gainMin + (GUST.gainMax - GUST.gainMin) * clamp((g - GUST.minGust) / 0.5, 0, 1);
}
