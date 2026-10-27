#!/usr/bin/env bash
# 暗号化バックアップを復号し、使い捨てのローカル PostgreSQL 17 へ復元して基準値と比較する。
# - 本番へは一切接続しない（ローカルのUnixソケットのみ・TCP待受なし）。
# - 復号結果はファイルに書かず、パイプで pg_restore / psql へ渡す。
# - 「論理バックアップの復元確認」であり、Supabase全機能（Auth API・Storage API・Realtime等）の復旧確認ではない。
# 使い方: ./02_restore_check.sh <01_backup.sh の出力ディレクトリ>
# 必要: PostgreSQL 17（initdb/pg_ctl/postgres/psql/pg_restore）、gpg 2.x
set -Eeuo pipefail
umask 077
B=${1:?バックアップディレクトリを指定}; B=$(cd "$B" && pwd)
cd "$(dirname "$0")"; KIT=$PWD
PGBIN=${PGBIN:-}; SBIN=${PGSERVERBIN:-$PGBIN}
bin() { echo "${2:+$2/}$1"; }
for t in psql pg_restore; do "$(bin $t "$PGBIN")" --version | grep -q ' 17\.' || { echo "$t が 17 系ではありません"; exit 1; }; done
"$(bin postgres "$SBIN")" --version | grep -q ' 17\.' || { echo "postgres が 17 系ではありません（PGSERVERBIN を指定）"; exit 1; }
if command -v sha256sum >/dev/null; then SHA="sha256sum"; else SHA="shasum -a 256"; fi
# macOS キーチェーンに登録済みなら自動で読む（値は表示しない）。未登録なら従来どおり非表示入力。
kc() { command -v security >/dev/null 2>&1 && security find-generic-password -a "$USER" -s "$1" -w 2>/dev/null || true; }
[ -n "${ELEMENT_BACKUP_PASSPHRASE:-}" ] || ELEMENT_BACKUP_PASSPHRASE=$(kc element-backup-passphrase)
if [ -z "${ELEMENT_BACKUP_PASSPHRASE:-}" ]; then read -r -s -p "暗号化パスフレーズ（非表示）: " ELEMENT_BACKUP_PASSPHRASE; echo; fi
dec() { gpg --batch --quiet --pinentry-mode loopback --decrypt --passphrase-fd 3 "$B/$1.gpg" 3< <(printf '%s' "$ELEMENT_BACKUP_PASSPHRASE"); }

# 1) 暗号化ファイルの完全性と、復号後ストリームのハッシュ照合
tail -n +2 "$B/manifest.tsv" | while IFS=$'\t' read -r f size encsha plainsha _; do
  [ "$($SHA "$B/$f" | cut -c1-64)" = "$encsha" ] || { echo "NG 暗号化ファイルのSHA不一致: $f"; exit 1; }
  [ "$(dec "${f%.gpg}" | $SHA | cut -c1-64)" = "$plainsha" ] || { echo "NG 復号後SHA不一致: $f"; exit 1; }
  echo "OK 復号・SHA一致: $f ($size bytes)"
done

# 2) 使い捨てクラスタ（ソケットのみ）
W=$(mktemp -d "${TMPDIR:-/tmp}/element_restore.XXXXXX"); chmod 700 "$W"
SOCK=$W/sock; mkdir -p "$SOCK"
stop() { "$(bin pg_ctl "$SBIN")" -D "$W/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$W"; }
trap stop EXIT
LC_ALL=C LANG=C "$(bin initdb "$SBIN")" -D "$W/data" -U postgres -A trust --no-locale -E UTF8 >/dev/null
"$(bin pg_ctl "$SBIN")" -D "$W/data" -o "-c listen_addresses='' -c unix_socket_directories='$SOCK' -c port=55432" -l "$W/server.log" -w start >/dev/null
export PGHOST=$SOCK PGPORT=55432 PGUSER=postgres; unset PGDATABASE PGOPTIONS
q() { "$(bin psql "$PGBIN")" -X -q -d postgres "$@"; }

# 3) ロールと拡張の下地（ロールダンプはパスワードなし。Supabase固有設定のエラーは記録して続行）
dec roles | q -v ON_ERROR_STOP=0 > "$W/roles.out" 2> "$B/restore_roles_errors.log" || true
for r in anon authenticated service_role authenticator supabase_auth_admin supabase_storage_admin supabase_admin dashboard_user; do
  q -c "do \$\$begin if not exists (select from pg_roles where rolname='$r') then create role $r nologin; end if; end\$\$;"
done
q -c "create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists \"uuid-ossp\" with schema extensions;"

# 4) 復元（構造＋データ）。エラーはログに残し、件数を報告
set +e
dec core_full | LC_ALL=C LC_MESSAGES=C "$(bin pg_restore "$PGBIN")" -d postgres --no-comments 2> "$B/restore_errors.log"
RC=$?; set -e
NERR=$(grep -c '^pg_restore: error' "$B/restore_errors.log" || true)
echo "pg_restore 終了コード=$RC エラー件数=${NERR}（詳細: restore_errors.log。個人情報は含まない想定だが外部共有しない）"

# 5) 比較（サーバー固有でない行のみ）
q -v ON_ERROR_STOP=1 -f "$KIT/fingerprint.sql" > "$B/baseline_restored.tsv"
if diff <(sort "$B/baseline_before.tsv") <(sort "$B/baseline_restored.tsv") > "$B/compare.diff"; then
  echo "比較: 本番取得前の基準値と復元先が完全一致"
else
  echo "比較: 差分あり（compare.diff）"; cat "$B/compare.diff"
fi
unset ELEMENT_BACKUP_PASSPHRASE
