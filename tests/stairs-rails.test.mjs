/**
 * Stairs between their rails (user feedback 2026-10-11: "it looks like the man walk on the stairs in a way they can
 * cross the handrails, fix that"). Every flight with handrails or side walls — the M3 dam's W and E stairs, M2's
 * plat_sw stair, M20's stone flights and the stair links of M6, M9 and every M12 flight — is walked and run up and down by men coming
 * at its foot or head head-on and from odd angles (±70°, ±110° off its axis), crawled up, climbed with a man on the
 * shoulder (M3), and walked by two men passing each other on it. Per frame, on its run, every sampled bone (hands,
 * forearms, shoulders, feet, knees, hips, pelvis, chest, head) keeps its radius inside the rails / walls on its side
 * at its height: its distance off the axis + radius ≤ the first static surface a ray from the axis out to that side
 * meets there, from 0.3 m under the bone's height up (the rails, posts, stringers, cheek walls, a battered wall leaning
 * away; men and machines are no part of it).
 * Logic + model updates per frame (no frames drawn), as Game.render steps the units' models.
 */
export const timeout = 2_400_000;

/** Bones sampled and their radii (m). */
const BONES = [['hand_l', 0.045], ['hand_r', 0.045], ['lowerarm_l', 0.045], ['lowerarm_r', 0.045], ['upperarm_l', 0.06], ['upperarm_r', 0.06],
  ['foot_l', 0.05], ['foot_r', 0.05], ['calf_l', 0.06], ['calf_r', 0.06], ['thigh_l', 0.08], ['thigh_r', 0.08], ['pelvis', 0.12], ['spine_03', 0.15], ['Head', 0.1]];

/**
 * Where the drawn castle stands on a stone flight (the art, not the walk): contacts past `s` (m up the flight) are
 * listed, not counted. M20's S_sw runs at its top into masonry 0.11–0.17 m off its line; S_nw2 has a wall's corner
 * 0.10 m off its line at 3.5 m and a floor 1 m over its top treads.
 */
const ART = {
  'm20 S_sw': { s: 4.4, why: 'masonry 0.11-0.17 m off its line at its top' },
  'm20 S_nw2': { s: 3.2, why: "a wall's corner 0.10 m off its line, a floor over its top treads" },
  // (M2's plat_sw stands along the camp palisade: at its foot the palisade is half a metre off its line, and a man
  // coming along the palisade from that side brushes it — the palisade's own nav, not the stair's rails)
  'm02 plat_sw': { s: -9, s1: 0.5, side: 1, why: 'the camp palisade half a metre off its line at its foot' },
  // (M9's barracks asset draws its outside stair with the lower treads 0.25–0.4 m wide against a battered side wall and
  // its head 1.2 m wide in the terrace parapet: on its one straight line a man's feet and right hand brush the wall's
  // foot on the first steps — the asset's stair, the link now on it)
  'm09 stair_barr': { s: -9, why: "the asset's lower treads are 0.25-0.4 m wide against its battered side wall" },
};

