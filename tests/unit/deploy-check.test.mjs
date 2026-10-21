/**
 * engine/deploy-check: reload-on-new-deploy. The decision is pure; the check wires it to fetch +
 * sessionStorage + location.reload with injectables, so all of it is covered here without a browser.
 */
import { test, assert } from './lib.mjs';
import { RELOAD_KEY, checkForNewDeploy, deployDecision, installDeployCheck, runningBuild } from '../../src/engine/deploy-check.js';

const store = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
};
const fetchReturning = (info, calls = [], ok = true) => async (url, init) => {
  calls.push({ url, init });
  return { ok, status: ok ? 200 : 404, json: async () => info };
};
const flush = () => new Promise((r) => setImmediate(r));

test('runningBuild reads window.__SS_BUILD__.v, null without a stamp', () => {
  assert.equal(runningBuild({ __SS_BUILD__: { v: 'abc123' } }), 'abc123');
  assert.equal(runningBuild({}), null);
  assert.equal(runningBuild({ __SS_BUILD__: { v: '' } }), null);
  assert.equal(runningBuild({ __SS_BUILD__: null }), null);
});

test('deployDecision: skip / current / reload / loop-guard', () => {
  assert.equal(deployDecision(null, 'b2', null), 'skip');
  assert.equal(deployDecision('a1', null, null), 'skip');
  assert.equal(deployDecision('a1', 'a1', null), 'current');
  assert.equal(deployDecision('a1', 'b2', null), 'reload');
  assert.equal(deployDecision('a1', 'b2', 'b2'), 'loop-guard');
  assert.equal(deployDecision('a1', 'b2', 'a1'), 'reload', 'a guard for another build does not block');
});

test('check: matching version -> current, no reload, version.json fetched no-store', async () => {
  const calls = []; let reloads = 0;
  const r = await checkForNewDeploy({
    running: 'a1', storage: store(), reload: () => reloads++,
    fetch: fetchReturning({ short: 'a1', sha: 'a1full' }, calls),
    url: 'http://x/shadow-six/version.json',
  });
  assert.equal(r, 'current');
  assert.equal(reloads, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.cache, 'no-store');
});

test('check: new deploy -> exactly one reload, guard records the target build', async () => {
  const s = store(); let reloads = 0;
  const o = { running: 'a1', storage: s, reload: () => reloads++, fetch: fetchReturning({ short: 'b2' }), url: 'http://x/version.json' };
  assert.equal(await checkForNewDeploy(o), 'reloaded');
  assert.equal(reloads, 1);
  assert.equal(s.getItem(RELOAD_KEY), 'b2');
  // the reloaded page somehow still runs the old build (edge mid-deploy): no second reload
  assert.equal(await checkForNewDeploy(o), 'loop-guard');
  assert.equal(reloads, 1);
});

test('check: an older served build (rollback deploy) is also a change -> reload', async () => {
  let reloads = 0;
  const r = await checkForNewDeploy({ running: 'b2', storage: store(), reload: () => reloads++, fetch: fetchReturning({ short: 'a1' }), url: 'http://x/version.json' });
  assert.equal(r, 'reloaded');
  assert.equal(reloads, 1);
});

test('check: version.json missing (404) or unfetchable -> skip, never a reload, never a throw', async () => {
  let reloads = 0;
  const base = { running: 'a1', storage: store(), reload: () => reloads++, url: 'http://x/version.json' };
  assert.equal(await checkForNewDeploy({ ...base, fetch: fetchReturning(null, [], false) }), 'skip');
  assert.equal(await checkForNewDeploy({ ...base, fetch: async () => { throw new Error('offline'); } }), 'skip');
  assert.equal(await checkForNewDeploy({ ...base, fetch: fetchReturning({}) }), 'skip', 'a version.json without a build stamp is no check');
  assert.equal(reloads, 0);
});

test('check: no build stamp (dev server) -> skip without any fetch', async () => {
  const calls = [];
  const r = await checkForNewDeploy({ running: null, storage: store(), fetch: fetchReturning({ short: 'b2' }, calls), url: 'http://x/version.json' });
  assert.equal(r, 'skip');
  assert.equal(calls.length, 0);
});

const emitter = (extra = {}) => ({
  listeners: new Map(),
  addEventListener(t, fn) { (this.listeners.get(t) || this.listeners.set(t, []).get(t)).push(fn); },
  removeEventListener(t, fn) { const a = this.listeners.get(t) || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
  fire(t) { for (const fn of [...(this.listeners.get(t) || [])]) fn(); },
  ...extra,
});

test('install: boot check, re-check on visible/focus only, uninstall stops it', async () => {
  const calls = [];
  const doc = emitter({ visibilityState: 'visible' });
  const win = emitter();
  const off = installDeployCheck({
    global: {}, document: doc, window: win,
    running: 'a1', storage: store(), reload: () => {},
    fetch: fetchReturning({ short: 'a1' }, calls), url: 'http://x/version.json',
  });
  await flush();
  assert.equal(calls.length, 1, 'boot check ran');
  doc.visibilityState = 'hidden'; doc.fire('visibilitychange'); await flush();
  assert.equal(calls.length, 1, 'no check while hidden');
  doc.visibilityState = 'visible'; doc.fire('visibilitychange'); await flush();
  assert.equal(calls.length, 2, 'check on becoming visible');
  win.fire('focus'); await flush();
  assert.equal(calls.length, 3, 'check on focus');
  off();
  doc.fire('visibilitychange'); win.fire('focus'); await flush();
  assert.equal(calls.length, 3, 'uninstalled: no more checks');
});
