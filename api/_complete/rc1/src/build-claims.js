// build-claims.js — judgments → claims + traces → 46ページ view model。
// 本文は査読済み辞書の意味単位を決定論的に組み合わせる（実行時に生成AIは使わない）。
// 各文は C() を通り、根拠値・規則・辞書IDを claim trace に残す。数値は evidence 側に置き、narrative では語らない。
'use strict';
// 【サーバー用 Web 版・2026-10-08】MENTOR 目標の文言を HTML の本文へ入れる2か所（P36・P38）でエスケープするよう変えた（prototypes の同名ファイルとの違いはこれだけ）。
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const { loadContent } = require('./content-store');
const { makeJudge, RULES, LAYER_OF } = require('./judgments');
const { displayName } = require('./engine');
const { makePolarity } = require('./polarity');

const COPY_VERSION = 'CORE1-COPY-RULES-1.0.0';
const ELEMENT_CODE = { '炎': 'PY', '水': 'HY', '氷': 'CR', '雷': 'EL', '風': 'AN', '岩': 'GE', '草': 'DE' };
const WEAPON_CODE = { '片手剣': 'SW', '両手剣': 'CM', '長柄': 'PL', '法器': 'CT', '弓': 'BW' };
const NATION_CODE = { 'モンド': 'M', '璃月': 'L', '稲妻': 'I', 'スメール': 'S', 'フォンテーヌ': 'F', 'ナタ': 'N', 'スネージナヤ': 'Z', 'ナドクライ': 'D' };
// 本番 index.html の TYPE_NAME と同じ35タイプ名（承認済み type registry）
const TYPE_NAME = {
  '炎': { '片手剣': '殉愛者', '両手剣': '猛進者', '長柄': '殉衛者', '法器': '信奉者', '弓': '貫徹者' },
  '水': { '片手剣': '同調者', '両手剣': '孤淵者', '長柄': '静衛者', '法器': '深識者', '弓': '静観者' },
  '氷': { '片手剣': '宿縁者', '両手剣': '破氷者', '長柄': '氷壁者', '法器': '透徹者', '弓': '凍眼者' },
  '雷': { '片手剣': '共鳴者', '両手剣': '破天者', '長柄': '雷衛者', '法器': '電導者', '弓': '疾光者' },
  '風': { '片手剣': '随風者', '両手剣': '疾風者', '長柄': '客衛者', '法器': '漂識者', '弓': '追風者' },
  '岩': { '片手剣': '包容者', '両手剣': '破岩者', '長柄': '護衛者', '法器': '礎識者', '弓': '遠護者' },
  '草': { '片手剣': '縁結者', '両手剣': '芽吹者', '長柄': '育衛者', '法器': '叡結者', '弓': '見守者' },
};
const LAYER_JA = { personality: '気質', style: 'スタイル', values: '価値観' };
const KIND_JA = { element: '元素', weapon: '武器種', nation: '国家' };
const KIND_WORD = { element: '気質', weapon: 'スタイル', nation: '価値観' };
const REL_FRAME = {
  alignment: '二つは、同じ方向を指しています。',
  complement: 'この二つは同じことの言い換えではなく、互いに欠けている部分を補い合います。',
  tension: '二つは向きが異なり、場面によって引っ張り合うことがあります。',
  conditional: '二つは、条件によって協力にも緊張にもなります。',
};
const strip = (s) => s.replace(/。$/, '');
// 過剰使用の文（「〜する。〜する。」）の最初の一文を「〜することがあります。」へ
const overuseClause = (s) => strip(s.split('。')[0]) + 'ことがあります。';


