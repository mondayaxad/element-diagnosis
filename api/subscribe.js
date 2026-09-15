// api/subscribe.js
// メルマガ同意があった場合に、Kit（旧ConvertKit）へ購読者として登録する。
// KIT_API_KEYはVercelの環境変数にのみ置く。ブラウザ側には絶対に渡さない。

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'invalid_email' });
      return;
    }

    const kitRes = await fetch('https://api.kit.com/v4/subscribers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kit-Api-Key': process.env.KIT_API_KEY,
      },
      body: JSON.stringify({
        email_address: email,
        state: 'active', // 事前にチェックボックスで同意を取っているため単一オプトインで登録する
      }),
    });

    if (!kitRes.ok) {
      const errText = await kitRes.text();
      console.error('Kit subscribe error:', errText);
      res.status(502).json({ error: 'kit_error' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('subscribe error:', err);
    res.status(500).json({ error: 'server_error' });
  }
};
