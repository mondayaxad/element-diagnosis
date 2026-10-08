// 完全解析の閲覧の状態モデル（complete-analysis.js）の単体テスト。ブラウザ・API へは接続しない。
//   実行: node --test tests/complete_view_state.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(appEnv) {
  const ctx = { console, URLSearchParams };
  ctx.window = ctx;
  if (appEnv) ctx.__ED_PUBLIC_CONFIG__ = { appEnv };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'complete-analysis.js'), 'utf8'), ctx);
  return ctx.CompleteAnalysis;
}

test('状態の対応：queued・generating は準備中、ready＋active は見る、failed・取得失敗は再確認、suspended・revoked は案内、権利なしは従来', () => {
  const C = load('preview');
  const k = (entitlement, reportStatus, lookupFailed) => C.completeViewStateFor({ entitlement, reportStatus, lookupFailed }).kind;
  assert.equal(k('active', 'queued'), 'preparing');
  assert.equal(k('active', 'generating'), 'preparing');
  assert.equal(k('active', 'none'), 'preparing', '生成物の行がまだ無い');
  assert.equal(k('active', 'ready'), 'ready');
  assert.equal(k('active', 'failed'), 'retry');
  assert.equal(k('active', 'revoked'), 'revoked');
  assert.equal(k('suspended', 'ready'), 'suspended', '生成物が ready でも停止中は見せない');
  assert.equal(k('revoked', 'ready'), 'revoked');
  assert.equal(k(null, 'none'), 'none');
  assert.equal(k(undefined, 'ready'), 'none', '権利なしで生成物だけがあっても見せない');
  assert.equal(k('active', 'ready', true), 'retry');
  const T = C.VIEW_TEXT;
  assert.deepEqual({ ...T }, { preparing: '完全解析を準備しています', ready: '完全解析を見る', retry: 'もう一度確認する', suspended: '現在、完全解析を閲覧できません', revoked: 'この完全解析は利用できません' });
});

test('my-entitlements の記録・complete-status の応答から同じ規則で決める', () => {
  const C = load('preview');
  assert.equal(C.completeViewFromRecord({ completeEntitlement: 'active', completeStatus: 'ready' }, 'ok').kind, 'ready');
  assert.equal(C.completeViewFromRecord(null, 'failed').kind, 'retry');
  assert.equal(C.completeViewFromRecord(null, 'ok').kind, 'none');
  assert.equal(C.completeViewFromRecord({ completeEntitlement: 'active', completeStatus: 'ready' }, 'none').kind, 'none', 'v2 の項目なし（Production の応答）');
  assert.equal(C.completeViewFromStatus({ entitlements: { complete: 'active' }, report: { status: 'generating' } }).kind, 'preparing');
  assert.equal(C.completeViewFromStatus({ entitlements: { complete: 'active' }, report: null }).kind, 'preparing');
  assert.equal(C.completeViewFromStatus({ entitlements: { complete: null }, report: null }).kind, 'none');
  assert.equal(C.completeViewFromStatus(null).kind, 'retry');
});

test('戻りの確認は 2秒→3秒→5秒… で合計60秒以内（無限に確認しない）', () => {
  const C = load('preview');
  const d = C.RETURN_POLL_DELAYS;
  assert.deepEqual([...d.slice(0, 3)], [2, 3, 5]); // vm の別領域の配列なので展開して比べる
  assert.ok(d.reduce((a, b) => a + b, 0) <= 60);
  assert.ok(d.length <= 12);
});

test('機能フラグ：appEnv が preview の時だけ有効（Production・設定なし・その他は無効）', () => {
  assert.equal(load('preview').completeViewEnabled(), true);
  for (const env of ['production', 'development', null]) assert.equal(load(env).completeViewEnabled(), false, String(env));
  // 販売は閉じたまま（Checkout の導線は押せない準備中のまま）
  assert.equal(load('preview').completeSalesOpen, false);
  assert.equal(load('preview').completeCheckoutHref(), null);
});
