/**
 * The words the part-1 briefing screen shows, as plain data (no DOM): the paragraphs and the forced
 * standing-orders line. The briefing UI renders exactly these strings and the newsreel narration
 * (assets/audio/narration, built by tools/audio/narration) reads exactly these strings, so text and voice
 * can never drift apart (tests/unit/narration.test.mjs checks the manifest text against them).
 * @module ui/briefing-text
 */

import { forcedRuleLines } from '../core/house-rules.js';
import { catalogueEntry } from './catalogue.js';

/**
 * The mission's wartime background (`def.briefing.historical`, written by us): shown on the briefing screen as a typed
 * dispatch under the place line and read by the narrator right after the title card. '' when the mission has none.
 * @param {object} def mission definition
 * @returns {string}
 */
export function briefingHistory(def) {
  return String(def?.briefing?.historical || '').trim();
}

/**
 * Up to 3 paragraphs: the catalogue context, the def's briefing text, then "Orders: …" when there is room.
 * @param {object} def mission definition
 * @param {object|null} [cat] catalogue entry (looked up when omitted)
 * @returns {string[]}
 */
export function briefingParagraphs(def, cat = catalogueEntry(def)) {
  const out = [];
  if (cat?.context) out.push(cat.context);
  if (def?.briefing?.text) out.push(def.briefing.text);
  const obj = (def?.objectives || []).filter((o) => !o.hidden).map((o) => o.text);
  if (obj.length && out.length < 3) out.push(`Orders: ${obj.join('; ')}.`);
  return out.slice(0, 3);
}

/** The "Standing orders: …" line for a mission that forces house rules, or ''. */
export function briefingRulesLine(def) {
  const rules = forcedRuleLines(def);
  return rules.length ? `Standing orders: ${rules.join(' ')}` : '';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The newsreel's opening card, read from the screen header: "Mission 1. Baptism of Fire. Sola, near Stavanger,
 * Norway. February 20, 1941." Campaign missions only ('' for the sandbox / test maps).
 */
export function briefingHeadline(def, cat = catalogueEntry(def)) {
  const n = cat?.n;
  if (!n) return '';
  const place = def?.location || cat?.place || '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(def?.date || '').trim());
  const date = m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : String(cat?.date || '').replace(/^(\w{3})\w*/, (s, a) => MONTHS.find((x) => x.startsWith(a)) || s);
  return [`Mission ${n}.`, `${def?.title || cat.title}.`, place && `${place}.`, date && `${date}.`].filter(Boolean).join(' ');
}

/**
 * Everything the narrator reads, in screen order: the header card, the wartime background, the paragraphs, then the
 * standing-orders line.
 * @returns {{id:string, text:string}[]} ids head, hist, p0, p1, p2, rules
 */
export function briefingNarrationLines(def, cat = catalogueEntry(def)) {
  const lines = briefingParagraphs(def, cat).map((text, i) => ({ id: `p${i}`, text }));
  const hist = briefingHistory(def);
  if (hist) lines.unshift({ id: 'hist', text: hist });
  const h = briefingHeadline(def, cat);
  if (h) lines.unshift({ id: 'head', text: h });
  const r = briefingRulesLine(def);
  if (r) lines.push({ id: 'rules', text: r });
  return lines;
}
