#!/usr/bin/env bash
# 本番専用 migration（prod_01〜04）を「実際のバックアップを復元した使い捨ての PG17」に当てて確かめる。
#   本番には接続しない（ローカルのUnixソケットのみ）。復号結果はファイルに書かない。
#   出力は PASS／FAIL と件数・ハッシュだけ（個人情報・ID は出さない）。
# 使い方: ./03_migration_check.sh <バックアップのフォルダ> <リポジトリの docs/sql/production フォルダ>
set -Eeuo pipefail
umask 077
B=${1:?バックアップのフォルダ}; B=$(cd "$B" && pwd)
M=${2:?docs/sql/production のフォルダ}; M=$(cd "$M" && pwd)
cd "$(dirname "$0")"; KIT=$PWD
PGBIN=${PGBIN:-}; SBIN=${PGSERVERBIN:-$PGBIN}
bin() { echo "${2:+$2/}$1"; }
for t in psql pg_restore pg_dump; do "$(bin $t "$PGBIN")" --version | grep -q ' 17\.' || { echo "$t が 17 系ではありません"; exit 1; }; done
if command -v sha256sum >/dev/null; then SHA="sha256sum"; else SHA="shasum -a 256"; fi
kc() { command -v security >/dev/null 2>&1 && security find-generic-password -a "$USER" -s "$1" -w 2>/dev/null || true; }
[ -n "${ELEMENT_BACKUP_PASSPHRASE:-}" ] || ELEMENT_BACKUP_PASSPHRASE=$(kc element-backup-passphrase)
if [ -z "${ELEMENT_BACKUP_PASSPHRASE:-}" ]; then read -r -s -p "暗号化パスフレーズ（非表示）: " ELEMENT_BACKUP_PASSPHRASE; echo; fi
dec() { gpg --batch --quiet --pinentry-mode loopback --decrypt --passphrase-fd 3 "$B/$1.gpg" 3< <(printf '%s' "$ELEMENT_BACKUP_PASSPHRASE"); }
# migration ファイルの SHA-256 を表示（手順書の値と照合する）
echo "== migration ファイル"; ( cd "$M" && $SHA prod_0*.sql prod_8*.sql prod_9*.sql ) | sed 's/^/  /'

W=$(mktemp -d "${TMPDIR:-/tmp}/element_migcheck.XXXXXX"); chmod 700 "$W"; SOCK=$W/sock; mkdir -p "$SOCK"
stop() { "$(bin pg_ctl "$SBIN")" -D "$W/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$W"; }
trap stop EXIT
LC_ALL=C LANG=C "$(bin initdb "$SBIN")" -D "$W/data" -U postgres -A trust --no-locale -E UTF8 >/dev/null
"$(bin pg_ctl "$SBIN")" -D "$W/data" -o "-c listen_addresses='' -c unix_socket_directories='$SOCK' -c port=55433" -l "$W/server.log" -w start >/dev/null
export PGHOST=$SOCK PGPORT=55433 PGUSER=postgres; unset PGDATABASE PGOPTIONS
q() { "$(bin psql "$PGBIN")" -X -q "$@"; }
q -d postgres -c "create database base" >/dev/null
dec roles | q -d base -v ON_ERROR_STOP=0 >/dev/null 2>&1 || true
for r in anon authenticated service_role authenticator supabase_auth_admin supabase_storage_admin supabase_admin dashboard_user; do
  q -d base -c "do \$\$begin if not exists (select from pg_roles where rolname='$r') then create role $r nologin; end if; end\$\$;" >/dev/null; done
q -d base -c "create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists \"uuid-ossp\" with schema extensions;" >/dev/null
set +e; dec core_full | "$(bin pg_restore "$PGBIN")" -d base --no-comments 2>/dev/null; set -e
# 本番の既定権限（2026-10-21 確認）：postgres が public に作る表は anon・authenticated・service_role に TRUNCATE・REFERENCES・TRIGGER・MAINTAIN
q -d base -c "alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role" \
          -c "alter default privileges for role postgres in schema public grant truncate, references, trigger, maintain on tables to anon, authenticated, service_role" >/dev/null

