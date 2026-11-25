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
import vm from 'node:vm';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { ELEMENT_PROTOTYPES_V2 } = require('../js/eti_v2_prototypes.js');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/type-pages-data.json'), 'utf8'));
// 結果ページ（index.html）と同じ文章資産を使う（タイプ解説と結果ページで説明を食い違わせない）
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function indexConst(name) {
  const i = INDEX.indexOf(`const ${name} = `);
  if (i < 0) throw new Error(`index.html に ${name} がありません`);
  const j = INDEX.indexOf('{', i); let depth = 0; let k = j;
  for (; k < INDEX.length; k++) { if (INDEX[k] === '{') depth++; else if (INDEX[k] === '}' && --depth === 0) break; }
  return vm.runInNewContext(`(${INDEX.slice(j, k + 1)})`);
}
const TYPE_DESC = indexConst('TYPE_DESC');
const ELEMENT_DESC = indexConst('ELEMENT_DESC');
const WEAPON_DESC = indexConst('WEAPON_DESC');
const EL_META = indexConst('ELEMENTS');
const WP_META = indexConst('WEAPONS');
const TRAIT_WORD = indexConst('TRAIT_WORD');
const STYLE_LABEL = indexConst('STYLE_LABEL');
const STYLE_BASE_DESC = indexConst('STYLE_BASE_DESC');
const { WEAPON_PROTOTYPES_V2 } = require('../js/eti_v2_prototypes.js');
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
// 文を「。」で区切る（文言は変えない）
const sentences = (text) => text.split('。').filter((x) => x.trim()).map((x) => x + '。');
// 本文を「段落・引用・段落」に分ける：最初の2文、3文目（引用）、残り
function withQuote(text) {
  const ss = sentences(text);
  return { head: ss.slice(0, 2).join(''), quote: ss[2] || '', tail: ss.slice(3).join('') };
}

