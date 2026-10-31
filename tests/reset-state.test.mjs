/**
 * renderer.resetState() leaves three's pixel-store cache knowing what the reset set (engine/renderer.js
 * keepPixelStoreKnown). engine/gpu-compress.js resets three's state after its own GL work — every HD encode band while
 * the game is played, every upload — and three's reset forgot the pixel-store parameters it had just set to their
 * defaults: the next partial texture update (updateRanges: the VFX particle pool's data texture, every frame while smoke
 * or dust is live) read them back with gl.getParameter, a synchronous round trip that waits for the GPU to finish all it
 * was given. At the start of M12's walkthrough that held a frame 97 ms behind an HD texture encode (CPU profile:
 * getParameter < updateTexture < uploadTexture < setProgram).
 */
export const timeout = 60_000;

export default async function resetState(page, t) {
  const r = await page.evaluate(async () => {
    const THREE = await import('three');
    const R = window.__game.game.renderer.renderer, gl = R.getContext();
    const W = 64, H = 4;
    const tex = new THREE.DataTexture(new Float32Array(W * H * 4).fill(0.5), W, H, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const geo = new THREE.PlaneGeometry(2, 2);
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geo, mat));
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    cam.position.z = 1;
    const target = new THREE.WebGLRenderTarget(16, 16);
    const prevT = R.getRenderTarget();
    const names = ['UNPACK_ROW_LENGTH', 'UNPACK_IMAGE_HEIGHT', 'UNPACK_SKIP_PIXELS', 'UNPACK_SKIP_ROWS', 'UNPACK_SKIP_IMAGES'];
    const asked = [];
    const gp = gl.getParameter;
    const draw = () => { R.setRenderTarget(target); R.render(scene, cam); R.setRenderTarget(prevT); };
    // a partial update of a row: what the VFX pool does for each dirty row (three: updateTexture with updateRanges)
    const partial = () => { tex.addUpdateRange(W * 4 + 8, 16); tex.needsUpdate = true; draw(); };
    try {
      draw(); // (the first upload: the whole texture)
      gl.getParameter = function (p) { const k = names.find((n) => gl[n] === p); if (k) asked.push(k); return gp.call(this, p); };
      R.resetState();
      partial();
      const afterReset = asked.length;
      partial();
      return { afterReset, total: asked.length, asked: [...new Set(asked)], rowLen: R.state.getParameter(gl.UNPACK_ROW_LENGTH), err: gl.getError() };
    } finally {
      gl.getParameter = gp;
      tex.dispose(); mat.dispose(); geo.dispose(); target.dispose();
    }
  });
  t.log(JSON.stringify(r));
  t(r.afterReset === 0, `a partial texture update right after renderer.resetState() reads no pixel-store parameter back from the context (asked ${r.afterReset}: ${r.asked.join(', ')})`);
  t(r.total === 0, `nor the next one (${r.total} in all)`);
  t(r.rowLen === 0, `three's cache holds the default row length after the update (${r.rowLen})`);
  t(r.err === 0, `no GL error (${r.err})`);
}
