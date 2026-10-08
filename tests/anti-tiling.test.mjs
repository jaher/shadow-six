/**
 * Anti-tiling (feat/anti-tiling): the textures' own repeat must not show on the rendered frame.
 *
 * Metric (the same as tools/perf/tilemetric.py, computed in the page on the read-back frame): luminance inside a world
 * rectangle, high-passed (minus a ~1.5 m box blur: lighting and macro tint are not repetition), correlated with itself
 * shifted by whole texture periods T along the pattern's axes (R_T), against the same correlation at lags that are not
 * a texture period (R_B: 0.75 T / 1.25 T, or ±1 slab where the joint grid is legitimately regular). A tiled texture
 * gives R_T ≈ 0.6-0.97; the fixed shaders give ~0.0-0.35 and R_T - R_B ≈ 0.
 *  - paving (gallery, high): granite quay and flag plaza (slab shuffle), setts road (course shuffle + per-stone
 *    variation), Belgian blocks, tar macadam (hex tiling)
 *  - ground (M1, low preset: a single texture sample): the 3 m repeat of the rocky / old-snow layers (domain warp)
 *  - kit terrain (M11 plateau, high): the sand prism's 12 m procedural texture (generic material hex tiling)
 * Seams (fix/anti-tiling-seams): two abutting pieces of plaster floor and brick wall (separate meshes with continuous
 * world-scale uvs) must show no luminance step along their shared edge beyond the texture's own step inside a piece
 * (a per-object uv offset / tone did); the M11 procedural textures must tile and be crease-free (their straight seams
 * were cut up by hex tiling into straight seams all over the plateau).
 * Perf: the paving's anti-tiling (gallery) and the kit materials' hex tiling (M12 rooftops) are toggled on / off in
 * the same page; each costs well under a millisecond per frame on high.
 */
export const timeout = 600_000; // four mission loads + interleaved benches (slow on a shared, loaded machine)

