// jagan/report.mjs — 邪眼解析レポートのページ（/jagan/report）。
//   ・固有リンク（#t=<秘密値>）：開くたびにサーバーが支払い・返金・リンクの状態を確かめる（op=link-open）。
//     決済から戻った直後で反映がまだなら、少し待って確かめ直す。最下部から、マイページに登録できる（ログインの後でも）。
//   ・マイページから（?r=<記録 ID>）：ログイン中の本人で、権利が有効な時だけ（op=open）。
//   本文は、買った回答から同じ版の計算（jagan/engine）で作る（サンプルと同じ renderReport）。
import { computeDiagnosis } from './engine/runtime.mjs';
import { BUNDLE } from './engine/data.mjs';
import { renderReport } from './view.mjs';
import { TOKEN_RE, UUID_RE, linkOpen, openOwn, register, accessToken, supabaseClient, setRegisterIntent, freshPurchase, reportUrlOf } from './client.mjs';

const $ = (id) => document.getElementById(id);
function track(name, params) { try { if (typeof window.gtag === 'function') window.gtag('event', name, params || {}); } catch { /* 計測だけ */ } }
function status(html) { $('rpStatus').hidden = false; $('rpStatus').innerHTML = html; }
const fail = (text, extra = '') => status(`<p>${text}</p>${extra}<p class="jg-small"><a href="/jagan/">邪眼診断のトップへ</a>　<a href="/mypage#jagan">マイページ</a></p>`);

function readToken() {
  const m = /(?:^#|&)t=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash || '');
  return m ? m[1] : null;
}
function render(report) {
  let result;
  try { result = computeDiagnosis({ answers: report.answers, resultId: report.resultId, itemSetVersion: report.itemSetVersion }, BUNDLE); }
  catch { fail('レポートを表示できませんでした（版が違う可能性があります）。お問い合わせください。'); return false; }
  $('rpStatus').hidden = true;
  $('rpBody').innerHTML = renderReport(result, BUNDLE);
  $('rpEnd').hidden = false;
  $('rpKeep').hidden = false;
  document.title = `邪眼解析レポート ${result.dti.code}｜邪眼診断`;
  return true;
}

async function fromLink(token) {
  const fresh = freshPurchase();
  if (fresh) $('rpThanks').hidden = false;
  // 決済から戻った直後は、支払いの反映を少し待つ（サーバーが Stripe に確かめて反映する）
  for (let i = 0; i < 12; i++) {
    const r = await linkOpen(token);
    if (r.status === 404) { fail('リンクが正しくありません。購入したレポートのリンク（URL）から開いてください。'); return; }
    if (!r.ok) { fail('レポートを開けませんでした。時間をおいて、もう一度開いてください。', '<p><button type="button" class="rp-print" onclick="location.reload()">もう一度開く</button></p>'); return; }
    if (r.body.state === 'paid') {
      if (!render(r.body.report)) return;
      track('jagan_report_open', { source: fresh ? 'checkout' : 'link' });
      wireLinkKeep(token);
      return;
    }
    if (r.body.state === 'unavailable') { fail('このレポートは、現在ご覧いただけません（返金・確認中など）。ご不明点はお問い合わせください。'); return; }
    status('<p>お支払いを確認しています…</p><p class="jg-small">数秒で表示されます。このページを閉じずにお待ちください。</p>');
    await new Promise((ok) => setTimeout(ok, i < 4 ? 1500 : 3000));
  }
  fail('お支払いの確認に時間がかかっています。少し待ってから、このページを読み込み直してください（このリンクは保存してください）。', '<p><button type="button" class="rp-print" onclick="location.reload()">読み込み直す</button></p>');
}

function wireLinkKeep(token) {
  $('rpKeepLead').textContent = 'このページのリンク（URL）を知っている人は、このレポートを開けます。リンクを保存し、共有する場合はご注意ください。マイページに登録すると、マイページの記録から、いつでも開けます（別のアカウントにも登録できます）。';
  const reg = $('registerBtn');
  const copy = $('copyBtn');
  reg.hidden = false; copy.hidden = false;
  copy.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(reportUrlOf(token)); ok = true; } catch { ok = false; }
    $('keepStatus').textContent = ok ? 'リンクをコピーしました。' : 'コピーできませんでした。このページのアドレスを保存してください。';
  });
  reg.addEventListener('click', async () => {
    reg.disabled = true;
    track('jagan_report_register_start', {});
    if (!supabaseClient()) { $('keepStatus').textContent = 'ログインは現在ご利用いただけません。'; reg.disabled = false; return; }
    if (!(await accessToken())) {
      // ログインしていない：マイページでログイン（または新規登録）した後に登録する
      if (setRegisterIntent(token)) { location.assign('/mypage.html#jagan'); return; }
      $('keepStatus').textContent = 'このブラウザでは登録の予定を残せません。先にマイページでログインしてから、このページを開き直してください。';
      reg.disabled = false;
      return;
    }
    const r = await register(token);
    if (r.ok) {
      track('jagan_report_register_done', { result: r.body.result });
      $('keepStatus').innerHTML = r.body.result === 'already' ? 'このレポートは、すでにマイページに登録されています。<a href="/mypage#jagan">マイページを開く</a>' : 'マイページに登録しました。<a href="/mypage#jagan">マイページを開く</a>';
      reg.textContent = '✓ マイページに登録済み';
      return;
    }
    reg.disabled = false;
    const e = r.body && r.body.error;
    $('keepStatus').textContent = e === 'onboarding_required' ? 'マイページの登録（利用規約への同意）を完了してから、もう一度お試しください。'
      : e === 'not_authenticated' ? 'ログインの有効期限が切れました。もう一度ログインしてください。'
      : e === 'link_inactive' ? 'このレポートは、現在登録できません（お支払いの確認中・返金など）。' : '登録できませんでした。時間をおいて、もう一度お試しください。';
  });
}

async function fromMypage(resultId) {
  if (!supabaseClient() || !(await accessToken())) { fail('このレポートを開くには、マイページでログインしてください。', '<p><a class="rx-buy rp-cta-btn" href="/mypage#jagan">マイページでログインする</a></p>'); return; }
  const r = await openOwn(resultId);
  if (r.ok && r.body.state === 'paid') {
    if (!render(r.body.report)) return;
    track('jagan_report_open', { source: 'mypage' });
    $('rpKeepLead').textContent = 'マイページに登録されたレポートです。PDFとして端末に保存できます。';
    $('keepNote').innerHTML = '<a href="/mypage#jagan">マイページに戻る</a>';
    return;
  }
  fail(r.status === 403 ? 'このレポートは、このアカウントでは開けません（未購入・返金など）。' : 'レポートを開けませんでした。時間をおいて、もう一度お試しください。');
}

$('printBtn').addEventListener('click', () => window.print());
const token = readToken();
const rid = new URLSearchParams(location.search).get('r');
if (token && TOKEN_RE.test(token)) fromLink(token);
else if (rid && UUID_RE.test(rid)) fromMypage(rid);
else fail('リンクが正しくありません。購入したレポートのリンク（URL）から開いてください。マイページに登録したレポートは、マイページから開けます。');
