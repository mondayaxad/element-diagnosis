# 解析レポート・完全解析 運用手順書（Preview）

対象：release-c-preview と Preview の Supabase（complete_01〜11 適用後）。本番では使わない（本番は別の承認・別の手順）。

共通の約束

- SQL は Supabase の SQL Editor で、運営者が1文ずつ実行する。API のロール（service_role）には、ここで使う運営者の関数を実行する権限が無い。
- 照合 ID（incident_id）は 12 桁の 16 進数（例：`openssl rand -hex 6`）。同じ照合 ID で再実行すると、前回の結果を返すだけで二重には動かない。
- メールアドレス・診断コード・Stripe の秘密値を SQL・記録・チャットに書かない。対象は記録 ID・生成物 ID・Checkout Session ID だけで指定する。
- 先に「読み取りの確認」を実行し、結果を控えてから操作する。操作の後にもう一度「読み取りの確認」を実行する。

---

## 0. 価格・権利・所有者の決め方（complete_10・2026-10-14）

価格はマイページの有無で変えない。サーバーが記録の権利だけで決める（ブラウザの金額・価格・割引・入口・参照元は使わない）。

| この記録の状態 | 売るもの | 付く権利 |
| --- | --- | --- |
| 未購入 | ¥1,000（解析レポート）・¥3,000（解析＋完全解析） | ¥1,000：解析／¥3,000：解析＋完全解析（同じ記録） |
| 新 Checkout の解析レポートを購入済み（ゲストもログイン中も） | 追加 ¥2,000 だけ | 完全解析（同じ記録） |
| 完全解析を購入済み | 売らない（読む・見るだけ） | — |
| 旧 Payment Link の購入だけ（本人に結び付け済み） | 売らない（解析レポートを読むだけ。「旧バージョンのため、完全解析はお申し込みいただけません」） | — |

- 所有者：診断コード・`encoded_answers`・`result_key`・そのハッシュは所有の根拠にしない（同じ回答の別人がいる）。
  - ログイン中：同じ `user_id`・同じ `result_key` の記録だけを1つの結果グループにする（別の本人の購入・権利・旧購入は数えない）。
  - ゲスト：グループは無い。この端末の Cookie（注文 ID と秘密値。DB はハッシュだけ）で確かめた記録の権利（`record_entitlements`・支払済みの注文）だけ。
  - 引き継ぎ：Cookie、または購入時メール＋確認済みメール（OTP）の時だけ。記録は複製せず、その記録を本人へ移す。
- 旧 Payment Link（`purchase_entitlements`）：既存の閲覧（署名付きの旧リンク）と、本人に結び付け済み（`complete_legacy_bindings`）の記録の閲覧だけに使う。新 Checkout の購入済みの判定・再購入の禁止・¥2,000 の根拠・¥3,000 の禁止には使わない（DB の注文の作成も旧購入を見ない）。
- 返金：¥1,000 → 解析 revoked／¥2,000 → 完全解析だけ revoked／¥3,000 → 両方 revoked。返金した物は購入済みに数えないため、
  ゲスト・ログイン中とも同じ記録（ゲストは新しい記録のこともある）でもう一度買える（complete_11）。異議申し立てで負けた注文は、その記録では売らない。
- 二重の購入になる支払い（期限切れの注文への遅れた支払い・引き継ぎで同じ結果の購入が入った後の支払い・¥1,000 を持つ記録への ¥3,000・
  根拠の解析権が無い ¥2,000）は権利を付けず、`stripe_webhook_events.error_code` が `live_order_conflict`／`basis_inactive` になる。
  運営者が Stripe で返金し、利用者に連絡する。
  - 読み取りの確認：`select error_code, count(*) from public.stripe_webhook_events where error_code in ('live_order_conflict', 'basis_inactive') group by 1;`
  - 反映しなかった支払いの注文は `failed`（`failure_code` が同じ理由）になり、その記録の次の申込・引き継ぎを止めない。
