// static server for pipeline pages: /vendor/ (project three r186), /ex/ (three examples jsm), / -> scratchpad root
import http from 'http'; import fs from 'fs'; import path from 'path';
const S = '<claude-tmp>';
const P = '<repo>';
const roots = { '/vendor/': P + '/vendor/', '/ex/': P + '/node_modules/three/examples/jsm/', '/': S + '/' };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.bvh': 'text/plain' };
http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST') { // POST /save?path=<rel to scratchpad/chars>  (used by exporters)
    const rel = new URL(req.url, 'http://x').searchParams.get('path');
    const f = path.join(S, 'chars', rel.replace(/\.\./g, ''));
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.concat(chunks)); res.end('ok ' + f); });
    return;
  }
  let f = null; for (const [p, r] of Object.entries(roots)) { if (u.startsWith(p)) { f = path.join(r, u.slice(p.length)); break; } }
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end('nf ' + u); return; } res.writeHead(200, { 'Content-Type': types[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(d); });
}).listen(+process.argv[2] || 8793);
