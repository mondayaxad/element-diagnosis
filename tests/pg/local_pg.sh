#!/bin/bash
# 実PG17の試験用に、使い捨ての PostgreSQL 17 をローカルの unix ソケットで起動／停止する（データは /tmp/e2e-pg に作り、停止時に消す）。
#   使い方:  tests/pg/local_pg.sh start | stop | env
#   必要:    PostgreSQL 17 のサーバー（initdb・pg_ctl・postgres）と psql。場所は環境変数で指定する（既定は PATH 上のもの）
#              E2E_PG_SERVER_BIN  サーバーのコマンドのディレクトリ（例: /usr/lib/postgresql/17/bin）
#              E2E_PG_PSQL        psql のパス（既定 psql）
#              E2E_PG_LD_LIBRARY_PATH  共有ライブラリの場所（必要な時だけ）
#   root で実行する場合は、postgres ユーザーで initdb／起動する（PostgreSQL は root で動かせないため）。
#   注意: 接続先は unix ソケットのみ（listen_addresses=''）。外部には開かない。
set -euo pipefail
D=${E2E_PG_DIR:-/tmp/e2e-pg}
PORT=${E2E_PG_PORT:-55440}
BIN=${E2E_PG_SERVER_BIN:-}
b() { if [ -n "$BIN" ]; then echo "$BIN/$1"; else command -v "$1"; fi; }
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- env ${E2E_PG_LD_LIBRARY_PATH:+LD_LIBRARY_PATH=$E2E_PG_LD_LIBRARY_PATH} "$@"; else "$@"; fi; }
case "${1:-}" in
  start)
    rm -rf "$D"; mkdir -p "$D/s"; [ "$(id -u)" = 0 ] && chown -R postgres "$D"
    as_pg "$(b initdb)" -D "$D/d" -U postgres -A trust --no-locale -E UTF8 >/dev/null
    as_pg "$(b pg_ctl)" -D "$D/d" -o "-c listen_addresses='' -c unix_socket_directories=$D/s -c port=$PORT -c max_connections=100 -c fsync=off" -l "$D/log" -w start >/dev/null
    echo "started: socket=$D/s port=$PORT"
    ;;
  stop)
    as_pg "$(b pg_ctl)" -D "$D/d" -m fast stop >/dev/null 2>&1 || true
    rm -rf "$D"; echo stopped
    ;;
  env)
    echo "export E2E_PG=1 E2E_PG_HOST=$D/s E2E_PG_PORT=$PORT E2E_PG_USER=postgres"
    ;;
  *) echo "usage: $0 start|stop|env" >&2; exit 2;;
esac
