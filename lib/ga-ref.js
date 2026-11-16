// lib/ga-ref.js — 申込の時点の GA4 の参照（Stripe Checkout の client_reference_id に入れる）。
//   形：ga1-<client_id の前半>-<client_id の後半>-<session_id>-<内部 0/1>-<申込元 source>
//   ブラウザ（js/ga.js の EdAnalytics.checkoutRef）が作り、サーバーは形だけを確かめて Stripe へ渡す。
//   Webhook は支払いの確定時に読み、サーバーから送る purchase を、同じ利用者・同じセッションに結ぶ（流入元・申込元が分かる）。
//   GA4 の識別子は Cookie の匿名の値で、氏名・メールなど個人を特定する情報は含まない。決済・権利の判定には使わない。
'use strict';
const RE = /^ga1-(\d{1,20})-(\d{1,20})-(\d{0,20})-([01])-([a-z_]{0,32})$/;
function valid(ref) { return typeof ref === 'string' && ref.length <= 120 && RE.test(ref); }
function parse(ref) {
  const m = typeof ref === 'string' ? RE.exec(ref) : null;
  if (!m) return null;
  return { clientId: `${m[1]}.${m[2]}`, sessionId: m[3] ? Number(m[3]) : null, internal: m[4] === '1', source: m[5] || null };
}
module.exports = { valid, parse };
