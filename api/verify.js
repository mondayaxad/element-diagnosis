// api/verify.js
// Stripe決済完了後、このエンドポイントにリダイレクトされる。
// セッションを検証し、支払い済みであれば署名付きトークンを発行してレポートページへ転送する。

const Stripe = require('stripe');
const crypto = require('crypto');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const SECRET = process.env.REPORT_TOKEN_SECRET;
const TOKEN_TTL_MS = 100 * 365 * 24 * 60 * 60 * 1000; // 実質無期限（100年）

function signToken(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

module.exports = async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) {
      res.status(400).send('決済セッションが見つかりません。');
      return;
    }

    // Stripeにセッションを問い合わせ、実際に支払われたか確認する
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      res.status(402).send('お支払いが確認できませんでした。');
      return;
    }

    const diagnosisCode = session.client_reference_id;
    if (!diagnosisCode) {
      res.status(400).send('診断コードが見つかりません。お手数ですが、診断結果画面からやり直してください。');
      return;
    }

    // 署名付きトークンを発行（診断コード＋有効期限を含む）
    const token = signToken({
      code: diagnosisCode,
      exp: Date.now() + TOKEN_TTL_MS,
    });

    // レポート表示ページへリダイレクト
    res.writeHead(302, { Location: `/report.html?token=${encodeURIComponent(token)}` });
    res.end();
  } catch (err) {
    console.error('verify error:', err);
    res.status(500).send('エラーが発生しました。時間をおいて再度お試しください。');
  }
};