pass=0; fail=0; ok() { echo "PASS $1"; pass=$((pass+1)); }; ng() { echo "FAIL $1"; fail=$((fail+1)); }
run() { q -d $1 -v ON_ERROR_STOP=1 -f "$M/$2.sql" > "$W/run.out" 2>&1; }
inv() { "$(bin psql "$PGBIN")" -X -q -At -d $1 -f "$M/prod_80_invariants_READONLY.sql" 2>/dev/null | grep -v '^info\.' > "$2"; }
dump() { "$(bin pg_dump "$PGBIN")" -d $1 --schema-only -n public -n element_release | grep -v -E '^--|^$|^SET |^SELECT pg_catalog|^\\(un)?restrict' > "$2"; }
q -d postgres -c "create database mig template base" >/dev/null
# 0. 事前確認（本番の基準値と一致すること：実データの集計指紋もここで照合される）
if q -d mig -f "$M/prod_00_preflight_READONLY.sql" > "$W/pre.out" 2>&1 && grep -q "preflight: OK" "$W/pre.out"; then ok "preflight（実データで基準値と一致）"; else ng "preflight: $(grep -E 'NG|ERROR' "$W/pre.out" | head -3 | tr '\n' ' ')"; fi
inv mig "$W/i0.tsv"; dump mig "$W/d0.sql"
S="prod_01_registration_compat prod_02_orders_reports_links prod_03_reissue_and_constraints prod_04_onboarding_required"
for s in $S; do run mig $s && ok "適用 $s" || ng "適用 $s: $(grep -m1 ERROR "$W/run.out")"; inv mig "$W/ia.tsv"; cmp -s "$W/i0.tsv" "$W/ia.tsv" && ok "不変項目（$s の後）" || ng "不変項目（$s の後）"; done
dump mig "$W/d1.sql"
for s in $S; do run mig $s && ng "二度適用 $s（止まるはず）" || { grep -q stage_already_applied "$W/run.out" && ok "二度適用 $s は止まり変更なし" || ng "二度適用 $s: $(grep -m1 ERROR "$W/run.out")"; }; done
dump mig "$W/d1b.sql"; cmp -s "$W/d1.sql" "$W/d1b.sql" && ok "二度適用の後も構造は同じ" || ng "二度適用で構造が変わった"
q -d mig -f "$M/prod_81_postcheck_READONLY.sql" 2>&1 | sed -n '/ k /,$p' | sed 's/^/  /'
for r in prod_94_rollback_04_DRAFT_DO_NOT_RUN prod_93_rollback_03_DRAFT_DO_NOT_RUN prod_92_rollback_02_DRAFT_DO_NOT_RUN prod_91_rollback_01_DRAFT_DO_NOT_RUN; do
  run mig $r && ok "rollback $r" || ng "rollback $r: $(grep -m1 ERROR "$W/run.out")"; inv mig "$W/ir.tsv"; cmp -s "$W/i0.tsv" "$W/ir.tsv" && ok "不変項目（$r の後）" || ng "不変項目（$r の後）"; done
dump mig "$W/d2.sql"; cmp -s "$W/d0.sql" "$W/d2.sql" && ok "全段階の rollback 後の構造＝適用前" || ng "rollback 後の構造が適用前と違う"
for s in $S; do run mig $s && ok "再適用 $s" || ng "再適用 $s: $(grep -m1 ERROR "$W/run.out")"; done
dump mig "$W/d3.sql"; cmp -s "$W/d1.sql" "$W/d3.sql" && ok "再適用の構造＝初回" || ng "再適用の構造が初回と違う"
inv mig "$W/i3.tsv"; cmp -s "$W/i0.tsv" "$W/i3.tsv" && ok "不変項目（再適用の後）" || ng "不変項目（再適用の後）"
echo "== 不変項目（適用前。件数・ハッシュのみ）"; sed 's/^/  /' "$W/i0.tsv"
echo "TOTAL pass=$pass fail=$fail"
unset ELEMENT_BACKUP_PASSPHRASE
[ $fail = 0 ]
