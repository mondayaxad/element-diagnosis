# レポート固有リンク・マイページ登録 運用手順書（complete_13）

対象：release-c-preview と Preview の Supabase（complete_01〜13 適用後）。本番では使わない（本番は別の承認・別の手順）。
この手順書は `OPERATIONS_RUNBOOK.md` の「0. 価格・権利・所有者の決め方」を置き換える（その他の節は既存の購入のために残る）。

共通の約束

- SQL は Supabase の SQL Editor で、運営者が1文ずつ実行する。ここで使う運営者の関数（`complete_admin_revoke_delivery`・`complete_admin_reissue_delivery`）は、API のロール（service_role）では実行できない。
- メールアドレス・診断コード・リンクの秘密値・Stripe の ID を、SQL のコメント・記録・チャット・チケットに書かない。対象は納品 ID（`report_deliveries.id`）で指定する。
- 先に「読み取りの確認」を実行し、結果を控えてから操作する。操作の後にもう一度「読み取りの確認」を実行する。

---

## 0. 決め方（最終統合仕様）

| 項目 | 決め方 |
| --- | --- |
| 商品 | A：解析レポート ¥1,000（`analysis`）／B：完全解析 ¥3,000（`complete` → 注文の offer は `direct_complete`）。A と B は別の商品で、互いを開けない。¥2,000 は廃止（UI・API・DB で新しく作れない。既存の行は残す） |
| 購入 | ログイン不要。購入の対象は「購入対象トークン」（暗号化した記録 ID・24時間）で決める。同じ人・同じ記録の買い直しも受け付ける（古い決済画面は新しい申込を止めない。後から払われた古い決済は別の注文として納品する） |
| 入口 | 支払い後の正本は注文ごとの固有リンク `/report-link#t=<秘密値>`（256bit・DB はハッシュだけ・期限なし）。購入完了ページ（この端末の HttpOnly Cookie）から開く |
| マイページ | 利用者がレポートの「マイページに登録する」を押した時だけ、閲覧を追加する（`account_report_registrations`）。所有者（`diagnosis_sessions.user_id`）は変えない・注文や生成物を複製しない・別のアカウントにも何度でも登録できる |
| 本人の判定に使わないもの | 購入時メール・ログインのメール・Cookie の持ち主・ログイン状態・ログイン方法・以前の購入・同じ結果の別の記録 |
| 開くたびの確認 | 支払い済み・返金・異議申し立て・運営者の停止を、開くたびにサーバーが確かめる（`report_deliveries.status` と注文の状態から決める） |
| 返金 | その注文の納品だけが止まる（A を返金しても B は読める）。端末に保存した PDF は残る |

廃止した経路（呼ばない。コードは戻しのために残す）：追加 ¥2,000・HMAC の自動引き継ぎ・Cookie での引き継ぎ・購入時メールの照合・
複数のメールの検査・購入時メールの 6 桁コードでの確認（`#recover`）・同じ結果のグループの検索・購入済みによる申込の拒否・
開いている決済による申込の拒否・`user_id` の移し替え。公開の API は `410`（`checkout_retired`・`transfer_retired`）を返す。

---

## 1. リンクを無くした（再発行）

利用者から「購入したレポートのリンクが分からない」と連絡があった時。**お支払いを Stripe で確かめてから**再発行する。

1. Stripe ダッシュボード（Preview は Test モード）で、利用者が伝えた購入日時・金額・カードの下4桁などから支払いを探す。
   支払いの metadata の `order_id` を控える（メールアドレスで探してよいが、記録には書かない）。
2. 読み取りの確認（`<order_id>` を置き換える）：

   ```sql
   select d.id as delivery_id, d.product, d.status, d.reissue_count, o.status as order_status
     from public.report_deliveries d join public.complete_orders o on o.id = d.order_id
    where d.order_id = '<order_id>';
   ```

   - 行が無い：まだ納品されていない（支払いの反映待ち）。Webhook の再送（Stripe）を待つか、購入完了ページを開いてもらう。
   - `order_status` が `refunded`・`disputed`：再発行しても読めない。返金・異議申し立ての状況を説明する。
   - `status` が `revoked`（悪用・誤購入などで停止したもの）：**再発行しない**。再発行の関数は停止も解除して有効に戻すため、停止の理由が解消した時だけ使う。
3. 手元で新しい秘密値を作る（DB・外部へは接続しない）：

   ```sh
   node scripts/report-link-reissue.js <delivery_id>
   ```

   表示された SQL を SQL Editor で実行し、結果が `reissued` であることを確かめる（`not_found` は ID の誤り）。
