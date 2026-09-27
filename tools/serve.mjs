#!/usr/bin/env node
/**
 * Zero-dependency static file server for SHADOW SIX (no build step: the repo root is the web root).
 *
 *   node tools/serve.mjs [port]        # default 8080; port 0 = pick a free port
 *
 * Also importable: `const { url, close } = await startServer({ port: 0 })` (used by tests/harness.mjs).
 */
import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { extname, join, normalize, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Content types by extension (lower case). */
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.ktx2': 'image/ktx2',
  '.hdr': 'image/vnd.radiance',
  '.exr': 'image/x-exr',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.cube': 'text/plain; charset=utf-8',
};

/**
 * Start serving `root`.
 * @param {{port?: number, root?: string, host?: string, quiet?: boolean}} [opts]
 * @returns {Promise<{server: import('node:http').Server, port: number, url: string, close: () => Promise<void>}>}
 */
export function startServer({ port = 8080, root = ROOT, host = '127.0.0.1', quiet = true } = {}) {
  const rootAbs = resolve(root);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = normalize(join(rootAbs, rel));
      if (file !== rootAbs && !file.startsWith(rootAbs + sep)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const st = await fs.stat(file).catch(() => null);
      if (!st || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
        if (!quiet) console.log(`404 ${req.url}`);
        return;
      }
      const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': st.size,
        'Cache-Control': 'no-cache',
        'Cross-Origin-Opener-Policy': 'same-origin',
      });
      if (req.method === 'HEAD') return res.end();
      createReadStream(file).pipe(res);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  return new Promise((resolveP, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolveP({
        server,
        port: actual,
        url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${actual}/`,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 8080);
  const { url } = await startServer({ port, quiet: false, host: process.env.HOST || '127.0.0.1' });
  console.log(`SHADOW SIX dev server: ${url}  (root ${ROOT})`);
}
