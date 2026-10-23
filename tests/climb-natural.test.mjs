/**
 * Natural climbing (user 2026-10-22: "Make sure the ladder climbing looks natural, commando not crossing the ladder /
 * wall"). One man alone on the map (no enemies, no vehicles; the mission's own end held off) climbs and comes back:
 *  - M2: the Green Beret up the camp's SW palisade (his climb link) onto the wall walk and back down; the Sniper up the
 *    lowered camp ladder over the palisade onto the walk and back down; the Green Beret up an MG platform's ladder;
 *  - M1: the Green Beret over wall_s (up one face, across, down the other); M8: up a 4 m cliff and back down;
 *  - M11: up a process tank's caged ladder (7.4 m) and down.
 * Per frame (logic + model updates; every 3rd frame the skinned body and the props he carries against the drawn static
 * scenery — what is drawn: never-drawn guards aside):
 *  - nothing of him inside a solid deeper than PEN.body (a hand gripping a rung or flat on a wall: PEN.hand); a vertex
 *    is inside when it lies straight behind the nearest face and a ray straight up from it leaves by a face first;
 *  - his pelvis never behind (or in) a ladder's rung line near its foot, within its width;
 *  - no jump: the pelvis moves at most JUMP m from one frame to the next, on it and walking to / from it;
 *  - no knee turning over: a knee moves at most FLIP m further than its foot from one frame to the next;
 *  - no turning about in a frame: his body's facing turns at most TURN rad from one frame to the next;
 *  - the climb happens (he gets to the far end and back).
 * On master this fails: the wall climb floated up in front of the palisade and through its stakes, the Sniper walked
 * behind the camp ladder to its link end in the stakes, dropped a metre at its top and slid through the palisade.
 */
export const timeout = 1_500_000;

const PEN = { body: 0.065, hand: 0.035 };
const JUMP = 0.1;
const FLIP = 0.2;
const TURN = 0.35;

