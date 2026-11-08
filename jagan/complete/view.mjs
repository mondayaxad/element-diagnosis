// jagan/complete/view.mjs — 邪眼完全解析「DIPPER」（叩き台）の紙面。buildComplete（model.mjs）の中身だけを描く。
//   元素診断の完全解析（api/_complete/rc1/src/templates/report-46p.js）と同じ作法：1ページ＝1セクション、見出し（番号・キッカー・題）、
//   フッター（製品名・ページ番号）、順位の行、詳細のページ、統合、ドメイン、観察、辞典。配色は邪眼診断の赤黒。
const E = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');

export const PAGE_TITLES = [
  '表紙', 'このレポートの読み方', 'あなたの影', '邪眼（特性）の全体順位', '異相の全体順位', 'ファトゥス TOP11',
  '邪眼と異相 — あなたの影の正体', 'ファトゥスはなぜ現れるのか', 'あなたの深層',
  '上位の邪眼との付き合い方', '上位の異相を読み解く',
  '邪眼 1位', '邪眼 2位', '邪眼 3位', '異相 1位', '異相 2位', '異相 3位',
  '邪眼×異相――あなたの影はどう表れるか', '上位3名のファトゥスとの交わり',
  '四つの反応領域', 'あなたの反応領域',
  'あなたの影に、次の一手を', '人物から得るもの', '再読 — あなたの影を読み直す', '邪眼辞典（7邪眼）', '異相辞典 I（不安と対人警戒・衝動と刺激）', '異相辞典 II（固執と基準・他者への働きかけ）',
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

  // P10・P11 上位の邪眼との付き合い方／上位の異相を読み解く（オーナー案・2026-11-08）。上位3つを3列に並べた比較表
  //   邪眼は「複数の特性が重なると、どんな反応のまとまりとして見えるか」、異相は「その特性そのものは何を意味し、自分にどう当てはまるか」
  const matrix = (cols, rows, get) => `<div class="dp-matrix" style="--cols:${cols.length}">
      <div class="dp-mx-corner"></div>${cols.map((c) => `<div class="dp-mx-col" style="--c:${c.c}"><span class="dp-rk">${pad(c.rank)}</span><b>${E(c.label)}</b><small>${E(c.sub)}</small><em>${c.score}</em></div>`).join('')}
      ${rows.map(([key, name]) => `<div class="dp-mx-row${key === 'accept' || key === 'live' ? ' em' : ''}">${E(name)}</div>${cols.map((c) => `<div class="dp-mx-cell${key === 'accept' ? ' accept' : ''}" style="--c:${c.c}">${E(get(c, key))}</div>`).join('')}`).join('')}
    </div>`;
  page('dp-wide', 'TOP THEMES · JAGAN', '上位の邪眼との付き合い方', `<p class="dp-p dp-lead">${E(m.live.intro)}</p>
    ${matrix(m.topE.map((e) => ({ rank: e.rank, label: e.label, sub: e.name, score: e.score, c: e.color.main, src: e.live })), m.live.rows, (c, k) => c.src[k])}
    <p class="dp-note">水・草・岩などの邪眼を「才能」として説明するのではなく、自分の中で起きていることに気づくための見取り図として使います。ここに書いた反応が、いつもあなたに起きているという意味ではありません。</p>`, { sub: 'Top themes' });
  page('dp-wide', 'TOP THEMES · ISOU', '上位の異相を読み解く', `<p class="dp-p dp-lead">${E(m.read.intro)}</p>
    ${matrix(m.topI.map((x) => ({ rank: x.rank, label: x.label, sub: x.text.axis, score: x.score, c: x.color, src: x.read })), m.read.rows, (c, k) => c.src[k])}
    <p class="dp-note">主結果としての異相は一つ（${E(is1.label)}）のままです。このページでは、上位の三つを読み比べて、自分の経験を説明する言葉を探します。</p>`, { sub: 'Top themes' });

  // P12–P17 上位3つの邪眼・異相の個別ページ（オーナー案・2026-11-08。元素診断の個別ページと同じ組み立て）
  //   見出し（紋章・名称・一行・順位と得点・次点との差）→ 根拠の札 → 左：あなたの場合・一文・ある日の場面・根拠の棒 → 右：場面・伝わり方・負担のサイン・付き合い方
  //   「この邪眼が弱いとき」は個別ページに置かない（低い場合の一般論は辞典・下位のページへ）
  const L = m.detailLabels;
  const dHead = (o) => `<div class="dp-dh" style="--c:${o.c}">
      <div class="dp-demb">${o.emblem}</div>
      <div class="dp-dmain"><div class="dp-dkick">${E(o.kick)}</div><div class="dp-dname"><b>${E(o.label)}</b><span>── ${E(o.head)}</span></div><p class="dp-dtag">${E(o.tagline)}</p></div>
      <div class="dp-drank"><div class="dp-drk">RANK <b>${pad(o.rank)}</b></div><div class="dp-dsc">${o.score}<small>/100</small></div>${o.next ? `<div class="dp-dnext">次点 ${E(o.next.label)} ${o.next.score}　<b>${o.next.d >= 0 ? '+' : ''}${o.next.d}</b></div>` : ''}</div>
    </div>`;
  const side = (d, c) => `<div class="dp-dside">
      <div class="dp-dc"><div class="dp-dck">${E(L.scenes)}</div><p>${E(d.scenes)}</p></div>
      <div class="dp-dc"><div class="dp-dck">${E(L.inner)}</div><p>${E(d.inner)}</p></div>
      <div class="dp-dc sign"><div class="dp-dck">${E(L.signs)}</div><p>${E(d.signs)}</p></div>
      <div class="dp-dc live" style="--c:${c}"><div class="dp-dck">${E(L.coexist)}</div><p>${E(d.coexist)}</p></div>
    </div>`;
  const youBlock = (d, c) => `<div class="dp-dsec" style="--c:${c}">${E(L.you)}</div>${d.you.map((t) => `<p class="dp-p">${E(t)}</p>`).join('')}
      <div class="dp-daccept" style="--c:${c}"><span>${E(L.accept)}</span>${E(d.accept)}</div>
      <div class="dp-dday"><div class="dp-dck">${E(L.day)}</div><p>${E(d.day)}</p></div>`;
  for (const e of m.topE) {
    const d = e.detail, c = e.color.main;
    page('dp-wide dp-detail', `JAGAN ${pad(e.rank)}`, `邪眼 ${e.rank}位 — ${e.label}`, `
      ${dHead({ c, rank: e.rank, score: e.score, next: d.next, label: e.label, head: d.head, tagline: d.tagline, kick: `JAGAN ${pad(e.rank)} · ${e.name}`,
        emblem: `<img src="/assets/emblems/jagan/record/${{ PY: 'pyro', HY: 'hydro', CR: 'cryo', EL: 'electro', AN: 'anemo', GE: 'geo', DE: 'dendro' }[e.id]}.png" alt="${E(e.label)}の邪眼の証" width="120" height="120">` })}
      <div class="dp-dchips"><span class="dp-dchk">${E(L.basisE)}</span>${e.parts.map((x) => `<span class="dp-dchip${x.id === d.core ? ' core' : ''}" style="--c:${c}">${E(x.label)} ${x.score}<i>重み ${x.weight}%</i>${x.id === d.core ? '<em>核</em>' : ''}</span>`).join('')}</div>
      <div class="dp-dsplit"><div>
        ${youBlock(d, c)}
        <div class="dp-dbasis"><div class="dp-dck">${E(L.basisE)}　<small>計算上の重み：${e.parts.map((x) => `${E(x.label)}${x.weight}%`).join('・')}</small></div>
          ${e.parts.map((x) => `<div class="dp-row"><span>${E(x.label)}<small>重み ${x.weight}%</small></span>${bar(x.score, c)}<b>${x.score}</b></div>`).join('')}</div>
        ${e.fatui.length ? `<p class="dp-li">この邪眼に連なるファトゥス：${e.fatui.map((f) => `${fatuiName(f)}（${f.rank}位）`).join('　')}</p>` : ''}
      </div>${side(d, c)}</div>`);
  }
  for (const x of m.topI) {
    const d = x.detail, c = x.color;
    page('dp-wide dp-detail', `ISOU ${pad(x.rank)}`, `異相 ${x.rank}位 — ${x.label}`, `
      ${dHead({ c, rank: x.rank, score: x.score, next: d.next, label: x.label, head: x.text.axis, tagline: d.tagline, kick: `ISOU ${pad(x.rank)} · ${x.aspect.code}`,
        emblem: `<span class="dp-dcode">${E(x.aspect.code)}</span>` })}
      <div class="dp-dchips"><span class="dp-dchk">${E(L.basisI)}</span><span class="dp-dchip core" style="--c:${c}">12特性中 ${x.rank}位</span><span class="dp-dchip" style="--c:${c}">得点 ${x.score}</span><span class="dp-dchip" style="--c:#85707a">12特性の平均 ${d.overall}</span>${d.inc.map((e) => `<span class="dp-dchip" style="--c:${e.color}">${E(e.label)}の計算に含まれる</span>`).join('')}</div>
      <div class="dp-dsplit"><div>
        <div class="dp-dmeans" style="--c:${c}"><div class="dp-dck">${E(L.means)}</div><p>${E(d.means)}</p></div>
        ${youBlock(d, c)}
        <div class="dp-dbasis"><div class="dp-dck">${E(L.basisI)}　<small>前後の順位</small></div>
          ${d.near.map((t) => `<div class="dp-row${t.self ? ' self' : ''}"><span style="color:${t.color}">${pad(t.rank)}　${E(t.label)}</span>${bar(t.score, t.color)}<b>${t.score}</b></div>`).join('')}</div>
        <p class="dp-note">${E(x.copy.limit)}</p>
      </div>${side(d, c)}</div>`);
  }

  // P18 邪眼×異相――あなたの影はどう表れるか（オーナー案・2026-11-08）。計算上の関係 → 重なりの読み方 → 日常の例・根拠 → 理解／負担／受け止め／問い
  { const c = m.combo, CL = c.labels;
    page('dp-wide dp-combo', 'JAGAN × ISOU', CL.title, `
      <div class="dp-cbar">
        <div class="dp-ccard" style="--c:${c.e.color}"><div class="dp-lk">邪眼<span>· 1位</span></div><b>${E(c.e.label)}</b><p>${E(c.e.sub)}</p></div>
        <div class="dp-clink" style="--a:${c.e.color};--b:${c.x.color}"><i></i><span class="${c.inc ? 'inc' : 'sep'}">${E(c.tag)}</span></div>
        <div class="dp-ccard" style="--c:${c.x.color}"><div class="dp-lk">異相<span>· 1位</span></div><b>${E(c.x.label)}</b><p>${E(c.x.sub)}</p></div>
      </div>
      <p class="dp-crel"><span>計算上の関係</span>${E(c.relation)}</p>
      <div class="dp-chead">${E(c.headline)}</div>
      <div class="dp-dsplit"><div>
        <div class="dp-dsec" style="--c:${c.x.color}">${E(CL.you)}</div>${c.you.map((t) => `<p class="dp-p">${E(t)}</p>`).join('')}
      </div><div class="dp-panel">
        <div class="dp-pk">${E(CL.day)}</div>
        ${c.day.map((d) => `<div class="dp-cday${d.note ? ' note' : ''}">${d.head ? `<b>${E(d.head)}</b>` : ''}<p>${E(d.text)}</p></div>`).join('')}
        <div class="dp-pk" style="margin-top:14px">${E(CL.basis)}</div>
        <table class="dp-ctab"><thead><tr><th>特性</th><th>得点</th><th>この組み合わせで見ること</th></tr></thead><tbody>
        ${c.rows.map((r) => `<tr class="${r.self ? 'self' : ''}${r.sep ? ' sep' : ''}"><td style="color:${r.color}">${E(r.label)}${r.sep ? '<small>異相</small>' : ''}</td><td>${r.score}</td><td>${E(r.see)}</td></tr>`).join('')}
        </tbody></table>
      </div></div>
      <div class="dp-c4">
        <div class="dp-c4c ok"><b>${E(CL.aware)}</b><p>${E(c.aware)}</p></div>
        <div class="dp-c4c ng"><b>${E(CL.heavy)}</b><p>${E(c.heavy)}</p></div>
        <div class="dp-c4c ac" style="--c:${c.x.color}"><b>${E(CL.accept)}</b><p>${E(c.accept)}</p></div>
        <div class="dp-c4c qq"><b>${E(CL.q)}</b><p>「${E(c.q)}」</p></div>
      </div>`, { sub: 'Two layers' });
  }

  // P19 上位3名のファトゥスとの交わり（オーナー案・2026-11-08。元素診断「MIRROR 上位3名との交わり」と同じ組み立て）
  //   「二層統合」は削除（邪眼×異相のページで重なりを説明する）
  { const M = m.mirror, ML = M.labels;
    page('dp-wide dp-mirror', ML.kicker, ML.title, `<p class="dp-p dp-lead">${E(ML.intro)}</p>
      ${M.people.map((p) => { const f = p.f; return `<article class="dp-mcard" style="--c:${f.elements[0] || '#C8405C'}">
        <header class="dp-mch"><span class="dp-mrk">${pad(f.rank)}</span><i class="dot" style="background:${f.elements[0] || '#C8405C'}"></i><span class="dp-mname">${fatuiName(f)}</span>
          <span class="dp-mmeta"><b>一致度 ${f.match}%</b><i>${E(f.title)}</i><i>${E(f.region || '—')}</i>${f.tags.map((t) => `<i class="tag">${E(t)}</i>`).join('')}</span></header>
        <p class="dp-mstory"><span>${E(ML.story)}</span>${E(f.copy.story_context)}</p>
        <div class="dp-mvals">${p.rows.map((r) => `<span class="${r.diff <= 15 ? 'near' : r.diff >= 20 ? 'far' : ''}">${E(r.label)}<b>${r.you}</b><small>／参照 ${r.ref}</small></span>`).join('')}</div>
        <dl class="dp-mdl"><dt>${E(ML.aligned)}</dt><dd>${E(p.aligned)}</dd><dt>${E(ML.different)}</dt><dd>${E(p.different)}</dd>
          <dt>${E(ML.main)}</dt><dd>${E(p.main)}</dd><dt class="gold">${E(ML.you)}</dt><dd>${E(p.you)}</dd></dl>
      </article>`; }).join('')}
      <div class="dp-msum"><div class="dp-pk">${E(ML.sumTitle)}</div>${M.sum.map((t) => `<p>${E(t)}</p>`).join('')}</div>
      <p class="dp-note">${E(ML.refNote)}</p>`, { sub: ML.sub });
  }

  // 四つの反応領域（オーナー案・2026-11-08。元素診断「四つの貢献ドメイン」の2×2を引き継ぐ）→ あなたの反応領域（内訳と解釈。平均の順位はつけない）
  { const R = m.rdom, codeOf = (id) => m.isous.find((x) => x.id === id).aspect.code;
    page('dp-wide dp-rdom', R.kicker, R.title, `<p class="dp-p dp-lead">${E(R.intro)}</p>
      <div class="dp-rd4">${R.list.map((d) => `<div class="dp-rdc" style="--c:${d.color}"><div class="dp-rden">${E(d.en)}</div><div class="dp-rdname">${E(d.label)}</div><p class="dp-rdlead">${E(d.lead)}</p>
        <div class="dp-rdtags">${d.ts.map((t) => `<span>${E(codeOf(t.id))} ${E(t.label)}</span>`).join('')}</div>
        <p class="dp-rdread"><b>${E(R.readLabel)}</b>${E(d.read)}</p></div>`).join('')}</div>
      <table class="dp-rdtab"><thead><tr>${R.tableHead.map((h) => `<th>${E(h)}</th>`).join('')}</tr></thead><tbody>
      ${R.list.map((d) => `<tr><td style="color:${d.color}">${E(d.label)}</td><td>${d.ts.map((t) => E(t.label)).join('・')}</td><td>${E(d.q)}</td></tr>`).join('')}</tbody></table>
      <p class="dp-note">${E(R.note)}</p>`, { sub: R.sub });
    page('dp-wide dp-rdom', R.youKicker, R.youTitle, `<p class="dp-p dp-lead">${E(R.youIntro)}</p>
      ${R.list.map((d) => `<div class="dp-rdrow" style="--c:${d.color}">
        <div class="dp-rdl"><div class="dp-rden">${E(d.en)}</div><div class="dp-rdname">${E(d.label)}</div><p>${E(d.lead)}</p></div>
        <div class="dp-rdbars">${d.ts.map((t) => `<div class="dp-row"><span><i>${E(codeOf(t.id))}</i>${E(t.label)}</span>${bar(t.score, d.color)}<b>${t.score}</b></div>`).join('')}</div>
        <div class="dp-rdyou"><b>${E(R.labels.you)}</b>${d.you.map((t) => E(t)).join('')}</div>
      </div>`).join('')}
      <div class="dp-msum"><div class="dp-pk">${E(R.labels.think)}</div><p>${E(R.think)}</p></div>
      <p class="dp-note">${E(R.note)}</p>`, { sub: R.youSub });
  }

  // あなたの影に、次の一手を（オーナー案・2026-11-08。元素診断「カテゴリ別・7日間の観察実験」の組み立てを引き継ぐ）
  { const X = m.next, ex = X.example, blank = '<span class="dp-blank"></span>';
    page('dp-wide dp-next', X.kicker, X.title, `<p class="dp-p dp-lead">${E(X.intro)}</p>
      <div class="dp-ac3">${X.steps.map((s, i) => `<div class="dp-acs"><span class="dp-nnum">${i + 1}</span><b>${E(s.k)}</b><small>${E(s.head)}</small><p>${E(s.text)}</p>
        ${i === 0 ? `<div class="dp-nhint"><span>${E(X.hint)}</span>${X.hints.map((h) => `<i style="--c:${h.color}">${E(h.label)}</i>`).join('')}</div>` : ''}</div>`).join('')}</div>
      <div class="dp-nex" style="--c:${m.isou.color}"><div class="dp-pk">${E(X.exampleLabel)}　<small>${E(X.exampleFor)}</small></div>
        <div class="dp-nextitle">${E(ex.title)}</div><p>${E(ex.action)}</p>
        <p class="dp-nref"><b>${E(X.reflectLabel)}</b>${E(ex.reflect)}</p><p class="dp-note">${E(X.exampleNote)}</p></div>
      <div class="dp-nwrite"><div class="dp-pk">${E(X.writeTitle)}</div>
        <p>${E(X.write[0])}${blank}${E(X.write[1])}<br>${E(X.write[2])}${blank}${E(X.write[3])}<br>${blank}${E(X.write[4])}</p></div>
      <div class="dp-nlog"><div class="dp-pk">${E(X.logTitle)}　<small>${E(X.logNote)}</small></div>
        <table class="dp-ctab"><thead><tr>${X.logHead.map((h) => `<th>${E(h)}</th>`).join('')}</tr></thead><tbody>
        <tr class="eg"><td>例</td>${ex.log.map((t) => `<td>${E(t)}</td>`).join('')}</tr>
        ${Array.from({ length: X.logRows }, () => '<tr class="w"><td></td><td></td><td></td><td></td></tr>').join('')}</tbody></table></div>
      <div class="dp-nafter"><div class="dp-pk">${E(X.afterTitle)}</div><div class="dp-nopts">${X.after.map((a) => `<div><span>□</span><b>${E(a.k)}</b><p>${E(a.text)}</p></div>`).join('')}</div></div>
      <div class="dp-acclose">${E(X.closing)}</div>`, { sub: X.sub });
  }

  // P29 人物から得るもの
  page('dp-text', 'FROM FATUI', '人物から得るもの', `<p class="dp-p">上位3名の物語から、あなたの影の扱い方として借りられる視点です。人物と同じ行動をとるという意味ではありません。</p>
    ${m.topF.map((f) => `<div class="dp-card" style="--c:${f.elements[0] || '#C8405C'}"><div class="dp-k">${fatuiName(f)}</div><p class="dp-p">${E(f.deep.gain)}</p><p class="dp-li">${E(f.copy.association_theme)}</p></div>`).join('')}`);

  // 再読 — あなたの影を読み直す（オーナー案・2026-11-08）。①結果の要点 → ②経験に照らす4つの問い（2×2・記入欄）→ ③書き換え → 読み返すページ（番号は構成から自動）
  { const RR = m.reread, num = (t) => PAGE_TITLES.indexOf(t) + 1;
    page('dp-wide dp-reread', RR.kicker, RR.title, `<p class="dp-p dp-lead">${E(RR.intro)}</p>
      <div class="dp-rr1"><div class="dp-pk">① ${E(RR.s1)}</div>
        <div class="dp-rrhead"><span style="color:${RR.eColor}">${E(RR.head.split('／')[0])}</span>／<span style="color:${RR.xColor}">${E(RR.head.split('／')[1])}</span></div>
        <p>${E(RR.r1)}</p><p>${E(RR.r2)}</p>
        ${RR.more ? `<p class="dp-rrmore"><b>${E(RR.moreLabel || '')}${E('もう一つの注目点')}：<span style="color:${RR.more.color}">${E(RR.more.label)}${RR.more.score}</span></b>${E(RR.more.text)}</p>` : ''}
        <p class="dp-note">${E(RR.lowText)}</p></div>
      <div class="dp-pk" style="margin-top:4px">② ${E(RR.s2)}</div>
      <div class="dp-rrq">${RR.questions.map((q) => `<div class="dp-acb"><b>${E(q.k)}</b><p>${E(q.q)}</p><span class="dp-wline"></span><span class="dp-wline"></span></div>`).join('')}</div>
      <p class="dp-rrhint"><span>${E(RR.exFor)}が上位のあなたへ</span>${E(RR.ex.hint)}</p>
      <div class="dp-pk" style="margin-top:12px">③ ${E(RR.s3)}</div>
      <div class="dp-rr3">${[RR.ex.before, RR.ex.now, RR.ex.check].map((eg, i) => `<div class="dp-acb"><b>${E(RR.rewrite[i])}</b><small>例：${E(eg)}</small><span class="dp-wline"></span><span class="dp-wline"></span></div>`).join('')}</div>
      <div class="dp-rrlinks"><span>${E(RR.linksTitle)}</span>${RR.links.map(([k, t]) => `<a href="#dp${pad(num(t))}"><small>${E(k)}</small>P${pad(num(t))} ${E(t)}</a>`).join('')}</div>
      <div class="dp-acclose">${E(RR.closing)}</div>`, { sub: RR.sub });
  }

  // 辞典（元素診断の「元素辞典」「VALUES辞典」と同じ組み立て。あなたの得点・順位を表示する）
  { const D = m.dict, DL = D.labels;
    page('dp-wide dp-dictw', D.eKicker, D.eTitle, `<p class="dp-p dp-lead">${E(D.eIntro)}</p>
      <div class="dp-edict">${m.elements.map((e) => `<div class="dp-edc" style="--c:${e.color.main}">
        <div class="dp-edh"><span class="dp-rk">${pad(e.rank)}</span><b>${E(e.label)}</b><small>${E(e.name)}｜${E(e.text.axis)}</small><em>${e.score}</em></div>
        ${bar(e.score, e.color.main)}
        <p class="dp-edess">${E(e.text.essence)}</p>
        <div class="dp-edcols"><div><span>${E(DL.scenes)}</span><p>${E(e.detail2.scenes)}</p></div>
          <div><span>${E(DL.parts)}</span><p>${e.parts.map((x) => `${E(x.label)}<b>${x.score}</b><i>重み${x.weight}%</i>`).join('　')}</p></div></div>
        <div class="dp-edmis"><span>${E(DL.misread)}</span><p>${E(e.misread)}</p></div></div>`).join('')}</div>`, { sub: D.sub });
    D.groups.forEach((g, gi) => page('dp-wide dp-dictw', D.iKickers[gi], D.iTitles[gi], `<p class="dp-p dp-lead">${E(D.iIntro)}</p>
      ${g.map((d) => `<div class="dp-idgrp" style="--d:${d.color}"><div class="dp-idgh">${E(d.en)}　<b>${E(d.label)}</b></div>
        ${d.items.map((x) => `<div class="dp-idc" style="--c:${d.color}">
          <div class="dp-idh"><span class="dp-idcode">${E(x.aspect.code)}</span><b>${E(x.label)}</b><em>${x.score}</em><small>12特性中 ${x.rank}位</small></div>
          <div class="dp-idbar"><span>低</span><i><u style="width:${Math.max(1, x.score)}%"></u><s style="left:${x.score}%"></s></i><span>高</span></div>
          <p class="dp-idmean"><b>${E(DL.means)}：</b>${E(x.read.means)}</p>
          <div class="dp-edcols"><div><span>${E(DL.hi)}</span><p>${E(x.copy.hi)}</p></div><div><span>${E(DL.lo)}</span><p>${E(x.copy.lo)}</p></div></div>
          <div class="dp-edmis"><span>${E(DL.misread)}</span><p>${E(x.read.notSame)}</p></div></div>`).join('')}</div>`).join('')}`, { sub: D.sub }));
  }

  if (pages.length !== TOTAL) throw new Error(`page_count_${pages.length}`);
  return pages.join('\n');
}
