# メールテンプレート（Supabase Auth）

Supabase → Authentication → Emails → Templates に貼り付けて使う（Custom SMTP 設定時のみ編集可）。
Body は「Source」に切り替えて、ファイルの中身を丸ごと貼る。`{{ .Token }}` は Supabase が6桁のコードに置き換える。

| Supabase のテンプレート | ファイル | 件名（Subject） | 使われる場面 |
|---|---|---|---|
| Magic link | `magic_link.html` | `【元素診断】ログインコード {{ .Token }}` | 2回目以降のメールログイン |
| Confirm sign up | `confirm_signup.html` | `【元素診断】ログインコード {{ .Token }}` | 初めてのメールアドレス |

- 件名にもコードを入れて、通知やメール一覧でコードが見えるようにしている（本文と同じ内容なので安全性は変わらない）。
- 有効期限の文言（60分）は Supabase の `mailer_otp_exp = 3600` に合わせている。変える場合は本文も直す。
- Preview（akivoobkqcnqvdumxtmg）と本番（csoivksmieguzywgxbrs）の両方に同じものを入れる。
