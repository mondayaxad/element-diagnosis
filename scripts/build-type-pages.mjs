// タイプ解説ページ（type/<code>.html）を、共通テンプレート（type-v2）で書き出す。
//   ・元データは scripts/type-pages-data.json（既存ページから文字どおり取り出した本文と SEO の head）。文言は書き換えない
//   ・title・description・canonical・OGP・JSON-LD は元の行をそのまま使う（SEO Phase 2 の内容を維持）
//   ・診断への導線（data-type-cta="top|bottom|related"）の3つは、文言・遷移先・計測属性を変えない
//   ・元素の色と紋章（assets/emblems/2026-autumn/record）は、結果ページ・マイページと同じものを使う
//   ・標準プロフィールとタイプ別レポートの欄は、Preview 専用のデザイン確認（本番ドメインでは表示しない。js/type-detail.js）
//   実行: node scripts/build-type-pages.mjs PYSW CRSW ELSW   （引数なしは全35タイプ）
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { ELEMENT_PROTOTYPES_V2 } = require('../js/eti_v2_prototypes.js');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/type-pages-data.json'), 'utf8'));
const ORIGIN = 'https://element-diagnosis-five.vercel.app';

// 元素：結果ページの元素色（ELEMENTS.color）と、トップの一覧の文字色（明るい側）。紋章は結果ページ・マイページと共通
export const ELEMENTS = {
  PY: { name: '炎', slug: 'pyro', base: '#c84a20', light: '#e8a878' },
  HY: { name: '水', slug: 'hydro', base: '#2a7aaa', light: '#8fd0ec' },
  CR: { name: '氷', slug: 'cryo', base: '#4a80c0', light: '#a8c8ec' },
  EL: { name: '雷', slug: 'electro', base: '#9040d0', light: '#d0a0f0' },
  AN: { name: '風', slug: 'anemo', base: '#3a8a60', light: '#8fd8b0' },
  GE: { name: '岩', slug: 'geo', base: '#a07830', light: '#e0c088' },
  DE: { name: '草', slug: 'dendro', base: '#4a8020', light: '#9cd070' },
};
export const WEAPONS = {
  SW: { name: '片手剣', slug: 'sword' }, CM: { name: '両手剣', slug: 'claymore' }, PL: { name: '長柄', slug: 'polearm' },
  CT: { name: '法器', slug: 'catalyst' }, BW: { name: '弓', slug: 'bow' },
};
const WEAPON_ORDER = ['SW', 'CM', 'PL', 'CT', 'BW'];
const BIG5 = [['O', '開放性'], ['C', '誠実性'], ['E', '外向性'], ['A', '協調性'], ['N', '神経症傾向']];

const typeName = (code) => /「([^」]+)」/.exec(DATA[code].h1)[1];
// 本文の最初の一文（「炎は、…元素です。」）を見出し下の要約として使う（文言はそのまま）
function splitFirst(text) {
  const i = text.indexOf('。');
  return i < 0 ? [text, ''] : [text.slice(0, i + 1), text.slice(i + 1)];
}

