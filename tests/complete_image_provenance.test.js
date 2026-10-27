// 完全解析 RC1 の画像20点の出所記録（docs/complete_analysis/IMAGE_PROVENANCE.json）と、実際の画像ファイルの対応を確かめる。
// 画像を差し替えると SHA-256 が一致せず失敗する：差し替えた画像の出所を確認して記録を更新すること（記録を自動では書き換えない）。
//   実行: node --test tests/complete_image_provenance.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const REC = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/complete_analysis/IMAGE_PROVENANCE.json'), 'utf8'));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');

test('出所記録：20点すべての SHA-256・バイト数が実際のファイル（生成器の素材と試作版の写し）と一致する', () => {
  assert.equal(REC.images.length, 20);
  for (const im of REC.images) {
    assert.equal(sha(im.file), im.sha256, im.file);
    assert.equal(fs.statSync(path.join(ROOT, im.file)).size, im.bytes, im.file);
    assert.equal(sha(im.prototype_copy), im.sha256, im.prototype_copy);
    assert.ok(im.used_on && im.subject, im.file);
  }
  assert.equal(new Set(REC.images.map((x) => x.sha256)).size, 20, '重複なし');
});

test('出所記録：生成器が使う画像はすべて記録にあり、記録外の画像は無い', () => {
  const dir = path.join(ROOT, 'api/_complete/rc1/assets');
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => /\.(jpe?g|png|webp|gif|svg)$/i.test(f))
    .map((f) => path.posix.join('api/_complete/rc1/assets', f.split(path.sep).join('/'))).sort();
  assert.deepEqual(files, REC.images.map((x) => x.file).sort());
});

test('出所記録：本人の申告（作成者・作成方法・入力素材）が記録されている', () => {
  const d = REC.declaration;
  assert.match(d.declared_by, /倉賀大介/);
  assert.match(d.text, /ChatGPT の画像生成/);
  assert.match(d.text, /文章プロンプトだけ/);
  assert.match(d.text, /原神公式画像・ロゴ・第三者画像・既存画像は入力素材として一切使用していません/);
  assert.match(d.declared_at, /^\d{4}-\d{2}-\d{2}$/);
});
