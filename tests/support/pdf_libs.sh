#!/bin/bash
# PDF の試験（tests/report_purchase_ui.test.js の2件）が使う html2canvas・jsPDF を用意する。
#   本番の report.html は cdnjs から読み込む（SRI 付き）。ここでは npm の同じ版を取り、report.html の integrity（sha512）と
#   一致することを確かめてから置く（一致しなければ失敗する。cdnjs と同じファイルでなければ試験の意味が無いため）。
#   使い方:  tests/support/pdf_libs.sh <置き場所のディレクトリ>     → そのディレクトリを PDF_LIBS_DIR に指定する
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=${1:?usage: tests/support/pdf_libs.sh <dir>}
mkdir -p "$OUT"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
fetch() { # <npm の名前@版> <tarball 内のパス> <置くファイル名> <report.html の URL の一部>
  local spec=$1 inner=$2 name=$3 url=$4
  (cd "$TMP" && npm pack --silent "$spec" >/dev/null)
  local tgz; tgz=$(ls "$TMP"/*.tgz | head -1)
  tar xzf "$tgz" -C "$TMP" "package/$inner"; rm -f "$tgz"
  local want got
  want=$(grep -oE "$url\" integrity=\"sha512-[A-Za-z0-9+/=]+\"" report.html | grep -oE 'sha512-[A-Za-z0-9+/=]+')
  got="sha512-$(openssl dgst -sha512 -binary "$TMP/package/$inner" | base64 -w0)"
  if [ -z "$want" ] || [ "$want" != "$got" ]; then echo "SRI mismatch for $spec ($got != $want)" >&2; exit 1; fi
  mv "$TMP/package/$inner" "$OUT/$name"; rm -rf "$TMP/package"
  echo "ok $spec $got"
}
fetch html2canvas@1.4.1 dist/html2canvas.min.js html2canvas.min.js 'html2canvas/1.4.1/html2canvas.min.js'
fetch jspdf@2.5.1 dist/jspdf.umd.min.js jspdf.umd.min.js 'jspdf/2.5.1/jspdf.umd.min.js'
