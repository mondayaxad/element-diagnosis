#!/usr/bin/env node
// 完全解析のサンプル（complete-sample.html）を作る。運営者の実際の診断結果（風 × 弓 × ナタ）から、本番と同じ生成器
//   （api/_complete/generate-report.js）で46ページのレポートを作り、元素・武器種・国家の辞典（P39〜P42）を除いた42ページを掲載する。
//   ・ページ番号・本文は本番のまま（P43〜P46 は番号を振り直さない）。診断コード・回答・識別子は HTML に出ない（生成器が検査する）。
//   ・目次と申込のボタンは、風元素の色（サンプルを見る人の元素に関係なく固定）。
//   ・末尾の申込欄（data-sample-buy）は js/sample-buy.js が描く。結果ページ・マイページから開いた時は、その記録を購入の対象にして、
//     申込欄の位置から表示する。
//   実行: node scripts/build-complete-sample.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = require('../api/_complete/generate-report');
const eng = require('../api/_complete/rc1/src/engine').loadEngine();
const F = require('../tests/fixtures/complete_report_F01.json').input;

const CODE = 'q8tfdsyv0j9w30o6ezwid4nhcl7zm2wsros01rod63eq6';   // 運営者の診断結果（共有されたもの）
const DIAGNOSED_AT = '2026-10-27T20:25:43+09:00';
const EXCLUDE = new Set(['39', '40', '41', '42']);                // 元素辞典・武器種辞典・国家辞典
const SITE = 'https://element-diagnosis-five.vercel.app';
const clone = (o) => JSON.parse(JSON.stringify(o));

function generate() {
  const answers = eng.E.decodeAnswersV2(CODE, eng.Q);
  const res = eng.E.computeResultsV2(answers, { questions: eng.Q, meta: eng.META, elementPrototypes: eng.EP, weaponPrototypes: eng.WP, nationPrototypes: eng.NP });
  const mir = eng.resolver.computeMirror(res, 'ETI-MIRROR-2.1.0');
  return G.generateCompleteReport({
    answers: clone(answers), encodedAnswers: eng.E.encodeAnswersV2(answers, eng.Q),
    savedScores: { personality: res.personality, style: res.style, values: res.values, valuesCentered: res.valuesCentered },
    savedRankings: { element: res.elementRanking, weapon: res.weaponRanking, nation: res.nationRanking },
    mirrorSnapshot: eng.resolver.buildMirrorSnapshot(mir), versions: clone(F.versions), mentorGoal: clone(F.mentorGoal), diagnosedAt: DIAGNOSED_AT,
  });
}

