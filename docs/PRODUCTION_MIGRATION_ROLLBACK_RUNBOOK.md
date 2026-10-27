# 本番DB migration ロールバック手順書（prod_91〜95・DRAFT_DO_NOT_RUN）

> **草案。本番では実行しない。** 障害時に、運営者の承認を得てから使う。
> 戻す前に必ず読み取り確認（prod_81・prod_80）で状態を確かめ、可能なら「戻さずに直す（forward fix）」を先に検討する。

## 1. 使える条件

| ファイル | 戻す段階 | 使える条件（満たさなければ冒頭で止まり、何も変えない） |
|---|---|---|
| `prod_95_rollback_04b_DRAFT_DO_NOT_RUN.sql` | prod_04b | 台帳の最新が 5。データは変えない（保存を拒否するトリガーを外すだけ）。戻すと 04a の状態（required でも保存できる） |
| `prod_94_rollback_04a_DRAFT_DO_NOT_RUN.sql` | prod_04a | 台帳の最新が 4（04b を先に戻してある）。04a の後に作られた profile が 0 人（required・completed が 0 人、かつ 04a の時刻以降の作成が 0 人） |
| `prod_93_rollback_03_DRAFT_DO_NOT_RUN.sql` | prod_03 | 台帳の最新が 3。新しい注文・レポート・リンク・登録・ゲスト記録が 0 件 |
| `prod_92_rollback_02_DRAFT_DO_NOT_RUN.sql` | prod_02 | 台帳の最新が 2。同上 |
| `prod_91_rollback_01_DRAFT_DO_NOT_RUN.sql` | prod_01 | 台帳の最新が 1。登録完了・同意・お知らせメール同期の記録が 0 件 |

- 必ず **後の段階から順に**（95 → 94 → 93 → 92 → 91）。順序が違えば止まる。
- 04b だけを戻すのは安全（データを変えない）。04b に問題がある時は、まず 95 で 04a の状態へ戻し、サービスを続けながら直す。
- 04a の後に登録した人がいれば 94 は止まる。その人たちの状態（required・completed と同意の記録）は変えない。
- 新しい購入・登録のデータが1件でもあれば止まる。その場合は戻さず、原因を直す（forward fix）。
  データを消して戻すことはしない。
- 既存6表の既存列・既存行・旧購入（`purchase_entitlements` の9行と、prod_01 の後に旧 main が記録した Live の購入）には触れない。
- 台帳（`element_release.migration_ledger`）は、戻す段階の行だけを消す。prod_91 は最後に空の台帳と専用スキーマを外す。

## 2. 手順（SQL Editor・本番。承認後）

1. `prod_81_postcheck_READONLY.sql` で `ledger.stages` と `new_tables.rows`・`profiles.by_status` を確かめる。
2. `prod_80_invariants_READONLY.sql` を控える。
3. 最新の段階の rollback ファイルを、ファイル全体で1回実行する。
4. `prod_80` が手順 2 と完全一致（`info.` の行を除く）、`prod_81` の `ledger.stages` が1つ減ったことを確かめる。
5. 必要な段階まで 3〜4 を繰り返す。

戻した後：
- 旧 main（現在の Production のコード）の購入（旧 Payment Link → /api/verify）・旧レポート閲覧・保存は動く。
- 新コード（Release C）を Production に出している場合は、先にコードを旧 main へ戻す（Vercel の Rollback・別承認）。
  新コードは prod_01〜04 の表・関数を前提にしている。

## 3. 戻せない場合（最後の手段）

- 新しいデータがあり、戻すと失われる場合は rollback しない。障害の範囲を限定し（販売の停止＝`COMPLETE_SALES_OPEN` を閉じる、など・別承認）、forward fix する。
- DB 全体の復元（バックアップからの復元）は、本番へ直接戻さない。まず使い捨ての環境で復元・比較（`operator_backup_kit/02_restore_check.sh`）し、別途の承認と手順書で扱う。

## 4. 検証の記録（2026-10-21・ローカル）

- 合成データの本番相当 PG17 で、全段階の適用 → rollback（95→91）→ 構造が適用前と完全一致（pg_dump の schema 比較）→ 再適用が初回と一致。
- 04b だけを戻すと構造は 04a の時点と一致し、required の人も保存できる。04a の後に登録した人がいる時、94 は止まり、登録・同意の記録を変えない。
- 各 rollback の後、`prod_80` の不変項目が適用前と一致。
- 順序違い（5 が最新の時に 91）は止まる。新しいデータがある時は止まる。
- 段階の間に旧 main で Live の購入が入った状態からも、全段階を戻せ、購入の行は残る。
- 運営者のキット（`03_migration_check.sh`）で、バックアップを復元した DB でも同じ一連を確認できる（合成データのバックアップで 35/35 合格）。
