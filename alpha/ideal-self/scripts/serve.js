// α のローカル起動用サーバー。127.0.0.1 だけで待ち受け、alpha/ideal-self の中だけを配信する。外部へは何も送らない。
//   実行: node alpha/ideal-self/scripts/serve.js [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const SERVE_DIRS = ['src', 'fixtures', 'assets'];
const SERVE_FILES = ['index.html', 'styles.css'];

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const full = path.resolve(ROOT, rel);
    const allowed = full.startsWith(ROOT + path.sep) && (SERVE_FILES.includes(rel) || SERVE_DIRS.some((d) => rel.startsWith(d + '/')));
    if (req.method !== 'GET' || !allowed || !fs.existsSync(full) || !fs.statSync(full).isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    fs.createReadStream(full).pipe(res);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || process.env.PORT || 4173);
  createServer().listen(port, '127.0.0.1', () => console.log(`Ideal Self α: http://127.0.0.1:${port}/  （ローカル専用・外部送信なし）`));
}
