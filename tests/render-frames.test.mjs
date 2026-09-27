/**
 * Renderer upgrade (realism-pipeline §3.3/§3.9, design-spec §2.4): CI frame-stats smoke (no NaN/black frames:
 * mean luminance 25–200, per-channel std > 15, context alive) for M1–M3 by day, zoomed in, on ultra, a night
 * frame and a frame with NaN-emitting geometry (SanitizePass); per-mission lighting (HDRI, NW sun, LUT);
 * X-ray silhouettes for commandos behind a building (never for enemies); post-hook slots.
 */
const ok = (f) => f && !f.contextLost && f.luma > 25 && f.luma < 200 && f.std.every((s) => s > 15);

export default async function renderFrames(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const G = g.game;
    const R = G.renderer;
    const THREE = await import('three');
    const out = { frames: {}, lighting: {} };
    for (const id of ['m01', 'm02', 'm03']) {
      await g.loadMission(id);
      g.start();
      g.setPreset('high');
      out.frames[id] = g.frameStats();
      out.lighting[id] = g.renderStats().lighting;
    }
    // zoomed in / ultra / ACES option (on M3)
    g.setZoom(2);
    out.frames.zoom2 = g.frameStats();
    g.setZoom(1);
    g.setPreset('ultra');
    out.frames.ultra = g.frameStats();
    out.ultraPasses = g.renderStats().passes;
    R.setToneMapping('aces');
    out.frames.aces = g.frameStats();
    R.setToneMapping('agx');
    out.agx = R.renderer.toneMapping === THREE.AgXToneMapping;
    g.setPreset('high');
    // NaN-emitting geometry: SanitizePass must keep bloom from spreading it over the frame
    const nanMat = new THREE.ShaderMaterial({ uniforms: { z: { value: 0 } }, vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'uniform float z; void main(){ gl_FragColor = vec4(vec3(z / z), 1.0); }' });
    const cc = G.cameraController;
    const c0 = G.world.commandos[0];
    const nan = new THREE.Mesh(new THREE.PlaneGeometry(3, 3).rotateX(-Math.PI / 2), nanMat);
    nan.position.set(c0.x + 3, 0.3, c0.z);
    R.scene.add(nan);
    g.centerOn(c0.x, c0.z);
    out.frames.nan = g.frameStats();
    R.scene.remove(nan);
    // night variant (optional theater): moonlit HDRI, blue grade
    await R.applyMissionLighting({ theater: 'night' }, { assets: (await import('/src/engine/assets.js')).assets });
    out.frames.night = g.frameStats();
    out.lighting.night = g.renderStats().lighting;

    // X-ray: M2 barracks (40,24; 12×6×4.5 m) — a commando and an enemy just north of it are hidden from the camera
    await g.loadMission('m02');
    g.start();
    g.setPreset('high');
    const W = G.world;
    const cm = W.commandos[0];
    const en = W.enemies.find((e) => e.alive);
    cm.setPosition(38, 19.6);
    en.setPosition(42.5, 19.6);
    en.brain && (en.brain.frozen = true);
    g.setZoom(1);
    g.centerOn(40, 26);
    const gl = R.renderer.getContext();
    // dy: vertical pixel offset — the commando is sampled on a short strip (the rigged body's silhouette does not
    // always cover the single pixel at 0.9 m, e.g. on the ground's undulation); the enemy stays a single pixel
    const px = (e, dy = 0, dx = 0) => {
      const s = cc.worldToScreen(e.x, 0.9, e.z);
      const k = gl.drawingBufferWidth / R.domElement.clientWidth;
      const rect = R.domElement.getBoundingClientRect();
      const x = Math.round((s.x - rect.left) * k) + dx, y = Math.round(gl.drawingBufferHeight - (s.y - rect.top) * k) + dy;
      const a = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a);
      return [...a.slice(0, 3)];
    };
    g.render();
    const strip = Array.from({ length: 51 }, (_, k) => [-24 + (k % 17) * 2, -2 + 2 * Math.floor(k / 17)]);
    const cmOn = strip.map(([dy, dx]) => px(cm, dy, dx));
    const on = { cm: px(cm), en: px(en), drawn: R.passes.xray?.drawn };
    R.passes.xray.enabled = false;
    g.render();
    const off = { cm: px(cm), en: px(en) };
    const cmOff = strip.map(([dy, dx]) => px(cm, dy, dx));
    const dd = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    const kBest = cmOn.reduce((kb, v, k) => (dd(v, cmOff[k]) > dd(cmOn[kb], cmOff[kb]) ? k : kb), 0);
    on.cm = cmOn[kBest]; off.cm = cmOff[kBest]; on.dy = strip[kBest];
    R.passes.xray.enabled = true;
    out.xray = { on, off };

    // post hooks: afterWorld before AO, afterAO after it; removal rebuilds the chain
    const { ShaderPass } = await import('three/addons/postprocessing/ShaderPass.js');
    const { CopyShader } = await import('three/addons/shaders/CopyShader.js');
    const mk = (n) => () => { const p = new ShaderPass(CopyShader); p.name = n; return p; };
    const un1 = R.addPostHook('afterWorld', mk('hookW'));
    const un2 = R.addPostHook('afterAO', mk('hookA'));
    const names = R.composer.passes.map((p) => p.name || p.constructor.name);
    out.hooks = { names, frame: g.frameStats() };
    un1(); un2();
    out.hooks.after = R.composer.passes.map((p) => p.name || p.constructor.name);
    let bad = null;
    try { R.addPostHook('nope', mk('x')); } catch (e) { bad = e.message; }
    out.hooks.bad = bad;
    return out;
  });
  for (const [k, f] of Object.entries(r.frames)) {
    t.log(k, JSON.stringify(f));
    t(ok(f), `${k}: valid frame (luma ${f.luma}, std ${f.std}, lost ${f.contextLost})`);
    t(f.black < 0.2, `${k}: no black-frame spread (${f.black})`);
  }
  t(r.agx, 'AgX is the default tone mapping (ACES stays an option)');
  t(r.ultraPasses.includes('SanitizePass') && r.ultraPasses.includes('LUTPass') && r.ultraPasses.includes('XRayPass'), `ultra chain: ${r.ultraPasses}`);
  for (const id of ['m01', 'm02', 'm03']) {
    const L = r.lighting[id];
    t.equal(L.hdri, 'overcast_snow', `${id}: overcast snow HDRI`);
    t(L.hdrLoaded, `${id}: HDRI loaded`);
    t.equal(L.lut, 'norway', `${id}: norway LUT`);
    t(L.sunDir[0] < 0 && L.sunDir[2] < 0, `${id}: sun in the NW (${L.sunDir})`);
    t(L.sunElevation >= 12 && L.sunElevation <= 20, `${id}: Norway sun 12–20° (${L.sunElevation})`);
    t(L.envIntensity > 0.03 && L.envIntensity < 3, `${id}: auto env intensity ${L.envIntensity}`);
  }
  t.equal(r.lighting.m01.fog[1] > r.lighting.m01.fog[0], true, 'M1 fog from the mission file');
  t.equal(r.lighting.night.hdri, 'night', 'night theater uses the moonlit HDRI');
  const d = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  t.log('xray', JSON.stringify(r.xray));
  t(r.xray.on.drawn >= 1, 'x-ray pass drew the commandos');
  t(d(r.xray.on.cm, r.xray.off.cm) > 12, `hidden commando is x-rayed (${r.xray.on.cm} vs ${r.xray.off.cm})`);
  t(r.xray.on.cm[1] >= r.xray.on.cm[2], 'silhouette is the muted green team colour');
  t(d(r.xray.on.en, r.xray.off.en) <= 3, `hidden enemy is NOT x-rayed (${r.xray.on.en} vs ${r.xray.off.en})`);
  const n = r.hooks.names;
  t(n.indexOf('hookW') > n.indexOf('RenderPass') && n.indexOf('hookW') < n.indexOf('AlphaAwareGTAOPass'), `afterWorld slot before AO: ${n}`);
  t(n.indexOf('hookA') > n.indexOf('AlphaAwareGTAOPass') && n.indexOf('hookA') < n.indexOf('SanitizePass'), 'afterAO slot after AO, before the sanitizer');
  t(ok(r.hooks.frame), 'frame valid with hooks');
  t(!r.hooks.after.includes('hookW') && !r.hooks.after.includes('hookA'), 'unhook removes the passes');
  t(/unknown post hook slot/.test(r.hooks.bad || ''), 'unknown slot throws');
}
