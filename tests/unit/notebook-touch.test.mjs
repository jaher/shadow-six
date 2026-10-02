import { test, assert } from './lib.mjs';
import { NotebookFingers, isFingerPointer, NB_TOUCH } from '../../src/ui/notebook-touch.js';

/** Drive the machine like Notebook does: apply open / close to a local flag, collect every action. */
function rig(open = false) {
  const f = new NotebookFingers();
  const s = { open, log: [] };
  const act = (list) => {
    for (const a of list) {
      s.log.push(a);
      if (a.type === 'open') s.open = true;
      if (a.type === 'close') s.open = false;
    }
  };
  s.down = (id, x, y) => act(f.down(id, x, y, s.open));
  s.move = (id, x, y) => act(f.move(id, x, y, s.open));
  s.up = (id, x, y) => act(f.up(id, x, y, s.open));
  s.cancel = (id) => act(f.cancel(id));
  s.f = f;
  return s;
}
const types = (s) => s.log.map((a) => a.type);

test('notebook-touch: fingers and pens toggle, a mouse hovers', () => {
  assert.equal(isFingerPointer({ pointerType: 'touch' }), true);
  assert.equal(isFingerPointer({ pointerType: 'pen' }), true);
  assert.equal(isFingerPointer({ pointerType: 'mouse' }), false);
  assert.equal(isFingerPointer(null), false);
});

test('notebook-touch: a tap opens the closed notebook and it stays open after the finger lifts', () => {
  const s = rig(false);
  s.down(1, 100, 50);
  assert.equal(s.open, false, 'nothing happens while the finger is down');
  s.up(1, 101, 51);
  assert.equal(s.open, true, 'open after the lift');
  assert.deepEqual(types(s), ['open']);
  // no more events: it stays open (no timer, no leave)
  assert.equal(s.open, true);
});

test('notebook-touch: a tap on the open notebook closes it again', () => {
  const s = rig(false);
  s.down(1, 100, 50);
  s.up(1, 100, 50);
  s.down(2, 60, 80);
  s.move(2, 64, 83); // a wobble under tapPx is still a tap
  s.up(2, 64, 83);
  assert.equal(s.open, false);
  assert.deepEqual(types(s), ['open', 'close']);
});

test('notebook-touch: a long still hold is still a tap (no hold-to-peek)', () => {
  const s = rig(true);
  s.down(1, 10, 10);
  s.up(1, 10, 10); // however long it was held
  assert.equal(s.open, false);
});

test('notebook-touch: a drag on the open map moves the view and never closes it', () => {
  const s = rig(true);
  s.down(1, 100, 100);
  s.move(1, 104, 100);
  assert.deepEqual(s.log, [], 'under tapPx: no pan yet');
  s.move(1, 100 + NB_TOUCH.tapPx + 5, 100);
  s.move(1, 130, 110);
  s.up(1, 130, 110);
  assert.equal(s.open, true, 'still open');
  assert.deepEqual(types(s), ['pan', 'pan']);
  const sum = s.log.reduce((a, p) => ({ dx: a.dx + p.dx, dy: a.dy + p.dy }), { dx: 0, dy: 0 });
  assert.deepEqual(sum, { dx: 30, dy: 10 }, 'the view follows the finger the whole way from where it landed');
});

test('notebook-touch: a sloppy tap (a short slide) on the closed strip still opens it, without panning', () => {
  const s = rig(false);
  s.down(1, 100, 100);
  s.move(1, 100, 130);
  s.up(1, 100, 130);
  assert.deepEqual(types(s), ['open']);
});

test('notebook-touch: a pinch on the open notebook zooms the sketch and never closes it', () => {
  const s = rig(true);
  s.down(1, 100, 100);
  s.down(2, 140, 100);
  s.move(2, 180, 100); // spread 40 → 80
  const z = s.log.filter((a) => a.type === 'zoom');
  assert.equal(z.length, 1);
  assert.ok(Math.abs(z[0].k - 2) < 1e-9, `k=${z[0].k}`);
  s.up(2, 180, 100);
  s.move(1, 160, 100); // the finger left after a pinch neither pans nor taps
  s.up(1, 160, 100);
  assert.equal(s.open, true);
  assert.deepEqual(types(s), ['zoom']);
});

test('notebook-touch: a pinch on the closed strip does nothing; a third finger is ignored', () => {
  const s = rig(false);
  s.down(1, 100, 100);
  s.down(2, 120, 100);
  s.down(3, 140, 100);
  assert.equal(s.f.count, 2);
  s.move(2, 160, 100);
  s.up(1, 100, 100);
  s.up(2, 160, 100);
  s.up(3, 140, 100);
  assert.deepEqual(s.log, []);
  assert.equal(s.open, false);
});

test('notebook-touch: a cancelled touch (the browser took it) neither opens nor closes', () => {
  const s = rig(false);
  s.down(1, 100, 100);
  s.cancel(1);
  s.up(1, 100, 100);
  assert.deepEqual(s.log, []);
  const o = rig(true);
  o.down(5, 1, 1);
  o.cancel(5);
  assert.equal(o.open, true);
});
