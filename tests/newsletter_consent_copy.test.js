// お知らせメールの同意（一体型・1ボタン）の文面と、登録画面・privacy・terms の一致、Kit 連携の配線の静的検査。
//   実行: node --test tests/newsletter_consent_copy.test.js
// ブラウザでの表示は tests/registration_modal_ui.test.js、API の動作は tests/subscribe_api.test.js。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const NOTICE = '「同意して登録を完了する」を押すと、元素診断から、診断結果の保存に必要なご案内のほか、アップデート、新しい解析、商品・企画などのお知らせメールを受け取ることにも同意したものとします。配信は、メール内のリンクからいつでも停止できます。';
const BUTTON = '同意して登録を完了する';

test('登録画面：確定文面。案内文がボタン名（「同意して登録を完了する」）と結び付く。送信元は「元素診断」で運営者名は出さない', () => {
  const src = read('js/registration-onboarding.js');
  const { REGISTRATION_NEWSLETTER_NOTICE } = require(path.join(ROOT, 'js', 'registration-onboarding.js'));
  assert.equal(REGISTRATION_NEWSLETTER_NOTICE, NOTICE);
  assert.ok(NOTICE.startsWith('「' + BUTTON + '」を押すと'));
  assert.ok(src.includes('>' + BUTTON + '</button>'), 'button label');
  assert.ok(!/マンデーアクスト/.test(src), '運営者名を登録画面に出さない');
  assert.ok(!src.includes('id="roNewsletter"') && src.match(/type="checkbox"/g).length === 3, 'お知らせメール専用のチェックは無い（全体＋規約＋プライバシーの3つ）');
});

test('privacy・terms：登録画面と同じ意味（ボタンでお知らせメールの受信にも同意／送信元は「元素診断」／内容／停止方法）', () => {
  for (const f of ['privacy.html', 'terms.html']) {
    const t = read(f);
    for (const s of ['「同意して登録を完了する」を押す', 'お知らせメールの受信にも同意したものとして扱います', 'お知らせメールは「元素診断」からお送りします',
      '元素診断のアップデート', '新しい解析', '関連する商品・企画', '配信メール内のリンクから停止']) {
      assert.ok(t.includes(s), f + ': ' + s);
    }
  }
});

test('法務ページ：運営者の正式情報・問い合わせ先・版は変わっていない。公開日は 2026年10月27日 に確定（【…】は残っていない）', () => {
  const privacy = read('privacy.html'); const terms = read('terms.html'); const toku = read('tokushoho.html');
  assert.ok(privacy.includes('マンデーアクスト'));
  assert.ok(toku.includes('マンデーアクスト'));
  assert.equal((privacy.match(/mailto:/g) || []).length, 1);
  assert.equal((terms.match(/mailto:/g) || []).length, 1);
  assert.equal((toku.match(/mailto:/g) || []).length, 2);
  assert.ok(terms.includes('制定日：2026年7月1日 / 改定日：2026年10月27日'));
  assert.ok(privacy.includes('制定日：2026年7月1日 / 改定日：2026年10月27日'));
  assert.ok(toku.includes('制定日：2026年10月27日'));
  for (const t of [privacy, terms, toku]) assert.doesNotMatch(t, /【[^】]{1,20}】/);
  assert.ok(!/お知らせメールへの同意は任意|受け取るを選んだ場合のみ|保存時に選択|専用チェックボックス/.test(privacy + terms));
});

test('同意版：お知らせメールは 2026-10-07-v1 のまま（クライアント・API・RPC が同じ版）、規約・プライバシーは 2026-10-21', () => {
  assert.match(read('diagnosis-save.js'), /const NEWSLETTER_CONSENT_VERSION = '2026-10-07-v1';/);
  assert.equal(require(path.join(ROOT, 'api', 'subscribe.js')).CONSENT_VERSION, '2026-10-07-v1');
  assert.match(read('diagnosis-save.js'), /const REGISTRATION_TERMS_VERSION = '2026-10-21';/);
  assert.match(read('diagnosis-save.js'), /const REGISTRATION_PRIVACY_VERSION = '2026-10-21';/);
  assert.ok(read('docs/sql/20261021200000_complete_16_close_old_consent_versions.sql').includes("'2026-10-07-v1'"));
});

test('クライアント：/api/subscribe の fetch は keepalive。診断の保存の後に呼び、失敗しても保存・登録を失敗扱いにしない', () => {
  const src = read('diagnosis-save.js');
  const i = src.indexOf('async function subscribeToNewsletter');
  const seg = src.slice(i, i + 1100);
  assert.match(seg, /fetch\('\/api\/subscribe', \{\s*method: 'POST',\s*keepalive: true,/);
  assert.ok(!/email/i.test(seg.slice(seg.indexOf('body:'), seg.indexOf('body:') + 120)), 'メールをブラウザから送らない');
  const flow = src.slice(src.indexOf('async function runSignedInFlow'));
  assert.ok(flow.indexOf('savePendingDiagnosisV1') < flow.indexOf('syncNewsletterIfDue'));
  assert.match(flow, /await syncNewsletterIfDue\(reg\.profile\)\.catch\(\(\) => \{\}\)/);
});

test('KIT_API_KEY はサーバー（api/subscribe.js）だけが参照し、ブラウザ用ファイル・公開設定に出ない', () => {
  for (const f of ['diagnosis-save.js', 'js/registration-onboarding.js', 'api/public-config.js', 'index.html', 'mypage.html']) {
    assert.ok(!/KIT_API_KEY|X-Kit-Api-Key/.test(read(f)), f);
  }
  assert.match(read('api/subscribe.js'), /X-Kit-Api-Key/);
});