export function renderTypePage(code) {
  const d = DATA[code];
  if (!d) throw new Error(`不明なタイプ: ${code}`);
  const el = ELEMENTS[code.slice(0, 2)];
  const wp = WEAPONS[code.slice(2)];
  const name = typeName(code);
  const proto = ELEMENT_PROTOTYPES_V2[el.name];
  const style = WEAPON_PROTOTYPES_V2[wp.name];
  const typeDesc = sentences(TYPE_DESC[el.name][wp.name]);
  const [essence, strength] = typeDesc;
  const caution = typeDesc.length > 2 ? typeDesc.slice(2).join('') : '';
  const E = withQuote(ELEMENT_DESC[el.name]);
  const W = withQuote(WEAPON_DESC[wp.name]);
  const topStyle = Object.keys(style).sort((a, b) => style[b] - style[a])[0];
  const emblem = `/assets/emblems/2026-autumn/record/${el.slug}.png`;
  const listHref = `/#types-${el.slug}`;
  const siblings = WEAPON_ORDER.filter((w) => w !== code.slice(2)).map((w) => {
    const c = code.slice(0, 2) + w;
    return `      <li><a href="/type/${c.toLowerCase()}"><span class="sib-w">${WEAPONS[w].name}</span><span class="sib-n">${typeName(c)}</span><span class="sib-c">${c}</span></a></li>`;
  }).join('\n');
  // Big Five：両端に「低い時・高い時」の言葉（結果ページの TRAIT_WORD）。値は 0〜100
  const big5 = BIG5.map(([k, label]) => {
    // 45〜55 は中間（どちらにも寄らない）として扱う
    const v = proto[k]; const hi = v > 55; const lo = v < 45;
    const side = hi ? `${TRAIT_WORD[k].hi}寄り` : lo ? `${TRAIT_WORD[k].lo}寄り` : '中間';
    return `      <div class="pole">
        <div class="pole-h"><b>${v}</b> ${label}<span>（${side}）</span></div>
        <div class="pole-t"><span class="pole-f" style="width:${v}%"></span><span class="pole-dot" style="left:${v}%"></span></div>
        <div class="pole-e"><span${lo ? ' class="on"' : ''}>${TRAIT_WORD[k].lo}</span><span${hi ? ' class="on"' : ''}>${TRAIT_WORD[k].hi}</span></div>
      </div>`;
  }).join('\n');
  const styleBars = Object.keys(STYLE_LABEL).map((k) => `        <div class="bar"><span class="bar-l">${STYLE_LABEL[k]}</span><span class="bar-t"><span class="bar-f" style="width:${style[k]}%"></span></span><span class="bar-v">${style[k]}</span></div>`).join('\n');
  const lead = d.lead ? `\n  <p class="lead">${d.lead}</p>` : '';
  const q = (t) => (t ? `\n    <blockquote class="pull">${t}</blockquote>` : '');
  const p = (t) => (t ? `\n    <p>${t}</p>` : '');
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
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root { --el:${el.base}; --el-l:${el.light}; --bg:#0b0b12; --panel:#13121b; --line:#262532; --text:#e8eaf0; --body:#d6dae2; --sub:#a4acb8; --serif:'Noto Serif JP','Hiragino Mincho ProN','Yu Mincho',serif; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--text); font-family:'Hiragino Sans','Noto Sans JP',sans-serif; max-width:680px; margin:0 auto; padding:18px 18px 72px; line-height:1.95; -webkit-text-size-adjust:100%; }
  a { color:inherit; }
  .crumb { font-size:12.5px; color:var(--sub); margin-bottom:12px; }
  .crumb a { color:var(--sub); text-decoration:none; border-bottom:1px solid #3a3a48; }
  .eyebrow { display:none; }
  /* ヒーロー：元素 × 武器種 → タイプ名 → タイプコード → 無料診断 */
  .hero { position:relative; border:1px solid color-mix(in srgb, var(--el) 70%, #000); border-radius:16px; padding:6px; background:radial-gradient(120% 90% at 85% 30%, color-mix(in srgb, var(--el) 18%, transparent), transparent 60%), var(--panel); }
  .hero-in { position:relative; border:1px solid color-mix(in srgb, var(--el) 35%, transparent); border-radius:11px; padding:18px 16px 16px; }
  .hero-em { position:absolute; top:12px; right:8px; width:112px; height:112px; object-fit:contain; filter:drop-shadow(0 0 16px color-mix(in srgb, var(--el) 50%, transparent)); pointer-events:none; }
  .el-w, h1, .code { position:relative; margin-right:110px; }
  .el-w { font-family:var(--serif); font-weight:700; color:var(--el-l); font-size:17px; letter-spacing:.08em; line-height:1.5; }
  h1 { font-family:var(--serif); font-weight:700; line-height:1.2; margin:4px 0 6px; }
  h1 .h1-sub { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
  h1 .h1-n { display:block; font-size:46px; letter-spacing:.05em; color:#f6f1e8; text-shadow:0 0 24px color-mix(in srgb, var(--el) 35%, transparent); }
  .code { font-family:var(--serif); font-size:13px; color:var(--sub); letter-spacing:.12em; margin-bottom:14px; }
  /* ボタン：サイトの見出しと同じ明朝・字間（トップの「診断をはじめる」と同じ表情） */
  .pre-cta, .cta, .r-btn, .confirm button { font-family:var(--serif); font-weight:700; letter-spacing:.1em; }
  .pre-cta { display:flex; align-items:center; justify-content:center; gap:8px; min-height:44px; padding:11px 16px; border:1px solid var(--el-l); border-radius:999px; color:#f6f1e8; background:linear-gradient(180deg, color-mix(in srgb, var(--el) 34%, transparent), color-mix(in srgb, var(--el) 14%, transparent)); box-shadow:0 0 18px color-mix(in srgb, var(--el) 22%, transparent), inset 0 1px 0 rgba(255,255,255,.08); font-size:14.5px; line-height:1.55; text-align:center; text-decoration:none; word-break:keep-all; overflow-wrap:anywhere; }
  .pre-cta .arw { display:inline-block; transition:transform .2s; color:var(--el-l); }
  .pre-cta:hover .arw, .pre-cta:focus-visible .arw { transform:translateX(3px); }
  /* 冒頭：タイプの核を引用として大きく、その後に導入 */
  .essence { margin:30px 0 0; padding:4px 0 4px 18px; border-left:4px solid var(--el-l); }
  .essence p { font-family:var(--serif); font-weight:700; font-size:21px; line-height:1.7; color:#f6f1e8; }
  .essence cite { display:block; margin-top:10px; font-style:normal; font-size:13.5px; color:var(--sub); letter-spacing:.06em; }
  .lead { font-size:16px; line-height:2; color:var(--body); margin:24px 0 0; }
  .intro { font-size:16px; line-height:2; color:var(--body); margin:16px 0 0; }
  /* 紋章の図（章の区切り） */
  .figure { position:relative; margin:30px auto 6px; width:220px; height:180px; display:grid; place-items:center; }
  .figure::before, .figure::after { content:''; position:absolute; border-radius:50%; border:1px solid color-mix(in srgb, var(--el) 45%, transparent); }
  .figure::before { width:176px; height:176px; }
  .figure::after { width:136px; height:136px; border-style:dashed; opacity:.6; }
  .figure img { position:relative; width:128px; height:128px; object-fit:contain; filter:drop-shadow(0 0 22px color-mix(in srgb, var(--el) 55%, transparent)); }
  /* 章：小見出し（元素の気質など）→ 大見出し（その章の主題）→ 本文と引用 */
  .chapter { margin-top:40px; }
  .chapter .kicker { display:flex; align-items:center; gap:10px; font-size:13px; font-weight:700; letter-spacing:.14em; color:var(--el-l); }
  .chapter .kicker::before { content:''; width:8px; height:8px; transform:rotate(45deg); background:var(--el-l); flex:none; }
  .chapter .kicker::after { content:''; flex:1; height:1px; background:var(--line); }
  .chapter h2 { font-family:var(--serif); font-weight:700; font-size:27px; line-height:1.45; color:#f6f1e8; margin:10px 0 12px; letter-spacing:.03em; }
  .chapter h3 { font-family:var(--serif); font-weight:700; font-size:19px; line-height:1.5; color:var(--el-l); margin:22px 0 6px; }
  .chapter p { font-size:16px; line-height:2; color:var(--body); }
  .chapter p + p { margin-top:14px; }
  .pull { margin:20px 0; padding:16px 18px; border-left:4px solid var(--el-l); background:color-mix(in srgb, var(--el) 13%, #12111a); border-radius:0 10px 10px 0; font-family:var(--serif); font-size:17px; line-height:1.85; color:#f2ede4; }
  .pull.caution { border-left-color:#c8b48a; background:#17151a; }
  .axis { font-family:var(--serif); font-weight:600; font-size:16px; color:var(--el-l); margin:22px 0 4px; letter-spacing:.04em; }
  .tags { margin:10px 0 0; }
  .tag { display:inline-block; font-size:13px; border:1px solid color-mix(in srgb, var(--el) 50%, var(--line)); border-radius:20px; padding:4px 12px; margin:0 6px 8px 0; color:#dfe2e8; background:#171620; }
  [data-preview-only][hidden] { display:none !important; }
  .pv-note { display:inline-block; font-size:11.5px; color:#1a1410; background:#e8d6a8; border-radius:4px; padding:1px 8px; margin-left:6px; vertical-align:2px; font-family:'Hiragino Sans','Noto Sans JP',sans-serif; letter-spacing:0; font-weight:700; }
  /* 標準プロフィール：両端に言葉のある軸（Big Five）と、武器種の行動スタイル */
  .prof-card { border:1px solid var(--line); border-radius:14px; background:var(--panel); padding:18px 16px 12px; margin-top:6px; }
  .prof-card + .prof-card { margin-top:12px; }
  .prof-card .pc-h { font-family:var(--serif); font-weight:700; font-size:16px; color:#f2ede4; margin-bottom:8px; }
  .pole { margin:10px 0 14px; }
  .pole-h { text-align:center; font-size:15px; color:#f2ede4; font-weight:700; }
  .pole-h b { color:var(--el-l); font-size:17px; }
  .pole-h span { color:var(--sub); font-weight:400; font-size:13px; }
  .pole-t { position:relative; height:12px; margin:8px 4px 6px; border-radius:6px; background:#2a2a36; }
  .pole-f { position:absolute; left:0; top:0; bottom:0; border-radius:6px; background:linear-gradient(90deg, color-mix(in srgb, var(--el-l) 55%, #2a2a36), var(--el-l)); }
  .pole-dot { position:absolute; top:50%; width:20px; height:20px; margin:-10px 0 0 -10px; border-radius:50%; background:#fff; border:4px solid var(--el-l); box-shadow:0 0 0 3px #13121b; }
  .pole-e { display:flex; justify-content:space-between; font-size:13.5px; color:var(--sub); }
  .pole-e .on { color:#f2ede4; font-weight:700; }
  .bar { display:grid; grid-template-columns:5em 1fr 2.2em; align-items:center; gap:10px; min-height:36px; font-size:14.5px; color:#dfe2e8; }
  .bar-t { height:10px; border-radius:5px; background:#2a2a36; overflow:hidden; }
  .bar-f { display:block; height:100%; border-radius:5px; background:var(--el-l); }
  .bar-v { text-align:right; color:var(--el-l); font-variant-numeric:tabular-nums; }
  .pc-note { font-size:13.5px; color:var(--body); line-height:1.85; margin-top:8px; }
  .src { font-size:12.5px; color:var(--sub); line-height:1.8; margin-top:12px; }
  /* タイプ別レポート：解放の枠 */
  .report { margin-top:26px; border:1px solid color-mix(in srgb, var(--el) 80%, #000); border-top:4px solid var(--el-l); border-radius:16px; padding:22px 18px 18px; text-align:center; background:radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--el) 20%, transparent), transparent 60%), #17141e; }
  .report .r-chip { display:inline-block; font-size:12.5px; font-weight:700; color:var(--el-l); letter-spacing:.1em; padding:3px 14px; border-radius:999px; background:color-mix(in srgb, var(--el) 22%, transparent); }
  .report h3 { font-family:var(--serif); font-size:25px; line-height:1.5; color:#f6f1e8; margin:12px 0 4px; word-break:keep-all; overflow-wrap:anywhere; }
  .report .r-em { display:block; width:120px; height:120px; margin:6px auto; object-fit:contain; filter:drop-shadow(0 0 20px color-mix(in srgb, var(--el) 55%, transparent)); }
  .report .r-desc { font-size:14.5px; color:var(--body); line-height:1.9; text-align:left; }
  .report .r-btn { display:block; width:100%; margin-top:16px; min-height:52px; border:0; border-radius:999px; background:linear-gradient(180deg, color-mix(in srgb, var(--el-l) 92%, #fff), var(--el-l)); color:#17121a; font-size:16px; cursor:pointer; box-shadow:0 6px 20px color-mix(in srgb, var(--el) 35%, transparent); }
  .report .r-diff { font-size:12.5px; color:var(--sub); line-height:1.75; margin-top:12px; text-align:left; }
  dialog.confirm { margin:auto; width:min(92vw, 440px); border:1px solid color-mix(in srgb, var(--el) 70%, #000); border-radius:16px; background:#16141d; color:var(--text); padding:22px 18px 16px; }
  dialog.confirm::backdrop { background:rgba(4,4,8,.74); }
  .confirm .c-label { font-size:12.5px; font-weight:700; color:var(--el-l); letter-spacing:.1em; }
  .confirm h3 { font-family:var(--serif); font-size:21px; line-height:1.5; margin:4px 0 12px; color:#f6f1e8; }
  .confirm dl { display:grid; grid-template-columns:5.5em 1fr; gap:6px 10px; font-size:14px; margin-bottom:12px; }
  .confirm dt { color:var(--sub); }
  .confirm .c-sub { font-family:var(--serif); font-weight:700; font-size:15px; }
  .confirm ul { margin:4px 0 12px 1.2em; font-size:14px; color:var(--body); line-height:1.85; }
  .confirm .c-note { font-size:12.5px; color:#e8d6a8; background:#2a2418; border-radius:8px; padding:8px 10px; line-height:1.7; margin-bottom:12px; }
  .confirm .c-row { display:flex; gap:8px; }
  .confirm button { flex:1; min-height:48px; border-radius:999px; font-size:14.5px; cursor:pointer; }
  .confirm .c-close { background:transparent; color:var(--text); border:1px solid var(--line); }
  .confirm .c-go { background:#3a3846; color:#9a9aa8; border:0; cursor:not-allowed; }
  .cta { display:block; text-align:center; background:linear-gradient(180deg, color-mix(in srgb, var(--el) 36%, #15131c), color-mix(in srgb, var(--el) 18%, #15131c)); border:1px solid var(--el-l); color:#f6f1e8; text-decoration:none; padding:15px 14px; border-radius:999px; font-size:15px; margin-top:38px; line-height:1.6; word-break:keep-all; overflow-wrap:anywhere; box-shadow:0 0 20px color-mix(in srgb, var(--el) 20%, transparent); }
  .back { display:block; text-align:center; margin-top:14px; color:var(--sub); font-size:14px; min-height:44px; padding-top:10px; }
  .more { margin-top:8px; }
  .more .more-h { display:flex; align-items:center; gap:10px; margin:34px 0 10px; font-size:13px; font-weight:700; letter-spacing:.14em; color:var(--el-l); }
  .more .more-h::before { content:''; width:8px; height:8px; transform:rotate(45deg); background:var(--el-l); flex:none; }
  .more .more-h::after { content:''; flex:1; height:1px; background:var(--line); }
  .more ul { list-style:none; border:1px solid var(--line); border-radius:12px; background:var(--panel); overflow:hidden; }
  .more li + li { border-top:1px solid var(--line); }
  .more li a { display:grid; grid-template-columns:4.2em 1fr auto; align-items:center; gap:8px; min-height:50px; padding:8px 14px; text-decoration:none; font-size:15px; }
  .sib-w { color:var(--sub); font-size:13.5px; }
  .sib-n { font-family:var(--serif); font-weight:700; color:#f2ede4; }
  .sib-c { color:var(--el-l); font-size:12.5px; letter-spacing:.06em; }
  .more .jg { margin-top:18px; font-size:13.5px; color:var(--sub); }
  .more .jg a { color:#d8b0e8; }
  @media (max-width:360px) { h1 .h1-n { font-size:40px; } .hero-em { width:90px; height:90px; } .el-w, h1, .code { margin-right:90px; } .chapter h2 { font-size:24px; } }
</style>
</head>
<body data-type-code="${code}" data-element="${el.slug}" data-weapon-type="${wp.slug}">
  <nav class="crumb" aria-label="現在地"><a href="${listHref}" data-types-back="${el.slug}">全35タイプ一覧</a> ／ ${el.name} × ${wp.name}</nav>
  <div class="eyebrow">元素診断タイプ解説</div>
  <header class="hero"><div class="hero-in">
   <img class="hero-em" src="${emblem}" width="112" height="112" alt="${el.name}の紋章">
  <div class="el-w">${el.name} × ${wp.name}</div>
  <h1><span class="h1-sub">${el.name}×${wp.name}タイプ「</span><span class="h1-n">${name}</span><span class="h1-sub">」</span></h1>
  <div class="code">タイプコード：${code}</div>
  <a class="pre-cta" href="${ORIGIN}/" data-type-cta="top" data-destination="eti_top">元素診断（100問・無料）で、あなたのタイプを確かめる<span class="arw" aria-hidden="true">→</span></a>
  </div></header>

  <blockquote class="essence"><p>${essence}</p><cite>— ${el.name} × ${wp.name}「${name}」</cite></blockquote>${lead}
  <p class="intro">${name}は、${el.name}の気質（${EL_META[el.name].axis}）と、${wp.name}の関わり方（${WP_META[wp.name].style}）が重なって現れるタイプです。${d.combineText}</p>

  <div class="figure" aria-hidden="true"><img src="${emblem}" width="128" height="128" alt="" loading="lazy"></div>

  <section class="chapter" aria-labelledby="ch-el">
    <div class="kicker">${el.name}の気質</div>
    <h2 id="ch-el">${EL_META[el.name].axis}</h2>${p(E.head)}${q(E.quote)}${p(E.tail)}
  </section>

  <section class="chapter" aria-labelledby="ch-wp">
    <div class="kicker">${wp.name}の関わり方</div>
    <h2 id="ch-wp">${WP_META[wp.name].principle}</h2>${p(W.head)}${q(W.quote)}${p(W.tail)}
  </section>

  <section class="chapter" aria-labelledby="ch-type">
    <div class="kicker">${name}として現れる特徴</div>
    <h2 id="ch-type">強みと、つまずきやすいところ</h2>
    <h3>力を発揮するとき</h3>
    <p>${strength}</p>${caution ? `
    <h3>つまずきやすいところ</h3>
    <blockquote class="pull caution">${caution}</blockquote>` : ''}
    <div class="axis">${d.axis}</div>
    <div class="tags">${d.tags.map((t) => `<span class="tag">${t}</span>`).join('')}</div>
  </section>

  <section class="chapter prof" data-preview-only hidden aria-labelledby="prof-h">
    <div class="kicker">標準プロフィール</div>
    <h2 id="prof-h">${name}の標準プロフィール<span class="pv-note">表示用の仮値</span></h2>
    <div class="prof-card">
      <div class="pc-h">気質（Big Five・0〜100）— ${el.name}</div>
${big5}
    </div>
    <div class="prof-card">
      <div class="pc-h">関わり方（行動スタイル・0〜100）— ${wp.name}</div>
${styleBars}
      <p class="pc-note">${STYLE_BASE_DESC[topStyle]}</p>
    </div>
    <p class="src">いまの数値は、元素診断 v2 の設計で${el.name}元素（気質）と${wp.name}（関わり方）に置いた代表値を、仮に表示しています。受検者の平均ではありません。</p>
    <div class="report">
      <span class="r-chip">タイプ別レポート</span>
      <h3>「${name}」の全編を解放</h3>
      <img class="r-em" src="${emblem}" width="120" height="120" alt="" loading="lazy">
      <p class="r-desc">標準プロフィールをもとに、${name}の強みを活かせる場面、つまずきやすい場面、人との関わり方を読み解きます。</p>
      <button type="button" class="r-btn" data-report-open>今すぐアクセス　¥1,000（税込）</button>
      <p class="r-diff">${name}の方に共通の読み物です。あなた自身の回答から作る「解析レポート」とは別の商品です。</p>
    </div>
    <dialog class="confirm" id="reportConfirm" aria-labelledby="rc-h">
      <div class="c-label">購入内容の確認</div>
      <h3 id="rc-h">タイプ別レポート「${name}」</h3>
      <dl><dt>対象タイプ</dt><dd>${el.name} × ${wp.name}「${name}」（${code}）</dd><dt>価格</dt><dd>¥1,000（税込）</dd><dt>種類</dt><dd>${name}の方に共通の読み物</dd></dl>
      <div class="c-sub">読める内容</div>
      <ul><li>標準プロフィールの読み方</li><li>強みを活かせる場面</li><li>つまずきやすい場面</li><li>人との関わり方</li></ul>
      <p class="c-note">デザイン確認用のデモです。購入・決済は行われません。あなた自身の回答から作る「解析レポート」とは別の商品です。</p>
      <div class="c-row"><button type="button" class="c-close" data-report-close>閉じる</button><button type="button" class="c-go" disabled aria-disabled="true">購入へ進む（準備中）</button></div>
    </dialog>
  </section>

  <a class="cta" href="${ORIGIN}/" data-type-cta="bottom" data-destination="eti_top">無料の元素診断で、あなたのタイプを確かめる</a>
  <nav class="more" aria-label="同じ元素のほかのタイプ">
    <h2 class="more-h">同じ元素のほかのタイプ</h2>
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
