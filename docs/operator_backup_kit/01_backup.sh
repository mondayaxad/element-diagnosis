#!/usr/bin/env bash
# 元素診断 本番DB 読み取り専用・暗号化バックアップ（運営者の手元PCで実行）
# - 秘密値はこのファイルに含まない。実行時に端末から非表示入力する。
# - 接続文字列は環境変数 PGDATABASE（libpqの接続URI）経由で渡し、コマンド引数に出さない。
# - pg_dump の出力は平文ファイルを作らず、そのまま gpg（AES256）で暗号化する。
# - セッションは default_transaction_read_only=on で接続する。
# 必要: PostgreSQL 17 クライアント（pg_dump/pg_dumpall/psql 17.x）、gpg 2.x
set -Eeuo pipefail
umask 077
cd "$(dirname "$0")"
PGBIN=${PGBIN:-}
for t in pg_dump pg_dumpall psql; do
  b=${PGBIN:+$PGBIN/}$t
  "$b" --version | grep -q ' 17\.' || { echo "$t が 17 系ではありません（PGBIN で 17 の bin を指定）"; exit 1; }
done
command -v gpg >/dev/null || { echo "gpg がありません"; exit 1; }
if command -v sha256sum >/dev/null; then SHA="sha256sum"; else SHA="shasum -a 256"; fi

# macOS キーチェーンに登録済みなら自動で読む（値は表示しない）。未登録なら従来どおり非表示入力。
kc() { command -v security >/dev/null 2>&1 && security find-generic-password -a "$USER" -s "$1" -w 2>/dev/null || true; }
[ -n "${ELEMENT_PROD_DB_URL:-}" ] || ELEMENT_PROD_DB_URL=$(kc element-prod-db-uri)
[ -n "${ELEMENT_BACKUP_PASSPHRASE:-}" ] || ELEMENT_BACKUP_PASSPHRASE=$(kc element-backup-passphrase)
if [ -z "${ELEMENT_PROD_DB_URL:-}" ]; then read -r -s -p "Session pooler 接続URI（ダッシュボードの表示のまま貼付可・非表示）: " ELEMENT_PROD_DB_URL; echo; fi
# URI がパスワード未記入（[YOUR-PASSWORD]）なら、DBパスワードを別に非表示入力する（記号はURLエンコードして埋め込む）
case "$ELEMENT_PROD_DB_URL" in *'[YOUR-PASSWORD]'*)
  ELEMENT_DB_PASSWORD=$(kc element-prod-db-password)
  [ -n "$ELEMENT_DB_PASSWORD" ] || { read -r -s -p "DBパスワード（非表示）: " ELEMENT_DB_PASSWORD; echo; }
  export ELEMENT_PROD_DB_URL ELEMENT_DB_PASSWORD
  ELEMENT_PROD_DB_URL=$(python3 -c 'import os,urllib.parse as u;print(os.environ["ELEMENT_PROD_DB_URL"].replace("[YOUR-PASSWORD]",u.quote(os.environ["ELEMENT_DB_PASSWORD"],safe="")))')
  unset ELEMENT_DB_PASSWORD;;
esac
export ELEMENT_PROD_DB_URL
if [ -z "${ELEMENT_BACKUP_PASSPHRASE:-}" ]; then
  read -r -s -p "暗号化パスフレーズ（非表示）: " ELEMENT_BACKUP_PASSPHRASE; echo
  read -r -s -p "もう一度: " P2; echo; [ "$P2" = "$ELEMENT_BACKUP_PASSPHRASE" ] || { echo "一致しません"; exit 1; }; unset P2
