// jagan/dipper.mjs — 邪眼完全解析「DIPPER」のページ（/jagan/dipper）。解析レポート（report.mjs）と同じ規則で開く。
//   ・固有リンク（#t=<秘密値>）：開くたびにサーバーが支払い・返金・リンクの状態を確かめる（op=link-open）。
//     決済から戻った直後で反映がまだなら、少し待って確かめ直す。最後のページの後に、マイページへの登録（ログインの後でも）。
//   ・マイページから（?r=<記録 ID>）：ログイン中の本人で、完全解析の権利が有効な時だけ（op=open product=complete）。
//   本文は、買った回答から同じ版の計算（jagan/engine）で作る（サンプルと同じ buildComplete・renderComplete）。
import { computeDiagnosis } from './engine/runtime.mjs';
import { BUNDLE } from './engine/data.mjs';
import { buildComplete } from './complete/model.mjs';
import { renderComplete, fitPages } from './complete/view.mjs';
import { TOKEN_RE, UUID_RE, linkOpen, openOwn, register, accessToken, supabaseClient, setRegisterIntent, freshPurchase, reportUrlOf, trackPurchase } from './client.mjs';

const $ = (id) => document.getElementById(id);
function track(name, params) { try { if (typeof window.gtag === 'function') window.gtag('event', name, params || {}); } catch { /* 計測だけ */ } }
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function status(html) { $('dpStatus').hidden = false; $('dpStatus').innerHTML = html; }
const fail = (text, extra = '') => status(`<p>${text}</p>${extra}<p class="jg-small"><a href="/jagan/">邪眼診断のトップへ</a>　<a href="/mypage#jagan">マイページ</a></p>`);

function readToken() {
  const m = /(?:^#|&)t=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash || '');
  return m ? m[1] : null;
}
const dateOf = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}` : ''; };

// 紙面は全ページ同じ大きさ（1240×1754）。画面では組み替えずに、幅に合わせて縮小する（サンプルと同じ）
function fit() { $('dpBook').style.setProperty('--z', String(Math.min(1, (document.documentElement.clientWidth - 16) / 1240))); }

export function renderDipper(report) {
  const result = computeDiagnosis({ answers: report.answers, resultId: report.resultId, itemSetVersion: report.itemSetVersion }, BUNDLE);
  const html = renderComplete(buildComplete(result, BUNDLE, { diagnosedAt: dateOf(report.paidAt) || undefined }));
  return { result, html };
}

function render(report) {
  let out;
  try { out = renderDipper(report); }
  catch { fail('完全解析を表示できませんでした（版が違う可能性があります）。お問い合わせください。'); return false; }
  const { result, html } = out;
  $('dpStatus').hidden = true;
  // 保存時の人物と、いまの版で計算した人物が違うとき（人物判定の版の更新）は、黙って上書きせずに説明を添える
  const saved = report.headline && report.headline.character;
  const now = result.character.status === 'available' ? result.character.name : null;
  const note = saved && saved !== now
    ? `<p class="rp-vnote dp-vnote">保存時の「あなたのファトゥス」は${esc(saved)}（${esc(report.headline.matchPercent)}%）でした。人物の判定の版を更新したため、この表示は新しい版で計算しています。邪眼・異相の結果は変わりません。</p>` : '';
  $('dpBook').innerHTML = note + html;
  fit(); addEventListener('resize', fit);
  const fill = () => fitPages($('dpBook'));
  fill();
  // 字形（Web フォント）が後から届くと行の折り返しが変わり、合わせた倍率のままでは見切れる。フォントが届くたび・読み込み完了・少し後にも合わせ直す
  if (document.fonts) { document.fonts.ready.then(fill); document.fonts.addEventListener('loadingdone', fill); }
  addEventListener('load', fill); setTimeout(fill, 1500); setTimeout(fill, 4000);
  $('dpKeep').hidden = false;
  document.title = `邪眼完全解析「DIPPER」 ${result.dti.code}｜邪眼診断`;
  return true;
}

async function fromLink(token) {
  const fresh = freshPurchase();
  if (fresh) $('dpThanks').hidden = false;
  for (let i = 0; i < 12; i++) {
    const r = await linkOpen(token);
    if (r.status === 404) { fail('リンクが正しくありません。購入した完全解析のリンク（URL）から開いてください。'); return; }
    if (!r.ok) { fail('完全解析を開けませんでした。時間をおいて、もう一度開いてください。', '<p><button type="button" class="rp-print" onclick="location.reload()">もう一度開く</button></p>'); return; }
    if (r.body.state === 'paid') {
      // 解析レポート（¥1,000）の固有リンクだった：そのレポートのページで開く
      if (r.body.report && r.body.report.product !== 'complete') { location.replace(`/jagan/report#t=${token}`); return; }
      if (!render(r.body.report)) return;
      track('jagan_complete_open', { source: fresh ? 'checkout' : 'link' });
      if (fresh) trackPurchase(token, 'complete');
      wireLinkKeep(token);
      return;
    }
    if (r.body.state === 'unavailable') { fail('この完全解析は、現在ご覧いただけません（返金・確認中など）。ご不明点はお問い合わせください。'); return; }
    status('<p>お支払いを確認しています…</p><p class="jg-small">数秒で表示されます。このページを閉じずにお待ちください。</p>');
    await new Promise((ok) => setTimeout(ok, i < 4 ? 1500 : 3000));
  }
  fail('お支払いの確認に時間がかかっています。少し待ってから、このページを読み込み直してください（このリンクは保存してください）。', '<p><button type="button" class="rp-print" onclick="location.reload()">読み込み直す</button></p>');
}

