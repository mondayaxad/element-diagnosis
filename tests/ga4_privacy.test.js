// GA4（js/ga.js）の試験：本番ドメインだけで送信・page_location／page_referrer の消毒・イベントの値の消毒、
// と、ページの計測呼び出しに記録 ID・メール等を渡していないこと（静的な確認）。
//   実行: node --test tests/ga4_privacy.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/ga.js'), 'utf8');

function run(host, { referrer = '', search = '?token=abc', preset } = {}) {
  const appended = [];
  const win = {};
  if (preset) win.gtag = preset;
  const ctx = {
    window: win,
    location: { hostname: host, origin: `https://${host}`, pathname: '/report.html', search },
    document: { referrer, head: { appendChild: (s) => appended.push(s) }, createElement: () => ({}) },
  };
  ctx.window.dataLayer = undefined;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { win: ctx.window, appended };
}
const PROD = 'element-diagnosis-five.vercel.app';

test('本番ドメインでだけ GA4 を読み込む。Preview・ローカルでは何も送らない（既存の gtag は上書きしない）', () => {
  for (const host of ['element-diagnosis-git-release-c-preview-nmkw0322-4497s-projects.vercel.app', 'localhost', '127.0.0.1']) {
    const r = run(host);
    assert.equal(r.appended.length, 0, host);
    r.win.gtag('event', 'x', { a: 1 });
    assert.equal(r.win.dataLayer.length, 0, host);
  }
  const hook = () => 'hook';
  assert.equal(run('localhost', { preset: hook }).win.gtag, hook);
  const p = run(PROD);
  assert.equal(p.appended.length, 1);
  assert.match(p.appended[0].src, /^https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-/);
});

test('page_location は origin＋path だけ・page_referrer は origin だけ（Stripe の Session ID を送らない）', () => {
  const p = run(PROD, { referrer: 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3d4e5f6#frag', search: '?token=secret' });
  const config = p.win.dataLayer.find((a) => a[0] === 'config');
  assert.equal(config[2].page_location, `https://${PROD}/report.html`);
  assert.equal(config[2].page_referrer, 'https://checkout.stripe.com/');
  assert.ok(!JSON.stringify(Array.from(p.win.dataLayer, (a) => Array.from(a))).includes('cs_test_'));
});

test('イベントの値を消毒：記録 ID・メール・Stripe ID・URL・トークン・Storage のパス・診断コードを送らない', () => {
  const p = run(PROD);
  p.win.gtag('event', 'complete_report_open', {
    diagnosis_session_id: '11111111-1111-4111-8111-111111111111', source: 'mypage', offer: 'analysis', value: 1000, currency: 'JPY',
    email: 'a@example.test', note: 'owner@example.test', token: 'abc', x: 'https://example.test/?token=1', s: 'cs_test_abcdefghijklmn',
    path: 'reports/abc/1.html', c: 'a'.repeat(60), uid: 'u', ref: 'a1b2c3d4e5f6a7b8c9d0', ok: true, items: [{ item_id: 'analysis', price: 1000, user_id: 'x' }],
  });
  const ev = Array.from(p.win.dataLayer.find((a) => a[0] === 'event'));
  assert.deepEqual(JSON.parse(JSON.stringify(ev[2])), { source: 'mypage', offer: 'analysis', value: 1000, currency: 'JPY', ok: true, items: [{ item_id: 'analysis', price: 1000 }] });
});

test('ページの計測呼び出しに記録 ID・user ID・メール・トークン・診断コードを渡していない（静的な確認）', () => {
  const files = ['index.html', 'mypage.html', 'report.html', 'purchase-complete.html', 'complete-analysis.js', 'diagnosis-save.js', 'js/guest-purchase.js', 'js/eti_v2_save.js'];
  for (const f of files) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of s.matchAll(/(?:gtag\(\s*'event'|trackEvent\(|\.track\()[^;\n]{0,240}/g)) {
      assert.doesNotMatch(m[0], /diagnosis_session_id|user_id|session_id|email|access_token|encoded|diagnosisCode|shortCode|claim_secret|viewUrl|storage_path/, `${f}: ${m[0]}`);
    }
  }
  // ページは共通の js/ga.js だけで GA4 を読み込む（直接 gtag/js を読み込まない）
  for (const f of ['index.html', 'mypage.html', 'report.html', 'purchase-complete.html']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(s, /<script src="\/js\/ga\.js"><\/script>/, f);
    assert.doesNotMatch(s, /googletagmanager\.com\/gtag\/js/, f);
  }
});
