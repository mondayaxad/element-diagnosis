// api/verify.js（リリースC版）
// Stripe決済完了後、このエンドポイントにリダイレクトされる。
// セッションを検証し、支払い済みであれば署名付きトークンを発行してレポートページへ転送する。
//
// リリースCでの変更点（本番版との差分は release_c_verify_diff.patch を参照）：
//   1. line_itemsをexpandし、購入されたPrice IDから商品種別を判定する
//   2. 商品ごとの期待金額・通貨とStripeの実際の値を突合する
//   3. purchase_entitlementsへ記録する。既存行があれば内容を変更せずそのまま
//      再利用し（statusを含め上書きしない）、無ければ新規INSERTする
//      （リロード等の再アクセスで重複行が増えることはなく、将来status運用が
//        始まった際に無効化済みの行を誤って復活させることもない）
//   4. entitlementsの記録・取得に失敗した場合はトークンを発行しない
//   5. 発行するトークンへ、GA4計測専用のpurchaseブロックを追加する
//      （このブロックは閲覧権限の判定には使わない。/api/report-data.js側を参照）
//   6. 新形式トークンには診断コードを平文で含めない。AES-256-GCMで暗号化した
//      値（enc）だけを含める。署名（HMAC）はペイロードの改ざん検知はできても
//      内容を隠すものではない（base64urlは暗号化ではない）ため、これまでは
//      URLのtokenパラメータをbase64url decodeするだけで誰でも診断コードを
//      読み取れてしまっていた
//   7. SUPABASE_URLを固定値ではなく環境変数から取得する。Preview環境では
//      テスト用Supabaseプロジェクトを、本番では既存の本番Supabaseプロジェクトを
//      指すよう、Vercelの環境変数をEnvironmentごとに分けて設定する
//      （設定手順は release_c_supabase_env_setup.md を参照）。未設定の場合は
//      500エラーを返す（誤った接続先で動作し続けることを防ぐため）
//
//   8. 環境ガード（lib/server-env.js）を、Stripe・Supabase へ接続する前に通す。
//      Preview は Preview の Supabase と Stripe Test、Production は本番の Supabase と Stripe Live だけを認め、
//      取り違え・設定不足のときは 503 で止める（別の接続先へ切り替えて続けることはしない）。
//      Live／Test の判定は STRIPE_MODE とキーの接頭辞（sk_／rk_ の両方）で行う
//      （以前は sk_live_ だけを見ていたため、rk_live_ を Test と誤判定していた）。
//   9. 発行するトークンに環境名（env）を入れる。REPORT_TOKEN_SECRET は環境ごとに別の値にする前提で、
//      万一同じ値でも、別環境のトークンを report-data.js が受け付けない。
//  10. ログに Session ID 全文・Supabase の応答本文を出さない（末尾だけ）。
//
// 署名生成・TTL・リダイレクトの中核ロジックは本番版から変更していない。

const crypto = require('crypto');
const { requireServerEnv, requestHost, logEnvDenied, tail } = require('../lib/server-env');

const TOKEN_TTL_MS = 100 * 365 * 24 * 60 * 60 * 1000; // 実質無期限（100年）

// Supabaseプロジェクト自体のURLは秘密情報ではない（anon keyと同様、公開されているものと同じ）。
// サーバー用キー（SUPABASE_SECRET_KEY／SUPABASE_SERVICE_ROLE_KEY）は環境変数のみで扱い、コードに直書きしない。
// Supabase への通信はすべて管理者アクセス（ヘッダーは lib/server-env.js がキーの形式に合わせて作る）。
// 接続先（SUPABASE_URL）は、リクエストごとに環境ガードで検査してから使う。

// 【要設定・現時点ではプレースホルダ】
// Stripe Price ID → 商品種別（purchase_entitlements.product_typeの値）の対応表。
// StripeはLive/Testでモードが完全に分離されており、Price IDも別物になる。
// 環境ガードが確認した Stripe のモード（production＝live、preview＝test）で切り替える。
// 実際の値を埋める際にLive/Testを混在させないこと。
//
// 次の作業：
//   1. Stripeダッシュボード（本番／Liveモード）で、現行運用中のCORE1のPrice IDを確認し、
//      PRICE_ID_TO_PRODUCT_LIVE の core1 に設定する（CORE2・COMPLETE・追加購入は
//      Liveモードでまだ存在しない可能性が高い。存在しない商品の行は
//      プレースホルダのまま残してよい＝該当商品はLiveでは購入不可のままになる）
//   2. Stripeダッシュボード（テストモード）で、動作確認用にCORE1〜追加購入の
//      4つのPriceを作成し、PRICE_ID_TO_PRODUCT_TEST に設定する
// Stripeの秘密鍵そのものは、このコード・チャットのどちらにも直書き・貼付しないこと。
const PRICE_ID_TO_PRODUCT_LIVE = {
  'price_1TxZzE0IX2Svp0V3tAdVRTPJ': 'core1', // 確認済み：既存の¥1,000・JPY決済リンクに対応
  'price_REPLACE_ME_CORE2_LIVE': 'core2',
  'price_REPLACE_ME_COMPLETE_LIVE': 'complete',
  'price_REPLACE_ME_CORE2_UPGRADE_LIVE': 'core2_upgrade',
};

