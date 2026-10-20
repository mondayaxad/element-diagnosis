// 完全解析の閲覧：ログインなしの購入（ゲスト）で開いた時だけ、最下部にマイページの作成への導線を足す（保存した生成物は変えない）
//   ログイン中の本人の閲覧が保存物とバイト単位で同じことは tests/complete_report_job.test.js で確かめている
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { withMypageFooter } = require('../api/complete-status.js');

test('最下部（</body> の直前）に1回だけ「マイページを作成する（この購入を引き継ぎます）」を足す。同じタブのリンクだけ（スクリプト・別タブなし）', () => {
  const html = Buffer.from('<!doctype html><html><body><main>REPORT</main></body></html>', 'utf8');
  const out = withMypageFooter(html);
  assert.equal((out.match(/マイページを作成する（この購入を引き継ぎます）/g) || []).length, 1);
  assert.ok(out.indexOf('</main>') < out.indexOf('マイページを作成する') && out.indexOf('マイページを作成する') < out.lastIndexOf('</body>'));
  assert.match(out, /<a href="\/mypage\.html"/);
  assert.match(out, /購入時のメールアドレス<\/b>でマイページを作成（ログイン）すると、この診断記録と完全解析・解析レポートがマイページに引き継がれ、いつでも見返せます。購入した端末でなくても引き継げます。/);
  assert.doesNotMatch(out, /<script|target=|onclick|javascript:/i);
  assert.ok(out.startsWith('<!doctype html><html><body><main>REPORT</main>'), '本文は変えない');
  // </body> が無い時は末尾に足す
  assert.ok(withMypageFooter('<main>x</main>').endsWith('</aside>'));
});

test('閲覧の処理：固有リンクから開いた時だけ登録の欄を足す（照合〔SHA-256〕の後）。以前のゲスト購入の「引き継ぎ」の案内は足さない（廃止）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'complete-status.js'), 'utf8');
  const hashAt = src.indexOf("digest('hex') !== row.output_sha256");
  const footerAt = src.indexOf("if (t.deliveryId && queryParam(req, 'src') === 'link') body = withDeliveryFooter(body, queryParam(req, 'view'));");
  assert.ok(hashAt > 0 && footerAt > hashAt);
  assert.equal(src.indexOf('body = withMypageFooter(body)'), -1);
});
