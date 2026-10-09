// complete-analysis.js の MENTOR 目標の選択の判定（Production では出さない・完全解析の導線の決め方）。
//   実行: node --test tests/mentor_goal_state.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const plain = (v) => JSON.parse(JSON.stringify(v));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'complete-analysis.js'), 'utf8');
const MYPAGE = fs.readFileSync(path.join(__dirname, '..', 'mypage.html'), 'utf8');

function load(config, host = 'element-diagnosis-git-release-c-preview.vercel.app') {
  const events = [];
  const win = { location: { hostname: host, search: '' }, gtag: (_e, name, p) => events.push([name, p]) };
  if (config !== undefined) win.__ED_PUBLIC_CONFIG__ = config;
  const ctx = vm.createContext({ window: win, URLSearchParams });
  vm.runInContext(SRC, ctx);
  return { CA: win.CompleteAnalysis, events };
}
const rec = (over) => Object.assign({ completeEligible: true, ineligibleReason: null, mentorGoal: null, mentorGoalLocked: false, checkoutInProgress: false,
  completeEntitlement: null, completeStatus: 'none', analysisSource: null, legacyPurchasePending: false, repurchaseBlocked: false }, over || {});

test('MENTOR の選択は公開設定の appEnv が preview・production のときだけ（ホスト名では判断しない）', () => {
  assert.equal(load({ appEnv: 'preview' }).CA.mentorSelectEnabled(), true);
  assert.equal(load({ appEnv: 'production' }).CA.mentorSelectEnabled(), true);
  assert.equal(load({ appEnv: 'staging' }, 'element-diagnosis-five.vercel.app').CA.mentorSelectEnabled(), false);
  assert.equal(load({ appEnv: 'preview' }, 'element-diagnosis-five.vercel.app').CA.mentorSelectEnabled(), true, 'ホスト名ではなく公開設定で判断する（サーバー側でも 404）');
  assert.equal(load({ appEnv: 'development' }).CA.mentorSelectEnabled(), false);
  assert.equal(load(undefined).CA.mentorSelectEnabled(), false);
  assert.equal(load(null).CA.mentorSelectEnabled(), false);
  assert.match(SRC, /var CA_MENTOR_SELECT_OPEN = true;/);
});

test('完全解析の導線：サーバーの状態から決める（診断コードのハッシュ一致だけでは ¥2,000 にしない）', () => {
  const { CA } = load({ appEnv: 'preview' });
  const kind = (c, lookup = 'ok') => plain(CA.completeOfferFor(c, lookup));
  assert.deepEqual(kind(rec(), 'failed'), { kind: 'unknown' });
  assert.deepEqual(kind(rec(), 'none'), { kind: 'unknown' });
  assert.deepEqual(kind(null), { kind: 'unknown' });
  assert.equal(kind(rec()).kind, 'offer');
  assert.equal(kind(rec()).offer.offer, 'direct_3000');
  assert.equal(kind(rec({ analysisSource: 'legacy_purchase_entitlement' })).offer.offer, 'upgrade_2000');
  assert.equal(kind(rec({ analysisSource: 'record_entitlement' })).offer.offer, 'upgrade_2000');
  assert.deepEqual(kind(rec({ legacyPurchasePending: true })), { kind: 'legacy_pending' });
  assert.deepEqual(kind(rec({ checkoutInProgress: true })), { kind: 'checkout_in_progress' });
  assert.deepEqual(kind(rec({ completeEligible: false, ineligibleReason: 'version_mismatch' })), { kind: 'ineligible', reason: 'version_mismatch' });
  assert.deepEqual(kind(rec({ repurchaseBlocked: true })), { kind: 'closed' });
  assert.deepEqual(kind(rec({ completeEntitlement: 'active' })), { kind: 'purchased' });
  assert.equal(CA.LEGACY_PENDING_TEXT, '既存の解析レポート購入を確認しています');
});

test('mypage：MENTOR の段階の計測は目標選択の1件だけ（目標・記録 ID を送らない）・history を使わない・停止中の決済ボタンは押せない', () => {
  const start = MYPAGE.indexOf('/* ---- MENTOR 目標の選択（2026-10-07）');
  const end = MYPAGE.indexOf('let caLastFocus = null;');
  assert.ok(start > 0 && end > start);
  const block = MYPAGE.slice(start, end);
  const calls = block.match(/\.track\(|trackEvent\([^)]*\)|gtag\(|dataLayer/g) || [];
  assert.deepEqual(calls, ["trackEvent('complete_goal_select', { source: 'mypage' })"]);
  assert.doesNotMatch(block, /pushState|replaceState|location\.hash/);
  assert.doesNotMatch(block, /console\.(log|error|warn)/);
  assert.match(block, /決済へ進む（準備中）<\/button>/);
  assert.match(block, /disabled aria-disabled="true">決済へ進む（準備中）/);
  assert.match(block, /<fieldset class="ca-goal-fieldset">\s*<legend>目標<\/legend>/);
  assert.match(block, /type="radio" name="ca-mentor-goal"/);
  assert.match(MYPAGE, /input:not\(\[disabled\]\)/, 'フォーカスの閉じ込めに radio を含める');
});
