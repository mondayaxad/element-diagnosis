#!/usr/bin/env node
// 解析レポートのサンプル（report_sample.html）を、実際の解析レポート（report.html）から作る。
//   ・描画は report.html と同じコード（最新版 ETI v2 の解析レポート）。ダミーの回答（固定）で描く。通信・購入の確認はしない。
//   ・最上部にサンプルの帯、完全解析の欄はサンプル用（三つの人物像の図と申込：js/sample-buy.js）、最下部に申込の欄。
//   ・report.html を直したら、このスクリプトを実行して report_sample.html を作り直す（tests/report_sample_sync.test.js が差を検出する）。
//   実行: node scripts/build-report-sample.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// ダミーの回答（100問を固定の規則で並べたもの。水 × 片手剣 × フォンテーヌ）
const SAMPLE_CODE = '30fm9zj1kjiedagvbgw0e991pmj8wfx6z6179pzkb9d3c';

function cut(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error('marker not found: ' + startMarker);
  return [a, b + endMarker.length];
}
function replaceOnce(src, from, to) {
  const i = src.indexOf(from);
  if (i < 0 || src.indexOf(from, i + from.length) >= 0) throw new Error('expected exactly one: ' + from.slice(0, 60));
  return src.slice(0, i) + to + src.slice(i + from.length);
}

function build() {
  let html = fs.readFileSync(path.join(ROOT, 'report.html'), 'utf8');

  // サンプルであることを冒頭に示す
  html = replaceOnce(html, '<title>元素診断 解析レポート</title>',
    '<title>元素診断 解析レポート（サンプル）</title>\n<meta name="robots" content="noindex,nofollow">');
  html = replaceOnce(html, '<body>\n<div id="root">',
    '<body>\n<div style="background:linear-gradient(90deg,#5a4490,#8a5fc0);color:#fff;text-align:center;padding:12px 16px;font-size:13px;font-weight:700;letter-spacing:1px">\n'
    + '  📖 これはサンプルレポートです（実際にご購入いただくと、あなた自身の診断結果でこの内容が生成されます）\n</div>\n<div id="root">');
  html = replaceOnce(html, 'お支払い状況を確認しています…', 'サンプルを表示しています…');

  // 完全解析の欄：サンプル用（三つの人物像の図・申込は js/sample-buy.js が描く）
  html = replaceOnce(html, '      ${completeAnalysisReportHtml(pal, results, diagnosisVersion)}\n',
    `      <div class="sec beyond-sec" style="border-color:#c0a86055;--el:\${pal.p};background:radial-gradient(120% 80% at 50% 0%, \${pal.p}22 0%, transparent 60%),linear-gradient(160deg,\${pal.dark}38,#0b0915 70%)">
        <div class="eyebrow" style="color:#c0a860">BEYOND THE REPORT｜この先にあるもの</div>
        <div class="sec-title" style="color:#e8d8a0">まだ、ここには現れていない輪郭があります</div>
        <p class="desc">このレポートが描いたのは、いまのあなたの輪郭です。その奥には、まだ言葉になっていない一面と、これから借りられる力が眠っています。</p>
        <p class="desc">完全解析では、<strong style="color:#eef4ee">三つの人物像</strong>から、あなたをもう一段深く読みます。元素・武器・国家と20軸を横断し、組み合わせ、活かし方、過剰に働いたときのサインまでを、<strong style="color:#e8d8a0">全46ページ</strong>の記録に結びます。</p>
        <div data-sample-lens-map></div>
        <div class="beyond-cta" data-sample-complete-slot data-pdf-skip></div>
      </div>
`);
  // サンプルにはマイページへの登録の欄を置かない
  html = replaceOnce(html, '        <div data-report-register-slot data-pdf-skip></div>\n', '');

  // 読み込み：購入したレポートの確認（/api/report-data）の代わりに、ダミーの回答で描く
  const [a, b] = cut(html, '(async function init() {', '\n})();');
  html = html.slice(0, a) + `(function initSampleReport() {
  const root = document.getElementById('root');
  const code = '${SAMPLE_CODE}';
  const answers = ETIv2.decodeAnswersV2(code, ETI_V2_QUESTIONS);
  renderFullReport(root, computeResultsV2ForUI(answers, code), code);
})();` + html.slice(b);

  // 最下部の申込の欄（js/sample-buy.js）
  const sampleTail = fs.readFileSync(path.join(ROOT, 'scripts', 'report-sample-tail.html'), 'utf8');
  html = replaceOnce(html, '</body>', sampleTail + '</body>');
  return replaceOnce(html, '<head>\n', '<head>\n<!-- このファイルは scripts/build-report-sample.js が report.html から作る。直接編集しない -->\n');
}

if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'report_sample.html'), build());
  console.log('report_sample.html を作りました');
}
module.exports = { build, SAMPLE_CODE };
