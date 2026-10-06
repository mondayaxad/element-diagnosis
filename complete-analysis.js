/* ============================================================
   complete-analysis.js — 完全解析（46ページ）の表示用状態モデル【PREVIEW ONLY】
   ------------------------------------------------------------
   index.html／mypage.html／report.html が共通で読み込む。
   ここでは「何を表示するか」を決める状態だけを扱い、購入権そのものは一切発行しない。

   重要な前提：
   - 完全解析（新商品）は、既存の product_type = 'complete'（¥2,500・CORE1＋CORE2のセット）とは別商品。
     既存 complete の意味・価格・権限（core_analysis_access + journey_report_access）には触れない。
   - 新商品の仮ID（正式確定前・本番Stripe未接続）：
       core_complete_analysis          … 直接購入 ¥3,000
       core_complete_analysis_upgrade  … 解析レポート購入者の追加 ¥2,000
     どちらの経路でも、同じ診断記録（diagnosis_session_id）へ
       core_analysis_access = true / core_complete_access = true
     が成立する設計とする（docs/COMPLETE_ANALYSIS_PREVIEW_DESIGN.md）。
   - 完全解析の権利APIはまだ無い（CA_COMPLETE_API_READY = false）。その間は
     free と推測せず、完全解析の状態を常に 'unknown' とし、購入CTAを出さない。
   - ?preview_entitlement= による状態切替は Preview でのみ有効。
     本番ビルドでは CA_PREVIEW_BUILD を false にする。加えて本番ホスト名では常に無効、
     ページ側の IS_PREVIEW_BUILD が false の場合も無効（三重のガード）。
   ============================================================ */
