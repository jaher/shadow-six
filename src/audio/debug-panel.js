/**
 * Audio debug overlay (dev/test only): bus levels and live voice counts, siren envelope, current
 * music/ambience, the last voice line with its subtitle gloss, and the recent event → sound log.
 * Usage: const p = createAudioDebugPanel(game.audio); … p.dispose().
 * @module audio/debug-panel
 */

const CSS = `
.aud-dbg{position:fixed;top:56px;right:12px;width:340px;z-index:50;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;
  color:#e8e2cf;background:rgba(18,16,12,.86);border:1px solid #6b5d3e;border-radius:4px;padding:8px 10px;pointer-events:none}
.aud-dbg h4{margin:0 0 6px;font-size:11px;letter-spacing:.12em;color:#d9b45a;text-transform:uppercase}
.aud-dbg .row{display:flex;align-items:center;gap:6px;margin:2px 0}
.aud-dbg .lab{width:70px;flex:none;color:#b8ad8f}
.aud-dbg .row>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.aud-dbg .bar{flex:1;height:8px;background:#2c271d;border-radius:2px;overflow:hidden}
.aud-dbg .bar i{display:block;height:100%;background:#8fae5a}
.aud-dbg .bar.siren i{background:#d0482f}
.aud-dbg .n{width:48px;text-align:right;color:#cfc6ad}
.aud-dbg .sub{margin:6px 0;padding:5px 6px;background:#2a241a;border-left:3px solid #d9b45a;min-height:28px}
.aud-dbg .sub b{color:#fff3cf}.aud-dbg .sub em{color:#a9a08a}
.aud-dbg ol{margin:4px 0 0;padding-left:16px;max-height:170px;overflow:hidden}
.aud-dbg li{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.aud-dbg .k-voice{color:#9fc6e8}.aud-dbg .k-music{color:#e0a6e8}.aud-dbg .k-siren{color:#ff8a6a}.aud-dbg .k-ambience{color:#9fd79a}
.aud-dbg .dim{color:#7d745f}`;

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * @param {object} audio createAudio() instance
 * @param {HTMLElement} [root]
 */
export function createAudioDebugPanel(audio, root = document.body) {
  const style = document.createElement('style');
  style.textContent = CSS;
  const el = document.createElement('div');
  el.className = 'aud-dbg';
  root.append(style, el);
  let lastBark = [...audio.log].reverse().find((l) => l.type === 'voice' && l.text && l.gloss) || null; // latest subtitled line
  const tap = (e) => { if (!e.suppressed && e.text) lastBark = e; };
  const subs = [];
  if (audio._events) subs.push(audio._events.on('bark', (e) => queueMicrotask(() => tap(e))));
  let raf = 0;

  function render() {
    const d = audio.debug();
    const counts = {};
    for (const h of audio.engine?.active || []) counts[h.bus] = (counts[h.bus] || 0) + 1;
    const bus = (name) => {
      const v = name === 'master' ? (d.muted ? 0 : d.volumes.master) : d.volumes[name];
      return `<div class="row"><span class="lab">${name}</span><span class="bar"><i style="width:${(v * 100).toFixed(0)}%"></i></span>` +
        `<span class="n">${name === 'master' ? (d.muted ? 'MUTED' : '') : `${counts[name] || 0} src`}</span></div>`;
    };
    const log = audio.log.slice(-11).reverse().map((l) => {
      const what = l.type === 'voice' ? (l.dropped ? `<span class="dim">${esc(l.name)} ✕ ${esc(l.dropped)}</span>` : `${esc(l.speaker)}: “${esc(l.text)}”`)
        : l.type === 'music' ? `${esc(l.name)}${l.refused ? ' <span class="dim">refused (in mission)</span>' : l.stinger ? ' (stinger)' : ''}`
          : `${esc(l.name)}${l.event ? ` <span class="dim">← ${esc(l.event)}${l.gain != null && l.x != null ? ` g${l.gain}` : ''}</span>` : ''}`;
      return `<li class="k-${l.type}">${what}</li>`;
    }).join('');
    const b = lastBark;
    el.innerHTML = `<h4>Audio · ${d.unlocked ? 'live' : 'locked (awaiting gesture)'} · ${esc(d.gameState)}</h4>` +
      ['master', 'sfx', 'voice', 'ambience', 'music', 'ui'].map(bus).join('') +
      `<div class="row"><span class="lab">siren</span><span class="bar siren"><i style="width:${(d.siren.gain / 0.75 * 100).toFixed(0)}%"></i></span>` +
      `<span class="n">${d.siren.active ? d.siren.gain.toFixed(2) : 'off'}</span></div>` +
      `<div class="row"><span class="lab">music</span><span>${esc(d.music || '— (silence)')}</span></div>` +
      `<div class="row"><span class="lab">ambience</span><span>${esc(d.ambience.join(', ') || '—')}</span></div>` +
      `<div class="row"><span class="lab">streams</span><span>${esc(d.streams.map((s) => `${s.file}${s.playing ? '' : ' ⏸'}`).join(', ') || '—')}</span></div>` +
      `<div class="row"><span class="lab">decoded</span><span>${d.assets ? `${d.assets.buffers} buffers · ${(d.assets.bytes / 1048576).toFixed(1)} MB PCM · ` +
        `${d.assets.files} files / ${d.assets.voices} voice takes` : '<span class="dim">synth placeholders</span>'}</span></div>` +
      `<div class="sub">${b ? `<b>${esc(b.speaker)}:</b> ${esc(b.text)}${b.gloss && b.gloss !== b.text ? ` <em>(${esc(b.gloss)})</em>` : ''}` +
        `${b.take ? ` <span class="dim">[${esc(b.rec)} · ${esc(b.take)} take]</span>` : ''}` : '<span class="dim">no voice yet</span>'}</div>` +
      `<ol>${log}</ol>`;
    raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(render) : 0;
  }
  render();
  return {
    el,
    render,
    dispose() { if (raf) cancelAnimationFrame(raf); subs.forEach((f) => f()); el.remove(); style.remove(); },
  };
}
