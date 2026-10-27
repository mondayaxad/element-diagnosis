// 解析レポートのサンプル（report_sample.html）が、実際の解析レポート（report.html）から作ったものと一致するか。
//   report.html を直した時は node scripts/build-report-sample.js で作り直す。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { build } = require('../scripts/build-report-sample');

test('report_sample.html は report.html から作った最新のもの（最新版 ETI v2 の解析レポート・エニアグラムの欄なし）', () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'report_sample.html'), 'utf8');
  assert.equal(file, build(), 'node scripts/build-report-sample.js を実行してください');
  assert.match(file, /initSampleReport/);
  assert.doesNotMatch(file, /\/api\/report-data/, 'サンプルは購入の確認をしない');
  assert.match(file, /data-sample-buy="analysis"/);
});