- 返金・取消で完全解析を持たなくなった記録は、支払いで固定した MENTOR 目標の固定を外して選び直せる（`complete_release_mentor_goal_lock`）。
- 引き継ぎ：この端末の購入の秘密値＋ログイン中の確認済みメールが、その記録の支払いのどれかの購入時メールと一致する時、または購入時メールの OTP。
  マイページを開くと自動で引き継ぐ。ログイン中に結果ページから買う時は、決済画面のメールにアカウントの確認済みメールが入る。

---

## 1. 完全解析の生成が失敗した（C6）

### 利用者に見えるもの

- 自動の再試行（最大 5 回）の途中：「作成をやり直しています」（購入完了ページ）／「もう一度確認する」（マイページ）。
- 自動の再試行を使い切った：「完全解析を作成できませんでした」と「もう一度作成する」。押すと、同じ支払済みの注文・同じ MENTOR 目標・同じ生成物の行で作り直す（新しい注文・権利・請求は作らない）。本人の作り直しは 1 つの生成物につき 2 回まで。
- 2 回を使い切った、または作り直しても直らない失敗（`materials_changed`・`input_mismatch`・`frozen_versions_mismatch`・`frozen_goal_mismatch`・`record_data_missing`・`report_not_found`）：「お手数ですが @mondayaxad までご連絡ください（追加のお支払いは不要です）」。

### 読み取りの確認

```sql
select id, status, attempts, max_attempts, manual_retries, last_error_code, next_retry_at, failed_at, created_at
  from public.complete_reports
 where diagnosis_session_id = '<記録ID>'
 order by created_at desc;
```

### 運営者の作り直し（原因を直した後）

1. `last_error_code` から原因を確かめる。`materials_changed` は公開物の素材と注文時の素材の版が違う（配備の取り違え）。配備を戻すか、開発者へ。`input_mismatch`・`frozen_*` は保存値の不一致。開発者へ（作り直しても同じ失敗になる）。
2. 原因を直したら、次を実行する（上限・失敗の種類に関係なく queued に戻す。最終の失敗でなければ `noop`）。

```sql
select public.complete_admin_regenerate_report('<生成物ID>', '<照合ID>');
```

3. 利用者がマイページか購入完了ページを開くと、生成が始まる（状態の確認の時に、待っている生成を応答の後で始める）。
4. 記録：`select report_id, action, result, incident_id, created_at from public.complete_report_admin_events order by created_at desc limit 20;`

---

## 2. 返金・dispute（D5）

返金・dispute は Stripe の Webhook で自動的に反映する。閲覧は毎回 DB で確かめるため、発行済みのリンク（15 分の解析レポート・300 秒の完全解析）も、反映の直後から開けない。

| 返金した決済 | 解析権 | 完全解析権 | 閲覧 |
| --- | --- | --- | --- |
| ¥1,000（解析レポート） | revoked | ― | 解析レポートは読めない |
| ¥2,000（完全解析・解析レポート購入者向け） | 変わらない | revoked | 解析レポートは読める・完全解析は読めない |
| ¥3,000（完全解析セット） | revoked | revoked | どちらも読めない |
| dispute 開始 | suspended | suspended | どちらも読めない（勝訴で戻る・敗訴で revoked） |

### ¥2,000 の後に ¥1,000 だけを返金した場合

- ¥2,000 の完全解析の権利は残るが、根拠（解析レポートの購入）が無いため閲覧を止める（`basis_inactive`）。マイページ・購入完了ページは「解析レポートの購入が取り消されたため、完全解析をご覧いただけません。お問い合わせください。」と表示する。
- 運営者が次のどちらかを選ぶ：
  - ¥2,000 も返金する（Stripe で返金 → Webhook で完全解析権 revoked）。
  - 利用者が解析レポート（¥1,000）をもう一度購入すると、完全解析も読めるようになる（complete_11。マイページは「解析レポート ¥1,000（完全解析を読むために必要です）」を出す）。
- 一部だけの返金は記録だけ（権利は変わらない）。全額の返金で権利を止める。