function wireLinkKeep(token) {
  $('dpKeepLead').textContent = 'このページのリンク（URL）を知っている人は、この完全解析を開けます。マイページに登録すると、マイページの記録から、いつでも開けます。';
  const reg = $('registerBtn');
  const copy = $('copyBtn');
  reg.hidden = false; copy.hidden = false;
  copy.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(reportUrlOf(token, 'complete')); ok = true; } catch { ok = false; }
    $('keepStatus').textContent = ok ? 'リンクをコピーしました。' : 'コピーできませんでした。このページのアドレスを保存してください。';
  });
  reg.addEventListener('click', async () => {
    reg.disabled = true;
    track('jagan_complete_register_start', {});
    if (!supabaseClient()) { $('keepStatus').textContent = 'ログインは現在ご利用いただけません。'; reg.disabled = false; return; }
    if (!(await accessToken())) {
      if (setRegisterIntent(token)) { location.assign('/mypage.html#jagan'); return; }
      $('keepStatus').textContent = 'このブラウザでは登録の予定を残せません。先にマイページでログインしてから、このページを開き直してください。';
      reg.disabled = false;
      return;
    }
    const r = await register(token);
    if (r.ok) {
      track('jagan_complete_register_done', { result: r.body.result });
      $('keepStatus').innerHTML = r.body.result === 'already' ? 'この完全解析は、すでにマイページに登録されています。<a href="/mypage#jagan">マイページを開く</a>' : 'マイページに登録しました。<a href="/mypage#jagan">マイページを開く</a>';
      reg.textContent = '✓ マイページに登録済み';
      return;
    }
    reg.disabled = false;
    const e = r.body && r.body.error;
    $('keepStatus').textContent = e === 'onboarding_required' ? 'マイページの登録（利用規約への同意）を完了してから、もう一度お試しください。'
      : e === 'not_authenticated' ? 'ログインの有効期限が切れました。もう一度ログインしてください。'
      : e === 'link_inactive' ? 'この完全解析は、現在登録できません（お支払いの確認中・返金など）。' : '登録できませんでした。時間をおいて、もう一度お試しください。';
  });
}

async function fromMypage(resultId) {
  if (!supabaseClient() || !(await accessToken())) { fail('この完全解析を開くには、マイページでログインしてください。', '<p><a class="rx-buy rp-cta-btn" href="/mypage#jagan">マイページでログインする</a></p>'); return; }
  const r = await openOwn(resultId, 'complete');
  if (r.ok && r.body.state === 'paid') {
    if (!render(r.body.report)) return;
    track('jagan_complete_open', { source: 'mypage' });
    $('dpKeepLead').textContent = 'マイページに登録された完全解析です。PDFとして端末に保存できます。';
    $('keepNote').innerHTML = '<a href="/mypage#jagan">マイページに戻る</a>';
    return;
  }
  fail(r.status === 403 ? 'この完全解析は、このアカウントでは開けません（未購入・返金など）。' : '完全解析を開けませんでした。時間をおいて、もう一度お試しください。');
}

if (typeof document !== 'undefined' && document.getElementById('dpBook') && document.body.classList.contains('dp-live')) {
  $('printBtn').addEventListener('click', () => window.print());
  const token = readToken();
  const rid = new URLSearchParams(location.search).get('r');
  if (token && TOKEN_RE.test(token)) fromLink(token);
  else if (rid && UUID_RE.test(rid)) fromMypage(rid);
  else fail('リンクが正しくありません。購入した完全解析のリンク（URL）から開いてください。マイページに登録した完全解析は、マイページから開けます。');
}
