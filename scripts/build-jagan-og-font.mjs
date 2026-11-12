#!/usr/bin/env node
// 邪眼診断（DTI）の共有カード（api/jagan-og.mjs）用フォントを、使う文字だけに絞って同梱モジュールにする。
//   見出し：Noto Serif JP 700／補助情報：Noto Sans JP 500（SIL Open Font License 1.1。Google Fonts）
//   収録文字：DTI の84呼び名・コード、邪眼元素・異相の名前、人物名、カードの固定文言、数字、英大文字。
//   名前やカードの文言を変えたら、作り直してコミットする（足りない文字は描かれない）。
//   実行: node scripts/build-jagan-og-font.mjs        → api/_jagan-og-font.mjs を書き出す
//         node scripts/build-jagan-og-font.mjs --chars → 収録する文字だけを表示する
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLE } from '../jagan/engine/data.mjs';
import { OG_FIXED_TEXT } from '../lib/jagan-og-params.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'api/_jagan-og-font.mjs');
const UA = 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Safari/534.30'; // WOFF を返させる

export function ogChars() {
  const parts = [
    ...BUNDLE.dti.patterns.flatMap((p) => [p.code, p.name, p.element, p.aspect]),
    ...BUNDLE.characters.characters.map((c) => c.name),
    ...OG_FIXED_TEXT,
    '0123456789%ABCDEFGHIJKLMNOPQRSTUVWXYZ ×｜：／—・。、',
  ];
  return [...new Set(parts.join(''))].sort().join('');
}

async function fetchFont(family, weight, text) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&text=${encodeURIComponent(text)}`, { headers: { 'User-Agent': UA } })).text();
  const url = (css.match(/src:\s*url\(([^)]+)\)\s*format\('woff'\)/) || [])[1];
  if (!url) throw new Error(`no woff for ${family}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const chars = ogChars();
  if (process.argv.includes('--chars')) { console.log(chars.length, chars); process.exit(0); }
  const serif = await fetchFont('Noto+Serif+JP', 700, chars);
  const sans = await fetchFont('Noto+Sans+JP', 500, chars);
  fs.writeFileSync(OUT, '// 生成物：scripts/build-jagan-og-font.mjs が作る。手で編集しない。\n' +
    '// Noto Serif JP 700・Noto Sans JP 500 の部分集合（WOFF・base64）。SIL Open Font License 1.1。\n' +
    `export const JAGAN_OG_CHARS = ${JSON.stringify(chars)};\n` +
    `export const JAGAN_OG_SERIF_WOFF_BASE64 = '${serif.toString('base64')}';\n` +
    `export const JAGAN_OG_SANS_WOFF_BASE64 = '${sans.toString('base64')}';\n`);
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${chars.length} chars, serif ${serif.length} B, sans ${sans.length} B`);
}