(function (global) {
  'use strict';

  // PREVIEW ONLY：本番ビルドでは false にする（PREVIEW_TO_PRODUCTION の手順に追加すること）。
  var CA_PREVIEW_BUILD = true;
  // 本番ホストでは、CA_PREVIEW_BUILD の値に関係なく Preview 用の状態切替を無効にする。
  var CA_PRODUCTION_HOSTS = ['element-diagnosis-five.vercel.app'];
  // 完全解析の権利API（記録単位）が実装されるまで false。false の間、実データでの完全解析状態は unknown。
  var CA_COMPLETE_API_READY = false;

  // PREVIEW ONLY：既存のPreview用CORE1テストPayment Linkをダミーとして使う（本番URL定数とは別物）。
  // client_reference_id は付けない。付けると /api/verify.js が CORE1（¥1,000）の権利として
  // 記録してしまうため。実装時は、サーバー側で diagnosis_session_id を持つCheckout Sessionを作る。
  var CA_PREVIEW_DUMMY_CHECKOUT_URL = 'https://buy.stripe.com/test_9B64gr9micjz9riccu3Nm00'; // PREVIEW ONLY

  var CA_OFFERS = {
    direct: { offer: 'direct_3000', price: '¥3,000', productId: 'core_complete_analysis' },
    upgrade: { offer: 'upgrade_2000', price: '¥2,000', productId: 'core_complete_analysis_upgrade' },
  };

  // Preview で切り替えられる状態（指示書 §6）
  var CA_PREVIEW_STATES = ['free', 'analysis', 'complete-generating', 'complete-ready', 'unknown'];

  // 完全解析の段階画像（利用可能になった元素だけ登録する。未登録は現行の紋章へフォールバック）。
  // 現在 assets/core_constellation/ は存在しないため空。ファイル名の 2of6 等は内部識別子であり、UIには出さない。
  var CA_CONSTELLATION_IMAGES = {};

  function pageSaysProduction() {
    return typeof global.IS_PREVIEW_BUILD !== 'undefined' && global.IS_PREVIEW_BUILD === false;
  }

  function previewEnabled(loc) {
    loc = loc || global.location;
    if (!CA_PREVIEW_BUILD || pageSaysProduction() || !loc) return false;
    var host = String(loc.hostname || '').toLowerCase();
    return CA_PRODUCTION_HOSTS.indexOf(host) === -1;
  }

  function readParam(loc, name) {
    try { return new URLSearchParams((loc && loc.search) || '').get(name); } catch (e) { return null; }
  }

  // Preview の状態名（無効・未指定・不正値なら null）
  function previewStateName(loc) {
    loc = loc || global.location;
    if (!previewEnabled(loc)) return null;
    var v = readParam(loc, 'preview_entitlement');
    return CA_PREVIEW_STATES.indexOf(v) >= 0 ? v : null;
  }
  // 過去記録（新しい順で2件目）だけ別状態にする Preview 専用の補助（記録別の権利分離の確認用）
  function previewPastStateName(loc) {
    loc = loc || global.location;
    if (!previewStateName(loc)) return null;
    var v = readParam(loc, 'preview_past');
    return CA_PREVIEW_STATES.indexOf(v) >= 0 ? v : null;
  }

  // 派生規則（指示書 §5）：完全解析権があれば、同じ記録の解析レポート権も必ず成立する。
  function deriveAccess(entitlements) {
    var e = entitlements || {};
    var complete = e.core_complete_access === true;
    return { analysisAccess: e.core_analysis_access === true || complete, completeAccess: complete };
  }

  function makeState(fields) {
    var s = {
      entitlementStatus: fields.entitlementStatus === 'ok' ? 'ok' : 'unknown',
      analysisAccess: fields.analysisAccess === true,
      completeAccess: fields.completeAccess === true,
      completeStatus: fields.completeStatus || 'none',
      diagnosisSessionId: fields.diagnosisSessionId || '',
      completeReportUrl: fields.completeReportUrl || null,
      preview: fields.preview === true,
    };
    if (s.completeAccess) s.analysisAccess = true; // 包含関係を状態側でも保証する
    if (s.entitlementStatus === 'unknown') { s.analysisAccess = false; s.completeAccess = false; s.completeStatus = 'none'; s.completeReportUrl = null; }
    return s;
  }

  // Preview fixture：状態名 → 表示用状態。実際の購入権・APIには接続しない。
  function previewState(name, diagnosisSessionId) {
    var id = diagnosisSessionId || '';
    switch (name) {
      case 'free': return makeState({ entitlementStatus: 'ok', diagnosisSessionId: id, preview: true });
      case 'analysis': return makeState({ entitlementStatus: 'ok', analysisAccess: true, diagnosisSessionId: id, preview: true });
      case 'complete-generating': return makeState({ entitlementStatus: 'ok', analysisAccess: true, completeAccess: true, completeStatus: 'generating', diagnosisSessionId: id, preview: true });
      case 'complete-ready': return makeState({ entitlementStatus: 'ok', analysisAccess: true, completeAccess: true, completeStatus: 'ready', diagnosisSessionId: id, preview: true });
      default: return makeState({ entitlementStatus: 'unknown', diagnosisSessionId: id, preview: true });
    }
  }

  // 実データでの状態。analysisKnown=false（既存の購入確認に失敗）なら unknown。
  // 完全解析の権利APIが無い間は、解析購入の有無にかかわらず unknown（freeと推測しない）。
  // API実装時は、ここで記録別のAPI応答（entitlementStatus/completeStatus等）から makeState する。
  function realState(opts) {
    var o = opts || {};
    // 現時点では CA_COMPLETE_API_READY = false のため、常にこの分岐（unknown）になる。
    return makeState({ entitlementStatus: 'unknown', diagnosisSessionId: o.diagnosisSessionId });
  }

  // ---- 完全解析の適格性（記録が46ページ生成の入力契約を満たすか） ----
  // prototypes/core1_v4_result_driven の入力契約：ETI v2 の100問（Q001〜Q100・各 -2〜2）と
  // 版（diagnosis: ETI-2.0 / items: ETI-ITEM-2.0.0）。旧版（element-v1）は設問が別物
  // （共通設問0・STYLE層と10価値なし）のため生成できない。画面の「旧版」表示ではなく、
  // 保存された診断版・設問版・回答の検証結果で判定する。確認できないものは不適格（fail-closed）。
  var CA_REQUIRED_DIAGNOSIS_VERSION = 'ETI-2.0';
  var CA_REQUIRED_ITEM_SET_VERSION = 'ETI-ITEM-2.0.0';
  function completeEligibility(rec) {
    var r = rec || {};
    if (r.diagnosisVersion !== CA_REQUIRED_DIAGNOSIS_VERSION) return { eligible: false, reason: 'diagnosis_version' };
    if (r.itemSetVersion !== CA_REQUIRED_ITEM_SET_VERSION) return { eligible: false, reason: 'item_set_version' };
    if (r.answersComplete !== true) return { eligible: false, reason: 'answers_unverified' };
    return { eligible: true, reason: null };
  }
  // 不適格な記録では、Preview の状態指定があっても完全解析の権利・状態・購入導線を成立させない。
  // 解析レポート（analysisAccess）はそのまま残す。
  function withEligibility(state, eligibility) {
    var s = makeState(state || {});
    s.preview = !!(state && state.preview);
    s.completeEligible = !!(eligibility && eligibility.eligible);
    if (!s.completeEligible) { s.completeAccess = false; s.completeStatus = 'none'; s.completeReportUrl = null; }
    return s;
  }
  // 完全解析の購入先（不適格・状態不明・購入済みなら null）
  function completeCheckoutHref(state) {
    return state && state.completeEligible === true && offerFor(state) ? CA_PREVIEW_DUMMY_CHECKOUT_URL : null;
  }

  // GA4 等で使う状態キー
  function stateKey(s) {
    if (!s || s.entitlementStatus !== 'ok') return 'unknown';
    if (s.completeAccess) return s.completeStatus === 'ready' ? 'complete_ready' : s.completeStatus === 'failed' ? 'complete_failed' : 'complete_generating';
    return s.analysisAccess ? 'analysis' : 'free';
  }

  // 購入導線を出してよいか：権利を確認できた free / analysis のときだけ。
  function offerFor(s) {
    var k = stateKey(s);
    if (k === 'free') return CA_OFFERS.direct;
    if (k === 'analysis') return CA_OFFERS.upgrade;
    return null;
  }

  function checkoutUrl() { return CA_PREVIEW_DUMMY_CHECKOUT_URL; }

  function track(name, params) {
    // GA4 へは回答・メール・トークン・完全URLを送らない（指示書 §16）
    var p = {};
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') p[k] = v;
    });
    if (typeof global.gtag === 'function') global.gtag('event', name, p);
  }

  // ---- 表示用の内容データ（権利判定には使わない） ----
  // 三つの観測レンズ。各ページは同じ内容・同じクラスで描き、色はページ側CSSの --ca-mirror 等で付ける。
  var CA_LENSES = [
    { key: 'mirror', en: 'MIRROR', near: '現在のあなたに近い', count: 10 },
    { key: 'hidden', en: 'HIDDEN SHAPE', near: '表に出にくい一面に近い', count: 10 },
    { key: 'mentor', en: 'MENTOR', near: 'これから伸ばす方向に近い', count: 10 },
  ];
  var CA_INTEGRATION_TEXT = '元素・武器種・国家と20軸を横断し、組合せ、活かし方、過剰に働いたときのサインまでを一つの記録に統合します。';

  // variant 'persons'：「現在のあなたに近い人物像」＋右上に「10名」（補助表示 CHARACTERS）
  // variant 'count'  ：「現在のあなたに近い10名」（report・index 向けの短い形）
  function lensListHtml(variant) {
    var rows = CA_LENSES.map(function (l) {
      var desc = variant === 'count' ? l.near + l.count + '名' : l.near + '人物像';
      // 日本語を主表示、英語を補助表示にする（「10名」＋小さな CHARACTERS）
      var tag = variant === 'count' ? '' : '<span class="ca-lens-count"><span class="ca-lens-count-ja">' + l.count + '名</span><span class="ca-lens-count-en">CHARACTERS</span></span>';
      return '<li class="ca-lens ca-lens--' + l.key + '"><span class="ca-lens-head"><span class="ca-lens-en">' + l.en + '</span>' + tag + '</span>'
        + '<span class="ca-lens-desc">' + desc + '</span></li>';
    }).join('');
    return '<ul class="ca-lens-list" aria-label="三つの人物像">' + rows + '</ul>';
  }

  function constellationImage(el, stage) {
    var m = CA_CONSTELLATION_IMAGES[el];
    return (m && m[stage]) || null;
  }

  global.CompleteAnalysis = {
    PREVIEW_STATES: CA_PREVIEW_STATES.slice(),
    OFFERS: CA_OFFERS,
    previewEnabled: previewEnabled,
    previewStateName: previewStateName,
    previewPastStateName: previewPastStateName,
    deriveAccess: deriveAccess,
    makeState: makeState,
    previewState: previewState,
    realState: realState,
    stateKey: stateKey,
    offerFor: offerFor,
    checkoutUrl: checkoutUrl,
    track: track,
    constellationImage: constellationImage,
    LENSES: CA_LENSES,
    INTEGRATION_TEXT: CA_INTEGRATION_TEXT,
    lensListHtml: lensListHtml,
    completeApiReady: CA_COMPLETE_API_READY,
    completeEligibility: completeEligibility,
    withEligibility: withEligibility,
    completeCheckoutHref: completeCheckoutHref,
    isPreviewDummyCheckout: true,
  };
})(typeof window !== 'undefined' ? window : globalThis);
