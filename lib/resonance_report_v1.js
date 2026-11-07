// lib/resonance_report_v1.js — 共鳴診断｜人物像レポート（税込500円）の計算・図・本文の組み立て（Phase C の C-1。販売 OFF）
//
// 根拠：docs/eti-mini/phase_c/共鳴診断_PhaseC_設計指示書_v1.md（ChatGPT 設計、2026-11-07）
// 置き場所：lib/（scripts/build-public.js が公開しないディレクトリ）。有料の中身を静的ファイルとして配らない
//
// しないこと（C-1）：DB 適用・決済の作成・販売。辞書（元素7・武器種5・国家8・キャラ66 などの本文）を推測で書くこと。
//   辞書が無い所は「〔未執筆：キー〕」を差し込み、missing に列挙する（販売前に必ず 0 件にする）。
// C-1 レビュー（2026-11-07）：RESONANCE 章を最重要とし5区分（回答の人物像／登録モデル／共通／相違／解釈）に。
//   VALUES は図も本文も平均中心化した相対優先度。comboLine 280 → comboInteraction 35＋nationLens 8（＋任意の comboOverride）
//
// 意味の境界（設計書§1）：3回答で本人の20特性を測ったものではない。選んだ元素・武器種・国家の「代表モデル」と、
//   キャラクターの「登録モデル」を比べるだけ。数値（得点・一致率・順位）は画面・本文に出さない。
//   内部の pSim・sSim・vSim と本家 MIRROR の総合参照値は、本文の書き分け（どの側面を挙げるか）にだけ使う。
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROTO = require('../js/eti_v2_prototypes.js');
const CHARS = require('../js/characters118_v2_1.js');
const MAP = require('../js/eti_mini_auto_map_v1.js');

const ROOT = path.join(__dirname, '..');
// 版：C-1 レビュー（2026-11-07）で 本文の構成（TEXT-2）・VALUES 図（CHART-2）・本文で挙げる軸の選び方（SELECT-2）を改めた。
//   計算式（CALC-1：本家と同じ pSim・sSim・vSim）は変えていない
const VERSIONS = {
  schema: 'RESONANCE-REPORT-SNAPSHOT-2',
  text: 'RESONANCE-TEXT-2',
  chart: 'RESONANCE-CHART-2',
  calc: 'RESONANCE-CALC-1',
  select: 'RESONANCE-SELECT-2',
};

// 軸の並び（本家 js/ETI_v2_QUESTIONS_100.js の ETI_V2_META と同じ。tests/resonance_report.test.js が一致を確かめる）
const AXES = {
  persona: ['O', 'C', 'E', 'A', 'N'],
  style: ['AGY', 'REL', 'ROL', 'REF', 'AUT'],
  values: ['SD', 'ST', 'HE', 'AC', 'PO', 'SE', 'CO', 'TR', 'BE', 'UN'],
};
// 表示ラベル（無料の見本・resonance.html と同じ言葉）
const LABEL = {
  O: '開放性', C: '誠実性', E: '外向性', A: '協調性', N: '感受性',
  AGY: '主導性', REL: '関係調整', ROL: '役割持続', REF: '媒介思考', AUT: '自律距離',
  SD: '自分で選ぶ', ST: '新しい刺激', HE: '楽しみ', AC: '達成', PO: '影響力', SE: '安定', CO: '節度', TR: '伝統', BE: '思いやり', UN: '公正さ',
};
const DOMAIN_LABEL = { persona: '性格', style: '行動の傾向', values: '価値観' };
const ELEMENTS = ['炎', '水', '氷', '雷', '風', '岩', '草'];
const WEAPONS = ['片手剣', '両手剣', '長柄', '法器', '弓'];
const NATIONS = ['モンド', '璃月', '稲妻', 'スメール', 'フォンテーヌ', 'ナタ', 'スネージナヤ', 'ナドクライ'];
const NATION_DISPLAY = { 'ナドクライ': 'ナド・クライ' };
const COLOR = { you: '#7aa2cf', char: '#d6bd84', sym: '#a9b8d6' }; // 見本と同じ色（アナタ＝青、人物＝金）

// 共通の注記（設計書§1。図の冒頭に置く）
const DISCLAIMER = 'この図は、選んだ元素・武器種・国家の代表モデルと、キャラクターの登録モデルを比べたものです。性格検査の得点や、実際の一致率ではありません。';

