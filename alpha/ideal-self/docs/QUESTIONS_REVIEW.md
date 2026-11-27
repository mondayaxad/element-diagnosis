# 質問文と分岐理由（レビュー用・自動生成）

質問セット：簡易 ISA-QUICK-0.1.0／理想 ISA-IDEAL-0.1.0／ルール ISA-RULE-0.3.0。すべて選択式。

> 生成元：`src/questions.js`・`src/adaptive.js`・`src/catalog.js`。手で編集せず `node alpha/ideal-self/scripts/export-questions.js` で作り直す。

## 1. 現在像の簡易質問（6問）

未受診・同意拒否・欠損・旧版・未知版のとき。結果は「本人の自己申告」。ETI 相当の測定精度・尺度の網羅性は主張しない。

### C1　疲れたとき、元気が戻りやすいのはどちらですか
意図：内省／交流のどちらで回復するか（外向性の簡易な手がかり。測定ではない）

  - `alone` 一人で静かに過ごす → 特性 inner_focus
  - `people` 人と話したり過ごしたりする → 特性 sociability
  - `both` 場合による
  - `unknown` わからない・まだ決められない

### C2　新しいことに取りかかるとき、近いのはどちらですか
意図：熟考と発案のどちらが先に立つか

  - `plan` まず状況を整理してから動く → 特性 deliberation
  - `act` 自分から方針を出して動き出す → 特性 initiative
  - `both` 場合による
  - `unknown` わからない・まだ決められない

### C3　興味の向き方として近いのはどちらですか
意図：探索（好奇心）と深化（集中）のどちらが強いか

  - `explore` 新しい分野や考え方を探りたくなる → 特性 curiosity
  - `deepen` 慣れた分野をもっと深めたくなる → 特性 depth_mastery
  - `both` どちらも同じくらい
  - `unknown` わからない・まだ決められない

### C4　意見が違う相手と話すとき、先にすることは
意図：理解と率直さのどちらが先に出るか

  - `understand` 相手の立場をまず理解しようとする → 特性 empathy
  - `state` 自分の考えを先に伝える → 特性 self_expression
  - `adjust` 相手に合わせて進め方を変える → 特性 attunement
  - `unknown` わからない・まだ決められない

### C5　大事なことを決めるとき、近いのはどれですか
意図：自律・役割遂行・着実さのどれが判断の軸になっているか

  - `self` 最後は自分の判断で選ぶ → 特性 self_direction_style
  - `role` 自分の役割として必要なことを選ぶ → 特性 supportive_commitment
  - `steps` 手順を確かめて着実に選ぶ → 特性 diligence
  - `unknown` わからない・まだ決められない

### C6　今の自分がいちばん大切にしていることに近いのは
意図：中心にある価値観の自己申告（VALUES の1軸だけ。順位は推定しない）

  - `SD` 自分の生き方を自分で選べること → 価値観 SD
  - `AC` 能力を発揮し成果を形にすること → 価値観 AC
  - `BE` 身近な人が幸せに暮らせること → 価値観 BE
  - `UN` 立場にかかわらず人が公平に扱われること → 価値観 UN
  - `SE` 安心できる安定した環境 → 価値観 SE
  - `ST` 新しい経験や変化 → 価値観 ST
  - `unknown` わからない・答えたくない

## 2. ETI v2 → 特性候補の規則（設計上の仮説）

| 尺度 | 条件 | 特性候補 |
|---|---|---|
| personality.O | >= 65 | curiosity（新しい考えに惹かれる知的好奇心） |
| personality.C | >= 65 | diligence（順序立てて着実に進める誠実さ） |
| personality.E | <= 35 | inner_focus（一人で深く考える力） |
| personality.E | >= 65 | sociability（人と関わって元気になる性質） |
| personality.A | >= 65 | empathy（相手の立場をまず理解しようとする姿勢） |
| personality.N | >= 65 | sensitivity（物事を丁寧に考え続ける感受性） |
| personality.N | <= 35 | steadiness（動じにくい落ち着き） |
| style.AGY | >= 65 | initiative（自分から方針を出す行動力） |
| style.REL | >= 65 | attunement（相手に合わせて進め方を調整する柔軟さ） |
| style.ROL | >= 65 | supportive_commitment（目立たなくても役割を支え続ける責任感） |
| style.REF | >= 65 | deliberation（動く前に状況を整理する慎重さ） |
| style.AUT | >= 65 | self_direction_style（最終的には自分で選ぶ主体性） |

VALUES：中心化値 > 0.25 の上位 3 軸まで。35〜65 の中間帯は「目立った傾向なし」として何も出さない（推測で補わない）。

## 3. 理想像の基本12問（KEEP 4／GROW 4／EXPRESS 4）

