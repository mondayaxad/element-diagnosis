# 邪眼解析レポート（¥1,000）の購入：Preview での有効化と確認

対象は **Preview（element-diagnosis-preview・release-c-preview）だけ**。本番の販売は別に判断する。

## 1. DB（SQL Editor・実行順）
| 順 | ファイル | 内容 |
|---|---|---|
| 1 | `docs/sql/jagan_02_00_preflight_READONLY.sql` | 適用前の確認（全行 ok=true であること） |
| 2 | `docs/sql/20261107120000_jagan_02_orders_links_registrations.sql` | 注文・固有リンク・登録・権利（既存の表・関数・履歴があれば何も変えずに止まる） |
| 3 | `docs/sql/jagan_02_99_postcheck_READONLY.sql` | 適用後の確認（全行 ok=true であること） |

- jagan_01 が適用済みであることが前提（2026-11-06 適用済み）。
- 変更する既存の表は `jagan_entitlements` だけ（列 `order_id` を足す）。ETI の表は読まない・書き換えない。
- 使い捨て PostgreSQL での検証：`tests/pg/jagan_02.pg.test.js`（手順・支払い・返金・異議申し立て・登録・権限）。

## 2. 環境変数（Vercel・Preview・release-c-preview）
| 名前 | 値 | 状態 |
|---|---|---|
| `JAGAN_SALES_OPEN` | `true` | **追加が必要**（DB の適用の後） |
| `STRIPE_SECRET_KEY`・`STRIPE_MODE`・`STRIPE_COMPLETE_WEBHOOK_SECRET` | 既存（Stripe Test） | そのまま |
| `COMPLETE_CHECKOUT_ORIGIN` | 既存（Preview の固定 URL） | そのまま（決済の戻り先） |
| `COMPLETE_VIEW_TOKEN_SECRET` | 既存 | そのまま（固有リンクの秘密値は、ここから用途別の鍵を作る） |
| `JAGAN_PRICE_ID` | なし | 任意。無ければ決済画面に ¥1,000 を直接指定（Stripe の商品カタログは作らない）。ETI の Price は使わない |

- Stripe の Webhook は、既存の ETI のエンドポイント（`/api/stripe-webhook`）のまま。邪眼の注文は `metadata.app=element-diagnosis-jagan` で見分ける。
  Webhook が届かなくても、固有リンクを開く・登録する時に Stripe へ確かめて反映する。

## 3. 確認（Stripe のテストカード 4242 4242 4242 4242）
1. ログインなし：`/jagan/` で診断 → 結果の「全てのロックを解除する」→ 決済 → 戻った固有リンク（`/jagan/report#t=…`）でレポートが開く。
2. 最下部「マイページに登録する」→ ログイン（または新規登録）→ マイページの最新・記録章・これまでに邪眼の記録（INSIGHT・覚醒の証）。
3. ログインして保存した記録：マイページの「邪眼解析レポート ¥1,000」→ 決済 → 戻るとマイページに自動で登録（INSIGHT）。
4. 右上の「アップグレード」から、邪眼の記録を選んで申込・閲覧できる。
5. Stripe のダッシュボードで返金 → マイページは覚醒前・申込に戻り、固有リンクは「ご覧いただけません」。
