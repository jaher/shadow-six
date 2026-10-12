/**
 * Debug mode off: without ?debug (test page, a ?mission deep link, ?debug=0) there is no debug UI or game.debug, and the
 * WebGL2 prototype is untouched (no GPU memory counter).
 * README "Debug mode", design-spec §10.7. Split in five files so each stays well inside the 90 s per-test budget.
 */
export default async function debugAbsent(page, t) {
  const url = t.harness.url;
  const T0 = Date.now();
  const step = (n) => t.log(`${n} @${((Date.now() - T0) / 1000).toFixed(1)} s`);
  const absent = () => page.evaluate(() => ({
    overlay: !!document.getElementById('dbg-select'), btn: !!document.getElementById('dbg-btn'),
    info: !!document.getElementById('dbg-info'), debug: window.shadowSix?.debug ?? null,
    // the info HUD's GPU memory counter (src/debug/gpu-mem-counter.js) wraps WebGL2 calls only under ?debug
    gl: /\[native code\]/.test(WebGL2RenderingContext.prototype.texStorage2D.toString()) && /\[native code\]/.test(WebGL2RenderingContext.prototype.bufferData.toString())
      && !WebGL2RenderingContext.prototype[Symbol.for('shadowsix.gpuMemCounter')],
  }));
  // 1. no debug param: no trace of it (test page, then a normal deep link)
  let a = await absent();
  t(!a.overlay && !a.btn && !a.info && a.debug === null && a.gl, `no debug UI without ?debug (${JSON.stringify(a)})`);
  await page.goto(`${url}/index.html?mission=m00`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
  a = await absent();
  t(!a.overlay && !a.btn && !a.info && a.debug === null && a.gl, 'no debug UI (nor GL counter) on ?mission without ?debug');

  await page.goto(`${url}/index.html?debug=0`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
  a = await absent();
  t(!a.overlay && !a.btn && !a.info && a.debug === null && a.gl, '?debug=0 is off');
}
