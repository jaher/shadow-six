/** engine/device.js: mobile devices default to a mobile preset; desktop and explicit choices are unchanged. */
import { test, assert } from './lib.mjs';
import { bootPreset, mobilePreset } from '../../src/engine/device.js';

test('desktop (fine pointer, desktop GPU) keeps the default preset', () => {
  assert.equal(mobilePreset({ touch: false, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070)' }), null);
  assert.equal(mobilePreset({ touch: false, gpu: 'Apple GPU' }), null); // a Mac
  assert.equal(bootPreset({ touch: false, gpu: 'ANGLE (Intel, Iris Xe)' }), null);
});

test('touch-first devices start on medium; weak mobile GPUs on low', () => {
  assert.equal(mobilePreset({ touch: true, gpu: '' }), 'medium');
  assert.equal(mobilePreset({ touch: true, gpu: 'Apple GPU' }), 'medium');
  assert.equal(mobilePreset({ touch: true, gpu: 'Adreno (TM) 740' }), 'medium');
  assert.equal(mobilePreset({ touch: true, gpu: 'Mali-G710 MC10' }), 'medium');
  assert.equal(mobilePreset({ touch: true, gpu: 'Adreno (TM) 618' }), 'low');
  assert.equal(mobilePreset({ touch: true, gpu: 'Mali-G52 MC2' }), 'low');
  assert.equal(mobilePreset({ touch: true, gpu: 'PowerVR Rogue GE8320' }), 'low');
  assert.equal(mobilePreset({ touch: false, gpu: 'Adreno (TM) 650' }), 'medium'); // mobile GPU, mouse attached
});

test('?preset= and a quality chosen in OPTIONS win over the mobile default', () => {
  assert.equal(bootPreset({ param: 'ultra', touch: true }), 'ultra');
  assert.equal(bootPreset({ touch: true, options: { preset: 'high', presetChosen: true } }), 'high');
  assert.equal(bootPreset({ touch: true, options: { preset: 'high', presetChosen: false } }), 'medium');
  assert.equal(bootPreset({ touch: false, options: { preset: 'low', presetChosen: true } }), null); // desktop: unchanged
});
