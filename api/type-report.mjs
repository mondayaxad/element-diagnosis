// api/type-report.mjs — 元素診断のタイプ別レポート（¥1,000・35タイプ共通の読み物）。
//   POST ?op=buy | link-open … 購入・固有リンクの閲覧（lib/type-report-purchase.mjs）
import { createRequire } from 'node:module';
import { createPurchaseHandler } from '../lib/type-report-purchase.mjs';

const require = createRequire(import.meta.url);
const purchase = createPurchaseHandler({
  env: process.env,
  fetchImpl: (...args) => fetch(...args),
  // Stripe SDK は要求の時に初めて読み込む
  stripeFactory: (key) => require('stripe')(key, { maxNetworkRetries: 1, timeout: 10000 }),
});

export default async function handler(req, res) {
  let op = null;
  try { op = new URL(req.url || '/', 'http://x').searchParams.get('op'); } catch { op = null; }
  return purchase(req, res, /^[a-z-]{2,32}$/.test(op || '') ? op : '');
}