// 風元素の色（生成器の EL_PALETTE と同じ値）。目次・申込のボタンはこの色に固定
const WIND = { a: '#57b885', soft: '#98dcb8', deep: '#1f6a46', mid: '#2f8a5c', lt: '#c8f0dc' };
const SAMPLE_CSS = `
:root{--sm-a:${WIND.a};--sm-a-soft:${WIND.soft};--sm-line:rgba(87,184,133,.3);--sm-ink:#ebf6f0;--sm-body:#b4cfc1;--sm-mute:#86a899;
  --sm-serif:'Hiragino Mincho ProN','Yu Mincho','YuMincho','Noto Serif JP','Noto Serif CJK JP',serif}
.sample-intro,.sample-cta{width:min(210mm,calc(100% - 16px));margin:16px auto 0;padding:18px 22px;border:1px solid var(--sm-line);border-radius:6px;background:linear-gradient(160deg,#0c1d17,#07110d);color:var(--sm-body);font-family:var(--sm-serif)}
.sample-intro .sample-eyebrow{margin:0 0 6px;color:var(--sm-a-soft);font-size:10.5px;letter-spacing:.32em}
.sample-intro h1,.sample-cta h2{margin:0;color:var(--sm-ink);font-weight:600;font-size:clamp(17px,2.6vw,21px);line-height:1.5;letter-spacing:.1em}
.sample-facts{display:grid;gap:2px;margin:12px 0 14px;padding:8px 14px;border-left:1px solid color-mix(in srgb,var(--sm-a) 55%,transparent);background:rgba(87,184,133,.06)}
.sample-facts p{margin:0;color:var(--sm-body);font-size:12.5px;line-height:1.8;letter-spacing:.04em}
.sample-intro details{border:1px solid var(--sm-line);border-radius:6px;background:rgba(6,16,12,.55)}
.sample-intro summary{padding:10px 14px;font-size:13px;letter-spacing:.08em;color:var(--sm-ink);cursor:pointer}
.sample-intro ol{list-style:none;margin:0;padding:2px 0 8px;max-height:60vh;overflow-y:auto}
.sample-intro a{display:flex;gap:10px;padding:6px 14px;font-size:12.5px;line-height:1.7;color:var(--sm-body);text-decoration:none}
.sample-intro a:hover,.sample-intro a:focus{background:rgba(87,184,133,.12);color:var(--sm-ink)}
.sample-intro a span{color:var(--sm-a-soft);min-width:34px;font-family:var(--font-num);font-size:11px;letter-spacing:.08em}
.sample-intro li.skip{padding:6px 14px;font-size:11.5px;color:var(--sm-mute)}
.sample-intro a:focus-visible,.sample-cta a:focus-visible,.sample-intro summary:focus-visible{outline:2px solid var(--sm-a-soft);outline-offset:2px}
.sample-return-top{margin:12px 0 0}
.sample-return-top a{display:inline-flex;min-height:44px;align-items:center;justify-content:center;padding:8px 22px;border-radius:4px;border:1px solid transparent;background:linear-gradient(90deg,${WIND.deep},${WIND.mid});color:#fff;text-decoration:none;font-size:12.5px;letter-spacing:.14em;font-weight:500}
.sample-mark{position:absolute;z-index:5;top:2.2mm;right:8mm;color:rgba(190,230,208,.5);font-family:var(--font-num);font-size:6.8pt;line-height:1;letter-spacing:.26em;pointer-events:none}
.sample-cta{margin-top:0;margin-bottom:32px;padding:20px 22px 20px;text-align:center;scroll-margin-top:16px}
.sample-cta h2{font-size:clamp(15px,2.2vw,17px);font-weight:500;letter-spacing:.12em}
.sample-cta p{margin:6px auto 12px;max-width:38em;color:var(--sm-mute);font-size:12px;line-height:1.8;letter-spacing:.04em}
.sample-cta a{box-sizing:border-box;display:inline-flex;min-height:44px;align-items:center;justify-content:center;padding:8px 20px;border:1px solid color-mix(in srgb,var(--sm-a) 45%,transparent);border-radius:4px;background:transparent;color:var(--sm-a-soft);text-decoration:none;font-size:12.5px;letter-spacing:.14em}
.sample-cta .ed-sky-wrap{display:grid;gap:10px;justify-items:center;margin:14px 0 6px}
a.sample-return.ed-sky-btn{position:relative;overflow:hidden;display:flex;flex-direction:column;gap:3px;width:100%;max-width:440px;min-height:60px;padding:10px 16px;box-sizing:border-box;border:1px solid color-mix(in srgb,${WIND.a} 55%,#fff);border-radius:6px;
  background:linear-gradient(135deg,${WIND.deep} 0%,${WIND.mid} 55%,#3aa06f 100%);color:#f2fbf6;text-decoration:none;cursor:pointer;box-shadow:0 0 28px rgba(47,138,92,.3),0 10px 22px rgba(0,0,0,.4),inset 0 1px 0 rgba(220,255,236,.2)}
a.sample-return.ed-sky-btn::after{content:'';position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(235,255,245,.16) 48%,transparent 64%);transform:translateX(-120%);animation:sm-sheen 3.6s ease-in-out infinite}
a.sample-return.ed-sky-btn .ed-sky-main{font-size:14.5px;font-weight:600;letter-spacing:.12em;text-shadow:0 0 12px rgba(200,240,220,.4)}
a.sample-return.ed-sky-btn .ed-sky-sub{font-size:11.5px;letter-spacing:.1em;color:${WIND.lt};font-weight:400}
a.sample-return.ed-sky-btn[aria-disabled="true"]{opacity:.55;pointer-events:none}
a.sample-return.ed-sky-btn:hover{filter:brightness(1.1)}
.sample-cta .sample-mypage{margin:14px auto 0;font-size:11.5px}
.sample-cta .sample-mypage a{display:inline;min-height:0;padding:0;border:0;text-decoration:underline;letter-spacing:.04em}
.sample-cta .ca-guest-msg{color:#e8b4a0;font-size:12px;min-height:1.2em}
[data-buy][data-busy]{opacity:.6;pointer-events:none}
@keyframes sm-sheen{0%,40%{transform:translateX(-120%)}80%,100%{transform:translateX(120%)}}
@media (prefers-reduced-motion:reduce){a.sample-return.ed-sky-btn::after{animation:none}}
@media screen and (max-width:520px){.sample-intro,.sample-cta{padding:14px 14px}.sample-cta a.sample-return{width:100%}}
@media print{.sample-intro,.sample-cta,.sample-return-top{display:none}.sample-mark{color:rgba(40,55,70,.42)}}
`;

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data: https://*.google-analytics.com https://*.googletagmanager.com; font-src 'none'; script-src 'self' https://www.googletagmanager.com; connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com; frame-src 'none'; form-action 'none'; base-uri 'none'";
const DESC = '元素診断 CORE I 完全解析レポートの表示サンプル（実際の診断結果から42ページを掲載）。';
const TAIL = `<script src="/js/ga.js"></script>
<script src="/js/sample-return.js"></script>
<script src="/api/public-config?format=js"></script>
<script src="/js/report-purchase.js"></script>
<script src="/js/sample-buy.js"></script><!-- 共通フッター：特商法・利用規約・プライバシーポリシーへのリンクは、各ページの最下部のここだけに置く（購入ボタンの周辺には出さない） -->
<footer class="ed-legal-foot" style="margin:48px auto 0;padding:22px 16px calc(22px + env(safe-area-inset-bottom));text-align:center;border-top:1px solid rgba(150,180,240,.12)">
  <style>@media print{.ed-legal-foot{display:none!important}}.ed-legal-foot a:focus-visible{outline:2px solid #9cc4f0;outline-offset:2px}</style>
  <nav aria-label="法務情報" style="display:flex;gap:4px 20px;justify-content:center;flex-wrap:wrap">
    <a href="/tokushoho" style="color:#7098b8;font-size:11px;text-decoration:none;letter-spacing:0.1em;padding:8px 2px">特定商取引法に基づく表記</a>
    <a href="/privacy.html" style="color:#7098b8;font-size:11px;text-decoration:none;letter-spacing:0.1em;padding:8px 2px">プライバシーポリシー</a>
    <a href="/terms.html" style="color:#7098b8;font-size:11px;text-decoration:none;letter-spacing:0.1em;padding:8px 2px">利用規約</a>
  </nav>
</footer>
`;

