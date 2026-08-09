// api/report-data.js
// フロントエンド（report.html）から呼ばれる。
// トークンの署名・有効期限を検証し、正しければ診断コードのみを返す。

const crypto = require('crypto');

const SECRET = process.env.REPORT_TOKEN_SECRET;

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

  // タイミング攻撃対策：定数時間比較
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }

  if (!data.exp || Date.now() > data.exp) return null; // 期限切れ
  return data;
};

module.exports = (req, res) => {
  const token = req.query.token;
  const data = verifyToken(token);

  if (!data) {
    res.status(403).json({ error: 'invalid_or_expired_token' });
    return;
  }

  res.status(200).json({ code: data.code });
};
