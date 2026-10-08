#!/usr/bin/env node
/**
 * Zero-dependency static file server for SHADOW SIX (no build step: the repo root is the web root).
 *
 *   node tools/serve.mjs [port]        # default 8080; port 0 = pick a free port
 *   node tools/serve.mjs 8080 --root dist --base /shadow-six/   # the web build, as GitHub Pages serves it
 *
 * Dev extra: `GET <dir>/?ls` answers the directory's file names as JSON (the debug walkthrough lists tools/solutions/;
 * the web build bakes that list in instead, so the static site never needs it).
 *
 * Also importable: `const { url, close } = await startServer({ port: 0 })` (used by tests/harness.mjs).
 */
import { createServer } from 'node:http';
import { createGzip } from 'node:zlib';
import { Transform } from 'node:stream';
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
 * @param {{port?: number, root?: string, host?: string, quiet?: boolean, base?: string}} [opts]
 *   gzip: compress text responses like GitHub Pages does (the static/--base mode turns it on).
 *   pages: cache headers like GitHub Pages (`max-age=600` + ETag, 304 on If-None-Match) instead of `no-cache`.
 *   base: URL path prefix the site lives under (GitHub Pages project sites: '/shadow-six/'); other paths 404.
 * @returns {Promise<{server: import('node:http').Server, port: number, url: string, close: () => Promise<void>}>}
 */
export function startServer({ port = 8080, root = ROOT, host = '127.0.0.1', quiet = true, base = '/', gzip = false, pages = false, mbit = 0, latencyMs = 0 } = {}) {
  let rootAbs = resolve(root);
  const stats = { requests: 0, ok: 0, notModified: 0, bytes: 0, paths: [] };
  // mbit: one shared link of that speed for every response (a throttled player connection, service worker fetches
  // included — DevTools throttling only covers the page itself); latencyMs: added before each response
  let linkFree = 0;
  const throttle = () => new Transform({
    transform(chunk, _enc, cb) {
      stats.bytes += chunk.length;
      if (!mbit) return cb(null, chunk);
      const now = Date.now();
      linkFree = Math.max(linkFree, now) + chunk.length / (mbit * 125);
      setTimeout(() => cb(null, chunk), Math.max(0, linkFree - now));
    },
  });
  base = ('/' + base + '/').replace(/\/+/g, '/');
  /** 404 with the site's 404.html when it has one (GitHub Pages behaviour), else plain text. */
  const notFound = async (res, req) => {
    if (!quiet) console.log(`404 ${req.url}`);
    const page = await fs.readFile(join(rootAbs, '404.html')).catch(() => null);
    if (page) res.writeHead(404, { 'Content-Type': MIME['.html'] }).end(page);
    else res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  };
  const server = createServer(async (req, res) => {
    try {
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
      const url = new URL(req.url, 'http://x');
      if (base !== '/' && (url.pathname === '/' || url.pathname === base.slice(0, -1))) {
        res.writeHead(302, { Location: base }).end();
        return;
      }
      if (!url.pathname.startsWith(base)) return notFound(res, req);
      let rel = decodeURIComponent(url.pathname.slice(base.length - 1));
      // `<dir>/?ls`: the directory's file names as JSON (dev tools: the debug walkthrough lists tools/solutions/)
      const list = rel.endsWith('/') && url.searchParams.has('ls');
      if (rel.endsWith('/') && !list) rel += 'index.html';
      const file = normalize(join(rootAbs, rel));
      if (file !== rootAbs && !file.startsWith(rootAbs + sep)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      if (list) {
        const names = await fs.readdir(file, { withFileTypes: true }).catch(() => null);
        if (!names) return notFound(res, req);
        const body = JSON.stringify(names.filter((d) => d.isFile() && !d.name.startsWith('.')).map((d) => d.name).sort());
        stats.requests++;
        stats.ok++;
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache', 'Content-Length': Buffer.byteLength(body) }).end(body);
        return;
      }
      const st = await fs.stat(file).catch(() => null);
      if (!st || !st.isFile()) return notFound(res, req);
      const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
      const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
      stats.requests++;
      if (pages && req.headers['if-none-match'] === etag) {
        stats.notModified++;
        res.writeHead(304, { ETag: etag, 'Cache-Control': 'max-age=600' }).end();
        return;
      }
      const gz = gzip && /^(text\/|application\/(json|javascript)|image\/svg)/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      res.writeHead(200, {
        'Content-Type': type,
        ...(gz ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : { 'Content-Length': st.size }),
        'Cache-Control': pages ? 'max-age=600' : 'no-cache',
        ...(pages ? { ETag: etag } : {}),
        'Cross-Origin-Opener-Policy': 'same-origin',
      });
      if (req.method === 'HEAD') return res.end();
      stats.ok++;
      if (stats.paths.length < 1e6) stats.paths.push(rel); // tests and tools/perf read what was served
      if (gz) createReadStream(file).pipe(createGzip({ level: 6 })).pipe(throttle()).pipe(res);
      else createReadStream(file).pipe(throttle()).pipe(res);
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
        stats,
        /** Serve another directory from now on (tests: a new deploy on the same origin). */
        setRoot(dir) { rootAbs = resolve(dir); },
        port: actual,
        url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${actual}${base}`,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(n); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const root = resolve(flag('--root') ?? ROOT), base = flag('--base') ?? '/';
  const port = Number(argv[0] ?? process.env.PORT ?? 8080);
  const { url } = await startServer({ port, root, base, gzip: base !== '/' || argv.includes('--gzip'), quiet: false, host: process.env.HOST || '127.0.0.1' });
  console.log(`SHADOW SIX ${root === ROOT ? 'dev' : 'static'} server: ${url}  (root ${root})`);
}