4. 表示されたリンクを、その利用者への返信にだけ貼る。**古いリンクは開けなくなる**（古いリンクを登録したマイページの閲覧は残る）。
   秘密値はファイル・チャット・チケットに残さない。
5. 読み取りの確認（2. と同じ）で `reissue_count` が増えていることを確かめる。

## 2. リンクの停止（誤購入・不正な共有）

```sql
select public.complete_admin_revoke_delivery('<delivery_id>', 'operator');   -- 理由：operator／mistaken_purchase／abuse
```

- 結果 `revoked`：その納品は開けなくなる（固有リンク・マイページの登録とも）。`noop`：既に停止済み。
- 停止を解く時は、1. の再発行を行う（新しい秘密値で `active` に戻る。古いリンクは開けないまま）。
- 返金を伴う時は、Stripe で返金する（Webhook が注文を `refunded` にし、納品は自動で止まる）。停止の関数は不要。

## 3. 返金・異議申し立て

- Stripe ダッシュボードで返金する。Webhook が注文を `refunded` にし、その注文の納品だけが止まる。もう一方の商品・別の注文には影響しない。
- 異議申し立て：開始で閲覧を止める（納品の状態は `suspended`）、勝訴で再び読める、敗訴では止めたまま（その注文の納品は読めない）。
- 読み取りの確認：

  ```sql
  select o.status, d.product, d.status, count(*) from public.complete_orders o
    join public.report_deliveries d on d.order_id = o.id group by 1, 2, 3 order by 1, 2, 3;
  ```

## 4. 完全解析の生成が失敗した

- 固有リンク・マイページに「もう一度作成する」が出る（自動の再試行を使い切った時。同じ注文・同じ目標で、追加の請求なし。2回まで）。
- それでも直らない時は `OPERATIONS_RUNBOOK.md` の「1. 完全解析の生成が失敗した」の運営者の作り直し（`via_link` の生成物も同じ）。

## 5. PDF

- レポートは端末の PDF として保存できる（解析レポート：ページの「PDF で保存」／完全解析：ブラウザの共有 → プリント → PDF）。PDF をメールで送る機能は無い。
- 監査の結果（Chromium・2026-10-20）：解析レポートは iPhone の canvas の上限（約1,677万ピクセル）を超えないよう倍率を抑えて生成する（約1.5秒・約1.7〜1.8MB）。
  完全解析は 46 ページ・約 11MB・約 3〜4 秒（ブラウザの印刷）。実機（iPhone Safari・Android Chrome）での確認は未実施（下の「残る制約」）。

## 6. サービス終了の手順（30日前から）

1. **30日前**：サイト・マイページ・X で告知する（終了日・販売の停止日・リンクを開ける最終日・PDF の保存のお願い）。
2. **販売の停止（告知と同時か、その後すぐ）**：環境変数 `COMPLETE_SALES_OPEN` を `false` にして再デプロイする
   （全ての入口が「準備中」になり、`op=buy` も `503 sales_closed`。既存の固有リンク・マイページの閲覧・返金の Webhook はそのまま動く）。
3. **リンクを開ける期間**：告知した最終日まで、固有リンク・マイページの閲覧を止めない。この間に PDF の保存を繰り返し案内する。
4. **最終日の後**：閲覧を止める前に、Supabase のバックアップ（`RELEASE_BACKUP_AND_ROLLBACK_RUNBOOK.md`）を取る。
   未生成・生成失敗の完全解析が残っていないこと（`complete_reports.status` が `ready` 以外の有効な納品が 0 件）を確かめ、残っていれば作成するか返金する。
5. 問い合わせ窓口（@mondayaxad）は、最終日の後も一定期間（目安 90 日）残す。

## 7. 残る制約（2026-10-20 時点）

- 実機での PDF の確認（iPhone Safari の印刷・Android Chrome）は、この環境では行えない。Chromium の端末の模倣で測った値だけ。
- 運営者の停止・再発行は、`report_deliveries` の `revoke_reason`・`reissue_count`・`reissued_at` に残る。追記だけの監査ログ（`complete_admin_audit_log`）には、
  この操作の種類がまだ無い（ログの検査の制約を変える migration が必要。必要なら次の migration で追加する）。
- 購入完了ページは、購入した端末・ブラウザ（HttpOnly Cookie・最大 20 件・365 日）でだけ一覧を出す。別の端末では、コピーしたリンクかマイページの登録から開く。
