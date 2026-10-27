#!/usr/bin/env bash
# 秘密値を macOS キーチェーンへ登録する（初回だけ）。値は画面・ファイル・履歴・コマンド引数に残らない。
# 各項目で「password data for new item:」「retype password for new item:」と2回聞かれるので、同じ値を貼り付けて Enter。
set -euo pipefail
command -v security >/dev/null || { echo "macOS の security コマンドがありません"; exit 1; }
add() { echo; echo "▶ $2"; security add-generic-password -U -a "$USER" -s "$1" -w && echo "登録しました: $1"; }
add element-prod-db-uri       "Session pooler 接続URI（[YOUR-PASSWORD] のままで可）"
add element-prod-db-password  "本番DBパスワード"
add element-backup-passphrase "暗号化パスフレーズ（20文字以上。パスワード管理アプリにも保存）"
echo; echo "完了。削除するとき: security delete-generic-password -a \"\$USER\" -s <サービス名>"
