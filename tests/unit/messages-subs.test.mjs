/**
 * Bark subtitle tags (§6.5, ui/messages): a tag is centred over its speaker's head, and two men talking
 * face to face — the Spy distracting a guard (§3.4), the guard answering — stand 1.5 m apart, so their
 * tags used to land in the same band and cover each other (76×7 px measured in the real conversation).
 * _place now stacks the later speaker's tag above the first one's. These tests pin the two tags' screen
 * rectangles apart for that conversation, and pin that a lone tag and distant speakers keep the original
 * head-centred slot. The DOM is stubbed with just what ui/dom + Messages touch; the tag boxes are given
 * the sizes a browser measured for this pair at 720p (169×23 the Spy's line, 169×40 the glossed reply).
 */
import { test, assert } from './lib.mjs';
import { Messages } from '../../src/ui/messages.js';

function stubEl() {
  return {
    children: [], style: {}, dataset: {}, className: '', textContent: '', hidden: false,
    classList: { _s: new Set(), add(...c) { c.forEach((x) => this._s.add(x)); }, remove(...c) { c.forEach((x) => this._s.delete(x)); }, contains(c) { return this._s.has(c); } },
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; },
    offsetWidth: 0, offsetHeight: 0,
  };
}

const PPM = 47; // px per metre at the repro zoom: the two heads land 1.5 m * 47 ≈ 70 px apart
function makeMessages() {
  globalThis.document = { createElement: () => stubEl() };
  const hud = {
    root: stubEl(), clock: 0,
    options: { subtitles: true, voice: 'on' },
    topbar: { speak() {} },
    game: { cameraController: { worldToScreen: (x) => ({ x: 640 + (x - 64) * PPM, y: 300 }) } },
  };
  return new Messages(hud);
}

/** The on-screen rectangle of a placed tag, from its transform (translate(-50%, -100%) over the anchor). */
function rectOf(t) {
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(t.el.style.transform);
  assert.ok(m, 'tag placed: ' + t.el.style.transform);
  const tx = +m[1], ty = +m[2], w = t.el.offsetWidth, h = t.el.offsetHeight;
  return { x0: tx - w / 2, x1: tx + w / 2, top: ty - h, bot: ty };
}
const intersects = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.top < b.bot && b.top < a.bot;

test('messages: the Spy and the guard he distracts get subtitle tags that do not overlap', () => {
  const msgs = makeMessages();
  try {
    const spy = { role: 'spy', faction: 'player', x: 65.5, z: 96 };
    const foe = { faction: 'enemy', x: 64, z: 96 };
    // the exact payload pair the conversation produces (the §3.4 line + the stamped German reply)
    msgs.bark({ unit: spy, text: 'Spooky: "Guten Tag, Soldat…"' });
    msgs.bark({ unit: foe, text: 'Alles ruhig, Herr Hauptmann.', gloss: 'All quiet, Captain.', german: true });
    msgs.tags[0].el.offsetWidth = 169; msgs.tags[0].el.offsetHeight = 23;
    msgs.tags[1].el.offsetWidth = 169; msgs.tags[1].el.offsetHeight = 40;
    msgs.update();
    assert.equal(msgs.tags.length, 2);
    const [a, b] = msgs.tags.map(rectOf);
    assert.ok(!intersects(a, b), `tags overlap: ${JSON.stringify([a, b])}`);
    assert.ok(b.bot <= a.top, 'the second speaker stacks above the first');
    assert.equal(a.bot, 300, 'the first speaker keeps the head-centred slot');
  } finally { delete globalThis.document; }
});

test('messages: a lone tag and distant speakers keep the original slot (no lift)', () => {
  const msgs = makeMessages();
  try {
    const a = { role: 'sapper', faction: 'player', x: 54, z: 10 };
    const b = { faction: 'enemy', x: 74, z: 10 };
    msgs.bark({ unit: a, text: 'On it.' });
    msgs.tags[0].el.offsetWidth = 60; msgs.tags[0].el.offsetHeight = 18;
    msgs.update();
    assert.equal(rectOf(msgs.tags[0]).bot, 300, 'lone tag sits on its anchor');
    msgs.bark({ unit: b, text: 'Halt!', gloss: 'Stop!', german: true });
    msgs.tags[1].el.offsetWidth = 60; msgs.tags[1].el.offsetHeight = 30;
    msgs.update();
    assert.equal(rectOf(msgs.tags[1]).bot, 300, 'a speaker 20 m away is not lifted');
  } finally { delete globalThis.document; }
});
