// report-46p.js — 承認済み46ページデザイン（core1_complete_report_v4_revised_46p.html）のテンプレート。
// 【サーバー用 Web 版・2026-10-08】prototypes/core1_v4_result_driven の同名ファイルを複製し、Web 閲覧用に次だけを変えた：
//   ・script（viewer.js）・noscript・操作ボタンを外し、静的な目次（ページ内リンク）と説明文に置き換えた
//   ・CSP の meta を入れた（default-src 'none'。画像は data: だけ、script・接続・フォーム・iframe は不可）
//   ・ID（session_id）・生成日・answers_hash を HTML に出さない（生成日時などは DB のメタデータ側に持つ）
//   ・同じ画像を2回埋め込まない（画像は CSS のカスタムプロパティへ1回だけ入れ、背景として参照する）
//   ・viewer.css の代わりに web.css（840px 未満では A4 の紙面全体を画面幅に合わせて縮小表示する。紙面の余白も調整）
//   本文・数値・ページ構成・画像は変えていない。
// 入力は build-claims.js の view model だけ。ここでは計算しない（表示用の丸め・並べ替えもしない）。
// 本文（narrative）と根拠（evidence：数値・差・版）を別の要素に置く。
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const TOTAL = 46;
// Web 版の Content-Security-Policy（外部の読み込み・script・接続・フォーム・iframe を許さない）
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
const E = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad = (n) => String(n).padStart(2, '0');

// ---------- asset registry：カテゴリID → 承認済み画像（表紙と詳細ページで同じファイル） ----------
const ASSET_DIR = { element: 'elements', weapon: 'weapons', nation: 'nations' };
const assetCache = {};
function assetUri(kind, id) {
  const k = kind + ':' + id;
  if (!assetCache[k]) {
    const p = path.join(ROOT, 'assets', ASSET_DIR[kind], id + '.jpg');
    if (!fs.existsSync(p)) { const e = new Error(`STOP: missing approved image ${kind}/${id}`); e.stop = 12; throw e; }
    assetCache[k] = { uri: 'data:image/jpeg;base64,' + fs.readFileSync(p).toString('base64'), file: path.relative(ROOT, p) };
  }
  return assetCache[k];
}
// 主元素の色（気質の色）。武器の補助色・国家の金はテーマ変数で切り替える
const EL_PALETTE = {
  '炎': ['#b8502e', '#e37551', '#f2a888', '#fcd2bd'], '水': ['#2a7aaa', '#4da0d3', '#76b6dd', '#aadefd'], '氷': ['#5a86b4', '#8ab4dc', '#bcd6ee', '#e0eefa'],
  '雷': ['#8a4cc4', '#b976ef', '#d6b0f6', '#ecd8fc'], '風': ['#2f8a5c', '#57b885', '#98dcb8', '#c8f0dc'], '岩': ['#9a7430', '#ca9f51', '#e6c88c', '#f6e2bc'],
  '草': ['#4a8a1c', '#6dbd2f', '#a6dc78', '#d2f0b4'],
};

