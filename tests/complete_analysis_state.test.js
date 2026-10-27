// complete-analysis.js（完全解析の表示用状態・Previewガード）のテスト。
//   実行: node --test tests/complete_analysis_state.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// vm 内で作られたオブジェクトは別 realm のため、比較前に素のオブジェクトへ写す
const plain = (v) => JSON.parse(JSON.stringify(v));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'complete-analysis.js'), 'utf8');

function load({ host = 'element-diagnosis-git-release-c-preview.vercel.app', search = '', isPreviewBuild } = {}) {
  const events = [];
  const win = { location: { hostname: host, search }, gtag: (_e, name, p) => events.push([name, p]) };
  if (isPreviewBuild !== undefined) win.IS_PREVIEW_BUILD = isPreviewBuild;
  const ctx = vm.createContext({ window: win, URLSearchParams });
  vm.runInContext(SRC, ctx);
  return { CA: win.CompleteAnalysis, events };
}

test('派生規則：complete 権があれば同じ記録の analysis 権も成立する', () => {
  const { CA } = load();
  assert.deepEqual(plain(CA.deriveAccess({ core_analysis_access: true })), { analysisAccess: true, completeAccess: false });
  assert.deepEqual(plain(CA.deriveAccess({ core_complete_access: true })), { analysisAccess: true, completeAccess: true });
  assert.deepEqual(plain(CA.deriveAccess({})), { analysisAccess: false, completeAccess: false });
  // 既存 complete（¥2,500）の journey_report_access は完全解析権ではない
  assert.deepEqual(plain(CA.deriveAccess({ core_analysis_access: true, journey_report_access: true })), { analysisAccess: true, completeAccess: false });
});

test('Preview 5状態：表示状態と購入導線', () => {
  const { CA } = load();
  const s = (n) => CA.previewState(n, 'A');
  assert.equal(CA.stateKey(s('free')), 'free');
  assert.equal(CA.offerFor(s('free')).productId, 'core_complete_analysis');
  assert.equal(CA.offerFor(s('free')).price, '¥3,000');
  assert.equal(CA.stateKey(s('analysis')), 'analysis');
  assert.equal(CA.offerFor(s('analysis')).productId, 'core_complete_analysis_upgrade');
  assert.equal(CA.offerFor(s('analysis')).price, '¥2,000');
  const gen = s('complete-generating');
  assert.equal(CA.stateKey(gen), 'complete_generating');
  assert.equal(gen.analysisAccess, true, 'generating でも解析レポートは閲覧可');
  assert.equal(CA.offerFor(gen), null, 'generating では追加購入CTAを出さない');
  const ready = s('complete-ready');
  assert.equal(CA.stateKey(ready), 'complete_ready');
  assert.equal(ready.analysisAccess && ready.completeAccess, true, 'ready は両方閲覧可');
  assert.equal(CA.offerFor(ready), null);
  const unk = s('unknown');
  assert.equal(CA.stateKey(unk), 'unknown');
  assert.equal(CA.offerFor(unk), null, 'unknown では購入CTAを出さない');
  assert.equal(unk.analysisAccess || unk.completeAccess, false, 'unknown を購入済みと推測しない');
  assert.equal(CA.stateKey(null), 'unknown');
});

test('free は analysis/complete とも閲覧不可、analysis は解析レポートのみ', () => {
  const { CA } = load();
  const f = CA.previewState('free', 'A');
  assert.equal(f.analysisAccess, false); assert.equal(f.completeAccess, false);
  const a = CA.previewState('analysis', 'A');
  assert.equal(a.analysisAccess, true); assert.equal(a.completeAccess, false);
});

test('実データ：解析レポートの購入状態を確認できたときだけ free／analysis。確認できなければ unknown', () => {
  const { CA } = load();
  assert.equal(CA.completeApiReady, false);
  assert.equal(CA.completeSalesOpen, false);
  // 解析レポートの購入状態を確認できない：unknown（購入導線なし）
  const u = CA.realState({ analysisKnown: false, analysisAccess: true, diagnosisSessionId: 'A' });
  assert.equal(CA.stateKey(u), 'unknown');
  assert.equal(CA.offerFor(u), null);
  // 確認できた：完全解析は販売前なので未購入で確定（free／analysis）
  assert.equal(CA.stateKey(CA.realState({ analysisKnown: true, analysisAccess: false })), 'free');
  assert.equal(CA.stateKey(CA.realState({ analysisKnown: true, analysisAccess: true })), 'analysis');
  // 販売開始後、完全解析の権利APIが無い間は unknown に戻す（推測しない）
  const openSrc = SRC.replace('var CA_COMPLETE_SALES_OPEN = false;', 'var CA_COMPLETE_SALES_OPEN = true;');
  assert.notEqual(openSrc, SRC);
  const win = { location: { hostname: 'x.vercel.app', search: '' } };
  vm.runInContext(openSrc, vm.createContext({ window: win, URLSearchParams }));
  assert.equal(win.CompleteAnalysis.stateKey(win.CompleteAnalysis.realState({ analysisKnown: true, analysisAccess: false })), 'unknown');
});

