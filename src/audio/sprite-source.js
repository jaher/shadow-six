/**
 * Audio sprites: a mission's hundreds of tiny clips travel as a few concatenated files, not one request each.
 *
 * tools/packs/build-packs.mjs concatenates the mission's clips per group (music | voice | sfx) into
 * assets/packs/<preset>-<mission>-<group>.sprite plus an index (<preset>-<mission>-audio.json) mapping each
 * audio-engine-relative clip URL ('voice/…', 'sfx/…', 'music/…', 'narration/…') to [group, offset, size].
 * This source loads the index and the group buffers once per mission; the audio engine (engine.js) and the
 * narrator (narration.js) ask it for a clip's bytes before fetching — a hit is one slice of an in-memory
 * buffer (a copy: decodeAudioData detaches what it is given). Groups that fail to load simply miss, and
 * every clip falls back to its own fetch exactly as before (sprites are build artifacts; a tree without
 * them behaves identically).
 * @module audio/sprite-source
 */

const PACKS_URL = new URL('../../assets/packs/', import.meta.url).href;

export class SpriteSource {
  constructor() {
    this.groups = new Map(); // group → ArrayBuffer
    this.entries = new Map(); // clip URL → [group, offset, size]
    this.ready = null; // Promise<boolean>: the open() in flight / done
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Load a mission's sprite index + group buffers (3 fetches, in parallel). Never rejects.
   * @param {string} mission @param {string} preset
   * @param {import('../engine/download-meter.js').DownloadMeter} [meter] live download figures: the index
   *   announces the groups' exact sizes into the meter's total; each group's bytes are counted as it lands
   * @returns {Promise<boolean>} true when any group loaded
   */
  open(mission, preset, meter) {
    this.ready = (async () => {
      try {
        const r = await fetch(`${PACKS_URL}${preset}-${mission}-audio.json`);
        if (!r.ok) return false;
        const idx = await r.json();
        this.entries = new Map(Object.entries(idx.entries || {}));
        if (meter) { let tot = 0; for (const s of Object.values(idx.sprites || {})) tot += s.bytes || 0; meter.addTotal(tot); }
        await Promise.all(Object.entries(idx.sprites || {}).map(async ([group, s]) => {
          try {
            const rr = await fetch(PACKS_URL + s.file);
            if (rr.ok) { const ab = await rr.arrayBuffer(); this.groups.set(group, ab); meter?.add(ab.byteLength); }
          } catch { /* that group misses; its clips fetch individually */ }
        }));
        return this.groups.size > 0;
      } catch { return false; }
    })();
    return this.ready;
  }

  /**
   * The clip's compressed bytes (a fresh copy), or null when this source does not have it — not in the
   * mission's index, its group failed to load, or open() has not finished (the caller falls back to fetch).
   * @param {string} url audio-engine-relative clip URL
   * @returns {ArrayBuffer|null}
   */
  bytes(url) {
    const e = this.entries.get(url);
    const buf = e ? this.groups.get(e[0]) : null;
    if (!e || !buf) { this.misses++; return null; }
    this.hits++;
    return buf.slice(e[1], e[1] + e[2]);
  }
}
