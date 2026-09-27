/**
 * Talking portraits in the running game (docs/talking-portraits.md; design-spec §6.3): per mission the HUD mounts
 * the clips into every portrait slot + the speaker card, stills become photos, the first selected man's idle loop
 * plays (the others greyscale + paused), a recorded bark from the audio engine plays its exact clip in the man's top-left portrait (card mirrors)
 * in sync with the voice (drift vs the AudioContext clock), the urgent alt take gets its own clip, a death hides
 * the host (skull shows), and a missing manifest leaves the stills.  Screenshots int-portraits-m1..m3; frame cost
 * per preset with the clips live.
 */
export default async function portraits(page, t) {
  await page.keyboard.press('Shift'); // first gesture → AudioContext
  for (const id of ['m01', 'm02', 'm03']) {
    const r = await page.evaluate(async (mid) => {
      const g = window.__game, G = g.game, a = G.audio, hud = G.hud;
      await g.loadMission(mid);
      g.start();
      await G.mapHandle?.ready;
      await a.engine?.ready;
      await a.preloading;
      const ok = await hud.portraitsReady;
      const tp = hud.portraits, w = G.world;
      const cmds = w.commandos.filter((c) => c.alive);
      g.select([cmds[0].id]);
      g.centerOn(cmds[0].x, cmds[0].z);
      for (let i = 0; i < 4; i++) { g.advance(1 / 60); G.render(1 / 60, 1); }
      await new Promise((ok2) => setTimeout(ok2, 400));
      const slots = cmds.map((c) => tp?.slots.get(c)).filter(Boolean);
      const sel = tp.slots.get(cmds[0]), other = slots.find((s) => s !== sel);
      const out = { mid, ok, theme: tp?.theme, hosts: document.querySelectorAll('.hud-portrait-slot .tp-host').length, men: cmds.length,
        photos: [...document.querySelectorAll('.hud-portrait .face > img')].filter((i) => /assets\/portraits\/.+\.jpg$/.test(i.src) && i.naturalWidth > 0).length,
        idlePlaying: !!sel && !sel.idle.paused && sel.idle.readyState >= 2, idleT: sel?.idle.currentTime,
        othersPaused: slots.filter((s) => s !== sel).every((s) => s.idle.paused),
        greyOther: other ? getComputedStyle(other.idle).filter.includes('grayscale') : true,
        colourSel: sel ? !getComputedStyle(sel.idle).filter.includes('grayscale') : false,
        placeholderMouth: getComputedStyle(document.querySelector('.hud-portrait .mouth')).display };
      // a recorded acknowledgement: the audio engine plays the take, his portrait plays its exact clip
      const bark = a.say(cmds[0], 'ack_move', { force: true });
      await Promise.resolve();
      await new Promise((ok2) => setTimeout(ok2, 450));
      const cur = tp.cur;
      out.bark = { rec: bark?.rec, take: bark?.take, text: bark?.text };
      out.clip = cur?.entry?.clip || null;
      out.slotPlaying = !!cur && cur.v === tp.slots.get(cmds[0])?.line && !cur.v.paused && cur.v.classList.contains('on');
      const card = !document.querySelector('.hud-speaker-card').hidden;
      out.cardMirror = !card || (cur?.vs?.includes(tp.card.line) && !tp.card.line.paused);
      out.driftMs = cur ? Math.round((cur.v.currentTime - tp._expected(cur, cur.clk())) * 1000) : null;
      out.clock = cur ? (cur.clk() === a.engine?.ctx?.currentTime ? 'audio' : 'wall') : null;
      return out;
    }, id);
    await page.waitForTimeout(250);
    await t.shot(`int-portraits-${id}`);
    const e = await page.evaluate(async () => {
      const G = window.__game.game, a = G.audio, tp = G.hud.portraits, w = G.world;
      await new Promise((ok) => setTimeout(ok, 1800)); // line ends, card clip fades back
      const ended = !tp.talking;
      // the urgent take has its own clip
      const c = w.commandos.find((x) => x.alive);
      const alarm = w.alarm?.active;
      const bark = a.say(c, 'hurt', { force: true });
      await Promise.resolve();
      const urgent = { take: bark?.take, clip: tp.cur?.entry?.clip || null };
      if (!alarm) tp._stop(true);
      // death: host hidden so the skull shows
      const victim = w.commandos.filter((x) => x.alive).at(-1);
      victim.hp = 0; victim.alive = false;
      w.events.emit('unit:killed', { unit: victim, cause: 'test' });
      const hidden = tp.slots.get(victim)?.host.hidden === true;
      return { ended, urgent, hidden };
    });
    t.log(JSON.stringify({ ...r, ...e }));
    t.ok(r.ok, `${id}: talking portraits loaded`);
    t.equal(r.theme, 'snow', `${id}: snow grade`);
    t.equal(r.hosts, r.men, `${id}: a clip host in every portrait slot`);
    t.equal(r.photos, r.men, `${id}: stills are the photo posters`);
    t.ok(r.idlePlaying && r.othersPaused, `${id}: selected man's idle loop plays, others paused`);
    t.ok(r.greyOther && r.colourSel, `${id}: greyscale when unselected, colour when selected`);
    t.equal(r.placeholderMouth, 'none', `${id}: placeholder mouth retired`);
    t.ok(r.bark.rec && r.clip && r.clip.includes(`/${r.bark.rec}_`), `${id}: recorded bark "${r.bark.text}" -> clip ${r.clip}`);
    t.ok(r.slotPlaying, `${id}: his top-left portrait plays the line`);
    t.ok(r.cardMirror, `${id}: the speaker card (when shown) mirrors it`);
    t.ok(Math.abs(r.driftMs) <= 120, `${id}: lip-sync drift ${r.driftMs} ms (${r.clock} clock)`);
    t.ok(e.ended, `${id}: line ended, back to idle`);
    t.ok(e.urgent.clip && (e.urgent.take === 'alt') === e.urgent.clip.includes('_alt_'), `${id}: hurt take ${e.urgent.take} -> ${e.urgent.clip}`);
    t.ok(e.hidden, `${id}: dead man's clip hidden (skull shows)`);
  }
  // frame cost per preset with the clips live, and with them off
  const perf = await page.evaluate(async () => {
    const g = window.__game, G = g.game, gl = G.renderer.renderer.getContext?.();
    await g.loadMission('m01'); g.start(); await G.mapHandle?.ready; await G.hud.portraitsReady;
    const time = () => { for (let i = 0; i < 5; i++) { g.advance(1 / 60); G.render(1 / 60, 1); } gl?.finish?.();
      const t0 = performance.now(); for (let i = 0; i < 30; i++) { g.advance(1 / 60); G.render(1 / 60, 1); } gl?.finish?.(); return +((performance.now() - t0) / 30).toFixed(2); };
    const out = {};
    for (const q of ['low', 'medium', 'high', 'ultra']) { g.setPreset(q); out[q] = { on: time() }; }
    const videos = document.querySelectorAll('.tp-host video').length;
    G.hud.portraits.dispose(); G.hud.portraits = null;
    for (const q of ['low', 'medium', 'high', 'ultra']) { g.setPreset(q); out[q].off = time(); }
    g.setPreset('high');
    return { out, videos };
  });
  t.log('perf', JSON.stringify(perf));
  for (const [q, v] of Object.entries(perf.out)) t.ok(v.on < v.off * 1.25 + 2, `${q}: frame ${v.on} ms with clips vs ${v.off} ms without`);
  // missing manifest: the stills stay, nothing attached, no errors
  const fb = await page.evaluate(async () => {
    const G = window.__game.game, { TalkingPortraits } = await import('/src/ui/talking-portraits.js');
    const tp = new TalkingPortraits({ events: G.events, hud: G.hud, audio: G.audio, base: 'assets/portraits-missing/',
      fetch: async () => ({ ok: false }) });
    const ok = await tp.load(G.world.commandos);
    return { ok, hosts: document.querySelectorAll('.tp-host').length };
  });
  t.ok(fb.ok === false && fb.hosts === 0, 'missing manifest -> static stills, nothing attached');
}
