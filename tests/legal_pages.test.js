// 規約・特商法・プライバシー（第4版）の公開準備のテスト。
//   法務ページの内容・購入の入口のリンク・同意版の一致・Production の未確定ガード・report_sample の noindex。
//   実行: node --test tests/legal_pages.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('../scripts/build-public.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const text = (f) => read(f).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '');
const EMAIL = 'yaduns0522@gmail.com';

test('3つの法務ページ：問い合わせ窓口・相互リンク・版の表記・非公開の値を含まない', () => {
  for (const f of ['terms.html', 'privacy.html', 'tokushoho.html']) {
    const html = read(f);
    assert.ok(text(f).includes(EMAIL), `${f}: 問い合わせ窓口`);
    for (const href of ['/tokushoho', '/terms.html', '/privacy.html']) assert.ok(html.includes(`href="${href}"`), `${f}: ${href} へのリンク`);
    assert.match(html, /<meta name="viewport"/, f);
    assert.doesNotMatch(html, /supabase\.co\b|sk_(live|test)_|whsec_|service_role/i, `${f}: 内部の値を載せない`);
  }
});

test('特商法：開示請求の方式・価格・返金・提供方法が規約・決済画面と同じ趣旨', () => {
  const t = text('tokushoho.html');
  assert.match(t, /請求があった場合、遅滞なく開示します/);
  assert.doesNotMatch(t, /24時間以内|1営業日|30日以内/, '開示の内部目標を公開文面に書かない');
  for (const s of ['1,000円（税込）', '3,000円（税込）', '35分以内', 'PDF 等で保存', '二重決済', '契約内容との不一致', '法令上必要な場合']) assert.ok(t.includes(s), s);
  assert.match(t, /完全解析には、解析レポートの本文は含まれません/);
  assert.match(t, /通常の有効期限は設けていません/);
  assert.doesNotMatch(t, /永久|永続|無期限|ずっと/, '期限なし＝サービスの永続の保証、と読める語を使わない');
});

test('規約：A と B は別商品・サービス終了は固定日数なし・リンク紛失で再発行を約束しない・責任の上限に法令の除外', () => {
  const t = text('terms.html');
  assert.match(t, /それぞれ別の商品で、一方を購入しても、もう一方の内容は含まれません/);
  assert.match(t, /合理的な予告期間/);
  assert.doesNotMatch(t, /30日前|[0-9]+日前までに/);
  assert.match(t, /リンクを紛失された場合は、Stripe から届いた請求書のメールをご確認ください/);
  assert.match(t, /故意または重大な過失がある場合を除き/);
  assert.match(t, /消費者契約法その他の法令により/);
  assert.match(t, /通常の有効期限を設けていません/);
  assert.match(t, /PDF をメールでお送りするサービスはありません/);
});

test('プライバシー：IP は照合値のみ・Supabase の地域を書かない・外部サービス一覧', () => {
  const t = text('privacy.html');
  assert.match(t, /IP アドレスそのものは、本サイトのデータベースに保存しません/);
  assert.doesNotMatch(t, /東京|シンガポール|ap-northeast|us-east|eu-west|Tokyo|Singapore/, 'リージョンは確認できるまで書かない');
  for (const s of ['Supabase', 'Stripe', 'Vercel', 'Kit']) assert.ok(t.includes(s), s);
});

