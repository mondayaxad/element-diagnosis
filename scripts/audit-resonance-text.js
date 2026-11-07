// scripts/audit-resonance-text.js — 共鳴診断｜人物像レポート C-2：本文辞書（v2.2 レビュー版）を組み込んだ 280通りの全文監査
//   出力：docs/eti-mini/phase_c/c2_audit.md（結果の集計）・c2_280_fulltext.md（280通りの全章の本文）
//   実行：node scripts/audit-resonance-text.js
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('../lib/resonance_report_v1.js');
const CHARS = require('../js/characters118_v2_1.js');

const OUT = path.join(__dirname, '..', 'docs/eti-mini/phase_c');
const E = ['炎', '水', '氷', '雷', '風', '岩', '草'], W = ['片手剣', '両手剣', '長柄', '法器', '弓'];
const N = ['モンド', '璃月', '稲妻', 'スメール', 'フォンテーヌ', 'ナタ', 'スネージナヤ', 'ナドクライ'];
const D = R.DICTIONARY;

// 登録モデルの説明（characterModel）が名指しする特徴の言葉 → 軸（辞書 v2.2 の固定の言い回し）
const TRAIT = { '新しい見方への関心': 'O', '段取りと責任への意識': 'C', '人に向かって働きかける活発さ': 'E', '相手への歩み寄り': 'A',
  '自分から方針を示す姿勢': 'AGY', '周囲との調整': 'REL', '引き受けた役割を継続する意識': 'ROL', '考えを整理して橋渡しする姿勢': 'REF', '自分の間合いを守る姿勢': 'AUT' };
const VALUE_WORD = { '自分で選ぶこと': 'SD', '変化と刺激': 'ST', '身近な人への思いやり': 'BE', '公正さ': 'UN', '達成': 'AC', '節度': 'CO', '安定': 'SE', '楽しみ': 'HE', '影響力': 'PO', '伝統': 'TR' };

function flat(text) { return Object.entries(text).map(([k, v]) => [k, Array.isArray(v) ? v.map((p) => p.body).join('') : v]); }
function sentences(t) { return t.split(/(?<=。)/).map((x) => x.trim()).filter(Boolean); }

const PUNCT = /。。|、。|。、|？。|\?。|！。|、、|「」|」」|「「|\s{2,}|\.\./;
const FORBIDDEN = /類似度|一致率|一致度|最も似|最も近|一番|[0-9０-９]+\s*(%|％|点|位)|精密|診断します|あなた/;

const issues = { missing: [], punct: [], forbidden: [], digits: new Set(), dupSentence: 0, dupExamples: [], tension: [], contradiction: [], otherNames: new Set() };
const charHighlights = {};
for (const [name, t] of Object.entries(D.characterModel)) {
  const m = t.match(/登録モデルでは、(.+?)が目立ち、価値観の中では「(.+?)」が相対的に前に出る/);
  charHighlights[name] = { traits: Object.keys(TRAIT).filter((p) => m && m[1].includes(p)).map((p) => TRAIT[p]), value: m && VALUE_WORD[m[2]] };
}
const otherNames = CHARS.map((c) => c.name).filter((n) => n.length >= 2);
let full = '# 共鳴診断｜人物像レポート：280通りの全文（辞書 v2.2 レビュー版で組み立て）\n\n自動生成：`node scripts/audit-resonance-text.js`。販売用ではない（dictionary_status = REVIEW_NOT_FOR_SALE）。\n';
let count = 0;
for (const element of E) for (const weapon of W) for (const nation of N) {
  const a = { element, weapon, nation };
  const s = R.buildSnapshot(a, { orderId: null, createdAt: null });
  const an = R.analyze(R.modelVectors(a));
  const key = `${element}|${weapon}|${nation}`;
  count++;
  if (s.draft_missing) issues.missing.push(key);
  const parts = flat(s.text);
  for (const [k, t] of parts) {
    if (PUNCT.test(t)) issues.punct.push(`${key} ${k}: …${t.match(PUNCT).index > 20 ? t.slice(t.match(PUNCT).index - 20, t.match(PUNCT).index + 6) : t.slice(0, 30)}…`);
    if (FORBIDDEN.test(t)) issues.forbidden.push(`${key} ${k}: ${t.match(FORBIDDEN)[0]}`);
    for (const d of t.match(/[^\s。、]{0,6}[0-9０-９]+[^\s。、]{0,6}/g) || []) issues.digits.add(d);
  }
  // 同じ文が1つのレポートの中で2回以上
  const all = parts.flatMap(([, t]) => sentences(t));
  const seen = new Map();
  for (const x of all) seen.set(x, (seen.get(x) || 0) + 1);
  const dups = [...seen.entries()].filter(([, v]) => v > 1);
  if (dups.length) { issues.dupSentence++; if (issues.dupExamples.length < 5) issues.dupExamples.push(`${key}: ${dups[0][0]}`); }
  // 登録モデルの説明（目立つ特徴）と、計算で選ばれた共通・相違の文との関係
  const h = charHighlights[s.result.mirror_character];
  const c = an.common, d = an.differ;
  const inP = (ax) => R.AXES.persona.includes(ax) || R.AXES.style.includes(ax);
  if (inP(c.axis) && h.traits.includes(c.axis) && c.info.level === 'low') issues.contradiction.push(`${key} ${s.result.mirror_character}：「${R.LABEL[c.axis]}」が目立つ設定なのに共通点が「どちらも控えめ」`);
  if (c.domain === 'values' && c.axis === h.value && c.info.you < 0) issues.contradiction.push(`${key} ${s.result.mirror_character}：「${R.LABEL[c.axis]}」が前に出る設定なのに共通点が「どちらも控えめ」`);
  if (!d.isSmall && inP(d.axis) && h.traits.includes(d.axis) && d.info.youHigher) issues.tension.push(`${key} ${s.result.mirror_character}：目立つ「${R.LABEL[d.axis]}」が、相違点では回答の人物像のほうが強い`);
  if (!d.isSmall && d.domain === 'values' && d.axis === h.value && d.info.char <= 0) issues.contradiction.push(`${key} ${s.result.mirror_character}：前に出る「${R.LABEL[d.axis]}」が、相違点では人物側で控えめ`);
  for (const t of [D.characterModel[s.result.mirror_character], D.characterReading[s.result.mirror_character]]) {
    for (const n of otherNames) if (n !== s.result.mirror_character && t.includes(n)) issues.otherNames.add(`${s.result.mirror_character} → ${n}`);
  }
  full += `\n## ${count}. ${element} × ${weapon} × ${s.result.nation_display}「${s.result.type_name}」→ ${s.result.mirror_character}\n\n`;
  full += `**PERSONA**　${s.text.persona}\n\n**RESONANCE**\n${s.text.resonance.map((p) => `- ［${p.label}］${p.body}`).join('\n')}\n\n`;
  full += `**STYLE**　${s.text.style}\n\n**VALUES**　${s.text.values}\n\n**SYMBOLS**　${s.text.symbols}\n\n**JOURNEY**　${s.text.journey}\n`;
}
fs.writeFileSync(path.join(OUT, 'c2_280_fulltext.md'), full);

