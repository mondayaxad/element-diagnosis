# 共鳴診断｜人物像レポート C-1：280件の監査

自動生成：`node scripts/audit-resonance-report.js`（全件は audit_280.json）。数値は監査用で、画面・本文には出さない。

## 1. 3側面の内部の近さ（pSim・sSim・vSim）の分布

| 指標 | 最小 | 25% | 中央 | 75% | 最大 |
|---|---|---|---|---|---|
| pSim（性格・RMSE） | 0.552 | 0.781 | 0.808 | 0.842 | 0.919 |
| sSim（行動・RMSE） | 0.645 | 0.757 | 0.814 | 0.853 | 0.955 |
| vSim（価値観・中心化コサイン） | 0.529 | 0.749 | 0.810 | 0.875 | 0.961 |

## 2. 「比較的近い側面」「違いが表れた側面」の選ばれ方（設計書§3-5 の暫定ルール）

- 3側面の差が 0.05 未満（偏りなし）：**31 件** / 280

| 近い側面 | 件数 |
|---|---|
| values | 97 |
| style | 88 |
| persona | 64 |
| （偏りなし） | 31 |

| 違いの側面 | 件数 |
|---|---|
| style | 96 |
| values | 91 |
| persona | 62 |
| （偏りなし） | 31 |

## 3. 共鳴の章で挙げる軸

| 共通点の軸 | 件数 |
|---|---|
| style:REL | 31 |
| style:AGY | 30 |
| persona:O | 30 |
| values:SD | 20 |
| values:SE | 19 |
| style:ROL | 18 |
| persona:C | 16 |
| values:HE | 15 |
| values:ST | 12 |
| style:REF | 12 |
| persona:E | 11 |
| values:UN | 11 |
| values:BE | 10 |
| persona:A | 9 |
| persona:N | 8 |
| values:CO | 7 |
| style:AUT | 7 |
| values:PO | 6 |
| values:AC | 5 |
| values:TR | 3 |

| 相違点の軸 | 件数 |
|---|---|
| style:REF | 29 |
| persona:E | 26 |
| values:TR | 23 |
| values:UN | 21 |
| style:AGY | 21 |
| style:REL | 20 |
| style:ROL | 19 |
| values:SD | 18 |
| persona:N | 16 |
| values:PO | 15 |
| persona:C | 11 |
| values:ST | 10 |
| style:AUT | 9 |
| persona:A | 8 |
| persona:O | 8 |
| values:CO | 7 |
| values:BE | 7 |
| values:SE | 7 |
| values:AC | 3 |
| values:HE | 2 |

## 4. 割り当てられた人物は、本家 MIRROR の総合参照値で66名中何位か（均等化の影響）

| 順位 | 件数 |
|---|---|
| 1位 | 132 |
| 4〜10位 | 75 |
| 2〜3位 | 63 |
| 11位以下 | 10 |

- 1位でない割当が多いほど、「類似度が一番高いから現れた」とは書けない（設計書§1・§4 RESONANCE の禁止事項の裏付け）

## 5. 気づいた点（ChatGPT への返却用）

- 「近い側面」は 価値観 107・行動 104・性格 69（偏りなしの件も含めた、最も近い側面の数）。極端な偏りがあれば、側面の比較をやめて軸ごとの説明だけにする代替案（設計書§3-5）を検討してほしい
- vSim（中心化コサイン）と pSim・sSim（RMSE）は尺度が違う。上の分布の幅は近いが、同じ尺度ではない点は設計書のとおり
- 武器種が同じなら STYLE の代表モデルは同じ。国家が同じなら VALUES も同じ（設計書§2 の注意どおり）。同じ人物が別タイプで現れる時、STYLE・VALUES の文は武器種・国家ごとにしか変わらない