fi
[ ${#ELEMENT_BACKUP_PASSPHRASE} -ge 20 ] || { echo "パスフレーズは20文字以上にしてください"; exit 1; }
# URI を libpq の環境変数へ分解（pg_dumpall は接続URIの環境変数を使わないため）。値は表示しない。
command -v python3 >/dev/null || { echo "python3 が必要です"; exit 1; }
eval "$(python3 -c '
import os, shlex, urllib.parse as u
r = u.urlparse(os.environ["ELEMENT_PROD_DB_URL"])
q = dict(u.parse_qsl(r.query))
e = {"PGHOST": u.unquote(r.hostname or ""), "PGPORT": str(r.port or 5432), "PGUSER": u.unquote(r.username or ""),
     "PGPASSWORD": u.unquote(r.password or ""), "PGDATABASE": (r.path or "/postgres").lstrip("/") or "postgres"}
if "sslmode" in q: e["PGSSLMODE"] = q["sslmode"]
print(" ".join("export %s=%s;" % (k, shlex.quote(v)) for k, v in e.items()))
' )"
unset ELEMENT_PROD_DB_URL
case "$PGHOST" in *.pooler.supabase.com) ;; /*) [ "${ALLOW_LOCAL_TEST:-}" = 1 ] || { echo "接続先が Session pooler ではありません"; exit 1; } ;; *) echo "接続先が Session pooler ではありません"; exit 1;; esac
[ "$PGPORT" = 5432 ] || [ "${ALLOW_LOCAL_TEST:-}" = 1 ] || { echo "Session pooler（5432）を指定してください"; exit 1; }
export PGOPTIONS='-c default_transaction_read_only=on'
export PGSSLMODE=${PGSSLMODE:-require}
export PGAPPNAME=element_readonly_backup


psqlq() { "${PGBIN:+$PGBIN/}psql" -X -v ON_ERROR_STOP=1 "$@"; }

# 1) 接続先の確認（本番DBの既知の構造と一致しなければ中止）
# Session pooler は接続時の PGOPTIONS を反映しないため、接続後に SQL で読み取り専用へ切り替える
RO_SQL="set session characteristics as transaction read only; set default_transaction_read_only = on"
CHK=$(psqlq -q -At -c "$RO_SQL" -c "select current_setting('server_version_num')||'|'||current_setting('transaction_read_only')||'|'||(select count(*) from pg_tables where schemaname='public')||'|'||(to_regclass('public.purchase_entitlements') is not null)||'|'||(select count(*) from public.purchase_entitlements)||'|'||(select count(*) from public.purchase_entitlements where created_at < timestamptz '2026-10-06 00:00:00+00')||'|'||(select count(*) from public.purchase_entitlements where created_at >= timestamptz '2026-10-06 00:00:00+00' and not (stripe_checkout_session_id like 'cs\_live\_%' and status = 'active' and product_type = 'core1' and amount = 1000 and currency = 'jpy'))")
IFS='|' read -r VNUM RO NPUB HASPE NPE NBASE NBAD <<<"$CHK"
echo "server_version_num=$VNUM read_only=$RO public_tables=$NPUB purchase_entitlements=$NPE (締め切り2026-10-06より前=$NBASE 以降で条件外=$NBAD)"
[ "${VNUM:0:2}" = 17 ] && [ "$RO" = on ] && [ "$HASPE" = true ] || { echo "接続先の確認に失敗。中止します"; exit 1; }
# 基準は「2026-10-06 00:00Z より前の購入がちょうど9行」。それ以降の行は全て live・active・core1・1,000円・JPY であること（旧版の正規の購入）
[ "$NPUB" = 6 ] && [ "$NBASE" = 9 ] && [ "$NBAD" = 0 ] || { echo "既知の基準（public 6表・基準の購入9行・以降の行は正規のlive購入のみ）と不一致。中止します"; exit 1; }

OUT="${BACKUP_ROOT:-$HOME/element_db_backups}/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"; chmod 700 "$(dirname "$OUT")" "$OUT"
# 2) 取得前の基準値（件数・ハッシュのみ）
psqlq -q -f fingerprint.sql > "$OUT/baseline_before.tsv"

enc() { gpg --batch --yes --quiet --pinentry-mode loopback --symmetric --cipher-algo AES256 \
          --s2k-mode 3 --s2k-digest-algo SHA512 --s2k-count 65011712 --compress-algo none \
          --passphrase-fd 3 -o "$OUT/$1.gpg" 3< <(printf '%s' "$ELEMENT_BACKUP_PASSPHRASE"); }
dump() { local name=$1; shift
  "$@" | tee >($SHA | cut -c1-64 > "$OUT/.$name.plainsha") | enc "$name"
}
PD=${PGBIN:+$PGBIN/}pg_dump; PDA=${PGBIN:+$PGBIN/}pg_dumpall
# 3) バックアップ本体（pg_dump は常に READ ONLY のスナップショット取引で読み出す。pg_dumpall --roles-only は参照のみ）
dump roles        "$PDA" --roles-only --no-role-passwords          # ロール（パスワードは含めない）
dump schema_all   "$PD" -Fc --schema-only                          # 全スキーマ構造（Supabase管理スキーマ含む・参照用）
dump core_full    "$PD" -Fc -n public -n auth -n storage           # public/auth/storage 構造＋データ（復元試験の主対象）
dump core_data    "$PD" -Fc --data-only -n public -n auth -n storage
sleep 1

# 4) 取得後の基準値（取得中に変化していないことの確認）
psqlq -q -f fingerprint.sql > "$OUT/baseline_after.tsv"
cmp -s "$OUT/baseline_before.tsv" "$OUT/baseline_after.tsv" && echo "基準値: 取得前後で一致" || echo "警告: 取得前後で基準値が変化（差分を確認）"

# 5) manifest（秘密値・個人情報を含まない）
{
  printf 'file\tbytes\tsha256_encrypted\tsha256_plain_stream\tcreated_utc\n'
  for n in roles schema_all core_full core_data; do
    f="$OUT/$n.gpg"
    printf '%s\t%s\t%s\t%s\t%s\n' "$n.gpg" "$(wc -c <"$f" | tr -d ' ')" "$($SHA "$f" | cut -c1-64)" "$(cat "$OUT/.$n.plainsha")" "$(date -u -r "$f" +%FT%TZ)"
  done
} > "$OUT/manifest.tsv"
{ echo "target: production DB (identifier omitted)"; echo "server_version_num: $VNUM"
  "$PD" --version; gpg --version | head -1
  echo "encryption: OpenPGP symmetric, AES256, S2K iterated+salted SHA512, no compression"
} > "$OUT/tools.txt"
rm -f "$OUT"/.*.plainsha
unset ELEMENT_BACKUP_PASSPHRASE PGPASSWORD
echo "完了: $OUT"; cat "$OUT/manifest.tsv"
