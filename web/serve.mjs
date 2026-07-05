#!/usr/bin/env node
// ============================================================
// The Record — local static server for the no-install web app.
// Binds to 127.0.0.1 ONLY (never exposed to the LAN) and confines
// every request to the web/ directory (no path traversal).
//   npm run web   →   http://127.0.0.1:4555
// ============================================================
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, sep, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const HOST = '127.0.0.1';
const PORT = 4555;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json' };

createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.statusCode = 400;
    return res.end('400');
  }
  if (pathname === '/') pathname = '/index.html';

  // Resolve within ROOT and reject any path that escapes it.
  const target = resolve(ROOT, '.' + pathname);
  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    res.statusCode = 403;
    return res.end('403');
  }

  if (existsSync(target) && statSync(target).isFile()) {
    res.setHeader('content-type', MIME[extname(target)] || 'text/plain');
    return res.end(readFileSync(target));
  }
  res.statusCode = 404;
  res.end('404');
}).listen(PORT, HOST, () => console.log(`web app → http://${HOST}:${PORT}`));
