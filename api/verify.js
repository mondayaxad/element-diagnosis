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
// 署名生成・TTL・リダイレクトの中核ロジックは本番版から変更していない。

const Stripe = require('stripe');
const crypto = require('crypto');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const SECRET = process.env.REPORT_TOKEN_SECRET;
const TOKEN_TTL_MS = 100 * 365 * 24 * 60 * 60 * 1000; // 実質無期限（100年）

// Supabaseプロジェクト自体のURLは秘密情報ではない（anon keyと同様、公開されているものと同じ）。
// ただし SUPABASE_SERVICE_ROLE_KEY は環境変数のみで扱い、コードに直書きしない。
// Supabaseプロジェクト自体のURLは秘密情報ではない（anon keyと同様、公開されているものと同じ）が、
// Preview環境ではテスト用Supabaseプロジェクトへ向けたいため、固定値ではなく環境変数から取得する。
// 未設定の場合は、誤って本番Supabaseへ接続する・接続先が不明なまま動作することを防ぐため、
// リクエストごとに明示的にエラーとして扱う（後段の各処理内で判定する）。
const SUPABASE_URL = process.env.SUPABASE_URL;

// 【要設定・現時点ではプレースホルダ】
// Stripe Price ID → 商品種別（purchase_entitlements.product_typeの値）の対応表。
// StripeはLive/Testでモードが完全に分離されており、Price IDも別物になる。
// STRIPE_SECRET_KEYがsk_live_かsk_test_かで自動的に切り替える構成にしてあるので、
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
const IS_LIVE_MODE = (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_');

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

const PRICE_ID_TO_PRODUCT = IS_LIVE_MODE ? PRICE_ID_TO_PRODUCT_LIVE : PRICE_ID_TO_PRODUCT_TEST;

// 商品ごとの期待金額（円）・通貨。Price ID取り違え等の設定ミスを検知するための照合用。
// クライアント改ざんへの対策ではない（Stripeから直接取得した値と比較するため）。
const PRODUCT_EXPECTED = {
  core1: { amount: 1000, currency: 'jpy' },
  core2: { amount: 2000, currency: 'jpy' },
  complete: { amount: 2500, currency: 'jpy' },
  core2_upgrade: { amount: 1500, currency: 'jpy' },
};

function signToken(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
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
function deriveCodeEncryptionKey() {
  return Buffer.from(
    crypto.hkdfSync('sha256', SECRET, Buffer.alloc(0), 'report-token-code-encryption-v1', 32)
  );
}

function encryptDiagnosisCode(diagnosisCode) {
  const key = deriveCodeEncryptionKey();
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

// service roleキーでpurchase_entitlementsを検索する（既存行の再利用のため）。
async function findExistingEntitlement(sessionId) {
  const url =
    `${SUPABASE_URL}/rest/v1/purchase_entitlements` +
    `?stripe_checkout_session_id=eq.${encodeURIComponent(sessionId)}&select=*`;
  const res = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`purchase_entitlements lookup failed: ${res.status} ${body}`);
  }
  const rows = await res.json();
  return rows[0] || null;
}

// service roleキーでpurchase_entitlementsへ新規INSERTする（upsertではない）。
// 既存行がある場合は絶対に上書きしない設計にするため、通常のINSERTのみを行い、
// 一意制約違反（同時アクセスによる競合）はconflict:trueとして呼び出し元へ伝える。
async function insertEntitlement(row) {
  const url = `${SUPABASE_URL}/rest/v1/purchase_entitlements`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
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
    const body = await res.text().catch(() => '');
    throw new Error(`purchase_entitlements insert failed: ${res.status} ${body}`);
  }
  const rows = await res.json();
  return { conflict: false, row: rows[0] };
}

// 既存行があればそれをそのまま再利用し（statusを含めて一切変更しない）、
// 無ければ新規にINSERTする。将来status運用（返金・取消時の無効化等）が始まった際、
// 無効化済みの行を「決済URLへの再アクセス」だけで active に戻してしまわないための設計。
async function getOrCreateEntitlement({ diagnosisCodeHash, sessionId, paymentIntentId, productType, amount, currency }) {
  const existing = await findExistingEntitlement(sessionId);
  if (existing) {
    return existing;
  }

  const insertResult = await insertEntitlement({
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
  const afterConflict = await findExistingEntitlement(sessionId);
  if (!afterConflict) {
    throw new Error('entitlement insert conflicted but no existing row found on re-fetch');
  }
  return afterConflict;
}

module.exports = async (req, res) => {
  try {
    if (!SUPABASE_URL) {
      console.error('verify error: SUPABASE_URL is not set');
      res.status(500).send('サーバー設定エラーが発生しました。時間をおいて再度お試しください。');
      return;
    }

    const sessionId = req.query.session_id;
    if (!sessionId) {
      res.status(400).send('決済セッションが見つかりません。');
      return;
    }

    // Stripeにセッションを問い合わせ、実際に支払われたか確認する。
    // line_itemsをexpandし、購入されたPrice IDを取得する（リリースCで追加）。
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items'],
    });

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
      console.error('verify error: unexpected line item count', items.length, sessionId);
      res.status(500).send('商品情報を確認できませんでした。時間をおいて再度お試しください。');
      return;
    }

    const priceId = items[0].price && items[0].price.id;
    const productType = PRICE_ID_TO_PRODUCT[priceId];
    if (!productType) {
      console.error('verify error: unmapped price id', priceId, sessionId);
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
        sessionId,
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
      entitlementRow = await getOrCreateEntitlement({
        diagnosisCodeHash,
        sessionId,
        paymentIntentId,
        productType,
        amount: session.amount_total,
        currency: actualCurrency,
      });
    } catch (err) {
      // entitlementsの記録・取得に失敗した場合はトークンを発行しない
      console.error('verify error: entitlement get-or-create failed', err);
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
    const token = signToken({
      exp: Date.now() + TOKEN_TTL_MS,
      diagnosis_version: diagnosisRef.diagnosisVersion,
      purchase: purchaseBlock,
      // 暗号化対象も世代付き参照値。report-data.js側で復号後に世代とコードを分離する。
      enc: encryptDiagnosisCode(diagnosisRef.reference),
    });

    // レポート表示ページへリダイレクト
    res.writeHead(302, { Location: `/report.html?token=${encodeURIComponent(token)}` });
    res.end();
  } catch (err) {
    console.error('verify error:', err);
    res.status(500).send('エラーが発生しました。時間をおいて再度お試しください。');
  }
};
