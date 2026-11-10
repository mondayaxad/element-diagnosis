// 完了ページで答えた回答が、¥1,000・¥3,000 の申込で同じまま送られ、解析レポート・完全解析が同じ結果で表示されること（scripts/jagan-dipper-e2e.mjs）
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
test('完了ページの回答 → 申込（2商品）→ 解析レポート・完全解析（23ページ・最後にマイページ登録）', { timeout: 240000 }, () => {
  execFileSync('node', ['scripts/build-public.js'], { cwd: ROOT, stdio: 'ignore' });
  const shot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dp-')), 'keep.png');
  const o = JSON.parse(execFileSync('node', ['scripts/jagan-dipper-e2e.mjs', shot], { cwd: ROOT, encoding: 'utf8', timeout: 200000 }).trim().split('\n').pop());
  assert.deepEqual(o.errors, []);
  assert.deepEqual(o.buys.map((b) => [b.product, b.sameAnswers, b.sameId, b.n]), [['report', true, true, 50], ['complete', true, true, 50]]);
  assert.equal(o.resultCode, o.expect.code);
  assert.deepEqual(o.report, { dipper: true, register: true, hasCode: true });
  assert.deepEqual(o.dipper, { pages: 23, keep: true, register: true, lastIsKeep: 'dpKeep', hasCode: true });
});
