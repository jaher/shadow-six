/**
 * Pain reactions of the top-left talking portraits (docs/talking-portraits.md §9): flinch priority and retrigger,
 * wounded idle below 50 % hp, downed still, reduced motion, mute, and the audio side (grunt first, "I'm hit!" after).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert } from './lib.mjs';
import { TalkingPortraits, PAIN, painState, flinchGate, pickFlinch } from '../../src/ui/talking-portraits.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../assets');
const P = join(ROOT, 'portraits');
const man = JSON.parse(readFileSync(join(P, 'manifest.json'), 'utf8'));

test('pain: every commando has >= 2 flinch clips (rendered from his own grunts), a wounded loop, pain + downed stills', () => {
  for (const [c, e] of Object.entries(man.characters)) {
    const pn = e.pain;
    assert.ok(pn && pn.flinch.length >= 2, `${c}: flinch variants`);
    for (const f of pn.flinch) {
      for (const x of ['webm', 'mp4', 'jpg']) assert.ok(existsSync(join(P, `${f.clip.replace('{size}', '256')}.${x}`)), `${f.clip}.${x}`);
      assert.match(f.rec, /^pain_hit_\d$/);
      assert.ok(f.seconds >= 0.5 && f.seconds <= 1.2, `${c} ${f.rec}: ${f.seconds} s`);
      assert.equal(f.voice, `../audio/voice/${c}/pain/${f.rec}.ogg`, 'the grunt the audio pack plays');
      assert.ok(existsSync(join(P, f.voice)));
    }
    assert.ok(pn.wounded.loop && pn.wounded.seam_ratio <= 2, `${c}: wounded loop seam ${pn.wounded.seam_ratio}`);
    for (const k of ['still', 'downed']) assert.ok(existsSync(join(P, pn[k].replace('{size}', '256'))), `${c}: ${k}`);
    assert.ok(e.lines.i_m_hit && e.lines.i_m_hit.alt, `${c}: "I'm hit!" + urgent take`);
  }
});

test('pain: state = dead / downed / wounded (< 50 % hp) / ok', () => {
  assert.equal(painState(null), 'dead');
  assert.equal(painState({ alive: false, hp: 0, maxHp: 100 }), 'dead');
  assert.equal(painState({ alive: true, hp: 0, maxHp: 100, downed: { t: 60 } }), 'downed');
  assert.equal(painState({ alive: true, hp: 0, maxHp: 100, state: 'downed' }), 'downed');
  assert.equal(painState({ alive: true, hp: 49, maxHp: 100 }), 'wounded');
  assert.equal(painState({ alive: true, hp: 50, maxHp: 100 }), 'ok');
  assert.equal(painState({ alive: true, hp: 59, maxHp: 120 }), 'wounded');
  assert.equal(PAIN.wounded, 0.5);
});

test('pain: flinch gate (hits inside 0.4 s do not restart it, per man) and variant choice', () => {
  const last = new Map(), a = {}, b = {};
  assert.ok(flinchGate(last, a, 10));
  assert.ok(!flinchGate(last, a, 10.2) && !flinchGate(last, a, 10.39), 'repeated hits inside 0.4 s');
  assert.ok(flinchGate(last, b, 10.2), 'another man flinches independently');
  assert.ok(flinchGate(last, a, 10.41), 'after 0.4 s');
  const L = [{ rec: 'pain_hit_1' }, { rec: 'pain_hit_2' }, { rec: 'pain_hit_3' }];
  assert.equal(pickFlinch(L, 'pain_hit_3', L[0]), L[2], 'the clip of the grunt being heard');
  assert.equal(pickFlinch(L, null, L[0]), L[1]);
  assert.equal(pickFlinch(L, null, L[2]), L[0]);
  assert.equal(pickFlinch(L, 'nope', null), L[0]);
  assert.equal(pickFlinch([], 'pain_hit_1', null), null);
});

// ---- module behaviour on stub DOM nodes ------------------------------------------------------------------------
const cls = () => { const s = new Set(); return { add: (k) => s.add(k), remove: (k) => s.delete(k), contains: (k) => s.has(k), has: s }; };
function bus() {
  const m = new Map();
  return { on: (t, fn) => { m.set(t, [...(m.get(t) || []), fn]); return () => {}; }, emit: (t, e) => (m.get(t) || []).forEach((f) => f(e)) };
}
function rig({ reduced = false } = {}) {
  const events = bus();
  const hud = { kit: { reducedMotion: reduced } };
  const tp = new TalkingPortraits({ events, hud, audio: { engine: { voiceSpeakers: new Set() } } });
  tp.man = man; tp.ok = true; tp.fmt = 'webm';
  let now = 100; tp._now = () => now;
  const plays = [];
  tp._play = (unit, char, entry) => { plays.push({ unit, clip: entry?.clip, pain: !!entry?.pain }); tp.cur = { unit, entry }; };
  const face = { classList: cls() };
  const slot = (u, char) => {
    const host = { classList: cls(), hidden: false, closest: () => face, offsetWidth: 1 };
    const idle = { src: '', poster: '', paused: true, play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } };
    const s = { char, host, idle, line: {}, still: { classList: cls(), src: '' }, pulse: {}, img: { src: '', getAttribute() { return this.src; } }, state: painState(u) };
    tp.slots.set(u, s); return s;
  };
  tp._listen();
  return { tp, events, plays, slot, face, tick: (dt) => { now += dt; } };
}
const man1 = (role, hp = 100) => ({ id: role, role, kind: 'commando', alive: true, hp, maxHp: 100 });
const flush = () => new Promise((r) => setTimeout(r, 0));

test('pain: a hit flinches HIS portrait at once, interrupting a select line; the grunt bark picks the variant', async () => {
  const r = rig();
  const tiny = man1('greenberet'), spy = man1('spy');
  const sT = r.slot(tiny, 'green_beret'); r.slot(spy, 'spy');
  r.tp.cur = { unit: spy, entry: { clip: 'spy/yes_sir_{size}' } };             // the Spy is answering a selection
  tiny.hp = 80;
  r.events.emit('bark', { unit: tiny, speaker: 'greenberet', line: 'pain', rec: 'pain_hit_2', take: 'primary', text: '' });
  r.events.emit('unit:damaged', { unit: tiny, amount: 20 });
  await flush();
  assert.equal(r.plays.length, 1, 'the pain bark itself plays no line clip');
  assert.equal(r.plays[0].unit, tiny);
  assert.equal(r.plays[0].clip, 'green_beret/flinch_2_{size}', 'the flinch rendered from the grunt he is heard making');
  assert.ok(r.plays[0].pain);
  assert.ok(sT.host.classList.contains('tp-hit'), 'red edge pulse');
  // repeated hits inside 0.4 s do not restart the flinch
  for (let i = 0; i < 5; i++) { r.tick(0.05); tiny.hp -= 1; r.events.emit('unit:damaged', { unit: tiny, amount: 1 }); }
  await flush();
  assert.equal(r.plays.length, 1, 'no restart every frame');
  r.tick(0.2); r.events.emit('unit:damaged', { unit: tiny, amount: 1 }); await flush();
  assert.equal(r.plays.length, 2, 'a hit after 0.4 s flinches again');
  assert.notEqual(r.plays[1].clip, r.plays[0].clip, 'with another variant');
  // enemies and dead men do not flinch
  r.tick(1); r.events.emit('unit:damaged', { unit: { kind: 'enemy', role: 'soldier', alive: true, hp: 5 } }); await flush();
  assert.equal(r.plays.length, 2);
});

test('pain: below 50 % hp his idle is the wounded loop (and back after first aid); downed shows the downed still', async () => {
  const r = rig();
  const duke = man1('sniper');
  const s = r.slot(duke, 'sniper');
  r.tp._selected({ units: [duke] });
  assert.match(s.idle.src, /sniper\/idle_256\.webm$/);
  assert.ok(!s.idle.paused, 'selected: idle plays');
  duke.hp = 40; r.events.emit('unit:damaged', { unit: duke, amount: 60 }); await flush();
  assert.equal(s.state, 'wounded');
  assert.match(s.idle.src, /sniper\/wounded_256\.webm$/, 'wounded loop');
  assert.ok(!s.idle.paused, 'still the one idle decode');
  assert.match(s.img.src, /wounded_256\.jpg$/, 'static face follows');
  duke.hp = 90; r.events.emit('ability:end', { unit: { role: 'driver' }, id: 'firstAid' });
  assert.match(s.idle.src, /sniper\/idle_256\.webm$/, 'healed: normal idle');
  duke.hp = 0; duke.downed = { t: 60 }; r.events.emit('unit:downed', { unit: duke });
  assert.equal(s.state, 'downed');
  assert.ok(s.still.classList.contains('on') && /sniper\/downed_256\.jpg$/.test(s.still.src), 'downed still');
  assert.ok(s.idle.paused);
  const n = r.plays.length; r.tick(1); r.events.emit('unit:damaged', { unit: duke, amount: 5 }); await flush();
  assert.equal(r.plays.length, n, 'a downed man keeps his still');
  duke.downed = null; duke.hp = 20; r.events.emit('unit:revived', { unit: duke });
  assert.equal(s.state, 'wounded'); assert.ok(!s.still.classList.contains('on'));
});

test('pain: reduced motion shows the pain still (no video); mute does not matter (the face reacts to the hit event)', async () => {
  const r = rig({ reduced: true });
  const fins = man1('diver');
  const s = r.slot(fins, 'marine');
  fins.hp = 70; r.events.emit('unit:damaged', { unit: fins, amount: 30 }); await flush();
  assert.equal(r.plays.length, 0, 'no flinch video');
  assert.ok(s.still.classList.contains('on') && /marine\/pain_256\.jpg$/.test(s.still.src), 'pain still');
  assert.ok(r.face.classList.contains('tp-talking'), 'in colour while it shows');
  await new Promise((res) => setTimeout(res, PAIN.still * 1000 + 50));
  assert.ok(!s.still.classList.contains('on') && !r.face.classList.contains('tp-talking'), 'then back');
});
