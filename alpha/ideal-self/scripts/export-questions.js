// 質問文・選択肢・設問意図・追加質問の分岐条件を、レビュー用の Markdown に書き出す。
//   実行: node alpha/ideal-self/scripts/export-questions.js > alpha/ideal-self/docs/QUESTIONS_REVIEW.md
import { QUICK_QUESTIONS, IDEAL_QUESTIONS, QUICK_SET_VERSION, IDEAL_SET_VERSION, MAX_QUESTIONS, MAX_FOLLOWUPS } from '../src/questions.js';
import { RULE_VERSION, ETI_TRAIT_RULES, VALUE_CENTERED_MIN, VALUE_TOP_N, TRAITS, INVERSION_RISKS, OPPOSING_TRAITS } from '../src/catalog.js';

const L = [];
const opts = (q) => q.options.map((o) => `  - \`${o.id}\` ${o.label}${o.traits && o.traits.length ? ` → 特性 ${o.traits.join(', ')}` : ''}${o.capabilities && o.capabilities.length ? ` → 能力 ${o.capabilities.join(', ')}` : ''}${o.aspirations ? ` → 魅力 ${o.aspirations.join(', ')}` : ''}${o.values ? ` → 価値観 ${o.values.join(', ')}` : ''}`).join('\n');
L.push('# 質問文と分岐理由（レビュー用・自動生成）', '');
L.push(`質問セット：簡易 ${QUICK_SET_VERSION}／理想 ${IDEAL_SET_VERSION}／ルール ${RULE_VERSION}。すべて選択式。`, '');
L.push('> 生成元：`src/questions.js`・`src/adaptive.js`・`src/catalog.js`。手で編集せず `node alpha/ideal-self/scripts/export-questions.js` で作り直す。', '');
L.push('## 1. 現在像の簡易質問（6問）', '', '未受診・同意拒否・欠損・旧版・未知版のとき。結果は「本人の自己申告」。ETI 相当の測定精度・尺度の網羅性は主張しない。', '');
for (const q of QUICK_QUESTIONS) L.push(`### ${q.id}　${q.text}`, `意図：${q.why}`, '', opts(q), '');
L.push('## 2. ETI v2 → 特性候補の規則（設計上の仮説）', '', '| 尺度 | 条件 | 特性候補 |', '|---|---|---|');
for (const r of ETI_TRAIT_RULES) L.push(`| ${r.domain}.${r.axis} | ${r.op} ${r.threshold} | ${r.trait}（${TRAITS[r.trait].label}） |`);
L.push('', `VALUES：中心化値 > ${VALUE_CENTERED_MIN} の上位 ${VALUE_TOP_N} 軸まで。35〜65 の中間帯は「目立った傾向なし」として何も出さない（推測で補わない）。`, '');
L.push('## 3. 理想像の基本12問（KEEP 4／GROW 4／EXPRESS 4）', '');
for (const q of IDEAL_QUESTIONS) L.push(`### ${q.id}［${q.purpose}］${q.multi ? `（${q.multi}つまで）` : ''}　${q.text}`, `意図：${q.why}`, '', opts(q), '');
L.push(`## 4. 追加質問（最大 ${MAX_FOLLOWUPS} 問・合計 ${MAX_QUESTIONS} 問まで）`, '', '基本12問がすべて終わってから判定する。1段目（基本12問の回答だけで決まるもの）を上から優先して並べ、2段目（追加回答で確定した成長目標への inversion）はその後ろに足す。合計6問を超えた分は出さず、下書きで「未確定（質問上限）」として示す。保護特性との確認が上限で出せなかった場合は、その特性を保護したまま未確定にする。', '',
  '| 優先 | 種類 | 出す条件 | 理由（画面に表示） |', '|---|---|---|---|',
  `| 1 | inversion | 本人の保護特性（K1・K2・K4）と、最終的に採用する成長目標・憧れ（E1）が反転のおそれのある組。成長目標は G1・G2 の回答、または追加質問（F_GROW_PRIORITY・F_GROW）の回答で確定したもの。追加回答で確定した目標への確認は「2段目」として、その回答の直後に出す（${Object.entries(INVERSION_RISKS).filter(([, v]) => v.length).map(([k, v]) => `${k}↔${v.join('/')}`).join('、')}） | 本人の確認なしに性格を反転させない |`,
  `| 2 | observed_mismatch | K1 で選んだ特性が、現在像の特性と逆向き（${OPPOSING_TRAITS.map((p) => p.join('↔')).join('、')}） | 測定・自己申告と本人選択のどちらも勝手に正しいとしない |`,
  '| 3 | growth_mismatch | G1 と G2 が別の能力を指す | どちらを先に伸ばすかを確かめる |',
  '| 4 | keep_unclear | K1 が「わからない」で、K1・K2・K4 から保護特性が一つも出ない | 保護特性が未確定 |',
  '| 5 | values_unclear | K3 が「わからない」 | 判断原則の土台が未確定 |',
  '| 6 | growth_unclear | G1・G2 のどちらからも能力が出ない | 成長対象が未確定 |',
  '| 7 | aspiration_unclear | E1 が「わからない」 | 憧れが未確定 |',
  '| 8 | transform_target | G4 が「性格そのものを変えたい」で、inversion が出ていない | 変えない部分を保護するため、変えたい部分を確かめる |', '',
  '回答の扱い：inversion で「保ったまま」→ 保護を維持し能力に制約をつける／「手放す」→ released_traits へ（本人回答として記録）／「まだ決められない」→ 保護を維持し未確定に記録。observed_mismatch で「ふだんは観測側が近い」→ 保護特性を未確認に戻し未確定に記録。', '');
console.log(L.join('\n'));