export default async function climbNatural(page, t) {
  const only = process.env.CLIMB_ONLY || '';
  const SC = [
    { tag: 'm02 GB palisade', mis: 'm02', who: 'greenberet', kind: 'climb', at: [24.6, 42.3], linkAt: [23.73, 41.0], up: [23.72, 39.3], down: [23.73, 41.0] },
    { tag: 'm02 Sniper camp ladder', mis: 'm02', who: 'sniper', kind: 'ladder', at: [26.0, 45.2], ladder: 'ladder_sw' },
    { tag: 'm02 GB MG ladder', mis: 'm02', who: 'greenberet', kind: 'ladder', linkId: 1 },
    // (walked up to from 2.5 m out: on master the platform's solid stopped him short of its foot — never climbed)
    { tag: 'm02 GB MG ladder walked up to', mis: 'm02', who: 'greenberet', kind: 'ladder', linkId: 1, back: 2.5 },
    { tag: 'm01 GB wall_s', mis: 'm01', who: 'greenberet', kind: 'climb', at: [17.6, 127.6], linkAt: [18.18, 127.96], up: [20.32, 129.04], down: [18.18, 127.96] },
    // (from the foot of the cliff: on its top he is kept on his belly — M8's cliff tops — and the pose eases in from that)
    { tag: 'm08 GB cliff', mis: 'm08', who: 'greenberet', kind: 'climb', at: [48, 27.3], linkAt: [48, 22.2], up: [48, 22.2], down: [48, 26.5] },
    { tag: 'm11 GB tank ladder', mis: 'm11', who: 'greenberet', kind: 'ladder', drawnFirst: true, back: 2 },
  ].filter((s) => !only || only.split(',').some((o) => s.tag.includes(o)));
  const bad = [];
  for (const S of SC) {
    const r = await page.evaluate(async ({ S, PEN, JUMP, FLIP, DEBUG }) => {
      const G = window.__game, g = G.game, THREE = await import('three'), dt = G.CONFIG.sim.dt;
      const { MISSIONS } = await import('/src/missions/index.js');
      const LF = await import('/src/art/ladder-frame.js');
      const um = await import('/src/art/unit-model.js');
      const { steepLadder } = await import('/src/entities/stair-walk.js');
      const base = MISSIONS.find((m) => m.id === S.mis);
      await G.loadMission({ ...base, id: `${S.mis}_climbtest`, commandos: [{ role: S.who, x: S.at?.[0] ?? 1, z: S.at?.[1] ?? 1, heading: 0, inventory: {} }], enemies: [] });
      G.start(); g.stop();
      const w = g.world, grid = w.grid;
      for (const e of [...w.entities]) if (e.kind === 'vehicle' || e.kind === 'enemy' || e.kind === 'dog') w.remove(e);
      w.flushRemovals?.();
      const u = w.commandos[0];
      let L, F = null, start, foot, top;
      if (S.kind === 'ladder') {
        L = S.ladder ? grid.links.find((l) => l.id === w.ladders.find((q) => q.id === S.ladder).linkId)
          : S.linkId ? grid.links.find((l) => l.id === S.linkId)
            : grid.links.find((l) => l.kind === 'ladder' && !l.walk && steepLadder(l) && LF.ladderFrame(w, l)?.source === 'drawn');
        if (!L.enabled) { grid.setLinkEnabled(L.id, true); const it = w.interactables.find((i) => i.interactKind === 'ladder' && i.linkId === L.id); if (it) it.lowered = true; }
        [foot, top] = L.a.y <= L.b.y ? [L.a, L.b] : [L.b, L.a];
        F = LF.ladderFrame(w, L);
        start = S.at ? { x: S.at[0], z: S.at[1] } : { x: foot.x - F.fx * (S.back ?? 0), z: foot.z - F.fz * (S.back ?? 0) };
        u.setPosition(start.x, start.z, Math.atan2(F.fz, F.fx)); u.y = foot.y;
      } else {
        start = { x: S.at[0], z: S.at[1] };
        L = grid.links.filter((l) => l.kind === 'climb').sort((p, q) => Math.min(Math.hypot(p.a.x - S.linkAt[0], p.a.z - S.linkAt[1]), Math.hypot(p.b.x - S.linkAt[0], p.b.z - S.linkAt[1])) - Math.min(Math.hypot(q.a.x - S.linkAt[0], q.a.z - S.linkAt[1]), Math.hypot(q.b.x - S.linkAt[0], q.b.z - S.linkAt[1])))[0];
        u.setPosition(start.x, start.z, Math.atan2(S.up[1] - start.z, S.up[0] - start.x));
        if (S.atY != null) { u.y = S.atY; u.prevY = S.atY; }
      }
      // the drawn static scenery round the climb (what is drawn: a mesh off the camera's layer or writing no colour hidden)
      // (every model of the scenery loaded and drawn — a cliff's rock still a proxy is no face to measure against)
      await u.model.ready;
      for (let i = 0; i < 400 && (!u.model.isReal || i < 40); i++) { await new Promise((r) => setTimeout(r, 30)); g.render(1 / 60, 1); }
      const ends = S.kind === 'ladder' ? [foot, top, start] : [L.a, L.b, start];
      const box = new THREE.Box3(new THREE.Vector3(Math.min(...ends.map((e) => e.x)) - 2.5, Math.min(...ends.map((e) => e.y ?? 0)) - 0.6, Math.min(...ends.map((e) => e.z)) - 2.5),
        new THREE.Vector3(Math.max(...ends.map((e) => e.x)) + 2.5, Math.max(...ends.map((e) => e.y ?? 0)) + 4, Math.max(...ends.map((e) => e.z)) + 2.5));
      const skip = new Set(); for (const e of w.entities) if (e.object3d && /^(commando|enemy|vehicle|dog)$/.test(e.kind)) skip.add(e.object3d);
      g.renderer.scene.updateMatrixWorld(true);
      const hid = [];
      g.renderer.scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.visible && (!(o.layers.mask & 1) || [].concat(o.material || []).every((x) => x?.colorWrite === false))) { hid.push(o); o.visible = false; } });
      const bvh = LF._debug.collectParts(g.renderer.scene, box, skip);
      for (const o of hid) o.visible = true;
      const bp = bvh.geometry.attributes.position, bi = bvh.geometry.index;
      const A = new THREE.Vector3(), Bv = new THREE.Vector3(), Cv = new THREE.Vector3(), n = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tgt = {};
      const faceN = (fi) => { const i0 = bi ? bi.getX(fi * 3) : fi * 3, i1 = bi ? bi.getX(fi * 3 + 1) : fi * 3 + 1, i2 = bi ? bi.getX(fi * 3 + 2) : fi * 3 + 2; A.fromBufferAttribute(bp, i0); Bv.fromBufferAttribute(bp, i1); Cv.fromBufferAttribute(bp, i2); return n.subVectors(Bv, A).cross(Cv.sub(A)).normalize(); };
      const region = (nm) => (/^(hand|index|middle|pinky|ring|thumb)/.test(nm) ? 'hand' : /^(foot|ball)/.test(nm) ? 'foot' : /^(thigh|calf)/.test(nm) ? 'leg' : /^(lowerarm|upperarm|clavicle)/.test(nm) ? 'arm' : /^(Head|head|neck)/.test(nm) ? 'head' : 'torso');
      const meshes = [];
      u.model.root.traverse((o) => {
        if (!(o.isMesh || o.isSkinnedMesh) || !o.geometry?.attributes?.position) return;
        if (/ring|shadow|select|decal|blob|marker/i.test(o.name + ' ' + (o.parent?.name || ''))) return;
        const nV = o.geometry.attributes.position.count, reg = new Array(nV);
        if (o.isSkinnedMesh) { const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight, bn = o.skeleton.bones; for (let i = 0; i < nV; i++) { let bix = si.getX(i), bw = sw.getX(i); for (const [a, b] of [[si.getY(i), sw.getY(i)], [si.getZ(i), sw.getZ(i)], [si.getW(i), sw.getW(i)]]) if (b > bw) { bw = b; bix = a; } reg[i] = region(bn[bix]?.name || ''); } } else reg.fill('prop');
        meshes.push({ o, reg, nV, stride: Math.max(1, Math.round(nV / 5000)) });
      });
      const visDeep = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
      const worst = { depth: 0, where: '' }, worstHand = { depth: 0, where: '' };
      const penSample = (f, ph) => {
        for (const q of meshes) {
          if (!visDeep(q.o)) continue;
          q.o.updateWorldMatrix(true, false);
          for (let i = 0; i < q.nV; i += q.stride) {
            if (q.o.isSkinnedMesh) { q.o.getVertexPosition(i, v); v.applyMatrix4(q.o.matrixWorld); } else v.fromBufferAttribute(q.o.geometry.attributes.position, i).applyMatrix4(q.o.matrixWorld);
            const hit = bvh.closestPointToPoint(v, tgt, 0, 0.3);
            if (!hit || hit.distance > 0.3) continue;
            faceN(hit.faceIndex);
            const sd = n.x * (v.x - hit.point.x) + n.y * (v.y - hit.point.y) + n.z * (v.z - hit.point.z);
            if (sd >= -0.004 || -sd < 0.8 * hit.distance) continue;
            const uh = bvh.raycastFirst(new THREE.Ray(v.clone(), up), THREE.DoubleSide, 0, 8);
            if (!uh || !(uh.face?.normal?.y > 0)) continue;
            const W = q.reg[i] === 'hand' ? worstHand : worst;
            if (hit.distance > W.depth) {
              const st = u.model._lc?.state;
              W.depth = hit.distance;
              const Fr = st?.frame, lv = Fr ? LF.local(Fr, v) : null, lb = Fr ? ['l', 'r'].map((sd) => { const b = LF.local(Fr, B['ball_' + sd].getWorldPosition(new THREE.Vector3())); return `${sd} l${b.l.toFixed(2)} o${b.o.toFixed(2)}`; }).join(' ') : '';
              W.where = `${q.reg[i]} f${f} ${ph} at (${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})${st ? ` P ${st.P?.toFixed(2)}${st.lead != null ? ` walking ${st.end}` : ''}${st.vault != null ? ` onto the deck ${st.vault.toFixed(2)}` : ''} ${st.feet?.l?.zone}/${st.feet?.r?.zone}` : ''}${DEBUG && lv ? ` [frame l${lv.l.toFixed(2)} o${lv.o.toFixed(2)} w${lv.w.toFixed(2)}; balls ${lb}; H ${Fr.H} over ${Fr.over}; dbg ${JSON.stringify(st.dbg)}; pel ${B.pelvis.getWorldPosition(new THREE.Vector3()).toArray().map((x) => x.toFixed(2))}; foot ${JSON.stringify(Fr.foot)} top ${JSON.stringify(Fr.top)} f ${Fr.fx.toFixed(2)},${Fr.fz.toFixed(2)} s0 ${Fr.s0.toFixed(2)} deckSurf ${Fr.deckSurf} footSurf ${Fr.footSurf}; w ${u.model._lc?.w?.toFixed(3)} root ${u.model.root.position.toArray().map((x) => x.toFixed(2))} sim ${[u.x, u.y, u.z].map((x) => (+x).toFixed(2))} stance ${u.stance} anim ${u.model.anim} clip ${u.model.clip}]` : ''}`;
            }
          }
        }
      };
      const order = (leg) => {
        if (S.kind === 'climb') { const to = S[leg]; return u.issue({ type: 'ability', id: 'climb', target: { x: to[0], z: to[1] } }); }
        const goal = leg === 'up' ? top : start;
        return u.issue({ type: 'move', x: goal.x, z: goal.z });
      };
      const busy = () => !!(u.path || u._ladder || u._climb || u.model._lc);
      const B = u.model.real.inner.bones, pel = () => B.pelvis.getWorldPosition(new THREE.Vector3());
      const out = { tag: S.tag, frames: 0, jump: 0, jumpAt: '', walkJump: 0, walkJumpAt: '', flip: 0, flipAt: '', turn: 0, turnAt: '', behind: 0, behindAt: '', reached: { up: false, down: false } };
      let prev = null, used = false, prevLeg = null, wasOnFeet = false;
      const legAt = () => ({ kl: B.calf_l.getWorldPosition(new THREE.Vector3()), kr: B.calf_r.getWorldPosition(new THREE.Vector3()), fl: B.foot_l.getWorldPosition(new THREE.Vector3()), fr: B.foot_r.getWorldPosition(new THREE.Vector3()), yaw: u.model.root.rotation.y });
      // (on his feet first: M8's men start on their bellies, and are on them again on a cliff top — getting up is no
      // part of the climb)
      const standUp = () => { if (u.stance === 'stand') return; u.issue({ type: 'stance', stance: 'stand' }); for (let i = 0; i < 90; i++) { if (g.state !== 'playing') g.state = 'playing'; g.step(dt); um.charactersFrame(false); u.syncTransform?.(1); u.renderUpdate?.(dt); um.transportFrame(); } prev = null; prevLeg = null; };
      for (const leg of ['up', 'down']) {
        standUp();
        if (!order(leg)) { out.err = `${leg} refused: ${u.lastRefusal?.text}`; break; }
        let idle = 0;
        for (let f = 0; f < 60 * 40; f++) {
          if (g.state !== 'playing') g.state = 'playing';
          g.step(dt);
          um.charactersFrame(false);
          for (const e of w.entities) if (e.kind === 'commando') { e.syncTransform?.(1); e.renderUpdate?.(dt); }
          um.transportFrame();
          out.frames++;
          used ||= !!(u._ladder || u._climb);
          const p = pel();
          // (a jump of the posed body — on the link or easing in / out of it; the walk to it is the walk's own)
          const posed = !!(u._ladder || u._climb || u.model._lc);
          if (prev && posed) { const d = p.distanceTo(prev); if (d > out.jump) { out.jump = d; out.jumpAt = `f${out.frames} ${leg}`; } }
          // (and walking to / from it: M11's tank plinth lifted him 30 cm in a frame as his boot found its top)
          // (on his feet: getting up off his belly — M8's men start on them — is the get-up clip's own)
          const onFeet = u.stance === 'stand' && !(u._stanceT > 0) && !u.model._tr;
          if (prev && !posed && onFeet && wasOnFeet) { const d = p.distanceTo(prev); if (d > out.walkJump) { out.walkJump = d; out.walkJumpAt = `f${out.frames} ${leg}`; } }
          prev = p; wasOnFeet = onFeet;
          // (a knee swinging round its leg's line — further than its foot moved — turned over)
          const lg = legAt();
          // (his facing: the sim turned him about at a climb's start in one frame — M1's wall, M2's palisade, back the way
          // he came — his whole body round with it)
          const dy = prevLeg ? Math.abs(Math.atan2(Math.sin(lg.yaw - prevLeg.yaw), Math.cos(lg.yaw - prevLeg.yaw))) : 0;
          if (dy > out.turn) { const st = u.model._lc?.state; out.turn = dy; out.turnAt = `f${out.frames} ${leg}${st ? ` P ${st.P?.toFixed(2)}${st.vault != null ? ` onto the deck ${st.vault.toFixed(2)}` : ''} w ${u.model._lc.w.toFixed(2)}` : ' unposed'} heading ${u.heading.toFixed(2)} climb ${!!u._climb} ladder ${!!u._ladder}`; }
          if (prevLeg && posed) for (const sd of ['l', 'r']) { const d = lg['k' + sd].distanceTo(prevLeg['k' + sd]) - lg['f' + sd].distanceTo(prevLeg['f' + sd]); if (d > out.flip) { const st = u.model._lc?.state; out.flip = d; out.flipAt = `f${out.frames} ${leg} knee ${sd.toUpperCase()}${st ? ` P ${st.P?.toFixed(2)}${st.vault != null ? ` onto the deck ${st.vault.toFixed(2)}` : ''} ${st.feet?.l?.zone}/${st.feet?.r?.zone} w ${u.model._lc.w.toFixed(2)}` : ''}`; } }
          prevLeg = lg;
          if (F && p.y - F.foot.y < 1.2) {
            const q = LF.local(F, p);
            if (Math.abs(q.w) < F.halfW + 0.3 && q.o < 0.25 && q.l < 1.5) { out.behind++; if (!out.behindAt) out.behindAt = `f${out.frames} ${leg} o ${q.o.toFixed(2)}`; }
          }
          // (not while the pose eases out into a man lying down — M8's cliff top has him on his belly at once: the prone
          // body on a rock's top is the prone layer's)
          const easingProne = u.stance !== 'stand' && (u.model._lc?.w ?? 1) < 0.999;
          if (out.frames % 3 === 0 && (u._ladder || u._climb || u.model._lc || u.path) && !easingProne) penSample(out.frames, leg);
          if (!busy()) { if (++idle > 20) break; } else idle = 0;
        }
        const goal = S.kind === 'climb' ? S[leg] : leg === 'up' ? top : start;
        const gx = Array.isArray(goal) ? goal[0] : goal.x, gz = Array.isArray(goal) ? goal[1] : goal.z;
        out.reached[leg] = Math.hypot(u.x - gx, u.z - gz) < 0.8;
      }
      out.used = used;
      out.pen = worst; out.penHand = worstHand;
      return out;
    }, { S, PEN, JUMP, FLIP, DEBUG: !!process.env.CLIMB_DEBUG });
    const why = [];
    if (r.err) why.push(r.err);
    if (!r.used) why.push('never on the ladder / wall');
    if (!r.reached.up || !r.reached.down) why.push(`did not get there and back (${JSON.stringify(r.reached)})`);
    if (r.pen.depth > PEN.body) why.push(`body ${(r.pen.depth * 100).toFixed(1)} cm inside (${r.pen.where})`);
    if (r.penHand.depth > PEN.hand) why.push(`hand ${(r.penHand.depth * 100).toFixed(1)} cm inside (${r.penHand.where})`);
    if (r.behind) why.push(`pelvis behind / in the ladder at its foot ×${r.behind} (${r.behindAt})`);
    if (r.jump > JUMP) why.push(`pelvis jumped ${(r.jump * 100).toFixed(1)} cm in a frame (${r.jumpAt})`);
    if (r.walkJump > JUMP) why.push(`pelvis jumped ${(r.walkJump * 100).toFixed(1)} cm in a frame walking to / from it (${r.walkJumpAt})`);
    if (r.turn > TURN) why.push(`turned ${(r.turn * 180 / Math.PI).toFixed(0)}° in a frame (${r.turnAt})`);
    if (r.flip > FLIP) why.push(`a knee turned over: ${(r.flip * 100).toFixed(1)} cm further than its foot in a frame (${r.flipAt})`);
    t.log(`${why.length ? 'FAIL' : 'ok  '} ${r.tag}: ${r.frames} frames, body in ${(r.pen.depth * 100).toFixed(1)} cm, hand in ${(r.penHand.depth * 100).toFixed(1)} cm, behind ${r.behind}, max pelvis step ${(r.jump * 100).toFixed(1)} cm (walking ${(r.walkJump * 100).toFixed(1)}), max turn ${(r.turn * 180 / Math.PI).toFixed(0)}°, knee past foot ${(r.flip * 100).toFixed(1)} cm${why.length ? ' — ' + why.join(' / ') : ''}`);
    if (why.length) bad.push(`${r.tag}: ${why.join(' / ')}`);
  }
  t(!bad.length, `climbing: ${bad.join(' || ')}`);
}
