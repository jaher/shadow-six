/**
 * The first frames after a mission load: does any surface draw darker than it settles to?
 *
 * A material texture loaded in the background (engine/texture-memory.js loadCompressedTexture: the image, then its
 * GPU compression, engine/gpu-compress.js) stays un-uploaded (version 0) until both are done; three draws it as an
 * empty texture meanwhile — the surface comes out dark (M11's gravel ramp: 100–120 frames on a loaded host).
 * Two measures, from `mission:loaded` on (the loading card fading out over the first of them):
 *  - dark draws: every draw whose material samples a version-0 texture (its slots and its shader uniforms), by frame;
 *  - surfaces: the mean luminance of a small screen patch on a named surface (the camera centred on it once it exists),
 *    each frame, against its settled value (the median of the last frames).
 *
 *   node tools/perf/first-frames.mjs --mission=m11 [--root=<checkout>] [--frames=240] [--surface=dressing:gravel@m11:terrain]
 *
 * The page probe (firstFramesProbe) and the run (firstFrames) are shared with tests/load-textures.test.mjs.
 * @module tools/perf/first-frames
 */

/** Surfaces watched per mission: material name @ an ancestor's name (the mission scenery group), the way up. */
export const SURFACES = {
  m11: [{ id: 'M11 gravel ramp', mat: 'dressing:gravel', under: 'm11:terrain', up: true }],
  m12: [{ id: 'M12 ashlar platform', mat: 'dressing:ashlar', under: 'm12:platform' }],
  m08: [{ id: 'M8 gravel wadi', mat: 'dressing:gravel', under: 'm08:terrain', up: true }],
};

/**
 * In the page from its first line (addInitScript). @param {{surfaces: object[], frames: number}} o
 */
