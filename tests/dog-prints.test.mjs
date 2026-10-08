/**
 * Dog paw prints on the M3 snow (user 2026-10-08: "Dog is leaving human footprints"), real character library and
 * terrain, every tick drawn with the camera on the walker. A guard dog walking and trotting, then a commando walking a
 * parallel line:
 *   - the dog's trail stamps are paw prints only (trail kind 'paw', foot 'dog'), never boot prints ('walker');
 *   - one print per paw touchdown of the gait clip playing: four a stride, each where that paw's pads stand on the
 *     frame it is stamped (the sole on the live skeleton);
 *   - the trot comes in diagonal pairs (a fore and the opposite hind within a few frames), the trail is narrow;
 *   - on the GPU deformation RT, a paw print is a small dimple, a fraction of a boot print's area;
 *   - the man next to it still stamps boot prints.
 */
export const timeout = 300_000;

export default async function dogPrints(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const H = await import('/tests/bodies-page.mjs');
    const THREE = await import('three');
    const { Commando } = await import('/src/entities/commando.js');
    const { Enemy } = await import('/src/entities/enemy.js');
    await g.loadMission('m03'); g.start(); await G.mapHandle?.ready;
    const W = G.world, TH = W.terrain;
    await TH.ready;
    const trails = TH.terrain.trails;
    W.enemies.forEach(H.freeze);
    for (const e of W.enemies) e.coneVisible = false;
    const spot = H.openSpot(W, 100, 60, 14);
    H.clearArea(W, spot.x, spot.z, 26);
    g.setZoom?.(2);
    const dog = new Enemy({ id: 'dp_dog', soldierType: 'dog', x: spot.x - 7, z: spot.z - 2, heading: 0 });
    W.add(dog); await dog.model.ready; H.freeze(dog);
    const man = new Commando({ role: 'driver', x: spot.x - 7, z: spot.z + 2, heading: 0 });
    W.add(man); await man.model.ready;
    const inner = dog.model.real.inner, P = inner.pawContacts.paws;
    const bone = (n) => { let b = null; inner.object.traverse((o) => { if (!b && o.isBone && o.name === n) b = o; }); return b; };
    const soles = P.map((p) => ({ name: p.name, side: p.side, b: bone(p.name), s: new THREE.Vector3(...p.sole) }));
    // every trail stamp, with the dog's soles at that moment (stampWorld runs after the skeletons are posed)
    let frame = 0, phase = '', cur = null;
    const log = [], prints = [], v = new THREE.Vector3(), stamp0 = trails.stamp.bind(trails), push0 = trails._push.bind(trails);
    const soleAt = (q) => { q.b.updateWorldMatrix(true, false); return v.copy(q.s).applyMatrix4(q.b.matrixWorld); };
    trails.stamp = (kind, x, z, h, o = {}) => {
      if (o.record === true) return stamp0(kind, x, z, h, o);   // stamp()'s own re-entry for record:false calls
      const e = { kind, id: o.id, foot: o.foot ?? null, x, z, w: o.width ?? null, l: o.length ?? null, side: o.side ?? null, frame, phase, clip: dog.model.clip, gait: inner.anim };
      if (o.id === 'u' + dog.id && kind === 'paw') {
        const d = soles.map((q) => { const p = soleAt(q); return { q, n: q.name, side: q.side, d: Math.hypot(p.x - x, p.z - z), y: p.y }; }).sort((a, b) => a.d - b.d);
        e.near = d[0]; e.best = d[0].d;
      }
      log.push(e);
      cur = o.id ?? null;
      try { return stamp0(kind, x, z, h, o); } finally { cur = null; }
    };
    // every quad pushed (the prints themselves: kind 2 boot, 7 paw)
    trails._push = (k, x, z, ...rest) => { prints.push({ k, x, z, frame, phase, id: cur }); return push0(k, x, z, ...rest); };
    const settle = () => { // each dog print vs its paw's sole over the frames after it was stamped (the paw planting)
      for (const e of log) if (e.near && frame - e.frame <= 10) { const p = soleAt(e.near.q); e.best = Math.min(e.best, Math.hypot(p.x - e.x, p.z - e.z)); }
    };
    const tick = (u) => { G.step(1 / 60); frame++; for (const e of W.enemies) if (e.brain && !e.brain.frozen) H.freeze(e); g.centerOn(u.x, u.z); G.render(1 / 60, 1); settle(); };
    const walk = (u, x, z, ph, n) => { phase = ph; u.moveTo(x, z); for (let i = 0; i < n && (u.path || i < 3); i++) tick(u); u.stop?.(); u.path = null; for (let i = 0; i < 20; i++) tick(u); };
    // a dog's walk (sniffing pace ~0.55 m/s), its trot (1.3 m/s), then the man's walk
    const dogV = (s) => { dog.speedMul = 1; dog.speedMul = s / dog.speed; };
    dogV(0.55); walk(dog, dog.x + 5, dog.z, 'walk', 700);
    dog.setPosition(spot.x - 7, spot.z - 0.5); dog.heading = 0; for (let i = 0; i < 5; i++) tick(dog);
    dogV(1.3); walk(dog, dog.x + 7, dog.z, 'trot', 500);
    walk(man, man.x + 7, man.z, 'man', 400);
    const did = 'u' + dog.id, mid = 'u' + man.id;
    const dogS = log.filter((e) => e.id === did), manS = log.filter((e) => e.id === mid);
    // the trail RT under a stamp: the dimple's area (texels deeper than half its deepest) in a 0.5 m window
    const N = 96, rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    const mat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: trails.texture }, uRect: { value: new THREE.Vector4() } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tSrc; uniform vec4 uRect; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tSrc, uRect.xy + vUv * uRect.zw).rg, 0.0, 1.0); }',
      depthTest: false, depthWrite: false,
    });
    const sc = new THREE.Scene(), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false; sc.add(quad);
    const cam = new THREE.Camera(), gl = G.renderer.renderer, px = new Float32Array(N * N * 4);
    const dimple = (x, z, win = 0.5) => {
      mat.uniforms.uRect.value.set((x - win / 2) / trails.W, (z - win / 2) / trails.D, win / trails.W, win / trails.D);
      const prev = gl.getRenderTarget(); gl.setRenderTarget(rt); gl.render(sc, cam); gl.readRenderTargetPixels(rt, 0, 0, N, N, px); gl.setRenderTarget(prev);
      let mx = 0; for (let i = 0; i < N * N; i++) mx = Math.max(mx, px[i * 4]);
      let n = 0; for (let i = 0; i < N * N; i++) if (px[i * 4] > mx * 0.5) n++;
      return { depth: +mx.toFixed(3), area: +(n * (win / N) ** 2).toFixed(4) };
    };
    const pick = (S, k) => S[Math.floor(S.length * k)];
    const pawP = prints.filter((p) => p.k === 7 && p.id === did && p.phase === 'walk'), bootP = prints.filter((p) => p.k === 2 && p.id === mid);
    const rtPaw = [0.3, 0.5, 0.7].map((k) => dimple(pick(pawP, k).x, pick(pawP, k).z, 0.3));
    const rtBoot = [0.3, 0.5, 0.7].map((k) => dimple(pick(bootP, k).x, pick(bootP, k).z, 0.6));
    rt.dispose(); mat.dispose();
    const across = (S) => { const zs = S.map((e) => e.z); return Math.max(...zs) - Math.min(...zs); };
    const out = { texelM: trails.stampMat.uniforms.uTexelM.value, mat: TH.materialAt(dog.x, dog.z)?.name };
    for (const ph of ['walk', 'trot']) {
      const S = dogS.filter((e) => e.phase === ph);
      const xs = S.map((e) => e.x), dist = Math.max(...xs) - Math.min(...xs);
      // diagonal pairs (trot): consecutive prints within 4 frames, one left / one right
      let pairs = 0, paired = 0;
      for (let k = 0; k + 1 < S.length; k++) if (S[k + 1].frame - S[k].frame <= 4) { pairs++; if (S[k].side === -S[k + 1].side && S[k].near?.n[0] !== S[k + 1].near?.n[0]) paired++; k++; }
      out[ph] = { n: S.length, kinds: [...new Set(S.map((e) => `${e.kind}:${e.foot}`))], dist: +dist.toFixed(2), gaits: [...new Set(S.map((e) => e.gait))],
        nearMax: +Math.max(...S.map((e) => e.near?.d ?? 9)).toFixed(3), bestMax: +Math.max(...S.filter((e) => frame - e.frame > 10).map((e) => e.best ?? 9)).toFixed(3), sideOk: S.every((e) => e.near && e.near.side === e.side), soleY: +Math.max(...S.map((e) => e.near?.y ?? 9)).toFixed(3),
        across: +across(S).toFixed(3), pairs, paired, w: +Math.max(...S.map((e) => e.w)).toFixed(3), l: +Math.max(...S.map((e) => e.l)).toFixed(3),
        perStride: +(S.length / Math.max(0.01, dist)).toFixed(2) };
    }
    out.dogKinds = [...new Set(dogS.map((e) => e.kind))];
    out.man = { n: bootP.length, kinds: [...new Set(manS.map((e) => e.kind))], across: +across(bootP).toFixed(3) };
    out.prints = { paw: prints.filter((p) => p.k === 7 && p.id === did).length, boot: bootP.length, dogBoots: prints.filter((p) => p.k === 2 && p.id === did).length,
      birds: prints.filter((p) => p.k === 7 && p.id == null).length };
    out.rtPaw = rtPaw; out.rtBoot = rtBoot;
    out.groundY = TH.groundY(dog.x, dog.z);
    trails.stamp = stamp0;
    g.centerOn(spot.x - 1, spot.z); G.render(0, 1);
    return out;
  });
  console.log('    [dog-prints]', JSON.stringify(r));
  t.ok(r.mat === 'snow' || /snow/.test(r.mat || ''), `on snow (${r.mat})`);
  t.ok(r.dogKinds.length === 1 && r.dogKinds[0] === 'paw', `the dog stamps only paw prints (${r.dogKinds})`);
  for (const ph of ['walk', 'trot']) {
    const d = r[ph];
    t.ok(d.kinds.length === 1 && d.kinds[0] === 'paw:dog', `${ph}: dog paw prints (${d.kinds})`);
    t.ok(d.gaits.includes(ph), `${ph}: the ${ph} clip played (${d.gaits})`);
    t.ok(d.dist > 3, `${ph}: walked ${d.dist} m`);
    t.ok(d.nearMax < 0.05, `${ph}: every print at its paw's pads as they come down (worst ${d.nearMax} m)`);
    t.ok(d.bestMax < 0.02, `${ph}: …and under them once planted (worst ${d.bestMax} m)`);
    t.ok(d.sideOk, `${ph}: left prints from left paws, right from right`);
    t.ok(d.soleY - r.groundY < 0.06, `${ph}: the pads are down when the print appears (highest ${(d.soleY - r.groundY).toFixed(3)} m above the snow)`);
    t.ok(d.across < 0.2, `${ph}: a narrow trail (${d.across} m across)`);
    t.ok(d.w < 0.1 && d.l < 0.1, `${ph}: paw-sized prints (${d.w} × ${d.l} m)`);
  }
  // four prints a stride: walk stride 0.51 m (~7.8 / m), trot 0.86 m (~4.6 / m)
  t.ok(Math.abs(r.walk.perStride - 4 / 0.51) < 2, `walk: four prints a 0.51 m stride (${r.walk.perStride} / m)`);
  t.ok(Math.abs(r.trot.perStride - 4 / 0.86) < 1.4, `trot: four prints a 0.86 m stride (${r.trot.perStride} / m)`);
  t.ok(r.trot.pairs >= 5 && r.trot.paired === r.trot.pairs, `trot: diagonal pairs (${r.trot.paired}/${r.trot.pairs})`);
  t.ok(r.man.n >= 6 && r.man.kinds.length === 1 && r.man.kinds[0] === 'walker', `the man stamps boot prints (${r.man.kinds}, ${r.man.n})`);
  t.ok(r.prints.dogBoots === 0 && r.prints.paw === r.walk.n + r.trot.n, `no boot print while the dog walked (${r.prints.dogBoots}); one paw quad a footfall (${r.prints.paw})`);
  t.ok(r.man.across > r.trot.across, `the man's trail is wider (${r.man.across} vs ${r.trot.across} m)`);
  const paw = Math.max(...r.rtPaw.map((d) => d.area)), boot = Math.min(...r.rtBoot.map((d) => d.area));
  t.ok(r.rtPaw.every((d) => d.depth > 0.2), `paw dimples on the trail RT (${r.rtPaw.map((d) => d.depth)})`);
  t.ok(paw < boot * 0.35, `a paw print is a small dimple next to a boot print (${paw} vs ${boot} m²)`);
  await t.shot('dog-prints-m03');
}