export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const THREE = await import('three');
    const AT = await import('/src/art/anti-tiling.js').catch(() => null); // (absent before feat/anti-tiling)
    const out = {};
    const hideCasters = () => { // ground only: everything that casts a shadow (props, furniture, buildings), units
      const hid = [];
      G.renderer.scene.traverse((o) => { if (o.visible && (o.isMesh || o.isLine || o.isPoints) && (o.castShadow || o.isLine || o.isPoints)) { o.visible = false; hid.push(o); } });
      for (const u of [...G.world.commandos, ...G.world.enemies]) if (u.object3d?.visible) { u.object3d.visible = false; hid.push(u.object3d); }
      return () => { for (const o of hid) o.visible = true; };
    };
    const load = async (m, preset) => {
      g.setPreset(preset);
      if (typeof m === 'string') await g.loadMission(m); else await G.loadMission(m);
      g.start(); g.advance(0.5); G.render(1 / 60, 1);
      await G.mapHandle?.ready;
      for (const e of G.world.enemies) if (e.brain) e.brain.update = () => {};
      for (let k = 0; k < 4; k++) G.render(1 / 60, 1);
      await new Promise((res) => setTimeout(res, 800)); // textures decoded
    };
    /** Repetition at the texture period T (m) inside a world rectangle at height y. */
    function measure({ zoom, cx, cz, rect, y = 0, T, slab = 0 }) {
      G.cameraController.setZoom(zoom, true); G.cameraController.centerOn(cx, cz);
      for (let k = 0; k < 3; k++) G.render(1 / 60, 1);
      const gl = G.renderer.renderer.getContext();
      G.render(1 / 60, 1);
      const W0 = gl.drawingBufferWidth, H0 = gl.drawingBufferHeight;
      const buf = new Uint8Array(W0 * H0 * 4);
      gl.readPixels(0, 0, W0, H0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const W = W0 >> 1, H = H0 >> 1, L = new Float32Array(W * H);   // 2 × 2 box down-sample (GL rows: bottom up)
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        let s = 0;
        for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const o = ((2 * j + b) * W0 + 2 * i + a) * 4;
          s += 0.2126 * buf[o] + 0.7152 * buf[o + 1] + 0.0722 * buf[o + 2];
        }
        L[j * W + i] = s / 4;
      }
      const cam = G.cameraController.camera;
      const pr = (x, z) => { const p = new THREE.Vector3(x, y, z).project(cam); return [(p.x + 1) / 2 * W, (p.y + 1) / 2 * H]; };
      const c = pr(cx, cz), p1 = pr(cx + 1, cz), p2 = pr(cx, cz + 1);
      const ax = [p1[0] - c[0], p1[1] - c[1]], az = [p2[0] - c[0], p2[1] - c[1]];
      const det = ax[0] * az[1] - az[0] * ax[1], ppm = Math.sqrt(Math.abs(det));
      // high-pass: minus a box blur of ~0.75 m radius (summed-area table)
      const r = Math.max(1, Math.round(ppm * 0.75)), S = new Float64Array((W + 1) * (H + 1));
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) S[(j + 1) * (W + 1) + i + 1] = L[j * W + i] + S[j * (W + 1) + i + 1] + S[(j + 1) * (W + 1) + i] - S[j * (W + 1) + i];
      const hp = new Float32Array(W * H), M = new Uint8Array(W * H);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const x0 = Math.max(0, i - r), x1 = Math.min(W, i + r + 1), y0 = Math.max(0, j - r), y1 = Math.min(H, j + r + 1);
        const sum = S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0];
        hp[j * W + i] = L[j * W + i] - sum / ((x1 - x0) * (y1 - y0));
        const dx = i + 0.5 - c[0], dy = j + 0.5 - c[1];
        const wx = cx + (dx * az[1] - az[0] * dy) / det, wz = cz + (ax[0] * dy - dx * ax[1]) / det;
        M[j * W + i] = wx > rect[0] && wx < rect[2] && wz > rect[1] && wz < rect[3] ? 1 : 0;
      }
      const corr = (d) => {
        const dx = Math.round(d[0]), dy = Math.round(d[1]);
        let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
        for (let j = Math.max(0, -dy); j < Math.min(H, H - dy); j++) for (let i = Math.max(0, -dx); i < Math.min(W, W - dx); i++) {
          const k = j * W + i, k2 = (j + dy) * W + i + dx;
          if (!M[k] || !M[k2]) continue;
          const a = hp[k], b = hp[k2];
          n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
        }
        if (n < 400) return NaN;
        const va = saa - sa * sa / n, vb = sbb - sb * sb / n;
        return (sab - sa * sb / n) / Math.sqrt(va * vb + 1e-9);
      };
      const base = slab ? [(slab - 1) / slab, (slab + 1) / slab] : [0.75, 1.25];
      const RT = [], RB = [];
      for (const a of [ax, az]) {
        RT.push(...[1, 2].map((k) => corr([a[0] * T * k, a[1] * T * k])));
        RB.push(...base.map((f) => corr([a[0] * T * f, a[1] * T * f])));
      }
      const mx = (v) => Math.max(...v.filter((x) => x === x));
      return { RT: +mx(RT).toFixed(3), RB: +mx(RB).toFixed(3), excess: +(mx(RT) - mx(RB)).toFixed(3), px: M.reduce((s, v) => s + v, 0), ppm: +ppm.toFixed(1) };
    }
    const bench = async () => { const b = await g.bench(60); return { wall: b.wallMedian, gpu: b.gpuMedian }; };
    const cost = async (set) => { // frame time with the feature on / off, interleaved, best of 3 (the GPU may be shared)
      const on = [], off = [];
      for (let k = 0; k < 3; k++) { set(true); on.push(await bench()); set(false); off.push(await bench()); }
      set(true);
      const best = (a, key) => Math.min(...a.map((b) => b[key] ?? Infinity));
      return { gpuOn: best(on, 'gpu'), gpuOff: best(off, 'gpu'), wallOn: best(on, 'wall'), wallOff: best(off, 'wall') };
    };

    // ---- paving (pavement gallery, high) --------------------------------------------------------------
    const gallery = (await import('/src/missions/dev/pavement-gallery.js')).default;
    // + a square of Belgian blocks on world axes (the gallery's Belgian lane curves)
    await load({ ...gallery, pavements: [...gallery.pavements, { id: 'belgian_sq', surface: 'belgian', x: 2, z: 2, w: 14, d: 14, edge: 'hard' }] }, 'high');
    const pave = G.mapHandle.pavement;
    out.mats = pave.materials.map((m) => m.name);
    const restore = hideCasters();
    out.quay = measure({ zoom: 1, cx: 35, cz: 75, rect: [2, 71, 68, 79], y: 0.45, T: 2.24 * 1.7, slab: 4 });
    out.plaza = measure({ zoom: 1, cx: 37, cz: 14, rect: [31, 5, 43, 23], y: 0.15, T: 2.24, slab: 4 });
    out.setts = measure({ zoom: 1, cx: 30, cz: 40, rect: [2, 37.5, 38, 42.5], T: 2.4 });
    out.belgian = measure({ zoom: 1, cx: 9, cz: 9, rect: [3, 3, 15, 15], T: 2.0 });
    out.tarmac = measure({ zoom: 1, cx: 55, cz: 10, rect: [53, 2, 57, 18], T: 2.2 });
    // ---- seams: two abutting pieces (separate meshes, continuous world-scale uvs) must join without a step ------
    {
      const { dressingMaterial, boxUV } = await import('/src/art/dressing.js');
      const pieces = [];
      // a = piece origin (x, y, z), size, horizontal (floor / roof) or vertical (wall facing the camera, +z)
      const piece = (mat, cx, cy, cz, w, h, flat) => {
        const geo = new THREE.PlaneGeometry(w, h);
        if (flat) geo.rotateX(-Math.PI / 2);
        geo.translate(cx, cy, cz); boxUV(geo, 2.5); geo.translate(-cx, -cy, -cz); // uvs from world position
        const m = new THREE.Mesh(geo, mat); m.position.set(cx, cy, cz); m.name = 'seam-probe';
        G.renderer.scene.add(m); pieces.push(m);
      };
      const plaster = dressingMaterial('plasterWhite'), brick = dressingMaterial('brick');
      piece(plaster, 85, 3, 16, 6, 8, true); piece(plaster, 91, 3, 16, 6, 8, true);        // floor: shared edge x = 88
      piece(brick, 65, 3.5, 30, 6, 4, false); piece(brick, 71, 3.5, 30, 6, 4, false);      // wall: shared edge x = 68
      G.render(1 / 60, 1);
      for (let k = 0; k < 50 && ![plaster, brick].every((m) => m.map?.image && m.normalMap?.image); k++) await new Promise((res) => setTimeout(res, 100));
      await new Promise((res) => setTimeout(res, 500)); // decoded + uploaded
      const step = (cx, cz, y, X, along) => { // mean |L(X + d) - L(X - d)| along the line x = X, vs the same across lines inside the pieces
        G.cameraController.setZoom(2, true); G.cameraController.centerOn(cx, cz);
        for (let k = 0; k < 3; k++) G.render(1 / 60, 1);
        const gl = G.renderer.renderer.getContext();
        G.render(1 / 60, 1);
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, buf = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const cam = G.cameraController.camera, v = new THREE.Vector3();
        const L = (x, yy, z) => {
          v.set(x, yy, z).project(cam);
          const px = Math.round((v.x + 1) / 2 * W), py = Math.round((v.y + 1) / 2 * H), o = (py * W + px) * 4;
          return px < 0 || py < 0 || px >= W || py >= H ? NaN : 0.2126 * buf[o] + 0.7152 * buf[o + 1] + 0.0722 * buf[o + 2];
        };
        const across = (x) => {
          let s = 0, n = 0;
          for (const [yy, z] of along) { const d = Math.abs(L(x + 0.04, yy, z) - L(x - 0.04, yy, z)); if (d === d) { s += d; n++; } }
          return s / n;
        };
        const ref = [-2.6, -2.2, -1.8, -1.4, -1.0, -0.6, 0.6, 1.0, 1.4, 1.8, 2.2, 2.6].map((o) => across(X + o));
        return { edge: +across(X).toFixed(2), inside: +(ref.reduce((a, b) => a + b, 0) / ref.length).toFixed(2), ratio: +(across(X) / (ref.reduce((a, b) => a + b, 0) / ref.length)).toFixed(2) };
      };
      const zs = (z0, z1, y) => Array.from({ length: 160 }, (_, i) => [y, z0 + (z1 - z0) * (i + 0.5) / 160]);
      const ys = (y0, y1, z) => Array.from({ length: 160 }, (_, i) => [y0 + (y1 - y0) * (i + 0.5) / 160, z]);
      out.seamFloor = step(88, 16, 3, 88, zs(12.4, 19.6, 3));
      out.seamWall = step(68, 30, 3.5, 68, ys(1.7, 5.3, 30.001));
      for (const m of pieces) { m.removeFromParent(); m.geometry.dispose(); }
    }
    // perf: the paving's anti-tiling on / off (slab shuffle, course shuffle, stone IDs, hex tar → plain sampling)
    restore();
    G.cameraController.setZoom(0.8, true); G.cameraController.centerOn(40, 45);
    if (pave.materials[0]?.userData.pavement?.uPvShuf) {
    const saved = pave.materials.map((m) => ({ U: m.userData.pavement, s: m.userData.pavement?.uPvShuf.value.clone(), st: m.userData.pavement?.uPvStone.value.x, c: m.userData.pavement?.uPvCourse.value.x }));
    out.pavePerf = await cost((on) => {
      for (const v of saved) {
        if (!v.U) continue;
        v.U.uPvShuf.value.x = on ? v.s.x : 0; v.U.uPvShuf.value.w = on ? v.s.w : 1;
        v.U.uPvStone.value.x = on ? v.st : 0; v.U.uPvCourse.value.x = on ? v.c : 0;
      }
    });
    }

    // ---- ground on low: one texture sample per layer (M1 rocky / old-snow patch, 3 m repeat) ----------
    await load('m01', 'low');
    hideCasters();
    out.m01low = measure({ zoom: 0.5, cx: 32, cz: 130, rect: [24, 114, 42, 125], y: G.world.terrain.heightAt(33, 120), T: 3.0 });
    out.m01lowPreset = G.renderer.presetName;

    // ---- kit terrain (M11 plateau: the sand prism's 12 m texture), high ----------------------------------
    await load('m11', 'high');
    for (const u of [...G.world.commandos, ...G.world.enemies]) if (u.object3d) u.object3d.visible = false;
    out.m11 = measure({ zoom: 0.5, cx: 26, cz: 26, rect: [6, 16, 40, 38], y: 6, T: 12 });
    // its procedural sand / strata textures tile (no step where a repeat ends) and have no creases (smooth noise fade):
    // a straight seam in the texture becomes a straight seam on the plateau every 12 m, and more under hex tiling
    {
      const texs = [];
      G.renderer.scene.getObjectByName('m11:terrain')?.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m.map?.isDataTexture && !texs.includes(m.map)) texs.push(m.map); });
      out.m11tex = texs.slice(0, 2).map((t) => {
        const { data, width: n } = t.image, px = (x, y) => data[((y % n) * n + (x % n)) * 4];
        let wrap = 0, inner = 0, crease = 0, flat = 0, nc = 0, nf = 0;
        for (let y = 0; y < n; y++) {
          wrap += Math.abs(px(n - 1, y) - px(0, y)) + Math.abs(px(y, n - 1) - px(y, 0));
          for (let x = 1; x < n - 1; x++) {
            inner += Math.abs(px(x, y) - px(x + 1, y)) + Math.abs(px(y, x) - px(y, x + 1));
            const d2 = Math.abs(px(x - 1, y) - 2 * px(x, y) + px(x + 1, y));
            if (x % 32 === 0) { crease += d2; nc++; } else { flat += d2; nf++; }
          }
        }
        return { wrapStep: +(wrap / (2 * n) / (inner / (2 * n * (n - 2)))).toFixed(2), crease: +((crease / nc) / (flat / nf)).toFixed(2) };
      });
    }

    // ---- kit / library materials: hex tiling on / off (M12 rooftops, zoom 0.5, high) --------------------
    await load('m12', 'high');
    G.cameraController.setZoom(0.5, true); G.cameraController.centerOn(38, 62);
    let patched = 0;
    G.renderer.scene.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m?.userData?.antiTiling) patched++; });
    out.m12patched = patched;
    if (AT) out.kitPerf = await cost((on) => { AT.AT_UNIFORMS.uAtMode.value = on ? 1 : 0; });
    return out;
  });
  t.log(JSON.stringify(r));
  t.ok(r.mats.length >= 8, `gallery pavement materials ${r.mats.length}`);
  t.ok(r.quay.RT < 0.5 && r.quay.excess < 0.15, `granite quay does not repeat at its 3.8 m texture period (R_T ${r.quay.RT}, excess ${r.quay.excess}; tiled 0.91 / 0.34)`);
  t.ok(r.plaza.RT < 0.55 && r.plaza.excess < 0.15, `flag plaza does not repeat at 2.24 m (R_T ${r.plaza.RT}, excess ${r.plaza.excess}; tiled 0.85 / 0.26)`);
  t.ok(r.setts.RT < 0.5 && r.setts.excess < 0.12, `setts road does not repeat at 2.4 m (R_T ${r.setts.RT}, excess ${r.setts.excess}; tiled 0.68 / 0.44)`);
  t.ok(r.belgian.RT < 0.5 && r.belgian.excess < 0.12, `Belgian blocks do not repeat at 2 m (R_T ${r.belgian.RT}, excess ${r.belgian.excess}; tiled 0.88 / 0.42)`);
  t.ok(r.tarmac.RT < 0.35, `tar macadam (R_T ${r.tarmac.RT}; it hardly showed before either: 0.07)`);
  t.ok(r.m01lowPreset === 'low' && r.m01low.RT < 0.35, `M1 rocky ground on low does not repeat at 3 m (R_T ${r.m01low.RT}; single sample 0.88)`);
  t.ok(r.m11.RT < 0.35, `M11 plateau sand does not repeat at 12 m (R_T ${r.m11.RT}; tiled 1.0)`);
  t.ok(r.m12patched > 50, `M12 kit / library materials carry the anti-tiling patch (${r.m12patched} mesh materials)`);
  t.ok(r.seamFloor.ratio < 1.4, `no seam where two plaster floor pieces abut (edge step ${r.seamFloor.edge} vs ${r.seamFloor.inside} inside: ${r.seamFloor.ratio}×)`);
  t.ok(r.seamWall.ratio < 1.4, `no seam where two brick wall pieces abut (edge step ${r.seamWall.edge} vs ${r.seamWall.inside} inside: ${r.seamWall.ratio}×)`);
  t.ok(r.m11tex.length === 2 && r.m11tex.every((x) => x.wrapStep < 1.6 && x.crease < 1.6), `M11 plateau textures tile without seams or creases ${JSON.stringify(r.m11tex)}`);
  // budget: under 0.8 ms or 8 % of the frame (GPU timer; wall clock when the timer query is not exposed). A frame
  // over 60 ms with the feature off means the GPU is shared with other work: the difference is noise, not cost.
  const within = (p) => { const gc = p.gpuOn - p.gpuOff; return Number.isFinite(gc) ? gc < Math.max(0.8, p.gpuOff * 0.08) : p.wallOn - p.wallOff < Math.max(1.2, p.wallOff * 0.1); };
  for (const [k, p] of [['paving anti-tiling', r.pavePerf], ['kit hex tiling', r.kitPerf]]) {
    t.ok(!!p, `${k} measured`);
    const busy = Math.min(p.gpuOff, p.wallOff) > 60;
    if (busy) t.log(`${k}: GPU busy (${JSON.stringify(p)}), cost check inconclusive`);
    else t.ok(within(p), `${k} cost ${JSON.stringify(p)}`);
  }
}