const PRICE_ID_TO_PRODUCT_TEST = {
  'price_1UINCK0IX2Svp0V39HaCB7WJ': 'core1',
  'price_REPLACE_ME_CORE2_TEST': 'core2',
  'price_REPLACE_ME_COMPLETE_TEST': 'complete',
  'price_REPLACE_ME_CORE2_UPGRADE_TEST': 'core2_upgrade',
};

function priceMapFor(stripeMode) {
  return stripeMode === 'live' ? PRICE_ID_TO_PRODUCT_LIVE : PRICE_ID_TO_PRODUCT_TEST;
}

// Checkout Session ID の接頭辞（Live は cs_live_、Test は cs_test_）が、環境の Stripe モードと一致するか。
function sessionIdMatchesMode(sessionId, stripeMode) {
  return typeof sessionId === 'string' && sessionId.startsWith(stripeMode === 'live' ? 'cs_live_' : 'cs_test_');
}

// 商品ごとの期待金額（円）・通貨。Price ID取り違え等の設定ミスを検知するための照合用。
// クライアント改ざんへの対策ではない（Stripeから直接取得した値と比較するため）。
const PRODUCT_EXPECTED = {
  core1: { amount: 1000, currency: 'jpy' },
  core2: { amount: 2000, currency: 'jpy' },
  complete: { amount: 2500, currency: 'jpy' },
  core2_upgrade: { amount: 1500, currency: 'jpy' },
};

