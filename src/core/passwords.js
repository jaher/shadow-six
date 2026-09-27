/**
 * Mission passwords (design-spec §8.3) — pure module. The demo's structure with our own keys:
 *
 *   v   = seq(6) | stars(5) | rank(4) | chk(4)            (19 bits, MSB → LSB)
 *   seq = 20·campaign + mission − 1                        (campaign 0 = BEL, 1 = BCD)
 *   chk = ((v>>10) + (v>>15) + (v>>5)) & 15
 *   p   = parity(v);  e = (K1 ^ v) & 0xFFFFF, inverted when p = 1
 *   w   = (K2 ^ (e<<1 | p)) & 0xFFFFF
 *   text: chars 1–4 = w in base 36 (ALPHABET digits, least-significant first);
 *         char 5 = ALPHABET[((w>>10) + (w>>15) + (w>>5)) & 31]
 * Input is case-insensitive (O is read as 0 and I as 1). None is issued for mission 1.
 * @module core/passwords
 */

import { CONFIG } from '../config.js';

export const CAMPAIGN_CODES = Object.freeze({ BEL: 0, BCD: 1 });
const CAMPAIGN_BY_CODE = ['BEL', 'BCD'];
const MAX_MISSION = { BEL: 20, BCD: 8 };

const alphabet = () => CONFIG.passwords.alphabet;

/** Parity (XOR of all bits) of a non-negative integer. */
export function parity(v) {
  let p = 0;
  while (v) { p ^= v & 1; v >>>= 1; }
  return p;
}

/** Checksum nibble of a 19-bit value (the chk field itself is ignored: all shifts are ≥ 5). */
export function checksum(v) {
  return ((v >>> 10) + (v >>> 15) + (v >>> 5)) & 15;
}

/** Pack the fields into the 19-bit value v (with chk). */
export function packValue(seq, stars, rank) {
  const v = ((seq & 63) << 13) | ((stars & 31) << 8) | ((rank & 15) << 4);
  return v | checksum(v);
}

/** Whiten v → w (20 bits). */
export function whiten(v) {
  const { K1, K2 } = CONFIG.passwords;
  const p = parity(v);
  let e = (K1 ^ v) & 0xfffff;
  if (p) e = ~e & 0xfffff;
  return (K2 ^ ((e << 1) | p)) & 0xfffff;
}

/** Undo whiten(): w → v (19 bits). */
export function unwhiten(w) {
  const { K1, K2 } = CONFIG.passwords;
  const x = (K2 ^ w) & 0xfffff;
  const p = x & 1;
  let e = x >>> 1; // bit 19 of e was shifted out; v never uses it
  if (p) e = ~e & 0x7ffff;
  return (e ^ K1) & 0x7ffff;
}

const checkChar = (w) => alphabet()[((w >>> 10) + (w >>> 15) + (w >>> 5)) & 31];

/**
 * Encode a password (§8.3).
 * @param {string} campaign 'BEL' | 'BCD'
 * @param {number} mission 1-based mission number the password opens
 * @param {number} stars gold stars toward the next rank (0..31)
 * @param {number} rank rank index (0..10)
 * @returns {string|null} 5-character code, or null (mission 1 / out of range)
 */
export function encodePassword(campaign, mission, stars, rank, difficulty = null) {
  const c = CAMPAIGN_CODES[campaign];
  if (c === undefined || !(mission >= 2 && mission <= MAX_MISSION[campaign])) return null;
  if (!(stars >= 0 && stars <= 31) || !(rank >= 0 && rank <= 10)) return null;
  // BCD (bcd-plan §1.12): the Skill bit rides in the unused mission slots — Easy = mission + 10 (BCD has 8)
  const easy = campaign === 'BCD' && difficulty === 'easy' ? 10 : 0;
  const v = packValue(20 * c + mission - 1 + easy, stars | 0, rank | 0);
  const w = whiten(v);
  const A = alphabet();
  let s = '';
  let n = w;
  for (let i = 0; i < 4; i++) { s += A[n % 36]; n = Math.floor(n / 36); }
  return s + checkChar(w);
}

/** Normalise user input: trim, upper-case, O → 0, I → 1 (§8.3). */
export function normalizeCode(code) {
  return String(code ?? '').trim().toUpperCase().replace(/O/g, '0').replace(/I/g, '1');
}

/**
 * Decode a password (§8.3).
 * @returns {{campaign:string, mission:number, stars:number, rank:number}|null}
 */
export function decodePassword(code) {
  const s = normalizeCode(code);
  if (s.length !== 5) return null;
  const A = alphabet();
  let w = 0;
  for (let i = 3; i >= 0; i--) {
    const d = A.indexOf(s[i]);
    if (d < 0) return null;
    w = w * 36 + d;
  }
  if (w > 0xfffff || checkChar(w) !== s[4]) return null;
  const v = unwhiten(w);
  if (checksum(v) !== (v & 15)) return null;
  const seq = v >>> 13, stars = (v >>> 8) & 31, rank = (v >>> 4) & 15;
  const campaign = CAMPAIGN_BY_CODE[Math.floor(seq / 20)];
  let mission = (seq % 20) + 1;
  const easy = campaign === 'BCD' && mission > 10;
  if (easy) mission -= 10;
  if (!campaign || mission < 2 || mission > MAX_MISSION[campaign] || rank > 10) return null;
  return campaign === 'BCD' ? { campaign, mission, stars, rank, difficulty: easy ? 'easy' : 'hard' } : { campaign, mission, stars, rank };
}