// しきい値（設計書§3-5。暫定。280件の監査結果を見て ChatGPT と見直す）
const FLAT_DOMAIN = 0.05; // 3側面の近さの差がこれ未満なら、どの側面が近いと断定しない
const SMALL_AXIS_DIFF = 10; // 軸の差（0〜100、価値観は中心化後）がこれ以下なら「違い」を誇張しない

// ---------------------------------------------------------------- 計算
function vec(obj, axes) { return axes.map((a) => obj[a]); }
// 本家 js/eti_v2_engine.js の rmseSim の距離側（1 - sim）
function rmse(u, c, axes) {
  const s = axes.reduce((acc, a) => { const d = (u[a] - c[a]) / 100; return acc + d * d; }, 0);
  return Math.sqrt(s / axes.length);
}
function center(obj, axes) { const v = vec(obj, axes); const m = v.reduce((a, b) => a + b, 0) / v.length; return v.map((x) => x - m); }
// 本家と同じ：どちらかが零ベクトルなら null（vSim は 0.5）
function cosine(a, b) {
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  const na = Math.sqrt(a.reduce((s, v) => s + v * v, 0)), nb = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  if (na === 0 || nb === 0) return null;
  return dot / (na * nb);
}
function vSimOf(u, c) { const cos = cosine(center(u, AXES.values), center(c, AXES.values)); return cos === null ? 0.5 : (cos + 1) / 2; }

function validate(answers) {
  const a = answers || {};
  if (ELEMENTS.indexOf(a.element) < 0 || WEAPONS.indexOf(a.weapon) < 0 || NATIONS.indexOf(a.nation) < 0) {
    const e = new Error('INVALID_ANSWERS'); e.code = 'INVALID_ANSWERS'; throw e;
  }
  return { element: a.element, weapon: a.weapon, nation: a.nation };
}
// 現れる人物は 280 の固定割当（共鳴診断の画面と同じ。サーバー側で引き直して確かめる）
function mirrorOf(a) {
  const name = MAP.rows[a.element + '|' + a.weapon + '|' + a.nation];
  const ch = CHARS.find((c) => c.name === name);
  if (!ch) { const e = new Error('AUTO_MAP_KEY_MISSING'); e.code = 'AUTO_MAP_KEY_MISSING'; throw e; }
  return ch;
}

// 3回答 → 20軸（代表モデル）と、人物の登録モデル
function modelVectors(answers) {
  const a = validate(answers);
  const ch = mirrorOf(a);
  return {
    answers: a,
    mirror: ch.name,
    mirrorElement: ch.element,
    you: { persona: { ...PROTO.ELEMENT_PROTOTYPES_V2[a.element] }, style: { ...PROTO.WEAPON_PROTOTYPES_V2[a.weapon] }, values: { ...PROTO.NATION_PROTOTYPES_V2[a.nation] } },
    char: { persona: { ...ch.personality }, style: { ...ch.style }, values: { ...ch.values } },
  };
}

