// jagan/complete/view.mjs — 邪眼完全解析「DIPPER」（叩き台）の紙面。buildComplete（model.mjs）の中身だけを描く。
//   元素診断の完全解析（api/_complete/rc1/src/templates/report-46p.js）と同じ作法：1ページ＝1セクション、見出し（番号・キッカー・題）、
//   フッター（製品名・ページ番号）、順位の行、詳細のページ、統合、ドメイン、観察、辞典。配色は邪眼診断の赤黒。
const E = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');

export const PAGE_TITLES = [
  '表紙', 'このレポートの読み方', 'あなたの影', '邪眼（特性）の全体順位', '異相の全体順位', 'ファトゥス TOP11',
  '邪眼と異相 — あなたの影の正体', 'ファトゥスはなぜ現れるのか', 'あなたの深層',
  '上位の邪眼の活かし方', '上位の異相の活かし方',
  '邪眼 1位', '邪眼 2位', '邪眼 3位', '異相 1位', '異相 2位', '異相 3位',
  '邪眼 × 異相', '二層統合 — あなたの存在構造', '上位3名のファトゥスとの関わり',
  '下位の邪眼', '下位の異相', '強みとは何か',
  'ドメイン — 不安と距離', 'ドメイン — 行動のくせ', 'ドメイン — 他者との向き合い', 'あなたのドメイン平均',
  '弱点をどう活かすか', '人物から得るもの', '7日間の観察実験', '再読時の判断材料', '邪眼辞典', '異相辞典',
];

