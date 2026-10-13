# 解析レポート・完全解析 運用手順書（Preview）

対象：release-c-preview と Preview の Supabase（complete_01〜08 適用後）。本番では使わない（本番は別の承認・別の手順）。

共通の約束

- SQL は Supabase の SQL Editor で、運営者が1文ずつ実行する。API のロール（service_role）には、ここで使う運営者の関数を実行する権限が無い。
- 照合 ID（incident_id）は 12 桁の 16 進数（例：`openssl rand -hex 6`）。同じ照合 ID で再実行すると、前回の結果を返すだけで二重には動かない。
- メールアドレス・診断コード・Stripe の秘密値を SQL・記録・チャットに書かない。対象は記録 ID・生成物 ID・Checkout Session ID だけで指定する。
- 先に「読み取りの確認」を実行し、結果を控えてから操作する。操作の後にもう一度「読み取りの確認」を実行する。

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
  - 返金した ¥1,000 を改めて受け取る手段は無いため、閲覧を戻したい場合は開発者へ（権利の手動の付与は行わない）。
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

- 停止（suspend）：閲覧・¥2,000 の根拠・マイページの権利から外す。復帰できる。
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
- その旧購入を根拠にした ¥2,000 の完全解析は、停止中は閲覧できない（`basis_inactive`）。¥2,000 の扱いは §2 と同じ。
- 記録：`select action, result_status, reason_code, incident_id, created_at from public.legacy_access_events order by created_at desc limit 20;`（追記だけ・書き換え不可）

---

## 4. 変えてはいけない設定

- `REPORT_TOKEN_SECRET`・`COMPLETE_VIEW_TOKEN_SECRET` を販売中に変えない（発行済みの閲覧リンク、ゲスト購入の参照値（ref）・購入完了ページの表示が無効になる）。変える時は販売を止め、利用者への案内を用意してから。