### 読み取りの確認

```sql
select o.offer, o.amount, o.status, o.created_at, e.right_type, e.status as right_status
  from public.complete_orders o
  left join public.record_entitlements e on e.source_order_id = o.id
 where o.diagnosis_session_id = '<記録ID>'
 order by o.created_at;
```

---

## 3. 旧 ¥1,000（Payment Link の購入）の停止・取消・復帰（D5・D6）

旧購入は Stripe の Webhook の対象外のため、返金・不正の時は運営者が止める。既存の購入者は、止めない限り今までどおり読める（一括では失効させない）。
旧購入は解析レポートの閲覧だけに使う（署名付きの旧リンク・本人に結び付け済みの記録）。診断コードのハッシュが一致するだけでは、マイページで本人の購入として扱わない（complete_10）。
新 Checkout の判断（購入済み・再購入の禁止・¥2,000 の根拠・¥3,000 の禁止）には使わない。本人に結び付け済みの旧購入の記録には、画面で完全解析の申込を出さない。

- 停止（suspend）：閲覧・マイページの権利から外す。復帰できる。
- 取消（revoke）：停止と同じ。最終（復帰できない）。
- 復帰（restore）：停止を戻す。
- 理由コード：`refund`・`chargeback`・`fraud`・`customer_request`・`operator_error`。

### 読み取りの確認（旧購入の Checkout Session ID で）

```sql
select pe.product_type, pe.amount, pe.status, pe.created_at,
       coalesce(k.status, 'none') as block_status, k.reason_code, k.updated_at
  from public.purchase_entitlements pe
  left join public.legacy_access_blocks k on k.diagnosis_code_hash = pe.diagnosis_code_hash
 where pe.stripe_checkout_session_id = '<旧購入の cs_...>';
```

### 操作

```sql
-- 停止（返金した旧購入）
select public.complete_admin_legacy_access(null, '<旧購入の cs_...>', 'suspend', 'refund', '<照合ID>');
-- 復帰（誤って止めた）
select public.complete_admin_legacy_access(null, '<旧購入の cs_...>', 'restore', 'operator_error', '<照合ID>');
-- 取消（最終）
select public.complete_admin_legacy_access(null, '<旧購入の cs_...>', 'revoke', 'chargeback', '<照合ID>');
```

- 同じ診断結果の旧購入は、診断コードのハッシュ単位でまとめて止まる。
- 記録：`select action, result_status, reason_code, incident_id, created_at from public.legacy_access_events order by created_at desc limit 20;`（追記だけ・書き換え不可）

---

### 旧 Payment Link の廃止

- 販売は新しい Checkout だけ。`/api/verify`（旧 Payment Link の戻り先）は新しい購入権を作らない。記録済みの購入にだけ閲覧リンクを出し直し、記録の無い支払いは「販売終了・お問い合わせ」（410）を表示する。
- Stripe の Payment Link（本番用・テスト用）を無効にする：Stripe Dashboard → Payment Links → 各リンク →「無効にする」。
  - テスト用（Preview）：いつでもよい。
  - 本番用：本番の main が結果ページで旧 Payment Link を使っている間は無効にしない（本番の購入ボタンが壊れる）。本番の販売を止める時、または release-c を本番に出す時に無効にする。
- 無効にした後に旧リンクで支払われた場合（無効にする直前に開いていた画面など）：`/api/verify` は 410。Stripe で返金し、利用者に連絡する。

---

## 4. Price ID（STRIPE_PRICE_ANALYSIS・STRIPE_COMPLETE_PRICE_DIRECT・STRIPE_COMPLETE_PRICE_UPGRADE）を変える時（C8）