### K1［KEEP］（2つまで）　5年後も変わらずに残したい自分らしさはどれですか（2つまで）
意図：保護特性の本人選択。現在像で出た特性を先頭に並べ、ほかの特性も選べるようにする（測定結果の押しつけにしない）

  - `inner_focus` 一人で深く考える力 → 特性 inner_focus
  - `sociability` 人と関わって元気になる性質 → 特性 sociability
  - `curiosity` 新しい考えに惹かれる知的好奇心 → 特性 curiosity
  - `depth_mastery` 慣れた分野を深く掘り下げる集中力 → 特性 depth_mastery
  - `diligence` 順序立てて着実に進める誠実さ → 特性 diligence
  - `empathy` 相手の立場をまず理解しようとする姿勢 → 特性 empathy
  - `sensitivity` 物事を丁寧に考え続ける感受性 → 特性 sensitivity
  - `steadiness` 動じにくい落ち着き → 特性 steadiness
  - `deliberation` 動く前に状況を整理する慎重さ → 特性 deliberation
  - `initiative` 自分から方針を出す行動力 → 特性 initiative
  - `attunement` 相手に合わせて進め方を調整する柔軟さ → 特性 attunement
  - `supportive_commitment` 目立たなくても役割を支え続ける責任感 → 特性 supportive_commitment
  - `self_direction_style` 最終的には自分で選ぶ主体性 → 特性 self_direction_style
  - `self_expression` 自分の考えを先に言葉にする率直さ → 特性 self_expression
  - `unknown` わからない・まだ決められない

### K2［KEEP］　「あなたらしい」と言われるのは、どの場面に近いですか
意図：K1 を別の角度（場面）から確かめ、保護特性の根拠を補強する

  - `think` 深く考えたうえで意見を出したとき → 特性 inner_focus
  - `listen` 相手の話をじっくり聞いたとき → 特性 empathy
  - `steady` 物事を着実に進めたとき → 特性 diligence
  - `discover` 新しいことを見つけてきたとき → 特性 curiosity
  - `lead` 自分から方針を出したとき → 特性 initiative
  - `support` 目立たないところで支えたとき → 特性 supportive_commitment
  - `unknown` わからない・まだ決められない

### K3［KEEP］（2つまで）　判断に迷ったとき、最後まで手放したくない価値観はどれですか（2つまで）
意図：判断原則の土台になる中心価値の本人選択

  - `SD` 自分の生き方を自分で選べること → 価値観 SD
  - `ST` 新しい経験や変化 → 価値観 ST
  - `HE` 楽しさや心地よさを味わうこと → 価値観 HE
  - `AC` 能力を発揮し成果を形にすること → 価値観 AC
  - `PO` 大事な決定に影響を与えられること → 価値観 PO
  - `SE` 安心できる安定した環境 → 価値観 SE
  - `CO` 周囲に迷惑をかけないよう自分を律すること → 価値観 CO
  - `TR` 受け継がれてきた習慣や文化の尊重 → 価値観 TR
  - `BE` 身近な人が幸せに暮らせること → 価値観 BE
  - `UN` 立場にかかわらず人が公平に扱われること → 価値観 UN
  - `unknown` わからない・まだ決められない

### K4［KEEP］　こう変わってしまったら「自分ではない」と感じるのはどれですか
意図：守りたい特性を「失いたくない変化」から確かめる。反転を防ぐ制約として使う

  - `no_alone` 一人で考える時間がなくなる → 特性 inner_focus
  - `always_adjust` いつも周りに合わせて決める → 特性 self_direction_style
  - `impulsive` 勢いだけで決めるようになる → 特性 deliberation
  - `numb` 人の気持ちに鈍くなる → 特性 empathy
  - `bored` 新しいことに興味を失う → 特性 curiosity
  - `none` 特にない
  - `unknown` わからない・まだ決められない

### G1［GROW］　5年後までにいちばん伸ばしたい力はどれですか
意図：成長対象の本人選択（性格の型ではなく、行動として現れる能力）

  - `clear_expression` 必要な場面で自分の意思をはっきり伝える力 → 能力 clear_expression
  - `composure_under_pressure` 周囲に流されず判断を保つ力 → 能力 composure_under_pressure
  - `mobilizing` 人を巻き込んで物事を動かす力 → 能力 mobilizing
  - `follow_through` 決めたことを続ける力 → 能力 follow_through
  - `emotional_regulation` 気持ちが揺れても立て直す力 → 能力 emotional_regulation
  - `social_ease` 初めての相手とも落ち着いて関われる力 → 能力 social_ease
  - `unknown` わからない・まだ決められない

### G2［GROW］　いま「もう少しできたら」と感じるのは、どの場面ですか
意図：現状と理想の差を具体的な場面で確かめる。G1 と食い違えば追加質問

  - `meeting` 話し合いで意見を言いそびれる → 能力 clear_expression
  - `swayed` 人の評価で判断がぶれる → 能力 composure_under_pressure
  - `alone_stuck` 一人で抱えて進まなくなる → 能力 mobilizing
  - `stop` 始めても途中で止まる → 能力 follow_through
  - `linger` 落ち込むと長引く → 能力 emotional_regulation
  - `crowd` 初対面の場で固くなる → 能力 social_ease
  - `none` 特にない
  - `unknown` わからない・まだ決められない

