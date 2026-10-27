# メールテンプレート（Supabase Auth）

Supabase → Authentication → Emails → Templates に貼り付けて使う（Custom SMTP 設定時のみ編集可）。
Body は「Source」に切り替えて、ファイルの中身を丸ごと貼る。`{{ .Token }}` は Supabase が6桁のコードに置き換える。

| Supabase のテンプレート | ファイル | 件名（Subject） | 使われる場面 |
|---|---|---|---|
| Magic link or OTP | `magic_link.html` | `元素診断｜6桁のログイン確認コード` | 確認済みのメールアドレスでのログイン |
| Confirm sign up | `confirm_signup.html` | `元素診断｜6桁のログイン確認コード` | 初めてのメールアドレス（未確認のユーザー） |

- 件名は2つとも同じ（2026-10-07 決定）。コードは本文の `{{ .Token }}` だけに入れる。
- 2つとも同じ OTP 形式にする。`signInWithOtp` は、まだ確認されていないメールアドレス（初回）には Confirm sign up を使う
  （Preview の Auth ログでは `/otp` の送信が `user_confirmation_requested` として記録される）。片方だけ直すと、初回だけリンク形式のメールが届く。
- 同じユーザーがコードを再度要求できるのは60秒に1回（Supabase の OTP 再要求の間隔。画面の「コードを再送する」も60秒）。
  テンプレートの保存後に待つ時間ではない。
- 有効期限の文言（60分）は Supabase の `mailer_otp_exp = 3600` に合わせている。変える場合は本文も直す。
- Preview（qelqehkigydgrwedbgtr、element-diagnosis-preview）と本番（akivoobkqcnqvdumxtmg）の両方に同じものを入れる
  （csoivksmieguzywgxbrs は一時停止中の旧プロジェクト。触らない）。本番への反映は別の承認で行う。
