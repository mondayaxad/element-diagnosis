# 元素診断 本番DB バックアップ・復元確認キット（運営者の手元PC用）

このキットに秘密値は含まれていません。接続文字列とパスフレーズは、実行時に端末から非表示で入力します。

| ファイル | 役割 |
|---|---|
| `00_keychain_setup.sh` | （任意）接続URI・DBパスワード・暗号化パスフレーズを macOS キーチェーンへ登録（以後の入力を省く） |
| `01_backup.sh` | 本番DBを読み取り専用で接続 → 接続先確認 → 基準値取得 → 暗号化バックアップ → manifest |
| `02_restore_check.sh` | 復号・SHA照合 → 使い捨てのローカルPostgreSQL 17へ復元 → 基準値と比較 |
| `03_migration_check.sh` | 復元した使い捨てDBへ本番 migration（prod_01〜03・04a・04b）を当て、適用・二度適用・rollback・再適用・不変項目を確認（本番には接続しない） |
| `fingerprint.sql` | 本番と復元先で同じ基準値（件数・構造の指紋・購入の集計指紋）を出すSQL。読み取り専用で、個人情報は出しません |

## 0. 準備（macOS / Homebrew の例）

```bash
brew install postgresql@17 gnupg
export PGBIN=/opt/homebrew/opt/postgresql@17/bin      # Intel Mac は /usr/local/opt/postgresql@17/bin
export PGSERVERBIN=$PGBIN
"$PGBIN/pg_dump" --version                            # 17.x であること
```

キットのフォルダは、iCloudやDropboxなど同期されるフォルダの外に置いてください。

## 1. バックアップ

```bash
cd <キットのフォルダ>
./01_backup.sh
```

- 「Session pooler 接続URI」を聞かれます。Supabaseダッシュボード → Connect → Session pooler（ポート5432）のURIに、DBパスワードを入れたものを貼り付けます（画面には表示されません）。
- 「暗号化パスフレーズ」を2回聞かれます。20文字以上にしてください。パスワード管理ツールに控えておかないと、後で復号できなくなります。
- 次のどれかに当てはまると、何も取得せずに止まります。
  - 接続先が Session pooler（ポート5432）ではない
  - PostgreSQL 17 ではない
  - 読み取り専用になっていない
  - public の表が6表でない
  - 2026-10-06 00:00Z より前の `purchase_entitlements` が9行でない、または以降の行に live・active・core1・1,000円以外がある
- 出力先は `~/element_db_backups/<UTC日時>/` です。フォルダとファイルは所有者だけが読める権限で作られます。

出力されるもの：

| ファイル | 中身 |
|---|---|
| `roles.gpg` | ロール（パスワードは含めない） |
| `schema_all.gpg` | 全スキーマの構造。Supabase管理スキーマも含む参照用 |
| `core_full.gpg` | public・auth・storage の構造＋データ。復元試験の主対象 |
| `core_data.gpg` | 同じ3スキーマのデータのみ |
| `baseline_before.tsv` / `baseline_after.tsv` | 取得前後の基準値（件数とハッシュのみ） |
| `manifest.tsv` | 各ファイルのサイズ、暗号化後SHA-256、暗号化前ストリームのSHA-256、作成日時 |
| `tools.txt` | 使ったツールの版と暗号方式 |

`pg_dump` の出力は平文ファイルにせず、そのまま gpg（OpenPGP共通鍵方式、AES256、S2K SHA512）で暗号化します。

## 2. 復元確認

```bash
./02_restore_check.sh ~/element_db_backups/<UTC日時>
```

1. 各 `.gpg` について、manifest の暗号化後SHA-256と、復号したストリームのSHA-256を照合します。
2. 一時フォルダに使い捨てのPostgreSQL 17を立ち上げます。TCPでは待ち受けず、Unixソケットだけを使います。本番には接続しません。
3. ロールと拡張機能（pgcrypto、uuid-ossp）の下地を作り、`core_full` を復元します。復号したデータはファイルに書かず、パイプで直接渡します。
4. `fingerprint.sql` の結果を `baseline_before.tsv` と比べ、`compare.diff` に書き出します。
5. 終了時に一時クラスタを削除します。

想定どおりの警告：
- `schema "public" already exists` が1件
- ロールの復元時に、Supabase固有の設定に関するエラーが出る場合がある（`restore_roles_errors.log` に記録）

**合格の目安：** 「復号・SHA一致」がすべて OK で、「比較: 完全一致」と表示されること。

## 2-2. 本番 migration の試験（バックアップを復元したDBで）

```bash
./03_migration_check.sh ~/element_db_backups/<UTC日時> <リポジトリ>/docs/sql/production
```

- 最初に migration ファイルの SHA-256 を表示する（`docs/sql/production/SHA256SUMS` と一致すること）。
- `PASS preflight（実データで基準値と一致）`：SQL に入っている基準値（購入の集計指紋など）が実データと一致。
- 合格の目安：`TOTAL pass=35 fail=0`。出力は PASS／FAIL と件数・ハッシュだけ（個人情報なし）。

## 3. 評価の範囲

- この手順で確かめられるのは**論理バックアップの復元**（構造・データ・関数・RLS・policy・トリガー・権限）です。
- Supabaseの全機能（Auth API、Storage API、Realtime、Supabaseが管理する拡張機能）がそのまま復旧することは確かめていません。その確認は、Supabase公式のCLIとDockerを使うローカル環境か、承認済みの一時プロジェクトで別途行います。
- 復元先は外部につながらない使い捨ての環境なので、メールやWebhookは送信されません。pg_net などは復元対象のスキーマに入っていません。

## 4. 保管と削除

- 暗号化済みの `.gpg` と manifest は、オフラインの暗号化された外部メディアなど、2か所に保管します。
- パスフレーズはバックアップとは別の場所（パスワード管理ツール）に保管します。
- 次のような場所には置かないでください：Git、リポジトリ、Vercel、公開ストレージ、チャット。
- 不要になったら、`.gpg` を削除したうえで、そのメディアの安全な消去機能を使います。保管期間は運営方針で決めてください（未決定）。

## 5. Claudeへの報告に貼ってよいもの

- `manifest.tsv`
- `tools.txt`
- 2つのスクリプトの最終出力（OK／NG と件数）
- `compare.diff` の有無

`.gpg`、パスフレーズ、接続URI、`restore_*errors.log` の中身は貼らないでください。
