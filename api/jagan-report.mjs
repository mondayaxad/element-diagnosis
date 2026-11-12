// api/jagan-report.mjs — 邪眼診断のレポート。
//   POST ?op=buy | link-open | link-register | open … 邪眼解析レポートの購入・固有リンク・マイページへの登録・閲覧（lib/jagan-purchase.mjs）
//   GET（op なし）                                  … 以前の閲覧の確認（lib/jagan-api.mjs の createReportHandler）
//   Vercel の関数を増やさないため、購入の処理もこの関数で受ける。
import { createRequire } from 'node:module';
import { createReportHandler } from '../lib/jagan-api.mjs';
import { createPurchaseHandler } from '../lib/jagan-purchase.mjs';

const require = createRequire(import.meta.url);
const report = createReportHandler({ env: process.env });
const purchase = createPurchaseHandler({
  env: process.env,
  fetchImpl: (...args) => fetch(...args),
  // Stripe SDK は要求の時に初めて読み込む
  stripeFactory: (key) => require('stripe')(key, { maxNetworkRetries: 1, timeout: 10000 }),
});

export default async function handler(req, res) {
  let op = null;
  try { op = new URL(req.url || '/', 'http://x').searchParams.get('op'); } catch { op = null; }
  if (op !== null) return purchase(req, res, /^[a-z-]{2,32}$/.test(op) ? op : '');
  return report(req, res);
}
