// タイプ解説ページ（type/<code>.html）を、共通テンプレート（type-v2）で書き出す。
//   ・元データは scripts/type-pages-data.json（既存ページから文字どおり取り出した本文と SEO の head）。文言は書き換えない
//   ・title・description・canonical・OGP・JSON-LD は元の行をそのまま使う（SEO Phase 2 の内容を維持）
//   ・診断への導線（data-type-cta="top|bottom|related"）の3つは、文言・遷移先・計測属性を変えない
//   ・元素の色と紋章（assets/emblems/2026-autumn/record）は、結果ページ・マイページと同じものを使う
//   ・タイプ別レポートの欄と、そこへ移る上部のボタンは Preview 専用のデザイン確認（本番ドメインでは表示しない。js/type-detail.js）
//   実行: node scripts/build-type-pages.mjs PYSW CRSW ELSW   （引数なしは全35タイプ）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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

const typeName = (code) => /「([^」]+)」/.exec(DATA[code].h1)[1];
// 文を「。」で区切る（文言は変えない）
const sentences = (text) => text.split('。').filter((x) => x.trim()).map((x) => x + '。');
// 本文を「段落・引用・段落」に分ける：最初の2文、3文目（引用）、残り
function withQuote(text) {
  const ss = sentences(text);
  return { head: ss.slice(0, 2).join(''), quote: ss[2] || '', tail: ss.slice(3).join('') };
}

// 結果ページの強調と同じ：文頭の語（元素名・武器名）を固有色の太字にする（rxLead）
const lead1 = (text, word, color) => (text.indexOf(word) === 0 ? `<strong style="color:${color}">${word}</strong>${text.slice(word.length)}` : text);