function signToken(secret, payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

// diagnosis-save.js / report-data.js と同じ考え方：
// 診断コードそのものではなく、一方向のSHA-256ハッシュだけをDBに記録する。
function hashDiagnosisCode(diagnosisCode) {
  return crypto.createHash('sha256').update(diagnosisCode).digest('hex');
}

// Stripeのclient_reference_idで世代を明示する。
// legacy-v1は従来どおり診断コードのみ、ETI v2は `v2_<診断コード>` とする。
// DBには従来どおりハッシュだけを保存するため、既存スキーマを変更せず世代を分離できる。
function parseDiagnosisReference(reference) {
  if (typeof reference !== 'string' || !reference) return null;
  if (reference.startsWith('v2_')) {
    const code = reference.slice(3);
    return code ? { reference, code, diagnosisVersion: 'ETI-2.0' } : null;
  }
  return { reference, code: reference, diagnosisVersion: 'element-v1' };
}

// ------------------------------------------------------------
// 新形式トークンの診断コード暗号化（リリースC追加）
// ------------------------------------------------------------
// 署名（HMAC）はペイロードの改ざん検知はできても、内容を隠すものではない。
// base64urlはエンコードであって暗号化ではないため、署名付きトークンであっても
// これまではpayload内のcodeがそのまま誰でも読める状態だった。
// 新形式トークン（purchaseブロックを持つ、＝リリースC以降に発行するもの）では、
// codeを平文でペイロードに含めず、AES-256-GCMで暗号化した値だけを含める。
// 復号できるのはREPORT_TOKEN_SECRETを知っているサーバー（/api/report-data.js）だけ。
//
// 暗号鍵は、署名用のSECRETと同じ鍵を暗号化にも使い回さないよう、
// HKDFで別用途の鍵として導出する（/api/report-data.js側も同じ導出を行う。
// 導出元のSECRETが一致していれば、鍵を新たに追加で管理する必要はない）。
function deriveCodeEncryptionKey(secret) {
  return Buffer.from(
    crypto.hkdfSync('sha256', secret, Buffer.alloc(0), 'report-token-code-encryption-v1', 32)
  );
}

function encryptDiagnosisCode(secret, diagnosisCode) {
  const key = deriveCodeEncryptionKey(secret);
  const iv = crypto.randomBytes(12); // AES-GCMの推奨IV長
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(diagnosisCode, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    data: encrypted.toString('base64url'),
  };
}

function createHandler({ env, fetchImpl, stripeFactory }) {
  const stripeClients = new Map();
  function stripeFor(key) {
    if (!stripeClients.has(key)) stripeClients.set(key, stripeFactory(key));
    return stripeClients.get(key);
  }

  // service roleキーでpurchase_entitlementsを検索する（既存行の再利用のため）。
  async function findExistingEntitlement(conn, sessionId) {
    const url =
      `${conn.supabaseUrl}/rest/v1/purchase_entitlements` +
      `?stripe_checkout_session_id=eq.${encodeURIComponent(sessionId)}&select=*`;
    const res = await fetchImpl(url, { headers: conn.adminHeaders() });
    if (!res.ok) {
      // 応答本文には行の値が含まれ得るため、ログ・例外へはステータスだけを残す。
      throw new Error(`purchase_entitlements lookup failed: ${res.status}`);
    }
    const rows = await res.json();
    return rows[0] || null;
  }

  // service roleキーでpurchase_entitlementsへ新規INSERTする（upsertではない）。
  // 既存行がある場合は絶対に上書きしない設計にするため、通常のINSERTのみを行い、
  // 一意制約違反（同時アクセスによる競合）はconflict:trueとして呼び出し元へ伝える。
  async function insertEntitlement(conn, row) {
    const url = `${conn.supabaseUrl}/rest/v1/purchase_entitlements`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        ...conn.adminHeaders(),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify([row]),
    });

    if (res.status === 409) {
      // stripe_checkout_session_id のUNIQUE制約違反。
      // ほぼ同時に2回リクエストが来た場合など。呼び出し元が既存行を再取得する。
      return { conflict: true };
    }
    if (!res.ok) {
      throw new Error(`purchase_entitlements insert failed: ${res.status}`);
    }
    const rows = await res.json();
    return { conflict: false, row: rows[0] };
  }

  // 既存行があればそれをそのまま再利用し（statusを含めて一切変更しない）、
  // 無ければ新規にINSERTする。将来status運用（返金・取消時の無効化等）が始まった際、
  // 無効化済みの行を「決済URLへの再アクセス」だけで active に戻してしまわないための設計。
  async function getOrCreateEntitlement(conn, { diagnosisCodeHash, sessionId, paymentIntentId, productType, amount, currency }) {
    const existing = await findExistingEntitlement(conn, sessionId);
    if (existing) {
      return existing;
    }

    const insertResult = await insertEntitlement(conn, {
      diagnosis_code_hash: diagnosisCodeHash,
      stripe_checkout_session_id: sessionId,
      stripe_payment_intent_id: paymentIntentId,
      product_type: productType,
      amount: amount,
      currency: currency,
      status: 'active',
    });

    if (!insertResult.conflict) {
      return insertResult.row;
    }

    // 競合：ほぼ同時に別のリクエストが先にINSERTした。その行を再取得して使う。
    const afterConflict = await findExistingEntitlement(conn, sessionId);
    if (!afterConflict) {
      throw new Error('entitlement insert conflicted but no existing row found on re-fetch');
    }
    return afterConflict;
  }

  return async function handler(req, res) {
    try {
      // 環境ガード：Stripe・Supabase へ接続する前に、環境・接続先・Stripe モード・署名鍵を確かめる。
      const guard = requireServerEnv(env, {
        host: requestHost(req),
        admin: true,
        stripe: true,
        reportSecret: true,
      });
      if (!guard.ok) {
        const incidentId = logEnvDenied('verify', guard);
        res.status(503).send(`現在ご利用いただけません。時間をおいて再度お試しください。（照合ID: ${incidentId}）`);
        return;
      }
      const { stripeMode, appEnv } = guard;
      const secret = env.REPORT_TOKEN_SECRET;

      const sessionId = (req.query || {}).session_id;
      if (!sessionId) {
        res.status(400).send('決済セッションが見つかりません。');
        return;
      }

      // Preview（Test）で Live の Session、本番（Live）で Test の Session を受け付けない。
      if (!sessionIdMatchesMode(sessionId, stripeMode)) {
        console.error('verify error: checkout session mode mismatch', { env: appEnv, stripeMode, session: tail(sessionId) });
        res.status(400).send('決済セッションが見つかりません。');
        return;
      }

      // Stripeにセッションを問い合わせ、実際に支払われたか確認する。
      // line_itemsをexpandし、購入されたPrice IDを取得する（リリースCで追加）。
      const session = await stripeFor(env.STRIPE_SECRET_KEY).checkout.sessions.retrieve(sessionId, {
        expand: ['line_items'],
      });

      // Stripe 側の livemode も環境のモードと一致することを確かめる（キーの取り違えの二重確認）。
      if (typeof session.livemode === 'boolean' && session.livemode !== (stripeMode === 'live')) {
        console.error('verify error: stripe livemode mismatch', { env: appEnv, stripeMode, session: tail(sessionId) });
        res.status(503).send('現在ご利用いただけません。時間をおいて再度お試しください。');
        return;
      }

      if (session.payment_status !== 'paid') {
        res.status(402).send('お支払いが確認できませんでした。');
        return;
      }

      const diagnosisRef = parseDiagnosisReference(session.client_reference_id);
      if (!diagnosisRef) {
        res.status(400).send('診断コードが見つかりません。お手数ですが、診断結果画面からやり直してください。');
        return;
      }

      // 商品判定：現行のPayment Link構成は1決済1商品を前提にしているため、
      // line_itemsが1件であることを確認する。
      const items = (session.line_items && session.line_items.data) || [];
      if (items.length !== 1) {
        console.error('verify error: unexpected line item count', items.length, tail(sessionId));
        res.status(500).send('商品情報を確認できませんでした。時間をおいて再度お試しください。');
        return;
      }

      const priceId = items[0].price && items[0].price.id;
      const productType = priceMapFor(stripeMode)[priceId];
      if (!productType) {
        console.error('verify error: unmapped price id', priceId, tail(sessionId));
        res.status(500).send('商品情報を確認できませんでした。時間をおいて再度お試しください。');
        return;
      }

      // 金額・通貨の期待値との突合（設定ミスの早期検知が目的。
      // Stripeから直接取得した値なのでクライアント改ざんの余地はない）
      const expected = PRODUCT_EXPECTED[productType];
      const actualCurrency = (session.currency || '').toLowerCase();
      if (session.amount_total !== expected.amount || actualCurrency !== expected.currency) {
        console.error('verify error: amount/currency mismatch', {
          productType,
          expectedAmount: expected.amount,
          actualAmount: session.amount_total,
          expectedCurrency: expected.currency,
          actualCurrency,
          session: tail(sessionId),
        });
        res.status(500).send('お支払い金額を確認できませんでした。時間をおいて再度お試しください。');
        return;
      }

      // 権限は「世代を含む参照値」に紐づける。v1とv2で同じ文字列のコードが
      // 偶然生成されても、購入権限が相互流用されない。
      const diagnosisCodeHash = hashDiagnosisCode(diagnosisRef.reference);

      const paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : (session.payment_intent && session.payment_intent.id) || null;

      let entitlementRow;
      try {
        entitlementRow = await getOrCreateEntitlement(guard, {
          diagnosisCodeHash,
          sessionId,
          paymentIntentId,
          productType,
          amount: session.amount_total,
          currency: actualCurrency,
        });
      } catch (err) {
        // entitlementsの記録・取得に失敗した場合はトークンを発行しない
        console.error('verify error: entitlement get-or-create failed', err && err.message, tail(sessionId));
        res.status(500).send('購入情報の記録に失敗しました。お手数ですがサポートまでご連絡ください。');
        return;
      }

      // GA4計測専用のpurchaseブロック。閲覧権限の判定には使わない
      // （権限判定は/api/report-data.js側でpurchase_entitlementsを直接見て行う）。
      const transactionId = crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 16);
      const purchaseBlock = {
        transaction_id: transactionId,
        product_id: entitlementRow.product_type,
        value: entitlementRow.amount,
        currency: entitlementRow.currency,
        diagnosis_version: diagnosisRef.diagnosisVersion,
      };

      // 署名付きトークンを発行（有効期限＋purchaseブロック＋暗号化した診断コードを含む）。
      // 新形式トークンには診断コードを平文で含めない（enc）。復号できるのは
      // REPORT_TOKEN_SECRETを持つサーバー（/api/report-data.js）だけ。
      // env：発行した環境。report-data.js は別環境のトークンを受け付けない。
      const token = signToken(secret, {
        exp: Date.now() + TOKEN_TTL_MS,
        env: appEnv,
        diagnosis_version: diagnosisRef.diagnosisVersion,
        purchase: purchaseBlock,
        // 暗号化対象も世代付き参照値。report-data.js側で復号後に世代とコードを分離する。
        enc: encryptDiagnosisCode(secret, diagnosisRef.reference),
      });

      // レポート表示ページへリダイレクト
      res.writeHead(302, { Location: `/report.html?token=${encodeURIComponent(token)}` });
      res.end();
    } catch (err) {
      console.error('verify error:', err && err.name ? err.name : 'unknown', err && err.type ? err.type : '');
      res.status(500).send('エラーが発生しました。時間をおいて再度お試しください。');
    }
  };
}

// Stripe SDK はリクエスト時に初めて読み込む（テストでは偽の stripeFactory を渡す）。
module.exports = createHandler({
  env: process.env,
  fetchImpl: (...args) => fetch(...args),
  stripeFactory: (key) => require('stripe')(key),
});
module.exports.createHandler = createHandler;
module.exports.priceMapFor = priceMapFor;