function render(vm, K) {
  // Web 版：同じ画像を2回埋め込まない。画像ごとに CSS のカスタムプロパティ（--img-N）へ1回だけ data: で入れ、
  // 表紙と詳細ページはそれを背景として参照する（role="img"・aria-label で代替文字を持つ）。
  const IMG_VARS = new Map();
  const imgEl = (img, alt) => {
    if (!IMG_VARS.has(img.file)) IMG_VARS.set(img.file, { n: IMG_VARS.size + 1, uri: img.uri });
    return `<span class="img" role="img" aria-label="${alt}" data-asset="${img.file}" style="background-image:var(--img-${IMG_VARS.get(img.file).n})"></span>`;
  };
  const S = vm.snap, AX = K.axes.axes;
  const LAYER = {}; Object.keys(S.axes.personality).forEach((a) => { LAYER[a] = 'P'; }); Object.keys(S.axes.style).forEach((a) => { LAYER[a] = 'S'; }); Object.keys(S.axes.values).forEach((a) => { LAYER[a] = 'V'; });
  const v = (a) => S.axes[{ P: 'personality', S: 'style', V: 'values' }[LAYER[a]]][a];
  const NAME = (a) => AX[a].name;
  const COLOR = { element: (k) => K.elements.items[k].visual.color, weapon: (k) => K.weapons.items[k].visual.color, nation: (k) => K.nations.items[k].visual.color };
  const ITEM = { element: (k) => K.elements.items[k], weapon: (k) => K.weapons.items[k], nation: (k) => K.nations.items[k] };
  const CH_EL = { '炎': '#e37551', '水': '#4da0d3', '氷': '#8ab4dc', '雷': '#b976ef', '風': '#57b885', '岩': '#ca9f51', '草': '#6dbd2f' };
  const TITLES = {};
  const versions = `${S.versions.diagnosis} · ${S.versions.items.replace('ETI-', '')} · ${S.versions.scoring.replace('ETI-', '')} · ${S.versions.translation.replace('ETI-', '')} · ${S.versions.characters.replace('ETI-', '')} · ${S.versions.mirror.replace('ETI-', '')}`;
  const top = vm.top;

  function page(n, kind, theme, titleHtml, body, o = {}) {
    TITLES[n] = o.toc || titleHtml.replace(/<[^>]+>/g, '') || o.kicker;
    const head = o.head === false ? '' : `<header class="p-head">
      <span class="p-num">${pad(n)}</span>
      <div class="p-titles"><div class="p-kicker">${o.kicker || ''}</div><h2 class="p-title">${titleHtml}</h2></div>
      <span class="p-sub">${o.sub || ''}</span>
    </header>`;
    return `
<section class="page ${kind} ${theme}" id="p${pad(n)}" data-page="${n}" aria-label="P${pad(n)}"${o.style ? ` style="${o.style}"` : ''}>
  <div class="page-inner">
    ${head}
    ${body}
  </div>
  <footer class="p-foot"><span>ELEMENT DIAGNOSIS · CORE I 完全解析レポート</span><span class="p-map">${o.kicker || ''}</span><span class="p-count">${pad(n)} / ${TOTAL}</span></footer>
</section>`;
  }
  // 両極バー。bare=true は軸辞典用（見出しを持たない1行バー。コード・項目名・数値はカード見出しの1回だけ）
  function poleBar(a, o = {}) {
    const val = v(a), [lo, hi] = AX[a].poles;
    const label = AX[a].word ? `${NAME(a)}｜${AX[a].word}` : NAME(a);
    const left = Math.min(50, val), width = Math.abs(val - 50), sd = val >= 50 ? 'hi' : 'lo';
    const track = `<span class="pp lo">${E(lo)}</span>
      <span class="ptrack"><span class="pfill ${sd}" style="left:${left}%;width:${width}%"></span><span class="pdot" style="left:${val}%"></span></span>
      <span class="pp hi">${E(hi)}</span>`;
    if (o.bare) return `<div class="pole bare">${track}</div>`;
    return `<div class="pole${o.compact ? ' compact' : ''}${o.core ? ' core' : ''}${o.support ? ' support' : ''}">
      <span class="pc">${a}</span><span class="pl">${E(label)}</span>${track}<span class="pv">${val}</span></div>`;
  }
  function miniBar(a, o = {}) {
    const c = { P: 'var(--el-l1)', S: 'var(--st-l)', V: 'var(--va)' }[LAYER[a]];
    return `<div class="mb${o.core ? ' core' : ''}${o.support ? ' support' : ''}" style="--c:${c}"><span class="mb-c">${a}</span><span class="mb-n">${NAME(a)}</span><span class="mb-t"><span style="width:${v(a)}%"></span></span><span class="mb-v">${v(a)}</span></div>`;
  }
  function rankRows(kind, rows) {
    return rows.map((r) => {
      const tier = { top: 'top', middle: 'mid', bottom: 'low' }[r.band], c = COLOR[kind](r.key), it = ITEM[kind](r.key);
      return `<div class="rank-row tier-${tier}">
        <span class="rk">${pad(r.rank)}</span><span class="rn" style="--c:${c}">${E(r.name)}</span><span class="rs">${E(it.short_theme)}</span>
        <span class="rv">${r.display}</span><span class="rd">${E(it.one_liner)}</span>
        <span class="rbar"><span style="width:${r.display}%;--c:${c}"></span></span></div>`;
    }).join('\n');
  }
  const meta = (c) => `<span class="ch-meta"><i style="--c:${CH_EL[c.element] || '#888'}">${c.element}</i><i>${c.weapon}</i><i>${c.region || '—'}</i></span>`;
  const mirNames = new Set(S.mirror.top10.map((r) => r.name));
  function charRows(rows, cls, lines, mark) {
    return rows.map((r) => {
      const m = mark && !mirNames.has(r.name) ? `<span class="new-tag">${mark}</span>` : '';
      const sel = cls === 'mi' && r.selected ? '<span class="new-tag sel">MIRROR</span>' : '';
      return `<div class="ch-row ${cls}${r.rank <= 3 ? ' ch-top' : ''}">
        <span class="ch-rk">${pad(r.rank)}</span>
        <span class="ch-name" style="--c:${CH_EL[r.element] || '#888'}">${E(r.name)}<b class="ch-sc">${r.display}</b>${m}${sel}</span>
        ${meta(r)}
        <span class="ch-why">${E(lines[r.name])}</span></div>`;
    }).join('\n');
  }
  const side = (blocks) => blocks.map(([k, b, c]) => `<div class="sp-block${c ? ' ' + c : ''}"><div class="sp-k">${k}</div>${b}</div>`).join('\n');
  const ev = (txt) => `<span class="ev">${txt}</span>`;
  const P = {};

  // ================= P01 表紙 =================
  const cov = vm.cover, img = assetUri('element', cov.image);
  P[1] = page(1, 'cover-page', 't-personality', '', `
    <div class="cover-ring cover-img">${imgEl(img, `${E(top.element.name)}の紋章`)}</div>
    <div class="cover-body">
      <div class="cover-label">${cov.label}</div>
      <h1 class="cover-title">${cov.title}</h1>
      <div class="cover-code">${cov.code}</div>
      <div class="cover-type">${cov.name}</div>
      <div class="cover-combo"><span class="c-el">${E(cov.combo[0])}</span><b>×</b><span class="c-st">${E(cov.combo[1])}</span><b>×</b><span class="c-va">${E(cov.combo[2])}</span></div>
    </div>
    <div class="cover-meta">
      <div>MODEL　${versions}</div>
      <div>${E(S.display_name)}　｜　${S.diagnosed_at.slice(0, 10)}　｜　46 ページ</div>
    </div>`, { head: false, kicker: 'COVER', toc: '表紙', style: `--cv1:${cov.bg[0]};--cv2:${cov.bg[1]};--cvg:${cov.bg[2]}` });

  // ================= P02 読み方（固定。版だけ動的） =================
  P[2] = page(2, 'guide-page', 't-neutral', 'このレポートの読み方', `
    <p class="lead">結果名を眺めるためではなく、<strong>同じ100問の結果の中で、気質・スタイル・価値観・人物像がなぜこのように結びついているのか</strong>を読むためのレポートです。三つの層は同じ性格の言い換えではなく、それぞれ別の質問に答えています。</p>
    <div class="layer-grid">
      <div class="layer-card t-personality"><div class="lc-k">ELEMENT · PERSONALITY</div><div class="lc-t">元素 ＝ 気質</div>
        <div class="lc-q">刺激を受けた時、最初に何が起こるか。</div><p>開放性・誠実性・外向性・協調性・情動反応性の5軸から読みます。7元素は、5軸の組み合わせの傾きを比喩で表したものです。</p></div>
      <div class="layer-card t-style"><div class="lc-k">WEAPON · STYLE</div><div class="lc-t">武器種 ＝ スタイル</div>
        <div class="lc-q">人や課題との距離を、どう取るか。</div><p>主導性・関係調整・役割持続・媒介思考・自律距離の5軸から読みます。武器種は力の使い方であり、動機ではありません。</p></div>
      <div class="layer-card t-values"><div class="lc-k">NATION · VALUES</div><div class="lc-t">国家 ＝ 価値観</div>
        <div class="lc-q">迷った時、何を守り、何を選ぶか。</div><p>自己方向から普遍主義までの10軸から読みます。国家は所属の診断ではなく、選択の基準の翻訳です。</p></div>
    </div>
    <h3 class="h3">三つの人物像は、別の問いに答える</h3>
    <div class="lens-grid">
      <div class="lens t-mirror"><div class="ln-k">LENS 01 · 今の近さ</div><div class="ln-t">MIRROR</div><p>20軸の<b>絶対的な近さ</b>。今の自分に近い人物。</p><div class="ln-use">自己理解の言葉</div></div>
      <div class="lens t-hidden"><div class="ln-k">LENS 02 · 山谷の形</div><div class="ln-t">HIDDEN SHAPE</div><p>強さの大小を外した<b>山谷の形</b>が似ている人物。</p><div class="ln-use">目立ちにくい構造</div></div>
      <div class="lens t-mentor"><div class="ln-k">LENS 03 · 選んだ方向</div><div class="ln-t">MENTOR</div><p>核を保ち、<b>本人が選んだ方向へ少し広げた座標</b>に近い人物。</p><div class="ln-use">借りられる振る舞い</div></div>
    </div>
    <div class="guide-split">
      <div>
        <h3 class="h3">数値を読む前の五つの約束</h3>
        <ol class="rules">
          <li><b>0〜100は尺度上の位置です。</b>人口パーセンタイルではありません。「上位○割の人より高い」とは読みません。</li>
          <li><b>上位＝優れている、下位＝悪い、ではありません。</b>上位は今の回答に近い型、下位は離れている型です。</li>
          <li><b>低い資質と弱みは別物です。</b>弱みとは、成果・健全さ・関係性を妨げている状態を指します。</li>
          <li><b>人物像は類似度です。</b>確率でも、その人物と同一という意味でもありません。</li>
          <li><b>医療・心理の診断ではありません。</b>自己理解のための構造的な読み物です。</li>
        </ol>
      </div>
      <div>
        <h3 class="h3">数値の見方</h3>
        <div class="sample-pole">${poleBar('O')}</div>
        <p class="small">中央の50から、どちらの極へどれだけ寄っているかを表します。両端の言葉は、設問の内容に沿った傾向の名前です。</p>
        <h3 class="h3">このレポートの読み順</h3>
        <div class="flow"><span>把握</span><span>比較</span><span>理解</span><span>統合</span><span>陰影</span><span>貢献</span><span>再読</span></div>
        <p class="small">全順位で全体を把握し、人物像で比較し、上位資質を理解します。三層を統合した後、中位・下位と弱みの陰影へ進み、貢献の形と辞典で締めくくります。</p>
      </div>
    </div>
    <div class="boundary">
      <div><b>CORE I が扱うもの</b><p>現在の構造。数値・順位・差・両極、三層の関係、強みとして働く条件、過剰使用と使われにくい場面、再読のための観察点。</p></div>
      <div><b>CORE I が扱わないもの</b><p>これからの成長課題、進むべき職業や役割、長期の計画。それらは次の段階のレポートで扱い、ここでは命令や処方を書きません。</p></div>
    </div>
    <div class="color-key">
      <div class="ck-head">このレポートの色</div>
      <div class="ck" style="--c:var(--el-l1)"><b>気質</b><span>主元素の色。今回は${E(top.element.name)}</span></div>
      <div class="ck" style="--c:var(--st-l)"><b>スタイル</b><span>武器の補助色</span></div>
      <div class="ck" style="--c:var(--va)"><b>価値観</b><span>国家を表す金</span></div>
      <div class="ck" style="--c:var(--mi)"><b>MIRROR</b><span>今の近さ</span></div>
      <div class="ck" style="--c:var(--hs-l)"><b>HIDDEN SHAPE</b><span>山谷の形</span></div>
      <div class="ck" style="--c:var(--me)"><b>MENTOR</b><span>選んだ方向</span></div>
      <div class="ck" style="--c:var(--warn-l)"><b>注意</b><span>過剰使用・摩擦</span></div>
    </div>`, { kicker: 'REPORT GUIDE', sub: 'How to read', toc: 'このレポートの読み方' });

  // ================= P03 あなたの核 =================
  const p3 = vm.p03;
  const gapOf = (rows) => rows[0].display - rows[1].display;
  const epRow = (theme, k, rows, kind) => `<div class="ep-row ${theme}"><div class="ep-k">${k}</div><div class="ep-v"><b>${E(rows[0].name)}</b><span>${vm.flat && kind === 'nation' ? '—' : rows[0].display}</span></div><div class="ep-s">${vm.flat && kind === 'nation' ? '価値の並びが平坦なため判定なし' : `2位 ${E(rows[1].name)} ${rows[1].display} ／ 差 ${gapOf(rows)}`}</div></div>`;
  P[3] = page(3, 'portrait-page', 't-neutral', 'あなたの核 — Executive Portrait', `
    <p class="lead">順位を見る前に、全体像を一枚で。<strong>この後の43ページは、ここに書いたことを、数値と具体例で確かめていく構成です。</strong></p>
    <div class="ep-grid">
      <aside class="ep-data">
        ${epRow('t-personality', '気質 · PERSONALITY', S.rankings.element, 'element')}
        ${epRow('t-style', 'スタイル · STYLE', S.rankings.weapon, 'weapon')}
        ${epRow('t-values', '価値観 · VALUES', S.rankings.nation, 'nation')}
        <div class="ep-ax"><div class="ep-k">20軸の山（根拠）</div><div>${miniBar(vm.highs[0])}${miniBar(vm.highs[1])}</div>
          <div class="ep-k" style="margin-top:1.6mm">20軸の谷（根拠）</div><div>${miniBar(vm.lows[0])}${miniBar(vm.lows[1])}</div></div>
        <div class="ep-mirror t-mirror"><div class="ep-k">MIRROR</div><div class="ep-v"><b>${E(p3.mirror.name)}</b></div><div class="ep-s">${E(p3.mirror.line)}</div></div>
      </aside>
      <div class="ep-story">
        <div class="ep-name">${E(vm.typeName)}<span>${vm.typeCode}</span></div>
        ${p3.story.map((s) => `<p>${s}</p>`).join('')}
        <div class="quote-band">${E(p3.quote)}</div>
      </div>
    </div>
    <div class="ep-map"><div class="sp-k">この後の読み方</div>
      <div class="em-row"><span><b>把握・比較</b>P04–P09<i>全順位と三つの人物像</i></span><span><b>理解</b>P10–P21<i>上位資質を一つずつ</i></span><span><b>統合</b>P22–P28<i>三層と人物像の交わり</i></span><span><b>陰影・貢献</b>P29–P35<i>中位・下位・弱み・ドメイン</i></span><span><b>再読</b>P36–P46<i>観察・コンパス・辞典</i></span></div></div>
    <div class="ep-three">
      <div class="ep-col"><div class="ep-ct">三つの強い事実</div><ol>${p3.facts.map((f) => `<li>${f.text}${ev(f.ev)}</li>`).join('')}</ol></div>
      <div class="ep-col warn"><div class="ep-ct">${vm.tensionHeading}</div><ol>${vm.tensions.map((t) => `<li><span class="tk ${t.type}">${t.type === 'tension' ? '緊張' : '並存'}</span>${t.text}${ev(t.axes.map((a) => `${NAME(a)}${v(a)}`).join('／'))}</li>`).join('')}</ol></div>
      <div class="ep-col q"><div class="ep-ct">一つの読み進める問い</div>
        <p class="ep-q">${E(vm.question)}</p></div>
    </div>`, { kicker: 'EXECUTIVE PORTRAIT', sub: 'The core', toc: 'あなたの核' });

  // ================= P04–P06 全体順位 =================
  function overview(n, kind, theme, kicker, title, label, bandTitle, toc, bandCls) {
    const o = vm.overview[kind], rows = o.rows;
    const flatN = kind === 'nation' && vm.flat;
    const bars = kind === 'nation' ? '<div class="pole-cols">' + o.layerAxes.map((a) => poleBar(a, { compact: true })).join('\n') + '</div>' : o.layerAxes.map((a) => poleBar(a)).join('\n');
    const sd = o.side;
    return page(n, 'overview-page', theme, title, `
    <p class="lead">${o.lead}</p>
    <div class="ov-grid">
      <div class="ov-main">
        <div class="ov-label">${label}<span class="legend"><i class="lg-top">上位</i>${kind === 'weapon' ? '' : '<i class="lg-mid">中位</i>'}<i class="lg-low">下位</i></span></div>
        <div class="rank-list">${rankRows(kind, rows)}</div>
        <div class="gap-box"><span class="gap-state">1位−2位</span><span class="gap-num">${flatN ? '全国家が同じ近さ' : `${E(rows[0].name)} ${rows[0].display} − ${E(rows[1].name)} ${rows[1].display} ＝ <b>${gapOf(rows)}</b>`}</span></div>
        ${o.pairNote ? `<div class="pair-note"><div class="pn-k">差が小さいことが意味すること</div><p>${o.pairNote}</p></div>` : ''}
      </div>
      <aside class="ov-side">${side([
        [{ element: '元素とは', weapon: '武器種とは', nation: '国家とは' }[kind], `<p>${sd.what}</p>`, ''],
        ['上位3', `<p>${sd.top3.map((t) => `<b${kind === 'element' ? ` class="ce-${t.name}"` : ''}>${E(t.name)}</b> ${E(t.theme)}`).join('／')}</p>`, ''],
        ['下位', `<p>${sd.low}</p>`, ''],
        ['すでに使っている強み', `<p>${sd.strength}</p>`, ''],
        ['過剰使用のサイン', `<p>${sd.over}</p>`, 'warn'],
        ['活かし方', `<ul>${sd.use.map((u) => `<li>${u}</li>`).join('')}</ul>`, 'use']])}</aside>
    </div>
    <div class="axis-band ${bandCls || ''}">
      <div class="band-head">${bandTitle}</div>
      ${bars}
      <p class="band-note">${o.bandNote}</p>
    </div>`, { kicker, sub: 'Overview', toc });
  }
  P[4] = overview(4, 'element', 't-personality', 'OVERVIEW · ELEMENT', '元素（気質）の全体順位', '7元素のプロフィールスコア（/100）', 'PERSONALITY　気質を作る5軸', '元素の全体順位');
  P[5] = overview(5, 'weapon', 't-style', 'OVERVIEW · WEAPON', '武器種（スタイル）の全体順位', '5武器種のプロフィールスコア（/100）', 'STYLE　スタイルを作る5軸', '武器種の全体順位');
  P[6] = overview(6, 'nation', 't-values', 'OVERVIEW · NATION', '国家（価値観）の全体順位', '8国家のプロフィールスコア（/100）', 'VALUES　価値観を作る10軸', '国家の全体順位', 'values-band');

  // ================= P07–P09 人物像 TOP10 =================
  const M10 = S.mirror.top10, H10 = S.hidden.top10, T10 = S.mentor.top10;
  P[7] = page(7, 'character-ranking-page', 't-mirror', 'MIRROR TOP10', `
    <div class="def-band"><span class="def-k">DEFINITION</span><p><b>MIRRORは、今のあなたの20軸と、118名の人物座標との絶対的な近さです。</b>PERSONALITY・STYLE・VALUESを4：3：3で統合します。キャラクター本人と同一であるという意味でも、そうなる確率でもありません。</p></div>
    <div class="cr-grid">
      <div class="cr-list">${charRows(M10, 'mi', vm.lines.mirror)}</div>
      <aside class="cr-side">
        <div class="sp-block"><div class="sp-k">この順位の読み方</div><p>今の数値の高さと配置を、そのまま映す人物像です。各行の一文は、ETI人物座標（ETI-CHAR-2.1.0）と資料タグから作った説明で、原作人物の全人格を断定するものではありません。${vm.p07.selectedNote ? vm.p07.selectedNote : ''}</p></div>
        <div class="sp-block"><div class="sp-k">10人に反復するテーマ</div><p>${vm.p07.theme}</p></div>
        <div class="sp-block warn"><div class="sp-k">同じではない</div><p>一致する構造を借りて、自分を別の言葉で理解するための比較です。人物の物語や運命を重ねるものではありません。</p></div>
      </aside>
    </div>
    <div class="top3-grid">${vm.p07.top3.map((x) => `<div class="t3"><div class="t3-h"><span>${pad(x.r.rank)}</span>${E(x.r.name)}</div><p>${x.text}</p></div>`).join('')}</div>
    <div class="read-steps">
      <div class="rstep"><b><span>1</span>共通点を一つ選ぶ</b><p>上位3名のうち一人について、「自分にもある構造」を一つだけ言葉にします。</p></div>
      <div class="rstep"><b><span>2</span>違いを一つ見つける</b><p>似ていない点も一つ挙げます。違いが、あなた固有の輪郭を照らします。</p></div>
      <div class="rstep"><b><span>3</span>自分の言葉で書き直す</b><p>人物の名前を外し、その構造を自分の日常の一場面で説明し直します。</p></div>
    </div>`, { kicker: 'MIRROR', sub: 'Self-understanding', toc: 'MIRROR TOP10' });

  P[8] = page(8, 'character-ranking-page', 't-hidden', 'HIDDEN SHAPE TOP10', `
    <div class="def-band"><span class="def-k">DEFINITION</span><p><b>HIDDEN SHAPEとは、現在の数値の高さそのものではなく、PERSONALITY・STYLE・VALUESそれぞれの領域で、何が相対的に高く、何が相対的に低いかという山谷の形が近い人物です。</b></p></div>
    <div class="vs-row">
      <div class="vs t-mirror"><div class="vs-k">MIRROR</div><p>20軸の<b>絶対的な近さ</b>。高さも配置も含めて比べる。</p></div>
      <div class="vs-arrow">≠</div>
      <div class="vs t-hidden"><div class="vs-k">HIDDEN SHAPE</div><p>絶対的な強度を外した<b>相対配置の近さ</b>。どこが山でどこが谷かだけを比べる。</p></div>
    </div>
    <div class="cr-grid">
      <div class="cr-list">${charRows(H10, 'hs', vm.lines.hidden, '形で現れる')}</div>
      <aside class="cr-side">
        <div class="sp-block"><div class="sp-k">MIRRORとの違い</div><p>${vm.p08.diffNote}</p></div>
        <div class="sp-block"><div class="sp-k">浮かび上がる形</div><p>${vm.p08.shape}</p></div>
        <div class="sp-block"><div class="sp-k">このモデルについて</div><p class="small">${S.hidden.model}。各領域の山谷の形の近さを4：3：3で合わせたETI内部の形状類似モデルで、独立に検証された心理尺度ではありません。</p></div>
      </aside>
    </div>
    <div class="top3-grid">${vm.p08.top3.map((x) => `<div class="t3"><div class="t3-h"><span>${pad(x.r.rank)}</span>${E(x.r.name)}</div><p>${x.text}</p></div>`).join('')}</div>
    <div class="shape-demo">
      <svg viewBox="0 0 240 92" aria-hidden="true">
        <line x1="10" y1="80" x2="232" y2="80" stroke="rgba(143,182,214,.25)"/>
        <polyline points="20,30 60,18 100,52 140,24 180,60 220,36" fill="none" stroke="var(--hs-l)" stroke-width="2"/>
        <polyline points="20,52 60,42 100,72 140,47 180,78 220,58" fill="none" stroke="var(--hs)" stroke-width="2" stroke-dasharray="5 3"/>
        <g fill="var(--hs-l)"><circle cx="20" cy="30" r="2.4"/><circle cx="60" cy="18" r="2.4"/><circle cx="100" cy="52" r="2.4"/><circle cx="140" cy="24" r="2.4"/><circle cx="180" cy="60" r="2.4"/><circle cx="220" cy="36" r="2.4"/></g>
        <text x="226" y="32" text-anchor="end">あなた</text><text x="226" y="90" text-anchor="end">形の近い人物</text>
      </svg>
      <p><b>高さが違っても、山と谷の位置が同じ。</b>MIRRORでは遠く見える人物でも、どこが相対的に高く、どこが低いかが一致していれば、HIDDEN SHAPEでは近くに並びます（図は模式図）。</p>
    </div>`, { kicker: 'HIDDEN SHAPE', sub: 'Overlooked structure', toc: 'HIDDEN SHAPE TOP10' });

  const MENTOR_PLACEHOLDER = (what) => `<div class="mentor-empty"><div class="sp-k">MENTOR は未生成です</div><p><b>目標方向を選ぶと生成されます。</b>MENTORは、あなたが「少し広げたい」と選んだ方向へ一部の軸だけを動かした目標座標に近い人物です。方向は結果から自動では決めません（最下位の軸や低いドメインを課題として扱わないため）。</p><p>${what}</p></div>`;
  if (vm.p09) {
    const p9 = vm.p09;
    const moves = p9.changes.map((c) => { const lo = Math.min(c.before, c.after), w = Math.abs(c.after - c.before); return `<div class="mv"><span class="mv-c">${c.axis}</span><span class="mv-n">${NAME(c.axis)}</span><span class="mv-bar"><span class="from" style="width:${lo}%"></span><span class="to${c.delta < 0 ? ' down' : ''}" style="left:${lo}%;width:${w}%"></span></span><span class="mv-v">${c.before} → <b>${c.after}</b></span></div>`; }).join('');
    P[9] = page(9, 'character-ranking-page', 't-mentor', 'MENTOR TOP10', `
    <div class="def-band"><span class="def-k">DEFINITION</span><p><b>MENTORとは、現在の自分に最も近い人物ではなく、自分の核となる資質を保ちながら、選んだ方向へ少し広げた時に、参考にできる人物です。</b>理想像でも、あなたより上の人物でもありません。現在の類似順位でもありません。選ぶ方向が変われば、TOP10も変わります。</p></div>
    <div class="target-box">
      <div class="tg-head"><span class="tg-k">${p9.selectedBy === 'fixture' ? 'サンプル用の仮の方向' : 'あなたが選んだ方向'}</span><span class="tg-t">${E(p9.goal.label)}</span></div>
      <div class="tg-grid">
        <div class="tg-moves">${moves}</div>
        <div class="tg-keep"><div class="sp-k">保つものと広げるもの</div><p>${p9.keep}</p></div>
      </div>
    </div>
    <div class="cr-grid">
      <div class="cr-list">${charRows(T10, 'me', vm.lines.mentor)}</div>
      <aside class="cr-side">
        <div class="sp-block"><div class="sp-k">上位3名から借りられるもの</div>${p9.top3.map((x) => `<p><b>${E(x.r.name)}</b>：${x.text}</p>`).join('')}</div>
        <div class="sp-block warn"><div class="sp-k">借りるのは一つの技術だけ</div><p>人物の性格や人生を模倣するものではありません。あなたの資質と両立する振る舞いを一つだけ選びます。</p></div>
        <div class="sp-block"><div class="sp-k">方向を変えると</div><p>別の方向を選べば、動かす軸が変わり、参照する人物も入れ替わります。MENTORは固定の順位ではなく、選んだ方向ごとに作られる地図です。</p></div>
      </aside>
    </div>
    <div class="lens-strip">
      <div class="ls t-mirror"><div class="ls-k">MIRROR ── 今の自分に近い</div><p>自己理解の言葉を得る。</p></div>
      <div class="ls t-hidden"><div class="ls-k">HIDDEN SHAPE ── 内側の配置が似る</div><p>数値の高さだけでは目立ちにくかった構造を見る。</p></div>
      <div class="ls t-mentor now"><div class="ls-k">MENTOR ── 核を保って広げる</div><p>借りられる振る舞いを見つける。</p></div>
    </div>`, { kicker: 'MENTOR', sub: 'Borrowable behavior', toc: 'MENTOR TOP10' });
  } else {
    P[9] = page(9, 'character-ranking-page', 't-mentor', 'MENTOR TOP10', `
    <div class="def-band"><span class="def-k">DEFINITION</span><p><b>MENTORとは、現在の自分に最も近い人物ではなく、自分の核となる資質を保ちながら、選んだ方向へ少し広げた時に、参考にできる人物です。</b>理想像でも、あなたより上の人物でもありません。</p></div>
    ${MENTOR_PLACEHOLDER('方向の例：「理解したことを、少し早く外へ示す」「引き受ける範囲と境界を、はっきり示す」「人との関係を、もう一歩深く結ぶ」など。選んだ方向で動かす軸と、保つ軸を明示したうえで、118名から近い人物を並べます。')}
    <div class="lens-strip">
      <div class="ls t-mirror"><div class="ls-k">MIRROR ── 今の自分に近い</div><p>自己理解の言葉を得る。</p></div>
      <div class="ls t-hidden"><div class="ls-k">HIDDEN SHAPE ── 内側の配置が似る</div><p>数値の高さだけでは目立ちにくかった構造を見る。</p></div>
      <div class="ls t-mentor now"><div class="ls-k">MENTOR ── 核を保って広げる</div><p>方向を選ぶと、借りられる振る舞いが見つかる。</p></div>
    </div>`, { kicker: 'MENTOR', sub: 'Borrowable behavior', toc: 'MENTOR TOP10' });
  }

  // ================= P10–P12 上位3の活かし方 =================
  function topOverview(n, kind, theme, kicker, title, toc) {
    const t = vm.topThemes[kind];
    const head = t.rows.map((r) => `<th style="--c:${ITEM[kind](r.key).visual.accent_l}"><span class="to-rk">${pad(r.rank)}</span>${E(r.name)}<small>${r.display}</small></th>`).join('');
    const body = t.table.map((row) => `<tr><th class="to-k${row.cls ? ' ' + row.cls : ''}">${row.label}</th>${row.cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
    return page(n, 'overview-page top-overview', theme, title, `
    <p class="lead">${t.lead}</p>
    <table class="to-table"><thead><tr><th class="to-corner"></th>${head}</tr></thead><tbody>${body}</tbody></table>
    <div class="to-note">${t.note}<span class="ev">根拠：${t.rows.map((r) => `${E(r.name)}${r.display}`).join('・')}／差 ${t.gaps.map((g) => g.display).join('・')}</span></div>`, { kicker, sub: 'Top themes', toc });
  }
  P[10] = topOverview(10, 'element', 't-personality', 'TOP THEMES · ELEMENT', '上位元素の活かし方', '上位元素の活かし方');
  P[11] = topOverview(11, 'weapon', 't-style', 'TOP THEMES · WEAPON', '上位武器種の活かし方', '上位武器種の活かし方');
  P[12] = topOverview(12, 'nation', 't-values', 'TOP THEMES · NATION', '上位国家の活かし方', '上位国家の活かし方');

  // ================= P13–P21 上位資質の詳細 =================
  function detailPage(n, kind, i, layout) {
    const d = vm.details[kind][i], r = d.row, it = d.it;
    const rankTxt = pad(r.rank);
    const gaps = [d.prev ? `上位 ${E(d.prev.name)} ${d.prev.display}　<b>−${d.prev.display - r.display}</b>` : '', d.next ? `次点 ${E(d.next.name)} ${d.next.display}　<b>+${r.display - d.next.display}</b>` : ''].filter(Boolean);
    const layer = { element: 'PERSONALITY', weapon: 'STYLE', nation: 'VALUES' }[kind];
    const KIND = { element: 'ELEMENT', weapon: 'WEAPON', nation: 'NATION' }[kind];
    const im = assetUri(kind, it.visual.image);
    const hero = `<div class="td-hero">
      <div class="td-sym td-img">${imgEl(im, E(r.name))}</div>
      <div class="td-titles"><div class="td-k">${KIND} ${rankTxt} · ${layer}</div><h2 class="td-title">${E(r.name)} <span>— ${E(it.short_theme)}</span></h2><p class="td-poem">${it.poem}</p></div>
      <div class="td-score"><div class="ts-rank">RANK <b>${rankTxt}</b></div><div class="ts-num">${d.flat ? '—' : r.display}<small>/100</small></div>${gaps.map((g) => `<div class="ts-gap">${g}</div>`).join('')}</div>
    </div>`;
    const core = d.core;
    const recs = core.records || [];
    const coreLabel = core.primary ? `<span class="core-note">核（主要一致軸）：${recs[0].core_axis_phrase}${recs.length > 1 ? `　支える軸：${recs.slice(1).map((x) => x.core_axis_phrase).join('・')}` : ''}</span>` : `<span class="core-note soft">${d.flat ? '価値の並びが平坦なため核なし' : '核なし：一本の強い軸ではなく、複数軸の組合せ'}</span>`;
    const chip = (a) => { const isCore = a === core.primary, isSup = core.supporting.includes(a); const rec = (core.records || []).find((x) => x.core_axis_code === a); return `<span class="tc tc-${LAYER[a]}${isCore ? ' core' : ''}${isSup ? ' support' : ''}"><i>${a}</i>${NAME(a)} ${v(a)}${isCore ? '<b>核</b>' : isSup ? '<b class="s">支</b>' : ''}${isCore && rec ? `<em class="pole-tag">${rec.core_axis_pole}</em>` : ''}</span>`; };
    const contrib = `<div class="td-contrib"><span class="tc-k">${kind === 'nation' ? '主な価値（根拠）' : '算出に使う5軸（根拠）'}</span>${d.axes.map(chip).join('')}</div>`;
    const blocks = d.flat ? [['定義', it.definition, ''], ['強く出る時', it.strong, 'opt'], ['誤解しやすい点', it.misread, 'over']]
      : [['自然に出る場面', d.side.scenes, ''], ['周囲からの見え方', d.side.seen, ''], ['最適使用', d.side.optimal, 'opt'], ['過少使用', d.side.under, 'under'], ['過剰使用', d.side.over, 'over']];
    const sideHtml = blocks.map(([k, x, c]) => `<div class="ts-block ${c}"><div class="ts-k">${k}</div><p>${x}</p></div>`).join('');
    const sec = { element: 'あなたの場合 ── 感じ方', weapon: 'あなたの場合 ── 動き方', nation: 'あなたの場合 ── 選び方' }[kind];
    const opt = (a) => ({ core: a === core.primary, support: core.supporting.includes(a) });
    const bars = kind === 'weapon' ? d.axes.map((a) => miniBar(a, opt(a))).join('') : d.axes.map((a) => poleBar(a, opt(a))).join('');
    const body = d.body.map((p) => `<p>${p}</p>`).join('');
    const quote = `<div class="quote-band">${E(it.quote)}</div>`;
    const scene = d.flat ? '' : `<div class="td-scene"><div class="tb-k">ある日の場面（観察候補）</div><p>${d.vignette}</p></div>`;
    const beyond = `<div class="td-beyond"><div class="tb-k">${E(r.name)}だけでは説明できない部分</div><p>${d.beyond}</p></div>`;
    const axesBox = (wide) => `<div class="td-axes${wide ? ' wide' : ''}"><div class="tb-k">${E(r.name)}を形づくる軸${coreLabel}</div>${wide ? `<div class="mb-grid">${bars}</div>` : bars}</div>`;
    let main;
    if (layout === 'a') main = `<div class="td-grid"><div class="td-body"><div class="sec-t">${sec}</div>${body}${quote}${scene}${axesBox(false)}</div><aside class="td-side">${sideHtml}</aside></div>`;
    else if (layout === 'b') main = `<div class="td-cols"><div class="sec-t">${sec}</div><div class="cols2">${body}</div></div><div class="b-qs">${quote}${scene}</div><div class="td-row5">${sideHtml}</div>${axesBox(true)}`;
    else main = `<div class="td-grid c"><aside class="td-side">${sideHtml}</aside><div class="td-body">${quote}<div class="sec-t" style="margin-top:2.6mm">${sec}</div>${body}${scene}${axesBox(false)}</div></div>`;
    const theme = { element: 't-personality', weapon: 't-style', nation: 't-values' }[kind];
    const layerJa = { element: '気質', weapon: 'スタイル', nation: '価値観' }[kind];
    return page(n, `theme-detail-page layout-${layout}`, theme, '', `${hero}${contrib}${main}${beyond}`, { head: false, kicker: `${KIND} ${rankTxt}`,
      style: `--accent:${it.visual.accent};--accent-l:${it.visual.accent_l}`, toc: `${r.name}（${layerJa}）` });
  }
  for (let i = 0; i < 3; i++) {
    P[13 + i] = detailPage(13 + i, 'element', i, 'a');
    P[16 + i] = detailPage(16 + i, 'weapon', i, 'b');
    P[19 + i] = detailPage(19 + i, 'nation', i, 'c');
  }

  // ================= P22–P24 二層の交わり =================
  const pairColor = { element: 'var(--el-l1)', weapon: 'var(--st-l)', nation: 'var(--va)' };
  const pairKicker = { element: '気質', weapon: 'スタイル', nation: '価値観' };
  vm.pairs.forEach((p, i) => {
    const n = 22 + i, ca = pairColor[p.ka], cb = pairColor[p.kb];
    const tone = p.rel === 'tension' ? 'warn' : p.rel === 'conditional' ? 'cond' : '';
    const dash = tone ? ' stroke-dasharray="5 4"' : '';
    const title = { 22: '元素 × 武器種 — 反応をどう使うか', 23: '元素 × 国家 — 反応が何を守るか', 24: '武器種 × 国家 — やり方と価値の一致／緊張' }[n];
    P[n] = page(n, 'integration-page pair-page', 't-neutral', title, `
    <div class="pp-top">
      <div class="pp-card" style="--c:${ca}"><div class="pp-k">${pairKicker[p.ka]} · 1位</div><div class="pp-n">${E(p.a.name)}</div><div class="pp-d">${E(p.aIt.one_liner)}</div></div>
      <div class="pp-link"><svg viewBox="0 0 120 40" aria-hidden="true"><line x1="4" y1="20" x2="116" y2="20" stroke="${ca}" stroke-width="1.6"${dash}/><circle cx="4" cy="20" r="3.5" fill="${ca}"/><circle cx="116" cy="20" r="3.5" fill="${cb}"/></svg><span class="pp-label ${tone}">${p.label}</span></div>
      <div class="pp-card" style="--c:${cb}"><div class="pp-k">${pairKicker[p.kb]} · 1位</div><div class="pp-n">${E(p.b.name)}</div><div class="pp-d">${E(p.bIt.one_liner)}</div></div>
    </div>
    <div class="pp-lead">${p.lead}</div>
    <div class="pp-grid">
      <div class="pp-prose">${p.prose.map((x) => `<p>${x}</p>`).join('')}</div>
      <aside class="pp-side">
        <div class="sp-k">日常の例（観察候補）</div>
        ${p.examples.map((e, k) => `<div class="pp-ex"><span>${k + 1}</span>${e}</div>`).join('')}
        <div class="sp-k" style="margin-top:2.4mm">根拠となる軸</div>
        <div class="pp-ev">${p.evAxes.map((x) => miniBar(x)).join('')}</div>
      </aside>
    </div>
    <div class="pp-cond"><div class="pcd ok"><b>うまく働く時</b><p>${p.cond[0]}</p></div><div class="pcd ng"><b>崩れる時</b><p>${p.cond[1]}</p></div><div class="pcd q"><b>観察の問い</b><p>${p.cond[2]}</p></div></div>
    <div class="pp-second"><div class="ps-k">もう一つの組み合わせ</div><div class="ps-h">${E(p.second.a.name)} × ${E(p.second.b.name)}（それぞれ2位）<em class="pp-label ${p.second.rel === 'tension' ? 'warn' : p.second.rel === 'conditional' ? 'cond' : ''}">${p.second.label}</em></div><p>${p.second.text}</p></div>`,
    { kicker: { 22: 'ELEMENT × WEAPON', 23: 'ELEMENT × NATION', 24: 'WEAPON × NATION' }[n], sub: 'Two layers', toc: { 22: '元素 × 武器種', 23: '元素 × 国家', 24: '武器種 × 国家' }[n] });
  });

  // ================= P25 三層統合 =================
  const q = vm.p25;
  const LC = { P: 'var(--el-l1)', S: 'var(--st-l)', V: 'var(--va)' };
  const pk = (a) => `<div class="pk" style="--c:${LC[LAYER[a]]}"><i>${a} ${NAME(a)}</i><em>${v(a)}</em></div>`;
  const relOf = (k) => vm.pairs[k];
  P[25] = page(25, 'integration-page', 't-neutral', '三層統合 — あなたの存在構造', `
    <p class="lead">元素・武器種・国家を一つの点数に合成せず、二つずつの関係と三つの重なりとして読みます。<strong>受け取り方・動き方・選び方が、どこで一致し、どこで引っ張り合うか</strong>が、この人物像の核です。</p>
    <div class="ig-top">
      <svg class="tri" viewBox="0 0 300 230" aria-hidden="true">
        <defs><radialGradient id="tg" cx="50%" cy="55%" r="50%"><stop offset="0%" stop-color="#e8d8a0" stop-opacity=".35"/><stop offset="100%" stop-color="#e8d8a0" stop-opacity="0"/></radialGradient></defs>
        <circle cx="150" cy="135" r="62" fill="url(#tg)"/>
        <line x1="150" y1="34" x2="48" y2="200" stroke="var(--el-l1)" stroke-width="1.2"/>
        <line x1="150" y1="34" x2="252" y2="200" stroke="var(--va)" stroke-width="1.2" stroke-dasharray="4 3"/>
        <line x1="48" y1="200" x2="252" y2="200" stroke="var(--st-l)" stroke-width="1.2"/>
        <circle cx="150" cy="34" r="22" fill="#0f2335" stroke="var(--el-l1)"/><text x="150" y="40" text-anchor="middle" class="tri-t" fill="var(--el-l2)">${E(top.element.name)}</text>
        <circle cx="48" cy="200" r="22" fill="#0f2335" stroke="var(--st-l)"/><text x="48" y="206" text-anchor="middle" class="tri-t${top.weapon.name.length > 2 ? ' s' : ''}" fill="var(--st-l)">${E(top.weapon.name)}</text>
        <circle cx="252" cy="200" r="22" fill="#0f2335" stroke="var(--va)"/><text x="252" y="206" text-anchor="middle" class="tri-t s" fill="var(--va-l)">${E(top.nation.name)}</text>
        <text x="86" y="112" text-anchor="middle" class="tri-l">${relOf(0).label}</text><text x="216" y="112" text-anchor="middle" class="tri-l">${relOf(1).label}</text>
        <text x="150" y="222" text-anchor="middle" class="tri-l">${relOf(2).label}</text>
        <text x="150" y="141" text-anchor="middle" class="tri-c one">${E(vm.typeName)}</text>
      </svg>
      <div class="ig-core">
        <div class="ic-k">THREE LAYERS</div>
        <div class="ic-t">${q.core}</div>
        <dl class="ic-list">
          <dt>最も一貫する場所</dt><dd>${q.consistent}</dd>
          <dt>最も葛藤する場所</dt><dd>${q.conflict}</dd>
          <dt>場面で切り替わる場所</dt><dd>${q.switching}</dd>
          <dt>どの層にも回収されない固有差</dt><dd>${q.unique}</dd>
        </dl>
      </div>
    </div>
    <div class="p25-pairs"><div class="sp-k">二層ずつの関係（詳しくは P22–P24）</div><div class="p25-row">
      ${vm.pairs.map((p, k) => `<a href="#p${22 + k}" class="p25p"><b>${E(p.a.name)} × ${E(p.b.name)}</b><em class="pp-label ${p.rel === 'tension' ? 'warn' : p.rel === 'conditional' ? 'cond' : ''}">${p.label}</em><span>${p.lead}</span></a>`).join('')}</div></div>
    <div class="peaks"><div class="pk-head"><b>20軸の山と谷</b><span>線の色＝層（気質・スタイル・価値観）</span></div>
      <div class="pk-row"><span class="pk-l">山 上位6</span>${q.peaks.map(pk).join('')}</div>
      <div class="pk-row low"><span class="pk-l">谷 下位3</span>${q.valleys.map(pk).join('')}<span class="pk-note">${q.peaksNote}</span></div></div>
    <div class="scene">
      <div class="scene-q"><span>ONE SCENE</span>曖昧な依頼を受けた日、三つの層はこの順に表れることがあります（観察候補）。</div>
      <div class="scene-flow">
        <div class="sf t-personality"><div class="sf-k">${E(top.element.name)} ── 受け取る</div><p>${q.flow[0]}</p></div>
        <div class="sf-arrow">→</div>
        <div class="sf t-style"><div class="sf-k">${E(top.weapon.name)} ── 動く</div><p>${q.flow[1]}</p></div>
        <div class="sf-arrow">→</div>
        <div class="sf t-values"><div class="sf-k">${E(top.nation.name)} ── 選ぶ</div><p>${q.flow[2]}</p></div>
      </div>
      <p class="scene-note">${q.flowNote}</p>
    </div>`, { kicker: 'INTEGRATION', sub: 'Element × Weapon × Nation', toc: '三層統合' });

  // ================= P26–P28 人物像の上位3名 =================
  function lensCards(items) {
    return items.map((x) => `<div class="lens-card">
      <div class="lcd-h"><span class="lcd-rk">${pad(x.r.rank)}</span><span class="lcd-n" style="--c:${CH_EL[x.r.element] || '#888'}">${E(x.r.name)}</span>${meta(x.r)}</div>
      <div class="lcd-why">${E(x.line)}</div>${x.rows.map(([k, t, c]) => `<div class="lc-row${c ? ' ' + c : ''}"><span>${k}</span><p>${t}</p></div>`).join('')}</div>`).join('');
  }
  P[26] = page(26, 'character-ranking-page lens-page', 't-mirror', 'MIRROR 上位3名との交わり', `
    <p class="lead">今のあなたに最も近い三人です。結果名（元素・武器・国家）が違っていても、<strong>20軸の配置のどこが重なり、どこが違うか</strong>に注目します。</p>
    <div class="lens-cards">${lensCards(vm.p26)}</div>
    <div class="lens-sum"><div class="sp-k">三人の重なりから見えるあなた</div><p>${vm.p36.mirReason}</p></div>
    <div class="note-band warn"><b>交わりは同一性ではない</b>　一致する構造を借りて、自分の資質を別の言葉で理解するための比較です。人物の物語や設定を、あなたに重ねるものではありません。</div>`,
  { kicker: 'MIRROR TOP 3', sub: 'Self-understanding', toc: 'MIRROR上位3名' });
  P[27] = page(27, 'character-ranking-page lens-page', 't-hidden', 'HIDDEN SHAPE 上位3名との交わり', `
    <p class="lead">強さの絶対値を外すと、<strong>どこが山で、どこが谷か</strong>という形が見えてきます。三人とは強度が違っても、その位置が近い関係です。</p>
    <div class="lens-cards">${lensCards(vm.p27)}</div>
    <div class="lens-sum"><div class="sp-k">三人に共通する形</div><p>${vm.p36.hidReason}</p></div>
    <div class="note-band"><b>HIDDEN SHAPEで見えるもの</b>　数値の高さだけでは目立ちにくかった資質が、絶対値ではなく相対配置を見ると、どのような意味を持つか。強さの順位では見えない、配置としての近さです。</div>`,
  { kicker: 'HIDDEN SHAPE TOP 3', sub: 'Overlooked structure', toc: 'HIDDEN SHAPE上位3名' });
  if (vm.p28) {
    P[28] = page(28, 'character-ranking-page lens-page', 't-mentor', 'MENTOR 上位3名から借りられるもの', `
    <p class="lead">三人が示すのは、<strong>あなたの核を失わずに、選んだ方向へ広げるための異なる方法</strong>です。借りるのは一人につき一つの技術だけ。人格や人生を真似るものではありません。</p>
    <div class="mt-target"><span>${vm.p09.selectedBy === 'fixture' ? 'サンプル用の仮の方向' : '今回選んだ方向'}</span>${E(vm.p09.goal.label)}（${vm.p09.changes.map((c) => `${NAME(c.axis)} ${c.before}→${c.after}`).join('／')}）</div>
    <div class="lens-cards">${lensCards(vm.p28)}</div>
    <div class="lens-sum"><div class="sp-k">借りる前の確認</div><p>① その技術を使っても、${vm.p09.keepAxes.map(NAME).join('・')}は保たれるか。　② 一度に試すのは一つだけにしているか。　③ 合わなければ手放してよいと決めているか。</p></div>
    <div class="note-band"><b>方向が変われば、MENTORも変わる</b>　別の方向を選べば、動かす軸と参照する人物が入れ替わります。ここでは技術を一つ見つけるまでに留め、具体的な行動計画は次の段階のレポートで扱います。</div>`,
    { kicker: 'MENTOR TOP 3', sub: 'Borrowable behavior', toc: 'MENTOR上位3名' });
  } else {
    P[28] = page(28, 'character-ranking-page lens-page', 't-mentor', 'MENTOR 上位3名から借りられるもの', `
    <p class="lead">MENTORの三人は、<strong>あなたが選んだ方向</strong>に対してだけ作られます。</p>
    ${MENTOR_PLACEHOLDER('方向を選ぶと、ここに上位3名と、それぞれから借りられる一つの振る舞い、保たれる核が表示されます。')}
    <div class="note-band"><b>方向は本人が選ぶ</b>　このレポートは、低い軸や低いドメインを自動的に「伸ばすべきもの」として扱いません。広げたい方向は、あなた自身が選びます。</div>`,
    { kicker: 'MENTOR TOP 3', sub: 'Borrowable behavior', toc: 'MENTOR上位3名' });
  }

  // ================= P29–P31 中位・下位 =================
  function navigate(n, kind, theme, kicker, title, toc) {
    const o = vm.navigate[kind];
    const rws = (b, tier) => o.rows.filter((r) => r.band === b).map((r) => `<div class="nv-row ${tier}"><span class="nv-n" style="--c:${COLOR[kind](r.key)}">${E(r.name)}</span><span class="nv-v">${r.display}</span><span class="nv-bar"><span style="width:${r.display}%;--c:${COLOR[kind](r.key)}"></span></span><p>${o.desc[r.key]}</p></div>`).join('');
    const cols = o.hasMiddle
      ? `<div class="nv-col"><div class="nv-k">中位 ── 状況に応じて使える補助資質</div>${rws('middle', 'mid')}</div><div class="nv-col"><div class="nv-k low">下位 ── 自然には優先されにくい資質</div>${rws('bottom', 'low')}</div>`
      : `<div class="nv-col"><div class="nv-k low">下位 ── 自然には優先されにくい資質</div>${rws('bottom', 'low')}</div><div class="nv-col"><div class="nv-k">上位との関係</div><p class="small">武器種は5つのため、上位3つと下位2つに分けて読みます。中位の区分はありません。</p></div>`;
    return page(n, `navigation-page nav-cat${o.rows.filter((r) => r.band === 'middle').length >= 3 ? ' m3' : ''}`, theme, title, `
    <p class="lead">${o.lead}</p>
    <div class="nv-grid">${cols}</div>
    <div class="nv-two">
      <div class="nv-box"><div class="sp-k">下位が役立つ場面</div>${o.useful.map(([a, b]) => `<p><b>${E(a)}</b>　${b}</p>`).join('')}</div>
      <div class="nv-box use"><div class="sp-k">上位資質から同じ目的へ近づく方法</div>${o.substitute.map((x) => `<p><b>${E(x.lower)}の${E(x.function_short)} →</b>　${x.text}<span class="min">${x.minimum}</span></p>`).join('')}</div>
    </div>
    <table class="sc-table"><thead><tr><th>場面</th><th>自然に使う上位</th><th>補助で使う中位・下位</th></tr></thead><tbody>${o.scenes.map(([a, b, c]) => `<tr><th>${E(a)}</th><td>${b}</td><td>${c}</td></tr>`).join('')}</tbody></table>
    <div class="nv-weak"><div class="sec-t warn">このカテゴリで起こりうる弱み</div><p>${o.weakness}</p></div>
    <div class="note-band">下位は欠如ではありません。自然には選ばれにくいだけです。必要な場面では、上位資質で同じ目的へ近づきつつ、上位資質だけでは代替しない部分を、仕組みや他者との協働で補います。</div>`, { kicker, sub: 'Middle · Lower', toc });
  }
  P[29] = navigate(29, 'element', 't-personality', 'NAVIGATE · ELEMENT', '元素の中位・下位', '元素の中位・下位');
  P[30] = navigate(30, 'weapon', 't-style', 'NAVIGATE · WEAPON', '武器種の下位', '武器種の下位');
  P[31] = navigate(31, 'nation', 't-values', 'NAVIGATE · NATION', '国家の中位・下位', '国家の中位・下位');

  // ================= P32 弱みとは何か =================
  const w = vm.p32;
  P[32] = page(32, 'navigation-page', 't-neutral', '弱みとは何か', `
    <p class="lead">弱みとは、順位の低い資質ではありません。<strong>あなたの成功・健全さ・関係性を妨げている状態</strong>です。回答だけでは実際に起きているかは分からないため、ここでは「起こりうる弱み」と「確かめる問い」として示します。</p>
    <div class="wk-big">
      <div class="wkb"><span>1</span><b>上位の過剰使用</b><p>自然に使える資質ほど、止める合図がありません。</p><em>${w.ex[0]}</em></div>
      <div class="wkb"><span>2</span><b>必要資質の過少使用</b><p>使えるのに、場面で出していない状態です。</p><em>${w.ex[1]}</em></div>
      <div class="wkb"><span>3</span><b>環境との不一致</b><p>資質ではなく、置かれた条件が妨げになっている状態です。</p><em>${w.ex[2]}</em></div>
      <div class="wkb"><span>4</span><b>補完資源の不足</b><p>自然には出ない力を、補う人や仕組みが近くにない状態です。</p><em>${w.ex[3]}</em></div>
    </div>
    <div class="wk-two">
      <div class="nv-box"><div class="sp-k">弱みを見つける四つの問い</div>
        <p>この資質の使い方が、成果を下げたことはあるか。</p><p>同じ資質について、繰り返し否定的な反応を受けているか。</p>
        <p>役割上は必要だが、使うたびに著しく消耗する資質はあるか。</p><p>上位資質が強すぎて、他の可能性を塞いでいないか。</p></div>
      <div class="nv-box use"><div class="sp-k">対処の四原則</div>
        <p><b>認識する</b>　どの場面で、どの資質が妨げになるかを知る。</p><p><b>協働する</b>　補完してくれる人や仕組みを借りる。</p>
        <p><b>上位から近づく</b>　得意な方法で同じ目的へ近づき、代替しない部分は外に支えを置く。</p><p><b>最低限を練習する</b>　必須の場面だけ使える状態を作る。</p></div>
    </div>
    <div class="wk-sample"><div class="sp-k">あなたの結果で注意したい組み合わせ（候補）</div><p>${w.sample.text}${w.sample.axes.length ? ev(`根拠：${w.sample.axes.map((a) => `${NAME(a)}${v(a)}`).join('・')}／分類 ${w.sample.types.join('・')}`) : ''}</p></div>
    <div class="wk-rank">
      <div class="sp-k">順位の低さは、弱みの証拠ではない</div>
      <div class="wk-rank-row">${rankRows('element', S.rankings.element)}</div>
      <p class="small">${E(w.lowest.name)}は元素の最下位ですが、それだけでは弱みとは呼びません。注意したいのは、上位の資質が強く出すぎた時の形です。</p>
    </div>`, { kicker: 'WHAT IS A WEAKNESS?', sub: 'Weakness', toc: '弱みとは何か' });

  // ================= P33–P35 ドメイン =================
  const DM = vm.domains, DC = DM.content;
  P[33] = page(33, 'navigation-page domain-page', 't-neutral', '四つの貢献ドメイン', `
    <p class="lead">20軸を<strong>「周囲へどのように貢献するか」</strong>という観点で、四つの資質グループにまとめます。気質・スタイル・価値観をまたいで束ねるため、一つの層だけでは見えない貢献の形が現れます。</p>
    <div class="dm-cards">${DM.items.map((d) => `<div class="dmc" style="--c:${DC[d.key].color}"><div class="dmc-k">${DC[d.key].en}</div><div class="dmc-n">${d.label}</div><p class="dmc-d">${DC[d.key].desc}</p>
      <div class="dmc-ax">${d.axes.map((x) => `<span class="tc tc-${LAYER[x.axis]}"><i>${x.axis}</i>${NAME(x.axis)}</span>`).join('')}</div><p class="dmc-why"><b>なぜこの4軸か</b>　${DC[d.key].why}</p></div>`).join('')}</div>
    <table class="dm-matrix"><thead><tr><th></th><th class="lp">気質 PERSONALITY</th><th class="ls">スタイル STYLE</th><th class="lv">価値観 VALUES</th></tr></thead><tbody>
      ${DM.items.map((d) => `<tr><th style="--c:${DC[d.key].color}">${d.label}</th>${['P', 'S', 'V'].map((L) => `<td>${d.axes.filter((x) => LAYER[x.axis] === L).map((x) => `${x.axis} ${NAME(x.axis)}`).join('・')}</td>`).join('')}</tr>`).join('')}
      <tr class="rest"><th>どれにも入らない軸</th><td colspan="3">${S.domains.excludedAxes.map((a) => `${a} ${NAME(a)}`).join('・')} ── 貢献の型ではなく、生活のリズムや規範との距離を表すため、ドメインには含めていません。</td></tr></tbody></table>
    <div class="note-band"><b>ETI編集用派生指標（${S.domains.model}）</b>　ドメインは確立された心理尺度ではなく、ETIの20軸を貢献の観点で読むために編集上まとめたものです。能力値・才能量・人口比を示すものではありません。各軸は一つのドメインにだけ所属させ、重複させていません。</div>`,
  { kicker: 'DOMAINS', sub: 'Contribution domains', toc: '四つの貢献ドメイン' });
  P[34] = page(34, 'navigation-page domain-page', 't-neutral', 'あなたのドメイン平均', `
    <p class="lead">${DM.lead34}</p>
    <div class="dm-badge"><b>ETI編集用派生指標</b><span>採用した4軸の単純平均</span><span>能力値・才能量・人口比ではありません</span><span>今後、分布と安定性の検証が必要です</span></div>
    <div class="dm-alloc">${DM.items.map((d) => `<div class="dma" style="--c:${DC[d.key].color}">
      <div class="dma-h"><span class="dma-n">${d.label}</span><span class="dma-v">${d.display}</span></div>
      <div class="dma-bar"><span style="width:${d.display}%"></span></div>
      <div class="dma-ax">${d.axes.map((x) => miniBar(x.axis)).join('')}</div></div>`).join('')}</div>
    <div class="dm-band"><div class="sp-k">四つの平均の比較（帯の幅は、各ドメインの平均値の大きさ）</div>
      <div class="dmb">${DM.items.map((d) => `<span style="flex:${d.display};--c:${DC[d.key].color}">${d.label}</span>`).join('')}</div>
      <p class="small">${DM.band34}</p></div>
    <div class="dm-read">
      <div class="nv-box"><div class="sp-k">読み方</div><p>${DM.read34}</p></div>
      <div class="nv-box"><div class="sp-k">計算・採用軸・版</div><p>各ドメインに割り当てた4軸の単純平均を四捨五入した値。例：${DM.items[0].label}＝(${DM.items[0].axes.map((x) => x.value).join('＋')})÷4＝${DM.items[0].display}。版：${S.domains.model}。正式な心理尺度ではなく、本番公開前に回答分布と順位の安定性の検証が必要です。</p></div>
    </div>`, { kicker: 'DOMAIN MEANS', sub: 'Simple means', toc: 'ドメイン平均' });
  const f35 = DM.flow35, topD = DC[f35[0].key];
  P[35] = page(35, 'navigation-page domain-page', 't-neutral', '周囲へ、どう貢献するか', `
    <p class="lead">${DM.lead35}</p>
    <div class="ct-flow">${f35.map((d, k) => `<div class="ctf" style="--c:${DC[d.key].color}"><i>${['START', 'CONNECT', 'SUSTAIN'][k]}</i><b>${d.label}</b><p>${DC[d.key].verb}</p><em>例：${DC[d.key].example}</em></div>${k < 2 ? '<div class="ctf-arrow">→</div>' : ''}`).join('')}</div>
    <div class="ct-grid">
      <div class="nv-box"><div class="sp-k">この流れが周囲にもたらすもの</div><p>${DM.bring35}</p></div>
      <div class="nv-box" style="--c:${DC[DM.low35.key].color}"><div class="sp-k" style="color:${DC[DM.low35.key].color}">${DM.low35.label} ── 入口ではない領域</div><p>${DM.lowText35}</p></div>
    </div>
    <div class="ct-grid">
      <div class="nv-box use"><div class="sp-k">周囲が気づきやすい貢献</div><p>${topD.visible}</p></div>
      <div class="nv-box"><div class="sp-k" style="color:var(--warn-l)">周囲が気づきにくい貢献</div><p>${topD.invisible}</p></div>
    </div>
    <div class="ct-scenes">
      <div class="sp-k">場面ごとの入口（${f35[0].label}から）</div>
      ${Object.entries(topD.scenes).map(([k, t]) => `<div class="cs-row"><span>${k}</span><p>${t}</p></div>`).join('')}
    </div>`, { kicker: 'YOUR CONTRIBUTION', sub: 'Contribution', toc: '周囲へどう貢献するか' });

  // ================= P36 三つの人物像から得るもの =================
  function lensMatrix() {
    const names = [];
    [M10, H10, T10].forEach((l) => l.forEach((r) => { if (!names.includes(r.name)) names.push(r.name); }));
    const el = {}; [...M10, ...H10, ...T10].forEach((r) => { el[r.name] = r.element; });
    const pos = (l, x) => (l.find((r) => r.name === x) || {}).rank;
    const rows = names.map((x) => `<tr><th><i style="--c:${CH_EL[el[x]] || '#888'}"></i>${E(x)}</th>${[['m', pos(M10, x)], ['h', pos(H10, x)], ['t', pos(T10, x)]].map(([c, p]) => `<td class="${c}">${p ? `<span>${pad(p)}</span>` : '—'}</td>`).join('')}</tr>`);
    const head = '<thead><tr><th>人物</th><th class="m">MIRROR</th><th class="h">HIDDEN</th><th class="t">MENTOR</th></tr></thead>';
    const half = Math.ceil(rows.length / 2);
    return [rows.slice(0, half), rows.slice(half)].map((r) => `<table class="lens-matrix">${head}<tbody>${r.join('')}</tbody></table>`).join('');
  }
  const p36 = vm.p36;
  const overlapTxt = [p36.inAll.length ? `<b>${p36.inAll.map(E).join('・')}</b>は、${T10.length ? 'MIRROR・HIDDEN SHAPE・MENTORのすべて' : 'MIRRORとHIDDEN SHAPEの両方'}に現れます。` : `${T10.length ? '三つ' : '二つ'}のTOP10すべてに現れる人物はいません。`,
    p36.onlyHidden.length ? `<b>${p36.onlyHidden.map(E).join('・')}</b>はHIDDEN SHAPEにだけ現れます。` : '',
    p36.onlyMentor.length ? `<b>${p36.onlyMentor.map(E).join('・')}</b>はMENTORにだけ現れます。` : ''].join('');
  P[36] = page(36, 'character-ranking-page lens-page', 't-neutral', '三つの人物像から得るもの', `
    <p class="lead">三つの人物像は、同じランキングの言い換えではありません。<strong>MIRRORは自己理解、HIDDEN SHAPEは相対配置で意味を持つ構造の確認、MENTORは借りられる振る舞いの発見</strong>という、別々の役割を持っています。</p>
    <div class="three-lens">
      <div class="tl t-mirror"><div class="tl-k">MIRROR</div><div class="tl-q">今の自分に近い人物</div>
        <div class="tl-row"><span>今回の三人</span><p><b>${M10.slice(0, 3).map((r) => E(r.name)).join('、')}</b></p></div>
        <div class="tl-row why"><span>今回この三人を選ぶ理由</span><p>${p36.mirReason}</p></div>
        <div class="tl-row"><span>得るもの</span><p>「なぜこの行動をするのか」を、構造として説明する言葉。</p></div></div>
      <div class="tl t-hidden"><div class="tl-k">HIDDEN SHAPE</div><div class="tl-q">強さの大小を外した時、内側の配置が似ている人物</div>
        <div class="tl-row"><span>今回の三人</span><p><b>${H10.slice(0, 3).map((r) => E(r.name)).join('、')}</b></p></div>
        <div class="tl-row why"><span>今回この三人を選ぶ理由</span><p>${p36.hidReason}</p></div>
        <div class="tl-row"><span>得るもの</span><p>数値の高さだけでは目立ちにくかった、資質の相対配置。</p></div></div>
      <div class="tl t-mentor"><div class="tl-k">MENTOR</div><div class="tl-q">自分の核を保ちながら、選んだ方向を広げるための参照人物</div>
        <div class="tl-row"><span>今回の三人</span><p><b>${T10.length ? T10.slice(0, 3).map((r) => E(r.name)).join('、') : '方向が未選択のため未生成'}</b></p></div>
        <div class="tl-row why"><span>今回この三人を選ぶ理由</span><p>${p36.menReason}</p></div>
        <div class="tl-row"><span>得るもの</span><p>核を変えず、影響だけを少し広げる具体的な振る舞い。</p></div></div>
    </div>
    <div class="lm-wrap">${lensMatrix()}</div>
    <div class="overlap"><div class="sp-k">TOP10の重なり</div><p>${overlapTxt}</p></div>`, { kicker: 'THREE LENSES', sub: 'What each lens gives', toc: '三つの人物像から得るもの' });

  // ================= P37–P38 観察実験 =================
  function experiments(n, kicker, title, lead, items, checks, note, toc, logs) {
    const days = '月火水木金土日'.split('').map((x) => `<span>${x}</span>`).join('');
    const cards = items.map(([k, t, d, o, c], i) => `<div class="ex-card" style="--c:${c}"><div class="ex-h"><span>${i + 1}</span><i>${k}</i></div><div class="ex-t">${t}</div><p>${d}</p>
      <div class="ex-obs"><b>観察するポイント</b>${o}</div><div class="ex-days">${days}</div></div>`).join('');
    return page(n, 'navigation-page experiment-page', 't-neutral', title, `
    <p class="lead">${lead}</p>
    <div class="ex-grid">${cards}</div>
    <div class="ex-log"><div class="sp-k">記録の例（一行で十分です）</div>${logs.map(([d, t]) => `<p><span>${d}</span>${E(t)}</p>`).join('')}</div>
    <div class="ex-check"><div class="sp-k">一週間後に確かめること</div>${checks.map((c) => `<p>□　${c}</p>`).join('')}</div>
    <div class="note-band">${note}</div>`, { kicker, sub: '7-day observation', toc });
  }
  const kindLabel = { element: '元素', weapon: '武器種', nation: '国家' }, kindCol = { element: 'var(--el-l1)', weapon: 'var(--st-l)', nation: 'var(--va)' };
  P[37] = experiments(37, 'OBSERVE · CATEGORIES', 'カテゴリ別・7日間の観察実験',
    'ここで扱うのは、命令ではなく<strong>結果を確かめる小さな実験</strong>です。一週間、気づいた時に一行だけ記録し、上位資質がどんな条件で働くかを観察します。',
    vm.p37.map((x) => [`${kindLabel[x.kind]}・${x.it.display_name}`, x.ex.title, x.text, x.ex.observe, kindCol[x.kind]]),
    [...vm.p37.map((x) => x.ex.observe), '考えたことを、期限内に一度外へ出したか。'],
    '一週間で何かを変える必要はありません。<b>どの条件で上位資質が澄んで働き、どの条件で濁るか</b>を見るための記録です。', '7日間の観察実験（カテゴリ）',
    vm.p37.map((x, i) => [['月', '水', '金'][i], x.ex.log]));
  const p38 = vm.p38;
  P[38] = experiments(38, 'OBSERVE · LENSES', '人物像別・7日間の観察実験',
    '三つの人物像から得たものを、日常の中で一度だけ試してみる実験です。<strong>人物を真似るのではなく、自分の資質と両立する一つの技術だけを確かめます。</strong>',
    [['MIRROR', p38.mirror.title, p38.mirror.text, p38.mirror.observe, 'var(--mi)'], ['HIDDEN SHAPE', p38.hidden.title, p38.hidden.text, p38.hidden.observe, 'var(--hs-l)'], ['MENTOR', p38.mentor.title, p38.mentor.text, p38.mentor.observe, 'var(--me)']],
    ['人物の名前を外しても、自分の言葉で構造を説明できたか。', '相対配置の谷の側にある動き方が役立った場面を、一つ見つけたか。', `借りた技術は、自分の核（${p38.keepCore}）と両立したか。`],
    '<b>人物を模倣しない</b>　性格や物語全体を真似る必要はありません。試した結果、合わなかった技術は手放して構いません。', '7日間の観察実験（人物像）', p38.logs);

  // ================= P39 YOUR COMPASS =================
  const c39 = vm.p39;
  P[39] = page(39, 'compass-page', 't-personality', '', `
    <div class="cp-head"><div class="cp-k">YOUR COMPASS</div><h2 class="cp-title">${c39.title}</h2>
      <p class="cp-sub">助言ではなく、再読する時の判断材料です。迷った日に、このページだけを開いてください。</p></div>
    <div class="cp-grid">
      <div class="cp-col"><div class="cp-n">3</div><div class="cp-t">FACTS</div><ol>${vm.p39.facts.map((f) => `<li>${f.text}${ev(f.ev)}</li>`).join('')}</ol></div>
      <div class="cp-col warn"><div class="cp-n">2</div><div class="cp-t">${vm.tensionHeadingEn}</div><ol>${vm.tensions.map((t) => `<li><span class="tk ${t.type}">${t.type === 'tension' ? '緊張' : '並存'}</span>${t.text}</li>`).join('')}</ol></div>
      <div class="cp-col q"><div class="cp-n">1</div><div class="cp-t">QUESTION</div>
        <p class="ep-q">${E(vm.question)}</p></div>
    </div>
    <div class="cp-when"><div class="sp-k">読み返すとよいタイミング</div>
      <div class="cw-row">${c39.reread.map(([k, t]) => `<span><b>${k}</b>${E(t)}</span>`).join('')}</div></div>
    <div class="closing">
      <p class="cl-main">${c39.closing.join('<br>')}</p>
      <p class="cl-sub">このレポートは、何者になるべきかを命じる本ではありません。すでにある構造へ、精密な言葉を与えるための本です。</p>
      <div class="cp-meta"><span>診断日　${S.diagnosed_at.slice(0, 10)}</span><span>${versions}</span><span>${[S.hidden.model, S.mentor.model, S.domains.model, S.versions.report_content_version, S.versions.report_template_version].map((x) => x.replace('CORE1-', '')).join(' · ')}</span></div>
    </div>`, { head: false, kicker: 'YOUR COMPASS', toc: 'YOUR COMPASS' });

  // ================= P40–P42 カテゴリ辞典 =================
  function catDict(n, kind, theme, kicker, title, lead, toc) {
    const rows = S.rankings[kind];
    const cards = rows.map((r) => { const it = ITEM[kind](r.key); return `<div class="dict" style="--accent:${it.visual.accent};--accent-l:${it.visual.accent_l}">
      <div class="dc-h"><span class="dc-rk">${pad(r.rank)}</span><span class="dc-n">${E(r.name)}</span><span class="dc-s">${E(it.short_theme)}</span><span class="dc-sc">${r.display}</span></div>
      <div class="dc-bar"><span style="width:${r.display}%"></span></div>
      <p class="dc-def">${it.definition}</p>
      <div class="dc-poles"><div><i>強く出る時</i>${it.strong}</div><div><i>型の組み合わせ</i>${it.type_mix}</div></div>
      <p class="dc-warn"><i>誤解しやすい点</i>${it.misread}</p></div>`; }).join('');
    return page(n, 'dictionary-page' + (rows.length >= 8 ? ' dense' : ''), theme, title, `<p class="lead">${lead}</p><div class="dict-grid">${cards}</div>`, { kicker, sub: 'Dictionary', toc });
  }
  P[40] = catDict(40, 'element', 't-personality', 'DICTIONARY · ELEMENT', '元素辞典（7元素）', '7元素すべてを同じ形式で収録します。数値はあなたのプロフィールスコア、並びはあなたの順位です。「型の組み合わせ」は、各元素の基準となる5軸の高低です。', '元素辞典');
  P[41] = catDict(41, 'weapon', 't-style', 'DICTIONARY · WEAPON', '武器種辞典（5武器種）', '5武器種すべてを同じ形式で収録します。武器種は力の使い方であり、動機や優劣ではありません。', '武器種辞典');
  P[42] = catDict(42, 'nation', 't-values', 'DICTIONARY · NATION', '国家辞典（8国家）', '8国家すべてを同じ形式で収録します。国家は所属ではなく、迷った時に何を守るかという価値の翻訳です。', '国家辞典');

  // ================= P43–P46 軸辞典（コード＋項目名は見出しに1回だけ。バーは見出しを持たない） =================
  function axisDict(n, theme, kicker, title, lead, axes, toc) {
    const cards = axes.map((a) => {
      const x = AX[a];
      let df, hd, ld, hl, ll;
      if (x.value) { df = `目標：${x.value.goal}。両立しやすい：${x.value.compatible}／対立しやすい：${x.value.conflicting}。`; hd = x.high_desc; ld = x.low_desc; hl = '高い時'; ll = '低い時'; }
      else { df = x.definition; hd = x.high_desc; ld = x.low_desc; hl = `高い側（${x.poles[1]}）`; ll = `低い側（${x.poles[0]}）`; }
      const label = x.word ? `${x.name}｜${x.word}` : x.name;
      return `<div class="dict ax">
      <div class="dc-h"><span class="dc-code">${a}</span><span class="dc-n">${label}</span><span class="dc-sc">${v(a)}</span></div>
      ${poleBar(a, { bare: true })}
      <p class="dc-def">${df}</p>
      <div class="dc-poles"><div><i>${hl}</i>${hd}</div><div><i>${ll}</i>${ld}</div></div>
      <p class="dc-warn"><i>誤解しやすい点</i>${x.misread}</p></div>`;
    });
    return page(n, 'dictionary-page axis-dict', theme, title, `<p class="lead">${lead}</p><div class="dict-col">${cards.join('')}</div>`, { kicker, sub: 'Axis dictionary', toc });
  }
  const PA = Object.keys(S.axes.personality), SA = Object.keys(S.axes.style), VA = Object.keys(S.axes.values);
  const vTop = [...VA].sort((a, b) => S.values_centered[b] - S.values_centered[a])[0];
  P[43] = axisDict(43, 't-personality', 'DICTIONARY · PERSONALITY', 'PERSONALITY辞典（Big Five 5特性）', 'Big Fiveの5特性です（各8問・正方向4問と逆転4問）。両端の言葉は設問の内容に沿った傾向の名前です。数値はあなたの位置です。', PA, 'PERSONALITY辞典');
  P[44] = axisDict(44, 't-style', 'DICTIONARY · STYLE', 'STYLE辞典（スタイルの5軸）', 'ETIのSTYLE 5軸です（各6問）。各軸の後ろの語（推進・調和・完遂・熟考・自律）は、このレポートでの呼び名です。', SA, 'STYLE辞典');
  P[45] = axisDict(45, 't-values', 'DICTIONARY · VALUES I', 'VALUES辞典 I（Schwartzの10価値）', 'Schwartzの基本的価値理論の10価値のうち、前半の5価値です。各価値は肯定方向の3問で測っています。低い値は、特定の反対価値が高いという意味ではありません。', VA.slice(0, 5), 'VALUES辞典 I');
  P[46] = axisDict(46, 't-values', 'DICTIONARY · VALUES II', 'VALUES辞典 II（Schwartzの10価値）', `後半の5価値です。${vm.flat ? '今回の回答では10価値がすべて同じ高さです。' : `あなたの価値の並びで最も相対的に高いのは、${NAME(vTop)}です。`}低い値は、特定の反対価値が高いという意味ではありません。`, VA.slice(5), 'VALUES辞典 II');

  // ================= 書き出し =================
  const nums = Object.keys(P).map(Number).sort((a, b) => a - b);
  if (nums.length !== TOTAL || nums[0] !== 1 || nums[TOTAL - 1] !== TOTAL) throw new Error('page set incomplete: ' + nums.join(','));
  const pal = EL_PALETTE[top.element.key], wv = K.weapons.items[top.weapon.key].visual;
  const imgVars = [...IMG_VARS.values()].map((x) => `--img-${x.n}:url("${x.uri}");`).join('');
  const rootVars = `:root{--el:${pal[0]};--el-l1:${pal[1]};--el-l2:${pal[2]};--el-lt:${pal[3]};--st:${wv.accent};--st-l:${wv.accent_l};${imgVars}}`;
  const css = [fs.readFileSync(path.join(HERE, 'report-46p.base.css'), 'utf8'), fs.readFileSync(path.join(HERE, 'report-46p.css'), 'utf8'), fs.readFileSync(path.join(HERE, 'report-46p.result.css'), 'utf8'), rootVars, fs.readFileSync(path.join(HERE, 'web.css'), 'utf8')].join('\n');
  const links = nums.map((i) => `<li><a href="#p${pad(i)}"><span>P${pad(i)}</span>${E(TITLES[i])}</a></li>`).join('');
  const viewer = `<nav class="web-toc" aria-label="目次">
  <p class="web-note wide">このレポートはA4の紙面46ページです。</p>
  <p class="web-note narrow">スマートフォンでは、指で広げて拡大してご覧ください。</p>
  <details><summary>目次（46ページ）</summary><ol>${links}</ol></details>
</nav>`;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<title>CORE I 完全解析レポート — ${E(vm.typeCode)} ${E(vm.typeName)}（46ページ）</title>
<style>
${css}
</style>
</head>
<body>
${viewer}
<main class="pages">
${nums.map((i) => P[i]).join('')}
</main>
</body>
</html>
`;
}

module.exports = { render, assetUri, TOTAL, CSP };
