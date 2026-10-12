/**
 * Render probe (browser side, perf tooling only — never imported by the game): attributes every draw call of a frame
 * to (pass, subsystem) and times passes on the GPU (EXT_disjoint_timer_query_webgl2) and the CPU.
 *
 *   const { installRenderProbe } = await import('/tools/perf/render-probe.js');
 *   const probe = installRenderProbe(window.__game.game, { perDraw: false });
 *   probe.begin(); ...render frames...; const rep = await probe.end();   // averages per frame
 *
 * - Draw attribution wraps `renderer.renderBufferDirect` and reads the `info.render` deltas, so it counts exactly what
 *   three counts (instancing, multi-draw, the shadow map and every composer pass included).
 * - Pass labels: every composer pass (`<i>:<Class>`), the sun shadow map (`shadow`, nested in the first RenderPass) and
 *   the overlay scene. GPU time uses one TIME_ELAPSED query at a time: a nested scope pauses its parent's query.
 * - `perDraw: true` brackets each draw with its own query too (GPU time per subsystem; adds query overhead, so read
 *   these as relative shares, not absolute costs).
 * - Subsystem = a label from the object's ancestors (see `subsystemOf`), tuned to this game's scene layout.
 * @module tools/perf/render-probe
 */

/** Subsystem of a scene-graph path (top-level child name, then its child's name for the big containers). */
export function subsystemOf(top, second, obj) {
  const t = top || '', s = second || '';
  if (obj?.isSkinnedMesh) return 'characters';
  if (t === 'terrain:ground') {
    if (/^terrain(B|$)/.test(s)) return 'terrain';
    if (/apron/i.test(s)) return /veg/.test(s) ? 'vegetation' : 'apron';
    if (/grass/i.test(s)) return 'grass';
    if (/veg|tree|forest|scrub|bocage|impost/i.test(s)) return 'vegetation';
    if (/snow/i.test(s)) return 'snowfx';
    if (/trail/i.test(s)) return 'trails';
    return 'terrain-other';
  }
  if (t === 'props') {
    if (/wire/i.test(s)) return 'wire';
    if (/^buildings:|^prop:(hangar|hut|house|barracks|bunker|church|tower|station|villa|warehouse|shed|garage|castle|kit|building|library|medina|cabin)/i.test(s)) return 'buildings';
    if (/^prop:(cliff|rock|ruins|wall|fence|dam)/i.test(s)) return 'structures';
    if (/dress|clutter|furniture/i.test(s)) return 'dressing';
    return 'props';
  }
  if (/^real:|^unit:|^char|^enemy|^commando|humanoid/i.test(t)) return 'characters';
  if (/^vehicle|^veh:|boat|raft|plane|tank|truck/i.test(t)) return 'vehicles';
  if (/water|sea|river|lake/i.test(t)) return 'water';
  if (/^prop:(hangar|hut|house|barracks|bunker|church|tower|station|villa|warehouse|shed|garage|castle)/i.test(t)) return 'buildings';
  if (/^prop:/i.test(t)) return 'structures';
  if (/pavement|road|street/i.test(t)) return 'pavement';
  if (/furniture|dressing|clothesline|clutter/i.test(t)) return 'dressing';
  if (/ambient|bird|fish|duck|animal/i.test(t)) return 'ambient-life';
  if (/particle|vfx|fx|smoke|fire|blast|blood|debris|decal/i.test(t)) return 'fx';
  if (/street-lights|lamp/i.test(t)) return 'lights';
  return t ? 'other:' + t.slice(0, 24) : 'other';
}