export function renderTypePage(code) {
  const d = DATA[code];
  if (!d) throw new Error(`不明なタイプ: ${code}`);
  const el = ELEMENTS[code.slice(0, 2)];
  const wp = WEAPONS[code.slice(2)];
  const name = typeName(code);
  const slug = code.toLowerCase();
  const proto = ELEMENT_PROTOTYPES_V2[el.name];
  const [elFirst, elRest] = splitFirst(d.elementText);
  const [wpFirst, wpRest] = splitFirst(d.weaponText);
  const emblem = `/assets/emblems/2026-autumn/record/${el.slug}.png`;
  const siblings = WEAPON_ORDER.filter((w) => w !== code.slice(2)).map((w) => {
    const c = code.slice(0, 2) + w;
    return `      <li><a href="/type/${c.toLowerCase()}"><span class="sib-w">${WEAPONS[w].name}</span><span class="sib-n">${typeName(c)}</span><span class="sib-c">${c}</span></a></li>`;
  }).join('\n');
  const bars = BIG5.map(([k, label]) => `        <div class="bar"><span class="bar-l">${label}</span><span class="bar-t"><span class="bar-f" style="width:${proto[k]}%"></span></span><span class="bar-v">${proto[k]}</span></div>`).join('\n');
  const lead = d.lead ? `\n  <p class="lead">${d.lead}</p>` : '';
  const listHref = `/#types-${el.slug}`;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<!-- template: type-v2（scripts/build-type-pages.mjs で生成。手で編集しない） -->
<!-- GA4：js/ga.js が本番ドメインでだけ読み込む（Preview・ローカルでは送信しない） -->
<script src="/js/ga.js"></script>
<!-- 診断への導線のクリック（type_diagnosis_cta_click）を GA4 に送る -->
<script src="/js/type-page.js" defer></script>
<!-- 一覧へ戻った時に読んでいた元素を開く・Preview 専用の欄（標準プロフィール・タイプ別レポートの購入確認デモ） -->
<script src="/js/type-detail.js" defer></script>
${d.head}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700&display=swap" rel="stylesheet">
<style>
  :root { --el:${el.base}; --el-l:${el.light}; --bg:#0b0b12; --panel:#13121b; --line:#2a2836; --text:#e6e8ee; --sub:#a4acb8; --serif:'Noto Serif JP','Hiragino Mincho ProN','Yu Mincho',serif; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--text); font-family:'Hiragino Sans','Noto Sans JP',sans-serif; max-width:680px; margin:0 auto; padding:20px 16px 64px; line-height:1.9; -webkit-text-size-adjust:100%; }
  a { color:inherit; }
  .crumb { font-size:12.5px; color:var(--sub); margin-bottom:12px; }
  .crumb a { color:var(--sub); text-decoration:none; border-bottom:1px solid #3a3a48; }
  .eyebrow { display:none; }
  .hero { position:relative; border:1px solid color-mix(in srgb, var(--el) 70%, #000); border-radius:16px; padding:6px; background:radial-gradient(120% 90% at 85% 30%, color-mix(in srgb, var(--el) 16%, transparent), transparent 60%), var(--panel); }
  .hero-in { position:relative; border:1px solid color-mix(in srgb, var(--el) 35%, transparent); border-radius:11px; padding:18px 16px 16px; }
  .hero-em { position:absolute; top:14px; right:10px; width:108px; height:108px; object-fit:contain; filter:drop-shadow(0 0 14px color-mix(in srgb, var(--el) 45%, transparent)); pointer-events:none; }
  .el-w, h1, .code { position:relative; margin-right:108px; }
  .el-w { font-family:var(--serif); font-weight:700; color:var(--el-l); font-size:17px; letter-spacing:.06em; line-height:1.5; }
  h1 { font-family:var(--serif); font-weight:700; line-height:1.25; margin:2px 0 4px; }
  h1 .h1-sub { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
  h1 .h1-n { display:block; font-size:44px; letter-spacing:.04em; color:#f6f1e8; }
  .code { font-size:13px; color:var(--sub); letter-spacing:.08em; margin-bottom:12px; }
  .pre-cta { display:flex; align-items:center; justify-content:center; gap:6px; min-height:44px; padding:10px 14px; border:1px solid var(--el-l); border-radius:10px; color:#f6f1e8; background:color-mix(in srgb, var(--el) 22%, transparent); font-size:14px; font-weight:700; line-height:1.5; text-align:center; text-decoration:none; word-break:keep-all; overflow-wrap:anywhere; }
  .pre-cta .arw { display:inline-block; transition:transform .2s; color:var(--el-l); }
  .pre-cta:hover .arw, .pre-cta:focus-visible .arw { transform:translateX(3px); }
  .lead { font-family:var(--serif); font-size:15.5px; line-height:2; color:#ece6da; margin:26px 2px 6px; }
  .sec-h { display:flex; align-items:center; gap:10px; margin:34px 0 12px; font-size:13px; font-weight:700; letter-spacing:.12em; color:var(--el-l); }
  .sec-h::before { content:''; width:8px; height:8px; transform:rotate(45deg); background:var(--el-l); flex:none; }
  .sec-h::after { content:''; flex:1; height:1px; background:var(--line); }
  .card { border:1px solid var(--line); border-radius:12px; background:var(--panel); padding:16px 16px 14px; margin-bottom:12px; }
  .card h2 { font-family:var(--serif); font-size:18px; font-weight:700; color:var(--el-l); line-height:1.5; margin-bottom:6px; }
  .card .first { font-family:var(--serif); font-size:15.5px; color:#f2ede4; line-height:1.8; margin-bottom:6px; }
  .card p { font-size:15px; color:#d4d8e0; }
  .axis { font-family:var(--serif); font-size:15px; color:var(--el-l); margin:12px 0 4px; padding:10px 14px; border-left:3px solid var(--el); background:color-mix(in srgb, var(--el) 10%, transparent); border-radius:0 8px 8px 0; }
  .tags { margin:12px 0 0; }
  .tag { display:inline-block; font-size:12.5px; border:1px solid color-mix(in srgb, var(--el) 45%, var(--line)); border-radius:20px; padding:4px 12px; margin:0 6px 8px 0; color:#d8dce4; background:#171620; }
  [data-preview-only][hidden] { display:none !important; }
  .pv-note { display:inline-block; font-size:11.5px; color:#1a1410; background:#e8d6a8; border-radius:4px; padding:1px 8px; margin-left:4px; vertical-align:2px; }
  .prof h2 { font-family:var(--serif); font-size:24px; line-height:1.4; color:#f6f1e8; margin:2px 0 4px; }
  .prof .scale { font-size:13px; color:var(--sub); margin-bottom:12px; }
  .bars { border:1px solid var(--line); border-radius:12px; background:var(--panel); padding:14px 16px 8px; }
  .bar { display:grid; grid-template-columns:5.6em 1fr 2.2em; align-items:center; gap:10px; min-height:38px; font-size:15px; }
  .bar-t { height:10px; border-radius:5px; background:#2a2a36; overflow:hidden; }
  .bar-f { display:block; height:100%; border-radius:5px; background:var(--el-l); }
  .bar-v { text-align:right; color:var(--el-l); font-variant-numeric:tabular-nums; }
  .prof .src { font-size:12.5px; color:var(--sub); line-height:1.8; margin-top:10px; }
  .report { margin-top:18px; border:1px solid color-mix(in srgb, var(--el) 80%, #000); border-radius:14px; padding:18px 16px 16px; background:radial-gradient(120% 120% at 100% 0%, color-mix(in srgb, var(--el) 18%, transparent), transparent 55%), #1a1620; display:grid; grid-template-columns:1fr auto; gap:6px 10px; align-items:start; }
  .report .r-label { font-size:13px; font-weight:700; color:var(--el-l); letter-spacing:.08em; }
  .report h3 { font-family:var(--serif); font-size:20px; word-break:keep-all; overflow-wrap:anywhere; line-height:1.45; color:#f6f1e8; margin:2px 0 6px; }
  .report .r-desc { font-size:14px; color:#d4d8e0; line-height:1.8; }
  .report .r-em { width:64px; height:64px; object-fit:contain; border:1px solid color-mix(in srgb, var(--el) 50%, transparent); border-radius:8px; padding:6px; background:#120f17; }
  .report .r-btn { grid-column:1 / -1; margin-top:8px; min-height:48px; border:0; border-radius:10px; background:var(--el-l); color:#17121a; font-size:15.5px; font-weight:700; letter-spacing:.04em; cursor:pointer; font-family:inherit; }
  .report .r-diff { grid-column:1 / -1; font-size:12.5px; color:var(--sub); line-height:1.75; }
  dialog.confirm { margin:auto; width:min(92vw, 440px); border:1px solid color-mix(in srgb, var(--el) 70%, #000); border-radius:14px; background:#16141d; color:var(--text); padding:20px 18px 16px; }
  dialog.confirm::backdrop { background:rgba(4,4,8,.72); }
  .confirm .c-label { font-size:12.5px; font-weight:700; color:var(--el-l); letter-spacing:.08em; }
  .confirm h3 { font-family:var(--serif); font-size:20px; line-height:1.5; margin:4px 0 10px; color:#f6f1e8; }
  .confirm dl { display:grid; grid-template-columns:5.5em 1fr; gap:6px 10px; font-size:14px; margin-bottom:10px; }
  .confirm dt { color:var(--sub); }
  .confirm ul { margin:4px 0 12px 1.2em; font-size:14px; color:#d4d8e0; line-height:1.85; }
  .confirm .c-note { font-size:12.5px; color:#e8d6a8; background:#2a2418; border-radius:8px; padding:8px 10px; line-height:1.7; margin-bottom:12px; }
  .confirm .c-row { display:flex; gap:8px; }
  .confirm button { flex:1; min-height:46px; border-radius:10px; font-size:14.5px; font-weight:700; font-family:inherit; cursor:pointer; }
  .confirm .c-close { background:transparent; color:var(--text); border:1px solid var(--line); }
  .confirm .c-go { background:#3a3846; color:#9a9aa8; border:0; cursor:not-allowed; }
  .cta { display:block; text-align:center; background:color-mix(in srgb, var(--el) 30%, #15131c); border:1px solid var(--el-l); color:#f6f1e8; text-decoration:none; padding:14px 12px; border-radius:12px; font-weight:700; font-size:15px; margin-top:34px; line-height:1.6; word-break:keep-all; overflow-wrap:anywhere; }
  .back { display:block; text-align:center; margin-top:14px; color:var(--sub); font-size:14px; min-height:44px; padding-top:10px; }
  .more { margin-top:8px; }
  .more ul { list-style:none; border:1px solid var(--line); border-radius:12px; background:var(--panel); overflow:hidden; }
  .more li + li { border-top:1px solid var(--line); }
  .more li a { display:grid; grid-template-columns:4.2em 1fr auto; align-items:center; gap:8px; min-height:48px; padding:8px 14px; text-decoration:none; font-size:15px; }
  .sib-w { color:var(--sub); font-size:13.5px; }
  .sib-n { font-family:var(--serif); font-weight:700; color:#f2ede4; }
  .sib-c { color:var(--el-l); font-size:12.5px; letter-spacing:.06em; }
  .more .jg { margin-top:18px; font-size:13.5px; color:var(--sub); }
  .more .jg a { color:#d8b0e8; }
  @media (max-width:360px) { h1 .h1-n { font-size:38px; } .hero-em { width:88px; height:88px; } .el-w, h1, .code { margin-right:88px; } }
</style>
</head>
<body data-type-code="${code}" data-element="${el.slug}" data-weapon-type="${wp.slug}">
  <nav class="crumb" aria-label="現在地"><a href="${listHref}" data-types-back="${el.slug}">全35タイプ一覧</a> ／ ${el.name} × ${wp.name}</nav>
  <div class="eyebrow">元素診断タイプ解説</div>
  <header class="hero"><div class="hero-in">
   <img class="hero-em" src="${emblem}" width="108" height="108" alt="${el.name}の紋章">
  <div class="el-w">${el.name} × ${wp.name}</div>
  <h1><span class="h1-sub">${el.name}×${wp.name}タイプ「</span><span class="h1-n">${name}</span><span class="h1-sub">」</span></h1>
  <div class="code">タイプコード：${code}</div>
  <a class="pre-cta" href="${ORIGIN}/" data-type-cta="top" data-destination="eti_top">元素診断（100問・無料）で、あなたのタイプを確かめる<span class="arw" aria-hidden="true">→</span></a>
  </div></header>${lead}

  <div class="sec-h">タイプ解説</div>
  <section class="card"><h2>${el.name}の気質</h2><p class="first">${elFirst}</p><p>${elRest}</p></section>
  <section class="card"><h2>${wp.name}の関わり方</h2><p class="first">${wpFirst}</p><p>${wpRest}</p></section>
  <section class="card"><h2>${name}として現れる特徴</h2><p class="first">${d.combineText}</p>
  <div class="axis">${d.axis}</div>
  <div class="tags">${d.tags.map((t) => `<span class="tag">${t}</span>`).join('')}</div></section>

  <section class="prof" data-preview-only hidden aria-labelledby="prof-h">
    <div class="sec-h">標準プロフィール</div>
    <h2 id="prof-h">${name}の標準プロフィール</h2>
    <p class="scale">Big Five（0〜100）<span class="pv-note">表示用の仮値</span></p>
    <div class="bars">
${bars}
    </div>
    <p class="src">いまの数値は、元素診断 v2 の設計で${el.name}元素に置いた代表値（Big Five）を仮に表示しています。同じ元素の5タイプで同じ値になり、受検者の平均ではありません。</p>
    <div class="report">
      <div>
        <div class="r-label">タイプ別レポート</div>
        <h3>「${name}」の全編を解放</h3>
        <p class="r-desc">標準プロフィールをもとに、強みやつまずき、人との関わり方を読み解きます。</p>
      </div>
      <img class="r-em" src="${emblem}" width="64" height="64" alt="" loading="lazy">
      <button type="button" class="r-btn" data-report-open>今すぐアクセス　¥1,000（税込）</button>
      <p class="r-diff">${name}の方に共通の読み物です。あなた自身の回答から作る「解析レポート」とは別の商品です。</p>
    </div>
    <dialog class="confirm" id="reportConfirm" aria-labelledby="rc-h">
      <div class="c-label">購入内容の確認</div>
      <h3 id="rc-h">タイプ別レポート「${name}」</h3>
      <dl><dt>対象タイプ</dt><dd>${el.name} × ${wp.name}「${name}」（${code}）</dd><dt>価格</dt><dd>¥1,000（税込）</dd><dt>種類</dt><dd>${name}の方に共通の読み物</dd></dl>
      <div>読める内容</div>
      <ul><li>標準プロフィールの読み方</li><li>強みを活かせる場面</li><li>つまずきやすい場面</li><li>人との関わり方</li></ul>
      <p class="c-note">デザイン確認用のデモです。購入・決済は行われません。あなた自身の回答から作る「解析レポート」とは別の商品です。</p>
      <div class="c-row"><button type="button" class="c-close" data-report-close>閉じる</button><button type="button" class="c-go" disabled aria-disabled="true">購入へ進む（準備中）</button></div>
    </dialog>
  </section>

  <a class="cta" href="${ORIGIN}/" data-type-cta="bottom" data-destination="eti_top">無料の元素診断で、あなたのタイプを確かめる</a>
  <nav class="more" aria-label="同じ元素のほかのタイプ">
    <div class="sec-h"><h2 style="font:inherit;letter-spacing:inherit">同じ元素のほかのタイプ</h2></div>
    <ul>
${siblings}
    </ul>
    <a class="back" href="${listHref}" data-types-back="${el.slug}">← 全35タイプ一覧に戻る（${el.name}）</a>
    <p class="jg">心の影の側面を知る、もう一つの診断：<a href="${ORIGIN}/jagan/" data-type-cta="related" data-destination="jagan_top">邪眼診断（50問・無料）</a></p>
  </nav>
</body>
</html>
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const codes = process.argv.slice(2).map((c) => c.toUpperCase());
  for (const code of codes.length ? codes : Object.keys(DATA)) {
    fs.writeFileSync(path.join(ROOT, 'type', `${code.toLowerCase()}.html`), renderTypePage(code));
    console.log('wrote', code);
  }
}