test('?preview_entitlement は Preview でのみ有効', () => {
  assert.equal(load({ search: '?preview_entitlement=complete-ready' }).CA.previewStateName(), 'complete-ready');
  assert.equal(load({ search: '?preview_entitlement=bogus' }).CA.previewStateName(), null);
  // 本番ホスト名では無効
  assert.equal(load({ host: 'element-diagnosis-five.vercel.app', search: '?preview_entitlement=free' }).CA.previewStateName(), null);
  // ページの IS_PREVIEW_BUILD=false（本番ビルド）では無効
  assert.equal(load({ search: '?preview_entitlement=free', isPreviewBuild: false }).CA.previewStateName(), null);
  // CA_PREVIEW_BUILD=false（本番ビルド）でも無効
  const prodSrc = SRC.replace('var CA_PREVIEW_BUILD = true;', 'var CA_PREVIEW_BUILD = false;');
  assert.notEqual(prodSrc, SRC);
  const win = { location: { hostname: 'x.vercel.app', search: '?preview_entitlement=free' } };
  vm.runInContext(prodSrc, vm.createContext({ window: win, URLSearchParams }));
  assert.equal(win.CompleteAnalysis.previewStateName(), null);
});

test('preview_past は preview_entitlement と組で、Previewでのみ有効', () => {
  assert.equal(load({ search: '?preview_entitlement=free&preview_past=complete-ready' }).CA.previewPastStateName(), 'complete-ready');
  assert.equal(load({ search: '?preview_past=complete-ready' }).CA.previewPastStateName(), null);
});

test('決済未接続：完全解析の購入先は常に無し。ダミーの Payment Link も持たない', () => {
  const { CA } = load();
  assert.equal(CA.checkoutUrl(), null);
  assert.equal(CA.isPreviewDummyCheckout, false);
  assert.ok(!/buy\.stripe\.com/.test(SRC), 'complete-analysis.js に Stripe のリンクが無い');
  for (const name of ['free', 'analysis']) {
    const st = CA.withEligibility(CA.previewState(name, 'A'), { eligible: true });
    assert.equal(CA.completeCheckoutHref(st), null, name);
    assert.ok(CA.pendingOfferFor(st), name);
  }
});

test('準備中ボタン：押せない button。href・onclick・商品IDを持たない。価格と「準備中」を表示', () => {
  const { CA } = load();
  const direct = CA.pendingButtonHtml(CA.OFFERS.direct, 'x');
  const up = CA.pendingButtonHtml(CA.OFFERS.upgrade, 'x');
  assert.match(direct, /^<button type="button" class="x is-pending" disabled aria-disabled="true"/);
  assert.ok(direct.includes('>完全解析 ¥3,000（準備中）</button>'));
  assert.ok(up.includes('>完全解析へアップグレード ¥2,000（準備中）</button>'));
  for (const h of [direct, up]) {
    assert.ok(!/href=|onclick=|data-product-id|buy\.stripe/.test(h), h);
  }
  assert.equal(CA.pendingButtonHtml(null, 'x'), '');
  // 不適格・状態不明・購入済みでは準備中ボタンも出さない
  assert.equal(CA.pendingOfferFor(CA.withEligibility(CA.previewState('free', 'A'), { eligible: false })), null);
  assert.equal(CA.pendingOfferFor(CA.withEligibility(CA.previewState('unknown', 'A'), { eligible: true })), null);
  assert.equal(CA.pendingOfferFor(CA.withEligibility(CA.previewState('complete-ready', 'A'), { eligible: true })), null);
});

test('GA4 へは文字列・数値・真偽値だけを送る', () => {
  const { CA, events } = load();
  CA.track('complete_checkout_click', { source: 'index', preview_dummy: true, nested: { a: 1 }, fn() {} });
  assert.deepEqual(plain(events), [['complete_checkout_click', { source: 'index', preview_dummy: true }]]);
});

test('右上入口：Preview 指定の有無に関係なく出す（未購入者にも出す。2026-10-07）', () => {
  assert.equal(load().CA.headerEntryEnabled(), true, '指定なし');
  assert.equal(load({ host: 'element-diagnosis-five.vercel.app' }).CA.headerEntryEnabled(), true);
  assert.equal(load().CA.stateKey(load().CA.realState({ analysisKnown: false })), 'unknown');
});
