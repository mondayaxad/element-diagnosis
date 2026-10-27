// lib/server-env.js
// サーバー側の環境ガード。api/* は Supabase・Stripe へ接続する前に、必ずここを通す。
//
// 方針（docs: Preview DB 分離設計書 §1-2・§5-1・追記 A）：
//   - 環境の判定は Vercel のシステム変数 VERCEL_ENV を正にする（production / preview）。
//     development は ALLOW_LOCAL_DEVELOPMENT=1 かつ Host が localhost / 127.0.0.1 のときだけ認め、
//     Preview と同じ規則（本番 Ref には接続しない）で扱う。それ以外は「環境不明」として拒否する
//   - SUPABASE_URL から取り出した Ref が、SUPABASE_EXPECTED_PROJECT_REF と一致し、
//     production では SUPABASE_PRODUCTION_PROJECT_REF、preview では SUPABASE_PREVIEW_PROJECT_REF と
//     一致すること。逆の環境の Ref なら拒否する（読み取りも書き込みも）
//   - Ref 系の変数が1つでも未設定・形式不正、または本番 Ref と Preview Ref が同じ値なら拒否する
//   - Stripe：production は STRIPE_MODE=live かつ live のキー、preview / development は
//     STRIPE_MODE=test かつ test のキー。キーの接頭辞は sk_ と rk_（制限付きキー）の両方を見る
//   - サーバー用キーは SUPABASE_SECRET_KEY（新形式 sb_secret_）を優先し、無ければ
//     SUPABASE_SERVICE_ROLE_KEY（旧形式 service_role JWT。Production 移行用の後方互換）を使う。
//     Supabase へのヘッダーはキーの形式で決める（adminHeaders / userHeaders）：
//       sb_secret_         → apikey だけ（JWT ではないため Authorization に入れない）
//       service_role JWT   → apikey と Authorization: Bearer の両方（従来どおり）
//       ログインユーザー本人 → apikey は公開キー（SUPABASE_ANON_KEY）、Authorization はユーザーの access token。
//                            サーバー用キーとユーザーの token を同じリクエストに混ぜない
//     それ以外の形式は、接続する前に拒否する
//   - 拒否したときのログは、理由コード・環境名・Ref の末尾4文字・照合IDだけ。
//     URL 全文・キー・トークン・メールアドレス・Session ID は出さない
//
// この関数群は値を返すだけで、外部へは接続しない。

const crypto = require('crypto');

const REF_RE = /^[a-z0-9]{20}$/;
const SUPABASE_URL_RE = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// https://<20文字>.supabase.co（末尾の / は1つだけ許す）。それ以外は null。
function parseSupabaseUrl(url) {
  if (typeof url !== 'string') return null;
  const m = SUPABASE_URL_RE.exec(url.trim());
  if (!m) return null;
  return { supabaseUrl: `https://${m[1]}.supabase.co`, projectRef: m[1] };
}

// Stripe のキーの種別。sk_live_／rk_live_ → live、sk_test_／rk_test_ → test、それ以外は null。
// 以前の verify.js は sk_live_ だけを見ていたため、rk_live_（制限付きキー）を test と誤判定していた。
function stripeModeFromKey(key) {
  if (typeof key !== 'string') return null;
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  return null;
}

