// 約束の文言（読み取り専用の部品。更新処理は持たない）。
// 「事前に決めた予算」と「期限まで追加で課金しない」を分けて示す。
// 「上限 X 円を超える追い課金をしない」は「X 円までは追い課金してよい」と読めるため使わない。
// 作成・引下げ後・「止めて」・振り返りで、すべてこの関数の文を使う（同じ意味に揃える）。
// 内部の項目名 cap_yen は「事前に決めた予算（円）」を指す。

export const yenText = (n) => `${Number(n).toLocaleString('ja-JP')} 円`;

// 予算そのものの言い方。0 円のときは「課金しない」と明示する
export const budgetText = (budget) => (budget === 0 ? '0 円（課金しない）' : yenText(budget));

// 約束の文（1文目：事前に決めた予算／2文目：追加で課金しない）
export function ruleText(budget) {
  return `事前に決めた予算は ${budgetText(budget)}。足りなくても、期限まで追加で課金しない`;
}

// 「止めて」で5年後の自分が言う約束の部分
export function promiseSpoken(budget, deadline) {
  return budget === 0
    ? `${deadline}まで、課金はしない（予算 0 円）。足りなくても追加で課金しない、と約束した`
    : `事前に予算を ${yenText(budget)}と決めて、足りなくても${deadline}まで追加で課金しない、と約束した`;
}

// 振り返りの問い
export function reflectionQuestion(budget) {
  return budget === 0
    ? '期限まで、課金せずに済みましたか（予算 0 円）'
    : `事前に決めた予算（${yenText(budget)}）のほかに、期限まで追加で課金せずに済みましたか`;
}
