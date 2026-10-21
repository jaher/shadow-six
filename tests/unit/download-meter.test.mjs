/**
 * Download meter (src/engine/download-meter.js): the loading screen's live figures — MB downloaded / to go,
 * smoothed bandwidth over a trailing window, ETA — from actual counted bytes. The rate must stay null until
 * the window holds ~1 s of data, must reflect the window (not an instantaneous spike), and the formatted line
 * must drop segments whose inputs are genuinely unknown instead of inventing numbers.
 */
import { test, assert } from './lib.mjs';
import { DownloadMeter, formatDownload, formatEta } from '../../src/engine/download-meter.js';

/** A meter on a hand-driven clock. */
function clocked() {
  let t = 0;
  const m = new DownloadMeter(() => t);
  return { m, at: (ms) => { t = ms; } };
}

test('download-meter: rate is null until the window holds a second of data', () => {
  const { m, at } = clocked();
  at(0); m.add(5e6);
  assert.equal(m.rate(), null, 'one sample: no rate');
  at(600); m.add(3e6);
  assert.equal(m.rate(), null, '600 ms span: still not meaningful');
  assert.equal(m.eta(), null);
  at(1100); m.add(1e6);
  assert.ok(m.rate() > 0, 'past a second of samples the rate appears');
});

test('download-meter: rate is the trailing-window delta, eta is remaining / rate', () => {
  const { m, at } = clocked();
  at(0); m.note(0, 20e6);
  at(1000); m.note(4e6, 20e6);
  at(2000); m.note(8e6, 20e6);
  assert.equal(m.rate(), 4e6, '8 MB over 2 s');
  assert.equal(m.eta(), 3, '(20 - 8) MB at 4 MB/s');
  // an old fast burst falls out of the window: only the last ~3 s count
  at(10000); m.note(9e6, 20e6);
  at(11000); m.note(10e6, 20e6);
  assert.equal(m.rate(), 1e6, 'the recent 1 MB/s, not the load average');
});

test('download-meter: add/addTotal accumulate the pack feed', () => {
  const { m, at } = clocked();
  m.active = true;
  at(0); m.addTotal(44e6); m.add(10e6);
  at(1000); m.addTotal(40e6); m.add(32e6);
  assert.equal(m.bytes, 42e6);
  assert.equal(m.total, 84e6);
  assert.equal(m.rate(), 32e6);
  assert.equal(m.eta(), (84e6 - 42e6) / 32e6);
});

test('download-meter: formatEta renders an m:ss clock', () => {
  assert.equal(formatEta(0), '0:00');
  assert.equal(formatEta(9), '0:09');
  assert.equal(formatEta(69.4), '1:09');
  assert.equal(formatEta(600), '10:00');
});

test('download-meter: the line shows all four figures when everything is known', () => {
  const { m, at } = clocked();
  at(2500); m.note(4.2e6, 83.7e6);
  at(3500); m.note(12.4e6, 83.7e6); // +8.2 MB in the last second
  assert.equal(formatDownload(m), '12.4 MB downloaded · 71.3 MB to go · 8.2 MB/s · ~0:09 left');
});

test('download-meter: unknown total drops to-go and ETA; early rate drops rate and ETA', () => {
  const { m, at } = clocked();
  at(0); m.note(3e6, null);
  at(2000); m.note(9e6, null);
  assert.equal(formatDownload(m), '9.0 MB downloaded · 3.0 MB/s', 'no total: no to-go, no ETA');
  const early = clocked();
  early.at(0); early.m.note(2e6, 50e6);
  assert.equal(formatDownload(early.m), '2.0 MB downloaded · 48.0 MB to go', 'first instant: no rate, no ETA yet');
});

test('download-meter: downloaded clamps at the total and to-go never goes negative', () => {
  const { m, at } = clocked();
  at(0); m.note(0, 10e6);
  at(2000); m.note(12e6, 10e6); // observer overshoot (encoded sizes): the line must stay sane
  const s = formatDownload(m);
  assert.ok(s.startsWith('10.0 MB downloaded · 0.0 MB to go'), s);
});
