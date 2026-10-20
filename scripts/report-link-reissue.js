#!/usr/bin/env node
// レポート固有リンクの再発行（運営者の手元で実行する。DB・Stripe・外部へは接続しない）。
//   使い方: node scripts/report-link-reissue.js <report_deliveries.id>
//   1. 新しい秘密値（32バイト・base64url 43文字）を作り、SHA-256（16進64文字）を計算する。
//   2. SQL Editor で実行する1行（complete_admin_reissue_delivery）を表示する。DB には秘密値そのものは入れない（ハッシュだけ）。
//   3. 秘密値から作ったリンク（/report-link#t=…）を、お支払いを確かめた購入者にだけ伝える。古いリンクは開けなくなる。
//   秘密値はこの画面にだけ出る。ファイル・チャット・チケットに残さないこと（購入者への返信にだけ貼る）。
'use strict';
const crypto = require('crypto');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORIGIN = process.env.REPORT_LINK_ORIGIN || 'https://element-diagnosis-five.vercel.app';

function issue() {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  return { token, hash };
}

function main(argv) {
  const id = argv[2];
  if (!id || !UUID_RE.test(id)) {
    process.stderr.write('使い方: node scripts/report-link-reissue.js <report_deliveries.id（UUID）>\n');
    return 2;
  }
  const { token, hash } = issue();
  process.stdout.write([
    '-- SQL Editor（Preview / 本番の該当プロジェクト）で実行する。結果が reissued なら完了（not_found は ID の誤り）',
    `select public.complete_admin_reissue_delivery('${id.toLowerCase()}', '${hash}');`,
    '',
    '購入者に伝えるリンク（この画面にだけ表示。保存しない）:',
    `${ORIGIN}/report-link#t=${token}`,
    '',
  ].join('\n'));
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv);
module.exports = { issue, main };
