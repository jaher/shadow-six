/**
 * Chimney smoke readability (docs/vfx-pipeline.md §6.4), GPU: on M1 and M3 the chimney plumes are drawn in the ambient
 * layer and visible, while the FxPass composite keeps their PERCEIVED change of the screen under the caps — overall,
 * over every commando / enemy screen box (a commando and an enemy are moved right under a plume, the enemy's cone
 * shown) and over the shown vision cone. Uses the pass debug target: R perceived change, G local cap, B raw ambient
 * alpha, A final ambient alpha. The plume must read clearly (not a faint veil) and start right at the stack top. Also:
 * emission points sit in the open flue of the model's chimney tops (raycast: a dark flue floor under the point, the
 * rim round it at the mouth's height; art/chimney-flues.js) and the cost is small.
 */
export default async function chimneySmoke(page, t) {
  for (const [mission, id] of [['m01', 'relay_hut'], ['m03', 'camp_barr']]) {
    const r = await page.evaluate(async ({ mission, id }) => {
      const g = window.__game, G = g.game; await g.loadMission(mission); g.start(); await G.mapHandle?.ready;
      const W = G.world, fx = W.fx, out = { mission };
      if (!fx?.vfx) return out;
      for (let i = 0; i < 64; i++) { g.advance(0.25); if (i % 8 === 0) G.render(1 / 60, 1); }
      const A0 = fx.vfx.ambient; out.rules = { cap: A0.cap, capRoof: A0.capRoof, maskUnit: A0.maskUnit, maskCone: A0.maskCone };
      out.chimneys = fx._chimneys.map((c) => ({ id: c.id, a: c.activity, y: c.pos.y }));
      // emission points sit in the open flue of a chimney top of the drawn model (art/chimney-flues.js): straight under
      // the point the flue's dark floor, round it the rim at the mouth's height; a raw anchor (no flue measured): a ray
      // down from 0.5 m above hits geometry within 0.12 m
      const THREE = await import('three');
      const hitAt = (x, y, z) => {
        // the whole scene: instanced repeats are drawn by a batch mesh outside the structure's group
        const ray = new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0), 0, 3);
        ray.camera = new THREE.PerspectiveCamera(); // the scene has Sprites (headlight halos): Sprite.raycast needs a camera
        const h = ray.intersectObject(fx.scene, true).find((q) => q.object.visible !== false && !q.object.isPoints && !q.object.isSprite && !/^vfx-/.test(q.object.name));
        if (!h) return null;
        const C = h.object.geometry?.attributes?.color, f = h.face;
        const col = C && f ? (C.getX(f.a) + C.getX(f.b) + C.getX(f.c)) / 3 : 1; // (an instanced batch draws the template: same colours)
        return { y: h.point.y, dark: col < 0.15 || /#soot/.test(h.object.material?.name || '') };
      };
      out.tops = fx._chimneys.map((c) => {
        const { x, y, z } = c.pos;
        if (!c.pos.mouth) { const h = hitAt(x, y + 0.5, z); return { id: c.id, mouth: false, gap: h ? +(y - h.y).toFixed(3) : null }; }
        const mid = hitAt(x, y + 0.03, z);
        let rim = null;
        for (let d = 0.03; d <= 0.6 && !rim; d += 0.015) for (let a = 0; a < 8 && !rim; a++) {
          const h = hitAt(x + Math.cos(a * Math.PI / 4) * d, y + 0.12, z + Math.sin(a * Math.PI / 4) * d);
          if (h && !h.dark && Math.abs(h.y - y - 0.04) < 0.07) rim = { d: +d.toFixed(3), dy: +(h.y - y).toFixed(3) };
        }
        return { id: c.id, mouth: true, gap: mid ? +(y - mid.y).toFixed(3) : null, dark: !!mid?.dark, rim };
      });
      const c = fx._chimneys.find((q) => q.id === id && q.activity > 0) || fx._chimneys.find((q) => q.activity > 0);
      out.framed = c.id;
      const cam = G.renderer.camera, V = THREE.Vector3;
      g.setZoom(1); g.centerOn(c.pos.x, c.pos.z); G.render(1 / 60, 1);
      // the ground point that shows behind the plume ~2 m downwind / up of the stack: put a commando and an enemy there
      const live = [];
      const P = fx.vfx.amb, t0 = fx.vfx.time;
      for (let j = 0; j < P.liveCount; j++) { const i = P.live[j], p = [0, 0, 0]; P._pos(i, t0, fx.vfx.u.uWind.value, p); if (Math.hypot(p[0] - c.pos.x, p[2] - c.pos.z) < 5 && p[1] > c.pos.y + 0.8) live.push(p); }
      live.sort((a, b) => a[1] - b[1]);
      const pick = live[Math.floor(live.length / 2)] || [c.pos.x + 2, c.pos.y + 2, c.pos.z];
      const d = cam.getWorldDirection(new V()), gy = W.groundY(pick[0], pick[2]), k = (pick[1] - gy) / -d.y;
      const gx = pick[0] + d.x * k, gz = pick[2] + d.z * k;
      const cmd = W.commandos[0], en = W.enemies.find((e) => e.alive !== false);
      cmd.setPosition(gx, gz); en.setPosition(gx + 1.6, gz - 0.4); en.coneVisible = true;
      out.placed = [+gx.toFixed(1), +gz.toFixed(1)];
      G.paused = true;
      for (let i = 0; i < 3; i++) G.render(1 / 60, 1);
      fx.vfx.pass.debugAmbient = true; G.render(1 / 60, 1); fx.vfx.pass.debugAmbient = false;
      const dbg = fx.vfx.pass.readDebug(G.renderer.renderer), w = dbg.w, h = dbg.h, px = dbg.px;
      const at = (x, y) => (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4; // GL rows (bottom-up)
      let maxP = 0, vis = 0, maxRaw = 0;
      for (let i = 0; i < px.length; i += 4) { maxP = Math.max(maxP, px[i]); maxRaw = Math.max(maxRaw, px[i + 2]); if (px[i] > 0.04) vis++; }
      out.maxPerceived = +maxP.toFixed(3); out.visiblePx = vis; out.maxRawAlpha = +maxRaw.toFixed(3);
      const proj = (x, y, z) => { const q = new V(x, y, z).project(cam); return [Math.round((q.x * 0.5 + 0.5) * w), Math.round((q.y * 0.5 + 0.5) * h)]; };
      const ppm = h / ((cam.top - cam.bottom) / cam.zoom);
      // anchored at the stack: the plume is already visible within ~1.5 m above the stack top (not only further out)
      { const sp = proj(c.pos.x, c.pos.y, c.pos.z), r = Math.ceil(1.5 * ppm); let m = 0, n = 0;
        for (let y = sp[1]; y <= sp[1] + r; y++) for (let x = sp[0] - r; x <= sp[0] + r; x++) { const i = at(x, y); m = Math.max(m, px[i]); if (px[i] > 0.04) n++; }
        out.stack = { m: +m.toFixed(3), n }; }
      // every unit on screen: max perceived change and max raw smoke inside its screen box
      out.units = [...W.commandos, ...W.enemies].filter((u) => !u.removed && u.object3d?.visible !== false).map((u) => {
        const y0 = Math.max(u.y || 0, W.groundY(u.x, u.z)), a = proj(u.x, y0, u.z), b = proj(u.x, y0 + 1.8, u.z), hw = Math.ceil(0.45 * ppm);
        if (a[0] < 0 || a[0] >= w || b[1] < 0 || a[1] >= h) return null;
        let m = 0, raw = 0;
        for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++) for (let x = a[0] - hw; x <= a[0] + hw; x++) { const i = at(x, y); m = Math.max(m, px[i]); raw = Math.max(raw, px[i + 2]); }
        return { kind: u.kind, m: +m.toFixed(3), raw: +raw.toFixed(3) };
      }).filter(Boolean);
      // the shown cone: sample its ground area
      const cone = fx.vfx.ambient.cones[0];
      if (cone) {
        let m = 0, raw = 0;
        for (const f of [0.3, 0.5, 0.7, 0.9]) for (const s of [-0.6, 0, 0.6]) {
          const an = cone.heading + s * cone.halfFov, q = proj(cone.x + Math.cos(an) * cone.far * f, W.groundY(cone.x, cone.z), cone.z + Math.sin(an) * cone.far * f);
          if (q[0] < 0 || q[0] >= w || q[1] < 0 || q[1] >= h) continue;
          const i = at(q[0], q[1]); m = Math.max(m, px[i]); raw = Math.max(raw, px[i + 2]);
        }
        out.cone = { m: +m.toFixed(3), raw: +raw.toFixed(3) };
      }
      // cost of the ambient layer: GPU timer around the FxPass only (the whole frame is too noisy on the shared GPU),
      // ambient drawn vs hidden, alternating, median of each
      const gl = G.renderer.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), pass = fx.vfx.pass, orig = pass.render;
      const sample = async (n) => {
        const qs = [], res = [];
        pass.render = function (...a) { const q = ext && gl.createQuery(); if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q); orig.apply(this, a); if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); } };
        for (let i = 0; i < n; i++) G.render(1 / 60, 1);
        pass.render = orig;
        for (let tries = 0; tries < 40 && qs.length; tries++) {
          await new Promise((r) => setTimeout(r, 25));
          for (let i = qs.length - 1; i >= 0; i--) if (gl.getQueryParameter(qs[i], gl.QUERY_RESULT_AVAILABLE)) { if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) res.push(gl.getQueryParameter(qs[i], gl.QUERY_RESULT) / 1e6); gl.deleteQuery(qs[i]); qs.splice(i, 1); }
        }
        return res;
      };
      const on = [], off = [];
      if (ext) for (let rep = 0; rep < 3; rep++) { on.push(...await sample(20)); P.mesh.visible = false; off.push(...await sample(20)); P.mesh.visible = true; }
      const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
      out.cost = { on: +med(on).toFixed(3), off: +med(off).toFixed(3), gpu: !!ext, n: on.length };
      out.stats = fx.stats();
      G.paused = false;
      return out;
    }, { mission, id });
    t.log(JSON.stringify(r));
    if (!r.chimneys) { t.ok(false, `${mission}: VFX library active`); continue; }
    const R = r.rules;
    t.ok(r.chimneys.length > 0 && r.chimneys.some((c) => c.a > 0), `${mission}: lit chimneys (${r.chimneys.map((c) => `${c.id}:${c.a}`)})`);
    for (const q of r.tops) {
      if (!q.mouth) { t.ok(q.gap != null && q.gap >= -0.01 && q.gap <= 0.12, `${mission} ${q.id}: emission on the chimney top of the model (gap ${q.gap} m)`); continue; }
      t.ok(q.gap != null && q.gap >= 0.05 && q.gap <= 0.6 && q.dark, `${mission} ${q.id}: emission over the open flue (its dark floor ${q.gap} m under it, dark ${q.dark})`);
      t.ok(!!q.rim, `${mission} ${q.id}: the flue's rim round the emission point at the mouth's height (${JSON.stringify(q.rim)})`);
    }
    t.ok(r.visiblePx > 3000 && r.maxPerceived > 0.15, `${mission}: smoke clearly visible (${r.visiblePx} px, max perceived ${r.maxPerceived})`);
    t.ok(r.stack.m > 0.08 && r.stack.n > 150, `${mission}: plume anchored at the stack top (max ${r.stack.m}, ${r.stack.n} px within 1.5 m)`);
    t.ok(r.maxPerceived <= R.capRoof + 0.012, `${mission}: perceived change ≤ roof cap ${R.capRoof} (${r.maxPerceived})`);
    const lim = R.cap * R.maskUnit + 0.012;
    t.ok(r.units.length >= 2, `${mission}: units on screen (${r.units.length})`);
    for (const u of r.units) t.ok(u.m <= lim, `${mission}: ${u.kind} screen box: perceived ${u.m} ≤ ${lim.toFixed(3)} (raw smoke ${u.raw})`);
    t.ok(r.units.some((u) => u.raw > 0.05), `${mission}: a unit is actually under the plume (raw ${r.units.map((u) => u.raw)})`);
    if (r.cone) t.ok(r.cone.m <= R.cap * R.maskCone + 0.012, `${mission}: shown cone not tinted (${r.cone.m}, raw ${r.cone.raw})`);
    t.ok(!r.cost.gpu || r.cost.on - r.cost.off < 0.6, `${mission}: ambient layer GPU cost ${(r.cost.on - r.cost.off).toFixed(3)} ms (FxPass ${r.cost.off} → ${r.cost.on} ms)`);
    t.ok(r.stats.ambient <= 4000 && r.stats.ambPressure === 1, `${mission}: within the ambient budget (${r.stats.ambient})`);
  }
}
