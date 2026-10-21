#!/bin/bash
# 本番ファイルの「購入の集計指紋」2行だけを合成データ用の値へ差し替えたコピーを作る（ローカル試験専用）
set -e; R=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd); O=/tmp/prodsim/sql; mkdir -p $O
for f in $R/prod_0*.sql $R/prod_9*.sql; do [ -f "$f" ] || continue
  b=$(basename $f)
  sed -e 's/30665072821e4cafb1fe85fc56f4dc96/97e7de0aa4e87b92d44f8424422c792c/g' -e 's/a5bc637c700f585024be751b912db9b6/8b7054e5f23e3f805953e3cf55c8a85a/g' $f > $O/$b
  # 差し替えは指紋の値だけ（それ以外の差分が無いこと）
  n=$(diff $f $O/$b | grep -c '^<' || true); e=$(grep -c -E '30665072821e4cafb1fe85fc56f4dc96|a5bc637c700f585024be751b912db9b6' $f || true)
  [ "$n" = "$e" ] || { echo "unexpected diff in $b"; exit 1; }
done
chmod -R a+rX $O; echo copies_ok
