// api/public-config.js
// ブラウザ用の公開設定（Supabase の URL・公開キー・環境名・Project Ref）を返す。
//
//   GET /api/public-config            → JSON
//   GET /api/public-config?format=js  → window.__ED_PUBLIC_CONFIG__ = Object.freeze({...});
//     画面からは <script src="/api/public-config?format=js"> として同期で読む
//     （diagnosis-save.js が読み込み時に supabaseClient を作り、OAuth の戻りを取り込む順序を変えないため）
//
// 返してよいのは appEnv・supabaseUrl・supabaseAnonKey・projectRef の4項目だけ。
// サーバー専用キーはこのファイルでは読まない（参照もしない）。公開キーが秘密キーの形式なら返さない。
// 環境不明・期待 Ref 未設定・URL と Ref の不一致・Preview で本番 Ref・本番で Preview Ref のときは 503。
// 失敗時に別の接続先へ切り替えることはしない（ブラウザ側は Supabase の処理を止める）。

const { checkSupabaseEnv, checkAnonKey, requestHost, logEnvDenied } = require('../lib/server-env');

function wantsJs(req) {
  const q = req.query || {};
  if (q.format === 'js') return true;
  try {
    return new URL(req.url || '/', 'http://x').searchParams.get('format') === 'js';
  } catch {
    return false;
  }
}

// </script> 等で JS が途中で閉じられないよう、< > & と行区切り文字をエスケープする。
function toJsLiteral(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function buildPublicConfig(env, { host } = {}) {
  const sb = checkSupabaseEnv(env, { host });
  const reasons = [...sb.reasons];
  if (sb.ok) reasons.push(...checkAnonKey(env.SUPABASE_ANON_KEY, sb.projectRef));
  if (reasons.length) return { ok: false, result: { ...sb, reasons } };
  return {
    ok: true,
    config: {
      appEnv: sb.appEnv,
      supabaseUrl: sb.supabaseUrl,
      supabaseAnonKey: env.SUPABASE_ANON_KEY,
      projectRef: sb.projectRef,
      // 解析レポート・完全解析の販売（サーバーの COMPLETE_SALES_OPEN と同じ値。Checkout API も同じ値で止める）
      completeSalesOpen: env.COMPLETE_SALES_OPEN === 'true',
      // 記録単位の権利 API（/api/my-entitlements の records）がある
      completeApiReady: true,
    },
  };
}

function createHandler({ env }) {
  return function handler(req, res) {
    const js = wantsJs(req);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', js ? 'application/javascript; charset=utf-8' : 'application/json; charset=utf-8');

    if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      res.status(405);
      res.end(js ? 'window.__ED_PUBLIC_CONFIG__ = null;\n' : '{"error":"method_not_allowed"}');
      return;
    }

    const built = buildPublicConfig(env, { host: requestHost(req) });
    if (!built.ok) {
      const incidentId = logEnvDenied('public-config', built.result);
      res.status(503);
      res.end(js
        ? 'window.__ED_PUBLIC_CONFIG__ = null;\n'
        : JSON.stringify({ error: 'config_unavailable', incident_id: incidentId }));
      return;
    }

    res.status(200);
    res.end(js
      ? `window.__ED_PUBLIC_CONFIG__ = Object.freeze(${toJsLiteral(built.config)});\n`
      : JSON.stringify(built.config));
  };
}

module.exports = createHandler({ env: process.env });
module.exports.createHandler = createHandler;
module.exports.buildPublicConfig = buildPublicConfig;