function hostnameOf(host) {
  if (typeof host !== 'string' || !host) return '';
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

function requestHost(req) {
  const headers = (req && req.headers) || {};
  return headers.host || headers.Host || '';
}

// VERCEL_ENV から環境名を決める。決められなければ null（＝環境不明）。
function resolveAppEnv(env, { host } = {}) {
  const v = env.VERCEL_ENV;
  if (v === 'production' || v === 'preview') return v;
  if (v === 'development' && env.ALLOW_LOCAL_DEVELOPMENT === '1' && LOCAL_HOSTS.has(hostnameOf(host))) {
    return 'development';
  }
  return null;
}

// JWT 形式のキー（旧形式の anon / service_role キー）の payload を読む。署名は検証しない（形式の確認だけ）。
function decodeJwtPayload(key) {
  if (typeof key !== 'string') return null;
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

// Supabase の接続先の検査。{ ok, appEnv, supabaseUrl, projectRef, reasons } を返す。
function checkSupabaseEnv(env, { host } = {}) {
  const reasons = [];
  const appEnv = resolveAppEnv(env, { host });
  if (!appEnv) reasons.push('env_unknown');

  const parsed = parseSupabaseUrl(env.SUPABASE_URL);
  if (!parsed) reasons.push(env.SUPABASE_URL ? 'supabase_url_invalid' : 'supabase_url_missing');

  const refs = {};
  for (const [name, code] of [
    ['SUPABASE_EXPECTED_PROJECT_REF', 'expected_ref'],
    ['SUPABASE_PRODUCTION_PROJECT_REF', 'production_ref'],
    ['SUPABASE_PREVIEW_PROJECT_REF', 'preview_ref'],
  ]) {
    const v = env[name];
    if (!v) reasons.push(`${code}_missing`);
    else if (!REF_RE.test(v)) reasons.push(`${code}_invalid`);
    else refs[code] = v;
  }

  if (refs.production_ref && refs.preview_ref && refs.production_ref === refs.preview_ref) {
    reasons.push('ref_config_conflict');
  }

  const ref = parsed && parsed.projectRef;
  if (ref && refs.expected_ref && ref !== refs.expected_ref) reasons.push('project_ref_mismatch');

  if (ref && appEnv === 'production') {
    if (refs.preview_ref && ref === refs.preview_ref) reasons.push('preview_ref_in_production');
    if (refs.production_ref && ref !== refs.production_ref) reasons.push('production_ref_mismatch');
    if (refs.expected_ref && refs.production_ref && refs.expected_ref !== refs.production_ref) {
      reasons.push('expected_ref_not_production');
    }
  }
  if (ref && (appEnv === 'preview' || appEnv === 'development')) {
    if (refs.production_ref && ref === refs.production_ref) reasons.push('production_ref_in_preview');
    if (refs.preview_ref && ref !== refs.preview_ref) reasons.push('preview_ref_mismatch');
    if (refs.expected_ref && refs.preview_ref && refs.expected_ref !== refs.preview_ref) {
      reasons.push('expected_ref_not_preview');
    }
  }

  const uniq = [...new Set(reasons)];
  return {
    ok: uniq.length === 0,
    appEnv,
    supabaseUrl: uniq.length === 0 ? parsed.supabaseUrl : null,
    projectRef: uniq.length === 0 ? ref : null,
    refTail: ref ? ref.slice(-4) : null,
    reasons: uniq,
  };
}

// ブラウザへ渡してよい公開キーか（public-config 用）。
// sb_publishable_ か、旧形式 JWT で role=anon かつ ref が接続先と一致するものだけを認める。
function checkAnonKey(key, projectRef) {
  if (typeof key !== 'string' || !key) return ['anon_key_missing'];
  if (key.startsWith('sb_secret_')) return ['anon_key_is_secret'];
  if (key.startsWith('sb_publishable_')) return [];
  const payload = decodeJwtPayload(key);
  if (!payload) return ['anon_key_invalid'];
  if (payload.role !== 'anon') return ['anon_key_not_anon_role'];
  if (payload.ref && projectRef && payload.ref !== projectRef) return ['anon_key_ref_mismatch'];
  return [];
}

// サーバー用キーの選択と検査。値は返り値の key にだけ入れ、ログには出さない。
//   SUPABASE_SECRET_KEY：新形式（sb_secret_）だけを認める
//   SUPABASE_SERVICE_ROLE_KEY：旧形式 JWT（role=service_role、ref が接続先と一致）。sb_secret_ も受け付ける
// 両方が設定されていれば SUPABASE_SECRET_KEY を使う。
function resolveServerKey(env, projectRef) {
  if (env.SUPABASE_SECRET_KEY) {
    const key = env.SUPABASE_SECRET_KEY;
    if (typeof key === 'string' && key.startsWith('sb_secret_')) return { kind: 'secret', key, reasons: [] };
    return { kind: null, key: null, reasons: ['server_key_invalid'] };
  }
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof key !== 'string' || !key) return { kind: null, key: null, reasons: ['server_key_missing'] };
  if (key.startsWith('sb_secret_')) return { kind: 'secret', key, reasons: [] };
  if (key.startsWith('sb_publishable_')) return { kind: null, key: null, reasons: ['server_key_is_publishable'] };
  const payload = decodeJwtPayload(key);
  if (!payload) return { kind: null, key: null, reasons: ['server_key_invalid'] };
  if (payload.role !== 'service_role') return { kind: null, key: null, reasons: ['server_key_wrong_role'] };
  if (payload.ref && projectRef && payload.ref !== projectRef) return { kind: null, key: null, reasons: ['server_key_ref_mismatch'] };
  return { kind: 'legacy_jwt', key, reasons: [] };
}

// 管理者アクセス（RLS を迂回する）のヘッダー。
function buildAdminHeaders(serverKey) {
  if (serverKey.kind === 'secret') return { apikey: serverKey.key };
  if (serverKey.kind === 'legacy_jwt') return { apikey: serverKey.key, Authorization: `Bearer ${serverKey.key}` };
  throw new Error('server key is not available');
}

// ログインユーザー本人としてのアクセスのヘッダー（公開キー＋ユーザーの access token）。
function buildUserHeaders(anonKey, accessToken) {
  return { apikey: anonKey, Authorization: `Bearer ${accessToken}` };
}

// Stripe の検査。production は live、preview / development は test だけを認める。
function checkStripeEnv(env, appEnv) {
  const reasons = [];
  const expected = appEnv === 'production' ? 'live' : (appEnv === 'preview' || appEnv === 'development') ? 'test' : null;
  if (!expected) reasons.push('env_unknown');

  const declared = env.STRIPE_MODE;
  if (!declared) reasons.push('stripe_mode_missing');
  else if (declared !== 'live' && declared !== 'test') reasons.push('stripe_mode_invalid');
  else if (expected && declared !== expected) reasons.push('stripe_mode_env_mismatch');

  const keyMode = stripeModeFromKey(env.STRIPE_SECRET_KEY);
  if (!env.STRIPE_SECRET_KEY) reasons.push('stripe_key_missing');
  else if (!keyMode) reasons.push('stripe_key_invalid');
  else {
    if (expected && keyMode !== expected) reasons.push('stripe_key_env_mismatch');
    if ((declared === 'live' || declared === 'test') && keyMode !== declared) reasons.push('stripe_key_mode_mismatch');
  }

  const uniq = [...new Set(reasons)];
  return { ok: uniq.length === 0, mode: uniq.length === 0 ? keyMode : null, reasons: uniq };
}

// api/* の共通入口。必要な検査をまとめて行い、1つでも通らなければ ok:false。
//   admin：サーバー用キーで管理者アクセスする API（SUPABASE_SECRET_KEY → SUPABASE_SERVICE_ROLE_KEY）
//   user：ログインユーザー本人の確認（/auth/v1/user）をする API（SUPABASE_ANON_KEY が必要）
//   stripe：Stripe へ接続する API（verify）
//   reportSecret：REPORT_TOKEN_SECRET で署名・検証する API
// ok:true のときだけ adminHeaders()・userHeaders(token) を返す。
// REPORT_TOKEN_SECRET は Production と Preview で別の値にする前提。同じ値かどうかはここでは
// 判定できないため、各 API はトークンへ環境名（env）を入れ、別環境のトークンを受け付けない。
function requireServerEnv(env, { host, admin = true, user = false, stripe = false, reportSecret = false } = {}) {
  const sb = checkSupabaseEnv(env, { host });
  const reasons = [...sb.reasons];
  let serverKey = null;
  if (admin) {
    serverKey = resolveServerKey(env, sb.projectRef);
    reasons.push(...serverKey.reasons);
  }
  if (user) reasons.push(...checkAnonKey(env.SUPABASE_ANON_KEY, sb.projectRef));
  let stripeMode = null;
  if (stripe) {
    const st = checkStripeEnv(env, sb.appEnv);
    reasons.push(...st.reasons);
    stripeMode = st.mode;
  }
  if (reportSecret && !env.REPORT_TOKEN_SECRET) reasons.push('report_token_secret_missing');

  const uniq = [...new Set(reasons)];
  const ok = uniq.length === 0;
  const result = {
    ok,
    appEnv: sb.appEnv,
    supabaseUrl: ok ? sb.supabaseUrl : null,
    projectRef: ok ? sb.projectRef : null,
    refTail: sb.refTail,
    stripeMode: ok ? stripeMode : null,
    reasons: uniq,
  };
  if (ok && admin) {
    const headers = buildAdminHeaders(serverKey);
    result.adminHeaders = () => ({ ...headers });
  }
  if (ok && user) {
    const anonKey = env.SUPABASE_ANON_KEY;
    result.userHeaders = (accessToken) => buildUserHeaders(anonKey, accessToken);
  }
  return result;
}

// 拒否のログ。理由コード・環境名・Ref の末尾4文字・照合IDだけを出す。照合IDは応答にも入れる。
function logEnvDenied(api, result, logger = console) {
  const incidentId = crypto.randomBytes(4).toString('hex');
  logger.error(JSON.stringify({
    event: 'env_guard_denied',
    api,
    env: result.appEnv || 'unknown',
    ref_tail: result.refTail || null,
    reasons: result.reasons,
    incident_id: incidentId,
  }));
  return incidentId;
}

// ログ用に識別子の末尾だけを残す（Session ID 等を全文で出さない）。
function tail(value, n = 6) {
  if (typeof value !== 'string' || !value) return null;
  return value.length <= n ? '*'.repeat(value.length) : `…${value.slice(-n)}`;
}

module.exports = {
  parseSupabaseUrl,
  stripeModeFromKey,
  resolveAppEnv,
  requestHost,
  checkSupabaseEnv,
  checkAnonKey,
  resolveServerKey,
  buildAdminHeaders,
  buildUserHeaders,
  checkStripeEnv,
  requireServerEnv,
  logEnvDenied,
  tail,
};