export default async function stairsRails(page, t) {
  const only = process.env.RAILS_ONLY || ''; // e.g. "m03,m02" while working on it
  // (and while working on one: RAILS_FLIGHT=S_n3 RAILS_CASE='walk down from -110' RAILS_TRACE=1 — his track every 10 frames)
  const dbg = { flight: process.env.RAILS_FLIGHT || '', kase: process.env.RAILS_CASE || '', trace: !!process.env.RAILS_TRACE };
  const all = [];
  for (const mis of ['m03', 'm02', 'm20', 'm12', 'm06', 'm09']) {
    if (only && !only.split(',').includes(mis)) continue;
    const r = await page.evaluate(async ({ mis, BONES, ART, dbg }) => {
      const g = window.__game, G = g.game, THREE = await import('three');
      const um = await import('/src/art/unit-model.js');
      const ST = await import('/src/world/stairs.js');
      const { MeshBVH } = await import('/vendor/three-mesh-bvh/index.module.js');
      /** One world-space BVH of the static triangles (no units, vegetation, terrain or effects) meeting `box`. */
      const SKIP = /^(terrain|grass|scrub|veg|clutter|vfx|water|apron|sky|shadow|snowfall|rain|__)/i;
      const collect = (scene, box) => {
        const pos = [], b = new THREE.Box3(), a = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3(), tb = new THREE.Box3(), m = new THREE.Matrix4(), M = new THREE.Matrix4();
        const take = (o, W) => {
          const geo = o.geometry, P = geo.attributes.position, I = geo.index;
          b.copy(geo.boundingBox).applyMatrix4(W);
          if (!b.intersectsBox(box)) return;
          const n = I ? I.count : P.count;
          for (let t = 0; t + 2 < n; t += 3) {
            a.fromBufferAttribute(P, I ? I.getX(t) : t).applyMatrix4(W); c.fromBufferAttribute(P, I ? I.getX(t + 1) : t + 1).applyMatrix4(W); d.fromBufferAttribute(P, I ? I.getX(t + 2) : t + 2).applyMatrix4(W);
            tb.makeEmpty(); tb.expandByPoint(a); tb.expandByPoint(c); tb.expandByPoint(d);
            if (tb.intersectsBox(box)) pos.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
          }
        };
        const visit = (o) => {
          if (SKIP.test(o.name || '') || /^lod[12]$/.test(o.name) || (o.visible === false && o.name !== 'lod0')) return;
          if ((o.isMesh || o.isInstancedMesh) && !o.isSkinnedMesh && !o.isBatchedMesh && o.geometry?.attributes?.position) {
            const mats = [].concat(o.material || []);
            if (mats.some((x) => x && x.visible !== false && !(x.transparent && x.opacity < 0.2))) {
              if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
              if (o.isInstancedMesh) for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); take(o, M.multiplyMatrices(o.matrixWorld, m)); } else take(o, o.matrixWorld);
            }
          }
          for (const ch of o.children) visit(ch);
        };
        visit(scene);
        if (pos.length < 9) return null;
        const gg = new THREE.BufferGeometry();
        gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
        return new MeshBVH(gg, { maxLeafSize: 8 });
      };
      const ray = new THREE.Ray();
      const castFirst = (bvh, o, d, far) => { if (!bvh) return null; ray.set(o, d); const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, far); return hit ? hit.distance : null; };
      const { Commando } = await import('/src/entities/commando.js');
      const { Enemy } = await import('/src/entities/enemy.js');
      const stub = () => ({ update() {}, attach() {}, hear() {}, onDeath() {}, isAware: () => false, state: 'IDLE', serialize: () => null, deserialize() {}, notifyKill() {}, onBodyFound() {}, distractBy: () => false, releaseDistraction() {} });
      await g.loadMission(mis); g.start();
      if (G._raf) { cancelAnimationFrame(G._raf); G._raf = null; }
      for (let i = 0; i < 60; i++) g.step(); // (M20's opening puts every standing commando on his belly in its first half second)
      G.render(1 / 60, 1);
      const w = G.world, grid = w.grid;
      const clear = () => { for (const e of [...w.entities]) if (e.kind === 'enemy' || e.kind === 'commando' || e.kind === 'vehicle') w.remove(e); w.flushRemovals?.(); };
      clear();
      function frame() {
        if (G.state !== 'playing') G.state = 'playing'; // (its men cleared away: the mission's own loss is no end of this test)
        g.step();
        um.charactersFrame(false);
        for (const e of w.entities) if (e.kind === 'commando' || e.kind === 'enemy') { e.syncTransform?.(1); e.renderUpdate?.(1 / 60); }
        um.transportFrame();
      }
      const ready = async (u) => { await u.model.ready; return u; };
      const picks = {
        m03: (fl) => fl.filter((f) => f.kind === 'dam'), m02: (fl) => fl.filter((f) => f.kind === 'platform'),
        m20: (fl) => fl.filter((f) => f.kind === 'link').slice(0, 3), m12: (fl) => fl.filter((f) => f.kind === 'link'),
        m06: (fl) => fl.filter((f) => f.kind === 'link').slice(0, 1), m09: (fl) => fl.filter((f) => f.kind === 'link').slice(0, 1),
      };
      const flights = picks[mis](w.stairs.flights);
      const out = [];
      for (const f of flights) {
        const fid = `${mis} ${f.id ?? f.kind}${f.link ? ` (link ${f.link.id})` : ''}`;
        if (dbg.flight && f.id !== dbg.flight) continue;
        // the static scene round the flight (its rails, walls); men and machines are none of it
        const pts = [ST.flightWorld(f, f.sFoot - 3, -3), ST.flightWorld(f, f.sFoot - 3, 3), ST.flightWorld(f, f.sTop + 3, -3), ST.flightWorld(f, f.sTop + 3, 3)];
        const box = new THREE.Box3(new THREE.Vector3(Math.min(...pts.map((p) => p.x)), f.yMin - 0.5, Math.min(...pts.map((p) => p.z))), new THREE.Vector3(Math.max(...pts.map((p) => p.x)), f.yMax + 2.5, Math.max(...pts.map((p) => p.z))));
        G.renderer.scene.updateMatrixWorld(true);
        const geo = collect(G.renderer.scene, box);
        const nrm = new THREE.Vector3(-f.uz, 0, f.ux); // (the flight's left)
        const o = new THREE.Vector3(), d = new THREE.Vector3();
        /** distance from the axis at (s, height y) to the first surface out to side sg (±1) */
        const face = (s, y, sg) => { const p = ST.flightWorld(f, s, 0); o.set(p.x, y, p.z); d.copy(nrm).multiplyScalar(sg); return castFirst(geo, o, d, 2.5) ?? Infinity; };
        // each side's railing (or wall), every 0.1 m along it: its inner face (the nearest hit off the axis, over the
        // treads up to 1.4 m — a railing's bars are thin: a hand between them is through it all the same) and its top;
        // a side counts as railed there only where something rises ≥ 0.5 m over the tread (a stringer, a walk's edge
        // level with the treads is no rail)
        const side = {};
        for (const sg of [-1, 1]) {
          const at = new Map();
          let n = 0, vs = [];
          const sA = (f.railS ? f.railS[0] : f.sFoot) - 0.5, sB = (f.railS ? f.railS[1] : f.sTop) + 0.5;
          for (let k = Math.round(sA * 10); k <= Math.round(sB * 10); k++) {
            const s = k / 10, tr = ST.levelAt(f, s);
            let v = Infinity, top = -Infinity;
            const hv = [];
            for (let h = 0.05; h <= 1.4; h += 0.025) { const x = face(s, tr + h, sg); hv.push(x <= f.w / 2 + 0.3 ? x : Infinity); if (x <= f.w / 2 + 0.3) { v = Math.min(v, x); top = Math.max(top, h); } }
            if (top >= 0.5) { at.set(k, { v, top, hv }); n++; vs.push(v); }
          }
          vs.sort((a, b) => a - b);
          side[sg] = n >= 5 ? { at, v: vs[Math.floor(vs.length * 0.05)], n } : null;
        }
        const railAt = (sg, s) => { const S = side[sg]; if (!S) return null; const k = Math.round(s * 10); return S.at.get(k) || S.at.get(k - 1) || S.at.get(k + 1) || null; };
        if (!side[-1] && !side[1]) { out.push({ fid, skip: 'no rails or walls beside it' }); continue; }
        const wall = Math.max(side[-1]?.v ?? f.w / 2, side[1]?.v ?? f.w / 2);
        const railInfo = [-1, 1].map((sg) => (side[sg] ? `${sg < 0 ? 'right' : 'left'} ${side[sg].v.toFixed(2)} m (${side[sg].n} dm)` : `${sg < 0 ? 'right' : 'left'} open`)).join(', ');
        const up = new THREE.Vector3(f.ux, 0, f.uz);
        const at = (base, dir, a, D) => { const c = Math.cos(a), sn = Math.sin(a), dx = dir.x * c - dir.z * sn, dz = dir.x * sn + dir.z * c; return { x: base.x + dx * D, z: base.z + dz * D }; };
        const ground = (p, y0) => grid.walkableAt(p.x, p.z) && Math.abs(grid.elevAt(p.x, p.z) - y0) < 0.4;
        /** a start point D m out of an end, a° off its axis (out along the axis at 0°), on walkable ground at that end's height */
        const startAt = (end, a) => {
          const base = end === 'foot' ? ST.flightWorld(f, f.sFoot, 0) : ST.flightWorld(f, f.sTop, 0), dir = end === 'foot' ? up.clone().negate() : up.clone();
          const y0 = end === 'foot' ? f.levels[0] : f.levels[f.levels.length - 1];
          for (const D of [2.5, 2.0, 3.0, 1.6, 1.2, 1.0]) { const p = at(base, dir, a * Math.PI / 180, D); if (ground(p, y0)) return { ...p, y: y0 }; }
          return null;
        };
        const goalAt = (end) => {
          const y0 = end === 'foot' ? f.levels[0] : f.levels[f.levels.length - 1];
          for (const D of [1.0, 0.6, 1.5, 2.0]) { const p = end === 'foot' ? ST.flightWorld(f, f.sFoot - D, 0) : ST.flightWorld(f, f.sTop + D, 0); if (ground(p, y0)) return p; }
          // (a stair link's top: its own end)
          const L = f.link; if (L) { const hi = L.a.y >= L.b.y ? L.a : L.b, lo = L.a.y >= L.b.y ? L.b : L.a; return end === 'foot' ? lo : hi; }
          return null;
        };
        const mkGB = () => new Commando({ role: 'greenberet', x: 0, z: 0 }), mkSpy = () => new Commando({ role: 'spy', x: 0, z: 0 });
        const mkSapper = () => new Commando({ role: 'sapper', x: 0, z: 0 }), mkGer = () => { const e = new Enemy({ id: 'rail_x', soldierType: 'rifleman', x: 0, z: 0 }); e.brain = stub(); return e; };
        const cases = [];
        for (const a of [0, 70, -70, 110, -110]) cases.push({ name: `walk up from ${a}°`, men: [{ mk: mkGB, from: ['foot', a], to: 'top' }] });
        for (const a of [0, 70, -70]) cases.push({ name: `run up from ${a}°`, men: [{ mk: mkGB, from: ['foot', a], to: 'top', run: true }] });
        for (const a of [0, 70, -70, 110, -110]) cases.push({ name: `walk down from ${a}°`, men: [{ mk: mkGB, from: ['top', a], to: 'foot' }] });
        for (const a of [0, 70]) cases.push({ name: `run down from ${a}°`, men: [{ mk: mkGB, from: ['top', a], to: 'foot', run: true }] });
        cases.push({ name: 'German rifleman walk up from 70°', men: [{ mk: mkGer, from: ['foot', 70], to: 'top' }] });
        if (!f.link) for (const a of [0, 70]) cases.push({ name: `crawl up from ${a}°`, men: [{ mk: mkSapper, from: ['foot', a], to: 'top', crawl: true }] });
        // (two men passing each other where it is wide enough for that — following each other everywhere)
        // (meeting head-on on a stair, two men may stop each other — the avoidance's way on raised ground: what this
        // checks is that neither is pushed over a rail, not that they get by)
        if (f.clear >= 0.6) cases.push({ name: 'two men passing', meet: true, men: [{ mk: mkGB, from: ['foot', 0], to: 'top' }, { mk: mkSpy, from: ['top', 0], to: 'foot' }] });
        cases.push({ name: 'two men following', men: [{ mk: mkGB, from: ['foot', 0], to: 'top' }, { mk: mkSpy, from: ['foot', 30], to: 'top', after: 40 }] });
        for (const C of cases) {
          if (dbg.kase && !C.name.includes(dbg.kase)) continue;
          clear();
          const men = [];
          let bad = null;
          for (const M of C.men) {
            const st = startAt(...M.from), goal = goalAt(M.to);
            if (!st || !goal) { bad = `no ground to start / end (${M.from})`; break; }
            const u = await ready(w.add(M.mk()));
            if (u.faction === 'enemy') u.brain = stub();
            const face0 = Math.atan2((M.from[0] === 'foot' ? 1 : -1) * f.uz, (M.from[0] === 'foot' ? 1 : -1) * f.ux);
            u.setPosition(st.x, st.z, face0); u.y = st.y;
            men.push({ u, M, goal, name: M.mk === mkGer ? 'German' : u.role });
          }
          if (bad) { out.push({ fid, name: C.name, skip: bad }); continue; }
          for (let i = 0; i < 30; i++) frame();
          for (const m of men) {
            if (m.M.crawl && m.u.stance !== 'crawl') { m.u.issue({ type: 'stance', stance: 'crawl' }); }
          }
          for (let i = 0; i < 60; i++) frame();
          let issued = true;
          for (const m of men) {
            for (let i = 0; i < (m.M.after || 0); i++) frame(); // (the second man a little behind the first)
            const ok = m.u.faction === 'enemy' ? m.u.moveTo(m.goal.x, m.goal.z, { run: !!m.M.run }) : m.u.issue({ type: 'move', x: m.goal.x, z: m.goal.z, run: !!m.M.run });
            if (!ok) { issued = false; bad = `${m.name}: no path`; }
            else if (dbg.trace) m.p0 = (m.u.path || []).map((p) => { const q = ST.flightLocal(f, p.x, p.z); return `${q.s.toFixed(2)},${q.v.toFixed(2)}${p.link ? 'L' : ''}`; }).join(' ');
          }
          if (!issued) { out.push({ fid, name: C.name, skip: bad }); continue; }
          const R = { fid, name: C.name, art: [], artWhy: ART[`${mis} ${f.id}`]?.why ?? null, meet: !!C.meet, rails: railInfo, frames: 0, onRun: 0, hits: [], worst: -9, vMax: 0, arrived: true };
          for (let k = 0; k < 60 * (men.length > 1 ? 75 : 45) && men.some((m) => m.u.path); k++) {
            frame();
            R.frames++;
            if (dbg.trace && k % 10 === 0) (R.trace ||= []).push(men.map((m) => { const q = ST.flightLocal(f, m.u.x, m.u.z); return `${q.s.toFixed(2)},${q.v.toFixed(2)},${(m.u.y ?? 0).toFixed(2)}`; }).join(' / '));
            for (const m of men) {
              const B = m.u.model?.real?.inner?.bones;
              if (!B) continue;
              const pel = ST.flightLocal(f, m.u.x, m.u.z);
              // (his middle on its run — or over its edge: a man beside the flight on the ground is not on it)
              const onIt = pel.s > f.sFoot - 0.3 && pel.s < (f.railS?.[1] ?? f.sTop) + 0.3 && Math.abs(pel.v) <= wall + 0.1 && Math.abs(m.u.y - ST.lineAt(f, pel.s)) < 0.6;
              if (onIt && pel.s > f.sFoot + 0.1 && pel.s < f.sTop - 0.1) { R.onRun++; R.vMax = Math.max(R.vMax, Math.abs(pel.v)); }
              if (k % 2 || !onIt) continue;
              for (const [bn, rad] of BONES) {
                const b = B[bn] || (bn === 'Head' ? B.head : null);
                if (!b) continue;
                const p = b.getWorldPosition(new THREE.Vector3()), q = ST.flightLocal(f, p.x, p.z);
                // (where its rails / walls stand: in front of their ends he is on the ground before the stair)
                const ra = f.railAt ?? (f.link ? [0, f.sTop] : [f.sFoot, f.sTop]);
                if (q.s < ra[0] - rad || q.s > ra[1] + rad) continue;
                const tread = ST.levelAt(f, q.s);
                if (p.y < tread - 0.05 || p.y > tread + 2.2 || Math.abs(m.u.y - ST.lineAt(f, q.s)) > 0.8) continue; // (on its run, over its treads)
                for (const sg of [-1, 1]) {
                  const S = railAt(sg, q.s);
                  if (!S || p.y - tread > S.top + rad) continue; // (no rail there, or over its top: clear of it)
                  // (against the faces from 0.3 m under the bone's own height up: a battered wall leans away above its
                  // foot — M9's barracks stair — and a foot under a railing's top rail is through it all the same)
                  const bh = p.y - tread;
                  let fv = Infinity;
                  S.hv.forEach((x, i) => { if (0.05 + i * 0.025 >= bh - 0.3) fv = Math.min(fv, x); });
                  if (fv === Infinity) continue;
                  const need = q.v * sg + rad, ex = need - fv;
                  const A0 = ART[`${mis} ${f.id}`];
                  if (ex > R.worst && !(A0 && q.s >= A0.s && q.s <= (A0.s1 ?? Infinity) && (!A0.side || A0.side === sg))) R.worst = ex;
                  const A = ART[`${mis} ${f.id}`], inArt = A && q.s >= A.s && q.s <= (A.s1 ?? Infinity) && (!A.side || A.side === sg);
                  if (ex > 0 && inArt) { if (R.art.length < 3) R.art.push(`${m.name} ${bn} ${ex.toFixed(3)} at s ${q.s.toFixed(2)}`); continue; }
                  if (ex > 0 && dbg.trace && !R.dump) R.dump = ['pelvis', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'].map((n) => { const P = B[n].getWorldPosition(new THREE.Vector3()), Q = ST.flightLocal(f, P.x, P.z); return `${n} ${Q.s.toFixed(2)},${Q.v.toFixed(2)},${(P.y - ST.levelAt(f, Q.s)).toFixed(2)}`; }).join(' ');
                  if (ex > 0 && R.hits.length < 6) R.hits.push(`${m.name} ${bn} ${ex.toFixed(3)} at s ${q.s.toFixed(2)} v ${q.v.toFixed(2)}${dbg.trace ? ` (k ${k}, his s ${pel.s.toFixed(2)} v ${pel.v.toFixed(3)} facing ${(((m.u.heading - Math.atan2(f.uz, f.ux)) * 180 / Math.PI + 540) % 360 - 180).toFixed(0)}° ${m.u.model?.clip} sg ${m.u.model?._sg?.w?.toFixed(2)} ${m.u._anim} ${m.u.isMoving ? 'moving' : 'still'})` : ''}`);
                }
              }
            }
          }
          R.arrived = men.every((m) => !m.u.path);
          if (dbg.trace) { R.path0 = men.map((m) => m.p0); R.dm = [-1, 1].map((sg) => side[sg] ? [...side[sg].at].map(([k, x]) => `${k}:${x.v.toFixed(2)}/${x.top.toFixed(2)}`).join(' ') : '-'); }
          R.worst = +R.worst.toFixed(3); R.vMax = +R.vMax.toFixed(3);
          out.push(R);
        }
      }
      return out;
    }, { mis, BONES, ART, dbg });
    for (const x of r) {
      if (x.skip) { t.log(`skip ${x.fid}${x.name ? ` ${x.name}` : ''}: ${x.skip}`); continue; }
      const why = [];
      if (x.hits.length) why.push(`over the rails: ${x.hits.join('; ')}`);
      // (a way round on foot, not this stair: nothing to measure)
      if (x.onRun === 0) { t.log(`skip ${x.fid} ${x.name}: a way round, not up / down this stair${x.arrived ? '' : ' (not there yet)'}`); continue; }
      if (x.onRun < 30) why.push(`only ${x.onRun} frames on its run`);
      if (!x.arrived && !x.meet) why.push('did not get there');
      x.ok = !why.length; x.why = why;
      t.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.fid} [${x.rails}] ${x.name}: on the run ${x.onRun} frames, |v| max ${x.vMax}, worst ${x.worst}${x.art.length ? ` (art: ${x.artWhy}: ${x.art.join('; ')})` : ''}${x.ok ? '' : ' — ' + why.join(' / ')}`);
      all.push(x);
      if (x.dump) t.log(`  dump ${x.dump}`);
      if (x.trace) t.log(`  path ${JSON.stringify(x.path0)} || rails ${JSON.stringify(x.dm)} || track ${x.trace.join(' | ')}`);
    }
  }
  const bad = all.filter((x) => !x.ok);
  t.log(`${all.length - bad.length} / ${all.length} runs ok`);
  t.ok(all.length >= (only ? 1 : 20), `${all.length} runs measured`);
  t.ok(!bad.length, `failing: ${bad.map((x) => `${x.fid} ${x.name}: ${x.why.join(' / ')}`).join(' || ')}`);
}