// 内部の近さ（表示しない）と、本文で挙げる側面・軸
function analyze(m) {
  const pSim = 1 - rmse(m.you.persona, m.char.persona, AXES.persona);
  const sSim = 1 - rmse(m.you.style, m.char.style, AXES.style);
  const vSim = vSimOf(m.you.values, m.char.values);
  const sims = { persona: pSim, style: sSim, values: vSim };
  const mirrorRef = 0.40 * pSim + 0.30 * sSim + 0.30 * vSim; // 本家 MIRROR の総合参照値（照合用。表示しない・人物を変えない）
  const order = ['persona', 'style', 'values'];
  const max = Math.max(pSim, sSim, vSim), min = Math.min(pSim, sSim, vSim);
  const flat = max - min < FLAT_DOMAIN;
  // 同点は persona → style → values の順（本家の並べ替えと同じ優先）
  const closeDomain = order.find((d) => sims[d] === max);
  const farDomain = order.slice().reverse().find((d) => sims[d] === min);
  // 軸ごとの差：性格・行動は |U-C|、価値観は中心化後の |(U-mean U)-(C-mean C)|
  const axisDiff = {};
  for (const d of ['persona', 'style']) axisDiff[d] = AXES[d].map((ax) => ({ axis: ax, diff: Math.abs(m.you[d][ax] - m.char[d][ax]) }));
  const cu = center(m.you.values, AXES.values), cc = center(m.char.values, AXES.values);
  axisDiff.values = AXES.values.map((ax, i) => ({ axis: ax, diff: Math.abs(cu[i] - cc[i]) }));
  // 本文で挙げる軸（SELECT-2）。図と同じ基準：性格・行動は元の値、価値観は平均中心化した相対優先度
  const level = (u, c) => (u >= 60 && c >= 60 ? 'high' : u <= 40 && c <= 40 ? 'low' : 'mid'); // 性格・行動：どちらも高め／控えめ／どちらでもない
  const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
  const pick = (d, list) => {
    let pool = list;
    if (d === 'values') {
      // 価値観の共通点は「どちらも平均より重視」または「どちらも平均より控えめ」の軸から選ぶ（向きが逆の軸を共通点と呼ばない）
      const same = list.filter((x) => { const i = AXES.values.indexOf(x.axis); return sign(cu[i]) !== 0 && sign(cu[i]) === sign(cc[i]); });
      if (same.length) pool = same;
    }
    const near = pool.reduce((b, x) => (x.diff < b.diff ? x : b));
    const far = list.reduce((b, x) => (x.diff > b.diff ? x : b));
    const info = (ax) => {
      if (d === 'values') { const i = AXES.values.indexOf(ax); return { you: sign(cu[i]), char: sign(cc[i]), youHigher: cu[i] > cc[i] }; }
      return { level: level(m.you[d][ax], m.char[d][ax]), youHigher: m.you[d][ax] > m.char[d][ax] };
    };
    return { near: near.axis, nearDiff: near.diff, nearInfo: info(near.axis), far: far.axis, farDiff: far.diff, farInfo: info(far.axis), farIsSmall: far.diff <= SMALL_AXIS_DIFF };
  };
  const axes = { persona: pick('persona', axisDiff.persona), style: pick('style', axisDiff.style), values: pick('values', axisDiff.values) };
  // 共鳴の章で挙げる共通点・相違点：側面に偏りがあればその側面から、無ければ3側面それぞれの候補から差の大小で（尺度をそろえない・暫定）
  let common, differ;
  if (flat) {
    const order3 = ['persona', 'style', 'values'];
    const n = order3.map((d) => ({ domain: d, axis: axes[d].near, diff: axes[d].nearDiff })).reduce((b, x) => (x.diff < b.diff ? x : b));
    const f = order3.map((d) => ({ domain: d, axis: axes[d].far, diff: axes[d].farDiff })).reduce((b, x) => (x.diff > b.diff ? x : b));
    common = { domain: n.domain, axis: n.axis, info: axes[n.domain].nearInfo };
    differ = { domain: f.domain, axis: f.axis, info: axes[f.domain].farInfo, isSmall: f.diff <= SMALL_AXIS_DIFF };
  } else {
    common = { domain: closeDomain, axis: axes[closeDomain].near, info: axes[closeDomain].nearInfo };
    differ = { domain: farDomain, axis: axes[farDomain].far, info: axes[farDomain].farInfo, isSmall: axes[farDomain].farIsSmall };
  }
  return { sims, mirrorRef, flat, closeDomain, farDomain, axes, common, differ };
}

// SYMBOLS：選んだ元素の代表座標と7元素の代表座標の距離（近い順）。武器種（5軸 RMSE）・国家（中心化コサインの (1-cos)/2）は文章用に順位だけ
function symbols(answers) {
  const a = validate(answers);
  const U = PROTO.ELEMENT_PROTOTYPES_V2[a.element];
  const elements = ELEMENTS.map((e) => ({ key: e, d: rmse(U, PROTO.ELEMENT_PROTOTYPES_V2[e], AXES.persona) }))
    .sort((x, y) => x.d - y.d || ELEMENTS.indexOf(x.key) - ELEMENTS.indexOf(y.key))
    .map((x) => ({ key: x.key, d: x.d, bar: 1 - x.d }));
  const UW = PROTO.WEAPON_PROTOTYPES_V2[a.weapon];
  const weapons = WEAPONS.map((w) => ({ key: w, d: rmse(UW, PROTO.WEAPON_PROTOTYPES_V2[w], AXES.style) }))
    .sort((x, y) => x.d - y.d || WEAPONS.indexOf(x.key) - WEAPONS.indexOf(y.key)).map((x) => x.key);
  const UN = center(PROTO.NATION_PROTOTYPES_V2[a.nation], AXES.values);
  const nations = NATIONS.map((n) => { const c = cosine(UN, center(PROTO.NATION_PROTOTYPES_V2[n], AXES.values)); return { key: n, d: c === null ? 0.5 : (1 - c) / 2 }; })
    .sort((x, y) => x.d - y.d || NATIONS.indexOf(x.key) - NATIONS.indexOf(y.key)).map((x) => x.key);
  return { elements, weaponOrder: weapons, nationOrder: nations };
}