function buildClaims(snap) {
  const K = loadContent();
  const J = makeJudge(snap);
  const AX = K.axes.axes;
  const PL = makePolarity(snap, K.axes);   // 高得点側・低得点側の本文化はすべて polarity.js を通す
  const COPE = K.coping.items;
  const claims = [];
  // ---------- claim 登録 ----------
  function C(page, id, text, o = {}) {
    if (typeof text !== 'string' || !text.trim()) throw new Error(`empty claim ${page}-${id}`);
    claims.push({
      claim_id: `${page}-${id}`, page_id: page, text,
      kind: o.kind || 'editorial_hypothesis', evidence: o.evidence || [], rule_id: o.rule || 'CORE1-COPY-COMPOSE-1.0.0', rule_version: COPY_VERSION,
      content_id: o.content || null, assertion_strength: o.strength || 'balanced',
    });
    return text;
  }
  const axPath = (ax) => `axes.${LAYER_OF[ax]}.${ax}`;
  const evAx = (...axes) => axes.filter(Boolean).map((ax) => ({ path: axPath(ax), value: J.av(ax) }));
  const evRank = (kind, row) => [{ path: `rankings.${kind}[${row.rank - 1}].display`, value: row.display }, { path: `rankings.${kind}[${row.rank - 1}].distance`, value: row.distance }];
  // ---------- 辞書アクセス ----------
  const DICT = { element: K.elements.items, weapon: K.weapons.items, nation: K.nations.items };
  const item = (kind, key) => { const x = DICT[kind][key]; if (!x) throw new Error(`missing content ${kind}:${key}`); return x; };
  const R = snap.rankings;
  const top = { element: R.element[0], weapon: R.weapon[0], nation: R.nation[0] };
  const T = { element: item('element', top.element.key), weapon: item('weapon', top.weapon.key), nation: item('nation', top.nation.key) };
  const flat = snap.values_flat;
  // 軸の言い回し
  // 軸の名詞句は必ず「軸名（本人の実際の側）」。呼び出し側の想定で側を決めない（極性を反転させない）
  const noun = (ax) => PL.noun(ax);
  const pred = (ax, sd) => (sd === 'lo' ? AX[ax].lo : AX[ax].hi);
  const nm = (ax) => AX[ax].name;
  const tendency = (ax) => (J.isV(ax) ? '並び' : '傾向');
  // 本人がどちら側にいるか。中央域（P/S 36〜64・VALUES |centered|<8）と neutral は方向として書かない（CORE1-NEUTRAL-1.0.0）
  const youAt = (ax, userSide) => (userSide === 'neutral' || J.band(ax) === 'mid' ? 'あなたは中央域にあり、どちらの方向にも強くは偏っていません' : `あなたは${strip(pred(ax, userSide))}側にあります`);
  // 「数値の山/谷は A と B。A は〜側、B は〜側として現れやすい。」中央域の軸は方向を付けずに別に書く
  const factTail = (axes) => {
    const dir = axes.filter((a) => PL.directional(a)), mid = axes.filter((a) => !PL.directional(a));
    const parts = [];
    if (dir.length) parts.push(`${dir.map((a) => `${nm(a)}は${PL.pole(a)}`).join('、')}として現れやすい`);
    if (mid.length) parts.push(`${mid.map(nm).join('と')}は中央域で、強い偏りはない`);
    return parts.join('。') + '。';
  };
  const pairOf = (kindA, a, kindB, b) => {
    const store = kindA === 'element' ? (kindB === 'weapon' ? K.pairEW : K.pairEN) : K.pairWN;
    const x = store.items[`${a}×${b}`]; if (!x) throw new Error(`missing pair ${a}×${b}`); return x;
  };

  // ---------- 人物の一行（資料タグを本人との関係で2つ選び、述語のある文にする） ----------
  const TAGS = K.chars.tags;
  function pickTags(ch, lens, ctx = {}) {
    const diffs = Object.fromEntries(J.charDiffs(ch).map((d) => [d.axis, d]));
    const used = ctx.used || {};
    const scored = ch.basis_tags.map((t, i) => {
      const axes = TAGS[t].axes;
      let s = Math.min(...axes.map((a) => diffs[a].absDiff + (diffs[a].userSide === diffs[a].charSide ? 0 : 60)));
      if (lens === 'mentor' && ctx.goalAxes && axes.some((a) => ctx.goalAxes.includes(a)) && (used[t] || 0) < 2) s -= 100;
      s += (used[t] || 0) * 25; // 同じリストで同じ言い回しが続かないように
      return { t, i, s };
    }).sort((a, b) => (a.s - b.s) || (a.i - b.i));
    const out = [];
    scored.forEach((x) => { if (out.length < 2 && !out.some((y) => TAGS[y.t].end === TAGS[x.t].end)) out.push(x); });
    out.forEach((x) => { used[x.t] = (used[x.t] || 0) + 1; });
    return out.map((x) => x.t);
  }
  // 文型を三つ用意し、リストの中で順に使う（同一文型の連続を避ける）
  const LINE_PATTERNS = [
    (a, b) => `${a.te}、${b.end}。`,
    (a, b) => `${a.end}。${b.end}。`,
    (a, b) => `${b.te}、${a.end}。`,
  ];
  function charLine(page, ch, lens, ctx = {}) {
    const [t1, t2] = pickTags(ch, lens, ctx);
    // 同じリストに同じ文が二度出ないよう、文型をずらして重複を避ける
    const seen = ctx.seen || new Set();
    let pi = (ctx.index || 0) % LINE_PATTERNS.length;
    for (let k = 0; k < LINE_PATTERNS.length && seen.has(LINE_PATTERNS[pi](TAGS[t1], TAGS[t2])); k++) pi = (pi + 1) % LINE_PATTERNS.length;
    seen.add(LINE_PATTERNS[pi](TAGS[t1], TAGS[t2]));
    return C(page, `CHAR-${lens}-${ch.canonicalIndex}`, LINE_PATTERNS[pi](TAGS[t1], TAGS[t2]), { rule: 'CORE1-CHAR-LINE-1.1.0', content: `CHAR_LANGUAGE.${t1}+${t2}.pattern${pi}`, kind: 'model_interpretation',
      evidence: [{ path: `character.${ch.name}.basis_tags`, value: [t1, t2] }, ...TAGS[t1].axes.concat(TAGS[t2].axes).filter((a, i, s2) => s2.indexOf(a) === i).map((a) => ({ path: axPath(a), value: J.av(a) }))] });
  }
  const axisPhraseVs = (d, who) => `${who}は${pred(d.axis, who === 'あなた' ? d.userSide : d.charSide)}側`;

  // ============ P01 表紙 ============
  const typeCode = ELEMENT_CODE[top.element.key] + WEAPON_CODE[top.weapon.key] + '-' + NATION_CODE[top.nation.key];
  const typeName = TYPE_NAME[top.element.key][top.weapon.key];
  if (!typeName || !NATION_CODE[top.nation.key]) { const e = new Error('STOP: type registry cannot reproduce code/name'); e.stop = 11; throw e; }
  const vm = { snap, typeCode, typeName, top, T, flat, claims };
  vm.cover = { label: '元素診断', title: '完全解析｜CORE1', code: typeCode, name: typeName,
    combo: [top.element.name, top.weapon.name, top.nation.name], image: T.element.visual.image, bg: T.element.visual.cover_bg, flatNation: flat };
  C('P01', 'TYPE', `${typeCode} ${typeName}`, { kind: 'calculated_fact', rule: 'TYPE_REGISTRY_INDEX_HTML', evidence: [
    { path: 'rankings.element[0].key', value: top.element.key }, { path: 'rankings.weapon[0].key', value: top.weapon.key }, { path: 'rankings.nation[0].key', value: top.nation.key }] });

  // ============ 共通の判定 ============
  const P_S = [...Object.keys(snap.axes.personality), ...Object.keys(snap.axes.style)];
  const VA = Object.keys(snap.axes.values);
  const psHi = [...P_S].sort((a, b) => (J.av(b) - J.av(a)) || a.localeCompare(b));
  const vHi = [...VA].sort((a, b) => (J.userCentered[b] - J.userCentered[a]) || a.localeCompare(b));
  const highs = [psHi[0], flat ? psHi[1] : vHi[0]];
  const lows = [psHi[psHi.length - 1], flat ? psHi[psHi.length - 2] : vHi[vHi.length - 1]];
  // 緊張と並存：緊張は「同じ場面で異なる行動を要求し、一方を優先すると他方が損なわれる」規則（conflict_scene あり）だけ。
  // それ以外は並存として扱い、「緊張」と呼ばない。緊張を優先し、足りない分を並存で補う。
  const matched = K.rules.tensions.map((t) => ({ t, m: J.matchRule(t) })).filter((x) => x.m.ok);
  const order2 = (a, b) => (b.m.strength - a.m.strength) || a.t.id.localeCompare(b.t.id);
  const tensions = [...matched.filter((x) => x.t.type === 'tension' && x.t.conflict_scene).sort(order2), ...matched.filter((x) => x.t.type === 'coexist').sort(order2)].slice(0, 2);
  const genericCoexist = (i) => {
    const hi = psHi[i], lo = psHi[psHi.length - 1 - i];
    return { t: { id: `C_GENERIC_${hi}_${lo}`, type: 'coexist', text: `${PL.label(hi)}と${PL.label(lo)}が、並存しています。`, axes: [hi, lo],
      question: `${nm(hi)}と${nm(lo)}は、今日どちらの比重が大きかったか。`, switch: `場面によって、${PL.label(hi)}と${PL.label(lo)}の比重が変わる。` },
    m: { evidence: evAx(hi, lo) } };
  };
  while (tensions.length < 2) tensions.push(genericCoexist(tensions.length));
  vm.tensions = tensions.map((x, i) => ({ id: x.t.id, type: x.t.type, axes: x.t.axes, conflict_scene: x.t.conflict_scene || null,
    text: C('P03', `TENSION-${i + 1}`, x.t.text, { rule: RULES.tension, content: x.t.id, evidence: [...x.m.evidence, ...(x.t.conflict_scene ? [{ path: 'rule.conflict_scene', value: x.t.conflict_scene }] : [])], kind: 'model_interpretation' }),
    question: x.t.question, switch: x.t.switch }));
  const nT = vm.tensions.filter((t) => t.type === 'tension').length;
  vm.tensionHeading = nT === 2 ? '二つの内的緊張' : nT === 1 ? '一つの緊張と、並存する傾向' : '場面によって比重が変わる二つの基準';
  vm.tensionHeadingEn = nT === 2 ? 'TENSIONS' : nT === 1 ? 'TENSION · COEXIST' : 'COEXIST';
  vm.question = C('P03', 'QUESTION', vm.tensions[0].question, { rule: RULES.tension, content: vm.tensions[0].id + '.question', evidence: tensions[0].m.evidence });
  vm.highs = highs; vm.lows = lows;

  // ============ P03 あなたの核 ============
  const layerSentence = (kind) => {
    const rows = R[kind], it1 = item(kind, rows[0].key), g = J.gapState(rows[0], 'next');
    // 同じ語尾が三回続かないよう、層ごとに文型を変える（意味は同じ：一位と、二位との近さ）
    const V3 = {
      element: { close: `気質では、${strip(it1.one_liner)}${rows[0].name}が一位にあり、すぐ後ろに${rows[1].name}が並びます。`, clear: `気質では、${strip(it1.one_liner)}${rows[0].name}が一位にあり、次点の${rows[1].name}とは差があります。`, moderate: `気質では、${strip(it1.one_liner)}${rows[0].name}が一位にあり、${rows[1].name}がそれに続きます。` },
      weapon: { close: `動き方を表すスタイルでは${rows[0].name}が最も近く、${rows[1].name}もほぼ同じ近さにあります。${rows[0].name}は、${it1.one_liner}`, clear: `動き方を表すスタイルでは${rows[0].name}がはっきり一位です。${rows[0].name}は、${it1.one_liner}`, moderate: `動き方を表すスタイルでは${rows[0].name}が最も近く、${rows[1].name}が次に来ます。${rows[0].name}は、${it1.one_liner}` },
      nation: { close: `選び方を表す価値観では${rows[0].name}が首位ですが、${rows[1].name}との差はわずかです。どちらも、${it1.short_theme}に近い並びです。`, clear: `選び方を表す価値観では、「${it1.short_theme}」の${rows[0].name}が首位で、二位以下とは差が開いています。`, moderate: `選び方を表す価値観では、「${it1.short_theme}」の${rows[0].name}が首位で、${rows[1].name}が続きます。` },
    };
    return C('P03', `LAYER-${kind}`, V3[kind][g.state], { content: `${kind.toUpperCase()}.${it1.id}.one_liner`, rule: RULES.gapLabels,
      strength: g.state === 'close' ? 'tentative' : 'balanced', evidence: [...evRank(kind, rows[0]), ...evRank(kind, rows[1])] });
  };
  vm.p03 = {
    story: [
      C('P03', 'FRAME', `${top.element.name}・${top.weapon.name}・${flat ? '（国家は判定なし）' : top.nation.name}という三つの結果は、同じ性格の言い換えではありません。<b>受け取り方、動き方、選び方</b>が、別々の層から読まれています。`, { rule: 'P03_FRAME' }),
      layerSentence('element') + layerSentence('weapon') + (flat ? C('P03', 'LAYER-nation', '価値観は、10の価値への回答がすべて同じ高さのため、国家の順位からは読みません。', { rule: 'VALUES_FLAT', kind: 'calculated_fact', evidence: [{ path: 'values_flat', value: true }] }) : layerSentence('nation')),
      C('P03', 'PEAKS', `数値の山は${PL.label(highs[0])}と${PL.label(highs[1])}です。${PL.extremeSentence('valley', lows)}`,
        { rule: 'CORE1-POLARITY-1.0.0.valley', kind: 'model_interpretation', evidence: evAx(...highs, ...lows) }),
    ],
    quote: C('P03', 'QUOTE', T.element.quote, { content: `ELEMENT.${T.element.id}.quote` }),
    facts: [
      { text: C('P03', 'FACT-1', `三層の一位は、${top.element.name}（${T.element.short_theme}）・${top.weapon.name}（${T.weapon.short_theme}）${flat ? '。価値観は判定なし' : `・${top.nation.name}（${T.nation.short_theme}）`}。`, { kind: 'calculated_fact', rule: 'TOP1_EACH_LAYER', evidence: [...evRank('element', top.element), ...evRank('weapon', top.weapon), ...evRank('nation', top.nation)] }),
        ev: `${top.element.name}${top.element.display}・${top.weapon.name}${top.weapon.display}${flat ? '' : '・' + top.nation.name + top.nation.display}` },
      { text: C('P03', 'FACT-2', `数値の山は${nm(highs[0])}と${nm(highs[1])}。${factTail(highs)}`, { kind: 'calculated_fact', rule: 'CORE1-POLARITY-1.0.0.peak', evidence: evAx(...highs) }),
        ev: highs.map((a) => `${nm(a)}${J.av(a)}`).join('・') },
      { text: C('P03', 'FACT-3', `数値の谷は${nm(lows[0])}と${nm(lows[1])}。${factTail(lows)}`, { kind: 'calculated_fact', rule: 'CORE1-POLARITY-1.0.0.valley', evidence: evAx(...lows) }),
        ev: lows.map((a) => `${nm(a)}${J.av(a)}`).join('・') },
    ],
  };
  const mirSel = snap.mirror.top10.find((r) => r.selected) || snap.mirror.top10[0];
  vm.p03.mirror = { name: mirSel.name, line: charLine('P03', mirSel, 'mirror') };

  // ============ P04–P06 全体順位 ============
  vm.overview = {};
  ['element', 'weapon', 'nation'].forEach((kind) => {
    const page = { element: 'P04', weapon: 'P05', nation: 'P06' }[kind];
    const rows = R[kind];
    const it = rows.map((r) => item(kind, r.key));
    const g = J.gapState(rows[0], 'next');
    let lead;
    if (kind === 'nation' && flat) lead = C(page, 'LEAD', '価値観の10軸への回答がすべて同じ高さのため、どの国家にも同じ近さが出ています。この結果では、国家の順位を意味のある違いとして読みません。', { rule: 'VALUES_FLAT', kind: 'calculated_fact', evidence: [{ path: 'values_flat', value: true }] });
    else if (g.state === 'close') lead = C(page, 'LEAD', `${rows[0].name}が一位です。ただし${rows[1].name}がすぐ後ろに並んでいるため、${strip(it[0].one_liner)}傾向だけでなく、${it[1].as_next}一つの名前だけで読まず、二つの重なりとして読みます。`, { rule: RULES.gapLabels, strength: 'tentative', content: `${kind}.${it[0].id}+${it[1].id}`, evidence: [...evRank(kind, rows[0]), ...evRank(kind, rows[1])] });
    else if (g.state === 'clear') lead = C(page, 'LEAD', `${rows[0].name}が一位で、次点の${rows[1].name}とは差があります。${it[0].intro}この傾向が、${KIND_WORD[kind]}の中で比較的はっきり表れています。`, { rule: RULES.gapLabels, content: `${kind}.${it[0].id}.intro`, evidence: [...evRank(kind, rows[0]), ...evRank(kind, rows[1])] });
    else lead = C(page, 'LEAD', `${rows[0].name}が一位で、${rows[1].name}が続きます。${it[0].intro}${it[1].as_next}`, { rule: RULES.gapLabels, content: `${kind}.${it[0].id}.intro`, evidence: [...evRank(kind, rows[0]), ...evRank(kind, rows[1])] });
    const bottoms = rows.filter((r) => r.band === 'bottom');
    const bDev = J.deviationOf(kind, bottoms[bottoms.length - 1]);
    const lowText = bDev && !(kind === 'nation' && flat)
      ? `${bottoms.map((r) => r.name).join('と')}。${bottoms[bottoms.length - 1].name}の型は${strip(pred(bDev.axis, bDev.protoSide))}${tendency(bDev.axis)}ですが、${youAt(bDev.axis, bDev.userSide)}。`
      : `${bottoms.map((r) => r.name).join('と')}。今の回答からは、自然には先に出にくい位置です。`;
    const layerAxes = Object.keys(snap.axes[{ element: 'personality', weapon: 'style', nation: 'values' }[kind]]);
    const order = [...layerAxes].sort((a, b) => (kind === 'nation' ? J.userCentered[b] - J.userCentered[a] : J.av(b) - J.av(a)) || a.localeCompare(b));
    const bandNote = kind === 'nation' && flat
      ? C(page, 'BAND', '価値観の10軸はすべて同じ高さで、山も谷もありません。どの価値を相対的に優先するかは、この回答からは読み取れません。', { rule: 'VALUES_FLAT', kind: 'calculated_fact' })
      : C(page, 'BAND', `この層の数値の山は${PL.label(order[0])}と${PL.label(order[1])}です。${PL.extremeSentence('valley', [order[order.length - 1]])}${kind === 'nation' ? '国家は価値の絶対的な高さではなく、この山と谷の並びの向きで決まります。' : '元の型の名前は、この山と谷の組み合わせが、どの型に近いかを表しています。'.replace('元の型の名前', KIND_JA[kind] + 'の名前')}`,
        { rule: 'CORE1-POLARITY-1.0.0.valley', kind: 'model_interpretation', evidence: evAx(order[0], order[1], order[order.length - 1]) });
    vm.overview[kind] = {
      lead, rows, bandNote, layerAxes,
      side: {
        what: { element: '刺激を受けた時、内側で最初に起こる反応の傾き（気質の5軸）を、比喩で表したものです。', weapon: '同じ価値を持つ人でも異なる、力の使い方を表します。', nation: '所属ではなく、迷った時に何を守るかという価値の翻訳です。' }[kind],
        top3: rows.slice(0, 3).map((r, i) => ({ name: r.name, theme: it[i].short_theme })),
        low: C(page, 'LOW', lowText, { rule: 'BOTTOM_DEVIATION', kind: 'model_interpretation', evidence: bDev ? evAx(bDev.axis) : [] }),
        strength: C(page, 'STRENGTH', it[0].natural_strength, { content: `${kind}.${it[0].id}.natural_strength` }),
        over: C(page, 'OVER', it[0].overuse_signs, { content: `${kind}.${it[0].id}.overuse_signs` }),
        use: [C(page, 'USE-1', it[0].optimal_use, { content: `${kind}.${it[0].id}.optimal_use` }), C(page, 'USE-2', it[1].optimal_use, { content: `${kind}.${it[1].id}.optimal_use` })],
      },
      pairNote: kind === 'weapon' && g.state === 'close'
        ? C(page, 'PAIRNOTE', `行動の主軸は${rows[0].name}ですが、${rows[1].name}がほぼ同じ近さで並んでいます。${it[1].as_next}どちらか一方の名前だけで自分を説明すると、半分を取りこぼします。`, { rule: RULES.gapLabels, strength: 'tentative', evidence: evRank(kind, rows[1]) }) : null,
    };
  });

  // ============ P07–P09 人物像 TOP10 ============
  const mir = snap.mirror.top10, hid = snap.hidden.top10, men = snap.mentor.top10;
  const mirNames = new Set(mir.map((r) => r.name));
  const goalAxes = snap.mentor.status === 'ok' ? snap.mentor.changes.map((c) => c.axis) : [];
  vm.lines = { mirror: {}, hidden: {}, mentor: {} };
  const usedM = {}, usedH = {}, usedT = {}, seenM = new Set(), seenH = new Set(), seenT = new Set();
  mir.forEach((r, i) => { vm.lines.mirror[r.name] = charLine('P07', r, 'mirror', { used: usedM, seen: seenM, index: i }); });
  hid.forEach((r, i) => { vm.lines.hidden[r.name] = charLine('P08', r, 'hidden', { used: usedH, seen: seenH, index: i }); });
  men.forEach((r, i) => { vm.lines.mentor[r.name] = charLine('P09', r, 'mentor', { goalAxes, used: usedT, seen: seenT, index: i }); });

  const commonSentence = (page, id, ch) => {
    const cm = J.charCommon(ch, 2);
    if (cm.length < 2) return C(page, id, `${ch.name}とは、20軸全体の配置が近く、一つの軸に偏らない重なり方をしています。`, { rule: RULES.charDiff, kind: 'model_interpretation' });
    return C(page, id, `${ch.name}とは、${strip(pred(cm[0].axis, cm[0].userSide))}ことと、${strip(pred(cm[1].axis, cm[1].userSide))}ことが重なります。`, { rule: RULES.charDiff, kind: 'model_interpretation',
      evidence: cm.map((d) => ({ path: axPath(d.axis), value: Math.round(d.user), character: Math.round(d.char) })) });
  };
  const diffSentence = (page, id, ch) => {
    const d = J.charDifference(ch);
    const txt = d.userSide !== d.charSide
      ? `一方で、${ch.name}は${strip(pred(d.axis, d.charSide))}側、${youAt(d.axis, d.userSide).replace(/^あなたは/, 'あなたは')}。`
      : `一方で、${nm(d.axis)}の傾向は${d.char > d.user ? ch.name : 'あなた'}の方がはっきりしています。`;
    return C(page, id, txt, { rule: RULES.charDiff, kind: 'model_interpretation', evidence: [{ path: axPath(d.axis), value: d.user, character: d.char }] });
  };
  vm.p07 = {
    top3: mir.slice(0, 3).map((r) => ({ r, text: commonSentence('P07', `T3-${r.rank}-COMMON`, r) + diffSentence('P07', `T3-${r.rank}-DIFF`, r) })),
    theme: themeOf('P07', mir),
    selectedNote: mirSel.rank !== 1 ? C('P07', 'SELECTED', `一位と同じ近さの人物が複数いたため、正本の選択規則（元素→国家→武器種→登録順）で${mirSel.name}をMIRRORに選んでいます。順位は丸め前の値のままです。`, { kind: 'calculated_fact', rule: 'ETI-MIRROR-2.1.0.selection', evidence: [{ path: 'mirror.selectionMeta', value: snap.mirror.selectionMeta.selectedBy }] }) : null,
  };
  function themeOf(page, rows) {
    const cnt = {};
    rows.forEach((r) => r.basis_tags.forEach((t) => { cnt[t] = (cnt[t] || 0) + 1; }));
    const tags = Object.entries(cnt).sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).slice(0, 2);
    // 10名の平均と本人がともに高い（または低い）軸
    const avg = (ax, L) => rows.reduce((s, r) => s + r[L][ax], 0) / rows.length;
    const sharedHi = P_S.filter((ax) => J.av(ax) >= 60 && avg(ax, LAYER_OF[ax]) >= 60).sort((a, b) => J.av(b) - J.av(a))[0];
    const sharedLo = P_S.filter((ax) => J.av(ax) <= 40 && avg(ax, LAYER_OF[ax]) <= 40).sort((a, b) => J.av(a) - J.av(b))[0];
    const tagTxt = `「${strip(TAGS[tags[0][0]].end)}」人物や、「${strip(TAGS[tags[1][0]].end)}」人物が多く並びます。`;
    const axTxt = sharedHi && sharedLo ? `十人の多くは、あなたと同じく${noun(sharedHi, 'hi')}が高く、${noun(sharedLo, 'lo')}の側にある人物です。`
      : sharedHi ? `十人の多くは、あなたと同じく${noun(sharedHi, 'hi')}が高い人物です。` : sharedLo ? `十人の多くは、あなたと同じく${noun(sharedLo, 'lo')}の側にある人物です。` : '十人は一つの軸より、全体の配置の近さで並んでいます。';
    return C(page, 'THEME', tagTxt + axTxt, { rule: 'TOP10_TAG_FREQUENCY+AXIS_MEAN', kind: 'model_interpretation', evidence: [{ path: 'top10.basis_tags', value: tags.map(([t, n]) => `${t}:${n}`) }, ...evAx(sharedHi, sharedLo)] });
  }
  // HIDDEN
  const onlyHidden = hid.filter((r) => !mirNames.has(r.name));
  const shapeSentence = (page, id, ch) => {
    const sh = J.sharedShape(ch);
    const parts = sh.filter((s) => s.peakShared || s.valleyShared).map((s) => `${LAYER_JA[s.layer]}では${[s.peakShared ? `${nm(s.peak)}が山` : '', s.valleyShared ? `${nm(s.valley)}が谷` : ''].filter(Boolean).join('、')}`);
    const txt = parts.length ? `${parts.join('、')}という配置が共通します。` : '各層の山と谷の位置が、全体としてあなたと近い形をしています。';
    return C(page, id, txt, { rule: 'CORE1-HIDDEN-1.0.0.shape', kind: 'model_interpretation', evidence: [{ path: `hidden.${ch.name}.Pshape`, value: ch.Pshape }, { path: `hidden.${ch.name}.Sshape`, value: ch.Sshape }, { path: `hidden.${ch.name}.Vshape`, value: ch.Vshape }] });
  };
  const uShape = { personality: J.shapeOf(snap.axes.personality), style: J.shapeOf(snap.axes.style), values: J.shapeOf(snap.axes.values) };
  const shapeLine = `${LAYER_JA.personality}では${nm(uShape.personality.peak.axis)}が山で${nm(uShape.personality.valley.axis)}が谷、${LAYER_JA.style}では${nm(uShape.style.peak.axis)}が山で${nm(uShape.style.valley.axis)}が谷`;
  vm.p08 = {
    top3: hid.slice(0, 3).map((r) => ({ r, text: shapeSentence('P08', `T3-${r.rank}`, r) })),
    onlyHidden,
    diffNote: C('P08', 'VSMIRROR', onlyHidden.length
      ? `十人のうち${10 - onlyHidden.length}人はMIRRORと重なります。${onlyHidden.map((r) => r.name).join('・')}は、強さの大きさを外して初めて現れる人物で、強さは違っても、内側の配置が近い形をしています。`
      : '十人はすべてMIRRORと重なります。今のあなたは、強さの大きさを外しても同じ人物が並ぶほど、高さと形が一致した配置です。', { kind: 'calculated_fact', rule: 'SET_DIFF_MIRROR_HIDDEN', evidence: [{ path: 'hidden.top10', value: hid.map((r) => r.name) }] }),
    shape: C('P08', 'SHAPE', `強さの大きさを外すと、${shapeLine}という形が浮かび上がります。HIDDEN SHAPEは、この山と谷の位置が近い人物を並べています。`, { rule: 'CORE1-HIDDEN-1.0.0.shape', kind: 'model_interpretation', evidence: ['personality', 'style'].flatMap((L) => [uShape[L].peak.axis, uShape[L].valley.axis]).map((a) => ({ path: axPath(a), value: J.av(a) })) }),
  };
  // MENTOR
  const goalItem = snap.mentor.status === 'ok' ? K.goals.goals.find((g) => g.goal_id === snap.mentor.goal.goal_id) : null;
  if (snap.mentor.status === 'ok' && !goalItem) throw new Error('mentor goal not in reviewed catalog: ' + snap.mentor.goal.goal_id);
  function borrowFor(rows) {
    // 三人それぞれに、目標で動かした軸のうち「目標値に最も近い軸」を重複なく割り当て、その軸の振る舞いを一つだけ借りる
    const used = new Set();
    return rows.map((r) => {
      const ds = snap.mentor.changes.map((c) => ({ c, d: Math.abs((r[c.layer][c.axis]) - c.after) })).sort((a, b) => (a.d - b.d) || a.c.axis.localeCompare(b.c.axis));
      const pick = ds.find((x) => !used.has(x.c.axis)) || ds[0];
      used.add(pick.c.axis);
      return { axis: pick.c.axis, layer: pick.c.layer, delta: pick.c.delta, target: pick.c.after, char: r[pick.c.layer][pick.c.axis], text: goalItem.borrow[pick.c.axis] };
    });
  }
  if (snap.mentor.status === 'ok') {
    const borrows = borrowFor(men.slice(0, 3));
    const unchangedHi = snap.mentor.unchangedAxes.filter((a) => !J.isV(a)).sort((a, b) => J.av(b) - J.av(a)).slice(0, 2);
    const unchangedV = snap.mentor.unchangedAxes.filter((a) => J.isV(a)).sort((a, b) => J.userCentered[b] - J.userCentered[a]).slice(0, 2);
    vm.p09 = {
      goal: snap.mentor.goal, changes: snap.mentor.changes, borrows,
      keepAxes: [...unchangedHi, ...unchangedV],
      keep: C('P09', 'KEEP', `${goalItem.keep_phrase}動かすのは${snap.mentor.changes.map((c) => nm(c.axis)).join('・')}だけで、${[...unchangedHi, ...unchangedV].map((a) => nm(a)).join('・')}などの今の核はそのまま保ちます。`, { content: `MENTOR_GOAL.${goalItem.goal_id}.keep_phrase`, kind: 'model_interpretation', evidence: snap.mentor.changes.map((c) => ({ path: axPath(c.axis), value: c.before, target: c.after })) }),
      top3: men.slice(0, 3).map((r, i) => ({ r, text: C('P09', `T3-${r.rank}`, `${borrows[i].text}`, { rule: 'CORE1-MENTOR-1.0.0.borrow', content: `MENTOR_GOAL.${goalItem.goal_id}.borrow.${borrows[i].axis}`, kind: 'model_interpretation', evidence: [{ path: `mentor.target.${borrows[i].layer}.${borrows[i].axis}`, value: borrows[i].target, character: borrows[i].char }] }) })),
      selectedBy: snap.mentor.goal.selected_by,
    };
  } else vm.p09 = null;

  // ============ P10–P12 上位3の活かし方 ============
  vm.topThemes = {};
  ['element', 'weapon', 'nation'].forEach((kind) => {
    const page = { element: 'P10', weapon: 'P11', nation: 'P12' }[kind];
    const rows = R[kind].slice(0, 3), it = rows.map((r) => item(kind, r.key));
    const bottom = R[kind][R[kind].length - 1], bIt = item(kind, bottom.key);
    const f = it.map((x) => x.function_short);
    const lead = kind === 'nation'
      ? (flat ? C(page, 'LEAD', '価値観の回答に相対的な山谷が無いため、ここでは国家辞典の上位三つの定義をそのまま示します。順位に意味はありません。', { rule: 'VALUES_FLAT', kind: 'calculated_fact' })
        : C(page, 'LEAD', `${rows.map((r) => r.name).join('・')}は、<strong>${f.join('、')}</strong>という意思決定の基盤を作ります。価値観は「向く場面」ではなく、迷った時に何を守るかで読みます。`, { rule: 'TOP3_FUNCTIONS', content: it.map((x) => x.id + '.function_short').join('+') }))
      : C(page, 'LEAD', `${rows.map((r) => r.name).join('・')}は、<strong>${f.join('、')}</strong>という三つの働きを持っています。三つを別々の才能としてではなく、場面に応じて順番に使う一つの回路として読みます。`, { rule: 'TOP3_FUNCTIONS', content: it.map((x) => x.id + '.function_short').join('+') });
    const rowsDef = kind === 'nation'
      ? [['自然な強み', 'strength', ''], ['守る基準', 'guard', ''], ['妥協しにくい点', 'hard', ''], ['摩擦時の問い', 'question', 'use'], ['日常の一場面', 'scene', ''], ['過剰使用のサイン', 'over', 'warn']]
      : [['自然な強み', 'strength', ''], ['向く場面', 'context', ''], ['他者からの見え方', 'seen', ''], ['過剰使用のサイン', 'over', 'warn'], ['日常の一場面', 'scene', ''], ['一言での使い方', 'use', 'use']];
    const table = rowsDef.map(([label, key, cls]) => ({ label, cls, cells: it.map((x, i) => C(page, `T-${key}-${i + 1}`, x.table[key], { content: `${kind}.${x.id}.table.${key}` })) }));
    const note = flat && kind === 'nation' ? C(page, 'NOTE', '価値観の回答が平坦なため、国家の上位三つは同じ近さです。表は辞書の定義として読み、あなたの傾向としては読みません。', { rule: 'VALUES_FLAT', kind: 'calculated_fact' })
      : C(page, 'NOTE', `上位の三つは、${f.join('・')}という別々の働きです。下位にある${bottom.name}が担う${COPE[bottom.key].required_outcome}は、上位資質だけでは代替しません。必要な場面では、${COPE[bottom.key].external_support}（P${{ element: 29, weapon: 30, nation: 31 }[kind]}）。`, { rule: 'CORE1-LOWER-COPING-1.0.0', content: `LOWER_COPING.${bottom.key}`, evidence: [...evRank(kind, rows[0]), ...evRank(kind, bottom)] });
    vm.topThemes[kind] = { lead, rows, table, note, gaps: [J.gapState(rows[0], 'next'), J.gapState(rows[1], 'next')] };
  });

  // ============ P13–P21 上位資質の詳細 ============
  const crossLayer = (kind) => {
    const parts = [];
    if (kind !== 'element') parts.push(`何に心が動くかは気質の${top.element.name}（${T.element.short_theme}）`);
    if (kind !== 'weapon') parts.push(`どう動くかはスタイルの${top.weapon.name}（${T.weapon.short_theme}）`);
    if (kind !== 'nation' && !flat) parts.push(`何を選ぶかは価値観の${top.nation.name}（${T.nation.short_theme}）`);
    return parts.join('、') + 'から読めます。';
  };
  vm.details = { element: [], weapon: [], nation: [] };
  ['element', 'weapon', 'nation'].forEach((kind) => {
    const base = { element: 13, weapon: 16, nation: 19 }[kind];
    R[kind].slice(0, 3).forEach((row, i) => {
      const page = 'P' + (base + i);
      const it = item(kind, row.key);
      const prev = R[kind][i - 1], next = R[kind][i + 1];
      if (kind === 'nation' && flat) {
        vm.details[kind].push({ row, it, flat: true, prev, next,
          body: [C(page, 'FLAT', `価値観の10軸への回答がすべて同じ高さのため、${row.name}が上位にあることは、あなたの価値の並びを表していません。以下は${row.name}という価値観の定義です。`, { rule: 'VALUES_FLAT', kind: 'calculated_fact', evidence: [{ path: 'values_flat', value: true }] }),
            C(page, 'DEF', it.intro, { content: `NATION.${it.id}.intro` })],
          core: { primary: null, supporting: [], candidates: it.core_axes.map((c) => c.axis), misaligned: [] }, axes: it.core_axes.map((c) => c.axis),
          beyond: C(page, 'BEYOND', `価値の並びが平坦なため、選び方は国家からは読みません。${crossLayer(kind)}`, { rule: 'VALUES_FLAT' }) });
        return;
      }
      const core = J.coreOf(kind, row, it);
      // 核の保存形式：コード・値・方向・方向つきの句・選定理由を分けて持つ
      const dirOf = (ax) => it.core_axes.find((c) => c.axis === ax).dir;
      const diffOf = (ax) => J.protoDiffs(kind, row).find((d) => d.axis === ax);
      core.records = [core.primary, ...core.supporting].filter(Boolean).map((ax, k) => PL.coreRecord(ax, dirOf(ax),
        `${k === 0 ? '主要一致軸' : '支える軸'}：辞書の core_axes 候補（${it.core_axes.map((c) => c.axis + ':' + c.dir).join(', ')}）のうち、型と同じ向きにあり、型との差が${k === 0 ? '最小' : '次に小さい'}（差 ${Math.round(diffOf(ax).absDiff * 10) / 10}）。統計的因果ではなく編集規則。`));
      const dev = J.deviationOf(kind, row);
      const gN = J.gapState(row, 'next'), gP = prev ? J.gapState(row, 'prev') : null;
      const ci = `${kind.toUpperCase()}.${it.id}`;
      const p1 = core.primary
        ? `${it.intro}今回の${row.name}を形づくっている中心（主要一致軸）は、${noun(core.primary)}です。${it.core_axis_meanings[core.primary]}`
        : `${it.intro}このカテゴリは一本の強い軸ではなく、複数軸の組合せによって形づくられています。`;
      const sup = core.supporting[0];
      const p2 = sup
        ? `${noun(sup)}も、${row.name}の型と同じ側にあります。${it.core_axis_meanings[sup]}`
        : `${row.name}が自然に表れやすいのは、${strip(it.fitting_contexts)}のような場面です。強みとしては、${strip(it.natural_strength)}が挙げられます。`;
      const p3 = dev
        ? `ただし、${row.name}の型は${strip(pred(dev.axis, dev.protoSide))}${tendency(dev.axis)}ですが、${youAt(dev.axis, dev.userSide)}。この違いが、${row.name}の中でのあなた固有の輪郭になります。`
        : `${row.name}の型と比べても、反対側に大きく離れた軸はなく、型に近い形で表れています。`;
      let p4;
      if (i === 0) p4 = gN.state === 'close' ? `${next.name}がすぐ後ろに並ぶため、${item(kind, next.key).as_next}` : gN.state === 'clear' ? `次点の${next.name}とは差があり、${row.name}の傾向が比較的はっきり表れています。` : `次点には${next.name}が続き、${item(kind, next.key).as_next}`;
      else p4 = gP.state === 'close' ? `${prev.name}との差は小さく、二つの傾向がほぼ同じ近さで働いています。` : `${prev.name}に次ぐ位置にあり、${prev.name}とは別の角度から${KIND_WORD[kind]}を支えています。`;
      p4 += `この力が強く出すぎると、${overuseClause(it.overuse_signs)}`;
      const strength = (core.primary ? 1 : 0) + (gN && gN.state === 'clear' ? 1 : 0) >= 2 ? 'balanced' : 'tentative';
      vm.details[kind].push({
        row, it, prev, next, core, dev,
        body: [
          C(page, 'BODY-MEANING', p1, { rule: RULES.core, content: `${ci}.intro+core_axis_meanings.${core.primary}`, kind: 'model_interpretation', strength,
            evidence: [...core.evidence, { path: 'rule.neutral', value: core.neutral_rule }, { path: 'rule.thresholds', value: core.thresholds }, ...(core.no_core_reason ? [{ path: 'rule.no_core_reason', value: core.no_core_reason }] : [])] }),
          C(page, 'BODY-SUPPORT', p2, { rule: RULES.core, content: sup ? `${ci}.core_axis_meanings.${sup}` : `${ci}.natural_strength`, evidence: sup ? evAx(sup) : [] }),
          C(page, 'BODY-DEVIATION', p3, { rule: 'CORE1-DEVIATION-1.0.0', kind: 'model_interpretation', evidence: (dev ? [dev] : J.protoDiffs(kind, row).sort((a, b) => b.absDiff - a.absDiff).slice(0, 1)).map((d) => ({ path: axPath(d.axis), value: Math.round(d.user * 10) / 10, prototype: Math.round(d.proto * 10) / 10, rule_threshold: 15 })) }),
          C(page, 'BODY-RANK', p4, { rule: RULES.gapLabels, content: `${ci}.overuse_signs`, strength: (gN && gN.state === 'close') || (gP && gP.state === 'close') ? 'tentative' : 'balanced', evidence: evRank(kind, row) }),
        ],
        side: { scenes: it.fitting_contexts, seen: it.outside_view, optimal: it.optimal_use, under: it.underuse_signs, over: it.overuse_signs },
        quote: it.quote, poem: it.poem, vignette: C(page, 'SCENE', it.scene_templates[0], { content: `${ci}.scene_templates[0]`, strength: 'tentative' }),
        axes: kind === 'nation'
          ? [...new Set([...it.core_axes.map((c) => c.axis), ...row.evidence.slice().sort((a, b) => b.contribution - a.contribution).map((e) => e.axis)])].slice(0, 4)
          : Object.keys(snap.axes[kind === 'element' ? 'personality' : 'style']),
        beyond: C(page, 'BEYOND', `${row.name}だけでは、${it.not_explained}は説明できません。${crossLayer(kind)}`, { content: `${ci}.not_explained`, rule: 'CROSS_LAYER_TOP1' }),
      });
    });
  });

  // ============ P22–P24 二層の交わり ============
  function relationFor(kindA, rowA, kindB, rowB) {
    const a = item(kindA, rowA.key), b = item(kindB, rowB.key), pr = pairOf(kindA, rowA.key, kindB, rowB.key);
    const ev = [...a.core_axes.slice(0, 2).map((c) => ({ ...c, kind: kindA })), ...b.core_axes.slice(0, 2).map((c) => ({ ...c, kind: kindB }))];
    const agree = ev.filter((c) => J.side(c.axis) !== 'neutral' && (J.side(c.axis) === 'hi') === (c.dir === 'high'));
    const ratio = agree.length / ev.length;
    let rel = pr.default_relation;
    if (kindB === 'nation' && flat) rel = 'conditional';
    else if (rel !== 'tension' && ratio < 0.5) rel = 'conditional';
    // 緊張と呼ぶのは、両カテゴリの根拠軸が本人に半分以上当てはまり、辞書に具体的な競合場面（friction_when）がある時だけ
    else if (rel === 'tension' && (ratio < 0.5 || !pr.friction_when)) rel = 'conditional';
    return { pr, a, b, rel, ratio, agreeAxes: agree.map((c) => c.axis), evAxes: ev.map((c) => c.axis) };
  }
  vm.pairs = [];
  [['P22', 'element', 'weapon'], ['P23', 'element', 'nation'], ['P24', 'weapon', 'nation']].forEach(([page, ka, kb]) => {
    const x = relationFor(ka, top[ka], kb, top[kb]);
    const second = relationFor(ka, R[ka][1], kb, R[kb][1]);
    const lab = K.pairEW.relation_labels;
    const support = x.agreeAxes.filter((a) => J.strong(a)).slice(0, 2);
    const p1 = `${top[ka].name}は${strip(x.a.one_liner)}${KIND_WORD[ka]}です。${top[kb].name}は${strip(x.b.one_liner)}${KIND_WORD[kb]}です。${REL_FRAME[x.rel]}`;
    const p2 = x.pr.together + (support.length >= 2 ? `あなたの場合、${noun(support[0])}と、${noun(support[1])}が、この組み合わせを支えています。` : 'あなたの場合、この組み合わせを支える軸は一部にとどまり、場面によって表れ方が変わります。');
    const p3 = x.rel === 'tension' ? `${x.pr.tension}具体的には、${strip(x.pr.friction_when)}に、二つが別の行動を求めます。うまく働くのは、${strip(x.pr.works_when)}です。` : `${x.pr.tension}うまく働くのは、${strip(x.pr.works_when)}です。`;
    vm.pairs.push({
      page, ka, kb, a: top[ka], b: top[kb], aIt: x.a, bIt: x.b, rel: x.rel, label: lab[x.rel], ratio: x.ratio, evAxes: x.evAxes,
      lead: C(page, 'LEAD', x.pr.summary, { content: `PAIR.${x.pr.pair_id}.summary`, rule: RULES.pairRelation, evidence: [{ path: 'relation.agreement', value: x.ratio }] }),
      prose: [C(page, 'P1', p1, { rule: RULES.pairRelation, content: `PAIR.${x.pr.pair_id}`, evidence: [{ path: 'relation.final', value: x.rel }, { path: 'relation.default', value: x.pr.default_relation }] }),
        C(page, 'P2', p2, { content: `PAIR.${x.pr.pair_id}.together`, kind: 'model_interpretation', evidence: evAx(...support) }),
        C(page, 'P3', p3, { content: `PAIR.${x.pr.pair_id}.tension+works_when`, strength: 'tentative' })],
      examples: x.pr.scene_templates.map((s, i) => C(page, `EX-${i + 1}`, s, { content: `PAIR.${x.pr.pair_id}.scene_templates[${i}]`, strength: 'tentative' })),
      cond: [x.pr.works_when, x.pr.friction_when, x.pr.observation_question], conflictScene: x.rel === 'tension' ? x.pr.friction_when : null,
      second: { a: R[ka][1], b: R[kb][1], rel: second.rel, label: lab[second.rel],
        text: C(page, 'SECOND', `${second.pr.summary}${second.pr.together}`, { content: `PAIR.${second.pr.pair_id}`, rule: RULES.pairRelation, strength: 'tentative' }) },
    });
  });

  // ============ P25 三層統合 ============
  const byAgree = [...vm.pairs].filter((p) => p.rel === 'alignment' || p.rel === 'complement').sort((a, b) => b.ratio - a.ratio);
  const consistent = byAgree[0] || [...vm.pairs].sort((a, b) => b.ratio - a.ratio)[0];
  const devAll = [
    J.deviationOf('element', top.element), J.deviationOf('weapon', top.weapon), flat ? null : J.deviationOf('nation', top.nation),
  ].map((d, i) => d && { ...d, kind: ['element', 'weapon', 'nation'][i] }).filter(Boolean).sort((a, b) => b.absDiff - a.absDiff)[0];
  vm.p25 = {
    core: C('P25', 'CORE', `${strip(T.element.lend)}力と、${strip(T.weapon.lend)}力${flat ? '' : `、${strip(T.nation.lend)}力`}が、一人の中で重なる配置です。`, { content: 'lend(top3)', kind: 'model_interpretation' }),
    consistent: C('P25', 'CONSISTENT', `${consistent.a.name}×${consistent.b.name}。${consistent.lead}`, { rule: 'P25_MAX_AGREEMENT', evidence: [{ path: 'relation.agreement', value: consistent.ratio }] }),
    conflict: vm.tensions[0].type === 'tension'
      ? C('P25', 'CONFLICT', vm.tensions[0].conflict_scene, { rule: RULES.tension, content: vm.tensions[0].id, evidence: [{ path: 'rule.conflict_scene', value: vm.tensions[0].conflict_scene }] })
      : C('P25', 'CONFLICT', `同じ場面で別の行動を求めるほどの葛藤は、この結果からは読み取れません。${vm.tensions[0].text}`, { rule: RULES.tension, content: vm.tensions[0].id }),
    switching: C('P25', 'SWITCH', vm.tensions[1].switch || vm.tensions[0].switch, { rule: RULES.tension, content: (vm.tensions[1] || vm.tensions[0]).id + '.switch', strength: 'tentative' }),
    unique: devAll
      ? C('P25', 'UNIQUE', `${item(devAll.kind, top[devAll.kind].key).display_name}の型は${strip(pred(devAll.axis, devAll.protoSide))}${tendency(devAll.axis)}ですが、${youAt(devAll.axis, devAll.userSide)}。三つの結果名だけでは見えない、あなた固有の差です。`, { rule: 'CORE1-DEVIATION-1.0.0', kind: 'model_interpretation', evidence: [{ path: axPath(devAll.axis), value: Math.round(devAll.user * 10) / 10, prototype: Math.round(devAll.proto * 10) / 10 }] })
      : C('P25', 'UNIQUE', '三つの結果の型から大きく離れた軸はなく、それぞれの型に近い形で重なっています。', { rule: 'CORE1-DEVIATION-1.0.0' }),
    flow: [T.element.scene_step, T.weapon.scene_step, flat ? '価値の並びが平坦なため、選ぶ基準は場面ごとに確かめる。' : T.nation.scene_step],
    flowNote: C('P25', 'FLOWNOTE', `三つが同じ方向を向く時、この流れは無理なく進みます。崩れやすいのは、${strip(vm.pairs[2].cond[1])}です。`, { content: 'PAIR(W×N).friction_when', strength: 'tentative' }),
    peaksNote: null,
  };
  const all20 = [...P_S, ...VA];
  const by20 = [...all20].sort((a, b) => (J.av(b) - J.av(a)) || a.localeCompare(b));
  vm.p25.peaks = by20.slice(0, 6); vm.p25.valleys = by20.slice(-3).reverse();
  const lset = (axes) => [...new Set(axes.map((a) => LAYER_JA[LAYER_OF[a]]))].join('・');
  vm.p25.peaksNote = C('P25', 'PEAKSNOTE', `山は${lset(vm.p25.peaks)}に、谷は${lset(vm.p25.valleys)}にあります。`, { kind: 'calculated_fact', rule: 'TOP6_BOTTOM3_DISPLAY', evidence: evAx(...vm.p25.peaks, ...vm.p25.valleys) });

  // ============ P26–P28 人物像の上位3名 ============
  const contribLayer = (r) => { const w = [['気質', 0.4 * r.pSim], ['スタイル', 0.3 * r.sSim], ['価値観', 0.3 * r.vSim]].sort((a, b) => b[1] - a[1]); return w[0][0]; };
  vm.p26 = mir.slice(0, 3).map((r) => {
    const d = J.charDifference(r);
    return { r, line: vm.lines.mirror[r.name], rows: [
      ['重なる構造', C('P26', `${r.rank}-COMMON`, commonSentence('P26', `${r.rank}-COMMON-SRC`, r).replace(`${r.name}とは、`, `${r.name}と重なるのは、`).replace(/ことが重なります。$/, 'という構造です。'), { rule: RULES.charDiff, kind: 'model_interpretation' }), ''],
      ['違い', diffSentence('P26', `${r.rank}-DIFF`, r), ''],
      ['主に重なる層', C('P26', `${r.rank}-LAYER`, `加重後の近さが最も大きいのは${contribLayer(r)}です。`, { kind: 'calculated_fact', rule: 'MIRROR_WEIGHTED_LAYER', evidence: [{ path: `mirror.${r.name}.pSim`, value: r.pSim }, { path: `mirror.${r.name}.sSim`, value: r.sSim }, { path: `mirror.${r.name}.vSim`, value: r.vSim }] }), 'layer'],
      ['あなた固有の違い', (() => {
        const vd = J.charDiffs(r).filter((x) => x.layer === 'values').sort((a, b) => (b.absDiff - a.absDiff) || a.axis.localeCompare(b.axis))[0];
        const who = vd.user > vd.char ? 'あなた' : r.name;
        return C('P26', `${r.rank}-OWN`, `価値観では、${nm(vd.axis)}を${who}の方が重く置いています。この違いが、${r.name}と同一視しない理由になります。`, { rule: RULES.charDiff, kind: 'model_interpretation', evidence: [{ path: `values_centered.${vd.axis}`, value: Math.round(vd.user * 10) / 10, character: Math.round(vd.char * 10) / 10 }] });
      })(), 'own'],
    ] };
  });
  vm.p27 = hid.slice(0, 3).map((r) => {
    const mr = mir.find((m) => m.name === r.name);
    const d = J.charDifference(r);
    const midShared = J.sharedShape(r).find((s) => (s.peakShared && J.band(s.peak) !== 'high') || (s.valleyShared && J.band(s.valley) !== 'low'));
    const over = midShared ? (midShared.peakShared && J.band(midShared.peak) !== 'high' ? { ax: midShared.peak, k: '山' } : { ax: midShared.valley, k: '谷' }) : null;
    return { r, line: vm.lines.hidden[r.name], rows: [
      ['似る山谷', shapeSentence('P27', `${r.rank}-SHAPE`, r), ''],
      ['強度の違い', C('P27', `${r.rank}-INTENSITY`, `${mr ? `MIRRORでも上位に入る人物で、高さも形も近い関係です。` : 'MIRRORの上位10名には入らず、高さは違っても形が近い関係です。'}${nm(d.axis)}の高さは、${d.char > d.user ? r.name : 'あなた'}の方がはっきりしています。`, { kind: 'calculated_fact', rule: 'MIRROR_MEMBERSHIP+MAX_DIFF', evidence: [{ path: axPath(d.axis), value: d.user, character: d.char }] }), ''],
      ['相対配置で意味を持つ点', over ? C('P27', `${r.rank}-OVERLOOK`, `${nm(over.ax)}は数値の高さだけでは目立ちにくい中央域ですが、絶対値ではなく相対配置を見ると${over.k}にあたり、形の中で意味を持ちます。`, { rule: 'SHAPE_MID_BAND', kind: 'model_interpretation', evidence: evAx(over.ax) })
        : C('P27', `${r.rank}-OVERLOOK`, `${PL.label(uShape.personality.valley.axis)}は、絶対値ではなく相対配置を見ると${r.name}と同じ谷の位置にあり、形の一部として意味を持ちます。`, { rule: 'SHAPE_VALLEY', kind: 'model_interpretation', evidence: evAx(uShape.personality.valley.axis) }), 'own'],
    ] };
  });
  if (vm.p09) {
    vm.p28 = men.slice(0, 3).map((r, i) => {
      const b = vm.p09.borrows[i];
      const keepAx = vm.p09.keepAxes.filter((a) => !J.isV(a)).map((a) => ({ a, d: Math.abs(r[LAYER_OF[a]][a] - J.av(a)) })).sort((x, y) => x.d - y.d)[0];
      return { r, line: vm.lines.mentor[r.name], rows: [
        ['借りる技術', C('P28', `${r.rank}-BORROW`, `借りるなら、「${strip(b.text)}」という一つの振る舞いです。`, { content: `MENTOR_GOAL.${goalItem.goal_id}.borrow.${b.axis}`, rule: 'CORE1-MENTOR-1.0.0.borrow', evidence: [{ path: `mentor.target.${b.layer}.${b.axis}`, value: b.target, character: b.char }] }), 'own'],
        ['方向との関係', C('P28', `${r.rank}-DIR`, `${b.delta > 0 ? '広げる' : '控えめにする'}方向の${nm(b.axis)}で、${r.name}の座標が目標に近い位置にあります。`, { kind: 'calculated_fact', rule: 'MENTOR_NEAREST_CHANGED_AXIS', evidence: [{ path: `mentor.target.${b.layer}.${b.axis}`, value: b.target, character: b.char }] }), 'layer'],
        ['保たれる核', keepAx ? C('P28', `${r.rank}-KEEP`, `${nm(keepAx.a)}は、今のあなたと${r.name}で近く、広げても失われない核です。`, { kind: 'calculated_fact', rule: 'MENTOR_UNCHANGED_NEAREST', evidence: evAx(keepAx.a) }) : C('P28', `${r.rank}-KEEP`, '動かさない軸は、今のあなたの値のまま保たれます。', { rule: 'MENTOR_UNCHANGED' }), ''],
      ] };
    });
  } else vm.p28 = null;

  // ============ P29–P31 中位・下位 ============
  vm.navigate = {};
  ['element', 'weapon', 'nation'].forEach((kind) => {
    const page = { element: 'P29', weapon: 'P30', nation: 'P31' }[kind];
    const rows = R[kind], tops = rows.filter((r) => r.band === 'top'), rest = rows.filter((r) => r.band !== 'top');
    const it = (r) => item(kind, r.key);
    const desc = {};
    rest.forEach((r) => {
      if (kind === 'nation' && flat) { desc[r.key] = C(page, `DESC-${r.rank}`, `${it(r).one_liner}価値の並びが平坦なため、順位は便宜的なものです。`, { rule: 'VALUES_FLAT' }); return; }
      const sh = J.sharedOf(kind, r), dv = J.deviationOf(kind, r);
      const s1 = sh ? `${strip(pred(sh.axis, sh.userSide))}点は共通していますが、` : '';
      const s2 = dv ? `${r.name}の型は${strip(pred(dv.axis, dv.protoSide))}${tendency(dv.axis)}で、${youAt(dv.axis, dv.userSide)}。` : `${r.name}の型とは、いくつかの軸で少しずつ離れています。`;
      const full = `${it(r).one_liner}${s1}${s2}`;
      const m3 = rows.filter((x) => x.band === 'middle').length >= 3;
      desc[r.key] = C(page, `DESC-${r.rank}`, m3 || full.replace(/<[^>]+>/g, '').length > 95 ? `${it(r).one_liner}${s2}` : full, { rule: 'NAV_SHARED_DEVIATION', kind: 'model_interpretation', content: `${kind}.${it(r).id}.one_liner`, evidence: [sh, dv].filter(Boolean).map((d) => ({ path: axPath(d.axis), value: Math.round(d.user * 10) / 10, prototype: Math.round(d.proto * 10) / 10 })) });
    });
    const bottoms = rows.filter((r) => r.band === 'bottom');
    const useful = bottoms.map((r) => [r.name, C(page, `USEFUL-${r.rank}`, it(r).useful_when, { content: `${kind}.${it(r).id}.useful_when` })]);
    // 上位資質から同じ目的へ「近づく」方法。完全代替とは書かず、残る差・外の支え・最低限を必ず持たせる
    const usedUp = new Set();
    const substitute = bottoms.map((r, i) => {
      // 上位3のうち、この下位資質の目的に最も寄与しやすい上位（辞書の preferred_uppers の順）を選ぶ
      const lc = COPE[r.key];
      const cands = lc.preferred_uppers.map((k) => tops.find((t) => t.key === k)).filter(Boolean);
      const up = cands.find((t) => !usedUp.has(t.key)) || cands[0] || tops[0], uc = COPE[up.key];
      usedUp.add(up.key);
      const rec = { lower: r.name, upper: up.name, function_short: it(r).function_short, required_outcome: lc.required_outcome, upper_strength_contribution: uc.upper_contribution,
        remaining_gap: lc.remaining_gap, external_support: lc.external_support, minimum_practice: lc.minimum_practice };
      rec.text = C(page, `SUB-${r.rank}`, `${up.name}で${uc.upper_contribution.replace(/。$/, '')}。これは「${lc.required_outcome}」へ近づく一歩ですが、${lc.remaining_gap}までは代替しないため、${lc.external_support}。`,
        { content: `LOWER_COPING.${r.key}+UPPER.${up.key}`, rule: 'CORE1-LOWER-COPING-1.0.0', strength: 'tentative' });
      rec.minimum = C(page, `MIN-${r.rank}`, `最低限：${lc.minimum_practice}。`, { content: `LOWER_COPING.${r.key}.minimum_practice`, rule: 'CORE1-LOWER-COPING-1.0.0', strength: 'tentative' });
      return rec;
    });
    const weakness = flat && kind === 'nation'
      ? C(page, 'WEAK', '価値の並びが平坦なため、国家の上位・下位から弱みの候補は読みません。', { rule: 'VALUES_FLAT' })
      : C(page, 'WEAK', `最大の注意点は、下位ではなく<b>${tops[0].name}と${tops[1].name}の過剰使用</b>です。${overuseClause(it(tops[0]).overuse_signs)}下位にあることは、弱みを意味しません。必要な場面では、${it(bottoms[bottoms.length - 1]).function_short}を担う仕組みや人を外に置きます。`, { rule: 'NAV_OVERUSE_FIRST', content: `${kind}.${it(tops[0]).id}.overuse_signs` });
    const sceneSrc = [...bottoms, ...rows.filter((r) => r.band === 'middle')].slice(0, 2);
    const upFor = (r) => COPE[r.key].preferred_uppers.map((k) => tops.find((t) => t.key === k)).find(Boolean) || tops[0];
    const scenes = sceneSrc.map((r) => [it(r).scene_label, `${upFor(r).name}で、${strip(it(upFor(r)).lend)}。`, `${r.name}の${it(r).function_short}は、外の支えを置いて補う。`]);
    const lead = C(page, 'LEAD', `${tops.map((r) => r.name).join('・')}が上位にある一方、${rows.filter((r) => r.band === 'middle').length ? rows.filter((r) => r.band === 'middle').map((r) => r.name).join('・') + 'は中位、' : ''}${bottoms.map((r) => r.name).join('・')}は下位です。<strong>下位は「できない」ではなく、「自然には先に出てこない」</strong>という意味で読みます。`, { kind: 'calculated_fact', rule: 'CORE1-RANKBAND-1.1.0' });
    vm.navigate[kind] = { lead, rows, desc, useful, substitute, weakness, scenes, hasMiddle: rows.some((r) => r.band === 'middle') };
  });

  // ============ P32 弱み ============
  const ew = pairOf('element', top.element.key, 'weapon', top.weapon.key);
  const sAx = Object.keys(snap.axes.style).sort((a, b) => (J.av(a) - J.av(b)) || a.localeCompare(b));
  const bE = R.element[R.element.length - 1], bW = R.weapon[R.weapon.length - 1];
  const wRule = K.rules.weakness_rules.map((w) => ({ w, m: J.matchRule(w) })).filter((x) => x.m.ok).sort((a, b) => (b.m.strength - a.m.strength) || a.w.id.localeCompare(b.w.id))[0];
  vm.p32 = {
    ex: [
      C('P32', 'EX-1', `例：${strip(ew.friction_when)}（${top.element.name}×${top.weapon.name}）。`, { content: `PAIR.${ew.pair_id}.friction_when`, rule: RULES.weakness, strength: 'tentative' }),
      C('P32', 'EX-2', `例：${K.rules.underuse[sAx[0]]}`, { content: `UNDERUSE.${sAx[0]}`, rule: RULES.weakness, strength: 'tentative', evidence: evAx(sAx[0]) }),
      C('P32', 'EX-3', flat ? '例：役割や判断の理由が説明されないまま、結果だけを求められる環境。' : `例：${strip(T.nation.table.hard)}が続く環境。`, { content: flat ? 'GENERIC' : `NATION.${T.nation.id}.table.hard`, rule: RULES.weakness, strength: 'tentative' }),
      C('P32', 'EX-4', `例：${item('element', bE.key).function_short}（${bE.name}）や${item('weapon', bW.key).function_short}（${bW.name}）を担う人や仕組みが近くにない。`, { rule: RULES.weakness, strength: 'tentative', evidence: [...evRank('element', bE), ...evRank('weapon', bW)] }),
    ],
    sample: wRule
      ? { text: C('P32', 'RULE', wRule.w.text, { rule: RULES.weakness, content: wRule.w.id, kind: 'model_interpretation', evidence: wRule.m.evidence, strength: 'tentative' }), axes: wRule.w.axes, types: wRule.w.types }
      : { text: C('P32', 'RULE', `今回の組み合わせで注意したいのは、${top.element.name}と${top.weapon.name}が重なった時の過剰使用です。${ew.friction_when}`, { rule: RULES.weakness, content: `PAIR.${ew.pair_id}.friction_when`, strength: 'tentative' }), axes: [], types: [1] },
    lowest: R.element[R.element.length - 1],
  };

  // ============ P33–P35 ドメイン ============
  const D = snap.domains.items;
  const DC = K.rules.domains;
  const dSorted = [...D].sort((a, b) => (b.mean - a.mean) || a.key.localeCompare(b.key));
  const dLow = dSorted[dSorted.length - 1];
  const lowAxes = [...dLow.axes].sort((a, b) => a.value - b.value).slice(0, 2).map((x) => x.axis);
  vm.domains = {
    items: D, content: DC, sorted: dSorted,
    lead34: C('P34', 'LEAD', `このレポート上では、<strong>${dSorted[0].label}の平均が最も高い</strong>配置です。${DC[dSorted[0].key].desc}側の4軸が、相対的に高く出ています。`, { kind: 'calculated_fact', rule: 'CORE1-DOMAIN-EDITORIAL-0.1.0', evidence: D.map((d) => ({ path: `domains.${d.key}`, value: d.display })) }),
    read34: C('P34', 'READ', `数値の大小は、各ドメインに入れた4軸の平均です。${dLow.label}が低めに出ているのは、${lowAxes.map((a) => nm(a)).join('と')}が低いためで、能力の不足ではありません。`, { kind: 'calculated_fact', rule: 'DOMAIN_LOWEST_AXES', evidence: evAx(...lowAxes) }),
    band34: C('P34', 'BAND', `帯は能力の量ではなく、四つの平均の大小を並べたものです。最も高い${dSorted[0].label}と最も低い${dLow.label}の間に、残りの二つが並んでいます。`, { kind: 'calculated_fact', rule: 'DOMAIN_ORDER' }),
    flow35: dSorted.slice(0, 3),
    low35: dLow,
    lead35: C('P35', 'LEAD', `平均の高い${dSorted[0].label}を入口に、${dSorted[1].label}、${dSorted[2].label}へつながる順序で読みます。<strong>苦手なドメインを克服するのではなく、どの入口から貢献が始まりやすいか</strong>を知るためのページです。`, { rule: 'DOMAIN_ORDER', kind: 'calculated_fact' }),
    bring35: C('P35', 'BRING', `${dSorted[0].label}から始まり、${dSorted[1].label}、${dSorted[2].label}へと続く流れが表れやすい配置です。こうした関わりは、${DC[dSorted[0].key].visible.replace(/。$/, '')}として周りに見えやすく、その裏で${DC[dSorted[0].key].invisible.replace(/。$/, '')}が支えになっていると考えられます。`, { rule: 'DOMAIN_ORDER', content: `DOMAIN.${dSorted[0].key}`, strength: 'tentative' }),
    lowText35: C('P35', 'LOWTEXT', `${DC[dLow.key].desc}力は、今の配置では貢献の入口ではありません。他の三つの貢献が届いた後に、補う形で使われやすい領域です。この領域をどう扱うかの計画は、次の段階のレポートで扱います。`, { rule: 'DOMAIN_LOWEST', content: `DOMAIN.${dLow.key}` }),
  };

  // ============ P36 三つの人物像 ============
  const mirReason = (() => {
    const avgD = P_S.map((ax) => ({ ax, d: mir.slice(0, 3).reduce((s, r) => s + Math.abs(r[LAYER_OF[ax]][ax] - J.av(ax)), 0) / 3 })).filter((x) => J.strong(x.ax)).sort((a, b) => (a.d - b.d) || a.ax.localeCompare(b.ax));
    const ax = avgD[0] ? avgD[0].ax : null;
    if (!ax) return C('P36', 'WHY-MIRROR', '三人とは、一本の強い軸ではなく、20軸全体の高さと配置が近い人物です。今の自分の動き方を、別の言葉で説明する手がかりになります。', { rule: 'P36_MIRROR_MIN_AVG_DIFF', kind: 'model_interpretation', evidence: [{ path: 'mirror.top3', value: mir.slice(0, 3).map((r) => r.name) }] });
    return C('P36', 'WHY-MIRROR', `三人とも、あなたと同じく${strip(pred(ax, J.side(ax)))}側にあり、今の20軸の高さと配置がそのまま近い人物です。今の自分の動き方を、別の言葉で説明する手がかりになります。`, { rule: 'P36_MIRROR_MIN_AVG_DIFF', kind: 'model_interpretation', evidence: [...evAx(ax), { path: 'mirror.top3', value: mir.slice(0, 3).map((r) => r.name) }] });
  })();
  const hidReason = (() => {
    const shared = ['personality', 'style', 'values'].map((L) => ({ L, peak: uShape[L].peak.axis, valley: uShape[L].valley.axis,
      pOk: hid.slice(0, 3).every((r) => J.shapeOf(r[L]).centered[uShape[L].peak.axis] > 0), vOk: hid.slice(0, 3).every((r) => J.shapeOf(r[L]).centered[uShape[L].valley.axis] < 0) }))
      .filter((x) => x.pOk || x.vOk);
    const txt = shared.length ? shared.map((x) => `${LAYER_JA[x.L]}では${[x.pOk ? nm(x.peak) + 'が山' : '', x.vOk ? nm(x.valley) + 'が谷' : ''].filter(Boolean).join('、')}`).join('、') : '各層の山と谷の並び';
    return C('P36', 'WHY-HIDDEN', `強さの大きさを外すと、三人とも${txt}という形をあなたと共有しています。数値の高さだけでは目立ちにくかった、配置としての近さが理由です。`, { rule: 'P36_HIDDEN_SHARED_SHAPE', kind: 'model_interpretation', evidence: [{ path: 'hidden.top3', value: hid.slice(0, 3).map((r) => r.name) }] });
  })();
  const menReason = vm.p09 ? C('P36', 'WHY-MENTOR', `選んだ方向（${escHtml(vm.p09.goal.label)}）に対して、三人はそれぞれ異なる振る舞いを示します。${vm.p09.top3.map((x, i) => `${x.r.name}からは「${strip(vm.p09.borrows[i].text)}」を借りられます。`).join('')}`, { rule: 'P36_MENTOR_DISTINCT_BORROW', kind: 'model_interpretation', evidence: vm.p09.borrows.map((b) => ({ path: `mentor.target.${b.layer}.${b.axis}`, value: b.target, character: b.char })) })
    : C('P36', 'WHY-MENTOR', 'MENTORは、本人が広げたい方向を選んだ時にだけ作られます。今回は方向が選ばれていないため、三人を選ぶ理由もまだありません。', { rule: 'MENTOR_GOAL_REQUIRED', kind: 'calculated_fact' });
  const hn = new Set(hid.map((r) => r.name)), tn = new Set(men.map((r) => r.name));
  vm.p36 = { mirReason, hidReason, menReason,
    inAll: mir.filter((r) => hn.has(r.name) && (tn.size === 0 || tn.has(r.name))).map((r) => r.name),
    onlyHidden: hid.filter((r) => !mirNames.has(r.name) && !tn.has(r.name)).map((r) => r.name),
    onlyMentor: men.filter((r) => !mirNames.has(r.name) && !hn.has(r.name)).map((r) => r.name) };

  // ============ P37–P38 観察実験 ============
  vm.p37 = ['element', 'weapon', 'nation'].map((kind) => ({ kind, it: T[kind], ex: T[kind].experiment,
    text: C('P37', `EX-${kind}`, T[kind].experiment.how, { content: `${kind}.${T[kind].id}.experiment`, strength: 'tentative' }) }));
  const LE = K.rules.lens_experiments;
  const valleyAx = uShape.personality.valley.axis;
  vm.p38 = {
    mirror: { ...LE.MIRROR, text: C('P38', 'MIRROR', LE.MIRROR.how, { content: 'LENS_EXP.MIRROR' }) },
    hidden: { ...LE.HIDDEN, text: C('P38', 'HIDDEN', LE.HIDDEN.how.replace('{valley}', PL.label(valleyAx)), { content: 'LENS_EXP.HIDDEN', evidence: evAx(valleyAx) }) },
    mentor: vm.p09 ? { ...LE.MENTOR, text: C('P38', 'MENTOR', LE.MENTOR.how.replace('{goal}', () => escHtml(vm.p09.goal.label)).replace('{borrow}', strip(vm.p09.borrows[0].text)), { content: 'LENS_EXP.MENTOR' }) }
      : { ...LE.MENTOR_NONE, text: C('P38', 'MENTOR', LE.MENTOR_NONE.how, { content: 'LENS_EXP.MENTOR_NONE', rule: 'MENTOR_GOAL_REQUIRED' }) },
    logs: [['火', `${mir[0].name}との共通点を、自分の場面で一つ書いた。`], ['木', `${PL.label(valleyAx)}の動き方が、行き違いを防いでいた場面があった。`], ['日', vm.p09 ? `「${strip(vm.p09.borrows[0].text)}」を一度試した。` : '広げてみたい振る舞いを一つ書き出した。']],
    keepCore: highs.map((a) => nm(a)).join('・'),
  };

  // ============ P39 コンパス ============
  vm.p39 = {
    title: T.element.compass_title,
    // P03 と同じ claim をそのまま使う（P39 で別の言い回しを作らない＝一元化）
    facts: vm.p03.facts,
    sharedClaimIds: ['P03-FACT-1', 'P03-FACT-2', 'P03-FACT-3', 'P03-TENSION-1', 'P03-TENSION-2', 'P03-QUESTION'],
    closing: [T.element.reframe, T.weapon.reframe, flat ? '迷った時に何を守るかは、場面ごとに自分で確かめてよいものです。' : T.nation.reframe].map((s, i) => C('P39', `CLOSE-${i + 1}`, s, { content: ['element', 'weapon', 'nation'][i] + '.reframe' })),
    reread: [
      ['役割が増えた時', `P16 ${top.weapon.name}・P24 ${top.weapon.name}×${flat ? '国家' : top.nation.name}`],
      ['決められない時', `P${13 + 1} ${R.element[1].name}・P19 ${flat ? '国家' : top.nation.name}`],
      ['一人で抱えている時', `P20 ${flat ? '国家' : R.nation[1].name}・P32 弱み`],
      ['人に説明したい時', 'P03 あなたの核・P26 MIRROR'],
    ],
  };
  return vm;
}

module.exports = { buildClaims, TYPE_NAME, ELEMENT_CODE, WEAPON_CODE, NATION_CODE, COPY_VERSION, displayName };
