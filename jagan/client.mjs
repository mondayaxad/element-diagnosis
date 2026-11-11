// jagan/client.mjs — 邪眼診断の画面で共通に使う、Supabase（ログイン）と購入・固有リンク・登録の呼び出し。
//   結果ページ（app.mjs）・レポートのページ（report.mjs）・マイページ（js/jagan-mypage.js は同じ API を直接呼ぶ）で同じ規則。
//   ・購入の応答の決済画面 URL は https://checkout.stripe.com/ だけ受け付ける。
//   ・固有リンクの秘密値は URL のフラグメント（#t=）とこのタブの sessionStorage にだけ置く（クエリ・GA4・console に出さない）。
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const API = '/api/jagan-report?op=';
export const REGISTER_KEY = 'jagan_register_v1';     // マイページへの登録の予定（固有リンクの秘密値・このタブだけ・2時間）
export const FRESH_KEY = 'jagan_buy_fresh_v1';       // 決済画面へ進んだ印（戻った固有リンクで「購入ありがとうございます」を出す）

export function publicConfig() { return window.__ED_PUBLIC_CONFIG__ || null; }
export function salesOpen() { const c = publicConfig(); return !!(c && c.jaganSalesOpen === true); }

export function supabaseClient() {
  if (supabaseClient.c !== undefined) return supabaseClient.c;
  const cfg = publicConfig();
  let c = null;
  try {
    const ok = cfg && /^[a-z0-9]{20}$/.test(cfg.projectRef || '') && cfg.supabaseUrl === `https://${cfg.projectRef}.supabase.co`
      && typeof cfg.supabaseAnonKey === 'string' && !cfg.supabaseAnonKey.startsWith('sb_secret_')
      && ((location.hostname === 'element-diagnosis-five.vercel.app') === (cfg.appEnv === 'production'));
    if (ok && window.supabase && typeof window.supabase.createClient === 'function') c = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  } catch { c = null; }
  supabaseClient.c = c;
  return c;
}
export async function accessToken() {
  const c = supabaseClient();
  if (!c) return null;
  try { const { data } = await c.auth.getSession(); return data && data.session ? data.session.access_token : null; } catch { return null; }
}

async function call(op, body, { token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try { res = await fetch(API + op, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'same-origin' }); }
  catch { return { ok: false, status: 0, body: { error: 'network' } }; }
  let out = {};
  try { out = await res.json(); } catch { out = {}; }
  return { ok: res.ok, status: res.status, body: out || {} };
}
const session = (fn) => { try { return fn(window.sessionStorage); } catch { return null; } };
function randomAttempt() {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 購入：回答を送る（結果ページ）か、ログイン中の自分の記録の resultId だけを送る（マイページ）。決済画面へ移る
let buying = null;
export function buy(opts) {
  if (buying) return buying.then(() => ({ ok: false, error: 'in_progress' }));
  buying = buyOnce(opts).finally(() => { buying = null; });
  return buying;
}
async function buyOnce({ resultId, itemSetVersion, answers, source, product }) {
  if (!salesOpen()) return { ok: false, error: 'sales_closed' };
  const token = await accessToken();
  const body = { resultId, attempt: randomAttempt() };
  if (product === 'complete') body.product = 'complete';
  if (answers) { body.itemSetVersion = itemSetVersion; body.answers = answers; }
  if (/^[a-z_]{1,32}$/.test(String(source || ''))) body.source = source;
  let r = await call('buy', body, { token });
  if (!r.ok && r.status === 0) r = await call('buy', body, { token }); // 通信の失敗は同じ購入操作のまま1回だけ再送（二重の注文にならない）
  if (r.ok && typeof r.body.checkoutUrl === 'string' && /^https:\/\/checkout\.stripe\.com\//.test(r.body.checkoutUrl)) {
    session((s) => s.setItem(FRESH_KEY, String(Date.now())));
    location.assign(r.body.checkoutUrl);
    return { ok: true };
  }
  return { ok: false, error: (r.body && r.body.error) || 'unknown' };
}
export const BUY_ERRORS = {
  sales_closed: '現在、お申し込みを受け付けていません（準備中）。',
  purchase_completed: 'この結果のレポートは、お支払いが完了しています。',
  attempt_expired: '決済の画面の期限が切れました。もう一度お試しください。',
  too_many_attempts: 'お申し込みが続いたため、しばらく時間をおいてからお試しください。',
  not_authenticated: 'ログインの有効期限が切れました。もう一度ログインしてください。',
  record_not_found: 'この記録を確認できませんでした。ページを読み込み直してください。',
  network: '通信できませんでした。電波の良い場所で、もう一度お試しください。',
};
export function buyErrorText(code) { return BUY_ERRORS[code] || 'お手続きを開始できませんでした。時間をおいて、もう一度お試しください。'; }

// 固有リンク・マイページからの閲覧
export function linkOpen(token) { return call('link-open', { token }); }
export async function openOwn(resultId, product) { return call('open', product === 'complete' ? { resultId, product } : { resultId }, { token: await accessToken() }); }
export async function register(token) { return call('link-register', { token }, { token: await accessToken() }); }

// マイページへの登録の予定（ログインしていない時：マイページでログインした後に登録する）
export function setRegisterIntent(token) {
  if (!TOKEN_RE.test(String(token || ''))) return false;
  return !!session((s) => { s.setItem(REGISTER_KEY, JSON.stringify({ t: token, at: Date.now() })); return true; });
}
export function freshPurchase() {
  const at = Number(session((s) => { const v = s.getItem(FRESH_KEY); s.removeItem(FRESH_KEY); return v; }));
  return Number.isFinite(at) && Date.now() - at < 2 * 60 * 60 * 1000;
}
export function reportUrlOf(token, product) { return `${location.origin}/jagan/${product === 'complete' ? 'dipper' : 'report'}#t=${token}`; }
// 商品ごとの価格・名前（表示用。金額はサーバーが決める）
export const PRODUCT_INFO = Object.freeze({
  report: { price: '¥1,000', name: '邪眼解析レポート', path: '/jagan/report' },
  complete: { price: '¥3,000', name: '完全解析「DIPPER」', path: '/jagan/dipper', pages: 23 },
});

// GA4 の購入（元素診断の report-link.html と同じ形）：決済から戻って初めてレポートが開いた時に1回だけ送る。
//   transaction_id は固有リンクの秘密値から作る元に戻せない20桁（秘密値・注文 ID・Stripe の ID は送らない）。同じ購入を二重に数えない
const GA_ITEMS = { report: { id: 'jagan_report_v1', name: '邪眼解析レポート', value: 1000 }, complete: { id: 'jagan_complete_v1', name: '邪眼完全解析レポート「DIPPER」', value: 3000 } };
export async function trackPurchase(token, product) {
  try {
    const it = GA_ITEMS[product];
    if (!it || typeof window.gtag !== 'function' || !TOKEN_RE.test(String(token || '')) || !crypto.subtle) return;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`jagan-ga4|${token}`));
    const txid = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
    const key = `jagan_ga4_purchase_${txid}`;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { /* 保存できなくても1回は送る */ }
    window.gtag('event', 'purchase', { transaction_id: txid, value: it.value, currency: 'JPY', diagnosis_type: 'jagan',
      items: [{ item_id: it.id, item_name: it.name, item_category: '邪眼診断', price: it.value, quantity: 1 }] });
  } catch { /* 計測だけ */ }
}