- 支払いの反映は、注文の行（Checkout を作った時点の offer・金額・通貨・Stripe のモード）を正本にして照合する。環境変数の Price ID は照合に使わないため、決済の途中で Price ID を変えても、正しく支払われた注文は反映される。
- それでも、決済の途中では変えない（決済画面を開いている人がいない時間に変える）。手順：
  1. 販売を止める（`COMPLETE_SALES_OPEN=false`）→ 再デプロイ。
  2. 決済待ちの注文が無いことを確かめる：`select count(*) from public.complete_orders where status in ('created', 'checkout_open');`（0 になるまで待つ。Checkout の期限は 24 時間）
  3. 新しい Price（同じ金額・JPY・一回払い）を作り、環境変数を差し替える → 再デプロイ。
  4. 販売を再開する。
- 金額・通貨・数量・一回払いのどれかが注文と違う支払いは、注文を `failed`（`amount_mismatch`）にして権利を付けない。Stripe で返金し、利用者に連絡する。

## 5. 診断結果の固有リンク（/result#r=…）の保存期間と整理

- 診断を完了すると、無料の診断結果をゲストの診断記録として保存し、固有リンクを1つ発行する（再診断ごとに別のリンク）。DB には秘密値の SHA-256 だけを保存する。
- 保存期間：最後に開いた日から 180 日（開くたびに延長）。期限を過ぎたリンクは開けない（「この診断結果は開けません」）。
- 大量作成の防止：秘密値はブラウザが作り、同じ秘密値の再送は同じリンクを返す（記録・リンクを増やさない）。接続元ごと（IP アドレスを `COMPLETE_VIEW_TOKEN_SECRET` から作った鍵で HMAC-SHA256 にした値。IP アドレスそのものは保存しない）に、10 分で 10 件・24 時間で 100 件を超えると作らない（API は 429。利用者には何も表示せず、結果の表示と購入はそのまま）。回数の行（`result_link_rate`）は 24 時間を過ぎたものから、作成の時と整理の時に消す。
- 固有リンクは無料の診断結果を開くだけ。解析レポート・完全解析の閲覧は、従来どおり毎回 DB で権利を確かめる（返金・停止はそのまま効く）。
- 削除の依頼（「この診断結果を消してほしい」）：利用者からリンクを受け取らない（秘密値をチャット・メールに書かせない）。購入があれば購入の記録 ID から、無ければ期限切れの整理で消える旨を案内する。

### 読み取りの確認

```sql
select count(*) as links,
       count(*) filter (where expires_at > now()) as active,
       count(*) filter (where expires_at <= now()) as expired
  from public.result_resume_links;
-- 作成の回数（上限に当たっている接続元の数。接続元は鍵付きハッシュなので、誰かは分からない）
select count(*) filter (where n10 >= 10) as limited_10min, count(*) filter (where n24 >= 100) as limited_24h
  from (select rate_key, sum(n) filter (where bucket >= now() - interval '10 minutes') as n10, sum(n) as n24
          from public.result_link_rate where bucket >= now() - interval '24 hours' group by rate_key) t;
```

### 整理（月に1回程度。自動では動かない）

期限切れのリンクと 24 時間を過ぎた作成の回数の行を消し、180 日より前に作られた、リンク・注文・権利・生成物・旧購入の結び付けの無いゲストの診断記録を消す。購入のある記録は消さない。

```sql
select * from public.complete_purge_result_links();
```

- 戻り値：消したリンクの数・消した記録の数。操作の前後に「読み取りの確認」を実行して控える。
- 戻し（complete_09 を外す）：`docs/sql/complete_97_rollback_09_DRAFT_DO_NOT_RUN.sql`（発行済みのリンクはすべて開けなくなる。作った診断記録は残る。登録完了で受け付けるプライバシーポリシーの版も 2026-10-07 に戻るため、アプリを先に戻す）。

## 6. 変えてはいけない設定

- `REPORT_TOKEN_SECRET`・`COMPLETE_VIEW_TOKEN_SECRET` を販売中に変えない（発行済みの閲覧リンク、ゲスト購入の参照値（ref）・購入完了ページの表示が無効になる。`COMPLETE_VIEW_TOKEN_SECRET` を変えると、固有リンクの作成の回数も数え直しになる）。変える時は販売を止め、利用者への案内を用意してから。
