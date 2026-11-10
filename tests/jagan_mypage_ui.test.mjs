// マイページ（元素診断と共通）に、邪眼診断の記録が同じ欄で並ぶこと（実物の mypage.html を、ログイン済みを模して開く）。
//   scripts/jagan-mypage-shot.mjs：supabase-js・/api/* は模擬。邪眼の記録は jagan/engine の計算で作った架空の回答（3件）。
//   ENT：購入済み（権利 active）にする記録の番号、SALES：販売中か。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
function run(env) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jgmp-')), 'shot');
  execFileSync('node', ['scripts/build-public.js'], { cwd: ROOT, stdio: 'ignore' });
  const text = execFileSync('node', ['scripts/jagan-mypage-shot.mjs', out], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 120000 });
  return JSON.parse(text.trim().split('\n').pop().replace(/ \[\]$/, ''));
}

test('邪眼の記録：RECORDS・INSIGHTS に数え、最新・記録章・これまで・右上に並ぶ。購入済みは覚醒の証と「読む」、未購入は ¥1,000 の申込', { timeout: 180000 }, () => {
  const i = run({ ENT: '1', SALES: '1' });
  assert.deepEqual(i.stats, ['RECORDS 03 残してきた自分', 'INSIGHTS 01 深く読み解いた自分']);
  assert.equal(i.trigger.trim(), 'アップグレード');
  assert.equal(i.recs, 3);
  assert.equal(i.badges, 3);
  assert.deepEqual(i.chips, ['2026.11.07', 'NEW', '邪眼診断']);
  // 最新（未購入）・記録章（3件）・これまで（3件）の証。購入済み（2件目）だけ覚醒後
  assert.equal(i.imgs.filter((s) => s.startsWith('awakened/')).length, 2);
  assert.equal(i.imgs.length, 7);
  assert.equal(i.read, 1);
  assert.equal(i.buy, 3, '解析レポート ¥1,000 は未購入の2件（最新とこれまで）＋もう1件');
  // 完全解析 ¥3,000：未購入の記録すべて（最新・これまで3件＝4）。どちらも未購入の記録は「その先を見る」の中
  assert.equal(i.buyComplete, 4);
  assert.equal(i.reveal, 3);
  assert.equal(i.overflowX, false);
  // 申込のボタンは赤黒（元素の青ではない）。これまでのあなたの印は「邪眼」
  assert.ok(i.ctaBg.every((b) => /linear-gradient/.test(b) && /28, 6, 12|74, 15, 31/.test(b)), JSON.stringify(i.ctaBg));
  assert.ok(i.recChips.every((c) => c.includes('邪眼')));
});

test('最新が購入済み：INSIGHT・覚醒の証・「邪眼解析レポートを読む」。販売前は申込のボタンを押せない（準備中）', { timeout: 180000 }, () => {
  const i = run({ ENT: '0', SALES: '0' });
  assert.deepEqual(i.chips, ['2026.11.07', 'NEW', 'INSIGHT', '邪眼診断']);
  assert.ok(i.imgs[0].startsWith('awakened/'));
  assert.equal(i.buy, 0, '販売前は申込を出さない');
  assert.ok(i.pending >= 2, '準備中のボタン');
  assert.equal(i.read, 2, '最新とこれまでの同じ記録');
});

test('完全解析：両方購入＝COMPLETE、片方だけ＝INSIGHT。完全解析だけ購入の記録は「完全解析を読む」と ¥1,000 の申込', { timeout: 180000 }, () => {
  const i = run({ ENT: '0', CENT: '0,1', SALES: '1' });
  assert.deepEqual(i.chips, ['2026.11.07', 'NEW', 'COMPLETE', '邪眼診断']);
  assert.ok(i.completeChip >= 2, '最新とこれまでの COMPLETE');
  assert.equal(i.readComplete, 3, '最新・これまで（2件）の「完全解析を読む」');
  assert.deepEqual(i.stats, ['RECORDS 03 残してきた自分', 'INSIGHTS 02 深く読み解いた自分']);
  assert.equal(i.buy, 2, '2件目（完全解析だけ）と3件目の解析レポート ¥1,000');
  assert.equal(i.buyComplete, 1, '3件目だけ ¥3,000');
});
