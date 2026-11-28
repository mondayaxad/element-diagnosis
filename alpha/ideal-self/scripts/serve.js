// α の起動用サーバー。alpha/ideal-self の画面のファイルだけを配信する（静的配信のみ・受け取るデータは無い）。
// 回答・人格・約束・振り返りは、開いた端末（iPhone なら Safari）の中にだけ保存され、このサーバーには届かない。
//
//   node alpha/ideal-self/scripts/serve.js [port]                 … 127.0.0.1 だけで待ち受け（既定。Tailscale の serve から使う）
//   node alpha/ideal-self/scripts/serve.js [port] --key           … 127.0.0.1 のまま、アクセスキーも必須にする
//   node alpha/ideal-self/scripts/serve.js [port] --lan           … 同じ Wi-Fi の端末から開けるようにする（アクセスキー必須・自動生成）
//
// アクセスキー：起動のたびに作る推測困難な値。最初に「/?k=キー」を開くと、その端末に HttpOnly の Cookie を置き、
// URL からキーを消した「/」へ移る。Cookie の無い端末には何も配信しない（403）。--lan はキー無しでは起動しない。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const SERVE_DIRS = ['src', 'fixtures', 'assets'];
const SERVE_FILES = ['index.html', 'styles.css'];
const COOKIE = 'isa_k';
const COOKIE_MAX_AGE = 14 * 24 * 60 * 60; // 本人テスト（7日）＋余裕

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export const newAccessKey = () => crypto.randomBytes(24).toString('base64url');

function sameKey(a, b) {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
function cookieKey(req) {
  const m = String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
}

export function createServer({ accessKey = null } = {}) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (accessKey) {
      const k = url.searchParams.get('k');
      if (url.pathname === '/' && k !== null) {
        if (!sameKey(k, accessKey)) { res.writeHead(403, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('forbidden'); }
        // 本人の端末に印を置き、キーを含まない URL に移る（履歴・画面にキーを残さない）
        const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
        res.writeHead(302, { ...BASE_HEADERS, Location: '/', 'Set-Cookie': `${COOKIE}=${encodeURIComponent(accessKey)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}${secure}` });
        return res.end();
      }
      if (!sameKey(cookieKey(req), accessKey)) { res.writeHead(403, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('forbidden'); }
    }
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const full = path.resolve(ROOT, rel);
    const allowed = full.startsWith(ROOT + path.sep) && (SERVE_FILES.includes(rel) || SERVE_DIRS.some((d) => rel.startsWith(d + '/')));
    if (req.method !== 'GET' || !allowed || !fs.existsSync(full) || !fs.statSync(full).isFile()) { res.writeHead(404, BASE_HEADERS); return res.end('not found'); }
    res.writeHead(200, {
      ...BASE_HEADERS,
      'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    fs.createReadStream(full).pipe(res);
  });
}

// 起動オプション。--lan は 0.0.0.0 で待ち受け、アクセスキーを必ず有効にする
export function parseArgs(argv) {
  const rest = argv.filter((a) => !a.startsWith('--'));
  const lan = argv.includes('--lan');
  const key = lan || argv.includes('--key');
  return { port: Number(rest[0] || process.env.PORT || 4173), host: lan ? '0.0.0.0' : '127.0.0.1', lan, accessKey: key ? newAccessKey() : null };
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opt = parseArgs(process.argv.slice(2));
  createServer({ accessKey: opt.accessKey }).listen(opt.port, opt.host, () => {
    const q = opt.accessKey ? `?k=${opt.accessKey}` : '';
    if (opt.lan) {
      console.log('Ideal Self α（同じ Wi-Fi の端末から・アクセスキー必須）');
      for (const ip of lanAddresses()) console.log(`  iPhone で開く URL: http://${ip}:${opt.port}/${q}`);
      console.log('  この URL は本人の端末だけで開いてください（キーは起動のたびに変わります）。');
    } else {
      console.log(`Ideal Self α: http://127.0.0.1:${opt.port}/${q}  （この端末の中だけ${opt.accessKey ? '・アクセスキー必須' : ''}）`);
    }
    console.log('  配信するのは画面のファイルだけです。回答や約束は、開いた端末の中にだけ保存されます。');
  });
}
