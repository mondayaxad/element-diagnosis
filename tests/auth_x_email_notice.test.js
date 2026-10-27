// X ログインはメールアドレス（確認済み）が必要：案内の文面と、メールが取れなかった時の理由の出し方
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('../js/auth-providers.js');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'auth-providers.js'), 'utf8');

test('X のボタンの下に、メールアドレスが必要な旨の案内がある（X が有効な時だけ出るボタンと同じ箇所）', () => {
  const i = src.indexOf('data-au="x"');
  assert.ok(i > 0);
  const near = src.slice(i, i + 700);
  assert.match(near, /Xでは、メールアドレスの登録（確認済み）が必要です/);
  assert.match(near, /Google またはメールで続けてください/);
});

test('X からメールが取れずに戻った時：理由と代わりの方法を案内する', () => {
  const m = A.authSignInErrorMessage({ code: 'server_error', description: 'Error getting user email from external provider' });
  assert.match(m, /メールアドレスを受け取れなかったため、ログインできませんでした/);
  assert.match(m, /Xでは、アカウントにメールアドレスの登録（確認済み）が必要/);
  assert.match(m, /Google またはメールでお試しください/);
});

test('メール以外のエラー・中止は従来どおりの文面', () => {
  assert.equal(A.authSignInErrorMessage({ code: 'access_denied', description: '' }), 'ログインを中止しました。');
  assert.match(A.authSignInErrorMessage({ code: 'server_error', description: 'unexpected failure' }), /ログインできませんでした。時間をおいて/);
});
