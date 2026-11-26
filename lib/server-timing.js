// lib/server-timing.js — 【測定用・本番には入れない】決済の API の所要時間の内訳を Server-Timing ヘッダーで返す。
//   db：Supabase（fetch）への問い合わせの合計時間と回数、stripe：Stripe SDK の呼び出しの合計時間と回数、
//   total：要求の受け付けから応答まで、cold：この関数のインスタンスで最初の要求か（コールドスタート）
'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const als = new AsyncLocalStorage();
let served = 0;

function timedFetch(...args) {
  const st = als.getStore();
  const t0 = Date.now();
  const p = fetch(...args);
  if (st) p.then(() => { st.db += Date.now() - t0; st.dbN += 1; }, () => { st.db += Date.now() - t0; st.dbN += 1; });
  return p;
}
// Stripe SDK のメソッド呼び出し（Promise を返すもの）の時間を数える
function timedStripe(stripe) {
  const wrap = (obj) => new Proxy(obj, {
    get(t, k) {
      const v = t[k];
      if (typeof v === 'function') {
        return function (...a) {
          const st = als.getStore(); const t0 = Date.now();
          const r = v.apply(t, a);
          if (st && r && typeof r.then === 'function') r.then(() => { st.stripe += Date.now() - t0; st.stripeN += 1; }, () => { st.stripe += Date.now() - t0; st.stripeN += 1; });
          return r;
        };
      }
      if (v && typeof v === 'object') return wrap(v);
      return v;
    },
  });
  return wrap(stripe);
}
function withTiming(handler) {
  return function timed(req, res) {
    const st = { t0: Date.now(), db: 0, dbN: 0, stripe: 0, stripeN: 0, cold: served++ === 0 };
    const end = res.end;
    res.end = function (...a) {
      try {
        if (!res.headersSent) res.setHeader('Server-Timing', [
          `total;dur=${Date.now() - st.t0}`, `db;dur=${st.db};desc="${st.dbN}"`, `stripe;dur=${st.stripe};desc="${st.stripeN}"`, `cold;desc="${st.cold ? 1 : 0}"`,
        ].join(', '));
      } catch (e) { /* 測定だけ */ }
      return end.apply(this, a);
    };
    return als.run(st, () => handler(req, res));
  };
}
module.exports = { timedFetch, timedStripe, withTiming };
