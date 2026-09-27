/**
 * Talking portraits (docs/talking-portraits.md; design-spec §6.3): the shipped 256 px clip set covers every
 * recorded commando line (primary + urgent alt take) of the audio pack, voice paths resolve to the audio pack's
 * byte-identical files, size budget; clip choice for barks (recorded take id, alt take, text fallback, silent
 * lines, enemies), theater grade, the photo-still registry and the no-DOM fallback.
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert } from './lib.mjs';
import { TalkingPortraits, ROLE_TO_CHAR, themeFor, KEY_LINES, nextLine, ownVoiceGate, OWN_VOICE_CD } from '../../src/ui/talking-portraits.js';
import { registerPortraitPhoto, portraitPhotoURL, getPortraitURL } from '../../src/art/portraits.js';
import { LINES } from '../../src/audio/voice-lines.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../assets');
const P = join(ROOT, 'portraits');
const man = JSON.parse(readFileSync(join(P, 'manifest.json'), 'utf8'));
const vox = JSON.parse(readFileSync(join(ROOT, 'audio/voice/lines.json'), 'utf8'));
const ROLES = ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy'];
const du = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, f) => n + (f.isDirectory() ? du(join(d, f.name)) : statSync(join(d, f.name)).size), 0);
const files256 = (clip) => ['webm', 'mp4', 'jpg'].map((x) => join(P, `${clip.replace('{size}', '256')}.${x}`));

test('portraits: every commando role maps to a character with idle + talk loop + poster', () => {
  for (const r of ROLES) {
    const c = ROLE_TO_CHAR[r], e = man.characters[c];
    assert.ok(e, `${r} -> ${c}`);
    assert.equal(e.game_id, r);
    for (const k of ['idle', 'talk_loop']) for (const f of files256(e[k].clip)) assert.ok(existsSync(f) && statSync(f).size > 500, f);
    assert.ok(existsSync(join(P, e.poster.replace('{size}', '256'))));
  }
  assert.deepEqual(man.sizes, [256]);
});

test('portraits: every rendered take has its clip (primary + urgent alt); other recorded lines use the talk loop', () => {
  let n = 0, loop = 0;
  const core = new Set(Object.values(KEY_LINES).flat());
  for (const l of vox.lines) {
    const c = ROLE_TO_CHAR[l.speaker]; if (!c) continue; // German guards have no portrait
    const x = man.characters[c].lines[l.rec];
    if (!x) { assert.ok(!core.has(l.rec), `${l.speaker}/${l.rec}: core line needs a clip`); loop++; continue; } // voices v2 flavour/pain take
    assert.equal(x.text, l.text, `${l.speaker}/${l.rec}: clip rendered from the subtitle text`);
    for (const f of files256(x.clip)) assert.ok(existsSync(f), f);
    if (l.alt) { assert.ok(x.alt, `${l.speaker}/${l.rec}: alt clip`); for (const f of files256(x.alt.clip)) assert.ok(existsSync(f), f); n++; }
    n++;
  }
  assert.ok(n >= 96, `${n} takes covered`);
  // …every rendered clip is a line of the pack, and every core (KEY_LINES) line in LINES has its clip
  for (const e of Object.values(man.characters)) for (const r of Object.keys(e.lines)) assert.ok(vox.lines.some((l) => l.speaker === e.game_id && l.rec === r), `${e.game_id}/${r} in the pack`);
  for (const r of ROLES) for (const k of ['select', 'ack_move', 'ack_act', 'hurt']) for (const l of LINES[r][k].filter((x) => core.has(x.rec))) {
    assert.ok(man.characters[ROLE_TO_CHAR[r]].lines[l.rec], `${r}.${k}: ${l.rec}`);
  }
});

test('portraits: voice paths resolve (audio pack, identical files) and the set fits its budget', () => {
  for (const e of Object.values(man.characters)) for (const x of Object.values(e.lines)) for (const y of [x, x.alt].filter(Boolean)) {
    for (const k of ['voice', 'voice_mp3']) assert.ok(existsSync(join(P, y[k])), `${y[k]}`);
    assert.ok(y.lead > 0 && y.voice_seconds > 0.3 && y.seconds > y.voice_seconds, `${y.clip} timing`);
  }
  const mb = du(P) / 1048576;
  assert.ok(mb < 10, `assets/portraits ${mb.toFixed(2)} MB < 10 MB`);
  assert.ok(existsSync(join(P, 'LICENSES.json')));
  const credits = readFileSync(join(ROOT, '../CREDITS.md'), 'utf8');
  assert.match(credits, /LivePortrait/);
});

function rig({ pack = true } = {}) {
  const tp = new TalkingPortraits({ events: null, audio: { engine: { voiceSpeakers: new Set(pack ? ROLES : []) } } });
  tp.man = man; tp.ok = true;
  const calls = [];
  tp._play = (unit, char, entry, o) => calls.push({ char, clip: entry?.clip || 'talk_loop', dur: o.dur });
  return { tp, calls };
}

test('portraits: bark -> exact clip of the take heard (rec, alt), text fallback, silent / enemy lines ignored', () => {
  const { tp, calls } = rig();
  const sap = { id: 4, role: 'sapper', kind: 'commando', alive: true };
  tp._bark({ unit: sap, speaker: 'sapper', line: 'ack_move', text: 'On my way.', rec: 'on_my_way', take: 'primary', duration: 1.2 });
  tp._bark({ unit: sap, speaker: 'sapper', line: 'hurt', text: "I'm hit!", rec: 'i_m_hit', take: 'alt', duration: 0.9 });
  tp._bark({ unit: sap, speaker: 'sapper', line: 'select', text: 'Ready.' }); // no rec: text match
  tp._bark({ unit: sap, speaker: 'sapper', line: 'cant', text: 'Wrong tool for that.', duration: 1.4 }); // pack: silent
  tp._bark({ unit: { role: 'soldier', kind: 'enemy' }, speaker: 'ger', line: 'ger_halt', text: 'Halt!' });
  tp._bark({ unit: sap, speaker: 'sapper', line: 'ack_move', text: 'On my way.', rec: 'on_my_way', suppressed: true });
  assert.deepEqual(calls.map((c) => c.clip), ['sapper/on_my_way_{size}', 'sapper/i_m_hit_alt_{size}', 'sapper/ready_{size}']);
  // placeholder voices (no recorded pack): unrendered lines use the generic talk loop for the line's duration
  const b = rig({ pack: false });
  b.tp._bark({ unit: sap, speaker: 'sapper', line: 'cant', text: 'Wrong tool for that.', duration: 1.4 });
  assert.deepEqual(b.calls, [{ char: 'sapper', clip: 'talk_loop', dur: 1.4 }]);
  const alt = tp.entryFor('spy', { rec: 'on_my_way', take: 'alt' });
  const pri = man.characters.spy.lines.on_my_way;
  assert.ok(alt.clip !== pri.clip && alt.voice_seconds !== pri.voice_seconds && /alt/.test(alt.voice), 'alt take has its own clip + timing');
});

test('portraits: theater grade, photo registry, no-DOM fallback', async () => {
  assert.equal(themeFor({ theater: 'snow' }), 'snow');
  assert.equal(themeFor({ theater: 'desert' }), 'desert');
  assert.equal(themeFor({ theater: 'temperate' }), 'europe');
  assert.equal(themeFor({ theater: 'snow', lighting: { sunElevDeg: -8 } }), 'night');
  registerPortraitPhoto('sapper', 'assets/portraits/sapper/idle_256.jpg');
  assert.equal(portraitPhotoURL('sapper'), 'assets/portraits/sapper/idle_256.jpg');
  assert.equal(getPortraitURL('sapper'), ''); // outside the browser
  registerPortraitPhoto('sapper', null);
  assert.equal(portraitPhotoURL('sapper'), null);
  const tp = new TalkingPortraits({ events: null });
  assert.equal(await tp.load([{ id: 1, role: 'spy' }]), false);
  assert.equal(tp.ok, false);
});

test('portraits: own-voice line rotation starts at "yes_sir", never repeats back to back, covers every line', () => {
  assert.equal(KEY_LINES.select[0], 'yes_sir');
  assert.equal(nextLine([], null), null);
  assert.equal(nextLine(['only'], 'only'), 'only');
  const seen = [];
  let prev;
  for (let i = 0; i < 7; i++) { prev = nextLine(KEY_LINES.select, prev); seen.push(prev); }
  assert.equal(seen[0], 'yes_sir');
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1], `repeat at ${i}`);
  assert.deepEqual([...new Set(seen)].sort(), [...KEY_LINES.select].sort());
  assert.equal(nextLine(KEY_LINES.ack_move, 'not-a-line'), KEY_LINES.ack_move[0], 'unknown previous -> first');
  // every rotated line is rendered for every character
  for (const c of Object.values(man.characters)) for (const k of ['select', 'ack_move', 'ack_act']) for (const n of KEY_LINES[k]) assert.ok(c.lines[n], `${c.game_id}: ${n}`);
});

test('portraits: own-voice cooldowns: rapid re-selection of the same man stays quiet, a new man always speaks', () => {
  const last = new Map(), a = { id: 1 }, b = { id: 2 };
  assert.ok(ownVoiceGate(last, a, 'select', 0));
  assert.ok(!ownVoiceGate(last, a, 'select', 1), 'same man, inside the select cooldown');
  assert.ok(ownVoiceGate(last, b, 'select', 1.05), 'new man speaks at once');
  assert.ok(ownVoiceGate(last, a, 'select', 1.7), 'back to the first man (someone else spoke since): speaks');
  assert.ok(!ownVoiceGate(last, a, 'select', 2.5), 'him again: quiet');
  assert.ok(ownVoiceGate(last, a, 'select', 1.7 + OWN_VOICE_CD.select + 0.01), 'after the cooldown');
  assert.ok(ownVoiceGate(last, a, 'ack_move', 1.7 + OWN_VOICE_CD.select + 0.7), 'an order after a selection: short gap only');
  assert.ok(!ownVoiceGate(last, a, 'ack_move', 1.7 + OWN_VOICE_CD.select + 0.9), 'order spam: 0.6 s gap');
});