export function renderTypePage(code) {
  const d = DATA[code];
  if (!d) throw new Error(`不明なタイプ: ${code}`);
  const el = ELEMENTS[code.slice(0, 2)];
  const wp = WEAPONS[code.slice(2)];
  const name = typeName(code);
  const elC = EL_META[el.name].color; const wC = WP_META[wp.name].color;
  const elT = `color-mix(in srgb, ${elC} 55%, #ffffff)`; const wT = `color-mix(in srgb, ${wC} 55%, #ffffff)`;
  const typeDesc = sentences(TYPE_DESC[el.name][wp.name]);
  const [essence, strength] = typeDesc;
  const caution = typeDesc.length > 2 ? typeDesc.slice(2).join('') : '';
  const E = withQuote(ELEMENT_DESC[el.name]);
  const W = withQuote(WEAPON_DESC[wp.name]);
  const emblem = `/assets/emblems/2026-autumn/record/${el.slug}.png`;
  const listHref = `/#types-${el.slug}`;
  const siblings = WEAPON_ORDER.filter((w) => w !== code.slice(2)).map((w) => {
    const c = code.slice(0, 2) + w;
    return `      <li><a href="/type/${c.toLowerCase()}"><span class="sib-w">${WEAPONS[w].name}</span><span class="sib-n">${typeName(c)}</span><span class="sib-c">${c}</span></a></li>`;
  }).join('\n');
  const lead = d.lead ? `\n    <p class="lead">${d.lead}</p>` : '';
  const q = (t) => (t ? `\n      <blockquote class="pull">${t}</blockquote>` : '');
  const p = (t) => (t ? `\n      <p>${t}</p>` : '');
  const check = [['標準プロフィールの読み方', `気質（Big Five）と関わり方（行動スタイル）が、${name}の場合に何を意味するか`], ['強みを活かせる場面', '力が発揮されやすい状況と、その理由'], ['つまずきやすい場面', '負荷がかかりやすい状況と、立て直し方'], ['人との関わり方', '近しい相手・集団の中での振る舞いの傾向']]
    .map(([t, s]) => `          <div class="ck"><span class="ck-m">✓</span><div><div class="ck-t">${t}</div><div class="ck-s">${s}</div></div></div>`).join('\n');
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
<!-- 一覧へ戻った時に読んでいた元素を開く・Preview 専用の欄（タイプ別レポートの購入確認デモ） -->
<script src="/js/type-detail.js" defer></script>
${d.head}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  /* 文字色・書体・大きさは結果ページ（index.html の --rx-*・similarityGauges・統一CTA）に合わせる */
  :root { --el:${elC}; --wp:${wC}; --el-t:${elT}; --wp-t:${wT}; --rx-primary:#E8F1F8; --rx-secondary:#A9C2D3; --rx-tertiary:#718A9C; --rx-muted:#526776; --rx-gold:#C9A860; --card:#0c0a14; --card-line:#182838; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#07070f; color:#e0dcf0; font-family:'Noto Serif JP','Hiragino Mincho ProN','Yu Mincho',serif; -webkit-font-smoothing:antialiased; max-width:680px; margin:0 auto; padding:16px 14px 64px; line-height:1.95; -webkit-text-size-adjust:100%;
    background-image:radial-gradient(ellipse 90% 40% at 50% 0%, color-mix(in srgb, ${elC} 14%, transparent), transparent 70%), radial-gradient(ellipse 80% 50% at 50% 30%, rgba(100,60,180,.08), transparent 70%); background-repeat:no-repeat; }
  a { color:inherit; }
  strong { font-weight:700; }
  .crumb { font-size:11px; color:var(--rx-tertiary); letter-spacing:.5px; margin:0 4px 10px; }
  .crumb a { color:var(--rx-secondary); text-decoration:none; border-bottom:1px solid rgba(169,194,211,.3); }
  .eyebrow { display:none; }
  .card { background:var(--card); border:1px solid var(--card-line); border-radius:12px; padding:20px; margin-bottom:14px; }
  .kicker { font-size:11px; color:var(--rx-gold); letter-spacing:2px; margin-bottom:6px; }
  .card-h { display:flex; align-items:center; gap:8px; margin-bottom:12px; }
  .card-h::before { content:''; width:8px; height:8px; border-radius:50%; background:var(--el); flex:none; }
  .card-h h2 { color:color-mix(in srgb, var(--rx-primary) 85%, var(--el)); font-size:15px; font-weight:700; margin:0; line-height:1.6; }
  .card p { color:var(--rx-secondary); font-size:12.5px; line-height:1.95; }
  .card p + p { margin-top:10px; }
  .card h3 { color:var(--rx-primary); font-size:13px; font-weight:700; margin:16px 0 4px; letter-spacing:.5px; }
  /* ヒーロー（結果ページの「あなたの土台」と同じ並び：小見出し → コードと名前 → 元素 × 武器種 → 軸） */
  .hero { position:relative; background:linear-gradient(135deg, color-mix(in srgb, ${elC} 14%, transparent), #0a0e1a 70%); border:1px solid color-mix(in srgb, ${elC} 30%, #1c2c40); border-radius:16px; padding:22px 20px 20px; margin-bottom:14px; }
  .hero-em { position:absolute; top:14px; right:12px; width:76px; height:76px; object-fit:contain; filter:drop-shadow(0 0 12px ${elC}66); pointer-events:none; }
  .hero-k { font-size:11px; letter-spacing:3px; color:#90c0e0; margin-right:80px; }
  .el-w { font-weight:700; font-size:30px; line-height:1.35; margin:6px 80px 2px 0; letter-spacing:1px; }
  .el-w .e { color:var(--el-t); } .el-w .w { color:var(--wp-t); } .el-w .x { color:var(--rx-tertiary); font-size:18px; margin:0 6px; font-weight:400; }
  h1 { font-weight:700; line-height:1.3; margin:0 80px 2px 0; }
  h1 .h1-sub { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
  h1 .h1-n { display:block; font-size:34px; letter-spacing:3px; color:var(--rx-primary); }
  .code { font-size:15px; font-weight:700; letter-spacing:4px; color:var(--el-t); }
  .hero-ax { color:var(--rx-secondary); font-size:12px; line-height:1.9; padding-bottom:14px; margin-bottom:16px; border-bottom:1px solid #1c2c40; }
  /* 購入への導線：結果ページの「全てのロックを解除する →」と同じ（元素色→武器色） */
  .hero-buy { display:flex; align-items:center; justify-content:center; gap:8px; min-height:48px; margin-top:16px; padding:13px 14px; border-radius:8px; text-decoration:none; font-size:14px; font-weight:600; letter-spacing:2px; line-height:1.6; text-align:center; color:#fff; background:linear-gradient(90deg, ${elC}, ${wC}); word-break:keep-all; overflow-wrap:anywhere; }
  .hero-buy .arw { display:inline-block; transition:transform .2s; }
  .hero-buy:hover .arw, .hero-buy:focus-visible .arw { transform:translateX(3px); }
  html { scroll-behavior:smooth; }
  #report { scroll-margin-top:16px; }
  /* 冒頭：タイプの核（結果ページの「この先にあるもの」と同じ書き方） */
  .essence { margin:22px 6px 0; }
  .essence .k { font-size:11px; letter-spacing:3px; color:var(--rx-gold); margin-bottom:8px; }
  .essence .core { color:var(--rx-primary); font-size:16px; line-height:1.9; letter-spacing:.5px; }
  .essence cite { display:block; margin-top:6px; font-style:normal; font-size:11px; color:var(--rx-tertiary); letter-spacing:1px; }
  .lead, .intro { color:var(--rx-secondary); font-size:12.5px; line-height:1.95; margin:14px 0 0; }
  .figure { position:relative; margin:22px auto 18px; width:180px; height:150px; display:grid; place-items:center; }
  .figure::before, .figure::after { content:''; position:absolute; border-radius:50%; border:1px solid ${elC}55; }
  .figure::before { width:146px; height:146px; } .figure::after { width:112px; height:112px; border-style:dashed; opacity:.5; }
  .figure img { position:relative; width:104px; height:104px; object-fit:contain; filter:drop-shadow(0 0 18px ${elC}88); }
  .pull { margin:14px 0; padding:12px 14px; border-left:3px solid var(--el); background:${elC}14; border-radius:0 8px 8px 0; color:var(--rx-primary); font-size:13px; line-height:1.9; }
  .pull.caution { border-left-color:var(--rx-gold); background:rgba(201,168,96,.07); }
  .axis { color:var(--el-t); font-size:12.5px; font-weight:600; letter-spacing:1px; margin:16px 0 8px; }
  .tags { display:flex; flex-wrap:wrap; gap:6px; }
  .tag { font-size:10.5px; color:var(--el-t); border:1px solid ${elC}66; background:${elC}1f; border-radius:12px; padding:4px 10px; letter-spacing:.3px; }
  [data-preview-only][hidden] { display:none !important; }
  /* タイプ別レポート（結果ページの統一CTAと同じ構成：小見出し → 見出し → 説明 → ご利用いただける内容 → 価格 → ボタン） */
  .report { background:linear-gradient(135deg, ${elC}1c, #08101a); border:1px solid ${elC}45; border-radius:14px; padding:26px 22px; text-align:center; margin-top:14px; }
  .report .r-k { font-size:10px; color:#c0a860; letter-spacing:2px; margin-bottom:10px; }
  .report h3 { color:var(--rx-primary); font-size:17px; margin:0 0 10px; letter-spacing:1px; line-height:1.6; }
  .report .r-desc { color:var(--rx-secondary); font-size:12px; line-height:1.85; margin:0 0 18px; }
  .report .r-list { background:var(--card); border:1px solid ${elC}30; border-radius:10px; padding:18px; margin-bottom:20px; text-align:left; }
  .report .r-lh { font-size:11px; color:var(--rx-gold); letter-spacing:2px; margin-bottom:14px; }
  .ck { display:flex; gap:10px; margin-bottom:12px; align-items:flex-start; }
  .ck:last-child { margin-bottom:0; }
  .ck-m { color:var(--rx-gold); font-size:13px; flex-shrink:0; margin-top:1px; }
  .ck-t { color:var(--rx-primary); font-size:13px; font-weight:600; margin-bottom:3px; }
  .ck-s { color:var(--rx-tertiary); font-size:11px; line-height:1.6; }
  .report .r-price { font-size:28px; font-weight:700; color:#eee0c0; margin-bottom:16px; line-height:1.3; }
  .report .r-price small { font-size:12px; font-weight:400; margin-left:4px; color:var(--rx-secondary); }
  .r-btn, .confirm button { font-family:inherit; }
  .report .r-btn { width:100%; background:linear-gradient(90deg, ${elC}, ${wC}); border:none; color:#fff; border-radius:8px; padding:14px; min-height:48px; font-size:14px; cursor:pointer; letter-spacing:2px; font-weight:600; }
  .report .r-diff { color:#c0a860; font-size:11px; margin-top:8px; font-weight:600; line-height:1.7; }
  .report .r-diff2 { color:var(--rx-tertiary); font-size:11px; line-height:1.7; margin-top:4px; }
  dialog.confirm { margin:auto; width:min(92vw, 420px); border:1px solid ${elC}45; border-radius:14px; background:#0c0a14; color:var(--rx-primary); padding:22px 20px 16px; }
  dialog.confirm::backdrop { background:rgba(4,4,10,.76); }
  .confirm .c-label { font-size:10px; font-weight:400; color:#c0a860; letter-spacing:2px; }
  .confirm h3 { font-size:17px; line-height:1.6; margin:6px 0 12px; letter-spacing:1px; }
  .confirm dl { display:grid; grid-template-columns:5.5em 1fr; gap:6px 10px; font-size:12.5px; margin-bottom:12px; }
  .confirm dt { color:var(--rx-tertiary); } .confirm dd { color:var(--rx-primary); }
  .confirm .c-sub { font-size:11px; color:var(--rx-gold); letter-spacing:2px; }
  .confirm ul { margin:6px 0 12px 1.2em; font-size:12.5px; color:var(--rx-secondary); line-height:1.85; }
  .confirm .c-note { font-size:11px; color:#e8d6a8; background:#2a2418; border-radius:8px; padding:8px 10px; line-height:1.7; margin-bottom:12px; }
  .confirm .c-row { display:flex; gap:8px; }
  .confirm button { flex:1; min-height:46px; border-radius:8px; font-size:13px; letter-spacing:1.5px; cursor:pointer; }
  .confirm .c-close { background:transparent; color:var(--rx-primary); border:1px solid var(--card-line); }
  .confirm .c-go { background:#1c1a28; color:var(--rx-muted); border:0; cursor:not-allowed; }
  .back { display:block; text-align:center; margin-top:14px; color:var(--rx-secondary); font-size:12.5px; min-height:44px; padding-top:10px; }
  .more { margin-top:22px; }
  .more .more-h { font-size:11px; color:var(--rx-gold); letter-spacing:2px; margin:0 4px 8px; font-weight:400; }
  .more ul { list-style:none; background:var(--card); border:1px solid var(--card-line); border-radius:12px; overflow:hidden; }
  .more li + li { border-top:1px solid var(--card-line); }
  .more li a { display:grid; grid-template-columns:4.2em 1fr auto; align-items:center; gap:8px; min-height:48px; padding:8px 16px; text-decoration:none; font-size:13px; }
  .sib-w { color:var(--rx-tertiary); font-size:11.5px; }
  .sib-n { font-weight:700; color:var(--rx-primary); letter-spacing:1px; }
  .sib-c { color:var(--el-t); font-size:11px; letter-spacing:2px; }
  .more .jg { margin:16px 4px 0; font-size:12px; color:var(--rx-tertiary); }
  .more .jg a { color:#d8b0e8; }
  @media (max-width:360px) { .el-w { font-size:26px; } h1 .h1-n { font-size:30px; } .hero-em { width:64px; height:64px; } }
</style>
</head>
<body data-type-code="${code}" data-element="${el.slug}" data-weapon-type="${wp.slug}">
  <nav class="crumb" aria-label="現在地"><a href="${listHref}" data-types-back="${el.slug}">全35タイプ一覧</a> ／ ${el.name} × ${wp.name}</nav>
  <div class="eyebrow">元素診断タイプ解説</div>
  <header class="hero">
   <img class="hero-em" src="${emblem}" width="76" height="76" alt="${el.name}の紋章">
   <div class="hero-k">タ イ プ 解 説</div>
  <div class="el-w"><span class="e">${el.name}</span><span class="x">×</span><span class="w">${wp.name}</span></div>
  <h1><span class="h1-sub">${el.name}×${wp.name}タイプ「</span><span class="h1-n">${name}</span><span class="h1-sub">」</span></h1>
  <div class="code">タイプコード：${code}</div>
  <a class="hero-buy" href="#report" data-preview-only hidden>${name}のタイプ別レポートを読む<span class="arw" aria-hidden="true">→</span></a>
  </header>

  <section class="essence" aria-label="${name}の核">
    <div class="k">${name.split('').join(' ')} と は</div>
    <p class="core">${essence}</p>
    <cite>— ${el.name} × ${wp.name}「${name}」</cite>${lead}
    <p class="intro"><strong style="color:var(--rx-primary)">${name}</strong>は、<strong style="color:var(--el-t)">${el.name}の気質（${EL_META[el.name].axis}）</strong>と、<strong style="color:var(--wp-t)">${wp.name}の関わり方（${WP_META[wp.name].style}）</strong>が重なって現れるタイプです。${d.combineText}</p>
  </section>

  <div class="figure" aria-hidden="true"><img src="${emblem}" width="104" height="104" alt="" loading="lazy"></div>

  <section class="card" aria-labelledby="ch-el">
    <div class="kicker">${el.name}の気質</div>
    <div class="card-h"><h2 id="ch-el">${EL_META[el.name].axis}</h2></div>${p(lead1(E.head, el.name, elT))}${q(E.quote)}${p(E.tail)}
  </section>

  <section class="card" aria-labelledby="ch-wp" style="--el:${wC}">
    <div class="kicker">${wp.name}の関わり方</div>
    <div class="card-h"><h2 id="ch-wp">${WP_META[wp.name].principle}</h2></div>${p(lead1(W.head, wp.name, wT))}${q(W.quote)}${p(W.tail)}
  </section>

  <section class="card" aria-labelledby="ch-type">
    <div class="kicker">${name}として現れる特徴</div>
    <div class="card-h"><h2 id="ch-type">強みと、つまずきやすいところ</h2></div>
    <h3>力を発揮するとき</h3>
    <p>${strength}</p>${caution ? `
    <h3>つまずきやすいところ</h3>
    <blockquote class="pull caution">${caution}</blockquote>` : ''}
    <div class="axis">${d.axis}</div>
    <div class="tags">${d.tags.map((t) => `<span class="tag">${t}</span>`).join('')}</div>
  </section>

  <section class="prof" data-preview-only hidden aria-label="タイプ別レポート">
    <div class="report" id="report">
      <div class="r-k">TYPE REPORT</div>
      <h3>タイプ別レポート<br>「${name}」の全編を解放</h3>
      <p class="r-desc">標準プロフィールをもとに、${name}の強みを活かせる場面、つまずきやすい場面、人との関わり方を読み解きます。</p>
      <div class="r-list">
        <div class="r-lh">ご利用いただける内容</div>
${check}
      </div>
      <div class="r-price">¥1,000<small>（税込）</small></div>
      <button type="button" class="r-btn" data-report-open>今すぐアクセス →</button>
      <p class="r-diff">✓ ${name}の方に共通の読み物です。</p>
      <p class="r-diff2">あなた自身の回答から作る「解析レポート」とは別の商品です。</p>
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