export function installRenderProbe(game, { perDraw = false, verbose = false } = {}) {
  const R = game.renderer, r = R.renderer, gl = r.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const info = r.info.render;
  const cache = new WeakMap();
  const scenes = () => [R.scene, R.decalScene, R.overlayScene, game.world?.water?.system?.waterScene].filter(Boolean);

  function label(obj) {
    let v = cache.get(obj);
    if (v) return v;
    let p = obj, path = [];
    while (p) { path.push(p); p = p.parent; }
    const root = path[path.length - 1];
    const sc = scenes();
    let sub;
    if (root === R.decalScene) sub = 'decals';
    else if (root === R.overlayScene) sub = 'overlay';
    else if (sc[3] && root === sc[3]) sub = 'water';
    else if (root === R.scene) {
      const top = path[path.length - 2], second = path[path.length - 3];
      sub = subsystemOf(top?.name || top?.type, second?.name || second?.type, obj);
    } else if (path.length === 1 && obj.isMesh && obj.geometry?.attributes?.position?.count <= 4) sub = 'fullscreen';
    else sub = 'other:' + (root.name || root.type);
    cache.set(obj, sub);
    return sub;
  }

  // ---- GPU query scopes (one TIME_ELAPSED query active at a time) ----
  const pool = [];
  const pending = []; // {q, key}
  const stack = []; // {key, q}
  function startQ(key) {
    if (!ext) return null;
    const q = pool.pop() || gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    pending.push({ q, key });
    return q;
  }
  function endQ() { if (ext) gl.endQuery(ext.TIME_ELAPSED_EXT); }
  function push(key) {
    if (!on) return;
    if (stack.length) endQ();
    stack.push({ key, t0: performance.now(), child: 0 });
    startQ(key);
  }
  function pop() {
    if (!on) return;
    endQ();
    const s = stack.pop();
    const dt = performance.now() - s.t0;
    acc(cpu, s.key, dt - s.child);
    if (stack.length) { stack[stack.length - 1].child += dt; startQ(stack[stack.length - 1].key); }
  }

  let on = false;
  let frames = 0;
  const draws = new Map(); // `${pass}|${sub}` → {calls, tris}
  const cpu = new Map(); // pass → ms
  const gpu = new Map(); // key → ms
  const switches = new Map(); // `${pass}|${material}` → program switches (three re-derives the program: getProgram)
  const acc = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  const curPass = () => (stack.length ? stack[stack.length - 1].key.split('|')[0] : 'none');

  const origRBD = r.renderBufferDirect;
  r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    if (!on) return origRBD.call(this, camera, scene, geometry, material, object, group);
    const c0 = info.calls, t0 = info.triangles + info.points + info.lines;
    const pass = curPass();
    const sub = label(object);
    const mp = r.properties.get(material), p0 = mp.currentProgram;
    if (perDraw) push(pass + '|' + sub);
    try {
      return origRBD.call(this, camera, scene, geometry, material, object, group);
    } finally {
      if (perDraw) pop();
      const k = pass + '|' + sub;
      let e = draws.get(k);
      if (!e) draws.set(k, (e = { calls: 0, tris: 0 }));
      e.calls += info.calls - c0;
      e.tris += info.triangles + info.points + info.lines - t0;
      if (p0 && mp.currentProgram !== p0) { e.switches = (e.switches || 0) + 1; const mk = pass + '|' + (material.name || material.type) + (object.isInstancedMesh ? '/inst' : object.isSkinnedMesh ? '/skin' : object.isBatchedMesh ? '/batch' : '') + (verbose ? ' @' + (object.name || object.type) + '<' + (object.parent?.name || '') : ''); switches.set(mk, (switches.get(mk) || 0) + 1); }
    }
  };

  const sm = r.shadowMap, origSM = sm.render;
  sm.render = function (...a) {
    const go = on && sm.enabled && (sm.autoUpdate || sm.needsUpdate);
    if (go) push('shadow');
    try { return origSM.apply(this, a); } finally { if (go) pop(); }
  };

  const wrapped = new WeakSet();
  function wrapPasses() {
    const comp = R.composer;
    if (!comp) return;
    comp.passes.forEach((p, i) => {
      if (wrapped.has(p)) { p.__probeKey = `${i}:${p.constructor.name}`; return; }
      wrapped.add(p);
      p.__probeKey = `${i}:${p.constructor.name}`;
      const orig = p.render;
      p.render = function (...a) {
        if (!on || !this.enabled) return orig.apply(this, a);
        push(this.__probeKey);
        try { return orig.apply(this, a); } finally { pop(); }
      };
    });
  }
  const origRender = R.render;
  R.render = function (...a) {
    wrapPasses();
    if (!on) return origRender.apply(this, a);
    frames++;
    push('frame-other');
    try { return origRender.apply(this, a); } finally { pop(); }
  };

  async function collect() {
    if (!ext) return;
    for (let tries = 0; tries < 80 && pending.length; tries++) {
      await new Promise((res) => setTimeout(res, 20));
      let disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      for (let i = 0; i < pending.length; i++) {
        const e = pending[i];
        if (!gl.getQueryParameter(e.q, gl.QUERY_RESULT_AVAILABLE)) break; // results arrive in order
        if (!disjoint) acc(gpu, e.key, gl.getQueryParameter(e.q, gl.QUERY_RESULT) / 1e6);
        pool.push(e.q);
        pending.splice(i--, 1);
      }
    }
  }

  return {
    perDraw,
    begin() { draws.clear(); cpu.clear(); gpu.clear(); switches.clear(); frames = 0; on = true; },
    async end() {
      on = false;
      await collect();
      const n = Math.max(1, frames);
      const per = (m) => Object.fromEntries([...m].map(([k, v]) => [k, +(v / n).toFixed(4)]));
      const d = {};
      for (const [k, v] of draws) d[k] = { calls: +(v.calls / n).toFixed(1), tris: Math.round(v.tris / n), switches: +((v.switches || 0) / n).toFixed(1) };
      return { frames, draws: d, cpu: per(cpu), gpu: per(gpu), switches: per(switches), hasTimer: !!ext };
    },
    uninstall() { r.renderBufferDirect = origRBD; sm.render = origSM; R.render = origRender; on = false; },
  };
}