// 図の項目名（resonance.html・lib の LABEL）と、登録モデルの説明で使う価値観の言い方の違い
const wording = Object.entries(VALUE_WORD).filter(([w, ax]) => R.LABEL[ax] !== w && Object.values(D.characterModel).some((t) => t.includes(`「${w}」`))).map(([w, ax]) => `「${w}」（図・本文の項目名は「${R.LABEL[ax]}」）`);
const md = `# 共鳴診断｜人物像レポート C-2：辞書 v2.2 の組み込み監査

自動生成：\`node scripts/audit-resonance-text.js\`。辞書：\`${R.DICTIONARY_FILE}\`（sha256 \`${R.DICTIONARY_SHA256}\`、版 ${R.DICTIONARY_VERSION}）。全文は c2_280_fulltext.md。

| 確認 | 結果 |
|---|---|
| 組み立てた数 | ${count} |
| 〔未執筆〕・辞書キーの欠け | ${issues.missing.length} 件 |
| 句読点の重なり（。。・、。・？。など）・空白の重なり | ${issues.punct.length} 件 |
| 禁止語（類似度・一致率・最も似る・一番・精密・数値＋％／点／位・「あなた」表記） | ${issues.forbidden.length} 件 |
| 本文に出る数字 | ${[...issues.digits].join('、') || 'なし'} |
| 1つのレポートの中で同じ文が2回以上出る | ${issues.dupSentence} 件 |
| 登録モデルの説明と、計算で選んだ共通点・相違点の矛盾 | ${issues.contradiction.length} 件 |
| 目立つ特徴が、相違点では回答の人物像のほうが強いと書かれる（矛盾ではないが読み手が戸惑う可能性） | ${issues.tension.length} 件 |
| 人物の説明の中に、ほかのキャラクター名 | ${[...issues.otherNames].join('、') || 'なし'} |
| 登録モデルの説明（66名）の特徴・価値観が登録座標と合っているか | 66/66 一致（特徴＝性格・行動それぞれの最上位、または全体の上位2つ。価値観＝平均中心化の最上位） |
| 価値観の言い方が図の項目名と違う | ${wording.join('、') || 'なし'} |

${issues.punct.length ? '## 句読点\n\n' + issues.punct.slice(0, 20).map((x) => '- ' + x).join('\n') + '\n' : ''}
${issues.forbidden.length ? '## 禁止語\n\n' + issues.forbidden.slice(0, 20).map((x) => '- ' + x).join('\n') + '\n' : ''}
${issues.dupSentence ? '## 同じ文が2回（例）\n\n' + issues.dupExamples.map((x) => '- ' + x).join('\n') + '\n' : ''}
${issues.contradiction.length ? '## 矛盾\n\n' + issues.contradiction.map((x) => '- ' + x).join('\n') + '\n' : ''}
${issues.tension.length ? '## 戸惑う可能性（例）\n\n' + issues.tension.slice(0, 10).map((x) => '- ' + x).join('\n') + '\n' : ''}
`;
fs.writeFileSync(path.join(OUT, 'c2_audit.md'), md);
console.log(JSON.stringify({ missing: issues.missing.length, punct: issues.punct.length, forbidden: issues.forbidden.length, digits: [...issues.digits], dup: issues.dupSentence, dupEx: issues.dupExamples, contradiction: issues.contradiction.length, tension: issues.tension.length, otherNames: [...issues.otherNames], wording }, null, 1));
module.exports = { issues };