// ---------------------------------------------------------------- 図（SVG 文字列。数字・目盛りの数値・ツールチップを出さない）
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (x) => Math.round(x * 10) / 10;
function radar(axes, you, ch, opt) {
  const cx = 150, cy = opt.cy, R = opt.R, n = axes.length;
  const pt = (i, r) => { const ang = -Math.PI / 2 + (2 * Math.PI * i) / n; return [r1(cx + Math.cos(ang) * r), r1(cy + Math.sin(ang) * r)]; };
  const ring = (k) => axes.map((_, i) => pt(i, R * k).join(',')).join(' ');
  const poly = (obj) => axes.map((ax, i) => pt(i, (R * obj[ax]) / 100).join(',')).join(' ');
  const labels = axes.map((ax, i) => { const [x, y] = pt(i, R + opt.labelGap); return `<text x="${x}" y="${r1(y + 4)}" text-anchor="middle">${esc(LABEL[ax])}</text>`; }).join('');
  const spokes = axes.map((_, i) => { const [x, y] = pt(i, R); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`; }).join('');
  return `<svg viewBox="0 0 300 ${opt.h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(opt.aria)}">`
    + `<g fill="none" stroke="rgba(150,180,240,.2)"><polygon points="${ring(1)}"/><polygon points="${ring(0.5)}"/>${spokes}</g>`
    + `<g font-size="${opt.font}" fill="#a9b8d6" font-family="serif">${labels}</g>`
    + `<polygon points="${poly(you)}" fill="${COLOR.you}" fill-opacity=".28" stroke="${COLOR.you}" stroke-width="2"/>`
    + `<polygon points="${poly(ch)}" fill="${COLOR.char}" fill-opacity=".24" stroke="${COLOR.char}" stroke-width="2"/>`
    + `</svg>`;
}
function bars(axes, you, ch) {
  const rows = axes.map((ax, i) => {
    const y = 12 + i * 28, w = 200;
    return `<text x="70" y="${y + 11}" text-anchor="end">${esc(LABEL[ax])}</text>`
      + `<rect x="80" y="${y}" width="${w}" height="14" rx="7" fill="rgba(150,180,240,.06)"/>`
      + `<rect x="80" y="${y + 1}" width="${r1((w * you[ax]) / 100)}" height="6" rx="3" fill="${COLOR.you}"/>`
      + `<rect x="80" y="${y + 8}" width="${r1((w * ch[ax]) / 100)}" height="5" rx="2.5" fill="${COLOR.char}"/>`;
  }).join('');
  return `<svg viewBox="0 0 300 ${12 + axes.length * 28}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="行動の傾向の比較"><g font-size="10" fill="#a9b8d6" font-family="serif">${rows}</g></svg>`;
}
// 価値観（CHART-2）：中央の線＝その人（モデル）の10の価値観の平均。右へ伸びるほど平均より重視、左へ伸びるほど平均より控えめ
//   上の細い棒＝アナタ（国家の代表モデル）、下の棒＝人物（登録モデル）。目盛り・数値は出さない。±50 を端とする
function divergingBars(axes, you, ch) {
  const mid = 190, half = 100, top = 24;
  const x = (v) => { const c = Math.max(-50, Math.min(50, v)); return c >= 0 ? [mid, r1((half * c) / 50)] : [r1(mid + (half * c) / 50), r1((half * -c) / 50)]; };
  const rows = axes.map((ax, i) => {
    const y = top + i * 22, [yx, yw] = x(you[ax]), [cx, cw] = x(ch[ax]);
    return `<text x="80" y="${y + 9}" text-anchor="end">${esc(LABEL[ax])}</text>`
      + `<rect x="${yx}" y="${y}" width="${yw}" height="6" rx="3" fill="${COLOR.you}"/>`
      + `<rect x="${cx}" y="${y + 7}" width="${cw}" height="5" rx="2.5" fill="${COLOR.char}"/>`;
  }).join('');
  const h = top + axes.length * 22 + 4;
  return `<svg viewBox="0 0 300 ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="価値観の地図（相対的な優先度）">`
    + `<rect x="${mid - half}" y="${top - 4}" width="${half * 2}" height="${h - top}" rx="4" fill="rgba(150,180,240,.04)"/>`
    + `<line x1="${mid}" y1="${top - 8}" x2="${mid}" y2="${h}" stroke="rgba(214,189,132,.55)" stroke-width="1"/>`
    + `<g font-size="9" fill="#8e9dbf" font-family="serif"><text x="${mid - 6}" y="12" text-anchor="end">← 控えめ</text><text x="${mid + 6}" y="12">重視 →</text></g>`
    + `<g font-size="10" fill="#a9b8d6" font-family="serif">${rows}</g></svg>`;
}
function symbolBars(series) {
  const rows = series.map((s, i) => {
    const y = 10 + i * 20;
    return `<text x="36" y="${y + 10}" text-anchor="end">${esc(s.key)}</text>`
      + `<rect x="46" y="${y}" width="${r1(230 * s.bar)}" height="11" rx="5" fill="${i === 0 ? COLOR.you : COLOR.sym}" fill-opacity="${i === 0 ? 1 : 0.5}"/>`;
  }).join('');
  return `<svg viewBox="0 0 300 ${16 + series.length * 20}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="元素の象徴的な近さ"><g font-size="11" fill="#d3dcf0" font-family="serif">${rows}</g></svg>`;
}
function figures(m, sym) {
  return {
    persona: { axes: AXES.persona, you: vec(m.you.persona, AXES.persona), char: vec(m.char.persona, AXES.persona) },
    style: { axes: AXES.style, you: vec(m.you.style, AXES.style), char: vec(m.char.style, AXES.style) },
    // CHART-2：価値観は平均中心化した相対優先度（本文の比較と同じ基準）。元の値は持たない（図と本文で基準を分けない）
    values: { axes: AXES.values, basis: 'centered', you: center(m.you.values, AXES.values).map(r1), char: center(m.char.values, AXES.values).map(r1) },
    symbols: { elements: sym.elements.map((s) => ({ key: s.key, bar: s.bar })) },
  };
}
// 保存済みの figures だけから描く（再閲覧で再計算しない）
function renderFigures(f) {
  const obj = (fig) => Object.fromEntries(fig.axes.map((ax, i) => [ax, fig.you[i]]));
  const objc = (fig) => Object.fromEntries(fig.axes.map((ax, i) => [ax, fig.char[i]]));
  return {
    persona: radar(f.persona.axes, obj(f.persona), objc(f.persona), { cy: 90, R: 62, h: 175, labelGap: 16, font: 10, aria: '性格の重なり' }),
    style: bars(f.style.axes, obj(f.style), objc(f.style)),
    values: divergingBars(f.values.axes, obj(f.values), objc(f.values)),
    symbols: symbolBars(f.symbols.elements),
  };
}

// ---------------------------------------------------------------- 本文（固定辞書＋決まった組み立て。同じ入力・同じ版なら同じ文）
// 辞書スキーマ v2（C-1 レビュー後）。ChatGPT が docs/eti-mini/phase_c/dictionary_template_v2.json を埋める。値が入るまで〔未執筆：…〕
//   comboLine（280）は廃止し、元素×武器種の相互作用（35）＋国家の読み方の規則（8）に再編。必要な組み合わせだけ comboOverride（任意）で上書き
const DICT = {
  elementInner: {},       // 元素7：内面の解釈（PERSONA）
  weaponRelation: {},     // 武器種5：人との関わり方の解釈（PERSONA）
  nationValue: {},        // 国家8：価値観の解釈（PERSONA）
  comboInteraction: {},   // 35（元素|武器種）：内面と関わり方が組み合わさったときの相互作用（PERSONA）
  nationLens: {},         // 国家8：上の相互作用を、その国家の価値観から読むための一文（PERSONA。どの元素×武器種にも続けて読める書き方）
  weaponAction: {},       // 武器種5：象徴的な行動の文（STYLE）
  nationPriority: {},     // 国家8：象徴する優先価値の文（VALUES）
  symbolMeaning: {},      // 'all'：元素＝内面・武器種＝行動・国家＝価値観の象徴の解説（SYMBOLS）
  axisCommon: {},         // 20軸：その軸で重なることの意味（STYLE・VALUES・RESONANCE「共通する性質」）
  axisDifference: {},     // 20軸：その軸で違うことの、無理のない解説（STYLE・VALUES・RESONANCE「異なる性質」）
  domainScene: {},        // 3側面：共通点がどんな場面に現れうるか（RESONANCE「共通する性質」）
  characterModel: {},     // キャラ66：登録モデルの説明（basis_tags・登録座標で検証できる範囲。RESONANCE「登録モデル」）
  characterReading: {},   // キャラ66：共通点・相違点から考えられる解釈（設定を断定しない。RESONANCE「解釈」）
  journeyIntro: {},       // 'all'：問いの導入（JOURNEY）
  journeyElement: {},     // 元素7：元素のテーマを生活に引き寄せた問い（JOURNEY）
  journeyCombo: {},       // 40（武器種|国家）：第二の問い（JOURNEY）
};
// 任意（無くても〔未執筆〕にしない）：特定の 元素|武器種|国家 で、comboInteraction＋nationLens の代わりに使う一文
const OPTIONAL_DICT = { comboOverride: {} };
function slot(dict, family, key, missing) {
  const v = dict[family] && dict[family][key];
  if (typeof v === 'string' && v) return v;
  missing.push(family + ':' + key);
  return `〔未執筆：${family}:${key}〕`;
}
function optional(dict, family, key) { const v = dict[family] && dict[family][key]; return typeof v === 'string' && v ? v : null; }
// 共通・相違の言い方（数値は出さない。誇張しない）
function commonPhrase(domain, axis, info, name) {
  const L = `「${LABEL[axis]}」`;
  if (domain === 'values') return info.you !== info.char ? `${L}の優先度の現れ方が近くなっています`
    : info.you > 0 ? `${L}は、回答の人物像でも${name}の登録モデルでも、ほかの価値観より相対的に重視されています`
    : info.you < 0 ? `${L}は、回答の人物像でも${name}の登録モデルでも、ほかの価値観より相対的に控えめです`
      : `${L}の優先度の現れ方が近くなっています`;
  return info.level === 'high' ? `${DOMAIN_LABEL[domain]}の${L}は、どちらのモデルでも高めに表れています`
    : info.level === 'low' ? `${DOMAIN_LABEL[domain]}の${L}は、どちらのモデルでも控えめに表れています`
      : `${DOMAIN_LABEL[domain]}の${L}は、どちらのモデルでも同じくらいの強さで表れています`;
}
function differPhrase(domain, axis, info, name) {
  const L = `「${LABEL[axis]}」`;
  if (domain === 'values') {
    const side = (x) => (x > 0 ? '相対的に重視' : x < 0 ? '相対的に控えめ' : 'ほかと同じくらいの優先度');
    const who = (you) => (you ? '回答の人物像' : `${name}の登録モデル`);
    if (info.you > 0 && info.char > 0) return `${L}は、どちらでも相対的に重視されていますが、${who(info.youHigher)}のほうがよりはっきり重視しています`;
    if (info.you < 0 && info.char < 0) return `${L}は、どちらでも相対的に控えめですが、${who(!info.youHigher)}のほうがより控えめです`;
    return `${L}は、回答の人物像では${side(info.you)}、${name}の登録モデルでは${side(info.char)}です`;
  }
  return `${DOMAIN_LABEL[domain]}の${L}は、${info.youHigher ? '回答の人物像のほうが強く' : `${name}の登録モデルのほうが強く`}表れています`;
}
function composeText(m, an, sym, dict) {
  dict = dict || DICT;
  const a = m.answers, name = m.mirror, miss = [];
  const S = (f, k) => slot(dict, f, k, miss);
  const nd = NATION_DISPLAY[a.nation] || a.nation;
  const core = require('../js/eti_mini_core.js');
  const st = an.axes.style, va = an.axes.values;
  const text = {};
  // PERSONA：3つの解釈 → 元素×武器種の相互作用 → 国家の読み方（または組み合わせ固有の上書き）
  const override = optional(dict, 'comboOverride', a.element + '|' + a.weapon + '|' + a.nation);
  text.persona = `アナタの3つの選択は、${S('elementInner', a.element)}を大切にし、${S('weaponRelation', a.weapon)}を選び、${S('nationValue', a.nation)}に心を向ける人物像を描きます。`
    + 'これはアナタのすべてを表すものではありませんが、いま惹かれる在り方を見つめる手掛かりになります。'
    + (override || (S('comboInteraction', a.element + '|' + a.weapon) + S('nationLens', a.nation)));
  // RESONANCE（最重要）：5つの区分を分けて書く
  const c = an.common, d = an.differ;
  text.resonance = [
    { part: 'answers', label: '回答から構成した人物像',
      body: `3つの選択（${a.element}×${a.weapon}×${nd}）からは、「${core.ELEMENT_KEYWORD[a.element]}」気質、「${core.WEAPON_STYLE[a.weapon]}」の関わり方、「${core.NATION_MEANING[a.nation]}」を大切にする在り方を組み合わせた人物像が構成されます。これは選んだ元素・武器種・国家の代表モデルで、アナタを測定したものではありません。` },
    { part: 'character', label: `${name}の登録モデル`,
      body: `${name}は、この人物像と共鳴しうる人物として割り当てられています。${S('characterModel', name)}` },
    { part: 'common', label: '両者に共通する性質',
      body: (an.flat ? '性格・行動の傾向・価値観の3つの側面で、モデルの上では大きな偏りはありません。' : '')
        + `${commonPhrase(c.domain, c.axis, c.info, name)}。${S('axisCommon', c.axis)}。${S('domainScene', c.domain)}。` },
    { part: 'difference', label: '異なる性質',
      body: d.isSmall ? `違いはわずかですが、${differPhrase(d.domain, d.axis, d.info, name)}。`
        : `${differPhrase(d.domain, d.axis, d.info, name)}。${S('axisDifference', d.axis)}。` },
    { part: 'reading', label: 'そこから考えられる解釈',
      body: `共鳴とは、すべてが同じという意味ではありません。${S('characterReading', name)}` },
  ];
  // STYLE
  text.style = `${S('weaponAction', a.weapon)}。図は、その武器種の代表モデルと${name}の登録モデルを比較したものです。`
    + `${commonPhrase('style', st.near, st.nearInfo, name)}。${S('axisCommon', st.near)}。`
    + (st.farIsSmall ? 'ほかの傾向にも、大きな違いは見られません。' : `一方、${differPhrase('style', st.far, st.farInfo, name)}。${S('axisDifference', st.far)}。`);
  // VALUES（図と同じ相対優先度で書く）
  text.values = `${S('nationPriority', a.nation)}。図は、それぞれのモデルの中で、10の価値観のどれを相対的に重視し、どれを控えめにしているかを示しています。`
    + `${commonPhrase('values', va.near, va.nearInfo, name)}。${S('axisCommon', va.near)}。`
    + (va.farIsSmall ? 'ほかの価値観の優先度にも、大きな違いは見られません。' : `一方、${differPhrase('values', va.far, va.farInfo, name)}。${S('axisDifference', va.far)}。`);
  text.symbols = `今回の結果は${a.element}×${a.weapon}×${nd}。${S('symbolMeaning', 'all')}。`
    + `下の元素図は${a.element}の代表座標と、ほかの元素モデルとの距離を示したものです。ほかの元素を個別に測定した結果ではありません。`;
  text.journey = `${S('journeyIntro', 'all')}。アナタは、${S('journeyElement', a.element)}をどんな場面で感じますか。`
    + `${S('journeyCombo', a.weapon + '|' + a.nation)}。答えを急がず、自分の言葉で考えてみることが、今回の結果の使い方のひとつです。`;
  return { text, missing: Array.from(new Set(miss)) };
}

// ---------------------------------------------------------------- スナップショット（購入時に1度だけ作り、再閲覧はこれだけを読む）
function fileSha256(rel) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex'); }
function sourceHashes() {
  return {
    prototypeSha256: fileSha256('js/eti_v2_prototypes.js'),
    characterSha256: fileSha256('js/characters118_v2_1.js'),
    assignmentSha256: MAP.sourceSha256, // 割当表の正本 JSON の sha256（js/eti_mini_auto_map_v1.js に記録）
    assignmentVersion: MAP.version,
  };
}
const TYPE_CODE = { el: { '炎': 'PY', '水': 'HY', '氷': 'CR', '雷': 'EL', '風': 'AN', '岩': 'GE', '草': 'DE' }, w: { '片手剣': 'SW', '両手剣': 'CM', '長柄': 'PL', '法器': 'CT', '弓': 'BW' },
  n: { 'モンド': 'M', '璃月': 'L', '稲妻': 'I', 'スメール': 'S', 'フォンテーヌ': 'F', 'ナタ': 'N', 'スネージナヤ': 'Z', 'ナドクライ': 'D' } };
// purchase：{ orderId, createdAt }（サーバーが決める。金額・商品はここで固定し、リクエストから受け取らない）
function buildSnapshot(answers, purchase, opts) {
  opts = opts || {};
  const m = modelVectors(answers);
  const an = analyze(m);
  const sym = symbols(m.answers);
  const { text, missing } = composeText(m, an, sym, opts.dict);
  if (missing.length && !opts.allowMissing) { const e = new Error('DICTIONARY_INCOMPLETE'); e.code = 'DICTIONARY_INCOMPLETE'; e.missing = missing; throw e; }
  const a = m.answers;
  const typeName = require('../js/eti_mini_core.js').TYPE_NAME[a.element][a.weapon];
  return {
    schema_version: VERSIONS.schema,
    input: { element: a.element, weapon: a.weapon, nation: a.nation },
    result: { element: a.element, weapon: a.weapon, nation: a.nation, nation_display: NATION_DISPLAY[a.nation] || a.nation,
      type_code: TYPE_CODE.el[a.element] + TYPE_CODE.w[a.weapon] + '-' + TYPE_CODE.n[a.nation], type_name: typeName,
      mirror_character: m.mirror, mirror_element: m.mirrorElement },
    model: { character_version: 'ETI-CHAR-2.1.0', translation_version: PROTO.TRANSLATION_MODEL_VERSION, ...sourceHashes(),
      calc_version: VERSIONS.calc, select_version: VERSIONS.select, text_version: VERSIONS.text, chart_version: VERSIONS.chart },
    figures: figures(m, sym),
    text,
    purchase: { product_code: 'resonance_report_v1', amount_jpy: 500, currency: 'jpy', order_id: purchase && purchase.orderId, created_at: purchase && purchase.createdAt },
    ...(missing.length ? { draft_missing: missing } : {}),
  };
}

// 保存済みスナップショットから表示用の HTML 断片を作る（計算し直さない）
// 価値観の図の読み方（図のすぐ下に置く）
const VALUES_READING = '中央の線は、それぞれのモデルの10の価値観の平均です。右へ伸びるほど平均より重視、左へ伸びるほど平均より控えめを表します。値の大きさではなく、そのモデルの中での優先度の並びを比べる図です。';
const CHAPTERS = [
  ['persona', 'PERSONA', 'アナタの人物像'],
  ['resonance', 'RESONANCE', 'なぜ、この人物が現れたのか'],
  ['style', 'STYLE', '行動の傾向の比較'],
  ['values', 'VALUES', '価値観の地図'],
  ['symbols', 'SYMBOLS', '元素・武器種・国家の象徴'],
  ['journey', 'JOURNEY', 'アナタ自身への問い'],
];
function renderReportHtml(snap) {
  const svg = renderFigures(snap.figures);
  const fig = { persona: svg.persona, style: svg.style, values: svg.values, symbols: svg.symbols };
  const legend = `<p class="rr-legend"><i style="background:${COLOR.you}"></i>アナタ（選んだ元素・武器種・国家の代表モデル）　<i style="background:${COLOR.char}"></i>${esc(snap.result.mirror_character)}（登録モデル）</p>`;
  const textOf = (k) => (Array.isArray(snap.text[k])
    ? snap.text[k].map((p) => `<div class="rr-part" data-part="${esc(p.part)}"><h3>${esc(p.label)}</h3><p class="rr-text">${esc(p.body)}</p></div>`).join('')
    : `<p class="rr-text">${esc(snap.text[k])}</p>`);
  const body = CHAPTERS.map(([k, en, jp]) => `<section class="rr-ch" data-ch="${k}"><p class="rr-en">${en}</p><h2>${esc(jp)}</h2>`
    + (fig[k] ? `<div class="rr-fig">${fig[k]}</div>${k === 'symbols' ? '' : legend}${k === 'values' ? `<p class="rr-read">${esc(VALUES_READING)}</p>` : ''}` : '')
    + textOf(k) + '</section>').join('');
  return `<article class="rr"><p class="rr-lead">アナタに共鳴する人物</p><h1 class="rr-name">${esc(snap.result.mirror_character)}</h1>`
    + `<p class="rr-type">${esc(snap.result.element)} × ${esc(snap.result.weapon)} × ${esc(snap.result.nation_display)}　「${esc(snap.result.type_name)}」</p>`
    + `<p class="rr-note">${esc(DISCLAIMER)}</p>${body}</article>`;
}

module.exports = {
  VERSIONS, AXES, LABEL, DISCLAIMER, VALUES_READING, FLAT_DOMAIN, SMALL_AXIS_DIFF, DICT, OPTIONAL_DICT, CHAPTERS,
  validate, mirrorOf, modelVectors, analyze, symbols, composeText, figures, renderFigures, buildSnapshot, renderReportHtml,
  _internal: { rmse, center, cosine, vSimOf },
};
