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
   - 完全解析の権利APIはまだ無い（CA_COMPLETE_API_READY = false）。完全解析はまだ販売していない
     （CA_COMPLETE_SALES_OPEN = false）ため、実データでは「完全解析の権利は無い」と確定できる。
     解析レポートの購入状態（/api/my-entitlements）を確認できた記録だけ free／analysis とし、
     確認できなければ 'unknown'（購入導線を出さない）。
   - 決済は未接続（2026-10-07）。¥3,000／¥2,000 は「準備中」の押せないボタンとして見せるだけで、
     href・決済イベント・外部遷移を持たせない。ダミーの Payment Link にも接続しない。
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
  // 完全解析の権利API（記録単位）が実装されるまで false。
  var CA_COMPLETE_API_READY = false;
  // 完全解析（¥3,000／追加¥2,000）の決済を開始するまで false。false の間、購入先は常に無し（null）。
  // 実装時は、サーバー側で diagnosis_session_id を持つ Checkout Session を作る（Payment Link は使わない）。
  var CA_COMPLETE_SALES_OPEN = false;
  // 2026-10-09：販売の開閉はサーバーの COMPLETE_SALES_OPEN だけで決める（/api/public-config の completeSalesOpen）。
  // 公開設定が無い・false なら上の false のまま（販売停止）。権利 API も公開設定が示す時だけ使う。
  (function () {
    var cfg = global.__ED_PUBLIC_CONFIG__;
    if (cfg && cfg.completeApiReady === true) CA_COMPLETE_API_READY = true;
    if (cfg && cfg.completeSalesOpen === true) CA_COMPLETE_SALES_OPEN = true;
  })();

  // MENTOR 目標の選択（2026-10-07）。決済（Checkout）は未接続のまま、目標の選択と確認画面までを Preview で開く。
  // 有効になるのは、この値が true かつ /api/public-config の appEnv が "preview" のときだけ（ホスト名では判断しない）。
  // サーバー側も Preview 以外では /api/mentor-goal が 404 not_available を返す（二重の停止）。
  var CA_MENTOR_SELECT_OPEN = true;
  // 完全解析の閲覧（2026-10-08）。購入済みの記録に「完全解析を見る」等の状態を出す。
  // 有効になるのは、この値が true かつ /api/public-config の appEnv が "preview" のときだけ（Production の表示は変えない）。
  // 閲覧 URL は押した時だけ POST /api/complete-status で発行し、同じタブで移動する（保存・送信しない）。
  var CA_COMPLETE_VIEW_OPEN = true;
  // 決済から戻った直後の状態確認の間隔（秒）。合計がおよそ60秒で止め、その後は手動の「もう一度確認する」に切り替える。
  var CA_RETURN_POLL_DELAYS = [2, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
  var CA_VIEW_TEXT = {
    preparing: '完全解析を準備しています',
    ready: '完全解析を見る',
    retry: 'もう一度確認する',
    suspended: '現在、完全解析を閲覧できません',
    revoked: 'この完全解析は利用できません',
  };
  // 旧 ¥1,000 購入の本人確認が済むまでの表示（¥3,000・¥2,000 を出さない）
  var CA_LEGACY_PENDING_TEXT = '既存の解析レポート購入を確認しています';

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
  // 完全解析を販売していない間（CA_COMPLETE_SALES_OPEN = false）は、完全解析の権利は存在しないため
  // completeAccess = false と確定できる。解析レポートの購入有無（analysisAccess）は呼び出し側が
  // /api/my-entitlements の結果から渡す。
  // 販売開始後は、完全解析の権利API（CA_COMPLETE_API_READY）の記録別応答が無い限り unknown にする。
  function realState(opts) {
    var o = opts || {};
    if (o.analysisKnown !== true) return makeState({ entitlementStatus: 'unknown', diagnosisSessionId: o.diagnosisSessionId });
    if (CA_COMPLETE_SALES_OPEN && !CA_COMPLETE_API_READY) return makeState({ entitlementStatus: 'unknown', diagnosisSessionId: o.diagnosisSessionId });
    return makeState({ entitlementStatus: 'ok', analysisAccess: o.analysisAccess === true, diagnosisSessionId: o.diagnosisSessionId });
  }

  // ---- mypage 右上の入口を出すか ----
  // 3つの場合を区別する：
  //   ・権利API未実装（CA_COMPLETE_API_READY = false）かつ有効な Preview 指定なし → 出さない
  //     （押しても解決できない「状態を確認」を利用者に見せない）
  //   ・Preview fixture 指定あり（?preview_entitlement=free 等）→ fixture どおり出す
  //   ・権利API実装済み → 出す。通信・状態確認に失敗した時だけ unknown（「状態を確認」）になる
  // 旧仕様の互換（右上入口は mypage が記録の有無と購入状態だけで出す。2026-10-07）
  function headerEntryEnabled() {
    return true;
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
  // 完全解析の購入先。販売前（CA_COMPLETE_SALES_OPEN = false）は常に null（ダミーリンクにも接続しない）。
  function completeCheckoutHref() {
    return null;
  }
  // 「準備中」として見せる商品（適格で、権利を確認できた free／analysis のときだけ）。押せるボタンにはしない。
  function pendingOfferFor(state) {
    return state && state.completeEligible === true ? offerFor(state) : null;
  }
  // 準備中ボタン：<button disabled>。href・onclick・決済用の data 属性を持たせない。
  function pendingButtonHtml(offer, className) {
    if (!offer) return '';
    var label = offer.offer === 'upgrade_2000' ? '完全解析へアップグレード ' + offer.price + '（準備中）' : '完全解析 ' + offer.price + '（準備中）';
    return '<button type="button" class="' + (className || 'ca-btn') + ' is-pending" disabled aria-disabled="true" data-pending-offer="' + offer.offer + '">' + label + '</button>';
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

  function checkoutUrl() { return null; }

  // MENTOR 目標の選択を出してよいか（公開設定の appEnv === "preview" かつ CA_MENTOR_SELECT_OPEN）
  function mentorSelectEnabled() {
    var cfg = global.__ED_PUBLIC_CONFIG__;
    return CA_MENTOR_SELECT_OPEN === true && !!cfg && (cfg.appEnv === 'preview' || cfg.appEnv === 'production');
  }

  // 完全解析の閲覧を出してよいか（公開設定の appEnv === "preview" かつ CA_COMPLETE_VIEW_OPEN）
  function completeViewEnabled() {
    var cfg = global.__ED_PUBLIC_CONFIG__;
    return CA_COMPLETE_VIEW_OPEN === true && !!cfg && (cfg.appEnv === 'preview' || cfg.appEnv === 'production');
  }

  // 完全解析の閲覧の状態（記録ごと）。入力はサーバーの値だけ：
  //   entitlement：完全解析権の状態（'active'／'suspended'／'revoked'／null）
  //   reportStatus：生成物の状態（'queued'／'generating'／'ready'／'failed'／'revoked'／'none'）
  //   lookupFailed：状態を取得できなかった
  // 戻り値 kind：none（権利なし。目標選択・準備中の導線を維持）／preparing／ready／retry／suspended／revoked
  function completeViewStateFor(v) {
    var o = v || {};
    if (o.lookupFailed) return { kind: 'retry' };
    if (o.entitlement === 'revoked') return { kind: 'revoked' };
    if (o.entitlement === 'suspended') return { kind: 'suspended' };
    if (o.entitlement !== 'active') return { kind: 'none' };
    if (o.reportStatus === 'revoked') return { kind: 'revoked' };
    if (o.reportStatus === 'ready') return { kind: 'ready' };
    if (o.reportStatus === 'failed') return { kind: 'retry' };
    return { kind: 'preparing' }; // queued・generating・まだ生成物の行が無い
  }
  // /api/my-entitlements v2 の記録（records[id]）と completeLookup から
  function completeViewFromRecord(complete, lookup) {
    if (lookup === 'failed') return completeViewStateFor({ lookupFailed: true });
    if (lookup !== 'ok' || !complete || typeof complete !== 'object') return { kind: 'none' };
    return completeViewStateFor({ entitlement: complete.completeEntitlement, reportStatus: complete.completeStatus });
  }
  // GET /api/complete-status の応答（本文）から
  function completeViewFromStatus(body) {
    if (!body || typeof body !== 'object' || !body.entitlements) return completeViewStateFor({ lookupFailed: true });
    return completeViewStateFor({ entitlement: body.entitlements.complete, reportStatus: body.report ? body.report.status : 'none' });
  }

  // サーバー（/api/my-entitlements v2 の records）の状態から、完全解析の導線を決める。
  //   unknown：状態を確認できない／purchased：完全解析権あり／closed：再購入不可（返金・失効・一時停止など）
  //   ineligible：販売対象外／checkout_in_progress：決済手続き中／legacy_pending：旧 ¥1,000 購入の確認中
  //   offer：direct（¥3,000）または upgrade（¥2,000。根拠は固定済みの旧購入権か記録単位の解析権だけ）
  function completeOfferFor(complete, lookup) {
    if (lookup !== 'ok' || !complete || typeof complete !== 'object') return { kind: 'unknown' };
    if (complete.completeEntitlement === 'active') return { kind: 'purchased' };
    if (complete.repurchaseBlocked) return { kind: 'closed' };
    if (complete.completeEligible !== true) return { kind: 'ineligible', reason: complete.ineligibleReason || null };
    if (complete.checkoutInProgress) return { kind: 'checkout_in_progress' };
    if (complete.legacyPurchasePending) return { kind: 'legacy_pending' };
    if (complete.analysisSource === 'legacy_purchase_entitlement' || complete.analysisSource === 'record_entitlement') {
      return { kind: 'offer', offer: CA_OFFERS.upgrade };
    }
    return { kind: 'offer', offer: CA_OFFERS.direct };
  }

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
    headerEntryEnabled: headerEntryEnabled,
    completeEligibility: completeEligibility,
    withEligibility: withEligibility,
    completeCheckoutHref: completeCheckoutHref,
    pendingOfferFor: pendingOfferFor,
    pendingButtonHtml: pendingButtonHtml,
    completeSalesOpen: CA_COMPLETE_SALES_OPEN,
    isPreviewDummyCheckout: false,
    mentorSelectEnabled: mentorSelectEnabled,
    completeOfferFor: completeOfferFor,
    LEGACY_PENDING_TEXT: CA_LEGACY_PENDING_TEXT,
    completeViewEnabled: completeViewEnabled,
    completeViewStateFor: completeViewStateFor,
    completeViewFromRecord: completeViewFromRecord,
    completeViewFromStatus: completeViewFromStatus,
    VIEW_TEXT: CA_VIEW_TEXT,
    RETURN_POLL_DELAYS: CA_RETURN_POLL_DELAYS.slice(),
  };
})(typeof window !== 'undefined' ? window : globalThis);