### G3［GROW］　成長のしかたとして、自分に合うのはどちらですか
意図：到達可能性の手がかり（成長のペース）

  - `gradual` 少しずつ確実に積み上げる
  - `leap` ときどき大きく挑戦する
  - `unknown` わからない・まだ決められない

### G4［GROW］　伸ばしたい力について、今の性格とのかかわりはどちらに近いですか
意図：「性格はそのまま、使える場面を増やす」か「性格そのものを変えたい」かを本人に決めてもらい、勝手に反転させない

  - `augment` 性格はそのままで、使える場面を増やしたい
  - `transform` 性格そのものを変えたい
  - `unknown` わからない・まだ決められない

### E1［EXPRESS］（2つまで）　5年後のあなたは、周りからどう感じられていたいですか（2つまで）
意図：憧れる魅力の方向性（能力とは別に記録する）

  - `quiet_presence` 静かな存在感 → 魅力 quiet_presence
  - `warmth_capacity` 包容力 → 魅力 warmth_capacity
  - `intellectual_calm` 知的な落ち着き → 魅力 intellectual_calm
  - `unwavering_conviction` 揺るがない信念 → 魅力 unwavering_conviction
  - `radiance` 場を明るくする力 → 魅力 radiance
  - `dependable_drive` 頼れる実行力 → 魅力 dependable_drive
  - `unknown` わからない・まだ決められない

### E2［EXPRESS］　その魅力が表れてほしいのは、どんな場面ですか
意図：発揮する場（表現の設計情報）

  - `one_on_one` 1対1の対話
  - `small_group` 少人数の話し合い
  - `large_group` 大勢の前
  - `writing` 文章や作品
  - `action` 行動の結果
  - `unknown` わからない・まだ決められない

### E3［EXPRESS］　大事な話をしたあと、相手に残っていてほしい印象はどれですか
意図：将来の話し方を生成するための意図（口調プリセットではなく、相手に残る印象）

  - `core` 言葉は少なくても芯がある
  - `reassuring` 丁寧で安心できる
  - `clear` 明快で迷いがない
  - `passion` 思いの強さが伝わる
  - `unknown` わからない・まだ決められない

### E4［EXPRESS］　その魅力を持つ5年後のあなたは、困った場面でまず何をしますか
意図：判断原則の振る舞い面（困難時の行動）

  - `organize` 落ち着いて状況を整理し、短く方針を示す
  - `receive` まず相手の不安を受け止める
  - `explain` 自分が信じる理由を淡々と説明する
  - `move` 先頭に立って動き出す
  - `unknown` わからない・まだ決められない

## 4. 追加質問（最大 6 問・合計 18 問まで）

基本12問がすべて終わってから判定する。1段目（基本12問の回答だけで決まるもの）を上から優先して並べ、2段目（追加回答で確定した成長目標への inversion）はその後ろに足す。合計6問を超えた分は出さず、下書きで「未確定（質問上限）」として示す。保護特性との確認が上限で出せなかった場合は、その特性を保護したまま未確定にする。

| 優先 | 種類 | 出す条件 | 理由（画面に表示） |
|---|---|---|---|
| 1 | inversion | 本人の保護特性（K1・K2・K4）と、最終的に採用する成長目標・憧れ（E1）が反転のおそれのある組。成長目標は G1・G2 の回答、または追加質問（F_GROW_PRIORITY・F_GROW）の回答で確定したもの。追加回答で確定した目標への確認は「2段目」として、その回答の直後に出す（social_ease↔inner_focus、radiance↔inner_focus/deliberation） | 本人の確認なしに性格を反転させない |
| 2 | observed_mismatch | K1 で選んだ特性が、現在像の特性と逆向き（inner_focus↔sociability、steadiness↔sensitivity、curiosity↔depth_mastery） | 測定・自己申告と本人選択のどちらも勝手に正しいとしない |
| 3 | growth_mismatch | G1 と G2 が別の能力を指す | どちらを先に伸ばすかを確かめる |
| 4 | keep_unclear | K1 が「わからない」で、K1・K2・K4 から保護特性が一つも出ない | 保護特性が未確定 |
| 5 | values_unclear | K3 が「わからない」 | 判断原則の土台が未確定 |
| 6 | growth_unclear | G1・G2 のどちらからも能力が出ない | 成長対象が未確定 |
| 7 | aspiration_unclear | E1 が「わからない」 | 憧れが未確定 |
| 8 | transform_target | G4 が「性格そのものを変えたい」で、inversion が出ていない | 変えない部分を保護するため、変えたい部分を確かめる |

回答の扱い：inversion で「保ったまま」→ 保護を維持し能力に制約をつける／「手放す」→ released_traits へ（本人回答として記録）／「まだ決められない」→ 保護を維持し未確定に記録。observed_mismatch で「ふだんは観測側が近い」→ 保護特性を未確認に戻し未確定に記録。

