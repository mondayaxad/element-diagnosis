// 完全解析の閲覧：ログインなしの購入（ゲスト）で開いた時だけ、最下部にマイページの作成への導線を足す（保存した生成物は変えない）
//   ログイン中の本人の閲覧が保存物とバイト単位で同じことは tests/complete_report_job.test.js で確かめている
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { withMypageFooter } = require('../api/complete-status.js');

test('最下部（</body> の直前）に1回だけ「マイページを作成する（購入時のメールで確認）」を足す。同じタブのリンクだけ（スクリプト・別タブなし）', () => {
  const html = Buffer.from('<!doctype html><html><body><main>REPORT</main></body></html>', 'utf8');
  const out = withMypageFooter(html);
  assert.equal((out.match(/マイページを作成する（購入時のメールで確認）/g) || []).length, 1);
  assert.ok(out.indexOf('</main>') < out.indexOf('マイページを作成する') && out.indexOf('マイページを作成する') < out.lastIndexOf('</body>'));
  assert.match(out, /<a href="\/mypage\.html#recover"/);
  assert.match(out, /マイページを作成すると、この診断記録と完全解析を、いつでも見返せます。/);
  assert.doesNotMatch(out, /<script|target=|onclick|javascript:/i);
  assert.ok(out.startsWith('<!doctype html><html><body><main>REPORT</main>'), '本文は変えない');
  // </body> が無い時は末尾に足す
  assert.ok(withMypageFooter('<main>x</main>').endsWith('</aside>'));
});

test('閲覧の処理：ゲスト（本人なし）の時だけ足す。照合（SHA-256）の後に足す', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'complete-status.js'), 'utf8');
  const hashAt = src.indexOf("digest('hex') !== row.output_sha256");
  const footerAt = src.indexOf('if (t.userId == null) body = withMypageFooter(body);');
  assert.ok(hashAt > 0 && footerAt > hashAt);
});