export function firstFramesProbe(o) {
  const P = (window.__ff = { dark: {}, darkFrames: [], frames: 0, loadedAt: 0, done: false, surf: {}, events: [] });
  const N = o.frames;
  const texOf = (m, props) => {
    const out = [];
    for (const k in m) { const t = m[k]; if (t?.isTexture) out.push([k, t]); }
    const u = props?.get?.(m)?.uniforms;
    if (u) for (const k in u) { const t = u[k]?.value; if (t?.isTexture) out.push([k, t]); }
    return out;
  };
  let installed = false;
  const install = (G) => {
    if (installed) return;
    installed = true;
    P.loadedAt = performance.now();
    const R = G.renderer.renderer, props = R.properties, gl = R.getContext(), rbd = R.renderBufferDirect;
    let cur = null;
    R.renderBufferDirect = function (camera, scene, geometry, material) {
      if (cur && !G.building) {
        for (const [k, t] of texOf(material, props)) {
          if (t.version !== 0 || t.isRenderTargetTexture || t.isVideoTexture) continue;
          cur.add(`${material.name || material.type}.${k} ${(t.image?.src || t.name || '').split('/').pop()}`);
        }
      }
      return rbd.apply(this, arguments);
    };
    // a surface: its mesh (material name under a named group), a point on it facing the camera, the camera on it
    const find = (s) => {
      let hit = null;
      G.renderer.scene.traverse((x) => {
        if (hit || !x.isMesh || !x.visible) return;
        const ms = [].concat(x.material);
        if (!ms.some((m) => m?.name === s.mat)) return;
        let a = x.parent; while (a && a.name !== s.under) a = a.parent;
        if (a || !s.under) hit = x;
      });
      return hit;
    };
    const pointOn = (mesh, up) => {
      // the triangle nearest its bounding box centre (facing up for a ramp top), in world space
      const g = mesh.geometry, pos = g.attributes.position, idx = g.index;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      const n = idx ? idx.count / 3 : pos.count / 3;
      let best = null, bd = Infinity;
      const V = mesh.position.constructor; // THREE.Vector3
      const A = new V(), B = new V(), C = new V(), e1 = new V(), e2 = new V(), wc = new V(cx, 0, cz).applyMatrix4(mesh.matrixWorld);
      for (let i = 0; i < n; i++) {
        const ia = idx ? idx.getX(3 * i) : 3 * i, ib = idx ? idx.getX(3 * i + 1) : 3 * i + 1, ic = idx ? idx.getX(3 * i + 2) : 3 * i + 2;
        A.fromBufferAttribute(pos, ia); B.fromBufferAttribute(pos, ib); C.fromBufferAttribute(pos, ic);
        A.applyMatrix4(mesh.matrixWorld); B.applyMatrix4(mesh.matrixWorld); C.applyMatrix4(mesh.matrixWorld);
        e1.subVectors(B, A); e2.subVectors(C, A); const nn = e1.cross(e2); const area = nn.length();
        if (area < 0.5) continue;
        if (up && Math.abs(nn.y) / area < 0.8) continue;
        const mx = (A.x + B.x + C.x) / 3, mz = (A.z + B.z + C.z) / 3, my = (A.y + B.y + C.y) / 3;
        const d = Math.hypot(mx - wc.x, mz - wc.z) - Math.sqrt(area) * 0.5;
        if (d < bd) { bd = d; best = new V(mx, my, mz); }
      }
      return best;
    };
    const sample = () => {
      for (const s of o.surfaces) {
        const S = (P.surf[s.id] ||= { lum: [], found: -1 });
        if (!S.mesh) {
          const m = find(s);
          if (!m) continue;
          m.updateMatrixWorld(true);
          const p = pointOn(m, s.up);
          if (!p) continue;
          S.mesh = m; S.p = p; S.found = P.frames;
          if (s === o.surfaces[0]) { G.cameraController.centerOn(p.x, p.z); S.recentred = P.frames; continue; } // (drawn from the next frame)
        }
        const cam = G.renderer.camera, v = S.p.clone().project(cam);
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, k = 6;
        const x = Math.round((v.x + 1) / 2 * W) - k / 2, y = Math.round((v.y + 1) / 2 * H) - k / 2;
        if (x < 0 || y < 0 || x + k > W || y + k > H || v.z > 1) { S.lum.push(null); continue; }
        R.setRenderTarget(null);
        const px = new Uint8Array(k * k * 4);
        gl.readPixels(x, y, k, k, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let l = 0; for (let i = 0; i < k * k; i++) l += 0.2126 * px[4 * i] + 0.7152 * px[4 * i + 1] + 0.0722 * px[4 * i + 2];
        S.lum.push([P.frames, Math.round(l / (k * k) * 10) / 10]);
      }
    };
    const render = G.render;
    G.render = function (dt, alpha, draw = true) {
      if (P.done || G.building || draw === false) return render.apply(this, arguments);
      cur = new Set();
      const r = render.apply(this, arguments);
      if (cur.size) { P.darkFrames.push(P.frames); for (const k of cur) { const d = (P.dark[k] ||= [P.frames, P.frames]); d[1] = P.frames; } }
      cur = null;
      try { sample(); } catch (e) { P.events.push(String(e)); }
      if (++P.frames >= N) { P.done = true; R.renderBufferDirect = rbd; }
      return r;
    };
  };
  const hook = () => {
    const G = window.shadowSix;
    if (G?.events?.on) { G.events.on('mission:loaded', () => install(G)); return; }
    setTimeout(hook, 5);
  };
  hook();
}

/** Summarise the probe's numbers: per surface, the early frames against the settled luminance. */
export function summarise(P, { early = 120, settle = 15, ratio = 0.8 } = {}) {
  const surfaces = {};
  for (const [id, S] of Object.entries(P.surf || {})) {
    const pts = (S.lum || []).filter(Boolean);
    const tail = pts.slice(-settle).map((p) => p[1]).sort((a, b) => a - b);
    const settled = tail.length ? tail[tail.length >> 1] : null;
    const firstDraw = pts.length ? pts[0][0] : null;
    const head = pts.filter((p) => p[0] < (firstDraw ?? 0) + early);
    const dark = settled ? head.filter((p) => p[1] < settled * ratio) : [];
    surfaces[id] = { found: S.found, firstSample: firstDraw, settled, minEarly: head.length ? Math.min(...head.map((p) => p[1])) : null,
      darkFrames: dark.length, darkSpan: dark.length ? [dark[0][0], dark[dark.length - 1][0]] : null, samples: pts.length,
      head: head.slice(0, 12).map((p) => p[1]) };
  }
  const darkDraws = Object.entries(P.dark || {}).map(([k, [a, b]]) => ({ what: k, frames: [a, b] }));
  return { frames: P.frames, darkDrawFrames: (P.darkFrames || []).length, darkDraws, surfaces, errors: P.events || [] };
}

/**
 * One cold load (a fresh browser) of `mission` (?debug&mission=…: play starts at once — the mission scripts' first
 * tick) with the probe; resolves with summarise()'s result plus the load time.
 * @param {object} o {chromium, executablePath, args, url (server root), mission, frames, surfaces}
 */
export async function firstFrames(o) {
  const browser = await o.chromium.launch({ executablePath: o.executablePath, headless: true, args: o.args });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
    await page.addInitScript(firstFramesProbe, { surfaces: o.surfaces || SURFACES[o.mission] || [], frames: o.frames || 240 });
    await page.goto(`${o.url.replace(/\/$/, '')}/index.html?debug&mission=${o.mission}${o.query || ''}`);
    await page.waitForFunction(() => window.__ff?.done, null, { timeout: o.timeout || 400_000, polling: 250 });
    const P = await page.evaluate(() => { const P = window.__ff; return { ...P, surf: Object.fromEntries(Object.entries(P.surf).map(([k, S]) => [k, { lum: S.lum, found: S.found }])) }; });
    const loadMs = await page.evaluate(() => window.shadowSix?.lastLoad?.ms ?? null);
    return { mission: o.mission, loadMs, errs, ...summarise(P, o) };
  } finally { await browser.close().catch(() => {}); }
}

// ---- CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const { pathToFileURL } = await import('node:url');
  const { resolve, dirname } = await import('node:path');
  const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d;
  const HERE = resolve(dirname(new URL(import.meta.url).pathname), '../..');
  const root = resolve(arg('root', HERE));
  const H = await import(pathToFileURL(resolve(HERE, 'tests/harness.mjs')).href);
  const { startServer } = await import(pathToFileURL(resolve(HERE, 'tools/serve.mjs')).href);
  let PW;
  try { PW = await import('playwright-core'); } catch { PW = await import(pathToFileURL('<repo>/node_modules/playwright-core/index.mjs').href); }
  const server = await startServer({ port: 0, root });
  try {
    const surf = arg('surface', '');
    const surfaces = surf ? surf.split(',').map((s) => { const [mat, under] = s.split('@'); return { id: s, mat, under, up: /gravel|ramp/.test(s) }; }) : undefined;
    for (const m of arg('mission', 'm11').split(',')) {
      const r = await firstFrames({ chromium: PW.chromium, executablePath: H.findChrome(), args: H.GPU_ARGS, url: server.url, mission: m, frames: +arg('frames', 240), surfaces });
      console.log(JSON.stringify(r, null, 1));
    }
  } finally { await server.close(); }
}