test('法務ページは公開ファイルに入り、Production ではビルドが【…】の残りを止める。Preview は通す', () => {
  assert.ok(B.PUBLIC_FILES.includes('tokushoho.html') && B.PUBLIC_FILES.includes('terms.html') && B.PUBLIC_FILES.includes('privacy.html'));
  assert.ok(/【公開日】/.test(read('tokushoho.html')), '公開日は実際の公開の日まで【公開日】');
  assert.deepEqual(B.legalPlaceholderProblems(ROOT, { VERCEL_ENV: 'preview' }), []);
  assert.deepEqual(B.legalPlaceholderProblems(ROOT, {}), []);
  const prod = B.legalPlaceholderProblems(ROOT, { VERCEL_ENV: 'production' });
  assert.equal(prod.length, 3, prod.join('\n'));
  assert.equal(B.legalPlaceholderProblems(ROOT, { LEGAL_RELEASE_CHECK: '1' }).length, 3);
  // 確定済みの文面なら通る
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-legal-'));
  try {
    for (const f of B.LEGAL_PAGES) fs.writeFileSync(path.join(d, f), read(f).replace(/【公開日】/g, '2026年11月1日'));
    assert.deepEqual(B.legalPlaceholderProblems(d, { VERCEL_ENV: 'production' }), []);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('同意版：クライアントの定数と DB の関数が一致。公開日（制定日・改定日）とは別', () => {
  const js = read('diagnosis-save.js');
  const terms = js.match(/REGISTRATION_TERMS_VERSION\s*=\s*'([^']+)'/)[1];
  const priv = js.match(/REGISTRATION_PRIVACY_VERSION\s*=\s*'([^']+)'/)[1];
  const news = js.match(/REGISTRATION_NEWSLETTER_VERSION\s*=\s*'([^']+)'/)?.[1] || js.match(/newsletter[A-Za-z_]*\s*[:=]\s*'(2026-[^']+)'/i)?.[1];
  assert.equal(terms, '2026-10-21');
  assert.equal(priv, '2026-10-21');
  const sql = read('docs/sql/20261021180000_complete_15_consent_versions.sql');
  assert.ok(sql.includes(`'${terms}'`) && sql.includes(`'${priv}'`), 'migration が新しい版を受け付ける');
  assert.ok(sql.includes("'2026-10-07'") && sql.includes("'2026-10-13'"), '旧版も受け付ける（既存の同意記録は書き換えない）');
  assert.match(sql, /\(p_terms_version, p_privacy_version\) is distinct from \('2026-10-07', '2026-10-13'\)\s+and \(p_terms_version, p_privacy_version\) is distinct from \('2026-10-21', '2026-10-21'\)/, '同意は正規の2組だけ（個別の許可リストにしない）');
  assert.doesNotMatch(sql, /p_terms_version not in|p_privacy_version not in/);
  if (news) assert.ok(sql.includes(`'${news}'`));
  assert.doesNotMatch(sql, /delete\s+from\s+public\.profiles/i);
  assert.equal((sql.match(/update\s+public\.profiles/gi) || []).length, 1, '更新は、登録の完了時（onboarding が required の行）の1か所だけ');
  assert.match(sql, /if v_status = 'required' then\s+update public\.profiles/, '既存の同意記録は書き換えない');
  // 公開ページの日付は同意版と無関係（同意版の文字列を公開日として使わない）
  for (const f of ['terms.html', 'privacy.html', 'tokushoho.html']) assert.doesNotMatch(read(f), /版：2026-10-21/, f);
  // ロールバック案は実行用の名前ではない
  assert.ok(fs.existsSync(path.join(ROOT, 'docs/sql/complete_94_rollback_15_DRAFT_DO_NOT_RUN.sql')));
});

test('法務リンク：特商法・規約・プライバシーは各ページ最下部の共通フッターだけ。購入ボタン・アコーディオンの周辺には出さない（同意モーダルは残す）', () => {
  // 購入の入口（CTA・アコーディオン・購入の確認画面）では、法務リンクの部品を呼ばない
  for (const f of ['index.html', 'mypage.html', 'report.html', 'report_sample.html', 'report-link.html', 'purchase-complete.html', 'js/sample-buy.js', 'js/guest-purchase.js']) {
    assert.doesNotMatch(read(f), /legalLinksHtml\(|legalSheet/, f);
  }
  assert.doesNotMatch(read('js/report-purchase.js'), /legalLinksHtml\(\{/, '購入の確認画面に法務リンクを出さない');
  // 各ページの最下部（共通フッター）に、3つの法務ページへのリンクが1組だけ
  for (const f of ['index.html', 'mypage.html', 'report.html', 'report_sample.html', 'report-link.html', 'purchase-complete.html', 'complete-sample.html']) {
    const t = read(f);
    for (const href of ['href="/tokushoho"', 'href="/privacy.html"', 'href="/terms.html"']) {
      assert.equal(t.split(href).length - 1, 1, `${f}: ${href}`);
    }
    const foot = t.lastIndexOf('<footer');
    assert.ok(foot > 0 && t.indexOf('href="/tokushoho"') > foot, `${f}: 法務リンクは最下部のフッターの中`);
  }
  // 登録の同意モーダルには、同意の対象を確かめるための規約・プライバシーへのリンクを残す
  const ro = read('js/registration-onboarding.js');
  assert.match(ro, /<a href="\/terms\.html" target="_blank" rel="noopener">利用規約<\/a>/);
  assert.match(ro, /<a href="\/privacy\.html" target="_blank" rel="noopener">プライバシーポリシー<\/a>/);
  // 旧い規約・プライバシーのモーダル（本文の二重管理）は残さない
  assert.doesNotMatch(read('index.html'), /id="terms"|id="privacy"/);
});

test('連絡先：購入・マイページ・レポートの案内はメールが先。X の DM だけの案内を残さない', () => {
  for (const f of ['index.html', 'mypage.html', 'report.html', 'report-link.html', 'purchase-complete.html', 'api/verify.js']) {
    assert.doesNotMatch(read(f), /@mondayaxad\s*(まで|へ)(DM|ご連絡|お問い合わせ)/, f);
  }
  assert.ok(read('purchase-complete.html').includes(EMAIL));
});

test('決済画面と請求書の文面：提供方法・保存の案内・返金・特商法と規約のリンク', () => {
  const L = require('../lib/link-purchase.js');
  for (const offer of ['analysis', 'direct_complete']) {
    const m = L.checkoutText(offer, 'https://example.test');
    assert.ok(m.length <= 1200, `${offer}: ${m.length}`);
    for (const s of ['固有のリンク', '通常の有効期限はありません', 'PDF等で端末に保存できます', '二重決済', 'https://example.test/tokushoho', 'https://example.test/terms.html']) assert.ok(m.includes(s), `${offer}: ${s}`);
  }
  assert.match(L.checkoutText('direct_complete', 'https://x.test'), /解析レポートの本文は含まれません/);
  assert.match(L.checkoutText('analysis', 'https://x.test'), /1,000円・税込/);
});

test('report_sample は noindex（meta と X-Robots-Tag）', () => {
  assert.match(read('report_sample.html'), /<meta name="robots" content="noindex,nofollow">/);
  const v = JSON.parse(read('vercel.json'));
  const rule = (v.headers || []).find((h) => /report_sample/.test(h.source));
  assert.ok(rule, 'vercel.json の headers');
  assert.ok(rule.headers.some((h) => /x-robots-tag/i.test(h.key) && /noindex/.test(h.value)));
});

test('complete_16：新規の登録完了は新しい組だけ。旧版は履歴として残し、書き換えない。専用の案内文。GA4 に同意版を送らない', () => {
  const sql = read('docs/sql/20261021200000_complete_16_close_old_consent_versions.sql');
  assert.match(sql, /p_terms_version is distinct from '2026-10-21'\s+or p_privacy_version is distinct from '2026-10-21'\s+or p_newsletter_consent_version is distinct from '2026-10-07-v1'/);
  assert.match(sql, /if v_status = 'required' then\s+update public\.profiles/);
  assert.equal((sql.match(/update\s+public\.profiles/gi) || []).length, 1);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.profiles|alter\s+table|drop\s+(table|column)/i);
  for (const g of ['not a preview database', 'not a PostgreSQL 17 server', 'complete_15 is not applied']) assert.ok(sql.includes(g), g);
  assert.match(sql, /on conflict \(version\) do nothing/);
  const rb = read('docs/sql/complete_95_rollback_16_DRAFT_DO_NOT_RUN.sql');
  assert.match(rb, /DRAFT|草案・実行しない/);
  assert.match(rb, /\('2026-10-07', '2026-10-13'\)[\s\S]*\('2026-10-21', '2026-10-21'\)/, 'complete_15 の2組へ戻す');
  assert.match(rb, /delete from supabase_migrations\.schema_migrations where version = '20261021200000'/);
  assert.doesNotMatch(rb, /update\s+public\.profiles\s+set\s+terms_version\s*=\s*'2026-10-0/);
  // 画面：専用の案内文
  assert.match(read('js/registration-onboarding.js'), /利用規約・プライバシーポリシーが更新されました。ページを再読み込みして、もう一度お手続きください。/);
  assert.match(read('js/registration-onboarding.js'), /ページを再読み込みする/);
  assert.match(read('diagnosis-save.js'), /unsupported_consent_version/);
  // GA4 へ同意版を送らない
  assert.doesNotMatch(read('diagnosis-save.js'), /trackEvent\([^)]*consent_version/);
});
