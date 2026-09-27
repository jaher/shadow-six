// Static server for the kit review page. /vendor/* -> three.js vendor dir, /fs/<abs path> -> file system
// (only under ALLOW prefixes), / -> review.html. Usage: node server.mjs [port]
import http from 'http'; import fs from 'fs'; import path from 'path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const VENDOR = '<repo>/vendor';
const ALLOW = ['<claude-tmp>', '<repo>/'];
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.hdr': 'application/octet-stream', '.wasm': 'application/wasm' };
const port = +process.argv[2] || 18960;
http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let f;
  if (u === '/' || u === '/review.html') f = path.join(HERE, 'review.html');
  else if (u.startsWith('/vendor/')) f = path.join(VENDOR, u.slice(8));
  else if (u.startsWith('/fs/')) f = path.normalize(u.slice(3));
  else f = path.join(HERE, u);
  if (u.startsWith('/fs/') && !ALLOW.some(a => f.startsWith(a))) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end('404 ' + u); return; }
    res.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(d);
  });
}).listen(port, () => console.log('kit review server on', port));