function build() {
  const out = generate();
  const html = out.html;
  const css = html.match(/<style>\n([\s\S]*?)\n<\/style>/)[1];
  const sections = html.split(/(?=<section class="page )/).slice(1).map((s) => s.replace(/<\/main>[\s\S]*$/, ''));
  // 目次の題名は、生成器の目次（全46ページ）のものをそのまま使う
  const titles = Object.fromEntries([...html.matchAll(/<li><a href="#p(\d+)"><span>P\d+<\/span>([^<]*)<\/a><\/li>/g)].map((m) => [m[1], m[2]]));
  const pages = [];
  const toc = [];
  for (const s of sections) {
    const id = s.match(/id="p(\d+)"/)[1];
    if (EXCLUDE.has(id)) continue;
    toc.push({ id, title: titles[id] || '' });
    pages.push(s.replace(/(<section class="page [^>]*>)/, '$1\n  <span class="sample-mark" aria-hidden="true">SAMPLE</span>'));
  }
  if (pages.length !== 42) throw new Error('page count ' + pages.length);
  if (toc.some((t) => !t.title)) throw new Error('empty toc title');
  // 元素辞典（P39〜P42）の前後で番号が飛ぶ：目次に、省略した旨を1行
  const items = [];
  toc.forEach((t, i) => {
    if (i > 0 && Number(t.id) - Number(toc[i - 1].id) > 1) items.push('<li class="skip">P39〜P42（元素・武器種・国家の辞典）は、サンプルには掲載していません</li>');
    items.push(`<li><a href="#p${t.id}"><span>P${t.id}</span>${t.title}</a></li>`);
  });
  const intro = `<nav class="web-toc sample-intro" aria-label="完全解析サンプルの案内"><div>
  <p class="sample-eyebrow">COMPLETE ANALYSIS SAMPLE</p>
  <h1>完全解析 表示サンプル</h1>
  <div class="sample-facts" aria-label="サンプルについて">
    <p>実際の診断結果（風 × 弓 × ナタ）から作った、製品版と同じレポートです</p>
    <p>製品版は全46ページ。このサンプルは、元素・武器種・国家の辞典4ページを除く42ページ</p>
    <p>実際の内容は診断結果ごとに異なります</p>
  </div>
  <p class="sample-return-top"><a href="/" data-sample-return>元の画面に戻る</a></p>
  <details open="open"><summary>サンプル目次（42ページ）</summary><ol>${items.join('')}</ol></details>
</div></nav>`;
  const cta = `<aside class="sample-cta" id="sample-buy" aria-label="お申し込み" data-sample-buy="complete">
  <h2>あなた自身の輪郭を、46ページで読む。</h2>
  <p>お申し込みには、あなたの診断結果が必要です。<a href="/">まず元素診断を受ける</a></p>
</aside>`;
  const head = `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<title>完全解析サンプル — ELEMENT DIAGNOSIS</title>
<style>${css}
${SAMPLE_CSS}</style>
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="description" content="${DESC}">
<meta property="og:type" content="article">
<meta property="og:title" content="完全解析サンプル — 元素診断">
<meta property="og:description" content="${DESC}">
<meta property="og:url" content="${SITE}/complete-sample">
<meta property="og:image" content="${SITE}/assets/ogp/ogp-top-20261009.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="元素診断 アナタの内側にある、元素の輪郭を。">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="完全解析サンプル — 元素診断">
<meta name="twitter:description" content="${DESC}">
<meta name="twitter:image" content="${SITE}/assets/ogp/ogp-top-20261009.jpg"></head>
<body>
`;
  return head + intro + '<main class="pages">\n' + pages.join('') + '</main>\n' + cta + '\n' + TAIL + '</body>\n</html>\n';
}

if (require.main === module) {
  const html = build();
  fs.writeFileSync(path.join(ROOT, 'complete-sample.html'), html);
  console.log('complete-sample.html を作りました（', html.length, 'bytes, 42ページ）');
}
module.exports = { build };
