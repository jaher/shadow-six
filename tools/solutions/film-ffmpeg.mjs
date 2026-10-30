/**
 * Which ffmpeg the film tools use: one that can encode H.264 (the Playwright copy cannot). In order: the one asked for
 * (--ffmpeg), $FFMPEG, `ffmpeg` on the PATH, then the static builds that pip / uv / micromamba keep for imageio_ffmpeg.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const canEncode = (bin) => {
  const r = spawnSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  return r.status === 0 && /libx264/.test(r.stdout || '') && /\baac\b/.test(r.stdout || '');
};
const list = (d) => { try { return readdirSync(d); } catch { return []; } };

/** @returns {string} a path (or command) of an ffmpeg that has libx264 and AAC; throws when there is none */
export function findFfmpeg(explicit = null) {
  const found = [];
  const h = homedir();
  for (const hash of list(join(h, '.cache/uv/archive-v0'))) {
    const d = join(h, '.cache/uv/archive-v0', hash, 'imageio_ffmpeg/binaries');
    for (const f of list(d)) if (/^ffmpeg-/.test(f)) found.push(join(d, f));
  }
  for (const env of list(join(h, 'micromamba/envs'))) {
    for (const py of list(join(h, 'micromamba/envs', env, 'lib'))) {
      const d = join(h, 'micromamba/envs', env, 'lib', py, 'site-packages/imageio_ffmpeg/binaries');
      for (const f of list(d)) if (/^ffmpeg-/.test(f)) found.push(join(d, f));
    }
  }
  for (const c of [explicit, process.env.FFMPEG, 'ffmpeg', ...found]) {
    if (!c) continue;
    if ((c.includes('/') && !existsSync(c))) continue;
    if (canEncode(c)) return c;
  }
  throw new Error('no ffmpeg with libx264 + aac found: pass --ffmpeg <bin> or set $FFMPEG');
}
