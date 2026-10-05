/* Zero-dependency static server for the landing page.
   Use it to preview locally (`node landing/server.js`) or as its own Railway service
   (Root Directory: landing, Start Command: npm start). The main app can also serve this
   folder by hostname; see LANDING_HOSTS in server/index.js. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 4100;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const HIDDEN = new Set(['server.js', 'package.json', 'README.md']);

http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { rel = '/'; }
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || HIDDEN.has(path.basename(file))) file = path.join(ROOT, 'index.html');

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // Unknown path: send the page itself so old links still land somewhere useful.
      file = path.join(ROOT, 'index.html');
      try { st = fs.statSync(file); } catch (e) { res.writeHead(404); return res.end('Not found'); }
    }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
    };
    // Range requests: Safari will not play an mp4 without them.
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? parseInt(m[1], 10) : st.size - parseInt(m[2], 10);
      let end = m[1] && m[2] ? parseInt(m[2], 10) : st.size - 1;
      start = Math.max(0, start); end = Math.min(st.size - 1, end);
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, Object.assign(headers, { 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 }));
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, Object.assign(headers, { 'Content-Length': st.size }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, '0.0.0.0', () => console.log(`PortIQ landing page on http://localhost:${PORT}`));
