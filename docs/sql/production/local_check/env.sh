# ローカル検証の実行環境（PostgreSQL 17 のクライアント・サーバー、PostgreSQL 16 のサーバー）。
#   既定はこのリポジトリの検証で使った場所。別の場所なら環境変数で上書きする。
#   psql・pg_dump は 17 系、postgres・initdb・pg_ctl は 17 系（PG16 の停止確認だけ 16 系）。
: "${PG17_CLIENT_ROOT:=/tmp/pg17cli/root}"
: "${PG17_BIN:=$PG17_CLIENT_ROOT/usr/lib/postgresql/17/bin}"
: "${PG17_SERVER_BIN:=/tmp/pg17native/bin}"
: "${PG16_SERVER_BIN:=/usr/lib/postgresql/16/bin}"
export LD_LIBRARY_PATH="$PG17_CLIENT_ROOT/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
B=$PG17_BIN
