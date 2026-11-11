// jagan/sample-buy.mjs — 邪眼のサンプル（解析レポート・完全解析）の下部からの申込。元素診断の js/sample-buy.js と同じ考え方。
//   ・診断結果ページ・解析レポート・マイページからサンプルを開いた時だけ、その記録で申し込める。
//     結果ページ・レポートから：同じタブの sessionStorage に「その結果」（結果 ID と回答）を置いてから開く（URL には出さない）。
//     マイページから：#r=<結果ID>&from=mypage で開く（回答は送らず、サーバーがログイン中の本人の保存した記録から読む）。URL からは消す。
//   ・端末に残った別の結果（localStorage）は使わない（共有の端末で、別の人の記録を買わせない）。
//   ・サンプルは記録を作らない。購入の対象は元の記録だけ。結果 ID・回答は URL のクエリ・GA4 に出さない。
import { UUID_RE, salesOpen, buy, buyErrorText } from './client.mjs';

const KEY = 'jagan_sample_ctx_v1';
const TTL_MS = 12 * 3600 * 1000;
const FROMS = ['result', 'report', 'mypage'];
const ss = (fn) => { try { return fn(window.sessionStorage); } catch { return null; } };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function answersOk(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
  const v = Object.entries(a);
  return v.length > 0 && v.length <= 200 && v.every(([k, x]) => /^[A-Z]{3}\d{2}$/.test(k) && Number.isInteger(x) && x >= 1 && x <= 5);
}
function ctxOk(c) {
  if (!c || !UUID_RE.test(String(c.resultId || '')) || !FROMS.includes(c.from) || !(Date.now() - Number(c.at) < TTL_MS)) return false;
  if (c.from === 'mypage') return c.answers == null;
  return answersOk(c.answers) && typeof c.itemSetVersion === 'string' && c.itemSetVersion.length < 64;
}

// 結果ページ・レポートから：サンプルへ進む直前に、表示中の結果をこのタブに置く
export function rememberForSample(result, from) {
  if (!result || !FROMS.includes(from)) return;
  const c = { resultId: result.resultId, itemSetVersion: result.versions && result.versions.itemSet, answers: result.answers, from, at: Date.now() };
  if (ctxOk(c)) ss((s) => s.setItem(KEY, JSON.stringify(c)));
}
// サンプルへのリンク（a[href^="/jagan/sample"]・a[href^="/jagan/complete-sample"]）に付ける
export function wireSampleLinks(root, getResult, from) {
  if (!root) return;
  root.querySelectorAll('a[href="/jagan/sample"], a[href="/jagan/complete-sample"]').forEach((a) => {
    a.addEventListener('click', () => rememberForSample(getResult(), from));
  });
}

function readContext() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('from') === 'mypage' && UUID_RE.test(h.get('r') || '')) {
    const c = { resultId: h.get('r'), answers: null, from: 'mypage', at: Date.now() };
    ss((s) => s.setItem(KEY, JSON.stringify(c)));
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* そのまま */ }
    return c;
  }
  const c = ss((s) => { try { return JSON.parse(s.getItem(KEY) || 'null'); } catch { return null; } });
  if (ctxOk(c)) return c;
  ss((s) => s.removeItem(KEY));
  return null;
}

function backHref(from) { return from === 'mypage' ? '/mypage#jagan' : '/jagan/#result'; }
function track(name, params) { try { if (typeof window.gtag === 'function') window.gtag('event', name, params || {}); } catch { /* 計測だけ */ } }

// page：'report'（解析レポートのサンプル）／'complete'（完全解析のサンプル）。extra：同じ記録で申し込める、ほかのボタン（解析レポートのサンプル内の完全解析の欄）
export function mountSampleBuy(box, { page, extra = [] }) {
  if (!box) return;
  const ctx = readContext();
  const open = salesOpen();
  const subject = ctx && ctx.from === 'mypage' ? 'この記録' : 'この診断結果';
  const isC = page === 'complete';
  if (!ctx) {
    box.innerHTML = `<p class="rp-cta-h">あなた自身の診断結果で読む</p>
      <p class="rp-text">お申し込みには、あなたの診断結果が必要です。まず邪眼診断を受けてください。診断が終わると、結果のページからこのサンプルへ進み、その結果でお申し込みいただけます。</p>
      <a class="rx-buy rp-cta-btn" href="/jagan/">まず邪眼診断を受ける</a>
      <p class="jg-small">マイページに保存した記録から申し込む方：<a href="/mypage#jagan">マイページで記録を選ぶ</a></p>`;
    extra.forEach(({ button }) => { if (button) button.outerHTML = '<p class="jg-small dp-fold-note">お申し込みには、あなた自身の診断結果が必要です。邪眼診断を受けると、結果のページから、その結果で完全解析をお申し込みいただけます。</p>'; });
    return;
  }
  const pend = open ? '' : '（準備中）';
  const btn = isC
    ? `<button type="button" class="dp-buy" data-sample-buy="complete"><span class="dp-buy-main">まだ見えていない深淵を読む</span><span class="dp-buy-sub">${subject}の完全解析「DIPPER」　全23ページ　¥3,000${pend}</span></button>`
    : `<button type="button" class="rx-buy rp-cta-btn" data-sample-buy="report">${subject}で、解析レポートを読む<small>¥1,000${pend}</small></button>`;
  box.innerHTML = `<p class="rp-cta-h">${subject}で読む</p>
    ${btn}
    <p class="jg-small rx-buy-error" data-sample-msg role="status"></p>
    <p class="jg-small"><a href="${backHref(ctx.from)}" data-sample-back>元の画面に戻る</a></p>`;
  box.querySelector('[data-sample-back]').addEventListener('click', (e) => {
    if (String(document.referrer || '').startsWith(location.origin + '/') && history.length > 1) { e.preventDefault(); history.back(); }
  });
  const source = `${ctx.from}_sample`;
  const wire = (b, product, msg) => {
    if (!b) return;
    if (!open) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); return; }
    b.disabled = false; b.removeAttribute('aria-disabled');
    const p = b.querySelector('.dp-buy-pending'); if (p) p.remove();
    b.addEventListener('click', async () => {
      track(product === 'complete' ? 'jagan_complete_cta' : 'jagan_report_cta', { state: 'open', source });
      if (msg) msg.textContent = '';
      const label = b.innerHTML;
      b.disabled = true;
      b.textContent = '決済の画面を準備しています…';
      const out = await buy({ resultId: ctx.resultId, itemSetVersion: ctx.itemSetVersion, answers: ctx.answers || undefined, source, product });
      if (out.ok) return;
      b.disabled = false; b.innerHTML = label;
      if (msg && out.error !== 'in_progress') msg.textContent = buyErrorText(out.error);
    });
  };
  wire(box.querySelector('[data-sample-buy]'), isC ? 'complete' : 'report', box.querySelector('[data-sample-msg]'));
  extra.forEach(({ button, product, msg }) => wire(button, product, msg));
  // 決済画面から「戻る」（bfcache）：押したボタンを戻す
  addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
}