export function renderComplete(m) {
  const TOTAL = PAGE_TITLES.length;
  const pages = [];
  const page = (kind, kicker, title, body, o = {}) => {
    const n = pages.length + 1;
    const head = o.head === false ? '' : `<header class="dp-head"><span class="dp-num">${pad(n)}</span><div><div class="dp-kicker">${E(kicker)}</div><h2 class="dp-title">${E(title)}</h2></div>${o.sub ? `<span class="dp-sub">${E(o.sub)}</span>` : ''}</header>`;
    pages.push(`<section class="dp-page ${kind}" id="dp${pad(n)}" data-page="${n}" aria-label="P${pad(n)} ${E(PAGE_TITLES[n - 1])}"${o.style ? ` style="${o.style}"` : ''}>
  <div class="dp-inner">${head}${body}</div>
  <footer class="dp-foot"><span>${E(m.product.footer)}</span><span>${E(kicker)}</span><span>${pad(n)} / ${TOTAL}</span></footer>
</section>`);
  };
  const bar = (v, c) => `<span class="dp-bar"><i style="width:${Math.max(2, Math.min(100, v))}%;--c:${c}"></i></span>`;
  const fatuiName = (f) => {
    const [a, b] = f.elements.length >= 2 ? f.elements : f.elements.length === 1 ? [f.elements[0], '#ECE8F2'] : ['#E2C08C', '#C8405C'];
    return `<span class="dp-fname" style="--a:${a};--b:${b}">${E(f.name)}</span>`;
  };
  const el1 = m.element, is1 = m.isou, ch = m.character;
  const elc = el1.color.main;

  // P01 表紙
  page('dp-cover', 'COVER', '', `
    <div class="dp-cover-emblem"><img src="/assets/emblems/jagan/awakened/${m.emblem}.png" alt="${E(el1.label)}の邪眼の証" width="300" height="300"></div>
    <div class="dp-cover-label">${E(m.product.label)}｜<b>${E(m.product.name)}</b></div>
    <div class="dp-cover-en">${E(m.product.en)}</div>
    <div class="dp-cover-code">DTI　${E(m.dti.code)}</div>
    <h1 class="dp-cover-name">${E(m.dti.name)}</h1>
    <div class="dp-cover-combo"><span style="color:${elc}">${E(el1.label)}</span><b>×</b><span style="color:${is1.color}">${E(is1.label)}</span></div>
    ${ch ? `<div class="dp-cover-fatui">最も近しいファトゥス　${fatuiName(ch)}</div>` : ''}
    ${m.diagnosedAt ? `<div class="dp-cover-date">診断日　${E(m.diagnosedAt)}</div>` : ''}`, { head: false, style: `--ec:${elc};--ed:${el1.color.dark}` });

  // P02 読み方
  page('dp-text', 'GUIDE', 'このレポートの読み方', `${m.fixed.guide.map((p) => `<p class="dp-p">${E(p)}</p>`).join('')}
    <ol class="dp-toc">${PAGE_TITLES.slice(2).map((t, i) => `<li><span>${pad(i + 3)}</span>${E(t)}</li>`).join('')}</ol>`);

  // P03 あなたの影（元素診断の「あなたの核 — Executive Portrait」と同じ組み立て：左にラベルカード、右に DTI の解説）
  const labelCard = (k, en, name, score, sub, c) => `<div class="dp-lcard" style="--c:${c}"><div class="dp-lk">${E(k)}<span>· ${E(en)}</span></div>
      <div class="dp-lrow"><span class="dp-lname">${name}</span>${score !== null ? `<b class="dp-lscore">${score}</b>` : ''}</div><div class="dp-lsub">${sub}</div></div>`;
  const miniRow = (t) => `<div class="dp-mrow"><span class="dp-mcode" style="color:${t.color}">${E(t.label)}</span><span class="dp-bar"><i style="width:${Math.max(3, t.score)}%;--c:${t.color}"></i></span><b>${t.score}</b></div>`;
  page('dp-wide', 'YOUR SHADOW', `あなたの影 — ${m.dti.name}`, `
    <p class="dp-p dp-lead">${E(m.panel.portraitLead)}</p>
    <div class="dp-split">
      <div class="dp-side">
        ${labelCard('邪眼', 'JAGAN', E(el1.label), el1.score, `2位 ${E(m.gapE.b.label)} ${m.gapE.b.score} ／ 差 ${m.gapE.d}`, elc)}
        ${labelCard('異相', 'ISOU', E(is1.label), is1.score, `2位 ${E(m.gapI.b.label)} ${m.gapI.b.score} ／ 差 ${m.gapI.d}`, is1.color)}
        <div class="dp-lcard plain"><div class="dp-lk">12特性の山（根拠）</div>${m.peaks.map(miniRow).join('')}
          <div class="dp-lk" style="margin-top:12px">12特性の谷（根拠）</div>${m.valleys.map(miniRow).join('')}</div>
        ${ch ? labelCard('ファトゥス', 'FATUI', fatuiName(ch), null, E(ch.deep.gain), ch.elements[0] || '#E2C08C') : ''}
      </div>
      <div class="dp-main">
        <div class="dp-dtih"><span class="dp-dtiname">${E(m.dti.name)}</span><span class="dp-dticode">${E(m.dti.code)}</span></div>
        <p class="dp-p">${E(el1.label)}・${E(is1.label)}${ch ? `・${E(ch.name)}` : ''}という三つの結果は、同じ影の言い換えではありません。<b>影のかたち（邪眼）、影の現れ方（異相）、影を映す鏡（ファトゥス）</b>が、別々の層から読まれています。</p>
        <p class="dp-p">影のかたちでは、${E(el1.text.essence)}${E(el1.label)}が一位にあり、${m.gapE.d >= 10 ? `次点の${E(m.gapE.b.label)}とは差があります` : `次点の${E(m.gapE.b.label)}とも近く、二つの影が並んで表れやすい状態です`}。影の現れ方では${E(is1.label)}が${m.gapI.d >= 5 ? 'はっきり' : ''}一位です。${E(is1.label)}は、${E(is1.text.essence)}現れ方です。${ch ? `影を映す鏡としては、${E(ch.name)}（${E(ch.title)}）が最も近く現れました。` : ''}</p>
        <p class="dp-p">数値の山は${m.peaks.map((x) => `${E(x.label)}（${E(x.copy.hi)}）`).join('と')}です。数値の谷は${m.valleys.map((x) => `${E(x.label)}`).join('と')}です。${m.valleys.map((x) => `${E(x.label)}が低いことは、${E(x.copy.lo)}として表れやすい方向です。`).join('')}</p>
        <div class="dp-quote">${E(el1.deep.aphorism)}</div>
      </div>
    </div>`, { sub: 'The shadow' });

  // P04・P05 全体順位（元素診断の「元素（気質）の全体順位」と同じ組み立て）
  const tierOf = (rank, n) => (rank <= 3 ? 'top' : rank > n - (n >= 10 ? 3 : 2) ? 'low' : 'mid');
  const rankCards = (rows, n) => rows.map((x) => `<div class="dp-rcard tier-${tierOf(x.rank, n)}" style="--c:${x.c}">
      <div class="dp-rhead"><span class="dp-rk">${pad(x.rank)}</span><span class="dp-rname">${E(x.label)}</span><span class="dp-rtheme">${E(x.theme)}</span><b>${x.score}</b></div>
      <div class="dp-rline">${E(x.line)}</div><span class="dp-bar"><i style="width:${Math.max(3, x.score)}%;--c:${x.c}"></i></span></div>`).join('');
  const panel = (blocks) => `<aside class="dp-panel">${blocks.map(([k, v, cls]) => `<div class="dp-pblock${cls ? ' ' + cls : ''}"><div class="dp-pk">${k}</div>${v}</div>`).join('')}</aside>`;
  const gapBar = (g, unit) => `<div class="dp-gap"><span class="dp-gaptag">1位－2位</span>${E(g.a.label)} ${g.a.score} − ${E(g.b.label)} ${g.b.score} ＝ <b>${g.d}</b>${unit || ''}</div>`;
  const legend = (n) => `<div class="dp-legend"><span>${n}</span><i class="t">上位</i><i class="m">中位</i><i class="l">下位</i></div>`;

  const eRows = m.elements.map((e) => ({ rank: e.rank, label: e.label, theme: e.deep.theme, score: e.score, line: e.text.essence, c: e.color.main }));
  const lowE = m.elements.slice(-2);
  page('dp-wide', 'OVERVIEW · JAGAN', '邪眼（特性）の全体順位', `
    <p class="dp-p dp-lead">${E(el1.label)}が一位で、${m.gapE.d >= 10 ? `次点の${E(m.gapE.b.label)}とは差があります` : `次点の${E(m.gapE.b.label)}とは僅差です`}。${E(el1.label)}は、${E(el1.text.essence)}影のかたちです。${m.gapE.d >= 10 ? 'この傾向が、影のかたちの中で比較的はっきり表れています。' : '上位の二つの影が、場面によって入れ替わりながら表れやすい状態です。'}</p>
    <div class="dp-split">
      <div class="dp-main">${legend('7邪眼のプロフィールスコア（/100）')}${rankCards(eRows, 7)}${gapBar(m.gapE)}</div>
      ${panel([
        ['邪眼とは', `<p>${E(m.panel.jaganIs)}</p>`],
        ['上位3', `<p>${m.topE.map((e) => `<b style="color:${e.color.main}">${E(e.label)}</b> ${E(e.deep.theme)}`).join('／')}</p>`],
        ['下位', `<p>${lowE.map((e) => E(e.label)).join('と')}。${E(lowE[lowE.length - 1].deep.low)}</p>`],
        ['すでに使っている強み', `<p>${E(el1.deep.strength)}</p>`],
        ['過剰使用のサイン', `<p>${E(el1.deep.overuse)}</p>`, 'warn'],
        ['活かし方', `<ul>${el1.deep.bullets.map((b) => `<li>${E(b)}</li>`).join('')}</ul>`, 'box'],
      ])}
    </div>`, { sub: 'Overview' });

  const iRows = m.isous.map((x) => ({ rank: x.rank, label: x.label, theme: x.deep.theme, score: x.score, line: x.text.essence, c: x.color }));
  const lowI = m.isous.slice(-3);
  page('dp-wide dp-compact', 'OVERVIEW · ISOU', '異相の全体順位', `
    <p class="dp-p dp-lead">${E(is1.label)}が一位で、${m.gapI.d >= 5 ? `次点の${E(m.gapI.b.label)}とは差があります` : `次点の${E(m.gapI.b.label)}とは僅差です`}。12特性を、あなたの異相を選んだのと同じ規則（回答の平均 → 5と答えた割合 → 4と答えた割合）で並べています。</p>
    <div class="dp-split">
      <div class="dp-main">${legend('12異相のプロフィールスコア（/100）')}${rankCards(iRows, 12)}${gapBar(m.gapI)}</div>
      ${panel([
        ['異相とは', `<p>${E(m.panel.isouIs)}</p>`],
        ['上位3', `<p>${m.topI.map((x) => `<b style="color:${x.color}">${E(x.label)}</b> ${E(x.deep.theme)}`).join('／')}</p>`],
        ['下位', `<p>${lowI.map((x) => E(x.label)).join('・')}。${E(lowI[lowI.length - 1].deep.low)}</p>`],
        ['すでに使っている強み', `<p>${E(is1.deep.strength)}</p>`],
        ['過剰使用のサイン', `<p>${E(is1.deep.overuse)}</p>`, 'warn'],
        ['活かし方', `<ul><li>${E(is1.deep.use.split('。')[0])}。</li><li>${E(is1.deep.weak.split('。').filter(Boolean).slice(-1)[0])}。</li></ul>`, 'box'],
      ])}
    </div>`, { sub: 'Overview' });

  // P06 ファトゥス TOP11（元素診断の「MIRROR TOP10」と同じ組み立て）
  const fRow = (f) => `<div class="dp-fcard${f.rank <= 3 ? ' top' : ''}"><span class="dp-rk">${pad(f.rank)}</span>
      <div class="dp-fbody"><div class="dp-fhead"><i class="dot" style="background:${f.elements[0] || '#C8405C'}"></i>${fatuiName(f)}<b>${f.match}</b>${f.selected ? '<span class="dp-ftag">FATUI</span>' : ''}
        <span class="dp-chips">${f.chips.map((c) => `<i style="--c:${c.color}">${E(c.label)}</i>`).join('')}<i>${E(f.title)}</i><i>${E(f.region || '—')}</i></span></div>
        <div class="dp-rline">${E(f.deep.relate)}</div></div></div>`;
  page('dp-wide dp-compact', 'FATUI', 'ファトゥス TOP11', `
    <div class="dp-def"><span>DEFINITION</span><p>${E(m.panel.fatuiDefinition)}</p></div>
    <div class="dp-split">
      <div class="dp-main">${m.fatui.map(fRow).join('')}</div>
      ${panel([
        ['この順位の読み方', `<p>${E(m.panel.fatuiReading)}</p>`],
        ['上位に反復するテーマ', `<p>${m.themes.length ? `上位5名には「${m.themes.map(E).join('」「')}」の物語を持つ人物が多く並びます。` : '上位5名の物語のテーマは、それぞれに異なります。'}上位の多くは、あなたと同じく<b>${E(m.peaks[0].label)}</b>の近くに参照点を持つ人物です。</p>`],
        ['同じではない', `<p>${E(m.panel.fatuiNotSame)}</p>`, 'warn'],
      ])}
    </div>
    <div class="dp-top3">${m.topF.map((f) => `<div class="dp-t3" style="--c:${f.elements[0] || '#C8405C'}"><div class="dp-t3h">${pad(f.rank)}　${fatuiName(f)}</div><p>${E(f.compare)}</p></div>`).join('')}</div>`, { sub: 'Self-understanding' });

  // P07 邪眼と異相（深い説明）
  page('dp-text', 'JAGAN & ISOU', '邪眼と異相 — あなたの影の正体', `
    <div class="dp-pair">
      <div class="dp-card" style="--c:${elc}"><div class="dp-k">邪眼元素</div><div class="dp-big">${E(el1.label)}<small>${E(el1.name)}</small></div>
        <p class="dp-p">${E(m.fixed.jaganWhat)}</p><p class="dp-p">${E(el1.story)}</p>
        <div class="dp-parts">${el1.parts.map((x) => `<div class="dp-row"><span>${E(x.label)}<small>寄与 ${x.weight}%</small></span>${bar(x.score, elc)}<b>${x.score}</b></div>`).join('')}</div></div>
      <div class="dp-card" style="--c:${is1.color}"><div class="dp-k">異相</div><div class="dp-big">${E(is1.label)}<small>${E(is1.text.axis)}</small></div>
        <p class="dp-p">${E(m.fixed.isouWhat)}</p><p class="dp-p">${E(is1.text.body)}</p>
        <p class="dp-note">${E(is1.copy.limit)}</p></div>
    </div>`);

  // P08 ファトゥスはなぜ現れるのか
  page('dp-text', 'WHY FATUI', 'ファトゥスはなぜ現れるのか', `${m.fixed.fatuiWhy.map((p) => `<p class="dp-p">${E(p)}</p>`).join('')}
    ${ch ? `<div class="dp-card" style="--c:#E2C08C"><div class="dp-k">あなたに現れたファトゥス</div><div class="dp-big">${fatuiName(ch)}<small>${E(ch.title)}｜${E(ch.tags.join('・'))}｜一致度 ${ch.match}%</small></div>
      <p class="dp-p">${E(ch.copy.story_context)}</p>
      <div class="dp-cols"><div><div class="dp-k2">重なる特性</div>${ch.aligned.length ? ch.aligned.map((x) => `<p class="dp-li">${E(x.label)}　あなた ${x.you}／参照 ${x.ref}</p>`).join('') : '<p class="dp-li">明確に近い項目は限られています</p>'}</div>
        <div><div class="dp-k2">離れている特性</div>${ch.different.length ? ch.different.map((x) => `<p class="dp-li">${E(x.label)}　あなた ${x.you}／参照 ${x.ref}</p>`).join('') : '<p class="dp-li">大きな差はありません</p>'}</div></div>
      <p class="dp-note">${E(ch.copy.limit)}</p></div>` : '<p class="dp-p">あなたの回答は、どの人物の参照点とも特定できるほどの差が出ませんでした。人物の参照は、順位のページで確かめてください。</p>'}`);

  // P09 あなたの深層
  page('dp-depth', 'YOUR ABYSS', 'あなたの深層', `
    <div class="dp-trio"><span style="color:${elc}">${E(el1.label)}</span><b>・</b><span style="color:${is1.color}">${E(is1.label)}</span>${ch ? `<b>・</b>${fatuiName(ch)}` : ''}</div>
    <div class="dp-typename">${E(m.dti.code)}｜${E(m.dti.name)}</div>
    <p class="dp-p dp-lead">${E(m.overview)}</p>
    <p class="dp-p">${E(el1.text.body)}</p>
    <p class="dp-p">${E(is1.short)}</p>
    <div class="dp-quote">${E(is1.copy.reflection)}</div>`);

  // P10・P11 活かし方
  page('dp-text', 'USE YOUR JAGAN', '上位の邪眼の活かし方', m.topE.map((e) => `<div class="dp-card" style="--c:${e.color.main}"><div class="dp-k">${pad(e.rank)}　${E(e.label)}｜${E(e.name)}</div>
    <p class="dp-p"><b>強みとしての顔：</b>${E(e.deep.strength)}</p><p class="dp-p">${E(e.deep.use)}</p></div>`).join(''));
  page('dp-text', 'USE YOUR ISOU', '上位の異相の活かし方', m.topI.map((x) => `<div class="dp-card" style="--c:${x.color}"><div class="dp-k">${pad(x.rank)}　${E(x.label)}｜${E(x.text.axis)}</div>
    <p class="dp-p"><b>強みとしての顔：</b>${E(x.deep.strength)}</p><p class="dp-p">${E(x.deep.use)}</p></div>`).join(''));

  // P12–P14 上位3邪眼の詳細
  for (const e of m.topE) {
    page('dp-detail', `JAGAN ${pad(e.rank)}`, `邪眼 ${e.rank}位 — ${e.label}`, `
      <div class="dp-hero" style="--c:${e.color.main}"><div class="dp-big">${E(e.label)}<small>${E(e.name)}｜${E(e.text.axis)}</small></div><div class="dp-score">${e.score}</div></div>
      <p class="dp-p dp-lead">${E(e.text.essence)}</p><p class="dp-p">${E(e.text.body)}</p>
      <div class="dp-k2">この邪眼をつくる特性</div>
      <div class="dp-parts">${e.parts.map((x) => `<div class="dp-row"><span>${E(x.label)}<small>寄与 ${x.weight}%</small></span>${bar(x.score, e.color.main)}<b>${x.score}</b></div>`).join('')}</div>
      <p class="dp-p"><b>強みとしての顔：</b>${E(e.deep.strength)}</p>
      <div class="dp-card" style="--c:${e.color.main}"><div class="dp-k">活かし方</div><p class="dp-p">${E(e.deep.use)}</p></div>
      <div class="dp-card" style="--c:${e.color.main}"><div class="dp-k">この邪眼が弱いとき</div><p class="dp-p">${E(e.deep.low)}</p></div>
      ${e.fatui.length ? `<p class="dp-li">この邪眼に連なるファトゥス：${e.fatui.map((f) => `${fatuiName(f)}（${f.rank}位）`).join('　')}</p>` : ''}`);
  }
  // P15–P17 上位3異相の詳細
  for (const x of m.topI) {
    page('dp-detail', `ISOU ${pad(x.rank)}`, `異相 ${x.rank}位 — ${x.label}`, `
      <div class="dp-hero" style="--c:${x.color}"><div class="dp-big">${E(x.label)}<small>${E(x.aspect.code)}｜${E(x.text.axis)}</small></div><div class="dp-score">${x.score}</div></div>
      <p class="dp-p dp-lead">${E(x.text.essence)}</p><p class="dp-p">${E(x.text.body)}</p>
      <div class="dp-cols"><div><div class="dp-k2">高いときの顔</div><p class="dp-li">${E(x.copy.hi)}</p></div><div><div class="dp-k2">低いときの顔</div><p class="dp-li">${E(x.copy.lo)}</p></div></div>
      <p class="dp-p"><b>強みとしての顔：</b>${E(x.deep.strength)}</p>
      <div class="dp-card" style="--c:${x.color}"><div class="dp-k">活かし方</div><p class="dp-p">${E(x.deep.use)}</p></div>
      <div class="dp-card" style="--c:${x.color}"><div class="dp-k">負担になりやすいとき</div><p class="dp-p">${E(x.deep.weak)}</p></div>
      <div class="dp-quote">${E(x.copy.reflection)}</div><p class="dp-note">${E(x.copy.limit)}</p>`);
  }

  // P18 邪眼 × 異相
  page('dp-text', 'JAGAN × ISOU', '邪眼 × 異相', `
    <div class="dp-trio"><span style="color:${elc}">${E(el1.label)}</span><b>×</b><span style="color:${is1.color}">${E(is1.label)}</span><b>＝</b><span>${E(m.dti.name)}</span></div>
    <p class="dp-p dp-lead">${E(m.overview)}</p>
    <div class="dp-cols"><div class="dp-card" style="--c:${elc}"><div class="dp-k">邪眼が渇望するもの</div><p class="dp-p">${E(el1.story)}</p></div>
      <div class="dp-card" style="--c:${is1.color}"><div class="dp-k">異相が表に出す影</div><p class="dp-p">${E(is1.text.body)}</p></div></div>
    <p class="dp-p">邪眼（${E(el1.label)}）の活かし方：${E(el1.deep.use)}</p><p class="dp-p">異相（${E(is1.label)}）の活かし方：${E(is1.deep.use)}</p>`);

  // P19 二層統合
  page('dp-text', 'TWO LAYERS', '二層統合 — あなたの存在構造', `
    <p class="dp-p">邪眼元素は「影の土台」（複数の特性が重なった、長く続きやすい傾向）、異相は「影の表面」（いま最も強く表れている一つの特性）です。二つを重ねると、あなたの存在構造が見えてきます。</p>
    <div class="dp-layers">
      <div class="dp-layer" style="--c:${is1.color}"><span>表面｜異相</span><b>${E(is1.label)}</b><em>${E(is1.text.essence)}</em></div>
      <div class="dp-layer" style="--c:${elc}"><span>土台｜邪眼</span><b>${E(el1.label)}</b><em>${E(el1.text.essence)}</em></div>
    </div>
    <p class="dp-p">${el1.parts.some((x) => x.id === is1.id)
      ? `あなたの異相（${E(is1.label)}）は、邪眼（${E(el1.label)}）をつくる特性の一つです。土台と表面が同じ向きを向いているため、影がはっきり表れやすく、扱い方を覚えれば強みとしても安定します。`
      : `あなたの異相（${E(is1.label)}）は、邪眼（${E(el1.label)}）をつくる特性とは別の特性です。土台と表面が違う向きを持つため、場面によって表れる顔が変わりやすく、その揺れ自体があなたの幅になります。`}</p>`);

  // P20 上位3名のファトゥスとの関わり
  page('dp-text', 'FATUI TOP 3', '上位3名のファトゥスとの関わり', m.topF.map((f) => `<div class="dp-card" style="--c:${f.elements[0] || '#C8405C'}"><div class="dp-k">${pad(f.rank)}　${fatuiName(f)}　${f.match}%</div>
    <p class="dp-p">${E(f.copy.story_context)}</p>
    <p class="dp-li">重なる特性：${f.aligned.length ? f.aligned.map((x) => `${E(x.label)}（${x.you}／${x.ref}）`).join('、') : '限られています'}</p>
    <p class="dp-li">離れている特性：${f.different.length ? f.different.map((x) => `${E(x.label)}（${x.you}／${x.ref}）`).join('、') : '大きな差はありません'}</p>
    <div class="dp-quote">${E(f.copy.reflection)}</div></div>`).join(''));

  // P21・P22 下位
  page('dp-text', 'LOWER JAGAN', '下位の邪眼', `<p class="dp-p">下位の邪眼は、あなたの中で表れにくい影のかたちです。表れにくいことは欠点ではなく、別の強みの裏返しでもあります。</p>${m.lowE.map((e) => `<div class="dp-card" style="--c:${e.color.main}"><div class="dp-k">${pad(e.rank)}　${E(e.label)}｜${E(e.name)}　${e.score}</div><p class="dp-p">${E(e.deep.low)}</p></div>`).join('')}`);
  page('dp-text', 'LOWER ISOU', '下位の異相', `<p class="dp-p">下位の異相は、あなたの中で表れにくい特性です。低いことで生まれる穏やかさと、手薄になりやすい点の両方があります。</p>${m.lowI.map((x) => `<div class="dp-card" style="--c:${x.color}"><div class="dp-k">${pad(x.rank)}　${E(x.label)}｜${E(x.copy.lo)}　${x.score}</div><p class="dp-p">${E(x.deep.low)}</p></div>`).join('')}`);

  // P23 強みとは何か
  page('dp-text', 'STRENGTH', '強みとは何か', `${m.fixed.strength.map((p) => `<p class="dp-p">${E(p)}</p>`).join('')}
    ${m.topI.map((x) => `<div class="dp-row big"><span style="color:${x.color}">${E(x.label)}</span><em>${E(x.deep.strength)}</em></div>`).join('')}
    <div class="dp-row big"><span style="color:${elc}">邪眼（${E(el1.label)}）</span><em>${E(el1.deep.strength)}</em></div>`);

  // P24–P26 ドメイン
  for (const d of m.domains) {
    page('dp-text', `DOMAIN｜${d.deep.en}`, `ドメイン — ${d.label}`, `
      <div class="dp-hero" style="--c:${d.color}"><div class="dp-big">${E(d.label)}<small>${E(d.deep.note)}</small></div><div class="dp-score">${d.avg}</div></div>
      <p class="dp-p">${E(d.intro)}</p>
      ${d.traits.map((t) => `<div class="dp-row"><span style="color:${t.color}">${E(t.label)}</span>${bar(t.score, t.color)}<b>${t.score}</b></div><p class="dp-li">${E(t.deep.strength)}</p>`).join('')}`);
  }
  // P27 ドメイン平均
  page('dp-text', 'DOMAIN AVERAGE', 'あなたのドメイン平均', `<p class="dp-p">${E(m.fixed.domainAvg)}</p>
    ${m.domainOrder.map((d, i) => `<div class="dp-rrow"><span class="dp-rk">${pad(i + 1)}</span><span class="dp-rn" style="color:${d.color}">${E(d.label)}</span>${bar(d.avg, d.color)}<b>${d.avg}</b><span class="dp-rd">12特性の平均（${m.overall}）より ${d.diff >= 0 ? '+' : ''}${d.diff}</span></div>`).join('')}
    <p class="dp-p">影が最も表れやすいのは「${E(m.domainOrder[0].label)}」の土台です。${E(m.domainOrder[0].deep.note)}</p>`);

  // P28 弱点をどう活かすか
  page('dp-text', 'WEAKNESS', '弱点をどう活かすか', `<p class="dp-p">${E(m.fixed.weakness)}</p>${m.topI.map((x) => `<div class="dp-card" style="--c:${x.color}"><div class="dp-k">${E(x.label)}</div><p class="dp-p">${E(x.deep.weak)}</p></div>`).join('')}`);

  // P29 人物から得るもの
  page('dp-text', 'FROM FATUI', '人物から得るもの', `<p class="dp-p">上位3名の物語から、あなたの影の扱い方として借りられる視点です。人物と同じ行動をとるという意味ではありません。</p>
    ${m.topF.map((f) => `<div class="dp-card" style="--c:${f.elements[0] || '#C8405C'}"><div class="dp-k">${fatuiName(f)}</div><p class="dp-p">${E(f.deep.gain)}</p><p class="dp-li">${E(f.copy.association_theme)}</p></div>`).join('')}`);

  // P30 7日間の観察実験
  page('dp-text', '7 DAYS', '7日間の観察実験', `<p class="dp-p">${E(m.fixed.experiment)}</p>
    ${m.days.map((d) => `<div class="dp-day"><span class="dp-rk">DAY ${d.day}</span><b style="color:${d.color}">${E(d.label)}</b><p>${E(d.q)}</p><span class="dp-write" aria-hidden="true"></span></div>`).join('')}`);

  // P31 再読時の判断材料
  page('dp-text', 'RE-READ', '再読時の判断材料', `<p class="dp-p">${E(m.fixed.recheck)}</p>
    ${m.topI.map((x) => `<div class="dp-check"><span>□</span><b style="color:${x.color}">${E(x.label)}</b><em>${E(x.deep.recheck)}</em></div>`).join('')}
    <div class="dp-check"><span>□</span><b style="color:${elc}">邪眼（${E(el1.label)}）</b><em>${E(el1.deep.use.split('。')[0])}。を、実際に試せたか。</em></div>`);

  // P32・P33 辞典
  page('dp-dict', 'DICTIONARY', '邪眼辞典', '<div class="dp-dgrid">' + [...m.elements].sort((a, b) => a.id.localeCompare(b.id)).map((e) => `<div class="dp-dcard" style="--c:${e.color.main}"><div class="dp-k">${E(e.label)}｜${E(e.name)}</div><p>${E(e.deep.dict)}</p><p class="dp-li">${E(e.text.essence)}</p></div>`).join('') + '</div>');
  page('dp-dict', 'DICTIONARY', '異相辞典', '<div class="dp-dgrid">' + [...m.isous].sort((a, b) => a.aspect.code.localeCompare(b.aspect.code)).map((x) => `<div class="dp-dcard" style="--c:${x.color}"><div class="dp-k">${E(x.aspect.code)}｜${E(x.label)}</div><p>${E(x.copy.meaning)}</p><p class="dp-li">高い：${E(x.copy.hi)}／低い：${E(x.copy.lo)}</p></div>`).join('') + '</div>');

  if (pages.length !== TOTAL) throw new Error(`page_count_${pages.length}`);
  return pages.join('\n');
}
