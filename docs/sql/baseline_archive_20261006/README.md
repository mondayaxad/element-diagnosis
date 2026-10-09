# 復元用 baseline archive（2026-10-06 取得）

> **これは実行用の migration ではありません。**
> - Supabase の migration として適用しない。
> - `supabase db push` や SQL Editor で、そのまま流さない。
> - 用途は、障害時の schema 復元と、復元試験の再現だけです。

## 何か

- complete 系 migration（`docs/sql/2026100…_complete_0X_*.sql`）より前にある、基本の表・関数・RLS・grants の定義です。
  - 対象：profiles、diagnosis_sessions／results／answers、purchase_entitlements、report_snapshots など。
- 2026-10-06 に、本番候補プロジェクトのカタログを読み取り専用で取得して作りました。
- Preview（qelqehkigydgrwedbgtr）は、この 0001〜0008 を適用して作っています。
  - 適用時の migration 履歴の版：`20261006115637`〜`20261006120045`。
- 行データ・キー・パスワード・実行先の Project Ref は含みません（Ref は伏せ字）。
- 中身は取得時のまま、1バイトも変えていません。確認は `SHA256SUMS` で行います。

| ファイル | 内容 | 注意 |
|---|---|---|
| 0001_extensions_and_types.sql | 拡張と型 | |
| 0002_tables.sql | 表 | |
| 0003_constraints_and_indexes.sql | 制約と索引 | |
| 0004_functions_and_rpc.sql | 関数・RPC | |
| 0005_auth_trigger.sql | auth.users の作成時トリガー | |
| 0006_rls_and_policies.sql | RLS とポリシー | |
| 0007_grants_production_parity.sql | 本番と同じ権限の再現 | 推奨設定ではない。本番へ再適用しない |
| 0008_preview_only_settings.sql | Preview 専用の設定 | **Production の復元には使わない** |
| restore_tools/00_supabase_stub.sql | ローカルの PostgreSQL に、Supabase の最小限のロール・auth スキーマを作るスタブ | 復元試験用。Supabase 上では実行しない |

## 使い方（復元試験）

詳しくは `docs/RELEASE_BACKUP_AND_ROLLBACK_RUNBOOK.md` §3-3 を参照してください。

1. 使い捨ての PostgreSQL 17 を用意し、次の順に適用する。
   - `restore_tools/00_supabase_stub.sql`
   - 0001〜0007（Preview を再現する場合は 0008 も）
   - `docs/sql/20261006225744_onboarding_01_…`
   - complete_01〜06
2. データを入れる。
3. 復元元と復元先の両方で `docs/sql/release_fingerprint_READONLY.sql` を実行し、全項目が一致することを確かめる。

2026-10-09 の予行では、Preview と復元先で25項目すべてが一致しました。

## 改ざん・取り違えの確認

```
cd docs/sql/baseline_archive_20261006 && sha256sum -c SHA256SUMS
```
